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


# --------------------------------------------------------------------------
# Where they live. The pit used to be a yard and a ring of cages with nowhere
# to go indoors -- men standing at posts round the clock in an open bowl. A
# camp this size has a barracks hall, huts for the crew bosses, lean-tos on
# the terraces for the watch to get out of the rain, a workshop, and fires
# with something cooking on them. All of it improvised: hides, rough-split
# boards, whatever timber came in on the last ship.
# --------------------------------------------------------------------------

def _log_wall(p, pts, h0, h1, r, slot="wood_dark", seed=0):
    """Vertical logs stood shoulder to shoulder along a path, tops ragged."""
    rr = random.Random(seed)
    for (x, z) in pts:
        top = h1 + rr.uniform(-0.12, 0.10)
        cyl(p, (x, h0, z), (x, top, z), r, r * 0.9, 6, slot, smooth=True)


@model("dh_hut.glb", "structure",
       "a round hide-roofed hut, 5.2 m across, door to +Z. Fits four bunks")
def dh_hut():
    p = Part("dh_hut")
    R, WALL, PEAK = 2.6, 1.9, 4.3
    # Wall: logs in a ring, a gap for the door at +Z.
    pts = []
    n = 62
    for k in range(n):
        a = TAU * k / n
        if abs(math.atan2(math.sin(a - math.pi / 2), math.cos(a - math.pi / 2))) < 0.22:
            continue                                   # door (+Z is a = pi/2)
        pts.append((math.cos(a) * R, math.sin(a) * R))
    _log_wall(p, pts, 0.0, WALL, 0.13, seed=3)
    # Door posts and lintel.
    for sx in (-1, 1):
        cyl(p, (sx * 0.62, 0, R - 0.02), (sx * 0.62, WALL + 0.25, R - 0.02), 0.11, 0.1, 6, "wood")
    beam(p, (-0.8, WALL + 0.1, R), (0.8, WALL + 0.1, R), 0.18, 0.16, "wood")
    # Roof: a cone of hides on poles, flared at the eave, smoke hole at the top.
    revolve(p, [(R + 0.55, WALL - 0.15), (R * 0.85, WALL + 0.55), (R * 0.45, WALL + 1.55),
                (0.32, PEAK - 0.1)], seg=14, slot="hide", smooth=True, cap_start=False,
            cap_end=False)
    for k in range(10):                                # rafter poles through the hole
        a = TAU * (k + 0.5) / 10
        d = (math.cos(a), math.sin(a))
        cyl(p, (d[0] * (R + 0.65), WALL - 0.25, d[1] * (R + 0.65)),
            (d[0] * -0.12, PEAK + 0.45, d[1] * -0.12), 0.05, 0.035, 5, "wood")
    # Lashed bands holding the hides down.
    for h, r in ((WALL + 0.3, R * 0.93), (WALL + 1.2, R * 0.58)):
        torus(p, (0, h, 0), r, 0.03, "rope", majseg=16, minseg=3)
    # A hide flap rolled up over the door.
    cyl(p, (-0.7, WALL - 0.05, R + 0.12), (0.7, WALL - 0.05, R + 0.12), 0.13, 0.13, 7, "hide",
        smooth=True)
    p.contact_shade(reach=0.8, strength=0.5)
    return p


@model("dh_longhouse.glb", "structure",
       "the barracks hall: 15 x 6.4 m, board walls on a stone footing, shingled roof, "
       "doors at both gable ends (+Z and -Z)")
def dh_longhouse():
    return _longhouse("dh_longhouse", 7.5, 3.2, 2.3, 5.2)


@model("dh_hall.glb", "hero",
       "the chief's hall: 24 x 9 m, high roof, a porch on the +Z gable with carved "
       "posts, dragon-head finials, shields along the walls")
