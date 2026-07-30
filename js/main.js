import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupDragonControls, angleDelta } from "./controls.js";
import { setupWorld } from "./world.js";
import { setupDebugConsole } from "./debug.js";
import { setupWings } from "./wings.js";
import { setupFlights } from "./flights.js";
import { setupGamepad, BTN } from "./gamepad.js";
import { setupMap } from "./map.js";

// Live-tunable knobs, mutated by the debug console.
const tuning = {
  fovBase: 70,
  distBase: 14,
  flapAmplitude: 1,
  flapSpeed: 1,
  sweepAmount: 1,
  tuckSign: 1,       // flip if the wings fold forwards instead of back
  collide: true,
  lookSensitivity: 0.003,
  padLookSpeed: 1,   // right stick multiplier
  padInvertY: false,
};

const SPAWN = new THREE.Vector3(0, 300, 900);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,     // widens toward 88 with speed
  window.innerWidth / window.innerHeight,
  1,      // near: the chase cam sits 14 units out, so 1 is plenty
  50000   // far: has to contain the sky dome
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Camera rig
//
// Yaw and pitch belong to the player, full stop — nothing in this file writes
// them except mouse input and the manual C recenter. What gets smoothed is the
// TRACKING POSITION and the boom length, never the orientation. That split is
// the standard third-person recipe; smoothing orientation toward the target's
// heading is what makes a camera feel like it's fighting you.
// ---------------------------------------------------------------------------
let camYaw   = 0;
let camPitch = 0.3;

// Trackpads are rough on pointer lock: the OS acceleration curve is applied to
// movementX/Y, they fire many tiny events per frame, and there's a known
// Chromium bug where movement spikes near the window edge. Three mitigations:
// unadjustedMovement to get raw deltas, a spike filter, and a small buffer that
// drains over a couple of frames so per-event noise doesn't reach the camera.
const LOOK_SPIKE  = 160;  // px in a single event — discard beyond this
const LOOK_LAMBDA = 34;   // buffer drain rate; high enough to stay responsive
let pendingYaw   = 0;
let pendingPitch = 0;
const PITCH_LIMIT = 1.5;  // stay clear of the poles where lookAt flickers

const DIST_SPEED = 5;    // extra boom length at full burst

// Critically-damped-ish tracking. Horizontal is tight so he stays framed;
// vertical is looser, which absorbs the flap wobble and the terrain floor
// clamp without dragging the whole camera up and down with them.
const FOCUS_LAMBDA_XZ = 18;
const FOCUS_LAMBDA_Y  = 7;
const BOOM_LAMBDA     = 12;  // spring-arm lag; he pulls away under burst
const LOOK_HEIGHT     = 1.5;

const FOV_SPEED_GAIN = 18; // how much wider the view gets at full burst
const FOV_LAMBDA = 3;

const RECENTER_LAMBDA = 7;
let recentering = false;

// Right stick look, in radians per second at full deflection. The stick is
// already sampled once a frame and curved, so unlike the mouse it goes straight
// on rather than through the smoothing buffer.
const PAD_LOOK_YAW   = 2.9;
const PAD_LOOK_PITCH = 2.0;
const PAD_ZOOM_RATE  = 22;   // boom units per second on the d-pad
const BOOM_MIN = 6;
const BOOM_MAX = 46;

const GROUND_RUSH_AGL = 55;  // altitude at which the pad starts to growl
let wasGrounded = false;

const pad = setupGamepad();

// The chart reads his position and heading rather than owning them.
const map = setupMap(() => dragon && controls ? {
  x: dragon.position.x,
  y: dragon.position.y,
  z: dragon.position.z,
  heading: controls.getHeading(),
} : null);

document.addEventListener("click", (e) => {
  // Clicking the HUD, the console or the chart must not grab the pointer.
  if (e.target.closest("#hud, #console, #map")) return;

  // Ask for raw, unaccelerated deltas. Not every browser supports the option,
  // so fall back to a plain lock if the promise rejects.
  const req = document.body.requestPointerLock({ unadjustedMovement: true });
  if (req && typeof req.catch === "function") {
    req.catch(() => document.body.requestPointerLock());
  }
});

