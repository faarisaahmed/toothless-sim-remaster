import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// ---------------------------------------------------------------------------
// Volumetric clouds.
//
// The old clouds were a hundred sprites: a soft white blob on a camera-facing
// card. From a dragon that meant every cloud was the same disc, flying into one
// was a flat white flash, and above the deck there was nothing to be above.
//
// These are ray-marched. A layer of real volume sits between CLOUD_BASE and
// CLOUD_TOP, its density built from tileable 3D noise (cloudnoise.js) shaped by
// a 2D weather map that says where clouds are and how tall they grow. Each
// pixel walks its view ray through the layer, gathering light: sun light that
// has itself been marched back toward the sun (so the sunward side is bright
// and the belly is dark), plus sky light from above and below. You can fly
// into them, through them, and out on top.
//
// Cost control, in the order it matters:
//   - It runs at a fraction of the screen's resolution (Graphics → Clouds) and
//     is upsampled; clouds are soft, and soft things survive that.
//   - The march stops at the terrain, using the scene's depth buffer, and
//     stops as soon as the ray is effectively opaque.
//   - Empty sky is crossed in double steps: where the weather map says there
//     is no cloud, nothing finer is read.
//   - Past ~24 km the sky dome's flat cloud deck (sky.js) takes over, drawn
//     from the same weather map, so the horizon still has clouds on it.
//
// It is a post pass: after the scene is rendered, before bloom and the grade.
// ---------------------------------------------------------------------------

export const CLOUD_BASE = 1150;
export const CLOUD_TOP = 2700;
/** Metres one tile of each texture covers. */
export const WEATHER_TILE = 34000;
const SHAPE_TILE = 3400;
const DETAIL_TILE = 380;
export const VOLUME_FAR = 26000;

/** Quality tiers: [resolution scale, primary steps, light steps]. */
export const CLOUD_QUALITY = {
  low:    null,                    // the sky dome's flat deck only
  medium: { scale: 0.4, steps: 40, light: 3 },
  high:   { scale: 0.5,  steps: 60, light: 4 },
  ultra:  { scale: 0.62, steps: 96, light: 6 },
};

/**
 * The weather map, shared with the sky dome's GLSL so the far deck is the same
 * clouds as the near volume. `uWeatherOff` scrolls it with the wind.
 */
export const WEATHER_GLSL = /* glsl */`
  uniform sampler2D tWeather;
  uniform vec2 uWeatherOff;
  uniform float uCoverage;
  float remap( float v, float a, float b, float c, float d ) {
    return c + ( v - a ) / ( b - a ) * ( d - c );
  }
  // How much cloud the map puts at this point on the ground, 0..1.
  float coverageAt( vec2 xz, out float tall ) {
    vec4 w = texture2D( tWeather, ( xz + uWeatherOff ) / ${WEATHER_TILE.toFixed(1)} );
    tall = w.g;
    float edge = 1.0 - uCoverage;
    return clamp( remap( w.r, edge, edge + 0.22, 0.0, 1.0 ), 0.0, 1.0 );
  }
`;

