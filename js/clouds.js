import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// ---------------------------------------------------------------------------
// Volumetric clouds.
//
// What the Barbaric Archipelago's sky is: a cold northern sea's. Most days a
// broken deck of cumulus and stratocumulus with towers building out of it and
// the sun breaking through; mist and low stratus lying in banks round the sea
// stacks; fibres of cirrus very high up. So there are two layers here, ray-
// marched together, and a third painted on the dome (sky.js):
//
//   MIST      MIST_BASE .. MIST_TOP. Low banks that wrap the islands — the
//             cliffs come up out of them. Lit mostly by the sky; thin.
//   CUMULUS   CLOUD_BASE .. CLOUD_TOP. The real clouds: flat dark bases at
//             the condensation level, cauliflower tops, towers where the
//             weather map says so. You fly into them, through, and out on top.
//
// Why the first version looked like blobs, and what replaced each cause:
//
//   - Its coverage map was round Worley lumps. Now it is a domain-warped
//     field of clusters with torn edges (cloudnoise.js), read stretched
//     downwind so clouds line up in streets.
//   - Its noise stopped at ~80 m. Now the body is ~35 m and the detail a few
//     metres, and the detail goes through a turbulence offset, so edges fray
//     into wisps instead of being hard noise contours.
//   - It rendered at a third of the resolution and then BLURRED the result to
//     hide the dither. Now each frame's march is jittered differently and the
//     results are accumulated over time, reprojected through last frame's
//     camera with a neighbourhood clamp so nothing smears. The dither averages
//     out instead of being blurred away, and the clouds keep their edges.
//   - Its lighting was one Beer term. Now: a light march toward the sun, a
//     multiple-scattering approximation (three octaves of attenuation and
//     phase), a powder term for the dark rims on the sunlit side, a strong
//     forward lobe for the silver lining when you look toward the sun, and
//     sky light that is itself shadowed by the cloud above.
// ---------------------------------------------------------------------------

export const MIST_BASE = 10;
export const MIST_TOP = 380;
export const CLOUD_BASE = 1200;
export const CLOUD_TOP = 3300;
/** Metres one tile of each texture covers. */
export const WEATHER_TILE = 42000;
const SHAPE_TILE = 2100;
const DETAIL_TILE = 260;
export const VOLUME_FAR = 30000;

/** Quality tiers: resolution scale, primary steps, light steps. */
export const CLOUD_QUALITY = {
  low:    null,                    // the sky dome's painted deck only
  medium: { scale: 0.5,  steps: 64,  light: 4 },
  high:   { scale: 0.62, steps: 80,  light: 5 },
  ultra:  { scale: 0.8,  steps: 112, light: 6 },
};

/**
 * The weather map, shared with the sky dome's GLSL so the far painted deck is
 * the same clouds as the near volume. Read stretched along the wind: real
 * cloud fields line up downwind, and an isotropic map reads as polka dots.
 */
