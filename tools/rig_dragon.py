"""
Build a high-density skeleton for assets/models/dragon.glb and skin it.

Run with:
    blender -b -noaudio --python tools/rig_dragon.py

Nothing is overwritten. The script reads dragon.glb (which has no skin at all)
and writes new files alongside it; see OUT_GLB / OUT_BLEND at the bottom.

------------------------------------------------------------------------------
Coordinate frame
------------------------------------------------------------------------------
dragon.glb is a Sketchfab OBJ conversion whose root empty carries a rotation
that cancels Blender's Y-up import, so *Blender world space equals the raw glTF
vertex frame*:

    +X   the dragon's LEFT, out along the wing      (span +/- 7.546)
    +Y   tail-ward; the nose is at Y = -3.50, the tail membrane ends at +5.09
    +Z   up   (he lies flat, only 1.596 units thick)

Every coordinate in BONES below is written in that frame, because that is the
frame the model was measured in. `SRC_TO_OUT` then turns it 180 degrees about Z
just before export, which is what makes the exported file land in exactly the
same frame as the existing toothless_rigged.glb:

    glTF X = lateral, .L on -X      glTF Y = up      glTF Z = nose -3.50 .. tail

------------------------------------------------------------------------------
Where the numbers came from
------------------------------------------------------------------------------
Bone positions are not guesses. They were measured off the mesh:

  * the spine/neck/tail line is the mid-height of the body cross-section taken
    in 0.12-unit slabs along Y, with the torso biased up to ~68% of body height
    where the section is a deep oval rather than a round tube;
  * the wing knuckle (2.43, -2.00, 1.42) is where the six membrane creases
    converge -- found by extrapolating each crease edge back to the leading
    edge, which agreed to within 0.03;
  * the six digit tips are the local maxima of the membrane outline's radius
    measured about that knuckle (109 deg, 85, 64, 40, 19, -2);
  * leg joints are the centroids of 0.06-unit horizontal slabs through each
    limb, which is what picks up the backward hock and the forward knee;
  * head features were read off an orthographic side render with a 0.1-unit
    marker grid composited into it.

------------------------------------------------------------------------------
Naming
------------------------------------------------------------------------------
Every bone name the game already drives is kept, spelled exactly as before, so
this rig is a drop-in for toothless_rigged.glb:

    Spine  Neck.001..003  Head  Tail.001..011  Tail_tip
    Wing_Clavicle/Shoulder/UpperArm.L/R   Wing_Finger.001..018.L/R
    Shoulder_Clavicle/UpperArm/Forearm/Wrist/Front_Toe.L/R
    Hip/Thigh/Shin/Ankle/Toe.L/R          Tail_Fin_Strut.001..005.L/R
    Tail_Sail_Strut_01..03.L/R

(three.js strips the dots, so `Wing_Finger.016.L` reaches js as
`Wing_Finger016L` -- which is what js/dragonrig.js already looks for.)

Everything else is new detail: a proper wing forearm, jaw, eyes, ear flaps,
individual toes, a second segment on every tail-fin strut, and a dorsal crest.
"""

import math
import os
import re
import sys
import time

import bpy
import bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_GLB = os.path.join(HERE, "assets", "models", "dragon.glb")
OUT_GLB = os.path.join(HERE, "assets", "models", "dragon_rigged_hd.glb")
OUT_BLEND = os.path.join(HERE, "assets", "models", "dragon_rigged_hd.blend")


def log(*a):
    print("[rig]", *a)
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Measured landmarks
# ---------------------------------------------------------------------------

# Spine height as a function of Y, sampled from the body cross-sections.
SPINE_CURVE = [
    (-3.50, 0.745), (-3.20, 0.800), (-2.95, 0.855), (-2.70, 0.930),
    (-2.45, 0.985), (-2.20, 1.020), (-2.00, 1.060), (-1.70, 1.100),
    (-1.40, 1.130), (-1.10, 1.140), (-0.80, 1.140), (-0.50, 1.120),
    (-0.25, 1.090), (0.00, 1.062), (0.40, 1.011), (0.70, 0.987),
    (1.00, 0.950), (1.30, 0.930), (1.60, 0.900), (2.00, 0.895),
    (2.50, 0.878), (3.00, 0.870), (3.50, 0.867), (4.00, 0.870),
    (4.40, 0.866),
]


def spine_z(y):
    """Height of the vertebral line at a given Y, linearly interpolated."""
    xs = [p[0] for p in SPINE_CURVE]
    zs = [p[1] for p in SPINE_CURVE]
    return float(np.interp(y, xs, zs))


