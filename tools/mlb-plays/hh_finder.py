"""Admin: find plays that HAVE verified High Home footage, and import them on purpose.

    python3 hh_finder.py                       # build the catalog, report which plays each High Home clip shows
    python3 hh_finder.py --import              # also discover those games, curate just those plays and publish them

1. Catalog every clip MLB titles or describes as a High Home angle, plus clips confirmed High Home from their frame
   (work/hh-visual.json, from hh_visual.py review) — MLB.com weekly video sitemaps for every scanned
   year (work/angle-clips*.json from angles.py) — and resolve each to its game through MLB.com's own keyword
   (gamepk-NNNNNN) on the clip's data-service record. → work/hh-catalog.json
2. For each clip, find the exact play in that game (videos._angle_matches: MLB's text names the batter or the
   half-inning plus the event, and no other play fits). Ambiguous clips are listed for review, never assigned.
3. With --import: run discover.py for games not yet scanned, then curate.py --only-ids for the matched plays
   (they go to whichever teaching slot they fit), publish.py, cameras.py and hh_discover.py for the new plays.
"""
from __future__ import annotations

import collections
import glob
import json
import os
import subprocess
import sys

import mlb
import videos

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
APP = os.path.abspath(os.path.join(HERE, "../../apps/play-repository"))


def catalog():
    seen, out = set(), []
    for f in sorted(glob.glob(os.path.join(WORK, "angle-clips*.json"))):
        for a in json.load(open(f)):
            if a["angle"] != "high-home" or a["slug"] in seen:
                continue
            seen.add(a["slug"])
            meta = mlb.clip_meta(a["slug"]) or {}
            kw = [k.get("slug", "") for k in meta.get("keywordsDisplay") or []]
            pk = next((int(k.split("-")[1]) for k in kw if k.startswith("gamepk-") and k.split("-")[1].isdigit()), None)
            cuts = (meta.get("image") or {}).get("cuts") or []
            out.append({"slug": a["slug"], "title": a["title"], "description": a.get("description") or meta.get("description"), "date": a.get("date"),
                        "gamePk": pk, "players": [k for k in kw if k.startswith("playerid-")], "duration": meta.get("duration"),
                        "thumb": next((c.get("src") for c in cuts if c.get("width") == 640), None)})
    # clips confirmed High Home from their frame (MLB used other words, e.g. "an overhead view")
    vpath = os.path.join(WORK, "hh-visual.json")
    for slug, v in (json.load(open(vpath)) if os.path.exists(vpath) else {}).items():
        if v.get("verdict") != "high-home" or slug in seen:
            continue
        seen.add(slug)
        meta = mlb.clip_meta(slug) or {}
        kw = [k.get("slug", "") for k in meta.get("keywordsDisplay") or []]
        pk = next((int(k.split("-")[1]) for k in kw if k.startswith("gamepk-") and k.split("-")[1].isdigit()), None)
        out.append({"slug": slug, "title": meta.get("title"), "description": meta.get("description"), "date": (meta.get("date") or "")[:10],
                    "gamePk": pk, "players": [k for k in kw if k.startswith("playerid-")], "duration": meta.get("duration"), "visual": v})
    json.dump(out, open(os.path.join(WORK, "hh-catalog.json"), "w"), indent=1, ensure_ascii=False)
    return out


def main(argv):
    cat = catalog()
    by_game = collections.defaultdict(list)
    with open(os.path.join(WORK, "records.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            by_game[r["game"]["gamePk"]].append(r)
    published = {p["id"] for p in json.load(open(os.path.join(APP, "data", "index.json")))["plays"]}
    rows, need_dates, ids = [], set(), []
    for a in cat:
        recs = by_game.get(a["gamePk"]) or []
        if a["gamePk"] and not recs:
            g = mlb.feed(a["gamePk"])["gameData"]["datetime"]["officialDate"]
            need_dates.add(g)
            rows.append((a, None, "game not scanned yet — discover.py " + g)); continue
        hits = [r for r in recs if videos._angle_matches({"title": a["title"], "description": a["description"]}, r, recs)]
        if len(hits) == 1:
            r = hits[0]
            rows.append((a, r["id"], "in library" if r["id"] in published else "importable"))
            if r["id"] not in published:
                ids.append(r["id"])
        else:
            rows.append((a, None, f"review: {len(hits)} plays fit" if hits else "review: text doesn't identify one play"))
    print(f"{len(cat)} MLB-labelled High Home clips")
    for a, pid, st in rows:
        print(f"  {a['date']} {a['slug'][:60]:60} game {a['gamePk']} → {pid or '—'} ({st})")
    if "--import" not in argv:
        return
    if need_dates and "--rescanned" not in argv:          # scan those games once, then match again
        subprocess.call([sys.executable, "discover.py", *sorted(need_dates)], cwd=HERE)
        return main(argv + ["--rescanned"])
    if not ids:
        print("nothing new to import"); return
    for step in (["curate.py", "--app", APP, "--only-ids", ",".join(ids)], ["publish.py", APP], ["cameras.py", APP], ["hh_discover.py", APP, "--ids", ",".join(ids)]):
        if subprocess.call([sys.executable, *step], cwd=HERE):
            print("stopped at", step[0]); return


if __name__ == "__main__":
    main(sys.argv[1:])
