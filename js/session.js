import * as THREE from "three";
import * as saves from "./saves.js";
import { CHAPTERS, mission1, SITES, BEAT_SKY } from "./chapters.js";
import { settings, onChange as onSettingsChange } from "./settings.js";
import { CHAPTER_LIST, BEAT_ORDER, chapterOfBeat, STORY_TITLE } from "./storyline.js";
import { ISLANDS } from "./terrain.js";

// ---------------------------------------------------------------------------
// The play session: what kind of game this is, where it starts, and what gets
// written down as it goes.
//
// Three ways in, all through boot.js's handoff:
//
//   story, from a slot     resume on the slot's beat, at its saved position,
//                          with its saved food, rest, keys and lab wall.
//   story, a chapter       replay one chapter of a slot from its first beat,
//                          with the world set up the way an unbroken run would
//                          have left it. Never moves the slot's progress back.
//   free flight            no story. The archipelago, and a running count of
//                          the islands he has found, which persists.
//
// With no handoff at all (?stage=flight, the dev route) it is the story from
// the top on a scratch run that is never saved.
//
// THE SAVE. A checkpoint is written at the start of every beat, every half
// minute while flying, and on the way out to the title. Resuming always
// restarts the beat it was on — beats keep their progress in `this._foo` and
// none of that is worth persisting — but at the position he was saved at, so
// Continue does not mean flying back across the map.
// ---------------------------------------------------------------------------

const DISCOVERED_KEY = "nightalone.discovered.v1";
const AUTOSAVE_S = 30;

const V = new THREE.Vector3();

/** Hours on the clock for the World → Time of day presets. */
const FIXED_HOURS = { dawn: 5.9, morning: 9.0, noon: 13.0, evening: 17.2, sunset: 19.4, night: 23.3 };
/** The story's clock: an hour of game time for every eight real minutes. */
const STORY_FLOW = 1 / 480;

