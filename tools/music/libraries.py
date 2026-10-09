"""
The sample libraries the soundtrack is played on, and how to fetch them.

Both are public-domain (CC0 1.0) recordings by Sam Gossner / Versilian Studios:

  VSCO 2 Community Edition  https://github.com/sgossner/VSCO-2-CE
      the orchestra: solo violin, violin/viola/cello sections, solo double
      bass, F horn, trumpet, trombone, tuba, flute, timpani, bass drum.
  Versilian Community Sample Library (VCSL)  https://github.com/sgossner/VCSL
      the folk colours: baroque recorders (the whistle), folk harp, frame drum
      (the bodhran), strumstick, plucked psaltery (the dulcimer), tambourine,
      wine glasses, concert bass drum.

Only the folders below are fetched (about 1.2 GB of WAV), each pinned to a
commit so a rebuild plays the same samples. They land in tools/music/samples/,
which is git-ignored. The files are plain WAV audio: nothing in them is run.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "samples")

LIBS = {
    "vsco": dict(repo="sgossner/VSCO-2-CE", sha="440300901dfe9275fd84e0b7763af1f8443ae62e", folders=[
        "Strings/Solo Violin/Arco Vib",
        "Strings/Solo Violin/spic",
        "Strings/Violin Section/susVib",
        "Strings/Violin Section/Spic",
        "Strings/Violin Section/Trem",
        "Strings/Violin Section/Pizz",
        "Strings/Viola Section/susvib",
        "Strings/Viola Section/spic",
        "Strings/Viola Section/trem",
        "Strings/Cello Section/susvib",
        "Strings/Cello Section/spic",
        "Strings/Cello Section/trem",
        "Strings/Cello Section/pizzT",
        "Strings/Solo Contrabass/SusVib",
        "Strings/Solo Contrabass/SusNV",
        "Strings/Solo Contrabass/Spic",
        "Strings/Solo Contrabass/Pizz",
        "Brass/F Horn/sus",
        "Brass/Trumpet/sus",
        "Brass/Tenor Trombone/sus",
        "Brass/Tuba/sus",
        "Woodwinds/Flute/susvib",
        "Percussion/Timpani",          # hits only: the Rolls subfolder is skipped
        "VSCO 1 Percussion/drums/bass",
    ], skip=["Percussion/Timpani/Rolls"]),
    "vcsl": dict(repo="sgossner/VCSL", sha="c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e", folders=[
        "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/Sustain",
        "Aerophones/Edge-blown Aerophones/Baroque Soprano Recorder/Sustain",
        "Aerophones/Edge-blown Aerophones/Baroque Tenor Recorder/Sustain",
        "Chordophones/Composite Chordophones/Folk Harp",
        "Chordophones/Composite Chordophones/Strumstick",
        "Chordophones/Zithers/Psaltery, Bowed and Plucked/Pluck",
        "Membranophones/Struck Membranophones/Frame Drum",
        "Membranophones/Struck Membranophones/Bass Drum 2",
        "Idiophones/Struck Idiophones/Tambourine 1",
        "Idiophones/Friction Idiophones/Wine Glasses/Sustains",
    ], skip=[]),
}


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "night-alone-music-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def wanted(lib):
    """(path in repo, size) for every WAV under the library's folders."""
    cfg = LIBS[lib]
    cache = os.path.join(SAMPLES, lib, ".tree.json")
    if os.path.exists(cache):
        tree = json.load(open(cache))
    else:
        url = f"https://api.github.com/repos/{cfg['repo']}/git/trees/{cfg['sha']}?recursive=1"
        tree = json.loads(_get(url))["tree"]
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        json.dump(tree, open(cache, "w"))
    out = []
    for e in tree:
        p = e["path"]
        if e["type"] != "blob" or not p.lower().endswith(".wav"):
            continue
        if any(p.startswith(f + "/") for f in cfg["folders"]) and \
                not any(p.startswith(s + "/") for s in cfg["skip"]):
            out.append((p, e.get("size", 0)))
    return out


def fetch(verbose=True):
    """Download whatever is missing. Safe to re-run; complete files are kept."""
    jobs = []
    for lib, cfg in LIBS.items():
        for p, size in wanted(lib):
            dst = os.path.join(SAMPLES, lib, p)
            if os.path.exists(dst) and os.path.getsize(dst) == size:
                continue
            url = (f"https://raw.githubusercontent.com/{cfg['repo']}/{cfg['sha']}/"
                   + urllib.parse.quote(p))
            jobs.append((url, dst, size))
    if not jobs:
        return
    if verbose:
        print(f"fetching {len(jobs)} samples ({sum(j[2] for j in jobs) / 1e6:.0f} MB) "
              f"from VSCO 2 CE and VCSL (CC0)...", flush=True)

    def one(job):
        url, dst, size = job
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        data = _get(url)
        if size and len(data) != size:
            raise RuntimeError(f"{url}: got {len(data)} bytes, expected {size}")
        tmp = dst + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dst)

    with ThreadPoolExecutor(8) as ex:
        for i, _ in enumerate(ex.map(one, jobs)):
            if verbose and (i + 1) % 100 == 0:
                print(f"  {i + 1}/{len(jobs)}", flush=True)


if __name__ == "__main__":
    fetch()
    sys.exit(0)
