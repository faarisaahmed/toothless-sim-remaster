import {
  SEA_LEVEL, fertility, islandAt, fbm, noise2, CLEARING, CLEARING_R, padWeight,
} from "./terrain.js";

// ---------------------------------------------------------------------------
// What the ground is, per sample: its macro colour and what is lying on it.
//
// This used to be a loop inside world.js, which was fine while there was one
// terrain mesh built once on the main thread. There are two now — the coarse
// 13 m sheet that covers the whole archipelago, and the fine chunks streamed in
// around the dragon by terrainworker.js — and if they disagree about what
// colour a hillside is, every chunk boundary is a visible square on the ground.
// So both call this, and it is written against plain numbers rather than
// THREE.Color because a worker cannot import three (the import map does not
// reach into workers).
//
// Inputs are scale-free on purpose. `slope` is |grad h| / 1.1, which is what
// the old neighbour-difference expression reduced to, and `curv` is the height
// above the mean of the four neighbours at CURV_SPAN metres — not one grid cell
// — so a 2 m chunk and a 13 m tile compute the same occlusion for the same
// place instead of the fine one going flat.
// ---------------------------------------------------------------------------

/** The spacing curvature is measured over, in metres. The old grid's quad. */
export const CURV_SPAN = 13.02;

// Colours are linear, converted once from the sRGB hex they were picked in.
function lin(hex) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

// Dark basalt cliffs under mossy green tops — the North Sea look, not chalk.
const SEABED     = lin(0x0e2422);
const SHALLOW    = lin(0x3f8578);
const SAND       = lin(0xc2b08c);
// Sub-arctic turf: the greens of the Faroes and western Iceland, grey-green
// and olive under a cold sky, not the green of an English lawn in June.
const GRASS_COOL = lin(0x3f6232);
const GRASS_WARM = lin(0x6c7646);
const MEADOW     = lin(0x7c8256);
const DARK_MOSS  = lin(0x263f28);
const HEATH      = lin(0x5f564e);
const ROCK_LIGHT = lin(0x7a7266);
const ROCK_DARK  = lin(0x34312c);
const SNOW       = lin(0xe6edf2);
// Burnt ground. Bare mineral soil and a season of ash, and it has to be a
// colour of its own rather than just an absence of trees: a gap in the wood
// that is the same grey as every crag on every island is not findable from
// the air, and finding it is what the beat is for.
const ASH        = lin(0x7d7462);
const CHAR       = lin(0x2b2620);
// The hunters' pit: packed road and the cut rock between its terraces.
const PIT_ROAD   = lin(0x6a5c4a);
const PIT_ROCK   = lin(0x2e2b28);
// The pit's ground up close: wet, churned mud where water and feet collect,
// grey gravel where it has been spread or washed clean, and the turf and moss
// that come back wherever nobody walks.
const PIT_MUD    = lin(0x2f271f);
const PIT_GRAVEL = lin(0x8a8478);
const PIT_MOSS   = lin(0x4b5a33);
const TRODDEN    = lin(0x5d4f3c);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

let r = 0, g = 0, b = 0;
const set = (c) => { r = c[0]; g = c[1]; b = c[2]; };
const mix = (c, t) => { r += (c[0] - r) * t; g += (c[1] - g) * t; b += (c[2] - b) * t; };

/**
 * @param {number} x, z   world position
 * @param {number} h      terrainHeight(x, z)
 * @param {number} slope  0 flat .. 1 steep (|grad| / 1.1, clamped)
 * @param {number} curv   h minus the mean of the four neighbours CURV_SPAN away
 * @param {Float32Array} out  rgb at [o], veg/sand/snow at [o+3]
 */
