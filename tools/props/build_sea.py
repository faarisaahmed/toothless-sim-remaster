"""
P3 -- Sea and dressing.

The two boats matter more than they look. `boat_row.glb` is the one crews are
seen escaping in and being fine in, so it is built sound: clean sheer, three
thwarts, oars shipped. Nothing about it is allowed to read as a wreck. That
job belongs to `wreck_hull.glb`, which is the same shape gone grey and open.

Waterline note: hulls sit with the keel on y=0 like every other model, so the
waterline is above the origin. The height is in the manifest per boat.

The detail pass gave the hulls the thing that actually says "boat": lapstrake
planking. A Norse hull is built shell-first out of overlapping planks, and the
five or six shadow lines running the length of the hull -- converging as they
sweep up to the stem -- are the most recognisable thing about the shape. They
were a smooth lofted surface before, which is why both boats read as bathtubs.
"""
from propkit import *  # noqa


def _hull_profiles(zs, half_len, beam, depth, sheer_rise, rocker, fullness=0.62,
                   strakes=9):
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
        for k in range(strakes):                 # starboard down to port
            u = k / (strakes - 1.0)
            a = (u - 0.5) * 2.0                  # -1 .. +1 across the boat
            x = -b * a
            y = keel + (top - keel) * abs(a) ** 1.55
            pr.append((x, y))
        out.append(pr)
    return out


def _lapstrake(part, profiles, zs, slot, lap=0.030, double=False,
               keel_index=None):
    """
    Build a hull as overlapping planks instead of one smooth skin.

    Each pair of adjacent profile points becomes its own strake, stepped out
    from the one below it by `lap`. The step is what casts the long shadow line
    down the hull; it is also, structurally, exactly how the boat was built.
    """
    n = len(profiles[0])
    if keel_index is None:
        keel_index = n // 2
    made = []
    for k in range(n - 1):
        # How far from the keel this strake is: the lap steps outboard as the
        # planking climbs, and the two strakes at the keel sit flush.
        rung = min(abs(k - keel_index), abs(k + 1 - keel_index))
        off = lap * rung
        secs = []
        for pr, z in zip(profiles, zs):
            (x0, y0), (x1, y1) = pr[k], pr[k + 1]
            nx, ny = (y1 - y0), -(x1 - x0)
            L = math.hypot(nx, ny) or 1.0
            nx, ny = nx / L, ny / L
            if x0 + x1 < 0:                      # outward, whichever side
                nx, ny = -nx, -ny
            secs.append([(x0 + nx * off, y0 + ny * off, z),
                         (x1 + nx * off, y1 + ny * off, z)])
        made += loft(part, secs, slot, closed=False, cap_start=False,
                     cap_end=False, double=double, smooth=True)
        # The visible edge of the lap: a thin band facing down and outboard.
        if rung > 0:
            band = []
            for pr, z in zip(profiles, zs):
                (x0, y0) = pr[k] if k < keel_index else pr[k + 1]
                (xa, ya) = pr[k + 1] if k < keel_index else pr[k]
                nx, ny = (ya - y0), -(xa - x0)
                L = math.hypot(nx, ny) or 1.0
                nx, ny = nx / L, ny / L
                if x0 < 0:
                    nx, ny = -nx, -ny
                band.append([(x0 + nx * off, y0 + ny * off, z),
                             (x0 + nx * max(0.0, off - lap),
                              y0 + ny * max(0.0, off - lap), z)])
            made += loft(part, band, slot, closed=False, cap_start=False,
                         cap_end=False, double=double, smooth=False)
    return made


@model("boat_supply.glb", "hero",
       "14 m hull, 16.2 m over the stem and stern posts. Lapstrake planking, "
       "furled sail. Waterline y=1.05")
