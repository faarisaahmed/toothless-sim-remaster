# Model brief — Night Alone

For whoever is building assets. Everything here is environment and props. **Do not model
any character.** See §"What not to build".

Deliver into `assets/models/props/`. One model per `.glb` unless a kit is called for.

---

## Hard conventions

Get these wrong and the model can't be dropped in without hand-fixing every instance.

| | |
|---|---|
| **Format** | glTF 2.0 binary, `.glb`, one file per model |
| **Units** | **Metres.** 1.0 = 1 metre |
| **Up** | **+Y** |
| **Forward** | **+Z.** A boat's bow, a cage's door, a house's front all face +Z |
| **Origin** | On the **ground plane at the footprint centre**. The model sits on terrain by setting `position.y` to the ground height and nothing else. A hanging prop (lantern, chain) has its origin at the **hang point** instead |
| **Transforms** | Applied. No object-level rotation/scale left on the node. No parent empties |
| **Normals** | Included. Flat-shaded where the silhouette wants a facet, smooth where it wants a curve. **Do not** ship everything smooth |
| **Scale sanity** | A Viking is 1.8 m. A door is 2.1 m. Toothless is 3.4 m nose to tail base and 4.2 m across the wings when spread. A cage has to hold him |

## Materials — read this, it's the unusual bit

**This project has no image assets and is not getting a texture pipeline.** All surfacing
is procedural canvas texture generated at runtime (`js/textures.js`) and bound to
`MeshStandardMaterial`. That is what makes the whole game look like one thing.

So: **ship your models untextured, but UV-unwrapped, with one material slot per surface
type, named exactly from this list.** The engine binds our procedural material to the
slot by name.

| Slot name | Used for |
|---|---|
| `wood` | Planks, decking, crates, hulls |
| `wood_dark` | Beams, posts, structural timber |
| `stone` | Rock, hearth, ballast, quarried block |
| `iron` | Bars, chain, hinges, fittings, tools, cage frames |
| `rope` | Cordage, rigging, nets, lashings |
| `cloth` | Sailcloth, awnings, tarpaulins, bedding |
| `hide` | Pelts, leather, straps |
| `ember` | Anything that should glow — brazier coals, forge mouths, lamp flame |

Rules:
- **UVs must be sensible and non-overlapping**, roughly uniform texel density, because a
  procedural wood grain is going to run across them and a bad unwrap reads instantly.
- Grain direction matters. Unwrap planks so **V runs along the plank**.
- Anything in the `ember` slot will be made emissive by the engine. Keep those faces
  separate and small.
- **No baked lighting, no baked AO into a texture.** If you want contact darkening, put
  it in a `COLOR_0` vertex-colour attribute (greyscale, multiply). That's welcome and
  cheap. Optional.

## Budgets

This runs in a browser next to a 48k-triangle dragon.

| Class | Triangles |
|---|---|
| Small prop (barrel, fish, lantern, tool) | ≤ 400 |
| Medium prop (crate stack, winch, brazier, rack) | ≤ 1,200 |
| Structure module (deck section, cage, hut, crane) | ≤ 3,000 |
| Hero piece (the derrick, the moored ship) | ≤ 8,000 |

Style: **low-poly, faceted, readable in silhouette at 100 m.** Match `js/world.js` — the
terrain is faceted and unfussy. Chunky beats detailed. If it needs a normal map to read,
it's modelled wrong.

## Modularity

The rig and the village are built by instancing, not by placing a monolith.

- Deck and walkway pieces snap on a **2 m grid**. A 4 m deck section is exactly 4.000 m.
- Give repeated pieces a **plain flat bottom** at Y=0 so they stack and butt cleanly.
- Where a kit shares pieces, ship them as separate files, not one scene.

---

## What to build, in priority order

### P0 — The Rig *(the centrepiece; used in two missions)*

An industrial dragon-capture platform standing in open sea on pilings. Cold, competent,
well-maintained. It is a **factory, not a pirate camp** — this operation is well run and
that should be legible in how tidy it is.

