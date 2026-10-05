import * as THREE from "three";
import { addPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// Ultra grass: grass to the horizon.
//
// The ordinary grass (flora.js) is placed on the CPU, one terrainHeight() and a
// terrainNormal() per tuft, which is why it stops at 55 m: every tuft costs
// five evaluations of a forty-octave noise field. That cannot be pushed out to
// a kilometre on the main thread at any price.
//
// So this places grass on the GPU instead, with no per-tuft work on the CPU at
// all. Rings of a world-fixed lattice, nested like a clipmap: each ring is
// twice as wide as the one inside it and has lattice points twice as far
// apart, so every ring is the same number of instances however far out it
// reaches. The vertex shader turns its instance number into a lattice point
// round the dragon, jitters it by a hash of that point (so a tuft stays put as
// he moves, it does not swim), and reads the height and what is growing there
// from the same height field and vegetation paint the terrain mesh was built
// from. Ground that is bare, sandy, snowy, steep or under water gets none.
//
// Where two rings meet they cross-fade by tuft size, not by a line, and tufts
// grow a little as the rings coarsen, so the field thins with distance the way
// a real meadow resolves into texture — there is no edge to see.
//
// The CPU grass still covers the first 55 m when he is low, because it sits
// exactly on the fine terrain; this takes over from there. Higher up, when
// the near grass switches off, this fills the middle too.
// ---------------------------------------------------------------------------

const LEVELS = 6;           // 50 m, then doubling: out to 3.2 km at most
const R0 = 50;              // where the first ring starts when the near grass is on
const CELL0 = 1.35;         // lattice spacing in the first ring, metres
// Lattice points per side, the same in every ring. Two cells over, because the
// lattice snaps in steps of two and must still reach the ring's outer edge.
const N = Math.ceil((4 * R0) / CELL0) + 4;

const FIELD_PARS = /* glsl */`
  uniform sampler2D tFH, tFS, tFC;
  varying vec3 vGround;
  uniform float uFSize, uFVerts;
  uniform float uCell, uR0, uR1, uOutFade, uGrow;
  uniform float uTime, uGust;
  uniform vec2 uWind;
  vec2 fUv( vec2 w ) { return ( w / uFSize + 0.5 ) * ( ( uFVerts - 1.0 ) / uFVerts ) + 0.5 / uFVerts; }
  float fHash( vec2 p, float s ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) + s ) * 43758.5453 ); }
`;

const FIELD_MAIN = /* glsl */`
  float ix = float( gl_InstanceID % ${N} );
  float iz = float( gl_InstanceID / ${N} );
  // Round the camera, snapped to twice the cell, so this ring's lattice is every other point
  // of the ring inside it and a tuft that crosses from one to the other is
  // the same tuft in the same place.
  vec2 snap = floor( cameraPosition.xz / ( uCell * 2.0 ) ) * uCell * 2.0;
  vec2 lp = snap + ( vec2( ix, iz ) - ${(N / 2).toFixed(1)} ) * uCell;
  float h1 = fHash( lp, 0.0 ), h2 = fHash( lp, 1.7 ), h3 = fHash( lp, 3.1 ), h4 = fHash( lp, 5.3 );
  vec2 wp = lp + ( vec2( h1, h2 ) - 0.5 ) * uCell * 0.95;
  float d = length( wp - cameraPosition.xz );

  // This ring's share: grow in over the last stretch inside its inner edge,
  // shrink out over the last stretch inside its outer one. The next ring out
  // grows in over that same stretch, so the two hand over without a gap.
  float sIn = uR0 > 0.0 ? smoothstep( uR0 * 0.86, uR0, d ) : 1.0;
  float sOut = 1.0 - smoothstep( uR1 * uOutFade, uR1, d );

  vec4 sf = texture2D( tFS, fUv( wp ) );
  float H = texture2D( tFH, fUv( wp ) ).r;
  float hx = texture2D( tFH, fUv( wp + vec2( 6.5, 0.0 ) ) ).r;
  float hz = texture2D( tFH, fUv( wp + vec2( 0.0, 6.5 ) ) ).r;
  float slope = length( vec2( hx - H, hz - H ) ) / 6.5;
  // vegetation, less sand and snow, off the steep ground the terrain shader
  // paints as rock, and off the beach.
  // Thin on the heath, full on the turf.
  float dens = ( 0.3 + 0.7 * smoothstep( 0.1, 0.45, sf.r ) ) * ( 1.0 - sf.g ) * ( 1.0 - sf.b )
             * ( 1.0 - smoothstep( 0.6, 0.85, slope ) ) * smoothstep( 2.5, 5.0, H );
  float keep = step( h3, dens );
  // The turf's own colour from the terrain paint, so a tuft is the colour of
  // the ground it grows out of and not a sticker on it. A little lighter and
  // varied per tuft: blades catch more light than the mat under them.
  vGround = texture2D( tFC, fUv( wp ) ).rgb * ( 0.9 + h2 * 0.3 );

  float s = keep * sIn * sOut * uGrow * ( 0.65 + h4 * 0.7 ) * ( 0.6 + dens * 0.6 );

  float ang = h1 * 6.2832;
  float ca = cos( ang ), sa = sin( ang );
  vec3 lpos = vec3( ca * position.x + sa * position.z, position.y, -sa * position.x + ca * position.z );
  // Wider than tall as the rings coarsen: far grass wants to cover ground,
  // not stand up out of it.
  lpos *= vec3( s, s * mix( 1.0, 0.4, smoothstep( 1.0, 5.0, uGrow ) ), s );
  float sway = sin( uTime * 1.7 + wp.x * 0.13 + wp.y * 0.11 ) * 0.6 + sin( uTime * 3.1 + wp.x * 0.29 ) * 0.25;
  lpos.xz += uWind * sway * uGust * lpos.y * lpos.y * 0.12;
  // Sunk a little: the height field is 13 m a vertex and a tuft floating a
  // hand's width over a hollow reads at once, one sunk into a rise does not.
  vec3 transformed = vec3( wp.x, H - 0.12 - 0.04 * uGrow, wp.y ) + lpos;
`;

/**
 * @param {object} o
 *   texture     the grass blade alpha map
 *   heightTex   terrain height field (photoreal.js), verts x verts
 *   surfTex     vegetation / sand / snow per terrain vertex, same grid
 *   verts, size the grid's resolution and extent
 *   sway        flora's { uTime, uWind, uGust } uniforms, shared
 */
export function createGrassField({ texture, heightTex, surfTex, colourTex, verts, size, sway }) {
  const root = new THREE.Group();
  root.name = "grass-field";
  root.visible = false;

  // Two crossed quads, 1.5 x 1 m, base at the origin.
  const a = new THREE.PlaneGeometry(1.5, 1.0); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2.2);
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const A = a.attributes[name], B = b.attributes[name];
    const out = new Float32Array(A.array.length + B.array.length);
    out.set(A.array); out.set(B.array, A.array.length);
    merged.setAttribute(name, new THREE.BufferAttribute(out, A.itemSize));
  }
  const ia = a.index.array, off = a.attributes.position.count;
  merged.setIndex([...ia, ...Array.from(b.index.array, (i) => i + off)]);

  const geo = new THREE.InstancedBufferGeometry().copy(merged);
  geo.instanceCount = N * N;
  // Positions are made in the shader; the box only has to never be culled.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const rings = [];
  for (let k = 0; k < LEVELS; k++) {
    const last = k === LEVELS - 1;
    const u = {
      tFH: { value: heightTex }, tFS: { value: surfTex }, tFC: { value: colourTex },
      uFSize: { value: size }, uFVerts: { value: verts },
      uCell: { value: CELL0 * 2 ** k },
      uR0: { value: k === 0 ? R0 : R0 * 2 ** k },
      uR1: { value: R0 * 2 ** (k + 1) },
      // The outermost ring that is drawing fades over its whole outer half,
      // so the field ends in a thinning rather than a line. setRings moves it.
      uOutFade: { value: last ? 0.5 : 0.86 },
      // Tufts grow a little slower than the lattice coarsens, so the field
      // thins with distance but still reads as a carpet, not as speckle.
      uGrow: { value: 1.75 ** k },
      uTime: sway.uTime, uWind: sway.uWind, uGust: sway.uGust,
    };
    const mat = new THREE.MeshStandardMaterial({
      map: texture, alphaTest: 0.32, side: THREE.DoubleSide,
      roughness: 0.95, metalness: 0,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + FIELD_PARS)
        // Lit as the ground under it is, not as a card standing on it.
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );")
        .replace("#include <begin_vertex>", FIELD_MAIN);
      // Blade map for shape and light/dark only; the hue is the ground's.
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGround;")
        // Read two mips sharper than the hardware would choose. The blade map
        // is thin strokes on nothing, and its alpha averages away down the
        // mip chain, so at a distance an alpha test either eats the tuft or,
        // lowered to save it, cuts it into a square. A slight shimmer is the
        // price, and in grass that reads as grass.
        .replace("#include <map_fragment>", `
          vec4 sampledDiffuseColor = texture2D( map, vMapUv, -2.0 );
          diffuseColor *= sampledDiffuseColor;
          diffuseColor.rgb = vGround * clamp( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * 11.0, 0.55, 1.12 );`);
    };
    mat.customProgramCacheKey = () => "grass-field-v1";
    addPhotoreal(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    rings.push({ u, mesh });
  }

  return {
    root,
    instanceCount: N * N * LEVELS,
    setEnabled(v) { root.visible = !!v; },
    /** How many rings draw: 3 is out to 400 m, 6 to about 3.2 km. */
    setRings(n) {
      rings.forEach((r, k) => {
        r.mesh.visible = k < n;
        r.u.uOutFade.value = k === n - 1 ? 0.5 : 0.86;
      });
    },
    get enabled() { return root.visible; },
    /**
     * Centred on the camera itself (cameraPosition, in the shader).
     * @param {THREE.Vector3} focus     the dragon
     * @param {boolean} nearCovered     the CPU grass is drawing the first 55 m
     */
    update(focus, nearCovered) {
      if (!root.visible) return;
      rings[0].u.uR0.value = nearCovered ? R0 : 0;
    },
  };
}
