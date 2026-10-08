import * as THREE from "three";

// ---------------------------------------------------------------------------
// Photoreal.
//
// The one setting that is not about frame rate. Everything else in the
// graphics menu trades sharpness for speed; this one changes how the light
// works, and what it adds is the difference between "a nicely textured game"
// and a photograph of a real coast.
//
// What it does, in order of how much of the picture it changes:
//
//  1. TERRAIN SHADOWS. The shadow map is a 360 m box round the dragon, and the
//     terrain does not cast into it — 1.2M triangles into a shadow pass every
//     frame is not a price anyone can pay. So until now a mountain cast no
//     shadow at all: a valley at four in the afternoon was lit exactly as well
//     as the ridge above it, and that is the single most "CG" thing about the
//     islands. Here the height field the mesh was built from goes up to the
//     GPU as a texture, and a pass marches every texel of it toward the sun
//     and records how high the land's shadow reaches there — so a tree top,
//     a roof or the dragon can be in sun above a valley floor that is not.
//     One tap per pixel to read; rebuilt only when the sun has moved a
//     fraction of a degree.
//
//  2. SKY OCCLUSION. The same march, sixteen ways round, once: how much sky
//     each point of ground can actually see. Ambient light and the reflection
//     of the sky are scaled by it, so the floor of a gully, the foot of a cliff
//     and the inside of a fjord go dim and blue the way they do under a real
//     overcast, instead of being lit by a sky that is behind a mountain.
//
//  3. AERIAL PERSPECTIVE. Real haze is thick at sea level and thin a few
//     hundred metres up, which is why the peaks stand out sharp against a soft
//     coastline. The scene's fog is uniform; under photoreal it is given a
//     height, so the low ground hazes over and the summits come clear.
//
// The terrain shader adds its own share (erosion gullies, height-blended
// layers, a large crag relief) — see terrainmat.js, uniform uPR.
//
// Nothing here recompiles anything when it is switched. The materials that
// take part read the shared uniforms below, and `uPR` decides at run time.
// ---------------------------------------------------------------------------

// Texels across the archipelago. Over the thirty-kilometre world the sun map
// is 20 m a texel (it was 10 over ten), which is what the coarse sheet's own
// 26 m height field can give it anyway; sky occlusion is smooth and baked once,
// and stays at 1024.
const SUN_RES = 1536;
const SKY_RES = 1024;

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// Height lookup shared by both bakes. The height texture is the mesh's own
// vertex grid, one texel per vertex, so a texel CENTRE is a vertex: world
// position has to be squeezed into the inner (n-1)/n of the texture to land on
// them.
const HEIGHT_FN = /* glsl */`
  uniform sampler2D tHeight;
  uniform float uSize, uVerts;
  float H( vec2 w ) {
    vec2 t = ( w / uSize + 0.5 ) * ( ( uVerts - 1.0 ) / uVerts ) + 0.5 / uVerts;
    return texture2D( tHeight, t ).r;
  }
`;

// Where the shadow of the land ends, overhead. Walking out toward the sun
// from each point, every sample of ground says "to see past me you must be at
// least this high here": its height, less how far the sun's ray climbs over the
// distance between. The highest of those is the top of the shadow at this
// point, and anything — ground, a tree, a hut, the dragon — is lit by how far
// above it it is. One map serves all of them.
//
// Geometric steps: fine near the point, where a knoll matters, long far out,
// where only a mountain still reaches above the line. Stored with it is how far
// away that occluder was, because a shadow's edge is soft by about a sun's
// width per unit of distance, and a ridge 3 km off throws a blurred one.
const SUN_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform vec3 uSun;
  // The sky occlusion, baked once, carried through into B and A so a
  // material needs one texture unit for all of it — the terrain shader is at
  // the limit of sixteen already.
  uniform sampler2D tSky;
  ${HEIGHT_FN}
  void main() {
    vec2 p = ( vUv - 0.5 ) * uSize;
    vec2 dir = normalize( uSun.xz + 1e-5 );
    float tanE = uSun.y / max( length( uSun.xz ), 1e-4 );
    float top = -1e4, dOcc = 0.0;
    float d = 7.0;
    for ( int i = 0; i < 64; i++ ) {
      float t = H( p + dir * d ) - d * tanE;
      if ( t > top ) { top = t; dOcc = d; }
      d *= 1.105;
    }
    gl_FragColor = vec4( clamp( top, -600.0, 6000.0 ), dOcc, texture2D( tSky, vUv ).rg );
  }
