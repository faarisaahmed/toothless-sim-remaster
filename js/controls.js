import * as THREE from "three";
import { BTN } from "./gamepad.js";
import { heldIn, isAction, claimedKeys } from "./keymap.js";

// Shortest signed angle from a to b, wrap-safe.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// Units
//
// One world unit is one metre. That is not a new convention — world.js sizes
// its islands in metres, places.js says outright that "a 4.5 m cage is 4.5 m",
// and the ground code down in main.js already walks him at 4 m/s under real
// gravity. Flight was the one system that never got the memo: it moved him a
// fixed distance *per frame* with no dt anywhere, so his top speed was a
// property of your monitor. On a 120 Hz panel he flew twice as fast as the
// numbers said. Everything below is metres and seconds.
//
// The speeds themselves are the franchise's, not invented:
//
//   Size    DreamWorks' published Night Fury measurements are 26 ft long and
//           45 ft across the wings — 7.9 m and 13.7 m. The GLB measures 8.6 x
//           15.1 at scale 1, so he is shipped at very nearly life size and the
//           right thing to do is leave him there.
//
//   Speed   The Book of Dragons and the HTTYD2 bonus feature both say a Night
//           Fury flies faster than sound: 750 mph, 1207 km/h. That is the
//           number BURST_SPEED is set to, and it is the only thing in the game
//           that reaches it — it is his top speed, not his cruise.
// ---------------------------------------------------------------------------

const MPH = 0.44704;                          // mph -> m/s

/** 750 mph. Faster than sound, per the Book of Dragons. */
export const CANON_TOP_SPEED = 750 * MPH;     // 335.3 m/s

