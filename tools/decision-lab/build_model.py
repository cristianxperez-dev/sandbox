"""Decision Lab — build the probability model (apps/decision-lab/data/model.json).

Sources (all regular season):
  * Retrosheet parsed play files 2023–2025 (www.retrosheet.org/downloads/plays/<year>plays.zip): every play's outs,
    runners and score before and after, runs, hit type and location, steals, bunts, and the full event string.
    Notice required by Retrosheet: "The information used here was obtained free of charge from and is copyrighted by
    Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org."
  * Baseball Savant sprint speed and outfield arm strength leaderboards 2023–2025 (league distributions).
  * MLB Stats API season hitting lines 2023–2025 (stolen bases / caught stealing per player), joined to sprint speed
    by MLBAM id — the steal-success-vs-speed fit.

Everything is EMPIRICAL (counted from the data, with sample sizes) unless it is listed under "assumptions", where each
value carries its rationale and a range. Two timing models (sending from second, tagging from third) are fitted to the
Retrosheet rates; they are labelled preliminary because public data has no per-play throw or runner timing.

Usage: python3 build_model.py            (downloads into cache/ if missing; writes the model and a short report)
"""
from __future__ import annotations

import csv
import json
import math
import os
import random
import statistics as st
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "..", "..", "apps", "decision-lab", "data", "model.json")
SEASONS = [2023, 2024, 2025]
UA = {"User-Agent": "cpbaseball-research/1.0 (+https://cpbaseball.com)"}
os.makedirs(CACHE, exist_ok=True)


def fetch(url, name):
    fp = os.path.join(CACHE, name)
    if not os.path.exists(fp):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            open(fp, "wb").write(r.read())
    return fp