def dh_hall():
    p = _longhouse("dh_hall", 12.0, 4.5, 3.0, 8.2)
    HL, W = 12.0, 4.5
    # A porch on the front gable: a roof on four carved posts.
    for sx in (-1, 1):
        for z in (HL + 0.2, HL + 3.4):
            cyl(p, (sx * 2.4, 0, z), (sx * 2.4, 3.2, z), 0.2, 0.17, 8, "wood_dark", smooth=True)
            for k in range(4):
                torus(p, (sx * 2.4, 0.6 + k * 0.7, z), 0.2, 0.035, "iron", majseg=8, minseg=3)
    for sx in (-1, 1):
        quad(p, (sx * 3.0, 3.1, HL + 3.9), (sx * 3.0, 3.1, HL - 0.2),
             (0, 4.6, HL - 0.2), (0, 4.6, HL + 3.9), "wood_dark", double=True)
    # Steps up to it.
    for k in range(3):
        box(p, (0, 0.1 + k * 0.2, HL + 4.2 - k * 0.45), (4.4, 0.2, 0.9), "stone")
    # Dragon-head finials where the bargeboards cross, front and back.
    for sz in (-1, 1):
        z = sz * (HL + 0.5)
        polyline_tube(p, smooth_path([(0, 8.6, z), (0, 9.5, z + sz * 0.4), (0, 10.1, z + sz * 1.0),
                                      (0, 10.0, z + sz * 1.6)]), 0.16, "wood_dark", seg=6, smooth=True)
        sphere(p, (0, 10.0, z + sz * 1.75), 0.26, "wood_dark", rings=3, seg=6, squash=0.7)
    # Round shields along both long walls, painted cloth over wood.
    for sx in (-1, 1):
        for k in range(7):
            z = -HL + 2.2 + k * (2 * HL - 4.4) / 6
            revolve(p, [(0.55, 0), (0.5, 0.06), (0.12, 0.14)], center=(sx * (W + 0.07), 2.0, z),
                    seg=10, slot="cloth" if k % 2 else "hide", axis=(sx, 0, 0))
    # Two braziers on posts at the door.
    for sx in (-1, 1):
        cyl(p, (sx * 3.4, 0, HL + 4.3), (sx * 3.4, 2.0, HL + 4.3), 0.1, 0.08, 6, "iron")
        revolve(p, [(0.1, 0.0), (0.35, 0.15), (0.42, 0.4)], center=(sx * 3.4, 2.0, HL + 4.3),
                seg=10, slot="iron", cap_end=False)
    p.contact_shade(reach=1.0, strength=0.5)
    f = Part("flame")
    for sx in (-1, 1):
        revolve(f, [(0.3, 2.3), (0.26, 2.55), (0.12, 2.85), (0.0, 3.1)], center=(sx * 3.4, 0, HL + 4.3),
                seg=8, slot="ember", smooth=True)
    return [p, f]


@model("dh_fishrack.glb", "medium",
       "a drying rack: two A-frames and poles hung with split fish, 5 m long")
def dh_fishrack():
    p = Part("dh_fishrack")
    for x in (-2.4, 2.4):
        for sz in (-1, 1):
            beam(p, (x, 0, sz * 0.9), (x, 2.3, 0), 0.09, 0.09, "wood", up=(1, 0, 0))
    rr = random.Random(4)
    for y in (2.15, 1.55):
        cyl(p, (-2.7, y, 0), (2.7, y, 0), 0.04, 0.04, 6, "wood_dark")
        for k in range(16):
            x = -2.2 + k * 0.29 + rr.uniform(-0.05, 0.05)
            l = rr.uniform(0.38, 0.52)
            box(p, (x, y - 0.06 - l / 2, 0), (0.1, l, 0.03), "leather" if k % 3 else "hide")
    p.contact_shade(reach=0.3, strength=0.4)
    return p


