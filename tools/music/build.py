#!/usr/bin/env python3
"""
Build the game's soundtrack from source.

    python3 tools/music/build.py              all six tracks
    python3 tools/music/build.py flight raid  just those
    python3 tools/music/build.py --solo       the two themes alone, dry, into
                                              tools/music/_work/ (for checking
                                              a melody without the band)

Writes assets/audio/music/<file>.mp3 and prints each track's loop length and
loudness; the loop lengths are what js/audio.js's TRACKS `to` values must be.

Needs: python3 with mido, numpy, scipy (pip3 install --user mido numpy scipy),
fluidsynth and ffmpeg with libmp3lame (brew install fluid-synth ffmpeg), and
the GeneralUser GS soundfont at tools/music/GeneralUser-GS.sf2 — 32 MB, so it
is not committed. This script fetches it on first run from S. Christian
Collins' GeneralUser GS repository (https://github.com/mrbumpy409/GeneralUser-GS,
GeneralUser GS License v2.0: free to use for any music, no attribution required).

The music itself is in score.py; the performance and mixing in engine.py.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "assets", "audio", "music")
SF2_URL = "https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2"

import engine  # noqa: E402
import score   # noqa: E402

FILES = {
    "title": "emberwing-title.mp3",
    "prologue": "the-hearth.mp3",
    "flight": "emberwing-flight.mp3",
    "flatout": "emberwing-jig.mp3",
    "raid": "emberwing-raid.mp3",
    "tension": "held-breath.mp3",
}


def fetch_soundfont():
    if os.path.exists(engine.SF2):
        return
    print("fetching GeneralUser GS soundfont (32 MB)...")
    subprocess.run(["curl", "-fL", "-o", engine.SF2, SF2_URL], check=True)


def solo():
    """Each theme on one instrument, nothing else."""
    s = engine.Song("solo-emberwing", bar=6, beat=3, spe=0.33, seed=3)
    s.part("whistle")
    score.theme(s, "whistle", 0, ornate=True, vel=86, legato=1.0)
    s.finish(16)
    engine.solo_preview(s, "whistle", os.path.join(engine.WORK, "solo-emberwing.wav"))
    h = engine.Song("solo-hearth", bar=6, beat=2, spe=0.37, seed=3)
    h.part("fiddle")
    b = 0
    for line in (score.L1o, score.L2o, score.L3o, score.L4o):
        b = h.mel("fiddle", b, line, vel=80, legato=1.0)
    h.finish(16)
    engine.solo_preview(h, "fiddle", os.path.join(engine.WORK, "solo-hearth.wav"))
    print("wrote", engine.WORK + "/solo-*.wav")


def main(args):
    fetch_soundfont()
    os.makedirs(engine.WORK, exist_ok=True)
    if "--solo" in args:
        return solo()
    names = [a for a in args if not a.startswith("-")] or list(score.TRACKS)
    stats_path = os.path.join(engine.WORK, "stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    for name in names:
        song = score.TRACKS[name]()
        out = os.path.join(OUT, FILES[name])
        print(f"{name}: {len(song.parts)} parts, loop {song.length:.2f}s ...", flush=True)
        st = engine.render(song, out, target_lufs=song.target)
        stats[name] = st
        print(f"  -> {st['file']}  loop {st['loop']}s  file {st['length']}s  "
              f"{st['lufs']} LUFS  LRA {st['lra']}  peak {st['peak']} dBFS\n     stems {st['stems']}")
    json.dump(stats, open(stats_path, "w"), indent=2)


if __name__ == "__main__":
    main(sys.argv[1:])
