import * as THREE from "three";
import { SEA_LEVEL, WIND_BEARING } from "./terrain.js";

// ---------------------------------------------------------------------------
// Spray.
//
// The water shader can do foam, because foam is flat. What it cannot do is the
// thing that actually happens when a two-metre swell meets a basalt cliff,
// which is that a sheet of water goes fifteen metres straight up and comes down
// as rain. That is off the surface, so it needs geometry.
//
// The cheap way to do this badly is to emit particles from a collision test
// every frame. The way it is done here is to work out where the coast is ONCE,
// at load, off the sea field that was baked anyway — every texel where the
// waterline crosses, with how steep the rock behind it is and how exposed to
// the wind it is — and then keep a fixed pool of billboards parked on whichever
// of those sites are nearest the camera. Nothing is simulated. Each site bursts
// on the period of the long swell with an offset from its own coordinates, so a
// mile of coast goes off in a ragged sequence rather than all at once, and the
// whole thing is one draw call whose vertex count never changes.
// ---------------------------------------------------------------------------

const POOL = 420;              // billboards alive at once
const REACH = 900;             // metres from the camera worth showing spray at
const REBIND_EVERY = 0.33;     // seconds between re-parking the pool
const PERIOD = 9.9;            // s — the period of the 155 m swell in ocean.js

/**
 * Find every place the sea meets rock.
 * @param {object} field  result of bakeSeaField()
 */
function findSurfSites(field) {
  const { heights: h, distance: d, size: S, step, extent } = field;
  const sites = [];
  // Every third texel. At 20 m spacing that is still a site every 60 m of
  // coast, which is far more than the pool can ever show.
  for (let j = 2; j < S - 2; j += 3) {
    for (let i = 2; i < S - 2; i += 3) {
      const k = j * S + i;
      if (d[k] > step * 1.6) continue;             // not on the waterline
      const hc = h[k];
      if (hc < SEA_LEVEL - 14 || hc > SEA_LEVEL + 14) continue;

      // How hard the rock behind it is standing up. A cliff throws spray; a
      // beach absorbs the wave and gets a foam wash instead, which the water
      // shader already draws.
      const gx = (h[k + 2] - h[k - 2]) / (4 * step);
      const gz = (h[k + 2 * S] - h[k - 2 * S]) / (4 * step);
      const slope = Math.hypot(gx, gz);
      if (slope < 0.38) continue;   // a beach absorbs a wave; only rock throws it back

      const x = -extent + i * step;
      const z = -extent + j * step;
      // Facing into the wind gets hit; the back of the island does not.
      const nx = -gx / (slope || 1), nz = -gz / (slope || 1);
      const facing = -(nx * Math.sin(WIND_BEARING) + nz * Math.cos(WIND_BEARING));
      sites.push({
        x, z,
        cliff: Math.min(1, slope / 1.6),
        exposure: THREE.MathUtils.clamp(0.35 + facing * 0.75, 0.1, 1),
      });
    }
  }
  return sites;
}

