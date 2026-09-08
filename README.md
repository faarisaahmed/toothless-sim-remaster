# dragon-flying-sim
A simulator to fly dragons

Serve it with `python3 tools/serve.py` and open <http://localhost:8000>. That is
the plain http.server plus `Cache-Control: no-store`, which matters more than it
sounds: without it Chrome will happily reuse an ES module from earlier in the
session, so you edit a file, reload, and are shown the old one with nothing to
tell you.

Loading the page drops you straight into the archipelago. The title screen and
the prologue are still there, they are just not in the way:

| URL | |
| --- | --- |
| `/` | the flight sim |
| `/?stage=title` | title, save slots, then the prologue on a new game |
| `/?stage=prologue` | the prologue on a scratch save |

## Controls

One key, one job. WASD and the arrow keys are the same two axes everywhere —
in the air they climb, dive and turn; on the ground they walk and turn.

Two keyboard schemes, and the rule is that one hand steers and the other acts.
Both are listed below as **wasd · arrows**; `js/keymap.js` is the live source
and the in-flight key panel redraws itself from it.

| wasd · arrows | DualSense | |
| --- | --- | --- |
| `W` `S` · `↑` `↓` | Left stick ↕ | Forward and back. Let go and he hovers |
| `A` `D` · `←` `→` | Left stick ↔ | Turn — hold to carve harder |
| `Space` · `Space` | `R2` | Up. On the ground, take off |
| `K` · `C` | `L2` | Down |
| `Shift` | — | Sprint — hold for his 400 mph |
| `J` · `V` (or `B`) | `✕` | Flat out — hold for 750 mph |
| right mouse, `E` | — | Aim — turns his head, not his body |
| `I` · `D` (or `R`) | — | Hold to land, and to use whatever you're near |
| `U` · `F`, left click | — | Plasma blast — fires the instant it goes down. Six shots, they come back |
| `Y` · `T` held | — | Sleepfire — it costs food and rest |
| `O` `P` · `A` `S` | `□` / `○` | Strafe sideways, heading unchanged |
| `L` `;` · `Z` `X` | `L1` / `R1` | Hold to knife edge onto a wingtip |
| Mouse | Right stick | Free look |
| `H` | D-pad ↑ | Swing his nose to face the camera |
| `Q` | D-pad ↓, `R3` | Swing the camera behind him at once |
| `Tab` | Touchpad | Chart of the archipelago |
| `G` | — | Terrain contour grid |
| `M` | — | Controller overlay |
| `/` | `Create` | Show or hide the key panel |
| `` ` `` | `Options` | Debug console |

This is the scheme every game with a flying mount uses, and it is deliberately
not clever. `W` moves him and never changes his altitude; `Space` changes his
altitude and never moves him. Let go of `W` and he stops in mid-air — that is
the hover, and there is no mode to enter or button to toggle. On a pad the left
stick is analog all the way from a standstill to the sprint, so the triggers are
free to be up and down.

`R` is the one context key and it means the same thing in every scene: use the
thing in front of you. Near a shelf it runs an experiment, near the shelter it
sleeps, in the air over land it lands, and in the prologue it looks at what he
is standing next to.

D-pad up points him at the camera and D-pad down brings the camera round to him
— the same job from either end. You rarely need either now: the camera trails in
behind him on its own about a second after you stop looking around, quickly when
he's fast and lazily when he's slow, so a carve no longer leaves you staring at
his flank. Anything you do with the mouse or the right stick parks that and
hands the camera back to you. Clouds and water stay console-only (`clouds`,
`water`).

Rumble is on by default. In the debug console, `rumble <0-1>` and `rumble off`
set the strength, `padsens <n>` and `padsens invert` tune the right stick, and
`pad` prints the connection state.

## How fast he is

The numbers are the franchise's rather than invented. DreamWorks publish the
Night Fury at 26 ft long and 45 ft across the wings — 7.9 m and 13.7 m — and the
GLB measures 8.6 × 15.1 at scale 1, so he flies at scale 1 and one world unit is
one metre, the same as the islands and the props. The *Book of Dragons* and an
HTTYD2 bonus feature both say a Night Fury outruns sound, 750 mph, and that is
what the burst is set to. Nothing else in the game reaches it.

| | | |
| --- | --- | --- |
| Nothing held | 0 m/s | hovering |
| `S` held | 9 m/s | 20 mph, backing off |
| `W` held | 55 m/s | 123 mph |
| `W` + `Shift` | 180 m/s | 403 mph |
| `B` | 335 m/s | **750 mph** — the canon top speed |

Two consequences worth knowing before you fly into a sea stack. His climb *rate*
rides on his airspeed even though the axis is separate, so four seconds of
`Space` gains 36 m at a hover and 135 m with `W` held — going up is cheap when
you are already fast. And the turn cap is a lateral-acceleration limit rather
than a constant rate, so his turning circle grows with speed the way a real one
does: he spins on the spot at a hover, carves a 38 m circle at cruise, needs
165 m at a sprint and most of a kilometre in a burst. A supersonic pass has to
be lined up, not steered.

`node tools/flightcheck.mjs` prints that whole table by running the real
`js/controls.js` outside the browser; the header comment says what to install
first. It also checks the thing that made all of this meaningless before: flight
used to move him a fixed distance per *frame* with no `dt` anywhere, so his top
speed was a property of your monitor and a 120 Hz panel flew twice as fast.

## Fire

Two things, two keys. They used to be one key told apart by how long you held
it — a tap was the blast, a hold was sleepfire — and that had to go, because a
tap is only a tap once the key comes back UP. Every blast arrived up to a
quarter of a second after it was asked for, and a key held down fired nothing at
all. The blast is the reflex action in this game; it cannot be the one input
that waits to see what you meant.

The **plasma blast** is his ordinary fire and it leaves on the way down, out of
his mouth — the head bone, four metres ahead of his origin — at 600 m/s plus
whatever he is already doing along that line, so a flat-out dive puts it out at
935. It goes down his NOSE rather than down the camera, which is what makes
aiming a matter of flying. Six shots, which is the number the franchise's own
stat card gives a Night Fury, and they come back one at a time.

It is a **small** thing: a 1.2 m core inside a 3.2 m glow, with a streak just
long enough to join up between frames. It was three times that, and the size was
doing the work the brightness should have — his shots are a tight violet knot
with a hard white centre, and what sells one is the contrast between something
very small and very hot and the dark it is crossing. The core sits well over the
bloom threshold and the halo sits under it, so the middle flares and the glow
stays a glow.

### Aiming down his nose

The shot leaves along the **head bone's own forward axis**, read off the skull
every time he fires, rather than being rebuilt from his heading and flight path.
That sounds like the worse of the two — a bone's local axes are the exporter's
business — but the rebuilt version was wrong in a way you could feel and not
name. `pathAngle` is where he is *going* and his nose is where he is *pointing*,
and those differ by his angle of attack: `controls.js` holds his nose up when he
is hanging on his wings and the flight rig leans the neck on top of that.
Measured over the real model, the nose sat **6.7° off the shot line in a hover,
0.4° at cruise and 6.0° flat out** — so the miss changed with the throttle, and
at cruise, where you would naturally test it, there was nothing wrong at all.

Reading the bone makes it zero at every speed. Which axis is the nose is
*measured* at bind time by trying all six against the direction the model faces
and keeping the closest, with a 45° sanity check and a fall back to the old
maths, so a re-rig gets a warning instead of a silently sideways dragon. The
cost is that his idle animation is now in the line of fire — 1.04° of wander in
a hover, 0.07° flat out. That is a dragon breathing.

The other half of it was simply **inverted**: `yaw` subtracted the mouse delta
where the camera added it, so pushing the mouse right swung his head left. It
survived as long as it did because everything downstream agreed with it — the
bones turned the way `yaw` said and the shot went where the bones went — so the
aiming system was self-consistently wrong and only a player could tell.

    node tools/aimcheck.mjs        drives the real rig: which way, and how far off

It fires **whatever he is doing**: standing, walking, mid-carve, halfway through
a sleepfire charge, out of aim stamina, upside down. The only thing that takes it
away is a cutscene, where the player does not have the controls anyway. Leaning
on the key is a burst of six and then an empty click, since the magazine, not
the trigger, is the limit.

### Firing while flat out

The acting hand is eight keys over four fingers — upper row and lower row — so
every finger carries two actions, and two actions on one finger are mutually
exclusive no matter what the code does:

|  | index | middle | ring | pinky |
| --- | --- | --- | --- | --- |
| upper row | **fire** | land / use | strafe left | strafe right |
| lower row | **flat out** | down | knife left | knife right |

Fire and flat out are both the index finger — `U` over `J` — so **`U` while
holding `J` does not fire, and cannot.** The key is never pressed; nothing
reaches the game. That is a nasty failure to debug from the outside, because a
key that does nothing looks exactly like a weapon that has stopped working, so
there are two ways round it and both are already wired:

* **Left click**, which is the intended one. The left hand holds `W` and `J`,
  the right hand is on the mouse, nothing is contended — which is the grip the
  wasd scheme exists for.
* **`B` instead of `J`** for flat out. `B` is a legacy alias that never went
  away, and it is on the *left* index, so `W` + `B` + `U` is three keys on two
  hands and works on the keyboard alone.

Laying the cluster out by finger instead — burst onto the ring, strafe and knife
edge shuffled around it — was tried and thrown out. It does free the finger, and
it moves three controls that were already in the hand.

    node tools/keycheck.mjs        every promised combination, finger by finger

A blast lights the ground it crosses and every guard on the deck turns around,
so on the approach to the compound the question is never "can I hit that" but
"can I afford to be seen doing it". It puts out braziers, which otherwise can
only be snuffed by a wing-gust on a low pass.

**Sleepfire** is unchanged and now has its own key: the long, uncomfortable,
expensive thing from STORY.md §2.2 that costs a meal and a night's rest and is
the only thing that opens a cage.

    node tools/plasmacheck.mjs      muzzle speed, carry, and what stops a bolt

## Dragon Hunter Island

The hunters' compound used to be a 60 m platform on pilings in open water. It is
now a compound on the floor of a drowned volcano: a rim 300–500 m high the whole
way round, one channel cut through the wall at sea level, and a flat floor
inside big enough to put a 116 × 92 m fort on and land a dragon next to it.

That last part is the point. The flight code will only set him down over land,
so a base at sea could never be walked around — and walking around it is most of
what it is for. The island is procedural like everything else, so nothing about
the compound's position is hardcoded: `main.js` sweeps the bowl at load, finds
the flattest patch that will take the deck, and puts the fort and the story
waypoint there together so the two can never drift apart.

## Music

Four ambient beds, one per kind of scene: the title, the prologue's one firelit
room, the open archipelago, and the one story beat where being heard is the
mechanic. They crossfade, they loop, and `M` mutes.

Browsers refuse to make a sound until the player has interacted with the page,
so the first track does not start on load — it starts on your first click or
keypress, which in practice is the click that captures the mouse.

In the debug console, `music` prints what is playing, `music <name>` switches to
it, `music vol <0-1>` sets the level and `music off` stops it. The level and the
mute survive a reload.

### Credits

Music by **[Kevin MacLeod](https://incompetech.com/)** — licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Free of charge and free of royalties; the licence's one condition is this
credit, so please keep it if you fork this.

| Track | Where |
| --- | --- |
| Lightless Dawn | Title screen |
| Folk Round | The prologue |
| Windswept | The archipelago |
| Long Note Two | The rig, and being seen |

The files in `assets/audio/music/` are re-encoded to 96 kbps to keep the repo
down from 47 MB to 14; the originals are at incompetech.com.

## Performance

The game holds a frame budget by watching two numbers, and both of them are easy
to blow without noticing.

**Point lights.** three.js forward-renders, so every visible `PointLight` is a
loop iteration in *every fragment shader on screen* — near the thing being drawn
or not. The compound briefly had sixteen braziers, eight cages and five guards
all carrying their own light, which is twenty-nine of them taxing every pixel of
terrain. It now shares **seven** pooled lights among the braziers by distance to
the camera (`makeLightPool` in `places.js`); the cage and guard orbs keep their
glowing cores, which are unlit geometry and free.

**Draw calls.** A modular kit is the right way to author a place and the wrong
way to render one — six hundred deck modules of three boxes each was ~1800 draw
calls for a floor that never moves. `mergeStatic()` flattens anything static
into one mesh per material, which took that to about three.

Type `` ` `` and run **`perf`** for draw calls, triangles, visible lights and
compiled programs.

