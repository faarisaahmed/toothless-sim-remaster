import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { SEA_LEVEL, WIND_BEARING } from "./terrain.js";

// ---------------------------------------------------------------------------
// The sea.
//
// three's Water is kept underneath all of this and it earns its place: it does
// a real planar reflection pass, which is the single biggest thing separating
// water from a blue plane, plus sun glitter and a four-layer scrolling normal.
// What it does not do is have a surface. It is a flat quad; the waves are a
// normal map, so the horizon is a razor line, nothing shoals, nothing breaks,
// and an island meets the sea along a hard edge with no surf on it.
//
// So this keeps Water's reflection machinery and replaces the geometry and both
// shaders around it:
//
//   * A radial grid centred on the player instead of one quad, so there are
//     vertices to move — dense underneath him and hundreds of metres apart at
//     the horizon, because that is where the pixels are.
//   * Six Gerstner waves driven by one wind vector. Gerstner rather than sine
//     because the horizontal part is the whole point: crests get sharp and
//     troughs get broad, which is what a real wave looks like from a metre off
//     the water.
//   * Everything below the surface, read from the baked sea field. Waves grow
//     and shorten as the bottom comes up, refract until they run parallel to
//     the shore, break when they can no longer stand up, and lie down in the
//     lee of an island. That last one is a texture lookup and it is the reason
//     a sheltered bay is glassy while the headland outside it is white.
//
// Performance note for whoever comes next: the expensive thing here is the
// reflection pass, not the waves — it renders the scene a second time. It was
// already being paid for before any of this. The wave sum is 6 iterations in a
// vertex shader over ~30k vertices, which is nothing.
// ---------------------------------------------------------------------------

// The wave train. Wavelength in metres, amplitude in metres, steepness 0..1,
// and how far off the wind this component runs, in radians.
//
// It is a spectrum, not a stack of identical waves: one long swell that sets
// the rhythm, then progressively shorter and steeper components fanned either
// side of it. Fanning matters more than it sounds — six waves all running the
// same way is a corrugated roof, and the eye picks it out instantly.
const WAVES = [
  { len: 168, amp: 2.10, fan:  0.00 },
  { len:  97, amp: 1.35, fan:  0.44 },
  { len:  59, amp: 0.80, fan: -0.58 },
  { len:  34, amp: 0.44, fan:  0.95 },
  { len:  19, amp: 0.23, fan: -1.15 },
  { len:  10, amp: 0.11, fan:  1.70 },
];

/**
 * A disc of triangles centred on the camera.
 *
 * The vertex budget has to go where the pixels are, and on an ocean seen from
 * a dragon that is the first few hundred metres. Ring radius grows as a power
 * of the index, so quads are about a metre across underfoot and a couple of
 * hundred at the horizon — 30k quads covering 16 km, where a uniform grid fine
 * enough to be useful at 20 m would need a quarter of a billion.
 *
 * Built in the local XY plane, because Water takes the mesh's local +Z as the
 * mirror normal and therefore insists on being rotated onto the XZ plane rather
 * than authored there.
 */
function discGeometry(rings, sectors, radius, power) {
  const verts = 1 + rings * sectors;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  for (let i = 0; i < verts; i++) nrm[i * 3 + 2] = 1;

  let p = 3;   // vertex 0 is the centre, already (0,0,0)
  for (let r = 1; r <= rings; r++) {
    const rad = radius * Math.pow(r / rings, power);
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      pos[p] = Math.cos(a) * rad;
      pos[p + 1] = Math.sin(a) * rad;
      p += 3;
    }
  }

  const idx = [];
  for (let s = 0; s < sectors; s++) {
    idx.push(0, 1 + s, 1 + ((s + 1) % sectors));
  }
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * sectors, b0 = 1 + r * sectors;
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      idx.push(a0 + s, b0 + s, b0 + s1);
      idx.push(a0 + s, b0 + s1, a0 + s1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // It moves with the camera and covers the horizon, so it is never off screen
  // and a bounding sphere the size of the world only costs us a culling test
  // that always says yes.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.2);
  return geo;
}

