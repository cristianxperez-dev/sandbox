"""Normalized play records from MLB's official play-by-play (+ Savant Statcast + MLB win probability).

One record per *play*: the event that ends a plate appearance, and each baserunning action inside it
(stolen base, caught stealing, pickoff, wild pitch, passed ball, balk …). Every game-state field is the state
immediately BEFORE that play — rebuilt by replaying the runner movements that happened earlier in the same
plate appearance — and the state after it is recorded separately.

Flags are objective and rule-defined (FLAGS below: id → label, group, rule). Nothing subjective is derived
here: coaching judgements ("poor secondary lead", "late cutoff") are manual tags in the app, never data.
"""
from __future__ import annotations

import math

BASES = ("1B", "2B", "3B")
POS_NUM = {"P": 1, "C": 2, "1B": 3, "2B": 4, "3B": 5, "SS": 6, "LF": 7, "CF": 8, "RF": 9}
ACTION_TYPES = {
    "stolen_base_2b", "stolen_base_3b", "stolen_base_home", "caught_stealing_2b", "caught_stealing_3b", "caught_stealing_home",
    "pickoff_1b", "pickoff_2b", "pickoff_3b", "pickoff_caught_stealing_2b", "pickoff_caught_stealing_3b", "pickoff_caught_stealing_home",
    "wild_pitch", "passed_ball", "balk", "other_advance", "error", "pickoff_error_1b", "pickoff_error_2b", "pickoff_error_3b",
    "other_out", "runner_double_play", "defensive_indiff", "stolen_base", "caught_stealing",
}
ERR_CREDITS = {"f_fielding_error", "f_throwing_error", "f_error_dropped_ball", "f_catcher_interf"}


def _name(x):
    return (x or {}).get("fullName") or (x or {}).get("name")


def _pos(c):
    return ((c.get("position") or {}).get("abbreviation")) or ""


def bases_code(b):
    return "".join(("1" if b["1B"] else "_", "2" if b["2B"] else "_", "3" if b["3B"] else "_"))


def spray_angle(coords):
    """Degrees from the line through second base; negative = toward left field (Gameday coordinates)."""
    if not coords or coords.get("coordX") is None or coords.get("coordY") is None:
        return None
    x, y = coords["coordX"] - 125.42, 198.27 - coords["coordY"]
    if y <= 0:
        return None
    return round(math.degrees(math.atan2(x, y)), 1)


def spray_dir(angle, side):
    if angle is None or side not in ("L", "R"):
        return None
    a = angle if side == "R" else -angle          # negative = pull side for both
    return "pull" if a < -15 else "opposite" if a > 15 else "center"


def _float(v):
    try:
        return float(v) if v not in (None, "", "null") else None
    except ValueError:
        return None


