import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupDragonControls, angleDelta } from "./controls.js";
import { setupWorld } from "./world.js";
import { setupDebugConsole } from "./debug.js";
import { setupWings } from "./wings.js";
import { setupFlights } from "./flights.js";
import { setupGamepad, BTN } from "./gamepad.js";
import { setupMap } from "./map.js";
import { setupDualSense } from "./dualsense.js";
import { setupPadView } from "./padview.js";

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

// boot.js sets these up before the title screen and hands them over. Two
// setupGamepad() calls would each poll getGamepads() and each get a snapshot,
// so the presses would arrive at one of them and not the other. Reuse, or make
// our own if this file was loaded directly.
const handoff = window.__nightAlone || null;

const pad = handoff?.pad || setupGamepad();

// Direct HID link to a DualSense, when the browser has WebHID and the user has
// granted the device. Silently absent otherwise — the Gamepad API path stays.
const dualsense = handoff?.dualsense || setupDualSense();
if (!handoff) {
  pad.rumble.attachHID(dualsense);
  // A device granted in an earlier session comes back without a prompt.
  dualsense.reattach();
}
const padView = setupPadView(pad);

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
  if (e.code === "KeyP") padView.toggle();
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

// Browsers report the id as a long vendor string; pull the family out of it.
function padFamily() {
  const id = pad.id();
  if (/dualsense|0ce6|0df2/i.test(id)) return "DualSense";
  if (/dualshock|054c/i.test(id)) return "DualShock";
  return "Gamepad";
}

// --- The footer tag ---------------------------------------------------------
// Doubles as the way in. Four states, and the label always says what the next
// useful action is rather than just reporting status:
//
//   no pad, no link      -> "Find controller"   (opens the HID picker)
//   pad, no link         -> "Enable haptics"    (same picker, different reason)
//   link but no pad      -> "press a button"    (HID and the Gamepad API are
//                                                separate grants; only a button
//                                                press reveals the axes)
//   both                 -> "DualSense · HID"
let padTagState = "";
let padTagBusy = false;

function updatePadTag() {
  if (padTagBusy) return;

  const on   = pad.connected();
  const link = dualsense.isReady();
  const can  = dualsense.isAvailable();

  let label, action = false;
  if (on && link)      label = `${padFamily()} · HID`;
  else if (on && can) { label = "Enable haptics"; action = true; }
  else if (on)         label = padFamily();
  else if (link)       label = "Linked · press a button";
  else if (can)       { label = "Find controller"; action = true; }
  else                 label = "";

  const next = `${label}|${action}`;
  if (next === padTagState) return;
  padTagState = next;

  hudPadTag.textContent = label;
  hudPadTag.hidden = !label;
  hudPadTag.classList.toggle("action", action);
  hudPadTag.classList.remove("searching");
  hudPadTag.title = action
    ? "Connect a DualSense directly for rumble and adaptive triggers"
    : "";
}

hudPadTag.addEventListener("click", async (e) => {
  // Never let this reach the document handler that grabs the pointer.
  e.stopPropagation();
  if (!dualsense.isAvailable() || dualsense.isReady()) return;

  padTagBusy = true;
  hudPadTag.textContent = "Searching…";
  hudPadTag.classList.add("searching");
  hudPadTag.classList.remove("action");

  // requestDevice needs the user gesture we're inside right now.
  const ok = await dualsense.request();

  padTagBusy = false;
  padTagState = ""; // force the next frame to relabel from scratch

  if (ok) {
    hidAnnounced = true; // this message is the better one; don't say it twice
    debugConsole.log(`hid connected — ${dualsense.name()} over ${dualsense.transport()}`, "note");
    debugConsole.log("granted for good — it'll link itself from now on.");
    pad.rumble.pulse(0.65, 0.85, 0.45); // confirm it in the only way that counts
  } else {
    const why = dualsense.error() || "cancelled";
    debugConsole.log(`hid not connected: ${why}`, "err");
    if (dualsense.candidates() > 1) {
      debugConsole.log(`  ${dualsense.candidates()} entries tried, none took a report.`);
    }
  }
});

// --- Keeping the link up ----------------------------------------------------
// Haptics are meant to be on by default, and after the first grant they can be:
// getDevices() shows no UI and needs no user gesture, so re-adopting a pad we
// already have permission for is something this can just do. Which makes the
// footer tag's picker a first-run step rather than something to remember.
//
// It's a retry rather than a one-shot at load because getDevices() can resolve
// before a Bluetooth pad has finished enumerating, and because a link that
// drops — or one that opened but wouldn't take a write — should come back on
// its own instead of needing the pad replugged.
const HID_RETRY = 2.5;
let hidRetryClock = HID_RETRY;
let hidAnnounced = false;

function keepHidLinked(dt) {
  if (!dualsense.isAvailable() || padTagBusy) return;

  if (dualsense.isReady()) {
    if (!hidAnnounced) {
      hidAnnounced = true;
      debugConsole.log(
        `hid linked — ${dualsense.name()} over ${dualsense.transport()}`, "note");
    }
    return;
  }

  hidAnnounced = false;
  hidRetryClock += dt;
  if (hidRetryClock < HID_RETRY) return;
  hidRetryClock = 0;
  dualsense.reattach();
}

// WebHID and the Gamepad API are separate grants, but they're also separate
// claims on the same physical device. If we've opened it over HID and the
// Gamepad API still sees nothing after a few seconds, say so — an open HID
// handle is a plausible reason the sticks never show up, and `hid off` is the
// one-word test for it.
let hidWarnClock = 0;
let hidWarned = false;

