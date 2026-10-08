import * as THREE from "three";
import { HeightFog, patchFogChunks } from "./photoreal.js";
import { WEATHER_GLSL, CLOUD_BASE, CLOUD_TOP, VOLUME_FAR, WEATHER_TILE } from "./clouds.js";
import { WIND_BEARING } from "./terrain.js";
import { createStars } from "./stars.js";

// ---------------------------------------------------------------------------
// The sky: time of day and weather.
//
// One clock and one weather state, and everything that lights the world reads
// them: the dome, the sun and moon and which of the two casts the shadows, the
// sky light, the fog, the exposure, the sea's glint and body colour, the
// environment map every material reflects, the volumetric clouds and the rain.
// Before this the sky was a fixed late afternoon, and "night" for the raid was
// the same sky with the sun pushed under the horizon.
//
// THE CLOCK runs in hours, 0..24. The sun rises in the east at half five, is
// in the south at noon and sets in the west at eight — a northern summer, long
// days and a short blue night — and the moon rides opposite it. Colours come
// from keyframes on the sun's ELEVATION rather than on the hour, so twilight
// looks like twilight however the clock is being driven.
//
// THE WEATHER is a handful of presets (clear, fair, overcast, rain, storm,
// fog) and the live state is always a blend between the last one and the next,
// so a change rolls in over a minute instead of switching.
//
// THE NIGHT is the real sky over the North Atlantic: the catalogue stars
// turning about Polaris (stars.js), the Milky Way where it really lies, a
// moon with a phase, and on most clear nights the aurora in the north —
// drawn in the dome, so the sea reflects all of it.
//
// THE SUN is a limb-darkened disc with the haze's aureole round it; main.js
// adds the lens — glare, starburst, ghosts, and shafts through any gap.
//
// THE DOME is drawn on a sphere that follows the camera. It also carries a flat
// cloud deck read from the same weather map as the volumetric clouds — that is
// what the sea reflects, what the environment map is made of, what Low
// quality shows, and what fills the far horizon past the volume's reach.
// ---------------------------------------------------------------------------

const lin = (hex) => new THREE.Color(hex);  // THREE.Color(hex) converts sRGB → linear

/** Sky keyframes on sun elevation, degrees. */
// A northern sky. Berk is at the latitude of Iceland, and the light there
// is not a holiday light: the sun never gets high, so even at noon it comes
// in low and white across the water; the sky is a pale cold blue going to
// grey-white at the horizon with the haze off the sea; and the ambient light
// in the shadows is the blue of all that sky. Gold is for the hour either
// side of sunset, and it earns its place by being the only warm thing in
// the day. Night is not black but a deep blue-black with the stars in it.
const KEYS = [
  // Night is lit the way films and games light it, not the way a camera
  // would: "day for night". A deep blue sky, but a strong cold key from the
  // moon and a generous blue fill, so the land, the sea and the dragon all
  // read. A truly dark night is realistic and unplayable.
  { e: -24, zen: 0x07112a, hor: 0x1a2c52, glow: 0x0f1a34, sun: 0x000000, sunI: 0.0,
    amb: 0x4562a0, ambI: 1.6, gnd: 0x141c2c, B: 1.05, exp: 2.7 },
  { e: -9,  zen: 0x08142f, hor: 0x1f2e52, glow: 0x2c3054, sun: 0x000000, sunI: 0.0,
    amb: 0x42598f, ambI: 1.3, gnd: 0x121a28, B: 1.0, exp: 2.1 },
  { e: -3,  zen: 0x13264e, hor: 0x5e5670, glow: 0xa85a3c, sun: 0xff5a20, sunI: 0.15,
    amb: 0x56628e, ambI: 0.95, gnd: 0x1a1a22, B: 1.0, exp: 1.45 },
  { e: 2,   zen: 0x26457f, hor: 0xd08866, glow: 0xff8644, sun: 0xff8a4c, sunI: 1.25,
    amb: 0x7d84a6, ambI: 0.62, gnd: 0x2c2a28, B: 1.25, exp: 0.98 },
  { e: 9,   zen: 0x335a9a, hor: 0xd6b9a2, glow: 0xffb27a, sun: 0xffcc9c, sunI: 2.0,
    amb: 0x92a6c8, ambI: 0.42, gnd: 0x3e4038, B: 1.6, exp: 0.72 },
  { e: 20,  zen: 0x3a64a2, hor: 0xc2cdd8, glow: 0xf2ece4, sun: 0xfbf2e6, sunI: 2.3,
    amb: 0x96b2d6, ambI: 0.31, gnd: 0x4c5446, B: 1.9, exp: 0.62 },
  { e: 40,  zen: 0x36629e, hor: 0xc6d3de, glow: 0xf4f4f2, sun: 0xf6f4f0, sunI: 2.55,
    amb: 0x98b4d8, ambI: 0.29, gnd: 0x4e5848, B: 2.05, exp: 0.6 },
].map((k) => ({ ...k, zen: lin(k.zen), hor: lin(k.hor), glow: lin(k.glow), sun: lin(k.sun),
                amb: lin(k.amb), gnd: lin(k.gnd) }));

/**
 * Weather presets.
 *   cover    cloud coverage 0..1          dens   cloud density
 *   cum      cumulus 0 (sheet) .. 1 (towers)
 *   over     how grey the sky is          dim    how much of the sun gets through
 *   fog      haze multiplier              rain   0..1
 *   wind     wave and drift multiplier    bolt   lightning
 */