def game_plays(f, wp=None, statcast=None):
    """All normalized records for one game feed. wp = MLB winProbability list, statcast = mlb.statcast_game()."""
    gd, ld = f["gameData"], f["liveData"]
    plays = ld["plays"]["allPlays"]
    players = {int(k[2:]): v for k, v in gd["players"].items()}
    wp_by = {w["atBatIndex"]: w for w in (wp or []) if "atBatIndex" in w}
    away, home = gd["teams"]["away"], gd["teams"]["home"]
    game = {
        "gamePk": gd["game"]["pk"], "date": gd["datetime"]["officialDate"], "season": int(gd["game"]["season"]),
        "gameType": gd["game"]["type"], "level": "MLB", "venue": gd["venue"]["name"],
        "away": {"id": away["id"], "name": away["name"], "abbr": away.get("abbreviation"), "club": away.get("clubName") or away.get("teamName")},
        "home": {"id": home["id"], "name": home["name"], "abbr": home.get("abbreviation"), "club": home.get("clubName") or home.get("teamName")},
        "series": gd["game"].get("seriesDescription") or "",
    }
    final_inning = plays[-1]["about"]["inning"] if plays else 9
    out = []
    prev = None
    for p in plays:
        ab = p["about"]
        same_half = prev is not None and prev["about"]["inning"] == ab["inning"] and prev["about"]["halfInning"] == ab["halfInning"]
        if same_half:
            m = prev["matchup"]
            start = {b: (lambda r: {"id": r["id"], "name": r["fullName"]} if r else None)(m.get("postOn" + k))
                     for b, k in (("1B", "First"), ("2B", "Second"), ("3B", "Third"))}
            outs0 = prev["count"]["outs"]
        else:
            start = {b: None for b in BASES}
            outs0 = 0
        score0 = {"away": prev["result"].get("awayScore", 0) if prev else 0, "home": prev["result"].get("homeScore", 0) if prev else 0}
        if prev and prev["about"]["inning"] != ab["inning"] and prev["about"]["halfInning"] == "bottom" and False:
            pass
        # runners who start this PA on a base but are missing from postOn (pinch runners etc.)
        for r in p["runners"]:
            ob = r["movement"].get("originBase")
            if ob in start and not start[ob] and (r["details"].get("playIndex") or 0) >= 0:
                start[ob] = {"id": r["details"]["runner"]["id"], "name": r["details"]["runner"]["fullName"]}
        bat_side = "away" if ab["halfInning"] == "top" else "home"
        evs = p["playEvents"]
        pitch_idx = [e["index"] for e in evs if e.get("isPitch")]
        term_type = p["result"].get("eventType")
        term_idx = max([r["details"].get("playIndex", -1) for r in p["runners"] if r["details"].get("eventType") == term_type] or [-1])
        if term_idx < 0:
            term_idx = pitch_idx[-1] if pitch_idx else (evs[-1]["index"] if evs else 0)
        action_idx = sorted({e["index"] for e in evs if e.get("type") == "action" and (e.get("details") or {}).get("eventType") in ACTION_TYPES and e["index"] != term_idx})
        # actions that are recorded on a pitch (e.g. wild pitch) carry runner movements on that pitch's index
        for r in p["runners"]:
            et = r["details"].get("eventType")
            i = r["details"].get("playIndex")
            if et in ACTION_TYPES and i is not None and i != term_idx and et != term_type:
                action_idx.append(i)
        for k in sorted(set(action_idx)) + [term_idx]:
            rec = _record(p, k, k == term_idx, start, outs0, score0, bat_side, game, players, wp_by, statcast, final_inning, plays)
            if rec:
                out.append(rec)
        prev = p
    return out


def _state_at(p, k, start, outs0, score0, bat_side):
    """Bases/outs/score immediately before playEvent index k of plate appearance p."""
    bases = {b: (dict(v) if v else None) for b, v in start.items()}
    outs, score = outs0, dict(score0)
    for r in sorted(p["runners"], key=lambda r: r["details"].get("playIndex", 0)):
        if r["details"].get("playIndex", 0) >= k:
            continue
        mv = r["movement"]
        s, e = mv.get("start"), mv.get("end")
        who = {"id": r["details"]["runner"]["id"], "name": r["details"]["runner"]["fullName"]}
        if s in bases and bases[s] and bases[s]["id"] == who["id"]:
            bases[s] = None
        if mv.get("isOut"):
            outs += 1
        elif e in bases:
            bases[e] = who
        elif e == "score":
            score[bat_side] += 1
    return bases, outs, score