export const WEATHER_GLSL = /* glsl */`
  uniform sampler2D tWeather;
  uniform vec2 uWeatherOff;
  uniform vec2 uWindDir;
  uniform float uCoverage;
  uniform float uMist;
  float remap( float v, float a, float b, float c, float d ) {
    return c + ( v - a ) / ( b - a ) * ( d - c );
  }
  vec2 weatherUV( vec2 xz ) {
    vec2 p = xz + uWeatherOff;
    // Into the wind's frame, squash the along-wind axis, back out.
    vec2 along = uWindDir, across = vec2( -uWindDir.y, uWindDir.x );
    vec2 q = vec2( dot( p, across ), dot( p, along ) * 0.62 );
    return q / ${WEATHER_TILE.toFixed(1)};
  }
  // Inside the ray march neighbouring pixels take wildly different paths
  // through the loop, so the GPU's own mip selection (from screen-space
  // derivatives) is garbage there and picks a random level per 2x2 block —
  // which drew bricks and stripes through every cloud. The march defines
  // WEATHER_LOD and passes the level explicitly; the sky dome has no loop and
  // keeps the automatic one.
  #ifdef WEATHER_LOD
    float gLodW = 0.0;
    vec4 weatherAt( vec2 xz ) { return textureLod( tWeather, weatherUV( xz ), gLodW ); }
  #else
    vec4 weatherAt( vec2 xz ) { return texture2D( tWeather, weatherUV( xz ) ); }
  #endif
  // How much cumulus the map puts here, 0..1, with a soft but narrow edge.
  float coverageOf( vec4 w ) {
    float edge = 1.0 - uCoverage;
    return clamp( remap( w.r, edge - 0.04, edge + 0.16, 0.0, 1.0 ), 0.0, 1.0 );
  }
  float mistOf( vec4 w ) {
    float edge = 1.0 - uMist * 0.85;
    return clamp( remap( w.b, edge, edge + 0.25, 0.0, 1.0 ), 0.0, 1.0 ) * step( 0.01, uMist );
  }
`;

