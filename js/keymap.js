// ---------------------------------------------------------------------------
// Keyboard schemes.
//
// The old layout put everything on the left hand: WASD to steer, Shift under
// the little finger, and Ctrl under it as well for "down". Holding Ctrl with a
// pinky while steering with the same hand is genuinely awkward, and on macOS
// Ctrl+Up and Ctrl+Down are Mission Control's switch-desktop shortcuts — the OS
// takes them before the page ever sees them, so pressing down while pitching
// threw you out of the game. Ctrl is not bound to anything any more.
//
// So there are two schemes, and the rule is: ONE HAND STEERS, THE OTHER ACTS.
//
//   arrows   steer with the arrow keys (right hand), act with the left hand on
//            A S D F / Z X C V
//   wasd     steer with WASD (left hand), act with the right hand on
//            U I O P / J K L ;
//
// The two are mirror images on purpose, and the mirroring rule has two halves:
//
//   * Actions that are not directional keep the same FINGER. Down is the middle
//     finger on the lower row either way (C / K); fire is the index on the
//     upper row either way (F / U). Swap scheme and your fingers already know.
//
//     Fire and sleepfire were ONE key for a while, told apart by how long you
//     held it: a tap was a plasma blast, a hold was sleepfire. That is a tidy
//     idea and it broke the plasma blast, because a tap can only be recognised
//     once the key comes back UP — so every shot arrived up to a quarter of a
//     second after the player asked for it, and a key held down fired nothing
//     at all. The blast is the reflex action in this game and it has to leave
//     on the way down, so the two are separate keys now (F/U and T/Y).
//
//   * Actions that ARE directional keep the same SIDE, not the same finger.
//     Knife-left is the left-hand key of its pair in both schemes, because a
//     player reaching for "left" reaches left, and no amount of finger
//     consistency beats that.
//
// WHAT THE MIRRORING DOES NOT BUY YOU, AND IT IS WORTH KNOWING:
//
// The acting hand is eight keys over four fingers, upper row and lower row, so
// every finger carries two actions — and two actions on one finger are mutually
// exclusive no matter what the code does. `node tools/keycheck.mjs` prints the
// whole map. The pair to know about is this one:
//
//                   index      middle       ring        pinky
//     upper row     fire       land/use     strafe L    strafe R
//     lower row     BURST      down         knife L     knife R
//
//       wasd          U I O P / J K L ;      arrows      A S D F / Z X C V
//
// Fire and flat out are both the index finger — U over J, F over V — so you
// cannot hold J and press U. This layout is a choice rather than an oversight.
// The alternative was moving burst onto the ring finger and shuffling strafe
// and knife edge around it, which was tried and thrown out: it freed the finger
// and put three controls that were already in the hand somewhere they did not
// belong.
//
// So the answer for firing while flat out is the MOUSE. Left click is a plasma
// blast, always, and it is the hand that is free — the left hand holds W and J
// and the right hand is on the mouse, which is the grip the wasd scheme is
// really for. The keyboard fire key is for playing without a mouse, and then
// flat-out is a hold you come off to shoot.
//

// Space is up in both, because it is a thumb key in both. Shift is sprint in
// both. B and R stay live in both as aliases for burst and land/use, since they
// were the old bindings and cost nothing to keep.
// ---------------------------------------------------------------------------

const STORE_KEY = "nightalone.controls.v1";

export const SCHEMES = {
  wasd:   { id: "wasd",   label: "WASD",       hint: "steer left hand · act right hand" },
  arrows: { id: "arrows", label: "Arrow keys", hint: "steer right hand · act left hand" },
};

export const DEFAULT_SCHEME = "wasd";

