import * as THREE from "three";
import { FOLD_POSE } from "./foldpose.js";

// ---------------------------------------------------------------------------
// Ground rig — folding, walking, breathing
//
// dragon_rigged_hd.glb ships with 152 bones and NO animation clips, so every
// pose in this game is made here, procedurally. The bone names are anatomical
// and consistent, which makes that tractable, and the older 95-bone
// toothless_rigged.glb answers to the same ones:
//
//   wings   Wing_ClavicleL/R  Wing_ShoulderL/R  Wing_UpperArmL/R
//           Wing_Finger001..018 L/R
//   front   Shoulder_ClavicleL/R  UpperArmL/R  ForearmL/R  WristL/R  Front_ToeL/R
//   rear    HipL/R  ThighL/R  ShinL/R  AnkleL/R  ToeL/R
//   spine   Spine  Neck001..003  Head  Tail001..011  Tail_tip
//
// Everything is applied as a delta on top of each bone's bind rotation, so the
// rig can be re-posed every frame without drifting.
//
// On dragon anatomy: a wing is an arm. Indoors, or walking, a dragon folds the
// wing arm back along its flank and collapses the finger struts so the membrane
// packs away — it does not walk around with its wings out any more than a bird
// does. On the ground he's a quadruped: the folded wings ride over the
// shoulders and the front feet carry the wrist. Hence a four-beat diagonal
// gait, and a fold pose that is on by default indoors.
// ---------------------------------------------------------------------------

// Folded-wing pose.
//
// For the 152-bone rig this is not authored as angles any more. It is solved —
// see tools/solve_fold.mjs — and baked into js/foldpose.js as one quaternion per
// wing bone, which this file slerps to.
//
// The angles came first and did not converge. A wing fold has an elbow, a wrist
// and eighteen digit joints that all interact; every constant fights every other
// one, a sign flip anywhere turns the fold into a crown of spikes, and the
// aggregate numbers you can measure are blind to the failure — span reads the
// same whether the fan is shut or wide open, because the widest point of a
// folded wing is the shoulder root, which the fold never moves. Three rounds of
// that ended with a wing hanging through the floor.
//
// The solver instead says where the bones should *be* — laid along the ribcage
// in a bat's Z-fold, humerus caudal, forearm flexed back on it, hand folded
// forward again, digits stacked down the flank rather than piled on one line —
// and enforces bone lengths, the ribcage and the ground as hard constraints. It
// cannot produce a wing that stretches, clips through his chest, or reaches the
// floor, which is what the hand tuning kept doing.
const FOLD_SAIL = 0.60;    // Tail_Sail_Strut Z, mirrored. Not part of the solved
                           // chain — it is the membrane's own root down his
                           // flank, so it just drops with the fold.

// The tail fins furl with the wings. A dragon at rest does not sit with his tail
// fanned any more than he sits with his wings out, and left in bind pose they
// are the single largest, palest thing in any grounded shot — indoors they fill
// half the frame and read as a sail, not a tail.
const FOLD_FIN = 0.55;     // Tail_Fin_Strut / _Tip X, graded along the fan

// There used to be a second stage here: past fold 0.55 the wing was PUT AWAY
// rather than folded — the outboard membrane primitive switched off and
// Wing_Shoulder scaled to 0.02, taking the arm and all eighteen digits with it.
// The reasoning was that the membrane is a single sheet under four-influence
// linear-blend skinning, cannot pleat, and creases into flat blades at any real
// fold angle.
//
// That reasoning was sound when the fold was hand-tuned angles. It stopped being
// true once the solver landed: the Z-fold it produces stacks the digits down the
// flank instead of piling them on one line, and the membrane gathers along the
// forearm rather than folding back through itself. Rendered with the collapse
// switched off it reads as a folded wing, which is the thing it is supposed to
// be — and the collapse read as the wings being deleted the moment he touched
// down, which is what it actually was.
//
// So it is gone. If a future pose does crease badly, the fix is the solver in
// tools/solve_fold.mjs, not hiding the geometry.
const MEMBRANE_MAT = "wing_membrane";

