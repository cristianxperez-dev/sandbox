"""Shared MLB data + video sources for CP Baseball Systems tools (Play Repository, Baseball Feud 2.0).

Grown out of tools/baseball-feud-discovery (scan_pbp.py, verify.py, vsitemap.py), which stay as they are.
Every request goes through one cached, rate-limited, retrying fetcher. Nothing here downloads, rehosts or
works around MLB's video access controls: video is referenced by MLB.com clip pages and MLB's own embed.

Sources (all public):
  statsapi.mlb.com            schedule, live feed (play-by-play), game content (highlight clips), win probability
  baseballsavant.mlb.com      per-pitch Statcast CSV for a game, sporty-videos clip pages
  fastball-gateway.mlb.com    MLB Film Room search (the clip MLB keeps for every pitch, by playId)
  www.mlb.com                 clip pages + data-service JSON (declares MLB's embed URL)
  streamable.com/m/<slug>     MLB.com's own embed (Share → Embed); checked, never downloaded
Terms: statsapi is "individual, non-commercial, non-bulk use" — keep scans small and cached.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("MLBPLAYS_CACHE", os.path.join(HERE, "cache"))
os.makedirs(CACHE, exist_ok=True)
UA = "Mozilla/5.0 (cpbaseball-research; +https://cpbaseball.com)"
MIN_GAP = float(os.environ.get("MLBPLAYS_GAP", "0.35"))      # seconds between live requests (politeness)
_last = [0.0]


class SourceError(Exception):
    pass


def _cache_path(key: str) -> str:
    safe = re.sub(r"[^\w.-]", "_", key)[:120]
    return os.path.join(CACHE, safe + "-" + hashlib.sha1(key.encode()).hexdigest()[:10])


def fetch(url: str, *, data: bytes | None = None, headers: dict | None = None, cache: bool = True, ttl: float | None = None,
          ok=(200, 206), tries: int = 4, method: str | None = None) -> tuple[int, bytes]:
    """GET/POST with cache, spacing, retries and backoff on 429/5xx/network errors. Returns (status, body)."""
    key = url + ("|" + hashlib.sha1(data).hexdigest() if data else "") + ("|" + method if method else "")
    fp = _cache_path(key)
    if cache and os.path.exists(fp) and (ttl is None or time.time() - os.path.getmtime(fp) < ttl):
        with open(fp, "rb") as f:
            raw = f.read()
        status, body = int(raw[:3]), raw[4:]
        return status, body
    err = None
    for i in range(tries):
        wait = MIN_GAP - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        h = {"User-Agent": UA, "Accept": "*/*"}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                status, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read() if hasattr(e, "read") else b""
        except Exception as e:  # noqa: BLE001 — network failure: back off and retry
            err = e
            time.sleep(2 * (i + 1))
            continue
        if status == 429 or status >= 500:
            err = SourceError(f"{status} from {url}")
            time.sleep((20 if status in (429, 509) else 3) * (i + 1))   # 509 = MLB.com's bandwidth throttle: back off hard
            continue
        if cache and status in ok:
            with open(fp, "wb") as f:
                f.write(str(status).encode() + b"\n" + body)
        return status, body
    raise SourceError(f"giving up on {url}: {err}")


def get_json(url: str, **kw):
    status, body = fetch(url, **kw)
    if status not in (200, 206):
        raise SourceError(f"{status} from {url}")
    return json.loads(body)


# ----------------------------------------------------------------- Stats API
def schedule(start: str, end: str, game_types="R,F,D,L,W", sport_id=1):
    d = get_json(f"https://statsapi.mlb.com/api/v1/schedule?sportId={sport_id}&gameType={game_types}&startDate={start}&endDate={end}")
    return [g for day in d.get("dates", []) for g in day.get("games", []) if g["status"].get("codedGameState") == "F"]


def feed(pk: int):
    return get_json(f"https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live")


def content(pk: int):
    return get_json(f"https://statsapi.mlb.com/api/v1/game/{pk}/content")


def win_probability(pk: int):
    try:
        return get_json(f"https://statsapi.mlb.com/api/v1/game/{pk}/winProbability")
    except SourceError:
        return []


# ------------------------------------------------------------------- Savant
def statcast_game(pk: int) -> dict:
    """{(at_bat_number, pitch_number): row} from Savant's per-game Statcast CSV (alignment, RE/WE deltas, etc.)."""
    status, body = fetch(f"https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&game_pk={pk}")
    if status not in (200, 206) or not body:
        return {}
    rows = csv.DictReader(io.StringIO(body.decode("utf-8-sig", "replace")))
    out = {}
    for r in rows:
        try:
            out[(int(r["at_bat_number"]), int(r["pitch_number"]))] = r
        except (KeyError, ValueError):
            continue
    return out


def sporty(play_id: str) -> dict:
    """Savant's clip page for a pitch — same parsing rules as tools/baseball-feud-discovery/verify.py."""
    status, body = fetch(f"https://baseballsavant.mlb.com/sporty-videos?playId={play_id}")
    h = body.decode("utf-8", "replace")
    video = bool(re.search(r"https://sporty-clips\.mlb\.com/[^\"'\s<>]+\.mp4", h)) and not re.search(r"No Video Found", h, re.I)

    def item(label):
        m = re.search(rf"<strong>\s*{label}:\s*</strong>([\s\S]*?)</li>", h, re.I)
        return m.group(1) if m else ""
    pid = lambda s: (lambda m: int(m.group(1)) if m else None)(re.search(r"/savant-player/(\d{1,7})", s or ""))
    g = re.search(r"gamePk=(\d{5,7})", item("Matchup"))
    return {"status": status, "video": video, "batter": pid(item("Batter")), "pitcher": pid(item("Pitcher")),
            "gamePk": int(g.group(1)) if g else None, "url": f"https://baseballsavant.mlb.com/sporty-videos?playId={play_id}"}


