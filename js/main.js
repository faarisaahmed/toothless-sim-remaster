import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupDragonControls, angleDelta } from "./controls.js";
import { setupWorld, ISLANDS } from "./world.js";
import { setupDebugConsole } from "./debug.js";
import { setupWings } from "./wings.js";
import { wingRoots } from "./dragonrig.js";
import { setupFlightRig } from "./flightrig.js";
import { setupGame } from "./game.js";
import { bindDragon } from "./dragonrig.js";
import { makePlayer, createState } from "./player.js";
import { mission1, SITES, RIG } from "./chapters.js";
import { setMapSites } from "./map.js";
import { buildRig, buildHollowStack } from "./places.js";
import { setupPost } from "./postfx.js";
import { setupFlights } from "./flights.js";
import { setupGamepad, BTN } from "./gamepad.js";
import { setupMap } from "./map.js";
import { setupDualSense } from "./dualsense.js";
import { setupPadView } from "./padview.js";
import { music, CREDITS } from "./audio.js";
import { setupPlasma, MAX_SHOTS } from "./plasma.js";
import { setupHealth } from "./health.js";
import { showLoading, warmUp } from "./loading.js";
import { detectTier, tierSettings, createGovernor } from "./quality.js";
import * as keymap from "./keymap.js";
import { createAim } from "./aim.js";

// Live-tunable knobs, mutated by the debug console.
const tuning = {
  fovBase: 70,
  distBase: 11,   // metres. He is 8.6 m nose to tail, so this frames him
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

// Up before anything heavy, so the black frame the user stares at is at least
// a black frame that says what it is doing.
const loading = showLoading({
  title: "Night Alone",
  tip: keymap.tipLine(),
});

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,     // widens toward 88 with speed
  window.innerWidth / window.innerHeight,
  1,      // near: the chase cam sits 14 units out, so 1 is plenty
  50000   // far: has to contain the sky dome
);

// What this machine is, decided once. Everything downstream that cannot change
// at runtime — shadow map size, cloud count, whether bloom is even in the post
// stack — comes from here; the frame rate itself is held by the governor below.
const TIER = detectTier();
const QUALITY = tierSettings(TIER);

const renderer = new THREE.WebGLRenderer({
  // MSAA off, and not as a compromise: the whole frame is rendered into the
  // composer's float target and only the finished composite ever touches the
  // default framebuffer. A multisampled backbuffer is therefore allocated,
  // paid for, and never drawn into. Anti-aliasing here is the render scale's
  // job — above 1.0 it is supersampling, which beats MSAA on an alpha-tested
  // forest anyway.
  antialias: false,
  powerPreference: "high-performance",
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
// The ceiling, not the setting. The governor moves the real ratio underneath
// this, and a 3x phone panel asking for nine times the pixels of a 1x one is
// not a request anybody has to honour.
const BASE_DPR = Math.min(window.devicePixelRatio, QUALITY.maxDpr);
renderer.setPixelRatio(BASE_DPR);
// The physical sky shader outputs well above 1.0 and nothing was mapping it
// down, so midday was a white sheet. ACES plus an exposure under one gives the
// highlights somewhere to roll off to and puts the blue back in the sky.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post?.setSize(window.innerWidth, window.innerHeight);
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

const DIST_SPEED = 10;   // extra boom length at 750 mph

// Critically-damped-ish tracking. Horizontal is tight so he stays framed;
// vertical is looser, which absorbs the flap wobble and the terrain floor
// clamp without dragging the whole camera up and down with them.
//
// A fixed lambda is a fixed *time* constant, which at a fixed speed is a fixed
// DISTANCE — and that distance used to be 18 m of lag at cruise and 19 m at
// 750 mph, which is why he crawled toward the edge of frame the faster he
// went. What actually wants holding constant is the lag in metres, so both
// rates now scale with airspeed and the budget below is the real setting.
const FOCUS_LAMBDA_XZ = 18;
const FOCUS_LAMBDA_Y  = 7;
const FOCUS_MAX_LAG   = 2;   // metres the focus point may trail him by
const BOOM_LAMBDA     = 9;   // spring-arm lag; he pulls away under burst
const BOOM_MAX_LAG    = 12;  // ...but never by more than this
const LOOK_HEIGHT     = 1.5;

const FOV_SPEED_GAIN = 24; // 70 deg at cruise, 94 flat out
const FOV_LAMBDA = 3;

// Look ahead of him along the flight path, so at speed you are shown where he
// is going rather than where he is. Capped, because a full 0.16 s of lead at
// 750 mph would put the focus 54 m down the road and drop him off the bottom
// of the frame.
// Curved rather than linear in speed, because a lead proportional to airspeed
// is already 9 m at cruise — enough to push him visibly off centre while he is
// only doing 123 mph, which is not the moment that wants the drama.
const LEAD_MAX   = 10;   // metres, at 750 mph
const LEAD_CURVE = 1.5;

// The trail. Yaw belongs to the player and always did, but "belongs to" was
// implemented as "and nothing ever gives it back": after a carve you were left
// looking at his flank until you thought to press C. Now a look input parks the
// camera wherever you put it, and once you stop, it eases back in behind him on
// its own — quickly at speed, lazily at a hover, so it never fights a slow
// sightseeing orbit.
const TRAIL_DELAY      = 0.7;  // seconds of no look input before it re-centres
const TRAIL_LAMBDA_MIN = 0.8;  // at a hover
const TRAIL_LAMBDA_MAX = 3.6;  // at 750 mph
const TRAIL_PITCH_SHARE = 0.5; // pitch follows the flight path at half rate

// Terrain occlusion. The old code clamped the camera above the height field at
// its own position, which stops it burying itself in a hillside but does
// nothing at all about a cliff standing between it and him — the common case,
// because the interesting flying is down in the stacks. This marches the boom
// and pulls it in to whatever length still has line of sight.
const OCCLUDE_STEPS = 12;
const OCCLUDE_CLEAR = 5;    // metres of daylight the boom keeps over the rock
const OCCLUDE_IN    = 22;   // pulls in fast — being blinded is worse than a jolt
const OCCLUDE_OUT   = 2.2;  // and lets back out slowly
const BOOM_HARD_MIN = 9;    // he is 8.6 m nose to tail; closer than this is inside him
let boomScale = 1;
const boomDir = new THREE.Vector3();   // scratch, rebuilt every frame

// A carve leans the horizon. Small: this is the difference between a turn you
// watch and a turn you are in, and any more than this reads as a bug.
const CAM_LEAN = 0.20;
let camLean = 0;

const RECENTER_LAMBDA = 7;
let recentering = false;

// Aiming. Owns his head, the crosshair, the stamina bar and — in scoped mode —
// the camera and the speed of the world. See js/aim.js for why the two modes
// are shaped so differently.
const aim = createAim();

// Right stick look, in radians per second at full deflection. The stick is
// already sampled once a frame and curved, so unlike the mouse it goes straight
// on rather than through the smoothing buffer.
const PAD_LOOK_YAW   = 2.9;
const PAD_LOOK_PITCH = 2.0;
const PAD_ZOOM_RATE  = 22;   // boom units per second on the d-pad
const BOOM_MIN = 6;
const BOOM_MAX = 46;

const GROUND_RUSH_AGL = 110; // altitude at which the pad starts to growl
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
  // `closest` only exists on Elements, and a click can be retargeted at the
  // document itself — by an extension, a synthetic event, or a shadow root.
  if (e.target?.closest?.("#hud, #console, #map")) return;

  // Already captured? Then a left click is the trigger, not a request to
  // capture again — which is how every game with a mouse behaves. The shot
  // itself is fired from `mousedown` below, not from here: a `click` does not
  // land until the button is released, which is the same quarter-second of lag
  // the old tap-to-fire key had.
  if (document.pointerLockElement === document.body) return;

  // Ask for raw, unaccelerated deltas. Not every browser supports the option,
  // so fall back to a plain lock if the promise rejects.
  const req = document.body.requestPointerLock({ unadjustedMovement: true });
  if (req && typeof req.catch === "function") {
    req.catch(() => document.body.requestPointerLock());
  }
});