# The wing knuckle: where all six membrane creases meet, on the leading edge.
WRIST = Vector((2.43, -2.00, 1.42))

# Digit tips, in outline order from the innermost strut to the wingtip.
# Digit 6 is the main spar -- it is the leading edge and it carries the tip,
# which is why the game's fold pose only really needs Wing_Finger.016-.018.
DIGIT_TIPS = [
    Vector((1.613, 0.438, 1.422)),   # 1 -> Wing_Finger.001 .002 .003
    Vector((2.598, 0.722, 1.422)),   # 2 -> .004 .005 .006
    Vector((3.606, 0.676, 1.422)),   # 3 -> .007 .008 .009
    Vector((4.833, 0.312, 1.422)),   # 4 -> .010 .011 .012
    Vector((6.222, -0.450, 1.422)),  # 5 -> .013 .014 .015
    Vector((7.546, -1.997, 1.422)),  # 6 -> .016 .017 .018  (main spar)
]
# Segment split along each digit. A bat-style hand: long metacarpal, then two
# shorter phalanges.
DIGIT_SPLIT = [0.44, 0.75, 1.00]

# Tail-fin struts: (root Y on the tail, tip XY on the fin outline).
FIN_STRUTS = [
    (2.90, (0.55, 3.40)),
    (3.12, (0.80, 3.80)),
    (3.34, (1.00, 4.15)),
    (3.58, (1.09, 4.64)),
    (3.84, (0.92, 5.02)),
    (4.05, (0.45, 4.80)),
]

# Dorsal crest plates, by Y. Each gets one short bone standing off the back.
DORSAL_Y = [-1.62, -1.32, -1.02, -0.72, -0.42, -0.12, 0.30, 0.75]

TAIL_SEGMENTS = 11
TAIL_START = 0.05
TAIL_END = 3.95
TAIL_TIP_END = 4.37


# ---------------------------------------------------------------------------
# Bone table
# ---------------------------------------------------------------------------
# Each entry: name, parent, head, tail, roll target, connected.
#
# `roll` is the direction the bone's local +Z should point at. That choice is
# what makes the existing js work, because js/wings.js and js/dragonrig.js drive
# these bones on named local axes:
#
#   wing arm bones   local Z = world up  -> rotating local Z sweeps the wing
#                                           fore/aft, local X beats it up/down
#   wing digits      local Z in the wing plane, mirrored per side -> rotating
#                                           local X fans the strut back, same
#                                           sign on both wings (which is what
#                                           _probe.html measured on the old rig)
#   legs             local Z = tail-ward -> local X is the lateral axis, so
#                                           rotating X swings the leg fore/aft
#   spine/neck/tail  local Z = world up

UP = Vector((0, 0, 1))
BACK = Vector((0, 1, 0))

bones = []


def bone(name, parent, head, tail, roll=UP, connected=False,
         reach=1.0, deform=True):
    """
    reach   scales how far this bone's influence spreads across the skin.
            A wing spar has to hold a metre of membrane; an eyelid must not
            drag the whole snout with it. 1.0 = the default DMAX.
    deform  False for pure transform bones that should own no vertices.
    """
    bones.append({
        "name": name,
        "parent": parent,
        "head": Vector(head),
        "tail": Vector(tail),
        "roll": Vector(roll),
        "connected": connected,
        "reach": reach,
        "deform": deform,
    })


def sy(y, dz=0.0):
    """A point on the spine line at Y."""
    return (0.0, y, spine_z(y) + dz)


# --- master -----------------------------------------------------------------
bone("Root", None, (0, 0.30, 0.0), (0, -0.90, 0.0), BACK, deform=False)

# --- pelvis and spine -------------------------------------------------------
# `Spine` stays the torso hub the game expects, but it is now one link in a
# real chain instead of a single bone carrying the whole animal.
bone("Hips", "Root", sy(0.05), sy(-0.45))
bone("Spine", "Hips", sy(-0.45), sy(-1.05), connected=True)
bone("Spine.001", "Spine", sy(-1.05), sy(-1.60), connected=True)
bone("Spine.002", "Spine.001", sy(-1.60), sy(-2.05), connected=True)

