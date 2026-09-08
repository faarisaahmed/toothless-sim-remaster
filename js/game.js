import * as THREE from "three";

// ---------------------------------------------------------------------------
// The story state machine.
//
// A chapter is a small object with an objective, somewhere to be, and a test
// for whether it's finished. The runner shows one at a time, points at it, and
// moves on. That's the whole thing — the complexity in this game lives in the
// places, not in the plot graph, and a linear list of chapters is honest about
// that rather than pretending there's branching there isn't.
//
// Nothing here knows what a dragon is. Chapters get a context object and poke
// at that, so the same runner drives a flight, a landing, and a night in a lab.
// ---------------------------------------------------------------------------

const CSS = `
.na-hud { position:fixed; inset:0; pointer-events:none; z-index:40;
          font-family:Rajdhani,system-ui,sans-serif; color:#e8e2d4;
          transition:opacity .4s; }

.na-obj { position:absolute; top:22px; left:50%; transform:translateX(-50%);
          text-align:center; opacity:0; transition:opacity .5s; max-width:min(620px,72vw); }
.na-obj.on { opacity:1; }
.na-obj .eyebrow { font-size:.62rem; letter-spacing:.34em; text-transform:uppercase;
                   color:#9a9384; margin-bottom:5px; }
.na-obj .line { font-family:Cinzel,serif; font-size:1.18rem; letter-spacing:.02em;
                text-shadow:0 2px 14px rgba(0,0,0,.85); }
.na-obj .sub  { font-size:.82rem; color:#b9b1a0; margin-top:4px; letter-spacing:.04em; }
.na-obj .way  { font-size:.68rem; color:#ffcf9a; margin-top:6px; letter-spacing:.16em;
                text-transform:uppercase; }
.na-obj.done .line { color:#ff8a3d; }

.na-mark { position:absolute; width:0; height:0; }
.na-mark i { position:absolute; left:-13px; top:-13px; width:26px; height:26px;
             border:1.5px solid rgba(255,138,61,.85); border-radius:50%;
             box-shadow:0 0 14px rgba(255,138,61,.45), inset 0 0 8px rgba(255,138,61,.25); }
.na-mark b { position:absolute; left:50%; top:20px; transform:translateX(-50%);
             font-size:.68rem; letter-spacing:.16em; color:#ffcf9a; font-weight:600;
             white-space:nowrap; text-shadow:0 1px 6px #000; }

.na-state { position:absolute; right:24px; bottom:24px; display:flex; gap:18px;
            align-items:flex-end; opacity:0; transition:opacity .5s; }
.na-state.on { opacity:1; }
.na-state .cell { display:flex; flex-direction:column; gap:5px; }
.na-state .cap { font-size:.58rem; letter-spacing:.24em; text-transform:uppercase; color:#8d8677; }
.na-state .val { font-size:.86rem; letter-spacing:.1em; font-weight:600; }
.na-pips { display:flex; gap:4px; }
.na-pips s { width:16px; height:4px; background:rgba(232,226,212,.18); display:block; }
.na-pips s.on { background:#e8e2d4; }

.na-fire { position:absolute; left:50%; bottom:70px; transform:translateX(-50%);
           width:120px; height:3px; background:rgba(232,226,212,.14); opacity:0;
           transition:opacity .2s; }
.na-fire.on { opacity:1; }
.na-fire i { display:block; height:100%; width:0%; background:#ff8a3d;
             box-shadow:0 0 12px rgba(255,138,61,.8); }

.na-prompt { position:absolute; left:50%; bottom:104px; transform:translateX(-50%);
             min-width:250px; padding:9px 18px 10px; border-radius:7px;
             background:rgba(10,13,20,.72); border:1px solid rgba(232,226,212,.14);
             backdrop-filter:blur(3px); text-align:center;
             font-size:.86rem; letter-spacing:.12em; text-transform:uppercase; color:#e8e2d4;
             opacity:0; transition:opacity .25s; text-shadow:0 1px 8px #000; }
.na-prompt.on { opacity:1; }
.na-prompt b { color:#ff8a3d; font-weight:700; }
/* A blocked prompt is telling you why, not telling you to act. Different
   colour, so you learn the difference without reading it every time. */
.na-prompt.blocked { border-color:rgba(217,122,99,.34); color:#e6bdb0; }
.na-prompt.blocked b { color:#d97a63; }
.na-prompt .hold { display:block; height:3px; margin:8px -18px -10px;
                   background:rgba(232,226,212,.12); }
.na-prompt .hold i { display:block; height:100%; width:0%; background:#ff8a3d;
                     box-shadow:0 0 10px rgba(255,138,61,.9); transition:width .06s linear; }

.na-toast { position:absolute; left:50%; top:58%; transform:translate(-50%,-50%);
            font-family:Cinzel,serif; font-size:1.15rem; letter-spacing:.06em;
            text-shadow:0 2px 20px #000; opacity:0; transition:opacity .35s; text-align:center; }
.na-toast.on { opacity:1; }

.na-bars { position:fixed; left:0; right:0; height:0; background:#05060a; z-index:55;
            pointer-events:none; transition:height .5s ease; }
.na-bars.top { top:0; } .na-bars.bot { bottom:0; }
.na-bars.on { height:11vh; }

.na-cine { position:fixed; left:0; right:0; bottom:14vh; text-align:center; z-index:56;
           pointer-events:none; font-family:Cinzel,serif; font-size:1.25rem;
           letter-spacing:.05em; color:#e8e2d4; text-shadow:0 2px 18px #000;
           opacity:0; transition:opacity .5s; }
.na-cine.on { opacity:1; }

.na-skip { position:fixed; right:34px; bottom:15vh; z-index:57; pointer-events:none;
           font-size:.66rem; letter-spacing:.2em; text-transform:uppercase;
           color:rgba(232,226,212,.66); opacity:0; transition:opacity .4s; }
.na-skip.on { opacity:1; }
.na-skip s { display:block; height:2px; margin-top:5px; background:rgba(232,226,212,.16); }
.na-skip s i { display:block; height:100%; width:0%; background:#e8e2d4; }

.na-fade { position:fixed; inset:0; background:#05060a; opacity:0; z-index:60;
           pointer-events:none; transition:opacity .55s; }
.na-fade.on { opacity:1; }
`;