export function createSession({ handoff, game, player, storyCtx, setMapSites, getDragon, getControls, sky }) {
  const mode = handoff?.mode === "free" ? "free" : "story";
  const slot = Number.isInteger(handoff?.slot) ? handoff.slot : null;
  const save = handoff?.save || null;
  const replay = handoff?.chapter ? CHAPTERS.find((c) => c.id === handoff.chapter) : null;

  let startBeat = BEAT_ORDER[0];
  let startPos = null;
  let mapSites = [];
  let since = 0;
  let playSeconds = save?.playSeconds || 0;
  let finished = !!save?.finished;
  let chapterNow = null;
  // The furthest a slot has got. A replay of chapter II on a slot that is up to
  // chapter VI must not write chapter II over it.
  const savedIdx = save ? Math.max(0, BEAT_ORDER.indexOf(save.beat)) : 0;
  let beatIdx = 0;

  // --- free flight state ---------------------------------------------------
  const named = ISLANDS.filter((i) => i.name);
  let discovered = new Set();
  try { discovered = new Set(JSON.parse(localStorage.getItem(DISCOVERED_KEY) || "[]")); } catch { /* none */ }
  let nearest = null;

  function persistDiscovered() {
    try { localStorage.setItem(DISCOVERED_KEY, JSON.stringify([...discovered])); } catch { /* full */ }
  }

  // --- writing --------------------------------------------------------------
  function checkpoint() {
    if (mode !== "story" || slot === null || !save) return;
    const dragon = getDragon();
    const controls = getControls();
    const out = { ...save, version: 2, scene: "flight" };
    out.playSeconds = playSeconds;
    out.finished = finished;
    out.day = player.state.day;
    out.chapters = [...new Set([...(save.chapters || []), ...completedChapters()])];
    if (finished || beatIdx >= savedIdx) {
      const cur = game.chapterId;
      if (cur) out.beat = cur;
      out.run = JSON.parse(JSON.stringify(player.state));
      out.sites = mapSites.filter((m) => m.found).map((m) => m.label);
      // Not mid-cutscene: the camera is somewhere he is not, and the dragon is
      // usually parked. Keep the last good one.
      if (dragon && !game.cine) {
        out.pos = {
          x: +dragon.position.x.toFixed(1), y: +Math.max(dragon.position.y, 30).toFixed(1),
          z: +dragon.position.z.toFixed(1), heading: controls ? +controls.getHeading().toFixed(3) : 0,
        };
      }
    }
    Object.assign(save, out);
    saves.write(slot, save);
  }

  function completedChapters() {
    const done = [];
    const cur = chapterOfBeat(game.chapterId);
    for (const c of CHAPTER_LIST) {
      if (finished || (cur && CHAPTER_LIST.indexOf(c) < CHAPTER_LIST.indexOf(cur))) done.push(c.id);
    }
    return done;
  }

  // --- starting -------------------------------------------------------------
  function start() {
    mapSites = [
      { x: SITES.camp.x,  z: SITES.camp.z,  label: "The clearing", found: false },
      { x: SITES.rig.x,   z: SITES.rig.z,   label: "Dragon Hunter Island", found: false },
      { x: SITES.stack.x, z: SITES.stack.z, label: "Hollow Stack", found: false },
      { x: SITES.fish.x,  z: SITES.fish.z,  label: "Shoal", found: false },
    ];
    setMapSites(mapSites);
    storyCtx.findSite = (label) => {
      const m = mapSites.find((x) => x.label === label);
      if (m) m.found = true;
    };

    if (mode === "free") return startFree();

    game.load(mission1(storyCtx));

    if (replay) {
      // A replay starts the chapter clean, with exactly what it needs.
      replay.prepare?.(player);
      for (const label of replay.sites || []) storyCtx.findSite(label);
      startBeat = replay.beats[0];
      startPos = replay.start?.() || null;
    } else if (save && save.run && save.beat && !save.finished) {
      startBeat = BEAT_ORDER.includes(save.beat) ? save.beat : BEAT_ORDER[0];
      for (const label of save.sites || []) storyCtx.findSite(label);
      const ch = CHAPTERS.find((c) => c.beats.includes(startBeat));
      startPos = save.pos
        ? { pos: new THREE.Vector3(save.pos.x, save.pos.y, save.pos.z), heading: save.pos.heading }
        : ch?.start?.() || null;
    } else if (save?.finished) {
      // A finished story's Continue is the epilogue: fly on from the stack.
      startBeat = BEAT_ORDER[BEAT_ORDER.length - 1];
      for (const label of save.sites || []) storyCtx.findSite(label);
      const ch = CHAPTERS[CHAPTERS.length - 1];
      startPos = ch.start?.() || null;
    }

    let firstBeat = true;
    game.onBeat((id) => {
      beatIdx = BEAT_ORDER.indexOf(id);
      applyBeatSky(id, firstBeat);
      firstBeat = false;
      const ch = chapterOf(id);
      if (ch && ch !== chapterNow) {
        chapterNow = ch;
        game.setEyebrow(`Chapter ${ch.n} · ${ch.title}`);
        // The card waits a beat on the very first chapter so it lands after
        // the loading screen has gone rather than under it.
        setTimeout(() => game.chapterCard(ch), beatIdx === 0 ? 1400 : 300);
      }
      checkpoint();
    });
    game.onFinish(finish);
    game.goto(startBeat);
  }

  /** Roll the sky round to what this beat is set in. */
  function applyBeatSky(id, instant) {
    const env = BEAT_SKY[id];
    if (!sky || !env) return;
    sky.setChanging(false);
    sky.setWeather(env.weather, { transition: instant ? 0 : 45 });
    let ahead = env.time - sky.hour;
    if (ahead < 0) ahead += 24;
    // Close enough: let the clock carry on. A long way: under six hours it
    // runs forward fast where you can see it — the light swinging round is
    // the point — and over that it jumps, which only happens across a fade.
    if (instant || ahead > 6) sky.setTime(env.time);
    else if (ahead > 0.5 && ahead < 23.5) sky.setTime(env.time, { transition: 8 });
    sky.setFlow(env.hold ? 0 : STORY_FLOW);
  }

  /** Free flight's sky, from the World settings. */
  function applyFreeSky(initial = false) {
    if (!sky || mode !== "free") return;
    const t = settings.timeOfDay();
    if (t === "cycle") {
      if (initial) sky.setTime(9.5);
      sky.setFlow(24 / (Math.max(1, settings.dayLength()) * 60));
    } else {
      sky.setTime(FIXED_HOURS[t] ?? 12, { transition: initial ? 0 : 5 });
      sky.setFlow(0);
    }
    const w = settings.weather();
    if (w === "changing") {
      if (initial) sky.setWeather("fair", { transition: 0 });
      sky.setChanging(true);
    } else {
      sky.setChanging(false);
      sky.setWeather(w, { transition: initial ? 0 : 20 });
    }
  }

  function chapterOf(id) {
    return CHAPTERS.find((c) => c.beats.includes(id)) || null;
  }

  function startFree() {
    for (const m of mapSites) m.found = true;
    applyFreeSky(true);
    // Only when one of the World rows actually moved; every other setting
    // change would otherwise restart the weather.
    let last = `${settings.timeOfDay()}|${settings.dayLength()}|${settings.weather()}`;
    onSettingsChange(() => {
      const now = `${settings.timeOfDay()}|${settings.dayLength()}|${settings.weather()}`;
      if (now !== last) { last = now; applyFreeSky(false); }
    });
    game.setEyebrow("Free flight");
    game.showState(false);
    setTimeout(() => game.chapterCard({ n: "", title: "Free Flight",
      blurb: "No story. The whole archipelago, and nobody waiting." }), 1400);
    refreshFree();
  }

  function refreshFree() {
    const found = named.filter((i) => discovered.has(i.name)).length;
    const total = named.length;
    if (found >= total) {
      game.setObjective("The whole archipelago, charted.",
        `${found} of ${total} islands found`);
      game.setWaypoint(null);
      nearest = null;
      return;
    }
    game.setObjective("Find every island.", `${found} of ${total} found`);
  }

  // --- the end ----------------------------------------------------------------
  async function finish() {
    if (mode !== "story") return;
    finished = true;
    checkpoint();
    const p = player.state;
    const mins = Math.max(1, Math.round(playSeconds / 60));
    const pick = await game.showEnd({
      eyebrow: "Mission One",
      title: STORY_TITLE,
      body: "The cages are empty and the hunters are in the dark. Somebody bought the war's " +
            "leftovers, and now they know there is something out here that bites back.",
      stats: [
        ["Days", p.day],
        ["Time", mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`],
        ["Places charted", mapSites.filter((m) => m.found).length],
        ["Lab results", p.samples.reduce((n, s) => n + s.results.length, 0)],
      ],
      actions: [
        { id: "fly", label: "Keep flying" },
        { id: "title", label: "Return to the title" },
      ],
    });
    if (pick === "title") toTitle();
    else {
      game.setEyebrow("Mission one complete");
      game.setObjective("Fly where you like.", "The story is done. The archipelago is still here.");
    }
  }

  /** Reload straight into the start of the chapter he is in. */
  function restartChapter() {
    const ch = chapterOf(game.chapterId);
    if (!ch) return;
    checkpoint();
    try {
      sessionStorage.setItem("nightalone.launch", JSON.stringify({ slot, chapter: ch.id }));
    } catch { /* storage blocked: the reload lands on the title instead */ }
    location.href = `${location.pathname}?stage=launch`;
  }

  function toTitle() {
    checkpoint();
    location.href = `${location.pathname}?stage=title`;
  }

  // --- placing him ------------------------------------------------------------
  /** Once the dragon and the places both exist: put him where the session starts. */
  function placeDragon() {
    const dragon = getDragon();
    const controls = getControls();
    if (!dragon || !startPos) return;
    dragon.position.copy(startPos.pos);
    let heading = startPos.heading;
    if (heading === undefined && startPos.toward) {
      const dx = startPos.toward.x - startPos.pos.x, dz = startPos.toward.z - startPos.pos.z;
      heading = Math.atan2(dx, dz);
    }
    if (heading !== undefined) controls?.setHeading?.(heading);
  }

  // --- per frame --------------------------------------------------------------
  function update(dt) {
    playSeconds += dt;
    since += dt;
    if (since > AUTOSAVE_S) { since = 0; checkpoint(); }

    if (mode !== "free") return;
    const dragon = getDragon();
    if (!dragon) return;
    const p = dragon.position;

    // Found: over its land, anywhere inside most of its radius. Low or high
    // does not matter — from a dragon, seeing an island is visiting it.
    let best = null, bestD = Infinity;
    for (const isl of named) {
      const d = Math.hypot(p.x - isl.x, p.z - isl.z);
      if (!discovered.has(isl.name)) {
        if (d < isl.r * 0.75) {
          discovered.add(isl.name);
          persistDiscovered();
          game.toast(`<small>Discovered</small><br>${isl.name}`, 2600);
          refreshFree();
          continue;
        }
        if (d < bestD) { bestD = d; best = isl; }
      }
    }
    if (best !== nearest) {
      nearest = best;
      if (best) game.setWaypoint(V.set(best.x, 160, best.z), best.name);
    }
  }

  return {
    mode, start, placeDragon, update, checkpoint, toTitle, restartChapter,
    get isStory() { return mode === "story"; },
    get slot() { return slot; },
    get playSeconds() { return playSeconds; },
    /** What the pause menu's journal shows. */
    journal() {
      const cur = chapterOf(game.chapterId);
      return {
        mode,
        chapter: cur,
        chapters: CHAPTER_LIST.map((c) => ({
          ...c,
          state: finished || (cur && CHAPTER_LIST.indexOf(c) < CHAPTER_LIST.indexOf(cur)) ? "done"
               : cur && c.id === cur.id ? "now" : "ahead",
        })),
        objective: game.chapter?.objective || null,
        samples: player.state.samples,
        sites: mapSites.filter((m) => m.found).map((m) => m.label),
        day: player.state.day,
        food: player.state.food,
        rested: player.state.rested,
        discovered: [...discovered],
        islands: named.map((i) => i.name),
        finished,
      };
    },
  };
}
