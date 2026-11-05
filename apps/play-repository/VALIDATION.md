# Play Repository — validation report (2026-11-05)

**200 plays published** (50 kept unchanged from earlier publishes, 150 added in this run). Every play has at least one verified, playable MLB clip and core metadata from MLB's official play-by-play.

- Unique events: 200 · unique clips: 208 · clips shared by two plays: 0
- Games: 183 · teams: 31 · seasons: 2024: 92, 2025: 108

## Per category

| Category | Plays | Target | Added this run |
|---|---|---|---|
| Baserunning & advancement | 35 | 35 | 25 |
| Infield defense & decisions | 35 | 35 | 25 |
| Outfield defense, cutoffs & relays | 35 | 35 | 25 |
| Catcher defense & plays at the plate | 25 | 25 | 20 |
| Situational hitting | 25 | 25 | 20 |
| High-leverage & unusual situations | 25 | 25 | 20 |
| Miscellaneous teaching moments | 20 | 20 | 15 |

## Checks applied to every play

1. Game ID (`gamePk`) and play/event ID (`atBatIndex`, event index, Statcast `playId`) from MLB's live feed.
2. Date, teams, venue from the same feed.
3. Inning, half, score, outs and runners **before** the play — rebuilt from the feed by replaying earlier runner movements in the plate appearance.
4. Outcome: MLB's official event, description, every runner movement and fielder credit.
5. Video: MLB.com's clip page exists and declares MLB's embed; the embed answers 200/206.
6. Correspondence: highlight `guid` = the play's `playId`, or Film Room's play info = the play's game, inning, half, outs, runners, batter and pitcher; angle clips without a guid must be identified by MLB's own text (batter or inning + event) and be the only play that fits.
7. Camera angle: High Home only when MLB's own title says so; broadcast feeds labelled by MLB's feed type.
8. Independent cross-check: Baseball Savant's clip page names the same game, batter and pitcher for **177 of 200** plays (stolen bases, pickoffs and other between-pitch events have no Savant pitch clip).
9. Duplicates: one record per event id, and no clip is attached to two different plays.

## Video availability and camera angles

- Primary clip: highlight 174, filmroom 24, high-home 2
- All verified clips by angle: broadcast 203, alternate 3, high-home 2
- High Home: 2 play(s). MLB's 2024–25 video sitemaps contain only two clips MLB labels High Home.

## Spread

- Most common outcomes: single 30, field_out 16, double 15, sac_fly 14, double_play 13, fielders_choice_out 12, sac_bunt 9, force_out 9, strikeout 8, caught_stealing_2b 7
- Base-out states covered: 24 of 24

## Missing fields (not published by MLB for these plays)

- Statcast pitch row (alignment, run/win expectancy change) — between-pitch events have none: 23 play(s)
- batted-ball data: 12 play(s)
- leverage index: 1 play(s)

## Selection log for this run (rejections and replacements)