function el(cls, html = "") {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  return d;
}

export function setupGame(ctx) {
  // ctx: { scene, camera, world, player, getPosition(), getHeading(), pad }
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const hud = el("na-hud");
  const objEl = el("na-obj", `<div class="eyebrow"></div><div class="line"></div><div class="sub"></div><div class="way"></div>`);
  const markEl = el("na-mark", `<i></i><b></b>`);
  const stateEl = el("na-state");
  const fireEl = el("na-fire", `<i></i>`);
  const promptEl = el("na-prompt", `<span class="txt"></span><span class="hold"><i></i></span>`);
  const toastEl = el("na-toast");
  const fadeEl = el("na-fade");
  const barTop = el("na-bars top");
  const barBot = el("na-bars bot");
  const cineEl = el("na-cine");
  const skipEl = el("na-skip", `Hold Space to skip<s><i></i></s>`);
  const skipBar = skipEl.querySelector("s i");
  markEl.style.display = "none";
  hud.append(objEl, markEl, stateEl, fireEl, promptEl, toastEl);
  document.body.append(hud, fadeEl, barTop, barBot, cineEl, skipEl);

  const objEyebrow = objEl.querySelector(".eyebrow");
  const objLine = objEl.querySelector(".line");
  const objSub = objEl.querySelector(".sub");
  const objWay = objEl.querySelector(".way");
  const promptTxt = promptEl.querySelector(".txt");
  const promptBar = promptEl.querySelector(".hold i");
  const markLabel = markEl.querySelector("b");
  const fireBar = fireEl.querySelector("i");

  stateEl.innerHTML = `
    <div class="cell"><span class="cap">Day</span><span class="val" data-day>1</span></div>
    <div class="cell"><span class="cap">Fed</span><span class="na-pips" data-food><s></s><s></s></span></div>
    <div class="cell"><span class="cap">Rested</span><span class="na-pips" data-rest><s></s></span></div>`;
  const dayEl = stateEl.querySelector("[data-day]");
  const foodPips = [...stateEl.querySelectorAll("[data-food] s")];
  const restPips = [...stateEl.querySelectorAll("[data-rest] s")];

  let chapters = [];
  let index = -1;
  let current = null;
  let sinceEnter = 0;
  let waypoint = null;      // THREE.Vector3 | null
  let waypointLabel = "";
  let holdDone = 0;

  const v = new THREE.Vector3();

  function refreshState() {
    const p = ctx.player.state;
    dayEl.textContent = p.day;
    const fed = p.food === "fed" ? 2 : p.food === "thin" ? 1 : 0;
    foodPips.forEach((s, i) => s.classList.toggle("on", i < fed));
    restPips.forEach((s) => s.classList.toggle("on", p.rested));
  }

  function toast(text, ms = 2600) {
    toastEl.innerHTML = text;
    toastEl.classList.add("on");
    setTimeout(() => toastEl.classList.remove("on"), ms);
  }

  function fade(on) {
    fadeEl.classList.toggle("on", on);
    return new Promise((r) => setTimeout(r, 580));
  }

  function setObjective(line, sub = "", eyebrow = "Objective") {
    objEyebrow.textContent = eyebrow;
    objLine.innerHTML = line;
    objSub.innerHTML = sub;
    objSub.style.display = sub ? "" : "none";
    objEl.classList.remove("done");
    objEl.classList.add("on");
  }

  /** Metres under a kilometre, kilometres over it. 2913m is harder to read at
   *  a glance than 2.9km, and at 750 mph the last digit is never true anyway. */
  function fmtDist(d) {
    return d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;
  }

  function setWaypoint(pos, label = "") {
    waypoint = pos ? v.clone().copy(pos) : null;
    waypointLabel = label;
    markEl.style.display = pos ? "" : "none";
  }

  /**
   * The one contextual line — land, take off, hold R. Null to clear.
   *
   * `blocked` means "here is why you cannot do the thing", which is a different
   * message from "here is the thing to do" and now looks different too. That
   * distinction is most of what makes landing legible: the old prompt could say
   * "Slow down to land" or nothing at all, so being too high over water and
   * being lined up perfectly looked identical.
   *
   * `hold` is 0..1 of a hold in progress, drawn as a bar under the text, so a
   * key you must keep down shows you it is working.
   */
  function setPrompt(text, { blocked = false, hold = 0 } = {}) {
    if (text && text !== promptTxt.innerHTML) promptTxt.innerHTML = text;
    promptEl.classList.toggle("on", !!text);
    promptEl.classList.toggle("blocked", !!blocked);
    promptBar.style.width = `${Math.max(0, Math.min(1, hold)) * 100}%`;
  }

  // --- cutscenes ------------------------------------------------------------
  // Deliberately tiny. Per STORY.md §5 a cutscene is under 45 seconds, never
  // takes the controls to show competence, and never explains — so all one
  // needs to be is: bars in, camera somewhere it could not otherwise be, one
  // line, bars out. `cine` is read by main.js, which hands the camera over
  // while it is set.
  let cine = null;

  function playCutscene({ from, to, look, seconds = 5, line = "", skippable = true }) {
    return new Promise((resolve) => {
      cine = { from, to, look, seconds, t: 0 };
      const sim = document.getElementById("hud");
      if (sim) sim.style.opacity = "0";
      hud.style.opacity = "0";
      barTop.classList.add("on");
      barBot.classList.add("on");
      if (line) { cineEl.innerHTML = line; cineEl.classList.add("on"); }

      // --- Skipping ------------------------------------------------------
      // On a HOLD, not a press. A press gets eaten by whatever the player
      // happened to be doing as the scene started — and this game hands you a
      // cutscene straight out of flight, with fingers already on the keys.
      // Holding is deliberate by construction, which is the whole reason the
      // convention exists.
      const HOLD = 0.55;
      let held = 0, down = false, raf = 0, last = performance.now();
      const isSkipKey = (e) => e.code === "Space" || e.code === "Escape" || e.code === "Enter";
      const onDown = (e) => { if (isSkipKey(e)) { down = true; e.preventDefault(); } };
      const onUp = (e) => { if (isSkipKey(e)) { down = false; held = 0; } };

      let timer = 0;
      function finish() {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        window.removeEventListener("keydown", onDown);
        window.removeEventListener("keyup", onUp);
        skipEl.classList.remove("on");
        skipBar.style.width = "0%";
        cineEl.classList.remove("on");
        barTop.classList.remove("on");
        barBot.classList.remove("on");
        if (sim) sim.style.opacity = "";
        hud.style.opacity = "";
        cine = null;
        resolve();
      }

      if (skippable) {
        window.addEventListener("keydown", onDown);
        window.addEventListener("keyup", onUp);
        // The prompt appears a moment in, so a short scene is not immediately
        // advertising its own exit.
        setTimeout(() => { if (cine) skipEl.classList.add("on"); }, 900);
        const tick = () => {
          const now = performance.now();
          const dt = Math.min((now - last) / 1000, 0.1);
          last = now;
          if (down) held += dt; 
          skipBar.style.width = `${Math.min(1, held / HOLD) * 100}%`;
          if (held >= HOLD) return finish();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }

      timer = setTimeout(finish, seconds * 1000);
    });
  }

  const api = {
    hud, toast, fade, setObjective, setWaypoint, refreshState, setPrompt, playCutscene,
    get cine() { return cine; },
    get chapter() { return current; },
    get chapterId() { return current?.id || null; },

    load(list) { chapters = list; index = -1; },

    async advance() {
      if (current?.exit) await current.exit(api, ctx);
      index += 1;
      current = chapters[index] || null;
      sinceEnter = 0;
      holdDone = 0;
      setWaypoint(null);
      if (!current) { objEl.classList.remove("on"); return; }
      if (current.objective) setObjective(current.objective, current.sub || "");
      if (current.enter) await current.enter(api, ctx);
      stateEl.classList.toggle("on", current.showState !== false);
    },

    /** Jump to a chapter by id — for the debug console and for resuming. */
    async goto(id) {
      const i = chapters.findIndex((c) => c.id === id);
      if (i < 0) return false;
      index = i - 1;
      await api.advance();
      return true;
    },

    update(dt) {
      if (cine) cine.t = Math.min(1, cine.t + dt / cine.seconds);
      if (!current) return;
      sinceEnter += dt;

      if (current.update) current.update(dt, api, ctx);

      // Objective satisfied? Chapters can also just call api.complete().
      if (current.done && !current._done) {
        const ok = current.done(api, ctx);
        holdDone = ok ? holdDone + dt : 0;
        // A short hold, so brushing past a waypoint at 80 knots doesn't tick it.
        if (holdDone > (current.hold ?? 0.35)) api.complete();
      }

      // Waypoint marker, projected to screen. Clamped to the edge with an arrow
      // when off-screen, because a marker you can't see is a marker that makes
      // the player fly in circles.
      if (waypoint) {
        v.copy(waypoint).project(ctx.camera);
        const behind = v.z > 1;
        let x = (v.x * 0.5 + 0.5) * window.innerWidth;
        let y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        if (behind) { x = window.innerWidth - x; y = window.innerHeight - y; }
        const m = 54;
        const cx = THREE.MathUtils.clamp(x, m, window.innerWidth - m);
        const cy = THREE.MathUtils.clamp(y, m, window.innerHeight - m);
        markEl.style.transform = `translate(${cx}px,${cy}px)`;
        const d = ctx.getPosition().distanceTo(waypoint);
        markLabel.textContent = waypointLabel
          ? `${waypointLabel} · ${fmtDist(d)}` : fmtDist(d);
        // ...and again on the objective panel, because the marker is often off
        // at the edge of the screen behind you and the objective never is.
        objWay.textContent = waypointLabel
          ? `${waypointLabel} — ${fmtDist(d)}` : fmtDist(d);
        objWay.style.display = "";
      } else {
        objWay.style.display = "none";
      }

      fireEl.classList.toggle("on", ctx.player.charge > 0.02);
      fireBar.style.width = `${ctx.player.charge * 100}%`;
    },

    complete() {
      if (!current || current._done) return;
      current._done = true;
      objEl.classList.add("done");
      setWaypoint(null);
      setTimeout(() => api.advance(), current.beat ?? 1400);
    },

    /** Distance from the dragon to a point, ignoring height. */
    flatDist(p) {
      const a = ctx.getPosition();
      return Math.hypot(a.x - p.x, a.z - p.z);
    },

    dispose() {
      hud.remove(); fadeEl.remove(); style.remove();
    },
  };

  refreshState();
  return api;
}
