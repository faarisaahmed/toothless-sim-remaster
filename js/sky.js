import * as THREE from "three";
import { WEATHER_GLSL, CLOUD_BASE, CLOUD_TOP, VOLUME_FAR, WEATHER_TILE } from "./clouds.js";
import { WIND_BEARING } from "./terrain.js";

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
// THE DOME is drawn on a sphere that follows the camera. It also carries a flat
// cloud deck read from the same weather map as the volumetric clouds — that is
// what the sea reflects, what the environment map is made of, what Low
// quality shows, and what fills the far horizon past the volume's reach.
// ---------------------------------------------------------------------------

const lin = (hex) => new THREE.Color(hex);  // THREE.Color(hex) converts sRGB → linear

/** Sky keyframes on sun elevation, degrees. */
const KEYS = [
  { e: -24, zen: 0x02040b, hor: 0x08101e, glow: 0x0a1222, sun: 0x000000, sunI: 0.0,
    amb: 0x22345a, ambI: 0.55, gnd: 0x05070b, B: 0.9, exp: 1.55 },
  { e: -9,  zen: 0x07122a, hor: 0x1e2b49, glow: 0x3a3456, sun: 0x000000, sunI: 0.0,
    amb: 0x2c3c66, ambI: 0.55, gnd: 0x080b12, B: 0.9, exp: 1.25 },
  { e: -3,  zen: 0x15284f, hor: 0x6a5a72, glow: 0xb2603c, sun: 0xff5a20, sunI: 0.15,
    amb: 0x46507a, ambI: 0.5, gnd: 0x141218, B: 1.0, exp: 0.98 },
  { e: 2,   zen: 0x2a4a88, hor: 0xd88c62, glow: 0xff8a40, sun: 0xff8a48, sunI: 1.25,
    amb: 0x7a7a98, ambI: 0.42, gnd: 0x2a2420, B: 1.25, exp: 0.78 },
  { e: 9,   zen: 0x3762aa, hor: 0xe6bc98, glow: 0xffb070, sun: 0xffc48a, sunI: 2.0,
    amb: 0x9aaac8, ambI: 0.34, gnd: 0x4a4434, B: 1.6, exp: 0.66 },
  { e: 26,  zen: 0x3a72c4, hor: 0xb8d0e8, glow: 0xfff0d8, sun: 0xfff1d6, sunI: 2.4,
    amb: 0x9ec8f5, ambI: 0.28, gnd: 0x6d7a48, B: 2.0, exp: 0.6 },
  { e: 60,  zen: 0x2c68c0, hor: 0xc4daf0, glow: 0xffffff, sun: 0xfff8ee, sunI: 2.7,
    amb: 0x9ec8f5, ambI: 0.26, gnd: 0x6d7a48, B: 2.1, exp: 0.58 },
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
  uniform float uDeckNear;     // the flat deck only beyond this distance
  uniform vec3 uDeckLit, uDeckShade;
  uniform float uDeckDens;
  uniform float uCirrus;
  ${WEATHER_GLSL}

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

    // Overcast: the gradient flattens to a lit grey.
    col = mix( col, uOverCol * mix( 0.75, 1.1, up ), uOver );

    // Below the horizon is the haze, the same colour the fog goes to, so the
    // sea's far edge and the sky meet without a line.
    col = mix( col, uGnd, smoothstep( 0.02, -0.05, h ) );

    // The sun's disc.
    float disc = smoothstep( 0.99992, 0.99996, cs );
    col += uSunCol * disc * 60.0 * uSunVis * ( 1.0 - uOver );

    // Cirrus: fibres at eight kilometres, read from the map's fourth channel
    // stretched hard along the wind. Thin, bright on the sun's side.
    if ( h > 0.01 && uCirrus > 0.0 ) {
      float tc = ( 8000.0 - cameraPosition.y ) / h;
      vec3 pc = cameraPosition + dir * tc;
      vec2 along = uWindDir, across = vec2( -uWindDir.y, uWindDir.x );
      vec2 cq = vec2( dot( pc.xz + uWeatherOff * 2.0, across ) * 1.0, dot( pc.xz, along ) * 0.18 );
      float ci = texture2D( tWeather, cq / 26000.0 ).a;
      ci = smoothstep( 0.35, 0.95, ci ) * uCirrus * smoothstep( 0.01, 0.12, h );
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
  g.fillStyle = "#eef2ff";
  g.beginPath(); g.arc(128, 128, 30, 0, Math.PI * 2); g.fill();
  // Maria: a few soft grey patches, deterministic.
  const spots = [[118, 120, 9], [136, 132, 7], [126, 141, 6], [140, 116, 5], [112, 136, 4]];
  for (const [x, y, r] of spots) {
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, "rgba(150,160,185,0.55)");
    s.addColorStop(1, "rgba(150,160,185,0)");
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeStars() {
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    // Uniform over the upper hemisphere and a little below.
    const z = rnd() * 1.1 - 0.1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pos[i * 3] = Math.cos(a) * r * 30000;
    pos[i * 3 + 1] = z * 30000;
    pos[i * 3 + 2] = Math.sin(a) * r * 30000;
    const b = Math.pow(rnd(), 6) * 2.4 + 0.25;
    const warm = rnd();
    col[i * 3] = b * (0.85 + warm * 0.2);
    col[i * 3 + 1] = b * 0.9;
    col[i * 3 + 2] = b * (1.05 - warm * 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true,
    depthWrite: false, fog: false, opacity: 0,
  });
  const p = new THREE.Points(g, m);
  p.renderOrder = -9;
  p.frustumCulled = false;
  return p;
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
    elev = 56 * Math.sin(Math.PI * f);
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

  const stars = makeStars();
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false,
                                  blending: THREE.AdditiveBlending }));
  moon.renderOrder = -8;
  moon.frustumCulled = false;
  scene.add(moon);

  scene.fog = new THREE.FogExp2(0x8fb2cf, BASE_FOG);

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
    dirFrom(moonElev, sp.bearing + 180, moonDir);

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
      sun.color.setRGB(0.55, 0.66, 0.9);
      sun.intensity = 0.42 * THREE.MathUtils.smoothstep(moonElev, 0, 12) * (1 - dim * 0.75) * night;
    }
    hemi.color.copy(k.amb).lerp(u.uOverCol.value.clone().multiplyScalar(1 / Math.max(B, 0.01)), over * 0.6);
    hemi.groundColor.copy(k.gnd);
    // Overcast moves light from the sun into the sky.
    hemi.intensity = k.ambI * (1 + dim * 1.6) + flash * 3.0;

    renderer.toneMappingExposure = k.exp * (1 + over * 0.12);

    // Stars and moon: only at night and only through gaps in the cloud.
    const clearSky = 1 - over;
    stars.material.opacity = night * clearSky;
    stars.visible = stars.material.opacity > 0.01;
    moon.material.opacity = THREE.MathUtils.smoothstep(moonElev, -2, 4) * (0.25 + 0.75 * night) * (1 - over * 0.85);
    moon.visible = moon.material.opacity > 0.01;
    if (camera) {
      dome.position.copy(camera.position);
      stars.position.copy(camera.position);
      moon.position.copy(camera.position).addScaledVector(moonDir, 28000);
      moon.quaternion.copy(camera.quaternion);
      moon.scale.setScalar(4200);
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
      cu.uAmbTop.value.copy(k.amb).multiplyScalar(k.ambI * B * 1.1).lerp(u.uOverCol.value, over * 0.5);
      cu.uAmbBot.value.copy(k.gnd).multiplyScalar(B * 0.55).lerp(fogCol, 0.4);
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
    setTime,
    /** Hours of game time per second of real time; 0 holds the clock. */
    setFlow(hoursPerSecond) { flow = hoursPerSecond; },
    setWeather,
    /** Let the weather wander on its own. */
    setChanging(on) { changing = on; changeIn = 120 + Math.random() * 120; },
    setCloudPass(p) { cloudPass = p; },
    setWeatherTexture(t) { u.tWeather.value = t; },
    setDeckOnly(on) { deckOnly = on; },
    setRain(r) { rain = r; },
    onThunder(fn) { onThunder = fn; },
    /** The mirror sees the whole flat deck: the volume is not in it. */
    beforeReflect() { this._near = u.uDeckNear.value; u.uDeckNear.value = 0; },
    afterReflect() { u.uDeckNear.value = this._near ?? u.uDeckNear.value; },
    update,
    /** Debug console: put the sun at an elevation directly. */
    debugSun(elev) {
      // Find the hour on the afternoon side with that elevation.
      for (let h = 12.75; h <= 24; h += 0.02) {
        if (sunPosition(h).elev <= elev) { setTime(h); return h; }
      }
      setTime(0); return 0;
    },
  };
}
