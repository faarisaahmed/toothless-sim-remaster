import * as THREE from "three";
import { terrainHeight, fertility, islandAt, fbm, noise2,
         SEA_LEVEL, TERRAIN_SIZE, WIND_BEARING } from "./terrain.js";
import { buildKinds, buildTextures, bakeImposters, SPECIES_NAMES } from "./trees.js";
import { addPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// The forest: where every tree stands, what it is, and how it is drawn.
//
// What grows where follows the real north Atlantic coast:
//
//   - The thick wood of the sheltered, fertile valleys is Norway spruce, in
//     dark stands, with birch along the edges and in every gap.
//   - The drier, thinner slopes and the ridges are Scots pine and birch,
//     rowan scattered through them.
//   - The warm, low, fertile hollows hold the broadleaf wood: sessile oak,
//     birch and rowan.
//   - High up, and on thin soil on steep ground, it is juniper and stunted
//     birch, then nothing.
//   - Low headlands open to the prevailing gale grow wind pines, shorn flat
//     and all pointing the same way, and juniper.
//
// Species come in STANDS: a low-frequency field picks which tree dominates a
// patch of hillside, and only a fraction are the odd one out. A wood where
// every neighbour is a different species is a garden centre.
//
// Three levels of detail, by distance from the camera, per tree:
//
//   HERO   every branch and leaf card, within ~60-130 m
//   MID    trunk, limbs and a fifth of the leaves made larger, to the draw
//          distance the graphics menu sets
//   CARD   the hero model photographed from the side and from above, as
//          three cards, out to the forest's far edge
//
// Hero and mid are instanced per kind and refilled from a spatial grid when
// the camera has moved far enough to matter; nothing is built per frame. The
// cards are static, one instanced draw per 625 m tile for every species at
// once, and hide themselves inside the mid radius in the vertex shader.
// ---------------------------------------------------------------------------

const TILES = 16;
const TILE = TERRAIN_SIZE / TILES;
const CELL = 64;                              // lookup grid for the near LODs
const GN = Math.ceil(TERRAIN_SIZE / CELL);
// Was 95 when the archipelago had 24 km2 of land. It has 37 now, and a tree
// per 95 m2 of it came to 133k trees and a 3.1 s scatter; 115 keeps the woods
// closed and the scatter near what it was.
const AREA_PER_TREE = 115;
const TILE_TREE_CAP = 9000;

// Per-species tint over the leaf texture: r, g, b multipliers and lightness.
const SPECIES_TINT = {
  spruce:   [0.86, 0.96, 1.06, 0.88],
  pine:     [1.0, 0.98, 0.94, 0.95],
  birch:    [1.12, 1.08, 0.8, 1.12],
  rowan:    [1.02, 1.02, 0.9, 1.0],
  oak:      [1.08, 1.0, 0.82, 0.96],
  juniper:  [0.9, 0.98, 1.08, 0.92],
  windpine: [1.0, 0.96, 0.92, 0.9],
};
const lerp = THREE.MathUtils.lerp;

const KIND_SWAY_H = { spruce: 18, pine: 16, birch: 14, rowan: 8, oak: 12, juniper: 3.5, windpine: 8 };

const hash = (x, z, s) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Which tree grows here. Returns a species name.
 *   s     { x, z, h, f, slope }
 *   rnd   0..1, this spot's own roll
 */
function speciesAt(s, rnd, exposed) {
  const stand = fbm(s.x * 0.0042 + 7.1, s.z * 0.0042 - 3.3, 2);   // which conifer
  const broad = fbm(s.x * 0.0061 - 11.7, s.z * 0.0061 + 5.2, 2);  // broadleaf patches
  if (s.h > 225 || (s.f < 0.3 && s.slope > 0.3)) {
    if (rnd < 0.55) return "juniper";
    if (rnd < 0.75 && s.h < 300) return "windpine";
    return "birch";
  }
  if (exposed) return rnd < 0.72 ? "windpine" : "juniper";
  if (s.h < 95 && s.f > 0.5 && broad > 0.12) {
    if (rnd < 0.42) return "oak";
    if (rnd < 0.75) return "birch";
    if (rnd < 0.93) return "rowan";
    return "pine";
  }
  if (s.f > 0.62) {
    if (stand > -0.12) {
      if (rnd < 0.74) return "spruce";
      if (rnd < 0.9) return "birch";
      return "pine";
    }
    if (rnd < 0.62) return "pine";
    if (rnd < 0.88) return "birch";
    return "rowan";
  }
  if (rnd < 0.46) return "pine";
  if (rnd < 0.84) return "birch";
  if (rnd < 0.95) return "rowan";
  return "juniper";
}

// --- The card shader --------------------------------------------------------
const CARD_VERT_PARS = /* glsl */`
  attribute vec4 aSide;
  attribute vec4 aTop;
  attribute float aCanopy;
  attribute float aWhich;
  uniform vec3 uCenter;
  uniform float uMidR;
  varying float vCardFade;
`;
const CARD_VERT_MAIN = /* glsl */`
  vec3 transformed = vec3( position );
  if ( aWhich > 0.5 ) transformed.y = aCanopy;
  vec3 iBase = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
  // Seen from high above, the side cards are edge-on slivers and the top card
  // is the tree; from level, the other way round. Hand over between them.
  vec3 toCam = normalize( cameraPosition - iBase );
  float el = abs( toCam.y );
  vCardFade = aWhich > 0.5 ? 1.0 - smoothstep( 0.3, 0.62, el ) : smoothstep( 0.55, 0.85, el );
  // Inside the mid radius the real tree is drawn instead.
  if ( distance( iBase.xz, uCenter.xz ) < uMidR ) transformed = vec3( 0.0 );
`;

function cardGeometry() {
  const pos = [], uv = [], nrm = [], which = [], idx = [];
  const quad = (pts, uvs, n, w) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...pts[i]); uv.push(...uvs[i]); nrm.push(...n); which.push(w); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
  quad([[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]], U, [0, 0.6, 0.8], 0);
  quad([[0, 0, 0.5], [0, 0, -0.5], [0, 1, -0.5], [0, 1, 0.5]], U, [0.8, 0.6, 0], 0);
  quad([[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]], U, [0, 1, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("aWhich", new THREE.Float32BufferAttribute(which, 1));
  g.setIndex(idx);
  return g;
}

// Double-sided foliage is lit from one side only: three flips the normal on a
// back face, which turns a crown's outward normals inward and blacks out half
// the leaves. A crown is one soft mass, lit the same from either side.
const NO_FLIP = (src) => src.replace("normal *= faceDirection;", "");

// Alpha that survives distance. Down the mip chain a sprig's alpha averages
// toward its coverage — a half-solid cluster becomes a uniform 0.4 — and a
// fixed alpha test then deletes the whole canopy from a hundred metres out,
// leaving the trunks standing in the air. So the test relaxes as the mip level
// rises: full strength up close, where the edge of every needle shows, down to
// a fraction far off, where only the crown's outline is left to cut.
const ALPHA_TEST = (th) => `
  {
    vec2 tsz = vec2( textureSize( map, 0 ) );
    vec2 dx = dFdx( vMapUv * tsz ), dy = dFdy( vMapUv * tsz );
    float lod = 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) );
    float th = mix( ${th.toFixed(2)}, 0.1, clamp( lod / 5.0, 0.0, 1.0 ) );
    if ( diffuseColor.a < th ) discard;
  }`;

/**
 * @param {object} o
 *   root        the group everything hangs off
 *   renderer    for baking the imposters
 *   sway        flora's shared { uTime, uWind, uGust } uniforms
 *   swayShader  flora's wind patch, (shader, uniforms) => void
 *   near, far   draw distances from the graphics menu
 *   onProgress  0..1
 */
export function createForest({ root, renderer, sway, swayShader, near = 420, far = 2600, onProgress = () => {} }) {
  let NEAR = near, FAR = far;
  const t0 = performance.now();

  // --- Kinds, textures, materials ------------------------------------------
  const kinds = buildKinds();
  const tex = buildTextures();
  const t1 = performance.now();

  const mats = {};
  for (const name of SPECIES_NAMES) {
    const t = tex[name];
    const swayK = { value: 0.4 / (KIND_SWAY_H[name] ** 2) };
    const u = { ...sway, uSwayK: swayK };
    const bark = new THREE.MeshStandardMaterial({
      map: t.bark, normalMap: t.barkN, normalScale: new THREE.Vector2(1.4, 1.4),
      vertexColors: true, roughness: 0.94, metalness: 0,
    });
    bark.onBeforeCompile = (shader) => swayShader(shader, u);
    bark.customProgramCacheKey = () => "tree-bark-v1";
    const leaf = new THREE.MeshStandardMaterial({
      map: t.leaf, vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.82, metalness: 0,
    });
    leaf.onBeforeCompile = (shader) => {
      swayShader(shader, u);
      // Leaves flutter on top of the sway: a few centimetres, fast, each card
      // on its own phase.
      shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
        transformed += vec3( sin( uTime * 6.3 + position.x * 2.1 + position.z * 1.7 ),
                             sin( uTime * 5.1 + position.y * 2.3 ) * 0.6,
                             cos( uTime * 5.7 + position.z * 2.9 ) ) * 0.035 * uGust;
        #include <project_vertex>`);
      shader.fragmentShader = NO_FLIP(shader.fragmentShader)
        .replace("#include <alphatest_fragment>", ALPHA_TEST(0.42));
    };
    // Discarding is done by hand (ALPHA_TEST), so three has to be told the
    // material is cut out or the shadow pass draws whole cards.
    leaf.alphaTest = 0.0001;
    leaf.customProgramCacheKey = () => "tree-leaf-v2";
    mats[name] = { bark: addPhotoreal(bark), leaf: addPhotoreal(leaf) };
  }

  const atlas = renderer ? bakeImposters(renderer, kinds, tex) : null;
  const t2 = performance.now();

  const cardU = { uCenter: { value: new THREE.Vector3(1e9, 0, 1e9) }, uMidR: { value: NEAR } };
  const cardMat = new THREE.MeshStandardMaterial({
    map: atlas?.texture ?? null, alphaTest: 0.0001, side: THREE.DoubleSide,
    roughness: 0.85, metalness: 0,
  });
  cardMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cardU);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + CARD_VERT_PARS)
      .replace("#include <begin_vertex>", CARD_VERT_MAIN)
      .replace("#include <uv_vertex>", `#include <uv_vertex>
        vMapUv = aWhich > 0.5 ? mix( aTop.xy, aTop.zw, uv ) : mix( aSide.xy, aSide.zw, uv );`);
    shader.fragmentShader = NO_FLIP(shader.fragmentShader)
      .replace("#include <common>", "#include <common>\nvarying float vCardFade;")
      .replace("#include <alphatest_fragment>", ALPHA_TEST(0.5) + `
        if ( vCardFade > fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) ) discard;`);
  };
  cardMat.customProgramCacheKey = () => "tree-card-v2";
  addPhotoreal(cardMat);
  const cardGeo = cardGeometry();

  // --- Scatter --------------------------------------------------------------
  // A jittered grid rather than pure random: pure random clumps and leaves
  // bald patches, and a forest does neither.
  const spacing = Math.sqrt(AREA_PER_TREE);
  const nrm = { x: 0, y: 1, z: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  const windX = Math.sin(WIND_BEARING), windZ = Math.cos(WIND_BEARING);
  // Model +x is downwind; this yaw turns it onto the prevailing wind.
  const windYaw = Math.atan2(-windZ, windX);
  const kindsOf = {};
  kinds.forEach((k, i) => { (kindsOf[k.species] ||= []).push(i); });

  // Every tree, as flat arrays: its matrix, its kind, its tint.
  let cap = 1 << 16, count = 0;
  let MAT = new Float32Array(cap * 16), KIND = new Uint8Array(cap), TINT = new Float32Array(cap * 3);
  const grow = () => {
    cap *= 2;
    const a = new Float32Array(cap * 16); a.set(MAT); MAT = a;
    const b = new Uint8Array(cap); b.set(KIND); KIND = b;
    const c = new Float32Array(cap * 3); c.set(TINT); TINT = c;
  };
  const grid = Array.from({ length: GN * GN }, () => []);
  const boulders = [];
  const tiles = [];
  const speciesCount = {};

  for (let tz = 0; tz < TILES; tz++) {
    for (let tx = 0; tx < TILES; tx++) {
      const x0 = -TERRAIN_SIZE / 2 + tx * TILE;
      const z0 = -TERRAIN_SIZE / 2 + tz * TILE;
      let anyLand = false;
      for (let py = 0; py <= 4 && !anyLand; py++) {
        for (let px = 0; px <= 4; px++) {
          if (terrainHeight(x0 + px * TILE / 4, z0 + py * TILE / 4) > SEA_LEVEL + 5) { anyLand = true; break; }
        }
      }
      if (!anyLand) continue;

      const spots = [];
      for (let gz = 0; gz < TILE; gz += spacing) {
        for (let gx = 0; gx < TILE; gx += spacing) {
          const jx = (noise2((x0 + gx) * 0.31, (z0 + gz) * 0.29) * 0.5 + 0.5);
          const jz = (noise2((x0 + gx) * 0.27 + 40, (z0 + gz) * 0.33 - 12) * 0.5 + 0.5);
          const x = x0 + gx + jx * spacing;
          const z = z0 + gz + jz * spacing;
          const h = terrainHeight(x, z);
          if (h < SEA_LEVEL + 5) continue;
          // Slope only ever lowers fertility, so a spot that fails on flat
          // ground fails on any slope too -- and the four height samples a
          // normal costs are a good part of a candidate. Same trees, same
          // boulders (those want jx > 0.86 and always take the full path).
          if (jx <= 0.86) {
            const f0 = fertility(x, z, h, 0);
            if (f0 < 0.16 || jx * 0.9 + 0.1 > f0 * 1.15) continue;
          }
          // Forward differences off the height already in hand: two samples
          // instead of four, on a quarter of a million candidates.
          {
            const nx = h - terrainHeight(x + 7, z), nz = h - terrainHeight(x, z + 7);
            const len = Math.hypot(nx, 7, nz);
            nrm.x = nx / len; nrm.y = 7 / len; nrm.z = nz / len;
          }
          const slope = Math.min(1, (1 - nrm.y) * 2.6);
          const f = fertility(x, z, h, slope);
          if (f < 0.16) {
            if (f < 0.05 && slope > 0.10 && slope < 0.5 && jx > 0.86) {
              boulders.push({ x, z, h, n: { ...nrm }, s: 0.5 + jz * 2.2 });
            }
            continue;
          }
          if (jx * 0.9 + 0.1 > f * 1.15) continue;
          spots.push({ x, z, h, f, slope, j: jz });
        }
      }
      if (!spots.length) continue;
      if (spots.length > TILE_TREE_CAP) {
        const stride = spots.length / TILE_TREE_CAP;
        const kept = [];
        for (let i = 0; kept.length < TILE_TREE_CAP; i += stride) kept.push(spots[Math.floor(i)]);
        spots.length = 0;
        spots.push(...kept);
      }

      const first = count;
      for (const s of spots) {
        if (count >= cap) grow();
        const r1 = hash(s.x, s.z, 1), r2 = hash(s.x, s.z, 2), r3 = hash(s.x, s.z, 3);
        // Open water a little upwind and low ground: a headland in the gale.
        const exposed = s.h < 45 && terrainHeight(s.x - windX * 70, s.z - windZ * 70) < SEA_LEVEL + 1
          && terrainHeight(s.x - windX * 140, s.z - windZ * 140) < SEA_LEVEL + 1;
        const sp = speciesAt(s, r1, exposed);
        speciesCount[sp] = (speciesCount[sp] || 0) + 1;
        const list = kindsOf[sp];
        const kind = list[Math.floor(r2 * list.length)];

        // Shorter and scrubbier high up and on thin ground, taller in the
        // sheltered hollows. Same reason a treeline looks like one.
        const vigour = 0.62 + s.f * 0.45 - Math.min(0.3, Math.max(0, s.h - 120) / 600);
        const hk = THREE.MathUtils.clamp(vigour * (0.82 + s.j * 0.36), 0.5, 1.2)
          * (sp === "birch" && s.h > 225 ? 0.6 : 1);
        const wk = hk * (0.88 + r3 * 0.24);
        euler.set((r3 - 0.5) * 0.06, sp === "windpine" ? windYaw + (r3 - 0.5) * 0.3 : r1 * 97.0, (r2 - 0.5) * 0.06);
        q.setFromEuler(euler);
        scl.set(wk, hk, wk);
        pos.set(s.x, s.h - 0.25, s.z);
        m4.compose(pos, q, scl);
        m4.toArray(MAT, count * 16);
        KIND[count] = kind;

        // Each tree its own green, in three layers so a wood matches without
        // being uniform:
        //   the STAND   — a slow field: one hillside a little yellower and
        //                 drier, the next bluer and darker, as soil and age go;
        //   the SPECIES — birch bright and yellow-green, spruce near-black
        //                 blue-green, pine grey-olive, oak warm, rowan between;
        //   the TREE    — its own lightness and hue, enough that two
        //                 neighbours are plainly different trees.
        // A few birches and rowans are already turning, the way a northern
        // wood always has one or two going early.
        const warm = fbm(s.x * 0.004, s.z * 0.004, 2) * 0.5 + 0.5;
        const stand = fbm(s.x * 0.0021 + 17.3, s.z * 0.0021 - 4.1, 2);   // -1..1
        const SP = SPECIES_TINT[sp];
        const lv = (0.78 + r3 * 0.44) * SP[3] * (1 + (s.f - 0.5) * 0.12);
        const hue = stand * 0.09 + (r2 - 0.5) * 0.14 + (warm - 0.5) * 0.08;   // + yellow, - blue
        let cr = SP[0] * (1 + hue * 1.1), cg = SP[1] * (1 + hue * 0.25 + (r1 - 0.5) * 0.06), cb = SP[2] * (1 - hue * 1.3);
        if ((sp === "birch" || sp === "rowan") && r1 > 0.94) {
          // Turning early: gold on a birch, orange-red on a rowan.
          const k = 0.5 + r3 * 0.5;
          cr = lerp(cr, sp === "birch" ? 1.55 : 1.7, k); cg = lerp(cg, sp === "birch" ? 1.25 : 0.75, k); cb = lerp(cb, 0.35, k);
        }
        col.setRGB(lv * cr, lv * cg, lv * cb);
        TINT[count * 3] = col.r; TINT[count * 3 + 1] = col.g; TINT[count * 3 + 2] = col.b;

        const gx = Math.min(GN - 1, Math.max(0, Math.floor((s.x + TERRAIN_SIZE / 2) / CELL)));
        const gz = Math.min(GN - 1, Math.max(0, Math.floor((s.z + TERRAIN_SIZE / 2) / CELL)));
        grid[gz * GN + gx].push(count);
        count++;
      }

      // The tile's cards: every tree in it, every species, one draw.
      const n = count - first;
      const cards = new THREE.InstancedMesh(cardGeo, cardMat, n);
      const aSide = new Float32Array(n * 4), aTop = new Float32Array(n * 4), aCan = new Float32Array(n);
      const cm = new THREE.Matrix4(), sc = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const id = first + i;
        const card = atlas?.cards[KIND[id]];
        if (!card) continue;
        cm.fromArray(MAT, id * 16);
        sc.makeScale(card.cardW, card.cardH, card.cardW);
        cm.multiply(sc);
        cards.setMatrixAt(i, cm);
        col.setRGB(TINT[id * 3], TINT[id * 3 + 1], TINT[id * 3 + 2]);
        cards.setColorAt(i, col);
        aSide.set(card.side, i * 4);
        aTop.set(card.top, i * 4);
        aCan[i] = card.canopy;
      }
      cards.geometry = cardGeo.clone();
      cards.geometry.setAttribute("aSide", new THREE.InstancedBufferAttribute(aSide, 4));
      cards.geometry.setAttribute("aTop", new THREE.InstancedBufferAttribute(aTop, 4));
      cards.geometry.setAttribute("aCanopy", new THREE.InstancedBufferAttribute(aCan, 1));
      cards.instanceMatrix.needsUpdate = true;
      if (cards.instanceColor) cards.instanceColor.needsUpdate = true;
      cards.computeBoundingSphere();
      cards.castShadow = false;
      cards.receiveShadow = false;
      cards.visible = false;
      if (atlas) root.add(cards);
      tiles.push({ cx: x0 + TILE / 2, cz: z0 + TILE / 2, cards, count: n });
    }
    onProgress((tz + 1) / TILES);
  }
  const t3 = performance.now();

  // --- Near LODs --------------------------------------------------------------
  // One instanced mesh per kind per level per part. Capacity grows as needed.
  const slots = kinds.map((k) => {
    const m = mats[k.species];
    const make = (lodGeo) => {
      const mk = (geo, mat) => {
        const im = new THREE.InstancedMesh(geo, mat, 64);
        im.count = 0;
        im.visible = false;
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        root.add(im);
        return im;
      };
      return { bark: mk(lodGeo.bark, m.bark), leaf: mk(lodGeo.leaves, m.leaf), n: 0 };
    };
    return [make(k.hero), make(k.mid)];
  });

  function ensure(slot, part, need) {
    const im = slot[part];
    if (im.instanceMatrix.count >= need) return im;
    let c = im.instanceMatrix.count;
    while (c < need) c *= 2;
    const nim = new THREE.InstancedMesh(im.geometry, im.material, c);
    nim.castShadow = im.castShadow; nim.receiveShadow = im.receiveShadow;
    nim.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.remove(im);
    im.dispose();
    root.add(nim);
    slot[part] = nim;
    return nim;
  }

  const center = new THREE.Vector3(1e9, 0, 1e9);
  let dirty = true;
  let heroR = 90;
  const tmpCol = new THREE.Color();
  const bySlot = [];

  function rebuild(c) {
    center.copy(c);
    heroR = THREE.MathUtils.clamp(NEAR * 0.22, 60, 130);
    const midR = NEAR;
    cardU.uCenter.value.copy(c);
    cardU.uMidR.value = midR;

    // Gather: which trees, at which level, by kind.
    for (let k = 0; k < kinds.length; k++) { bySlot[k * 2] = []; bySlot[k * 2 + 1] = []; }
    const g0x = Math.max(0, Math.floor((c.x - midR + TERRAIN_SIZE / 2) / CELL));
    const g1x = Math.min(GN - 1, Math.floor((c.x + midR + TERRAIN_SIZE / 2) / CELL));
    const g0z = Math.max(0, Math.floor((c.z - midR + TERRAIN_SIZE / 2) / CELL));
    const g1z = Math.min(GN - 1, Math.floor((c.z + midR + TERRAIN_SIZE / 2) / CELL));
    const mid2 = midR * midR, hero2 = heroR * heroR;
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        const cell = grid[gz * GN + gx];
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          const dx = MAT[id * 16 + 12] - c.x, dz = MAT[id * 16 + 14] - c.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= mid2) continue;
          bySlot[KIND[id] * 2 + (d2 < hero2 ? 0 : 1)].push(id);
        }
      }
    }

    for (let k = 0; k < kinds.length; k++) {
      for (let lod = 0; lod < 2; lod++) {
        const ids = bySlot[k * 2 + lod];
        const slot = slots[k][lod];
        const n = ids.length;
        for (const part of ["bark", "leaf"]) {
          const im = ensure(slot, part, Math.max(1, n));
          const arr = im.instanceMatrix.array;
          for (let i = 0; i < n; i++) {
            const id = ids[i];
            for (let e = 0; e < 16; e++) arr[i * 16 + e] = MAT[id * 16 + e];
            if (part === "leaf") tmpCol.setRGB(TINT[id * 3], TINT[id * 3 + 1], TINT[id * 3 + 2]);
            else { const l = (TINT[id * 3] + TINT[id * 3 + 1] + TINT[id * 3 + 2]) / 3; tmpCol.setRGB(l, l, l); }
            im.setColorAt(i, tmpCol);
          }
          im.count = n;
          im.visible = n > 0 && enabled;
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          if (n > 0) im.computeBoundingSphere();
        }
        slot.n = n;
      }
    }
    dirty = false;
  }

  let enabled = true;

  console.info(`forest: ${count} trees (${Object.entries(speciesCount).map(([k, v]) => `${k} ${v}`).join(", ")}), `
    + `${kinds.length} kinds; trees ${Math.round(t1 - t0)}ms, imposters ${Math.round(t2 - t1)}ms, scatter ${Math.round(t3 - t2)}ms`);

  return {
    treeCount: count,
    tileCount: tiles.length,
    boulders,
    kinds,
    get heroRadius() { return heroR; },

    /** @param {THREE.Vector3} c   the camera, or the dragon if there is none */
    update(c) {
      if (!c || !enabled) return;
      for (const t of tiles) {
        const d = Math.hypot(c.x - t.cx, c.z - t.cz) - TILE * 0.72;
        const want = d < FAR;
        if (t.cards.visible !== want) t.cards.visible = want;
      }
      // Refill once the camera has gone a third of the hero radius, so the
      // nearest trees are always the detailed ones.
      const moved = Math.hypot(c.x - center.x, c.z - center.z);
      if (dirty || moved > Math.max(14, heroR * 0.3)) rebuild(c);
    },

    setLod(n, f) { NEAR = n; FAR = f; dirty = true; },

    /**
     * Debug: every kind, hero model, in a row along +x from (x, z), 14 m apart.
     * `lod` 1 shows the mid models instead. Returns the group, to remove.
     */
    showcase(x, z, lod = 0, atY = null) {
      const g = new THREE.Group();
      kinds.forEach((k, i) => {
        const geo = lod ? k.mid : k.hero;
        const px = x + i * 14, pz = z;
        const y = atY ?? terrainHeight(px, pz);
        for (const [gg, m] of [[geo.bark, mats[k.species].bark], [geo.leaves, mats[k.species].leaf]]) {
          const mesh = new THREE.InstancedMesh(gg, m, 1);
          mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(px, y, pz));
          mesh.setColorAt(0, new THREE.Color(1, 1, 1));
          mesh.castShadow = mesh.receiveShadow = true;
          g.add(mesh);
        }
      });
      root.add(g);
      return g;
    },

    setEnabled(v) {
      enabled = v;
      for (const t of tiles) t.cards.visible = false;
      for (const s of slots) for (const l of s) { l.bark.visible = v && l.n > 0; l.leaf.visible = v && l.n > 0; }
      dirty = true;
    },
  };
}
