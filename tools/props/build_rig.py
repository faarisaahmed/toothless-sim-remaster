"""
P0 -- The Rig.

An industrial dragon-capture platform on pilings. The brief is emphatic that
this is a factory and not a pirate camp, so everything here is square, repeated
on a grid, banded with iron and free of picturesque rot. The only weathering is
below the waterline mark on the pilings, where it is a fact rather than a mood.

The detail pass reads that brief as an instruction about *what kind* of detail,
not how much. A factory is not smoother than a village -- it is more repetitive.
So nothing here is hand-hewn or crooked, and instead everything is bolted: the
cages have hinge knuckles with pins through them, the barrel has fifteen staves
inside three riveted hoops, the crate is boarded and strapped, and there are a
few hundred fastener heads across the set. That is what makes a machine read as
a machine rather than as one moulded object painted grey.

One prop breaks the pattern deliberately. `rig_deck_4m` is stamped out about
six hundred times into a single merged floor, so a triangle spent on it is six
hundred triangles and it is the one model in the set with no chamfered arrises:
it gets its detail from real board widths and the gaps between them, which is
all you can see of a deck from standing height anyway.
"""
from propkit import *  # noqa


# --------------------------------------------------------------------------
# Shared ironmongery
# --------------------------------------------------------------------------

def _strap(p, c, size, slot="iron", grain=None, bolts=(), bolt_dir=(0, 0, 1),
           r=0.014, rot=None):
    """An iron strap or plate with its bolts through it."""
    box(p, c, size, slot, grain=grain, rot=rot)
    for off in bolts:
        bolt(p, tuple(Vector(c) + Vector(off)), bolt_dir, r=r,
             stand=r * 0.85)


def _hinge_knuckle(p, c, axis=(0, 1, 0), r=0.075, length=0.26, slot="iron"):
    """
    A barrel hinge: two eyes and the pin through them, proud of the frame.

    The cages used to hinge on a plain box, which is a hinge nobody can see is
    a hinge. This is the one piece of the rig the story turns on -- the player
    opens these -- so it gets the pin.
    """
    a = Vector(axis).normalized()
    c = Vector(c)
    for s in (-1, 1):
        cyl(p, tuple(c + a * (s * length * 0.5)),
            tuple(c + a * (s * length * 0.18)), r, r, 9, slot, smooth=True)
    cyl(p, tuple(c - a * (length * 0.62)), tuple(c + a * (length * 0.62)),
        r * 0.42, r * 0.42, 8, slot, smooth=True)
    for s in (-1, 1):                                 # pin heads
        cyl(p, tuple(c + a * (s * length * 0.62)),
            tuple(c + a * (s * length * 0.70)), r * 0.58, r * 0.50, 8, slot,
            smooth=True)


# --------------------------------------------------------------------------
# Decking and access
# --------------------------------------------------------------------------

@model("rig_deck_4m.glb", "tiled",
       "4x4 m module, snaps on the 2 m grid; top face at y=0.30. Sixteen "
       "boards; no chamfers, because this one ships 600 times",
       finish={"bevel": False})
def rig_deck_4m():
    p = Part("rig_deck_4m")
    for z in (-1.6, -0.8, 0.0, 0.8, 1.6):            # bearers across X
        beam(p, (-2.0, 0.11, z), (2.0, 0.11, z), 0.10, 0.22, "wood_dark")
    for x in (-1.94, 1.94):                          # rim beams down Z
        beam(p, (x, 0.11, -2.0), (x, 0.11, 2.0), 0.12, 0.22, "wood_dark")
    # Real 250 mm boards with 14 mm gaps you can see the sea through, laid to
    # a staggered butt pattern, each one a couple of millimetres out of plane.
    plank_deck(p, -1.94, 1.94, -2.0, 2.0, 0.26, width=0.245, thickness=0.075,
               gap=0.014, slot="wood", seed=8, nails_at=(-1.6, 1.6),
               butt_at=(0.4, -0.8, 1.2, -0.4, 0.8, -1.2))
    p.contact_shade(reach=0.25, strength=0.35)
    return p


@model("rig_deck_ramp.glb", "structure",
       "4 m run to a deck top at y=2.00; iron kick plate at the toe")
