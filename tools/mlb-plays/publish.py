"""Step 5 — publish curated plays to Play Repository (and optionally to Baseball Feud 2.0's import format).

  data/index.json          compact, filterable fields for every play + the flag definitions (one small file)
  data/plays/<id>.json     full record for the detail view: runners, fielder credits, clips, sources, checks
  VALIDATION.md            human-readable validation report for this publish
Adding plays later: run discover → curate (or --ids) → publish again; existing plays are kept, ids never
duplicate, nothing in the app needs rebuilding.
Usage: python3 publish.py ../../apps/play-repository [--feud out.json]   (publish into the app)
       python3 publish.py ../../apps/play-repository --bundle new-plays.json (import file only)
"""
from __future__ import annotations

import collections
import json
import os
import sys
import time

import mlb
from normalize import FLAGS

WORK = os.path.join(mlb.HERE, "work")
ORD = {1: "1st", 2: "2nd", 3: "3rd"}
POSN = {1: "pitcher", 2: "catcher", 3: "first baseman", 4: "second baseman", 5: "third baseman", 6: "shortstop", 7: "left fielder", 8: "center fielder", 9: "right fielder"}
ORDER = ["high-home", "highlight", "filmroom", "alternate"]


def ordinal(n):
    return ORD.get(n, f"{n}th") if n < 10 or n > 20 else f"{n}th"


def gen_title(r):
    """Short factual title: MLB.com's own clip title when MLB published a highlight, else MLB's official description."""
    import re
    hl = next((c for c in r["video"]["clips"] if c["kind"] == "highlight" and c.get("title")), None)
    if hl:
        return hl["title"].strip().rstrip("."), "MLB.com clip title"
    ev, b = r["event"], r["batter"]["name"]
    d = re.sub(r"^.*?call on the field was (?:upheld|overturned):\s*", "", ev["description"] or "")
    d = re.sub(r"^With [^,]+ batting,\s*", "", d)
    d = d.split(". ")[0].strip().rstrip(".")
    if len(d) > 72 and ", " in d[:72]:
        d = d[:d.rindex(", ", 0, 72)]
    elif len(d) > 80:
        d = d[:77].rsplit(" ", 1)[0] + "…"
    return d or f"{b}: {ev['label']}", "From MLB's official play description"


def index_row(r, title, title_src):
    b, a = r["before"], r["after"]
    bb, p, wp, sc = r.get("batted") or {}, r.get("pitch") or {}, r.get("winprob") or {}, r.get("statcast") or {}
    clips = sorted(r["video"]["clips"], key=lambda c: ORDER.index(c["kind"]))
    pos = sorted({c["pos"] for x in r["runners"] for c in x["credits"] if c["pos"]})
    return {
        "id": r["id"], "date": r["game"]["date"], "season": r["game"]["season"], "gameType": r["game"]["gameType"], "level": r["game"]["level"],
        "gamePk": r["game"]["gamePk"], "away": r["game"]["away"]["abbr"], "home": r["game"]["home"]["abbr"],
        "inning": b["inning"], "half": b["half"], "outs": b["outs"], "bases": b["bases"], "count": [b["count"]["balls"], b["count"]["strikes"]],
        "score": [b["score"]["away"], b["score"]["home"]], "batting": b["batting"],
        "after": {"outs": a["outs"], "bases": a["bases"], "score": [a["score"]["away"], a["score"]["home"]]},
        "event": r["event"]["type"], "eventLabel": r["event"]["label"], "runs": r["event"]["runs"], "outsOnPlay": r["event"]["outs"],
        "batter": {"id": r["batter"]["id"], "name": r["batter"]["name"], "side": r["batter"]["side"]},
        "pitcher": {"id": r["pitcher"]["id"], "name": r["pitcher"]["name"], "hand": r["pitcher"]["hand"]},
        "runnersOn": {k: (v or {}).get("name") for k, v in b["runners"].items() if v},
        "flags": r["flags"], "positions": pos,
        "batted": {k: bb.get(k) for k in ("trajectory", "ev", "la", "distance", "location", "spray")} if bb else None,
        "pitch": {"type": p.get("type"), "speed": p.get("speed"), "zone": p.get("zone")} if p else None,
        "li": wp.get("li"), "wpHomeBefore": wp.get("homeBefore"), "wpHomeAdded": wp.get("homeAdded"),
        "dRunExp": sc.get("deltaRunExp"), "dHomeWinExp": sc.get("deltaHomeWinExp"), "ifAlign": sc.get("ifAlignment"), "ofAlign": sc.get("ofAlignment"),
        "title": title, "titleSource": title_src, "category": r["curation"]["category"], "slot": r["curation"]["slot"],
        "description": r["event"]["description"],
        "thumb": next((c["thumb"] for c in clips if c.get("thumb")), None),
        "angles": [c["angle"]["category"] for c in clips], "clipKinds": [c["kind"] for c in clips],
    }


