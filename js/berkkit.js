import * as THREE from "three";

// ---------------------------------------------------------------------------
// The kit Berk is built from (berk.js, berkstatue.js).
//
// A village of a thousand houses, two hundred-metre statues and a Great Hall
// cannot be a thousand textured meshes. Everything here goes into ONE material:
//
//   - an atlas of surfaces (planks, stone, shingle, timber, carved rock, turf,
//     cloth, iron) laid out on one canvas, picked per triangle by `aTile` and
//     tiled in metres by `aUvm` (box-projected from the face normal at build
//     time, so nothing is hand-unwrapped and nothing stretches);
//   - vertex colour for weathering and fixed paint, and `aPaint` marking the
//     faces an InstancedMesh's instanceColor repaints (roofs, shields) — so one
//     house shape stands in a dozen roof colours for one draw call;
//   - `aGlow` for windows and doors, warm at night;
//   - a small set of FAKE fire lights (world-space positions in a uniform
//     array): the braziers light the stone round them and the statue's face
//     above its fire without adding a single THREE.PointLight, which would
//     tax every fragment shader in the game (see places.js makeLightPool).
//
// The Builder accumulates triangles in that format; build() hands back one
// BufferGeometry.
// ---------------------------------------------------------------------------

export const TILE = {
  PLANK: 0, STONE: 1, SHINGLE: 2, TIMBER: 3,
  DARK: 4, ROCK: 5, TURF: 6, CLOTH: 7,
  IRON: 8, OLD: 9, THATCH: 10, PLAIN: 11,
};
// Metres per repeat of each tile.
const TILE_M = [3.2, 3.6, 2.6, 2.2, 3.0, 14.0, 5.0, 2.4, 1.5, 3.0, 3.5, 4.0];
const COLS = 4, ROWS = 3, TS = 512;

// --- the atlas ---------------------------------------------------------------

