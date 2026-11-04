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
```

## What changed from the supplied file

`index.html` is the supplied HTML with only these edits (diff it against `baseline/`):

- `<link>` to `assistant/assistant.css` and three `<script>` tags at the end of `<body>`.
- The **✦** header button, the *New day → Plan the day* tile and the hub open the Schedule Assistant. The original planner/transcriber is still one click away as **Classic builder**, and is now titled *Classic Schedule Builder*, because it is rules-based, not AI.
- A **?** help button in the header, and the hub calls `MHAssistUI.hub()` to show the first-use card.
- The sample day's note says its names are fictional.
- The `@font-face` for the licensed Hudson NY Pro font uses `local()` instead of file URLs that 404'd. Its fallback stack was already in use.

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
```

## Optional AI interpreter

Not connected. To connect one:

1. Deploy `ai-proxy/worker.js` as a Cloudflare Worker (or port it to a Pages Function).
2. Set the secret `ANTHROPIC_API_KEY` and the variable `ALLOWED_ORIGIN` (the site origin).
3. In the app, open **? → Advanced** and enter the Worker's https URL. Or set `window.MH_ASSIST_ENDPOINT` before the scripts load.

- **Security.** The key lives only in the Worker secret. The page refuses anything that looks like a key in that field, and sends only the request text plus a summary of today's groups, library, locations and the draft.
- **Model and cost.** Default model `claude-opus-5-5` at low effort, structured JSON output, server-side refusal fallback. At $4 / $20 per million input/output tokens, a typical request (≈3–5 K tokens in, ≈0.5–1.5 K out) costs about **$0.02–0.05**. Thirty requests a day is roughly $1–1.50 a day. Changing the `MODEL` variable to a smaller model lowers this; that is the owner's call.
- **Changing provider.** Add a function to `PROVIDERS` in the Worker and set `PROVIDER`. The page doesn't change.
