"""Step 2 + 4 — curate the starter set and verify it.

Reads work/records.jsonl (discover.py) and picks plays for each teaching slot below: a rule over the objective
flags/fields, then a preference score (an MLB.com highlight for the play, High Home, fewer repeats of the same
game / team / player, clear outcome). Every pick goes through videos.clips_for(); a play without a verified,
playable MLB clip is skipped and the next candidate takes the slot (logged as a replacement).
Writes work/curated.json and work/validation.json.
Usage: python3 curate.py [--only-ids id,id]
"""
from __future__ import annotations

import collections
import json
import os
import sys

import mlb
import videos

WORK = os.path.join(mlb.HERE, "work")


def has(*flags):
    return lambda r: all(f in r["flags"] for f in flags)


def chain_has(pat):
    return lambda r: any(pat in c["chain"] for c in r.get("chains", []))


def both(*preds):
    return lambda r: all(p(r) for p in preds)


def bases(code):
    return lambda r: r["before"]["bases"] == code


def outs(*n):
    return lambda r: r["before"]["outs"] in n


def loc(*n):
    return lambda r: (r.get("batted") or {}).get("location") in n


def etype(*t):
    return lambda r: r["event"]["type"] in t


def no(*flags):
    return lambda r: not any(f in r["flags"] for f in flags)


