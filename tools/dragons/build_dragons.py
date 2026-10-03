"""
Make the stand-in dragons game-ready: rig the ones that came without a
skeleton, and export everything to assets/models/dragons/<name>.glb.

    /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio \
        --python tools/dragons/build_dragons.py [-- name ...]

THE AUTO-RIG. The unrigged sources (Monstrous Nightmare, Thunderdrum,
Zippleback) all come in the same way: Z up, mirror-symmetric across X = 0,
head toward -Y and tail toward +Y, wings spread. So the rig can be read off the
mesh rather than placed by hand:

  - the CENTRE LINE: slice the body along Y and take the mean height of the
    vertices near X = 0 in each slice. That is where the spine runs, nose to
    tail, and it is split into head, neck, spine and tail bones by fractions of
    the length (or, for the Zippleback, forks into two necks and two heads at
    the front, found as the two clusters either side of the middle).
  - the WINGS: the slice where the model is widest is where they attach; each
    wing is three bones from the body edge out to the farthest vertex.

Skinning is by distance to bone segments — the two nearest bones, blended —
rather than Blender's heat weighting, which fails outright on the
non-manifold, multi-part meshes these models are made of.

Bone names are a fixed vocabulary js/dragonkit.js animates by:
  Root, Spine_0..n, Neck_0..n (NeckB_ for a second neck), Head (HeadB),
  Tail_0..n, WingL_0..2, WingR_0..2.

Already-rigged sources (Stormcutter, Nadder, Gronckle) are copied through
untouched, skeleton and animations and all; js/dragonkit.js knows their names.
"""
import bpy
import bmesh
import math
import os
import shutil
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "assets", "models", "dragons", "_src")
OUT = os.path.join(ROOT, "assets", "models", "dragons")

AUTO = {
    "nightmare":   {"necks": 1},
    "thunderdrum": {"necks": 1},
    "zippleback":  {"necks": 2},
}
PASS = ["stormcutter", "nadder", "gronckle"]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def join_and_apply(meshes):
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # Clear parents (Sketchfab wraps everything in a root node) keeping the
    # world transform, then bake transforms into the vertices.
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    return obj


