// ---------------------------------------------------------------------------
// The Barbaric Archipelago — shape only.
//
// Everything here is a pure function of (x, z) in metres. No THREE, no DOM, no
// state: world.js builds a mesh out of it, map.js re-derives the coastlines out
// of it independently for the chart, ocean.js bakes a depth field out of it to
// shoal waves against, and main.js asks it where the rock is about twenty times
// a frame. Those four have to agree exactly and forever, which is why there is
// no cache and no Math.random below the seed table.
// ---------------------------------------------------------------------------

export const TERRAIN_SIZE = 10000;
export const SEA_LEVEL = 0;
export const SEA_FLOOR = -190;

// Prevailing wind, as a bearing in radians (the direction it blows *towards*).
// The sea, the grass, the trees and the spray all read this, and the coasts are
// shaped by it too: windward sides get cliffs, lee sides get beaches and spits.
export const WIND_BEARING = 2.15;

// The shoal notch — see the bottom of terrainHeight(). STEEP is how much the
// gradient is multiplied by right at the waterline; TAPER is how many metres of
// depth it takes to fade back to the real sea floor. Kept modest on purpose:
// the aim is to get the sea bed out of the band the renderer cannot draw, not
// to put a wall around every island.
const SHOAL_STEEP = 1.5;
const SHOAL_TAPER = 6.5;
const WIND_X = Math.sin(WIND_BEARING);
const WIND_Z = Math.cos(WIND_BEARING);

// ---------------------------------------------------------------------------
// Noise
//
// Our own 2D simplex rather than three's ImprovedNoise, for throughput rather
// than quality. ImprovedNoise is 3D — eight gradient dots and a trilinear blend
// per sample, about 44 ns here. This field is evaluated 231k times to build the
// terrain mesh, once per texel of the shore-depth map, twice more for the chart
// and the contour grid, and forever after at runtime; and the erosion, the
// three-scale coastline warp and the strata below want forty-odd octaves of it.
// 2D simplex is three gradient dots and no blend. That difference is the whole
// budget for everything that makes the coast look like a coast.
// ---------------------------------------------------------------------------

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// Gustavson's 12 gradients. Using the 3D set for 2D noise looks wasteful and
// isn't: the four that project to zero length are what keep the lattice from
// showing as a visible diagonal grain at low frequencies.
const GRAD = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const PERM = new Uint8Array(512);
const PERM12 = new Uint8Array(512);
{
  // A fixed shuffle from a fixed LCG. Deterministic across runs, machines and
  // browsers, which terrainHeight's contract with the chart requires.
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337 >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 8) % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    PERM12[i] = PERM[i] % 12;
  }
}

/** 2D simplex noise, roughly -1..1. */
export function noise2(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - i + t, y0 = yin - j + t;

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2,     y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2,  y2 = y0 - 1 + 2 * G2;

  const ii = i & 255, jj = j & 255;
  let n = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = PERM12[ii + PERM[jj]] * 3;
    t0 *= t0;
    n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = PERM12[ii + i1 + PERM[jj + j1]] * 3;
    t1 *= t1;
    n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = PERM12[ii + 1 + PERM[jj + 1]] * 3;
    t2 *= t2;
    n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
  }
  return 70 * n;
}

/** Fractal Brownian motion. Rolling, rounded — landforms and colour blotching. */
export function fbm(x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;   // not exactly 2, so octaves never line up into a visible grid
  }
  return sum / norm;
}

/**
 * Ridged multifractal, 0..1. Folding the noise at zero turns fBm's rounded
 * hills into sharp crests with V-cut gullies between them, which is what makes
 * rock read as rock instead of as dunes. The running weight is the part that
 * matters: each octave is attenuated where the one above it was already low, so
 * detail collects on the ridges and the valleys stay smooth — the same reason
 * real erosion leaves gullies clean and ridges broken.
 */
