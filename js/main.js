import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { createNpcDragon, createPuffs } from "./npcdragon.js";
import { loadKit, createActor } from "./dragonkit.js";
import { setupDragonControls, angleDelta } from "./controls.js";
import { setupWorld, ISLANDS } from "./world.js";
import { CLEARING } from "./terrain.js";
import { setupDebugConsole } from "./debug.js";
import { setupWings } from "./wings.js";
import { wingRoots } from "./dragonrig.js";
import { setupFlightRig } from "./flightrig.js";
import { setupGame } from "./game.js";
import { bindDragon } from "./dragonrig.js";
import { makePlayer, createState } from "./player.js";
import { SITES, RIG } from "./chapters.js";
import { createSession } from "./session.js";
import { buildHunterBase } from "./hunterbase.js";
import { pitLayout } from "./terrain.js";
import { CloudPass, CLOUD_QUALITY, loadCloudNoise } from "./clouds.js";
import { chapterOfBeat, chapterById } from "./storyline.js";
import { setMapSites, setMapObjective } from "./map.js";
import { buildRig, buildHollowStack, buildSnareCamp } from "./places.js";
import { setupPost, SunShaftShader } from "./postfx.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { setupFlights } from "./flights.js";
import { setupGamepad, BTN } from "./gamepad.js";
import { setupMap } from "./map.js";
import { setupDualSense } from "./dualsense.js";
import { setupPadView } from "./padview.js";
import { music, CREDITS } from "./audio.js";
import { setupPlasma, MAX_SHOTS } from "./plasma.js";
import { setupBolas } from "./bolas.js";
import { setupHorizon } from "./horizon.js";
import { setupHealth } from "./health.js";
import { setupTouch } from "./touch.js";
import { settings } from "./settings.js";
import { setupPause } from "./pause.js";
import { showLoading, warmUp } from "./loading.js";
import { tierSettings, createGovernor } from "./quality.js";
import { graphics, LEVELS } from "./graphics.js";
import * as keymap from "./keymap.js";
import { createAim } from "./aim.js";
import { createSurfaces } from "./surfaces.js";
import { createGroundBody } from "./groundbody.js";
import { createBaseDetail } from "./basedetail.js";

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
  // What is about to start, read straight off the handoff — this runs before
  // the session (or anything else) exists.
  sub: (() => {
    const h = window.__nightAlone;
    if (h?.mode === "free") return "Free flight";
    const beat = h?.chapter ? chapterById(h.chapter)?.beats[0] : h?.save?.beat;
    const c = chapterOfBeat(beat || "leave");
    return c ? `Chapter ${c.n} · ${c.title}` : "";
  })(),
  tip: keymap.tipLine(),
});

const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// Framing across aspect ratios.
//
// `camera.fov` in three.js is the VERTICAL angle, so a fixed value frames the
// subject the same on any WIDE screen and falls apart on a tall one: a phone
// held in portrait is 390 x 844, an aspect of 0.46, and 70 degrees vertical
// there is 36 degrees horizontal — narrower than a telephoto lens, with a
// fourteen-metre wingspan in the middle of it. He filled the frame corner to
// corner and there was nowhere for him to be.
//
// So below the reference the vertical angle opens up to hold the horizontal one
// roughly where it was. Clamped, because the correction is unbounded as the
// frame gets narrower and a 140 degree lens is its own kind of broken: past the
// clamp it is still the wrong shape to fly in, which is what the "turn the
// phone" notice is for.
//
// The reference is 1.2 rather than 16:9 on purpose. It only has to catch frames
// that are TALL, and 1.2 is squarer than any monitor anybody has — 5:4 is
// 1.25 — so every desktop window, every resized desktop window and every phone
// in landscape gets exactly the fov it got before this existed. Correcting from
// 16:9 downward instead would have quietly widened the lens on a 4:3 window
// from 70 degrees to 86, which is not a mobile fix, it is a different game.
// ---------------------------------------------------------------------------
const REF_ASPECT = 1.2;
const FOV_MAX = 96;

function fovForAspect(fov, aspect) {
  if (!(aspect > 0) || aspect >= REF_ASPECT) return fov;
  const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * REF_ASPECT);
  const wide = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / aspect));
  return Math.min(FOV_MAX, wide);
}

const camera = new THREE.PerspectiveCamera(
  70,     // widens toward 88 with speed
  window.innerWidth / window.innerHeight,
  1,      // near: the chase cam sits 14 units out, so 1 is plenty
  50000   // far: has to contain the sky dome
);
// The aspect correction has to be applied at construction as well as on every
// resize, or the first frame on a phone in portrait is drawn through the
// 36-degree lens described above. Not by calling fitToViewport() -- that reads
// `post`, which is a const a thousand lines below this, so calling it here
// would land in its temporal dead zone.
camera.fov = fovForAspect(camera.fov, camera.aspect);
camera.updateProjectionMatrix();

// What this machine is, decided once. Everything downstream that cannot change
// at runtime — shadow map size, cloud count, whether bloom is even in the post
// stack — comes from here; the frame rate itself is held by the governor below.
// The tier is still what the machine is guessed to be; what is actually used
// is whatever the graphics menu says, which starts from that guess and is
// remembered from then on (js/graphics.js).
const TIER = graphics.tier;
const GFX = graphics.state;
const QUALITY = {
  ...tierSettings(TIER),
  maxDpr: GFX.maxDpr,
  shadowMap: LEVELS.shadows[GFX.shadows] ?? 1024,
  // Built at the full count and thinned live, so the menu can bring them back.
  clouds: 105,
  reflectEvery: LEVELS.reflections[GFX.reflections] ?? 2,
  treeNear: LEVELS.trees[GFX.trees]?.near,
  treeFar: LEVELS.trees[GFX.trees]?.far,
  grass: GFX.grass,
  terrainDetail: GFX.terrain,
  minScale: graphics.scaleBounds()[0],
  maxScale: graphics.scaleBounds()[1],
};

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

function fitToViewport() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = fovForAspect(tuning.fovBase, camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post?.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", fitToViewport);
// A phone rotating fires `orientationchange` before the new innerWidth is
// readable, and on iOS the address bar sliding away fires neither — so listen
// to the visual viewport too, which is the only thing that reliably knows how
// much room the page actually has.
window.addEventListener("orientationchange", () => setTimeout(fitToViewport, 120));
window.visualViewport?.addEventListener("resize", fitToViewport);

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
// Pulls in quickly — being blinded is worse than a lag — but no longer
// instantly: at 22 the boom snapped in and out every frame skimming a ridge,
// which read as the camera shaking. The margin below is computed continuously
// rather than in twelfths, so it has nothing to flicker between.
const OCCLUDE_IN    = 9;
const OCCLUDE_OUT   = 2.2;  // and lets back out slowly
const BOOM_HARD_MIN = 9;    // he is 8.6 m nose to tail; closer than this is inside him
let boomScale = 1;
// Smoothed copies of the two things the camera reads off his flight path. The
// raw path angle moves fast now that rise and lower are sharp, and a camera
// that follows it directly bounces with every tap of the key.
let camPath = 0;
const camLead = new THREE.Vector3();
const boomDir = new THREE.Vector3();   // scratch, rebuilt every frame

// A carve leans the horizon. Small: this is the difference between a turn you
// watch and a turn you are in, and any more than this reads as a bug.
const CAM_LEAN = 0.20;
let camLean = 0;

const RECENTER_LAMBDA = 7;
let recentering = false;

// The on-screen controls. Built here rather than in boot.js because it is the
// flight scene's overlay and nothing else shows it. Returns null when the
// option is off, which is the default, and then this costs one import, no DOM
// and no listeners.
const touch = setupTouch();

// The in-game menu, on - or =. Opening it stops the world and lets the mouse
// go; closing it drops any key that was held when it opened, so coming back
// from the menu never resumes into a carve nobody asked for.
let paused = false;
let caged = false;
const pause = setupPause({
  onOpen() {
    paused = true;
    controls?.clearKeys();
    aim.release();
    blastHeld = false;
    holdR = holdSleep = false;
    for (const k in walkKeys) walkKeys[k] = false;
    pad?.rumble.stop?.();
  },
  onClose() { paused = false; },
  // Esc belongs to whatever else is up first: the chart, the console, a
  // cutscene's skip, the end-of-story card.
  // (`game` and `session` are declared further down; a key pressed while the
  // world is still loading would otherwise land in their temporal dead zone.)
  canOpen: () => {
    try {
      return !document.getElementById("map")?.classList.contains("open") &&
        !document.getElementById("console")?.classList.contains("open") &&
        !document.querySelector(".na-end.on") &&
        !game.cine;
    } catch { return false; }
  },
  journal: () => { try { return session.journal(); } catch { return null; } },
  onQuit: () => session.toTitle(),
  onRestart: () => session.restartChapter(),
});

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
  // With the on-screen controls up, a tap on empty screen is not a request to
  // capture the mouse — there is no mouse. Asking anyway fails silently on a
  // phone and pops a permission bar on a touchscreen laptop.
  if (touch) return;

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

// The one input the on-screen controls cannot send as a key. Looking is a
// delta rather than a state, and the mouse path below is gated on pointer
// lock, which a touchscreen does not have — so js/touch.js drags land here
// instead, in the same units and with the same signs.
window.addEventListener("na-look", (e) => {
  recentering = false;
  pendingYaw += e.detail.dx;
  pendingPitch += e.detail.dy;
});

window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== document.body) return;

  // Drop implausible jumps rather than letting them whip the camera around.
  if (Math.abs(e.movementX) > LOOK_SPIKE || Math.abs(e.movementY) > LOOK_SPIKE) return;

  recentering = false; // any look input cancels the manual camera swing
  // The inversions and the speed come from js/settings.js rather than from
  // `tuning`. `tuning` is the debug console's scratchpad and does not persist,
  // so "invert the camera" was a setting you had to make again every reload.
  const sens = tuning.lookSensitivity * settings.lookSpeed();
  pendingYaw   -= e.movementX * sens * settings.lookX();
  pendingPitch -= e.movementY * sens * settings.lookY();
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
// The chase camera is smoothed RELATIVE to him, never in world space. Easing
// an absolute position toward a moving target leaves it trailing by about
// v·dt/2 of whatever the last frame's length was, so when Chrome falls behind
// and frames come 16, 33, 16, 50 ms apart, that trail changes every frame and
// he shakes on screen — half a metre at cruise, metres flat out. Here the lag
// is a smooth function of his (smoothed) velocity, and the camera keeps its
// place relative to the focus between frames, so how long a frame took changes
// nothing about where he sits in the picture.
const camTarget = new THREE.Vector3();      // where the focus would be with no lag
const focusLag = new THREE.Vector3();       // focus minus camTarget
const camVel = new THREE.Vector3();         // his smoothed velocity, m/s
const camPrevDragon = new THREE.Vector3();
const lastFocus = new THREE.Vector3();
const camRel = new THREE.Vector3();         // camera minus focus
const _lagV = new THREE.Vector3();
let lastLookAt = 0;   // when the player last moved the look stick or mouse

