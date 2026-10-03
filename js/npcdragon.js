import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { bindDragon, wingRoots } from "./dragonrig.js";
import { setupWings } from "./wings.js";
import { setupFlightRig } from "./flightrig.js";

// ---------------------------------------------------------------------------
// The other dragons in the story: Sigrún and Eyvi.
//
// The game has one dragon model, so these are it re-dressed. The bible calls
// Sigrún a Stormcutter — four wings, owl-like, burnt orange — and there is no
// such model, so she is the Night Fury's body half again his size and
// re-coloured warm: bigger, browner, and unmistakably not him. Eyvi is a third
// his size and pale. (The placeholder art rule in STORY.md allows exactly this:
// right size, right colour, wrong species, swap later.)
//
// Each has two bodies, because the rigs that pose them disagree about the
// bones: a PERCHED one held in the ground fold, and a FLYING one with the
// wing beat. Only one is shown at a time; `perch()` and `flyTo()` switch.
// ---------------------------------------------------------------------------

function tinted(template, scale, tint, mix) {
  const obj = cloneSkinned(template);
  obj.rotation.order = "YXZ";
  obj.scale.setScalar(scale);
  const c = new THREE.Color(tint);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const mats = [].concat(o.material).map((m) => {
      const n = m.clone();
      if (n.color) n.color.lerp(c, mix);
      if (n.map) n.color.multiply(new THREE.Color(1, 1, 1).lerp(c, mix * 0.8));
      return n;
    });
    o.material = mats.length === 1 ? mats[0] : mats;
  });
  return obj;
}

/**
 * @param {object} o
 *   template  an untouched clone of the dragon (bones at rest)
 *   scale, tint, mix   size and colour
 *   tuning    the wing-beat tuning main.js uses
 */
export function createNpcDragon(scene, { template, actor = null, scale = 1, tint = 0xffffff, mix = 0.5, tuning, name = "npc" }) {
  if (actor) return actorDragon(scene, actor, name);
  const perched = tinted(template, scale, tint, mix);
  perched.name = name + "-perched";
  const rig = bindDragon(perched);
  rig.snapFold(1);
  scene.add(perched);

  const flying = tinted(template, scale, tint, mix);
  flying.name = name + "-flying";
  let skel = null;
  flying.traverse((o) => { if (o.isSkinnedMesh) skel = o.skeleton; });
  const wing = wingRoots(skel);
  const updateWings = wing ? setupWings(wing[0], wing[1], tuning) : null;
  const flightRig = setupFlightRig(flying);
  flying.visible = false;
  scene.add(flying);

  const state = {
    mode: "perched",
    pos: new THREE.Vector3(),
    heading: 0,
    target: null,
    speed: 0,
    onArrive: null,
    hidden: false,
    droop: 0,          // the broken wing, 0..1
    bob: 0,
  };
  let t = 0;

  const api = {
    perched, flying, state,
    get pos() { return state.pos; },

    /** Put her down at a spot, facing a bearing. */
    perch(pos, heading = 0) {
      state.mode = "perched";
      state.pos.copy(pos);
      state.heading = heading;
      state.target = null;
      perched.visible = !state.hidden;
      flying.visible = false;
    },

    /** Fly to a point at a speed; `onArrive` once she is there. */
    flyTo(pos, speed = 45, onArrive = null) {
      if (state.mode === "perched") {
        flying.position.copy(perched.position);
      }
      state.mode = "flying";
      state.target = pos.clone();
      state.speed = speed;
      state.onArrive = onArrive;
      perched.visible = false;
      flying.visible = !state.hidden;
    },

    setVisible(v) {
      state.hidden = !v;
      perched.visible = v && state.mode === "perched";
      flying.visible = v && state.mode === "flying";
    },

    /** The broken wing hangs: 0 healed, 1 broken. */
    setDroop(v) { state.droop = v; },

    update(dt) {
      t += dt;
      if (state.mode === "perched") {
        perched.position.copy(state.pos);
        // Breathing, and the slow look-round a wary animal does.
        perched.position.y += Math.sin(t * 1.3) * 0.04 * scale;
        perched.rotation.set(0, state.heading + Math.PI + Math.sin(t * 0.21) * 0.12,
          state.droop * 0.12);
        rig.update(dt, { speed: 0 });
        return;
      }
      // Flying: steer straight for the target, bank into turns, settle at it.
      const to = state.target;
      if (!to) return;
      const dx = to.x - state.pos.x, dy = to.y - state.pos.y, dz = to.z - state.pos.z;
      const d = Math.hypot(dx, dy, dz);
      const want = Math.atan2(dx, dz);
      let dh = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading));
      state.heading += dh * Math.min(1, dt * 2.2);
      const step = Math.min(d, state.speed * dt);
      if (d > 0.01) state.pos.addScaledVector(new THREE.Vector3(dx, dy, dz).normalize(), step);
      flying.position.copy(state.pos);
      flying.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.5, state.heading + Math.PI,
        -dh * 0.8);
      const st = {
        climb: THREE.MathUtils.clamp(dy / Math.max(d, 1) * 2, -1, 1),
        speedT: THREE.MathUtils.clamp((state.speed - 22) / 60, 0, 1),
        knife: 0,
        turn: THREE.MathUtils.clamp(-dh, -1, 1),
      };
      if (updateWings) {
        updateWings(dt, st);
        if (flightRig) flightRig(dt, st, updateWings.getBeat());
      }
      if (d < 3) {
        const cb = state.onArrive;
        state.onArrive = null;
        if (cb) cb();
      }
    },

    dispose() { scene.remove(perched); scene.remove(flying); },
  };
  return api;
}

