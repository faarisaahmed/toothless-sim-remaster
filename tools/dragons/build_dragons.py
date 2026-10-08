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

Already-rigged sources (Nadder, Gronckle) are copied through untouched,
skeleton and animations and all; js/dragonkit.js knows their names. The
Stormcutter's skeleton is re-chained and moved onto its body (build_storm).
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
PASS = ["nadder", "gronckle"]


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


# --- the Stormcutter: re-chain the skeleton it came with --------------------
#
# The baby Stormcutter arrives skinned, but flat: every one of its hundred
# bones is a direct child of one root, so nothing hangs off anything — a wing
# is thirty loose siblings and the tail is six. Worse, the skeleton is not
# where the mesh is: some unit slip in the FBX it came through left the bones
# about 4/3 the size of the body and a little forward of it (the skinning is
# still exact at rest, because every inverse bind matrix matches its bone, but
# every joint pivots about a point in mid-air off the limb it moves).
#
# So this does two things, by editing the glTF directly rather than through a
# Blender round trip (which crushes this model; see build_pass):
#
#   1. MOVES each bone onto the body: fits the one similarity (scale, offset)
#      that maps bone segments onto the centroids of the vertices they drive,
#      and puts every bone there, keeping its orientation, with unit scale.
#   2. CHAINS them: pelvis > spine > neck > head; pelvis > tail 1..6; pelvis >
#      thigh > shin > tarsal > foot; spine > (shoulder) > arm > forearm > hand
#      > finger 01 > finger 02, for all four wings.
#
# Each bone keeps its world rest transform under the new parents (locals are
# recomputed), and its inverse bind matrix is rewritten to match its new place,
# so the mesh at rest is exactly what it was: the vertex weights are untouched.
STORM_PARENTS = [
    # (child prefix, parent prefix); prefixes match "Bone_<prefix>_<n>"
    ("M_Pelvis", "Root"),
    ("M_Spine01", "M_Pelvis"),
    ("M_Breath", "M_Spine01"),
    ("M_Neck01", "M_Spine01"),
    ("M_Head", "M_Neck01"),
    ("M_Tail01", "M_Pelvis"),
    ("M_Tail02", "M_Tail01"), ("M_Tail03", "M_Tail02"), ("M_Tail04", "M_Tail03"),
    ("M_Tail05", "M_Tail04"), ("M_Tail06", "M_Tail05"),
] + [
    pair for s in "LR" for pair in (
        (f"{s}_UpLeg", "M_Pelvis"), (f"{s}_Leg", f"{s}_UpLeg"),
        (f"{s}_Tarsal", f"{s}_Leg"), (f"{s}_Foot", f"{s}_Tarsal"),
        (f"{s}_PelvicfinA01", "M_Pelvis"), (f"{s}_PelvicfinC01", "M_Pelvis"),
    )
] + [
    pair for s in "LR" for w in "ul" for pair in (
        ((f"{s}u_Shoulder", "M_Spine01"), (f"{s}u_Arm", f"{s}u_Shoulder")) if w == "u"
        else ((f"{s}l_Arm", "M_Spine01"),)
    ) + (
        (f"{s}{w}_ForeArm", f"{s}{w}_Arm"), (f"{s}{w}_Hand", f"{s}{w}_ForeArm"),
        (f"{s}{w}_WingFingerA01", f"{s}{w}_Hand"), (f"{s}{w}_WingFingerA02", f"{s}{w}_WingFingerA01"),
        (f"{s}{w}_WingFingerB01", f"{s}{w}_Hand"), (f"{s}{w}_WingFingerB02", f"{s}{w}_WingFingerB01"),
        (f"{s}{w}_WingFingerC01", f"{s}{w}_Hand"), (f"{s}{w}_WingFingerC02", f"{s}{w}_WingFingerC01"),
        (f"{s}{w}_WingFingerD01", f"{s}{w}_Hand"), (f"{s}{w}_WingFingerD02", f"{s}{w}_WingFingerD01"),
        (f"{s}{w}_WingFingerFlapB01", f"{s}{w}_Hand"), (f"{s}{w}_WingFingerFlapC01", f"{s}{w}_Hand"),
    )
]


