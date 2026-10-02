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

// The styles for everything below live in css/hud.css, with the rest of the
// in-flight UI, so the whole HUD is one design rather than a string per file.

function el(cls, html = "") {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  return d;
}

export function setupGame(ctx) {
  // ctx: { scene, camera, world, player, getPosition(), getHeading(), pad }
  const hud = el("na-hud");
  const objEl = el("na-obj", `<div class="eyebrow"></div><div class="line"></div><div class="sub"></div><div class="way"></div>`);
  const markEl = el("na-mark", `<i></i><em class="arrow"></em><b></b>`);
  const stateEl = el("na-state");
  const fireEl = el("na-fire", `<i></i>`);
  const promptEl = el("na-prompt", `<span class="txt"></span><span class="hold"><i></i></span>`);
  const toastEl = el("na-toast");
  const cardEl = el("na-card",
    `<div class="n"></div><div class="t"></div><div class="rule"></div><div class="b"></div>`);
  const endEl = el("na-end");
  const fadeEl = el("na-fade");
  const barTop = el("na-bars top");
  const barBot = el("na-bars bot");
  const cineEl = el("na-cine");
  const skipEl = el("na-skip", `Hold Space to skip<s><i></i></s>`);
  const skipBar = skipEl.querySelector("s i");
  markEl.style.display = "none";
  hud.append(objEl, markEl, stateEl, fireEl, promptEl, toastEl);
  document.body.append(hud, fadeEl, barTop, barBot, cineEl, skipEl, cardEl, endEl);
  const arrowEl = markEl.querySelector(".arrow");

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
  let stateHidden = false;

  const v = new THREE.Vector3();

  function refreshState() {
    const p = ctx.player.state;
    dayEl.textContent = p.day;
    const fed = p.food === "fed" ? 2 : p.food === "thin" ? 1 : 0;
    foodPips.forEach((s, i) => s.classList.toggle("on", i < fed));
    restPips.forEach((s) => s.classList.toggle("on", p.rested));
  }

  // Toasts queue. There used to be one element and the last write won, and an
  // earlier toast's timer could hide a later one halfway through — so "Dark."
  // during the raid ate the instruction that came before it. Now each one gets
  // its turn, a repeat of the one on screen just extends it, and a long queue
  // speeds itself up rather than lagging a minute behind the play.
  const toastQueue = [];
  let toastShowing = null, toastTimer = 0;
  function toast(text, ms = 2600) {
    if (toastShowing && toastShowing.text === text) {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(nextToast, ms);
      return;
    }
    if (toastQueue.length && toastQueue[toastQueue.length - 1].text === text) return;
    toastQueue.push({ text, ms });
    if (!toastShowing) nextToast();
  }
  function nextToast() {
    const t = toastQueue.shift();
    if (!t) {
      toastShowing = null;
      toastEl.classList.remove("on");
      return;
    }
    const wasOn = !!toastShowing;
    toastShowing = t;
    const show = () => {
      toastEl.innerHTML = t.text;
      toastEl.classList.remove("on");
      void toastEl.offsetWidth;          // restart the rise-in
      toastEl.classList.add("on");
      const ms = toastQueue.length > 2 ? Math.min(t.ms, 900) : t.ms;
      toastTimer = setTimeout(nextToast, ms);
    };
    if (wasOn) { toastEl.classList.remove("on"); toastTimer = setTimeout(show, 220); }
    else show();
  }

  function fade(on) {
    fadeEl.classList.toggle("on", on);
    return new Promise((r) => setTimeout(r, 580));
  }

  // Chapters that narrate their own progress call this every frame — the
  // fishing pass and the search in the wood both do — and the text is the same
  // on nearly all of them. Writing innerHTML sixty times a second to say the
  // identical thing costs a parse and a layout each time, so remember the last
  // one and do nothing when it has not moved.
  let shownObj = null;
  // What the small line over the objective says. Story sets it to the chapter
  // it is in; free flight to what it is counting.
  let eyebrowText = "Objective";
  function setObjective(line, sub = "", eyebrow = eyebrowText) {
    const key = `${eyebrow}\u0000${line}\u0000${sub}`;
    if (key === shownObj) return;
    shownObj = key;
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

  const beatHooks = new Set();
  const finishHooks = new Set();

  // --- chapter title card ---------------------------------------------------
  // The one moment the game says out loud where you are in the story. Over the
  // flying, not instead of it: the controls never leave the player.
  let cardTimer = 0;
  function chapterCard({ n, title, blurb = "" }, ms = 4200) {
    cardEl.querySelector(".n").textContent = n ? `Chapter ${n}` : "";
    cardEl.querySelector(".t").textContent = title;
    cardEl.querySelector(".b").textContent = blurb;
    cardEl.classList.remove("on");
    void cardEl.offsetWidth;
    cardEl.classList.add("on");
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => cardEl.classList.remove("on"), ms);
  }

  // --- end screen -------------------------------------------------------------
  // A modal list of choices over a stopped scene. Owns the keyboard while it is
  // up (capture phase, the same trick as the pause menu) and resolves with the
  // id of whatever was picked.
  function showEnd({ eyebrow = "", title = "", body = "", stats = [], actions = [] }) {
    return new Promise((resolve) => {
      let sel = 0;
      endEl.innerHTML = `
        <div class="na-end-card">
          <div class="eyebrow">${eyebrow}</div>
          <h2>${title}</h2>
          <div class="rule"></div>
          ${body ? `<p>${body}</p>` : ""}
          ${stats.length ? `<dl>${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
          <div class="acts">${actions.map((a, i) =>
            `<button type="button" data-i="${i}">${a.label}</button>`).join("")}</div>
        </div>`;
      const btns = [...endEl.querySelectorAll("button")];
      const draw = () => btns.forEach((b, i) => b.classList.toggle("on", i === sel));
      const pick = (i) => {
        window.removeEventListener("keydown", onKey, true);
        endEl.classList.remove("on");
        resolve(actions[i]?.id);
      };
      const onKey = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (["ArrowUp", "ArrowLeft", "KeyW", "KeyA"].includes(e.code)) sel = (sel + btns.length - 1) % btns.length;
        else if (["ArrowDown", "ArrowRight", "KeyS", "KeyD", "Tab"].includes(e.code)) sel = (sel + 1) % btns.length;
        else if (e.code === "Enter" || e.code === "Space") return pick(sel);
        draw();
      };
      btns.forEach((b, i) => {
        b.addEventListener("click", () => pick(i));
        b.addEventListener("mouseenter", () => { sel = i; draw(); });
      });
      draw();
      if (document.pointerLockElement) document.exitPointerLock();
      window.addEventListener("keydown", onKey, true);
      endEl.classList.add("on");
    });
  }

  const api = {
    hud, toast, fade, setObjective, setWaypoint, refreshState, setPrompt, playCutscene,
    chapterCard, showEnd,
    /** fn(beatId, index) whenever a beat starts. */
    onBeat(fn) { beatHooks.add(fn); return () => beatHooks.delete(fn); },
    /** fn() when the last beat is done. */
    onFinish(fn) { finishHooks.add(fn); return () => finishHooks.delete(fn); },
    setEyebrow(t) { eyebrowText = t; shownObj = null; },
    /** Show or hide the food / rest strip — free flight has no use for it. */
    showState(on) { stateEl.classList.toggle("on", !!on); stateHidden = !on; },
    get waypoint() { return waypoint; },
    get waypointLabel() { return waypointLabel; },
    get beats() { return chapters.map((c) => c.id); },
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
      if (!current) {
        objEl.classList.remove("on"); shownObj = null;
        for (const fn of finishHooks) fn();
        return;
      }
      for (const fn of beatHooks) fn(current.id, index);
      // Forget what was on screen, or a chapter whose objective happens to read
      // the same as the last one's inherits its struck-through "done" styling.
      shownObj = null;
      if (current.objective) setObjective(current.objective, current.sub || "");
      if (current.enter) await current.enter(api, ctx);
      stateEl.classList.toggle("on", !stateHidden && current.showState !== false);
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
      sinceEnter += dt;

      // No chapter is a real state — free flight, and after the story ends —
      // and the waypoint below still has to draw in it.
      if (current?.update) current.update(dt, api, ctx);

      // Objective satisfied? Chapters can also just call api.complete().
      if (current?.done && !current._done) {
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
        // Keep clear of the furniture: the compass and objective along the
        // top, the instruments and the condition strip along the bottom.
        const m = 64, mTop = 150, mBot = 150;
        const W = window.innerWidth, H = window.innerHeight;
        // Off screen, or behind: pin it to the edge on the line from the centre
        // towards it, and point an arrow at where it is. Clamping x and y
        // separately put it in a corner for anything diagonal and gave no clue
        // which way to turn.
        let off = behind || x < m || x > W - m || y < mTop || y > H - mBot;
        let cx = x, cy = y;
        if (off) {
          // From the middle of the safe box, out to its edge.
          const ox = W / 2, oy = (mTop + H - mBot) / 2;
          let dx = x - ox, dy = y - oy;
          if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
          const k = Math.min((W / 2 - m) / Math.max(Math.abs(dx), 1e-3),
                             ((H - mTop - mBot) / 2) / Math.max(Math.abs(dy), 1e-3));
          cx = ox + dx * k; cy = oy + dy * k;
          arrowEl.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        }
        markEl.classList.toggle("off", off);
        // Hug the label inward at the side edges, or it runs off the screen.
        markEl.classList.toggle("edge-r", off && cx > W - m - 2);
        markEl.classList.toggle("edge-l", off && cx < m + 2);
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
      hud.remove(); fadeEl.remove(); cardEl.remove(); endEl.remove();
    },
  };

  refreshState();
  return api;
}
