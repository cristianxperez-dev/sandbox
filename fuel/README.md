# FUEL — Player Nutrition & Performance (CP Systems Sandbox)

Sandbox URL: **https://cperez.app/apps/fuel/** — a working MVP running on **synthetic players only**.

FUEL replaces a nutrition tracking spreadsheet with one persistent record per player: dated weights, DEXA scans,
hydration and protocol records, goals, nutrition notes, follow-ups and performance measurements, all linked by a stable
player ID and kept across seasons and affiliate moves. It is not an analytics platform and not affiliated with or approved
by the Houston Astros. The logo (below) includes the Astros star-H, a club trademark: it is used here as the owner's chosen
identity for an internal prototype on a public sandbox, not as a sign of club approval.

## How it is built

| Part | Where | Notes |
|---|---|---|
| App (static) | `apps/fuel/` | No framework, no build step, no npm dependencies. ES modules. |
| Shared logic | `apps/fuel/shared/` | `model.js` (entities, vocabularies, **role permissions**), `handlers.js` (every request; authorization + redaction + audit), `imports.js` (3 imports), `parse.js` (Quick Entry + legacy notes), `stats.js` (pairing + Pearson), `util.js` (dates, CSV). The same code runs in the browser demo and on the server. |
| Demo store | `apps/fuel/store-idb.js` | IndexedDB `fuel-demo-v1` in the viewer's browser, seeded with `demo-data.js` (fictional). |
| Secure API | `functions/apps/fuel/api/[[path]].js` | Cloudflare Pages Function. **Fails closed (503)** until configured. |
| Server code | `fuel/server/` | `auth.js` (Cloudflare Access token verification, roles from `FUEL_USERS`), `d1store.js` (D1 schema + store). |
| Tests | `fuel/tests/` | `core.test.mjs` (logic), `server.test.mjs` (the real Function on SQLite with signed tokens), `app.e2e.cjs` (browser, desktop + 375/390/430). |

`config.js` selects the mode: `"demo"` (current) or `"secure"`.

## Brand assets (`apps/fuel/brand/`)

All derived from the supplied logo, `source-fuel-logo.jpg` (kept unchanged as the reference), by cropping, resizing
and keying out the background — nothing is redrawn. Regenerate with `python3 fuel/make_brand_assets.py` after
re-creating `fuel-logo.png` (see the script header).

| File | Use |
|---|---|
| `fuel-logo.png` (946×882), `fuel-logo-512.png/.webp`, `fuel-logo-256.png/.webp` | full logo, rounded square, transparent corners — launch / sign-in screen |
| `fuel-lockup.png/.webp` (404×120, shown 36 px tall; 27–30 px on phones) | compact star-H + FUEL lockup, transparent — top navigation |
| `fuel-mark-star.png`, `fuel-wordmark.png` | the two elements on transparent backgrounds |
| `favicon.ico` (16–64), `favicon-32.png`, `favicon-16.png` | star-H mark on a navy tile (the full lockup is unreadable at 16–32 px) |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | full logo on an opaque square of the logo's navy |
| `../logo.png` | the Sandbox homepage card |

## Data model

Every player-linked record carries **`player_id`** — FUEL's permanent internal id (`pl_…`), never derived from a name.
The organizational **Player ID** (`external_id`) is the primary matching key for imports and is unique (enforced in code and
by a unique index in D1). Names are never a definitive match: same-name candidates always go to staff review.

| Entity | Key fields |
|---|---|
| `players` | id, external_id, first/last name, dob, position, bats, throws, height, listed_weight, phone, whatsapp (restricted), status, dietitian, affiliate (current) |
| `assignments` | player_id, affiliate, start_date, end_date — an affiliate move closes one and opens the next |
| `weights` | player_id, **date** (measured), weight, **unit**, note, source, entry_date, created_at/by, voided + reason |
| `dexa` | player_id, date, body_fat_pct, lean_mass, fat_mass, alm, unit, source |
| `hydration` (restricted) | player_id, date, hydration_card, fluid_loss_oz_hr, sodium_loss_mg_hr |
| `protocols` (restricted) | player_id, type (vitamin_d / other), active, details |
| `goals` | player_id, type (weight, body_comp, maintain, preseason, strength, weakness, priority), description, start/target date, status, target_value + unit, progress notes |
| `interactions` | player_id, date, time, type, **text + original_text**, author, goal_id, edit **history** (every earlier version), source |
| `followups` | player_id, description, assignee, due_date, priority, status, completed_date, interaction_id |
| `performance` | player_id, date, metric (bat_speed / exit_velocity / pitch_velocity), value, unit (mph), **definition**, source |
| `quick_entries` | the original text and links to the note / weight / follow-up it created |
| `imports` | batch: kind, file, counts, created ids, prior values of anything changed (for rollback), source rows |
| `audit` | every write and export: who, role, when, what, which player |
| `staff` | name, initials, role |

