"""Visual camera check for MLB editorial clips: does the clip's own poster frame show the High Home composition?

High Home = the elevated camera directly behind home plate: home plate at the bottom centre, the whole infield
diamond and the outfield in view, crowd along both edges. MLB doesn't always say "High Home" in the title (one
clip is described as "an overhead view"), so text alone can miss it.

    python3 hh_visual.py sheet <out.jpg> <slug> [<slug> …]   # contact sheet of poster frames, numbered, for review
    python3 hh_visual.py score <slug> [<slug> …]             # composition score per clip (0–1) — a screen, not a verdict

Only MLB's published poster image (img.mlbstatic.com) is read, in memory, to judge the framing; no video is
downloaded and nothing is saved except the review sheet. A clip is recorded as High Home by visual inspection only
after a person confirms it on the sheet (work/hh-visual.json); the score only orders what to look at first.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request

import mlb

HERE = os.path.dirname(os.path.abspath(__file__))


def poster(slug, width=640):
    meta = mlb.clip_meta(slug) or {}
    cuts = (meta.get("image") or {}).get("cuts") or []
    src = next((c["src"] for c in cuts if c.get("width") == width), cuts[0]["src"] if cuts else None)
    if not src:
        return None, meta
    _, body = mlb.fetch(src)
    from PIL import Image
    return Image.open(io.BytesIO(body)).convert("RGB"), meta


def score(img):
    """High Home layout screen (0–1). The frame from the high camera behind home plate has: field filling the middle,
    stands across the top, and crowd/stands in BOTH bottom corners (the plate area sits between them). A close-up of
    a fielder is all field to the corners, so it fails the corner test. A screen to order human review, not a verdict."""
    small = img.resize((64, 36))
    px = small.load()
    def field(r, g, b):
        green = g > r + 8 and g > b + 8 and g > 70
        dirt = r > 120 and 70 < g < r and b < g and r - b > 40
        return green or dirt
    share = lambda xs, ys: sum(field(*px[x, y]) for y in ys for x in xs) / (len(xs) * len(ys))
    mid = share(range(16, 48), range(10, 26))
    top = share(range(0, 64), range(0, 3))
    bl, br = share(range(0, 7), range(29, 36)), share(range(57, 64), range(29, 36))
    centre_low = share(range(26, 38), range(27, 33))
    corners = 1 - max(bl, br)
    s = min(1, mid / 0.85) * 0.4 + corners * 0.3 + (1 - top) * 0.15 + min(1, centre_low / 0.6) * 0.15
    return round(s if (mid > 0.6 and corners > 0.45) else s * 0.5, 3)


def sheet(out, slugs):
    from PIL import Image, ImageDraw
    tiles = []
    for i, s in enumerate(slugs):
        img, _ = poster(s, 372) if True else (None, None)
        if img is None:
            img, _ = poster(s)
        if img is None:
            continue
        t = img.resize((320, 180))
        d = ImageDraw.Draw(t)
        d.rectangle([0, 0, 34, 18], fill=(0, 0, 0))
        d.text((4, 3), str(i), fill=(255, 255, 0))
        tiles.append(t)
    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * 324, rows * 184), (30, 30, 30))
    for i, t in enumerate(tiles):
        canvas.paste(t, ((i % cols) * 324, (i // cols) * 184))
    canvas.save(out, quality=82)
    return len(tiles)


def scan_games(pks, out_path):
    """Screen every editorial clip of each game by its poster frame (from Film Room's own image cuts). Resumable."""
    from PIL import Image
    res = json.load(open(out_path)) if os.path.exists(out_path) else {}
    for n, pk in enumerate(pks):
        if str(pk) in res:
            continue
        rows = []
        for m in mlb.filmroom_game_cms(pk):
            cuts = [c for f in m.get("feeds", []) for c in ((f.get("image") or {}).get("cuts") or [])]
            src = next((c["src"] for c in cuts if c.get("width") in (372, 320, 640)), cuts[0]["src"] if cuts else None)
            if not src:
                continue
            try:
                _, body = mlb.fetch(src)
                sc = score(Image.open(io.BytesIO(body)).convert("RGB"))
            except Exception as e:  # noqa: BLE001
                sc = None
            rows.append({"slug": m["slug"], "title": m.get("title"), "description": m.get("description") or m.get("blurb"), "score": sc,
                         "keywords": [k["slug"] for k in m.get("keywordsDisplay") or []], "guid": m.get("guid"), "date": (m.get("date") or "")[:10]})
        res[str(pk)] = rows
        json.dump(res, open(out_path, "w"))
        top = max((r["score"] or 0 for r in rows), default=0)
        print(f"{n + 1}/{len(pks)} game {pk}: {len(rows)} clips, top score {top}", flush=True)
    return res


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    if cmd == "sheet":
        print(sheet(rest[0], rest[1:]), "tiles →", rest[0])
    elif cmd == "scan":                 # scan <games.json|library> → work/hh-visual-scores.json
        app = os.path.abspath(os.path.join(HERE, "../../apps/play-repository"))
        pks = sorted({p["gamePk"] for p in json.load(open(os.path.join(app, "data", "index.json")))["plays"]}) if rest[0] == "library" else json.load(open(rest[0]))
        scan_games(pks, os.path.join(HERE, "work", "hh-visual-scores.json"))
    elif cmd == "rescore":              # re-score saved scan results from the image cache (no new requests)
        from PIL import Image
        path = os.path.join(HERE, "work", "hh-visual-scores.json"); res = json.load(open(path))
        for pk, rows in res.items():
            for r in rows:
                meta_cuts = None
            # poster src isn't stored: re-read Film Room's (cached) game list for the image URLs
            srcs = {}
            for m in mlb.filmroom_game_cms(int(pk)):
                cuts = [c for f in m.get("feeds", []) for c in ((f.get("image") or {}).get("cuts") or [])]
                srcs[m["slug"]] = next((c["src"] for c in cuts if c.get("width") in (372, 320, 640)), cuts[0]["src"] if cuts else None)
            for r in rows:
                if srcs.get(r["slug"]):
                    try:
                        _, body = mlb.fetch(srcs[r["slug"]]); r["score"] = score(Image.open(io.BytesIO(body)).convert("RGB"))
                    except Exception:  # noqa: BLE001
                        r["score"] = None
        json.dump(res, open(path, "w"))
        print("rescored", sum(map(len, res.values())))
    elif cmd == "score":
        for s in rest:
            img, _ = poster(s)
            print(s, score(img) if img else None)