// Left mouse fires, right mouse aims. Both held, both only while the pointer is
// captured — otherwise a right-click on the chart or the console would put him
// in his own head, and a left-click on the HUD would spend a shot.
window.addEventListener("mousedown", (e) => {
  if (document.pointerLockElement !== document.body) return;
  if (e.target?.closest?.("#hud, #console, #map")) return;
  if (e.button === 2) aim.setHeld(true);
  if (e.button === 0) { if (!blastHeld) wantBlast = true; blastHeld = true; }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 2) aim.setHeld(false);
  if (e.button === 0) blastHeld = false;
});
// Losing the window mid-aim otherwise leaves the camera in his skull with the
// clock at a third speed and no button held down to get out of it.
window.addEventListener("blur", () => { aim.release(); blastHeld = false; });
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== document.body) { aim.release(); blastHeld = false; }
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
  if (keymap.isAction("aim", e.code)) aim.setHeld(true);
  if (keymap.isAction("alignCamera", e.code)) recentering = true;
  if (keymap.isAction("grid", e.code)) world.toggleGrid();
  if (keymap.isAction("padView", e.code)) padView.toggle();
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
let lastLookAt = 0;   // when the player last moved the look stick or mouse

const world = setupWorld(scene, renderer, QUALITY);

// The archipelago has a tune. It will not actually make a sound until the
// player clicks or presses something — see the note in audio.js — so calling it
// here rather than on first input costs nothing and keeps the wiring in one place.
music.play("flight");

// His ordinary fire. Terrain comes from the world so a blast that misses still
// lands on something, rather than sailing off to the edge of the map.
// Declared here rather than up with the input state: this runs at module top
// level, well before that block, and a `let` read above its own declaration is
// a ReferenceError rather than an undefined.
const health = setupHealth();
const plasma = setupPlasma(scene, {
  getHeightAt: (x, z) => world.getHeightAt(x, z),
  seaLevel: world.seaLevel,
});

let controls = null;
let dragon = null;
let updateWings = null;
let flightRig = null;
let flights = null;
let tick = 0;

let dragonReady = null;
const loader = new GLTFLoader();
loader.load(
  "./assets/models/dragon_rigged_hd.glb",
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

    const wing = wingRoots(skel);
    if (wing) updateWings = setupWings(wing[0], wing[1], tuning);
    else console.warn("main: no wing bones on this model, wings will not beat");

    // Everything the beat does not cover: legs tucked, wing camber, the tail
    // fins working as rudder and elevator. Null on the older skeletons, which
    // have none of those bones.
    flightRig = setupFlightRig(dragon);

    // Before the wing rig has posed anything: bindDragon snapshots the current
    // rotations as its rest, and a rest taken mid-wingbeat folds him wrong.
    groundRig = bindDragon(dragon);
    groundRig.snapFold(0);
    aim.bind(dragon);

    // Clone the wild flights BEFORE anything poses the player's bones — the
    // wing rig captures whatever rotation the bones are in as its rest pose.
    flights = setupFlights(scene, gltf.scene, tuning, world, 7, SPAWN);

    controls = setupDragonControls(dragon, () => camYaw, pad);
    dragonReady?.();
  },
  (ev) => {
    // Nearly all of the wait is this one file.
    if (ev.lengthComputable) loading.step(0.05 + (ev.loaded / ev.total) * 0.35, "Loading the dragon");
  },
  (e) => { console.error(e); loading.fail("The dragon model did not load"); dragonReady?.(); }
);
const dragonLoaded = new Promise((res) => { dragonReady = res; });

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudHeading = document.getElementById("hud-heading");
const hudDegrees = document.getElementById("hud-degrees");
const hudSpeed   = document.getElementById("hud-speed");
const hudBurst   = document.getElementById("hud-burst");
const hudKnife   = document.getElementById("hud-knife");
const hudShots   = document.getElementById("hud-shots");
if (hudShots) {
  for (let i = 0; i < MAX_SHOTS; i++) hudShots.appendChild(document.createElement("s"));
}
let shownShots = -1, shownCharging = -1;
const hudRoot    = document.getElementById("hud");
const hudPadTag  = document.getElementById("hud-pad-tag");

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
let shownDegrees = null;
let shownSpeed = null;
let shownBurst = null;   // last state the Flat Out readout was drawn in

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

  const speed = Math.round(controls.getSpeedMph());
  if (speed !== shownSpeed) {
    hudSpeed.textContent = speed;
    hudSpeed.classList.toggle("bursting", controls.isBursting());
    shownSpeed = speed;
  }

  if (hudShots && plasma) {
    const n = plasma.shots;
    // The next pip along fills as it comes back, so the recharge is visible
    // rather than being a number that silently ticks up.
    const charging = n < MAX_SHOTS ? Math.round(plasma.rechargeT * 4) : -1;
    if (n !== shownShots || charging !== shownCharging) {
      const pips = hudShots.children;
      for (let i = 0; i < pips.length; i++) {
        pips[i].className = i < n ? "on" : (i === n && charging >= 2 ? "charging" : "");
      }
      shownShots = n; shownCharging = charging;
    }
  }

  const knifeCharge = controls.getKnifeCharge();
  hudKnife.style.transform = `scaleX(${knifeCharge})`;
  hudKnife.classList.toggle("spent", knifeCharge < 0.3);

  // Was "Burst Ready / Burst Charging" against a cooldown. There is no cooldown
  // — it is a gear he is either in or not — so the readout says which, and when
  // he is not in it, it says the key that puts him there.
  // A vertical manoeuvre outranks it. The stall in particular has to be said
  // out loud: it is the one moment in the flight model the player did not ask
  // for, the controls stop answering for about a second, and without a word for
  // it the honest reading is that the game broke.
  const mode = controls.getMode();
  const flatOut = controls.isBursting();
  const line = mode === "zoom"  ? `Climbing · ${Math.round((1 - controls.getStallT()) * 100)}%`
             : mode === "stall" ? "STALL"
             : mode === "dive"  ? "Diving"
             : mode === "recover" ? "Pulling up"
             : flatOut ? "Flat Out"
             : `Flat Out · ${keymap.label(keymap.keysFor("burst")[0])}`;
  if (line !== shownBurst) {
    hudBurst.textContent = line;
    hudBurst.classList.toggle("ready", flatOut || mode === "dive");
    hudBurst.classList.toggle("stall", mode === "stall");
    shownBurst = line;
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
    `   <b>spd</b> ${controls ? `${controls.getSpeed().toFixed(1)} m/s · ${Math.round(controls.getSpeedMph())} mph` : "—"}\n` +
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
    lastLookAt = performance.now();   // parks the auto-trail, same as the mouse
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
  // Getters: the console is built before the post stack is, and `quality`
  // needs both. By the time anyone can type into it, these resolve.
  tier: TIER,
  keymap,
  aim,
  // Built after this call, so a getter rather than a value — same reason as
  // `post` and `governor` below.
  get plasma() { return plasma; },
  get health() { return health; },
  get grounded() { return grounded; },
  // Function declarations, so hoisting makes these safe to hand over from
  // above where they are written. The console needs them because firing and
  // landing are the two things there is no other way to reach from a script.
  fireBlast, land, takeOff,
  get governor() { return governor; },
  get post() { return post; },
  getStalls: () => ({ log: stallLog, count: stallCount, worst: worstMs, threshold: STALL_MS }),
});

// ---------------------------------------------------------------------------
// Mission 1. The runner in game.js drives the chapters; everything it needs to
// know about the flight sim is handed over in `storyCtx` below, so the chapters
// never reach into this file's internals.
// ---------------------------------------------------------------------------
const player = makePlayer(handoff?.save?.run || createState());
let rig = null, stack = null;
let interactAt = null, interactLabel = "", interactRange = 0, interactTaken = false;
let interactHold = 0;
let holdR = false, holdSleep = false;
// The plasma blast and sleepfire used to share one key, told apart by how long
// you held it — a tap was the blast, a hold was sleepfire. That cannot work,
// because a tap is only a tap once the key comes back UP: every blast arrived
// up to a quarter of a second after it was asked for, and a key held down fired
// nothing at all. The blast is the reflex action in this game. It leaves on the
// way DOWN now, and sleepfire has its own key (see js/keymap.js).
//
// `wantBlast` is the press edge and `blastHeld` is the button's state. Both
// exist because they answer different questions: the edge guarantees that a
// press shorter than a frame still fires, and the held flag is what keeps him
// firing if the player just leans on it.
let wantBlast = false;
let blastHeld = false;

