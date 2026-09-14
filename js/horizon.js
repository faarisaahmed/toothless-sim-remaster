import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { fbm, TERRAIN_SIZE } from "./terrain.js";

// ---------------------------------------------------------------------------
// Land you can see and cannot reach.
//
// The archipelago is a ten-kilometre square of height field with eighty-five
// islands in it, and it ended at a hard edge: fly past the last one and the
// world simply stopped, with nothing beyond it but the ocean disc running out
// to sixteen kilometres of empty water. That reads as the end of the MAP, which
// is a statement about the software, when what it should read as is the end of
// the CHART — a statement about how far these people have been.
//
// So: a ring of islands past the boundary, out where the height field does not
// go. They are silhouettes and nothing else. No collision, no height field, no
// trees, no entry on the chart (`map.js` draws from terrain.js's island table
// and these are not in it, which is the point — the edges are blank). You can
// see them from the last island in the archipelago and you will never stand on
// one, and that is the whole job: the world stops being a box and starts being
// a place with an outside.
//
// They also give the soft boundary in controls.js something to be ABOUT. Being
// turned around in featureless water is the game malfunctioning; being turned
// around while looking at land you have no business flying to is a decision the
// dragon is making, and the player can see the reason for it.
// ---------------------------------------------------------------------------

/**
 * Where they start.
 *
 * Measured against how far the player can actually GET, not against the size of
 * the archipelago. controls.js turns him back at a chebyshev 6,400 and he can
 * push about three hundred metres past that, so the far corner of the reachable
 * world is a little over nine kilometres from the middle — and the first
 * version of this put the nearest island at 8.2 km, which from the eastern edge
 * of the boundary was THREE kilometres away. A two-kilometre island three
 * kilometres off does not read as the far horizon, it reads as somewhere you
 * are about to land on, and it filled a third of the screen.
 *
 * Twelve and a half is the first distance at which the nearest of them is still
 * three kilometres away from the furthest he can get to it.
 */
const RING_NEAR = TERRAIN_SIZE * 1.25;   // 12.5 km
/** ...and where they stop. The ocean disc is 30 km and it follows him, so from
 *  the far corner of the boundary the opposite side of this ring is 27 km out
 *  and still comfortably standing on water. */
const RING_FAR  = TERRAIN_SIZE * 1.80;   // 18 km

const COUNT = 26;

// Size. These are big on purpose — at nine kilometres a 400 m island is a
// smudge, and the ones that carry the horizon have to be headlands rather than
// rocks. Scaled up with distance so the far ones do not vanish.
// Radius of the MESH, not of the visible island: the outer third of it is under
// the water (see DRAFT), so the coastline comes in at roughly two-thirds of
// these numbers. A near one is then about 1.5 km across and half a kilometre
// high, which at 12.5 km subtends seven degrees of width and two and a half of
// height — the proportions of real land a long way off, rather than of a
// mountain that has wandered up close.
const SPAN_NEAR = 1100;   // m of radius at RING_NEAR
const SPAN_FAR  = 2400;   // ...and at RING_FAR
const RISE_NEAR = 520;    // m of peak
const RISE_FAR  = 1250;

// Mesh resolution. Twenty-six islands at 28x7 is about ten thousand triangles
// for the entire horizon, merged into one draw call. At this range the
// SILHOUETTE is the only thing carrying any information, which is an argument
// for more sectors and fewer rings: the outline is what the sectors buy and
// nobody will ever see the shading down the slope.
const SECTORS = 28;
const RINGS   = 7;
/**
 * How deep the outer rim of the mesh is dragged under the water.
 *
 * The point of this is that the COASTLINE should be somewhere up the slope,
 * with real geometry continuing below it, rather than at the outermost ring of
 * the mesh. The first version put the rim 14 m down, which meant each island
 * met the sea at exactly its widest point and read as a mountain standing on a
 * wide flat plate — from a low camera those plates catch the light and the
 * whole ring looks like it is hovering an inch above the water.
 *
 * Biting on t^4 keeps the mountain itself untouched and takes the outer third
 * of the skirt down steeply, so the waterline lands about two-thirds of the way
 * out and the shore is cut by the sea the way every other island in the game
 * is: by being underneath it.
 */
