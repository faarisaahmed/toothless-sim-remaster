import * as THREE from "three";
import { terrainHeight, terrainNormal, fertility, islandAt, fbm, noise2,
         SEA_LEVEL, TERRAIN_SIZE, WIND_BEARING } from "./terrain.js";

// ---------------------------------------------------------------------------
// Trees, boulders and grass.
//
// The constraint that shapes all of this is that he covers 55 m in a second at
// cruise and 335 flat out. That rules out anything that has to be built as he
// arrives, and it means detail has almost no time on screen — a tree is fifteen
// frames of your life at sprint. So:
//
//   * Everything is scattered ONCE, at load, from the same fertility() that the
//     ground texture blends against, so the forest is on the green and the
//     scree is bare and the two agree.
//   * Trees live in a 16 x 16 grid of tiles, two instanced meshes per tile: a
//     built one for the tile you are over, a crossed billboard for the ones you
//     are not. Visibility is a distance test per TILE, which means one boolean
//     for a thousand trees, and three.js frustum-culls the rest for free.
//   * Grass exists only within 90 m of the camera and only below 140 m of
//     altitude, because above that it is smaller than a pixel. It follows him
//     and re-scatters a quarter of itself per frame so the refill never lands
//     as one hitch.
//
// Draw call budget: ~2 near tiles and ~30 far tiles visible is 32 calls for the
// whole forest, plus one for the boulders and one for the grass. No lights are
// added — see the note in places.js about what a point light costs here.
// ---------------------------------------------------------------------------

const TILES = 16;
const TILE = TERRAIN_SIZE / TILES;
const NEAR_LOD = 420;          // metres. Beyond this a tree is a billboard.
const FAR_LOD = 2600;          // beyond this the ground colour carries it
const AREA_PER_TREE = 210;     // m^2 of fully fertile ground per tree
const TILE_TREE_CAP = 1500;

const GRASS_COUNT = 11000;
const GRASS_RADIUS = 55;
const GRASS_CEILING = 140;     // metres AGL above which grass is sub-pixel
const GRASS_MOVE = 16;         // re-scatter after the camera has moved this far

// --- Procedural alpha maps -------------------------------------------------
// Drawn rather than downloaded because what these need is a specific silhouette
// on a transparent background, and a photographed texture of a spruce branch is
// exactly the thing you cannot find as CC0 with a clean alpha.

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Foliage for the cone shells.
 *
 * The first version of this drew three thin sprigs on a transparent tile, which
 * was pretty and useless: at alphaTest 0.42 it covered about a sixth of the
 * cone, so eighty percent of every tree was discarded and the forest came out
 * as a hillside of bare sticks. What an alpha-tested shell actually wants is
 * mostly-opaque foliage with a TORN EDGE — solid enough to read as a canopy,
 * broken enough that you see sky through it and the shell behind it.
 */