def _longhouse(name, HL, W, EAVE, RIDGE):
    p = Part(name)
    # Footing.
    for sx in (-1, 1):
        stone_course(p, [(sx * W, 0, -HL), (sx * W, 0, HL)], height=0.45, width=0.5, seed=4 + sx)
    # Side walls: vertical boards.
    rr = random.Random(9)
    for sx in (-1, 1):
        z = -HL
        while z < HL - 0.1:
            w = rr.uniform(0.26, 0.36)
            box(p, (sx * W, 0.45 + (EAVE - 0.45) / 2, z + w / 2),
                (0.07, EAVE - 0.45, w - 0.015), "wood" if rr.random() < 0.7 else "wood_dark")
            z += w
        beam(p, (sx * W, EAVE, -HL - 0.2), (sx * W, EAVE, HL + 0.2), 0.22, 0.2, "wood_dark")
    # Gable ends with a door in each.
    for sz in (-1, 1):
        x = -W
        while x < W - 0.05:
            w = rr.uniform(0.26, 0.34)
            xc = x + w / 2
            if abs(xc) < 0.75:
                x += w
                continue
            top = EAVE + (RIDGE - EAVE) * (1 - abs(xc) / W)
            box(p, (xc, 0.45 + (top - 0.45) / 2, sz * HL), (w - 0.015, top - 0.45, 0.07), "wood")
            x += w
        for sx in (-1, 1):
            cyl(p, (sx * 0.78, 0, sz * HL), (sx * 0.78, 2.3, sz * HL), 0.11, 0.1, 6, "wood_dark")
        beam(p, (-0.95, 2.3, sz * HL), (0.95, 2.3, sz * HL), 0.2, 0.18, "wood_dark")
        quad(p, (-0.72, 0.0, sz * (HL - 0.25)), (0.72, 0.0, sz * (HL - 0.25)),
             (0.72, 2.2, sz * (HL - 0.25)), (-0.72, 2.2, sz * (HL - 0.25)), "hide", double=True)
        # Crossed bargeboards past the ridge.
        for sx in (-1, 1):
            beam(p, (sx * (W + 0.5), EAVE - 0.3, sz * (HL + 0.35)),
                 (-sx * 0.55, RIDGE + 0.7, sz * (HL + 0.35)), 0.22, 0.08, "wood_dark",
                 up=(0, 0, 1))
    # Roof.
    for sx in (-1, 1):
        def patch(u, v, sx=sx):
            z = -HL - 0.35 + u * (2 * HL + 0.7)
            ex, ey = sx * (W + 0.55), EAVE - 0.28
            s = math.sin(math.pi * v) * 0.05
            return (ex + (0 - ex) * v, ey + (RIDGE + 0.05 - ey) * v - s, z)
        shingle_courses(p, patch, "wood_dark", width=0.42, exposure=0.36, thickness=0.035,
                        seed=11 + sx)
    polyline_tube(p, [(0, RIDGE + 0.17, -HL - 0.4), (0, RIDGE + 0.17, HL + 0.4)], 0.13,
                  "wood_dark", seg=7, smooth=True)
    # Smoke louvre on the ridge.
    box(p, (0, RIDGE + 0.55, 0), (0.9, 0.5, 1.6), "wood_dark")
    for sx in (-1, 1):
        quad(p, (sx * 0.95, RIDGE + 0.8, -1.0), (sx * 0.95, RIDGE + 0.8, 1.0),
             (0, RIDGE + 1.15, 1.0), (0, RIDGE + 1.15, -1.0), "wood", double=True)
    p.contact_shade(reach=0.9, strength=0.5)
    return p


@model("dh_leanto.glb", "medium",
       "a watch shelter: hide roof sloping to the back, open to +Z, bench inside, 4 x 3 m")
