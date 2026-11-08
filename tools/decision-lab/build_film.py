"""Decision Lab — Film Room index (apps/decision-lab/data/film.json), built READ-ONLY from Play Repository.

Reads apps/play-repository/data/index.json and data/plays/<id>.json and never writes there. Each Play Repository play
whose official record (runners' starts, ends and outs on the bases; the event; the base-out state before the play)
matches a Decision Lab decision family becomes a film entry that points back to the original record:
  * the family it illustrates and the outcome it shows (e.g. "send · thrown out at home"),
  * the play's own historical context (date, clubs, inning, outs, runners, score before the play),
  * MLB.com's clip page and MLB's embed exactly as Play Repository verified them (broadcast / High Home).
Matching is objective; nothing about the play is changed or inferred. A clip only ever illustrates a modeled outcome —
the app labels it "real play from <date>", never as something that happened in the user's game.

Usage: python3 build_film.py
"""
from __future__ import annotations

import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PR = os.path.join(HERE, "..", "..", "apps", "play-repository", "data")
OUT = os.path.join(HERE, "..", "..", "apps", "decision-lab", "data", "film.json")
OF = {7, 8, 9}
OUTCOME_LABEL = {
    "scored": "runner scores", "out_home": "runner thrown out at home", "held": "runner held at third",
    "safe": "safe", "caught": "caught stealing", "sacrifice": "bunt moves the runner up", "lead_out": "lead runner forced out",
    "bunt_hit": "bunt hit", "bunt_dp": "double play on the bunt", "scored_on_out": "runner scores on the ground-ball out",
    "held_on_out": "runner holds on the ground-ball out", "hit_through": "ground ball gets through",
}


def runner(rec, start):
    return next((r for r in rec["runners"] if r.get("start") == start and not r.get("isBatter")), None)


def fate(r):
    if r is None: return None
    if r.get("out"): return "out_home" if r.get("outBase") in ("home", "HP", "4B") else f"out_{r.get('outBase')}"
    return "scored" if r.get("end") == "score" else "held" if r.get("end") == "3B" else r.get("end")


def classify(rec):
    """→ list of (family, outcome, why) for every decision family this real play illustrates"""
    b, ev, outs = rec["before"]["bases"], rec["event"]["type"], rec["before"]["outs"]
    loc = (rec.get("batted") or {}).get("location"); traj = (rec.get("batted") or {}).get("trajectory")
    out = []
    if ev == "single" and b[1] != "_" and loc in OF:
        f = fate(runner(rec, "2B"))
        if f in ("scored", "out_home", "held"): out.append(("send", f, "Single to the outfield with a runner on second"))
    if ev == "double" and b == "1__" and loc in OF:
        f = fate(runner(rec, "1B"))
        if f in ("scored", "out_home", "held"): out.append(("send1", f, "Double to the outfield with a runner on first"))
    if b[2] != "_" and outs < 2 and traj in ("fly_ball", "popup") and loc in OF and ev in ("sac_fly", "field_out", "sac_fly_double_play", "double_play"):
        f = fate(runner(rec, "3B"))
        f = "held" if f in (None, "3B") else f
        if f in ("scored", "out_home", "held"): out.append(("tag", f, "Fly ball caught by an outfielder with a runner on third"))
    if ev in ("stolen_base_2b", "caught_stealing_2b", "pickoff_caught_stealing_2b"):
        out.append(("steal", "safe" if ev.startswith("stolen") else "caught", "Steal of second"))
    if ev in ("stolen_base_3b", "caught_stealing_3b", "pickoff_caught_stealing_3b"):
        out.append(("steal3", "safe" if ev.startswith("stolen") else "caught", "Steal of third"))
    if outs == 0 and b in ("1__", "12_", "_2_") and (ev in ("sac_bunt", "sac_bunt_double_play") or "bunt" in rec.get("flags", []) or (traj or "").startswith("bunt")):
        lead = runner(rec, "2B" if b[1] != "_" else "1B")
        o = ("bunt_dp" if rec["event"]["outs"] >= 2 else "lead_out" if lead and lead.get("out") else
             "sacrifice" if ev == "sac_bunt" else "bunt_hit" if ev == "single" else "sacrifice" if rec["event"]["outs"] == 1 else "bunt_hit")
        out.append(("bunt", o, "Bunt with nobody out and a runner on"))
    if b[2] != "_" and outs < 2 and traj == "ground_ball" and loc in {1, 2, 3, 4, 5, 6}:
        f = fate(runner(rec, "3B"))
        hit = ev in ("single", "double")
        o = "hit_through" if hit and f == "scored" else "out_home" if f == "out_home" else "scored_on_out" if f == "scored" else "held_on_out" if f in (None, "3B", "held") else None
        if o: out.append(("infield", o, "Infield ground ball with a runner on third and fewer than two outs"))
    return out