def plays(year):
    fp = os.path.join(CACHE, f"{year}plays.csv")
    if not os.path.exists(fp):
        z = fetch(f"https://www.retrosheet.org/downloads/plays/{year}plays.zip", f"{year}plays.zip")
        zipfile.ZipFile(z).extractall(CACHE)
    with open(fp, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            if row["gametype"] == "regular":
                yield row


B = lambda r, s: (1 if r[f"br1_{s}"] else 0) | (2 if r[f"br2_{s}"] else 0) | (4 if r[f"br3_{s}"] else 0)
I = lambda v: int(v) if v not in ("", None) else 0


def depth_of(loc):
    """Retrosheet hit-location depth: S shallow, D / XD deep, otherwise medium."""
    loc = loc or ""
    return "deep" if "D" in loc else "shallow" if "S" in loc else "medium"


def runner_fate(event, base):
    """What happened to the runner who started on `base` ('1','2','3'), from the event string's advance section.
    Returns ('H'|'3'|'2'|'out@H'|'out@3'|'out@2'|'stay'|'?')."""
    adv = event.split(".", 1)[1] if "." in event else ""
    for part in adv.split(";"):
        p = part.strip()
        if not p or p[0] != base:
            continue
        if len(p) >= 3 and p[1] == "X":
            dest = p[2]
            return "?" if "E" in p[3:] else f"out@{dest}"   # XH with an error = safe; counted as unknown
        if len(p) >= 3 and p[1] == "-":
            return p[2]
    return "stay"


def main():
    # ---------------- pass 1: per-batter season profiles (OPS, ground-ball share, strikeout rate) ----------------
    prof = defaultdict(lambda: Counter())
    rows_by_year = {}
    for y in SEASONS:
        rows = list(plays(y)); rows_by_year[y] = rows
        for r in rows:
            if r["pa"] != "1":
                continue
            k = (y, r["batter"]); c = prof[k]
            c["pa"] += 1; c["ab"] += I(r["ab"]); c["h"] += I(r["single"]) + I(r["double"]) + I(r["triple"]) + I(r["hr"])
            c["tb"] += I(r["single"]) + 2 * I(r["double"]) + 3 * I(r["triple"]) + 4 * I(r["hr"])
            c["ob"] += I(r["walk"]) + I(r["hbp"]); c["sf"] += I(r["sf"]); c["k"] += I(r["k"])
            if r["bip"] == "1" and r["bunt"] != "1":
                c["bip"] += 1; c["gb"] += I(r["ground"])
    def ops(c):
        obp = (c["h"] + c["ob"]) / max(1, c["ab"] + c["ob"] + c["sf"]); slg = c["tb"] / max(1, c["ab"]); return obp + slg
    qual = {k: c for k, c in prof.items() if c["pa"] >= 150}
    def cuts(vals, w):
        pairs = sorted(zip(vals, w)); tot = sum(w); acc = 0; q = []
        for target in (0.25, 0.75):
            acc = 0
            for v, ww in pairs:
                acc += ww
                if acc >= target * tot: q.append(v); break
        return q
    ops_cut = cuts([ops(c) for c in qual.values()], [c["pa"] for c in qual.values()])
    gb_cut = cuts([c["gb"] / c["bip"] for c in qual.values()], [c["pa"] for c in qual.values()])
    k_cut = cuts([c["k"] / c["pa"] for c in qual.values()], [c["pa"] for c in qual.values()])
    def tier(y, b):
        c = prof.get((y, b))
        if not c or c["pa"] < 150: return None
        o = ops(c); return "weak" if o < ops_cut[0] else "strong" if o > ops_cut[1] else "avg"

    # ---------------- pass 2: counts ----------------
    re_runs = defaultdict(list)                     # (side, outs, bases) → runs to end of half-inning (innings 1–8)
    trans = defaultdict(Counter)                    # (outs, bases) → Counter((outs_post, bases_post, runs))   all events
    pa_trans = defaultdict(lambda: defaultdict(Counter))   # tier → (outs, bases) → Counter(...)   PA events, no bunts
    bunt = defaultdict(Counter)                     # (outs, bases) → Counter(...)  bunted balls
    steal2 = Counter(); steal2_post = defaultdict(Counter); steal3 = Counter()
    send2 = defaultdict(Counter)                    # (outs<2?, fielder, depth) → fates of runner from 2nd on single
    send1 = defaultdict(Counter)                    # runner from 1st on double
    tag3 = defaultdict(Counter)                     # (outs, fielder, depth) → fates of runner from 3rd on caught fly
    gb_r3 = defaultdict(Counter)                    # outs → GB outcome classes with runner on third only
    r3_types = defaultdict(lambda: defaultdict(Counter))   # outs → type → Counter(post)  (state: runner on third only)
    r3_type_rates = defaultdict(Counter)            # gbTier → type counts (all PA, any state) for the batter mix
    games_runs = []; home_w = 0; games = 0
    gb_ctrl = defaultdict(Counter)
    depth_mix = defaultdict(Counter)
    for y in SEASONS:
        rows = rows_by_year[y]
        # group by game → half-inning, in play order
        by_game = defaultdict(list)
        for r in rows: by_game[r["gid"]].append(r)
        for gid, g in by_game.items():
            g.sort(key=lambda r: int(r["pn"]))
            games += 1
            last = g[-1]; fv = I(last["score_v"]) + (I(last["runs"]) if last["vis_home"] == "0" else 0)
            fh = I(last["score_h"]) + (I(last["runs"]) if last["vis_home"] == "1" else 0)
            games_runs.append(fv + fh); home_w += fh > fv
            halves = defaultdict(list)
            for r in g: halves[(int(r["inning"]), r["top_bot"])].append(r)
            for (inn, tb), hp in halves.items():
                total = sum(I(r["runs"]) for r in hp); before = 0
                for r in hp:
                    ob, bb = I(r["outs_pre"]), B(r, "pre")
                    if inn <= 8:
                        re_runs[("home" if tb == "1" else "away", ob, bb)].append(total - before)
                    before += I(r["runs"])
        for r in rows:
            ob, bb, oa, ba, runs = I(r["outs_pre"]), B(r, "pre"), I(r["outs_post"]), B(r, "post"), I(r["runs"])
            if oa >= 3: ba = 0
            if ob >= 3: continue
            post = (oa, ba, runs)
            ev = r["event"]
            # skip pure no-ops (e.g. defensive substitutions recorded as plays): no outs, runners or runs change and no PA
            if r["pa"] != "1" and post == (ob, bb, 0) and not (I(r["sb2"]) or I(r["sb3"]) or I(r["cs2"]) or I(r["cs3"])):
                continue
            ispa = r["pa"] == "1"
            trans[(ob, bb)][post + (1 if ispa else 0,)] += 1
            t = tier(y, r["batter"])
            if ispa and r["bunt"] != "1":
                # tag the plays that hand the user a third-base decision: an outfield single with a runner on second ('s'),
                # a fly ball caught by an outfielder with a runner on third and fewer than two outs ('f')
                of = r["firstf"] in ("7", "8", "9")
                tag = ("s" if (r["single"] == "1" and (bb & 2) and of) else
                       "d" if (r["double"] == "1" and bb == 1 and of) else
                       "f" if ((bb & 4) and ob < 2 and r["bip"] == "1" and r["hittype"] in ("F", "P") and of and r["single"] == r["double"] == r["triple"] == r["hr"] == "0" and r["roe"] == "0") else "")
                pa_trans["all"][(ob, bb)][post + (tag,)] += 1
                if t: pa_trans[t][(ob, bb)][post + (tag,)] += 1
            if r["bunt"] == "1" and r["bip"] == "1":
                bunt[(ob, bb)][post] += 1
            # steals: second base with only first occupied; third with only second occupied
            if bb == 1 and (I(r["sb2"]) or I(r["cs2"])) and not I(r["pko1"]):
                ok = I(r["sb2"]) > 0; steal2[(ob, ok)] += 1
                if r["pa"] != "1": steal2_post[(ob, ok)][post] += 1     # the runner's own result, not a strikeout on the same pitch
            if bb == 2 and (I(r["sb3"]) or I(r["cs3"])):
                steal3[(ob, I(r["sb3"]) > 0)] += 1
            hit_of = r["firstf"] in ("7", "8", "9")
            if r["single"] == "1" and (bb & 2) and hit_of:
                f = runner_fate(ev, "2"); dep = depth_of(r["loc"])
                send2[(min(ob, 2), r["firstf"], dep)][f] += 1
                depth_mix[("single", r["firstf"])][dep] += 1
            if r["double"] == "1" and (bb & 1) and not (bb & 2) and hit_of:
                send1[(min(ob, 2), r["firstf"], depth_of(r["loc"]))][runner_fate(ev, "1")] += 1
                depth_mix[("double", r["firstf"])][depth_of(r["loc"])] += 1
            if (bb & 4) and ob < 2 and r["bip"] == "1" and r["hittype"] in ("F", "P") and hit_of and r["single"] == r["double"] == r["triple"] == r["hr"] == "0" \
                    and r["roe"] == "0" and (ev.startswith(("7", "8", "9", "F7", "F8", "F9")) or r["sf"] == "1"):
                tag3[(ob, r["firstf"], depth_of(r["loc"]))][runner_fate(ev, "3")] += 1
                depth_mix[("fly", r["firstf"])][depth_of(r["loc"])] += 1
            # runner on third only, fewer than two outs: plate-appearance outcomes by type (the infield decision)
            if r["pa"] == "1" and r["bunt"] != "1" and r["hr"] != "1" and (bb == 0 or bb == 4):
                grp = "empty" if bb == 0 else "r3_2out" if ob == 2 else "r3_lt2"
                hit = r["single"] == "1" or r["double"] == "1" or r["triple"] == "1"
                for col, typ in (("ground", "GB"), ("line", "LD"), ("fly", "FB")):
                    if r[col] == "1":
                        gb_ctrl[f"{grp}:{typ}"][("hit" if hit else "error" if r["roe"] == "1" else "out")] += 1
            if bb == 4 and ob < 2 and r["pa"] == "1" and r["bunt"] != "1":
                typ = ("K" if r["k"] == "1" else "BB" if (r["walk"] == "1" or r["hbp"] == "1" or r["xi"] == "1") else "HR" if r["hr"] == "1"
                       else "GB" if r["ground"] == "1" else "FB" if r["fly"] == "1" else "LD" if r["line"] == "1" else "OTH")
                r3_types[ob][typ][post] += 1
                if typ == "GB":
                    f3 = runner_fate(ev, "3")
                    hit = r["single"] == "1" or r["double"] == "1" or r["triple"] == "1"
                    cls = ("hit" if hit else "error" if r["roe"] == "1" else "dp" if (oa - ob) >= 2
                           else "out_scored" if f3 == "H" else "out_at_home" if f3 == "out@H" else "out_held")
                    corner = r["firstf"] in ("1", "3", "5")
                    gb_r3[ob][cls] += 1; gb_r3[(ob, "corner" if corner else "middle")][cls] += 1
            # batter mix by ground-ball tier (league: all PA without bunts)
            if r["pa"] == "1" and r["bunt"] != "1":
                c = prof.get((y, r["batter"]))
                if c and c["pa"] >= 150 and c["bip"]:
                    gbr = c["gb"] / c["bip"]; kr = c["k"] / c["pa"]
                    gt = "high" if gbr > gb_cut[1] else "low" if gbr < gb_cut[0] else "mid"
                    kt = "high" if kr > k_cut[1] else "low" if kr < k_cut[0] else "mid"
                    typ = ("K" if r["k"] == "1" else "BB" if (r["walk"] == "1" or r["hbp"] == "1" or r["xi"] == "1") else "HR" if r["hr"] == "1"
                           else "GB" if r["ground"] == "1" else "FB" if r["fly"] == "1" else "LD" if r["line"] == "1" else "OTH")
                    r3_type_rates[f"gb:{gt}"][typ] += 1; r3_type_rates[f"k:{kt}"][typ] += 1; r3_type_rates["all"][typ] += 1

    # ---------------- run expectancy + run distributions ----------------
    MAXR = 10
    re24, rdist, nre = {}, {}, {}
    for side in ("away", "home", "all"):
        for o in range(3):
            for b in range(8):
                xs = re_runs[(side, o, b)] if side != "all" else re_runs[("away", o, b)] + re_runs[("home", o, b)]
                key = f"{side}:{o}:{b}"
                re24[key] = round(sum(xs) / len(xs), 4); nre[key] = len(xs)
                c = Counter(min(x, MAXR) for x in xs)
                rdist[key] = [round(c[k] / len(xs), 6) for k in range(MAXR + 1)]
    pack = lambda c: [list(k) + [n] for k, n in sorted(c.items(), key=lambda x: -x[1])]
    transitions = {f"{o}:{b}": pack(trans[(o, b)]) for o in range(3) for b in range(8)}
    pa_tables = {t: {f"{o}:{b}": pack(pa_trans[t][(o, b)]) for o in range(3) for b in range(8)} for t in ("all", "weak", "avg", "strong")}
    bunt_tables = {f"{o}:{b}": pack(bunt[(o, b)]) for (o, b) in [(0, 1), (0, 3), (0, 2), (1, 1)] if sum(bunt[(o, b)].values())}

    # ---------------- steal vs sprint speed (players' season SB / CS joined to Savant sprint speed by MLBAM id) ----------------
    sp_rows = []
    for y in SEASONS:
        spd = {}
        for row in csv.DictReader(open(fetch(f"https://baseballsavant.mlb.com/leaderboard/sprint_speed?year={y}&position=&team=&min=10&csv=true", f"sprint-{y}.csv"), encoding="utf-8-sig")):
            try: spd[int(row["player_id"])] = float(row["sprint_speed"])
            except (ValueError, KeyError): pass
        js = json.load(open(fetch(f"https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season={y}&sportIds=1&playerPool=ALL&limit=3000", f"stats-{y}.json")))
        for s in js["stats"][0]["splits"]:
            pid = s["player"]["id"]; sb = s["stat"].get("stolenBases", 0); cs = s["stat"].get("caughtStealing", 0)
            if pid in spd and sb + cs > 0: sp_rows.append((spd[pid], sb, cs))
    # weighted logistic regression of success on (speed − 27) by Newton's method
    a, b_ = 1.0, 0.0
    for _ in range(50):
        g0 = g1 = h00 = h01 = h11 = 0.0
        for s, sb, cs in sp_rows:
            x = s - 27.0; p = 1 / (1 + math.exp(-(a + b_ * x))); n = sb + cs
            g0 += sb - n * p; g1 += (sb - n * p) * x
            w = n * p * (1 - p); h00 += w; h01 += w * x; h11 += w * x * x
        det = h00 * h11 - h01 * h01
        a += (h11 * g0 - h01 * g1) / det; b_ += (-h01 * g0 + h00 * g1) / det
    se_b = math.sqrt(h00 / det)
    att = sum(n for _, sb, cs in sp_rows for n in [sb + cs]); att_w_speed = sum(s * (sb + cs) for s, sb, cs in sp_rows) / att
    speeds_all = []
    for y in SEASONS:
        for row in csv.DictReader(open(os.path.join(CACHE, f"sprint-{y}.csv"), encoding="utf-8-sig")):
            try: speeds_all.append(float(row["sprint_speed"]))
            except ValueError: pass
    arms = defaultdict(list)
    for y in SEASONS:
        for row in csv.DictReader(open(fetch(f"https://baseballsavant.mlb.com/leaderboard/arm-strength?type=player&year={y}&minThrows=50&pos=&team=&csv=true", f"arm-{y}.csv"), encoding="utf-8-sig")):
            for pos, col in (("7", "arm_lf"), ("8", "arm_cf"), ("9", "arm_rf")):
                try:
                    if row[col] and int(row[f"total_throws_{col[-2:]}"]) >= 25: arms[pos].append(float(row[col]))
                except (ValueError, KeyError): pass
    pct = lambda xs, q: sorted(xs)[min(len(xs) - 1, int(q * len(xs)))]
    speed_dist = {"mean": round(st.mean(speeds_all), 2), "sd": round(st.pstdev(speeds_all), 2), "p10": pct(speeds_all, .1), "p50": pct(speeds_all, .5), "p90": pct(speeds_all, .9), "n": len(speeds_all)}
    arm_dist = {pos: {"mean": round(st.mean(v), 1), "sd": round(st.pstdev(v), 1), "p10": pct(v, .1), "p50": pct(v, .5), "p90": pct(v, .9), "n": len(v)} for pos, v in arms.items()}

    # ---------------- assumptions (not observable in public data) ----------------
    A = {
        "infield_in_usage": {"value": 0.55, "range": [0.4, 0.8], "kind": "assumption (bounded by data)",
            "why": "Public data never records a drawn-in infield (Statcast's alignment field has no infield-in category). What it does show: with a runner on third and fewer than two outs, ground balls, line drives and bloop flies fall for hits more often than in the same base state with two outs, when the infield always plays back. The drawn-in effect on each batted-ball type is that observed difference divided by how often infields are actually in — this one assumption. With 55% the defaults also reproduce the one-out ground-ball mix (runner scores on ~40% of outs, thrown out at home on ~19%)."},
        "infield_back_score_on_gb_out": {"value": 0.70, "range": [0.6, 0.8], "kind": "assumption",
            "why": "With the infield back and fewer than two outs, share of ground-ball outs on which the runner from third scores (runner going on contact, play made at first)."},
        "infield_in_score_on_gb_out": {"value": 0.15, "range": [0.08, 0.3], "kind": "assumption",
            "why": "With the infield in, share of ground-ball outs on which the runner from third still scores (slow rollers, balls to the side)."},
        "infield_out_at_home": {"in": 0.30, "back": 0.06, "kind": "assumption",
            "why": "Share of ground-ball outs that become a fielder's choice at home (runner out, batter safe at first): common with the infield in, rare with it back."},
        "bunt_fail": {"value": 0.12, "range": [0.05, 0.2], "kind": "assumption",
            "why": "Retrosheet records bunts put in play; attempts that are fouled off or missed until the batter must swing are invisible in it. This share of bunt attempts is treated as an out without advancing the runner, so the bunt isn't credited with only its successful tries."},
        "throw_miss": {"value": 0.08, "range": [0.04, 0.14], "kind": "assumption",
            "why": "Share of throws home that are off-line, cut off, bobbled or not cleanly applied, so the runner is safe whatever the timing. Keeps the timing model from treating any send as certain."},
        "corners_in_share": {"value": 0.5, "range": [0.3, 0.7], "kind": "assumption",
            "why": "Corners in / middle back applies the drawn-in effect only to balls hit to the corner infielders (and pitcher); the middle infielders play back. Share of the full effect on those balls."},
        "steal_catcher_effect": {"value": 0.04, "range": [0.02, 0.06], "kind": "assumption",
            "why": "Change in steal success for a strong (−) or weak (+) throwing catcher / quick-to-the-plate pitcher combination versus average. The speed effect is fitted; battery effects are not (they need per-attempt pop times)."},
        "charging_time": {"value": 0.25, "range": [0.1, 0.4], "kind": "assumption",
            "why": "Seconds saved by an outfielder charging hard on a single compared with an average approach."},
        "send_timing": {"kind": "assumption", "why": "Geometry of a throw home from the outfield (fielding distance by depth, release and tag time, throw carry); constants below, fitted offset and spread under fits.send2.",
            "fieldDist": {"shallow": 200, "medium": 240, "deep": 280}, "cfExtra": 15, "fieldTime": {"shallow": 2.9, "medium": 3.5, "deep": 4.3},
            "release": 0.9, "tag": 0.2, "carry": 0.85, "runDist2": 180, "lead2": 18, "contactDelay": {"twoOuts": 0.0, "lessThanTwo": 0.45}, "turn": 0.6},
        "send1_timing": {"kind": "assumption", "why": "A runner from first on a double: the ball is played off the wall or in the gap and relayed home (outfielder to cutoff man to catcher). Constants below, fitted offset and spread under fits.send1.",
            "fieldTime": {"shallow": 3.6, "medium": 4.4, "deep": 5.3}, "relayDist": {"shallow": 120, "medium": 150, "deep": 180}, "relayHome": 150, "relayArm": 80,
            "release": 0.8, "relayRelease": 0.6, "tag": 0.2, "carry": 0.85, "runDist1": 270, "lead1": 12, "contactDelay": {"twoOuts": 0.0, "lessThanTwo": 0.45}, "turns": 0.9},
        "tag_timing": {"kind": "assumption", "why": "Catch-and-throw geometry on a fly ball with a runner tagging at third; constants below, fitted offset and spread under fits.tag3.",
            "catchDist": {"shallow": 215, "medium": 265, "deep": 310}, "cfExtra": 15, "release": 0.8, "tag": 0.15, "carry": 0.85, "runDist": 90, "start": 0.25},
    }

    # ---------------- timing models: fit offset μ and spread σ so a rational send policy reproduces Retrosheet ----------------
    def phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
    rng = random.Random(7)
    def margin_send(speed, arm, depth, pos, outs):
        T = A["send_timing"]
        dist = T["fieldDist"][depth] + (T["cfExtra"] if pos == "8" else 0)
        t_throw = T["fieldTime"][depth] + T["release"] + dist / (arm * 1.4667 * T["carry"]) + T["tag"]
        t_run = T["contactDelay"]["twoOuts" if outs == 2 else "lessThanTwo"] + (T["runDist2"] - T["lead2"]) / speed + T["turn"]
        return t_throw - t_run
    def margin_send1(speed, arm, depth, pos, outs):
        T = A["send1_timing"]
        t_throw = T["fieldTime"][depth] + T["release"] + T["relayDist"][depth] / (arm * 1.4667 * T["carry"]) + T["relayRelease"] + T["relayHome"] / (T["relayArm"] * 1.4667 * T["carry"]) + T["tag"]
        t_run = T["contactDelay"]["twoOuts" if outs == 2 else "lessThanTwo"] + (T["runDist1"] - T["lead1"]) / speed + T["turns"]
        return t_throw - t_run
    def margin_tag(speed, arm, depth, pos):
        T = A["tag_timing"]
        dist = T["catchDist"][depth] + (T["cfExtra"] if pos == "8" else 0)
        return T["release"] + dist / (arm * 1.4667 * T["carry"]) + T["tag"] - (T["start"] + T["runDist"] / speed)
    def observed(table, key_outs, held_key="3"):
        sent = scored = out = held = 0
        for (o, pos, dep), c in table.items():
            if o not in key_outs: continue
            scored += c["H"]; out += c["out@H"]; held += c[held_key]
        tot = scored + out + held
        return {"n": tot, "sendRate": (scored + out) / tot, "outRateWhenSent": out / max(1, scored + out)}
    sp_ss = [s for s in speeds_all]
    def sample_pop(kind, key_outs, n=6000):
        mixkey = {"send": "single", "send1": "double", "tag": "fly"}[kind]
        pops = []
        for _ in range(n):
            pos = rng.choice(["7", "8", "9"]); dm = depth_mix[(mixkey, pos)]; tot = sum(dm.values())
            r = rng.random() * tot; dep = "medium"
            for d, c in dm.items():
                r -= c
                if r <= 0: dep = d; break
            sp = rng.choice(sp_ss); arm = rng.choice(arms[pos]); o = rng.choice(key_outs)
            pops.append((margin_send(sp, arm, dep, pos, o) if kind == "send" else margin_send1(sp, arm, dep, pos, o) if kind == "send1" else margin_tag(sp, arm, dep, pos), o))
        return pops
    EM = A["throw_miss"]["value"]
    psafe = lambda m, mu, sg: EM + (1 - EM) * phi((m - mu) / sg)
    def grid_fit(pop, target, breakeven):
        best = None
        for mu in [x / 20 for x in range(-50, 41)]:
            for sg in [x / 20 for x in range(3, 41)]:
                sent = outs = 0
                for m, o in pop:
                    p = psafe(m, mu, sg)
                    if p >= breakeven[o]: sent += 1; outs += 1 - p
                if not sent: continue
                sr, orr = sent / len(pop), outs / sent
                err = (sr - target["sendRate"]) ** 2 + 4 * (orr - target["outRateWhenSent"]) ** 2
                if best is None or err < best[0]: best = (err, mu, sg, sr, orr)
        return best
    def caution(pop, mu, sg, target):
        """the success probability coaches appear to require: the send threshold that reproduces the observed send rate"""
        ps = sorted((psafe(m, mu, sg) for m, o in pop), reverse=True)
        k = max(1, min(len(ps) - 1, int(round(target["sendRate"] * len(ps)))))
        thr = ps[k - 1]; sent = ps[:k]
        return {"impliedThreshold": round(thr, 3), "impliedOutRateWhenSent": round(1 - sum(sent) / len(sent), 3)}
    RE = lambda o, bb: re24[f"all:{o}:{bb}"]
    # break-even success rates from run expectancy (the engine recomputes them with win expectancy per situation)
    be_send = {0: (RE(0, 5) - RE(1, 1)) / (1 + RE(0, 1) - RE(1, 1)), 1: (RE(1, 5) - RE(2, 1)) / (1 + RE(1, 1) - RE(2, 1)), 2: RE(2, 5) / (1 + RE(2, 1))}
    be_tag = {0: (RE(0, 4) - RE(1, 0)) / (1 + RE(1, 0) - RE(1, 0) + RE(1, 0) - RE(1, 0) + 0) if False else (RE(0, 4) - RE(1, 0)) / (1 + RE(0, 0) - RE(1, 0)) if False else None}
    # tag from third: hold = (outs+1, runner on 3rd) after the catch; success = run + (outs+1, empty); failure = (outs+2, empty)
    be_tag = {o: (RE(o + 1, 4) - (RE(o + 2, 0) if o + 2 < 3 else 0)) / (1 + RE(o + 1, 0) - (RE(o + 2, 0) if o + 2 < 3 else 0)) for o in (0, 1)}
    obs_send = {"twoOuts": observed(send2, [2]), "lessThanTwo": observed(send2, [0, 1])}
    obs_tag = {"zeroOuts": observed(tag3, [0], "stay"), "oneOut": observed(tag3, [1], "stay"), "all": observed(tag3, [0, 1], "stay")}
    pop2 = sample_pop("send", [2]); pop01 = sample_pop("send", [0, 1])
    e, mu_s, sg_s, sr, orr = grid_fit(pop2, obs_send["twoOuts"], be_send)
    popT1 = sample_pop("tag", [1]); popT0 = sample_pop("tag", [0])
    eT, mu_t, sg_t, srT, orrT = grid_fit(popT1 + popT0, obs_tag["all"], be_tag)
    best_d = None
    for d10 in range(0, 21):
        A["send_timing"]["contactDelay"]["lessThanTwo"] = d10 / 20
        pop = sample_pop("send", [0, 1])
        sent = outs = 0
        for m, o in pop:
            p = psafe(m, mu_s, sg_s)
            if p >= be_send[o]: sent += 1; outs += 1 - p
        sr01 = sent / len(pop); orr01 = outs / max(1, sent)
        err = (sr01 - obs_send["lessThanTwo"]["sendRate"]) ** 2
        if best_d is None or err < best_d[0]: best_d = (err, d10 / 20, sr01, orr01)
    A["send_timing"]["contactDelay"]["lessThanTwo"] = best_d[1]
    # runner from first on a double: hold = runners on 2nd and 3rd; success = run + batter on 2nd; failure = out + batter on 2nd
    be_send1 = {0: (RE(0, 6) - RE(1, 2)) / (1 + RE(0, 2) - RE(1, 2)), 1: (RE(1, 6) - RE(2, 2)) / (1 + RE(1, 2) - RE(2, 2)), 2: RE(2, 6) / (1 + RE(2, 2))}
    obs_send1 = {"twoOuts": observed(send1, [2]), "lessThanTwo": observed(send1, [0, 1])}
    e1, mu_1, sg_1, sr1, orr1 = grid_fit(sample_pop("send1", [2]), obs_send1["twoOuts"], be_send1)
    best_d1 = None
    for d10 in range(0, 21):
        A["send1_timing"]["contactDelay"]["lessThanTwo"] = d10 / 20
        pop = sample_pop("send1", [0, 1]); sent = outs = 0
        for m, o in pop:
            p = psafe(m, mu_1, sg_1)
            if p >= be_send1[o]: sent += 1; outs += 1 - p
        sr01 = sent / len(pop); orr01 = outs / max(1, sent)
        err = (sr01 - obs_send1["lessThanTwo"]["sendRate"]) ** 2
        if best_d1 is None or err < best_d1[0]: best_d1 = (err, d10 / 20, sr01, orr01)
    A["send1_timing"]["contactDelay"]["lessThanTwo"] = best_d1[1]
    fits = {
        "send2": {"mu": mu_s, "sigma": sg_s, "fittedOn": "two-out singles with a runner on second (coaches near break-even)",
                  "breakeven": {str(k): round(v, 3) for k, v in be_send.items()},
                  "fit": {"sendRate": round(sr, 3), "outRateWhenSent": round(orr, 3)}, "target": obs_send["twoOuts"], "throwMiss": EM,
                  "lessThanTwoOuts": {"observed": obs_send["lessThanTwo"], "fittedReadDelay": best_d[1], "fit": {"sendRate": round(best_d[2], 3), "outRateWhenSent": round(best_d[3], 3)}}},
        "send1": {"mu": mu_1, "sigma": sg_1, "fittedOn": "two-out doubles with a runner on first only (coaches near break-even)", "throwMiss": EM,
                  "breakeven": {str(k): round(v, 3) for k, v in be_send1.items()}, "fit": {"sendRate": round(sr1, 3), "outRateWhenSent": round(orr1, 3)}, "target": obs_send1["twoOuts"],
                  "lessThanTwoOuts": {"observed": obs_send1["lessThanTwo"], "fittedReadDelay": best_d1[1], "fit": {"sendRate": round(best_d1[2], 3), "outRateWhenSent": round(best_d1[3], 3)}}},
        "tag3": {"mu": mu_t, "sigma": sg_t, "fittedOn": "fly balls caught by an outfielder with a runner on third and fewer than two outs",
                 "breakeven": {str(k): round(v, 3) for k, v in be_tag.items()},
                 "fit": {"sendRate": round(srT, 3), "outRateWhenSent": round(orrT, 3)}, "target": obs_tag["all"],
                 "byOuts": {"0": obs_tag["zeroOuts"], "1": obs_tag["oneOut"]}, "throwMiss": EM},
    }

    # ---------------- runner-on-third ground balls (observed; infield usually back) ----------------
    gbt = {}
    for k, c in gb_r3.items():
        n = sum(c.values()); key = str(k) if not isinstance(k, tuple) else f"{k[0]}:{k[1]}"
        gbt[key] = {"n": n, **{cls: round(v / n, 4) for cls, v in c.items()}}
    r3 = {str(o): {typ: pack(c) for typ, c in d.items()} for o, d in r3_types.items()}
    mix = {k: {t: round(v / sum(c.values()), 4) for t, v in c.items()} | {"n": sum(c.values())} for k, c in r3_type_rates.items()}

    def fates(table):
        out = {}
        for (o, pos, dep), c in sorted(table.items()):
            out[f"{o}:{pos}:{dep}"] = {"n": sum(c.values()), **dict(c)}
        return out

    model = {
        "version": "1.0.0", "built": "2026-11-08", "seasons": SEASONS,
        "sources": {
            "retrosheet": "Retrosheet parsed play files, regular season " + ", ".join(map(str, SEASONS)) + ". The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at www.retrosheet.org.",
            "savant": "Baseball Savant sprint speed and outfield arm strength leaderboards (MLB Advanced Media), " + ", ".join(map(str, SEASONS)) + ".",
            "statsapi": "MLB Stats API season stolen-base and caught-stealing totals (MLB Advanced Media), joined to sprint speed by MLBAM id.",
        },
        "league": {"games": games, "runsPerGame": round(sum(games_runs) / games, 3), "homeWinPct": round(home_w / games, 4)},
        "re24": re24, "reN": nre, "runDist": rdist,
        "transitions": transitions, "paTransitions": pa_tables, "bunt": bunt_tables,
        "batterTiers": {"opsCuts": [round(x, 3) for x in ops_cut], "gbCuts": [round(x, 3) for x in gb_cut], "kCuts": [round(x, 3) for x in k_cut], "minPA": 150,
                        "note": "Tiers by the batter's own season in the same data: weak = bottom quarter of OPS (PA-weighted, 150+ PA), strong = top quarter."},
        "typeMix": mix,
        "steal": {
            "second": {f"{o}": {"att": steal2[(o, True)] + steal2[(o, False)], "sb": steal2[(o, True)], "rate": round(steal2[(o, True)] / max(1, steal2[(o, True)] + steal2[(o, False)]), 4)} for o in range(3)},
            "secondPost": {f"{o}:{int(ok)}": pack(steal2_post[(o, ok)]) for o in range(3) for ok in (True, False)},
            "third": {f"{o}": {"att": steal3[(o, True)] + steal3[(o, False)], "sb": steal3[(o, True)]} for o in range(3)},
            "speedFit": {"intercept": round(a, 4), "slope": round(b_, 4), "slopeSE": round(se_b, 4), "center": 27.0, "players": len(sp_rows), "attempts": att,
                         "attemptWeightedSpeed": round(att_w_speed, 2), "form": "logit(success) = intercept + slope × (sprint speed − 27 ft/s)"},
        },
        "send2": {"observed": obs_send, "fates": fates(send2)},
        "send1": {"fates": fates(send1)},
        "tag3": {"observed": obs_tag, "fates": fates(tag3)},
        "gbR3": gbt, "r3Types": r3,
        "bipControl": {k: {"n": sum(c.values()), "hit": round(c["hit"] / sum(c.values()), 4), "error": round(c["error"] / sum(c.values()), 4)} for k, c in gb_ctrl.items()},
        "speed": speed_dist, "arm": arm_dist,
        "depthMix": {f"{k[0]}:{k[1]}": dict(v) for k, v in depth_mix.items()},
        "assumptions": A, "fits": fits,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(model, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB) · games {games} · R/G {model['league']['runsPerGame']} · home win {model['league']['homeWinPct']}")
    print("RE24 0 out empty / 0 out R1 / 1 out R3 / 2 out loaded:", re24["all:0:0"], re24["all:0:1"], re24["all:1:4"], re24["all:2:7"])
    print("steal 2B:", model["steal"]["second"], "speed fit:", model["steal"]["speedFit"])
    print("send from 2nd observed:", obs_send); print("tag from 3rd observed:", obs_tag); print("fits:", fits)
    print("GB with runner on 3rd:", {k: gbt[k] for k in ("0", "1")}, "controls:", model["bipControl"]); print("speed:", speed_dist, "arm:", arm_dist)
    print("tiers:", model["batterTiers"])


if __name__ == "__main__":
    main()
