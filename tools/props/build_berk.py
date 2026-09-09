"""
P2 -- Berk.

Only ever seen from the air or from the edge of the village, so this is all
silhouette: bowed walls, ridges that sweep up at the gables, and carved posts
tall enough to break the roofline. No interiors beyond a doorway you can see
is a doorway.

What changed in the detail pass: these were shells. A bowed prism for the wall,
a flat lofted plane for the roof, a smooth extruded kerb for the footing, and
smooth cylinders for every pole. From the air that reads as one moulded object,
because a real building from the air is almost entirely the pattern of the
parts it is made of -- courses of shingle, staves standing side by side, a
drystone footing with a shadow under every stone. So the shell is still there,
holding the shape and keeping the daylight out, and everything you can actually
see is now built on top of it out of parts.
"""
from propkit import *  # noqa
from build_sea import fish_body


def _norse_post(p, base, height, slot="wood_dark", scale=1.0, seed=0):
    """
    A carved gable post: tapered, collared, chip-carved, headed or scrolled.

    The collars used to be revolved rings, which is a turned moulding -- a
    lathe, in a village with no lathe. These are cut: a band of chevron facets
    round the shaft, each one an individual chip, set into the post rather than
    standing off it, because chips that stand off read as gear teeth.
    """
    b = Vector(base)
    timber_pole(p, tuple(b), tuple(b + Vector((0, height, 0))),
                0.21 * scale, 0.135 * scale, slot, seg=9, bend=0.010,
                seed=seed, knots=0, sections=6)
    for i in range(3):                                   # chip-carved collars
        y = b.y + height * (0.28 + i * 0.21)
        r = (0.185 - 0.018 * i) * scale
        cyl(p, (b.x, y - 0.075 * scale, b.z), (b.x, y + 0.075 * scale, b.z),
            r * 1.06, r * 1.06, 11, slot, caps=False, smooth=True)
        n = segs_many(9, 7, 1.3)
        for k in range(n):
            a = TAU * k / n + i * 0.31
            d = Vector((math.cos(a), 0, math.sin(a)))
            box(p, tuple(b + d * (r * 0.86) + Vector((0, y - b.y, 0))),
                (0.085 * scale, 0.13 * scale, 0.085 * scale), slot,
                rot=Matrix.Rotation(-a, 3, "Y") @
                    Matrix.Rotation(math.radians(42), 3, "X"))
    # A stem-post volute on the top, not a carved beast head. A head was
    # tried: at this scale it is eight or nine blocks 0.5 m across on a 0.36 m
    # post, so it hangs off the top rather than growing out of it, and from
    # the air it reads as clutter. The volute is period, it is one continuous
    # form, and it is legible as a silhouette from four hundred metres.
    top = b + Vector((0, height, 0))
    spiral = []
    for k in range(13):                                  # the scroll
        t = k / 12.0
        a = t * TAU * 1.45
        r = 0.42 * scale * (1.0 - 0.74 * t)
        spiral.append((top.x + math.sin(a) * r * 0.35,
                       top.y + r - 0.42 * scale + 0.32 * scale * t,
                       top.z + (1 - math.cos(a)) * r))
    polyline_tube(p, spiral, 0.072 * scale, slot, seg=6, smooth=True)
    # The terminal: a flat carved boss where the scroll ends, not a tube stub.
    end = Vector(spiral[-1])
    box(p, tuple(end), (0.055 * scale, 0.16 * scale, 0.16 * scale), slot,
        rot=Matrix.Rotation(0.4, 3, "X"))


