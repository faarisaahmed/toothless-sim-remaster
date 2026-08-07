import * as THREE from "three";

// ---------------------------------------------------------------------------
// Ground rig — folding, walking, breathing
//
// toothless_rigged.glb ships with 95 bones and NO animation clips, so every
// pose in this game is made here, procedurally. The bone names are anatomical
// and consistent, which makes that tractable:
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

// Folded-wing pose, derived by probing the rig one bone and one axis at a time
// and measuring the resulting wingtip-to-wingtip span (see _probe.html).
//
// What that turned up, none of which was guessable from the bone names:
//
//  1. Wing_Finger.016 -> .017 -> .018 is the MAIN SPAR. It carries the wingtip,
//     and moves the span exactly as much as the upper arm does. Digits 001-015
//     are short struts that barely move the tip at all — rotating them hard is
//     what splayed the membrane into flat sheets in every earlier attempt.
//  2. Wing_Shoulder on Z is the SWEEP, and it is the dominant fold motion. Z
//     sweep alone takes the span from 3.10 to 0.76; the X closes are secondary.
//  3. Both sides take the SAME sign on X, and mirror only on Z. Negating X on
//     the right made the fold measurably worse (2.74 vs 0.40), which settles it.
//
// Measured spans, 3.4m dragon: spread 3.10, this pose 0.40.
const FOLD_SWEEP = 1.80;   // Wing_Shoulder Z — mirrored per side
const FOLD_ARM   = 1.00;   // Wing_UpperArm X
const FOLD_SPAR  = [1.10, 0.70, 0.35];   // Finger 016 / 017 / 018 X

// Gait. A walking quadruped moves diagonal pairs together: front-left with
// rear-right, then front-right with rear-left.
const STRIDE_FRONT = 0.42;   // radians of swing at the shoulder
const STRIDE_REAR  = 0.50;   // radians of swing at the hip
const KNEE_BEND    = 0.38;   // extra flex on the recovery half of the stride
const STEPS_PER_M  = 0.62;   // stride frequency per metre travelled

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
  const pick = (re) => [...bones.keys()].filter((n) => re.test(n)).map(get);

  // Keep the side with each bone — the fold mirrors, so L and R take opposite
  // signs on the Z component.
  const sided = (re) => [...bones.keys()].filter((n) => re.test(n))
    .map((n) => ({ bone: get(n), side: n.endsWith("L") ? 1 : -1 }));

  const shoulders = sided(/^Wing_Shoulder[LR]$/);
  const upperArms = sided(/^Wing_UpperArm[LR]$/);
  // The three spar bones per side, in order along the chain.
  const spars = ["016", "017", "018"].map((n) => sided(new RegExp(`^Wing_Finger${n}[LR]$`)));

  const front = {
    L: { upper: get("UpperArmL"), fore: get("ForearmL") },
    R: { upper: get("UpperArmR"), fore: get("ForearmR") },
  };
  const rear = {
    L: { thigh: get("ThighL"), shin: get("ShinL") },
    R: { thigh: get("ThighR"), shin: get("ShinR") },
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
  let phase = 0;           // gait phase, radians
  let moveAmt = 0;         // smoothed 0..1 "how much is he walking"

  function damp(l, dt) { return 1 - Math.exp(-l * dt); }

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
    fold += (foldTarget - fold) * damp(4, dt);

    // Stride frequency follows ground speed, so the feet never skate.
    phase += speed * STEPS_PER_M * Math.PI * 2 * dt;

    // --- Wings ------------------------------------------------------------
    // Walking jostles a folded wing; a packed wing still shifts on the shoulder.
    const jostle = moveAmt > 0.01 ? Math.sin(phase * 2) * 0.05 * moveAmt : 0;

    for (const { bone, side } of shoulders) {
      set(bone, "z", FOLD_SWEEP * fold * side);
      add(bone, "x", jostle);
    }
    for (const { bone } of upperArms) {
      set(bone, "x", FOLD_ARM * fold + jostle * 0.5);
    }
    for (let i = 0; i < spars.length; i++) {
      for (const { bone } of spars[i]) set(bone, "x", FOLD_SPAR[i] * fold);
    }

    // --- Legs -------------------------------------------------------------
    // Diagonal pairs, half a cycle apart.
    const gait = [
      { leg: front.L, part: "upper", flex: "fore",  off: 0,          amp: STRIDE_FRONT },
      { leg: front.R, part: "upper", flex: "fore",  off: Math.PI,    amp: STRIDE_FRONT },
      { leg: rear.L,  part: "thigh", flex: "shin",  off: Math.PI,    amp: STRIDE_REAR  },
      { leg: rear.R,  part: "thigh", flex: "shin",  off: 0,          amp: STRIDE_REAR  },
    ];

    for (const g of gait) {
      const swing = Math.sin(phase + g.off);
      // Knee/elbow only folds on the recovery half, which is what stops a
      // procedural walk looking like a pendulum.
      const recovery = Math.max(0, -Math.cos(phase + g.off));

      set(g.leg[g.part], "x", swing * g.amp * moveAmt);
      set(g.leg[g.flex], "x", -recovery * KNEE_BEND * moveAmt);
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
    /** 1 = wings tucked against the body, 0 = fully spread. */
    setFold(v) { foldTarget = THREE.MathUtils.clamp(v, 0, 1); },
    getFold() { return fold; },
    /** Snap rather than ease — for the first frame after load. */
    snapFold(v) { foldTarget = fold = THREE.MathUtils.clamp(v, 0, 1); },
    bones,
    has: bones.size > 0,
  };
}
