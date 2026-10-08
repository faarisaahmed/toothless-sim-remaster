import * as THREE from "three";
import { terrainHeight, noise2, berkWaters, berkMesas } from "./terrain.js";
import { INTERIOR } from "./berklayout.js";

// ---------------------------------------------------------------------------
// Berk's natural features that a height field cannot be.
//
// terrain.js draws the island -- the mesas, the valleys, the river channels and
// the plunge pools -- but a height field has one height per point, so it
// cannot span a gap, and it cannot hold water above the sea. This adds what is
// left: the natural arch between two mesas (rock, in the ground's own material
// so its sandstone is the cliffs' sandstone), the waterfalls off the mesa rims
// with mist where they land, and the water in the rivers and pools.
//
// Every position comes from berklayout.js (via terrain.js), so this follows
// the layout wherever it puts Berk.
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Linear colour from sRGB hex, as plain numbers (the ground's vertex colours are linear). */
function lin(hex) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
const SAND_L = lin(0xc79a64), SAND_D = lin(0x7b4f2e), MOSS = lin(0x3f6232);

/** Where a mesa's rim actually is along a bearing: walk out until the table ends. */
function rimAlong(m, ux, uz, from = 0) {
  let last = from;
  for (let s = from; s < m.r * 1.6; s += 2) {
    const h = terrainHeight(m.x + ux * s, m.z + uz * s);
    if (h < m.h - 8) return { s: last, x: m.x + ux * last, z: m.z + uz * last };
    last = s;
  }
  return { s: last, x: m.x + ux * last, z: m.z + uz * last };
}

function nearestMesa(mesas, p) {
  let best = null, bd = Infinity;
  for (const m of mesas) {
    const d = Math.hypot(m.x - p.x, m.z - p.z) - m.r;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

// --- The arch ---------------------------------------------------------------
function buildArch(arch, mesas, material) {
  const A = nearestMesa(mesas, arch.a), B = nearestMesa(mesas, arch.b);
  const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  // Start and end buried thirty metres inside each mesa's rim.
  const ra = rimAlong(A, ux, uz), rb = rimAlong(B, -ux, -uz);
  const sx = A.x + ux * (ra.s - 30), sz = A.z + uz * (ra.s - 30);
  const ex = B.x - ux * (rb.s - 30), ez = B.z - uz * (rb.s - 30);
  const span = Math.hypot(ex - sx, ez - sz);
  const foot = INTERIOR.valleyH + 10;
  const NS = 96, NR = 28;
  const pos = [], col = [], surf = [], uv = [];
  const px = -uz, pz = ux;            // across the span
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const cx = lerp(sx, ex, t), cz = lerp(sz, ez, t);
    const sn = Math.sin(Math.PI * t);
    // The deck: just under the tables at the ends, sagging a little.
    const top = lerp(A.h - 22, B.h - 22, t) - 26 * sn + noise2(t * 6.1, 3.3) * 6;
    // The underside: the arch's own curve, at `h` in the middle, down to the
    // valley at the legs.
    const leg = Math.pow(1 - sn, 1.8);
    const under = lerp(arch.h, foot, leg) + noise2(t * 5.3, 9.1) * 5;
    const hw = arch.w / 2 * (1 + 1.3 * Math.pow(1 - sn, 1.5)) * (1 + noise2(t * 4.7, -2.2) * 0.12);
    const midY = (top + under) / 2, hh = (top - under) / 2;
    for (let j = 0; j <= NR; j++) {
      const th = (j / NR) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      // A boxy section with rounded corners: sandstone fins are slab-sided.
      let ox = Math.sign(c) * Math.pow(Math.abs(c), 0.45) * hw;
      let oy = Math.sign(s) * Math.pow(Math.abs(s), 0.45) * hh;
      // Weathering: bulges and hollows, stronger on the sides than the deck.
      const n = noise2(cx * 0.025 + ox * 0.03, (midY + oy) * 0.03 + cz * 0.01) * 7
              + noise2(cx * 0.07 - oy * 0.05, cz * 0.07 + ox * 0.04) * 2.5;
      const side = Math.abs(c);
      ox += Math.sign(c) * n * side;
      oy += (s < 0 ? -1 : 1) * n * 0.35 * (1 - side);
      const x = cx + px * ox, y = midY + oy, z = cz + pz * ox;
      pos.push(x, y, z);
      // Sandstone; the deck is turf.
      const band = 0.5 + 0.3 * Math.sin(y * 0.155 + n * 0.1) + 0.2 * Math.sin(y * 0.9);
      const k = clamp(band, 0, 1);
      const deck = s > 0.8 ? 1 : 0;
      for (let e = 0; e < 3; e++) col.push(lerp(lerp(SAND_D[e], SAND_L[e], k), MOSS[e], deck * 0.8));
      surf.push(deck * 0.7, 0, 0);
      uv.push(t * span / 20, j / NR);
    }
  }
  const idx = [];
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b = a + NR + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aSurf", new THREE.Float32BufferAttribute(surf, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Wound so the normals face out whichever way the span runs.
  const probe = g.attributes.normal;
  if (probe.getY(Math.round(NR / 4)) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "berk-arch";
  return mesh;
}

// --- Water -----------------------------------------------------------------
const FALL_VERT = /* glsl */`
  varying vec2 vUv;
  varying float vDrop;
  #include <fog_pars_vertex>
  attribute float aDrop;
  void main() {
    vUv = uv;
    vDrop = aDrop;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const NOISE_GLSL = /* glsl */`
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
  }
`;
const FALL_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vDrop;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    // Streaks: stretched noise running down the sheet, faster lower down.
    float v = vUv.y * 0.06 - uTime * ( 0.9 + vDrop * 0.6 );
    float s1 = vnoise( vec2( vUv.x * 26.0, v * 3.0 ) );
    float s2 = vnoise( vec2( vUv.x * 61.0 + 7.0, v * 7.0 + 3.0 ) );
    float streak = smoothstep( 0.25, 0.95, s1 * 0.65 + s2 * 0.45 );
    float edge = smoothstep( 0.0, 0.18, vUv.x ) * smoothstep( 1.0, 0.82, vUv.x );
    // Ragged edges that move.
    edge *= smoothstep( 0.15, 0.55, vnoise( vec2( vUv.x * 9.0, v * 2.0 ) ) + edge * 0.6 );
    float a = edge * ( 0.45 + 0.5 * streak ) * ( 0.75 + 0.25 * vDrop );
    vec3 c = mix( uTint * 0.75, vec3( 1.0 ), streak * 0.85 );
    gl_FragColor = vec4( c, a );
    #include <fog_fragment>
  }
`;

const WATER_VERT = /* glsl */`
  varying vec3 vW;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uDeep, uSky;
  uniform float uFlow;
  varying vec3 vW;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    vec3 V = normalize( cameraPosition - vW );
    // Ripples: two drifting noise layers bending a flat normal.
    vec2 p = vW.xz * 0.08;
    vec2 f = vec2( 0.0, uTime * uFlow );
    float n1 = vnoise( vec2( vUv.x * 3.0, vUv.y * 0.12 - uTime * uFlow * 0.6 ) );
    float n2 = vnoise( p * 1.7 + f );
    vec3 N = normalize( vec3( ( n1 - 0.5 ) * 0.35, 1.0, ( n2 - 0.5 ) * 0.35 ) );
    float fres = pow( 1.0 - max( dot( N, V ), 0.0 ), 3.0 );
    vec3 c = mix( uDeep, uSky, 0.15 + fres * 0.75 );
    // Foam where it runs fast.
    float foam = smoothstep( 0.78, 0.95, vnoise( vec2( vUv.x * 8.0, vUv.y * 0.5 - uTime * uFlow * 1.4 ) ) );
    c = mix( c, vec3( 0.85, 0.9, 0.92 ), foam * 0.35 );
    gl_FragColor = vec4( c, 0.9 );
    #include <fog_fragment>
  }
`;

function waterMaterial(flow) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlow: { value: flow },
      uDeep: { value: new THREE.Color(0x0f2b2c) }, uSky: { value: new THREE.Color(0x9fb8c8) },
    }]),
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, fog: true, depthWrite: true,
  });
}

