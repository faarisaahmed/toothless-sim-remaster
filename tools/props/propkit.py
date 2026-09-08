"""
propkit -- a small procedural modelling library for the Night Alone prop set.

Everything in this package is authored in GAME SPACE, which is the glTF frame
the brief asks for:

    +X   lateral (to the right when looking down +Z)
    +Y   up      (ground plane is Y = 0)
    +Z   forward (a bow, a door, a gable faces +Z)

Blender is Z-up, so `V()` converts a game-space triple to Blender space and the
glTF exporter's default +Y-up conversion undoes it exactly. Net effect: what you
type is what lands in the .glb. Direction vectors go through `V()` too -- the
mapping is a rotation, so winding and handedness survive it.

Conventions enforced here so the build scripts don't have to think about them:

  * one mesh object per model, sitting at the origin with an identity transform,
    geometry authored around the footprint centre on the ground plane;
  * moving parts are separate objects named `door` / `boom` / `drum`, whose
    object location is the hinge or axis and whose geometry is local to it;
  * material slots are named from the fixed list in MODELS.md and are added in
    a deterministic order, only the ones a model actually uses;
  * UVs are laid down at build time in METRE UNITS -- see uv note in
    assets/models/props/MANIFEST.md -- oriented so V runs along the grain;
  * faces are flat by default. Smooth is opt-in, per primitive.
"""

import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Matrix

TAU = math.tau

# --------------------------------------------------------------------------
# Material slots. Names are load-bearing: js/textures.js binds by slot name.
# The colours are only so a raw .glb looks sane in a viewer; the engine
# replaces the material wholesale.
# --------------------------------------------------------------------------

SLOT_LOOK = {
    "wood":      ((0.52, 0.36, 0.20, 1), 0.80),
    "wood_dark": ((0.26, 0.18, 0.11, 1), 0.85),
    "stone":     ((0.44, 0.44, 0.42, 1), 0.95),
    "iron":      ((0.29, 0.30, 0.33, 1), 0.55),
    "rope":      ((0.60, 0.51, 0.33, 1), 0.95),
    "cloth":     ((0.78, 0.74, 0.63, 1), 0.90),
    "hide":      ((0.40, 0.29, 0.20, 1), 0.85),
    "ember":     ((1.00, 0.33, 0.07, 1), 0.70),
}

SLOT_ORDER = ["wood", "wood_dark", "stone", "iron", "rope", "cloth", "hide", "ember"]

BUDGET = {"small": 400, "medium": 1200, "structure": 3000, "hero": 8000}

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "assets", "models", "props")


def V(x, y, z):
    """Game space -> Blender space. Also correct for directions."""
    return Vector((x, -z, y))


def G(v):
    """Blender space -> game space."""
    return Vector((v.x, v.z, -v.y))


# --------------------------------------------------------------------------
# Scene / material plumbing
# --------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            block.remove(item)


def get_material(slot):
    if slot not in SLOT_LOOK:
        raise KeyError("%r is not one of the allowed material slots" % slot)
    mat = bpy.data.materials.get(slot)
    if mat:
        return mat
    colour, rough = SLOT_LOOK[slot]
    mat = bpy.data.materials.new(slot)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = colour
    bsdf.inputs["Roughness"].default_value = rough
    if slot == "iron":
        bsdf.inputs["Metallic"].default_value = 1.0
    if slot == "ember":
        bsdf.inputs["Emission Color"].default_value = colour
        bsdf.inputs["Emission Strength"].default_value = 4.0
    return mat


# --------------------------------------------------------------------------
# Part: one accumulating mesh that becomes one object
# --------------------------------------------------------------------------

