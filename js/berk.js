import * as THREE from "three";
import { HARBOUR, STATUES, HALL, STAIR, HEADLANDS, ROCK, VILLAGE } from "./berklayout.js";
import { terrainHeight, berkVillage } from "./terrain.js";
import {
  Builder, TILE, berkMaterial, berkUniforms, MAX_FIRES, mulberry, lathe, taperTube,
  makeFlames, makeGlows, makeSmoke,
} from "./berkkit.js";
import { ARCHETYPES, buildArchetype, gableRoof } from "./berkhouses.js";
import { buildStatue } from "./berkstatue.js";

// ---------------------------------------------------------------------------
// Berk, built: the village of the films on the ground terrain.js shapes for it.
//
// Every position comes from berklayout.js — the statues, the hall and its
// stair — or from the plots and paths its placeVillage() found on the ground
// (terrain.js berkVillage). Nothing here is a world coordinate of its own, so
// moving the island moves all of this with it:
//
//   - the two stone Vikings at the harbour mouth on their plinths, braziers lit
//     (berkstatue.js);
//   - the Great Hall on its shelf in the mountainside, with its portico, giant
//     braziers and the Great Stair down to the head of the cove;
//   - the harbour: timber wharves wherever the shore has a shelf at quay
//     height, piers on pilings out into the cove, moored longships;
//   - the houses, one on each levelled plot, along the contour with the door
//     downhill (berkhouses.js); stilt houses out over the steep places;
//   - the paths between them, as wooden steps where the hill is steep and as
//     walkways on posts where the ground falls away under them;
//   - watchtowers and beacons on the headlands and the great rock, catapults
//     at the mouth, a feeding station and braziers at the foot of the stair.
//
// Draw calls stay low because nearly everything is either one merged mesh per
// district or one InstancedMesh per house archetype. Houses near the camera
// are drawn detailed (dragon-head finials, frames, shutters, shields) and the
// rest as block-and-roof (berkhouses.js `far`); the split is redone as the
// camera moves. Firelight is the berkkit.js fake: no new THREE lights.
// ---------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WOOD = 0xd6bc98, DARKW = 0x9a8068, STONEC = 0xb0aba2;

// Roofs: weathered shingle in browns and greys, most of them, and a painted
// one here and there -- the films' village is colourful in its trim, not a
// paintbox of roofs. [colour, weight]
const ROOF_COLOURS = [
  [0x5a4636, 5], [0x6e5a48, 5], [0x4e4844, 4], [0x625e58, 3], [0x5f6a48, 3],
  [0x7a5a3e, 3], [0x7e4e3c, 1.4], [0x8e3a2a, 0.45], [0x4a6078, 0.3], [0x56683e, 0.4], [0x93763a, 0.25],
];
const ROOF_SUM = ROOF_COLOURS.reduce((s, c) => s + c[1], 0);
function roofColour(rnd) {
  let t = rnd() * ROOF_SUM;
  for (const [c, w] of ROOF_COLOURS) { t -= w; if (t <= 0) return c; }
  return ROOF_COLOURS[0][0];
}

// --- small structures ---------------------------------------------------------------

function torch(b, fires, x, y, z) {
  b.box(0.35, 4.2, 0.35, x, y + 2.1, z, { tile: TILE.TIMBER, colour: DARKW });
  b.add(lathe([[0.2, 0], [0.55, 0.5], [0.6, 0.8]], { seg: 6 }), new THREE.Matrix4().makeTranslation(x, y + 4.1, z), { tile: TILE.IRON, colour: 0x777777 });
  fires.push({ x, y: y + 4.5, z, s: 1.5, r: 22 });
}

function brazier(b, fires, x, y, z, k = 1) {
  const m = new THREE.Matrix4().makeScale(k, k, k).setPosition(x, y, z);
  b.add(lathe([[1.4, 0], [1.2, 0.5], [0.55, 0.8], [0.45, 2.2], [0.7, 2.5], [1.6, 3.2], [1.9, 3.8], [1.75, 3.9]], { seg: 12 }), m, { tile: TILE.IRON, colour: 0x8a8580 });
  b.add(lathe([[1.6, 3.8], [1.0, 4.1], [0.1, 4.3]], { seg: 10 }), m, { tile: TILE.IRON, colour: 0x3a2010, glow: 1 });
  fires.push({ x, y: y + 3.8 * k, z, s: 3.6 * k, r: 42 * k });
}

function banner(b, x, y, z, yaw, colour, h = 12) {
  b.box(0.4, h, 0.4, x, y + h / 2, z, { tile: TILE.TIMBER, colour: DARKW });
  const cx = Math.cos(yaw), cz = -Math.sin(yaw);
  b.box(3.6, 0.3, 0.3, x, y + h - 0.6, z, { tile: TILE.TIMBER, colour: DARKW }, yaw);
  // Cloth with a pale band and a dark emblem disc.
  b.box(3.2, h * 0.5, 0.12, x + cz * 0.25, y + h * 0.7, z + cx * 0.25, { tile: TILE.CLOTH, colour }, yaw);
  b.box(3.22, h * 0.06, 0.14, x + cz * 0.25, y + h * 0.52, z + cx * 0.25, { tile: TILE.CLOTH, colour: 0xd8cfae }, yaw);
  b.box(1.4, 1.4, 0.16, x + cz * 0.25, y + h * 0.74, z + cx * 0.25, { tile: TILE.CLOTH, colour: 0x2a2420 }, yaw, 0, Math.PI / 4);
}

function totem(b, x, y, z, rnd) {
  const cols = [0x9a3424, 0x3e5f80, 0xd8c8a0, 0x4f6f3c];
  const segs = [];
  let yy = 0;
  for (let i = 0; i < 5; i++) { segs.push([1.1 + (i % 2) * 0.4, yy], [1.4 + (i % 2) * 0.5, yy + 1.2], [1.0, yy + 2.6]); yy += 2.6; }
  b.add(lathe(segs, { seg: 10, fn: (t) => 1 + 0.08 * Math.sin(t * 4) }), new THREE.Matrix4().makeTranslation(x, y, z),
    { tile: TILE.TIMBER, colour: (p) => new THREE.Color(cols[Math.floor((p.y - y) / 2.6) % cols.length]).lerp(new THREE.Color(0xb09070), 0.35) });
  // Wings, and a beaked head on top.
  for (const s of [-1, 1]) b.box(3.4, 1.2, 0.3, x + s * 2.4, y + yy - 2.4, z, { tile: TILE.TIMBER, colour: 0x9a3424 }, 0, 0, s * 0.35);
  b.add(taperTube([V(x, y + yy, z), V(x, y + yy + 1.6, z + 0.4), V(x, y + yy + 2.0, z + 2.0)], [1.0, 0.9, 0.2], { seg: 8 }), null, { tile: TILE.TIMBER, colour: 0xc0a070 });
}