# --- neck and head ----------------------------------------------------------
bone("Neck.001", "Spine.002", sy(-2.05), sy(-2.30), connected=True)
bone("Neck.002", "Neck.001", sy(-2.30), sy(-2.54), connected=True)
bone("Neck.003", "Neck.002", sy(-2.54), sy(-2.78), connected=True)
bone("Head", "Neck.003", (0, -2.78, 0.950), (0, -3.24, 0.858), connected=True)
bone("Snout", "Head", (0, -3.24, 0.858), (0, -3.50, 0.800), connected=True, reach=0.6)
bone("Jaw", "Head", (0, -2.82, 0.800), (0, -3.34, 0.690))
bone("Jaw_Tip", "Jaw", (0, -3.34, 0.690), (0, -3.50, 0.665), connected=True, reach=0.5)

for s, side in ((1, "L"), (-1, "R")):
    bone(f"Eye.{side}", "Head", (0.22 * s, -3.30, 0.800), (0.25 * s, -3.42, 0.795),
         reach=0.16)
    # Three appendages a side: the big swept ear plate, a lower flap, and the
    # little jaw fin. All three are visible in a side render at X ~ 0.3-0.5.
    bone(f"Ear_A.001.{side}", "Head", (0.22 * s, -2.80, 0.940), (0.42 * s, -2.50, 1.060),
         reach=0.45)
    bone(f"Ear_A.002.{side}", f"Ear_A.001.{side}",
         (0.42 * s, -2.50, 1.060), (0.50 * s, -2.12, 1.130), connected=True, reach=0.45)
    bone(f"Ear_B.001.{side}", "Head", (0.26 * s, -2.86, 0.800), (0.36 * s, -2.62, 0.780),
         reach=0.35)
    bone(f"Ear_B.002.{side}", f"Ear_B.001.{side}",
         (0.36 * s, -2.62, 0.780), (0.40 * s, -2.40, 0.762), connected=True, reach=0.35)
    bone(f"Ear_C.{side}", "Jaw", (0.24 * s, -2.84, 0.700), (0.34 * s, -2.62, 0.630),
         reach=0.30)

# --- dorsal crest -----------------------------------------------------------
for i, y in enumerate(DORSAL_Y, 1):
    # Parent to whichever spine/tail link covers this Y.
    if y < -1.60:
        par = "Spine.002"
    elif y < -1.05:
        par = "Spine.001"
    elif y < -0.45:
        par = "Spine"
    elif y < 0.05:
        par = "Hips"
    else:
        par = "Tail.001"
    top = 1.40 if y < 0.0 else 1.40 - (y * 0.30)
    bone(f"Dorsal.{i:03d}", par, (0, y, top - 0.10), (0, y - 0.03, top + 0.14),
         reach=0.22)

# --- tail -------------------------------------------------------------------
step = (TAIL_END - TAIL_START) / TAIL_SEGMENTS
for i in range(TAIL_SEGMENTS):
    y0 = TAIL_START + step * i
    y1 = y0 + step
    par = "Hips" if i == 0 else f"Tail.{i:03d}"
    bone(f"Tail.{i + 1:03d}", par, sy(y0), sy(y1), connected=(i > 0))
bone("Tail_tip", f"Tail.{TAIL_SEGMENTS:03d}", sy(TAIL_END), sy(TAIL_TIP_END), connected=True)


def tail_bone_at(y):
    """Which tail link contains this Y."""
    idx = int((y - TAIL_START) / step) + 1
    return f"Tail.{min(max(idx, 1), TAIL_SEGMENTS):03d}"


# --- tail fins --------------------------------------------------------------
FIN_Z = 0.884
for s, side in ((1, "L"), (-1, "R")):
    for i, (rooty, (tx, ty)) in enumerate(FIN_STRUTS, 1):
        root = Vector((0.05 * s, rooty, FIN_Z))
        tip = Vector((tx * s, ty, FIN_Z))
        mid = root.lerp(tip, 0.55)
        d = (tip - root).normalized()
        # Fan in the fin plane: local X becomes the plane normal, so rotating a
        # strut on X spreads or furls the fin instead of twisting it.
        roll = UP.cross(d) * s
        bone(f"Tail_Fin_Strut.{i:03d}.{side}", tail_bone_at(rooty), root, mid, roll)
        bone(f"Tail_Fin_Tip.{i:03d}.{side}", f"Tail_Fin_Strut.{i:03d}.{side}",
             mid, tip, roll, connected=True)

