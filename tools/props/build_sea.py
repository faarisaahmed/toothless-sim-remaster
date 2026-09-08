"""
P3 -- Sea and dressing.

The two boats matter more than they look. `boat_row.glb` is the one crews are
seen escaping in and being fine in, so it is built sound: clean sheer, three
thwarts, oars shipped. Nothing about it is allowed to read as a wreck. That
job belongs to `wreck_hull.glb`, which is the same shape gone grey and open.

Waterline note: hulls sit with the keel on y=0 like every other model, so the
waterline is above the origin. The height is in the manifest per boat.
"""
from propkit import *  # noqa


def _hull_profiles(zs, half_len, beam, depth, sheer_rise, rocker, fullness=0.62):
    """
    (x, y) sections for a double-ended hull: pointed at both ends, rockered
    keel, sheer sweeping up fore and aft. Returns profiles open at the top,
    running starboard sheer -> keel -> port sheer.
    """
    out = []
    for z in zs:
        t = min(1.0, abs(z) / half_len)
        b = beam * max(0.0, (1.0 - t ** 2.1)) ** fullness
        keel = rocker * t ** 2.0
        top = depth + sheer_rise * t ** 2.2
        pr = []
        for k in range(9):                       # starboard down to port
            u = k / 8.0
            a = (u - 0.5) * 2.0                  # -1 .. +1 across the boat
            x = -b * a
            y = keel + (top - keel) * abs(a) ** 1.55
            pr.append((x, y))
        out.append(pr)
    return out


@model("boat_supply.glb", "hero",
       "14 m hull, 16.2 m over the stem and stern posts. Furled sail. Waterline y=1.05")
def boat_supply():
    p = Part("boat_supply")
    HL = 7.0
    zs = [-7.0, -6.2, -5.0, -3.3, -1.5, 0.0, 1.5, 3.3, 5.0, 6.2, 7.0]
    pr = _hull_profiles(zs, HL, 1.72, 0.35, 1.30, 0.72)
    for i, s in enumerate(pr):                    # close each section with a deck
        s.append((s[-1][0], s[-1][1]))
    loft_z(p, pr, zs, "wood", closed=True, cap_start=False, cap_end=False)

    stem = [(0.0, 1.42 + 0.05 * i, 6.95 + 0.34 * i - 0.02 * i * i)
            for i in range(6)]
    polyline_tube(p, stem, 0.17, "wood_dark", seg=5)
    stern = [(0.0, 1.42 + 0.05 * i, -6.95 - 0.30 * i + 0.02 * i * i)
             for i in range(6)]
    polyline_tube(p, stern, 0.17, "wood_dark", seg=5)
    for sx in (-1, 1):                            # gunwale rail along the sheer
        rail = [(sx * pr[i][0][0], pr[i][0][1] + 0.06, zs[i])
                for i in range(len(zs))]
        polyline_tube(p, rail, 0.10, "wood_dark", seg=4)

    box(p, (0.0, 1.30, -1.2), (1.5, 0.14, 2.6), "wood", grain=(0, 0, 1))
    for sz in (-2.5, -1.2, 0.1):                  # hatch coaming
        box(p, (0.0, 1.38, sz), (1.62, 0.10, 0.10), "wood_dark")

    cyl(p, (0, 1.20, 0.6), (0, 8.4, 0.6), 0.20, 0.13, 8, "wood")   # mast
    yard = 6.4
    cyl(p, (-yard / 2, 6.35, 0.6), (yard / 2, 6.35, 0.6), 0.10, 0.10, 6,
        "wood_dark")
    revolve(p, [(0.0, -yard / 2), (0.32, -yard / 2 + 0.5), (0.40, 0.0),
                (0.32, yard / 2 - 0.5), (0.0, yard / 2)],
            center=(0, 6.15, 0.6), seg=7, slot="cloth", axis=(1, 0, 0))
    for i in range(5):                            # sail ties
        x = -2.2 + i * 1.1
        torus(p, (x, 6.22, 0.6), 0.42, 0.045, "rope", majseg=7, minseg=4,
              axis=(1, 0, 0))
    for sx in (-1, 1):                            # shrouds and stays
        for z in (-0.5, 1.6):
            rope_line(p, (0.06 * sx, 8.1, 0.6), (sx * 1.55, 1.45, z),
                      sag=0.03, steps=3, radius=0.035)
    rope_line(p, (0, 8.2, 0.6), (0, 1.5, 6.5), sag=0.04, steps=4, radius=0.035)
    rope_line(p, (0, 8.2, 0.6), (0, 1.5, -6.2), sag=0.04, steps=4, radius=0.035)

    for i in range(3):                            # oars stowed along the deck
        beam(p, (-1.30 + i * 0.22, 1.44, -3.6), (-1.05 + i * 0.22, 1.50, 2.4),
             0.09, 0.06, "wood")
    beam(p, (1.55, 1.90, -5.4), (1.95, 0.55, -6.9), 0.14, 0.09, "wood_dark")
    quad(p, (1.86, 0.95, -6.2), (2.02, 0.95, -6.6), (2.02, 0.20, -6.9),
         (1.86, 0.20, -6.5), "wood_dark", double=True)      # steering oar blade
    polyline_tube(p, helix((-1.1, 0, 3.4), 0.28, 1.44, 1.60, 2.6, 22), 0.042,
                  "rope", seg=5)
    p.contact_shade(floor=0.6, reach=1.2, strength=0.35)
    return p


