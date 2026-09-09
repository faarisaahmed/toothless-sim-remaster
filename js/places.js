import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { prop, fallback, slots, alloyMaterial } from "./props.js";
import { makeOrb } from "./placeholder.js";

// ---------------------------------------------------------------------------
// Two cheats that the compound cannot do without, now that it is 116 x 92 m
// rather than 60 x 48.
//
// A modular kit is the right way to AUTHOR a place and the wrong way to render
// one. Six hundred deck modules of three boxes each is eighteen hundred draw
// calls for a floor, and the floor never moves. mergeStatic flattens anything
// that will never animate into one mesh per material — same picture, ~3 calls.
//
// And three.js forward-renders: every point light in the scene is a loop
// iteration in every fragment shader, whether or not that light is anywhere
// near what is being drawn. Sixteen braziers, eight cages and five guards is
// twenty-nine lights taxing every pixel of terrain on screen. A light pool
// keeps a small fixed number of real lights and moves them to whichever
// emitters are nearest the camera; everything else keeps its glowing core,
// which is unlit geometry and free.
// ---------------------------------------------------------------------------

/**
 * Flatten parentless, already-positioned objects into one mesh per material.
 * @returns {THREE.Mesh[]} the merged meshes, or the originals if merging fails
 *   (a delivered model with different vertex attributes will not merge, and a
 *   place that renders slowly beats a place that does not render).
 */
export function mergeStatic(objects) {
  if (!objects.length) return objects;
  const byMaterial = new Map();
  try {
    for (const o of objects) {
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        // Merging needs identical attribute sets; drop the ones nothing here
        // reads rather than letting one stray tangent fail the whole batch.
        for (const name of Object.keys(g.attributes)) {
          if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
        }
        if (!g.attributes.uv) {
          g.setAttribute("uv", new THREE.BufferAttribute(
            new Float32Array((g.attributes.position.count) * 2), 2));
        }
        const list = byMaterial.get(m.material) || [];
        list.push(g);
        byMaterial.set(m.material, list);
      });
    }
    const out = [];
    for (const [material, geos] of byMaterial) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) throw new Error("mergeGeometries returned null");
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = false;      // a merged floor casting on itself is noise
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  } catch (e) {
    console.warn("places: could not merge static geometry, falling back", e);
    return objects;
  }
}

/**
 * A fixed number of real lights, lent out to whoever is closest to the camera.
 *
 * @param {number} count how many actual PointLights exist. Every one of these
 *   costs a loop iteration in every fragment shader in the scene, so this is a
 *   frame-rate dial and should stay small.
 */
