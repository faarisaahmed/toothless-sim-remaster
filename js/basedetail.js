import * as THREE from "three";
import { terrainHeight, noise2, fbm } from "./terrain.js";
import { paintGround, CURV_SPAN } from "./groundpaint.js";
import { makeTerrainMaterial, applyGround } from "./terrainmat.js";
import { addPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// The hunters' pit, up close.
//
// From the air the pit is the terrain: a floor and a spiral of terraces in the
// height field. On the ground it was a billiard table — the height field is
// metres between vertices, so nothing smaller than a spoil heap could exist,
// and there was nothing lying on it. A camp that a few hundred people have
// worked for years is nothing like that: the ground is churned, rutted where
// the carts run, hollowed where water stands, heaped where they dump spoil,
// and covered in stones, rubble, scraps of wood, and whatever grows back
// where no one walks.
//
// So the pit floor and the first terrace get their own ground: a metre-spaced
// mesh draped over the height field with the small relief on it — ruts, cart
// tracks, potholes, lumps — painted by the same rules as the terrain so the
// two meet without a seam, and solid to his feet (surfaces.js). And on top of
// it, scattered by what the ground is like:
//
//   pebbles      tens of thousands, thickest at the edges of the tracks and
//                in the rubble, a scatter everywhere else
//   rocks        fist to knee sized, in aprons at the foot of every riser
//   boulders     fallen off the risers, half buried
//   heather      low purple-brown mats where no one treads
//   gorse        spiky green bushes with yellow flowers on the rubble
//   grass        wiry tufts at the edges of everything
//   wood         offcuts, planks and logs, near the buildings
//   puddles      standing water in the low spots, mirror-dark
// ---------------------------------------------------------------------------

const SPACING = 1.0;        // metres between the ground mesh's vertices
const R_GROUND = 150;       // how far out from the centre the fine ground goes
const CELL = 32;            // clutter chunks, for culling by distance
const lerp = THREE.MathUtils.lerp;
const smoothstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = THREE.MathUtils.clamp;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from p to a polyline, and how far along it (0..1). */
function distToPath(px, pz, path) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// --- Procedural textures -----------------------------------------------------
function canvas(w, h = w) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A low shrub's worth of tiny strokes, rising from the bottom of the card. */
function shrubTexture({ seed, strokes, hues, flowers = null, size = 256 }) {
  const r = rng(seed);
  const c = canvas(size);
  const g = c.getContext("2d");
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < strokes / 2; i++) {
      // Denser and lower toward the middle: a mound, not a hedge.
      const x = size * (0.5 + (r() - 0.5) * 0.92 * Math.sqrt(r()));
      const top = size * (1 - (0.25 + 0.7 * r()) * (1 - Math.abs(x / size - 0.5) * 1.3));
      const [h, s, l] = hues[Math.floor(r() * hues.length)];
      g.strokeStyle = `hsl(${h + (r() - 0.5) * 10}, ${s * 100}%, ${l * 100 * (layer ? 1 : 0.62) * (0.8 + r() * 0.4)}%)`;
      g.lineWidth = 1.2 + r() * 1.8;
      g.beginPath();
      const y0 = size * (0.82 + r() * 0.18);
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + (r() - 0.5) * 18, (y0 + top) / 2, x + (r() - 0.5) * 26, top);
      g.stroke();
    }
  }
  if (flowers) {
    for (let i = 0; i < flowers.n; i++) {
      const x = size * (0.15 + r() * 0.7), y = size * (0.15 + r() * 0.6);
      g.fillStyle = flowers.color;
      g.beginPath(); g.arc(x, y, 1.6 + r() * 1.6, 0, Math.PI * 2); g.fill();
    }
  }
  return tex(c);
}

