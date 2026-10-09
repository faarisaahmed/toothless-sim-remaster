"""
A small sampler for the soundtrack: plays engine.Part note lists on the
recorded instruments in tools/music/samples/ (see libraries.py).

Why not a soundfont player? Because the performance details that make a sample
library sound played are easier to do directly than to coax out of SF2
modulators: choosing a short or long articulation by note length, crossfading
velocity layers, true legato (the next note enters past its attack while the
last one fades under it), a little portamento on fiddle slurs, delayed vibrato
on samples recorded without it, doubling a section with a second, slightly
late and detuned player, and stretching a sustain for a 30-second drone
without an audible loop.

Every part is rendered into one loop-length buffer and wrapped circularly, so
it is exactly periodic: the tail of the last bar sounds over the first, and the
loop seam is sample-identical by construction.

Samples are analysed once (pitch by YIN, the stable body of each sustain,
loudness) and the results cached in _work/sample-analysis.json.
"""
import json
import math
import os
import re
import warnings
import zlib

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly, butter, sosfilt, lfilter

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, "samples")
WORK = os.path.join(HERE, "_work")
ANALYSIS = os.path.join(WORK, "sample-analysis.json")

PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DYN = {"ppp": 1, "pp": 2, "p": 3, "mp": 4, "mf": 5, "f": 6, "ff": 7, "fff": 8}


# ---------------------------------------------------------------------------
# Reading and analysing samples
# ---------------------------------------------------------------------------
def parse_name(fname):
    """Nominal note, dynamic layer rank and round-robin index from a file name."""
    stem = fname.rsplit(".", 1)[0]
    toks = re.split(r"[_ ]", stem)
    note = None
    layer = 0
    rr = 1
    for t in toks:
        m = re.fullmatch(r"([A-G])(#|b)?(-?\d)", t)
        if m and note is None:
            note = PC[m.group(1)] + {"#": 1, "b": -1, None: 0}[m.group(2)] + 12 * (int(m.group(3)) + 1)
            continue
        m = re.fullmatch(r"(?i)(?:v|vl)(\d)", t)
        if m:
            layer = int(m.group(1))
            continue
        if t.lower() in DYN:
            layer = DYN[t.lower()]
            continue
        m = re.fullmatch(r"(?i)rr(\d)", t)
        if m:
            rr = int(m.group(1))
            continue
        if re.fullmatch(r"\d", t):
            rr = int(t)
    if note is None:
        m = re.search(r"([A-G])(#|b)?(-?\d)", stem)
        if m:
            note = PC[m.group(1)] + {"#": 1, "b": -1, None: 0}[m.group(2)] + 12 * (int(m.group(3)) + 1)
    return note, layer, rr