class Part:
    """An accumulating mesh. `origin` is the object's pivot, in game space."""

    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name = name
        self.origin = Vector(origin)
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")
        self.slots = []

    # -- internals ---------------------------------------------------------

    def _slot(self, slot):
        if slot not in self.slots:
            if slot not in SLOT_LOOK:
                raise KeyError("bad material slot %r" % slot)
            self.slots.append(slot)
        return self.slots.index(slot)

    def _vert(self, p):
        v = self.bm.verts.new(V(*p) - V(*self.origin))
        return v

    def _face(self, verts, slot, smooth):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None  # duplicate face; harmless, skip it
        f.material_index = self._slot(slot)
        f.smooth = smooth
        f.normal_update()
        for loop in f.loops:
            loop[self.col] = (1.0, 1.0, 1.0, 1.0)
        return f

    # -- generic geometry --------------------------------------------------

    def add(self, points, faces, slot, smooth=False, grain=None, uvs=None):
        """
        points  list of game-space triples
        faces   list of index tuples, CCW seen from outside
        uvs     optional list, parallel to `faces`, of per-corner (u, v) pairs.
                When absent, UVs are projected with `grain` running along V.
        """
        vs = [self._vert(p) for p in points]
        made = []
        for i, idx in enumerate(faces):
            f = self._face([vs[j] for j in idx], slot, smooth)
            if f is None:
                continue
            made.append(f)
            if uvs is not None:
                for loop, uv in zip(f.loops, uvs[i]):
                    loop[self.uvl].uv = uv
        if uvs is None:
            self.project_uv(made, grain)
        return made

    def project_uv(self, faces, grain=None):
        """Planar-project each face, V along `grain` (game space)."""
        g = V(*grain).normalized() if grain else None
        for f in faces:
            n = f.normal.normalized()
            u_ax, v_ax = _tangent_frame(n, g)
            for loop in f.loops:
                p = loop.vert.co
                loop[self.uvl].uv = (p.dot(u_ax), p.dot(v_ax))

    def shade(self, faces, value):
        for f in faces:
            for loop in f.loops:
                loop[self.col] = (value, value, value, 1.0)

    def contact_shade(self, floor=0.0, reach=0.4, strength=0.45, under=0.25):
        """
        Cheap contact darkening into COLOR_0. Not a baked AO -- it is a height
        ramp above `floor` plus a little extra on downward-facing faces, which
        is what actually reads on chunky props sitting on a deck.
        """
        for f in self.bm.faces:
            down = max(0.0, -G(f.normal.normalized()).y)
            for loop in f.loops:
                y = G(loop.vert.co).y + self.origin.y
                t = min(1.0, max(0.0, (y - floor) / reach))
                v = (1.0 - strength * (1.0 - t)) * (1.0 - under * down)
                prev = loop[self.col]
                loop[self.col] = (prev[0] * v, prev[1] * v, prev[2] * v, 1.0)

    # -- placement ---------------------------------------------------------

    def drop_to(self, y=0.0):
        """Translate so the lowest point lands on y. For built things."""
        lo, _ = self.bounds()
        for v in self.bm.verts:
            v.co.z += y - lo.y
        return self

    def flatten_base(self, y=0.0):
        """Clamp anything below y up to it -- a rock bedded into the ground."""
        for v in self.bm.verts:
            if v.co.z < y - self.origin.y:
                v.co.z = y - self.origin.y
        return self

    def recenter(self, x=True, z=True, drop=True):
        lo, hi = self.bounds()
        dx = -(lo.x + hi.x) / 2 if x else 0.0
        dz = -(lo.z + hi.z) / 2 if z else 0.0
        dy = -lo.y if drop else 0.0
        for v in self.bm.verts:
            v.co.x += dx
            v.co.y -= dz
            v.co.z += dy
        return self

    # -- output ------------------------------------------------------------

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def bounds(self):
        if not self.bm.verts:
            return Vector((0, 0, 0)), Vector((0, 0, 0))
        pts = [G(v.co) + self.origin for v in self.bm.verts]
        lo = Vector((min(p[i] for p in pts) for i in range(3)))
        hi = Vector((max(p[i] for p in pts) for i in range(3)))
        return lo, hi

    def to_object(self):
        bmesh.ops.triangulate(
            self.bm, faces=[f for f in self.bm.faces if len(f.verts) > 4])
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        me.validate(verbose=False)
        for slot in self.slots:
            me.materials.append(get_material(slot))
        if me.color_attributes:
            me.color_attributes.active_color_index = 0
            me.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, me)
        obj.location = V(*self.origin)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def _tangent_frame(n, grain):
    """(u, v) on the plane of `n`, with v along `grain` where possible."""
    if grain is not None:
        v = grain - n * grain.dot(n)
    else:
        v = Vector((0, 0, 0))
    if v.length < 1e-5:
        for ax in (Vector((0, 0, 1)), Vector((0, 1, 0)), Vector((1, 0, 0))):
            v = ax - n * ax.dot(n)
            if v.length > 1e-5:
                break
    v.normalize()
    u = v.cross(n)
    u.normalize()
    return u, v


