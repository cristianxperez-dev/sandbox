# Baseball Feud 2.0 — Plays Library

`plays.js` seeds the library with 11 verified MLB plays (the Volume 1 research; both High Home clips included).
On first run they are copied into the browser's own library (`localStorage` key `baseballFeud2.library.v1`).
Picking a play copies it into a game, so editing a game's answers never changes the library.

Workflow: **Games → + New game from the library → pick 3–4 plays → edit the answers in Setup → ▶ Present game.**
Games autosave (`baseballFeud2.games.v1`); the current game is `baseballFeud2.v1`. The original Baseball Feud
(`baseballIQ.v1`, `/apps/baseball-iq/`) is never read or changed.

New plays: see `tools/baseball-feud-discovery/README.md` in the repository, then Plays Library → Find New Plays → Import
(they wait in the review queue until approved).
