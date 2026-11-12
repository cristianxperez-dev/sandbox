# Baseball Feud 2.0 — default game

`default-game.js` is the one place the default is chosen. It is generated from a game file in EXPORT GAME format:

- **Current default:** `game-day-2026-11-12.json` — "GAME DAY — NOV 12, 2026", four plays from the Plays Library, in order:
  BAL @ BOS (`wwgw-v1-06-wheres-the-cutoff`), MIA @ PIT (`wwgw-v1-07-bunt-chaos`), AZ @ SF (`wwgw-v1-08-rundown-that-wouldnt-end`),
  CWS @ MIN (`wwgw-v1-12-two-runners-one-base`). Each play references its library record and MLB clip (no copies); the answers
  are the coach's teaching points (longer explanations in each answer's note), 10 points each until edited in Setup.
  Practice Play, Fast Money and settings carried over from the previous default.
- `sample-game-volume-1.json`: the earlier default, exactly as exported (kept unchanged).

```bash
node apps/baseball-feud-2/games/make-default.mjs games/<file>.json [game-id]
```

How it behaves (code: `DEFAULT_GAME` in `index.html`):

- Every visitor starts a session (a browser tab) on the default game, with a fresh game state. Its settings (team names, host, strikes, Fast Money) come from the file.
- A refresh in the same tab resumes whatever game is open, as before.
- Opening another game from GAMES, importing one or building one from the Library holds for the rest of that session.
- The game a returning visitor had open is kept in GAMES. Edits made to the default game are kept there as "… (your edits)", and the default itself always comes back from the file.
- The default game is always listed in GAMES (tagged DEFAULT) and can't be deleted.

Stable id: `g-game-day-2026-11-12` (earlier: `g-sample-game-volume-1`). Tests: `tools/baseball-feud-discovery/tests/default-game.e2e.cjs`.