const world = setupWorld(scene, renderer, QUALITY);
// Everything he can stand on: the terrain, and every place that registers its
// geometry (surfaces.js). The ground body and the gait both ask this.
const surfaces = createSurfaces((x, z) => world.getHeightAt(x, z), world.seaLevel);
// Trees pick their level of detail round the camera, not the dragon.
world.flora.setViewer?.(camera);
// Land past the edge of the chart. Silhouettes only — see horizon.js. Built
// here rather than inside setupWorld because it is not part of the world in the
// sense the rest of that file means: nothing samples it, nothing collides with
// it, and the height field does not know it exists.
const horizon = setupHorizon(scene);
// Kept out of the mirror pass, and it is not an optimisation. A nine-kilometre
// island reflected in water that is itself nine kilometres away is a shape the
// reflection has no resolution to place: it renders as a second, inverted
// mountain hanging under the real one, right where the sea is palest and the
// contrast is highest. The real reflection of something that far away is worth
// nothing and the artefact is worth less than nothing. No lights in it, so
// ocean.js will not refuse this.
world.excludeFromReflection(horizon.group);

// The archipelago has a tune. It will not actually make a sound until the
// player clicks or presses something — see the note in audio.js — so calling it
// here rather than on first input costs nothing and keeps the wiring in one place.
music.play("flight");
// Seconds the big cue keeps playing after he comes off the gas, so a short
// burst does not start a crossfade it immediately reverses.
const MUSIC_BIG_HOLD = 9;
let musicBigHold = 0;

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
// A near miss on a cage counts too: a blast landing in the cage ring during
// the strike splashes off the bars, and the point of the beat is the bars.
plasma.onImpact((at, hit) => {
  // A blast is loud. Every hunter in earshot who has not already got him goes
  // to look at where it went off — which is how a shot into the rocks pulls a
  // guard off his post (hunters.js noise()).
  if (rig?.hunters && !game.cine) rig.hunters.noise(at, 110);
  if (!storyCtx.cagesShootable || !hit?.ground) return;
  if ((rig?.cages ?? []).some((c) => c.pos.distanceTo(at) < 16)) storyCtx.cageHits++;
});
// What the hunters throw back. Same two hooks as the plasma — a height field
// so a miss lands on the deck instead of falling through it, and the sea.
const bolas = setupBolas(scene, {
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
let npcTemplate = null;
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
    // An untouched copy for the story's other dragons, taken for the same
    // reason as the flights: before anything has posed a bone.
    npcTemplate = cloneSkinned(gltf.scene);

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
const hudAlt = document.getElementById("hud-alt");
const hudTape = document.getElementById("hud-tape");
const hudTapeWp = document.getElementById("hud-tape-wp");
// The compass tape: three turns of the dial laid end to end, slid under a fixed
// window so north never has to wrap. 3 px a degree; ticks every 15, a letter
// every 45.
const TAPE_PX = 3;
if (hudTape) {
  let html = "";
  for (let d = -360; d <= 720; d += 15) {
    const n = ((d % 360) + 360) % 360;
    const major = n % 45 === 0;
    html += `<span class="t${major ? " m" : ""}" style="left:${(d + 360) * TAPE_PX}px">` +
      (major ? `<b>${COMPASS_POINTS[n / 45]}</b>` : "") + `</span>`;
  }
  hudTape.innerHTML = html;
}
let shownAlt = null, shownTape = null, shownWp = null;
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

  // The tape moves continuously, not per whole degree, or it ticks.
  const exact = (THREE.MathUtils.radToDeg(Math.atan2(Math.sin(h), -Math.cos(h))) + 360) % 360;
  if (hudTape && Math.abs(exact - (shownTape ?? -99)) > 0.05) {
    hudTape.style.transform = `translateX(${-(exact + 360) * TAPE_PX}px)`;
    shownTape = exact;
  }
  // Where the objective is, on the same tape: a diamond at its bearing, pinned
  // to the end of the window when it is outside it, so "which way" is answered
  // without looking for the marker.
  const wp = game.waypoint;
  if (hudTapeWp) {
    let key = "none";
    if (wp && dragon) {
      const dx = wp.x - dragon.position.x, dz = wp.z - dragon.position.z;
      const b = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
      let rel = ((b - exact + 540) % 360) - 180;
      const edge = Math.abs(rel) > 52;
      rel = THREE.MathUtils.clamp(rel, -52, 52);
      key = `${Math.round(rel * 4)}${edge}`;
      if (key !== shownWp) {
        hudTapeWp.style.transform = `translateX(${rel * TAPE_PX}px) rotate(45deg)`;
        hudTapeWp.classList.toggle("edge", edge);
      }
    }
    if (key !== shownWp) { hudTapeWp.classList.toggle("on", key !== "none"); shownWp = key; }
  }

  if (hudAlt && dragon) {
    const alt = Math.max(0, Math.round(dragon.position.y - Math.max(world.seaLevel, 0)));
    if (alt !== shownAlt) { hudAlt.textContent = alt; shownAlt = alt; }
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
  // Trimming outranks the burst readout too, and it names the way out of it.
  // Climb and dive are double-tap-and-hold now (see controls.js), and a gate
  // the player cannot see is a gate they will assume is a bug — they lean on
  // the key, he rises a little, and nothing they do makes it a climb.
  // Snared outranks everything, including the stall. He is falling, the lift
  // axis has stopped answering, and the way out is not obvious — so the line
  // says the word and then says what to do about it.
  const snared = controls.getSnared();
  const line = snared > 0 ? "SNARED · roll left and right"
             : controls.isRolling() ? "Barrel roll"
             : mode === "zoom"  ? `Climbing · ${Math.round((1 - controls.getStallT()) * 100)}%`
             : mode === "stall" ? "STALL"
             : mode === "dive"  ? "Diving"
             : mode === "drop"  ? "Dropping"
             : mode === "recover" ? "Pulling up"
             : controls.isTrimming() ? "Trim · double-tap to commit"
             : flatOut ? "Flat Out"
             : `Flat Out · ${keymap.label(keymap.keysFor("burst")[0])}`;
  if (line !== shownBurst) {
    hudBurst.textContent = line;
    hudBurst.classList.toggle("ready",
      flatOut || mode === "dive" || controls.isRolling());
    hudBurst.classList.toggle("stall", mode === "stall" || snared > 0);
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
    keysPanel?.classList.toggle("pad-live", on);
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
    const padSpeed = tuning.padLookSpeed * settings.padSpeed();
    camYaw -= pad.rx * PAD_LOOK_YAW * padSpeed * dt * settings.padX();
    camPitch = THREE.MathUtils.clamp(
      camPitch - pad.ry * PAD_LOOK_PITCH * padSpeed * dt * settings.padY(),
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
  get bolas() { return bolas; },
  get rig() { return rig; },
  horizon,
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
// A chapter replay or free flight starts clean; a slot resumes with whatever
// it was carrying. Cloned, so the live state and the save never share objects.
const player = makePlayer(
  !handoff?.chapter && handoff?.mode !== "free" && handoff?.save?.run
    ? JSON.parse(JSON.stringify(handoff.save.run))
    : createState());
let rig = null, stack = null, camp = null;
let baseDetail = null;
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
let walkGearDebug = 1;
let wingHeave = 0;             // the beat's body heave currently applied, metres
// His body on the ground, as a body (groundbody.js). Feet from the rig's bind
// pose, in the model's frame (nose at -z).
const groundBody = createGroundBody({
  surfaces,
  feet: [{ x: -0.42, z: -1.88 }, { x: 0.42, z: -1.88 }, { x: -0.39, z: -0.86 }, { x: 0.39, z: -0.86 }],
  hipY: 1.0,
});
const _landVel = new THREE.Vector3();
let wasSupported = false;         // debug: scales the ground speeds (window.__na.walkGear)
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
//
// The numbers come from his size. His hips are a metre up, and for any
// quadruped that size the walk turns into a trot at about 2 m/s and the trot
// into a gallop at about 5 (gait.js has the reasoning). So the plain key is a
// ground-eating trot — what a dog or a big cat does to actually get somewhere —
// and sprint is the full bounding gallop. He passes through the walk every time
// he sets off or pulls up, and the gait shows it.
const WALK_SPEED = 4.2;        // metres per second: a brisk trot
const RUN_SPEED = 14.0;        // ...and the gallop, holding sprint
const WALK_TURN = 2.5;         // radians per second at a trot
const RUN_TURN = 1.15;         // and at a full gallop
const RUN_ACCEL = 2.8;         // how fast he winds up into it
const WALK_ACCEL = 5.0;        // and how fast he answers at a trot
const GRAVITY = 26;            // m/s^2 during the drop onto the ground
// Where his origin sits relative to the height field. His feet are placed on
// the ground by the gait's leg IK, so this is how low he carries his body: a
// touch below his bind height, so the legs stand a little bent, like a cat's,
// rather than locked straight.
const FOOT_CLEAR = 0.0;
// His footprint, fore-aft and across. The slope is sampled over this, and it is
// also what decides how far the ORIGIN has to rise on a hillside: he pivots
// about his origin, so on a slope the downhill end of a 3.2 m body drops
// 3.2·tan(slope) below it. At 30 degrees that is 1.8 m and the origin was only
// ever lifted 0.35 — which is why landing on anything but the flat buried one
// side of him in the rock and left the other hanging in the air.
const FOOT_R = 3.2;            // m
// Steeper than this and there is nowhere to stand. Refusing is better than
// letting him land on a cliff face and stand at sixty degrees to the world.
// With a real body (groundbody.js) he can come down on a steep slope and slide
// or scrabble to a stop, so the limit is only for faces nobody could stand on.
const LAND_SLOPE_MAX = 0.95;   // radians, ~54 degrees

/**
 * The attitude of the ground under him, and how far his origin has to sit
 * above the height field to keep all four feet on it.
 *
 * Shared by the walk loop and by land(), which is the point: the landing used
 * to hold him level through the drop and only start matching the slope on the
 * first frame of walking, from whatever pitch and roll were left over from the
 * last hillside he stood on. So he arrived flat, then lurched.
 */
function groundAttitude(x, z, nx, nz) {
  const hF = world.getHeightAt(x + nx * FOOT_R, z + nz * FOOT_R);
  const hB = world.getHeightAt(x - nx * FOOT_R, z - nz * FOOT_R);
  const hL = world.getHeightAt(x - nz * FOOT_R, z + nx * FOOT_R);
  const hR = world.getHeightAt(x + nz * FOOT_R, z - nx * FOOT_R);
  const pitch = Math.atan2(hF - hB, FOOT_R * 2);
  const roll = Math.atan2(hR - hL, FOOT_R * 2);

  // How much the origin has to rise, and it is a much smaller number than it
  // first looks. The first version was FOOT_R·(|tan pitch| + |tan roll|), on
  // the reasoning that a body pivoting about its origin drops its downhill end
  // below it — which is true, and irrelevant, because the attitude above is
  // fitted to the same slope, so the feet come down WITH the ground. Adding it
  // anyway left him hovering 1.7 m over a 21-degree hillside.
  //
  // What is actually needed is the RESIDUAL: the plane fitted through those
  // four samples is only a plane, and real ground is bumpy, so this is how far
  // the worst of the four sits above the fit. Zero on anything flat or evenly
  // sloped, a few centimetres on rough ground, and enough on a convex ridge to
  // keep his feet out of the rock.
  const hC = world.getHeightAt(x, z);
  const dF = (hF - hB) / 2, dS = (hR - hL) / 2;
  const lift = Math.max(0,
    hF - (hC + dF), hB - (hC - dF),
    hR - (hC + dS), hL - (hC - dS));
  return { pitch, roll, lift, steep: Math.hypot(pitch, roll) };
}
// The baseline the impact slope is measured over. Fixed, not scaled by speed:
// the question "is this a wall" is about the terrain, not about him.
const IMPACT_BASELINE = 25;    // m
let fallSpeed = 0;             // vertical velocity while settling
let settling = false;          // dropping onto the ground, not walking yet
// The flare. Where his attitude started when he committed to the landing, where
// the hillside says it should end up, and how far through we are.
let settleFrom = null, settleTo = null, settleT = 0;
let slopePitch = 0, slopeRoll = 0, slopeLift = 0;


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
  // On the ground he gets the cords off. Nothing here animates him doing it —
  // but carrying a snare into the walk rig would leave him sinking through an
  // island, and the flight model is the only thing the snare knows how to act
  // on in the first place.
  controls?.clearSnare();
  controls?.clearRoll();
  // The walk owns his attitude from here, and it writes dragon.rotation against
  // the slope. controls.js's pitch/roll node sits under that — see
  // releaseAttitude() — so it has to go back to identity or he lands banked.
  controls?.releaseAttitude();

  // Read the hillside NOW, before the drop, and seed the attitude with it so
  // he flares onto the slope through the fall instead of arriving flat and
  // then rotating into it. `slopePitch` and `slopeRoll` were whatever was left
  // over from the last patch of ground he stood on, which on a fresh landing
  // several islands away is a completely arbitrary attitude to start from.
  // He comes down as a body with the speed he had (the camera keeps a clean
  // measure of it), and flares, runs out and settles from there.
  _landVel.copy(camVel);
  wasSupported = false;

  // Hand every bone back before the ground rig takes over. Both of these write
  // rest+delta every frame, so the moment they stop being called the pose
  // freezes — which is why he used to land on tucked ankles with his wings
  // still half open and walk around like that.
  updateWings?.release?.();
  if (dragon) dragon.position.y -= wingHeave;   // take the beat's heave back out
  wingHeave = 0;
  flightRig?.release?.();
  groundBody.begin(dragon, _landVel, walkYaw);
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
  // A bola in the air is something he can shoot. It costs one of six shots and
  // it needs a lead on a small moving target, which makes it a real decision
  // rather than a free answer — and it is the only thing in the game that
  // rewards firing at something other than a brazier.
  for (const t of bolas.targets()) _blastTargets.push(t);
  // The failed strike: a cage takes the blast and nothing happens.
  if (storyCtx.cagesShootable) {
    for (const c of rig?.cages ?? []) {
      c._shot ??= { pos: c.pos, hit: () => { storyCtx.cageHits++; } };
      _blastTargets.push(c._shot);
    }
  }
  // A blast knocks a hunter flat. Nobody dies in this story (STORY.md §0.5):
  // he gets up a minute later wondering what hit him.
  if (rig?.hunters && dragon) {
    for (const m of rig.hunters.men) {
      if (m.ko > 0 || m.inside || m.pos.distanceTo(dragon.position) > 450) continue;
      m._shot ??= { pos: new THREE.Vector3(), hit: () => rig.hunters.knockOut(m, 60) };
      m._shot.pos.copy(m.pos).y += 1.2;
      _blastTargets.push(m._shot);
    }
  }
  return _blastTargets;
}

// ---------------------------------------------------------------------------
// The hunters throw back.
//
// The compound has had a stealth score since it was built — §2.6's "the
// darkness is the resource" — and nothing was ever spent against it. Snuffing
// sixteen braziers changed a fraction on a readout and that was all, so the
// dark was a collectible. This is what it buys.
//
// The rule is the one the recon beat already states out loud: they throw at
// what they can SEE. Light is most of that and noise is the rest, so a glide
// through a dark compound draws nothing at all, and a climb across a lit deck
// draws everything. Every brazier he puts out is a real reduction in what is
// coming at him, and he can feel it go down while he works.
//
// The projectile itself lives in bolas.js; this is only the decision to throw.
// ---------------------------------------------------------------------------

/** A guard will throw at anything inside this, and nothing outside it. */
const HUNT_RANGE   = 250;   // m
/** ...but not at something already past him. Under this he is gone before the
 *  weight arrives, and a throw straight up reads as a bug. */
const HUNT_MIN     = 18;    // m
/** Seconds between one man's throws. The spread is what stops five guards
 *  firing on the same frame forever once they have all seen him at once. */
const HUNT_RELOAD  = 2.2;
const HUNT_RELOAD_SPREAD = 2.6;
/** ...and no two throws anywhere closer together than this, so the deck lays
 *  down a rhythm he can fly through rather than a wall he cannot. */
const HUNT_STAGGER = 0.55;  // s
/** Below this much visibility they never throw. Full dark and gliding is
 *  genuinely invisible, and it has to be, or stealth is decoration. */
const HUNT_SEEN_MIN = 0.14;

let huntStagger = 0;
let alarmToasted = false;
// What the hunters are looking at: him. Filled in each frame.
const huntTarget = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), loud: false, hidden: false, speedT: 0,
                     grounded: false, move: 0, noise: 0 };

// "?" and "!" over the heads of the men who have noticed him — the stealth is
// unplayable if you cannot see who is about to see you.
const markerLayer = document.createElement("div");
markerLayer.id = "hunter-marks";
document.body.appendChild(markerLayer);
const markerEls = [];
const _mk = new THREE.Vector3();
function updateHunterMarkers() {
  let n = 0;
  if (!game.cine) {
    for (const m of rig.hunters.men) {
      // A man who has only half-noticed something shows a faint "?" that
      // fills toward "!" — the warning comes before the alarm, not with it.
      if (m.ko > 0 || m.inside || !dragon) continue;
      if (m.state === "calm" && m.awareness < 0.06) continue;
      if (m.pos.distanceTo(dragon.position) > 480) continue;
      _mk.copy(m.pos); _mk.y += 2.6;
      _mk.project(camera);
      if (_mk.z > 1 || Math.abs(_mk.x) > 1 || Math.abs(_mk.y) > 1) continue;
      let el = markerEls[n];
      if (!el) { el = document.createElement("i"); markerLayer.appendChild(el); markerEls.push(el); }
      el.style.display = "";
      el.textContent = m.state === "alert" ? "!" : "?";
      // Going to look, or poking about where it was: a "?" that pulses.
      el.className = m.state === "alert" ? "alert"
        : m.state === "investigate" || m.state === "search" ? "sus hunt" : "sus";
      // The ? fills as he gets closer to certain.
      el.style.setProperty("--a", Math.min(1, m.awareness).toFixed(2));
      el.style.transform = `translate(${(_mk.x * 0.5 + 0.5) * innerWidth}px,${(-_mk.y * 0.5 + 0.5) * innerHeight}px)`;
      if (++n >= 24) break;
    }
  }
  for (let i = n; i < markerEls.length; i++) markerEls[i].style.display = "none";
}
const _hv = new THREE.Vector3();
const _hfrom = new THREE.Vector3();

function updateHunters(dt) {
  huntStagger = Math.max(0, huntStagger - dt);
  if (!rig || !dragon || !controls || grounded || game.cine) return;

  // What the deck can see of him. Light first — that is the resource — and
  // noise on top of it, using the same test the recon beat is scored on so
  // "loud" means one thing everywhere in the game.
  const loud = controls.getClimb() > 0.15 || controls.getSpeedT() > 0.30;
  const seen = rig.hunters ? 0.8 : Math.min(1, rig.litFraction * 1.3 + (loud ? 0.45 : 0));
  if (seen < HUNT_SEEN_MIN) return;

  // Nobody throws at a dragon who is already coming down. Without this the deck
  // chain-locks him: five men, a four-second snare, and every landed throw
  // refreshing it — which is not difficulty, it is the game taking the controls
  // away and not giving them back. Being snared is the punishment; the seconds
  // after it are his.
  if (controls.getSnared() > 0) return;

  // His velocity, so the throw can lead him: ground speed down his heading
  // plus whatever the lift axis is doing. Worked out here rather than asked of
  // controls.js because this is the only caller that wants it as a vector.
  const h = controls.getHeading();
  const sp = controls.getSpeed();
  _hv.set(Math.sin(h) * sp, controls.getVerticalSpeed(), Math.cos(h) * sp);

  for (const g of rig.guards) {
    // A man throws at what HE has seen, not at what the deck in general can.
    if (g.ko > 0 || (g.state !== undefined && g.state !== "alert")) continue;
    g.reload = (g.reload ?? Math.random() * HUNT_RELOAD) - dt;
    if (g.reload > 0 || huntStagger > 0) continue;

    const d = g.pos.distanceTo(dragon.position);
    if (d > HUNT_RANGE || d < HUNT_MIN) continue;

    // Out of the hand, not out of the middle of the man.
    _hfrom.copy(g.pos).setY(g.pos.y + 1.1);

    // How good the throw is. Everything that makes him hard to hit is here in
    // one line, and all three are things he chooses: stay dark, stay far, stay
    // fast. At two hundred metres flat out in the dark they are throwing at a
    // rumour; at sixty metres hovering over a lit deck they will not miss.
    const acc = THREE.MathUtils.clamp(
      seen * (1 - d / HUNT_RANGE) * (1 - controls.getSpeedT() * 0.45) * 1.15,
      0.04, 1);

    if (bolas.fire(_hfrom, dragon.position, _hv, acc)) {
      g.reload = HUNT_RELOAD + Math.random() * HUNT_RELOAD_SPREAD;
      huntStagger = HUNT_STAGGER;
      g.alerted = 2.5;
    } else {
      // No shot — he is outrunning the weight, and bolas.js said so. Wait a
      // beat before asking again rather than re-solving the quadratic for five
      // men on every frame of a pass they cannot make.
      g.reload = 0.4;
    }
  }
}

// What it costs when one lands. Health and the snare are billed separately on
// purpose: the damage is small and the seconds are the punishment.
bolas.onHit(() => {
  if (!dragon || !controls) return;
  health.damage(12, "Bola \u2014 his wings are bound");
  controls.snare();
  pad.rumble.pulse(1.0, 1.0, 0.5);
  game.toast("Snared. Roll out of it.", 1500);
});

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
  get camp() { return camp; },
  setInteract(pos, label = "", range = 150) {
    interactAt = pos; interactLabel = label; interactRange = range;
    interactTaken = false; interactHold = 0;
  },
  tookInteract() { const t = interactTaken; interactTaken = false; return t; },
  // Night is a time on the clock now: late enough to be properly dark, and
  // morning is first light. The sky rolls round to it over a few seconds.
  setNight(on) { world.sky.setTime(on ? 23.2 : 5.7, { transition: 6 }); },
  get sky() { return world.sky; },
  get hunters() { return rig?.hunters ?? null; },
  get rig() { return rig; },
  isGrounded: () => grounded,
  /** Put him somewhere, in the air, facing a bearing. */
  teleport(pos, heading = null) {
    if (!dragon) return;
    if (grounded) takeOff();
    dragon.position.copy(pos);
    if (heading !== null) controls?.setHeading(heading);
  },
  /** In the cage, or out of it. */
  setCaged(on) {
    caged = !!on;
    if (!on && dragon && rig?.prisonAt) dragon.position.set(rig.prisonAt.x, rig.prisonAt.y + 30, rig.prisonAt.z);
    if (on) { bolas.clear(); controls?.clearSnare(); controls?.clearKeys(); }
  },
  cageHits: 0,
  cagesShootable: false,
  npc: null,
  sigrunY: 80,
};

// The key legend is a wall of text and it is in the way of the game. Fold it
// away once, a few seconds in, so a first-time player still sees it.
const keysEl = document.getElementById("hud-keys");
const keysPanel = document.getElementById("hud-keys-panel");
if (keysEl && keysPanel) {
  // Built from the keymap rather than written into index.html, so it cannot
  // disagree with what the keys actually do — and so switching scheme redraws
  // it instead of lying about half the bindings.
  const drawLegend = () => { keysEl.innerHTML = keymap.legendHtml(); };
  drawLegend();
  keymap.onSchemeChange(drawLegend);

  // Up for the first few seconds of a session, then folded to its header; `/`
  // brings it back. A key list that never goes away is a key list nobody
  // reads after the first minute, and it costs a quarter of the screen.
  setTimeout(() => keysPanel.classList.remove("open"), 9000);
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Slash") return;
    keysPanel.classList.toggle("open");
  });
}