def build_storm():
    import json
    import struct
    import numpy as np

    data = open(os.path.join(SRC, "stormcutter.glb"), "rb").read()
    jlen = struct.unpack("<I", data[12:16])[0]
    J = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", data[off:off + 4])[0]
    BIN = bytearray(data[off + 8:off + 8 + blen])
    nodes = J["nodes"]

    CT = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}
    NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def view(i):
        a = J["accessors"][i]
        bv = J["bufferViews"][a["bufferView"]]
        dt = np.dtype(CT[a["componentType"]])
        n = NC[a["type"]]
        st = bv.get("byteStride", dt.itemsize * n)
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.ndarray((a["count"], n), dtype=dt, buffer=BIN, offset=o, strides=(st, dt.itemsize))

    def quat_mat(q):
        x, y, z, w = q
        return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

    def mat_quat(m):
        # Shepperd; m a proper rotation.
        t = np.trace(m)
        if t > 0:
            s = math.sqrt(t + 1) * 2
            q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, s / 4]
        elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
            q = [s / 4, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
        elif m[1, 1] > m[2, 2]:
            s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
            q = [(m[0, 1] + m[1, 0]) / s, s / 4, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
        else:
            s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
            q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, s / 4, (m[1, 0] - m[0, 1]) / s]
        q = np.array(q)
        return q / np.linalg.norm(q)

    def trs(n):
        if "matrix" in n:
            return np.array(n["matrix"], dtype=float).reshape(4, 4).T
        M = np.eye(4)
        M[:3, :3] = quat_mat(n.get("rotation", [0, 0, 0, 1])) * np.array(n.get("scale", [1, 1, 1]))
        M[:3, 3] = n.get("translation", [0, 0, 0])
        return M

    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    skin = J["skins"][0]
    base = skin["skeleton"]                      # _rootJoint: the mesh's frame

    def world(i):
        M = np.eye(4)
        while i != base:
            M = trs(nodes[i]) @ M
            i = parent[i]
        return M

    by = {}
    for i, n in enumerate(nodes):
        name = n.get("name", "")
        if name.startswith("Bone_"):
            key = name[5:].rsplit("_", 1)[0]     # "Bone_Lu_Arm_027" -> "Lu_Arm"
            by[key] = i
    W = {i: world(i) for i in by.values()}

    # 1. The similarity that puts the skeleton on the body. Fit on chain bones:
    #    the mid-point of each bone-to-next-bone segment against the weighted
    #    centroid of the vertices that bone drives.
    joints = skin["joints"]
    prim = J["meshes"][0]["primitives"][0]
    P = view(prim["attributes"]["POSITION"]).astype(float)
    JI = view(prim["attributes"]["JOINTS_0"]).astype(int)
    WT = view(prim["attributes"]["WEIGHTS_0"]).astype(float)
    if J["accessors"][prim["attributes"]["WEIGHTS_0"]].get("normalized"):
        WT /= np.iinfo(view(prim["attributes"]["WEIGHTS_0"]).dtype).max

    def centroid(node):
        k = joints.index(node)
        w = (WT * (JI == k)).sum(1)
        return (P * w[:, None]).sum(0) / w.sum()

    segs = [(f"M_Tail0{i}", f"M_Tail0{i + 1}") for i in range(1, 6)]
    segs += [("M_Pelvis", "M_Spine01"), ("M_Spine01", "M_Neck01"), ("M_Neck01", "M_Head")]
    for s in ("Lu", "Ll", "Ru", "Rl"):
        segs += [(f"{s}_Arm", f"{s}_ForeArm"), (f"{s}_ForeArm", f"{s}_Hand")]
        segs += [(f"{s}_WingFinger{f}01", f"{s}_WingFinger{f}02") for f in "ABCD"]
    rows, rhs = [], []
    for a, b in segs:
        mid = (W[by[a]][:3, 3] + W[by[b]][:3, 3]) / 2
        c = centroid(by[a])
        for d in range(3):
            r = [0.0] * 4
            r[0] = mid[d]
            r[1 + d] = 1.0
            rows.append(r)
            rhs.append(c[d])
    sol = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)[0]
    k, t = sol[0], sol[1:]
    t[0] = 0.0                                   # it is symmetric; keep it so
    print(f"stormcutter: skeleton onto body, scale {k:.4f}, offset {np.round(t, 4)}")

    # New world rest transforms: moved, orientation kept, scale dropped.
    N = {}
    for i in by.values():
        M = np.eye(4)
        R = W[i][:3, :3]
        u, _, vt = np.linalg.svd(R)              # the rotation, without the 1e-7 scale noise
        M[:3, :3] = u @ vt
        M[:3, 3] = W[i][:3, 3] * k + t
        N[i] = M

    # 2. Chains. Re-parent, keeping each bone's (new) world transform.
    newpar = {by[c]: by[p] for c, p in STORM_PARENTS if c in by and p in by}
    for c, p in newpar.items():
        old = parent[c]
        nodes[old]["children"].remove(c)
        if not nodes[old]["children"]:
            del nodes[old]["children"]
        nodes[p].setdefault("children", []).append(c)
        parent[c] = p
    for i in by.values():
        p = parent[i]
        PW = N[p] if p in N else world(p)
        L = np.linalg.inv(PW) @ N[i]
        n = nodes[i]
        n.pop("matrix", None)
        n.pop("scale", None)
        n["translation"] = [float(x) for x in L[:3, 3]]
        n["rotation"] = [float(x) for x in mat_quat(L[:3, :3])]

    # Inverse binds to match, so the mesh at rest has not moved a hair.
    ibm = view(skin["inverseBindMatrices"])
    for kk, node in enumerate(joints):
        if node in N:
            ibm[kk] = np.linalg.inv(N[node]).T.reshape(-1).astype(np.float32)

    # The Sketchfab extras say where it came from; add what was done to it.
    J["asset"].setdefault("extras", {})["rig"] = "re-chained by tools/dragons/build_dragons.py"
    js = json.dumps(J, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    BIN += b"\0" * (-len(BIN) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(BIN))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(BIN), 0x004E4942) + bytes(BIN)
    open(os.path.join(OUT, "stormcutter.glb"), "wb").write(out)
    print(f"rechained stormcutter: {len(newpar)} bones re-parented")


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
    if (not argv or "stormcutter" in argv) and os.path.exists(os.path.join(SRC, "stormcutter.glb")):
        build_storm()
    for name in PASS:
        if argv and name not in argv:
            continue
        if os.path.exists(os.path.join(SRC, name + ".glb")):
            build_pass(name)


main()