# (category, slot title, predicate) — ~10 / 10 / 10 / 5 / 5 / 5 / 5
SLOTS = [
    ("Baserunning & advancement", "First to third on a single", has("first_to_third")),
    ("Baserunning & advancement", "Scoring from second on a single", both(has("score_from_second_single"), no("play_at_plate"))),
    ("Baserunning & advancement", "Scoring from first on an extra-base hit", has("score_from_first_xbh")),
    ("Baserunning & advancement", "Tagging up on a fly ball", both(has("tag_up"), no("sac_fly"))),
    ("Baserunning & advancement", "Stolen base", both(has("stolen_base"), no("error"))),
    ("Baserunning & advancement", "Stealing third", etype("stolen_base_3b")),
    ("Baserunning & advancement", "Caught stealing", both(has("caught_stealing"), no("pickoff"))),
    ("Baserunning & advancement", "Picked off", has("pickoff")),
    ("Baserunning & advancement", "Runner thrown out advancing", both(has("runner_out_on_bases"), no("out_at_plate", "doubled_off", "double_play"))),
    ("Baserunning & advancement", "Rundown", has("rundown")),
    ("Infield defense & decisions", "First and third, ground ball to the middle infield", both(bases("1_3"), outs(0, 1), has("ground_ball", "middle_infield"))),
    ("Infield defense & decisions", "Ground-ball double play up the middle", both(has("double_play", "ground_ball"), loc(4, 6))),
    ("Infield defense & decisions", "Double play started at a corner", both(has("double_play", "ground_ball"), loc(1, 3, 5))),
    ("Infield defense & decisions", "Force at home, bases loaded", both(bases("123"), has("force_play", "out_at_plate"))),
    ("Infield defense & decisions", "Runner on third, infield ground ball, play at home", both(has("ground_ball_infield", "out_at_plate"), no("force_play"))),
    ("Infield defense & decisions", "Infield throwing error", both(has("error", "ground_ball_infield"), lambda r: any(c["credit"] == "f_throwing_error" for x in r["runners"] for c in x["credits"]))),
    ("Infield defense & decisions", "Infield fielding error", both(has("error", "ground_ball_infield"), lambda r: any(c["credit"] == "f_fielding_error" for x in r["runners"] for c in x["credits"]))),
    ("Infield defense & decisions", "Bunt defense: out at second or third", both(has("bunt"), lambda r: any(x["out"] and not x["isBatter"] for x in r["runners"]))),
    ("Infield defense & decisions", "Ground ball into a non-standard infield alignment", both(has("ground_ball_infield", "shift_alignment"), has("risp"))),
    ("Infield defense & decisions", "Tag play on a runner at third", both(has("tag_play", "ground_ball_infield"), lambda r: any(x["out"] and x["outBase"] == "3B" for x in r["runners"]))),
    ("Outfield defense, cutoffs & relays", "Runner on second, one out, single — throw home, out at the plate", both(bases("_2_"), outs(1), has("single", "out_at_plate"))),
    ("Outfield defense, cutoffs & relays", "Single to right, runner from second thrown out at home", both(has("single", "out_at_plate"), loc(9), lambda r: any(x["start"] == "2B" and x["out"] for x in r["runners"]))),
    ("Outfield defense, cutoffs & relays", "Outfield assist at third", both(has("outfield_assist"), lambda r: any(x["out"] and x["outBase"] == "3B" for x in r["runners"]))),
    ("Outfield defense, cutoffs & relays", "Outfield assist at second", both(has("outfield_assist"), lambda r: any(x["out"] and x["outBase"] == "2B" for x in r["runners"]))),
    ("Outfield defense, cutoffs & relays", "Relay throw completes the out", has("relay")),
    ("Outfield defense, cutoffs & relays", "Sacrifice fly to right or center", both(has("sac_fly"), loc(8, 9))),
    ("Outfield defense, cutoffs & relays", "Single to left, runner scores from second", both(has("score_from_second_single"), loc(7))),
    ("Outfield defense, cutoffs & relays", "Extra-base hit down the line: cutoff and relay", both(etype("double", "triple"), has("outfield_play"), lambda r: r["event"]["runs"] >= 1, no("score_from_first_xbh"))),
    ("Outfield defense, cutoffs & relays", "Triple: relay to third", both(etype("triple"), has("outfield_play"))),
    ("Outfield defense, cutoffs & relays", "Runner tags from second to third on a fly", both(has("tag_up"), lambda r: any(x["start"] == "2B" and x["end"] == "3B" for x in r["runners"]))),
    ("Catcher defense & plays at the plate", "Catcher throws out a base stealer", both(has("catcher_throw", "caught_stealing"), no("pickoff"))),
    ("Catcher defense & plays at the plate", "Catcher pickoff", both(has("catcher_throw", "pickoff"))),
    ("Catcher defense & plays at the plate", "Tag play at the plate", both(has("out_at_plate"), no("force_play"), lambda r: any(c["pos"] == "C" and c["credit"] == "f_putout" for x in r["runners"] for c in x["credits"]))),
    ("Catcher defense & plays at the plate", "Wild pitch or passed ball, runner advances", lambda r: ("wild_pitch" in r["flags"] or "passed_ball" in r["flags"]) and not r["source"]["terminal"]),
    ("Catcher defense & plays at the plate", "Bunt fielded by the pitcher or catcher", has("bunt_defense_pc")),
    ("Situational hitting", "Sacrifice fly to left", both(has("sac_fly"), loc(7))),
    ("Situational hitting", "Moving the runner over with nobody out", both(has("productive_out"), outs(0), bases("_2_"), has("ground_ball"))),
    ("Situational hitting", "Two-out RBI single", both(has("two_out_rbi", "single"))),
    ("Situational hitting", "Sacrifice bunt", etype("sac_bunt")),
    ("Situational hitting", "Run scores on a ground-ball out", both(has("runner_scored_on_out", "ground_ball"), no("error", "double_play"))),
    ("High-leverage & unusual situations", "Go-ahead swing late in a postseason game", both(has("go_ahead_play", "postseason"), lambda r: r["before"]["inning"] >= 7)),
    ("High-leverage & unusual situations", "Walk-off", has("walkoff")),
    ("High-leverage & unusual situations", "Extra innings, runner in scoring position", both(has("extra_innings", "risp"), lambda r: r["event"]["runs"] >= 1 or r["event"]["outs"] >= 1)),
    ("High-leverage & unusual situations", "Bases loaded, high leverage", both(bases("123"), has("high_leverage"))),
    ("High-leverage & unusual situations", "Winning run on base in a walk-off situation", both(has("winning_run_on", "high_leverage"), no("walkoff"))),
    ("Miscellaneous teaching moments", "Overturned or upheld on review", has("challenge")),
    ("Miscellaneous teaching moments", "Balk", has("balk")),
    ("Miscellaneous teaching moments", "Doubled off", has("doubled_off")),
    ("Miscellaneous teaching moments", "Pop-up with runners on", both(has("popup"), lambda r: r["before"]["bases"] != "___", lambda r: r["event"]["outs"] >= 1)),
    ("Miscellaneous teaching moments", "Strikeout with a runner in motion", both(has("strikeout"), lambda r: any(not x["isBatter"] for x in r["runners"]))),
    # spares, used only if a slot above has no verified play
    ("Miscellaneous teaching moments", "Intentional walk to set up a force", etype("intent_walk")),
    ("Miscellaneous teaching moments", "Line drive with runners on, outfield play", both(has("line_drive", "outfield_play"), lambda r: r["before"]["bases"] != "___")),
]
TARGET = {"Baserunning & advancement": 10, "Infield defense & decisions": 10, "Outfield defense, cutoffs & relays": 10,
          "Catcher defense & plays at the plate": 5, "Situational hitting": 5, "High-leverage & unusual situations": 5,
          "Miscellaneous teaching moments": 5}


