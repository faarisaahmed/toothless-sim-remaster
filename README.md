# dragon-flying-sim
A simulator to fly dragons

Serve it with `python3 tools/serve.py` and open <http://localhost:8000>. That is
the plain http.server plus `Cache-Control: no-store`, which matters more than it
sounds: without it Chrome will happily reuse an ES module from earlier in the
session, so you edit a file, reload, and are shown the old one with nothing to
tell you.

Loading the page opens the title screen: **Continue**, **Story** (four save
slots, each with a chapter select for anything it has reached), **Free Flight**
(no story — find all 33 named islands) and **Settings**.

| URL | |
| --- | --- |
| `/` | the title screen |
| `/?stage=flight` | the flight sim, story from the top, nothing saved (dev route; the tools use it) |
| `/?stage=free` | free flight |
| `/?stage=prologue` | the prologue on slot 1 |

Story progress is saved at the start of every beat, every 30 s, and on
**Save & quit**; Continue resumes on that beat where you were. Esc or P opens
the pause menu (Journal, Settings, Restart chapter, Save & quit).

## Graphics

Settings → Graphics. One-click presets along the top — **Auto** (picked from
the GPU), **Low**, **Medium**, **High**, **Max** (everything up; the Ultra
preset) — with a **Custom** lamp that lights once you change any single option.
Under them, each setting on its own, every value shown at once so one click
picks it: frame-rate limit (30 / 60 / unlimited), render resolution (auto or
fixed), shadows, terrain detail, forest draw distance, grass, water
reflections, clouds, glow, and an FPS counter. On a keyboard or pad, up / down
moves between rows, left / right steps the value (stopping at the ends), and
Enter / confirm steps forward and wraps round.

Grass is Off / Low / Medium / Ultra. Low is a thin patch round you when you
land or fly low. Medium is thicker underfoot, plus grass on the meadows out to
400 m. Ultra carries it out to about 3 km. The far grass is placed on the GPU
(`js/grassfield.js`), in rings round the camera that get coarser as they go
out, read off the same height field and vegetation paint as the terrain.
Everything applies live. For a weak laptop: **Low**, or Medium with shadows off
and a 30 fps cap.

**Photoreal** (top of Settings → Graphics, or `photoreal on` in the console) is
the live-action look, and it is heavy. Mountains cast real shadows across the
valleys, tree tops, roofs and the dragon included, from a shadow map baked off
the height field on the GPU. Gullies, fjords and cliff feet are dimmed by how
much sky they can see. Haze lies thicker low down, so the peaks stand clear. The
slopes are cut with erosion gullies, rock breaks through the turf, and cliffs get
crag relief at the scale you see them from the air. Each tree gets its own shade
and a dark inner crown. The camera switches to AgX tone mapping with a light
sharpen, lens fringing and a softer bloom. Turning it on raises shadows, terrain,
forest, clouds and reflections to match; turning it off leaves them where they
are. It all lives in `js/photoreal.js`, plus the `uPR` paths in
`js/terrainmat.js` and `js/flora.js`.

Clouds are ray-marched volume (`js/clouds.js`) from Medium up — fly into them,
through them and out on top; Low paints them on the sky instead. Time of day,
weather (clear, fair, overcast, rain, storm, fog), the sun and moon, fog and
lightning live in `js/sky.js`; rain and thunder in `js/rain.js`. The story sets
the sky beat by beat (`BEAT_SKY` in `js/chapters.js`); free flight follows
Settings → World (time of day, length of a day, weather). Debug console:
`time <hour>`, `time flow <h/s>`, `weather <name>`.

Terrain detail above Low streams finer ground chunks around the dragon, built on
Web Workers (`js/terrainlod.js`, `js/terrainworker.js`); Low keeps the single
13 m sheet and a cheaper ground shader.

## The forest

