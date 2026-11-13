# Manager Hub 3.0 — Spring Training: audit, architecture and workflows (Nov 2026)

## 1. What existed (audit)

| Area | Before 3.0 | Reused? |
|---|---|---|
| Workspaces | Four affiliates + **Complex** (`fcl`). Camp module is a top-level **Camps** tab inside Complex only. | Kept. Spring Training is a **camp type** inside Complex, not a sixth affiliate. |
| Camp module (`camp/`) | Org-wide camps: player pool read from every affiliate roster (never copied), temporary groups, configurable facilities (Florida preset), facility × time grid with drag/resize, agenda, week, templates, copy day, conflict engine, draft → publish with diff, prints, CSV, undo. | Reused as the scheduling core. Spring Training adds tabs and hooks; it doesn't duplicate any of it. |
| Storage | **Everything in each browser's localStorage** (`cs.camp.v1`). One shared access code, no accounts. | The main gap: staff couldn't share a camp. 3.0 adds a shared store. |
| Server | Pages Functions behind the access gate: `api/interpret` (OpenAI, $9/month cap, per-IP limits), `api/settings` (D1, versioned, 409 on conflict). D1 bound as `MH_AI_USAGE` in production. | Same D1 and the same versioned-write pattern for the new store; the same interpreter (new "camp" mode) for Describe the day. |
| Affiliate Playing Matrix / Pitching Grid / Lineup cards | Per affiliate, per season block (position counts, pitching history). | Left unchanged. The Spring Training matrix is camp-level and per game; it uses the same positions and the same printed-card conventions. |
| Daily builder / Describe Your Day | Team-day solver (`day-*.js`), text + voice, AI with built-in reader fallback. | Its single-team model doesn't fit many groups across many facilities, so camps get their own deterministic reader (`st-describe.js`) on the same AI endpoint, budget and fallback rules. |
| Roster status | `ACT`, `60D`, `FSIL`, `RES` from the organisation roster file. | Read as written. Injured-list codes flag a player planned in a game; nothing is invented. |
| Permissions | One access code for everybody. | Smallest safe step: a self-reported "Working as" name/role on every change, plus an optional **coordinator code** (`MH_COORDINATOR_CODE`) that the server requires for approving/publishing. |

## 2. Information architecture

**Workspaces (unchanged):** Triple-A · Double-A · High-A · Single-A · **Complex**.

**Complex → Camps** holds operating contexts: each camp has a **type**:
- Spring Training
- Instructional League
- Offseason development
- Camp / workouts

The camp switcher moves between them. Types with games (Spring Training, instructs) get the game tools. One application, one data model.

**Inside a camp (5 tabs, replacing Schedule · Players · Groups · Staff · Setup):**

