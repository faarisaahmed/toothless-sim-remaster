import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as tex from "./textures.js";

// ---------------------------------------------------------------------------
// Props — the bridge between "there is no art yet" and "the art arrived".
//
// Every placeable object in the game is asked for by name. If
// `assets/models/props/<name>.glb` exists it is used; if it doesn't, a
// registered primitive stand-in is built instead and the scene carries on. So
// the levels can be built, played and tuned before a single model is finished,
// and each model that lands replaces its stand-in with no code change.
//
// The other half of the bridge is materials. Per MODELS.md, models ship
// untextured with material slots named for a surface type — `wood`, `iron`,
// `rope`, `ember` and so on — and this binds our procedural canvas materials to
// those names on load. That is what keeps an imported model in the same visual
// family as a room built out of boxes.
// ---------------------------------------------------------------------------

const BASE = "./assets/models/props/";
const loader = new GLTFLoader();
const cache = new Map();      // name -> Promise<Object3D|null>
const fallbacks = new Map();  // name -> () => Object3D

// --- the slot palette -------------------------------------------------------
// Built once, on first use. Keyed by the exact names in MODELS.md.
let SLOTS = null;

function slots() {
  if (SLOTS) return SLOTS;
  const M = (gen, o) => tex.material(gen, o);
  SLOTS = {
    wood:      M(tex.wood({ planks: 6, warm: 0.95 }), { repeat: 1.5, roughness: 0.88, bumpScale: 0.06 }),
    wood_dark: M(tex.wood({ planks: 2, warm: 0.62 }), { repeat: 1.0, roughness: 0.95, bumpScale: 0.08 }),
    stone:     M(tex.stone(), { repeat: 1.2, roughness: 0.96, bumpScale: 0.10 }),
    hide:      M(tex.fur({ tint: [70, 52, 40] }), { repeat: 1.0, roughness: 1.0, bumpScale: 0.10 }),
    cloth:     M(tex.fur({ tint: [128, 118, 96] }), { repeat: 1.4, roughness: 0.95, bumpScale: 0.05 }),
    rope:      M(tex.fur({ tint: [96, 80, 54] }), { repeat: 3.0, roughness: 1.0, bumpScale: 0.14 }),

    // Iron is the one surface that wants to be smooth and a little metallic —
    // it is the thing the whole story is about and it should read as machined
    // next to all this splintery wood.
    iron: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.44, metalness: 0.85 }),

    // Ember is made emissive here so a model only has to tag which faces glow.
    ember: new THREE.MeshStandardMaterial({
      color: 0x2a0f06, emissive: 0xff6a22, emissiveIntensity: 2.2, roughness: 1,
    }),
  };
  return SLOTS;
}

/** The alloy. Deliberately wrong-looking — too pale and too smooth for iron. */
export function alloyMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x8e97a4, roughness: 0.30, metalness: 0.95,
  });
}

function bindSlots(root) {
  const S = slots();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const list = [].concat(o.material);
    const bound = list.map((m) => S[m?.name] || m);
    o.material = bound.length === 1 ? bound[0] : bound;
  });
  return root;
}

/**
 * Register the stand-in for a prop. Called by whoever owns the level, so the
 * fallback lives next to the thing it stands in for rather than in a big
 * central table of boxes.
 */
export function fallback(name, build) {
  fallbacks.set(name, build);
}

/**
 * Get a prop by name. Always resolves — to the model if there is one, to the
 * stand-in if there isn't, and to an empty group if there is neither.
 *
 * Returns a *clone*, so callers can place as many as they like.
 */
export async function prop(name) {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(BASE + name + ".glb")
      .then((g) => bindSlots(g.scene))
      .catch(() => null));
  }
  const model = await cache.get(name);
  if (model) return model.clone(true);

  const build = fallbacks.get(name);
  if (build) return build(slots());

  console.warn(`props: nothing for "${name}" — no model and no stand-in`);
  return new THREE.Group();
}

/** Synchronous stand-in, for code that can't wait a frame. */
export function propNow(name) {
  const build = fallbacks.get(name);
  return build ? build(slots()) : new THREE.Group();
}

/** Which of the requested props actually have a model on disk. For the console. */
export async function audit(names) {
  const out = {};
  for (const n of names) {
    out[n] = (await (cache.get(n) ?? prop(n).then(() => cache.get(n)))) ? "model" : "stand-in";
  }
  return out;
}

export { slots };