export function makeLightPool(parent, count = 7, { color = 0xff8a3a, distance = 78, decay = 1.7 } = {}) {
  const lights = [];
  for (let i = 0; i < count; i++) {
    const l = new THREE.PointLight(color, 0, distance, decay);
    // Visible from the moment it is made, and never turned off again. `count`
    // is a promise to the rest of the engine that the scene's point-light total
    // does not move, because that total is compiled into every shader as
    // #define NUM_POINT_LIGHTS — hiding one makes three build a whole new set
    // of programs for the new count, for every material in the game. An unused
    // light in this pool sits at intensity zero instead, which costs a loop
    // iteration per fragment and nothing else.
    parent.add(l);
    lights.push(l);
  }
  const scratch = new THREE.Vector3();
  return {
    lights,
    /**
     * @param {Array<{pos:THREE.Vector3,intensity:number,colour?:number}>} emitters
     *   in PARENT space, because that is where the lights live.
     */
    update(camera, emitters) {
      const live = emitters.filter((e) => e.intensity > 0);
      if (live.length > count) {
        parent.getWorldPosition(scratch);
        for (const e of live) {
          e._d = camera.position.distanceToSquared(scratch.clone().add(e.pos));
        }
        live.sort((a, b) => a._d - b._d);
      }
      for (let i = 0; i < lights.length; i++) {
        const e = live[i];
        // Dimmed, never hidden — see the note where these are made.
        if (!e) { lights[i].intensity = 0; continue; }
        lights[i].position.copy(e.pos);
        lights[i].intensity = e.intensity;
        if (e.colour !== undefined) lights[i].color.setHex(e.colour);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The two built places in Mission 1.
//
// Both are assembled from named props, so every piece is either the model that
// has arrived or the primitive stand-in registered below. The stand-ins are
// written to be *legible rather than good* — a cage should read as a cage from
// two hundred metres in the dark even while it is six boxes.
//
// Gameplay lives here too, because a brazier that can't be snuffed is scenery
// and this game is about turning scenery off.
// ---------------------------------------------------------------------------

const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/**
 * Put an object's *top* at a given height instead of its origin.
 *
 * The delivered models follow the brief: origin on the ground plane at the
 * footprint centre. That is right for everything that stands on something, and
 * exactly wrong for a piling, which is placed by where it meets the deck and
 * then disappears downwards. Measuring the bounds beats hardcoding a length
 * that changes the next time the model is rebuilt.
 */
function placeTopAt(obj, x, y, z) {
  obj.position.set(x, 0, z);
  obj.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj);
  obj.position.set(x, y - bb.max.y, z);
}
const cyl = (rt, rb, h, m, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

// --- stand-ins --------------------------------------------------------------
// Registered once at module load. Each is the smallest arrangement of boxes
// that still reads as the thing.

fallback("rig_deck_4m", (S) => {
  const g = new THREE.Group();
  const top = box(4, 0.18, 4, S.wood); top.position.y = -0.09; g.add(top);
  for (const x of [-1.85, 1.85]) {
    const j = box(0.16, 0.34, 4, S.wood_dark); j.position.set(x, -0.35, 0); g.add(j);
  }
  return g;
});

fallback("rig_piling", (S) => {
  // Wrapped in a group so the offset survives the caller positioning it: the
  // convention (MODELS.md) is origin at the top, because a piling is placed by
  // where it meets the deck, not by where it disappears into the sea.
  const g = new THREE.Group();
  const p = cyl(0.26, 0.34, 12, S.wood_dark, 7);
  p.position.y = -6;
  g.add(p);
  return g;
});

fallback("rig_cage_large", (S) => {
  const g = new THREE.Group();
  const W = 4.5, H = 3.5;
  const bar = () => new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.44, metalness: 0.85 });
  const m = bar();
  for (let i = 0; i <= 6; i++) {
    const t = -W / 2 + (i / 6) * W;
    for (const [dx, dz] of [[t, -W / 2], [t, W / 2], [-W / 2, t], [W / 2, t]]) {
      const b = cyl(0.05, 0.05, H, m, 5);
      b.position.set(dx, H / 2, dz);
      g.add(b);
    }
  }
  for (const y of [0.08, H - 0.08]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(W * 0.72, 0.07, 5, 4), m);
    r.rotation.x = Math.PI / 2; r.rotation.z = Math.PI / 4; r.position.y = y;
    g.add(r);
  }
  const roof = box(W, 0.12, W, m); roof.position.y = H; g.add(roof);
  // The lock plate. Alloy, and deliberately the only smooth thing on the rig.
  const lock = box(0.5, 0.7, 0.16, alloyMaterial());
  lock.position.set(0, 1.5, W / 2 + 0.05);
  lock.name = "lock";
  g.add(lock);
  return g;
});

fallback("rig_brazier", (S) => {
  const g = new THREE.Group();
  const post = cyl(0.07, 0.09, 2.2, S.iron, 6); post.position.y = 1.1; g.add(post);
  const bowl = cyl(0.42, 0.26, 0.36, S.iron, 8); bowl.position.y = 2.3; g.add(bowl);
  const coal = new THREE.Mesh(new THREE.SphereGeometry(0.30, 8, 6), S.ember.clone());
  coal.position.y = 2.36; coal.name = "coals";
  g.add(coal);
  return g;
});

fallback("rig_crane", (S) => {
  const g = new THREE.Group();
  const mast = cyl(0.18, 0.24, 7, S.wood_dark, 6); mast.position.y = 3.5; g.add(mast);
  const boom = cyl(0.14, 0.14, 6, S.wood_dark, 6);
  boom.rotation.z = Math.PI / 2.6; boom.position.set(2.0, 6.0, 0); boom.name = "boom";
  g.add(boom);
  const hook = cyl(0.05, 0.05, 1.4, S.iron, 5); hook.position.set(4.4, 4.6, 0); g.add(hook);
  return g;
});

fallback("rig_crate", (S) => box(0.9, 0.8, 0.9, S.wood));
fallback("rig_barrel", (S) => cyl(0.34, 0.30, 0.9, S.wood, 9));

fallback("stack_shelter", (S) => {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = cyl(0.11, 0.13, 2.6, S.wood_dark, 6);
    post.position.set(s * 2.2, 1.3, -1.6); g.add(post);
  }
  const ridge = cyl(0.10, 0.10, 5.2, S.wood_dark, 6);
  ridge.rotation.z = Math.PI / 2; ridge.position.set(0, 2.6, -1.6); g.add(ridge);
  // Sailcloth, sagging. Scavenged and lashed on with his mouth.
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 4.4, 6, 5), S.cloth);
  cloth.material = S.cloth.clone();
  cloth.material.side = THREE.DoubleSide;
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, Math.sin(pos.getX(i) * 1.1) * 0.16 - Math.abs(pos.getY(i)) * 0.06);
  }
  cloth.geometry.computeVertexNormals();
  cloth.rotation.x = -Math.PI / 2.35;
  cloth.position.set(0, 2.0, 0.2);
  g.add(cloth);
  return g;
});

