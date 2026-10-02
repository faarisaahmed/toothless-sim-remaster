import * as THREE from "three";
import { CLOUD_BASE } from "./clouds.js";

// ---------------------------------------------------------------------------
// Rain, and the thunder that goes with it.
//
// Rain is a box of streaks that travels with the camera. Every streak is one
// instanced quad and every bit of its motion is in the vertex shader — where
// it is in the box, how far it has fallen, the wrap back to the top — so the
// CPU's whole job per frame is two uniforms. It slants with the wind, it is lit
// by the same sky light as everything else (so night rain is dark rain), and
// it stops at the cloud base: fly up through the deck and you are out of it.
//
// Thunder is synthesised rather than loaded: filtered noise with a slow
// rumbling envelope, delayed by the distance to the strike at the speed of
// sound. No files, and every clap is different.
// ---------------------------------------------------------------------------

const COUNT = 7000;
const BOX = 260;          // metres across, centred on the camera
const HEIGHT = 220;

const VERT = /* glsl */`
  attribute vec4 aSeed;          // x, z in 0..1, phase, length scale
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec2 uWind;
  uniform float uFall;
  varying float vA;
  void main() {
    // Position in the box, wrapped round the camera so it never runs out.
    float fall = uTime * uFall + aSeed.z * ${HEIGHT.toFixed(1)};
    float y = ${HEIGHT.toFixed(1)} - mod( fall, ${HEIGHT.toFixed(1)} );
    vec3 base = vec3( aSeed.x * ${BOX.toFixed(1)}, y, aSeed.y * ${BOX.toFixed(1)} );
    base.xz += uWind * ( ${HEIGHT.toFixed(1)} - y ) * 0.25;
    vec3 c = uCam - vec3( ${(BOX / 2).toFixed(1)}, ${(HEIGHT / 2).toFixed(1)}, ${(BOX / 2).toFixed(1)} );
    vec3 wp = c + mod( base - c + 1e5, vec3( ${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)} ) );
    wp.y = c.y + y;

    // A streak: the quad's y is along the fall direction, x faces the camera.
    vec3 fallDir = normalize( vec3( uWind.x * 0.25, -1.0, uWind.y * 0.25 ) );
    vec3 toCam = normalize( uCam - wp );
    vec3 side = normalize( cross( fallDir, toCam ) );
    float len = 2.2 + aSeed.w * 2.6;
    wp += side * position.x * 0.045 + fallDir * position.y * len;

    // Fade near the box edges and very close to the eye.
    float d = length( wp - uCam );
    vA = smoothstep( 1.5, 6.0, d ) * ( 1.0 - smoothstep( ${(BOX * 0.32).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, d ) );
    gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uCol;
  uniform float uAmount;
  varying float vA;
  void main() {
    gl_FragColor = vec4( uCol, vA * uAmount * 0.32 );
  }
`;

export function createRain(scene) {
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, -0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute("position", quad.getAttribute("position"));
  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 4] = Math.random();
    seeds[i * 4 + 1] = Math.random();
    seeds[i * 4 + 2] = Math.random();
    seeds[i * 4 + 3] = Math.random();
  }
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = COUNT;

  const u = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2(0.4, 0.2) }, uFall: { value: 34 },
    uCol: { value: new THREE.Color(0.7, 0.75, 0.82) }, uAmount: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: u,
    transparent: true, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = "rain";
  mesh.visible = false;
  scene.add(mesh);

  let t = 0;
  return {
    mesh,
    update(dt, camera, amount, key, B) {
      t += dt;
      // Out of it above the cloud base.
      const y = camera ? camera.position.y : 0;
      const a = amount * (1 - THREE.MathUtils.smoothstep(y, CLOUD_BASE - 80, CLOUD_BASE + 40));
      u.uAmount.value = a;
      mesh.visible = a > 0.01;
      if (!mesh.visible) return;
      u.uTime.value = t;
      if (camera) u.uCam.value.copy(camera.position);
      u.uFall.value = 30 + amount * 14;
      // Lit by the sky: pale grey by day, nearly black at night.
      u.uCol.value.copy(key.amb).multiplyScalar(key.ambI * B * 1.6).addScalar(0.04);
      g.instanceCount = Math.round(COUNT * (0.35 + 0.65 * amount));
    },
  };
}

// --- Thunder ----------------------------------------------------------------
let actx = null;
function audio() {
  if (actx) return actx;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  // Browsers start contexts suspended until the page has been interacted
  // with; any key or click will do.
  const wake = () => actx.resume?.();
  window.addEventListener("keydown", wake, { capture: true });
  window.addEventListener("pointerdown", wake, { capture: true });
  return actx;
}

/** A clap of thunder `dist` metres away. */
export function thunder(dist, volume = 0.6) {
  const ctx = audio();
  if (!ctx || ctx.state !== "running" || volume <= 0) return;
  const delay = Math.min(12, dist / 343);
  const dur = 2.5 + Math.random() * 2.5;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Brown noise: a random walk, which is what a rumble is.
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.02) * 0.998;
    d[i] = last * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  // Close strikes crack; far ones only rumble.
  lp.frequency.value = THREE.MathUtils.lerp(900, 180, Math.min(1, dist / 7000));
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + delay;
  const peak = volume * THREE.MathUtils.lerp(1, 0.35, Math.min(1, dist / 7000));
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.08);
  gain.gain.exponentialRampToValueAtTime(peak * 0.4, t0 + 0.6);
  // A second roll partway through.
  gain.gain.linearRampToValueAtTime(peak * 0.7, t0 + dur * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(gain).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.1);
}