// `pad` is optional — everything below falls back to the keyboard without it.
export function setupDragonControls(dragon, getCamYaw, pad = null) {
  const keys = {};
  const keysJustPressed = {};

  // --- The speed ladder, in m/s ------------------------------------------
  // Four gears with real daylight between them, so you can always tell which
  // one you are in without looking at the HUD. The bottom of the ladder is a
  // dead stop, not a crawl: let go of W and he stops, which is the hover.
  const SPEED_MIN     = 0;                    //   0 mph — hovering on the spot
  const SPEED_CRUISE  = 55;                   // 123 mph — W held
  const PEDAL_MAX     = 180;                  // 403 mph — W and Shift held
  const BURST_SPEED   = CANON_TOP_SPEED;      // 750 mph — the canon top speed
  const REVERSE_SPEED = 9;                    //  20 mph — S held, backing off

  // How quickly he answers. These are exponential rates in s^-1: at GAIN 1.5 he
  // has eaten ~78% of a speed change in a second. Deliberately slower than the
  // old numbers because the range is now six times wider — winding from cruise
  // to 400 mph should be a thing you feel happening, not a step change.
  const PEDAL_GAIN    = 1.5;
  const PEDAL_BLEED   = 0.9;

  // --- Top gear ----------------------------------------------------------
  // This used to be a burst: a 1.9-second shove with a 5.5-second cooldown and
  // a charge meter. It is a GEAR now — hold it and he flies at it, let go and
  // he slides back down the ladder. No timer, no cooldown, nothing to manage.
  //
  // The reason that works without a cost attached is that the cost is already
  // in the flight model. Two different limits govern the turn: below about
  // 135 m/s it is YAW_RATE_MAX, a flat cap on how fast he can rotate, and above
  // it TURN_G, a cap on lateral acceleration. Under the second one the radius
  // grows with the SQUARE of his speed. Measured on the real rig:
  //
  //   cruise    48 m/s, 1.44 rad/s (rate-capped)  ->   33 m radius
  //   top gear 330 m/s, 0.59 rad/s (g-capped)     ->  563 m radius
  //
  // The archipelago's islands are three hundred to nine hundred metres across.
  // Top gear therefore cannot be flown near anything — it is for crossing open
  // water, and the player drops out of it to manoeuvre without being told to.
  // A cooldown on top of that was taxing what the geometry already taxes.
  const BURST_GAIN     = 5.5;                 // slams up to it
  const BURST_BLEED    = 1.7;                 // and slides back off it

  // --- Up and down -------------------------------------------------------
  // Space and Ctrl, and they do exactly one thing: change his altitude. They
  // never change his speed, and W never changes his altitude. That separation
  // is the whole point of the scheme — it is what every game with a flying
  // mount does, and it is what lets him hold a level while flying forward and
  // rise straight up while standing still.
  //
  // The RATE still scales with airspeed, because a dragon hanging on his wings
  // and a dragon doing 400 mph are not going to climb at the same speed. At a
  // hover it is a lift; at full throttle it is a zoom.
  const VERT_HOVER     = 9;                   // m/s of climb with no airspeed
  const VERT_PER_SPEED = 0.45;                // ...plus this much of his airspeed
  const CLIMB_RATE_CAP = 140;                 // m/s, so a burst zoom stays on the map
  const VERT_LAMBDA    = 3.2;                 // how fast the climb answers the key

  // --- The vertical manoeuvres: zoom climb, stall, dive ---------------------
  //
  // The lift axis above is a helicopter's: hold up and he rises, at a rate that
  // happens to scale with speed. It is the right control for placing him and
  // the wrong one for the move the films are built on, where he trades
  // everything he has for height, runs out, falls through his own nose and
  // comes back down faster than he went up.
  //
  // So above CLIMB_ENTRY_SPEED, "up" stops being a lift and becomes a ZOOM: he
  // stands on his tail, goes straight up with no ground speed at all, and pays
  // for every metre out of his airspeed. That makes it a decision with a cost
  // rather than a button — you can see the speed draining, and you have to
  // choose when to level off.
  //
  // Below the entry speed the old lift is exactly as it was, which matters:
  // hovering and rising is what the axis was built for and a stall on the way
  // up from a standstill would be nonsense.
  //
  // The whole thing is one energy account. Height is bought with speed going
  // up and sold for it coming down, and the numbers are set so a full-height
  // zoom and the dive out of it roughly break even — you land back at about the
  // speed you left with, having gone up and over. Diving from height you did
  // not pay for is what actually makes you fast.
  const CLIMB_ENTRY_SPEED = 105;              // m/s (~235 mph) before up goes vertical
  const CLIMB_DRAG        = 30;               // m/s^2 of airspeed spent climbing
  const STALL_SPEED       = 15;               // m/s where the wings stop holding him
  const STALL_HANG        = 0.5;              // s hanging at the top before the nose drops
  const NOSE_OVER_RATE    = 2.2;              // rad/s the nose swings through the stall
  const DIVE_GRAVITY      = 36;               // m/s^2 gained with the nose down
  const DIVE_MAX          = CANON_TOP_SPEED * 1.2;  // 900 mph, and only in a dive
  // Same gate as the climb, and it has to be this high. At 40 m/s "down" turned
  // every ordinary descent into a committed dive, which took away the one thing
  // that axis has to keep doing — losing a little height on an approach. The
  // landing prompt says "hold down to drop" and it has to still mean that.
  const DIVE_ENTRY_SPEED  = CLIMB_ENTRY_SPEED;
  // Seconds of the post-stall dive he cannot pull out of. Without it, holding
  // the climb key through a stall put him straight into `recover`, so the nose
  // dropped, nothing happened, and running out of airspeed cost nothing at all.
  // This is the punishment: half a second where the controls do not answer.
  const STALL_DIVE_COMMIT = 1.1;              // s
  const RECOVER_RATE      = 2.6;              // rad/s pulling the nose back to level
  // Held for this long after a recovery, so the speed a dive earned is still
  // there when he comes out of it rather than bleeding off during the pull-up.
  const RECOVER_HOLD      = 1.1;              // s
  // Denominator floor when working out which way his nose points. Without it a
  // climb from a standstill is atan2(9, 0) and he stands on his tail.
  const PATH_REF_SPEED = 25;

  // --- Turning -----------------------------------------------------------
  // Rate-based: hold to carve a continuous arc, tap for a couple of degrees.
  // The cap is a lateral-acceleration limit rather than a constant, which is
  // what stops a supersonic pass turning on a sixpence — at 750 mph the same
  // full stick gives him a third of the yaw rate it gives him at cruise, and
  // his turning circle grows with the square of his speed, exactly as a real
  // one does. TURN_G is set high because he is a dragon: about 20 g.
  let   YAW_RATE_MAX  = 1.45;                 // rad/s, and only at low speed
  let   TURN_G        = 196;                  // m/s^2 of lateral acceleration
  const YAW_LAMBDA    = 3.6;                  // stick to turn rate
  const YAW_DAMP      = 6.0;                  // and the bleed-off on release
  const YAW_DEADZONE  = 0.02;                 // rad/s
  const MAX_BANK      = 1.00;                 // ~57 degrees at full turn rate
  const BANK_LAMBDA   = 4.6;
  const ALIGN_TOLERANCE = 0.02;

  // --- Sideslip ----------------------------------------------------------
  const STRAFE_MAX    = 26;                   // m/s sideways, heading unchanged
  const STRAFE_ACCEL  = 90;                   // m/s^2
  const STRAFE_DAMP   = 4.2;

  const PITCH_MAX     = 0.72;                 // visual nose attitude
  const PITCH_LAMBDA  = 4.5;
  const AOA_SLOW      = 0.22;                 // nose held high when he's slow
  const BOB_SPEED     = 0.9;                  // m/s of idle bob
  const BOB_FREQ      = 1.1;                  // Hz

  // Retrimmable by the debug console; W alone accelerates toward this.
  let currentForwardSpeed = SPEED_CRUISE;

  let bursting      = false;

  // --- Knife edge ---------------------------------------------------------
  // Hold to roll onto a wingtip and slip through a vertical gap. It runs on a
  // stamina budget so it stays a deliberate move rather than a flight mode.
  const KNIFE_ANGLE   = 1.45;  // ~83 degrees of roll
  const KNIFE_IN      = 3.2;   // roll onto the wing decisively
  const KNIFE_OUT     = 5.2;   // but snap level again the moment you let go
  const KNIFE_HOLD    = 3.0;   // seconds of stamina
  const KNIFE_RECOVER = 2.0;   // seconds to refill from empty
  const KNIFE_SINK    = 22;    // m/s of lost lift at full deflection
  const KNIFE_YAW     = 0.35;  // rad/s — a wing down pulls the nose that way
  const KNIFE_TREMBLE = 0.022; // he can't hold it perfectly still
  let knifeAmount = 0;         // smoothed, -1 (right wing down) .. +1 (left down)
  let knifeCharge = KNIFE_HOLD;

  // Life size. The GLB is 8.6 m nose to tail and 15.1 m across the wings at
  // scale 1, against DreamWorks' published 7.9 m and 13.7 m — so this is the
  // scale that makes him the dragon the films measured, in a world whose other
  // props are already in metres.
  dragon.scale.setScalar(1);
  // Yaw first, then pitch and roll in his own frame — the aircraft convention.
  // With the default XYZ order, rotation.x pitches about the WORLD x axis, so
  // it silently turns into a roll once he's flying east or west.
  dragon.rotation.order = "YXZ";

  let strafeVel   = 0;   // m/s, sideways
  let climbVel    = 0;   // m/s, straight up. Owned by Space/Ctrl and nothing else
  // "level" is the ordinary flight model and the only state the old code had.
  // The other four are the zoom climb and what it costs — see the constants.
  let mode        = "level";   // level | zoom | stall | dive | recover
  let modeT       = 0;         // seconds in the current state
  let stalled     = false;     // true for one frame when the wings let go
  let recoverHold = 0;         // s of keeping the speed a dive earned
  let diveCommit  = 0;         // s of dive he cannot pull out of, after a stall
  let pathAngle   = 0;   // radians off the horizontal — derived, for the visuals
  let airspeed    = SPEED_CRUISE;
  let currentRoll  = 0;
  let currentPitch = 0;
  let heading   = null;  // lazily seeded from the camera on frame one
  let yawRate   = 0;     // rad/s
  let yawMaxNow = YAW_RATE_MAX;
  let alignTarget = null; // set by H, cleared on manual input or arrival
  let activeSpeed = airspeed;
  let elapsed = 0;

  // --- Rumble ---
  // These are magnitudes handed to the mixer in gamepad.js, never effects played
  // straight at the actuator — see the note there for why that distinction
  // matters. Weak motor is the buzzy one, strong motor is the thumpy one.
  //
  // Nothing here is a resting level. A driving game never hums — what shakes
  // the car is the surface under it, the revs, a kerb, a wheel letting go, and
  // every one of those is an event with a shape. A DC level on the motor reads
  // as a fault in the pad after about a minute, and worse, it buries everything
  // quieter than itself. Silence in level flight is what makes the rest audible.
  const RUMBLE_BUFFET       = 0.40; // airframe shake, and only well past cruise
  const BUFFET_ONSET        = 0.55; // fraction of his range before it starts
  const RUMBLE_BURST_KICK   = 1.00; // the shove when a burst fires
  const RUMBLE_BURST_HOLD   = 0.62; // while it's still running
  const RUMBLE_KNIFE        = 0.30; // wing loaded up on its edge
  const RUMBLE_KNIFE_STRAIN = 0.48; // and climbing as his stamina drains
  const RUMBLE_CARVE        = 0.22; // load through a hard banked turn
  const RUMBLE_THROTTLE     = 0.30; // while he's GAINING speed, not while held
  const RUMBLE_BRAKE        = 0.40; // L2 held down — a grind on the weak one

  // --- Trigger feel ---
  // The driving-game school: the pedals have real weight from the first
  // millimetre and they keep it. Resistance is the resting state, not news the
  // game delivers — you shouldn't be able to tell the pad is doing anything
  // until you notice how much effort R2 takes. Vibration is held back for one
  // event so it still means something when it arrives.
  const TRIG_GAS_BASE   = 0.52; // R2 at cruise — firm under the finger
  const TRIG_GAS_TOP    = 0.82; // heavier the closer he is to his limit
  const TRIG_BRAKE_BASE = 0.66; // the brake is the heavier pedal, as it should be
  const TRIG_BRAKE_TOP  = 1.00;

  // The one event: he's genuinely piling on speed, not merely holding the gas
  // open. Measured as how much of his range he's currently eating, so it fades
  // out on its own as he reaches whatever you asked for — a car that's found
  // its grip stops scrabbling. Two thresholds, because a single one sitting
  // near the crossover would chatter between the two effect modes.
  const TRIG_SURGE_BUZZ  = 0.34; // slight. This is a texture, not a rumble.
  const TRIG_SURGE_ENTER = 0.30;
  const TRIG_SURGE_EXIT  = 0.14;
  let surging = false;

  let wasAtSpeedLimit = false;
  let padClimbInvert = true; // pull back to climb, the flight-stick convention

  const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

  // While the debug console has focus, keystrokes belong to it, not the dragon.
  function typingInConsole() {
    const el = document.activeElement;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  }

  window.addEventListener("keydown", (e) => {
    if (typingInConsole()) return;
    if (!keys[e.code]) keysJustPressed[e.code] = true;
    keys[e.code] = true;
    // Stop the page scrolling out from under the canvas.
    // Whatever the current scheme claims, the page does not get: Space scrolls,
    // the arrows scroll, and "/" opens quick-find in some browsers.
    if (claimedKeys().has(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  /** True on the frame any key bound to `action` went down. */
  function pressedAction(action) {
    for (const code in keysJustPressed) {
      if (keysJustPressed[code] && isAction(action, code)) return true;
    }
    return false;
  }
  // Right mouse is the other burst button, for a hand already on the mouse.
  // Right mouse used to be the other top-gear button. It is AIM now — that is
  // what right mouse means in every game that has both — so top gear is the
  // keyboard key, B, and Cross. See js/aim.js.
  window.addEventListener("contextmenu", (e) => {
    if (document.pointerLockElement) e.preventDefault();
  });

  function update(dt = 0.016) {
    if (!dragon) return;
    // A tab that has been in the background hands back a huge first dt. At 335
    // m/s that is a teleport through a mountain, so cap it.
    dt = Math.min(dt, 0.05);
    elapsed += dt;

    const camYaw = getCamYaw();
    if (heading === null) heading = camYaw + Math.PI; // no 180 spin on spawn

    const padOn = pad ? pad.connected() : false;

    // --- Align to camera (H / D-pad up) ---
    // D-pad up points him at the camera, D-pad down brings the camera round to
    // him. Same job from either end, mirrored on the stick.
    if (pressedAction("alignDragon") || (padOn && pad.pressed(BTN.DUP))) {
      alignTarget = camYaw + Math.PI;
    }

    // --- Forward and back (W / S, or the left stick) -----------------------
    // The standard flying-mount scheme and nothing cleverer: W flies him
    // forward, Shift is the sprint on top of it, S backs him off, and letting
    // go of both stops him. Stopped IS the hover — there is no mode to enter.
    //
    // This replaces a throttle that lived on the triggers and returned to a
    // cruise you could retrim. That was a nice pedal and nobody could find it:
    // "forward" was not a key at all, he simply always flew, and W — the key
    // every player on earth reaches for to go forward — pitched him at the sky.
    let moveInput = 0;
    if (heldIn(keys, "forward")) moveInput += 1;
    if (heldIn(keys, "back"))    moveInput -= 1;
    const sprinting = heldIn(keys, "sprint");

    if (padOn) {
      // Stick forward reads as -y. Squared so the middle of the stick's travel
      // sits near the cruise speed and the top end is the sprint — one analog
      // axis covering everything W and Shift cover between them.
      const fwd = -pad.ly;
      if (Math.abs(fwd) > 0.02) {
        moveInput = THREE.MathUtils.clamp(moveInput + Math.sign(fwd) * fwd * fwd, -1, 1);
      }
      if (pad.pressed(BTN.L3)) currentForwardSpeed = SPEED_CRUISE;
    }

    // What he is being asked to do, in m/s.
    const top = sprinting ? Math.max(PEDAL_MAX, currentForwardSpeed) : currentForwardSpeed;
    let pedalTarget;
    if (moveInput > 0)      pedalTarget = moveInput * top;
    else if (moveInput < 0) pedalTarget = moveInput * REVERSE_SPEED;
    else                    pedalTarget = 0;
    // Kept for the rumble mixer below, which wants to know whether he is being
    // driven or coasting rather than which key did it.
    const throttle = moveInput;

    // --- Top gear (held: the burst key, right mouse, or Cross) ---
    // Held, not tapped. Space used to fire this; Space is "up" now, the way it
    // is in every game with a flying mount, so the signature move has its own
    // key and that key is a throttle position rather than a trigger.
    const wasBursting = bursting;
    bursting = heldIn(keys, "burst") || (padOn && pad.held(BTN.CROSS));

    // The kick is on the EDGE, not on the hold — it is the shove of getting
    // there, and sustaining it for as long as the player holds the key would
    // turn the one moment of physical feedback in the game into background hum.
    if (bursting && !wasBursting) pad?.rumble.pulse(0.75, RUMBLE_BURST_KICK, 0.5);
    if (!bursting && wasBursting) pad?.rumble.pulse(0.28, 0.4, 0.3);

    for (const key in keysJustPressed) delete keysJustPressed[key];

    // One airspeed, chasing one target. Top gear simply outranks the pedal
    // while it is held, and comes off it fast enough that the drop back to
    // 400-odd is its own event.
    const speedTarget = bursting ? Math.max(BURST_SPEED, pedalTarget) : pedalTarget;
    const rate = bursting
      ? BURST_GAIN
      : (speedTarget > airspeed ? PEDAL_GAIN : (airspeed > PEDAL_MAX ? BURST_BLEED : PEDAL_BLEED));
    // Not while a manoeuvre owns him, and not for the moment after one. A zoom
    // climb that the throttle could top up is not a climb with a cost, and a
    // 900 mph dive whose speed bleeds away during the pull-up earns nothing.
    // `mode` is last frame's, which is a frame of lag nobody can see.
    if (mode === "level" && recoverHold <= 0) {
      airspeed += (speedTarget - airspeed) * damp(rate, dt);
    }
    recoverHold = Math.max(0, recoverHold - dt);

    // --- Knife edge (Z / X, or L1 / R1 held) ---
    let knifeWant = 0;
    if (heldIn(keys, "knifeL") || (padOn && pad.held(BTN.L1))) knifeWant =  1; // left wing down
    if (heldIn(keys, "knifeR") || (padOn && pad.held(BTN.R1))) knifeWant = -1; // right wing down

    if (knifeWant !== 0) {
      knifeCharge = Math.max(0, knifeCharge - dt);
    } else {
      knifeCharge = Math.min(KNIFE_HOLD, knifeCharge + dt * (KNIFE_HOLD / KNIFE_RECOVER));
    }

    // As he tires the deflection he can hold falls off, so he sags out of the
    // knife edge on his own rather than hitting a hard cutoff.
    const stamina = THREE.MathUtils.smoothstep(knifeCharge / KNIFE_HOLD, 0, 0.4);
    const knifeTarget = knifeWant * stamina;

    // Rolling in is decisive; coming out of it is a relax, not a snap.
    const knifeRate = Math.abs(knifeTarget) > Math.abs(knifeAmount) ? KNIFE_IN : KNIFE_OUT;
    knifeAmount += (knifeTarget - knifeAmount) * damp(knifeRate, dt);

    // --- Yaw (A/D, arrows, or the left stick) ---
    let turnInput = 0;
    if (heldIn(keys, "turnL")) turnInput += 1; // +heading is left
    if (heldIn(keys, "turnR")) turnInput -= 1;
    // Stick right is +x, and turning right means a falling heading.
    if (padOn) turnInput = THREE.MathUtils.clamp(turnInput - pad.lx, -1, 1);

    if (turnInput !== 0) alignTarget = null; // manual input always wins

    // What he can physically pull at this airspeed. A turn is lateral
    // acceleration, lateral acceleration is v * omega, and he has a finite
    // amount of it — so the faster he goes the lazier the arc, and a supersonic
    // pass has to be lined up rather than steered.
    yawMaxNow = Math.min(YAW_RATE_MAX, TURN_G / Math.max(airspeed, 1));

    if (alignTarget !== null) {
      // Drive the same rate-based turn toward the camera so H produces a real
      // banked sweep rather than a snap.
      const delta = angleDelta(heading, alignTarget);
      if (Math.abs(delta) < ALIGN_TOLERANCE) {
        alignTarget = null;
      } else {
        // Ease the rate down on approach so it settles instead of overshooting.
        const desired = THREE.MathUtils.clamp(delta * 1.6, -yawMaxNow, yawMaxNow);
        yawRate += (desired - yawRate) * damp(YAW_LAMBDA, dt);
      }
    } else if (turnInput !== 0) {
      // A part-deflected stick tops out at a proportionally lazier arc. Without
      // this an inch of stick would wind up to exactly the same rate as full
      // lock, just slower — which is what makes analog steering feel digital.
      const want = turnInput * yawMaxNow;
      yawRate += (want - yawRate) * damp(YAW_LAMBDA, dt);
    } else {
      yawRate *= Math.exp(-YAW_DAMP * dt);
      if (Math.abs(yawRate) < YAW_DEADZONE) yawRate = 0;
    }

    yawRate = THREE.MathUtils.clamp(yawRate, -yawMaxNow, yawMaxNow);
    heading += yawRate * dt;
    // On a wingtip he slices toward the low wing. Applied outside the clamp so
    // it reads as the maneuver dragging him round, not as extra steering.
    heading += knifeAmount * KNIFE_YAW * dt;
    // `heading` is the direction of TRAVEL. The GLB's nose points down local -Z,
    // so the model has to sit a half turn off the travel vector to face forward.
    dragon.rotation.y = heading + Math.PI;

    // --- Strafe (Q/E or Square/Circle): sideways, heading unchanged ---
    let strafeIn = 0;
    if (heldIn(keys, "strafeL") || (padOn && pad.held(BTN.SQUARE))) strafeIn -= 1;
    if (heldIn(keys, "strafeR") || (padOn && pad.held(BTN.CIRCLE))) strafeIn += 1;
    strafeVel += strafeIn * STRAFE_ACCEL * dt;
    if (strafeIn === 0) strafeVel *= Math.exp(-STRAFE_DAMP * dt);
    strafeVel = THREE.MathUtils.clamp(strafeVel, -STRAFE_MAX, STRAFE_MAX);

    // --- Up and down (Space / Ctrl, or R2 / L2) ----------------------------
    //
    // One axis, one job. This does not touch his speed and W does not touch
    // this, so "fly forward and hold your altitude" and "rise straight up
    // without drifting" are both just a key, rather than two things you have to
    // balance against each other.
    //
    // It used to be W/S driving a flight path ANGLE, which is lovely aircraft
    // physics and completely wrong for a creature that can stop in mid-air:
    // with no forward speed an angle carries you nowhere, so a hovering dragon
    // could not go up at all.
    let verticalInput = 0;
    if (heldIn(keys, "up"))   verticalInput += 1;
    if (heldIn(keys, "down")) verticalInput -= 1;
    if (padOn) {
      const v = pad.value(BTN.R2) - pad.value(BTN.L2);
      verticalInput = THREE.MathUtils.clamp(
        verticalInput + (padClimbInvert ? v : -v), -1, 1
      );
    }

    // --- Zoom, stall, dive, recover ---------------------------------------
    // One state machine over the same two keys. It only ever takes over when
    // he is going fast enough for the manoeuvre to mean anything; the rest of
    // the time `mode` is "level" and every line below this block runs exactly
    // as it did before.
    stalled = false;
    modeT += dt;
    const wantUp = verticalInput > 0.55, wantDown = verticalInput < -0.55;
    const setMode = (m) => { if (m !== mode) { mode = m; modeT = 0; } };

    if (mode === "level") {
      if (wantUp && airspeed >= CLIMB_ENTRY_SPEED) setMode("zoom");
      else if (wantDown && airspeed >= DIVE_ENTRY_SPEED) setMode("dive");
    } else if (mode === "zoom") {
      // Straight up, and it costs. Letting go levels him off with whatever he
      // has left, which is the skill in it: too long and the wings let go.
      airspeed = Math.max(0, airspeed - CLIMB_DRAG * dt);
      pathAngle += (Math.PI / 2 - pathAngle) * damp(NOSE_OVER_RATE, dt);
      if (!wantUp) setMode("recover");
      else if (airspeed <= STALL_SPEED) { setMode("stall"); stalled = true; }
    } else if (mode === "stall") {
      // He hangs, then the nose falls through of its own accord. Nothing the
      // player does here matters, which is the point of running out of speed.
      airspeed = Math.max(0, airspeed - CLIMB_DRAG * 0.35 * dt);
      if (modeT > STALL_HANG) {
        pathAngle += (-Math.PI / 2 - pathAngle) * damp(NOSE_OVER_RATE, dt);
        if (pathAngle < -0.7) { setMode("dive"); diveCommit = STALL_DIVE_COMMIT; }
      }
    } else if (mode === "dive") {
      // Height back into speed, past anything level flight can reach.
      pathAngle += (-Math.PI / 2 - pathAngle) * damp(NOSE_OVER_RATE, dt);
      airspeed = Math.min(DIVE_MAX, airspeed + DIVE_GRAVITY * dt * -Math.sin(pathAngle));
      diveCommit = Math.max(0, diveCommit - dt);
      // A dive he chose can be left whenever he likes. A dive he fell into has
      // to be ridden out.
      if ((!wantDown || wantUp) && diveCommit <= 0) setMode("recover");
    } else if (mode === "recover") {
      // The pull-up. The speed a dive earned is KEPT rather than bled off,
      // which is what makes the whole trade worth doing — see RECOVER_HOLD.
      pathAngle += (0 - pathAngle) * damp(RECOVER_RATE, dt);
      recoverHold = RECOVER_HOLD;
      if (Math.abs(pathAngle) < 0.10) {
        setMode("level");
        // Hand the path speed back to the level model as ground speed, so
        // coming out of a dive at 900 mph does not silently discard it.
        climbVel = 0;
      }
    }

    // While a manoeuvre owns him, the throttle does not: the pedal cannot pull
    // him out of a stall and gravity cannot be out-accelerated with a key.
    const manoeuvring = mode !== "level";

    // Fast dragons climb faster than slow ones, so the rate rides on airspeed —
    // but it never falls to nothing, because hovering and rising is exactly the
    // thing this axis exists to make possible.
    const vertRate = Math.min(
      VERT_HOVER + Math.abs(airspeed) * VERT_PER_SPEED, CLIMB_RATE_CAP
    );
    climbVel += (verticalInput * vertRate - climbVel) * damp(VERT_LAMBDA, dt);

    // --- Translation ------------------------------------------------------
    //
    // Two models, and which one runs depends on `mode`.
    //
    // LEVEL is the original and is untouched: ground speed along his heading,
    // altitude on a separate lift axis. It is a helicopter's model and it is
    // the right one for a creature that can stop in mid-air — with no forward
    // speed a flight-path ANGLE carries you nowhere, so a hovering dragon
    // could not go up at all.
    //
    // MANOEUVRING is an aeroplane's: one speed along one flight path, which is
    // the only way "straight up" can mean straight up. `airspeed` stops being
    // ground speed and becomes speed along the path, so at the top of a zoom
    // his ground speed really is zero and he really does hang there.
    let climbRate;
    if (!manoeuvring) {
      activeSpeed = airspeed;

      // Wings vertical means almost no lift, so he sinks. Holding a knife edge
      // through a gap costs you altitude unless you pull up into it.
      climbRate = climbVel
        - Math.abs(knifeAmount) * KNIFE_SINK
        + Math.sin(elapsed * BOB_FREQ * Math.PI * 2) * BOB_SPEED;

      // Which way his nose points is DERIVED from where he is actually going
      // rather than being the thing you steer. The reference speed in the
      // denominator is what keeps a climb from a standstill reading as a dragon
      // tilting back to gain height instead of one standing on his tail.
      const pathTarget = Math.atan2(
        climbRate, Math.max(Math.abs(activeSpeed), PATH_REF_SPEED)
      );
      pathAngle += (pathTarget - pathAngle) * damp(PITCH_LAMBDA, dt);

      dragon.position.x += Math.sin(heading) * activeSpeed * dt;
      dragon.position.z += Math.cos(heading) * activeSpeed * dt;
      dragon.position.y += climbRate * dt;
    } else {
      // pathAngle was set by the state machine above; nothing derives it here.
      activeSpeed = airspeed * Math.cos(pathAngle);
      climbRate   = airspeed * Math.sin(pathAngle);
      climbVel    = climbRate;   // so the wing rig and the HUD still read right

      dragon.position.x += Math.sin(heading) * activeSpeed * dt;
      dragon.position.z += Math.cos(heading) * activeSpeed * dt;
      dragon.position.y += climbRate * dt;
      // Ground speed is what the rest of the file means by activeSpeed, but a
      // vertical dragon at 300 m/s is not doing 0 mph. Report the path speed.
      activeSpeed = airspeed;
    }

    dragon.position.x -= Math.cos(heading) * strafeVel * dt;
    dragon.position.z += Math.sin(heading) * strafeVel * dt;

    // --- Roll ---
    // Signs are set for the half-turned model: +roll drops the left wing, which
    // is what you want banking into a left (+yawRate) turn. Knife edge takes
    // over from ordinary banking as it comes on rather than fighting it.
    // Banking is how a wing turns, so it only makes sense once there is air
    // going over it. Spinning on the spot in a hover is flat, the way a
    // helicopter's is, and the bank fades in as he picks up speed.
    const bankScale = THREE.MathUtils.clamp(activeSpeed / SPEED_CRUISE, 0, 1);
    const bank = ((yawRate / Math.max(yawMaxNow, 1e-4)) * MAX_BANK
               - (strafeVel / STRAFE_MAX) * 0.30) * bankScale;
    const knifeBlend = Math.abs(knifeAmount);
    // Nothing alive holds a wingtip-down attitude perfectly still.
    const tremble = Math.sin(elapsed * 18.6) * Math.sin(elapsed * 7.8) * KNIFE_TREMBLE * knifeBlend;
    const targetRoll = knifeAmount * KNIFE_ANGLE + (1 - knifeBlend) * bank + tremble;
    currentRoll += (targetRoll - currentRoll) * damp(BANK_LAMBDA, dt);
    dragon.rotation.z = currentRoll;

    // --- Pitch ---
    // His nose sits on the flight path, plus the angle of attack he needs to
    // hold himself up — which is large when he is slow and nearly nothing at
    // speed. That is why a slow pass looks like he is hanging off his wings and
    // a fast one looks like a thrown spear.
    const slowT = 1 - THREE.MathUtils.clamp((activeSpeed - SPEED_MIN) / (SPEED_CRUISE * 2), 0, 1);
    // PITCH_MAX caps the nose at 41 degrees in level flight, which is a limit
    // on how far his ATTITUDE may run ahead of his flight path. In a zoom or a
    // dive the flight path IS vertical, so the cap has to open up or he goes
    // straight up while pointing forty degrees off it.
    const pitchLimit = manoeuvring ? Math.PI / 2 + 0.08 : PITCH_MAX;
    const targetPitch = THREE.MathUtils.clamp(
      pathAngle + (manoeuvring ? 0 : slowT * AOA_SLOW) + knifeBlend * 0.14,
      -pitchLimit, pitchLimit
    );
    currentPitch += (targetPitch - currentPitch) * damp(PITCH_LAMBDA, dt);
    dragon.rotation.x = currentPitch;

    // --- Rumble ---------------------------------------------------------
    if (pad) {
      // Normalised against the PEDAL range rather than the burst, so ordinary
      // cruising sits in the middle of the curve. Against the burst speed,
      // cruise came out at a tenth of full scale and you could feel nothing.
      const windT = THREE.MathUtils.clamp(
        (activeSpeed - SPEED_MIN) / (PEDAL_MAX - SPEED_MIN), 0, 1.5
      );

      // Airframe buffet. Below the onset there is nothing at all — cruising is
      // meant to be silent — and above it what arrives is a texture with a
      // rhythm rather than a level. Two sines at frequencies that don't divide
      // into each other, so it never settles into a pattern you stop noticing;
      // the same reason a car shaking on a straight feels like the track and
      // not like the controller.
      const buffetT = THREE.MathUtils.clamp(
        (windT - BUFFET_ONSET) / (1 - BUFFET_ONSET), 0, 1
      );
      if (buffetT > 0) {
        const shake = 0.5 + 0.5 * Math.sin(elapsed * 49.8) * Math.sin(elapsed * 17.4);
        pad.rumble.sustain(
          RUMBLE_BUFFET * buffetT * buffetT * shake,
          0.07 * buffetT * shake
        );
      }

      // Load through a carve — you feel a hard turn in your palms.
      const carve = Math.abs(yawRate) / Math.max(yawMaxNow, 1e-4);
      pad.rumble.sustain(RUMBLE_CARVE * carve * carve, 0.10 * carve);

      // Knife edge: a wing held on its edge is a wing under strain, and the
      // strain climbs as his stamina runs out. The flutter is the same idea as
      // the visual tremble — nothing alive holds this attitude cleanly.
      if (knifeBlend > 0.01) {
        const strain = 1 - knifeCharge / KNIFE_HOLD;
        const flutter = 0.78 + 0.22 * Math.sin(elapsed * 54);
        pad.rumble.sustain(
          (RUMBLE_KNIFE + RUMBLE_KNIFE_STRAIN * strain) * knifeBlend * flutter,
          0.10 * knifeBlend * strain
        );
      }

      if (bursting) {
        // A steady hard note while he is held at it. There is no timer to spend
        // any more, so this does not fall off — it is the sound of the airframe
        // at its limit, and it stops when the player lets go.
        pad.rumble.sustain(0.30, RUMBLE_BURST_HOLD);
      }

      // --- Acceleration, and the two triggers ---
      // How far up his range he currently is, and how much of the range he is
      // eating right now. The second is the difference between accelerating and
      // merely going fast, and it is what the motors key off — holding W at a
      // settled 400 mph should feel like nothing much, because it is.
      const pedalT = THREE.MathUtils.clamp(activeSpeed / PEDAL_MAX, 0, 1);
      const surge  = THREE.MathUtils.clamp(
        (pedalTarget - activeSpeed) / PEDAL_MAX, 0, 1
      );
      surging = surge > (surging ? TRIG_SURGE_EXIT : TRIG_SURGE_ENTER);

      // Winding up thumps on the strong motor; backing off grinds on the weak
      // one — two different textures, so you can tell them apart with your eyes
      // shut.
      if (throttle > 0) {
        pad.rumble.sustain(
          RUMBLE_THROTTLE * 0.4 * surge,
          RUMBLE_THROTTLE * surge * (0.5 + 0.5 * pedalT)
        );
      } else if (throttle < 0) {
        pad.rumble.sustain(
          RUMBLE_BRAKE * -throttle * (0.4 + 0.6 * pedalT),
          RUMBLE_BRAKE * 0.35 * -throttle
        );
      }

      // The triggers are the altitude axis now rather than a gas pedal, so
      // what they weigh is the effort of shifting him vertically — which rises
      // with airspeed, because that is what the climb rate does. Both stay
      // heavy whether or not you are touching them: that weight IS the effect,
      // and you should only notice it as how much work R2 takes. The texture on
      // top arrives while he is genuinely still gaining, and goes quiet once he
      // has settled at whatever you asked for.
      const effort = THREE.MathUtils.clamp(
        (VERT_HOVER + activeSpeed * VERT_PER_SPEED) / CLIMB_RATE_CAP, 0, 1
      );
      pad.rumble.triggers(
        TRIG_BRAKE_BASE + (TRIG_BRAKE_TOP - TRIG_BRAKE_BASE) * effort,
        TRIG_GAS_BASE   + (TRIG_GAS_TOP   - TRIG_GAS_BASE)   * effort
      );
      if (surging && throttle > 0.05) {
        pad.rumble.triggerBuzz(0, TRIG_SURGE_BUZZ * surge);
      }

      // A single detent when he reaches either end of his speed range, so you
      // know you are pinned without having to look at the HUD.
      const atLimit = throttle !== 0 && !bursting &&
        (activeSpeed >= PEDAL_MAX - 1 || activeSpeed <= 1);
      if (atLimit && !wasAtSpeedLimit) pad.rumble.pulse(0.4, 0.15, 0.1);
      wasAtSpeedLimit = atLimit;
    }
  }

  // 0 at a dead stop, 1 flat out in a burst — which is to say 1 is 750 mph.
  // One definition, so the camera, the wing rig and the HUD can't drift apart.
  const speedRatio = () =>
    THREE.MathUtils.clamp((activeSpeed - SPEED_MIN) / (BURST_SPEED - SPEED_MIN), 0, 1);

  return {
    update,
    getHeading:  () => heading ?? 0,
    /** Hand the heading back after something else has been steering him — a
     *  landing, a walk across an island, a cutscene. Without this, taking off
     *  snaps him round to wherever he was pointed when he touched down. */
    setHeading(h) { heading = h; dragon.rotation.y = h + Math.PI; },
    /** Metres per second. */
    getSpeed:    () => activeSpeed,
    getSpeedMph: () => activeSpeed / MPH,
    getSpeedT:   speedRatio,
    /** Metres per second along his nose. The plasma needs it — see plasma.js. */
    getAirspeed: () => airspeed,
    /**
     * Which vertical manoeuvre owns him: level, zoom, stall, dive, recover.
     * The HUD names it and the sound bed keys off it — a stall is the one
     * moment in the flight model the player did not ask for and has to be told
     * about, because the controls stop answering for about half a second.
     */
    getMode: () => mode,
    /** True for the single frame the wings let go at the top of a zoom. */
    didStall: () => stalled,
    /**
     * 0..1 of his total energy budget, height and speed together, against what
     * a flat-out dive from the ceiling would be worth. This is the number the
     * zoom and the dive actually move, so it is the honest thing to draw.
     */
    getEnergy: (agl = 0) => THREE.MathUtils.clamp(
      (airspeed / DIVE_MAX) * 0.6 + Math.min(1, agl / 900) * 0.4, 0, 1),
    /** How close he is to running out of airspeed on the way up. */
    getStallT: () => mode === "zoom"
      ? 1 - THREE.MathUtils.clamp((airspeed - STALL_SPEED) /
            (CLIMB_ENTRY_SPEED - STALL_SPEED), 0, 1)
      : 0,
    /** How far up his range the sustained throttle has him, burst excluded. */
    getPedalT:   () => THREE.MathUtils.clamp(
      (activeSpeed - SPEED_MIN) / (PEDAL_MAX - SPEED_MIN), 0, 1),
    getClimb:    () => THREE.MathUtils.clamp(climbVel / CLIMB_RATE_CAP * 3, -1, 1),
    /** Raw m/s straight up, signed. The impact model needs the real number. */
    getVerticalSpeed: () => climbVel,
    /**
     * Take a fraction of his speed away, and drop whatever manoeuvre he was in.
     *
     * For arriving badly. It also cancels the state machine on purpose: a dive
     * that ends in a cliff face should not carry on being a dive, and `recover`
     * would otherwise protect the speed the crash was supposed to take.
     */
    bleedSpeed(fraction) {
      airspeed *= Math.max(0, 1 - fraction);
      climbVel *= 0.2;
      mode = "level"; modeT = 0; recoverHold = 0; diveCommit = 0;
    },
    /** Radians off the horizontal — the camera uses this to lead him. */
    getPathAngle: () => pathAngle,
    getYawRate:  () => yawRate,
    /** -1..1 of everything he can currently pull. Drives the camera lean. */
    getTurnT:    () => THREE.MathUtils.clamp(yawRate / Math.max(yawMaxNow, 1e-4), -1, 1),
    getRoll:     () => currentRoll,
    isTurning:   () => Math.abs(yawRate) > YAW_DEADZONE * 4,
    isBursting:  () => bursting,

    // Drives the wing rig.
    getFlightState: () => ({
      climb:  THREE.MathUtils.clamp(climbVel / CLIMB_RATE_CAP * 3, -1, 1),
      speedT: speedRatio(),
      knife:  knifeAmount,
      // How hard he is carving, -1 .. +1. js/flightrig.js steers the tail fins
      // and leans his head with it; wings.js ignores it.
      turn:   THREE.MathUtils.clamp(yawRate / Math.max(yawMaxNow, 1e-4), -1, 1),
    }),
    getKnifeCharge: () => knifeCharge / KNIFE_HOLD,

    // --- debug console hooks ---
    /** Peak turn rate in rad/s at low speed. The high-speed cap is TURN_G. */
    getTurnRate: () => YAW_RATE_MAX,
    setTurnRate(v) {
      YAW_RATE_MAX = THREE.MathUtils.clamp(v, 0.1, 4);
      TURN_G = YAW_RATE_MAX * 135;  // keep the speed falloff proportional
      return YAW_RATE_MAX;
    },
    getCruiseSpeed: () => currentForwardSpeed,
    setCruiseSpeed(v) {
      currentForwardSpeed = THREE.MathUtils.clamp(v, 0, 400);
      return currentForwardSpeed;
    },
    getClimbInvert: () => padClimbInvert,
    setClimbInvert(v) { padClimbInvert = !!v; return padClimbInvert; },
    /**
     * Hands off the controls — the debug console calls this when it opens, so
     * typing does not fly him into a cliff.
     *
     * It also has to drop the manoeuvre. Zeroing `pathAngle` on its own left
     * `mode` saying "zoom" with a flight path along the horizontal, and since
     * a manoeuvre integrates position from the path, he then flew level while
     * the state machine went on draining his airspeed for the climb. That is
     * also why `flight` in the console reported 0° in the middle of a zoom:
     * asking the question is what flattened it.
     */
    clearKeys() {
      for (const k in keys) keys[k] = false;
      strafeVel = 0;
      pathAngle = 0;
      yawRate = 0;
      mode = "level"; modeT = 0; recoverHold = 0; diveCommit = 0;
    },
  };
}
