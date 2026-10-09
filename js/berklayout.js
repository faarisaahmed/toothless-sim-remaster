// ---------------------------------------------------------------------------
// Berk, as in the films: where everything is.
//
// Berk is grown like every other island (terrain.js naturalHeight: the same
// crags, gullies, strata and ragged coast), and then only a few things are
// worked into it, all from this table and all shaped by noise so that nothing
// comes out ruler-straight:
//
//   terrain.js   bites the harbour cove into the south coast, throws two rock
//                arms out round its mouth, stands the statue plinths, the rock
//                the village climbs and the sea stacks, heaves up the mountain
//                behind the village, sets the Great Hall's shelf and its stair
//                into that mountainside, and levels a small plot under every
//                house that placeVillage() (below) finds room for;
//   berk.js      stands the statues, the hall, the houses, the wharves and
//                the paths on exactly those heights.
//
// Change a number here and both follow. Nothing in here may import terrain.js
// (terrain.js imports this, and so do its workers, so no three.js either).
//
// The numbers are written for Berk centred at AUTHORED below, in world metres.
// If Berk moves (terrain.js BERK, through worldscale.js), every table is
// shifted by where it is now, once, at the bottom of this file. Read positions
// from these tables; never type them into other code.
//
// He spawns south of Berk, pointed north at it (terrain.js SPAWN_XZ), so the
// harbour opens SOUTH and is the first thing he sees: the two statues at the
// mouth with their fires, the cove behind them with the village climbing the
// hills on both sides and up the great rock on the east shore, and at the
// head of the cove the long stair up the mountainside to the Great Hall.
// ---------------------------------------------------------------------------

// The harbour: a natural cove. Its water follows a bent spine from the open
// sea in through the mouth to the head; `hw` is the half-width of the water
// at each spine point. terrain.js warps the outline with noise, so the shore
// wanders tens of metres either side of this, and lets the hills come down
// to it at a slope that changes as you go round.
export const HARBOUR = {
  spine: [
    { x: -40, z: -1240, hw: 230 },    // out at sea, in front of the mouth
    { x: -30, z: -1470, hw: 125 },    // the mouth, between the statues
    { x: -10, z: -1700, hw: 215 },
    { x: 15, z: -1960, hw: 250 },
    { x: -35, z: -2200, hw: 190 },
    { x: -70, z: -2360, hw: 85 },     // the head, under the hall
  ],
  floor: -24,                         // depth in the middle of the cove
  quayH: 3,                           // the shore shelf the wharves stand on
  quayW: 24,                          // how wide that shelf runs, where it runs
};

// The two statues at the mouth: Vikings with fire braziers held up, each on
// a rock plinth rising out of the sea at the end of a headland, facing the
// open sea (south, +z). `h` is the statue's height above the plinth top.
export const STATUES = [
  { x: -205, z: -1480, plinthR: 40, plinthH: 18, h: 120, facing: 0 },
  { x: 145, z: -1480, plinthR: 40, plinthH: 18, h: 120, facing: 0 },
];

// The arms of rock either side of the mouth: ridges from the hills out to
// the statues, sheer to the sea, crest heights in metres.
export const HEADLANDS = [
  { a: { x: -640, z: -1980 }, b: { x: -250, z: -1500 }, r: 150, h: 92 },
  { a: { x: 430, z: -2020 }, b: { x: 195, z: -1500 }, r: 140, h: 84 },
];

// The mountain behind the village, heaved up under the natural ground (which
// keeps all its crags on top). Elliptical, radii rx/rz, h at its middle.
export const MOUNTAIN = { x: -60, z: -3480, rx: 1250, rz: 820, h: 320 };

// The great rock on the east shore that the village climbs, as Berk's does
// in the second film: a craggy stack with ledges round it, joined to the
// shore by a saddle. `r` at sea level, `topR` its crown.
export const ROCK = { x: 205, z: -2060, r: 150, topR: 55, h: 225, step: 52, saddle: { x: 400, z: -2100, h: 95 } };

// Sea stacks off the coast.
export const SEA_STACKS = [
  { x: -820, z: -1150, r: 62, h: 150 },
  { x: 560, z: -1170, r: 56, h: 104 },
];