def main():
    raw = open(os.path.join(PR, "index.json"), "rb").read()
    idx = json.loads(raw)
    films = []
    for p in idx["plays"]:
        rec = json.load(open(os.path.join(PR, "plays", f"{p['id']}.json")))
        fams = classify(rec)
        if not fams: continue
        clips = [c for c in rec.get("clips", []) if c.get("embedUrl")]
        if not clips: continue
        bc = next((c for c in clips if c["angle"]["category"] == "broadcast"), None)
        hh = next((c for c in clips if c["angle"]["category"] == "high-home"), None)
        g, bf = rec["game"], rec["before"]
        films.append({
            "id": rec["id"], "families": [{"family": f, "outcome": o, "outcomeLabel": OUTCOME_LABEL.get(o, o), "why": w} for f, o, w in fams],
            "title": rec["title"], "description": rec["event"]["description"], "event": rec["event"]["label"],
            "date": g["date"], "season": g["season"], "gameType": g["gameType"], "venue": g.get("venue"),
            "away": {"abbr": g["away"]["abbr"], "name": g["away"]["name"]}, "home": {"abbr": g["home"]["abbr"], "name": g["home"]["name"]},
            "before": {"inning": bf["inning"], "half": bf["half"], "outs": bf["outs"], "bases": bf["bases"], "score": bf["score"], "batting": bf["batting"]},
            "batter": rec["batter"]["name"], "pitcher": rec["pitcher"]["name"],
            "runners": {k: (v or {}).get("name") for k, v in bf["runners"].items() if v},
            "batted": {k: (rec.get("batted") or {}).get(k) for k in ("trajectory", "location", "ev", "distance", "spray")},
            "ifAlign": (rec.get("statcast") or {}).get("ifAlignment"),
            "video": {"broadcast": {"embedUrl": bc["embedUrl"], "pageUrl": bc["pageUrl"], "title": bc["title"], "label": bc["angle"]["label"]} if bc else None,
                      "highHome": {"embedUrl": hh["embedUrl"], "pageUrl": hh["pageUrl"], "title": hh["title"], "label": hh["angle"]["label"]} if hh else None},
            "thumb": (bc or clips[0]).get("thumb") or p.get("thumb"),
            "playRepository": f"../play-repository/#/play/{rec['id']}",
        })
    data = {"schema": 1, "source": {"app": "Play Repository", "index": "apps/play-repository/data/index.json", "indexGenerated": idx.get("generated"),
                                    "indexSha256": hashlib.sha256(raw).hexdigest(), "plays": len(idx["plays"]), "readOnly": True},
            "note": "Real MLB plays from Play Repository, matched to Decision Lab families by their official records. Each illustrates a kind of outcome; none happened in a simulated game.",
            "films": films}
    json.dump(data, open(OUT, "w"), indent=0, separators=(",", ":"))
    from collections import Counter
    print(f"wrote {OUT}: {len(films)} plays · " + ", ".join(f"{k} {v}" for k, v in Counter(f"{x['family']}:{x['outcome']}" for f in films for x in f["families"]).most_common()))


if __name__ == "__main__":
    main()