let ATLAS = null;
function atlas() {
  if (ATLAS) return ATLAS;
  const c = document.createElement("canvas");
  c.width = COLS * TS; c.height = ROWS * TS;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const at = (i) => [(i % COLS) * TS, Math.floor(i / COLS) * TS];

  // Procedural tiles first; photographs are painted over the ones that have
  // them as they arrive.
  const rnd = mulberry(7);
  const fill = (i, base, draw) => {
    const [x, y] = at(i);
    g.save(); g.beginPath(); g.rect(x, y, TS, TS); g.clip(); g.translate(x, y);
    g.fillStyle = base; g.fillRect(0, 0, TS, TS);
    draw?.(g);
    g.restore();
  };
  const speckle = (g, n, a, light = false) => {
    for (let i = 0; i < n; i++) {
      const v = light ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},${(rnd() * a).toFixed(3)})`;
      g.fillRect(rnd() * TS, rnd() * TS, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  };
  // Shingle: pale so instanceColor can paint it; courses of offset tiles with
  // dark gaps and a lighter lower edge.
  fill(TILE.SHINGLE, "#d8d4cc", (g) => {
    const rows = 8, cols = 7, rh = TS / rows, cw = TS / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * cw * 0.5;
      for (let k = -1; k <= cols; k++) {
        const x = k * cw + off, y = r * rh;
        const v = 190 + Math.floor(rnd() * 60);
        g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        g.beginPath();
        g.moveTo(x + 2, y); g.lineTo(x + cw - 2, y); g.lineTo(x + cw - 2, y + rh * 0.8);
        g.quadraticCurveTo(x + cw * 0.5, y + rh * 1.08, x + 2, y + rh * 0.8); g.closePath(); g.fill();
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x + cw - 3, y, 2, rh * 0.85);
        g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 3, y + rh * 0.72, cw - 6, 3);
      }
      g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(0, r * rh, TS, 3);
    }
    speckle(g, 3000, 0.25);
  });
  // Turf: grass on a sod roof.
  fill(TILE.TURF, "#56683a", (g) => {
    for (let i = 0; i < 9000; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? `rgba(40,58,24,${0.5 * rnd()})` : v < 0.85 ? `rgba(120,140,70,${0.5 * rnd()})` : `rgba(110,90,50,${0.6 * rnd()})`;
      const x = rnd() * TS, y = rnd() * TS;
      g.fillRect(x, y, 1 + rnd() * 2, 3 + rnd() * 7);
    }
  });
  // Thatch: straw in bundles.
  fill(TILE.THATCH, "#9a8350", (g) => {
    for (let r = 0; r < 10; r++) {
      for (let i = 0; i < 700; i++) {
        const v = 110 + Math.floor(rnd() * 90);
        g.strokeStyle = `rgba(${v},${v - 20},${v - 60},0.6)`;
        const x = rnd() * TS, y = r * TS / 10 + rnd() * 8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y + TS / 10 + 6); g.stroke();
      }
      g.fillStyle = "rgba(30,20,10,0.35)"; g.fillRect(0, (r + 1) * TS / 10 - 3, TS, 3);
    }
  });
  // Iron: dark, mottled.
  fill(TILE.IRON, "#3c3d40", (g) => { speckle(g, 6000, 0.35); speckle(g, 2000, 0.15, true); });
  // Plain: near-white, a little dirt, for painted and carved things.
  fill(TILE.PLAIN, "#e6e2da", (g) => { speckle(g, 5000, 0.12); });
  // Stand-ins until the photographs land.
  fill(TILE.PLANK, "#7a5a3c", (g) => { for (let i = 0; i < TS; i += 32) { g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(i, 0, 3, TS); } speckle(g, 4000, 0.2); });
  fill(TILE.OLD, "#77634c", (g) => speckle(g, 4000, 0.2));
  fill(TILE.DARK, "#4a3524", (g) => speckle(g, 4000, 0.2));
  fill(TILE.TIMBER, "#6a4e34", (g) => speckle(g, 4000, 0.2));
  fill(TILE.STONE, "#8a857c", (g) => speckle(g, 6000, 0.3));
  // Carved stone: smooth, pale, softly mottled -- the statues are dressed
  // rock, not a cliff face, and a busy photograph turns them to rubble.
  fill(TILE.ROCK, "#b4b0a8", (g) => {
    for (let i = 0; i < 260; i++) {
      const x = rnd() * TS, y = rnd() * TS, r = 20 + rnd() * 90;
      const v = rnd() < 0.5 ? "0,0,0" : "255,255,255";
      const a = (0.015 + rnd() * 0.03).toFixed(3);
      for (const ox of [-TS, 0, TS]) for (const oy of [-TS, 0, TS]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(${v},${a})`); gr.addColorStop(1, `rgba(${v},0)`);
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
    // Hairline cracks.
    g.strokeStyle = "rgba(40,36,30,0.25)"; g.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      let x = rnd() * TS, y = rnd() * TS; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 40; y += rnd() * 30; g.lineTo(x, y); }
      g.stroke();
    }
    speckle(g, 9000, 0.12); speckle(g, 3000, 0.08, true);
  });
  fill(TILE.CLOTH, "#d9d2c2", (g) => speckle(g, 4000, 0.12));

  const photo = (i, src, { tint = null, rotate = false, gain = 1 } = {}) => {
    const im = new Image();
    im.onload = () => {
      const [x, y] = at(i);
      g.save();
      g.beginPath(); g.rect(x, y, TS, TS); g.clip();
      if (rotate) { g.translate(x + TS / 2, y + TS / 2); g.rotate(Math.PI / 2); g.drawImage(im, -TS / 2, -TS / 2, TS, TS); }
      else g.drawImage(im, x, y, TS, TS);
      if (tint) { g.globalCompositeOperation = "multiply"; g.fillStyle = tint; g.fillRect(x, y, TS, TS); }
      if (gain !== 1) { g.globalCompositeOperation = gain > 1 ? "screen" : "multiply"; g.fillStyle = gain > 1 ? `rgba(255,255,255,${gain - 1})` : `rgba(0,0,0,${1 - gain})`; g.fillRect(x, y, TS, TS); }
      g.restore();
      tex.needsUpdate = true;
    };
    im.src = src;
  };
  const H = "./assets/textures/house/";
  // Planks stand upright on a Berk house wall.
  photo(TILE.PLANK, H + "weathered_brown_planks_diff.jpg", { rotate: true });
  photo(TILE.OLD, H + "old_planks_02_diff.jpg", { rotate: true });
  photo(TILE.DARK, H + "dark_wooden_planks_diff.jpg", { rotate: true });
  photo(TILE.TIMBER, H + "rough_wood_diff.jpg");
  photo(TILE.STONE, H + "stone_wall_diff.jpg");
  photo(TILE.CLOTH, H + "rough_linen_diff.jpg", { gain: 1.25 });

  const rects = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const [x, y] = at(i);
    // Canvas y runs down, texture v runs up (flipY).
    rects.push(new THREE.Vector4(x / c.width, 1 - (y + TS) / c.height, TS / c.width, TS / c.height));
  }
  ATLAS = { tex, rects };
  return ATLAS;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the material --------------------------------------------------------------

