"""Step 1 — find teaching-worthy defensive mistakes in MLB's official play-by-play.

Scans every regular-season / postseason game in a date range (MLB Stats API, public) and flags plays with:
  errors      2+ fielding/throwing errors credited on one play
  chain       a runner put out after 4+ fielder credits (rundowns, long relays)
  doubled     a runner doubled off on a caught fly / liner / pop-up
Writes candidates.json: [{pk, idx, tag, date, description}] — the input for verify.py.
Usage: python3 scan_pbp.py 2026-06-01 2026-06-30 [candidates.json]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

UA = {"User-Agent": "baseball-feud-research/1.0"}


def get(url):
    for i in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except Exception as e:  # noqa: BLE001
            err = e; time.sleep(2 + 2 * i)
    raise err


def main():
    start, end = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else "candidates.json"
    sched = get(f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R,F,D,L,W&startDate={start}&endDate={end}")
    games = [g for d in sched["dates"] for g in d["games"] if g["status"]["codedGameState"] == "F"]
    print(len(games), "final games", flush=True)
    cands = []
    for n, g in enumerate(games):
        f = get(f"https://statsapi.mlb.com/api/v1.1/game/{g['gamePk']}/feed/live")
        for i, p in enumerate(f["liveData"]["plays"]["allPlays"]):
            credits = [c for r in p.get("runners", []) for c in r.get("credits", [])]
            errors = sum(1 for c in credits if c["credit"] in ("f_throwing_error", "f_fielding_error"))
            outs_after_long = any(r["movement"].get("isOut") and len(r.get("credits", [])) >= 4 for r in p.get("runners", []))
            desc = p["result"].get("description") or ""
            doubled = "doubled off" in desc.lower()
            tag = "errors" if errors >= 2 else "chain" if outs_after_long else "doubled" if doubled else None
            if tag:
                cands.append({"pk": g["gamePk"], "idx": i, "tag": tag, "date": g["officialDate"], "description": desc})
        if n % 50 == 0:
            print(n, len(games), "candidates", len(cands), flush=True)
    json.dump(cands, open(out_path, "w"), indent=1)
    print("DONE", len(cands), "candidates →", out_path)


if __name__ == "__main__":
    main()