# --------------------------------------------------------------------------
# Primitives. All coordinates game space, all `part` first.
# --------------------------------------------------------------------------

# Corner order for a unit box and its six outward-wound faces.
_BOX_CORNERS = [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1),
                (-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)]
_BOX_FACES = [(0, 1, 2, 3), (4, 7, 6, 5), (3, 2, 6, 7),
              (1, 0, 4, 5), (2, 1, 5, 6), (0, 3, 7, 4)]


def axis_frame(axis):
    """Orthonormal (u, w) across `axis`, chosen so rings wind outward."""
    a = Vector(axis).normalized()
    ref = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((0, 0, 1))
    u = ref.cross(a)
    if u.length < 1e-6:
        u = Vector((1, 0, 0))
    u.normalize()
    w = u.cross(a)
    return u, w.normalized()


def ring(center, radius, seg, axis=(0, 1, 0), start=0.0, squash=1.0):
    """A closed loop of `seg` points, wound for outward-facing loft quads."""
    c = Vector(center)
    u, w = axis_frame(axis)
    out = []
    for k in range(seg):
        t = start + TAU * k / seg
        out.append(c + u * (math.cos(t) * radius) +
                   w * (math.sin(t) * radius * squash))
    return [tuple(p) for p in out]


def rect_section(center, width, height, axis=(0, 1, 0), up=None, roll=0.0):
    """Four points making a rectangular cross-section across `axis`."""
    a = Vector(axis).normalized()
    if up is None:
        up = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((0, 0, 1))
    up = Vector(up)
    side = up.cross(a)
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    vert = side.cross(a).normalized()
    if roll:
        ca, sa = math.cos(roll), math.sin(roll)
        side, vert = side * ca + vert * sa, vert * ca - side * sa
    c = Vector(center)
    hw, hh = width * 0.5, height * 0.5
    return [tuple(c + side * hw + vert * hh),
            tuple(c - side * hw + vert * hh),
            tuple(c - side * hw - vert * hh),
            tuple(c + side * hw - vert * hh)]


def box(part, center, size, slot, grain=None, smooth=False, rot=None):
    """Axis-aligned box, or rotated about its centre by the 3x3 `rot`."""
    c, s = Vector(center), Vector(size) * 0.5
    pts = []
    for sx, sy, sz in _BOX_CORNERS:
        p = Vector((sx * s.x, sy * s.y, sz * s.z))
        if rot is not None:
            p = rot @ p
        pts.append(tuple(c + p))
    if grain is None:
        grain = (0, 1, 0) if size[1] >= max(size[0], size[2]) else (
            (1, 0, 0) if size[0] >= size[2] else (0, 0, 1))
    if rot is not None:
        grain = tuple(rot @ Vector(grain))
    return part.add(pts, _BOX_FACES, slot, smooth=smooth, grain=grain)


