# tools/decision-lab — the data behind Decision Lab

Decision Lab (`apps/decision-lab/`) is a standalone baseball decision simulator. This folder builds its two data files
and holds its tests. Python 3 and Node, no dependencies. `cache/` (Retrosheet and Savant downloads, ~330 MB) is git-ignored.

| Step | Command | Output |
| --- | --- | --- |
| Model | `python3 build_model.py` | `apps/decision-lab/data/model.json` (≈60 KB) |
| Film Room | `python3 build_film.py` | `apps/decision-lab/data/film.json` — read-only index of Play Repository |
| Engine tests | `node --test tools/decision-lab/tests/engine.test.mjs` | 11 tests |
| Browser tests | `node scripts/build.mjs && node scripts/serve.mjs &` then `node tools/decision-lab/tests/app.e2e.cjs` | 80 checks |

## Independence from Play Repository

Decision Lab never imports Play Repository code and never writes its data. `build_film.py` reads
`apps/play-repository/data/index.json` and `data/plays/<id>.json`, matches each play's official record (runner starts,
ends and outs on the bases; event; base-out state) to a decision family, and writes Decision Lab's own index with the
source file's SHA-256. Clips are MLB.com's own embeds exactly as Play Repository verified them; each film entry links back
to `../play-repository/#/play/<id>`. If Decision Lab is removed, Play Repository is unaffected; if Play Repository changes,
rerun `build_film.py`.

## Sources

- **Retrosheet** parsed play files, regular season 2023–2025 (7,289 games, ~570,000 plays). *The information used here was
  obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at
  www.retrosheet.org.*
- **Baseball Savant** sprint speed and outfield arm strength leaderboards 2023–25 (distributions for hypothetical players).
- **MLB Stats API** season SB / CS per player, joined to sprint speed by MLBAM id (the steal-success fit).
- FanGraphs is not used (not reachable here; no projections or proprietary values are needed).

## What is empirical, fitted, preliminary or assumed

| Component | Basis | Detail |
| --- | --- | --- |
| Run expectancy and run distributions (24 base-out states) | Empirical | Innings 1–8, by batting side. RE: 0.50 empty/0 out, 0.90 runner on 1st/0 out. |
| Win expectancy | Computed | Dynamic programming over the run distributions; home bats last; extra innings start with a runner on 2nd (regular-season rule). Start of game 53.0% (actual home win% 52.9%). Mean absolute difference from MLB's own win probability: **1.7 points** over 125 Play Repository plays. |
| Game between decisions | Empirical | Every observed base-out transition (plate appearances by batter OPS tier, plus wild pitches, steals, pickoffs). Simulated games average 8.93 runs (league 8.97). |
| Steal of second | Fitted | Logistic fit of success on sprint speed, 13,279 attempts: slope 0.117 ± 0.019 per ft/s. League success 77%. Battery effect ±4 pts: assumption. |
| Steal of third | Fitted | Same speed fit shifted to the observed 81.6% (992 attempts). |
| Sacrifice bunt vs swing away | Empirical + assumption | Bunts put in play by state; swing-away by batter tier. 12% of bunt attempts assumed to fail before one is in play (Retrosheet can't see foul or missed bunts). |
| Send from 2nd on a single; from 1st on a double; tag from 3rd | Preliminary model | Throw-versus-runner timing with literature geometry; offset and spread fitted so a break-even sending policy reproduces Retrosheet two-out send and out-at-home rates (send from 2nd: 92.9% sent / 3.3% out vs 92.9% / 3.2% observed). Runner read delay with < 2 outs fitted to the send rate (out rate predicted 1.8% vs 2.5% observed). 8% of throws assumed off-line. |
| Infield in / back / corners in | Assumption, bounded by data | No public data records a drawn-in infield. Data: with a runner on 3rd, ground balls are hits 23.0% with two outs (infield back) vs 31.8% with fewer; line-drive and bloop singles rise too. The effect = that difference ÷ assumed usage (55%, range 40–80%); runner-scoring shares on ground-ball outs (70% back, 15% in) are assumptions. Recommendations that flip inside these ranges are flagged as close calls. |

Every decision is valued in win probability for the user's club (and expected runs). Grades depend only on the choice
against the model's preferred option (sound / defensible / questionable / costly), never on the simulated result;
results are tracked separately as luck.

## Findings worth knowing

- With **nobody out**, holding a runner from second at third is worth about as much as scoring him (1.87 vs 1.90
  expected runs), so the send break-even is near 100% — coaches' low send rate with fewer outs is consistent with that.
- Steals of second now break even around 63–70% in close games; average runners succeed ~77%.
- Infield in: clearly right late and close (bottom 9th, tie, one out: +2–3 win-probability points); wrong with a lead of
  two or more; early in the game it is close and assumption-dependent.

## Limits

Players are hypothetical; counts and pitchers aren't modeled; a steal is valued as if the plate appearance then continues
normally; the timing models are calibrated to league rates, not tracked throws; infield positioning is the most
assumption-dependent decision; comparison with real managers' choices is a future addition.
