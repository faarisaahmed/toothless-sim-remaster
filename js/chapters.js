import * as THREE from "three";
import { keyTag } from "./keymap.js";
import { music } from "./audio.js";

// ---------------------------------------------------------------------------
// MISSION 1 — "The Metal and the Dark"
//
// The buildable cut of STORY.md §7, as chapters the runner in game.js can play.
// Each one is an objective, somewhere to be, and a test. The rule from the
// bible holds throughout: if he could be doing it, he's doing it. There is
// exactly one line of text per beat and no narration anywhere.
//
// Verbs the flight sim gained for this:
//   R   interact — hold, near a thing
//   T   sleepfire — hold, and it costs. Its own key now: it used to be a HOLD
//       on the fire key and a tap was a plasma blast, which cost the blast a
//       quarter of a second it could not afford.
// ---------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Where everything is. Open water south-east of Berk, in the gap between Raven
 * Point and Changewing — off the drawn coastline but not off the corner of the
 * chart, where the marks were unreadable on top of each other.
 *
 * `stack` is on the plateau of the flat island world.js adds for it, found by
 * probing the height field rather than trusting the island's nominal centre —
 * the domain warp drags land up to 320 m away from where it is declared.
 *
 * Clustered on purpose. The second half of the mission bounces between these
 * three, and a two-kilometre commute between every beat is not tension, it is a
 * walk. Hollow Stack to Dragon Hunter Island is about 1.7 km; the shoal sits
 * between them. The island's own rim is 300-500 m of rock all the way round,
 * so the last part of that trip is a climb or a run at the channel.
 */
/** Deck height of Hollow Stack's plateau. Set by world.js's STORY_ISLE. */
export const STACK_Y = 102;

/** Deck height of the hunters' compound. main.js overwrites this once it has
 *  probed the caldera floor, because the floor is procedural and moves. */
export const RIG = { y: 50 };

export const SITES = {
  rig:   V(2450, 0, 2150),
  stack: V(1650, 0, 2600),
  fish:  V(2080, 0, 2320),
};

