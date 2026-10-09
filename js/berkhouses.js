import * as THREE from "three";
import { Builder, TILE, gablePrism, taperTube, lathe } from "./berkkit.js";

// ---------------------------------------------------------------------------
// Berk's houses: a handful of archetypes, each built twice — a detailed one for
// the streets he walks and flies low over, and a block-and-roof one for the
// village seen from across the harbour. berk.js stamps them out by the
// hundred with InstancedMesh, so one archetype is one draw call however many
// of it there are, and the roof colour is per instance (aPaint faces).
//
// Local frame: long axis along x, the door on the +z wall, origin on the
// ground at the centre of the footprint.
// ---------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WOOD = 0xd6bc98, DARKW = 0x9a8068, STONEC = 0xb0aba2, WIN = 0x2a1a10;
// The footings are the hill's own dark stone, so a house reads as sitting on it.
const FOOTC = 0x777168;

export const ARCHETYPES = [
  // L, W, wall height, roof rise, roof kind, extras
  { name: "cottage",   L: 12, W: 8,  fh: 1.2, wallH: 4.2, roofH: 6.2, oh: 1.0, heads: true,  chimney: true },
  { name: "longhouse", L: 21, W: 9,  fh: 1.3, wallH: 4.6, roofH: 6.8, oh: 1.2, heads: true,  chimney: true, porch: true },
  { name: "tall",      L: 11, W: 9,  fh: 1.2, wallH: 8.6, roofH: 6.6, oh: 1.0, heads: true,  chimney: true, jetty: true },
  { name: "turf",      L: 10, W: 7,  fh: 0.8, wallH: 3.2, roofH: 3.6, oh: 0.8, heads: false, chimney: true, turf: true },
  { name: "stilt",     L: 13, W: 8,  fh: 0,   wallH: 4.2, roofH: 5.8, oh: 1.0, heads: true,  chimney: false, stilts: 9 },
  { name: "hallhouse", L: 17, W: 11, fh: 1.4, wallH: 5.2, roofH: 8.4, oh: 1.3, heads: true,  chimney: true, porch: true },
  { name: "shed",      L: 9,  W: 6,  fh: 0.6, wallH: 3.4, roofH: 3.4, oh: 0.9, heads: false, chimney: false, thatch: true },
];

/** The dragon-head finial at the top of a pair of crossed bargeboards. */
function dragonHead(b, base, out, side, s, opts) {
  // `out` is the direction away from the house along x; `side` which board.
  const P = (dx, dy, dz) => base.clone().add(V(out * dx * s, dy * s, side * dz * s));
  // A thick carved neck rising off the board, bending outward into a head
  // with a blunt snout, and one swept-back horn.
  const pts = [P(0, 0, 0), P(0.1, 0.9, 0.2), P(0.5, 1.6, 0.3), P(1.2, 1.85, 0.3), P(1.9, 1.7, 0.3)];
  b.add(taperTube(pts, [0.42 * s, 0.46 * s, 0.5 * s, 0.42 * s, 0.22 * s], { seg: 6, flatten: 0.6 }), null, opts);
  b.add(taperTube([P(0.6, 2.0, 0.3), P(0.0, 2.55, 0.3)], [0.18 * s, 0.03 * s], { seg: 4 }), null, opts);
}