export function ridged(x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, z * freq));
    n *= n * weight;
    weight = n < 1 ? n : 1;
    sum += amp * n;
    norm += amp;
    amp *= 0.52;
    freq *= 2.07;
  }
  return sum / norm;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smoothstep(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// The islands
//
// Fields, all optional except x/z/r/h:
//
//   name     chart label. Omit and it is an unnamed skerry.
//   r        MAJOR radius in metres. map.js draws its hatching off this.
//   h        summit height above the SEA FLOOR, not above the water. The floor
//            is -190, so h: 300 puts the top around +110 m. This trips
//            everyone up once.
//   cliff    width of the sheer coastal band as a fraction of r. Small = a
//            vertical sea cliff; large = a long shallow ramp into the water.
//   elong    minor/major axis ratio. 0.4 is a long ridge, 1 is round.
//   rot      bearing of the major axis, radians.
//   lobe     how far the coastline swings in and out, as a fraction of r. This
//            is the single biggest thing standing between "island" and "circle".
//   lobeK    roughly how many headlands. Higher = more, smaller ones.
//   dome     interior falloff. 0 is a table top, 0.6 is a proper massif.
//   relief   multiplier on the ridged interior relief.
//   terrace  0..1 stratified rock. Sea cliffs in basalt country are stacks of
//            lava flows and read as steps; this is that.
//   scree    multiplier on the high-frequency crags.
//   shelfW   width of the drowned foot, as a fraction of r. This is what the
//            waves shoal and break on, so a wide shelf means a long surf line.
//   beach    0..1 how readily this coast forms a wave-cut bench and a beach.
//   bare     0..1 how bare of vegetation. 1 is scoured lava, 0 is thick forest.
//   snow     metres to lower the snow line by. Glacier islands only.
//   flat     plateau: kills the relief and the crags. Hollow Stack.
//   crater   {inner, floor, gate, mouth} — see Dragon Hunter Island below.
//
// Layout follows a geological story rather than a scatter, because a scatter is
// exactly what reads as procedural from the air: a young volcanic arc running
// NE through Dragon Peak, Fireworm and Dragon Hunter Island; older, deeply
// eroded fjord islands west and north of Berk; and low sand and shingle banks
// in the shallow south-east where the shelf never gets deep.
// ---------------------------------------------------------------------------

const RAW_ISLANDS = [
  // --- Home waters -------------------------------------------------------
  // Berk. Fixed: spawn is (0, 300, 900) and mission beat 1 is "leave Berk".
  // Long north-south, deeply bitten into on the west by the sound the village
  // stands on, forested to the tree line.
  { name: "Berk", x: 0, z: -1100, r: 1150, h: 360, cliff: 0.26,
    elong: 0.74, rot: 0.32, lobe: 0.30, lobeK: 0.85, dome: 0.42,
    relief: 1.0, terrace: 0.35, shelfW: 0.42, beach: 0.55, bare: 0.15 },

  { name: "Raven Point", x: 2700, z: 500, r: 860, h: 520, cliff: 0.18,
    elong: 0.58, rot: -0.7, lobe: 0.26, lobeK: 1.1, dome: 0.5,
    relief: 1.15, terrace: 0.5, shelfW: 0.3, beach: 0.2, bare: 0.35 },

  // --- The volcanic arc, running NE ---------------------------------------
  { name: "Dragon Peak", x: -2900, z: -2000, r: 780, h: 640, cliff: 0.16,
    elong: 0.86, rot: 0.9, lobe: 0.2, lobeK: 1.0, dome: 0.68,
    relief: 1.3, terrace: 0.2, scree: 1.5, shelfW: 0.26, beach: 0.12,
    bare: 0.7, snow: 120 },

  { name: "Fireworm Island", x: 4300, z: 2700, r: 680, h: 420, cliff: 0.22,
    elong: 0.8, rot: 0.4, lobe: 0.22, lobeK: 1.3, dome: 0.62,
    relief: 1.1, terrace: 0.15, scree: 1.4, shelfW: 0.3, beach: 0.25, bare: 0.85 },

  // Dragon Hunter Island. A drowned volcano: a high broken rim with a flat
  // floor inside it and one channel cut through to the sea, so the whole hunter
  // operation sits in a bowl you have to fly down into.
  //
  //   inner  how far out the flat floor reaches, as a fraction of r
  //   floor  how high that floor sits, as a fraction of h
  //   gate   bearing of the channel through the rim, radians
  //   mouth  half-width of that channel, radians
  //
  // findCraterFloor() in main.js sweeps this bowl at load and puts the compound
  // AND the story waypoint on the flattest patch it finds. If the sweep comes
  // back empty the fort floats and mission 1 is unplayable, so tools/probe.mjs
  // runs the same sweep — check it, do not assume it.
  { name: "Dragon Hunter Island", x: 2900, z: 3800, r: 980, h: 640, cliff: 0.28,
    elong: 0.9, rot: -0.35, lobe: 0.15, lobeK: 1.4, dome: 0,
    relief: 1.2, terrace: 0.55, scree: 1.2, shelfW: 0.34, beach: 0.3, bare: 0.75,
    crater: { inner: 0.46, floor: 0.42, gate: 0.85, mouth: 0.26 } },

  // Hollow Stack. `flat` turns off the relief and the crags so this comes out
  // as a plateau rather than a spire — the story lives on it, and you have to
  // land on it and walk from the shelter to the lab. STACK_Y = 102 in
  // chapters.js is the deck height; keep the top near it.
  { name: "Hollow Stack", x: 1700, z: 2550, r: 340, h: 333, cliff: 0.42,
    elong: 0.9, rot: 1.2, lobe: 0.10, lobeK: 1.6, dome: 0,
    terrace: 0.75, shelfW: 0.5, beach: 0.15, bare: 0.6, flat: true },

  // --- North --------------------------------------------------------------
  { name: "Berserker Island", x: -4150, z: -3300, r: 940, h: 560, cliff: 0.15,
    elong: 0.62, rot: -0.5, lobe: 0.34, lobeK: 0.8, dome: 0.5,
    relief: 1.25, terrace: 0.6, shelfW: 0.28, beach: 0.18, bare: 0.4 },

  { name: "Wild Dragon Cliffs", x: -2450, z: -4250, r: 700, h: 540, cliff: 0.10,
    elong: 0.5, rot: 0.15, lobe: 0.22, lobeK: 1.2, dome: 0.35,
    relief: 1.0, terrace: 0.8, shelfW: 0.2, beach: 0.05, bare: 0.5 },

  { name: "Breakneck Bog", x: -1500, z: -3150, r: 720, h: 215, cliff: 0.44,
    elong: 0.78, rot: 0.6, lobe: 0.33, lobeK: 1.5, dome: 0.12,
    relief: 0.35, terrace: 0.05, shelfW: 0.62, beach: 0.85, bare: 0.1 },

  { name: "Thor's Beach", x: 350, z: -4050, r: 560, h: 175, cliff: 0.5,
    elong: 0.5, rot: -0.35, lobe: 0.36, lobeK: 1.7, dome: 0.1,
    relief: 0.3, shelfW: 0.75, beach: 1.0, bare: 0.45 },

  { name: "Hobblegrunt Island", x: 2250, z: -4100, r: 640, h: 330, cliff: 0.28,
    elong: 0.7, rot: 0.8, lobe: 0.28, lobeK: 1.2, dome: 0.4,
    relief: 0.9, terrace: 0.3, shelfW: 0.4, beach: 0.5, bare: 0.2 },

  { name: "Itchy Armpit", x: 3550, z: -2450, r: 640, h: 340, cliff: 0.32,
    elong: 0.66, rot: -0.2, lobe: 0.3, lobeK: 1.3, dome: 0.35,
    relief: 0.8, terrace: 0.25, shelfW: 0.46, beach: 0.6, bare: 0.3 },

  { name: "Auction Island", x: 4400, z: -1250, r: 520, h: 285, cliff: 0.3,
    elong: 0.75, rot: 0.5, lobe: 0.24, lobeK: 1.5, dome: 0.4,
    relief: 0.85, terrace: 0.3, shelfW: 0.42, beach: 0.45, bare: 0.35 },

  // --- West ---------------------------------------------------------------
  { name: "Glacier Island", x: -4500, z: 250, r: 760, h: 720, cliff: 0.14,
    elong: 0.8, rot: 0.25, lobe: 0.18, lobeK: 1.0, dome: 0.6,
    relief: 1.1, terrace: 0.35, shelfW: 0.24, beach: 0.08, bare: 1.0, snow: 300 },

  { name: "Bog-Burglar Island", x: -3350, z: -1000, r: 620, h: 300, cliff: 0.3,
    elong: 0.68, rot: 1.15, lobe: 0.3, lobeK: 1.4, dome: 0.35,
    relief: 0.8, terrace: 0.25, shelfW: 0.48, beach: 0.7, bare: 0.15 },

  { name: "Outcast Island", x: -2500, z: 1500, r: 960, h: 320, cliff: 0.36,
    elong: 0.64, rot: -0.55, lobe: 0.32, lobeK: 1.0, dome: 0.3,
    relief: 0.75, terrace: 0.45, shelfW: 0.5, beach: 0.45, bare: 0.55 },

  { name: "Impossible Island", x: -4600, z: 2000, r: 430, h: 420, cliff: 0.10,
    elong: 0.85, rot: 0, lobe: 0.14, lobeK: 1.8, dome: 0.2,
    relief: 0.9, terrace: 0.9, shelfW: 0.22, beach: 0.05, bare: 0.7 },

  // h was 250, peaking at +15 m. See the note on Peaceable Country.
  { name: "Healer Island", x: -3650, z: 2900, r: 700, h: 375, cliff: 0.4,
    elong: 0.7, rot: 0.35, lobe: 0.35, lobeK: 1.1, dome: 0.28,
    relief: 0.5, terrace: 0.1, shelfW: 0.66, beach: 0.9, bare: 0.05 },

  // --- South --------------------------------------------------------------
  { name: "Scuttleclaw Island", x: -2600, z: 3950, r: 620, h: 350, cliff: 0.24,
    elong: 0.72, rot: -0.8, lobe: 0.28, lobeK: 1.3, dome: 0.42,
    relief: 0.95, terrace: 0.35, shelfW: 0.38, beach: 0.4, bare: 0.25 },

  { name: "Gronckle Isle", x: -900, z: 3500, r: 560, h: 260, cliff: 0.42,
    elong: 0.82, rot: 0.45, lobe: 0.26, lobeK: 1.5, dome: 0.3,
    relief: 0.7, terrace: 0.4, scree: 1.6, shelfW: 0.5, beach: 0.55, bare: 0.6 },

  { name: "Changewing Island", x: 600, z: 3400, r: 700, h: 430, cliff: 0.2,
    elong: 0.6, rot: 1.0, lobe: 0.3, lobeK: 1.2, dome: 0.5,
    relief: 1.05, terrace: 0.3, shelfW: 0.34, beach: 0.3, bare: 0.2 },

  { name: "Death Song Island", x: 1550, z: 4500, r: 420, h: 460, cliff: 0.12,
    elong: 0.78, rot: -0.3, lobe: 0.2, lobeK: 1.7, dome: 0.55,
    relief: 1.2, terrace: 0.5, scree: 1.3, shelfW: 0.26, beach: 0.1, bare: 0.65 },

  { name: "Melody Island", x: -1250, z: 4650, r: 380, h: 300, cliff: 0.2,
    elong: 0.7, rot: 0.7, lobe: 0.28, lobeK: 1.9, dome: 0.4,
    relief: 0.9, terrace: 0.45, shelfW: 0.4, beach: 0.35, bare: 0.4 },

  { name: "Vanaheim", x: -4400, z: 4350, r: 820, h: 500, cliff: 0.13,
    elong: 0.66, rot: 0.55, lobe: 0.3, lobeK: 0.9, dome: 0.45,
    relief: 1.15, terrace: 0.65, shelfW: 0.26, beach: 0.15, bare: 0.3 },

  { name: "Wingmaiden Island", x: 4500, z: 4300, r: 560, h: 360, cliff: 0.14,
    elong: 0.74, rot: -0.6, lobe: 0.24, lobeK: 1.4, dome: 0.5,
    relief: 1.1, terrace: 0.55, shelfW: 0.3, beach: 0.2, bare: 0.35 },

  { name: "Sandbuster Island", x: 4350, z: 900, r: 600, h: 165, cliff: 0.55,
    elong: 0.5, rot: 0.9, lobe: 0.4, lobeK: 1.6, dome: 0.08,
    relief: 0.25, shelfW: 0.9, beach: 1.0, bare: 0.55 },

  // Peaceable Country. The deep wood, and the one island mission 1 goes INTO
  // rather than over: the hunters worked here before they moved out to the
  // caldera, and what they left in the clearing is the first sign of them.
  //
  // It used to be r 470, h 235 and it peaked at FOUR METRES -- 1% of it above
  // water. So did the chart's other two thickest woods, Sheep Island (-9 m,
  // no land at all) and Healer Island (+15 m). `h` is measured off the sea
  // floor at -190, and on an island this small the coastal cliff band and the
  // interior falloff eat most of what is left, so the three entries in the
  // table with `bare: 0.05` -- the three that were meant to be forest -- were
  // the three that did not exist. That is the real reason there was no forest
  // anywhere in the game.
  //
  // Nudged 300 m north-west as well, which puts it within 280 m of the line
  // from Berk to Dragon Hunter Island and leaves 1.1 km of clear water
  // between its shore and Hollow Stack's.
  { name: "Peaceable Country", x: 1250, z: 1500, r: 620, h: 410, cliff: 0.34,
    elong: 0.72, rot: -0.25, lobe: 0.34, lobeK: 1.5, dome: 0.34,
    relief: 0.72, terrace: 0.2, shelfW: 0.5, beach: 0.7, bare: 0.05 },

  { name: "Dark Deep", x: -1700, z: 300, r: 500, h: 400, cliff: 0.11,
    elong: 0.55, rot: 1.35, lobe: 0.2, lobeK: 1.6, dome: 0.3,
    relief: 1.0, terrace: 0.75, shelfW: 0.2, beach: 0.05, bare: 0.6 },

  { name: "Villainy Island", x: 3350, z: -600, r: 480, h: 355, cliff: 0.2,
    elong: 0.68, rot: 0.25, lobe: 0.26, lobeK: 1.6, dome: 0.45,
    relief: 1.0, terrace: 0.4, shelfW: 0.34, beach: 0.3, bare: 0.4 },

  // h was 215, which on a 330 m island came out at -9 m: it had no land on it
  // at all. See the note on Peaceable Country.
  { name: "Sheep Island", x: -1150, z: 2350, r: 360, h: 330, cliff: 0.38,
    elong: 0.76, rot: 0.15, lobe: 0.3, lobeK: 2.0, dome: 0.28,
    relief: 0.5, terrace: 0.2, shelfW: 0.6, beach: 0.85, bare: 0.05 },

  { name: "Odin's Respite", x: 2650, z: 2300, r: 300, h: 330, cliff: 0.14,
    elong: 0.62, rot: -1.0, lobe: 0.22, lobeK: 2.1, dome: 0.4,
    relief: 1.0, terrace: 0.6, shelfW: 0.3, beach: 0.15, bare: 0.5 },

  { name: "Eel Isle", x: 1000, z: -2900, r: 360, h: 280, cliff: 0.24,
    elong: 0.58, rot: 0.95, lobe: 0.28, lobeK: 1.9, dome: 0.35,
    relief: 0.85, terrace: 0.35, shelfW: 0.42, beach: 0.4, bare: 0.3 },

  { name: "Sullen Sound", x: -3900, z: 1150, r: 400, h: 290, cliff: 0.26,
    elong: 0.5, rot: 0.05, lobe: 0.34, lobeK: 1.5, dome: 0.3,
    relief: 0.8, terrace: 0.3, shelfW: 0.44, beach: 0.5, bare: 0.25 },
];

// ---------------------------------------------------------------------------
// Skerries
//
// Real archipelagos are not a scatter of islands in open water — they are a few
// big islands surrounded by fields of rock that are the same island's drowned
// ridges. So these are placed in rings around their parents, along the parent's
// major axis, rather than sprinkled over the map. They are also where most of
// the surf is, and there is a lot more of it than there is of them.
//
// Generated at module load from a fixed seed. Deterministic — this list is the
// same on every run, which the chart depends on.
// ---------------------------------------------------------------------------

function makeSkerries(parents) {
  const out = [];
  let s = 20250905 >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

  // Nothing may be dropped near these three: the compound sweep, the plateau
  // and the spawn corridor all assume clear ground or clear water.
  const KEEP_CLEAR = [
    { x: 2900, z: 3800, r: 1500 },   // Dragon Hunter Island and its approach
    { x: 1750, z: 2500, r: 700 },    // Hollow Stack must stand alone
    { x: 0, z: 900, r: 700 },        // spawn
    { x: 2080, z: 2320, r: 420 },    // the shoal — it is a fishing spot, not a reef
  ];

  for (const p of parents) {
    if (!p.name || p.r < 380) continue;
    const count = Math.round(1 + p.r / 420);
    for (let i = 0; i < count; i++) {
      // Hug the parent's major axis, so a skerry field reads as the same ridge
      // carrying on underwater rather than as confetti.
      const along = (rnd() * 2 - 1);
      const a = (p.rot ?? 0) + along * 0.85 + (rnd() < 0.5 ? 0 : Math.PI);
      const dist = p.r * (1.15 + rnd() * 0.75);
      const x = Math.round(p.x + Math.cos(a) * dist);
      const z = Math.round(p.z + Math.sin(a) * dist);
      if (Math.abs(x) > 4900 || Math.abs(z) > 4900) continue;

      let blocked = false;
      for (const k of KEEP_CLEAR) if (Math.hypot(x - k.x, z - k.z) < k.r) blocked = true;
      for (const o of parents) {
        if (o === p) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.r * 0.95) blocked = true;
      }
      if (blocked) continue;

      // Two thirds of them are drowned reefs that never break the surface, which
      // is the point: they are what makes the water around an island read as
      // shallow, and what the surf trips over.
      const drowned = rnd() < 0.62;
      const rr = 110 + rnd() * 190;
      out.push({
        x, z, r: rr,
        // Two thirds of a metre of clearance is not "drowned", it is "awash",
        // and awash is the one depth this engine cannot draw: the sea goes
        // translucent over it, the surf band covers it in white, and the wave
        // geometry cuts through it. So a drowned skerry is now properly under —
        // its crown lands around ten to twenty metres down, deep enough to be
        // green water with a shadow in it and still shallow enough to trip a
        // swell, which was always the point of them.
        h: drowned ? 118 + rnd() * 28 : 205 + rnd() * 95,
        cliff: drowned ? 0.5 : 0.09 + rnd() * 0.1,
        elong: 0.4 + rnd() * 0.45, rot: rnd() * Math.PI,
        lobe: 0.24, lobeK: 2.4, dome: drowned ? 0.1 : 0.25,
        relief: drowned ? 0.3 : 0.8, terrace: drowned ? 0 : 0.5,
        // beach was 0.9 on the drowned ones, and beachiness is what drives the
        // wave-cut bench that pulls everything within 22 m toward +2.5. It was
        // dragging reefs up to the surface and painting them sand colour.
        scree: 1.3, shelfW: drowned ? 0.6 : 0.6, beach: drowned ? 0.2 : 0.1,
        bare: 1,
      });
    }
  }
  return out;
}

