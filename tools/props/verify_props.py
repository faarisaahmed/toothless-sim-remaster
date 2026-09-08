"""
Read the exported .glb files back and check them against the brief, then write
assets/models/props/MANIFEST.md from what is actually in the files.

    python3 tools/props/verify_props.py

Deliberately does not use Blender: this reads the shipped bytes, so it catches
anything the exporter did that the build script did not intend.
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROPS = os.path.join(ROOT, "assets", "models", "props")
SLOTS = ["wood", "wood_dark", "stone", "iron", "rope", "cloth", "hide", "ember"]
ANCHORS = {}   # filled from _build_meta.json


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "%s is not a .glb" % path
    assert version == 2, "%s is glTF %d, want 2" % (path, version)
    off, js, bin_chunk = 12, None, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + clen + (-clen % 4)
    return js, bin_chunk


def check(path):
    name = os.path.basename(path)
    anchor = ANCHORS.get(name, "ground")
    g, _ = read_glb(path)
    problems = []
    lo = [1e9] * 3
    hi = [-1e9] * 3
    tris = 0
    slots = []
    nodes = []

    per_node = {}
    for node in g.get("nodes", []):
        nodes.append(node.get("name", "?"))
        nlo, nhi = [1e9] * 3, [-1e9] * 3
        if "rotation" in node or "scale" in node or "matrix" in node:
            problems.append("node %r carries a rotation/scale" % node.get("name"))
        if node.get("children"):
            problems.append("node %r has children; nesting was not asked for"
                            % node.get("name"))
        t = node.get("translation", [0, 0, 0])
        mesh = g["meshes"][node["mesh"]] if "mesh" in node else None
        if mesh is None:
            problems.append("node %r has no mesh" % node.get("name"))
            continue
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            for need in ("POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"):
                if need not in attrs:
                    problems.append("%s: primitive missing %s" % (mesh["name"], need))
            if prim.get("mode", 4) != 4:
                problems.append("%s: primitive is not TRIANGLES" % mesh["name"])
            if "material" in prim:
                mat = g["materials"][prim["material"]]["name"]
                if mat not in SLOTS:
                    problems.append("material %r is not an allowed slot" % mat)
                elif mat not in slots:
                    slots.append(mat)
            else:
                problems.append("%s: primitive has no material" % mesh["name"])
            acc = g["accessors"][attrs["POSITION"]]
            for i in range(3):
                lo[i] = min(lo[i], acc["min"][i] + t[i])
                hi[i] = max(hi[i], acc["max"][i] + t[i])
            for i in range(3):
                nlo[i] = min(nlo[i], acc["min"][i] + t[i])
                nhi[i] = max(nhi[i], acc["max"][i] + t[i])
            if "indices" in prim:
                tris += g["accessors"][prim["indices"]]["count"] // 3
            else:
                tris += acc["count"] // 3

        per_node[node.get("name", "?")] = (nlo, nhi)

    size = [hi[i] - lo[i] for i in range(3)]
    # The footprint is the body's, not the whole bounding box: a crane boom
    # cantilevers 7 m forward and that is not the thing standing on the deck.
    body = per_node.get(name[:-4], next(iter(per_node.values()), ([0]*3, [0]*3)))
    if anchor == "ground":
        if abs(lo[1]) > 0.02:
            problems.append("sits at y=%.3f, not on the ground plane" % lo[1])
        for axis, i in (("x", 0), ("z", 2)):
            mid = (body[0][i] + body[1][i]) / 2.0
            span = body[1][i] - body[0][i]
            if abs(mid) > max(0.05, span * 0.06):
                problems.append("footprint is off-centre in %s by %.2f m"
                                % (axis, mid))
    elif anchor == "hang":
        if hi[1] > 0.02:
            problems.append("hangs from y=%.3f; the origin should be the hook"
                            % hi[1])
    return dict(name=name, tris=tris, size=size, lo=lo,
                slots=[s for s in SLOTS if s in slots], nodes=nodes,
                problems=problems)


def main():
    meta_path = os.path.join(PROPS, "_build_meta.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    ANCHORS.update({k: v.get("anchor", "ground") for k, v in meta.items()})
    files = sorted(f for f in os.listdir(PROPS) if f.endswith(".glb"))
    rows, bad = [], 0
    for f in files:
        r = check(os.path.join(PROPS, f))
        m = meta.get(f, {})
        r["cls"] = m.get("cls", "?")
        r["budget"] = m.get("budget", 0)
        r["note"] = m.get("note", "")
        if r["budget"] and r["tris"] > r["budget"]:
            r["problems"].append("%d tris over the %s budget of %d"
                                 % (r["tris"] - r["budget"], r["cls"], r["budget"]))
        rows.append(r)
        for p in r["problems"]:
            print("FAIL %-30s %s" % (f, p))
            bad += 1
    if not bad:
        print("ok: %d models, no problems" % len(rows))
    write_manifest(rows)
    return 1 if bad else 0


def write_manifest(rows):
    out = [
        "# Prop manifest",
        "",
        "Generated by `tools/props/verify_props.py` from the shipped `.glb` bytes,",
        "not from the build scripts. Rebuild everything with:",
        "",
        "```",
        "/Applications/Blender.app/Contents/MacOS/Blender -b -noaudio \\",
        "    --python tools/props/build_props.py",
        "python3 tools/props/verify_props.py",
        "```",
        "",
        "Sizes are the glTF bounding box in metres, **X x Y x Z** with +Y up and",
        "+Z forward. Every model sits on the ground plane at its footprint centre",
        "unless the notes say otherwise. No node carries a rotation or a scale.",
        "",
        "### One deviation from the brief, on purpose",
        "",
        "The brief asks for non-overlapping UVs. These ship with **metre-scale**",
        "UVs instead: one UV unit is one metre, laid down by oriented planar and",
        "cylindrical projection with V running along the grain. That is uniform",
        "texel density and correct grain direction -- the two things the brief",
        "wanted out of the unwrap -- and it is what `js/textures.js` needs, since",
        "its materials are `RepeatWrapping` with a `repeat` factor and would be",
        "stretched by per-model islands packed into 0..1. Islands do overlap in",
        "UV space; nothing here is baked, so nothing reads it as a fault. Say the",
        "word and I will repack, but the repeat factors would then have to be set",
        "per model instead of once per material.",
        "",
        "### Material slots",
        "",
        "One slot per surface type, named from the list in `MODELS.md`, added",
        "only where a model actually uses it. Three models needed a surface the",
        "list does not cover, and I substituted rather than inventing a slot:",
        "",
        "| Model | Wanted | Shipped as | Why |",
        "|---|---|---|---|",
        "| `berk_house_b.glb` | thatch | `rope` | Thatch is bundled straw; `rope`"
        " is the only fibre slot and reads correctly. |",
        "| `berk_house_a.glb` | turf | `wood_dark` shingles | No slot can be"
        " green, so it got a shingle roof instead of a lie. |",
        "| `kelp.glb` | weed | `hide` | Kelp blades are brown and leathery;"
        " `hide` is the closest read in the list. |",
        "",
        "If you would rather add a `turf` or `weed` slot, say so and these three",
        "are a one-line change each.",
        "",
        "Every model also ships a greyscale `COLOR_0` attribute: cheap contact",
        "darkening near the ground and on downward faces, multiply it in or",
        "ignore it. It is not a baked AO and there is no baked lighting anywhere.",
        "",
        "### Moving parts",
        "",
        "Left as separately named nodes in the same file, origin on the hinge or",
        "axis, no rotation or scale baked into the node:",
        "`rig_cage_large.glb` -> `door` (swings about +Y),",
        "`rig_crane.glb` -> `boom` and `lift`,",
        "`rig_winch.glb` -> `drum` (spins about +X).",
        "",
        "### The models",
        "",
        "| File | Tris | Budget | Size (m) | Slots | Nodes | Notes |",
        "|---|---:|---:|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda r: r["name"]):
        size = " x ".join("%.2f" % v for v in r["size"])
        nodes = ", ".join("`%s`" % n for n in r["nodes"])
        note = r["note"] + ("" if not r["problems"] else
                            "  **" + "; ".join(r["problems"]) + "**")
        out.append("| `%s` | %d | %d | %s | %s | %s | %s |" % (
            r["name"], r["tris"], r["budget"], size,
            ", ".join("`%s`" % s for s in r["slots"]), nodes, note))
    out += ["",
            "Total triangles: **%d** across %d models." %
            (sum(r["tris"] for r in rows), len(rows)), ""]
    with open(os.path.join(PROPS, "MANIFEST.md"), "w") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    sys.exit(main())
