# Baseball Feud 2.0 — play discovery pipeline

Finds new MLB teaching plays for the Baseball Feud 2.0 Plays Library. It runs on a computer or in a Claude Code
session (Python 3, no dependencies) — not in the app, which is a static site with no server.
Nothing it produces is published here: the scripts sit outside `apps/` and `site/`, and their caches are git-ignored.

| Step | Script | What it does |
| --- | --- | --- |
| 1. Find | `scan_pbp.py START END` | Scans MLB's official play-by-play (statsapi.mlb.com) for multi-error plays, long rundowns / relays and runners doubled off → `candidates.json` |
| 2. Verify | `verify.py candidates.json verified.json` | Official situation (inning, outs, runners, score, count), fielder credits and the last pitch's playId; matches Baseball Savant's clip page to the same game, batter and pitcher |
| 3. Camera angle | `vsitemap.py 2021` | Inventories MLB.com's weekly video sitemaps for clips MLB labels High Home / overhead / wide. A play's own MLB.com highlight is found from its playId in MLB Film Room. The angle is checked by looking at the clip — never assumed |
| 4. Answers | (person or AI research session) | 5–6 proposed answers + coaching notes per play, each from the official record, a cited report, or a coaching standard → `answers.json` (format in `to_queue.py`) |
| 5. Package | `to_queue.py verified.json answers.json` | → `discovered-plays.json` |
| 6. Review | Baseball Feud 2.0 → Plays Library → **Find New Plays** → Import | Every play lands in the **Review queue**; only plays you approve join the library. Nothing is added to a game automatically |

Rules: never download, rehost or work around MLB's video access controls. The app plays MLB.com's own embed (its
Share → Embed code, hosted by Streamable). High Home or wide footage first; label broadcast clips as broadcast.

## Making it automatic later
A "Find New Plays" button that searches by itself needs a small backend: a scheduled job (e.g. a Cloudflare Worker
with Cron Triggers) that runs steps 1–3, a writing step for the answers (an LLM API with a key held on the server),
and storage for the queue (e.g. Cloudflare KV / D1) that the app reads. The approval step stays in the app.
Mind MLB's terms (statsapi.mlb.com: individual, non-commercial, non-bulk use) before scheduling wide scans.
