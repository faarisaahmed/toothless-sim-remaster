import * as THREE from "three";

// ---------------------------------------------------------------------------
// The wingbeat.
//
// The first version of this was a sine on the clavicle, a third of a radian
// each way at about half a beat a second, and it looked exactly like what it
// was: a large animal waving. Nothing that size stays up on that, and nothing
// in the films tries to — when Toothless hovers or climbs, the wings travel
// nearly from touching above his back to well below his belly, hard and fast,
// and his whole body heaves with each downstroke.
//
// So the beat is built from how big flyers actually beat:
//
//   STROKE AMPLITUDE falls with speed. Hovering and slow flight need the most
//   lift for the least airflow, so birds and bats sweep 120-160 degrees there;
//   at cruise the stroke shortens to 60-90; fast, it is a shallow flick or no
//   beat at all. Climbing adds to all of it.
//
//   FREQUENCY rises with effort and falls with speed, around two beats a
//   second for an animal this size in a hover, a little over one at cruise.
//
//   THE DOWNSTROKE IS THE POWER STROKE. It is quicker than the upstroke when
//   hovering and climbing, the wing fully spread on it; on the way back up the
//   hand folds in (flightrig.js) so the wing is not dragged up at full span.
//
//   THE STROKE PLANE TILTS. Slow, the wings sweep forward and down, then back
//   and up — the near-horizontal stroke of a hovering bird. Fast, the stroke is
//   up and down across the airflow.
//
//   FLAP-GLIDE. At cruise a big flyer does not beat continuously: it flaps a
//   few strokes and glides on held wings, then flaps again. Holding a few
//   degrees of dihedral in the glide. Climbing, slow flight and boosting cancel
//   the glides.
//
//   THE BODY HEAVES. Each downstroke is a lift pulse and the body rises on it
//   and sinks on the recovery; slow, that heave is easily a hand's breadth or
//   more. getHeave() hands main.js the offset to apply to the model, so you can
//   see the wings holding him up.
// ---------------------------------------------------------------------------

// Both wing bones share a local Z axis with their spans running along opposite
// local Y, so:
//   local X  — rotating here lifts a tip. Same sign on both = a symmetric beat.
//   local Z  — rotating here sweeps a wing fore/aft. Opposite signs = a tuck.
const FLAP_AXIS  = new THREE.Vector3(1, 0, 0);
const SWEEP_AXIS = new THREE.Vector3(0, 0, 1);
const MAX_SWEEP = 0.55;  // radians at a full tuck

// Half-stroke amplitudes, radians (so 1.0 is a 115-degree stroke).
const A_HOVER  = 1.0;
const A_CRUISE = 0.62;
const A_FAST   = 0.32;
const A_CLIMB  = 0.32;    // added at full climb
const A_MAX    = 1.2;
// Beats per second.
const F_HOVER  = 2.0;
const F_CRUISE = 1.35;
const F_FAST   = 1.1;
const F_CLIMB  = 0.45;    // added at full climb
// Mean elevation the stroke is centred on: higher when slow, so the wings
// clap up high over the back and drive down from there.
const BIAS_HOVER = 0.16, BIAS_CRUISE = 0.08;
// How much of the cycle the downstroke takes.
const DOWN_SLOW = 0.42, DOWN_CRUISE = 0.5;
// Stroke plane: fore/aft swing on the beat, radians, at a hover.
const PLANE_SWING = 0.34;
// Body heave, metres, at a full hover stroke.
const HEAVE_HOVER = 0.22, HEAVE_CRUISE = 0.06;

const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);
const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;