The woods are stands a few kilometres across in the glens and on the lower
slopes, with open turf and heath between (`woodland()` in `js/terrain.js`; the
ground paint and the hunters' sight lines read it too) -- on a thirty-kilometre
chart, forest everywhere fertile would be a million trees. About 275,000 are
scattered one 625 m tile at a time on a small worker pool (`js/forestscatter.js`,
`js/forestworker.js`), nearest the dragon first; the loading screen waits for
the ones within 6 km and the rest arrive while he flies.

The trees are the north-Atlantic wood the archipelago is drawn from. The species
are Norway spruce, Scots pine, silver birch, rowan, sessile oak, juniper, and
wind pines shorn flat on the exposed headlands. Each one is grown from a seeded
skeleton of branches and leaf cards (`js/trees.js`), with three to four unique
variants per species, and each tree is also scaled, turned and tinted on its
own. Bark, leaves, needles and berries are all painted on canvases at load.

Where they grow is in `js/forest.js`:
- spruce in the dark fertile valleys
- pine and birch on the drier slopes
- oak, birch and rowan in the warm lowland hollows
- juniper and stunted birch near the treeline
- wind pines on headlands open to the gale

They grow in stands, not mixed at random.

Each tree has three levels of detail by distance from the camera:
- **Hero:** every branch and leaf, within about 60–130 m.
- **Mid:** trunk, limbs and fewer, larger leaves, out to the forest draw
  distance.
- **Imposter:** the hero model photographed from the side and from above into
  an atlas at load, drawn as three cards.

Debug: `window.__na.world.flora.forest.showcase(x, z)` lines every variant up
in a row.

## The wingbeat

The wingbeat is `js/wings.js` and `js/flightrig.js`.

**It is slow and heavy.** Wingbeat frequency falls with body size: for birds it
scales roughly as mass to the power −0.27. A 10 kg condor flaps at about
2.7 Hz, so an animal his size is under 1 Hz:

| | Beats per second |
| --- | --- |
| Hovering | about 0.95 |
| Climbing | about 1.2 |
| Cruise | about 0.7 |
| Fast | about 0.6 |

**The wing bends; it doesn't swing.** The shoulder makes a modest stroke and
the rest travels down the wing as a wave. This is how bat wings move (the wrist
leads, the tip follows) and how the films animate a dragon's wing.
- The hand wing lags the arm wing by about a tenth of a beat, and the tip lags
  further.
- So the wing cracks down like a whip, still finishing its downstroke at the
  tip while the arm starts back up.
- It arches on the recovery and peels up last.
- The membrane cups under load on the downstroke.
- The elbow and hand fold it in on the upstroke.

**Flap and glide.** At steady cruise he flaps a few strokes, then glides.

**Body heave.** The body rises on each downstroke.

The wing joint axes were measured on the rig, not guessed. `wingprobe.html`
shows what each bone and axis does. `flightcheck.html?speed=0&climb=0&view=front|side|q`
is the test bench: one full beat as a filmstrip.

## The hunters' pit, up close

**Shape.** The pit is shaped in `js/terrain.js`:
- The terraces wander rather than forming perfect rings.
- Risers are cut differently from one another.
- Talus (fallen rubble) piles at the foot of the risers.
- The floor rolls gently.

**Ground mesh.** `js/basedetail.js` adds its own ground over the whole pit: a
1.5 m mesh carrying gentle rock relief and smooth worn tracks. The terrain under
it is not drawn (`uHole` in `js/terrainmat.js`), so the two never fight. His
feet stand on this mesh.

**Material.** The ground uses `js/pitmat.js`, built from three photographed
2K CC0 surfaces from Poly Haven, stored in `assets/textures/pit/`:

| Surface | Texture | Used for |
| --- | --- | --- |
| Stony packed ground | `rocks_ground_02` | treads and floor |
| Angular rubble | `gray_rocks` | the talus banks |
| Fractured block rock | `dry_riverbed_rock` | the cut faces, triplanar |

- Layers meet by height, so rubble fills the hollows and rock breaks through.
- Reads are randomised so the photographs never visibly repeat.
- Everything is tinted to the island's dark basalt.

**Near only.** The rock is only drawn near the camera. Between 70 and 150 m it
dithers over to the island terrain material (`uHoleFade` / `uFade`): each
material draws exactly the pixels the other leaves out. From the air, the same
photograph repeated across the whole pit would read as a grid, while the terrain
material is built to be seen from far off.

**Clutter is kept sparse:**
- Pebbles along the track edges.
- Rocks and a few boulders at the foot of the faces.
- Occasional tufts, heather and gorse.
- A handful of puddles on the tracks.

## Landing and standing

On the ground he's a physical body (`js/groundbody.js`): mass carried on four
spring-damped legs.

**What he can stand on.** Each leg reaches down to the highest solid thing
under its foot (`js/surfaces.js`). That means terrain, plus the real geometry
of every place: hut roofs, decks, crates, cages, the top of the stack. Ray
tests stay fast thanks to a BVH (`three-mesh-bvh`).

**Coming down.**
- He flares on the way down: the wings hold most of his weight, he sinks under
  control, and he sheds forward speed.
- His legs absorb the touchdown.
- He runs out whatever speed is left.

**Standing.**
- His body sets itself to the plane of his footholds, so he tilts along a roof
  or across a rock.
- Grip is limited friction. A gentle slope holds him; one too steep for it
  slides him down.
- Anything taller than a step stops him.

**Edges.** With two feet or fewer holding him and his weight off them, he tips
over the edge. After a moment of falling he opens his wings.


## On foot

The walking is built from how big cats and other four-legged animals actually
move (`js/gait.js`). Toothless was animated from a panther and a dog, and his
hips are about a metre off the ground.

**Gaits by speed.** Across four-legged animals, the gait changes at set values
of the Froude number (v²/gh, with h the hip height). The walk gives way to the
trot at about 0.5, and the trot to the gallop at about 2.5. For him that's a
walk below about 2 m/s, a trot up to about 5 m/s, and a gallop beyond.
- **Walk:** each side's hind foot then fore foot steps in turn, with three feet
  on the ground most of the time, and the head nods.
- **Trot:** diagonal pairs move together.
- **Gallop:** a big cat's bounding gallop, with the spine coiling and
  stretching through each stride.

The movement key is a brisk trot at 4.2 m/s, and sprint is a gallop at
14 m/s.

**Planted feet.** A foot on the ground stays where it landed, and each leg is
solved to it with two-bone IK (the hip-to-knee and knee-to-ankle segments are
rotated so the foot lands exactly on its target). A foot in the air swings to
where it will be needed next, so steps lengthen with speed and nothing slides.

**Terrain.** Every foot lands on the ground beneath it.

**Body.**
- He bobs in time with his gait.
- He leans into turns (lean = v·ω/g).
- His head holds steady against the motion.
- His tail swings to counterbalance.
- When he stops, any foot left out of place takes a last step to settle.

The prologue's walk uses the same system.

`gaitcheck.html?v=4.2` is the test bench: the real rig on a grid, drawn as a
side-on filmstrip at a fixed time step. Options include `&turn=`, `&slope=`,
`&view=front|top|q`, and `v=0` to see him standing.

## Minimap

Top right, in flight and on foot (`js/minimap.js`). It's heading-up and zooms
out with speed and height.

What it shows:
- The objective: a ring on the map, or an arrow on the rim when it's off the
  map.
- Places he has found.
- The forest trails into the hunters' pit, dotted.
- Nearby hunters, each with a tick for the way he faces: white when calm, amber
  when suspicious, red when alerted.
- N, E, S and W round the rim.
- His X, Y and Z underneath.

The full chart is still on Tab.

## Health

Settings → Game → **Damage** is on by default. The health bar sits top left.

**What hurts:**
- Arrows and bolas.
- Flying into the ground. Damage scales with how fast he's moving *into* the
  surface, so skimming along is free.
  - Diving into flat ground bites harder.
  - A cliff at speed is usually fatal.
- Scraping along rock at speed.
- Hitting the sea, which hurts half as much as rock.

**Healing:** he heals after a few seconds without being hit. The pale strip
behind the bar shows what the last hit took.

**Going down:** at zero health a card says what brought him down. Continue
wakes him over the nearest island with full health, and nothing in the story is
lost.

**Tips:** the card shows tips. The first one happens to be about how he just
died, and the next loading screen does the same.

**Settings → Game → HUD** hides the instruments, compass, minimap and health bar.

**Loading screen tips:** cycle on their own, or use the ‹ › buttons or the arrow
keys. They never repeat within one sitting. Damage tips are added only when
damage is on.

## Save files

There are four journeys, each its own plain-text file in the browser's local
storage: `user1.dat` to `user4.dat`. Each holds the save as indented JSON.

- **Edit by hand:** open DevTools, go to Application, then Local Storage, edit
  the file, and reload.
- **Copy one off the machine:** the journey's menu has Export (downloads
  `userN.dat`) and Import (loads a `.dat` file into that slot).
