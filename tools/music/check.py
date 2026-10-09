#!/usr/bin/env python3
"""
Objective checks on the built soundtrack, since nobody can listen from here.

    python3 tools/music/check.py                      the six shipped mp3s
    python3 tools/music/check.py --dir some/folder    the same names, elsewhere
    python3 tools/music/check.py --json out.json      also write the numbers

Per file: integrated loudness, loudness range and true peak (ffmpeg ebur128),
spectral centroid and 85% roll-off, the share of energy below 120 Hz and above
6 kHz, crest factor, clipped samples, and the loop seam: the file holds the
same music either side of js/audio.js's `to`, so the decoded audio from `to`
onwards is compared sample for sample with the audio from 0, and the jump
itself (last sample before `to` against the first after the wrap) is checked
for a step.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SR = 44100


def loops_from_js():
    txt = open(os.path.join(ROOT, "js", "audio.js")).read()
    out = {}
    for m in re.finditer(r'file:\s*"([^"]+)".*?from:\s*([\d.]+),\s*to:\s*([\d.]+)', txt):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return out


def decode(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def ebur(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    t = r.stderr
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", t)[-1])
    lra = float(re.findall(r"LRA:\s+(-?[\d.]+) LU", t)[-1])
    tp = re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", t)
    return i, lra, float(tp[-1])


def spectral(x):
    m = x.mean(1)
    n = 4096
    hop = 2048
    win = np.hanning(n)
    frames = np.lib.stride_tricks.sliding_window_view(m, n)[::hop] * win
    P = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    e = P.sum(1)
    keep = e > e.max() * 1e-4
    P, e = P[keep], e[keep]
    cent = (P * f).sum(1) / e
    centroid = float((cent * e).sum() / e.sum())
    tot = P.sum(0)
    c = np.cumsum(tot) / tot.sum()
    rolloff = float(f[np.searchsorted(c, 0.85)])
    low = float(tot[f < 120].sum() / tot.sum())
    high = float(tot[f > 6000].sum() / tot.sum())
    return centroid, rolloff, low, high


def seam(x, frm, to):
    """Compare what plays after the jump with what would have played without it."""
    a = int(round(frm * SR))
    b = int(round(to * SR))
    pad = len(x) - b
    n = min(pad, int(1.2 * SR))
    post = x[b:b + n]          # the music past `to` in the file
    wrap = x[a:a + n]          # what the loop actually plays instead
    diff = post - wrap
    ref = np.sqrt((post ** 2).mean()) + 1e-12
    resid_db = 20 * np.log10(np.sqrt((diff ** 2).mean()) / ref + 1e-12)
    # the step at the splice: last sample before `to`, then the first after `from`,
    # against the typical sample-to-sample change at that point
    step = np.abs(x[a] - x[b - 1]).max()
    typical = np.abs(np.diff(x[b - 64:b + 64], axis=0)).max()
    # a click is broadband: high-pass what the splice adds to the music
    # (spliced minus natural continuation) and compare its peak, in the 20 ms
    # after the jump, with the music's own level there
    from scipy.signal import butter, sosfilt
    sos = butter(4, 3000, "high", fs=SR, output="sos")
    N = int(0.1 * SR)
    natural = x[b - N:b + N]
    spliced = np.concatenate([x[b - N:b], x[a:a + N]])
    d = sosfilt(sos, spliced - natural, axis=0)[N:N + int(0.02 * SR)]
    lvl = np.sqrt((natural ** 2).mean()) + 1e-12
    click_db = 20 * np.log10(np.abs(d).max() / lvl + 1e-12)
    return dict(resid_db=round(float(resid_db), 1), step=round(float(step), 4),
                typical_step=round(float(typical), 4), click_db=round(float(click_db), 1),
                pad_s=round(pad / SR, 3))


def check_wav(path, loop_s):
    """The master before encoding: the loop must repeat sample for sample."""
    from scipy.io import wavfile
    _, x = wavfile.read(path)
    x = x.astype(np.float64)
    L = int(round(loop_s * SR))
    n = len(x) - L
    d = np.abs(x[L:L + n] - x[:n]).max()
    peak = np.abs(x).max()
    return dict(max_diff=float(d), peak_dbfs=round(float(20 * np.log10(peak)), 2), pad_s=round(n / SR, 3))


def check(path, frm, to):
    x = decode(path)
    i, lra, tp = ebur(path)
    cen, roll, low, high = spectral(x)
    rms = np.sqrt((x ** 2).mean())
    peak = np.abs(x).max()
    return dict(
        file=os.path.basename(path), length_s=round(len(x) / SR, 3),
        lufs=i, lra=lra, true_peak=tp,
        centroid_hz=round(cen), rolloff85_hz=round(roll),
        low_share=round(low, 3), high_share=round(high, 4),
        crest_db=round(float(20 * np.log10(peak / rms)), 1),
        clipped=int((np.abs(x) >= 0.999).sum()),
        size_kb=os.path.getsize(path) // 1024,
        seam=seam(x, frm, to),
    )


def main(args):
    d = os.path.join(ROOT, "assets", "audio", "music")
    if "--dir" in args:
        d = args[args.index("--dir") + 1]
    loops = loops_from_js()
    out = {}
    for f, (frm, to) in loops.items():
        p = os.path.join(d, f)
        if not os.path.exists(p):
            continue
        r = check(p, frm, to)
        out[f] = r
        s = r["seam"]
        print(f"{f:22s} {r['lufs']:6.1f} LUFS  LRA {r['lra']:4.1f}  TP {r['true_peak']:5.1f}  "
              f"cent {r['centroid_hz']:5d}  roll {r['rolloff85_hz']:5d}  low {r['low_share']:.2f}  "
              f"hi {r['high_share']:.3f}  crest {r['crest_db']:4.1f}  clip {r['clipped']}  "
              f"seam {s['resid_db']} dB click {s['click_db']} dB  {r['size_kb']} KB")
    # the pre-encode masters build.py keeps in _work/
    names = {"emberwing-title.mp3": "title", "the-hearth.mp3": "prologue", "emberwing-flight.mp3": "flight",
             "emberwing-jig.mp3": "flatout", "emberwing-raid.mp3": "raid", "held-breath.mp3": "tension"}
    if "--dir" not in args:
        for f, (frm, to) in loops.items():
            w = os.path.join(HERE, "_work", f"{names.get(f, f)}-final-keep.wav")
            if os.path.exists(w):
                r = check_wav(w, to - frm)
                out.setdefault(f, {})["wav"] = r
                print(f"{f:22s} master wav: loop repeats with max sample difference {r['max_diff']:.1e} "
                      f"over {r['pad_s']} s, sample peak {r['peak_dbfs']} dBFS")
    if "--json" in args:
        json.dump(out, open(args[args.index("--json") + 1], "w"), indent=2)


if __name__ == "__main__":
    main(sys.argv[1:])
