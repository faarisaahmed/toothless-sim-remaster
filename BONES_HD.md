# dragon_rigged_hd.glb — skeleton

- **152 bones**, 0 animation clips, 48498 triangles
- Built from the unrigged `dragon.glb` by `tools/rig_dragon.py`.
- **This is the rig the game loads.** `js/assets.js` and `js/main.js` take it
  first and fall back to `toothless_rigged.glb` (95 bones) then
  `dragon_rigged.glb` (7 bones), both of which are untouched.
- Same frame as `toothless_rigged.glb`: Y-up, lying flat, nose along local −Z,
  `.L` on −X. Same 15.09-unit span, so it drops in at the same scale.

## On the ground the wings are cut, not folded

The membrane is a single fifteen-unit sheet under four-influence linear-blend
skinning. It has no way to pleat, so *every* fold pose creases it into flat
blades however good the joint angles are — that is a property of the skinning,
not of the numbers. So past halfway through the fold it is put away instead:

- `tools/rig_dragon.py` splits the membrane onto its own `wing_membrane`
  material, so glTF gives it its own primitive and three gives that its own
  mesh, which `dragonrig.js` switches off.
- the root stub left behind is collapsed by scaling `Wing_Shoulder` (scale
  inherits, so the arm and all eighteen digits go with it), which pulls the cut
  edge in against his flank rather than leaving a hole in his side.

Finding the membrane took four goes and the failures are worth knowing. By
`|x|` threshold: leaves the sail spanning his shoulders. By which bones own the
weight: the inboard part lies along his spine so the skinning gave it to `Spine`
and `Tail` — correctly, those are nearest — and it reads as body. By "is there
more of him underneath": true over the back, false at the hips where the sheet
sits level with it. By thin-shell flood fill: at this vertex density almost
every vertex has a neighbour a few hundredths away, so "thin" selected the whole
dragon. What works is a height cut for the part lying over his back plus a
**measured half-width profile** for the part sweeping over his hips, tested on
the *face centroid* — the mesh there is coarse enough that single triangles span
from the spine to past his flank, so requiring every corner to be outside left
the whole inboard sheet behind.

Under half-fold the solved pose below still runs, so the wing visibly gathers in
before it goes.

## The folded pose, for the first half of the fold

Solved, not authored:

    node tools/solve_fold.mjs      # rewrites js/foldpose.js

It lays the wing along the ribcage in a bat's Z-fold — humerus caudal, forearm
flexed back on it, hand folded forward again, digits stacked down the flank —
and relaxes it with bone lengths, the ribcage and the floor as hard constraints,
so it cannot produce a wing that stretches, clips through his chest, or reaches
the ground. Edit `ARM_PATH` / `DIGIT_PATH` there to change the shape.

Don't go back to hand-tuned angles. It does not converge: a wing fold has an
elbow, a wrist and eighteen digit joints that all interact, and the numbers you
can measure are blind to the failure — span reads the same folded or spread,
because the widest point of a folded wing is the shoulder root, which the fold
never moves.

### If you do touch rotations by hand

`bone.rotation.z += d` is **not** a turn about that bone's own Z. With three's
default XYZ euler order a delta on x post-multiplies, so it turns about the bone
axis — but a delta on y or z pre-multiplies, so it turns about the *parent's*.
Angles measured in Blender, where pose-bone eulers are bone-local, do not
transfer: the same fold measured 2.99 units of span applied about bone axes and
4.48 applied about parent axes.

## In the air

`js/flightrig.js` drives everything the wingbeat doesn't, and runs after
`wings.js` each frame without touching a clavicle:

- **legs tucked** — he used to cross the whole archipelago with them in the
  standing pose, hanging down like landing gear nobody retracted
- **wing camber and washout** — the membrane bellies under load and the outer
  spars answer late, because there is more wing between them and the shoulder
- **wrist flex on the upstroke**, so he isn't dragging a full wing back up
- **tail fins as rudder and elevator** — differential into a turn, together with
  climb, fanned open when slow and furled when fast
- tail carving into the turn, head leaning into it, crest flattening and ears
  sweeping back with speed