// Bloom and grade, same stack as the room, but the threshold has to be a
// different order of magnitude. The composer works in linear HDR *before* tone
// mapping, so a physical sky sits at 5-20, not at 1 — at the room's threshold
// of 0.42 the entire sky passes the test and the whole frame goes milky. Out
// here it has to clear daylight and catch only fire.
const post = setupPost(renderer, scene, camera, {
  // Always built, so the graphics menu can switch it on and off live.
  bloom: { strength: 0.7, radius: 0.6, threshold: 2.4 },
  vignette: 0.55,
  grain: 0.010,
  // Shadows to a sea-blue, highlights barely warm: the old warm lift put
  // a holiday glow on everything, and this is the North Atlantic.
  tint: { cool: 0x14243e, warm: 0x1a1814, mix: 0.4 },
  basePixelRatio: BASE_DPR,
});

// Volumetric clouds, between the scene and the bloom. The noise they are made
// of builds on a worker; until it lands the sky dome's flat deck stands in.
const cloudPass = new CloudPass(camera);
cloudPass.enabled = false;
post.composer.insertPass(cloudPass, 1);
// Sun shafts, after the clouds so a cloud edge can cut them, before the bloom.
const shafts = new ShaderPass(SunShaftShader);
post.composer.insertPass(shafts, 2);
world.sky.setCloudPass(cloudPass);
let cloudsWanted = false;
loadCloudNoise((weather) => {
  world.sky.setWeatherTexture(weather);
  cloudPass.setTextures({ weather });
}).then((tex) => {
  cloudPass.setTextures(tex);
  cloudPass.enabled = cloudsWanted && cloudPass.ready;
  world.sky.setDeckOnly(!cloudPass.enabled);
}).catch((e) => console.warn("clouds: noise failed, flat deck only", e));

