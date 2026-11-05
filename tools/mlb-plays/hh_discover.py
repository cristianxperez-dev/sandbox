"""Expanded High Home discovery — every published play, every public MLB source, one status per play.

    python3 hh_discover.py ../../apps/play-repository                 # all plays (resumable; cached)
    python3 hh_discover.py ../../apps/play-repository --sample 20     # a diverse sample first
    python3 hh_discover.py ../../apps/play-repository --ids mlb-1-2,mlb-3-4
    python3 hh_discover.py ../../apps/play-repository --report        # counts only, from the saved results

For each play: resolve its MLB game (gamePk) and event (atBatIndex, Statcast playId), then search

  A. MLB Film Room — every editorial clip of the game (GamePk search, CMS only, all pages). This is where both
     known High Home clips live; it is a superset of the Stats API content list.
  B. MLB Stats API game content — every highlight item with its full keyword taxonomy (keywordsAll).
  C. MLB.com weekly video sitemaps 2024–2026 — titles AND descriptions (work/angle-clips.json, from angles.py).
  D. MLB Film Room by playId — every camera feed attached to the pitch's clip. The schema defines HIGHHOME,
     MIDHOME, CF and side-view feeds; a listed non-broadcast feed is a credible record even without a public embed.
  E. MLB Gameday — the play's own Gameday page (where Gameday 3D lives), checked to resolve to this play.

A clip counts as High Home only when MLB's own title, description or slug calls it a High Home angle/camera/view
("a high home run" never matches). Candidates are matched to the play by, in order: the clip's playId (guid);
Film Room play info (game, inning, half, outs, batter); MLB's text naming the batter or the half-inning plus the
event, unique among the game's plays. A High Home clip in the right game that can't be pinned to one play goes to
work/hh-review.json — it is never assigned automatically, and nothing from another game is ever used.

Status per play (stored at cameras.highHome.status):
  verified      High Home clip matched to this event and MLB's embed plays it
  inaccessible  a credible High Home record exists (matched clip whose page/embed fails, or a non-broadcast feed
                listed on the play's Film Room record) but it can't be played through MLB's public embed
  not_found     every source answered; no High Home recording matches this play
  not_searched  at least one source could not be queried (throttling) — re-run to finish
Other MLB-named angles that match the play (e.g. Field View, center-field cam) are added as extra cameras, never as
High Home.
"""
from __future__ import annotations

import collections
import json
import os
import random
import re
import sys
import time

import mlb
import videos
from angles import HIGH_HOME, OTHER
from cameras import cameras_from

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
RESULTS = os.path.join(WORK, "hh-results.json")
REVIEW = os.path.join(WORK, "hh-review.json")
VISUAL = os.path.join(WORK, "hh-visual.json")      # clips a person confirmed as High Home by their frame (hh_visual.py)


def visual_confirmed():
    return json.load(open(VISUAL)) if os.path.exists(VISUAL) else {}
NON_BROADCAST = {"HIGHHOME", "MIDHOME", "CF", "FIRST_BASE_BATTER_SIDEVIEW", "FIRST_BASE_PITCHER_SIDEVIEW", "FIRST_BASE_SIDEVIEW",
                 "THIRD_BASE_BATTER_SIDEVIEW", "THIRD_BASE_PITCHER_SIDEVIEW", "THIRD_BASE_SIDEVIEW", "COACHING_MULTIVIEW"}
HALF = {"top": "top", "bottom": "bottom"}


def classify(text: str, kw: list[str]):
    if HIGH_HOME.search(text):
        return "high-home"
    if "exclusive-angle" in kw:
        return "field-view" if re.search(r"field[- ]view", text, re.I) else "alternate"
    m = OTHER.search(text)
    return (m.group(0).lower().replace(" ", "-") if m else None)


def norm_clip(src, slug, title, desc, kw, guid=None, play=None, date=None, thumb=None, duration=None):
    text = f"{slug} {title or ''} {desc or ''}"
    angle, by = classify(text, kw), "text"
    v = VISUAL_OK.get(slug)
    if v and v.get("verdict") == "high-home":
        angle, by = "high-home", "visual"
    return {"source": src, "slug": slug, "title": title, "description": desc, "keywords": kw, "guid": guid, "playInfo": play,
            "date": date, "thumb": thumb, "duration": duration, "angle": angle, "angleBy": by, "visual": v}


VISUAL_OK = visual_confirmed()


