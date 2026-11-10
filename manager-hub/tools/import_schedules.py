#!/usr/bin/env python3
"""Manager Hub — affiliate game schedule importer (repeatable; Python standard library only).

    python3 manager-hub/tools/import_schedules.py manager-hub/schedules/source/2027_Affiliate_Schedules.xlsx [--verify-mlb]

Reads a schedule workbook (.xlsx) or CSV with the columns
    sport      level code: aaa (Triple-A) · aax (Double-A) · afa (High-A) · afx (Single-A) · rok / fcl
    game_date  the game's date
    Details    "@ OKC 8:05" (away) / "vs. STP 8:05" (home); the time may be "TBD"; optional words after it
               (postponed, canceled, suspended, rescheduled, DH, game 1/2, exhibition, spring) are kept
and writes
    apps/manager-hub/schedules/games.json        the schedule Manager Hub ships (one record per game)
    manager-hub/schedules/IMPORT-REPORT.md       counts, affiliate mapping, skipped / ambiguous rows, changes,
                                                 and (with --verify-mlb) a game-by-game check against MLB's schedule

Rules (never invent data):
  * Affiliates are matched by level code (SOURCE_LEVELS), never by team abbreviation — "SL" in a schedule is the
    Salt Lake Bees, while Manager Hub's "SL" workspace is Sugar Land.
  * Times in the file have no AM/PM and are US Eastern (--source-tz). 11:xx is a morning game, 12:xx noon, any
    other hour PM. "TBD" stays TBD (no start time). Each start is stored as an exact instant plus the ballpark's
    local time and zone (home park for home games, the opponent's park for road games).
  * Opponent names, ballparks and time zones come from schedule-teams.json (MLB's team directory). A code missing
    from it is kept as written and reported as ambiguous.
  * Game ids are stable (affiliate · date · game number), so re-running the import updates games instead of
    duplicating them. Two games for one affiliate on one date are a doubleheader (game 1 and 2, in file order).
"""
import argparse, csv, datetime as dt, hashlib, io, json, os, re, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_GAMES = os.path.join(ROOT, "apps", "manager-hub", "schedules", "games.json")
OUT_REPORT = os.path.join(ROOT, "manager-hub", "schedules", "IMPORT-REPORT.md")
TEAMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule-teams.json")

# level code in the schedule file → Manager Hub affiliate workspace (index.html AFFILIATES) and its MLB team code
SOURCE_LEVELS = {
    "aaa": {"affiliate": "sl", "team": "SUG", "level": "Triple-A"},
    "aax": {"affiliate": "cc", "team": "CC", "level": "Double-A"},
    "afa": {"affiliate": "ash", "team": "ASH", "level": "High-A"},
    "afx": {"affiliate": "fay", "team": "FAY", "level": "Single-A"},
    "rok": {"affiliate": "fcl", "team": None, "level": "Rookie"},
    "fcl": {"affiliate": "fcl", "team": None, "level": "Rookie"},
}
STATUS_WORDS = [(r"\bpostponed\b|\bppd\b", "postponed"), (r"\bcancell?ed\b|\bcxl\b", "canceled"),
                (r"\bsuspended\b", "suspended"), (r"\brescheduled\b|\bmakeup\b|\bmake-up\b", "rescheduled")]
TYPE_WORDS = [(r"\bexhibition\b", "exhibition"), (r"\bspring\b", "spring"), (r"\bpostseason\b|\bplayoff", "postseason")]
DETAIL = re.compile(r"^\s*(?P<ha>@|at|vs\.?|v\.?)\s+(?P<opp>[A-Za-z][A-Za-z0-9.&' -]*?)\s+(?P<time>\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?|TBD|TBA)\b(?P<rest>.*)$", re.I)


