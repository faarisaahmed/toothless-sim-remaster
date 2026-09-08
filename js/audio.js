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
// --- Two sets of music, and why -------------------------------------------
//
// SCORE      John Powell's How to Train Your Dragon score, in
//            assets/audio/official_music/. It is what the game should sound
//            like and it is not ours to redistribute, so that folder is in
//            .gitignore and never reaches the repo or the Pages deploy. This
//            is a personal project; the score is for playing it at home.
//
// LICENSED   Kevin MacLeod (incompetech.com) under Creative Commons
//            Attribution 4.0 — free of charge, free of royalties, one
//            condition, which is the credit. Attribution is in the README, in
//            the ID3 tags and in CREDITS below.
//
// The score wins where it exists and the licensed set is the fallback, decided
// per track by whether the file loads. That is not a build flag or a host
// check: on this machine the score is there and plays, on Pages the request
// 404s and the CC track takes over, and both are the correct behaviour for
// where they are running. `music.usingScore()` says which happened.
//
// Cue points matter more than usual here. A film score is written to a scene,
// so the useful part of a track is often a minute in — the fast Viking theme
// in This Is Berk starts at 1:05, Test Drive does not open up until 1:25 —
// and dropping in at 0:00 for a moment that wants the big tune gets you the
// quiet introduction to it instead. So a track may name a window and loop
// inside it. The numbers below were measured off the files rather than
// guessed — `python3 tools/soundtrack.py` prints the energy profile the cue
// points were read off, and is how to re-pick them if a file changes.
// ---------------------------------------------------------------------------

const BASE  = "./assets/audio/music/";
const SCORE = "./assets/audio/official_music/";

/** Encode a filename for a URL without mangling the directory separators. */
const url = (dir, file) => dir + encodeURIComponent(file);

export const CREDITS = {
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  artist: "Kevin MacLeod",
  url: "https://incompetech.com/",
};

/**
 * id -> what to play, and what each one is for.
 *
 * `score` is the film cue and wins when the file is there. `from`/`to` are
 * seconds and, when given, the track loops inside that window instead of over
 * the whole thing. `file` is the CC-BY fallback that ships.
 */
export const TRACKS = {
  // Slow, dark, unhurried. The save slots are read over the top of it, so this
  // wants the quiet opening of This Is Berk and none of what comes after.
  title: {
    file: "lightless-dawn.mp3", gain: 0.85,
    score: "This Is Berk.mp3", from: 0, to: 62,
  },
  // Small and warm, for one room lit by one fire.
  prologue: {
    file: "folk-round.mp3", gain: 0.70,
    score: "Romantic Flight (From How To Train Your Dragon Music From The Motion Picture).mp3",
    from: 0, to: 44,
  },
  // Drifting and open — the archipelago, and most of the game. Test Drive
  // spends its first minute building, which is exactly the right shape for
  // flying around not doing anything in particular.
  flight: {
    file: "windswept.mp3", gain: 0.60,
    score: "Test Drive (From How To Train Your Dragon Music From The Motion Picture).mp3",
    from: 0, to: 84,
  },
  // Flat out. Test Drive from 1:25, which is where it opens up and stays open
  // until it ends — the loudest sixty seconds on any of these files.
  flatout: {
    file: "windswept.mp3", gain: 0.72,
    score: "Test Drive (From How To Train Your Dragon Music From The Motion Picture).mp3",
    from: 85, to: 145,
  },
  // The raid. The fast Viking theme, 1:05 to 2:15.
  raid: {
    file: "long-note-two.mp3", gain: 0.80,
    score: "This Is Berk.mp3", from: 65, to: 135,
  },
  // Sparse and held. For the beats where being seen is the thing at stake —
  // and deliberately left on the licensed track, because none of the three
  // score cues is sparse and forcing one of them into the role would be worse
  // than the right piece of library music.
  tension: { file: "long-note-two.mp3", gain: 0.75 },
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

const scored = new Map();     // id -> true if the film cue loaded, false if not

function element(id) {
  let el = elements.get(id);
  if (el) return el;
  const track = TRACKS[id];
  if (!track) { console.warn(`music: no track "${id}"`); return null; }

  // Ask for the score first. If it is not on this machine the request fails
  // and `error` swaps in the licensed track — which is how the same build
  // sounds like the film here and still has music on Pages. `tried` stops the
  // handler recursing when the fallback is missing too.
  const first = track.score ? url(SCORE, track.score) : BASE + track.file;
  el = new Audio(first);
  el.loop = false;             // the window loop below does it instead
  el.preload = "auto";
  el.volume = 0;
  scored.set(id, !!track.score);

  let tried = 0;
  el.addEventListener("error", () => {
    tried++;
    if (tried === 1 && track.score) {
      // Expected on any machine without the score. Not a warning.
      scored.set(id, false);
      el.src = BASE + track.file;
      el.load();
      if (currentId === id && unlocked) el.play().catch(() => {});
    } else if (tried > 1 || !track.score) {
      console.warn(`music: could not load ${track.file}`);
    }
  });

  // --- The window loop ---------------------------------------------------
  // `loop` on the element restarts at 0, which for a cue that begins a minute
  // in means the big tune plays once and then drops back to its own quiet
  // introduction and stays there. So the loop is done by hand, between `from`
  // and `to`, and it is done on BOTH events: `timeupdate` catches the end of
  // the window and `ended` catches a track whose window runs to the last
  // sample, where timeupdate may never fire again.
  const wrap = () => {
    const t = trackWindow(id);
    if (!t) return;
    if (el.currentTime >= t.to - 0.05 || el.currentTime < t.from - 0.5) {
      el.currentTime = t.from;
      if (el.paused && currentId === id) el.play().catch(() => {});
    }
  };
  el.addEventListener("timeupdate", wrap);
  el.addEventListener("ended", () => {
    const t = trackWindow(id);
    el.currentTime = t ? t.from : 0;
    if (currentId === id) el.play().catch(() => {});
  });

  elements.set(id, el);
  return el;
}

/**
 * The from/to window for a track, or null for "play the whole thing".
 *
 * Only applies to the score: the cue points were measured against those files
 * and mean nothing on the licensed ones, which are already the right length
 * and shape for what they are doing.
 */
function trackWindow(id) {
  const t = TRACKS[id];
  if (!t || !scored.get(id) || t.from == null || t.to == null) return null;
  return { from: t.from, to: t.to };
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
  /** Whether a given id is playing the film cue or the licensed fallback. */
  usingScore(id = currentId) { return scored.get(id) === true; },

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
      // Into the window, not to 0. A cue that starts at 1:25 has to START at
      // 1:25 the first time as well as on every loop.
      const w = trackWindow(id);
      if (w) { try { el.currentTime = w.from; } catch { /* not seekable yet */ } }
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
