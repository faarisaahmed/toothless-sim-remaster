// ASCII probe over the real terrainHeight. The fastest way to see what the
// archipelago actually is — run it after every change to world.js.
//
//   node tools/probe.mjs            whole chart
//   node tools/probe.mjs 2900 3800 1400   zoom on a point, half-width in metres
import { terrainHeight, ISLANDS, TERRAIN_SIZE, SEA_LEVEL, chart, craterR, pitLayout, CLEARING, LEDGES, pitPaths } from "../js/terrain.js";

// The story sites, as chapters.js and main.js have them (chart() is the old
// ten-kilometre chart in today's metres; Hollow Stack's camp is an offset in
// metres from its table centre because the stack did not grow).
const STACK = { x: chart(1700) - 50, z: chart(2550) + 50 };
const SHOAL = { x: chart(2080), z: chart(2320) };
const SIGRUN = { x: chart(2200), z: chart(2000) };
const SPAWN = { x: 0, z: chart(900) };

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
      const t = Math.min(0.999, h / 700);
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
    for (let rr = 40; rr <= Math.min(isl.r, craterR(isl)) * 0.45; rr += 40) {
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
      const x = isle.x + Math.cos(a) * rr * craterR(isle);
      const z = isle.z + Math.sin(a) * rr * craterR(isle);
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
  const deck = terrainHeight(STACK.x, STACK.z);
  check(deck > 80 && deck < 125, `stack deck at SITES.stack (${STACK.x},${STACK.z}) = ${deck.toFixed(1)} m (STACK_Y is 102)`);
  // The shelter, the lab shelf and the fish rack span about 12 m either way and
  // he walks between them, so that patch has to be genuinely flat.
  let lo = 1e9, hi = -1e9;
  for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) {
    const v = terrainHeight(STACK.x + dx, STACK.z + dz); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  check(hi - lo < 5, `camp patch is walkable: ${(hi - lo).toFixed(1)} m of relief across 24 m`);
}
check(terrainHeight(SHOAL.x, SHOAL.z) < SEA_LEVEL - 3, `the shoal (${SHOAL.x},${SHOAL.z}) is water, depth ${(-terrainHeight(SHOAL.x, SHOAL.z)).toFixed(1)} m`);
{
  // Sigrún's stack: main.js looks for a flat top within 40 m of SITES.sigrun,
  // and the LEDGE shelf in terrain.js is cut at 84.5 m.
  let top = -1e9;
  for (let dx = -40; dx <= 40; dx += 4) for (let dz = -40; dz <= 40; dz += 4)
    top = Math.max(top, terrainHeight(SIGRUN.x + dx, SIGRUN.z + dz));
  const L = LEDGES[0];
  const shelf = L ? terrainHeight(L.x, L.z) : -1;
  let lo = 1e9, hi = -1e9;
  if (L) for (let dx = -10; dx <= 10; dx += 2) for (let dz = -10; dz <= 10; dz += 2) {
    if (dx * dx + dz * dz > 100) continue;
    const v = terrainHeight(L.x + dx, L.z + dz); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  check(L && top > 60 && Math.abs(shelf - L.h) < 1.5 && hi - lo < 2.5,
    `Sigrún's stack (${SIGRUN.x},${SIGRUN.z}) top ${top.toFixed(1)} m, ledge at (${L?.x},${L?.z}) ${shelf.toFixed(1)} m, ${(hi - lo).toFixed(1)} m of relief across 20 m`);
}
if (CLEARING) check(CLEARING.h > SEA_LEVEL + 12, `the clearing on ${CLEARING.isle.name} at (${CLEARING.x.toFixed(0)}, ${CLEARING.z.toFixed(0)}) h ${CLEARING.h.toFixed(1)}`);
else check(false, "no clearing found on Peaceable Country");
{
  const L = pitLayout();
  check(L && Math.abs(L.floorR - 115) < 1 && Math.abs(L.topR - 385) < 1 && Math.abs(L.rimR - 540) < 1,
    `pit layout floorR ${L?.floorR.toFixed(0)} topR ${L?.topR.toFixed(0)} rimR ${L?.rimR.toFixed(0)} (want 115/385/540)`);
}

console.log("\n-- the old ways into the pit (terrain.js pitPaths) --");
for (const p of pitPaths()) {
  const n = p.x.length;
  const h0 = terrainHeight(p.x[0], p.z[0]);
  let steep = 0, wet = 0;
  for (let i = 1; i < n; i++) {
    const ds = p.s[i] - p.s[i - 1];
    if (ds > 0.5) steep = Math.max(steep, Math.abs(p.y[i] - p.y[i - 1]) / ds);
    if (terrainHeight(p.x[i], p.z[i]) < SEA_LEVEL + 1) wet++;
  }
  const L = pitLayout();
  const r0 = Math.hypot(p.x[0] - L.x, p.z[0] - L.z);
  check(h0 > SEA_LEVEL + 3 && steep < 0.3 && wet === 0,
    `${p.name.padEnd(16)} starts on land at ${h0.toFixed(0)} m, ${r0.toFixed(0)} m from the pit; ${p.len.toFixed(0)} m long, steepest ${(steep * 100).toFixed(0)}%, ${wet} wet samples`);
}

console.log("\n-- spawn & pacing --");
{
  let dry = 0;
  for (let a = 0; a < 6.283; a += 0.4) if (terrainHeight(SPAWN.x + Math.cos(a) * 400, SPAWN.z + Math.sin(a) * 400) > SEA_LEVEL) dry++;
  check(terrainHeight(SPAWN.x, SPAWN.z) < SEA_LEVEL && dry === 0, `spawn (${SPAWN.x},300,${SPAWN.z}) is over open water (${dry} dry points within 400 m)`);
  const berk = ISLANDS.find((i) => i.name === "Berk");
  let coast = Infinity;
  for (let d = 0; d < 20000 && coast === Infinity; d += 50) if (terrainHeight(SPAWN.x, SPAWN.z - d) > SEA_LEVEL) coast = d;
  console.log(`       Berk's south coast is ${coast} m due north of spawn; Berk's centre ${(SPAWN.z - berk.z).toFixed(0)} m`);
}
{
  const s = ISLANDS.find((i) => i.name === "Hollow Stack");
  const r = ISLANDS.find((i) => i.name === "Dragon Hunter Island");
  const d = Math.hypot(s.x - r.x, s.z - r.z);
  check(d > chart(1400) && d < chart(2100), `Hollow Stack to Dragon Hunter Island ${d.toFixed(0)} m (want ~${chart(1700)})`);
}

console.log("\n-- cost --");
{
  const t0 = process.hrtime.bigint();
  let acc = 0;
  for (let i = 0; i < 200000; i++) acc += terrainHeight(((i * 137) % 5000 - 2500) * chart(1), ((i * 311) % 5000 - 2500) * chart(1));
  const ns = Number(process.hrtime.bigint() - t0) / 200000;
  // Keep in step with TERRAIN_SEGMENTS in world.js.
  const SEGMENTS = 1152;
  const verts = (SEGMENTS + 1) ** 2;
  console.log(`  terrainHeight ${ns.toFixed(0)} ns/call  ->  ${SEGMENTS}^2 mesh build ${(ns * verts / 1e6).toFixed(0)} ms`);
}

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