`;

// Sky visibility: for each of 16 bearings, the highest horizon within ~1.5 km,
// turned into the share of a cosine-weighted sky that is still above it.
// Plus a near term — the hollow a point sits in compared with the ground a few
// tens of metres round it — because the 13 m vertex AO baked into the colours
// stops at exactly the scale where a gully is still visible from the air.
const SKY_FRAG = /* glsl */`
  varying vec2 vUv;
  ${HEIGHT_FN}
  void main() {
    vec2 p = ( vUv - 0.5 ) * uSize;
    float h0 = H( p ) + 1.0;
    float vis = 0.0;
    for ( int k = 0; k < 16; k++ ) {
      float a = float( k ) * 0.392699 + 0.19;
      vec2 dir = vec2( cos( a ), sin( a ) );
      float s = 0.0;
      float d = 9.0;
      for ( int i = 0; i < 24; i++ ) {
        s = max( s, ( H( p + dir * d ) - h0 ) / d );
        d *= 1.21;
      }
      // sin^2 of the horizon angle is the cosine-weighted share it hides.
      float sh = s / sqrt( 1.0 + s * s );
      vis += 1.0 - sh * sh;
    }
    vis /= 16.0;
    float ring = 0.0;
    for ( int k = 0; k < 8; k++ ) {
      float a = float( k ) * 0.785398;
      ring += H( p + vec2( cos( a ), sin( a ) ) * 28.0 );
    }
    float hollow = clamp( ( ring / 8.0 - h0 ) / 14.0, 0.0, 1.0 );
    vis *= 1.0 - hollow * 0.35;
    // The sea sees the whole sky whatever the bed under it does.
    if ( h0 < 0.5 ) vis = mix( vis, 1.0, clamp( -h0 / 4.0, 0.0, 1.0 ) );
    vis = pow( clamp( vis, 0.0, 1.0 ), 1.35 );
    gl_FragColor = vec4( vis, h0 - 1.0, 0.0, 1.0 );
  }
`;

// ---------------------------------------------------------------------------
// What a participating material gets. Shared objects, so one write here is
// seen by every program that took them.
// ---------------------------------------------------------------------------
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

export const PR_UNIFORMS = {
  uPR:       { value: 0 },
  tPrSun:    { value: WHITE },
  // world x, z of the map's corner, and 1 / its size
  uPrMap:    { value: new THREE.Vector3(-5000, -5000, 1 / 10000) },
};

const PR_VERT_PARS = /* glsl */`
  varying vec3 vPrWorld;
`;
// After <project_vertex>, so `transformed` has had the sway and the skinning
// done to it. Instanced meshes go through their instance matrix first, the
// same way project_vertex itself does it.
const PR_VERT_MAIN = /* glsl */`
  {
    vec4 prW = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      prW = instanceMatrix * prW;
    #endif
    vPrWorld = ( modelMatrix * prW ).xyz;
  }
`;

const PR_FRAG_PARS = /* glsl */`
  varying vec3 vPrWorld;
  uniform float uPR;
  uniform sampler2D tPrSun;
  uniform vec3 uPrMap;
