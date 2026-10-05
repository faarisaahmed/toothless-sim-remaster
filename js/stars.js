import * as THREE from "three";

// ---------------------------------------------------------------------------
// The night sky.
//
// Not random dots: the real one. assets/data/stars.bin is every star to
// magnitude 6.3 from the Yale Bright Star Catalogue (tools/sky/build_stars.py)
// — seven thousand of them, which is what a dark sky shows a good eye — each
// with its true position, brightness and colour. So the Plough wheels round
// Polaris, Orion comes up in the south-east, Cassiopeia's W stands overhead,
// and anyone who knows the sky will find them.
//
// THE SKY TURNS. Berk is an Atlantic island at about 64° north, the latitude
// of Iceland: Polaris stands 64° up in the north and the Plough never sets.
// The celestial sphere turns once per game day about the pole, keyed to the
// clock, so the stars rise in the east and set in the west through a night,
// and the same stars are up at the same hour every night.
//
// EACH STAR is a point sprite sized by its flux, not its magnitude — so the
// handful of first-magnitude stars are what the eye goes to and the faint
// thousands are a dust behind them — coloured by its temperature (blue-white
// Rigel, orange Betelgeuse and Arcturus), dimmed and reddened toward the
// horizon by the extra air, and twinkling more the lower it is, which is
// the thing that makes a starfield look like sky and not like a texture.
// ---------------------------------------------------------------------------

/** Latitude of the archipelago, degrees north. */
export const LATITUDE = 64;

/** Blackbody colour for a temperature in kelvin, roughly (Tanner Helland's fit). */
function kelvinRGB(k, out) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  out[0] = Math.min(255, Math.max(0, r)) / 255;
  out[1] = Math.min(255, Math.max(0, g)) / 255;
  out[2] = Math.min(255, Math.max(0, b)) / 255;
  // The eye sees stars far less saturated than a blackbody curve says — at
  // night colour vision barely works — so pull them most of the way to white.
  const l = out[0] * 0.3 + out[1] * 0.59 + out[2] * 0.11;
  for (let i = 0; i < 3; i++) out[i] = l + (out[i] - l) * 0.55;
  return out;
}

const VERT = /* glsl */`
  attribute float aMag;
  attribute vec3 aCol;
  attribute float aSeed;
  uniform mat3 uEqToWorld;
  uniform float uFade, uTime, uPixel, uLimit;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec3 d = normalize( uEqToWorld * position );
    // Air: the lower a star, the more atmosphere its light comes through.
    // Extinction is about a quarter of a magnitude per airmass, and the
    // airmass runs away near the horizon.
    float alt = d.y;
    float airmass = 1.0 / max( 0.035, alt + 0.025 );
    float mag = aMag + 0.25 * ( airmass - 1.0 );
    // Twinkle: scintillation is turbulence across the line of sight, so it
    // is strongest low down, and it flickers fast.
    float tw = sin( uTime * ( 9.0 + aSeed * 13.0 ) + aSeed * 50.0 ) * 0.5
             + sin( uTime * ( 17.0 + aSeed * 7.0 ) + aSeed * 21.0 ) * 0.5;
    float flux = pow( 10.0, -0.4 * ( mag - 1.0 ) );
    flux *= 1.0 + tw * mix( 0.12, 0.6, smoothstep( 0.6, 0.05, alt ) );
    // Faint stars fade out rather than vanish at the limit.
    flux *= smoothstep( uLimit + 0.3, uLimit - 0.8, mag );
    // The eye's response to a point source is far from linear in flux —
    // roughly the square root — which is why a sixth-magnitude star is
    // visible at all next to Sirius at a hundred times its light.
    vA = clamp( pow( flux, 0.42 ) * 1.1, 0.0, 1.0 ) * uFade * smoothstep( -0.01, 0.03, alt );
    // Reddened low down, the way the sun is.
    vCol = aCol * mix( vec3( 1.0 ), vec3( 1.0, 0.78, 0.6 ), smoothstep( 0.25, 0.0, alt ) );
    vCol *= max( 1.0, sqrt( flux ) );
    gl_PointSize = clamp( 1.8 + sqrt( flux ) * 2.2, 1.8, 7.5 ) * uPixel;
    vec4 mv = modelViewMatrix * vec4( d * 30000.0, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const FRAG = /* glsl */`
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float r2 = dot( q, q ) * 4.0;
    // A point source through an eye: a sharp core and a faint skirt.
    float core = exp( -r2 * 9.0 ) + exp( -r2 * 2.5 ) * 0.15;
    if ( core * vA < 0.002 ) discard;
    gl_FragColor = vec4( vCol * core * vA, 1.0 );
  }
`;

/**
 * Equatorial to world, for a local sidereal time in hours. World is three's
 * axes as the game uses them: +X east, +Y up, -Z north.
 */
export function equatorialToWorld(lstHours, out = new THREE.Matrix3()) {
  const phi = THREE.MathUtils.degToRad(LATITUDE);
  const lst = lstHours / 24 * Math.PI * 2;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const col = (x, y, z) => {
    // Turn the sphere so the local meridian is at hour angle zero...
    const c = Math.cos(-lst), s = Math.sin(-lst);
    const vx = x * c - y * s, vy = x * s + y * c, vz = z;
    // ...then read it off the horizon: up is the zenith (cos phi, 0, sin phi)
    // in that frame, north the pole's foot (-sin phi, 0, cos phi), and +y
    // is minus the sine of the hour angle — a star before the meridian, which
    // is to say in the east.
    const up = vx * cp + vz * sp;
    const north = -vx * sp + vz * cp;
    const east = vy;
    return [east, up, -north];
  };
  const a = col(1, 0, 0), b = col(0, 1, 0), c = col(0, 0, 1);
  out.set(a[0], b[0], c[0],
          a[1], b[1], c[1],
          a[2], b[2], c[2]);
  return out;
}

export function createStars(scene) {
  const uniforms = {
    uEqToWorld: { value: new THREE.Matrix3() },
    uFade: { value: 0 }, uTime: { value: 0 },
    uPixel: { value: 1 }, uLimit: { value: 6.3 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
    blending: THREE.AdditiveBlending,
  });
  const geo = new THREE.BufferGeometry();
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -9;
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  let ready = false;
  fetch("./assets/data/stars.bin").then((r) => r.arrayBuffer()).then((buf) => {
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    const pos = new Float32Array(n * 3), mag = new Float32Array(n);
    const col = new Float32Array(n * 3), seed = new Float32Array(n);
    const rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 8;
      pos[i * 3] = dv.getInt16(o, true) / 32767;
      pos[i * 3 + 1] = dv.getInt16(o + 2, true) / 32767;
      pos[i * 3 + 2] = dv.getInt16(o + 4, true) / 32767;
      mag[i] = dv.getUint8(o + 6) / 25 - 2;
      kelvinRGB(dv.getUint8(o + 7) * 100, rgb);
      col.set(rgb, i * 3);
      seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    geo.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    ready = true;
  }).catch((e) => console.warn("stars: no catalogue", e));

  return {
    points, uniforms,
    /** fade 0..1 (night and clear sky), lst in hours, pixel ratio for size. */
    update(camera, { fade, lst, time, pixel = 1 }) {
      equatorialToWorld(lst, uniforms.uEqToWorld.value);
      uniforms.uFade.value = fade;
      uniforms.uTime.value = time;
      uniforms.uPixel.value = pixel;
      points.visible = ready && fade > 0.01;
      if (camera) points.position.copy(camera.position);
    },
  };
}
