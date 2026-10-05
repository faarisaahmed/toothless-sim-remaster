"""
The score. Two themes and six arrangements of them.

Notation: NOTE:eighths, '|' barlines (checked), marks after the length —
~ roll, ' cut, ^ accent, , soft, / scoop, _ legato. See engine.Song.mel.

THE EMBERWING THEME (main theme), D Dorian, 6/8.

    | D4 A4 D5  A5.     | G5 F5 E5  D5      | C5 D5 E5 F5 G5 | A5..           |
    | D4 A4 D5  A5.     | C6 A5 G5  E5      | F5 G5 A5 G5 E5 | D5..           |
    | G4 D5 G5  D6.     | C6 B5 A5  G5      | F5 A5 C6.      | B5..           |
    | A5 C6 E6.         | D6 C6 A5  G5      | F5 G5 A5 G5 E5 | D5..           |

The hook is the first bar: three quick notes climbing a twelfth — the whole
open D-A-D-A of a fiddle's lower strings — then a held top note, like a horn
call thrown across a fjord. Everything after it falls back by step, so the leap
is earned and then paid for. Antecedent (bars 1-4) ends open on A; the
consequent repeats the call, reaches higher (C6), and closes on D with a little
cadential turn (F G A G E | D) that comes back at the very end of the tune. The
second half throws the call up a fourth, onto G — in Dorian that is the bright
major IV with its B natural, the sound that marks Dorian out — reaches the
peak, E6, three-quarters of the way through, and comes home with the same
cadential turn. Range D4-E6.

It is built to be transformed: in Dorian it is dark and proud; swap F for F#
and it is D Mixolydian, the same tune as a sunrise (the title's ending, the
flat-out climax); fill each held note with neighbour tones and it is a jig;
straighten it into 4/4 with B-flats and it is a war song (the raid).

THE HEARTH THEME (secondary, lyrical), G major with a Lydian C#, 3/4.

    | D5 - C#5 B4 | B4 A4 G4 | E4. G4 A4 | A4 -- |
    | D5 - E5 D5  | B4. A4 G4 | E4 G4 A4 B4 | G4 -- |

A slow polska-shaped tune. The C# — the raised fourth of G — is the Norwegian
fiddle colour; it sighs down into B and, in the second half, lifts back up into
D. Arch-shaped phrases, almost all steps, nothing outside an octave and a
sixth, so a single fiddle in a small room can carry it.

Everything here is original. No phrase is quoted or adapted from any existing
tune or film score.
"""
import re
from engine import Song

# --- The Emberwing theme -----------------------------------------------------
A1 = "D4:1 A4:1 D5:1 A5:3 | G5:2 F5:1 E5:2 D5:1 | C5:2 D5:1 E5:1 F5:1 G5:1 | A5:6"
A2 = "D4:1 A4:1 D5:1 A5:3 | C6:2 A5:1 G5:2 E5:1 | F5:2 G5:1 A5:1 G5:1 E5:1 | D5:6"
B1 = "G4:1 D5:1 G5:1 D6:3 | C6:2 B5:1 A5:2 G5:1 | F5:2 A5:1 C6:3 | B5:6"
B2 = "A5:2 C6:1 E6:3 | D6:2 C6:1 A5:2 G5:1 | F5:2 G5:1 A5:1 G5:1 E5:1 | D5:6"

# As a whistle or fiddle player would decorate it.
A1o = "D4:1 A4:1 D5:1 A5:3' | G5:2 F5:1 E5:2 D5:1 | C5:2 D5:1 E5:1 F5:1 G5:1 | A5:6~"
A2o = "D4:1 A4:1 D5:1 A5:3' | C6:2' A5:1 G5:2 E5:1 | F5:2' G5:1 A5:1 G5:1 E5:1 | D5:6~"
B1o = "G4:1 D5:1 G5:1 D6:3' | C6:2 B5:1 A5:2 G5:1 | F5:2' A5:1 C6:3 | B5:6/"
B2o = "A5:2 C6:1 E6:3' | D6:2 C6:1 A5:2' G5:1 | F5:2 G5:1 A5:1 G5:1 E5:1 | D5:6~"

# The jig: every held note filled with its neighbours.
JA1 = "D4:1 A4:1 D5:1 A5:1 B5:1 A5:1 | G5:2 F5:1 E5:2 D5:1 | C5:2 D5:1 E5:1 F5:1 G5:1 | A5:2 G5:1 A5:2 E5:1"
JA2 = "D4:1 A4:1 D5:1 A5:1 B5:1 A5:1 | C6:2' A5:1 G5:2 E5:1 | F5:2 G5:1 A5:1 G5:1 E5:1 | D5:3 B4:2 A4:1"
JB1 = "G4:1 D5:1 G5:1 D6:1 E6:1 D6:1 | C6:2 B5:1 A5:2 G5:1 | F5:2 A5:1 C6:2 A5:1 | B5:2 C6:1 B5:1 A5:1 G5:1"
JB2 = "A5:2 C6:1 E6:1 D6:1 E6:1 | D6:2 C6:1 A5:2' G5:1 | F5:2 G5:1 A5:1 G5:1 E5:1 | D5:3 D5:2 A4:1"

H_A1 = "Dm | C Am | F C | F G"
H_A2 = "Dm | F C | Dm C | Dm"
H_B1 = "G | C Am | F | G"
H_B2 = "F C | G Am | F C | Dm"
H_B2_EPIC = "F C | G Am | Bb C | Dm"

