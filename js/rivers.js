import * as THREE from "three";
import { terrainHeight, inlandWater } from "./terrain.js";

// ---------------------------------------------------------------------------
// Water above the sea: the rivers, lakes and falls hydrology.js finds and
// terrain.js cuts into the ground, and the shaders Berk's burn uses too.
//
// Everything is merged into three meshes for the whole archipelago — the
// running water, the still water, the falls — so the cost is three draws
// however many islands drain. A thin stream is not worth drawing from ten
// kilometres away and shimmers if it is, so the running water dissolves out
// with distance by its own width (a burn at a kilometre or two, a river much
// further). Spray only at the falls near enough to see it.
// ---------------------------------------------------------------------------

export const NOISE_GLSL = /* glsl */`
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
  }
`;

// --- Falls -------------------------------------------------------------------
export const FALL_VERT = /* glsl */`
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
export const FALL_FRAG = /* glsl */`
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

// --- Berk's burn (a plain ribbon, flat lit) ----------------------------------
export const WATER_VERT = /* glsl */`
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
export const WATER_FRAG = /* glsl */`
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

export function waterMaterial(flow) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlow: { value: flow },
      uDeep: { value: new THREE.Color(0x0f2b2c) }, uSky: { value: new THREE.Color(0x9fb8c8) },
    }]),
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, fog: true, depthWrite: true,
  });
}

export function fallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uTint: { value: new THREE.Color(0xa9c3cc) },
    }]),
    vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
}

/** A ribbon along pts [{x, y, z, w}] — w the half-width of the water. */
export function buildRibbon(pts, material, name = "river") {
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
  m.name = name;
  return m;
}

export function softTexture(size = 128) {
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

// --- The archipelago's rivers and lakes ---------------------------------------
// Lit by the sky it is under: the reflection is the haze colour (which sky.js
// keeps in step with the time of day and the weather), the body a dark peaty
// brown-green scaled by how bright that is — so the water goes dark at night
// with everything else instead of glowing the colour of noon.
const INLAND_VERT = /* glsl */`
  attribute float aFoam;
  attribute float aHalf;
  attribute float aLift;
  uniform float uFineR;
  varying vec3 vW;
  varying vec2 vUv;
  varying float vFoam;
  varying float vHalf;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vFoam = aFoam;
    vHalf = aHalf;
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    // The ground is drawn as streamed chunks 2-13 m a quad near him and as
    // the coarse sheet, 39 m a quad, everywhere else (and everywhere, on the
    // low setting) — and both bridge over a channel ten metres wide, so the
    // interpolated bank stands over the water and hides it. So the water is
    // pulled toward the eye along its own line of sight: the same pixel, a
    // nearer depth. A few metres always, which is what a bank rises across
    // one fine quad; and where only the coarse sheet is drawn, by however far
    // the sheet was measured to stand over this very vertex (aLift). The
    // ribbon is barely wider than the channel, so all this can do is let the
    // water show where the water is.
    float dv = length( mvPosition.xyz );
    float coarse = smoothstep( uFineR * 0.6, uFineR, dv );
    float bias = 3.5 + clamp( ( dv - 300.0 ) * 0.012, 0.0, 40.0 );
    bias = max( bias, ( aLift + 1.5 ) * coarse );
    bias *= step( aHalf, 100.0 );     // a lake is wide enough to look after itself
    bias = min( bias, dv * 0.3 );    // standing in it: never through the eye
    mvPosition.xyz *= 1.0 - bias / max( dv, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const INLAND_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uDeep, uSky;
  uniform float uFlow;
  varying vec3 vW;
  varying vec2 vUv;
  varying float vFoam;
  varying float vHalf;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    float dist = length( cameraPosition - vW );
    // Dissolve out by distance in proportion to the width: by the time a burn
    // is under a pixel across it is gone, rather than crawling.
    float fade = 1.0 - smoothstep( vHalf * 260.0, vHalf * 520.0, dist );
    if ( hash( floor( gl_FragCoord.xy ) ) > fade ) discard;
    vec3 V = normalize( cameraPosition - vW );
    float flow = uFlow * ( 0.4 + vFoam * 2.0 );
    vec2 p = vW.xz * 0.09;
    float n1 = vnoise( vec2( vUv.x * 3.0, vUv.y * 0.15 - uTime * flow * 0.6 ) );
    float n2 = vnoise( p * 1.7 + vec2( uTime * 0.05, uTime * flow * 0.3 ) );
    vec3 N = normalize( vec3( ( n1 - 0.5 ) * 0.3, 1.0, ( n2 - 0.5 ) * 0.3 ) );
    float fres = pow( 1.0 - max( dot( N, V ), 0.0 ), 4.0 );
    vec3 c = mix( uDeep, uSky, 0.12 + fres * 0.8 );
    // White water: where it runs steep, broken up and moving downstream.
    float wn = vnoise( vec2( vUv.x * 7.0, vUv.y * 0.35 - uTime * flow * 1.6 ) );
    float foam = smoothstep( 0.92 - vFoam * 0.7, 1.0, wn ) * ( 0.3 + vFoam * 0.7 );
    // ...and a line of it along the banks, thin, where the ribbon meets ground.
    float bank = 1.0 - smoothstep( 0.0, 0.08, min( vUv.x, 1.0 - vUv.x ) );
    bank *= step( vHalf, 100.0 );     // rivers only: a lake's uv is not across anything
    foam = max( foam, bank * 0.25 * vnoise( vW.xz * 0.4 + uTime * 0.2 ) );
    c = mix( c, uSky * 1.25 + vec3( 0.06 ), clamp( foam, 0.0, 1.0 ) * 0.8 );
    gl_FragColor = vec4( c, 1.0 );
    #include <fog_fragment>
  }
`;

function inlandMaterial(flow) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uFlow: { value: flow }, uFineR: { value: 0 },
      uDeep: { value: new THREE.Color(0x0c1a17) }, uSky: { value: new THREE.Color(0x9fb8c8) },
    }]),
    vertexShader: INLAND_VERT, fragmentShader: INLAND_FRAG, fog: true,
  });
}

