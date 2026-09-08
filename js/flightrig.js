import * as THREE from "three";

// ---------------------------------------------------------------------------
// Everything a flying dragon does that isn't the wingbeat.
//
// js/wings.js drives two bones — the clavicles — and that was all the old
// 7-bone skeleton had. The 152-bone rig has a wing elbow, six jointed digit
// spars a side, twelve tail-fin struts, a neck, a jaw and four legs, and none
// of it was doing anything: he flew across the archipelago with his legs still
// in the standing pose, hanging down like a landing gear nobody retracted.
//
// This drives the rest. It runs *after* wings.js each frame and never touches a
// clavicle, so the two compose: wings.js owns the beat, this owns the shape.
//
// The organising idea is that a wing is a control surface and so is the tail.
// Speed flattens and sweeps everything; slow flight fans it out for grip. The
// tail fins work as a rudder and elevator, deflecting differentially into a
// turn and together with climb — which is the thing Toothless is famous for and
// the thing the old rig physically could not express.
// ---------------------------------------------------------------------------

// Legs. Measured against the bind pose, which has him standing.
const TUCK_THIGH = -1.15;   // hip up under the belly
const TUCK_SHIN  =  1.75;   // heel folded to the thigh
const TUCK_ANKLE =  0.70;
const TUCK_UPPER = -0.95;   // front limb, elbow back along the ribs
const TUCK_FORE  =  1.55;
const TUCK_WRIST =  0.55;
const LEG_LOOSE  =  0.30;   // how much of the tuck is given back at low speed

// Wing shape.
const CAMBER      = 0.30;   // curl into the digits, deepest at slow speed
const CAMBER_LAG  = 0.55;   // radians of phase the outer digits trail by
const WASHOUT     = 0.22;   // extra curl toward the wingtip
const WRIST_FLEX  = 0.45;   // hand folds in on the upstroke, like a bat's
const SWEEP_DIGIT = 0.34;   // digits rake back with speed

// Tail.
const FIN_SPREAD  = 0.65;   // fans open when slow, furls when fast
const FIN_RUDDER  = 0.55;   // differential deflection into a turn
const FIN_ELEVATOR = 0.40;  // both fins together, with climb
const TAIL_CARVE  = 0.055;  // per link, curving into the turn
const TAIL_WAVE   = 0.020;

// Head and body.
const HEAD_LOOK   = 0.42;   // into the turn
const HEAD_PITCH  = 0.30;
const NECK_SHARE  = 0.30;   // of the look, spread down the three neck links
const CREST_FLAT  = 0.45;   // crest lies down at speed
const EAR_SWEEP   = 0.55;

const damp = (l, dt) => 1 - Math.exp(-l * dt);
const clamp = THREE.MathUtils.clamp;

/**
 * @param {THREE.Object3D} root  the loaded dragon
 * @returns {(dt:number, state:object, beat:object)=>void|null}
 *   state: { climb, speedT, knife, turn } from controls.getFlightState()
 *   beat:  { phase, amp } from the wings.js updater
 */
