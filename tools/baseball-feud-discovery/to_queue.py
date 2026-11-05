"""Step 4 — package verified plays + proposed answers as a Baseball Feud 2.0 import file (review queue).

Input:
  verified.json  (from verify.py: official situation, description, playId, Savant match)
  answers.json   {"<gamePk>-<atBatIndex>": {"title": "...", "category": "...", "mlbUrl": "https://www.mlb.com/video/…",
                   "angle": {"category": "high-home|wide|broadcast", "label": "...", "segments": [{"time": "0:20–0:24", "view": "..."}], "howVerified": "..."},
                   "description": "...", "answers": [{"text": "board label", "note": "coaching explanation", "category": "..."}], "sources": [...]}}
  The answers are written by the coach or an AI research session — 5–6 per play, every claim from the official record,
  a cited report, or a coaching standard. Plays without an answers entry are skipped.
Output: discovered-plays.json → Baseball Feud 2.0 → Plays Library → Find New Plays → Import. Every play lands in the
review queue; nothing reaches the library until approved.
Usage: python3 to_queue.py verified.json answers.json [discovered-plays.json]
"""
from __future__ import annotations

import json
import sys


def main():
    ver = json.load(open(sys.argv[1])); ans = json.load(open(sys.argv[2]))
    out_path = sys.argv[3] if len(sys.argv) > 3 else "discovered-plays.json"
    plays = []
    for v in ver:
        if not v.get("verified"):
            continue
        c = v["ctx"]; key = f"{c['gamePk']}-{v['idx']}"; a = ans.get(key)
        if not a or not 4 <= len(a.get("answers", [])) <= 6:
            continue
        on = [b for b in ("1B", "2B", "3B") if c["runnersBefore"].get(b)]
        runners = "Bases empty" if not on else ("Bases loaded" if len(on) == 3 else "Runner" + ("s" if len(on) > 1 else "") + " on " + " and ".join({"1B": "first", "2B": "second", "3B": "third"}[b] for b in on))
        half = "Top" if c["half"] == "top" else "Bottom"
        plays.append({
            "id": f"mlb-{key}", "title": a["title"], "category": a.get("category", ""), "stage": a.get("stage", ""),
            "situation": {"teams": f"{c['away']} at {c['home']}", "date": c["date"], "venue": c["venue"], "inning": f"{half} {c['inning']}",
                          "outs": c["outsBefore"], "runners": runners, "bases": {b: bool(c["runnersBefore"].get(b)) for b in ("1B", "2B", "3B")},
                          "score": f"{c['awayAbbr']} {c['scoreBefore']['away']}, {c['homeAbbr']} {c['scoreBefore']['home']}",
                          "batter": c["batter"]["name"], "pitcher": c["pitcher"]["name"]},
            "description": a.get("description", ""), "officialRecord": c["description"], "question": a.get("question", "WHAT WENT WRONG?"),
            "video": {"pageUrl": a.get("mlbUrl", ""), "savantUrl": v["url"], "title": a.get("videoTitle", ""), "angle": a.get("angle", {"category": "broadcast"})},
            "answers": a["answers"], "sources": [{"label": f"MLB Stats API — game {c['gamePk']}", "url": f"https://statsapi.mlb.com/api/v1.1/game/{c['gamePk']}/feed/live"}] + a.get("sources", []),
            "verification": {"status": "verified", "gamePk": str(c["gamePk"]), "playId": v["playId"], "notes": "Official play-by-play; Savant clip matched to game, batter and pitcher."},
        })
    json.dump({"app": "baseball-feud-2", "kind": "discovered-plays", "plays": plays}, open(out_path, "w"), indent=1, ensure_ascii=False)
    print(len(plays), "plays →", out_path)


if __name__ == "__main__":
    main()