// --- Ground mode ------------------------------------------------------------
// Land on anything above the waterline and walk. The gait, the fold and the
// breathing all already exist in dragonrig.js — this is the missing half, which
// is somewhere to stand and a reason to.
let grounded = false;
let groundRig = null;          // bindDragon, built on first landing
// True from the moment he leaps until the wings finish opening. While it is set
// the ground rig's fold pass runs after the flight rig and overwrites the beat,
// which is what makes the wings sweep open instead of appearing open.
let openingWings = false;
let walkYaw = 0, walkSpeed = 0, landHold = 0;
const walkKeys = { w: false, a: false, s: false, d: false, run: false };
const LAND_AGL = 22;           // how low he has to be before landing is offered
// ...and how slow. speedT is a fraction of his 750 mph top speed, so this is
// about 55 m/s — he has to be at or below cruise, which means easing off the
// gas on the approach rather than arriving at four hundred miles an hour.
const LAND_SPEED = 0.18;
// --- On foot ---------------------------------------------------------------
// 4 m/s was a walk and only a walk, which made the ground a punishment: the
// cove is hundreds of metres across and crossing it took a minute of holding
// one key. He is a big animal and big animals have gears, so there are two —
// hold sprint and he runs. Turning gets slower as he speeds up for the same
// reason it does in the air: you cannot pivot on the spot at a canter, and
// being able to would make the run feel like a cursor rather than an animal.
const WALK_SPEED = 4.0;        // metres per second at a full stride
const RUN_SPEED = 12.5;        // ...and at a run, holding sprint
const WALK_TURN = 1.6;         // radians per second at a walk
const RUN_TURN = 0.85;         // and at a full run
const RUN_ACCEL = 2.1;         // how fast he winds up into it
const WALK_ACCEL = 3.2;        // and how fast he answers at a walk
const GRAVITY = 26;            // m/s^2 during the drop onto the ground
const FOOT_CLEAR = 0.35;       // where his feet sit relative to the height field
// The baseline the impact slope is measured over. Fixed, not scaled by speed:
// the question "is this a wall" is about the terrain, not about him.
const IMPACT_BASELINE = 25;    // m
let fallSpeed = 0;             // vertical velocity while settling
let settling = false;          // dropping onto the ground, not walking yet
let slopePitch = 0, slopeRoll = 0;
let nightAmount = 0, nightTarget = 0;

window.addEventListener("keydown", (e) => {
  if (document.activeElement?.tagName === "INPUT") return;
  if (keymap.isAction("landUse", e.code)) holdR = true;
  if (keymap.isAction("fire", e.code)) { if (!blastHeld) wantBlast = true; blastHeld = true; }
  if (keymap.isAction("sleepfire", e.code)) holdSleep = true;
  // Walking uses the same two axes as flying, which now means the STEERING keys
  // of the current scheme and only those. It used to accept arrows and WASD
  // together; it cannot any more, because in the arrows scheme A, S and D are
  // action keys and walking sideways while strafing is not a thing he does.
  if (keymap.isAction("forward", e.code)) walkKeys.w = true;
  if (keymap.isAction("turnL", e.code))   walkKeys.a = true;
  if (keymap.isAction("back", e.code))    walkKeys.s = true;
  if (keymap.isAction("turnR", e.code))   walkKeys.d = true;
  // Sprint is the same key in the air and on the ground: up there it is the
  // 400 mph gear, down here it is the run.
  if (keymap.isAction("sprint", e.code))  walkKeys.run = true;
  if (keymap.isAction("up", e.code) && grounded) takeOff();
});
window.addEventListener("keyup", (e) => {
  if (keymap.isAction("aim", e.code)) aim.setHeld(false);
  if (keymap.isAction("landUse", e.code)) { holdR = false; interactHold = 0; landHold = 0; }
  if (keymap.isAction("fire", e.code)) blastHeld = false;
  if (keymap.isAction("sleepfire", e.code)) holdSleep = false;
  if (keymap.isAction("forward", e.code)) walkKeys.w = false;
  if (keymap.isAction("turnL", e.code))   walkKeys.a = false;
  if (keymap.isAction("back", e.code))    walkKeys.s = false;
  if (keymap.isAction("turnR", e.code))   walkKeys.d = false;
  if (keymap.isAction("sprint", e.code))  walkKeys.run = false;
});

function land() {
  if (grounded || !dragon) return;
  grounded = true;
  settling = true;
  fallSpeed = 0;
  walkYaw = controls?.getHeading() ?? 0;
  walkSpeed = 0;

  // Hand every bone back before the ground rig takes over. Both of these write
  // rest+delta every frame, so the moment they stop being called the pose
  // freezes — which is why he used to land on tucked ankles with his wings
  // still half open and walk around like that.
  updateWings?.release?.();
  flightRig?.release?.();
  // Ease, from wherever the beat left the wings — not a snap. This is the whole
  // landing animation: he drops, settles onto the slope, and the wings gather in
  // over about a second.
  groundRig?.beginFold();
  openingWings = false;
  aim.release();
}

// ---------------------------------------------------------------------------
// Firing.
//
// Out of his mouth, down his nose, and available whenever the button is down —
// standing, walking, mid-carve, halfway through a sleepfire charge, out of aim
// stamina, upside down at four hundred miles an hour. The only thing that takes
// it away is a cutscene, where the player does not have the controls at all.
//
// It used to be gated on being airborne, which meant the button was simply dead
// on the ground, with no prompt and no empty-click to say why. A weapon that
// sometimes ignores you is worse than a weapon with a long cooldown, because
// the player stops trusting it and stops using it.
//
// Aiming down his NOSE rather than down the camera is the deliberate part, and
// it is the same call whether or not aim is held: with no aim it is his heading
// and his flight path, and with aim held it is wherever the player has swung
// his head to. On the ground he has no flight path, so it is simply where he is
// facing — `walkYaw` is the ground mode's heading and `controls` is not driving
// him at all down there.
//
// @param {boolean} edge true on the press, false on the frames a held button
//   repeats. Only the press gets the flat "empty" tap back, or leaning on the
//   button with no shots left buzzes the pad sixty times a second.
// ---------------------------------------------------------------------------
function fireBlast(edge) {
  const heading = grounded ? walkYaw : controls.getHeading();
  const path    = grounded ? 0 : controls.getPathAngle();
  const dir = aim.direction(heading, path, _shotDir);

  // The head bone is the honest muzzle once he can look off-axis — firing from
  // his origin along a swung head puts the bolt out of his ribs — but it is
  // only there once the model has loaded.
  const head = aim.headPosition();
  const muzzle = head ? _muzzle.copy(head).addScaledVector(dir, 1.4)
                      : _muzzle.copy(dragon.position).addScaledVector(dir, 5.2);
  if (!head) muzzle.y += 0.9;

  // What HE is doing, so the bolt can inherit it. Built from his heading and
  // flight path rather than the aim direction: the aim is where his head is
  // pointed, this is where his body is going, and at 335 m/s those are very
  // different vectors.
  const speed = grounded ? 0 : (controls.getAirspeed?.() ?? 0);
  _shotCarry.set(
    Math.sin(heading) * Math.cos(path), Math.sin(path),
    Math.cos(heading) * Math.cos(path)
  ).multiplyScalar(speed);

  if (plasma.fire(muzzle, dir, _shotCarry)) {
    pad.rumble.pulse(0.55, 0.85, 0.16);
    // It is loud and bright. Every guard on the tier turns around (§2.2).
    for (const g of rig?.guards ?? []) g.alerted = 2.5;
  } else if (edge) {
    pad.rumble.pulse(0.22, 0, 0.07);   // the flat "empty" tap
  }
}

// What a blast can land on. Braziers are the ones that matter — putting one out
// is the whole stealth economy, and there are two ways to do it: a wing-gust on
// a low pass, or a shot from four hundred metres out. Rebuilt every frame
// because braziers go out, but into one reused array.
const _blastTargets = [];
function blastTargets() {
  _blastTargets.length = 0;
  for (const b of rig?.braziers ?? []) {
    if (b.lit) _blastTargets.push({ pos: b.pos, hit: () => b.snuff() });
  }
  return _blastTargets;
}

function takeOffImpulse() {
  settling = false;
  fallSpeed = 0;
}

function takeOff() {
  if (!grounded) return;
  grounded = false;
  takeOffImpulse();
  slopePitch = slopeRoll = 0;
  game.setPrompt(null);
  // Hand the heading back, or he snaps round to wherever he was pointed when
  // he touched down.
  controls?.setHeading(walkYaw);
  dragon.position.y += 3;
  // He is airborne from this frame, so the flight rig owns him — but the wings
  // are still folded, and a folded wing being flapped looks like a broken rig.
  // `openingWings` keeps the fold running ON TOP of the flight rig until they
  // are all the way out; see the frame loop.
  groundRig?.beginUnfold();
  openingWings = !!groundRig;
  pad.rumble.pulse(0.8, 1.0, 0.35);
}