export const MAX_FIRES = 16;
let SHARED = null;

/** The shared uniforms every Berk material reads; update once a frame. */
export function berkUniforms() {
  if (SHARED) return SHARED;
  const { tex, rects } = atlas();
  SHARED = {
    tAtlas: { value: tex },
    uTiles: { value: rects },
    uTileM: { value: TILE_M },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uFires: { value: Array.from({ length: MAX_FIRES }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
    uFireN: { value: 0 },
  };
  return SHARED;
}

/**
 * The one Berk material. `instanced` is only a hint for the cache key; three
 * compiles the instancing variant on its own.
 */
export function berkMaterial({ rough = 0.9, side = THREE.FrontSide } = {}) {
  const U = berkUniforms();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0, vertexColors: true, side });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec2 aUvm; attribute float aTile; attribute float aGlow; attribute float aPaint;
        varying vec2 vUvm; varying float vTile; varying float vGlow; varying vec3 vBW; varying float vLit;`)
      .replace("#include <color_vertex>", `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, aPaint);
        #endif`)
      .replace("#include <project_vertex>", `#include <project_vertex>
        vUvm = aUvm; vTile = aTile; vGlow = aGlow;
        vec4 bw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bw = instanceMatrix * bw;
        #endif
        bw = modelMatrix * bw;
        vBW = bw.xyz;
        // Not every house has a fire in: a hash of where it stands.
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          vLit = step(0.3, fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453));
        #else
          vLit = 1.0;
        #endif`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D tAtlas; uniform vec4 uTiles[12]; uniform float uTileM[12];
        uniform float uNight; uniform float uTime; uniform vec4 uFires[${MAX_FIRES}]; uniform int uFireN;
        varying vec2 vUvm; varying float vTile; varying float vGlow; varying vec3 vBW; varying float vLit;`)
      .replace("#include <map_fragment>", `
        {
          int ti = int(vTile + 0.5);
          vec4 R = uTiles[ti];
          vec2 u = vUvm / uTileM[ti];
          vec2 f = fract(u);
          vec2 inset = R.zw * 0.004;
          vec2 auv = R.xy + inset + f * (R.zw - 2.0 * inset);
          vec4 tx = textureGrad(tAtlas, auv, dFdx(u) * R.zw, dFdy(u) * R.zw);
          diffuseColor.rgb *= tx.rgb;
        }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          // Firelight from the nearest braziers, in world space so the sea's
          // mirror pass sees it in the right place too.
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          vec3 fire = vec3(0.0);
          // By day the fires are nothing next to the sun: skip the loop.
          for (int i = 0; i < ${MAX_FIRES}; i++) {
            if (uNight < 0.05) break;
            if (i >= uFireN) break;
            vec4 F = uFires[i];
            vec3 L = F.xyz - vBW;
            float d = length(L);
            float a = clamp(1.0 - d / F.w, 0.0, 1.0);
            a *= a;
            fire += a * (0.25 + 0.75 * max(dot(nW, L / max(d, 0.001)), 0.0));
          }
          float flick = 0.92 + 0.05 * sin(uTime * 7.3) + 0.03 * sin(uTime * 13.1);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.55, 0.22) * fire * (0.25 + 1.6 * uNight) * flick;
          // Windows and doors with a fire behind them.
          totalEmissiveRadiance += vGlow * vLit * vec3(1.0, 0.55, 0.2) * 5.0 * smoothstep(0.25, 0.8, uNight) * flick;
        }`);
  };
  m.customProgramCacheKey = () => "berkmat1";
  return m;
}

// --- the builder ------------------------------------------------------------------

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _fn = new THREE.Vector3();
const _col = new THREE.Color();

export class Builder {
  constructor() {
    this.p = []; this.n = []; this.uv = []; this.tile = []; this.glow = []; this.paint = []; this.c = [];
  }
  get triCount() { return this.p.length / 9; }

  /**
   * Append a geometry (indexed or not) transformed by `m`.
   * opts: tile, colour (hex or [r,g,b] or fn(pos, normal) -> THREE.Color),
   *       glow 0/1, paint 0/1, flat (use face normals), uvScale.
   */
  add(geo, m, opts = {}) {
    const { tile = TILE.PLANK, glow = 0, paint = 0, flat = false } = opts;
    let colour = opts.colour ?? 0xffffff;
    let g = geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal;
    if (m) _m3.getNormalMatrix(m);
    // A mirrored matrix turns every triangle inside out; wind them back.
    const mirror = m ? m.determinant() < 0 : false;
    const fnCol = typeof colour === "function";
    if (!fnCol) _col.set(colour);
    for (let i = 0; i < P.count; i += 3) {
      _a.fromBufferAttribute(P, i); _b.fromBufferAttribute(P, i + 1); _c.fromBufferAttribute(P, i + 2);
      if (m) { _a.applyMatrix4(m); _b.applyMatrix4(m); _c.applyMatrix4(m); }
      _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _fn.crossVectors(_e1, _e2);
      if (mirror) _fn.negate();
      const len = _fn.length();
      if (len < 1e-9) continue;
      _fn.divideScalar(len);
      const ax = Math.abs(_fn.x), ay = Math.abs(_fn.y), az = Math.abs(_fn.z);
      const k = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
      const tri = mirror ? [_a, _c, _b] : [_a, _b, _c];
      const src = mirror ? [0, 2, 1] : [0, 1, 2];
      for (let jj = 0; jj < 3; jj++) {
        const v = tri[jj], j = src[jj];
        this.p.push(v.x, v.y, v.z);
        if (flat || !N) _n.copy(_fn);
        else { _n.fromBufferAttribute(N, i + j); if (m) _n.applyMatrix3(_m3); _n.normalize(); }
        this.n.push(_n.x, _n.y, _n.z);
        if (k === 1) this.uv.push(v.x, v.z);
        else if (k === 0) this.uv.push(v.z * Math.sign(_fn.x || 1), v.y);
        else this.uv.push(-v.x * Math.sign(_fn.z || 1), v.y);
        this.tile.push(tile); this.glow.push(glow); this.paint.push(paint);
        if (fnCol) { const cc = colour(v, _n); this.c.push(cc.r, cc.g, cc.b); }
        else this.c.push(_col.r, _col.g, _col.b);
      }
    }
    if (g !== geo) g.dispose();
    return this;
  }

  /** An axis-aligned box centred at (x, y, z), then rotated by ry about Y. */
  box(w, h, d, x, y, z, opts = {}, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(
      _v.set(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), new THREE.Vector3(1, 1, 1));
    if (opts.matrix) m.premultiply(opts.matrix);
    this.add(g, m, { flat: true, ...opts });
    g.dispose();
    return this;
  }

  /** A cylinder (or cone) from p0 to p1. */
  limb(p0, p1, r0, r1, opts = {}) {
    const seg = opts.seg ?? 12;
    const dir = _e1.subVectors(p1, p0);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, opts.rings ?? 1, !(opts.caps));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(_v.addVectors(p0, p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    if (opts.matrix) m.premultiply(opts.matrix);
    this.add(g, m, opts);
    g.dispose();
    return this;
  }

  /** A sphere/ellipsoid. */
  ball(x, y, z, rx, ry, rz, opts = {}) {
    const g = new THREE.SphereGeometry(1, opts.seg ?? 12, opts.hseg ?? 8);
    const m = new THREE.Matrix4().compose(_v.set(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)),
      new THREE.Vector3(rx, ry, rz));
    if (opts.matrix) m.premultiply(opts.matrix);
    this.add(g, m, opts);
    g.dispose();
    return this;
  }

  /** Any geometry under a position/rotation(euler)/scale. */
  geo(g, pos, rot, scl, opts = {}) {
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scl ?? new THREE.Vector3(1, 1, 1));
    if (opts.matrix) m.premultiply(opts.matrix);
    this.add(g, m, opts);
    g.dispose();
    return this;
  }

  /** Append another Builder's triangles, attributes and all, under `m`. */
  append(o, m = null) {
    const n3 = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    for (let i = 0; i < o.p.length; i += 3) {
      _v.set(o.p[i], o.p[i + 1], o.p[i + 2]); if (m) _v.applyMatrix4(m);
      this.p.push(_v.x, _v.y, _v.z);
      _n.set(o.n[i], o.n[i + 1], o.n[i + 2]); if (n3) _n.applyMatrix3(n3).normalize();
      this.n.push(_n.x, _n.y, _n.z);
      this.c.push(o.c[i], o.c[i + 1], o.c[i + 2]);
    }
    // UVs were projected in the other builder's frame; good enough for a
    // rigid move, which is all this is used for.
    for (const v of o.uv) this.uv.push(v);
    for (let i = 0; i < o.tile.length; i++) { this.tile.push(o.tile[i]); this.glow.push(o.glow[i]); this.paint.push(o.paint[i]); }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("aUvm", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aTile", new THREE.Float32BufferAttribute(this.tile, 1));
    g.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute("aPaint", new THREE.Float32BufferAttribute(this.paint, 1));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// --- shapes ---------------------------------------------------------------------

/**
 * A surface of revolution with an elliptical section and optional per-vertex
 * radial displacement: profile is [[r, y], ...] bottom to top; `fn(theta, y, t)`
 * returns a radius multiplier (folds, strands). theta 0 is +z (the front).
 */
export function lathe(profile, { seg = 24, sx = 1, sz = 1, fn = null, t0 = 0, tl = Math.PI * 2, closeTop = false, flip = false } = {}) {
  const pos = [], idx = [];
  const rows = profile.length;
  const full = Math.abs(tl - Math.PI * 2) < 1e-6;
  const cols = full ? seg : seg + 1;
  for (let i = 0; i < rows; i++) {
    const [r, y] = profile[i];
    const tv = i / (rows - 1);
    for (let j = 0; j < cols; j++) {
      const th = t0 + (j / seg) * tl;
      const k = fn ? fn(th, y, tv) : 1;
      pos.push(Math.sin(th) * r * sx * k, y, Math.cos(th) * r * sz * k);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = i * cols + ((j + 1) % cols);
      const c = a + cols, d = b + cols;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  if (closeTop) {
    const top = pos.length / 3;
    const [, y] = profile[rows - 1];
    pos.push(0, y, 0);
    const base = (rows - 1) * cols;
    for (let j = 0; j < seg; j++) {
      const a = base + j, b = base + ((j + 1) % cols);
      if (flip) idx.push(a, top, b); else idx.push(a, b, top);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tapered tube along a list of points with a radius per point. */
export function taperTube(pts, radii, { seg = 10, caps = true, flatten = 1 } = {}) {
  const pos = [], idx = [];
  const n = pts.length;
  const T = [], Nn = [], B = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    T.push(t);
  }
  // Parallel-transported frame.
  let nrm = new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].y) > 0.9) nrm.set(1, 0, 0);
  nrm = new THREE.Vector3().crossVectors(T[0], nrm).cross(T[0]).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const b = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      if (b.length() > 1e-6) {
        b.normalize();
        const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
        nrm.applyAxisAngle(b, ang);
      }
    }
    Nn.push(nrm.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], nrm).normalize());
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const r = radii[i];
      const p = pts[i].clone()
        .addScaledVector(Nn[i], Math.cos(th) * r * flatten)
        .addScaledVector(B[i], Math.sin(th) * r);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    const s = pos.length / 3; pos.push(pts[0].x, pts[0].y, pts[0].z);
    const e = s + 1; pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z);
    for (let j = 0; j < seg; j++) {
      idx.push(s, j, (j + 1) % seg);
      const base = (n - 1) * seg;
      idx.push(e, base + ((j + 1) % seg), base + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A triangular prism: the gable under a roof. Base `w` across z, apex `h` up, `l` along x. */
export function gablePrism(l, w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: l, bevelEnabled: false });
  g.translate(0, 0, -l / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// --- fire, glow and smoke ------------------------------------------------------

/**
 * Every flame in Berk in one instanced draw: camera-facing quads with a
 * procedural flame in the fragment shader. `fires` is [{x,y,z,s}] (base of the
 * flame, size in metres).
 */
export function makeFlames(fires) {
  const U = berkUniforms();
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1);
  q.translate(0, 0.5, 0);
  g.index = q.index;
  g.setAttribute("position", q.attributes.position);
  g.setAttribute("uv", q.attributes.uv);
  // Big fires are a cluster of tongues rather than one.
  const list = [];
  for (const f of fires) {
    list.push([f.x, f.y, f.z, f.s]);
    if (f.s > 2) {
      const r = f.s * 0.28;
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7 + f.x;
        list.push([f.x + Math.cos(a) * r, f.y - f.s * 0.05, f.z + Math.sin(a) * r, f.s * (0.55 + 0.1 * k)]);
      }
    }
  }
  const at = new Float32Array(list.length * 4);
  list.forEach((v, i) => at.set(v, i * 4));
  g.setAttribute("aFire", new THREE.InstancedBufferAttribute(at, 4));
  g.instanceCount = list.length;
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uNight: U.uNight },
    vertexShader: `attribute vec4 aFire; varying vec2 vUv; varying float vSeed;
      uniform float uTime;
      void main(){
        vUv = uv; vSeed = fract(aFire.x * 0.131 + aFire.z * 0.173);
        // Upright billboard: the flame stands up whatever the camera does.
        vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 right = normalize(vec3(camR.x, 0.0, camR.z));
        float w = aFire.w * 0.75, h = aFire.w * 1.6;
        vec3 p = aFire.xyz + right * position.x * w + vec3(0.0, position.y * h, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uTime; uniform float uNight; varying vec2 vUv; varying float vSeed;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 uv = vUv; float t = uTime * 1.7 + vSeed * 40.0;
        float n = vn(vec2(uv.x * 4.0, uv.y * 3.0 - t * 2.2)) * 0.6 + vn(vec2(uv.x * 9.0, uv.y * 7.0 - t * 4.0)) * 0.4;
        float x = (uv.x - 0.5) * 2.0;
        // Wide at the base, licking to a point; noise eats the edges.
        float width = mix(0.95, 0.05, pow(uv.y, 0.8));
        float body = 1.0 - smoothstep(width * 0.55, width, abs(x + (n - 0.5) * 0.5 * uv.y));
        float shape = body * smoothstep(0.0, 0.08, uv.y) * (1.0 - smoothstep(0.55 + n * 0.4, 1.0, uv.y));
        float core = shape * (1.0 - smoothstep(0.0, 0.55, uv.y + abs(x) * 0.8));
        vec3 col = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.62, 0.18), shape);
        col = mix(col, vec3(1.0, 0.92, 0.7), core);
        float a = clamp(shape * (0.8 + 0.3 * n) * 1.3, 0.0, 1.0);
        gl_FragColor = vec4(col * (1.15 + uNight * 1.3), a);
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return mesh;
}

