import * as THREE from "three";

// ---------------------------------------------------------------------------
// The ground.
//
// world.js used to say, correctly, that a tiled texture on this terrain is
// worse than none: the UVs are planar, so anything mapped through them stretches
// into vertical smears on exactly the surfaces you most want to look at, which
// is every sea cliff in the archipelago. The relief was carried by geometry
// alone and the cliffs read as smooth grey slopes with a colour ramp on them.
//
// The fix is not to give up on texture, it is to stop using the UVs. This
// material projects the rock from all three axes in world space and blends by
// how much the surface faces each one, so a vertical face is textured by the
// two horizontal projections and never stretches. The flat-lying layers —
// grass, sand, snow, forest floor — keep a single top-down projection, because
// they only ever appear on ground that is nearly horizontal and one tap is
// three times cheaper than three.
//
// Three things this has to get right or it is not worth the taps:
//
//  - It must not throw away the vertex colours. Those carry the island-scale
//    design (which coast is sand, which summit is snow) and the cheap curvature
//    AO, and no amount of detail texture replaces either. The texture supplies
//    structure and a third of its own colour; the vertex colour supplies the
//    rest and all of the large-scale variation.
//  - It must fade out with distance. A 6 m tile at 3 km is far below one pixel
//    and turns into a boiling shimmer under any camera motion. Past ~2 km this
//    falls back to the vertex colours, which is both stabler and free.
//  - It must branch. Nearly every pixel on screen is one or two layers, not
//    six. The weights are coherent across a quad, so skipping the layers at
//    zero weight actually skips them.
// ---------------------------------------------------------------------------

const BASE = "./assets/textures/";

/** slug, and how many metres one tile of it covers. */
const LAYERS = {
  rock:   { slug: "rock_face_03",      tile: 11.0, arm: true },
  scree:  { slug: "aerial_rocks_04",   tile: 9.0 },
  grass:  { slug: "aerial_grass_rock", tile: 7.5 },
  forest: { slug: "forrest_ground_01", tile: 6.0 },
  sand:   { slug: "coast_sand_05",     tile: 5.5 },
  snow:   { slug: "snow_field_aerial", tile: 14.0 },
};

function tune(tex, srgb) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Load every ground texture. Resolves even if some are missing — a terrain with
 * five of six layers is a worse terrain, a terrain that never loads is no game.
 */
export async function loadGround(onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const out = {};
  const jobs = [];
  let done = 0;
  const total = Object.values(LAYERS).reduce((n, l) => n + 2 + (l.arm ? 1 : 0), 0);

  const get = (file, srgb) =>
    loader.loadAsync(BASE + file)
      .then((t) => { done++; onProgress(done / total); return tune(t, srgb); })
      .catch((e) => { done++; console.warn("terrainmat: missing", file, e); return null; });

  for (const [name, l] of Object.entries(LAYERS)) {
    const slot = { tile: l.tile };
    out[name] = slot;
    jobs.push(get(`${l.slug}_diff.jpg`, true).then((t) => (slot.map = t)));
    jobs.push(get(`${l.slug}_nor_gl.jpg`, false).then((t) => (slot.normal = t)));
    if (l.arm) jobs.push(get(`${l.slug}_arm.jpg`, false).then((t) => (slot.arm = t)));
  }
  await Promise.all(jobs);
  return out;
}

