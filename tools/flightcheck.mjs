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
{ // burst: fire it and sample at its peak
  const dragon = new THREE.Object3D();
  const c = setupDragonControls(dragon, () => 0, null);
  key("KeyW", true);
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  key("KeyB", true); c.update(1 / 60); key("KeyB", false);
  let peak = 0;
  for (let i = 0; i < 120; i++) { c.update(1 / 60); peak = Math.max(peak, c.getSpeed()); }
  key("KeyW", false);
  console.log(`  ${"B (burst)".padEnd(22)} ${peak.toFixed(1).padStart(6)} m/s  ${mph(peak).padStart(4)} mph   <- canon top speed`);
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
  const { climbed, dist } = run(60, 4, ["ControlLeft"]);
  console.log(`  Ctrl for 4 s   -> ${dist.toFixed(0).padStart(4)} m forward, ${climbed.toFixed(2).padStart(6)} m of altitude change`);
}

// 4. Turn radius falls out of the lateral-accel limit.
console.log("\n--- turning circle at each gear ---");
for (const [label, k] of [["hover", ["KeyA"]], ["cruise", ["KeyW", "KeyA"]], ["sprint", ["KeyW", "KeyA", "ShiftLeft"]]]) {
  const { c } = run(60, 6, k);
  const r = Math.abs(c.getYawRate()) > 1e-6 ? c.getSpeed() / Math.abs(c.getYawRate()) : 0;
  console.log(`  ${label.padEnd(22)} ${mph(c.getSpeed()).padStart(4)} mph  yaw ${c.getYawRate().toFixed(3)} rad/s  radius ${r.toFixed(0)} m`);
}