- **Delete:** every saved journey has a Delete button in the Story list, or
  press Delete on it. It asks before deleting.
- **Unreadable file:** a slot whose file can't be read shows as damaged instead
  of being overwritten.
- **Old saves:** saves from the old single-entry store move into the files
  automatically.

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

**Turbo.** Double-tap and hold flat out (or hold sprint with it) to go past the
canon top speed: through the sound barrier to 1,600 mph (715 m/s). It winds up
over a few seconds. The speeds are honest: the HUD reads what he actually
covers, measured at 335 m/s flat out and about 710 m/s in turbo.

**Seeing speed.** At altitude over open sea, nothing near the camera moves, so
any speed looks slow. `js/speedfx.js` adds:
- Streaks of air fixed in the world around the camera. They pass at his true
  speed, from about 200 mph up.

- A shock ring, a thump and a camera shake at the moment he crosses it.
- An FOV punch in turbo.

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

### Getting in unseen

Flying in over the open pit gets him seen: every tower is watching that sky.
The way in is on foot, down one of three old spoil gullies, now grown over.

**The gullies** (`pitPaths` in `js/terrain.js`):
- **South:** from the plateau behind the southern rim to the stores stacked
  against the yard fence.
- **East:** a gorge through the eastern ridge, down to the cranes and the back
  of the cage ring.