function tower(b, fires, x, y, z, yaw, { h = 28, roof = 0x9a3424, beacon = false } = {}) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  const L = (p0, p1, r) => b.limb(p0, p1, r, r * 0.85, { seg: 6, tile: TILE.TIMBER, colour: DARKW, matrix: m });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L(V(sx * 6, -4, sz * 6), V(sx * 3.6, h + 1, sz * 3.6), 0.6);
  for (let k = 0; k < 3; k++) {
    const y0 = 3 + k * (h / 3.4), y1 = y0 + h / 3.4, r0 = 6 - (y0 / h) * 2.4, r1 = 6 - (y1 / h) * 2.4;
    for (const s of [-1, 1]) {
      L(V(-r0, y0, s * r0), V(r1, y1, s * r1), 0.25); L(V(r0, y0, s * r0), V(-r1, y1, s * r1), 0.25);
      L(V(s * r0, y0, -r0), V(s * r1, y1, r1), 0.25); L(V(s * r0, y0, r0), V(s * r1, y1, -r1), 0.25);
    }
  }
  b.box(11, 0.7, 11, 0, h + 1.2, 0, { tile: TILE.OLD, colour: WOOD, matrix: m });
  for (const s of [-1, 1]) {
    b.box(11, 1.2, 0.3, 0, h + 2.3, s * 5.4, { tile: TILE.OLD, colour: WOOD, matrix: m });
    b.box(0.3, 1.2, 11, s * 5.4, h + 2.3, 0, { tile: TILE.OLD, colour: WOOD, matrix: m });
  }
  // Ladder up one leg.
  for (const s of [-1, 1]) L(V(5.6 + s * 0.4, -2, 0), V(3.6 + s * 0.4, h + 1, 0), 0.15);
  if (beacon) {
    brazier(b, fires, x, y + h + 1.5, z, 1.6);
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.4, 5, 0.4, sx * 5, h + 4, sz * 5, { tile: TILE.TIMBER, colour: DARKW, matrix: m });
    b.add(lathe([[8.4, 0], [0.1, 6]], { seg: 4, t0: Math.PI / 4 }), new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, h + 6.4, 0)), { tile: TILE.SHINGLE, colour: roof, flat: true });
    b.add(taperTube([V(0, h + 12, 0), V(0, h + 14, 0)], [0.3, 0.1], { seg: 6 }), m, { tile: TILE.IRON, colour: 0x666666 });
    // A watch-fire hung under the roof.
    const p = V(0, h + 1.6, 0).applyMatrix4(m);
    fires.push({ x: p.x, y: p.y + 0.3, z: p.z, s: 1.6, r: 30 });
  }
}

function catapult(b, x, y, z, yaw) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  const o = { tile: TILE.TIMBER, colour: DARKW, matrix: m };
  for (const s of [-1, 1]) {
    b.box(0.7, 0.7, 10, s * 2.6, 0.5, 0, o);
    b.box(0.6, 6, 0.6, s * 2.6, 3.6, -0.5, o, 0, 0.32);
    b.box(0.6, 6, 0.6, s * 2.6, 3.6, -2.5, o, 0, -0.32);
  }
  for (const zz of [-4.4, 4.4]) b.box(5.8, 0.6, 0.6, 0, 0.6, zz, o);
  b.box(6, 0.5, 0.5, 0, 6.3, -1.5, o);
  // The arm, cocked back, with its sling cup, and the counterweight box.
  b.box(0.6, 0.6, 13, 0, 7.6, 1.2, o, 0, -0.32);
  b.add(lathe([[0.2, 0], [1.1, 0.4], [1.2, 0.9]], { seg: 8 }), new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 9.9, 7.2)), { tile: TILE.TIMBER, colour: 0x6a5040 });
  b.box(2.4, 2.4, 2.4, 0, 4.4, -4.6, { tile: TILE.OLD, colour: 0x8a7050, matrix: m });
  // Ammunition: a pile of boulders.
  for (let i = 0; i < 5; i++) b.ball(3.6 + (i % 2) * 1.1, 0.6 + Math.floor(i / 3) * 0.9, 2 + i * 0.9, 0.7, 0.6, 0.7, { seg: 6, hseg: 4, tile: TILE.STONE, colour: 0x9a9890, matrix: m });
}

function ballista(b, x, y, z, yaw) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  const o = { tile: TILE.TIMBER, colour: DARKW, matrix: m };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.limb(V(Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2), V(0, 2.6, 0), 0.2, 0.18, { seg: 5, ...o });
  }
  b.box(0.7, 0.6, 6, 0, 2.9, 0.6, o, 0, -0.1);
  const bow = [V(-3.4, 3.3, 2.0), V(-1.6, 3.2, 3.2), V(0, 3.15, 3.5), V(1.6, 3.2, 3.2), V(3.4, 3.3, 2.0)];
  b.add(taperTube(bow, [0.12, 0.22, 0.26, 0.22, 0.12], { seg: 6 }), m, { tile: TILE.TIMBER, colour: 0x6a4a30 });
  b.box(0.12, 0.12, 6.4, 0, 3.4, 0.9, { tile: TILE.IRON, colour: 0x777777, matrix: m });
}

function feedingStation(b, x, y, z, rnd) {
  const o = { tile: TILE.TIMBER, colour: DARKW };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.limb(V(x + sx * 4.5, y, z + sz * 4.5), V(x + sx * 3.4, y + 9, z + sz * 3.4), 0.45, 0.4, { seg: 6, ...o });
  b.box(9, 0.6, 9, x, y + 9.2, z, { tile: TILE.OLD, colour: WOOD });
  // The great feeding trough, brimming with fish.
  b.add(lathe([[3.5, 0], [5.6, 1.4], [6.4, 3.0], [6.2, 3.3], [5.2, 2.0], [0.1, 1.2]], { seg: 16 }), new THREE.Matrix4().makeTranslation(x, y + 9.5, z), { tile: TILE.DARK, colour: 0xa08060 });
  for (const s of [0, 1]) b.add(lathe([[6.45, 0.7 + s * 1.6], [6.6, 0.95 + s * 1.6]], { seg: 16 }), new THREE.Matrix4().makeTranslation(x, y + 9.5, z), { tile: TILE.IRON, colour: 0x777777 });
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 4.6;
    b.ball(x + Math.cos(a) * r, y + 12.0 + rnd() * 0.6 - r * 0.12, z + Math.sin(a) * r, 0.35, 0.3, 1.1,
      { seg: 6, hseg: 4, tile: TILE.PLAIN, colour: rnd() < 0.5 ? 0x9aa4ac : 0xc08050, ry: rnd() * 3 });
  }
  // A ramp up for anyone on foot, and a signboard with a painted fish.
  b.box(2.2, 0.3, 13, x + 7.6, y + 4.6, z, o, 0, -0.78);
  b.box(3.2, 1.6, 0.2, x, y + 7.2, z + 4.7, { tile: TILE.PLAIN, colour: 0xc8b890 });
}

function stable(b, x, y, z, yaw, colour) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  const L = 42, W = 13, H = 8;
  b.box(L + 1, 5, W + 1, 0, -1.9, 0, { tile: TILE.STONE, colour: STONEC, matrix: m });
  b.box(L, H, 0.8, 0, H / 2, -W / 2, { tile: TILE.PLANK, colour: WOOD, matrix: m });
  for (const s of [-1, 1]) b.box(0.8, H, W, s * L / 2, H / 2, 0, { tile: TILE.PLANK, colour: WOOD, matrix: m });
  const stalls = 6;
  for (let i = 0; i <= stalls; i++) {
    const sx = -L / 2 + (i * L) / stalls;
    b.box(0.9, H + 0.4, 0.9, sx, H / 2, W / 2, { tile: TILE.TIMBER, colour: DARKW, matrix: m });
    if (i > 0 && i < stalls) b.box(0.4, H * 0.55, W - 1, sx, H * 0.28, 0, { tile: TILE.OLD, colour: WOOD, matrix: m });
    // Each stall's arch, carved with a dragon's face over it.
    if (i < stalls) {
      const cx = sx + L / stalls / 2;
      b.box(L / stalls, 1.1, 0.7, cx, H - 0.6, W / 2, { tile: TILE.TIMBER, colour: DARKW, matrix: m });
      b.ball(cx, H - 0.5, W / 2 + 0.5, 1.1, 0.9, 0.6, { seg: 8, hseg: 6, tile: TILE.PLAIN, colour: [0x9a3424, 0x3e5f80, 0x4f6f3c][i % 3], matrix: m, paint: 0 });
      // Straw on the floor.
      b.box(L / stalls - 1, 0.35, W - 2, cx, 0.7, 0, { tile: TILE.THATCH, colour: 0xd8c8a0, matrix: m });
    }
  }
  const rb = new Builder();
  gableRoof(rb, { L: L + 1, W: W + 1, y0: H, roofH: 5.5, oh: 1.2, paint: 0, colour, heads: true, headScale: 1.6 });
  b.append(rb, m);
}

