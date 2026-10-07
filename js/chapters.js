import * as THREE from "three";
import { keyTag } from "./keymap.js";
import { music } from "./audio.js";
import { CHAPTER_LIST } from "./storyline.js";

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
  /** Sigrún's stack: a lonely rock by the shoal. main.js finds the flat top. */
  sigrun: V(2200, 0, 2000),
};

/** How close a sleepfire burst has to be to burn a cage's lock. */
const CAGE_BURN_R = 46;

// ---------------------------------------------------------------------------
// Chapters: how the beats below are grouped for the player.
//
// The names and the grouping live in storyline.js, which has no imports so the
// title screen can read it. What is here is what only the flight sim can know:
// where a replay of each chapter starts, and what the world has to look like at
// its start — a replay from the chapter menu starts with whatever an unbroken
// run would have had by then (the plate, the key, the meal), because the beats
// test for those and would otherwise wait forever.
// ---------------------------------------------------------------------------
const PLATE = (p) => p.addSample("alloy", "Hunter's plate");
const RUNTIME = {
  peacetime: { start: () => ({ pos: V(0, 300, 900), toward: V(0, 0, -1100) }) },
  wood: {
    start: () => ({ pos: V(SITES.camp.x + 900, 260, SITES.camp.z - 1400), toward: SITES.camp }),
  },
  pit: {
    start: () => ({ pos: V(SITES.camp.x, 240, SITES.camp.z), toward: SITES.rig }),
    prepare: (p) => { PLATE(p); p.flag("sawTheCamp"); },
    sites: ["The clearing"],
  },
  stack: {
    start: () => ({ pos: V(SITES.rig.x - 900, 260, SITES.rig.z - 800), toward: SITES.stack }),
    prepare: (p) => { PLATE(p); p.flag("sawTheRig"); },
    sites: ["The clearing", "Dragon Hunter Island"],
  },
  storm: {
    start: () => ({ pos: V(SITES.stack.x, STACK_Y + 120, SITES.stack.z), toward: SITES.fish }),
    prepare: (p) => {
      PLATE(p); p.learnKey("nightfury");
      p.flag("canFire"); p.state.food = "thin"; p.state.rested = false;
    },
    sites: ["The clearing", "Dragon Hunter Island", "Hollow Stack"],
  },
  plan: {
    start: () => ({ pos: V(SITES.sigrun.x, 200, SITES.sigrun.z), toward: SITES.rig }),
    prepare: (p) => { PLATE(p); p.learnKey("nightfury"); p.flag("canFire"); p.flag("metSigrun"); },
    sites: ["The clearing", "Dragon Hunter Island", "Hollow Stack", "Shoal", "The lonely stack"],
  },
  lights: {
    start: () => ({ pos: V(SITES.fish.x, 160, SITES.fish.z), toward: SITES.stack }),
    prepare: (p) => {
      PLATE(p); p.learnKey("nightfury"); p.flag("canFire"); p.flag("metSigrun");
      p.state.food = "fed";
    },
    sites: ["The clearing", "Dragon Hunter Island", "Hollow Stack", "Shoal", "The lonely stack"],
  },
  wings: {
    start: () => ({ pos: V(SITES.rig.x, RIG.y + 60, SITES.rig.z), toward: SITES.stack }),
    prepare: (p) => {
      PLATE(p); p.learnKey("nightfury"); p.flag("canFire"); p.flag("metSigrun");
      p.state.food = "thin";
    },
    sites: ["The clearing", "Dragon Hunter Island", "Hollow Stack", "Shoal", "The lonely stack"],
  },
  home: {
    start: () => ({ pos: V(SITES.rig.x, RIG.y + 260, SITES.rig.z), toward: SITES.stack }),
    prepare: (p) => { PLATE(p); p.learnKey("nightfury"); p.flag("raidDone"); p.flag("metSigrun"); },
    sites: ["The clearing", "Dragon Hunter Island", "Hollow Stack", "Shoal", "The lonely stack"],
  },
};