# Mixolydian: the same tune with F#, the bright version.
H_A1_MIX = "D | G Em | C Em | G A"
H_A2_MIX = "D | Am C | D C | D"
H_B1_MIX = "G | C Am | D | G"
H_B2_MIX = "C | G Am | D C | D"


def mixo(s):
    return re.sub(r"F(\d)", r"F#\1", s)


# --- The Hearth theme -------------------------------------------------------
L1 = "D5:4 C#5:1 B4:1 | B4:2 A4:2 G4:2 | E4:3 G4:1 A4:2 | A4:6"
L2 = "D5:4 E5:1 D5:1 | B4:3 A4:1 G4:2 | E4:2 G4:2 A4:1 B4:1 | G4:6"
L3 = "E5:3 D5:1 C5:2 | B4:4 D5:2 | C5:2 B4:2 A4:2 | A4:4 B4:1 C#5:1"
L4 = "D5:4 C#5:1 D5:1 | E5:3 D5:1 B4:2 | A4:2 B4:1 A4:1 F#4:2 | G4:6"
L1o = "D5:4' C#5:1 B4:1 | B4:2 A4:2 G4:2 | E4:3 G4:1 A4:2 | A4:6~"
L2o = "D5:4' E5:1 D5:1 | B4:3 A4:1 G4:2 | E4:2 G4:2 A4:1 B4:1 | G4:6"
L3o = "E5:3' D5:1 C5:2 | B4:4 D5:2 | C5:2 B4:2 A4:2 | A4:4 B4:1 C#5:1"
L4o = "D5:4~ C#5:1 D5:1 | E5:3' D5:1 B4:2 | A4:2 B4:1 A4:1 F#4:2 | G4:6~"
H_L = "G | Em | C | D | G | Em | C | G | C | G/B | Am | D | G | Em | D | G"
# A second voice under it, for when there are two players by the fire.
L_COUNTER = ("B4:6 | G4:4 B4:2 | G4:4 E4:2 | F#4:6 | B4:6 | G4:4 E4:2 | C4:3 D4:3 | D4:6 | "
             "G4:4 E4:2 | G4:6 | E4:6 | F#4:4 A4:2 | B4:6 | G4:3 B4:3 | F#4:4 D4:2 | D4:6")

# --- The Skerry jig: a second tune for flat out, D Mixolydian, fiddle-shaped.
SK_A = ("A4:1 D5:1 F#5:1 A5:2 F#5:1 | G5:2 E5:1 C5:2 E5:1 | A4:1 D5:1 F#5:1 A5:2 B5:1 | C6:2 B5:1 A5:2 G5:1 | "
        "F#5:2 D5:1 A4:2 D5:1 | G5:2 E5:1 C5:2 E5:1 | F#5:1 G5:1 A5:1 G5:1 E5:1 C5:1 | D5:2 E5:1 D5:3")
SK_B = ("D6:2 A5:1 F#5:2 A5:1 | C6:2 G5:1 E5:2 G5:1 | D6:2 A5:1 F#5:1 G5:1 A5:1 | B5:2 G5:1 E5:2 G5:1 | "
        "A5:2 F#5:1 D5:2 F#5:1 | G5:2 E5:1 C5:2 E5:1 | F#5:1 G5:1 A5:1 G5:1 E5:1 C5:1 | D5:2 E5:1 D5:3")
H_SK_A = "D | C | D | C | D | C | D C | D"
H_SK_B = "D | C | D | Em | D | C | D C | D"

# --- The raid: the Emberwing theme straightened into 4/4 and darkened.
RA1 = "D4:1 A4:1 D5:1 A5:5 | G5:2 F5:2 E5:2 D5:2 | C5:2 D5:1 E5:1 F5:2 G5:2 | A5:6 r:2"
RA2 = "D4:1 A4:1 D5:1 A5:5 | Bb5:3 A5:1 G5:2 E5:2 | F5:2 G5:1 A5:1 G5:2 E5:2 | D5:6 r:2"
RB1 = "G4:1 D5:1 G5:1 D6:5 | C6:2 Bb5:2 A5:2 G5:2 | F5:2 A5:1 C6:1 F5:2 E5:2 | E5:6 r:2"
RB2 = "A4:1 D5:1 F5:1 A5:5 | D6:2 C6:2 A5:2 G5:2 | F5:2 G5:1 A5:1 G5:2 E5:2 | D5:8"
H_RA1 = "Dm | Gm Am | F | A"
H_RA2 = "Dm | Gm C | Bb C | Dm"
H_RB1 = "Gm | C F | Dm A | A"
H_RB2 = "Dm | Bb F | Bb C | Dm"
REEL = ("D5:1 F5:1 A5:1 F5:1 D5:1 F5:1 A5:1 D6:1 | C6:1 G5:1 E5:1 G5:1 C5:1 E5:1 G5:1 C6:1 | "
        "D6:1 A5:1 F5:1 A5:1 D6:1 E6:1 F6:1 E6:1 | D6:1 C6:1 A5:1 G5:1 E5:1 G5:1 A5:2 | "
        "D5:1 F5:1 A5:1 F5:1 D5:1 F5:1 A5:1 D6:1 | C6:1 G5:1 E5:1 G5:1 C5:1 E5:1 G5:1 C6:1 | "
        "Bb5:1 A5:1 G5:1 F5:1 G5:1 A5:1 Bb5:1 C6:1 | D6:2 A5:1 F5:1 D5:4")
H_REEL = "Dm | C | Dm | Am | Dm | C | Bb C | Dm"