// The same api over a dragonkit.js actor — a real model of the species, when
// one is on disk. One body does both: it folds to perch and beats to fly.
function actorDragon(scene, actor, name) {
  const body = actor.root;
  body.name = name;
  body.rotation.order = "YXZ";
  scene.add(body);
  const state = {
    mode: "perched", pos: new THREE.Vector3(), heading: 0, target: null,
    speed: 0, onArrive: null, hidden: false, droop: 0,
  };
  let t = 0;
  const _d = new THREE.Vector3();
  const api = {
    perched: body, flying: body, state, actor,
    get pos() { return state.pos; },
    perch(pos, heading = 0) {
      state.mode = "perched";
      state.pos.copy(pos);
      state.heading = heading;
      state.target = null;
      actor.setMode("idle");
      body.visible = !state.hidden;
    },
    flyTo(pos, speed = 45, onArrive = null) {
      state.mode = "flying";
      state.target = pos.clone();
      state.speed = speed;
      state.onArrive = onArrive;
      actor.setMode("fly");
      body.visible = !state.hidden;
    },
    setVisible(v) { state.hidden = !v; body.visible = v; },
    setDroop(v) { state.droop = v; actor.setDroop(v); },
    update(dt) {
      t += dt;
      if (state.mode === "perched") {
        body.position.copy(state.pos);
        body.rotation.set(0, state.heading + Math.sin(t * 0.21) * 0.12, state.droop * 0.1);
      } else if (state.target) {
        const to = state.target;
        _d.subVectors(to, state.pos);
        const d = _d.length();
        const want = Math.atan2(_d.x, _d.z);
        const dh = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading));
        state.heading += dh * Math.min(1, dt * 2.2);
        if (d > 0.01) state.pos.addScaledVector(_d.normalize(), Math.min(d, state.speed * dt));
        body.position.copy(state.pos);
        body.rotation.set(-Math.atan2(to.y - state.pos.y, Math.hypot(to.x - state.pos.x, to.z - state.pos.z)) * 0.5,
          state.heading, -dh * 0.8);
        if (d < 3) {
          const cb = state.onArrive;
          state.onArrive = null;
          if (cb) cb();
        }
      }
      if (body.visible) actor.update(dt);
    },
    dispose() { scene.remove(body); },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Sleepfire, small: the hatchling's purge. A puff of hot light from the mouth
// of a sleeping dragon — tiny, harmless, three times a night — which is the
// thing he has never noticed adults doing because they do it hugely and in
// private (STORY.md, Scene 11e).
// ---------------------------------------------------------------------------
export function createPuffs(scene) {
  const mat = new THREE.SpriteMaterial({
    color: 0xffb070, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0,
  });
  const sprites = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(mat.clone());
    s.visible = false;
    scene.add(s);
    sprites.push({ s, t: 0 });
  }
  const light = new THREE.Sprite(mat.clone());
  return {
    /** A puff at a point. */
    puff(pos, size = 1.6) {
      const p = sprites.find((x) => x.t <= 0) || sprites[0];
      p.t = 1;
      p.s.position.copy(pos);
      p.s.scale.setScalar(size);
      p.s.visible = true;
    },
    update(dt) {
      for (const p of sprites) {
        if (p.t <= 0) continue;
        p.t = Math.max(0, p.t - dt * 1.4);
        p.s.material.opacity = Math.sin(p.t * Math.PI) * 0.95;
        p.s.scale.multiplyScalar(1 + dt * 0.8);
        p.s.position.y += dt * 0.6;
        if (p.t <= 0) p.s.visible = false;
      }
    },
  };
}
