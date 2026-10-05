"""
The sequencer, the performer and the studio behind tools/music/build.py.

Nothing in here is a tune. It turns the notation in score.py into MIDI that
sounds played rather than typed — timing drift, accents that follow the metre,
phrases that swell, ornaments the way a whistle or fiddle player would put them
in — renders it through a General MIDI soundfont with fluidsynth, one stem per
instrument family, and then does the work a mix engineer would: a convolution
hall per stem, EQ, glue compression, a little width, loudness to target and a
limiter, and a seamless loop cut.

The loop cut is the part worth knowing about. Every track is sequenced as one
loop of length L, rendered three times back to back, and the file is cut from
the middle copy: [L, 2L + PAD]. So the start of the file already carries the
reverb tail of its own ending, the end runs PAD seconds on into its own start,
and js/audio.js jumps from L back to 0 (plus however far it overshot) with the
same music on both sides of the seam.
"""
import math
import os
import random
import re
import subprocess
import json
import warnings

import numpy as np
import mido
from scipy.io import wavfile
from scipy.signal import fftconvolve, butter, sosfilt

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)

SR = 44100
PAD = 1.5            # seconds of music kept past the loop point
HERE = os.path.dirname(os.path.abspath(__file__))
SF2 = os.path.join(HERE, "GeneralUser-GS.sf2")
WORK = os.path.join(HERE, "_work")

# ---------------------------------------------------------------------------
# Pitch
# ---------------------------------------------------------------------------
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    """'C#5' -> 73. Octave numbers are scientific: C4 = 60."""
    m = re.fullmatch(r"([A-G])([#b]?)(-?\d)", name)
    if not m:
        raise ValueError(f"bad note {name!r}")
    p = PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    return p + 12 * (int(m.group(3)) + 1)


QUAL = {
    "": (0, 4, 7), "m": (0, 3, 7), "5": (0, 7), "sus4": (0, 5, 7),
    "sus2": (0, 2, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11), "add9": (0, 4, 7, 14), "madd9": (0, 3, 7, 14),
    "dim": (0, 3, 6),
}


