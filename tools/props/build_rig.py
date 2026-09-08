"""
P0 -- The Rig.

An industrial dragon-capture platform on pilings. The brief is emphatic that
this is a factory and not a pirate camp, so everything here is square, repeated
on a grid, banded with iron and free of picturesque rot. The only weathering is
below the waterline mark on the pilings, where it is a fact rather than a mood.
"""
from propkit import *  # noqa


# --------------------------------------------------------------------------
# Decking and access
# --------------------------------------------------------------------------

@model("rig_deck_4m.glb", "structure", "4x4 m module, snaps on the 2 m grid; top face at y=0.30")
def rig_deck_4m():
    p = Part("rig_deck_4m")
    for z in (-1.6, -0.8, 0.0, 0.8, 1.6):            # bearers across X
        beam(p, (-2.0, 0.11, z), (2.0, 0.11, z), 0.10, 0.22, "wood_dark")
    for x in (-1.94, 1.94):                          # rim beams down Z
        beam(p, (x, 0.11, -2.0), (x, 0.11, 2.0), 0.12, 0.22, "wood_dark")
    for i in range(8):                               # decking, 10 mm gaps
        box(p, (-1.75 + i * 0.5, 0.26, 0.0), (0.48, 0.08, 4.0), "wood",
            grain=(0, 0, 1))
    p.contact_shade(reach=0.25, strength=0.35)
    return p


@model("rig_deck_ramp.glb", "structure", "4 m run to a deck top at y=2.00; iron kick plate at the toe")
def rig_deck_ramp():
    p = Part("rig_deck_ramp")
    # Eight planks laid along the slope. Their sections are square to the
    # slope, so the walking surface is a plane and not a flight of steps.
    for i in range(8):
        x = -1.75 + i * 0.5
        # Ends pulled in by 20 mm: the section is square to the slope, so its
        # corners would otherwise push the module past 4.000 m.
        beam(p, (x, 0.042, -1.98), (x, 1.960, 1.98), 0.48, 0.09, "wood")
    # Stringers: long shallow wedges, nothing under the toe.
    for x in (-1.86, 0.0, 1.86):
        prism_x(p, [(-2.0, 0.0), (2.0, 1.92), (2.0, 1.28)],
                x - 0.07, x + 0.07, "wood_dark")
    # Cleats across, for grip, and a kick plate where it meets the deck below.
    a = Vector((0.0, 1.92, 4.0)).normalized()
    for i in range(7):
        t = 0.10 + i * 0.13
        c = Vector((0.0, 0.08, -2.0)) + a * (t * 4.47)
        beam(p, (-1.95, c.y, c.z), (1.95, c.y, c.z), 0.07, 0.05, "wood_dark",
             up=(0, 0.894, -0.447))
    box(p, (0.0, 0.045, -1.89), (3.9, 0.09, 0.22), "iron", grain=(1, 0, 0))
    p.contact_shade(reach=0.5, strength=0.3)
    return p


@model("rig_walkway_4m.glb", "structure", "1.5 m wide, rope handrail both sides; deck top at y=0.30")
def rig_walkway_4m():
    p = Part("rig_walkway_4m")
    for z in (-1.95, -1.0, 0.0, 1.0, 1.95):
        beam(p, (-0.75, 0.11, z), (0.75, 0.11, z), 0.10, 0.22, "wood_dark")
    for x in (-0.5, 0.0, 0.5):
        box(p, (x, 0.26, 0.0), (0.48, 0.08, 4.0), "wood", grain=(0, 0, 1))
    for sx in (-1, 1):
        for z in (-1.95, 0.0, 1.95):
            beam(p, (sx * 0.68, 0.30, z), (sx * 0.68, 1.30, z), 0.10, 0.10,
                 "wood_dark", up=(0, 0, 1))
        for y in (0.78, 1.22):
            for z0, z1 in ((-1.95, 0.0), (0.0, 1.95)):
                rope_line(p, (sx * 0.68, y, z0), (sx * 0.68, y, z1),
                          sag=0.05, steps=4)
    p.contact_shade(reach=0.3, strength=0.35)
    return p


