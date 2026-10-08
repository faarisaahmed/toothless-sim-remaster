// ---------------------------------------------------------------------------
// What it costs to fly into things — and to be shot.
//
// With Settings → Game → Damage on (the default), he has a health bar, top
// left, and the things that would hurt a real dragon take it away:
//
//   ARROWS and BOLAS         a fixed bite each (hunters.js / bolas.js).
//   FLYING INTO THE GROUND   the closing speed INTO the surface, not nearness
//                            to it: skimming a ridge at 700 mph is free,
//                            diving into the floor is not. Into the ground
//                            from above (a dive) bites harder than the same
//                            speed into a wall, and a wall is usually met at
//                            far higher speed, so it bites hardest of all.
//   SCRAPING                 dragging along rock at speed wears him down.
//   THE SEA                  hurts, but half as much as rock.
//
// He mends on his own after a few seconds untouched. At zero he goes down:
// a game-over card, and Continue wakes him on the nearest island, healed,
// with the story exactly where it was. Nothing is lost but the trip back.
//
// The cause of the last death is remembered (localStorage) so the hints on
// the game-over card and the next loading screen can quietly be about it.
// ---------------------------------------------------------------------------

const MAX = 100;

const SAFE_CLOSING   = 26;    // m/s into a surface before it hurts at all
const LETHAL_CLOSING = 130;   // m/s that takes the whole bar in one hit
const CLOSING_CURVE  = 1.5;
const WATER_MERCY    = 0.5;   // water hurts, but it is not rock
const DIVE_BITE      = 1.25;  // into the ground from above
const HIT_COOLDOWN   = 0.9;   // s of grace after a hit, so one crash is one hit

const REGEN_DELAY    = 6.0;   // s of not being hit before he starts mending
const REGEN_RATE     = 7.0;   // health per second after that

export const DEATH_KEY = "nightalone.lastDeath";

const SVG_SCALE = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 L27 7 V15 C27 22 22 27 16 30 C10 27 5 22 5 15 V7 Z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 9 C19 12 21 14 21 17 C21 20 18.6 22 16 22 C13.4 22 11 20 11 17 C11 14 13 12 16 9 Z" fill="currentColor"/></svg>`;

/**
 * @param {object} o
 *   enabled()   whether damage is on (settings)
 */
