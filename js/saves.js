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

// Each slot is its own entry in localStorage, named like a file — user1.dat to
// user4.dat — holding the save as indented JSON. Plain text on purpose: open
// devtools → Application → Local Storage, find user2.dat, edit it, reload.
// The same text is what Export downloads and Import reads back.
export const fileName = (i) => `user${i + 1}.dat`;

/** The save as the text that goes in its file. */
export function toText(save) { return JSON.stringify(save, null, 2); }

/** Text back to a save; null if it is not one. */
export function fromText(text) {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    return migrate({ ...blank(), ...o });
  } catch { return null; }
}

// The old single-blob store, moved into the files once and then removed.
function migrateBlob() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (parsed[i] && localStorage.getItem(fileName(i)) === null) {
          localStorage.setItem(fileName(i), toText(migrate(parsed[i])));
        }
      }
    }
    localStorage.removeItem(KEY);
  } catch { /* leave it be */ }
}

function readAll() {
  migrateBlob();
  const out = new Array(SLOT_COUNT).fill(null);
  for (let i = 0; i < SLOT_COUNT; i++) {
    let raw = null;
    try { raw = localStorage.getItem(fileName(i)); } catch { return out; }
    if (!raw) continue;
    const save = fromText(raw);
    if (save) out[i] = save;
    // A file that has been hand-edited into something unreadable is left
    // alone, not overwritten: shown as damaged so it can be fixed.
    else out[i] = { ...blank(), damaged: true, created: 0, updated: 0 };
  }
  return out;
}

function writeOne(i, save) {
  try {
    if (save) localStorage.setItem(fileName(i), toText(save));
    else localStorage.removeItem(fileName(i));
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
  const save = blank();
  save.created = Date.now();
  save.updated = save.created;
  writeOne(index, save);
  return save;
}

export function write(index, save) {
  save.updated = Date.now();
  writeOne(index, save);
  return save;
}

export function erase(index) {
  writeOne(index, null);
}

/** Download the slot as userN.dat. */
export function exportSlot(index) {
  const save = readAll()[index];
  if (!save) return false;
  const blob = new Blob([toText(save)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName(index);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

/** Pick a .dat file and load it into the slot. Resolves true if it took. */
export function importSlot(index) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".dat,.json,.txt,text/plain";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return resolve(false);
      const save = fromText(await f.text());
      if (!save) return resolve(false);
      writeOne(index, save);
      resolve(true);
    };
    inp.click();
  });
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
  all.forEach((s, i) => { if (s && !s.damaged && (best < 0 || (s.updated || 0) > (all[best].updated || 0))) best = i; });
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
