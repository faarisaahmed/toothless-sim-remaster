# Working on the archipelago — read this first

You have been asked to make the archipelago more realistic. This file is the
contract between that work and everything else in the game, written by the agent
who owns the flight model, the camera, the compound and the mission code.

**The one-line version:** own `ISLANDS` and the *shape* functions inside
`js/world.js`. Do not change units, do not change the exported API, and do not
move Berk, Hollow Stack or Dragon Hunter Island without reading §3.

---

## 1. Yours to change

| | |
|---|---|
| `js/world.js` → `ISLANDS` | Add, reshape, retune islands. This is the main thing. |
| `js/world.js` → `terrainHeight()` internals | Noise, warp, relief, crags, erosion. |
| `js/world.js` → materials, colour ramp, fog, sky, water | All yours. |
| `js/textures.js` | Yours. |
| New files | Anything new under `js/` that only `world.js` imports. |

## 2. Not yours — changing these breaks other systems

**`js/controls.js`, `js/main.js`, `js/plasma.js`, `js/places.js`, `js/chapters.js`,
`js/game.js`, `js/flightrig.js`, `js/wings.js`.** If you think you need a change
in one of these, say so in your summary rather than making it.

Specifically, these four exports are a public API with live callers:

```js
export function terrainHeight(x, z)   // -> metres. Called ~20x/frame.
export const ISLANDS                  // read by main.js and map.js
export const TERRAIN_SIZE             // 10000
export const SEA_LEVEL                // 0
```

and `setupWorld()` must keep returning at least:

```js
{ getHeightAt(x, z), seaLevel, update(pos, dt), setSun(elevDeg, azDeg),
  toggleGrid(), toggleWireframe(), toggleClouds(), toggleWater() }
```

Callers you would break: `main.js` (collision floor, landing test, camera
occlusion, spawn), `places.js` (foundation heights), `plasma.js` (impacts),
`map.js` (the chart is marching squares over `terrainHeight`), `flights.js`.

## 3. Hard constraints

**Units are metres. One world unit = one metre.** This is not cosmetic — the
flight model is in real m/s (cruise 55, top speed 335 = 750 mph, canon), the
dragon is 8.6 m nose to tail at scale 1, and the props are authored in metres.
If you rescale the terrain, you silently rescale how fast the game feels.

**`terrainHeight` must stay a cheap pure function of `(x, z)`.** It is called
about twenty times a frame — terrain collision with look-ahead, the camera's
occlusion march, landing tests, plasma impacts. No allocation inside it, no
caching that assumes calls are spatially coherent, no `Math.random()`. It must
return the same value for the same input every time, forever, because the chart
in `map.js` re-derives coastlines from it independently.

**Height is measured from the sea floor, not the water.** `SEA_FLOOR` is about
-190 and `isl.h` is added on top of that, so an island with `h: 300` has its
summit around +110 m. This trips everyone up once. Land is anything above
`SEA_LEVEL` (0).

**Three sites must stay landable and roughly where they are.** Landing requires
terrain above `SEA_LEVEL + 3`, an approach under `LAND_AGL` (22 m), and cruise
speed or slower.

| Site | Why it cannot move much |
|---|---|
| **Berk** `(0, -1100)` | Spawn is `(0, 300, 900)`; mission beat 1 is "leave Berk". |
| **Hollow Stack** `(1750, 2500)`, `flat: true` | The story hub. Needs a walkable plateau — the shelter and the lab are placed on it and `STACK_Y = 102` in `chapters.js` is its deck height. If you change its height, change that constant. |
| **Dragon Hunter Island** `(2900, 3800)` | Has a `crater`. See §4. |

Pacing depends on the *distances* between those three as much as their
positions. Hollow Stack to Dragon Hunter Island is ~1.7 km, which is about
thirty seconds at cruise, and that gap is deliberate decompression between story
beats. Keep it within a few hundred metres of that.

## 4. Dragon Hunter Island — the one you must not casually reshape

```js
{ name: "Dragon Hunter Island", x: 2900, z: 3800, r: 980, h: 640, cliff: 0.30,
  crater: { inner: 0.46, floor: 0.40, gate: 0.85, mouth: 0.26 } }
```

`crater` is a shape modifier handled inside the island loop in `terrainHeight`:
`inner` is how far the flat floor reaches as a fraction of `r`, `floor` is how
high that floor sits as a fraction of `h`, and `gate`/`mouth` cut a sea-level
channel through the rim at that bearing.

