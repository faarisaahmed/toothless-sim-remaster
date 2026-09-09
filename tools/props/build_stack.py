"""
P1 -- Hollow Stack.

Nobody built this for a dragon; a dragon moved in. So: no joinery, no square
timber, no tools. Everything is driftwood, salvaged cloth and rope, lashed
rather than fixed, and slightly wrong -- he made it with his mouth. The one
exception is the sample plates, which are machined, because they came off the
rig.

That constraint is the whole detail brief for this set. The rig gets its realism
from repetition and fasteners; this place gets it from the opposite -- every
pole bent and knotted, every joint a rope seizing with visible turns, every
stone a different stone, and the cloth actually sagging between the rafters it
rests on rather than lying on them like a decal.
"""
from propkit import *  # noqa


@model("stack_shelter.glb", "structure",
       "lean-to, 5.2 x 4.4 m, ridge at y=2.60. Scavenged and deliberately crooked")
def stack_shelter():
    p = Part("stack_shelter")
    ridge_x, hem_x = -0.6, 2.30
    zs = [-2.0, -1.2, -0.4, 0.45, 1.25, 2.0]

    for i, z in enumerate((-1.75, 1.75)):            # forked uprights
        timber_pole(p, (ridge_x - 0.12, 0.0, z), (ridge_x, 2.52, z + 0.06),
                    0.15, 0.105, "wood_dark", seg=8, seed=i * 5, knots=2)
        for sx in (-1, 1):                           # the fork
            timber_pole(p, (ridge_x, 2.40, z + 0.05),
                        (ridge_x + sx * 0.15, 2.68, z + 0.05 + sx * 0.05),
                        0.062, 0.042, "wood_dark", seg=6, seed=i * 3 + sx,
                        knots=0, sections=3)
        boulder(p, (ridge_x - 0.12, 0.05, z), None, "stone", seed=70 + i,
                seg=7, rings=4, bed=0.0, cap=1.2,
                radii=(0.26, 0.08, 0.24))            # bedded in a stone pad
    timber_pole(p, (ridge_x - 0.05, 2.55, -2.25), (ridge_x + 0.05, 2.50, 2.25),
                0.125, 0.105, "wood_dark", seg=9, seed=11, knots=2, bend=0.02)
    for i, z in enumerate(zs):                       # rafters, none equal
        wob = 0.06 * math.sin(i * 2.3)
        timber_pole(p, (ridge_x + 0.05, 2.48 + wob, z),
                    (hem_x + wob * 2, 0.06, z + wob), 0.085, 0.055,
                    "wood_dark", seg=7, seed=20 + i, knots=1, bend=0.015)
        # Lashed, not notched. Four turns of small stuff with the lay showing.
        lashing(p, (ridge_x + 0.06, 2.50, z), 0.15, axis=(0, 0, 1), turns=4,
                wire=0.016)
    for i, z in enumerate((-1.4, 1.5)):              # back props
        timber_pole(p, (-2.15, 0.0, z), (ridge_x - 0.14, 1.35, z),
                    0.095, 0.062, "wood_dark", seg=7, seed=40 + i, knots=1)

    # The cloth goes OVER the frame: ride the rafter line, offset clear of the
    # poles, and sag only in the bays between them.
    ridge = Vector((ridge_x + 0.05, 2.48, 0.0))
    hem = Vector((hem_x, 0.06, 0.0))
    run = hem - ridge
    nrm = Vector((-run.y, run.x, 0.0)).normalized()   # up-and-out of the slope

    def cloth(u, v):
        z = -2.20 + u * 4.4
        t = v * 1.06 - 0.03
        base = ridge + run * t + nrm * 0.17
        gap = min(abs(z - zr) for zr in zs)
        dip = 0.13 * min(gap / 0.45, 1.0) ** 1.4 * max(
            0.0, math.sin(max(t, 0.02) * math.pi)) ** 0.6
        # Salvaged canvas is not a smooth membrane: it creases along the pull
        # lines between the points it is tied down at.
        crease = 0.012 * math.sin(z * 7.3) * math.sin(t * math.pi)
        p2 = base - nrm * (dip + crease)
        return (p2.x, max(p2.y, 0.012), z)

    surface(p, cloth, 16, 7, "cloth", grain=(0, 0, 1), double=True, smooth=True)
    # A weighted line over the cloth at the ridge end, instead of a seizing
    # round each rafter: a lashing modelled on top of the canvas reads as a
    # white worm sitting on it, because the rope you would actually see there
    # is the one holding the sheet down, not the one holding the frame up.
    for i, z in enumerate((-1.75, 0.0, 1.75)):
        c0 = ridge + run * 0.05 + nrm * 0.18
        c1 = ridge + run * 0.62 + nrm * 0.16
        rope_span(p, (c0.x, c0.y, z), (c1.x, c1.y, z + 0.06), 0.014, sag=0.01,
                  steps=3)

    for i, z in enumerate((-1.85, -0.5, 0.7, 1.9)):   # stones on the hem
        boulder(p, (hem_x + 0.20, 0.09, z), None, "stone", seed=20 + i,
                seg=8, rings=5, amp=0.28, bed=0.0, cap=1.3,
                radii=(0.22, 0.13, 0.19))
        rope_span(p, (hem_x + 0.06, 0.14, z - 0.16),
                  (hem_x + 0.30, 0.06, z + 0.16), 0.016, sag=0.01, steps=3)
    p.drop_to()
    p.contact_shade(reach=0.5, strength=0.35)
    return p