| Slot | Play | Result |
|---|---|---|
| First to third on a single | mlb-775334-10 | imported |
| Scoring from second on a single | mlb-745354-33 | imported |
| Scoring from first on an extra-base hit | mlb-746651-7 | imported |
| Tagging up on a fly ball | mlb-746324-9 | imported |
| Stolen base | mlb-746547-41-e5 | imported |
| Stealing third | mlb-747135-5-e4 | imported |
| Double steal | mlb-745056-41-e7 | imported |
| Caught stealing | mlb-775319-31 | imported |
| Picked off | mlb-746726-27-e9 | imported |
| Runner thrown out advancing | mlb-776516-10 | imported |
| Rundown | mlb-776536-4 | imported |
| Batter takes an extra base on the throw | mlb-775300-61 | imported |
| First to third on a single | mlb-775327-48 | imported |
| Scoring from second on a single | mlb-746740-18 | imported |
| Scoring from first on an extra-base hit | mlb-777887-21 | imported |
| Tagging up on a fly ball | mlb-746177-32 | imported |
| Stolen base | mlb-744803-30-e1 | imported |
| Stealing third | mlb-778159-21-e1 | imported |
| Double steal | mlb-775337-53-e2 | imported |
| Caught stealing | mlb-813056-62 | imported |
| Picked off | mlb-777513-37-e3 | imported |
| Runner thrown out advancing | mlb-813052-71 | imported |
| Rundown | mlb-813061-30 | imported |
| Batter takes an extra base on the throw | mlb-746584-34 | imported |
| First to third on a single | mlb-776539-37 | imported |
| First and third, ground ball to the middle infield | mlb-777514-27 | imported |
| Ground-ball double play up the middle | mlb-777885-53 | imported |
| Double play started at a corner | mlb-778162-6 | imported |
| Force at home, bases loaded | mlb-775323-40 | imported |
| Runner on third, infield ground ball, play at home | mlb-778256-32 | imported |
| Infield throwing error | mlb-776716-78 | imported |
| Infield fielding error | mlb-747164-18 | imported |
| Bunt defense: out at second or third | mlb-775298-28 | imported |
| Ground ball into a non-standard infield alignment | mlb-745880-58 | imported |
| Tag play on a runner at third | mlb-778264-73 | imported |
| Fielder's choice: getting the lead runner | mlb-775336-9 | imported |
| Infield single | mlb-776724-32 | imported |
| First and third, ground ball to the middle infield | mlb-778247-28 | imported |
| Ground-ball double play up the middle | mlb-775344-29 | imported |
| Double play started at a corner | mlb-744897-20 | imported |
| Force at home, bases loaded | mlb-813024-86 | imported |
| Runner on third, infield ground ball, play at home | mlb-813059-57 | imported |
| Infield throwing error | mlb-777095-63 | imported |
| Infield fielding error | mlb-745448-44 | imported |
| Bunt defense: out at second or third | mlb-745190-13 | imported |
| Ground ball into a non-standard infield alignment | mlb-745304-30 | imported |
| Tag play on a runner at third | mlb-744865-76 | imported |
| Fielder's choice: getting the lead runner | mlb-777092-47 | imported |
| Infield single | mlb-778165-57 | imported |
| First and third, ground ball to the middle infield | mlb-778252-31 | imported |
| Runner on second, one out, single — throw home, out at the plate | mlb-777889-67 | imported |
| Single to right, runner from second thrown out at home | mlb-777883-21 | imported |
| Outfield assist at the plate | mlb-776723-21 | imported |
| Outfield assist at third | mlb-745638-34 | imported |
| Outfield assist at second | mlb-777886-57 | imported |
| Relay throw completes the out | mlb-778254-66 | imported |
| Sacrifice fly to right or center | mlb-746508-63 | imported |
| Single to left, runner scores from second | mlb-776718-15 | imported |
| Extra-base hit down the line: cutoff and relay | mlb-775329-39 | imported |
| Triple: relay to third | mlb-777104-64 | imported |
| Runner tags from second to third on a fly | mlb-747113-3 | imported |
| Single to center with runners on | mlb-747187-21 | imported |
| Outfield assist at the plate | mlb-775309-1 | imported |
| Outfield assist at third | mlb-747070-2 | imported |
| Outfield assist at second | mlb-813058-41 | imported |
| Relay throw completes the out | mlb-777517-19 | imported |
| Sacrifice fly to right or center | mlb-746865-23 | imported |
| Single to left, runner scores from second | mlb-776715-70 | imported |
| Extra-base hit down the line: cutoff and relay | mlb-777890-8 | imported |
| Triple: relay to third | mlb-776535-66 | imported |
| Runner tags from second to third on a fly | mlb-745209-15 | imported |
| Single to center with runners on | mlb-745329-56 | imported |
| Outfield assist at the plate | mlb-778180-17 | imported |
| Outfield assist at third | mlb-746121-19 | imported |
| Outfield assist at second | mlb-813025-70 | imported |
| Catcher throws out a base stealer | mlb-745478-15 | imported |
| Catcher pickoff | mlb-747148-5 | rejected — no unused verified playable clip — filmroom None: page embed no, embed status 0 |
| Tag play at the plate | mlb-777509-33 | imported |
| Wild pitch or passed ball, runner advances | mlb-777086-73-e3 | imported |
| Bunt fielded by the pitcher or catcher | mlb-777080-48 | imported |
| Dropped third strike | mlb-776336-23 | imported |
| Run scores on a wild pitch or passed ball | mlb-746232-24-e3 | imported |
| Catcher's interference | mlb-776349-58 | imported |
| Catcher throws out a base stealer | mlb-777892-18 | imported |
| Tag play at the plate | mlb-776529-71 | imported |
| Wild pitch or passed ball, runner advances | mlb-745431-15-e4 | imported |
| Bunt fielded by the pitcher or catcher | mlb-776342-37 | imported |
| Dropped third strike | mlb-776348-7 | imported |
| Run scores on a wild pitch or passed ball | mlb-776339-46-e2 | imported |
| Catcher throws out a base stealer | mlb-746893-50 | imported |
| Tag play at the plate | mlb-776532-43 | imported |
| Wild pitch or passed ball, runner advances | mlb-813070-38-e4 | imported |
| Bunt fielded by the pitcher or catcher | mlb-747093-73 | imported |
| Catcher throws out a base stealer | mlb-746527-8 | imported |
| Tag play at the plate | mlb-744865-79 | imported |
| Wild pitch or passed ball, runner advances | mlb-777507-49-e2 | imported |
| Sacrifice fly to left | mlb-744830-5 | imported |
| Moving the runner over with nobody out | mlb-746156-33 | imported |
| Two-out RBI single | mlb-745858-8 | imported |
| Sacrifice bunt | mlb-775345-74 | imported |
| Run scores on a ground-ball out | mlb-744994-77 | imported |
| Squeeze play | mlb-745880-80 | imported |
| Sacrifice fly with nobody out | mlb-775333-16 | imported |
| Sacrifice fly to left | mlb-745638-18 | imported |
| Moving the runner over with nobody out | mlb-778160-4 | imported |
| Two-out RBI single | mlb-775343-38 | imported |
| Sacrifice bunt | mlb-777879-72 | imported |
| Run scores on a ground-ball out | mlb-746946-70 | imported |
| Squeeze play | mlb-813072-47 | imported |
| Sacrifice fly with nobody out | mlb-747148-51 | imported |
| Sacrifice fly to left | mlb-777096-17 | imported |
| Moving the runner over with nobody out | mlb-745760-69 | imported |
| Two-out RBI single | mlb-746286-6 | imported |
| Sacrifice bunt | mlb-746041-55 | imported |
| Run scores on a ground-ball out | mlb-777081-67 | imported |
| Sacrifice fly with nobody out | mlb-747096-1 | imported |
| Go-ahead swing late in a postseason game | mlb-813039-66 | imported |
| Walk-off | mlb-746740-82 | imported |
| Extra innings, runner in scoring position | mlb-776721-82 | imported |
| Bases loaded, high leverage | mlb-745344-8 | imported |
| Winning run on base in a walk-off situation | mlb-776338-75-e3 | imported |
| Tying run on base late, high leverage | mlb-745229-49 | imported |
| Go-ahead swing late in a postseason game | mlb-775311-75 | imported |
| Walk-off | mlb-777515-82 | imported |
| Extra innings, runner in scoring position | mlb-813042-79 | imported |
| Bases loaded, high leverage | mlb-745515-42 | imported |
| Winning run on base in a walk-off situation | mlb-746508-80 | rejected — no unused verified playable clip |
| Winning run on base in a walk-off situation | mlb-745209-72 | rejected — no unused verified playable clip — Film Room jose-leclerc-ball-to-julio-rodriguez-5e6c62 mismatch: runners |
| Winning run on base in a walk-off situation | mlb-777508-83 | imported (after 2 rejected) |
| Tying run on base late, high leverage | mlb-746177-65 | imported |
| Go-ahead swing late in a postseason game | mlb-813057-62 | imported |
| Walk-off | mlb-776343-75 | imported |
| Extra innings, runner in scoring position | mlb-746026-88 | imported |
| Bases loaded, high leverage | mlb-745528-5 | imported |
| Winning run on base in a walk-off situation | mlb-776338-78 | imported |
| Tying run on base late, high leverage | mlb-744846-53 | imported |
| Walk-off | mlb-776722-95 | imported |
| Tying run on base late, high leverage | mlb-777514-74 | imported |
| Overturned or upheld on review | mlb-778255-71 | imported |
| Balk | mlb-746554-48-e4 | imported |
| Doubled off | mlb-775316-40 | imported |
| Pop-up with runners on | mlb-776524-11 | imported |
| Strikeout with a runner in motion | mlb-778253-2 | imported |
| Intentional walk to set up a force | mlb-778161-71 | imported |
| Obstruction or interference | mlb-746269-26 | imported |
| Triple play | — | slot exhausted — no further eligible candidate in the scanned games |
| Line drive with runners on, outfield play | mlb-778166-55 | imported |
| Overturned or upheld on review | mlb-777094-67 | imported |
| Balk | mlb-777884-91-e4 | rejected — no unused verified playable clip — Film Room kenley-jansen-ball-to-mookie-betts-rpijjg mismatch: runners |
| Balk | mlb-775339-39-e4 | imported (after 1 rejected) |
| Doubled off | mlb-776333-43 | imported |
| Pop-up with runners on | mlb-813066-24 | imported |
| Strikeout with a runner in motion | mlb-777879-58 | imported |
| Intentional walk to set up a force | mlb-745262-56 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-745689-23 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-777090-43 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-778258-80 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-776526-38 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-775331-57 | rejected — no unused verified playable clip — Film Room john-schreiber-ball-to-giancarlo-stanton-hrgqdg mismatch: runners |
| Intentional walk to set up a force | mlb-813064-31 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-747041-76 | rejected — no unused verified playable clip |
| Intentional walk to set up a force | mlb-775323-39 | imported (after 8 rejected) |
| Obstruction or interference | mlb-777081-6 | imported |

## Camera availability (cameras.py)

| Camera | Plays with verified, playable video |
|---|---|
| Broadcast | 200 |
| High Home | 2 |
| Both | 2 |

High Home plays: mlb-813037-58, mlb-813036-24.

Every play was searched for High Home independently of broadcast: MLB Film Room feeds for its playId, MLB.com clips MLB titles "High Home" (weekly video sitemaps 2024–2026) and the game's MLB.com content list. Film Room's schema defines HIGHHOME, MIDHOME, CF and side-view feed types, but none of the plays here (nor any of 1,500 clips sampled across 2024–2026 regular season and postseason) exposes one publicly; MLB.com has published two High Home clips in that period. Broadcast clips are never labelled High Home, and MLB's "Field View" (a ground-level angle) is never counted as High Home.
