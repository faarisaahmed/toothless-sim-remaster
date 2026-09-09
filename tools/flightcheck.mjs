// Runs the real js/controls.js outside the browser and prints the speed
// ladder, the turning circle and the climb rate, so "canonically accurate" is
// a thing you can check rather than a thing the comments claim.
//
//   mkdir -p node_modules/three
//   echo '{"name":"three","version":"0.160.0","type":"module","main":"index.js"}' > node_modules/three/package.json
//   curl -sL -o node_modules/three/index.js https://unpkg.com/three@0.160.0/build/three.module.js
//   node tools/flightcheck.mjs

import * as THREE from "three";
import { setupDragonControls, CANON_TOP_SPEED } from "../js/controls.js";
import { keysFor, label } from "../js/keymap.js";

// Minimal DOM so the module's window listeners bind to something.
const listeners = {};
globalThis.window = { addEventListener: (t, f) => (listeners[t] ??= []).push(f) };
globalThis.document = { activeElement: null };
globalThis.performance ??= { now: () => Date.now() };

const key = (code, down) =>
  listeners[down ? "keydown" : "keyup"].forEach((f) =>
    f({ code, preventDefault() {} }));

// He spawns already flying, so every measurement gets a warm-up with the keys
// already held. Without it the first seconds are the spin-down from the spawn
// speed and every number is a transient rather than the steady state.
function run(fps, seconds, keysDown = [], warmup = 6) {
  const dragon = new THREE.Object3D();
  const c = setupDragonControls(dragon, () => 0, null);
  const dt = 1 / fps;
  for (const k of keysDown) key(k, true);
  for (let i = 0; i < fps * warmup; i++) c.update(dt);
  const from = dragon.position.clone();
  for (let i = 0; i < fps * seconds; i++) c.update(dt);
  for (const k of keysDown) key(k, false);
  return {
    c, dragon,
    climbed: dragon.position.y - from.y,
    dist: Math.hypot(dragon.position.x - from.x, dragon.position.z - from.z),
  };
}

const mph = (v) => (v / 0.44704).toFixed(0);
console.log(`CANON_TOP_SPEED = ${CANON_TOP_SPEED.toFixed(1)} m/s = ${mph(CANON_TOP_SPEED)} mph\n`);

// 1. Frame-rate independence: same 4 s of flight at three refresh rates.
console.log("--- 4 s of cruise (W held), distance travelled ---");
for (const fps of [30, 60, 144]) {
  const { dist, c } = run(fps, 4, ["KeyW"]);
  console.log(`  ${String(fps).padStart(3)} fps -> ${dist.toFixed(1)} m   (${mph(c.getSpeed())} mph)`);
}

// 2. The speed ladder.
console.log("\n--- the gears ---");
const gears = [
  ["nothing held (hover)", []],
  ["S held (back off)",    ["KeyS"]],
  ["W held (cruise)",      ["KeyW"]],
  ["W + Shift (sprint)",   ["KeyW", "ShiftLeft"]],
];
for (const [label, k] of gears) {
  const { c } = run(60, 6, k);
  console.log(`  ${label.padEnd(22)} ${c.getSpeed().toFixed(1).padStart(6)} m/s  ${mph(c.getSpeed()).padStart(4)} mph`);
}
{ // Burst, HELD. It used to be a tap that fired a charge; it is a gear now,
  // and this check went on tapping it for one frame long after that changed —
  // which reported the canon top speed as 177 mph and nobody noticed.
  const dragon = new THREE.Object3D();
  const c = setupDragonControls(dragon, () => 0, null);
  key("KeyW", true);
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  key("KeyB", true);
  let peak = 0;
  for (let i = 0; i < 240; i++) { c.update(1 / 60); peak = Math.max(peak, c.getSpeed()); }
  key("KeyB", false); key("KeyW", false);
  const ok = Math.abs(peak - CANON_TOP_SPEED) < 1 ? "" : "   <- OFF CANON";
  console.log(`  ${"W + B held (flat out)".padEnd(22)} ${peak.toFixed(1).padStart(6)} m/s  ${mph(peak).padStart(4)} mph   <- canon top speed${ok}`);
}