@model("stack_lab_shelf.glb", "structure",
       "the lab surface: 3.1 m across, top face at y=0.52, lip up to y=0.66")
def stack_lab_shelf():
    p = Part("stack_lab_shelf")
    seg = 15
    ph = seeds(seg, 3)
    plan = []
    for k in range(seg):
        a = TAU * k / seg
        r = 1.55 * (1.0 + 0.11 * math.sin(ph[k]) + 0.06 * math.sin(ph[k] * 3.0))
        plan.append((math.cos(a) * r, math.sin(a) * r))
    prism_y(p, plan, 0.0, 0.52, "stone")
    # A low lip round the edge, so a plate cannot roll off.
    lip = []
    for x, z in plan:
        d = Vector((x, 0, z))
        n = d.normalized()
        inner = d - n * 0.20
        lip.append([(d.x, 0.50, d.z), (d.x, 0.66, d.z),
                    (inner.x, 0.64, inner.z), (inner.x, 0.50, inner.z)])
    ring_sweep(p, lip, "stone")
    # It is a broken-off slab of the stack, not a table: it wants the same
    # weathering as the rock it came out of, and a scatter of spalled chips
    # round its foot where it has been knocked about.
    p.subdivide(cuts=3, slots=("stone",))
    p.roughen(amount=0.030, freq=1.4, seed=6, octaves=3, slots=("stone",),
              protect_y=0.01)
    r = random.Random(9)
    for i in range(9):
        a = TAU * i / 9 + 0.4
        d = 1.35 + r.uniform(0.0, 0.55)
        boulder(p, (math.cos(a) * d, 0.05, math.sin(a) * d), None, "stone",
                seed=90 + i, seg=6, rings=4, amp=0.34, bed=0.0, cap=1.0,
                radii=(r.uniform(0.10, 0.22), r.uniform(0.04, 0.09),
                       r.uniform(0.09, 0.18)), along=(math.sin(a), 0,
                                                     -math.cos(a)))
    p.contact_shade(reach=0.4, strength=0.4)
    return p


@model("stack_sample_rack.glb", "medium", "driftwood, eight slots along the top bar")
def stack_sample_rack():
    p = Part("stack_sample_rack")
    for i, sx in enumerate((-1, 1)):
        timber_pole(p, (sx * 0.82, 0.0, 0.10), (sx * 0.78, 1.02, -0.04),
                    0.085, 0.060, "wood_dark", seg=7, seed=i * 4, knots=2)
        timber_pole(p, (sx * 0.80, 0.045, -0.42), (sx * 0.80, 0.055, 0.44),
                    0.072, 0.060, "wood_dark", seg=6, seed=i * 7 + 1, knots=1)
    for j, (y, z) in enumerate(((0.46, 0.02), (0.94, -0.02))):
        timber_pole(p, (-0.86, y, z), (0.86, y + 0.02, z), 0.060, 0.055,
                    "wood_dark", seg=6, seed=30 + j, knots=1, bend=0.02)
        for sx in (-1, 1):
            lashing(p, (sx * 0.79, y, z), 0.095, axis=(1, 0, 0), turns=3,
                    wire=0.014)
    for i in range(9):                                     # slot dividers
        x = -0.72 + i * 0.18
        timber_pole(p, (x, 0.94, -0.02), (x, 1.10, -0.02), 0.024, 0.018,
                    "wood", seg=5, seed=50 + i, knots=0, sections=3)
    p.drop_to()
    p.contact_shade(reach=0.35, strength=0.4)
    return p