/** Gravelly, cracked bark for logs; grain for planks. */
function woodTexture(seed, base, grain) {
  const r = rng(seed);
  const c = canvas(64, 256);
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = grain; g.globalAlpha = 0.2 + r() * 0.5; g.lineWidth = 0.6 + r() * 1.4;
    const x = r() * 64;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + (r() - 0.5) * 8, 85, x + (r() - 0.5) * 8, 170, x + (r() - 0.5) * 6, 256);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// --- Geometry ----------------------------------------------------------------
/** A stone: an icosahedron kicked out of round, flattened, with a flat face. */
function stoneGeometry(seed, detail = 1, flat = 0.65) {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  const sx = 0.8 + r() * 0.5, sz = 0.8 + r() * 0.5;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + noise2(v.x * 1.7 + seed, v.z * 1.7 - seed) * 0.28 + noise2(v.y * 3.1 - seed, v.x * 3.1) * 0.12;
    v.multiplyScalar(n);
    v.x *= sx; v.z *= sz; v.y *= flat;
    if (v.y < -0.25) v.y = -0.25 - (v.y + 0.25) * 0.15;     // a flat-ish bottom, sitting
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Crossed cards in a dome, for a low bush or a tuft. */
function bushGeometry(cards = 5, tilt = 0.35) {
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const q = new THREE.PlaneGeometry(1, 1, 1, 1);
    q.translate(0, 0.5, 0);
    q.rotateX(-tilt * (i % 2 ? 1 : 0.4));
    q.rotateY((i / cards) * Math.PI);
    parts.push(q);
  }
  const g = new THREE.BufferGeometry();
  const pos = [], nrm = [], uv = [], idx = [];
  let base = 0;
  for (const q of parts) {
    const P = q.attributes.position, U = q.attributes.uv;
    for (let k = 0; k < P.count; k++) {
      pos.push(P.getX(k), P.getY(k), P.getZ(k));
      // Domed normals: a bush is lit as one rounded mass.
      const n = new THREE.Vector3(P.getX(k), P.getY(k) * 0.6 + 0.4, P.getZ(k)).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push(U.getX(k), U.getY(k));
    }
    const I = q.index.array;
    for (let k = 0; k < I.length; k++) idx.push(I[k] + base);
    base += P.count;
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A puddle: a disc with a ragged edge. */
function puddleGeometry(seed) {
  const r = rng(seed);
  const n = 28, pos = [0, 0, 0], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = 1 + noise2(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4) * 0.3 + (r() - 0.5) * 0.08;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr * (0.6 + r() * 0.1));
    if (i > 0) idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 0.5 / 1.3 + 0.5, pos[i + 2] * 0.5 / 1.3 + 0.5);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} o
 *   layout     pitLayout()
 *   surfaces   surfaces.js, with the camp's buildings already registered
 *   groundTex  promise of the terrain textures (world.ready)
 */