@model("rig_piling.glb", "small", "12 m pile; waterline mark and growth up to y=6.00")
def rig_piling():
    p = Part("rig_piling")
    cyl(p, (0, 0, 0), (0, 6.0, 0), 0.40, 0.36, 8, "wood_dark", caps=False)
    cyl(p, (0, 6.0, 0), (0, 12.0, 0), 0.35, 0.29, 8, "wood", caps=True)
    for y, r in ((6.02, 0.38), (9.0, 0.35), (11.55, 0.32)):   # iron bands
        cyl(p, (0, y - 0.09, 0), (0, y + 0.09, 0), r, r, 8, "iron", caps=False)
    return p


@model("rig_ladder_3m.glb", "small", "stackable end to end; stiles 3.00 m")
def rig_ladder_3m():
    p = Part("rig_ladder_3m")
    for sx in (-1, 1):
        beam(p, (sx * 0.28, 0.0, 0.0), (sx * 0.28, 3.0, 0.0), 0.09, 0.05,
             "wood", up=(0, 0, 1))
    for i in range(9):
        y = 0.16 + i * 0.335
        cyl(p, (-0.28, y, 0), (0.28, y, 0), 0.035, 0.035, 6, "wood_dark")
    return p


# --------------------------------------------------------------------------
# Cages -- the reason the rig exists
# --------------------------------------------------------------------------

def _cage_door(name, swing=0.0):
    """
    The large cage's door. Origin is the hinge line at x=-1.35, z=+2.25, so the
    node rotates about +Y in place. `swing` bakes an angle in for the standalone
    open version.
    """
    d = Part(name, (-1.35, 0.0, 2.25))
    hinge = Vector((-1.35, 0.0, 2.25))
    ca, sa = math.cos(swing), math.sin(swing)

    def P(x, y, z):
        dx, dz = x - hinge.x, z - hinge.z
        return (hinge.x + dx * ca + dz * sa, y, hinge.z - dx * sa + dz * ca)

    for y in (0.34, 2.92):                                 # rails
        beam(d, P(-1.35, y, 2.25), P(1.30, y, 2.25), 0.13, 0.13, "iron",
             up=(0, 1, 0))
    for sx, x in ((-1, -1.29), (1, 1.24)):                 # stiles
        beam(d, P(x, 0.34, 2.25), P(x, 2.92, 2.25), 0.13, 0.13, "iron",
             up=(0, 0, 1))
    for i in range(7):                                     # bars
        x = -1.02 + i * 0.335
        beam(d, P(x, 0.34, 2.25), P(x, 2.92, 2.25), 0.075, 0.075, "iron",
             up=(0, 0, 1))
    beam(d, P(-1.29, 1.63, 2.25), P(1.24, 1.63, 2.25), 0.09, 0.09, "iron",
         up=(0, 1, 0))
    box(d, P(1.18, 1.63, 2.33), (0.30, 0.44, 0.09), "iron", grain=(0, 1, 0),
        rot=Matrix.Rotation(swing, 3, "Y"))                # hasp plate
    return d


@model("rig_cage_large.glb", "structure",
       "4.5 x 4.5 x 3.5 m. `door` swings about +Y at its own origin (the hinge)")