def rig_deck_ramp():
    p = Part("rig_deck_ramp")
    # Boards laid along the slope, their sections square to it so the walking
    # surface is a plane and not a flight of steps. Ends pulled in by 20 mm:
    # a square section's corners would push the module past 4.000 m.
    n = 16
    for i in range(n):
        x = -1.94 + (3.88) * (i + 0.5) / n
        beam(p, (x, 0.042, -1.98), (x, 1.960, 1.98), (3.88 / n) * 0.93, 0.09,
             "wood")
    for x in (-1.86, 0.0, 1.86):                     # stringers
        prism_x(p, [(-2.0, 0.0), (2.0, 1.92), (2.0, 1.28)],
                x - 0.07, x + 0.07, "wood_dark")
    a = Vector((0.0, 1.92, 4.0)).normalized()
    for i in range(7):                               # grip cleats, bolted down
        t = 0.10 + i * 0.13
        c = Vector((0.0, 0.08, -2.0)) + a * (t * 4.47)
        beam(p, (-1.95, c.y, c.z), (1.95, c.y, c.z), 0.07, 0.05, "wood_dark",
             up=(0, 0.894, -0.447))
        for sx in (-1, 1):
            nail(p, (sx * 1.60, c.y + 0.035, c.z + 0.016), (0, 0.894, -0.447),
                 r=0.013)
    _strap(p, (0.0, 0.045, -1.89), (3.9, 0.09, 0.22), grain=(1, 0, 0),
           bolts=[(x, 0.048, -0.06) for x in (-1.6, -0.55, 0.55, 1.6)],
           bolt_dir=(0, 1, 0), r=0.016)
    p.contact_shade(reach=0.5, strength=0.3)
    return p


@model("rig_walkway_4m.glb", "structure",
       "1.5 m wide, rope handrail both sides; deck top at y=0.30")
def rig_walkway_4m():
    p = Part("rig_walkway_4m")
    for z in (-1.95, -1.0, 0.0, 1.0, 1.95):
        beam(p, (-0.75, 0.11, z), (0.75, 0.11, z), 0.10, 0.22, "wood_dark")
    plank_deck(p, -0.72, 0.72, -2.0, 2.0, 0.26, width=0.235, thickness=0.075,
               gap=0.014, slot="wood", seed=3, nails_at=(-1.95, 0.0, 1.95))
    for sx in (-1, 1):
        for z in (-1.95, 0.0, 1.95):                 # stanchions
            beam(p, (sx * 0.68, 0.30, z), (sx * 0.68, 1.30, z), 0.10, 0.10,
                 "wood_dark", up=(0, 0, 1))
            _strap(p, (sx * 0.68, 0.40, z), (0.15, 0.09, 0.15),
                   bolts=[(sx * 0.09, 0, 0)], bolt_dir=(sx, 0, 0), r=0.013)
        for y in (0.78, 1.22):                       # laid-rope handrails
            for z0, z1 in ((-1.95, 0.0), (0.0, 1.95)):
                rope_span(p, (sx * 0.68, y, z0), (sx * 0.68, y, z1), 0.026,
                          sag=0.05, steps=4)
    p.contact_shade(reach=0.3, strength=0.35)
    return p


@model("rig_piling.glb", "scatter",
       "12 m pile; iron bands, waterline mark and growth up to y=6.00")
def rig_piling():
    p = Part("rig_piling")
    cyl(p, (0, 0, 0), (0, 6.0, 0), 0.40, 0.36, 12, "wood_dark", caps=False,
        smooth=True)
    cyl(p, (0, 6.0, 0), (0, 12.0, 0), 0.35, 0.29, 12, "wood", caps=True,
        smooth=True)
    # Growth below the tide line: not decoration, it is how you read the sea
    # state off a piling. Clustered, thinning upwards, gone by the mark.
    r = random.Random(4)
    for i in range(26):
        t = (i / 26.0) ** 1.7
        y = 0.25 + t * 5.5
        a = r.uniform(0, TAU)
        rad = 0.40 - 0.04 * (y / 6.0)
        boulder(p, (math.cos(a) * rad, y, math.sin(a) * rad),
                None, "wood_dark", seed=100 + i, seg=5, rings=3, amp=0.34,
                cap=1.0, radii=(0.085 * (1.4 - t), 0.05 * (1.4 - t),
                                0.085 * (1.4 - t)))
    for y, rr in ((6.02, 0.375), (9.0, 0.345), (11.55, 0.315)):
        cyl(p, (0, y - 0.09, 0), (0, y + 0.09, 0), rr + 0.014, rr + 0.014, 12,
            "iron", caps=False, smooth=True)
        for k in range(4):                           # band bolts
            a = TAU * k / 4 + 0.4
            d = Vector((math.cos(a), 0, math.sin(a)))
            bolt(p, tuple(d * (rr + 0.015) + Vector((0, y, 0))), tuple(d),
                 r=0.017, stand=0.014)
    return p