def loft(part, sections, slot, smooth=False, closed=True,
         cap_start=True, cap_end=True, uv_scale=1.0, double=False):
    """
    Bridge a run of equal-length cross-sections. Sections advance along the
    sweep; V runs along the sweep, U around the section, both in metres.
    Duplicate a section's points down to a single point to get a pole.
    """
    n = len(sections[0])
    if any(len(s) != n for s in sections):
        raise ValueError("loft sections must all be the same length")

    flat = [p for s in sections for p in s]
    verts_per = n

    # UV parameterisation.
    def centroid(s):
        return Vector((sum(p[i] for p in s) / len(s) for i in range(3)))
    vs, acc = [0.0], 0.0
    for a, b in zip(sections, sections[1:]):
        acc += (centroid(b) - centroid(a)).length
        vs.append(acc)
    us = []
    for s in sections:
        run, cur = [0.0], 0.0
        lim = n if closed else n - 1
        for k in range(lim):
            cur += (Vector(s[(k + 1) % n]) - Vector(s[k])).length
            run.append(cur)
        us.append(run)

    faces, uvs = [], []
    for si in range(len(sections) - 1):
        a0, a1 = si * verts_per, (si + 1) * verts_per
        lim = n if closed else n - 1
        for k in range(lim):
            k2 = (k + 1) % n
            quad = (a0 + k, a1 + k, a1 + k2, a0 + k2)
            uv = ((us[si][k] * uv_scale, vs[si] * uv_scale),
                  (us[si + 1][k] * uv_scale, vs[si + 1] * uv_scale),
                  (us[si + 1][k + 1] * uv_scale, vs[si + 1] * uv_scale),
                  (us[si][k + 1] * uv_scale, vs[si] * uv_scale))
            # Collapse degenerate edges so poles come out as triangles.
            keep = [quad[0]]
            keepuv = [uv[0]]
            for idx, t in zip(quad[1:], uv[1:]):
                if Vector(flat[idx]) - Vector(flat[keep[-1]]) == Vector((0, 0, 0)):
                    continue
                keep.append(idx)
                keepuv.append(t)
            if len(keep) > 2 and Vector(flat[keep[0]]) == Vector(flat[keep[-1]]):
                keep.pop()
                keepuv.pop()
            if len(keep) < 3:
                continue
            faces.append(tuple(keep))
            uvs.append(tuple(keepuv))

    if double:
        # A zero-thickness shell, for open boats and cloth: the back faces cost
        # nothing next to modelling a real 20 mm plank thickness.
        faces = faces + [tuple(reversed(f)) for f in faces]
        uvs = uvs + [tuple(reversed(u)) for u in uvs]
    made = part.add(flat, faces, slot, smooth=smooth, uvs=uvs)
    caps = []
    if closed and cap_start and len(set(sections[0])) > 2:
        caps += part.add(list(sections[0]), [tuple(range(n))], slot)
    if closed and cap_end and len(set(sections[-1])) > 2:
        caps += part.add(list(sections[-1]), [tuple(reversed(range(n)))], slot)
    return made + caps


def cyl(part, p0, p1, r0, r1=None, seg=8, slot="wood", smooth=False,
        caps=True, start=0.0):
    """Round or tapered shaft between two points."""
    a, b = Vector(p0), Vector(p1)
    axis = (b - a)
    if r1 is None:
        r1 = r0
    s0 = ring(a, r0, seg, axis, start)
    s1 = ring(b, r1, seg, axis, start)
    return loft(part, [s0, s1], slot, smooth=smooth,
                cap_start=caps and r0 > 1e-5, cap_end=caps and r1 > 1e-5)


def beam(part, p0, p1, width, height, slot, up=None, roll=0.0,
         smooth=False, caps=True):
    """Square-section timber or bar between two points. Grain runs along it."""
    a, b = Vector(p0), Vector(p1)
    axis = b - a
    s0 = rect_section(a, width, height, axis, up, roll)
    s1 = rect_section(b, width, height, axis, up, roll)
    return loft(part, [s0, s1], slot, smooth=smooth,
                cap_start=caps, cap_end=caps)