// The one dial that runs the whole time. See js/quality.js for why it is this
// dial and not "turn the trees off".
const governor = createGovernor({
  targetFps: 60,
  minScale: QUALITY.minScale,
  maxScale: QUALITY.maxScale,
  onScale: (s) => post.setScale(s),
});
post.setScale(QUALITY.maxScale);
console.info(`quality: tier ${TIER}, preset ${GFX.preset}, dpr cap ${BASE_DPR}, render scale ${QUALITY.maxScale}`);

// ---------------------------------------------------------------------------
// Graphics settings, applied live. Everything the menu can change has a setter
// on the system that owns it, so this is one switch and no reload.
// ---------------------------------------------------------------------------
const fpsEl = document.createElement("div");
fpsEl.id = "fps-meter";
document.body.appendChild(fpsEl);
let fpsCapMs = 0;

function applyGraphics(g, changed = null) {
  const all = !changed;
  const has = (k) => all || changed.includes(k);
  if (has("fpsCap")) {
    fpsCapMs = g.fpsCap ? 1000 / g.fpsCap : 0;
    governor.setTarget(g.fpsCap || 60);
  }
  if (has("maxDpr")) post.setBasePixelRatio(Math.min(window.devicePixelRatio, g.maxDpr || 1));
  if (has("resScale") || has("preset")) {
    if (g.resScale === "auto") {
      const [lo, hi] = graphics.scaleBounds();
      governor.setBounds(lo, hi);
      governor.setEnabled(true);
    } else {
      governor.setEnabled(false, Number(g.resScale));
    }
  }
  if (has("shadows")) world.setShadows(LEVELS.shadows[g.shadows] ?? 0);
  if (has("terrain")) world.setTerrainDetail(g.terrain);
  if (has("trees")) world.setTrees(LEVELS.trees[g.trees] ?? LEVELS.trees.medium);
  if (has("grass")) world.setGrass(g.grass);
  if (has("reflections")) world.setReflectionEvery(LEVELS.reflections[g.reflections] ?? 2);
  if (has("clouds")) {
    const q = CLOUD_QUALITY[g.clouds] ?? null;
    cloudsWanted = !!q;
    if (q) cloudPass.setQuality(q);
    cloudPass.enabled = cloudsWanted && cloudPass.ready;
    world.sky.setDeckOnly(!cloudPass.enabled);
  }
  if (has("bloom")) post.setBloom(g.bloom);
  if (has("photoreal")) {
    world.setPhotoreal(!!g.photoreal);
    post.setPhotoreal?.(!!g.photoreal);
  }
  if (has("showFps")) fpsEl.classList.toggle("on", !!g.showFps);
}
applyGraphics(graphics.state);
graphics.onChange((g, changed) => applyGraphics(g, changed));

