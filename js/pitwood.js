import * as THREE from "three";
import { pitPaths, pitPathAt, pitWood, terrainHeight, noise2 } from "./terrain.js";
import { addPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// The floor of the old gullies (terrain.js pitPaths).
//
// The trees come from the forest like everywhere else — fertility() plants
// the gullies thick. What the forest does not do is the ground under them,
// and that is what makes a wood feel like a wood when you are in it on foot:
// ferns to the knee, seed-heads of tall grass catching the light, bushes you
// cannot see past, a fallen trunk furred with moss, and shafts of sun coming
// down through the gaps in the canopy. All of it here, scattered along the
// gullies by how wooded the spot is, thickest at the sides and thinned along
// the middle where something has kept a trail open.
//
// Instanced per kind per 32 m chunk and drawn only out to its own distance,
// so the hundreds of thousands of fronds cost a few dozen draws near him and
// nothing from the air, where the canopy hides the floor anyway.
// ---------------------------------------------------------------------------

const CELL = 32;
const smoothstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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

function canvas(w, h = w) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- Textures -----------------------------------------------------------------
/** One fern frond, tip at the top: a stem and paired leaflets that shorten
 *  toward the tip, each leaflet toothed. */
function frondTexture(seed) {
  const r = rng(seed);
  const W = 96, H = 384, c = canvas(W, H), g = c.getContext("2d");
  const pairs = 22;
  for (let i = 0; i < pairs; i++) {
    const t = i / pairs;                       // 0 base .. 1 tip
    const y = H * (0.96 - t * 0.92);
    const len = W * 0.47 * Math.sin(Math.PI * (0.12 + t * 0.88)) * (1 - t * 0.35);
    const hue = 88 + r() * 18, sat = 42 + r() * 18, lig = 20 + t * 9 + r() * 6;
    for (const side of [-1, 1]) {
      g.fillStyle = `hsl(${hue}, ${sat}%, ${lig}%)`;
      g.beginPath();
      g.moveTo(W / 2, y);
      // A leaflet: a lobed blade swept up toward the tip.
      const ex = W / 2 + side * len, ey = y - len * 0.42;
      g.quadraticCurveTo(W / 2 + side * len * 0.5, y + 6, ex, ey);
      g.quadraticCurveTo(W / 2 + side * len * 0.45, y - len * 0.5 - 4, W / 2, y - 7);
      g.fill();
      // Its midrib, a shade lighter.
      g.strokeStyle = `hsla(${hue + 6}, ${sat}%, ${lig + 12}%, 0.6)`;
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(W / 2, y - 2); g.lineTo(ex * 0.96 + W / 2 * 0.04, ey + 1); g.stroke();
    }
  }
  g.strokeStyle = "hsl(80, 35%, 22%)";
  g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, H * 0.03); g.stroke();
  return tex(c);
}

/** A clump of tall grass and seed-heads. */
function grassTexture(seed) {
  const r = rng(seed);
  const W = 192, H = 256, c = canvas(W, H), g = c.getContext("2d");
  for (let i = 0; i < 150; i++) {
    const x0 = W * (0.5 + (r() - 0.5) * 0.7);
    const top = H * (0.05 + r() * 0.55);
    const lean = (r() - 0.5) * 60 + (x0 - W / 2) * 0.5;
    const dry = r() < 0.3;
    g.strokeStyle = dry ? `hsl(${45 + r() * 10}, ${35 + r() * 15}%, ${45 + r() * 15}%)`
                        : `hsl(${75 + r() * 25}, ${35 + r() * 20}%, ${24 + r() * 16}%)`;
    g.lineWidth = 1 + r() * 1.6;
    g.beginPath();
    g.moveTo(x0, H);
    g.quadraticCurveTo(x0 + lean * 0.2, (H + top) / 2, x0 + lean, top);
    g.stroke();
    if (dry && r() < 0.6) {
      // A seed-head.
      g.fillStyle = `hsl(${40 + r() * 10}, 40%, ${55 + r() * 15}%)`;
      g.beginPath(); g.ellipse(x0 + lean, top + 6, 2, 8, lean * 0.004, 0, Math.PI * 2); g.fill();
    }
  }
  return tex(c);
}

