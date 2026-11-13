# Call the Game — model and method

A Sandbox app at `apps/call-the-game/`. It has no dependencies, no backend and no paid APIs. Tests live in `call-the-game/tests/`.

## Files
| File | Role |
| --- | --- |
| `engine.js` | Pure logic shared with Node tests: pitcher profiles, seeded RNG, execution, hitter model, rules, grading. |
| `rig.js` | 3D figure rig: poses, two-bone IK, and depth-sorted tapered volumes with knockout outlines. |
| `scene.js` | Catcher's-view camera, ballpark, delivery/swing timeline, ball flight and batted balls. |
| `audio.js` | Synthesized mitt, bat and crowd sounds (Web Audio); can be muted. |
| `app.js` | Screens: choose → advance report → game → review. Persistence lives in `localStorage` `ctg.v1`. |

## One coordinate system
Everything uses feet in the catcher's view:
- `x`: positive is the catcher's right (first-base side).
- `y`: toward the pitcher; `0` is the front of the plate.
- `z`: height.

The strike zone is |x| ≤ 0.83 and 1.55 ≤ z ≤ 3.45.

Profiles describe misses, movement and corridors in **arm-side** units: `a = x · armSign`, where a RHP has armSign −1 and a LHP +1. That way one profile reads correctly for either hand.

## Execution
The pitch's endpoint is built from four pieces:

endpoint = glove target + systematic bias + correlated 2D error

1. **Glove target**: where the user set the glove.
2. **Systematic bias**: per pitch type, in inches arm-side and up.
3. **Correlated 2D error**: a bivariate normal with standard deviations `sdH` and `sdV` and correlation `rho`.
4. **Occasional large miss**: with probability `wild` (3–7%), the error is drawn 2.3× wider.

Kessler's command also depends on the side of the plate the target is on. Error spread is scaled up for arm-side targets and down for glove-side targets.

The ball's flight is the straight chord from the release point to the endpoint, plus a movement term that is zero at both ends: p(t) = R + (E − R)t + B(t² − t). As a result, the animation lands exactly on the simulated endpoint; a unit test checks this.

Randomness is seeded. Each pitch draws from its own stream, keyed by seed, purpose and pitch number. RETRY INNING therefore replays the same hitters, and the same calls produce the same pitches.

## Hitters
- **Swing probability**: higher in the zone and over the heart of the plate. Out of the zone it decays with distance from the edge and rises with pitch "stuff". Count adjusts it: hitters take at 3-0 and expand the zone with two strikes.
- **Called strikes**: a sharp sigmoid at the zone edge.
- **Whiffs**: depend on stuff and on location. Elevated four-seamers get swung under more often.
- **Fouls**: 7% of two-strike fouls are foul tips, which count as strikeouts.
- **Contact quality**: rises toward the heart of the plate and falls with distance outside it.
- **Batted-ball type and result**: type is driven by the pitch's ground-ball tendency and its height; the result follows contact quality.
- **Base running**: simplified advancement, double plays and sacrifice flies.

Over hundreds of simulated innings, a catcher who follows the plan sees roughly 26–30% strikeouts, 5–9% walks and a BABIP around .29. Middle-middle setups give up about three times as many home runs. Random setups walk about a third of the batters they face.

## Grading
The grade measures **only the catcher's decisions**. The outcome of the pitch never counts. The weights default to 50/50 and can be changed on the review screen.

### Glove targets (location)
1. **Value field.** For each pitch and count, every possible finishing location gets a value:
   - **Plus:** the pitch's preferred corridors (Gaussian bumps).
   - **Plus:** a strike bonus. It is larger with more balls in the count and smaller with two strikes, when the chase is the goal.
   - **Minus:** a penalty for the heart of the plate.
   - **Minus:** a penalty for non-competitive misses.
   - Chase corridors are discounted at three balls and boosted at two strikes.
2. **Expected quality of a target.** Average the value field over the pitcher's miss distribution (bias, covariance and wild component). This uses deterministic 9×9 quadrature, so the same target always gets the same score.
3. **Model-preferred setup.** Search a 0.1 ft grid for the best target, then refine it. This setup is shown only on the review screen.
4. **Score.** A target scores 100 at the preferred setup and 0 at middle-middle, scaled linearly in between.

Because the expected miss is built into the score, the best setup is offset from where the pitch should finish. For example, Fuentes's sinker should be set up glove-side because it runs arm-side, and his changeup higher because it finishes under the glove.

### Pitch usage
Each call has an expected mix: the target usage for that batter hand, multiplied by count modifiers and renormalized. Hitter's counts lean toward fastballs; two-strike counts lean toward put-away pitches.

The called mix is compared with the sum of those expected probabilities using Pearson's X². A Monte Carlo p-value comes from 3,000 seeded simulations of a catcher who follows the plan exactly in the same counts.

The usage score is computed as follows:

score = 100 · clamp(1 + 0.3 · log10(p / 0.5))

Reference points:

| p-value | Score |
| --- | --- |
| ≥ 0.5 | 100 |
| 0.2 | 88 |
| 0.05 | 70 |
| 0.01 | 49 |

Small samples are not punished, because two sliders in two pitches is not evidence against the plan. A batter-hand split that was never faced is not graded. Overall usage is weighted by the number of pitches in each split.

### Feedback
Feedback is generated by rules from the numbers above:
- The largest deviation between called and expected usage in each split.
- Each pitch type's mean offset from the preferred setup, in arm-side and up units, tied to that pitch's miss bias. For example: "Your changeup targets were generally too low given his tendency to miss beneath the glove."
- A takeaway chosen by whether the usage score or the location score was weaker.

## Tests
- `node --test call-the-game/tests/engine.test.mjs`: 14 tests covering the RNG, execution statistics, flight endpoint, rules, hitter model, simulated rates, retry reproducibility, location and usage grading, and feedback.
- `node call-the-game/tests/app.e2e.cjs [shotDir]`: requires `node scripts/serve.mjs` running. It plays full innings on desktop (1440×900), iPhone 13 and iPad Mini — 87 checks.