def chord(sym):
    """'F#m7' -> (root pitch class, intervals). Slash bass: 'C/E'."""
    bass = None
    if "/" in sym:
        sym, b = sym.split("/")
        bass = PC[b[0]] + (1 if b[1:] == "#" else -1 if b[1:] == "b" else 0)
    m = re.fullmatch(r"([A-G])([#b]?)(.*)", sym)
    root = (PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
    ivs = QUAL[m.group(3)]
    return root, ivs, (bass if bass is not None else root) % 12


def tones_in(sym, lo, hi):
    root, ivs, _ = chord(sym)
    pcs = {(root + i) % 12 for i in ivs}
    return [p for p in range(lo, hi + 1) if p % 12 in pcs]


def bass_of(sym, lo=36):
    _, _, b = chord(sym)
    p = lo
    while p % 12 != b:
        p += 1
    return p


# ---------------------------------------------------------------------------
# Instruments: (bank, program) in GeneralUser GS, plus how each is played.
# stem groups the families that share a reverb send; pan is -1..1.
# ---------------------------------------------------------------------------
INSTR = {
    "whistle":   dict(bank=24, prog=75, stem="lead", pan=0.05, vol=100),
    "flute":     dict(bank=0, prog=73, stem="lead", pan=-0.1, vol=100),
    "fiddle":    dict(bank=0, prog=110, stem="lead", pan=0.12, vol=100),
    "violin":    dict(bank=0, prog=40, stem="lead", pan=-0.15, vol=100),
    "voice":     dict(bank=0, prog=85, stem="lead", pan=0.0, vol=90),     # Solo Vox: the kulning call
    "pipes":     dict(bank=0, prog=109, stem="lead", pan=0.3, vol=80),
    "shakuhachi": dict(bank=0, prog=77, stem="lead", pan=-0.25, vol=95),
    "horn":      dict(bank=1, prog=60, stem="brass", pan=-0.2, vol=100),   # Solo French Horn
    "horns":     dict(bank=0, prog=60, stem="brass", pan=-0.25, vol=100),
    "brass":     dict(bank=0, prog=61, stem="brass", pan=0.15, vol=95),
    "trombone":  dict(bank=0, prog=57, stem="brass", pan=0.3, vol=95),
    "tuba":      dict(bank=0, prog=58, stem="brass", pan=0.1, vol=95),
    "strings":   dict(bank=0, prog=49, stem="strings", pan=0.0, vol=100),  # Slow Strings
    "fstrings":  dict(bank=0, prog=48, stem="strings", pan=0.1, vol=100),  # Fast Strings
    "trem":      dict(bank=0, prog=44, stem="strings", pan=-0.1, vol=90),
    "cello":     dict(bank=0, prog=42, stem="low", pan=0.2, vol=100),
    "contrabass": dict(bank=0, prog=43, stem="low", pan=0.0, vol=100),
    "pizz":      dict(bank=0, prog=45, stem="plucks", pan=0.25, vol=95),
    "harp":      dict(bank=0, prog=46, stem="plucks", pan=-0.3, vol=100),
    "dulcimer":  dict(bank=0, prog=15, stem="plucks", pan=0.35, vol=85),
    "guitar":    dict(bank=0, prog=24, stem="plucks", pan=0.3, vol=90),
    "choir":     dict(bank=0, prog=52, stem="strings", pan=0.0, vol=95),
    "oohs":      dict(bank=0, prog=53, stem="strings", pan=0.0, vol=95),
    "glass":     dict(bank=0, prog=92, stem="strings", pan=0.0, vol=90),
    "timpani":   dict(bank=0, prog=47, stem="drums", pan=-0.1, vol=110),
    "taiko":     dict(bank=0, prog=116, stem="drums", pan=0.0, vol=115),
    "bassdrum":  dict(bank=8, prog=116, stem="drums", pan=0.0, vol=115),
    "tom":       dict(bank=0, prog=117, stem="drums", pan=0.15, vol=105),
    "tambourine": dict(bank=12, prog=119, stem="drums", pan=0.35, vol=70),
}

# How much of each stem goes to the hall, and how long the hall is.
STEMS = {
    "lead":    dict(wet=0.30, ir="hall"),
    "brass":   dict(wet=0.38, ir="hall"),
    "strings": dict(wet=0.42, ir="hall"),
    "low":     dict(wet=0.22, ir="hall"),
    "plucks":  dict(wet=0.32, ir="hall"),
    "drums":   dict(wet=0.24, ir="room"),
}

# Ornaments only make sense on folk solo instruments.
ORNAMENTED = {"whistle", "flute", "fiddle", "violin", "pipes"}
SUSTAINED = {"whistle", "flute", "fiddle", "violin", "voice", "pipes", "shakuhachi",
             "horn", "horns", "brass", "trombone", "tuba", "strings", "fstrings",
             "trem", "cello", "contrabass", "choir", "oohs", "glass"}


class Part:
    def __init__(self, name, instr, **over):
        self.name = name
        self.instr = instr
        cfg = dict(INSTR[instr])
        cfg.update(over)
        self.cfg = cfg
        self.notes = []      # (t, dur, pitch, vel)  seconds
        self.cc = []         # (t, num, val)
        self.bend = []       # (t, val -8192..8191)


# ---------------------------------------------------------------------------
# A song: a grid in eighth-notes, a tempo map, chords and parts.
# ---------------------------------------------------------------------------
class Song:
    def __init__(self, name, bar=6, spe=0.25, seed=1, beat=3):
        """bar: eighths per bar. spe: seconds per eighth. beat: eighths per beat."""
        self.name = name
        self.bar_e = bar
        self.beat_e = beat
        self.spe0 = spe
        self.tempo = [(0.0, spe)]     # (pos in eighths, seconds per eighth)
        self.parts = {}
        self.chords = []              # (pos_e, len_e, sym)
        self.rng = random.Random(seed)
        self.length_e = None

    # --- time ---------------------------------------------------------------
    def set_tempo(self, bar, spe):
        self.tempo.append((bar * self.bar_e, spe))
        self.tempo.sort()

    def rit(self, bar0, bar1, spe0, spe1, steps=12):
        """A smooth tempo ramp across bars [bar0, bar1)."""
        for i in range(steps):
            f = i / steps
            self.tempo.append(((bar0 + (bar1 - bar0) * f) * self.bar_e,
                               spe0 + (spe1 - spe0) * f))
        self.tempo.sort()

    def time(self, pos_e):
        t, last_p, last_s = 0.0, 0.0, self.tempo[0][1]
        for p, s in self.tempo:
            if p >= pos_e:
                break
            t += (p - last_p) * last_s
            last_p, last_s = p, s
        return t + (pos_e - last_p) * last_s

    def spe_at(self, pos_e):
        s = self.tempo[0][1]
        for p, v in self.tempo:
            if p <= pos_e:
                s = v
        return s

    def pos(self, bar, e=0.0):
        return bar * self.bar_e + e

    def part(self, name, instr=None, **over):
        if name not in self.parts:
            self.parts[name] = Part(name, instr or name, **over)
        return self.parts[name]

    # --- harmony ------------------------------------------------------------
    def harmony(self, bar, spec, per=None):
        """spec: 'Dm C | F G' — '|' separates bars, chords within a bar split it evenly."""
        b = bar
        for seg in spec.split("|"):
            syms = seg.split()
            if not syms:
                continue
            n = len(syms)
            for i, s in enumerate(syms):
                ln = self.bar_e / n
                self.chords.append((self.pos(b) + i * ln, ln, s))
            b += 1
        self.chords.sort()
        return b

    def chord_at(self, pos_e):
        cur = None
        for p, ln, s in self.chords:
            if p <= pos_e + 1e-6:
                cur = (p, ln, s)
            else:
                break
        return cur

    def chords_in(self, bar0, bar1):
        a, b = self.pos(bar0), self.pos(bar1)
        out = []
        for p, ln, s in self.chords:
            if a - 1e-6 <= p < b - 1e-6:
                out.append((p, min(ln, b - p), s))
        return out

    # --- adding notes ---------------------------------------------------------
    def note(self, part, pos_e, len_e, pitch, vel, legato=1.0, human=0.008, swell=None,
             scoop=False, vib=True):
        """One note at a grid position. Applies timing drift and the per-instrument
        articulation; writes expression for sustained notes."""
        p = self.parts[part]
        t0 = self.time(pos_e)
        t1 = self.time(pos_e + len_e)
        jitter = self.rng.gauss(0, human) if human else 0.0
        t = max(0.0, t0 + jitter)
        dur = max(0.04, (t1 - t0) * legato)
        vel = int(max(8, min(127, round(vel + self.rng.gauss(0, 3)))))
        p.notes.append((t, dur, pitch, vel))
        inst = p.instr
        if inst in SUSTAINED and swell is not False:
            self._swell(p, t, dur, swell)
            if vib and dur > 0.55 and inst not in ("strings", "choir", "oohs", "glass", "contrabass", "tuba"):
                # Delayed vibrato: a player leans into a held note.
                p.cc.append((t, 1, 0))
                for k in range(1, 6):
                    p.cc.append((t + 0.3 + (dur - 0.3) * k / 6, 1, int(min(70, 14 * k))))
                p.cc.append((t + dur, 1, 0))
        if scoop:
            # Slide up into the note from a whole-tone below (bend range 2).
            n = 8
            for k in range(n + 1):
                f = k / n
                p.bend.append((t + 0.12 * f, int(-8191 * (1 - f) ** 1.6)))
            p.bend.append((t + dur, 0))
        return t, dur

    def _swell(self, p, t, dur, shape):
        """Expression (CC11) over one note: a messa di voce for long notes."""
        lo, hi, end = (shape or (88, 118, 96))
        if dur < 0.35:
            p.cc.append((t, 11, hi - 6))
            return
        n = max(3, min(14, int(dur / 0.15)))
        peak = 0.55
        for k in range(n + 1):
            f = k / n
            if f < peak:
                v = lo + (hi - lo) * math.sin(f / peak * math.pi / 2)
            else:
                v = hi + (end - hi) * ((f - peak) / (1 - peak)) ** 1.3
            p.cc.append((t + dur * f * 0.98, 11, int(v)))

    def mel(self, part, bar, text, vel=84, transpose=0, legato=0.97, orn=True,
            human=0.009, shape=None, accent=True, check=True, scoop_long=False):
        """Play a line written in the notation below, starting at `bar`.

            D4:1 A4:1 D5:1 A5:3 | G5:2 F5:1 ...

        Each token is NOTE:eighths with optional marks after the length:
            ~  roll (a run of grace notes around the note, Irish style)
            '  cut  (a single grace from above)
            ^  accent      ,  soft      /  scoop up into the note
            _  tie / legato into the next note (no re-attack gap)
        r:N is a rest. '|' marks barlines and is checked against the metre.
        Returns the bar after the last one written.
        """
        pos = self.pos(bar)
        bar_start = pos
        inst = self.parts[part].instr
        toks = text.split()
        phrase = []
        for tok in toks:
            if tok == "|":
                if check and abs((pos - bar_start) - self.bar_e) > 1e-6 and pos != bar_start:
                    raise ValueError(f"{self.name}/{part}: bar at {bar_start / self.bar_e:.0f} "
                                     f"holds {pos - bar_start} eighths, not {self.bar_e}")
                bar_start = pos
                continue
            m = re.fullmatch(r"([A-Gr][#b]?-?\d?):([\d.]+)([~'^,/_]*)", tok)
            if not m:
                raise ValueError(f"bad token {tok!r}")
            name, ln, marks = m.group(1), float(m.group(2)), m.group(3)
            if name != "r":
                phrase.append((pos, ln, midi(name) + transpose, marks))
            pos += ln
        if not phrase:
            return math.ceil(pos / self.bar_e)
        mean = sum(n[2] for n in phrase) / len(phrase)
        for i, (p0, ln, pitch, marks) in enumerate(phrase):
            v = vel
            if accent:
                within = (p0 % self.bar_e)
                if abs(within) < 1e-6:
                    v += 8
                elif abs(within % self.beat_e) < 1e-6:
                    v += 4
                else:
                    v -= 3
            v += (pitch - mean) * 0.7            # the line sings louder as it climbs
            v += min(6, ln * 1.2)                 # long notes are leant on
            if "^" in marks:
                v += 12
            if "," in marks:
                v -= 14
            leg = 1.04 if "_" in marks else legato
            if orn and inst in ORNAMENTED and ("~" in marks or "'" in marks):
                self._ornament(part, p0, ln, pitch, v, marks, human, leg)
            else:
                self.note(part, p0, ln, pitch, v, legato=leg, human=human, swell=shape,
                          scoop=("/" in marks) or (scoop_long and ln >= 3 and i % 3 == 0))
        return math.ceil(pos / self.bar_e - 1e-6)

    def _ornament(self, part, p0, ln, pitch, vel, marks, human, legato):
        """Cuts and rolls. Grace notes are a few tens of milliseconds long and
        take their time from the front of the main note, so the beat is kept."""
        up = pitch + (2 if (pitch % 12) not in (4, 11) else 1)
        down = pitch - (2 if (pitch % 12) not in (5, 0) else 1)
        t0 = self.time(p0)
        spe = self.spe_at(p0)
        g = min(0.045, spe * 0.22)
        p = self.parts[part]
        j = self.rng.gauss(0, human)
        if "~" in marks and ln * spe > 0.3:
            # Roll: note, cut, note, tap, note — spread over the first third.
            seq = [(pitch, spe * 0.55), (up, g), (pitch, spe * 0.5), (down, g)]
            t = t0 + j
            for pp, d in seq:
                p.notes.append((t, d * 0.95, pp, int(max(20, min(127, vel - (12 if pp != pitch else 0))))))
                t += d
            rest = self.time(p0 + ln) - t
            p.notes.append((t, max(0.05, rest * legato), pitch, int(min(127, vel))))
            self._swell(p, t0, self.time(p0 + ln) - t0, None)
        else:
            p.notes.append((t0 + j - g, g * 0.95, up, int(max(20, vel - 14))))
            d = (self.time(p0 + ln) - t0) * legato
            p.notes.append((t0 + j, d, pitch, int(min(127, vel))))
            self._swell(p, t0, d, None)

    # --- accompaniment generators -------------------------------------------
    def pad(self, part, bar0, bar1, lo, hi, vel=60, swell=(70, 108, 80), legato=1.02,
            human=0.012, bass=False):
        for p, ln, s in self.chords_in(bar0, bar1):
            ps = tones_in(s, lo, hi)
            if bass:
                ps = [bass_of(s, lo)] + [x for x in ps if x > bass_of(s, lo) + 6]
            for x in ps:
                self.note(part, p, ln, x, vel, legato=legato, human=human, swell=swell)

    def bassline(self, part, bar0, bar1, lo=38, vel=74, rhythm=(3, 3), octave_up=False,
                 legato=0.95, human=0.008):
        for p, ln, s in self.chords_in(bar0, bar1):
            root = bass_of(s, lo)
            q = 0.0
            i = 0
            while q < ln - 1e-6:
                d = rhythm[i % len(rhythm)]
                pitch = root + (12 if octave_up and i % 2 == 1 else 0)
                self.note(part, p + q, min(d, ln - q), pitch, vel + (6 if i == 0 else 0),
                          legato=legato, human=human)
                q += d
                i += 1

    def arp(self, part, bar0, bar1, pattern, lo=50, vel=62, step=1.0, legato=2.5,
            human=0.01, swell=False):
        """Arpeggiate the chord in force through `pattern` — indices into the
        chord tones from `lo` upward — one index per `step` eighths."""
        a, b = self.pos(bar0), self.pos(bar1)
        q = a
        i = 0
        while q < b - 1e-6:
            c = self.chord_at(q)
            if c is None:
                q += step
                continue
            ps = [bass_of(c[2], lo)] + [x for x in tones_in(c[2], lo + 1, lo + 40)
                                         if x > bass_of(c[2], lo)]
            idx = pattern[i % len(pattern)]
            if idx is not None:
                pitch = ps[min(idx, len(ps) - 1)]
                within = (q - a) % self.bar_e
                v = vel + (8 if within < 1e-6 else 3 if within % self.beat_e < 1e-6 else -2)
                # Let it ring, but damp it when the harmony moves, as a harpist would.
                ring = min(step * legato, (c[0] + c[1]) - q + 0.2)
                self.note(part, q, max(ring, step * 0.9), pitch, v, legato=1.0, human=human, swell=swell)
            q += step
            i += 1

    def drone(self, part, bar0, bar1, pitches, vel=56, swell=(60, 96, 70)):
        for x in pitches:
            self.note(part, self.pos(bar0), (bar1 - bar0) * self.bar_e, midi(x) if isinstance(x, str) else x,
                      vel, legato=1.01, human=0, swell=swell, vib=False)

    def drums(self, part, bar0, bar1, pattern, pitch, vel=90, human=0.006, every=1):
        """pattern: a string with one char per eighth across a bar (or several):
        'X' accent, 'x' normal, 'o' ghost, '.' rest, 'f' flam (two quick hits)."""
        n = len(pattern)
        bars = n / self.bar_e
        b = bar0
        while b < bar1 - 1e-6:
            for i, ch in enumerate(pattern):
                q = self.pos(b) + i
                if q >= self.pos(bar1) - 1e-6:
                    break
                if ch == ".":
                    continue
                v = {"X": vel + 18, "x": vel, "o": vel - 30, "f": vel + 8}[ch]
                pp = pitch(i) if callable(pitch) else pitch
                if ch == "f":
                    t = self.time(q)
                    self.parts[part].notes.append((max(0, t - 0.035), 0.2, pp, int(max(10, v - 25))))
                self.note(part, q, 1, pp, v, legato=1.5, human=human, swell=False)
            b += bars * every

    def finish(self, bars):
        self.length_e = bars * self.bar_e

    @property
    def length(self):
        return self.time(self.length_e)


# ---------------------------------------------------------------------------
# MIDI out
# ---------------------------------------------------------------------------
TPB = 22050          # at 120 bpm a tick is exactly one sample at 44.1 kHz


def _ticks(t):
    return int(round(t * SR))


# fluidsynth's MIDI player runs on whole milliseconds and renders in 64-sample
# blocks, so an event's real onset is quantised to both. Two copies of the loop
# only come out sample-identical if they are offset by a multiple of both:
# lcm(44.1 samples/ms -> 441 per 10 ms, 64) = 28224 samples, 0.64 s.
GRID = 28224


def loop_samples(song):
    """The loop length in samples, rounded to the render grid. The tempo is
    stretched by the same tiny factor (under 0.4%) so the music still fills it."""
    return max(GRID, int(round(song.length * SR / GRID)) * GRID)


def time_scale(song):
    return loop_samples(song) / (song.length * SR)


def write_midi(song, parts, path, copies=3):
    mf = mido.MidiFile(type=1, ticks_per_beat=TPB)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("set_tempo", tempo=500000, time=0))
    mf.tracks.append(meta)
    Ls = loop_samples(song)
    k_t = time_scale(song)
    ch_iter = iter([c for c in range(16) if c != 9])
    for part in parts:
        ch = next(ch_iter)
        cfg = part.cfg
        ev = []
        ev.append((0, 0, mido.Message("control_change", channel=ch, control=0, value=cfg["bank"] if cfg["bank"] < 128 else 0)))
        ev.append((0, 0, mido.Message("control_change", channel=ch, control=32, value=0)))
        ev.append((0, 1, mido.Message("program_change", channel=ch, program=cfg["prog"])))
        ev.append((0, 2, mido.Message("control_change", channel=ch, control=7, value=cfg["vol"])))
        ev.append((0, 2, mido.Message("control_change", channel=ch, control=10,
                                      value=int(max(0, min(127, 64 + cfg["pan"] * 63))))))
        ev.append((0, 2, mido.Message("control_change", channel=ch, control=11, value=110)))
        ev.append((0, 2, mido.Message("control_change", channel=ch, control=91, value=0)))
        ev.append((0, 2, mido.Message("control_change", channel=ch, control=93, value=0)))
        for k in range(copies):
            off = k * Ls + GRID
            for t, num, val in part.cc:
                ev.append((_ticks(t * k_t) + off, 3, mido.Message("control_change", channel=ch, control=num,
                                                            value=int(max(0, min(127, val))))))
            for t, val in part.bend:
                ev.append((_ticks(t * k_t) + off, 3, mido.Message("pitchwheel", channel=ch,
                                                            pitch=int(max(-8192, min(8191, val))))))
        # Notes as absolute sample ticks across all copies, then clip any note
        # that is still sounding when the same pitch strikes again: otherwise
        # its note-off lands after the new note-on and silences the new note.
        notes = []
        for k in range(copies):
            off = k * Ls + GRID
            for t, d, p, v in part.notes:
                if 0 <= p <= 127:
                    notes.append([_ticks(t * k_t) + off, _ticks((t + d) * k_t) + off, p, v])
        notes.sort()
        last = {}
        for n in notes:
            prev = last.get(n[2])
            if prev is not None and prev[1] >= n[0]:
                prev[1] = max(prev[0] + 1, n[0] - 1)
            last[n[2]] = n
        for on, offt, p, v in notes:
            ev.append((on, 4, mido.Message("note_on", channel=ch, note=p, velocity=v)))
            ev.append((offt, 0, mido.Message("note_off", channel=ch, note=p, velocity=0)))
        ev.sort(key=lambda e: (e[0], e[1]))
        tr = mido.MidiTrack()
        now = 0
        for tick, _, msg in ev:
            tr.append(msg.copy(time=max(0, tick - now)))
            now = max(now, tick)
        mf.tracks.append(tr)
    mf.save(path)