`;

// The lights chunk, with the sun's colour scaled by how much of it clears the
// terrain, and the ambient and the sky reflection scaled by how much sky there
// is. Built from three's own chunk text so it tracks whatever three does.
function lightsBegin() {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const hook = "getDirectionalLightInfo( directionalLight, directLight );";
  if (!src.includes(hook)) {
    console.warn("photoreal: lights chunk changed shape; terrain shadows off");
    return src;
  }
  return `
    float prSun = 1.0, prSky = 1.0;
    if ( uPR > 0.5 ) {
      vec2 prUv = ( vPrWorld.xz - uPrMap.xy ) * uPrMap.z;
      vec4 pm = texture2D( tPrSun, prUv );
      vec2 sh = pm.rg;
      // Two metres of bias for the ground meeting its own 13 m height field;
      // the penumbra is a sun's width and a bit, at the occluder's distance.
      float soft = max( 7.0, sh.y * 0.022 );
      prSun = smoothstep( -soft, soft, vPrWorld.y + 4.0 - sh.x );
      vec2 sk = pm.ba;
      // Sky occlusion belongs to the ground; a dragon 80 m up sees the sky.
      prSky = mix( sk.x, 1.0, smoothstep( 4.0, 70.0, vPrWorld.y - sk.y ) );
    }
  ` + src.replace(hook, hook + "\n directLight.color *= prSun;");
}

const PR_BEFORE_END = /* glsl */`
  // A shade under a clear sky is lit by all of it — a blue fill, a quarter to
  // a third of the sun. The game's ambient was set for a world with no
  // shadows of size, so it is let up a little where Photoreal makes them.
  float prFill = uPR > 0.5 ? 1.3 : 1.0;
  irradiance *= prSky * prFill;
  iblIrradiance *= prSky * prFill;
  #if defined( RE_IndirectSpecular )
    radiance *= mix( prSky, 1.0, 0.25 );
  #endif
`;

/**
 * Wire a material's compiled shader into the terrain shadow and sky occlusion.
 * Call from inside onBeforeCompile, after any other edits.
 */
export function patchShader(shader) {
  Object.assign(shader.uniforms, PR_UNIFORMS);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\n" + PR_VERT_PARS)
    .replace("#include <project_vertex>", "#include <project_vertex>\n" + PR_VERT_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + PR_FRAG_PARS)
    .replace("#include <lights_fragment_begin>", lightsBegin())
    .replace("#include <lights_fragment_end>", PR_BEFORE_END + "\n#include <lights_fragment_end>");
}

/**
 * Add photoreal lighting to a material that may already have an
 * onBeforeCompile of its own.
 */
export function addPhotoreal(material) {
  if (material.userData.pr) return material;
  material.userData.pr = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    patchShader(shader);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : "") + "+pr1";
  return material;
}

// ---------------------------------------------------------------------------
// Aerial perspective: height fog, through the scene's own fog uniforms.
//
// three uploads fogNear/fogFar for a THREE.Fog and fogDensity for a FogExp2,
// and every fog-aware material already carries all three. A fog that answers
// to both is refreshed down the Fog path, so its density can ride in fogNear
// and the height scale in fogFar — global, no new uniforms, no recompiles.
// With fogFar at 0 the result is the old exp2 fog to the last bit.
// ---------------------------------------------------------------------------
export class HeightFog extends THREE.FogExp2 {
  constructor(color, density) {
    super(color, density);
    this.isFog = true;
    /** Metres of altitude over which the haze thins by e. 0 = flat fog. */
    this.height = 0;
  }
  get near() { return this.density; }
  set near(v) { /* derived */ }
  get far() { return this.height; }
  set far(v) { /* derived */ }
  clone() { const f = new HeightFog(this.color, this.density); f.height = this.height; return f; }
}

let fogPatched = false;
/** Rewrite three's fog chunks once, before anything compiles. */
export function patchFogChunks() {
  if (fogPatched) return;
  fogPatched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
#endif`;
  C.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World height of this vertex: mvPosition is R*w + t, so w = R^T * mv + eye.
  vFogY = ( transpose( mat3( viewMatrix ) ) * mvPosition.xyz ).y + cameraPosition.y;
#endif`;
  C.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogY;
  uniform float fogNear;
  uniform float fogFar;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #endif
