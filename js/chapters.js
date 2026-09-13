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

/** How wide the search over the clearing is, and how low he has to be in it.
 *  Sized off the opening on the ground rather than picked: terrain.js opens
 *  the wood to 96 m and lets it die back out to 168, so this covers the gap
 *  he is actually looking at. */
const SEARCH_R   = 220;
const SEARCH_AGL = 150;

/** The middle of Peaceable Country, straight out of terrain.js's island table.
 *  Both the waypoint the search starts on and the "which side of it" hint are
 *  measured from here, so they cannot end up describing different woods. */
const WOOD = V(1250, 210, 1500);

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
  /** The clearing in the wood on Peaceable Country. Overwritten by main.js
   *  from terrain.js's CLEARING, which sweeps the height field for it. */
  camp:  V(931, 0, 1545),
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
      // He spawns south of Berk on a northerly heading — i.e. pointed at it —
      // so "leave" needs somewhere to aim or it reads as "fly home", which is
      // the opposite of the scene. It aims at Peaceable Country, the last
      // island on Hiccup's chart in that direction. The old target was a bare
      // bearing into empty water 2.8 km out, and an objective that is only a
      // direction reads as the game not having decided yet.
      enter(g) {
        g.setWaypoint(SITES.camp.clone().setY(260), "Peaceable Country");
        g.toast("Berk.", 1600);
      },
      done() { return game.flatDist(V(0, 0, -1100)) > 2100; },
      hold: 0.2,
    },

    // -----------------------------------------------------------------------
    // The wood.
    //
    // This beat exists because the mission used to go straight from "leave
    // Berk" to "fly past the edge of the chart" to "something is burning out
    // there" — three waypoints in open water, and the player is told each one
    // rather than finding it. Nothing was ever searched for.
    //
    // So: the last island on the chart is a deep wood, there is a gap cut in
    // it, and the gap is not marked. Finding it means flying the wood low
    // enough and slow enough to see the ground, which is a thing you do with
    // the flight model rather than a ring you enter.
    {
      id: "woods",
      objective: "Something has been in the wood.",
      sub: "Fly it low. You are looking for a gap in the trees.",
      enter(g, c) {
        // The island, not the clearing. A waypoint on the clearing would hand
        // over the one thing this beat is about.
        g.setWaypoint(WOOD.clone(), "The wood");
        this._t = 0;
        this._hinted = false;
        this._marked = false;
        this._spot = 0;
      },
      update(dt, g, c) {
        const p = c.getPosition();
        const agl = p.y - world.getHeightAt(p.x, p.z);
        const d = game.flatDist(SITES.camp);
        this._t += dt;
        // Seen, not reached: 220 m out but under 150 m above the canopy. From
        // cruise altitude the clearing is a slightly paler patch among eighty
        // thousand trees and you will fly over it four times.
        //
        // The radius is the whole opening plus its dying margin (CLEARING_R is
        // 96 and the margin runs to 168), because the thing you are looking
        // for is that big on the ground — a trigger tighter than the gap
        // itself means flying straight across it and being told nothing.
        const over = d < SEARCH_R;
        if (over && agl < SEARCH_AGL) this._spot = (this._spot || 0) + dt;
        else this._spot = Math.max(0, (this._spot || 0) - dt * 0.5);

        // --- Say whether he is warm --------------------------------------
        //
        // This beat used to be silent. The waypoint sits on the middle of a
        // 620 m island and the trigger is 320 m away from it under a hundred
        // and fifty metres of air, and NOTHING on screen moved as you got
        // closer or as you came down — so a player who flew to the marker,
        // circled it and left had no way to tell the difference between "keep
        // looking" and "this is broken". It reads as broken. It is the same
        // rule the fishing pass already follows: say why it did not count.
        let why;
        if (over && agl >= SEARCH_AGL) why = "Lower. You are over it and above the trees.";
        else if (this._spot > 0) why = "Hold it. Keep the gap under you.";
        else if (d < 520) why = "Close. Something opened the wood near here.";
        else if (d < 1100) why = "Somewhere under this wood. Get down among the trees.";
        else why = this.sub;
        g.setObjective(this.objective, why);

        // --- And if he cannot find it, help -------------------------------
        //
        // Searching is the point of the beat, but a search with no floor under
        // it is just a place the mission stops. After half a minute of hunting
        // he gets told which side of the island; after a minute the clearing
        // goes on the marker and the beat becomes a flight. Losing the
        // discovery is a much smaller price than losing the player.
        if (!this._hinted && this._t > 30) {
          this._hinted = true;
          const dx = SITES.camp.x - WOOD.x, dz = SITES.camp.z - WOOD.z;
          const side = Math.abs(dx) > Math.abs(dz)
            ? (dx < 0 ? "west" : "east") : (dz < 0 ? "north" : "south");
          g.toast(`The ${side} side of the wood.`, 2400);
        }
        if (!this._marked && this._t > 60) {
          this._marked = true;
          g.setWaypoint(SITES.camp.clone().setY(
            world.getHeightAt(SITES.camp.x, SITES.camp.z) + 90), "The gap");
        }
      },
      done() { return (this._spot || 0) > 0.8; },
      exit(g, c) {
        c.findSite?.("The clearing");
        g.toast("A gap in the trees.", 2000);
      },
    },

    // -----------------------------------------------------------------------
    {
      id: "camp",
      objective: "Read it.",
      get sub() { return `Hold ${keyTag("landUse")} at the snare.`; },
      enter(g, c) {
        g.setWaypoint(SITES.camp.clone().setY(0), "The clearing");
        c.setInteract(SITES.camp.clone(), "Read the snare", 170);
        music.play("tension", { fade: 4 });
      },
      update(dt, g, c) { if (c.tookInteract()) this._read = true; },
      done() { return this._read; },
      async exit(g, c) {
        c.setInteract(null);
        player.addSample("alloy", "Hunter's plate");
        player.flag("sawTheCamp");
        // The one thing in the clearing that says where to go next: a furrow
        // running downhill, and nothing at the bottom of it. buildSnareCamp
        // read the bearing off the height field, so the shot follows the drag
        // the model actually laid rather than a direction typed in here.
        const b = c.camp?.bearing ?? 0;
        const k = SITES.camp;
        const gy = world.getHeightAt(k.x, k.z);
        const fx = Math.sin(b), fz = Math.cos(b);
        await g.playCutscene({
          from: V(k.x - fx * 40, gy + 26, k.z - fz * 40),
          to:   V(k.x + fx * 150, gy + 14, k.z + fz * 150),
          look: V(k.x + fx * 260, gy - 20, k.z + fz * 260),
          seconds: 6,
          line: "Dragged. Downhill, to the water.",
        });
        g.refreshState();
      },
      beat: 1200,
    },

    // -----------------------------------------------------------------------
    {
      id: "beyond",
      objective: "Follow it past the edge of the chart.",
      sub: "",
      // Aimed along the drag, and out. The old version of this beat sent him
      // to a fixed point in open water for no stated reason; this is the same
      // flight with a reason attached to it.
      enter(g, c) {
        const b = c.camp?.bearing ?? 0.9;
        const t = SITES.camp.clone().add(
          V(Math.sin(b) * 1500, 0, Math.cos(b) * 1500)).setY(140);
        this._t = t;
        g.setWaypoint(t, "Open water");
      },
      done() { return game.flatDist(this._t) < 700; },
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
      sub: "Glide in. Powered flight is loud \u2014 and they throw.",
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
    // The lab, as one sitting.
    //
    // This was five separate holds at the same shelf, and the five results are
    // the point — the fourth is the tempting wrong answer, it looks like
    // progress, and the fifth is the same dent, which is what makes the
    // discovery have to come from sleeping rather than from trying harder.
    //
    // But five presses of the same key at the same spot is not five beats, it
    // is one beat and four repeats, and the code here used to carry a comment
    // worrying that it would "read as a bug". It did. So it is one press now,
    // and what it buys is the whole sequence, one result after another: same
    // five failures on the wall, same plateau, no grind. The wall keeps the
    // failures — that IS the journal (§2.3).
    {
      id: "lab",
      objective: "Find out what the metal is.",
      get sub() { return `Hold ${keyTag("landUse")} at the shelf.`; },
      enter(g, c) {
        // The plate came off the snare in the clearing, so he already has it.
        c.setInteract(SITES.stack.clone().add(V(6, 0, -4)), "Test the plate", 190);
      },
      update(dt, g, c) {
        if (this._running || this._over) return;
        if (!c.tookInteract()) return;
        this._running = true;
        (async () => {
          for (let i = 0; i < LAB_LINES.length; i++) {
            const l = LAB_LINES[i];
            player.record("alloy", { fire: l.fire, condition: l.cond, result: l.result });
            g.toast(l.show, 1400);
            g.setObjective(this.objective,
              `${i + 1} of ${LAB_LINES.length} &nbsp;·&nbsp; ${l.fire}, ${l.cond}`);
            g.refreshState();
            await new Promise((r) => setTimeout(r, 1400));
          }
          this._over = true;
        })();
      },
      done() { return this._over; },
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
        player.sleep({ beside: null });      // and this is what makes him hungry
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
    // Eating, as flying.
    //
    // This used to be a third hold-the-key-at-a-waypoint beat, which for a
    // dragon fishing is the wrong verb twice over: he does not stop and press
    // something, he comes down the shoal at speed with his mouth open. So it
    // is a pass now — low, fast, over the fish — and it takes two of them,
    // because one of anything does not read as a technique.
    {
      id: "hunt",
      objective: "Eat.",
      sub: "Take them out of the water. Low and fast over the shoal.",
      enter(g, c) {
        g.setWaypoint(SITES.fish.clone().setY(6), "Shoal");
      },
      update(dt, g, c) {
        const p = c.getPosition();
        const d = game.flatDist(SITES.fish);
        if (d < 400) c.findSite?.("Shoal");
        // Over the fish, under fifteen metres, with his foot in it. The
        // hysteresis is what makes it a PASS: you have to leave the shoal and
        // come back round for the second one, rather than hovering in the
        // trigger and collecting both in the same second.
        const inRun = d < 190 && p.y < 15 && c.getSpeedT() > 0.22;
        if (inRun && !this._in) {
          this._in = true;
          this._passes = (this._passes || 0) + 1;
          player.eat(1);
          g.toast(this._passes >= 2 ? "Fed." : "One.", 1200);
          g.refreshState();
        }
        if (this._in && d > 300) this._in = false;
        // Say WHY a pass did not count. The same distinction game.js already
        // draws for landing: "here is the thing to do" and "here is why you
        // cannot do it yet" are different messages, and a beat that silently
        // refuses to tick is exactly the kind of thing that reads as broken.
        let why = this.sub;
        if (d < 190) {
          if (p.y >= 15) why = "Lower. You are flying over them, not through them.";
          else if (c.getSpeedT() <= 0.22) why = "Faster. You cannot pick them up at a glide.";
        }
        g.setObjective(this.objective,
          `${why} &nbsp;·&nbsp; ${this._passes || 0} of 2`);
      },
      done() { return (this._passes || 0) >= 2 && player.food === "fed"; },
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
        // Said out loud, once, at the top of the raid. The bolas are the only
        // thing in the game that throws back, and this is the first time he
        // meets them under fire — so the connection between the light on the
        // deck and the weight in the air gets stated rather than discovered at
        // the bottom of a caldera.
        g.toast("They can see you. Put the lights out.", 2600);
        // The fast Viking theme, and it holds for the whole raid — the flying
        // music in main.js is suppressed while a chapter has something to say.
        music.play("raid", { fade: 4 });
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
