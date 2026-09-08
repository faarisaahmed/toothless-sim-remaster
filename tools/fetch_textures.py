#!/usr/bin/env python3
"""
Pull the terrain's ground textures down from Poly Haven.

Everything here is CC0, which is why Poly Haven and not one of the sites with a
"free with attribution" tier: the game ships these files, so anything that needs
a licence notice in the binary is a licence notice we will forget to ship.

1K is deliberate. These are DETAIL textures — they tile every few metres across
a 10 km terrain, so what matters is that four of them fit in cache together, not
that any one of them is sharp. 2K quadruples the memory for detail nobody sees
past about six metres.

    python3 tools/fetch_textures.py [--force]
"""
import os, sys, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "assets", "textures")
BASE = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{s}/{s}_{m}_1k.jpg"
# Poly Haven names the albedo `diff` on most assets and `col` on some of the
# older ones. Ask for whichever exists rather than hardcoding one and getting a
# 404 that looks like the asset is gone.
ALBEDO_ALIASES = ["diff", "col"]

# slug -> maps to pull. `nor_gl` is OpenGL-convention (green up), which is what
# three.js wants; `nor_dx` would come out with the lighting inverted on every
# bump and it is genuinely hard to see until you look at a single rock.
WANTED = {
    "rock_face_03":     ["diff", "nor_gl", "arm"],   # the cliffs. Stratified grey basalt.
    "aerial_rocks_04":  ["diff", "nor_gl"],          # bare ground and scree, seen from above
    "aerial_grass_rock":["diff", "nor_gl"],          # the green. Authored for aerial views.
    "forrest_ground_01":["diff", "nor_gl"],          # under the trees
    "coast_sand_05":    ["diff", "nor_gl"],          # beaches and the wet band below them
    "snow_field_aerial":["diff", "nor_gl"],          # summits
}

def main():
    force = "--force" in sys.argv
    os.makedirs(ROOT, exist_ok=True)
    ok = bad = 0
    for slug, maps in WANTED.items():
        for m in maps:
            out = os.path.join(ROOT, f"{slug}_{m}.jpg")
            if os.path.exists(out) and not force:
                print(f"  have {os.path.basename(out)}")
                ok += 1
                continue
            names = ALBEDO_ALIASES if m == "diff" else [m]
            data = None
            for name in names:
                url = BASE.format(s=slug, m=name)
                try:
                    with urllib.request.urlopen(url, timeout=120) as r:
                        data = r.read()
                    break
                except urllib.error.HTTPError as e:
                    last = f"HTTP {e.code}  {url}"
            if data is None:
                print(f"  MISS {slug}_{m}: {last}")
                bad += 1
                continue
            with open(out, "wb") as f:
                f.write(data)
            print(f"  got  {os.path.basename(out)}  {len(data)/1e6:.2f} MB")
            ok += 1
    print(f"\n{ok} file(s) in {ROOT}" + (f", {bad} missing" if bad else ""))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