// Sea stacks that were hand-placed to be threaded between, and are kept because
// the flight model was tuned against them.
const STACKS = [
  { x: 1000, z: 400, r: 150, h: 320, cliff: 0.12 },
  { x: -750, z: 950, r: 120, h: 285, cliff: 0.10 },
  { x: 1900, z: -1600, r: 170, h: 440, cliff: 0.14 },
  { x: -1600, z: -400, r: 110, h: 265, cliff: 0.10 },
  { x: 2200, z: 2000, r: 140, h: 300, cliff: 0.12 },
  { x: -300, z: 1800, r: 130, h: 278, cliff: 0.11 },
  { x: 3100, z: -600, r: 160, h: 330, cliff: 0.13 },
].map((s) => ({ ...s, elong: 0.62, rot: s.x * 0.001, lobe: 0.16, lobeK: 2.6,
                dome: 0.15, relief: 0.9, terrace: 0.65, scree: 1.4,
                shelfW: 0.8, beach: 0.05, bare: 1 }));

export const ISLANDS = [...RAW_ISLANDS, ...STACKS, ...makeSkerries(RAW_ISLANDS)];

// Fill in the defaults, then flatten every field the height loop touches into
// typed arrays.
//
// This looked like premature optimisation and was not. The island objects are
// built in three places with three different field orders, so V8 gives them
// three hidden classes, and reading `isl.cliff` in the inner loop goes
// megamorphic: 142 islands cost 3.1 us a sample, which is ten times the entire
// noise budget and a four second mesh build. Structure-of-arrays reads the same
// shape every time. The grid below then means we usually touch three islands
// rather than 142.
const N = ISLANDS.length;
const IX = new Float64Array(N), IZ = new Float64Array(N);
// The unwarped, on-the-chart centre — what the wind exposure is measured from.
const IWX = new Float64Array(N), IWZ = new Float64Array(N);
const IR = new Float64Array(N), IH = new Float64Array(N);
const ICLIFF = new Float64Array(N), IDOME = new Float64Array(N);
const ICOS = new Float64Array(N), ISIN = new Float64Array(N), IINVE = new Float64Array(N);
const ILOBE = new Float64Array(N), ILOBEK = new Float64Array(N);
const ISX = new Float64Array(N), ISZ = new Float64Array(N);
const IRELIEF = new Float64Array(N), ITERRACE = new Float64Array(N), ISCREE = new Float64Array(N);
const ISHELF = new Float64Array(N), IBEACH = new Float64Array(N);
const IREACH = new Float64Array(N);
const IFLAT = new Uint8Array(N);
const IROT = new Uint8Array(N);
// Craters are rare enough that four parallel arrays of mostly zeroes beat a
// branch on an object reference.
const ICR = new Uint8Array(N);
const ICR_IN = new Float64Array(N), ICR_FL = new Float64Array(N);
const ICR_GA = new Float64Array(N), ICR_MO = new Float64Array(N);

