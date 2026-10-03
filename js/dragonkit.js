import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// ---------------------------------------------------------------------------
// The other dragons: models, normalised and animated.
//
// The stand-in models (tools/dragons/) come from three different places and
// agree about nothing — scale, which way is forward, how the skeleton is laid
// out. This file makes them one thing: an ACTOR whose +Z is forward, whose
// origin is between its feet, which is a given length, and which can be told
// to idle, fold its wings, droop one, or fly.
//
// Three kinds of rig:
//   "auto"   the ones tools/dragons/build_dragons.py rigged: a proper
//            hierarchy with fixed names (Spine_, Neck_, Head, Tail_, WingL_,
//            WingR_). Posed bone by bone.
//   "storm"  the Stormcutter: every bone a direct child of one root, so a
//            wing is a set of siblings, and moving it means swinging all of
//            them round the shoulder together.
//   "bip"    the Nadder and the Gronckle: a 3ds Max biped rig with thirty
//            animations of its own, which are simply played.
//
// Missing files are fine: loadKit() resolves null and the caller keeps its
// fallback (the re-coloured Night Fury). The public build has none of these —
// see tools/dragons/fetch_dragons.py.
// ---------------------------------------------------------------------------

const BASE = "./assets/models/dragons/";
const loader = new GLTFLoader();
const kits = new Map();

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _w = new THREE.Vector3();
const _box = new THREE.Box3();

/** Load (once) and analyse a model. Resolves null if it is not on disk. */
export function loadKit(name) {
  if (kits.has(name)) return kits.get(name);
  const p = loader.loadAsync(BASE + name + ".glb").then((gltf) => {
    let kind = "auto";
    gltf.scene.traverse((o) => {
      if (!o.isBone) return;
      if (/^Bone_M_Head/.test(o.name)) kind = "storm";
      else if (/^Bip00\d/.test(o.name)) kind = "bip";
    });
    // A clip that moves a node outside the skeleton (the Gronckle's idle turns
    // the whole model upright) leaves it turned while it plays and snaps it
    // back when it stops — so the dragon swings away round some far pivot
    // every time the animation changes. Take the first frame as the node's
    // pose for good, and drop the track.
    for (const clip of gltf.animations) {
      clip.tracks = clip.tracks.filter((tr) => {
        const [node, prop] = tr.name.split(".");
        const o = gltf.scene.getObjectByName(node);
        if (!o || o.isBone) return true;
        if (prop === "quaternion") o.quaternion.fromArray(tr.values, 0);
        else if (prop === "position") o.position.fromArray(tr.values, 0);
        else if (prop === "scale") o.scale.fromArray(tr.values, 0);
        return false;
      });
    }
    return { name, gltf, kind };
  }).catch(() => null);
  kits.set(name, p);
  return p;
}

function findBone(root, re) {
  let f = null;
  root.traverse((o) => { if (!f && o.isBone && re.test(o.name)) f = o; });
  return f;
}

/** Put a freshly cloned body nose-forward, at a length, feet on the origin. */
function normalise(kit, body, length) {
  const inner = new THREE.Group();
  inner.add(body);
  inner.updateMatrixWorld(true);

  // Which way is the head? From the skeleton, nose bone minus tail bone.
  const head = findBone(body, kit.kind === "storm" ? /^Bone_M_Head/ : kit.kind === "bip" ? /Head_|HeadNub/ : /^Head$/);
  const tail = findBone(body, kit.kind === "storm" ? /^Bone_M_Tail06/ : kit.kind === "bip" ? /TailNub|Tail4|Tail3/ : /^Tail_5$/);
  let yaw = 0;
  if (head && tail) {
    const hp = head.getWorldPosition(new THREE.Vector3());
    const tp = tail.getWorldPosition(new THREE.Vector3());
    const d = hp.sub(tp);
    if (Math.hypot(d.x, d.z) > 1e-4) yaw = Math.atan2(d.x, d.z);
  }
  body.rotation.y -= yaw;
  inner.updateMatrixWorld(true);

  // Skinned bounds, so a rig in its rest pose measures what you actually see.
  _box.makeEmpty();
  body.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      o.computeBoundingBox();
      _box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    } else if (o.isMesh) {
      o.geometry.computeBoundingBox();
      _box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  const size = _box.getSize(new THREE.Vector3());
  const k = length / Math.max(size.z, 1e-3);
  inner.scale.setScalar(k);
  const c = _box.getCenter(new THREE.Vector3());
  body.position.x -= c.x; body.position.z -= c.z; body.position.y -= _box.min.y;
  return inner;
}