def _hall(p, half_len, half_w, eave, ridge_h, roof, bow=0.62, sway=0.30,
          stave=0.27, seed=0, foot_h=0.34):
    """
    The shared Berk building shell.

    `roof` is "shingle" or "thatch". Returns the half-width function so callers
    can hang doors and posts off the right place.

    Order matters: the shell first, then the footing it stands on, then the
    staves in front of the shell, then the roof over the lot. Each layer is
    offset outward from the one under it by its own real thickness, so the
    silhouette at the eave is footing / stave / rafter tail / shingle butt --
    four steps, which is what tells you from above that it is a wall and not a
    painted line.
    """
    def w(z):
        return half_w - bow + bow * math.cos(math.pi * z / (2 * half_len))

    def rg(z):
        return ridge_h + sway * (z / half_len) ** 2

    # --- the shell. Sits inside the staves and is only there to be opaque.
    n = segs(9, 7)
    zs = [-half_len + 2 * half_len * i / (n - 1) for i in range(n)]
    body = [[(-w(z), foot_h - 0.06), (w(z), foot_h - 0.06), (w(z), eave),
             (0.0, rg(z)), (-w(z), eave)] for z in zs]
    loft_z(p, body, zs, "wood_dark", closed=True, cap_start=True, cap_end=True)

    # --- drystone footing, laid stone by stone down both walls and the gables.
    fz = [-half_len - 0.10 + (2 * half_len + 0.20) * i / 10 for i in range(11)]
    for sx in (-1, 1):
        stone_course(p, [(sx * (w(max(-half_len, min(half_len, z))) + 0.20),
                          0.0, z) for z in fz],
                     height=foot_h, width=0.44, seed=seed + 11 + sx, bed=0.0)
    for sz in (-1, 1):
        edge = w(half_len) + 0.20
        stone_course(p, [(-edge, 0.0, sz * (half_len + 0.16)),
                         (0.0, 0.0, sz * (half_len + 0.22)),
                         (edge, 0.0, sz * (half_len + 0.16))],
                     height=foot_h, width=0.44, seed=seed + 21 + sz, bed=0.0)

    # --- stave walls. Split logs stood on end, which is how the walls of a
    # Norse hall were actually made, and the reason a hall reads as vertical
    # stripes from the air.
    step = 2 * half_len / max(8, int(2 * half_len / stave))
    r = random.Random(seed + 3)
    z = -half_len + step * 0.5
    while z < half_len - 1e-6:
        for sx in (-1, 1):
            x = sx * (w(z) + 0.075)
            h = eave + r.uniform(-0.03, 0.05)
            lean = r.uniform(-0.012, 0.012)
            beam(p, (x, foot_h - 0.04, z), (x + lean, h, z + lean * 0.4),
                 step * r.uniform(0.80, 0.94), 0.15, "wood",
                 up=(0, 0, 1), roll=r.uniform(-0.03, 0.03))
        z += step
    # Wall plate over the stave heads, and a sill under their feet: without
    # them the staves read as a fence rather than a wall.
    for sx in (-1, 1):
        plate = [(sx * (w(zz) + 0.09), eave + 0.03, zz)
                 for zz in [-half_len + 2 * half_len * i / 8 for i in range(9)]]
        polyline_tube(p, plate, 0.085, "wood_dark", seg=6, smooth=True)
        polyline_tube(p, [(x, foot_h + 0.02, zz) for x, _, zz in plate],
                      0.075, "wood_dark", seg=6, smooth=True)

    # --- gable infill: boards running up to the ridge, on both ends.
    for sz in (-1, 1):
        zf = sz * (half_len + 0.02)
        gw = w(half_len)
        cols = max(6, int(2 * gw / 0.30))
        for i in range(cols):
            x = -gw + (2 * gw) * (i + 0.5) / cols
            top = eave + (rg(half_len) - eave) * (1.0 - abs(x) / gw) - 0.05
            if top <= eave + 0.05:
                continue
            beam(p, (x, eave - 0.10, zf), (x, top, zf),
                 (2 * gw / cols) * 0.9, 0.11, "wood", up=(0, 0, 1))
        # Barge boards along the gable edge, mitred at the ridge.
        for sx in (-1, 1):
            beam(p, (sx * (gw + 0.26), eave - 0.22, zf + sz * 0.10),
                 (0.0, rg(half_len) + 0.16, zf + sz * 0.10),
                 0.22, 0.075, "wood_dark", up=(0, 0, 1))

    # --- rafter tails, poking out under the eave all the way along.
    for sx in (-1, 1):
        zz = -half_len + step * 0.5
        k = 0
        while zz < half_len - 1e-6:
            if k % 2 == 0:
                cyl(p, (sx * (w(zz) - 0.10), eave + 0.10, zz),
                    (sx * (w(zz) + 0.40), eave - 0.13, zz),
                    0.062, 0.050, 6, "wood_dark", smooth=True)
            zz += step
            k += 1

    # --- the roof. Two patches, eave to ridge, laid in courses.
    over = 1.06
    for sx in (-1, 1):
        def patch(u, v, sx=sx):
            z = -half_len * over + u * 2 * half_len * over
            zc = max(-half_len, min(half_len, z))
            ex, ey = sx * (w(zc) + 0.44), eave - 0.16
            rx, ry = 0.0, rg(zc) + 0.09
            # Slight hollow in the roof plane: rafters sag between purlins and
            # a dead-straight roof surface is the tell for a game roof.
            s = math.sin(math.pi * v) * 0.055
            return (ex + (rx - ex) * v, ey + (ry - ey) * v - s, z)
        if roof == "thatch":
            thatch_courses(p, patch, "rope", exposure=0.22, depth=0.16,
                           seed=seed + sx * 7)
        else:
            shingle_courses(p, patch, "wood_dark", width=0.30, exposure=0.17,
                            thickness=0.030, seed=seed + sx * 7)

    # --- ridge capping and the weight poles that hold it down.
    ridge_run = smooth_path([(0.0, rg(z) + 0.19, z) for z in
                             [-half_len * 1.06 + 2.12 * half_len * i / 6
                              for i in range(7)]])
    polyline_tube(p, ridge_run, 0.125, "wood_dark", seg=8, smooth=True)
    # Weight poles hold thatch down. A shingle roof is nailed, so it gets a
    # capping course of shingles over the ridge instead.
    for sx in (-1, 1) if roof == "thatch" else ():
        for k in range(3):
            v = 0.24 + k * 0.29
            run = smooth_path([
                (sx * (w(max(-half_len, min(half_len, z))) + 0.44) * (1 - v),
                 (eave - 0.16) + (rg(max(-half_len, min(half_len, z))) + 0.09
                                  - (eave - 0.16)) * v + 0.10, z)
                for z in (-half_len, -half_len * 0.4, half_len * 0.4, half_len)])
            polyline_tube(p, run, 0.062, "wood_dark", seg=5, smooth=True)
    if roof == "thatch":
        for i in range(max(3, int(half_len))):           # ridge lashings
            z = -half_len * 0.85 + (1.7 * half_len) * i / \
                max(2, int(half_len) - 1)
            lashing(p, (0.0, rg(z) + 0.19, z), 0.17, axis=(0, 0, 1), turns=3,
                    wire=0.017)
    else:
        # Ridge cap: shingles laid over the apex in pairs, alternating which
        # side laps which, which is how you actually close a shingle ridge.
        rz = int(2 * half_len / 0.34) + 1
        rr = random.Random(seed + 55)
        for i in range(rz):
            z = -half_len * 1.02 + (2.04 * half_len) * i / max(1, rz - 1)
            lap = 1 if i % 2 else -1
            y = rg(max(-half_len, min(half_len, z))) + 0.24
            for sx in (lap, -lap):
                box(p, (sx * 0.13, y + rr.uniform(-0.01, 0.015), z),
                    (0.30, 0.036, 0.32 * rr.uniform(0.9, 1.0)), "wood_dark",
                    grain=(1, 0, 0),
                    rot=Matrix.Rotation(math.radians(-38 * sx), 3, "Z"))
    return w


