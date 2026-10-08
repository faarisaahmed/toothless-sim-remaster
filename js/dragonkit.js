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
//   "storm"  the Stormcutter: its own skeleton, re-chained and moved onto
//            the body by build_dragons.py (it came flat: a hundred siblings).
//            Four wings, a tail, a neck: posed joint by joint in stormRig().
//   "bip"    the Nadder and the Gronckle: a 3ds Max biped rig with thirty
//            animations of its own, which are simply played.
//
// Missing files are fine: loadKit() resolves null and the caller keeps its
// fallback (the re-coloured Night Fury). Where they come from, and their
// CC-BY credits: tools/dragons/, assets/models/dragons/CREDITS.txt.
// ---------------------------------------------------------------------------

const BASE = "./assets/models/dragons/";
/** In-place clips a resting biped rig cycles through (the ones that exist). */
const RESTLESS = ["idle01", "idle02", "Vigilance", "F_idle_daze", "touch01", "idle01_1", "F_idle01"];
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
    // The Nadder and the Gronckle come flagged unlit (their textures have
    // the lighting painted in), which three draws as MeshBasicMaterial: lit
    // the same at midnight as at noon, so in a dark pit they glowed. Give
    // them a real surface.
    o.material = [].concat(o.material).map((m) => {
      if (!m.isMeshBasicMaterial) return m;
      return new THREE.MeshStandardMaterial({
        map: m.map, color: m.color, side: m.side, transparent: m.transparent,
        alphaTest: m.alphaTest, roughness: 0.82, metalness: 0,
      });
    });
    if (o.material.length === 1) o.material = o.material[0];
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
    // The first clip goes straight in at full weight: the body is measured on
    // it, and a fade from nothing would measure the rest pose instead.
    next.reset().setEffectiveWeight(1);
    if (playing) next.fadeIn(0.4);
    next.play();
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
  // Pinning the pelvis lets the legs wander: a clip that crouches pulls the
  // feet up off the ground instead of the body down onto them. So the feet
  // are put back on the floor after, by the lowest foot bone.
  const feet = [];
  if (pelvis) body.traverse((o) => { if (o.isBone && /(Foot|Toe0)_/.test(o.name)) feet.push(o); });
  const _fp = new THREE.Vector3();
  const footY = () => {
    let lo = Infinity;
    for (const f of feet) lo = Math.min(lo, inner.worldToLocal(f.getWorldPosition(_fp)).y);
    return lo;
  };
  let foot0 = null;
  function pin(ground) {
    body.updateMatrixWorld(true);
    // M: pelvis relative to inner. Want it at anchor: B' = A * M^-1 * B.
    _m.copy(inner.matrixWorld).invert().multiply(pelvis.matrixWorld).invert();
    _m.premultiply(anchor).multiply(body.matrix);
    _m.decompose(body.position, body.quaternion, body.scale);
    if (ground && feet.length && foot0 !== null) {
      body.updateMatrixWorld(true);
      body.position.y += foot0 - footY();
    }
  }
  if (pelvis && feet.length) { root.updateMatrixWorld(true); foot0 = Math.max(footY(), 0); }

  // --- rest pose, captured once ---------------------------------------------
  // (root is still at the identity here, so world IS the actor's frame.)
  root.updateMatrixWorld(true);
  const rest = new Map();
  body.traverse((o) => {
    if (!o.isBone) return;
    const P = o.parent.getWorldQuaternion(new THREE.Quaternion());
    const w = o.getWorldPosition(new THREE.Vector3());
    rest.set(o, { q: o.quaternion.clone(), p: o.position.clone(), P, Pi: P.clone().invert(), x: w.x, w });
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

  const state = { mode: "idle", t: Math.random() * 10, beat: 0, droop: 0, flapRate: 1.6, next: 0 };
  const storm = kit.kind === "storm" ? stormRig({ body, root, inner, rest, turn, state, length }) : null;

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
      }
    }
    // The tail sways; the neck looks round, slowly.
    const sway = state.mode === "fly" ? 0.08 : 0.16;
    tails.forEach((b, i) => {
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
      state.next = 0;
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
      // A caged animal does not stand still: every so often it shifts, looks
      // round, paws at the bars, sags. The rigs with clips go through theirs.
      if (mixer && state.mode !== "fly") {
        state.next -= dt;
        if (state.next <= 0) {
          state.next = 4 + Math.random() * 7;
          const pool = RESTLESS.filter((n) => actions[n]);
          if (pool.length) play([pool[Math.floor(Math.random() * pool.length)]]);
        }
      }
      if (mixer) { mixer.update(dt); if (pelvis) pin(state.mode !== "fly"); }
      if (storm) storm.pose(dt);
      else if (kit.kind !== "bip") poseWings();
    },
  };
  actor.setMode("idle");
  return actor;
}

