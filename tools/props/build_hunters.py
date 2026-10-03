"""
P4 -- Dragon Hunter Island.

The hunters themselves, and what they built in the pit.

THE MEN. Two kits on one body: a spearman who walks the terraces and throws
bolas, and an archer who stands on the rim and the towers and shoots. They ship
in PARTS -- torso, two arms, two legs -- each with its pivot at the joint, so
js/hunters.js can swing the legs to walk, raise the bow arm to draw, and turn
the whole man to face a dragon, with no skinning. Budgeted as scatter props:
there are dozens on the island at once.

The crews are an industry, not a village (STORY.md: the Ledger bought the war's
leftovers), so the look is uniform: dark oiled leather over everything, an
iron cap with a nose guard and no horns, a fur collar against the wind. Faces
are mostly beard and shadow.

THE PIT. A watchtower for the rim, a ballista, a torch post that lines the
spiral road, a palisade, a hide tent for the barracks shelf, and Bellows'
smelter -- the hero of the set: a round stone furnace the size of a house with
a glowing mouth, iron hoops and two chimneys, standing in the middle of the
pit floor with the cages around it.
"""
from propkit import *  # noqa


# --------------------------------------------------------------------------
# The body. Game space: +Y up, +Z forward, metres. A man is 1.82 m.
# --------------------------------------------------------------------------

HIP_Y = 0.92
SHOULDER_Y = 1.44
HIP_X = 0.105
SHOULDER_X = 0.235


def _leg(name, side):
    x = side * HIP_X
    p = Part(name, origin=(x, HIP_Y, 0.0))
    # Thigh and shin in trousers, wrapped below the knee the way the crews
    # bind them for climbing rigging.
    cyl(p, (x, HIP_Y + 0.02, 0), (x, 0.50, 0.01), 0.085, 0.064, 7, "leather", smooth=True)
    cyl(p, (x, 0.50, 0.01), (x, 0.11, 0.0), 0.063, 0.048, 7, "cloth", smooth=True)
    for k in range(4):                                   # leg wraps
        y = 0.18 + k * 0.075
        cyl(p, (x, y, 0.0), (x, y + 0.035, 0.0), 0.058, 0.056, 7, "leather", smooth=True)
    # Boot: a toe that points forward, a heel, a sole.
    box(p, (x, 0.055, 0.035), (0.11, 0.11, 0.25), "leather")
    box(p, (x, 0.015, 0.035), (0.12, 0.03, 0.27), "wood_dark")
    return p


def _arm(name, side, holding=None):
    x = side * SHOULDER_X
    p = Part(name, origin=(x, SHOULDER_Y, 0.0))
    sx = x + side * 0.03
    # Shoulder pad of hardened leather, upper arm, bracer, hand.
    sphere(p, (x + side * 0.01, SHOULDER_Y + 0.01, 0), 0.085, "leather", rings=3, seg=7)
    cyl(p, (sx, SHOULDER_Y - 0.02, 0), (sx, 1.14, 0.02), 0.058, 0.05, 6, "cloth", smooth=True)
    cyl(p, (sx, 1.14, 0.02), (sx, 0.90, 0.05), 0.052, 0.042, 6, "leather", smooth=True)
    box(p, (sx, 0.85, 0.06), (0.07, 0.09, 0.09), "skin")
    if holding == "spear":
        # Held upright beside him, butt near the ground, head above his helmet.
        cyl(p, (sx, 0.12, 0.10), (sx, 2.25, 0.10), 0.018, 0.016, 6, "wood")
        revolve(p, [(0.0, 2.25), (0.034, 2.30), (0.026, 2.42), (0.0, 2.55)],
                center=(sx, 0, 0.10), seg=4, slot="iron")
        for y in (2.20, 2.23):
            cyl(p, (sx, y, 0.10), (sx, y + 0.02, 0.10), 0.024, 0.024, 6, "rope")
    elif holding == "bow":
        # A recurve, held vertically in front of him at arm's length. Built
        # as a chain of short limbs so it curves; the string is one cord.
        pts = []
        for k in range(13):
            t = k / 12.0
            a = (t - 0.5) * 2.0
            y = 0.86 + a * 0.62
            z = 0.10 + 0.17 * (1 - a * a) - 0.05 * abs(a) ** 4
            pts.append((sx, y, z))
        for a, b in zip(pts, pts[1:]):
            beam(p, a, b, 0.03, 0.022, "wood_dark", up=(1, 0, 0))
        box(p, (sx, 0.86, 0.26), (0.04, 0.12, 0.045), "leather")      # grip
        polyline_tube(p, [pts[0], (sx, 0.86, 0.03), pts[-1]], 0.004, "rope", seg=4)
    return p