def _plate(name, kind):
    """
    One alloy offcut off the rig, 0.25 x 0.18 m, lying flat. `kind` picks the
    damage: clean, dented (a strike that stretched it) or holed (punched
    through). These are machined, so unlike everything else at the Stack they
    get a rolled edge and a flat surface -- that contrast IS the prop.
    """
    p = Part(name)
    hx, hz, t = 0.096, 0.069, 0.012      # -> 0.25 x 0.18 m overall
    if kind == "holed":
        outer, inner = [], []
        n = 12
        ph = seeds(n, 7)
        for k in range(n):
            a = TAU * k / n + math.pi / n
            outer.append(Vector((math.cos(a) * hx * 1.32, 0,
                                 math.sin(a) * hz * 1.32)))
            r = 0.040 * (1.0 + 0.30 * math.sin(ph[k] * 2.0))
            inner.append(Vector((math.cos(a) * r, 0, math.sin(a) * r)))
        sec = []
        for o, i in zip(outer, inner):
            # A punched hole tears: the metal is dragged down and thinned
            # round the rim rather than cut square.
            sec.append([(o.x, t, o.z), (o.x, 0.0, o.z),
                        (i.x, -0.006, i.z), (i.x, t * 0.45, i.z)])
        ring_sweep(p, sec, "iron")
        return p

    def top(u, v):
        x, z = (u - 0.5) * hx * 2.6, (v - 0.5) * hz * 2.6
        y = t
        if kind == "dented":
            d = math.hypot((x + 0.02) / 0.075, (z - 0.01) / 0.062)
            y -= 0.016 * math.exp(-d * d)
            # The metal around a strike is raised, not just pushed in.
            y += 0.0035 * math.exp(-((d - 1.5) ** 2) * 2.2)
        return (x, y, z)

    def bot(u, v):
        x, y, z = top(u, v)
        return (x, y - t, z)
    surface(p, top, 8, 6, "iron", grain=(1, 0, 0))
    surface(p, lambda u, v: bot(1.0 - u, v), 8, 6, "iron", grain=(1, 0, 0))
    edge = []                                              # rim between them
    n = 8
    for u, v in ([(i / n, 0.0) for i in range(n)] +
                 [(1.0, j / n) for j in range(n)] +
                 [(1.0 - i / n, 1.0) for i in range(n)] +
                 [(0.0, 1.0 - j / n) for j in range(n)]):
        a, b = top(u, v), bot(u, v)
        edge.append([(a[0], a[1], a[2]), (b[0], b[1], b[2])])
    ring_sweep(p, [[e[1], e[0]] for e in edge], "iron")
    return p


for _kind in ("clean", "dented", "holed"):
    model("stack_sample_plate_%s.glb" % _kind, "small",
          "0.25 x 0.18 m offcut, lying flat; %s" % _kind)(
        (lambda k: (lambda: _plate("stack_sample_plate_%s" % k, k)))(_kind))


@model("stack_fish_rack.glb", "medium", "3.0 m wide, poles at y=1.05 and 1.95")
def stack_fish_rack():
    p = Part("stack_fish_rack")
    for i, sx in enumerate((-1, 1)):                      # two splayed A-frames
        for sz in (-1, 1):
            timber_pole(p, (sx * 1.35 + sz * 0.02, 0.0, sz * 0.62),
                        (sx * 1.42, 2.02, sz * 0.05), 0.088, 0.058,
                        "wood_dark", seg=7, seed=i * 4 + sz, knots=2)
        lashing(p, (sx * 1.42, 1.92, 0.0), 0.125, axis=(1, 0, 0), turns=4,
                wire=0.016)
    for j, (y, z) in enumerate(((1.95, 0.0), (1.05, -0.30), (1.05, 0.30))):
        timber_pole(p, (-1.60, y, z), (1.60, y - 0.02, z), 0.062, 0.055,
                    "wood_dark", seg=6, seed=60 + j, knots=1, bend=0.02)
        for sx in (-1, 1):
            lashing(p, (sx * 1.40, y, z), 0.085, axis=(1, 0, 0), turns=2,
                    wire=0.013)
    for i in range(5):                                    # slack drying lines
        z = -0.42 + i * 0.21
        rope_span(p, (-1.44, 1.62, z), (1.44, 1.62, z), 0.022, sag=0.10,
                  steps=4)
    p.drop_to()
    p.contact_shade(reach=0.4, strength=0.4)
    return p


