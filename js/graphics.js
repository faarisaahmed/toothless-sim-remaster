import { detectTier } from "./quality.js";

// ---------------------------------------------------------------------------
// Graphics settings.
//
// quality.js decides what the machine IS; this file decides what the player
// WANTS, and remembers it. Every option is one of a short list of named values
// so the menu can step through them with left and right, and so the stored
// state is always something a preset could have produced.
//
// Presets are a starting point, not a mode. Picking one writes all of its
// values; touching any single option afterwards flips the preset to "Custom"
// and leaves the rest where they were. "Auto" is a preset whose values come
// from detectTier() — the same guess the game always made, now visible and
// overridable.
//
// Almost everything applies live. The flight stage subscribes with onChange()
// and pushes each value into the system that owns it: render scale into the
// governor, shadows into the sun, detail into the terrain streamer, and so on.
// Nothing here touches three.js, so the title screen can show and edit these
// before any renderer exists.
// ---------------------------------------------------------------------------

const STORE = "nightalone.graphics.v1";

export const PRESETS = {
  low: {
    fpsCap: 60, resScale: "auto", maxDpr: 1, shadows: "off", terrain: "low",
    trees: "low", grass: "off", bloom: false, reflections: "low", clouds: "low",
  },
  medium: {
    fpsCap: 60, resScale: "auto", maxDpr: 1.5, shadows: "low", terrain: "medium",
    trees: "medium", grass: "off", bloom: true, reflections: "medium", clouds: "medium",
  },
  high: {
    fpsCap: 60, resScale: "auto", maxDpr: 2, shadows: "high", terrain: "high",
    trees: "high", grass: "medium", bloom: true, reflections: "high", clouds: "high",
  },
  ultra: {
    fpsCap: 0, resScale: "auto", maxDpr: 2, shadows: "ultra", terrain: "ultra",
    trees: "ultra", grass: "ultra", bloom: true, reflections: "high", clouds: "ultra",
  },
};

/** What each named level means to the systems that consume it. */
export const LEVELS = {
  shadows: { off: 0, low: 1024, high: 2048, ultra: 4096 },
  trees: {
    low:    { near: 170, far: 1400 },
    medium: { near: 300, far: 2200 },
    high:   { near: 420, far: 2600 },
    ultra:  { near: 650, far: 3600 },
  },
  reflections: { low: 4, medium: 2, high: 1 },
  // Bounds the frame-rate governor may move the render scale between.
  autoScale: {
    low: [0.5, 0.85], medium: [0.6, 0.92], high: [0.7, 1.0], ultra: [0.8, 1.0], custom: [0.6, 1.0],
  },
};

const TIER = (() => { try { return detectTier(); } catch { return "medium"; } })();

// Photoreal is not part of any preset: it is a change of look, not of cost
// level, and picking "High" should not quietly switch it off.
const DEFAULTS = { preset: "auto", showFps: false, photoreal: false, ...PRESETS[TIER] };

let state = { ...DEFAULTS };
try {
  const raw = JSON.parse(localStorage.getItem(STORE) || "null");
  if (raw && typeof raw === "object") state = { ...DEFAULTS, ...raw };
} catch { /* private mode, or junk in storage — defaults it is */ }
// Grass was On/Off before it had levels.
if (state.grass === true) state.grass = "medium";
else if (state.grass === false) state.grass = "off";
// "Auto" is re-resolved every launch, so a save made on one machine does not
// carry a laptop's settings onto a desktop or the other way round.
if (state.preset === "auto") Object.assign(state, PRESETS[TIER]);

const listeners = new Set();
function save(changed) {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* full or blocked */ }
  for (const fn of listeners) fn(state, changed);
}

