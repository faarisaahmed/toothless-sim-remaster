// ---------------------------------------------------------------------------
// On-screen controls.
//
// Off by default, turned on from the title screen, and when it is on it has to
// be able to do EVERYTHING — not a stripped tablet version of the game. That
// requirement is the whole design, and it is why this file synthesises the
// game's own input events instead of adding a third input path beside the
// keyboard and the pad:
//
//   Every action goes out as a real keydown/keyup carrying the code the current
//   scheme is bound to, read live out of js/keymap.js. So a touch button is not
//   "wired to fire" — it is wired to whatever `fire` is, and it inherits every
//   gate, cooldown, hold-vs-tap rule and prompt that the keyboard has. Nothing
//   downstream of here knows or cares that a finger did it. When the layout
//   changes, this changes with it and there is nothing to keep in sync.
//
// The one thing that cannot go out as a key is the CAMERA, because looking is
// a delta rather than a state and the mouse path behind it is gated on pointer
// lock, which does not exist on a touchscreen. That leaves on a custom event,
// `na-look`, which main.js listens for next to its mousemove handler — one new
// line of plumbing for the one input that genuinely has no keyboard equivalent.
//
// Layout follows from where thumbs actually are, not from where a diagram
// looks tidy:
//
//   left thumb    the steering stick, because steering is continuous and it is
//                 the thing you are always doing.
//   right thumb   the look pad, sat under the action cluster, because looking
//                 is also continuous and the two hands should not have to
//                 share one job.
//   both          the action buttons ring the outside edges where a thumb can
//                 reach without covering the middle of the screen, which is
//                 where the dragon is.
//
// Buttons say HOLD or TAP on themselves. That is not decoration: several of
// these actions mean different things depending on how long they are held, and
// a touch player has no key legend in front of them to find that out from.
// ---------------------------------------------------------------------------

import * as keymap from "./keymap.js";
import { settings } from "./settings.js";

const STORE_KEY = "nightalone.touch.v1";

/**
 * Read the stored preference. Off unless it has been turned on.
 *
 * `?touch=on` and `?touch=off` in the URL set it as if the title-screen row
 * had been flipped. That exists so the option is reachable without the title
 * screen at all — which is what the headless tools need, since each run gets a
 * fresh browser profile and no localStorage — and it doubles as a way to hand
 * somebody a link that opens the game already set up for a phone.
 */
export function isEnabled() {
  const want = new URLSearchParams(location.search).get("touch");
  try {
    if (want === "on" || want === "off") localStorage.setItem(STORE_KEY, want);
    const stored = localStorage.getItem(STORE_KEY);
    // An explicit choice always wins. With no choice on record, a device with
    // no fine pointer gets them ON — because "off by default" on a phone means
    // a player who loads the game, finds nothing to touch, and has no keyboard
    // to reach the menu that would have turned them on. Off by default is
    // still off by default on anything with a mouse.
    if (stored === "on" || stored === "off") return stored === "on";
    return looksLikeTouch();
  } catch {
    return want === "on" || looksLikeTouch();
  }
}

export function setEnabled(on) {
  try { localStorage.setItem(STORE_KEY, on ? "on" : "off"); } catch { /* private mode */ }
  return !!on;
}

export function toggleEnabled() { return setEnabled(!isEnabled()); }

/**
 * Is this a machine that probably wants them anyway?
 *
 * Only used to word the title-screen hint, never to turn them on: a laptop
 * with a touchscreen is still a laptop, and deciding for the player is how you
 * end up with an overlay nobody asked for over the top of a keyboard.
 */
export function looksLikeTouch() {
  return (navigator.maxTouchPoints || 0) > 1 &&
         !matchMedia("(any-hover: hover) and (any-pointer: fine)").matches;
}