function flattenIslands() {
for (let i = 0; i < N; i++) {
  const isl = ISLANDS[i];
  isl.cliff ??= 0.28;
  isl.elong ??= 1;
  isl.rot ??= 0;
  isl.lobe ??= 0.22;
  isl.lobeK ??= 1.2;
  isl.dome ??= 0.4;
  isl.relief ??= 1;
  isl.terrace ??= 0.3;
  isl.scree ??= 1;
  isl.shelfW ??= 0.4;
  isl.beach ??= 0.4;
  isl.bare ??= 0.3;
  isl.snow ??= 0;
  isl.flat ??= false;

  // Pre-warp the centre.
  //
  // The shape is evaluated in warped space, so an island defined at (1750,2500)
  // used to COME OUT 250 m away from there — and everything that reads
  // ISLANDS[i].x reads it as a world position: the chart labels, "Over Berk",
  // and findCraterFloor()'s sweep, which searches 0.32r of the table centre and
  // returns null if it misses. Running the centre through the same warp first
  // puts the island back under its own coordinates and costs six noise samples,
  // once, at load.
  const wc = warp(isl.x, isl.z);
  IX[i] = wc.x; IZ[i] = wc.z;
  IWX[i] = isl.x; IWZ[i] = isl.z;
  IR[i] = isl.r; IH[i] = isl.h;
  ICLIFF[i] = isl.cliff; IDOME[i] = isl.dome;
  ICOS[i] = Math.cos(isl.rot); ISIN[i] = Math.sin(isl.rot);
  IROT[i] = isl.rot !== 0 ? 1 : 0;
  IINVE[i] = 1 / isl.elong;
  ILOBE[i] = isl.lobe; ILOBEK[i] = isl.lobeK;
  IRELIEF[i] = isl.relief; ITERRACE[i] = isl.terrace; ISCREE[i] = isl.scree;
  ISHELF[i] = isl.shelfW; IBEACH[i] = isl.beach;
  IFLAT[i] = isl.flat ? 1 : 0;
  // Unique, stable offsets into noise space, so no two islands share an outline.
  ISX[i] = ((isl.x * 0.0173 + isl.z * 0.0071) % 97) + 13.7;
  ISZ[i] = ((isl.z * 0.0191 - isl.x * 0.0059) % 89) + 41.3;
  if (isl.crater) {
    ICR[i] = 1;
    ICR_IN[i] = isl.crater.inner; ICR_FL[i] = isl.crater.floor;
    ICR_GA[i] = isl.crater.gate;  ICR_MO[i] = isl.crater.mouth;
  }
  // Worst case the lobe noise pulls the coast out by 1/(1 - lobe), and the
  // shelf reaches shelfW beyond that. Outside this box the island cannot
  // contribute at all, which is what the grid below is built on.
  IREACH[i] = isl.r * (1 + isl.shelfW) / (1 - isl.lobe) + 40;   // +40 for `rim`
  isl._reach = IREACH[i];
}
}

