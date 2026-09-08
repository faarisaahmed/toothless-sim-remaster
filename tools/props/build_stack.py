"""
P1 -- Hollow Stack.

Nobody built this for a dragon; a dragon moved in. So: no joinery, no square
timber, no tools. Everything is driftwood, salvaged cloth and rope, lashed
rather than fixed, and slightly wrong -- he made it with his mouth. The one
exception is the sample plates, which are machined, because they came off the
rig.
"""
from propkit import *  # noqa


@model("stack_shelter.glb", "structure",
       "lean-to, 5.2 x 4.4 m, ridge at y=2.60. Scavenged and deliberately crooked")
def stack_shelter():
    p = Part("stack_shelter")
    ridge_x, hem_x = -0.6, 2.30
    zs = [-2.0, -1.2, -0.4, 0.45, 1.25, 2.0]

    for z in (-1.75, 1.75):                        # forked uprights
        cyl(p, (ridge_x - 0.12, 0.0, z), (ridge_x, 2.52, z + 0.06),
            0.14, 0.10, 6, "wood_dark")
        for sx in (-1, 1):                         # the fork
            cyl(p, (ridge_x, 2.42, z + 0.05),
                (ridge_x + sx * 0.14, 2.66, z + 0.05 + sx * 0.05),
                0.06, 0.04, 5, "wood_dark")
    cyl(p, (ridge_x - 0.05, 2.55, -2.25), (ridge_x + 0.05, 2.50, 2.25),
        0.12, 0.10, 6, "wood_dark")                # ridge pole
    for i, z in enumerate(zs):                     # rafters, none quite equal
        wob = 0.06 * math.sin(i * 2.3)
        cyl(p, (ridge_x + 0.05, 2.48 + wob, z), (hem_x + wob * 2, 0.06, z + wob),
            0.08, 0.055, 5, "wood_dark")
        torus(p, (ridge_x + 0.06, 2.50, z), 0.15, 0.032, "rope",
              majseg=6, minseg=4, axis=(0, 0, 1))
    for z in (-1.4, 1.5):                          # back props
        cyl(p, (-2.15, 0.0, z), (ridge_x - 0.14, 1.35, z), 0.09, 0.06, 5,
            "wood_dark")

    # The cloth goes OVER the frame: ride the rafter line, offset clear of the
    # poles, and sag only in the bays between them.
    ridge = Vector((ridge_x + 0.05, 2.48, 0.0))
    hem = Vector((hem_x, 0.06, 0.0))
    run = hem - ridge
    nrm = Vector((-run.y, run.x, 0.0)).normalized()   # up-and-out of the slope

    def cloth(u, v):
        z = -2.20 + u * 4.4
        t = v * 1.06 - 0.03
        base = ridge + run * t + nrm * 0.11
        gap = min(abs(z - zr) for zr in zs)
        dip = 0.13 * min(gap / 0.45, 1.0) ** 1.4 * max(
            0.0, math.sin(max(t, 0.02) * math.pi)) ** 0.6
        p2 = base - nrm * dip
        return (p2.x, max(p2.y, 0.012), z)

    surface(p, cloth, 14, 6, "cloth", grain=(0, 0, 1), double=True, smooth=True)

    for i, z in enumerate((-1.85, -0.5, 0.7, 1.9)):   # stones on the hem
        sweep_rock(p, [(hem_x + 0.18, 0.0, z), (hem_x + 0.22, 0.20, z + 0.05)],
                   [0.22, 0.16], 6, "stone", seed=20 + i, amp=0.22)
    p.drop_to()
    p.contact_shade(reach=0.5, strength=0.35)
    return p


@model("stack_lab_shelf.glb", "structure",
       "the lab surface: 3.1 m across, top face at y=0.52, lip up to y=0.66")
def stack_lab_shelf():
    p = Part("stack_lab_shelf")
    seg = 11
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
    p.contact_shade(reach=0.4, strength=0.4)
    return p


@model("stack_sample_rack.glb", "medium", "driftwood, eight slots along the top bar")
def stack_sample_rack():
    p = Part("stack_sample_rack")
    for sx in (-1, 1):
        cyl(p, (sx * 0.82, 0.0, 0.10), (sx * 0.78, 1.02, -0.04), 0.08, 0.06, 6,
            "wood_dark")
        cyl(p, (sx * 0.80, 0.04, -0.42), (sx * 0.80, 0.05, 0.44), 0.07, 0.06, 5,
            "wood_dark")                                   # feet
    for y, z in ((0.46, 0.02), (0.94, -0.02)):
        cyl(p, (-0.86, y, z), (0.86, y + 0.02, z), 0.06, 0.055, 6, "wood_dark")
        for sx in (-1, 1):
            torus(p, (sx * 0.79, y, z), 0.10, 0.028, "rope", majseg=6, minseg=4,
                  axis=(1, 0, 0))
    for i in range(9):                                     # slot dividers
        x = -0.72 + i * 0.18
        cyl(p, (x, 0.94, -0.02), (x, 1.10, -0.02), 0.024, 0.020, 4, "wood")
    p.drop_to()
    p.contact_shade(reach=0.35, strength=0.4)
    return p