// The Great Hall, set into the mountainside at the head of the cove: its
// shelf (pad, half-extents across and along the hall, with a plaza in front)
// is cut back into the slope, so the mountain goes on rising behind its roof.
// Doors face `rot` (0 = south, toward the harbour).
export const HALL = {
  x: -20, z: -2790, h: 182, rot: 0,
  len: 96, wid: 40, roofH: 44,
  pad: { ax: 54, az: 72, round: 30, edge: 26 },
  // The crag the shelf is cut into: rock heaved up `back` metres behind the
  // hall, so the cut face rises straight off the back of its roof.
  crag: { back: 135, r: 210, h: 210 },
};

// The Great Stair: from the head of the cove up to the hall's plaza, in
// flights with landings. y is the ground the steps sit on at each point.
export const STAIR = {
  width: 12,
  combe: 230,                         // how far either side of it the valley it climbs reaches
  pts: [
    { x: -70, z: -2378, y: 3.5 },
    { x: -34, z: -2490, y: 60 },
    { x: -50, z: -2600, y: 120 },
    { x: -20, z: -2712, y: 182 },
  ],
};

// A burn off the western hills, down the gully that is there anyway, and
// over the lip (its last point) in a fall to the cove. terrain.js finds its
// bed on the ground at load and cuts a channel for it; berkland.js runs the
// water and the fall.
export const STREAM = {
  w: 10,
  pts: [
    { x: -640, z: -2300 }, { x: -560, z: -2318 }, { x: -500, z: -2330 },
    { x: -440, z: -2318 }, { x: -390, z: -2312 }, { x: -340, z: -2310 },
  ],
};

// The village: where houses may go. An ellipse round the cove; placeVillage
// scatters houses in it by the rule there, denser by the water and thinning
// up the hills. maxH is where the houses give out.
export const VILLAGE = {
  cx: -30, cz: -2020, rx: 780, rz: 650,
  maxH: 215,
  // Where it is thickest: round the head of the cove, the east shore by the
  // rock and the west shore inside the mouth. Houses bunch toward these.
  cores: [{ x: -60, z: -2330, r: 230 }, { x: 250, z: -1730, r: 170 }, { x: -330, z: -1880, r: 200 }, { x: 205, z: -2060, r: 170 }],
  // A box round everything Berk works into the ground, for cheap tests.
  minX: -1350, maxX: 1230, minZ: -4340, maxZ: -1060,
};

// Footprints of the house kinds berk.js builds (berkhouses.js ARCHETYPES has
// the same names; keep these in step). L along the ridge, W across it.
export const HOUSE_KINDS = {
  cottage: { L: 12, W: 8, w: 4 },
  longhouse: { L: 21, W: 9, w: 2.2 },
  tall: { L: 11, W: 9, w: 1.4 },
  turf: { L: 10, W: 7, w: 3.2 },
  hallhouse: { L: 17, W: 11, w: 1.1 },
  shed: { L: 9, W: 6, w: 1.4 },
  stilt: { L: 13, W: 8, w: 0 },       // only where the hill falls away
};

// Filled by placeVillage (terrain.js calls it at load, with its own height).
// PLOTS: { x, z, h, yaw, kind, s, r, stilt }  — r is the levelled radius;
//        kind is a HOUSE_KINDS name, or "square" for an open square.
// PATHS: { a: {x,z}, b: {x,z} }               — door to door, down to the water.
export const PLOTS = [];
export const PATHS = [];

// --- Where Berk is now -------------------------------------------------------
// terrain.js BERK: Berk's old-chart centre (0, -1300) through chart().
import { CHART_SCALE } from "./worldscale.js";
const AUTHORED = { x: 0, z: -5850 };
export const BERK_CENTRE = { x: 0 * CHART_SCALE, z: -1300 * CHART_SCALE };
const DX = BERK_CENTRE.x - AUTHORED.x, DZ = BERK_CENTRE.z - AUTHORED.z;
(function shift(o) {
  if (Array.isArray(o)) { o.forEach(shift); return; }
  if (!o || typeof o !== "object") return;
  if (typeof o.x === "number" && typeof o.z === "number") { o.x += DX; o.z += DZ; }
  if (typeof o.cx === "number" && typeof o.cz === "number") { o.cx += DX; o.cz += DZ; }
  if (typeof o.minX === "number") { o.minX += DX; o.maxX += DX; o.minZ += DZ; o.maxZ += DZ; }
  for (const k in o) if (o[k] && typeof o[k] === "object") shift(o[k]);
})([HARBOUR, STATUES, HEADLANDS, MOUNTAIN, ROCK, SEA_STACKS, HALL, STAIR, STREAM, VILLAGE]);

/** Distance from (x, z) to the segment a–b, and how far along it (0..1). */
export function segDist(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(x - a.x - dx * t, z - a.z - dz * t), t };
}