`?stage=flight` on the URL skips the title and prologue straight to the
archipelago.

## Compatibility with the js

Every bone name `js/dragonrig.js`, `js/wings.js` and `js/wingposes.js` reach for
exists here, spelled the same (three.js strips the dots, so `Wing_Finger.016.L`
arrives as `Wing_Finger016L`). The bone axes were rolled to match what that code
assumes:

| chain | local X | local Z |
| --- | --- | --- |
| wing arm (`Wing_Clavicle/Shoulder/UpperArm/Forearm`) | beat up/down | sweep fore/aft |
| wing digits (`Wing_Finger.*`) | fan the strut in the wing plane | in-plane, mirrored per side |
| legs | swing fore/aft | tail-ward |
| spine / neck / tail | pitch | up (yaw) |

Both wings still take the **same sign on X** and mirror only on Z — the fact
`_probe.html` measured on the old rig holds on this one too.

## What is new since the 95-bone rig

- a real wing **elbow**: `Wing_Forearm.L/R`, so shoulder → humerus → forearm →
  wrist → digits instead of one bone from shoulder to wrist
- a **three-link spine** (`Spine`, `Spine.001`, `Spine.002`) over a `Hips`, on a
  `Root` master, rather than one `Spine` bone carrying the whole animal
- the neck is parented **spine → head**; the old rig had the chain inverted with
  `Neck.003` as the skeleton root
- an articulated **`Jaw`** and `Jaw_Tip`, `Snout`, `Eye.L/R`
- five **head appendages a side**: `Ear_A.001/.002`, `Ear_B.001/.002`, `Ear_C`
- **individual toes**: `Front_Digit.001-003`, `Hind_Digit.001-003` a side, plus
  `Front_Spur` for the heel spurs
- tail-fin struts are **mirrored and two-segment** (`Tail_Fin_Strut.00n` +
  `Tail_Fin_Tip.00n`, six a side). In the old rig `Tail_Fin_Strut.003.L` and
  `.R` sat at the same coordinate
- a **`Dorsal.001-008`** crest along the back
- `Root` is a transform-only bone and owns no vertices

## Where the bones are

Positions were measured off the mesh rather than eyeballed — see the header of
`tools/rig_dragon.py`. The two that matter most:

- the wing knuckle is at glTF `(∓2.43, 1.42, −2.00)`, where all six membrane
  creases converge
- the six digit tips sit on the outline's scallop peaks, at 109°, 85°, 64°, 40°,
  19° and −2° measured about that knuckle. `Wing_Finger.016-.018` is the −2° one:
  the main spar down the leading edge that carries the wingtip

## Skinning

Weights come from **surface distance, not straight-line distance**. On this model
that is the whole game: the wing membrane sits at Y = 1.42 and the dragon's back
at 1.39, three centimetres apart in space but a long way apart across the skin.
Euclidean falloff glues the membrane to the spine. Measured on the result:

| region | share of weight on the right bones |
| --- | --- |
| outer wing membrane → `Wing_*` | 100% |
| wing root membrane → `Wing_*` / `Tail_Sail_*` | 100% |
| torso back → spine family | 73% (rest is neck / tail, 0% on wing digits) |
| left front foot → left front limb | 100% (0% on any `.R` bone) |
| left hind foot → left hind limb | 100% (0% on the front limb) |
| mid tail → `Tail.*` | 100% |
| tail fin → struts / tail | 99.9% |

Four influences per vertex, mean 3.91, every weight set normalised.

## Hierarchy