// --- The button set --------------------------------------------------------
// `action` is a keymap action, so the code sent is whatever the current scheme
// has bound. `hold` buttons stay down until the finger lifts; the rest send a
// press and release. `latch` is for the ones you want on for a while and
// cannot realistically hold alongside everything else — sprint being the case
// that matters, since on a keyboard it is a pinky resting on Shift.
// A button is bound either by keymap ACTION — resolved live, so it follows the
// current scheme — or by raw CODE, for the things that are not in the scheme at
// all. The prologue is entirely the second kind: js/input.js drives that scene
// off its own hardcoded ROOM bindings rather than through keymap.js.
const LAYOUTS = {
  flight: [
    { action: "fire",      label: "Blast",   kind: "tap",   cls: "b-fire",  hint: "TAP" },
    { action: "aim",       label: "Aim",     kind: "hold",  cls: "b-aim",   hint: "HOLD" },
    { action: "burst",     label: "Flat Out", kind: "hold", cls: "b-burst", hint: "HOLD" },
    { action: "sprint",    label: "Sprint",  kind: "latch", cls: "b-sprint", hint: "ON/OFF" },
    { action: "up",        label: "Climb",   kind: "hold",  cls: "b-up",    hint: "HOLD" },
    { action: "down",      label: "Dive",    kind: "hold",  cls: "b-down",  hint: "HOLD" },
    { action: "landUse",   label: "Land / Use", kind: "hold", cls: "b-land", hint: "HOLD" },
    { action: "sleepfire", label: "Sleepfire", kind: "hold", cls: "b-sleep", hint: "HOLD" },
    { action: "knifeL",    label: "Knife L", kind: "hold",  cls: "b-knl",   hint: "HOLD" },
    { action: "knifeR",    label: "Knife R", kind: "hold",  cls: "b-knr",   hint: "HOLD" },
    { action: "strafeL",   label: "Strafe L", kind: "hold", cls: "b-stl",   hint: "HOLD" },
    { action: "strafeR",   label: "Strafe R", kind: "hold", cls: "b-str",   hint: "HOLD" },
    { action: "alignCamera", label: "Recentre", kind: "tap", cls: "b-cam", hint: "TAP" },
    { action: "alignDragon", label: "Face Cam", kind: "tap", cls: "b-face", hint: "TAP" },
  ],
  // The prologue: look around a room, study things, get up. Four buttons, and
  // the stick walks. Without this the whole opening was unplayable on a phone —
  // there was nothing on screen to move with and no keyboard to reach a menu.
  room: [
    { code: "Enter",  label: "Use",   kind: "tap",  cls: "b-fire", hint: "TAP" },
    { code: "KeyR",   label: "Study", kind: "hold", cls: "b-aim",  hint: "HOLD" },
    { code: "Escape", label: "Skip",  kind: "tap",  cls: "b-land", hint: "TAP" },
  ],
};

// How far the steering stick has to move before it counts. The keys it sends
// are digital, so this is the edge between "not steering" and "steering", and
// it wants to be small enough to feel responsive and large enough that resting
// a thumb does not carve him into the sea.
const STICK_DEAD = 0.22;
// Screen pixels of drag -> the same units main.js's mouse look uses. Tuned so
// a full swipe across a phone is about a 90-degree turn of the camera.
const LOOK_SCALE = 0.0038;

/**
 * @param {object} [opts]
 * @param {"flight"|"room"} [opts.layout] which button set. The stick and the
 *   look pad are the same in both, because looking and moving are the same
 *   gestures wherever you are.
 */
