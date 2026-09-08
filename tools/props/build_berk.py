"""
P2 -- Berk.

Only ever seen from the air or from the edge of the village, so this is all
silhouette: bowed walls, ridges that sweep up at the gables, and carved posts
tall enough to break the roofline. No interiors beyond a doorway you can see
is a doorway.
"""
from propkit import *  # noqa
from build_sea import fish_body


def _norse_post(p, base, height, slot="wood_dark", scale=1.0):
    """A carved gable post: tapered, collared, with a scroll on the top."""
    b = Vector(base)
    cyl(p, tuple(b), tuple(b + Vector((0, height, 0))),
        0.19 * scale, 0.12 * scale, 6, slot)
    for i in range(3):                                   # chevron collars
        y = b.y + height * (0.30 + i * 0.20)
        revolve(p, [(0.15 * scale, y), (0.24 * scale, y + 0.09 * scale),
                    (0.15 * scale, y + 0.18 * scale)], center=(b.x, 0, b.z),
                seg=6, slot=slot)
    top = b + Vector((0, height, 0))
    spiral = []
    for k in range(9):                                   # the scroll
        t = k / 8.0
        a = t * TAU * 1.35
        r = 0.40 * scale * (1.0 - 0.72 * t)
        spiral.append((top.x + math.sin(a) * r * 0.35,
                       top.y + r - 0.40 * scale + 0.30 * scale * t,
                       top.z + (1 - math.cos(a)) * r))
    polyline_tube(p, spiral, 0.075 * scale, slot, seg=4)


def _hall(p, half_len, half_w, eave, ridge_h, roof_slot, bow=0.62, sway=0.30):
    """
    The shared Berk building shell: bowed walls, swept ridge, stone footing,
    plank roof over it. Returns the half-width function so callers can hang
    doors and posts off the right place.
    """
    def w(z):
        return half_w - bow + bow * math.cos(math.pi * z / (2 * half_len))

    def rg(z):
        return ridge_h + sway * (z / half_len) ** 2

    n = 9
    zs = [-half_len + 2 * half_len * i / (n - 1) for i in range(n)]
    body = [[(-w(z), 0.26), (w(z), 0.26), (w(z), eave), (0.0, rg(z)),
             (-w(z), eave)] for z in zs]
    loft_z(p, body, zs, "wood", closed=True, cap_start=True, cap_end=True)
    foot = [[(-w(z) - 0.16, 0.0), (w(z) + 0.16, 0.0), (w(z) + 0.16, 0.30),
             (-w(z) - 0.16, 0.30)] for z in zs]
    loft_z(p, foot, zs, "stone", closed=True, cap_start=True, cap_end=True)

    for sx in (-1, 1):                                   # roof planes
        def roof(u, v, sx=sx):
            z = -half_len * 1.06 + u * 2 * half_len * 1.06
            zc = max(-half_len, min(half_len, z))
            ex, ey = sx * (w(zc) + 0.22), eave - 0.16
            rx, ry = 0.0, rg(zc) + 0.10
            x = ex + (rx - ex) * v
            y = ey + (ry - ey) * v
            return (x, y, z)
        surface(p, roof, 10, 3, roof_slot, grain=(1, 0, 0), smooth=False)
    ridge_run = [(0.0, rg(z) + 0.16, z) for z in
                 [-half_len * 1.05 + 2.1 * half_len * i / 8 for i in range(9)]]
    polyline_tube(p, ridge_run, 0.14, "wood_dark", seg=5)
    for sx in (-1, 1):                                   # weight poles
        for k in range(3):
            v = 0.25 + k * 0.28
            run = [(sx * (w(max(-half_len, min(half_len, z))) + 0.22) * (1 - v),
                    (eave - 0.16) + (rg(max(-half_len, min(half_len, z))) + 0.10
                                     - (eave - 0.16)) * v + 0.06, z)
                   for z in (-half_len, 0.0, half_len)]
            polyline_tube(p, run, 0.07, "wood_dark", seg=4)

    step = 2 * half_len / max(6, int(2 * half_len / 0.62))
    z = -half_len + step * 0.5
    while z < half_len:                                  # vertical wall boards
        for sx in (-1, 1):
            box(p, (sx * (w(z) + 0.05), (eave + 0.26) / 2, z),
                (0.10, eave - 0.26, 0.16), "wood", grain=(0, 1, 0))
        z += step
    return w