def rig_cage_large():
    p = Part("rig_cage_large")
    H, R = 3.5, 2.17          # top rail height, post centre offset

    for x in (-2.0, 0.0, 2.0):                     # timber skids
        beam(p, (x, 0.09, -2.25), (x, 0.09, 2.25), 0.24, 0.18, "wood_dark")
    for sx in (-1, 1):                             # corner posts
        for sz in (-1, 1):
            beam(p, (sx * R, 0.18, sz * R), (sx * R, H, sz * R), 0.16, 0.16,
                 "iron", up=(0, 0, 1))
    for y in (0.26, H - 0.08):                     # bottom and top rails
        for sz in (-1, 1):
            beam(p, (-R, y, sz * R), (R, y, sz * R), 0.14, 0.14, "iron",
                 up=(0, 1, 0))
        for sx in (-1, 1):
            beam(p, (sx * R, y, -R), (sx * R, y, R), 0.14, 0.14, "iron",
                 up=(0, 1, 0))

    bars = [-1.81 + i * 0.362 for i in range(11)]
    for t in bars:                                 # two sides and the back
        for sx in (-1, 1):
            beam(p, (sx * R, 0.26, t), (sx * R, H - 0.08, t), 0.09, 0.09,
                 "iron", up=(0, 0, 1))
        beam(p, (t, 0.26, -R), (t, H - 0.08, -R), 0.09, 0.09, "iron",
             up=(0, 0, 1))
        beam(p, (t, H - 0.02, -R), (t, H - 0.02, R), 0.09, 0.09, "iron",
             up=(0, 1, 0))                         # roof bars
    for y in (1.24, 2.38):                         # mid rails, three sides
        for sx in (-1, 1):
            beam(p, (sx * R, y, -R), (sx * R, y, R), 0.10, 0.10, "iron",
                 up=(0, 1, 0))
        beam(p, (-R, y, -R), (R, y, -R), 0.10, 0.10, "iron", up=(0, 1, 0))

    # Front: door jambs, header, and the strips either side of the opening.
    for sx in (-1, 1):
        beam(p, (sx * 1.42, 0.18, R), (sx * 1.42, H, R), 0.16, 0.16, "iron",
             up=(0, 0, 1))
        for i in range(2):
            x = sx * (1.60 + i * 0.28)
            beam(p, (x, 0.26, R), (x, H - 0.08, R), 0.09, 0.09, "iron",
                 up=(0, 0, 1))
    beam(p, (-1.42, 3.02, R), (1.42, 3.02, R), 0.14, 0.14, "iron", up=(0, 1, 0))
    for i in range(6):
        x = -1.15 + i * 0.46
        beam(p, (x, 3.02, R), (x, H - 0.08, R), 0.09, 0.09, "iron", up=(0, 0, 1))

    for y in (0.55, 1.63, 2.71):                   # hinge knuckles
        box(p, (-1.42, y, R + 0.10), (0.20, 0.26, 0.16), "iron", grain=(0, 1, 0))
    box(p, (1.46, 1.63, R + 0.09), (0.44, 0.62, 0.14), "iron", grain=(0, 1, 0))
    box(p, (1.46, 1.63, R + 0.20), (0.26, 0.30, 0.12), "iron", grain=(0, 1, 0))
    p.contact_shade(reach=0.6, strength=0.4)

    d = _cage_door("door")
    d.contact_shade(reach=0.6, strength=0.35)
    return [p, d]


@model("rig_cage_door_open.glb", "medium",
       "the same door, swung 105 deg. Place at the cage hinge: local (-1.35, 0, 2.25)",
       anchor="hinge")
def rig_cage_door_open():
    d = _cage_door("rig_cage_door_open", swing=math.radians(105))
    d.contact_shade(reach=0.6, strength=0.35)
    return d


@model("rig_cage_small.glb", "medium", "2 m cube, flat top at y=2.00, stacks on its own lugs")
def rig_cage_small():
    p = Part("rig_cage_small")
    R = 0.94
    for x in (-0.6, 0.6):
        beam(p, (x, 0.07, -1.0), (x, 0.07, 1.0), 0.20, 0.14, "wood_dark")
    for sx in (-1, 1):
        for sz in (-1, 1):
            beam(p, (sx * R, 0.14, sz * R), (sx * R, 1.94, sz * R), 0.12, 0.12,
                 "iron", up=(0, 0, 1))
    for y in (0.20, 1.88):
        for sz in (-1, 1):
            beam(p, (-R, y, sz * R), (R, y, sz * R), 0.11, 0.11, "iron",
                 up=(0, 1, 0))
        for sx in (-1, 1):
            beam(p, (sx * R, y, -R), (sx * R, y, R), 0.11, 0.11, "iron",
                 up=(0, 1, 0))
    for t in (-0.6, -0.3, 0.0, 0.3, 0.6):
        for sx in (-1, 1):
            beam(p, (sx * R, 0.20, t), (sx * R, 1.88, t), 0.07, 0.07, "iron",
                 up=(0, 0, 1))
            beam(p, (t, 0.20, sx * R), (t, 1.88, sx * R), 0.07, 0.07, "iron",
                 up=(0, 0, 1))
        beam(p, (t, 1.96, -R), (t, 1.96, R), 0.08, 0.08, "iron", up=(0, 1, 0))
    for sx in (-1, 1):                             # stacking lugs
        for sz in (-1, 1):
            box(p, (sx * R, 1.98, sz * R), (0.16, 0.08, 0.16), "iron")
    p.contact_shade(reach=0.4, strength=0.4)
    return p


# --------------------------------------------------------------------------
# Machinery
# --------------------------------------------------------------------------

@model("rig_crane.glb", "hero",
       "timber derrick. `boom` slews about +Y at the heel pin; `lift` is the "
       "topping chain, hide it if you luff the boom instead")