// ---------------------------------------------------------------------------
// The Stormcutter, joint by joint.
//
// build_dragons.py gives her a real skeleton: pelvis > spine > neck > head,
// pelvis > six tail bones, pelvis > legs, and four wings, each spine >
// (shoulder) > arm > forearm > hand > four two-bone fingers and two membrane
// flaps. Every joint here is a turn in the actor's frame (+X her left, +Y up,
// +Z her nose) on top of its rest pose, carried along by its parent's turn —
// so "about Y" at the wrist means about the wing's own surface normal,
// wherever the arm has put it.
//
// The rest pose is the wing spread flat and level. From it:
//   FOLDING is in the wing's own plane (elbow forward, wrist back, the fingers
//   closed up like a fan), and then the whole folded wing is swung back and
//   rolled down onto the flank at the shoulder. The upper wings lie over the
//   lower ones.
//   THE BEAT is a lift about the nose axis at the shoulder; each joint further
//   out follows the one before it a little late, so the bend runs out along
//   the wing, and on the upstroke the wing half folds. The two pairs are out
//   of step; the tail and neck move against the body's heave.
//   THE BROKEN WING (her left upper, under setDroop) hangs half open, rolled
//   down until the fingertips drag, and swings slack with her breathing.
// ---------------------------------------------------------------------------
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const Qx = (a) => new THREE.Quaternion().setFromAxisAngle(AX, a);
const Qy = (a) => new THREE.Quaternion().setFromAxisAngle(AY, a);
const Qz = (a) => new THREE.Quaternion().setFromAxisAngle(AZ, a);
/** Turn by a, then b, then c: c * b * a. */
const Q3 = (c, b, a) => c.multiply(b).multiply(a);
const lerp = THREE.MathUtils.lerp;
const ease = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

// Wing poses. sweep: back, in the wing plane, at the shoulder. lift: up about
// the nose axis (negative rolls a folded wing down the flank). twist: leading
// edge down. elbow: forearm folded forward. wrist: hand folded back. close:
// fingers fanned shut (0 open .. 1 together). bendE/W/F/T: out-of-plane bend
// at elbow, wrist, finger root, finger tip (the beat's lag).
const FOLD_UPPER = { sweep: 1.42, lift: -0.9, twist: -0.1, elbow: 2.75, wrist: 2.85, close: 1, bendE: 0, bendW: -0.05, bendF: -0.08, bendT: -0.22 };
const FOLD_LOWER = { sweep: 1.38, lift: -1.25, twist: -0.1, elbow: 2.75, wrist: 2.85, close: 1, bendE: 0, bendW: -0.05, bendF: -0.08, bendT: -0.22 };
const BROKEN = { sweep: 0.6, lift: -0.42, twist: -0.3, elbow: 0.55, wrist: 0.45, close: 0.15, bendE: 0, bendW: -0.22, bendF: -0.15, bendT: -0.15 };
const WING_KEYS = Object.keys(FOLD_UPPER);
/** The pose tables, for tuning from a test page (stormcheck.html). */
export const STORM_POSES = { FOLD_UPPER, FOLD_LOWER, BROKEN };

