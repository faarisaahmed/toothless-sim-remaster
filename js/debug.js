import * as THREE from "three";

// Master control panel. Backtick opens it, Escape closes. Everything here is a
// dev tool — it mutates live state directly rather than going through gameplay.
export function setupDebugConsole(ctx) {
  const root   = document.getElementById("console");
  const logEl  = document.getElementById("console-log");
  const input  = document.getElementById("console-input");

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
      help: "speed <n> — set cruise speed (default 0.35)",
      run(args) {
        const c = ctx.getControls();
        if (!c) return log("dragon not loaded yet", "err");
        if (!args[0]) return log(`speed = ${c.getCruiseSpeed().toFixed(3)}`);
        log(`speed = ${c.setCruiseSpeed(num(args[0], 0.35)).toFixed(3)}`);
      },
    },

    turn: {
      help: "turn <n> — max turn rate (default 0.017, lower is gentler)",
      run(args) {
        const c = ctx.getControls();
        if (!c) return log("dragon not loaded yet", "err");
        if (!args[0]) return log(`turn = ${c.getTurnRate()}`);
        log(`turn = ${c.setTurnRate(num(args[0], 0.017))}`);
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
        if (!p.connected()) {
          return log("no gamepad seen yet — press any button on it", "note");
        }
        log(`id       ${p.id()}`);
        log(`sticks   L ${p.lx.toFixed(2)}, ${p.ly.toFixed(2)}   R ${p.rx.toFixed(2)}, ${p.ry.toFixed(2)}`);
        log(`triggers L2 ${p.value(6).toFixed(2)}   R2 ${p.value(7).toFixed(2)}`);
        log(`rumble   ${onOff(p.rumble.isEnabled())} at ${p.rumble.getIntensity().toFixed(2)}`);
        log(`triggers rumble ${p.rumble.hasTriggerRumble() ? "supported" : "unavailable"}`);
      },
    },

    rumble: {
      help: "rumble <0-1> — haptics strength, or 'off' / 'on'",
      run(args) {
        const p = ctx.pad;
        if (!p) return log("no gamepad module", "err");
        if (!args[0]) {
          return log(`rumble ${onOff(p.rumble.isEnabled())} at ${p.rumble.getIntensity().toFixed(2)}`);
        }
        if (args[0] === "off" || args[0] === "on") {
          const v = p.rumble.setEnabled(args[0] === "on");
          return log(`rumble ${onOff(v)}`);
        }
        const v = p.rumble.setIntensity(num(args[0], 1));
        p.rumble.setEnabled(v > 0);
        p.rumble.pulse(0.5, 0.5, 0.35); // let them feel what they just set
        log(`rumble = ${v.toFixed(2)}`);
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