- **North:** from the headland across the channel, down behind the workshop.

Each one starts in the woods outside the rim. Land there, then trot down about
700 m to the yard fence. The fence is broken where each gully comes out.

How they are built:
- **Floor:** a smoothed centre line with a floor profile. It never runs steeper
  than 14°, and it stays at least 5 m below the ground on either side. Where the
  terraces fall faster than that, the cut goes deeper instead of steeper. The
  banks widen as the cut deepens, so a shallow cut is a ditch and a deep one is a
  gorge.
- **Trees:** `fertility()` reads `pitWood`, so the forest plants the gullies
  thick with its own species.
- **Undergrowth:** `js/pitwood.js` adds ferns, tall grass, bushes, mossy fallen
  trunks and sunbeams through the canopy. It leaves a trail open down the middle.
  Plants are placed at load but only built into meshes when the camera comes
  near.
- **Ground:** `pitmat.js` turns the quarry rock to leaf litter and moss.
- **Buildings:** nothing in `hunterbase.js` is built in a gully or on its lip.

**The guards** (`js/hunters.js`):
- **What they can see.** A guard sees about 50° either side of where he faces,
  catches movement out to about 70°, and is blind behind. He seldom looks up.
- **What blocks the view.** His line of sight is tested against the ground, the
  buildings (a raycast against the same BVH meshes the feet use) and the wood.
  Trunks and crowns thin the view the further it passes through them.
- **What helps him.** Light helps, and so does size: a dragon flying with his
  wings spread against the sky is seen from far off. Moving helps too. On foot,
  standing still, he is hard to spot.
- **Hearing.** A gallop is heard about 35 m away, and a trot about 7 m away.
  Hard wingbeats are heard 120 m away.
- **Suspicion builds over time.** What a guard sees fills a meter. It fills
  quickly when the dragon is close and out in the open, and slowly when he is
  far or half hidden. It drains when nothing is seen.

What a guard does:
1. **Suspicious.** He stops and turns toward what he noticed, and a "?" fills
   over his head.
2. **Investigates.** He walks to where it *was*, not to where the dragon is now.
3. **Searches.** He looks around for a few seconds.
4. **Gives up.** He goes back to work.
5. **Alert.** If his meter fills while he can still see the dragon, the "?"
   turns into "!". He shouts, everyone within 150 m comes to look, the archers
   shoot, and the story's alarm goes up.

Guards are dim on purpose:
- They give up quickly.
- They don't look up.
- A plasma blast is a noise. Everyone within 110 m who isn't already alert
  goes to look at the impact point, not at him. Use it to pull a guard off his
  post.

While he is on foot or aiming, faint fans on the ground show which way the
nearby guards face. They are pale for calm, amber for suspicious and red for
alert.

Headless test runs, at day (09:00) and in mission one's dusk (20:40, overcast):
- **On foot, all three gullies:** walked from outside the rim to the fence. No
  guard's meter moved.
- **Mission one, on foot:** "Get a look at the cages" completed without an
  alarm.
- **Into the open yard:** the first "?" came after about 6 s, and "!" after
  about 9 s.
- **Flying straight in:** seen after 9–10 s, before reaching the cages, and the
  beat did not complete.
- **A blast near a guard:** he walked from 32 m to 5 m of the impact point.

## Music

An original score, written for this game: six tracks built on two themes, so
the whole game sounds like one piece of music in six moods. They crossfade,
they loop seamlessly, and `M` mutes.