Rules: measurement date, entry date and created/updated timestamps are separate fields. Missing data stays missing
(e.g. an undated legacy note has `date: null`). Nothing is overwritten: measurements are voided with a reason, note
edits keep prior versions, goals change status but stay in the history.

## Imports (Data → Import)

All three preview first, report row-level errors, skip anything already in FUEL (content fingerprints), record a batch
with its source rows, and can be rolled back by an administrator (refused if staff have since built on the batch).

* **Roster** — `templates/roster-template.csv`. Columns detected and re-mappable. Blank cells never erase values.
* **Legacy nutrition spreadsheet** — `templates/legacy-nutrition-template.csv` (the spreadsheet's exact headings). Mapping:

| Spreadsheet column | FUEL record |
|---|---|
| Last Name, First Name, Position, Affiliate, Mobile Phone, What's App # | player (matched to roster by ID, or confirmed by staff) |
| Date of Current Weight + Current Weight | weight (dated; no date → date unknown) |
| Most Recent DEXA Date, BF%, LM, FM, ALM | DEXA assessment |
| Hydration Card?, Fluid Loss (oz)/HR, Na Loss/HR | hydration assessment (restricted) |
| Vitamin D Protocol? | protocol record (restricted) |
| Goal Weight / Body Comp Goal | goals (weight with numeric target / body composition) |
| Pre-Season Bullets | preseason goal + strength + weakness (labels parsed), or "maintain" |
| History | historical-context note (undated) |
| Nutrition Actions, …Cont..., …Cont...2 | **one note per dated entry**, keeping wording, date, initials and source column; dates without a year use the season year you give, otherwise stay unknown |
| Week 5 Goal Check-In's | check-in note |

* **Performance** — `templates/performance-template.csv`: `player_id,date,metric,value,unit,definition[,source,notes]`.
  Rows must match an existing Player ID (unknown IDs are reported, never created). Units: mph. A different value for an
  existing date + metric + definition is flagged — never written over.

## Security — before any real player data

The sandbox is **not** a place for real players. It runs in the browser, its role switcher is a simulation, and its data
is visible to anyone using that browser. Before real use:

1. **Organizational approval** — the club's data, legal, medical and information-security owners approve the system,
   the data categories (body composition, contact details, nutrition notes, protocols) and the hosting arrangement.
   FUEL has had no compliance review; nothing here claims HIPAA or any other compliance.
2. **Switch on secure mode** (all in the Cloudflare dashboard → the Sandbox Pages project; no code change except `config.js`):
   * D1 database `fuel` bound as **`FUEL_DB`** (tables are created on first request);
   * a **Cloudflare Access** application on `cperez.app/apps/fuel*` (and preview hosts) with the allowed staff;
     variables **`FUEL_ACCESS_ISSUER`** (`https://<team>.cloudflareaccess.com`) and **`FUEL_ACCESS_AUD`**;
   * **`FUEL_USERS`**: `[{"email":"…","role":"dietitian","name":"…","initials":"…"}, …]` — roles admin, dietitian, performance, readonly;
   * set `apps/fuel/config.js` → `mode: "secure"`.
   The Function then verifies the Access token on every request, takes the role from `FUEL_USERS`, enforces it in the
   handlers, redacts restricted fields, rate-limits, sends `no-store`, and audits every write and export.
3. **Consider a dedicated deployment** (its own Pages project / Worker, its own domain or Access policy) rather than the
   shared personal sandbox origin, with D1 Time Travel or scheduled exports as backups and a retention policy.
4. **Exports** leave the protected system — decide who may export (the `export` permission) and where files may be stored.

Role permissions (`shared/model.js`): Administrator — everything incl. rollback and audit log. Dietitian — all nutrition,
protocol, performance and import work, exports. Performance Staff — players, body composition and performance; no notes,
contact details or protocols; performance imports. Read-Only — view (incl. notes), no contact details or protocols, no writes or exports.

## Tests

```
node --test fuel/tests/core.test.mjs fuel/tests/server.test.mjs
node scripts/build.mjs && node scripts/serve.mjs &   node fuel/tests/app.e2e.cjs      # BASE=https://cperez.app/apps/fuel/ for the live site
```
