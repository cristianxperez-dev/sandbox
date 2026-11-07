"""Baseball Feud 2.0 — safe metadata enrichment for the Plays Library seed (apps/baseball-feud-2/library/plays.js).

For every play that carries an MLB gamePk + playId, the official MLB Stats API live feed is read (same parsing as
verify.py) and:
  * FILLED, only where the seed has no value: away / home team names and abbreviations, venue, the official result
    (event + MLB's description), batting / fielding team.
  * CHECKED, never changed: date, inning, outs before the play, runners before the play, score before the play,
    batter, pitcher, batting / fielding team. Any disagreement is printed and written to enrich-report.json for a
    person to resolve — the seed is never overwritten.
Titles, answers, notes, questions and everything else a person wrote are never touched. A play whose playId can't be
found in the feed is left exactly as it is.

Usage: python3 enrich.py [--write]      (without --write it only reports)
The app picks the new fields up when the seed's collection version changes; stored plays get missing fields only.
"""
from __future__ import annotations

import json
import os
import re
import sys

from verify import context, feed

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "..", "..", "apps", "baseball-feud-2", "library", "plays.js")
PREFIX = "window.BF2_LIBRARY = "
ORD = {1: "st", 2: "nd", 3: "rd"}


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 13 else ORD.get(n % 10, 'th')}"


def load():
    src = open(SEED, encoding="utf-8").read()
    i = src.index(PREFIX)
    head, body = src[:i], src[i + len(PREFIX):].rstrip().rstrip(";")
    return head, json.loads(body)


def find(f, play_id):
    for i, p in enumerate(f["liveData"]["plays"]["allPlays"]):
        if any(e.get("playId") == play_id for e in p.get("playEvents", [])):
            return i
    return None


def official(ctx):
    """The pre-play situation in the seed's own shape, from MLB's record."""
    bases = {b: bool(ctx["runnersBefore"].get(b)) for b in ("1B", "2B", "3B")}
    return {
        "date": ctx["date"], "teams": f"{ctx['away']} at {ctx['home']}",
        "inning": f"{'Top' if ctx['half'] == 'top' else 'Bottom'} {ordinal(ctx['inning'])}",
        "outs": ctx["outsBefore"], "bases": bases,
        "score": f"{ctx['awayAbbr']} {ctx['scoreBefore']['away']}, {ctx['homeAbbr']} {ctx['scoreBefore']['home']}",
        "batter": ctx["batter"]["name"], "pitcher": ctx["pitcher"]["name"],
        "batting": ctx["batterTeam"], "fielding": ctx["fieldingTeam"],
    }


def main():
    write = "--write" in sys.argv
    head, data = load()
    report, changed = [], 0
    for p in data["plays"]:
        v = p.get("verification") or {}
        pk, pid = v.get("gamePk"), v.get("playId")
        row = {"id": p["id"], "gamePk": pk, "playId": pid, "filled": [], "mismatch": []}
        if not pk or not pid:
            row["skipped"] = "no gamePk / playId"; report.append(row); continue
        f = feed(pk)
        idx = find(f, pid)
        if idx is None:
            row["skipped"] = "playId not found in MLB's feed"; report.append(row); continue
        ctx = context(f, idx)
        off, s = official(ctx), p.setdefault("situation", {})
        for k, want in off.items():
            have = s.get(k)
            if have in (None, "") or (k == "bases" and not have):
                continue  # missing: filled below only for the safe identity fields; situation gaps stay for review
            if k == "outs" and int(have) != int(want) or k != "outs" and have != want:
                row["mismatch"].append({"field": k, "seed": have, "mlb": want})
        fills = {"away": ctx["away"], "home": ctx["home"], "awayAbbr": ctx["awayAbbr"], "homeAbbr": ctx["homeAbbr"],
                 "venue": (f["gameData"].get("venue") or {}).get("name"), "batting": ctx["batterTeam"], "fielding": ctx["fieldingTeam"]}
        for k, val in fills.items():
            if val and not s.get(k):
                s[k] = val; row["filled"].append(f"situation.{k}")
        res = p.setdefault("result", {})
        for k, val in (("event", ctx["event"]), ("description", ctx["description"])):
            if val and not res.get(k):
                res[k] = val; row["filled"].append(f"result.{k}")
        if not v.get("atBatIndex") and v.get("atBatIndex") != 0:
            v["atBatIndex"] = idx; row["filled"].append("verification.atBatIndex")
        changed += bool(row["filled"])
        report.append(row)
        print(f"{'MISMATCH' if row['mismatch'] else 'ok':8} {p['id']:42} {ctx['date']} {ctx['awayAbbr']} @ {ctx['homeAbbr']} "
              f"| {ctx['event']} | filled {len(row['filled'])}" + "".join(f"\n         {m['field']}: seed {m['seed']!r} vs MLB {m['mlb']!r}" for m in row["mismatch"]))
    json.dump(report, open(os.path.join(HERE, "enrich-report.json"), "w"), indent=1)
    if write and changed:
        old = data["collection"].get("version", "2.0.0")
        major, minor, *_ = (old.split(".") + ["0", "0"])
        data["collection"]["version"] = f"{major}.{int(minor) + 1}.0"
        head = re.sub(r"(Generated from the research file)", r"\1; metadata filled from MLB's Stats API by tools/baseball-feud-discovery/enrich.py", head, count=1) \
            if "enrich.py" not in head else head
        open(SEED, "w", encoding="utf-8").write(head + PREFIX + json.dumps(data, indent=1, ensure_ascii=False) + ";\n")
        print(f"wrote {SEED} (collection {old} → {data['collection']['version']})")
    print(f"{changed} plays with new fields · {sum(bool(r['mismatch']) for r in report)} with mismatches · report enrich-report.json")


if __name__ == "__main__":
    main()
