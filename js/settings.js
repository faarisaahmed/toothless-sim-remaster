import * as keymap from "./keymap.js";
import { MODES as AIM_MODES, getMode as getAimMode, setMode as setAimMode } from "./aim.js";
import { isEnabled as touchOn, setEnabled as setTouch } from "./touch.js";
import { music } from "./audio.js";

// ---------------------------------------------------------------------------
// Settings.
//
// ONE registry, rendered in two places — the title screen and the in-game
// menu — because the alternative is two lists that agree until the day
// somebody adds an option to one of them. Every row here is
// `{ id, label, hint, value, cycle }` and nothing about how it is drawn lives
// in this file, which is what lets a menu built out of <li> and a menu built
// out of buttons share it.
//
// Most rows do not own their value. The control scheme belongs to keymap.js,
// the aim mode to aim.js, the on-screen controls to touch.js, the volume to
// audio.js — each of those already persists itself and is read by code that
// has never heard of this file. A settings screen is a VIEW; making it the
// owner would mean every one of those modules asking permission to know its
// own state.
//
// What this file does own is the things that had no home: the camera
// inversions and the look speeds. Those were hard-coded in main.js's `tuning`
// object, which is a debug-console scratchpad that resets on every reload, so
// "invert the camera" was a setting you had to make again every time you
// played.
// ---------------------------------------------------------------------------

const STORE = "nightalone.settings.v1";

// The look multipliers are ±1 rather than booleans at the point of use, so the
// call sites read `dx * settings.lookX()` and nobody has to remember which way
// round the flag went.
const DEFAULTS = {
  invertLookX: false,   // mouse, left/right
  invertLookY: false,   // mouse, up/down
  padInvertX: false,    // right stick, left/right
  padInvertY: false,    // right stick, up/down
  lookSpeed: 1,         // mouse sensitivity multiplier
  padSpeed: 1,          // right stick multiplier
  skipPrologue: false,  // start a new game in the air, not in the room
};

let state = { ...DEFAULTS };
try {
  const raw = localStorage.getItem(STORE);
  if (raw) state = { ...DEFAULTS, ...JSON.parse(raw) };
} catch { /* private mode, or a corrupt blob — the defaults are fine */ }

const listeners = new Set();

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* not fatal */ }
  for (const fn of listeners) fn(state);
}

/** Told whenever anything changes, so a live HUD can redraw. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const settings = {
  /** ±1, for multiplying a raw mouse delta by. */
  lookX: () => (state.invertLookX ? -1 : 1),
  lookY: () => (state.invertLookY ? -1 : 1),
  padX: () => (state.padInvertX ? -1 : 1),
  padY: () => (state.padInvertY ? -1 : 1),
  lookSpeed: () => state.lookSpeed,
  padSpeed: () => state.padSpeed,
  /** Read by boot.js when it is deciding whether to play B1. */
  skipPrologue: () => !!state.skipPrologue,
  get raw() { return { ...state }; },
  set(key, value) { state[key] = value; save(); },
};

/** Step through a list of values, wrapping. Every row below is one of these. */
function stepper(values, get, set, labels) {
  return {
    value: () => labels[Math.max(0, values.indexOf(get()))] ?? String(get()),
    cycle: (dir = 1) => {
      const i = values.indexOf(get());
      set(values[((i < 0 ? 0 : i) + dir + values.length) % values.length]);
    },
  };
}

const onOff = (key) => ({
  value: () => (state[key] ? "On" : "Off"),
  cycle: () => settings.set(key, !state[key]),
});

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
const SPEED_NAMES = ["Very slow", "Slow", "Normal", "Fast", "Very fast"];
const VOLUMES = [0, 0.25, 0.5, 0.75, 1];
const VOLUME_NAMES = ["Off", "Quiet", "Half", "Loud", "Full"];

/**
 * The rows, in the order they are shown.
 *
 * `hint` is a function because several of them describe the CURRENT value —
 * the control scheme's hint is "steer left hand, act right hand", which is
 * only true of one of the two schemes.
 */
