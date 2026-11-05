"""Re-verify every published play against MLB's live sources (fresh downloads, no cache).

For each play in <app>/data: re-download MLB's live feed for the game, rebuild the play with normalize.py and
compare inning, half, outs, runners, score, count, batter, pitcher, event and outcome to what is published; then
re-check each clip — MLB.com page declares the embed, the embed answers 200/206.
Usage: python3 verify_published.py ../../apps/play-repository   (exit code 1 on any mismatch)
"""
from __future__ import annotations

import json
import os
import sys

import mlb
import normalize as N


def main(app):
    idx = json.load(open(os.path.join(app, "data", "index.json")))
    bad, feeds = 0, {}
    for p in idx["plays"]:
        d = json.load(open(os.path.join(app, "data", "plays", p["id"] + ".json")))
        pk = d["game"]["gamePk"]
        if pk not in feeds:
            st, body = mlb.fetch(f"https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live", cache=False)
            feeds[pk] = N.game_plays(json.loads(body))
        live = next((r for r in feeds[pk] if r["id"] == p["id"]), None)
        problems = []
        if not live:
            problems.append("play not found in the live feed")
        else:
            lb = live["before"]
            checks = {
                "inning": (lb["inning"], p["inning"]), "half": (lb["half"], p["half"]), "outs": (lb["outs"], p["outs"]),
                "bases": (lb["bases"], p["bases"]), "score": ([lb["score"]["away"], lb["score"]["home"]], p["score"]),
                "count": ([lb["count"]["balls"], lb["count"]["strikes"]], p["count"]), "batter": (live["batter"]["id"], p["batter"]["id"]),
                "pitcher": (live["pitcher"]["id"], p["pitcher"]["id"]), "event": (live["event"]["type"], p["event"]),
                "description": (live["event"]["description"], p["description"]), "date": (live["game"]["date"], p["date"]),
                "teams": ([live["game"]["away"]["abbr"], live["game"]["home"]["abbr"]], [p["away"], p["home"]]),
                "after.score": ([live["after"]["score"]["away"], live["after"]["score"]["home"]], p["after"]["score"]),
                "playId": (live["source"]["playId"], d["source"]["playId"]),
            }
            problems += [f"{k}: live {a!r} vs published {b!r}" for k, (a, b) in checks.items() if a != b]
        for c in d["clips"]:
            emb = mlb.page_embed(c["slug"])
            st = mlb.embed_status(c["embedUrl"])
            if emb != c["embedUrl"] or st not in (200, 206):
                problems.append(f"clip {c['slug']}: page embed {emb}, status {st}")
        status = "PASS" if not problems else "FAIL"
        bad += bool(problems)
        print(f"{status} {p['id']:20} {p['date']} {p['away']}@{p['home']} {'T' if p['half'] == 'top' else 'B'}{p['inning']} {p['outs']} out {p['bases']} {p['score']} {p['event']:24} clips {len(d['clips'])}"
              + ("" if not problems else " | " + "; ".join(problems)), flush=True)
    print(f"\n{len(idx['plays']) - bad} of {len(idx['plays'])} plays match MLB's live feed and have playable clips")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
