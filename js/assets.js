import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// One loader, one cache. The title screen, the prologue and the flight sim all
// want the same model and there's no reason to fetch four megabytes three times.

const loader = new GLTFLoader();
const cache = new Map();

/**
 * Load the first path that works. The 152-bone rig is the one we want
 * everywhere now; the two older exports are kept behind it so a missing or
 * broken file degrades to a worse dragon rather than a black screen.
 *
 * All three present identically in world space — 15.09 across, Y up, nose on
 * -Z — so they are interchangeable without touching any of the scaling below.
 */
export function loadDragon(paths = [
  "./assets/models/dragon_rigged_hd.glb",
  "./assets/models/toothless_rigged.glb",
  "./assets/models/dragon_rigged.glb",
]) {
  const key = paths.join("|");
  if (cache.has(key)) return cache.get(key);

  const p = (async () => {
    let lastErr = null;
    for (const path of paths) {
      try {
        const gltf = await loader.loadAsync(path);
        return { gltf, path };
      } catch (e) {
        lastErr = e;
        console.warn(`assets: ${path} failed, trying next`, e);
      }
    }
    throw lastErr || new Error("no dragon model could be loaded");
  })();

  cache.set(key, p);
  return p;
}

/**
 * Wrap a loaded model in a group scaled to a known size, so every scene can ask
 * for "three and a half metres of dragon" without knowing the export's units.
 *
 * Two things about these exports that this has to work around, both confirmed
 * by rendering against an axis helper rather than by trusting the numbers:
 *
 *  1. It is already Y-up and lying flat. An earlier version here inferred the
 *     up-axis from the bounding box and rotated it, which stood him on his tail.
 *     Do not re-add that.
 *  2. Box3.setFromObject reports 1.65 x 6.45 x 2.06 for a model that visibly
 *     isn't six units tall. For a SkinnedMesh the box comes from bind-pose
 *     geometry and can be wildly larger than what actually renders, so the
 *     vertical extent is not trustworthy.
 *
 * So: scale on the horizontal span only, and only ground him when the vertical
 * extent looks sane relative to it.
 *
 * @param {THREE.Object3D} root   the loaded scene
 * @param {number} length         desired size across the longest horizontal axis
 */
/**
 * Bounding box that accounts for skinning.
 *
 * Box3.setFromObject() unions each mesh's *bind-pose* geometry box, which for
 * this model is wrong in both directions at once — it claimed 6.45 units of
 * height for a dragon lying flat, and 2.06 of width for one whose spread wings
 * actually measure over four. SkinnedMesh.computeBoundingBox() walks the bones
 * and gives the posed extent, which is the thing we want to scale against.
 */
function measure(root) {
  root.updateWorldMatrix(true, true);

  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let found = false;

  root.traverse((o) => {
    let local = null;
    if (o.isSkinnedMesh && typeof o.computeBoundingBox === "function") {
      o.computeBoundingBox();
      local = o.boundingBox;
    } else if (o.isMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      local = o.geometry.boundingBox;
    }
    if (!local) return;
    tmp.copy(local).applyMatrix4(o.matrixWorld);
    box.union(tmp);
    found = true;
  });

  return found ? box : new THREE.Box3().setFromObject(root);
}

/**
 * Calibrated horizontal spans, in model units at scale 1.
 *
 * Neither automatic measurement works on these rigs: the bind-pose
 * Box3 says 2.06 across (too small — he rendered at double that), and the posed
 * SkinnedMesh box overshoots badly because the bone chains reach well past the
 * mesh (he rendered at a fifth the size). Rather than keep guessing, this was
 * measured once by rendering the model against a unit grid.
 *
 * If you swap the model, re-measure: load it in _inspect-style scene with a
 * GridHelper and count squares across the wings.
 */
const KNOWN_SPAN = {
  // Same mesh, same units, so the calibration carries across the rigs.
  "dragon_rigged_hd.glb": 4.2,
  "toothless_rigged.glb": 4.2,
};

function knownSpanFor(path) {
  if (!path) return null;
  const file = path.split("/").pop();
  return KNOWN_SPAN[file] ?? null;
}

/**
 * @param {THREE.Object3D} root  the loaded scene
 * @param {number} length        desired horizontal span in world units
 * @param {string} [path]        source path, used to pick a calibrated span
 */
export function normalizeDragon(root, length, path = null) {
  const holder = new THREE.Group();
  holder.add(root);

  const known = knownSpanFor(path);
  let span = known;

  if (span === null) {
    // Unknown model: fall back to measuring, and take the smaller of the two
    // estimates, since an over-large span only makes him too small to see.
    const size = measure(holder).getSize(new THREE.Vector3());
    span = Math.max(size.x, size.z) || 1;
  }

  holder.scale.setScalar(length / span);

  // Ground him on the bind-pose box, which is the one that tracks the body
  // rather than the reach of the bones.
  const box = new THREE.Box3().setFromObject(holder);
  const h = box.max.y - box.min.y;
  if (h > 0 && h < length * 1.5) holder.position.y = -box.min.y;

  return holder;
}

/** Deep clone that keeps skinning intact, via three's SkeletonUtils if present. */
export async function cloneSkinned(root) {
  const { clone } = await import("three/addons/utils/SkeletonUtils.js");
  return clone(root);
}