export const WEATHER = {
  clear:    { cover: 0.30, dens: 2.6, cum: 0.7,  mist: 0.10, cirrus: 0.9, over: 0.0,  dim: 0.0,  fog: 1.0, rain: 0, wind: 0.9, bolt: 0 },
  fair:     { cover: 0.47, dens: 2.8, cum: 0.85, mist: 0.30, cirrus: 0.6, over: 0.04, dim: 0.06, fog: 1.1, rain: 0, wind: 1.0, bolt: 0 },
  overcast: { cover: 0.80, dens: 2.8, cum: 0.45, mist: 0.45, cirrus: 0.0, over: 0.4,  dim: 0.6,  fog: 1.8, rain: 0, wind: 1.3, bolt: 0 },
  rain:     { cover: 0.88, dens: 3.0, cum: 0.6,  mist: 0.55, cirrus: 0.0, over: 0.55, dim: 0.75, fog: 2.6, rain: 0.75, wind: 1.6, bolt: 0 },
  storm:    { cover: 0.93, dens: 3.6, cum: 1.0,  mist: 0.35, cirrus: 0.0, over: 0.7,  dim: 0.88, fog: 3.0, rain: 1.0, wind: 2.3, bolt: 1 },
  fog:      { cover: 0.40, dens: 2.4, cum: 0.4,  mist: 1.00, cirrus: 0.2, over: 0.4,  dim: 0.35, fog: 7.0, rain: 0, wind: 0.7, bolt: 0 },
};
export const WEATHER_NAMES = Object.keys(WEATHER);

const BASE_FOG = 0.000036;

const DOME_VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;     // on the far plane, always behind everything
  }