export function setupHealth({ enabled = () => true } = {}) {
  let value = MAX;
  let ghost = MAX;            // the trailing bar: what he had a moment ago
  let sinceHit = 999;
  let dead = false;
  let flash = 0;
  let lastReason = "", lastCause = "";
  let scrapeT = 0;
  const hitFns = [], deathFns = [];

  // --- HUD -----------------------------------------------------------------
  const root = document.createElement("div");
  root.id = "hp";
  root.innerHTML = `
    <div class="hp-emblem">${SVG_SCALE}</div>
    <div class="hp-body">
      <div class="hp-head"><span class="hp-label">Health</span><span class="hp-num">100</span></div>
      <div class="hp-track"><i class="hp-ghost"></i><i class="hp-fill"></i><b class="hp-ticks"></b></div>
      <div class="hp-note"></div>
    </div>`;
  document.body.appendChild(root);
  const fill = root.querySelector(".hp-fill");
  const ghostEl = root.querySelector(".hp-ghost");
  const num = root.querySelector(".hp-num");
  const note = root.querySelector(".hp-note");
  let noteT = 0;

  const api = {
    get max() { return MAX; },
    get value() { return value; },
    get t() { return value / MAX; },
    get dead() { return dead; },
    /** Kept for older callers: "down" is dead now. */
    get downed() { return dead; },
    get hurt() { return value < MAX - 0.5; },
    get lastCause() { return lastCause; },
    get lastReason() { return lastReason; },

    /** fn(amount, reason, cause) every time something lands. */
    onHit(fn) { hitFns.push(fn); },
    /** fn(cause, reason) when he goes down. */
    onDeath(fn) { deathFns.push(fn); },

    /**
     * @param {number} amount   health
     * @param {string} reason   shown under the bar
     * @param {string} cause    a short category: arrow, bola, dive, wall,
     *                          scrape, water, ...
     */
    damage(amount, reason = "", cause = "hit", { grace = true } = {}) {
      if (!enabled() || dead || amount <= 0 || (grace && sinceHit < HIT_COOLDOWN)) return 0;
      const dealt = Math.min(value, amount);
      value -= dealt;
      sinceHit = 0;
      flash = 1;
      lastReason = reason; lastCause = cause;
      note.textContent = reason; noteT = 2.4;
      for (const fn of hitFns) fn(dealt, reason, cause);
      if (value <= 0.01) {
        value = 0;
        dead = true;
        try { localStorage.setItem(DEATH_KEY, JSON.stringify({ cause, reason, at: Date.now() })); } catch { /* fine */ }
        for (const fn of deathFns) fn(cause, reason);
      }
      return dealt;
    },

    /**
     * Closing speed into a surface, turned into damage.
     * @param {number} vx @param {number} vy @param {number} vz  his velocity
     * @param {number} nx @param {number} ny @param {number} nz  surface normal
     * @param {boolean} water whether he hit the sea rather than rock
     */
    impact(vx, vy, vz, nx, ny, nz, water = false) {
      const closing = -(vx * nx + vy * ny + vz * nz);
      if (closing <= SAFE_CLOSING) return 0;
      const t = Math.min(1, (closing - SAFE_CLOSING) / (LETHAL_CLOSING - SAFE_CLOSING));
      // Which way he hit it: down into flat ground is a dive, into a steep
      // face is a wall.
      const floor = ny > 0.75 && vy < 0;
      const mph = Math.round(closing * 2.237);
      const amount = MAX * Math.pow(t, CLOSING_CURVE) * (water ? WATER_MERCY : floor ? DIVE_BITE : 1);
      return api.damage(amount,
        water ? `Hit the water at ${mph} mph` : floor ? `Dived into the ground at ${mph} mph` : `Flew into the rock at ${mph} mph`,
        water ? "water" : floor ? "dive" : "wall");
    },

    /** A scrape along rock at `speed` m/s, for one frame of `dt`. */
    scrape(speed, dt) {
      if (speed < 45) { scrapeT = 0; return 0; }
      scrapeT += dt;
      if (scrapeT < 0.3) return 0;
      // Small and steady: a long drag along a cliff at full tilt adds up.
      const amount = (speed - 45) * 0.02 * scrapeT / 0.3;
      scrapeT = 0;
      return api.damage(amount, "Scraping along the rock", "scrape", { grace: false });
    },

    heal(amount) { value = Math.min(MAX, value + amount); },
    /** Full health and alive again: a night's rest, or waking after going down. */
    refill() { value = MAX; ghost = MAX; sinceHit = 999; dead = false; },

    /** @param {number} dt REAL seconds. */
    update(dt, { hudOn = true } = {}) {
      sinceHit += dt;
      if (!dead && sinceHit > REGEN_DELAY && value < MAX) value = Math.min(MAX, value + REGEN_RATE * dt);
      // The ghost holds for a beat after a hit, then drains down to the bar.
      if (ghost < value) ghost = value;
      else if (sinceHit > 0.6) ghost = Math.max(value, ghost - dt * 40);
      flash = Math.max(0, flash - dt * 2.4);
      noteT = Math.max(0, noteT - dt);

      const on = enabled() && hudOn;
      root.style.display = on ? "" : "none";
      if (!on) return;
      fill.style.transform = `scaleX(${value / MAX})`;
      ghostEl.style.transform = `scaleX(${ghost / MAX})`;
      num.textContent = Math.ceil(value);
      root.classList.toggle("flash", flash > 0.3);
      root.classList.toggle("low", value < MAX * 0.3 && !dead);
      root.classList.toggle("mending", !dead && value < MAX && sinceHit > REGEN_DELAY);
      root.classList.toggle("note-on", noteT > 0);
      root.style.setProperty("--hp", (value / MAX).toFixed(3));
    },
  };
  return api;
}