def _plank_door(p, cx, zf, width, height, slot="wood", seed=0, facing=1):
    """
    A door: five boards, two ledges across the back, and iron strap hinges.

    A door is the one part of a Berk building the player can be next to, and
    the thing that makes it a door rather than a dark rectangle is the
    ironwork -- two straps running most of the way across it and a ring.
    """
    r = random.Random(seed + 77)
    n = 5
    for i in range(n):
        x = cx - width / 2 + width * (i + 0.5) / n
        box(p, (x, height / 2 + 0.02, zf - 0.055),
            (width / n * 0.94, height - 0.02 + r.uniform(-0.02, 0.02), 0.055),
            slot, grain=(0, 1, 0))
    for y in (height * 0.24, height * 0.78):             # iron straps
        box(p, (cx, y, zf - 0.028), (width * 0.86, 0.075, 0.018), "iron",
            grain=(1, 0, 0))
        nail_row(p, (cx - width * 0.40, y, zf - 0.019),
                 (cx + width * 0.40, y, zf - 0.019), 5, (0, 0, -facing),
                 r=0.012)
        for sx in (-1, 1):                               # the hinge pintle
            cyl(p, (cx + sx * width * 0.47, y, zf - 0.02),
                (cx + sx * width * 0.47, y, zf - 0.10), 0.030, 0.030, 6,
                "iron", smooth=True)
    torus(p, (cx + width * 0.22, height * 0.52, zf - 0.10), 0.055, 0.014,
          "iron", majseg=9, minseg=4, axis=(0, 0, 1))    # ring handle
    boulder(p, (cx, 0.06, zf - 0.16), (width * 0.62, 0.10, 0.24), "stone",
            seed=seed + 5, seg=7, rings=4, amp=0.16, bed=0.0, cap=1.2)