fallback("stack_lab_shelf", (S) => {
  const g = new THREE.Group();
  const slab = cyl(1.55, 1.7, 0.34, S.stone, 9); slab.position.y = 0.17; g.add(slab);
  return g;
});

fallback("stack_fish_rack", (S) => {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const p = cyl(0.06, 0.07, 1.6, S.wood_dark, 5); p.position.set(s * 0.9, 0.8, 0); g.add(p);
  }
  const bar = cyl(0.04, 0.04, 1.9, S.wood_dark, 5);
  bar.rotation.z = Math.PI / 2; bar.position.y = 1.5; g.add(bar);
  return g;
});

// --- the rig ----------------------------------------------------------------

/**
 * Halvard's rig. A platform in open water on pilings — a factory, not a camp.
 *
 * Returns handles the mission needs: the braziers he snuffs, the cages he
 * opens, and the guards who are the reason both of those matter.
 */
/**
 * Dragon Hunter Island's fortress.
 *
 * This used to be a sixty-metre platform on pilings out in open water, which is
 * what STORY.md originally called for. It is now a compound on the floor of a
 * caldera: the island's rim stands two to five hundred metres up all the way
 * around it, there is one channel through the wall, and the only other way in
 * is over the top and down. That change is what makes the place *landable* —
 * the flight code will only put him down over land, so a base at sea could
 * never be walked around, and walking around it is most of what it is for.
 *
 * @param {THREE.Vector3} at      where the compound centres, in world space
 * @param {number} deckY          absolute world Y of the deck. On the island
 *                                this is the crater floor; left undefined it
 *                                falls back to the old 30 m above the water.
 * @param {(x,z)=>number} groundAt  height field, so foundations can reach down
 *                                to whatever is actually under each corner.
 */