const MARCH_VERT = /* glsl */`
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const MARCH_FRAG = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  in vec2 vUv;
  layout( location = 0 ) out vec4 oColor;
  layout( location = 1 ) out vec4 oDepth;

  #define texture2D texture
  #define WEATHER_LOD

  uniform sampler2D tDepth;
  uniform sampler3D tShape;
  uniform sampler3D tDetail;
  uniform mat4 uProjInv;
  uniform mat4 uViewInv;
  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uAmbTop;
  uniform vec3 uAmbBot;
  uniform vec3 uFogCol;
  uniform float uFogDen;
  uniform float uDensity;
  uniform float uCumulus;
  uniform vec3 uWind3;
  uniform int uSteps;
  uniform int uLight;
  uniform float uFlash;
  uniform float uFrame;
  uniform int uDebug;          // 1: opacity only, no lighting

  ${WEATHER_GLSL}

  const float BASE = ${CLOUD_BASE.toFixed(1)};
  const float TOP = ${CLOUD_TOP.toFixed(1)};
  const float MBASE = ${MIST_BASE.toFixed(1)};
  const float MTOP = ${MIST_TOP.toFixed(1)};
  const float FAR = ${VOLUME_FAR.toFixed(1)};

  // Mip levels for the current step, set by the march. Sampling a 4 m noise
  // every 140 m is pure aliasing — it drew horizontal bricks across every
  // distant cloud — so the noise is read from the mip that matches the step.
  float gLodS = 0.0, gLodD = 0.0;

  float hg( float c, float g ) {
    float g2 = g * g;
    return ( 1.0 - g2 ) / ( 12.566 * pow( max( 1e-4, 1.0 + g2 - 2.0 * g * c ), 1.5 ) );
  }

  // --- the cumulus layer -----------------------------------------------------
  float cumulus( vec3 p, bool cheap ) {
    float hf = ( p.y - BASE ) / ( TOP - BASE );
    if ( hf <= 0.0 || hf >= 1.0 ) return 0.0;
    vec4 w = weatherAt( p.xz );
    float cov = coverageOf( w );
    if ( cov <= 0.001 ) return 0.0;

    // Height profile. The base is a near-flat line, the condensation level;
    // the top depends on the map, so most cells stay as a broken deck and
    // some tower. Stratus (low uCumulus) keeps to a thin sheet.
    float topH = mix( 0.18, mix( 0.3, 1.0, w.g ), uCumulus );
    float grad = smoothstep( 0.0, 0.035, hf ) * ( 1.0 - smoothstep( topH * 0.4, topH, hf ) );
    if ( grad <= 0.0 ) return 0.0;

    vec3 q = p + uWind3;
    // Tops shear downwind, the way towers lean in a breeze.
    q.xz += uWindDir * hf * 260.0;
    vec4 s = textureLod( tShape, q / ${SHAPE_TILE.toFixed(1)}, gLodS );
    float wfbm = s.g * 0.625 + s.b * 0.25 + s.a * 0.125;
    float base = remap( s.r, wfbm - 1.0, 1.0, 0.0, 1.0 );
    base = clamp( remap( base * grad, 1.0 - cov, 1.0, 0.0, 1.0 ), 0.0, 1.0 ) * cov;
    if ( base <= 0.0 ) return 0.0;
    if ( !cheap && gLodD < 6.0 ) {
      // Turbulence first: push the detail lookup around with a low field, so
      // the erosion makes curls and rags rather than a stamped pattern.
      vec3 dq = q / ${DETAIL_TILE.toFixed(1)};
      float turb = textureLod( tDetail, dq * 0.31 + 0.17, max( 0.0, gLodD - 1.7 ) ).a - 0.5;
      vec4 d = textureLod( tDetail, dq + turb * 0.55, gLodD );
      // Detail fades out as it stops being resolvable, rather than popping.
      float dfbm = mix( d.r * 0.625 + d.g * 0.25 + d.b * 0.125, 0.5, smoothstep( 4.0, 6.0, gLodD ) );
      // Wispy, torn bottoms; billowy cauliflower tops.
      float dm = mix( 1.0 - dfbm, dfbm, clamp( hf * 5.0, 0.0, 1.0 ) );
      base = clamp( remap( base, dm * 0.38, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
    }
    // Cumulus have edges. A soft density ramp at the boundary is what made the
    // first ones read as cotton wool; this steepens it without touching the
    // interior.
    base = smoothstep( 0.0, 0.32, base ) * base * 1.6;
    return base * uDensity;
  }

  // --- the mist layer -----------------------------------------------------------
  float mist( vec3 p, bool cheap ) {
    float hf = ( p.y - MBASE ) / ( MTOP - MBASE );
    if ( hf <= 0.0 || hf >= 1.0 || uMist <= 0.0 ) return 0.0;
    vec4 w = weatherAt( p.xz * 0.6 + 7300.0 );
    float m = mistOf( w );
    if ( m <= 0.001 ) return 0.0;
    // Banks are thickest low down and fray out upward.
    float grad = smoothstep( 0.0, 0.12, hf ) * ( 1.0 - smoothstep( 0.25, 1.0, hf ) );
    vec3 q = p + uWind3 * 0.6;
    float s = textureLod( tShape, q / 1600.0, gLodS ).r;
    float d = clamp( remap( s * grad, 1.0 - m * 0.8, 1.0, 0.0, 1.0 ), 0.0, 1.0 ) * m;
    if ( !cheap && d > 0.0 && gLodD < 4.5 ) {
      float det = textureLod( tDetail, q / 140.0, gLodD ).r;
      d = clamp( d - ( 1.0 - det ) * 0.5, 0.0, 1.0 );
    }
    // Thin: mist you see the cliffs through, not a duvet over the sea.
    return d * 0.09;
  }

  float density( vec3 p, bool cheap ) { return cumulus( p, cheap ) + mist( p, cheap ); }

  // Per-pixel, per-frame random jitter of where along each step the sample
  // falls. Interleaved-gradient noise was tried and changes too slowly down
  // the screen: neighbouring rows sampled at nearly the same depths and drew
  // horizontal bands through every cloud. A hash has no structure to show.
  float jitter( vec2 px ) {
    vec3 p3 = fract( vec3( px.xyx ) * 0.1031 + uFrame * 0.1337 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }

  // [t0, t1] of a slab, or an empty interval.
  vec2 slab( float y, float rdy, float lo, float hi ) {
    if ( abs( rdy ) < 1e-5 ) return ( y > lo && y < hi ) ? vec2( 0.0, FAR ) : vec2( 1.0, 0.0 );
    float ta = ( lo - y ) / rdy, tb = ( hi - y ) / rdy;
    return vec2( max( 0.0, min( ta, tb ) ), max( ta, tb ) );
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 vp = uProjInv * vec4( ndc, 1.0, 1.0 );
    vec3 rd = normalize( mat3( uViewInv ) * normalize( vp.xyz / vp.w ) );

    float dz = texture( tDepth, vUv ).x;
    float sceneT = 1e9;
    if ( dz < 0.99999 ) {
      vec4 sp = uProjInv * vec4( ndc, dz * 2.0 - 1.0, 1.0 );
      sceneT = length( sp.xyz / sp.w );
    }
    float tMax = min( sceneT, FAR );

    vec2 seg[2];
    vec2 a = slab( uCam.y, rd.y, MBASE, MTOP );
    vec2 b = slab( uCam.y, rd.y, BASE, TOP );
    a.y = min( a.y, min( tMax, 9000.0 ) );   // mist is a near thing
    b.y = min( b.y, tMax );
    // Nearest first.
    if ( a.x <= b.x ) { seg[0] = a; seg[1] = b; } else { seg[0] = b; seg[1] = a; }

    float cosT = dot( rd, uSunDir );
    float j = jitter( gl_FragCoord.xy );

    vec3 light = vec3( 0.0 );
    float T = 1.0;
    float tw = 0.0, ww = 0.0;
    const float SIGMA = 0.06;

    for ( int sgi = 0; sgi < 2; sgi++ ) {
      float t0 = seg[sgi].x, t1 = seg[sgi].y;
      if ( t1 <= t0 || T < 0.01 ) continue;
      float span = ( t1 - t0 ) / float( uSteps );
      float t = t0;
      for ( int i = 0; i < 160; i++ ) {
        if ( i >= uSteps * 2 || t > t1 || T < 0.01 ) break;
        // Fine where clouds are close enough to show texture, coarse far out.
        float stepLen = clamp( 4.0 + t * 0.014, 4.0, max( span, 20.0 ) );
        gLodS = max( 0.0, log2( stepLen / ${(2100 / 96).toFixed(1)} ) - 1.6 );
        gLodW = max( 0.0, log2( stepLen / ${(WEATHER_TILE / 512).toFixed(1)} ) );
        gLodD = max( 0.0, log2( stepLen / ${(260 / 64).toFixed(2)} ) - 1.2 );
        vec3 p = uCam + rd * ( t + stepLen * j );
        float dc = density( p, true );
        if ( dc <= 0.0 ) { t += stepLen * 1.7; continue; }
        float d = density( p, false );
        // Mist right in front of the eye would blind him; it thins out
        // inside the first few tens of metres.
        d *= smoothstep( 0.0, 45.0, t );
        if ( d > 0.002 ) {
          // Light march: a short line toward the sun, growing steps.
          float od = 0.0, ls = 30.0;
          vec3 lp = p;
          float keepS = gLodS;
          for ( int k = 0; k < 6; k++ ) {
            if ( k >= uLight ) break;
            lp += uSunDir * ls;
            gLodS = max( keepS, log2( ls / 22.0 ) );
            od += density( lp, true ) * ls;
            ls *= 1.85;
          }
          gLodS = keepS;
          float hf = clamp( ( p.y - BASE ) / ( TOP - BASE ), 0.0, 1.0 );
          bool inMist = p.y < MTOP + 1.0;

          // Multiple scattering, three octaves: each one attenuated less and
          // scattered more evenly than the last. This is what makes the inside
          // of a cloud glow instead of going black.
          vec3 S = vec3( 0.0 );
          float aS = 1.0, bS = 1.0, cS = 1.0;
          for ( int o = 0; o < 3; o++ ) {
            float ph = mix( hg( cosT, 0.8 * cS ), hg( cosT, -0.25 * cS ), 0.25 );
            S += uSunCol * aS * ph * exp( -od * SIGMA * bS );
            aS *= 0.5; bS *= 0.4; cS *= 0.5;
          }
          // Powder: the sunlit faces of thin edges are darker than Beer says,
          // which is what draws the rims round every lobe.
          float powder = 1.0 - exp( -d * 6.0 );
          // Plus an isotropic share, so the sunlit side of a cloud is brighter
          // than the sky behind it from any angle, as it is.
          S += uSunCol * exp( -od * SIGMA * 0.5 ) * 0.035;
          S *= mix( 0.4, 1.0, powder ) * 26.0;

          // Sky light, from above, shadowed by whatever is over this point.
          float above = exp( -od * SIGMA * 0.1 );
          vec3 amb = inMist
            ? mix( uAmbBot, uAmbTop, 0.7 ) * 1.05
            : mix( uAmbBot, uAmbTop, hf ) * ( 0.3 + 0.6 * hf ) * mix( 0.3, 1.0, above );
          if ( uDebug == 2 ) S = vec3( exp( -od * SIGMA ) );
          else if ( uDebug == 3 ) S = amb;
          else S += amb + vec3( uFlash * 6.0 ) * ( 0.4 + 0.6 * hf );
          // Mist is lit by the grey sky it sits under, with a little sun on it.
          if ( inMist ) S = amb * 0.85 + uSunCol * 0.9 * exp( -od * SIGMA * 0.3 );

          float ext = d * SIGMA;
          float Ts = exp( -ext * stepLen );
          float wgt = T * ( 1.0 - Ts );
          light += S * wgt;
          tw += t * wgt; ww += wgt;
          T *= Ts;
        }
        t += stepLen;
      }
    }

    float dist = ww > 0.0 ? tw / ww : 0.0;
    // Aerial perspective, and a fade into the painted deck at the edge.
    float fogF = exp( -pow( uFogDen * dist, 2.0 ) );
    float alpha = 1.0 - T;
    light = mix( uFogCol * alpha, light, fogF );
    float far = 1.0 - smoothstep( FAR * 0.75, FAR, dist );
    oColor = vec4( light * far, 1.0 - alpha * far );
    if ( uDebug == 1 || uDebug > 3 ) oColor = vec4( vec3( alpha * 3.0 ), 1.0 - alpha );
    // The representative distance, for reprojection; 0 where there was none.
    oDepth = vec4( ww > 0.0 ? dist : 0.0, min( sceneT, 6e4 ), 0.0, 1.0 );
  }
`;