export function mission1(ctx) {
  const { game, player, world } = ctx;

  const near = (p, r) => game.flatDist(p) < r;

  return [
    // -----------------------------------------------------------------------
    {
      id: "leave",
      objective: "Leave Berk.",
      sub: "",
      // He spawns south of Berk on a northerly heading — i.e. pointed at it.
      // Without somewhere to aim, "leave" reads as "fly home", which is the
      // opposite of the scene.
      enter(g) { g.setWaypoint(V(2200, 220, 2800), "Out"); g.toast("Berk.", 1600); },
      done() { return game.flatDist(V(0, 0, -1100)) > 2800; },
      hold: 0.2,
    },

    // -----------------------------------------------------------------------
    {
      id: "beyond",
      objective: "Fly past the edge of the chart.",
      sub: "",
      enter(g) { g.setWaypoint(V(1900, 120, 1650), "Open water"); },
      done() { return game.flatDist(V(1900, 0, 1650)) < 1100; },
    },

    // -----------------------------------------------------------------------
    {
      id: "rig-find",
      objective: "Something is burning out there.",
      enter(g) { g.setWaypoint(SITES.rig.clone().setY(RIG.y + 90), "Lights"); },
      done() { return near(SITES.rig, 900); },
      async exit(g, c) {
        c.findSite?.("Dragon Hunter Island");
        // The reveal. A long slow slide across the deck from out over the water
        // — the one angle he could never fly, which is what a cutscene is for.
        const r = SITES.rig;
        // This shot was composed for a compound that no longer exists. It was
        // written as "a slide across the deck from out over the water", with
        // absolute heights (74, 40, 32) that assumed RIG.y was a hardcoded 50
        // and the rig was a platform standing in the sea.
        //
        // The compound is on the floor of Dragon Hunter Island's caldera now,
        // and main.js finds that floor procedurally. There is no water to be
        // out over: the old camera path ran through the south wall, where the
        // terrain is 340-420 m, so the entire reveal played from inside rock.
        //
        // Recomposed onto the floor itself. The caldera runs flat from about
        // 180 m north of the deck to just south of it and stays near 50 m
        // across that whole band, so the camera slides in low from the
        // north-west with the far wall rising behind the compound — which is a
        // better reveal than the original had, and one he genuinely cannot fly.
        await g.playCutscene({
          from: V(r.x - 190, RIG.y + 30, r.z - 150),
          to:   V(r.x + 95,  RIG.y + 12, r.z - 60),
          look: V(r.x,       RIG.y + 3,  r.z),
          seconds: 6.5,
          line: "Cages.",
        });
      },
      beat: 1800,
    },

    // -----------------------------------------------------------------------
    {
      id: "rig-recon",
      objective: "Get a look at it without being seen.",
      sub: "Glide in. Powered flight is loud.",
      enter(g) {
        g.setWaypoint(SITES.rig.clone().setY(RIG.y + 60), "The compound");
        // The beat where being heard is the whole mechanic gets the sparse bed.
        music.play("tension", { fade: 4 });
      },
      update(dt, g, c) {
        // Being seen is a function of how close he is and how fast he's beating.
        // A glide from height is silent; a climb over the deck is not (§2.6).
        const d = game.flatDist(SITES.rig);
        // speedT is a fraction of 750 mph, so cruise is about 0.14 — this is
        // "he has his foot in it", not "he is moving".
        const loud = c.getClimb() > 0.15 || c.getSpeedT() > 0.30;
        if (d < 420 && loud) this._heat = (this._heat || 0) + dt;
        else this._heat = Math.max(0, (this._heat || 0) - dt * 0.6);
        if (this._heat > 2.2 && !this._warned) {
          this._warned = true;
          g.toast("Seen.", 1200);
          this._heat = 0;
          this._warned = false;
        }
        if (d < 420) this._seen = (this._seen || 0) + dt;
      },
      done() { return (this._seen || 0) > 6; },
      exit() { player.flag("sawTheRig"); music.play("flight", { fade: 5 }); },
    },

    // -----------------------------------------------------------------------
    {
      id: "stack-find",
      objective: "Find somewhere to rest.",
      sub: "",
      enter(g) { g.setWaypoint(SITES.stack.clone().setY(STACK_Y), "A stack"); },
      done() { return near(SITES.stack, 260); },
      exit(g, c) { c.findSite?.("Hollow Stack"); player.flag("home"); g.toast("Hollow Stack.", 1800); },
    },

    // -----------------------------------------------------------------------
    {
      id: "lab",
      objective: "Find out what the metal is.",
      get sub() { return `Hold ${keyTag("landUse")} at the shelf.${labProgress(player)}`; },
      enter(g, c) {
        player.addSample("alloy", "Hunter's plate");
        c.setInteract(SITES.stack.clone().add(V(6, 0, -4)), "Test the plate", 190);
      },
      update(dt, g, c) {
        if (!c.tookInteract()) return;
        // Every attempt is a real one and every one is recorded. The wall keeps
        // the failures — that IS the journal (§2.3).
        const tries = player.state.samples[0]?.results.length || 0;
        const line = LAB_LINES[Math.min(tries, LAB_LINES.length - 1)];
        player.record("alloy", { fire: line.fire, condition: line.cond, result: line.result });
        g.toast(line.show, 2600);
        // Re-say the objective, which is what puts the new attempt count on
        // screen. Without it the panel reads exactly the same after the fifth
        // try as after the first, so five different results land as one result
        // repeated and the beat reads as a bug — you are meant to feel him
        // getting nowhere, not to wonder whether the button is working.
        g.setObjective(this.objective, this.sub);
        g.refreshState();
      },
      done() { return (player.state.samples[0]?.results.length || 0) >= LAB_LINES.length; },
      exit(g, c) { c.setInteract(null); player.flag("labDone"); },
    },

    // -----------------------------------------------------------------------
    {
      id: "sleep",
      objective: "Sleep.",
      get sub() { return `Hold ${keyTag("landUse")} at the shelter.`; },
      enter(g, c) { c.setInteract(SITES.stack.clone(), "Sleep", 190); },
      update(dt, g, c) { if (c.tookInteract()) this._slept = true; },
      done() { return this._slept; },
      async exit(g, c) {
        c.setInteract(null);
        await g.fade(true);
        player.sleep({ beside: null });
        player.learnKey("nightfury");
        player.record("alloy", { fire: "sleepfire", condition: "asleep", result: "through" });
        await g.fade(false);
        // The wake. Push in on the shelf — what happened is done *to* him,
        // which is the only thing §5 allows a cutscene to show.
        const k = SITES.stack;
        await g.playCutscene({
          from: V(k.x + 26, STACK_Y + 16, k.z + 22),
          to:   V(k.x + 9, STACK_Y + 3.2, k.z - 1),
          look: V(k.x + 6, STACK_Y + 1.0, k.z - 4),
          seconds: 5.5,
          line: "A hole in the plate.",
        });
        g.refreshState();
      },
    },

    // -----------------------------------------------------------------------
    {
      id: "fire",
      objective: "Do it awake.",
      get sub() { return `Hold ${keyTag("sleepfire")}.`; },
      enter(g) { g.setWaypoint(null); },
      update(dt, g, c) { if (player.lastFired > 0) this._did = true; },
      done() { return this._did; },
      exit(g) {

        player.flag("canFire");
      },
    },

    // -----------------------------------------------------------------------
    {
      id: "hunt",
      objective: "Eat.",
      get sub() { return `Hold ${keyTag("landUse")} at the shoal.`; },
      enter(g, c) {
        g.setWaypoint(SITES.fish.clone().setY(6), "Shoal");
        c.setInteract(SITES.fish.clone(), "Fish", 150);
      },
      update(dt, g, c) {
        if (game.flatDist(SITES.fish) < 400) c.findSite?.("Shoal");
        if (c.tookInteract()) { player.eat(2); g.refreshState(); this._ate = true; }
      },
      done() { return this._ate && player.food === "fed"; },
      exit(g, c) { c.setInteract(null); },
    },

    // -----------------------------------------------------------------------
    {
      id: "raid",
      objective: "Put the lights out. Then open every cage.",
      get sub() { return `Fly low over a brazier to snuff it. ` +
        `Hold ${keyTag("sleepfire")} to burn a lock.`; },
      enter(g, c) {
        c.setNight(true);
        g.setWaypoint(SITES.rig.clone().setY(RIG.y + 60), "The compound");
        c.rig?.braziers.forEach((b) => b.relight());
      },
      update(dt, g, c) {
        const rig = c.rig;
        if (!rig) return;

        // Wing-gust: a hard downstroke close over a brazier snuffs it. No
        // button — it is a thing you do by flying, which is the point.
        const p = c.getPosition();
        for (const b of rig.braziers) {
          if (!b.lit) continue;
          if (p.distanceTo(b.pos) < 62 && c.getSpeedT() > 0.25) {
            b.snuff();
            g.toast("Dark.", 700);
          }
        }

        // Sleepfire opens a lock, and only in the dark — a lit deck means
        // somebody is standing next to the cage.
        if (player.lastFired > (this._seenFire || -1)) {
          this._seenFire = player.lastFired;
          const cage = rig.cages
            .filter((x) => !x.open)
            .sort((a, b) => p.distanceTo(a.pos) - p.distanceTo(b.pos))[0];
          if (cage && p.distanceTo(cage.pos) < 150) {
            cage.release();
            g.toast("Open.", 900);
          }
        }
        g.setObjective(
          "Put the lights out. Then open every cage.",
          `${rig.braziers.filter((b) => !b.lit).length} of ${rig.braziers.length} dark · ` +
          `${rig.cages.filter((x) => x.open).length} of ${rig.cages.length} open`
        );
      },
      done(g, c) {
        const rig = c.rig;
        return rig && rig.cages.every((x) => x.open);
      },
      exit(g) { player.flag("raidDone"); },
    },

    // -----------------------------------------------------------------------
    {
      id: "after",
      objective: "Go home.",
      sub: "",
      enter(g, c) {
        c.setNight(false);
        g.setWaypoint(SITES.stack.clone().setY(STACK_Y), "Hollow Stack");
      },
      done() { return near(SITES.stack, 260); },
      async exit(g) {
        // Pull up and away, and leave him on it.
        const k = SITES.stack;
        await g.playCutscene({
          from: V(k.x + 30, STACK_Y + 14, k.z + 34),
          to:   V(k.x + 150, STACK_Y + 180, k.z + 240),
          look: V(k.x, STACK_Y, k.z),
          seconds: 8,
          line: "End of mission one.",
        });
        await g.fade(true);
      },
    },
  ];
}