# --- wings ------------------------------------------------------------------
for s, side in ((1, "L"), (-1, "R")):
    def m(v):
        return Vector((v.x * s, v.y, v.z))

    clav_h = m(Vector((0.10, -1.85, 1.28)))
    shou_h = m(Vector((0.55, -1.95, 1.380)))
    arm_h = m(Vector((1.10, -1.98, 1.410)))
    fore_h = m(Vector((1.80, -1.99, 1.418)))
    wrist = m(WRIST)

    bone(f"Wing_Clavicle.{side}", "Spine.002", clav_h, shou_h, UP)
    bone(f"Wing_Shoulder.{side}", f"Wing_Clavicle.{side}", shou_h, arm_h, UP, True)
    bone(f"Wing_UpperArm.{side}", f"Wing_Shoulder.{side}", arm_h, fore_h, UP, True)
    bone(f"Wing_Forearm.{side}", f"Wing_UpperArm.{side}", fore_h, wrist, UP, True)

    for d_i, tip in enumerate(DIGIT_TIPS):
        tip = m(tip)
        d = (tip - wrist).normalized()
        roll = UP.cross(d) * s
        prev = f"Wing_Forearm.{side}"
        at = wrist
        for seg in range(3):
            nxt = wrist.lerp(tip, DIGIT_SPLIT[seg])
            n = f"Wing_Finger.{d_i * 3 + seg + 1:03d}.{side}"
            bone(n, prev, at, nxt, roll, connected=(seg > 0))
            prev, at = n, nxt

    # The membrane's inboard edge runs down the flank, not off the wing. These
    # hold it to the body so a wingbeat does not peel the dragon's side off.
    for i, (y0, y1) in enumerate(((-1.35, -1.10), (-1.00, -0.65), (-0.62, -0.20)), 1):
        bone(f"Tail_Sail_Strut_{i:02d}.{side}", "Spine.001",
             (0.28 * s, y0, spine_z(y0) + 0.16), (0.98 * s, y1, 1.410), UP)

# --- front legs -------------------------------------------------------------
for s, side in ((1, "L"), (-1, "R")):
    bone(f"Shoulder_Clavicle.{side}", "Spine.002",
         (0.12 * s, -2.02, 1.020), (0.36 * s, -2.12, 0.900), BACK)
    bone(f"UpperArm.{side}", f"Shoulder_Clavicle.{side}",
         (0.36 * s, -2.12, 0.900), (0.42 * s, -1.86, 0.580), BACK, True)
    bone(f"Forearm.{side}", f"UpperArm.{side}",
         (0.42 * s, -1.86, 0.580), (0.43 * s, -1.70, 0.260), BACK, True)
    bone(f"Wrist.{side}", f"Forearm.{side}",
         (0.43 * s, -1.70, 0.260), (0.42 * s, -1.88, 0.080), BACK, True)
    bone(f"Front_Toe.{side}", f"Wrist.{side}",
         (0.42 * s, -1.88, 0.080), (0.41 * s, -2.06, 0.030), BACK, True)
    for i, dx in enumerate(((-0.09, -0.06), (0.0, 0.0), (0.09, 0.07)), 1):
        bone(f"Front_Digit.{i:03d}.{side}", f"Front_Toe.{side}",
             ((0.42 + dx[0]) * s, -1.94, 0.048), ((0.42 + dx[1] * 2.2) * s, -2.14, 0.020),
             BACK, reach=0.28)
    # The three spurs behind the wrist.
    bone(f"Front_Spur.{side}", f"Forearm.{side}",
         (0.42 * s, -1.72, 0.300), (0.42 * s, -1.55, 0.225), BACK, reach=0.30)

# --- hind legs --------------------------------------------------------------
for s, side in ((1, "L"), (-1, "R")):
    bone(f"Hip.{side}", "Hips",
         (0.10 * s, -0.55, 1.100), (0.32 * s, -0.82, 1.020), BACK)
    bone(f"Thigh.{side}", f"Hip.{side}",
         (0.32 * s, -0.82, 1.020), (0.38 * s, -0.92, 0.620), BACK, True)
    bone(f"Shin.{side}", f"Thigh.{side}",
         (0.38 * s, -0.92, 0.620), (0.40 * s, -0.76, 0.220), BACK, True)
    bone(f"Ankle.{side}", f"Shin.{side}",
         (0.40 * s, -0.76, 0.220), (0.39 * s, -0.86, 0.060), BACK, True)
    bone(f"Toe.{side}", f"Ankle.{side}",
         (0.39 * s, -0.86, 0.060), (0.38 * s, -1.00, 0.028), BACK, True)
    for i, dx in enumerate(((-0.09, -0.06), (0.0, 0.0), (0.09, 0.07)), 1):
        bone(f"Hind_Digit.{i:03d}.{side}", f"Toe.{side}",
             ((0.39 + dx[0]) * s, -0.90, 0.048), ((0.39 + dx[1] * 2.2) * s, -1.08, 0.020),
             BACK, reach=0.28)


