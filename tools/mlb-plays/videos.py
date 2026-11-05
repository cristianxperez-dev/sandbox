"""Step 3 — video matching and verification for one normalized play.

Clips, in playback preference order:
  1. high-home  an MLB.com clip MLB itself labels High Home, for the same game and play
  2. highlight  MLB.com's edited highlight whose guid IS the play's playId (game content endpoint)
  3. filmroom   MLB Film Room's clip for the playId (the TV feed MLB keeps for every pitch)
  4. alternate  another MLB-named angle (e.g. "Field View"), labelled with MLB's own name
Every clip is kept only if: MLB.com's clip page exists and declares MLB's embed, the embed answers (200/206),
and the clip is tied to the play (guid = playId, Film Room's playInfo = the play's game/inning/outs/runners/
batter/pitcher, or — for angle clips without a guid — MLB's title names the play's batter in the same game).
A broadcast feed is never labelled High Home.
"""
from __future__ import annotations

import re
import time

import mlb

FEED_LABEL = {"HOME": "Home TV broadcast", "AWAY": "Away TV broadcast", "NETWORK": "National TV broadcast", "CMS": "MLB.com edited clip"}


def _clip(slug, kind, title, duration, feed, angle, how, thumb=None, match=None):
    return {"kind": kind, "slug": slug, "title": title, "duration": duration, "feed": feed,
            "pageUrl": f"https://www.mlb.com/video/{slug}", "embedUrl": f"https://streamable.com/m/{slug}",
            "angle": angle, "howVerified": how, "thumb": thumb, "match": match or {}}


def _check(clip, report):
    """MLB.com page declares the embed, and the embed serves a player."""
    emb = mlb.page_embed(clip["slug"])
    st = mlb.embed_status(clip["embedUrl"]) if emb else 0
    meta = mlb.clip_meta(clip["slug"]) if emb else None
    clip["checks"] = {"pageEmbed": bool(emb), "embedStatus": st, "checkedAt": time.strftime("%Y-%m-%d")}
    if meta:
        clip["feed"] = clip["feed"] or meta.get("type")
        clip["duration"] = clip["duration"] or meta.get("duration")
        if not clip.get("thumb"):
            cuts = ((meta.get("image") or {}).get("cuts") or [])
            clip["thumb"] = next((c.get("src") for c in cuts if c.get("width") in (640, 372)), cuts[0].get("src") if cuts else None)
    ok = bool(emb) and emb == clip["embedUrl"] and st in (200, 206)
    if not ok:
        report.append(f"{clip['kind']} {clip['slug']}: page embed {'yes' if emb else 'no'}, embed status {st}")
    return ok


def _filmroom_match(m, rec):
    pi = m.get("playInfo") or {}
    b = rec["before"]
    runners = pi.get("runners") or {}
    fr_bases = ("1" if runners.get("first") else "_") + ("2" if runners.get("second") else "_") + ("3" if runners.get("third") else "_")
    players = pi.get("players") or {}
    checks = {
        "gamePk": pi.get("gamePk") == rec["game"]["gamePk"],
        "inning": pi.get("inning") == b["inning"] and str(pi.get("inningHalf", "")).lower() == b["half"],
        "outs": pi.get("outs") == b["outs"],
        "runners": fr_bases == b["bases"],
        "batter": ((players.get("batter") or {}).get("id")) == rec["batter"]["id"],
        "pitcher": ((players.get("pitcher") or {}).get("id")) == rec["pitcher"]["id"],
    }
    return checks


def clips_for(rec, by_play, angled, report, sitemap=None, plays_in_game=None):
    pid = rec["source"]["playId"]
    out = []
    if not pid:
        report.append("no playId on the play")
        return out
    # 2. MLB.com highlight tied by guid
    for c in (by_play.get(pid) or [])[:2]:
        clip = _clip(c["slug"], "highlight", c["title"], c.get("duration"), "CMS",
                     {"category": "broadcast", "label": "MLB.com highlight — broadcast footage, edited (may include replays)"},
                     "MLB's highlight guid equals the play's playId", c.get("thumb"), {"guid": pid})
        if _check(clip, report):
            out.append(clip)
    # 3. Film Room clip for the playId, matched to the play's state
    try:
        fr = mlb.filmroom_by_play(pid)
    except mlb.SourceError as e:
        fr = []
        report.append(f"Film Room unavailable: {e}")
    for m in fr:
        chk = _filmroom_match(m, rec)
        if not all(chk.values()):
            report.append(f"Film Room {m.get('slug')} mismatch: {', '.join(k for k, v in chk.items() if not v)}")
            continue
        feeds = [f.get("type") for f in m.get("feeds", [])]
        cuts = [c for f in m.get("feeds", []) for c in ((f.get("image") or {}).get("cuts") or [])]
        thumb = next((c.get("src") for c in cuts if c.get("width") in (640, 372)), cuts[0].get("src") if cuts else None)
        clip = _clip(m["slug"], "filmroom", m.get("title"), None, None, None,
                     "MLB Film Room clip for the playId; Film Room's play info matches game, inning, outs, runners, batter and pitcher", thumb,
                     {"filmroom": chk, "feeds": feeds})
        if any(c["kind"] == "highlight" and (c["title"] == clip["title"] or c["slug"] == clip["slug"]) for c in out):
            break                                  # the same edited clip MLB already gave us as the highlight
        if _check(clip, report):
            feed = clip.get("feed") or (feeds[0] if feeds else None)
            if feed == "CMS" and any(c["kind"] == "highlight" for c in out):
                break
            clip["angle"] = {"category": "broadcast", "label": FEED_LABEL.get(feed, "TV broadcast")}
            if any(c["slug"] == clip["slug"] for c in out):
                continue
            out.append(clip)
        break
    # 1 & 4. MLB-labelled angle clips (game content list + MLB's sitemaps): no guid, so MLB's own text must
    # identify the play — batter's name, or "top/bottom of the Nth" — plus the event, and only one play may fit
    for a in angle_candidates(rec, angled, sitemap):
        if _angle_matches(a, rec, plays_in_game or []):
            hh = a["angle"] == "high-home"
            clip = _clip(a["slug"], "high-home" if hh else "alternate", a.get("title"), a.get("duration"), "CMS",
                         {"category": "high-home" if hh else "alternate",
                          "label": "HIGH HOME — labelled by MLB" if hh else f"{a['angle'].replace('-', ' ').title()} (MLB's name for this angle)"},
                         "MLB's own title/description names this camera angle and identifies this play (same game, batter or inning, event)",
                         a.get("thumb"), {"text": True})
            if any(c["slug"] == clip["slug"] for c in out):
                continue
            if _check(clip, report):
                out.insert(0, clip) if hh else out.append(clip)
    return out


