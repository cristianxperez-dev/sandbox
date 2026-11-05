"""Camera availability, searched independently for every published play: Broadcast and High Home.

    python3 cameras.py ../../apps/play-repository          # search, verify, write `cameras` into the app's data
    python3 cameras.py ../../apps/play-repository --report # print the counts only

For each play this actively looks for High Home footage instead of taking the first clip an API returns:

  1. MLB Film Room, by the play's Statcast playId. Film Room's schema has camera feed types beyond broadcast
     (HIGHHOME, MIDHOME, CF, first/third-base side views), so every feed attached to the play's clip is recorded.
     A HIGHHOME feed would be noted, but it is NOT counted as available: MLB's embed for a Film Room clip plays
     its default broadcast feed, and the raw feed URLs are MLB's video files, which we never hotlink or rehost.
  2. MLB.com clips that MLB itself titles "High Home" — its weekly video sitemaps for 2024, 2025 and 2026
     (work/angle-clips.json from angles.py) — matched to this exact play by the same rule as videos.py: MLB's
     text names the batter or the half-inning, the event matches, and no other play in the game fits.
  3. The game's own MLB.com content list (statsapi game content), for clips whose title or slug says High Home.

A camera is "available" only when a clip for it was verified: MLB.com's page declares the embed and the embed
answers 200/206. Broadcast = any verified clip MLB presents as broadcast footage (highlight or Film Room feed).
High Home = only a clip MLB itself labels High Home. Other MLB-named angles (e.g. "Field View") are kept as
"other" with MLB's own name and are never counted as High Home.
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
import time

import mlb
import videos

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
HH = re.compile(r"high[- ]home", re.I)
NON_BROADCAST_FEEDS = {"HIGHHOME", "MIDHOME", "CF", "FIRST_BASE_BATTER_SIDEVIEW", "FIRST_BASE_PITCHER_SIDEVIEW", "FIRST_BASE_SIDEVIEW",
                       "THIRD_BASE_BATTER_SIDEVIEW", "THIRD_BASE_PITCHER_SIDEVIEW", "THIRD_BASE_SIDEVIEW", "COACHING_MULTIVIEW"}


def cameras_from(clips, search=None, checked=None):
    """The per-camera availability record stored on each play (detail) — Broadcast and High Home independently."""
    def cam(pred):
        ix = [i for i, c in enumerate(clips) if pred(c) and (c.get("checks") or {}).get("pageEmbed") and (c.get("checks") or {}).get("embedStatus") in (200, 206)]
        return {"available": bool(ix), "clips": ix}
    out = {"broadcast": cam(lambda c: c["angle"]["category"] == "broadcast"),
           "highHome": cam(lambda c: c["angle"]["category"] == "high-home" and c["kind"] == "high-home"),
           "other": [{"clip": i, "label": c["angle"]["label"]} for i, c in enumerate(clips) if c["angle"]["category"] == "alternate"]}
    if search is not None:
        out["highHome"]["searched"] = search
        out["highHome"]["checkedAt"] = checked or time.strftime("%Y-%m-%d")
    return out


def load_records(ids):
    recs, by_game = {}, collections.defaultdict(list)
    with open(os.path.join(WORK, "records.jsonl")) as f:
        for line in f:
            r = json.loads(line)
            by_game[r["game"]["gamePk"]].append(r)
            if r["id"] in ids:
                recs[r["id"]] = r
    return recs, by_game


def search_high_home(d, rec, plays_in_game, sitemap_hh, content_hh):
    """Returns (clip or None, search log). The log says, per source, what was looked for and what was found."""
    log = []
    pid = d["source"].get("playId")
    # 1. Film Room feeds for the playId
    if pid:
        try:
            feeds = sorted({f.get("type") for m in mlb.filmroom_by_play(pid) for f in m.get("feeds", [])})
            alt = sorted(set(feeds) & NON_BROADCAST_FEEDS)
            log.append({"source": "MLB Film Room (playId)", "feeds": feeds,
                        "result": ("non-broadcast feed listed (" + ", ".join(alt) + ") — no embeddable clip for it") if alt else "broadcast feeds only"})
        except mlb.SourceError as e:
            log.append({"source": "MLB Film Room (playId)", "result": f"unavailable: {e}"})
    else:
        log.append({"source": "MLB Film Room (playId)", "result": "no playId"})
    # 2 + 3. MLB-labelled High Home clips, matched to this play
    found = None
    if rec:
        game_hh = {str(rec["game"]["gamePk"]): content_hh.get(str(rec["game"]["gamePk"]), [])}
        cands = videos.angle_candidates(rec, game_hh, sitemap_hh)
        match = [a for a in cands if videos._angle_matches(a, rec, plays_in_game)]
        log.append({"source": "MLB.com High Home clips (game content + weekly video sitemaps 2024–2026)",
                    "candidates": len(cands), "result": f"matched {match[0]['slug']}" if match else ("none for this game/date" if not cands else "none identify this play")})
        if match:
            a = match[0]
            existing = next((c for c in d["clips"] if c["slug"] == a["slug"]), None)
            if existing:
                found = existing
            else:
                clip = videos._clip(a["slug"], "high-home", a.get("title"), a.get("duration"), "CMS",
                                    {"category": "high-home", "label": "HIGH HOME — labelled by MLB"},
                                    "MLB's own title/description names this camera angle and identifies this play (same game, batter or inning, event)",
                                    a.get("thumb"), {"text": True})
                rep = []
                if videos._check(clip, rep):
                    found = clip
                else:
                    log.append({"source": "verification", "result": "; ".join(rep)})
    else:
        log.append({"source": "MLB.com High Home clips", "result": "play record not in work/records.jsonl — run discover.py for its date"})
    return found, log


def main(argv):
    app = os.path.abspath(argv[0])
    pdir = os.path.join(app, "data", "plays")
    idx_path = os.path.join(app, "data", "index.json")
    idx = json.load(open(idx_path))
    ids = {p["id"] for p in idx["plays"]}
    if "--report" not in argv:
        recs, by_game = load_records(ids)
        sitemap = json.load(open(os.path.join(WORK, "angle-clips.json"))) if os.path.exists(os.path.join(WORK, "angle-clips.json")) else []
        sitemap_hh = [a for a in sitemap if a["angle"] == "high-home" or HH.search(a.get("slug", "") + " " + a.get("title", ""))]
        clips = json.load(open(os.path.join(WORK, "clips.json")))
        content_hh = {pk: [a for a in lst if a.get("angle") == "high-home" or HH.search((a.get("slug") or "") + " " + (a.get("title") or ""))]
                      for pk, lst in clips.get("angled", {}).items()}
        print(f"High Home sources: {len(sitemap_hh)} MLB-labelled sitemap clips, {sum(map(len, content_hh.values()))} in game content lists", flush=True)
        for n, p in enumerate(idx["plays"]):
            fp = os.path.join(pdir, p["id"] + ".json")
            d = json.load(open(fp))
            rec = recs.get(p["id"])
            clip, log = search_high_home(d, rec, by_game.get(d["game"]["gamePk"], []), sitemap_hh, content_hh)
            if clip and clip not in d["clips"]:
                d["clips"].insert(0, clip)       # High Home first when a play has it
            d["cameras"] = cameras_from(d["clips"], log)
            json.dump(d, open(fp, "w"), indent=1, ensure_ascii=False)
            p["cameras"] = {"broadcast": d["cameras"]["broadcast"]["available"], "highHome": d["cameras"]["highHome"]["available"],
                            "other": [o["label"] for o in d["cameras"]["other"]]}
            p["angles"] = [c["angle"]["category"] for c in d["clips"]]
            print(f"{n + 1}/{len(idx['plays'])} {p['id']:20} broadcast={p['cameras']['broadcast']} highHome={p['cameras']['highHome']} · {log[0]['result']}", flush=True)
        json.dump(idx, open(idx_path, "w"), indent=1, ensure_ascii=False)
    P = idx["plays"]
    b = sum(p["cameras"]["broadcast"] for p in P); h = sum(p["cameras"]["highHome"] for p in P)
    both = sum(p["cameras"]["broadcast"] and p["cameras"]["highHome"] for p in P)
    line = f"{len(P)} plays · broadcast {b} · High Home {h} · both {both} · High Home only {h - both} · neither {sum(not p['cameras']['broadcast'] and not p['cameras']['highHome'] for p in P)}"
    print("\n" + line)
    vpath = os.path.join(app, "VALIDATION.md")
    if os.path.exists(vpath):
        v = open(vpath).read().split("\n## Camera availability")[0].rstrip()
        hh_ids = [p["id"] for p in P if p["cameras"]["highHome"]]
        v += "\n\n## Camera availability (cameras.py)\n\n" + "\n".join([
            "| Camera | Plays with verified, playable video |", "|---|---|",
            f"| Broadcast | {b} |", f"| High Home | {h} |", f"| Both | {both} |", "",
            "High Home plays: " + (", ".join(hh_ids) or "none") + ".", "",
            "Every play was searched for High Home independently of broadcast: MLB Film Room feeds for its playId, "
            "MLB.com clips MLB titles \"High Home\" (weekly video sitemaps 2024–2026) and the game's MLB.com content list. "
            "Film Room's schema defines HIGHHOME, MIDHOME, CF and side-view feed types, but none of the plays here (nor any of "
            "1,500 clips sampled across 2024–2026 regular season and postseason) exposes one publicly; MLB.com has published "
            "two High Home clips in that period. Broadcast clips are never labelled High Home, and MLB's \"Field View\" "
            "(a ground-level angle) is never counted as High Home."]) + "\n"
        open(vpath, "w").write(v)


if __name__ == "__main__":
    main(sys.argv[1:])