# ---------------------------------------------------------------------------
# Frame conversion, applied to bones and mesh alike right at build time.
# 180 degrees about Z: what makes Blender's +Y-up export land nose-on--Z.
# ---------------------------------------------------------------------------

def SRC_TO_OUT(v):
    return Vector((-v[0], -v[1], v[2]))


# ---------------------------------------------------------------------------
# Scene build
# ---------------------------------------------------------------------------

def check_frame(obj):
    """Fail loudly if the mesh is not where the bone table thinks it is.

    Getting this wrong is silent: the rig still exports, it just skins the
    dragon to a skeleton standing in a different orientation. Measured source
    bounds, turned 180 degrees about Z.
    """
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    want_lo = np.array([-7.546, -5.088, 0.003])
    want_hi = np.array([7.546, 3.501, 1.596])
    if not (np.allclose(lo, want_lo, atol=0.01) and np.allclose(hi, want_hi, atol=0.01)):
        raise SystemExit(
            f"mesh is in an unexpected frame: {lo.round(3)} .. {hi.round(3)}, "
            f"expected {want_lo} .. {want_hi}")
    log(f"frame ok: {lo.round(3)} .. {hi.round(3)}")


MEMBRANE_MAT = "wing_membrane"
MEMBRANE_Z = 1.27     # the membrane is a sheet lying at this height and above
MEMBRANE_X = 0.30     # ...and out beyond the dorsal crest, which is real body

# His actual half-width along the body, measured off the mesh in 0.2 slabs.
# Anything wider than this plus a margin is membrane, not him — which is what
# catches the part that sweeps over his hips and down the tail, where the sheet
# drops well below MEMBRANE_Z and a height rule cannot see it.
BODY_HALF_WIDTH = [
    (-3.5, 0.20), (-3.2, 0.35), (-2.8, 0.42), (-2.5, 0.55), (-2.2, 0.60),
    (-1.6, 0.62), (-1.0, 0.62), (-0.6, 0.55), (-0.3, 0.42), (0.0, 0.30),
    (0.4, 0.22), (0.8, 0.17), (1.2, 0.15), (1.8, 0.14), (2.4, 0.13),
    (2.6, 0.13),
]
WIDTH_MARGIN = 0.06
FIN_FROM = 2.62       # past here is tail fin, which stays


def split_membrane(obj):
    """Give the wing membrane its own material, so the game can hide it.

    On the ground the wing is not folded, it is put away — a fifteen-unit sheet
    under four-influence linear-blend skinning has no way to pleat, so every
    fold pose creases it into flat blades however good the joint angles are.
    Hiding it needs something to hide, and the membrane arrives sharing one
    material with the whole outer skin.

    Three cleverer tests failed before this one. By which bones own the weight:
    the inboard part lies right along his spine, so the skinning gave it to
    Spine and Tail — correctly, those are nearest — and it reads as body. By "is
    there more of him underneath": true over the back, false at the hips where
    the sheet sits level with it. By thin-shell flood fill: at this vertex
    density almost every vertex has a neighbour a few hundredths away, so
    "thin" selected the whole dragon.

    What is simply true is that the membrane is a flat sheet lying at a fixed
    height, out past the dorsal crest. The crest itself is the only real body
    that reaches up there and it sits inside |x| 0.22, so the cut misses it.
    Where the sheet lies *on* his back rather than off it, cutting it exposes
    the back underneath, which is a closed surface — no hole.
    """
    src = next((i for i, m in enumerate(obj.data.materials)
                if m and m.name.startswith("acmat_0")), 0)
    mat = obj.data.materials[src].copy()
    mat.name = MEMBRANE_MAT
    obj.data.materials.append(mat)
    slot = len(obj.data.materials) - 1

    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)

    # The tool works in the exported frame, where y runs tail-to-nose; the
    # measured profile above is nose-to-tail, hence the negation.
    wy = [-p[0] for p in BODY_HALF_WIDTH][::-1]
    wv = [p[1] for p in BODY_HALF_WIDTH][::-1]

    moved = 0
    for poly in obj.data.polygons:
        if poly.material_index != src:
            continue
        vs = co[list(poly.vertices)]
        # Test the face centroid, not every corner. The mesh is coarse over the
        # hips — single triangles span from the spine to well past his flank —
        # so requiring every vertex to be outside left the whole inboard sheet
        # behind, which is what three earlier attempts at this kept missing.
        c = vs.mean(axis=0)
        overBack = c[2] > MEMBRANE_Z and abs(c[0]) > MEMBRANE_X
        width = float(np.interp(c[1], wy, wv)) + WIDTH_MARGIN
        beside = abs(c[0]) > width and c[1] > -FIN_FROM
        if overBack or beside:
            poly.material_index = slot
            moved += 1
    log(f"membrane split: {moved} faces -> {MEMBRANE_MAT}")