/** A soft halo per flame, so the braziers read from kilometres off at night. */
export function makeGlows(fires) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g2 = c.getContext("2d");
  const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,220,160,1)"); gr.addColorStop(0.2, "rgba(255,150,60,0.6)");
  gr.addColorStop(1, "rgba(255,90,20,0)");
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const pos = new Float32Array(fires.length * 3), size = new Float32Array(fires.length);
  fires.forEach((f, i) => { pos.set([f.x, f.y + f.s * 0.5, f.z], i * 3); size[i] = f.s; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const U = berkUniforms();
  const m = new THREE.ShaderMaterial({
    uniforms: { tGlow: { value: tex }, uNight: U.uNight, uScale: { value: 900 } },
    vertexShader: `attribute float aSize; uniform float uScale; uniform float uNight;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uScale * aSize * 1.1 / -mv.z, 2.0, 70.0) * step(0.15, uNight);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tGlow; uniform float uNight;
      void main(){ vec4 c = texture2D(tGlow, gl_PointCoord); gl_FragColor = vec4(c.rgb * vec3(1.0, 0.75, 0.5) * c.a * uNight * 0.55, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

/** Chimney smoke: a few rising, widening puffs per chimney, animated on the GPU. */
export function makeSmoke(sources, puffs = 5) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g2 = c.getContext("2d");
  const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(0.6, "rgba(255,255,255,0.2)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const n = sources.length * puffs;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n);
  let k = 0;
  for (const s of sources) {
    for (let i = 0; i < puffs; i++, k++) { pos.set([s.x, s.y, s.z], k * 3); ph[k] = i / puffs + (s.x * 0.013 % 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
  const U = berkUniforms();
  const m = new THREE.ShaderMaterial({
    uniforms: { tSmoke: { value: tex }, uTime: U.uTime, uNight: U.uNight, uScale: { value: 900 } },
    vertexShader: `attribute float aPhase; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        float t = fract(uTime * 0.035 + aPhase);
        vec3 p = position + vec3(t * 14.0 + sin(t * 6.0 + aPhase * 20.0) * 1.2, t * 22.0, t * 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = 1.5 + t * 7.0;
        vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * clamp(1.0 - (-mv.z - 700.0) / 500.0, 0.0, 1.0);
        gl_PointSize = clamp(uScale * size / -mv.z, 0.0, 220.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tSmoke; uniform float uNight; varying float vA;
      void main(){ vec4 c = texture2D(tSmoke, gl_PointCoord);
        vec3 col = mix(vec3(0.62, 0.62, 0.62), vec3(0.08, 0.08, 0.1), uNight);
        gl_FragColor = vec4(col, c.a * vA * 0.42); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}