def boat_supply():
    p = Part("boat_supply")
    HL = 7.0
    zs = smooth_path([(0, 0, z) for z in
                      (-7.0, -6.2, -5.0, -3.3, -1.5, 0.0, 1.5, 3.3, 5.0, 6.2,
                       7.0)], per_span=2)
    zs = [q[2] for q in zs]
    pr = _hull_profiles(zs, HL, 1.72, 0.35, 1.30, 0.72, strakes=11)
    _lapstrake(p, pr, zs, "wood", lap=0.038)
    # Deck the top of the sheer over, so the hull is closed and not a trough.
    for i, s in enumerate(pr):
        s.append((s[-1][0], s[-1][1]))
    loft_z(p, [s[:1] + [s[0]] for s in pr], zs, "wood", closed=False,
           cap_start=False, cap_end=False)

    stem = smooth_path([(0.0, 1.42 + 0.05 * i, 6.95 + 0.34 * i - 0.02 * i * i)
                        for i in range(6)])
    polyline_tube(p, stem, 0.17, "wood_dark", seg=7, smooth=True)
    stern = smooth_path([(0.0, 1.42 + 0.05 * i, -6.95 - 0.30 * i + 0.02 * i * i)
                         for i in range(6)])
    polyline_tube(p, stern, 0.17, "wood_dark", seg=7, smooth=True)
    for sx in (-1, 1):                            # gunwale rail along the sheer
        rail = [(sx * abs(pr[i][0][0]), pr[i][0][1] + 0.06, zs[i])
                for i in range(len(zs))]
        polyline_tube(p, rail, 0.10, "wood_dark", seg=6, smooth=True)
        # Shield rack along the rail: the row of pegs is a longship read.
        for k in range(9):
            t = 0.14 + k * 0.09
            i = int(t * (len(zs) - 1))
            nail(p, (sx * abs(pr[i][0][0]) * 1.02, pr[i][0][1] + 0.16, zs[i]),
                 (sx, 0.2, 0), r=0.028, stand=0.05, slot="wood_dark")

    plank_deck(p, -0.75, 0.75, -2.5, 0.1, 1.30, width=0.22, thickness=0.05,
               gap=0.012, slot="wood", seed=12, nails_at=(-2.2, -1.2, -0.2))
    for sz in (-2.5, -1.2, 0.1):                  # hatch coaming
        box(p, (0.0, 1.38, sz), (1.62, 0.10, 0.10), "wood_dark")

    cyl(p, (0, 1.20, 0.6), (0, 8.4, 0.6), 0.20, 0.13, 12, "wood", smooth=True)
    for y in (2.2, 4.6, 7.0):                     # mast hoops
        cyl(p, (0, y - 0.05, 0.6), (0, y + 0.05, 0.6), 0.185, 0.175, 12,
            "iron", caps=False, smooth=True)
    yard = 6.4
    cyl(p, (-yard / 2, 6.35, 0.6), (yard / 2, 6.35, 0.6), 0.10, 0.10, 8,
        "wood_dark", smooth=True)
    # The furled sail: a bundle, lumpy where the ties bite into it.
    def furl(u, v):
        x = (u - 0.5) * yard
        a = TAU * v
        taper = max(0.10, math.sin(math.pi * min(1.0, 0.06 + u * 0.94)) ** 0.5)
        r = 0.40 * taper * (1.0 - 0.22 * abs(math.sin(u * math.pi * 5.0)))
        return (x, 6.15 + math.cos(a) * r, 0.6 + math.sin(a) * r)
    surface(p, furl, 22, 8, "cloth", grain=(1, 0, 0), smooth=True)
    for i in range(5):                            # sail ties
        x = -2.2 + i * 1.1
        lashing(p, (x, 6.15, 0.6), 0.40, axis=(1, 0, 0), turns=2, wire=0.024)
    for sx in (-1, 1):                            # shrouds and stays
        for z in (-0.5, 1.6):
            rope_span(p, (0.06 * sx, 8.1, 0.6), (sx * 1.55, 1.45, z), 0.032,
                      sag=0.03, steps=3)
    rope_span(p, (0, 8.2, 0.6), (0, 1.5, 6.5), 0.032, sag=0.04, steps=4)
    rope_span(p, (0, 8.2, 0.6), (0, 1.5, -6.2), 0.032, sag=0.04, steps=4)

    for i in range(3):                            # oars stowed along the deck
        beam(p, (-1.30 + i * 0.22, 1.44, -3.6), (-1.05 + i * 0.22, 1.50, 2.4),
             0.09, 0.06, "wood")
    beam(p, (1.55, 1.90, -5.4), (1.95, 0.55, -6.9), 0.14, 0.09, "wood_dark")
    quad(p, (1.86, 0.95, -6.2), (2.02, 0.95, -6.6), (2.02, 0.20, -6.9),
         (1.86, 0.20, -6.5), "wood_dark", double=True)      # steering oar blade
    rope_run(p, helix((-1.1, 0, 3.4), 0.28, 1.44, 1.60, 2.6, 40), 0.040,
             "rope", lay=3.2)
    p.contact_shade(floor=0.6, reach=1.2, strength=0.35)
    return p


@model("boat_row.glb", "medium",
       "4.3 m open boat, lapstrake, sound and dry. Three thwarts, oars "
       "shipped. Waterline y=0.34")