let fpsShownAt = 0;
function updateFpsMeter(now) {
  if (!fpsEl.classList.contains("on") || now - fpsShownAt < 500) return;
  fpsShownAt = now;
  const fps = governor.fps;
  fpsEl.textContent = `${Math.round(fps)} fps · ${Math.round(post.scale * 100)}%`;
  fpsEl.dataset.band = fps >= 55 ? "good" : fps >= 28 ? "ok" : "bad";
}

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
setMapObjective(() => game.waypoint ? { x: game.waypoint.x, z: game.waypoint.z, label: game.waypointLabel } : null);
const session = createSession({
  handoff, game, player, storyCtx, setMapSites,
  getDragon: () => dragon, getControls: () => controls,
  sky: world.sky,
});
// For the debug console and for jumping to a beat while building.
window.__na = {
  /** Debug: pin the camera at `from` looking at `look`; null releases it. */
  pinCamera(from, look) {
    camPin = from ? { from: new THREE.Vector3(...from), look: new THREE.Vector3(...look) } : null;
  },
  game, player, storyCtx,
  get session() { return session; },
  get dragon() { return dragon; },
  get groundRig() { return groundRig; },
  get plasma() { return plasma; },
  bolas, horizon,
  get rig() { return rig; },
  get stack() { return stack; },
  get grounded() { return grounded; },
  get speedT() { return controls?.getSpeedT() ?? -1; },
  getControls: () => controls,
  aim, health, world, surfaces,
  get groundBody() { return groundBody; },
  get baseDetail() { return baseDetail; },
  land, takeOff, fireBlast,
  /** Debug: a bone on the *player's* rig. The wild flights are clones and share
   *  every bone name, so a scene-wide search finds the wrong dragon. */
  bone(n) { let f = null; dragon?.traverse((o) => { if (o.isBone && o.name === n) f = o; }); return f; },
  get walkSpeed() { return walkSpeed; },
  /** Debug: the on-foot keys and heading, for scripted walks. */
  walkKeys,
  get walkYaw() { return walkYaw; },
  set walkYaw(v) { walkYaw = v; },
  set walkGear(v) { walkGearDebug = v; },
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
  // The base stands in the pit, which terrain.js lays out exactly — the floor
  // is the centre of the pit, and every waypoint over the compound reads it.
  const pit = pitLayout();
  const floor = pit
    ? { x: pit.x, z: pit.z, deckY: world.getHeightAt(pit.x, pit.z) }
    : findCraterFloor();
  if (floor) {
    SITES.rig.set(floor.x, 0, floor.z);
    RIG.y = floor.deckY;
  }

  // The clearing comes out of terrain.js, which found it by sweeping the
  // height field on Peaceable Country — the same reason findCraterFloor()
  // above sweeps the caldera. Nothing about either place is a guess, so
  // nothing about either place floats.
  if (CLEARING) SITES.camp.set(CLEARING.x, 0, CLEARING.z);

  [rig, stack, camp] = await Promise.all([
    pit
      ? buildHunterBase(scene, {
          seaLevel: world.seaLevel,
          groundAt: (x, z) => world.getHeightAt(x, z),
        })
      : buildRig(scene, SITES.rig, {
          seaLevel: world.seaLevel,
          deckY: floor ? floor.deckY : null,
          groundAt: (x, z) => world.getHeightAt(x, z),
        }),
    buildHollowStack(scene, SITES.stack, {
      ground: Math.max(world.getHeightAt(SITES.stack.x, SITES.stack.z), world.seaLevel + 4),
    }),
    CLEARING
      ? buildSnareCamp(scene, SITES.camp, {
          groundAt: (x, z) => world.getHeightAt(x, z),
          toward: SITES.rig,       // the drag runs the way the hunters went
        })
      : null,
  ]);
  // Roofs, decks, crates, cages, the top of the stack: solid to his feet.
  const solid = surfaces.register(rig?.group) + surfaces.register(stack?.group)
              + surfaces.register(camp?.group, { friction: 0.85 });
  console.info(`surfaces: ${solid} solid meshes`);
  // The pit up close: rough ground, stones, scrub, wood and standing water
  // (basedetail.js). After the buildings are solid, so nothing lands in them.
  if (pit) {
    baseDetail = createBaseDetail(scene, { layout: pit, surfaces, groundTex: world.ready });
    surfaces.register(baseDetail.ground, { friction: 0.8 });
    // The terrain under it is not drawn (terrainmat.js uHole).
    world.groundTiles[0]?.material.userData.uniforms?.uHole.value.copy(baseDetail.hole);
    world.excludeFromReflection(baseDetail.root);
  }
  // NOT added to the reflection skip list, though they look like they should
  // be: both carry a pool of seven point lights, and hiding a light for the
  // mirror pass changes the scene's light count twice a frame, which makes
  // three recompile every shader in the game. See excludeFromReflection() in
  // ocean.js — it will now refuse them out loud if anyone tries again.
  // Arrows hurt, and say so.
  if (rig?.hunters) {
    // Huts, halls, palisades and towers block a man's view as well as the
    // rock does: the same BVH'd meshes his feet stand on, raycast.
    const walls = [];
    rig.group.traverse((o) => { if (o.isMesh && o.geometry?.boundsTree) walls.push(o); });
    const ray = new THREE.Raycaster(), dir = new THREE.Vector3();
    ray.firstHitOnly = true;
    rig.hunters.setOccluder((from, to) => {
      const d = dir.subVectors(to, from).length();
      if (d > 260 || d < 4) return false;
      ray.set(from, dir.divideScalar(d));
      // Not his own tower's rail, and not the dragon's own perch.
      ray.near = 1.4; ray.far = d - 3;
      return ray.intersectObjects(walls, false).length > 0;
    });
    rig.onArrowHit = () => {
      health.damage(7, "Arrow");
      pad.rumble.pulse(0.7, 0.6, 0.18);
    };
  }

  // Which story, from where — or no story at all. See js/session.js.
  session.start();
})();