function needleTexture(size = 256) {
  const c = canvas(size);
  const g = c.getContext("2d");
  g.clearRect(0, 0, size, size);

  // A dense mat first, so the tile is opaque where the foliage is.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    // Thinner toward the tile edges, so the shells break up along their rims
    // rather than ending on a straight line.
    const edge = Math.min(1, Math.min(x, size - x, y, size - y) / (size * 0.18));
    if (Math.random() > 0.25 + edge * 0.85) continue;
    const len = size * (0.05 + Math.random() * 0.10);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    g.strokeStyle = `rgb(${24 + Math.random() * 30}, ${52 + Math.random() * 58}, ${24 + Math.random() * 30})`;
    g.lineWidth = 2.4 + Math.random() * 3.4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Then eat holes in it, so the canopy has sky through it instead of being a
  // solid green cone with a green texture on it.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 90; i++) {
    const r = size * (0.015 + Math.random() * 0.05);
    g.beginPath();
    g.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";

  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A whole conifer as one silhouette, for the far LOD. */
function treeBillboard(size = 128) {
  const c = canvas(size, size);
  const g = c.getContext("2d");
  g.clearRect(0, 0, size, size);

  g.fillStyle = "#3a2418";
  g.fillRect(size * 0.47, size * 0.72, size * 0.06, size * 0.28);

  // Four overlapping ragged triangles. The ragged edge is what stops a
  // distant forest reading as a field of identical cones.
  for (let tier = 0; tier < 5; tier++) {
    const t = tier / 5;
    const top = size * (0.04 + t * 0.16);
    const bot = size * (0.30 + t * 0.44);
    const halfW = size * (0.10 + t * 0.28);
    g.fillStyle = `rgb(${26 + tier * 6}, ${58 + tier * 11}, ${30 + tier * 6})`;
    g.beginPath();
    g.moveTo(size / 2, top);
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const w = halfW * u;
      g.lineTo(size / 2 + w * (0.82 + Math.random() * 0.36), top + (bot - top) * u);
    }
    for (let i = 12; i >= 0; i--) {
      const u = i / 12;
      const w = halfW * u;
      g.lineTo(size / 2 - w * (0.82 + Math.random() * 0.36), top + (bot - top) * u);
    }
    g.closePath();
    g.fill();
  }
  return toTex(c);
}

/** A clump of blades, for the grass tufts. */
function grassTexture(size = 128) {
  const c = canvas(size);
  const g = c.getContext("2d");
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 34; i++) {
    const x = size * (0.06 + Math.random() * 0.88);
    const h = size * (0.35 + Math.random() * 0.6);
    const lean = (Math.random() - 0.5) * size * 0.3;
    const grad = g.createLinearGradient(x, size, x, size - h);
    // Muted and olive. A saturated green here reads as fluorescent stickers
    // scattered over the hillside, because that is geometrically what it is.
    const dark = 26 + Math.random() * 20;
    grad.addColorStop(0, `rgb(${dark}, ${38 + dark}, ${18 + dark * 0.35})`);
    grad.addColorStop(1, `rgb(${dark + 30}, ${66 + dark}, ${26 + dark * 0.4})`);
    g.strokeStyle = grad;
    g.lineWidth = 1.4 + Math.random() * 2.2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, size);
    g.quadraticCurveTo(x + lean * 0.4, size - h * 0.55, x + lean, size - h);
    g.stroke();
  }
  return toTex(c);
}

// --- Geometry --------------------------------------------------------------

/**
 * One conifer, in metres, origin at the base.
 *
 * Cone SHELLS rather than solid cones: an open cone is half the triangles and,
 * with an alpha-tested needle map on it, you see through the gaps to the shell
 * behind, which is what gives it depth. Solid cones read as traffic bollards.
 */
function coniferGeometry(height = 9) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(height * 0.018, height * 0.045, height * 0.62, 5, 1, true);
  trunk.translate(0, height * 0.31, 0);
  parts.push({ geo: trunk, group: 0 });

  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = height * (0.30 - t * 0.20);
    const hh = height * (0.34 - t * 0.12);
    const y = height * (0.30 + t * 0.52);
    const cone = new THREE.ConeGeometry(r, hh, 7, 1, true);
    cone.translate(0, y + hh * 0.5, 0);
    parts.push({ geo: cone, group: 1 });
  }
  return parts;
}