def _plate(name, kind):
    """
    One alloy offcut off the rig, 0.25 x 0.18 m, lying flat. `kind` picks the
    damage: clean, dented (a strike that stretched it) or holed (punched through).
    """
    p = Part(name)
    hx, hz, t = 0.096, 0.069, 0.012      # -> 0.25 x 0.18 m overall
    if kind == "holed":
        outer, inner = [], []
        ph = seeds(8, 7)
        for k in range(8):
            a = TAU * k / 8 + math.pi / 8
            outer.append(Vector((math.cos(a) * hx * 1.32, 0, math.sin(a) * hz * 1.32)))
            r = 0.040 * (1.0 + 0.30 * math.sin(ph[k] * 2.0))
            inner.append(Vector((math.cos(a) * r, 0, math.sin(a) * r)))
        sec = []
        for o, i in zip(outer, inner):
            sec.append([(o.x, t, o.z), (o.x, 0.0, o.z),
                        (i.x, 0.0, i.z), (i.x, t * 0.6, i.z)])
        ring_sweep(p, sec, "iron")
        return p

    def top(u, v):
        x, z = (u - 0.5) * hx * 2.6, (v - 0.5) * hz * 2.6
        y = t
        if kind == "dented":
            d = math.hypot((x + 0.02) / 0.075, (z - 0.01) / 0.062)
            y -= 0.016 * math.exp(-d * d)
        return (x, y, z)

    def bot(u, v):
        x, y, z = top(u, v)
        return (x, y - t, z)
    surface(p, top, 6, 5, "iron", grain=(1, 0, 0))
    surface(p, lambda u, v: bot(1.0 - u, v), 6, 5, "iron", grain=(1, 0, 0))
    edge = []                                              # rim between them
    n = 6
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
    for sx in (-1, 1):                                    # two splayed A-frames
        for sz in (-1, 1):
            cyl(p, (sx * 1.35 + sz * 0.02, 0.0, sz * 0.62),
                (sx * 1.42, 2.02, sz * 0.05), 0.085, 0.055, 6, "wood_dark")
        torus(p, (sx * 1.42, 1.92, 0.0), 0.13, 0.028, "rope", majseg=6,
              minseg=4, axis=(1, 0, 0))
    for y, z in ((1.95, 0.0), (1.05, -0.30), (1.05, 0.30)):
        cyl(p, (-1.60, y, z), (1.60, y - 0.02, z), 0.06, 0.055, 6, "wood_dark")
    for i in range(5):                                    # slack drying lines
        z = -0.42 + i * 0.21
        rope_line(p, (-1.44, 1.62, z), (1.44, 1.62, z), sag=0.10, steps=4)
    p.drop_to()
    p.contact_shade(reach=0.4, strength=0.4)
    return p


@model("stack_arch.glb", "hero", "landmark. 14 m clear span between the legs, 10.3 m to the crown")
def stack_arch():
    p = Part("stack_arch")
    n = 30
    path, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        path.append((-7.0 * math.cos(math.pi * t), 9.0 * math.sin(math.pi * t),
                     0.9 * math.sin(math.pi * t * 2.0)))
        radii.append(1.30 + 1.15 * math.cos(math.pi * t) ** 2)
    sweep_rock(p, path, radii, 9, "stone", seed=5, amp=0.16)
    for sx in (-1, 1):                                    # boulders at the feet
        for i, (dx, dz, r) in enumerate(((1.9, 1.4, 1.5), (1.2, -2.1, 1.1),
                                         (-1.7, 0.9, 0.9))):
            sweep_rock(p, [(sx * 7.0 + sx * dx, -0.35, dz),
                           (sx * 7.0 + sx * dx * 1.1, r * 0.85, dz * 1.1)],
                       [r, r * 0.55], 7, "stone", seed=40 + i + sx, amp=0.26)
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
        n = 6
        path, radii = [], []
        for k in range(n):
            t = k / (n - 1)
            path.append((-length / 2 + length * t,
                         thick * (0.9 + 0.5 * math.sin(t * 4.0 + seed)),
                         0.35 * math.sin(t * 2.6 + seed) - 0.1))
            radii.append(thick * (1.15 - 0.5 * t + 0.18 * math.sin(t * 7.0)))
        sweep_rock(d, path, radii, 6, "wood_dark", seed=seed, amp=0.20)
        for k in range(2):                                # broken-off stubs
            t = 0.3 + 0.35 * k
            base = Vector(path[int(t * (n - 1))])
            tip = base + Vector((r.uniform(-0.3, 0.3), r.uniform(0.15, 0.45),
                                 r.uniform(-0.4, 0.4)))
            cyl(d, tuple(base), tuple(tip), thick * 0.45, thick * 0.2, 5,
                "wood_dark")
        d.recenter()
        d.contact_shade(reach=0.3, strength=0.4)
        out.append(d)
    return out