def gather(pk, date, sitemap):
    """All angle-labelled clips for a game, from sources A–C. Returns (clips, per-source log)."""
    log, out = [], []
    try:
        fr = mlb.filmroom_game_cms(pk)
        n = 0
        for m in fr:
            kw = [k["slug"] for k in (m.get("keywordsDisplay") or [])]
            cuts = [c for f in m.get("feeds", []) for c in ((f.get("image") or {}).get("cuts") or [])]
            c = norm_clip("filmroom-game", m["slug"], m.get("title"), m.get("description") or m.get("blurb"), kw, m.get("guid"), m.get("playInfo"),
                          (m.get("date") or "")[:10], next((x.get("src") for x in cuts if x.get("width") == 640), None),
                          next((f.get("duration") for f in m.get("feeds", []) if f.get("duration")), None))
            if c["angle"]:
                out.append(c); n += 1
        log.append({"source": "MLB Film Room — all editorial clips of the game", "clips": len(fr), "angleClips": n,
                    "highHome": sum(c["angle"] == "high-home" for c in out if c["source"] == "filmroom-game")})
    except mlb.SourceError as e:
        log.append({"source": "MLB Film Room — all editorial clips of the game", "error": str(e)})
    try:
        content = mlb.content(pk)
        items = ((content.get("highlights") or {}).get("highlights") or {}).get("items") or []
        n = 0
        for it in items:
            kw = [k.get("value") for k in it.get("keywordsAll") or [] if k.get("type") == "taxonomy"]
            c = norm_clip("statsapi-content", it.get("slug"), it.get("title") or it.get("headline"), it.get("description") or it.get("blurb"), kw,
                          it.get("guid"), None, (it.get("date") or "")[:10])
            if c["angle"] and not any(x["slug"] == c["slug"] for x in out):
                out.append(c); n += 1
        log.append({"source": "MLB Stats API — game content (highlights, keywordsAll)", "clips": len(items), "angleClips": n})
    except (mlb.SourceError, ValueError) as e:
        log.append({"source": "MLB Stats API — game content", "error": str(e)})
    import datetime as dt
    day = dt.date.fromisoformat(date)
    near = {(day + dt.timedelta(days=i)).isoformat() for i in (0, 1, 2)}
    sm = [a for a in sitemap if a.get("date") in near]
    n = 0
    for a in sm:
        if any(x["slug"] == a["slug"] for x in out):
            continue
        c = norm_clip("mlbcom-sitemap", a["slug"], a.get("title"), a.get("description"), [], date=a.get("date"))
        if c["angle"]:
            out.append(c); n += 1
    log.append({"source": "MLB.com weekly video sitemaps 2024–2026 (titles + descriptions)", "clipsNearDate": len(sm), "angleClips": n,
                "note": "not tied to a game — must name this play's batter"})
    return out, log


def match(c, d, plays_in_game):
    """How (if at all) a candidate clip identifies this exact play. Returns (method or None, ambiguous?)."""
    pid = d["source"].get("playId")
    if pid and c.get("guid") == pid:
        return "playId (clip guid)", False
    pi = c.get("playInfo") or {}
    if pi.get("gamePk") == d["game"]["gamePk"] and pi.get("inning") == d["before"]["inning"] and (pi.get("inningHalf") or "").lower().startswith(d["before"]["half"][:3]) \
            and ((pi.get("players") or {}).get("batter") or {}).get("id") == d["batter"]["id"] and pi.get("outs") in (d["before"]["outs"], None):
        return "Film Room play info (game, inning, half, batter)", False
    rec = {"id": d["id"], "game": d["game"], "batter": d["batter"], "event": d["event"], "before": d["before"]}
    a = {"title": c.get("title"), "description": c.get("description"), "slug": c["slug"]}
    if c["source"] == "mlbcom-sitemap":
        a["url"] = "sitemap"               # not tied to the game: must name the batter
    if videos._angle_matches(a, rec, plays_in_game):
        return "MLB's text names this play (batter or half-inning + event), unique in the game", False
    # same game, angle clip, but not uniquely this play — worth a human look if it plausibly could be
    text = f"{c.get('title') or ''} {c.get('description') or ''}".lower()
    last = d["batter"]["name"].split()[-1].lower()
    inn = re.search(r"\b(top|bottom) of the (\d{1,2})(?:st|nd|rd|th)", text)
    plausible = last in text or (inn and int(inn.group(2)) == d["before"]["inning"] and inn.group(1) == d["before"]["half"])
    return None, bool(plausible) and c["source"] != "mlbcom-sitemap"