The hunters' compound stands on the floor. **Its position is not hardcoded** —
`findCraterFloor()` in `main.js` sweeps the bowl at load, finds the flattest
patch that will take a 116 × 92 m deck, and puts the fort *and* the story
waypoint there. So you may reshape this island freely **provided the bowl still
contains a patch that satisfies:**

- above `SEA_LEVEL + 14`,
- within `0.32 * r` of the island centre,
- roughness under ~30 m across six samples at ±62 m.

If no such patch exists, `findCraterFloor()` returns null, the compound falls
back to a floating platform at 30 m and the mission is unplayable. **Verify it,
do not assume it** — see §6.

By all means make it look more like a real volcanic caldera. Terracing, scree,
a beach at the channel mouth, a crater lake off to one side — all welcome. Just
leave somewhere flat to stand.

## 5. Performance — the part that bit us

The game was recently laggy and the cause was entirely budget, not code. Two
numbers govern it:

**Point lights.** three.js forward-renders: every visible `PointLight` in the
scene is a loop iteration in *every fragment shader on screen*, whether or not
it is anywhere near what is being drawn. The compound now shares seven pooled
lights among sixteen braziers (`makeLightPool` in `places.js`) instead of
sixteen real ones. **Do not add per-object point lights to the terrain.** If you
want glowing lava, use emissive materials, which are free.

**Draw calls.** Anything static should be merged. `mergeStatic()` in
`places.js` flattens a list of positioned objects into one mesh per material;
the compound's deck went from ~1800 draw calls to about three that way. If you
scatter rocks or trees, use `InstancedMesh` or merge them — do not add hundreds
of individual meshes.

The terrain mesh itself is `480²` segments (~460k triangles) as one draw call,
which is fine. Raising `TERRAIN_SEGMENTS` is the most expensive single thing you
could do; if you need more detail, get it from the material, not the mesh.

Type `` ` `` in game and run **`perf`** for draw calls, triangles, visible
lights and compiled programs. Check it before and after your change.

## 6. How to verify before you hand back

There is a node harness pattern that runs the real modules headlessly. It needs
three vendored locally (already gitignored):

```bash
mkdir -p node_modules/three/addons
echo '{"name":"three","version":"0.160.0","type":"module","main":"index.js",
  "exports":{".":"./index.js","./addons/*":"./addons/*"}}' > node_modules/three/package.json
curl -sL -o node_modules/three/index.js https://unpkg.com/three@0.160.0/build/three.module.js
# plus addons/ mirroring any three/addons/* import in js/
```

Then, at minimum, prove these four things:

1. **Flight is untouched.** `node tools/flightcheck.mjs` — cruise 123 mph, sprint
   403, burst 750, identical distance at 30/60/144 fps.
2. **The crater floor still exists.** Re-run the sweep from §4 and print the
   spot, its height and its roughness. If it prints nothing, you have broken the
   mission.
3. **Nothing is stranded in the sea.** For Berk, Hollow Stack and Dragon Hunter
   Island, assert `terrainHeight(x, z) > SEA_LEVEL + 3` at the site coordinates.
4. **It renders.** Serve with `python3 tools/serve.py`, then capture the console:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --use-gl=swiftshader --enable-unsafe-swiftshader \
  --enable-logging=stderr --v=0 --window-size=1200,700 \
  --virtual-time-budget=30000 --screenshot=/tmp/shot.png http://localhost:8000/ 2>&1 \
  | grep -iE "CONSOLE|uncaught" | grep -viE "youtube|manifest|GL Driver"
```

An empty result means no runtime errors. Note that under `swiftshader` the load
screen can still be compiling at 30 s — that is the software renderer, not a
bug. There is also an ASCII height-map probe pattern that is by far the fastest
way to see what you have made; ask for it, or write one — it is ~20 lines over
`terrainHeight`.

## 7. Style

Match the house style in `world.js`: comments explain *why* a number is what it
is and what went wrong before, not what the line does. Constants get a unit and
a reason. Keep the existing voice.

## 8. Flag, do not fix

Tell the user, and leave alone:

- Anything needing a change in a §2 file.
- Anything that moves a §3 site more than a few hundred metres.
- Anything that raises the point-light or draw-call budget in §5.
- There is no local copy of three, and there does not need to be one. The game
  loads it from a CDN via the import map in `index.html`, and the node tools in
  `tools/` load it from `node_modules/three`. (`libs/three.module.js` used to
  sit here as a 0-byte placeholder inviting someone to "fix" it. It is gone.)