def _record(p, k, terminal, start, outs0, score0, bat_side, game, players, wp_by, statcast, final_inning, all_plays):
    ab, res = p["about"], p["result"]
    evs = {e["index"]: e for e in p["playEvents"]}
    ev = evs.get(k) or {}
    movers = [r for r in p["runners"] if r["details"].get("playIndex") == k]
    if terminal:
        etype, elabel, desc = res.get("eventType"), res.get("event"), res.get("description")
    else:
        d = ev.get("details") or {}
        etype = d.get("eventType") or (movers[0]["details"].get("eventType") if movers else None)
        elabel = d.get("event") or (movers[0]["details"].get("event") if movers else None)
        desc = d.get("description") or ""
        if etype not in ACTION_TYPES or not movers:
            return None
    bases, outs, score = _state_at(p, k, start, outs0, score0, bat_side)
    after_b, after_o, after_s = _state_at(p, k + 1, start, outs0, score0, bat_side)
    if terminal:      # trust MLB's own end-of-play totals
        after_s = {"away": res.get("awayScore", after_s["away"]), "home": res.get("homeScore", after_s["home"])}
        after_o = p["count"]["outs"]
    fld_side = "home" if bat_side == "away" else "away"
    # pitch thrown at (or just before) this play
    pitches = [e for e in p["playEvents"] if e.get("isPitch") and e["index"] <= k]
    pitch = pitches[-1] if pitches else None
    if not terminal and pitch and pitch["index"] != k:
        # an action between pitches: no pitch belongs to it; the count is the one after the last pitch
        count = {"balls": pitch["count"]["balls"], "strikes": pitch["count"]["strikes"]}
        pitch_for_play = None
    else:
        before = [e for e in p["playEvents"] if e.get("isPitch") and e["index"] < (pitch["index"] if pitch else k)]
        count = {"balls": before[-1]["count"]["balls"], "strikes": before[-1]["count"]["strikes"]} if before else {"balls": 0, "strikes": 0}
        pitch_for_play = pitch
    pd = (pitch_for_play or {}).get("pitchData") or {}
    det = (pitch_for_play or {}).get("details") or {}
    hit = (pitch_for_play or {}).get("hitData") or {} if terminal else {}
    play_id = (pitch_for_play or {}).get("playId") or ev.get("playId") or (pitch or {}).get("playId")
    sc = (statcast or {}).get((ab["atBatIndex"] + 1, (pitch_for_play or {}).get("pitchNumber"))) if pitch_for_play else None
    m = p["matchup"]
    runners = []
    for r in movers:
        mv, rd = r["movement"], r["details"]
        runners.append({
            "id": rd["runner"]["id"], "name": rd["runner"]["fullName"], "start": mv.get("start"), "end": mv.get("end"),
            "out": bool(mv.get("isOut")), "outBase": mv.get("outBase"), "reason": rd.get("movementReason"), "event": rd.get("eventType"),
            "isBatter": rd["runner"]["id"] == m["batter"]["id"] and mv.get("start") is None,
            "credits": [{"id": c["player"]["id"], "name": _name(players.get(c["player"]["id"])), "pos": _pos(c), "credit": c["credit"]} for c in r.get("credits", [])],
        })
    runners = merge_runners(runners)
    w = wp_by.get(ab["atBatIndex"]) if terminal else None
    home_after = w.get("homeTeamWinProbability") if w else None
    added = w.get("homeTeamWinProbabilityAdded") if w else None
    li = (wp_by.get(ab["atBatIndex"]) or {}).get("leverageIndex")
    walkoff = terminal and ab["halfInning"] == "bottom" and ab["inning"] >= 9 and after_s["home"] > after_s["away"] and score["home"] <= score["away"] \
        and p is all_plays[-1]
    rec = {
        "id": f"mlb-{game['gamePk']}-{ab['atBatIndex']}" + ("" if terminal else f"-e{k}"),
        "source": {"gamePk": game["gamePk"], "atBatIndex": ab["atBatIndex"], "eventIndex": k, "playId": play_id, "terminal": terminal,
                   "feed": f"https://statsapi.mlb.com/api/v1.1/game/{game['gamePk']}/feed/live"},
        "game": game,
        "before": {"inning": ab["inning"], "half": ab["halfInning"], "outs": outs, "bases": bases_code({b: bool(bases[b]) for b in BASES}),
                   "runners": {b: bases[b] for b in BASES}, "score": score, "batting": bat_side, "count": count},
        "after": {"outs": after_o, "bases": bases_code({b: bool(after_b[b]) for b in BASES}), "score": after_s},
        "batter": {"id": m["batter"]["id"], "name": m["batter"]["fullName"], "side": (m.get("batSide") or {}).get("code")},
        "pitcher": {"id": m["pitcher"]["id"], "name": m["pitcher"]["fullName"], "hand": (m.get("pitchHand") or {}).get("code")},
        "event": {"type": etype, "label": elabel, "description": desc, "rbi": res.get("rbi") if terminal else None,
                  "runs": sum(1 for r in runners if r["end"] == "score" and not r["out"]),
                  "outs": sum(1 for r in runners if r["out"]), "isReview": bool(ab.get("hasReview")), "walkoff": bool(walkoff)},
        "runners": runners,
        "pitch": {"type": (det.get("type") or {}).get("description"), "code": (det.get("type") or {}).get("code"), "speed": pd.get("startSpeed"),
                  "zone": pd.get("zone"), "px": (pd.get("coordinates") or {}).get("pX"), "pz": (pd.get("coordinates") or {}).get("pZ"),
                  "spin": (pd.get("breaks") or {}).get("spinRate"), "call": (det.get("call") or {}).get("code")} if pitch_for_play else None,
        "batted": None,
        "winprob": {"homeAfter": home_after, "homeBefore": (round(home_after - added, 1) if home_after is not None and added is not None else None),
                    "homeAdded": added, "li": li} if (w or li is not None) else None,
        "statcast": None,
    }
    if hit:
        ang = spray_angle(hit.get("coordinates"))
        rec["batted"] = {"trajectory": hit.get("trajectory"), "hardness": hit.get("hardness"), "location": int(hit["location"]) if str(hit.get("location") or "").isdigit() else None,
                         "ev": hit.get("launchSpeed"), "la": hit.get("launchAngle"), "distance": hit.get("totalDistance"),
                         "sprayAngle": ang, "spray": spray_dir(ang, rec["batter"]["side"])}
    if sc:
        rec["statcast"] = {"ifAlignment": sc.get("if_fielding_alignment") or None, "ofAlignment": sc.get("of_fielding_alignment") or None,
                           "deltaRunExp": _float(sc.get("delta_run_exp")), "deltaHomeWinExp": _float(sc.get("delta_home_win_exp")),
                           "batWinExpBefore": _float(sc.get("bat_win_exp")), "bbType": sc.get("bb_type") or None, "pitchName": sc.get("pitch_name") or None,
                           "fielders": {str(n): int(sc[f"fielder_{n}"]) for n in range(2, 10) if (sc.get(f"fielder_{n}") or "").isdigit()}}
    rec["flags"] = derive(rec)
    rec["chains"] = [_chain(r) for r in runners if r["credits"]]
    return rec