| Tab | What it answers |
|---|---|
| **Today** | What's happening, where, which games, what needs attention. One primary action. |
| **Schedule** | Master schedule: facility grid, agenda with a **group view**, week, Describe the day, conflicts, publish, print. |
| **Players & Groups** | The pool and the groups side by side (merged — it's one job). |
| **Games** | Game Play Matrix · Games · Lineups (My Lineups for coaches). |
| **Setup** | Camp details and type, staff, facilities, templates, sharing and history. |

The brief's five areas (Overview · Schedule · Game Play · Rosters & Groups · Lineups) are consolidated:
- **Game Play and Lineups share one tab.** A lineup is a per-game view of the same participation plan. Keeping them together means one click between "who plays" and "in what order".
- **Staff moved into Setup**, because it's configured once.

## 3. Shared data model

Players are always referenced as `<affiliate>:<rosterId>`. Official rosters are never written.

| Document (one D1 row, versioned) | Holds | Who edits |
|---|---|---|
| `camp:<id>` | Camp, type, facilities, staff, players, groups, schedule draft + published snapshot | Coordinators (publishing can require the coordinator code) |
| `games:<campId>` | Games (date, time, opponent, squad/level, home/away/intrasquad, site, **format**: innings, DH, extra hitters, re-entry, pitching notes, rules; lineup coaches; feeding groups; status), **plan** `{game → player → cell}`, **actual** `{game → player → actual}` | Coordinators; actuals by whoever records them |
| `lineup:<gameId>` | The submitted / approved / published lineup, revision number, history | Coaches submit; coordinators approve, return, publish |
| *browser only* `cs.st.draft.<gameId>` | A coach's working lineup and private note | The coach. It never leaves the device. |

**One source of truth per question:**
- Who plays in which game: the **plan** in the Game Play Matrix.
- Batting order and alignment: the **published lineup**.
- What happened: **actuals**.

A lineup changes the plan only when a coordinator approves it, and they see the exact cell changes first. Changing the plan never edits a lineup. Differences are listed in both places.

**Concurrency.** Writes name the version they started from; a newer version answers 409.
- **Camp and games documents** are merged three ways (base · mine · theirs). Independent edits all survive. When both people changed the same value, the version saved first is kept and the other person is told.
- **Lineups are never merged.** A newer lineup is shown for review instead.

**Audit.** `mh_ops_audit` records every write with version, time, name (self-reported) and action. The Setup and lineup screens show it.

**Offline and no database.** Everything keeps working in the browser and is labelled "This browser only" or "Offline — saved here". Pending writes are sent later.

**Migration.** Existing local camps open unchanged. A missing type is read from the name ("Spring Training" → Spring Training, else Camp). Nothing is uploaded until a coordinator chooses **Share with staff**.

## 4. Game Play Matrix

- **Layout.** Rows are camp players grouped Catchers / Infielders / Outfielders & others / Pitchers. Columns are games for one week (or all games). The header and the player column are sticky. Two summary columns: G (planned/played) and Inn (played where recorded, planned for games still to come; IP for pitchers).
- **Cells:**
  - start = solid navy "SS 5"
  - sub = outlined "↺2B"
  - pitch = green "P 2.0·35p"
  - available = grey
  - off = "OFF"
  - an orange dot = came from an approved lineup
  - a green check = played
  - amber underline = planned but didn't play
  - blue underline = played without a plan
  - hatched = canceled game
- **Modes:** Plan · Actual · Plan vs actual.
- **Editing:**
  - Click a cell and type: `ss 5`, `sub 2b`, `p 2`, `p 2.1 35`, `avail`, `off`; Del clears; arrows move.
  - Shift-click selects a range and typing fills it all. Enter or double-click opens the full editor.
  - Column menu: add a group or picked players, copy another game's plan, clear, lineup, actuals, print.
  - Undo with Ctrl+Z.
- **Summary rail** (operational, not analytics):
  - least playing time (under half the median of the players shown, plus how many have none)
  - catcher innings, played and still planned
  - innings by position
  - pitchers: appearances, IP, pitches, last outing, days since, next planned — counts only, no workload rules
  - plan-vs-actual differences
- **Filters:** group, role, level, search, week.
- **Export:** CSV and a landscape print.
- **Phones:** one game at a time, grouped by role, or search a player to see their games.
- **Availability.** Roster injured-list codes (`60D`, `FSIL`, …) are shown on the row and become a conflict when that player is planned. `RES` is a warning. No medical or workload rule is invented.
- **Actuals** are entered after the game, or imported from a CSV (Player, POS, IN, PA, IP, Pitches), which is reviewed before saving. "Fill empty rows from the plan" is an explicit button, labelled to check against the scorebook. A plan is never shown as an appearance.

## 5. Roster and group workflow

1. **Players & Groups:** filter the organization pool (affiliate, role, position, status), multi-select, add to the camp, create groups from the selection, or quick-add preset groups.
2. Groups can overlap. The scheduler expands them to players for conflicts, so a genuine double booking is flagged.
3. The same groups feed:
   - schedule blocks
   - the Schedule's **group view**
   - a game's "feeding groups" (preselected in "Add players to this game")
   - the matrix filter
   - the lineup builder's player list ("This game · + Groups · Whole camp")

   There's one list, so a move shows everywhere.
4. **Today → Groups** shows where each group is now and next. "N not scheduled" lists camp players with nothing that day.

## 6. Coach lineup workflow

1. **Working as.** A coach picks their name once per device. Today leads with "Build lineup — <their game>", and Lineups shows **My games**.
2. **Builder:**
   - batting order slots (tap a player, or drag from the list; ↑/↓ or drag to reorder)
   - position per slot, filled from the plan when it has one
   - pitching plan (starter first, planned IP / pitches, last outing shown)
   - bench and planned substitutions by inning
   - optional innings-by-position grid (its counts become planned innings)
   - the diamond
   - a shared note and a **private note** (device only)
3. **Format-aware.** Innings, DH, extra hitters (extra batting spots) and re-entry come from the game. Nothing has to be complete to save.
4. **Checks** (live, never blocking):
   - duplicate batter or position
   - DH / EH against the format
   - missing starter
   - injured-list status
   - lineup vs plan: not planned, planned but missing, different position, in an overlapping game

   Three or more notes of one kind collapse into one line.
5. **Workflow:** Draft (device) → **Submitted** → **Approved** (optionally updates the matrix, showing every change first) → **Published**. A coordinator can also Return it with a note.
   - Editing after publication starts a revision. The published version stays official until a coordinator publishes again.
   - If another coach submitted after you started, you're asked before replacing it as the version under review; theirs stays in the history.
6. **Output:**
   - **Dugout card:** large type, order / pos / B-T, pitchers, bench, subs, note.
   - **Full game plan:** innings grid plus the game's participation plan.
   - **Participation plan** per game, for game administration.

   Drafts and unpublished versions print watermarked.

## 7. One connected workflow

Groups (Players & Groups) → master schedule (grid, or Describe the day) → plan games (matrix: add a feeding group, set roles) → coaches build lineups (My Lineups) → coordinator reviews, approves into the matrix, publishes → actuals after the game → plan vs actual and playing-time summary.

Today surfaces each step's open items:
- conflicts
- unpublished schedule
- lineups waiting
- games without lineups or players
- games without actuals
- injured-list players planned
- tomorrow not built

## 8. Recommendations (not built)

1. **Individual sign-in.** "Working as" is self-reported. Real per-person accounts (e.g. Cloudflare Access with the club's identity provider) would make private drafts follow a coach across devices and make the audit trail authoritative. The coordinator code is the interim control.
2. **Game import.** Spring Training game schedules aren't in `games.json`. Importing the club's ST schedule file through the existing importer would remove manual entry.
3. **Actuals from game reports.** If the club's game reports export per-player innings/PA/IP/pitches, map that format to the CSV import.
4. **Facility-level printouts** of games, and a **player itinerary** that includes game assignments (the camp itinerary covers workouts only).
5. **Templates for game days** (e.g. "split-squad day") combining schedule blocks and game shells.
6. **Real-time updates.** Polling every 20 s is enough for planning. Lineup review on game day may want push updates (Durable Objects / WebSockets).
7. **Coach review.** Have a coordinator confirm the default roles, labels and Spanish/English needs before Spring Training.

## 9. Deployment notes

- The store uses the D1 binding `MH_AI_USAGE`, which production already has. Tables `mh_ops` and `mh_ops_audit` are created on first use.
- Optional: set the secret `MH_COORDINATOR_CODE` (Production and Preview) to require it for approving/publishing lineups and publishing a shared camp's schedule.
- `GET /apps/manager-hub/access/status` → `ops.coordinatorCodePresent` reports whether it's set (presence only).
- No AI is needed. "Read with AI" in Describe the day uses the existing interpreter, the same $9/month cap and per-IP limits, and falls back to the built-in reader.