def _torso(name, kit):
    p = Part(name, origin=(0.0, HIP_Y, 0.0))
    # Pelvis and belt.
    cyl(p, (0, HIP_Y - 0.06, 0), (0, HIP_Y + 0.08, 0), 0.165, 0.16, 9, "leather", smooth=True)
    cyl(p, (0, HIP_Y + 0.04, 0), (0, HIP_Y + 0.09, 0), 0.172, 0.170, 9, "leather")
    box(p, (0, HIP_Y + 0.065, 0.165), (0.07, 0.06, 0.02), "iron")        # buckle
    # Body: a tunic under a leather jerkin, chest broader than waist.
    revolve(p, [(0.15, HIP_Y + 0.08), (0.16, 1.12), (0.19, 1.30), (0.19, 1.40),
                (0.13, 1.50), (0.06, 1.53)], seg=9, slot="leather", smooth=True)
    # Studs down the front of the jerkin.
    for k in range(5):
        y = 1.04 + k * 0.08
        sphere(p, (0, y, 0.175 if y < 1.28 else 0.19), 0.012, "iron", rings=2, seg=4)
    # Fur collar over the shoulders.
    torus(p, (0, 1.47, 0), 0.17, 0.06, "hide", majseg=10, minseg=5)
    # Neck, head, beard.
    cyl(p, (0, 1.50, 0), (0, 1.60, 0.01), 0.055, 0.055, 7, "skin", smooth=True)
    sphere(p, (0, 1.68, 0.01), 0.105, "skin", rings=5, seg=9, squash=1.12)
    sphere(p, (0, 1.61, 0.06), 0.085, "hide", rings=3, seg=7, squash=0.9)  # beard
    # Iron cap with a nose guard, and a rim. No horns: a working crew.
    revolve(p, [(0.118, 1.69), (0.120, 1.73), (0.105, 1.80), (0.065, 1.85),
                (0.0, 1.87)], center=(0, 0, 0.0), seg=10, slot="iron", smooth=True)
    torus(p, (0, 1.70, 0), 0.119, 0.011, "iron", majseg=10, minseg=3)
    box(p, (0, 1.65, 0.118), (0.022, 0.09, 0.012), "iron")
    # A short cloak of dark cloth down the back.
    quad(p, (-0.2, 1.46, -0.15), (0.2, 1.46, -0.15), (0.22, 0.98, -0.2), (-0.22, 0.98, -0.2),
         "cloth", double=True)
    if kit == "archer":
        # Quiver across the back, arrows showing.
        cyl(p, (0.10, 0.98, -0.20), (-0.08, 1.48, -0.18), 0.055, 0.055, 7, "leather")
        for k in range(5):
            o = (k - 2) * 0.016
            beam(p, (-0.08 + o, 1.46, -0.18), (-0.10 + o, 1.60, -0.18), 0.012, 0.012, "wood")
            box(p, (-0.10 + o, 1.61, -0.18), (0.006, 0.05, 0.03), "cloth")
    else:
        # A coil of bola cord and the stones on his belt.
        torus(p, (0.17, HIP_Y + 0.02, 0.05), 0.07, 0.014, "rope", majseg=9, minseg=3,
              axis=(1, 0, 0))
        for k in range(3):
            sphere(p, (0.20, HIP_Y - 0.08 - k * 0.02, 0.04 + k * 0.05), 0.03, "iron",
                   rings=2, seg=5)
    return p


@model("dh_hunter.glb", "scatter",
       "a hunter with a spear and bolas. Parts: torso, arm_l, arm_r, leg_l, leg_r",
       finish={"bevel": False, "samples": 8})