@model("berk_longhouse.glb", "hero",
       "18 m hall, ridge at 6.9 m, carved gable posts, door on +Z")
def berk_longhouse():
    p = Part("berk_longhouse")
    HL, HW, EAVE, RIDGE = 9.0, 4.0, 2.45, 6.55
    w = _hall(p, HL, HW, EAVE, RIDGE, "wood_dark")

    for sx in (-1, 1):                                   # buttress posts
        for z in (-6.4, -3.2, 3.2, 6.4):
            cyl(p, (sx * (w(z) + 1.05), 0.0, z), (sx * (w(z) + 0.10), EAVE, z),
                0.14, 0.10, 5, "wood_dark")
    for sx in (-1, 1):
        _norse_post(p, (sx * (w(HL) + 0.30), 0.0, HL + 0.35), RIDGE + 1.35)

    zf = HL + 0.02                                       # doorway on +Z
    for sx in (-1, 1):
        box(p, (sx * 0.86, 1.20, zf), (0.24, 2.40, 0.28), "wood_dark",
            grain=(0, 1, 0))
    box(p, (0.0, 2.50, zf), (2.10, 0.26, 0.30), "wood_dark", grain=(1, 0, 0))
    box(p, (0.0, 1.16, zf - 0.10), (1.48, 2.32, 0.10), "wood", grain=(0, 1, 0))
    for y in (0.55, 1.80):
        box(p, (0.0, y, zf - 0.02), (1.40, 0.12, 0.06), "iron", grain=(1, 0, 0))
    p.flatten_base()
    p.contact_shade(reach=0.9, strength=0.35)
    return p


def _house(name, half_len, half_w, roof_slot, porch):
    p = Part(name)
    w = _hall(p, half_len, half_w, 2.15, 3.95, roof_slot, bow=0.34, sway=0.16)
    zf = half_len + 0.02
    for sx in (-1, 1):
        box(p, (sx * 0.62, 1.02, zf), (0.20, 2.04, 0.24), "wood_dark",
            grain=(0, 1, 0))
    box(p, (0.0, 2.14, zf), (1.60, 0.22, 0.26), "wood_dark", grain=(1, 0, 0))
    box(p, (0.0, 0.98, zf - 0.09), (1.02, 1.96, 0.09), "wood", grain=(0, 1, 0))
    if porch:
        for sx in (-1, 1):
            cyl(p, (sx * 1.05, 0.0, zf + 0.70), (sx * 1.02, 2.05, zf + 0.62),
                0.11, 0.08, 5, "wood_dark")
        surface(p, lambda u, v: (-1.15 + u * 2.30, 2.30 - v * 0.26,
                                 zf + 0.02 + v * 0.78),
                4, 2, "cloth", grain=(0, 0, 1), double=True)
    for sx in (-1, 1):
        _norse_post(p, (sx * (w(half_len) + 0.22), 0.0, half_len + 0.28),
                    3.95 + 0.75, scale=0.7)
    p.flatten_base()
    p.contact_shade(reach=0.7, strength=0.35)
    return p


@model("berk_house_a.glb", "structure", "7.2 m, shingle roof")
def berk_house_a():
    return _house("berk_house_a", 3.6, 2.55, "wood_dark", porch=False)


@model("berk_house_b.glb", "structure",
       "6.4 m, thatched roof in `rope`, awning porch. See the slot note")
def berk_house_b():
    return _house("berk_house_b", 3.2, 2.30, "rope", porch=True)


