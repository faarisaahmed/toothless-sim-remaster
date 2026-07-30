import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural motion, built from published kinematics rather than eyeballing.
//
// Wing flap — bat flight literature:
//   * The downstroke is the power stroke and occupies well under half the
//     cycle; the upstroke is slower.
//   * Wing FOLDING begins in the LATE DOWNSTROKE, not at the bottom. On the
//     upstroke the wrist flexes and the handwing folds, which cuts both the
//     inertial cost of raising the wing and the negative lift it would make.
//   * In late downstroke the handwing gains angular velocity relative to the
//     armwing, raising its effective angle of attack.
//   * The wing cambers (cups downward) through the power stroke.
//
// Walk — quadruped gait literature:
//   * A walk is a FOUR-BEAT gait. Most mammals use a LATERAL sequence:
//     left hind, left fore, right hind, right fore, at 25% phase offsets.
//   * Duty factor is above 0.5 — each foot spends more time planted than
//     swinging, which is what separates a walk from a trot.
//   * The spine is part of the gait, not a rigid rod: it flexes laterally each
//     stride and the body bobs vertically at twice stride frequency.
// ---------------------------------------------------------------------------

export const params = {
  // --- hover flap ---
  flapRate: 1.1,          // cycles per second
  downstrokeFraction: 0.42,
  clavicleFlap: 0.16,
  shoulderFlap: 0.55,
  upperArmFlap: 0.42,
  handwingLead: 0.18,     // extra handwing swing in late downstroke
  foldAmount: 0.85,
  camberAmount: 0.22,

  // --- fold shape ---
  // A furled wing BREAKS downward at the wrist; it does not fan sideways. The
  // arm lifts and sweeps back while the handwing hangs off the joint.
  foldWrist: 1.15,        // downward break at the first digit joint
  foldArmLift: 0.45,
  foldShoulderLift: 0.30,
  foldGather: 1.0,        // how much the digits draw together as they close
  perchFold: 0.55,
  perchLift: 0.5,
  bodyBob: 0.09,
  tailWave: 0.09,

  // --- walk ---
  walkRate: 0.55,         // strides per second
  dutyFactor: 0.62,
  hindReach: 0.42,
  hindKnee: 0.55,
  foreReach: 0.36,
  foreKnee: 0.45,
  footLift: 0.30,
  spineSway: 0.055,
  walkBob: 0.035,
  walkWingFold: 0.5,      // kept moderate so a bad fold doesn't mask the gait

  // --- shared ---
  wingSweepMirror: 1,     // flip to -1 if the wings fold forward instead of back
  neckFollow: 0.5,
};

// Six digits of three segments each, numbered 1..18 along the chain.
export function digitsFor(side) {
  const out = [];
  for (let d = 0; d < 6; d++) {
    const segs = [];
    for (let s = 0; s < 3; s++) {
      const n = d * 3 + s + 1;
      segs.push(`Wing_Finger${String(n).padStart(3, "0")}${side}`);
    }
    out.push(segs);
  }
  return out;
}

const DIGITS = { L: digitsFor("L"), R: digitsFor("R") };

export const TAIL = [
  ...Array.from({ length: 11 }, (_, i) => `Tail${String(i + 1).padStart(3, "0")}`),
  "Tail_tip",
];

