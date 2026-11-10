# Baseball Feud 2.0 — default game

`sample-game-volume-1.json` is the game exactly as exported with EXPORT GAME (kept unchanged).
`default-game.js` is generated from it and is the one place the default is chosen:

```bash
node apps/baseball-feud-2/games/make-default.mjs games/<file>.json [game-id]
```

How it behaves (code: `DEFAULT_GAME` in `index.html`):

- Every visitor starts a session (a browser tab) on the default game, with a fresh game state. Its settings (team names, host, strikes, Fast Money) come from the file.
- A refresh in the same tab resumes whatever game is open, as before.
- Opening another game from GAMES, importing one or building one from the Library holds for the rest of that session.
- The game a returning visitor had open is kept in GAMES. Edits made to the default game are kept there as "… (your edits)", and the default itself always comes back from the file.
- The default game is always listed in GAMES (tagged DEFAULT) and can't be deleted.

Stable id: `g-sample-game-volume-1`. Tests: `tools/baseball-feud-discovery/tests/default-game.e2e.cjs`.