def read(path):
    sr, d = wavfile.read(path)
    if d.dtype == np.int16:
        x = d.astype(np.float32) / 32768.0
    elif d.dtype == np.int32:
        x = d.astype(np.float32) / 2147483648.0
    elif d.dtype == np.uint8:
        x = (d.astype(np.float32) - 128) / 128.0
    else:
        x = d.astype(np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x[:, :2]
    if sr != SR:
        g = math.gcd(SR, sr)
        x = resample_poly(x, SR // g, sr // g, axis=0).astype(np.float32)
    return x


_KW = None


def kweight(m):
    """A close-enough K-weighting (BS.1770): a 60 Hz high-pass and +4 dB above 1.5 kHz."""
    global _KW
    if _KW is None:
        hp = butter(2, 60, "high", fs=SR, output="sos")
        # high shelf as a biquad
        f0, g, q = 1500.0, 4.0, 0.707
        A = 10 ** (g / 40)
        w = 2 * math.pi * f0 / SR
        al = math.sin(w) / (2 * q)
        c = math.cos(w)
        b = [A * ((A + 1) + (A - 1) * c + 2 * math.sqrt(A) * al),
             -2 * A * ((A - 1) + (A + 1) * c),
             A * ((A + 1) + (A - 1) * c - 2 * math.sqrt(A) * al)]
        a = [(A + 1) - (A - 1) * c + 2 * math.sqrt(A) * al,
             2 * ((A - 1) - (A + 1) * c),
             (A + 1) - (A - 1) * c - 2 * math.sqrt(A) * al]
        _KW = (hp, np.array(b) / a[0], np.array(a) / a[0])
    hp, b, a = _KW
    return lfilter(b, a, sosfilt(hp, m))


def yin(m, fmin=30.0, fmax=2500.0, thresh=0.12):
    """Fundamental of a mono frame by YIN, with parabolic refinement."""
    n = len(m)
    tmax = min(int(SR / fmin), n // 2)
    tmin = max(2, int(SR / fmax))
    m = m - m.mean()
    # difference function via FFT autocorrelation
    w = n - tmax
    x = m
    fx = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(fx * np.conj(np.fft.rfft(x[:w], 2 * n)))[:tmax + 1]
    e = np.cumsum(np.concatenate([[0.0], x ** 2]))
    e0 = e[w] - e[0]
    et = e[np.arange(tmax + 1) + w] - e[np.arange(tmax + 1)]
    d = e0 + et - 2 * ac
    d[0] = 0
    cm = np.ones_like(d)
    s = np.cumsum(d[1:])
    cm[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(s, 1e-12)
    tau = None
    for t in range(tmin, tmax - 1):
        if cm[t] < thresh and cm[t] <= cm[t + 1]:
            tau = t
            break
    if tau is None:
        tau = tmin + int(np.argmin(cm[tmin:tmax]))
        if cm[tau] > 0.4:
            return None
    a, b, c = cm[tau - 1], cm[tau], cm[tau + 1]
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
    return SR / (tau + off)


def analyse(path, pitched=True):
    x = read(path)
    m = x.mean(1)
    pk = np.abs(m).max() + 1e-9
    # onset: first point above 2% of peak, less 3 ms
    above = np.nonzero(np.abs(m) > pk * 0.02)[0]
    onset = max(0, int(above[0]) - int(0.003 * SR)) if len(above) else 0
    m = m[onset:]
    hop = 441
    nfr = max(1, len(m) // hop)
    env = np.sqrt(np.mean(m[:nfr * hop].reshape(nfr, hop) ** 2, axis=1) + 1e-12)
    sm = np.convolve(env, np.ones(10) / 10, mode="same")       # 100 ms smoothing
    # the reference level: the 95th percentile, so one knock or bow noise
    # does not pass for the note's full level
    emax = float(np.percentile(sm, 95))
    # time to reach half of the eventual peak: where the attack "speaks"
    speak = int(np.argmax(sm >= 0.5 * emax)) * hop / SR
    # the stable body: after the attack, until the level finally falls away
    a_fr = int(np.argmax(sm >= 0.7 * emax)) + 15
    tail = np.nonzero(sm >= 0.35 * emax)[0]
    b_fr = int(tail[-1]) - 10 if len(tail) else nfr
    body = [a_fr * hop / SR, max(a_fr, b_fr) * hop / SR]
    # loudness, K-weighted RMS: over the body (for sustains) and over the
    # first 0.4 s (for struck and plucked notes)
    km = kweight(m)
    hit = km[:int(0.4 * SR)]
    seg = km[int(body[0] * SR):int(body[1] * SR)] if body[1] - body[0] > 0.6 else hit
    loud = 20 * math.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)
    loud_hit = 20 * math.log10(np.sqrt(np.mean(hit ** 2)) + 1e-12)
    f0 = None
    if pitched:
        # measure in several windows over the body (or just after the attack)
        lo = int(max(0.05, body[0]) * SR)
        hi = int(max(body[1], body[0] + 0.5) * SR)
        hi = min(hi, len(m))
        if hi - lo < 4096:
            lo, hi = int(0.03 * SR), min(len(m), int(0.03 * SR) + 8192)
        ests = []
        for k in range(5):
            s = lo + (hi - lo - 4096) * k // 5 if hi - lo > 4096 else lo
            fr = m[s:s + 4096]
            if len(fr) < 4096:
                continue
            f = yin(fr)
            if f:
                ests.append(69 + 12 * math.log2(f / 440.0))
        if ests:
            f0 = float(np.median(ests))
    return dict(onset=onset, speak=round(speak, 4), body=[round(body[0], 3), round(body[1], 3)],
                length=round(len(m) / SR, 3), loud=round(loud, 2), loud_hit=round(loud_hit, 2), f0=f0)


def analysis_db():
    if os.path.exists(ANALYSIS):
        return json.load(open(ANALYSIS))
    return {}


def analyse_all(paths, pitched):
    db = analysis_db()
    changed = False
    for p in paths:
        key = os.path.relpath(p, SAMPLES)
        if key not in db:
            db[key] = analyse(p, pitched)
            changed = True
    if changed:
        os.makedirs(WORK, exist_ok=True)
        json.dump(db, open(ANALYSIS, "w"), indent=0)
    return db


# ---------------------------------------------------------------------------
# Zones and sources
# ---------------------------------------------------------------------------
_DATA = {}


def data(path):
    """The sample, trimmed to its onset, cached in memory for the current track."""
    if path not in _DATA:
        a = analysis_db()[os.path.relpath(path, SAMPLES)]
        _DATA[path] = read(path)[a["onset"]:]
    return _DATA[path]


def forget():
    _DATA.clear()


class Zone:
    __slots__ = ("path", "root", "layer", "rr", "norm", "norm_hit", "body", "length", "speak", "gain")

    def __init__(self, path, root, layer, rr, loud, loud_hit, body, length, speak, gain):
        self.path, self.root, self.layer, self.rr = path, root, layer, rr
        # every zone to -20 dB K-RMS: over its body if sustained, its first 0.4 s if struck
        self.norm = 10 ** ((-20.0 - loud) / 20)
        self.norm_hit = 10 ** ((-20.0 - loud_hit) / 20)
        self.body, self.length, self.speak, self.gain = body, length, speak, gain


class Source:
    """One folder of samples, filtered, mapped to keys by detected pitch.

    match/exclude: regexes on the file name. keys: the range this source plays
    (with `fade` semitones of crossfade into a neighbouring source). root:
    force one root for unpitched hits. layer_map: remap raw layer ranks."""

    def __init__(self, folder, match=None, exclude=None, keys=(0, 127), fade=0, pitched=True,
                 root=None, gain=0.0, layer_map=None):
        self.folder, self.keys, self.fade, self.gain = folder, keys, fade, gain
        self.match, self.exclude, self.pitched, self.fixed_root = match, exclude, pitched, root
        self.layer_map = layer_map
        self._zones = None

    def zones(self):
        if self._zones is not None:
            return self._zones
        d = os.path.join(SAMPLES, self.folder)
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(".wav"))
        if self.match:
            files = [f for f in files if re.search(self.match, f)]
        if self.exclude:
            files = [f for f in files if not re.search(self.exclude, f)]
        if not files:
            raise SystemExit(f"sampler: no samples in {self.folder} matching {self.match}")
        paths = [os.path.join(d, f) for f in files]
        db = analyse_all(paths, self.pitched)
        rows = []
        for p, f in zip(paths, files):
            a = db[os.path.relpath(p, SAMPLES)]
            nom, layer, rr = parse_name(f)
            if self.layer_map:
                layer = self.layer_map.get(layer, layer)
            rows.append((p, nom, a, layer, rr))
        # the folder's naming offset: the most common octave between name and pitch
        offs = {}
        for p, nom, a, _, _ in rows:
            if nom is not None and a["f0"] is not None:
                o = int(round((a["f0"] - nom) / 12)) * 12
                offs[o] = offs.get(o, 0) + 1
        off = max(offs, key=offs.get) if offs else 0
        zs = []
        for p, nom, a, layer, rr in rows:
            if self.fixed_root is not None:
                root = float(self.fixed_root)
            elif nom is None:
                root = a["f0"] if a["f0"] is not None else 60.0
            else:
                root = float(nom + off)
                if a["f0"] is not None and abs(a["f0"] - root) < 0.6:
                    root = a["f0"]           # fine tuning, as measured
            zs.append(Zone(p, root, layer, rr, a["loud"], a["loud_hit"], a["body"], a["length"], a["speak"], self.gain))
        self._zones = zs
        return zs

    def weight(self, pitch):
        lo, hi = self.keys
        if lo <= pitch <= hi:
            return 1.0
        if self.fade <= 0:
            return 0.0
        dist = (lo - pitch) if pitch < lo else (pitch - hi)
        return max(0.0, 1.0 - dist / self.fade)


def pick(src, pitch, vel, rng, vel_range=(30, 118), blend=True):
    """Zones to play for one note: the nearest root in the two velocity
    layers either side of `vel`, with equal-power weights. Without `blend`
    (a struck or plucked note is one stroke, and two strokes summed smear the
    attack) one of the two layers is chosen, the nearer the likelier."""
    zs = src.zones()
    layers = sorted({z.layer for z in zs})
    if len(layers) == 1:
        c = 0.0
    else:
        lo, hi = vel_range
        c = (min(max(vel, lo), hi) - lo) / (hi - lo) * (len(layers) - 1)
    i0 = int(math.floor(c))
    i1 = min(i0 + 1, len(layers) - 1)
    f = c - i0
    if not blend:
        i0 = i1 if rng.random() < f else i0
        i1, f = i0, 0.0
    out = []
    for li, w in ((i0, math.cos(f * math.pi / 2)), (i1, math.sin(f * math.pi / 2))):
        if w < 0.05 or (li == i1 and i1 == i0 and out):
            continue
        cand = [z for z in zs if z.layer == layers[li]]
        best = min(abs(z.root - pitch) for z in cand)
        near = [z for z in cand if abs(z.root - pitch) <= best + 0.35]
        # a layer may be sparsely sampled; borrow from any layer if it is far off
        if best > 4.5:
            near = [z for z in zs if abs(z.root - pitch) <= min(abs(y.root - pitch) for y in zs) + 0.35]
        out.append((near[rng.integers(len(near))], w))
    return out


# ---------------------------------------------------------------------------
# Patches: how each instrument of engine.INSTR is played on the samples
# ---------------------------------------------------------------------------
class Voice:
    """One player (or section) inside a patch."""

    def __init__(self, arts, gain=0.0, cents=0.0, delay=0.0, pan=0.0, timing=0.0, vel=0.0, width=1.0):
        self.arts = arts            # {"sus": [Source], "short": [Source], ...}
        self.gain, self.cents, self.delay, self.pan = gain, cents, delay, pan
        self.timing, self.vel, self.width = timing, vel, width


class Patch:
    def __init__(self, voices, kind="sus", rel=0.3, short_below=0.0, legato=False, glide=0.0,
                 glide_ms=60, vib=None, intonation=0.0, skip=0.0, legato_skip=0.12, preshift=0.05,
                 max_len=None, kit=None, vel_range=(30, 118), sf2_layer=None, track=1.0):
        self.track = track            # how far a hit follows the written pitch (1 = fully)
        self.voices, self.kind, self.rel, self.short_below = voices, kind, rel, short_below
        self.legato, self.glide, self.glide_ms, self.vib = legato, glide, glide_ms, vib
        self.intonation, self.skip, self.legato_skip, self.preshift = intonation, skip, legato_skip, preshift
        self.max_len, self.kit, self.vel_range = max_len, kit, vel_range
        self.sf2_layer = sf2_layer    # dB: also play the part on its GeneralUser preset, this much lower


V = "vsco/"
C = "vcsl/"
VLN = V + "Strings/Violin Section/"
VLA = V + "Strings/Viola Section/"
VC = V + "Strings/Cello Section/"
CB = V + "Strings/Solo Contrabass/"
REC = C + "Aerophones/Edge-blown Aerophones/"
FRAME = C + "Membranophones/Struck Membranophones/Frame Drum"


def _horn():
    return {"sus": [Source(V + "Brass/F Horn/sus")]}


PATCHES = {
    # --- folk soloists ------------------------------------------------------
    # The whistle: baroque recorders, the closest recorded relative of a low
    # whistle: tenor for the bottom notes, alto through the middle, soprano on top.
    "whistle": Patch([Voice({"sus": [
        Source(REC + "Baroque Tenor Recorder/Sustain", keys=(0, 64)),
        Source(REC + "Baroque Alto Recorder/Sustain", keys=(65, 83)),
        Source(REC + "Baroque Soprano Recorder/Sustain", keys=(84, 127))]}, width=0.6)],
        rel=0.12, legato=True, legato_skip=0.06, vib=dict(depth=24, rate=5.4), intonation=3.0,
        skip=0.03, preshift=0.02),
    "flute": Patch([Voice({"sus": [Source(V + "Woodwinds/Flute/susvib")]}, width=0.6)],
                   rel=0.18, legato=True, legato_skip=0.08, skip=0.03),
    # The fiddle: a solo violin, very short notes spiccato, slurs played legato
    # with the odd small slide, as a fiddler would.
    "fiddle": Patch([Voice({"sus": [Source(V + "Strings/Solo Violin/Arco Vib")],
                            "short": [Source(V + "Strings/Solo Violin/spic")]}, width=0.55)],
                    rel=0.2, short_below=0.11, legato=True, glide=0.3, glide_ms=55, intonation=4.0,
                    skip=0.09, legato_skip=0.14, preshift=0.04, vel_range=(40, 110)),
    "violin": Patch([Voice({"sus": [Source(V + "Strings/Solo Violin/Arco Vib")],
                            "short": [Source(V + "Strings/Solo Violin/spic")]}, width=0.55)],
                    rel=0.25, short_below=0.11, legato=True, glide=0.2, skip=0.09, legato_skip=0.14,
                    vel_range=(40, 110)),
    # --- brass --------------------------------------------------------------
    "horn": Patch([Voice(_horn(), width=0.7)], rel=0.3, legato=True, legato_skip=0.1, skip=0.06,
                  intonation=2.0),
    # a section of two: the second player a hair late, a few cents apart
    "horns": Patch([Voice(_horn(), pan=-0.08, width=0.8),
                    Voice(_horn(), gain=-1.5, cents=6, delay=0.014, pan=0.1, timing=0.006, vel=-4, width=0.8)],
                   rel=0.3, legato=True, legato_skip=0.1, skip=0.06),
    "brass": Patch([Voice({"sus": [Source(V + "Brass/Trumpet/sus")]}, pan=0.1, width=0.7),
                    Voice(_horn(), gain=-2.0, delay=0.008, pan=-0.12, timing=0.005, width=0.8)],
                   rel=0.25, skip=0.09),
    "trombone": Patch([Voice({"sus": [Source(V + "Brass/Tenor Trombone/sus")]}, width=0.7),
                       Voice({"sus": [Source(V + "Brass/Tenor Trombone/sus")]}, gain=-2.0, cents=-5,
                             delay=0.012, pan=0.1, timing=0.005, vel=-4, width=0.7)],
                      rel=0.28, legato=True, skip=0.05),
    "tuba": Patch([Voice({"sus": [Source(V + "Brass/Tuba/sus")]}, width=0.6)], rel=0.3, skip=0.06),
    # --- strings --------------------------------------------------------------
    # The section by register: cellos, violas, violins, seated left to right
    # the other way round, as an orchestra sits.
    "strings": Patch([
        Voice({"sus": [Source(VC + "susvib", keys=(0, 52), fade=4)],
               "short": [Source(VC + "spic", keys=(0, 52), fade=4)]}, pan=0.32),
        Voice({"sus": [Source(VLA + "susvib", keys=(53, 59), fade=4)],
               "short": [Source(VLA + "spic", keys=(53, 59), fade=4)]}, pan=0.12),
        Voice({"sus": [Source(VLN + "susVib", keys=(60, 127), fade=4)],
               "short": [Source(VLN + "Spic", keys=(60, 127), fade=4)]}, pan=-0.3)],
        rel=0.45, short_below=0.16, preshift=0.06),
    # The melodic section: violins (violas below G3), with a solo violin inside
    # it for an edge.
    "fstrings": Patch([
        Voice({"sus": [Source(VLN + "susVib", keys=(55, 127)), Source(VLA + "susvib", keys=(0, 54))],
               "short": [Source(VLN + "Spic", keys=(55, 127)), Source(VLA + "spic", keys=(0, 54))]}),
        Voice({"sus": [Source(V + "Strings/Solo Violin/Arco Vib", keys=(55, 127))],
               "short": [Source(V + "Strings/Solo Violin/spic", keys=(55, 127))]},
              gain=-9.0, pan=0.08, width=0.5, timing=0.006)],
        rel=0.3, short_below=0.16, legato=True, glide=0.15, skip=0.16, legato_skip=0.18, preshift=0.06),
    "trem": Patch([
        Voice({"sus": [Source(VC + "trem", keys=(0, 52), fade=4)]}, pan=0.3),
        Voice({"sus": [Source(VLA + "trem", keys=(53, 59), fade=4)]}, pan=0.1),
        Voice({"sus": [Source(VLN + "Trem", keys=(60, 127), fade=4)]}, pan=-0.3)],
        rel=0.4, preshift=0.04),
    "cello": Patch([Voice({"sus": [Source(VC + "susvib")], "short": [Source(VC + "spic")]}, width=0.8)],
                   rel=0.35, short_below=0.2, skip=0.12, preshift=0.05),
    "contrabass": Patch([Voice({"sus": [Source(CB + "SusVib")], "short": [Source(CB + "Spic")]}, width=0.6)],
                        rel=0.4, short_below=0.2, skip=0.1, preshift=0.05),
    "pizz": Patch([Voice({"sus": [Source(VC + "pizzT", keys=(0, 55), fade=3),
                                  Source(VLN + "Pizz", keys=(56, 127), fade=3)]})],
                  kind="pluck", rel=0.4, preshift=0.0),
    # --- plucked --------------------------------------------------------------
    "harp": Patch([Voice({"sus": [Source(C + "Chordophones/Composite Chordophones/Folk Harp")]}, width=0.9)],
                  kind="pluck", rel=0.7, preshift=0.0, intonation=1.5),
    "dulcimer": Patch([Voice({"sus": [Source(C + "Chordophones/Zithers/Psaltery, Bowed and Plucked/Pluck")]},
                             width=0.8)], kind="pluck", rel=1.2, preshift=0.0),
    "guitar": Patch([Voice({"sus": [Source(C + "Chordophones/Composite Chordophones/Strumstick/Finger")]},
                           width=0.8)], kind="pluck", rel=0.35, preshift=0.0),
    # --- glass: the real wine glasses with the soundfont's bowed glass under them
    "glass": Patch([Voice({"sus": [Source(C + "Idiophones/Friction Idiophones/Wine Glasses/Sustains/Slow")]})],
                   rel=1.0, preshift=0.0, sf2_layer=-4.0),
    # --- percussion -----------------------------------------------------------
    "timpani": Patch([Voice({"sus": [Source(V + "Percussion/Timpani", match=r"^Timpani1_Hit", pitched=False,
                                            root=41.4)]}, width=0.7)],
                     kind="hit", max_len=6.0, vel_range=(40, 110)),
    "bassdrum": Patch([Voice({"sus": [Source(V + "VSCO 1 Percussion/drums/bass", match=r"^bdrum_muted_",
                                             pitched=False, root=36)]}, width=0.6)],
                      kind="hit", max_len=2.5, vel_range=(40, 115), track=0.3),
    # The taiko: a concert bass drum tuned up from its 42 Hz boom into a
    # taiko's register, with a big frame drum on top for the slap of the skin.
    "taiko": Patch([Voice({"sus": [Source(C + "Membranophones/Struck Membranophones/Bass Drum 2",
                                          match=r"^bassdrum_hit_", pitched=False, root=42)]}, width=0.8),
                    Voice({"sus": [Source(FRAME, match=r"^HDrumL_Hit_", pitched=False, root=49)]},
                          gain=-3.0, width=0.6)],
                   kind="hit", max_len=3.0, vel_range=(40, 115), track=1.0),
    # The bodhran: a frame drum, the big one for the downbeats, the small one
    # between, and muted strokes for the ghost notes.
    "tom": Patch([Voice({"low": [Source(FRAME, match=r"^HDrumL_Hit_", pitched=False, root=45)],
                         "high": [Source(FRAME, match=r"^HDrumS_Hit_", pitched=False, root=50)],
                         "ghost": [Source(FRAME, match=r"^HDrumL_HitMuted_", pitched=False, root=47)]},
                        width=0.7)],
                 kind="hit", max_len=2.0, kit="bodhran", vel_range=(30, 100), track=0.5),
    "tambourine": Patch([Voice({"sus": [Source(C + "Idiophones/Struck Idiophones/Tambourine 1",
                                               match=r"_Hit_", pitched=False, root=60)]}, width=0.6)],
                        kind="hit", max_len=1.5, vel_range=(30, 100), track=0.0),
}


# ---------------------------------------------------------------------------
# DSP helpers
# ---------------------------------------------------------------------------
def cubic(src, pos):
    """4-point Hermite interpolation of a (n, 2) signal at fractional positions."""
    n = len(src)
    i = np.floor(pos).astype(np.int64)
    f = (pos - i)[:, None].astype(np.float32)
    i = np.clip(i, 1, n - 3)
    xm1, x0, x1, x2 = src[i - 1], src[i], src[i + 1], src[i + 2]
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0


def extended(z, need, rng):
    """The sample, made at least `need` samples long by splicing further
    stretches of its stable body on with crossfades. A held note longer than
    its sample never loops audibly: each splice point is chosen at random, the
    best-aligned of a few candidates, with an equal-power fade where the two
    sides are uncorrelated and an equal-gain fade where they line up."""
    d = data(z.path)
    if need <= len(d) - 8:
        return d
    b0 = int(z.body[0] * SR)
    b1 = int(min(z.body[1], z.length) * SR)
    if b1 - b0 < int(0.5 * SR):
        b0, b1 = int(0.25 * len(d)), int(0.85 * len(d))
    X = int(min(0.3 * SR, (b1 - b0) * 0.3))
    seglen = int(min(2.5 * SR, b1 - b0))
    out = [d[:b1].copy()]
    have = b1
    tail = d[b1 - X:b1]
    t = np.linspace(0, 1, X, dtype=np.float32)[:, None]
    while have < need + 8:
        best = None
        for _ in range(6):
            s = int(rng.integers(b0, max(b0 + 1, b1 - seglen)))
            head = d[s:s + X]
            c = float((tail * head).sum() / (np.sqrt((tail ** 2).sum() * (head ** 2).sum()) + 1e-12))
            if best is None or c > best[0]:
                best = (c, s)
        c, s = best
        seg = d[s:s + seglen].copy()
        if c > 0.6:
            fin, fout = t, 1 - t
        else:
            fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
        out[-1][-X:] = out[-1][-X:] * fout + seg[:X] * fin
        out.append(seg[X:])
        have += seglen - X
        tail = seg[-X:]
    y = np.concatenate(out)
    # Level the slow swells of the recording (bow changes, breath) past the
    # attack, so a long drone holds steady under the score's own CC11 swell;
    # vibrato and anything faster than ~0.4 s is left alone.
    hop = 2205
    m = y[b0:].mean(1)
    k = len(m) // hop
    if k > 8:
        env = np.sqrt((m[:k * hop].reshape(k, hop) ** 2).mean(1) + 1e-12)
        env = np.convolve(np.pad(env, 4, mode="edge"), np.ones(9) / 9, mode="valid")
        ref = np.median(env)
        g = np.clip((ref / env) ** 0.7, 10 ** (-6 / 20), 10 ** (6 / 20))
        gs = np.interp(np.arange(len(m)), np.arange(k) * hop + hop / 2, g).astype(np.float32)
        # fade the levelling in over the first second of the body
        w = np.clip(np.arange(len(m)) / SR, 0, 1).astype(np.float32)
        y[b0:] *= (1 + (gs - 1) * w)[:, None]
    return y


def circ_add(buf, start, seg):
    """Add seg into a circular buffer starting at sample `start` (any integer)."""
    L = len(buf)
    n = len(seg)
    s = start % L
    done = 0
    while done < n:
        k = min(n - done, L - s)
        buf[s:s + k] += seg[done:done + k]
        done += k
        s = 0


def pan_gains(p):
    a = (min(1.0, max(-1.0, p)) + 1) * math.pi / 4
    return math.cos(a) * math.sqrt(2), math.sin(a) * math.sqrt(2)


def place(seg, pan, width):
    """Width (M/S) then constant-power pan, unity at centre."""
    if width != 1.0:
        m = (seg[:, 0] + seg[:, 1]) * 0.5
        s = (seg[:, 0] - seg[:, 1]) * 0.5 * width
        seg = np.stack([m + s, m - s], 1)
    gl, gr = pan_gains(pan)
    seg = seg.copy()
    seg[:, 0] *= gl
    seg[:, 1] *= gr
    return seg


# ---------------------------------------------------------------------------
# Controllers: the part's CC11 / CC1 / pitch-bend events as smooth curves
# over the circular loop, at a control rate of one value per HOP samples.
# ---------------------------------------------------------------------------
HOP = 32
# How a GeneralUser channel turns CC7/CC11 into level: gain_dB = EXPR_K * 40*log10(v/127).
# Measured by calibrate_expression() and stored in the calibration file.
EXPR_K_DEFAULT = 1.0


def _curve(events, Ls, k_t, init, smooth_s=0.012):
    n = Ls // HOP + 1
    if not events:
        return np.full(n, float(init))
    pos = np.array([(t * k_t * SR) % Ls for t, _ in events])
    vals = np.array([v for _, v in events], dtype=float)
    order = np.argsort(pos, kind="stable")
    pos, vals = pos[order], vals[order]
    j = np.arange(n) * HOP
    idx = np.searchsorted(pos, j, side="right") - 1
    idx[idx < 0] = len(vals) - 1        # before the first event: the loop's last value
    arr = vals[idx]
    a = math.exp(-HOP / (smooth_s * SR))
    two = lfilter([1 - a], [1, -a], np.concatenate([arr, arr]))
    return two[n:]


def _at(curve, Ls, s0, nsamp):
    """Curve values for samples s0 .. s0+nsamp (circular), linearly interpolated."""
    t = (np.arange(nsamp) + s0) % Ls / HOP
    i = np.floor(t).astype(np.int64)
    f = t - i
    i1 = (i + 1) % len(curve)
    return curve[i % len(curve)] * (1 - f) + curve[i1] * f


def _calib():
    p = os.path.join(WORK, "calibration.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def vel_db(name, v, cal=None):
    cal = cal if cal is not None else _calib()
    pts = cal.get(name)
    if not pts:
        return 20 * math.log10(max(v, 1) / 127)
    vs = [p[0] for p in pts]
    ds = [p[1] for p in pts]
    if v <= vs[0]:
        # below the measured range, keep the slope of the lowest segment
        sl = (ds[1] - ds[0]) / (vs[1] - vs[0])
        return ds[0] + (v - vs[0]) * sl
    if v >= vs[-1]:
        sl = (ds[-1] - ds[-2]) / (vs[-1] - vs[-2])
        return ds[-1] + (v - vs[-1]) * sl
    return float(np.interp(v, vs, ds))


# ---------------------------------------------------------------------------
# Rendering one part
# ---------------------------------------------------------------------------
def _legato_plan(notes, patch):
    """For each note: (legato_in_from_pitch or None, end override, release override)."""
    n = len(notes)
    plan = [[None, None, None] for _ in range(n)]
    if not patch.legato:
        return plan
    starts = np.array([x[0] for x in notes])
    ends = np.array([x[0] + x[1] for x in notes])
    for i in range(1, n):
        t = starts[i]
        j = i - 1
        while j >= 0 and starts[j] >= t - 0.004:
            j -= 1
        if j < 0:
            continue
        if not (ends[j] >= t - 0.03):
            continue
        # monophonic at this point: nothing else sounding
        sounding = np.nonzero((starts < t - 0.004) & (ends > t - 0.03))[0]
        if len(sounding) != 1 or sounding[0] != j:
            continue
        plan[i][0] = notes[j][2]
        plan[j][1] = t - starts[j] + 0.02     # hold the old note just past the new one's entry
        plan[j][2] = 0.07                     # and let it go quickly: the crossfade
    return plan


def _smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def render_part(part, Ls, k_t, song_name, cal=None):
    """The part on its samples: a (Ls, 2) float32 circular buffer, panned,
    with velocity, CC7 and CC11 applied."""
    patch = PATCHES[part.cfg["patch"]]
    cal = cal if cal is not None else _calib()
    expr_k = cal.get("_expr_k", EXPR_K_DEFAULT)
    rng = np.random.default_rng(zlib.crc32(f"{song_name}/{part.name}".encode()))
    buf = np.zeros((Ls, 2), np.float32)
    notes = sorted(n for n in part.notes if 0 <= n[2] <= 127)
    if not notes:
        return buf
    notes = [(t * k_t, d * k_t, p, v) for t, d, p, v in notes]
    mod = _curve([(t, v) for t, c, v in part.cc if c == 1], Ls, k_t, 0)
    bend = _curve([(t, v / 8192 * 200) for t, v in part.bend], Ls, k_t, 0, smooth_s=0.004)
    plan = _legato_plan(notes, patch)
    name = part.cfg["patch"]
    for vi, voice in enumerate(patch.voices):
        vr = np.random.default_rng(rng.integers(1 << 31))
        for (t_on, d, pitch, vel), (lfrom, end_o, rel_o) in zip(notes, plan):
            v = vel + voice.vel + vr.normal(0, 1.5)
            if end_o is not None:
                d = end_o
            rel = rel_o if rel_o is not None else patch.rel
            # which articulation
            if patch.kit == "bodhran":
                art = "ghost" if v < 45 else ("low" if pitch <= 46 else "high")
            elif "short" in voice.arts and d < patch.short_below and lfrom is None:
                art = "short"
            else:
                art = "sus" if "sus" in voice.arts else next(iter(voice.arts))
            cents0 = voice.cents + (vr.normal(0, patch.intonation) if patch.intonation else 0.0)
            glide = None
            if (lfrom is not None and patch.glide and abs(lfrom - pitch) <= 5 and d >= 0.2
                    and vr.random() < patch.glide):
                glide = (lfrom - pitch) * 100.0
            phase = vr.random() * 2 * math.pi
            rate = patch.vib["rate"] * (1 + vr.normal(0, 0.05)) if patch.vib else 0
            jitter = vr.normal(0, voice.timing) if voice.timing else 0.0
            curve = name + ":short" if art == "short" and name + ":short" in cal else name
            g_note = 10 ** ((vel_db(curve, v, cal) + voice.gain) / 20)
            for src in voice.arts[art]:
                wk = src.weight(pitch)
                if wk <= 0:
                    continue
                for z, w in pick(src, pitch, v, vr, patch.vel_range, blend=patch.kind == "sus"):
                    seg, s0 = _render_zone(z, patch, t_on, d, pitch, rel, lfrom is not None, glide,
                                           cents0, phase, rate, mod, bend, Ls, vr)
                    if seg is None:
                        continue
                    norm = z.norm if patch.kind == "sus" else z.norm_hit
                    seg *= np.float32(w * wk * norm * g_note * 10 ** (z.gain / 20))
                    start = s0 + int(round((voice.delay + jitter) * SR))
                    circ_add(buf, start, place(seg, part.cfg["pan"] + voice.pan, voice.width))
    # the channel: CC7 volume and CC11 expression, as a GM channel applies them
    expr = _curve([(t, max(1, v)) for t, c, v in part.cc if c == 11], Ls, k_t, 110)
    g = expr_k * 40 * np.log10(expr / 127.0) + expr_k * 40 * math.log10(max(1, part.cfg["vol"]) / 127)
    gain = 10 ** (g / 20)
    gs = _at(gain, Ls, 0, Ls).astype(np.float32)
    buf *= gs[:, None]
    return buf


def _render_zone(z, patch, t_on, d, pitch, rel, legato_in, glide, cents0, phase, rate, mod, bend, Ls, rng):
    hit = patch.kind == "hit"
    pluck = patch.kind == "pluck"
    shift = (pitch - z.root) * (patch.track if hit else 1.0)
    ratio0 = 2 ** (shift / 12)
    # where in the sample to start: past the attack for a legato entry or a
    # quick note, so a slow-speaking string sample does not smear the rhythm
    if hit or pluck:
        skip = 0.0
    elif legato_in:
        skip = patch.legato_skip
    else:
        skip = patch.skip * float(np.clip((0.6 - d) / 0.45, 0, 1))
    skip = min(skip, max(0.0, z.body[0] - 0.02)) if not (hit or pluck) else 0.0
    # play early by part of the time the sample takes to speak
    pre = min(max(0.0, z.speak - skip) * 0.5, patch.preshift)
    s0 = int(round((t_on - pre) * SR))
    if hit:
        dur = min(patch.max_len or 2.0, z.length / ratio0)
    else:
        dur = d + rel + pre
        if pluck:
            dur = min(dur, z.length / ratio0)
    n = int(dur * SR)
    if n < 64:
        return None, 0
    t = np.arange(n) / SR
    cents = np.full(n, cents0)
    if not hit:
        cents += _at(bend, Ls, s0, n)
        if patch.vib:
            depth = patch.vib["depth"] * np.clip(_at(mod, Ls, s0, n) / 70.0, 0, 1.4)
            cents += depth * np.sin(2 * math.pi * rate * t + phase)
        if glide is not None:
            gt = patch.glide_ms / 1000
            cents += glide * (1 - _smoothstep(t / gt))
    inc = ratio0 * np.exp2(cents / 1200.0)
    pos = skip * SR + np.concatenate([[0.0], np.cumsum(inc[:-1])])
    if hit or pluck:
        src = data(z.path)
        ok = int(np.searchsorted(pos, len(src) - 4))
        n = min(n, ok)
        if n < 64:
            return None, 0
        pos, t = pos[:n], t[:n]
    else:
        src = extended(z, int(pos[-1]) + 4, rng)
    y = cubic(src, pos)
    env = np.ones(n, np.float32)
    # entry
    fin = 0.035 if legato_in else (0.012 if skip > 0 else 0.002)
    k = max(1, min(n, int(fin * SR)))
    env[:k] = np.sin(np.linspace(0, math.pi / 2, k)) ** 2
    if patch.vib and not hit:
        depth_n = np.clip(_at(mod, Ls, s0, n) / 70.0, 0, 1.4)
        env *= (1 + 0.05 * depth_n * np.sin(2 * math.pi * rate * t + phase + 0.6)).astype(np.float32)
    if not hit:
        off = d + pre
        rel_t = np.clip(t - off, 0, None)
        env *= np.exp(-rel_t * 4.6 / max(rel, 0.02)).astype(np.float32)
    k = min(n, int(0.01 * SR))
    env[n - k:] *= np.linspace(1, 0, k, dtype=np.float32)
    return y * env[:, None], s0


# ---------------------------------------------------------------------------
# Calibration against the GeneralUser presets the score was balanced on
# ---------------------------------------------------------------------------
CAL_PITCHES = {
    "whistle": (67, 74, 81), "flute": (67, 74, 81), "fiddle": (62, 69, 79), "violin": (62, 69, 79),
    "horn": (50, 57, 64), "horns": (50, 57, 64), "brass": (55, 62, 69), "trombone": (41, 48, 55),
    "tuba": (31, 38, 45), "strings": (52, 60, 67), "fstrings": (62, 69, 76), "trem": (50, 57, 64),
    "cello": (40, 45, 50), "contrabass": (26, 33, 38), "pizz": (43, 50, 62), "harp": (45, 57, 64),
    "dulcimer": (62, 69, 74), "guitar": (50, 57, 62), "glass": (81, 86, 88), "timpani": (38, 43, 45),
    "bassdrum": (36,), "taiko": (48, 50), "tom": (45, 50, 52), "tambourine": (60,),
}
CAL_VELS = (40, 64, 90, 118)


def _level(x, win):
    m = x[: int(win * SR)]
    e = sum(np.mean(kweight(m[:, c].astype(np.float64)) ** 2) for c in range(2))
    return 10 * math.log10(e + 1e-15)


def _gu_note(sf2, bank, prog, pitch, vel, dur, expr=127, workdir=WORK):
    import mido
    import subprocess
    mf = mido.MidiFile(type=0, ticks_per_beat=480)
    tr = mido.MidiTrack()
    tr.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    for msg in (mido.Message("control_change", control=0, value=bank),
                mido.Message("control_change", control=32, value=0),
                mido.Message("program_change", program=prog),
                mido.Message("control_change", control=7, value=127),
                mido.Message("control_change", control=10, value=64),
                mido.Message("control_change", control=11, value=expr),
                mido.Message("control_change", control=91, value=0),
                mido.Message("control_change", control=93, value=0)):
        tr.append(msg)
    tr.append(mido.Message("note_on", note=pitch, velocity=vel, time=96))       # 0.1 s
    tr.append(mido.Message("note_off", note=pitch, velocity=0, time=int(dur * 960)))
    tr.append(mido.MetaMessage("end_of_track", time=int(3 * 960)))
    mf.tracks.append(tr)
    mid = os.path.join(workdir, "cal.mid")
    wav = os.path.join(workdir, "cal.wav")
    mf.save(mid)
    subprocess.run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", "0.6", "-r", str(SR),
                    "-o", "audio.file.format=float", "-F", wav, sf2, mid], check=True, capture_output=True)
    _, x = wavfile.read(wav)
    return x[int(0.1 * SR):].astype(np.float64)


class _P:
    def __init__(self, name, patch, notes):
        self.name = name
        self.notes = notes
        self.cc = []
        self.bend = []
        self.cfg = dict(patch=patch, pan=0.0, vol=127)


def calibrate(names, instr, sf2, force=False):
    """Fit each patch's velocity->level curve so a note sounds as loud as the
    GeneralUser preset it replaces, at every velocity: the score's dynamics and
    balance were written against those presets."""
    path = os.path.join(WORK, "calibration.json")
    cal = _calib()
    if "_expr_k" not in cal or force:
        a = _level(_gu_note(sf2, 0, 49, 62, 100, 1.2, expr=127), 2.0)
        b = _level(_gu_note(sf2, 0, 49, 62, 100, 1.2, expr=64), 2.0)
        cal["_expr_k"] = round((b - a) / (40 * math.log10(64 / 127)), 3)
    for name in names:
        cfg = instr[name]
        key = cfg["patch"]
        if key in cal and not force:
            continue
        patch = PATCHES[key]
        hit = patch.kind == "hit"
        # (curve name, note lengths): long notes measured short and held, as
        # they are played; slow speakers (the glass) held longer
        jobs = []
        if hit:
            jobs.append((key, (0.3,)))
        elif patch.kind == "pluck":
            jobs.append((key, (0.6,)))
        else:
            jobs.append((key, (4.0, 8.0) if key == "glass" else (0.5, 2.5)))
            if patch.short_below and any("short" in v.arts for v in patch.voices):
                jobs.append((key + ":short", (patch.short_below * 0.8,)))
        flat = {k: v for k, v in cal.items() if not k.startswith(key)}   # neutral 20log10(v/127)
        for curve, durs in jobs:
            pts = []
            for v in CAL_VELS:
                diffs = []
                for dur in durs:
                    win = 0.8 if hit else dur + 0.8
                    for p in CAL_PITCHES[key]:
                        gu = _level(_gu_note(sf2, cfg["bank"], cfg["prog"], p, v, dur), win)
                        part = _P("cal", key, [(0.0, dur, p, v)])
                        part.cc = [(0.0, 11, 127)]
                        # struck and plucked notes pick one layer at random: average a few draws
                        draws = []
                        for k in range(1 if patch.kind == "sus" else 6):
                            me = render_part(part, int(10 * SR), 1.0, f"cal{k}", flat)
                            # start the window 0.1 s early so the pre-shifted attack is inside it
                            draws.append(10 ** (_level(np.roll(me, int(0.1 * SR), axis=0), win) / 10))
                        diffs.append(gu - 10 * math.log10(np.mean(draws)))
                pts.append([v, round(20 * math.log10(v / 127) + float(np.mean(diffs)), 2)])
            cal[curve] = pts
            print(f"  calibrated {curve}: " + ", ".join(f"v{v}:{d:+.1f}" for v, d in pts), flush=True)
        forget()
    json.dump(cal, open(path, "w"), indent=1)
    return cal