def detail(r, title, title_src):
    clips = sorted(r["video"]["clips"], key=lambda c: ORDER.index(c["kind"]))
    pk = r["game"]["gamePk"]
    sources = [{"label": f"MLB Stats API — official play-by-play, game {pk}", "url": r["source"]["feed"]},
               {"label": f"MLB Stats API — win probability, game {pk}", "url": f"https://statsapi.mlb.com/api/v1/game/{pk}/winProbability"}]
    if r.get("statcast"):
        sources.append({"label": "Baseball Savant — Statcast pitch data", "url": f"https://baseballsavant.mlb.com/gamefeed?gamePk={pk}"})
    if (r["video"].get("savant") or {}).get("url"):
        sources.append({"label": "Baseball Savant — clip page for this pitch", "url": r["video"]["savant"]["url"]})
    return {"schema": 1, "id": r["id"], "title": title, "titleSource": title_src, "source": r["source"], "game": r["game"],
            "before": r["before"], "after": r["after"], "batter": r["batter"], "pitcher": r["pitcher"], "event": r["event"],
            "runners": r["runners"], "chains": r.get("chains", []), "pitch": r.get("pitch"), "batted": r.get("batted"),
            "winprob": r.get("winprob"), "statcast": r.get("statcast"), "flags": r["flags"], "curation": r["curation"],
            "clips": clips, "savant": r["video"].get("savant"), "sources": sources,
            "verification": {"status": "verified", "checkedAt": time.strftime("%Y-%m-%d"), "notes": r["verification"]["report"]}}