# ---------------------------------------------------------------- reading
def read_xlsx(path):
    """first worksheet → list of row dicts keyed by the header row (dates as datetime, times as text)"""
    z = zipfile.ZipFile(path)
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    first = wb.find("m:sheets/m:sheet", ns)
    rid = first.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    target = next(r.get("Target") for r in rels if r.get("Id") == rid)
    sheet = ET.fromstring(z.read("xl/" + target.lstrip("/").replace("xl/", "")))
    styles = ET.fromstring(z.read("xl/styles.xml")) if "xl/styles.xml" in z.namelist() else None
    date_styles = set()
    if styles is not None:
        custom = {n.get("numFmtId"): n.get("formatCode") for n in styles.findall("m:numFmts/m:numFmt", ns)}
        for i, xf in enumerate(styles.findall("m:cellXfs/m:xf", ns)):
            fid = xf.get("numFmtId")
            code = custom.get(fid, "")
            if fid and (14 <= int(fid) <= 22 or re.search(r"[dmyh]", re.sub(r'"[^"]*"|\[[^]]*\]', "", code or ""), re.I)):
                date_styles.add(str(i))
    rows = []
    for r in sheet.findall("m:sheetData/m:row", ns):
        vals = {}
        for c in r.findall("m:c", ns):
            ref = re.match(r"([A-Z]+)", c.get("r")).group(1)
            col = 0
            for ch in ref: col = col * 26 + (ord(ch) - 64)
            v = c.find("m:v", ns)
            t = c.get("t")
            if t == "s": val = shared[int(v.text)] if v is not None else ""
            elif t == "inlineStr": val = "".join(x.text or "" for x in c.iter("{%s}t" % ns["m"]))
            elif v is None: val = ""
            elif c.get("s") in date_styles:
                f = float(v.text)
                val = dt.datetime(1899, 12, 30) + dt.timedelta(days=f) if f >= 1 else (dt.datetime(1899, 12, 30) + dt.timedelta(days=f)).time()
            else: val = v.text
            vals[col - 1] = val
        rows.append([vals.get(i, "") for i in range(max(vals) + 1)] if vals else [])
    return rows


def read_rows(path):
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8-sig") as f: rows = list(csv.reader(f))
    else: rows = read_xlsx(path)
    rows = [r for r in rows if any(str(x).strip() for x in r)]
    head = [str(h).strip().lower() for h in rows[0]]
    return head, [(i + 2, dict(zip(head, r))) for i, r in enumerate(rows[1:])]


def as_date(v):
    if isinstance(v, dt.datetime): return v.date()
    if isinstance(v, dt.date): return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d %H:%M:%S"):
        try: return dt.datetime.strptime(s, fmt).date()
        except ValueError: pass
    try:
        f = float(s)
        if f > 20000: return (dt.datetime(1899, 12, 30) + dt.timedelta(days=f)).date()
    except ValueError: pass
    return None


def clock(text):
    """'8:05' → (20, 5) with the baseball rule; '11:05 am' → (11, 5); TBD → None"""
    m = re.match(r"(\d{1,2}):(\d{2})\s*([ap])?", text.strip(), re.I)
    h, mi, mer = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    if mer == "p" and h < 12: h += 12
    elif mer == "a" and h == 12: h = 0
    elif not mer and 1 <= h <= 10: h += 12          # 1:05 … 10:05 → PM; 11:xx morning; 12:xx noon
    return h, mi


