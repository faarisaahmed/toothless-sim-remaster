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

  function update(dt, state) {
    const climb  = state.climb;        // -1 diving .. +1 climbing
    const speedT = state.speedT;       // 0 .. 1
    const knife  = Math.abs(state.knife);

    // Beating hard is for climbing. Diving, going fast, or knife-edging all
    // mean the wings go still and pull in instead.
    // The hang, from controls.js: at the top of a zoom climb the wings stop
    // driving him and only hold him. Beating through that would undo the whole
    // pose js/flightrig.js builds for it — a wing cannot be held still and
    // flapping at the same time. `climb` is near its maximum up there, so
    // without this the beat is at its HARDEST exactly when it should have
    // stopped.
    const hang = state.hang || 0;
    // A barrel roll is flown on HELD wings, not beaten ones. The roll moment
    // comes from the two wings taking opposite twist (see flightrig.js), and
    // you cannot twist a wing one way and flap it at the same time — a beat
    // through the corkscrew reads as panic rather than as a manoeuvre. Same
    // reasoning as the hang above, and the same shape of fix.
    const roll = Math.abs(state.roll || 0);
    const targetAmp = THREE.MathUtils.clamp(
      0.6 + climb * 0.4 - speedT * 0.4 - knife * 0.35, 0.05, 1.15
    ) * (1 - hang * 0.92) * (1 - roll * 0.95);
    // The shoulder sweep is the big one — wingposes.js measured it taking the
    // span from 3.1 m to 0.76 on its own — so this is where most of the wings
    // coming IN for a roll actually happens. It saturates during one: he cannot
    // turn about his own length with fifteen metres of membrane held out in a
    // three-hundred-knot airflow, and the silhouette has to say so.
    const targetSweep = THREE.MathUtils.clamp(
      Math.max(0, -climb) * 0.65 + speedT * 0.5 + knife * 0.6 + roll * 0.95, 0, 1
    );

    // The roll rates are deliberately far higher than the others. A barrel roll
    // is over in a little over half a second, and at the ordinary 2.6 the wings
    // would only be a third of the way into holding by the time he came out of
    // it — the beat would run straight through the manoeuvre and none of the
    // shape below would ever be seen.
    amp   += (targetAmp   - amp)   * damp(AMP_LAMBDA   + roll * 14, dt);
    sweep += (targetSweep - sweep) * damp(SWEEP_LAMBDA + roll * 14, dt);

    // Tucked wings beat faster and shallower, like a bird in a stoop.
    const rate = (BEAT_BASE + climb * 2.0 - speedT * 0.8 - sweep * 1.2)
               * tuning.flapSpeed * (1 - hang * 0.85) * (1 - roll * 0.7);
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
  }

  // The rumble reads the beat off here so the controller thumps in time with the
  // downstroke rather than to a timer of its own.
  update.getBeat = () => ({ phase, amp });

  /** Put the clavicles back. Stop calling this and they freeze mid-beat, which
   *  is why a landed dragon used to stand there with his wings half open. */
  update.release = () => {
    boneLeft.quaternion.copy(restL);
    boneRight.quaternion.copy(restR);
  };

  return update;
}