@model("rig_ladder_3m.glb", "small", "stackable end to end; stiles 3.00 m")
def rig_ladder_3m():
    p = Part("rig_ladder_3m")
    for sx in (-1, 1):
        beam(p, (sx * 0.28, 0.0, 0.0), (sx * 0.28, 3.0, 0.0), 0.09, 0.05,
             "wood", up=(0, 0, 1))
    for i in range(9):
        y = 0.16 + i * 0.335
        cyl(p, (-0.30, y, 0), (0.30, y, 0), 0.035, 0.035, 8, "wood_dark",
            smooth=True)
        for sx in (-1, 1):                           # nailed through the stile
            nail(p, (sx * 0.28, y, 0.026), (0, 0, 1), r=0.011)
    return p


# --------------------------------------------------------------------------
# Cages -- the reason the rig exists
# --------------------------------------------------------------------------

def _cage_door(name, swing=0.0):
    """
    The large cage's door. Origin is the hinge line at x=-1.35, z=+2.25, so the
    node rotates about +Y in place. `swing` bakes an angle in for the
    standalone open version.
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
        for y in (0.40, 1.63, 2.86):                       # riveted to a rail
            bolt(d, P(x, y, 2.32), tuple(Vector(P(0, 0, 1)) -
                                         Vector(P(0, 0, 0))), r=0.013,
                 stand=0.010)
    beam(d, P(-1.29, 1.63, 2.25), P(1.24, 1.63, 2.25), 0.09, 0.09, "iron",
         up=(0, 1, 0))
    rot = Matrix.Rotation(swing, 3, "Y")
    box(d, P(1.18, 1.63, 2.33), (0.30, 0.44, 0.09), "iron", grain=(0, 1, 0),
        rot=rot)                                           # hasp plate
    box(d, P(1.30, 1.63, 2.36), (0.12, 0.20, 0.05), "iron", grain=(0, 1, 0),
        rot=rot)                                           # the staple
    for y in (0.55, 1.63, 2.71):                           # hinge leaves
        _strap(d, P(-1.16, y, 2.30), (0.44, 0.20, 0.05), grain=(1, 0, 0),
               bolts=[(x, 0, 0.03) for x in (-0.14, 0.14)],
               bolt_dir=tuple(Vector(P(0, 0, 1)) - Vector(P(0, 0, 0))),
               r=0.013, rot=rot)
    return d


@model("rig_cage_large.glb", "structure",
       "4.5 x 4.5 x 3.5 m. `door` swings about +Y at its own origin (the hinge)")
def rig_cage_large():
    p = Part("rig_cage_large")
    H, R = 3.5, 2.17          # top rail height, post centre offset

    for x in (-2.0, 0.0, 2.0):                     # timber skids
        beam(p, (x, 0.09, -2.25), (x, 0.09, 2.25), 0.24, 0.18, "wood_dark")
        for z in (-1.9, -0.6, 0.6, 1.9):           # skid bolted to the frame
            bolt(p, (x, 0.19, z), (0, 1, 0), r=0.019, stand=0.016)
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
    # Every bar riveted where it crosses a rail. Three hundred rivet heads on
    # a cage is not gratuitous: repetition is the read on a factory object, and
    # a bar that passes through a rail without a fixing is a bar that is drawn
    # rather than built.
    for t in bars[::2]:
        for y in (0.32, 1.24, 2.38, H - 0.14):
            for sx in (-1, 1):
                bolt(p, (sx * (R + 0.05), y, t), (sx, 0, 0), r=0.013,
                     stand=0.010)
            bolt(p, (t, y, -(R + 0.05)), (0, 0, -1), r=0.013, stand=0.010)

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

    for y in (0.55, 1.63, 2.71):                   # hinge knuckles with pins
        _hinge_knuckle(p, (-1.42, y, R + 0.13), (0, 1, 0), r=0.072,
                       length=0.24)
    # The lock: a hasp box, a staple through it, and a padlock hanging off.
    _strap(p, (1.46, 1.63, R + 0.09), (0.44, 0.62, 0.14), grain=(0, 1, 0),
           bolts=[(0, y, 0.08) for y in (-0.22, 0.22)], r=0.016)
    box(p, (1.46, 1.63, R + 0.21), (0.26, 0.30, 0.12), "iron", grain=(0, 1, 0))
    torus(p, (1.46, 1.44, R + 0.24), 0.055, 0.020, "iron", majseg=10, minseg=4,
          axis=(1, 0, 0))
    box(p, (1.46, 1.33, R + 0.24), (0.10, 0.15, 0.09), "iron", grain=(0, 1, 0))
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
        for y in (0.26, 1.82):
            for sx in (-1, 1):
                bolt(p, (sx * (R + 0.04), y, t), (sx, 0, 0), r=0.011,
                     stand=0.009)
                bolt(p, (t, y, sx * (R + 0.04)), (0, 0, sx), r=0.011,
                     stand=0.009)
    for sx in (-1, 1):                             # stacking lugs
        for sz in (-1, 1):
            box(p, (sx * R, 1.98, sz * R), (0.16, 0.08, 0.16), "iron")
            bolt(p, (sx * R, 2.02, sz * R), (0, 1, 0), r=0.013, stand=0.010)
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
        for t in (-3.4, -1.9, 1.9, 3.4):           # bolted down to the deck
            bolt(p, (t * c, 0.30, t * s), (0, 1, 0), r=0.024, stand=0.020)
    beam(p, (0, 0.30, 0), (0, 8.0, 0), 0.44, 0.44, "wood", up=(0, 0, 1))
    for sx in (-1, 1):                             # back struts and braces
        beam(p, (sx * 2.6, 0.30, -2.6), (sx * 0.16, 7.1, -0.18), 0.28, 0.28,
             "wood")
        beam(p, (sx * 1.55, 3.55, -1.55), (sx * 0.30, 3.55, -0.30), 0.16, 0.16,
             "wood_dark")
    for y in (0.62, 3.9, 7.7):                     # mast bands, bolted
        prism_y(p, [(-0.26, -0.26), (0.26, -0.26), (0.26, 0.26), (-0.26, 0.26)],
                y - 0.09, y + 0.09, "iron")
        for sx, sz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            bolt(p, (sx * 0.235, y, sz * 0.235), (sx, 0, sz), r=0.018,
                 stand=0.015)
    for i in range(9):                             # climbing cleats
        beam(p, (-0.30, 1.0 + i * 0.72, 0.0), (0.30, 1.0 + i * 0.72, 0.0),
             0.07, 0.05, "iron")
    _strap(p, (0.0, 1.62, 0.30), (0.70, 0.34, 0.34), grain=(1, 0, 0),
           bolts=[(x, 0.16, 0.10) for x in (-0.26, 0.26)], bolt_dir=(0, 1, 0),
           r=0.018)
    p.contact_shade(reach=0.7, strength=0.4)

    # Boom: heel pin at (0, 1.62, 0.30), raked up and forward.
    pivot = Vector((0.0, 1.62, 0.30))
    b = Part("boom", pivot)
    tip = pivot + Vector((0.0, math.sin(math.radians(34)),
                          math.cos(math.radians(34)))) * 9.0
    beam(b, tuple(pivot), tuple(tip), 0.34, 0.34, "wood")
    for t in (0.12, 0.5, 0.88):                    # iron straps round the boom
        c = pivot.lerp(tip, t)
        beam(b, tuple(c - Vector((0, 0.10, 0.15))),
             tuple(c + Vector((0, 0.10, 0.15))), 0.40, 0.40, "iron", caps=False)
        for sx in (-1, 1):
            bolt(b, tuple(c + Vector((sx * 0.19, 0, 0))), (sx, 0, 0), r=0.017,
                 stand=0.014)
    cyl(b, (-0.32, pivot.y, pivot.z), (0.32, pivot.y, pivot.z), 0.10, 0.10, 10,
        "iron", smooth=True)
    # The sheave at the head: a grooved wheel in a shackle, not a disc.
    sheave = tip - Vector((0.0, 0.30, 0.20))
    for sx in (-1, 1):
        cyl(b, (sx * 0.05, sheave.y, sheave.z), (sx * 0.11, sheave.y, sheave.z),
            0.34, 0.30, 14, "iron", smooth=True)
        cyl(b, (sx * 0.11, sheave.y, sheave.z), (sx * 0.15, sheave.y, sheave.z),
            0.10, 0.10, 8, "iron", smooth=True)
        _strap(b, (sx * 0.18, sheave.y + 0.16, sheave.z),
               (0.06, 0.62, 0.20), grain=(0, 1, 0))
    cyl(b, (-0.05, sheave.y, sheave.z), (0.05, sheave.y, sheave.z), 0.28,
        0.28, 14, "iron", smooth=True)
    # Hoisting chain: real interlocking links. This hangs at head height on
    # the deck and it is the one bit of ironmongery the player gets close to.
    hook_top = Vector((0.0, sheave.y - 0.34, sheave.z))
    chain_links(b, [tuple(hook_top), (0.0, hook_top.y - 3.3, hook_top.z)],
                link=0.24, wire=0.030)
    hb = Vector((0.0, hook_top.y - 3.34, hook_top.z))
    cyl(b, tuple(hb), tuple(hb - Vector((0, 0.20, 0))), 0.07, 0.07, 8, "iron",
        smooth=True)
    torus(b, tuple(hb - Vector((0, 0.05, 0))), 0.10, 0.030, "iron", majseg=10,
          minseg=4, axis=(0, 1, 0))                # the shank collar
    hook = []
    for i in range(11):                            # the hook itself
        a = math.radians(14 + i * 24)
        c = hb - Vector((0, 0.46, 0))
        hook.append(tuple(c + Vector((0, math.cos(a), math.sin(a))) * 0.26))
    for i in range(len(hook) - 1):
        cyl(b, hook[i], hook[i + 1], 0.058 - i * 0.003, 0.055 - i * 0.003, 7,
            "iron", smooth=True)

    lift = Part("lift", pivot)
    mast_head = Vector((0.0, 7.75, 0.0))
    chain_links(lift, [tuple(mast_head),
                       tuple(mast_head.lerp(tip, 0.5) + Vector((0, -0.14, 0))),
                       tuple(tip)], link=0.20, wire=0.024)
    return [p, b, lift]


@model("rig_winch.glb", "medium", "`drum` spins about +X through its own origin")
def rig_winch():
    p = Part("rig_winch")
    box(p, (0.0, 0.10, 0.0), (1.30, 0.20, 0.80), "wood_dark", grain=(1, 0, 0))
    for sx in (-1, 1):
        prism_x(p, [(-0.30, 0.20), (0.30, 0.20), (0.30, 0.66), (0.0, 0.86),
                    (-0.30, 0.66)], sx * 0.44 - 0.04, sx * 0.44 + 0.04, "iron")
        box(p, (sx * 0.44, 0.62, 0.0), (0.14, 0.14, 0.14), "iron")
        for z in (-0.24, 0.24):                     # frame bolted to the bed
            bolt(p, (sx * 0.44, 0.21, z), (0, 1, 0), r=0.016, stand=0.013)
    beam(p, (-0.20, 0.72, -0.34), (0.20, 0.72, -0.34), 0.06, 0.06, "iron")
    box(p, (0.30, 0.74, -0.16), (0.10, 0.06, 0.30), "iron", grain=(0, 0, 1))
    for x, z in ((-0.62, 0.30), (0.62, -0.30)):     # bolt-down cleats
        box(p, (x, 0.06, z), (0.16, 0.12, 0.16), "iron")
        bolt(p, (x, 0.12, z), (0, 1, 0), r=0.019, stand=0.016)
    p.contact_shade(reach=0.35, strength=0.4)

    d = Part("drum", (0.0, 0.62, 0.0))
    cyl(d, (-0.36, 0.62, 0), (0.36, 0.62, 0), 0.20, 0.20, 16, "iron",
        smooth=True)
    for sx in (-1, 1):                              # flanges
        cyl(d, (sx * 0.36, 0.62, 0), (sx * 0.42, 0.62, 0), 0.29, 0.29, 16,
            "iron", smooth=True)
    # The warp: laid rope, wound on in a single layer, riding up the drum.
    # Fifteen metres of warp wound on in a single layer. Laid strands are
    # right for a rope you can see the lay on and wrong here: at nine turns a
    # metre over fifteen metres it cost twelve thousand triangles for a spiral
    # nobody can resolve under a hand's width of coil.
    wrap = [(x, 0.62 + math.sin(a) * 0.234, math.cos(a) * 0.234)
            for x, a in ((-0.30 + i * 0.0075, TAU * i / 10.0)
                         for i in range(81))]
    polyline_tube(d, wrap, 0.028, "rope", seg=5, smooth=True)
    star = []                                       # ratchet wheel
    for i in range(24):
        r = 0.30 if i % 2 else 0.24
        a = TAU * i / 24
        star.append((math.sin(a) * r, 0.62 + math.cos(a) * r))
    prism_x(d, star, 0.44, 0.52, "iron")
    beam(d, (0.52, 0.62, 0.0), (0.62, 0.62, 0.0), 0.08, 0.08, "iron")
    beam(d, (0.62, 0.62, 0.0), (0.62, 0.62, 0.34), 0.07, 0.07, "iron")
    cyl(d, (0.62, 0.62, 0.34), (0.78, 0.62, 0.34), 0.05, 0.05, 8, "wood",
        smooth=True)
    return [p, d]


# --------------------------------------------------------------------------
# Light and dressing
# --------------------------------------------------------------------------

@model("rig_brazier.glb", "small",
       "the one the player snuffs. Coals are the only `ember` faces")
def rig_brazier():
    p = Part("rig_brazier")
    for i in range(3):                               # tripod feet
        a = TAU * i / 3
        beam(p, (0, 0.04, 0), (math.cos(a) * 0.34, 0.05, math.sin(a) * 0.34),
             0.10, 0.08, "iron")
        bolt(p, (math.cos(a) * 0.30, 0.10, math.sin(a) * 0.30), (0, 1, 0),
             r=0.016, stand=0.013)
    cyl(p, (0, 0.02, 0), (0, 1.05, 0), 0.09, 0.075, 10, "iron", smooth=True)
    revolve(p, [(0.30, 1.05), (0.36, 1.16), (0.44, 1.42)], seg=14, slot="iron",
            cap_end=False, smooth=True)
    cyl(p, (0, 1.40, 0), (0, 1.46, 0), 0.46, 0.46, 14, "iron", caps=False,
        smooth=True)
    # A fire basket, not a bowl: vertical straps round the pan with the gaps
    # between them, which is where the light actually gets out sideways.
    n = 12
    for k in range(n):
        a = TAU * k / n
        d = Vector((math.cos(a), 0, math.sin(a)))
        beam(p, tuple(d * 0.305 + Vector((0, 1.06, 0))),
             tuple(d * 0.452 + Vector((0, 1.43, 0))), 0.055, 0.030, "iron",
             up=(0, 1, 0))
    for y, rr in ((1.14, 0.345), (1.38, 0.442)):     # hoops round the basket
        torus(p, (0, y, 0), rr, 0.022, "iron", majseg=16, minseg=4)
    p.contact_shade(reach=0.3, strength=0.45)

    # The coals ship as their own node, named `coals`.
    #
    # `js/places.js` has always reached for `b.getObjectByName("coals")` so it
    # can drop the emissive when the player snuffs a brazier, and there has
    # never been a node by that name -- the coals were faces inside the body
    # mesh, so the lookup came back undefined and the guard swallowed it. A
    # snuffed brazier stopped lighting the deck and went on glowing. Splitting
    # them out is a model-side fix for that; the game code already handles it.
    c = Part("coals")
    coals = revolve(c, [(0.30, 1.26), (0.26, 1.34), (0.16, 1.40), (0.0, 1.42)],
                    seg=14, slot="ember", smooth=True)
    # Lumps, not a dome: this is the one glowing surface in the level and a
    # smooth cone of it reads as a lamp rather than as a fire.
    r = random.Random(6)
    for i in range(11):
        a = TAU * i / 11 + 0.4
        d = 0.05 + r.uniform(0.0, 0.20)
        boulder(c, (math.cos(a) * d, 1.30 + r.uniform(0.0, 0.07),
                    math.sin(a) * d), None, "ember", seed=200 + i, seg=6,
                rings=4, amp=0.34, cap=1.0,
                radii=(r.uniform(0.04, 0.08), r.uniform(0.02, 0.05),
                       r.uniform(0.04, 0.08)))
    c.shade(c.bm.faces, 1.0)                         # coals are not occluded
    return [p, c]


@model("rig_lantern.glb", "small", "origin is the hook; the body hangs 0.52 m below it",
       anchor="hang", finish={"ground": False})
def rig_lantern():
    p = Part("rig_lantern")
    for i in range(6):                               # hook
        a0, a1 = math.radians(200 + i * 30), math.radians(200 + (i + 1) * 30)
        c = Vector((0, -0.07, 0))
        cyl(p, tuple(c + Vector((0, math.sin(a0), math.cos(a0))) * 0.07),
            tuple(c + Vector((0, math.sin(a1), math.cos(a1))) * 0.07),
            0.016, 0.016, 6, "iron", smooth=True)
    torus(p, (0, -0.16, 0), 0.05, 0.016, "iron", majseg=9, minseg=4,
          axis=(0, 0, 1))
    for sx in (-1, 1):
        cyl(p, (0, -0.17, 0), (sx * 0.09, -0.26, 0), 0.014, 0.014, 6, "iron",
            smooth=True)
    revolve(p, [(0.13, -0.26), (0.10, -0.30)], seg=8, slot="iron",
            cap_start=False, smooth=True)                     # cap
    for i in range(4):                               # corner bars and glazing
        a = math.pi / 4 + TAU * i / 4
        x, z = math.cos(a) * 0.085, math.sin(a) * 0.085
        beam(p, (x, -0.30, z), (x, -0.50, z), 0.022, 0.022, "iron",
             up=(0, 0, 1))
        rivet = Vector((x, -0.31, z)).normalized() * 0.085
        bolt(p, (rivet.x, -0.315, rivet.z), tuple(rivet), r=0.008, stand=0.006)
    for i in range(4):                               # glazing bars, mid-height
        a = math.pi / 4 + TAU * i / 4
        b0 = Vector((math.cos(a) * 0.085, -0.40, math.sin(a) * 0.085))
        a2 = math.pi / 4 + TAU * (i + 1) / 4
        b1 = Vector((math.cos(a2) * 0.085, -0.40, math.sin(a2) * 0.085))
        cyl(p, tuple(b0), tuple(b1), 0.008, 0.008, 5, "iron", smooth=True)
    revolve(p, [(0.11, -0.55), (0.12, -0.51), (0.10, -0.50)], seg=8,
            slot="iron", smooth=True)                # base pan
    sphere(p, (0, -0.41, 0), 0.045, "ember", rings=4, seg=8, squash=1.7)
    return p


@model("rig_crate.glb", "scatter", "1.0 m, boarded and strapped, stacks flat")
def rig_crate():
    p = Part("rig_crate")
    # Boarded, not a box. Five boards a face with the gaps showing, the two
    # long faces overlapping the short ones at the corners the way a real
    # packing case is made.
    n = 5
    for sz in (-1, 1):
        for i in range(n):
            y = 0.055 + 0.88 * (i + 0.5) / n
            box(p, (0.0, y, sz * 0.475), (0.94, (0.88 / n) * 0.90, 0.038),
                "wood", grain=(1, 0, 0))
    for sx in (-1, 1):
        for i in range(n):
            y = 0.055 + 0.88 * (i + 0.5) / n
            box(p, (sx * 0.475, y, 0.0), (0.038, (0.88 / n) * 0.90, 0.94),
                "wood", grain=(0, 0, 1))
    for i in range(4):                               # lid boards
        box(p, (0.0, 0.955, -0.36 + i * 0.24), (0.96, 0.038, 0.215), "wood",
            grain=(0, 0, 1))
    for sx in (-1, 1):                               # corner posts
        for sz in (-1, 1):
            beam(p, (sx * 0.455, 0.02, sz * 0.455),
                 (sx * 0.455, 0.94, sz * 0.455), 0.10, 0.10, "wood_dark",
                 up=(0, 0, 1))
    for y in (0.18, 0.80):                           # iron strapping, nailed
        for sz in (-1, 1):
            box(p, (0.0, y, sz * 0.50), (1.00, 0.075, 0.014), "iron",
                grain=(1, 0, 0))
            nail_row(p, (-0.40, y, sz * 0.508), (0.40, y, sz * 0.508), 4,
                     (0, 0, sz), r=0.012)
        for sx in (-1, 1):
            box(p, (sx * 0.50, y, 0.0), (0.014, 0.075, 1.00), "iron",
                grain=(0, 0, 1))
            nail_row(p, (sx * 0.508, y, -0.40), (sx * 0.508, y, 0.40), 4,
                     (sx, 0, 0), r=0.012)
    p.contact_shade(reach=0.25, strength=0.4)
    return p


@model("rig_barrel.glb", "scatter",
       "0.9 m tall, fifteen staves in three riveted hoops, stands upright")
def rig_barrel():
    p = Part("rig_barrel")
    # A barrel is staves. One revolved surface was the single most synthetic
    # object on the deck: a cooper's barrel shows every joint, and the shadow
    # line down each one is what tells you it is bent wood under tension.
    n = 15
    prof = [(0.275, 0.0), (0.318, 0.16), (0.344, 0.36), (0.350, 0.50),
            (0.336, 0.70), (0.302, 0.86), (0.275, 0.90)]
    for k in range(n):
        a0 = TAU * (k + 0.06) / n
        a1 = TAU * (k + 0.94) / n
        secs = []
        for r, y in prof:
            secs.append([(math.cos(a0) * r, y, math.sin(a0) * r),
                         (math.cos(a1) * r, y, math.sin(a1) * r),
                         (math.cos(a1) * (r - 0.032), y,
                          math.sin(a1) * (r - 0.032)),
                         (math.cos(a0) * (r - 0.032), y,
                          math.sin(a0) * (r - 0.032))])
        loft(p, secs, "wood", closed=True, cap_start=True, cap_end=True)
    revolve(p, [(0.243, 0.876), (0.243, 0.888)], seg=16, slot="wood",
            smooth=False)                              # the head
    def stave_r(y):
        """The stave surface radius at a height, so a hoop can hug it."""
        for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
            if y0 - 1e-6 <= y <= y1 + 1e-6:
                f = 0.0 if y1 - y0 < 1e-9 else (y - y0) / (y1 - y0)
                return r0 + (r1 - r0) * f
        return prof[-1][0]

    for y in (0.14, 0.50, 0.76):
        # Hoops taper to follow the bilge. A straight cylindrical band round a
        # curved barrel gets punched through by the staves wherever the barrel
        # is fatter than the band, which came out looking like the hoops were
        # dripping.
        lo, hi = y - 0.045, y + 0.045
        cyl(p, (0, lo, 0), (0, hi, 0), stave_r(lo) + 0.010,
            stave_r(hi) + 0.010, 16, "iron", caps=False, smooth=True)
        for k in range(3):                             # hoop rivets
            a = TAU * k / 3 + y
            d = Vector((math.cos(a), 0, math.sin(a)))
            bolt(p, tuple(d * (stave_r(y) + 0.013) + Vector((0, y, 0))),
                 tuple(d), r=0.011, stand=0.008)
    p.contact_shade(reach=0.25, strength=0.4)
    return p


@model("rig_net_pile.glb", "medium", "coiled net with cork floats")
def rig_net_pile():
    p = Part("rig_net_pile")
    for i, (r, y, minor) in enumerate(((0.95, 0.16, 0.16), (0.70, 0.30, 0.15),
                                       (0.44, 0.42, 0.13))):
        # Laid rope round the coil rather than a smooth torus: the lay is the
        # only thing that makes a heap of rope read as rope and not as tubing.
        n = 40
        path = [(0.05 * i + math.cos(TAU * k / n) * r,
                 y + 0.02 * math.sin(TAU * k / n * 3.0),
                 -0.04 * i + math.sin(TAU * k / n) * r)
                for k in range(n + 1)]
        rope_run(p, path, minor, "rope", strands=3, lay=2.2, per_turn=6)
    for a, r, y in ((0.4, 1.02, 0.28), (2.1, 0.86, 0.36), (3.4, 1.05, 0.22),
                    (4.6, 0.62, 0.52), (5.7, 0.92, 0.34)):
        sphere(p, (math.cos(a) * r, y, math.sin(a) * r), 0.11, "wood",
               rings=4, seg=8, squash=1.3)
    p.contact_shade(reach=0.35, strength=0.45)
    return p


@model("rig_chain_coil.glb", "small",
       "flaked-down chain, real links, 1.1 m across, 0.25 m tall")
def rig_chain_coil():
    p = Part("rig_chain_coil")
    path = []
    for i in range(41):
        t = i / 40
        a = TAU * 2.3 * t
        r = 0.52 - 0.30 * t
        path.append((math.cos(a) * r, 0.05 + 0.13 * t, math.sin(a) * r))
    chain_links(p, path, link=0.15, wire=0.019)
    tail = smooth_path([path[-1], (0.10, 0.20, -0.12), (0.34, 0.14, -0.46),
                        (0.62, 0.05, -0.58)])
    chain_links(p, tail, link=0.15, wire=0.019)
    p.recenter(drop=False)
    p.contact_shade(reach=0.2, strength=0.5)
    return p


@model("rig_mooring_post.glb", "small", "bollard with a rope turn on it")
def rig_mooring_post():
    p = Part("rig_mooring_post")
    revolve(p, [(0.26, 0.0), (0.22, 0.08), (0.20, 0.78), (0.26, 0.86),
                (0.22, 0.95)], seg=12, slot="wood_dark")
    cyl(p, (0, 0.94, 0), (0, 1.00, 0), 0.20, 0.20, 12, "iron", caps=True,
        smooth=True)
    for k in range(4):
        a = TAU * k / 4 + 0.5
        d = Vector((math.cos(a), 0, math.sin(a)))
        bolt(p, tuple(d * 0.145 + Vector((0, 1.00, 0))), (0, 1, 0), r=0.013,
             stand=0.010)
    rope_run(p, helix((0, 0, 0), 0.228, 0.30, 0.60, 2.0, 44), 0.030, "rope",
             lay=5.0)
    p.contact_shade(reach=0.25, strength=0.4)
    return p
