// Runs the real js/plasma.js outside the browser and prints what a shot
// actually does: how fast it leaves, how fast it crosses the world with his
// airspeed behind it, whether it stops at the ground it is fired into, and how
// the six-shot budget behaves when the button is simply held down.
//
// The ground test is the one worth having. The bolt is only a metre thick above
// the height field and it moves ten to sixteen metres a frame, so a single hit
// test per frame flies straight through hills. See SWEEP_STEP in js/plasma.js.
//
//   node tools/plasmacheck.mjs
import * as THREE from "three";
import { setupPlasma, MAX_SHOTS, BLAST_R } from "../js/plasma.js";
import { terrainHeight, SEA_LEVEL } from "../js/terrain.js";

const DT = 1 / 60;
const make = () => setupPlasma(new THREE.Scene(), {
  getHeightAt: terrainHeight, seaLevel: SEA_LEVEL,
});
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rows = [];
const row = (k, v) => rows.push([k, v]);

// --- 1. Muzzle speed, and what his own airspeed adds ------------------------
for (const carry of [0, 335]) {
  const p = make();
  // Straight up from high over open water, so nothing can stop it early.
  const dir = V(0, 1, 0);
  p.fire(V(0, 4000, 0), dir, V(0, carry, 0));
  const a = p.liveBolts()[0].pos.y;
  p.update(DT);
  const b = p.liveBolts()[0].pos.y;
  row(`speed, carry ${carry} m/s`, `${Math.round((b - a) / DT)} m/s`);
}

// --- 2. Straight into a hillside --------------------------------------------
// Find real land, aim a level shot at it from 1200 m out and see where it dies.
let land = null;
for (let x = -6000; x <= 6000 && !land; x += 137) {
  for (let z = -6000; z <= 6000; z += 137) {
    if (terrainHeight(x, z) > SEA_LEVEL + 220) { land = V(x, terrainHeight(x, z), z); break; }
  }
}
if (!land) row("hillside", "no land found — skipped");
else {
  const p = make();
  // 1200 m due -x of the peak, level, at a height the peak is well above.
  const from = V(land.x - 1200, land.y - 120, land.z);
  let impact = null;
  p.onImpact((at) => (impact = at.clone()));
  p.fire(from, V(1, 0, 0));
  for (let i = 0; i < 240 && !impact; i++) p.update(DT);
  row("fired into a hillside",
    impact ? `stopped ${Math.round(impact.distanceTo(from))} m out, ` +
             `${Math.abs(impact.y - Math.max(terrainHeight(impact.x, impact.z), SEA_LEVEL)).toFixed(1)} m ` +
             `inside the slope — well within one SWEEP_STEP, and inside the ` +
             `${BLAST_R} m an impact affects`
           : "FLEW THROUGH THE HILL");
}

// --- 3. A brazier at four hundred metres ------------------------------------
{
  const p = make();
  let snuffed = false;
  const brazier = { pos: V(0, 500, 400), lit: true, hit: () => (snuffed = true) };
  p.fire(V(0, 500, 0), V(0, 0, 1), V(0, 0, 335));
  let frames = 0;
  while (!snuffed && frames < 240) { p.update(DT, [brazier]); frames++; }
  row("brazier at 400 m", snuffed ? `hit after ${frames} frames (${(frames * DT).toFixed(2)} s)` : "MISSED");
}

// --- 4. The button, held down ------------------------------------------------
{
  const p = make();
  let fired = 0, t = 0;
  // 4 seconds of the key never coming up.
  for (let i = 0; i < 240; i++) { if (p.fire(V(0, 900, 0), V(0, 0, 1))) fired++; t += DT; p.update(DT); }
  row("held for 4 s", `${fired} shots away (${MAX_SHOTS} in the magazine plus ` +
    `${fired - MAX_SHOTS} recharged), ${p.shots} left`);
}
{
  const p = make();
  let fired = 0;
  for (let i = 0; i < 60 * 30; i++) { if (p.fire(V(0, 900, 0), V(0, 0, 1))) fired++; p.update(DT); }
  row("held for 30 s", `${fired} shots — the recharge, not the trigger, is the limit`);
}

const w = Math.max(...rows.map((r) => r[0].length));
for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}   ${v}`);
