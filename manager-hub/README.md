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
```

## Optional AI interpreter

Not connected. To connect one:

1. Deploy `ai-proxy/worker.js` as a Cloudflare Worker (or port it to a Pages Function).
2. Set the secret `ANTHROPIC_API_KEY` and the variable `ALLOWED_ORIGIN` (the site origin).
3. In the app, open **? → Advanced** and enter the Worker's https URL. Or set `window.MH_ASSIST_ENDPOINT` before the scripts load.

- **Security.** The key lives only in the Worker secret. The page refuses anything that looks like a key in that field, and sends only the request text plus a summary of today's groups, library, locations and the draft.
- **Model and cost.** Default model `claude-opus-5-5` at low effort, structured JSON output, server-side refusal fallback. At $4 / $20 per million input/output tokens, a typical request (≈3–5 K tokens in, ≈0.5–1.5 K out) costs about **$0.02–0.05**. Thirty requests a day is roughly $1–1.50 a day. Changing the `MODEL` variable to a smaller model lowers this; that is the owner's call.
- **Changing provider.** Add a function to `PROVIDERS` in the Worker and set `PROVIDER`. The page doesn't change.