@model("berk_dock.glb", "structure", "12 m jetty, deck top at y=1.60")
def berk_dock():
    p = Part("berk_dock")
    for z in [-5.0 + i * 2.0 for i in range(6)]:
        for sx in (-1, 1):
            cyl(p, (sx * 1.05, 0.0, z), (sx * 1.00, 1.42, z), 0.20, 0.17, 6,
                "wood_dark")
        beam(p, (-1.15, 1.30, z), (1.15, 1.30, z), 0.16, 0.22, "wood_dark")
        for sx in (-1, 1):                                # cross bracing
            beam(p, (sx * 1.02, 0.25, z), (0.0, 1.20, z), 0.09, 0.07, "wood")
    for i in range(5):
        box(p, (-1.0 + i * 0.5, 1.48, 0.0), (0.46, 0.09, 12.0), "wood",
            grain=(0, 0, 1))
    for z in (-5.6, 5.6):                                 # end trims
        box(p, (0.0, 1.48, z), (2.44, 0.09, 0.34), "wood", grain=(1, 0, 0))
    for sx, z in ((-1, -3.5), (1, 1.5)):                  # mooring cleats
        cyl(p, (sx * 1.16, 1.52, z), (sx * 1.16, 2.02, z), 0.13, 0.11, 6,
            "wood_dark")
        polyline_tube(p, helix((sx * 1.16, 0, z), 0.148, 1.60, 1.88, 2.4, 20),
                      0.032, "rope", seg=5)
    for i in range(5):                                    # ladder down the side
        y = 0.30 + i * 0.28
        cyl(p, (-1.22, y, 4.6), (-1.22, y, 5.1), 0.035, 0.035, 5, "iron")
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_drying_rack.glb", "medium", "3.4 m, ten fish on two lines")
def berk_drying_rack():
    p = Part("berk_drying_rack")
    for sx in (-1, 1):
        for sz in (-1, 1):
            cyl(p, (sx * 1.55 + sz * 0.04, 0.0, sz * 0.55),
                (sx * 1.60, 2.18, sz * 0.04), 0.10, 0.07, 6, "wood_dark")
        torus(p, (sx * 1.60, 2.06, 0.0), 0.15, 0.03, "rope", majseg=6,
              minseg=4, axis=(1, 0, 0))
        beam(p, (sx * 1.50, 0.90, -0.5), (sx * 1.50, 0.90, 0.5), 0.07, 0.07,
             "wood_dark", up=(0, 1, 0))
    for z in (-0.22, 0.22):
        cyl(p, (-1.72, 2.10, z), (1.72, 2.08, z), 0.055, 0.05, 5, "wood_dark")
        rope_line(p, (-1.58, 1.98, z), (1.58, 1.98, z), sag=0.07, steps=4)
        for i in range(5):
            x = -1.30 + i * 0.65
            y = 1.96 - 0.07 * math.sin(math.pi * (x + 1.58) / 3.16)
            cyl(p, (x, y, z), (x, y - 0.10, z), 0.016, 0.016, 4, "rope")
            fish_body(p, (x, y - 0.30, z), 0.36, seed=i)
    p.flatten_base()
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_totem.glb", "medium", "5.2 m carved post on a stone footing")
def berk_totem():
    p = Part("berk_totem")
    seg_ph = seeds(9, 17)
    plan = [(math.cos(TAU * k / 9) * 0.85 * (1 + 0.14 * math.sin(seg_ph[k])),
             math.sin(TAU * k / 9) * 0.85 * (1 + 0.14 * math.sin(seg_ph[k])))
            for k in range(9)]
    prism_y(p, plan, 0.0, 0.42, "stone")
    _norse_post(p, (0, 0.38, 0), 4.20, scale=1.35)
    for i in range(4):                                    # carved bands
        y = 0.85 + i * 0.78
        for k in range(6):
            a = TAU * k / 6 + i * 0.4
            box(p, (math.cos(a) * 0.20, y, math.sin(a) * 0.20),
                (0.13, 0.30, 0.13), "wood_dark",
                rot=Matrix.Rotation(a, 3, "Y"))
    for sx in (-1, 1):                                    # guy ropes
        rope_line(p, (sx * 0.14, 3.60, 0.0), (sx * 1.45, 0.42, sx * 0.9),
                  sag=0.04, steps=3, radius=0.035)
    p.contact_shade(reach=0.6, strength=0.4)
    return p


@model("berk_fence_4m.glb", "small", "modular, butts end to end on the 4 m grid")
def berk_fence_4m():
    p = Part("berk_fence_4m")
    for z in (-1.87, 1.87):
        cyl(p, (0, 0.0, z), (0, 1.42, z), 0.13, 0.10, 6, "wood_dark")
    for y in (0.42, 1.16):
        beam(p, (0.0, y, -2.0), (0.0, y, 2.0), 0.07, 0.10, "wood_dark",
             up=(0, 1, 0))
    for i in range(11):
        z = -1.72 + i * 0.344
        h = 1.28 + 0.06 * math.sin(i * 1.7)
        beam(p, (0.0, 0.06, z), (0.0, h, z), 0.16, 0.05, "wood",
             up=(0, 0, 1))
    p.contact_shade(reach=0.4, strength=0.4)
    return p
