# Affiliate game schedule import

Source **2027_Affiliate_Schedules.xlsx** (sha256 `74bef39ad5ebc7f7…`, 552 rows; times read as America/New_York). Generated 2026-11-10T20:18:16Z by `manager-hub/tools/import_schedules.py`; dataset version `cd0374d936be4fcd`.

| Affiliate | Workspace | Games | Home | Away | Doubleheaders | TBD times | First | Last | Season |
|---|---|---|---|---|---|---|---|---|---|
| Asheville Tourists (afa) | `ash` | 132 | 66 | 66 | 0 | 0 | 2027-04-02 | 2027-09-05 | 2027 |
| Corpus Christi Hooks (aax) | `cc` | 138 | 69 | 69 | 0 | 0 | 2027-04-02 | 2027-09-12 | 2027 |
| Fayetteville Woodpeckers (afx) | `fay` | 132 | 66 | 66 | 0 | 0 | 2027-04-02 | 2027-09-05 | 2027 |
| Sugar Land Space Cowboys (aaa) | `sl` | 150 | 75 | 75 | 0 | 0 | 2027-03-26 | 2027-09-19 | 2027 |

**552 games imported** from 552 rows. Skipped: 0. Ambiguous: 0.

## Affiliate mapping

Matched by the file's level code, not by team abbreviation (the file's “SL” is the Salt Lake Bees; Manager Hub's `sl` is Sugar Land).

- `aaa` → `sl` (Triple-A)
- `aax` → `cc` (Double-A)
- `afa` → `ash` (High-A)
- `afx` → `fay` (Single-A)
- No rows for the FCL Astros (`fcl`) — none in the file.

## Reading rules

- Times have no AM/PM and are US Eastern: 11:xx = morning, 12:xx = noon, every other hour PM. Stored as an exact instant plus the ballpark's local time (home park for home games, the opponent's park on the road).
- The file's `test` and `Next_Game` columns are not needed: `test` is the same time read by Excel as AM; `Next_Game` (the season game number) is kept as `seq`.
- No row marks a doubleheader, TBD time, postponement, cancellation or exhibition; the importer supports them when a file does.

## Notes

- Double-A “SPR” read as OZK — Ozarks Springbirds (its 2027 code and name in MLB's directory).

## Changes since the previous import

- added 0, updated 0, removed 0

## Check against MLB's published schedule

552/552 games identical to MLB's schedule.

- No differences.