function stairFlight(b, fires, p0, p1, width = 4, { posts = 7, rail = true, torchAt = false } = {}) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z, run = Math.hypot(dx, dz), rise = p1.y - p0.y;
  const yaw = Math.atan2(dx, dz);
  const n = Math.max(2, Math.ceil(Math.abs(rise) / 0.75));
  const tread = run / n;
  const o = { tile: TILE.OLD, colour: WOOD };
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.box(width, 0.3, tread + 0.15, p0.x + dx * t, p0.y + rise * ((i + 1) / n) - 0.15, p0.z + dz * t, o, yaw);
  }
  const ang = Math.atan2(rise, run), len = Math.hypot(run, rise);
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  for (const s of [-1, 1]) {
    const ox = ux * s * (width / 2 + 0.2), oz = uz * s * (width / 2 + 0.2);
    const mx = (p0.x + p1.x) / 2 + ox, my = (p0.y + p1.y) / 2 - 0.4, mz = (p0.z + p1.z) / 2 + oz;
    b.box(0.35, 0.8, len, mx, my, mz, { tile: TILE.TIMBER, colour: DARKW }, yaw, -ang);
    if (rail) b.box(0.18, 0.18, len, mx, my + 1.6, mz, { tile: TILE.TIMBER, colour: DARKW }, yaw, -ang);
    const np = Math.max(2, Math.round(len / 6));
    for (let k = 0; k <= np; k++) {
      const t = k / np;
      const px = p0.x + dx * t + ox, py = p0.y + rise * t, pz = p0.z + dz * t + oz;
      if (rail) b.box(0.18, 1.6, 0.18, px, py + 0.8, pz, { tile: TILE.TIMBER, colour: DARKW });
      if (posts > 0 && t > 0.05 && t < 0.95) b.box(0.45, posts, 0.45, px, py - posts / 2 - 0.3, pz, { tile: TILE.TIMBER, colour: DARKW });
    }
  }
  if (torchAt) torch(b, fires, p0.x + ux * (width / 2 + 1), p0.y, p0.z + uz * (width / 2 + 1));
}

function walkway(b, fires, p0, p1, y, width = 3.2, postDown = 12, torchEvery = 0) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z, len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  b.box(width, 0.4, len, (p0.x + p1.x) / 2, y, (p0.z + p1.z) / 2, { tile: TILE.OLD, colour: WOOD }, yaw);
  const n = Math.max(1, Math.round(len / 5));
  for (let k = 0; k <= n; k++) {
    const t = k / n, px = p0.x + dx * t, pz = p0.z + dz * t;
    for (const s of [-1, 1]) {
      b.box(0.4, postDown, 0.4, px + ux * s * width / 2, y - postDown / 2, pz + uz * s * width / 2, { tile: TILE.TIMBER, colour: DARKW });
    }
    b.box(0.18, 1.3, 0.18, px + ux * width / 2, y + 0.8, pz + uz * width / 2, { tile: TILE.TIMBER, colour: DARKW });
    if (k % 2 === 0 && k < n) b.box(0.25, Math.hypot(len / n, postDown * 0.6), 0.25, px + ux * width / 2 + dx / n / 2, y - postDown * 0.35, pz + uz * width / 2 + dz / n / 2, { tile: TILE.TIMBER, colour: DARKW }, yaw, Math.atan2(len / n, postDown * 0.6));
    if (torchEvery && k % torchEvery === 0) torch(b, fires, px + ux * (width / 2 - 0.3), y, pz + uz * (width / 2 - 0.3));
  }
  b.box(0.18, 0.18, len, (p0.x + p1.x) / 2 + ux * width / 2, y + 1.45, (p0.z + p1.z) / 2 + uz * width / 2, { tile: TILE.TIMBER, colour: DARKW }, yaw);
}

/** A Viking longship, bow toward +z in its own frame. */
function longship(b, x, y, z, yaw, rnd, { len = 28, sailUp = false } = {}) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  const W = len * 0.2, rows = 18, cols = 7;
  const pos = [], idx = [];
  // Lofted from U-sections: beam ~ sin^0.6 along the hull, the sheer rising
  // sharply into the stems.
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, u = Math.abs(2 * t - 1);
    const hw = Math.max(0.15, (W / 2) * Math.pow(Math.sin(Math.PI * t), 0.6));
    const sheer = 1.6 + 2.6 * Math.pow(u, 3);
    const keel = -1.5 + 1.2 * Math.pow(u, 2);
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI;              // 0 port gunwale .. PI starboard
      const cx = -Math.cos(a) * hw;
      const cy = keel + (sheer - keel) * (1 - Math.sin(a)) ** 0.8;
      pos.push(cx, cy, (t - 0.5) * len);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, c = a + cols + 1;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx); hull.computeVertexNormals();
  b.add(hull, m, { tile: TILE.DARK, colour: 0xb09070 });
  // The inside, darker, so the hull is not a shell from above.
  const inner = hull.clone(); inner.scale(0.94, 0.96, 0.98); const ix = inner.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  inner.computeVertexNormals();
  b.add(inner, m, { tile: TILE.OLD, colour: 0x7a6248 });
  // Stems curling up into a dragon at the bow and a tail at the stern.
  const bow = [V(0, 1.4, len / 2 - 0.4), V(0, 3.6, len / 2 + 0.8), V(0, 6.0, len / 2 + 1.2), V(0, 7.6, len / 2 + 0.4), V(0, 8.2, len / 2 + 1.8)];
  b.add(taperTube(bow, [0.35, 0.4, 0.42, 0.5, 0.2], { seg: 6 }), m, { tile: TILE.TIMBER, colour: 0x8a5a30 });
  b.add(taperTube([V(0, 7.6, len / 2 + 0.4), V(0, 7.4, len / 2 + 2.6)], [0.4, 0.12], { seg: 6 }), m, { tile: TILE.TIMBER, colour: 0x8a5a30 });
  const stern = [V(0, 1.4, -len / 2 + 0.4), V(0, 3.8, -len / 2 - 0.8), V(0, 6.0, -len / 2 - 0.6), V(0, 6.8, -len / 2 + 0.6)];
  b.add(taperTube(stern, [0.35, 0.35, 0.3, 0.1], { seg: 6 }), m, { tile: TILE.TIMBER, colour: 0x8a5a30 });
  // Shields along both gunwales.
  const sc = [0x9a3424, 0xd8c8a0, 0x3e5f80, 0xa58032, 0x4f6f3c];
  for (let i = 2; i < rows - 1; i++) {
    const t = i / rows, hw = (W / 2) * Math.pow(Math.sin(Math.PI * t), 0.6);
    const sy = 1.6 + 2.6 * Math.pow(Math.abs(2 * t - 1), 3) - 0.3;
    for (const s of [-1, 1]) b.ball(s * (hw + 0.1), sy, (t - 0.5) * len, 0.12, 0.62, 0.62, { seg: 6, hseg: 3, tile: TILE.PLAIN, colour: sc[(i + (s > 0 ? 2 : 0)) % sc.length], matrix: m });
  }
  // Mast and yard; the sail furled on the yard, or set with its stripes.
  b.limb(V(0, -1, 0), V(0, 15, 0), 0.32, 0.22, { seg: 6, tile: TILE.TIMBER, colour: DARKW, matrix: m });
  b.limb(V(-7, 13.5, 0.3), V(7, 13.5, 0.3), 0.2, 0.2, { seg: 6, tile: TILE.TIMBER, colour: DARKW, matrix: m });
  if (sailUp) {
    const stripes = [0x9a2a20, 0xe0d6c0];
    for (let k = 0; k < 6; k++) b.box(2.2, 9, 0.15, -5.5 + k * 2.2, 8.8, 0.6 + Math.sin((k + 0.5) / 6 * Math.PI) * 0.9, { tile: TILE.CLOTH, colour: stripes[k % 2], matrix: m });
  } else {
    b.limb(V(-6.6, 13.1, 0.4), V(6.6, 13.1, 0.4), 0.55, 0.55, { seg: 6, tile: TILE.CLOTH, colour: rnd() < 0.5 ? 0xc0a890 : 0x9a5040, matrix: m });
  }
  // Oars shipped, a few benches.
  for (let i = -3; i <= 3; i++) b.box(W * 0.8, 0.2, 0.5, 0, 0.4, i * len / 9, { tile: TILE.OLD, colour: WOOD, matrix: m });
}