@model("boat_row.glb", "medium",
       "4.3 m open boat, sound and dry. Three thwarts, oars shipped. Waterline y=0.34")
def boat_row():
    p = Part("boat_row")
    HL = 2.15
    zs = [-2.15, -1.75, -1.1, -0.4, 0.35, 1.05, 1.7, 2.15]
    pr = _hull_profiles(zs, HL, 0.78, 0.14, 0.34, 0.20, fullness=0.5)
    loft_z(p, pr, zs, "wood", closed=False, cap_start=False, cap_end=False,
           double=True)
    for sx in (-1, 1):
        rail = [(sx * abs(pr[i][0][0]), pr[i][0][1] + 0.02, zs[i])
                for i in range(len(zs))]
        polyline_tube(p, rail, 0.055, "wood_dark", seg=4)
    keel = [(0.0, pr[i][4][1] - 0.03, zs[i]) for i in range(len(zs))]
    polyline_tube(p, keel, 0.055, "wood_dark", seg=4)
    for z, w in ((-1.15, 0.60), (0.05, 0.74), (1.15, 0.60)):     # thwarts
        box(p, (0.0, 0.36, z), (w * 2.0, 0.05, 0.24), "wood", grain=(1, 0, 0))
    for i in range(5):                                          # ribs
        z = -1.6 + i * 0.8
        j = min(range(len(zs)), key=lambda k: abs(zs[k] - z))
        polyline_tube(p, [(pr[j][k][0], pr[j][k][1] + 0.015, z)
                          for k in range(0, 9, 2)], 0.035, "wood_dark", seg=4)
    for sx in (-1, 1):                                          # oars shipped
        beam(p, (sx * 0.30, 0.42, -1.40), (sx * 0.50, 0.46, 1.42), 0.06, 0.045,
             "wood")
        quad(p, (sx * 0.45, 0.44, 1.18), (sx * 0.60, 0.44, 1.24),
             (sx * 0.60, 0.48, 1.58), (sx * 0.45, 0.48, 1.52), "wood",
             double=True)
    polyline_tube(p, helix((0.0, 0, 1.75), 0.16, 0.40, 0.52, 2.4, 18), 0.030,
                  "rope", seg=5)
    p.drop_to()
    p.contact_shade(floor=0.2, reach=0.5, strength=0.3)
    return p


@model("wreck_hull.glb", "structure",
       "9 m of hull, grey, torn open down the starboard side and canted 20 deg on rocks")
def wreck_hull():
    p = Part("wreck_hull")
    HL = 4.4
    zs = [-4.4, -3.6, -2.5, -1.2, 0.2, 1.6, 2.9, 3.9, 4.4]
    pr = _hull_profiles(zs, HL, 1.25, 0.30, 0.95, 0.45)

    # The port side survives; the starboard sheer is torn down towards the keel
    # by a ragged amount. Point counts have to match section to section, so the
    # torn points collapse onto the keel rather than being dropped.
    roll = math.radians(20.0)
    ca, sa = math.cos(roll), math.sin(roll)
    torn = []
    for s_i, z in zip(pr, zs):
        keel = Vector((s_i[4][0], s_i[4][1]))
        t = 0.32 + 0.50 * (0.5 + 0.5 * math.sin(z * 0.85 + 1.4)) \
            + 0.14 * math.sin(z * 2.7)
        t = min(1.0, max(0.06, t))
        out = []
        for k, (x, y) in enumerate(s_i):
            if k < 4:
                v = keel.lerp(Vector((x, y)), t)
                x, y = v.x, v.y
            out.append((x * ca - y * sa, x * sa + y * ca))
        torn.append(out)
    loft_z(p, torn, zs, "wood_dark", closed=False, cap_start=False,
           cap_end=False, double=True)

    for idx, rad in ((0, 0.075), (8, 0.085)):             # sheer / tear edge
        polyline_tube(p, [(torn[i][idx][0], torn[i][idx][1], zs[i])
                          for i in range(len(zs))], rad, "wood_dark", seg=4)
    polyline_tube(p, [(torn[i][4][0], torn[i][4][1], zs[i])
                      for i in range(len(zs))], 0.08, "wood_dark", seg=4)
    for i in range(7):                                    # ribs, some snapped
        z = -3.9 + i * 1.3
        j = min(range(len(zs)), key=lambda k: abs(zs[k] - z))
        run = [(torn[j][k][0], torn[j][k][1], z) for k in range(8, 3, -1)]
        if i % 2:                                         # a broken frame head
            run.append((run[-1][0] - 0.20, run[-1][1] + 0.62, z - 0.08))
        polyline_tube(p, run, 0.055, "wood_dark", seg=4)
    for i, (x, z, r) in enumerate(((-1.6, -2.8, 1.35), (1.5, 1.0, 1.15),
                                   (-0.5, 3.4, 0.95), (2.1, -3.8, 0.8),
                                   (-2.2, 0.6, 0.75))):
        sweep_rock(p, [(x, -0.6, z), (x + 0.1, r * 0.8, z + 0.1)],
                   [r, r * 0.55], 7, "stone", seed=70 + i, amp=0.25)
    p.flatten_base()
    p.contact_shade(reach=0.9, strength=0.4)
    return p