/** Smooth 0 -> 1 -> 0 pulse across [a, peak, b]. */
function pulse(t, a, peak, b) {
  if (t <= a || t >= b) return 0;
  const u = t < peak ? (t - a) / (peak - a) : 1 - (t - peak) / (b - peak);
  return u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------------------
// Wing pose shared by hover, fold and walk. `fold` 0 = fully spread,
// 1 = furled against the body.
// ---------------------------------------------------------------------------
function poseWing(rig, side, { flap = 0, fold = 0, camber = 0, handwing = 0, lift = 0 }) {
  // Sign derived from the rig's own geometry, so both wings fold toward the
  // tail. The params multiplier is only a manual override.
  const mirror = rig.foldSigns[side] * params.wingSweepMirror;

  // The arm carries the wing up and back as it closes.
  rig.pose(`Wing_Clavicle${side}`, {
    flap: flap * params.clavicleFlap + fold * params.foldShoulderLift * 0.5 + lift * 0.3,
    sweep: fold * 0.22 * mirror,
  });
  rig.pose(`Wing_Shoulder${side}`, {
    flap: flap * params.shoulderFlap + fold * params.foldShoulderLift + lift * 0.6,
    sweep: fold * 0.40 * mirror,
  });
  rig.pose(`Wing_UpperArm${side}`, {
    flap: flap * params.upperArmFlap + handwing + fold * params.foldArmLift + lift * 0.45,
    sweep: fold * 0.55 * mirror,
    twist: camber * 0.4 * mirror,
  });

  // The handwing BREAKS DOWNWARD at the wrist. This is the fold — the digits
  // hang off the joint rather than fanning sideways. The sweep term only draws
  // them together as they close, it doesn't do the folding.
  const BREAK  = [1.0, 0.62, 0.45];
  const GATHER = [0.16, 0.28, 0.36];
  DIGITS[side].forEach((segs, d) => {
    // Trailing digits (nearer the body) close harder than the leading edge.
    const spanBias = 0.7 + 0.3 * (d / 5);
    segs.forEach((name, s) => {
      rig.pose(name, {
        flap: -fold * params.foldWrist * BREAK[s] * spanBias
              + camber * (s + 1) * 0.16
              + handwing * (s === 0 ? 0.5 : 0.2),
        sweep: fold * GATHER[s] * params.foldGather * spanBias * mirror,
      });
    });
  });
}

// ---------------------------------------------------------------------------
export function hoverFlap(rig, time) {
  const t = (time * params.flapRate) % 1;
  const DOWN = params.downstrokeFraction;

  // stroke: +1 at top of the upstroke, -1 at the bottom of the downstroke.
  // Splitting the cosine at DOWN makes the downstroke the faster half.
  let stroke;
  if (t < DOWN) {
    stroke = Math.cos((t / DOWN) * Math.PI);
  } else {
    stroke = -Math.cos(((t - DOWN) / (1 - DOWN)) * Math.PI);
  }

  // Folding starts in the late downstroke and clears before the next one.
  const fold = pulse(t, 0.30, 0.68, 0.97) * params.foldAmount;

  // Camber peaks mid-downstroke, when the wing is doing the work.
  const camber = (t < DOWN ? Math.sin((t / DOWN) * Math.PI) : 0) * params.camberAmount;

  // Handwing outruns the armwing over the last third of the downstroke.
  const handwing = -pulse(t, DOWN * 0.55, DOWN * 0.92, DOWN * 1.25) * params.handwingLead;

  poseWing(rig, "L", { flap: stroke, fold, camber, handwing });
  poseWing(rig, "R", { flap: stroke, fold, camber, handwing });

  // Body rises on the downstroke and sinks on the upstroke.
  const bob = -stroke * params.bodyBob;

  // Tail trails the beat, each segment a little later than the one before it.
  TAIL.forEach((name, i) => {
    const lag = i * 0.06;
    const w = Math.sin((t - lag) * Math.PI * 2);
    rig.pose(name, { flap: w * params.tailWave * (0.4 + i / TAIL.length) });
  });

  // NOTE: Neck001/Neck002 are NOT neck bones in this rig — the armature is
  // rooted at Neck.003 and flows head->tail, so Neck001 is a trunk link that
  // carries 85 of the 94 bones. Rotating it swings the whole body. Head is a
  // leaf, so it is the only bone that moves the head alone.
  rig.pose("Head", { flap: -bob * params.neckFollow });

  return { bob, sway: 0, yaw: 0 };
}

// ---------------------------------------------------------------------------
/** One limb's cycle. Returns protraction (-1 back .. +1 forward) and lift 0..1. */
function limbCycle(p, duty) {
  p = ((p % 1) + 1) % 1;
  if (p < duty) {
    // Stance: planted, travelling backwards under the body.
    const u = p / duty;
    return { protract: 1 - 2 * u, lift: 0, planted: true };
  }
  // Swing: lifts and swings forward again.
  const u = (p - duty) / (1 - duty);
  const e = u * u * (3 - 2 * u);
  return { protract: -1 + 2 * e, lift: Math.sin(u * Math.PI), planted: false };
}

export function walk(rig, time) {
  const t = time * params.walkRate;

  // Lateral sequence, 25% apart: left hind, left fore, right hind, right fore.
  const phases = {
    hindL: 0.0,
    foreL: 0.25,
    hindR: 0.5,
    foreR: 0.75,
  };

  for (const side of ["L", "R"]) {
    const hind = limbCycle(t + phases[side === "L" ? "hindL" : "hindR"], params.dutyFactor);
    rig.pose(`Thigh${side}`, { flap: hind.protract * params.hindReach + hind.lift * params.footLift });
    rig.pose(`Shin${side}`,  { flap: -hind.lift * params.hindKnee });
    rig.pose(`Ankle${side}`, { flap: hind.lift * params.hindKnee * 0.6 - hind.protract * 0.12 });
    rig.pose(`Toe${side}`,   { flap: -hind.lift * 0.25 });

    const fore = limbCycle(t + phases[side === "L" ? "foreL" : "foreR"], params.dutyFactor);
    rig.pose(`UpperArm${side}`,  { flap: fore.protract * params.foreReach + fore.lift * params.footLift });
    rig.pose(`Forearm${side}`,   { flap: -fore.lift * params.foreKnee });
    rig.pose(`Wrist${side}`,     { flap: fore.lift * params.foreKnee * 0.5 - fore.protract * 0.1 });
    rig.pose(`Front_Toe${side}`, { flap: -fore.lift * 0.25 });

    // Wings stay furled while he's on the ground.
    poseWing(rig, side, { flap: 0, fold: params.walkWingFold, camber: 0, handwing: 0 });
  }

  const stride = t * Math.PI * 2;
  const sway = Math.sin(stride) * params.spineSway;

  // The spine SHOULD flex laterally each stride, but in this rig Spine carries
  // 84 bones including both hind legs — rotating it drags the planted feet
  // sideways. So the body sway is applied at the root instead (see the return
  // value) and only the head and tail articulate here. Re-parenting the
  // armature so it is rooted at the hips would let the spine flex properly.
  rig.pose("Head", { sweep: -sway * 1.2 });

  // Tail counter-swings, trailing the spine.
  TAIL.forEach((name, i) => {
    rig.pose(name, {
      sweep: Math.sin(stride - i * 0.22) * params.spineSway * 1.4 * (0.3 + i / TAIL.length),
      flap: Math.sin(stride * 2 - i * 0.18) * 0.02,
    });
  });

  // Vertical bob runs at twice stride frequency — one dip per footfall pair.
  // Lateral sway and yaw ride on the root so they don't disturb foot contact.
  return {
    bob: Math.sin(stride * 2) * params.walkBob,
    sway: Math.sin(stride) * params.walkBob * 0.4,
    yaw: sway * 0.5,
  };
}

// ---------------------------------------------------------------------------
/** Static fold, driven straight off a slider. 0 = spread, 1 = furled. */
export function foldPose(rig, amount) {
  const a = THREE.MathUtils.clamp(amount, 0, 1);
  poseWing(rig, "L", { flap: 0, fold: a, camber: 0, handwing: 0 });
  poseWing(rig, "R", { flap: 0, fold: a, camber: 0, handwing: 0 });
  return { bob: 0, sway: 0, yaw: 0 };
}

/**
 * Sitting at rest: wings half-furled and held UP off the back, handwing
 * hanging from the wrist, forelegs planted. Breathing keeps it alive.
 */
export function perch(rig, time) {
  const breathe = Math.sin(time * 1.3) * 0.5 + 0.5;

  for (const side of ["L", "R"]) {
    poseWing(rig, side, {
      flap: 0,
      fold: params.perchFold,
      lift: params.perchLift + breathe * 0.03,
      camber: 0,
      handwing: 0,
    });

    // Forelegs planted, hind legs tucked under.
    rig.pose(`UpperArm${side}`, { flap: -0.12 });
    rig.pose(`Forearm${side}`, { flap: 0.08 });
    rig.pose(`Thigh${side}`, { flap: 0.22 });
    rig.pose(`Shin${side}`, { flap: -0.3 });
  }

  // Idle head and tail so it doesn't read as a statue.
  rig.pose("Head", {
    flap: Math.sin(time * 0.7) * 0.05 - 0.06,
    sweep: Math.sin(time * 0.41) * 0.12,
  });
  TAIL.forEach((name, i) => {
    rig.pose(name, {
      sweep: Math.sin(time * 0.6 - i * 0.3) * 0.035 * (0.3 + i / TAIL.length),
      flap: Math.sin(time * 0.45 - i * 0.2) * 0.02,
    });
  });

  return { bob: breathe * 0.012, sway: 0, yaw: 0 };
}