const VERT = /* glsl */`
  attribute vec3 aSite;
  attribute vec4 aParam;    // phase, cliff, exposure, size

  uniform float uTime;
  uniform float uPeriod;
  uniform float uStrength;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vFade;

  void main() {
    float cliff = aParam.y;
    float exposure = aParam.z;

    // One burst per swell period, with a hard front and a long fall — a sheet
    // of water goes up fast and comes down slowly, and getting that asymmetry
    // right is most of what sells it.
    float cyc = fract( ( uTime + aParam.x ) / uPeriod );
    float rise = smoothstep( 0.0, 0.09, cyc );
    float fall = 1.0 - smoothstep( 0.09, 0.62, cyc );
    float life = rise * fall;
    if ( life < 0.002 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vFade = 0.0; return; }

    // Height follows a throw: fast up, then gravity. Not simulated, just the
    // shape of one.
    float t = clamp( ( cyc - 0.02 ) / 0.6, 0.0, 1.0 );
    float up = ( t * 2.4 - t * t * 2.4 ) * ( 4.0 + 16.0 * cliff ) * exposure * uStrength;

    vec3 centre = aSite;
    centre.y += up;
    // The wind takes it downwind and inland as it goes up, which is the reason
    // spray ends up on top of the cliff instead of falling back into the sea.
    centre.xz += uWind * up * 0.55;

    float grow = 0.55 + t * 1.9;
    float size = aParam.w * grow * ( 0.6 + 0.8 * exposure ) * uStrength;

    // Camera-facing, in view space, so it never edges out.
    vec4 mv = modelViewMatrix * vec4( centre, 1.0 );
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;

    vUv = uv;
    vFade = life * ( 0.35 + 0.65 * exposure );
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uFoam;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFade;

  void main() {
    // Round it off, and let the foam texture eat holes in the edge so it tears
    // like water rather than fading like a decal.
    vec2 p = vUv * 2.0 - 1.0;
    float r = dot( p, p );
    if ( r > 1.0 ) discard;
    float mask = 1.0 - r;
    float tex = texture2D( uFoam, vUv * 1.6 + vec2( uTime * 0.03, -uTime * 0.05 ) ).r;
    float a = mask * mask * vFade * smoothstep( 0.18, 0.75, tex * 0.6 + mask * 0.6 );
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

/**
 * @param {object} o
 *   scene, seaField, foamTexture
 */
export function createSurf({ scene, seaField, foamTexture }) {
  const sites = findSurfSites(seaField);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(quad.index);
  geo.setAttribute("position", quad.attributes.position);
  geo.setAttribute("uv", quad.attributes.uv);
  geo.instanceCount = 0;

  const aSite = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
  const aParam = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
  aSite.setUsage(THREE.DynamicDrawUsage);
  aParam.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aSite", aSite);
  geo.setAttribute("aParam", aParam);
  // It is parked around the camera and re-parked constantly, so a fixed huge
  // sphere is the only honest bound.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = {
    uTime: { value: 0 },
    uPeriod: { value: PERIOD },
    uStrength: { value: 1 },
    uWind: { value: new THREE.Vector2(Math.sin(WIND_BEARING), Math.cos(WIND_BEARING)) },
    uFoam: { value: foamTexture },
    uColor: { value: new THREE.Color(0xdfe9ec) },
  };

  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  let t = 0, sinceBind = 1e9;
  const near = [];

  function rebind(focus) {
    near.length = 0;
    const r2 = REACH * REACH;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const dx = s.x - focus.x, dz = s.z - focus.z;
      if (dx * dx + dz * dz < r2) near.push(s);
    }
    // More coast in range than the pool can hold: stride through it rather than
    // taking the first N, or the spray all ends up on one headland.
    const stride = Math.max(1, Math.ceil(near.length / POOL));
    let n = 0;
    for (let i = 0; i < near.length && n < POOL; i += stride) {
      const s = near[i];
      aSite.array[n * 3] = s.x;
      aSite.array[n * 3 + 1] = SEA_LEVEL + 0.5;
      aSite.array[n * 3 + 2] = s.z;
      // Phase from the site's own coordinates: stable, so a given rock always
      // breaks on the same beat instead of flickering when the pool is rebound.
      const hash = Math.abs(Math.sin(s.x * 0.0173 + s.z * 0.0411) * 43758.5453) % 1;
      aParam.array[n * 4] = hash * PERIOD;
      aParam.array[n * 4 + 1] = s.cliff;
      aParam.array[n * 4 + 2] = s.exposure;
      aParam.array[n * 4 + 3] = 2.2 + hash * 2.4;
      n++;
    }
    geo.instanceCount = n;
    aSite.needsUpdate = true;
    aParam.needsUpdate = true;
  }

  return {
    mesh,
    siteCount: sites.length,
    setStrength(v) { uniforms.uStrength.value = v; },
    setVisible(v) { mesh.visible = v; },
    update(focus, dt) {
      t += dt;
      uniforms.uTime.value = t;
      sinceBind += dt;
      if (focus && sinceBind > REBIND_EVERY) {
        sinceBind = 0;
        rebind(focus);
      }
    },
    dispose() { scene.remove(mesh); geo.dispose(); quad.dispose(); },
  };
}