@model("stack_arch.glb", "hero",
       "landmark. 14 m clear span between the legs, 10.3 m to the crown",
       finish={"smooth_angle": 26.0})
def stack_arch():
    p = Part("stack_arch")
    # The legs run on a little past y=0 at full thickness, and `flatten_base`
    # at the end beds that overshoot into the ground. The first attempt
    # stopped them at y=0 instead, which left a 2.4 m end cap sitting in the
    # floor for flatten_base to squash into a flat fan -- the fins that showed
    # up round both feet. The second attempt pinched the legs shut below
    # ground, which put a visible notch round each one where the taper began.
    n = 46
    path, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        a = math.pi * (t * 1.044 - 0.022)
        path.append((-7.2 * math.cos(a), 9.0 * math.sin(a),
                     0.9 * math.sin(a * 2.0)))
        radii.append(1.30 + 1.15 * math.cos(a) ** 2)
    sweep_rock(p, path, radii, 14, "stone", seed=5, amp=0.11, smooth=True)
    for sx in (-1, 1):                                    # boulders at the feet
        # Talus: what has already fallen off it. Low and wide, bedded in, and
        # clear of the leg so their surfaces do not cut a line across it.
        for i, (dx, dz, r) in enumerate(((2.6, 1.9, 1.15), (1.9, -2.8, 0.85),
                                         (-2.4, 1.5, 0.70), (3.4, -0.5, 0.55),
                                         (0.4, 3.1, 0.48),
                                         (-1.2, -2.6, 0.40))):
            boulder(p, (sx * (7.2 + dx), r * 0.30, dz), None, "stone",
                    seed=40 + i * 3 + sx, seg=9, rings=6, amp=0.30, bed=-0.06,
                    radii=(r, r * 0.55, r * 0.80),
                    along=(math.cos(i * 1.3), 0, math.sin(i * 1.3)))
    # Bedding planes. A sea stack is stratified, and the horizontal banding is
    # what says "cut out of rock by water" rather than "moulded". The noise is
    # deliberately anisotropic -- slow across, fast up -- and amplitude and
    # wavelength go together: 140 mm of displacement at a 0.9 m wavelength is
    # not a bedding plane, it is one overhang per leg with a crack under it.
    p.subdivide(cuts=1, slots=("stone",))
    p.roughen(amount=0.105, freq=(0.30, 1.9, 0.30), seed=13, octaves=3,
              slots=("stone",))
    p.roughen(amount=0.042, freq=(1.6, 4.2, 1.6), seed=27, octaves=2,
              slots=("stone",))
    p.roughen(amount=0.015, freq=(5.0, 7.0, 5.0), seed=41, octaves=1,
              slots=("stone",))
    p.flatten_base()          # the boulders bed into the rock, they do not float
    p.contact_shade(reach=1.6, strength=0.35)
    return p


@model("stack_driftwood.glb", "small",
       "three variants as separate nodes at the same origin; instance one of them")
def stack_driftwood():
    out = []
    specs = ((2.4, 0.16, 61), (1.5, 0.22, 62), (3.1, 0.11, 63))
    for i, (length, thick, seed) in enumerate(specs):
        d = Part("driftwood_%s" % "abc"[i])
        r = random.Random(seed)
        n = 11
        path, radii = [], []
        for k in range(n):
            t = k / (n - 1)
            path.append((-length / 2 + length * t,
                         thick * (0.9 + 0.5 * math.sin(t * 4.0 + seed)),
                         0.35 * math.sin(t * 2.6 + seed) - 0.1))
            radii.append(thick * (1.15 - 0.5 * t + 0.18 * math.sin(t * 7.0)))
        sweep_rock(d, path, radii, 9, "wood_dark", seed=seed, amp=0.20,
                   smooth=True)
        for k in range(3):                                # broken-off stubs
            t = 0.22 + 0.3 * k
            base = Vector(path[int(t * (n - 1))])
            tip = base + Vector((r.uniform(-0.3, 0.3), r.uniform(0.15, 0.45),
                                 r.uniform(-0.4, 0.4)))
            timber_pole(d, tuple(base), tuple(tip), thick * 0.45, thick * 0.16,
                        "wood_dark", seg=6, seed=seed + k, knots=0, sections=3)
        # Sea-worn timber is not a smooth spindle: the soft rings wash out and
        # leave the grain standing, and the ends split and check.
        d.roughen(amount=0.012, freq=6.0, seed=seed + 1, octaves=2)
        d.recenter()
        d.contact_shade(reach=0.3, strength=0.4)
        out.append(d)
    return out