def boat_row():
    p = Part("boat_row")
    HL = 2.15
    zs = smooth_path([(0, 0, z) for z in
                      (-2.15, -1.75, -1.1, -0.4, 0.35, 1.05, 1.7, 2.15)],
                     per_span=2)
    zs = [q[2] for q in zs]
    pr = _hull_profiles(zs, HL, 0.78, 0.14, 0.34, 0.20, fullness=0.5, strakes=9)
    _lapstrake(p, pr, zs, "wood", lap=0.020, double=True)
    for sx in (-1, 1):
        rail = [(sx * abs(pr[i][0][0]) + sx * 0.06, pr[i][0][1] + 0.02, zs[i])
                for i in range(len(zs))]
        polyline_tube(p, rail, 0.055, "wood_dark", seg=6, smooth=True)
    keel = [(0.0, pr[i][4][1] - 0.03, zs[i]) for i in range(len(zs))]
    polyline_tube(p, keel, 0.055, "wood_dark", seg=6, smooth=True)
    for z, w in ((-1.15, 0.60), (0.05, 0.74), (1.15, 0.60)):     # thwarts
        box(p, (0.0, 0.36, z), (w * 2.0, 0.05, 0.24), "wood", grain=(1, 0, 0))
        for sx in (-1, 1):
            nail(p, (sx * (w - 0.06), 0.386, z), (0, 1, 0), r=0.010)
    for i in range(7):                                          # ribs
        z = -1.7 + i * 0.57
        j = min(range(len(zs)), key=lambda k: abs(zs[k] - z))
        polyline_tube(p, [(pr[j][k][0] * 0.97, pr[j][k][1] + 0.018, z)
                          for k in range(0, 9)], 0.030, "wood_dark", seg=5,
                      smooth=True)
    for sx in (-1, 1):                                          # oars shipped
        beam(p, (sx * 0.30, 0.42, -1.40), (sx * 0.50, 0.46, 1.42), 0.06, 0.045,
             "wood")
        quad(p, (sx * 0.45, 0.44, 1.18), (sx * 0.60, 0.44, 1.24),
             (sx * 0.60, 0.48, 1.58), (sx * 0.45, 0.48, 1.52), "wood",
             double=True)
        # Thole pins: what an oar actually pivots against on a boat this size.
        for z in (0.30, 0.46):
            cyl(p, (sx * 0.62, 0.40, z), (sx * 0.62, 0.52, z), 0.020, 0.017, 6,
                "wood_dark", smooth=True)
    rope_run(p, helix((0.0, 0, 1.75), 0.16, 0.40, 0.52, 2.4, 30), 0.028,
             "rope", lay=4.0)
    p.drop_to()
    p.contact_shade(floor=0.2, reach=0.5, strength=0.3)
    return p


@model("wreck_hull.glb", "structure",
       "9 m of hull, grey, torn open down the starboard side and canted 20 "
       "deg where it came down across a reef")
