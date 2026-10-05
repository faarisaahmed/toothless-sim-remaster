#!/usr/bin/env python3
"""
The night sky: every naked-eye star, from the Yale Bright Star Catalogue.

    python3 tools/sky/build_stars.py [bsc5-short.json]

Downloads the catalogue if no path is given (public domain, NASA ADC, as
packaged at github.com/brettonw/YaleBrightStarCatalog) and writes
assets/data/stars.bin, which js/stars.js reads:

    uint32  count
    count x { int16 x, int16 y, int16 z,   unit vector in EQUATORIAL axes
                                            (x to RA 0h, z to the north
                                            celestial pole), scaled by 32767
              uint8 mag,                    visual magnitude, (V + 2) * 25
              uint8 temp }                  effective temperature, K / 100

Everything to magnitude 6.3 — what a dark sky shows a good eye — which is
about 5,000 stars and 40 KB. That is the real sky: the Plough, Cassiopeia,
Orion and the rest are where they are because they are.
"""
import json, math, os, struct, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "assets", "data", "stars.bin")
URL = "https://raw.githubusercontent.com/brettonw/YaleBrightStarCatalog/master/bsc5-short.json"
LIMIT = 6.3


def ra_rad(s):
    h, m, sec = s.replace("h", " ").replace("m", " ").replace("s", " ").split()
    return (float(h) + float(m) / 60 + float(sec) / 3600) * math.pi / 12


def dec_rad(s):
    sign = -1 if s.strip().startswith("-") else 1
    s = s.strip().lstrip("+-")
    d, m, sec = s.replace("°", " ").replace("′", " ").replace("″", " ").split()
    return sign * (float(d) + float(m) / 60 + float(sec) / 3600) * math.pi / 180


def main():
    if len(sys.argv) > 1:
        data = json.load(open(sys.argv[1]))
    else:
        data = json.load(urllib.request.urlopen(URL, timeout=60))
    out = []
    for st in data:
        try:
            v = float(st["V"])
            ra, dec = ra_rad(st["RA"]), dec_rad(st["Dec"])
        except (KeyError, ValueError):
            continue
        if v > LIMIT:
            continue
        k = float(st.get("K") or 6000)
        x, y, z = math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)
        out.append((round(x * 32767), round(y * 32767), round(z * 32767),
                    max(0, min(255, round((v + 2) * 25))), max(0, min(255, round(k / 100)))))
    out.sort(key=lambda s: s[3])          # brightest first
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(struct.pack("<I", len(out)))
        for s in out:
            fh.write(struct.pack("<hhhBB", *s))
    print(f"{len(out)} stars to V {LIMIT} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


main()
