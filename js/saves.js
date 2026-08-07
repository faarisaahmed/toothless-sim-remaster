// ---------------------------------------------------------------------------
// Save slots
//
// Four of them, in localStorage, each one a plain object. Deliberately dumb:
// no migration framework, no compression, no IndexedDB. A save is small enough
// to read with your eyes in devtools, which is worth more during a build than
// anything clever would be.
//
// The one rule that matters: a slot is written whole or not at all. Partial
// writes are how a save file becomes a bug report.
// ---------------------------------------------------------------------------

const KEY = "nightalone.saves.v1";
export const SLOT_COUNT = 4;

// Ordered, so a slot's position in the list is also its story position and the
// title screen can show progress without being told how.
export const SCENES = [
  "prologue",     // B1  the room
  "morning",      // B1  he takes the fin
  "firstsolo",    // B2
  "beyond",       // B3
  "rig",          // B4
  "island",       // B5
  "lab",          // B6
  "dream",        // B7
  "wake",         // B8
  "hunt",         // B9
  "sigrun",       // B10
  "plan",         // B11
  "raid",         // B12
  "after",        // B13
];

export const SCENE_TITLES = {
  prologue:  "The Room",
  morning:   "Morning",
  firstsolo: "First Solo",
  beyond:    "Beyond the Chart",
  rig:       "The Rig",
  island:    "Hollow Stack",
  lab:       "The Lab",
  dream:     "The Dream",
  wake:      "The Wake",
  hunt:      "The Hunt",
  sigrun:    "The Lonely Stack",
  plan:      "The Plan",
  raid:      "The Raid",
  after:     "After",
};

function blank() {
  return {
    version: 1,
    created: null,
    updated: null,
    playSeconds: 0,

    scene: "prologue",
    day: 1,

    // Stores, per §2.5. Coarse on purpose.
    stores: "fed",          // fed | thin | empty
    rested: true,

    // What he's worked out. The lab wall lives here; keys are `fire:material:cond`.
    lab: {},
    knowsSleepfire: false,

    // Who he's met, and how big Eyvi has got (§11.6 — she grows).
    met: {},
    eyviScale: 1,

    // Where home is, once he picks it in B5.
    hub: null,

    // Raid planning board from B11.
    plan: null,
  };
}

function readAll() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return new Array(SLOT_COUNT).fill(null);   // private mode, storage disabled
  }
  if (!raw) return new Array(SLOT_COUNT).fill(null);

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Array(SLOT_COUNT).fill(null);
    const out = new Array(SLOT_COUNT).fill(null);
    for (let i = 0; i < SLOT_COUNT; i++) out[i] = parsed[i] || null;
    return out;
  } catch {
    // A corrupt blob is worse than no blob — but don't destroy it, in case the
    // player would rather have it back than have it gone.
    console.warn("saves: could not parse, starting empty");
    return new Array(SLOT_COUNT).fill(null);
  }
}

function writeAll(slots) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
    return true;
  } catch (e) {
    console.warn("saves: write failed", e);
    return false;
  }
}

export function list() {
  return readAll();
}

export function get(index) {
  return readAll()[index] || null;
}

export function create(index) {
  const slots = readAll();
  const save = blank();
  save.created = Date.now();
  save.updated = save.created;
  slots[index] = save;
  writeAll(slots);
  return save;
}

export function write(index, save) {
  const slots = readAll();
  save.updated = Date.now();
  slots[index] = save;
  writeAll(slots);
  return save;
}

export function erase(index) {
  const slots = readAll();
  slots[index] = null;
  writeAll(slots);
}

// --- Display helpers --------------------------------------------------------

export function sceneTitle(save) {
  if (!save) return "";
  return SCENE_TITLES[save.scene] || save.scene;
}

export function progress(save) {
  if (!save) return 0;
  const i = SCENES.indexOf(save.scene);
  return i < 0 ? 0 : i / (SCENES.length - 1);
}

export function playtime(save) {
  if (!save) return "";
  const s = Math.max(0, Math.floor(save.playSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return "just begun";
}

export function lastPlayed(save) {
  if (!save || !save.updated) return "";
  const days = Math.floor((Date.now() - save.updated) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}