def rig_crane():
    p = Part("rig_crane")
    for ang in (0.0, math.pi / 2):                 # crossed base sills
        c, s = math.cos(ang), math.sin(ang)
        beam(p, (-4.0 * c, 0.15, -4.0 * s), (4.0 * c, 0.15, 4.0 * s),
             0.55, 0.30, "wood_dark")
    beam(p, (0, 0.30, 0), (0, 8.0, 0), 0.44, 0.44, "wood", up=(0, 0, 1))
    for sx in (-1, 1):                             # back struts and braces
        beam(p, (sx * 2.6, 0.30, -2.6), (sx * 0.16, 7.1, -0.18), 0.28, 0.28,
             "wood")
        beam(p, (sx * 1.55, 3.55, -1.55), (sx * 0.30, 3.55, -0.30), 0.16, 0.16,
             "wood_dark")
    for y in (0.62, 3.9, 7.7):                     # mast bands
        prism_y(p, [(-0.26, -0.26), (0.26, -0.26), (0.26, 0.26), (-0.26, 0.26)],
                y - 0.09, y + 0.09, "iron")
    for i in range(9):                             # climbing cleats
        beam(p, (-0.30, 1.0 + i * 0.72, 0.0), (0.30, 1.0 + i * 0.72, 0.0),
             0.07, 0.05, "iron")
    box(p, (0.0, 1.62, 0.30), (0.70, 0.34, 0.34), "iron", grain=(1, 0, 0))
    p.contact_shade(reach=0.7, strength=0.4)

    # Boom: heel pin at (0, 1.62, 0.30), raked up and forward.
    pivot = Vector((0.0, 1.62, 0.30))
    b = Part("boom", pivot)
    tip = pivot + Vector((0.0, math.sin(math.radians(34)),
                          math.cos(math.radians(34)))) * 9.0
    beam(b, tuple(pivot), tuple(tip), 0.34, 0.34, "wood")
    for t in (0.12, 0.5, 0.88):                    # iron straps
        c = pivot.lerp(tip, t)
        beam(b, tuple(c - Vector((0, 0.10, 0.15))),
             tuple(c + Vector((0, 0.10, 0.15))), 0.40, 0.40, "iron", caps=False)
    cyl(b, (-0.32, pivot.y, pivot.z), (0.32, pivot.y, pivot.z), 0.10, 0.10, 8,
        "iron")
    sheave = tip - Vector((0.0, 0.30, 0.20))
    cyl(b, (-0.09, sheave.y, sheave.z), (0.09, sheave.y, sheave.z), 0.34, 0.34,
        12, "iron", smooth=True)
    hook_top = Vector((0.0, sheave.y - 0.34, sheave.z))
    chain = [(0.0, hook_top.y, hook_top.z), (0.0, hook_top.y - 3.3, hook_top.z)]
    chain_run(b, chain, link=0.22, width=0.12)
    hb = (0.0, chain[-1][1] - 0.20, hook_top.z)
    cyl(b, chain[-1], hb, 0.07, 0.07, 6, "iron")
    for i in range(7):                             # the hook itself
        a0 = math.radians(20 + i * 34)
        a1 = math.radians(20 + (i + 1) * 34)
        c = Vector(hb) + Vector((0, -0.26, 0))
        q0 = c + Vector((0, math.cos(a0), math.sin(a0))) * 0.26
        q1 = c + Vector((0, math.cos(a1), math.sin(a1))) * 0.26
        cyl(b, tuple(q0), tuple(q1), 0.055, 0.045, 5, "iron")

    lift = Part("lift", pivot)
    mast_head = Vector((0.0, 7.75, 0.0))
    polyline_tube(lift, [tuple(mast_head), tuple(mast_head.lerp(tip, 0.5) +
                  Vector((0, -0.12, 0))), tuple(tip)], 0.05, "iron", seg=4)
    return [p, b, lift]


