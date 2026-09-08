import * as THREE from "three";
import { music, TRACKS, CREDITS } from "./audio.js";

// Master control panel. Backtick opens it, Escape closes. Everything here is a
// dev tool — it mutates live state directly rather than going through gameplay.
const MODES_OK = (a, id) => id === "scoped" || id === "noscope";

// ---------------------------------------------------------------------------
// The key monitor.
//
// There is one class of "the controls don't work" bug that no amount of reading
// the code will find, because it never reaches the code: KEYBOARD GHOSTING.
// Most keyboards — every laptop and every membrane board — wire their keys as a
// grid and can only report a limited number of simultaneous presses. Hold three
// keys that share the wrong rows and columns and the third one is simply never
// sent to the browser. The game sees two keys held and behaves perfectly
// correctly, which is exactly what makes it impossible to debug by feel.
//
// So this shows what the BROWSER says is held, not what the game thinks. If you
// hold three keys and only two light up, the missing one never arrived and no
// change to this project can fix it — the answer is a different key or a
// different device.
// ---------------------------------------------------------------------------
function createKeyMon() {
  const el = document.createElement("div");
  el.id = "keymon";
  el.style.cssText =
    "position:fixed;left:18px;bottom:18px;z-index:200;display:none;padding:10px 13px;" +
    "background:rgba(8,10,16,.86);border:1px solid rgba(232,226,212,.16);border-radius:6px;" +
    "font:11px/1.6 ui-monospace,monospace;color:#e8e2d4;pointer-events:none;min-width:210px";
  document.body.appendChild(el);

  const down = new Set();
  let peak = 0, on = false;

  const draw = () => {
    if (!on) return;
    const list = [...down].map((c) => c.replace(/^Key|^Digit/, "")).join("  ") || "—";
    el.innerHTML =
      `<div style="color:#9a9384;letter-spacing:.18em;font-size:9px">HELD &nbsp;${down.size}` +
      `&nbsp; PEAK ${peak}</div><div style="margin-top:4px;color:#ffcf9a">${list}</div>` +
      `<div style="margin-top:6px;color:#6f6a5f;font-size:9px">if a key you are pressing is` +
      `<br>missing here, the keyboard dropped it</div>`;
  };

  window.addEventListener("keydown", (e) => {
    down.add(e.code);
    if (down.size > peak) peak = down.size;
    draw();
  });
  window.addEventListener("keyup", (e) => { down.delete(e.code); draw(); });
  window.addEventListener("blur", () => { down.clear(); draw(); });

  return {
    toggle() {
      on = !on;
      peak = 0;
      el.style.display = on ? "block" : "none";
      draw();
      return on;
    },
  };
}

