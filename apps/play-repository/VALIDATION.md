# Play Repository — validation report (2026-11-05)

**50 plays imported**, every one with at least one verified, playable MLB clip and core metadata checked against MLB's official play-by-play.

## Per category

| Category | Plays | Target |
|---|---|---|
| Baserunning & advancement | 10 | 10 |
| Infield defense & decisions | 10 | 10 |
| Outfield defense, cutoffs & relays | 10 | 10 |
| Catcher defense & plays at the plate | 5 | 5 |
| Situational hitting | 5 | 5 |
| High-leverage & unusual situations | 5 | 5 |
| Miscellaneous teaching moments | 5 | 5 |

## Checks applied to every play

1. Game ID (`gamePk`) and play/event ID (`atBatIndex`, event index, Statcast `playId`) from MLB's live feed.
2. Date, teams, venue from the same feed.
3. Inning, half, score, outs and runners **before** the play — rebuilt from the feed by replaying earlier runner movements in the plate appearance.
4. Outcome: MLB's official event, description, every runner movement and fielder credit.
5. Video: MLB.com's clip page exists and declares MLB's embed; the embed answers 200/206.
6. Correspondence: highlight `guid` = the play's `playId`, or Film Room's play info = the play's game, inning, half, outs, runners, batter and pitcher; angle clips without a guid must be identified by MLB's own text (batter or inning + event) and be the only play that fits.
7. Camera angle: High Home only when MLB's own title says so; broadcast feeds labelled by MLB's feed type (home / away / national / edited highlight).
8. Independent cross-check: Baseball Savant's clip page names the same game, batter and pitcher for **44 of 50** plays (stolen bases, pickoffs and other between-pitch events have no Savant pitch clip).

## Video availability and camera angles

- Primary clip: highlight 45, filmroom 3, high-home 2
- All verified clips by angle: broadcast 51, high-home 2, alternate 1
- High Home: 2 play(s). MLB's 2024–25 video sitemaps contain only two clips MLB labels High Home; both are here if their plays qualified.

## Seasons

2024: 18, 2025: 32

## Missing fields (by design or not published by MLB)

- Statcast pitch row (alignment, run/win expectancy change): 6 play(s)
- batted-ball data: 2 play(s)

## Selection log (rejections and replacements)

| Slot | Play | Result |
|---|---|---|
| First to third on a single | mlb-745994-36 | imported |
| Scoring from second on a single | mlb-745096-13 | imported |
| Scoring from first on an extra-base hit | mlb-746963-59 | imported |
| Tagging up on a fly ball | mlb-776720-31 | imported |
| Stolen base | mlb-776719-59-e1 | imported |
| Stealing third | mlb-813041-36-e5 | imported |
| Caught stealing | mlb-813054-108 | imported |
| Picked off | mlb-813032-8-e6 | imported |
| Runner thrown out advancing | mlb-813071-28 | imported |
| Rundown | mlb-813049-33 | imported |
| First and third, ground ball to the middle infield | mlb-777091-39 | imported |
| Ground-ball double play up the middle | mlb-747041-79 | imported |
| Double play started at a corner | mlb-746269-52 | imported |
| Force at home, bases loaded | mlb-813036-24 | imported |
| Runner on third, infield ground ball, play at home | mlb-746026-93 | imported |
| Infield throwing error | mlb-777882-23 | imported |
| Infield fielding error | mlb-746554-66 | imported |
| Bunt defense: out at second or third | mlb-776722-86 | imported |
| Ground ball into a non-standard infield alignment | mlb-776337-78 | imported |
| Tag play on a runner at third | mlb-777089-6 | imported |
| Runner on second, one out, single — throw home, out at the plate | mlb-776726-55 | imported |
| Single to right, runner from second thrown out at home | mlb-778262-5 | imported |
| Outfield assist at third | mlb-813043-41 | imported |
| Outfield assist at second | mlb-778243-17 | imported |
| Relay throw completes the out | mlb-776340-61 | imported |
| Sacrifice fly to right or center | mlb-777888-71 | imported |
| Single to left, runner scores from second | mlb-746761-65 | imported |
| Extra-base hit down the line: cutoff and relay | mlb-746520-33 | imported |
| Triple: relay to third | mlb-746069-45 | imported |
| Runner tags from second to third on a fly | mlb-776711-42 | imported |
| Catcher throws out a base stealer | mlb-776712-67-e4 | imported |
| Catcher pickoff | mlb-777516-54 | imported |
| Tag play at the plate | mlb-744943-28 | imported |
| Wild pitch or passed ball, runner advances | mlb-745262-65-e1 | imported |
| Bunt fielded by the pitcher or catcher | mlb-776347-75 | imported |
| Sacrifice fly to left | mlb-746797-60 | imported |
| Moving the runner over with nobody out | mlb-744820-72 | imported |
| Two-out RBI single | mlb-745505-48 | imported |
| Sacrifice bunt | mlb-777518-29 | imported |
| Run scores on a ground-ball out | mlb-778253-18 | imported |
| Go-ahead swing late in a postseason game | mlb-813037-58 | imported |
| Walk-off | mlb-777510-66 | imported |
| Extra innings, runner in scoring position | mlb-777879-70 | imported |
| Bases loaded, high leverage | mlb-776341-9 | imported |
| Winning run on base in a walk-off situation | mlb-777508-86 | imported |
| Overturned or upheld on review | mlb-778267-55 | imported |
| Balk | mlb-745422-39-e6 | imported |
| Doubled off | mlb-746112-9 | imported |
| Pop-up with runners on | mlb-746922-68 | imported |
| Strikeout with a runner in motion | mlb-777512-6 | imported |