// --- temporal resolve ----------------------------------------------------------
const RESOLVE_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tCur;
  uniform sampler2D tCurDepth;
  uniform sampler2D tHist;
  uniform mat4 uProjInv;
  uniform mat4 uViewInv;
  uniform mat4 uPrevVP;
  uniform vec3 uCam;
  uniform vec2 uTexel;
  uniform float uBlend;
  void main() {
    vec4 cur = texture2D( tCur, vUv );
    float d = texture2D( tCurDepth, vUv ).r;
    // Where there is no cloud this frame, reproject at sky distance.
    if ( d <= 0.0 ) d = 12000.0;
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 vp = uProjInv * vec4( ndc, 1.0, 1.0 );
    vec3 rd = normalize( mat3( uViewInv ) * normalize( vp.xyz / vp.w ) );
    vec4 prev = uPrevVP * vec4( uCam + rd * d, 1.0 );
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;

    if ( uBlend <= 0.0 || prev.w <= 0.0 || any( lessThan( puv, vec2( 0.0 ) ) ) || any( greaterThan( puv, vec2( 1.0 ) ) ) ) {
      gl_FragColor = cur;
      return;
    }
    // Neighbourhood clamp: history may only be what this frame's samples
    // around here could plausibly be. Kills ghosting on a fast turn.
    vec4 mn = cur, mx = cur;
    for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
      if ( x == 0 && y == 0 ) continue;
      vec4 c = texture2D( tCur, vUv + vec2( x, y ) * uTexel );
      mn = min( mn, c ); mx = max( mx, c );
    }
    vec4 hist = clamp( texture2D( tHist, puv ), mn, mx );
    gl_FragColor = mix( cur, hist, uBlend );
  }
