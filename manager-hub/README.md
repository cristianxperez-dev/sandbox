# Astros Manager Hub — Sandbox build

The app is served from `apps/manager-hub/` (`/apps/manager-hub/` on the site). This folder holds what isn't published:
tests, the reference AI proxy, and the version-controlled baseline.

```
apps/manager-hub/
  index.html                 the app (supplied single-file HTML + a few hook lines)
  logo.png                   card logo, extracted unchanged from the embedded image
  assistant/engine.js        Schedule Assistant: events, time, validation, rotations, diff (pure)
  assistant/commands.js      conversational edits, monthly rules, templates, AI contract (pure)
  assistant/assistant.js     Describe → Review → Publish panel, monthly assistant, voice, help
  assistant/assistant.css
manager-hub/
  baseline/astros-manager-hub-baseline.html   the supplied file with sample names made fictional (see below)
  ai-proxy/worker.js         optional AI interpreter proxy (Cloudflare Worker) — not deployed
  tests/engine.test.mjs      40 unit tests (node --test)
  tests/proxy.test.mjs       5 proxy contract tests (no network)
  tests/app.e2e.cjs          80 end-to-end checks against the real app (Playwright)
  tests/roster-import.e2e.cjs  organisational roster import, fictional fixture (Playwright)
```

## What changed from the supplied file

`index.html` is the supplied HTML with only these edits (diff it against `baseline/`):