// ---------------------------------------------------------------------------
// The story's other dragons: Sigrún, the Stormcutter with the broken wing, and
// her hatchling Eyvi. Hidden until chapter V finds them.
// ---------------------------------------------------------------------------
let puffs = null;
async function setupStoryDragons() {
  if (!npcTemplate) return;
  // A real Stormcutter when one is on disk (tools/dragons/); otherwise the
  // re-coloured Night Fury.
  const storm = await loadKit("stormcutter");
  // The flat top of her stack: the highest gentle spot near its middle.
  let best = null;
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    for (let r = 0; r < 110; r += 12) {
      const x = SITES.sigrun.x + Math.cos(a) * r, z = SITES.sigrun.z + Math.sin(a) * r;
      const h = world.getHeightAt(x, z);
      const rough = Math.abs(world.getHeightAt(x + 6, z) - world.getHeightAt(x - 6, z))
                  + Math.abs(world.getHeightAt(x, z + 6) - world.getHeightAt(x, z - 6));
      const score = rough * 6 - h;
      if (h > world.seaLevel + 8 && (!best || score < best.score)) best = { x, z, h, score };
    }
  }
  if (best) { SITES.sigrun.set(best.x, 0, best.z); storyCtx.sigrunY = best.h; }
  const sigrun = createNpcDragon(scene, { template: npcTemplate, scale: 1.45, tint: 0xb4672e, mix: 0.6, tuning, name: "sigrun",
    actor: storm && createActor(storm, { length: 13 }) });
  const eyvi = createNpcDragon(scene, { template: npcTemplate, scale: 0.4, tint: 0xa9c0d4, mix: 0.55, tuning, name: "eyvi",
    actor: storm && createActor(storm, { length: 3.6, tint: 0xd8c8b0, mix: 0.3 }) });
  puffs = createPuffs(scene);
  sigrun.setVisible(false); eyvi.setVisible(false);
  const perchAt = (x, z, lift = 0.4) => new THREE.Vector3(x, world.getHeightAt(x, z) + lift, z);
  let placed = false;
  storyCtx.npc = {
    sigrun, eyvi,
    atStack() {
      placed = true;
      const s = SITES.sigrun;
      sigrun.perch(perchAt(s.x, s.z, 0.6), 0.6);
      sigrun.setDroop(1);
      eyvi.perch(perchAt(s.x + 9, s.z + 6, 0.2), -0.4);
      sigrun.setVisible(true); eyvi.setVisible(true);
    },
    atHollow() {
      placed = true;
      const k = SITES.stack;
      sigrun.perch(perchAt(k.x + 28, k.z + 18, 0.6), 2.4);
      eyvi.perch(perchAt(k.x + 36, k.z + 22, 0.2), 2.0);
      sigrun.setVisible(true); eyvi.setVisible(true);
    },
    /** She flies to a point and hangs there (or lands, if it is a stack). */
    flyIn(pos, onArrive = null) {
      if (!placed) this.atStack();
      sigrun.setVisible(true);
      sigrun.flyTo(pos, 52, onArrive);
    },
    /** The hatchling's sleepfire: a puff from her mouth. */
    puff() {
      const p = eyvi.pos.clone();
      p.y += 0.9;
      p.x += Math.sin(eyvi.state.heading) * 1.2;
      p.z += Math.cos(eyvi.state.heading) * 1.2;
      puffs.puff(p, 1.4);
    },
  };
}

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
  await setupStoryDragons();
  session.placeDragon();
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

let lastFrameAt = 0;
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  // Frame-rate cap. Skipping a whole rAF tick rather than sleeping inside one:
  // 30 on a 60 Hz panel is exactly every other swap, which is the only way a
  // capped frame rate is also an even one. The small tolerance stops a frame
  // that arrives a hair early being dropped and turning 60 into 30.
  if (fpsCapMs && now - lastFrameAt < fpsCapMs - 2.5) return;
  lastFrameAt = now;
  updateFpsMeter(now);
  try {
    frame();
  } catch (e) {
    onFrameError(e);
  }
}

