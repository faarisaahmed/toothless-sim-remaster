import * as THREE from "three";

// Shortest signed angle from a to b, wrap-safe.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function setupDragonControls(dragon, getCamYaw) {
  const keys = {};
  const keysJustPressed = {};

  const FORWARD_SPEED     = 0.35;
  const STRAFE_ACCEL      = 0.045;
  const THRUST_ACCEL      = 0.05;
  const VERT_ACCEL        = 0.06;
  const MAX_STRAFE        = 0.45;
  const MAX_THRUST        = 0.6;
  const MAX_VERT          = 0.62;
  const FRICTION_H        = 0.88;
  const FRICTION_V        = 0.88;
  const HOVER_DAMP        = 0.92;
  const TILT_AMOUNT       = 0.35;
  // ~30 degrees of nose attitude at a full climb or dive — enough to read
  // clearly from the chase camera without pitching him vertical.
  const PITCH_AMOUNT      = 0.85;
  const PITCH_MAX         = 0.6;
  const PITCH_LAMBDA      = 4.5;  // matches the old per-frame feel at 60fps
  const SPEED_WOBBLE      = 0.003;
  const SPEED_WOBBLE_FREQ = 0.12;

  // --- Turning: rate-based, not target-based ---
  // Holding A/D ramps the turn rate in; releasing lets it bleed off. A tap is a
  // couple of degrees, a hold carves a continuous arc. Nothing snaps to a
  // compass point, so any heading in between is reachable.
  let   YAW_ACCEL   = 0.0011; // rad per frame^2 while held
  let   YAW_MAX     = 0.017;  // rad per frame at full deflection
  const YAW_DAMP    = 0.90;   // decay per frame once released
  const YAW_DEADZONE = 0.0004;
  const MAX_BANK    = 0.62;   // roll at full turn rate
  const BANK_SMOOTH = 0.07;
  const ALIGN_TOLERANCE = 0.02;

  const SPEED_MIN         = 0.1;
  const SPEED_MAX         = 0.8;
  const SPEED_STEP        = 0.02;
  let currentForwardSpeed = FORWARD_SPEED;

  const BURST_SPEED       = 1.4;
  const BURST_DURATION    = 30;
  const BURST_COOLDOWN    = 300;
  let burstTimer          = 0;
  let burstCooldown       = 0;

  // --- Knife edge ---
  // Hold to roll onto a wingtip and slip through a vertical gap. It runs on a
  // stamina budget so it stays a deliberate move rather than a flight mode.
  const KNIFE_ANGLE   = 1.45;  // ~83 degrees of roll
  const KNIFE_IN      = 3.2;   // roll onto the wing decisively
  const KNIFE_OUT     = 1.9;   // relax out of it more slowly
  const KNIFE_HOLD    = 3.0;   // seconds of stamina
  const KNIFE_RECOVER = 2.0;   // seconds to refill from empty
  const KNIFE_SINK    = 0.010; // lost lift per frame at full deflection
  const KNIFE_YAW     = 0.0022;// a wing down pulls the nose that way
  const KNIFE_TREMBLE = 0.022; // he can't hold it perfectly still
  let knifeAmount = 0;         // smoothed, -1 (right wing down) .. +1 (left down)
  let knifeCharge = KNIFE_HOLD;

  dragon.scale.setScalar(2);
  // Yaw first, then pitch and roll in his own frame — the aircraft convention.
  // With the default XYZ order, rotation.x pitches about the WORLD x axis, so
  // it silently turns into a roll once he's flying east or west.
  dragon.rotation.order = "YXZ";

  let velocityX = 0; // strafe
  let velocityY = 0; // climb
  let velocityZ = 0; // forward/back thrust on top of cruise speed
  let currentRoll  = 0;
  let currentPitch = 0;
  let heading   = null; // lazily seeded from the camera on frame one
  let yawRate   = 0;
  let alignTarget = null; // set by H, cleared on manual input or arrival
  let activeSpeed = currentForwardSpeed;
  let tick = 0;

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
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function update(dt = 0.016) {
    if (!dragon) return;
    tick++;

    const camYaw = getCamYaw();
    if (heading === null) heading = camYaw + Math.PI; // no 180 spin on spawn

    // --- Align to camera ---
    if (keysJustPressed["KeyH"]) alignTarget = camYaw + Math.PI;

    // --- Speed ---
    if (keys["KeyJ"]) currentForwardSpeed = Math.min(SPEED_MAX, currentForwardSpeed + SPEED_STEP);
    if (keys["KeyK"]) currentForwardSpeed = Math.max(SPEED_MIN, currentForwardSpeed - SPEED_STEP);

    // --- Burst ---
    if (keysJustPressed["KeyL"] && burstCooldown === 0) {
      burstTimer    = BURST_DURATION;
      burstCooldown = BURST_COOLDOWN;
    }
    if (burstTimer    > 0) burstTimer--;
    if (burstCooldown > 0) burstCooldown--;

    for (const key in keysJustPressed) delete keysJustPressed[key];

    // --- Knife edge (Z / X held) ---
    let knifeWant = 0;
    if (keys["KeyZ"]) knifeWant =  1; // left wing down
    if (keys["KeyX"]) knifeWant = -1; // right wing down

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
    knifeAmount += (knifeTarget - knifeAmount) * (1 - Math.exp(-knifeRate * dt));

    // --- Yaw (A/D or arrows) ---
    let turnInput = 0;
    if (keys["KeyA"] || keys["ArrowLeft"])  turnInput += 1; // +heading is left
    if (keys["KeyD"] || keys["ArrowRight"]) turnInput -= 1;

    if (turnInput !== 0) alignTarget = null; // manual input always wins

    if (alignTarget !== null) {
      // Drive the same rate-based turn toward the camera so H produces a real
      // banked sweep rather than a snap.
      const delta = angleDelta(heading, alignTarget);
      if (Math.abs(delta) < ALIGN_TOLERANCE) {
        alignTarget = null;
      } else {
        // Ease the rate down on approach so it settles instead of overshooting.
        const desired = THREE.MathUtils.clamp(delta * 0.12, -YAW_MAX, YAW_MAX);
        yawRate += (desired - yawRate) * 0.15;
      }
    } else if (turnInput !== 0) {
      yawRate += turnInput * YAW_ACCEL;
    } else {
      yawRate *= YAW_DAMP;
      if (Math.abs(yawRate) < YAW_DEADZONE) yawRate = 0;
    }

    yawRate = THREE.MathUtils.clamp(yawRate, -YAW_MAX, YAW_MAX);
    heading += yawRate;
    // On a wingtip he slices toward the low wing. Applied outside the clamp so
    // it reads as the maneuver dragging him round, not as extra steering.
    heading += knifeAmount * KNIFE_YAW;
    // `heading` is the direction of TRAVEL. The GLB's nose points down local -Z,
    // so the model has to sit a half turn off the travel vector to face forward.
    dragon.rotation.y = heading + Math.PI;

    // --- Strafe (Q/E): translate sideways with no change in heading ---
    if (keys["KeyQ"]) velocityX -= STRAFE_ACCEL;
    if (keys["KeyE"]) velocityX += STRAFE_ACCEL;

    // --- Forward / back thrust (W/S) on top of the cruise speed ---
    if (keys["KeyW"]) velocityZ += THRUST_ACCEL;
    if (keys["KeyS"]) velocityZ -= THRUST_ACCEL;

    // --- Rise / dive: Space or R up, Shift or F down ---
    let verticalInput = 0;
    if (keys["Space"]      || keys["KeyR"] || keys["ArrowUp"])   verticalInput += 1;
    if (keys["ShiftLeft"]  || keys["KeyF"] || keys["ArrowDown"]) verticalInput -= 1;

    if (verticalInput !== 0) {
      velocityY += verticalInput * VERT_ACCEL;
    } else {
      velocityY *= HOVER_DAMP;
    }

    // Wings vertical means almost no lift, so he sinks. Holding a knife edge
    // through a gap costs you altitude unless you pull up into it.
    velocityY -= Math.abs(knifeAmount) * KNIFE_SINK;

    velocityX = Math.max(-MAX_STRAFE, Math.min(MAX_STRAFE, velocityX));
    velocityY = Math.max(-MAX_VERT,   Math.min(MAX_VERT,   velocityY));
    velocityZ = Math.max(-MAX_THRUST, Math.min(MAX_THRUST, velocityZ));
    velocityX *= FRICTION_H;
    velocityY *= FRICTION_V;
    velocityZ *= FRICTION_H;

    // --- Translation: always along his own nose ---
    activeSpeed = (burstTimer > 0 ? BURST_SPEED : currentForwardSpeed) + velocityZ;
    dragon.position.x += Math.sin(heading) * activeSpeed;
    dragon.position.z += Math.cos(heading) * activeSpeed;

    dragon.position.x -= Math.cos(heading) * velocityX;
    dragon.position.z += Math.sin(heading) * velocityX;

    dragon.position.y += velocityY;
    dragon.position.y += Math.sin(tick * SPEED_WOBBLE_FREQ) * SPEED_WOBBLE;

    // --- Roll ---
    // Signs are set for the half-turned model: +roll drops the left wing, which
    // is what you want banking into a left (+yawRate) turn. Knife edge takes
    // over from ordinary banking as it comes on rather than fighting it.
    const bank = (yawRate / YAW_MAX) * MAX_BANK - velocityX * TILT_AMOUNT;
    const knifeBlend = Math.abs(knifeAmount);
    // Nothing alive holds a wingtip-down attitude perfectly still.
    const tremble = Math.sin(tick * 0.31) * Math.sin(tick * 0.13) * KNIFE_TREMBLE * knifeBlend;
    const targetRoll = knifeAmount * KNIFE_ANGLE + (1 - knifeBlend) * bank + tremble;
    currentRoll += (targetRoll - currentRoll) * BANK_SMOOTH;
    dragon.rotation.z = currentRoll;

    // --- Pitch: nose up when climbing, and a little more on a wingtip where
    //     he has to hold the nose high to keep from dropping ---
    const targetPitch = THREE.MathUtils.clamp(
      velocityY * PITCH_AMOUNT + knifeBlend * 0.14, -PITCH_MAX, PITCH_MAX
    );
    currentPitch += (targetPitch - currentPitch) * (1 - Math.exp(-PITCH_LAMBDA * dt));
    dragon.rotation.x = currentPitch;
  }

  return {
    update,
    getHeading:  () => heading ?? 0,
    getSpeed:    () => activeSpeed,
    isTurning:   () => Math.abs(yawRate) > YAW_DEADZONE * 4,
    isBursting:  () => burstTimer > 0,
    burstReady:  () => burstCooldown === 0,

    // Drives the wing rig.
    getFlightState: () => ({
      climb:  THREE.MathUtils.clamp(velocityY / MAX_VERT, -1, 1),
      speedT: THREE.MathUtils.clamp((activeSpeed - 0.1) / (1.4 - 0.1), 0, 1),
      knife:  knifeAmount,
    }),
    getKnifeCharge: () => knifeCharge / KNIFE_HOLD,

    // --- debug console hooks ---
    getTurnRate: () => YAW_MAX,
    setTurnRate(v) {
      YAW_MAX = THREE.MathUtils.clamp(v, 0.002, 0.06);
      YAW_ACCEL = YAW_MAX / 15.5; // keep the wind-up feel proportional
      return YAW_MAX;
    },
    getCruiseSpeed: () => currentForwardSpeed,
    setCruiseSpeed(v) {
      currentForwardSpeed = THREE.MathUtils.clamp(v, 0, 10);
      return currentForwardSpeed;
    },
    setHeading(rad) { heading = rad; },
    clearKeys() {
      for (const k in keys) keys[k] = false;
      velocityX = velocityY = velocityZ = 0;
    },
  };
}