const storyCtx = {
  scene, camera, world, player,
  getPosition: () => (dragon ? dragon.position : new THREE.Vector3()),
  getHeading: () => controls?.getHeading() ?? 0,
  getClimb: () => controls?.getFlightState().climb ?? 0,
  getSpeedT: () => controls?.getFlightState().speedT ?? 0,
  get dragon() { return dragon; },
  get groundRig() { return groundRig; },
  get plasma() { return plasma; },
  get rig() { return rig; },
  get stack() { return stack; },
  setInteract(pos, label = "", range = 150) {
    interactAt = pos; interactLabel = label; interactRange = range;
    interactTaken = false; interactHold = 0;
  },
  tookInteract() { const t = interactTaken; interactTaken = false; return t; },
  setNight(on) { nightTarget = on ? 1 : 0; },
};

// The key legend is a wall of text and it is in the way of the game. Fold it
// away once, a few seconds in, so a first-time player still sees it.
const keysEl = document.getElementById("hud-keys");
if (keysEl) {
  // Built from the keymap rather than written into index.html, so it cannot
  // disagree with what the keys actually do — and so switching scheme redraws
  // it instead of lying about half the bindings.
  const drawLegend = () => { keysEl.innerHTML = keymap.legendHtml(); };
  drawLegend();
  keymap.onSchemeChange(drawLegend);

  setTimeout(() => {
    keysEl.style.transition = "opacity .8s, max-height .8s";
    keysEl.style.overflow = "hidden";
    keysEl.style.opacity = "0";
    keysEl.style.maxHeight = "0";
  }, 9000);
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Slash") return;
    const off = keysEl.style.opacity === "0";
    keysEl.style.opacity = off ? "1" : "0";
    keysEl.style.maxHeight = off ? "1200px" : "0";
  });
}

// Bloom and grade, same stack as the room, but the threshold has to be a
// different order of magnitude. The composer works in linear HDR *before* tone
// mapping, so a physical sky sits at 5-20, not at 1 — at the room's threshold
// of 0.42 the entire sky passes the test and the whole frame goes milky. Out
// here it has to clear daylight and catch only fire.
const post = setupPost(renderer, scene, camera, {
  bloom: QUALITY.bloom ? { strength: 0.7, radius: 0.6, threshold: 2.4 } : false,
  vignette: 0.55,
  grain: 0.010,
  tint: { cool: 0x16233c, warm: 0x241608, mix: 0.42 },
  basePixelRatio: BASE_DPR,
});

// The one dial that runs the whole time. See js/quality.js for why it is this
// dial and not "turn the trees off".
const governor = createGovernor({
  targetFps: 60,
  minScale: QUALITY.minScale,
  maxScale: QUALITY.maxScale,
  onScale: (s) => post.setScale(s),
});
post.setScale(QUALITY.maxScale);
console.info(`quality: tier ${TIER}, dpr cap ${BASE_DPR}, render scale ${QUALITY.maxScale}`);

// ---------------------------------------------------------------------------
// The sleepfire flash.
//
// This used to be `new THREE.PointLight(...)` added to the scene on every shot
// and removed 0.45 s later, which is the single most expensive line you can
// write in three.js. The point-light count is compiled into every shader as a
// #define, so adding one invalidates every material in the scene and takes the
// ocean shader, the terrain shader, the whole forest and the dragon with it —
// and removing it drops those programs' reference counts to zero, so three
// deletes them and the next shot compiles the lot again.
//
// So it lives here instead, permanently, at intensity zero. A point light at
// zero still costs a loop iteration in every fragment shader (see the note in
// places.js), and that is the price of the effect; recompiling the world twice
// a shot is not.
// ---------------------------------------------------------------------------
const SLEEP_FLASH_PEAK = 4000;
const SLEEP_FLASH_TIME = 0.45;
const sleepFlash = new THREE.PointLight(0xbf6bff, 0, 700, 1.7);
scene.add(sleepFlash);
let sleepFlashLife = 0;

const game = setupGame(storyCtx);
storyCtx.game = game;
// For the debug console and for jumping to a beat while building.
window.__na = {
  game, player, storyCtx,
  get dragon() { return dragon; },
  get groundRig() { return groundRig; },
  get plasma() { return plasma; },
  get rig() { return rig; },
  get stack() { return stack; },
  get grounded() { return grounded; },
  get speedT() { return controls?.getSpeedT() ?? -1; },
  getControls: () => controls,
  aim, health, world,
  land, takeOff, fireBlast,
  /** Debug: a bone on the *player's* rig. The wild flights are clones and share
   *  every bone name, so a scene-wide search finds the wrong dragon. */
  bone(n) { let f = null; dragon?.traverse((o) => { if (o.isBone && o.name === n) f = o; }); return f; },
  get walkSpeed() { return walkSpeed; },
  get settling() { return settling; },
  /** Debug: put him somewhere. The archipelago is big and the rig is far out. */
  go(x, y, z) { if (dragon) dragon.position.set(x, y, z); },
  music, musicCredits: CREDITS,
  tier: TIER, quality: QUALITY, governor, post, keymap, aim,
};

// ---------------------------------------------------------------------------
// Where the hunters actually are.
//
// The compound is no longer a platform floating at a hardcoded coordinate — it
// stands on the floor of Dragon Hunter Island's caldera, and that floor is
// procedural, warped and different every time the height field is touched. So
// find it rather than assume it: sweep the bowl for the flattest patch big
// enough to stand a 116 m deck on, and put the compound and the story waypoint
// there together, so they can never drift apart.
// ---------------------------------------------------------------------------
function findCraterFloor() {
  const isle = ISLANDS.find((i) => i.name === "Dragon Hunter Island");
  if (!isle) return null;
  let best = null;
  for (let a = 0; a < Math.PI * 2; a += 0.14) {
    for (let rr = 0; rr < 0.32; rr += 0.025) {
      const x = isle.x + Math.cos(a) * rr * isle.r;
      const z = isle.z + Math.sin(a) * rr * isle.r;
      const h = world.getHeightAt(x, z);
      if (h < world.seaLevel + 14) continue;      // not dry land
      let rough = 0;
      for (const [dx, dz] of [[62, 0], [-62, 0], [0, 62], [0, -62], [44, 44], [-44, -44]]) {
        rough += Math.abs(world.getHeightAt(x + dx, z + dz) - h);
      }
      if (!best || rough < best.rough) best = { x, z, h, rough };
    }
  }
  if (!best) return null;
  // The deck has to clear the highest rock beneath it, not the average, or a
  // hummock in one corner comes up through the planking.
  let top = best.h;
  for (let ix = -58; ix <= 58; ix += 8) {
    for (let iz = -46; iz <= 46; iz += 8) {
      top = Math.max(top, world.getHeightAt(best.x + ix, best.z + iz));
    }
  }
  return { ...best, deckY: top + 1.1 };
}

const placesBuilt = (async () => {
  const floor = findCraterFloor();
  if (floor) {
    SITES.rig.set(floor.x, 0, floor.z);
    RIG.y = floor.deckY;   // every waypoint over the compound reads this
  }

  [rig, stack] = await Promise.all([
    buildRig(scene, SITES.rig, {
      seaLevel: world.seaLevel,
      deckY: floor ? floor.deckY : null,
      groundAt: (x, z) => world.getHeightAt(x, z),
    }),
    buildHollowStack(scene, SITES.stack, {
      ground: Math.max(world.getHeightAt(SITES.stack.x, SITES.stack.z), world.seaLevel + 4),
    }),
  ]);
  // NOT added to the reflection skip list, though they look like they should
  // be: both carry a pool of seven point lights, and hiding a light for the
  // mirror pass changes the scene's light count twice a frame, which makes
  // three recompile every shader in the game. See excludeFromReflection() in
  // ocean.js — it will now refuse them out loud if anyone tries again.
  game.load(mission1(storyCtx));
  // The chart learns a place once he has been to it. Nothing is marked in
  // advance — the whole premise is that the edges are blank.
  const mapSites = [
    { x: SITES.rig.x,   z: SITES.rig.z,   label: "Dragon Hunter Island", found: false },
    { x: SITES.stack.x, z: SITES.stack.z, label: "Hollow Stack", found: false },
    { x: SITES.fish.x,  z: SITES.fish.z,  label: "Shoal",   found: false },
  ];
  setMapSites(mapSites);
  storyCtx.findSite = (label) => {
    const m = mapSites.find((x) => x.label === label);
    if (m) m.found = true;
  };
  game.advance();
})();