function checkHidConflict(dt) {
  if (hidWarned || pad.connected() || !dualsense.isReady()) {
    if (pad.connected()) hidWarnClock = 0;
    return;
  }
  hidWarnClock += dt;
  if (hidWarnClock < 4) return;
  hidWarned = true;
  debugConsole.log("the pad is open over WebHID but the Gamepad API sees no pad.", "err");
  debugConsole.log("  press any button on it first — that's what reveals the sticks.");
  debugConsole.log("  still nothing? run 'hid off' to release the direct link, then");
  debugConsole.log("  press a button again. If it comes back, the HID claim was the cause.");
}

// --- Live input monitor -----------------------------------------------------
// Everything the game itself sees, on screen, updating every frame. `frame`
// climbing proves the loop is alive; the sticks proving live while the heading
// sits still would put the fault in the flight model rather than the input.
const padMon = document.getElementById("padmon");
let padMonOn = false;

function togglePadMon() {
  padMonOn = !padMonOn;
  padMon.hidden = !padMonOn;
  return padMonOn;
}

function updatePadMon() {
  if (!padMonOn) return;

  const btns = [];
  for (let i = 0; i < 18; i++) if (pad.held(i)) btns.push(i);

  const on = pad.connected();
  const mark = (ok, s) => `<span class="${ok ? "good" : "bad"}">${s}</span>`;

  padMon.innerHTML =
    `<b>frame</b> ${tick}   <b>gamepad</b> ${mark(on, on ? "yes" : "NO")}` +
    `   <b>hid</b> ${dualsense.isReady() ? "linked" : "—"}\n` +
    `<b>id</b>    ${pad.id() || "—"}\n` +
    `<b>stick</b> L ${pad.lx.toFixed(2)} ${pad.ly.toFixed(2)}` +
    `    R ${pad.rx.toFixed(2)} ${pad.ry.toFixed(2)}\n` +
    `<b>trig</b>  L2 ${pad.value(BTN.L2).toFixed(2)}  R2 ${pad.value(BTN.R2).toFixed(2)}\n` +
    `<b>btn</b>   ${btns.join(" ") || "—"}\n` +
    `<b>hdg</b>   ${controls ? THREE.MathUtils.radToDeg(controls.getHeading()).toFixed(1) + "°" : "—"}` +
    `   <b>spd</b> ${controls ? controls.getSpeed().toFixed(3) : "—"}\n` +
    `<b>pos</b>   ${dragon
      ? `${dragon.position.x.toFixed(0)}, ${dragon.position.y.toFixed(0)}, ${dragon.position.z.toFixed(0)}`
      : "—"}`;
}

function updatePadView(dt) {
  const on = pad.connected();
  updatePadTag();
  keepHidLinked(dt);
  checkHidConflict(dt);

  if (on !== padWasConnected) {
    // Both columns are always in the legend; connecting a pad just brings its
    // column forward and lets the keyboard one recede. The footer tag looks
    // after itself in updatePadTag.
    hudRoot.classList.toggle("pad-live", on);
    // The pre-flight surfaces key off the body instead, since they exist
    // before the HUD does.
    document.body.classList.toggle("pad-live", on);
    // Leave a trail in the console, so "it was connecting before" has evidence
    // behind it rather than being reconstructed from memory.
    if (padWasConnected !== null) {
      debugConsole.log(on ? `gamepad connected — ${pad.id()}` : "gamepad disconnected", "note");
    }
    padWasConnected = on;
    if (on) pad.rumble.pulse(0.4, 0.55, 0.3); // say hello
  }

  if (!on) return;

  // With the chart up, Circle backs out of it. Consuming the press stops the
  // same frame reaching the flight controls, where Circle is strafe right.
  if (map.isOpen() && pad.pressed(BTN.CIRCLE)) {
    map.close();
    pad.consume(BTN.CIRCLE);
    pad.rumble.pulse(0.28, 0.14, 0.14);
  }

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
  dualsense,
  togglePadMon,
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
  // Straight after the poll and before anything consumes a press, so the
  // overlay shows what arrived rather than what survived.
  padView.update();
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
      const speedT = controls ? controls.getSpeedT() : 0;
      // Surface texture rather than a proximity alarm. What you feel down here
      // is the ground going PAST, so it scales with how fast it's going past —
      // hovering a few metres off the deck is silent — and it's grained rather
      // than smooth, because a surface has a grain and a warning light doesn't.
      const rush = t * t * (0.12 + 0.88 * speedT);
      const now = performance.now();
      const grain = 0.55 + 0.45 * Math.sin(now * 0.047) * Math.sin(now * 0.019);
      pad.rumble.sustain(0.08 * rush * grain, 0.34 * rush * grain);
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

  // Lightbar follows his state: amber at cruise, running hot toward the burst,
  // red while he's scraping the deck. Costs nothing when there's no HID link.
  if (dualsense.isReady() && controls) {
    const t = controls.getSpeedT();
    if (wasGrounded) dualsense.setLightbar(255, 40, 24);
    else if (controls.isBursting()) dualsense.setLightbar(255, 120, 30);
    else dualsense.setLightbar(Math.round(120 + 135 * t), Math.round(90 - 40 * t), 20);
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
  updatePadMon();
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
    const speedT = controls.getSpeedT();
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