/** Turbulent foam, tiling. Sharp-edged, because real foam has a torn edge. */
function makeFoamTexture(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);

  // Tiling value noise: sample a lattice with wraparound at each octave.
  const layers = [];
  for (let o = 0; o < 6; o++) {
    const n = 4 << o;
    const v = new Float32Array(n * n);
    for (let i = 0; i < v.length; i++) v[i] = Math.random();
    layers.push({ n, v });
  }
  const at = (L, x, y) => {
    const fx = x * L.n, fy = y * L.n;
    const x0 = Math.floor(fx) % L.n, y0 = Math.floor(fy) % L.n;
    const x1 = (x0 + 1) % L.n, y1 = (y0 + 1) % L.n;
    let tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    return (L.v[y0 * L.n + x0] * (1 - tx) + L.v[y0 * L.n + x1] * tx) * (1 - ty)
         + (L.v[y1 * L.n + x0] * (1 - tx) + L.v[y1 * L.n + x1] * tx) * ty;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, norm = 0;
      for (const L of layers) {
        // Absolute value per octave — turbulence rather than fBm, which gives
        // the stringy filaments foam actually has instead of soft blobs.
        v += Math.abs(at(L, x / size, y / size) - 0.5) * 2 * amp;
        norm += amp;
        amp *= 0.55;
      }
      v = Math.pow(1 - v / norm, 1.7);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.floor(v * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The close-range chop, as a tiling normal map.
 *
 * The first version of this was a sum of integer-frequency sines, which tiles
 * perfectly and looks it: from forty metres up the whole sea was covered in a
 * regular diamond lattice, because that is what a handful of crossed sines is.
 * Tiling value noise gives the same seamless wrap with none of the pattern —
 * the wrap comes from sampling each octave's lattice modulo its own size, so
 * every octave meets itself at the edge.
 *
 * This is only the ripple. Everything with a wavelength worth naming is real
 * geometry in the vertex shader.
 */
function makeWaterNormals(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);

  const layers = [];
  for (let o = 0; o < 6; o++) {
    const n = 4 << o;
    const v = new Float32Array(n * n);
    for (let i = 0; i < v.length; i++) v[i] = Math.random();
    layers.push({ n, v });
  }
  const at = (L, x, y) => {
    const fx = x * L.n, fy = y * L.n;
    const x0 = ((Math.floor(fx) % L.n) + L.n) % L.n;
    const y0 = ((Math.floor(fy) % L.n) + L.n) % L.n;
    const x1 = (x0 + 1) % L.n, y1 = (y0 + 1) % L.n;
    let tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    return (L.v[y0 * L.n + x0] * (1 - tx) + L.v[y0 * L.n + x1] * tx) * (1 - ty)
         + (L.v[y1 * L.n + x0] * (1 - tx) + L.v[y1 * L.n + x1] * tx) * ty;
  };

  // Anisotropic on purpose: wind chop is stretched across the wind, so the
  // field is sampled squashed along one axis. Without it the surface reads as
  // rain on a puddle rather than as a sea with a direction.
  const field = (u, v) => {
    let sum = 0, amp = 1, norm = 0;
    for (const L of layers) {
      sum += (at(L, u, v * 0.7) - 0.5) * amp;
      norm += amp;
      amp *= 0.62;
    }
    return sum / norm;
  };

  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = field(u + e, v) - field(u - e, v);
      const dy = field(u, v + e) - field(u, v - e);
      // 26 here made every ripple a mirror facet and the whole sea flashed white.
      let nx = -dx * 13, ny = -dy * 13, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i]     = (nx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// --- Shared GLSL ----------------------------------------------------------
// The wave sum lives in the vertex shader and the surf lives in the fragment
// shader, but both need to decode the sea field the same way, so it is written
// once here.
const SEA_SAMPLER = /* glsl */`
  uniform sampler2D uSea;
  uniform vec3 uSeaDecode;    // extent, 1/(2*extent), hSpan
  uniform float uSeaHMin;
  uniform float uSeaDMax;

  vec4 seaAt( vec2 world ) {
    vec2 uv = world * uSeaDecode.y + 0.5;
    // Off the edge of the baked field is open ocean: deep, far from any shore,
    // fully exposed. Clamping instead would smear the outermost coast to the
    // horizon.
    if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return vec4( 0.0, 1.0, 1.0, 0.0 );
    vec4 s = texture2D( uSea, uv );
    return vec4( s.r * uSeaDecode.z + uSeaHMin,   // bed height, metres
                 s.g,                             // shore distance, 0..1 of uSeaDMax
                 s.b,                             // exposure, 0 sheltered .. 1 open
                 1.0 );
  }
`;

const WAVE_GLSL = /* glsl */`
  uniform vec2 uWind;          // unit vector the wind blows towards
  uniform float uWindScale;    // overall sea state, 0 calm .. ~1.4 gale
  uniform float uShoalBias;    // metres of depth to pretend away — see below
  // ( wavelength m, amplitude m, bearing off the wind rad ) per component.
  // One array indexed by the loop counter, because GLSL ES 1.0 only lets you
  // index a uniform array with a constant expression and a loop index is the
  // only one of those available in here.
  uniform vec3 uWave[6];

  #define WAVE_COUNT 6

  // GLSL ES 1.0 has no tanh. This is the shallow-water correction to the
  // dispersion relation and it only has to be right in shape: 1 in deep water,
  // falling to kd as the bottom comes up.
  float tanh1( float x ) {
    float e = exp( -2.0 * min( x, 9.0 ) );
    return ( 1.0 - e ) / ( 1.0 + e );
  }

  // Gerstner. Each component moves the surface along its own direction as well
  // as up, which is what sharpens the crests and flattens the troughs; the sum
  // of the horizontal parts is also what the foam term below reads to find out
  // where the surface is being pinched, which is where a wave breaks.
  void oceanSurface( vec2 world, float t, out vec3 offset, out float fold, out float phase0 ) {
    vec4 sea = seaAt( world );
    // THE BIAS. The bed comes from a baked field at about twenty metres per
    // texel, and the terrain mesh it is describing is thirteen. On a shoaling
    // coast that disagreement is worth a couple of metres of depth, and the
    // shader always loses the argument in the same direction: it thinks there
    // is water where the mesh has already come up, builds a wave in it, and the
    // trough cuts through the rock. That is the stippled mess along every
    // shoreline — it is not z-fighting, it is the sea and the land being drawn
    // from two different heightfields.
    //
    // So the waves are told the water is shallower than the field says. Being
    // wrong this way costs nothing: the amplitude limit below already flattens
    // the surface as depth goes to zero, so all this does is bring that
    // flattening forward far enough to cover the disagreement. The colour and
    // the foam still read the field honestly — only the geometry is biased.
    float depth = max( 0.35, -sea.x - uShoalBias );
    float shelter = mix( 0.25, 1.0, sea.z );

    // Shore normal, from the gradient of the bed. Waves refract until they run
    // parallel to the beach, which is why surf always arrives square on however
    // the wind is blowing — without this the swell drives diagonally into a
    // beach and the whole coast looks wrong.
    float e = 30.0;
    vec2 grad = vec2( seaAt( world + vec2( e, 0.0 ) ).x - seaAt( world - vec2( e, 0.0 ) ).x,
                      seaAt( world + vec2( 0.0, e ) ).x - seaAt( world - vec2( 0.0, e ) ).x );
    vec2 shoreDir = length( grad ) > 1e-4 ? -normalize( grad ) : uWind;
    float refract = 1.0 - smoothstep( 6.0, 90.0, depth );

    offset = vec3( 0.0 );
    fold = 0.0;

    for ( int i = 0; i < WAVE_COUNT; i++ ) {
      vec3 W = uWave[ i ];
      float len = W.x;
      float amp = W.y * uWindScale * shelter;
      float fan = W.z;

      float cs = cos( fan ), sn = sin( fan );
      vec2 dir = vec2( uWind.x * cs - uWind.y * sn, uWind.x * sn + uWind.y * cs );
      dir = normalize( mix( dir, shoreDir, refract * 0.85 ) );

      // Shallow water slows a wave and shortens it. Long swell feels the bottom
      // first, which is why the big components pile up outside a bay while the
      // chop rides straight in.
      float shallow = clamp( depth / ( 0.16 * len ), 0.06, 1.0 );
      float lenS = len * sqrt( shallow );
      float k = 6.28318 / max( lenS, 0.8 );
      float w = sqrt( 9.81 * k * tanh1( k * depth ) );

      // Green's law on the way in, then a breaking limit: a wave cannot be
      // taller than about four fifths of the water it is standing in, and the
      // moment it tries it is not a wave any more, it is surf.
      amp *= clamp( pow( shallow, -0.25 ), 1.0, 2.1 );
      amp = min( amp, 0.42 * depth );

      float ph = k * dot( dir, world ) - w * t;
      float steep = min( 1.0, amp * k );
      offset.xz += dir * ( steep / max( k, 1e-3 ) ) * sin( ph );
      offset.y += amp * cos( ph );
      // Sum of Q*cos(phase): the horizontal Jacobian is 1 - this, so it peaks
      // exactly where several crests coincide and the surface is being pinched
      // vertical. That is where the water goes white and nowhere else.
      fold += steep * cos( ph );
      if ( i == 0 ) phase0 = ph;
    }
  }
`;

/**
 * @param {object} o
 *   scene, renderer
 *   seaField    result of bakeSeaField()
 *   sunDirection, sunColor
 */
export function createOcean({ scene, renderer, seaField, sunDirection, sunColor = 0xfff1d6 }) {
  const foam = makeFoamTexture();
  const waterNormals = makeWaterNormals();

  // Thirty kilometres of sea. The power is the whole trick: at 2.6 the quads are
  // about four metres across under him and sixty at three kilometres, so the
  // swell is resolved where he can see it and costs nothing where he cannot.
  //
  // It was 16 km, which was ample for a ten-kilometre archipelago and stopped
  // being so the moment there was land past the edge of it (horizon.js). Those
  // islands stand out to eighteen kilometres from the middle of the world, and
  // from the far corner of the boundary the ones on the opposite side are
  // twenty-seven away — past the rim of a 16 km disc, where they would have
  // hung in the sky over the end of the water.
  //
  // It is close to free: the ring count, the sector count and therefore the
  // vertex count are all unchanged, so this only makes the outermost quads
  // larger, in the part of the frame that is two-thirds fog. Nothing else reads
  // the radius, and the sea field already returns open-ocean defaults for
  // anything sampled outside its extent (see seaAt() above), which is exactly
  // what all of the new area is.
  const geo = discGeometry(200, 220, 30000, 2.6);

  const water = new Water(geo, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: sunDirection.clone(),
    sunColor,
    waterColor: 0x0a2c3d,
    distortionScale: 7.5,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  water.renderOrder = 1;
  water.material.transparent = true;
  // Water's `size` scales the world position going into the normal map, so a
  // smaller number is a BIGGER tile. 3.2 puts the repeat at about thirty metres,
  // far enough out that the eye stops finding it.
  water.material.uniforms.size.value = 3.2;

  // --- Uniforms ----------------------------------------------------------
  const u = water.material.uniforms;
  const wind = new THREE.Vector2(Math.sin(WIND_BEARING), Math.cos(WIND_BEARING));
  const waveTable = WAVES.map((w) => new THREE.Vector3(w.len, w.amp, w.fan));

  Object.assign(u, {
    uSea:       { value: seaField.texture },
    uSeaDecode: { value: new THREE.Vector3(seaField.extent, 1 / (seaField.extent * 2), seaField.hSpan) },
    uSeaHMin:   { value: seaField.hMin },
    uSeaDMax:   { value: seaField.dMax },
    uWind:      { value: wind },
    uWindScale: { value: 1.0 },
    uShoalBias: { value: 1.8 },
    uWave:      { value: waveTable },
    uFoam:      { value: foam },
    uShallow:   { value: new THREE.Color(0x357a6c) },
    uDeep:      { value: new THREE.Color(0x0a3350) },
    uSurf:      { value: 1.0 },
  });

  // --- Vertex: give the plane a surface ----------------------------------
  //
  // Patching three's shader source by string match is fragile by nature: a
  // whitespace change upstream turns every one of these into a no-op and the
  // sea silently goes back to being a flat quad, with no error anywhere. So
  // every splice is checked, and a miss is loud.
  const splice = (src, find, rep, label) => {
    const out = src.replace(find, rep);
    if (out === src) console.error(`ocean: shader splice "${label}" did not match — three's Water.js has changed`);
    return out;
  };

  water.material.vertexShader = splice(
    water.material.vertexShader,
    "uniform mat4 textureMatrix;",
    `uniform mat4 textureMatrix;
      ${SEA_SAMPLER}
      ${WAVE_GLSL}
      varying float vSteep;
      varying float vPhase;`,
    "vertex declarations");

  water.material.vertexShader = splice(
    water.material.vertexShader,
    // Whitespace-tolerant, because the thing being matched is three's own
    // source formatting and it is not ours to depend on.
    /mirrorCoord\s*=\s*modelMatrix\s*\*\s*vec4\(\s*position,\s*1\.0\s*\);\s*worldPosition\s*=\s*mirrorCoord\.xyzw;/,
    `vec4 rest = modelMatrix * vec4( position, 1.0 );
      vec3 wOff; float fold = 0.0; float ph0 = 0.0;
      oceanSurface( rest.xz, time, wOff, fold, ph0 );

      // The mesh is authored in its local XY plane and rotated onto XZ, so a
      // world offset lands as local ( x, -z, y ). Written out rather than done
      // with a matrix because it is three swizzles and one uniform less.
      vec3 moved = position + vec3( wOff.x, -wOff.z, wOff.y );

      vSteep = fold;
      vPhase = ph0;

      mirrorCoord = modelMatrix * vec4( moved, 1.0 );
      worldPosition = mirrorCoord.xyzw;`,
    "vertex displacement");

  water.material.vertexShader = splice(
    water.material.vertexShader,
    /vec4 mvPosition\s*=\s*modelViewMatrix\s*\*\s*vec4\(\s*position,\s*1\.0\s*\);/,
    "vec4 mvPosition = modelViewMatrix * vec4( moved, 1.0 );",
    "vertex projection");

  // --- Fragment: colour by depth, and surf ---------------------------------
  water.material.fragmentShader = splice(
    water.material.fragmentShader,
    "uniform vec3 waterColor;",
    `uniform vec3 waterColor;
      ${SEA_SAMPLER}
      uniform sampler2D uFoam;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uSurf;
      uniform vec2 uWind;
      varying float vSteep;
      varying float vPhase;`,
    "fragment declarations");

  water.material.fragmentShader = splice(
    water.material.fragmentShader,
    /vec3 albedo = mix\([\s\S]*?gl_FragColor = vec4\(\s*outgoingLight,\s*alpha\s*\);/,
    `// Body colour by depth. Shallow water over sand is green because the
      // light gets to the bottom and back; forty metres down nothing does.
      // Read the bottom here rather than trusting an interpolated one, and
      // jitter the lookup: the sea field's texels are 20 m across and without
      // this the surf line draws them as a row of squares.
      vec2 jitter = ( texture2D( uFoam, worldPosition.xz * 0.011 ).rg - 0.5 ) * 15.0;
      vec4 sea = seaAt( worldPosition.xz + jitter );
      float vDepth = -sea.x;
      float vShore = sea.y;
      float vExposed = sea.z;

      vec3 body = mix( uShallow, uDeep, smoothstep( 1.0, 24.0, vDepth ) );
      // Keep some of the body colour even at a grazing angle. Multiplying it
      // straight by N dot V, as the stock shader does, means the whole middle
      // distance loses its colour and goes the colour of the sky, which off a
      // hazy horizon is white.
      vec3 waterBody = body * ( 0.55 + 0.45 * max( 0.0, dot( surfaceNormal, eyeDirection ) ) )
                     + sunColor * diffuseLight * 0.18;

      // The stock Fresnel base is 0.3, which is about right for a rough sea seen
      // from a boat and far too mirror-like from three hundred metres up.
      float rf = 0.055 + ( 1.0 - 0.055 ) * pow( 1.0 - theta, 5.0 );

      vec3 albedo = mix(
        waterBody * getShadowMask(),
        ( vec3( 0.06 ) + reflectionSample * 0.86 + reflectionSample * specularLight ),
        rf );

      // --- Foam ---------------------------------------------------------
      // Two scales scrolling at different speeds and multiplied. One layer
      // reads as a moving texture; two read as something being churned.
      vec2 fuv = worldPosition.xz;
      float f1 = texture2D( uFoam, fuv * 0.09 + uWind * time * 0.014 ).r;
      float f2 = texture2D( uFoam, fuv * 0.011 - uWind * time * 0.004 ).r;
      float foamTex = clamp( f1 * 0.65 + f2 * 0.6, 0.0, 1.0 );

      // Whitecaps, where the wave sum is steep enough to be falling over. Out
      // in open water this is the only foam there is, and it is what tells you
      // how hard it is blowing without a wind gauge.
      // Gated higher than it was. The six-component sum tops out around 0.48,
      // so a threshold of 0.27 was catching roughly half of every wave field in
      // open water and the whole sea came out milky. Whitecaps are the top of
      // the distribution, not the middle of it.
      float caps = smoothstep( 0.36, 0.52, vSteep ) * 0.5 * mix( 0.08, 1.0, vExposed );

      // Surf: the band where the bottom has taken the wave apart. Strongest in
      // the last few metres of depth, and surging in and out with the phase of
      // the long swell, so the waterline moves instead of sitting still.
      float surge = 0.5 + 0.5 * sin( vPhase );
      float shoreM = vShore * uSeaDMax;
      // Water this shallow cannot hold a two metre swell up, so all of it is
      // broken. The surge term moves the inner edge in and out on the period of
      // the long wave, which is the run-up.
      float band = ( 1.0 - smoothstep( 0.3, 2.4 + surge * 2.2, vDepth ) )
                 * ( 1.0 - smoothstep( 8.0, 38.0 + surge * 30.0, shoreM ) );
      // The outer line: where the swell first feels the shelf and trips. This
      // is the band of broken water you see standing well off a reef, and it is
      // only there on the side the weather is coming from and only under the
      // crests — gating it on any positive steepness at all made half the sea
      // white, because half of a wave field is always on the way up.
      float outer = ( 1.0 - smoothstep( 2.0, 8.0, vDepth ) )
                  * smoothstep( 0.22, 0.40, vSteep ) * 0.38 * mix( 0.12, 1.0, vExposed );

      float foamAmt = clamp( ( band + outer + caps ) * uSurf, 0.0, 1.0 );
      // The texture is a mask, not a tint: it decides WHERE within the band the
      // water is actually broken, which is what stops the surf being a painted
      // white stripe following the contour.
      foamAmt *= smoothstep( 0.30, 0.82, foamTex * ( 0.5 + foamAmt * 1.0 ) );

      vec3 foamColor = vec3( 0.86, 0.92, 0.95 ) * ( 0.55 + diffuseLight * 0.6 );
      albedo = mix( albedo, foamColor, clamp( foamAmt, 0.0, 1.0 ) );

      // Let the beach show through the last metre of water. There is no
      // refraction pass here, but the terrain is already drawn underneath, so
      // simply not being opaque over it does the job.
      // Opaque sooner than it was. Letting 55% of the seabed through at zero
      // depth is right for the last metre of a beach and wrong for everything
      // else: over a drowned reef it draws the rock in full daylight colour
      // with a hard edge on it, which is what reads as an island that forgot to
      // surface. Two metres of water should already be water.
      float aOut = mix( 0.66, 1.0, smoothstep( 0.0, 2.0, vDepth ) );
      aOut = max( aOut, foamAmt );

      gl_FragColor = vec4( albedo, aOut * alpha );`,
    "fragment surf");

  // -------------------------------------------------------------------------
  // The reflection pass, and what it is allowed to cost
  //
  // three's Water renders the whole scene a second time, from a mirrored camera,
  // inside its onBeforeRender. That is the most expensive thing in this game and
  // none of the cost is where you would look for it: the target is 512x512, so
  // it is not fill rate. It is that every triangle, every draw call and every
  // skinned bone in the scene is processed twice per frame to produce a
  // 512-pixel image that then gets torn up by a scrolling normal map.
  //
  // (Water already freezes the shadow map for the duration — see its source —
  // so that particular double cost is not on the table.)
  //
  // Two things, neither visible in the result:
  //
  //   1. A skip list. Grass, trees, cloud sprites, surf spray and the prop
  //      clusters do not go in the mirror. At 512 across, blurred, at a glancing
  //      angle, through a moving surface, a spruce is under a pixel. Hiding them
  //      is one boolean per GROUP, and it takes the reflection down to terrain,
  //      sky and the dragon — which is all anyone can resolve anyway.
  //
  //   2. Throttling. setReflectionEvery(n) REUSES the previous frame's
  //      reflection rather than skipping the draw, so the water never goes
  //      black; it just lags by a frame or two, in a 512-pixel mirror, on a
  //      surface that is moving. Nobody has ever seen this.
  // -------------------------------------------------------------------------
  const reflectSkip = new Set();
  const reflectRestore = [];
  const waterOnBeforeRender = water.onBeforeRender;
  let reflectEvery = 1;
  let reflectTick = 0;

  water.onBeforeRender = function (renderer, scene_, camera) {
    // Frame zero always renders, so the target is never sampled before anything
    // has been written into it.
    if (reflectEvery > 1 && reflectTick++ % reflectEvery !== 0) return;

    reflectRestore.length = 0;
    for (const o of reflectSkip) {
      if (o.visible) { o.visible = false; reflectRestore.push(o); }
    }
    try {
      waterOnBeforeRender.call(this, renderer, scene_, camera);
    } finally {
      // finally, not just after: if the mirror render throws — a shader that
      // failed to compile, a lost context — the trees must still come back, or
      // the main pass silently loses the entire forest from then on.
      for (const o of reflectRestore) o.visible = true;
    }
  };

  scene.add(water);

  let t = 0;
  return {
    mesh: water,
    material: water.material,
    foamTexture: foam,

    /**
     * Keep an object out of the mirror. Pass the highest node that covers what
     * you mean — one Group beats fifty meshes, because this list is walked
     * every frame.
     *
     * IT MUST NOT CONTAIN A LIGHT. This is the whole reason the check below
     * exists, and it is worth spelling out because the failure is invisible at
     * the call site and brutal at runtime:
     *
     * three bakes the light count into every shader program as #define
     * NUM_POINT_LIGHTS. Hiding an object hides its lights too — three skips
     * invisible subtrees when it gathers them — so a group with a light in it
     * toggles the scene's light count twice per frame. The first frame that
     * happens, EVERY material in the scene compiles a second program variant
     * for the new count (the ocean shader included, which is the big one), and
     * every frame after that, every material fails its program check and
     * rebuilds its ~90-field cache key twice. One long freeze, then permanent
     * garbage.
     *
     * The compound and the sea stack each carry a pool of seven point lights,
     * which is exactly how this was found.
     */
    excludeFromReflection(...objs) {
      for (const o of objs) {
        if (!o) continue;
        let lit = null;
        o.traverse((n) => { if (n.isLight && !lit) lit = n; });
        if (lit) {
          console.error(
            `ocean: refusing to hide "${o.name || o.type}" from the reflection — ` +
            `it contains a ${lit.type}. Hiding lights changes the scene's light ` +
            `count every frame and forces three to rebuild every shader. ` +
            `Pass the geometry subtree instead.`);
          continue;
        }
        reflectSkip.add(o);
      }
    },

    /** 1 = every frame, 2 = every other, and so on. */
    setReflectionEvery(n) { reflectEvery = Math.max(1, n | 0); },

    /** How far ahead of the mesh the waves assume the bottom is, in metres. */
    setShoalBias(m) { u.uShoalBias.value = m; },

    setSun(dir) { u.sunDirection.value.copy(dir); },

    /** Sea state. 0 is a millpond, 1 is the sea this archipelago normally has. */
    setWindScale(v) { u.uWindScale.value = v; },

    update(focus, dt) {
      t += dt;
      u.time.value = t;
      if (focus) {
        // Follows the player rather than the camera: the camera is a few tens of
        // metres behind him and a disc this size does not care, and following
        // the camera makes the sea lurch every time you look around.
        water.position.x = focus.x;
        water.position.z = focus.z;
      }
    },

    setVisible(v) { water.visible = v; },
    dispose() { scene.remove(water); geo.dispose(); },
  };
}