def dh_hunter():
    return [_torso("torso", "spear"), _arm("arm_l", -1), _arm("arm_r", 1, "spear"),
            _leg("leg_l", -1), _leg("leg_r", 1)]


@model("dh_archer.glb", "scatter",
       "an archer: bow in the left hand, quiver on the back. Same parts as the hunter",
       finish={"bevel": False, "samples": 8})
def dh_archer():
    return [_torso("torso", "archer"), _arm("arm_l", -1, "bow"), _arm("arm_r", 1),
            _leg("leg_l", -1), _leg("leg_r", 1)]


# --------------------------------------------------------------------------
# The pit
# --------------------------------------------------------------------------

@model("dh_torch.glb", "small",
       "a torch post for the spiral road. The flame ships as its own node, `flame`")
def dh_torch():
    p = Part("dh_torch")
    cyl(p, (0, 0, 0), (0, 3.0, 0), 0.075, 0.06, 7, "wood_dark")
    for y in (0.4, 2.6):
        torus(p, (0, y, 0), 0.07, 0.012, "iron", majseg=8, minseg=3)
    # Iron cresset.
    revolve(p, [(0.06, 2.95), (0.16, 3.05), (0.22, 3.30)], seg=9, slot="iron",
            cap_end=False, smooth=True)
    for k in range(6):
        a = TAU * k / 6
        d = Vector((math.cos(a), 0, math.sin(a)))
        beam(p, tuple(d * 0.12 + Vector((0, 3.0, 0))), tuple(d * 0.23 + Vector((0, 3.32, 0))),
             0.025, 0.018, "iron", up=(0, 1, 0))
    p.contact_shade(reach=0.25, strength=0.4)
    f = Part("flame")
    revolve(f, [(0.18, 3.10), (0.20, 3.28), (0.12, 3.50), (0.0, 3.72)], seg=8, slot="ember",
            smooth=True)
    return [p, f]


@model("dh_watchtower.glb", "structure",
       "a log watchtower for the rim: deck at 8 m, roof, ladder. Archers stand at y=8.25")