window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== document.body) return;

  // Drop implausible jumps rather than letting them whip the camera around.
  if (Math.abs(e.movementX) > LOOK_SPIKE || Math.abs(e.movementY) > LOOK_SPIKE) return;

  recentering = false; // any look input cancels the manual camera swing
  pendingYaw   -= e.movementX * tuning.lookSensitivity;
  pendingPitch -= e.movementY * tuning.lookSensitivity;
});

// Manual camera swing — player-initiated, never automatic. Puts the camera out
// in front of him looking back, rather than behind his shoulder.
window.addEventListener("keydown", (e) => {
  if (document.activeElement?.tagName === "INPUT") return;
  if (e.code === "KeyC") recentering = true;
  if (e.code === "KeyG") world.toggleGrid();
});

// Frame-rate independent smoothing factor for an exponential decay of rate
// `lambda` over `dt` seconds. Keeps the feel identical at 30fps and 144fps.
function damp(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

const clock = new THREE.Clock();
const focus = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();
let rigReady = false;

const world = setupWorld(scene, renderer);

let controls = null;
let dragon = null;
let updateWings = null;
let flights = null;
let tick = 0;

const loader = new GLTFLoader();
loader.load(
  "./assets/models/dragon_rigged.glb",
  (gltf) => {
    dragon = gltf.scene;
    dragon.position.copy(SPAWN);
    scene.add(dragon);

    let skel = null;
    dragon.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = true;
      if (obj.isSkinnedMesh) {
        skel = obj.skeleton;
        // Bounds are baked at bind pose, so a flapping wing can pop out of the
        // frustum while the body is still on screen.
        obj.frustumCulled = false;
      }
    });

    if (skel) {
      // GLTFLoader strips dots from names: "Bone.004" -> "Bone004"
      const wingLeft  = skel.getBoneByName("Bone004");
      const wingRight = skel.getBoneByName("Bone005");
      if (wingLeft && wingRight) {
        updateWings = setupWings(wingLeft, wingRight, tuning);
      }
    }

    // Clone the wild flights BEFORE anything poses the player's bones — the
    // wing rig captures whatever rotation the bones are in as its rest pose.
    flights = setupFlights(scene, gltf.scene, tuning, world, 7, SPAWN);

    controls = setupDragonControls(dragon, () => camYaw, pad);
  },
  undefined,
  (e) => console.error(e)
);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudHeading = document.getElementById("hud-heading");
const hudDegrees = document.getElementById("hud-degrees");
const hudSpeed   = document.getElementById("hud-speed");
const hudBurst   = document.getElementById("hud-burst");
const hudKnife   = document.getElementById("hud-knife");
const hudRoot    = document.getElementById("hud");
const hudPadTag  = document.getElementById("hud-pad-tag");

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
let shownDegrees = null;
let shownSpeed = null;
let shownBurst = null;

function updateHud() {
  if (!controls) return;

  // Nose vector is (sin h, cos h); treat -Z as north.
  const h = controls.getHeading();
  const deg = Math.round(
    (THREE.MathUtils.radToDeg(Math.atan2(Math.sin(h), -Math.cos(h))) + 360) % 360
  ) % 360;

  if (deg !== shownDegrees) {
    hudHeading.textContent = COMPASS_POINTS[Math.round(deg / 45) % 8];
    hudDegrees.textContent = `${String(deg).padStart(3, "0")}°`;
    shownDegrees = deg;
  }

  const speed = Math.round(controls.getSpeed() * 100);
  if (speed !== shownSpeed) {
    hudSpeed.textContent = speed;
    hudSpeed.classList.toggle("bursting", controls.isBursting());
    shownSpeed = speed;
  }

  const knifeCharge = controls.getKnifeCharge();
  hudKnife.style.transform = `scaleX(${knifeCharge})`;
  hudKnife.classList.toggle("spent", knifeCharge < 0.3);

  const ready = controls.burstReady();
  if (ready !== shownBurst) {
    hudBurst.textContent = ready ? "Burst Ready" : "Burst Charging";
    hudBurst.classList.toggle("ready", ready);
    shownBurst = ready;
  }
}

// ---------------------------------------------------------------------------
// Gamepad: everything that isn't flight input
//
// The flight axes live in controls.js; what's left here is the camera and the
// view toggles, because those are this file's state to own.
// ---------------------------------------------------------------------------
let padWasConnected = null;