def wreck_hull():
    p = Part("wreck_hull")
    HL = 4.4
    zs = smooth_path([(0, 0, z) for z in
                      (-4.4, -3.6, -2.5, -1.2, 0.2, 1.6, 2.9, 3.9, 4.4)],
                     per_span=2)
    zs = [q[2] for q in zs]
    pr = _hull_profiles(zs, HL, 1.25, 0.30, 0.95, 0.45, strakes=9)

    # The reef it came down on. These go in FIRST and small: the previous
    # version put five boulders up to 1.35 m across at the hull's own height
    # and they swallowed it -- from above you saw a rock pile with some sticks
    # in it. A wreck reads as a wreck because you can still see the shape of
    # the boat, so the rocks are now knee-high, they sit under the bilge where
    # a hull would actually hang up, and they hold it off the ground rather
    # than standing beside it.
    LIFT = 0.62
    for i, (x, z, r) in enumerate(((-1.15, -2.6, 0.62), (0.75, 0.9, 0.55),
                                   (-0.35, 3.1, 0.44), (1.35, -3.4, 0.40),
                                   (-1.55, 0.5, 0.36), (0.55, -1.3, 0.30),
                                   (2.20, 1.9, 0.34), (-2.30, 2.2, 0.28))):
        boulder(p, (x, r * 0.42, z), None, "stone", seed=70 + i * 3, seg=9,
                rings=6, amp=0.32, bed=-0.08,
                radii=(r, r * 0.62, r * 0.80),
                along=(math.cos(i * 1.7), 0, math.sin(i * 1.7)))

    # The port side survives; the starboard sheer is torn down towards the keel
    # by a ragged amount, worst amidships where it struck. Point counts have to
    # match section to section, so the torn points collapse onto the keel
    # rather than being dropped.
    roll = math.radians(20.0)
    ca, sa = math.cos(roll), math.sin(roll)
    torn = []
    for s_i, z in zip(pr, zs):
        keel = Vector((s_i[4][0], s_i[4][1]))
        # 0.45 at worst rather than 0.06: below about a third of the section,
        # the whole starboard side folds onto the keel and there is no boat
        # left to recognise.
        t = 0.62 + 0.30 * (0.5 + 0.5 * math.sin(z * 0.85 + 1.4)) \
            + 0.10 * math.sin(z * 2.7)
        t = min(1.0, max(0.45, t))
        out = []
        for k, (x, y) in enumerate(s_i):
            if k < 4:
                v = keel.lerp(Vector((x, y)), t)
                x, y = v.x, v.y
            out.append((x * ca - y * sa + 0.35, x * sa + y * ca + LIFT))
        torn.append(out)
    # Still lapstrake, and now you can see the plank ends where it tore -- the
    # laps are the reason a broken hull looks broken rather than cut.
    _lapstrake(p, torn, zs, "wood_dark", lap=0.026, double=True)

    for idx, rad in ((0, 0.075), (8, 0.085)):             # sheer / tear edge
        polyline_tube(p, [(torn[i][idx][0], torn[i][idx][1], zs[i])
                          for i in range(len(zs))], rad, "wood_dark", seg=5,
                      smooth=True)
    polyline_tube(p, [(torn[i][4][0], torn[i][4][1], zs[i])
                      for i in range(len(zs))], 0.08, "wood_dark", seg=5,
                  smooth=True)
    for i in range(11):                                   # ribs, some snapped
        z = -4.1 + i * 0.84
        j = min(range(len(zs)), key=lambda k: abs(zs[k] - z))
        run = [(torn[j][k][0], torn[j][k][1], z) for k in range(8, 3, -1)]
        if i % 2:                                         # a broken frame head
            run.append((run[-1][0] - 0.20, run[-1][1] + 0.62, z - 0.08))
        polyline_tube(p, run, 0.055, "wood_dark", seg=5, smooth=True)
    # Sprung planks: a few strakes let go and stand off the frames.
    r = random.Random(3)
    for i in range(4):
        j = 3 + i * 4
        z0, z1 = zs[max(0, j - 3)], zs[min(len(zs) - 1, j + 3)]
        k = 6 + i % 2
        a = Vector((torn[j][k][0], torn[j][k][1], z0))
        b = Vector((torn[j][k][0] + r.uniform(0.18, 0.42),
                    torn[j][k][1] + r.uniform(-0.10, 0.22), z1))
        beam(p, tuple(a), tuple(b), 0.20, 0.028, "wood_dark", up=(0, 1, 0))
    # Rest it on the reef. No flatten_base here: clamping everything below zero
    # is what took the 20 degree cant out of the last version and laid it flat.
    p.drop_to()
    p.contact_shade(reach=0.9, strength=0.4)
    return p


def fish_body(part, pos, length=0.35, seed=0, slot="hide", roll=0.0):
    """A 35 cm fish. Reused by berk_drying_rack, so it lives here."""
    c = Vector(pos)
    L = length
    n = segs_many(9, 7, 1.4)
    secs = []
    for i in range(n):
        t = i / (n - 1)
        r = L * 0.145 * math.sin(math.pi * min(1.0, t * 1.18)) ** 0.62
        r = max(r, L * 0.012)
        z = -L * 0.5 + L * t
        secs.append(ring((c.x, c.y + L * 0.02 * math.sin(t * 3.0 + seed),
                          c.z + z), r, segs_many(6, 5, 1.4), (0, 0, 1), squash=0.72))
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
    for sx in (-1, 1):                                   # pectoral fins
        b = c + Vector((sx * L * 0.055, -L * 0.01, L * 0.10))
        quad(part, tuple(b), tuple(b + Vector((sx * L * 0.07, -L * 0.03,
                                               -L * 0.02))),
             tuple(b + Vector((sx * L * 0.05, -L * 0.05, -L * 0.09))),
             tuple(b + Vector((0, -L * 0.01, -L * 0.07))), slot, double=True)


@model("fish.glb", "scatter",
       "0.35 m, instanced in the hundreds, so it stays cheap on purpose",
       detail=1.0, finish={"bevel": False, "samples": 8})
def fish():
    p = Part("fish")
    fish_body(p, (0, 0.06, 0), 0.35, seed=1)
    p.drop_to()
    return p