const BODY = new THREE.Color(0x14261f);     // peaty water in daylight (linear-ish)

/**
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update(dt: number, camera: THREE.Camera): void, stats: object }}
 */
export function createRivers(scene, world) {
  // The coarse sheet's own height, for aLift. Nothing has streamed in yet when
  // this runs, so the drawn height IS the sheet.
  const coarseAt = world?.drawnHeightAt ?? terrainHeight;
  const W = inlandWater();
  const group = new THREE.Group();
  group.name = "inland-water";
  scene.add(group);
  if (!W) return { group, update() {}, stats: {} };

  // --- Running water: every run, split wherever it goes over a fall --------
  const pos = [], uv = [], foam = [], half = [], lift = [], idx = [];
  let vbase = 0;
  const strip = (pts) => {
    if (pts.length < 2) return;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      // Just past the channel's edge, under the lip of the bank.
      const w = p.w + 1.2;
      pos.push(p.x - tz * w, p.y, p.z + tx * w, p.x + tz * w, p.y, p.z - tx * w);
      uv.push(0, along, 1, along);
      // Steepness of the water here, for the white water.
      const dy = (a.y - b.y) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
      const f = Math.min(1, Math.max(0, (dy - 0.03) / 0.3));
      foam.push(f, f);
      half.push(p.w, p.w);
      const c = coarseAt(p.x, p.z);
      lift.push(Math.max(0, c - p.y, coarseAt(p.x - tz * w, p.z + tx * w) - p.y),
                Math.max(0, c - p.y, coarseAt(p.x + tz * w, p.z - tx * w) - p.y));
      if (i > 0) { const k = vbase + (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    vbase += pts.length * 2;
  };
  let runs = 0;
  for (const r of W.rivers) {
    let cur = [];
    for (let k = 0; k < r.pts.length; k++) {
      const p = r.pts[k];
      const prev = cur[cur.length - 1];
      // A drop this sharp between two points is a fall: the sheet draws it.
      if (prev && prev.y - p.y > 7) { strip(cur); cur = []; }
      cur.push(p);
    }
    strip(cur);
    runs++;
  }
  const flowMat = inlandMaterial(0.9);
  if (idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("aFoam", new THREE.Float32BufferAttribute(foam, 1));
    g.setAttribute("aHalf", new THREE.Float32BufferAttribute(half, 1));
    g.setAttribute("aLift", new THREE.Float32BufferAttribute(lift, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, flowMat);
    m.name = "rivers";
    m.frustumCulled = false;
    group.add(m);
  }

  // --- Still water: each lake a flat sheet at its level ---------------------
  // Quads over the hollow and one cell round it. The ground above the level
  // hides the sheet, so the shore is wherever the ground crosses the level —
  // the contour, not the grid.
  const lpos = [], luv = [], lfoam = [], lhalf = [], llift = [], lidx = [];
  for (const L of W.lakes) {
    const n = L.n, s = L.s;
    const on = new Uint8Array(n * n);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      let any = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) any |= L.mask[(j + b) * n + i + a];
      on[j * n + i] = any;
    }
    // Shared corners, so the sheet is one surface.
    const vid = new Int32Array((n + 1) * (n + 1)).fill(-1);
    const vert = (i, j) => {
      const k = j * (n + 1) + i;
      if (vid[k] < 0) {
        vid[k] = lpos.length / 3;
        const x = L.x0 + i * s, z = L.z0 + j * s;
        lpos.push(x, L.level, z);
        luv.push(x * 0.02, z * 0.02);
        lfoam.push(0); lhalf.push(1e4); llift.push(0);
      }
      return vid[k];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!on[j * n + i]) continue;
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      lidx.push(a, c, b, b, c, d);
    }
  }
  const stillMat = inlandMaterial(0.0);
  if (lidx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(lpos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(luv, 2));
    g.setAttribute("aFoam", new THREE.Float32BufferAttribute(lfoam, 1));
    g.setAttribute("aHalf", new THREE.Float32BufferAttribute(lhalf, 1));
    g.setAttribute("aLift", new THREE.Float32BufferAttribute(llift, 1));
    g.setIndex(lidx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, stillMat);
    m.name = "lakes";
    group.add(m);
  }

  // --- Falls: a sheet hugging the rock from the lip to the foot --------------
  const fpos = [], fuv = [], fdrop = [], fidx = [];
  const feet = [];
  let fv = 0;
  for (const f of W.falls) {
    const bottom = f.sea ? 0 : (f.bottom ?? 0);
    const top = f.top + 0.6;
    if (top - bottom < 8) continue;
    // Along the river's own line over the drop (inland) or straight on off
    // the cliff (sea), hugging the face a little proud of it.
    let ux = f.dx, uz = f.dz;
    let reach = 260;
    if (!f.sea && f.x1 !== undefined) {
      ux = f.x1 - f.x; uz = f.z1 - f.z;
      reach = Math.hypot(ux, uz) + 6;
    }
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const path = [];
    let y = top;
    for (let s = -3; s <= reach; s += 2) {
      const x = f.x + ux * s, z = f.z + uz * s;
      const g = Math.max(terrainHeight(x + ux * 3, z + uz * 3), terrainHeight(x, z));
      y = Math.min(y, Math.max(g + 1.2, bottom));
      path.push({ x, y, z });
      if (s > 0 && y <= bottom + 0.3) break;
    }
    if (path.length < 3) continue;
    const px = -uz, pz = ux;
    let along = 0;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z);
      const k = Math.min(1, Math.max(0, (top - p.y) / Math.max(1, top - bottom)));
      const w = f.w * (0.9 + k * 0.6) + 1;
      fpos.push(p.x - px * w, p.y, p.z - pz * w, p.x + px * w, p.y, p.z + pz * w);
      fuv.push(0, along, 1, along);
      fdrop.push(k, k);
      if (i > 0) { const q = fv + (i - 1) * 2; fidx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    fv += path.length * 2;
    const foot = path[path.length - 1];
    if (top - bottom >= 18) feet.push({ x: foot.x, y: foot.y, z: foot.z, w: f.w, h: top - bottom });
  }
  const fallMat = fallMaterial();
  if (fidx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(fpos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(fuv, 2));
    g.setAttribute("aDrop", new THREE.Float32BufferAttribute(fdrop, 1));
    g.setIndex(fidx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, fallMat);
    m.name = "falls";
    m.frustumCulled = false;
    m.renderOrder = 2;
    group.add(m);
  }

  // --- Spray at the foot of the falls near him -------------------------------
  // A small pool of puffs handed to whichever big falls are closest.
  const mistTex = softTexture();
  const PUFFS = 4, NEAR = 3;
  const mists = [];
  for (let k = 0; k < PUFFS * NEAR; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: 0xeef4f6, transparent: true, depthWrite: false, opacity: 0, fog: true }));
    s.visible = false;
    group.add(s);
    mists.push({ s, phase: (k % PUFFS) / PUFFS, foot: null });
  }
  let pickT = 0;
  const pick = (cam) => {
    const near = feet
      .map((f) => ({ f, d: Math.hypot(f.x - cam.x, f.z - cam.z) }))
      .filter((e) => e.d < 1500)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAR);
    mists.forEach((m, k) => { m.foot = near[Math.floor(k / PUFFS)]?.f ?? null; m.s.visible = !!m.foot; });
  };

  let t = 0;
  const _sky = new THREE.Color();
  return {
    group,
    stats: { runs, lakes: W.lakes.length, falls: fidx.length ? W.falls.length : 0, mists: feet.length },
    update(dt, camera) {
      t += dt;
      flowMat.uniforms.uTime.value = t;
      // How far out the streamed ground reaches (none on the low setting).
      flowMat.uniforms.uFineR.value = world?.detail?.detail?.refine ?? 0;
      stillMat.uniforms.uTime.value = t;
      fallMat.uniforms.uTime.value = t;
      // Lit by the haze: the sky the water is reflecting, and how bright it is.
      const fog = scene.fog?.color;
      if (fog) {
        _sky.copy(fog).multiplyScalar(1.15);
        const lum = Math.min(1, (fog.r * 0.3 + fog.g * 0.59 + fog.b * 0.11) * 2.2);
        for (const m of [flowMat, stillMat]) {
          m.uniforms.uSky.value.copy(_sky);
          m.uniforms.uDeep.value.copy(BODY).multiplyScalar(0.25 + 0.75 * lum);
        }
        fallMat.uniforms.uTint.value.copy(_sky).lerp(new THREE.Color(0.66, 0.76, 0.8), 0.5);
      }
      if (!camera) return;
      pickT -= dt;
      if (pickT <= 0) { pickT = 0.5; pick(camera.position); }
      for (const m of mists) {
        if (!m.foot) continue;
        const f = m.foot;
        const ph = (t * 0.09 + m.phase) % 1;
        const a = m.phase * 6.283;
        const spread = f.w * 1.6 + 4;
        m.s.position.set(
          f.x + Math.cos(a + t * 0.05) * spread * (0.3 + ph),
          f.y + 2 + ph * (f.h * 0.15 + 8),
          f.z + Math.sin(a + t * 0.05) * spread * (0.3 + ph));
        m.s.scale.setScalar((f.w * 3 + f.h * 0.06) * (0.6 + ph * 0.9));
        m.s.material.opacity = 0.28 * Math.sin(ph * Math.PI);
      }
    },
  };
}