/** A gabled roof over a body: two slabs, ridge, gable infill, bargeboards and finials. */
export function gableRoof(b, { L, W, y0, roofH, oh, paint = 1, tile = TILE.SHINGLE, colour = 0xffffff,
  heads = true, headScale = 1, thick = 0.45, ridgeC = DARKW, gableTile = TILE.PLANK, gableC = WOOD }) {
  const half = W / 2;
  const slope = Math.hypot(half, roofH);
  const th = Math.atan2(roofH, half);
  const len = slope + oh;
  const top = y0 + roofH;
  for (const s of [-1, 1]) {
    // Down the slope from the ridge, out past the wall by the overhang.
    const dirY = -Math.sin(th), dirZ = s * Math.cos(th);
    const nY = Math.cos(th), nZ = s * Math.sin(th);
    const cy = top + dirY * len / 2 + nY * thick / 2, cz = dirZ * len / 2 + nZ * thick / 2;
    b.box(L + 2 * oh, thick, len, 0, cy, cz, { tile, paint, colour }, 0, s * th);
  }
  b.add(gablePrism(L - 0.05, W - 0.05, roofH - 0.05), new THREE.Matrix4().makeTranslation(0, y0, 0), { tile: gableTile, colour: gableC, flat: true });
  b.box(L + 2 * oh + 0.4, 0.5, 0.5, 0, top + thick * 0.9, 0, { tile: TILE.TIMBER, colour: ridgeC });
  if (!heads) return;
  // Crossed bargeboards at each gable, running on past the ridge into heads.
  for (const e of [-1, 1]) {
    const x = e * (L / 2 + oh + 0.1);
    for (const s of [-1, 1]) {
      const bl = len + 1.4 * headScale;
      const cy = top + thick + (-Math.sin(th)) * (len / 2 - 0.7 * headScale);
      const cz = s * Math.cos(th) * (len / 2 - 0.7 * headScale);
      b.box(0.28 * headScale + 0.12, 0.75 * headScale, bl, x, cy, cz, { tile: TILE.TIMBER, colour: ridgeC }, 0, s * th);
      // The board's top end, past the ridge on the far side.
      const tip = V(x, top + thick + Math.sin(th) * 0.9 * headScale, -s * Math.cos(th) * 0.9 * headScale);
      dragonHead(b, tip, e, -s, headScale, { tile: TILE.TIMBER, colour: ridgeC });
    }
  }
}

function shield(b, x, y, z, r, ry = 0) {
  const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, ry, 0, "YXZ")), V(1, 1, 1));
  b.add(lathe([[0.01, 0.12], [r, 0.05], [r, -0.05], [0.01, -0.05]], { seg: 10 }), m, { tile: TILE.PLAIN, paint: 1 });
  b.add(lathe([[0.01, 0.3], [r * 0.25, 0.12]], { seg: 6 }), m, { tile: TILE.IRON, colour: 0x777777 });
}

/**
 * Build one archetype. Returns { detail: BufferGeometry, far: BufferGeometry,
 * collide: BufferGeometry, chimney: Vector3|null, height }.
 */
