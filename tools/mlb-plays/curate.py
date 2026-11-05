"""Step 2 + 4 — curate the starter set and verify it.

Reads work/records.jsonl (discover.py) and picks plays for each teaching slot below: a rule over the objective
flags/fields, then a preference score (an MLB.com highlight for the play, High Home, fewer repeats of the same
game / team / player, clear outcome). Every pick goes through videos.clips_for(); a play without a verified,
playable MLB clip is skipped and the next candidate takes the slot (logged as a replacement).
Writes work/curated.json and work/validation.json.
Usage: python3 curate.py [--total 300] [--app ../../apps/play-repository]
  Incremental: plays already published are kept and counted; only new plays are written to work/curated.json.
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


def runner_from(base, *, out=None, end=None):
    def f(r):
        for x in r["runners"]:
            if x["start"] != base or x["isBatter"]:
                continue
            if out is not None and x["out"] != out:
                continue
            if end is not None and x["end"] != end:
                continue
            return True
        return False
    return f


def credit(kind):
    return lambda r: any(c["credit"] == kind for x in r["runners"] for c in x["credits"])


def li(minimum):
    return lambda r: ((r.get("winprob") or {}).get("li") or 0) >= minimum


def desc(pattern):
    import re
    rx = re.compile(pattern, re.I)
    return lambda r: bool(rx.search(r["event"]["description"] or ""))


BR, IF, OF, CA, SH, HL, MI = ("Baserunning & advancement", "Infield defense & decisions", "Outfield defense, cutoffs & relays",
                              "Catcher defense & plays at the plate", "Situational hitting", "High-leverage & unusual situations",
                              "Miscellaneous teaching moments")
# (category, slot title, predicate, quota) — the quota caps one situation so a category stays varied
SLOTS = [
    (BR, "First to third on a single", has("first_to_third"), 6),
    (BR, "Scoring from second on a single", both(has("score_from_second_single"), no("play_at_plate")), 5),
    (BR, "Scoring from first on an extra-base hit", has("score_from_first_xbh"), 5),
    (BR, "Tagging up on a fly ball", both(has("tag_up"), no("sac_fly")), 4),
    (BR, "Stolen base", both(has("stolen_base"), no("error")), 3),
    (BR, "Stealing third", etype("stolen_base_3b"), 3),
    (BR, "Double steal", both(has("stolen_base"), lambda r: sum(1 for x in r["runners"] if not x["isBatter"] and not x["out"]) >= 2), 2),
    (BR, "Caught stealing", both(has("caught_stealing"), no("pickoff")), 3),
    (BR, "Picked off", has("pickoff"), 3),
    (BR, "Runner thrown out advancing", both(has("runner_out_on_bases"), no("out_at_plate", "doubled_off", "double_play")), 4),
    (BR, "Rundown", has("rundown"), 4),
    (BR, "Batter takes an extra base on the throw", both(etype("single", "double"), lambda r: any(x["isBatter"] and not x["out"] and x["end"] in ("2B", "3B") and r["event"]["type"] == "single" or x["isBatter"] and x["end"] == "3B" and r["event"]["type"] == "double" for x in r["runners"])), 3),
    (IF, "First and third, ground ball to the middle infield", both(bases("1_3"), outs(0, 1), has("ground_ball", "middle_infield")), 4),
    (IF, "Ground-ball double play up the middle", both(has("double_play", "ground_ball"), loc(4, 6)), 4),
    (IF, "Double play started at a corner", both(has("double_play", "ground_ball"), loc(1, 3, 5)), 4),
    (IF, "Force at home, bases loaded", both(bases("123"), has("force_play", "out_at_plate")), 3),
    (IF, "Runner on third, infield ground ball, play at home", both(has("ground_ball_infield", "out_at_plate"), no("force_play")), 4),
    (IF, "Infield throwing error", both(has("error", "ground_ball_infield"), credit("f_throwing_error")), 3),
    (IF, "Infield fielding error", both(has("error", "ground_ball_infield"), credit("f_fielding_error")), 3),
    (IF, "Bunt defense: out at second or third", both(has("bunt"), lambda r: any(x["out"] and not x["isBatter"] for x in r["runners"])), 3),
    (IF, "Ground ball into a non-standard infield alignment", both(has("ground_ball_infield", "shift_alignment"), has("risp")), 3),
    (IF, "Tag play on a runner at third", both(has("tag_play", "ground_ball_infield"), lambda r: any(x["out"] and x["outBase"] == "3B" for x in r["runners"])), 3),
    (IF, "Fielder's choice: getting the lead runner", both(etype("fielders_choice_out", "force_out"), has("ground_ball_infield"), lambda r: any(x["out"] and x["outBase"] in ("2B", "3B") for x in r["runners"]), no("double_play")), 4),
    (IF, "Infield single", both(has("single", "ground_ball"), loc(1, 3, 4, 5, 6)), 3),
    (OF, "Runner on second, one out, single — throw home, out at the plate", both(bases("_2_"), outs(1), has("single", "out_at_plate")), 2),
    (OF, "Single to right, runner from second thrown out at home", both(has("single", "out_at_plate"), loc(9), runner_from("2B", out=True)), 2),
    (OF, "Outfield assist at the plate", both(has("outfield_assist", "out_at_plate"), no("double_play")), 4),
    (OF, "Outfield assist at third", both(has("outfield_assist"), lambda r: any(x["out"] and x["outBase"] == "3B" for x in r["runners"])), 4),
    (OF, "Outfield assist at second", both(has("outfield_assist"), lambda r: any(x["out"] and x["outBase"] == "2B" for x in r["runners"])), 4),
    (OF, "Relay throw completes the out", has("relay"), 4),
    (OF, "Sacrifice fly to right or center", both(has("sac_fly"), loc(8, 9)), 3),
    (OF, "Single to left, runner scores from second", both(has("score_from_second_single"), loc(7)), 3),
    (OF, "Extra-base hit down the line: cutoff and relay", both(etype("double", "triple"), has("outfield_play"), lambda r: r["event"]["runs"] >= 1, no("score_from_first_xbh")), 3),
    (OF, "Triple: relay to third", both(etype("triple"), has("outfield_play")), 3),
    (OF, "Runner tags from second to third on a fly", both(has("tag_up"), runner_from("2B", end="3B")), 3),
    (OF, "Single to center with runners on", both(has("single"), loc(8), lambda r: r["before"]["bases"] != "___"), 2),
    (CA, "Catcher throws out a base stealer", both(has("catcher_throw", "caught_stealing"), no("pickoff")), 6),
    (CA, "Catcher pickoff", both(has("catcher_throw", "pickoff")), 2),
    (CA, "Tag play at the plate", both(has("out_at_plate"), no("force_play"), lambda r: any(c["pos"] == "C" and c["credit"] == "f_putout" for x in r["runners"] for c in x["credits"])), 6),
    (CA, "Wild pitch or passed ball, runner advances", lambda r: ("wild_pitch" in r["flags"] or "passed_ball" in r["flags"]) and not r["source"]["terminal"], 5),
    (CA, "Bunt fielded by the pitcher or catcher", has("bunt_defense_pc"), 4),
    (CA, "Dropped third strike", both(has("strikeout"), lambda r: any(x["isBatter"] and not x["out"] for x in r["runners"])), 2),
    (CA, "Run scores on a wild pitch or passed ball", both(lambda r: "wild_pitch" in r["flags"] or "passed_ball" in r["flags"], lambda r: r["event"]["runs"] >= 1), 2),
    (CA, "Catcher's interference", etype("catcher_interf"), 1),
    (SH, "Sacrifice fly to left", both(has("sac_fly"), loc(7)), 4),
    (SH, "Moving the runner over with nobody out", both(has("productive_out"), outs(0), bases("_2_"), has("ground_ball")), 4),
    (SH, "Two-out RBI single", both(has("two_out_rbi", "single")), 4),
    (SH, "Sacrifice bunt", etype("sac_bunt"), 4),
    (SH, "Run scores on a ground-ball out", both(has("runner_scored_on_out", "ground_ball"), no("error", "double_play")), 4),
    (SH, "Squeeze play", both(etype("sac_bunt", "field_out", "fielders_choice", "fielders_choice_out", "single"), has("bunt"), runner_from("3B", end="score")), 2),
    (SH, "Sacrifice fly with the infield playing in?", both(has("sac_fly"), outs(0)), 3),
    (HL, "Go-ahead swing late in a postseason game", both(has("go_ahead_play", "postseason"), lambda r: r["before"]["inning"] >= 7), 4),
    (HL, "Walk-off", has("walkoff"), 5),
    (HL, "Extra innings, runner in scoring position", both(has("extra_innings", "risp"), lambda r: r["event"]["runs"] >= 1 or r["event"]["outs"] >= 1), 4),
    (HL, "Bases loaded, high leverage", both(bases("123"), has("high_leverage")), 4),
    (HL, "Winning run on base in a walk-off situation", both(has("winning_run_on", "high_leverage"), no("walkoff")), 4),
    (HL, "Tying run on base late, high leverage", both(has("tying_run_on"), li(2.5), lambda r: r["before"]["inning"] >= 7), 4),
    (MI, "Overturned or upheld on review", has("challenge"), 4),
    (MI, "Balk", has("balk"), 3),
    (MI, "Doubled off", has("doubled_off"), 3),
    (MI, "Pop-up with runners on", both(has("popup"), lambda r: r["before"]["bases"] != "___", lambda r: r["event"]["outs"] >= 1), 3),
    (MI, "Strikeout with a runner in motion", both(has("strikeout"), lambda r: any(not x["isBatter"] for x in r["runners"])), 3),
    (MI, "Intentional walk to set up a force", etype("intent_walk"), 2),
    (MI, "Obstruction or interference", desc(r"obstruction|interference"), 2),
    (MI, "Triple play", etype("triple_play"), 1),
    (MI, "Line drive with runners on, outfield play", both(has("line_drive", "outfield_play"), lambda r: r["before"]["bases"] != "___"), 2),
]
SLOTS = [(c, t.replace("Sacrifice fly with the infield playing in?", "Sacrifice fly with nobody out"), p, q) for c, t, p, q in SLOTS]
TARGET = {BR: 35, IF: 35, OF: 35, CA: 25, SH: 25, HL: 25, MI: 20}
CAPS = {"home_run": 6, "strikeout": 8}          # keep the library about decisions, not highlights
MAX_PER_GAME, MAX_PER_BATTER = 3, 2


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


CHECKS = os.path.join(WORK, "video-checks.json")
CHECK_TTL_DAYS = 14


def _checks():
    return json.load(open(CHECKS)) if os.path.exists(CHECKS) else {}


def published(app):
    """Plays already in the app: kept as they are, counted toward their slot and category."""
    idx = os.path.join(app, "data", "index.json")
    if not os.path.exists(idx):
        return []
    out = []
    for p in json.load(open(idx))["plays"]:
        d = json.load(open(os.path.join(app, "data", "plays", p["id"] + ".json")))
        out.append({"id": p["id"], "category": p["category"], "slot": p["slot"], "gamePk": p["gamePk"], "batter": p["batter"]["id"],
                    "event": p["event"], "bases": p["bases"], "teams": (p["away"], p["home"]), "slugs": [c["slug"] for c in d["clips"]]})
    return out


def main(argv):
    import time
    app = os.path.abspath(argv[argv.index("--app") + 1]) if "--app" in argv else os.path.abspath(os.path.join(mlb.HERE, "../../apps/play-repository"))
    scale = 1.0
    if "--total" in argv:
        scale = int(argv[argv.index("--total") + 1]) / sum(TARGET.values())
    target = {c: max(1, round(t * scale)) for c, t in TARGET.items()}
    recs = load()
    clips = json.load(open(os.path.join(WORK, "clips.json")))
    by_play, angled = clips["byPlay"], clips["angled"]
    sitemap = json.load(open(os.path.join(WORK, "angle-clips.json"))) if os.path.exists(os.path.join(WORK, "angle-clips.json")) else []
    by_game = collections.defaultdict(list)
    for r in recs:
        by_game[r["game"]["gamePk"]].append(r)
    hh_items = [a for a in sitemap if a["angle"] == "high-home"]
    hh_content = {pk: [a for a in lst if a.get("angle") == "high-home"] for pk, lst in angled.items()}
    hh_dates = {a["date"] for a in hh_items}
    hh_ids = {r["id"] for r in recs if (r["game"]["date"] in hh_dates or hh_content.get(str(r["game"]["gamePk"])))
              and any(videos._angle_matches(a, r, by_game[r["game"]["gamePk"]]) for a in videos.angle_candidates(r, hh_content, hh_items))}
    print("plays with an MLB High Home clip:", sorted(hh_ids), flush=True)

    keep = published(app)
    used = {k["id"] for k in keep}
    used_slugs = {s for k in keep for s in k["slugs"]}
    games = collections.Counter(k["gamePk"] for k in keep)
    people = collections.Counter(k["batter"] for k in keep)
    teams = collections.Counter(t for k in keep for t in k["teams"])
    events = collections.Counter(k["event"] for k in keep)
    states = collections.Counter(k["bases"] for k in keep)
    per_cat = collections.Counter(k["category"] for k in keep)
    per_slot = collections.Counter(k["slot"] for k in keep)
    seasons = collections.Counter()
    print(f"keeping {len(keep)} published plays; targets {target}", flush=True)
    checks = _checks()
    picked, log = [], []

    def score(r):
        s = 0.0
        if r["source"]["playId"] in by_play: s += 3                     # MLB.com edited highlight for this exact play
        if r["id"] in hh_ids: s += 8
        s -= 2.5 * games[r["game"]["gamePk"]]
        s -= 0.6 * (teams[r["game"]["away"]["abbr"]] + teams[r["game"]["home"]["abbr"]])
        s -= 1.5 * people[r["batter"]["id"]]
        s -= 0.15 * states[r["before"]["bases"]]                       # spread base-out states
        s -= 0.25 * events[r["event"]["type"]]                         # and outcomes
        s += 0.5 * min(3, len(r["flags"]) / 6)
        s += 0.4 * (r["game"]["season"] == 2024) - 0.02 * seasons[r["game"]["season"]]
        if ((r.get("winprob") or {}).get("li") or 0) >= 1.5: s += 0.5
        return s

    def eligible(r):
        return (r["id"] not in used and r["source"]["playId"] and games[r["game"]["gamePk"]] < MAX_PER_GAME
                and people[r["batter"]["id"]] < MAX_PER_BATTER and events[r["event"]["type"]] < CAPS.get(r["event"]["type"], 10 ** 6))

    def verify(r):
        c = checks.get(r["id"])
        if c and time.time() - c["at"] < CHECK_TTL_DAYS * 86400:
            return c["clips"], c["report"], c["savant"]
        report = []
        try:
            cl = videos.clips_for(r, by_play, angled, report, sitemap, by_game[r["game"]["gamePk"]])
            sav = videos.savant_check(r) if cl else None
        except mlb.SourceError as e:
            # MLB.com is throttling (509/503): stop rather than burn through candidates. Every check already made is
            # cached in work/video-checks.json, so the next run resumes where this one stopped.
            print("    source unavailable — stopping; re-run curate.py later to resume:", e, flush=True)
            raise SystemExit(3)
        checks[r["id"]] = {"at": time.time(), "clips": cl, "report": report, "savant": sav}
        json.dump(checks, open(CHECKS, "w"))
        return cl, report, sav

    # round-robin over each category's slots: one play per slot per pass, until the category reaches its target
    for cat in target:
        slots = [s for s in SLOTS if s[0] == cat]
        stalled = set()
        while per_cat[cat] < target[cat] and len(stalled) < len(slots):
            progress = False
            for _, slot, pred, quota in slots:
                if per_cat[cat] >= target[cat]:
                    break
                if slot in stalled or per_slot[slot] >= max(1, round(quota * scale * (200 / sum(TARGET.values())))):
                    stalled.add(slot); continue
                cands = sorted((r for r in recs if eligible(r) and pred(r)), key=score, reverse=True)
                ok = False
                for tried, r in enumerate(cands[:15]):
                    cl, report, sav = verify(r)
                    cl = [c for c in cl if c["slug"] not in used_slugs]          # one clip, one play
                    if not cl:
                        log.append({"slot": slot, "id": r["id"], "result": "rejected — no unused verified playable clip", "details": report[:3]})
                        used.add(r["id"])
                        continue
                    r = dict(r)
                    r["curation"] = {"category": cat, "slot": slot}
                    r["video"] = {"clips": cl, "savant": sav}
                    r["verification"] = {"report": report, "replacedBefore": tried}
                    picked.append(r)
                    used.add(r["id"]); used_slugs.update(c["slug"] for c in cl)
                    games[r["game"]["gamePk"]] += 1; people[r["batter"]["id"]] += 1; events[r["event"]["type"]] += 1
                    states[r["before"]["bases"]] += 1; seasons[r["game"]["season"]] += 1
                    teams[r["game"]["away"]["abbr"]] += 1; teams[r["game"]["home"]["abbr"]] += 1
                    per_cat[cat] += 1; per_slot[slot] += 1
                    log.append({"slot": slot, "id": r["id"], "result": "imported" + (f" (after {tried} rejected)" if tried else ""),
                                "clips": [c["kind"] + ":" + c["angle"]["category"] for c in cl]})
                    print(f"OK  {cat[:22]:22} | {slot[:46]:46} | {r['id']:20} | {[c['kind'] for c in cl]}", flush=True)
                    ok = progress = True
                    break
                if not ok:
                    stalled.add(slot)
                    if not cands:
                        log.append({"slot": slot, "id": None, "result": "slot exhausted — no further eligible candidate in the scanned games"})
            if not progress:
                break
        if per_cat[cat] < target[cat]:
            print(f"--  {cat}: {per_cat[cat]} of {target[cat]} — scan more games (discover.py) to fill it", flush=True)
    json.dump(picked, open(os.path.join(WORK, "curated.json"), "w"), indent=1, ensure_ascii=False)
    json.dump({"log": log, "perCategory": per_cat, "target": target, "kept": len(keep)}, open(os.path.join(WORK, "validation.json"), "w"), indent=1)
    print("DONE new", len(picked), "total", len(keep) + len(picked), dict(per_cat))


if __name__ == "__main__":
    main(sys.argv[1:])
