"""Baseball Feud Plays — candidate verifier.

For each candidate (gamePk + atBatIndex), from the official MLB Stats API live feed:
  teams, date, venue, inning/half, outs before the play, runners on base before, score before, the official
  description, every runner movement and fielder credit, and the playId of the play's last pitch.
Then Baseball Savant's sporty-videos page for that playId is fetched and parsed (same rules as AGORA's
functions/ephyra/api/video/lib.ts): verified only when the page has a clip AND names the same game, batter and
pitcher. Nothing is guessed — a candidate without a verified page gets no link.
Usage: python3 verify.py candidates.json out.json
"""
from __future__ import annotations

import html as H
import json
import os
import re
import sys
import time
import urllib.request

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": "cpbaseball-research/1.0 (+https://cpbaseball.com)"}


def get(url, name, binary=False):
    fp = os.path.join(CACHE, name)
    if os.path.exists(fp):
        return open(fp, "rb").read() if binary else open(fp, encoding="utf-8").read()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                b = r.read()
            open(fp, "wb").write(b)
            return b if binary else b.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 * (attempt + 1))
    raise err


def feed(pk):
    return json.loads(get(f"https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live", f"feed-{pk}.json"))


def text(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def sporty(play_id):
    h = get(f"https://baseballsavant.mlb.com/sporty-videos?playId={play_id}", f"sporty-{play_id}.html")
    video = bool(re.search(r"https://sporty-clips\.mlb\.com/[^\"'\s<>]+\.mp4", h)) and not re.search(r"No Video Found", h, re.I)

    def item(label):
        m = re.search(rf"<strong>\s*{label}:\s*</strong>([\s\S]*?)</li>", h, re.I)
        return m.group(1) if m else None

    pid = lambda s: (lambda m: int(m.group(1)) if m else None)(re.search(r"/savant-player/(\d{1,7})", s or ""))
    mu = item("Matchup")
    g = re.search(r"gamePk=(\d{5,7})", mu or "")
    date = re.search(r"\d{4}-\d{2}-\d{2}", text(item("Date") or ""))
    t = re.search(r"<title>([\s\S]*?)\|", h, re.I)
    return {"video": video, "batter": pid(item("Batter")), "pitcher": pid(item("Pitcher")), "gamePk": int(g.group(1)) if g else None,
            "date": date.group(0) if date else None, "title": text(t.group(1)) if t else None, "matchup": text(mu or "")}


POS = {"1": "P", "2": "C", "3": "1B", "4": "2B", "5": "3B", "6": "SS", "7": "LF", "8": "CF", "9": "RF", "10": "DH"}


def context(f, idx):
    gd = f["gameData"]; plays = f["liveData"]["plays"]["allPlays"]
    p = plays[idx]
    half, inn = p["about"]["halfInning"], p["about"]["inning"]
    prev = [q for q in plays[:idx] if q["about"]["inning"] == inn and q["about"]["halfInning"] == half]
    outs_before = prev[-1]["count"]["outs"] if prev else 0
    # runners on base when the play began: the runners whose movement starts on a base in this play, plus anyone
    # standing on a base after the previous play (postOn* of the previous play)
    if prev:
        m = prev[-1]["matchup"]
        on = {b: (m.get(f"postOn{k}") or {}).get("fullName") for b, k in (("1B", "First"), ("2B", "Second"), ("3B", "Third"))}
    else:
        on = {"1B": None, "2B": None, "3B": None}
    for r in p["runners"]:
        st = r["movement"].get("originBase")
        if st in on and not on[st]:
            on[st] = r["details"]["runner"]["fullName"]
    before = plays[idx - 1]["result"] if idx > 0 else {"awayScore": 0, "homeScore": 0}
    away, home = gd["teams"]["away"], gd["teams"]["home"]
    credits = []
    for r in p["runners"]:
        for c in r.get("credits", []):
            credits.append({"player": c["player"]["id"], "pos": (c.get("position") or {}).get("abbreviation"), "credit": c["credit"]})
    names = {int(k[2:]): v["fullName"] for k, v in gd["players"].items()}
    for c in credits:
        c["name"] = names.get(c["player"])
    pitches = [e for e in p["playEvents"] if e.get("isPitch")]
    last = pitches[-1] if pitches else None
    actions = [{"i": e.get("index"), "desc": (e.get("details") or {}).get("description"), "playId": e.get("playId"), "event": (e.get("details") or {}).get("eventType")}
               for e in p["playEvents"] if e.get("type") == "action"]
    hit = (last or {}).get("hitData") or {}
    return {
        "gamePk": gd["game"]["pk"], "date": gd["datetime"]["officialDate"], "gameType": gd["game"]["type"],
        "away": away["name"], "home": home["name"], "awayAbbr": away.get("abbreviation"), "homeAbbr": home.get("abbreviation"),
        "venue": gd["venue"]["name"], "inning": inn, "half": half, "outsBefore": outs_before, "outsAfter": p["count"]["outs"],
        "runnersBefore": on, "scoreBefore": {"away": before.get("awayScore", 0), "home": before.get("homeScore", 0)},
        "scoreAfter": {"away": p["result"].get("awayScore"), "home": p["result"].get("homeScore")},
        "batter": {"id": p["matchup"]["batter"]["id"], "name": p["matchup"]["batter"]["fullName"]},
        "pitcher": {"id": p["matchup"]["pitcher"]["id"], "name": p["matchup"]["pitcher"]["fullName"]},
        "batterTeam": away["name"] if half == "top" else home["name"], "fieldingTeam": home["name"] if half == "top" else away["name"],
        "description": p["result"].get("description"), "event": p["result"].get("event"), "rbi": p["result"].get("rbi"),
        "runners": [{"runner": r["details"]["runner"]["fullName"], "start": r["movement"].get("start"), "end": r["movement"].get("end"),
                     "out": r["movement"].get("isOut"), "outBase": r["movement"].get("outBase"), "event": r["details"].get("event"),
                     "reason": r["details"].get("movementReason"), "earned": r["details"].get("earned")} for r in p["runners"]],
        "credits": credits, "actions": actions,
        "count": {"balls": (last or {}).get("count", {}).get("balls"), "strikes": (last or {}).get("count", {}).get("strikes")},
        "lastPitch": {"playId": (last or {}).get("playId"), "type": ((last or {}).get("details") or {}).get("type", {}).get("description"),
                      "speed": ((last or {}).get("pitchData") or {}).get("startSpeed")},
        "hit": {"launchSpeed": hit.get("launchSpeed"), "launchAngle": hit.get("launchAngle"), "trajectory": hit.get("trajectory"),
                "location": hit.get("location"), "coords": hit.get("coordinates"), "totalDistance": hit.get("totalDistance")},
    }


def main():
    cands = json.load(open(sys.argv[1]))
    out = []
    for c in cands:
        try:
            f = feed(c["pk"])
            idx = c.get("idx")
            plays = f["liveData"]["plays"]["allPlays"]
            if idx is None:
                idx = next(i for i, p in enumerate(plays) if c["match"].lower() in (p["result"].get("description") or "").lower())
            ctx = context(f, idx)
            pid = c.get("playId") or ctx["lastPitch"]["playId"]
            v = sporty(pid) if pid else None
            ok = bool(v and v["video"] and v["gamePk"] == ctx["gamePk"] and v["batter"] == ctx["batter"]["id"] and v["pitcher"] == ctx["pitcher"]["id"])
            out.append({**c, "idx": idx, "ctx": ctx, "playId": pid, "savant": v, "verified": ok,
                        "url": f"https://baseballsavant.mlb.com/sporty-videos?playId={pid}" if ok else None})
            print(("OK " if ok else "NO "), c.get("tag", ""), ctx["date"], ctx["away"], "@", ctx["home"], ctx["inning"], ctx["half"], "|", (ctx["description"] or "")[:110], flush=True)
        except Exception as e:  # noqa: BLE001
            out.append({**c, "error": repr(e)})
            print("ERR", c, repr(e), flush=True)
    json.dump(out, open(sys.argv[2], "w"), indent=1)


if __name__ == "__main__":
    main()
