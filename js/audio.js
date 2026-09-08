// ---------------------------------------------------------------------------
// Music.
//
// One singleton, imported directly by whichever scene wants to set the tune, so
// that a scene loaded on its own — main.js at `/`, the prologue at
// `?stage=prologue` — still gets its music without any handoff plumbing.
//
// Two rules the browser imposes and this has to live with:
//
//   1. Nothing may make noise until the player has interacted with the page.
//      Calling play() before that throws a NotAllowedError. So a play() before
//      the first gesture is remembered rather than performed, and the listeners
//      at the bottom flush it the moment anything is clicked or pressed.
//
//   2. An <audio> element that loops by setting currentTime back to 0 gives you
//      an audible seam. These are long ambient beds where the seam lands in
//      silence, so plain `loop` is honest enough and costs nothing.
//
// Crossfades run off their own interval rather than the render loop, because
// the title screen and the prologue do not share one with the flight scene, and
// music that stops fading when a scene changes is worse than no fade at all.
//
// --- Licence --------------------------------------------------------------
// Every track here is by Kevin MacLeod (incompetech.com), licensed under
// Creative Commons Attribution 4.0. That is free of charge and free of
// royalties, and its one condition is the credit — which is why the attribution
// is in the README, in the ID3 tags of each file, and in CREDITS below rather
// than in a comment somewhere nobody reads.
// ---------------------------------------------------------------------------

const BASE = "./assets/audio/music/";

export const CREDITS = {
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  artist: "Kevin MacLeod",
  url: "https://incompetech.com/",
};

/** id -> file, and what each one is for. */
export const TRACKS = {
  // Slow, dark, unhurried. The save slots are read over the top of it.
  title:    { file: "lightless-dawn.mp3", gain: 0.85 },
  // Small and warm, for one room lit by one fire.
  prologue: { file: "folk-round.mp3",     gain: 0.70 },
  // Drifting and open — the archipelago, and most of the game.
  flight:   { file: "windswept.mp3",      gain: 0.60 },
  // Sparse and held. For the beats where being seen is the thing at stake.
  tension:  { file: "long-note-two.mp3",  gain: 0.75 },
};

const STORE_VOL  = "na.music.volume";
const STORE_MUTE = "na.music.muted";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

let master  = clamp01(readStored(STORE_VOL, 0.55));
let muted   = !!readStored(STORE_MUTE, false);
let unlocked = false;
let pending  = null;          // a play() that arrived before the first gesture

const elements = new Map();   // id -> HTMLAudioElement
const fades    = new Map();   // id -> { to, rate }
let currentId  = null;
let ticker     = null;

function element(id) {
  let el = elements.get(id);
  if (el) return el;
  const track = TRACKS[id];
  if (!track) { console.warn(`music: no track "${id}"`); return null; }
  el = new Audio(BASE + track.file);
  el.loop = true;
  el.preload = "auto";
  el.volume = 0;
  // A network hiccup on one track must not take the game with it.
  el.addEventListener("error", () => console.warn(`music: could not load ${track.file}`));
  elements.set(id, el);
  return el;
}

/** Where a given track's volume should sit when it is fully faded in. */
function targetVolume(id) {
  return muted ? 0 : clamp01(master * (TRACKS[id]?.gain ?? 1));
}

function startTicker() {
  if (ticker !== null) return;
  let last = performance.now();
  ticker = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;

    for (const [id, fade] of [...fades]) {
      const el = elements.get(id);
      if (!el) { fades.delete(id); continue; }
      const step = fade.rate * dt;
      if (el.volume < fade.to) el.volume = clamp01(Math.min(fade.to, el.volume + step));
      else                     el.volume = clamp01(Math.max(fade.to, el.volume - step));

      if (Math.abs(el.volume - fade.to) < 0.001) {
        el.volume = clamp01(fade.to);
        fades.delete(id);
        // Faded all the way out: stop it, so it is not decoding in the
        // background for the rest of the session.
        if (el.volume === 0 && id !== currentId) { el.pause(); el.currentTime = 0; }
      }
    }
    if (fades.size === 0) { clearInterval(ticker); ticker = null; }
  }, 1000 / 30);
}

function fadeTo(id, to, seconds) {
  const el = element(id);
  if (!el) return;
  const rate = seconds > 0 ? Math.abs(to - el.volume) / seconds : 1e9;
  fades.set(id, { to, rate: Math.max(rate, 1e-4) });
  startTicker();
}

export const music = {
  get current() { return currentId; },
  get volume()  { return master; },
  get muted()   { return muted; },
  get ready()   { return unlocked; },

  /**
   * Bring up `id` and take everything else down. Calling it with the track
   * that is already playing is a no-op, so a scene may call it every frame.
   */
  play(id, { fade = 2.5 } = {}) {
    if (!TRACKS[id]) { console.warn(`music: no track "${id}"`); return; }
    if (currentId === id) return;

    if (!unlocked) { pending = { id, fade }; currentId = id; return; }

    for (const [otherId] of elements) {
      if (otherId !== id) fadeTo(otherId, 0, fade);
    }

    const el = element(id);
    currentId = id;
    if (el.paused) {
      el.volume = 0;
      // play() rejects if the gesture has expired or the file 404s. Neither is
      // worth an unhandled rejection in the console.
      el.play().catch(() => {});
    }
    fadeTo(id, targetVolume(id), fade);
  },

  stop({ fade = 2 } = {}) {
    for (const [id] of elements) fadeTo(id, 0, fade);
    currentId = null;
    pending = null;
  },

  setVolume(v) {
    master = clamp01(v);
    write(STORE_VOL, master);
    if (currentId) fadeTo(currentId, targetVolume(currentId), 0.15);
    return master;
  },

  setMuted(on) {
    muted = !!on;
    write(STORE_MUTE, muted);
    if (currentId) fadeTo(currentId, targetVolume(currentId), 0.25);
    return muted;
  },
  toggleMute() { return music.setMuted(!muted); },

  /** Called for you by the gesture listeners below; exposed for scenes that
   *  already know they are inside a click handler. */
  unlock() {
    if (unlocked) return;
    unlocked = true;
    const p = pending;
    pending = null;
    if (p) { currentId = null; music.play(p.id, { fade: p.fade }); }
  },
};

// The first interaction of any kind is the one the browser is waiting for.
for (const type of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(type, () => music.unlock(), { once: true, capture: true });
}

// M mutes. It is the key every game uses for it and nothing else here wants it.
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM") return;
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  music.toggleMute();
});