def validation_md(app, log, new_ids, kept):
    """Report over every published play (old and new), read back from the app's own data files."""
    idx = json.load(open(os.path.join(app, "data", "index.json")))
    det = [json.load(open(os.path.join(app, "data", "plays", p["id"] + ".json"))) for p in idx["plays"]]
    n = len(det)
    ang = collections.Counter(c["angle"]["category"] for d in det for c in d["clips"])
    primary = collections.Counter(d["clips"][0]["kind"] for d in det)
    cats = collections.Counter(d["curation"]["category"] for d in det)
    new_cats = collections.Counter(d["curation"]["category"] for d in det if d["id"] in new_ids)
    seasons = collections.Counter(d["game"]["season"] for d in det)
    events = collections.Counter(d["event"]["type"] for d in det)
    states = collections.Counter(d["before"]["bases"] + f"/{d['before']['outs']}" for d in det)
    sav = sum(1 for d in det if (d.get("savant") or {}).get("match"))
    slugs = collections.Counter(c["slug"] for d in det for c in d["clips"])
    dup_slugs = [s for s, k in slugs.items() if k > 1]
    games = {d["game"]["gamePk"] for d in det}
    teams = {t for d in det for t in (d["game"]["away"]["abbr"], d["game"]["home"]["abbr"])}
    missing = collections.Counter()
    for d in det:
        if not d.get("batted") and d["source"]["terminal"] and d["event"]["type"] not in ("strikeout", "walk", "intent_walk", "hit_by_pitch", "catcher_interf"):
            missing["batted-ball data"] += 1
        if not d.get("statcast"):
            missing["Statcast pitch row (alignment, run/win expectancy change) — between-pitch events have none"] += 1
        if not (d.get("winprob") or {}).get("li"):
            missing["leverage index"] += 1
    tgt = json.load(open(os.path.join(WORK, "validation.json")))["target"]
    L = [f"# Play Repository — validation report ({time.strftime('%Y-%m-%d')})", "",
         f"**{n} plays published** ({kept} kept unchanged from earlier publishes, {len(new_ids)} added in this run). Every play has at least one verified, playable MLB clip and core metadata from MLB's official play-by-play.", "",
         f"- Unique events: {len({d['id'] for d in det})} · unique clips: {len(slugs)} · clips shared by two plays: {len(dup_slugs)}",
         f"- Games: {len(games)} · teams: {len(teams)} · seasons: " + ", ".join(f"{k}: {v}" for k, v in sorted(seasons.items())), "",
         "## Per category", "", "| Category | Plays | Target | Added this run |", "|---|---|---|---|"]
    for c, t in tgt.items():
        L.append(f"| {c} | {cats.get(c, 0)} | {t} | {new_cats.get(c, 0)} |")
    L += ["", "## Checks applied to every play", "",
          "1. Game ID (`gamePk`) and play/event ID (`atBatIndex`, event index, Statcast `playId`) from MLB's live feed.",
          "2. Date, teams, venue from the same feed.",
          "3. Inning, half, score, outs and runners **before** the play — rebuilt from the feed by replaying earlier runner movements in the plate appearance.",
          "4. Outcome: MLB's official event, description, every runner movement and fielder credit.",
          "5. Video: MLB.com's clip page exists and declares MLB's embed; the embed answers 200/206.",
          "6. Correspondence: highlight `guid` = the play's `playId`, or Film Room's play info = the play's game, inning, half, outs, runners, batter and pitcher; angle clips without a guid must be identified by MLB's own text (batter or inning + event) and be the only play that fits.",
          "7. Camera angle: High Home only when MLB's own title says so; broadcast feeds labelled by MLB's feed type.",
          f"8. Independent cross-check: Baseball Savant's clip page names the same game, batter and pitcher for **{sav} of {n}** plays (stolen bases, pickoffs and other between-pitch events have no Savant pitch clip).",
          "9. Duplicates: one record per event id, and no clip is attached to two different plays.",
          "", "## Video availability and camera angles", "",
          "- Primary clip: " + ", ".join(f"{k} {v}" for k, v in primary.most_common()),
          "- All verified clips by angle: " + ", ".join(f"{k} {v}" for k, v in ang.most_common()),
          f"- High Home: {ang.get('high-home', 0)} play(s). MLB's 2024–25 video sitemaps contain only two clips MLB labels High Home.",
          "", "## Spread", "",
          "- Most common outcomes: " + ", ".join(f"{k} {v}" for k, v in events.most_common(10)),
          "- Base-out states covered: " + str(len(states)) + " of 24",
          "", "## Missing fields (not published by MLB for these plays)", ""]
    L += [f"- {k}: {v} play(s)" for k, v in missing.most_common()] or ["- none"]
    L += ["", "## Selection log for this run (rejections and replacements)", "", "| Slot | Play | Result |", "|---|---|---|"]
    for e in log:
        L.append(f"| {e['slot']} | {e.get('id') or '—'} | {e['result']}{(' — ' + '; '.join(e.get('details', [])[:2])) if e.get('details') else ''} |")
    return "\n".join(L) + "\n"