#endif`;
  C.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    // fogNear is the density when the fog is a HeightFog; a plain FogExp2
    // leaves it at three's default of 1, and then fogDensity is the real one.
    float fogD = fogNear < 0.5 ? fogNear : fogDensity;
    float fogK = 1.0;
    if ( fogNear < 0.5 && fogFar > 0.0 ) {
      // Mean of exp(-y/H) along the ray, from the eye to this point. Haze
      // lives low: half as thick again at the waterline, and fading by e every
      // fogFar metres above it.
      float b = 1.0 / fogFar;
      float y0 = max( cameraPosition.y, 0.0 ), y1 = max( vFogY, 0.0 );
      float dy = y1 - y0;
      float e0 = exp( - b * y0 );
      fogK = abs( dy ) > 1.0 ? ( e0 - exp( - b * y1 ) ) / ( b * dy ) : e0;
      fogK = 0.15 + 1.55 * fogK;
    }
    float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth * fogK );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

// ---------------------------------------------------------------------------
const LIT = (m) => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial
  || m.isMeshPhongMaterial || m.isMeshToonMaterial);

/**
 * Everything else in the scene — the dragon, the villages, the ships, the
 * hunters — under the mountains' shadow too. Patching is permanent and costs
 * nothing while Photoreal is off (uPR gates it), so each material is done once,
 * the first time a sweep finds it, and recompiles that one time.
 */
export function sweepPhotoreal(root) {
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      if (!LIT(x) || x.userData.pr) continue;
      addPhotoreal(x);
      x.needsUpdate = true;
    }
  });
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} o
 *   heights   Float32Array, the terrain mesh's vertex heights, row-major from -z
 *   verts     vertices along a side
 *   size      metres along a side
 */
export function createPhotoreal(renderer, { heights, verts, size }) {
  // Half float: 0.5 m of precision at the tallest summit, and linear filtering
  // is guaranteed for it where it is not for full float.
  const half = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const heightTex = new THREE.DataTexture(half, verts, verts, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  // Half float: the shadow top is a height in metres, not a 0..1 value.
  const rtOpts = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  };
  const sunRT = new THREE.WebGLRenderTarget(SUN_RES, SUN_RES, rtOpts);
  const skyRT = new THREE.WebGLRenderTarget(SKY_RES, SKY_RES, rtOpts);

  const common = {
    tHeight: { value: heightTex },
    uSize: { value: size },
    uVerts: { value: verts },
  };
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { ...common, uSun: { value: new THREE.Vector3(0, 1, 0) }, tSky: { value: null } },
    vertexShader: QUAD_VERT, fragmentShader: SUN_FRAG, depthTest: false, depthWrite: false,
  });
  const skyMat = new THREE.ShaderMaterial({
    uniforms: common, vertexShader: QUAD_VERT, fragmentShader: SKY_FRAG,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sunMat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  PR_UNIFORMS.uPrMap.value.set(-size / 2, -size / 2, 1 / size);

  function bake(mat, rt) {
    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevTone = renderer.toneMapping;
    renderer.xr.enabled = false;
    renderer.toneMapping = THREE.NoToneMapping;
    quad.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.toneMapping = prevTone;
    renderer.xr.enabled = prevXr;
  }

  let skyBaked = false;
  let on = false;
  const lastSun = new THREE.Vector3(0, -2, 0);
  // A fifth of a degree: below what anyone can see a shadow creep, and at the
  // default day length about one rebuild a second.
  const MOVE = Math.cos(THREE.MathUtils.degToRad(0.2));

  return {
    get enabled() { return on; },

    setEnabled(v) {
      on = !!v;
      if (on && !skyBaked) {
        bake(skyMat, skyRT);
        skyBaked = true;
      }
      if (on) {
        sunMat.uniforms.tSky.value = skyRT.texture;
        PR_UNIFORMS.tPrSun.value = sunRT.texture;
        lastSun.set(0, -2, 0);       // force a sun bake on the next update
      }
      PR_UNIFORMS.uPR.value = on ? 1 : 0;
    },

    /** @param {THREE.Vector3} sunDir unit vector toward the light */
    update(sunDir) {
      if (!on) return;
      if (lastSun.dot(sunDir) > MOVE) return;
      lastSun.copy(sunDir);
      sunMat.uniforms.uSun.value.copy(sunDir);
      bake(sunMat, sunRT);
    },

    /** For the debug console. */
    textures: { height: heightTex, sun: sunRT.texture, sky: skyRT.texture },
  };
}