# ---------------------------------------------------------------- Film Room
_FR_Q = """query Search($query: String!, $page: Int, $limit: Int, $languagePreference: LanguagePreference, $contentPreference: ContentPreference, $queryType: QueryType = STRUCTURED) {
 search(query: $query, limit: $limit, page: $page, languagePreference: $languagePreference, contentPreference: $contentPreference, queryType: $queryType) {
  total plays { mediaPlayback { id slug title blurb date feeds { type duration image { cuts { width height src } } }
   playInfo { inning inningHalf outs balls strikes gamePk runners { first second third } players { batter { id name } pitcher { id name } } } } } } }"""


def filmroom(query: str, limit: int = 25) -> list[dict]:
    body = json.dumps({"query": _FR_Q, "variables": {"queryType": "STRUCTURED", "query": query, "limit": limit, "page": 0,
                                                       "languagePreference": "EN", "contentPreference": "MIXED"}}).encode()
    status, raw = fetch("https://fastball-gateway.mlb.com/graphql", data=body,
                        headers={"content-type": "application/json", "Origin": "https://www.mlb.com", "Referer": "https://www.mlb.com/video"})
    if status != 200:
        raise SourceError(f"Film Room {status}")
    d = json.loads(raw)
    s = (d.get("data") or {}).get("search") or {}
    return [m for p in s.get("plays", []) for m in p.get("mediaPlayback", [])]


def filmroom_by_play(play_id: str) -> list[dict]:
    return filmroom(f'PlayId = ["{play_id}"]', limit=10)


# -------------------------------------------------------------- MLB.com clip
def clip_meta(slug: str) -> dict | None:
    """MLB.com's data-service JSON for a clip page (title, duration, feed type, image)."""
    status, body = fetch(f"https://www.mlb.com/data-service/en/videos/{slug}")
    if status not in (200, 206):
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def page_embed(slug: str) -> str | None:
    """The embed URL MLB.com declares on the clip page (JSON-LD embedUrl)."""
    status, body = fetch(f"https://www.mlb.com/video/{slug}")
    if status != 200:
        return None
    m = re.search(rb'"embedUrl":"(https://streamable\.com/m/[a-z0-9-]+)"', body)
    return m.group(1).decode() if m else None


def embed_status(url: str) -> int:
    """HTTP status of MLB's embed (206/200 = serves the player, 404 = no such clip). Checked, never saved."""
    try:
        status, _ = fetch(url, headers={"Range": "bytes=0-1023"}, cache=False, ok=(200, 206), tries=3)
        return status
    except SourceError:
        return 0


# ------------------------------------------------- Film Room: every editorial clip of a game
_FR_GAME_Q = """query Search($query: String!, $page: Int, $limit: Int) {
 search(query: $query, limit: $limit, page: $page, languagePreference: EN, contentPreference: CMS_ONLY, queryType: STRUCTURED) {
  total plays { mediaPlayback { id slug title blurb description date guid type feeds { type duration image { cuts { width src } } }
   keywordsDisplay { slug displayName }
   playInfo { inning inningHalf outs gamePk players { batter { id name } pitcher { id name } } } } } } }"""


def filmroom_game_cms(pk: int, max_pages: int = 6) -> list[dict]:
    """All of MLB's editorial (CMS) clips Film Room holds for a game — a superset of the Stats API content list
    (it includes alternate-angle clips such as High Home and Field View that the content endpoint can omit)."""
    out, page = [], 0
    while page < max_pages:
        body = json.dumps({"query": _FR_GAME_Q, "variables": {"query": f"GamePk = [{pk}]", "limit": 100, "page": page}}).encode()
        status, raw = fetch("https://fastball-gateway.mlb.com/graphql", data=body,
                            headers={"content-type": "application/json", "Origin": "https://www.mlb.com", "Referer": "https://www.mlb.com/video"})
        if status != 200:
            raise SourceError(f"Film Room {status}")
        s = (json.loads(raw).get("data") or {}).get("search") or {}
        items = [m for p in s.get("plays", []) for m in p.get("mediaPlayback", [])]
        out += items
        if not items or len(out) >= (s.get("total") or 0):
            break
        page += 1
    return out


def gameday_play(pk: int, at_bat_index: int) -> dict:
    """MLB Gameday's page for one play (where Gameday 3D lives). Verified by MLB resolving it to that game's play URL."""
    url = f"https://www.mlb.com/gameday/{pk}/play/{at_bat_index}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(3):
        try:
            wait = MIN_GAP - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
            with urllib.request.urlopen(req, timeout=45) as r:
                final, status = r.geturl(), r.status
                head = r.read(400000).decode("utf-8", "replace")
            ok = status == 200 and f"/{pk}/play/{at_bat_index}" in final and "fieldvision" in head.lower()
            return {"url": url, "canonical": final, "status": status, "ok": ok, "fieldvision": "fieldvision" in head.lower()}
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 509):
                time.sleep(15 * (i + 1)); continue
            return {"url": url, "status": e.code, "ok": False}
        except Exception as e:  # noqa: BLE001
            time.sleep(3 * (i + 1)); err = str(e)
    return {"url": url, "status": 0, "ok": False, "error": err}