@model("berk_longhouse.glb", "hero",
       "18 m hall, ridge at 6.9 m, shingle roof laid in courses, drystone "
       "footing, stave walls, carved gable posts, door on +Z")
def berk_longhouse():
    p = Part("berk_longhouse")
    HL, HW, EAVE, RIDGE = 9.0, 4.0, 2.45, 6.55
    w = _hall(p, HL, HW, EAVE, RIDGE, "shingle", seed=1, foot_h=0.36)

    for sx in (-1, 1):                                   # buttress posts
        for z in (-6.4, -3.2, 3.2, 6.4):
            timber_pole(p, (sx * (w(z) + 1.05), 0.0, z),
                        (sx * (w(z) + 0.14), EAVE + 0.06, z),
                        0.145, 0.105, "wood_dark", seg=8, seed=int(z * 3),
                        knots=1)
            boulder(p, (sx * (w(z) + 1.05), 0.07, z), (0.30, 0.11, 0.30),
                    "stone", seed=int(40 + z), seg=7, rings=4, bed=0.0,
                    cap=1.2)
    for sx in (-1, 1):
        _norse_post(p, (sx * (w(HL) + 0.34), 0.0, HL + 0.40), RIDGE + 1.35,
                    seed=int(sx))

    zf = HL + 0.02                                       # doorway on +Z
    for sx in (-1, 1):
        beam(p, (sx * 0.90, 0.0, zf + 0.03), (sx * 0.90, 2.52, zf + 0.03),
             0.26, 0.30, "wood_dark", up=(0, 0, 1))
    box(p, (0.0, 2.62, zf + 0.03), (2.14, 0.28, 0.32), "wood_dark",
        grain=(1, 0, 0))
    _plank_door(p, 0.0, zf, 1.50, 2.40, seed=2)
    for sx in (-1, 1):                                   # carved door jamb
        for i in range(4):
            box(p, (sx * 0.90, 0.42 + i * 0.58, zf + 0.20),
                (0.16, 0.30, 0.09), "wood_dark",
                rot=Matrix.Rotation(math.radians(20 * (1 if i % 2 else -1)),
                                    3, "Z"))
    p.flatten_base()
    p.contact_shade(reach=0.9, strength=0.35)
    return p


def _house(name, half_len, half_w, roof, porch, seed):
    p = Part(name)
    w = _hall(p, half_len, half_w, 2.15, 3.95, roof, bow=0.34, sway=0.16,
              seed=seed, foot_h=0.30)
    zf = half_len + 0.02
    for sx in (-1, 1):
        beam(p, (sx * 0.66, 0.0, zf + 0.03), (sx * 0.66, 2.16, zf + 0.03),
             0.22, 0.26, "wood_dark", up=(0, 0, 1))
    box(p, (0.0, 2.26, zf + 0.03), (1.66, 0.24, 0.28), "wood_dark",
        grain=(1, 0, 0))
    _plank_door(p, 0.0, zf, 1.04, 2.02, seed=seed + 4)
    if porch:
        for sx in (-1, 1):
            timber_pole(p, (sx * 1.08, 0.0, zf + 0.74), (sx * 1.04, 2.06, zf + 0.66),
                        0.11, 0.082, "wood_dark", seg=7, seed=seed + sx,
                        knots=1)
            lashing(p, (sx * 1.05, 2.00, zf + 0.67), 0.10, axis=(0, 1, 0),
                    turns=3, wire=0.014)
        # Sailcloth awning, sagging between its two poles and its two nails.
        surface(p, lambda u, v: (
            -1.18 + u * 2.36,
            2.32 - v * 0.30 - math.sin(math.pi * u) * math.sin(v * 2.0) * 0.09,
            zf + 0.02 + v * 0.80), 5, 3, "cloth", grain=(0, 0, 1), double=True)
        for sx in (-1, 1):
            rope_span(p, (sx * 1.18, 2.30, zf + 0.06),
                      (sx * 1.05, 2.02, zf + 0.68), 0.016, sag=0.02, steps=3)
    for sx in (-1, 1):
        _norse_post(p, (sx * (w(half_len) + 0.24), 0.0, half_len + 0.30),
                    3.95 + 0.75, scale=0.7, seed=seed + 3 * sx)
    p.flatten_base()
    p.contact_shade(reach=0.7, strength=0.35)
    return p


