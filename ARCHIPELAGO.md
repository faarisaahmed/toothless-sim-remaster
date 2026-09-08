# The archipelago

What the world is made of, why each piece is the way it is, and how to check you
have not broken it. Written against `ARCHIPELAGO_HANDOFF.md`, which is the
contract this work was done under; that file still governs, and §2 of it still
lists the files nobody working on the world may touch.

---

## 1. The files

| | |
|---|---|
| `js/terrain.js` | **Shape only.** Noise, `ISLANDS`, `terrainHeight`. No THREE, no DOM, no state. |
| `js/world.js` | The scene: sky, lighting, terrain mesh, and the four public exports. |
| `js/terrainmat.js` | The ground material — six textures, triplanar, blended per pixel. |
| `js/sea_field.js` | Bakes what is under the water into a texture, once, at load. |
| `js/ocean.js` | The sea. three's `Water` underneath, everything above it replaced. |
| `js/surf.js` | Spray off the rocks. |
| `js/flora.js` | Trees, boulders, grass. |
| `assets/textures/` | CC0 ground textures from Poly Haven. `tools/fetch_textures.py` refetches them. |

The public API is unchanged and is now defined in exactly one place. `world.js`
re-exports it rather than redefining it:

```js
export function terrainHeight(x, z)   // -> metres. Called ~20x/frame.
export const ISLANDS                  // read by main.js and map.js
export const TERRAIN_SIZE             // 10000
export const SEA_LEVEL                // 0
```

`setupWorld()` returns everything it used to, plus `ocean`, `surf`, `flora`,
`seaField`, `ready` (a promise for the downloaded textures) and two new
toggles, `toggleTrees()` and `toggleSpray()`.

---

## 2. The archipelago itself

85 islands, 33 of them named and labelled on the chart. Laid out to a geological
story rather than scattered, because a scatter is the thing that reads as
procedural from the air:

- a **young volcanic arc** running north-east through Dragon Peak, Fireworm and
  Dragon Hunter Island — high, bare, steep-sided, snow on the tallest;
- **old, deeply eroded fjord islands** west and north of Berk, forested to the
  tree line and bitten into by drowned valleys;
- **low sand and shingle banks** in the shallow south-east, where the shelf
  never gets deep — Sandbuster, Thor's Beach, Breakneck Bog;
- **skerry fields** hung off the ends of the big islands along their own major
  axes, two thirds of them drowned reefs that never break the surface. They are
  the same ridge carrying on underwater, which is what a real skerry field is,
  and they are where most of the surf is.

Each island carries its own shape parameters — elongation, bearing, how far the
coastline lobes in and out, how domed the interior is, how stratified the rock
is, how wide its drowned foot is, how readily it forms beaches, how bare it is.
The table at the top of `terrain.js` documents every field.

**Three sites cannot move.** Berk `(0, -1100)`, Hollow Stack `(1700, 2550)` and
Dragon Hunter Island `(2900, 3800)`. Hollow Stack moved 50 m and 70 m so that
its plateau covers `SITES.stack` at `(1650, 2600)`, which is where
`buildHollowStack` takes its deck height from; the deck now comes out at 104 m
against `STACK_Y = 102` in `chapters.js`. The Hollow Stack to Dragon Hunter
Island run is 1733 m, which is the ~1.7 km of decompression the handoff asks for.

---

## 3. Things that are load-bearing

### Island centres are pre-warped

The shape is evaluated in warped space, so an island defined at `(1750, 2500)`
used to *come out* 250 m away from there — and everything that reads
`ISLANDS[i].x` reads it as a world position: chart labels, "Over Berk", and
`findCraterFloor()`, which sweeps 0.32r of the table centre and returns null if
it misses. Every centre is now run through the same warp once, at load, so
islands land under their own coordinates.

### The frequency ceiling