// 3. The two things the standard scheme has to guarantee: forward does not
//    change your altitude, and up does not move you along the ground.
console.log("\n--- the axes stay separate ---");
{
  const { climbed, dist } = run(60, 4, ["KeyW"]);
  console.log(`  W for 4 s      -> ${dist.toFixed(0).padStart(4)} m forward, ${climbed.toFixed(2).padStart(6)} m of altitude change`);
}
{
  const { climbed, dist } = run(60, 4, ["Space"]);
  console.log(`  Space for 4 s  -> ${dist.toFixed(0).padStart(4)} m forward, ${climbed.toFixed(2).padStart(6)} m of altitude change   <- the hover`);
}
{
  const { climbed, dist } = run(60, 4, ["KeyW", "Space"]);
  console.log(`  W + Space      -> ${dist.toFixed(0).padStart(4)} m forward, ${climbed.toFixed(2).padStart(6)} m of altitude change`);
}
{
  // Whatever "down" is bound to in the current scheme, rather than Ctrl —
  // which this used to press, and which has not been bound to anything since
  // macOS Mission Control was found to be eating Ctrl+Down.
  const code = keysFor("down")[0];
  const { climbed, dist } = run(60, 4, [code]);
  console.log(`  ${(label(code) + " for 4 s").padEnd(14)} -> ${dist.toFixed(0).padStart(4)} m forward, ${climbed.toFixed(2).padStart(6)} m of altitude change`);
}

// 4. Turn radius falls out of the lateral-accel limit.
console.log("\n--- turning circle at each gear ---");
for (const [label, k] of [["hover", ["KeyA"]], ["cruise", ["KeyW", "KeyA"]], ["sprint", ["KeyW", "KeyA", "ShiftLeft"]]]) {
  const { c } = run(60, 6, k);
  const r = Math.abs(c.getYawRate()) > 1e-6 ? c.getSpeed() / Math.abs(c.getYawRate()) : 0;
  console.log(`  ${label.padEnd(22)} ${mph(c.getSpeed()).padStart(4)} mph  yaw ${c.getYawRate().toFixed(3)} rad/s  radius ${r.toFixed(0)} m`);
}

// 5. The zoom climb, the stall and the dive.
//
// One energy account: height is bought with speed on the way up and sold for it
// on the way down. What this prints is the exchange rate, which is the whole
// feel of the manoeuvre — a zoom that bought no height, or a dive that earned
// no speed, would both be numbers here rather than something you had to fly to
// find out.
console.log("\n--- zoom, stall, dive ---");
{
  const dragon = new THREE.Object3D();
  const c = setupDragonControls(dragon, () => 0, null);
  const up = keysFor("up")[0], down = keysFor("down")[0];
  const step = (n) => { for (let i = 0; i < n; i++) c.update(1 / 60); };

  // Up to speed first: the zoom does not exist below CLIMB_ENTRY_SPEED, which
  // is what stops it from firing on a hovering dragon holding the lift key.
  key("KeyW", true); key("ShiftLeft", true);
  step(300);
  const entrySpeed = c.getSpeed(), entryY = dragon.position.y;
  console.log(`  entered at            ${mph(entrySpeed).padStart(4)} mph, mode ${c.getMode()}`);

  // Straight up until the wings let go.
  key(up, true);
  let stalledAt = null, peakY = entryY, sawZoom = false, noseAtDive = null;
  for (let i = 0; i < 60 * 12; i++) {
    c.update(1 / 60);
    if (c.getMode() === "zoom") sawZoom = true;
    if (c.didStall()) stalledAt = { y: dragon.position.y, t: i / 60 };
    // Sampled at the moment the nose finishes falling, not at the end of the
    // loop — holding the climb key just re-zooms once he has speed again, so
    // reading it afterwards reports the next climb rather than the stall.
    if (noseAtDive === null && stalledAt && c.getMode() === "dive") {
      noseAtDive = c.getPathAngle();
    }
    peakY = Math.max(peakY, dragon.position.y);
    if (stalledAt && i / 60 > stalledAt.t + 6) break;
  }
  key(up, false);
  console.log(`  zoom engaged          ${sawZoom ? "yes" : "NO — up stayed a lift"}`);
  console.log(`  stalled after         ${stalledAt ? stalledAt.t.toFixed(1) + " s, " +
    Math.round(stalledAt.y - entryY) + " m of height bought" : "NEVER"}`);
  console.log(`  nose fell through to  ${noseAtDive === null ? "NEVER DIVED"
    : (noseAtDive * 57.3).toFixed(0) + "°, and held there for " +
      "1.1 s he cannot pull out of"}`);

  // Now the dive out of it: pull up and see what the height was worth.
  const beforeDive = c.getSpeed();
  key(down, true);
  let peakSpeed = 0;
  for (let i = 0; i < 60 * 6; i++) { c.update(1 / 60); peakSpeed = Math.max(peakSpeed, c.getSpeed()); }
  key(down, false);
  console.log(`  dive reached          ${mph(peakSpeed).padStart(4)} mph (from ${mph(beforeDive)} mph)`);

  // And that it is KEPT through the pull-up rather than bled off.
  key(up, true); step(90); key(up, false);
  step(60);
  console.log(`  after the pull-up     ${mph(c.getSpeed()).padStart(4)} mph, mode ${c.getMode()}`);
  console.log(`  net over the whole    ${Math.round(dragon.position.y - entryY)} m of altitude, ` +
    `${mph(c.getSpeed() - entrySpeed)} mph of speed`);
  key("KeyW", false); key("ShiftLeft", false);
}