const MARCH_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const MARCH_FRAG = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  varying vec2 vUv;

  uniform sampler2D tDepth;
  uniform sampler3D tShape;
  uniform sampler3D tDetail;
  uniform mat4 uProjInv;
  uniform mat4 uViewInv;
  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;     // radiance reaching the top of the layer
  uniform vec3 uAmbTop;
  uniform vec3 uAmbBot;
  uniform vec3 uFogCol;
  uniform float uFogDen;
  uniform float uDensity;
  uniform float uCumulus;   // 0 flat stratus .. 1 tall towers
  uniform vec3 uWind3;      // offset of the 3D noise, metres
  uniform int uSteps;
  uniform int uLight;
  uniform float uFlash;
  uniform vec2 uRes;

  ${WEATHER_GLSL}

  const float BASE = ${CLOUD_BASE.toFixed(1)};
  const float TOP = ${CLOUD_TOP.toFixed(1)};
  const float FAR = ${VOLUME_FAR.toFixed(1)};

  float hg( float c, float g ) {
    float g2 = g * g;
    return ( 1.0 - g2 ) / ( 12.566 * pow( 1.0 + g2 - 2.0 * g * c, 1.5 ) );
  }

  // Density at a point. 'cheap' skips the detail erosion (light march).
  float density( vec3 p, bool cheap ) {
    float hf = ( p.y - BASE ) / ( TOP - BASE );
    if ( hf <= 0.0 || hf >= 1.0 ) return 0.0;
    float tall;
    float cov = coverageAt( p.xz, tall );
    if ( cov <= 0.001 ) return 0.0;

    // Height profile: a flat-ish base, rounded shoulders, and a top that
    // depends on the map — some clouds stay low, some tower. Stratus (low
    // uCumulus) is a thin sheet in the lower third.
    float topH = mix( 0.28, mix( 0.45, 1.0, tall ), uCumulus );
    // Flat base, round shoulders: the bottom of a cumulus is the
    // condensation level and is nearly a line; the top is cauliflower.
    float grad = smoothstep( 0.0, 0.05, hf ) * ( 1.0 - smoothstep( topH * 0.35, topH, hf ) );
    if ( grad <= 0.0 ) return 0.0;

    vec4 s = texture( tShape, ( p + uWind3 ) / ${SHAPE_TILE.toFixed(1)} );
    float wfbm = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
    float base = remap( s.r, wfbm - 1.0, 1.0, 0.0, 1.0 );
    base *= grad;
    base = clamp( remap( base, 1.0 - cov, 1.0, 0.0, 1.0 ), 0.0, 1.0 ) * cov;
    if ( base <= 0.0 ) return 0.0;
    if ( !cheap ) {
      float d = texture( tDetail, ( p + uWind3 * 1.6 ) / ${DETAIL_TILE.toFixed(1)} ).r;
      // Wispy at the bottom, billowy at the top.
      float dm = mix( d, 1.0 - d, clamp( hf * 4.0, 0.0, 1.0 ) );
      base = clamp( remap( base, dm * 0.42, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
    }
    return base * uDensity;
  }

  // White-noise jitter, not interleaved-gradient: IGN's regular pattern read
  // as a woven grid on the near clouds once upsampled.
  float jitter( vec2 px ) { return fract( sin( dot( px, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 vp = uProjInv * vec4( ndc, 1.0, 1.0 );
    vec3 rdView = normalize( vp.xyz / vp.w );
    vec3 rd = normalize( mat3( uViewInv ) * rdView );

    // Where the scene is along this ray. Depth 1 is the cleared sky.
    float dz = texture2D( tDepth, vUv ).x;
    float sceneT = 1e9;
    if ( dz < 0.99999 ) {
      vec4 sp = uProjInv * vec4( ndc, dz * 2.0 - 1.0, 1.0 );
      sceneT = length( sp.xyz / sp.w );
    }

    // The slab.
    float t0, t1;
    float y = uCam.y;
    if ( abs( rd.y ) < 1e-4 ) {
      if ( y < BASE || y > TOP ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 ); return; }
      t0 = 0.0; t1 = FAR;
    } else {
      float ta = ( BASE - y ) / rd.y, tb = ( TOP - y ) / rd.y;
      t0 = max( 0.0, min( ta, tb ) );
      t1 = max( ta, tb );
    }
    t1 = min( min( t1, sceneT ), FAR );
    if ( t1 <= t0 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 ); return; }

    int steps = uSteps;
    // Steps grow with distance: fine where a cloud is close enough to show its
    // texture (and where you are inside one), coarse kilometres out.
    float span = ( t1 - t0 ) / float( steps );
    float t = t0;
    float j = jitter( gl_FragCoord.xy );

    float cosT = dot( rd, uSunDir );
    float phase = mix( hg( cosT, 0.72 ), hg( cosT, -0.22 ), 0.32 );
    vec3 sun = uSunCol;

    vec3 light = vec3( 0.0 );
    float T = 1.0;
    float weightT = 0.0, wsum = 0.0;
    const float SIGMA = 0.055;

    for ( int i = 0; i < 128; i++ ) {
      if ( i >= steps * 2 || t > t1 || T < 0.015 ) break;
      float stepLen = clamp( 6.0 + t * 0.018, 6.0, max( span, 24.0 ) );
      vec3 p = uCam + rd * ( t + stepLen * j );
      float cheapD = density( p, true );
      if ( cheapD <= 0.0 ) { t += stepLen * 1.6; continue; }
      float d = density( p, false );
      if ( d > 0.001 ) {
        // Light march toward the sun, growing steps.
        float od = 0.0, ls = 40.0;
        vec3 lp = p;
        for ( int j = 0; j < 6; j++ ) {
          if ( j >= uLight ) break;
          lp += uSunDir * ls;
          od += density( lp, true ) * ls;
          ls *= 1.9;
        }
        float hf = clamp( ( p.y - BASE ) / ( TOP - BASE ), 0.0, 1.0 );
        // Beer, with a second softer lobe standing in for multiple scattering
        // — without it the shadowed side of a cumulus goes black.
        float beer = exp( -od * SIGMA * 0.9 ) + 0.28 * exp( -od * SIGMA * 0.22 );
        // The powder term: thin edges facing the sun are darker than a plain
        // Beer law would make them, which is what gives a cumulus its rim.
        float powder = 1.0 - exp( -d * 4.0 );
        // Sky light is shadowed too, by however much cloud is above: this is
        // what gives an overcast deck its darker, thicker patches instead of
        // one flat grey.
        float above = exp( -od * SIGMA * 0.12 );
        vec3 amb = mix( uAmbBot, uAmbTop, hf ) * ( 0.4 + 0.6 * hf ) * mix( 0.35, 1.0, above );
        vec3 S = sun * beer * ( 0.45 + phase * 7.0 ) * mix( 0.55, 1.0, powder ) + amb + vec3( uFlash * 6.0 ) * ( 0.4 + 0.6 * hf );
        float ext = d * SIGMA;
        float Ts = exp( -ext * stepLen );
        // Energy-conserving integration of in-scatter over the step.
        light += T * S * ( 1.0 - Ts );
        weightT += t * T * ( 1.0 - Ts );
        wsum += T * ( 1.0 - Ts );
        T *= Ts;
      }
      t += stepLen;
    }

    // Aerial perspective: distant clouds go the colour of the haze, the same
    // fog the terrain fades into, and fade out entirely as the dome takes over.
    float dist = wsum > 0.0 ? weightT / wsum : t1;
    float fogF = exp( -pow( uFogDen * dist, 2.0 ) );
    float alpha = 1.0 - T;
    light = mix( uFogCol * alpha, light, fogF );
    float far = 1.0 - smoothstep( FAR * 0.72, FAR, dist );
    gl_FragColor = vec4( light * far, 1.0 - alpha * far );
  }
`;

// The upsample is a 3x3 tent over the low-resolution clouds rather than one
// bilinear tap. The march dithers its start point per pixel to hide banding,
// and read back at a third of the resolution that dither is a visible grid of
// blocks along every cloud edge; nine taps turn it back into softness.
const COMP_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tClouds;
  uniform vec2 uTexel;
  void main() {
    vec4 s = texture2D( tScene, vUv );
    vec4 c = texture2D( tClouds, vUv ) * 4.0;
    c += texture2D( tClouds, vUv + vec2( uTexel.x, 0.0 ) ) * 2.0;
    c += texture2D( tClouds, vUv - vec2( uTexel.x, 0.0 ) ) * 2.0;
    c += texture2D( tClouds, vUv + vec2( 0.0, uTexel.y ) ) * 2.0;
    c += texture2D( tClouds, vUv - vec2( 0.0, uTexel.y ) ) * 2.0;
    c += texture2D( tClouds, vUv + uTexel );
    c += texture2D( tClouds, vUv - uTexel );
    c += texture2D( tClouds, vUv + vec2( uTexel.x, -uTexel.y ) );
    c += texture2D( tClouds, vUv - vec2( uTexel.x, -uTexel.y ) );
    c /= 16.0;
    gl_FragColor = vec4( s.rgb * c.a + c.rgb, s.a );
  }
`;

/** Build the textures from the worker's buffers. */
export function makeWeatherTexture(data, N = 512) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
function make3D(data, N, format) {
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = format;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** Start building the noise. Resolves { weather, shape, detail } textures in stages. */
export function loadCloudNoise(onWeather) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL("./cloudworker.js", import.meta.url), { type: "module" });
    } catch (e) { reject(e); return; }
    let weather = null;
    w.onmessage = ({ data }) => {
      if (data.kind === "weather") {
        weather = makeWeatherTexture(data.data);
        onWeather?.(weather);
      } else {
        resolve({
          weather,
          shape: make3D(data.shape, 64, THREE.RGBAFormat),
          detail: make3D(data.detail, 32, THREE.RedFormat),
        });
        w.terminate();
      }
    };
    w.onerror = (e) => { reject(e); w.terminate(); };
    w.postMessage("go");
  });
}