function pier(b, fires, x0, z0, ux, uz, len, y, rnd) {
  // From the wharf out over the water along (ux, uz).
  const w = 7;
  const yaw = Math.atan2(ux, uz);
  const px = Math.cos(yaw), pz = -Math.sin(yaw);       // across the pier
  const cx = x0 + ux * len / 2, cz = z0 + uz * len / 2;
  b.box(w, 0.5, len, cx, y, cz, { tile: TILE.OLD, colour: WOOD }, yaw);
  const n = Math.round(len / 5);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ux * (i * len / n), z = z0 + uz * (i * len / n);
    for (const s of [-1, 1]) b.limb(V(x + px * s * (w / 2 - 0.3), HARBOUR.floor * 0.6, z + pz * s * (w / 2 - 0.3)), V(x + px * s * (w / 2 - 0.3), y + (i % 3 === 0 ? 1.2 : 0), z + pz * s * (w / 2 - 0.3)), 0.4, 0.35, { seg: 5, tile: TILE.TIMBER, colour: 0x6a5a48 });
  }
  for (const s of [-1, 1]) b.box(0.4, 0.4, len, cx + px * s * (w / 2), y - 0.6, cz + pz * s * (w / 2), { tile: TILE.TIMBER, colour: DARKW }, yaw);
  // Barrels, crates, a lamp at the end.
  for (let i = 0; i < 3; i++) {
    const t = 6 + rnd() * (len - 12), o = (rnd() - 0.5) * 4;
    const x = x0 + ux * t + px * o, z = z0 + uz * t + pz * o;
    if (rnd() < 0.5) b.box(1.3, 1.3, 1.3, x, y + 0.9, z, { tile: TILE.OLD, colour: 0x9a8060 }, rnd() * 2);
    else b.add(lathe([[0.5, 0], [0.62, 0.65], [0.5, 1.3], [0.01, 1.3]], { seg: 8 }), new THREE.Matrix4().makeTranslation(x, y + 0.25, z), { tile: TILE.OLD, colour: 0x9a7a5a });
  }
  torch(b, fires, x0 + ux * (len - 1) + px * (w / 2 - 0.5), y + 0.25, z0 + uz * (len - 1) + pz * (w / 2 - 0.5));
}

/** A flight of dressed-stone steps from p0 up to p1 on the graded ground, with low walls. */
function stoneStair(b, p0, p1, width) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z, run = Math.hypot(dx, dz), rise = p1.y - p0.y;
  const yaw = Math.atan2(dx, dz);
  const n = Math.max(2, Math.ceil(Math.abs(rise) / 0.6));
  const tread = run / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const top = p0.y + rise * ((i + 1) / n);
    b.box(width, 2.2, tread + 0.08, p0.x + dx * t, top - 1.1, p0.z + dz * t, { tile: TILE.STONE, colour: i % 2 ? 0xa8a298 : 0x9e988e }, yaw);
  }
  const ang = Math.atan2(rise, run), len = Math.hypot(run, rise);
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  for (const s of [-1, 1]) {
    const ox = ux * s * (width / 2 + 0.7), oz = uz * s * (width / 2 + 0.7);
    b.box(1.4, 2.4, len, (p0.x + p1.x) / 2 + ox, (p0.y + p1.y) / 2 + 0.3, (p0.z + p1.z) / 2 + oz, { tile: TILE.STONE, colour: 0x8e897f }, yaw, -ang);
  }
}

// --- the Great Hall -------------------------------------------------------------------