// 6. The trim, and a zoom entered flat out.
//
// The trim is the answer to "I just want to lose a little height": above the
// entry speed the axis used to be all or nothing, so dropping twenty metres
// meant committing to a dive and pulling out of it.
console.log("\n--- trim vs commit ---");
{
  const up = keysFor("up")[0], down = keysFor("down")[0];
  const runFor = (keys, secs, extra = []) => {
    const dragon = new THREE.Object3D();
    const c = setupDragonControls(dragon, () => 0, null);
    for (const k of [...extra]) key(k, true);
    for (let i = 0; i < 300; i++) c.update(1 / 60);   // up to speed
    const y0 = dragon.position.y, s0 = c.getSpeed();
    for (const k of keys) key(k, true);
    for (let i = 0; i < 60 * secs; i++) c.update(1 / 60);
    for (const k of keys) key(k, false);
    const r = { dy: dragon.position.y - y0, mode: c.getMode(), mph: mph(c.getSpeed()),
                from: mph(s0) };
    for (const k of extra) key(k, false);
    return r;
  };
  // A tap: shorter than MANOEUVRE_HOLD, so it must stay level and just trim.
  const tap = runFor([up], 0.3, ["KeyW", "ShiftLeft"]);
  console.log(`  tap up 0.3 s      ${tap.dy >= 0 ? "+" : ""}${tap.dy.toFixed(1)} m, mode ${tap.mode}` +
    (tap.mode === "level" ? "   <- a trim, as it should be" : "   <- SHOULD NOT HAVE COMMITTED"));
  const tapDown = runFor([down], 0.3, ["KeyW", "ShiftLeft"]);
  console.log(`  tap down 0.3 s    ${tapDown.dy.toFixed(1)} m, mode ${tapDown.mode}`);
  // Held: past the threshold, so it commits.
  const held = runFor([up], 1.2, ["KeyW", "ShiftLeft"]);
  console.log(`  hold up 1.2 s     +${held.dy.toFixed(0)} m, mode ${held.mode}` +
    (held.mode === "zoom" ? "   <- committed" : "   <- DID NOT COMMIT"));
}
{
  // Flat out into a zoom. This is the case that did not read as costing
  // anything: at a flat 30 m/s^2 it took eleven seconds to bleed 335 m/s off.
  const dragon = new THREE.Object3D();
  const c = setupDragonControls(dragon, () => 0, null);
  const up = keysFor("up")[0];
  key("KeyW", true); key("KeyB", true);
  for (let i = 0; i < 300; i++) c.update(1 / 60);
  const s0 = c.getSpeed(), y0 = dragon.position.y;
  key(up, true);
  let t = 0, stall = null;
  for (let i = 0; i < 60 * 20; i++) {
    c.update(1 / 60); t += 1 / 60;
    if (c.didStall()) { stall = t; break; }
  }
  key(up, false); key("KeyW", false); key("KeyB", false);
  console.log(`  flat out zoom     from ${mph(s0)} mph -> stalled after ` +
    `${stall ? stall.toFixed(1) + " s, " + Math.round(dragon.position.y - y0) + " m up" : "NEVER"}`);
}