export const OPTIONS = [
  {
    id: "scheme", glyph: "&#8646;", label: "Controls",
    hint: () => keymap.SCHEMES[keymap.getScheme()].hint,
    value: () => keymap.SCHEMES[keymap.getScheme()].label,
    cycle: () => keymap.toggleScheme(),
  },
  {
    id: "aim", glyph: "&#8853;", label: "Aiming",
    hint: () => AIM_MODES[getAimMode()].hint,
    value: () => AIM_MODES[getAimMode()].label,
    cycle: (dir = 1) => {
      const ids = Object.keys(AIM_MODES);
      const i = ids.indexOf(getAimMode());
      setAimMode(ids[(i + dir + ids.length) % ids.length]);
    },
  },
  {
    id: "invertY", glyph: "&#8597;", label: "Invert look &mdash; up / down",
    hint: () => "Mouse and right stick. Push forward to look down",
    ...onOff("invertLookY"),
    // The pad follows the mouse here on purpose. Somebody who wants an
    // inverted camera wants it inverted, not inverted on one device.
    cycle: () => {
      const v = !state.invertLookY;
      settings.set("invertLookY", v);
      settings.set("padInvertY", v);
    },
  },
  {
    id: "invertX", glyph: "&#8596;", label: "Invert look &mdash; left / right",
    hint: () => "Rare, and some people cannot play without it",
    ...onOff("invertLookX"),
    cycle: () => {
      const v = !state.invertLookX;
      settings.set("invertLookX", v);
      settings.set("padInvertX", v);
    },
  },
  {
    id: "lookSpeed", glyph: "&#8599;", label: "Mouse look speed",
    hint: () => "How far the camera swings per inch of mouse",
    ...stepper(SPEEDS, () => state.lookSpeed,
      (v) => settings.set("lookSpeed", v), SPEED_NAMES),
  },
  {
    id: "padSpeed", glyph: "&#9678;", label: "Stick look speed",
    hint: () => "The right stick only. Separate from the mouse on purpose",
    ...stepper(SPEEDS, () => state.padSpeed,
      (v) => settings.set("padSpeed", v), SPEED_NAMES),
  },
  {
    id: "touch", glyph: "&#9744;", label: "On-screen controls",
    hint: () => (touchOn()
      ? "Every control a keyboard has, on screen. Hide them from the corner"
      : "For a phone or a tablet. Everything a keyboard can do"),
    value: () => (touchOn() ? "On" : "Off"),
    // Read once when the flight scene builds, so it takes hold on the way in
    // rather than needing a reload — which is why this is worth saying on the
    // row itself rather than leaving the player to wonder.
    cycle: () => setTouch(!touchOn()),
  },
  {
    // Title screen only: it decides what happens on the way IN to a game, so
    // in the pause menu it would be a row that cannot do anything to the
    // session you are already in.
    id: "prologue", glyph: "&#9750;", label: "Prologue",
    where: "title",
    hint: () => (state.skipPrologue
      ? "Skipped. New games start in the air. `?stage=prologue` still plays it"
      : "The room, before the first flight. Skip it if you are testing"),
    value: () => (state.skipPrologue ? "Skip" : "Play"),
    cycle: () => settings.set("skipPrologue", !state.skipPrologue),
  },
  {
    id: "music", glyph: "&#9834;", label: "Music",
    hint: () => "The score, if it is on this machine; the licensed set if not",
    ...stepper(VOLUMES, () => {
      // Snap the stored float to the nearest step, so a volume set from the
      // debug console does not leave this row showing nothing.
      const v = music.muted ? 0 : music.volume;
      return VOLUMES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    }, (v) => { music.setMuted(v === 0); if (v > 0) music.setVolume(v); },
      VOLUME_NAMES),
  },
];

/**
 * The rows that belong on one screen.
 *
 * Still one registry — this is a filter over it, not a second list. A row with
 * no `where` shows up everywhere, which is all of them but one: "Prologue"
 * only means anything before a game starts, and a menu row that does nothing
 * where it is drawn is worse than a menu row that is missing.
 */
export function optionsFor(where) {
  return OPTIONS.filter((o) => !o.where || o.where === where);
}

/**
 * One row's markup, in exactly the shape the title screen's CSS expects —
 * `.slot.opt` with an index, a main block and a go. The in-game menu reuses
 * the same classes rather than inventing a second look, so the two screens
 * cannot drift apart visually either.
 */
export function optionRowHtml(opt, selected) {
  return `
    <li class="slot opt${selected ? " on" : ""}" data-opt="${opt.id}">
      <div class="slot-index">${opt.glyph}</div>
      <div class="slot-main">
        <div class="slot-title">${opt.label} &mdash; ${opt.value()}</div>
        <div class="slot-meta"><span>${opt.hint()}</span></div>
      </div>
      <div class="slot-go">Change</div>
    </li>`;
}