def load():
    """Records from discover.py, with flags and fielding chains re-derived by the current rules (no refetch)."""
    from normalize import derive, _chain, merge_runners
    recs = list({r["id"]: r for r in (json.loads(l) for l in open(os.path.join(WORK, "records.jsonl")))}.values())
    for r in recs:
        r["runners"] = merge_runners(r["runners"])
        r["event"]["runs"] = sum(1 for x in r["runners"] if x["end"] == "score" and not x["out"])
        r["event"]["outs"] = sum(1 for x in r["runners"] if x["out"])
        r["flags"] = derive(r)
        r["chains"] = [_chain(x) for x in r["runners"] if x["credits"]]
    return recs


def main():
    recs = load()
    clips = json.load(open(os.path.join(WORK, "clips.json")))
    by_play, angled = clips["byPlay"], clips["angled"]
    sitemap = json.load(open(os.path.join(WORK, "angle-clips.json"))) if os.path.exists(os.path.join(WORK, "angle-clips.json")) else []
    by_game = collections.defaultdict(list)
    for r in recs:
        by_game[r["game"]["gamePk"]].append(r)
    hh_dates = {a["date"] for a in sitemap if a["angle"] == "high-home"}
    hh_games = {pk for pk, lst in angled.items() if any(a.get("angle") == "high-home" for a in lst)}
    # plays that MLB published a High Home clip for: strongly preferred in any slot they fit
    hh_ids = set()
    hh_items = [a for a in sitemap if a["angle"] == "high-home"]
    hh_content = {pk: [a for a in lst if a.get("angle") == "high-home"] for pk, lst in angled.items()}
    for r in recs:
        if r["game"]["date"] in hh_dates or str(r["game"]["gamePk"]) in hh_games:
            if any(videos._angle_matches(a, r, by_game[r["game"]["gamePk"]]) for a in videos.angle_candidates(r, hh_content, hh_items)):
                hh_ids.add(r["id"])
    print("plays with an MLB High Home clip:", sorted(hh_ids), flush=True)
    picked, log, used = [], [], set()
    games, teams, people = collections.Counter(), collections.Counter(), collections.Counter()
    per_cat = collections.Counter()

    def score(r):
        s = 0.0
        pid = r["source"]["playId"]
        if pid in by_play: s += 3                                          # MLB.com edited highlight for this exact play
        if r["id"] in hh_ids: s += 8
        s -= 2.5 * games[r["game"]["gamePk"]]
        s -= 0.8 * (teams[r["game"]["away"]["abbr"]] + teams[r["game"]["home"]["abbr"]])
        s -= 1.5 * people[r["batter"]["id"]]
        s += 0.5 * min(3, len(r["flags"]) / 6)
        if r["game"]["season"] == 2024: s += 0.6                           # spread seasons
        if (r.get("winprob") or {}).get("li") and r["winprob"]["li"] >= 1.5: s += 0.5
        return s

    for cat, slot, pred in SLOTS:
        if per_cat[cat] >= TARGET[cat]:
            continue
        cands = [r for r in recs if r["id"] not in used and r["source"]["playId"] and pred(r)]
        cands.sort(key=score, reverse=True)
        tried = 0
        for r in cands[:12]:
            tried += 1
            report = []
            cl = videos.clips_for(r, by_play, angled, report, sitemap, by_game[r["game"]["gamePk"]])
            if not cl:
                log.append({"slot": slot, "id": r["id"], "result": "rejected — no verified playable clip", "details": report})
                continue
            sav = videos.savant_check(r)
            r = dict(r)
            r["curation"] = {"category": cat, "slot": slot}
            r["video"] = {"clips": cl, "savant": sav}
            r["verification"] = {"report": report, "replacedBefore": tried - 1}
            picked.append(r)
            used.add(r["id"]); games[r["game"]["gamePk"]] += 1
            teams[r["game"]["away"]["abbr"]] += 1; teams[r["game"]["home"]["abbr"]] += 1; people[r["batter"]["id"]] += 1
            per_cat[cat] += 1
            log.append({"slot": slot, "id": r["id"], "result": "imported" + (f" (after {tried - 1} rejected)" if tried > 1 else ""),
                        "clips": [c["kind"] + ":" + c["angle"]["category"] for c in cl]})
            print(f"OK  {cat[:22]:22} | {slot[:48]:48} | {r['id']} | {[c['kind'] for c in cl]}", flush=True)
            break
        else:
            log.append({"slot": slot, "id": None, "result": f"unfilled — {len(cands)} candidates, none verified" if cands else "unfilled — no candidate in the scanned games"})
            print(f"--  {cat[:22]:22} | {slot[:48]:48} | {len(cands)} candidates", flush=True)
    json.dump(picked, open(os.path.join(WORK, "curated.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"log": log, "perCategory": per_cat, "target": TARGET}, open(os.path.join(WORK, "validation.json"), "w"), indent=1)
    print("DONE", len(picked), dict(per_cat))


if __name__ == "__main__":
    main()