export const CHAPTERS = CHAPTER_LIST.map((c) => ({ ...c, ...RUNTIME[c.id] }));

/**
 * The sky for each beat: the hour it starts at and the weather it is in. The
 * mission is one long day and a night — a fair morning leaving Berk, fog past
 * the edge of the chart, the weather closing in over the hunters, rain on the
 * stack while he works and sleeps, a clean morning after, and a moonlit raid.
 * session.js rolls the sky round to each of these as the beat begins.
 * `hold` stops the clock: the raid is night for as long as it takes.
 */
export const BEAT_SKY = {
  "leave":      { time: 9.0,  weather: "fair" },
  "woods":      { time: 10.8, weather: "fair" },
  "camp":       { time: 11.6, weather: "fair" },
  "beyond":     { time: 15.5, weather: "fog" },
  "rig-find":   { time: 19.6, weather: "overcast" },
  "rig-look":   { time: 20.7, weather: "overcast", hold: true },
  "strike":     { time: 21.0, weather: "overcast", hold: true },
  "escape":     { time: 21.1, weather: "rain", hold: true },
  "stack-find": { time: 21.6, weather: "rain", hold: true },
  "lab":        { time: 8.0,  weather: "overcast" },
  "sleep":      { time: 20.5, weather: "storm" },
  "fire":       { time: 7.0,  weather: "clear" },
  "hunt":       { time: 8.2,  weather: "fair" },
  "cry":        { time: 9.4,  weather: "fair" },
  "approach":   { time: 9.8,  weather: "fair" },
  "feed":       { time: 10.2, weather: "fair" },
  "watch":      { time: 17.8, weather: "clear" },
  "recon":      { time: 20.3, weather: "overcast", hold: true },
  "dusk":       { time: 20.6, weather: "fair" },
  "raid":       { time: 23.2, weather: "fair", hold: true },
  "choice":     { time: 23.4, weather: "fair", hold: true },
  "caught":     { time: 23.4, weather: "fair", hold: true },
  "cage":       { time: 23.5, weather: "overcast", hold: true },
  "rescue":     { time: 23.6, weather: "overcast", hold: true },
  "last-cages": { time: 23.7, weather: "overcast", hold: true },
  "flee":       { time: 23.9, weather: "fair", hold: true },
  "after":      { time: 5.7,  weather: "clear" },
};