`;

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// Depth-aware upsample. The clouds are marched at a fraction of the screen
// resolution, and plain bilinear upscaling mixes, at every silhouette, the
// mist in front of the far hills with the mist in front of the dragon — so a
// dragon in fog wore a blocky halo of the wrong density. Each of the four low
// resolution samples is weighted by how close the distance it was marched to
// is to this pixel's own scene distance, so the fog on him comes only from
// samples that were also on him.
const COMP_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tClouds;
  uniform sampler2D tDepth;
  uniform sampler2D tLowDepth;
  uniform mat4 uProjInv;
  uniform vec2 uLowSize;
  float sceneDist( vec2 uv ) {
    float dz = texture2D( tDepth, uv ).x;
    if ( dz >= 0.99999 ) return 6e4;
    vec4 sp = uProjInv * vec4( uv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0 );
    return min( length( sp.xyz / sp.w ), 6e4 );
  }
  void main() {
    vec4 s = texture2D( tScene, vUv );
    float d0 = sceneDist( vUv );
    vec2 p = vUv * uLowSize - 0.5;
    vec2 i = floor( p ), f = p - i;
    vec4 acc = vec4( 0.0 ); float wsum = 0.0;
    float bestRel = 1e9; vec2 bestUv = vUv;
    for ( int k = 0; k < 4; k++ ) {
      vec2 o = vec2( float( k & 1 ), float( k >> 1 ) );
      vec2 uv = ( i + o + 0.5 ) / uLowSize;
      float bl = ( o.x > 0.5 ? f.x : 1.0 - f.x ) * ( o.y > 0.5 ? f.y : 1.0 - f.y );
      float dl = texture2D( tLowDepth, uv ).g;
      float rel = abs( log( max( dl, 0.1 ) / max( d0, 0.1 ) ) );
      if ( rel < bestRel ) { bestRel = rel; bestUv = uv; }
      float w = bl * exp( -rel * 12.0 ) + 1e-5 * bl;
      acc += texture2D( tClouds, uv ) * w;
      wsum += w;
    }
    vec4 c = acc / wsum;
    // Nothing nearby was marched at this pixel's distance (a thin wing edge
    // smaller than a low-res texel): take the closest in depth outright.
    if ( wsum < 0.02 ) c = texture2D( tClouds, bestUv );
    gl_FragColor = vec4( s.rgb * c.a + c.rgb, s.a );
  }
`;