def dh_leanto():
    p = Part("dh_leanto")
    HW, D, FRONT, BACK = 2.0, 3.0, 2.7, 1.5
    for sx in (-1, 1):
        cyl(p, (sx * HW, 0, D / 2), (sx * HW, FRONT, D / 2), 0.11, 0.09, 6, "wood")
        cyl(p, (sx * HW, 0, -D / 2), (sx * HW, BACK, -D / 2), 0.11, 0.09, 6, "wood")
        beam(p, (sx * HW, FRONT, D / 2 + 0.25), (sx * HW, BACK, -D / 2 - 0.25), 0.14, 0.12,
             "wood_dark")
    beam(p, (-HW - 0.3, FRONT, D / 2), (HW + 0.3, FRONT, D / 2), 0.16, 0.16, "wood_dark")
    beam(p, (-HW - 0.3, BACK, -D / 2), (HW + 0.3, BACK, -D / 2), 0.16, 0.16, "wood_dark")
    quad(p, (-HW - 0.35, FRONT + 0.1, D / 2 + 0.35), (HW + 0.35, FRONT + 0.1, D / 2 + 0.35),
         (HW + 0.35, BACK + 0.1, -D / 2 - 0.35), (-HW - 0.35, BACK + 0.1, -D / 2 - 0.35),
         "hide", double=True)
    # Back wall of wattle-ish boards, half height.
    for k in range(13):
        x = -HW + 0.15 + k * (2 * HW - 0.3) / 12
        box(p, (x, 0.6, -D / 2 + 0.05), (0.28, 1.2, 0.05), "wood_dark")
    # Bench and a water butt.
    box(p, (0, 0.45, -D / 2 + 0.55), (3.2, 0.08, 0.42), "wood")
    for sx in (-1, 1):
        box(p, (sx * 1.3, 0.22, -D / 2 + 0.55), (0.1, 0.44, 0.36), "wood_dark")
    revolve(p, [(0.32, 0), (0.36, 0.45), (0.32, 0.9)], center=(HW - 0.4, 0, D / 2 - 0.5),
            seg=10, slot="wood", smooth=True)
    p.contact_shade(reach=0.6, strength=0.45)
    return p


@model("dh_shed.glb", "structure",
       "an open workshop: plank roof on six posts, 7 x 4.5 m, a bench, an anvil and racks")
def dh_shed():
    p = Part("dh_shed")
    HL, HW, H, RIDGE = 3.5, 2.25, 2.8, 3.9
    for sx in (-1, 1):
        for z in (-HL, 0, HL):
            cyl(p, (sx * HW, 0, z), (sx * HW, H, z), 0.13, 0.11, 6, "wood_dark")
        beam(p, (sx * HW, H, -HL - 0.3), (sx * HW, H, HL + 0.3), 0.2, 0.18, "wood_dark")
        for z in (-HL, 0, HL):                          # rafters
            beam(p, (sx * (HW + 0.45), H - 0.2, z), (0, RIDGE, z), 0.14, 0.1, "wood",
                 up=(0, 0, 1))
        rr = random.Random(5 + sx)
        z = -HL - 0.4
        while z < HL + 0.4:
            w = rr.uniform(0.22, 0.32)
            a = (sx * (HW + 0.5), H - 0.15, z + w / 2)
            b = (0, RIDGE + 0.1, z + w / 2)
            beam(p, a, b, w - 0.02, 0.04, "wood" if rr.random() < 0.6 else "wood_dark",
                 up=(0, 1, 0))
            z += w
    polyline_tube(p, [(0, RIDGE + 0.15, -HL - 0.45), (0, RIDGE + 0.15, HL + 0.45)], 0.1,
                  "wood_dark", seg=6, smooth=True)
    # Workbench along the back.
    box(p, (-HW + 0.55, 0.9, 0), (0.75, 0.1, 5.0), "wood")
    for z in (-2.2, 0, 2.2):
        box(p, (-HW + 0.55, 0.43, z), (0.6, 0.86, 0.12), "wood_dark")
    for k in range(5):                                  # tools on it
        box(p, (-HW + 0.5, 0.98, -1.8 + k * 0.85), (0.3, 0.06, 0.12), "iron")
    # Anvil on a stump.
    cyl(p, (0.6, 0, 1.2), (0.6, 0.6, 1.2), 0.32, 0.3, 8, "wood_dark")
    box(p, (0.6, 0.72, 1.2), (0.3, 0.24, 0.7), "iron")
    box(p, (0.6, 0.72, 1.62), (0.18, 0.12, 0.2), "iron")
    # Spear rack.
    beam(p, (HW - 0.3, 1.4, -2.6), (HW - 0.3, 1.4, -0.8), 0.1, 0.1, "wood_dark")
    for k in range(6):
        z = -2.5 + k * 0.32
        cyl(p, (HW - 0.45, 0.02, z), (HW - 0.2, 2.5, z), 0.02, 0.018, 5, "wood")
    # Barrels of bolts.
    for z in (2.1, 2.9):
        revolve(p, [(0.3, 0), (0.35, 0.4), (0.3, 0.8)], center=(HW - 0.5, 0, z), seg=10,
                slot="wood", smooth=True)
    p.contact_shade(reach=0.7, strength=0.45)
    return p


