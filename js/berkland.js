import * as THREE from "three";
import { terrainHeight, berkStream } from "./terrain.js";
import { STREAM, streamFall } from "./berklayout.js";

// ---------------------------------------------------------------------------
// Berk's natural features that a height field cannot be: water above the sea.
//
// The burn off the western hills (berklayout.js STREAM): terrain.js finds its
// bed at load and cuts its channel down the gully; this runs the water along
// it and the fall off its lip, hugging the rock down into the harbour, with
// spray where it lands. Positions all come from berklayout.js via terrain.js.
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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


/** The fall: from the lip on along the stream's line, hugging the rock down to the cove. */
function buildFall(bed, fallMat) {
  const fl = streamFall();
  const lip = bed[bed.length - 1];
  const ux = fl.ux, uz = fl.uz;
  const top = lip.y + 1.0;
  const path = [];
  let y = top;
  for (let s = -4; s <= 260; s += 2) {
    const x = lip.x + ux * s, z = lip.z + uz * s;
    const g = Math.max(terrainHeight(x + ux * 4, z + uz * 4), terrainHeight(x, z));
    // It cannot rise, and it drops no faster than the rock lets it, held a
    // little proud of the face.
    y = Math.min(y, Math.max(g + 1.8, 0));
    path.push({ x, y, z });
    if (s > 0 && y <= 0.4) break;
  }
  const pos = [], uv = [], drop = [], idx = [];
  let along = 0;
  const px = -uz, pz = ux;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z);
    const k = clamp((top - p.y) / Math.max(1, top), 0, 1);
    const w = STREAM.w / 2 * (0.9 + k * 0.9);
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
  return { mesh, foot: path[path.length - 1], top: { x: lip.x, y: top, z: lip.z }, height: top };
}

/**
 * @param {THREE.Scene} scene
 */
export function createBerkLand(scene) {
  const root = new THREE.Group();
  root.name = "berk-land";
  scene.add(root);
  const bed = berkStream();
  if (bed.length < 3) return { root, update() {} };

  // The burn, a ribbon on its bed.
  const riverMat = waterMaterial(0.5);
  root.add(buildRiver(bed.map((p) => ({ x: p.x, y: p.y + 0.9, z: p.z, w: STREAM.w / 2 - 6 })), riverMat));

  // The fall, and the spray where it lands.
  const fallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uTint: { value: new THREE.Color(0xa9c3cc) },
    }]),
    vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const f = buildFall(bed, fallMat);
  root.add(f.mesh);
  const mistTex = softTexture();
  const mists = [];
  for (let k = 0; k < 7; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: 0xeef4f6, transparent: true, depthWrite: false, opacity: 0.4, fog: true }));
    mists.push({ s, base: new THREE.Vector3(f.foot.x, f.foot.y, f.foot.z), size: STREAM.w * (1.4 + k * 0.3) + f.height * 0.05, phase: k / 7, rise: f.height * 0.2 + 15, spread: STREAM.w * 1.2 });
    root.add(s);
  }

  let t = 0;
  return {
    root,
    update(dt) {
      t += dt;
      fallMat.uniforms.uTime.value = t;
      riverMat.uniforms.uTime.value = t;
      for (const m of mists) {
        // Each puff rises off the water, swells and fades, and starts again.
        const ph = (t * 0.09 + m.phase) % 1;
        const a = m.phase * 6.283;
        m.s.position.set(
          m.base.x + Math.cos(a + t * 0.05) * m.spread * (0.3 + ph),
          m.base.y + 3 + ph * m.rise,
          m.base.z + Math.sin(a + t * 0.05) * m.spread * (0.3 + ph));
        m.s.scale.setScalar(m.size * (0.6 + ph * 0.9));
        m.s.material.opacity = 0.3 * Math.sin(ph * Math.PI);
      }
    },
  };
}
