import { BTN } from "./gamepad.js";

// ---------------------------------------------------------------------------
// Action-based input
//
// The old arrangement had key handling scattered across main.js, controls.js
// and debug.js, each with its own keydown listener and its own idea of whether
// a text field had focus. That works right up until two of them want the same
// key in different situations — which is exactly what a title screen and a room
// and a flight model are.
//
// So: nothing asks about keys any more, it asks about ACTIONS. And actions are
// resolved inside a CONTEXT, so `confirm` on the title screen and `confirm` in
// the room can be bound to different things without either knowing the other
// exists. Contexts are a stack; only the top one resolves.
//
// Pad and keyboard land in the same place deliberately. A caller that wants to
// know whether the player said yes should never have to care how they said it.
// ---------------------------------------------------------------------------

// Held-key state, owned here and nowhere else.
const down = new Set();
const pressedThisFrame = new Set();
const releasedThisFrame = new Set();

let padRef = null;
let padPressed = null;   // set by poll(), so pad edges match key edges
let padHeld = null;

// --- Bindings ---------------------------------------------------------------
// An action maps to any number of keyboard codes and any number of pad buttons.
// Axis actions map to a pair of keys plus a stick component.
//
// `repeat` on a menu action gives it key-repeat behaviour with a slow first
// step and a faster follow-up, which is what makes holding down on a list of
// save slots feel right rather than either crawling or bolting.

const MENU = {
  up:      { keys: ["ArrowUp", "KeyW"],     pads: [BTN.DUP],    repeat: true },
  down:    { keys: ["ArrowDown", "KeyS"],   pads: [BTN.DDOWN],  repeat: true },
  left:    { keys: ["ArrowLeft", "KeyA"],   pads: [BTN.DLEFT],  repeat: true },
  right:   { keys: ["ArrowRight", "KeyD"],  pads: [BTN.DRIGHT], repeat: true },
  confirm: { keys: ["Enter", "Space"],      pads: [BTN.CROSS] },
  back:    { keys: ["Escape", "Backspace"], pads: [BTN.CIRCLE] },
  del:     { keys: ["Delete", "KeyX"],      pads: [BTN.SQUARE] },
  start:   { keys: ["Enter", "Space"],      pads: [BTN.OPTIONS, BTN.CROSS] },
};

const ROOM = {
  forward: { keys: ["KeyW", "ArrowUp"] },
  back:    { keys: ["KeyS", "ArrowDown"] },
  turnL:   { keys: ["KeyA", "ArrowLeft"] },
  turnR:   { keys: ["KeyD", "ArrowRight"] },
  look:    { keys: ["KeyE"],  pads: [BTN.TRIANGLE] },   // hold to study a thing
  confirm: { keys: ["Enter", "Space", "KeyE"], pads: [BTN.CROSS] },
  back:    { keys: ["Escape"], pads: [BTN.CIRCLE] },
  rest:    { keys: ["KeyR"],  pads: [BTN.SQUARE] },     // lie back down
  skip:    { keys: ["Escape"], pads: [BTN.OPTIONS] },
};

const CINEMA = {
  advance: { keys: ["Enter", "Space", "KeyE"], pads: [BTN.CROSS] },
  skip:    { keys: ["Escape"], pads: [BTN.OPTIONS] },
};

const CONTEXTS = { menu: MENU, room: ROOM, cinema: CINEMA };

// Repeat timing, seconds. Long enough that a single tap never double-fires.
const REPEAT_DELAY = 0.42;
const REPEAT_RATE  = 0.085;

const repeatClock = new Map();   // action key -> seconds held

// --- Context stack ----------------------------------------------------------
const stack = [];

function top() {
  return stack.length ? stack[stack.length - 1] : null;
}

function bindingFor(action) {
  const name = top();
  if (!name) return null;
  const ctx = CONTEXTS[name];
  return ctx ? ctx[action] || null : null;
}

// --- Keyboard ---------------------------------------------------------------
// A single pair of listeners for the whole game. `repeat` events are dropped —
// OS key repeat is the wrong rate for everything and we do our own.

function typing() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  if (typing()) return;
  if (e.repeat) return;
  down.add(e.code);
  pressedThisFrame.add(e.code);

  // Space and the arrows scroll the page; while a context is up, they're ours.
  if (stack.length && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]
      .includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  down.delete(e.code);
  releasedThisFrame.add(e.code);
});

