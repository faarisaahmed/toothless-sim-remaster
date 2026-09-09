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
import time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

TAU = math.tau

# --------------------------------------------------------------------------
# Detail. One knob, set per model by the `model()` decorator, that multiplies
# every segment count in the primitives below. A cylinder written as 6-sided
# comes out 18-sided at DETAIL 3, so raising fidelity across the whole set is
# not 39 hand edits -- and the props that get instanced six hundred times can
# still be told to stay cheap.
# --------------------------------------------------------------------------

DETAIL = 2.0


def _sc(n, lo=3):
    """Scale a segment count by the current detail level."""
    return max(lo, int(round(n * DETAIL)))


def _scg(n, lo=3, cap=1.25):
    """
    Segment count for something the model contains hundreds of -- a footing
    stone, a shingle, a nail. These want to exist far more than they want to be
    round, so their scaling is capped: three hundred stones at forty triangles
    is a drystone wall, and at four hundred triangles it is the whole budget.
    """
    return max(lo, int(round(n * min(DETAIL, cap))))


# The build scripts import * from here, which skips leading-underscore names,
# and they need these two to size their own loops.
segs, segs_many = _sc, _scg

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

# --------------------------------------------------------------------------
# Arris widths, per slot, in metres.
#
# Nothing real has a mathematically sharp edge. A sawn board's arris is a
# millimetre or two of crushed fibre, a hand-adzed timber's is five, a weathered
# rock's is fifty, and a rolled iron bar's is the radius of the rolls. Those
# widths are the single largest difference between a box and a plank: an edge
# with width catches a highlight along it, and the eye reads that highlight as
# a material and a thickness. The fibre slots get none -- rope and cloth have
# no arris to chamfer, and they are built as zero-thickness shells anyway.
# --------------------------------------------------------------------------

BEVEL = {
    "wood":      0.004,
    "wood_dark": 0.006,
    "stone":     0.032,
    "iron":      0.0028,
    "rope":      0.0,
    "cloth":     0.0,
    "hide":      0.0,
    "ember":     0.0,
}

# Segments across the arris. One is a flat chamfer, which is exactly what a
# sawn or adzed edge is, and it costs a box six extra faces. Two is a fillet,
# which is what rolled iron and weathered stone actually have -- and iron is
# the material the whole story is about, so it is the one that gets to be
# round. Going past two is invisible and quadruples the count on every box.
BEVEL_SEGMENTS = {"iron": 2, "stone": 2}