function stormRig({ body, root, inner, rest, turn, state, length }) {
  const B = (k) => findBone(body, new RegExp(`^Bone_${k}_\\d`));
  const all = [];
  body.traverse((o) => { if (o.isBone && rest.has(o)) all.push(o); });
  const ID = new THREE.Quaternion();

  // A big animal beats slowly: 0.55 Hz at thirteen metres, quicker small.
  state.flapRate = 0.55 * Math.sqrt(13 / Math.max(length, 1));

  const wings = [];
  for (const [tag, s, upper] of [["Lu", 1, 1], ["Ll", 1, 0], ["Ru", -1, 1], ["Rl", -1, 0]]) {
    const w = { s, upper, broken: tag === "Lu", arm: B(`${tag}_Arm`), fore: B(`${tag}_ForeArm`), hand: B(`${tag}_Hand`),
      fingers: [], flaps: [] };
    if (!w.arm || !w.fore || !w.hand) continue;
    // How far back each finger fans at rest, in the wing plane: closing the
    // fan turns each one forward by that much, onto the leading finger.
    const fan = (from, to) => { const d = to.clone().sub(from); return Math.atan2(-d.z, d.x * s); };
    let a0 = null;
    for (const f of "ABCD") {
      const a = B(`${tag}_WingFinger${f}01`), b = B(`${tag}_WingFinger${f}02`);
      if (!a || !b) continue;
      const ang = fan(rest.get(a).w, rest.get(b).w);
      if (a0 === null) a0 = ang;
      w.fingers.push({ a, b, ang: ang - a0, k: "ABCD".indexOf(f) });
    }
    for (const f of "BC") {
      const fl = B(`${tag}_WingFingerFlap${f}01`);
      if (fl) w.flaps.push({ b: fl, ang: fan(rest.get(w.hand).w, rest.get(fl).w) - (a0 ?? 0) });
    }
    wings.push(w);
  }
  const tail = [1, 2, 3, 4, 5, 6].map((i) => B(`M_Tail0${i}`)).filter(Boolean);
  const pelvis = B("M_Pelvis"), spine = B("M_Spine01"), neck = B("M_Neck01"), head = B("M_Head"), jaw = B("M_Jaw");
  const legs = ["L", "R"].map((s) => ({ up: B(`${s}_UpLeg`), leg: B(`${s}_Leg`), tar: B(`${s}_Tarsal`), foot: B(`${s}_Foot`) }))
    .filter((l) => l.up && l.leg && l.tar && l.foot);
  const fins = [];
  for (const [k, s] of [["L", 1], ["R", -1]]) for (const f of ["A", "C"]) { const b = B(`${k}_Pelvicfin${f}01`); if (b) fins.push({ b, s, k: f === "A" ? 1 : 0.8 }); }
  const lids = ["Lu", "Ru"].map((s) => B(`${s}_Eyelid`)).filter(Boolean);
  const _v = new THREE.Vector3();
  const footY = () => {
    let lo = Infinity;
    for (const l of legs) lo = Math.min(lo, inner.worldToLocal(l.foot.getWorldPosition(_v)).y);
    return lo;
  };
  root.updateMatrixWorld(true);
  const foot0 = legs.length ? footY() : 0;
  const body0 = body.position.clone();

  // Blends, eased so a change of mode is a movement, not a cut.
  const m = { t: 0, fly: 0, sleep: 0, droop: 0, curl: 0.3, look: { yaw: 0, pitch: 0 }, want: { yaw: 0, pitch: 0 }, nextLook: 0, blink: 3 };

  /** turn(), about the PARENT's joint rather than the bone's own: the
   *  fingers and membrane flaps sit off the hand, and fan round the wrist. */
  const _d = new THREE.Quaternion();
  function turnAbout(bone, q) {
    const r = rest.get(bone);
    _d.copy(r.Pi).multiply(q).multiply(r.P);
    bone.quaternion.copy(_d).multiply(r.q);
    bone.position.copy(r.p).applyQuaternion(_d);
  }

  function poseWing(w, p, broken) {
    const s = w.s;
    turn(w.arm, Q3(Qx(p.twist), Qz(s * p.lift), Qy(s * p.sweep)));
    turn(w.fore, Q3(Qz(s * p.bendE), Qy(-s * p.elbow), ID.clone()));
    turn(w.hand, Q3(Qz(s * p.bendW), Qy(s * p.wrist), ID.clone()));
    for (const f of w.fingers) {
      // Closed, the fingers lie a hair apart rather than through each other.
      const shut = -s * (f.ang - f.k * 0.035) * p.close;
      const slack = broken ? Math.sin(m.t * 0.9 - f.k * 0.6) * 0.03 * broken - f.k * 0.03 * broken : 0;
      turnAbout(f.a, Q3(Qz(s * (p.bendF + slack)), Qy(shut), ID.clone()));
      turn(f.b, Qz(s * p.bendT * (1 + f.k * 0.25)));
    }
    for (const f of w.flaps) turnAbout(f.b, Q3(Qz(s * p.bendF), Qy(-s * f.ang * p.close * 0.97), ID.clone()));
  }

  // One wing's pose at a point in the beat. L is the wing's angle above level
  // as the stroke goes; each joint further out takes it a little later.
  const L = (ph, amp) => 0.1 + amp * Math.sin(ph);
  function flyPose(ph, amp, out) {
    const up = 0.5 + 0.5 * Math.cos(ph);       // 1 mid-upstroke, 0 mid-downstroke
    const l0 = L(ph, amp), l1 = L(ph - 0.45, amp), l2 = L(ph - 0.95, amp * 1.05);
    const l3 = L(ph - 1.4, amp * 1.1), l4 = L(ph - 1.8, amp * 1.1);
    out.sweep = 0.12 + 0.32 * up;
    out.lift = l0;
    out.twist = -0.16 * Math.cos(ph) + 0.04;
    out.elbow = 0.15 + 0.6 * up;
    out.wrist = 0.1 + 0.95 * up;
    out.close = 0.08 + 0.5 * up;
    out.bendE = l1 - l0;
    out.bendW = l2 - l1 - 0.12 * up;
    out.bendF = l3 - l2;
    out.bendT = (l4 - l3) * 0.8;
    return out;
  }

  const tmp = {}, tmpF = {};
  function pose(dt) {
    const t = (m.t = state.t);
    const flying = state.mode === "fly", sleeping = state.mode === "sleep";
    m.fly = ease(m.fly, flying ? 1 : 0, 2.2, dt);
    m.sleep = ease(m.sleep, sleeping ? 1 : 0, 0.8, dt);
    m.droop = ease(m.droop, state.droop, 1.5, dt);
    const f = m.fly, sl = m.sleep * (1 - f), idle = (1 - f) * (1 - sl);
    const ph = state.beat;

    for (const b of all) { const r = rest.get(b); b.quaternion.copy(r.q); b.position.copy(r.p); }

    // Breath: a slow swell through the chest, deeper asleep.
    const breath = Math.sin(t * (2 * Math.PI) / lerp(3.6, 5.5, sl));

    // --- wings
    for (const w of wings) {
      const fold = w.upper ? FOLD_UPPER : FOLD_LOWER;
      flyPose(ph - (w.upper ? 0 : 1.35), w.upper ? 0.62 : 0.55, tmpF);
      const broken = w.broken ? m.droop : 0;
      for (const k of WING_KEYS) {
        const rp = broken ? lerp(fold[k], BROKEN[k], broken) : fold[k];
        let fp = tmpF[k];
        // A broken wing in the air beats shallow and half shut.
        if (broken && k === "lift") fp = lerp(fp, 0.05 + (fp - 0.1) * 0.35, broken);
        tmp[k] = lerp(rp, fp, f);
      }
      // At rest the folded wings rise and settle with her breathing; the
      // broken one swings slack a moment after.
      tmp.lift += (1 - f) * (breath * 0.012 + (w.broken ? Math.sin(t * 0.9 - 0.8) * 0.025 * broken : 0));
      tmp.lift -= sl * 0.08 * (w.upper ? 0.5 : 1);
      poseWing(w, tmp, broken * (1 - f));
    }

    // --- body: breathing, and the slow shift of weight from foot to foot.
    const shift = Math.sin(t * 0.21) * idle;
    const curlSide = Math.sign(m.curl) || 1;
    if (spine) turn(spine, Q3(Qy(shift * 0.05 - sl * 0.25 * curlSide), Qz(shift * 0.035), Qx(breath * 0.015 - 0.03 * f)));
    const qp = Q3(Qy(shift * 0.035 + sl * 0.12 * curlSide), Qz(-shift * 0.03), ID.clone());
    if (pelvis) turn(pelvis, qp);
    const qpi = qp.clone().invert();

    // --- legs: kept upright under a turning hip; tucked back in the air,
    // folded under her asleep.
    for (const l of legs) {
      turn(l.up, qpi.clone().multiply(Qx(1.05 * f - 1.0 * sl)));
      turn(l.leg, Qx(0.3 * f + 0.2 * sl));
      turn(l.tar, Qx(0.45 * f + 1.2 * sl));
      turn(l.foot, Qx(0.7 * f - 0.4 * sl));
    }

    // --- the hip fins: laid back along the tail at rest, spread in the air.
    for (const fn of fins) {
      const back = lerp(0.95, 0.15 + 0.1 * Math.sin(ph - 1), f) * fn.k, down = lerp(-0.35, 0.05 * Math.sin(ph - 1.5), f);
      turn(fn.b, Q3(Qz(fn.s * down), Qy(fn.s * back), ID.clone()));
    }

    // --- tail: a travelling wave, a curl that wanders, lowered at rest.
    m.curl = lerp(m.curl, 0.3 + Math.sin(t * 0.05) * 0.5, sl > 0.5 ? 0 : 0.002);
    tail.forEach((b, i) => {
      const k = i / Math.max(1, tail.length - 1);
      const wave = Math.sin(t * lerp(1.05, 0.5, sl) - i * 0.75) * (0.035 + 0.05 * k) * lerp(1, 0.25, sl);
      const fwave = Math.sin(ph + Math.PI - i * 0.6) * (0.03 + 0.04 * k);
      const yaw = lerp(m.curl * (0.06 + 0.05 * k) + wave, curlSide * 0.6, sl) * (1 - f) + f * Math.sin(t * 0.7 - i * 0.6) * 0.025;
      const pitch = (1 - f) * (i === 0 ? -0.2 : i === 1 ? -0.12 : 0.05) + f * (fwave + (i === 0 ? 0.04 : 0));
      turn(b, Q3(Qy(yaw), Qx(pitch), ID.clone()));
    });

    // --- neck and head: she looks about, slowly; asleep, chin to the ground.
    m.nextLook -= dt;
    if (m.nextLook <= 0) {
      m.nextLook = 2.5 + Math.random() * 4.5;
      m.want.yaw = (Math.random() * 2 - 1) * 0.7;
      m.want.pitch = -0.12 + Math.random() * 0.32;
    }
    m.look.yaw = ease(m.look.yaw, m.want.yaw, 1.4, dt);
    m.look.pitch = ease(m.look.pitch, m.want.pitch, 1.4, dt);
    const lyaw = lerp(m.look.yaw * idle, -curlSide * 0.9, sl);
    const lpitch = lerp(m.look.pitch * idle + breath * 0.01, 0.42, sl) - f * (Math.sin(ph) * 0.07 + 0.05);
    if (neck) turn(neck, Q3(Qy(lyaw * 0.45), Qx(lpitch * 0.5 + sl * 0.12), ID.clone()));
    if (head) turn(head, Q3(Qy(lyaw * 0.55), Qx(lpitch * 0.5), Qz(curlSide * 0.25 * sl)));
    if (jaw) turn(jaw, Qx(-0.04 * Math.max(0, breath) * idle));
    // Blinks; asleep, the eyes shut.
    m.blink -= dt;
    if (m.blink < -0.15) m.blink = 2 + Math.random() * 5;
    const shut = Math.max(sl, m.blink < 0 ? 1 : 0);
    for (const lid of lids) turn(lid, Qx(shut * 0.9));

    // --- the body: on its feet at rest, heaving with the beat in the air.
    body.position.copy(body0);
    if (legs.length && f < 1) {
      root.updateMatrixWorld(true);
      body.position.y += (foot0 - footY()) * (1 - f);
    }
    body.position.y += f * -Math.sin(ph - 0.4) * 0.012 * length / inner.scale.y;
  }
  return { pose };
}