HINT = {"home_run": (r"\bhomers?\b", r"\bhome runs?\b", r"\bgrand slam\b"), "double_play": (r"\bdouble play\b",), "grounded_into_double_play": (r"\bdouble play\b",),
        "single": (r"\bsingles?\b",), "double": (r"\bdoubles?\b(?! play)",), "triple": (r"\btriples?\b(?! play)",), "strikeout": (r"\bstrike ?outs?\b", r"\bstrikes out\b", r"\bpunchout\b"),
        "sac_fly": (r"\bsac(?:rifice)? fly\b",), "field_out": (r"\bcatch\b", r"\bgrab\b"), "walk": (r"\bwalks?\b",)}


def angle_candidates(rec, angled, sitemap):
    out = list(angled.get(str(rec["game"]["gamePk"]), []))
    d = rec["game"]["date"]
    import datetime as dt
    day = dt.date.fromisoformat(d)
    near = {(day + dt.timedelta(days=i)).isoformat() for i in (0, 1, 2)}
    out += [a for a in (sitemap or []) if a.get("date") in near]
    seen, uniq = set(), []
    for a in out:
        if a["slug"] not in seen:
            seen.add(a["slug"]); uniq.append(a)
    return uniq


def _angle_matches(a, rec, plays_in_game):
    text = ((a.get("title") or "") + " " + (a.get("description") or "")).lower()
    hints = HINT.get(rec["event"]["type"], (re.escape((rec["event"]["label"] or "").lower()),))
    if not any(h and re.search(h, text) for h in hints):
        # MLB's wording can differ from the official event ("bunt" for a fielder's choice). Still a match when the
        # text names the batter AND the exact half-inning, and that was his only plate appearance in the half-inning.
        last = rec["batter"]["name"].split()[-1].lower()
        m = re.search(r"\b(top|bottom) of the (\d{1,2})(?:st|nd|rd|th)", text)
        if not (last in text and m and m.group(1) == rec["before"]["half"] and int(m.group(2)) == rec["before"]["inning"]):
            return False
        same_pa = {p["source"].get("atBatIndex") for p in plays_in_game if p["batter"]["id"] == rec["batter"]["id"]
                   and p["before"]["inning"] == rec["before"]["inning"] and p["before"]["half"] == rec["before"]["half"]}
        if len(same_pa) > 1:
            return False
        # mid-at-bat events (steals, wild pitches …) share the plate appearance — the clip is about its result
        mid_pa = ("stolen_base", "caught_stealing", "wild_pitch", "passed_ball", "pickoff", "balk", "defensive_indiff")
        return not rec["event"]["type"].startswith(mid_pa)
    last = rec["batter"]["name"].split()[-1].lower()
    m = re.search(r"\b(top|bottom) of the (\d{1,2})(?:st|nd|rd|th)", text)
    teams = [rec["game"]["away"]["club"] or "", rec["game"]["home"]["club"] or ""]
    if last in text and (any(t and t.lower() in text for t in teams) or a.get("players") or a.get("date")):
        named = True
    else:
        named = False
    by_inning = bool(m) and m.group(1) == rec["before"]["half"] and int(m.group(2)) == rec["before"]["inning"]
    # a clip from MLB's sitemap isn't tied to a game: it must name the batter. Only clips listed in the game's own
    # content may be identified by inning instead.
    in_game_content = "url" not in a
    if not (named or (in_game_content and by_inning and any(t and t.lower().rstrip("s") in text for t in teams))):
        return False
    # unique: no other play in the game fits the same description
    rivals = [p for p in plays_in_game if p["id"] != rec["id"] and p["event"]["type"] == rec["event"]["type"]
              and ((named and p["batter"]["name"].split()[-1].lower() == last) or (by_inning and p["before"]["inning"] == rec["before"]["inning"] and p["before"]["half"] == rec["before"]["half"]))]
    return not rivals


def savant_check(rec):
    """Independent cross-check (Feud 2.0's original method): Savant's clip page names the same game, batter, pitcher."""
    pid = rec["source"]["playId"]
    if not pid or not rec["source"]["terminal"]:
        return None
    try:
        s = mlb.sporty(pid)
    except mlb.SourceError:
        return None
    return {"video": s["video"], "match": s["gamePk"] == rec["game"]["gamePk"] and s["batter"] == rec["batter"]["id"] and s["pitcher"] == rec["pitcher"]["id"],
            "url": s["url"]}
