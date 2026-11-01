# APERTURE — QA and security report (Deliverable F)

Date: 2026-11-01. Environment: local `wrangler pages dev` (Workers runtime + local D1) with a local
RS256 token issuer standing in for Cloudflare Access; Chromium via Playwright at 1366/1280 × 900 and
390 × 844. Production Cloudflare configuration could not be exercised from the build environment
(see *Not verified*).

## Implemented

- **Curriculum:**
  - 14 weeks and 60 lessons (≈ 109,800 words of lesson instruction; each lesson runs Explore → Understand → Challenge → Apply → Retain).
  - 15 original cases (14 weekly plus the midterm case) and 14 applied assignments with rubrics.
  - Baseline diagnostic of 32 questions, a midterm of 20 questions plus 8 reassessment questions, and a capstone of 18 components and 7 deliverables.
  - 220 review cards and 259 glossary terms. Planned workload is about 99 hours.
- **Assessment items:**
  - 162 weekly quiz questions, 56 reassessment questions and 131 lesson comprehension checks.
  - Ten question types: mc 130, scenario 41, numeric 40, multi 32, decision 27, research 22, flaw 21, rank 16, short 14, issue 6.
- **Library:** 197 resource records — 170 metadata-confirmed, 27 partially confirmed, 0 unverified. Of these, 71 are open access and 111 are restricted (paywalled or purchase). The research audit covers 15 reference programs, and an auditable source manifest is published at `docs/source-manifest.md`.
- **Labs:**
  - Ten reusable engines: calibration, simulation, design, branching, negotiation, allocation (capital and strategy), org design, stakeholder map, contract issue spotting, composer.
  - The engines power 13 weekly exercises, the Week 5 writing studio and 3 capstone tools.
  - The Strategic Decision Journal tracks forecast calibration.
- **Learning intelligence:** diagnostic-driven foundation support, three modes, Leitner spaced repetition, concept mastery, common errors, calibration, transcript with provenance, and evidence-threshold insights (see `learning-intelligence.md`).
- **Notebook, export and privacy:** notebook with highlights, notes, bookmarks, reflections, drafts and saved concepts. Export as JSON or Markdown, and a "delete all my data" action. Settings cover mode, accessibility, study plan and the learner profile. Continue-in-ChatGPT prompts are built only from public material.

## Tests run and results

| Suite | Result |
| --- | --- |
| Content validator, strict (`compile.mjs --strict`) | Pass — every week, diagnostic, midterm, capstone, audit; all IDs, refs, links, counts, engine configs |
| Lab engine unit tests (t-CDF, NPV/IRR, payback, Pareto frontier, counterpart rules, simulation error rates, text metrics) | 56/56 pass |
| Lab engine end-to-end (harness, every engine at 1280 and 390 px, resume, restart, reveal failure) | 202/202 pass |
| All 16 real exercise configurations mounted in the app, both widths | Pass; no errors, no horizontal overflow |
| API security and function suite (`ap-api.cjs`) | 28/28 pass on a fresh database |
| UI route sweep — 30 routes at desktop and phone width | Pass; no console errors, no failed requests, no horizontal overflow |
| Learner flow — check, highlight + note, quiz, self-assessment, reassessment, assignment + rubric, case reveal, journal, progress, notebook, executive mode | 12/12 pass |
| Sandbox `build.mjs` + `check.mjs` | Pass |
| Functions bundle | Builds; 3.2 MB raw, about 1.0 MB gzip (under the Workers size limit) |

## Access-control verification (all against the running Function)

- No token → 401. Forged signature → 401. Expired token → 401. Wrong audience → 401. Allowlist miss → 401. Valid token → 200.
- Missing `X-Aperture` header → 400. Foreign `Origin` → 403.
- Unconfigured deployment (no D1 / variables) → 503 on every endpoint; page shows "not configured".
- Course source files (`/aperture/content/…`, `/aperture/build/…`, `/aperture/server/…`) are not served (404). `_routes.json` limits Functions to the two app APIs.
- Week, quiz and exercise payloads contain no `answer`, `explanation`, `optionFeedback`, `modelAnswer`, `perspectives` or `key` fields before submission.
- Writes to unknown kinds or unknown lesson IDs → 400. Unknown fields are dropped. Learner HTML is stored and rendered as text.
- Reassessment is refused before a first attempt or after mastery (409). Case perspectives are refused until an analysis of 50+ words is saved (409). "Delete all" requires the exact confirmation phrase.
- The page CSP forbids inline script and inline style and all third-party origins; the app makes no external requests.

## Known limitations

- **Links untested in a browser.** All 197 sources were verified from search results; the build environment could not open pages, so every link is flagged `link-untested` until opened once.
- **Partly confirmed records.** 27 records are partially confirmed — usually a DOI or page range not seen in results. These are listed in the manifest.
- **Fictional names.** Names used in cases were chosen to be unusual. Most were not searched for collisions with real organizations.
- **Public source.** The Sandbox repository is public, so the course source (including answer keys) is readable on GitHub; the deployed app protects it. No personal data is in the repository.
- **Shared origin.** APERTURE shares the `cperez.app` origin with other Sandbox apps (README → Security model).
- **Notes editor.** Notes on highlights use the browser's `prompt()` dialog.
- **Throttles.** These are per edge isolate. Cloudflare Access governs sign-in attempts and session lifetime.
- **Writing feedback.** Writing assignments receive automated format checks and self-assessment only; no content grading by design.

## Not verified here

- The production Cloudflare deployment, D1 binding and Access application (owner setup not yet done).
- `chatgpt.com/?q=` prefill behavior (labelled best-effort in the UI; copy works regardless).
- Real-device testing on iOS/Android browsers (emulated widths only).

## Addendum — public beta (local mode), 2026-11-01

At the owner's request APERTURE launched as a public beta with no sign-in. The same handlers now run
in the browser (`apps/aperture/shared/`, `local.js`); the secure server mode is kept, unchanged in
behavior, for later activation.

| Check | Result |
| --- | --- |
| Static preview (no Functions) — 30 routes, desktop and phone | Pass; no console errors, failed requests or overflow |
| Learner flow in local mode (12 steps) | 12/12 pass |
| All 16 exercise configurations, both widths | Pass |
| Local-mode specifics: no sign-in screen; beta notice; diagnostic scored in browser; progress survives reload; storage keys all `aperture:v1:*`; no third-party requests; no calls to the server API; JSON export; import on a second browser profile; invalid imported records rejected; delete-all clears the browser; blocked storage announced | 15/15 pass |
| Same page on the Workers runtime (`wrangler pages dev`) | Pass |
| Secure server mode after the refactor: unconfigured → 503; configured API suite | 503 confirmed; 28/28 pass |
| Recollect API unaffected (still refuses without configuration) | Confirmed |

**What changes in the beta.** The course bundle (`data/content.json`, about 3.3 MB, served
compressed) and its answer keys are public. Scoring runs in the browser, so results are
self-reported learning data, not secure assessment. Learner data stays in the browser's
`localStorage`; nothing is transmitted. The page's Content-Security-Policy still allows only
same-origin scripts, styles, fonts and connections.
