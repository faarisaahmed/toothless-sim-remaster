import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { noise2, fbm } from "./terrain.js";
import { addPhotoreal } from "./photoreal.js";
import { slots, alloyMaterial } from "./props.js";
import { rng, canvas, tex, shrubTexture, woodTexture, bushGeometry } from "./basedetail.js";

// ---------------------------------------------------------------------------
// Hollow Stack, lived in.
//
// The camp was three props on a lawn: a lean-to, a stone slab and a rack,
// with trees standing round them as though somebody had set a picnic down in
// a park. A dragon alone on a sea stack in the North Atlantic lives somewhere
// rougher than that, and somewhere more his: rock breaking through thin turf,
// thrift and heather in the cracks, the wind bending everything that grows
// one way, a bed of bracken dragged under the sail, fish bones where he eats,
// soot where he practises, a hoard of the bright things he has picked up, and
// the gulls — who were here first and are not leaving.
//
// Everything is built once, here, and costs a couple of dozen draw calls:
//
//   solid   (stack.group — surfaces.js makes it walkable)
//     rocks       one merged, vertex-coloured mesh for the camp's outcrops and
//                 the boulders across the top; another for the rim and the
//                 ledges on the cliff, so each culls on its own
//     wood        one merged mesh: the wind-bent trees, the hearth sticks, the
//                 nest of twigs
//   deco    (a sibling group — not walkable, nothing to stand on)
//     decals      trodden earth, turf and moss, scorch: ground-hugging grids
//     plants      instanced cards: grass, thrift, heather, bracken, juniper
//     gulls       instanced, sitting on the ledges and circling the stack
//     fire        flame cards that flicker, and the scraps of a dragon's meals
//
// Everything that touches the ground was placed by sampling the height field
// under it, so nothing floats and nothing is buried that should not be.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const smoothstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

/** Where the camp's things are, in stack-local metres. Kept walkable. */
export const CAMP = {
  shelter: [0, 0, 4.4],
  shelf:   [6, -4, 2.8],
  fire:    [0, 5, 2.0],
  rack:    [-6, 4, 2.4],
  nest:    [-3.6, -2.2, 1.3],
};
const PATHS = [[0, 0, 0, 5], [0, 0, 6, -4], [0, 5, -6, 4], [0, 0, -6, 4], [0, 5, 6, -4],
               [0, 5, 0, 16]];         // the way in from the open south side

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
/** Metres to the nearest thing he walks to or along; negative inside one. */
function busy(x, z) {
  let d = Infinity;
  for (const k in CAMP) { const [cx, cz, r] = CAMP[k]; d = Math.min(d, Math.hypot(x - cx, z - cz) - r); }
  for (const [ax, az, bx, bz] of PATHS) d = Math.min(d, segDist(x, z, ax, az, bx, bz) - 1.1);
  return d;
}

// --- textures ----------------------------------------------------------------

/** Rock grain: speckle, cracks and pale lichen rosettes. Multiplied by the
 *  vertex colour, so it is mostly near white. */
function rockTexture(seed) {
  const r = rng(seed), S = 256, c = canvas(S), g = c.getContext("2d");
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x * 0.045 + seed, y * 0.045, 3) * 0.5 + 0.5;
    const fine = r();
    const v = 150 + n * 80 + (fine - 0.5) * 40;
    const i = (y * S + x) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.98; img.data[i + 2] = v * 0.95; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "rgba(40,36,32,0.55)";
  for (let i = 0; i < 26; i++) {                       // cracks
    g.lineWidth = 0.6 + r() * 1.4;
    let x = r() * S, y = r() * S;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += r() * 26; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 140; i++) {                      // lichen
    const x = r() * S, y = r() * S, rad = 1.5 + Math.pow(r(), 2) * 9;
    const hue = r() < 0.7 ? "214,212,170" : r() < 0.6 ? "205,150,70" : "160,175,120";
    g.fillStyle = `rgba(${hue},${0.35 + r() * 0.45})`;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A ground patch with a ragged soft edge. `paint(g, r, S)` fills it. */
function patchTexture(seed, paint, S = 256) {
  const r = rng(seed), c = canvas(S), g = c.getContext("2d");
  paint(g, r, S);
  // Cut the edge: ragged alpha falling off toward the rim.
  const img = g.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5;
    const a = Math.atan2(dy, dx);
    const edge = 0.40 + noise2(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6) * 0.07
               + noise2(x * 0.06 + seed, y * 0.06) * 0.03;
    const k = 1 - smoothstep(Math.hypot(dx, dy), edge - 0.14, edge);
    img.data[(y * S + x) * 4 + 3] *= k;
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}
const blots = (g, r, S, n, colours, rMin, rMax, alpha = 0.7) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colours[Math.floor(r() * colours.length)];
    g.globalAlpha = alpha * (0.5 + r() * 0.5);
    g.beginPath(); g.arc(r() * S, r() * S, rMin + r() * (rMax - rMin), 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
};

const earthTexture = () => patchTexture(71, (g, r, S) => {
  g.fillStyle = "#6a5a46"; g.fillRect(0, 0, S, S);
  blots(g, r, S, 420, ["#77654e", "#665644", "#806e58", "#6e5e4a"], 3, 14, 0.45);
  blots(g, r, S, 500, ["#7a7268", "#5e5850", "#8a8378"], 0.8, 2.6, 0.9);    // grit
  blots(g, r, S, 40, ["#4d5a2e", "#3f4a26"], 3, 9, 0.45);                  // a little grass
});
const turfTexture = () => patchTexture(73, (g, r, S) => {
  g.fillStyle = "#3e4f26"; g.fillRect(0, 0, S, S);
  blots(g, r, S, 420, ["#4f6230", "#5d6f35", "#34431f", "#6d7a3c", "#465a2a"], 2, 12, 0.7);
  blots(g, r, S, 90, ["#7d8a4a", "#8e9a58"], 1, 4, 0.8);                   // moss cushions
  blots(g, r, S, 26, ["#d58ab0", "#e6a6c4"], 1.2, 2.6, 0.95);              // thrift heads
});
const mossTexture = () => patchTexture(79, (g, r, S) => {
  g.fillStyle = "#56662c"; g.fillRect(0, 0, S, S);
  blots(g, r, S, 500, ["#6e7f34", "#7f8f3c", "#4a5a24", "#93a048", "#5f6f2c"], 1.5, 7, 0.8);
});
/** Scorch: char in the middle, a brown halo, streaks blown out from it. */
function scorchTexture(seed) {
  const r = rng(seed), S = 256, c = canvas(S), g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(10,8,7,0.95)"); gr.addColorStop(0.45, "rgba(18,14,11,0.85)");
  gr.addColorStop(0.75, "rgba(48,34,24,0.45)"); gr.addColorStop(1, "rgba(60,44,30,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU, l = S * (0.28 + r() * 0.22);
    g.strokeStyle = `rgba(16,12,10,${0.2 + r() * 0.4})`;
    g.lineWidth = 2 + r() * 6;
    g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l); g.stroke();
  }
  blots(g, r, S, 60, ["#0b0908", "#1a1410"], 3, 12, 0.6);
  blots(g, r, S, 30, ["#8a8680", "#a19d96"], 1, 3, 0.5);                    // ash flecks
  return tex(c);
}
/** Bracken and hay, dragged in by the mouthful. */
function beddingTexture() {
  const r = rng(91), S = 256, c = canvas(S), g = c.getContext("2d");
  g.fillStyle = "#5a4630"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1600; i++) {
    const hues = ["#9a7c48", "#b39256", "#7a5a32", "#8c4f2a", "#a0683a", "#6b5a3a"];
    g.strokeStyle = hues[Math.floor(r() * hues.length)];
    g.globalAlpha = 0.5 + r() * 0.5; g.lineWidth = 0.8 + r() * 1.6;
    const x = r() * S, y = r() * S, a = r() * TAU, l = 6 + r() * 26;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.5, y + Math.sin(a + 0.4) * l * 0.5,
                       x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** One tongue of flame, white-gold at the root. Additive, so black is clear. */
function flameTexture() {
  const W = 64, H = 128, c = canvas(W, H), g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  for (const [w, col] of [[0.5, "#7a1e04"], [0.36, "#e0581a"], [0.22, "#ffb347"], [0.1, "#fff2c0"]]) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(W / 2, H * 0.04);
    g.bezierCurveTo(W * (0.5 + w), H * 0.45, W * (0.5 + w), H * 0.95, W / 2, H * 0.98);
    g.bezierCurveTo(W * (0.5 - w), H * 0.95, W * (0.5 - w), H * 0.45, W / 2, H * 0.04);
    g.filter = "blur(3px)";
    g.fill();
  }
  return tex(c);
}