The terrain mesh is 768² over 10 km, so **13 m per quad**. Every `ridged()` call
in `terrainHeight` reaches `base * 2.07^(octaves-1)`, and anything past about
`0.011` — a 90 m feature — has nowhere to be sampled and lands as one-vertex
noise. The first version of this had a 27 m term in it and every island in the
archipelago looked like a row of shark teeth from the air.

Detail finer than that belongs to the ground material. Its normal maps are
triplanar, have no resolution limit, and cost nothing.

### `TERRAIN_SEGMENTS` went from 480 to 768

Called out in the handoff as the most expensive single change available, and it
is: 1.18M triangles instead of 460k, a 28 MB vertex buffer, ~0.55 s of load
instead of 0.25. It is still **one draw call** and **no extra lights**, which
are the two budgets that were actually hurting. It was raised because the
frequency ceiling above is set by mesh spacing, and at 21 m the coastlines could
not hold a headland under a hundred metres across.

### The shelf is a ramp, not a bench

Every island has a drowned foot that ramps from about −40 m at its outer edge to
−5 m at the coast. This is not decoration: it is what the ocean shoals and
breaks waves on. The first version was a flat bench at −27 m, which meant the
only water shallow enough to break a wave in was the last ten metres before the
beach, and the coast met the sea along a hard edge with no white on it at all.

### The wave-cut bench

Everything within a few metres of sea level is pulled toward the level the waves
work at. That is where the beaches come from, and it gives the surf somewhere
shallow to break, so it pays twice. Windward coasts get plunging cliffs and lee
coasts get sand, smoothstepped rather than sign-tested — a sign test draws the
changeover as a straight line across the island.

---

## 4. The ground material

Six layers: cliff rock, scree, grass, forest floor, beach sand, snow.

`world.js` used to say, correctly, that a tiled texture on this terrain is worse
than none — the UVs are planar, so anything mapped through them stretches into
vertical smears on exactly the surfaces you most want to look at, which is every
sea cliff in the archipelago.

The fix is not to give up on texture, it is to stop using the UVs. Rock is
projected from all three axes in world space and blended by how much the surface
faces each one, so a vertical face is textured by the two horizontal projections
and never stretches. The flat-lying layers keep a single top-down projection,
because they only appear on ground that is nearly horizontal and one tap is
three times cheaper than three.

Three things it has to get right:

- **It keeps the vertex colours.** Those carry the island-scale design and the
  curvature AO. The texture supplies structure and about a third of its own
  colour; the vertex colour supplies the rest. `<color_fragment>` is deleted
  from the shader, or three multiplies `vColor` in a second time.
- **It fades out with distance.** A 7 m tile at 3 km is far below one pixel and
  boils under any camera motion. Past ~2.4 km it falls back to vertex colours,
  which is both stabler and free — and skips every texture fetch on most of the
  screen.
- **It branches.** Nearly every pixel is one or two layers. The weights are
  coherent across a quad, so skipping the zero-weight layers actually skips them.

Which layer goes where is decided on the CPU, per vertex, from the same
`fertility()` the trees are scattered from, and shipped as an `aSurf` attribute.
So the forest floor is under the forest and not next to it.

---

## 5. The sea

three's `Water` is still underneath and earns its place: it does a real planar
reflection pass, which is the single biggest thing separating water from a blue
plane. What it does not do is have a surface — it is a flat quad whose waves are
a normal map. Both its shaders are spliced, and **every splice is checked at
runtime**, because a whitespace change upstream would turn them into silent
no-ops and the sea would quietly go back to being flat.

- **A radial grid centred on the player**, 16 km across, ~44k quads, ring radius
  growing as a power of the index: about four metres per quad underfoot and
  sixty at three kilometres.
- **Six Gerstner waves** from one wind vector, fanned either side of it. Six
  waves all running the same way is a corrugated roof and the eye finds it
  instantly.
- **Everything under the surface**, read from the baked sea field: waves grow
  and shorten as the bottom comes up, refract until they run parallel to the
  shore, break when they can no longer stand up, and lie down in the lee of an
  island.

