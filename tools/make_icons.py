#!/usr/bin/env python3
"""
Build the favicon set from the game's own dragon.

The silhouette in assets/icon/dragon-plan.png is not drawn — it is a top-down
orthographic render of dragon_rigged_hd.glb with every material swapped for flat
white and the rest of the scene hidden, so the icon is THIS dragon rather than a
generic bat shape. tools/icon_silhouette.js is the probe that produced it and is
how to make a new one if the model changes.

The picture is him crossing the moon, which is the image the whole game is named
after. It is also the most legible thing available at sixteen pixels: one pale
disc, one dark shape on it, nothing else. Every version of this that had him
pale-on-dark, or had his wings running off the moon onto the night, turned to
mush at the small sizes — the wingtips are the thinnest part of the shape and
they are the first thing to go.

    python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "icon", "dragon-plan.png")

NIGHT = (10, 14, 24)        # the dark: matches the title screen's sky
NIGHT_EDGE = (4, 6, 11)
MOON = (233, 231, 242)
GLOW = (120, 138, 205)

SS = 8                      # supersample, then downscale. Cheap and much cleaner

# Per-size tuning, because one drawing does not survive an eight-fold range of
# resolution. At 192 px he can be 80% of the tile with a soft glow behind the
# moon and every scallop on his trailing edge reads. At 16 px that same drawing
# is a grey smudge: the wings are the thinnest part of the shape, they are the
# first thing a downscale eats, and the glow spends contrast the small sizes
# cannot afford.
#
# So the small ones get: a bigger moon, a bigger him, no glow, and a DILATION
# of the silhouette before it is scaled down — which thickens the wings and the
# tail fins by a pixel or so at final size and is the difference between a
# dragon and a dash.
#
# The corner radius is in here too, and at 16 px it is ZERO. A rounded square
# needs its corners antialiased, that antialiasing is dark, and at sixteen
# pixels it eats far enough into the tile to grey the edge of the moon — so the
# smallest size is full-bleed, which is what most favicons at that size are.
#
#          moon    him    glow  dilate  radius
TUNING = {
    16:  (0.560, 0.96, False, 15, 0.00),
    32:  (0.500, 0.90, False, 11, 0.13),
    48:  (0.475, 0.86, True,   7, 0.18),
    180: (0.455, 0.80, True,   0, 0.22),
    192: (0.455, 0.80, True,   0, 0.22),
    512: (0.455, 0.80, True,   0, 0.22),
}


def build(px, rounded=True, moon=True):
    moon_r, dragon_w, glow, dilate, radius = TUNING.get(px, (0.455, 0.80, True, 0, 0.22))
    S = px * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # --- Night ---------------------------------------------------------------
    # A vertical gradient rather than a flat fill: it is two colours a few
    # values apart and you would not name it, but a flat tile next to it looks
    # like a placeholder.
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)],
               fill=tuple(round(a + (b - a) * t) for a, b in zip(NIGHT, NIGHT_EDGE)))

    if moon:
        r = S * moon_r
        if glow:
            # The glow goes down before the disc, so the disc sits on top of it.
            g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            ImageDraw.Draw(g).ellipse(
                [S / 2 - r * 1.55, S / 2 - r * 1.55, S / 2 + r * 1.55, S / 2 + r * 1.55],
                fill=GLOW + (70,))
            g = g.filter(ImageFilter.GaussianBlur(S * 0.055))
            img = Image.alpha_composite(img, g)
            d = ImageDraw.Draw(img)

        # --- The moon --------------------------------------------------------
        d.ellipse([S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r], fill=MOON + (255,))

    # --- Him -----------------------------------------------------------------
    sil = Image.open(SRC).convert("RGBA")
    mask = sil.getchannel("A")
    mask = mask.crop(mask.getbbox())
    if dilate:
        # MaxFilter grows every lit pixel outward. Run at source resolution, so
        # the growth is smooth rather than blocky once it is scaled down.
        for _ in range(2):
            mask = mask.filter(ImageFilter.MaxFilter(dilate | 1))
    w = round(S * dragon_w)
    h = round(mask.height * w / mask.width)
    mask = mask.resize((w, h), Image.LANCZOS)
    # Painted in the SAME colour as the night behind the moon, so he reads as a
    # hole in the disc rather than as a sticker on it.
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    body.paste(NIGHT + (255,), ((S - w) // 2, (S - h) // 2), mask)
    img = Image.alpha_composite(img, body)

    if rounded and radius > 0:
        # A rounded square. Browsers draw a favicon square, so the rounding is
        # for the places that show it big — a bookmark bar, a tab strip, a
        # pinned tile — where a hard-cornered dark block looks unfinished.
        m = Image.new("L", (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius, fill=255)
        img.putalpha(m)

    return img.resize((px, px), Image.LANCZOS)


def main():
    out = os.path.join(ROOT, "assets", "icon")
    # The favicon proper, and the sizes browsers actually ask for.
    for px in (16, 32, 48, 180, 192, 512):
        # iOS applies its own mask to apple-touch-icon and does not want a
        # transparent surround, so 180 is square and full-bleed.
        img = build(px, rounded=(px != 180))
        img.save(os.path.join(out, f"icon-{px}.png"))
        print(f"  icon-{px}.png")

    # One .ico carrying the three small sizes, for anything old enough to look
    # for /favicon.ico by name rather than reading the <link> tags.
    build(64).save(os.path.join(ROOT, "favicon.ico"),
                   sizes=[(16, 16), (32, 32), (48, 48)])
    print("  favicon.ico")


if __name__ == "__main__":
    main()
