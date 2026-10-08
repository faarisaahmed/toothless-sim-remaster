import * as THREE from "three";
import { patchShader } from "./photoreal.js";
import { BERK_SHAPE } from "./terrain.js";

// ---------------------------------------------------------------------------
// The ground.
//
// UVs are useless on this terrain — they are planar, so anything mapped through
// them smears down every cliff — so the material projects everything in world
// space: the rock from all three axes, blended by how much the surface faces
// each one, and the flat-lying layers (turf, heath, forest floor, sand, snow)
// from straight above, because they only ever lie on ground that is close to
// level and one tap is a third the price of three.
//
// What the second version of this fixes, all of which was visible from the air:
//
//  - THE GRID. One photograph tiled every 9 m is a wallpaper, and from 300 m up
//    a wallpaper is a lattice of identical dots. Every layer is now read at two
//    scales — the near tile, and a rotated copy three and a half times larger —
//    and the mix between them is driven by distance AND by a low-frequency
//    noise, so there is no distance at which a single repeat is all you see.
//
//  - THE BROWN SHEET. The photographs were multiplied straight into the vertex
//    colour, so whatever hue a photo happened to have came through on every
//    island: the cliff photo was warm sandstone, so every cliff in a basalt
//    archipelago was chocolate. Each photo is now divided by its own average
//    colour (measured when it loads) before it is used, which turns it into
//    pure structure — light and dark around 1.0 — and the island design in the
//    vertex colour decides the hue. A fraction of the photo's own colour is
//    mixed back in, per layer, because a little of a real photograph's colour
//    variation is what stops it looking painted.
//
//  - THE DISTANCE. Detail used to stop dead at 2.4 km, which at the heights he
//    flies is most of the screen. The large-scale read carries on to 6 km.
//
// Two things it still has to get right or it is not worth the taps:
//
//  - It must not throw away the vertex colours. They carry the island-scale
//    design and the cheap curvature AO, and no detail texture replaces either.
//  - It must branch. Nearly every pixel is one or two layers. The weights are
//    coherent across a quad, so skipping a zero-weight layer actually skips it.
// ---------------------------------------------------------------------------

const BASE = "./assets/textures/";

/**
 * slug, how many metres one tile covers, how much of its own colour to keep,
 * and whether it has a normal map of its own.
 */
const LAYERS = {
  rock:   { slug: "dark_rock_02",      tile: 13.0, own: 0.45, nrm: true },
  scree:  { slug: "aerial_rocks_04",   tile: 10.0, own: 0.30, nrm: true },
  grass:  { slug: "sparse_grass",      tile: 6.5,  own: 0.40, nrm: true },
  forest: { slug: "forrest_ground_03", tile: 5.5,  own: 0.35, nrm: true },
  sand:   { slug: "coast_sand_01",     tile: 6.0,  own: 0.55, nrm: true },
  snow:   { slug: "snow_field_aerial", tile: 16.0, own: 0.30, nrm: true },
  heath:  { slug: "aerial_grass_rock", tile: 9.0,  own: 0.35, nrm: false },
};

function tune(tex, srgb) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Average colour of an image, in linear light. One 8x8 downsample. */
function meanColour(img) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    const lin = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); gg += lin(d[i + 1]); b += lin(d[i + 2]); }
    const n = d.length / 4;
    return new THREE.Vector3(r / n, gg / n, b / n);
  } catch {
    return new THREE.Vector3(0.2, 0.2, 0.2);
  }
}

/**
 * Load every ground texture. Resolves even if some are missing — a terrain with
 * six of seven layers is a worse terrain, a terrain that never loads is no game.
 */
export async function loadGround(onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const out = {};
  const jobs = [];
  let done = 0;
  const total = Object.values(LAYERS).reduce((n, l) => n + 1 + (l.nrm ? 1 : 0), 0);

  const get = (file, srgb) =>
    loader.loadAsync(BASE + file)
      .then((t) => { done++; onProgress(done / total); return tune(t, srgb); })
      .catch((e) => { done++; console.warn("terrainmat: missing", file, e); return null; });

  for (const [name, l] of Object.entries(LAYERS)) {
    const slot = { tile: l.tile };
    out[name] = slot;
    jobs.push(get(`${l.slug}_diff.jpg`, true).then((t) => {
      slot.map = t;
      if (t) slot.mean = meanColour(t.image);
    }));
    if (l.nrm) jobs.push(get(`${l.slug}_nor_gl.jpg`, false).then((t) => (slot.normal = t)));
  }
  await Promise.all(jobs);
  return out;
}