export function setupTouch({ layout = "flight" } = {}) {
  if (!isEnabled()) return null;
  const BUTTONS = LAYOUTS[layout] || LAYOUTS.flight;

  const held = new Set();          // codes currently down, so we can release them
  const root = document.createElement("div");
  root.id = "touch";
  root.innerHTML = `
    <div id="touch-stick" class="pad-zone"><div class="stick-ring"><i></i></div></div>
    <div id="touch-look" class="pad-zone"></div>
    <div id="touch-buttons"></div>
    <div id="touch-top">
      <button type="button" data-key="Minus">Menu</button>
      <button type="button" data-key="Tab">Chart</button>
      <button type="button" data-key="Backquote">Console</button>
      <button type="button" data-hide="1">Hide</button>
    </div>
    <button type="button" id="touch-show" hidden>Controls</button>`;
  document.body.appendChild(root);
  // Lets the rest of the game's CSS get out of the way — the story HUD's
  // status strip lives in the bottom-right corner, which is exactly where the
  // look pad has to be. See `body.touch-on` in css/style.css.
  document.body.classList.add("touch-on");

  const stickZone = root.querySelector("#touch-stick");
  const stickRing = stickZone.querySelector(".stick-ring");
  const stickNub  = stickRing.querySelector("i");
  const lookZone  = root.querySelector("#touch-look");
  const btnWrap   = root.querySelector("#touch-buttons");

  // --- Sending the keys --------------------------------------------------
  // Resolved at press time, not at build time, so switching scheme on the
  // title screen changes what these send without rebuilding anything.
  const codeFor = (b) => (b.code ? b.code : keymap.keysFor(b.action)[0] || null);

  function press(code) {
    if (!code || held.has(code)) return;
    held.add(code);
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  }
  function release(code) {
    if (!code || !held.has(code)) return;
    held.delete(code);
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  }
  function tap(code) {
    if (!code) return;
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    // One frame apart, so anything watching for a press edge sees the edge.
    // Same frame and a handler that reads state on the next tick sees nothing.
    setTimeout(() => window.dispatchEvent(
      new KeyboardEvent("keyup", { code, bubbles: true })), 40);
  }

  /** Everything up. For losing the window, or being switched off. */
  function releaseAll() {
    for (const code of [...held]) release(code);
    for (const el of btnWrap.querySelectorAll(".on")) el.classList.remove("on");
    steer(0, 0);
  }

  // --- The steering stick ------------------------------------------------
  // A stick that sends four digital keys. It could send an analog axis through
  // the gamepad path instead, and that was the first version — but then the
  // stick and the keyboard disagreed about what "hold to carve harder" means,
  // because controls.js ramps the turn off how LONG a key has been down. Keys
  // it is, and the carve behaves the same for a thumb as for a finger.
  let steerX = 0, steerY = 0;
  // In flight these are keymap actions, so the stick follows the scheme. In the
  // prologue js/input.js's ROOM context listens for W A S D and the arrows
  // directly and has never heard of keymap, so the codes are given straight.
  const STEER = layout === "room"
    ? { forward: "KeyW", back: "KeyS", turnL: "KeyA", turnR: "KeyD" }
    : null;
  const steerCode = (name) => (STEER ? STEER[name] : codeFor({ action: name }));

  function steer(x, y) {
    steerX = x; steerY = y;
    const set = (name, on) => (on ? press(steerCode(name)) : release(steerCode(name)));
    set("forward", y < -STICK_DEAD);
    set("back",    y >  STICK_DEAD);
    set("turnL",   x < -STICK_DEAD);
    set("turnR",   x >  STICK_DEAD);
    const r = Math.min(1, Math.hypot(x, y));
    const a = Math.atan2(y, x);
    stickNub.style.transform =
      `translate(calc(-50% + ${Math.cos(a) * r * 38}px), calc(-50% + ${Math.sin(a) * r * 38}px))`;
    stickZone.classList.toggle("active", r > STICK_DEAD);
  }

  let stickId = null, stickOrigin = null;
  stickZone.addEventListener("pointerdown", (e) => {
    stickId = e.pointerId;
    // The origin is where the thumb LANDED, and so is the RING. The zone is the
    // whole left half of the screen and invisible; the ring is drawn under the
    // finger the moment it goes down and taken away when it lifts. A fixed ring
    // in a corner is a target you have to look at and aim for, and on a phone
    // you are looking at the dragon.
    stickOrigin = { x: e.clientX, y: e.clientY };
    const box = stickZone.getBoundingClientRect();
    stickRing.style.left = `${e.clientX - box.left}px`;
    stickRing.style.top = `${e.clientY - box.top}px`;
    stickRing.classList.add("live");
    stickZone.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stickZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    const R = 52;   // px to full deflection
    steer(
      Math.max(-1, Math.min(1, (e.clientX - stickOrigin.x) / R)),
      Math.max(-1, Math.min(1, (e.clientY - stickOrigin.y) / R))
    );
  });
  const dropStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    stickRing.classList.remove("live");
    steer(0, 0);
  };
  stickZone.addEventListener("pointerup", dropStick);
  stickZone.addEventListener("pointercancel", dropStick);

  // --- The look pad ------------------------------------------------------
  // Relative dragging, and it does NOT recentre: this is a mouse, not a stick.
  // Lifting and putting the thumb down again keeps the camera where it was,
  // which is the behaviour every phone game with a camera has, and the reason
  // a returning stick is wrong here is that the camera has no rest position to
  // return to.
  let lookId = null, lookLast = null;
  lookZone.addEventListener("pointerdown", (e) => {
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    lookZone.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  lookZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
    // Same sign convention as the mouse handler in main.js, so the two feel
    // identical and the aim system does not need to know which one moved —
    // including the invert settings, which a touch player wants for the same
    // reasons a mouse player does.
    const k = LOOK_SCALE * settings.lookSpeed();
    window.dispatchEvent(new CustomEvent("na-look", {
      detail: { dx: -dx * k * settings.lookX(), dy: -dy * k * settings.lookY() },
    }));
  });
  const dropLook = (e) => {
    if (e.pointerId !== lookId) return;
    lookId = null;
  };
  lookZone.addEventListener("pointerup", dropLook);
  lookZone.addEventListener("pointercancel", dropLook);

  // --- The buttons -------------------------------------------------------
  for (const b of BUTTONS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `touch-btn ${b.cls}`;
    el.dataset.kind = b.kind;
    el.innerHTML = `<span class="tb-label">${b.label}</span>` +
                   `<span class="tb-hint">${b.hint}</span>`;
    btnWrap.appendChild(el);

    if (b.kind === "hold") {
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        el.classList.add("on");
        press(codeFor(b));
        e.preventDefault();
      });
      const up = () => { el.classList.remove("on"); release(codeFor(b)); };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    } else if (b.kind === "latch") {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const on = !el.classList.contains("on");
        el.classList.toggle("on", on);
        if (on) press(codeFor(b)); else release(codeFor(b));
      });
    } else {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.classList.add("on");
        setTimeout(() => el.classList.remove("on"), 110);
        tap(codeFor(b));
      });
    }
  }

  // The top row is raw codes rather than keymap actions, because the chart and
  // the console are not bound through the scheme — they never move.
  for (const el of root.querySelectorAll("#touch-top button")) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (el.dataset.hide) { api.setVisible(false); return; }
      tap(el.dataset.key);
    });
  }
  const showBtn = root.querySelector("#touch-show");
  showBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); api.setVisible(true); });

  // Losing the window with three fingers down would otherwise leave him
  // carving into the sea at full throttle with nothing holding the keys.
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

  const api = {
    get element() { return root; },
    get visible() { return !root.classList.contains("hidden"); },
    setVisible(on) {
      root.classList.toggle("hidden", !on);
      showBtn.hidden = !!on;
      if (!on) releaseAll();
    },
    /** What the steering stick is doing, for the pad overlay and the console. */
    get stick() { return { x: steerX, y: steerY }; },
    /** Turn them off mid-session: release everything and take the DOM away. */
    destroy() {
      releaseAll();
      root.remove();
      document.body.classList.remove("touch-on");
    },
  };
  return api;
}
