# Baseball Feud 2.0 — Plays Library

`plays.js` seeds the library with 11 verified MLB plays (the Volume 1 research; both High Home clips included).
On first run they are copied into the browser's own library (`localStorage` key `baseballFeud2.library.v1`).
Picking a play copies it into a game, so editing a game's answers never changes the library.

Workflow: **Games → + New game from the library → pick 3–4 plays → edit the answers in Setup → ▶ Present game.**
Games autosave (`baseballFeud2.games.v1`); the current game is `baseballFeud2.v1`. The original Baseball Feud
(`baseballIQ.v1`, `/apps/baseball-iq/`) is never read or changed.

New plays: see `tools/baseball-feud-discovery/README.md` in the repository, then Plays Library → Find New Plays → Import
(they wait in the review queue until approved).

## Videos: two angles per play (Nov 2026)

Each library play has one record (its `id` is the stable play ID; MLB's `gamePk` / `playId` sit in `verification`) and two
camera-angle slots: **Broadcast** and **iHome / High Home**. A slot can hold MLB.com's public clip (from the seed) and/or a
file uploaded with **Manage Video** (library card, play details, Setup, or ⇄ MANAGE VIDEO under the video in the round).
`media.def` is the angle games play first; if it has no video, games fall back to the other angle (iHome → Broadcast).
An upload never replaces MLB's clip — it plays instead of it and the clip returns if the upload is removed — and never
touches the other angle. Changes are staged: preview first, nothing is stored until SAVE, CANCEL restores everything.

**Where uploads live:** this browser's IndexedDB (`baseball-feud-2-videos`, keys `lib:<play id>:<angle>`); the library
record only describes them (`media.files`). They are never uploaded to the Sandbox site, can't be reached by URL and don't
appear on another computer or browser. Plays added to a game reference the library record (`mlb.libId`), so a video
attached in the library is what the game shows. Plays that aren't from the library keep their single per-game video.

## Metadata

The seed carries the pre-play situation (inning, outs, runners, score, batter, pitcher, batting / fielding team) from MLB's
play record. `tools/baseball-feud-discovery/enrich.py` re-reads MLB's Stats API by gamePk + playId, **checks** those
fields (all 11 plays match MLB's record) and **fills only missing** ones (team names / abbreviations, result event and
MLB's description, at-bat index). When the seed's collection version changes, the app copies new fields into stored
plays without touching titles, answers, notes or attached videos. Missing data is shown as “Not recorded”, never guessed.

Tests: `node tools/baseball-feud-discovery/tests/app.e2e.cjs` (see the file header).