def theme(s, part, bar, parts=("A1", "A2", "B1", "B2"), ornate=False, mix=False, **kw):
    src = {"A1": A1o if ornate else A1, "A2": A2o if ornate else A2,
           "B1": B1o if ornate else B1, "B2": B2o if ornate else B2}
    for p in parts:
        line = mixo(src[p]) if mix else src[p]
        bar = s.mel(part, bar, line, **kw)
    return bar


def theme_harmony(s, bar, parts=("A1", "A2", "B1", "B2"), epic=False, mix=False):
    hs = {"A1": H_A1_MIX if mix else H_A1, "A2": H_A2_MIX if mix else H_A2,
          "B1": H_B1_MIX if mix else H_B1,
          "B2": H_B2_MIX if mix else (H_B2_EPIC if epic else H_B2)}
    for p in parts:
        bar = s.harmony(bar, hs[p])
    return bar


ARP68 = [0, 2, 3, 4, 3, 2]          # harp in 6/8: open fifth at the bottom, up and back
ARP68_WIDE = [0, 2, 3, 4, 5, 3]
ARP34 = [0, 2, 3, 4, 3, 2]


# =============================================================================
# TITLE — dark to hopeful. The theme alone on a fiddle over drones, the second
# half on a whistle as the strings come in, then the whole tune again in
# Mixolydian on horns: the same melody with its minor third lifted.
# =============================================================================
def title():
    s = Song("title", bar=6, beat=3, spe=0.44, seed=11)
    s.title = "Emberwing (Title)"
    for n in ("fiddle", "whistle", "voice", "horn", "horns", "strings", "cello", "contrabass",
              "harp", "oohs", "choir", "timpani"):
        s.part(n)
    s.part("fdrone", "fiddle", pan=0.18, vol=70)

    # 0-2: the open fifth, and a call from far off.
    s.harmony(0, "Dm | Dm | Dm")
    s.drone("contrabass", 0, 11, ["D2"], vel=58)
    s.drone("cello", 0, 11, ["A2", "D3"], vel=46)
    s.drone("oohs", 0, 3, ["D4", "A4"], vel=36)
    s.note("timpani", 0, 3, 38, 52, human=0)
    s.mel("voice", 0, "r:2 A5:4/ | D6:3_ C6:1 A5:2 | A5:4, r:2", vel=58, legato=1.0)

    # 3-10: the theme, alone. A fiddle with an open string ringing under it.
    b = 3
    theme_harmony(s, b, ("A1", "A2"))
    theme(s, "fiddle", b, ("A1", "A2"), ornate=True, vel=80, legato=1.0)
    for k in range(4):
        s.drone("fdrone", b + 2 * k, b + 2 * k + 2, ["A4" if k % 2 == 0 else "D4"], vel=34)
    s.drone("oohs", 3, 7, ["D4", "A4"], vel=30)
    s.pad("strings", 7, 11, 50, 64, vel=40, swell=(50, 86, 60))
    s.rit(9.5, 11, 0.44, 0.52)
    s.set_tempo(11, 0.44)

    # 11-18: the second half on whistle; strings and harp come in.
    b = 11
    theme_harmony(s, b, ("B1", "B2"), epic=True)
    theme(s, "whistle", b, ("B1", "B2"), ornate=True, vel=82, legato=1.0)
    s.pad("strings", 11, 19, 52, 69, vel=52)
    s.arp("harp", 11, 19, ARP68, lo=38, vel=54)
    s.bassline("cello", 11, 19, lo=38, vel=62, rhythm=(6,), legato=1.0)
    s.bassline("contrabass", 15, 19, lo=26, vel=58, rhythm=(6,), legato=1.0)
    s.note("timpani", s.pos(17, 3), 3, 45, 64, human=0)
    s.note("timpani", s.pos(18), 3, 38, 78, human=0)
    s.rit(17, 19, 0.44, 0.54)
    s.set_tempo(19, 0.42)

    # 19-26: the same tune, Mixolydian, on horns — the sun comes up.
    b = 19
    theme_harmony(s, b, ("A1", "A2"), mix=True)
    theme(s, "horns", b, ("A1", "A2"), mix=True, vel=82, transpose=-12, legato=1.0, accent=False)
    theme(s, "whistle", b, ("A1", "A2"), ornate=True, mix=True, vel=72, legato=1.0)
    s.pad("strings", 19, 27, 50, 71, vel=62)
    s.pad("choir", 21, 27, 55, 69, vel=48)
    s.arp("harp", 19, 27, ARP68_WIDE, lo=38, vel=60)
    s.bassline("cello", 19, 27, lo=38, vel=68, rhythm=(3, 3))
    s.bassline("contrabass", 19, 27, lo=26, vel=64, rhythm=(6,), legato=1.0)
    s.note("timpani", s.pos(19), 3, 38, 80, human=0)
    s.note("timpani", s.pos(23), 3, 38, 74, human=0)
    s.rit(25, 27, 0.42, 0.56)
    s.set_tempo(27, 0.46)

    # 27-30: coda in D major, then the third falls back to F and the dark returns.
    s.harmony(27, "D | D | Dm | Dm")
    s.drone("strings", 27, 29, ["D3", "F#3", "A3", "D4", "F#4"], vel=56, swell=(90, 100, 50))
    s.drone("choir", 27, 29, ["A4", "D5"], vel=40, swell=(80, 90, 40))
    s.mel("harp", 27, "D4:1 A4:1 D5:1 A5:3 | r:6 | D4:1 A4:1 D5:1 F5:3, | r:6", vel=58, legato=2.5)
    s.mel("horn", 28, "D4:1 A3:1 D4:1 A4:3, | r:6", vel=48, transpose=0, legato=1.0)
    s.drone("contrabass", 27, 33, ["D2"], vel=56)
    s.drone("cello", 29, 33, ["A2"], vel=40)
    s.drone("oohs", 29, 33, ["D4", "F4", "A4"], vel=30)
    s.mel("voice", 30, "r:3 A5:3/, | D6:4 A5:2, | r:6", vel=44, legato=1.0)
    s.finish(33)
    s.target = -17.0
    return s