function updatePadView(dt) {
  const on = pad.connected();

  if (on !== padWasConnected) {
    // Both columns are always in the legend; connecting a pad just brings its
    // column forward and lets the keyboard one recede.
    hudRoot.classList.toggle("pad-live", on);
    hudPadTag.hidden = !on;
    padWasConnected = on;
    if (on) {
      // Browsers report the id as a long vendor string; pull the family out of it.
      const id = pad.id();
      hudPadTag.textContent = /dualsense|0ce6|0df2/i.test(id) ? "DualSense"
                            : /dualshock|054c/i.test(id)      ? "DualShock"
                            : "Gamepad";
      pad.rumble.pulse(0.4, 0.55, 0.3); // say hello
    }
  }

  if (!on) return;

  // --- Right stick: free look. Signs match the mouse exactly so switching
  //     between the two mid-flight doesn't reverse the camera on you. ---
  if (pad.rx !== 0 || pad.ry !== 0) {
    recentering = false;
    camYaw -= pad.rx * PAD_LOOK_YAW * tuning.padLookSpeed * dt;
    const pitchDir = tuning.padInvertY ? 1 : -1;
    camPitch = THREE.MathUtils.clamp(
      camPitch + pitchDir * pad.ry * PAD_LOOK_PITCH * tuning.padLookSpeed * dt,
      -PITCH_LIMIT, PITCH_LIMIT
    );
  }

  // Swing the camera round behind him. D-pad down mirrors the D-pad up that
  // points HIM at the CAMERA; R3 is the same thing on the button third-person
  // games have used for it for twenty years.
  if (pad.pressed(BTN.R3) || pad.pressed(BTN.DDOWN)) recentering = true;

  // D-pad left/right walks the boom in and out.
  if (pad.held(BTN.DLEFT) || pad.held(BTN.DRIGHT)) {
    const dir = (pad.held(BTN.DRIGHT) ? 1 : 0) - (pad.held(BTN.DLEFT) ? 1 : 0);
    tuning.distBase = THREE.MathUtils.clamp(
      tuning.distBase + dir * PAD_ZOOM_RATE * dt, BOOM_MIN, BOOM_MAX
    );
  }

  // View toggles. Each gets a short click back so a press that changed nothing
  // visible on screen still confirms itself.
  const click = () => pad.rumble.pulse(0.25, 0.06, 0.08);
  if (pad.pressed(BTN.TRIANGLE)) { flights?.setVisible(!flights.isVisible()); click(); }
  if (pad.pressed(BTN.TOUCHPAD)) { map.toggle(); pad.rumble.pulse(0.3, 0.18, 0.16); }
  if (pad.pressed(BTN.CREATE)) {
    hudRoot.style.display = hudRoot.style.display === "none" ? "" : "none";
    click();
  }
  if (pad.pressed(BTN.OPTIONS)) { debugConsole.toggle(); click(); }
}

const debugConsole = setupDebugConsole({
  scene,
  camera,
  renderer,
  world,
  tuning,
  pad,
  spawn: SPAWN,
  getControls: () => controls,
  getDragon: () => dragon,
  getFlights: () => flights,
});