let camPin = null;
function frame() {
  tick++;

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1);          // clamp so tab-outs don't lurch

  // --- Paused ------------------------------------------------------------
  // The clock is READ before this returns, which is the whole trick: getDelta
  // resets on every call, so consuming it here means the frame the menu closes
  // on sees an ordinary 16 ms rather than however many seconds the player
  // spent reading. Skipping the read instead would hand the physics a
  // thirty-second step and put him on the far side of the archipelago.
  //
  // It still renders. A pause that stops drawing is a pause that looks like a
  // crash, and the menu is deliberately translucent so the world is visible
  // behind it — sitting still, which is the point.
  if (paused) {
    // dt 0, so the grade's own time uniform stops with everything else.
    post ? post.render(0) : renderer.render(scene, camera);
    return;
  }
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

  // --- Music that follows the flying ------------------------------------
  // Flat out, or in a manoeuvre, gets the big half of Test Drive; everything
  // else gets the build. The hold is what makes this bearable: without it a
  // two-second burst starts a five-second crossfade, you come off the gas, and
  // the score spends the whole flight fading between two versions of itself.
  //
  // And it only ever swaps between its OWN two tracks. A chapter that has
  // something to say — the raid, or a tension beat — sets its own cue, and this
  // running every frame would take it straight back off again.
  const mine = music.current === null || music.current === "flight" ||
               music.current === "flatout";
  if (controls && !game.cine && mine) {
    const big = controls.isBursting() || controls.getMode() === "dive" ||
                controls.getMode() === "zoom";
    if (big) musicBigHold = MUSIC_BIG_HOLD;
    else musicBigHold = Math.max(0, musicBigHold - dt);
    music.play(musicBigHold > 0 ? "flatout" : "flight", { fade: 3.5 });
  }

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

  if (controls && !grounded && !game.cine && !caged) controls.update(sdt);
  // Caught: held in the cage by the floor of the pit, whatever the keys say.
  if (caged && dragon && rig?.prisonAt) {
    dragon.position.set(rig.prisonAt.x, rig.prisonAt.y + 3.2, rig.prisonAt.z);
  }

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
    // sin(phase) is +1 on the downstroke: the thump is the power stroke.
    const stroke = Math.max(0, Math.sin(beat.phase)) ** 3;
    pad.rumble.sustain(0.05 * beat.amp * stroke, 0.30 * beat.amp * stroke);
  }

  if (updateWings && controls && !grounded) {
    const st = controls.getFlightState();
    updateWings(sdt, st);
    // The body heaves with the beat: up on each downstroke, down on the
    // recovery. Applied as a change from last frame's offset, so it rides on
    // whatever the flight model did with his height and never accumulates.
    const hv = updateWings.getHeave?.() ?? 0;
    dragon.position.y += hv - wingHeave;
    wingHeave = hv;
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
    // What is under him: terrain, or a roof, a deck, the top of the stack.
    const ground = surfaces.at(dragon.position.x, dragon.position.z, dragon.position.y);
    const gh = ground.y;
    const overLand = ground.solid && gh > world.seaLevel + 0.5;

    if (grounded && !game.cine) {
      // He is a body on four sprung legs now (groundbody.js): the flare, the
      // touchdown, the run-out, the slope, the rock under one foot and the
      // edge with nothing under it are all the same physics.
      const turn = (walkKeys.a ? 1 : 0) - (walkKeys.d ? 1 : 0);
      const running = walkKeys.run;
      const along = Math.abs(walkSpeed);
      const gearT = THREE.MathUtils.clamp((along - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
      if (!groundBody.flaring) walkYaw += turn * THREE.MathUtils.lerp(WALK_TURN, RUN_TURN, gearT) * dt;

      const fwd = (walkKeys.w ? 1 : 0) - (walkKeys.s ? 1 : 0);
      // Backwards is always a shuffle. Nothing that size reverses at a run.
      const gear = (fwd < 0 ? WALK_SPEED * 0.55 : (running ? RUN_SPEED : WALK_SPEED)) * walkGearDebug;
      const nx = Math.sin(walkYaw), nz = Math.cos(walkYaw);
      const want = { x: nx * fwd * gear, z: nz * fwd * gear };
      const r = groundBody.step(dt, { want, accel: running ? RUN_ACCEL : WALK_ACCEL, yaw: walkYaw });
      groundBody.apply(dragon);
      settling = groundBody.flaring;
      const v = groundBody.velocity;
      walkSpeed = v.x * nx + v.z * nz;
      slopePitch = groundBody.pitch; slopeRoll = groundBody.roll;

      // Touchdown: a thump scaled by how hard he came in.
      if (r.supported && !wasSupported) {
        pad.rumble.pulse(THREE.MathUtils.clamp(Math.abs(v.y) / 9 + 0.2, 0.25, 1), 1, 0.3);
      }
      wasSupported = r.supported;

      // Off an edge with nothing under him, or onto open water: he opens his
      // wings rather than falling. A short drop off a step is just a step.
      const under = surfaces.at(dragon.position.x, dragon.position.z, dragon.position.y + 1);
      // (Only once he has had his feet down: the drop of the landing itself is
      // not "falling off" anything.)
      if ((!groundBody.flaring && r.airborne > 0.55)
          || (!under.solid && !groundBody.flaring && !r.supported)
          || (!under.solid && dragon.position.y - under.y < 1.2)) {
        takeOff();
      } else if (groundBody.flaring) {
        // Fold on the way DOWN, not once he has stopped.
        groundRig?.applyFold(sdt);
      } else {
        groundRig?.setFold(1);
        const modelScale = dragon.scale.x || 1;
        const feetTop = dragon.position.y + 1.4;
        groundRig?.update(sdt, {
          groundAt: (x, z) => surfaces.heightAt(x, z, feetTop),
          speed: groundBody.speed / modelScale,
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
      // Nowhere to stand on a cliff face. Without this he could land on a
      // sixty-degree rock wall and stand there at sixty degrees to the world.
      const tooSteep = overLand && agl < LAND_AGL &&
        groundAttitude(dragon.position.x, dragon.position.z,
          Math.sin(controls?.getHeading() ?? 0),
          Math.cos(controls?.getHeading() ?? 0)).steep > LAND_SLOPE_MAX;
      const canLand = overLand && agl < LAND_AGL && slow && !busy && !tooSteep;
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
      // The edge of the chart outranks all of it. Out here the honest landing
      // prompt is "No land below — find an island", which is true, useless, and
      // says nothing about why he will not fly straight — so it gets replaced
      // by the one thing the player actually needs told. Escalates rather than
      // repeating: a nudge at the ring, a statement past it.
      const edgeT = controls?.getEdgeT() ?? 0;
      if (edgeT > 0.02) {
        game.setPrompt(edgeT > 0.45
          ? "He will not go further. There is nothing charted out here."
          : "The last of the chart. He is drifting back.", { blocked: true });
      } else if (busy) {
        game.setPrompt(`Hold ${keymap.keyTag("landUse")} — ${interactLabel || "use"}`, { hold: interactHold / 0.9 });
      } else if (canLand) {
        game.setPrompt(`Hold ${keymap.keyTag("landUse")} to land`, { hold: landHold / 0.4 });
      } else if (!overLand) {
        // Only nag about it once he is low enough that he was plainly trying.
        game.setPrompt(agl < 140 ? "No land below — find an island" : null, { blocked: true });
      } else if (!slow) {
        game.setPrompt(`Too fast to land — let go of ${keymap.keyTag("forward")}`, { blocked: true });
      } else if (tooSteep) {
        game.setPrompt("Too steep to stand — find flatter ground", { blocked: true });
      } else if (agl < 260) {
        game.setPrompt(`Too high to land — hold ${keymap.keyTag("down")} to drop`, { blocked: true });
      } else {
        game.setPrompt(null);
      }
    }
  }

  // --- Story ----------------------------------------------------------------
  rig?.update(sdt, camera);
  rig?.setNight?.(world.sky.state?.night ?? 0);
  if (rig?.hunters && dragon && controls) {
    const h = controls.getHeading(), sp = controls.getSpeed();
    // What they would be looking at: his body, not the point between his feet.
    huntTarget.pos.copy(dragon.position);
    if (grounded) {
      huntTarget.pos.y += 1.1;
      huntTarget.vel.copy(groundBody.velocity);
      // On his feet he is a big cat: silent at a walk, padding at a trot, and
      // a gallop is heard a stone's throw off (hunters.js, `noise`).
      const gs = groundBody.speed;
      huntTarget.move = Math.min(1, gs / 8);
      huntTarget.noise = gs > 8 ? 34 : gs > 3 ? 7 : 0;
      huntTarget.loud = false;
    } else {
      huntTarget.vel.set(Math.sin(h) * sp, controls.getVerticalSpeed(), Math.cos(h) * sp);
      // Loud is wingbeats you can hear: a hard climb or a flat-out dive. A Night
      // Fury cruising or gliding is close to silent, and that is half his point.
      huntTarget.loud = controls.getClimb() > 0.3 || controls.getSpeedT() > 0.65;
      huntTarget.move = 1;
      huntTarget.noise = 0;
    }
    huntTarget.grounded = grounded;
    huntTarget.speedT = controls.getSpeedT();
    huntTarget.hidden = !!game.cine;
    // Fog and rain shorten how far anyone can see.
    const sky = world.sky.state;
    const haze = world.sky.weather === "fog" ? 0.45
      : THREE.MathUtils.clamp(1 - (sky?.over ?? 0) * 0.15 - (sky?.rain ?? 0) * 0.35, 0.5, 1);
    const spotted = rig.hunters.update(sdt, huntTarget, sky?.night ?? 0, sky?.hour ?? 12, haze);
    if (spotted.length && !game.cine) {
      if (!alarmToasted) game.toast("Seen.", 1100);
      alarmToasted = true;
      pad.rumble.pulse(0.4, 0.2, 0.15);
    }
    if (rig.hunters.alarm <= 0) alarmToasted = false;
    updateHunterMarkers();
  }
  stack?.update(sdt, camera);
  baseDetail?.update(camera.position);
  updateHunters(sdt);
  // A cutscene takes the camera somewhere he cannot fly, so anything already
  // in the air would hang there in shot. Cut it, and cut the snare with it —
  // the alternative is coming back from the reveal already falling.
  if (game.cine && bolas.liveCount) { bolas.clear(); controls?.clearSnare(); }
  if (game.cine) controls?.clearRoll();
  bolas.update(sdt, dragon && !grounded && !game.cine ? { pos: dragon.position } : null);

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

  // Time of day, weather, clouds, rain — see js/sky.js.
  world.sky.update(sdt, camera);
  storyCtx.npc?.sigrun.update(sdt);
  storyCtx.npc?.eyvi.update(sdt);
  puffs?.update(sdt);

  game.update(dt);
  session.update(dt);
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
      lastFocus.copy(focus);
      camPrevDragon.copy(dragon.position);
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
        const wantPitch = 0.26 - camPath * 0.55;
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
    const rawPath = grounded ? 0 : controls.getPathAngle();
    camPath += (rawPath - camPath) * damp(2.4, dt);
    const path = camPath;
    const h = controls.getHeading();
    // The lead itself is low-passed too, so a change of speed or of climb
    // swings the framing over half a second instead of in one frame.
    camLead.x += (Math.sin(h) * Math.cos(path) * lead - camLead.x) * damp(5, dt);
    camLead.z += (Math.cos(h) * Math.cos(path) * lead - camLead.z) * damp(5, dt);
    camLead.y += (Math.sin(path) * lead - camLead.y) * damp(3, dt);
    const leadX = camLead.x, leadZ = camLead.z, leadY = camLead.y;

    // Where the camera works from this frame: him, led along his path. The
    // wingbeat heave is taken back out, so the beat moves him in the picture
    // rather than moving the whole world.
    camTarget.set(dragon.position.x + leadX,
                  dragon.position.y - wingHeave + leadY + LOOK_HEIGHT,
                  dragon.position.z + leadZ);
    // The camera's place relative to the focus, carried over from last frame
    // (including anything a cutscene, the scope or a pin did to it).
    camRel.copy(camera.position).sub(lastFocus);
    // His velocity, from how far he actually moved. The flight model moves
    // him by speed·dt, so this is exact however uneven the frames are; it is
    // only smoothed against hitches and teleports.
    const jump = dragon.position.distanceTo(camPrevDragon);
    if (jump > Math.max(60, speed * 0.6 + 20)) {
      // A teleport, a respawn, a chapter jump: no velocity, no lag.
      camVel.set(0, 0, 0);
      focusLag.set(0, 0, 0);
    } else if (dt > 1e-4) {
      _lagV.copy(dragon.position).sub(camPrevDragon).divideScalar(dt);
      camVel.lerp(_lagV, damp(8, dt));
    }
    camPrevDragon.copy(dragon.position);
    // The lag: the same trail the old world-space smoothing settled to at a
    // steady speed (v / lambda, capped at FOCUS_MAX_LAG), but computed from
    // velocity and eased, so it only changes when he speeds up or turns.
    focusLag.x += (-camVel.x / trackXZ - focusLag.x) * damp(10, dt);
    focusLag.z += (-camVel.z / trackXZ - focusLag.z) * damp(10, dt);
    focusLag.y += (-camVel.y / trackY - focusLag.y) * damp(6, dt);
    focus.copy(camTarget).add(focusLag);

    // 2. Speed drives boom length and FOV — a function of throttle only, so it
    //    never depends on which way he's pointing.
    const dist = grounded ? 15 : tuning.distBase + DIST_SPEED * speedT;

    const wantFov = fovForAspect(
      tuning.fovBase + FOV_SPEED_GAIN * speedT * speedT, camera.aspect);
    camera.fov += (wantFov - camera.fov) * damp(FOV_LAMBDA, dt);
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
    // Walk the arm; where it first dips under the rock, interpolate between
    // the last clear sample and the first buried one for the exact fraction.
    let clear = 1;
    let prevMargin = Infinity;
    for (let i = 1; i <= OCCLUDE_STEPS; i++) {
      const t = i / OCCLUDE_STEPS;
      const px = focus.x + boomDir.x * dist * t;
      const pz = focus.z + boomDir.z * dist * t;
      const py = focus.y + boomDir.y * dist * t + lift * t;
      const ground = Math.max(world.getHeightAt(px, pz), world.seaLevel) + OCCLUDE_CLEAR;
      const margin = py - ground;
      if (margin < 0) {
        const f = prevMargin === Infinity ? 0 : prevMargin / (prevMargin - margin);
        clear = (i - 1 + f) / OCCLUDE_STEPS;
        break;
      }
      prevMargin = margin;
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
    // Spring the camera toward its place behind him, in his frame: the
    // orbit and boom changes ease, and a hard acceleration still lets him pull
    // away, by a velocity lag rather than by the arm failing to keep up.
    const boomLam = Math.max(BOOM_LAMBDA, speed / BOOM_MAX_LAG);
    _lagV.copy(camVel).multiplyScalar(-1 / boomLam);
    if (_lagV.length() > BOOM_MAX_LAG) _lagV.setLength(BOOM_MAX_LAG);
    desiredCamPos.sub(focus).add(_lagV);           // now relative to the focus
    camRel.lerp(desiredCamPos, damp(BOOM_LAMBDA, sdt));
    camera.position.copy(focus).add(camRel);

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
        // Eased up rather than snapped: the ground under a moving camera
        // changes every frame, and a hard clamp turned every bump in it into
        // a jolt. Only a real burial is corrected outright.
        if (camera.position.y < minY) {
          camera.position.y += (minY - camera.position.y) * damp(18, dt);
          if (camera.position.y < minY - 2.5) camera.position.y = minY - 2.5;
        }
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
    lastFocus.copy(focus);
  }

  // Last thing in the frame: every contributor has had its say, so mix them all
  // down into one effect and send it.
  pad.flush(dt);

  // `cam` in the debug console: a fixed viewpoint for comparing the scene
  // before and after a change. Applied last so nothing above can move it.
  if (camPin) {
    camera.position.copy(camPin.from);
    camera.lookAt(camPin.look);
  }
  updateGrade();
  post.render(dt);
}

// The grade follows the sky: cold and a little muted by day, neutral in the
// golden hour, blue at night. And the sun in the lens, when it is in shot and
// nothing — a ridge, a sea stack — is in front of it.
const _sunP = new THREE.Vector3(), _sunW = new THREE.Vector3();
let sunSeen = 0;
function updateGrade() {
  const sky = world.sky;
  const gu = post.grade.uniforms;
  const g = sky.grade;
  if (g) { gu.uWhite.value.copy(g.white); gu.uSat.value = g.sat; }
  gu.uAspect.value = camera.aspect;
  let vis = 0;
  if (g && g.glare > 0.001) {
    _sunP.copy(camera.position).addScaledVector(sky.sunDir, 5000).project(camera);
    const inFront = camera.getWorldDirection(_sunW).dot(sky.sunDir) > 0;
    if (inFront && Math.abs(_sunP.x) < 1.3 && Math.abs(_sunP.y) < 1.3) {
      // Walk the line to the sun over the terrain: is anything in the way?
      let clear = 1;
      for (let i = 1; i <= 36; i++) {
        const d = i * i * 6;
        _sunW.copy(camera.position).addScaledVector(sky.sunDir, d);
        if (world.getHeightAt(_sunW.x, _sunW.z) > _sunW.y) { clear = 0; break; }
      }
      const edge = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_sunP.x), Math.abs(_sunP.y)), 0.9, 1.3);
      vis = clear * edge;
      gu.uSunUv.value.set(_sunP.x * 0.5 + 0.5, _sunP.y * 0.5 + 0.5);
    }
  }
  // Shafts want the sun near the frame but NOT necessarily clear — rays
  // through a gap are the whole point — so they key on being in shot only.
  {
    _sunP.copy(camera.position).addScaledVector(sky.sunDir, 5000).project(camera);
    const inFront = camera.getWorldDirection(_sunW).dot(sky.sunDir) > 0.2;
    const near = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(_sunP.x), Math.abs(_sunP.y)), 1.0, 1.6);
    const su = shafts.uniforms;
    const want = inFront && post.bloom?.enabled !== false ? near * (g?.glare ?? 0) : 0;
    su.uStrength.value = want * 0.9;
    shafts.enabled = want > 0.01;
    su.uSun.value.set(_sunP.x * 0.5 + 0.5, _sunP.y * 0.5 + 0.5);
    su.uAspect.value = camera.aspect;
    if (g) su.uTint.value.setRGB(g.glareCol.x, g.glareCol.y, g.glareCol.z);
  }
  // Eased, so a sun dipping behind a crag dims rather than blinks.
  sunSeen += (vis - sunSeen) * Math.min(1, 0.016 * 10);
  gu.uSunGlare.value.copy(g ? g.glareCol : _sunW.set(0, 0, 0)).multiplyScalar(sunSeen * (g?.glare ?? 0));
}

// animate() is started by the loading sequence above, once warm.