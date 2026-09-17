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

// --- The hang -------------------------------------------------------------
// The pose at the top of a zoom climb, once the airspeed is gone: wings held
// wide and CURLING rather than beating, tips raked back, hand dropped, tail
// fanned. It is the shape of a wing that has stopped flying and is only hanging
// on the air, and it is what he does in the films at the top of a climb.
//
// It REPLACES the beat's camber rather than adding to it, mixed by `hang`. A
// wing curling on a sine wave is a wing still working, and the whole point of
// this pose is that he has stopped.
const HANG_CAMBER  = 0.62;  // curl into the digits, deep and static
const HANG_WASHOUT = 0.55;  // and much more at the tip, so the tips hook over
const HANG_SWEEP   = 0.40;  // raked back, the way a stalling wing sits
const HANG_WRIST   = 0.60;  // the hand drops
const HANG_FIN     = 0.35;  // tail fans past even its slow-flight spread

// --- Curve under load -----------------------------------------------------
// The thing that makes a wing a wing rather than a board.
//
// The camber above rides the beat's own sine, so before this he was exactly as
// curved in a four-g carve as in a straight glide — the wings answered the
// FLAP and nothing else. A membrane wing bows under load and stays bowed for
// as long as the load lasts, and `state.load` is the real number for it: the
// lateral acceleration of the turn and the vertical of a pull-up, in g.
//
// Three parts, and the tip one matters most. A wing does not bend evenly: the
// spar is stiff at the shoulder and there is almost nothing holding the
// membrane out at the tip, so under load the tips bend far more than the root.
// That progressive bend is the shape the eye reads as lift.
const LOAD_CAMBER  = 0.16;  // static bow per g, at the root
const LOAD_TIP     = 0.30;  // ...and how much more of it at the tip
const LOAD_ASYM    = 0.34;  // outer wing loads harder than the inner in a carve
// The g at which the bow stops deepening, and it has to be read off the flight
// model rather than picked: controls.js allows TURN_G = 196 m/s² of lateral
// acceleration, so a full carve is TWENTY g and a cruise-speed one is eight.
// The first version of this saturated at 3.2 and the wings were therefore
// pegged at maximum bow through ordinary flying, which is the same as having no
// load term at all. At 16 a cruise carve sits about half way and only a
// flat-out one runs out of bend.
const LOAD_MAX     = 16;    // g