@model("rig_winch.glb", "medium", "`drum` spins about +X through its own origin")
def rig_winch():
    p = Part("rig_winch")
    box(p, (0.0, 0.10, 0.0), (1.30, 0.20, 0.80), "wood_dark", grain=(1, 0, 0))
    for sx in (-1, 1):
        prism_x(p, [(-0.30, 0.20), (0.30, 0.20), (0.30, 0.66), (0.0, 0.86),
                    (-0.30, 0.66)], sx * 0.44 - 0.04, sx * 0.44 + 0.04, "iron")
        box(p, (sx * 0.44, 0.62, 0.0), (0.14, 0.14, 0.14), "iron")
    beam(p, (-0.20, 0.72, -0.34), (0.20, 0.72, -0.34), 0.06, 0.06, "iron")
    box(p, (0.30, 0.74, -0.16), (0.10, 0.06, 0.30), "iron", grain=(0, 0, 1))
    for x, z in ((-0.62, 0.30), (0.62, -0.30)):     # bolt-down cleats
        box(p, (x, 0.06, z), (0.16, 0.12, 0.16), "iron")
    p.contact_shade(reach=0.35, strength=0.4)

    d = Part("drum", (0.0, 0.62, 0.0))
    cyl(d, (-0.36, 0.62, 0), (0.36, 0.62, 0), 0.20, 0.20, 12, "iron",
        smooth=True)
    for sx in (-1, 1):                              # flanges
        cyl(d, (sx * 0.36, 0.62, 0), (sx * 0.42, 0.62, 0), 0.29, 0.29, 12,
            "iron", smooth=True)
    wrap = [(x, 0.62 + math.sin(a) * 0.238, math.cos(a) * 0.238)
            for x, a in ((-0.30 + i * 0.019, TAU * i / 4.0) for i in range(33))]
    polyline_tube(d, wrap, 0.030, "rope", seg=5)
    star = []                                       # ratchet wheel
    for i in range(20):
        r = 0.30 if i % 2 else 0.24
        a = TAU * i / 20
        star.append((math.sin(a) * r, 0.62 + math.cos(a) * r))
    prism_x(d, star, 0.44, 0.52, "iron")
    beam(d, (0.52, 0.62, 0.0), (0.62, 0.62, 0.0), 0.08, 0.08, "iron")
    beam(d, (0.62, 0.62, 0.0), (0.62, 0.62, 0.34), 0.07, 0.07, "iron")
    cyl(d, (0.62, 0.62, 0.34), (0.78, 0.62, 0.34), 0.05, 0.05, 6, "wood")
    return [p, d]


# --------------------------------------------------------------------------
# Light and dressing
# --------------------------------------------------------------------------

@model("rig_brazier.glb", "small",
       "the one the player snuffs. Coals are the only `ember` faces, 32 tris of them")
def rig_brazier():
    p = Part("rig_brazier")
    for i in range(3):                               # tripod feet
        a = TAU * i / 3
        beam(p, (0, 0.04, 0), (math.cos(a) * 0.34, 0.05, math.sin(a) * 0.34),
             0.10, 0.08, "iron")
    cyl(p, (0, 0.02, 0), (0, 1.05, 0), 0.09, 0.075, 6, "iron")
    revolve(p, [(0.30, 1.05), (0.36, 1.16), (0.44, 1.42)], seg=8, slot="iron",
            cap_end=False)
    cyl(p, (0, 1.40, 0), (0, 1.46, 0), 0.46, 0.46, 8, "iron", caps=False)
    coals = revolve(p, [(0.30, 1.28), (0.24, 1.36), (0.0, 1.41)], seg=8,
                    slot="ember", smooth=True)
    p.shade(coals, 1.0)
    p.contact_shade(reach=0.3, strength=0.45)
    p.shade(coals, 1.0)                              # keep the coals unshaded
    return p


@model("rig_lantern.glb", "small", "origin is the hook; the body hangs 0.52 m below it",
       anchor="hang")
def rig_lantern():
    p = Part("rig_lantern")
    for i in range(6):                               # hook
        a0, a1 = math.radians(200 + i * 30), math.radians(200 + (i + 1) * 30)
        c = Vector((0, -0.07, 0))
        cyl(p, tuple(c + Vector((0, math.sin(a0), math.cos(a0))) * 0.07),
            tuple(c + Vector((0, math.sin(a1), math.cos(a1))) * 0.07),
            0.016, 0.016, 4, "iron")
    torus(p, (0, -0.16, 0), 0.05, 0.016, "iron", majseg=6, minseg=4,
          axis=(0, 0, 1))
    for sx in (-1, 1):
        cyl(p, (0, -0.17, 0), (sx * 0.09, -0.26, 0), 0.014, 0.014, 4, "iron")
    revolve(p, [(0.13, -0.26), (0.10, -0.30)], seg=6, slot="iron",
            cap_start=False)                                  # cap
    for i in range(4):                               # corner bars and glazing
        a = math.pi / 4 + TAU * i / 4
        x, z = math.cos(a) * 0.085, math.sin(a) * 0.085
        beam(p, (x, -0.30, z), (x, -0.50, z), 0.022, 0.022, "iron",
             up=(0, 0, 1))
    revolve(p, [(0.11, -0.55), (0.12, -0.51), (0.10, -0.50)], seg=6,
            slot="iron")                             # base pan
    sphere(p, (0, -0.41, 0), 0.045, "ember", rings=3, seg=6, squash=1.7)
    return p