@model("berk_house_a.glb", "structure", "7.2 m, cleft-shingle roof")
def berk_house_a():
    return _house("berk_house_a", 3.6, 2.55, "shingle", False, 30)


@model("berk_house_b.glb", "structure",
       "6.4 m, thatched roof in `rope`, awning porch. See the slot note")
def berk_house_b():
    return _house("berk_house_b", 3.2, 2.30, "thatch", True, 60)


@model("berk_dock.glb", "structure", "12 m jetty, deck top at y=1.60")
def berk_dock():
    p = Part("berk_dock")
    ZS = [-5.0 + i * 2.0 for i in range(6)]
    for i, z in enumerate(ZS):
        for sx in (-1, 1):                                # driven piles
            timber_pole(p, (sx * 1.05, 0.0, z), (sx * 1.00, 1.42, z),
                        0.205, 0.165, "wood_dark", seg=9, seed=i * 3 + sx,
                        knots=1, bend=0.02)
            # Weed and barnacle line: a band of growth up to the tide mark.
            cyl(p, (sx * 1.03, 0.30, z), (sx * 1.03, 0.62, z), 0.215, 0.205,
                9, "wood_dark", caps=False, smooth=True)
        beam(p, (-1.18, 1.30, z), (1.18, 1.30, z), 0.16, 0.24, "wood_dark")
        for sx in (-1, 1):                                # cross bracing
            beam(p, (sx * 1.02, 0.25, z), (0.0, 1.20, z), 0.09, 0.07, "wood")
            bolt(p, (sx * 1.02, 1.30, z + 0.13), (0, 0, 1), r=0.019)
    # Decking: real boards, gaps you can see the water through, and a nail in
    # every board over every bearer -- sixty nails, and they are what makes it
    # a jetty somebody built rather than an extruded strip.
    plank_deck(p, -1.15, 1.15, -6.0, 6.0, 1.48, width=0.225, thickness=0.055,
               gap=0.016, slot="wood", along_z=True, seed=4,
               nails_at=ZS, butt_at=(1.0, -3.0, 3.0, -1.0, 5.0, -5.0))
    for z in (-5.78, 5.78):                               # end trims
        box(p, (0.0, 1.48, z), (2.46, 0.075, 0.30), "wood", grain=(1, 0, 0))
        nail_row(p, (-1.1, 1.52, z), (1.1, 1.52, z), 6, (0, 1, 0))
    for sx, z in ((-1, -3.5), (1, 1.5)):                  # mooring bollards
        timber_pole(p, (sx * 1.18, 1.40, z), (sx * 1.18, 2.06, z),
                    0.135, 0.115, "wood_dark", seg=9, bend=0.0, knots=0)
        cyl(p, (sx * 1.18, 2.03, z), (sx * 1.18, 2.09, z), 0.145, 0.125, 9,
            "iron", smooth=True)
        rope_run(p, helix((sx * 1.18, 0, z), 0.152, 1.58, 1.90, 2.4, 26),
                 0.030, "rope", lay=5.0)
    for i in range(5):                                    # ladder down the side
        y = 0.30 + i * 0.28
        cyl(p, (-1.24, y, 4.6), (-1.24, y, 5.1), 0.032, 0.032, 7, "iron",
            smooth=True)
    for sx in (-1, 1):
        beam(p, (-1.24, 0.24, 4.6 + sx * 0.25 + 0.25), (-1.24, 1.44, 4.6 + sx * 0.25 + 0.25),
             0.07, 0.05, "iron", up=(1, 0, 0))
    # The piles are grown timber, so the noise on them dips a centimetre or
    # two below the origin plane. Bed that in rather than shipping a model
    # whose bounding box starts underground.
    p.flatten_base()
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_drying_rack.glb", "medium", "3.4 m, ten fish on two lines")
def berk_drying_rack():
    p = Part("berk_drying_rack")
    for sx in (-1, 1):
        for sz in (-1, 1):
            timber_pole(p, (sx * 1.55 + sz * 0.04, 0.0, sz * 0.55),
                        (sx * 1.60, 2.18, sz * 0.04), 0.10, 0.072,
                        "wood_dark", seg=8, seed=int(sx * 2 + sz), knots=1)
        lashing(p, (sx * 1.60, 2.06, 0.0), 0.15, axis=(0, 0, 1), turns=4,
                wire=0.018)
        beam(p, (sx * 1.50, 0.90, -0.5), (sx * 1.50, 0.90, 0.5), 0.07, 0.07,
             "wood_dark", up=(0, 1, 0))
    for z in (-0.22, 0.22):
        timber_pole(p, (-1.72, 2.10, z), (1.72, 2.08, z), 0.056, 0.050,
                    "wood_dark", seg=7, seed=int(z * 10), knots=1, bend=0.012)
        rope_span(p, (-1.58, 1.98, z), (1.58, 1.98, z), 0.018, sag=0.07,
                  steps=4)
        for i in range(5):
            x = -1.30 + i * 0.65
            y = 1.96 - 0.07 * math.sin(math.pi * (x + 1.58) / 3.16)
            rope_run(p, [(x, y, z), (x, y - 0.10, z)], 0.012, "rope",
                     strands=2, lay=8.0)
            fish_body(p, (x, y - 0.30, z), 0.36, seed=i)
    p.flatten_base()
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_totem.glb", "medium", "5.2 m carved post on a stone footing")
def berk_totem():
    p = Part("berk_totem")
    # The footing is a ring of laid stones with rubble inside, not a plinth.
    stone_course(p, [tuple(Vector((math.cos(TAU * k / 12) * 0.78, 0.0,
                                   math.sin(TAU * k / 12) * 0.78)))
                     for k in range(13)], height=0.40, width=0.36, seed=17,
                 bed=0.0)
    seg = 11
    ph = seeds(seg, 17)
    plan = [(math.cos(TAU * k / seg) * 0.66 * (1 + 0.12 * math.sin(ph[k])),
             math.sin(TAU * k / seg) * 0.66 * (1 + 0.12 * math.sin(ph[k])))
            for k in range(seg)]
    prism_y(p, plan, 0.0, 0.34, "stone")
    _norse_post(p, (0, 0.30, 0), 4.20, scale=1.35, seed=9)
    for i in range(3):                                    # knotwork panels
        y = 1.02 + i * 1.02
        n = segs_many(7, 6, 1.3)
        for k in range(n):
            a = TAU * k / n + i * 0.4
            # Set into the shaft, and shallower than the collars, so the post
            # reads as carved rather than as a stack of cogs.
            box(p, (math.cos(a) * 0.195, y, math.sin(a) * 0.195),
                (0.085, 0.46, 0.085), "wood_dark",
                rot=Matrix.Rotation(-a, 3, "Y") @
                    Matrix.Rotation(math.radians(12), 3, "X"))
    for sx in (-1, 1):                                    # guy ropes and pegs
        rope_span(p, (sx * 0.14, 3.60, 0.0), (sx * 1.45, 0.34, sx * 0.9),
                  0.030, sag=0.04, steps=3)
        cyl(p, (sx * 1.45, 0.42, sx * 0.9), (sx * 1.50, -0.02, sx * 0.94),
            0.045, 0.030, 7, "wood_dark", smooth=True)
    p.flatten_base()          # the guy pegs are driven in, not resting on top
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_fence_4m.glb", "small", "modular, butts end to end on the 4 m grid")
def berk_fence_4m():
    p = Part("berk_fence_4m")
    for z in (-1.87, 1.87):
        timber_pole(p, (0, 0.0, z), (0, 1.42, z), 0.135, 0.098, "wood_dark",
                    seg=9, seed=int(z), knots=1)
    for y in (0.42, 1.16):
        beam(p, (0.0, y, -2.0), (0.0, y, 2.0), 0.07, 0.10, "wood_dark",
             up=(0, 1, 0))
    r = random.Random(5)
    for i in range(11):
        z = -1.72 + i * 0.344
        h = 1.28 + 0.06 * math.sin(i * 1.7)
        beam(p, (0.0, 0.06, z), (r.uniform(-0.02, 0.02), h, z),
             0.155, 0.048, "wood", up=(0, 0, 1), roll=r.uniform(-0.04, 0.04))
        for y in (0.42, 1.16):                            # nailed to the rails
            nail(p, (0.026, y, z), (1, 0, 0), r=0.011)
    p.contact_shade(reach=0.4, strength=0.4)
    return p