export function setupDebugConsole(ctx) {
  const root   = document.getElementById("console");
  const logEl  = document.getElementById("console-log");
  const input  = document.getElementById("console-input");

  let keyMon = null;
  const history = [];
  let historyIndex = -1;
  let open = false;

  function log(msg, kind = "out") {
    const line = document.createElement("div");
    line.className = `console-line ${kind}`;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  const num = (v, fallback = NaN) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const onOff = (b) => (b ? "on" : "off");

  // --- Commands -----------------------------------------------------------
  const commands = {
    help: {
      help: "list every command",
      run() {
        const width = Math.max(...Object.keys(commands).map((k) => k.length));
        for (const [name, cmd] of Object.entries(commands)) {
          log(`${name.padEnd(width + 2)}${cmd.help}`);
        }
      },
    },

    speed: {
      help: "speed <n> — set cruise speed in m/s (default 55, ~123 mph)",
      run(args) {
        const c = ctx.getControls();
        if (!c) return log("dragon not loaded yet", "err");
        const show = (v) => `speed = ${v.toFixed(1)} m/s (${Math.round(v / 0.44704)} mph)`;
        if (!args[0]) return log(show(c.getCruiseSpeed()));
        log(show(c.setCruiseSpeed(num(args[0], 55))));
      },
    },

    keys: {
      help: "keys — live overlay of what the KEYBOARD is actually sending",
      run() {
        keyMon = keyMon || createKeyMon();
        const on = keyMon.toggle();
        log(`key monitor ${onOff(on)}`);
        if (on) {
          log("close this console, then hold the combination that fails.");
          log("every key you are holding should appear. one that does not");
          log("appear was never delivered — that is keyboard ghosting, and");
          log("it is the board, not the game.");
        }
      },
    },

    aim: {
      help: "aim [scoped|noscope] — which aiming mode the aim button uses",
      run(args) {
        const a = ctx.aim;
        if (!a) return log("no aim system on this scene", "err");
        if (args[0]) {
          if (!MODES_OK(a, args[0])) return log(`unknown mode "${args[0]}" — scoped or noscope`, "err");
          a.setMode(args[0]);
        }
        log(`mode      ${a.mode}`);
        log(`aiming    ${onOff(a.active)}${a.scoped ? " (scoped — camera and clock)" : ""}`);
        log(`stamina   ${(a.stamina * 100).toFixed(0)}%`);
        log(`lockout   ${a.lockout > 0 ? a.lockout.toFixed(1) + "s" : "none"}`);
        log(`head      yaw ${(a.yaw * 57.3).toFixed(0)}°  pitch ${(a.pitch * 57.3).toFixed(0)}°`);
      },
    },

    plasma: {
      help: "plasma [fire|refill] — the magazine, and what is in the air",
      run(args) {
        const p = ctx.plasma;
        if (!p) return log("no plasma system on this scene", "err");
        if (args[0] === "fire") {
          // Straight through the game's own fire path, so this tests the muzzle
          // and the aiming rather than a shortcut into plasma.fire().
          if (!ctx.fireBlast) return log("no fire path on this scene", "err");
          ctx.fireBlast(true);
        } else if (args[0] === "refill") {
          p.refill();
        } else if (args[0]) {
          return log(`unknown "${args[0]}" — fire or refill`, "err");
        }
        log(`shots     ${p.shots} / ${p.maxShots}${p.ready ? "" : "  (not ready)"}`);
        log(`recharge  ${(p.rechargeT * 100).toFixed(0)}% toward the next one`);
        // A bolt leaves at 600 plus whatever HE is doing along the same line,
        // so this is the difference between the muzzle speed and what actually
        // crosses the world. Worth printing: a shot that reads as slow is
        // nearly always a shot fired while hovering.
        const air = ctx.grounded ? 0 : (ctx.getControls?.()?.getAirspeed?.() ?? 0);
        log(`his own   ${Math.round(air)} m/s along his nose, added to the muzzle` +
            (ctx.grounded ? " (on the ground — nothing to inherit)" : ""));
        // Where the bolt is born. It leaves the HEAD bone, not the dragon's
        // origin, because he can look off-axis — firing from the origin down a
        // swung head puts the bolt out of his ribs. If this reads as zero the
        // model has not loaded and the fire path is falling back to the origin.
        const head = ctx.aim?.headPosition?.();
        const org = ctx.getDragon?.()?.position;
        if (head && org) {
          const d = head.clone().sub(org);
          // Projected onto his NOSE, because that is the only component that
          // answers the question. A head 2.9 m from his origin is either his
          // mouth or his tail depending on the sign, and a world-space offset
          // alone cannot tell you which.
          const c = ctx.getControls?.();
          const h = c?.getHeading?.() ?? 0, pa = c?.getPathAngle?.() ?? 0;
          const nose = new THREE.Vector3(
            Math.sin(h) * Math.cos(pa), Math.sin(pa), Math.cos(h) * Math.cos(pa));
          const ahead = d.dot(nose);
          log(`muzzle    head bone, ${ahead.toFixed(1)} m ahead of his origin and ` +
              `${d.y.toFixed(1)} m up, then 1.4 m more down the barrel` +
              (ahead < 0.5 ? "  ← THAT IS NOT HIS MOUTH" : ""));
        } else {
          log(`muzzle    no head bone — falling back to his origin + 5.2 m`, "warn");
        }
        const live = p.liveBolts();
        log(`in the air ${live.length}`);
        for (const b of live) {
          log(`  ${Math.round(b.speed)} m/s, ${Math.round(b.travelled)} m out, ` +
              `at ${b.pos.x.toFixed(0)} ${b.pos.y.toFixed(0)} ${b.pos.z.toFixed(0)}`);
        }
      },
    },

    ground: {
      help: "ground [on|off] — put him down where he is, or get him back up",
      run(args) {
        if (!ctx.land || !ctx.takeOff) return log("no ground mode on this scene", "err");
        // Reaching the ground normally means finding land, getting under 22 m
        // AGL and under cruise, then holding the land key. That is the right
        // shape for a player and a bad shape for a script.
        if (args[0] === "off") ctx.takeOff();
        else if (!args[0] || args[0] === "on") ctx.land();
        else return log(`unknown "${args[0]}" — on or off`, "err");
        log(`grounded  ${onOff(ctx.grounded)}`);
      },
    },

    controls: {
      help: "controls [wasd|arrows] — which hand steers and which one acts",
      run(args) {
        const km = ctx.keymap;
        if (!km) return log("no keymap on this scene", "err");
        if (args[0]) {
          if (!km.SCHEMES[args[0]]) return log(`unknown scheme "${args[0]}" — wasd or arrows`, "err");
          km.setScheme(args[0]);
        }
        const sc = km.SCHEMES[km.getScheme()];
        log(`scheme  ${sc.label} — ${sc.hint}`);
        const show = (a) => km.keysFor(a).map(km.label).join(" / ") || "—";
        log(`steer   ${show("forward")} ${show("back")} ${show("turnL")} ${show("turnR")}`);
        log(`height  up ${show("up")}   down ${show("down")}   sprint ${show("sprint")}`);
        log(`act     blast ${show("fire")}   sleepfire ${show("sleepfire")}`);
        log(`        burst ${show("burst")}   land/use ${show("landUse")}`);
        log(`trim    strafe ${show("strafeL")} ${show("strafeR")}   knife ${show("knifeL")} ${show("knifeR")}`);
      },
    },

    quality: {
      help: "quality [scale|auto] — render scale, tier and what the governor is doing",
      run(args) {
        const g = ctx.governor, post = ctx.post;
        if (!g || !post) return log("no governor on this scene", "err");
        if (args[0] === "auto") {
          g.setEnabled(true);
          return log("render scale: auto");
        }
        if (args[0]) {
          const v = Math.min(2, Math.max(0.25, num(args[0], 1)));
          g.setEnabled(false, v);
          post.setScale(v);
          return log(`render scale pinned at ${v.toFixed(2)}`);
        }
        log(`tier          ${ctx.tier ?? "?"}`);
        log(`render scale  ${post.scale.toFixed(2)} (${g.enabled ? "auto" : "pinned"})`);
        log(`frame         ${g.frameMs.toFixed(1)} ms median, ${g.fps.toFixed(0)} fps`);
        log(`display floor ${g.vsyncMs.toFixed(1)} ms — the fastest frame seen`);
        log(`bloom         ${onOff(!!post.bloom)}`);
      },
    },

    stalls: {
      help: "stalls — every frame slower than 90 ms, and where you were",
      run() {
        if (!ctx.getStalls) return log("no stall log on this scene", "err");
        const { log: rows, count, worst, threshold } = ctx.getStalls();
        log(`${count} stalls over ${threshold} ms, worst frame ${worst.toFixed(0)} ms`);
        if (!rows.length) return log("nothing logged — the hitches are elsewhere");
        // Gaps between stalls are the tell. Evenly spaced means something
        // periodic; bunched means something you flew into.
        let prev = null;
        for (const r of rows.slice(-24)) {
          const gap = prev === null ? "" : ` (+${(r.t - prev).toFixed(1)}s)`;
          log(`  ${r.t.toFixed(1)}s  ${String(r.ms).padStart(4)} ms  scale ${r.scale}  progs ${r.progs}  at ${r.where}${gap}`);
          prev = r.t;
        }
      },
    },

    perf: {
      help: "perf — draw calls, triangles, lights and frame time",
      run() {
        const r = ctx.renderer;
        if (!r) return log("no renderer", "err");
        const i = r.info;
        let lights = 0, meshes = 0, points = 0;
        ctx.scene.traverse((o) => {
          if (!o.visible) return;
          if (o.isLight) { lights++; if (o.isPointLight) points++; }
          if (o.isMesh) meshes++;
        });
        log(`draw calls  ${i.render.calls}`);
        log(`triangles   ${i.render.triangles.toLocaleString()}`);
        log(`meshes      ${meshes} visible in the graph`);
        log(`lights      ${lights} (${points} point)`);
        log(`programs    ${i.programs?.length ?? "?"} compiled`);
        log(`textures    ${i.memory.textures}, geometries ${i.memory.geometries}`);
        // Point lights are the number that bites: three.js forward-renders, so
        // each one is a loop iteration in every fragment shader on screen.
        // The count is deliberately CONSTANT — see makeLightPool in places.js.
        // If this number ever changes while you fly, that is the bug: three
        // rebuilds every shader in the game when it does.
        if (points > 16) log(`${points} point lights is a lot — every one costs every pixel`, "err");
      },
    },

    music: {
      help: "music <track|off|vol n|mute> — " + Object.keys(TRACKS).join(", "),
      run(args) {
        const a = (args[0] || "").toLowerCase();
        if (!a) {
          log(`music = ${music.current ?? "off"}, volume ${music.volume.toFixed(2)}` +
              `${music.muted ? " (muted)" : ""}${music.ready ? "" : " — waiting for a click"}`);
          return log(`${CREDITS.artist}, ${CREDITS.licence} — ${CREDITS.url}`, "note");
        }
        if (a === "off" || a === "stop") { music.stop(); return log("music off"); }
        if (a === "mute") return log(`music ${music.toggleMute() ? "muted" : "unmuted"}`);
        if (a === "vol" || a === "volume") {
          return log(`volume = ${music.setVolume(num(args[1], 0.55)).toFixed(2)}`);
        }
        if (!TRACKS[a]) return log(`no track "${a}" — try ${Object.keys(TRACKS).join(", ")}`, "err");
        music.play(a, { fade: 1.2 });
        log(`music = ${a}`);
      },
    },

    turn: {
      help: "turn <n> — max turn rate in rad/s (default 1.45, lower is gentler)",
      run(args) {
        const c = ctx.getControls();
        if (!c) return log("dragon not loaded yet", "err");
        if (!args[0]) return log(`turn = ${c.getTurnRate()}`);
        log(`turn = ${c.setTurnRate(num(args[0], 1.45))} rad/s`);
      },
    },

    ai: {
      help: "toggle the wild dragon flights",
      run() {
        const f = ctx.getFlights();
        if (!f) return log("flights not spawned yet", "err");
        const v = f.setVisible(!f.isVisible());
        const c = f.count();
        log(`flights ${onOff(v)} — ${c.flights} groups, ${c.adults} adults, ${c.babies} hatchlings`);
      },
    },

    grid: {
      help: "toggle the terrain contour grid",
      run() { log(`grid ${onOff(ctx.world.toggleGrid())}`); },
    },

    wire: {
      help: "toggle terrain wireframe",
      run() { log(`wireframe ${onOff(ctx.world.toggleWireframe())}`); },
    },

    clouds: {
      help: "toggle clouds",
      run() { log(`clouds ${onOff(ctx.world.toggleClouds())}`); },
    },

    hud: {
      help: "toggle the controls panel",
      run() {
        const el = document.getElementById("hud");
        el.style.display = el.style.display === "none" ? "" : "none";
        log(`hud ${onOff(el.style.display !== "none")}`);
      },
    },

    shadows: {
      help: "toggle shadow rendering",
      run() {
        ctx.renderer.shadowMap.enabled = !ctx.renderer.shadowMap.enabled;
        ctx.scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });
        log(`shadows ${onOff(ctx.renderer.shadowMap.enabled)}`);
      },
    },

    exposure: {
      help: "exposure <n> — tone mapping exposure (default 0.95)",
      run(args) {
        if (!args[0]) return log(`exposure = ${ctx.renderer.toneMappingExposure}`);
        ctx.renderer.toneMappingExposure = num(args[0], 0.95);
        log(`exposure = ${ctx.renderer.toneMappingExposure}`);
      },
    },

    fog: {
      help: "fog <density> — 0 clears it (default 0.00016)",
      run(args) {
        if (!args[0]) return log(`fog = ${ctx.scene.fog ? ctx.scene.fog.density : 0}`);
        if (ctx.scene.fog) ctx.scene.fog.density = num(args[0], 0.00016);
        log(`fog = ${ctx.scene.fog ? ctx.scene.fog.density : 0}`);
      },
    },

    sun: {
      help: "sun <elevation> [azimuth] — degrees",
      run(args) {
        if (!args[0]) return log("usage: sun <elevation> [azimuth]", "err");
        ctx.world.setSun(num(args[0], 34), args[1] ? num(args[1], 150) : undefined);
        log(`sun elevation ${args[0]}°${args[1] ? `, azimuth ${args[1]}°` : ""}`);
      },
    },

    light: {
      help: "light <n> — directional sun intensity (default 3.8)",
      run(args) {
        if (!args[0]) return log(`light = ${ctx.world.sun.intensity}`);
        ctx.world.sun.intensity = num(args[0], 3.8);
        log(`light = ${ctx.world.sun.intensity}`);
      },
    },

    pad: {
      help: "gamepad status — press a button first, browsers hide it until then",
      run() {
        const p = ctx.pad;
        if (!p) return log("no gamepad module", "err");

        // Report what the BROWSER sees before what we've claimed — they're
        // different failures with different fixes.
        const seen = p.survey();
        if (!seen.length) {
          log("the browser reports no gamepads at all.", "err");
          log("this is upstream of the game — it isn't something the page controls.");
          log("  1. press any button on the pad; browsers hide pads until you do,");
          log("     and that resets on every page reload");
          log("  2. click the page once so the tab has focus");
          log("  3. check the pad is still paired (DualSense sleeps when idle —");
          log("     hold PS to wake it, or plug in a USB cable)");
          return;
        }

        for (const g of seen) {
          log(`slot ${g.index}  ${g.id}`);
          log(`         mapping ${g.mapping}, ${g.buttons} buttons, ${g.axes} axes, ` +
              `haptics ${g.haptics ? "yes" : "no"}${g.connected ? "" : ", DISCONNECTED"}`);
          if (g.mapping !== "standard") {
            log("         non-standard mapping — button numbers will be wrong", "err");
          }
        }

        if (!p.connected()) {
          return log("seen, but not claimed — press a button on it", "note");
        }
        log(`claimed slot ${p.slot()}`);
        log(`id       ${p.id()}`);
        log(`reading  ${p.source() === "hid" ? "WebHID input reports" : "Gamepad API"}`);
        log(`sticks   L ${p.lx.toFixed(2)}, ${p.ly.toFixed(2)}   R ${p.rx.toFixed(2)}, ${p.ry.toFixed(2)}`);
        log(`triggers L2 ${p.value(6).toFixed(2)}   R2 ${p.value(7).toFixed(2)}`);
        log(`rumble   ${onOff(p.rumble.isEnabled())} at ${p.rumble.getIntensity().toFixed(2)}`);

        const ds = ctx.dualsense;
        if (ds?.isReady()) {
          log(`haptics  WebHID direct — ${ds.name()} over ${ds.transport()}`, "note");
          log(`         ${ds.reportsIn()} input reports in`);
          log(`         ${ds.reportSize()}-byte reports, ${ds.writeCount()} sent` +
              (ds.failures() ? `, ${ds.failures()} failing` : "") +
              (ds.candidates() > 1 ? `, ${ds.candidates()} entries offered` : ""));
        } else {
          log(`haptics  Gamepad API (trigger rumble ` +
              `${p.rumble.hasTriggerRumble() ? "supported" : "not advertised"}, ` +
              `${onOff(p.rumble.triggersOn())})`);
          if (ds?.isAvailable()) log("         run 'hid' for a direct link and adaptive triggers");
          if (ds && ds.status() === "error") log(`         hid error: ${ds.error()}`, "err");
        }
      },
    },

    padsrc: {
      help: "padsrc auto|hid|gamepad — which path the sticks are read from",
      run(args) {
        const p = ctx.pad;
        if (!p) return log("no gamepad module", "err");
        if (args[0]) p.setSource(args[0]);
        log(`input preference ${p.preference()}, currently reading ` +
            `${p.source() || "nothing"}`);
        if (!args[0]) log("  auto prefers the direct HID link when it's live");
      },
    },

    rumble: {
      help: "rumble <0-1> | off | on | test | triggers on|off",
      run(args) {
        const p = ctx.pad;
        if (!p) return log("no gamepad module", "err");

        if (!args[0]) {
          return log(`rumble ${onOff(p.rumble.isEnabled())} at ${p.rumble.getIntensity().toFixed(2)}`);
        }

        if (args[0] === "test") {
          const linked = ctx.dualsense?.isReady();
          if (!p.connected() && !linked) {
            return log("no gamepad — press a button on it first", "err");
          }
          log(linked
            ? "walking the pad through each channel one at a time…"
            : "full power, both motors, 900ms…");
          p.rumble.test((stage) => log(`  → ${stage}`)).then((r) => {
            log(`effects advertised: ${r.effects ?? "?"}`);
            if (r.ok) {
              log(r.result, "note");
              if (linked) {
                log("felt every stage? both coils and both triggers are live.");
                log("felt the coils but not the triggers, or vice versa? say so —");
                log("they're different bytes in the same report and fail apart.");
              } else {
                log("if you felt nothing, the browser accepted it and the pad ignored it —");
                log("on macOS that usually means Bluetooth. Run 'hid' for a direct link.");
              }
            } else {
              log(`failed: ${r.why}`, "err");
            }
          });
          return;
        }

        if (args[0] === "triggers") {
          const v = p.rumble.setTriggerRumble(args[1] !== "off");
          return log(`trigger rumble ${onOff(v)} (${p.rumble.hasTriggerRumble() ? "supported" : "not advertised"})`);
        }

        if (args[0] === "off" || args[0] === "on") {
          const v = p.rumble.setEnabled(args[0] === "on");
          return log(`rumble ${onOff(v)}`);
        }

        const v = p.rumble.setIntensity(num(args[0], 1));
        p.rumble.setEnabled(v > 0);
        p.rumble.pulse(0.6, 0.6, 0.4); // let them feel what they just set
        log(`rumble = ${v.toFixed(2)}`);
      },
    },

    hid: {
      help: "hid [off] — connect a DualSense directly for real haptics",
      run(args) {
        const ds = ctx.dualsense;
        if (!ds) return log("no WebHID module", "err");

        if (!ds.isAvailable()) {
          log("this browser has no WebHID.", "err");
          log("Chrome or Edge have it; Safari and Firefox don't.");
          return;
        }

        if (args[0] === "off") {
          ds.close().then(() => log("hid closed — back to Gamepad API rumble"));
          return;
        }

        if (ds.isReady()) {
          return log(`already connected — ${ds.name()} over ${ds.transport()}`);
        }

        log("opening the browser's device picker — choose your DualSense…");
        ds.request().then((ok) => {
          if (ok) {
            log(`connected: ${ds.name()} over ${ds.transport()}`, "note");
            log("try 'rumble test' now.");
          } else {
            log(`no connection: ${ds.error() || "cancelled"}`, "err");
          }
        });
      },
    },

    padmon: {
      help: "live overlay of every input the game sees — leave it on while you fly",
      run() {
        if (!ctx.togglePadMon) return log("no monitor available", "err");
        log(`input monitor ${onOff(ctx.togglePadMon())}`);
      },
    },

    padclimb: {
      help: "flip the left stick climb axis (default: pull back to climb)",
      run() {
        const c = ctx.getControls();
        if (!c) return log("dragon not loaded yet", "err");
        const v = c.setClimbInvert(!c.getClimbInvert());
        log(v ? "pull back to climb" : "push forward to climb");
      },
    },

    padsens: {
      help: "padsens <n> — right stick look speed (default 1), 'invert' flips Y",
      run(args) {
        if (args[0] === "invert") {
          ctx.tuning.padInvertY = !ctx.tuning.padInvertY;
          return log(`pad look Y ${ctx.tuning.padInvertY ? "inverted" : "normal"}`);
        }
        if (!args[0]) return log(`padsens = ${ctx.tuning.padLookSpeed}`);
        ctx.tuning.padLookSpeed = num(args[0], 1);
        log(`padsens = ${ctx.tuning.padLookSpeed}`);
      },
    },

    sens: {
      help: "sens <n> — look sensitivity (default 0.003, try 0.0015 on trackpad)",
      run(args) {
        if (!args[0]) return log(`sens = ${ctx.tuning.lookSensitivity}`);
        ctx.tuning.lookSensitivity = num(args[0], 0.003);
        log(`sens = ${ctx.tuning.lookSensitivity}`);
      },
    },

    fov: {
      help: "fov <n> — base field of view (default 70)",
      run(args) {
        if (!args[0]) return log(`fov = ${ctx.tuning.fovBase}`);
        ctx.tuning.fovBase = num(args[0], 70);
        log(`fov = ${ctx.tuning.fovBase}`);
      },
    },

    boom: {
      help: "boom <n> — camera distance (default 14)",
      run(args) {
        if (!args[0]) return log(`boom = ${ctx.tuning.distBase}`);
        ctx.tuning.distBase = num(args[0], 14);
        log(`boom = ${ctx.tuning.distBase}`);
      },
    },

    flap: {
      help: "flap <amplitude> [rate] — wing beat scale (default 1 1)",
      run(args) {
        if (args[0]) ctx.tuning.flapAmplitude = num(args[0], 1);
        if (args[1]) ctx.tuning.flapSpeed = num(args[1], 1);
        log(`flap amplitude ${ctx.tuning.flapAmplitude}, rate ${ctx.tuning.flapSpeed}`);
      },
    },

    tuck: {
      help: "tuck <n> — wing fold amount; negative flips the fold direction",
      run(args) {
        if (!args[0]) {
          return log(`tuck = ${ctx.tuning.sweepAmount * ctx.tuning.tuckSign}`);
        }
        const v = num(args[0], 1);
        ctx.tuning.sweepAmount = Math.abs(v);
        ctx.tuning.tuckSign = v < 0 ? -1 : 1;
        log(`tuck = ${v}`);
      },
    },

    water: {
      help: "toggle the ocean",
      run() { log(`water ${onOff(ctx.world.toggleWater())}`); },
    },

    islands: {
      help: "list the named islands",
      run() {
        ctx.world.islands.forEach((isl, i) => {
          if (isl.name) log(`${String(i).padStart(2)}  ${isl.name.padEnd(14)}${isl.x}, ${isl.z}`);
        });
        log("use 'go <n>' to fly there");
      },
    },

    go: {
      help: "go <n> — teleport above island n",
      run(args) {
        const d = ctx.getDragon();
        if (!d) return log("dragon not loaded yet", "err");
        const isl = ctx.world.islands[parseInt(args[0], 10)];
        if (!isl) return log("no such island — try 'islands'", "err");
        d.position.set(isl.x, isl.h + 260, isl.z + isl.r * 1.4);
        log(`flew to ${isl.name ?? "sea stack"}`);
      },
    },

    scale: {
      help: "scale <n> — dragon size (default 2)",
      run(args) {
        const d = ctx.getDragon();
        if (!d) return log("dragon not loaded yet", "err");
        if (!args[0]) return log(`scale = ${d.scale.x}`);
        d.scale.setScalar(num(args[0], 2));
        log(`scale = ${d.scale.x}`);
      },
    },

    tp: {
      help: "tp <x> <y> <z> — teleport",
      run(args) {
        const d = ctx.getDragon();
        if (!d) return log("dragon not loaded yet", "err");
        if (args.length < 3) return log("usage: tp <x> <y> <z>", "err");
        d.position.set(num(args[0], 0), num(args[1], 200), num(args[2], 0));
        log(`teleported to ${d.position.x}, ${d.position.y}, ${d.position.z}`);
      },
    },

    pos: {
      help: "print position, altitude and heading",
      run() {
        const d = ctx.getDragon();
        const c = ctx.getControls();
        if (!d) return log("dragon not loaded yet", "err");
        const ground = ctx.world.getHeightAt(d.position.x, d.position.z);
        log(`xyz  ${d.position.x.toFixed(1)}, ${d.position.y.toFixed(1)}, ${d.position.z.toFixed(1)}`);
        log(`agl  ${(d.position.y - ground).toFixed(1)} above ground`);
        if (c) log(`hdg  ${THREE.MathUtils.radToDeg(c.getHeading()).toFixed(0)}°`);
      },
    },

    ghost: {
      help: "toggle terrain collision for the dragon",
      run() {
        ctx.tuning.collide = !ctx.tuning.collide;
        log(`collision ${onOff(ctx.tuning.collide)}`);
      },
    },

    reset: {
      help: "back to spawn with default tuning",
      run() {
        const d = ctx.getDragon();
        const c = ctx.getControls();
        if (d) d.position.copy(ctx.spawn);
        if (c) c.setCruiseSpeed(0.35);
        ctx.tuning.fovBase = 70;
        ctx.tuning.distBase = 14;
        ctx.tuning.collide = true;
        ctx.tuning.lookSensitivity = 0.003;
        ctx.tuning.padLookSpeed = 1;
        ctx.tuning.padInvertY = false;
        ctx.pad?.rumble.setIntensity(1);
        log("reset");
      },
    },

    clear: {
      help: "clear this log",
      run() { logEl.innerHTML = ""; },
    },
  };

  // --- Wiring -------------------------------------------------------------
  function run(raw) {
    const line = raw.trim();
    if (!line) return;

    log(`> ${line}`, "echo");
    history.push(line);
    historyIndex = history.length;

    const [name, ...args] = line.split(/\s+/);
    const cmd = commands[name.toLowerCase()];
    if (!cmd) return log(`unknown command: ${name} — try 'help'`, "err");

    try {
      cmd.run(args);
    } catch (err) {
      log(String(err), "err");
    }
  }

  function setOpen(v) {
    open = v;
    root.classList.toggle("open", open);
    if (open) {
      ctx.getControls()?.clearKeys(); // drop any keys held when it opened
      document.exitPointerLock();
      input.focus();
    } else {
      input.blur();
    }
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // never let gameplay see console typing

    if (e.key === "Enter") {
      run(input.value);
      input.value = "";
    } else if (e.key === "Escape" || e.key === "`") {
      // stopPropagation above means the window handler never sees this one.
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex > 0) input.value = history[--historyIndex] ?? "";
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < history.length - 1) input.value = history[++historyIndex] ?? "";
      else { historyIndex = history.length; input.value = ""; }
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote") {
      e.preventDefault();
      setOpen(!open);
    }
  });

  log("Debug console — type 'help' for commands.", "note");

  return { isOpen: () => open, toggle: () => setOpen(!open), log, run };
}