Two mistakes worth not repeating:

- **Depth and shore distance must be read per FRAGMENT.** They started as
  varyings, interpolated from vertices a hundred metres apart by the time an
  island is a kilometre away. The surf band is thirty metres wide. It fell
  entirely between the samples.
- **Whitecaps come from the Jacobian, not the steepness parameter.** Summing
  each component's `amplitude * k` gives the same number everywhere in the
  ocean, so either the whole sea is white or none of it ever is. Summing
  `Q * cos(phase)` peaks exactly where crests coincide and the surface is being
  pinched vertical, which is where water goes white and nowhere else.

Shallow water is translucent over the last three metres, so the beach shows
through. There is no refraction pass; the terrain is already drawn underneath,
and simply not being opaque over it does the job.

### Spray

`surf.js` finds every place the sea meets rock ONCE, at load, off the sea field
that was baked anyway, and keeps a fixed pool of 420 billboards parked on
whichever of those sites are nearest the camera. Nothing is simulated. Each site
bursts on the period of the long swell with an offset taken from its own
coordinates, so a mile of coast goes off in a ragged sequence rather than all at
once. One draw call, constant vertex count.

---

## 6. Trees, boulders, grass

The constraint is that he covers 55 m a second at cruise and 335 flat out, so a
tree is fifteen frames of your life at sprint.

- ~16,000 trees, scattered once at load, in a 16 × 16 grid of tiles. Two
  instanced meshes per tile: a built conifer for the tile you are over, a crossed
  billboard for the ones you are not. LOD is a distance test **per tile**, which
  is one boolean for a thousand trees.
- Foliage is alpha-tested cone shells. The needle texture is deliberately
  *mostly opaque with a torn edge* — the first version drew three thin sprigs on
  a transparent tile, which covered a sixth of the cone, so eighty percent of
  every tree was discarded and the forest came out as a hillside of bare sticks.
- Boulders on the scree, laid down along the slope normal so they look sat
  rather than dropped.
- Grass only within 55 m of the camera and only below 140 m of altitude, on a
  golden-angle spiral with a hash of jitter (the pure spiral leaves visible arms
  on flat ground). It re-scatters a quarter of the field per frame, because
  eleven thousand terrain samples in one go is a stall at the exact moment he
  touches down.

Wind is one uniform patch shared by all of it, with the phase taken from each
instance's world position so a hillside moves as a wave through the wood. The
sway is applied before the instance matrix, so the wind vector is rotated into
each tree's own space first — skip that and every tree leans whichever way it
happens to have been planted.

**No lights were added anywhere.** See §5 of the handoff for why that matters.

---

## 7. How to check it

```bash
node tools/flightcheck.mjs          # flight untouched: 123 / 403 / 750 mph
node tools/probe.mjs                # ASCII chart + every hard constraint
node tools/probe.mjs 2900 3800 1400 # zoom on a point, half-width in metres
python3 tools/serve.py 8123 &
python3 tools/render_check.py --seconds 46 --png /tmp/shot.png --cmd "go 4;perf"
```

`tools/probe.mjs` runs the same crater sweep `findCraterFloor()` does, asserts
the three story sites are dry land, asserts the camp patch on Hollow Stack is
walkable, asserts the shoal is water and the spawn is over open water, and
reports the per-call cost of `terrainHeight` and what that means for load.

`tools/render_check.py` exists because a `--screenshot` of this game comes back
with the HUD on a black rectangle whether or not anything is wrong — headless
Chrome here does not composite the WebGL canvas into the capture, and does not
forward console to stderr, so a shader that fails to compile fails silently and
looks identical to one that works. It drives the page from the inside instead:
records console and errors, forces `preserveDrawingBuffer` so the frame can be
read back, runs debug-console commands, and posts the frame and the log back to
the harness over HTTP.