export function createBaseDetail(scene, { layout: L, surfaces, groundTex }) {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = "pit-detail";
  scene.add(root);
  const cx = L.x, cz = L.z;

  // --- Tracks: where the carts and the feet go ------------------------------
  // From the gate of the fort out to where the road starts climbing, and a
  // loop round the yard, wobbling the way tracks do round obstacles.
  const r = rng(77);
  const tracks = [];
  const roadStart = L.roadAt(0, 0);
  const spokes = [Math.atan2(roadStart.z - cz, roadStart.x - cx), 0.9, 2.3, 3.7, 5.0];
  for (const a0 of spokes) {
    const path = [];
    for (let k = 0; k <= 12; k++) {
      const rr = lerp(18, L.floorR + 6, k / 12);
      const a = a0 + noise2(k * 0.4 + a0, 3.3) * 0.12;
      path.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
    tracks.push(path);
  }
  const loop = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const rr = 62 + noise2(Math.cos(a) * 1.2, Math.sin(a) * 1.2) * 9;
    loop.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
  }
  tracks.push(loop);
  const trackDist = (x, z) => { let d = Infinity; for (const p of tracks) d = Math.min(d, distToPath(x, z, p)); return d; };

  // Low spots for standing water, chosen before the relief so the relief can
  // dish them out.
  const pools = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, rr = 20 + Math.sqrt(r()) * (L.floorR - 20);
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    // Puddles live on the tracks, mostly: that is where the ground is churned.
    if (trackDist(x, z) > 6 && r() < 0.7) { i--; continue; }
    pools.push({ x, z, s: 0.6 + r() * 1.6, rot: r() * Math.PI });
  }

  /** The small relief, in metres above the height field. */
  function micro(x, z) {
    let m = noise2(x * 0.45 + 2.2, z * 0.45 - 1.1) * 0.06 + noise2(x * 1.3 - 4.4, z * 1.3 + 3.3) * 0.022
          + noise2(x * 0.16 + 9.9, z * 0.16 + 0.7) * 0.09;
    // Tracks: a compacted bed with two ruts in it and churn either side.
    const td = trackDist(x, z);
    if (td < 3.2) {
      const bed = 1 - smoothstep(td, 1.6, 3.2);
      m -= bed * 0.05;
      const rut = Math.exp(-((td - 0.85) ** 2) / 0.03);
      m -= rut * 0.08;
      m += smoothstep(td, 1.4, 2.0) * (1 - smoothstep(td, 2.2, 3.2)) * (0.04 + noise2(x * 2.1, z * 2.1) * 0.03);
    }
    for (const p of pools) {
      const d = Math.hypot(x - p.x, z - p.z) / (p.s * 1.25);
      if (d < 1.4) m -= (1 - smoothstep(d, 0.4, 1.4)) * 0.1;
    }
    return m;
  }

  // --- The ground mesh -------------------------------------------------------
  const N = Math.round((R_GROUND * 2) / SPACING) + 1;
  const x0 = cx - R_GROUND, z0 = cz - R_GROUND;
  const H = new Float32Array(N * N);           // final ground heights
  const base = new Float32Array(N * N);        // the height field under it
  const inside = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = x0 + i * SPACING, z = z0 + j * SPACING;
      const d = Math.hypot(x - cx, z - cz);
      if (d > R_GROUND + SPACING * 2) continue;
      inside[k] = 1;
      base[k] = terrainHeight(x, z);
    }
  }
  // Raised a few centimetres, more on slopes, so the coarser terrain under it
  // never pokes through between its own vertices; faded to the height field at
  // the rim so the join is invisible.
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!inside[k]) continue;
      const x = x0 + i * SPACING, z = z0 + j * SPACING;
      const d = Math.hypot(x - cx, z - cz);
      const edge = 1 - smoothstep(d, R_GROUND - 45, R_GROUND - 4);
      const hl = base[j * N + Math.max(0, i - 1)], hr = base[j * N + Math.min(N - 1, i + 1)];
      const hd = base[Math.max(0, j - 1) * N + i], hu = base[Math.min(N - 1, j + 1) * N + i];
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * SPACING);
      const lift = (0.05 + Math.min(0.22, slope * 0.18)) * edge + 0.01;
      // Where a building stands, leave its floor alone.
      const s = surfaces.at(x, z, base[k] + 6, false);
      const built = s.y > base[k] + 0.3 ? 1 : 0;
      H[k] = base[k] + lift + micro(x, z) * edge * (1 - built) * (1 - smoothstep(slope, 0.5, 1.0));
    }
  }

  const pos = [], col = [], srf = [], idx = [];
  const vid = new Int32Array(N * N).fill(-1);
  const paint = new Float32Array(6);
  const span = Math.round(CURV_SPAN / SPACING);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!inside[k]) continue;
      const x = x0 + i * SPACING, z = z0 + j * SPACING, h = H[k];
      const g = (ii, jj) => { const kk = clamp(jj, 0, N - 1) * N + clamp(ii, 0, N - 1); return inside[kk] ? H[kk] : h; };
      const slope = Math.min(1, Math.hypot(g(i + 1, j) - g(i - 1, j), g(i, j + 1) - g(i, j - 1)) / (2 * SPACING * 2.2) * 3);
      const curv = h - (g(i - span, j) + g(i + span, j) + g(i, j - span) + g(i, j + span)) / 4;
      paintGround(x, z, base[k], Math.min(1, slope), curv, paint, 0);
      // The fine relief shades itself: ruts and hollows darker and wetter.
      const fine = (h - base[k]) - 0.06;
      const dark = clamp(1 + fine * 3.2, 0.62, 1.12);
      vid[k] = pos.length / 3;
      pos.push(x, h, z);
      col.push(paint[0] * dark, paint[1] * dark, paint[2] * dark);
      srf.push(paint[3], paint[4], paint[5]);
    }
  }
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = vid[j * N + i], b = vid[(j + 1) * N + i], c = vid[(j + 1) * N + i + 1], d = vid[j * N + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      const ax = x0 + i * SPACING + SPACING / 2 - cx, az = z0 + j * SPACING + SPACING / 2 - cz;
      if (Math.hypot(ax, az) > R_GROUND) continue;
      idx.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aSurf", new THREE.Float32BufferAttribute(srf, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const groundMat = makeTerrainMaterial({}, 0);
  // Drawn in front of the terrain it lies on, whatever the depth buffer thinks.
  groundMat.polygonOffset = true;
  groundMat.polygonOffsetFactor = -2;
  groundMat.polygonOffsetUnits = -4;
  groundTex?.then((t) => t && applyGround(groundMat, t));
  const ground = new THREE.Mesh(geo, groundMat);
  ground.name = "pit-ground";
  ground.receiveShadow = true;
  root.add(ground);

  // Height and normal of the fine ground, for everything placed on it.
  function groundAt(x, z) {
    const fi = (x - x0) / SPACING, fj = (z - z0) / SPACING;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return terrainHeight(x, z);
    const k = j * N + i;
    if (!inside[k] || !inside[k + 1] || !inside[k + N] || !inside[k + N + 1]) return terrainHeight(x, z);
    const u = fi - i, v = fj - j;
    return lerp(lerp(H[k], H[k + 1], u), lerp(H[k + N], H[k + N + 1], u), v);
  }
  const _n = new THREE.Vector3();
  function normalAt(x, z) {
    return _n.set(groundAt(x - 0.4, z) - groundAt(x + 0.4, z), 0.8, groundAt(x, z - 0.4) - groundAt(x, z + 0.4)).normalize();
  }
  const blocked = (x, z, h) => surfaces.at(x, z, h + 6, false).y > h + 0.25;

  // --- Clutter -----------------------------------------------------------------
  const chunks = new Map();      // "i,j" -> Group
  function chunkFor(x, z) {
    const key = `${Math.floor((x - cx) / CELL)},${Math.floor((z - cz) / CELL)}`;
    let c = chunks.get(key);
    if (!c) {
      c = { group: new THREE.Group(), lists: new Map(), cx: 0, cz: 0 };
      const [ci, cj] = key.split(",").map(Number);
      c.cx = cx + (ci + 0.5) * CELL; c.cz = cz + (cj + 0.5) * CELL;
      chunks.set(key, c);
      root.add(c.group);
    }
    return c;
  }
  // Collect instance transforms per kind per chunk, then build InstancedMeshes.
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const colr = new THREE.Color();
  function put(kind, x, z, scale, { sink = 0.3, tiltToGround = true, yaw = r() * Math.PI * 2, color = null, stretch = 1, dims = null } = {}) {
    const h = groundAt(x, z);
    if (blocked(x, z, h)) return false;
    const n = normalAt(x, z);
    if (tiltToGround) q.setFromUnitVectors(up, n); else q.identity();
    qy.setFromAxisAngle(up, yaw);
    q.multiply(qy);
    if (dims) sv.set(dims[0], dims[1], dims[2]);
    else sv.set(scale * stretch, scale, scale / stretch);
    pv.set(x, h - scale * sink, z);
    m4.compose(pv, q, sv);
    const c = chunkFor(x, z);
    if (!c.lists.has(kind)) c.lists.set(kind, []);
    c.lists.get(kind).push(m4.clone(), color ? color.clone() : null);
    return true;
  }

  // Materials and shapes.
  const stoneMat = addPhotoreal(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: false }));
  const KINDS = {};
  const kind = (name, geo, mat, { shadow = false, far = 110 } = {}) => { KINDS[name] = { geo, mat, shadow, far }; };
  for (let v = 0; v < 4; v++) kind(`pebble${v}`, stoneGeometry(11 + v * 7, 0, 0.55), stoneMat, { far: 70 });
  for (let v = 0; v < 4; v++) kind(`rock${v}`, stoneGeometry(41 + v * 13, 1, 0.62), stoneMat, { shadow: true, far: 160 });
  for (let v = 0; v < 3; v++) kind(`boulder${v}`, stoneGeometry(91 + v * 17, 2, 0.7), stoneMat, { shadow: true, far: 400 });
  const alphaCut = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("normal *= faceDirection;", "");
    };
    m.customProgramCacheKey = () => "pit-foliage-v1";
    return addPhotoreal(m);
  };
  const heather = alphaCut(new THREE.MeshStandardMaterial({
    map: shrubTexture({ seed: 3, strokes: 900, hues: [[25, 0.24, 0.24], [310, 0.13, 0.27], [55, 0.2, 0.25], [330, 0.18, 0.33], [30, 0.3, 0.3]] }),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 }));
  const gorse = alphaCut(new THREE.MeshStandardMaterial({
    map: shrubTexture({ seed: 5, strokes: 1100, hues: [[95, 0.42, 0.22], [110, 0.35, 0.18], [85, 0.3, 0.28]], flowers: { n: 90, color: "#e8c42a" } }),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }));
  const tuft = alphaCut(new THREE.MeshStandardMaterial({
    map: shrubTexture({ seed: 9, strokes: 260, hues: [[60, 0.3, 0.42], [45, 0.32, 0.5], [75, 0.28, 0.36]] }),
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 }));
  kind("heather", bushGeometry(5, 0.5), heather, { far: 180 });
  kind("gorse", bushGeometry(6, 0.3), gorse, { shadow: true, far: 220 });
  kind("tuft", bushGeometry(3, 0.25), tuft, { far: 90 });
  const logMat = addPhotoreal(new THREE.MeshStandardMaterial({ map: woodTexture(21, "#4a3a2a", "#20170f"), roughness: 0.9 }));
  const plankMat = addPhotoreal(new THREE.MeshStandardMaterial({ map: woodTexture(23, "#6b5640", "#3a2d20"), roughness: 0.85 }));
  const log = new THREE.CylinderGeometry(0.5, 0.55, 1, 9, 1); log.rotateZ(Math.PI / 2);
  kind("log", log, logMat, { shadow: true, far: 200 });
  kind("plank", new THREE.BoxGeometry(1, 0.06, 0.22), plankMat, { shadow: true, far: 120 });
  // Standing water: dark, glossy, and soft at the edge where it thins into
  // wet mud — a hard-edged mirror reads as a hole cut in the ground.
  const puddleAlpha = (() => {
    const c = canvas(128), g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, "#fff"); gr.addColorStop(0.62, "#ddd"); gr.addColorStop(0.85, "#555"); gr.addColorStop(1, "#000");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c, false);
  })();
  const puddleMat = addPhotoreal(new THREE.MeshStandardMaterial({
    color: 0x1e1b16, roughness: 0.12, metalness: 0.0, envMapIntensity: 0.55,
    alphaMap: puddleAlpha, transparent: true, opacity: 0.9, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
  for (let v = 0; v < 3; v++) kind(`puddle${v}`, puddleGeometry(5 + v), puddleMat, { far: 200 });

  const stoneColour = (k) => {
    // Grey basalt and brown sandstone, wet-dark or bleached. LINEAR light:
    // real rock reflects a tenth to a quarter of what falls on it, and 0.5
    // here is already a near-white stone on screen.
    const g = 0.05 + Math.pow(r(), 1.4) * 0.17;
    return colr.setRGB(g * (0.95 + k * 0.12), g * (0.92 + k * 0.05), g * (0.88 - k * 0.04));
  };

  // Scatter. Rejection on a jittered grid, so it covers without clumping, but
  // densities come from what the ground is like there.
  const RFLOOR = L.floorR;
  const area = (fn, spacing, rMax) => {
    for (let z = cz - rMax; z < cz + rMax; z += spacing) {
      for (let x = cx - rMax; x < cx + rMax; x += spacing) {
        const px = x + (r() - 0.5) * spacing, pz = z + (r() - 0.5) * spacing;
        const d = Math.hypot(px - cx, pz - cz);
        if (d > rMax) continue;
        fn(px, pz, d);
      }
    }
  };
  const slopeAt = (x, z) => 1 - normalAt(x, z).y;

  // Pebbles: everywhere a little, thick along the track edges, the rubble and
  // the foot of the risers.
  area((x, z, d) => {
    const td = trackDist(x, z);
    const edge = td > 1.2 && td < 3.5 ? 1 : 0;
    const sl = slopeAt(x, z);
    const patchy = fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
    const dens = 0.45 + edge * 0.8 + smoothstep(sl, 0.05, 0.3) * 0.8 + patchy * 0.6;
    if (r() > dens) return;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const s = 0.05 + Math.pow(r(), 2.0) * 0.24;
      put(`pebble${Math.floor(r() * 4)}`, x + (r() - 0.5) * 0.9, z + (r() - 0.5) * 0.9, s,
        { sink: 0.12, color: stoneColour(r() < 0.3 ? 1 : 0) });
    }
  }, 1.1, R_GROUND - 4);

  // Rocks and boulders: aprons of fallen rubble at the foot of every riser,
  // and a few strays across the floor.
  area((x, z, d) => {
    const sl = slopeAt(x, z);
    const h = groundAt(x, z);
    // The foot of a riser: flat here, steep a few metres in toward the wall.
    const ux = (x - cx) / (d || 1), uz = (z - cz) / (d || 1);
    const ahead = groundAt(x + ux * 4, z + uz * 4) - h;
    const foot = smoothstep(ahead, 1.5, 6) * (1 - smoothstep(sl, 0.4, 0.8));
    const stray = (d < RFLOOR ? 0.05 : 0.07) * (0.5 + (fbm(x * 0.03 + 1, z * 0.03 - 2, 2) * 0.5 + 0.5));
    if (r() > foot * 0.85 + stray) return;
    if (trackDist(x, z) < 2.2) return;
    const big = r() < 0.07 + foot * 0.06;
    if (big) put(`boulder${Math.floor(r() * 3)}`, x, z, 0.7 + r() * 1.6, { sink: 0.3, color: stoneColour(r() < 0.4 ? 1 : 0), stretch: 0.8 + r() * 0.5 });
    else put(`rock${Math.floor(r() * 4)}`, x, z, 0.15 + Math.pow(r(), 1.6) * 0.5, { sink: 0.18, color: stoneColour(r() < 0.4 ? 1 : 0), stretch: 0.8 + r() * 0.5 });
  }, 1.8, R_GROUND - 3);

  // Plants: only where no one walks — off the tracks, away from the middle of
  // the yard, thickest against the risers and on the rubble.
  area((x, z, d) => {
    const td = trackDist(x, z);
    if (td < 2.6) return;
    const sl = slopeAt(x, z);
    const yard = 1 - smoothstep(d, 30, 75);        // the busy middle
    const wild = smoothstep(d, RFLOOR - 40, RFLOOR) + smoothstep(sl, 0.06, 0.3) * 0.8
               + (fbm(x * 0.05 + 3, z * 0.05 - 9, 2) * 0.5 + 0.5) * 0.35;
    const dens = clamp(wild * (1 - yard * 0.85), 0, 1) * (sl > 0.75 ? 0 : 1);
    if (r() > dens * 0.55) return;
    const pick = r();
    const y = r() * Math.PI * 2;
    if (pick < 0.42) put("tuft", x, z, 0.35 + r() * 0.35, { sink: 0.05, tiltToGround: false, yaw: y });
    else if (pick < 0.8) put("heather", x, z, 0.45 + r() * 0.5, { sink: 0.08, tiltToGround: false, yaw: y, stretch: 1.2 + r() * 0.5 });
    else put("gorse", x, z, 0.7 + r() * 0.8, { sink: 0.1, tiltToGround: false, yaw: y });
  }, 1.6, R_GROUND - 3);

  // Wood: offcuts and the odd log, near where people work.
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = 12 + Math.sqrt(r()) * (RFLOOR - 15);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (trackDist(x, z) < 1.5) continue;
    // Prefer the ground near a building.
    let nearB = false;
    for (let k = 0; k < 6 && !nearB; k++) {
      const b = k * 1.05;
      if (blocked(x + Math.cos(b) * 5, z + Math.sin(b) * 5, groundAt(x, z))) nearB = true;
    }
    if (!nearB && r() < 0.75) continue;
    if (r() < 0.3) {
      const rad = 0.18 + r() * 0.14;
      put("log", x, z, rad, { sink: -0.4, dims: [1.5 + r() * 2.5, rad * 2, rad * 2] });
    } else {
      put("plank", x, z, 0.06, { sink: -0.5, dims: [1.2 + r() * 1.8, 1, 1] });
    }
  }

  // Puddles, in the hollows dished out for them.
  pools.forEach((p, i) => {
    const h = groundAt(p.x, p.z);
    if (blocked(p.x, p.z, h)) return;
    // Level, at the hollow's lip height a little up from its bottom.
    q.setFromAxisAngle(up, p.rot);
    m4.compose(pv.set(p.x, h + 0.035, p.z), q, sv.set(p.s, 1, p.s));
    const c = chunkFor(p.x, p.z);
    const k = `puddle${i % 3}`;
    if (!c.lists.has(k)) c.lists.set(k, []);
    c.lists.get(k).push(m4.clone(), null);
  });

  // Build the instanced meshes.
  let instances = 0;
  for (const c of chunks.values()) {
    c.meshes = [];
    for (const [name, list] of c.lists) {
      const K = KINDS[name];
      const count = list.length / 2;
      const im = new THREE.InstancedMesh(K.geo, K.mat, count);
      let hasColour = false;
      for (let i = 0; i < count; i++) {
        im.setMatrixAt(i, list[i * 2]);
        if (list[i * 2 + 1]) { im.setColorAt(i, list[i * 2 + 1]); hasColour = true; }
      }
      if (!hasColour && K.mat === stoneMat) im.setColorAt(0, colr.setRGB(0.5, 0.5, 0.5));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = K.shadow;
      im.receiveShadow = true;
      im.userData.far = K.far;
      im.name = name;
      c.group.add(im);
      c.meshes.push(im);
      instances += count;
    }
    c.lists = null;
  }

  console.info(`pit-detail: ground ${(pos.length / 3 / 1000).toFixed(0)}k verts, ${instances} pieces in ${chunks.size} chunks, ${Math.round(performance.now() - t0)} ms`);

  return {
    root,
    ground,
    groundAt,
    /** Debug: show only pieces whose kind name matches. */
    only(re) { for (const c of chunks.values()) for (const m of c.meshes) m.userData.hide = !re.test(m.name); },
    /** Show each chunk's pieces only out to their own distance. */
    update(camPos) {
      for (const c of chunks.values()) {
        const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz) - CELL * 0.7;
        for (const m of c.meshes) m.visible = d < m.userData.far && !m.userData.hide;
      }
    },
  };
}