def verts_world(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def centre_line(vs, ylo, yhi, n, core):
    """(y, z) points down the middle of the body, nose to tail."""
    pts = []
    for i in range(n + 1):
        y = ylo + (yhi - ylo) * i / n
        band = (yhi - ylo) / n * 0.75
        zs = [v.z for v in vs if abs(v.y - y) < band and abs(v.x) < core]
        if not zs:
            zs = [v.z for v in vs if abs(v.y - y) < band * 2]
        z = sum(zs) / len(zs) if zs else (pts[-1][1] if pts else 0.0)
        pts.append((y, z))
    return pts


def build_auto(name, cfg):
    reset()
    obj = join_and_apply(import_glb(os.path.join(SRC, name + ".glb")))
    vs = verts_world(obj)
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    span = max(abs(min(xs)), abs(max(xs)))
    ylo, yhi = min(ys), max(ys)
    length = yhi - ylo
    core = max(span * 0.12, length * 0.035)

    # Where the wings attach: the slice with the widest reach.
    best_y, best_w = ylo, 0
    for i in range(40):
        y = ylo + length * (i + 0.5) / 40
        w = max((abs(v.x) for v in vs if abs(v.y - y) < length / 80), default=0)
        if w > best_w:
            best_w, best_y = w, y
    line = centre_line(vs, ylo, yhi, 24, core)

    def z_at(y):
        for (y0, z0), (y1, z1) in zip(line, line[1:]):
            if y0 <= y <= y1:
                t = (y - y0) / max(1e-6, y1 - y0)
                return z0 + (z1 - z0) * t
        return line[-1][1]

    def at(y, x=0.0):
        return Vector((x, y, z_at(y)))

    # Fractions of the body, nose (0) to tail (1).
    f = lambda t: ylo + length * t
    wing_t = (best_y - ylo) / length
    head_end = 0.0
    neck_base = max(0.12, wing_t - 0.12)
    pelvis = min(0.85, wing_t + 0.14)

    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.view_layer.objects.active
    arm.name = name + "_rig"
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    root = eb[0]
    root.name = "Root"
    root.head = at(f(wing_t))
    root.tail = root.head + Vector((0, 0, length * 0.05))

    def chain(prefix, pts, parent):
        bones = []
        for i in range(len(pts) - 1):
            b = eb.new(f"{prefix}_{i}")
            b.head, b.tail = pts[i], pts[i + 1]
            b.parent = bones[-1] if bones else parent
            b.use_connect = bool(bones)
            bones.append(b)
        return bones

    spine_pts = [at(f(wing_t + (pelvis - wing_t) * k / 2)) for k in (2, 1, 0)]
    spine_pts = [at(f(pelvis)), at(f((pelvis + wing_t) / 2)), at(f(wing_t)), at(f(neck_base))]
    spine = chain("Spine", spine_pts, root)
    tail = chain("Tail", [at(f(pelvis + (1 - pelvis) * k / 6)) for k in range(7)], root)

    if cfg["necks"] == 1:
        neck = chain("Neck", [at(f(neck_base - (neck_base - 0.08) * k / 3)) for k in range(4)], spine[-1])
        h = eb.new("Head")
        h.head = neck[-1].tail
        h.tail = at(f(head_end))
        h.parent = neck[-1]
        h.use_connect = True
    else:
        # Two necks: the front fifth of the model splits into a cluster
        # either side of the middle; each gets its own neck and head.
        front = [v for v in vs if v.y < f(0.18)]
        for side, prefix, head_name in ((1, "Neck", "Head"), (-1, "NeckB", "HeadB")):
            pts = [v for v in front if v.x * side > core * 0.5] or front
            tip = min(pts, key=lambda v: v.y)
            cx = sum(v.x for v in pts) / len(pts)
            cz = sum(v.z for v in pts) / len(pts)
            base = at(f(neck_base))
            mid = Vector(((base.x + cx) / 2, (base.y + tip.y) / 2 + length * 0.04, (base.z + cz) / 2))
            n = chain(prefix, [base, base.lerp(mid, 0.5), mid, Vector((cx, tip.y + length * 0.07, cz))], spine[-1])
            h = eb.new(head_name)
            h.head = n[-1].tail
            h.tail = Vector((cx, tip.y, cz))
            h.parent = n[-1]
            h.use_connect = True

    for side, lab in ((1, "L"), (-1, "R")):
        wv = [v for v in vs if v.x * side > best_w * 0.75]
        tip = max(wv, key=lambda v: v.x * side) if wv else Vector((side * best_w, best_y, z_at(best_y)))
        base = Vector((side * core * 1.2, best_y, z_at(best_y)))
        elbow = base.lerp(tip, 0.38)
        elbow.y += length * 0.03
        wrist = base.lerp(tip, 0.7)
        chain("Wing" + lab, [base, elbow, wrist, tip], spine[-2])

    bpy.ops.object.mode_set(mode="OBJECT")

    # --- skinning: two nearest bone segments -----------------------------
    segs = [(b.name, arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
            for b in arm.data.bones if b.name != "Root"]
    groups = {n: obj.vertex_groups.new(name=n) for n, _, _ in segs}

    def seg_dist(p, a, b):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
        return (p - (a + ab * t)).length

    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        d = sorted(((seg_dist(p, a, b), n) for n, a, b in segs))[:2]
        (d0, n0), (d1, n1) = d
        w0 = 1.0 / max(d0, 1e-4) ** 2
        w1 = 1.0 / max(d1, 1e-4) ** 2
        s = w0 + w1
        groups[n0].add([v.index], w0 / s, "REPLACE")
        groups[n1].add([v.index], w1 / s, "REPLACE")

    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    obj.parent = arm
    export(name)
    print(f"rigged {name}: {len(arm.data.bones)} bones, length {length:.2f}, span {span * 2:.2f}")


def build_pass(name):
    # Copied byte for byte. A Blender round trip of these breaks them: the
    # Stormcutter came back with its body crushed to a stick in three.js
    # (fine in Blender, so it is the re-export, not the weights). They are
    # already glTF, already rigged; js/dragonkit.js copes with the rest.
    shutil.copyfile(os.path.join(SRC, name + ".glb"), os.path.join(OUT, name + ".glb"))
    print(f"copied {name}")


def export(name):
    path = os.path.join(OUT, name + ".glb")
    kw = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=False,
              export_animations=True, export_skins=True, export_materials="EXPORT",
              export_texcoords=True, export_normals=True)
    known = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in known})


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    os.makedirs(OUT, exist_ok=True)
    for name, cfg in AUTO.items():
        if argv and name not in argv:
            continue
        if os.path.exists(os.path.join(SRC, name + ".glb")):
            build_auto(name, cfg)
    for name in PASS:
        if argv and name not in argv:
            continue
        if os.path.exists(os.path.join(SRC, name + ".glb")):
            build_pass(name)


main()