export async function buildRig(scene, at, {
  seaLevel = 0, deckY = null, groundAt = null,
} = {}) {
  const group = new THREE.Group();
  const onLand = deckY !== null;
  const DECK_Y = onLand ? deckY - seaLevel : 30;   // deck height in group space
  group.position.set(at.x, seaLevel, at.z);
  scene.add(group);

  // Scale. The world is in metres — he is 14 m across the wings — so the
  // compound is laid out in metres too. The first pass was 60 x 48 m and read
  // as a raft; at 116 x 92 m it reads as somewhere people live and work, and
  // you cannot see all of it from one place on the deck.
  const MOD = 4.0;              // one deck module
  const COLS = 29, ROWS = 23;   // 116 x 92 m of platform

  const [deck, cage, brazier, crane, crate, barrel, piling] = await Promise.all(
    ["rig_deck_4m", "rig_cage_large", "rig_brazier", "rig_crane", "rig_crate", "rig_barrel", "rig_piling"]
      .map(prop)
  );

  const gx = (i) => (i - (COLS - 1) / 2) * MOD;
  const gz = (j) => (j - (ROWS - 1) / 2) * MOD;

  // Everything that will never move, collected and flattened at the end. The
  // deck alone is ~600 modules; added one at a time it is ~1800 draw calls for
  // a floor that is not going anywhere.
  const statics = [];

  // A notch out of two corners, so it has a silhouette instead of being a slab.
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      if (i >= COLS - 7 && j >= ROWS - 6) continue;
      if (i < 5 && j < 4) continue;
      const d = deck.clone(true);
      d.position.set(gx(i), DECK_Y, gz(j));
      statics.push(d);
    }
  }

  // Underneath. At sea it is pilings driven into the water; on the island it is
  // stub footings down onto whatever the rock actually does under each one,
  // which on a caldera floor is nearly but not quite flat.
  for (let i = 1; i < COLS; i += 4) {
    for (let j = 1; j < ROWS; j += 4) {
      const x = gx(i), z = gz(j);
      if (onLand) {
        const rock = groundAt ? groundAt(at.x + x, at.z + z) : seaLevel;
        const drop = Math.max(0.6, deckY - rock);
        if (drop < 0.7) continue;
        const foot = cyl(0.5, 0.65, drop, alloyMaterial(), 6);
        foot.position.set(x, DECK_Y - drop / 2, z);
        statics.push(foot);
      } else {
        const pl = piling.clone(true);
        placeTopAt(pl, x, DECK_Y + 0.4, z);
        statics.push(pl);
      }
    }
  }

  // --- Braziers ----------------------------------------------------------
  // The darkness is the resource (§2.6), so there are a lot of these and they
  // are spread wide enough that snuffing one does not darken its neighbour.
  const braziers = [];
  const BRAZ = [
    [-52, -38], [-52, -8], [-52, 22], [-30, -38], [-30, 34], [-8, -38],
    [-8, 12], [14, -38], [14, 24], [36, -34], [36, 0], [50, -18],
    [-30, 6], [10, -12], [-14, 34], [26, 8],
  ];
  for (const [x, z] of BRAZ) {
    const b = brazier.clone(true);
    b.position.set(x, DECK_Y + 0.3, z);
    // Not merged: each one owns a cloned coals material whose emissive changes
    // when it is snuffed, and merging would weld them all onto one material.
    group.add(b);

    const coals = b.getObjectByName("coals");
    if (coals) coals.material = coals.material.clone();

    // No PointLight of its own. It publishes where it is and how bright it
    // wants to be, and the pool decides which ones actually get a light this
    // frame. The glowing coals are unlit geometry, so a brazier you are not
    // near still reads as burning from any distance — it just stops lighting
    // the rock, which at that distance it was not visibly doing anyway.
    braziers.push({
      obj: b, coals, lit: true,
      local: new THREE.Vector3(x, DECK_Y + 1.9, z),
      intensity: 190,
      pos: new THREE.Vector3(at.x + x, seaLevel + DECK_Y + 1.9, at.z + z),
      snuff() {
        if (!this.lit) return false;
        this.lit = false;
        this.intensity = 0;
        if (this.coals) this.coals.material.emissiveIntensity = 0.05;
        return true;
      },
      relight() {
        this.lit = true;
        this.intensity = 190;
        if (this.coals) this.coals.material.emissiveIntensity = 2.2;
      },
    });
  }

  // --- Cages -------------------------------------------------------------
  const cages = [];
  const CAGES = [
    [-44, 20], [-24, 26], [-2, 22], [18, 30], [-44, -20],
    [-20, -28], [4, -26], [30, -14],
  ];
  for (const [x, z] of CAGES) {
    const c = cage.clone(true);
    c.position.set(x, DECK_Y + 0.3, z);
    group.add(c);

    // A dragon in it. Per the art rule, a ball of light with a question mark.
    // castLight off: thirteen orbs with real lights was thirteen loop
    // iterations in every fragment shader on screen. The core still glows.
    const orb = makeOrb({ color: 0x7fd0ff, radius: 1.2, intensity: 2.4, name: "caged", castLight: false });
    orb.setPosition(x, DECK_Y + 2.0, z);
    orb.state.bob = 0.12;
    orb.state.pulse = 0.22;
    orb.state.pulseRate = 0.9;
    group.add(orb.group);

    cages.push({
      obj: c, orb, open: false,
      pos: new THREE.Vector3(at.x + x, seaLevel + DECK_Y + 2.0, at.z + z),
      release() {
        if (this.open) return false;
        this.open = true;
        return true;
      },
      update(dt, camera) {
        this.orb.update(dt, camera);
        if (this.open) {
          // Straight up and gone. Nobody has to be told twice.
          this.orb.group.position.y += dt * 40;
          this.orb.group.scale.multiplyScalar(1 - dt * 0.3);
          if (this.orb.group.position.y > DECK_Y + 500) this.orb.group.visible = false;
        }
      },
    });
  }

  for (const [x, z, ry] of [[46, 26, 0], [-50, -30, 1.9], [8, 36, -0.8]]) {
    const cr = crane.clone(true);
    cr.position.set(x, DECK_Y + 0.3, z);
    cr.rotation.y = ry;
    statics.push(cr);
  }

  for (let i = 0; i < 70; i++) {
    const o = (i % 3 ? crate : barrel).clone(true);
    o.position.set(-54 + Math.random() * 108, DECK_Y + 0.3, -42 + Math.random() * 84);
    o.rotation.y = Math.random() * Math.PI;
    statics.push(o);
  }

  // --- Guards ------------------------------------------------------------
  // Cold orbs that walk a route. Their whole job is to make the dark matter —
  // see §2.6, the darkness is the resource.
  const guards = [];
  const ROUTES = [
    [[-54, -34], [-54, 30], [-30, 30], [-30, -34]],
    [[-6, -34], [40, -34], [40, 18], [-6, 18]],
    [[-30, 0], [44, 0]],
    [[-50, 34], [30, 34]],
    [[20, -30], [20, 30]],
  ];
  for (const route of ROUTES) {
    const orb = makeOrb({ color: 0xbfd4ff, radius: 0.7, intensity: 1.6, name: "guard", castLight: false });
    orb.state.bob = 0.02;
    group.add(orb.group);
    guards.push({
      orb, route, leg: 0, t: 0, alerted: 0,
      pos: new THREE.Vector3(),
      update(dt, camera) {
        const a = route[this.leg], b = route[(this.leg + 1) % route.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.t += (dt * 7.0) / len;
        if (this.t >= 1) { this.t = 0; this.leg = (this.leg + 1) % route.length; }
        const x = a[0] + (b[0] - a[0]) * this.t;
        const z = a[1] + (b[1] - a[1]) * this.t;
        this.orb.setPosition(x, DECK_Y + 2.2, z);
        this.orb.update(dt, camera);
        this.pos.set(at.x + x, seaLevel + DECK_Y + 2.2, at.z + z);
      },
    });
  }

  // Flatten the floor, the footings, the cranes and the clutter into a handful
  // of meshes. Everything left in `group` individually is something that moves,
  // animates, or changes material at runtime.
  for (const m of mergeStatic(statics)) group.add(m);

  // Seven real lights, shared out among sixteen braziers by distance.
  const lightPool = makeLightPool(group, 7, { color: 0xff8a3a, distance: 78, decay: 1.7 });

  return {
    group,
    braziers, cages, guards,
    deckY: seaLevel + DECK_Y,
    /** Half-extent of the deck, so callers can size a landing zone off it. */
    extent: { x: (COLS * MOD) / 2, z: (ROWS * MOD) / 2 },
    centre: new THREE.Vector3(at.x, seaLevel + DECK_Y, at.z),
    /** How lit the place still is, 0..1. The stealth score, basically. */
    get litFraction() {
      return braziers.filter((b) => b.lit).length / braziers.length;
    },
    update(dt, camera) {
      for (const g of guards) g.update(dt, camera);
      for (const c of cages) c.update(dt, camera);
      // Hand the seven lights to whichever braziers are nearest the camera.
      lightPool.update(camera, braziers.map((b) => ({
        pos: b.local, intensity: b.lit ? b.intensity : 0,
      })));
    },
    setVisible(v) { group.visible = v; },
    dispose() { scene.remove(group); },
  };
}