const DRAFT   = 190;

// --- Aerial perspective ----------------------------------------------------
//
// Baked into the vertex colours, on top of the scene's own fog rather than
// instead of it.
//
// The fog alone is not enough out here and cannot be made to be: it is tuned
// for a world ten kilometres across, so at nine it has only taken about a tenth
// of the colour, and an island rendered in honest rock at nine kilometres comes
// out darker and more saturated than the sea in front of it. It reads as a near
// hill rather than as far land — the eye judges distance on contrast long
// before it judges it on size, which is why every landscape painter since
// Leonardo has washed the far hills out on purpose.
//
// So each vertex is mixed toward the fog colour by its own distance from the
// middle of the world, and a little further at the shore than at the summit,
// because the haze is thickest low down and that vertical gradient is most of
// what makes a ridge read as twenty kilometres off.
const HAZE_NEAR = 0.30;   // fraction of fog colour already mixed in at RING_NEAR
const HAZE_FAR  = 0.74;   // ...and out at the far end of the ring
const HAZE_BASE = 0.14;   // extra at the waterline, over and above that

/**
 * One island, as a radial mesh centred on its own origin.
 *
 * The per-sector variation is sampled on a CIRCLE in noise space, which is the
 * whole trick: a circle closes, so the profile wraps seamlessly back to where
 * it started and there is no seam down one side. Deterministic, like everything
 * else derived from terrain.js — the same horizon every load, in the renderer
 * and in anything that ever comes to read it.
 */