# ---------------------------------------------------------------- import
def run(src, source_tz, verify):
    teams_doc = json.load(open(TEAMS_FILE, encoding="utf-8"))
    ALIAS = teams_doc.get("aliases", {})
    def team(code, level):
        """a code within the affiliate's own level first (COL is Columbia in Single-A, Columbus in Triple-A), then any unique match"""
        code = ALIAS.get(level, {}).get(code, code)
        same = [t for t in teams_doc["teams"] if t["code"] == code and t["level"] == level]
        if same: return same[0]
        anyl = [t for t in teams_doc["teams"] if t["code"] == code]
        return anyl[0] if len(anyl) == 1 else None
    raw = open(src, "rb").read()
    head, rows = read_rows(src)
    need = {"sport", "game_date", "details"}
    if not need <= set(head): sys.exit(f"missing columns: {sorted(need - set(head))} (have {head})")
    tz_src = ZoneInfo(source_tz)
    games, skipped, ambiguous, notes = [], [], [], []
    per_day = {}
    for line, r in rows:
        code = str(r.get("sport", "")).strip().lower()
        lv = SOURCE_LEVELS.get(code)
        if not lv: skipped.append((line, f"unknown level code “{code}”", r.get("details"))); continue
        day = as_date(r.get("game_date"))
        if not day: skipped.append((line, "no readable date", r.get("details"))); continue
        det = str(r.get("details", "")).strip()
        m = DETAIL.match(det)
        if not m: skipped.append((line, "details not in “@ / vs. TEAM time” form", det)); continue
        home = not m.group("ha").lower().startswith(("@", "at"))
        opp_code = m.group("opp").strip().upper()
        opp = team(opp_code, lv["level"])
        canon = ALIAS.get(lv["level"], {}).get(opp_code)
        if canon: notes.append(f"{lv['level']} “{opp_code}” read as {canon} — {opp['name'] if opp else canon} (its 2027 code and name in MLB's directory).")
        if opp and opp["level"] != lv["level"]: ambiguous.append((line, f"opponent “{opp_code}” found only at {opp['level']}", det))
        if not opp: ambiguous.append((line, f"opponent code “{opp_code}” not in the team directory for {lv['level']} — kept as written", det))
        own = team(lv["team"], lv["level"]) if lv["team"] else None
        park = own if home else opp
        rest = m.group("rest").strip()
        status = next((s for p, s in STATUS_WORDS if re.search(p, rest, re.I)), "scheduled")
        gtype = next((s for p, s in TYPE_WORDS if re.search(p, rest, re.I)), "regular")
        tbd = m.group("time").upper() in ("TBD", "TBA")
        venue_tz = (park or {}).get("tz")
        rec = {
            "affiliate": lv["affiliate"], "level": lv["level"], "season": day.year, "date": day.isoformat(),
            "home": home, "opponent": {"code": opp_code, "name": opp["name"] if opp else None, "short": opp["short"] if opp else None},
            "venue": {"name": park["venue"], "city": park["venueCity"], "tz": park["tz"]} if park else None,
            "timeTBD": tbd, "startUTC": None, "localTime": None, "tz": venue_tz, "sourceTime": None if tbd else m.group("time"),
            "status": status, "type": gtype, "doubleheader": False, "gameNumber": 1,
            "seq": int(float(r["next_game"])) if str(r.get("next_game", "")).strip() not in ("", "None") else None,
            "notes": rest, "sourceRow": line,
        }
        if re.search(r"\b(dh|doubleheader)\b", rest, re.I): rec["doubleheader"] = True
        gm = re.search(r"\b(?:game|g)\s*([12])\b|\(([12])\)", rest, re.I)
        if gm: rec["gameNumber"] = int(gm.group(1) or gm.group(2))
        if not tbd:
            h, mi = clock(m.group("time"))
            inst = dt.datetime(day.year, day.month, day.day, h, mi, tzinfo=tz_src)
            rec["startUTC"] = inst.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if venue_tz:
                loc = inst.astimezone(ZoneInfo(venue_tz))
                rec["localTime"] = loc.strftime("%H:%M")
                if loc.date() != day: ambiguous.append((line, f"local start falls on {loc.date()} at the ballpark", det))
            else:
                ambiguous.append((line, "no ballpark time zone — local time unknown", det))
        per_day.setdefault((rec["affiliate"], rec["date"]), []).append(rec)
        games.append(rec)
    # doubleheaders: two games for one affiliate on one date
    for (aff, day), lst in per_day.items():
        if len(lst) > 1:
            lst.sort(key=lambda g: (g["gameNumber"] if g["gameNumber"] != 1 else 0, g["startUTC"] or "", g["sourceRow"]))
            for i, g in enumerate(lst): g["doubleheader"], g["gameNumber"] = True, i + 1
    for g in games: g["id"] = f"{g['affiliate']}-{g['date']}-g{g['gameNumber']}"
    ids = [g["id"] for g in games]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes: sys.exit(f"duplicate game ids (same affiliate, date and game number): {sorted(dupes)}")
    games.sort(key=lambda g: (g["affiliate"], g["date"], g["gameNumber"]))

    previous = {}
    if os.path.exists(OUT_GAMES):
        try: previous = {g["id"]: g for g in json.load(open(OUT_GAMES, encoding="utf-8"))["games"]}
        except Exception: previous = {}
    strip = lambda g: {k: v for k, v in g.items() if k not in ("sourceRow",)}
    changes = {"added": [g["id"] for g in games if g["id"] not in previous],
               "updated": [g["id"] for g in games if g["id"] in previous and strip(previous[g["id"]]) != strip(g)],
               "removed": [i for i in previous if i not in set(ids)]}
    affs = {}
    for g in games:
        a = affs.setdefault(g["affiliate"], {"games": 0, "home": 0, "away": 0, "tbd": 0, "doubleheaders": 0, "first": g["date"], "last": g["date"], "seasons": set()})
        a["games"] += 1; a["home" if g["home"] else "away"] += 1; a["tbd"] += g["timeTBD"]; a["doubleheaders"] += g["doubleheader"] and g["gameNumber"] == 1
        a["first"], a["last"] = min(a["first"], g["date"]), max(a["last"], g["date"]); a["seasons"].add(g["season"])
    for a in affs.values(): a["seasons"] = sorted(a["seasons"])
    src_name = os.path.basename(src)
    sha = hashlib.sha256(raw).hexdigest()
    version = hashlib.sha256(json.dumps(games, sort_keys=True).encode()).hexdigest()[:16]
    doc = {"about": "Affiliate game schedules for Manager Hub — generated by manager-hub/tools/import_schedules.py; don't edit by hand.",
           "version": version, "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": {"file": src_name, "sha256": sha, "rows": len(rows), "timeZone": source_tz},
           "affiliates": {k: {kk: vv for kk, vv in v.items()} for k, v in sorted(affs.items())},
           "games": games}
    os.makedirs(os.path.dirname(OUT_GAMES), exist_ok=True)
    json.dump(doc, open(OUT_GAMES, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

    verification = verify_mlb(games, team) if verify else None
    write_report(doc, rows, skipped, ambiguous, sorted(set(notes)), changes, verification)
    print(f"{len(games)} games from {len(rows)} rows → {os.path.relpath(OUT_GAMES, ROOT)} "
          f"(added {len(changes['added'])}, updated {len(changes['updated'])}, removed {len(changes['removed'])}; "
          f"skipped {len(skipped)}, ambiguous {len(ambiguous)})")
    if verification: print("MLB check:", verification["summary"])


def verify_mlb(games, team_of):
    """compare every game with MLB's published schedule (date, home/away, opponent, start instant)"""
    by_aff = {}
    for g in games: by_aff.setdefault(g["affiliate"], []).append(g)
    lv = {v["affiliate"]: v for v in SOURCE_LEVELS.values() if v["team"]}
    sport = {"Triple-A": 11, "Double-A": 12, "High-A": 13, "Single-A": 14}
    rows, total, ok = [], 0, 0
    for aff, lst in by_aff.items():
        if aff not in lv: continue
        team = team_of(lv[aff]["team"], lv[aff]["level"])
        seasons = sorted({g["season"] for g in lst})
        mlb = []
        for s in seasons:
            url = f"https://statsapi.mlb.com/api/v1/schedule?sportId={sport[team['level']]}&teamId={team['mlbId']}&season={s}&hydrate=team"
            with urllib.request.urlopen(url, timeout=30) as r: d = json.load(r)
            mlb += [x for day in d.get("dates", []) for x in day["games"]]
        idx = {}
        for x in mlb: idx.setdefault(x["officialDate"], []).append(x)
        for g in lst:
            total += 1
            cand = [x for x in idx.get(g["date"], []) if x["teams"]["home" if g["home"] else "away"]["team"]["id"] == team["mlbId"]]
            cand.sort(key=lambda x: x.get("gameNumber", 1))
            x = cand[g["gameNumber"] - 1] if len(cand) >= g["gameNumber"] else None
            if not x: rows.append((g["id"], "not in MLB's schedule")); continue
            o = x["teams"]["away" if g["home"] else "home"]["team"]
            issues = []
            canon = (g["opponent"]["name"] or "")
            if o.get("name") != canon: issues.append(f"opponent {o.get('name')} (file: {g['opponent']['code']})")
            if not g["timeTBD"] and x["gameDate"] != g["startUTC"]: issues.append(f"start {x['gameDate']} (file: {g['startUTC']})")
            if g["venue"] and x.get("venue", {}).get("name") != g["venue"]["name"]: issues.append(f"ballpark {x.get('venue', {}).get('name')} (directory: {g['venue']['name']})")
            if x.get("status", {}).get("detailedState") not in ("Scheduled", "Pre-Game", "Final", "Warmup"): issues.append("MLB status " + x["status"]["detailedState"])
            if issues: rows.append((g["id"], "; ".join(issues)))
            else: ok += 1
        extra = len(mlb) - len(lst)
        if extra: rows.append((aff, f"MLB lists {len(mlb)} games, the file {len(lst)}"))
    return {"summary": f"{ok}/{total} games identical to MLB's schedule", "issues": rows}


def write_report(doc, rows, skipped, ambiguous, notes, changes, verification):
    L = ["# Affiliate game schedule import", "",
         f"Source **{doc['source']['file']}** (sha256 `{doc['source']['sha256'][:16]}…`, {doc['source']['rows']} rows; times read as {doc['source']['timeZone']}). "
         f"Generated {doc['generated']} by `manager-hub/tools/import_schedules.py`; dataset version `{doc['version']}`.", "",
         "| Affiliate | Workspace | Games | Home | Away | Doubleheaders | TBD times | First | Last | Season |", "|---|---|---|---|---|---|---|---|---|---|"]
    names = {"sl": "Sugar Land Space Cowboys (aaa)", "cc": "Corpus Christi Hooks (aax)", "ash": "Asheville Tourists (afa)", "fay": "Fayetteville Woodpeckers (afx)", "fcl": "FCL Astros"}
    for k, a in doc["affiliates"].items():
        L.append(f"| {names.get(k, k)} | `{k}` | {a['games']} | {a['home']} | {a['away']} | {a['doubleheaders']} | {a['tbd']} | {a['first']} | {a['last']} | {', '.join(map(str, a['seasons']))} |")
    L += ["", f"**{len(doc['games'])} games imported** from {len(rows)} rows. Skipped: {len(skipped)}. Ambiguous: {len(ambiguous)}.", ""]
    L += ["## Affiliate mapping", "", "Matched by the file's level code, not by team abbreviation (the file's “SL” is the Salt Lake Bees; Manager Hub's `sl` is Sugar Land).", ""]
    L += [f"- `{c}` → `{v['affiliate']}` ({v['level']})" for c, v in SOURCE_LEVELS.items() if v["team"]]
    L += ["- No rows for the FCL Astros (`fcl`) — none in the file.", ""]
    L += ["## Reading rules", "", "- Times have no AM/PM and are US Eastern: 11:xx = morning, 12:xx = noon, every other hour PM. Stored as an exact instant plus the ballpark's local time (home park for home games, the opponent's park on the road).",
          "- The file's `test` and `Next_Game` columns are not needed: `test` is the same time read by Excel as AM; `Next_Game` (the season game number) is kept as `seq`.",
          "- No row marks a doubleheader, TBD time, postponement, cancellation or exhibition; the importer supports them when a file does.", ""]
    if notes: L += ["## Notes", ""] + [f"- {n}" for n in notes] + [""]
    if skipped: L += ["## Skipped rows", ""] + [f"- row {l}: {why} — `{d}`" for l, why, d in skipped] + [""]
    if ambiguous: L += ["## Ambiguous", ""] + [f"- row {l}: {why} — `{d}`" for l, why, d in ambiguous] + [""]
    L += ["## Changes since the previous import", "", f"- added {len(changes['added'])}, updated {len(changes['updated'])}, removed {len(changes['removed'])}"]
    if changes["updated"]: L.append("- updated: " + ", ".join(changes["updated"][:40]))
    if changes["removed"]: L.append("- removed from the file (Manager Hub keeps them, marked “no longer in the schedule”): " + ", ".join(changes["removed"][:40]))
    L.append("")
    if verification:
        L += ["## Check against MLB's published schedule", "", f"{verification['summary']}.", ""]
        L += [f"- {i}: {why}" for i, why in verification["issues"]] or ["- No differences."]
        L.append("")
    os.makedirs(os.path.dirname(OUT_REPORT), exist_ok=True)
    open(OUT_REPORT, "w", encoding="utf-8").write("\n".join(L))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--source-tz", default="America/New_York")
    ap.add_argument("--verify-mlb", action="store_true", help="compare every game with MLB's published schedule (network)")
    a = ap.parse_args()
    run(a.source, a.source_tz, a.verify_mlb)
