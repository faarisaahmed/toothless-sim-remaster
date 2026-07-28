import * as THREE from "three";

// Both wing bones share a local Z axis with their spans running along opposite
// local Y, so:
//   local X  — rotating here lifts a tip. Same sign on both = a symmetric beat.
//   local Z  — rotating here sweeps a wing fore/aft. Opposite signs = a tuck.
const FLAP_AXIS  = new THREE.Vector3(1, 0, 0);
const SWEEP_AXIS = new THREE.Vector3(0, 0, 1);

const MAX_FLAP  = 0.5;   // radians at full amplitude
const MAX_SWEEP = 0.55;  // radians at a full tuck
const BEAT_BASE = 3.4;   // radians/sec of flap phase at cruise

// Smoothing rates — wings ease between states rather than snapping, which is
// most of what keeps it reading as an animal instead of a rig.
const AMP_LAMBDA   = 2.6;
const SWEEP_LAMBDA = 3.2;

function damp(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

export function setupWings(boneLeft, boneRight, tuning) {
  const restL = boneLeft.quaternion.clone();
  const restR = boneRight.quaternion.clone();

  const flapQ  = new THREE.Quaternion();
  const sweepQ = new THREE.Quaternion();

  let phase = 0;
  let amp   = 0.6;
  let sweep = 0;

  return function update(dt, state) {
    const climb  = state.climb;        // -1 diving .. +1 climbing
    const speedT = state.speedT;       // 0 .. 1
    const knife  = Math.abs(state.knife);

    // Beating hard is for climbing. Diving, going fast, or knife-edging all
    // mean the wings go still and pull in instead.
    const targetAmp = THREE.MathUtils.clamp(
      0.6 + climb * 0.4 - speedT * 0.4 - knife * 0.35, 0.05, 1.15
    );
    const targetSweep = THREE.MathUtils.clamp(
      Math.max(0, -climb) * 0.65 + speedT * 0.5 + knife * 0.6, 0, 1
    );

    amp   += (targetAmp   - amp)   * damp(AMP_LAMBDA, dt);
    sweep += (targetSweep - sweep) * damp(SWEEP_LAMBDA, dt);

    // Tucked wings beat faster and shallower, like a bird in a stoop.
    const rate = (BEAT_BASE + climb * 2.0 - speedT * 0.8 - sweep * 1.2)
               * tuning.flapSpeed;
    phase += Math.max(0.4, rate) * dt;

    const flapAmount  = amp * tuning.flapAmplitude * MAX_FLAP;
    const sweepAmount = sweep * tuning.sweepAmount * MAX_SWEEP * tuning.tuckSign;

    // A few hundredths of a radian of phase offset between the wings. Perfectly
    // mirrored beats look mechanical; this is enough to break that up.
    flapQ.setFromAxisAngle(FLAP_AXIS, Math.sin(phase) * flapAmount);
    sweepQ.setFromAxisAngle(SWEEP_AXIS, sweepAmount);
    boneLeft.quaternion.copy(restL).multiply(flapQ).multiply(sweepQ);

    flapQ.setFromAxisAngle(FLAP_AXIS, Math.sin(phase + 0.07) * flapAmount);
    sweepQ.setFromAxisAngle(SWEEP_AXIS, -sweepAmount);
    boneRight.quaternion.copy(restR).multiply(flapQ).multiply(sweepQ);
  };
}