// --- Broad phase ---------------------------------------------------------
// A uniform grid over the world in CSR form: one flat index array, one offset
// per cell. The domain warp can throw a sample 400 m outside the terrain, so
// the grid covers a margin and clamps rather than bounds-checking per sample.
const GRID_MIN = -6000, GRID_CELL = 320;
const GRID_N = Math.ceil((6000 - GRID_MIN) * 2 / GRID_CELL / 2);
const cellCount = new Int32Array(GRID_N * GRID_N);
const GRID_START = new Int32Array(GRID_N * GRID_N + 1);
let GRID_ITEMS = new Int32Array(0);
const cellOf = (v) => {
  const c = Math.floor((v - GRID_MIN) / GRID_CELL);
  return c < 0 ? 0 : c >= GRID_N ? GRID_N - 1 : c;
};
function buildGrid() {
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < N; i++) {
    const r = IREACH[i];
    const i0 = cellOf(IX[i] - r), i1 = cellOf(IX[i] + r);
    const j0 = cellOf(IZ[i] - r), j1 = cellOf(IZ[i] + r);
    for (let j = j0; j <= j1; j++) {
      for (let ii = i0; ii <= i1; ii++) {
        const c = j * GRID_N + ii;
        if (pass === 0) cellCount[c]++;
        else GRID_ITEMS[GRID_START[c] + (--cellCount[c])] = i;
      }
    }
  }
  if (pass === 0) {
    let total = 0;
    for (let c = 0; c < cellCount.length; c++) { GRID_START[c] = total; total += cellCount[c]; }
    GRID_START[cellCount.length] = total;
    GRID_ITEMS = new Int32Array(total);
  }
}
}

// ---------------------------------------------------------------------------
// The height field
// ---------------------------------------------------------------------------

/**
 * The coastline warp, at three scales.
 *
 * One warp gives you wobbly circles. A real coastline is fractal at every scale
 * at once — that is why you cannot measure the length of one — so this is the
 * island-scale drag that moves whole headlands, the bay-scale bite, and the
 * crinkle that makes the last hundred metres of shore ragged.
 */
const WARP = { x: 0, z: 0 };
function warp(x, z) {
  const a1 = x * 0.00062, b1 = z * 0.00062;
  const a2 = x * 0.0026,  b2 = z * 0.0026;
  const a3 = x * 0.0098,  b3 = z * 0.0098;
  WARP.x = x + noise2(a1 + 71.3, b1 - 12.7) * 310
             + noise2(a2 + 5.1, b2 + 31.4) * 74
             + noise2(a3 - 21.7, b3 + 4.3) * 15;
  WARP.z = z + noise2(a1 - 45.9, b1 + 88.1) * 310
             + noise2(a2 - 63.2, b2 - 9.8) * 74
             + noise2(a3 + 17.5, b3 - 55.6) * 15;
  return WARP;
}

/**
 * Polynomial smooth maximum. The island body and the sea shelf are two separate
 * surfaces and the land is whichever is higher; a hard Math.max between them
 * leaves a visible crease running right along the waterline, which is the one
 * place nobody will not look. k is the width of the blend in metres.
 */
function smax(a, b, k) {
  const t = clamp(0.5 + (a - b) / (2 * k), 0, 1);
  return lerp(b, a, t) + k * t * (1 - t);
}