def revolve(part, profile, center=(0, 0, 0), seg=12, slot="wood",
            smooth=False, axis=(0, 1, 0), start=0.0,
            cap_start=True, cap_end=True):
    """
    Spin a (radius, height) profile, bottom to top, about a vertical axis.
    A zero radius at either end becomes a pole.
    """
    c = Vector(center)
    a = Vector(axis).normalized()
    sections = []
    for r, h in profile:
        sections.append(ring(c + a * h, max(r, 0.0), seg, a, start))
    return loft(part, sections, slot, smooth=smooth,
                cap_start=cap_start and profile[0][0] > 1e-5,
                cap_end=cap_end and profile[-1][0] > 1e-5)


def sphere(part, center, radius, slot, rings=4, seg=8, smooth=True, squash=1.0):
    prof = []
    for i in range(rings + 1):
        t = math.pi * i / rings
        prof.append((math.sin(t) * radius, -math.cos(t) * radius * squash))
    return revolve(part, prof, center, seg, slot, smooth=smooth)


def torus(part, center, major, minor, slot, majseg=8, minseg=5,
          axis=(0, 1, 0), smooth=True):
    """A ring -- chain links, hoops, barrel bands."""
    c = Vector(center)
    a = Vector(axis).normalized()
    u, w = axis_frame(a)
    sections = []
    for i in range(majseg + 1):
        t = TAU * i / majseg
        out = u * math.cos(t) + w * math.sin(t)
        centre = c + out * major
        sections.append(ring(centre, minor, minseg, out.cross(a), 0.0))
    return loft(part, sections[:-1] + [sections[0]], slot, smooth=smooth,
                cap_start=False, cap_end=False)


def polyline_tube(part, points, radius, slot, seg=4, smooth=False, caps=True):
    """A tube following a run of points -- rope, chain runs, cables."""
    pts = [Vector(p) for p in points]
    sections = []
    for i, p in enumerate(pts):
        if i == 0:
            axis = pts[1] - pts[0]
        elif i == len(pts) - 1:
            axis = pts[-1] - pts[-2]
        else:
            axis = pts[i + 1] - pts[i - 1]
        sections.append(ring(p, radius, seg, axis))
    return loft(part, sections, slot, smooth=smooth,
                cap_start=caps, cap_end=caps)


def rope_line(part, p0, p1, slot="rope", sag=0.06, steps=5, radius=0.022, seg=4):
    """A slack line between two points. Handrails, rigging, drying lines."""
    a, b = Vector(p0), Vector(p1)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        p = a.lerp(b, t)
        p.y -= sag * 4.0 * t * (1.0 - t)
        pts.append(tuple(p))
    return polyline_tube(part, pts, radius, slot, seg)


def quad(part, p0, p1, p2, p3, slot, grain=None, double=False, smooth=False):
    """A single panel. `double` adds the back face -- cloth, sails, fins."""
    pts = [p0, p1, p2, p3]
    faces = [(0, 1, 2, 3)] + ([(3, 2, 1, 0)] if double else [])
    return part.add(pts, faces, slot, smooth=smooth, grain=grain)


def surface(part, fn, nu, nv, slot, grain=None, double=False, smooth=True):
    """
    Sample a parametric patch fn(u, v) -> game-space point over [0,1]^2.
    Used for sagging sailcloth and tarpaulins.
    """
    pts, uvs_out = [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            pts.append(tuple(fn(i / nu, j / nv)))
    idx = lambda i, j: j * (nu + 1) + i
    faces = []
    for j in range(nv):
        for i in range(nu):
            faces.append((idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)))
    if double:
        faces += [tuple(reversed(f)) for f in faces]
    return part.add(pts, faces, slot, smooth=smooth, grain=grain)


# --------------------------------------------------------------------------
# Model registry and export
# --------------------------------------------------------------------------

MODELS = []


def model(filename, cls, note="", anchor="ground"):
    """
    Register a build function. `cls` is a key of BUDGET. `anchor` says what the
    origin means, and is what verify_props.py checks against:
      ground  footprint centre on the ground plane   (the default)
      hang    the hang point, geometry below it
      hinge   a hinge or axis, for a part shipped on its own
    """
    def deco(fn):
        MODELS.append({"file": filename, "cls": cls, "note": note,
                       "anchor": anchor, "fn": fn})
        return fn
    return deco


