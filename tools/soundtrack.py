#!/usr/bin/env python3
"""
Where is the good bit?

A film score is written to a scene, so the useful part of a cue is usually not
at the start: the fast Viking theme in This Is Berk does not begin until 1:05,
and Test Drive spends its first eighty seconds building. Dropping a track in at
0:00 for a moment that wants the big tune gets you the quiet introduction to it
instead — which is what js/audio.js's from/to windows exist to avoid, and this
is how their numbers were chosen rather than guessed.

It decodes each file to mono 8 kHz through ffmpeg and prints RMS per five-second
bucket. Loudness is a crude proxy for "exciting" and a very good one for film
score, because the orchestration is what carries the intensity.

    python3 tools/soundtrack.py                 every track it can find
    python3 tools/soundtrack.py path/to.mp3     one file
"""
import array, math, os, subprocess, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [os.path.join(ROOT, "assets", "audio", "official_music"),
        os.path.join(ROOT, "assets", "audio", "music")]
BUCKET = 5           # seconds
SR = 8000            # plenty for an energy envelope


def profile(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True).stdout
    d = array.array("h")
    d.frombytes(raw[: len(raw) // 2 * 2])
    if not d:
        return None
    rows, w = [], SR * BUCKET
    for i in range(0, len(d), w):
        seg = d[i:i + w]
        if len(seg) < w // 2:
            break
        rms = math.sqrt(sum(float(x) * x for x in seg) / len(seg))
        rows.append((i // SR, rms))
    return rows


def show(path):
    rows = profile(path)
    name = os.path.basename(path)
    name = name.split(" (From")[0].rsplit(".", 1)[0]
    if not rows:
        print(f"\n=== {name}\n  could not decode")
        return
    peak = max(r for _, r in rows) or 1
    # The loudest run of buckets, which is the answer this is for.
    best_i, best = 0, -1
    span = max(1, 60 // BUCKET)
    for i in range(len(rows) - span + 1):
        m = sum(r for _, r in rows[i:i + span]) / span
        if m > best:
            best, best_i = m, i
    print(f"\n=== {name}   {rows[-1][0] + BUCKET}s")
    for t, r in rows:
        db = 20 * math.log10(max(r, 1) / 32768)
        bar = "#" * int(r / peak * 40)
        star = " <" if best_i <= rows.index((t, r)) < best_i + span else ""
        print(f"  {t // 60}:{t % 60:02d}  {bar:<40} {db:6.1f} dB{star}")
    a = rows[best_i][0]
    print(f"  loudest {span * BUCKET}s: {a // 60}:{a % 60:02d} to "
          f"{(a + span * BUCKET) // 60}:{(a + span * BUCKET) % 60:02d}"
          f"   -> from: {a}, to: {a + span * BUCKET}")


args = sys.argv[1:]
files = args or [f for d in DIRS for f in sorted(glob.glob(os.path.join(d, "*.mp3")))]
if not files:
    print("no audio found — put the score in assets/audio/official_music/")
for f in files:
    show(f)