export function terrainHeight(x, z) {
  const w = warp(x, z);
  const px = w.x, pz = w.z;

  // --- Which island are we on, and how far onto it ----------------------
  // Tallest wins, so overlapping islands merge into one landmass rather than
  // showing a seam.
  let land = 0, shelf = 0, flatness = 0;
  let winner = -1, near = -1;

  const cell = cellOf(pz) * GRID_N + cellOf(px);
  const from = GRID_START[cell], to = GRID_START[cell + 1];

  // Perturbs where the rim falls off, so cliffs grow buttresses and gullies
  // instead of being a smooth surface of revolution. Only worth paying for if
  // there is an island in this cell at all.
  const rim = from === to ? 0 : (ridged(x * 0.0026, z * 0.0026, 3) - 0.5) * 0.12;

  for (let k = from; k < to; k++) {
    const i = GRID_ITEMS[k];
    let dx = px - IX[i];
    let dz = pz - IZ[i];
    const reach = IREACH[i];
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;

    if (IROT[i]) {
      const t = dx * ICOS[i] + dz * ISIN[i];
      dz = dz * ICOS[i] - dx * ISIN[i];
      dx = t;
    }
    dz *= IINVE[i];

    const len = Math.sqrt(dx * dx + dz * dz);
    let d = len / IR[i] + rim;
    const shelfW = ISHELF[i];
    if (d > 1 + shelfW) continue;

    if (len > 1e-3) {
      // Sampling the noise around a circle is periodic in bearing for free, so
      // this is a fractal outline with no wrap seam and no atan2.
      const inv = 1 / len, kk = ILOBEK[i];
      const ux = dx * inv, uz = dz * inv;
      const lob = noise2(ux * kk + ISX[i], uz * kk + ISZ[i]) * 0.72
                + noise2(ux * kk * 2.9 + ISZ[i], uz * kk * 2.9 + ISX[i]) * 0.28;
      d *= 1 + lob * ILOBE[i];
    }

    // The drowned foot. This is what the ocean shoals and breaks waves on, and
    // why the water goes green before it goes white.
    if (d < 1 + shelfW) {
      const s = 1 - smoothstep(d, 1, 1 + shelfW);
      if (s > shelf) { shelf = s; near = i; }
    }
    if (d >= 1) continue;

    // Flat-ish to the rim, then a sheer drop, times a gentle interior falloff
    // so the massif has a summit region rather than a table top.
    const rimFall = 1 - smoothstep(d, 1 - ICLIFF[i], 1);
    let f = rimFall * (1 - IDOME[i] * d * d);
    let flat = IFLAT[i] ? rimFall : 0;

    if (ICR[i]) {
      // Dish the middle out. `bowl` is 0 across the floor and 1 by the time it
      // reaches the inside face of the rim, so multiplying by it turns the
      // island's dome into a ring without touching the outer cliff at all.
      const inner = ICR_IN[i];
      const bowl = smoothstep(d, inner - 0.2, inner + 0.06);
      f *= lerp(ICR_FL[i], 1, bowl);

      // The channel: one wedge of bearings where the rim is cut below the
      // waterline, so there is a way in at sea level as well as over the top,
      // and the bowl reads as a harbour rather than a quarry.
      let ang = Math.atan2(dz, dx) - ICR_GA[i];
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      const mouth = ICR_MO[i];
      const inWedge = 1 - smoothstep(Math.abs(ang), mouth * 0.45, mouth);
      // Only outside the floor: the cut is through the WALL, and it must not
      // drain the bowl it opens into.
      const throughWall = smoothstep(d, inner - 0.04, inner + 0.16);
      f = Math.max(0, f * (1 - inWedge * throughWall * 1.06));

      // The floor is a floor — you land a dragon and stand a fortress on it —
      // so relief is off inside and left on across the rim.
      flat = Math.max(flat, 1 - bowl);
    }

    const contribution = IH[i] * f;
    if (contribution > land) {
      land = contribution;
      winner = i;
      flatness = flat;
    }
  }

  // --- Sea floor --------------------------------------------------------
  // Two components on purpose. The fBm is the abyssal relief; the ridged term
  // is the banks and trenches, and it is the reason the open water between the
  // island groups is not one uniform navy sheet from the air.
  const basin = fbm(x * 0.00042, z * 0.00042, 4);
  const banks = ridged(x * 0.00085 + 300, z * 0.00085 - 210, 3);
  let h = SEA_FLOOR + basin * 66 + (banks - 0.42) * 74;

  if (shelf > 0) {
    // Ramps from about -40 m at the outer edge of the shelf to -5 at the coast,
    // wandering by a few metres so the surf line has deep gaps and shallow bars
    // in it rather than being one constant-depth ring. This gradient is what
    // the ocean shader shoals and breaks waves against; a flat bench gives you
    // a coast with a hard edge and no white on it at all.
    // The ceiling here is the thing that matters and it used to be wrong. At
    // -41 + 36 + 7 the shelf could top out at +2 m, which means the drowned
    // foot of an island — a feature that exists specifically to be underwater —
    // was surfacing as a broad flat bench a metre either side of sea level.
    // That is where the awash grey plateaux came from, and the surf band and
    // the water's translucency both key off depth, so it also painted them
    // white and then let the rock show through. The shelf now cannot reach
    // higher than -5 m under any combination of shelf and noise. Beaches come
    // from the wave-cut bench below, which needs land to work on.
    const top = -44 + shelf * 33 + noise2(x * 0.0016 + 9.4, z * 0.0016 - 3.3) * 6;
    if (top > h) h = lerp(h, top, shelf * shelf * (3 - 2 * shelf));
  }

  if (land > 0) {
    const i = winner;
    // The island's own body, measured from the SEA FLOOR — which is what `h`
    // in the island table means, and why h: 300 comes out around +110 m.
    // Combined with the shelf by a smooth max rather than added to it: they
    // are two surfaces and the land is whichever is higher, and adding them
    // would put every summit 170 m too high.
    const rn = ridged(x * 0.0021, z * 0.0021, 3);
    const bn = fbm(x * 0.0014, z * 0.0014, 3) * 0.5 + 0.5;
    const relief = rn * 0.5 + bn * 0.5;   // see the frequency ceiling below
    // Calibrated, not guessed. ridged() over five octaves has mean 0.28 and
    // tops out around 0.84, so this puts the valley floors of an island at
    // 0.62 of its `h` and its crests just over 1.0 — which is what makes `h`
    // mean roughly what the table says it means, and what keeps the interior
    // valleys of a 360 m island from flooding.
    const shape = lerp(
      Math.min(1.15, 0.62 + 0.52 * relief * IRELIEF[i]),
      // A plateau is a plateau. Leaving even a fifth of the relief in put 10 m
      // of rock across the 24 m of Hollow Stack he has to walk between the
      // shelter and the lab, and the same term is what the crater floor stands
      // on, so both want this nearly constant.
      0.865 + 0.055 * relief,
      flatness);
    let body = SEA_FLOOR + land * shape;

    const solid = 1 - flatness;
    if (solid > 0.02) {
      // Drainage. A ridged fractal on its own reads as crumpled paper because
      // nothing has ever run downhill on it. This cuts V-valleys where a
      // low-frequency line noise crosses zero, which is where the water would
      // be — and it is why the bays are at the ends of the valleys.
      const riverN = fbm(x * 0.00085 + 11.3, z * 0.00085 - 4.7, 3)
                   + fbm(x * 0.0031 - 60.2, z * 0.0031 + 22.5, 2) * 0.18;
      const cut = Math.max(0, 1 - Math.abs(riverN) * 5.5);
      body -= cut * cut * 44 * solid * Math.min(1, land / 300);

      // Crags, scaled by how high the land is, so peaks come out broken and
      // jagged while the shoreline stays comparatively even.
      //
      // THE FREQUENCY CEILING. The terrain mesh is 20.8 m per quad, and the
      // highest frequency any ridged() call reaches is base * 2.07^(octaves-1).
      // Anything past about 0.011 — a 90 m feature, four quads — has nowhere to
      // be sampled and comes out as one-vertex noise. The first version of this
      // had a 27 m term in it and every island in the archipelago looked like a
      // row of shark teeth from the air.
      //
      // So: base * 2.07^(n-1) <= 0.011, for every ridged() in this function.
      // Detail finer than that is the ground material's job now — its normal
      // maps are triplanar and have no resolution limit, and cost nothing.
      // The amplitude has to stay well under the wavelength or the crags stop
      // being crags: at +-77 m over a 110 m feature the first version put a row
      // of spikes along every ridge line. Half that reads as broken rock.
      const craggy = (0.22 + 0.78 * Math.min(1.15, land / 560)) * solid * ISCREE[i];
      body += (ridged(x * 0.0044, z * 0.0044, 2) - 0.44) * 16 * craggy;
    }

    // Strata. Basalt country is a stack of lava flows and it weathers in steps
    // — the Faroes, Skye, the Giant's Causeway. Terracing the height field is
    // the whole trick, and it is what stops a sea cliff reading as a slope with
    // a rock texture painted on it.
    // Scaled by `solid`, so the strata stop at the plateau edge and at the
    // lip of the crater. A 17 m step through the middle of the camp on Hollow
    // Stack is not a stratum, it is a wall between the shelter and the lab.
    const terr = ITERRACE[i] * solid;
    if (terr > 0.02 && body > 0) {
      const step = 34 + noise2(x * 0.0007 - 40, z * 0.0007 + 12) * 11;
      const q = body / step;
      const fl = Math.floor(q), fr = q - fl;
      const stepped = (fl + smoothstep(fr, 0.30, 0.88)) * step;
      // Faded out near the water so the steps do not fight the wave-cut bench
      // below, and again at altitude where scree and snow take over.
      const band = smoothstep(body, 8, 60) * (1 - smoothstep(body, 320, 490));
      body = lerp(body, stepped, terr * band * 0.62);
    }

    h = smax(body, h, 22);
  }

  // --- The shore --------------------------------------------------------
  // A wave-cut bench. A coast is not the interior slope carried on down to the
  // water: waves plane a bench at their own working level and everything within
  // a few metres of sea level gets pulled toward it. That is where the beaches
  // come from, and it also gives the surf somewhere shallow to break, so it
  // pays for itself twice.
  const owner = winner >= 0 ? winner : near;
  if (owner >= 0 && h > -20 && h < 26) {
    // Windward coasts get plunging cliffs, lee coasts get sand — the same
    // reason the west of Scotland is rock and the east is beach. Smoothstepped
    // rather than a sign test, or the changeover is a straight line across the
    // island.
    const ex = ((x - IWX[owner]) * WIND_X + (z - IWZ[owner]) * WIND_Z) / IR[owner];
    const bandNoise = noise2(x * 0.0011 + 55.1, z * 0.0011 - 17.6);
    const beachiness = clamp(
      IBEACH[owner] * (0.5 + bandNoise * 0.62) + smoothstep(ex, -0.55, 0.55) * 0.34 - 0.14,
      0, 1);
    const pull = (1 - Math.abs(h - 2.5) / 22) * beachiness * 0.62;
    if (pull > 0) h -= (h - 2.5) * pull;
  }

  // --- Steepen the first few metres of water ----------------------------
  // Everything above works in world height, and world height does not care
  // that this engine has a band it cannot render. The sea goes translucent in
  // the last two metres, the surf band whitens the last two and a half, and the
  // wave geometry is built from a heightfield sampled twenty metres apart. Any
  // ground that lies FLAT within about a metre of sea level therefore comes out
  // as a hard-edged grey plate under milky water with the wave troughs cutting
  // through it — and a shallow gradient turns one metre of height into two
  // hundred metres of that.
  //
  // So the sea floor gets a steeper approach: depth is scaled by up to 2.5x
  // right at the waterline, tapering out over about fifteen metres. Same
  // coastline, same islands, roughly half the horizontal width of the band the
  // renderer struggles with, and it reads as a wave-cut notch, which is what a
  // rock coast in a swell actually has.
  //
  // Deliberately one-sided. Applying the same curve above the waterline would
  // lift every beach, dock, boat and building that places.js has already stood
  // on the ground — this touches water and nothing else, so nothing that was
  // placed on land can move.
  if (h < SEA_LEVEL && h > SEA_LEVEL - SHOAL_TAPER * 2.8) {
    const d = SEA_LEVEL - h;
    h = SEA_LEVEL - d * (1 + SHOAL_STEEP * Math.exp(-(d * d) / (SHOAL_TAPER * SHOAL_TAPER)));
  }

  return h;
}