/** Two crossed quads. Four triangles for a tree at half a kilometre. */
function crossGeometry(height = 9) {
  const w = height * 0.62;
  const a = new THREE.PlaneGeometry(w, height);
  a.translate(0, height * 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  return [a, b];
}

/** A boulder: an icosahedron kicked about until it stops looking like one. */
function boulderGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + noise2(v.x * 2.4 + 11, v.z * 2.4 - 7) * 0.26
                + noise2(v.y * 5.1 - 3, v.x * 5.1 + 9) * 0.14;
    v.multiplyScalar(n);
    v.y *= 0.72;                                  // boulders sit, they do not float
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// --- Wind ------------------------------------------------------------------
// One patch, injected into every scattered material. The phase comes from the
// instance's own world position, so a hillside of trees moves as a wave through
// the wood rather than in unison.
const SWAY_PARS = /* glsl */`
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uGust;
`;
const SWAY_MAIN = /* glsl */`
  #ifdef USE_INSTANCING
    vec3 iPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
  #else
    vec3 iPos = vec3( 0.0 );
  #endif
  float phase = iPos.x * 0.09 + iPos.z * 0.07;
  // The wind is a world direction but this runs BEFORE the instance matrix, so
  // it has to be rotated into the tree's own space first. Skip that and every
  // tree leans whichever way it happens to have been planted, which reads as a
  // forest full of independent nervous tics rather than as weather.
  #ifdef USE_INSTANCING
    vec3 wWind = vec3( uWind.x, 0.0, uWind.y );
    vec3 lWind = vec3( dot( instanceMatrix[0].xyz, wWind ), 0.0, dot( instanceMatrix[2].xyz, wWind ) );
    vec2 windLocal = normalize( lWind.xz + vec2( 1e-5 ) ).xy;
  #else
    vec2 windLocal = uWind;
  #endif
  // Only the part above the base moves, and as the square of it, so the trunk
  // stays planted and the top does the swinging.
  float lever = max( 0.0, transformed.y );
  float sway = sin( uTime * 1.35 + phase ) * 0.55 + sin( uTime * 2.9 + phase * 1.7 ) * 0.25;
  transformed.xz += windLocal * sway * uGust * lever * lever * 0.016;
`;

function addSway(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + SWAY_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY_MAIN);
  };
  material.customProgramCacheKey = () => "flora-sway-v1";
  return material;
}

// ---------------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @param {object} o   { onProgress }
 */