The loading screen is not decoration. The thing that makes a WebGL page stutter
for its first seconds is shader compilation, which three.js does on the main
thread the first time each material is actually drawn — so the frame that first
reveals the terrain, or the compound, or a plasma bolt, is the frame that hitches.
Nothing is shown until the dragon is loaded, the places are built and everything
has been compiled and drawn twice. Precompiling is skipped entirely where
`KHR_parallel_shader_compile` is missing, because there `compileAsync` is a
synchronous compile wearing a promise and can hang the load.

## Working on this with more than one agent

If you have another agent reshaping the world, point it at
[`ARCHIPELAGO_HANDOFF.md`](ARCHIPELAGO_HANDOFF.md) — what it owns, the four
exports that are a public API with live callers, the units contract, which sites
cannot move, the performance budgets above, and how to verify before handing
back. [`DESIGN_NOTES.md`](DESIGN_NOTES.md) has the research behind the mission
and cutscene design.

## The chart

`Tab`, or the touchpad on a DualSense, opens a hand-inked Norse sea chart of the
archipelago. The coastlines and relief are traced from the same height field the
terrain mesh is built from, by marching squares over an 384² sample grid — so
what's on the parchment is what you fly over, down to the individual sea stacks.
It's built once into an offscreen canvas during an idle slot after load, and the
only things drawn live are the dragon marker, his heading and the trail of where
he's been.

Rumble is on by default. In the debug console, `rumble <0-1>` and `rumble off`
set the strength, `padsens <n>` and `padsens invert` tune the right stick, and
`pad` prints the connection state.
