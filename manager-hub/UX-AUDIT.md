# Manager Hub — UX audit (Nov 10 2026)

The audit covers every top-level view and modal at 1440 px and 390 px on a fresh browser with the shipped organisation roster, plus a code review of `apps/manager-hub/index.html` (one file, ~14k lines) and `assistant/`. A fix column says what this round changed; anything not marked was left alone.

## 1. What exists

**Views.**
- Hub
- Daily (Build / Lineup / Print & Export)
- Monthly Planner (Calendar / Activity Library)
- Game Day Documents (Lineup Cards / Dugout Card)
- Playing Matrix
- Pitching Grid
- New: **Camp**

**Modals.** Roster, Resources (Locations / Coaches / Coach Groups), Games, Schedule Assistant (classic), Describe Your Day.

**Data.** There is no database and there are no user accounts.
- Everything is in each browser's `localStorage`, scoped per affiliate as `cs.<aff>.*`. A few keys are global: `cs.affiliate`, `cs.levelmap`, and now `cs.dashboard.v1` and `cs.camp.v1`.
- Access is one shared code per app (Cloudflare gate), so there are **no per-user roles or permissions**.
- Personal preferences can therefore persist **per browser**, not per person across devices. Doing that needs server storage (KV/D1) and real user identity, which is listed under deferred work.

**Players.**
- `RosterRoute.readRoster(aff)` holds `{id, first, last, position, group: pitcher|position, bats, throws, number, level, status, notes}`, one roster per affiliate.
- It is seeded from the shipped `rosters/org-roster.csv` (SL, CC, ASH, FAY, FCL; 153 players).
- There is no MLB or DSL data.

**Scheduling.**
- **Daily:** sections → rows (`S.sections`), saved per date (`cs.sched.<id>`). Also the `SchedulePlanner` + `MHAssist` engines and the Describe Your Day engine (`assistant/day-*.js`).
- **Monthly:** `Month` (per date, Activity Library categories with colours).

**AI.**
- Describe Your Day calls `functions/apps/manager-hub/api/interpret.js` (OpenAI), behind the access gate.
- It is gated by `OPENAI_API_KEY` + `MH_AI_ENABLED` + (production) `MH_AI_PRODUCTION=approved`, with per-IP limits, a timeout and token caps.
- The built-in reader is the fallback. Camp and the dashboard make no AI calls.

## 2. Findings

| # | Pri | Area | Finding | This round |
|---|---|---|---|---|
| 1 | P0 | Roster (phone) | The Player Roster table keeps its 5 fixed desktop columns at 390 px, so the name column shrinks to ~70 px and every row wraps word by word, making the roster unreadable on a phone. | **Fixed:** two-line rows on narrow screens. |
| 2 | P1 | Resources (phone) | Location names are cut to "Field" / "Cage", because the name input is squeezed by four controls. | **Fixed:** the name takes the full row on narrow screens. |
| 3 | P1 | Navigation (phone) | Nine module tabs sit in a horizontal strip; only four are visible, with no hint that the rest exist (Matrix, Pitching, Camp, Roster…). | **Fixed:** edge fade + the active tab scrolled into view, and the Hub lists every module. |
| 4 | P1 | Hub | The Hub is a second copy of the navigation: tiles linking to modules. It does not answer "what's happening today". | **Replaced** with a customizable dashboard: Today, upcoming games, roster availability, month ahead, camp, modules. |
| 5 | P1 | Sample data | A fresh workspace opens on a 2023 sample day. Every affiliate shows "FCL Nationals / FCL Astros / Today's FCL Lineup" (e.g. Corpus Christi), and the Matrix and Pitching grids open in 2026. The notes say the sample is fictional, but it reads as wrong data. | Noted, not changed: replacing seeded content touches saved days. Recommend a "Start a blank day" first-run choice (P2). |
| 6 | P1 | Header | "New day / Open / Save / Generate schedule" appear on every view, including Hub, Monthly, Matrix, Pitching and Camp, where they don't apply. | **Fixed:** day actions show only on the Daily views. |
| 7 | P2 | Desktop chrome | The "Fast keys" card covers the lower-right corner of every view until it is dismissed (e.g. the Lineup "Edit" column, calendar cells). | **Fixed:** it starts collapsed to a small "Keys" button. |
| 8 | P2 | Hub ↔ intro | The "Build a day by describing it" intro card pushes the Hub content down permanently until "Got it". | Folded into a dashboard widget ("Describe your day") that can be hidden. |
| 9 | P2 | Consistency | Three button styles for the same secondary action (outlined, quiet text, pill). The Monthly "Resources…" link is styled like a tab. | Partly: dashboard and Camp use one hierarchy (primary / secondary / quiet). |
| 10 | P2 | Daily (phone) | The Build view's game-context card and upload card take a full phone screen before the first schedule row. | Deferred (P2): collapse the upload card once a day has rows. |
| 11 | P2 | Matrix / Pitching (phone) | Wide grids scroll inside their containers, which is correct, but the first column isn't sticky, so names scroll away. | Deferred (P2). |
| 12 | P2 | Toasts | Toasts sit bottom-left on top of the CP badge on phones. | Deferred (P3). |
| 13 | P2 | Scheduling colour | Category colours exist in the Activity Library (fundamentals red, hitting blue, pitching green, strength purple, meetings amber) but are used only in the Monthly calendar. | Camp and the dashboard reuse the same five colours. Applying them to the Daily builder is deferred (it prints). |
| 14 | P3 | Maintainability | `index.html` is a 14k-line single file mixing styles, markup, engines and views. | New work lives in separate modules (`camp/`, `hub/`). A gradual split is recommended (refactor, deferred). |
| 15 | P3 | Personalization | No per-user identity, so preferences and layouts can't follow a person across devices. | Documented. Needs server storage + identity (deferred, new functionality). |

**Kinds of change.** #1–3, #6–7 improve existing features. #4 and Camp are new functionality. #14 is refactoring. #5, #10–12 and #15 are deferred.

## 3. Changes in this round

See `manager-hub/README.md` → Manager Hub 2.0. In short:

- the customizable dashboard (#4, #8);
- the phone fixes #1–#3;
- contextual header actions (#6) and the Fast keys card limited to the Daily builder (#7);
- the new Camp module.

Open items: #5, #10–#12, #14 and #15. The Daily builder doesn't use category colours yet (#13).