@model("dh_campfire.glb", "small",
       "a cooking fire: stone ring, logs, a spit on a tripod. Flames ship as `flame`")
def dh_campfire():
    p = Part("dh_campfire")
    for k in range(11):
        a = TAU * k / 11
        boulder(p, (math.cos(a) * 0.95, 0.12, math.sin(a) * 0.95), size=(0.32, 0.24, 0.28),
                seed=k + 20, seg=6, rings=4, bed=0.0)
    for k in range(5):
        a = TAU * k / 5 + 0.3
        d = (math.cos(a), math.sin(a))
        cyl(p, (d[0] * 0.75, 0.08, d[1] * 0.75), (d[0] * 0.05, 0.42, d[1] * 0.05), 0.07, 0.06,
            6, "wood_dark", smooth=True)
    # Tripods and a spit.
    for sx in (-1, 1):
        for sz in (-1, 1):
            cyl(p, (sx * 1.35, 0, sz * 0.35), (sx * 1.2, 1.45, 0), 0.04, 0.035, 5, "wood")
    cyl(p, (-1.4, 1.42, 0), (1.4, 1.42, 0), 0.03, 0.03, 5, "iron")
    sphere(p, (0, 1.32, 0), 0.24, "leather", rings=4, seg=7, squash=0.7)   # something roasting
    p.contact_shade(reach=0.3, strength=0.4)
    f = Part("flame")
    revolve(f, [(0.4, 0.12), (0.34, 0.3), (0.16, 0.6), (0.0, 0.85)], seg=8, slot="ember",
            smooth=True)
    return [p, f]


@model("dh_table.glb", "medium", "a trestle table with two benches, 4 m long")
def dh_table():
    p = Part("dh_table")
    rr = random.Random(2)
    for k in range(4):
        box(p, (-0.36 + k * 0.24, 0.84, 0), (0.23, 0.06, 4.0 + rr.uniform(-0.05, 0.05)), "wood")
    for z in (-1.6, 1.6):
        for sx in (-1, 1):
            beam(p, (sx * 0.38, 0, z), (0, 0.8, z), 0.08, 0.08, "wood_dark", up=(0, 0, 1))
    for sx in (-1, 1):
        box(p, (sx * 0.85, 0.46, 0), (0.32, 0.06, 3.8), "wood")
        for z in (-1.5, 1.5):
            box(p, (sx * 0.85, 0.22, z), (0.28, 0.44, 0.08), "wood_dark")
    for k in range(5):                                  # cups and a bowl
        cyl(p, (rr.uniform(-0.2, 0.2), 0.87, -1.6 + k * 0.8), (rr.uniform(-0.2, 0.2), 1.0,
            -1.6 + k * 0.8), 0.05, 0.05, 6, "wood_dark")
    p.contact_shade(reach=0.4, strength=0.45)
    return p