// A 1x1 stand-in for anything that has not downloaded (or never will), so a
// missing file costs one flat layer rather than a black terrain.
function fallback(rgb) {
  const t = new THREE.DataTexture(new Uint8Array(rgb), 1, 1);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const GREY = fallback([150, 150, 150, 255]);
const FLAT = fallback([128, 128, 255, 255]);
const GREY_MEAN = new THREE.Vector3(0.30, 0.30, 0.30);

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

  uniform sampler2D tRockD, tRockN;
  uniform sampler2D tScreeD, tScreeN;
  uniform sampler2D tGrassD, tGrassN;
  uniform sampler2D tForestD, tForestN;
  uniform sampler2D tSandD, tSandN;
  uniform sampler2D tSnowD, tSnowN;
  uniform sampler2D tHeathD;
  // 1 / tile, per layer: rock scree grass forest | sand snow heath
  uniform vec4 uTileA;
  uniform vec3 uTileB;
  // 1 / average colour of each photograph, and how much of its own colour to keep.
  uniform vec3 uInvMean[7];
  uniform float uOwn[7];
  uniform vec2 uDetailFade;   // near detail ends, far detail ends
  uniform float uSeaLevel;
  uniform float uWet;         // rain: 0 dry .. 1 soaked
  // A hole: where a finer ground of its own lies over the terrain (the
  // hunters' pit, basedetail.js), the terrain is not drawn at all — two
  // surfaces a few centimetres apart fight for every pixel, and the coarse
  // one's long triangles poke up through the fine one in every hollow.
  uniform vec3 uHole;         // x, z, radius (0 = none)
  // ...but only near the camera. Further out, the terrain is drawn after all
  // and the fine ground is not: up close the pit's photographed rock is the
  // detail, from the air the same photograph repeated a hundred times reads
  // as a grid, and this material — built to be seen from a distance — is
  // what the rest of the archipelago looks like. The two hand over through a
  // dither in this distance band, each drawing exactly the pixels the other
  // does not (pitmat.js uses the same pattern, complemented).
  uniform vec2 uHoleFade;     // metres from the camera: start, end
  // Berk (terrain.js BERK_SHAPE): centre and 1 / half-axes of its outline.
  // Its cliffs are layered sandstone, striped per pixel -- a heightfield
  // cliff is one tall triangle and vertex colour cannot stripe it.
  uniform vec4 uBerk;
  float berkK( vec2 p ) {
    vec2 u = ( p - uBerk.xy ) * uBerk.zw;
    u *= u;
    return 1.0 - smoothstep( 1.02, 1.3, sqrt( sqrt( u.x * u.x + u.y * u.y ) ) );
  }
  vec3 sandstone( vec3 p ) {
    float w = sin( p.x * 0.0019 + p.z * 0.0013 ) * 2.0 + sin( p.z * 0.0041 - p.x * 0.0023 ) * 1.2;
    float y = p.y;
    float thin = sin( y * 0.9 + w * 0.5 ) * 0.5 + 0.5;
    float thick = sin( y * 0.155 + w ) * 0.5 + 0.5;
    float fine = sin( y * 2.7 + w * 1.7 ) * 0.5 + 0.5;
    float t = clamp( 0.22 + thick * 0.5 + ( thin - 0.5 ) * 0.32 + ( fine - 0.5 ) * 0.12, 0.0, 1.0 );
    vec3 c = mix( vec3( 0.198, 0.078, 0.027 ), vec3( 0.571, 0.323, 0.127 ), t );
    float rust = smoothstep( 0.72, 0.95, sin( y * 0.061 - w * 0.7 ) ) * 0.6;
    float pale = smoothstep( 0.8, 0.98, sin( y * 0.043 + 1.3 + w * 0.4 ) ) * 0.55;
    c = mix( c, vec3( 0.323, 0.102, 0.034 ), rust );
    c = mix( c, vec3( 0.686, 0.527, 0.323 ), pale );
    // Weathered: some grey in it, more on some beds than others.
    float grey = 0.22 + 0.18 * ( sin( y * 0.031 + w * 1.3 ) * 0.5 + 0.5 );
    return mix( c, vec3( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vec3( 1.05, 1.0, 0.95 ), grey );
  }

  // The second read of every layer is this much larger and turned by this much,
  // so its repeat never lines up with the first one's.
  const float BIG = 0.285;
  const mat2 TURN = mat2( 0.8253, -0.5646, 0.5646, 0.8253 );

  // How much of the large read to use. Distance does most of it; the noise
  // breaks up the line where it happens, and keeps some of the large read even
  // underfoot so the near repeat is never on its own.
  float gBig;

  // Photo, normalised to its own mean: structure around 1.0, then a share of
  // its own colour mixed back in.
  vec3 norm( vec3 c, int i ) {
    // Mostly luminance: the photo's own hue shifts, divided by its mean, can
    // swing a channel well away from 1 and paint purple into the shadows.
    vec3 r = c * uInvMean[ i ];
    float l = dot( r, vec3( 0.2126, 0.7152, 0.0722 ) );
    return clamp( mix( vec3( l ), r, 0.45 ), 0.0, 3.0 );
  }

  vec3 plan( sampler2D t, vec2 uv ) {
    vec3 a = gBig < 0.98 ? texture2D( t, uv ).rgb : vec3( 0.0 );
    vec3 b = gBig > 0.02 ? texture2D( t, TURN * uv * BIG + 0.37 ).rgb : vec3( 0.0 );
    return mix( a, b, gBig );
  }

  vec3 planN( sampler2D t, vec2 uv, vec3 n ) {
    vec3 a = gBig < 0.98 ? texture2D( t, uv ).xyz * 2.0 - 1.0 : vec3( 0.0, 0.0, 1.0 );
    vec3 b = vec3( 0.0, 0.0, 1.0 );
    if ( gBig > 0.02 ) {
      b = texture2D( t, TURN * uv * BIG + 0.37 ).xyz * 2.0 - 1.0;
      // The tangent frame turned with the lookup, so turn the normal back.
      b.xy = b.xy * TURN;
    }
    vec3 m = mix( a, b, gBig );
    return normalize( vec3( m.x + n.x, m.z + n.y, m.y + n.z ) );
  }

  // Photoreal: erosion. Every slope on a real island is scored by the water
  // that runs down it — gullies a few metres to a few tens of metres apart,
  // following the fall line, ridged between. That pattern is most of what
  // makes a hillside read as land rather than as a smooth surface with a
  // photograph on it, and the 13 m mesh cannot carry it.
  //
  // It is a normal perturbation and a cavity term. A noise image is stretched
  // long along a direction and differentiated across it, which gives parallel
  // grooves; three fixed directions sixty degrees apart are blended by how
  // well each lines up with the fall line here. Fixed directions, not one
  // rotated to fit: rotating the lookup per pixel by a direction that wanders
  // swirls the pattern into knots wherever the slope curves.
  float gCavity;
  vec3 erode( vec3 n, vec2 p, float dist ) {
    gCavity = 0.0;
    float steep = 1.0 - n.y;
    // A from-the-air feature. Close in, the photographs carry the ground and
    // a 40 m gully drawn over them reads as paint.
    float far = smoothstep( 40.0, 450.0, dist );
    if ( steep < 0.03 || far < 0.01 ) return n;
    vec2 fall = normalize( n.xz + 1e-5 );
    vec2 grad = vec2( 0.0 );
    float wsum = 0.0, cav = 0.0;
    for ( int k = 0; k < 3; k++ ) {
      float a = float( k ) * 1.0472 + 0.3;
      vec2 dk = vec2( cos( a ), sin( a ) );
      vec2 pk = vec2( -dk.y, dk.x );
      float w = pow( abs( dot( dk, fall ) ), 5.0 );
      if ( w < 0.03 ) continue;
      vec2 q = vec2( dot( p, pk ), dot( p, dk ) * 0.3 );
      // Two octaves: ravines some 60 m apart, runnels inside them. Read
      // through a deep mip bias, because the photographs are full of pebbles
      // and what is wanted from them is only their broad light and dark.
      vec2 qa = q * 0.0021, qb = q * 0.0093 + 0.31;
      float g0 = texture2D( tScreeD, qa, 3.5 ).g;
      float g1 = texture2D( tScreeD, qa + vec2( 5.0 * 0.0021, 0.0 ), 3.5 ).g;
      float f0 = texture2D( tHeathD, qb, 2.5 ).g;
      float f1 = texture2D( tHeathD, qb + vec2( 1.6 * 0.0093, 0.0 ), 2.5 ).g;
      float dg = ( g1 - g0 ) * uInvMean[1].g / 5.0 + ( f1 - f0 ) * uInvMean[6].g * 0.5 / 1.6;
      grad += pk * dg * w;
      cav += ( ( g0 * uInvMean[1].g - 1.0 ) + ( f0 * uInvMean[6].g - 1.0 ) * 0.4 ) * w;
      wsum += w;
    }
    if ( wsum < 1e-3 ) return n;
    grad /= wsum;
    cav /= wsum;
    // Not every slope is cut as deep: softer rock, more water, older ground.
    float vary = texture2D( tRockD, p * 0.00083 + 0.27, 2.0 ).g * uInvMean[0].g;
    float k = smoothstep( 0.03, 0.35, steep ) * far * clamp( vary * vary, 0.15, 1.4 );
    gCavity = clamp( cav, -1.0, 1.0 ) * k;
    return normalize( n - vec3( grad.x, 0.0, grad.y ) * 9.0 * k );
  }

  // Triplanar. Weights are the normal raised to a power and normalised, so a
  // face pointing up is pure top-down and a vertical face is a mix of the two
  // side projections; the power keeps the seam between them narrow.
  vec3 triD( sampler2D t, vec3 p, vec3 bw, float s ) {
    vec3 a = vec3( 0.0 ), b = vec3( 0.0 );
    if ( gBig < 0.98 ) {
      a = texture2D( t, p.zy * s ).rgb * bw.x
        + texture2D( t, p.xz * s ).rgb * bw.y
        + texture2D( t, p.xy * s ).rgb * bw.z;
    }
    if ( gBig > 0.02 ) {
      float S = s * BIG;
      b = texture2D( t, p.zy * S + 0.37 ).rgb * bw.x
        + texture2D( t, TURN * p.xz * S + 0.37 ).rgb * bw.y
        + texture2D( t, p.xy * S + 0.37 ).rgb * bw.z;
    }
    return mix( a, b, gBig );
  }

  // Whiteout blending for triplanar normal maps: take each projection's tangent
  // normal, swing it into world space by swapping the axes it was authored
  // against, and add. Only the near scale carries normals on the rock — the
  // large read is there for colour, and a second set of six taps for relief no
  // one can resolve at that distance is not worth it.
  vec3 triN( sampler2D t, vec3 p, vec3 bw, vec3 n, float s ) {
    float S = gBig > 0.6 ? s * BIG : s;
    vec2 o = gBig > 0.6 ? vec2( 0.37 ) : vec2( 0.0 );
    vec3 nx = texture2D( t, p.zy * S + o ).xyz * 2.0 - 1.0;
    vec3 ny = texture2D( t, p.xz * S + o ).xyz * 2.0 - 1.0;
    vec3 nz = texture2D( t, p.xy * S + o ).xyz * 2.0 - 1.0;
    nx = vec3( nx.z + n.x, nx.y + n.y, nx.x + n.z );
    ny = vec3( ny.x + n.x, ny.z + n.y, ny.y + n.z );
    nz = vec3( nz.x + n.x, nz.y + n.y, nz.z + n.z );
    return normalize( nx * bw.x + ny * bw.y + nz * bw.z );
  }
`;

// Everything below runs in place of <map_fragment>, and writes both the albedo
// and a world-space normal that <normal_fragment_maps> is then replaced to use.
const FRAG_MAIN = /* glsl */`
  if ( uHole.z > 0.0 && distance( vWPos.xz, uHole.xy ) < uHole.z ) {
    float handover = smoothstep( uHoleFade.x, uHoleFade.y, distance( vWPos, cameraPosition ) );
    if ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) >= handover ) discard;
  }
  vec3 gN = normalize( vWNrm );
  gCavity = 0.0;
  #ifndef TERRAIN_LQ
    if ( uPR > 0.5 ) gN = erode( gN, vWPos.xz, length( vWPos - cameraPosition ) );
  #endif
  float slope = clamp( ( 1.0 - gN.y ) * 2.3, 0.0, 1.0 );
  float dist = length( vWPos - cameraPosition );

  // Low-frequency variation, read off the scree photo at a scale where it is
  // nothing but soft blotches. Two reads at unrelated scales so the blotches
  // themselves do not tile.
  float n1 = texture2D( tScreeD, vWPos.xz * 0.00071 ).g;
  float n2 = texture2D( tRockD, TURN * vWPos.xz * 0.00193 + 0.5 ).g;
  float blotch = clamp( ( n1 * uInvMean[1].g ) * 0.55 + ( n2 * uInvMean[0].g ) * 0.45, 0.0, 2.0 );

  // A third, finer field — about 90 m blotches — for the patchwork within a
  // hillside: drier turf, darker hollows, lichen on the rock.
  float patchy = texture2D( tHeathD, TURN * vWPos.xz * 0.0105 ).g * uInvMean[6].g;

  gBig = clamp( smoothstep( 40.0, 420.0, dist ) + ( blotch - 1.0 ) * 0.6 + 0.18, 0.0, 1.0 );
  #ifdef TERRAIN_LQ
    // Low detail: one read per layer, never the blend of two. The switch is
    // pushed out to where the near tile is already sub-pixel, so it cannot be
    // seen happening.
    gBig = step( 0.5, smoothstep( 60.0, 520.0, dist ) );
  #endif

  float detail = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, dist );

  vec3 macro = vColor.rgb;
  vec3 albedo = macro;
  float ledgeMoss = 0.0, ledgeSnow = 0.0;
  vec3 mossCol = vec3( 0.0 );
  vec3 wNormal = gN;
  float rough = 0.94;

  if ( detail > 0.004 ) {
    vec3 bw = pow( abs( gN ), vec3( 5.0 ) );
    bw /= max( bw.x + bw.y + bw.z, 1e-4 );

    // Steep ground is rock whatever the vertex data thinks it is; the line
    // where it starts is broken up by the blotch field so it follows no contour.
    float rockLo = 0.40 + ( blotch - 1.0 ) * 0.12;
    float rockW = 0.34;
    #ifndef TERRAIN_LQ
      // Photoreal: rock does not fade into turf, it breaks through it. The
      // rock photo's own light and dark decide which bits of a slope are
      // outcrop, and the edge is pulled in tight.
      if ( uPR > 0.5 ) {
        float rh = texture2D( tRockD, TURN * vWPos.xz * 0.019 + 0.13 ).g * uInvMean[0].g;
        rockLo += ( 0.9 - rh ) * 0.2;
        rockW = 0.2;
      }
    #endif
    float wRock  = smoothstep( rockLo, rockLo + rockW, slope );
    // Snow holds on steep ground where the paint says it lies thick.
    wRock *= 1.0 - smoothstep( 0.3, 0.9, vSurf.z ) * 0.75;
    float open   = 1.0 - wRock;
    float wSnow  = vSurf.z * open;
    float wSand  = vSurf.y * open * ( 1.0 - vSurf.z );
    float wVeg   = vSurf.x * open * ( 1.0 - vSurf.z );
    float wScree = max( 0.0, open - wSnow - wSand - wVeg );
    float sum = wRock + wSnow + wSand + wVeg + wScree;
    wRock /= sum; wSnow /= sum; wSand /= sum; wVeg /= sum; wScree /= sum;

    vec3 tex = vec3( 0.0 );
    vec3 nrm = vec3( 0.0 );
    vec2 uvTop = vWPos.xz;

    if ( wRock > 0.004 ) {
      vec3 c = norm( triD( tRockD, vWPos, bw, uTileA.x ), 0 );
      // Berk's sandstone: the colour comes per pixel from the strata, carried
      // through the structure term so macro * tex comes out banded.
      float bkR = berkK( vWPos.xz );
      if ( bkR > 0.004 ) {
        vec3 ss = sandstone( vWPos );
        c *= mix( vec3( 1.0 ), ss / max( macro, vec3( 0.015 ) ), bkR * smoothstep( 0.3, 0.7, slope ) );
      }
      vec3 rn = triN( tRockN, vWPos, bw, gN, uTileA.x );
      #ifndef TERRAIN_LQ
        // Photoreal: crags. The same rock relief a hundred metres to the
        // tile, so a cliff has buttresses and ledges at the scale it is seen
        // from the air, not only at the scale you could touch.
        if ( uPR > 0.5 ) {
          float S = uTileA.x * 0.085;
          vec3 mx = texture2D( tRockN, vWPos.zy * S + 0.71 ).xyz * 2.0 - 1.0;
          vec3 mz = texture2D( tRockN, vWPos.xy * S + 0.71 ).xyz * 2.0 - 1.0;
          vec3 my = texture2D( tRockN, TURN * vWPos.xz * S + 0.71 ).xyz * 2.0 - 1.0;
          vec3 crag = normalize( vec3( mx.z, mx.y, mx.x ) * bw.x + vec3( my.x, my.z, my.y ) * bw.y
                               + vec3( mz.x, mz.y, mz.z ) * bw.z + gN * 0.6 );
          rn = normalize( rn + ( crag - gN ) * 1.1 );
        }
      #endif
      // Water staining: dark vertical streaks down a cliff face, where runoff
      // has followed the same line for a thousand years. Read off the scree
      // photo stretched forty-to-one in height, and only on the vertical faces.
      float vert = 1.0 - bw.y;
      #ifdef TERRAIN_LQ
        vert = 0.0;
      #endif
      if ( vert > 0.05 ) {
        float along = dot( vWPos.xz, normalize( vec2( -gN.z, gN.x ) + 1e-4 ) );
        float streak = texture2D( tScreeD, vec2( along * 0.035, vWPos.y * 0.0011 ) ).g * uInvMean[1].g;
        c *= mix( 1.0, 0.62 + 0.38 * smoothstep( 0.55, 1.25, streak ), vert * 0.85 );
      }
      // Lichen and weathering: warm grey-ochre in patches, cooler and darker
      // where it is fresh.
      c *= mix( vec3( 0.86, 0.9, 0.96 ), vec3( 1.14, 1.06, 0.88 ), smoothstep( 0.7, 1.3, patchy ) );
      // Moss and turf on whatever part of a cliff faces the sky: ledges, the
      // tops of the strata, the lip. The test is on the DETAIL normal, so it
      // lands on the photograph's own ledges rather than on a smooth band, and
      // it is held back at altitude where nothing grows.
      float ledge = smoothstep( 0.62, 0.86, rn.y ) * ( 1.0 - smoothstep( 180.0, 320.0, vWPos.y ) )
                  * smoothstep( 4.0, 14.0, vWPos.y ) * clamp( vSurf.x * 2.0 + 0.35, 0.0, 1.0 );
      // Absolute colours, applied after the structure pass below: moss is a
      // colour of its own, not a tint of the rock under it.
      ledgeMoss = ledge * 0.85 * wRock;
      #ifdef TERRAIN_LQ
        ledgeMoss = 0.0;
      #endif
      #ifndef TERRAIN_LQ
      mossCol = plan( tGrassD, uvTop * uTileA.z ) * vec3( 0.62, 0.9, 0.5 );
      #endif
      ledgeSnow = smoothstep( 0.55, 0.8, rn.y ) * vSurf.z * wRock;
      tex += c * wRock;
      nrm += rn * wRock;
      rough = mix( rough, mix( 0.82, 0.96, ledge ), wRock );
    }
    if ( wScree > 0.004 ) {
      // Bare, open ground: scree where it is high and broken, heath — thin turf
      // over rock — everywhere else. Heath is what most of an Atlantic island
      // actually is, and it is green-brown, not the colour of a quarry.
      float heath = ( 1.0 - smoothstep( 200.0, 330.0, vWPos.y ) ) * clamp( 1.3 - slope * 1.6, 0.0, 1.0 );
      heath = clamp( heath + ( blotch - 1.0 ) * 0.5, 0.0, 1.0 );
      vec3 c = norm( plan( tScreeD, uvTop * uTileA.y ), 1 );
      if ( heath > 0.01 ) c = mix( c, norm( plan( tHeathD, uvTop * uTileB.z ), 6 ), heath );
      tex += c * wScree;
      nrm += planN( tScreeN, uvTop * uTileA.y, gN ) * wScree;
    }
    if ( wVeg > 0.004 ) {
      // Turf on the open ground, needle litter where the forest is thick. The
      // split is the same fertility number the trees are scattered from, so
      // the dark ground is under the dark canopy and not next to it.
      float shade = smoothstep( 0.45, 0.9, vSurf.x );
      vec3 c = norm( plan( tGrassD, uvTop * uTileA.z ), 2 );
      vec3 n = planN( tGrassN, uvTop * uTileA.z, gN );
      // Turf is never one green: drier, yellower patches on the rises, deep
      // wet green in the hollows.
      c *= mix( vec3( 0.82, 0.96, 0.9 ), vec3( 1.2, 1.08, 0.72 ), smoothstep( 0.6, 1.4, patchy ) );
      if ( shade > 0.01 ) {
        c = mix( c, norm( plan( tForestD, uvTop * uTileA.w ), 3 ), shade );
        n = normalize( mix( n, planN( tForestN, uvTop * uTileA.w, gN ), shade ) );
      }
      // Turf photographs are low-contrast by nature — a lawn from above — and
      // at the heights he flies the structure needs pushing to read at all.
      c = max( vec3( 0.0 ), 1.0 + ( c - 1.0 ) * 1.6 );
      tex += c * wVeg;
      nrm += n * wVeg;
      rough = mix( rough, 0.98, wVeg );
    }
    if ( wSand > 0.004 ) {
      tex += norm( plan( tSandD, uvTop * uTileB.x ), 4 ) * wSand;
      nrm += planN( tSandN, uvTop * uTileB.x, gN ) * wSand;
    }
    if ( wSnow > 0.004 ) {
      tex += norm( plan( tSnowD, uvTop * uTileB.y ), 5 ) * wSnow;
      nrm += planN( tSnowN, uvTop * uTileB.y, gN ) * wSnow;
      rough = mix( rough, 0.55, wSnow );
    }

    // How much of each photograph's own colour survives. Blended by the same
    // weights as everything else.
    float own = uOwn[0] * wRock + uOwn[1] * wScree + uOwn[2] * wVeg
              + uOwn[4] * wSand + uOwn[5] * wSnow;

    // tex is structure around 1.0. The macro colour supplies the hue, and a
    // share of the photograph's own colour is put back so it is not a
    // monochrome emboss of the vertex colour.
    vec3 structured = macro * tex;
    float lum = dot( macro, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 photo = tex * lum;
    vec3 lit = mix( structured, mix( structured, photo, 0.5 ), own );
    lit = mix( lit, mossCol, ledgeMoss );
    lit = mix( lit, vec3( 0.78, 0.82, 0.86 ), ledgeSnow );
    albedo = mix( macro, lit, detail );
    wNormal = normalize( mix( gN, normalize( nrm ), detail * mix( 0.9, 0.55, gBig ) * ( 1.0 - smoothstep( 300.0, 1400.0, dist ) * 0.6 ) ) );
  }

  // ...and beyond the detail, Berk's cliffs are still striped.
  {
    float bkF = berkK( vWPos.xz ) * smoothstep( 0.35, 0.75, slope ) * ( 1.0 - detail );
    if ( bkF > 0.004 ) albedo = mix( albedo, sandstone( vWPos ), bkF );
  }

  // Far beyond the detail, the blotch field still varies the ground so whole
  // islands are not one flat wash of vertex colour.
  albedo *= mix( 1.0, 0.82 + blotch * 0.2, 1.0 - detail * 0.6 );

  // Photoreal: the gullies are darker — wetter, shadowed, where the soil
  // and the scree collect — and the ribs between them are bleached.
  albedo *= 1.0 + gCavity * 0.14;

  // The wet band. Everything the tide has been over in the last few hours is
  // darker and much smoother than the dry sand a metre above it, and getting
  // that one line right does more for a beach than the sand texture does.
  float wet = 1.0 - smoothstep( uSeaLevel - 1.0, uSeaLevel + 3.4, vWPos.y );
  albedo *= mix( 1.0, 0.52, wet * ( 1.0 - slope * 0.6 ) );
  rough = mix( rough, 0.16, wet * ( 1.0 - slope * 0.6 ) );

  // Rain: everything darkens and goes glossy, rock most of all, because
  // wet stone is the darkest thing on a wet island.
  if ( uWet > 0.001 ) {
    float wetK = uWet * mix( 0.6, 1.0, slope );
    albedo *= 1.0 - 0.32 * wetK;
    rough = mix( rough, 0.38, wetK * 0.8 );
  }

  diffuseColor.rgb = albedo;
`;

/**
 * @param {object} tex        result of loadGround(), or {} to start with stand-ins
 * @param {number} seaLevel
 */
export function makeTerrainMaterial(tex, seaLevel = 0) {
  const uniforms = {
    tRockD:   { value: GREY }, tRockN:   { value: FLAT },
    tScreeD:  { value: GREY }, tScreeN:  { value: FLAT },
    tGrassD:  { value: GREY }, tGrassN:  { value: FLAT },
    tForestD: { value: GREY }, tForestN: { value: FLAT },
    tSandD:   { value: GREY }, tSandN:   { value: FLAT },
    tSnowD:   { value: GREY }, tSnowN:   { value: FLAT },
    tHeathD:  { value: GREY },
    // Uniforms are 1/tile, so the shader multiplies instead of dividing.
    uTileA: { value: new THREE.Vector4(
      1 / LAYERS.rock.tile, 1 / LAYERS.scree.tile,
      1 / LAYERS.grass.tile, 1 / LAYERS.forest.tile) },
    uTileB: { value: new THREE.Vector3(
      1 / LAYERS.sand.tile, 1 / LAYERS.snow.tile, 1 / LAYERS.heath.tile) },
    uInvMean: { value: Array.from({ length: 7 }, () => new THREE.Vector3(1, 1, 1).divide(GREY_MEAN)) },
    uOwn: { value: Object.values(LAYERS).map((l) => l.own) },
    uDetailFade: { value: new THREE.Vector2(2600, 6000) },
    uSeaLevel: { value: seaLevel },
    uWet: { value: 0 },
    uHole: { value: new THREE.Vector3(0, 0, 0) },
    uHoleFade: { value: new THREE.Vector2(70, 150) },
    uBerk: { value: new THREE.Vector4(BERK_SHAPE.cx, BERK_SHAPE.cz, 1 / BERK_SHAPE.ax, 1 / BERK_SHAPE.az) },
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
    // Terrain shadows and sky occlusion, live behind uPR.
    patchShader(shader);
    mat.userData.shader = shader;
  };
  // Any two materials whose onBeforeCompile produce different code need
  // different cache keys or three hands the second one the first one's program.
  mat.customProgramCacheKey = () => `terrain-triplanar-v5pr${mat.defines?.TERRAIN_LQ ? "-lq" : ""}`;
  mat.userData.uniforms = uniforms;
  mat.userData.pr = true;     // patchShader above; the scene sweep leaves it be
  if (tex && Object.keys(tex).length) applyGround(mat, tex);
  return mat;
}

const SLOTS = [
  ["rock", "tRockD", "tRockN"], ["scree", "tScreeD", "tScreeN"],
  ["grass", "tGrassD", "tGrassN"], ["forest", "tForestD", "tForestN"],
  ["sand", "tSandD", "tSandN"], ["snow", "tSnowD", "tSnowN"],
  ["heath", "tHeathD", null],
];

/** The cheap shader path, for the Low terrain setting. Recompiles once. */
export function setGroundLowQuality(mat, on) {
  mat.defines = mat.defines || {};
  if (!!mat.defines.TERRAIN_LQ === !!on) return;
  if (on) mat.defines.TERRAIN_LQ = 1;
  else delete mat.defines.TERRAIN_LQ;
  mat.needsUpdate = true;
}

/**
 * Swap downloaded photographs in for the stand-ins. Uniform values only: the
 * program was compiled against textures of the same type, so nothing relinks.
 * @returns the names of the layers that arrived
 */
export function applyGround(mat, tex) {
  const u = mat.userData.uniforms;
  const have = [];
  SLOTS.forEach(([name, d, n], i) => {
    const slot = tex[name];
    if (!slot) return;
    if (slot.map) {
      u[d].value = slot.map;
      const m = slot.mean || GREY_MEAN;
      // Clamped so a near-black photo cannot blow its layer up to white.
      u.uInvMean.value[i].set(1 / Math.max(m.x, 0.02), 1 / Math.max(m.y, 0.02), 1 / Math.max(m.z, 0.02));
      have.push(name);
    }
    if (n && slot.normal) u[n].value = slot.normal;
  });
  return have;
}