def feud_export(plays, path):
    """Baseball Feud 2.0's discovered-plays import format (review queue) — answers left for the coach to write."""
    out = []
    for r in plays:
        b = r["before"]
        on = [k for k in ("1B", "2B", "3B") if b["runners"].get(k)]
        runners = "Bases empty" if not on else ("Bases loaded" if len(on) == 3 else "Runner" + ("s" if len(on) > 1 else "") + " on " + " and ".join({"1B": "first", "2B": "second", "3B": "third"}[k] for k in on))
        clip = sorted(r["video"]["clips"], key=lambda c: ORDER.index(c["kind"]))[0]
        out.append({"id": r["id"], "title": gen_title(r)[0], "category": r["curation"]["category"],
                    "situation": {"teams": f"{r['game']['away']['name']} at {r['game']['home']['name']}", "date": r["game"]["date"], "venue": r["game"]["venue"],
                                  "inning": f"{'Top' if b['half'] == 'top' else 'Bottom'} {b['inning']}", "outs": b["outs"], "runners": runners,
                                  "bases": {k: bool(b["runners"].get(k)) for k in ("1B", "2B", "3B")},
                                  "score": f"{r['game']['away']['abbr']} {b['score']['away']}, {r['game']['home']['abbr']} {b['score']['home']}",
                                  "batter": r["batter"]["name"], "pitcher": r["pitcher"]["name"]},
                    "officialRecord": r["event"]["description"],
                    "video": {"embedUrl": clip["embedUrl"], "pageUrl": clip["pageUrl"], "title": clip["title"],
                              "angle": {"category": "high-home" if clip["angle"]["category"] == "high-home" else "broadcast", "label": clip["angle"]["label"], "howVerified": clip["howVerified"]}},
                    "answers": [], "sources": [{"label": "MLB Stats API", "url": r["source"]["feed"]}],
                    "verification": {"status": "verified", "gamePk": str(r["game"]["gamePk"]), "playId": r["source"]["playId"]}})
    json.dump({"app": "baseball-feud-2", "kind": "discovered-plays", "plays": out}, open(path, "w"), indent=1, ensure_ascii=False)


def main(argv):
    app = os.path.abspath(argv[0])
    plays = json.load(open(os.path.join(WORK, "curated.json")))
    log = json.load(open(os.path.join(WORK, "validation.json")))["log"]
    if "--bundle" in argv:     # an import file for Play Repository → Import (review queue); the app's data is untouched
        path = argv[argv.index("--bundle") + 1]
        known = set()
        idx_path = os.path.join(app, "data", "index.json")
        if os.path.exists(idx_path):
            known = {p["id"] for p in json.load(open(idx_path))["plays"]}
        items = []
        for r in plays:
            if r["id"] in known:
                continue
            title, src = gen_title(r)
            items.append({"index": index_row(r, title, src), "detail": detail(r, title, src)})
        json.dump({"app": "play-repository", "kind": "plays", "generated": time.strftime("%Y-%m-%d"), "plays": items}, open(path, "w"), ensure_ascii=False)
        print("bundle", len(items), "new plays →", path)
        return
    os.makedirs(os.path.join(app, "data", "plays"), exist_ok=True)
    idx_path = os.path.join(app, "data", "index.json")
    old = json.load(open(idx_path)) if os.path.exists(idx_path) else {"plays": []}
    rows = {p["id"]: p for p in old["plays"]}
    kept = len(rows)
    new_ids = set()
    for r in plays:
        if r["id"] in rows and "--refresh" not in argv:       # never overwrite a published play unless asked
            continue
        new_ids.add(r["id"])
        title, src = gen_title(r)
        rows[r["id"]] = index_row(r, title, src)
        json.dump(detail(r, title, src), open(os.path.join(app, "data", "plays", r["id"] + ".json"), "w"), ensure_ascii=False, separators=(",", ":"))
    out = {"schema": 1, "generated": time.strftime("%Y-%m-%d"), "source": "MLB Stats API, Baseball Savant, MLB Film Room, MLB.com (tools/mlb-plays)",
           "flags": {k: {"label": v[0], "group": v[1], "rule": v[2]} for k, v in FLAGS.items()},
           "plays": sorted(rows.values(), key=lambda p: (p["category"], p["date"]))}
    json.dump(out, open(idx_path, "w"), ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(app, "VALIDATION.md"), "w").write(validation_md(app, log, new_ids, kept))
    if "--feud" in argv:
        feud_export(plays, argv[argv.index("--feud") + 1])
    print("published", len(rows), "plays (", len(new_ids), "new ) →", idx_path)


if __name__ == "__main__":
    main(sys.argv[1:])
