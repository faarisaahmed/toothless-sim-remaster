// ASCII probe over the real terrainHeight. The fastest way to see what the
// archipelago actually is — run it after every change to world.js.
//
//   node tools/probe.mjs            whole chart
//   node tools/probe.mjs 2900 3800 1400   zoom on a point, half-width in metres
import { terrainHeight, ISLANDS, TERRAIN_SIZE, SEA_LEVEL } from "../js/terrain.js";

const [cx = 0, cz = 0, half = TERRAIN_SIZE / 2] = process.argv.slice(2).map(Number);

const W = 150, H = 66;
// Sea, then land by altitude.
const LAND = " .:-=+*#%@";
let out = "";
let minH = 1e9, maxH = -1e9, landCells = 0;

for (let r = 0; r < H; r++) {
  let line = "";
  for (let c = 0; c < W; c++) {
    const x = cx - half + (c / (W - 1)) * half * 2;
    const z = cz - half + (r / (H - 1)) * half * 2;
    const h = terrainHeight(x, z);
    minH = Math.min(minH, h); maxH = Math.max(maxH, h);
    if (h <= SEA_LEVEL) {
      line += h > -25 ? "░" : (h > -120 ? "~" : " ");
    } else {
      landCells++;
      const t = Math.min(0.999, h / 420);
      line += LAND[Math.floor(t * LAND.length)];
    }
  }
  out += line + "\n";
}
console.log(out);
console.log(`extent ${(half*2/1000).toFixed(1)} km  centre (${cx}, ${cz})`);
console.log(`height ${minH.toFixed(0)} .. ${maxH.toFixed(0)} m   land ${(100*landCells/(W*H)).toFixed(1)}% of view`);

// --- Hard constraints from ARCHIPELAGO_HANDOFF.md -------------------------
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "  ok " : "FAIL "} ${msg}`); if (!ok) fail++; };

console.log("\n-- landable sites --");
for (const name of ["Berk", "Hollow Stack", "Dragon Hunter Island"]) {
  const isl = ISLANDS.find((i) => i.name === name);
  if (!isl) { check(false, `${name} missing from ISLANDS`); continue; }
  // Landing needs terrain above SEA_LEVEL + 3 somewhere you would actually put
  // down, so probe the nominal centre and a small ring around it.
  let best = terrainHeight(isl.x, isl.z), bx = isl.x, bz = isl.z;
  for (let a = 0; a < 6.283; a += 0.3) {
    for (let rr = 40; rr <= isl.r * 0.45; rr += 40) {
      const x = isl.x + Math.cos(a) * rr, z = isl.z + Math.sin(a) * rr;
      const h = terrainHeight(x, z);
      if (h > best) { best = h; bx = x; bz = z; }
    }
  }
  check(best > SEA_LEVEL + 3,
    `${name.padEnd(21)} best ${best.toFixed(1)} m at (${bx.toFixed(0)}, ${bz.toFixed(0)})`);
}

console.log("\n-- crater floor sweep (mirrors findCraterFloor in main.js) --");
{
  const isle = ISLANDS.find((i) => i.name === "Dragon Hunter Island");
  let best = null;
  for (let a = 0; a < Math.PI * 2; a += 0.14) {
    for (let rr = 0; rr < 0.32; rr += 0.025) {
      const x = isle.x + Math.cos(a) * rr * isle.r;
      const z = isle.z + Math.sin(a) * rr * isle.r;
      const h = terrainHeight(x, z);
      if (h < SEA_LEVEL + 14) continue;
      let rough = 0;
      for (const [dx, dz] of [[62,0],[-62,0],[0,62],[0,-62],[44,44],[-44,-44]]) {
        rough += Math.abs(terrainHeight(x + dx, z + dz) - h);
      }
      if (!best || rough < best.rough) best = { x, z, h, rough };
    }
  }
  if (!best) { check(false, "no crater floor - the compound would float and M1 is unplayable"); }
  else {
    let top = best.h;
    for (let ix = -58; ix <= 58; ix += 8)
      for (let iz = -46; iz <= 46; iz += 8)
        top = Math.max(top, terrainHeight(best.x + ix, best.z + iz));
    check(best.rough < 30,
      `floor (${best.x.toFixed(0)}, ${best.z.toFixed(0)}) h=${best.h.toFixed(1)} ` +
      `rough=${best.rough.toFixed(1)} deckY=${(top + 1.1).toFixed(1)}`);
  }
}

console.log("\n-- the three story sites main.js/chapters.js actually read --");
// buildHollowStack takes its deck straight off this sample, and chapters.js
// puts the waypoint at STACK_Y = 102. They have to agree to within a few metres.
{
  const deck = terrainHeight(1650, 2600);
  check(deck > 80 && deck < 125, `stack deck at SITES.stack (1650,2600) = ${deck.toFixed(1)} m (STACK_Y is 102)`);
  // The shelter, the lab shelf and the fish rack span about 12 m either way and
  // he walks between them, so that patch has to be genuinely flat.
  let lo = 1e9, hi = -1e9;
  for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) {
    const v = terrainHeight(1650 + dx, 2600 + dz); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  check(hi - lo < 5, `camp patch is walkable: ${(hi - lo).toFixed(1)} m of relief across 24 m`);
}
check(terrainHeight(2080, 2320) < SEA_LEVEL - 3, `the shoal (2080,2320) is water, depth ${(-terrainHeight(2080,2320)).toFixed(1)} m`);

console.log("\n-- spawn & pacing --");
check(terrainHeight(0, 900) < SEA_LEVEL, `spawn (0,300,900) is over open water`);
{
  const s = ISLANDS.find((i) => i.name === "Hollow Stack");
  const r = ISLANDS.find((i) => i.name === "Dragon Hunter Island");
  const d = Math.hypot(s.x - r.x, s.z - r.z);
  check(d > 1400 && d < 2100, `Hollow Stack to Dragon Hunter Island ${d.toFixed(0)} m (want ~1700)`);
}

console.log("\n-- cost --");
{
  const t0 = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < 200000; i++) acc += terrainHeight((i * 137) % 5000 - 2500, (i * 311) % 5000 - 2500);
  const ns = Number(process.hrtime.bigint() - t0) / 200000;
  // Keep in step with TERRAIN_SEGMENTS in world.js.
  const SEGMENTS = 768;
  const verts = (SEGMENTS + 1) ** 2;
  console.log(`  terrainHeight ${ns.toFixed(0)} ns/call  ->  ${SEGMENTS}^2 mesh build ${(ns * verts / 1e6).toFixed(0)} ms`);
}

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