function islandGeometry(seed, span, rise, steep) {
  const pos = [];
  const idx = [];
  const NR = RINGS, NS = SECTORS;

  // Per-sector profile: how far the shore reaches, and how high the ground
  // behind it stands. Two different noise fields so the widest bearing is not
  // also always the tallest, and four octaves on the height so the skyline
  // breaks into subsidiary peaks instead of arriving at one tidy summit.
  const reach = [], peak = [];
  for (let i = 0; i <= NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    const cx = Math.cos(a) * 1.7 + seed * 31.7;
    const cz = Math.sin(a) * 1.7 - seed * 17.3;
    reach.push(0.55 + 0.45 * (fbm(cx, cz, 3) * 0.5 + 0.5));
    // Sampled on a wider circle as well, so the ridge has detail at two scales:
    // the big lobe that decides where the mountain is, and the notches in it.
    const broad = fbm(cx + 40.5, cz - 22.1, 3) * 0.5 + 0.5;
    const fine  = fbm(Math.cos(a) * 5.3 + seed * 9.1,
                      Math.sin(a) * 5.3 - seed * 6.7, 2) * 0.5 + 0.5;
    peak.push(0.26 + 0.62 * broad + 0.22 * fine * broad);
  }

  // The summit is one point, so the first ring cannot be collapsed to radius
  // zero without tearing — a tiny plateau instead, which also stops every
  // island coming to the same needle tip.
  const T0 = 0.09;
  for (let j = 0; j <= NR; j++) {
    const t = T0 + (1 - T0) * (j / NR);            // 0 summit .. 1 shore
    for (let i = 0; i <= NS; i++) {
      const a = (i / NS) * Math.PI * 2;
      const rad = span * reach[i] * t;
      // Falls away from the summit with a shoulder in the middle, so the
      // profile is a mountain rather than a cone. `steep` is per island and it
      // is what stops the ring being twenty-six of the same pyramid: low is a
      // long headland lying in the water, high is a spire.
      const h = rise * peak[i] * (Math.pow(1 - t, steep)
                                 + Math.sin(t * Math.PI) * 0.26)
              - DRAFT * Math.pow(t, 4);
      pos.push(Math.cos(a) * rad, h, Math.sin(a) * rad);
    }
  }

  const row = NS + 1;
  for (let j = 0; j < NR; j++) {
    for (let i = 0; i < NS; i++) {
      const a = j * row + i, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const ROCK = new THREE.Color(0x6d7f95);
const _c = new THREE.Color();

/**
 * Mix an island's vertices toward the fog colour by how far out it stands.
 *
 * Done per vertex rather than per island so the vertical gradient comes for
 * free: the shore is deeper in the haze than the summit is, which is both true
 * and the single cheapest thing that makes a far ridge read as far.
 */
function hazeGeometry(g, dist, rise, fog = ROCK) {
  const p = g.attributes.position;
  const t = THREE.MathUtils.clamp(
    (dist - RING_NEAR) / (RING_FAR - RING_NEAR), 0, 1);
  const base = THREE.MathUtils.lerp(HAZE_NEAR, HAZE_FAR, t);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // How far down the island this vertex is, 0 at the summit, 1 at the water.
    const low = 1 - THREE.MathUtils.clamp(p.getY(i) / Math.max(rise * 0.6, 1), 0, 1);
    _c.copy(ROCK).lerp(fog, Math.min(0.95, base + HAZE_BASE * low));
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/**
 * Build the ring.
 *
 * @param {THREE.Scene} scene
 * @returns {{group:THREE.Object3D, count:number, dispose:Function}}
 */
export function setupHorizon(scene) {
  const geos = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  // Taken off the scene rather than written down here, so it cannot drift from
  // the fog world.js actually set. Everything these are mixed toward has to be
  // the colour the distance is already going to.
  const fog = scene.fog ? scene.fog.color : new THREE.Color(0x8fb2cf);

  for (let i = 0; i < COUNT; i++) {
    // Golden angle round the ring, so they never line up into a visible
    // polygon however many there are, plus a noise nudge on both bearing and
    // range so the spacing does not read as regular either.
    const a = i * 2.39996 + fbm(i * 0.7, 11.3, 2) * 0.9;
    const t = (i * 0.6180339887) % 1;              // low-discrepancy, not random
    const d = THREE.MathUtils.lerp(RING_NEAR, RING_FAR, t);
    const span = THREE.MathUtils.lerp(SPAN_NEAR, SPAN_FAR, t)
               * (0.7 + 0.6 * (fbm(i * 1.9, 4.4, 2) * 0.5 + 0.5));
    const rise = THREE.MathUtils.lerp(RISE_NEAR, RISE_FAR, t)
               * (0.6 + 0.8 * (fbm(i * 2.7, -8.1, 2) * 0.5 + 0.5));

    // Steep spires and long headlands, deterministically mixed.
    const steep = 1.15 + 1.5 * (fbm(i * 3.3, 19.7, 2) * 0.5 + 0.5);

    const g = islandGeometry(i + 1, span, rise, steep);
    v.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    q.setFromAxisAngle(up, a * 1.7);
    m.compose(v, q, one);
    g.applyMatrix4(m);
    hazeGeometry(g, d, rise, fog);
    geos.push(g);
  }

  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();

  // White, because the colour is entirely in the vertices — see hazeGeometry().
  // It is still a lit material rather than a flat one: these have to go dark
  // when main.js walks the sun down for the raid, and a MeshBasicMaterial would
  // leave a ring of daylit islands round a night-time archipelago.
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true,
    roughness: 1.0, metalness: 0.0, fog: true,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.name = "horizon";
  // No shadows either way. The shadow camera is a 360 m box that follows him
  // around; nothing eight kilometres away is in it, and asking is not free.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // It never moves, and it is always in view — a bounding sphere the size of
  // the ring costs one culling test that always passes, which beats the
  // per-frame matrix work.
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);

  return {
    group: mesh,
    count: COUNT,
    /** Metres from the middle at which the nearest of them stands. */
    nearest: RING_NEAR,
    dispose() {
      scene.remove(mesh);
      merged.dispose();
      material.dispose();
    },
  };
}