def discover(d, plays_in_game, sitemap):
    pk, date = d["game"]["gamePk"], d["game"]["date"]
    clips, log = gather(pk, date, sitemap)
    errors = any("error" in x for x in log)
    # D. Film Room feeds by playId
    pid, feed_alt = d["source"].get("playId"), []
    if pid:
        try:
            feeds = sorted({f.get("type") for m in mlb.filmroom_by_play(pid) for f in m.get("feeds", [])})
            feed_alt = sorted(set(feeds) & NON_BROADCAST)
            log.append({"source": "MLB Film Room — camera feeds on the play's own clip (playId)", "feeds": feeds, "nonBroadcast": feed_alt})
        except mlb.SourceError as e:
            log.append({"source": "MLB Film Room — camera feeds (playId)", "error": str(e)}); errors = True
    hh_found, other_found, review, inaccessible = [], [], [], []
    for c in clips:
        how, amb = match(c, d, plays_in_game)
        if not how:
            if amb and c["angle"] == "high-home":
                review.append({"play": d["id"], "clip": c["slug"], "title": c["title"], "source": c["source"], "why": "High Home clip in this game; text doesn't pin it to one play"})
            continue
        clip = videos._clip(c["slug"], "high-home" if c["angle"] == "high-home" else "alternate", c.get("title"), c.get("duration"), "CMS",
                            ({"category": "high-home", "label": "HIGH HOME — labelled by MLB"} if c.get("angleBy") != "visual" else
                             {"category": "high-home", "label": "HIGH HOME — confirmed from the frame (MLB calls it: " + (c["visual"].get("mlbWords") or "no camera named") + ")",
                              "visual": c["visual"]}) if c["angle"] == "high-home"
                            else {"category": "alternate", "label": f"{c['angle'].replace('-', ' ').title()} (MLB's name for this angle)"},
                            f"Found via {c['source']}; matched by {how}; " + ("camera named by MLB's own title/description" if c.get("angleBy") != "visual" else "camera confirmed by inspecting MLB's poster frame: the elevated view from directly behind home plate"), c.get("thumb"),
                            {"method": how, "source": c["source"]})
        rep = []
        playable = videos._check(clip, rep)
        entry = {"clip": clip, "playable": playable, "report": rep}
        if c["angle"] == "high-home":
            (hh_found if playable else inaccessible).append(entry)
        elif playable:
            other_found.append(entry)
    if feed_alt and not hh_found:
        inaccessible.append({"feed": feed_alt, "why": "Film Room lists a non-broadcast camera feed for this pitch; MLB's public embed plays the broadcast feed only"})
    status = "verified" if hh_found else "inaccessible" if inaccessible else "not_searched" if errors else "not_found"
    # E. Gameday play page (3D lives there)
    gd = mlb.gameday_play(pk, d["source"]["atBatIndex"])
    log.append({"source": "MLB Gameday — the play's page (Gameday 3D)", "ok": gd.get("ok"), "url": gd.get("canonical") or gd.get("url")})
    return {"status": status, "highHome": hh_found, "other": other_found, "inaccessible": inaccessible, "review": review, "log": log,
            "gameday": gd, "checkedAt": time.strftime("%Y-%m-%d")}


def apply(app, results):
    """Write results into the app's data: High Home / other clips added (broadcast kept), status + provenance stored."""
    pdir, idx_path = os.path.join(app, "data", "plays"), os.path.join(app, "data", "index.json")
    idx = json.load(open(idx_path))
    for p in idx["plays"]:
        r = results.get(p["id"])
        if not r:
            continue
        fp = os.path.join(pdir, p["id"] + ".json")
        d = json.load(open(fp))
        for e in r["highHome"]:
            if not any(c["slug"] == e["clip"]["slug"] for c in d["clips"]):
                d["clips"].insert(0, e["clip"])
        for e in r["other"]:
            if not any(c["slug"] == e["clip"]["slug"] for c in d["clips"]):
                d["clips"].append(e["clip"])
        already = any(c["kind"] == "high-home" for c in d["clips"])
        status = "verified" if already else r["status"]
        cam = cameras_from(d["clips"], (d.get("cameras") or {}).get("highHome", {}).get("searched"))
        cam["highHome"].update({"status": status, "checkedAt": r["checkedAt"], "sources": r["log"],
                                "inaccessible": [{k: v for k, v in x.items() if k != "clip"} | ({"slug": x["clip"]["slug"], "report": x["report"]} if "clip" in x else {}) for x in r["inaccessible"]],
                                "review": r["review"]})
        cam["broadcast"]["status"] = "verified" if cam["broadcast"]["available"] else "not_found"
        gd = r.get("gameday") or {}
        cam["gameday"] = {"url": gd.get("canonical") or gd.get("url"), "linkVerified": bool(gd.get("ok")), "checkedAt": r["checkedAt"],
                          "access": "Gameday 3D needs a free MLB.com account; full regular-season games in 3D need MLB.TV. A tracking-based reconstruction, not camera footage."}
        d["cameras"] = cam
        json.dump(d, open(fp, "w"), indent=1, ensure_ascii=False)
        p["cameras"] = {"broadcast": cam["broadcast"]["available"], "highHome": cam["highHome"]["available"], "highHomeStatus": status,
                        "other": [o["label"] for o in cam["other"]], "gameday": cam["gameday"]["linkVerified"]}
        p["angles"] = [c["angle"]["category"] for c in d["clips"]]
    json.dump(idx, open(idx_path, "w"), indent=1, ensure_ascii=False)
    return idx