/** Is (x, z) inside the box round everything Berk works into the ground? */
export function inVillage(x, z, pad = 0) {
  return x > VILLAGE.minX - pad && x < VILLAGE.maxX + pad && z > VILLAGE.minZ - pad && z < VILLAGE.maxZ + pad;
}

/** The line the stream's fall takes from its lip, on toward the water. */
export function streamFall(reach = 200) {
  const P = STREAM.pts, a = P[P.length - 1], b = P[P.length - 2];
  const L = Math.hypot(a.x - b.x, a.z - b.z);
  const ux = (a.x - b.x) / L, uz = (a.z - b.z) / L;
  return { a, b: { x: a.x + ux * reach, z: a.z + uz * reach }, ux, uz };
}

/** Distance from (x, z) to the harbour's spine, and the water's half-width there. */
export function harbourSpine(x, z) {
  const S = HARBOUR.spine;
  let best = 1e9, hw = 0, t = 0;
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    let u = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
    if (d < best) { best = d; hw = a.hw + (b.hw - a.hw) * u; t = (i + u) / (S.length - 1); }
  }
  return { d: best, hw, t };
}

// ---------------------------------------------------------------------------
// Where the houses go.
//
// Not rows. A jittered field of candidate spots over the village, each kept
// or dropped by a rule a builder would follow: not in the water or on the
// stair or the hall's shelf, not on ground too steep to dig a plot into
// (steeper than ~40 degrees, a house stands on stilts out over the drop
// instead, and past ~50 nothing does), more of them near the water and fewer
// up the hill, and in clusters -- a low-frequency noise decides where the
// farmsteads bunch and where the hillside is left to grass and trees. A spot
// is taken if the house fits without touching its neighbours. Each house lies
// along the contour with its door downhill, give or take.
//
// Then the paths: every house is joined to its nearest neighbour that is
// nearer the water, so they run together downhill into lanes, and the lowest
// ones to the shore -- the way paths grow, not the way they are planned.
//
// heightAt(x, z) is the ground before any plot is levelled; noise(x, z) is
// terrain.js's simplex, -1..1. Deterministic: no Math.random.
// ---------------------------------------------------------------------------
export function placeVillage(heightAt, noise) {
  PLOTS.length = 0; PATHS.length = 0;
  let seed = 90210;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const V = VILLAGE;
  const kinds = Object.entries(HOUSE_KINDS).filter(([, k]) => k.w > 0);
  const kindSum = kinds.reduce((s, [, k]) => s + k.w, 0);
  const pickKind = (big) => {
    let t = rnd() * kindSum;
    for (const [n, k] of kinds) { t -= k.w * (big && (n === "longhouse" || n === "hallhouse") ? 1.8 : 1); if (t <= 0) return n; }
    return "cottage";
  };
  const stairNear = (x, z, m) => {
    for (let i = 0; i < STAIR.pts.length - 1; i++) if (segDist(x, z, STAIR.pts[i], STAIR.pts[i + 1]).d < STAIR.width / 2 + m) return true;
    return false;
  };
  const hallNear = (x, z, m) => {
    const c = Math.cos(HALL.rot), s = Math.sin(HALL.rot);
    const lx = (x - HALL.x) * c - (z - HALL.z) * s, lz = (x - HALL.x) * s + (z - HALL.z) * c;
    return Math.abs(lx) < HALL.pad.ax + m && Math.abs(lz) < HALL.pad.az + m;
  };
  const fall = streamFall();
  const streamNear = (x, z, m) => {
    const P = STREAM.pts;
    for (let i = 0; i < P.length - 1; i++) if (segDist(x, z, P[i], P[i + 1]).d < STREAM.w / 2 + m) return true;
    return segDist(x, z, fall.a, fall.b).d < STREAM.w + m;
  };

  // Candidates, scored and shuffled.
  const SP = 11;
  const cand = [];
  for (let gz = V.cz - V.rz; gz <= V.cz + V.rz; gz += SP) {
    for (let gx = V.cx - V.rx; gx <= V.cx + V.rx; gx += SP) {
      const x = gx + (rnd() - 0.5) * SP * 0.9, z = gz + (rnd() - 0.5) * SP * 0.9;
      // The village's own edge is ragged.
      const ex = (x - V.cx) / V.rx, ez = (z - V.cz) / V.rz;
      const e = Math.hypot(ex, ez) + noise(x * 0.004 + 3.3, z * 0.004 - 1.1) * 0.22;
      if (e > 1) continue;
      const h = heightAt(x, z);
      const onRock = Math.hypot(x - ROCK.x, z - ROCK.z) < ROCK.r;
      if (h < HARBOUR.quayH - 0.4 || h > (onRock ? ROCK.h + 15 : V.maxH)) continue;
      // Down on the shore shelf: boathouses and stores, back from the edge.
      let bench = false;
      if (h < HARBOUR.quayH + 1.5) {
        if (Math.min(heightAt(x + 10, z), heightAt(x - 10, z), heightAt(x, z + 10), heightAt(x, z - 10)) < 1) continue;
        bench = true;
      }
      if (stairNear(x, z, 12) || hallNear(x, z, 10) || streamNear(x, z, 14)) continue;
      let near = false;
      for (const S of STATUES) if (Math.hypot(x - S.x, z - S.z) < S.plinthR + 25) near = true;
      if (near) continue;
      // Density: clusters, the water, the height; then the slope, which
      // only ever thins it, so most spots are turned away before it is
      // measured (four more heights each).
      const hs = harbourSpine(x, z);
      const shore = Math.max(0, hs.d - hs.hw);
      const cl = noise(x * 0.0065 + 11.2, z * 0.0065 - 4.7) * 0.7 + noise(x * 0.019 - 2.2, z * 0.019 + 8.1) * 0.3;
      let p = 1.3 * (cl < -0.1 ? 0 : cl > 0.4 ? 1 : (cl + 0.1) / 0.5);
      p *= 1.5 - Math.min(1, shore / 420) * 0.95;
      if (!onRock) p *= 1 - Math.max(0, (h - 110) / (V.maxH - 110)) * 0.8;
      p *= 1 - Math.max(0, e - 0.75) * 2.6;
      let core = 0;
      for (const C of V.cores) { const dc = Math.hypot(x - C.x, z - C.z); if (dc < C.r) core += 0.9 * (1 - dc / C.r); }
      const roll = rnd();
      if ((bench ? Math.max(p + core, 0.5) : p + core) < roll) continue;
      const gx2 = (heightAt(x + 5, z) - heightAt(x - 5, z)) / 10;
      const gz2 = (heightAt(x, z + 5) - heightAt(x, z - 5)) / 10;
      const slope = Math.hypot(gx2, gz2);
      if (slope > 1.2) continue;
      if (slope > 0.75) p *= 0.6;
      p += core;
      if (bench) p = Math.max(p, 0.5);
      if (p <= 0 || roll > p) continue;
      let wx = 0, wz = 0;
      if (bench) {
        // Which way is the water: the lowest ground a little way off.
        let lo = 1e9;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, hh = heightAt(x + Math.sin(a) * 24, z + Math.cos(a) * 24);
          if (hh < lo) { lo = hh; wx = Math.sin(a); wz = Math.cos(a); }
        }
      }
      cand.push({ x, z, h, gx: bench ? -wx : gx2, gz: bench ? -wz : gz2, slope: bench ? 0 : slope, shore, bench, pr: rnd() + shore / 800 - (cl > 0.3 ? 0.3 : 0) });
    }
  }
  cand.sort((a, b) => a.pr - b.pr);

  // Spatial hash for the spacing test.
  const CELL = 32, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  const fits = (x, z, r) => {
    const i0 = Math.floor((x - r - 30) / CELL), i1 = Math.floor((x + r + 30) / CELL);
    const j0 = Math.floor((z - r - 30) / CELL), j1 = Math.floor((z + r + 30) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const L = grid.get(key(i, j));
      if (L) for (const p of L) if (Math.hypot(x - p.x, z - p.z) < r + p.r + 2.5) return false;
    }
    return true;
  };
  const claim = (x, z, r) => {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (!grid.has(key(i, j))) grid.set(key(i, j), []);
    grid.get(key(i, j)).push({ x, z, r });
  };

  // First the squares: the most level open ground near each core, kept for
  // a feeding station and a fire, before any house can take it.
  const hub = HARBOUR.spine[Math.floor(HARBOUR.spine.length / 2)];
  for (const C of V.cores) {
    let best = null;
    for (let r = 0; r < C.r * 0.75; r += 9) {
      for (let k = 0; k < (r ? 16 : 1); k++) {
        const a = k / 16 * Math.PI * 2;
        const x = C.x + Math.sin(a) * r, z = C.z + Math.cos(a) * r;
        const h = heightAt(x, z);
        if (h < HARBOUR.quayH + 2 || h > 170) continue;
        if (stairNear(x, z, 16) || hallNear(x, z, 16) || streamNear(x, z, 16)) continue;
        let lo = h, hi = h;
        for (let q = 0; q < 8; q++) { const g = heightAt(x + Math.sin(q * 0.785) * 12, z + Math.cos(q * 0.785) * 12); lo = Math.min(lo, g); hi = Math.max(hi, g); }
        const score = hi - lo + r * 0.01;
        if (!best || score < best.score) best = { x, z, h, score };
      }
    }
    if (!best || best.score > 9) continue;
    const yaw = Math.atan2(hub.x - best.x, hub.z - best.z);
    PLOTS.push({ x: best.x, z: best.z, h: best.h, yaw, kind: "square", s: 1, r: 15, stilt: false, shore: Math.max(0, harbourSpine(best.x, best.z).d - harbourSpine(best.x, best.z).hw) });
    claim(best.x, best.z, 15);
  }

  for (const c of cand) {
    const stilt = c.slope > 0.8;
    const kind = stilt ? "stilt" : c.bench ? (rnd() < 0.55 ? "shed" : rnd() < 0.5 ? "longhouse" : "cottage") : pickKind(c.shore < 80);
    const K = HOUSE_KINDS[kind];
    const s = 0.95 + rnd() * 0.3;
    const r = Math.hypot(K.L, K.W) * 0.5 * s + (stilt ? 3 : 1.5);
    if (!fits(c.x, c.z, r)) continue;
    // Along the contour, door downhill; now and then end-on to the slope.
    let yaw = Math.atan2(-c.gx, -c.gz) + (rnd() - 0.5) * 0.5;
    if (!stilt && c.slope < 0.35 && rnd() < 0.18) yaw += Math.PI / 2;
    // The plot is cut into the hill at the ground under its middle; a stilt
    // house stands out over the drop from its uphill edge.
    const h = stilt ? c.h + 0.0 : c.h;
    const p = { x: c.x, z: c.z, h, yaw, kind, s, r: stilt ? 5 : r, stilt, shore: c.shore };
    PLOTS.push(p);
    claim(c.x, c.z, r);
  }

  // Paths: each house to its nearest neighbour nearer the water.
  const door = (p) => {
    if (p.kind === "square") return { x: p.x, z: p.z };
    const K = HOUSE_KINDS[p.kind];
    const o = K.W * 0.5 * p.s + 3;
    return { x: p.x + Math.sin(p.yaw) * o, z: p.z + Math.cos(p.yaw) * o };
  };
  for (const p of PLOTS) p.door = door(p);
  for (const p of PLOTS) {
    let best = null, bd = 75;
    for (const q of PLOTS) {
      if (q === p || q.shore >= p.shore - 4) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) {
      // Not a ruled line: a path up a hill goes round it a little, and a
      // steep one doubles back on itself.
      const a = p.door, b = best.door;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const rise = Math.abs(heightAt(a.x, a.z) - heightAt(b.x, b.z));
      const off = (rnd() - 0.5) * 0.5 * L + (rise / L > 0.45 ? (rnd() < 0.5 ? -1 : 1) * 0.35 * L : 0);
      const m = { x: (a.x + b.x) / 2 - (b.z - a.z) / L * off, z: (a.z + b.z) / 2 + (b.x - a.x) / L * off };
      const clear = !PLOTS.some((q) => Math.hypot(q.x - m.x, q.z - m.z) < q.r + 2);
      if (L > 14 && clear) PATHS.push({ a, b: m }, { a: m, b });
      else PATHS.push({ a, b });
    }
    else if (p.shore < 70) {
      // Down to the shore: along the spine's normal toward the water.
      const hs = harbourSpine(p.door.x, p.door.z);
      let sx = 0, sz = 0;
      const S = HARBOUR.spine;
      let bd2 = 1e9;
      for (let i = 0; i < S.length - 1; i++) {
        const sd = segDist(p.door.x, p.door.z, S[i], S[i + 1]);
        if (sd.d < bd2) { bd2 = sd.d; sx = S[i].x + (S[i + 1].x - S[i].x) * sd.t; sz = S[i].z + (S[i + 1].z - S[i].z) * sd.t; }
      }
      const k = Math.max(0, hs.d - hs.hw + 4) / Math.max(1, hs.d);
      PATHS.push({ a: p.door, b: { x: p.door.x + (sx - p.door.x) * k, z: p.door.z + (sz - p.door.z) * k }, shore: true });
    }
  }
}
