// Drive the real game in headless Chrome and report what it actually did.
//
// render_check.py tries to do this by splicing a reporter into a copy of the
// page and waiting for it to POST back. That works until the page stops running
// the reporter — which is exactly what happens when the frame loop throws, so
// the tool goes silent precisely when you most need it, and prints "no report"
// whether the game failed to load or failed after loading.
//
// This drives Chrome from outside instead, over the DevTools protocol, using
// the WebSocket built into Node 22+. Nothing is spliced into the page, the
// console comes back verbatim including uncaught exceptions, and the page can
// be poked with debug-console commands mid-run.
//
//   node tools/inspect.mjs
//   node tools/inspect.mjs --cmd "tp 2200 300 3000" --shot /tmp/f.png
//   node tools/inspect.mjs --url http://localhost:8000/?stage=prologue --watch 20
//
// `--device phone|phone-landscape|tablet|<w>x<h>[@dpr]` emulates a touchscreen:
// real device metrics, `navigator.maxTouchPoints`, and touch event dispatch
// instead of mouse. Without it every mobile bug has to be reproduced by hand
// on a phone, described over a chat window, and fixed blind -- which is how
// you end up shipping a game with no viewport meta tag for a month.
//
//   node tools/inspect.mjs --device phone --shot /tmp/p.png
//   node tools/inspect.mjs --device phone-landscape --drag 120,300,60,0
//
// `--drag x,y,dx,dy` presses at (x, y) in CSS pixels, moves by (dx, dy) over
// several steps, and releases -- as touch when a device is emulated, so it
// goes down the same path a thumb does.
//
// Exits non-zero if anything was logged as an error or an exception.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9335;

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const URL_ = arg("url", "http://localhost:8000/");
const CMD = arg("cmd", "");
const SHOT = arg("shot", "");
const SETTLE = Number(arg("watch", 6)) * 1000;
// What counts as "up". The flight sim publishes window.__na; the title and the
// prologue are separate stages that never do, so they need their own test.
const READY = arg("ready", "!!(window.__na && window.__na.post)");
// Arbitrary JS in the page, evaluated after everything has settled. The escape
// hatch for anything this tool does not model — poking a menu, reading a
// binding, checking that a DOM node says what it should.
const EVAL = arg("eval", "");
const DEVICE = arg("device", "");
const DRAG = arg("drag", "");

// Device metrics. Sizes are CSS pixels, which is what the page sees, and the
// dpr is what a real one of these reports.
const DEVICES = {
  phone:             { width: 390, height: 844, dpr: 3, mobile: true },
  "phone-landscape": { width: 844, height: 390, dpr: 3, mobile: true },
  "phone-small":     { width: 360, height: 640, dpr: 3, mobile: true },
  tablet:            { width: 834, height: 1112, dpr: 2, mobile: true },
};

function deviceSpec(name) {
  if (!name) return null;
  if (DEVICES[name]) return DEVICES[name];
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(name);
  if (!m) throw new Error(`unknown --device ${name}; try ${Object.keys(DEVICES).join(", ")} or 390x844@3`);
  return { width: +m[1], height: +m[2], dpr: +(m[3] || 3), mobile: true };
}
const device = deviceSpec(DEVICE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "na-inspect-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--use-angle=metal", "--enable-gpu",
  // Headless treats its window as occluded and throttles an occluded
  // renderer's timers to about one wake a minute. Without these three the page
  // crawls and every timing you read back is a lie.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--remote-debugging-port=${PORT}`, "--user-data-dir=" + profile,
  "--window-size=960,540", "--hide-scrollbars", URL_,
], { stdio: "ignore" });

let ws, seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++seq;
  pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    return "EVAL ERROR: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
};

/** Type a line into the game's own debug console. */
const runCommand = (line) => evaluate(`(() => {
  const i = document.getElementById("console-input");
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
  i.value = ${JSON.stringify(line)};
  i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true }));
})()`);