@model("rig_crate.glb", "small", "1.0 m, stacks flat")
def rig_crate():
    p = Part("rig_crate")
    box(p, (0, 0.49, 0), (0.96, 0.94, 0.96), "wood", grain=(0, 1, 0))
    for sx in (-1, 1):
        for sz in (-1, 1):
            beam(p, (sx * 0.485, 0.02, sz * 0.485), (sx * 0.485, 0.96, sz * 0.485),
                 0.10, 0.10, "wood_dark", up=(0, 0, 1))
    for y in (0.18, 0.80):
        for sz in (-1, 1):
            beam(p, (-0.50, y, sz * 0.49), (0.50, y, sz * 0.49), 0.05, 0.09,
                 "iron", up=(0, 1, 0))
    p.contact_shade(reach=0.25, strength=0.4)
    return p


@model("rig_barrel.glb", "small", "0.9 m tall, stands upright")
def rig_barrel():
    p = Part("rig_barrel")
    revolve(p, [(0.28, 0.0), (0.34, 0.22), (0.35, 0.45), (0.34, 0.68),
                (0.28, 0.90)], seg=10, slot="wood")
    for y in (0.16, 0.45, 0.74):
        r = 0.345 if abs(y - 0.45) < 0.1 else 0.325
        cyl(p, (0, y - 0.045, 0), (0, y + 0.045, 0), r + 0.012, r + 0.012, 10,
            "iron", caps=False)
    p.contact_shade(reach=0.25, strength=0.4)
    return p


@model("rig_net_pile.glb", "medium", "coiled net with cork floats")
def rig_net_pile():
    p = Part("rig_net_pile")
    for i, (r, y, minor) in enumerate(((0.95, 0.16, 0.16), (0.70, 0.30, 0.15),
                                       (0.44, 0.42, 0.13))):
        torus(p, (0.05 * i, y, -0.04 * i), r, minor, "rope", majseg=12,
              minseg=5, smooth=True)
    for a, r, y in ((0.4, 1.02, 0.28), (2.1, 0.86, 0.36), (3.4, 1.05, 0.22),
                    (4.6, 0.62, 0.52), (5.7, 0.92, 0.34)):
        sphere(p, (math.cos(a) * r, y, math.sin(a) * r), 0.11, "wood",
               rings=3, seg=6, squash=1.3)
    p.contact_shade(reach=0.35, strength=0.45)
    return p


@model("rig_chain_coil.glb", "small", "flaked-down chain, 1.1 m across, 0.25 m tall")
def rig_chain_coil():
    p = Part("rig_chain_coil")
    path = []
    for i in range(33):
        t = i / 32
        a = TAU * 2.3 * t
        r = 0.52 - 0.30 * t
        path.append((math.cos(a) * r, 0.05 + 0.13 * t, math.sin(a) * r))
    chain_run(p, path, link=0.15, width=0.085)
    tail = [path[-1], (0.10, 0.20, -0.12), (0.34, 0.14, -0.46),
            (0.62, 0.05, -0.58)]
    chain_run(p, tail, link=0.15, width=0.085)
    p.recenter(drop=False)
    p.contact_shade(reach=0.2, strength=0.5)
    return p


@model("rig_mooring_post.glb", "small", "bollard with a rope turn on it")
def rig_mooring_post():
    p = Part("rig_mooring_post")
    revolve(p, [(0.26, 0.0), (0.22, 0.08), (0.20, 0.78), (0.26, 0.86),
                (0.22, 0.95)], seg=8, slot="wood_dark")
    cyl(p, (0, 0.94, 0), (0, 1.00, 0), 0.20, 0.20, 8, "iron", caps=True)
    # Sample the helix finely: below ~14 points a turn the tube's rings skew
    # and the rope renders as a stack of washers.
    polyline_tube(p, helix((0, 0, 0), 0.228, 0.30, 0.60, 2.0, 30), 0.032,
                  "rope", seg=4)
    p.contact_shade(reach=0.25, strength=0.4)
    return p
