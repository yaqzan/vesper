#!/usr/bin/env python3
"""Generate Vesper's app icons programmatically with Pillow.

Concept: a gold crescent (the moon / Vesper, the evening star) with a single
horizontal voice waveform passing *through* it. Two-tone — gold on near-black —
with a bold silhouette that survives iOS's rounded-square home-screen crop and
still reads at 32px.

The trick: the gold region is (crescent XOR wave). Where the wave crosses the
moon it carves a dark slit (reads as "passing through"); to the left and right
of the moon the wave is gold against the dark field.

Run:  python3 scripts/generate_icons.py
Output: frontend/public/icon-192.png and frontend/public/icon-512.png
"""

import math
import os
from PIL import Image, ImageChops, ImageDraw

BG = (13, 13, 13, 255)        # #0d0d0d near-black
GOLD = (201, 168, 76, 255)    # #c9a84c
SUPERSAMPLE = 4               # render large, downscale for clean antialiasing

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "frontend",
    "public",
)


def crescent_mask(w):
    """White '1' mask of a crescent moon opening toward the lower-right."""
    mask = Image.new("1", (w, w), 0)
    d = ImageDraw.Draw(mask)

    cx, cy = 0.46 * w, 0.50 * w
    r = 0.34 * w
    # Outer disc.
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=1)
    # Carve a second disc offset up-and-right to leave a fat, bold crescent.
    ox, oy = cx + 0.46 * r, cy - 0.16 * r
    cr = 0.90 * r
    d.ellipse([ox - cr, oy - cr, ox + cr, oy + cr], fill=0)
    return mask


def wave_mask(w):
    """White '1' mask of a horizontal voice waveform with tapered ends."""
    mask = Image.new("1", (w, w), 0)
    d = ImageDraw.Draw(mask)

    cy = 0.50 * w
    amp = 0.15 * w
    cycles = 2.5
    x0, x1 = 0.05 * w, 0.95 * w
    n = 260
    pts = []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        env = math.sin(math.pi * t)  # taper to zero at both ends
        y = cy + amp * env * math.sin(cycles * 2 * math.pi * t)
        pts.append((x, y))

    width = max(3, int(0.07 * w))
    d.line(pts, fill=1, width=width, joint="curve")
    # Round the line caps for a softer, drawn feel.
    r = width / 2
    for cap in (pts[0], pts[-1]):
        d.ellipse([cap[0] - r, cap[1] - r, cap[0] + r, cap[1] + r], fill=1)
    return mask


def render(size):
    w = size * SUPERSAMPLE
    crescent = crescent_mask(w)
    wave = wave_mask(w)

    # gold region = crescent XOR wave
    gold_region = ImageChops.logical_xor(crescent, wave).convert("L")

    base = Image.new("RGBA", (w, w), BG)
    gold_layer = Image.new("RGBA", (w, w), GOLD)
    base.paste(gold_layer, (0, 0), gold_region)

    return base.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        img = render(size)
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        img.save(path, "PNG")
        print(f"  wrote {path} ({size}x{size})")
    print("Icons generated.")


if __name__ == "__main__":
    main()