function greatHall(b, fires, smoke, cx, cy, cz, rot) {
  const H = { len: HALL.len, wid: HALL.wid, h: HALL.roofH };
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(cx, cy, cz);
  const o = (tile, colour, extra = {}) => ({ tile, colour, matrix: m, ...extra });
  const W = H.wid, Ln = H.len;
  const plinth = 3, stoneH = 14, wallTop = plinth + 22;
  // A dressed-stone platform with steps all round.
  b.box(W + 22, plinth, Ln + 22, 0, plinth / 2 - 0.5, 0, o(TILE.STONE, STONEC));
  b.box(W + 26, 1.2, Ln + 26, 0, 0.1, 0, o(TILE.STONE, 0x9a958c));
  // Stone lower walls, timber above, a heavy beam between.
  b.box(W, stoneH, Ln, 0, plinth + stoneH / 2, 0, o(TILE.STONE, 0xa8a399));
  b.box(W - 1, wallTop - plinth - stoneH, Ln - 1, 0, (plinth + stoneH + wallTop) / 2, 0, o(TILE.DARK, 0xb09a80));
  for (const s of [-1, 1]) b.box(1.6, 1.4, Ln + 1.2, s * (W / 2 + 0.2), plinth + stoneH + 0.4, 0, o(TILE.TIMBER, DARKW));
  b.box(W + 1.2, 1.4, 1.6, 0, plinth + stoneH + 0.4, Ln / 2 + 0.2, o(TILE.TIMBER, DARKW));
  b.box(W + 1.2, 1.4, 1.6, 0, plinth + stoneH + 0.4, -Ln / 2 - 0.2, o(TILE.TIMBER, DARKW));
  // Buttresses down both long sides: stone piers with timber struts to the eaves.
  const nb = 7;
  for (let i = 0; i < nb; i++) {
    const z = -Ln / 2 + 8 + (i * (Ln - 16)) / (nb - 1);
    for (const s of [-1, 1]) {
      b.box(5, stoneH + 2, 7, s * (W / 2 + 2.2), plinth + (stoneH + 2) / 2, z, o(TILE.STONE, 0x9e998f));
      b.box(4.2, 1, 6.2, s * (W / 2 + 2.2), plinth + stoneH + 2.5, z, o(TILE.STONE, 0x8e8980));
      b.box(1.2, 11, 1.2, s * (W / 2 + 2.6), plinth + stoneH + 7, z, o(TILE.TIMBER, DARKW), 0, 0, -s * 0.28);
      // High windows between the buttresses.
      if (i < nb - 1) {
        const zw = z + (Ln - 16) / (nb - 1) / 2;
        b.box(0.4, 5, 2.4, s * (W / 2 - 0.3), plinth + stoneH + 5, zw, o(TILE.PLAIN, 0x2a1a10, { glow: 1 }));
        b.box(0.6, 0.6, 3.6, s * (W / 2), plinth + stoneH + 2.2, zw, o(TILE.TIMBER, DARKW));
      }
    }
  }
  // The roof: enormous, steep, dark shingle, with crossed dragon-headed gables.
  const rb = new Builder();
  gableRoof(rb, { L: Ln + 2, W: W + 2, y0: wallTop, roofH: H.h - wallTop, oh: 4.5, paint: 0, colour: 0x6a5446,
    heads: true, headScale: 5, thick: 1.4, ridgeC: 0x6a5440, gableTile: TILE.DARK, gableC: 0xa08a70 });
  // gableRoof runs its ridge along x; the hall's runs along z.
  b.append(rb, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  // Smoke louvres on the ridge.
  for (const z of [-Ln * 0.25, Ln * 0.2]) {
    const lb = new Builder();
    lb.box(8, 4, 6, 0, H.h + 1.6, 0, { tile: TILE.DARK, colour: 0x8a7460 });
    gableRoof(lb, { L: 8, W: 6, y0: H.h + 3.6, roofH: 3, oh: 0.8, paint: 0, colour: 0x6a5446, heads: false, thick: 0.5 });
    b.append(lb, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0, z)));
    smoke.push(V(0, H.h + 6, z).applyMatrix4(m));
  }
  // The south front: a pillared portico under its own gable, the great doors.
  const fz = Ln / 2;
  const doorW = 14, doorH = 19;
  b.box(doorW, doorH, 1.4, 0, plinth + doorH / 2, fz + 0.4, o(TILE.DARK, 0x9a7c5c));
  for (let i = 0; i < 4; i++) b.box(doorW + 0.4, 0.7, 1.7, 0, plinth + 3 + i * 4.6, fz + 0.5, o(TILE.IRON, 0x666666));
  b.box(0.4, doorH, 1.6, 0, plinth + doorH / 2, fz + 0.5, o(TILE.PLAIN, 0x2a1a10, { glow: 1 }));
  for (const s of [-1, 1]) b.box(2.4, doorH + 3, 2.4, s * (doorW / 2 + 1.2), plinth + (doorH + 3) / 2, fz + 0.8, o(TILE.TIMBER, DARKW));
  b.box(doorW + 7, 3, 2.6, 0, plinth + doorH + 2, fz + 0.8, o(TILE.TIMBER, DARKW));
  // Carved shields along the front.
  const sc = [0x9a3424, 0x3e5f80, 0xa58032, 0x4f6f3c];
  for (let i = 0; i < 6; i++) {
    const x = (i < 3 ? -1 : 1) * (doorW / 2 + 5 + (i % 3) * 5);
    const sm = new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().compose(V(x, plinth + stoneH - 4, fz + 0.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(1, 1, 1)));
    b.add(lathe([[0.01, 0.5], [2.1, 0.2], [2.2, -0.2], [0.01, -0.2]], { seg: 14 }), sm, { tile: TILE.PLAIN, colour: sc[i % 4] });
    b.add(lathe([[0.01, 1.0], [0.6, 0.4]], { seg: 8 }), sm, { tile: TILE.IRON, colour: 0x777777 });
  }
  // Portico.
  const pz = fz + 9, ph = 24;
  for (const px of [-15, -6, 6, 15]) {
    b.add(lathe([[2.0, 0], [2.1, 1.2], [1.6, 2], [1.5, ph - 3], [2.2, ph - 1.2], [2.6, ph]], { seg: 12, fn: (t, y) => 1 + 0.06 * Math.sin(t * 6 + y * 0.6) }),
      new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(px, plinth, pz + 6)), { tile: TILE.TIMBER, colour: 0x9a7a58 });
  }
  b.box(36, 2, 16, 0, plinth + ph + 1, pz + 1, o(TILE.TIMBER, DARKW));
  const pb = new Builder();
  gableRoof(pb, { L: 17, W: 38, y0: plinth + ph + 2, roofH: 11, oh: 2, paint: 0, colour: 0x6a5446, heads: true, headScale: 3.4, thick: 1, gableTile: TILE.DARK, gableC: 0xa08a70 });
  b.append(pb, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0, pz)));
  // Steps down off the platform in front.
  for (let i = 0; i < 6; i++) b.box(40 - i * 1, 0.6, 3, 0, plinth - 0.3 - i * 0.6, pz + 9 + i * 2.2, o(TILE.STONE, 0x9a958c));
  // The two giant braziers either side of the stair, and banners.
  for (const s of [-1, 1]) {
    const p = V(s * 24, 0, pz + 12).applyMatrix4(m);
    b.add(lathe([[4.5, 0], [4.5, 1.5], [3.4, 2.2], [2.2, 6], [3.0, 7]], { seg: 16 }), new THREE.Matrix4().makeTranslation(p.x, cy, p.z), { tile: TILE.STONE, colour: 0x9a958c });
    brazier(b, fires, p.x, cy + 7, p.z, 2.4);
    const q = V(s * 33, 0, fz + 2).applyMatrix4(m);
    banner(b, q.x, cy + plinth, q.z, rot, 0x8a2a20, 22);
  }
  // Two stone towers at the front corners, beacons burning on their tops.
  for (const s of [-1, 1]) {
    const tx = s * (W / 2 + 13), tz = fz - 4, th = 44;
    b.box(15, th, 15, tx, th / 2, tz, o(TILE.STONE, 0xa39e94));
    b.box(17, 2, 17, tx, th + 1, tz, o(TILE.STONE, 0x8e8980));
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.box(3.4, 3.6, 3.4, tx + cx * 6.8, th + 3.8, tz + cz * 6.8, o(TILE.STONE, 0x8e8980));
    for (let k = 0; k < 3; k++) b.box(1.4, 4.5, 0.6, tx, 12 + k * 10, tz + 7.6, o(TILE.PLAIN, 0x2a1a10, { glow: 1 }));
    b.add(lathe([[11.5, 0], [0.1, 16]], { seg: 4, t0: Math.PI / 4 }), new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(tx, th + 5.6, tz)), { tile: TILE.SHINGLE, colour: 0x7a3022, flat: true });
    const p = V(tx, th + 2, tz + 9.5).applyMatrix4(m);
    brazier(b, fires, p.x, p.y, p.z, 1.6);
  }
  // Torches all round the platform's edge.
  for (let i = 0; i < 10; i++) {
    const z = -Ln / 2 + (i * Ln) / 9;
    for (const s of [-1, 1]) {
      const p = V(s * (W / 2 + 9), 0, z).applyMatrix4(m);
      torch(b, fires, p.x, cy + plinth - 0.5, p.z);
    }
  }
  return V(0, 0, pz + 9 + 6 * 2.2).applyMatrix4(m);
}

// --- the whole village ------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @returns {{ group, colliders, update(dt, camera, night), topAt(x, z), stats }}
 */