// A 1x1 mid-grey stands in for anything that failed to download, so a missing
// file costs one flat layer rather than a black terrain.
function fallback(rgb) {
  const t = new THREE.DataTexture(new Uint8Array(rgb), 1, 1);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const GREY = fallback([150, 150, 150, 255]);
const FLAT = fallback([128, 128, 255, 255]);

const VERT_PARS = /* glsl */`
  attribute vec3 aSurf;
  varying vec3 vWPos;
  varying vec3 vWNrm;
  varying vec3 vSurf;
`;

const VERT_MAIN = /* glsl */`
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vWPos = wp.xyz;
  vWNrm = normalize( mat3( modelMatrix ) * objectNormal );
  vSurf = aSurf;
`;

const FRAG_PARS = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vWNrm;
  varying vec3 vSurf;

  uniform sampler2D tRockD, tRockN, tRockA;
  uniform sampler2D tScreeD, tScreeN;
  uniform sampler2D tGrassD, tGrassN;
  uniform sampler2D tForestD, tForestN;
  uniform sampler2D tSandD, tSandN;
  uniform sampler2D tSnowD, tSnowN;
  uniform vec4 uTileA;   // rock, scree, grass, forest
  uniform vec2 uTileB;   // sand, snow
  uniform vec2 uDetailFade;
  uniform float uSeaLevel;

  // Triplanar. The blend weights are the surface normal raised to a power and
  // normalised, so a face pointing straight up is pure top-down and a vertical
  // face is a mix of the two side projections. The power is what keeps the
  // seam between them narrow enough not to read as a smudge.
  vec3 triD( sampler2D t, vec3 p, vec3 bw, float s ) {
    return texture2D( t, p.zy * s ).rgb * bw.x
         + texture2D( t, p.xz * s ).rgb * bw.y
         + texture2D( t, p.xy * s ).rgb * bw.z;
  }

  // Whiteout blending for triplanar normal maps: take each projection's tangent
  // normal, swing it into world space by swapping the axes it was authored
  // against, and add. Cheaper than building a tangent frame and, on a surface
  // with no meaningful UVs, no less correct.
  vec3 triN( sampler2D t, vec3 p, vec3 bw, vec3 n, float s ) {
    vec3 nx = texture2D( t, p.zy * s ).xyz * 2.0 - 1.0;
    vec3 ny = texture2D( t, p.xz * s ).xyz * 2.0 - 1.0;
    vec3 nz = texture2D( t, p.xy * s ).xyz * 2.0 - 1.0;
    nx = vec3( nx.z + n.x, nx.y + n.y, nx.x + n.z );
    ny = vec3( ny.x + n.x, ny.z + n.y, ny.y + n.z );
    nz = vec3( nz.x + n.x, nz.y + n.y, nz.z + n.z );
    return normalize( nx * bw.x + ny * bw.y + nz * bw.z );
  }

  vec3 planarN( sampler2D t, vec2 uv, vec3 n ) {
    vec3 m = texture2D( t, uv ).xyz * 2.0 - 1.0;
    return normalize( vec3( m.x + n.x, m.z + n.y, m.y + n.z ) );
  }
`;

// Everything below runs in place of <map_fragment>, and writes both the albedo
// and a world-space normal that <normal_fragment_maps> is then replaced to use.
const FRAG_MAIN = /* glsl */`
  vec3 gN = normalize( vWNrm );
  float slope = clamp( ( 1.0 - gN.y ) * 2.3, 0.0, 1.0 );
  float dist = length( vWPos - cameraPosition );

  // Past a couple of kilometres a 7 m tile is well under a pixel and turns into
  // a crawling shimmer, so it fades out and the vertex colours carry it. That
  // this also skips every texture fetch on most of the screen is the reason the
  // draw stays cheap with six layers in it.
  float detail = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, dist );

  vec3 macro = vColor.rgb;
  vec3 albedo = macro;
  vec3 wNormal = gN;
  float rough = 0.94;

  if ( detail > 0.004 ) {
    vec3 bw = pow( abs( gN ), vec3( 5.0 ) );
    bw /= max( bw.x + bw.y + bw.z, 1e-4 );

    // Steep ground is rock whatever the vertex data thinks it is; the rest is
    // whatever grew or washed up on it.
    float wRock  = smoothstep( 0.20, 0.60, slope );
    float open   = 1.0 - wRock;
    float wSnow  = vSurf.z * open;
    float wSand  = vSurf.y * open;
    float wVeg   = vSurf.x * open * ( 1.0 - vSurf.z );
    float wScree = max( 0.0, open - wSnow - wSand - wVeg );
    float sum = wRock + wSnow + wSand + wVeg + wScree;
    wRock /= sum; wSnow /= sum; wSand /= sum; wVeg /= sum; wScree /= sum;

    vec3 tex = vec3( 0.0 );
    vec3 nrm = vec3( 0.0 );

    if ( wRock > 0.004 ) {
      tex += triD( tRockD, vWPos, bw, uTileA.x ) * wRock;
      nrm += triN( tRockN, vWPos, bw, gN, uTileA.x ) * wRock;
      rough = mix( rough, triD( tRockA, vWPos, bw, uTileA.x ).g, wRock );
    }
    vec2 uvTop = vWPos.xz;
    if ( wScree > 0.004 ) {
      tex += texture2D( tScreeD, uvTop * uTileA.y ).rgb * wScree;
      nrm += planarN( tScreeN, uvTop * uTileA.y, gN ) * wScree;
    }
    if ( wVeg > 0.004 ) {
      // Grass on the open ground, leaf litter where the forest is thick. The
      // split is the same fertility number the trees are scattered from, so the
      // dark ground is under the dark canopy and not next to it.
      float shade = smoothstep( 0.45, 0.9, vSurf.x );
      vec3 g = texture2D( tGrassD, uvTop * uTileA.z ).rgb;
      vec3 f = texture2D( tForestD, uvTop * uTileA.w ).rgb;
      tex += mix( g, f, shade ) * wVeg;
      nrm += mix( planarN( tGrassN, uvTop * uTileA.z, gN ),
                  planarN( tForestN, uvTop * uTileA.w, gN ), shade ) * wVeg;
      rough = mix( rough, 0.98, wVeg );
    }
    if ( wSand > 0.004 ) {
      tex += texture2D( tSandD, uvTop * uTileB.x ).rgb * wSand;
      nrm += planarN( tSandN, uvTop * uTileB.x, gN ) * wSand;
    }
    if ( wSnow > 0.004 ) {
      tex += texture2D( tSnowD, uvTop * uTileB.y ).rgb * wSnow;
      nrm += planarN( tSnowN, uvTop * uTileB.y, gN ) * wSnow;
      rough = mix( rough, 0.6, wSnow );
    }

    // Kill the tile repeat with a very low frequency read of the rock map used
    // as nothing but a brightness field. One extra fetch, and it is the
    // difference between a surface and a wallpaper.
    float macroVar = texture2D( tRockD, vWPos.xz * 0.0018 ).g;
    tex *= 0.78 + 0.5 * macroVar;

    // Vertex colour keeps the design and the AO; the texture brings the grain
    // and about a third of its own colour, or every layer comes out the same
    // tinted grey.
    float lum = dot( macro, vec3( 0.299, 0.587, 0.114 ) );
    vec3 lit = mix( macro * tex * 1.9, tex * ( 0.5 + 1.0 * lum ), 0.34 );
    albedo = mix( macro, lit, detail );
    wNormal = normalize( mix( gN, normalize( nrm ), detail * 0.85 ) );
  }

  // The wet band. Everything the tide has been over in the last few hours is
  // darker and much smoother than the dry sand a metre above it, and getting
  // that one line right does more for a beach than the sand texture does.
  float wet = 1.0 - smoothstep( uSeaLevel - 1.0, uSeaLevel + 3.4, vWPos.y );
  albedo *= mix( 1.0, 0.52, wet * ( 1.0 - slope * 0.6 ) );
  rough = mix( rough, 0.16, wet * ( 1.0 - slope * 0.6 ) );

  diffuseColor.rgb = albedo;
