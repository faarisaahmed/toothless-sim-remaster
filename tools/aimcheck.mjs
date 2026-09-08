// Does his head aim the plasma blast, and does it aim it the way the mouse asks?
//
// Both questions need the real rig, so this drives the real game — it hands a
// probe to tools/inspect.mjs, which runs it inside the page over the DevTools
// protocol. Nothing here is a model of the aiming; it reads the skull's own
// world matrix and the direction the shot actually leaves on.
//
// It exists because both of these were wrong at once and neither showed up in
// the code:
//
//   DIRECTION   yaw subtracted the mouse delta where the camera added it, so
//               pushing the mouse right swung his head left. Every consumer
//               downstream agreed with it, so the system was self-consistently
//               inverted and only a player could tell.
//
//   OFFSET      the shot went along his FLIGHT PATH and his nose points along
//               his BODY, and those differ by his angle of attack — 6.7° in a
//               hover, 0.4° at cruise, 6.0° flat out. A miss that changes with
//               the throttle is a miss you cannot learn to lead.
//
//   node tools/aimcheck.mjs
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- Probe one: where does the shot go, and where is his nose? -------------
const OFFSET = `(async () => {
  const { aim, dragon, getControls } = window.__na;
  const c = getControls();
  let head = null;
  dragon.traverse((o) => { if (o.isBone && o.name === "Head") head = o; });
  if (!head || !c) return "no head bone or no controls";
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const settle = async (n) => { for (let i = 0; i < n; i++) await frame(); };
  const key = (t, code) => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true }));
  const nose = () => { const e = head.matrixWorld.elements;
    const l = Math.hypot(e[4], e[5], e[6]); return [e[4]/l, e[5]/l, e[6]/l]; };
  const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1,
    u[0]*v[0] + u[1]*v[1] + u[2]*v[2]))) * 180 / Math.PI;
  const shot = () => { const d = aim.direction(c.getHeading(), c.getPathAngle());
    return [d.x, d.y, d.z]; };

  const out = [];
  // Three throttle settings, because the old bug was invisible at exactly one
  // of them: at cruise the angle of attack is nearly zero and the shot looked
  // perfect.
  for (const [name, keys] of [["hover", []], ["cruise", ["KeyW"]],
                              ["flat out", ["KeyW", "KeyJ"]]]) {
    for (const k of keys) key("keydown", k);
    await settle(180);
    const base = nose();
    let off = 0, wander = 0;
    for (let i = 0; i < 120; i++) {
      await frame();
      const n = nose();
      off += ang(n, shot());
      wander = Math.max(wander, ang(n, base));
    }
    out.push("  " + name.padEnd(9) + Math.round(c.getAirspeed()).toString().padStart(4) +
      " m/s   nose " + (off / 120).toFixed(1).padStart(4) + "\\u00b0 off the shot line" +
      "   breathing " + wander.toFixed(2) + "\\u00b0");
    for (const k of keys) key("keyup", k);
    await settle(60);
  }
  return "WHERE THE SHOT GOES (0\\u00b0 means it leaves along his nose)\\n" + out.join("\\n");
})()`;

// --- Probe two: which way does the head turn? ------------------------------
const DIRECTION = `(async () => {
  const { aim, getControls } = window.__na;
  const c = getControls();
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const settle = async (n) => { for (let i = 0; i < n; i++) await frame(); };
  const shot = () => { const d = aim.direction(c.getHeading(), c.getPathAngle());
    return [d.x, d.y, d.z]; };

  aim.setMode("noscope"); aim.setHeld(true);
  await settle(4);
  if (!aim.active) return "aim never went active";
  const out = [];
  // main.js does pendingYaw -= movementX, so a mouse pushed RIGHT reaches
  // aim.look() as a NEGATIVE dx. These are the deltas as look() sees them.
  const cases = [["mouse RIGHT", -0.35, 0, "RIGHT"], ["mouse LEFT", 0.35, 0, "LEFT"],
                 ["mouse DOWN", 0, -0.35, "DOWN"],   ["mouse UP", 0, 0.35, "UP"]];
  let bad = 0;
  for (const [what, dx, dy, want] of cases) {
    for (let i = 0; i < 400 && Math.abs(aim.yaw) + Math.abs(aim.pitch) > 0.002; i++)
      aim.look(-aim.yaw * 0.5, aim.pitch * 0.5);
    await settle(3);
    const a = shot();
    aim.look(dx, dy);
    await settle(3);
    const b = shot();
    // Increasing heading turns him toward +x, which is his LEFT, so a positive
    // cross about world up means he looked left.
    const cross = a[2] * b[0] - a[0] * b[2];
    const dP = Math.asin(b[1]) - Math.asin(a[1]);
    const got = Math.abs(dx) > Math.abs(dy) ? (cross > 0 ? "LEFT" : "RIGHT")
                                            : (dP > 0 ? "UP" : "DOWN");
    if (got !== want) bad++;
    out.push("  " + (got === want ? "ok   " : "WRONG") + " " + what.padEnd(12) +
             "head goes " + got);
  }
  aim.setHeld(false);
  return "WHICH WAY THE HEAD TURNS\\n" + out.join("\\n") +
         (bad ? "\\n  " + bad + " inverted" : "");
})()`;

function once(probe) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(HERE, "inspect.mjs"), "--watch", "26",
                                       "--eval", probe],
                    { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", () => res(out));
  });
}

// A cold Chrome sometimes does not get the world built inside the wait, and
// that comes back as "never finished loading" rather than as an answer. It is a
// slow machine, not a broken game, so give it a second go before believing it.
async function run(probe) {
  for (let i = 0; i < 2; i++) {
    const out = await once(probe);
    if (!/HARNESS ERROR/.test(out)) return out;
  }
  return await once(probe);
}

let fail = 0;
for (const probe of [DIRECTION, OFFSET]) {
  const out = await run(probe);
  // inspect.mjs prints its own snapshot and console; we only want the probe's
  // return value, which is everything from its heading onwards.
  const i = out.search(/^(WHICH WAY|WHERE THE SHOT|EVAL ERROR|HARNESS ERROR|no head)/m);
  const body = i >= 0 ? out.slice(i).split("\n--- ")[0].trimEnd() : out.trimEnd();
  console.log("\n" + body);
  if (/WRONG|inverted|ERROR|no head|never went/.test(body)) fail++;
}
process.exitCode = fail ? 1 : 0;