// --- the 95-bone fallback rig ----------------------------------------------
// toothless_rigged.glb has no wing elbow and no solved pose, so it keeps the
// original numbers, from probing that rig one bone and one axis at a time (see
// _probe.html). On that skeleton Wing_Finger.016-.018 is the main spar and
// digits 001-015 barely move the tip, which is why only the spar is driven.
// Measured spans, 3.4m dragon: spread 3.10, this pose 0.40.
const OLD_FOLD_SWEEP = 1.80;   // Wing_Shoulder Z — mirrored per side
const OLD_FOLD_ARM   = 1.00;   // Wing_UpperArm X
const OLD_FOLD_SPAR  = [1.10, 0.70, 0.35];   // Finger 016 / 017 / 018 X

// Gait. A walking quadruped moves diagonal pairs together: front-left with
// rear-right, then front-right with rear-left.
const STRIDE_FRONT = 0.42;   // radians of swing at the shoulder
const STRIDE_REAR  = 0.50;   // radians of swing at the hip
const KNEE_BEND    = 0.38;   // extra flex on the recovery half of the stride
const STEPS_PER_M  = 0.62;   // stride frequency per metre travelled

// Feet.
//
// A limb that only bends at the hip and the knee reads as a pendulum with a
// brick on the end, because the one thing a real foot does is *stay still* — it
// plants, and the animal rotates over the top of it while the ankle gives back
// exactly what the hip takes. That counter-rotation is the whole trick;
// everything else here is decoration on it.
const FOOT_LEVEL = 0.85;   // how much of the limb's swing the ankle gives back
const FOOT_LIFT  = 0.55;   // ankle flex while the foot is off the ground
const FOOT_PUSH  = 0.40;   // toe extension at the end of the stance, the shove
const TOE_CURL   = 0.45;   // toes curl up during the swing so they clear
const TOE_SPLAY  = 0.16;   // and spread a little under load

// Scratch for the fold, which turns bones about their own axes by quaternion.
const AXIS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const _q = new THREE.Quaternion();

/**
 * The two bones a wingbeat hangs off, whichever rig is loaded.
 *
 * There have been three skeletons on this mesh and they do not agree on names:
 * dragon_rigged.glb had seven bones called Bone000..006, and both Toothless
 * rigs use anatomical names. Rather than have main.js and flights.js each carry
 * their own guess, ask here.
 *
 * @param {THREE.Skeleton} skel
 * @returns {[THREE.Bone, THREE.Bone]|null} left then right, or null
 */
export function wingRoots(skel) {
  if (!skel) return null;
  const pairs = [
    ["Wing_ClavicleL", "Wing_ClavicleR"],   // toothless_rigged, dragon_rigged_hd
    ["Bone004", "Bone005"],                 // the old seven-bone dragon_rigged
  ];
  for (const [l, r] of pairs) {
    const bl = skel.getBoneByName(l);
    const br = skel.getBoneByName(r);
    if (bl && br) return [bl, br];
  }
  return null;
}

/**
 * Which way is his nose, in the model's own space?
 *
 * Returns +1 if the head sits toward local +Z, -1 if toward -Z. Exporters do
 * not agree on this and the wrong answer walks a dragon tail-first, so it is
 * measured off the skeleton — head versus mid-tail — rather than assumed.
 *
 * Call with the object the bones live under, already added to a parent or not;
 * world matrices are refreshed first.
 */
export function noseSign(root) {
  root.updateWorldMatrix(true, true);

  let head = null, tail = null;
  root.traverse((o) => {
    if (!o.isBone) return;
    if (o.name === "Head") head = o;
    if (o.name === "Tail005") tail = o;
  });
  if (!head || !tail) return 1;

  const h = new THREE.Vector3();
  const t = new THREE.Vector3();
  head.getWorldPosition(h);
  tail.getWorldPosition(t);

  // Express the tail→head vector in the root's own frame.
  const local = root.worldToLocal.bind(root);
  const hv = local(h.clone());
  const tv = local(t.clone());
  return (hv.z - tv.z) >= 0 ? 1 : -1;
}