// The lab, as a fixed sequence of five real attempts. The fourth is the
// tempting wrong answer: it *looks* like progress and it plateaus, which is why
// the discovery has to come from sleeping rather than from trying harder.
/**
 * " · attempt 2 of 5", or nothing before the first try.
 *
 * The lab is five scripted failures in a row and the script is the point, but
 * the player needs to be able to tell that the count is going up. This is the
 * smallest thing that does it without narrating the outcome.
 *
 * Takes `player` rather than closing over it: everything else in this file that
 * touches player state lives inside mission1(), where it is destructured from
 * the context, and a module-level helper reaching for that name compiles fine
 * and throws the first time a chapter asks for its subtitle.
 */
function labProgress(player) {
  const done = player.state.samples[0]?.results.length || 0;
  if (!done) return "";
  if (done >= LAB_LINES.length) return " &nbsp;·&nbsp; enough";
  return ` &nbsp;·&nbsp; attempt ${done + 1} of ${LAB_LINES.length}`;
}

const LAB_LINES = [
  { fire: "plasma", cond: "cold", result: "nothing",
    show: "<span style='font-size:.55em;letter-spacing:.2em'>NOTHING</span>" },
  { fire: "plasma", cond: "soaked", result: "nothing",
    show: "<span style='font-size:.55em;letter-spacing:.2em'>NOTHING. WET NOTHING</span>" },
  { fire: "smoulder", cond: "sustained", result: "warm",
    show: "<span style='font-size:.55em;letter-spacing:.2em'>WARM. THAT IS ALL</span>" },
  { fire: "plasma", cond: "pre-heated", result: "dented",
    show: "<span style='font-size:.55em;letter-spacing:.2em'>A DENT.</span><br>" +
          "<span style='font-size:.42em;letter-spacing:.24em;color:#9a9384'>THIS IS THE ONE THAT LOOKS LIKE PROGRESS</span>" },
  { fire: "plasma", cond: "repeated", result: "same dent",
    show: "<span style='font-size:.55em;letter-spacing:.2em'>THE SAME DENT</span>" },
];

export { LAB_LINES };