def sample(plays, n):
    """Diverse sample: spread over seasons, categories, game types, and always include the two known High Home plays."""
    rnd = random.Random(7)
    by = collections.defaultdict(list)
    for p in plays:
        by[(p["season"], p["category"], p["gameType"] != "R")].append(p)
    out = [p for p in plays if (p.get("cameras") or {}).get("highHome")]
    keys = list(by)
    rnd.shuffle(keys)
    while len(out) < n and any(by.values()):
        for k in keys:
            if by[k] and len(out) < n:
                x = by[k].pop(rnd.randrange(len(by[k])))
                if x not in out:
                    out.append(x)
    return out


def report(idx):
    P = idx["plays"]
    st = collections.Counter((p.get("cameras") or {}).get("highHomeStatus", "not_searched") for p in P)
    return {"plays": len(P), "broadcast": sum((p.get("cameras") or {}).get("broadcast", False) for p in P),
            "highHome": sum((p.get("cameras") or {}).get("highHome", False) for p in P), "status": dict(st),
            "otherAngles": sum(bool((p.get("cameras") or {}).get("other")) for p in P),
            "gamedayLinks": sum((p.get("cameras") or {}).get("gameday", False) for p in P)}


def main(argv):
    app = os.path.abspath(argv[0])
    idx = json.load(open(os.path.join(app, "data", "index.json")))
    if "--report" in argv:
        print(json.dumps(report(idx), indent=1)); return
    plays = idx["plays"]
    if "--ids" in argv:
        want = set(argv[argv.index("--ids") + 1].split(","))
        plays = [p for p in plays if p["id"] in want]
    elif "--sample" in argv:
        plays = sample(plays, int(argv[argv.index("--sample") + 1]))
    results = json.load(open(RESULTS)) if os.path.exists(RESULTS) else {}
    sitemap = json.load(open(os.path.join(WORK, "angle-clips.json")))
    by_game = collections.defaultdict(list)
    with open(os.path.join(WORK, "records.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            by_game[r["game"]["gamePk"]].append(r)
    fresh = "--fresh" in argv
    for n, p in enumerate(plays):
        if not fresh and p["id"] in results and results[p["id"]]["status"] != "not_searched":
            continue
        d = json.load(open(os.path.join(app, "data", "plays", p["id"] + ".json")))
        r = discover(d, by_game.get(d["game"]["gamePk"], []), sitemap)
        results[p["id"]] = r
        json.dump(results, open(RESULTS, "w"), indent=1, ensure_ascii=False)      # resumable after every play
        ang = collections.Counter(c["angle"] for c in gather_cache(r))
        print(f"{n + 1}/{len(plays)} {p['id']:20} {r['status']:13} HH {len(r['highHome'])} other {len(r['other'])} review {len(r['review'])} "
              f"gameday {'ok' if r['gameday'].get('ok') else 'no'} · " + "; ".join(f"{x['source'].split(' — ')[0]}:{x.get('angleClips', x.get('nonBroadcast', x.get('ok', x.get('error'))))}" for x in r["log"]), flush=True)
    queue = [q for r in results.values() for q in r["review"]]
    json.dump(queue, open(REVIEW, "w"), indent=1, ensure_ascii=False)
    idx = apply(app, results)
    print(json.dumps(report(idx), indent=1))
    print(f"review queue: {len(queue)} → {REVIEW}")


def gather_cache(r):
    return [e["clip"] | {"angle": e["clip"]["angle"]["category"]} for e in r["highHome"] + r["other"]]


if __name__ == "__main__":
    main(sys.argv[1:])