export function makeWeatherTexture(data, N = 512) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
function make3D(data, N) {
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** Build the noise on a worker. Calls onWeather early; resolves with all three. */
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
        resolve({ weather, shape: make3D(data.shape, 96), detail: make3D(data.detail, 64) });
        w.terminate();
      }
    };
    w.onerror = (e) => { reject(e); w.terminate(); };
    w.postMessage("go");
  });
}

const rtOpts = {
  type: THREE.HalfFloatType, depthBuffer: false,
  magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
};

export class CloudPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    this.quality = CLOUD_QUALITY.high;
    this.fullW = 1; this.fullH = 1;
    this.ready = false;
    this.frame = 0;
    this.reset = true;
    this.prevVP = new THREE.Matrix4();
    this.prevCam = new THREE.Vector3();

    this.marchRT = new THREE.WebGLMultipleRenderTargets(1, 1, 2, rtOpts);
    this.hist = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
    this.histI = 0;

    this.marchMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MARCH_VERT,
      fragmentShader: MARCH_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tDepth: { value: null }, tShape: { value: null }, tDetail: { value: null },
        tWeather: { value: null }, uWeatherOff: { value: new THREE.Vector2() },
        uWindDir: { value: new THREE.Vector2(0, 1) },
        uCoverage: { value: 0.4 }, uMist: { value: 0.2 },
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
        uSteps: { value: 80 }, uLight: { value: 5 },
        uFlash: { value: 0 }, uFrame: { value: 0 }, uDebug: { value: 0 },
      },
    });
    this.resolveMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RESOLVE_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tCur: { value: null }, tCurDepth: { value: null }, tHist: { value: null },
        uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
        uPrevVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
        uTexel: { value: new THREE.Vector2(1, 1) }, uBlend: { value: 0 },
      },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMP_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tClouds: { value: null }, tDepth: { value: null },
        tLowDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() },
        uLowSize: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.marchQuad = new FullScreenQuad(this.marchMat);
    this.resolveQuad = new FullScreenQuad(this.resolveMat);
    this.compQuad = new FullScreenQuad(this.compMat);
    // sky.js writes the march uniforms through this name.
    this.march = this.marchMat;
  }

  setTextures({ weather, shape, detail }) {
    const u = this.marchMat.uniforms;
    if (weather) u.tWeather.value = weather;
    if (shape) u.tShape.value = shape;
    if (detail) u.tDetail.value = detail;
    this.ready = !!(u.tWeather.value && u.tShape.value && u.tDetail.value);
  }

  setQuality(q) {
    this.quality = q;
    if (q) {
      this.marchMat.uniforms.uSteps.value = q.steps;
      this.marchMat.uniforms.uLight.value = q.light;
      this.setSize(this.fullW, this.fullH);
    }
  }

  setSize(w, h) {
    this.fullW = w; this.fullH = h;
    const s = this.quality?.scale ?? 0.5;
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    this.marchRT.setSize(cw, ch);
    for (const r of this.hist) r.setSize(cw, ch);
    this.resolveMat.uniforms.uTexel.value.set(1 / cw, 1 / ch);
    this.compMat.uniforms.uLowSize.value.set(cw, ch);
    this.reset = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    const mu = this.marchMat.uniforms;
    const cam = this.camera;
    const camPos = mu.uCam.value.setFromMatrixPosition(cam.matrixWorld);
    mu.tDepth.value = readBuffer.depthTexture;
    mu.uProjInv.value.copy(cam.projectionMatrixInverse);
    mu.uViewInv.value.copy(cam.matrixWorld);
    mu.uFrame.value = this.frame++ % 1024;

    renderer.setRenderTarget(this.marchRT);
    this.marchQuad.render(renderer);

    // A cut — teleport, cutscene, a new chapter — throws the history away
    // rather than smearing the old view across the new one.
    if (camPos.distanceTo(this.prevCam) > 400) this.reset = true;

    const ru = this.resolveMat.uniforms;
    const src = this.hist[this.histI], dst = this.hist[1 - this.histI];
    ru.tCur.value = this.marchRT.texture[0];
    ru.tCurDepth.value = this.marchRT.texture[1];
    ru.tHist.value = src.texture;
    ru.uProjInv.value.copy(cam.projectionMatrixInverse);
    ru.uViewInv.value.copy(cam.matrixWorld);
    ru.uPrevVP.value.copy(this.prevVP);
    ru.uCam.value.copy(camPos);
    ru.uBlend.value = this.reset ? 0 : 0.88;
    renderer.setRenderTarget(dst);
    this.resolveQuad.render(renderer);
    this.histI = 1 - this.histI;
    this.reset = false;

    this.prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.prevCam.copy(camPos);

    this.compMat.uniforms.tScene.value = readBuffer.texture;
    this.compMat.uniforms.tClouds.value = dst.texture;
    this.compMat.uniforms.tDepth.value = readBuffer.depthTexture;
    this.compMat.uniforms.tLowDepth.value = this.marchRT.texture[1];
    this.compMat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }

  dispose() {
    this.marchRT.dispose();
    for (const r of this.hist) r.dispose();
    this.marchMat.dispose(); this.resolveMat.dispose(); this.compMat.dispose();
    this.marchQuad.dispose(); this.resolveQuad.dispose(); this.compQuad.dispose();
  }
}