```
Root
  Hips
    Spine
      Spine.001
        Spine.002
          Neck.001
            Neck.002
              Neck.003
                Head
                  Snout
                  Jaw
                    Jaw_Tip
                    Ear_C.L
                    Ear_C.R
                  Eye.L
                  Ear_A.001.L
                    Ear_A.002.L
                  Ear_B.001.L
                    Ear_B.002.L
                  Eye.R
                  Ear_A.001.R
                    Ear_A.002.R
                  Ear_B.001.R
                    Ear_B.002.R
          Dorsal.001
          Wing_Clavicle.L
            Wing_Shoulder.L
              Wing_UpperArm.L
                Wing_Forearm.L
                  Wing_Finger.001.L
                    Wing_Finger.002.L
                      Wing_Finger.003.L
                  Wing_Finger.004.L
                    Wing_Finger.005.L
                      Wing_Finger.006.L
                  Wing_Finger.007.L
                    Wing_Finger.008.L
                      Wing_Finger.009.L
                  Wing_Finger.010.L
                    Wing_Finger.011.L
                      Wing_Finger.012.L
                  Wing_Finger.013.L
                    Wing_Finger.014.L
                      Wing_Finger.015.L
                  Wing_Finger.016.L
                    Wing_Finger.017.L
                      Wing_Finger.018.L
          Wing_Clavicle.R
            Wing_Shoulder.R
              Wing_UpperArm.R
                Wing_Forearm.R
                  Wing_Finger.001.R
                    Wing_Finger.002.R
                      Wing_Finger.003.R
                  Wing_Finger.004.R
                    Wing_Finger.005.R
                      Wing_Finger.006.R
                  Wing_Finger.007.R
                    Wing_Finger.008.R
                      Wing_Finger.009.R
                  Wing_Finger.010.R
                    Wing_Finger.011.R
                      Wing_Finger.012.R
                  Wing_Finger.013.R
                    Wing_Finger.014.R
                      Wing_Finger.015.R
                  Wing_Finger.016.R
                    Wing_Finger.017.R
                      Wing_Finger.018.R
          Shoulder_Clavicle.L
            UpperArm.L
              Forearm.L
                Wrist.L
                  Front_Toe.L
                    Front_Digit.001.L
                    Front_Digit.002.L
                    Front_Digit.003.L
                Front_Spur.L
          Shoulder_Clavicle.R
            UpperArm.R
              Forearm.R
                Wrist.R
                  Front_Toe.R
                    Front_Digit.001.R
                    Front_Digit.002.R
                    Front_Digit.003.R
                Front_Spur.R
        Dorsal.002
        Tail_Sail_Strut_01.L
        Tail_Sail_Strut_02.L
        Tail_Sail_Strut_03.L
        Tail_Sail_Strut_01.R
        Tail_Sail_Strut_02.R
        Tail_Sail_Strut_03.R
      Dorsal.003
      Dorsal.004
    Dorsal.005
    Dorsal.006
    Tail.001
      Dorsal.007
      Dorsal.008
      Tail.002
        Tail.003
          Tail.004
            Tail.005
              Tail.006
                Tail.007
                  Tail.008
                    Tail.009
                      Tail.010
                        Tail.011
                          Tail_tip
                          Tail_Fin_Strut.005.L
                            Tail_Fin_Tip.005.L
                          Tail_Fin_Strut.006.L
                            Tail_Fin_Tip.006.L
                          Tail_Fin_Strut.005.R
                            Tail_Fin_Tip.005.R
                          Tail_Fin_Strut.006.R
                            Tail_Fin_Tip.006.R
                        Tail_Fin_Strut.003.L
                          Tail_Fin_Tip.003.L
                        Tail_Fin_Strut.004.L
                          Tail_Fin_Tip.004.L
                        Tail_Fin_Strut.003.R
                          Tail_Fin_Tip.003.R
                        Tail_Fin_Strut.004.R
                          Tail_Fin_Tip.004.R
                      Tail_Fin_Strut.001.L
                        Tail_Fin_Tip.001.L
                      Tail_Fin_Strut.002.L
                        Tail_Fin_Tip.002.L
                      Tail_Fin_Strut.001.R
                        Tail_Fin_Tip.001.R
                      Tail_Fin_Strut.002.R
                        Tail_Fin_Tip.002.R
    Hip.L
      Thigh.L
        Shin.L
          Ankle.L
            Toe.L
              Hind_Digit.001.L
              Hind_Digit.002.L
              Hind_Digit.003.L
    Hip.R
      Thigh.R
        Shin.R
          Ankle.R
            Toe.R
              Hind_Digit.001.R
              Hind_Digit.002.R
              Hind_Digit.003.R
```

## Flat list