flattenIslands();
buildGrid();

// ---------------------------------------------------------------------------
// Helpers everything downstream shares, so the mesh colours, the trees, the
// grass and the surf all agree about what a place is.
// ---------------------------------------------------------------------------

/** Surface normal by central difference. Four extra samples — load time only. */
export function terrainNormal(x, z, eps = 6, out = { x: 0, y: 1, z: 0 }) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len; out.y = ny / len; out.z = nz / len;
  return out;
}

/** Slope as 0 (flat) .. 1 (vertical-ish), matching the material's own measure. */
export function terrainSlope(x, z, eps = 6) {
  const n = terrainNormal(x, z, eps);
  return Math.min(1, (1 - n.y) * 2.6);
}

// A second broad phase, this one over the UNWARPED centres, because islandAt is
// asked about chart positions rather than shape-space ones — and because it is
// called once per terrain vertex and once per scattered tree, which at 142
// islands is 33 million distance tests it does not need to do.
const OWN_START = new Int32Array(GRID_N * GRID_N + 1);
let OWN_ITEMS = new Int32Array(0);
{
  const count = new Int32Array(GRID_N * GRID_N);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const isl = ISLANDS[i], r = isl.r * 1.2;
      const i0 = cellOf(isl.x - r), i1 = cellOf(isl.x + r);
      const j0 = cellOf(isl.z - r), j1 = cellOf(isl.z + r);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const c = j * GRID_N + ii;
        if (pass === 0) count[c]++;
        else OWN_ITEMS[OWN_START[c] + (--count[c])] = i;
      }
    }
    if (pass === 0) {
      let total = 0;
      for (let c = 0; c < count.length; c++) { OWN_START[c] = total; total += count[c]; }
      OWN_START[count.length] = total;
      OWN_ITEMS = new Int32Array(total);
    }
  }
}

