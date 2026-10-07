import * as THREE from "three";
import { addPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// The quarry's own ground.
//
// The archipelago's terrain material is built to read from the air: soft,
// large-scale, a colour design carried in the vertex paint with photographs
// only for structure. Down in the pit, on foot, that reads as a smudge. A
// worked basalt quarry up close is hard, sharp and broken: packed stony ground
// with the stones standing proud of it, banks of angular rubble at the foot of
// every face, and the faces themselves fractured into blocks.
//
// Three photographed surfaces (Poly Haven, CC0, 2K, with normal and
// AO/roughness), chosen for exactly that:
//
//   ground   rocks_ground_02     treads and the floor: stony packed earth
//   scree    gray_rocks          the talus banks: angular rubble
//   rock     dry_riverbed_rock   the cut faces: blocky, fractured stone
//
// The rock is triplanar so a face of any angle takes it without smearing; the
// ground and scree are projected from above. Each is read at two scales with
// the second turned, so there is no grid. Layers meet by HEIGHT — the brighter,
// higher parts of one photograph win over the next — so rubble fills the
// hollows of the ground and the rock breaks through the scree, rather than
// fading into each other like paint.
// ---------------------------------------------------------------------------

const BASE = "./assets/textures/pit/";
const SETS = {
  ground: { slug: "rocks_ground_02", tile: 3.4 },
  scree: { slug: "gray_rocks", tile: 2.4 },
  rock: { slug: "dry_riverbed_rock", tile: 5.5 },
};

function load(loader, file, srgb) {
  const t = loader.load(BASE + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT_PARS = /* glsl */`
  attribute vec3 aMask;
  varying vec3 vPW;
  varying vec3 vPN;
  varying vec3 vMask;
`;
const VERT_MAIN = /* glsl */`
  vPW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vPN = normalize( mat3( modelMatrix ) * objectNormal );
  vMask = aMask;
`;

const FRAG_PARS = /* glsl */`
  varying vec3 vPW;
  varying vec3 vPN;
  varying vec3 vMask;
  uniform sampler2D tGD, tGN, tGA, tSD, tSN, tSA, tRD, tRN, tRA;
  uniform vec3 uTile;            // 1/tile: ground, scree, rock
  uniform vec3 uTint;            // the island's basalt, multiplied in
  uniform vec2 uFade;            // the handover band, same as terrainmat's uHoleFade
  const mat2 TURN = mat2( 0.8253, -0.5646, 0.5646, 0.8253 );

  vec3 pnorm( vec3 t ) { return t * 2.0 - 1.0; }

  // Value noise, for choosing which patch of a photograph to show where.
  float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), f.x ),
                mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), f.x ), f.y );
  }

  // A top-down read with no visible repeat. Inigo Quilez's trick: a slow
  // noise field picks, at every point, two random offsets into the
  // photograph and how far between them to be, and the blend between the two
  // is biased by their own difference so it follows the stones rather than
  // cross-fading through them. Two taps per map, like the two-scale read it
  // replaces, and no tile can be seen however far the floor runs.
  vec4 planar( sampler2D D, sampler2D N, sampler2D A, vec2 p, float s, float far, out vec3 n, out vec3 arm ) {
    vec2 uv = p * s;
    // Patches about two tiles across: the repeat never gets a chance to line up.
    float k = vnoise( uv * 0.45 ) * 8.0;
    float i = floor( k ), f = fract( k );
    vec2 oa = sin( vec2( 3.0, 7.0 ) * ( i + 0.0 ) ) * 37.1;
    vec2 ob = sin( vec2( 3.0, 7.0 ) * ( i + 1.0 ) ) * 37.1;
    vec2 dx = dFdx( uv ), dy = dFdy( uv );
    vec3 ca = textureGrad( D, uv + oa, dx, dy ).rgb, cb = textureGrad( D, uv + ob, dx, dy ).rgb;
    float b = smoothstep( 0.2, 0.8, f - 0.1 * dot( ca - cb, vec3( 1.0 ) ) );
    vec3 c = mix( ca, cb, b );
    n = mix( pnorm( textureGrad( N, uv + oa, dx, dy ).rgb ), pnorm( textureGrad( N, uv + ob, dx, dy ).rgb ), b );
    arm = mix( textureGrad( A, uv + oa, dx, dy ).rgb, textureGrad( A, uv + ob, dx, dy ).rgb, b );
    return vec4( c, dot( c, vec3( 0.33 ) ) );
  }

  // Triplanar for the faces: three projections blended by the normal, each
  // tangent normal swung into world space (whiteout blend).
  vec4 tri( sampler2D D, sampler2D N, sampler2D A, vec3 p, vec3 gn, float s, out vec3 wn, out vec3 arm ) {
    vec3 bw = pow( abs( gn ), vec3( 6.0 ) );
    bw /= bw.x + bw.y + bw.z;
    vec2 ux = p.zy * s, uy = p.xz * s, uz = p.xy * s;
    vec3 c = texture2D( D, ux ).rgb * bw.x + texture2D( D, uy ).rgb * bw.y + texture2D( D, uz ).rgb * bw.z;
    arm = texture2D( A, ux ).rgb * bw.x + texture2D( A, uy ).rgb * bw.y + texture2D( A, uz ).rgb * bw.z;
    vec3 nx = pnorm( texture2D( N, ux ).rgb ), ny = pnorm( texture2D( N, uy ).rgb ), nz = pnorm( texture2D( N, uz ).rgb );
    nx = vec3( nx.z + gn.x, nx.y + gn.y, nx.x + gn.z );
    ny = vec3( ny.x + gn.x, ny.z + gn.y, ny.y + gn.z );
    nz = vec3( nz.x + gn.x, nz.y + gn.y, nz.z + gn.z );
    wn = normalize( nx * bw.x + ny * bw.y + nz * bw.z );
    return vec4( c, dot( c, vec3( 0.33 ) ) );
  }

  // Tangent normal from a top-down read, into world space about gn.
  vec3 topN( vec3 t, vec3 gn ) { return normalize( vec3( t.x + gn.x, t.z + gn.y, t.y + gn.z ) ); }
`;

const FRAG_MAIN = /* glsl */`
  // Near only: past the handover the island terrain draws these pixels.
  if ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < smoothstep( uFade.x, uFade.y, distance( vPW, cameraPosition ) ) ) discard;
  vec3 gn = normalize( vPN );
  float dist = length( vPW - cameraPosition );
  float far = smoothstep( 25.0, 160.0, dist );
  float slope = 1.0 - gn.y;

  vec3 nG, aG, nS, aS, nR, aR;
  vec4 G = planar( tGD, tGN, tGA, vPW.xz, uTile.x, far, nG, aG );
  vec4 S = planar( tSD, tSN, tSA, vPW.xz, uTile.y, far, nS, aS );
  S.rgb *= 0.72;   // the rubble photo is bleached; this stone is basalt
  vec4 R = tri( tRD, tRN, tRA, vPW, gn, uTile.z, nR, aR );

  // Where each wants to be: rock on the faces, scree where the mask says the
  // talus lies, ground everywhere else. Then the height of each photograph
  // decides the boundary pixel by pixel.
  float wR = smoothstep( 0.32, 0.55, slope );
  float wS = clamp( vMask.x, 0.0, 1.0 ) * ( 1.0 - wR );
  float wG = max( 0.0, 1.0 - wR - wS );
  float hG = G.a + wG, hS = S.a * 1.1 + wS, hR = R.a * 1.15 + wR;
  float top = max( hG, max( hS, hR ) ) - 0.18;
  float bG = max( hG - top, 0.0 ), bS = max( hS - top, 0.0 ), bR = max( hR - top, 0.0 );
  float bs = bG + bS + bR + 1e-4;
  bG /= bs; bS /= bs; bR /= bs;

  vec3 albedo = G.rgb * bG + S.rgb * bS + R.rgb * bR;
  // From the rim, individual stones are sub-pixel and their contrast only
  // shimmers; settle toward the surface's average tone.
  albedo = mix( albedo, vec3( dot( albedo, vec3( 0.33 ) ) ) * vec3( 1.02, 1.0, 0.97 ), far * 0.45 );
  vec3 arm = aG * bG + aS * bS + aR * bR;
  vec3 wN = normalize( topN( nG, gn ) * bG + topN( nS, gn ) * bS + nR * bR );
  // Further off, the fine normal is sub-pixel; let the geometry carry it.
  wN = normalize( mix( wN, gn, far * 0.85 ) );

  // The island's own stone, and the vertex shading (cavities, wet).
  albedo *= uTint * vColor.rgb;
  // Slow wander of tone and warmth across the floor, at two scales, so from
  // the rim it is ground and not a carpet.
  float mac = vnoise( vPW.xz * 0.018 ) * 0.6 + vnoise( vPW.xz * 0.061 + 7.0 ) * 0.4;
  albedo *= mix( vec3( 0.8, 0.82, 0.86 ), vec3( 1.12, 1.06, 0.98 ), mac );
  albedo *= mix( 1.0, arm.r, 0.6 );                 // the photos' own AO
  // The old gullies (vMask.z): a century of leaf litter, needles and moss over
  // the stone. The photograph's own light and shade stay — the stones still
  // show through as lumps — but the colour goes to loam and moss, and the cut
  // faces keep their rock.
  float wood = clamp( vMask.z, 0.0, 1.0 ) * ( 1.0 - wR * 0.75 );
  if ( wood > 0.0 ) {
    float lum = dot( G.rgb * bG + S.rgb * bS + R.rgb * bR, vec3( 0.33 ) );
    float mossy = smoothstep( 0.35, 0.75, vnoise( vPW.xz * 0.11 ) * 0.7 + vnoise( vPW.xz * 0.5 + 3.0 ) * 0.3 );
    vec3 litter = mix( vec3( 0.17, 0.11, 0.062 ), vec3( 0.09, 0.13, 0.042 ), mossy );
    albedo = mix( albedo, litter * ( 0.6 + lum * 1.4 ) * vColor.rgb, wood * 0.92 );
  }
  float rough = clamp( arm.g * ( 1.0 - vMask.y * 0.6 ) + wood * 0.15, 0.25, 1.0 );
  diffuseColor.rgb = albedo;
`;

export function makePitMaterial() {
  const loader = new THREE.TextureLoader();
  const u = {
    tGD: { value: load(loader, `${SETS.ground.slug}_diff.jpg`, true) },
    tGN: { value: load(loader, `${SETS.ground.slug}_nor_gl.jpg`, false) },
    tGA: { value: load(loader, `${SETS.ground.slug}_arm.jpg`, false) },
    tSD: { value: load(loader, `${SETS.scree.slug}_diff.jpg`, true) },
    tSN: { value: load(loader, `${SETS.scree.slug}_nor_gl.jpg`, false) },
    tSA: { value: load(loader, `${SETS.scree.slug}_arm.jpg`, false) },
    tRD: { value: load(loader, `${SETS.rock.slug}_diff.jpg`, true) },
    tRN: { value: load(loader, `${SETS.rock.slug}_nor_gl.jpg`, false) },
    tRA: { value: load(loader, `${SETS.rock.slug}_arm.jpg`, false) },
    uTile: { value: new THREE.Vector3(1 / SETS.ground.tile, 1 / SETS.scree.tile, 1 / SETS.rock.tile) },
    // Basalt country: the photographs are warm, the island is dark grey.
    uTint: { value: new THREE.Vector3(0.62, 0.64, 0.68) },
    uFade: { value: new THREE.Vector2(70, 150) },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <project_vertex>", VERT_MAIN + "\n#include <project_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAIN)
      .replace("#include <color_fragment>", "")
      .replace("#include <normal_fragment_maps>", "normal = normalize( ( viewMatrix * vec4( wN, 0.0 ) ).xyz );")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = rough;");
  };
  mat.customProgramCacheKey = () => "pit-ground-v5";
  // Drawn in front of the terrain it lies on.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  return addPhotoreal(mat);
}