export function bindDragon(root) {
  const bones = new Map();
  root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });

  // Bind pose, captured once. Every pose below is rest + delta.
  const rest = new Map();
  for (const [name, bone] of bones) rest.set(name, bone.rotation.clone());

  const get = (n) => bones.get(n) || null;

  // Keep the side with each bone — the fold mirrors, so L and R take opposite
  // signs on the Z component.
  const sided = (re) => [...bones.keys()].filter((n) => re.test(n))
    .map((n) => ({ bone: get(n), side: n.endsWith("L") ? 1 : -1 }));

  // The fold, flattened to a list of (bone, axis, radians-at-full-fold) once at
  // bind time. Which list depends on the skeleton, and after this nothing
  // downstream has to know or care which one it got.
  // `turns` is an ordered list of [axis, radians]. Order is load-bearing: the
  // shoulder has to roll down onto the flank BEFORE it sweeps back, because
  // once it has swung a hundred degrees round its local X points down the span
  // and the same roll becomes a twist that does nothing.
  const fold_ = [];
  const membrane_ = [];
  const shoulders = sided(/^Wing_Shoulder[LR]$/);
  const upperArms = sided(/^Wing_UpperArm[LR]$/);

  // A wing elbow only exists on the 152-bone rig, so it is the tell.
  const hd = bones.has("Wing_ForearmL") || bones.has("Wing_ForearmR");

  if (hd) {
    // The solved pose. Keys are glTF bone names; three strips the dots.
    for (const [raw, q] of Object.entries(FOLD_POSE)) {
      const bone = bones.get(raw.replace(/\./g, ""));
      if (!bone) continue;
      fold_.push({
        bone,
        restQ: bone.quaternion.clone(),
        // Where this fold started FROM. Normally the bind pose, but on
        // touchdown it is wherever the wingbeat happened to leave the bone —
        // see beginFold().
        fromQ: bone.quaternion.clone(),
        foldQ: new THREE.Quaternion(q[0], q[1], q[2], q[3]),
      });
    }
    for (const { bone, side } of sided(/^Tail_Sail_Strut_\d+[LR]$/)) {
      fold_.push({ bone, restQ: bone.quaternion.clone(), axis: "z", amount: FOLD_SAIL * side });
    }
    for (let i = 1; i <= 6; i++) {
      const n = String(i).padStart(3, "0");
      const k = (i - 1) / 5;
      for (const { bone } of sided(new RegExp(`^Tail_Fin_Strut${n}[LR]$`))) {
        fold_.push({ bone, restQ: bone.quaternion.clone(), axis: "x", amount: FOLD_FIN * (0.4 + k * 0.9) });
      }
      for (const { bone } of sided(new RegExp(`^Tail_Fin_Tip${n}[LR]$`))) {
        fold_.push({ bone, restQ: bone.quaternion.clone(), axis: "x", amount: FOLD_FIN * (0.3 + k * 0.6) });
      }
    }
    // glTF gives each material its own primitive, and three gives each
    // primitive its own mesh. The membrane is collected so the rig can prove it
    // is ON — see the visibility line in applyFold().
    root.traverse((o) => {
      const mats = o.isMesh ? [].concat(o.material) : [];
      if (mats.some((m) => m && m.name === MEMBRANE_MAT)) membrane_.push(o);
    });
  } else {
    for (const { bone, side } of shoulders) {
      fold_.push({ bone, euler: true, axis: "z", amount: OLD_FOLD_SWEEP * side });
    }
    for (const { bone } of upperArms) {
      fold_.push({ bone, euler: true, axis: "x", amount: OLD_FOLD_ARM });
    }
    ["016", "017", "018"].forEach((n, i) => {
      for (const { bone } of sided(new RegExp(`^Wing_Finger${n}[LR]$`))) {
        fold_.push({ bone, euler: true, axis: "x", amount: OLD_FOLD_SPAR[i] });
      }
    });
  }

  // The whole chain, not just the top two joints. `digits` is per-toe so they
  // can splay under load rather than moving as one lump.
  const digitsOf = (prefix, side) =>
    [1, 2, 3].map((i) => get(`${prefix}_Digit${String(i).padStart(3, "0")}${side}`)).filter(Boolean);

  const front = {
    L: { upper: get("UpperArmL"), fore: get("ForearmL"),
         ankle: get("WristL"), toe: get("Front_ToeL"), digits: digitsOf("Front", "L") },
    R: { upper: get("UpperArmR"), fore: get("ForearmR"),
         ankle: get("WristR"), toe: get("Front_ToeR"), digits: digitsOf("Front", "R") },
  };
  const rear = {
    L: { thigh: get("ThighL"), shin: get("ShinL"),
         ankle: get("AnkleL"), toe: get("ToeL"), digits: digitsOf("Hind", "L") },
    R: { thigh: get("ThighR"), shin: get("ShinR"),
         ankle: get("AnkleR"), toe: get("ToeR"), digits: digitsOf("Hind", "R") },
  };

  const spine = get("Spine");
  const head  = get("Head");
  const neck  = [get("Neck001"), get("Neck002"), get("Neck003")].filter(Boolean);
  const tail  = [];
  for (let i = 1; i <= 11; i++) {
    const b = get(`Tail${String(i).padStart(3, "0")}`);
    if (b) tail.push(b);
  }

  // Reset a bone to bind, then add a delta on one axis.
  function set(bone, axis, delta) {
    if (!bone) return;
    const r = rest.get(bone.name);
    if (!r) return;
    bone.rotation.set(r.x, r.y, r.z);
    bone.rotation[axis] += delta;
  }
  function add(bone, axis, delta) {
    if (!bone) return;
    bone.rotation[axis] += delta;
  }

  let fold = 1;            // 0 spread .. 1 folded
  let foldTarget = 1;
  // Closing is a settle and wants to be unhurried; opening happens as he leaps
  // and has to be done before the first downbeat, or he beats a folded wing.
  const FOLD_RATE_CLOSE = 3.2;
  const FOLD_RATE_OPEN  = 7.0;
  let phase = 0;           // gait phase, radians
  let moveAmt = 0;         // smoothed 0..1 "how much is he walking"

  function damp(l, dt) { return 1 - Math.exp(-l * dt); }

  /**
   * The wings, the tail sail and the tail fin — and nothing else.
   *
   * Split out from update() because the two run in different places. On the
   * ground update() drives everything. In the AIR, for the second or so after
   * he leaps, the flight rig owns the body but the wings are still opening, so
   * main.js runs this alone, after the flight rig, and it overwrites the beat
   * until the fold reaches zero. At zero it writes the bind pose exactly, which
   * is what the flight rig adds its deltas to — so the handover has no seam in
   * it and nothing has to cross-fade.
   *
   * @returns {number} the fold amount after this step, so the caller can tell
   *   when the wings are open and it can stop calling.
   */
  function applyFold(dt) {
    const rate = foldTarget > fold ? FOLD_RATE_CLOSE : FOLD_RATE_OPEN;
    fold += (foldTarget - fold) * damp(rate, dt);
    if (Math.abs(fold - foldTarget) < 0.001) fold = foldTarget;

    for (const f of fold_) {
      if (f.foldQ) f.bone.quaternion.slerpQuaternions(f.fromQ, f.foldQ, fold);
      else if (f.euler) set(f.bone, f.axis, f.amount * fold);
      else {
        f.bone.quaternion.copy(f.restQ)
          .multiply(_q.setFromAxisAngle(AXIS[f.axis], f.amount * fold));
      }
    }

    // The membrane stays on at every fold amount. Asserting it here rather than
    // trusting it: it was switched off in this exact spot for a long time, and a
    // wing that silently stops existing on touchdown is a hard bug to see in a
    // diff and an easy one to see in the game.
    for (const m of membrane_) if (!m.visible) m.visible = true;

    return fold;
  }

  /**
   * @param {number} dt
   * @param {object} s
   *   speed     metres/second along the ground
   *   maxSpeed  what counts as "full walk"
   */
  function update(dt, s = {}) {
    const speed = s.speed || 0;
    const maxSpeed = s.maxSpeed || 1.9;
    const t = THREE.MathUtils.clamp(speed / maxSpeed, 0, 1);

    moveAmt += (t - moveAmt) * damp(7, dt);

    // Stride frequency follows ground speed, so the feet never skate.
    phase += speed * STEPS_PER_M * Math.PI * 2 * dt;

    // Walking jostles a folded wing; a packed wing still shifts on the shoulder.
    const jostle = moveAmt > 0.01 ? Math.sin(phase * 2) * 0.05 * moveAmt : 0;
    applyFold(dt);

    for (const { bone } of shoulders) add(bone, "x", jostle);
    for (const { bone } of upperArms) add(bone, "x", jostle * 0.5);

    // --- Legs -------------------------------------------------------------
    // Diagonal pairs, half a cycle apart.
    const gait = [
      { leg: front.L, part: "upper", flex: "fore",  off: 0,          amp: STRIDE_FRONT },
      { leg: front.R, part: "upper", flex: "fore",  off: Math.PI,    amp: STRIDE_FRONT },
      { leg: rear.L,  part: "thigh", flex: "shin",  off: Math.PI,    amp: STRIDE_REAR  },
      { leg: rear.R,  part: "thigh", flex: "shin",  off: 0,          amp: STRIDE_REAR  },
    ];

    for (const g of gait) {
      const th = phase + g.off;
      const swing = Math.sin(th);
      // Knee/elbow only folds on the recovery half, which is what stops a
      // procedural walk looking like a pendulum.
      const recovery = Math.max(0, -Math.cos(th));
      const stance = 1 - recovery;              // 1 while the foot is planted

      const hipA = swing * g.amp * moveAmt;
      const kneeA = -recovery * KNEE_BEND * moveAmt;
      set(g.leg[g.part], "x", hipA);
      set(g.leg[g.flex], "x", kneeA);

      // The ankle gives back what the hip and knee take, but only while the
      // foot is down — so the sole stays flat and he rolls over the top of it
      // instead of the whole leg swinging like a bell.
      const level = -(hipA + kneeA) * FOOT_LEVEL * stance;
      // ...and flexes clear of the ground while it is not.
      const lift = recovery * FOOT_LIFT * moveAmt;
      set(g.leg.ankle, "x", level + lift);

      // The shove. A short spike late in the stance, as the foot leaves.
      const push = Math.max(0, Math.sin(th - 2.35)) * FOOT_PUSH * moveAmt;
      set(g.leg.toe, "x", push - recovery * TOE_CURL * moveAmt);

      // Toes spread under weight and close again in the air. Each one a little
      // different, because three toes moving identically reads as a hoof.
      const load = Math.max(0, Math.cos(th)) * moveAmt;
      g.leg.digits.forEach((d, i) => {
        set(d, "z", (i - 1) * TOE_SPLAY * load);
        add(d, "x", push * 0.5 - lift * 0.5);
      });
    }

    // --- Body -------------------------------------------------------------
    // Breathing always; a shoulder roll and a small vertical bob when walking.
    const breath = Math.sin(phase * 0.16 + 1.3) * 0.012;
    set(spine, "x", breath + Math.sin(phase * 2) * 0.02 * moveAmt);
    add(spine, "z", Math.sin(phase) * 0.035 * moveAmt);

    // Neck and head counter the bob slightly, so his head stays level — which
    // is what animals actually do and reads instantly as "alive".
    for (let i = 0; i < neck.length; i++) {
      set(neck[i], "x", -Math.sin(phase * 2) * 0.012 * moveAmt);
    }
    set(head, "x", -Math.sin(phase * 2) * 0.02 * moveAmt);
    add(head, "y", Math.sin(phase * 0.31) * 0.05);

    // --- Tail -------------------------------------------------------------
    // A wave travelling down the chain, always on, stronger when moving.
    for (let i = 0; i < tail.length; i++) {
      const k = i / tail.length;
      const wave = Math.sin(phase * 0.7 - k * 2.2) * (0.02 + 0.05 * moveAmt);
      set(tail[i], "y", wave);
      add(tail[i], "x", Math.sin(phase * 0.45 - k * 1.6) * 0.012);
    }
  }

  return {
    update,
    applyFold,
    /** 1 = wings folded against the body, 0 = fully spread. */
    setFold(v) { foldTarget = THREE.MathUtils.clamp(v, 0, 1); },
    getFold() { return fold; },
    /** Snap rather than ease — for the first frame after load. */
    snapFold(v) {
      foldTarget = fold = THREE.MathUtils.clamp(v, 0, 1);
      for (const f of fold_) if (f.fromQ) f.fromQ.copy(f.restQ);
    },

    /**
     * Start folding from wherever the wings ARE, not from the bind pose.
     *
     * Called on touchdown. The wingbeat leaves the bones mid-stroke, and a fold
     * that slerps out of the bind pose therefore snaps the wings to spread on
     * its first frame and eases from there — a pop at the exact moment the
     * player is looking at him. Snapshotting the live pose as the origin makes
     * the fold start from the last frame of the beat instead.
     */
    beginFold() {
      for (const f of fold_) if (f.fromQ) f.fromQ.copy(f.bone.quaternion);
      foldTarget = 1;
    },

    /**
     * Open them again. The origin goes back to the bind pose, because that is
     * where the flight rig expects to take over — it writes rest + delta, so
     * the fold has to arrive at exactly rest for the handover to be seamless.
     */
    beginUnfold() {
      for (const f of fold_) if (f.fromQ) f.fromQ.copy(f.restQ);
      foldTarget = 0;
    },
    bones,
    has: bones.size > 0,
  };
}