function buildRiver(pts, material) {
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    // Wider than the channel: the edges run under the banks.
    const w = p.w + 9;
    pos.push(p.x - tz * w, p.y, p.z + tx * w, p.x + tz * w, p.y, p.z - tx * w);
    uv.push(0, along, 1, along);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, material);
  m.name = "berk-river";
  return m;
}

function softTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFall(wf, mesas, pools, fallMat) {
  const m = nearestMesa(mesas, wf);
  let ux = wf.x - m.x, uz = wf.z - m.z;
  const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
  const rim = rimAlong(m, ux, uz, Math.max(0, m.r * 0.7));
  const pool = pools.reduce((b, p) => (Math.hypot(p.x - wf.pool.x, p.z - wf.pool.z) < Math.hypot(b.x - wf.pool.x, b.z - wf.pool.z) ? p : b), pools[0]);
  // Walk off the rim toward the pool, hugging the face a few metres out.
  const path = [];
  const top = terrainHeight(rim.x, rim.z) + 1.0;
  const toPool = Math.hypot(pool.x - rim.x, pool.z - rim.z);
  let y = top;
  for (let s = -6; s <= toPool; s += 2) {
    const x = rim.x + ux * s, z = rim.z + uz * s;
    const g = Math.max(terrainHeight(x + ux * 5, z + uz * 5), terrainHeight(x, z));
    // Free fall off each lip: it cannot rise, and it drops no faster than
    // the face lets it, held a little proud of the rock.
    const want = s < 0 ? top : Math.max(g + 2.5, pool.y);
    y = Math.min(y, want);
    path.push({ x: x + ux * 4, y, z: z + uz * 4 });
    if (s > 0 && y <= pool.y + 0.5) break;
  }
  const pos = [], uv = [], drop = [], idx = [];
  let along = 0;
  const px = -uz, pz = ux;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z);
    const k = clamp((top - p.y) / Math.max(1, top - pool.y), 0, 1);
    const w = wf.w / 2 * (1 + k * 0.7);
    pos.push(p.x - px * w, p.y, p.z - pz * w, p.x + px * w, p.y, p.z + pz * w);
    uv.push(0, along, 1, along);
    drop.push(k, k);
    if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aDrop", new THREE.Float32BufferAttribute(drop, 1));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, fallMat);
  mesh.name = "berk-waterfall";
  mesh.renderOrder = 2;
  const foot = path[path.length - 1];
  return { mesh, foot, top: { x: rim.x, y: top, z: rim.z }, w: wf.w, height: top - pool.y };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ material: THREE.Material }} opts  the ground's material, for the arch
 */