- **The Emberwing theme** — the hero's tune. D Dorian, 6/8, its hook a fiddle's
  open strings thrown up a twelfth and held like a horn call. It turns up dark
  (Dorian), bright (the same tune in Mixolydian), as a jig, and as a war song.
- **The Hearth theme** — a slow polska in G with the raised fourth of
  Norwegian fiddle music, for the small and the warm.

The roots are Scandinavian and Celtic: modal melody, drones, jig and polska
rhythms, ornamented whistle and fiddle lines (cuts and rolls), a kulning-style
high call, bodhrán, the pipes used sparingly.

| Track | File | Where |
| --- | --- | --- |
| Emberwing (Title) | `emberwing-title.mp3` | Title screen |
| The Hearth | `the-hearth.mp3` | The prologue |
| Emberwing (Flight) | `emberwing-flight.mp3` | The archipelago |
| Emberwing Jig | `emberwing-jig.mp3` | Flying flat out |
| Emberwing (Raid) | `emberwing-raid.mp3` | The raid |
| Held Breath | `held-breath.mp3` | Being seen |

Browsers refuse to make a sound until the player has interacted with the page,
so the first track does not start on load — it starts on your first click or
keypress, which in practice is the click that captures the mouse.

In the debug console, `music` prints what is playing, `music <name>` switches to
it, `music vol <0-1>` sets the level and `music off` stops it. The level and the
mute survive a reload.

### Rebuilding it

The score is code. `tools/music/score.py` holds the notes, `engine.py` performs
and mixes them, and

    python3 tools/music/build.py            # all six, ~2-3 minutes
    python3 tools/music/build.py flight     # just one
    python3 tools/music/build.py --solo     # the two themes alone, dry

renders every track through fluidsynth with the GeneralUser GS soundfont
(fetched on first run; it is 32 MB and gitignored), mixes it with a
convolution hall, EQ, compression and a limiter, and cuts a seamless loop. It
prints each loop length; those are the `to` values in `js/audio.js`'s `TRACKS`.
Needs `pip3 install --user mido numpy scipy` and `brew install fluid-synth ffmpeg`.

### Credits

Music composed for this game. Instruments from the
[GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) soundfont by
S. Christian Collins, used under the GeneralUser GS License v2.0 — see
`assets/audio/music/CREDITS.txt`.

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

## The archipelago

Thirty kilometres square, modelled on the Faroes, the Hebrides and western
Norway. It was ten, and at 335 m/s (750 mph) he crossed all of it in thirty
seconds: the islands read as hills and flat out read as a stroll. The island
table is still authored on the old ten-kilometre chart and scaled on the way in
(`WORLD_SCALE` = 3 for positions and radii, `PEAK_SCALE` = 1.5 for summits above
the water, in `js/terrain.js`), while everything in the height function that is
measured in metres -- crags, gullies, strata, drainage -- stays the size it was,
so a bigger island carries more of them rather than bloated ones. A third,
kilometres-wide relief scale gives the big islands ranges and glens, and they
get a few short sea lochs of their own beyond their named fjords. Berk is now
about twelve kilometres of fjord country, Berserker, Outcast, Raven Point and
Glacier Island not far short of it, the rest four to seven; Glacier Island tops
out near 1,000 m and Dragon Peak near 950. The hunters' pit and Hollow Stack
did not grow: what people built there is in absolute metres. They lie in groups, close enough in places that the
water between them is a strait, with open water kept south of Berk and down the
middle. About 37% of the chart is land, and a handful of skerries stand off the
coasts as bare rock. Big islands are built from several bodies run together
(`parts`) and cut with drowned valleys (`fjords`), both in `js/terrain.js`;
[`ARCHIPELAGO.md`](ARCHIPELAGO.md) has the detail.

## The chart

`Tab`, or the touchpad on a DualSense, opens a hand-inked Norse sea chart of the
archipelago. The coastlines and relief are traced from the same height field the
terrain mesh is built from, by marching squares over a 768² sample grid (taken on a worker) — so
what's on the parchment is what you fly over, down to the individual sea stacks.
It's built once into an offscreen canvas during an idle slot after load, and the
only things drawn live are the dragon marker, his heading and the trail of where
he's been.

Rumble is on by default. In the debug console, `rumble <0-1>` and `rumble off`
set the strength, `padsens <n>` and `padsens invert` tune the right stick, and
`pad` prints the connection state.