const logs = [];
let bad = 0;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith(URL_.split("?")[0]));
    } catch { /* Chrome not up yet */ }
  }
  if (!target) throw new Error("Chrome never produced a page target");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const kind = msg.params.type.toUpperCase();
      if (kind === "ERROR") bad++;
      logs.push(`${kind}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      bad++;
      const d = msg.params.exceptionDetails;
      logs.push("EXCEPTION: " + (d.exception?.description || d.text));
    }
  };

  await send("Runtime.enable");

  // Emulate the device BEFORE the game loads: the renderer sizes itself once
  // on the way up and reads devicePixelRatio while it does it, so overriding
  // the metrics afterwards would test a canvas built for a desktop.
  if (device) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: device.width, height: device.height,
      deviceScaleFactor: device.dpr, mobile: !!device.mobile,
      screenWidth: device.width, screenHeight: device.height,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
    await send("Emulation.setUserAgentOverride", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
        + " (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
    });
    await send("Page.enable");
    await send("Page.reload", { ignoreCache: false });
  }

  // Poll for the game rather than guessing a sleep. A cold headless GPU can
  // take anywhere from fifteen seconds to a minute to get through the load, and
  // a fixed wait is how you end up reporting on a page that never started.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(2000);
    up = (await evaluate(READY)) === true;
  }
  if (!up) throw new Error("the game never finished loading");

  await sleep(SETTLE);
  if (CMD) { for (const c of CMD.split(";")) await runCommand(c.trim()); await sleep(SETTLE); }

  if (DRAG) {
    const [x, y, dx, dy] = DRAG.split(",").map(Number);
    console.log(`\n--- drag --- (${x},${y}) by (${dx},${dy})${device ? " as touch" : " as mouse"}`);
    const STEPS = 8;
    if (device) {
      const pt = (px, py) => [{ x: px, y: py, id: 1 }];
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
      for (let i = 1; i <= STEPS; i++) {
        await send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: pt(x + (dx * i) / STEPS, y + (dy * i) / STEPS),
        });
        await sleep(40);
      }
    } else {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      for (let i = 1; i <= STEPS; i++) {
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved", x: x + (dx * i) / STEPS, y: y + (dy * i) / STEPS, button: "left",
        });
        await sleep(40);
      }
    }
    // Held, not released: the caller wants to see what the game does WHILE a
    // thumb is on the stick, and a stick that has been let go reads as zero.
  }

  if (EVAL) {
    console.log("\n--- eval ---");
    console.log(await evaluate(EVAL));
  }

  const snapshot = await evaluate(`(() => {
    if (!window.__na) return JSON.stringify({ stage: "pre-flight, no renderer stats" }, null, 1);
    const r = window.__na.post.composer.renderer;
    let lights = 0;
    window.__na.post.composer.passes[0].scene.traverse((o) => { if (o.isPointLight && o.visible) lights++; });
    return JSON.stringify({
      programs: r.info.programs?.length,
      pointLights: lights,          // must be CONSTANT — see places.js makeLightPool
      textures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
      contextLost: r.getContext().isContextLost(),
      renderScale: window.__na.post.scale,
      medianFrameMs: +window.__na.governor.frameMs.toFixed(1),
      fatal: document.getElementById("na-fatal")?.textContent?.slice(0, 400) || null,
    }, null, 1);
  })()`);

  if (SHOT) {
    await send("Page.enable");   // idempotent; --device may already have
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot?.data) {
      writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
      console.log(`frame written to ${SHOT}`);
    }
  }

  console.log("\n--- console ---");
  console.log(logs.join("\n") || "(nothing logged)");
  console.log("\n--- snapshot ---");
  console.log(snapshot);
  if (typeof snapshot === "string" && snapshot.includes('"fatal": "')) bad++;
} catch (e) {
  console.log("HARNESS ERROR: " + e.message);
  bad++;
} finally {
  chrome.kill("SIGKILL");
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

process.exit(bad ? 1 : 0);