# =============================================================================
# PROLOGUE — one room, one fire. The Hearth theme on fiddle, then whistle with
# the fiddle under it. Harp, a cello and almost nothing else.
# =============================================================================
def prologue():
    s = Song("prologue", bar=6, beat=2, spe=0.37, seed=23)
    s.title = "The Hearth (Prologue)"
    for n in ("fiddle", "whistle", "harp", "cello", "strings", "dulcimer"):
        s.part(n)
    s.part("fiddle2", "fiddle", pan=-0.22, vol=88)

    s.harmony(0, "G | C")
    b = s.harmony(2, H_L)
    s.harmony(18, "C | D")
    s.harmony(20, H_L)

    s.arp("harp", 0, 36, ARP34, lo=43, vel=52)
    s.bassline("cello", 2, 18, lo=36, vel=50, rhythm=(6,), legato=1.0)
    s.bassline("cello", 20, 36, lo=36, vel=56, rhythm=(4, 2), legato=1.0)
    s.pad("strings", 10, 18, 50, 62, vel=32, swell=(40, 70, 45))
    s.pad("strings", 20, 36, 50, 64, vel=38, swell=(45, 80, 50))

    # First time: the fiddle alone.
    bb = 2
    for line in (L1o, L2o, L3o, L4o):
        bb = s.mel("fiddle", bb, line, vel=74, legato=1.0, human=0.014)
    s.rit(16, 18, 0.37, 0.44)
    s.set_tempo(18, 0.37)
    # Between verses: a few notes on the dulcimer, the first phrase's echo.
    s.mel("dulcimer", 18, "D5:4 C#5:1 B4:1 | A4:6", vel=52, legato=2.0)
    # Second time: whistle above, fiddle beneath.
    bb = 20
    for line in (L1o, L2o, L3o, L4o):
        bb = s.mel("whistle", bb, line, vel=76, legato=1.0, human=0.012)
    s.mel("fiddle2", 20, L_COUNTER, vel=60, legato=1.0, human=0.016)
    s.rit(34, 36, 0.37, 0.46)
    s.finish(36)
    s.target = -18.0
    return s