// `both` means the binding does not change between schemes. Everything else
// lists the arrows-scheme keys and the wasd-scheme keys.
const BINDINGS = {
  // --- Steering ---
  forward: { arrows: ["ArrowUp"],    wasd: ["KeyW"] },
  back:    { arrows: ["ArrowDown"],  wasd: ["KeyS"] },
  turnL:   { arrows: ["ArrowLeft"],  wasd: ["KeyA"] },
  turnR:   { arrows: ["ArrowRight"], wasd: ["KeyD"] },

  // --- Height. Space is up in both; down sits on the middle finger, lower row.
  up:      { both: ["Space"] },
  down:    { arrows: ["KeyC"], wasd: ["KeyK"] },
  sprint:  { both: ["ShiftLeft", "ShiftRight"] },

  // --- Actions. B and R are kept as aliases of the old bindings.
  burst:   { arrows: ["KeyV", "KeyB"], wasd: ["KeyJ", "KeyB"] },
  landUse: { arrows: ["KeyD", "KeyR"], wasd: ["KeyI", "KeyR"] },
  fire:    { arrows: ["KeyF"],         wasd: ["KeyU"] },
  // Sleepfire used to share `fire` and be told apart by how long you held it.
  // It has its own key now — see the note at the top of this file for why.
  // T and Y are the same physical key mirrored about the middle of the board,
  // so this is the index-finger reach off the fire key in both schemes.
  sleepfire: { arrows: ["KeyT"],       wasd: ["KeyY"] },
  strafeL: { arrows: ["KeyA"],         wasd: ["KeyO"] },
  strafeR: { arrows: ["KeyS"],         wasd: ["KeyP"] },
  knifeL:  { arrows: ["KeyZ"],         wasd: ["KeyL"] },
  knifeR:  { arrows: ["KeyX"],         wasd: ["Semicolon"] },

  // --- Camera and overlays. Chosen to be clear of BOTH schemes, so they never
  // need to move. "Align camera" was on C, which the arrows scheme needs for
  // down; the pad monitor was on P, which the wasd scheme needs for strafe.
  // Aim is right mouse first and a key second, which is the way round every
  // other game does it and the reason flat-out gave RMB up — it still has its
  // own key, B, and Cross.
  aim:         { both: ["KeyE"] },
  alignDragon: { both: ["KeyH"] },
  alignCamera: { both: ["KeyQ"] },
  grid:        { both: ["KeyG"] },
  padView:     { both: ["KeyM"] },
};

// --- Current scheme ---------------------------------------------------------

function load() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && SCHEMES[v]) return v;
  } catch { /* private mode, or storage disabled */ }
  return DEFAULT_SCHEME;
}

let scheme = load();
const listeners = new Set();

export function getScheme() { return scheme; }

export function setScheme(id) {
  if (!SCHEMES[id] || id === scheme) return scheme;
  scheme = id;
  try { localStorage.setItem(STORE_KEY, id); } catch { /* not fatal */ }
  for (const fn of listeners) fn(scheme);
  return scheme;
}

export function toggleScheme() {
  return setScheme(scheme === "wasd" ? "arrows" : "wasd");
}

/** Called whenever the scheme changes, so live HUD can redraw itself. */
export function onSchemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- Lookup -----------------------------------------------------------------

/** The KeyboardEvent.code values currently bound to an action. */
export function keysFor(action) {
  const b = BINDINGS[action];
  if (!b) return [];
  return b.both || b[scheme] || [];
}

/**
 * Does this event code fire this action right now?
 *
 * Deliberately a function call rather than a precomputed Set per action: the
 * scheme can change mid-session and there is no frame in which it is worth
 * caching eight string comparisons.
 */
export function isAction(action, code) {
  const keys = keysFor(action);
  for (const k of keys) if (k === code) return true;
  return false;
}

/** True if any of the action's keys is held, given a `{ [code]: bool }` map. */
export function heldIn(keys, action) {
  for (const k of keysFor(action)) if (keys[k]) return true;
  return false;
}

/** Every code the flight sim claims in the current scheme — for preventDefault. */
export function claimedKeys() {
  const out = new Set();
  for (const action of Object.keys(BINDINGS)) for (const k of keysFor(action)) out.add(k);
  return out;
}

// --- Display ----------------------------------------------------------------

const LABELS = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Space: "Space", ShiftLeft: "⇧", ShiftRight: "⇧", Semicolon: ";",
};