def touches(credits):
    """Fielder touches in order. MLB adds an extra `f_assist_of` marker to an outfielder's assist — not a second touch."""
    out = []
    for c in credits:
        if c["credit"] == "f_assist_of":
            continue
        if c["credit"] in ("f_assist", "f_putout", "f_fielded_ball", "f_deflection"):
            out.append(c)
    return out


BASE_ORDER = {None: 0, "1B": 1, "2B": 2, "3B": 3, "score": 4}


def merge_runners(runners):
    """MLB records one runner's advance as per-base segments (1B→2B, 2B→3B). Merge them into one movement per
    runner for the play: first start, last end, out if any segment is an out, credits in order."""
    by, order = {}, []
    for x in runners:
        k = x["id"]
        if k not in by:
            by[k] = []; order.append(k)
        by[k].append(x)
    out = []
    for k in order:
        segs = sorted(by[k], key=lambda s: BASE_ORDER.get(s["start"], 0))
        if len(segs) == 1:
            out.append(segs[0]); continue
        last = segs[-1]
        o = next((s for s in segs if s["out"]), None)
        out.append({**segs[0], "end": (o or last)["end"], "out": bool(o), "outBase": (o or {}).get("outBase"),
                    "reason": (o or last)["reason"], "credits": [c for s in segs for c in s["credits"]],
                    "isBatter": segs[0]["isBatter"]})
    return out


def _chain(r):
    seq = [str(POS_NUM.get(c["pos"], "?")) for c in touches(r["credits"])]
    seq = [x for i, x in enumerate(seq) if i == 0 or x != seq[i - 1]]
    return {"runner": r["name"], "start": r["start"], "out": r["out"], "outBase": r["outBase"], "chain": "-".join(seq)}