// --- The barrel roll ------------------------------------------------------
//
// What an animal does to roll, which is not what an aeroplane does.
//
// An aircraft rolls with ailerons: two small flaps at the wingtips, and the
// wing itself is a rigid board that does not change shape. A bird has no
// ailerons, so it rolls by making the two wings do different things — and the
// literature on avian roll control is specific about which difference matters.
// Asymmetric wing PITCH, one wing twisting leading-edge-up while the other
// twists leading-edge-down, produces a much larger roll moment than asymmetric
// FOLDING does; folding is the secondary term. The tail twists with it, and the
// asymmetric flow that twist puts over the tail is itself enough to coordinate
// a banked turn in a soaring raptor.
//
// So four things are here, and the FIRST one is the one that was missing.
//
//   CLOSE  Both wings come in. Not one of them — both. A fifteen-metre span is
//          an enormous roll damper and an enormous roll inertia, and no flying
//          animal rolls fast with its wings out; it pulls them in, rolls, and
//          opens them again. Leaving them stretched was most of why the old
//          version read as a model being spun rather than an animal rolling:
//          the silhouette never changed, so nothing about it looked difficult
//          or deliberate. The hand folds, the membrane curls, the whole wing
//          rakes back, and the span he is turning drops by a third.
//   TWIST  Then the asymmetry, which is what actually produces the moment: the
//          two wings take opposite camber, the rising wing curling under to
//          bite while the falling one flattens and spills. The literature on
//          avian roll is clear that this beats asymmetric folding.
//   TUCK   ...and a little asymmetric folding on top, the inside wing pulling
//          in harder than the outside one reaches.
//   TAIL   the fins deflect differentially, hard, and the tail itself lays over
//          into the roll. It is a rudder and he is using it.
//
// All of it is driven off `state.roll`, which controls.js only makes non-zero
// inside a barrel roll — so ordinary banked flight is untouched.
const ROLL_CLOSE  = 0.52;   // rad the hand folds in, BOTH wings
const ROLL_CURL   = 0.34;   // ...and the membrane curls, both wings
const ROLL_CURL_TIP = 0.30; // more of it at the tip, where nothing holds it out
const ROLL_RAKE   = 0.42;   // whole wing swept back, both sides
const ROLL_TWIST  = 0.55;   // rad of opposite camber between the two wings
const ROLL_TIP    = 0.45;   // ...and how much more of it out at the tip
const ROLL_TUCK   = 0.30;   // the falling wing pulls in further still
const ROLL_REACH  = 0.16;   // and the rising one gives a little back
const ROLL_FIN    = 0.85;   // tail fins, deflected much harder than a carve
const ROLL_TAIL   = 0.10;   // per link, laying the tail over into it
const ROLL_HEAD   = 0.5;    // he looks where he is going round to
const ROLL_LEG    = 0.35;   // legs come in tight — everything narrows

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
  let sTurn = 0, sClimb = 0, sSpeed = 0, sHang = 0, sLoad = 0, sRoll = 0;

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
    // Eased rather than taken raw: the hang is a pose he adopts, not a switch.
    sHang += ((state.hang || 0) - sHang) * damp(3.6, dt);
    // Load eases in faster than the hang and out slower, which is how a
    // membrane behaves: it takes the load the moment it arrives and lets go of
    // it reluctantly. One rate for both made the wings snap flat the instant a
    // carve ended, and the flattening is the half you actually notice.
    const wantLoad = Math.min(LOAD_MAX, state.load || 0) / LOAD_MAX;
    sLoad += (wantLoad - sLoad) * damp(wantLoad > sLoad ? 9 : 3.5, dt);
    // The roll is fast and deliberate, so it is smoothed far less than anything
    // else here — a barrel roll is over in about a second and a rig that eases
    // into it over half of that has missed it. Enough to take the corner off,
    // no more.
    sRoll += ((state.roll || 0) - sRoll) * damp(14, dt);
    const rollMag = Math.abs(sRoll);

    // --- Legs -------------------------------------------------------------
    // Tucked in flight, and tucked harder the faster he goes. He used to fly
    // the whole archipelago with them hanging.
    // Everything narrows in a roll: he is a spindle going round its own length,
    // and legs hanging half out of the tuck are the thing that would give that
    // away first.
    const tuck = (1 - LEG_LOOSE * (1 - sSpeed)) * (1 + ROLL_LEG * rollMag);
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
      // Which end of the roll this wing is on. +1 for the wing going DOWN
      // (the inside of the barrel), -1 for the one coming up and over.
      const rollSide = sRoll * sign;
      // Hand folds in on the recovery, so he is not dragging a full wing back
      // up — and in the hang it simply stays dropped. In a roll the inside
      // hand folds hard: that asymmetry is the fold half of the roll moment.
      set(`Wing_Forearm${s}`, "z",
        (WRIST_FLEX * upstroke * amp * (1 - sHang) + HANG_WRIST * sHang
         // Both hands fold, hard, and then the inside one folds further. The
         // symmetric part is the one that makes the roll possible; the
         // asymmetric part is decoration on top of it.
         + rollMag * ROLL_CLOSE
         + Math.max(0, rollSide) * ROLL_TUCK) * sign);

      for (let d = 0; d < 6; d++) {
        const k = d / 5;                                   // 0 inner .. 1 tip
        const lag = Math.sin(phase - CAMBER_LAG * k);
        // Two curls, mixed by the hang. The beat's rides a sine — a wing still
        // working. The hang's is static and much deeper toward the tip, which
        // is what hooks the tips over instead of leaving them flat.
        const beatCurl = (camber + WASHOUT * k) * lag;
        const hangCurl = HANG_CAMBER + HANG_WASHOUT * k * k;
        // The bow: static, not on the sine, and squared toward the tip so the
        // bend is progressive rather than a uniform fold. The outer wing of a
        // carve takes more of it than the inner, which is what makes a hard
        // turn read as asymmetric rather than as a symmetric flap in a bank.
        const asym = 1 - LOAD_ASYM * sTurn * sign;
        const bow = (LOAD_CAMBER + LOAD_TIP * k * k) * sLoad * asym;
        // Suppressed by the hang, which is its own held shape and would
        // otherwise be fighting this for the same bones.
        // THE TWIST. Equal and opposite between the two wings, deepest at the
        // tip where there is least holding the membrane out, and it is by far
        // the biggest of the three roll terms — see the note at the top. The
        // wing coming up curls under and bites; the one going down flattens
        // out and spills. It ADDS to whatever the beat and the load are doing
        // rather than replacing them, because he is still flying.
        const twist = -rollSide * (ROLL_TWIST + ROLL_TIP * k * k);
        // The symmetric curl: both wings draw their membrane in, more toward
        // the tip. This is the shape that lets him turn at all — a stretched
        // wing at three hundred knots does not roll, it resists.
        const close = rollMag * (ROLL_CURL + ROLL_CURL_TIP * k * k);
        const curl = beatCurl * (1 - sHang) + hangCurl * sHang + bow * (1 - sHang)
                   + twist + close;
        // Rake: both wings back, and then the inside one further than the
        // outside. Same split as the hand above — symmetric first, asymmetric
        // as the trim on it.
        const rollSweep = rollMag * ROLL_RAKE * (0.4 + k)
                        + Math.max(0, rollSide) * ROLL_TUCK * (0.4 + k)
                        - Math.max(0, -rollSide) * ROLL_REACH * k;
        const sweep = SWEEP_DIGIT * sSpeed * k * (1 - sHang) + HANG_SWEEP * k * sHang
                    + rollSweep;
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
    const spread = FIN_SPREAD * (1 - sSpeed) - Math.abs(knife) * 0.25
                 + HANG_FIN * sHang;
    for (const s of SIDES) {
      const sign = s === "L" ? 1 : -1;
      // The rudder takes the roll as well as the carve, and much harder. A
      // raptor turning on tail twist alone is doing this and nothing else.
      const rudder = (FIN_RUDDER * sTurn + ROLL_FIN * sRoll) * sign;
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
      set(n, "z", (TAIL_CARVE * sTurn + ROLL_TAIL * sRoll) * (0.35 + k));
      add(n, "x", Math.sin(phase * 0.6 - k * 1.8) * TAIL_WAVE + sClimb * 0.02);
    }

    // --- Head, neck, crest, ears -------------------------------------------
    for (let i = 1; i <= 3; i++) {
      set(`Neck${String(i).padStart(3, "0")}`, "z",
        (HEAD_LOOK * sTurn + ROLL_HEAD * sRoll) * NECK_SHARE);
    }
    // He looks the way he is going round. Half of what sells a roll as flown
    // rather than applied is that the head leads it.
    set("Head", "z", HEAD_LOOK * sTurn + ROLL_HEAD * sRoll);
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
