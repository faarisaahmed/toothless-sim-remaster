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

/**
 * The double-tap gate, as one small machine per axis.
 *
 * "Press and hold is the gentle version, double-tap and hold is the committed
 * one" is now the grammar of two different controls — up/down for the zoom and
 * the dive, left/right wingtip for the barrel roll — and it is exactly the kind
 * of fiddly edge-case logic that goes subtly wrong when it is written twice.
 * The awkward cases are all in here once: a lean that ends must not leave a tap
 * behind (or a lean, a release and a lean commits), the arming has to survive
 * for the whole of the second press rather than being re-tested per frame, and
 * a reversal has to reset everything so a fumble cannot fling him anywhere.
 *
 * @param {number} tapMax  s — a press shorter than this counted as a tap
 * @param {number} gap     s — and the next press has to follow inside this
 */
function makeTapGate(tapMax, gap) {
  let held = 0;       // s the axis has been held its current way
  let dir = 0;        // which way, 0 when centred
  let tapDir = 0;     // direction of the last completed short press
  let age = 99;       // s since that tap was released
  let armed = false;  // this press was preceded by a tap
  let fired = false;  // ...and this is the single frame it became true

  return {
    /** @param {number} want -1, 0 or +1, off whatever the axis reads. */
    update(dt, want) {
      age += dt;
      fired = false;
      if (want !== 0 && want === dir) { held += dt; return; }
      // Centred, or reversed. Decide what the press that just ended was.
      if (dir !== 0) {
        if (held > 0 && held <= tapMax) { tapDir = dir; age = 0; }
        else tapDir = 0;
      }
      held = 0;
      dir = want;
      armed = want !== 0 && want === tapDir && age <= gap;
      if (armed) { tapDir = 0; fired = true; }   // one tap arms one press
    },
    /** True for as long as the armed press lasts. */
    get armed() { return armed; },
    /** True only on the frame the armed press began — for one-shot actions. */
    get fired() { return fired; },
    /** Seconds the current press has lasted. */
    get held() { return held; },
    /** Which way it is being held, 0 when centred. */
    get dir() { return dir; },
    reset() { held = 0; dir = 0; tapDir = 0; age = 99; armed = false; fired = false; },
  };
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
  // --- How the axis commits to a manoeuvre ---------------------------------
  //
  // DOUBLE-TAP AND HOLD. Press-and-hold is a TRIM — the gentle thing, a nudge
  // up or down and nothing more, however long you lean on it. Tap the same key
  // again and keep it down and he commits: stands on his tail, or puts his nose
  // through the floor.
  //
  // This replaced a pure time gate (hold for 0.42 s and it commits), and the
  // time gate was wrong for the same reason a hair trigger is. Losing a little
  // height at speed is the single most common thing this axis is asked to do —
  // an approach, a pass over a shoal, dropping under a ridge — and all of those
  // take longer than half a second, so the ordinary use of the key kept turning
  // into a committed dive nobody asked for. There was no way to say "a bit"
  // and mean it.
  //
  // A double tap cannot be arrived at by accident, so the two things separate
  // cleanly: one press is adjustment, two is commitment. It is also the same
  // grammar everywhere — keyboard, trigger, and the touch buttons, which send
  // real key events (see touch.js).
  //
  // The second press still has to be HELD, because the manoeuvre is a hold:
  // letting go levels him off, and a double tap with nothing after it should
  // not fling him into a stall.
  const TAP_MAX           = 0.30;   // s — a press shorter than this was a tap
  const DOUBLE_GAP        = 0.34;   // s — and the next press has to follow inside this
  const MANOEUVRE_HOLD    = 0.10;   // s the *second* press is held before it bites
  // What a trim is worth. Fixed rather than scaled by airspeed, which is the
  // whole point of it: the ordinary lift axis gives 9 + 0.45·airspeed, and at
  // 335 m/s that is a 140 m/s climb — the opposite of a small adjustment.
  const TRIM_RATE         = 26;               // m/s
  const CLIMB_DRAG        = 34;               // m/s^2 of airspeed spent climbing
  // ...plus this much per (m/s)^2, because drag is not a constant and a climb
  // that took eleven seconds to bleed 335 m/s off did not read as costing
  // anything. With this, going vertical at 750 mph runs out in about four
  // seconds and you can watch the number fall the whole way.
  const CLIMB_DRAG_V2     = 6.0e-4;
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

  // --- The drop: a fast descent that is not a dive --------------------------
  //
  // Down had exactly two settings, and the gap between them was the size of the
  // whole flight model: a hold trims him down at 26-34 m/s, and a double tap at
  // dive speed puts his nose through the floor at 900 mph. There was nothing in
  // between — no way to get DOWN quickly, on purpose, while still flying.
  //
  // So the double tap now reads the speed he is already doing and gives him the
  // one that fits. Dashing, it is the dive it always was. Not dashing, it is
  // this: a steep, controlled descent at 75 m/s with his heading and his
  // steering intact, about twice what leaning on the key gives him. He is
  // falling, not committing.
  //
  // It stays on the LEVEL translation model rather than the manoeuvring one,
  // and that is the whole difference. A dive is one speed along one flight path
  // and the controls stop arguing; a drop is the ordinary helicopter model with
  // the lift axis pushed hard over, so he can still turn, still strafe, still
  // pull out the instant he lets go. And it caps its own speed just under the
  // dive threshold, so leaning on it never quietly becomes the thing he chose
  // not to do.
  const DROP_SINK   = 75;                      // m/s down
  const DROP_LAMBDA = 3.0;                     // how fast the sink arrives
  const DROP_SPEED  = DIVE_ENTRY_SPEED * 0.86; // ...and the airspeed it settles at
  const DROP_DRAG   = 1.4;                     // how fast it gets there

  // --- The barrel roll ------------------------------------------------------
  //
  // Double-tap a wingtip key and he corkscrews. Not an aileron roll — that is a
  // spin about his own length that goes nowhere and is worth nothing but the
  // look of it. A barrel roll is a HELIX: the nose scribes a circle around the
  // line he was already flying, so he rolls all the way over AND steps bodily
  // sideways and up and back, ending on the heading he started on, a wingspan
  // and a half from where he would have been.
  //
  // That displacement is the entire point, and it is why this is the answer to
  // being shot at. A hunter's launcher solves a lead on where he is going (see
  // bolas.js); a barrel roll makes that solution wrong, without giving up the
  // heading, and it costs the same wing stamina the knife edge spends.
  //
  // TIGHT, AND IT ENDS OFF THE LINE. Both of those are corrections.
  //
  // The first version took a second flat and described a sixty-metre barrel. On
  // a control you reach for because something is already in the air that is not
  // a manoeuvre, it is a cutscene: you press it, he swings out and round and
  // lands back where he was, and the whole thing is over the horizon of the
  // moment it was for. So it is about half as long now and the barrel is a
  // third of the width — it snaps.
  //
  // The second is the one that actually mattered. A textbook barrel roll comes
  // back to the line it left, and a manoeuvre that comes back to the line does
  // not dodge anything: he was home and level again before the weight arrived,
  // so pressing the dodge button on seeing the shot got him hit, and only
  // leaving it dangerously late worked. That is a lovely piece of theory and a
  // miserable thing to play. So the helix now walks: it steps him bodily to the
  // side he rolled toward and LEAVES him there, which is what a pilot flying
  // one to break a gun solution is doing anyway. Press it any time between the
  // launch and the arrival and the weight goes through where he was.
  //
  // Positive g the whole way round, which is what separates it from a roll: he
  // pulls up into it, goes over the top, and comes down the other side. He is
  // never hanging in his straps, so nothing about the flight model has to
  // pretend to be upside down.
  const ROLL_TIME    = 0.58;   // s for the full turn at cruise
  const ROLL_TIME_FAST = 0.46; // ...and flat out, where everything happens sooner
  // --- Why the barrel is nearly flat now -----------------------------------
  //
  // It used to swing him out and back by two radii — sixteen metres at cruise,
  // sixty flat out. He is fifteen metres across the wings, so a sixteen-metre
  // lateral excursion timed with a 360-degree roll puts the apparent centre of
  // rotation almost exactly at his own WINGTIP. That is not a figure of speech:
  // rotate a body about its own axis while translating it round a circle of
  // radius equal to its half-span and the far wingtip is the one point that
  // barely moves. It read as a dragon nailed to a pole by one wing and spun,
  // because geometrically that is what it was.
  //
  // So the out-and-back is now a few metres — a hint of a corkscrew — and the
  // work is done by ROLL_SHIFT, which is monotonic and therefore reads as a
  // slide rather than as a swing. He rolls about himself and slides out from
  // under what was aimed at him, which is both the dodge and the shape the eye
  // expects.
  const ROLL_BULGE_SLOW = 2.5; // m of out-and-back at a crawl
  const ROLL_BULGE_FAST = 5;   // ...and flat out
  // The vertical arc, up over the top and down the far side. Kept small for the
  // same reason: it nets to zero either way, and a big one is another swing.
  const ROLL_RISE_SLOW  = 4;   // m
  const ROLL_RISE_FAST  = 8;   // m
  // ...and the step sideways he keeps. Comfortably more than the six metres a
  // bola needs to be within (bolas.js HIT_R) plus the width of the dragon, at
  // every speed, so a roll flown at any point in the weight's flight is a miss
  // rather than a coin toss.
  const ROLL_SHIFT_SLOW = 20;  // m
  const ROLL_SHIFT_FAST = 34;  // m
  // How much of the turn is eased. 0 is a constant roll rate — instant, and it
  // corners visibly at both ends; 1 is zero rate at both ends, which is the
  // smooth version and reads as slow to start. This is the snappy end of the
  // middle: he is at two-thirds rate on the first frame, so it BITES.
  const ROLL_EASE    = 0.35;
  // How much of the bottom of the barrel he actually flies. A true one is
  // symmetric about the entry line; this one is flattened underneath, because
  // the half of it that goes DOWN is the half that meets a ridge, and a
  // manoeuvre that kills you for using it near the ground is a manoeuvre nobody
  // uses. He still dips, just not by the full radius.
  const ROLL_UNDER   = 0.45;
  // Small, and smaller than it was: over half a second a big nose-up/nose-down
  // nod stops reading as the pull that holds a barrel roll together and starts
  // reading as a bobble.
  const ROLL_PITCH   = 0.13;   // rad of nose-up over the top and down the far side
  // Wing stamina, shared with the knife edge. Cheap enough to fly two in a row
  // under fire and then wait — being unable to dodge because you dodged is the
  // correct cost, being unable to dodge twice in a raid is not.
  const ROLL_COST    = 0.85;   // s of the three-second bar
  const ROLL_DRAG    = 0.07;   // fraction of airspeed it costs
  // A tap on a wingtip key is also the start of a knife edge, so the two have to
  // be told apart by the same clock the vertical axis uses.
  const ROLL_TAP_MAX = 0.26;   // s
  const ROLL_GAP     = 0.32;   // s

  // --- The edge of the chart ------------------------------------------------
  //
  // The height field is a ten-kilometre square and every island in it is inside
  // a chebyshev 5,260 from the middle. Past that there is nothing but the ocean
  // disc, and past 5,000 there is not even terrain — the mesh has ended, and
  // what the player gets for their trouble is water with no bottom drawn under
  // it, forever, until they turn round out of boredom.
  //
  // Measured as a SQUARE rather than a circle, because the world is one: a
  // circle inscribed in the mesh would fence off the four outermost islands,
  // and one drawn round them would let him off the mesh entirely along the
  // axes. Chebyshev distance is the shape of the thing being bounded.
  //
  // It is a current, not a wall. Nothing stops, nothing is refused, no message
  // interrupts: his heading is bent back toward the middle, gently at the ring
  // and firmly a kilometre past it, and only ever when he is actually pointed
  // OUTWARD — flying along the edge or coming home costs him nothing. The
  // horizon islands are out there for him to look at while it happens
  // (horizon.js), so the reason is visible rather than administrative.
  const EDGE_SOFT   = 5400;   // m per axis, just past the last island's shore
  const EDGE_HARD   = 6400;   // ...and where it stops being a suggestion
  const EDGE_TURN   = 0.62;   // rad/s of heading at the hard edge, at full outward

  // Seconds of the post-stall dive he cannot pull out of. Without it, holding
  // the climb key through a stall put him straight into `recover`, so the nose
  // dropped, nothing happened, and running out of airspeed cost nothing at all.
  // This is the punishment: half a second where the controls do not answer.
  const STALL_DIVE_COMMIT = 1.1;              // s
  const RECOVER_RATE      = 2.6;              // rad/s pulling the nose back to level
  // Held for this long after a recovery, so the speed a dive earned is still
  // there when he comes out of it rather than bleeding off during the pull-up.
  const RECOVER_HOLD      = 1.1;              // s

  // --- Snared --------------------------------------------------------------
  //
  // What a hunter's bola does when it lands (see bolas.js). It is not damage —
  // health.js bills that separately — it is a few seconds of a dragon whose
  // wings are tied, and every number here exists to make it frightening without
  // making it a death sentence.
  //
  // He SINKS, he SLOWS, and he can barely steer. Over open water that is a
  // scare; forty metres over a lit deck with a caldera wall coming up it is the
  // most dangerous thing in the game, which is exactly where the hunters are.
  // It cancels whatever manoeuvre he was in for the same reason a crash does:
  // a zoom with bound wings is not a zoom.
  //
  // And it can be fought. Rolling hard one way and then the other — the thing
  // you would actually do — takes a chunk off every time the stick crosses
  // over, so a player who reacts is down for about a second and a player who
  // freezes is down for the full four.
  const SNARE_TIME    = 4.0;   // s if he does nothing at all
  // Deliberately the same number as health.js's SAFE_CLOSING. A snare that ends
  // on the deck should put him on the deck, not kill him: arriving at exactly
  // the speed the impact model calls free means the fall itself costs nothing
  // and what it cost was the seconds and the height.
  const SNARE_SINK    = 26;    // m/s down, and the lift axis cannot answer
  const SNARE_SPEED   = 32;    // m/s his airspeed is dragged down to
  const SNARE_DRAG    = 2.2;   // how fast it is dragged there
  const SNARE_STEER   = 0.22;  // fraction of his yaw he keeps
  const SNARE_SHAKE   = 0.62;  // s off per reversal of the turn input
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

  // --- Where he rotates ABOUT ----------------------------------------------
  //
  // The GLB's origin is at his FEET: the skinned mesh's local box runs from
  // y 0 to y 1.6, his spine sits at 1.35 and his shoulders at 1.74. So setting
  // `dragon.rotation.z` rolled him about a line a metre and a half UNDER his
  // belly, and `dragon.rotation.x` pitched him about the same line. Every bank,
  // every knife edge and every barrel roll swung his whole body round a point
  // in the air below him instead of turning him on his own length.
  //
  // Yaw stays on the dragon, because a vertical axis through his feet and one
  // through his spine are the same line. Pitch and roll move onto a node whose
  // origin IS his spine, with the model hung back down underneath it — so the
  // composition is identical to the old Ry·Rx·Rz, just taken about the body
  // instead of about the ground under it.
  //
  // main.js writes `dragon.rotation` directly for the walk, where pivoting on
  // the feet is exactly right, so that path is untouched — it just has to have
  // this node back at identity, which is what releaseAttitude() is for.
  const BODY_CENTRE = 1.45;
  const attitude = new THREE.Group();
  attitude.name = "attitude";
  attitude.position.y = BODY_CENTRE;
  attitude.rotation.order = "YXZ";
  {
    const body = new THREE.Group();
    body.name = "body";
    body.position.y = -BODY_CENTRE;
    while (dragon.children.length) body.add(dragon.children[0]);
    attitude.add(body);
    dragon.add(attitude);
  }

  let strafeVel   = 0;   // m/s, sideways
  let climbVel    = 0;   // m/s, straight up. Owned by Space/Ctrl and nothing else
  // "level" is the ordinary flight model and the only state the old code had.
  // The other four are the zoom climb and what it costs — see the constants.
  let mode        = "level";   // level | drop | zoom | stall | dive | recover
  let modeT       = 0;         // seconds in the current state
  let stalled     = false;     // true for one frame when the wings let go
  let recoverHold = 0;         // s of keeping the speed a dive earned
  let diveCommit  = 0;         // s of dive he cannot pull out of, after a stall
  let vertAccel   = 0;         // m/s^2, smoothed. Feeds the wing load below
  let lastClimb   = 0;
  // The two double-tap gates — up/down for the zoom, the dive and the drop, and
  // the wingtip keys for the barrel roll. See makeTapGate().
  const vertGate = makeTapGate(TAP_MAX, DOUBLE_GAP);
  const rollGate = makeTapGate(ROLL_TAP_MAX, ROLL_GAP);
  let snared      = 0;         // s left with his wings bound — see SNARE_TIME
  let snareDir    = 0;         // which way he last rolled, for the shake

  // The barrel roll, while one is running. `rollDir` is +1 for a roll to the
  // left (the same sign convention as the knife edge and as rotation.z) and 0
  // when he is not in one.
  let rollDir   = 0;
  let rollT     = 0;      // 0..1 through the turn
  let rollTime  = ROLL_TIME;
  let rollBulge = ROLL_BULGE_SLOW;
  let rollRise  = ROLL_RISE_SLOW;
  let rollShift = ROLL_SHIFT_SLOW;
  let rollEntry = 0;      // the bank he was in when it started
  let rollLat   = 0;      // metres of the helix already applied, so the offset
  let rollUp    = 0;      // ...can be laid down as per-frame deltas
  // How fast he is going round, signed and normalised — 0 at the two ends of
  // the turn and 1 through the middle. The wing rig twists on this.
  let rollRate  = 0;

  /** 0 inside the chart, 1 at the hard edge. Read by main.js for the HUD. */
  let edgeT = 0;

  /**
   * Begin a barrel roll, if he is in a state to fly one.
   *
   * Refused out of anything that is already a manoeuvre — a corkscrew out of a
   * stall is not a thing a wing does — and refused with the wing stamina spent,
   * which is what stops it being a free button you hold down. `dir` is +1 for a
   * roll to the left, matching the knife edge and rotation.z.
   */
  function startRoll(dir) {
    if (!dir || rollDir !== 0) return false;
    // Refused out of anything that is already an aeroplane manoeuvre, but NOT
    // out of a drop: a raid is flown coming down, and taking the dodge away
    // exactly when he is descending onto a lit deck takes it away when it is
    // the only thing he wants. The drop ends, and the roll takes over.
    if (snared > 0 || (mode !== "level" && mode !== "drop")) return false;
    if (knifeCharge < ROLL_COST) return false;
    mode = "level"; modeT = 0;
    rollDir = dir;
    rollT = 0;
    rollLat = 0;
    rollUp = 0;
    rollEntry = currentRoll;
    knifeCharge = Math.max(0, knifeCharge - ROLL_COST);
    const t = speedRatio();
    rollTime  = THREE.MathUtils.lerp(ROLL_TIME, ROLL_TIME_FAST, t);
    rollBulge = THREE.MathUtils.lerp(ROLL_BULGE_SLOW, ROLL_BULGE_FAST, t);
    rollRise  = THREE.MathUtils.lerp(ROLL_RISE_SLOW, ROLL_RISE_FAST, t);
    rollShift = THREE.MathUtils.lerp(ROLL_SHIFT_SLOW, ROLL_SHIFT_FAST, t);
    airspeed *= 1 - ROLL_DRAG;
    return true;
  }

  /** How far through the climb's airspeed budget he is, 0 fresh .. 1 stalling. */
  const getStallT01 = () => 1 - THREE.MathUtils.clamp(
    (airspeed - STALL_SPEED) / (CLIMB_ENTRY_SPEED - STALL_SPEED), 0, 1);
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

    // --- Barrel roll: the same key, tapped twice --------------------------
    // Deliberately the wingtip key rather than a new binding. It is the axis
    // that already means "put a wing down", the double tap already means "the
    // committed version of this" everywhere else in the game, and it leaves the
    // roll on a button the hand is already resting on when it is needed — which
    // is while something is in the air on its way to him.
    rollGate.update(dt, knifeWant);
    if (rollGate.fired) startRoll(rollGate.dir);

    // A roll owns the wings for its second and a bit. Holding the key through
    // one would otherwise have him arrive out of the corkscrew already on a
    // wingtip, which looks like the roll never finished.
    if (rollDir !== 0) knifeWant = 0;

    // A roll counts as working the wings, so the bar does not refill through
    // one. Without this the manoeuvre is free: it costs ROLL_COST up front and
    // then earns exactly that back over its own half second, so he could
    // corkscrew from one end of the archipelago to the other and never be
    // hittable. Now a roll really does spend something, and the gap before the
    // next one is about as long as the roll — enough to dodge a volley, not
    // enough to live inside the dodge.
    if (knifeWant !== 0 || rollDir !== 0) {
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

    // --- Snared: the shake -------------------------------------------------
    // Read off the same axis he steers with, before it is scaled down, so what
    // gets him out is the thing he would do anyway: roll hard one way, then
    // hard the other. Every crossing takes SNARE_SHAKE off. He keeps a sliver
    // of steering while it lasts rather than none, because controls that stop
    // answering entirely read as a crash rather than as a struggle.
    if (snared > 0) {
      snared = Math.max(0, snared - dt);
      const d = turnInput > 0.55 ? 1 : turnInput < -0.55 ? -1 : 0;
      if (d !== 0) {
        if (snareDir !== 0 && d !== snareDir) snared = Math.max(0, snared - SNARE_SHAKE);
        snareDir = d;
      }
      turnInput *= SNARE_STEER;
      alignTarget = null;          // nothing is flying itself out of this
    } else {
      snareDir = 0;
    }

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

    // --- The edge of the chart ---------------------------------------------
    // Applied to `heading` outside the yaw clamp, exactly as the knife edge's
    // slice is below: this is the world dragging him round, not extra steering,
    // and it must not eat into the turn rate he still has.
    {
      const cheb = Math.max(Math.abs(dragon.position.x), Math.abs(dragon.position.z));
      edgeT = THREE.MathUtils.clamp(
        (cheb - EDGE_SOFT) / (EDGE_HARD - EDGE_SOFT), 0, 1);
      if (edgeT > 0) {
        // Which way is home, and how much of his nose is pointed away from it.
        const home = Math.atan2(-dragon.position.x, -dragon.position.z);
        const delta = angleDelta(heading, home);
        // cos of the angle off home: +1 flying straight back, -1 straight out.
        // Only the outward half of that is worth anything — turning a dragon
        // who is already coming home is the game arguing with a player who has
        // done what it wanted.
        const outward = THREE.MathUtils.clamp(-Math.cos(delta), 0, 1);
        // Squared, so the ring itself is a drift you would struggle to name and
        // the far side of it is unmistakable.
        const pull = EDGE_TURN * edgeT * edgeT * outward;
        heading += Math.sign(delta) * Math.min(pull * dt, Math.abs(delta));
      }
    }
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

    // --- The double-tap gate ----------------------------------------------
    vertGate.update(dt, wantUp ? 1 : wantDown ? -1 : 0);
    // Bound wings cannot be stood on. A snare drops him out of whatever he was
    // in and refuses the next one until he is loose, for the same reason a
    // crash does: a zoom climb with the cords round him is not a zoom climb.
    const committed = snared <= 0 && vertGate.armed && vertGate.held >= MANOEUVRE_HOLD;
    if (snared > 0 && mode !== "level") {
      mode = "level"; modeT = 0; diveCommit = 0; recoverHold = 0;
    }

    if (mode === "level") {
      if (committed && wantUp && airspeed >= CLIMB_ENTRY_SPEED) setMode("zoom");
      // Down reads the speed he is already doing and gives him the version of
      // itself that fits it: the dive if he is dashing, the drop if he is not.
      else if (committed && wantDown) {
        setMode(airspeed >= DIVE_ENTRY_SPEED ? "dive" : "drop");
      }
    } else if (mode === "drop") {
      // Height, quickly, with everything else still working. The airspeed is
      // pulled TOWARD a number rather than allowed to build, so however long he
      // holds it this never turns into the dive he chose not to ask for.
      airspeed += (DROP_SPEED - airspeed) * damp(DROP_DRAG, dt);
      if (!wantDown || wantUp) setMode("level");
    } else if (mode === "zoom") {
      // Straight up, and it costs. Letting go levels him off with whatever he
      // has left, which is the skill in it: too long and the wings let go.
      airspeed = Math.max(0, airspeed -
        (CLIMB_DRAG + airspeed * airspeed * CLIMB_DRAG_V2) * dt);
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
    //
    // The drop is deliberately NOT one of them. It runs on the level model with
    // the lift axis shoved over, which is what leaves him his heading, his
    // turn and his strafe all the way down — the difference between falling on
    // purpose and committing to a dive.
    const manoeuvring = mode !== "level" && mode !== "drop";

    // Fast dragons climb faster than slow ones, so the rate rides on airspeed —
    // but it never falls to nothing, because hovering and rising is exactly the
    // thing this axis exists to make possible.
    // Below the entry speed this is the original lift and is left alone: it is
    // what makes hovering and rising possible and it is tuned. At or above it,
    // an uncommitted press is a TRIM instead — a gentle nudge up or down —
    // because the same formula at 335 m/s asks for a 140 m/s climb, and
    // "gentle" is exactly what was missing.
    const trimming = !manoeuvring && airspeed >= CLIMB_ENTRY_SPEED;
    const vertRate = trimming ? TRIM_RATE : Math.min(
      VERT_HOVER + Math.abs(airspeed) * VERT_PER_SPEED, CLIMB_RATE_CAP
    );
    climbVel += (verticalInput * vertRate - climbVel) * damp(VERT_LAMBDA, dt);

    // The drop overrides the lift axis for the same reason the snare below does:
    // it is not a stronger press, it is a different thing the axis is doing.
    if (mode === "drop") {
      climbVel += (-DROP_SINK - climbVel) * damp(DROP_LAMBDA, dt);
    }

    // ...and then the snare overrides all of it. Written after the lift rather
    // than folded into `vertRate` so it is plainly an override: while the cords
    // are on him, holding climb does nothing whatsoever and he goes down.
    if (snared > 0) {
      climbVel += (-SNARE_SINK - climbVel) * damp(6.0, dt);
      airspeed += (SNARE_SPEED - airspeed) * damp(SNARE_DRAG, dt);
    }

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

    // --- The barrel: the path, not the spin --------------------------------
    //
    // Laid on top of wherever the flight model just put him, as a DELTA from
    // last frame's offset rather than as an absolute position. That is what
    // keeps it composable: he is still flying forward at whatever speed he was
    // doing, still turning if he is turning, still climbing if he is climbing,
    // and this walks him sideways across all of it.
    //
    // Two parts to the lateral, and the split is the whole design:
    //
    //   THE BARREL  `rollBulge * (1 - cos)` — out and back, peaking at the
    //               halfway point and closing again. A few metres, no more: any
    //               bigger and it competes with his own half-span and the roll
    //               stops looking like it is about him. See the note on it.
    //   THE STEP    `rollShift * swept` — monotonic, and it does not come back.
    //               This is what dodges, and at the end of the turn it is all
    //               that is left. It is what the weight MISSES. Monotonic is
    //               also what makes it read as a slide instead of a swing.
    //
    // The vertical is pure barrel and nets to nothing: up over the top, down
    // the far side, back to the entry height, flattened underneath by
    // ROLL_UNDER so rolling over a ridge does not put him into it. He comes out
    // of this beside where he was, not under it.
    rollRate = 0;
    if (rollDir !== 0) {
      rollT = Math.min(1, rollT + dt / rollTime);
      const th = rollT * Math.PI * 2;
      const sinT = Math.sin(th);
      // The same eased sweep the visual roll uses, 0..1 over the turn, so the
      // step he takes and the attitude he is in cannot come apart: both are
      // this one number.
      const swept = (th - ROLL_EASE * sinT) / (Math.PI * 2);
      const lat = rollDir * (rollBulge * (1 - Math.cos(th)) + rollShift * swept);
      const up  = rollRise * sinT * (sinT > 0 ? 1 : ROLL_UNDER);
      // Left, for a heading whose forward is (sin h, cos h).
      dragon.position.x += Math.cos(heading) * (lat - rollLat);
      dragon.position.z -= Math.sin(heading) * (lat - rollLat);
      dragon.position.y += up - rollUp;
      rollLat = lat;
      rollUp = up;
      // How fast he is going round, normalised — near 0 at the ends and 1 in
      // the middle. This is what the wing rig twists on.
      // Normalised by its own peak so this stays inside -1..1 whatever ROLL_EASE
      // is: the rig scales bone angles by it and a value over one would push
      // the wing twist past the deflection it was tuned for.
      rollRate = rollDir * (1 - ROLL_EASE * Math.cos(th)) / (1 + ROLL_EASE);
      if (rollT >= 1) {
        // One whole turn is the same attitude as none. Take it off here, at the
        // moment it finishes and while the direction is still known, so the
        // bank model picks up from the attitude he is actually in instead of
        // unwinding six radians over the next second.
        currentRoll -= rollDir * Math.PI * 2;
        rollDir = 0; rollT = 0; rollLat = 0; rollUp = 0;
      }
    }

    // From `climbVel`, NOT `climbRate`. climbRate has the wingbeat bob added
    // to it — a sine at beat frequency — and differentiating that gives a huge
    // spurious acceleration, which is how "straight and level" first measured
    // at sixteen g. climbVel is what he is actually being asked to do.
    // Smoothed on top, because a frame-to-frame difference of a damped value
    // is mostly numerical noise and the wings would buzz rather than bow.
    const rawAccel = dt > 1e-5 ? (climbVel - lastClimb) / dt : 0;
    lastClimb = climbVel;
    vertAccel += (rawAccel - vertAccel) * damp(6, dt);

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
    if (rollDir !== 0 || rollT > 0) {
      // A full turn, driven off the same clock as the path so the spin and the
      // corkscrew cannot drift apart. `th - k*sin(th)` lands exactly on one
      // turn whatever k is, and k sets how much it eases: at 0 the rate is
      // constant and it corners at both ends, at 1 the rate is zero at both
      // ends and it feels slow to start. ROLL_EASE is the snappy end of the
      // middle — see the note on it.
      const th = rollT * Math.PI * 2;
      currentRoll = rollEntry + rollDir * (th - ROLL_EASE * Math.sin(th));
    } else {
      currentRoll += (targetRoll - currentRoll) * damp(BANK_LAMBDA, dt);
    }
    attitude.rotation.z = currentRoll;

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
      pathAngle + (manoeuvring ? 0 : slowT * AOA_SLOW) + knifeBlend * 0.14
        // Nose up going over the top of the barrel and down coming off it,
        // which is the pull that keeps a barrel roll positive-g. Without it he
        // slides round the helix pointing dead ahead, and the body reads as
        // being carried through the manoeuvre rather than flying it.
        + (rollT > 0 ? Math.sin(rollT * Math.PI * 2) * ROLL_PITCH : 0),
      -pitchLimit, pitchLimit
    );
    currentPitch += (targetPitch - currentPitch) * damp(PITCH_LAMBDA, dt);
    attitude.rotation.x = currentPitch;

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
    /** 0..1 of the way to committing to a zoom or a dive. Drives the HUD. */
    getCommitT: () =>
      (vertGate.armed ? Math.min(1, vertGate.held / MANOEUVRE_HOLD) : 0),
    /**
     * True while the axis is held but has NOT been double-tapped — i.e. he is
     * trimming rather than manoeuvring. The HUD says so, because the whole
     * point of the gate is that the player can tell the two apart.
     */
    isTrimming: () => mode === "level" && vertGate.dir !== 0 && !vertGate.armed,
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
    getStallT: () => (mode === "zoom" ? getStallT01() : 0),
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
      if (rollDir !== 0) { currentRoll -= rollDir * Math.PI * 2; }
      rollDir = 0; rollT = 0; rollLat = 0; rollUp = 0; rollRate = 0;
    },
    /**
     * A hunter's bola has landed: bind his wings for `seconds`.
     *
     * Takes the LONGER of what is left and what is asked for rather than
     * adding, so being hit twice in a second is not eight seconds of falling —
     * the second bola is frightening, not fatal. See bolas.js.
     */
    snare(seconds = SNARE_TIME) {
      snared = Math.max(snared, seconds);
      snareDir = 0;
      // Cords round the wings end a corkscrew, and end it where he is rather
      // than a whole turn away from it.
      if (rollDir !== 0) currentRoll -= rollDir * Math.PI * 2;
      rollDir = 0; rollT = 0; rollLat = 0; rollUp = 0; rollRate = 0;
      mode = "level"; modeT = 0; diveCommit = 0; recoverHold = 0;
      // Whatever speed the pass was carrying goes with the wings.
      airspeed *= 0.55;
    },
    /** Seconds left of it, for the HUD. */
    getSnared: () => snared,

    /**
     * Fly a barrel roll now, if he can. +1 rolls left, -1 right.
     * @returns {boolean} whether one actually started
     */
    barrelRoll: (dir) => startRoll(Math.sign(dir) || 1),
    /** Whether a barrel roll is running. True from the frame it starts, which
     *  `getRollT` is not — that is still zero until the first step. */
    isRolling: () => rollDir !== 0,
    /** 0 when he is not in one, otherwise 0..1 through the turn. */
    getRollT: () => (rollDir !== 0 ? rollT : 0),
    /**
     * How far outside the chart he is: 0 inside it, 1 at the hard edge, where
     * he is being turned as hard as this will turn him. main.js says so on
     * screen; nothing here does.
     */
    getEdgeT: () => edgeT,
    /** Signed roll rate, -1..1. Non-zero only inside a barrel roll. */
    getRollRate: () => rollRate,
    /** Whether a barrel roll would be refused, and why — for the HUD. */
    canRoll: () => snared <= 0 && (mode === "level" || mode === "drop")
                   && rollDir === 0 && knifeCharge >= ROLL_COST,

    /** Let go — a landing, a cutscene, a chapter jump. */
    clearSnare() { snared = 0; snareDir = 0; },
    /**
     * Hand the pitch/roll node back to identity.
     *
     * main.js owns his attitude on the ground — it writes `dragon.rotation`
     * against the slope he is standing on — and this node sits between that and
     * the model. Left where the last frame of flight put it, he lands in a
     * forty-degree bank and stays there.
     */
    releaseAttitude() {
      attitude.rotation.set(0, 0, 0);
      currentRoll = 0;
      currentPitch = 0;
    },

    /** Abandon a barrel roll mid-turn. Landing and cutscenes both need this,
     *  or he keeps corkscrewing through a scene that owns the camera. */
    clearRoll() {
      if (rollDir !== 0) currentRoll -= rollDir * Math.PI * 2;
      rollDir = 0; rollT = 0; rollLat = 0; rollUp = 0; rollRate = 0;
      rollGate.reset();
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
      // --- LOAD, in g -----------------------------------------------------
      // How hard the wings are being asked to work, which is the thing that
      // makes a wing CURVE. It is real acceleration rather than a stand-in
      // for one: a turn of radius r at speed v pulls v·yawRate laterally, and
      // pulling out of a dive adds whatever the vertical is doing on top.
      //
      // A membrane wing bows under load and stays bowed while the load lasts,
      // and that is most of what separates a dragon from a hang glider. Before
      // this the only curve in the rig rode the beat's own sine, so the wings
      // were exactly as curved in a 4 g carve as in a straight glide.
      load:   Math.hypot(yawRate * airspeed, vertAccel) / 9.81,
      // 0..1 of the HANG — the pose at the top of a zoom, wings held wide and
      // curling, nose up, tail fanned, no beat in it. It comes on with the last
      // of his airspeed rather than snapping on at the stall, because that is
      // when it starts happening: the wings stop driving him and start just
      // holding him, and you should be able to see that coming.
      hang: mode === "stall" ? 1
          : mode === "zoom" ? Math.max(0, (getStallT01() - 0.45) / 0.55)
          : 0,
      // --- ROLL RATE, -1 .. +1 --------------------------------------------
      // Signed, +1 rolling left, and only ever non-zero inside a barrel roll.
      //
      // The rig twists the wings ASYMMETRICALLY on this rather than just
      // spinning the body, because that is how the animal does it: the work on
      // bird flight is clear that asymmetric wing PITCH — one wing twisting
      // nose-up while the other twists nose-down — produces a far larger roll
      // moment than asymmetric folding, and that the tail twists with it. The
      // body rotation is the RESULT of the wings doing that, so the wings have
      // to lead it or the whole manoeuvre reads as a model spun on a spit.
      roll: rollRate,
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
