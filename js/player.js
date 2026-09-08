import * as THREE from "three";

// ---------------------------------------------------------------------------
// What Toothless is carrying.
//
// Per STORY.md §2.5 this is deliberately not a survival sim. Three coarse
// states, and their only job is to gate sleepfire — the hunger bar IS the
// ammunition counter, and it exists so that the answer to "can I burn through
// that" is sometimes no.
//
// Everything here is plain data so a save is JSON.stringify and nothing more.
// ---------------------------------------------------------------------------

export const FED = "fed", THIN = "thin", EMPTY = "empty";

// Sleepfire is not a breath. It comes from lower down, it hurts, and it is held
// rather than pressed (§2.2). These are the two numbers that make it feel that
// way: a long wind-up you can abort, and a cost you have to have paid already.
export const CHARGE_TIME = 2.1;    // seconds of held input before it goes
export const FIRE_COST = 1;        // condition steps spent per shot

const FRESH = () => ({
  day: 1,
  food: FED,
  rested: true,

  // Sleepfire keys, by species. Yours is the only one you start with, and only
  // after the lab — see §2.2. Everything else is somebody you slept next to.
  keys: { nightfury: false },

  // Samples on the lab wall. Each is { id, label, results: [...] }.
  samples: [],
  // Marks scratched on the wall that aren't test results — the debts.
  marks: [],

  // Story flags. Set by chapters, read by anything.
  flags: {},

  // Where he last slept. Sleep is the save.
  home: null,
});

export function createState() { return FRESH(); }

/** Wrap a plain state object in the verbs that change it. */
export function makePlayer(state = FRESH(), { onChange = () => {} } = {}) {
  const s = state;

  // Sleepfire charge, 0..1, rebuilt every time it is held.
  let charge = 0;
  let charging = false;
  let lastFired = -99;

  const api = {
    get state() { return s; },

    // --- food and rest ----------------------------------------------------
    get food() { return s.food; },
    get rested() { return s.rested; },
    /** Fed -> Thin -> Empty. Returns the new state. */
    spendFood() {
      s.food = s.food === FED ? THIN : EMPTY;
      onChange(s);
      return s.food;
    },
    eat(n = 1) {
      for (let i = 0; i < n && s.food !== FED; i++) {
        s.food = s.food === EMPTY ? THIN : FED;
      }
      onChange(s);
      return s.food;
    },

    /** Sleep is the save, the day advance, and how species keys are acquired. */
    sleep({ beside = null } = {}) {
      s.day += 1;
      s.rested = true;
      if (beside && !s.keys[beside]) s.keys[beside] = true;
      onChange(s);
      return { day: s.day, gained: beside && s.keys[beside] ? beside : null };
    },

    // --- sleepfire ---------------------------------------------------------
    hasKey(species) { return !!s.keys[species]; },
    learnKey(species) { s.keys[species] = true; onChange(s); },

    /**
     * Can he do it at all right now? Returns null if yes, or a short reason.
     * The reason is shown to the player as a state, never as a tutorial.
     */
    fireBlocked() {
      if (!s.keys.nightfury) return "unlearned";
      if (s.food === EMPTY) return "empty";
      if (!s.rested) return "spent";
      return null;
    },

    /** Held input. Call every frame with whether the button is down. */
    updateCharge(dt, held, now = 0) {
      if (held && !api.fireBlocked()) {
        charging = true;
        charge = Math.min(1, charge + dt / CHARGE_TIME);
        if (charge >= 1) {
          charge = 0;
          charging = false;
          lastFired = now;
          // It costs, and it costs in advance — this is the whole reason the
          // hunger economy exists.
          api.spendFood();
          s.rested = false;
          onChange(s);
          return "fired";
        }
        return "charging";
      }
      if (charging && charge > 0) {
        // Let go early and it just drains. No punishment; aborting is allowed.
        charging = false;
      }
      charge = Math.max(0, charge - dt * 1.7);
      return charge > 0 ? "draining" : "idle";
    },
    get charge() { return charge; },
    get lastFired() { return lastFired; },

    // --- lab ---------------------------------------------------------------
    addSample(id, label) {
      if (s.samples.some((x) => x.id === id)) return false;
      s.samples.push({ id, label, results: [] });
      onChange(s);
      return true;
    },
    /** Record an experiment. Failures stay on the wall forever — that's §2.3. */
    record(sampleId, { fire, condition, result }) {
      const sample = s.samples.find((x) => x.id === sampleId);
      if (!sample) return false;
      const key = `${fire}/${condition}`;
      if (sample.results.some((r) => r.key === key)) return false;
      sample.results.push({ key, fire, condition, result });
      onChange(s);
      return true;
    },
    tried(sampleId, fire, condition) {
      const sample = s.samples.find((x) => x.id === sampleId);
      return !!sample?.results.some((r) => r.key === `${fire}/${condition}`);
    },

    mark(id, text) {
      if (s.marks.some((m) => m.id === id)) return;
      s.marks.push({ id, text, day: s.day });
      onChange(s);
    },
    clearMark(id) {
      const i = s.marks.findIndex((m) => m.id === id);
      if (i >= 0) { s.marks.splice(i, 1); onChange(s); }
    },

    // --- flags -------------------------------------------------------------
    flag(k, v = true) { s.flags[k] = v; onChange(s); },
    is(k) { return !!s.flags[k]; },
  };

  return api;
}

/** Colour for the food state, shared by every bit of UI that shows it. */
export function foodColour(food) {
  return food === FED ? "#8fd28a" : food === THIN ? "#e0b45c" : "#d97a63";
}

export const _v = new THREE.Vector3();  // scratch, so callers don't allocate