| File | Notes |
|---|---|
| `rig_deck_4m.glb` | 4×4 m decking module, plank top, joists underneath |
| `rig_deck_ramp.glb` | 4 m run, rises 2 m |
| `rig_walkway_4m.glb` | 1.5 m wide, rope handrail both sides |
| `rig_piling.glb` | Single pile, 12 m, weathered below a waterline mark at 6 m |
| `rig_cage_large.glb` | **Key prop.** ~4.5 × 4.5 × 3.5 m, iron bar frame, hinged door on +Z, heavy lock plate. Must read as "a dragon fits in this" |
| `rig_cage_small.glb` | ~2 m cube, stackable, flat top |
| `rig_cage_door_open.glb` | The same door, swung. Or ship the door as a separate named node so it can be animated |
| `rig_crane.glb` | Hero. Timber derrick, iron sheave, hook on chain. Boom pivot as a named node |
| `rig_winch.glb` | Drum, ratchet, crank |
| `rig_brazier.glb` | Iron basket on a post, coals in the `ember` slot. **This is what the player snuffs** — the single most-used prop in the stealth missions |
| `rig_lantern.glb` | Hanging, origin at the hook |
| `rig_ladder_3m.glb` | Timber, stackable end to end |
| `rig_crate.glb`, `rig_barrel.glb` | Dressing |
| `rig_net_pile.glb` | Coiled net and floats |
| `rig_chain_coil.glb` | |
| `rig_mooring_post.glb` | |

### P1 — Hollow Stack *(the hub; the player sees it every mission)*

A sea stack with a hollow in it. Nobody built this for a dragon; a dragon moved in.

| File | Notes |
|---|---|
| `stack_shelter.glb` | Driftwood frame with sailcloth stretched over it. Scavenged, lashed with `rope`, deliberately a bit rubbish — he made it with his mouth |
| `stack_lab_shelf.glb` | A flat rock shelf ~3 m across, low lip. **The lab surface** |
| `stack_sample_rack.glb` | Driftwood rack holding metal offcuts. Slots for ~8 samples |
| `stack_sample_plate.glb` | One small alloy offcut, ~25 cm. Will be instanced with damage variants — ship **three**: `_clean`, `_dented`, `_holed` |
| `stack_fish_rack.glb` | Drying rack, `rope` and `wood` |
| `stack_arch.glb` | Hero rock arch, ~14 m span, `stone`. Landmark you navigate home by |
| `stack_driftwood.glb` | 3 variants in one file as named nodes, or 3 files |

### P2 — Berk *(the opening and the ending)*

Only ever seen from the air or from the edge of the village. Don't over-build interiors.

| File | Notes |
|---|---|
| `berk_longhouse.glb` | Hero. Big pitched roof, carved gable posts, ~18 m long |
| `berk_house_a.glb`, `berk_house_b.glb` | Two variants, ~7 m, turf or shingle roof |
| `berk_dock.glb` | 12 m jetty on piles |
| `berk_drying_rack.glb` | Fish on lines |
| `berk_totem.glb` | Carved post, ~5 m |
| `berk_fence_4m.glb` | Modular |

### P3 — Sea and dressing

| File | Notes |
|---|---|
| `boat_supply.glb` | Hero-ish. ~14 m single-masted working boat. Furled sail. This is what suppliers arrive in |
| `boat_row.glb` | ~4 m. Crews escape in these — **they are seen being fine in them**, so they need to read as safe, not wrecked |
| `wreck_hull.glb` | Half a hull on rocks, `wood` gone grey |
| `fish.glb` | ~35 cm. Will be instanced in the hundreds — keep it under 120 tris |
| `buoy.glb` | |
| `kelp.glb` | 2–3 fronds, for shallows |

---

## What not to build

- **No characters.** Every human and every non-player dragon in this game is a ball of
  light with a question mark in it. That is a stated, permanent art rule
  (`STORY.md` §11), not a stopgap. Toothless is the only thing with a body.
- **No Toothless.** He is done — `assets/models/dragon_rigged_hd.glb`, 152 bones. Don't
  touch him.
- **No terrain, water, or sky.** `js/world.js` generates all of it procedurally.
- **No UI, icons, or map art.** `js/map.js` draws the chart.

## Delivering

Drop `.glb` files into `assets/models/props/` and add a line per model to a
`assets/models/props/MANIFEST.md`: filename, triangle count, bounding size in metres, and
which material slots it uses. That's all the integration needs — I'll wire them up.

If a model has moving parts (a cage door, a crane boom, a winch drum), **leave them as
separately named nodes** in the same file — `door`, `boom`, `drum` — with their origins on
the hinge or axis. Don't merge them into the mesh.