/** Which island, if any, owns this point — for tree species and snow lines. */
export function islandAt(x, z) {
  const cell = cellOf(z) * GRID_N + cellOf(x);
  let best = null, bestD = 1e9;
  for (let k = OWN_START[cell]; k < OWN_START[cell + 1]; k++) {
    const isl = ISLANDS[OWN_ITEMS[k]];
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz) / (isl.r * 1.2);
    if (d < 1 && d < bestD) { bestD = d; best = isl; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The clearing
//
// Mission 1 goes into the wood on Peaceable Country to look for the place the
// hunters worked before they moved out to the caldera, and a clearing is the
// one thing that cannot be dressed on top of a forest: if the trees are still
// standing in it, it is not a clearing.
//
// So it lives here, in the file that owns the height field, for the same reason
// the island table does. `fertility()` reads it, and fertility is what the tree
// scatter, the terrain vertex colour, the ground-texture blend and the grass
// all read -- so the wood opens up, the ground goes bare and the grass stops,
// all from one number, and none of the four can disagree with the others about
// where the clearing is. Computed once at import from pure functions of (x, z),
// so it is the same clearing in the renderer, in the chart and in the story.
// ---------------------------------------------------------------------------

/** Radius of the opening, and of the ragged dying margin outside it. */
export const CLEARING_R = 96;
const CLEARING_EDGE = 168;

/**
 * The flattest dry patch in the middle band of an island: far enough in that
 * the wood closes behind you, not so far that it is the summit. `main.js`
 * stands the camp on this and `chapters.js` sends you looking for it.
 */
function findClearing(name) {
  const isle = ISLANDS.find((i) => i.name === name);
  if (!isle) return null;
  const nrm = { x: 0, y: 1, z: 0 };
  let best = null;
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    for (let rr = 0.22; rr < 0.62; rr += 0.03) {
      const x = isle.x + Math.cos(a) * rr * isle.r;
      const z = isle.z + Math.sin(a) * rr * isle.r;
      const h = terrainHeight(x, z);
      if (h < SEA_LEVEL + 12 || h > 150) continue;
      // The wood has to close behind you, so the whole opening and its dying
      // margin have to be on land. Without this the search runs downhill and
      // finds a spot on the shore, where half the clearing is sea and it
      // reads as a beach rather than as something that was done to a forest.
      let enclosed = true;
      for (let k = 0; k < 8 && enclosed; k++) {
        const b = (Math.PI * 2 * k) / 8;
        enclosed = terrainHeight(x + Math.cos(b) * 185, z + Math.sin(b) * 185)
          > SEA_LEVEL + 10;
      }
      if (!enclosed) continue;
      let rough = 0;
      for (const [dx, dz] of [[34, 0], [-34, 0], [0, 34], [0, -34],
                              [24, 24], [-24, -24], [24, -24], [-24, 24]]) {
        rough += Math.abs(terrainHeight(x + dx, z + dz) - h);
      }
      terrainNormal(x, z, 8, nrm);
      // Flat first, then low: a camp wants somewhere to stand and a downhill
      // run to the water to drag a cage along, not a view.
      const score = rough + (1 - nrm.y) * 260 + h * 0.12;
      if (!best || score < best.score) best = { x, z, h, score, isle };
    }
  }
  return best;
}

export const CLEARING = findClearing("Peaceable Country");

/**
 * How readily this spot grows things, 0..1. Trees, grass and the terrain's
 * green all read this one function so a bare crag is bare in all three.
 */
export function fertility(x, z, h, slope) {
  if (h < SEA_LEVEL + 4 || h > 350) return 0;
  const isl = islandAt(x, z);
  const bare = isl ? isl.bare : 0.5;
  // Patchiness rides ON TOP of a floor instead of replacing it.
  //
  // Centred on 0.5, this term alone halved every island's fertility — and
  // because three systems read this one number, that landed three times over:
  // the trees thinned to one every sixty metres, `wVeg` in terrainmat never
  // got strong enough to show the grass texture, and the forest-floor layer,
  // which only starts blending in above 0.45, never engaged at all. Berk is
  // declared `bare: 0.15`, "forested to the tree line", and came out as brown
  // scrub with the occasional lone conifer on it.
  const patch = 0.62 + 0.38 *
    (fbm(x * 0.0013 + 3.1, z * 0.0013 - 8.8, 3) * 0.5 + 0.5);
  // Bare now curves rather than scaling flat, so the two ends of the island
  // table separate: `bare: 0.15` is thick wood and `bare: 0.85` is still
  // scoured lava, where the old linear `1 - bare * 0.9` left the forested
  // islands at 0.87 of a number that was already halved.
  let f = Math.pow(1 - bare, 1.15) * patch;
  // Conifers root on ground you would need hands to climb. The old cutoff put
  // the tree line at about 42 degrees, which on a relief-1.0 island is most of
  // it, so the wood was pushed off the hills and onto the valley floors.
  f *= 1 - smoothstep(slope, 0.46, 0.88);
  f *= smoothstep(h, 4, 22);                   // above the beach
  f *= 1 - smoothstep(h, 215, 335);            // below the tree line
  if (CLEARING) {
    // Burnt out in the middle, dying at the edge, wood again beyond it. The
    // margin is wide on purpose: a clearing that ends on a circle reads as a
    // hole punched in a texture, and this one has to read as something that
    // was done to the wood.
    const d = Math.hypot(x - CLEARING.x, z - CLEARING.z);
    f *= 0.04 + 0.96 * smoothstep(d, CLEARING_R, CLEARING_EDGE);
  }
  return clamp(f * 1.25, 0, 1);
}