# ---------------------------------------------------------------------------
# Rooms. Synthetic impulse responses: decorrelated noise per channel, split in
# three bands that die at different rates (highs first, as in a real hall),
# a handful of early reflections and a pre-delay.
# ---------------------------------------------------------------------------
def make_ir(kind, seed=7):
    rng = np.random.default_rng(seed)
    if kind == "hall":
        rt = (3.4, 2.7, 1.5)
        pre, n_er, er_span = 0.024, 10, 0.085
        length = 3.6
    else:
        rt = (1.6, 1.2, 0.7)
        pre, n_er, er_span = 0.010, 8, 0.045
        length = 1.8
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    bands = [butter(2, 300, "low", fs=SR, output="sos"),
             butter(2, [300, 3500], "band", fs=SR, output="sos"),
             butter(2, 3500, "high", fs=SR, output="sos")]
    for c in range(2):
        noise = rng.standard_normal(n)
        acc = np.zeros(n)
        for sos, r in zip(bands, rt):
            acc += sosfilt(sos, noise) * np.exp(-6.91 * t / r)
        # soft onset so the tail blooms rather than clicks
        acc *= np.clip(t / 0.06, 0, 1) ** 1.5
        er = np.zeros(n)
        for _ in range(n_er):
            k = int((pre + rng.uniform(0, er_span)) * SR)
            er[k] += rng.uniform(0.3, 0.9) * rng.choice([-1, 1])
        sig = np.concatenate([np.zeros(int(pre * SR)), acc])[:n] + er * 0.6
        out[:, c] = sig
    out /= np.sqrt((out ** 2).sum(axis=0)).max()
    return out