export function buildBerk(scene, { quality = "medium", excludeFromReflection = null } = {}) {
  const t0 = performance.now();
  const rnd = mulberry(1203);
  const group = new THREE.Group();
  group.name = "berk";
  const colliders = new THREE.Group();
  colliders.name = "berk-colliders";
  const mat = berkMaterial();
  const U = berkUniforms();
  const fires = [];
  const smoke = [];
  const mouthX = HARBOUR.spine[1].x;

  // District builders: one merged mesh each, so each can be culled whole.
  const districts = new Map();
  const D = (name) => { if (!districts.has(name)) districts.set(name, new Builder()); return districts.get(name); };

  // ---- statues -------------------------------------------------------------------
  STATUES.forEach((S, i) => {
    const b = D("statue" + i);
    // The pair face the open sea and mirror each other, each raising the arm
    // on the harbour side so the two fires frame the channel.
    const east = S.x > mouthX;
    const mm = new THREE.Matrix4().makeRotationY(S.facing ?? 0).setPosition(S.x, S.plinthH, S.z);
    if (east) mm.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    const r = buildStatue(b, mm, { seed: i + 1, helm: i === 0 ? "horns" : "wings", h: S.h });
    fires.push({ x: r.fire.x, y: r.fire.y, z: r.fire.z, s: r.fireSize, r: S.h * 1.1, big: true });
  });

  // ---- the Great Hall on its shelf in the mountainside --------------------------------
  const rot = HALL.rot ?? 0;
  const fX = Math.sin(rot), fZ = Math.cos(rot);          // out of the doors
  const aX = Math.cos(rot), aZ = -Math.sin(rot);         // across the front
  const stairTop = STAIR.pts[STAIR.pts.length - 1];
  {
    const b = D("hall");
    // Back on the shelf, so the portico and its steps end at the head of the stair.
    const reach = HALL.len / 2 + 9 + 6 * 2.2;
    const toTop = (stairTop.x - HALL.x) * fX + (stairTop.z - HALL.z) * fZ;
    const back = Math.max(0, reach - toTop + 10);
    const front = greatHall(b, fires, smoke, HALL.x - fX * back, HALL.h, HALL.z - fZ * back, rot);
    // Paving from the foot of the hall's steps to the head of the stair.
    const tp = V(stairTop.x, HALL.h, stairTop.z);
    const run = Math.hypot(tp.x - front.x, tp.z - front.z);
    if (run > 1) {
      const mid = front.clone().lerp(tp, 0.5);
      b.box(STAIR.width + 10, 1.4, run + 8, mid.x, HALL.h - 0.5, mid.z, { tile: TILE.STONE, colour: 0x9a958c }, Math.atan2(tp.x - front.x, tp.z - front.z));
    }
    for (const s of [-1, 1]) totem(b, tp.x + aX * s * (STAIR.width / 2 + 5), HALL.h, tp.z + aZ * s * (STAIR.width / 2 + 5), rnd);
  }

  // ---- the Great Stair, stone, from the cove up to the hall -----------------------
  {
    const b = D("stair");
    const P = STAIR.pts;
    for (let i = 0; i < P.length - 1; i++) {
      stoneStair(b, V(P[i].x, P[i].y, P[i].z), V(P[i + 1].x, P[i + 1].y, P[i + 1].z), STAIR.width);
    }
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)];
      const yaw = Math.atan2(c.x - a.x, c.z - a.z);
      // A landing, and a brazier either side of it.
      b.box(STAIR.width + 3, 2.4, STAIR.width + 3, p.x, p.y - 1.1, p.z, { tile: TILE.STONE, colour: 0xa49e94 }, yaw);
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);
      for (const s of [-1, 1]) {
        const bx = p.x + ux * s * (STAIR.width / 2 + 3), bz = p.z + uz * s * (STAIR.width / 2 + 3);
        b.add(lathe([[1.8, 0], [1.8, 0.8], [1.2, 1.2], [1.0, 3.2], [1.4, 3.6]], { seg: 10 }), new THREE.Matrix4().makeTranslation(bx, p.y, bz), { tile: TILE.STONE, colour: 0x9a958c });
        brazier(b, fires, bx, p.y + 3.6, bz, 0.9);
      }
    }
  }

  // ---- the harbour: wharves where the shore has a shelf, piers, ships ----------------
  const qy = HARBOUR.quayH;
  {
    const S = HARBOUR.spine;
    const shores = { "-1": [], "1": [] };
    for (let i = 1; i < S.length - 1; i++) {
      const A = S[i], B = S[i + 1];
      const L = Math.hypot(B.x - A.x, B.z - A.z);
      const tx = (B.x - A.x) / L, tz = (B.z - A.z) / L;
      for (let u = 0; u < L; u += 7) {
        const px = A.x + tx * u, pz = A.z + tz * u, hw = A.hw + (B.hw - A.hw) * (u / L);
        for (const side of [-1, 1]) {
          // Out from the spine (side -1 is west of it when the cove runs north).
          const nx = -tz * side, nz = tx * side;
          for (let r = hw * 0.2; r < hw * 2.2; r += 2.5) {
            const x = px + nx * r, z = pz + nz * r;
            if (terrainHeight(x, z) > 0.4) {
              shores[side].push({ x, z, nx, nz, quay: Math.abs(terrainHeight(x + nx * 7, z + nz * 7) - qy) < 1.4 && Math.abs(terrainHeight(x + nx * 12, z + nz * 12) - qy) < 2.5 });
              break;
            }
          }
        }
      }
    }
    for (const side of [-1, 1]) {
      const pts = shores[side];
      const b = D(side < 0 ? "harbourW" : "harbourE");
      let sincePier = 40;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const gap = Math.hypot(q.x - p.x, q.z - p.z);
        if (!p.quay || !q.quay || gap > 18) { sincePier += gap; continue; }
        // The wharf: a boardwalk along the water's edge on pilings.
        const x0 = p.x - p.nx * 3, z0 = p.z - p.nz * 3, x1 = q.x - q.nx * 3, z1 = q.z - q.nz * 3;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        b.box(9, 0.5, len + 0.6, (x0 + x1) / 2, qy + 0.8, (z0 + z1) / 2, { tile: TILE.OLD, colour: WOOD }, yaw);
        b.limb(V(x0 - p.nx * 4, HARBOUR.floor * 0.5, z0 - p.nz * 4), V(x0 - p.nx * 4, qy + 0.6, z0 - p.nz * 4), 0.45, 0.4, { seg: 5, tile: TILE.TIMBER, colour: 0x6a5a48 });
        if (i % 6 === 3) torch(b, fires, x0 + p.nx * 3.5, qy + 0.5, z0 + p.nz * 3.5);
        sincePier += gap;
        if (sincePier > 75 + rnd() * 40) {
          sincePier = 0;
          const plen = 28 + rnd() * 22;
          pier(b, fires, x0, z0, -p.nx, -p.nz, plen, qy + 0.8, rnd);
          if (rnd() < 0.85) {
            const along = 0.45 + rnd() * 0.2, off = (rnd() < 0.5 ? -1 : 1) * 8.5;
            longship(b, x0 - p.nx * plen * along - p.nz * off, -0.3, z0 - p.nz * plen * along + p.nx * off,
              Math.atan2(-p.nx, -p.nz), rnd, { len: 22 + rnd() * 8, sailUp: rnd() < 0.2 });
          }
        }
      }
    }
    // Ships under sail coming in through the mouth.
    const b = D("harbourE");
    const m = S[1], o = S[0];
    longship(b, m.x - 30, -0.3, (m.z + o.z) / 2, Math.atan2(m.x - o.x, m.z - o.z) + 0.08, rnd, { len: 30, sailUp: true });
    longship(b, o.x + 40, -0.3, o.z + 80, Math.atan2(m.x - o.x, m.z - o.z) - 0.1, rnd, { len: 26, sailUp: true });
  }

  // ---- houses -----------------------------------------------------------------------------
  const arch = ARCHETYPES.map(buildArchetype);
  const byName = Object.fromEntries(ARCHETYPES.map((a, i) => [a.name, i]));
  const houses = [];               // { a, x, y, z, yaw, s, colour }
  const footprints = [];           // [x, z, r] to keep clutter apart
  const free = (x, z, r) => {
    for (const f of footprints) { const dx = x - f[0], dz = z - f[1]; if (dx * dx + dz * dz < (r + f[2]) ** 2) return false; }
    return true;
  };
  const village = berkVillage();
  for (const p of village.plots) {
    if (p.kind === "square") continue;
    const a = byName[p.kind] ?? byName.cottage;
    const A = ARCHETYPES[a];
    let y = p.h;
    if (A.stilts) {
      // The deck level with the ground at its uphill side, the legs down the drop.
      let gmax = -1e9;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]]) {
        const ox = lx * (A.L / 2 + 1.4) * p.s, oz = lz * (A.W / 2 + 1.4) * p.s;
        gmax = Math.max(gmax, terrainHeight(p.x + ox * c + oz * s, p.z - ox * s + oz * c));
      }
      y = gmax + 0.4 - (A.stilts + 0.6) * p.s;
    }
    const colour = new THREE.Color(roofColour(rnd)).multiplyScalar(0.85 + rnd() * 0.3);
    houses.push({ a, x: p.x, y, z: p.z, yaw: p.yaw, s: p.s, colour });
    footprints.push([p.x, p.z, Math.hypot(A.L, A.W) * 0.5 * p.s]);
  }
  // Keep clutter off the hall, the stair and the statues.
  footprints.push([HALL.x, HALL.z, Math.hypot(HALL.pad.ax, HALL.pad.az)]);
  for (const S of STATUES) footprints.push([S.x, S.z, S.plinthR]);
  for (let i = 0; i < STAIR.pts.length - 1; i++) {
    const a = STAIR.pts[i], c = STAIR.pts[i + 1];
    for (let t = 0; t <= 1; t += 0.1) footprints.push([a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t, STAIR.width / 2 + 3]);
  }

  // ---- paths: steps up the steep bits, walkways over the drops --------------------------
  const cellName = (x, z) => "v" + Math.floor(x / 320) + "_" + Math.floor(z / 320);
  // Each path is walked in short pieces, so the steps follow the hill rather
  // than ruling a line across it: a flight where a piece is steep, a walkway
  // on posts where the ground drops away under it, trodden earth otherwise.
  for (const P of village.paths) {
    const run = Math.hypot(P.b.x - P.a.x, P.b.z - P.a.z);
    if (run < 5) continue;
    const n = Math.max(1, Math.ceil(run / 15));
    const b = D(cellName(P.a.x, P.a.z));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = P.a.x + (P.b.x - P.a.x) * t0, z0 = P.a.z + (P.b.z - P.a.z) * t0;
      const x1 = P.a.x + (P.b.x - P.a.x) * t1, z1 = P.a.z + (P.b.z - P.a.z) * t1;
      const y0 = terrainHeight(x0, z0), y1 = terrainHeight(x1, z1);
      const len = run / n;
      const mid = terrainHeight((x0 + x1) / 2, (z0 + z1) / 2);
      const dip = (y0 + y1) / 2 - mid, bump = -dip;
      if (y0 < 0.5 || y1 < 0.5) continue;
      if (dip > 3 && Math.abs(y1 - y0) < 3) {
        walkway(b, fires, V(x0, 0, z0), V(x1, 0, z1), Math.max(y0, y1) + 0.3, 2.6, dip + 3, 0);
      } else if (Math.abs(y1 - y0) / len > 0.3 && bump < 2.5) {
        const lo = y0 < y1 ? V(x0, y0, z0) : V(x1, y1, z1), hi = y0 < y1 ? V(x1, y1, z1) : V(x0, y0, z0);
        stairFlight(b, fires, lo, hi, P.shore ? 2.6 : 2.2, { posts: 2.5, rail: hi.y - lo.y > 5 });
      }
    }
  }
  // Torches at some doors; braziers on the bigger houses' porches.
  houses.forEach((h, i) => {
    if (i % 4) return;
    const A = ARCHETYPES[h.a];
    const o = (A.W / 2 + 2.2) * h.s;
    const x = h.x + Math.sin(h.yaw) * o + Math.cos(h.yaw) * (A.L / 2 - 1) * h.s, z = h.z + Math.cos(h.yaw) * o - Math.sin(h.yaw) * (A.L / 2 - 1) * h.s;
    if (A.stilts) return;
    torch(D(cellName(h.x, h.z)), fires, x, terrainHeight(x, z) - 0.1, z);
  });

  // ---- watchtowers, beacons and catapults on the heights round the mouth ------------------
  const highest = (cx, cz, r) => {
    let best = { x: cx, z: cz, y: terrainHeight(cx, cz) };
    for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) {
      const y = terrainHeight(cx + dx, cz + dz);
      if (y > best.y && free(cx + dx, cz + dz, 6)) best = { x: cx + dx, z: cz + dz, y };
    }
    return best;
  };
  const harbourC = HARBOUR.spine[Math.floor(HARBOUR.spine.length / 2)];
  const extras = { feeding: 0, stables: 0 };
  HEADLANDS.forEach((Hd, i) => {
    const b = D("headland" + i);
    const t = highest(Hd.a.x + (Hd.b.x - Hd.a.x) * 0.7, Hd.a.z + (Hd.b.z - Hd.a.z) * 0.7, 40);
    tower(b, fires, t.x, t.y - 0.5, t.z, Math.atan2(harbourC.x - t.x, harbourC.z - t.z), { h: 26, roof: 0x7a3022, beacon: true });
    footprints.push([t.x, t.z, 9]);
    const c = highest(Hd.b.x + (Hd.a.x - Hd.b.x) * 0.15, Hd.b.z + (Hd.a.z - Hd.b.z) * 0.15, 26);
    if (free(c.x, c.z, 7)) { catapult(b, c.x, c.y - 0.3, c.z, 0); footprints.push([c.x, c.z, 7]); }
    const d = highest(Hd.a.x + (Hd.b.x - Hd.a.x) * 0.45, Hd.a.z + (Hd.b.z - Hd.a.z) * 0.45, 30);
    if (free(d.x, d.z, 4)) { ballista(b, d.x, d.y - 0.2, d.z, Math.PI); footprints.push([d.x, d.z, 4]); }
  });
  {
    const b = D("rock");
    const t = highest(ROCK.x, ROCK.z, ROCK.topR * 0.8);
    tower(b, fires, t.x, t.y - 0.5, t.z, 0, { h: 22, roof: 0x7a3022, beacon: true });
    footprints.push([t.x, t.z, 9]);
  }

  // ---- squares: a feeding station in the thick of each part of the village ---------------
  // berklayout.js keeps the most level open ground by each of the village's
  // cores clear of houses ("square" plots, levelled by terrain.js).
  for (const p of village.plots) {
    if (p.kind !== "square") continue;
    const b = D(cellName(p.x, p.z));
    feedingStation(b, p.x, p.h, p.z, rnd);
    const cx = Math.cos(p.yaw), cz = -Math.sin(p.yaw);
    for (const s of [-1, 1]) brazier(b, fires, p.x + cx * s * 10, p.h, p.z + cz * s * 10, 1.0);
    totem(b, p.x - Math.sin(p.yaw) * 10, p.h, p.z - Math.cos(p.yaw) * 10, rnd);
    banner(b, p.x + Math.sin(p.yaw) * 11, p.h, p.z + Math.cos(p.yaw) * 11, p.yaw, 0x8e3a2a);
    footprints.push([p.x, p.z, 15]);
    extras.feeding++;
  }

  // ---- dragon stables, wherever the hill gives a long enough level stretch -----------------
  {
    const V_ = VILLAGE;
    const found = [];
    for (let gz = V_.cz - V_.rz * 0.8; gz < V_.cz + V_.rz * 0.8 && found.length < 3; gz += 23) {
      for (let gx = V_.cx - V_.rx * 0.8; gx < V_.cx + V_.rx * 0.8 && found.length < 3; gx += 23) {
        const y = terrainHeight(gx, gz);
        if (y < 12 || y > 160) continue;
        // Along the contour: across the slope's fall line.
        const sx = terrainHeight(gx + 10, gz) - terrainHeight(gx - 10, gz), sz = terrainHeight(gx, gz + 10) - terrainHeight(gx, gz - 10);
        const yaw = Math.atan2(-sx, -sz);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        let lo = 1e9, hi = -1e9;
        for (const [lx, lz] of [[-21, -7], [21, -7], [-21, 7], [21, 7], [0, 0]]) {
          const g = terrainHeight(gx + lx * c + lz * s, gz - lx * s + lz * c);
          lo = Math.min(lo, g); hi = Math.max(hi, g);
        }
        if (hi - lo > 2.6 || !free(gx, gz, 26) || found.some((f) => Math.hypot(f.x - gx, f.z - gz) < 300)) continue;
        found.push({ x: gx, z: gz });
        stable(D(cellName(gx, gz)), gx, hi - 0.4, gz, yaw, roofColour(rnd));
        footprints.push([gx, gz, 24]);
        extras.stables++;
      }
    }
  }

  // ---- meshes ----------------------------------------------------------------------------
  // Districts: one merged mesh each.
  const districtMeshes = [];
  let tris = 0;
  for (const [name, b] of districts) {
    if (!b.triCount) continue;
    const g = b.build();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "berk-" + name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    tris += b.triCount;
    // The same triangles are what he stands on and flies into.
    const cm = new THREE.Mesh(g, mat);
    cm.name = "berk-solid-" + name;
    colliders.add(cm);
    g.computeBoundingSphere();
    districtMeshes.push({ mesh, c: g.boundingSphere.center.clone(), r: g.boundingSphere.radius, big: /statue|hall/.test(name) });
  }
  // The terraces' clutter is up the hillsides, where the harbour's mirror
  // barely sees it; the statues, the hall and the wharves stay reflected.
  excludeFromReflection?.(...districtMeshes.filter((d) => /berk-v|stair|square/.test(d.mesh.name)).map((d) => d.mesh));

  // Houses: per archetype one detailed and one far InstancedMesh. Which
  // instance is in which is redone as the camera moves.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const per = arch.map(() => []);
  houses.forEach((h, i) => {
    per[h.a].push(i);
    h.m = new THREE.Matrix4().compose(_p.set(h.x, h.y, h.z), _q.setFromAxisAngle(_Y, h.yaw), _s.setScalar(h.s));
    if (arch[h.a].chimney && rnd() < 0.22) smoke.push(arch[h.a].chimney.clone().applyMatrix4(h.m));
  });
  // Three tiers: detailed and shadow-casting close in (an InstancedMesh casts
  // every instance into the shadow map, so only the closest are allowed to),
  // detailed without shadows a little further, block-and-roof beyond.
  const sets = arch.map((A, a) => {
    const n = Math.max(1, per[a].length);
    const near = new THREE.InstancedMesh(A.detail, mat, n);
    const mid = new THREE.InstancedMesh(A.detail, mat, n);
    const far = new THREE.InstancedMesh(A.far, mat, n);
    near.name = "berk-houses-" + ARCHETYPES[a].name; mid.name = near.name + "-mid"; far.name = near.name + "-far";
    near.castShadow = true; near.receiveShadow = true; mid.receiveShadow = true; far.receiveShadow = true;
    for (const im of [near, mid, far]) {
      im.count = 0;
      for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(1, 1, 1));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
    }
    return { near, mid, far, list: per[a] };
  });
  // The houses stay out of the sea's mirror: up on the terraces, the harbour
  // barely reflects them, and they are most of Berk's triangles.
  excludeFromReflection?.(...sets.flatMap((S) => [S.near, S.mid, S.far]));
  // Collision for the houses: the block-and-roof shapes, merged per district.
  {
    const parts = new Map();
    const P = (k) => { if (!parts.has(k)) parts.set(k, []); return parts.get(k); };
    for (const h of houses) {
      const g = arch[h.a].collide.clone().applyMatrix4(h.m);
      P(Math.round(h.x / 400) + ":" + Math.round(h.z / 400)).push(g);
    }
    for (const [k, list] of parts) {
      const pos = [];
      for (const g of list) { pos.push(...g.attributes.position.array); g.dispose(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const cm = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      cm.name = "berk-houses-solid-" + k;
      colliders.add(cm);
    }
  }

  const SHADOW = quality === "low" ? 0 : 200;
  const DETAIL = quality === "low" ? 300 : 460;
  let lastCam = new THREE.Vector3(1e9, 0, 0);
  const tier = new Uint8Array(houses.length);       // 0 near, 1 mid, 2 far
  function partition(cam) {
    const s2 = SHADOW * SHADOW, d2n = DETAIL * DETAIL;
    const hs2 = (SHADOW + 30) ** 2, hd2 = (DETAIL + 40) ** 2;
    for (let a = 0; a < sets.length; a++) {
      const S = sets[a];
      const cnt = [0, 0, 0], ims = [S.near, S.mid, S.far];
      for (const i of S.list) {
        const h = houses[i];
        const dx = h.x - cam.x, dy = h.y - cam.y, dz = h.z - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        // A little hysteresis, so a house on a boundary does not flicker.
        const t = d2 < (tier[i] === 0 ? hs2 : s2) ? 0 : d2 < (tier[i] <= 1 ? hd2 : d2n) ? 1 : 2;
        tier[i] = t;
        const im = ims[t], k = cnt[t]++;
        im.setMatrixAt(k, h.m);
        im.setColorAt(k, h.colour);
      }
      for (const [im, c] of [[S.near, cnt[0]], [S.mid, cnt[1]], [S.far, cnt[2]]]) {
        im.count = c;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.boundingSphere = null;
        im.visible = c > 0;
      }
    }
  }

  // Fire, glow and smoke.
  const flames = makeFlames(fires);
  const glows = makeGlows(fires);
  const smokePts = makeSmoke(smoke, 4);
  group.add(flames, glows, smokePts);
  // Fake firelight sources: the statues' and the hall's braziers always, plus
  // whichever torches are nearest the camera.
  const fireD = new Float32Array(fires.length);
  const order = fires.map((_, i) => i);

  scene.add(group);
  colliders.updateMatrixWorld(true);
  const solid = [];
  colliders.traverse((o) => { if (o.isMesh) solid.push(o); });

  // Downward rays for the flight floor.
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const DOWN = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
  const boxes = new Map();
  const box = (m) => {
    if (!boxes.has(m)) { m.geometry.computeBoundingBox(); boxes.set(m, m.geometry.boundingBox); }
    return boxes.get(m);
  };
  const bounds = new THREE.Box3();
  for (const m of solid) bounds.union(box(m));

  let time = 0, acc = 1;
  const stats = { houses: houses.length, fires: fires.length, chimneys: smoke.length, tris, ms: 0 };
  stats.ms = Math.round(performance.now() - t0);
  console.info(`berk: ${houses.length} houses in ${arch.length} kinds, ${village.paths.length} paths, ${extras.stables} stables, ${extras.feeding} feeding stations, ${districts.size} districts (${(tris / 1000).toFixed(0)}k tris merged), ${fires.length} fires, ${smoke.length} chimneys, ${stats.ms} ms`);

  return {
    group, colliders, stats, houses, fires,
    /** Highest Berk surface under (x, z), or -Infinity. For the flight floor. */
    topAt(x, z) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) return -Infinity;
      let top = -Infinity;
      for (const m of solid) {
        const bb = box(m);
        if (x < bb.min.x || x > bb.max.x || z < bb.min.z || z > bb.max.z || bb.max.y < top) continue;
        _o.set(x, bb.max.y + 1, z);
        ray.set(_o, DOWN); ray.far = bb.max.y + 1 - Math.max(top, bb.min.y - 1);
        const hit = ray.intersectObject(m, false)[0];
        if (hit && hit.point.y > top) top = hit.point.y;
      }
      return top;
    },
    update(dt, camera, night = 0) {
      time += dt;
      U.uTime.value = time;
      U.uNight.value = night;
      const cp = camera.position;
      acc += dt;
      if (acc > 0.3 && cp.distanceToSquared(lastCam) > 15 * 15) {
        acc = 0; lastCam.copy(cp);
        partition(cp);
        for (const d of districtMeshes) {
          // The small districts are clutter beyond a couple of kilometres; the
          // statues and the hall are landmarks and always stand. Only what
          // is close casts into the shadow map, which is a few hundred
          // metres across and would otherwise be handed the whole village.
          const gap = cp.distanceTo(d.c) - d.r;
          d.mesh.visible = d.big || gap < 2200;
          d.mesh.castShadow = gap < 300;
        }
      }
      // The nearest fires light the stone round them.
      for (let i = 0; i < fires.length; i++) {
        const f = fires[i];
        const dx = f.x - cp.x, dy = f.y - cp.y, dz = f.z - cp.z;
        fireD[i] = (dx * dx + dy * dy + dz * dz) / (f.big ? 1e4 : f.r * f.r);
      }
      order.sort((a, b) => fireD[a] - fireD[b]);
      const n = Math.min(MAX_FIRES, fires.length);
      for (let i = 0; i < n; i++) {
        const f = fires[order[i]];
        U.uFires.value[i].set(f.x, f.y + f.s * 0.4, f.z, f.r);
      }
      U.uFireN.value = n;
    },
    dispose() { scene.remove(group); },
  };
}