def fish_body(part, pos, length=0.35, seed=0, slot="hide", roll=0.0):
    """A 35 cm fish. Reused by berk_drying_rack, so it lives here."""
    c = Vector(pos)
    L = length
    n = 7
    secs = []
    for i in range(n):
        t = i / (n - 1)
        r = L * 0.145 * math.sin(math.pi * min(1.0, t * 1.18)) ** 0.62
        r = max(r, L * 0.012)
        z = -L * 0.5 + L * t
        secs.append(ring((c.x, c.y + L * 0.02 * math.sin(t * 3.0 + seed),
                          c.z + z), r, 5, (0, 0, 1), squash=0.72))
    loft(part, secs, slot, smooth=True)
    tail = c + Vector((0, 0, -L * 0.5))
    quad(part, tuple(tail), tuple(tail + Vector((0, L * 0.16, -L * 0.16))),
         tuple(tail + Vector((0, 0.0, -L * 0.24))),
         tuple(tail + Vector((0, -L * 0.15, -L * 0.15))), slot, double=True)
    dor = c + Vector((0, L * 0.10, 0))
    quad(part, tuple(dor + Vector((0, 0, L * 0.10))),
         tuple(dor + Vector((0, L * 0.07, -L * 0.02))),
         tuple(dor + Vector((0, L * 0.06, -L * 0.14))),
         tuple(dor + Vector((0, 0, -L * 0.10))), slot, double=True)


@model("fish.glb", "small", "0.35 m, instanced in the hundreds; 70 tris")
def fish():
    p = Part("fish")
    fish_body(p, (0, 0.06, 0), 0.35, seed=1)
    p.drop_to()
    return p


@model("buoy.glb", "small", "float with a marker pole. Waterline y=0.30")
def buoy():
    p = Part("buoy")
    revolve(p, [(0.0, 0.0), (0.24, 0.12), (0.30, 0.34), (0.22, 0.58),
                (0.09, 0.70)], seg=8, slot="wood", smooth=False)
    cyl(p, (0, 0.62, 0), (0, 0.60, 0), 0.11, 0.11, 8, "iron", caps=False)
    cyl(p, (0, 0.60, 0), (0, 1.55, 0), 0.045, 0.035, 5, "wood_dark")
    quad(p, (0.0, 1.50, 0.0), (0.0, 1.50, 0.34), (0.0, 1.24, 0.30),
         (0.0, 1.26, 0.0), "cloth", double=True)
    torus(p, (0, 0.10, 0), 0.09, 0.028, "iron", majseg=6, minseg=4,
          axis=(0, 0, 1))
    p.contact_shade(reach=0.3, strength=0.35)
    return p


@model("kelp.glb", "small",
       "three fronds for shallows, 2.6 m tallest. Uses `hide` -- see the slot note")
def kelp():
    p = Part("kelp")
    specs = ((2.55, 0.9, 0.0, 0.30), (1.95, -1.1, 2.2, 0.24),
             (1.35, 0.2, 4.1, 0.20))
    for fi, (height, lean, phase, width) in enumerate(specs):
        base = Vector((0.20 * math.cos(fi * 2.1), 0.0, 0.20 * math.sin(fi * 2.1)))
        n = 9
        spine, sections = [], []
        for k in range(n):
            t = k / (n - 1)
            c = base + Vector((lean * t * t * 0.45 + 0.18 * math.sin(t * 3.1 + phase),
                               height * t,
                               0.55 * math.sin(t * 2.2 + phase) * t))
            spine.append(tuple(c))
            # A blade: wide in the middle, rippled along its length.
            w = width * math.sin(min(1.0, 0.12 + t * 0.95) * math.pi) ** 0.5
            side = Vector((math.cos(phase + t * 1.4), 0.0,
                           math.sin(phase + t * 1.4))) * (w * 0.5)
            curl = 0.10 * w * math.sin(t * 9.0 + phase)
            sections.append([tuple(c - side + Vector((0, curl, 0))),
                             tuple(c + side - Vector((0, curl, 0)))])
        loft(p, sections, "hide", closed=False, cap_start=False, cap_end=False,
             double=True, smooth=True)
        polyline_tube(p, spine[:5], 0.026, "hide", seg=4)
    p.drop_to()
    return p