/** Leafy mass for a bush: overlapping leaves, darker inside. */
function bushTexture(seed, hue) {
  const r = rng(seed);
  const S = 256, c = canvas(S), g = c.getContext("2d");
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 520; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * S * 0.46;
      const x = S / 2 + Math.cos(a) * rr, y = S * 0.56 + Math.sin(a) * rr * 0.86;
      if (y > S * 0.98) continue;
      const l = (14 + layer * 7 + r() * 9) * (1 - rr / S * 0.6);
      g.fillStyle = `hsl(${hue + (r() - 0.5) * 22}, ${38 + r() * 20}%, ${l}%)`;
      g.beginPath();
      g.ellipse(x, y, 3 + r() * 4, 1.8 + r() * 2.2, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c);
}

/** Bark for a fallen trunk, mossed along the top (the top of the canvas). */
function logTexture(seed) {
  const r = rng(seed);
  const c = canvas(128, 256), g = c.getContext("2d");
  g.fillStyle = "#3d3125"; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = r() < 0.5 ? "#1f1810" : "#55463a"; g.globalAlpha = 0.25 + r() * 0.5; g.lineWidth = 0.8 + r() * 1.6;
    const x = r() * 128;
    g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 10, 90, x + (r() - 0.5) * 10, 170, x + (r() - 0.5) * 8, 256); g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 1400; i++) {
    const x = r() * 128, y = r() * 256;
    const k = Math.abs(x / 128 - 0.5) * 2;     // the top of the log is the middle of u
    if (r() < (1 - k) * 0.95) {
      g.fillStyle = `hsl(${80 + r() * 25}, ${45 + r() * 20}%, ${18 + r() * 14}%)`;
      g.fillRect(x, y, 1.5 + r() * 3, 1.5 + r() * 3);
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A sunbeam: bright down its middle, soft at the sides, gone at both ends,
 *  with the faint streaks of motes in it. */
function beamTexture() {
  const W = 64, H = 256, c = canvas(W, H), g = c.getContext("2d");
  const img = g.createImageData(W, H);
  const r = rng(5);
  const streak = Array.from({ length: W }, () => 0.75 + r() * 0.5);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const along = smoothstep(v, 0, 0.25) * (1 - smoothstep(v, 0.6, 1));
    for (let x = 0; x < W; x++) {
      const u = Math.abs(x / (W - 1) - 0.5) * 2;
      const a = Math.pow(1 - u, 1.8) * along * streak[x];
      const k = (y * W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

// --- Geometry -------------------------------------------------------------------
/** A fern: fronds springing from a crown, arching out and drooping at the tip. */
function fernGeometry(fronds = 8) {
  const pos = [], nrm = [], uv = [], idx = [];
  const SEG = 5;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + (f % 2) * 0.3;
    const rise = 0.95 - (f % 3) * 0.12;          // how upright this one starts
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      // Out along an arc that rises then droops.
      const out = t * 1.0;
      const up = Math.sin(t * Math.PI * 0.85) * 0.55 * rise + t * 0.1;
      const w = 0.2 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.03;
      for (const side of [-1, 1]) {
        // Width across the frond, flattened a little toward horizontal.
        const lx = -sy * w * side, lz = cy * w * side;
        pos.push(cy * out + lx, up, sy * out + lz);
        nrm.push(cy * 0.3, 0.9, sy * 0.3);
        uv.push(side < 0 ? 0 : 1, t);
      }
      if (s < SEG) {
        const a = base + s * 2, b = a + 1, c2 = a + 2, d = a + 3;
        idx.push(a, c2, b, b, c2, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Crossed cards standing on the ground, for grass. */
function cardsGeometry(cards = 3, domed = false) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i < cards; i++) {
    const a = (i / cards) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const b = pos.length / 3;
    const tilt = domed ? (i % 2 ? 0.25 : -0.25) : 0;
    const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
    for (const [x, y] of corners) {
      const tx = x + (domed ? 0 : 0), ty = y;
      pos.push(ca * tx - sa * tilt * ty, ty, sa * tx + ca * tilt * ty);
      const n = domed ? new THREE.Vector3(ca * x, 0.5 + y * 0.5, sa * x).normalize() : new THREE.Vector3(0, 1, 0);
      nrm.push(n.x, n.y, n.z);
      uv.push(x + 0.5, y);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} o
 *   groundAt(x, z)   the ground he stands on (basedetail's fine mesh inside
 *                    the pit, the height field beyond it)
 *   sky              world.sky, for the sun's direction and how strong it is
 */
export function createPitWood(scene, { groundAt = terrainHeight, sky = null } = {}) {
  const t0 = performance.now();
  const paths = pitPaths();
  const root = new THREE.Group();
  root.name = "pit-wood";
  scene.add(root);
  if (!paths.length) return { root, update() {} };

  // Wind: everything sways a little, more at the top than the root.
  const uTime = { value: 0 };
  const sway = (mat, amount, key) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vCamD;")
        .replace("#include <project_vertex>", `#include <project_vertex>
          vCamD = distance( ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz, cameraPosition );`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          {
            vec3 ip = vec3( instanceMatrix[3][0], 0.0, instanceMatrix[3][2] );
            float ph = uTime * 1.6 + ip.x * 0.37 + ip.z * 0.23;
            float k = position.y * position.y * ${amount.toFixed(3)};
            transformed.x += ( sin( ph ) + sin( ph * 2.3 + 1.1 ) * 0.35 ) * k;
            transformed.z += cos( ph * 0.8 + 0.7 ) * k * 0.6;
          }`);
      // Leaves right in front of the lens dissolve, so a camera following him
      // down a gully looks past the bush he is pushing through, not into it.
      sh.fragmentShader = sh.fragmentShader.replace("normal *= faceDirection;", "")
        .replace("#include <common>", "#include <common>\nvarying float vCamD;")
        .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
          if ( smoothstep( 1.6, 3.6, vCamD ) < fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) ) discard;`);
    };
    mat.customProgramCacheKey = () => key;
    return addPhotoreal(mat);
  };
  const leafy = (map, rough = 0.9) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: rough, metalness: 0 });
  const KINDS = {
    fern0: { geo: fernGeometry(8), mat: sway(leafy(frondTexture(3)), 0.09, "pitwood-fern"), far: 95, shadow: false },
    fern1: { geo: fernGeometry(11), mat: null, far: 95, shadow: false },
    grass: { geo: cardsGeometry(3), mat: sway(leafy(grassTexture(7)), 0.07, "pitwood-grass"), far: 75, shadow: false },
    bush0: { geo: cardsGeometry(5, true), mat: sway(leafy(bushTexture(11, 100)), 0.025, "pitwood-bush"), far: 240, shadow: true },
    bush1: { geo: cardsGeometry(6, true), mat: null, far: 240, shadow: true },
    log: { geo: new THREE.CylinderGeometry(0.42, 0.5, 1, 10, 1).rotateZ(Math.PI / 2),
           mat: addPhotoreal(new THREE.MeshStandardMaterial({ map: logTexture(13), roughness: 0.95 })), far: 200, shadow: true },
  };
  KINDS.fern1.mat = KINDS.fern0.mat;
  KINDS.bush1.mat = sway(leafy(bushTexture(17, 78)), 0.025, "pitwood-bush");

  // --- Scatter ----------------------------------------------------------------
  // Two passes. At load, only WHERE and WHAT: positions walked along the
  // gullies, each a kind, a size, a turn and a tint — cheap, because it reads
  // nothing but pitWood. The ground under each piece, its slope, and the
  // instanced meshes are made per chunk the first time the camera comes near
  // it (build(), from update()), a chunk or two a frame, so a gully nobody
  // walks down costs nothing but a list of numbers.
  const chunks = new Map();
  const chunkFor = (x, z) => {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL), key = i + "," + j;
    let c = chunks.get(key);
    if (!c) { c = { cx: (i + 0.5) * CELL, cz: (j + 0.5) * CELL, raw: [], meshes: [], built: false }; chunks.set(key, c); }
    return c;
  };
  const KIND_IDS = Object.keys(KINDS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const pv = new THREE.Vector3(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3();
  const col = new THREE.Color();
  const r = rng(2024);
  // kind, x, z, sx, sy, sz, yaw, tilt, sink, r, g, b — twelve numbers a piece.
  const put = (kind, x, z, sx, sy, sz, { yaw = r() * Math.PI * 2, tilt = 0, sink = 0, colour = null } = {}) => {
    const c = colour ?? col.setRGB(1, 1, 1);
    chunkFor(x, z).raw.push(KIND_IDS.indexOf(kind), x, z, sx, sy, sz, yaw, tilt, sink, c.r, c.g, c.b);
  };

  const beams = [];
  let planned = 0;
  for (const p of paths) {
    const n = p.x.length;
    let nextBeam = 10 + r() * 20, nextLog = 15 + r() * 30;
    let i = 0;
    for (let s = 2; s < p.len - 2; s += 0.8) {
      // Where along the centre line, and which way across.
      while (i < n - 2 && p.s[i + 1] < s) i++;
      const t = (s - p.s[i]) / Math.max(1e-3, p.s[i + 1] - p.s[i]);
      const cx = p.x[i] + (p.x[i + 1] - p.x[i]) * t, cz = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
      const dx = p.x[i + 1] - p.x[i], dz = p.z[i + 1] - p.z[i], dl = Math.hypot(dx, dz) || 1;
      const ax = -dz / dl, az = dx / dl;              // across
      const reach = p.half + 10;
      // Tries across the width at each step: about one and a quarter a square
      // metre, of which most become a fern or a clump of grass.
      for (let k = 0; k < 36; k++) {
        const off = (r() * 2 - 1) * reach;
        const x = cx + ax * off + (r() - 0.5) * 0.8, z = cz + az * off + (r() - 0.5) * 0.8;
        const w = pitWood(x, z);
        if (w < 0.05) continue;
        const ad = Math.abs(off);
        // A trail along the middle, kept open by whatever uses it.
        const trail = 0.18 + 0.82 * smoothstep(ad, 1.0, 4.0);
        // Ferns in the damp patches, grass in the drier ones.
        const patch = noise2(x * 0.07 + 3.1, z * 0.07 - 1.7) * 0.5 + 0.5;
        const pf = 0.42 * w * trail * (0.35 + patch);
        const pg = 0.4 * w * trail * (1.25 - patch);
        const roll = r();
        if (roll < pf) {
          const sc = 0.85 + r() * 0.9 + w * 0.25;
          col.setHSL(0.24 + (r() - 0.5) * 0.06, 0.45 + r() * 0.2, 0.42 + r() * 0.22);
          put(r() < 0.5 ? "fern0" : "fern1", x, z, sc, sc * (0.75 + r() * 0.45), sc, { tilt: 0.6, sink: 0.05, colour: col });
        } else if (roll < pf + pg) {
          const hgt = 0.6 + r() * 0.85;
          col.setHSL(0.17 + (r() - 0.5) * 0.07, 0.4 + r() * 0.2, 0.42 + r() * 0.22);
          put("grass", x, z, 1.1 + r() * 0.9, hgt, 1.1 + r() * 0.9, { tilt: 0.85, sink: 0.04, colour: col });
        } else if (ad > 3.2 && roll > 1 - 0.03 * w) {
          // Bushes: low dense cover a dragon can lie behind.
          const sc = 1.5 + r() * 1.6;
          col.setHSL(0.27 + (r() - 0.5) * 0.09, 0.32 + r() * 0.2, 0.4 + r() * 0.22);
          put(r() < 0.55 ? "bush0" : "bush1", x, z, sc * (1 + r() * 0.4), sc * (0.7 + r() * 0.35), sc, { tilt: 0.9, sink: 0.12 * sc, colour: col });
        } else continue;
        planned++;
      }
      if (s > nextLog) {
        nextLog = s + 22 + r() * 40;
        const off = (r() * 2 - 1) * (p.half - 2);
        const x = cx + ax * off, z = cz + az * off;
        const len = 5 + r() * 7;
        // Mostly along the gully (it fell downhill), sometimes across it.
        const yaw = Math.atan2(dx, dz) + Math.PI / 2 + (r() < 0.7 ? (r() - 0.5) * 0.6 : Math.PI / 2 + (r() - 0.5) * 0.5);
        const rad = 0.55 + r() * 0.45;
        put("log", x, z, len, rad, rad, { yaw, tilt: 0.3, sink: 0.3 * rad });
      }
      if (s > nextBeam) {
        nextBeam = s + 14 + r() * 22;
        const off = (r() * 2 - 1) * p.half * 0.8;
        beams.push({ x: cx + ax * off, z: cz + az * off, w: 2.2 + r() * 3.2, len: 18 + r() * 12, k: 0.55 + r() * 0.45 });
      }
    }
  }

  // --- Build, near the camera -------------------------------------------------
  let pieces = 0;
  const _list = new Map();
  function build(c) {
    c.built = true;
    const R = c.raw;
    _list.clear();
    for (let o = 0; o < R.length; o += 12) {
      const x = R[o + 1], z = R[o + 2];
      const e = 0.9;
      const h = groundAt(x, z);
      nv.set(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).normalize();
      if (nv.y < 0.78) continue;                      // not on the cut walls
      q.setFromUnitVectors(up, nv.lerp(up, 1 - R[o + 7]).normalize());
      qy.setFromAxisAngle(up, R[o + 6]);
      q.multiply(qy);
      m4.compose(pv.set(x, h - R[o + 8], z), q, sv.set(R[o + 3], R[o + 4], R[o + 5]));
      const k = R[o];
      if (!_list.has(k)) _list.set(k, []);
      _list.get(k).push(m4.clone(), R[o + 9], R[o + 10], R[o + 11]);
    }
    for (const [k, list] of _list) {
      const K = KINDS[KIND_IDS[k]];
      const count = list.length / 4;
      const im = new THREE.InstancedMesh(K.geo, K.mat, count);
      for (let i = 0; i < count; i++) {
        im.setMatrixAt(i, list[i * 4]);
        im.setColorAt(i, col.setRGB(list[i * 4 + 1], list[i * 4 + 2], list[i * 4 + 3]));
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = K.shadow;
      im.receiveShadow = true;
      im.userData.far = K.far;
      im.visible = false;
      root.add(im);
      c.meshes.push(im);
      pieces += count;
    }
    c.raw = null;
  }
  const BUILD_R = 250;

  // --- Sunbeams ------------------------------------------------------------------
  // Two crossed quads per beam, leaning along the sun, additive. They show in
  // daylight with the sun up and clear, fade out close to (you are standing in
  // it) and far off, and turn with the sun.
  const beamGeo = (() => {
    const g = new THREE.BufferGeometry();
    const P = [], U = [], I = [];
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      const b = P.length / 3;
      for (const [x, y] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { P.push(ca * x, y, sa * x); U.push(x + 0.5, y); }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  })();
  const beamU = { uStrength: { value: 0 } };
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTexture(), color: 0xfff1d6, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  });
  beamMat.onBeforeCompile = (sh) => {
    sh.uniforms.uStrength = beamU.uStrength;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vBeamFade;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        {
          vec4 wp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
          float d = distance( wp.xyz, cameraPosition );
          vBeamFade = smoothstep( 3.0, 14.0, d ) * ( 1.0 - smoothstep( 80.0, 150.0, d ) );
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uStrength;\nvarying float vBeamFade;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.a *= uStrength * vBeamFade * 0.16;");
  };
  beamMat.customProgramCacheKey = () => "pitwood-beam";
  const beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, Math.max(1, beams.length));
  beamMesh.count = beams.length;
  beamMesh.frustumCulled = false;
  beamMesh.renderOrder = 5;
  root.add(beamMesh);
  const lastSun = new THREE.Vector3(0, -1, 0);
  const placeBeams = (sun) => {
    const dir = sun.clone().normalize();
    q.setFromUnitVectors(up, dir);
    beams.forEach((b, i) => {
      const h = groundAt(b.x, b.z) - 0.5;
      m4.compose(pv.set(b.x, h, b.z), q, sv.set(b.w, b.len, b.w));
      beamMesh.setMatrixAt(i, m4);
    });
    beamMesh.instanceMatrix.needsUpdate = true;
    lastSun.copy(dir);
  };

  console.info(`pit-wood: ${planned} plants planned in ${chunks.size} chunks, ${beams.length} sunbeams, ${Math.round(performance.now() - t0)} ms`);

  return {
    root,
    /** Debug: every piece's kind and count. */
    get pieces() { return pieces; },
    update(camPos, dt = 0) {
      uTime.value += dt;
      let budget = 2;
      for (const c of chunks.values()) {
        const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz) - CELL * 0.7;
        if (!c.built) { if (d < BUILD_R && budget-- > 0) build(c); else continue; }
        for (const m of c.meshes) m.visible = d < m.userData.far;
      }
      // The beams: only with the sun well up and the sky clear enough to cast
      // a shadow, and only near enough to be in among the trees.
      const sun = sky?.sunDir;
      const st = sky?.state;
      let k = 0;
      if (sun && st) k = smoothstep(sun.y, 0.08, 0.35) * (1 - (st.over ?? 0) * 0.85) * (1 - (st.rain ?? 0));
      beamU.uStrength.value = pitPathAt(camPos.x, camPos.z).d < 160 ? k : 0;
      beamMesh.visible = beamU.uStrength.value > 0.01;
      if (beamMesh.visible && sun && sun.angleTo(lastSun) > 0.02) placeBeams(sun);
    },
  };
}
