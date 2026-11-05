"""Step 1 — discovery: scan games, normalize every play, index each game's MLB.com clips.

For each final game in the date ranges: MLB live feed → normalized play records (normalize.py), MLB win
probability (leverage index), Savant's per-pitch Statcast (alignment, run/win expectancy change) and the game's
MLB.com highlight list (a clip's `guid` is the playId of the pitch it shows). Writes:
  work/records.jsonl   one normalized play per line (all plays, not only candidates)
  work/clips.json      {playId: [MLB.com highlight clips]} + angle-labelled clips per game
Re-running is incremental: games already in work/records.jsonl are skipped (dedupe by record id).
Usage: python3 discover.py 2025-09-30:2025-11-02 2025-06-14 2024-08-10 …   (a date or start:end)
"""
from __future__ import annotations

import json
import os
import sys

import mlb
import normalize as N
from angles import angle_of

WORK = os.path.join(mlb.HERE, "work")


def game_clips(pk: int):
    """MLB.com clips for a game: by playId (guid) and those MLB labels with a camera angle."""
    try:
        c = mlb.content(pk)
    except mlb.SourceError:
        return {}, []
    by_play, angled = {}, []
    for it in ((c.get("highlights") or {}).get("highlights") or {}).get("items", []) or []:
        tax = [k["value"] for k in it.get("keywordsAll", []) if k.get("type") == "taxonomy"]
        players = [int(k["value"]) for k in it.get("keywordsAll", []) if k.get("type") == "player_id" and str(k.get("value", "")).isdigit()]
        img = ((it.get("image") or {}).get("cuts") or [])
        thumb = next((x.get("src") for x in img if x.get("width") in (640, 372, 320)), img[0].get("src") if img else None)
        clip = {"slug": it.get("slug"), "title": it.get("headline") or it.get("title"), "description": it.get("description") or it.get("blurb") or "",
                "duration": it.get("duration"), "guid": it.get("guid"), "taxonomy": tax, "players": players, "thumb": thumb}
        a = angle_of((it.get("slug") or "") + " " + (clip["title"] or ""))
        if a or "exclusive-angle" in tax:
            angled.append({**clip, "angle": a or "alternate angle"})
        elif it.get("guid") and ("highlight" in tax or "in-game-highlight" in tax or "game-action-tracking" in tax):
            by_play.setdefault(it["guid"], []).append(clip)
    return by_play, angled


def main(argv):
    os.makedirs(WORK, exist_ok=True)
    rec_path, clip_path = os.path.join(WORK, "records.jsonl"), os.path.join(WORK, "clips.json")
    seen_games = set()
    if os.path.exists(rec_path):
        for line in open(rec_path):
            seen_games.add(json.loads(line)["game"]["gamePk"])
    clips = json.load(open(clip_path)) if os.path.exists(clip_path) else {"byPlay": {}, "angled": {}}
    games = []
    for arg in argv:
        a, _, b = arg.partition(":")
        games += mlb.schedule(a, b or a)
    games = [g for g in {g["gamePk"]: g for g in games}.values() if g["gamePk"] not in seen_games]
    print(len(games), "new final games", flush=True)
    with open(rec_path, "a") as out:
        for n, g in enumerate(games):
            pk = g["gamePk"]
            try:
                recs = N.game_plays(mlb.feed(pk), mlb.win_probability(pk), mlb.statcast_game(pk))
            except (mlb.SourceError, KeyError, IndexError) as e:
                print("ERR", pk, repr(e)[:160], flush=True)
                continue
            by_play, angled = game_clips(pk)
            clips["byPlay"].update(by_play)
            if angled:
                clips["angled"][str(pk)] = angled
            for r in recs:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
            out.flush()
            json.dump(clips, open(clip_path, "w"))
            print(f"{n + 1}/{len(games)} {g['officialDate']} {pk} plays {len(recs)} clips {len(by_play)} angled {len(angled)}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