export function setupWings(boneLeft, boneRight, tuning) {
  const restL = boneLeft.quaternion.clone();
  const restR = boneRight.quaternion.clone();
  const flapQ  = new THREE.Quaternion();
  const sweepQ = new THREE.Quaternion();

  let p = 0;               // beat phase, cycles, 0 = top of the stroke
  let amp = A_CRUISE;      // half-stroke, radians
  let bias = BIAS_CRUISE;
  let sweep = 0;
  let down = 0.5;
  let heave = 0;
  // Flap-glide.
  let gliding = false, glideLeft = 0, beatsLeft = 4, glideK = 0;
  let lastP = 0;

  // Elevation of the wing through the beat, -1 bottom .. +1 top, with the
  // downstroke taking `d` of the cycle.
  const wave = (q, d) => (q < d ? Math.cos(Math.PI * q / d) : -Math.cos(Math.PI * (q - d) / (1 - d)));
  // The same cycle as an angle whose sine is +1 mid-downstroke and -1
  // mid-upstroke — what flightrig.js and the rumble read.
  const phaseRad = (q, d) => (q < d ? Math.PI * q / d : Math.PI + Math.PI * (q - d) / (1 - d));

  function update(dt, state) {
    const climb  = state.climb;        // -1 diving .. +1 climbing
    const speedT = state.speedT;       // 0 .. 1
    const knife  = Math.abs(state.knife);
    // The hang (top of a zoom) and the barrel roll are flown on HELD wings:
    // see flightrig.js. A beat through either reads as panic.
    const hang = state.hang || 0;
    const roll = Math.abs(state.roll || 0);

    const slowK = 1 - smooth(speedT, 0.04, 0.32);   // hovering .. not
    const fastK = smooth(speedT, 0.4, 0.85);
    const climbK = Math.max(0, climb);
    const diveK = Math.max(0, -climb);

    // --- Flap-glide ---------------------------------------------------------
    // Only in steady cruise. Count beats as the phase wraps; after a few, hold
    // the wings for a second or two.
    const canGlide = slowK < 0.25 && climb < 0.15 && !state.boost && roll < 0.1 && hang < 0.1;
    if (p < lastP) {                       // a beat just finished
      if (!gliding && canGlide && --beatsLeft <= 0) {
        gliding = true;
        glideLeft = 1.2 + Math.random() * 1.6 + fastK * 1.2;
      }
    }
    lastP = p;
    if (gliding) {
      glideLeft -= dt;
      if (glideLeft <= 0 || !canGlide) {
        gliding = false;
        beatsLeft = 3 + Math.floor(Math.random() * 3);
      }
    }
    glideK += ((gliding ? 1 : 0) - glideK) * damp(gliding ? 2.2 : 5, dt);

    // --- Targets --------------------------------------------------------------
    let targetAmp = lerp(lerp(A_CRUISE, A_FAST, fastK), A_HOVER, slowK) + A_CLIMB * climbK;
    targetAmp *= (1 - diveK * 0.85) * (1 - knife * 0.6) * (1 - hang * 0.95) * (1 - roll * 0.95) * (1 - glideK);
    targetAmp = Math.min(A_MAX, targetAmp);
    const targetBias = lerp(BIAS_CRUISE, BIAS_HOVER, slowK) * (1 - glideK) + 0.07 * glideK;
    // The shoulder sweep is the big tuck: wingposes.js measured it taking the
    // span from 3.1 m to 0.76 on its own. It saturates in a roll — he cannot
    // turn about his own length with the membrane held out in that airflow.
    const targetSweep = THREE.MathUtils.clamp(
      diveK * 0.65 + speedT * 0.5 + knife * 0.6 + roll * 0.95, 0, 1) * (1 - slowK * 0.6);

    // Amplitude rises fast (he has to get to work now) and falls slower.
    const ampRate = (targetAmp > amp ? 4.5 : 2.2) + roll * 14;
    amp  += (targetAmp - amp) * damp(ampRate, dt);
    bias += (targetBias - bias) * damp(3, dt);
    sweep += (targetSweep - sweep) * damp(3.2 + roll * 14, dt);
    down += (lerp(DOWN_CRUISE, DOWN_SLOW, Math.max(slowK, climbK)) - down) * damp(3, dt);

    const hz = (lerp(lerp(F_CRUISE, F_FAST, fastK), F_HOVER, slowK) + F_CLIMB * climbK)
             * tuning.flapSpeed * (1 - hang * 0.85) * (1 - roll * 0.7)
             * (1 - glideK * 0.75);
    p = (p + Math.max(0.12, hz) * dt) % 1;

    // --- Pose -----------------------------------------------------------------
    const e = wave(p, down);
    const elev = (bias + e * amp) * tuning.flapAmplitude;
    // Stroke plane: back at the top, forward at the bottom, when slow.
    const swing = e * PLANE_SWING * slowK * Math.min(1, amp / A_HOVER);
    const sweepAmount = (sweep * tuning.sweepAmount * MAX_SWEEP + swing) * tuning.tuckSign;

    // A few hundredths of a cycle between the wings: perfectly mirrored beats
    // look mechanical.
    flapQ.setFromAxisAngle(FLAP_AXIS, elev);
    sweepQ.setFromAxisAngle(SWEEP_AXIS, sweepAmount);
    boneLeft.quaternion.copy(restL).multiply(flapQ).multiply(sweepQ);
    const eR = wave((p + 0.012) % 1, down);
    flapQ.setFromAxisAngle(FLAP_AXIS, (bias + eR * amp) * tuning.flapAmplitude);
    sweepQ.setFromAxisAngle(SWEEP_AXIS, -sweepAmount);
    boneRight.quaternion.copy(restR).multiply(flapQ).multiply(sweepQ);

    // The heave: up through the downstroke, down through the recovery, sized
    // by how hard the stroke is.
    const hk = lerp(HEAVE_CRUISE, HEAVE_HOVER, slowK) * (amp / A_HOVER);
    heave = -e * hk;
  }

  // The rumble and flightrig.js read the beat off here: sin(phase) is +1 on
  // the downstroke, -1 on the upstroke, and amp is the stroke relative to a
  // cruise beat.
  update.getBeat = () => ({ phase: phaseRad(p, down), amp: amp / A_CRUISE * 0.6, glide: glideK });
  /** Metres to raise the model this frame. Visual only. */
  update.getHeave = () => heave;

  /** Put the clavicles back. Stop calling this and they freeze mid-beat. */
  update.release = () => {
    boneLeft.quaternion.copy(restL);
    boneRight.quaternion.copy(restR);
    heave = 0;
  };

  return update;
}