# Triangle budgets. These are per MODEL, and what sets them is not how
# important a prop looks but how many of it the level places: `rig_deck_4m`
# ships six hundred times over into one merged floor, so a triangle spent on it
# is six hundred triangles, while `stack_arch` ships once and can afford forty
# thousand. See the budget note in the manifest.
BUDGET = {
    "tiled":     1000,     # 500+ instances, merged into one mesh
    "scatter":   3000,     # dozens of instances
    "small":     9000,
    "medium":   16000,
    "structure": 40000,
    "hero":     110000,
}

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
    # Physically sane dielectric response, so a raw .glb reads correctly in any
    # viewer that is not this game. The engine still replaces these wholesale.
    for name, value in (("IOR", {"wood": 1.42, "wood_dark": 1.42, "stone": 1.50,
                                 "rope": 1.46, "cloth": 1.46, "hide": 1.48,
                                 "iron": 2.9, "ember": 1.45}[slot]),
                        ("Sheen Weight", 0.35 if slot in ("cloth", "rope") else 0.0)):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = value
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
        # FLOAT_COLOR, not BYTE_COLOR. Blender treats a byte colour attribute
        # as sRGB and the exporter dutifully converts it to linear, so a 0.13
        # contact shadow authored here shipped as 0.015 -- black. Occlusion is
        # a multiplier on radiance; it has to travel as linear light.
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.slots = []
        self.finished = False
        self._ao = None          # set by contact_shade, consumed by finish()

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
        Ask for ambient occlusion, and say where the ground is.

        This used to BE the occlusion: a height ramp above `floor` plus a bias
        on downward faces. It is now a request -- `finish()` casts real rays
        instead -- because a ramp cannot know that the inside of a cage is dark
        and the outside is not, and that difference is most of what makes a
        built thing read as built. The arguments are kept because the build
        scripts have already worked out the right floor and the right strength
        for every model.
        """
        self._ao = dict(floor=floor, strength=strength)

    # -- the detail pass ---------------------------------------------------

    def weld(self, dist=2e-5):
        """
        Merge coincident vertices.

        Everything in the kit is authored as separate lofts, and a loft's end
        caps are their own vertices -- so a beam arrives as an open tube plus
        two loose lids, with not one manifold edge on it. Nothing downstream
        works on that: bevel needs two faces per edge to have an angle to
        chamfer, and occlusion rays leak through the seams. Welding is also
        what turns a post butted into a sill into a joint, rather than two
        objects that happen to touch.
        """
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts[:], dist=dist)
        self.bm.normal_update()
        return self

    def bevel(self, segments=2, scale=1.0, angle=math.radians(45),
              widths=None):
        """
        Chamfer every hard edge, by a width taken from the slot either side.

        This is the highest-leverage thing in the kit. A box lit by a sun has
        one flat tone per face and a discontinuity at the corner; a box with a
        6 mm arris has a bright sliver running along every corner, which is
        what actually tells you the thing is solid and which way its faces run.
        Edges between two different materials get the narrower of the two.

        Zero-thickness shells -- cloth, sails, blades, anything built with
        `double=True` -- are skipped by the back-to-back normal test, since
        bevelling a face against its own reverse produces confetti.
        """
        widths = dict(BEVEL if widths is None else widths)
        for slot in widths:
            widths[slot] *= scale

        def spec(e):
            """(width, segments) for an edge, or None to leave it alone."""
            if len(e.link_faces) != 2:
                return None                        # an open shell edge
            f0, f1 = e.link_faces
            if f0.normal.dot(f1.normal) < -0.8:
                return None                        # a shell and its own back
            if f0.smooth or f1.smooth:
                # Chamfer what was authored flat and leave alone what was
                # authored curved. A rock, a rope or a hull is a continuous
                # surface whose facets are an approximation, not edges -- and
                # putting a 32 mm arris on all 640 facets of a drystone footing
                # cost 40,000 triangles and made the stones look machined.
                return None
            try:
                # Signed, so concave creases are excluded. A convex arris is
                # where the highlight lives; an internal corner is where the
                # occlusion lives, and the AO bake already draws that. Skipping
                # them halves the triangle cost of this pass for nothing you
                # can see.
                if e.calc_face_angle_signed() < angle:
                    return None
            except ValueError:
                return None
            s0 = self.slots[f0.material_index]
            s1 = self.slots[f1.material_index]
            w = min(widths.get(s0, 0.0), widths.get(s1, 0.0))
            if w <= 1e-5:
                return None
            if e.calc_length() < w * 7.0:
                # An edge barely longer than its own chamfer is not an arris,
                # it is a corner detail -- and there are three hundred of them
                # on this set, on nail heads and bolt heads and rivet caps.
                # Chamfering those cost more triangles than the fasteners.
                return None
            n = min(BEVEL_SEGMENTS.get(s0, segments),
                    BEVEL_SEGMENTS.get(s1, segments))
            return round(w, 5), max(1, min(n, max(1, segments) + 1))

        # One op per distinct (width, segments), re-classifying in between:
        # bevel replaces the edges it touches, so a list gathered up front for
        # the second pass would be full of dead references.
        self.bm.normal_update()
        wanted = sorted({sp for sp in (spec(e) for e in self.bm.edges)
                         if sp is not None})
        for want in wanted:
            self.bm.normal_update()
            edges = [e for e in self.bm.edges if spec(e) == want]
            if not edges:
                continue
            try:
                bmesh.ops.bevel(
                    self.bm, geom=edges, offset=want[0], offset_type="OFFSET",
                    segments=want[1], profile=0.5, affect="EDGES",
                    clamp_overlap=True, loop_slide=True, material=-1)
            except TypeError:                      # older bmesh signature
                bmesh.ops.bevel(self.bm, geom=edges, offset=want[0],
                                segments=want[1], affect="EDGES")
        return self

    def auto_smooth(self, angle=38.0):
        """
        Smooth shading everywhere, split only where the surface really creases.

        With the arrises bevelled, the two or three faces across a corner are
        each well under `angle` from their neighbours, so they shade as one
        continuous rounded edge -- and the face they run into is still a flat
        face, because the crease beyond the bevel is over the limit. That is
        the whole trick: rounded highlights on the edges, flat planes between
        them, no smoothing across a genuine corner.
        """
        lim = math.radians(angle)
        self.bm.normal_update()
        for f in self.bm.faces:
            f.smooth = True
        for e in self.bm.edges:
            if len(e.link_faces) != 2:
                e.smooth = False
                continue
            f0, f1 = e.link_faces
            if f0.normal.dot(f1.normal) < -0.8:
                e.smooth = False
                continue
            try:
                e.smooth = e.calc_face_angle() < lim
            except ValueError:
                e.smooth = False
        return self

    def bake_ao(self, samples=20, dist=2.2, strength=0.85, floor=None,
                ground=True):
        """
        Real ambient occlusion, ray-cast against the model itself, multiplied
        into COLOR_0.

        Cosine-weighted hemisphere, fixed Hammersley directions so a rebuild is
        byte-identical, and a linear falloff on hit distance so a beam 2 m away
        shadows less than one 20 cm away. `ground`, which is on for anything
        that stands on the floor, puts a plane in the ray target set as well --
        that is where the contact darkening under a skid or a hull comes from,
        and it is a real contact shadow rather than a height ramp.
        """
        if not self.bm.faces:
            return self
        floor = 0.0 if floor is None else floor
        self.bm.normal_update()

        cast = self.bm.copy()
        bmesh.ops.triangulate(cast, faces=cast.faces[:])
        if ground:
            lo, hi = self.bounds()
            r = max(4.0, (hi - lo).length)
            zf = floor - self.origin.y
            g = [cast.verts.new(Vector((x, y, zf)))
                 for x, y in ((-r, -r), (r, -r), (r, r), (-r, r))]
            cast.faces.new(g)
        tree = BVHTree.FromBMesh(cast, epsilon=0.0)
        cast.free()

        dirs = _hemi_dirs(samples)
        ao = {}
        for v in self.bm.verts:
            n = v.normal
            if n.length < 1e-6:
                ao[v] = 1.0
                continue
            rot = n.to_track_quat("Z", "Y")
            occ = 0.0
            org = v.co + n * 1e-3
            for d, w in dirs:
                hit, _, _, hd = tree.ray_cast(org, rot @ d, dist)
                if hit is not None:
                    occ += w * (1.0 - min(1.0, hd / dist)) ** 0.65
            ao[v] = 1.0 - strength * min(1.0, occ)

        for f in self.bm.faces:
            if self.slots[f.material_index] == "ember":
                continue           # coals are their own light source
            for loop in f.loops:
                a = ao[loop.vert]
                prev = loop[self.col]
                loop[self.col] = (prev[0] * a, prev[1] * a, prev[2] * a, 1.0)
        return self

    def subdivide(self, cuts=1, slots=None):
        """
        Cut every face into smaller ones, optionally only in some slots.

        `roughen` can only push the vertices it is given, and a quarried slab
        built as a fifteen-sided prism has thirty of them -- so displacing it
        moved the whole slab and changed nothing about its surface. Stone wants
        subdividing before it wants noise.

        Welds first, for the reason given in `roughen`.
        """
        self.weld()
        want = None if slots is None else set(slots)
        edges = []
        for e in self.bm.edges:
            if want is None or all(self.slots[f.material_index] in want
                                   for f in e.link_faces):
                edges.append(e)
        if edges:
            bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=max(1, cuts),
                                      use_grid_fill=True)
            self.bm.normal_update()
        return self

    def roughen(self, amount=0.008, freq=2.2, seed=0, octaves=2, slots=None,
                protect_y=None):
        """
        Push vertices along their normals by fractal noise.

        Sawn timber is not flat, quarried stone is nowhere near flat, and the
        thing that gives either of them away at a distance is that its
        highlight runs dead straight. A few millimetres of noise breaks the
        highlight without touching the silhouette. `protect_y` pins anything at
        or below that height so a roughened prop still sits on the floor.

        Welds first, and has to: displacement is along each vertex's own
        normal, so two coincident-but-separate vertices -- a loft's end cap and
        the ring it sits on, the twenty-nine duplicates at a sphere's pole --
        move in different directions and tear apart. That is where the ring
        crack round both legs of the sea arch came from.
        """
        self.weld()
        self.bm.normal_update()
        want = None if slots is None else set(slots)
        # `freq` may be a triple, which stretches the noise along one axis and
        # squashes it along another. That is how you get bedding planes: a sea
        # stack is not isotropically lumpy, it is layered, because the water cut
        # it out of strata -- so the horizontal frequency wants to be a fifth
        # of the vertical one.
        f = Vector((freq, freq, freq)) if isinstance(freq, (int, float)) \
            else Vector(freq)
        for v in self.bm.verts:
            if want is not None:
                if not v.link_faces:
                    continue
                if any(self.slots[f_.material_index] not in want
                       for f_ in v.link_faces):
                    continue
            if protect_y is not None and G(v.co).y + self.origin.y <= protect_y:
                continue
            g = G(v.co) + self.origin
            q = Vector((g.x * f.x, g.y * f.y, g.z * f.z))
            v.co += v.normal * (amount * fbm3(q, seed, octaves))
        return self

    def finish(self, bevel=True, segments=2, bevel_scale=1.0, smooth=True,
               smooth_angle=38.0, ao=True, samples=20, ao_dist=2.2,
               ground=None):
        """The standard closing pass: weld, arrises, shading, occlusion."""
        self.weld()
        if bevel:
            self.bevel(segments=segments, scale=bevel_scale)
        if smooth:
            self.auto_smooth(smooth_angle)
        if ao:
            req = self._ao or {}
            self.bake_ao(samples=samples, dist=ao_dist,
                         strength=min(0.80, 0.30 + req.get("strength", 0.4)),
                         floor=req.get("floor", 0.0),
                         ground=self._ao is not None if ground is None else ground)
        self.finished = True
        return self

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


# --------------------------------------------------------------------------
# Sampling and noise. Both are deterministic: no rebuild of this set should
# ever produce different bytes from the same source, or the diffs are useless.
# --------------------------------------------------------------------------

_HEMI_CACHE = {}


def _hemi_dirs(samples):
    """
    `samples` cosine-weighted directions on the +Z hemisphere, with weights
    that sum to 1. Hammersley, so the set is stratified rather than clumped --
    twenty stratified rays give cleaner occlusion than sixty random ones.
    """
    if samples in _HEMI_CACHE:
        return _HEMI_CACHE[samples]
    out = []
    for i in range(samples):
        u = (i + 0.5) / samples
        b, f = 0.0, 0.5                        # van der Corput, base 2
        k = i + 1
        while k:
            b += f * (k & 1)
            k >>= 1
            f *= 0.5
        r = math.sqrt(u)                       # cosine weighting
        a = TAU * b
        out.append((Vector((r * math.cos(a), r * math.sin(a),
                            math.sqrt(max(0.0, 1.0 - u)))), 1.0 / samples))
    _HEMI_CACHE[samples] = out
    return out


def _vhash(i, j, k, seed):
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 972897) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFF) / 524287.5 - 1.0


def noise3(p, seed=0):
    """Trilinear value noise on the unit lattice, -1..1, smoothstepped."""
    x, y, z = p[0], p[1], p[2]
    i, j, k = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - i, y - j, z - k
    fx, fy, fz = (fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy),
                  fz * fz * (3 - 2 * fz))
    i, j, k = int(i), int(j), int(k)
    out = 0.0
    for dk, wz in ((0, 1 - fz), (1, fz)):
        for dj, wy in ((0, 1 - fy), (1, fy)):
            for di, wx in ((0, 1 - fx), (1, fx)):
                out += wx * wy * wz * _vhash(i + di, j + dj, k + dk, seed)
    return out


def fbm3(p, seed=0, octaves=2, gain=0.5, lacunarity=2.07):
    """Summed octaves of `noise3`, normalised to roughly -1..1."""
    total, amp, norm = 0.0, 1.0, 0.0
    q = Vector(p)
    for o in range(octaves):
        total += amp * noise3(q, seed + o * 977)
        norm += amp
        amp *= gain
        q = q * lacunarity + Vector((3.7, 1.9, 5.3))
    return total / max(norm, 1e-6)


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


def ring_uw(center, radius, seg, u, w, squash=1.0, start=0.0):
    """
    A ring in an explicitly given frame, rather than one derived from an axis.

    `axis_frame` picks its reference vector with `abs(a.y) < 0.9`, which is a
    discontinuity: a sweep whose direction climbs through 64 degrees from
    horizontal gets its frame swapped between one section and the next, the
    ring's start point jumps most of a quarter turn, and the loft between the
    two sections pleats into a collar sticking out of the surface. That is
    exactly what happened to both legs of the sea arch, at y = 4.66 m on each,
    which is where the tangent of a 9 m semicircle passes through that angle.
    So sweeps carry their frame along themselves instead -- see `_frames`.
    """
    c = Vector(center)
    out = []
    for k in range(seg):
        t = start + TAU * k / seg
        out.append(tuple(c + u * (math.cos(t) * radius) +
                         w * (math.sin(t) * radius * squash)))
    return out


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
    seg = _sc(seg)
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
    seg = _sc(seg)
    sections = []
    for r, h in profile:
        sections.append(ring(c + a * h, max(r, 0.0), seg, a, start))
    return loft(part, sections, slot, smooth=smooth,
                cap_start=cap_start and profile[0][0] > 1e-5,
                cap_end=cap_end and profile[-1][0] > 1e-5)


def sphere(part, center, radius, slot, rings=4, seg=8, smooth=True, squash=1.0):
    rings, seg = _sc(rings, 3), _sc(seg)
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
    majseg, minseg = _sc(majseg), _sc(minseg)
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
    seg = _scg(seg, 4, 1.6)
    sections = [ring_uw(c, radius, seg, u, w) for c, _, u, w in _frames(pts)]
    return loft(part, sections, slot, smooth=smooth,
                cap_start=caps, cap_end=caps)


def rope_line(part, p0, p1, slot="rope", sag=0.06, steps=5, radius=0.022, seg=4):
    """A slack line between two points. Handrails, rigging, drying lines."""
    a, b = Vector(p0), Vector(p1)
    steps = _sc(steps)
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
    nu, nv = _sc(nu, 2), _sc(nv, 1)
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


def model(filename, cls, note="", anchor="ground", detail=None, finish=None):
    """
    Register a build function. `cls` is a key of BUDGET. `anchor` says what the
    origin means, and is what verify_props.py checks against:
      ground  footprint centre on the ground plane   (the default)
      hang    the hang point, geometry below it
      hinge   a hinge or axis, for a part shipped on its own

    `detail` is this model's segment multiplier, defaulting to something
    sensible for its class -- a prop the level stamps out six hundred times
    cannot afford the same round cylinders as one it places once. `finish`
    overrides the closing pass (see `Part.finish`) for the rare model that
    needs, say, no ground plane in its occlusion.
    """
    def deco(fn):
        MODELS.append({"file": filename, "cls": cls, "note": note,
                       "anchor": anchor, "fn": fn,
                       "detail": DEFAULT_DETAIL[cls] if detail is None else detail,
                       "finish": dict(finish or {})})
        return fn
    return deco


# Detail per class. These are deliberately modest, because after the first
# rewrite of this set they were not: a 70 mm pole came out sixteen-sided and a
# house cost 75,000 triangles, most of them spent making cylinders rounder than
# any camera in the game can resolve. What actually reads as realism is the
# number of PARTS -- staves, shingles, stones, nails -- and those are counted
# in the build scripts, not here. This knob only has to be big enough that a
# curve does not visibly facet.
DEFAULT_DETAIL = {
    "tiled": 1.0, "scatter": 1.2, "small": 1.5,
    "medium": 1.6, "structure": 1.7, "hero": 2.1,
}


def _finish_defaults(detail):
    """
    Closing-pass settings that track the detail level.

    One bevel segment is a flat chamfer, which is what a sawn arris actually
    is and what catches a clean highlight; two is a fillet, right for iron and
    for anything the player gets close to. Going past two buys nothing you can
    see and costs four times the triangles on every box in the model.
    """
    return dict(
        segments=1 if detail < 2.0 else 2,
        samples=10 if detail < 1.4 else (16 if detail < 2.0 else 24),
        smooth_angle=38.0,
    )


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
    global DETAIL
    for entry in MODELS:
        name = entry["file"]
        if only and name not in only:
            continue
        reset_scene()
        DETAIL = entry["detail"]
        t0 = time.time()
        parts = entry["fn"]()
        if isinstance(parts, Part):
            parts = [parts]
        kw = _finish_defaults(DETAIL)
        kw.update(entry["finish"])
        for p in parts:
            if not p.finished:
                p.finish(**kw)
        DETAIL = 2.0
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
        meta[name]["detail"] = entry["detail"]
        print("built %-28s %6d/%-6d tris  d%.1f  %4.1fs  %s%s" %
              (name, tris, cap, entry["detail"], time.time() - t0,
               ",".join(meta[name]["slots"]), flag))
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


def rock_section_uw(center, radius, seg, u, w, amp=0.18, squash=1.0, seed=0,
                    freq=0.85):
    """`rock_section` in an explicit frame. See `ring_uw` for why."""
    c = Vector(center)
    out = []
    for p in ring_uw(center, radius, seg, u, w, squash=squash):
        d = Vector(p) - c
        q = Vector(p) * freq + Vector((seed * 0.31, seed * 0.17, seed * 0.53))
        out.append(tuple(c + d * (1.0 + amp * fbm3(q, seed, 3))))
    return out


def rock_section(center, radius, seg, axis, t, phase, amp=0.18, squash=1.0,
                 seed=0, freq=0.85):
    """
    A ring pushed in and out by fractal noise sampled at the surface point.

    This used to be a sine of (vertex index, t), which is a stationary wave in
    the section and a slow drift along the sweep -- so a swept rock came out
    fluted, with ridges and valleys running its whole length like corrugated
    iron. Sampling 3D noise at the point itself is isotropic: the lumps are
    lumps, they are the same size in every direction, and they stay put when
    the section count changes.
    """
    c = Vector(center)
    out = []
    for p in ring(center, radius, seg, axis, squash=squash):
        d = Vector(p) - c
        q = Vector(p) * freq + Vector((seed * 0.31, seed * 0.17, seed * 0.53))
        f = 1.0 + amp * fbm3(q, seed, 3)
        out.append(tuple(c + d * f))
    return out


def sweep_rock(part, path, radii, seg, slot, seed=0, amp=0.18, smooth=False,
               cap_start=True, cap_end=True):
    """Loft rock_sections along a path. `path` and `radii` are the same length."""
    seg = _sc(seg)
    frames = _frames([Vector(p) for p in path])
    sections = [rock_section_uw(c, r, seg, u, w, amp, seed=seed)
                for (c, _, u, w), r in zip(frames, radii)]
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


# --------------------------------------------------------------------------
# Construction. The primitives above make shapes; these make *things that were
# built*, which is a different problem. A deck is not a slab, it is boards
# that a person cut slightly wrong and nailed down; a roof is not a plane, it
# is four hundred shingles; a rope is not a tube, it is three strands laid
# right-handed. Every function here exists because the thing it replaces read
# as a primitive from the air.
# --------------------------------------------------------------------------

def smooth_path(points, per_span=None, closed=False):
    """
    Resample a polyline through a Catmull-Rom spline.

    Sweeps, ropes and rockers were all authored with as few control points as
    the shape needed. Detail wants them denser without moving the shape, and
    interpolating the control points is how you get that -- subdividing
    linearly just adds vertices to the same straight lines.
    """
    pts = [Vector(p) for p in points]
    if len(pts) < 3:
        return [tuple(p) for p in pts]
    n = per_span if per_span is not None else max(1, int(round(DETAIL * 2)))
    if n <= 1:
        return [tuple(p) for p in pts]
    ext = ([pts[-2]] if closed else [pts[0] * 2 - pts[1]]) + pts + \
          ([pts[1]] if closed else [pts[-1] * 2 - pts[-2]])
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t +
                                    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                                    (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    out.append(tuple(pts[-1]))
    return out


def _frames(pts):
    """Parallel-transported frames along a path, so a sweep does not twist."""
    n = len(pts)
    tans = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tans.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    u, _ = axis_frame(tans[0])
    out = []
    for i, t in enumerate(tans):
        if i:
            u = u - t * u.dot(t)                  # transport, do not re-derive
            if u.length < 1e-6:
                u, _ = axis_frame(t)
            u.normalize()
        out.append((pts[i], t, u.copy(), u.cross(t).normalized()))
    return out


# -- fasteners --------------------------------------------------------------

def nail(part, pos, dirv=(0, 1, 0), r=0.011, stand=0.0035, slot="iron",
         seg=None):
    """
    One hand-forged nail head, proud of the surface it went into.

    Fasteners are the cheapest realism in the kit: six of them along a plank
    say sawmill, hand-hammered and load-bearing all at once, for eighteen
    triangles. They are modelled proud rather than flush because a flush head
    is invisible -- what you actually see on a real deck is the shadow under
    the lip and the wear ring around it.
    """
    d = Vector(dirv).normalized()
    c = Vector(pos)
    s = _scg(5 if seg is None else seg, 5, 1.4)
    return loft(part, [ring(c + d * 0.001, r * 0.80, s, d),
                       ring(c + d * stand, r, s, d)],
                slot, smooth=True, cap_start=False, cap_end=True)


def bolt(part, pos, dirv=(0, 1, 0), r=0.016, stand=0.014, slot="iron"):
    """A hex head and its washer -- what holds iron to iron on the rig."""
    d = Vector(dirv).normalized()
    c = Vector(pos)
    made = loft(part, [ring(c, r * 1.5, 6, d, start=math.pi / 6),
                       ring(c + d * 0.004, r * 1.5, 6, d, start=math.pi / 6)],
                slot, cap_start=False, cap_end=False)          # washer
    made += loft(part, [ring(c + d * 0.004, r, 6, d, start=math.pi / 6),
                        ring(c + d * stand, r, 6, d, start=math.pi / 6),
                        ring(c + d * (stand + 0.003), r * 0.86, 6, d,
                             start=math.pi / 6)],
                 slot, cap_start=False, cap_end=True)
    return made


def nail_row(part, a, b, count, dirv=(0, 1, 0), r=0.011, slot="iron",
             stagger=0.0):
    """`count` nails evenly along a line, optionally zig-zagged across it."""
    p0, p1 = Vector(a), Vector(b)
    side = Vector(dirv).normalized().cross((p1 - p0).normalized()) * stagger
    out = []
    for i in range(count):
        t = (i + 0.5) / count
        out += nail(part, tuple(p0.lerp(p1, t) + side * (1 if i % 2 else -1)),
                    dirv, r=r, slot=slot)
    return out


# -- iron in the round ------------------------------------------------------

def chain_links(part, points, link=0.17, wire=0.026, slot="iron",
                majseg=8, minseg=4):
    """
    Chain as actual interlocking links: oval loops, each rolled 90 degrees
    from its neighbour.

    The old `chain_run` faked this with a rolled square section, which was the
    right call at 400 triangles a prop and is the wrong one now. A hoisting
    chain is the one piece of ironmongery the player gets close to -- it hangs
    off the crane at head height -- and a fake chain is obvious the moment you
    can see daylight between the links.
    """
    pts = [Vector(q) for q in points]
    frames = _frames(pts)
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    step = link * 0.62                       # links overlap by ~40%
    count = max(2, int(total / step))
    made = []
    for i in range(count):
        d = min(total, (i + 0.5) * step)
        acc, fr = 0.0, frames[-1]
        for j in range(len(pts) - 1):
            seg = (pts[j + 1] - pts[j]).length
            if acc + seg >= d:
                f = 0.0 if seg < 1e-9 else (d - acc) / seg
                a, b = frames[j], frames[min(j + 1, len(frames) - 1)]
                fr = (a[0].lerp(b[0], f), a[1].lerp(b[1], f).normalized(),
                      a[2].lerp(b[2], f).normalized(),
                      a[3].lerp(b[3], f).normalized())
                break
            acc += seg
        c, t, u, w = fr
        flat = u if i % 2 else w             # every other link on its side
        half = link * 0.5 - wire
        # A stadium: two straights joined by two half-turns, swept round.
        path = []
        n = max(4, majseg // 2)
        for k in range(n + 1):
            ang = math.pi * k / n - math.pi / 2
            path.append(t * (half + math.cos(ang) * (link * 0.22)) +
                        flat * (math.sin(ang) * (link * 0.22)))
        for k in range(n + 1):
            ang = math.pi * k / n + math.pi / 2
            path.append(t * (-half + math.cos(ang) * (link * 0.22)) +
                        flat * (math.sin(ang) * (link * 0.22)))
        secs = []
        for k, off in enumerate(path):
            nxt = path[(k + 1) % len(path)]
            prv = path[k - 1]
            secs.append(ring(tuple(c + off), wire, _sc(minseg, 4),
                             tuple(nxt - prv)))
        made += loft(part, secs + [secs[0]], slot, smooth=True,
                     cap_start=False, cap_end=False)
    return made


# -- fibre ------------------------------------------------------------------

def rope_run(part, points, radius=0.024, slot="rope", strands=3, lay=1.7,
             seg=None, per_turn=7):
    """
    Rope as laid rope: three strands spiralling round a common spine.

    A smooth tube is the one thing in the kit that never passed for its
    material -- rope is defined by its lay, the diagonal ribbing that tells you
    it is twisted fibre and which way. `lay` is turns per metre; per_turn is how
    finely each turn is sampled, and below about six the spiral aliases into
    a stack of beads.
    """
    pts = [Vector(p) for p in points]
    if len(pts) < 2:
        return []
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    if strands < 2 or DETAIL < 1.5 or total < 1e-4:
        return polyline_tube(part, [tuple(p) for p in pts], radius, slot,
                             seg=_sc(4, 4), smooth=True)
    n = max(4, int(round(total * lay * per_turn)))
    dense = smooth_path([tuple(p) for p in pts],
                        per_span=max(1, n // max(1, len(pts) - 1)))
    frames = _frames([Vector(p) for p in dense])
    arc, run = [0.0], 0.0
    for a, b in zip(frames, frames[1:]):
        run += (b[0] - a[0]).length
        arc.append(run)
    rs = radius * 0.52                      # strand radius
    off = radius - rs
    made = []
    ssec = _sc(3, 3)
    for k in range(strands):
        base = TAU * k / strands
        secs = []
        for (c, t, u, w), a in zip(frames, arc):
            ang = base + TAU * lay * a
            d = u * math.cos(ang) + w * math.sin(ang)
            # The strand's own axis leans across the spine by the lay angle.
            tangent = t + (u * -math.sin(ang) + w * math.cos(ang)) * \
                (TAU * lay * off)
            secs.append(ring(tuple(c + d * off), rs, ssec, tuple(tangent)))
        made += loft(part, secs, slot, smooth=True,
                     cap_start=True, cap_end=True)
    return made


def rope_span(part, p0, p1, radius=0.024, slot="rope", sag=0.06, steps=5,
              **kw):
    """A slack laid rope between two points. Handrails, rigging, drying lines."""
    a, b = Vector(p0), Vector(p1)
    steps = max(4, _sc(steps))
    pts = []
    for i in range(steps + 1):
        t = i / steps
        p = a.lerp(b, t)
        p.y -= sag * 4.0 * t * (1.0 - t)
        pts.append(tuple(p))
    return rope_run(part, pts, radius, slot, **kw)


def lashing(part, center, radius, axis=(1, 0, 0), turns=4, wire=0.016,
            width=None, slot="rope", spread=None):
    """
    A rope seizing: several turns of small stuff round a joint.

    Every joint at the Hollow Stack is lashed rather than nailed -- he made it
    with his mouth -- so this is the single most repeated detail in that set,
    and a torus was standing in for it.
    """
    c = Vector(center)
    a = Vector(axis).normalized()
    span = (wire * 2.3 * turns) if width is None else width
    u, w = axis_frame(a)
    pts = []
    steps = max(8, int(round(turns * _sc(6, 5))))
    for i in range(steps + 1):
        t = i / steps
        ang = TAU * turns * t
        r = radius * (1.0 + (0.0 if spread is None else spread *
                             math.sin(math.pi * t)))
        pts.append(tuple(c + a * (span * (t - 0.5)) +
                         (u * math.cos(ang) + w * math.sin(ang)) * r))
    return rope_run(part, pts, wire, slot, strands=2, lay=6.0, per_turn=5)


# -- roofs ------------------------------------------------------------------

def _patch_normal(fn, u, v, eps=1e-3, bias=(0, 1, 0)):
    """
    Surface normal of a patch, flipped to agree with `bias`.

    Which way `du x dv` points depends on how the caller happened to
    parameterise the patch, and a roof laid with its shingles pointing into the
    rafters is not a detectable mistake until you render it.
    """
    du = Vector(fn(min(1.0, u + eps), v)) - Vector(fn(max(0.0, u - eps), v))
    dv = Vector(fn(u, min(1.0, v + eps))) - Vector(fn(u, max(0.0, v - eps)))
    n = du.cross(dv)
    if n.length < 1e-9:
        return Vector((0, 1, 0))
    n.normalize()
    return -n if n.dot(Vector(bias)) < 0 else n


def _patch_extent(fn, n=14):
    """
    How big the patch actually is, in metres: across (u) and up the slope (v).

    Courses used to be specified as counts, which meant every roof in the set
    needed its own hand-tuned number and the noise on a wide roof aliased into
    smooth ribbons because it was sampled at the same rate as a narrow one.
    Measure the surface and lay real 300 mm shingles on it instead.
    """
    wid = sum((Vector(fn((i + 1) / n, 0.5)) - Vector(fn(i / n, 0.5))).length
              for i in range(n))
    run = sum((Vector(fn(0.5, (i + 1) / n)) - Vector(fn(0.5, i / n))).length
              for i in range(n))
    return max(wid, 1e-3), max(run, 1e-3)


def _coarse(x):
    """Ease a real-world pitch out at low detail, but never past 1.6x."""
    return x * (1.6 - 0.3 * min(2.0, max(1.0, DETAIL)))


def shingle_courses(part, fn, slot="wood_dark", width=0.30, exposure=0.17,
                    thickness=0.045, overlap=2.2, gap=0.014, jitter=0.022,
                    seed=0, overhang=0.06):
    """
    Cleave a roof surface into courses of individual shingles.

    `fn(u, v)` is the roof patch, u across the slope and v from eave (0) to
    ridge (1). `width` and `exposure` are the real dimensions of one shingle
    and of the part of it that stays visible, so the same call lays a correct
    roof on a 6 m house and on an 18 m hall.

    Every shingle gets its own stand-off, a millimetre or two of rotation and a
    slightly wrong length, and every other course is offset by half a shingle.
    That last one matters more than all the rest: with the joints aligned, the
    roof reads as boards running up the slope, which is what the first version
    of this looked like and the only thing wrong with it.
    """
    wid, run = _patch_extent(fn)
    per_course = max(3, int(round(wid / _coarse(width))))
    courses = max(3, int(round(run / _coarse(exposure))))
    r = random.Random(seed)
    made = []
    for j in range(courses):
        v0 = j / courses
        v1 = min(1.0, v0 + overlap / courses)
        shift = (0.5 if j % 2 else 0.0) + r.uniform(-0.06, 0.06)
        for i in range(-1, per_course + 1):
            u0 = (i + shift) / per_course
            u1 = (i + 1 + shift) / per_course
            if u1 <= 0.0 or u0 >= 1.0:
                continue
            u0, u1 = max(0.0, u0), min(1.0, u1)
            g = (gap * 0.5) / wid
            uu0, uu1 = u0 + g, u1 - g
            if uu1 - uu0 < g:
                continue
            # Hand-cleft shingles are not a milled product: each one is a
            # different thickness and sits a little proud of its neighbour,
            # and that unevenness along the butt line is exactly what stops a
            # roof looking like a printed texture from the air.
            lift = thickness * (1.0 + r.uniform(-0.25, 0.55))
            tilt = r.uniform(0.1, 1.0) * jitter
            butt = v0 - (overhang / run if j == 0 else 0.0)
            corners = []
            for uu, vv, k in ((uu0, butt, 0), (uu1, butt, 0),
                              (uu1, v1, 1), (uu0, v1, 1)):
                uu = max(0.0, min(1.0, uu))
                base = Vector(fn(uu, max(-0.08, min(1.0, vv))))
                nrm = _patch_normal(fn, uu, max(0.0, min(1.0, vv)))
                corners.append(base + nrm * (lift + (tilt if k == 0 else
                                                     -thickness * 0.35)))
            made += part.add([tuple(c) for c in corners], [(0, 1, 2, 3)], slot,
                             grain=tuple(corners[3] - corners[0]))
            # The butt: the edge you actually see, and what casts the shadow on
            # the course below. Its corners sit at different heights, so the
            # shadow line under it wanders.
            nrm = _patch_normal(fn, (uu0 + uu1) * 0.5, max(0.0, butt))
            drop = thickness * (1.4 + r.uniform(0.0, 0.7))
            made += part.add([tuple(corners[0]), tuple(corners[1]),
                              tuple(corners[1] - nrm * drop),
                              tuple(corners[0] - nrm * drop * 0.85)],
                             [(0, 1, 2, 3)], slot,
                             grain=tuple(corners[1] - corners[0]))
            # And the gap down one side, so the vertical joints read as well.
            made += part.add([tuple(corners[0] - nrm * drop),
                              tuple(corners[0]), tuple(corners[3]),
                              tuple(corners[3] - nrm * drop * 0.3)],
                             [(0, 1, 2, 3)], slot,
                             grain=tuple(corners[3] - corners[0]))
    return made


def thatch_courses(part, fn, slot="rope", exposure=0.20, pitch=0.085,
                   depth=0.17, overlap=2.4, seed=0, straws=0.9):
    """
    Bundled straw: deep courses with a ragged, uneven butt, plus loose ends.

    Thatch differs from shingle in the two ways that read from the air. It is
    thick, so the butt of each course is a deep shadowed band rather than a
    line -- and it is soft, so nothing about it is straight or flat. So a
    course here is one continuous strip that swells and thins along its length
    at the bundle pitch, and the butt below it is cut to a different depth
    every few centimetres. `straws` is loose ends per metre of eave; they are
    what stops the eave reading as a cut edge.
    """
    wid, run = _patch_extent(fn)
    courses = max(4, int(round(run / _coarse(exposure))))
    n = max(6, int(round(wid / _coarse(pitch))))
    made = []
    for j in range(courses):
        v0 = j / courses
        v1 = min(1.0, v0 + overlap / courses)
        # How far this course stands off the rafters, and where its butt line
        # wanders to -- both at the bundle pitch, in metres, so a wide roof
        # gets more bundles rather than bigger ones.
        def out(u, k=j):
            return depth * (0.78 + 0.42 * fbm3(
                Vector((u * wid / pitch * 0.5, k * 2.7, 0.0)), seed, 2))

        def butt(u, k=j):
            return v0 - (0.45 / courses) * (0.5 + 0.5 * fbm3(
                Vector((u * wid / pitch * 0.7, k * 3.9, 1.0)), seed + 13, 2))

        low, top = [], []
        for i in range(n + 1):
            u = i / n
            low.append(Vector(fn(u, max(-0.04, butt(u)))) +
                       _patch_normal(fn, u, max(0.0, v0)) * out(u))
            top.append(Vector(fn(u, v1)) +
                       _patch_normal(fn, u, v1) * (out(u) * 0.42))
        made += loft(part, [[tuple(a), tuple(b)] for a, b in zip(low, top)],
                     slot, closed=False, cap_start=False, cap_end=False,
                     smooth=True)
        deep = []
        for i, a in enumerate(low):
            u = i / n
            d = out(u) * (1.7 + 1.3 * (0.5 + 0.5 * fbm3(
                Vector((u * wid / pitch, j * 5.1, 2.0)), seed + 29, 2)))
            deep.append(a - _patch_normal(fn, u, max(0.0, v0)) * d)
        made += loft(part, [[tuple(a), tuple(b)] for a, b in zip(deep, low)],
                     slot, closed=False, cap_start=False, cap_end=False,
                     smooth=False)
    r = random.Random(seed + 991)
    count = max(3, int(straws * wid * min(2.0, max(1.0, DETAIL))))
    for i in range(count):
        u = min(0.999, max(0.001, (i + 0.5) / count + r.uniform(-0.02, 0.02)))
        v = r.uniform(0.02, 0.55)
        nrm = _patch_normal(fn, u, v)
        a = Vector(fn(u, v)) + nrm * depth * 0.95
        b = a + Vector((r.uniform(-0.08, 0.08), -0.30 - r.uniform(0, 0.22),
                        r.uniform(-0.08, 0.08)))
        made += polyline_tube(part, [tuple(a), tuple(a.lerp(b, 0.5)),
                                     tuple(b)], 0.009, slot, seg=3)
    return made


# -- stone and timber as found --------------------------------------------

def boulder(part, center, size=None, slot="stone", seed=0, seg=9, rings=6,
            amp=0.26, bed=None, smooth=True, cap=None, radii=None,
            along=None):
    """
    One rock. Fractal radius, so it has facets, hollows and a silhouette that
    is not an ellipse -- which is the whole difference between a rock and a
    squashed sphere. `bed` clamps everything below that height, so it beds into
    the ground instead of resting on it like an egg.

    `along` turns the long axis to lie in a given direction, which is what a
    stone in a wall does: quarried stone is laid on its bed with its length
    running along the course, never on end.
    """
    c = Vector(center)
    if radii is None:
        radii = size if isinstance(size, (tuple, list, Vector)) \
            else (size, size, size)
    sx, sy, sz = radii
    ex = Vector((1, 0, 0)) if along is None else Vector(along)
    ex.y = 0.0
    ex = ex.normalized() if ex.length > 1e-9 else Vector((1, 0, 0))
    ez = Vector((-ex.z, 0.0, ex.x))
    ey = Vector((0, 1, 0))
    seg, rings = (_sc(seg), _sc(rings, 4)) if cap is None else \
                 (_scg(seg, 5, cap), _scg(rings, 4, cap))
    secs = []
    for i in range(rings + 1):
        t = math.pi * i / rings
        sr, sh = math.sin(t), -math.cos(t)
        sec = []
        for k in range(seg):
            a = TAU * k / seg
            d = Vector((math.cos(a) * sr, sh, math.sin(a) * sr))
            f = 1.0 + amp * fbm3(d * 1.7 + Vector((seed, seed * 0.7, 0)),
                                 seed, 3)
            p = c + ex * (d.x * sx * f) + ey * (d.y * sy * f) + \
                ez * (d.z * sz * f)
            if bed is not None and p.y < bed:
                p.y = bed
            sec.append(tuple(p))
        secs.append(sec)
    return loft(part, secs, slot, smooth=smooth,
                cap_start=False, cap_end=False)


def stone_course(part, points, height=0.30, width=0.34, slot="stone",
                 seed=0, step=None, bed=0.0):
    """
    A footing course: individual stones laid along a line, each bedded, each a
    slightly different size, none of them square.

    Berk's walls stood on a drystone footing, and the lofted prism that stood
    in for one read as a concrete kerb. Stones cost about forty triangles each
    and they are the first thing the eye checks on a building.
    """
    pts = [Vector(p) for p in smooth_path(points)]
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    step = (width * 0.74) if step is None else step
    n = max(2, int(total / step))
    r = random.Random(seed)
    made = []
    for i in range(n):
        d = (i + 0.5) * total / n
        acc = 0.0
        c, side = pts[-1], Vector((1, 0, 0))
        for a, b in zip(pts, pts[1:]):
            seg = (b - a).length
            if acc + seg >= d:
                c = a.lerp(b, 0.0 if seg < 1e-9 else (d - acc) / seg)
                run = (b - a)
                side = Vector((-run.z, 0.0, run.x))
                if side.length > 1e-9:
                    side.normalize()
                break
            acc += seg
        # Two courses, roughly. Real drystone is laid in overlapping beds with
        # the big stones low and small ones filling the gaps above; one row of
        # equal ellipsoids reads as a string of eggs, which is what this was.
        lower = i % 3 != 2
        h = height * (r.uniform(0.42, 0.60) if lower else r.uniform(0.30, 0.44))
        y = bed + (h * 0.5 if lower else height * 0.52 + h * 0.42)
        long = width * r.uniform(0.62, 1.05) * (1.0 if lower else 0.7)
        made += boulder(part, tuple(Vector((c.x, y, c.z)) +
                                    side * (r.uniform(-0.05, 0.05) * width)),
                        (0.0, 0.0, 0.0), slot, seed=seed + i * 7, seg=6,
                        rings=4, amp=0.26, bed=bed + 0.004, cap=1.0,
                        radii=(long * 0.5, h * 0.62, width * 0.30 *
                               r.uniform(0.85, 1.2)), along=tuple(side))
    return made


def timber_pole(part, p0, p1, r0, r1=None, slot="wood_dark", seg=7, bend=0.035,
                seed=0, knots=2, sections=5):
    """
    A round pole with a tree still in it: a slight bend, a taper that is not
    linear, and a knot or two where a branch came off.

    Everything at Berk and the Stack is unmilled timber, and a straight
    circular cylinder is the most synthetic-looking object it is possible to
    put in a scene.
    """
    a, b = Vector(p0), Vector(p1)
    if r1 is None:
        r1 = r0 * 0.82
    axis = b - a
    L = axis.length
    if L < 1e-6:
        return []
    u, w = axis_frame(axis)
    n = max(3, _sc(sections, 3))
    path, radii = [], []
    for i in range(n + 1):
        t = i / n
        lean = math.sin(math.pi * t) * bend * L
        p = a + axis * t + u * (lean * math.cos(seed * 1.7)) + \
            w * (lean * math.sin(seed * 1.7))
        path.append(tuple(p))
        r = r0 + (r1 - r0) * t ** 1.25
        # One slow swell, not a beat per section: at 0.05 amplitude and seven
        # cycles this aliased against the section count and every pole in the
        # village came out looking like bamboo.
        r *= 1.0 + 0.022 * math.sin(t * 2.3 + seed)
        radii.append(r)
    made = sweep_rock(part, path, radii, seg, slot, seed=seed + 31, amp=0.055,
                      smooth=True)
    rk = random.Random(seed + 5)
    for k in range(knots):
        t = 0.22 + 0.5 * ((k + rk.random() * 0.6) / max(1, knots))
        c = Vector(path[max(0, min(n, int(t * n)))])
        rr = radii[max(0, min(n, int(t * n)))]
        ang = rk.uniform(0, TAU)
        d = (u * math.cos(ang) + w * math.sin(ang)).normalized()
        made += loft(part, [ring(tuple(c + d * rr * 0.55), rr * 0.42,
                                 _sc(4, 4), tuple(d)),
                            ring(tuple(c + d * rr * 1.35), rr * 0.30,
                                 _sc(4, 4), tuple(d)),
                            ring(tuple(c + d * rr * 1.5), rr * 0.20,
                                 _sc(4, 4), tuple(d))],
                     slot, smooth=True, cap_start=False, cap_end=True)
    return made


def plank_deck(part, x0, x1, z0, z1, y, width=0.24, thickness=0.045,
               gap=0.012, slot="wood", along_z=True, seed=0, nails_at=(),
               nail_slot="iron", jitter=0.004, butt_at=None):
    """
    A run of floorboards: real widths, real gaps, one board proud of the next,
    end joints staggered, and a nail in each board over each bearer.

    The old decks were four wide boxes. Boards are 200-250 mm because that is
    what a tree gives you, and the pattern of many narrow boards with a dark
    line between each pair is most of what a deck looks like from above.
    """
    r = random.Random(seed + 17)
    made = []
    lo, hi = (x0, x1) if along_z else (z0, z1)
    span = hi - lo
    pitch = width + gap
    n = max(1, int(round(span / pitch)))
    pitch = span / n
    for i in range(n):
        c = lo + pitch * (i + 0.5)
        w = pitch - gap
        yy = y + r.uniform(-jitter, jitter)
        runs = [(z0, z1)] if butt_at is None else []
        if butt_at is not None:
            cut = butt_at[i % len(butt_at)]
            runs = [(z0, cut - gap * 0.5), (cut + gap * 0.5, z1)] \
                if z0 < cut < z1 else [(z0, z1)]
        for (a, b) in runs:
            if along_z:
                box(part, (c, yy, (a + b) * 0.5), (w, thickness, b - a), slot,
                    grain=(0, 0, 1))
            else:
                box(part, ((a + b) * 0.5, yy, c), (b - a, thickness, w), slot,
                    grain=(1, 0, 0))
        for t in nails_at:
            if along_z:
                p = (c, yy + thickness * 0.5, t)
            else:
                p = (t, yy + thickness * 0.5, c)
            made += nail(part, p, (0, 1, 0), r=0.010, slot=nail_slot)
    return made