# =============================================================================
# FLIGHT — the archipelago. Most of the game, so it breathes: a quiet harp
# opening, the theme on a whistle, the Hearth theme on fiddle, a horn call that
# climbs through three keys, the theme in full, a high call over nothing, the
# Hearth theme on the whole string section, and the theme's second half as the
# peak before it all settles back to the harp.
# =============================================================================
def flight():
    s = Song("flight", bar=6, beat=3, spe=0.303, seed=37)
    s.title = "Emberwing (Flight)"
    for n in ("whistle", "fiddle", "voice", "horns", "horn", "strings", "fstrings", "cello",
              "contrabass", "harp", "choir", "oohs", "timpani", "tom", "taiko", "trem"):
        s.part(n)
    s.part("violins", "fstrings", pan=-0.2, vol=96)
    bodh = lambda i: 45 if i in (0, 3) else 50

    # 0-3 intro
    s.harmony(0, "Dm | C | F | G")
    s.arp("harp", 0, 4, ARP68_WIDE, lo=38, vel=56)
    s.pad("strings", 0, 4, 50, 64, vel=38, swell=(40, 80, 60))
    s.drone("contrabass", 0, 4, ["D2"], vel=44)

    # 4-19 theme on whistle
    theme_harmony(s, 4)
    theme(s, "whistle", 4, ornate=True, vel=84, legato=1.0)
    s.arp("harp", 4, 20, ARP68, lo=38, vel=54)
    s.bassline("cello", 4, 20, lo=38, vel=58, rhythm=(3, 3))
    s.pad("strings", 4, 20, 50, 66, vel=44)
    s.drums("tom", 12, 20, "XoxXox", bodh, vel=48)

    # 20-35 the Hearth theme on fiddle, the strings answering underneath
    s.harmony(20, H_L)
    bb = 20
    for line in (L1o, L2o, L3o, L4o):
        bb = s.mel("fiddle", bb, line, vel=80, legato=1.0)
    s.mel("violins", 28, " | ".join(L_COUNTER.split(" | ")[8:]), vel=46, legato=1.02)
    s.arp("harp", 20, 36, ARP34, lo=43, vel=50, step=1.0)
    s.bassline("cello", 20, 36, lo=36, vel=56, rhythm=(6,), legato=1.0)
    s.pad("strings", 20, 36, 50, 64, vel=42)
    s.drums("tom", 28, 36, "Xo.xo.", bodh, vel=42)

    # 36-39 the call climbs: D, F, G, then A major to pull home.
    s.harmony(36, "Dm | F | G | A")
    s.mel("horns", 36, "D3:1 A3:1 D4:1 A4:3 | F3:1 C4:1 F4:1 C5:3 | G3:1 D4:1 G4:1 D5:3 | A3:1 E4:1 A4:1 C#5:3",
          vel=84, legato=1.0)
    s.pad("trem", 36, 40, 50, 64, vel=50, swell=(40, 110, 120))
    s.bassline("contrabass", 36, 40, lo=26, vel=62, rhythm=(6,), legato=1.0)
    s.drums("timpani", 39, 40, "xxxxXX", 45, vel=60)

    # 40-55 the theme in full
    theme_harmony(s, 40, epic=True)
    theme(s, "violins", 40, vel=86, legato=1.02, accent=False)
    theme(s, "horns", 40, vel=82, transpose=-12, legato=1.0, accent=False)
    theme(s, "whistle", 48, ("B1", "B2"), ornate=True, vel=80, transpose=0)
    s.pad("choir", 40, 56, 55, 69, vel=50)
    s.pad("strings", 40, 56, 48, 64, vel=50)
    s.arp("harp", 40, 56, ARP68_WIDE, lo=38, vel=58)
    s.bassline("cello", 40, 56, lo=38, vel=70, rhythm=(2, 1, 3))
    s.bassline("contrabass", 40, 56, lo=26, vel=66, rhythm=(3, 3))
    s.drums("tom", 40, 56, "XoxXox", bodh, vel=60)
    s.drums("taiko", 40, 56, "X.....x.....", 50, vel=58)
    for k in (40, 47, 48, 55):
        s.note("timpani", s.pos(k), 3, 38 if k != 47 else 43, 78, human=0)

    # 56-59 a breath: one high call over the open fifth
    s.harmony(56, "Dm | Dm | G | D")
    s.drone("contrabass", 56, 60, ["D2"], vel=46)
    s.drone("oohs", 56, 60, ["D4", "A4"], vel=34)
    s.mel("voice", 56, "r:3 A5:3/ | D6:4_ C6:1 A5:1 | B5:6/, | r:6", vel=60, legato=1.0)
    s.arp("harp", 58, 60, [5, 4, 3, 2, 1, 0], lo=38, vel=46)

    # 60-75 the Hearth theme on the whole section, whistle above
    s.harmony(60, H_L)
    bb = 60
    for line in (L1, L2, L3, L4):
        s.mel("fstrings", bb, line, vel=78, transpose=12, legato=1.03, accent=False)
        bb = s.mel("violins", bb, line, vel=82, legato=1.03, accent=False)
    s.mel("horns", 60, L_COUNTER, vel=56, transpose=-12, legato=1.0, accent=False)
    s.pad("choir", 64, 76, 55, 67, vel=44)
    s.arp("harp", 60, 76, ARP34, lo=43, vel=56)
    s.bassline("cello", 60, 76, lo=36, vel=66, rhythm=(4, 2))
    s.bassline("contrabass", 60, 76, lo=24, vel=60, rhythm=(6,), legato=1.0)
    s.drums("tom", 68, 76, "Xo.xo.", bodh, vel=50)

    # 76-83 the second half of the main theme: the peak
    theme_harmony(s, 76, ("B1", "B2"), epic=True)
    theme(s, "whistle", 76, ("B1", "B2"), ornate=True, vel=88)
    theme(s, "violins", 76, ("B1", "B2"), vel=86, legato=1.02, accent=False)
    theme(s, "horns", 76, ("B1", "B2"), vel=86, transpose=-12, legato=1.0, accent=False)
    s.pad("choir", 76, 84, 55, 71, vel=56)
    s.pad("strings", 76, 84, 48, 64, vel=54)
    s.arp("harp", 76, 84, ARP68_WIDE, lo=38, vel=60)
    s.bassline("cello", 76, 84, lo=38, vel=72, rhythm=(2, 1, 3))
    s.bassline("contrabass", 76, 84, lo=26, vel=68, rhythm=(3, 3))
    s.drums("tom", 76, 83, "XoxXox", bodh, vel=62)
    s.drums("taiko", 76, 83, "X.....x.....", 50, vel=62)
    s.note("timpani", s.pos(83), 6, 38, 82, human=0)

    # 84-87 settle back to the harp
    s.harmony(84, "Dm | C | F | G")
    s.arp("harp", 84, 88, ARP68_WIDE, lo=38, vel=50)
    s.drone("strings", 84, 86, ["D3", "A3", "D4", "F4"], vel=40, swell=(70, 60, 30))
    s.pad("strings", 86, 88, 50, 64, vel=34, swell=(30, 70, 50))
    s.drone("contrabass", 84, 88, ["D2"], vel=42)
    s.finish(88)
    s.target = -16.0
    return s