// --- The snare camp ---------------------------------------------------------

/**
 * What the hunters left in the clearing on Peaceable Country.
 *
 * This is the first sign of them and the only scene in mission 1 that is
 * nothing but evidence — there is no mechanic on it and nobody in it. So every
 * object has to say something, and it all has to say the same thing:
 *
 *   the burnt stumps say they took the wood down to make room;
 *   the snare and the chain staked through it say what the room was for;
 *   the small cage with its door hanging open says it worked;
 *   the cold brazier says they are not coming back;
 *   and the drag scar running downhill says which way whatever was in the cage
 *   went, which is the only reason the player then crosses the open sea.
 *
 * The drag is the load-bearing one. Without it the clearing is a dead end and
 * "fly out past the edge of the chart" is a waypoint the game hands you; with
 * it, the crossing is something you worked out.
 */
export async function buildSnareCamp(scene, at, { groundAt = null,
                                                 toward = null } = {}) {
  const group = new THREE.Group();
  const ground = (x, z) => (groundAt ? groundAt(x, z) : 0);
  const base = ground(at.x, at.z);
  // The group carries the clearing's height and everything in it is placed
  // relative to that, so a prop on the slope at the edge still meets the
  // ground. Setting this to 0 while measuring the children off `base` put the
  // whole camp a hundred metres under the clearing, at sea level.
  group.position.set(at.x, base, at.z);
  scene.add(group);

  const statics = [];
  /** Place a clone on the ground, in clearing-local coordinates. */
  const put = (src, dx, dz, ry = 0, tilt = 0) => {
    const o = src.clone(true);
    o.position.set(dx, ground(at.x + dx, at.z + dz) - base, dz);
    o.rotation.set(tilt ? tilt * 0.6 : 0, ry, tilt);
    statics.push(o);
    return o;
  };

  // Which way the drag runs. Downhill, because that is the way a cage full of
  // dragon actually slides — read off the height field rather than chosen —
  // but weighted towards `toward`, which is where the hunters went. Downhill
  // alone put it on the north side of the clearing, pointing back at Berk,
  // and a trail that leads the wrong way is worse than no trail: the next
  // beat is "follow it", and it has to be followable.
  const want = toward
    ? new THREE.Vector2(toward.x - at.x, toward.z - at.z).normalize()
    : null;
  let fall = new THREE.Vector2(0, 1), fallScore = -1e9;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
    const cx = Math.cos(a), cz = Math.sin(a);
    const drop = base - ground(at.x + cx * 140, at.z + cz * 140);
    if (drop <= 0) continue;
    const align = want ? Math.max(0, cx * want.x + cz * want.y) : 1;
    const score = drop * (0.3 + 0.7 * align);
    if (score > fallScore) { fallScore = score; fall.set(cx, cz); }
  }
  const bearing = Math.atan2(fall.x, fall.y);

  // Everything below is laid out for the ONE angle it will be seen from,
  // which is two hundred metres up and moving.
  //
  // The first version of this was a tight fifteen-metre huddle of props, and
  // from the air it was invisible: a crate is a metre across, which is four
  // pixels at that range, and it is brown on brown. What reads at that
  // distance is not objects, it is PATTERN — a straight line forty metres
  // long, a right angle, two parallel rows of anything. Nothing in a forest
  // is straight. So the camp is a rectangular pen with a fence round it, its
  // stores in a row against one side, and a drag road leaving it downhill
  // between two lines of shoved-aside logs.

  const [cage, doorOpen, chain, crate, barrel, brazier, net, winch, drift, fence]
    = await Promise.all(["rig_cage_large", "rig_cage_door_open",
      "rig_chain_coil", "rig_crate", "rig_barrel", "rig_brazier",
      "rig_net_pile", "rig_winch", "stack_driftwood", "berk_fence_4m"]
      .map(prop));

  const PEN_X = 26, PEN_Z = 18;                    // half-extents of the pen

  // The fence. Modular at 4 m, butted end to end, and the run is broken open
  // on the downhill side — which is both where they took the cage out and the
  // gap the drag road leaves through.
  const gapAt = new THREE.Vector2(fall.x, fall.y);
  for (const side of [-1, 1]) {
    for (let x = -PEN_X + 2; x <= PEN_X - 2; x += 4) {
      const zz = side * PEN_Z;
      if (gapAt.y * side > 0.5 && Math.abs(x) < 6) continue;
      put(fence, x, zz, Math.PI / 2);
    }
    for (let z = -PEN_Z + 2; z <= PEN_Z - 2; z += 4) {
      const xx = side * PEN_X;
      if (gapAt.x * side > 0.5 && Math.abs(z) < 6) continue;
      put(fence, xx, z, 0);
    }
  }

  // The cage it held, with the door off it, and the snare at the gate. The
  // snare is where the interact point goes, so it sits at the pen's centre.
  put(cage, -6, 4, 0.34);
  put(doorOpen, 4, -3, 2.1, 0.42);
  put(net, 0, 0, 0.4);
  put(chain, 5.0, 2.6, 1.1);
  for (let i = 0; i < 6; i++) {                    // stakes round the snare
    const a = (Math.PI * 2 * i) / 6 + 0.3;
    const sx = Math.cos(a) * 4.4, sz = Math.sin(a) * 4.4;
    const st = cyl(0.10, 0.15, 1.8, slots().wood_dark, 6);
    st.position.set(sx, ground(at.x + sx, at.z + sz) - base + 0.65, sz);
    st.rotation.z = 0.22 * Math.cos(a);
    st.rotation.x = -0.22 * Math.sin(a);
    statics.push(st);
  }

  // Stores, in a row against the uphill fence. People stack things in rows;
  // that row is worth more to this scene than any single object in it.
  for (let i = 0; i < 6; i++) {
    const x = -18 + i * 7.2;
    put(i % 3 === 2 ? barrel : crate, x, -PEN_Z + 3.4, 0.12 + i * 0.4,
        i === 4 ? 0.42 : 0);                       // one of them tipped over
  }
  put(crate, -20.5, -PEN_Z + 6.6, 0.8);
  put(barrel, 14.5, -PEN_Z + 7.0, 0);
  put(winch, PEN_X - 6, 8, -1.4);                  // what they hauled with
  put(chain, PEN_X - 10, 11, 0.2);

  // Cold. The one object here that would be lit if anybody were still in it.
  const br = put(brazier, -PEN_X + 6, -10, 0.0);
  const coals = br.getObjectByName("coals");
  if (coals) {
    coals.material = coals.material.clone();
    coals.material.emissiveIntensity = 0.02;
  }

  // Burnt stumps, where the wood came down to make the room. Cut low and
  // ragged rather than sawn flat: felled with fire and a hand axe.
  const charred = new THREE.MeshStandardMaterial({
    color: 0x241d18, roughness: 0.95, metalness: 0,
  });
  for (let i = 0; i < 46; i++) {
    const a = i * 2.399963;                        // golden angle, so no rows
    const rr = 20 + Math.sqrt(i / 46) * 74;
    const sx = Math.cos(a) * rr, sz = Math.sin(a) * rr;
    const h = ground(at.x + sx, at.z + sz);
    if (h <= 2) continue;                          // not into the water
    const tall = 0.6 + ((i * 37) % 11) / 11 * 1.6;
    const st = cyl(0.22 + (i % 3) * 0.05, 0.38, tall, charred, 6);
    st.position.set(sx, h - base + tall * 0.45, sz);
    st.rotation.z = ((i % 5) - 2) * 0.04;
    statics.push(st);
  }

  // The drag road. Two parallel lines of shoved-aside trunks, six metres
  // apart, running two hundred metres downhill and out of the clearing. This
  // is the single most legible thing in the scene from the air and the only
  // one that says which way to go next.
  const across = new THREE.Vector2(fall.y, -fall.x);
  for (let i = 0; i <= 13; i++) {
    const t = i / 13;
    const run = PEN_Z * 0.6 + t * 190;
    const dx = fall.x * run, dz = fall.y * run;
    if (ground(at.x + dx, at.z + dz) <= 3) break;
    for (const sgn of [-1, 1]) {
      const o = put(drift, dx + across.x * sgn * 3.4, dz + across.y * sgn * 3.4,
                    bearing + Math.PI / 2 + sgn * 0.12);
      o.scale.setScalar(1.6 + (i % 3) * 0.35);
    }
    if (i === 6) put(chain, dx + across.x * 1.2, dz + across.y * 1.2, bearing);
  }

  for (const m of mergeStatic(statics)) group.add(m);

  return {
    group,
    /** Where the snare is, in world space. The interact point and the toast. */
    centre: new THREE.Vector3(at.x, base, at.z),
    /** Bearing the drag runs off on, so the story can point the crossing. */
    bearing,
    setVisible(v) { group.visible = v; },
    dispose() { scene.remove(group); },
  };
}