def dh_watchtower():
    p = Part("dh_watchtower")
    H = 8.0
    # Four splayed legs.
    for sx in (-1, 1):
        for sz in (-1, 1):
            cyl(p, (sx * 2.1, 0, sz * 2.1), (sx * 1.6, H + 2.6, sz * 1.6), 0.17, 0.14, 7,
                "wood_dark")
    # Cross bracing on every side, two tiers.
    for y0, y1 in ((0.6, 4.2), (4.2, H - 0.2)):
        for side in range(4):
            a = side * TAU / 4
            c, s_ = math.cos(a), math.sin(a)
            def at(t, y):
                r0 = 2.1 - (2.1 - 1.6) * (y / (H + 2.6))
                return (c * r0 + -s_ * r0 * t, y, s_ * r0 + c * r0 * t)
            beam(p, at(-1, y0), at(1, y1), 0.12, 0.10, "wood")
            beam(p, at(1, y0), at(-1, y1), 0.12, 0.10, "wood")
    # Deck of boards.
    for k in range(9):
        z = -1.9 + k * 0.475
        box(p, (0, H, z), (4.0, 0.08, 0.44), "wood")
    for sx in (-1, 1):
        beam(p, (sx * 1.9, H - 0.12, -2.0), (sx * 1.9, H - 0.12, 2.0), 0.16, 0.16, "wood_dark")
    # Railing.
    for sx in (-1, 1):
        for sz in (-1, 0, 1):
            cyl(p, (sx * 1.9, H, sz * 1.9), (sx * 1.9, H + 1.1, sz * 1.9), 0.05, 0.05, 6, "wood")
    for y in (H + 0.55, H + 1.08):
        for side in range(4):
            a = side * TAU / 4
            c, s_ = math.cos(a), math.sin(a)
            beam(p, (c * 1.9 - s_ * 1.9, y, s_ * 1.9 + c * 1.9),
                 (c * 1.9 + s_ * 1.9, y, s_ * 1.9 - c * 1.9), 0.06, 0.06, "wood")
    # Roof: four rafters to a peak and a shingle skirt.
    peak = (0, H + 4.2, 0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            beam(p, (sx * 2.2, H + 2.5, sz * 2.2), peak, 0.1, 0.1, "wood_dark")
    for side in range(4):
        a = side * TAU / 4
        c, s_ = math.cos(a), math.sin(a)
        e0 = (c * 2.3 - s_ * 2.3, H + 2.45, s_ * 2.3 + c * 2.3)
        e1 = (c * 2.3 + s_ * 2.3, H + 2.45, s_ * 2.3 - c * 2.3)
        quad(p, e0, e1, (0, H + 4.25, 0), (0, H + 4.25, 0), "hide", double=True)
    # Ladder up one side.
    for sx in (-1, 1):
        beam(p, (sx * 0.28, 0, 2.6), (sx * 0.28, H, 2.0), 0.07, 0.07, "wood")
    for k in range(13):
        t = (k + 0.5) / 13
        beam(p, (-0.28, H * t, 2.6 - 0.6 * t), (0.28, H * t, 2.6 - 0.6 * t), 0.05, 0.05, "wood")
    # A horn hanging from the rail -- they sound the alarm with it.
    cyl(p, (1.9, H + 0.9, 0.6), (2.2, H + 0.6, 1.1), 0.03, 0.09, 7, "cloth")
    p.contact_shade(reach=0.8, strength=0.45)
    return p


@model("dh_ballista.glb", "medium",
       "a dragon ballista on a pivot. Bolt node `bolt` ships loaded")
def dh_ballista():
    p = Part("dh_ballista")
    # Turntable and frame.
    cyl(p, (0, 0, 0), (0, 0.35, 0), 0.9, 0.85, 12, "wood_dark")
    for sx in (-1, 1):
        beam(p, (sx * 0.4, 0.35, -0.6), (sx * 0.4, 1.3, 0.2), 0.14, 0.14, "wood")
    beam(p, (0, 1.25, -1.6), (0, 1.35, 1.6), 0.22, 0.16, "wood")          # stock
    # The bow: two thick limbs swept back from the front, iron-shod.
    for sx in (-1, 1):
        beam(p, (0, 1.38, 1.4), (sx * 1.6, 1.42, 0.85), 0.14, 0.12, "wood_dark")
        box(p, (sx * 1.6, 1.42, 0.85), (0.12, 0.16, 0.12), "iron")
    rope_line(p, (-1.6, 1.42, 0.85), (1.6, 1.42, 0.85), sag=0.0, radius=0.012)
    beam(p, (-0.5, 1.15, -1.5), (0.5, 1.15, -1.5), 0.08, 0.08, "iron")      # windlass
    cyl(p, (-0.55, 1.15, -1.5), (0.55, 1.15, -1.5), 0.09, 0.09, 8, "wood")
    for sx in (-1, 1):
        for k in range(4):
            a = TAU * k / 4
            beam(p, (sx * 0.6, 1.15, -1.5),
                 (sx * 0.6, 1.15 + math.cos(a) * 0.3, -1.5 + math.sin(a) * 0.3), 0.04, 0.04, "wood")
    p.contact_shade(reach=0.4, strength=0.4)
    b = Part("bolt")
    cyl(b, (0, 1.45, -0.9), (0, 1.45, 1.7), 0.035, 0.035, 6, "wood")
    revolve(b, [(0.0, 0.0), (0.07, 0.12), (0.0, 0.42)], center=(0, 1.45, 1.7), seg=4,
            slot="iron", axis=(0, 0, 1))
    return [p, b]


@model("dh_forge.glb", "hero",
       "Bellows' smelter: a round furnace with a glowing mouth (`mouth`) and two chimneys")
def dh_forge():
    p = Part("dh_forge")
    # The body: a squat round tower of fitted stone, battered outward at the foot.
    revolve(p, [(7.6, 0.0), (7.2, 1.2), (6.4, 5.0), (5.8, 8.5), (5.9, 9.0), (5.2, 9.4),
                (0.0, 9.6)], seg=20, slot="stone", smooth=False)
    # Iron hoops round it.
    for y, rr in ((2.4, 7.03), (5.4, 6.33), (8.2, 5.86)):
        torus(p, (0, y, 0), rr, 0.12, "iron", majseg=24, minseg=4)
    # Two chimneys, one taller.
    for (cx, cz, top) in ((2.4, -1.6, 19.0), (-2.6, -0.8, 15.0)):
        cyl(p, (cx, 8.5, cz), (cx, top, cz), 1.35, 1.0, 12, "stone")
        torus(p, (cx, top - 0.3, cz), 1.05, 0.14, "iron", majseg=12, minseg=4)
    # The mouth: a deep arched opening with an iron frame. The glow is its own
    # node so js can breathe it.
    for sx in (-1, 1):
        beam(p, (sx * 1.8, 0.0, 7.3), (sx * 1.8, 3.4, 6.6), 0.4, 0.4, "iron")
    pts = []
    for k in range(9):
        a = math.pi * k / 8
        pts.append((math.cos(a) * 1.8, 3.4 + math.sin(a) * 1.3, 6.6 - math.sin(a) * 0.12))
    for a, b in zip(pts, pts[1:]):
        beam(p, a, b, 0.4, 0.4, "iron")
    # Bellows platforms either side, and chain hanging off the hoops.
    for sx in (-1, 1):
        box(p, (sx * 6.8, 1.0, 3.6), (2.6, 2.0, 3.2), "wood_dark")
        box(p, (sx * 6.8, 2.3, 3.6), (2.2, 0.6, 2.6), "hide")
    for k in range(10):
        a = TAU * (k + 0.5) / 10
        if abs(math.atan2(math.sin(a), math.cos(a)) - math.pi / 2) < 0.6:
            continue
        c = (math.cos(a) * 6.36, 5.3, math.sin(a) * 6.36)
        chain_run(p, [c, (c[0] * 1.02, 3.3, c[2] * 1.02), (c[0] * 1.06, 0.4, c[2] * 1.06)])
    p.contact_shade(reach=2.0, strength=0.5)
    m = Part("mouth")
    box(m, (0, 2.3, 6.2), (3.4, 4.6, 0.6), "ember")
    return [p, m]


@model("dh_palisade.glb", "medium",
       "6 m of sharpened stake wall, 3.6 m tall, footprint along X")
def dh_palisade():
    p = Part("dh_palisade")
    for k in range(18):
        x = -2.95 + k * 0.347
        h = 3.2 + ((k * 37) % 7) * 0.08
        cyl(p, (x, -0.4, 0), (x, h, 0), 0.17, 0.16, 6, "wood_dark")
        revolve(p, [(0.16, h), (0.0, h + 0.45)], center=(x, 0, 0), seg=6, slot="wood")
    for y in (0.9, 2.4):
        beam(p, (-3.0, y, 0.2), (3.0, y, 0.2), 0.14, 0.12, "wood")
    p.contact_shade(reach=0.6, strength=0.45)
    return p


@model("dh_tent.glb", "medium", "a hunters' A-frame tent of hides, 4.4 x 2.6 m")
def dh_tent():
    p = Part("dh_tent")
    L, W, H = 4.4, 3.2, 2.5
    for sz in (-1, 1):
        z = sz * L / 2
        beam(p, (-W / 2, 0, z), (0, H, z), 0.08, 0.08, "wood")
        beam(p, (W / 2, 0, z), (0, H, z), 0.08, 0.08, "wood")
    cyl(p, (0, H, -L / 2 - 0.2), (0, H, L / 2 + 0.2), 0.06, 0.06, 6, "wood")
    for sx in (-1, 1):
        quad(p, (sx * W / 2, 0.05, -L / 2), (sx * W / 2, 0.05, L / 2),
             (0, H - 0.02, L / 2), (0, H - 0.02, -L / 2), "hide", double=True)
    quad(p, (-W / 2, 0.05, -L / 2), (W / 2, 0.05, -L / 2), (0, H, -L / 2), (0, H, -L / 2),
         "hide", double=True)
    p.contact_shade(reach=0.5, strength=0.4)
    return p