export function buildArchetype(A) {
  const { L, W, fh, wallH, roofH, oh } = A;
  const stilt = A.stilts ?? 0;
  const base = stilt ? stilt + 0.6 : fh;            // floor level
  const y0 = base + wallH;                           // eaves
  const roofTile = A.turf ? TILE.TURF : A.thatch ? TILE.THATCH : TILE.SHINGLE;
  const roofPaint = A.turf || A.thatch ? 0 : 1;
  const roofC = A.turf ? 0xffffff : A.thatch ? 0xd8c8a8 : 0xffffff;

  // --- detailed --------------------------------------------------------------
  const b = new Builder();
  if (stilt) {
    // A deck on legs over the drop, braced, with a ladder down.
    b.box(L + 4, 0.6, W + 4, 0, stilt + 0.3, 0, { tile: TILE.OLD, colour: WOOD });
    for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) {
      b.box(0.7, stilt + 6, 0.7, sx * (L / 2 + 1.4), stilt / 2 - 3, sz * (W / 2 + 1.4), { tile: TILE.TIMBER, colour: DARKW });
    }
    for (const sz of [-1, 1]) {
      const z = sz * (W / 2 + 1.4);
      b.box(L + 3, 0.4, 0.4, 0, stilt * 0.45, z, { tile: TILE.TIMBER, colour: DARKW });
      const d = Math.hypot(L / 3, stilt * 0.9);
      for (const k of [-1, 0, 1]) b.box(0.35, d, 0.35, k * L / 3, stilt * 0.5, z, { tile: TILE.TIMBER, colour: DARKW }, 0, 0, (k % 2 ? 1 : -1) * Math.atan2(L / 3, stilt * 0.9));
    }
    // Railing round the deck front.
    b.box(L + 4, 0.25, 0.25, 0, stilt + 1.6, W / 2 + 1.9, { tile: TILE.TIMBER, colour: DARKW });
    for (let i = -3; i <= 3; i++) b.box(0.22, 1.3, 0.22, i * (L + 4) / 6.5, stilt + 1.0, W / 2 + 1.9, { tile: TILE.TIMBER, colour: DARKW });
    // Ladder.
    for (const s of [-1, 1]) b.box(0.2, stilt + 0.6, 0.2, L / 2 + 2.4 + s * 0.5, stilt / 2, W / 2 + 2.3, { tile: TILE.TIMBER, colour: DARKW }, 0, 0.12);
    for (let y = 1; y < stilt; y += 0.9) b.box(1.0, 0.12, 0.12, L / 2 + 2.4, y, W / 2 + 2.3 - (stilt / 2 - y) * 0.12, { tile: TILE.TIMBER, colour: DARKW });
  } else {
    // Drystone footing, carried well down: on a hillside the ground under
    // the far side of the house is lower than under its middle.
    b.box(L + 0.8, fh + 3.6, W + 0.8, 0, (fh - 3.6) / 2, 0, { tile: TILE.STONE, colour: FOOTC });
  }
  const jet = A.jetty ? 0.9 : 0;
  if (A.jetty) {
    b.box(L, wallH * 0.48, W, 0, base + wallH * 0.24, 0, { tile: TILE.PLANK, colour: WOOD });
    b.box(L + jet * 2, wallH * 0.52, W + jet * 2, 0, base + wallH * 0.74, 0, { tile: TILE.OLD, colour: WOOD });
    for (let i = 0; i < 7; i++) b.box(0.5, 0.5, W + jet * 2 + 0.6, -L / 2 + (i + 0.5) * L / 7, base + wallH * 0.48, 0, { tile: TILE.TIMBER, colour: DARKW });
  } else {
    b.box(L, wallH, W, 0, base + wallH / 2, 0, { tile: TILE.PLANK, colour: WOOD });
  }
  // Frame: corner posts, sill and plate, mid rail.
  const ex = L / 2 + jet, ez = W / 2 + jet;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.65, wallH + 0.3, 0.65, sx * ex, base + wallH / 2, sz * ez, { tile: TILE.TIMBER, colour: DARKW });
  for (const sz of [-1, 1]) {
    b.box(2 * ex + 0.6, 0.5, 0.5, 0, y0 - 0.2, sz * (ez + 0.08), { tile: TILE.TIMBER, colour: DARKW });
    b.box(2 * ex + 0.4, 0.4, 0.4, 0, base + 0.25, sz * (ez + 0.06), { tile: TILE.TIMBER, colour: DARKW });
    if (L > 11) for (const k of [-1, 1]) b.box(0.45, wallH, 0.45, k * ex / 3, base + wallH / 2, sz * (ez + 0.05), { tile: TILE.TIMBER, colour: DARKW });
  }
  // Gable-end braces: an X under the roof line.
  for (const e of [-1, 1]) {
    const d = Math.hypot(W, wallH) * 0.48;
    for (const s of [-1, 1]) b.box(0.3, d, 0.3, e * (ex + 0.05), base + wallH / 2, 0, { tile: TILE.TIMBER, colour: DARKW }, 0, s * Math.atan2(W, wallH));
  }
  // Door, frame, lintel; a strip of firelight under it.
  const dx = A.porch ? 0 : -L * 0.18;
  b.box(2.0, 2.9, 0.3, dx, base + 1.45, ez + 0.12, { tile: TILE.DARK, colour: 0xa08060 });
  for (const s of [-1, 1]) b.box(0.4, 3.3, 0.45, dx + s * 1.2, base + 1.65, ez + 0.15, { tile: TILE.TIMBER, colour: DARKW });
  b.box(3.0, 0.45, 0.5, dx, base + 3.3, ez + 0.15, { tile: TILE.TIMBER, colour: DARKW });
  b.box(1.9, 0.12, 0.32, dx, base + 0.08, ez + 0.14, { tile: TILE.PLAIN, colour: WIN, glow: 1 });
  if (!stilt && fh > 0.7) b.box(2.4, fh, 1.4, dx, fh / 2, ez + 0.9, { tile: TILE.STONE, colour: STONEC });
  // Windows: dark by day, lit by night, with open shutters.
  const wins = [];
  const wy = base + wallH * (A.jetty ? 0.74 : 0.6);
  for (const sz of [-1, 1]) for (const fx of (L > 14 ? [-0.32, 0.12, 0.34] : [0.22, -0.3])) {
    if (sz > 0 && Math.abs(fx * L - dx) < 2) continue;
    wins.push([fx * L, sz]);
  }
  for (const [x, sz] of wins) {
    b.box(1.4, 1.4, 0.2, x, wy, sz * (ez + 0.1), { tile: TILE.PLAIN, colour: WIN, glow: 1 });
    b.box(1.8, 0.22, 0.35, x, wy - 0.6, sz * (ez + 0.15), { tile: TILE.TIMBER, colour: DARKW });
    for (const s of [-1, 1]) b.box(0.55, 1.1, 0.12, x + s * 0.95, wy, sz * (ez + 0.3), { tile: TILE.DARK, colour: 0x9a7a5a }, s * sz * 0.5);
  }
  // Painted shields on the front wall, in the roof's colour.
  if (!A.turf && !A.thatch) {
    shield(b, dx + 2.4, base + 2.0, ez + 0.4, 0.62);
    if (L > 11) shield(b, L * 0.36, base + 2.2, ez + 0.4, 0.62);
  }
  // A porch on posts over the door.
  if (A.porch) {
    for (const s of [-1, 1]) b.box(0.45, 3.4, 0.45, s * 2.2, base + 1.7, ez + 2.4, { tile: TILE.TIMBER, colour: DARKW });
    const pb = new Builder();
    gableRoof(pb, { L: 3.4, W: 3.0, y0: base + 3.4, roofH: 1.6, oh: 0.3, heads: false, thick: 0.3 });
    b.append(pb, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0, ez + 1.4));
  }
  gableRoof(b, { L: 2 * ex, W: 2 * ez, y0, roofH, oh, paint: roofPaint, tile: roofTile, colour: roofC, heads: A.heads });
  // Chimney: drystone, through the back slope, a little above the ridge.
  let chimney = null;
  if (A.chimney) {
    const cx = L * 0.24, cz = -W * 0.18, ch = y0 + roofH + 1.6;
    b.box(1.5, ch - y0 + 1, 1.5, cx, (ch + y0 - 1) / 2, cz, { tile: TILE.STONE, colour: 0x9a948a });
    b.box(1.9, 0.4, 1.9, cx, ch, cz, { tile: TILE.STONE, colour: 0x7a7570 });
    chimney = V(cx, ch + 0.4, cz);
  }
  // Odds and ends: a barrel and a woodpile against the side wall.
  if (!stilt) {
    b.add(lathe([[0.45, 0], [0.55, 0.6], [0.45, 1.2], [0.01, 1.2]], { seg: 8 }), new THREE.Matrix4().makeTranslation(-ex - 0.8, fh, ez - 1), { tile: TILE.OLD, colour: 0x9a7a5a });
    for (let i = 0; i < 3; i++) b.box(0.6, 0.5, 3.2, ex + 0.6, fh + 0.25 + i * 0.5, -0.5, { tile: TILE.TIMBER, colour: 0xa08060 }, 0, 0, 0.02 * i);
  }

  // --- far: a block, the gable and the roof -------------------------------------
  const f = new Builder();
  if (stilt) {
    f.box(L + 4, 0.6, W + 4, 0, stilt + 0.3, 0, { tile: TILE.OLD, colour: WOOD });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.9, stilt + 6, 0.9, sx * (L / 2 + 1.4), stilt / 2 - 3, sz * (W / 2 + 1.4), { tile: TILE.TIMBER, colour: DARKW });
  }
  if (!stilt) f.box(L + 0.8, 3.6, W + 0.8, 0, -1.6, 0, { tile: TILE.STONE, colour: FOOTC });
  f.box(2 * ex, wallH + base, 2 * ez, 0, (wallH + base) / 2, 0, { tile: TILE.PLANK, colour: WOOD });
  // Windows as single quads on the wall: two triangles, not twelve.
  for (const [x, sz] of wins) {
    const q = new THREE.PlaneGeometry(1.6, 1.6);
    if (sz < 0) q.rotateY(Math.PI);
    f.add(q, new THREE.Matrix4().makeTranslation(x, wy, sz * (ez + 0.05)), { tile: TILE.PLAIN, colour: WIN, glow: 1, flat: true });
  }
  gableRoof(f, { L: 2 * ex, W: 2 * ez, y0, roofH, oh, paint: roofPaint, tile: roofTile, colour: roofC, heads: false });
  if (chimney) f.box(1.5, chimney.y - y0, 1.5, chimney.x, (chimney.y + y0) / 2, chimney.z, { tile: TILE.STONE, colour: 0x9a948a });

  // --- collision: what his feet and the flight floor meet ---------------------------
  const c = new Builder();
  c.box(2 * ex, y0, 2 * ez, 0, y0 / 2, 0, { tile: 0 });
  gableRoof(c, { L: 2 * ex, W: 2 * ez, y0, roofH, oh, heads: false });
  if (stilt) c.box(L + 4, 0.6, W + 4, 0, stilt + 0.3, 0, { tile: 0 });

  return { detail: b.build(), far: f.build(), collide: c.build(), chimney, height: y0 + roofH, A };
}