# =============================================================================
# FLAT OUT — the theme as a jig at 112, then a second tune of its own (the
# Skerry jig, D Mixolydian), the theme with horns under it, a drum break, and
# the theme in Mixolydian as the top of the climb.
# =============================================================================
def flatout():
    s = Song("flatout", bar=6, beat=3, spe=0.1786, seed=41)
    s.title = "Emberwing Jig (Flat Out)"
    for n in ("whistle", "fiddle", "horns", "brass", "strings", "fstrings", "cello", "contrabass",
              "guitar", "harp", "choir", "pipes", "tom", "taiko", "bassdrum", "tambourine", "timpani"):
        s.part(n)
    bodh = lambda i: 45 if i in (0, 3) else (50 if i in (2, 5) else 52)
    strum = "X.xX.x"

    # 0-3 intro: drums, drone, strummed chords
    s.harmony(0, "Dm | C | Dm | C")
    s.drums("tom", 0, 4, "XoxXox", bodh, vel=70)
    s.drums("bassdrum", 0, 4, "X.....", 36, vel=70)
    s.drone("pipes", 0, 4, ["D3"], vel=42, swell=(60, 90, 70))
    s.arp("guitar", 2, 4, [0, None, 2, 1, None, 2], lo=50, vel=62, legato=1.2)

    def backing(b0, b1, big=False):
        s.arp("guitar", b0, b1, [0, None, 2, 1, None, 3], lo=50, vel=66, legato=1.2)
        s.bassline("cello", b0, b1, lo=38, vel=70, rhythm=(2, 1, 2, 1))
        s.drums("tom", b0, b1, "XoxXox", bodh, vel=72)
        s.drums("bassdrum", b0, b1, "X..x..", 36, vel=72 if big else 60)
        if big:
            s.bassline("contrabass", b0, b1, lo=26, vel=72, rhythm=(3, 3))
            s.drums("taiko", b0, b1, "X.....x.....", 50, vel=66)
            s.drums("tambourine", b0, b1, ".x..x.", 60, vel=52)

    # 4-19 the theme as a jig, whistle and fiddle together
    b = theme_harmony(s, 4)
    for line, bb in ((JA1, 4), (JA2, 8), (JB1, 12), (JB2, 16)):
        s.mel("whistle", bb, line, vel=86, legato=0.9)
        s.mel("fiddle", bb, line, vel=78, legato=0.95, human=0.011)
    backing(4, 20)
    s.pad("strings", 12, 20, 52, 66, vel=44)

    # 20-35 the Skerry jig: fiddle leads, whistle joins for the high part
    s.harmony(20, H_SK_A)
    s.harmony(28, H_SK_B)
    s.mel("fiddle", 20, SK_A, vel=84, legato=0.95)
    s.mel("fiddle", 28, SK_B, vel=86, legato=0.95)
    s.mel("whistle", 28, SK_B, vel=80, legato=0.9)
    backing(20, 36)
    s.drums("tambourine", 28, 36, ".x..x.", 60, vel=48)
    s.pad("brass", 28, 36, 50, 62, vel=60, swell=(70, 100, 80))

    # 36-51 the theme again: the jig on top, the plain tune on horns underneath
    theme_harmony(s, 36, epic=True)
    for line, bb in ((JA1, 36), (JA2, 40), (JB1, 44), (JB2, 48)):
        s.mel("whistle", bb, line, vel=88, legato=0.9)
        s.mel("fiddle", bb, line, vel=80, legato=0.95, human=0.011)
    theme(s, "horns", 36, vel=88, transpose=-12, legato=1.0, accent=False)
    s.pad("strings", 36, 52, 52, 69, vel=56)
    s.pad("choir", 44, 52, 55, 69, vel=50)
    backing(36, 52, big=True)

    # 52-55 drum break, the call on pipes
    s.harmony(52, "Dm | Dm | C | A")
    s.drums("tom", 52, 56, "XxxXxx", bodh, vel=78)
    s.drums("taiko", 52, 56, "X..X..", 48, vel=72)
    s.drums("bassdrum", 52, 56, "X.....", 36, vel=78)
    s.mel("pipes", 52, "D4:1 A4:1 D5:1 A5:3 | r:6 | C4:1 G4:1 C5:1 G5:3 | A4:1 C#5:1 E5:1 A5:3", vel=70, legato=0.95)
    s.drone("contrabass", 52, 56, ["D2"], vel=60)
    s.drums("timpani", 55, 56, "xxXxXX", 45, vel=70)

    # 56-71 the theme in Mixolydian: the climb tops out
    theme_harmony(s, 56, mix=True)
    for line, bb in ((JA1, 56), (JA2, 60), (JB1, 64), (JB2, 68)):
        s.mel("whistle", bb, mixo(line), vel=90, legato=0.9)
        s.mel("fiddle", bb, mixo(line), vel=82, legato=0.95, human=0.011)
        s.mel("fstrings", bb, mixo(line), vel=70, transpose=-12, legato=0.95, accent=False)
    theme(s, "horns", 56, mix=True, vel=90, transpose=-12, legato=1.0, accent=False)
    s.pad("choir", 56, 72, 55, 71, vel=56)
    s.pad("strings", 56, 72, 50, 66, vel=56)
    backing(56, 72, big=True)

    # 72-79 the Skerry jig once more, everyone
    s.harmony(72, H_SK_A)
    s.mel("fiddle", 72, SK_A, vel=88, legato=0.95)
    s.mel("whistle", 72, SK_A, vel=84, legato=0.9)
    s.pad("brass", 72, 80, 50, 64, vel=68, swell=(80, 110, 90))
    backing(72, 80, big=True)

    # 80-83 the call, all together, and a fill back to the top
    s.harmony(80, "Dm | Dm | C | C")
    s.mel("brass", 80, "D4:1 A4:1 D5:1 A5:3^ | r:6 | C4:1 G4:1 C5:1 G5:3^ | r:6", vel=92, legato=0.9)
    s.mel("fiddle", 80, "D4:1 A4:1 D5:1 A5:3^ | r:6 | C4:1 G4:1 C5:1 G5:3^ | r:6", vel=86, legato=0.9)
    s.drums("taiko", 80, 82, "X..X..", 48, vel=80)
    s.drums("tom", 82, 84, "XxxXxx", bodh, vel=82)
    s.drums("timpani", 83, 84, "xxXxXX", 38, vel=74)
    s.drone("pipes", 82, 84, ["D3"], vel=40, swell=(60, 90, 70))
    s.finish(84)
    s.target = -16.0
    s.stem_gain = {"drums": -5.0, "lead": 1.5, "low": 1.5}
    return s