def load_mesh():
    """Import dragon.glb, flatten it to one object in world space, then turn it."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC_GLB)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in bpy.data.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()

    obj = bpy.context.view_layer.objects.active
    obj.name = "Toothless"
    obj.data.name = "Toothless"

    # Unparent KEEPING the world transform. dragon.glb hangs the mesh under a
    # Sketchfab empty whose rotation cancels Blender's Y-up import, so a plain
    # `obj.parent = None` silently drops the model back into raw glTF axes and
    # every bone below lands somewhere else entirely.
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Now bake the export turn, so mesh data and the bone table share a frame.
    # (The importer leaves objects in quaternion mode, where rotation_euler is
    # ignored -- set the mode or the turn silently does nothing.)
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = (0, 0, math.pi)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)

    check_frame(obj)
    log(f"mesh: {len(obj.data.vertices)} verts, {len(obj.data.polygons)} faces, "
        f"{len(obj.data.materials)} materials")
    return obj


def build_armature():
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    made = {}
    for b in bones:
        eb = arm_data.edit_bones.new(b["name"])
        eb.head = SRC_TO_OUT(b["head"])
        eb.tail = SRC_TO_OUT(b["tail"])
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.02))
        made[b["name"]] = eb

    for b in bones:
        eb = made[b["name"]]
        if b["parent"]:
            eb.parent = made[b["parent"]]
            eb.use_connect = bool(b["connected"])
        roll = SRC_TO_OUT(b["roll"])
        if roll.length > 1e-6:
            eb.align_roll(roll)

    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"armature: {len(arm_data.bones)} bones")
    return arm


# ---------------------------------------------------------------------------
# Skinning
# ---------------------------------------------------------------------------
# Weighting is done on surface distance, not straight-line distance, and that
# choice is the whole ballgame on this model. The wing membrane sits at
# Z = 1.42 and the dragon's back at Z = 1.39 -- three centimetres apart in
# space, but a long way apart across the skin. Euclidean falloff glues the
# membrane to the spine and the wings stop working. Walking the mesh gets it
# right for free, and it separates the four feet (only 0.8 apart) at the same
# time.

DMAX = 1.7          # stop walking past here; nothing this far contributes
STITCH = 0.010      # weld radius for shells that touch but do not share verts
MAX_INFLUENCES = 4  # glTF JOINTS_0 / three.js skinning limit
SMOOTH_PASSES = 8


def segment_distance(pts, a, b):
    ab = b - a
    L2 = float(ab @ ab)
    if L2 < 1e-12:
        return np.linalg.norm(pts - a, axis=1)
    t = np.clip(((pts - a) @ ab) / L2, 0.0, 1.0)
    proj = a[None, :] + t[:, None] * ab[None, :]
    return np.linalg.norm(pts - proj, axis=1)


def unique_topology(obj):
    """Weld coincident vertices so the mesh walks as one surface where it can."""
    n = len(obj.data.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)

    keys = np.round(co / 2e-4).astype(np.int64)
    _, uid, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    nu = len(uid)
    upos = np.zeros((nu, 3))
    np.add.at(upos, inv, co)
    counts = np.bincount(inv, minlength=nu).astype(float)
    upos /= counts[:, None]

    e = np.empty(len(obj.data.edges) * 2, dtype=np.int32)
    obj.data.edges.foreach_get("vertices", e)
    e = inv[e.reshape(-1, 2)]
    e = e[e[:, 0] != e[:, 1]]

    e = np.concatenate([e, stitch_edges(upos)])
    e = np.unique(np.sort(e, axis=1), axis=0)

    log(f"welded {n} -> {nu} unique verts, {len(e)} edges, "
        f"{components(nu, e)} shells")
    return co, inv, upos, e


def stitch_edges(upos, r=STITCH):
    """Join shells that sit against each other without sharing a vertex.

    Toothless is a Sketchfab OBJ: the scales, dorsal plates, teeth and the whole
    saddle harness are separate closed shells resting on the skin, and the
    membrane is a doubled sheet. Without this the surface walk stops at every
    one of those seams and half the model falls back to a rigid parent. The
    radius is deliberately tiny -- the wing membrane clears the dragon's back by
    0.03, so it stays a surface of its own, which is the one seam that matters.
    """
    cell = np.floor(upos / r).astype(np.int64)
    table = {}
    for i, c in enumerate(map(tuple, cell)):
        table.setdefault(c, []).append(i)

    out = []
    r2 = r * r
    for c, members in table.items():
        near = []
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    near.extend(table.get((c[0] + dx, c[1] + dy, c[2] + dz), ()))
        if len(near) < 2:
            continue
        near = np.array(near)
        P = upos[near]
        for i in members:
            d2 = ((P - upos[i]) ** 2).sum(1)
            hit = near[d2 <= r2]
            for j in hit:
                if j != i:
                    out.append((i, j))
    return np.array(out, dtype=np.int64).reshape(-1, 2)


def components(nu, edges):
    par = np.arange(nu)

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a

    for u, v in edges:
        ru, rv = find(u), find(v)
        if ru != rv:
            par[ru] = rv
    return len(np.unique([find(i) for i in range(nu)]))


def padded_adjacency(nu, edges, upos, maxdeg=12):
    """CSR-ish neighbour table padded to a fixed width so it vectorises."""
    both = np.concatenate([edges, edges[:, ::-1]])
    order = np.argsort(both[:, 0], kind="stable")
    both = both[order]
    starts = np.searchsorted(both[:, 0], np.arange(nu))
    ends = np.searchsorted(both[:, 0], np.arange(nu), side="right")

    A = np.tile(np.arange(nu, dtype=np.int32)[:, None], (1, maxdeg))
    W = np.full((nu, maxdeg), np.inf, dtype=np.float32)
    for v in range(nu):
        s, t = starts[v], min(ends[v], starts[v] + maxdeg)
        k = t - s
        if k <= 0:
            continue
        nb = both[s:t, 1]
        A[v, :k] = nb
        W[v, :k] = np.linalg.norm(upos[nb] - upos[v], axis=1)
    return A, W


def geodesic_fields(upos, A, W, segs, dmax, chunk=16, iters=700):
    """Multi-source min-plus relaxation: one surface-distance field per bone.

    Seeding is the subtle part. A bone inside the ribcage is ~0.3 from the
    nearest skin, a wing strut lies *in* the membrane at ~0.005, so a fixed seed
    radius either starves the deep bones or floods the shallow ones. Each bone
    therefore seeds a cuff measured from its own closest vertex, and the field
    is zeroed at that vertex, so every bone starts flush with the skin and the
    weights compare like with like.
    """
    nb = len(segs)
    nu = len(upos)
    D = np.full((nb, nu), np.inf, dtype=np.float32)

    for i, (a, b) in enumerate(segs):
        d = segment_distance(upos, a, b).astype(np.float32)
        dmin = float(d.min())
        cuff = min(0.30, max(0.08, 0.30 * float(np.linalg.norm(b - a))))
        seed = d <= dmin + min(cuff, dmax[i] * 0.5)
        D[i, seed] = d[seed] - dmin

    t0 = time.time()
    used = 0
    for c0 in range(0, nb, chunk):
        d = D[c0:min(c0 + chunk, nb)].copy()
        lim = dmax[c0:c0 + len(d)][:, None]
        for it in range(iters):
            best = (d[:, A] + W[None, :, :]).min(axis=2)
            nd = np.minimum(d, best)
            nd[nd > lim] = np.inf
            if not np.any(nd < d - 1e-5):
                break
            d = nd
        used = max(used, it)
        D[c0:c0 + len(d)] = d
    log(f"geodesic fields in {time.time() - t0:.1f}s, {used} relaxations")
    return D


def build_weights(obj, arm):
    co, inv, upos, edges = unique_topology(obj)
    nu = len(upos)

    order = [b.name for b in arm.data.bones]
    lut = {b["name"]: b for b in bones}
    segs = [(np.array(SRC_TO_OUT(lut[n]["head"]), dtype=np.float64),
             np.array(SRC_TO_OUT(lut[n]["tail"]), dtype=np.float64)) for n in order]
    nb = len(order)

    dmax = np.array([DMAX * lut[n]["reach"] for n in order], dtype=np.float32)
    deform = np.array([lut[n]["deform"] for n in order])

    A, W = padded_adjacency(nu, edges, upos)
    D = geodesic_fields(upos, A, W, segs, dmax)
    D[~deform] = np.inf

    # Left/right gate. A backstop only -- surface distance already keeps the
    # wings apart -- but it costs nothing and it stops a weight leaking across
    # the belly between two feet that are only 0.8 units apart.
    for i, (a, b) in enumerate(segs):
        mid_x = (a[0] + b[0]) * 0.5
        if abs(mid_x) > 0.15:
            D[i, upos[:, 0] * np.sign(mid_x) < -0.06] = np.inf

    # Compactly supported inverse-square falloff: strong close in, exactly zero
    # at DMAX, no discontinuity in between.
    with np.errstate(divide="ignore", invalid="ignore"):
        Wt = np.clip(1.0 - D / dmax[:, None], 0.0, 1.0) ** 4 / (D + 0.03) ** 2
    Wt[~np.isfinite(D)] = 0.0
    Wt = Wt.astype(np.float32)

    reached = Wt.sum(axis=0) > 1e-12
    if (~reached).any():
        src = np.flatnonzero(reached)
        dst = np.flatnonzero(~reached)
        for k in range(0, len(dst), 1024):
            blk = dst[k:k + 1024]
            d2 = ((upos[blk][:, None, :] - upos[src][None, :, :]) ** 2).sum(2)
            Wt[:, blk] = Wt[:, src[d2.argmin(1)]]
        log(f"copied weights onto {len(dst)} still-detached verts")

    Wt /= Wt.sum(axis=0)[None, :]

    # Smooth across the surface. This is what turns a distance field into a
    # deformation that does not crease where two bones meet.
    finite = np.isfinite(W)
    deg = finite.sum(1).clip(1).astype(np.float32)
    Wsafe = np.where(finite, 1.0, 0.0)[None, :, :]
    for _ in range(SMOOTH_PASSES):
        nbr = (Wt[:, A] * Wsafe).sum(axis=2) / deg[None, :]
        Wt = 0.45 * Wt + 0.55 * nbr
        Wt /= Wt.sum(axis=0)[None, :]

    # Keep the strongest four and drop the rest -- by rank, so ties cannot
    # sneak a fifth influence past the glTF limit.
    if nb > MAX_INFLUENCES:
        drop = np.argpartition(-Wt, MAX_INFLUENCES, axis=0)[MAX_INFLUENCES:]
        np.put_along_axis(Wt, drop, 0.0, axis=0)
    tot = Wt.sum(axis=0)
    dead = np.flatnonzero(tot < 1e-9)
    live = np.flatnonzero(deform)
    for v in dead:
        near = [segment_distance(upos[v][None, :], *segs[i])[0] for i in live]
        Wt[int(live[int(np.argmin(near))]), v] = 1.0
    Wt /= Wt.sum(axis=0)[None, :]

    return order, Wt[:, inv]


def apply_weights(obj, arm, order, Wt):
    groups = [obj.vertex_groups.new(name=n) for n in order]
    LEVELS = 2048
    t0 = time.time()
    for i, g in enumerate(groups):
        w = Wt[i]
        nz = np.flatnonzero(w > 1e-4)
        if not len(nz):
            continue
        q = np.clip((w[nz] * LEVELS).round().astype(np.int32), 1, LEVELS)
        o = np.argsort(q)
        nz, q = nz[o], q[o]
        bounds = np.flatnonzero(np.diff(q)) + 1
        for s, e in zip(np.r_[0, bounds], np.r_[bounds, len(q)]):
            g.add(nz[s:e].tolist(), float(q[s]) / LEVELS, "REPLACE")
    log(f"vertex groups written in {time.time() - t0:.1f}s")

    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True


# ---------------------------------------------------------------------------

def main():
    log(f"source {SRC_GLB}")
    obj = load_mesh()
    arm = build_armature()

    bpy.ops.object.mode_set(mode="OBJECT")
    order, Wt = build_weights(obj, arm)
    apply_weights(obj, arm, order, Wt)
    split_membrane(obj)

    per_vert = (Wt > 1e-4).sum(axis=0)
    log(f"influences per vertex: min {per_vert.min()} max {per_vert.max()} "
        f"mean {per_vert.mean():.2f}")

    for o in bpy.data.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_image_format="AUTO",
        export_texture_dir="",
    )
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    log(f"wrote {OUT_GLB}")
    log(f"wrote {OUT_BLEND}")


main()
