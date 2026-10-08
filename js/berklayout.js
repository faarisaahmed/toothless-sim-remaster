// ---------------------------------------------------------------------------
// Berk, as in the films: where everything is.
//
// One table both halves of Berk read from, in world metres:
//   terrain.js   carves the harbour inlet, raises the spire, levels the
//                village terraces to exactly these heights, stands the sea
//                stack and the statue plinths, and builds the interior mesas;
//   berk.js      stands the statues, the Great Hall, the houses, docks,
//                towers, catapults and feeding stations ON those heights.
// Change a number here and both follow. Nothing in here may import terrain.js.
//
// The island: centre (0, -3900), about 4.8 km across, long axis north-south.
// He spawns at (0, 300, 2700), south of it and pointed at it, so the harbour
// is cut into the SOUTH coast and is the first thing he sees: the two statues
// at the mouth, the inlet running north between village-covered cliffs, and
// the spire with the Great Hall standing at its head. Behind the village the
// island rises into the interior: sandstone mesas with forest on their tops,
// layered cliffs, waterfalls into rivers and pools.
// ---------------------------------------------------------------------------

// The harbour: a long inlet. Water (h < 0) from the mouth to the head, with a
// quay shelf just above the sea along both sides.
export const HARBOUR = {
  mouth: { x: 0, z: 520 },       // the gap the statues guard
  head: { x: 0, z: -620 },       // where the inlet ends, at the foot of the spire
  halfWidth: 230,                // half-width of the water at the middle of the inlet
  mouthHalfWidth: 150,           // narrower between the statues
  floor: -22,                    // depth of the inlet
  quayH: 3.5,                    // the wharf shelf along both sides
  quayW: 26,                     // its width
};

// The two statues at the mouth: Vikings, each with a fire brazier held up.
// Each stands on a rock plinth rising out of the sea; facing the open sea
// (south, +z). `h` is the statue's height above the plinth top.
export const STATUES = [
  { x: -205, z: 560, plinthR: 38, plinthH: 18, h: 120, facing: 0 },
  { x: 205, z: 560, plinthR: 38, plinthH: 18, h: 120, facing: 0 },
];

// The spire: a tall rock pillar at the head of the harbour, sheer sides,
// its top levelled for the Great Hall, with a stair-road spiralling up it.
export const SPIRE = {
  x: 0, z: -830,
  baseR: 230,                    // footprint at sea level
  topR: 110,                     // levelled summit radius
  topH: 240,                     // summit height
  hall: { len: 120, wid: 46, h: 48, rot: 0 },   // the Great Hall, long axis N-S, doors south
};

// The village: terraces stepping up the cliffs on both sides of the inlet,
// and round the spire's shoulders. Each terrace is levelled ground (like
// terrain.js PADS): a rounded strip from a to b, `w` wide, at height h.
// berk.js lines the terraces with houses; the forest keeps off them.
const T = (x1, z1, x2, z2, w, h) => ({ a: { x: x1, z: z1 }, b: { x: x2, z: z2 }, w, h });
export const TERRACES = [
  // West flank, bottom to top.
  T(-290, 380, -300, -520, 70, 14),
  T(-390, 360, -410, -600, 70, 34),
  T(-500, 300, -520, -660, 80, 58),
  T(-620, 220, -640, -700, 90, 86),
  T(-750, 120, -770, -720, 100, 118),
  // East flank.
  T(290, 380, 300, -520, 70, 14),
  T(390, 360, 410, -600, 70, 34),
  T(500, 300, 520, -660, 80, 58),
  T(620, 220, 640, -700, 90, 86),
  T(750, 120, 770, -720, 100, 118),
  // Behind the spire: the upper town, between the two flanks.
  T(-520, -1120, 520, -1120, 110, 128),
  T(-680, -1300, 680, -1300, 120, 150),
];

// The village's whole footprint, for the forest and the grass to keep out of
// and for berk.js to scatter small things in.
export const VILLAGE = { minX: -880, maxX: 880, minZ: -1420, maxZ: 600 };

// The lone sea stack off the harbour mouth, to the west.
export const SEA_STACK = { x: -820, z: 1350, r: 70, h: 170 };

// The interior: north of the upper town. Sandstone mesas with forested tops,
// standing out of a lower valley floor; rivers between them and waterfalls off
// their sides into pools. All heights are the TOP of the mesa.
export const INTERIOR = {
  valleyH: 70,                   // valley floor between the mesas
  region: { minX: -2200, maxX: 2200, minZ: -7600, maxZ: -1800 },
  mesas: [
    { x: -1300, z: -2300, r: 260, h: 300 },
    { x: 1250, z: -2500, r: 300, h: 330 },
    { x: -400, z: -3100, r: 380, h: 380 },
    { x: 900, z: -3700, r: 240, h: 340 },
    { x: -1500, z: -3900, r: 320, h: 420 },
    { x: 200, z: -4600, r: 420, h: 460 },
    { x: -1100, z: -5300, r: 280, h: 400 },
    { x: 1300, z: -5200, r: 300, h: 430 },
    { x: -200, z: -6200, r: 360, h: 480 },
    { x: 1000, z: -6600, r: 240, h: 380 },
    { x: -1400, z: -6700, r: 250, h: 360 },
    { x: 1700, z: -4100, r: 180, h: 300 },
    { x: -800, z: -4300, r: 140, h: 330 },  // a needle
    { x: 600, z: -2900, r: 120, h: 280 },   // a needle
  ],
  // Natural arches: a span of rock between two points, its underside at h.
  arches: [
    { a: { x: -400, z: -3100 }, b: { x: 200, z: -4600 }, h: 220, w: 70 },
  ],
  // Rivers: polylines along the valley floor down to the sea (last point in
  // the water). Waterfalls: off a mesa edge at `top`, into a pool at `pool`.
  rivers: [
    // Routed round the mesas, not through them (the first draft ran both
    // rivers straight across the middle of a mesa); the first passes the pool
    // under the big mesa's waterfall, the second the pool under the west one.
    [{ x: 200, z: -6000 }, { x: 700, z: -5150 }, { x: 620, z: -4300 }, { x: 250, z: -3950 }, { x: 300, z: -3300 }, { x: 250, z: -2600 }, { x: 650, z: -1700 }, { x: 1300, z: -1400 }, { x: 1900, z: -900 }],
    [{ x: -1200, z: -6000 }, { x: -650, z: -5500 }, { x: -700, z: -4750 }, { x: -1150, z: -4550 }, { x: -1000, z: -3800 }, { x: -1300, z: -3350 }, { x: -1600, z: -3100 }, { x: -2200, z: -2600 }],
  ],
  waterfalls: [
    { x: 200, z: -4170, top: 460, pool: { x: 220, z: -4040, r: 70 }, w: 30 },
    { x: -1180, z: -3830, top: 420, pool: { x: -1050, z: -3800, r: 60 }, w: 22 },
    { x: -390, z: -2730, top: 380, pool: { x: -360, z: -2600, r: 60 }, w: 26 },
    { x: 1250, z: -2210, top: 330, pool: { x: 1240, z: -2080, r: 55 }, w: 18 },
  ],
};

/** Distance from (x, z) to the segment a–b, and how far along it (0..1). */
export function segDist(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(x - a.x - dx * t, z - a.z - dz * t), t };
}

/** Is (x, z) inside the village footprint (cheap box test)? */
export function inVillage(x, z, pad = 0) {
  return x > VILLAGE.minX - pad && x < VILLAGE.maxX + pad && z > VILLAGE.minZ - pad && z < VILLAGE.maxZ + pad;
}