# ---------------------------------------------------------------- flags
FLAGS = {
    # situation before the play
    "bases_empty":    ("Bases empty", "situation", "No runner on base before the play"),
    "risp":           ("Runner in scoring position", "situation", "Runner on second or third before the play"),
    "force_available":("Force play available", "situation", "Runner on first (every runner behind an open base is forced on a ground ball)"),
    "dp_situation":   ("Double-play situation", "situation", "Runner on first and fewer than two outs"),
    "two_outs":       ("Two outs", "situation", "Two outs before the play"),
    # game context (batting team's point of view, before the play)
    "tied":           ("Tied game", "context", "Score tied before the play"),
    "leading":        ("Batting team leading", "context", "Batting team ahead before the play"),
    "trailing":       ("Batting team trailing", "context", "Batting team behind before the play"),
    "one_run":        ("One-run game", "context", "Score separated by exactly one run"),
    "close":          ("Close game (0–2 runs)", "context", "Score within two runs"),
    "blowout":        ("Blowout (5+ runs)", "context", "Score separated by five or more runs"),
    "tying_run_on":   ("Tying run on base", "context", "Batting team trails and the tying run is on base"),
    "go_ahead_on":    ("Go-ahead run on base", "context", "The run that would put the batting team ahead is on base"),
    "walkoff_situation": ("Walk-off situation", "context", "Bottom of the 9th or later, home team not ahead"),
    "winning_run_on": ("Potential winning run on base", "context", "Walk-off situation with the winning run on base"),
    "extra_innings":  ("Extra innings", "context", "10th inning or later"),
    "high_leverage":  ("High leverage (LI ≥ 2)", "context", "MLB leverage index of the plate appearance ≥ 2.0"),
    "low_leverage":   ("Low leverage (LI < 0.85)", "context", "MLB leverage index of the plate appearance < 0.85"),
    "postseason":     ("Postseason", "context", "Postseason game"),
    # offense
    "single":         ("Single", "offense", "Official event: single"),
    "double":         ("Double", "offense", "Official event: double"),
    "triple":         ("Triple", "offense", "Official event: triple"),
    "home_run":       ("Home run", "offense", "Official event: home run"),
    "ground_ball":    ("Ground ball", "offense", "Batted-ball trajectory: ground ball"),
    "line_drive":     ("Line drive", "offense", "Batted-ball trajectory: line drive"),
    "fly_ball":       ("Fly ball", "offense", "Batted-ball trajectory: fly ball"),
    "popup":          ("Pop-up", "offense", "Batted-ball trajectory: pop-up"),
    "bunt":           ("Bunt / sacrifice bunt", "offense", "Bunt trajectory or sacrifice bunt"),
    "sac_fly":        ("Sacrifice fly", "offense", "Official event: sacrifice fly"),
    "strikeout":      ("Strikeout", "pitching", "Official event: strikeout"),
    "walk":           ("Walk", "pitching", "Official event: walk or intentional walk"),
    "two_out_rbi":    ("Two-out RBI", "offense", "Run(s) batted in with two outs"),
    "productive_out": ("Productive out", "offense", "An out on which a runner advanced or scored (not a double play)"),
    "runner_scored_on_out": ("Run scored on an out", "offense", "A run scored on a play that recorded an out"),
    "go_ahead_play":  ("Go-ahead play", "offense", "Batting team went from tied or behind to ahead on the play"),
    "walkoff":        ("Walk-off", "offense", "The play ended the game with the home team winning"),
    # baserunning
    "stolen_base":    ("Stolen base", "baserunning", "Official stolen base"),
    "caught_stealing":("Caught stealing", "baserunning", "Official caught stealing (incl. pickoff caught stealing)"),
    "pickoff":        ("Pickoff", "baserunning", "Pickoff or pickoff attempt recorded as an out"),
    "first_to_third": ("First to third on a single", "baserunning", "Runner went from first to third on a single"),
    "score_from_second_single": ("Scored from second on a single", "baserunning", "Runner scored from second on a single"),
    "score_from_first_xbh": ("Scored from first on extra-base hit", "baserunning", "Runner scored from first on a double or triple"),
    "tag_up":         ("Tag-up advance", "baserunning", "Runner advanced on a caught fly or line drive"),
    "rundown":        ("Rundown", "baserunning", "Runner put out after four or more fielder touches, or one fielder touching the ball twice (official credits)"),
    "runner_out_on_bases": ("Runner out on the bases", "baserunning", "A runner (not the batter) put out while advancing or returning — not a force, steal or pickoff (objective proxy for baserunning mistakes)"),
    "doubled_off":    ("Doubled off", "baserunning", "Runner doubled off on a caught ball"),
    "wild_pitch":     ("Wild pitch", "pitching", "Runner(s) advanced on a wild pitch"),
    "passed_ball":    ("Passed ball", "pitching", "Runner(s) advanced on a passed ball"),
    "balk":           ("Balk", "pitching", "Official balk"),
    # defense
    "double_play":    ("Double play", "defense", "Two outs recorded on the play"),
    "force_play":     ("Force play", "defense", "A runner put out on a force"),
    "tag_play":       ("Tag play on a runner", "defense", "A runner (not the batter) tagged or thrown out at a base, not a force"),
    "outfield_assist":("Outfield assist", "defense", "An outfielder credited with an assist on an out"),
    "relay":          ("Relay / cutoff throw", "defense", "Out completed through an outfielder and a relay infielder (credits OF → IF → putout)"),
    "out_at_plate":   ("Out at the plate", "defense", "A runner put out at home plate"),
    "play_at_plate":  ("Play at the plate", "defense", "Runner put out at home, or the catcher credited on a scoring play"),
    "error":          ("Defensive error", "defense", "An error credited on the play"),
    "ground_ball_infield": ("Ground ball to the infield", "defense", "Ground ball fielded by an infielder"),
    "middle_infield": ("Ball to the middle infield", "defense", "Ball fielded first by the second baseman or shortstop"),
    "outfield_play":  ("Ball to the outfield", "defense", "Ball fielded first by an outfielder"),
    "catcher_throw":  ("Catcher throw-out", "catcher", "Caught stealing or pickoff with the catcher credited"),
    "catcher_play":   ("Catcher involved", "catcher", "Catcher credited with a putout or assist on a non-strikeout play"),
    "bunt_defense_pc":("Bunt fielded by pitcher or catcher", "catcher", "Bunt first fielded by the pitcher or catcher"),
    "pitchout":       ("Pitchout", "pitching", "Pitch recorded as a pitchout"),
    "shift_alignment":("Non-standard infield alignment", "defense", "Statcast infield alignment other than Standard"),
    "of_alignment_nonstd": ("Non-standard outfield alignment", "defense", "Statcast outfield alignment other than Standard"),
    "challenge":      ("Reviewed / challenged", "context", "The play had a replay review"),
}
ADV = {"1B": 1, "2B": 2, "3B": 3, "score": 4}