# =============================================================================
# RAID — 4/4 at 144. Taiko and bass drum in 3+3+2, a low ostinato on the open
# fifth, the theme in the brass in D minor with a flat sixth where the C used
# to be, the fiddle tearing through a reel, the pipes.
# =============================================================================
def raid():
    s = Song("raid", bar=8, beat=2, spe=0.2083, seed=53)
    s.title = "Emberwing (Raid)"
    for n in ("brass", "horns", "horn", "trombone", "tuba", "fiddle", "pipes", "fstrings", "strings",
              "cello", "contrabass", "choir", "taiko", "bassdrum", "tom", "timpani", "trem"):
        s.part(n)
    s.part("ost", "fstrings", pan=-0.15, vol=95)

    TAIKO = "X..x..x.X..X.xx."
    def ostinato(b0, b1, vel=70):
        offs = [0, 0, 7, 0, 0, 10, 0, 7]
        q = s.pos(b0)
        while q < s.pos(b1) - 1e-6:
            c = s.chord_at(q)
            i = int(q) % 8
            from engine import bass_of
            root = bass_of(c[2], 38)
            minor = c[2].endswith("m")
            o = offs[i] if (i != 5 or minor) else 12
            v = vel + (14 if i in (0, 3, 6) else 0)
            s.note("cello", q, 1, root + o, v, legato=0.7, human=0.005, swell=False)
            s.note("ost", q, 1, root + 12 + o, v - 10, legato=0.6, human=0.005, swell=False)
            if i in (0, 3, 6):
                s.note("contrabass", q, 2 if i == 6 else 1.5, root - 12, v - 4, legato=0.9, human=0.004, swell=False)
            q += 1

    def drums(b0, b1, vel=80, fill=True):
        s.drums("taiko", b0, b1, TAIKO, 45, vel=vel)
        s.drums("bassdrum", b0, b1, "X.....x.", 36, vel=vel)
        if fill:
            s.drums("tom", b1 - 1, b1, "....xxXX", lambda i: 45 + (i - 4) * 2, vel=vel)

    # 0-3 drums alone
    s.harmony(0, "Dm | Dm | Dm | Dm")
    drums(0, 4, vel=74)
    s.drums("timpani", 0, 4, "X.......", 38, vel=70)
    s.drone("trem", 2, 4, ["D3", "A3"], vel=50, swell=(30, 110, 120))

    # 4-7 the ostinato
    s.harmony(4, "Dm | Bb | Gm | A")
    ostinato(4, 8, vel=64)
    drums(4, 8, vel=78)

    # 8-15 the theme in the brass
    s.harmony(8, H_RA1)
    s.harmony(12, H_RA2)
    s.mel("horns", 8, RA1 + " | " + RA2, vel=90, transpose=-12, legato=0.98)
    s.mel("trombone", 8, RA1 + " | " + RA2, vel=86, transpose=-24, legato=0.98)
    s.bassline("tuba", 8, 16, lo=26, vel=74, rhythm=(3, 3, 2))
    ostinato(8, 16)
    drums(8, 16, vel=84)
    s.pad("choir", 12, 16, 55, 69, vel=60)

    # 16-23 again, strings and fiddle on top, brass punching the 3+3+2
    s.harmony(16, H_RA1)
    s.harmony(20, H_RA2)
    s.mel("fstrings", 16, RA1 + " | " + RA2, vel=88, legato=0.98, accent=False)
    s.mel("fiddle", 16, RA1 + " | " + RA2, vel=84, transpose=0, legato=0.95)
    s.mel("horns", 16, RA1 + " | " + RA2, vel=84, transpose=-12, legato=0.98)
    for b in range(16, 24):
        for i in (0, 3, 6):
            c = s.chord_at(s.pos(b, i))[2]
            from engine import tones_in
            for x in tones_in(c, 50, 62):
                s.note("brass", s.pos(b, i), 1.5, x, 84 if i == 0 else 76, legato=0.6, swell=False)
    s.pad("choir", 16, 24, 55, 71, vel=64)
    ostinato(16, 24)
    drums(16, 24, vel=88)

    # 24-31 the reel, and the pipes
    s.harmony(24, H_REEL)
    s.mel("fiddle", 24, REEL, vel=90, legato=0.9)
    s.drone("pipes", 24, 32, ["D3", "A3"], vel=40, swell=(70, 95, 80))
    ostinato(24, 32, vel=66)
    drums(24, 32, vel=82)
    s.pad("strings", 28, 32, 50, 64, vel=50)

    # 32-39 the second half, low brass and strings
    s.harmony(32, H_RB1)
    s.harmony(36, H_RB2)
    s.mel("horns", 32, RB1 + " | " + RB2, vel=92, transpose=-12, legato=0.98)
    s.mel("trombone", 32, RB1 + " | " + RB2, vel=88, transpose=-24, legato=0.98)
    s.mel("fstrings", 32, RB1 + " | " + RB2, vel=86, legato=0.98, accent=False)
    s.bassline("tuba", 32, 40, lo=26, vel=78, rhythm=(3, 3, 2))
    s.pad("choir", 32, 40, 55, 72, vel=68)
    ostinato(32, 40)
    drums(32, 40, vel=90)
    for k in (32, 36, 39):
        s.note("timpani", s.pos(k), 4, 38 if k != 32 else 43, 90, human=0)

    # 40-47 everyone: the theme at full height
    s.harmony(40, H_RA1)
    s.harmony(44, H_RA2)
    for part, tr, v in (("horns", 0, 94), ("trombone", -12, 90), ("fstrings", 0, 90),
                        ("fiddle", 0, 88), ("choir", -12, 70), ("pipes", 0, 56)):
        s.mel(part, 40, RA1 + " | " + RA2, vel=v, transpose=tr, legato=0.98, accent=part != "choir")
    s.bassline("tuba", 40, 48, lo=26, vel=82, rhythm=(3, 3, 2))
    s.pad("strings", 40, 48, 50, 64, vel=60)
    ostinato(40, 48, vel=74)
    drums(40, 48, vel=94)

    # 48-55 breakdown: horn calls and pipe answers over the ostinato
    s.harmony(48, "Dm | Dm | Bb | C | Dm | Dm | Gm | A")
    s.mel("horn", 48, "D3:1 A3:1 D4:1 A4:5 | r:8 | F3:1 C4:1 F4:1 C5:5 | r:8 | "
          "D3:1 A3:1 D4:1 A4:5 | r:8 | G3:1 D4:1 G4:1 D5:5 | E4:8", vel=86, legato=0.98)
    s.mel("pipes", 49, "r:2 A5:3 D5:3 | r:8 | r:2 C6:3 F5:3 | r:8 | r:2 A5:3 D5:3", vel=58, legato=0.95)
    ostinato(48, 56, vel=62)
    s.drums("taiko", 48, 56, TAIKO, 45, vel=70)
    s.drums("tom", 55, 56, "xxxxXXXX", lambda i: 43 + i, vel=82)

    # 56-59 the last phrase, tutti
    s.harmony(56, H_RB2)
    for part, tr, v in (("horns", -12, 94), ("trombone", -24, 90), ("fstrings", 0, 90), ("fiddle", 0, 88)):
        s.mel(part, 56, RB2, vel=v, transpose=tr, legato=0.98)
    s.pad("choir", 56, 60, 55, 72, vel=70)
    s.bassline("tuba", 56, 60, lo=26, vel=82, rhythm=(3, 3, 2))
    ostinato(56, 60, vel=74)
    drums(56, 60, vel=94, fill=False)
    s.note("timpani", s.pos(59), 8, 38, 96, human=0)

    # 60-63 the ostinato falls back to the drums
    s.harmony(60, "Dm | Dm | Dm | Dm")
    ostinato(60, 64, vel=58)
    drums(60, 64, vel=78)
    s.finish(64)
    s.target = -15.5
    s.stem_gain = {"drums": -4.5, "low": 3.0, "lead": 3.0, "strings": 1.5}
    return s