def read_wav(path):
    sr, d = wavfile.read(path)
    assert sr == SR, (path, sr)
    d = d.astype(np.float64)
    if d.ndim == 1:
        d = np.stack([d, d], 1)
    return d


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{r.stderr[-2000:]}")
    return r


def loudness(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", txt)[-1])
    lra = float(re.findall(r"LRA:\s+(-?[\d.]+) LU", txt)[-1])
    pk = re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", txt)
    return i, lra, (float(pk[-1]) if pk and pk[-1] != "-inf" else None)


def render(song, out_mp3, target_lufs=-16.0, eq=None, width=1.15, bitrate="160k"):
    """MIDI per stem -> fluidsynth -> hall per stem -> mix -> master -> loop cut -> mp3."""
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(SF2):
        raise SystemExit(f"missing {SF2} — see the top of tools/music/build.py for how to fetch it")
    Ls = loop_samples(song)
    L = Ls / SR
    total = 3 * L + GRID / SR + 5.0
    nsamp = int(total * SR)
    by_stem = {}
    for p in song.parts.values():
        if p.notes:
            by_stem.setdefault(p.cfg["stem"], []).append(p)
    irs = {k: make_ir(k) for k in ("hall", "room")}
    mix = np.zeros((nsamp, 2))
    levels = {}
    for stem, parts in by_stem.items():
        mid = os.path.join(WORK, f"{song.name}-{stem}.mid")
        wav = os.path.join(WORK, f"{song.name}-{stem}.wav")
        write_midi(song, parts, mid)
        run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", "0.6", "-r", str(SR),
             "-o", "audio.file.format=float", "-o", "synth.polyphony=512", "-o", "audio.period-size=64",
             "-F", wav, SF2, mid])
        d = read_wav(wav)[:nsamp]
        d = np.pad(d, ((0, nsamp - len(d)), (0, 0)))
        cfg = STEMS[stem]
        ir = irs[cfg["ir"]]
        wet = np.stack([fftconvolve(d.mean(1) * 0.5 + d[:, c] * 0.5, ir[:, c])[:nsamp] for c in range(2)], 1)
        # keep the low end out of the hall — muddy reverb is the GM giveaway
        wet = sosfilt(butter(2, 180, "high", fs=SR, output="sos"), wet, axis=0)
        trim = 10 ** (getattr(song, "stem_gain", {}).get(stem, 0.0) / 20)
        contrib = (d * (1 - cfg["wet"] * 0.5) + wet * cfg["wet"] * 1.6) * trim
        mix += contrib
        levels[stem] = contrib
    tot = np.sqrt((mix ** 2).mean()) + 1e-12
    song.stem_db = {k: round(20 * np.log10(np.sqrt((v ** 2).mean()) / tot + 1e-12), 1) for k, v in levels.items()}
    del levels
    peak = np.abs(mix).max()
    mix *= 0.5 / max(peak, 1e-9)
    raw = os.path.join(WORK, f"{song.name}-mix.wav")
    wavfile.write(raw, SR, mix.astype(np.float32))

    # Master: clean the low end, take a little mud out, lift presence and air,
    # glue with a gentle compressor, open the stereo field a touch.
    eq = eq or []
    chain = ["highpass=f=32:p=2",
             "equalizer=f=280:t=q:w=1.0:g=-2.0",
             "equalizer=f=3000:t=q:w=1.0:g=1.2",
             "highshelf=f=9500:g=2.0",
             *eq,
             "acompressor=threshold=0.1:ratio=2.2:attack=30:release=350:knee=4",
             f"extrastereo=m={width}:c=false"]
    pre = os.path.join(WORK, f"{song.name}-pre.wav")
    run(["ffmpeg", "-y", "-hide_banner", "-i", raw, "-af", ",".join(chain), "-c:a", "pcm_f32le", pre])
    fin = os.path.join(WORK, f"{song.name}-final.wav")
    s0 = Ls + GRID
    # Measure exactly the window that will ship.
    win = os.path.join(WORK, f"{song.name}-win.wav")
    run(["ffmpeg", "-y", "-hide_banner", "-i", pre, "-af",
         f"atrim=start_sample={s0}:end_sample={s0 + Ls}", "-c:a", "pcm_f32le", win])
    measured, _, _ = loudness(win)
    gain = target_lufs - measured
    run(["ffmpeg", "-y", "-hide_banner", "-i", pre, "-af",
         f"volume={gain:.2f}dB,alimiter=limit=0.84:attack=4:release=60:level=false,"
         f"atrim=start_sample={s0}:end_sample={s0 + Ls + int(PAD * SR)},asetpts=PTS-STARTPTS",
         "-c:a", "pcm_f32le", fin])
    def encode(trim_db):
        run(["ffmpeg", "-y", "-hide_banner", "-i", fin, "-af", f"volume={trim_db:.2f}dB",
             "-c:a", "libmp3lame", "-b:a", bitrate, "-ar", str(SR), "-ac", "2",
             "-metadata", f"title={song.title}", "-metadata", "artist=Night Alone (original score)",
             "-metadata", "comment=Composed for dragon-flying-sim; rendered with GeneralUser GS",
             out_mp3])
        return loudness(out_mp3)
    i, lra, pk = encode(0.0)
    if abs(i - target_lufs) > 0.15:
        # the encoder shaves a fraction of a dB; put it back
        i, lra, pk = encode(target_lufs - i)
    return dict(file=os.path.basename(out_mp3), loop=round(L, 4), length=round(L + PAD, 3),
                lufs=i, lra=lra, peak=pk, stems=song.stem_db)


def solo_preview(song, part, out):
    """Just one part, dry, for checking a melody on its own."""
    os.makedirs(WORK, exist_ok=True)
    mid = os.path.join(WORK, f"{song.name}-{part}-solo.mid")
    write_midi(song, [song.parts[part]], mid, copies=1)
    run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", "0.6", "-r", str(SR), "-F", out, SF2, mid])