/** The chapter a beat belongs to. */
export function chapterOf(beatId) {
  return CHAPTERS.find((c) => c.beats.includes(beatId)) || null;
}

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
    // THE PIT (STORY.md Scene 5). He hears it before he sees it: furnace glow
    // on the cloud. A spiral of torches round a hole in an island, and in the
    // bottom of the hole, cages.
    {
      id: "rig-find",
      objective: "Something is burning out there.",
      sub: "Follow the glow.",
      enter(g) { g.setWaypoint(SITES.rig.clone().setY(RIG.y + 300), "Lights"); },
      done() { return near(SITES.rig, 1500); },
      async exit(g, c) {
        c.findSite?.("Dragon Hunter Island");
        const r = SITES.rig, L = c.rig?.layout;
        const R = L ? L.rimR : 600;
        // Over the rim and down into the coil of torches.
        await g.playCutscene({
          from: V(r.x - R * 1.2, RIG.y + 520, r.z - R * 0.9),
          to:   V(r.x - R * 0.35, RIG.y + 220, r.z - R * 0.25),
          look: V(r.x, RIG.y, r.z),
          seconds: 7,
          line: "Dragon Hunters.",
        });
      },
      beat: 900,
    },

    // -----------------------------------------------------------------------
    // Look — and learn what being seen means. The "?" and "!" over the men are
    // the whole tutorial.
    {
      id: "rig-look",
      objective: "Get a look at the cages.",
      sub: "Stay out of sight. Watch for <b>?</b> — and never be the <b>!</b>",
      enter(g) {
        g.setWaypoint(SITES.rig.clone().setY(RIG.y + 40), "The cages");
        music.play("tension", { fade: 4 });
        this._t = 0;
        // The way in that works, said once: the open sky over the pit is the
        // one place every tower is looking (terrain.js pitPaths).
        setTimeout(() => g.toast("Wooded gullies run down into the pit. Land outside the rim and go in on foot.", 4200), 2500);
      },
      update(dt, g, c) {
        const h = c.hunters;
        const d = game.flatDist(SITES.rig);
        if (h && h.alarm > 0) {
          this._t = 0;
          g.setObjective(this.objective, "They've seen you. Get into the trees and let them settle.");
          return;
        }
        if (d < 200) this._t += dt;
        g.setObjective(this.objective, this._t > 0
          ? `Hold there... ${Math.min(100, Math.round(this._t / 4 * 100))}%` : this.sub);
      },
      done() { return this._t > 4; },
      exit(g) { player.flag("sawTheCages"); g.toast("Dozens of them.", 1800); },
    },

    // -----------------------------------------------------------------------
    // The failure. The only thing he knows how to do, and it does nothing.
    {
      id: "strike",
      objective: "Break one open.",
      get sub() { return `Plasma blast a cage — ${keyTag("fire")}.`; },
      enter(g, c) {
        g.setWaypoint(SITES.rig.clone().setY(RIG.y + 10), "The cages");
        c.cageHits = 0;
        c.cagesShootable = true;
      },
      done(g, c) { return (c.cageHits || 0) > 0; },
      async exit(g, c) {
        c.cagesShootable = false;
        g.toast("Nothing. Not even a mark.", 2400);
        c.hunters?.raiseAlarm(c.getPosition());
        music.play("raid", { fade: 1.5 });
      },
      beat: 1600,
    },

    // -----------------------------------------------------------------------
    {
      id: "escape",
      objective: "Get out.",
      sub: "Out of the pit and away. Fly fast and low — and dodge.",
      enter(g, c) {
        player.addSample("alloy", "Hunter's plate");
        g.toast("A plate of it came away in his claws.", 2200);
        g.setWaypoint(SITES.stack.clone().setY(STACK_Y + 60), "Away");
        c.hunters?.raiseAlarm(c.getPosition());
      },
      update(dt, g, c) {
        const d = game.flatDist(SITES.rig);
        g.setObjective(this.objective, d < 1200
          ? `${this.sub} · ${Math.round(d)} m` : "Keep going.");
      },
      done() { return game.flatDist(SITES.rig) > 1900; },
      exit(g, c) { player.flag("sawTheRig"); c.hunters?.calm(); music.play("flight", { fade: 5 }); },
    },

    // -----------------------------------------------------------------------
    {
      id: "stack-find",
      objective: "Find somewhere to rest.",
      sub: "",
      enter(g) { g.setWaypoint(SITES.stack.clone().setY(STACK_Y), "A stack"); },
      done() { return near(SITES.stack, 260); },
      async exit(g, c) {
        c.findSite?.("Hollow Stack"); player.flag("home");
        g.toast("Hollow Stack.", 1800);
        // He sleeps where he lands, and wakes to the plate on the shelf.
        await new Promise((r) => setTimeout(r, 1600));
        await g.fade(true);
        c.sky?.setTime(8.0);
        await new Promise((r) => setTimeout(r, 700));
        await g.fade(false);
      },
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
    // THE STORMCUTTER (STORY.md Scene 11). A cry across the water while he is
    // eating. Not a hunter's victim — a storm broke her wing two weeks ago and
    // a dragon who cannot fly cannot fish. Nobody did this to her. That is
    // the point of her.
    {
      id: "cry",
      objective: "Something is crying.",
      sub: "Across the water. Find it.",
      enter(g, c) {
        c.npc?.atStack();
        g.toast("A cry, across the water.", 2400);
        // A marker, but not a name: he does not know what he will find.
        g.setWaypoint(SITES.sigrun.clone().setY(c.sigrunY + 40), "?");
      },
      done(g, c) { return near(SITES.sigrun, 420); },
      async exit(g, c) {
        c.findSite?.("The lonely stack");
        const k = c.npc?.sigrun?.pos || SITES.sigrun;
        await g.playCutscene({
          from: V(k.x + 70, k.y + 30, k.z + 60),
          to:   V(k.x + 32, k.y + 9, k.z + 26),
          look: V(k.x, k.y + 3, k.z),
          seconds: 6.5,
          line: "A Stormcutter. Grounded. One wing a storm broke.",
        });
      },
    },

    // -----------------------------------------------------------------------
    {
      id: "approach",
      objective: "Go carefully.",
      sub: "She doesn't know you. Come in slow and low, and land near her.",
      enter(g, c) {
        c.npc?.atStack();
        g.setWaypoint(SITES.sigrun.clone().setY(c.sigrunY + 20), "Her");
        this._spook = 0;
      },
      update(dt, g, c) {
        const d = game.flatDist(c.npc?.sigrun?.pos || SITES.sigrun);
        this._spook = Math.max(0, this._spook - dt);
        if (d < 170 && c.getSpeedT() > 0.3 && this._spook <= 0) {
          this._spook = 4;
          g.toast("She rears up. Too fast.", 1600);
        }
        g.setObjective(this.objective, this._spook > 0
          ? "Back off. Slower." : d < 90 && !c.isGrounded() ? "Now land. Gently." : this.sub);
      },
      done(g, c) {
        return c.isGrounded() && this._spook <= 0
          && game.flatDist(c.npc?.sigrun?.pos || SITES.sigrun) < 95;
      },
      exit(g, c) { player.flag("metSigrun"); g.toast("She watches him. The hatchling hides.", 2200); },
    },

    // -----------------------------------------------------------------------
    // Several trips. A chore, slightly, on purpose: he does it again and again
    // without being thanked.
    {
      id: "feed",
      objective: "They're starving.",
      sub: "Bring them fish from the shoal. Low and fast over it to catch one.",
      enter(g, c) {
        c.npc?.atStack();
        this._given = 0; this._carry = false; this._in = false;
        g.setWaypoint(SITES.fish.clone().setY(6), "Shoal");
      },
      update(dt, g, c) {
        const p = c.getPosition();
        const fd = game.flatDist(SITES.fish);
        const inRun = fd < 190 && p.y < 15 && c.getSpeedT() > 0.22;
        if (inRun && !this._in && !this._carry) {
          this._carry = true;
          g.toast("One in his jaws.", 1100);
          g.setWaypoint((c.npc?.sigrun?.pos || SITES.sigrun).clone().setY(c.sigrunY + 10), "Her");
        }
        this._in = inRun || (this._in && fd < 300);
        if (this._carry && game.flatDist(c.npc?.sigrun?.pos || SITES.sigrun) < 70
            && p.y < c.sigrunY + 45) {
          this._carry = false;
          this._given++;
          g.toast(this._given === 1 ? "She takes it. She doesn't thank him."
            : this._given === 2 ? "The hatchling eats first." : "Enough. For today.", 1800);
          if (this._given < 3) g.setWaypoint(SITES.fish.clone().setY(6), "Shoal");
          else g.setWaypoint(null);
        }
        g.setObjective(this.objective, `${this._carry ? "Take it to her." : this.sub} · ${this._given} of 3`);
      },
      done() { return this._given >= 3; },
    },

    // -----------------------------------------------------------------------
    // The night by her stack, where he finally sees from the outside what he
    // did from the inside: the hatchling purging in her sleep. Tiny. Harmless.
    // Three times a night. Adults do it hugely and privately, on their own
    // hide, and that is why he never knew.
    {
      id: "watch",
      objective: "Stay the night.",
      get sub() { return `Rest near them — hold ${keyTag("landUse")}.`; },
      enter(g, c) {
        c.npc?.atStack();
        const k = c.npc?.sigrun?.pos || SITES.sigrun;
        g.setWaypoint(k.clone().setY(c.sigrunY + 10), "Them");
        c.setInteract(k.clone(), "Rest near them", 140);
      },
      update(dt, g, c) { if (c.tookInteract()) this._slept = true; },
      done() { return this._slept; },
      async exit(g, c) {
        c.setInteract(null);
        await g.fade(true);
        c.sky?.setTime(23.4);
        await new Promise((r) => setTimeout(r, 800));
        await g.fade(false);
        const e = c.npc?.eyvi?.pos || SITES.sigrun;
        // Three puffs through the shot, the way the bible has it.
        for (const at of [1200, 2900, 4700]) {
          setTimeout(() => c.npc?.puff(), at);
        }
        await g.playCutscene({
          from: V(e.x + 16, e.y + 5, e.z + 13),
          to:   V(e.x + 8, e.y + 2.5, e.z + 7),
          look: V(e.x, e.y + 0.8, e.z),
          seconds: 6.5,
          line: "She does it in her sleep. Three times a night.",
        });
        player.flag("sawThePurge");
        await g.fade(true);
        player.sleep({ beside: null });
        c.sky?.setTime(19.8);
        await new Promise((r) => setTimeout(r, 900));
        await g.fade(false);
        g.toast("He leaves in the morning. She does not thank him.", 2600);
        g.refreshState();
      },
    },

    // -----------------------------------------------------------------------
    // THE PLAN (STORY.md Scene 12), as a recon: go back and learn the pit —
    // the towers, the cage ring, the dock — without being seen. What he cannot
    // know is the ship that comes in tonight.
    {
      id: "recon",
      objective: "Learn the pit.",
      sub: "Mark the towers, the cage ring and the dock — without being seen.",
      enter(g, c) {
        c.npc?.atStack();
        const m = c.rig?.marks;
        this._marks = m ? [
          { label: "the towers", at: m.towers, t: 0, done: false, r: 160 },
          { label: "the cage ring", at: m.cageRing, t: 0, done: false, r: 150 },
          { label: "the dock", at: m.dock, t: 0, done: false, r: 150 },
        ] : [];
        this._point(g);
      },
      _point(g) {
        const next = this._marks.find((x) => !x.done);
        g.setWaypoint(next ? next.at.clone().setY(next.at.y + 60) : null, next ? next.label : "");
      },
      update(dt, g, c) {
        const alarm = c.hunters?.alarm > 0;
        for (const m of this._marks) {
          if (m.done) continue;
          if (game.flatDist(m.at) < m.r && !alarm) m.t += dt;
          else m.t = Math.max(0, m.t - dt);
          if (m.t > 2.5) {
            m.done = true;
            g.toast(`Marked: ${m.label}.`, 1400);
            this._point(g);
          }
        }
        const n = this._marks.filter((x) => x.done).length;
        g.setObjective(this.objective, alarm
          ? "Seen — get into the dark and wait for them to settle."
          : `${this.sub} · ${n} of 3`);
      },
      done() { return this._marks.length && this._marks.every((x) => x.done); },
      async exit(g, c) {
        if (c.rig?.supply) c.rig.supply.visible = true;
        g.toast("A ship is coming in. There wasn't one before.", 2600);
        player.flag("plan");
      },
      beat: 2200,
    },

    // -----------------------------------------------------------------------
    // Dusk. The raid is a night beat and he has just spent his fire and filled
    // his stomach; this is the breath between, and it is where the rest comes
    // from that the raid will need.
    {
      id: "dusk",
      objective: "Wait for dark.",
      get sub() { return `Hold ${keyTag("landUse")} at the shelter on Hollow Stack.`; },
      enter(g, c) {
        c.npc?.atStack();
        g.setWaypoint(SITES.stack.clone().setY(STACK_Y), "Hollow Stack");
        c.setInteract(SITES.stack.clone(), "Rest until dark", 190);
      },
      update(dt, g, c) { if (c.tookInteract()) this._rested = true; },
      done() { return this._rested; },
      async exit(g, c) {
        c.setInteract(null);
        await g.fade(true);
        player.state.rested = true;
        c.setNight(true);
        await new Promise((r) => setTimeout(r, 900));
        await g.fade(false);
        g.refreshState();
      },
    },

    // -----------------------------------------------------------------------
    {
      id: "raid",
      objective: "Put the lights out. Then open every cage.",
      get sub() { return `Fly low over a brazier to snuff it. ` +
        `Hold ${keyTag("sleepfire")} to burn a lock.`; },
      enter(g, c) {
        c.setNight(true);
        c.hunters?.calm();
        player.flag("adrenaline");
        player.state.rested = true;
        g.refreshState();
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
        // One burst burns every lock close enough to feel it. It used to open
        // the single nearest cage, at a cost of food AND rest per shot, which
        // made eight cages eight shots on a stomach that holds two — the raid
        // could not be finished. Now a shot from low over a row takes the row.
        if (player.lastFired > (this._seenFire || -1)) {
          this._seenFire = player.lastFired;
          const near = rig.cages.filter((x) => !x.open && p.distanceTo(x.pos) < CAGE_BURN_R);
          if (near.length) {
            for (const c of near) c.release();
            g.toast(near.length > 1 ? `${near.length} open.` : "Open.", 1100);
          } else {
            g.toast("Too far. Get in among the cages.", 1600);
          }
        }

        // Out of fire? The shoal is between here and the stack, and a pass
        // over it feeds him the same as it did before nightfall.
        const fd = game.flatDist(SITES.fish);
        const inRun = fd < 190 && p.y < 15 && c.getSpeedT() > 0.22;
        if (inRun && !this._fishing && player.food !== "fed") {
          player.eat(1);
          g.toast("Fed.", 1000);
          g.refreshState();
        }
        this._fishing = inRun || (this._fishing && fd < 300);
        const hungry = player.food === "empty";
        g.setObjective(
          "Put the lights out. Then open every cage.",
          `${rig.braziers.filter((b) => !b.lit).length} of ${rig.braziers.length} dark · ` +
          `${rig.cages.filter((x) => x.open).length} of ${rig.cages.length} open` +
          (hungry ? " · <b>Empty — fish the shoal</b>" : "")
        );
        if (hungry && !this._pointedAtFish) {
          this._pointedAtFish = true;
          g.setWaypoint(SITES.fish.clone().setY(6), "Shoal");
        } else if (!hungry && this._pointedAtFish) {
          this._pointedAtFish = false;
          g.setWaypoint(SITES.rig.clone().setY(RIG.y + 60), "The compound");
        }
      },
      done(g, c) {
        const rig = c.rig;
        return rig && rig.cages.every((x) => x.open);
      },
      exit(g) { player.flag("raidDone"); player.flag("adrenaline", false); },
    },

    // -----------------------------------------------------------------------
    // THE CHOICE (STORY.md Scene 14). The supply ship's crew is awake and the
    // pit goes up. The way out is open, clean and marked. And behind him, on
    // the high terrace, one cage with a hatchling in it.
    {
      id: "choice",
      objective: "Get out. The channel is clear.",
      sub: "…a hatchling is still caged on the high terrace behind you.",
      enter(g, c) {
        c.hunters?.raiseAlarm(c.rig?.centre);
        g.toast("The ship's crew. The whole pit is awake.", 2400);
        const ex = c.rig?.marks.exit;
        if (ex) g.setWaypoint(ex.clone(), "Out");
        this._turned = false; this._freed = false;
        this._seen = player.lastFired;
      },
      update(dt, g, c) {
        const cage = c.rig?.hatchCage;
        if (!cage) { this._freed = true; return; }
        const p = c.getPosition();
        // Sleepfire on the cage frees it.
        if (player.lastFired > this._seen) {
          this._seen = player.lastFired;
          if (p.distanceTo(cage.pos) < CAGE_BURN_R) { cage.release(); this._freed = true; }
        }
        // Flying out anyway. Then he turns round, himself, the one time the
        // game overrides you — because that is who he is.
        const L = c.rig?.layout;
        if (!this._turned && L && game.flatDist(SITES.rig) > L.rimR + 320) {
          this._turned = true;
          (async () => {
            const k = c.getPosition();
            await g.playCutscene({
              from: V(k.x + 40, k.y + 12, k.z + 40), to: V(k.x + 20, k.y + 6, k.z + 20),
              look: k.clone(), seconds: 3.5, line: "He turns back.",
            });
            c.teleport(cage.pos.clone().add(V(0, 40, 0)), 0);
            g.setWaypoint(cage.pos.clone(), "The hatchling");
            g.setObjective("Open it.", `Hold ${keyTag("sleepfire")} close to the cage.`);
          })();
        }
      },
      done() { return this._freed; },
      exit(g) { g.toast("Out. Go —", 900); },
      hold: 0.1, beat: 600,
    },

    // -----------------------------------------------------------------------
    // And then he's caught: industrial equipment doing exactly what it was
    // built to do. No boss. Nets, weight, a cage.
    {
      id: "caught",
      objective: "",
      async enter(g, c) {
        const k = c.getPosition();
        await g.playCutscene({
          from: V(k.x - 30, k.y + 10, k.z - 30), to: V(k.x - 12, k.y + 4, k.z - 12),
          look: k.clone(), seconds: 3.2, line: "Nets.",
        });
        c.setCaged(true);
        this._ok = true;
      },
      done() { return this._ok; },
      beat: 300,
    },

    // -----------------------------------------------------------------------
    // THE CAGE (Scene 15). Not a cutscene: he is in it, and nothing works.
    // Let it go on slightly too long.
    {
      id: "cage",
      objective: "Get out.",
      get sub() { return `Bite the lock — hold ${keyTag("landUse")}.`; },
      enter(g, c) {
        c.setCaged(true);
        c.hunters?.calm();
        player.flag("adrenaline", false);
        this._tries = 0; this._t = 0;
        c.setInteract(c.rig?.prisonAt?.clone() || c.getPosition().clone(), "Bite the lock", 60);
        music.play("tension", { fade: 2 });
      },
      update(dt, g, c) {
        this._t += dt;
        if (c.tookInteract()) {
          this._tries++;
          g.toast(["It doesn't give.", "His teeth slide off it.", "Nothing. Alloy."][Math.min(2, this._tries - 1)], 1400);
        }
        if (this._tries >= 3) g.setObjective(this.objective, "Nothing works. Outside, a lantern goes out.");
      },
      done() { return this._tries >= 3 && this._t > 9 || this._t > 26; },
      exit(g, c) { c.setInteract(null); },
      beat: 800,
    },

    // -----------------------------------------------------------------------
    // SIGRÚN (Scene 16). The cage roof comes apart. Four wings — or here, the
    // biggest dragon he has seen in a year — and she does not look at him
    // kindly. She flew on a wing that isn't mended, and left her hatchling
    // alone on a rock to do it.
    {
      id: "rescue",
      objective: "",
      async enter(g, c) {
        const at = c.rig?.prisonAt || c.getPosition();
        c.npc?.flyIn(at.clone().add(V(0, 26, 0)));
        await g.playCutscene({
          from: V(at.x + 8, at.y + 3, at.z + 8), to: V(at.x + 5, at.y + 2.5, at.z + 5),
          look: V(at.x, at.y + 40, at.z), seconds: 4.5, line: "Four wings.",
        });
        if (c.rig?.prison) c.rig.prison.visible = false;
        c.setCaged(false);
        // No forced alarm: the men nearest the cage are the ones Sigrún just
        // scattered, and the rest notice on their own soon enough.
        c.hunters?.calm();
        g.toast("She tears the muzzle off. She is not gentle about it.", 2600);
        player.flag("adrenaline");
        player.state.rested = true;
        g.refreshState();
        music.play("raid", { fade: 2 });
        this._ok = true;
      },
      done() { return this._ok; },
      beat: 400,
    },

    // -----------------------------------------------------------------------
    // THE LAST CAGES (Scene 17). A two-hander now: she takes the ones he
    // can't, and guards who see her run.
    {
      id: "last-cages",
      objective: "Finish it — together.",
      get sub() { return `The cages on the terraces. Hold ${keyTag("sleepfire")} close to burn a lock; she'll take some.`; },
      enter(g, c) {
        this._seen = player.lastFired;
        this._next = 4;
        this._point(g, c);
      },
      _left(c) { return (c.rig?.terraceCages || []).filter((x) => !x.open); },
      _point(g, c) {
        const left = this._left(c);
        g.setWaypoint(left.length ? left[0].pos.clone().add(V(0, 20, 0)) : null, "Cages");
      },
      update(dt, g, c) {
        const p = c.getPosition();
        if (player.lastFired > this._seen) {
          this._seen = player.lastFired;
          let n = 0;
          for (const cage of this._left(c)) {
            if (p.distanceTo(cage.pos) < CAGE_BURN_R) { cage.release(); n++; }
          }
          if (n) { g.toast(n > 1 ? `${n} open.` : "Open.", 900); this._point(g, c); }
        }
        // She opens one every few seconds, wherever he isn't.
        this._next -= dt;
        if (this._next <= 0 && c.npc) {
          this._next = 7;
          const left = this._left(c).sort((a, b) => b.pos.distanceTo(p) - a.pos.distanceTo(p));
          const target = left[0];
          if (target) {
            c.npc.flyIn(target.pos.clone().add(V(0, 12, 0)), () => {
              if (target.release()) { g.toast("She tears one open.", 1100); this._point(g, c); }
            });
          }
        }
        // Out of fire? The shoal is still there.
        const hungry = player.food === "empty";
        const fd = game.flatDist(SITES.fish);
        const inRun = fd < 190 && p.y < 15 && c.getSpeedT() > 0.22;
        if (inRun && !this._fishing && player.food !== "fed") { player.eat(1); g.refreshState(); }
        this._fishing = inRun || (this._fishing && fd < 300);
        const n = (c.rig?.terraceCages || []).length;
        g.setObjective(this.objective, `${n - this._left(c).length} of ${n} open` +
          (hungry ? " · <b>Empty — fish the shoal, or let her</b>" : ""));
      },
      done(g, c) { return this._left(c).length === 0; },
      exit(g, c) { player.flag("raidDone"); },
    },

    // -----------------------------------------------------------------------
    // The rig doesn't burn — it stops. Forty dragons leave through the roof of
    // it, and nobody drowns.
    {
      id: "flee",
      objective: "Home.",
      sub: "Hollow Stack. She's coming too.",
      enter(g, c) {
        g.setWaypoint(SITES.stack.clone().setY(STACK_Y), "Hollow Stack");
        c.npc?.flyIn(SITES.stack.clone().add(V(40, STACK_Y + 30, 30)));
        player.flag("adrenaline", false);
        setTimeout(() => c.hunters?.calm(), 6000);
        music.play("flight", { fade: 4 });
      },
      done() { return near(SITES.stack, 300); },
    },

    // -----------------------------------------------------------------------
    {
      id: "after",
      objective: "Go home.",
      sub: "",
      enter(g, c) {
        c.setNight(false);
        c.npc?.atHollow();
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
          line: "One mark on the wall. There is a great deal of wall left.",
        });
        // The end of the chapter is the game's to show (game.js finish()),
        // not a fade left on forever over a world still running underneath.
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
