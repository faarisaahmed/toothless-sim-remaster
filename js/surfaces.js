import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

// ---------------------------------------------------------------------------
// What he can stand on.
//
// The ground used to be the height field and nothing else, so he could land on
// a hut and end up standing inside it, and a roof, a deck, a crate or the top of
// a sea stack did not exist under his feet. This is the one question every foot
// and the body ask instead: "what is the highest solid thing under this point,
// no higher than here?" — answered from the terrain AND the real geometry of
// every place that registers itself.
//
// The places are a few large merged meshes (places.js mergeStatic), tens of
// thousands of triangles, so a plain raycast per foot per frame would cost
// milliseconds. Each registered geometry gets a BVH (three-mesh-bvh), after
// which a downward ray is a few microseconds.
// ---------------------------------------------------------------------------

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _n = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * @param {(x:number, z:number) => number} terrainAt  the height field
 * @param {number} seaLevel
 */
export function createSurfaces(terrainAt, seaLevel = 0) {
  const colliders = [];          // { mesh, box }

  /**
   * Make every static mesh under `root` solid. Skinned meshes (people, other
   * dragons), points, sprites and see-through glows are skipped: they move,
   * or they are light rather than stuff.
   */
  function register(root, { friction = 0.75 } = {}) {
    if (!root) return 0;
    root.updateMatrixWorld(true);
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
      const mats = [].concat(o.material);
      if (mats.some((m) => m && (m.transparent && m.opacity < 0.9 || m.blending === THREE.AdditiveBlending))) return;
      const g = o.geometry;
      if (!g?.attributes?.position || g.attributes.position.count < 3) return;
      if (!g.boundsTree) g.computeBoundsTree();
      o.raycast = acceleratedRaycast;
      g.computeBoundingBox();
      const box = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
      colliders.push({ mesh: o, box, friction });
      n++;
    });
    return n;
  }

  // Scratch result, reused: callers copy what they need.
  const out = { y: 0, normal: new THREE.Vector3(0, 1, 0), friction: 0.9, solid: false, water: false };

  /**
   * The highest solid surface under (x, z) at or below `below`.
   * Returns { y, normal, friction, solid, water } — `solid` is false over
   * open water, where the "surface" is the sea.
   */
  function at(x, z, below = Infinity, wantNormal = true) {
    const ty = terrainAt(x, z);
    let y = ty, solid = ty > seaLevel + 0.4, friction = 0.9;
    // Terrain normal from the height field, a metre either side — four more
    // samples of a costly noise field, so only when someone wants it.
    const e = 0.8;
    if (wantNormal) _n.set(terrainAt(x - e, z) - terrainAt(x + e, z), 2 * e, terrainAt(x, z - e) - terrainAt(x, z + e)).normalize();
    else _n.set(0, 1, 0);
    if (!solid) { y = seaLevel; _n.set(0, 1, 0); }

    const top = Number.isFinite(below) ? below : 1e4;
    for (const c of colliders) {
      const b = c.box;
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.min.y > top || b.max.y < y) continue;
      _o.set(x, Math.min(top, b.max.y + 0.01), z);
      ray.set(_o, DOWN);
      ray.far = _o.y - y + 0.01;
      const hit = ray.intersectObject(c.mesh, false)[0];
      if (hit && hit.point.y > y) {
        y = hit.point.y;
        solid = true;
        friction = c.friction;
        if (hit.face && wantNormal) {
          _n.copy(hit.face.normal).transformDirection(c.mesh.matrixWorld);
          if (_n.y < 0) _n.negate();
        }
      }
    }
    out.y = y; out.normal.copy(_n); out.friction = friction;
    out.solid = solid; out.water = !solid;
    return out;
  }

  /** Just the height, for things that only want a number. */
  const heightAt = (x, z, below = Infinity) => at(x, z, below, false).y;

  return { register, at, heightAt, get count() { return colliders.length; } };
}