// Losing focus mid-hold otherwise leaves a key stuck down forever.
window.addEventListener("blur", () => {
  for (const code of down) releasedThisFrame.add(code);
  down.clear();
  repeatClock.clear();
});

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export function attachPad(pad) {
  padRef = pad;
}

export function pushContext(name) {
  if (!CONTEXTS[name]) throw new Error(`unknown input context: ${name}`);
  stack.push(name);
  repeatClock.clear();
}

export function popContext() {
  stack.pop();
  repeatClock.clear();
}

export function currentContext() {
  return top();
}

/**
 * The frame contract for pre-flight stages.
 *
 * A stage calls beginFrame() first thing in its rAF and finishFrame() last.
 * That keeps pad polling, edge detection and rumble flushing in one place, and
 * means only one stage is ever driving the pad — which matters, because
 * getGamepads() hands back a snapshot and two pollers would each see half the
 * presses. The flight sim does its own thing; it predates this and works.
 */
export function beginFrame(dt) {
  if (padRef) padRef.poll(dt);
  setDt(dt);
  poll(dt);
}

export function finishFrame(dt) {
  endFrame();
  if (padRef) padRef.flush(dt);
}

/** Call once a frame, after pad.poll(). */
export function poll(dt) {
  if (padRef && padRef.connected()) {
    padHeld = (b) => padRef.held(b);
    padPressed = (b) => padRef.pressed(b);
  } else {
    padHeld = null;
    padPressed = null;
  }

  // Advance repeat clocks for whatever is currently held in this context.
  const ctx = top() ? CONTEXTS[top()] : null;
  if (ctx) {
    for (const action of Object.keys(ctx)) {
      if (!ctx[action].repeat) continue;
      if (rawHeld(ctx[action])) {
        repeatClock.set(action, (repeatClock.get(action) || 0) + dt);
      } else {
        repeatClock.delete(action);
      }
    }
  }
}

/** Call at the very end of a frame, once every consumer has read its edges. */
export function endFrame() {
  pressedThisFrame.clear();
  releasedThisFrame.clear();
}

function rawHeld(b) {
  if (b.keys) for (const k of b.keys) if (down.has(k)) return true;
  if (b.pads && padHeld) for (const p of b.pads) if (padHeld(p)) return true;
  return false;
}

function rawPressed(b) {
  if (b.keys) for (const k of b.keys) if (pressedThisFrame.has(k)) return true;
  if (b.pads && padPressed) for (const p of b.pads) if (padPressed(p)) return true;
  return false;
}

export function held(action) {
  const b = bindingFor(action);
  return b ? rawHeld(b) : false;
}

/**
 * True on the frame the action begins, and then again on the repeat cadence if
 * the binding asked for repeat. Menus want this; anything that fires a one-shot
 * wants `pressed`.
 */
export function tapped(action) {
  const b = bindingFor(action);
  if (!b) return false;
  if (rawPressed(b)) return true;
  if (!b.repeat) return false;

  const t = repeatClock.get(action);
  if (t === undefined || t < REPEAT_DELAY) return false;

  // Fire on each crossing of the repeat interval past the initial delay.
  const since = t - REPEAT_DELAY;
  const prev = Math.floor((since - lastDt) / REPEAT_RATE);
  const now = Math.floor(since / REPEAT_RATE);
  return now > prev;
}

export function pressed(action) {
  const b = bindingFor(action);
  return b ? rawPressed(b) : false;
}

/**
 * -1..1 from a key pair, or the stick if one is bound and pushed further.
 *
 * The vertical stick axes are negated. In the standard gamepad mapping, pushing
 * a stick UP reports -1, so a naive read walked him backwards — and backwards
 * is the slower of the two speeds, which made it look like the pad did nothing
 * at all rather than like an inverted axis.
 */
export function axis(negAction, posAction, stick = null) {
  let v = (held(posAction) ? 1 : 0) - (held(negAction) ? 1 : 0);
  if (stick && padRef && padRef.connected()) {
    const s = stick === "lx" ? padRef.lx
            : stick === "ly" ? -padRef.ly
            : stick === "rx" ? padRef.rx
            : -padRef.ry;
    if (Math.abs(s) > Math.abs(v)) v = s;
  }
  return v;
}

let lastDt = 1 / 60;
export function setDt(dt) { lastDt = dt; }

/** Nothing held, nothing pressed — used to wait for a genuinely fresh input. */
export function idle() {
  return down.size === 0 && pressedThisFrame.size === 0;
}