export function paintGround(x, z, h, slope, curv, out, o = 0) {
  // Cheap ambient occlusion: sit lower than your neighbours and you're in a
  // crevice, so you get less sky. This is what gives the cliffs depth.
  const ao = clamp(1 + (curv / (CURV_SPAN * 1.5)) * 0.45, 0.62, 1.12);

  let veg = 0, sand = 0, snow = 0;

  if (h < SEA_LEVEL - 1.5) {
    // Under water the terrain is only ever seen through the sea, and the sea
    // goes translucent in the last three metres, so the shallows have to be a
    // colour worth seeing: pale bar, then green, then nothing.
    set(SAND);
    mix(SHALLOW, smoothstep(-h, 1, 11));
    mix(SEABED, smoothstep(-h, 8, 85));
    sand = 1 - smoothstep(-h, 1, 9);
  } else {
    const isl = islandAt(x, z);
    const bare = isl ? isl.bare : 0.45;
    const snowLine = 320 - (isl ? isl.snow : 0);

    veg = fertility(x, z, h, slope);

    // Beach: the last few metres above the water, and only where it is not
    // standing on end. A wave-cut bench of bare rock is not a beach.
    sand = (1 - smoothstep(h, 2.5, 9)) * (1 - smoothstep(slope, 0.16, 0.42))
         * (0.35 + 0.65 * (1 - bare));

    // Snow lies on anything short of a wall; on a glacier island (a lowered
    // snow line) it clings to steeper ground too, because that is what the ice
    // cap is.
    const cling = isl && isl.snow > 0 ? 0.6 : 0;
    snow = smoothstep(h, snowLine, snowLine + 130)
         * (1 - smoothstep(slope, 0.55 + cling, 1.1 + cling));

    // Large-scale patchiness so the greens aren't one flat wash: cool and warm
    // grass, and drier meadow on the open south-facing ground.
    const patch = fbm(x * 0.0011, z * 0.0011, 3) * 0.5 + 0.5;
    const dry = smoothstep(fbm(x * 0.0023 + 41.0, z * 0.0023 - 7.0, 2), 0.05, 0.6);

    // Horizontal strata on exposed rock, following the terracing the height
    // field already cut, so the banding lands on the steps rather than across.
    // Two periods that never line up, and kept faint: one strong sine read as
    // a zebra from the air, a hundred identical stripes down every hill.
    const wob = fbm(x * 0.004, z * 0.004, 2) * 2.4;
    const band = 0.5 + 0.3 * Math.sin(h * 0.36 + wob) + 0.2 * Math.sin(h * 0.093 - wob * 0.7);
    const rt = 0.3 + band * 0.4 + (patch - 0.5) * 0.25;
    const rockR = ROCK_DARK[0] + (ROCK_LIGHT[0] - ROCK_DARK[0]) * rt;
    const rockG = ROCK_DARK[1] + (ROCK_LIGHT[1] - ROCK_DARK[1]) * rt;
    const rockB = ROCK_DARK[2] + (ROCK_LIGHT[2] - ROCK_DARK[2]) * rt;
    const ROCK = [rockR, rockG, rockB];

    // Open ground that is not forest is heath and short turf, not bare rock —
    // the islands are wet and green to the cliff edge. The old ramp went
    // straight from grass to rock, so every patch the fertility number thinned
    // came out as a brown sheet.
    set(ROCK);
    const turf = (1 - smoothstep(slope, 0.62, 1.0)) * (1 - smoothstep(h, 260, 360))
               * smoothstep(h, 3, 9) * (1 - bare * 0.55);
    mix(HEATH, turf * 0.75);
    mix(GRASS_COOL, turf * 0.55);
    const grassT = clamp(veg * 0.92 + turf * 0.25, 0, 1);
    const gr = [
      GRASS_COOL[0] + (GRASS_WARM[0] - GRASS_COOL[0]) * patch,
      GRASS_COOL[1] + (GRASS_WARM[1] - GRASS_COOL[1]) * patch,
      GRASS_COOL[2] + (GRASS_WARM[2] - GRASS_COOL[2]) * patch,
    ];
    mix(gr, grassT);
    mix(MEADOW, dry * grassT * (1 - veg) * 0.45);
    mix(DARK_MOSS, smoothstep(veg, 0.45, 0.95) * (0.35 + patch * 0.4));
    mix(SAND, sand);
    // Steep ground is rock whatever grew near it. "Steep" is about 35 degrees
    // and up: these islands are turf to the cliff edge, and the old 16 degree
    // threshold turned every hillside into bare stone.
    mix(ROCK, smoothstep(slope, 0.6, 1.0) * (1 - snow * 0.6));
    mix(SNOW, snow);

    // The shader reads vegetation as "how green is the texture", so turf has
    // to count, a bit, or the heath shows the scree photograph.
    veg = Math.max(veg, turf * 0.62);

    // The hunters' pit: the terraces are a road, trodden to bare earth and
    // gravel, and the risers between them are cut rock. Painted here so the
    // spiral reads from the air as rings of pale road on dark stone.
    if (isl && isl.crater && isl.crater.spiral) {
      const dp = Math.hypot(x - isl.x, z - isl.z) / isl.r;
      const inPit = 1 - smoothstep(dp, isl.crater.inner - 0.05, isl.crater.inner + 0.02);
      if (inPit > 0.001) {
        const tread = 1 - smoothstep(slope, 0.25, 0.55);
        mix(PIT_ROCK, inPit * (1 - tread));
        mix(PIT_ROAD, inPit * tread * (0.8 + 0.2 * patch));
        // Patchwork, at three scales so no two square metres match.
        const n1 = fbm(x * 0.031 + 7.1, z * 0.031 - 2.9, 2);
        const n2 = noise2(x * 0.11 - 3.3, z * 0.11 + 5.5);
        const n3 = noise2(x * 0.37 + 1.9, z * 0.37 - 8.2);
        // Mud collects in the hollows and where the noise says it is wet.
        const hollow = clamp(-curv / (CURV_SPAN * 0.6), 0, 1);
        const wet = smoothstep(n1 + hollow * 0.8 + n3 * 0.15, 0.2, 0.75);
        mix(PIT_MUD, inPit * tread * wet);
        // Gravel in drifts and along the edges of the treads.
        const grav = smoothstep(n2 + n3 * 0.3 - wet * 0.6, 0.25, 0.7);
        mix(PIT_GRAVEL, inPit * tread * grav * 0.8);
        // Moss and turf where traffic does not reach: against the risers, on
        // the rubble, at the edge of the floor.
        const quiet = smoothstep(slope, 0.12, 0.3) * tread + smoothstep(n1 - n2 * 0.5, 0.35, 0.8) * 0.6;
        const moss = clamp(quiet * (1 - wet) * (0.5 + 0.5 * n3), 0, 1);
        mix(PIT_MOSS, inPit * moss * 0.75);
        veg = lerp(veg * (1 - inPit), moss * 0.55, inPit);
        // The trodden earth reads best through the fine-grained sand layer:
        // the scree photograph is a field of fist-sized stones.
        sand = Math.max(sand, inPit * tread * (1 - moss) * 0.7);
      }
    }

    // Levelled ground where people live (terrain.js PADS): trodden to earth
    // between the houses, grass hanging on in patches, so a village reads
    // from the air as a village and not as a lawn in a hole.
    const pw = padWeight(x, z);
    if (pw > 0.001) {
      const wear = smoothstep(fbm(x * 0.045 + 3.3, z * 0.045 - 1.7, 2) * 0.5 + 0.5, 0.25, 0.75);
      mix(TRODDEN, pw * (0.45 + 0.45 * wear) * (1 - smoothstep(slope, 0.3, 0.6)));
      veg *= 1 - pw * 0.6;
    }

    if (CLEARING) {
      const cd = Math.hypot(x - CLEARING.x, z - CLEARING.z);
      const burn = 1 - smoothstep(cd, CLEARING_R * 0.7, CLEARING_R * 1.7);
      if (burn > 0.004) {
        // Ash over most of it, char in the hollows and on the stump line, so
        // it is not one flat wash of grey.
        const soot = fbm(x * 0.021, z * 0.021, 2) * 0.5 + 0.5;
        mix(ASH, burn * 0.82 * (1 - soot * 0.35));
        mix(CHAR, burn * soot * 0.42);
        veg *= 1 - burn * 0.9;      // and the grass texture stops with it
      }
    }
  }

  const tint = ao * (1 + noise2(x * 0.02, z * 0.02) * 0.06);
  out[o]     = r * tint;
  out[o + 1] = g * tint;
  out[o + 2] = b * tint;
  out[o + 3] = veg;
  out[o + 4] = sand;
  out[o + 5] = snow;
}

/** Grid indices of the border, walked once round, `res * 4` of them. */
export function edgeLoop(res) {
  const side = res + 1;
  const out = new Uint32Array(res * 4);
  let k = 0;
  for (let i = 0; i < res; i++) out[k++] = i;                          // top, →
  for (let j = 0; j < res; j++) out[k++] = j * side + res;             // right, ↓
  for (let i = res; i > 0; i--) out[k++] = res * side + i;             // bottom, ←
  for (let j = res; j > 0; j--) out[k++] = j * side;                   // left, ↑
  return out;
}