`;

/**
 * @param {object} tex        result of loadGround()
 * @param {number} seaLevel
 */
export function makeTerrainMaterial(tex, seaLevel = 0) {
  const pick = (slot, key, dflt) => (slot && slot[key]) || dflt;
  const uniforms = {
    tRockD:   { value: pick(tex.rock, "map", GREY) },
    tRockN:   { value: pick(tex.rock, "normal", FLAT) },
    tRockA:   { value: pick(tex.rock, "arm", GREY) },
    tScreeD:  { value: pick(tex.scree, "map", GREY) },
    tScreeN:  { value: pick(tex.scree, "normal", FLAT) },
    tGrassD:  { value: pick(tex.grass, "map", GREY) },
    tGrassN:  { value: pick(tex.grass, "normal", FLAT) },
    tForestD: { value: pick(tex.forest, "map", GREY) },
    tForestN: { value: pick(tex.forest, "normal", FLAT) },
    tSandD:   { value: pick(tex.sand, "map", GREY) },
    tSandN:   { value: pick(tex.sand, "normal", FLAT) },
    tSnowD:   { value: pick(tex.snow, "map", GREY) },
    tSnowN:   { value: pick(tex.snow, "normal", FLAT) },
    // Uniforms are 1/tile, so the shader multiplies instead of dividing.
    uTileA: { value: new THREE.Vector4(
      1 / LAYERS.rock.tile, 1 / LAYERS.scree.tile,
      1 / LAYERS.grass.tile, 1 / LAYERS.forest.tile) },
    uTileB: { value: new THREE.Vector2(1 / LAYERS.sand.tile, 1 / LAYERS.snow.tile) },
    uDetailFade: { value: new THREE.Vector2(700, 2400) },
    uSeaLevel: { value: seaLevel },
  };

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.35,   // rock should not mirror the sky back at you
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <project_vertex>", VERT_MAIN + "\n#include <project_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAIN)
      // <color_fragment> is `diffuseColor *= vColor`, and the block above has
      // already used vColor deliberately. Leaving it in multiplies the macro
      // colour into the result twice and the whole terrain goes to mud.
      .replace("#include <color_fragment>", "")
      // The perturbed normal arrives already in world space, so this replaces
      // three's tangent-space path outright rather than feeding into it.
      .replace("#include <normal_fragment_maps>",
        "normal = normalize( ( viewMatrix * vec4( wNormal, 0.0 ) ).xyz );")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = rough;");
    mat.userData.shader = shader;
  };
  // Any two materials whose onBeforeCompile produce different code need
  // different cache keys or three hands the second one the first one's program.
  mat.customProgramCacheKey = () => "terrain-triplanar-v1";
  mat.userData.uniforms = uniforms;
  return mat;
}