```
Root
Hips
Spine
Spine.001
Spine.002
Neck.001
Neck.002
Neck.003
Head
Snout
Jaw
Jaw_Tip
Ear_C.L
Ear_C.R
Eye.L
Ear_A.001.L
Ear_A.002.L
Ear_B.001.L
Ear_B.002.L
Eye.R
Ear_A.001.R
Ear_A.002.R
Ear_B.001.R
Ear_B.002.R
Dorsal.001
Wing_Clavicle.L
Wing_Shoulder.L
Wing_UpperArm.L
Wing_Forearm.L
Wing_Finger.001.L
Wing_Finger.002.L
Wing_Finger.003.L
Wing_Finger.004.L
Wing_Finger.005.L
Wing_Finger.006.L
Wing_Finger.007.L
Wing_Finger.008.L
Wing_Finger.009.L
Wing_Finger.010.L
Wing_Finger.011.L
Wing_Finger.012.L
Wing_Finger.013.L
Wing_Finger.014.L
Wing_Finger.015.L
Wing_Finger.016.L
Wing_Finger.017.L
Wing_Finger.018.L
Wing_Clavicle.R
Wing_Shoulder.R
Wing_UpperArm.R
Wing_Forearm.R
Wing_Finger.001.R
Wing_Finger.002.R
Wing_Finger.003.R
Wing_Finger.004.R
Wing_Finger.005.R
Wing_Finger.006.R
Wing_Finger.007.R
Wing_Finger.008.R
Wing_Finger.009.R
Wing_Finger.010.R
Wing_Finger.011.R
Wing_Finger.012.R
Wing_Finger.013.R
Wing_Finger.014.R
Wing_Finger.015.R
Wing_Finger.016.R
Wing_Finger.017.R
Wing_Finger.018.R
Shoulder_Clavicle.L
UpperArm.L
Forearm.L
Wrist.L
Front_Toe.L
Front_Digit.001.L
Front_Digit.002.L
Front_Digit.003.L
Front_Spur.L
Shoulder_Clavicle.R
UpperArm.R
Forearm.R
Wrist.R
Front_Toe.R
Front_Digit.001.R
Front_Digit.002.R
Front_Digit.003.R
Front_Spur.R
Dorsal.002
Tail_Sail_Strut_01.L
Tail_Sail_Strut_02.L
Tail_Sail_Strut_03.L
Tail_Sail_Strut_01.R
Tail_Sail_Strut_02.R
Tail_Sail_Strut_03.R
Dorsal.003
Dorsal.004
Dorsal.005
Dorsal.006
Tail.001
Dorsal.007
Dorsal.008
Tail.002
Tail.003
Tail.004
Tail.005
Tail.006
Tail.007
Tail.008
Tail.009
Tail.010
Tail.011
Tail_tip
Tail_Fin_Strut.005.L
Tail_Fin_Tip.005.L
Tail_Fin_Strut.006.L
Tail_Fin_Tip.006.L
Tail_Fin_Strut.005.R
Tail_Fin_Tip.005.R
Tail_Fin_Strut.006.R
Tail_Fin_Tip.006.R
Tail_Fin_Strut.003.L
Tail_Fin_Tip.003.L
Tail_Fin_Strut.004.L
Tail_Fin_Tip.004.L
Tail_Fin_Strut.003.R
Tail_Fin_Tip.003.R
Tail_Fin_Strut.004.R
Tail_Fin_Tip.004.R
Tail_Fin_Strut.001.L
Tail_Fin_Tip.001.L
Tail_Fin_Strut.002.L
Tail_Fin_Tip.002.L
Tail_Fin_Strut.001.R
Tail_Fin_Tip.001.R
Tail_Fin_Strut.002.R
Tail_Fin_Tip.002.R
Hip.L
Thigh.L
Shin.L
Ankle.L
Toe.L
Hind_Digit.001.L
Hind_Digit.002.L
Hind_Digit.003.L
Hip.R
Thigh.R
Shin.R
Ankle.R
Toe.R
Hind_Digit.001.R
Hind_Digit.002.R
Hind_Digit.003.R
```