export class CloudPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    this.quality = CLOUD_QUALITY.high;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false,
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
    });
    this.fullW = 1; this.fullH = 1;
    this.ready = false;

    this.march = new THREE.ShaderMaterial({
      vertexShader: MARCH_VERT,
      fragmentShader: MARCH_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: null }, tShape: { value: null }, tDetail: { value: null },
        tWeather: { value: null }, uWeatherOff: { value: new THREE.Vector2() },
        uCoverage: { value: 0.4 },
        uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uAmbTop: { value: new THREE.Color(0.5, 0.6, 0.8) },
        uAmbBot: { value: new THREE.Color(0.2, 0.22, 0.25) },
        uFogCol: { value: new THREE.Color(0.6, 0.7, 0.8) },
        uFogDen: { value: 0.00004 },
        uDensity: { value: 1 }, uCumulus: { value: 0.8 },
        uWind3: { value: new THREE.Vector3() },
        uSteps: { value: 60 }, uLight: { value: 4 },
        uFlash: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: MARCH_VERT, fragmentShader: COMP_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tClouds: { value: this.rt.texture },
                  uTexel: { value: new THREE.Vector2(1, 1) } },
    });
    this.marchQuad = new FullScreenQuad(this.march);
    this.compQuad = new FullScreenQuad(this.comp);
  }

  setTextures({ weather, shape, detail }) {
    const u = this.march.uniforms;
    if (weather) u.tWeather.value = weather;
    if (shape) u.tShape.value = shape;
    if (detail) u.tDetail.value = detail;
    this.ready = !!(u.tWeather.value && u.tShape.value && u.tDetail.value);
  }

  setQuality(q) {
    this.quality = q;
    if (q) {
      this.march.uniforms.uSteps.value = q.steps;
      this.march.uniforms.uLight.value = q.light;
      this.setSize(this.fullW, this.fullH);
    }
  }

  setSize(w, h) {
    this.fullW = w; this.fullH = h;
    const s = this.quality?.scale ?? 0.5;
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    this.rt.setSize(cw, ch);
    this.march.uniforms.uRes.value.set(cw, ch);
    this.comp.uniforms.uTexel.value.set(1 / cw, 1 / ch);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.march.uniforms;
    const cam = this.camera;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uViewInv.value.copy(cam.matrixWorld);
    u.uCam.value.setFromMatrixPosition(cam.matrixWorld);

    renderer.setRenderTarget(this.rt);
    this.marchQuad.render(renderer);

    this.comp.uniforms.tScene.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }

  dispose() {
    this.rt.dispose();
    this.march.dispose(); this.comp.dispose();
    this.marchQuad.dispose(); this.compQuad.dispose();
  }
}