// --- geometry ------------------------------------------------------------------

/**
 * A rock, already placed: displaced, flattened into strata, transformed to
 * where it goes, and coloured per vertex from its world-facing normals — moss
 * and turf on the tops, wet-dark at the foot, white guano streaks down the
 * sea-facing sides of anything the gulls use.
 *
 * @param o.at      THREE.Vector3, stack-local centre
 * @param o.size    [sx, sy, sz] half-extents
 * @param o.yaw
 * @param o.out     [x, z] unit vector out to sea (guano runs down this side)
 * @param o.guano   0..1
 * @param o.moss    0..1
 * @param o.scorch  {x,z} a point to scorch the faces toward, or null
 */
function rockGeometry(seed, { at, size, yaw = 0, tilt = 0, detail = 1, strata = 0.35,
                              tone = 0, bright = 1, wedge = 0, guano = 0, moss = 0.6, out = null, scorch = null }) {
  const r = rng(seed);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv");
  const p0 = g.attributes.position, v = new THREE.Vector3();
  const layers = 3 + Math.floor(r() * 3);
  for (let i = 0; i < p0.count; i++) {
    v.fromBufferAttribute(p0, i);
    const n = 1 + noise2(v.x * 1.3 + seed, v.z * 1.3 - seed) * 0.3
                + noise2(v.y * 2.7 - seed, v.x * 2.7 + v.z) * 0.14;
    v.multiplyScalar(n);
    // Strata: basalt breaks in shelves. Pull heights toward steps.
    const q = (v.y + 1) * layers * 0.5;
    v.y = lerp(v.y, (Math.round(q) / layers) * 2 - 1, strata);
    // Broader at the base, so it reads as rooted rather than set down.
    if (v.y < 0) { v.x *= 1 - v.y * 0.25; v.z *= 1 - v.y * 0.25; }
    // A ledge on a face: the underside runs back into the cliff, so it
    // grows out of the rock instead of hanging on it.
    if (wedge && v.y < 0) v.x = lerp(v.x, -1.1, Math.min(1, -v.y * wedge));
    p0.setXYZ(i, v.x, v.y, v.z);
  }
  const m = new THREE.Matrix4().compose(
    at, new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * 0.5, yaw, tilt)),
    new THREE.Vector3(...size));
  g.applyMatrix4(m);
  // Weld, so the normals come out smooth over the rounded parts; the strata
  // and the noise still give it edges where the shape has them.
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  const p = g.attributes.position;

  const N = g.attributes.normal, col = new Float32Array(p.count * 3);
  const top = at.y + size[1];
  const base = (0.12 + r() * 0.07) * bright;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
    // Grey basalt, a touch warm; darker toward the foot where it stays wet.
    let cr = base * (1.0 + tone * 0.12), cg = base * (0.97 + tone * 0.04), cb = base * (0.93 - tone * 0.05);
    const foot = 1 - smoothstep(v.y - (at.y - size[1] * 0.2), 0, size[1] * 0.7);
    const dk = 1 - foot * 0.35;
    cr *= dk; cg *= dk; cb *= dk;
    // Moss and turf on whatever faces the sky.
    const sky = smoothstep(ny, 0.45, 0.85) * moss
              * (0.55 + 0.45 * (noise2(v.x * 0.6 + seed, v.z * 0.6) * 0.5 + 0.5));
    cr = lerp(cr, 0.045, sky); cg = lerp(cg, 0.075, sky); cb = lerp(cb, 0.025, sky);
    // Guano: streaks down the seaward faces and splashes on the top.
    if (guano > 0) {
      const facing = out ? Math.max(0, nx * out[0] + nz * out[1]) : 0;
      const along = out ? v.x * out[1] - v.z * out[0] : v.x;
      const streak = Math.pow(Math.max(0, Math.sin(along * 3.1 + seed) * 0.5 + 0.5
                     + noise2(along * 1.7, seed) * 0.4), 3);
      const drip = smoothstep(v.y, top - size[1] * 2.2, top - size[1] * 0.3);
      const splash = smoothstep(ny, 0.6, 0.9) * (noise2(v.x * 1.4 - seed, v.z * 1.4) > 0.1 ? 1 : 0);
      const w = Math.min(1, guano * (smoothstep(facing, 0.05, 0.4) * streak * drip * 1.4 + splash * 0.8));
      cr = lerp(cr, 0.78, w); cg = lerp(cg, 0.77, w); cb = lerp(cb, 0.72, w);
    }
    if (scorch) {
      const dx = scorch.x - v.x, dz = scorch.z - v.z, d = Math.hypot(dx, dz) || 1;
      const face = Math.max(0, (nx * dx + nz * dz) / d);
      const s = smoothstep(face, 0.1, 0.6) * (1 - smoothstep(d, 3, 9)) * (0.7 + 0.3 * noise2(v.x * 2, v.y * 2));
      cr = lerp(cr, 0.012, s); cg = lerp(cg, 0.010, s); cb = lerp(cb, 0.009, s);
    }
    col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // Box-projected UVs, picked per face by its normal: no poles, no seams worth
  // seeing on something this rough.
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    let ax = 0, ay = 0, az = 0;
    for (let k = 0; k < 3; k++) { ax += Math.abs(N.getX(i + k)); ay += Math.abs(N.getY(i + k)); az += Math.abs(N.getZ(i + k)); }
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, w] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
      uv[(i + k) * 2] = u * 0.35; uv[(i + k) * 2 + 1] = w * 0.35;
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A crooked tube, tapering, along points. */
function limbGeometry(pts, r0, r1, seg = 10, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const rad = lerp(r0, r1, t) * (1 + Math.sin(t * 17) * 0.08);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(rad).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A fish skeleton, picked clean: head, spine, ribs, tail. */
function fishBoneGeometry() {
  const parts = [];
  const spine = new THREE.CylinderGeometry(0.012, 0.007, 0.34, 4);
  spine.rotateX(Math.PI / 2); parts.push(spine);
  for (let i = 0; i < 7; i++) {
    for (const s of [-1, 1]) {
      const rib = new THREE.CylinderGeometry(0.005, 0.003, 0.08 - i * 0.006, 3);
      rib.rotateZ(s * 1.0); rib.rotateY(s * 0.35);
      rib.translate(s * 0.03, 0.012, 0.1 - i * 0.03);
      parts.push(rib);
    }
  }
  const head = new THREE.ConeGeometry(0.04, 0.09, 5); head.rotateX(Math.PI / 2); head.scale(1, 0.75, 1);
  head.translate(0, 0.01, 0.21); parts.push(head);
  const tail = new THREE.ConeGeometry(0.045, 0.06, 3); tail.rotateX(-Math.PI / 2); tail.scale(1, 0.2, 1);
  tail.translate(0, 0, -0.2); parts.push(tail);
  for (const q of parts) { q.deleteAttribute("uv"); }
  const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

/** Vertex-coloured gulls. Herring gull: white, silver-grey back, black tips. */
function gullFlyGeometry() {
  // Forward is +z. Wings are a shallow M: up to the wrist, down to the tip.
  const W = [0, 0.0, 0], P = [];
  const quad = (a, b, c, col) => P.push([a, b, c, col]);
  const rootF = [0.06, 0, 0.12], rootB = [0.06, 0, -0.1], wrist = [0.42, 0.1, 0.06], wristB = [0.42, 0.1, -0.12],
        tip = [0.82, -0.04, -0.14];
  const white = [0.85, 0.86, 0.86], grey = [0.5, 0.53, 0.57], black = [0.05, 0.05, 0.05];
  for (const s of [-1, 1]) {
    const f = (q) => [q[0] * s, q[1], q[2]];
    quad(f(rootF), f(wrist), f(rootB), grey);
    quad(f(rootB), f(wrist), f(wristB), grey);
    quad(f(wrist), f(tip), f(wristB), black);
  }
  quad([0, 0.04, 0.32], [-0.07, 0, 0.0], [0.07, 0, 0.0], white);   // body top
  quad([-0.07, 0, 0.0], [0, 0.02, -0.3], [0.07, 0, 0.0], white);
  quad([0, -0.05, 0.12], [-0.07, 0, 0.0], [0.07, 0, 0.0], white);
  void W;
  const pos = [], col = [];
  for (const [a, b, c, cc] of P) { pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) col.push(...cc); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function gullSitGeometry() {
  const part = (geo, colour, sx, sy, sz, x, y, z) => {
    geo.scale(sx, sy, sz); geo.translate(x, y, z);
    geo.deleteAttribute("uv");
    const g = geo.toNonIndexed();
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set(colour, i);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  };
  const S = () => new THREE.SphereGeometry(1, 5, 3);
  const g = mergeGeometries([
    part(S(), [0.85, 0.86, 0.86], 0.11, 0.1, 0.2, 0, 0.13, 0),           // body
    part(S(), [0.48, 0.51, 0.55], 0.12, 0.06, 0.2, 0, 0.18, -0.04),      // folded wings
    part(new THREE.ConeGeometry(1, 1, 4).rotateX(-Math.PI / 2), [0.05, 0.05, 0.05], 0.07, 0.03, 0.14, 0, 0.17, -0.24),
    part(S(), [0.88, 0.88, 0.88], 0.065, 0.065, 0.07, 0, 0.27, 0.13),    // head
    part(new THREE.ConeGeometry(1, 1, 4).rotateX(Math.PI / 2), [0.85, 0.7, 0.15], 0.016, 0.016, 0.07, 0, 0.26, 0.22),
  ]);
  g.computeVertexNormals();
  return g;
}

// --- the dressing --------------------------------------------------------------

/**
 * @param {object} o
 *   group     the stack's solid group, origin at the camp centre on the ground
 *   deco      a sibling group with the same transform, for what is not solid
 *   gy        (lx, lz) => ground height in the groups' local space
 *   seaY      sea level in local space (so nothing is put in the water)
 */
export function dressHollowStack({ group, deco, gy, seaY = -100 }) {
  const t0 = performance.now();
  const r = rng(4021);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const S = slots();

  /** Lowest ground under a footprint — sit on this and nothing floats. */
  const floor = (x, z, rad) => {
    let m = gy(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      m = Math.min(m, gy(x + Math.cos(a) * rad, z + Math.sin(a) * rad));
    }
    return m;
  };
  const flatAt = (x, z, e = 2) =>
    Math.max(Math.abs(gy(x + e, z) - gy(x - e, z)), Math.abs(gy(x, z + e) - gy(x, z - e))) / (2 * e);

  // ---- materials -------------------------------------------------------------
  const rockMat = addPhotoreal(new THREE.MeshStandardMaterial({
    map: rockTexture(17), vertexColors: true, roughness: 0.93, metalness: 0,
  }));
  const woodMat = addPhotoreal(new THREE.MeshStandardMaterial({
    map: woodTexture(31, "#5f5546", "#2c241b"), roughness: 0.92,
  }));
  const decal = (map, { rough = 0.95, color = 0xffffff, order = 0 } = {}) => {
    const m = addPhotoreal(new THREE.MeshStandardMaterial({
      map, color, roughness: rough, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3 - order, polygonOffsetUnits: -6 - order * 2,
    }));
    return m;
  };
  const earthMat = decal(earthTexture());
  earthMat.opacity = 0.8;
  const turfMat = decal(turfTexture(), { order: 1 });
  const mossMat = decal(mossTexture(), { order: 1 });
  const scorchMat = decal(scorchTexture(5), { order: 2 });
  scorchMat.opacity = 0.85;
  const alphaCut = (m, key) => {
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("normal *= faceDirection;", ""); };
    m.customProgramCacheKey = () => key;
    return addPhotoreal(m);
  };
  const card = (opts, key) => alphaCut(new THREE.MeshStandardMaterial({
    map: shrubTexture(opts), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 }), key);
  const PLANTS = {
    grass:   { geo: bushGeometry(3, 0.25), mat: card({ seed: 41, strokes: 300, hues: [[62, 0.30, 0.36], [48, 0.30, 0.46], [78, 0.28, 0.30], [42, 0.26, 0.52], [70, 0.3, 0.26]] }, "stk-grass") },
    thrift:  { geo: bushGeometry(4, 0.6),  mat: card({ seed: 43, strokes: 520, hues: [[95, 0.32, 0.26], [85, 0.3, 0.32]], flowers: { n: 46, color: "#e59bc0" } }, "stk-thrift") },
    heather: { geo: bushGeometry(5, 0.5),  mat: card({ seed: 47, strokes: 900, hues: [[22, 0.2, 0.32], [320, 0.12, 0.38], [335, 0.16, 0.44], [50, 0.2, 0.32], [30, 0.22, 0.36]] }, "stk-heather") },
    bracken: { geo: bushGeometry(4, 0.45), mat: card({ seed: 53, strokes: 380, hues: [[28, 0.5, 0.32], [36, 0.45, 0.38], [80, 0.35, 0.3], [22, 0.5, 0.26]] }, "stk-bracken") },
    juniper: { geo: bushGeometry(6, 0.3),  mat: card({ seed: 59, strokes: 1300, hues: [[150, 0.25, 0.16], [130, 0.22, 0.2], [100, 0.2, 0.22]] }, "stk-juniper") },
  };
  const plantLists = { camp: {}, rim: {} };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const plant = (where, kind, x, z, s, { stretch = 1, lean = 0, leanDir = 0, y = null, sink = 0.06 } = {}) => {
    const h = y ?? gy(x, z);
    if (y === null && h < seaY + 2) return;
    e.set(Math.cos(leanDir) * lean, r() * TAU, Math.sin(leanDir) * lean);
    q.setFromEuler(e);
    m4.compose(V(x, h - s * sink, z), q, V(s * stretch, s * (0.8 + r() * 0.4), s / stretch));
    (plantLists[where][kind] ||= []).push(m4.clone());
  };

  // ---- geometry buckets ------------------------------------------------------
  const campRocks = [], rimRocks = [], wood = [];
  const decals = { earth: [], turf: [], moss: [], scorch: [] };
  const sitGulls = [];
  let rockSeed = 100;

  /** A ground-hugging grid, `lift` above the height field. */
  const ground = (bucket, cx, cz, w, l, rot = 0, { lift = 0.05, n = null, y = null } = {}) => {
    const nx = n ?? Math.max(2, Math.ceil(w / 1.2)), nz = n ?? Math.max(2, Math.ceil(l / 1.2));
    const g = new THREE.PlaneGeometry(w, l, nx, nz);
    g.rotateX(-Math.PI / 2); g.rotateY(rot); g.translate(cx, 0, cz);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (y ?? gy(p.getX(i), p.getZ(i))) + lift);
    g.computeVertexNormals();
    decals[bucket].push(g);
  };

  /** Put a rock in, bedded: centre below the lowest ground under it. */
  const rock = (bucket, x, z, sx, sy, sz, o = {}) => {
    const foot = floor(x, z, Math.max(sx, sz) * 0.8);
    const y = foot + sy * (o.rise ?? 0.25);
    const g = rockGeometry(rockSeed++, { at: V(x, y, z), size: [sx, sy, sz], yaw: o.yaw ?? r() * TAU,
      tilt: o.tilt ?? (r() - 0.5) * 0.2, detail: o.detail ?? (Math.max(sx, sy, sz) > 3.0 ? 3 : Math.max(sx, sy, sz) > 1.4 ? 2 : 1),
      strata: o.strata ?? 0.35, tone: r() < 0.35 ? 1 : 0, guano: o.guano ?? 0, moss: o.moss ?? 0.7,
      out: o.out ?? null, scorch: o.scorch ?? null, bright: o.bright ?? 1 });
    bucket.push(g);
    return y + sy * 0.9;                       // roughly the top
  };

  // ---- the hollow: outcrops wrapped round the camp's back ---------------------
  // Open to the south, where the fire is and where he comes in; a broken wall
  // of rock round the north, west and east, the shelter in its lee. The rock
  // behind the lab shelf is the backstop for every shot he has fired at it.
  const shelfAt = { x: CAMP.shelf[0], z: CAMP.shelf[1] };
  const outcrops = [
    // [angle (0 = +x, -90 = north), radius, size, tallness]
    [-178, 14, 2.4, 1.0], [-160, 15.5, 3.2, 1.3], [-140, 13.5, 2.6, 1.6],
    [-122, 15, 3.6, 1.9], [-104, 13, 2.8, 2.2], [-88, 14.5, 4.2, 2.6],
    [-70, 13, 3.0, 2.0], [-52, 12.5, 2.8, 1.7], [-36, 14, 3.4, 1.5],
    [-18, 15.5, 2.6, 1.1], [2, 17, 2.2, 0.9], [168, 18, 2.0, 0.8],
  ];
  for (const [deg, rad, s, tall] of outcrops) {
    const a = THREE.MathUtils.degToRad(deg + (r() - 0.5) * 6);
    const ux = Math.cos(a), uz = Math.sin(a);
    const x = ux * rad, z = uz * rad;
    const scorch = Math.hypot(x - shelfAt.x, z - shelfAt.z) < 10 && deg > -60 && deg < 0 ? shelfAt : null;
    const top = rock(campRocks, x, z, s, tall, s * (0.55 + r() * 0.3),
      { yaw: a + Math.PI / 2 + (r() - 0.5) * 0.5, rise: 0.35, scorch, moss: 0.8 });
    // Smaller blocks fallen off it, on both sides, and turf crept up its foot.
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
      const off = (r() - 0.5) * s * 2.6, outw = (r() - 0.2) * s * 1.2;
      const bx = x + -uz * off + ux * outw, bz = z + ux * off + uz * outw;
      if (busy(bx, bz) < 1.2) continue;
      const bs = 0.35 + r() * 0.8;
      rock(campRocks, bx, bz, bs, bs * (0.5 + r() * 0.4), bs * (0.7 + r() * 0.3), { rise: 0.2, scorch });
    }
    ground("turf", x - ux * s * 0.9, z - uz * s * 0.9, s * 2.6, s * 1.4, -a + Math.PI / 2);
    // Plants in the lee and at the foot, where the soil has gathered.
    for (let k = 0; k < 14; k++) {
      const off = (r() - 0.5) * s * 2.4, inw = s * (0.7 + r() * 1.6);
      const px = x + -uz * off - ux * inw, pz = z + ux * off - uz * inw;
      if (busy(px, pz) < 0.8) continue;
      const pick = r();
      if (pick < 0.35) plant("camp", "grass", px, pz, 0.35 + r() * 0.35);
      else if (pick < 0.55) plant("camp", "heather", px, pz, 0.4 + r() * 0.4, { stretch: 1.3 });
      else if (pick < 0.75) plant("camp", "bracken", px, pz, 0.55 + r() * 0.5);
      else plant("camp", "thrift", px, pz, 0.22 + r() * 0.16);
    }
    // Moss and thrift on the top of the bigger ones.
    if (tall > 1.4) plant("camp", "thrift", x, z, 0.3, { y: top - 0.25 });
  }
  // A flat stone he guts fish on, by the rack.
  rock(campRocks, CAMP.rack[0] - 2.6, CAMP.rack[1] + 1.4, 0.75, 0.22, 0.55, { rise: 0.6, strata: 0.8, moss: 0.2 });

  // ---- wind-bent trees in the lee of the outcrops ------------------------------
  // The wind comes off the open sea from the west; everything up here leans east.
  const tree = (x, z, h, seed) => {
    const tr = rng(seed);
    const y = floor(x, z, 0.4) - 0.15;
    const lean = 0.35 + tr() * 0.25;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      pts.push(V(x + Math.pow(t, 1.6) * h * lean * 1.4 + (tr() - 0.5) * 0.15,
                 y + t * h * (1 - t * 0.25), z + (tr() - 0.5) * 0.3 * t));
    }
    wood.push(limbGeometry(pts, 0.17 * h / 3, 0.04, 12, 6));
    const tips = [pts[5]];
    for (let b = 0; b < 3; b++) {
      const from = pts[2 + b].clone();
      const dir = V(0.7 + tr() * 0.4, 0.25 + tr() * 0.3, (tr() - 0.5) * 1.4).normalize();
      const len = h * (0.35 + tr() * 0.2);
      const mid = from.clone().addScaledVector(dir, len * 0.5); mid.y += 0.1;
      const end = from.clone().addScaledVector(dir, len);
      wood.push(limbGeometry([from, mid, end], 0.07 * h / 3, 0.02, 5, 5));
      tips.push(end);
    }
    // Foliage only on the lee side of each tip: flagged, like a real one.
    for (const tip of tips) {
      for (let k = 0; k < 2; k++) {
        plant("camp", "juniper", tip.x + 0.3 + tr() * 0.5, tip.z + (tr() - 0.5) * 0.7, 0.9 + tr() * 0.6,
          { y: tip.y - 0.45 + tr() * 0.2, stretch: 1.7, lean: 0.25, leanDir: Math.PI, sink: 0 });
      }
    }
  };
  // Inside the ring of rock, in its lee: the only places one could take.
  tree(-11.5, -4.5, 3.6, 7);
  tree(-5, -10.5, 3.0, 11);
  tree(11.5, -9.5, 2.8, 13);
  tree(-13, 8, 2.6, 17);

  // Juniper mats, crouched in the lee of the rock.
  for (let k = 0; k < 16; k++) {
    const a = THREE.MathUtils.degToRad(-185 + r() * 200), rad = 9.5 + r() * 9;
    const x = Math.cos(a) * rad + 1.5, z = Math.sin(a) * rad;
    if (busy(x, z) < 1.5) continue;
    plant("camp", "juniper", x, z, 0.7 + r() * 0.8, { stretch: 1.6, lean: 0.12 });
  }

  // ---- the hearth ---------------------------------------------------------------
  const [fx, fz] = CAMP.fire;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + r() * 0.2;
    rock(campRocks, fx + Math.cos(a) * 1.05, fz + Math.sin(a) * 1.05, 0.22 + r() * 0.1, 0.16 + r() * 0.06,
      0.18 + r() * 0.08, { rise: 0.55, moss: 0, scorch: { x: fx, z: fz }, detail: 1 });
  }
  ground("scorch", fx, fz, 4.6, 4.6, r() * TAU, { lift: 0.07 });
  // Charred sticks in the ash, crossed.
  for (let k = 0; k < 5; k++) {
    const a = r() * TAU, l = 0.6 + r() * 0.4, y0 = gy(fx, fz) + 0.08;
    const x0 = fx + Math.cos(a) * 0.15, z0 = fz + Math.sin(a) * 0.15;
    wood.push(limbGeometry([V(x0 - Math.cos(a) * l * 0.5, y0 + 0.05, z0 - Math.sin(a) * l * 0.5),
      V(x0, y0 + 0.12, z0), V(x0 + Math.cos(a) * l * 0.5, y0 + 0.03, z0 + Math.sin(a) * l * 0.5)], 0.045, 0.03, 4, 5));
  }

  // ---- the lab: scorch on the slab, a blast fan on the ground --------------------
  const shelfTop = floor(shelfAt.x, shelfAt.z, 1.4) + 0.535;
  ground("scorch", shelfAt.x, shelfAt.z, 2.0, 2.0, 0.7, { lift: 0, n: 2, y: shelfTop });
  ground("scorch", shelfAt.x + 2.2, shelfAt.z - 1.9, 3.8, 2.6, 0.75, { lift: 0.06 });   // the overshoot
  ground("scorch", shelfAt.x - 2.1, shelfAt.z + 1.6, 1.8, 1.4, 0.4, { lift: 0.06 });    // a miss

  // ---- trodden earth -----------------------------------------------------------
  for (const [ax, az, bx, bz] of PATHS) {
    const l = Math.hypot(bx - ax, bz - az) + 1.6;
    ground("earth", (ax + bx) / 2, (az + bz) / 2, 2.0 + r() * 0.5, l, Math.atan2(bx - ax, bz - az));
  }
  ground("earth", 0, 0.6, 8.5, 7.5, 0.2);                   // the shelter's floor, worn bare
  ground("earth", fx, fz, 5.6, 5.0, 0.6);                   // round the fire
  ground("earth", CAMP.rack[0], CAMP.rack[1], 4.2, 3.4, 0.2);
  ground("earth", shelfAt.x, shelfAt.z, 5.0, 4.6, 0.9);
  ground("earth", 0, 13, 9, 10, 0.1);                       // where he lands and takes off

  // ---- turf, moss and plants across the top ------------------------------------
  // Densest in a ring round the camp — the trodden middle is earth, the rock
  // breaks the wind behind — then a scatter out across the plateau.
  for (let k = 0; k < 70; k++) {
    const a = r() * TAU, rad = 6 + Math.pow(r(), 0.7) * 34;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (busy(x, z) < 2.2) continue;
    if (flatAt(x, z) > 0.25) continue;
    ground(r() < 0.6 ? "turf" : "moss", x, z, 1.6 + r() * 3.4, 1.4 + r() * 2.6, r() * TAU);
  }
  for (let z = -60; z <= 60; z += 1.3) {
    for (let x = -60; x <= 60; x += 1.3) {
      const px = x + (r() - 0.5) * 1.3, pz = z + (r() - 0.5) * 1.3;
      const d = Math.hypot(px, pz);
      if (d > 60) continue;
      const b = busy(px, pz);
      if (b < 0.4) continue;
      // Plants come in patches, and each patch is mostly one thing: a sweep
      // of heather, a bank of grass, a cushion of thrift, a bracken bed.
      const patch = fbm(px * 0.09 + 5, pz * 0.09 - 3, 2) * 0.5 + 0.5;
      const dens = smoothstep(b, 0.4, 3.0) * smoothstep(patch, 0.42, 0.7) * (1 - smoothstep(d, 30, 60) * 0.6);
      if (r() > dens * 0.9) continue;
      if (flatAt(px, pz) > 0.35) continue;
      const zone = noise2(px * 0.06 - 11, pz * 0.06 + 4);
      const pick = r() * 0.35 + (zone * 0.5 + 0.5) * 0.65;
      const n = 2 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const qx = px + (r() - 0.5) * 1.1, qz = pz + (r() - 0.5) * 1.1;
        if (busy(qx, qz) < 0.3) continue;
        if (pick < 0.42) plant("camp", "grass", qx, qz, 0.28 + r() * 0.3);
        else if (pick < 0.55) plant("camp", "thrift", qx, qz, 0.16 + r() * 0.14);
        else if (pick < 0.78) plant("camp", "heather", qx, qz, 0.3 + r() * 0.3, { stretch: 1.2 + r() * 0.4 });
        else plant("camp", "bracken", qx, qz, 0.45 + r() * 0.4);
      }
    }
  }
  // Boulders across the top: lone erratics and little tors.
  for (let k = 0; k < 46; k++) {
    const a = r() * TAU, rad = 24 + r() * 120;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (busy(x, z) < 6 || flatAt(x, z, 3) > 0.12) continue;
    if (gy(x, z) < -12) continue;
    const s = 0.6 + Math.pow(r(), 2) * 2.6;
    const top = rock(campRocks, x, z, s, s * (0.45 + r() * 0.5), s * (0.6 + r() * 0.4), { rise: 0.2, detail: s > 1.6 ? 2 : 1 });
    for (let j = 0; j < 6; j++) {
      const aa = r() * TAU, rr = s * (0.9 + r() * 0.7);
      plant("camp", r() < 0.6 ? "grass" : "thrift", x + Math.cos(aa) * rr, z + Math.sin(aa) * rr, 0.25 + r() * 0.3);
    }
    if (s > 1.5 && r() < 0.6) ground("moss", x, z, s * 2.8, s * 2.4, r() * TAU, { lift: 0.04 });
    void top;
  }

  // ---- the rim and the cliff -----------------------------------------------------
  // Walk out from the camp on every bearing until the ground falls away. That
  // is the lip; the face below it is found by bisecting for each depth.
  const NA = 220;
  const rim = [];
  for (let i = 0; i < NA; i++) {
    const a = (i / NA) * TAU, c = Math.cos(a), s = Math.sin(a);
    let prev = gy(c * 40, s * 40), lip = null;
    for (let rr = 44; rr < 560; rr += 3) {
      const h = gy(c * rr, s * rr);
      if (h < prev - 4.5) { lip = rr - 3; break; }
      prev = h;
    }
    if (lip === null) continue;
    const lipY = gy(c * lip, s * lip);
    if (lipY < seaY + 30) continue;           // not a cliff, a slope to a beach
    rim.push({ a, c, s, lip, lipY });
  }
  const faceAt = (p, depth) => {
    const want = p.lipY - depth;
    let lo = p.lip, hi = p.lip + 4;
    for (let k = 0; k < 40 && gy(p.c * hi, p.s * hi) > want; k++) { lo = hi; hi += 2; }
    if (gy(p.c * hi, p.s * hi) > want) return null;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (gy(p.c * mid, p.s * mid) > want) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Grass and gulls on top of a rock on the face, found by dropping a ray
  // onto the rock itself — its top is noise, and a guess either buries the
  // birds or stands them on air.
  const probe = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial());
  const down = new THREE.Raycaster(); const DOWN = V(0, -1, 0);
  const onTop = (g, p, w, nGulls, col) => {
    probe.geometry = g;
    g.computeBoundingBox(); g.computeBoundingSphere();
    const bb = g.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const tang = [-p.s, p.c];
    const drop = (o, ox) => {
      const x = cx + tang[0] * o + p.c * ox, z = cz + tang[1] * o + p.s * ox;
      down.set(V(x, bb.max.y + 1, z), DOWN);
      const hit = down.intersectObject(probe, false)[0];
      return hit && hit.face.normal.y > 0.6 ? hit.point : null;
    };
    for (let j = 0; j < 4; j++) {
      const at = drop((r() - 0.5) * w * 1.2, (r() - 0.5) * 1.6);
      if (at) plant("rim", r() < 0.5 ? "grass" : "thrift", at.x, at.z, 0.3 + r() * 0.3, { y: at.y, sink: 0.1 });
    }
    for (let j = 0; j < nGulls; j++) {
      const at = drop((r() - 0.5) * w * 1.3, r() * 1.4);
      if (at) sitGulls.push([at.x, at.y, at.z, p.a + (r() - 0.5) * 1.2]);
    }
  };
  // Colonies: gulls crowd onto some stretches of the cliff and ignore others.
  const colony = (a) => smoothstep(noise2(Math.cos(a) * 2.2 + 7, Math.sin(a) * 2.2 - 3), -0.1, 0.35);
  for (const p of rim) {
    const col = colony(p.a);
    const tang = [-p.s, p.c];
    // Along the lip: thrift cushions and grass, thickest right at the edge.
    for (let k = 0; k < 7; k++) {
      const back = Math.pow(r(), 1.5) * 9, side = (r() - 0.5) * 7;
      const rr = p.lip - back;
      const x = p.c * rr + tang[0] * side, z = p.s * rr + tang[1] * side;
      plant("rim", r() < 0.55 ? "thrift" : "grass", x, z, 0.3 + r() * 0.4);
    }
    if (r() < 0.16) {
      const rr = p.lip - 1.5 - r() * 3, side = (r() - 0.5) * 4;
      const s = 0.6 + r() * 1.4;
      rock(rimRocks, p.c * rr + tang[0] * side, p.s * rr + tang[1] * side, s, s * 0.6, s * 0.8,
        { guano: col * 0.8, out: [p.c, p.s], rise: 0.25, bright: 1.4 });
    }
    // Lip gulls.
    if (r() < col * 0.2) {
      const rr = p.lip - 0.6 - r() * 2.5, side = (r() - 0.5) * 5;
      const x = p.c * rr + tang[0] * side, z = p.s * rr + tang[1] * side;
      sitGulls.push([x, gy(x, z), z, p.a + (r() - 0.5) * 1.5]);
    }
    // The face itself: ribs of harder rock standing out of it, and ledges
    // along the bedding — where the colonies are, and a few elsewhere. Both
    // are bedded half into the cliff, so where the drawn terrain is a metre
    // in front of or behind the height field they still meet it.
    if (r() < 0.1 + col * 0.4) {
      const tall = 3.5 + r() * 4, mid = tall * 0.8 + 2 + r() * 16;
      const rf = faceAt(p, mid);
      if (rf !== null && rf - p.lip < mid * 0.9 + 6) {
        const g = rockGeometry(rockSeed++, { at: V(p.c * (rf + 0.6), p.lipY - mid, p.s * (rf + 0.6)),
          size: [2.2 + r() * 1.2, tall, 3 + r() * 3], yaw: -p.a, tilt: (r() - 0.5) * 0.12,
          detail: 2, strata: 0.6, wedge: 0.8, bright: 1.1, guano: col * 0.7, out: [p.c, p.s], moss: 0.6 });
        rimRocks.push(g);
        onTop(g, p, 1.2, col > 0.5 ? 1 : 0, col);
      }
    }
    if (r() < 0.14 + col * 0.5) {
      const nLedges = 1 + Math.floor(r() * (1 + col * 2.5));
      for (let k = 0; k < nLedges; k++) {
        const depth = 4 + r() * 32;
        const rf = faceAt(p, depth);
        if (rf === null || rf - p.lip > depth * 0.9 + 6) continue;     // a slope, not a face
        const w = 4 + r() * 5, th = 1.3 + r() * 1.1, deep = 3 + r() * 1.8;
        const g = rockGeometry(rockSeed++, { at: V(p.c * (rf + 0.5), p.lipY - depth, p.s * (rf + 0.5)),
          size: [deep, th, w], yaw: -p.a, tilt: (r() - 0.5) * 0.08, detail: 2, strata: 0.7, wedge: 1.4,
          bright: 1.1, guano: 0.35 + col * 0.65, out: [p.c, p.s], moss: 0.9 });
        rimRocks.push(g);
        onTop(g, p, w, Math.floor(col * (1 + r() * 4)), col);
      }
    }
  }

  // ---- build ---------------------------------------------------------------------
  const merged = (list, mat, { shadow = true, name } = {}) => {
    if (!list.length) return null;
    const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
    for (const x of list) x.dispose();
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true; m.name = name;
    return m;
  };
  for (const [list, name] of [[campRocks, "stack-rocks"], [rimRocks, "stack-cliff-rocks"]]) {
    const m = merged(list, rockMat, { name });
    if (m) group.add(m);
  }
  const wm = merged(wood, woodMat, { name: "stack-wood" });
  if (wm) group.add(wm);
  // Decals are drawn after the ground, in a fixed order: earth, then turf and
  // moss over it, then soot over everything.
  let order = 0;
  for (const [k, mat] of [["earth", earthMat], ["turf", turfMat], ["moss", mossMat], ["scorch", scorchMat]]) {
    const m = merged(decals[k].map((g) => { g.deleteAttribute("normal"); return g; }), mat, { shadow: false, name: `stack-${k}` });
    if (!m) continue;
    m.geometry.computeVertexNormals();
    m.renderOrder = 1 + order++;
    deco.add(m);
  }

  const farMeshes = [];
  // Gulls on the ledges.
  const gullMat = addPhotoreal(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  if (sitGulls.length) {
    const im = new THREE.InstancedMesh(gullSitGeometry(), gullMat, sitGulls.length);
    sitGulls.forEach(([x, y, z, yaw], i) => {
      q.setFromEuler(e.set(0, -yaw + Math.PI / 2, 0));
      const s = 0.9 + r() * 0.25;
      im.setMatrixAt(i, m4.compose(V(x, y - 0.02, z), q, V(s, s, s)));
    });
    im.computeBoundingSphere();
    im.userData.far = 700;
    im.name = "stack-gulls-sitting";
    deco.add(im); farMeshes.push(im);
  }

  // Gulls in the air: a few over the camp, where the fish are, and loose
  // wheels of them off the colonies.
  const flyers = [];
  for (let k = 0; k < 5; k++) flyers.push({ cx: -6 + r() * 6, cz: 2 + r() * 4, cy: 22 + r() * 16, R: 9 + r() * 10,
    w: (0.18 + r() * 0.1) * (r() < 0.5 ? 1 : -1), ph: r() * TAU, flap: 3.4 + r() * 1.2 });
  const colonies = rim.filter((p) => colony(p.a) > 0.6);
  for (let k = 0; k < 12 && colonies.length; k++) {
    const p = colonies[Math.floor(r() * colonies.length)];
    const out = p.lip + 10 + r() * 30;
    flyers.push({ cx: p.c * out, cz: p.s * out, cy: p.lipY - 10 + r() * 30, R: 12 + r() * 20,
      w: (0.12 + r() * 0.12) * (r() < 0.5 ? 1 : -1), ph: r() * TAU, flap: 3 + r() * 1.5 });
  }
  const flyMesh = new THREE.InstancedMesh(gullFlyGeometry(), gullMat, flyers.length);
  flyMesh.frustumCulled = false;            // they move; the sphere would go stale
  flyMesh.name = "stack-gulls-flying";
  deco.add(flyMesh);

  // ---- the fire: flame cards and a bed of coals ------------------------------
  const flameMat = new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const flames = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), flameMat);
    f.geometry.translate(0, 0.75, 0);
    f.rotation.y = (k / 3) * Math.PI;
    flames.add(f);
  }
  flames.position.set(fx, gy(fx, fz) + 0.05, fz);
  deco.add(flames);

  // ---- leftovers: fish bones round the rack and the fire ---------------------
  const boneMat = addPhotoreal(new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.7 }));
  const bones = [];
  const scatterBones = (cx, cz, n, spread) => {
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = 0.6 + r() * spread;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const s = 0.8 + r() * 0.6;
      bones.push(m4.compose(V(x, gy(x, z) + 0.012 * s, z), q.setFromEuler(e.set(0, r() * TAU, (r() - 0.5) * 0.3)),
        V(s, s, s)).clone());
    }
  };
  scatterBones(CAMP.rack[0], CAMP.rack[1], 9, 2.6);
  scatterBones(fx, fz, 7, 2.2);
  scatterBones(CAMP.rack[0] - 2.6, CAMP.rack[1] + 1.4, 4, 1.2);
  const boneMesh = new THREE.InstancedMesh(fishBoneGeometry(), boneMat, bones.length);
  bones.forEach((mm, i) => boneMesh.setMatrixAt(i, mm));
  boneMesh.computeBoundingSphere();
  boneMesh.userData.far = 160;
  boneMesh.name = "stack-bones";
  deco.add(boneMesh); farMeshes.push(boneMesh);

  // ---- the nest: what a dragon picks up --------------------------------------
  // A ring of twisted twigs by the shelter. What is in it — the plates, shards
  // of the alloy, the bolas off the snare — is put in by places.js, which has
  // the props; this is the nest itself and the bright small things.
  const [nx, nz] = CAMP.nest;
  const ny = floor(nx, nz, 0.9);
  const ring = new THREE.TorusGeometry(0.72, 0.07, 5, 26);
  ring.rotateX(Math.PI / 2);
  {
    const p = ring.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = noise2(x * 4.1, z * 4.1) * 0.06;
      p.setXYZ(i, x * (1 + n), y * 0.8 + n, z * (1 + n));
    }
  }
  ring.translate(nx, ny + 0.1, nz);
  ring.computeVertexNormals();
  const twigs = [ring];
  for (let k = 0; k < 40; k++) {
    const a = r() * TAU, rr = 0.62 + r() * 0.3, l = 0.5 + r() * 0.6, t = a + Math.PI / 2 + (r() - 0.5) * 0.8;
    const cx = nx + Math.cos(a) * rr, cz = nz + Math.sin(a) * rr, y = ny + 0.04 + (k / 40) * 0.26;
    twigs.push(limbGeometry([V(cx - Math.cos(t) * l / 2, y, cz - Math.sin(t) * l / 2), V(cx, y + 0.06, cz),
      V(cx + Math.cos(t) * l / 2, y + 0.02, cz + Math.sin(t) * l / 2)], 0.022 + r() * 0.012, 0.01, 3, 4));
  }
  const nestMesh = merged(twigs, woodMat, { name: "stack-nest" });
  if (nestMesh) deco.add(nestMesh);
  // Bracken lining it, and shards of bright metal and white shells in it.
  for (let k = 0; k < 5; k++) {
    const a = r() * TAU, d = r() * 0.4;
    plant("camp", "bracken", nx + Math.cos(a) * d, nz + Math.sin(a) * d, 0.35, { y: ny + 0.02, sink: 0, stretch: 1.6 });
  }
  const shards = [];
  for (let k = 0; k < 7; k++) {
    const sh = new THREE.TetrahedronGeometry(0.06 + r() * 0.05, 0);
    sh.scale(1.4, 0.35, 1);
    sh.rotateY(r() * TAU);
    const a = r() * TAU, d = r() * 0.45;
    sh.translate(nx + Math.cos(a) * d, ny + 0.07, nz + Math.sin(a) * d);
    shards.push(sh);
  }
  const shardMesh = merged(shards, alloyMaterial(), { shadow: false, name: "stack-shards" });
  if (shardMesh) deco.add(shardMesh);
  const shells = [];
  for (let k = 0; k < 6; k++) {
    const s = new THREE.ConeGeometry(0.05 + r() * 0.03, 0.09, 6);
    s.rotateX(Math.PI / 2 * (r() < 0.5 ? 1 : -1)); s.rotateY(r() * TAU);
    const a = r() * TAU, d = r() * 0.5;
    s.translate(nx + Math.cos(a) * d, ny + 0.08, nz + Math.sin(a) * d);
    shells.push(s);
  }
  const shellMesh = merged(shells, boneMat, { shadow: false, name: "stack-shells" });
  if (shellMesh) deco.add(shellMesh);


  // ---- the bed: a dished heap of bracken and hay under the sail --------------
  const bedMat = addPhotoreal(new THREE.MeshStandardMaterial({ map: beddingTexture(), roughness: 1 }));
  const bed = new THREE.SphereGeometry(1, 20, 10);
  {
    const p = bed.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rad = Math.hypot(x, z);
      if (y > 0) y = y * (0.45 + 0.55 * smoothstep(rad, 0.3, 0.85));     // the hollow he has worn in it
      y += noise2(x * 3 + 2, z * 3) * 0.12;
      p.setXYZ(i, x, Math.max(y, -0.2), z);
    }
  }
  bed.scale(2.1, 0.42, 1.6);
  bed.computeVertexNormals();
  bed.attributes.uv.array.forEach((u, i, arr) => { arr[i] = u * 3; });
  const bedMesh = new THREE.Mesh(bed, bedMat);
  bedMesh.position.set(0, floor(0, -0.5, 1.8) + 0.04, -0.5);
  bedMesh.receiveShadow = true;
  bedMesh.name = "stack-bed";
  deco.add(bedMesh);
  // Loose bracken round its edge.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + r() * 0.3;
    const x = Math.cos(a) * 2.3, z = -0.5 + Math.sin(a) * 1.8;
    plant("camp", "bracken", x, z, 0.4 + r() * 0.2, { stretch: 1.5 });
  }

  let plants = 0;
  for (const where of ["camp", "rim"]) {
    for (const [kind, list] of Object.entries(plantLists[where])) {
      const K = PLANTS[kind];
      const im = new THREE.InstancedMesh(K.geo, K.mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = kind === "juniper";
      im.receiveShadow = true;
      im.name = `stack-${where}-${kind}`;
      im.userData.far = where === "camp" ? 420 : 900;
      deco.add(im); farMeshes.push(im);
      plants += list.length;
    }
  }

  console.info(`hollow-stack: ${campRocks.length + rimRocks.length} rocks, ${plants} plants, `
    + `${sitGulls.length} gulls sitting, ${flyers.length} flying, rim ${rim.length}/${NA} bearings, `
    + `${Math.round(performance.now() - t0)} ms`);

  // ---- per frame -------------------------------------------------------------
  let t = 0;
  const wp = new THREE.Vector3(), cam = new THREE.Vector3();
  const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fe = new THREE.Euler(0, 0, 0, "YXZ");
  const fpos = new THREE.Vector3(), fscl = new THREE.Vector3();
  return {
    update(dt, camera) {
      t += dt;
      // Flames: three tongues breathing out of step.
      flames.children.forEach((f, i) => {
        const k = 0.8 + Math.sin(t * (7.3 + i * 1.9) + i * 2.1) * 0.14 + Math.sin(t * 13.1 + i) * 0.08;
        f.scale.set(0.85 + Math.sin(t * 5.1 + i * 3) * 0.1, k, 1);
      });
      flameMat.opacity = 0.85 + Math.sin(t * 9.7) * 0.1;

      // Distance culling for the small stuff.
      if (camera) {
        deco.getWorldPosition(wp);
        cam.copy(camera.position);
        const d = Math.hypot(cam.x - wp.x, cam.z - wp.z);
        for (const m of farMeshes) {
          const far = m.userData.far ?? 400;
          // Rim things sit far from the camp centre; give them its radius too.
          m.visible = d < far + (m.name.includes("rim") || m.name.includes("sitting") ? 260 : 0);
        }
        flyMesh.visible = d < 1400;
        if (!flyMesh.visible) return;
      }
      // Gulls: circles that drift, banking into the turn, flapping in bursts
      // and gliding between.
      flyers.forEach((b, i) => {
        const a = b.ph + t * b.w;
        const R = b.R * (1 + Math.sin(t * 0.13 + i) * 0.15);
        fpos.set(b.cx + Math.cos(a) * R, b.cy + Math.sin(t * 0.4 + i * 1.3) * 2.5, b.cz + Math.sin(a) * R);
        const heading = Math.atan2(-Math.sin(a) * Math.sign(b.w), Math.cos(a) * Math.sign(b.w));
        fe.set(0, heading, -Math.sign(b.w) * 0.35);
        fq.setFromEuler(fe);
        const burst = Math.sin(t * 0.7 + i * 2.3) > 0.2 ? 1 : 0.15;
        const flap = 1 + Math.sin(t * b.flap * TAU * 0.5 + i) * 0.9 * burst;
        fscl.set(1.6, 1.6 * flap, 1.6);
        flyMesh.setMatrixAt(i, fm.compose(fpos, fq, fscl));
      });
      flyMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