def derive(r) -> list[str]:
    b, ev, runners = r["before"], r["event"], r["runners"]
    t = ev["type"] or ""
    f = set()
    on = b["bases"]
    n_on = sum(ch != "_" for ch in on)
    bat, fld = b["score"][b["batting"]], b["score"]["home" if b["batting"] == "away" else "away"]
    diff = bat - fld
    if n_on == 0: f.add("bases_empty")
    if on[1] == "2" or on[2] == "3": f.add("risp")
    if on[0] == "1": f.add("force_available")
    if on[0] == "1" and b["outs"] < 2: f.add("dp_situation")
    if b["outs"] == 2: f.add("two_outs")
    if diff == 0: f.add("tied")
    elif diff > 0: f.add("leading")
    else: f.add("trailing")
    if abs(diff) == 1: f.add("one_run")
    if abs(diff) <= 2: f.add("close")
    if abs(diff) >= 5: f.add("blowout")
    if diff < 0 and n_on >= -diff: f.add("tying_run_on")
    if diff <= 0 and n_on >= 1 - diff: f.add("go_ahead_on")
    if b["half"] == "bottom" and b["inning"] >= 9 and diff <= 0:
        f.add("walkoff_situation")
        if n_on >= 1 - diff: f.add("winning_run_on")
    if b["inning"] >= 10: f.add("extra_innings")
    li = (r.get("winprob") or {}).get("li")
    if li is not None:
        if li >= 2: f.add("high_leverage")
        if li < 0.85: f.add("low_leverage")
    if r["game"]["gameType"] in ("F", "D", "L", "W"): f.add("postseason")
    for k in ("single", "double", "triple", "home_run", "sac_fly"):
        if t == k: f.add(k)
    if t in ("strikeout", "strikeout_double_play", "strikeout_triple_play"): f.add("strikeout")
    if t in ("walk", "intent_walk"): f.add("walk")
    tr = ((r.get("batted") or {}).get("trajectory") or "")
    if tr == "ground_ball": f.add("ground_ball")
    if tr == "line_drive": f.add("line_drive")
    if tr == "fly_ball": f.add("fly_ball")
    if tr == "popup": f.add("popup")
    if tr.startswith("bunt") or t in ("sac_bunt", "sac_bunt_double_play"): f.add("bunt")
    runs, outs = ev["runs"], ev["outs"]
    if b["outs"] == 2 and (ev.get("rbi") or 0) > 0: f.add("two_out_rbi")
    advanced = [x for x in runners if not x["isBatter"] and not x["out"] and x["start"] in ADV and ADV.get(x["end"], 0) > ADV[x["start"]]]
    if outs >= 1 and advanced and outs < 2 and not any(c["credit"] in ERR_CREDITS for x in runners for c in x["credits"]): f.add("productive_out")
    if outs >= 1 and runs >= 1: f.add("runner_scored_on_out")
    if diff <= 0 and (r["after"]["score"][b["batting"]] - r["after"]["score"]["home" if b["batting"] == "away" else "away"]) > 0: f.add("go_ahead_play")
    if ev.get("walkoff"): f.add("walkoff")
    if t.startswith("stolen_base"): f.add("stolen_base")
    if "caught_stealing" in t: f.add("caught_stealing")
    if t.startswith("pickoff") and "error" not in t: f.add("pickoff")
    if t == "wild_pitch" or any(x["event"] == "wild_pitch" for x in runners): f.add("wild_pitch")
    if t == "passed_ball" or any(x["event"] == "passed_ball" for x in runners): f.add("passed_ball")
    if t == "balk": f.add("balk")
    for x in runners:
        if x["isBatter"]:
            continue
        if t == "single" and x["start"] == "1B" and x["end"] == "3B" and not x["out"]: f.add("first_to_third")
        if t == "single" and x["start"] == "2B" and x["end"] == "score" and not x["out"]: f.add("score_from_second_single")
        if t in ("double", "triple") and x["start"] == "1B" and x["end"] == "score" and not x["out"]: f.add("score_from_first_xbh")
        if tr in ("fly_ball", "line_drive", "popup") and t in ("field_out", "sac_fly", "double_play", "sac_fly_double_play") and not x["out"] and ADV.get(x["end"], 0) > ADV.get(x["start"], 0): f.add("tag_up")
        if x["out"]:
            tl = [c for c in touches(x["credits"]) if c["credit"] in ("f_assist", "f_putout")]
            pos = [c["pos"] for c in tl]
            # a rundown: throws back and forth — four or more touches, or a fielder touching the ball twice
            if x["reason"] != "r_force_out" and (len(tl) >= 4 or (len(tl) >= 3 and len(set(pos)) < len(pos))): f.add("rundown")
            if (x["reason"] in (None, "r_runner_out", "r_thrown_out", "r_doubled_off", "r_out_stretching", "r_adv_throw") and not t.startswith(("caught_stealing", "pickoff"))
                    and x["reason"] != "r_force_out"):
                f.add("runner_out_on_bases")
            if x["reason"] == "r_doubled_off" or "doubled off" in (ev["description"] or "").lower(): f.add("doubled_off")
            if x["reason"] == "r_force_out": f.add("force_play")
            elif not t.startswith(("caught_stealing", "pickoff")): f.add("tag_play")
            if x["outBase"] in ("HP", "4B", "score"): f.add("out_at_plate"); f.add("play_at_plate")
    if outs >= 2: f.add("double_play")
    for x in runners:
        cr = x["credits"]
        if any(c["credit"] in ERR_CREDITS for c in cr): f.add("error")
        if x["out"] and any(c["credit"] in ("f_assist", "f_assist_of") and c["pos"] in ("LF", "CF", "RF") for c in cr): f.add("outfield_assist")
        seq = [c for c in touches(cr) if c["credit"] in ("f_assist", "f_putout")]
        if x["out"] and len(seq) >= 3 and seq[0]["pos"] in ("LF", "CF", "RF") and seq[1]["pos"] in ("1B", "2B", "3B", "SS", "P"): f.add("relay")
        if x["end"] == "score" and any(c["pos"] == "C" for c in cr): f.add("play_at_plate")
        if ("caught_stealing" in t or t.startswith("pickoff")) and any(c["pos"] == "C" for c in cr): f.add("catcher_throw")
        if t not in ("strikeout", "strikeout_double_play") and any(c["pos"] == "C" and c["credit"] in ("f_putout", "f_assist") for c in cr) and not x["isBatter"]: f.add("catcher_play")
    loc = (r.get("batted") or {}).get("location")
    first = next((c["pos"] for x in runners for c in x["credits"] if c["credit"] in ("f_fielded_ball", "f_assist", "f_putout", "f_fielding_error", "f_throwing_error")), None)
    if tr == "ground_ball" and (loc in (1, 2, 3, 4, 5, 6) or first in ("1B", "2B", "3B", "SS", "P")): f.add("ground_ball_infield")
    if loc in (4, 6): f.add("middle_infield")
    if loc in (7, 8, 9): f.add("outfield_play")
    if "bunt" in f and (loc in (1, 2) or first in ("P", "C")): f.add("bunt_defense_pc")
    if (r.get("pitch") or {}).get("call") in ("P", "Q", "R"): f.add("pitchout")
    sc = r.get("statcast") or {}
    if sc.get("ifAlignment") and sc["ifAlignment"] != "Standard": f.add("shift_alignment")
    if sc.get("ofAlignment") and sc["ofAlignment"] != "Standard": f.add("of_alignment_nonstd")
    if ev.get("isReview"): f.add("challenge")
    return sorted(f)