export const graphics = {
  /** The tier the machine was detected as. */
  tier: TIER,
  get state() { return { ...state }; },
  get(key) { return state[key]; },

  /** The preset the current values came from — "auto" resolves to its tier. */
  presetBase() { return state.preset === "auto" ? TIER : state.preset; },

  setPreset(name) {
    const p = name === "auto" ? PRESETS[TIER] : PRESETS[name];
    if (!p) return;
    Object.assign(state, p, { preset: name });
    save(Object.keys(p));
  },

  /** One option. Anything but the FPS readout makes the preset Custom. */
  set(key, value) {
    if (state[key] === value) return;
    state[key] = value;
    if (key !== "showFps" && key !== "fpsCap" && key !== "photoreal") state.preset = "custom";
    save([key]);
  },

  /**
   * Photoreal on also brings everything it leans on up to where it can be
   * seen: real shadows, the fine terrain, the full forest, volume clouds. It
   * never turns anything DOWN, and turning it off leaves the rest alone.
   */
  setPhotoreal(on) {
    const changed = ["photoreal"];
    state.photoreal = !!on;
    if (on) {
      const raise = (key, order, min) => {
        if (order.indexOf(state[key]) < order.indexOf(min)) { state[key] = min; changed.push(key); }
      };
      raise("shadows", ["off", "low", "high", "ultra"], "ultra");
      raise("terrain", ["low", "medium", "high", "ultra"], "ultra");
      raise("trees", ["low", "medium", "high", "ultra"], "high");
      raise("clouds", ["low", "medium", "high", "ultra"], "high");
      raise("reflections", ["low", "medium", "high"], "high");
      raise("grass", ["off", "low", "medium", "ultra"], "medium");
      if (!state.bloom) { state.bloom = true; changed.push("bloom"); }
      if (changed.length > 1) { state.preset = "custom"; changed.push("preset"); }
    }
    save(changed);
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** [min, max] render scale for the governor under the current preset. */
  scaleBounds() {
    return LEVELS.autoScale[state.preset === "auto" ? TIER : state.preset] || LEVELS.autoScale.custom;
  },
};

// ---------------------------------------------------------------------------
// Menu rows. Same shape as settings.js's — { id, glyph, label, hint, value,
// cycle } — plus `section`, which is how the menus group them.
// ---------------------------------------------------------------------------

function step(key, values, names, hintFn) {
  return {
    value: () => names[Math.max(0, values.indexOf(state[key]))] ?? String(state[key]),
    cycle: (dir = 1) => {
      const i = values.indexOf(state[key]);
      graphics.set(key, values[((i < 0 ? 0 : i) + dir + values.length) % values.length]);
    },
    hint: hintFn,
  };
}

const PRESET_IDS = ["auto", "low", "medium", "high", "ultra"];
const PRESET_NAMES = { auto: "Auto", low: "Low", medium: "Medium", high: "High", ultra: "Ultra", custom: "Custom" };
const LMH = ["low", "medium", "high"];
const LMHU = ["low", "medium", "high", "ultra"];
const NAMES4 = ["Low", "Medium", "High", "Ultra"];

export const GRAPHICS_OPTIONS = [
  {
    id: "photoreal", section: "Graphics", glyph: "&#9672;", label: "Photoreal",
    value: () => (state.photoreal ? "On" : "Off"),
    cycle: () => graphics.setPhotoreal(!state.photoreal),
    hint: () => state.photoreal
      ? "Mountains cast real shadows, valleys fill with sky light, haze settles low, the slopes are eroded. Heavy — wants a strong GPU"
      : "Live-action look: real terrain shadows and sky light, aerial haze, eroded slopes, a camera grade. Raises shadows, terrain and forest with it",
  },
  {
    id: "gfxPreset", section: "Graphics", glyph: "&#9673;", label: "Quality preset",
    hint: () => state.preset === "auto"
      ? `Picked for this machine — it looks like a ${PRESET_NAMES[TIER].toLowerCase()} one`
      : state.preset === "custom" ? "Your own mix. Pick a preset to start again from one"
      : "Sets everything below at once. Change any of them to fine-tune",
    value: () => state.preset === "auto"
      ? `Auto (${PRESET_NAMES[TIER]})` : PRESET_NAMES[state.preset] ?? state.preset,
    cycle: (dir = 1) => {
      const cur = PRESET_IDS.indexOf(state.preset);
      const i = cur < 0 ? (dir > 0 ? 0 : PRESET_IDS.length - 1)
        : (cur + dir + PRESET_IDS.length) % PRESET_IDS.length;
      graphics.setPreset(PRESET_IDS[i]);
    },
  },
  {
    id: "fpsCap", section: "Graphics", glyph: "&#9201;", label: "Frame rate limit",
    ...step("fpsCap", [30, 60, 0], ["30 fps", "60 fps", "Unlimited"],
      () => state.fpsCap === 30
        ? "Steadier on weak machines, and easier on a laptop battery"
        : state.fpsCap === 60 ? "Smooth on most displays"
        : "As fast as your display refreshes — 120 Hz and up"),
  },
  {
    id: "resScale", section: "Graphics", glyph: "&#9638;", label: "Render resolution",
    ...step("resScale", ["auto", 0.5, 0.67, 0.75, 0.85, 1],
      ["Auto", "50%", "67%", "75%", "85%", "100%"],
      () => state.resScale === "auto"
        ? "Drops resolution for a moment when the frame rate dips, then climbs back"
        : "Fixed. Lower is faster and softer"),
  },
  {
    id: "shadows", section: "Graphics", glyph: "&#9681;", label: "Shadows",
    ...step("shadows", ["off", ...LMHU.filter((l) => l !== "medium")], ["Off", "Low", "High", "Ultra"],
      () => state.shadows === "off" ? "The biggest single saving on a weak GPU" : "Sharper shadows cost more memory"),
  },
  {
    id: "terrain", section: "Graphics", glyph: "&#9650;", label: "Terrain detail",
    ...step("terrain", LMHU, NAMES4,
      () => state.terrain === "low"
        ? "One coarse mesh for the whole archipelago. Fastest"
        : "Finer ground streamed in around you as you fly"),
  },
  {
    id: "trees", section: "Graphics", glyph: "&#8607;", label: "Forest draw distance",
    ...step("trees", LMHU, NAMES4, () => "How far out full trees are drawn, and how far the forest goes"),
  },
  {
    id: "grass", section: "Graphics", glyph: "&#8270;", label: "Grass",
    ...step("grass", ["off", "low", "medium", "ultra"], ["Off", "Low", "Medium", "Ultra"],
      () => ({
        off: "No grass. The ground texture carries it",
        low: "Grass underfoot, close round you when you land or fly low",
        medium: "Thicker grass underfoot, and on the meadows out to 400 m",
        ultra: "Grass on every meadow out to three kilometres. Heavy",
      })[state.grass] ?? ""),
  },
  {
    id: "reflections", section: "Graphics", glyph: "&#8776;", label: "Water reflections",
    ...step("reflections", LMH, ["Low", "Medium", "High"],
      () => "How often the sea redraws its mirror"),
  },
  {
    id: "clouds", section: "Graphics", glyph: "&#9729;", label: "Clouds",
    ...step("clouds", LMHU, NAMES4, () => state.clouds === "low"
      ? "Painted on the sky. Cheapest — you cannot fly into them"
      : "Real volume you can fly into and through. Higher is sharper and costs more"),
  },
  {
    id: "bloom", section: "Graphics", glyph: "&#10035;", label: "Glow",
    value: () => (state.bloom ? "On" : "Off"),
    cycle: () => graphics.set("bloom", !state.bloom),
    hint: () => "The bloom around fire and plasma",
  },
  {
    id: "showFps", section: "Graphics", glyph: "#", label: "Show frame rate",
    value: () => (state.showFps ? "On" : "Off"),
    cycle: () => graphics.set("showFps", !state.showFps),
    hint: () => "A small counter in the corner",
  },
];