# =============================================================================
# TENSION — being seen is the thing at stake. An open fifth that never moves,
# glassy harmonics, a raised fourth that turns the Norwegian colour eerie, a
# heartbeat on the timpani, fragments of the call on harp and far-off horn.
# =============================================================================
def tension():
    s = Song("tension", bar=8, beat=2, spe=0.5556, seed=67)
    s.title = "Held Breath (Tension)"
    for n in ("contrabass", "cello", "glass", "trem", "harp", "pizz", "shakuhachi", "horn", "timpani",
              "taiko", "oohs"):
        s.part(n)

    for b in range(0, 22, 4):
        s.drone("contrabass", b, min(b + 4, 22), ["D2"], vel=50, swell=(40, 80, 50))
    s.drone("cello", 2, 10, ["A2"], vel=36, swell=(30, 70, 40))
    s.drone("cello", 12, 20, ["A2"], vel=36, swell=(30, 70, 40))
    s.drone("glass", 2, 10, ["A5", "E6"], vel=42, swell=(30, 80, 30))
    s.drone("glass", 10, 14, ["G#5", "D6"], vel=40, swell=(30, 78, 30))
    s.drone("glass", 15, 21, ["A5", "D6"], vel=40, swell=(30, 76, 20))
    s.drone("trem", 6, 8, ["D3", "F3"], vel=50, swell=(10, 90, 20))
    s.drone("trem", 14, 16, ["D3", "G#3"], vel=52, swell=(10, 95, 20))
    s.drone("oohs", 17, 21, ["D4", "A4"], vel=28, swell=(20, 60, 20))

    # Heartbeat
    for b in range(0, 22, 2):
        if b in (8, 16):
            continue
        s.note("timpani", s.pos(b), 1, 38, 46, human=0.004, swell=False)
        s.note("timpani", s.pos(b, 1.2), 1, 38, 34, human=0.004, swell=False)

    # The call, broken into pieces and left hanging
    s.mel("harp", 1, "r:4 D4:2 A4:2 | r:8 | r:6 D5:2 | A4:8 | r:8 | F4:3 E4:5 | r:8 | r:8 |"
          " r:4 G#4:2 A4:2 | r:8 | r:8 | D5:2 A4:2 G#4:4 | r:8 | r:8 | r:6 D4:2 | A4:8",
          vel=56, legato=3.0, accent=False)
    s.mel("pizz", 3, "D3:2 r:6 | r:8 | A2:2 r:6 | r:8 | r:8 | D3:2 r:6 | r:8 | r:8 | r:8 | A2:2 r:2 D3:2 r:2",
          vel=56, accent=False)
    s.mel("shakuhachi", 8, "r:2 A4:6/ | G#4:4 A4:4 | r:8", vel=58, legato=1.0, accent=False)
    s.mel("horn", 12, "D3:2 A3:2 D4:4 | A4:8, | r:8", vel=44, legato=1.0, accent=False)
    s.mel("shakuhachi", 18, "r:4 D5:4/ | C5:2 A4:6 | r:8", vel=52, legato=1.0, accent=False)
    s.note("taiko", s.pos(16), 4, 40, 62, human=0, swell=False)
    s.finish(22)
    s.target = -19.0
    return s


TRACKS = {"title": title, "prologue": prologue, "flight": flight, "flatout": flatout,
          "raid": raid, "tension": tension}
