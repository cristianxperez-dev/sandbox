# tools/mlb-plays — shared MLB play + video pipeline

The play-discovery and video pipeline behind **Play Repository** (`apps/play-repository/`). It grew out of
`tools/baseball-feud-discovery/` (Baseball Feud 2.0), which stays exactly as it was. Python 3, no dependencies.
Nothing here is published: the folder sits outside `apps/` and `site/`, and `cache/` and `work/` are git-ignored.

| Step | Script | What it does |
| --- | --- | --- |
| 1. Discover | `discover.py 2025-06-01:2025-06-07 …` | Final games → MLB live feed → one **normalized play** per plate-appearance result and per baserunning event (steal, pickoff, wild pitch …). It also pulls MLB win probability / leverage, Savant per-pitch Statcast (alignment, run- and win-expectancy change) and the game's MLB.com highlight list. Incremental: known games are skipped. |
| 2. Camera angles | `angles.py 2024 2025` | MLB.com weekly video sitemaps → clips MLB itself labels High Home or another named angle. |
| 3. Curate | `curate.py` | Teaching slots (rules over objective flags) → ranked candidates → video verification → the starter set, with replacements logged. |
| 4. Verify video | `videos.py` (used by curate) | Clips tied to the exact play: MLB highlight `guid` = playId; Film Room play info = game, inning, half, outs, runners, batter, pitcher; angle clips identified by MLB's own text and unique in the game. The MLB.com page must declare the embed, and the embed must answer 200/206. |
| 5. Publish | `publish.py ../../apps/play-repository` | `data/index.json` (filterable fields + flag rules), `data/plays/<id>.json` (full record), `VALIDATION.md`. Add `--bundle new.json` to make an import file for the app's review queue, or `--feud out.json` for Baseball Feud 2.0's import format; Feud requires the coach to write the answers first. |
| Re-verify | `verify_published.py ../../apps/play-repository` | Fresh download of every published play's feed and clips; field-by-field comparison. |

Shared modules: `mlb.py` (every source; cached, spaced, retrying fetcher with backoff on 429/5xx), `normalize.py`
(game state **before** each play, runner segments merged, fielder chains, objective flags with written rules).

## What was reused from Baseball Feud 2.0

- **Stats API.** `scan_pbp.py` / `verify.py` live-feed reading and before-play context, generalized to every play in a game. Runner segments are merged, and mid-at-bat events get their own state.
- **Savant.** `verify.py`'s sporty-videos match (same game, batter and pitcher) is kept as an independent cross-check.
- **High Home inventory.** `vsitemap.py`'s weekly-sitemap source and rule: an angle is never assumed, and High Home only when MLB says so.
- **Playback.** MLB.com's own embed (`streamable.com/m/<slug>`) driven through player.js, as in Feud 2.0's live round.
- **New here.** The game content endpoint (a highlight's `guid` is the playId), MLB Film Room search by playId (a clip for essentially every pitch), win probability / leverage, Savant's per-game Statcast CSV, the curated slots and the field-by-field re-verification.

## Rules

- Never download, rehost or work around MLB's video access controls; clips are MLB.com pages and MLB's embed.
- Statsapi terms are "individual, non-commercial, non-bulk use": scans are small, cached and spaced. The starter set used 168 games.
- Flags are objective (MLB's official record, Statcast, MLB win probability). Coaching judgements are manual tags in the app.