- `<link>` to `assistant/assistant.css` and three `<script>` tags at the end of `<body>`.
- The **✦** header button, the *New day → Plan the day* tile and the hub open the Schedule Assistant. The original planner/transcriber is still one click away as **Classic builder**, and is now titled *Classic Schedule Builder*, because it is rules-based, not AI.
- A **?** help button in the header, and the hub calls `MHAssistUI.hub()` to show the first-use card.
- The sample day's note says its names are fictional.
- The `@font-face` for the licensed Hudson NY Pro font uses `local()` instead of file URLs that 404'd. Its fallback stack was already in use.
- **Organisational roster export (Nov 2026).** The roster import also reads the club's export format: `LEVELOFPLAY_LK`, `Last_First` ("Last, First"), `Last_F`, `Handedness`, `Age`, `Position`, `MNROSTERSTATUS_LK`.
  - Level codes `R` FCL · `1F` Fayetteville · `1A` Asheville · `2A` Corpus Christi (new alias) · `3A` Sugar Land (checked against MLB's 2026 affiliate rosters). An unknown code is flagged and blocks the import until someone assigns it.
  - One Handedness column is read as **Throws** for pitchers and **Bats** for position players; the other side stays blank (the file doesn't give it).
  - Roster status codes (`ACT`, `60D`, `FSIL`, `RES`) and age are kept as written; status shows on the roster row and is searchable.
  - Same additive merge as before: matches existing players by name and roster type, skips repeated rows, never deletes anyone missing from the file; re-importing the same file changes nothing.
  - **The organisation roster ships with the app** (owner's decision): `apps/manager-hub/rosters/org-roster.csv`. On opening, Manager Hub fetches it and runs it through the same import (`OrgRoster` in `index.html`): new players are added, blanks are filled in, a coach's edits and hand-entered players are never overwritten, nobody is removed. It runs again only when the file changes (content hash in `cs.orgroster.applied`). To update the rosters, replace the file in the same format and deploy. The file sits behind the access code on the site (401 signed out) and is stripped from the GitHub Pages copy, **but it is readable by anyone on GitHub while this repository is public.** Tests: `tests/org-roster.e2e.cjs` (counts derived from the served file); `tests/roster-import.e2e.cjs` checks the format with fictional players (`tests/fixtures/org-roster-sample.csv`).

The baseline differs from the upload only in the sample data. The seed schedule, the seed coach list, two placeholder examples and the classic builder's example now use fictional names; the initials are unchanged so the sample rows still line up. The unmodified upload is not committed, because this repository is public. Every module, feature and storage key (`cs.*`, per-affiliate) is unchanged.

## Daily scheduling: dates, games and Build Daily Schedule (Nov 2026)

**The five workspaces** are Triple-A (Sugar Land), Double-A (Corpus Christi), High-A (Asheville), Single-A (Fayetteville) and **Complex**. Complex keeps the internal id `fcl`, so the FCL roster, saved days and data are unchanged and no player is reassigned. The organization-wide Camp module lives there as the **Camps** tab (players from every affiliate, temporary groups, fields / cages / bullpens, spring training and instructs, conflict checks); the four affiliates don't show it. Camp data (`cs.camp.v1`) is untouched.

**Dates.** Manager Hub opens on today in the affiliate's own time zone (`Today` in `index.html`, `DateCore` in `games/games-core.js`; Central for Sugar Land / Corpus Christi, Eastern otherwise). Nothing hard-codes a year.
- A new workspace starts on an empty day for today, never the old 2023 sample.
- A new session moves to today; the day that was open goes into the saved list first, so nothing is lost. A refresh in the same tab keeps the date the user picked.
- ‹ Today › beside the Daily date, Today on the Monthly calendar and the planner; "today" markers roll over at midnight.

**Game schedules** (`manager-hub/tools/import_schedules.py`, standard-library Python):
```bash
python3 manager-hub/tools/import_schedules.py manager-hub/schedules/source/2027_Affiliate_Schedules.xlsx --verify-mlb
```
- Writes `apps/manager-hub/schedules/games.json` (shipped with the app) and `manager-hub/schedules/IMPORT-REPORT.md` (counts, mapping, skipped / ambiguous rows, changes, and a game-by-game check against MLB's published schedule).
- The file's level codes map to workspaces (aaa→sl, aax→cc, afa→ash, afx→fay). Times in the file are US Eastern without AM/PM; they are stored as exact instants plus the ballpark's local time. Opponents, ballparks and time zones come from `manager-hub/tools/schedule-teams.json` (MLB's team directory; codes are resolved within the level because COL / WIL / FRE repeat across levels).
- Re-running is safe: stable ids (affiliate · date · game number), so nothing is duplicated; a doubleheader is two games; TBD stays TBD; postponed / canceled / rescheduled are kept when a file says so.
- The app merges the file into every affiliate (`OrgSchedule`, once per version; `games/games-core.js` `merge`): corrections update untouched games, a game a user edited keeps the user's values and shows the schedule's change for review, a deleted game stays deleted, a hand-entered game on the same date is linked instead of duplicated, a game dropped from the file is kept and marked.
- Games show in the Monthly calendar, the Daily view (fixed strip above the schedule), the planner, the Games window (affiliate list · organization board with home / road / off filters · import summary) and the dashboard (Games widget; "Around the organization" is opt-in under Add widget). Moving workouts never changes a game.

**Affiliate page → date → Build Daily Schedule** (`hub/planner.js`). The page leads with the selected date (today by default): its game, its schedule status (No schedule · Draft · Published) and one primary action: **Build Daily Schedule**, or **Edit Daily Schedule** once a schedule exists. The month calendar beside it marks games and schedule status, and every date is tappable. Building offers:
- **Build manually** — the timeline opens with the standard game-day activities timed from first pitch (or, in the Complex on a day without a game, the workout day); **Start empty** opens only the game.
- **Describe your day** — typed; the AI interpreter (or the built-in reader) builds a proposal; the standard activities stay unless the description names them, and the team's own BP takes the BP slot instead of appearing twice.
- **Describe by voice** — the browser's own speech recognition into the same text box (editable before anything is built). No audio is recorded or sent anywhere; unsupported browsers just type.

The builder (`openBuilder` in `assistant/day-ui.js`) is the Describe Your Day timeline — one scheduling engine (`day-solve.js`) for both. Click a block to edit its start, length, name, group and facility in place; drag it to move (5-minute steps) or drag its lower edge to resize; add, duplicate, remove; Undo / Redo; colours from the Activity Library. **Save draft** keeps the plan with the day (`S.meta.dayPlan`); **Publish** goes through the existing review step and writes the rows (re-publishing replaces them). Reopening a day never generates the standard activities again. If the game time changes, the builder offers to recalculate: activities nobody changed follow the new first pitch; customised ones move only if you choose "all". A TBD game asks for first pitch first; a doubleheader asks which game anchors the routine. Times are the ballpark's local time.

**Game Day Defaults** (planner → Game Day Defaults; `games/gameday.js`, `games/gameday-ui.js`). Organization defaults: Home BP 2:30 before first pitch (45 min), Visitor BP 1:45 before (45), Pregame Warmup 0:20 before (10), Anthem 0:10 before (10); plus the Complex workout day (from the existing "Camp" template). Each activity's name, minutes before first pitch (or start time), length, facility and on / off can be changed, for the organization or as an override for one affiliate. Stored on the server — `functions/apps/manager-hub/api/settings.js`, table `mh_settings` in the D1 database bound as `MH_AI_USAGE` (created on first use), versioned so two people can't silently overwrite each other. Without the database the built-in defaults apply and edits stay in that browser (the window says so). There are no per-user roles (one shared access code), so anyone signed in can change them.

## Manager Hub 2.0

Audit and priorities: [`UX-AUDIT.md`](UX-AUDIT.md).

- **Dashboard (Hub).** `apps/manager-hub/hub/dashboard.js` + `dashboard.css` replace the Hub's tile grid with widgets built from existing data:
  - Day schedule
  - Describe your day
  - Roster & availability
  - Upcoming games
  - Next 7 days
  - Camp
  - Modules

  **Customize** turns on an editing mode: drag by the handle (pointer events, so mouse and touch), or use the ← / → buttons or arrow keys on a focused handle. You can also change the width (Small / Medium / Large / Full), hide a widget, add it back, or reset to the default. The controls disappear outside editing mode.
  - The layout is saved per browser in `localStorage["cs.dashboard.v1"]`, shared across affiliates in that browser.
  - Manager Hub has no user accounts (one shared access code), so a layout cannot follow a person to another device. That needs server storage plus individual sign-in (deferred).
  - New widgets appear automatically for existing layouts. A corrupt preference falls back to the default.
- **Audit fixes:**
  - phone layouts for the roster and Resources;
  - a scroll hint and active-tab scrolling for the module strip on phones;
  - day actions (New day / Open / Save / Generate) hidden where they don't apply;
  - the Fast keys card limited to the Daily builder.
- **Camp** (top-level tab; `apps/manager-hub/camp/`: `camp-core.js` pure logic, `camp.js` view, `camp.css`). Organisation-wide camps and workouts:
  - **Camps.** Each camp has a name, location, timezone, dates, notes and a day window. There is a Florida-complex facility preset; facilities are fully editable, each with a type, a player capacity and how many activities may share it at once. Staff can be free text or picked from the affiliates' coach lists.
  - **Players.** The pool is every affiliate roster, read-only through `RosterRoute.readRoster`. Players are never copied, and their affiliate assignment never changes. Search and filters cover level, role, catcher, position, throws, bats, status and camp group, with multi-select (shift-click, select all filtered). Temporary camp groups can overlap.
  - **Schedule.** Three views:
    - a facility grid (drag to move or change facility, drag the edge to resize, keyboard alternatives);
    - an agenda, which is the default on phones;
    - a week overview.
  - **Reuse.** Duplicate an activity or a day, copy a day to a date or range, and save or apply templates.
  - **Conflicts.** Errors: a player or staff member double-booked (groups are expanded to players), a facility double-booked or over capacity. Separate informational warnings. Nothing blocks saving.
  - **Draft and publish.** Publish shows a diff first. Printouts (daily grid, coach, player itinerary, facility) and CSV use the published version; a printed draft is watermarked DRAFT. Undo covers the last 40 edits.
  - **Storage.** Data lives in `localStorage["cs.camp.v1"]` (org-wide, per browser). Times are minutes in the camp's own timezone. Unreadable data is backed up before recovery.
  - No AI calls. The Camp tab, its dashboard widget and its module entry appear only when `camp.js` sets `CampUI.ready`.
  - Only the five affiliates' rosters exist in Manager Hub (no MLB or DSL data). Camp lists what is there and invents nothing.
- Tests: `tests/dashboard.e2e.cjs`, `tests/camp-core.test.mjs`, `tests/camp.e2e.cjs`.

## Manager Hub 3.0 — Spring Training (Nov 2026)

Audit, architecture and workflows: [`ST-AUDIT.md`](ST-AUDIT.md).

- **Where it lives.** Spring Training is a camp **type** inside the Complex workspace. The types are Spring Training, Instructional League, Offseason development and Camp / workouts. It is not a sixth affiliate.
- **Camp tabs:** Today · Schedule · Players & Groups · Games · Setup.
- **Code:**
  - `apps/manager-hub/st/`:
    - `st-core.js` — pure logic: games, plan/actual, summaries, lineups, workflow, merge
    - `st-describe.js` — Describe the day reader
    - `st-sync.js` — shared-store client
    - `st.js` — UI, plugged into Camp through `CampUI.extend`
    - `st.css`
  - Server: `functions/apps/manager-hub/api/ops.js`, which stores versioned documents with an audit trail on the D1 binding `MH_AI_USAGE`.
  - `interpret.js` gained a `camp` mode, under the same budget and fallback rules.
- **Sharing:**
  - A camp stays in the browser until a coordinator chooses **Share with staff**. After that every save goes to the server, the camp is re-read every 20 s, and conflicting writes are merged three ways. A true clash keeps the first-saved value and tells the other person.
  - Coaches' lineup drafts and private notes never leave their browser.
- **Roles:** names are self-reported ("Working as"). Set the secret `MH_COORDINATOR_CODE` to require it for approving, returning and publishing lineups and for publishing a shared schedule.
- **Tests:**
  - `node --test manager-hub/tests/st-core.test.mjs` — core, reader, store
  - `node manager-hub/tests/st.e2e.cjs` — 94 checks: coordinator + two coaches + tablet + phone on one store, 160 fictional players
  - `SHOTS=dir` writes screenshots.

## Describe Your Day

The **✦ Assistant** button opens it. You describe the day in a few sentences ("10 AM stretch, 1 PM game. Team fundy, indy defense. 30-minute BP rounds and 30 minutes off pregame."), then:

1. You get a timeline by track: team, position players, pitchers. Fixed times are solid, flexible blocks outlined, time off shaded, and blocks Manager Hub added are dashed.
2. It shows what it assumed and anything that won't fit. A day that won't fit comes with numbers and one-click alternatives.
3. You refine in plain language ("shorten fundy to 20", "add a second BP group"), or use −5 / +5 / Earlier / Later / Pin on any block. Undo and redo are available.
4. **Review & save** goes through the Schedule Assistant's publish step, so you see the diff and any removal warnings, and the app's Undo works. The day's structure is saved with it (`meta.dayRequest`), so "same as yesterday but…" can build on it.

The classic assistant (groups, rotations, templates, monthly planning) is one click away and unchanged.

Design and audit: [`DAY-ENGINE.md`](DAY-ENGINE.md). Code: `apps/manager-hub/assistant/day-*.js`.

- **Reading the request.** Two interpreters produce the same structured request, which is schema-validated:
  - **Built-in reader** (`day-read.js`): a deterministic baseball lexicon. Offline, always available, and labelled as such in the panel.
  - **AI interpreter** (`functions/apps/manager-hub/api/interpret.js`): a server-side model call with a structured-output schema, behind the Manager Hub access code. It reads language only and never sets times. Its output is validated on the server and again in the page. If anything is malformed, or the service is off, the built-in reader runs and the panel says so.
- **Scheduling** (`day-solve.js`, `day-kb.js`) is deterministic and needs no model:
  - anchors, buffers and hard stops;
  - phase ordering (warm-up before throwing, defense and hitting; BP before the pregame break);
  - parallel pitcher and position tracks, with field and cage capacity;
  - fill and compress within the window;
  - conflicts with tested alternatives.
- **Refinements** become edit operations on the request, never on rows, so unaffected items keep their constraints.

### Switching on the AI interpreter (OpenAI)

The interpreter uses the OpenAI **Responses API** with strict Structured Outputs. It runs only server-side, in `functions/apps/manager-hub/api/interpret.js`, behind the Manager Hub access code. It is on only when:

- `OPENAI_API_KEY` (Cloudflare **Secret**) is present, and
- `MH_AI_ENABLED` = `1`, and
- **on production hosts** (cperez.app, the project's main `pages.dev` address, or any host not recognised as a preview), also `MH_AI_PRODUCTION` = `approved`. This is the owner's explicit go-ahead, and
- a **D1 database bound as `MH_AI_USAGE`** is present: the monthly spending limit below. Without it spending can't be tracked, so AI stays off (status reason `no-budget-store`).

So `MH_AI_ENABLED=1` in Production cannot switch AI on for cperez.app by itself. The rule lives in `manager-hub/server/ai-config.js`.

**Check any deployment.** `GET /apps/manager-hub/access/status` reports which settings are present (booleans only, never values), plus whether AI is active and why. Examples: `https://cperez.app/apps/manager-hub/access/status` for Production, `https://<branch-alias>.sandbox-34x.pages.dev/apps/manager-hub/access/status` for a preview.

**Preview testing.**
- Cloudflare → Workers & Pages → sandbox → Settings → Variables and Secrets → **Preview** needs:
  - `MANAGER_HUB_ACCESS_CODE` and `SANDBOX_SESSION_SECRET` (the gate fails closed without them);
  - `OPENAI_API_KEY`;
  - `MH_AI_ENABLED=1`.
- Redeploy the preview after changing variables.
- On preview hosts only:
  - the gate also accepts the access code in an `X-MH-Access-Key` header, so an egress proxy can inject it for automated runs;
  - the endpoint accepts a per-request `model` / `effort` from `MH_AI_MODELS` (default `gpt-6-luna,gpt-6.1-sol`).

**Evaluation against a preview:**
```bash
MH_EVAL_BASE=https://<branch-alias>.sandbox-34x.pages.dev/apps/manager-hub/ MH_EVAL_INTERPRETER=ai \
  MH_EVAL_SET=all MH_AI_MODEL=gpt-6-luna MH_EVAL_REPORT=luna.json node --test --test-concurrency=1 manager-hub/tests/day-eval.test.mjs
node manager-hub/tests/eval-compare.mjs reader.json luna.json
```
The GitHub workflow *Describe Your Day — AI evaluation* is optional. It runs the endpoint code on a runner and only then needs a repository secret `OPENAI_API_KEY`.

**Model:** `gpt-6-luna`, the least expensive OpenAI model, is the default everywhere (owner's decision, Nov 10 2026). There is no automatic fallback: if Luna is unavailable, the panel uses the free built-in reader. A fallback set in `MH_AI_FALLBACK_MODEL` is used only when it costs no more than the main model.

**Variables:**
- `MH_AI_MODEL`: overrides the model. Leave it unset to use Luna; setting it to a more expensive model is a manual upgrade.
- `MH_AI_EFFORT`: `low` (default), `medium`, `high` or `none`.
- `MH_AI_RATE`: requests per IP per 10 minutes, default 20.
- `MH_AI_DAILY`: requests per IP per day, default 150.

**Cost controls and safety:**
- Output is capped at 6,000 tokens for a build and 3,000 for a refinement.
- Request text is at most 1,500 characters, and each call has a 25 s timeout.
- Per-IP limits are best effort. `store: false` is set, and the stable instructions come first so OpenAI's prompt caching applies.
- **Monthly spending limit ($9.00 estimated, server-side; `manager-hub/server/ai-budget.js`).**
  - Before every OpenAI call the server reserves the call's worst case: the whole prompt at the uncached price plus the full output allowance. It does this in one conditional D1 update, so concurrent requests can't overshoot. A call that would pass $9.00 for the UTC calendar month is refused (HTTP 402 `budget-reached`) and never reaches OpenAI.
  - After the call, the reservation is replaced by the cost computed from the tokens OpenAI reports. A timeout or network failure is charged the full reservation; an error with no usage is charged nothing.
  - Fails safe: no binding, a database error, or a model without a known price → no AI call. The panel uses the built-in reader and says why.
  - `MH_AI_BUDGET_USD` can lower the cap, never raise it. `MH_AI_PRICES` (JSON, `{"model":[input, cached, output]}` in USD per 1M tokens) updates prices without a code change.
  - The Describe Your Day panel shows **AI this month: $x of $9.00 (est.)**; `GET /apps/manager-hub/api/usage` (behind the access code) returns the figures.
  - **Setup:** Cloudflare → Storage & Databases → D1 → create a database (e.g. `manager-hub-ai-usage`). Then Workers & Pages → sandbox → Settings → Bindings → add D1 binding `MH_AI_USAGE` → that database, in **Production** and **Preview** (the same database, so both count against one limit). Redeploy. The table is created on first use.
  - **Prices** (OpenAI Standard tier, per 1M tokens, from developers.openai.com/api/docs/pricing on Nov 10 2026): `gpt-6-luna` $0.10 input, $0.01 cached input, $0.50 output, $0.125 30-minute cache write; `gpt-6.1-sol` $2.00 / $0.10 / $10.00 / $2.50. Uncached input is counted at the cache-write price (the higher one), so the estimate errs high.
  - **Limits of the estimate.** The figures are estimates from token counts × the list prices above; OpenAI's invoice is the authority. Usage of the same OpenAI key outside Manager Hub isn't counted. The OpenAI **project budget / usage limit** remains the final backstop.
- A failed or invalid AI answer never touches the schedule. The panel falls back to the built-in reader and says so (**Built-in reader · AI unavailable**). Nothing is written until **Review & save**.
- The key is never sent to the browser, logged or returned. Logs hold mode, status, model, tokens and latency only.

### Evaluation

- `tests/day-eval.test.mjs`: 103 realistic scenarios in 15 categories, written independently of the implementation. It judges baseball usefulness, not just shape:
  - stated times kept, buffers exact, hard stops respected;
  - stretch first, BP before the pregame break;
  - no overlaps, nothing invented;
  - conflicts explained in numbers;
  - refinements leave everything else alone;
  - undo/redo restores exactly.
- Built-in reader: **103 / 103** on the core set.
- `tests/day-fresh-scenarios.mjs` is a *fresh* benchmark of 32 unfamiliar conversational prompts the reader was never tuned on (run with `MH_EVAL_SET=fresh`). The built-in reader scores about 56% there; it is the benchmark the AI interpreter must beat.
- AI interpreter: measured against a preview (see above); results in `DAY-ENGINE.md`.
- Also: `tests/day-read.test.mjs`, `tests/day-solve.test.mjs`, `tests/interpret.test.mjs` (endpoint contract, model mocked) and `tests/day-ui.e2e.cjs` (the panel in the app, desktop and phone).
- **Limits of the built-in reader.** It handles common coaching shorthand and phrasing. Unusual wording can still land in "Not understood", which the panel always lists rather than dropping. That long tail is what the AI interpreter is for.

## Affiliate branding

Fixed, not editable in the app. One config, `AFFILIATES` in `apps/manager-hub/index.html`, holds each club's name, level, logo and colours; `Brand.apply` paints them as `--aff-*` CSS variables.

| Club | Level | Logo | Primary | Secondary | Accent | On the navy masthead |
|---|---|---|---|---|---|---|
| Sugar Land Space Cowboys | Triple-A | `brand/sl.png` | `#0E253A` navy | `#25C9D1` teal | `#E47D3C` orange | teal |
| Corpus Christi Hooks | Double-A | `brand/cc.png` | `#002A5B` navy | `#4F91CD` light blue | `#E01938` red | light blue |
| Asheville Tourists | High-A | `brand/ash.png` | `#002B5C` navy | `#86CEBC` jade | `#005695` blue | jade |
| Fayetteville Woodpeckers | Single-A | `brand/fay.png` | `#D31245` red | `#000000` black | `#5F6062` gray | red |
| FCL Astros | Rookie · Florida Complex League | `brand/fcl.svg` | `#002D62` navy | `#EB6E1F` orange | — | orange |

- **Logos** are the supplied files. The Hooks' primary mark was cut from the supplied logo sheet, and the Woodpeckers' white page was removed. Both use a flood fill from the edge with the outline colour unmixed, so the artwork itself is unchanged. The Space Cowboys and Tourists files were already transparent and are only trimmed. The FCL Astros use the supplied Astros SVG as-is.
- **Colours** are the exact values in those files. Hooks, Tourists, Woodpeckers and Astros are flat-colour artwork. Sugar Land's teal and orange are the most common values in its logo, whose edges are antialiased.
- **Tourists caveat:** the supplied alternate (cap) logo uses slightly different values (`#0C2340`, `#6ECEB2`, `#236192`). The primary logo's colours are used so the interface matches the logo it shows. No club publishes hex values I could verify online.
- **Where they appear:**
  - affiliate selector;
  - header switcher and its menu;
  - hub masthead and module tiles;
  - roster header;
  - masthead stripe and active module tab;
  - Build / Lineup / Print tabs, roster tabs, and the calendar's selected day and today marker;
  - the printed schedule header (club logo + Astros; MiLB for the FCL Astros), lineup card and dugout card.

  The Astros orange stays on the main actions.
- **Removed:** the Affiliate Branding editor (name, level, colour pickers, logo upload, restore defaults), its hub tile and menu entry, and the sheet's Left logo / Right logo upload. The old overrides in `cs.brand` and any logo uploaded into a schedule (`meta.logoL/logoR`) are ignored but left in storage. Nothing is deleted.
- Tests: `tests/branding.e2e.cjs`.

## How the Schedule Assistant works

Request → **interpretation** → structured intent → **deterministic engine** (plan, rotate, validate, diff) → review → publish.

- **Interpretation.** The built-in reader (`commands.js` plus the original `SchedulePlanner`) works offline. An optional AI service can take over the wording only. It returns JSON in `INTERPRETATION_SCHEMA`, which the page validates field by field and then runs through the same parser and operations. A malformed reply falls back to the built-in reader, and the header chip says so.
- **Engine.**
  - Scheduling uses the app's existing constraint solver (Library durations, Resources capacities, the monthly plan).
  - Exact Latin-square rotations are built for "N groups rotate through …".
  - Edits are explicit operations (`shift`, `setStart`, `setDur`, `extend`, `setLoc`, `setStaff`, `rename`, `remove`, `add`, `swapGroups`, `swapTimes`, `indoor`), each reported as a before → after diff.
- **Data.** Events map 1:1 onto the existing rows: `time`, `timeEnd`, `activity`, `detail`, `location`, `staff` and `notes`, plus optional `row.ev` = `{dur, flex, source, confidence, rotation, parent, flags}`, which the rest of the app ignores. Publishing is one `mutate()`, so the app's own Undo, autosave, JSON export, the Player and Leadership views and print/PDF all see it.

## Tests

```bash
node scripts/build.mjs && node scripts/serve.mjs &     # http://127.0.0.1:4173/
node --test manager-hub/tests/*.test.mjs                 # unit + proxy contract
node manager-hub/tests/app.e2e.cjs                       # real app, Playwright (BASE=… to target another host)
node manager-hub/tests/roster-import.e2e.cjs             # roster import (fictional players)
node manager-hub/tests/branding.e2e.cjs                  # fixed affiliate logos and colours
node --test manager-hub/tests/day-*.test.mjs manager-hub/tests/interpret.test.mjs manager-hub/tests/budget.test.mjs   # Describe Your Day: reader, solver, 103-scenario evaluation, AI endpoint, spending limit
node --test manager-hub/tests/gameday.test.mjs          # game-day defaults, settings endpoint, game merge rules, dates
node manager-hub/tests/builder.e2e.cjs                   # affiliate page → date → Build Daily Schedule, drafts, recalculation, Complex, phone
node manager-hub/tests/day-ui.e2e.cjs                    # Describe Your Day panel in the app
node manager-hub/tests/org-roster.e2e.cjs                # shipped organisation roster (needs the gate: MH_ACCESS_CODE, BASE)
```

## Optional AI interpreter

Not connected. To connect one:

1. Deploy `ai-proxy/worker.js` as a Cloudflare Worker (or port it to a Pages Function).
2. Set the secret `ANTHROPIC_API_KEY` and the variable `ALLOWED_ORIGIN` (the site origin).
3. In the app, open **? → Advanced** and enter the Worker's https URL. Or set `window.MH_ASSIST_ENDPOINT` before the scripts load.

- **Security.** The key lives only in the Worker secret. The page refuses anything that looks like a key in that field, and sends only the request text plus a summary of today's groups, library, locations and the draft.
- **Model and cost.** Default model `claude-opus-5-5` at low effort, structured JSON output, server-side refusal fallback. At $4 / $20 per million input/output tokens, a typical request (≈3–5 K tokens in, ≈0.5–1.5 K out) costs about **$0.02–0.05**. Thirty requests a day is roughly $1–1.50 a day. Changing the `MODEL` variable to a smaller model lowers this; that is the owner's call.
- **Changing provider.** Add a function to `PROVIDERS` in the Worker and set `PROVIDER`. The page doesn't change.