export function createFlora(scene, opts = {}) {
  const { onProgress = () => {} } = opts;

  // Grass is off by default now. It was 11,000 instances re-scattered a quarter
  // at a time, and each instance costs a terrainHeight() plus a terrainNormal()
  // — which is four more terrainHeight() calls — so a moving camera near the
  // ground was paying about fourteen thousand evaluations of a multi-octave
  // noise field PER FRAME, on the main thread, at exactly the moment you are
  // close enough to the ground for a stutter to be obvious. It bought detail
  // that only exists inside 55 m and below 140 m, which in a flying game is a
  // place you are for a second and a half at a time.
  const useGrass = opts.grass === true;
  const NEAR = opts.nearLod ?? NEAR_LOD;
  const FAR = opts.farLod ?? FAR_LOD;

  // One node the whole scatter hangs off, so callers that need to do something
  // to all of it — keep it out of the water's reflection, most of all — have
  // one object to name instead of a hundred and thirty.
  const root = new THREE.Group();
  root.name = "flora";
  scene.add(root);

  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(Math.sin(WIND_BEARING), Math.cos(WIND_BEARING)) },
    uGust: { value: 1 },
  };

  const needles = needleTexture();
  const billboard = treeBillboard();
  const blades = grassTexture();

  const barkMat = addSway(new THREE.MeshStandardMaterial({
    color: 0x4a3626, roughness: 0.95, metalness: 0,
  }), uniforms);
  const needleMat = addSway(new THREE.MeshStandardMaterial({
    map: needles, color: 0xffffff, roughness: 0.88, metalness: 0,
    alphaTest: 0.42, side: THREE.DoubleSide,
  }), uniforms);
  const cardMat = addSway(new THREE.MeshStandardMaterial({
    map: billboard, transparent: false, alphaTest: 0.42,
    side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }), uniforms);
  const boulderMat = new THREE.MeshStandardMaterial({
    color: 0x6d6960, roughness: 0.96, metalness: 0, vertexColors: true,
  });
  const grassMat = addSway(new THREE.MeshStandardMaterial({
    map: blades, alphaTest: 0.35, side: THREE.DoubleSide,
    roughness: 0.95, metalness: 0,
  }), uniforms);

  // Geometry is shared across every tile — the tiles differ in where the trees
  // are, not in what a tree is.
  const SHARED = {
    conifer: coniferGeometry(9).map((p) => p.geo),
    cards: crossGeometry(9),
  };

  // --- Scatter ------------------------------------------------------------
  // Poisson-ish: a jittered grid rather than pure random, because pure random
  // clumps and leaves bald patches, and a forest does neither.
  const spacing = Math.sqrt(AREA_PER_TREE);
  const tiles = [];
  const nrm = { x: 0, y: 1, z: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();

  const boulders = [];
  let treeTotal = 0;

  for (let tz = 0; tz < TILES; tz++) {
    for (let tx = 0; tx < TILES; tx++) {
      const x0 = -TERRAIN_SIZE / 2 + tx * TILE;
      const z0 = -TERRAIN_SIZE / 2 + tz * TILE;

      // Twenty-five probes to find out whether this tile is worth 1800. Most
      // of the map is open water and open water grows nothing.
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
          terrainNormal(x, z, 7, nrm);
          const slope = Math.min(1, (1 - nrm.y) * 2.6);
          const f = fertility(x, z, h, slope);
          if (f < 0.16) {
            // Where nothing grows, put rock. Loose boulders on scree slopes and
            // above the storm line are most of what makes a bare island read as
            // bare rather than as untextured.
            if (f < 0.05 && slope > 0.10 && slope < 0.5 && jx > 0.86) {
              boulders.push({ x, z, h, n: { ...nrm }, s: 0.5 + jz * 2.2 });
            }
            continue;
          }
          // Thin it out toward the edge of what will grow, so the wood has a
          // ragged margin instead of a contour line around it.
          if (jx * 0.9 + 0.1 > f * 1.15) continue;
          spots.push({ x, z, h, f, slope, j: jz });
          if (spots.length >= TILE_TREE_CAP) break;
        }
        if (spots.length >= TILE_TREE_CAP) break;
      }
      if (!spots.length) continue;

      const n = spots.length;
      treeTotal += n;

      const nearGeos = SHARED.conifer;
      const near = new THREE.Group();
      const nearMeshes = [];
      for (let gi = 0; gi < nearGeos.length; gi++) {
        const im = new THREE.InstancedMesh(nearGeos[gi], gi === 0 ? barkMat : needleMat, n);
        im.castShadow = true;
        im.receiveShadow = false;
        im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        nearMeshes.push(im);
        near.add(im);
      }
      const [cardA, cardB] = SHARED.cards;
      const farMeshes = [
        new THREE.InstancedMesh(cardA, cardMat, n),
        new THREE.InstancedMesh(cardB, cardMat, n),
      ];
      const far = new THREE.Group();
      for (const im of farMeshes) { im.castShadow = false; far.add(im); }

      for (let i = 0; i < n; i++) {
        const s = spots[i];
        const isl = islandAt(s.x, s.z);
        // Shorter and scrubbier high up and on thin ground, taller in the
        // sheltered fertile hollows. Same reason a treeline looks like one.
        const vigour = 0.55 + s.f * 0.75 - Math.min(0.35, s.h / 900);
        const height = THREE.MathUtils.clamp(vigour * (0.7 + s.j * 0.7), 0.35, 1.45);
        euler.set(0, s.j * Math.PI * 4, 0);
        q.setFromEuler(euler);
        scl.set(height * (0.85 + s.j * 0.3), height, height * (0.85 + s.j * 0.3));
        pos.set(s.x, s.h - 0.3, s.z);
        m4.compose(pos, q, scl);

        // Colour per tree, warmer on the low ground and bluer up high, plus a
        // fraction that are the odd one out.
        const warm = fbm(s.x * 0.004, s.z * 0.004, 2) * 0.5 + 0.5;
        col.setHSL(
          0.255 + warm * 0.045 - (isl && isl.bare > 0.6 ? 0.02 : 0),
          0.34 + warm * 0.20,
          0.14 + s.f * 0.10 + (s.j > 0.94 ? 0.08 : 0));

        for (const im of nearMeshes) { im.setMatrixAt(i, m4); im.setColorAt(i, col); }
        for (const im of farMeshes) { im.setMatrixAt(i, m4); im.setColorAt(i, col); }
      }
      for (const im of [...nearMeshes, ...farMeshes]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
      }

      near.visible = false;
      far.visible = false;
      root.add(near);
      root.add(far);
      tiles.push({
        cx: x0 + TILE / 2, cz: z0 + TILE / 2, near, far, count: n,
      });
    }
    onProgress((tz + 1) / TILES);
  }

  // --- Boulders ------------------------------------------------------------
  let boulderMesh = null;
  if (boulders.length) {
    const bg = boulderGeometry();
    boulderMesh = new THREE.InstancedMesh(bg, boulderMat, boulders.length);
    boulderMesh.castShadow = true;
    boulderMesh.receiveShadow = true;
    for (let i = 0; i < boulders.length; i++) {
      const b = boulders[i];
      // Lie them down on the slope they are sitting on, or they look dropped.
      const up = new THREE.Vector3(b.n.x, b.n.y, b.n.z);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      euler.set(0, b.s * 3.1, 0);
      q.multiply(new THREE.Quaternion().setFromEuler(euler));
      scl.set(b.s * 1.15, b.s * 0.8, b.s);
      pos.set(b.x, b.h - b.s * 0.28, b.z);
      m4.compose(pos, q, scl);
      boulderMesh.setMatrixAt(i, m4);
      const g = 0.55 + (i % 7) * 0.045;
      col.setRGB(g * 0.92, g * 0.90, g * 0.86);
      boulderMesh.setColorAt(i, col);
    }
    boulderMesh.instanceMatrix.needsUpdate = true;
    boulderMesh.instanceColor.needsUpdate = true;
    boulderMesh.computeBoundingSphere();
    root.add(boulderMesh);
  }

  // --- Grass ---------------------------------------------------------------
  let grass = null;
  if (useGrass) {
    const tuft = new THREE.PlaneGeometry(1.5, 1.0);
    tuft.translate(0, 0.5, 0);
    const tuftB = tuft.clone();
    tuftB.rotateY(Math.PI / 2.2);
    const grassGeo = mergeTwo(tuft, tuftB);
    grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
    grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grass.castShadow = false;
    grass.receiveShadow = false;
    grass.frustumCulled = false;
    grass.visible = false;
    grass.count = 0;
    root.add(grass);
  }

  const grassAt = new THREE.Vector3(1e9, 0, 1e9);
  let grassCursor = 0, grassPending = false, grassWritten = 0;

  function scatterGrassChunk(centre) {
    const CHUNK = GRASS_COUNT / 4;
    const end = Math.min(GRASS_COUNT, grassCursor + CHUNK);
    for (let i = grassCursor; i < end; i++) {
      // Golden-angle spiral: even coverage with no clumping and no rejection
      // loop, which matters because this runs inside a frame. It does leave
      // faint spiral arms visible on flat ground, so the radius gets a hash of
      // jitter — enough to break the pattern, not enough to clump.
      const t = (i + 0.5) / GRASS_COUNT;
      const j1 = ((i * 0.6180339887) % 1) - 0.5;
      const j2 = ((i * 0.7548776662) % 1) - 0.5;
      const r = Math.sqrt(t) * GRASS_RADIUS + j1 * 1.6;
      const a = i * 2.399963 + j2 * 0.35;
      const x = centre.x + Math.cos(a) * r;
      const z = centre.z + Math.sin(a) * r;
      const h = terrainHeight(x, z);
      terrainNormal(x, z, 3, nrm);
      const slope = Math.min(1, (1 - nrm.y) * 2.6);
      const f = fertility(x, z, h, slope);
      if (f < 0.2 || h < SEA_LEVEL + 3) {
        scl.set(0, 0, 0);   // an instance with no size costs a vertex, not a pixel
        m4.compose(pos.set(x, h, z), q.identity(), scl);
      } else {
        const s = (0.55 + f * 0.9) * (0.7 + ((i * 37) % 11) / 11 * 0.7);
        euler.set(0, i * 1.7, 0);
        q.setFromEuler(euler);
        scl.set(s, s * (0.7 + f * 0.7), s);
        m4.compose(pos.set(x, h - 0.05, z), q, scl);
      }
      grass.setMatrixAt(i, m4);
      grassWritten++;
    }
    grassCursor = end;
    grass.instanceMatrix.needsUpdate = true;
    if (grassCursor >= GRASS_COUNT) {
      grassPending = false;
      grass.count = GRASS_COUNT;
    } else {
      grass.count = Math.max(grass.count, grassCursor);
    }
  }

  let t = 0;

  return {
    root,
    treeCount: treeTotal,
    tileCount: tiles.length,
    boulderCount: boulders.length,
    grass,
    hasGrass: !!grass,

    /** @param {THREE.Vector3} focus  where the player is */
    update(focus, dt) {
      t += dt;
      uniforms.uTime.value = t;

      if (!focus || !this.enabled) return;

      for (const tile of tiles) {
        const d = Math.hypot(focus.x - tile.cx, focus.z - tile.cz) - TILE * 0.72;
        const wantNear = d < NEAR;
        const wantFar = !wantNear && d < FAR;
        if (tile.near.visible !== wantNear) tile.near.visible = wantNear;
        if (tile.far.visible !== wantFar) tile.far.visible = wantFar;
      }

      if (!grass) return;

      // Grass, only when he is low enough for it to be more than one pixel.
      const ground = terrainHeight(focus.x, focus.z);
      const agl = focus.y - Math.max(ground, SEA_LEVEL);
      const wantGrass = agl < GRASS_CEILING && ground > SEA_LEVEL + 3;
      grass.visible = wantGrass;
      if (!wantGrass) return;

      if (!grassPending && Math.hypot(focus.x - grassAt.x, focus.z - grassAt.z) > GRASS_MOVE) {
        grassAt.copy(focus);
        grassCursor = 0;
        grassPending = true;
      }
      // A quarter of the field per frame. Nine thousand terrain samples in one
      // go is a visible stall at the exact moment he touches down.
      if (grassPending) scatterGrassChunk(grassAt);
    },

    setGust(v) { uniforms.uGust.value = v; },

    enabled: true,
    /** Debug console switch. Hides everything scattered without unbuilding it. */
    setEnabled(v) {
      this.enabled = v;
      for (const tile of tiles) { tile.near.visible = false; tile.far.visible = false; }
      if (boulderMesh) boulderMesh.visible = v;
      if (grass) grass.visible = false;
    },

    dispose() {
      scene.remove(root);
      for (const tile of tiles) { root.remove(tile.near); root.remove(tile.far); }
      if (boulderMesh) root.remove(boulderMesh);
      if (grass) root.remove(grass);
    },
  };
}

/** Merge two geometries with the same attributes. Two crossed quads, one draw. */
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const names = ["position", "normal", "uv"];
  for (const name of names) {
    const A = a.attributes[name], B = b.attributes[name];
    const out = new Float32Array(A.array.length + B.array.length);
    out.set(A.array, 0);
    out.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(out, A.itemSize));
  }
  const ai = a.index.array, bi = b.index.array;
  const idx = new Uint16Array(ai.length + bi.length);
  idx.set(ai, 0);
  for (let i = 0; i < bi.length; i++) idx[ai.length + i] = bi[i] + a.attributes.position.count;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