def _export_kwargs(path):
    wanted = dict(
        filepath=path, export_format="GLB", use_selection=False,
        export_apply=True, export_yup=True, export_texcoords=True,
        export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_attributes=False,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False, export_extras=False,
        export_hierarchy_flatten_objs=False, export_unused_images=False,
        export_unused_textures=False, will_save_settings=False,
    )
    known = {p.identifier for p in
             bpy.ops.export_scene.gltf.get_rna_type().properties}
    return {k: v for k, v in wanted.items() if k in known}


def build_all(out_dir=OUT_DIR, only=None):
    os.makedirs(out_dir, exist_ok=True)
    meta_path = os.path.join(out_dir, "_build_meta.json")
    # Merge, so a partial rebuild does not drop the other models' metadata.
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for entry in MODELS:
        name = entry["file"]
        if only and name not in only:
            continue
        reset_scene()
        parts = entry["fn"]()
        if isinstance(parts, Part):
            parts = [parts]
        tris = sum(p.tris() for p in parts)
        lows, highs = zip(*(p.bounds() for p in parts))
        lo = [min(v[i] for v in lows) for i in range(3)]
        hi = [max(v[i] for v in highs) for i in range(3)]
        slots, nodes = [], []
        for p in parts:
            nodes.append(p.name)
            for s in p.slots:
                if s not in slots:
                    slots.append(s)
            p.to_object()
        path = os.path.join(out_dir, name)
        bpy.ops.export_scene.gltf(**_export_kwargs(path))
        cap = BUDGET[entry["cls"]]
        flag = "  OVER BUDGET" if tris > cap else ""
        meta[name] = {
            "cls": entry["cls"], "budget": cap, "note": entry["note"],
            "anchor": entry["anchor"],
            "tris": tris, "nodes": nodes,
            "slots": [s for s in SLOT_ORDER if s in slots],
            "size": [round(hi[i] - lo[i], 3) for i in range(3)],
            "min": [round(v, 3) for v in lo],
        }
        print("built %-28s %5d/%-5d tris  %s%s" %
              (name, tris, cap, ",".join(meta[name]["slots"]), flag))
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=1, sort_keys=True)
    print("\n%d models -> %s" % (len(meta), out_dir))


def _signed_area(pts):
    s = 0.0
    for (a0, b0), (a1, b1) in zip(pts, list(pts[1:]) + [pts[0]]):
        s += a0 * b1 - a1 * b0
    return 0.5 * s


def _wound(profile, want_positive):
    pr = list(profile)
    if (_signed_area(pr) > 0) != want_positive:
        pr.reverse()
    return pr


def prism_x(part, profile_zy, x0, x1, slot, **kw):
    """Extrude a (z, y) cross-section along X. Winding is sorted out here."""
    pr = _wound(profile_zy, True)
    lo, hi = min(x0, x1), max(x0, x1)
    return loft(part, [[(lo, y, z) for z, y in pr], [(hi, y, z) for z, y in pr]],
                slot, **kw)


def prism_z(part, profile_xy, z0, z1, slot, **kw):
    """Extrude an (x, y) cross-section along Z. Gables, hulls, kerbs."""
    pr = _wound(profile_xy, False)
    lo, hi = min(z0, z1), max(z0, z1)
    return loft(part, [[(x, y, lo) for x, y in pr], [(x, y, hi) for x, y in pr]],
                slot, **kw)


def prism_y(part, profile_xz, y0, y1, slot, **kw):
    """Extrude an (x, z) plan shape upwards. Posts, plinths, rock cores."""
    pr = _wound(profile_xz, True)
    lo, hi = min(y0, y1), max(y0, y1)
    return loft(part, [[(x, lo, z) for x, z in pr], [(x, hi, z) for x, z in pr]],
                slot, **kw)


