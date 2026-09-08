// ---------------------------------------------------------------------------
// What it costs to fly into things.
//
// Until now nothing could hurt him, and that quietly undermined every other
// system: the height in a zoom climb was free, a 900 mph dive at a cliff face
// had the same outcome as levelling off, and the darkness at the compound was a
// score rather than a resource. A flight model with no consequence for arriving
// badly is a camera on rails.
//
// Three rules shape this, and they are all about not being annoying:
//
//   IT HAS TO BE HIS FAULT   Damage is the closing speed INTO a surface, not
//                            proximity to one. Skimming a ridge at 700 mph is
//                            the best thing in the game and must stay free.
//                            Flying at the rock face is what costs.
//
//   IT HAS TO BE READABLE    The bar hides itself when he is whole. A meter
//                            that sits at 100% forever teaches you to ignore
//                            it, and then it is not there when it matters.
//
//   IT HAS TO END            He is a dragon, not a fighter jet: he heals. Bad
//                            flying costs you the next thirty seconds, not the
//                            run. Going all the way down puts him on the
//                            ground for a few seconds rather than showing a
//                            game-over, because there is nowhere yet to send
//                            a player who has died and a hard stop with no
//                            checkpoint behind it is worse than none.
// ---------------------------------------------------------------------------

const MAX = 100;

// Below this the surface may as well not be there. 25 m/s is a fast landing;
// 30 is the speed the ground rig's own landing check allows, so anything a
// player can do deliberately on an approach is free.
const SAFE_CLOSING   = 26;    // m/s into a surface before it hurts at all
const LETHAL_CLOSING = 130;   // m/s that takes the whole bar in one hit
// Curve between the two. Squared was the obvious choice and it was wrong in the
// middle: flying into a cliff face at 123 mph came out at four percent, which
// is not what happens when a dragon hits a cliff at 123 mph. 1.5 keeps the
// bottom end forgiving — a firm landing is still free — while making an
// ordinary crash cost about a third of the bar and a bad one most of it.
const CLOSING_CURVE  = 1.5;
const WATER_MERCY    = 0.5;   // water hurts, but it is not rock

// A second of grace after a hit. Without it a scrape along a slope bills him
// once per frame and sixty frames of scraping is instant death — which is what
// happens if you write this as damage-per-frame and only test it by nosing
// gently into a hill.
const HIT_COOLDOWN   = 0.9;   // s

const REGEN_DELAY    = 6.0;   // s of not being hit before he starts mending
const REGEN_RATE     = 9.0;   // health per second after that
const DOWN_TIME      = 4.0;   // s on the ground when the bar empties
const DOWN_RECOVERY  = 0.45;  // ...and the fraction he gets back up with

export function setupHealth() {
  let value = MAX;
  let sinceHit = 999;
  let downed = 0;             // seconds left of being down
  let flash = 0;              // 0..1, drives the red pulse on the bar
  const listeners = [];

  // --- UI ------------------------------------------------------------------
  // Built here rather than in index.html for the same reason the aim reticle
  // is: it belongs to this system and nothing else ever shows it, so it cannot
  // get stranded visible by someone editing the markup.
  const root = document.createElement("div");
  root.id = "hp";
  root.innerHTML = `<div id="hp-bar"><i></i></div><div id="hp-note"></div>`;
  document.body.appendChild(root);
  const fill = root.querySelector("#hp-bar i");
  const note = root.querySelector("#hp-note");

  const api = {
    get max() { return MAX; },
    get value() { return value; },
    /** 0..1, for anything that wants to draw it. */
    get t() { return value / MAX; },
    get downed() { return downed > 0; },
    get hurt() { return value < MAX - 0.5; },

    /** Called with (amount, reason) every time something lands. */
    onHit(fn) { listeners.push(fn); },

    /**
     * @param {number} amount health
     * @param {string} reason for the HUD line and the console
     * @returns {number} what was actually taken — 0 while in the grace window,
     *   which callers use to decide whether to rumble or play a sound.
     */
    damage(amount, reason = "") {
      if (downed > 0 || sinceHit < HIT_COOLDOWN || amount <= 0) return 0;
      const dealt = Math.min(value, amount);
      value -= dealt;
      sinceHit = 0;
      flash = 1;
      note.textContent = reason;
      for (const fn of listeners) fn(dealt, reason);
      if (value <= 0) downed = DOWN_TIME;
      return dealt;
    },

    /**
     * Closing speed into a surface, turned into damage.
     *
     * The distinction that matters is between a surface he is travelling ALONG
     * and one he is travelling INTO, and the only thing that tells them apart
     * is the surface normal. Skimming a 45-degree slope at 300 m/s has a tiny
     * closing speed and costs nothing; flying at the same slope head-on has a
     * huge one. That is the whole model, and it is why this takes a normal
     * rather than just a speed.
     *
     * @param {number} vx @param {number} vy @param {number} vz  his velocity
     * @param {number} nx @param {number} ny @param {number} nz  surface normal
     * @param {boolean} water whether he hit the sea rather than rock
     */
    impact(vx, vy, vz, nx, ny, nz, water = false) {
      const closing = -(vx * nx + vy * ny + vz * nz);
      if (closing <= SAFE_CLOSING) return 0;
      const t = Math.min(1, (closing - SAFE_CLOSING) / (LETHAL_CLOSING - SAFE_CLOSING));
      const amount = MAX * Math.pow(t, CLOSING_CURVE) * (water ? WATER_MERCY : 1);
      return api.damage(amount, water
        ? `Hit the water at ${Math.round(closing)} m/s`
        : `Hit the rock at ${Math.round(closing)} m/s`);
    },

    heal(amount) { value = Math.min(MAX, value + amount); },
    /** Story hook: a night's rest, or the lab. */
    refill() { value = MAX; sinceHit = 999; downed = 0; },

    /** @param {number} dt REAL seconds — being hurt is not slowed by aiming. */
    update(dt) {
      sinceHit += dt;
      if (downed > 0) {
        downed -= dt;
        if (downed <= 0) { value = MAX * DOWN_RECOVERY; sinceHit = 0; }
      } else if (sinceHit > REGEN_DELAY && value < MAX) {
        value = Math.min(MAX, value + REGEN_RATE * dt);
      }
      flash = Math.max(0, flash - dt * 2.2);

      // Shown while hurt, while going down, and for a moment after mending, so
      // the last thing you see is the bar arriving back at full rather than it
      // vanishing mid-heal.
      const show = api.hurt || downed > 0 || flash > 0;
      root.style.opacity = show ? "1" : "0";
      fill.style.transform = `scaleX(${Math.max(0, value / MAX)})`;
      root.classList.toggle("hp-flash", flash > 0.35);
      root.classList.toggle("hp-low", value < MAX * 0.3);
      root.classList.toggle("hp-downed", downed > 0);
      if (downed > 0) note.textContent = "Down — he is getting his wind back";
      else if (!api.hurt) note.textContent = "";
    },
  };

  return api;
}