// ---------------------------------------------------------------------------
// Start.
//
// Nothing is rendered to the player until the dragon is in, the places are
// built and every shader those things need has been compiled. Doing it in that
// order is the whole point: compiling against a scene that is still missing the
// compound would just move the hitch to the moment you first fly over it.
// ---------------------------------------------------------------------------
(async () => {
  loading.step(0.05, "Loading the dragon");
  await dragonLoaded;
  loading.step(0.45, "Building the archipelago");
  await placesBuilt;
  await warmUp(renderer, scene, camera, (t, label) => loading.step(0.45 + t * 0.55, label));
  loading.done();
  clock.getDelta();       // swallow the whole load as one dt, or frame one lurches
  animate();
})();


// ---------------------------------------------------------------------------
// Stall log.
//
// A dropped frame and a locked-up tab are the same event at different scales,
// and "it keeps freezing" is not a measurement. This records every frame that
// took longer than a person would call instant, with what the frame was doing
// at the time, so `stalls` in the debug console can say whether they are
// clustered (something periodic — a buffer upload, a resize) or constant
// (simply too much work), and where you were when it happened.
//
// The cost is one comparison per frame. It stays in.
// ---------------------------------------------------------------------------
const STALL_MS = 90;
const stallLog = [];
let stallCount = 0, worstMs = 0;

// Shader recompiles are the freeze you cannot see coming, and three gives you
// exactly one cheap way to detect them: the length of its program cache. This
// is an O(1) read per frame.
//
// Some growth is NORMAL and must not cry wolf — the first time you fly over an
// island, its props and near-LOD trees compile, and the count steps up by a
// handful and then plateaus. What is not normal is unbounded growth, which is
// what a moving light count produces: every distinct number of lights needs a
// fresh variant of EVERY material in the scene, so the cache does not plateau,
// it climbs in big jumps for as long as you keep playing.
//
// So the alarm is on the total, not on any single step.
const PROGRAM_GROWTH_ALARM = 40;
let programBase = 0, programWarned = false;

function noteStall(ms) {
  if (ms > worstMs && ms < 3000) worstMs = ms;

  const progs = renderer.info.programs?.length ?? 0;
  if (tick === 120) programBase = progs;
  if (programBase && !programWarned && progs - programBase > PROGRAM_GROWTH_ALARM) {
    programWarned = true;
    console.warn(
      `perf: shader programs grew ${programBase} -> ${progs} during play, which ` +
      `is more than new scenery accounts for. Something is recompiling — check ` +
      `whether the scene's point-light count is changing (adding, removing or ` +
      `HIDING a light all do it). \`perf\` prints the current count.`);
  }

  if (ms <= STALL_MS || ms > 3000) return;   // >3 s is a tab-out, not a stall
  stallCount++;
  const d = dragon?.position;
  stallLog.push({
    t: +(performance.now() / 1000).toFixed(1),
    ms: Math.round(ms),
    tick,
    scale: +post.scale.toFixed(2),
    progs,
    where: d ? `${d.x | 0},${d.y | 0},${d.z | 0}` : "-",
  });
  if (stallLog.length > 60) stallLog.shift();
}

// ---------------------------------------------------------------------------
// Keeping a cutscene inside the world.
//
// A cutscene takes the camera outright, and it should — a shot composed low
// over the water is composed, not a mistake to be corrected, which is why this
// is NOT the chase camera's three-metre standoff. It is a backstop against the
// two things that are never a composition:
//
//   * inside the ground, or under the sea. You see the back faces of the
//     terrain and a sky where the island should be.
//   * off the edge of the height field, where there is nothing to draw.
//
// Both are authoring mistakes rather than runtime ones, and the reason they
// happen is that scene positions are written as absolute world coordinates
// against a world that is procedural. So it warns, once per scene, with the
// numbers — a clamped shot still plays, but it says it was wrong.
// ---------------------------------------------------------------------------
// Scratch for the scoped camera, so a first-person view costs no allocations.
const _shotCarry = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimEye = new THREE.Vector3();
const _aimAt = new THREE.Vector3();
const _aimLook = new THREE.Vector3();

const CINE_CLEAR = 1.2;        // metres above whatever is underneath
let cineWarned = null;

function clampCine(p) {
  const edge = world.size / 2 - 120;
  const x = THREE.MathUtils.clamp(p.x, -edge, edge);
  const z = THREE.MathUtils.clamp(p.z, -edge, edge);
  const floorY = Math.max(world.getHeightAt(x, z), world.seaLevel) + CINE_CLEAR;
  const y = Math.max(p.y, floorY);

  if (cineWarned !== game.cine && (y - p.y > 0.05 || x !== p.x || z !== p.z)) {
    cineWarned = game.cine;
    console.warn(
      `cutscene: camera left the world and was clamped — ` +
      `y ${p.y.toFixed(1)} -> ${y.toFixed(1)}` +
      (x !== p.x || z !== p.z ? `, xz ${p.x | 0},${p.z | 0} -> ${x | 0},${z | 0}` : "") +
      `. Compose cutscene heights relative to the ground (see RIG.y in chapters.js).`);
  }
  p.set(x, y, z);
}

// ---------------------------------------------------------------------------
// Why the frame loop is wrapped.
//
// A frozen picture has three completely different causes and they look
// identical from the outside:
//
//   1. Something throws every frame. requestAnimationFrame is re-armed on the
//      FIRST line of the loop, so the loop keeps being scheduled — it just dies
//      before it renders. The picture stops, the tab stays responsive, and
//      unless the console is open you get no signal at all.
//   2. The WebGL context is lost. Every GL call becomes a no-op. Nothing
//      throws, nothing logs, the last frame stays on screen forever.
//   3. An actual hang, which is the only one of the three where the tab itself
//      stops responding.
//
// Telling them apart is the whole job, so: catch and report once, listen for
// context loss, and say which it was on screen. The cost is one try/catch
// around a function call per frame, which is free.
// ---------------------------------------------------------------------------
function showFatal(title, detail) {
  let el = document.getElementById("na-fatal");
  if (!el) {
    el = document.createElement("div");
    el.id = "na-fatal";
    el.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:9999;padding:14px 18px;" +
      "background:rgba(70,10,10,.94);color:#ffd9d0;font:12px/1.5 ui-monospace,monospace;" +
      "white-space:pre-wrap;border-bottom:1px solid #d97a63;max-height:45vh;overflow:auto";
    document.body.appendChild(el);
  }
  el.textContent = `${title}

${detail}`;
}

let frameErrorShown = false;
function onFrameError(e) {
  if (frameErrorShown) return;      // once, or the log is the new bottleneck
  frameErrorShown = true;
  console.error("frame loop threw — rendering has stopped", e);
  showFatal(
    `The frame loop threw at tick ${tick}. Rendering has stopped; the tab is still alive.`,
    (e && e.stack) || String(e));
}

renderer.domElement.addEventListener("webglcontextlost", (e) => {
  // Without preventDefault the context can never be restored, so take it even
  // though nothing here restores it yet — it keeps the option open.
  e.preventDefault();
  console.error("WebGL context lost");
  showFatal(
    "The WebGL context was lost. Every GL call is a no-op from here, which is " +
    "why the picture froze without an error.",
    "Usually GPU memory pressure or a driver reset. Reload to recover.");
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
  console.warn("WebGL context restored");
});

function animate() {
  requestAnimationFrame(animate);
  try {
    frame();
  } catch (e) {
    onFrameError(e);
  }
}