// --- Hollow Stack -----------------------------------------------------------

/** The hub. A sea stack with a hollow in it that a dragon moved into. */
export async function buildHollowStack(scene, at, { ground = 0 } = {}) {
  const group = new THREE.Group();
  group.position.set(at.x, ground, at.z);
  scene.add(group);

  const [shelter, shelf, rack] = await Promise.all(
    ["stack_shelter", "stack_lab_shelf", "stack_fish_rack"].map(prop)
  );

  const sh = shelter.clone(true); sh.position.set(0, 0, 0);
  group.add(sh);

  const sl = shelf.clone(true); sl.position.set(6, 0, -4);
  group.add(sl);

  const rk = rack.clone(true); rk.position.set(-6, 0, 4);
  group.add(rk);

  // A fire, so the place reads as somewhere somebody lives.
  const fire = new THREE.PointLight(0xff8a3a, 40, 34, 1.7);
  fire.position.set(0, 1.1, 5);
  group.add(fire);
  const coals = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 8),
    slots().ember.clone()
  );
  coals.position.copy(fire.position);
  group.add(coals);

  let t = 0;
  return {
    group,
    centre: new THREE.Vector3(at.x, ground, at.z),
    lab: new THREE.Vector3(at.x + 6, ground, at.z - 4),
    bed: new THREE.Vector3(at.x, ground, at.z),
    update(dt) {
      t += dt;
      fire.intensity = 40 * (0.85 + Math.sin(t * 6.1) * 0.07 + Math.sin(t * 2.3) * 0.08);
    },
    setVisible(v) { group.visible = v; },
    dispose() { scene.remove(group); },
  };
}