`;

const DOME_FRAG = /* glsl */`
  varying vec3 vWorld;
  uniform vec3 uZen, uHor, uGlow, uSunCol, uGnd, uOverCol, uMoonDir;
  uniform vec3 uSunDir;
  uniform float uOver, uSunVis, uFlash, uNight;
  uniform float uTime, uStarFade, uAurora, uHaze, uAurSteps;
  uniform mat3 uWorldToEq;
  uniform float uDeckNear;     // the flat deck only beyond this distance
  uniform vec3 uDeckLit, uDeckShade;
  uniform float uDeckDens;
  uniform float uCirrus;
  ${WEATHER_GLSL}

  float hsh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hsh( i ), hsh( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( hsh( i + vec2( 0.0, 1.0 ) ), hsh( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float fbm4( vec2 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 4; i++ ) { s += vnoise( p ) * a; p *= 2.03; a *= 0.5; }
    return s;
  }

  // The Milky Way. Direction to galactic coordinates (J2000), then a band
  // along the galactic equator — brightest toward the centre in Sagittarius,
  // split by the Great Rift's dust in Cygnus and Aquila, mottled with star
  // clouds — so it lies across the sky exactly where the real one does.
  vec3 milkyWay( vec3 dir ) {
    vec3 e = uWorldToEq * dir;
    vec3 g = mat3( -0.0548756, 0.4941094, -0.8676661,
                   -0.8734371, -0.4448296, -0.1980764,
                   -0.4838350, 0.7469822, 0.4559838 ) * e;
    float b = asin( clamp( g.z, -1.0, 1.0 ) );
    float l = atan( g.y, g.x );
    float lc = abs( l );                                  // 0 at the centre
    float band = exp( -b * b / 0.06 ) * 0.55 + exp( -b * b / 0.018 ) * 0.5;
    band *= 0.4 + 0.6 * exp( -lc * lc / 1.4 );
    // The bulge round the centre, in Sagittarius and Scorpius.
    band += exp( -( lc * lc ) / 0.12 - b * b / 0.03 ) * 0.6;
    // Star clouds: round-ish clumps (the noise is not stretched along the
    // band, or it draws as ruled lines), and dust: dark lanes on the plane,
    // heaviest in the rift between Cygnus and the centre.
    vec2 q = vec2( l * 5.0, b * 7.0 );
    float cl = fbm4( q * 1.3 + 2.0 );
    float clouds = 0.35 + cl * cl * 2.0;
    float rift = smoothstep( 0.07, 0.0, abs( b + 0.02 + ( fbm4( q * 0.9 ) - 0.5 ) * 0.09 ) )
               * smoothstep( 1.7, 0.5, lc ) * smoothstep( 0.0, 0.35, lc ) * 0.6;
    float dust = smoothstep( 0.4, 0.75, fbm4( q * 2.3 + 7.0 ) );
    float v = band * clouds * ( 1.0 - rift ) * ( 1.0 - dust * 0.5 );
    return vec3( 0.72, 0.78, 0.95 ) * v;
  }

  // The aurora. Curtains hanging in the northern sky, a hundred kilometres
  // up and more: the view ray is walked up through that height, and at each
  // step the curtain's footprint — a wavering east-west line, frayed into
  // vertical rays — adds light. Green where it is low and bright, fading to
  // the red and violet of the thin air at the top.
  float fbm3( vec2 p ) {
    return vnoise( p ) * 0.57 + vnoise( p * 2.03 ) * 0.29 + vnoise( p * 4.1 ) * 0.14;
  }
  vec3 aurora( vec3 dir ) {
    // Only the northern sky has any, and only above the horizon.
    if ( dir.y < 0.015 || dir.z / dir.y > -0.6 ) return vec3( 0.0 );
    vec3 acc = vec3( 0.0 );
    float t = uTime;
    for ( int i = 0; i < 12; i++ ) {
      float fi = float( i );
      if ( fi >= uAurSteps ) break;
      float hgt = 1.0 + fi * ( 1.32 / uAurSteps );
      vec2 p = dir.xz / ( dir.y + 0.04 ) * hgt;           // where the ray is at this height
      // Nowhere near either sheet, however they fold (the warp and the waves
      // move them by under a unit): skip the noise, which is all the cost.
      if ( abs( p.y + 2.3 ) > 1.35 && abs( p.y + 3.5 ) > 1.7 ) continue;
      float x = p.x * 1.15;
      // The sheets fold and drift: a slow domain warp along their length
      // bends each into loops and S-curves rather than a ruled line.
      float warp = fbm3( vec2( x * 0.28 + 1.7, t * 0.012 ) ) - 0.5;
      float c1 = p.y + 2.3 + 0.5 * sin( x * 0.55 + t * 0.04 + warp * 6.0 ) + 0.45 * warp;
      float c2 = p.y + 3.5 + 0.7 * sin( x * 0.4 - t * 0.03 + 2.0 + warp * 4.0 ) - 0.4 * warp;
      float sheet = exp( -c1 * c1 * 10.0 ) + exp( -c2 * c2 * 6.0 ) * 0.7;
      if ( sheet < 0.003 ) continue;
      // Activity comes and goes along the arc: bright knots, quiet gaps.
      float act = smoothstep( 0.3, 0.7, fbm3( vec2( x * 0.42 + 4.0, t * 0.01 ) ) );
      // Rays: the field lines, irregular in spacing and brightness, and
      // drifting along the curtain.
      float rx = x * 5.0 + warp * 7.0 + t * 0.05;
      float rays = vnoise( vec2( rx, t * 0.18 ) ) * 0.6 + vnoise( vec2( rx * 2.7, t * 0.4 ) ) * 0.4;
      float fh = fi * 12.0 / uAurSteps;                  // as if there were twelve steps
      float a = sheet * act * ( 0.5 + 0.8 * rays * rays ) * exp( -fh * 0.17 ) * ( 12.0 / uAurSteps );
      vec3 col = mix( vec3( 0.12, 1.0, 0.42 ), vec3( 0.35, 0.18, 0.75 ), smoothstep( 3.5, 10.0, fh ) );
      acc += col * a;
    }
    return acc * 0.19 * smoothstep( 0.015, 0.12, dir.y );
  }

  void main() {
    vec3 dir = normalize( vWorld - cameraPosition );
    float h = dir.y;
    float up = max( h, 0.0 );

    // Base gradient: a deep zenith down to a pale horizon, the transition
    // pushed low so most of what a flyer sees is the bright band.
    float hz = pow( 1.0 - up, 4.0 );
    vec3 col = mix( uZen, uHor, hz );

    // The sun's side of the sky: a broad warm wash along the horizon under it,
    // which is the whole of a sunset, and a tight forward halo around it.
    float cs = dot( dir, uSunDir );
    float side = max( 0.0, dot( normalize( vec2( dir.x, dir.z ) + 1e-5 ), normalize( vec2( uSunDir.x, uSunDir.z ) + 1e-5 ) ) );
    col = mix( col, uGlow, pow( side, 3.0 ) * hz * 0.75 );
    col += uSunCol * ( pow( max( cs, 0.0 ), 48.0 ) * 0.9 + pow( max( cs, 0.0 ), 6.0 ) * 0.12 ) * uSunVis;

    // Night: the Milky Way and, some nights, the aurora. Both behind cloud.
    if ( uStarFade > 0.001 && h > -0.02 ) {
      float lift = smoothstep( -0.02, 0.15, h );
      col += milkyWay( dir ) * 0.03 * uStarFade * lift;
      if ( uAurora > 0.001 ) col += aurora( dir ) * uAurora * uStarFade;
    }

    // Overcast: the gradient flattens to a lit grey.
    col = mix( col, uOverCol * mix( 0.75, 1.1, up ), uOver );

    // Below the horizon is the haze, the same colour the fog goes to, so the
    // sea's far edge and the sky meet without a line.
    col = mix( col, uGnd, smoothstep( 0.02, -0.05, h ) );

    // The sun. A disc a little over a degree across — larger than the real
    // half-degree, as every painter has made it, because a true-size sun is a
    // pinprick on a monitor — dimmer at its limb as the real one is, and
    // round it the forward scatter of the haze: a tight bright aureole and a
    // wide soft glow whose size is how much salt and water is in the air.
    float ang = acos( clamp( cs, -1.0, 1.0 ) );
    float R = 0.0105;
    float discM = 1.0 - smoothstep( R * 0.9, R, ang );
    float mu = sqrt( max( 0.0, 1.0 - ( ang / R ) * ( ang / R ) ) );
    float limb = 0.45 + 0.55 * mu;
    float clearV = uSunVis * ( 1.0 - uOver );
    col += uSunCol * discM * limb * 90.0 * clearV;
    float g = 0.82;
    float mie = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * cs, 1.5 );
    col += uSunCol * ( exp( -ang * 70.0 ) * 2.2 + exp( -ang * 16.0 ) * 0.22 * ( 0.6 + uHaze )
                       + mie * 0.0035 * ( 0.5 + uHaze ) ) * clearV;

    // Cirrus: fibres at eight kilometres, read from the map's fourth channel
    // stretched hard along the wind. Thin, bright on the sun's side.
    if ( h > 0.01 && uCirrus > 0.0 ) {
      float tc = ( 8000.0 - cameraPosition.y ) / h;
      vec3 pc = cameraPosition + dir * tc;
      vec2 along = uWindDir, across = vec2( -uWindDir.y, uWindDir.x );
      vec2 cq = vec2( dot( pc.xz + uWeatherOff * 2.0, across ) * 1.0, dot( pc.xz, along ) * 0.18 );
      // The map's own contours, thresholded, came out as loops and curls —
      // worms, not ice. Cirrus is fibre: a soft broad patch from the map,
      // combed into fine streaks by a second lookup stretched much harder
      // along the wind, and averaged along it so no edge is ever a contour.
      float broad = 0.0;
      for ( int k = 0; k < 3; k++ ) broad += texture2D( tWeather, ( cq + vec2( 0.0, float( k ) * 900.0 ) ) / 26000.0 ).a;
      broad = smoothstep( 0.42, 0.95, broad / 3.0 );
      float fib = texture2D( tWeather, vec2( cq.x * 6.0, cq.y * 0.35 ) / 26000.0 + 0.37 ).a;
      float ci = broad * ( 0.35 + 0.65 * smoothstep( 0.35, 0.85, fib ) );
      ci *= uCirrus * smoothstep( 0.01, 0.12, h ) * 0.8;
      vec3 cc = uDeckLit * 1.1 + uSunCol * 0.15 * pow( max( cs, 0.0 ), 4.0 );
      col = mix( col, cc, ci * 0.55 * ( 1.0 - uOver ) );
    }

    // The painted deck: the cumulus layer's map projected on a plane in the
    // middle of the layer. It is the whole cloud field on Low, the far
    // horizon past the volume's reach otherwise, and what the sea reflects.
    if ( h > 0.004 && uDeckDens > 0.0 ) {
      float H = ${((CLOUD_BASE + CLOUD_TOP) * 0.42).toFixed(1)};
      float t = ( H - cameraPosition.y ) / h;
      if ( t > uDeckNear && t > 0.0 ) {
        vec3 p = cameraPosition + dir * t;
        vec4 w = weatherAt( p.xz );
        float c = coverageOf( w );
        // Break the edges with the map's finer channels so the painted clouds
        // fray instead of ending on a contour.
        float fr = texture2D( tWeather, weatherUV( p.xz ) * 7.0 + 0.3 ).r;
        c = clamp( c * 1.3 - ( 1.0 - fr ) * 0.45, 0.0, 1.0 );
        float lit = 0.5 + 0.5 * max( 0.0, dot( normalize( dir.xz + 1e-5 ), normalize( uSunDir.xz + 1e-5 ) ) );
        // Thick in the middle, lit on top and grey underneath — seen from
        // below, which is how it is nearly always seen.
        vec3 cc = mix( uDeckShade, uDeckLit, mix( 0.25, 0.85, lit ) * ( 1.0 - c * 0.45 ) );
        cc += uSunCol * 0.25 * pow( max( cs, 0.0 ), 8.0 ) * ( 1.0 - c );
        cc += vec3( uFlash * 3.0 );
        float fade = smoothstep( 0.004, 0.05, h ) * uDeckDens;
        col = mix( col, cc, c * fade );
      }
    }

    col += vec3( 0.55, 0.6, 0.75 ) * uFlash * ( 0.6 + up );
    gl_FragColor = vec4( col, 1.0 );
  }
`;

function moonTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const halo = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  halo.addColorStop(0, "rgba(200,215,255,0.35)");
  halo.addColorStop(0.4, "rgba(160,180,240,0.08)");
  halo.addColorStop(1, "rgba(120,140,220,0)");
  g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lerpKey(e) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (e <= a.e) b = a;
  else if (e >= b.e) a = b;
  else for (let i = 0; i < KEYS.length - 1; i++) {
    if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
  const out = {};
  for (const k of Object.keys(a)) {
    if (k === "e") continue;
    out[k] = a[k].isColor ? a[k].clone().lerp(b[k], t) : a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Sun direction for an hour of the day. Compass bearing → three spherical. */
export function sunPosition(hour) {
  const DAY0 = 5.5, DAY1 = 20.0;
  let elev, bearing;
  const h = ((hour % 24) + 24) % 24;
  if (h >= DAY0 && h <= DAY1) {
    const f = (h - DAY0) / (DAY1 - DAY0);
    // A high-latitude sun: forty degrees at its highest, so the light is
    // always raking — long shadows at noon are half of what reads as north.
    elev = 40 * Math.sin(Math.PI * f);
    bearing = 72 + 216 * f;            // ENE → S → WNW
  } else {
    const f = ((h - DAY1 + 24) % 24) / (24 - (DAY1 - DAY0));
    elev = -26 * Math.sin(Math.PI * f);
    bearing = 288 + 144 * f;
  }
  return { elev, bearing };
}

const dirFrom = (elev, bearing, out) => out.setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(180 - bearing));

/**
 * @param {object} o
 *   scene, renderer
 *   sun        the DirectionalLight (sun by day, moon by night)
 *   hemi       the HemisphereLight
 *   ocean      createOcean() result
 *   lightDir   Vector3 world.js aims the shadow light along; written here
 */
export function createSky({ scene, renderer, sun, hemi, ocean, lightDir }) {
  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, 1, 0);

  const u = {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uGnd: { value: new THREE.Color() }, uOverCol: { value: new THREE.Color() },
    uSunDir: { value: sunDir }, uMoonDir: { value: moonDir },
    uOver: { value: 0 }, uSunVis: { value: 1 }, uFlash: { value: 0 }, uNight: { value: 0 },
    uDeckNear: { value: 0 }, uDeckLit: { value: new THREE.Color() }, uDeckShade: { value: new THREE.Color() },
    uDeckDens: { value: 0 },
    tWeather: { value: null }, uWeatherOff: { value: new THREE.Vector2() }, uCoverage: { value: 0.4 },
    uWindDir: { value: new THREE.Vector2(Math.sin(WIND_BEARING), Math.cos(WIND_BEARING)) },
    uMist: { value: 0 }, uCirrus: { value: 0 },
    uTime: { value: 0 }, uStarFade: { value: 0 }, uAurora: { value: 0 }, uHaze: { value: 0.3 },
    uAurSteps: { value: 12 },
    uWorldToEq: { value: new THREE.Matrix3() },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(42000, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms: u,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.name = "sky";
  scene.add(dome);

  const starfield = createStars(scene);
  const stars = starfield.points;

  // The moon: a lit ball, not a sticker. Its phase is wherever the sun
  // really is, its seas and highlands are noise on the sphere, and the dark
  // limb keeps a trace of earthshine. A soft halo of the haze round it.
  const moonU = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uFade: { value: 0 } };
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: moonU, transparent: true, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vN, vObj;
        void main() {
          vN = normalize( mat3( modelMatrix ) * normal );
          vObj = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position.z = gl_Position.w * 0.99998;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun;
        uniform float uFade;
        varying vec3 vN, vObj;
        float h3( vec3 p ) { return fract( sin( dot( p, vec3( 17.1, 113.7, 51.3 ) ) ) * 43758.5 ); }
        float n3( vec3 p ) {
          vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( h3( i ), h3( i + vec3( 1, 0, 0 ) ), f.x ), mix( h3( i + vec3( 0, 1, 0 ) ), h3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( h3( i + vec3( 0, 0, 1 ) ), h3( i + vec3( 1, 0, 1 ) ), f.x ), mix( h3( i + vec3( 0, 1, 1 ) ), h3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }
        void main() {
          vec3 p = normalize( vObj );
          // Seas: big dark smooth patches. Highlands: bright and mottled.
          float maria = smoothstep( 0.52, 0.62, n3( p * 2.2 + 3.0 ) * 0.65 + n3( p * 4.7 ) * 0.35 );
          float mott = n3( p * 14.0 ) * 0.5 + n3( p * 31.0 ) * 0.25;
          float alb = mix( 0.95, 0.55, maria ) * ( 0.85 + mott * 0.3 );
          float lit = smoothstep( -0.02, 0.18, dot( vN, uSun ) );
          vec3 c = vec3( 0.93, 0.95, 1.0 ) * alb * ( lit * 1.9 + 0.025 );
          gl_FragColor = vec4( c * uFade, uFade );
        }`,
    }));
  moon.renderOrder = -8;
  moon.frustumCulled = false;
  scene.add(moon);
  const moonHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false,
                                  blending: THREE.AdditiveBlending }));
  moonHalo.renderOrder = -9;
  moonHalo.frustumCulled = false;
  scene.add(moonHalo);

  // A FogExp2 that can also be given a height, for Photoreal's aerial
  // perspective (photoreal.js). At height 0 it is exactly the old fog.
  patchFogChunks();
  scene.fog = new HeightFog(0x8fb2cf, BASE_FOG);

  // --- environment map --------------------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  let envRT = null;
  let envKey = null, envAge = 99;
  function rebuildEnv() {
    const keepNear = u.uDeckNear.value;
    u.uDeckNear.value = 0;
    scene.remove(dome); envScene.add(dome);
    const pos = dome.position.clone();
    dome.position.set(0, 0, 0);
    const next = pmrem.fromScene(envScene, 0, 1, 60000);
    envScene.remove(dome); scene.add(dome);
    dome.position.copy(pos);
    u.uDeckNear.value = keepNear;
    if (envRT) envRT.dispose();
    envRT = next;
    scene.environment = envRT.texture;
  }

  // --- state --------------------------------------------------------------------
  let hour = 16.5;
  let flow = 0;                      // hours per second
  let timeAnim = null;               // { from, to, t, dur }
  const wNow = { ...WEATHER.fair };
  let wFrom = { ...WEATHER.fair }, wTo = WEATHER.fair, wT = 1, wDur = 1;
  let weatherName = "fair";
  let changing = false, changeIn = 0;
  let deckOnly = false;              // Low: no volumetric pass
  let flash = 0, nextBolt = 6, boltQueue = [];
  const windDir = new THREE.Vector2(Math.sin(WIND_BEARING), Math.cos(WIND_BEARING));
  const weatherOff = u.uWeatherOff.value;
  const wind3 = new THREE.Vector3();
  let elapsed = 0;
  let cloudPass = null;
  let rain = null;
  let onThunder = null;
  let dayCount = 0, lastHour = 16.5;
  let auroraOverride = null;
  const grade = { white: new THREE.Vector3(1, 1, 1), sat: 1, glare: 0, glareCol: new THREE.Vector3() };
  const _gDay = new THREE.Vector3(0.94, 0.985, 1.07), _gNight = new THREE.Vector3(0.9, 0.97, 1.1);

  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  let state = null;

  function setTime(h, { transition = 0 } = {}) {
    h = ((h % 24) + 24) % 24;
    if (Math.abs(h - hour) < 0.02) { timeAnim = null; return; }
    if (transition > 0) {
      // Always forward, the way a clock goes.
      let to = h;
      if (to < hour) to += 24;
      timeAnim = { from: hour, to, t: 0, dur: transition };
    } else {
      hour = h; timeAnim = null;
    }
  }

  function setWeather(name, { transition = 40 } = {}) {
    const w = WEATHER[name];
    if (!w) return;
    weatherName = name;
    wFrom = { ...wNow };
    wTo = w;
    wT = transition > 0 ? 0 : 1;
    wDur = Math.max(0.01, transition);
    if (transition <= 0) Object.assign(wNow, w);
  }

  function pickNextWeather() {
    // A random walk that prefers its neighbours, so fair weather drifts to
    // overcast and on to rain rather than clear sky snapping into a storm.
    const order = ["clear", "fair", "overcast", "rain", "storm"];
    const i = order.indexOf(weatherName);
    let next;
    const r = Math.random();
    if (weatherName === "fog" || i < 0) next = r < 0.5 ? "fair" : "overcast";
    else if (r < 0.12) next = "fog";
    else {
      const step = r < 0.56 ? -1 : 1;
      next = order[Math.min(order.length - 1, Math.max(0, i + step))];
      if (next === "storm" && Math.random() < 0.5) next = "rain";
    }
    setWeather(next, { transition: 70 });
  }

  // --- per frame ------------------------------------------------------------------
  function update(dt, camera) {
    elapsed += dt;

    // Clock.
    if (timeAnim) {
      timeAnim.t += dt;
      const k = Math.min(1, timeAnim.t / timeAnim.dur);
      const e = k * k * (3 - 2 * k);
      hour = (timeAnim.from + (timeAnim.to - timeAnim.from) * e) % 24;
      if (k >= 1) timeAnim = null;
    } else if (flow) {
      hour = (hour + flow * dt) % 24;
    }
    if (hour < lastHour - 12) dayCount++;
    lastHour = hour;

    // Weather blend.
    if (wT < 1) {
      wT = Math.min(1, wT + dt / wDur);
      const k = wT * wT * (3 - 2 * wT);
      for (const key of Object.keys(wTo)) wNow[key] = wFrom[key] + (wTo[key] - wFrom[key]) * k;
    }
    if (changing) {
      changeIn -= dt;
      if (changeIn <= 0) { pickNextWeather(); changeIn = 180 + Math.random() * 240; }
    }

    // Sun and moon.
    const sp = sunPosition(hour);
    dirFrom(sp.elev, sp.bearing, sunDir);
    const moonElev = Math.max(-40, -sp.elev * 0.8 + 14);
    // A little off opposition, so it is a waxing gibbous with a shadowed limb
    // rather than a flat full disc.
    dirFrom(moonElev, sp.bearing + 152, moonDir);

    const k = lerpKey(sp.elev);
    const over = wNow.over, dim = wNow.dim;
    const night = THREE.MathUtils.smoothstep(-sp.elev, 2, 14);
    const B = k.B;

    // Dome.
    u.uZen.value.copy(k.zen).multiplyScalar(B);
    u.uHor.value.copy(k.hor).multiplyScalar(B);
    u.uGlow.value.copy(k.glow).multiplyScalar(B);
    u.uSunCol.value.copy(k.sun).multiplyScalar(Math.max(0.2, k.sunI) * 0.6);
    u.uSunVis.value = THREE.MathUtils.smoothstep(sp.elev, -3, 1) * (1 - dim);
    // Overcast grey takes its brightness from the day: dark slate at night.
    tmpA.copy(k.hor).lerp(tmpB.setRGB(0.55, 0.6, 0.67), 0.7);
    u.uOverCol.value.copy(tmpA).multiplyScalar(B * (1 - wNow.rain * 0.35) * (1 - (wNow.bolt) * 0.35) * 0.82);
    u.uOver.value = over;
    u.uNight.value = night;

    // Haze: what the horizon is, a little darker, thicker in bad weather.
    const fogCol = scene.fog.color;
    fogCol.copy(k.hor).lerp(u.uOverCol.value.clone().multiplyScalar(1 / Math.max(B, 0.01)), over * 0.8)
      .multiplyScalar(B * 0.62);
    u.uGnd.value.copy(fogCol);
    scene.fog.density = BASE_FOG * wNow.fog * (1 + night * 0.4);

    // Lights. By day the directional light is the sun; once it is down it
    // becomes the moon, cold and dim, and the shadows go with it.
    const sunUp = sp.elev > -2.5;
    const sunI = k.sunI * (1 - dim * 0.82);
    if (sunUp) {
      lightDir.copy(sunDir);
      sun.color.copy(k.sun);
      sun.intensity = sunI * THREE.MathUtils.smoothstep(sp.elev, -2.5, 3);
    } else {
      lightDir.copy(moonDir);
      sun.color.setRGB(0.66, 0.76, 1.0);
      // A strong moon: the key light the whole night scene is read by. With
      // the moon down there is still some, as from a bright sky.
      sun.intensity = (0.5 + 1.3 * THREE.MathUtils.smoothstep(moonElev, 0, 12)) * (1 - dim * 0.7) * night;
    }
    hemi.color.copy(k.amb).lerp(u.uOverCol.value.clone().multiplyScalar(1 / Math.max(B, 0.01)), over * 0.6);
    hemi.groundColor.copy(k.gnd);
    // Overcast moves light from the sun into the sky.
    hemi.intensity = k.ambI * (1 + dim * 1.6) + flash * 3.0;

    renderer.toneMappingExposure = k.exp * (1 + over * 0.12);

    // Stars and moon: only at night and only through gaps in the cloud.
    const clearSky = 1 - over;
    // The sky turns once a day about the pole; seven hours' offset puts
    // Orion in the south-east and the Plough high in the north-east at one
    // in the morning, which is the winter sky over the North Atlantic.
    const lst = (hour + 7) % 24;
    const starFade = night * clearSky * clearSky * (1 - wNow.rain);
    starfield.update(camera, { fade: starFade, lst, time: elapsed, pixel: renderer.getPixelRatio() });
    u.uWorldToEq.value.copy(starfield.uniforms.uEqToWorld.value).transpose();
    u.uStarFade.value = starFade;
    u.uTime.value = elapsed;
    u.uHaze.value = 0.25 + wNow.fog * 0.15 + over * 0.5;
    // Aurora: most clear nights have some, a few have a lot. Which is decided
    // by the night, so it does not flicker on and off with the weather.
    const nightNo = Math.floor((hour + 12) / 24 + dayCount);
    const auroraNight = auroraOverride ?? (0.35 + 0.65 * Math.abs(Math.sin(nightNo * 12.9898 + 3.1)));
    u.uAurora.value = auroraNight * night;
    const moonA = THREE.MathUtils.smoothstep(moonElev, -2, 4) * (0.25 + 0.75 * night) * (1 - over * 0.85);
    moonU.uFade.value = moonA;
    moonU.uSun.value.copy(sunDir);
    moon.visible = moonA > 0.01;
    moonHalo.material.opacity = moonA * 0.7;
    moonHalo.visible = moon.visible;
    if (camera) {
      dome.position.copy(camera.position);
      moon.position.copy(camera.position).addScaledVector(moonDir, 28000);
      moon.scale.setScalar(310);
      moonHalo.position.copy(camera.position).addScaledVector(moonDir, 28500);
      moonHalo.quaternion.copy(camera.quaternion);
      moonHalo.scale.setScalar(4200);
    }

    // The deck colours: lit from above by the sun, shaded underneath by sky.
    u.uDeckLit.value.copy(k.sun).multiplyScalar(Math.max(sunI, 0.04) * 0.55 + 0.06)
      .add(tmpA.copy(k.amb).multiplyScalar(k.ambI * 0.8 * B));
    u.uDeckShade.value.copy(k.amb).multiplyScalar(k.ambI * B * 0.55).lerp(fogCol, 0.3);
    u.uDeckDens.value = 1;
    u.uDeckNear.value = deckOnly ? 0 : VOLUME_FAR * 0.82;
    u.uCoverage.value = wNow.cover;
    u.uCirrus.value = wNow.cirrus * (1 - night * 0.6);

    // Wind: the weather map scrolls, the 3D noise drifts with it and boils up
    // slowly so a cloud changes shape while you watch it.
    const ws = 6 * wNow.wind;
    weatherOff.x -= windDir.x * ws * dt;
    weatherOff.y -= windDir.y * ws * dt;
    wind3.set(-weatherOff.x * 1.4, -elapsed * 1.6, -weatherOff.y * 1.4);

    // Lightning.
    updateLightning(dt, camera);
    u.uFlash.value = flash;

    // Clouds.
    if (cloudPass) {
      const cu = cloudPass.march.uniforms;
      cu.uSunDir.value.copy(sunUp ? sunDir : moonDir);
      cu.uSunCol.value.copy(sunUp ? k.sun : tmpB.setRGB(0.5, 0.6, 0.85))
        .multiplyScalar(sunUp ? Math.max(0.02, k.sunI) * 0.95 * (1 - dim * 0.7) * THREE.MathUtils.smoothstep(sp.elev, -2.5, 4)
                              : 0.09 * THREE.MathUtils.smoothstep(moonElev, 0, 12) * (1 - dim));
      cu.uAmbTop.value.copy(k.amb).multiplyScalar(k.ambI * B * 1.3).lerp(u.uOverCol.value, over * 0.5);
      // Undersides lit by the sky and the sea-haze below them — blue-grey, the
      // colour of the North Atlantic under cloud. Lighting them with the
      // ground colour turned every backlit cloud a muddy brown.
      cu.uAmbBot.value.copy(k.amb).multiplyScalar(k.ambI * B * 0.78).lerp(fogCol, 0.45);
      // Low sun: the whole horizon is lit, and it lights the clouds from the
      // side and underneath — the pink and gold bellies of a sunset deck. Sun
      // light alone cannot do it: a ray toward a sun on the horizon crosses
      // kilometres of cloud and arrives as nothing.
      const glowAmt = THREE.MathUtils.smoothstep(sp.elev, -7, 0) * (1 - THREE.MathUtils.smoothstep(sp.elev, 6, 20)) * (1 - over);
      cu.uAmbBot.value.add(tmpB.copy(k.glow).multiplyScalar(B * 0.55 * glowAmt));
      cu.uAmbTop.value.add(tmpB.copy(k.glow).multiplyScalar(B * 0.25 * glowAmt));
      cu.uFogCol.value.copy(fogCol);
      cu.uFogDen.value = scene.fog.density;
      cu.uCoverage.value = wNow.cover;
      cu.uMist.value = wNow.mist;
      cu.uWindDir.value.copy(windDir);
      cu.uDensity.value = wNow.dens;
      cu.uCumulus.value = wNow.cum;
      cu.uWeatherOff.value.copy(weatherOff);
      cu.uWind3.value.copy(wind3);
      cu.uFlash.value = flash;
    }

    // Sea.
    if (ocean) {
      ocean.setSun(sunUp ? sunDir : moonDir);
      ocean.setSunColor?.(sunUp ? tmpA.copy(k.sun).multiplyScalar(1 - dim * 0.8)
                                : tmpA.setRGB(0.4, 0.48, 0.65).multiplyScalar(0.5 * (1 - over)));
      // Body and foam brightness follow the light, or the sea glows at night.
      const amb = THREE.MathUtils.clamp(sunI / 2.4 * 0.8 + k.ambI * 0.9 * B * 0.45, 0.06, 1.05);
      ocean.setLight?.(amb * (1 - dim * 0.25));
      ocean.setWindScale?.(0.85 + wNow.wind * 0.35);
    }

    rain?.update(dt, camera, wNow.rain, k, B);

    // Environment map: rebuilt when the sky has moved enough to see, at most
    // every couple of seconds — it is six renders and a blur.
    envAge += dt;
    const key = `${Math.round(sp.elev * 0.7)}|${Math.round(over * 10)}|${Math.round(wNow.cover * 10)}`;
    if (key !== envKey && envAge > 2) { envKey = key; envAge = 0; rebuildEnv(); }

    state = { hour, elev: sp.elev, night, over, rain: wNow.rain };

    // The grade (postfx.js reads it through main.js): white balance and
    // saturation by the light. Day is cold and a touch muted; the golden hour
    // is let be warm, since it is the only warm thing; night is blue.
    const golden = THREE.MathUtils.smoothstep(sp.elev, -4, 1) * (1 - THREE.MathUtils.smoothstep(sp.elev, 6, 16));
    const day = THREE.MathUtils.smoothstep(sp.elev, 8, 20);
    grade.white.set(1, 1, 1)
      .lerp(_gDay, day * (1 - over * 0.4))
      .lerp(_gNight, night * 0.85);
    grade.sat = 1 - day * 0.13 - night * 0.22 - over * 0.12 + golden * 0.06;
    grade.glare = THREE.MathUtils.smoothstep(sp.elev, -1.5, 2) * (1 - dim) * (1 - over * 0.9);
    grade.glareCol.set(k.sun.r, k.sun.g, k.sun.b).multiplyScalar(0.9 + golden * 0.6);
  }

  // --- lightning -------------------------------------------------------------------
  function updateLightning(dt, camera) {
    flash = Math.max(0, flash - dt * 9);
    if (boltQueue.length) {
      boltQueue[0].t -= dt;
      if (boltQueue[0].t <= 0) { flash = Math.max(flash, boltQueue.shift().v); }
    }
    if (wNow.bolt < 0.5) return;
    nextBolt -= dt;
    if (nextBolt > 0) return;
    nextBolt = 5 + Math.random() * 14;
    // Two or three pulses: real lightning flickers.
    const n = 2 + (Math.random() * 2 | 0);
    let t = 0;
    for (let i = 0; i < n; i++) {
      boltQueue.push({ t, v: 0.6 + Math.random() * 0.4 });
      t += 0.06 + Math.random() * 0.12;
    }
    const dist = 1500 + Math.random() * 6000;
    onThunder?.(dist);
  }

  // Start where the light is set, and build the environment once up front.
  update(0, null);
  rebuildEnv();

  return {
    dome, stars, moon,
    sunDir, moonDir,
    get hour() { return hour; },
    get weather() { return weatherName; },
    get state() { return state; },
    get grade() { return grade; },
    setTime,
    /** Hours of game time per second of real time; 0 holds the clock. */
    setFlow(hoursPerSecond) { flow = hoursPerSecond; },
    setWeather,
    /** Let the weather wander on its own. */
    setChanging(on) { changing = on; changeIn = 120 + Math.random() * 120; },
    setCloudPass(p) { cloudPass = p; },
    setWeatherTexture(t) { u.tWeather.value = t; },
    // Low quality: the flat deck instead of the volume, and a lighter aurora.
    setDeckOnly(on) { deckOnly = on; u.uAurSteps.value = on ? 6 : 12; },
    setRain(r) { rain = r; },
    onThunder(fn) { onThunder = fn; },
    /** The mirror sees the whole flat deck: the volume is not in it. */
    beforeReflect() {
      this._near = u.uDeckNear.value; u.uDeckNear.value = 0;
      // Half the aurora in the mirror: it is torn up by the waves anyway.
      this._aur = u.uAurSteps.value; u.uAurSteps.value = Math.min(6, this._aur);
    },
    afterReflect() {
      u.uDeckNear.value = this._near ?? u.uDeckNear.value;
      u.uAurSteps.value = this._aur ?? u.uAurSteps.value;
    },
    update,
    /** Debug console: put the sun at an elevation directly. */
    /** Debug: force the aurora, 0..1, or null for the night's own. */
    setAurora(v) { auroraOverride = v; },
    debugSun(elev) {
      // Find the hour on the afternoon side with that elevation.
      for (let h = 12.75; h <= 24; h += 0.02) {
        if (sunPosition(h).elev <= elev) { setTime(h); return h; }
      }
      setTime(0); return 0;
    },
  };
}
