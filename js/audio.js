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
//      an audible seam: a gap, and the reverb tail cut off. These tracks have
//      music running straight through the loop point, so they loop inside a
//      window instead — see "The score" below.
//
// Crossfades run off their own interval rather than the render loop, because
// the title screen and the prologue do not share one with the flight scene, and
// music that stops fading when a scene changes is worse than no fade at all.
//
// --- The score -------------------------------------------------------------
//
// Every track is original, written for this game and built from source by
// tools/music/build.py: the notes are in tools/music/score.py, rendered
// through the GeneralUser GS soundfont and mixed in code. Two themes run
// through all six — the Emberwing theme (the hero's tune, D Dorian, 6/8: a
// fiddle's open strings thrown up a twelfth and held) and the Hearth theme
// (a slow polska in G with a Norwegian raised fourth) — so the game sounds
// like one piece of music in six moods rather than six library tracks.
//
// Each file is one loop plus a second and a half of its own beginning. The
// build renders the loop three times back to back and cuts the middle copy,
// so the first sample of the file already has the reverb tail of the last bar
// in it, and the audio past `to` is the same music as the audio past 0. That
// is what makes a seamless loop possible on a plain <audio> element: when the
// playhead passes `to` it jumps back by exactly one loop — overshoot included —
// and the music either side of the jump is identical. `to` is the loop length
// the build printed, to the sample; change the score and re-copy the numbers.
// ---------------------------------------------------------------------------

const BASE = "./assets/audio/music/";

export const CREDITS = {
  artist: "Original score for Night Alone",
  licence: "instruments from the GeneralUser GS soundfont by S. Christian Collins",
  url: "assets/audio/music/CREDITS.txt",
};

/**
 * id -> what to play, and what each one is for.
 *
 * `from`/`to` are seconds: the track loops inside that window. `gain` sets
 * the balance between tracks — the files are mastered to known loudness
 * (noted per track, in LUFS) and the gains put them where they belong
 * relative to each other and to the sound effects.
 */
export const TRACKS = {
  // Dark to hopeful. The Emberwing theme alone on a fiddle over a drone, its
  // second half on a whistle as the strings come in, then the whole tune again
  // on horns in Mixolydian — the minor third lifted — before the dark returns.
  // -17 LUFS.
  title: { file: "emberwing-title.mp3", gain: 0.56, from: 0, to: 88.32 },
  // Small and warm, for one room lit by one fire: the Hearth theme on fiddle,
  // then whistle with the fiddle under it, harp and a cello. -18 LUFS.
  prologue: { file: "the-hearth.mp3", gain: 0.56, from: 0, to: 80.64 },
  // The archipelago, and most of the game, so it breathes: harp, the theme on
  // whistle, the Hearth theme on fiddle, the theme in full, a high call over
  // nothing, the Hearth theme on the strings, the peak, and the harp again.
  // 2:40 before it repeats. -16 LUFS.
  flight: { file: "emberwing-flight.mp3", gain: 0.56, from: 0, to: 160.0 },
  // Flat out: the theme as a jig at 112, a second jig of its own, bodhrán,
  // and the theme in Mixolydian as the top of the climb. -16 LUFS.
  flatout: { file: "emberwing-jig.mp3", gain: 0.67, from: 0, to: 90.24 },
  // The raid: taiko in 3+3+2, a low ostinato, the theme as a war song in the
  // brass, a fiddle reel, the pipes. -15.5 LUFS.
  raid: { file: "emberwing-raid.mp3", gain: 0.67, from: 0, to: 106.88 },
  // Sparse and held, for the beats where being seen is the thing at stake.
  // A drone, glassy harmonics, a heartbeat, the call in pieces. -19 LUFS.
  tension: { file: "held-breath.mp3", gain: 0.45, from: 0, to: 97.92 },
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
  el.loop = false;             // the window loop below does it instead
  el.preload = "auto";
  el.volume = 0;
  el.addEventListener("error", () => console.warn(`music: could not load ${track.file}`));

  // --- The window loop ---------------------------------------------------
  // Done by hand rather than with `loop`, which restarts at 0 with a gap and
  // throws away the reverb tail. `timeupdate` only fires every 15-250 ms, so
  // the playhead is always somewhat past `to` when we notice; jumping back by
  // exactly one loop length (to `from` plus the overshoot) keeps the music
  // continuous, because the file holds the same music either side of `to`.
  // `ended` catches a background tab whose timeupdates were throttled past
  // the end of the file.
  const wrap = () => {
    const t = trackWindow(id);
    if (!t) return;
    const now = el.currentTime;
    if (now >= t.to) {
      el.currentTime = t.from + Math.min(now - t.to, t.to - t.from);
    } else if (now < t.from - 0.5) {
      el.currentTime = t.from;
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

/** The from/to window for a track, or null for "play the whole thing". */
function trackWindow(id) {
  const t = TRACKS[id];
  if (!t || t.from == null || t.to == null) return null;
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
      // Into the window, not to 0, in case a track's loop starts later than
      // its file does.
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