export function createBerkLand(scene, { material } = {}) {
  const root = new THREE.Group();
  root.name = "berk-land";
  scene.add(root);
  const mesas = berkMesas();
  const waters = berkWaters();

  if (material) for (const a of INTERIOR.arches) root.add(buildArch(a, mesas, material));

  // Rivers and pools.
  const riverMat = waterMaterial(0.35);
  const poolMat = waterMaterial(0.04);
  for (const r of waters.rivers) if (r.length > 2) root.add(buildRiver(r, riverMat));
  for (const p of waters.pools) {
    const g = new THREE.CircleGeometry(p.r * 1.12, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, poolMat);
    m.position.set(p.x, p.y, p.z);
    m.name = "berk-pool";
    root.add(m);
  }

  // Waterfalls, and the mist where they land.
  const fallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uTint: { value: new THREE.Color(0xa9c3cc) },
    }]),
    vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const mistTex = softTexture();
  const mists = [];
  for (const wf of INTERIOR.waterfalls) {
    const f = buildFall(wf, mesas, waters.pools, fallMat);
    root.add(f.mesh);
    // Spray boiling up off the pool, and a little blowing off the lip.
    const n = 7;
    for (let k = 0; k < n; k++) {
      const mat = new THREE.SpriteMaterial({ map: mistTex, color: 0xeef4f6, transparent: true, depthWrite: false, opacity: 0.4, fog: true });
      const s = new THREE.Sprite(mat);
      const base = new THREE.Vector3(f.foot.x, f.foot.y, f.foot.z);
      const size = f.w * (1.3 + k * 0.3) + f.height * 0.05;
      mists.push({ s, base, size, phase: k / n, rise: f.height * 0.25 + 20, spread: f.w * 1.2 });
      root.add(s);
    }
    const lip = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.18, fog: true }));
    lip.position.set(f.top.x, f.top.y - 12, f.top.z);
    lip.scale.setScalar(f.w * 2.5);
    root.add(lip);
  }

  let t = 0;
  return {
    root,
    update(dt) {
      t += dt;
      fallMat.uniforms.uTime.value = t;
      riverMat.uniforms.uTime.value = t;
      poolMat.uniforms.uTime.value = t;
      for (const m of mists) {
        // Each puff rises from the pool, swells and fades, and starts again.
        const ph = (t * 0.09 + m.phase) % 1;
        const a = m.phase * 6.283;
        m.s.position.set(
          m.base.x + Math.cos(a + t * 0.05) * m.spread * (0.3 + ph),
          m.base.y + 4 + ph * m.rise,
          m.base.z + Math.sin(a + t * 0.05) * m.spread * (0.3 + ph));
        m.s.scale.setScalar(m.size * (0.6 + ph * 0.9));
        m.s.material.opacity = 0.32 * Math.sin(ph * Math.PI);
      }
    },
  };
}