function animate() {
  requestAnimationFrame(animate);
  tick++;

  const dt = Math.min(clock.getDelta(), 0.1); // clamp so tab-outs don't lurch

  // Read the pad once, up front. getGamepads() returns a snapshot rather than a
  // live object, so every consumer this frame has to share this one read.
  pad.poll(dt);
  updatePadView(dt);

  // Drain the buffered look input. Applying it here instead of inside the
  // mousemove handler decouples input rate from frame rate, so a trackpad
  // firing 200 tiny events a second lands as one smooth rotation per frame.
  const lookK = damp(LOOK_LAMBDA, dt);
  const dYaw = pendingYaw * lookK;
  const dPitch = pendingPitch * lookK;
  pendingYaw -= dYaw;
  pendingPitch -= dPitch;
  camYaw += dYaw;
  camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);

  if (controls) controls.update(dt);

  if (dragon) {
    // Keep him out of both the rock and the water.
    const floor = Math.max(
      world.getHeightAt(dragon.position.x, dragon.position.z) + 6,
      world.seaLevel + 10
    );

    // Ground rush: the closer to the deck, the more the pad growls. This is the
    // one cue that's genuinely useful rather than decorative — the chase camera
    // is a bad judge of altitude over flat water.
    const agl = dragon.position.y - floor;
    if (agl < GROUND_RUSH_AGL) {
      const t = 1 - Math.max(0, agl) / GROUND_RUSH_AGL;
      const speedT = controls
        ? THREE.MathUtils.clamp((controls.getSpeed() - 0.1) / 1.3, 0, 1) : 0;
      pad.rumble.sustain(0.06 * t * t, 0.30 * t * t * (0.35 + 0.65 * speedT));
    }

    if (tuning.collide) {
      if (dragon.position.y < floor) {
        // Scrape along the floor, and thump properly on the frame he arrives.
        const depth = THREE.MathUtils.clamp((floor - dragon.position.y) / 4, 0, 1);
        if (!wasGrounded) pad.rumble.pulse(0.7, 1.0, 0.28 + depth * 0.2);
        else pad.rumble.sustain(0.24, 0.30);
        dragon.position.y = floor;
        wasGrounded = true;
      } else {
        wasGrounded = false;
      }
    } else {
      wasGrounded = false; // ghost mode — don't thump the moment it's turned off
    }
  }

  // Wingbeat. Cubed so it's a thump on the downstroke rather than a sine
  // wobble, and scaled by amplitude — a hard climb pounds, a glide is silent.
  if (updateWings) {
    const beat = updateWings.getBeat();
    const stroke = Math.max(0, -Math.sin(beat.phase)) ** 3;
    pad.rumble.sustain(0.05 * beat.amp * stroke, 0.30 * beat.amp * stroke);
  }

  if (updateWings && controls) updateWings(dt, controls.getFlightState());
  if (flights) flights.update(dt);

  world.update(dragon ? dragon.position : null, dt);

  // Manual camera swing (C). The only thing besides the mouse allowed to touch
  // yaw, and it only runs because the player asked for it.
  if (recentering && controls) {
    // Opposite the travel vector = behind his tail, looking at his back.
    const d = angleDelta(camYaw, controls.getHeading() + Math.PI);
    if (Math.abs(d) < 0.01) recentering = false;
    else camYaw += d * damp(RECENTER_LAMBDA, dt);
  }

  updateHud();
  map.update(dt);

  if (dragon) {
    if (!rigReady) {
      focus.copy(dragon.position).y += LOOK_HEIGHT;
      rigReady = true;
    }

    // 1. Smooth the tracking position, not the orientation. Vertical gets its
    //    own slower rate so wingbeat bob and terrain clamping don't jolt the view.
    const kXZ = damp(FOCUS_LAMBDA_XZ, dt);
    focus.x += (dragon.position.x - focus.x) * kXZ;
    focus.z += (dragon.position.z - focus.z) * kXZ;
    focus.y += (dragon.position.y + LOOK_HEIGHT - focus.y) * damp(FOCUS_LAMBDA_Y, dt);

    // 2. Speed drives boom length and FOV — a function of throttle only, so it
    //    never depends on which way he's pointing.
    const speedT = THREE.MathUtils.clamp(
      (controls.getSpeed() - 0.1) / (1.4 - 0.1), 0, 1
    );
    const dist = tuning.distBase + DIST_SPEED * speedT;

    camera.fov += (tuning.fovBase + FOV_SPEED_GAIN * speedT * speedT - camera.fov)
                * damp(FOV_LAMBDA, dt);
    camera.updateProjectionMatrix();

    // 3. Orbit point from the player's own yaw/pitch.
    const horizontalDist = dist * Math.cos(camPitch);
    const verticalDist   = dist * Math.sin(camPitch);
    desiredCamPos.set(
      focus.x + horizontalDist * Math.sin(camYaw),
      focus.y + verticalDist + 2,
      focus.z + horizontalDist * Math.cos(camYaw)
    );

    // 4. Spring the boom toward it, so hard acceleration lets him pull away
    //    from the camera before it catches up.
    camera.position.lerp(desiredCamPos, damp(BOOM_LAMBDA, dt));

    // Keep the boom out of the rock and out of the sea.
    const minY = Math.max(
      world.getHeightAt(camera.position.x, camera.position.z) + 3,
      world.seaLevel + 4
    );
    if (camera.position.y < minY) camera.position.y = minY;

    camera.lookAt(focus);
  }

  // Last thing in the frame: every contributor has had its say, so mix them all
  // down into one effect and send it.
  pad.flush(dt);

  renderer.render(scene, camera);
}

animate();