"""Derive FUEL brand assets from the supplied logo (apps/fuel/brand/source-fuel-logo.jpg). Nothing is redrawn:
every asset is a crop / resize / background-keying of the supplied pixels."""
import os
from PIL import Image, ImageDraw
import numpy as np

D = "/home/user/sandbox/apps/fuel/brand"
os.chdir(D)
tile = Image.open("fuel-logo.png")            # 946x882 RGBA, rounded square with transparent corners
T = np.asarray(tile).astype(float)
EDGE = (15, 26, 38)      # the logo's navy near its edges (measured)
CENTER = (26, 41, 62)    # the logo's navy around the artwork (measured)


def keyed(box):
    """Cut a region and make the navy transparent: alpha from the red channel (navy ~15-30, artwork 200+),
    edge colours recovered by removing the navy mix. Interior pixels keep their original colour."""
    x0, y0, x1, y1 = box
    c = T[y0:y1, x0:x1, :3]
    bg = np.array(CENTER, float)
    a = np.clip((c[:, :, 0] - 45) / (190 - 45), 0, 1)
    safe = np.maximum(a, 1e-3)[:, :, None]
    col = np.clip((c - (1 - a)[:, :, None] * bg) / safe, 0, 255)
    col = np.where(a[:, :, None] > 0.97, c, col)
    out = np.zeros(c.shape[:2] + (4,))
    out[:, :, :3] = col
    out[:, :, 3] = a * 255
    im = Image.fromarray(out.astype("uint8"), "RGBA")
    return im.crop(im.getbbox())


star = keyed((270, 50, 680, 425))   # orange star with white H
word = keyed((60, 435, 876, 712))   # FUEL wordmark + orange swoosh
star.save("fuel-mark-star.png", optimize=True)
word.save("fuel-wordmark.png", optimize=True)
print("star", star.size, "word", word.size)

# Compact horizontal lockup for the navigation bar, at 3x for Retina (shown ~40 px tall)
Hs = 120
s = star.resize((round(star.width * Hs / star.height), Hs), Image.LANCZOS)
Hw = 86
wd = word.resize((round(word.width * Hw / word.height), Hw), Image.LANCZOS)
gap = 18
L = Image.new("RGBA", (s.width + gap + wd.width, Hs), (0, 0, 0, 0))
L.alpha_composite(s, (0, 0))
L.alpha_composite(wd, (s.width + gap, (Hs - Hw) // 2 + 4))
L.save("fuel-lockup.png", optimize=True)
L.save("fuel-lockup.webp", quality=92, method=6)
print("lockup", L.size)

# Square app icons: the full logo on an opaque square of its own edge navy (iOS/Android round the corners)
side = max(tile.size)
sq = Image.new("RGBA", (side, side), EDGE + (255,))
sq.alpha_composite(tile, ((side - tile.width) // 2, (side - tile.height) // 2))
sq = sq.convert("RGB")
for n, px in [("apple-touch-icon", 180), ("icon-192", 192), ("icon-512", 512)]:
    sq.resize((px, px), Image.LANCZOS).save(f"{n}.png", optimize=True)


def fav(px):
    """Favicon: the star-H mark (the full lockup is unreadable at 16-32 px) on a navy rounded tile."""
    S = px * 8
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    base.paste(Image.new("RGBA", (S, S), CENTER + (255,)), (0, 0), m)
    st = star.resize((int(S * 0.86 * star.width / star.height), int(S * 0.86)), Image.LANCZOS)
    base.alpha_composite(st, ((S - st.width) // 2, (S - st.height) // 2 + int(S * 0.01)))
    return base.resize((px, px), Image.LANCZOS)


fav(32).save("favicon-32.png", optimize=True)
fav(16).save("favicon-16.png", optimize=True)
fav(64).save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# Sandbox homepage card logo (apps/fuel/logo.png)
Image.open("fuel-logo-512.png").save("../logo.png", optimize=True)
print("done")