export function setupFlightRig(root) {
  const bones = new Map();
  root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  if (!bones.has("Wing_ForearmL")) return null;   // not the 152-bone rig

  const rest = new Map();
  for (const [n, b] of bones) rest.set(n, b.rotation.clone());

  const get = (n) => bones.get(n) || null;
  // Reset to bind, then add — the same discipline as dragonrig.js, so nothing
  // accumulates across frames however many of these run.
  const set = (name, axis, v) => {
    const b = bones.get(name);
    const r = rest.get(name);
    if (!b || !r) return;
    b.rotation.set(r.x, r.y, r.z);
    b.rotation[axis] += v;
  };
  const add = (name, axis, v) => {
    const b = bones.get(name);
    if (b) b.rotation[axis] += v;
  };

  const SIDES = ["L", "R"];
  const legs = SIDES.map((s) => ({
    s,
    thigh: get(`Thigh${s}`), shin: get(`Shin${s}`), ankle: get(`Ankle${s}`),
    upper: get(`UpperArm${s}`), fore: get(`Forearm${s}`), wrist: get(`Wrist${s}`),
  }));

  // Smoothed so a twitch on the stick does not snap the tail.
  let sTurn = 0, sClimb = 0, sSpeed = 0;

  /**
   * Hand every bone back.
   *
   * This rig writes rest+delta every frame, which means the instant it *stops*
   * being called the bones freeze wherever they were. Landing used to leave him
   * standing on tucked ankles with his wrists curled up — walking on stumps —
   * because the tuck was still applied and nothing was left running to undo it.
   */
  function release() {
    for (const [n, b] of bones) {
      const r = rest.get(n);
      if (r) b.rotation.set(r.x, r.y, r.z);
    }
  }

  function update(dt, state = {}, beat = {}) {
    const phase = beat.phase || 0;
    const amp = beat.amp ?? 0.6;

    sTurn  += ((state.turn  || 0) - sTurn)  * damp(4.0, dt);
    sClimb += ((state.climb || 0) - sClimb) * damp(3.0, dt);
    sSpeed += ((state.speedT || 0) - sSpeed) * damp(2.5, dt);
    const knife = state.knife || 0;

    // --- Legs -------------------------------------------------------------
    // Tucked in flight, and tucked harder the faster he goes. He used to fly
    // the whole archipelago with them hanging.
    const tuck = 1 - LEG_LOOSE * (1 - sSpeed);
    for (const l of legs) {
      const paddle = Math.sin(phase * 0.5 + (l.s === "L" ? 0 : 1.1)) * 0.05;
      set(`Thigh${l.s}`, "x", TUCK_THIGH * tuck + paddle);
      set(`Shin${l.s}`, "x", TUCK_SHIN * tuck);
      set(`Ankle${l.s}`, "x", TUCK_ANKLE * tuck);
      set(`UpperArm${l.s}`, "x", TUCK_UPPER * tuck - paddle);
      set(`Forearm${l.s}`, "x", TUCK_FORE * tuck);
      set(`Wrist${l.s}`, "x", TUCK_WRIST * tuck);
    }

    // --- Wing shape -------------------------------------------------------
    // The membrane is not a board. It bellies out under load on the downstroke
    // and spills on the upstroke, and the outer spars answer late because there
    // is more wing between them and the shoulder — that lag is most of what
    // separates a wing from a pair of oars.
    const load = Math.sin(phase);                 // +1 downstroke, -1 up
    const camber = CAMBER * amp * (1 - sSpeed * 0.55);
    const upstroke = Math.max(0, -load);

    for (const s of SIDES) {
      const sign = s === "L" ? 1 : -1;
      // Hand folds in on the recovery, so he is not dragging a full wing back up.
      set(`Wing_Forearm${s}`, "z", WRIST_FLEX * upstroke * amp * sign);

      for (let d = 0; d < 6; d++) {
        const k = d / 5;                                   // 0 inner .. 1 tip
        const lag = Math.sin(phase - CAMBER_LAG * k);
        const curl = (camber + WASHOUT * k) * lag;
        const sweep = SWEEP_DIGIT * sSpeed * k;
        for (let g = 0; g < 3; g++) {
          const n = `Wing_Finger${String(d * 3 + g + 1).padStart(3, "0")}${s}`;
          // Segment 1 rakes back with speed; all three share the camber, more
          // of it toward the tip where the membrane is least supported.
          set(n, "x", curl * (g === 0 ? 0.5 : g === 1 ? 0.32 : 0.18));
          if (g === 0) add(n, "z", sweep * sign);
        }
      }
    }

    // --- Tail fins: rudder and elevator -----------------------------------
    // Spread wide when slow because that is when he needs the authority, furled
    // when fast because that is when he does not and it costs drag.
    const spread = FIN_SPREAD * (1 - sSpeed) - Math.abs(knife) * 0.25;
    for (const s of SIDES) {
      const sign = s === "L" ? 1 : -1;
      const rudder = FIN_RUDDER * sTurn * sign;
      const elevator = FIN_ELEVATOR * sClimb;
      for (let i = 1; i <= 6; i++) {
        const k = (i - 1) / 5;
        const n = String(i).padStart(3, "0");
        set(`Tail_Fin_Strut${n}${s}`, "x", -spread * (0.4 + k * 0.9) + elevator);
        add(`Tail_Fin_Strut${n}${s}`, "z", rudder);
        set(`Tail_Fin_Tip${n}${s}`, "x", -spread * (0.3 + k * 0.6) + elevator * 0.6);
      }
    }

    // --- Tail --------------------------------------------------------------
    for (let i = 1; i <= 11; i++) {
      const k = i / 11;
      const n = `Tail${String(i).padStart(3, "0")}`;
      set(n, "z", TAIL_CARVE * sTurn * (0.35 + k));
      add(n, "x", Math.sin(phase * 0.6 - k * 1.8) * TAIL_WAVE + sClimb * 0.02);
    }

    // --- Head, neck, crest, ears -------------------------------------------
    for (let i = 1; i <= 3; i++) {
      set(`Neck${String(i).padStart(3, "0")}`, "z", HEAD_LOOK * NECK_SHARE * sTurn);
    }
    set("Head", "z", HEAD_LOOK * sTurn);
    add("Head", "x", -HEAD_PITCH * sClimb);
    set("Jaw", "x", 0);

    const flat = CREST_FLAT * sSpeed;
    for (let i = 1; i <= 8; i++) set(`Dorsal${String(i).padStart(3, "0")}`, "x", flat);
    for (const s of SIDES) {
      const sign = s === "L" ? 1 : -1;
      const back = EAR_SWEEP * sSpeed * sign;
      set(`Ear_A001${s}`, "z", back);
      set(`Ear_A002${s}`, "z", back * 0.6);
      set(`Ear_B001${s}`, "z", back * 0.7);
      set(`Ear_B002${s}`, "z", back * 0.4);
      set(`Ear_C${s}`, "z", back * 0.5);
    }

    // A blink now and then. Cheap, and it is the difference between an animal
    // and a model on a stick.
    const blink = Math.max(0, Math.sin(phase * 0.21) - 0.965) * 9;
    set("EyeL", "x", clamp(blink, 0, 1) * 0.35);
    set("EyeR", "x", clamp(blink, 0, 1) * 0.35);
  }

  update.release = release;
  return update;
}