/**
 * Make an actor.
 * @param {object} o  length (m), tint (optional colour to push towards)
 */
export function createActor(kit, { length = 8, tint = null, mix = 0.35 } = {}) {
  const body = cloneSkinned(kit.gltf.scene);
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    if (tint !== null) {
      const c = new THREE.Color(tint);
      o.material = [].concat(o.material).map((m) => {
        const n = m.clone();
        if (n.color) n.color.lerp(c, mix);
        return n;
      });
      if (o.material.length === 1) o.material = o.material[0];
    }
  });
  // Animations, for the rigs that brought their own. Started BEFORE the body
  // is measured: these rigs' rest pose is nothing like the animated one (the
  // biped's root sits metres away, at another scale), so measuring at rest
  // puts the dragon somewhere else entirely once the clip plays.
  let mixer = null, actions = {};
  if (kit.gltf.animations.length) {
    mixer = new THREE.AnimationMixer(body);
    for (const clip of kit.gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  }
  let playing = null;
  const play = (names) => {
    if (!mixer) return;
    const name = names.find((n) => actions[n]);
    if (!name || playing === name) return;
    const next = actions[name];
    next.reset().fadeIn(playing ? 0.4 : 0).play();
    if (playing) actions[playing].fadeOut(0.4);
    playing = name;
  };
  play(["idle01", "idle02", Object.keys(actions)[0]]);
  if (mixer) mixer.update(0);

  const inner = normalise(kit, body, length);
  const root = new THREE.Group();
  root.add(inner);

  // The biped clips do not agree where the body is. Each one turns the
  // biped's root differently, and the pelvis hangs a long way off that root,
  // so changing clip swings the whole dragon round a point metres away (or
  // rolls it on its back). So the pelvis is pinned where the idle had it,
  // and only the limbs, neck and tail move.
  const pelvis = kit.kind === "bip" ? findBone(body, /Pelvis/) : null;
  let anchor = null;
  const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
  if (pelvis) {
    inner.updateMatrixWorld(true);
    anchor = _mi.copy(inner.matrixWorld).invert().multiply(pelvis.matrixWorld).clone();
  }
  function pin() {
    body.updateMatrixWorld(true);
    // M: pelvis relative to inner. Want it at anchor: B' = A * M^-1 * B.
    _m.copy(inner.matrixWorld).invert().multiply(pelvis.matrixWorld).invert();
    _m.premultiply(anchor).multiply(body.matrix);
    _m.decompose(body.position, body.quaternion, body.scale);
  }

  // --- rest pose, captured once ---------------------------------------------
  // (root is still at the identity here, so world IS the actor's frame.)
  root.updateMatrixWorld(true);
  const rest = new Map();
  body.traverse((o) => {
    if (!o.isBone) return;
    const P = o.parent.getWorldQuaternion(new THREE.Quaternion());
    rest.set(o, { q: o.quaternion.clone(), p: o.position.clone(), P, Pi: P.clone().invert(),
      x: o.getWorldPosition(new THREE.Vector3()).x });
  });

  // Wing sets: [{bones, pivot, side, upper}]
  const wings = [];
  const tails = [];
  const necks = [];
  if (kit.kind === "auto") {
    for (const side of [1, -1]) {
      const lab = side > 0 ? "L" : "R";
      const w0 = findBone(body, new RegExp(`^Wing${lab}_0$`));
      const w1 = findBone(body, new RegExp(`^Wing${lab}_1$`));
      const w2 = findBone(body, new RegExp(`^Wing${lab}_2$`));
      if (!w0 || !w2) continue;
      // The way the wing points at rest, which every model has different
      // (the Thunderdrum's are held straight up). Poses aim it, not turn it.
      const dir = w2.getWorldPosition(new THREE.Vector3()).sub(w0.getWorldPosition(new THREE.Vector3())).normalize();
      wings.push({ chain: [w0, w1].filter(Boolean), dir, side: Math.sign(rest.get(w0).x) || side });
    }
    for (let i = 0; i < 6; i++) { const b = findBone(body, new RegExp(`^Tail_${i}$`)); if (b) tails.push(b); }
    for (const pre of ["Neck", "NeckB"]) {
      for (let i = 0; i < 3; i++) { const b = findBone(body, new RegExp(`^${pre}_${i}$`)); if (b) necks.push(b); }
    }
  } else if (kit.kind === "storm") {
    // Each of the four wings: shoulder (upper pair only), arm, forearm, hand
    // and its fingers — all siblings, so the joints are applied by hand.
    for (const [tag, side, upper] of [["Lu", 1, 1], ["Ll", 1, 0], ["Ru", -1, 1], ["Rl", -1, 0]]) {
      const all = [], fore = [], hand = [];
      let sh = null, el = null, wr = null;
      body.traverse((o) => {
        if (!o.isBone) return;
        const m = o.name.match(new RegExp(`^Bone_${tag}_(Shoulder|Arm|ForeArm|Hand|Wing)`));
        if (!m) return;
        all.push(o);
        if (m[1] === "Shoulder" || (m[1] === "Arm" && !sh)) sh = o;
        if (m[1] === "ForeArm") { el = o; fore.push(o); }
        if (m[1] === "Hand") wr = o;
        if (m[1] === "Hand" || m[1] === "Wing") hand.push(o);
      });
      if (!all.length || !sh || !el || !wr) continue;
      const R = (b) => rest.get(b).p;
      wings.push({ all, fore: [...fore, ...hand], hand, sh: R(sh), el: R(el), wr: R(wr),
        side: Math.sign(rest.get(sh).x) || side, upper });
    }
    for (let i = 1; i <= 6; i++) { const b = findBone(body, new RegExp(`^Bone_M_Tail0${i}`)); if (b) tails.push(b); }
  }

  // --- posing helpers -------------------------------------------------------
  // Everything is posed in the actor's own frame (+Z nose, +Y up, +X its
  // left), as a change from the rest pose, against each bone's REST parent.
  // So a child's turn adds to its parent's, the way a skeleton does, and
  // where the actor is in the world never enters into it.
  const FWD = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

  /** Turn a bone by q (actor frame) on top of its rest pose. */
  function turn(bone, q) {
    const r = rest.get(bone);
    bone.quaternion.copy(r.Pi).multiply(q).multiply(r.P).multiply(r.q);
  }

  /** Turn a set of sibling bones, as they are now, round a pivot (parent
   *  space) by q (actor frame). */
  const _l = new THREE.Quaternion();
  function spin(bones, pivot, q) {
    const r0 = rest.get(bones[0]);
    _l.copy(r0.Pi).multiply(q).multiply(r0.P);
    for (const b of bones) {
      b.position.sub(pivot).applyQuaternion(_l).add(pivot);
      b.quaternion.premultiply(_l);
    }
  }

  const state = { mode: "idle", t: Math.random() * 10, beat: 0, droop: 0, flapRate: 1.6 };

  function poseWings() {
    for (const w of wings) {
      let lift = 0, sweep = 0;
      if (state.mode === "fly") {
        const ph = state.beat + (w.upper === 0 ? 0.6 : 0);
        lift = Math.sin(ph) * 0.65 + 0.1;
      } else {
        // Folded: down along the flank and swept back. A dragon at rest does
        // not stand with fifteen metres of wing held out.
        lift = -0.22 + Math.sin(state.t * 0.9) * 0.03;
        sweep = 1.35;
        if (w.all) { lift = w.upper ? 0.1 : -0.35; sweep = 1.0; }
        if (w.side > 0 && state.droop > 0) { lift -= state.droop * 0.45; sweep -= state.droop * 0.5; }
      }
      // Lift about the nose axis (+ raises the +X wing), then sweep about up
      // (+ takes the +X wing back), each signed by which side it is on.
      _q.setFromAxisAngle(FWD, lift * w.side);
      _q2.setFromAxisAngle(UP, sweep * w.side * 0.9);
      const q = _q2.clone().multiply(_q);
      if (w.chain) {
        const fly = state.mode === "fly";
        // Out to the side and beating, or back along the flank and a little
        // down; the broken one hangs lower and looser.
        const a = fly ? Math.sin(state.beat) * 0.6 + 0.1 : 0;
        const hang = !fly && w.side > 0 ? state.droop : 0;
        _w.set(fly ? w.side * Math.cos(a) : w.side * (0.32 + hang * 0.3),
               fly ? Math.sin(a) : -0.12 - hang * 0.5 + Math.sin(state.t * 0.9) * 0.01,
               fly ? -0.15 : -1).normalize();
        turn(w.chain[0], _q.setFromUnitVectors(w.dir, _w).clone());
        if (w.chain[1]) {
          // The outer wing trails the beat; folded, it tucks in to the body.
          const q1 = fly
            ? _q.setFromAxisAngle(FWD, Math.sin(state.beat - 0.8) * 0.3 * w.side)
            : _q.setFromAxisAngle(UP, -0.35 * w.side);
          turn(w.chain[1], q1.clone());
        }
      } else if (w.all) {
        // Joint by joint, outermost first, every pivot still where it rests.
        const s = w.side, fly = state.mode === "fly";
        for (const b of w.all) { const r = rest.get(b); b.position.copy(r.p); b.quaternion.copy(r.q); }
        if (fly) {
          spin(w.hand, w.wr, _q.setFromAxisAngle(FWD, Math.sin(state.beat - 1.2) * 0.35 * s));
          spin(w.fore, w.el, _q.setFromAxisAngle(FWD, Math.sin(state.beat - 0.7) * 0.25 * s));
        } else {
          // Folded the way a bat folds: forearm forward along the arm, hand
          // and fingers back along that, the whole thing laid on the flank.
          spin(w.hand, w.wr, _q.setFromAxisAngle(UP, 2.7 * s));
          spin(w.fore, w.el, _q.setFromAxisAngle(UP, -2.5 * s));
        }
        spin(w.all, w.sh, q);
      }
    }
    // The tail sways; the neck looks round, slowly.
    const sway = state.mode === "fly" ? 0.08 : 0.16;
    tails.forEach((b, i) => {
      if (kit.kind === "storm") return;      // siblings, not a chain: left alone
      turn(b, _q.setFromAxisAngle(UP, Math.sin(state.t * 0.8 - i * 0.5) * sway * (0.3 + i * 0.15)));
    });
    necks.forEach((b, i) => {
      turn(b, _q.setFromAxisAngle(UP, Math.sin(state.t * 0.31 + i) * 0.12));
    });
  }

  const actor = {
    root, kit, body,
    get mode() { return state.mode; },
    /** "idle" (folded, breathing), "sleep", or "fly" (beating). */
    setMode(m) {
      state.mode = m;
      if (kit.kind === "bip") {
        play(m === "fly" ? ["F_move01", "move01", "idle01"] : ["idle01", "idle02"]);
      }
    },
    /** Play a named clip (rigs that have them). */
    playClip(n) { play([n]); },
    /** The broken wing: 0 healed .. 1 hanging. */
    setDroop(v) { state.droop = v; },
    update(dt) {
      state.t += dt;
      state.beat += dt * state.flapRate * Math.PI * 2 * (state.mode === "fly" ? 1 : 0);
      if (mixer) { mixer.update(dt); if (pelvis) pin(); }
      if (kit.kind !== "bip") poseWings();
    },
  };
  actor.setMode("idle");
  return actor;
}