def helix(center, radius, y0, y1, turns, steps, phase=0.0):
    """Point run for a rope wrap or a coil of chain."""
    c = Vector(center)
    out = []
    for i in range(steps + 1):
        t = i / steps
        a = phase + TAU * turns * t
        out.append((c.x + math.cos(a) * radius, c.y + (y1 - y0) * t + y0,
                    c.z + math.sin(a) * radius))
    return out


# --------------------------------------------------------------------------
# Rock and driftwood: irregular sweeps that still facet cleanly
# --------------------------------------------------------------------------

def seeds(count, seed):
    """A fixed set of per-vertex phases, so every rebuild is byte-identical."""
    r = random.Random(seed)
    return [r.uniform(0.0, TAU) for _ in range(count)]


def rock_section(center, radius, seg, axis, t, phase, amp=0.18, squash=1.0):
    """
    A ring pushed in and out by a smooth function of (vertex, t). Sweeping a
    run of these gives a rock or a log whose lumps run along it, rather than
    per-section noise that just reads as a mess.
    """
    c = Vector(center)
    out = []
    for k, p in enumerate(ring(center, radius, seg, axis, squash=squash)):
        d = Vector(p) - c
        f = (1.0 + amp * math.sin(phase[k] + t * 2.1)
             + amp * 0.45 * math.sin(phase[k] * 2.7 + t * 5.3))
        out.append(tuple(c + d * f))
    return out


def sweep_rock(part, path, radii, seg, slot, seed=0, amp=0.18, smooth=False,
               cap_start=True, cap_end=True):
    """Loft rock_sections along a path. `path` and `radii` are the same length."""
    ph = seeds(seg, seed)
    n = len(path)
    sections = []
    for i, (p, r) in enumerate(zip(path, radii)):
        if i == 0:
            axis = Vector(path[1]) - Vector(path[0])
        elif i == n - 1:
            axis = Vector(path[-1]) - Vector(path[-2])
        else:
            axis = Vector(path[i + 1]) - Vector(path[i - 1])
        sections.append(rock_section(p, r, seg, axis, i / max(1, n - 1), ph, amp))
    return loft(part, sections, slot, smooth=smooth,
                cap_start=cap_start, cap_end=cap_end)


def ring_sweep(part, sections, slot, smooth=False):
    """Sweep a cross-section around a closed loop -- kerbs, lips, hoops."""
    return loft(part, list(sections) + [sections[0]], slot, smooth=smooth,
                cap_start=False, cap_end=False)


def loft_z(part, profiles, zs, slot, flip=False, **kw):
    """
    Loft a run of (x, y) profiles down +Z, one per entry in `zs`. Winding is
    taken from the first profile so hulls and roofs come out facing outward.
    """
    want = _signed_area(profiles[0]) < 0
    if flip:
        want = not want
    prs = profiles if want else [list(reversed(pr)) for pr in profiles]
    secs = [[(x, y, z) for x, y in pr] for pr, z in zip(prs, zs)]
    return loft(part, secs, slot, **kw)


def chain_run(part, points, link=0.16, width=0.075, slot="iron", seg_per_link=2):
    """
    Chain along a path. Real torus links cost 40+ triangles each, which buys
    about eight links inside a small-prop budget; a square section rolled 90
    degrees per link reads as chain from any distance the player will see it,
    for a quarter of that.
    """
    pts = [Vector(q) for q in points]
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    n = max(2, int(total / link))
    sections = []
    for i in range(n + 1):
        t = i / n
        d = t * total
        acc = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = (b - a).length
            if acc + seg >= d or (a is pts[-2] and b is pts[-1]):
                f = 0.0 if seg < 1e-6 else min(1.0, (d - acc) / seg)
                centre, axis = a.lerp(b, f), (b - a)
                break
            acc += seg
        roll = (i // 1) * (math.pi / 2)
        sections.append(rect_section(tuple(centre), width, width * 0.55,
                                     tuple(axis), roll=roll))
    return loft(part, sections, slot, cap_start=True, cap_end=True)
