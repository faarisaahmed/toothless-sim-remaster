import * as THREE from "three";

export function setupDragonControls(dragon, getCamYaw) {
  const keys = {};
  const keysJustPressed = {};

  const FORWARD_SPEED     = 0.35;
  const STRAFE_ACCEL      = 0.04;
  const VERT_ACCEL        = 0.05;
  const MAX_STRAFE        = 0.45;
  const MAX_VERT          = 0.5;
  const FRICTION_H        = 0.88;
  const FRICTION_V        = 0.86;
  const HOVER_DAMP        = 0.92;
  const TILT_AMOUNT       = 0.4;
  const PITCH_AMOUNT      = 0.3;
  const TILT_SMOOTH       = 0.08;
  const PITCH_SMOOTH      = 0.07;
  const TURN_SMOOTH       = 0.06; // how fast dragon rotates to face direction
  const SPEED_WOBBLE      = 0.003;
  const SPEED_WOBBLE_FREQ = 0.12;

  const SPEED_MIN         = 0.1;
  const SPEED_MAX         = 0.8;
  const SPEED_STEP        = 0.02;
  let currentForwardSpeed = FORWARD_SPEED;

  const BURST_SPEED       = 1.4;
  const BURST_DURATION    = 30;
  const BURST_COOLDOWN    = 300;
  let burstTimer          = 0;
  let burstCooldown       = 0;

  const ROLL_DURATION     = 40;
  let rollTimer           = 0;
  let rollDirection       = 0;

  dragon.scale.setScalar(2);

  let velocityX = 0;
  let velocityY = 0;
  let currentRoll  = 0;
  let currentPitch = 0;
  let targetYaw    = 0;
  let currentYaw   = 0;
  let tick = 0;

  window.addEventListener("keydown", (e) => {
    if (!keys[e.code]) keysJustPressed[e.code] = true;
    keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function update() {
    if (!dragon) return;
    tick++;

    const camYaw = getCamYaw();

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

    // --- Barrel roll ---
    if (keysJustPressed["KeyU"] && rollTimer === 0) { rollDirection = -1; rollTimer = ROLL_DURATION; }
    if (keysJustPressed["KeyI"] && rollTimer === 0) { rollDirection =  1; rollTimer = ROLL_DURATION; }
    if (rollTimer > 0) rollTimer--;

    for (const key in keysJustPressed) delete keysJustPressed[key];

    // --- Movement relative to camera facing ---
    const movingH = keys["KeyA"] || keys["KeyD"] || keys["ArrowLeft"] || keys["ArrowRight"];

    if (keys["KeyA"] || keys["ArrowLeft"])  velocityX -= STRAFE_ACCEL;
    if (keys["KeyD"] || keys["ArrowRight"]) velocityX += STRAFE_ACCEL;

    const verticalInput = (keys["KeyW"] || keys["ArrowUp"])   ?  1
                        : (keys["KeyS"] || keys["ArrowDown"]) ? -1 : 0;

    if (verticalInput !== 0) {
      velocityY += verticalInput * VERT_ACCEL;
    } else {
      velocityY *= HOVER_DAMP;
    }

    velocityX = Math.max(-MAX_STRAFE, Math.min(MAX_STRAFE, velocityX));
    velocityY = Math.max(-MAX_VERT,   Math.min(MAX_VERT,   velocityY));
    velocityX *= FRICTION_H;
    velocityY *= FRICTION_V;

    // Move in the direction the camera is facing
    const activeFwdSpeed = burstTimer > 0 ? BURST_SPEED : currentForwardSpeed;
    dragon.position.x += Math.sin(camYaw) * activeFwdSpeed * -1;
    dragon.position.z += Math.cos(camYaw) * activeFwdSpeed * -1;

    // Strafe perpendicular to camera
    dragon.position.x += Math.cos(camYaw) * velocityX;
    dragon.position.z -= Math.sin(camYaw) * velocityX;

    dragon.position.y += velocityY;

    // Wobble
    dragon.position.y += Math.sin(tick * SPEED_WOBBLE_FREQ) * SPEED_WOBBLE;

    // Dragon faces the direction it's flying (camera yaw + strafe lean)
    targetYaw = camYaw + Math.PI; // +PI because model faces -Z
    currentYaw += (targetYaw - currentYaw) * TURN_SMOOTH;
    dragon.rotation.y = currentYaw;

    // --- Roll ---
    if (rollTimer > 0) {
      const rollProgress = 1 - rollTimer / ROLL_DURATION;
      dragon.rotation.z = rollDirection * rollProgress * Math.PI * 2;
    } else {
      const targetRoll = -velocityX * TILT_AMOUNT;
      currentRoll += (targetRoll - currentRoll) * TILT_SMOOTH;
      dragon.rotation.z = currentRoll;
    }

    // --- Pitch ---
    const targetPitch = -velocityY * PITCH_AMOUNT;
    currentPitch += (targetPitch - currentPitch) * PITCH_SMOOTH;
    dragon.rotation.x = currentPitch;
  }

  return update;
}