function frame() {
  tick++;

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);          // clamp so tab-outs don't lurch
  // Raw, not clamped: the governor wants to know a frame took 40 ms. It does
  // its own outlier handling, and feeding it the clamped value would hide
  // exactly the frames it exists to react to.
  governor.submit(rawDt * 1000);
  noteStall(rawDt * 1000);

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
  if (Math.abs(dYaw) > 1e-4 || Math.abs(dPitch) > 1e-4) lastLookAt = performance.now();
  pendingYaw -= dYaw;
  pendingPitch -= dPitch;

  // Real dt: being hurt does not run slower because he is aiming, and the
  // regeneration timer is a promise about seconds rather than about frames.
  health.update(dt);

  // --- Aiming ---------------------------------------------------------
  // Fed the REAL dt on purpose. The stamina bar is the cost of slowing time
  // down, so draining it on the slowed clock would make a full bar last three
  // times longer the moment you spent it.
  aim.update(dt, !grounded && !game.cine);

  // The same mouse delta goes to one place or the other, never both. While he
  // is aiming it turns his head; otherwise it swings the camera. Splitting it
  // would give you a head and a camera drifting apart at half speed each.
  if (!aim.look(dYaw, dPitch)) {
    camYaw += dYaw;
    camPitch = THREE.MathUtils.clamp(camPitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  // Everything that is part of the WORLD runs on this. Frame timing, input,
  // the governor and the aim meter stay on the real one — a slowed clock is a
  // statement about the fiction, not about the machine.
  const sdt = dt * aim.timeScale();

  if (controls && !grounded && !game.cine) controls.update(sdt);

  if (dragon) {
    // Keep him out of both the rock and the water.
    //
    // Sampling only the ground directly under him was fine when he covered
    // 21 m a second. At 335 he covers that in a sixteenth of one, so a rising
    // ridge arrived entirely inside a single frame and the clamp fired as a
    // wall rather than as a floor. Look along his nose by a fixed slice of
    // TIME, not distance: a quarter second of wherever he is actually going,
    // which is 14 m at cruise and 84 m flat out, and take the highest rock in
    // it. The effect is that the ground lifts him over a ridge the way air
    // does, and he only ever hits the hard clamp if he flies at a cliff face.
    let rock = world.getHeightAt(dragon.position.x, dragon.position.z);
    if (controls && !grounded) {
      const h = controls.getHeading();
      const reach = controls.getSpeed() * 0.25;
      for (let i = 1; i <= 3; i++) {
        const d = (reach * i) / 3;
        rock = Math.max(rock, world.getHeightAt(
          dragon.position.x + Math.sin(h) * d,
          dragon.position.z + Math.cos(h) * d
        ));
      }
    }
    const floor = Math.max(rock + 6, world.seaLevel + 10);

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

    // The flight collision floor holds him six metres clear of the rock so a
    // fast pass does not clip. On foot that is exactly wrong — it fought the
    // ground code every frame and parked him five metres in the air.
    if (tuning.collide && !grounded) {
      if (dragon.position.y < floor) {
        // Scrape along the floor, and thump properly on the frame he arrives.
        const depth = THREE.MathUtils.clamp((floor - dragon.position.y) / 4, 0, 1);
        if (!wasGrounded) pad.rumble.pulse(0.7, 1.0, 0.28 + depth * 0.2);
        else pad.rumble.sustain(0.24, 0.30);

        // --- What it cost ---------------------------------------------------
        //
        // Deliberately NOT measured against `rock` above. That is the highest
        // point in a quarter second of his flight path — 84 m ahead flat out —
        // and it exists as a pilot aid: it lifts the floor early so a rising
        // ridge pushes him up the way air would, instead of arriving as a wall
        // inside one frame. Billing him for damage against it turns the aid
        // into a punishment, and it did: a level skim over open water within
        // sight of an island took the whole bar, because the island was in the
        // look-ahead and the look-ahead's normal was pointing at him.
        //
        // What it uses instead is the slope over a SHORT FIXED baseline — 25 m,
        // about two of him, regardless of how fast he is going. That is the one
        // measurement that separates the three cases on its own:
        //
        //   dive at flat ground   slope 0, normal straight up, so the closing
        //                         speed is his descent rate. Large. Hurts.
        //   skim a ridge          the slope over 25 m of a ridge you can fly
        //                         over is gentle, so almost none of his speed
        //                         is INTO it. Free, which it must be.
        //   fly at a cliff face   the slope over 25 m of a cliff is vertical,
        //                         so the closing speed is very nearly all of
        //                         his airspeed. Hurts a great deal.
        //
        // Measuring it against the look-ahead instead could not tell the last
        // two apart, and measuring it against the ground directly underneath
        // could not see the cliff at all: the aid lifts him up the wall, so he
        // is never actually near the rock he flew into.
        const under = world.getHeightAt(dragon.position.x, dragon.position.z);
        if (controls) {
          const h = controls.getHeading();
          const R = IMPACT_BASELINE;
          const ax = Math.sin(h), az = Math.cos(h);
          // Along his nose, and across it, so a cliff he clips at an angle
          // still reads as a cliff.
          const gF = (world.getHeightAt(dragon.position.x + ax * R, dragon.position.z + az * R)
                    - under) / R;
          const gS = (world.getHeightAt(dragon.position.x - az * R, dragon.position.z + ax * R)
                    - under) / R;
          const gx = ax * gF - az * gS, gz = az * gF + ax * gS;
          const inv = 1 / Math.hypot(gx, gz, 1);
          const sp = controls.getSpeed(), vy = controls.getVerticalSpeed();
          const hit = health.impact(
            ax * sp, vy, az * sp,
            -gx * inv, inv, -gz * inv,
            under <= world.seaLevel
          );
          if (hit > 0) {
            pad.rumble.pulse(1.0, 1.0, 0.5);
            // Arriving badly costs the speed as well as the health. Without it
            // he bounces off a cliff still doing 700 mph, which reads as the
            // collision not having happened.
            controls.bleedSpeed?.(0.45);
          }
        }

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

  if (updateWings && controls && !grounded) {
    const st = controls.getFlightState();
    updateWings(sdt, st);
    // After the beat, never before: this reads the beat phase and must not be
    // overwritten by it.
    if (flightRig) flightRig(sdt, st, updateWings.getBeat());
    // And after BOTH, while he is still opening up. applyFold writes the wing
    // bones outright, so it wins over the beat until it reaches zero — at which
    // point it is writing the bind pose, which is exactly what the beat adds its
    // deltas to, so the last frame of the opening and the first frame of normal
    // flight are the same pose.
    if (openingWings && groundRig) {
      if (groundRig.applyFold(sdt) <= 0.001) openingWings = false;
    }
    // Last of all: the flight rig writes the neck and skull from rest every
    // frame, so the aim has to be added on top of it or it is simply erased.
    aim.applyToRig();
  }

  // --- Ground -----------------------------------------------------------
  // He has mass down here. Landing is a drop with gravity in it rather than a
  // teleport onto the height field, and once he is down he sits on the slope
  // instead of standing upright on a hillside like a lamp post.
  if (dragon) {
    const gh = world.getHeightAt(dragon.position.x, dragon.position.z);
    const overLand = gh > world.seaLevel + 3;

    if (grounded && !game.cine) {
      const deck = gh + FOOT_CLEAR;

      if (settling) {
        // Fall onto it. Short, but it is the difference between arriving and
        // being placed.
        fallSpeed += GRAVITY * dt;
        dragon.position.y -= fallSpeed * dt;
        // Fold on the way DOWN, not once he has stopped. This is the drop, and a
        // dragon flaring to land has his wings coming in through it — waiting
        // for the thump meant a second and a half of him falling with his wings
        // spread and then folding them while stood still, which reads as two
        // separate animations rather than one landing.
        groundRig?.applyFold(sdt);
        if (dragon.position.y <= deck) {
          dragon.position.y = deck;
          settling = false;
          // Thump scaled by how hard he came in.
          pad.rumble.pulse(THREE.MathUtils.clamp(fallSpeed / 22, 0.25, 1), 1, 0.3);
          fallSpeed = 0;
        }
        dragon.rotation.set(0, walkYaw + Math.PI, 0);
      } else {
        const turn = (walkKeys.a ? 1 : 0) - (walkKeys.d ? 1 : 0);
        // Two gears, and the turn rate falls off as he picks up speed — mixed
        // by how fast he is ACTUALLY going rather than by whether the key is
        // down, so easing off the run tightens the turn back up on the way out
        // of it instead of the moment the key is released.
        const running = walkKeys.run;
        const gearT = THREE.MathUtils.clamp(
          (Math.abs(walkSpeed) - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
        walkYaw += turn * THREE.MathUtils.lerp(WALK_TURN, RUN_TURN, gearT) * dt;

        // Walking uphill is slower than walking down it.
        const fwd = (walkKeys.w ? 1 : 0) - (walkKeys.s ? 1 : 0);
        const grade = THREE.MathUtils.clamp(-slopePitch * 1.1, -0.28, 0.22);
        // Backwards is always a shuffle. Nothing that size reverses at a run.
        const gear = fwd < 0 ? WALK_SPEED * 0.55 : (running ? RUN_SPEED : WALK_SPEED);
        walkSpeed += (fwd * gear * (1 + grade) - walkSpeed) *
          damp(running ? RUN_ACCEL : WALK_ACCEL, dt);

        // His nose vector is (sin h, cos h), same convention as controls.js.
        const nx = Math.sin(walkYaw), nz = Math.cos(walkYaw);
        dragon.position.x += nx * walkSpeed * dt;
        dragon.position.z += nz * walkSpeed * dt;

        // Stick to the ground, but not instantly — a step up a rock should be a
        // step, not a snap.
        const target = world.getHeightAt(dragon.position.x, dragon.position.z) + FOOT_CLEAR;
        dragon.position.y += (target - dragon.position.y) * damp(11, dt);

        // Sit on the slope. Sample the height field along his nose and across
        // it; that is the surface he is standing on, so that is his attitude.
        const R = 3.2;
        const hF = world.getHeightAt(dragon.position.x + nx * R, dragon.position.z + nz * R);
        const hB = world.getHeightAt(dragon.position.x - nx * R, dragon.position.z - nz * R);
        const hL = world.getHeightAt(dragon.position.x - nz * R, dragon.position.z + nx * R);
        const hR = world.getHeightAt(dragon.position.x + nz * R, dragon.position.z - nx * R);
        const wantPitch = Math.atan2(hF - hB, R * 2);
        const wantRoll = Math.atan2(hR - hL, R * 2);
        slopePitch += (wantPitch - slopePitch) * damp(5, dt);
        slopeRoll += (wantRoll - slopeRoll) * damp(5, dt);

        dragon.rotation.order = "YXZ";
        dragon.rotation.set(-slopePitch, walkYaw + Math.PI, slopeRoll);

        // Walked off the edge. He does the sensible thing rather than falling.
        if (world.getHeightAt(dragon.position.x, dragon.position.z) <= world.seaLevel + 1) takeOff();

        // setFold, not snapFold: this runs every frame he is on the ground, and
        // snapping here is what pinned the fold at 1 and made land() and
        // takeOff() unable to animate anything at all.
        groundRig?.setFold(1);
        const modelScale = dragon.scale.x || 1;
        groundRig?.update(sdt, {
          speed: Math.abs(walkSpeed) / modelScale,
          // RUN_SPEED, not WALK_SPEED. The gait normalises against this, so
          // handing it the walk figure while he is doing 12 m/s asks it for a
          // stride three times over and he scrabbles.
          maxSpeed: RUN_SPEED / modelScale,
        });
        game.setPrompt(
          `<b>${keymap.label(keymap.keysFor("forward")[0])}</b> ` +
          `<b>${keymap.label(keymap.keysFor("back")[0])}</b> walk &nbsp;·&nbsp; ` +
          `<b>${keymap.label(keymap.keysFor("turnL")[0])}</b> ` +
          `<b>${keymap.label(keymap.keysFor("turnR")[0])}</b> turn &nbsp;·&nbsp; ` +
          `<b>${keymap.label(keymap.keysFor("up")[0])}</b> fly`);
      }
    } else if (!grounded) {
      const agl = dragon.position.y - (gh + 6);
      const slow = (controls?.getSpeedT() ?? 1) < LAND_SPEED;
      // R is the one context key, so it has to pick. If there is something to
      // interact with in range, that wins — otherwise R lands.
      const busy = interactAt && dragon.position.distanceTo(interactAt) < interactRange;
      const canLand = overLand && agl < LAND_AGL && slow && !busy;
      if (canLand && holdR) {
        landHold += dt;
        if (landHold > 0.4) { land(); landHold = 0; }
      } else if (!holdR) {
        landHold = Math.max(0, landHold - dt * 2);
      }

      // --- The landing prompt ---------------------------------------------
      // Landing has three conditions and the old prompt only ever mentioned
      // one of them, and only sometimes — over water it said nothing at all,
      // which reads as "landing is broken" rather than "not here". Now every
      // state says which condition is failing and which key fixes it, so the
      // thing is teachable from the screen instead of from the README.
      if (busy) {
        game.setPrompt(`Hold ${keymap.keyTag("landUse")} — ${interactLabel || "use"}`, { hold: interactHold / 0.9 });
      } else if (canLand) {
        game.setPrompt(`Hold ${keymap.keyTag("landUse")} to land`, { hold: landHold / 0.4 });
      } else if (!overLand) {
        // Only nag about it once he is low enough that he was plainly trying.
        game.setPrompt(agl < 140 ? "No land below — find an island" : null, { blocked: true });
      } else if (!slow) {
        game.setPrompt(`Too fast to land — let go of ${keymap.keyTag("forward")}`, { blocked: true });
      } else if (agl < 260) {
        game.setPrompt(`Too high to land — hold ${keymap.keyTag("down")} to drop`, { blocked: true });
      } else {
        game.setPrompt(null);
      }
    }
  }

  // --- Story ----------------------------------------------------------------
  rig?.update(sdt, camera);
  stack?.update(sdt, camera);

  // --- Plasma ---------------------------------------------------------
  // See fireBlast() for the muzzle and the aiming. The gating is all here, and
  // it is deliberately almost nothing: a cutscene, and the model existing.
  //
  // A held button is just the press repeated. plasma.fire() has its own 0.22 s
  // cooldown and there are only six shots, so leaning on it is a burst and then
  // an empty click — not a hose.
  if (plasma && dragon && controls) {
    if ((wantBlast || blastHeld) && !game.cine) fireBlast(wantBlast);
    // Outside the fire branch AND outside the grounded check, because bolts
    // already in the air have to keep flying. This whole block used to sit
    // behind `!grounded`, so landing froze every live shot in mid-air.
    plasma.update(sdt, blastTargets());
  }
  wantBlast = false;

  // Sleepfire. Held, not pressed — it is not a breath and the input should not
  // feel like one (STORY.md §2.2).
  if (player.updateCharge(dt, holdSleep, tick / 60) === "fired") {
    game.refreshState();
    if (dragon) {
      // Position and intensity only. This light is created once, at boot, and
      // never leaves the scene — see sleepFlash below for why adding it here
      // was costing a full shader recompile every time he fired.
      sleepFlash.position.copy(dragon.position);
      sleepFlashLife = SLEEP_FLASH_TIME;
      pad.rumble.pulse(0.9, 1.0, 0.35);
    }
  }

  // The flash decays on the frame clock rather than its own rAF chain, so it
  // cannot outlive a pause and cannot run twice if he fires again mid-fade.
  if (sleepFlashLife > 0) {
    sleepFlashLife = Math.max(0, sleepFlashLife - dt);
    sleepFlash.intensity = SLEEP_FLASH_PEAK * (sleepFlashLife / SLEEP_FLASH_TIME);
  }

  // Hold-to-interact, when he is near the thing and not doing ninety knots.
  if (interactAt && dragon) {
    const d = dragon.position.distanceTo(interactAt);
    const slow = (controls?.getSpeedT() ?? 1) < 0.2;
    if (d < interactRange && slow && holdR) {
      interactHold += dt;
      if (interactHold > 0.9) { interactTaken = true; interactHold = -1.2; }
    } else if (!holdR) {
      interactHold = Math.max(0, interactHold - dt * 2);
    }
  }

  // Night. The rig is workable at night and the sky is his (§2.5).
  if (nightAmount !== nightTarget) {
    nightAmount += Math.sign(nightTarget - nightAmount) * Math.min(dt * 0.35, Math.abs(nightTarget - nightAmount));
    world.setSun(48 - nightAmount * 62);
  }

  game.update(dt);
  if (flights) flights.update(sdt);

  world.update(dragon ? dragon.position : null, sdt);

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

  // On foot the camera falls in behind him. Walking with a free-orbit camera
  // means constantly re-aiming it with the other hand, which is fine in the air
  // where he flies where he points and wrong on the ground where he doesn't.
  if (grounded && !game.cine) {
    const behind = walkYaw + Math.PI;
    const lookIdleNow = performance.now() - lastLookAt > 900;
    if (lookIdleNow) camYaw += angleDelta(camYaw, behind + 0.34) * damp(2.2, dt);
    camPitch += (0.13 - camPitch) * damp(1.6, dt);
  }

  if (dragon) {
    // First frame: put the focus and the camera where they belong rather than
    // letting them spring in from the world origin. The boom lerp is a lag
    // spring, and on frame one it was lagging behind a 950 m jump, so the game
    // opened on a second of the camera chasing him in from nowhere.
    if (!rigReady) {
      focus.copy(dragon.position).y += LOOK_HEIGHT;
      camera.position.set(
        focus.x + Math.cos(camPitch) * Math.sin(camYaw) * tuning.distBase,
        focus.y + Math.sin(camPitch) * tuning.distBase + 2,
        focus.z + Math.cos(camPitch) * Math.cos(camYaw) * tuning.distBase
      );
      rigReady = true;
    }

    const speed  = grounded ? 0 : (controls.getSpeed?.() ?? 0);
    // On the ground there is no airspeed, whatever he last had in the air —
    // otherwise a fast landing left the FOV wound out at 104 degrees.
    const speedT = grounded ? 0 : controls.getSpeedT();

    // 0. Trail in behind him once the player has stopped looking around.
    //    Anything the player does with the mouse or the right stick stamps
    //    lastLookAt and parks this for TRAIL_DELAY, so it can never wrestle the
    //    camera out of your hand mid-look.
    if (!grounded && !recentering && !game.cine) {
      const idleFor = (performance.now() - lastLookAt) / 1000;
      if (idleFor > TRAIL_DELAY) {
        const lam = THREE.MathUtils.lerp(TRAIL_LAMBDA_MIN, TRAIL_LAMBDA_MAX, speedT);
        // Ease the delay boundary in rather than switching it on, so the camera
        // starts drifting back rather than jumping into gear.
        const ramp = THREE.MathUtils.clamp(idleFor - TRAIL_DELAY, 0, 1);
        const behind = controls.getHeading() + Math.PI;
        camYaw += angleDelta(camYaw, behind) * damp(lam * ramp, dt);

        // And follow the flight path, so a dive shows you the sea coming up
        // instead of the top of his head, and a climb doesn't fill the screen
        // with empty sky.
        const wantPitch = 0.26 - controls.getPathAngle() * 0.55;
        camPitch += (wantPitch - camPitch) * damp(lam * ramp * TRAIL_PITCH_SHARE, dt);
      }
    }

    // 1. Smooth the tracking position, not the orientation. Vertical gets its
    //    own slower rate so wingbeat bob and terrain clamping don't jolt the
    //    view. Both rates rise with airspeed so the lag stays a fixed number of
    //    metres rather than a fixed number of seconds.
    const trackXZ = Math.max(FOCUS_LAMBDA_XZ, speed / FOCUS_MAX_LAG);
    const trackY  = Math.max(FOCUS_LAMBDA_Y,  speed / (FOCUS_MAX_LAG * 3));

    // Lead him along the flight path. This is most of what makes 750 mph read
    // as 750 mph: at cruise it is 9 m and you barely see it, flat out it is the
    // full 26 and he sits low in a frame full of oncoming archipelago.
    const lead = LEAD_MAX * Math.pow(speedT, LEAD_CURVE);
    const path = grounded ? 0 : controls.getPathAngle();
    const h = controls.getHeading();
    const leadX = Math.sin(h) * Math.cos(path) * lead;
    const leadZ = Math.cos(h) * Math.cos(path) * lead;
    const leadY = Math.sin(path) * lead;

    const kXZ = damp(trackXZ, dt);
    focus.x += (dragon.position.x + leadX - focus.x) * kXZ;
    focus.z += (dragon.position.z + leadZ - focus.z) * kXZ;
    focus.y += (dragon.position.y + leadY + LOOK_HEIGHT - focus.y) * damp(trackY, dt);

    // 2. Speed drives boom length and FOV — a function of throttle only, so it
    //    never depends on which way he's pointing.
    const dist = grounded ? 15 : tuning.distBase + DIST_SPEED * speedT;

    camera.fov += (tuning.fovBase + FOV_SPEED_GAIN * speedT * speedT - camera.fov)
                * damp(FOV_LAMBDA, dt);
    camera.updateProjectionMatrix();

    // 3. Orbit point from the player's own yaw/pitch, then walk the boom out
    //    from him and stop at the first thing in the way. Sampling the height
    //    field along the arm is enough — the occluders out here are the island
    //    and the sea stacks, and both of them ARE the height field.
    const lift = grounded ? 3.4 : 2;
    boomDir.set(
      Math.cos(camPitch) * Math.sin(camYaw),
      Math.sin(camPitch),
      Math.cos(camPitch) * Math.cos(camYaw)
    );
    let clear = 1;
    for (let i = 1; i <= OCCLUDE_STEPS; i++) {
      const t = i / OCCLUDE_STEPS;
      const px = focus.x + boomDir.x * dist * t;
      const pz = focus.z + boomDir.z * dist * t;
      const py = focus.y + boomDir.y * dist * t + lift * t;
      const ground = Math.max(world.getHeightAt(px, pz), world.seaLevel) + OCCLUDE_CLEAR;
      if (py < ground) { clear = (i - 1) / OCCLUDE_STEPS; break; }
    }
    // Snap in when something cuts him off, ease back out when it clears — the
    // other way round and you spend the whole pass staring at rock.
    boomScale += (clear - boomScale) * damp(clear < boomScale ? OCCLUDE_IN : OCCLUDE_OUT, dt);
    boomScale = THREE.MathUtils.clamp(boomScale, 0.1, 1);
    // Never so close that the near plane starts eating his tail. Against a
    // sheer face this means the rock wins and you lose the shot — which is the
    // honest outcome, and better than the camera ending up inside his ribs.
    const armed = Math.max(dist * boomScale, BOOM_HARD_MIN);

    desiredCamPos.set(
      focus.x + boomDir.x * armed,
      focus.y + boomDir.y * armed + lift,
      focus.z + boomDir.z * armed
    );

    // 4. Spring the boom toward it, so hard acceleration lets him pull away
    //    from the camera before it catches up — bounded the same way the focus
    //    is, so "pulls away" stays a moment rather than becoming the resting
    //    state at speed.
    const boomLam = Math.max(BOOM_LAMBDA, speed / BOOM_MAX_LAG);
    camera.position.lerp(desiredCamPos, damp(boomLam, sdt));

    // A cutscene takes the camera outright — the one thing it is allowed to do.
    //
    // "Outright" now means it: this used to aim at cine.look and then get
    // overwritten by the chase camera's own lookAt two lines further down, so
    // every cutscene played from the scripted position while still staring at
    // the dragon. The terrain floor is skipped for the same reason — a shot
    // composed low over the water is composed, not a mistake to be corrected.
    // --- Scoped aim takes the camera to his head -------------------------
    // Blended rather than cut, so entering and leaving is a move rather than a
    // teleport, and so the third-person camera is still what you are looking
    // through for the first few frames of the transition.
    const scopeBlend = aim.blend;
    const headPos = scopeBlend > 0.001 ? aim.headPosition() : null;

    const cine = game.cine;
    if (cine) {
      const e = cine.t * cine.t * (3 - 2 * cine.t);   // ease, no hard start
      camera.position.lerpVectors(cine.from, cine.to, e);
      clampCine(camera.position);
      camera.lookAt(cine.look);
    } else {
      // Keep the boom out of the rock and out of the sea. Skipped once the
      // scope has taken over: his head is his head, and shoving it up out of a
      // hillside would be shoving HIM, not the camera.
      if (scopeBlend < 0.999) {
        const minY = Math.max(
          world.getHeightAt(camera.position.x, camera.position.z) + 3,
          world.seaLevel + 4
        );
        if (camera.position.y < minY) camera.position.y = minY;
      }

      camera.lookAt(focus);

      if (headPos) {
        const dir = aim.direction(controls.getHeading(), controls.getPathAngle(), _aimDir);
        // A little way down the barrel, so his own skull is behind the near
        // plane instead of filling the frame.
        _aimEye.copy(headPos).addScaledVector(dir, 1.15);
        _aimEye.y += 0.25;
        camera.position.lerpVectors(camera.position, _aimEye, scopeBlend);
        // Aim at a point far enough away that the look direction is the aim
        // direction and not a parallax of it — the crosshair sits on this.
        _aimAt.copy(_aimEye).addScaledVector(dir, 600);
        _aimLook.copy(focus).lerp(_aimAt, scopeBlend);
        camera.lookAt(_aimLook);
      }
    }

    // Lean the horizon into a carve. Applied after lookAt, about the camera's
    // own view axis, so it is a roll of the picture and not a change of aim.
    // Not while scoped: the lean is a flourish applied to a chase camera, and
    // rolling the picture around a crosshair just moves the crosshair.
    if (!cine && scopeBlend < 0.02) {
      const wantLean = grounded ? 0 : -(controls.getTurnT?.() ?? 0) * CAM_LEAN;
      camLean += (wantLean - camLean) * damp(3.4, dt);
      if (Math.abs(camLean) > 1e-4) camera.rotateZ(camLean);
    }
  }

  // Last thing in the frame: every contributor has had its say, so mix them all
  // down into one effect and send it.
  pad.flush(dt);

  post.render(dt);
}

// animate() is started by the loading sequence above, once warm.