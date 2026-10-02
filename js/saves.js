import { CHAPTER_LIST, BEAT_ORDER, chapterOfBeat, beatProgress } from "./storyline.js";

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

// What a slot holds. Version 2 is the first one the flight sim actually writes:
// version 1 was created on the title screen and never touched again, so every
// "Continue" started the story over. See main.js's checkpoint().
//
//   scene      "prologue" until the room is done, then "flight"
//   beat       the beat to resume on (storyline.js BEAT_ORDER)
//   chapters   ids of chapters finished, for the chapter menu
//   finished   the last beat is done
//   run        the player's state — food, rest, keys, the lab wall, flags
//   sites      chart marks he has found
//   pos        where he was at the checkpoint, so Continue puts him back there
function blank() {
  return {
    version: 2,
    created: null,
    updated: null,
    playSeconds: 0,
    scene: "prologue",
    beat: BEAT_ORDER[0],
    chapters: [],
    finished: false,
    day: 1,
    run: null,
    sites: [],
    pos: null,
  };
}

/** Bring an older save up to date, keeping anything it already knew. */
function migrate(save) {
  if (!save) return null;
  if (save.version >= 2) return save;
  const b = blank();
  return {
    ...b,
    created: save.created ?? b.created,
    updated: save.updated ?? b.updated,
    playSeconds: save.playSeconds || 0,
    scene: save.scene === "prologue" ? "prologue" : "flight",
    prologueSeen: save.prologueSeen,
    day: save.day || 1,
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
    for (let i = 0; i < SLOT_COUNT; i++) out[i] = migrate(parsed[i] || null);
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

/** "Chapter III · Past the Edge", or where a fresh slot will start. */
export function sceneTitle(save) {
  if (!save) return "";
  if (save.finished) return "Complete";
  if (save.scene === "prologue") return "The Room";
  const c = chapterOfBeat(save.beat) || CHAPTER_LIST[0];
  return `${c.n} · ${c.title}`;
}

export function progress(save) {
  if (!save) return 0;
  return beatProgress(save.beat, save.finished);
}

/** Chapters this save may replay from the chapter menu: every one it has
 *  reached, which is everything up to and including the current one. */
export function unlockedChapters(save) {
  if (!save) return [];
  if (save.finished) return CHAPTER_LIST.map((c) => c.id);
  const cur = chapterOfBeat(save.beat);
  const i = cur ? CHAPTER_LIST.indexOf(cur) : 0;
  return CHAPTER_LIST.slice(0, i + 1).map((c) => c.id);
}

/** The most recently played slot, or -1. */
export function latest() {
  const all = readAll();
  let best = -1;
  all.forEach((s, i) => { if (s && (best < 0 || (s.updated || 0) > (all[best].updated || 0))) best = i; });
  return best;
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
