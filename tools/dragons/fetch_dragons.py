#!/usr/bin/env python3
"""
Download the stand-in dragon models from Sketchfab into assets/models/dragons/_src/.

These are fan uploads of HTTYD species, stand-ins until the game has dragons
of its own. All are CC-BY 4.0 and published with the game, credited in
assets/models/dragons/CREDITS.txt. Only the raw downloads (_src/) are
gitignored; the game falls back to re-coloured Night Fury bodies if the
built models are missing.

    SKETCHFAB_TOKEN=... python3 tools/dragons/fetch_dragons.py

The token is a free Sketchfab account's API token (Settings → Password & API).
It is read from the environment and never written anywhere.
Then build the game-ready versions with tools/dragons/build_dragons.py.
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "assets", "models", "dragons", "_src")

# name -> (sketchfab uid, title, author). All CC-BY on Sketchfab.
MODELS = {
    "stormcutter":   ("95e2d843fee84e25a44e57d80550096e", "baby Stormcutter", "Dragonblue223"),
    "nadder":        ("1aca2b08569f4f7eb9d21ef29aa38ccb", "Deadly Nadder", "witsanusuperball"),
    "gronckle":      ("e63924a7a29242ecb1e2fd8ff05c3368", "Gronckle", "witsanusuperball"),
    "nightmare":     ("5573b2bf120144e5aada7ee0c9a3169d", "adult Monstrous Nightmare", "Dragonblue223"),
    "thunderdrum":   ("6fc65dd3b28944c6b1a9f112d97c1863", "adult Thunderdrum", "Dragonblue223"),
    "zippleback":    ("b4e612e1c56f4e788a2698fd76bb0b18", "Hideous Zippleback", "joeandrollamoso"),
}


def credits_text():
    lines = ["Stand-in dragon models, used under CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
             "Changes: Monstrous Nightmare, Thunderdrum and Zippleback rigged by tools/dragons/build_dragons.py.", ""]
    for name, (uid, title, author) in MODELS.items():
        lines.append(f'{name}: "{title}" by {author}, CC-BY 4.0, https://sketchfab.com/3d-models/{uid}')
    return "\n".join(lines) + "\n"


def main():
    token = os.environ.get("SKETCHFAB_TOKEN")
    if not token:
        print("set SKETCHFAB_TOKEN (sketchfab.com/settings/password)")
        return 1
    os.makedirs(OUT, exist_ok=True)
    for name, (uid, _title, _author) in MODELS.items():
        dst = os.path.join(OUT, name + ".glb")
        if os.path.exists(dst) and "--force" not in sys.argv:
            print("  have", name)
            continue
        req = urllib.request.Request(f"https://api.sketchfab.com/v3/models/{uid}/download",
                                     headers={"Authorization": "Token " + token})
        info = json.load(urllib.request.urlopen(req, timeout=60))
        url = (info.get("glb") or {}).get("url")
        if not url:
            print("  no glb for", name, list(info))
            continue
        with urllib.request.urlopen(url, timeout=300) as r, open(dst, "wb") as fh:
            fh.write(r.read())
        print("  got ", name, os.path.getsize(dst) // 1024, "KB")
    with open(os.path.join(OUT, "..", "CREDITS.txt"), "w") as fh:
        fh.write(credits_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