@model("buoy.glb", "small", "float with a marker pole. Waterline y=0.30")
def buoy():
    p = Part("buoy")
    # A float is staved and hooped like a small cask -- it is a cask, coopered
    # watertight, which is what a Norse net float actually was.
    n = 11
    # The staves stop on a bottom head rather than converging to a point:
    # eleven staves meeting at one vertex is a vertex with twenty-two faces
    # round it, and bevelling that pushed it 48 mm through the origin plane.
    # A cask has a head at both ends anyway.
    prof = [(0.085, 0.025), (0.170, 0.08), (0.250, 0.20), (0.300, 0.34),
            (0.255, 0.50), (0.150, 0.64), (0.085, 0.70)]
    for k in range(n):
        a0, a1 = TAU * (k + 0.07) / n, TAU * (k + 0.93) / n
        secs = []
        for r, y in prof:
            secs.append([(math.cos(a0) * r, y, math.sin(a0) * r),
                         (math.cos(a1) * r, y, math.sin(a1) * r),
                         (math.cos(a1) * (r - 0.026), y,
                          math.sin(a1) * (r - 0.026)),
                         (math.cos(a0) * (r - 0.026), y,
                          math.sin(a0) * (r - 0.026))])
        loft(p, secs, "wood", closed=True, cap_start=True, cap_end=True)
    revolve(p, [(0.062, 0.012), (0.062, 0.024)], seg=11, slot="wood")
    for y, rr in ((0.20, 0.250), (0.46, 0.272)):
        cyl(p, (0, y - 0.030, 0), (0, y + 0.030, 0), rr, rr, 12, "iron",
            caps=False, smooth=True)
    cyl(p, (0, 0.62, 0), (0, 0.60, 0), 0.11, 0.11, 10, "iron", caps=False,
        smooth=True)
    timber_pole(p, (0, 0.60, 0), (0, 1.55, 0), 0.045, 0.032, "wood_dark",
                seg=7, seed=3, knots=1)
    # A rag on the pole, so it is findable in a swell.
    surface(p, lambda u, v: (0.0, 1.50 - v * 0.26 + math.sin(u * 3.0) * 0.02,
                             u * 0.34 * (1.0 - v * 0.1)),
            5, 3, "cloth", grain=(0, 0, 1), double=True, smooth=True)
    torus(p, (0, 0.14, 0), 0.09, 0.028, "iron", majseg=9, minseg=4,
          axis=(0, 0, 1))                    # the becket, clear of the origin
    p.drop_to()
    p.contact_shade(reach=0.3, strength=0.35)
    return p


@model("kelp.glb", "scatter",
       "three fronds for shallows, 2.6 m tallest. Uses `hide` -- see the slot "
       "note. Instanced heavily, so it stays cheap",
       detail=1.2, finish={"bevel": False, "samples": 8, "ground": False})
def kelp():
    p = Part("kelp")
    specs = ((2.55, 0.9, 0.0, 0.30), (1.95, -1.1, 2.2, 0.24),
             (1.35, 0.2, 4.1, 0.20))
    for fi, (height, lean, phase, width) in enumerate(specs):
        base = Vector((0.20 * math.cos(fi * 2.1), 0.0, 0.20 * math.sin(fi * 2.1)))
        n = segs_many(13, 9, 1.3)
        spine, sections = [], []
        for k in range(n):
            t = k / (n - 1)
            c = base + Vector((lean * t * t * 0.45 + 0.18 * math.sin(t * 3.1 + phase),
                               height * t,
                               0.55 * math.sin(t * 2.2 + phase) * t))
            spine.append(tuple(c))
            # A blade: wide in the middle, rippled along its length, and
            # folded down its centre line the way a wet kelp blade hangs.
            w = width * math.sin(min(1.0, 0.12 + t * 0.95) * math.pi) ** 0.5
            side = Vector((math.cos(phase + t * 1.4), 0.0,
                           math.sin(phase + t * 1.4))) * (w * 0.5)
            curl = 0.10 * w * math.sin(t * 9.0 + phase)
            sections.append([tuple(c - side + Vector((0, curl, 0))),
                             tuple(c + Vector((0, curl * 0.3 - w * 0.10, 0))),
                             tuple(c + side - Vector((0, curl, 0)))])
        loft(p, sections, "hide", closed=False, cap_start=False, cap_end=False,
             double=True, smooth=True)
        polyline_tube(p, spine[:6], 0.024, "hide", seg=4, smooth=True)
    p.drop_to()
    return p