/** How a key should read on screen. */
export function label(code) {
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/**
 * The key legend, in the order it should be shown.
 *
 * It lives here rather than in index.html because the whole point of a scheme
 * is that the legend changes with it, and a hand-written list in the markup is
 * a list that goes stale the first time a binding moves.
 *
 * `keys` is either action names (resolved through the current scheme) or raw
 * strings for things that are not key bindings at all, like the mouse.
 */
export const LEGEND = [
  { keys: ["forward", "back"],    pad: ["L●", "↕"],
    desc: "Forward and back &mdash; let go to hover" },
  { keys: ["turnL", "turnR"],     pad: ["L●", "↔"],
    desc: "Turn &mdash; hold to carve harder" },
  { keys: ["up", "down"],         pad: ["R2", "L2"],
    desc: "Up and down &mdash; a hold trims a little. " +
          "<em>Double-tap and hold</em> to climb, or to drop fast &mdash; " +
          "and it is a full dive if you are already sprinting" },
  { keys: ["sprint"],             pad: [],
    desc: "Sprint &mdash; hold for 400 mph" },
  { keys: ["burst"],              pad: ["✕:shape"], hold: true,
    desc: "Flat out &mdash; hold for 750 mph" },
  { keys: ["!RMB", "aim"],        pad: ["L3"], hold: true,
    desc: "Aim &mdash; the mouse turns his head" },
  { keys: ["landUse"],            pad: [], hold: true,
    desc: "Hold to land, and to use what you&rsquo;re near" },
  { keys: ["fire", "!LMB"],       pad: [],
    desc: "Plasma blast &mdash; fires the instant it goes down, always. " +
          "Six shots, they come back" },
  { keys: ["sleepfire"],          pad: [], hold: true,
    desc: "Sleepfire &mdash; it costs food and rest" },
  { keys: ["strafeL", "strafeR"], pad: ["□:shape", "○:shape"],
    desc: "Strafe sideways, heading unchanged" },
  { keys: ["knifeL", "knifeR"],   pad: ["L1", "R1"],
    desc: "Hold to knife edge onto a wingtip. " +
          "<em>Double-tap</em> for a barrel roll &mdash; time it late and " +
          "a bola goes through where you were" },
  { keys: ["!Mouse"],             pad: ["R●"],
    desc: "Free look &mdash; click to capture" },
  { keys: ["alignDragon"],        pad: ["D↑"],
    desc: "Swing his nose to face the camera" },
  { keys: ["alignCamera"],        pad: ["D↓", "R3"],
    desc: "Swing the camera around to face him" },
  { keys: [],                     pad: ["D←", "D→"],
    desc: "Camera closer / further" },
  { keys: [],                     pad: ["△:shape"],
    desc: "Toggle the wild flights" },
  { keys: ["!Tab"],               pad: ["Pad", "○:shape"],
    desc: "Chart of the archipelago &mdash; <em>○</em> closes it" },
  { keys: ["grid"],               pad: [],
    desc: "Terrain contour grid" },
  { keys: ["padView"],            pad: [],
    desc: "Controller overlay &mdash; every input, live" },
  { keys: ["!/"],                 pad: ["Create"],
    desc: "Hide this panel" },
  { keys: ["!`"],                 pad: ["Options"],
    desc: "Debug console" },
];

/**
 * Render the legend as <li> markup for the in-flight key panel.
 *
 * Only the FIRST key of a multi-key action is shown. B and R are aliases kept
 * for old muscle memory; printing them would tell a new player there are two
 * burst buttons, which is true and unhelpful.
 */
export function legendHtml() {
  // A pad entry is "GLYPH" or "GLYPH:shape" — the shape class is what makes the
  // face buttons render as PlayStation symbols rather than as text.
  const padKbd = (p) => {
    const [glyph, cls] = p.split(":");
    return `<kbd class="pad${cls ? " " + cls : ""}">${glyph}</kbd>`;
  };
  return LEGEND.map((row) => {
    const combo = row.keys.map((k) => {
      // "!" prefixes something that is not a key binding at all — the mouse,
      // Tab, the console key. Those never move with the scheme.
      if (k.startsWith("!")) return `<kbd>${k.slice(1)}</kbd>`;
      const first = keysFor(k)[0];
      return first ? `<kbd>${label(first)}</kbd>` : "";
    }).join("") + (row.hold ? '<span class="hold-note">hold</span>' : "");
    return `<li>
      <span class="combo">${combo}</span>
      <span class="combo pad-combo">${row.pad.map(padKbd).join("")}</span>
      <span class="desc">${row.desc}</span>
    </li>`;
  }).join("");
}

/**
 * `<b>K</b>` for an action, ready to drop into prompt and objective HTML.
 *
 * Every "Hold R to land" in the game used to be a literal R, which was wrong
 * for anyone on the arrow-key scheme and — worse — one of them told the player
 * to hold Ctrl, a key that is not bound to anything any more. A prompt that
 * names the wrong key is worse than no prompt: it teaches the player that the
 * control does not work.
 */
export function keyTag(action) {
  return `<b>${label(keysFor(action)[0] || "?")}</b>`;
}

/** One line for the loading screen and any other one-liner. */
export function tipLine() {
  const k = (a) => label(keysFor(a)[0] || "");
  return `${k("forward")} to fly · ${k("up")} and ${k("down")} for height · ` +
         `${k("sprint")} to sprint · hold ${k("burst")} to fly flat out`;
}
