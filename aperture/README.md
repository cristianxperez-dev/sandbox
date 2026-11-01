# APERTURE — The Applied Intelligence Academy

A graduate-level executive-education environment inside Sandbox, live at
`https://cperez.app/apps/aperture/` as a **public beta** (no sign-in).
Semester I: *Foundations of Human Behavior, Evidence & Executive Leadership* (14 weeks).
Independent learning program: no academic credit, accreditation or university affiliation.

## Where things live

| Path | What | Published as a static file? |
| --- | --- | --- |
| `apps/aperture/` | The page: HTML, CSS, JavaScript (`shared/` = scoring and progress logic used by both modes), fonts, logo, and `data/content.json` (public beta course bundle). | Yes (Cloudflare Pages and the GitHub Pages mirror) |
| `functions/apps/aperture/api/[[path]].js` | The protected API (Cloudflare Pages Function). | No |
| `aperture/server/` | API implementation: auth, content index, grading, D1 storage, spaced repetition, insights. | No |
| `aperture/content/` | Course source: weeks, sources, diagnostic, midterm, capstone, audit, labs (`SCHEMA.md`, `ENGINES.md`). | No (but see *Repository visibility*) |
| `aperture/build/content.json` | Compiled course bundle imported by the API. Generated — never hand-edit. | No |
| `aperture/docs/` | Deliverables: research audit, source manifest, QA/security report, roadmap. | No |
| `aperture/tools/` | `validate.mjs` (content rules), `compile.mjs` (build + manifest). | No |

Editing content: change files in `aperture/content/`, then

```bash
node aperture/tools/compile.mjs          # validates, then writes aperture/build/ and docs/source-manifest.md
node scripts/build.mjs && node scripts/check.mjs
```

`node aperture/tools/compile.mjs --check` fails if the committed build is stale (the deploy workflow runs it).

## Deployment modes

`apps/aperture/config.js` selects the mode.

| | **Public beta — `local` (current)** | **Secure accounts — `server` (future)** |
| --- | --- | --- |
| Access | Anyone with the URL; no sign-in | Cloudflare Access sign-in, email allowlist |
| Course content | `apps/aperture/data/content.json`, public (answer keys included) | Bundled into the Pages Function; keys released only after submission |
| Scoring, review schedule, insights | In the browser (`apps/aperture/shared/` via `local.js`) | On the server (same `shared/` code via the Function) |
| Learner data | This browser only (`localStorage`, keys `aperture:v1:*`) | Cloudflare D1, per signed-in email, cross-device |
| Setup needed | None | D1 + Access + three variables (below) |

The grading, scheduling, progress and validation logic is one shared implementation
(`apps/aperture/shared/handlers.js`) used by both modes, so switching modes changes where it runs,
not what it does.

**Public beta limits (stated in the app).** Progress is device- and browser-specific and is lost if
site data is cleared, in private browsing, or on another device; learners can export a JSON backup
and import it elsewhere (imported records are re-validated). Scoring runs in the browser and the
answer keys ship with the page, so assessments are learning exercises, not secure examinations.
Nothing the learner writes leaves the browser; there are no accounts, cookies, analytics or
third-party requests.

**Switching to secure accounts later.** Complete the one-time setup below, set
`window.APERTURE_CONFIG = { mode: 'server' }` in `config.js`, and (to keep the keys private again)
stop publishing `apps/aperture/data/` by removing its write in `aperture/tools/compile.mjs`.
Learners bring their beta progress across with Settings → Export, then Import (an import endpoint
for server mode is on the roadmap).

## Security model (secure-accounts mode)

- **Every lesson, reading, question, case, lab configuration and every learner record is served
  only by the API**, which verifies a Cloudflare Access token on every request (RS256 signature
  against the team's published keys, issuer, audience, expiry, not-before) and checks the email
  against an allowlist. Access in front of the path is not trusted on its own: requests to
  `*.pages.dev`, preview deployments or any other hostname are refused without a valid token.
  This is the same model as Recollect.
- **Fails closed.** Without the D1 binding and the three variables below, every API request
  returns 503 and the page shows "not configured". Nothing is served by default.
- **No secrets in the repository or the browser.** The page holds no access code, token or key.
  Session lifetime and sign-in rate limiting are Cloudflare Access's (configure the session
  duration on the Access application; 24 hours is a sensible choice). The API adds per-isolate
  throttles (900 requests / 5 min, 300 writes / 5 min, 120 submissions / 10 min per identity).
- **Same-origin JSON only.** Requests must carry `X-Aperture: 1` and a matching `Origin`.
- **Server-side validation.** Answer keys, hidden exercise material (`key`), case teaching notes
  and model answers never leave the server before submission. Grades, mastery and the review
  schedule are computed on the server; the browser cannot write attempts or review boxes.
  Every learner record is validated by kind (`aperture/server/kinds.js`): known keys only,
  types and sizes bounded, unknown fields dropped. All SQL is parameterized and filtered by the
  signed-in email.
- **Rendering.** Authored text goes through an escape-first inline renderer; learner text is
  only ever set as text. A strict Content-Security-Policy (`script-src 'self'`, `style-src 'self'`,
  `connect-src 'self'`, no inline script or style) is set on the page.
- **Privacy.** No analytics, no third-party scripts, no external requests. "Continue in ChatGPT"
  builds a prompt from public course material; learner text is included only when the learner
  ticks the box, and nothing is sent unless the learner copies it or opens ChatGPT.
  The learner profile is entered in Settings and stored only in D1 — it is not in the repository.
- **Shared origin.** Like Recollect, APERTURE shares the `cperez.app` origin with the other
  Sandbox apps. Their code is the owner's, but a script in another app on the same origin could
  call the API on the signed-in user's behalf. Moving APERTURE to its own subdomain would isolate it.

### Repository visibility

The Sandbox repository is public on GitHub. The **deployed** content is protected, but the course
*source* in `aperture/content/` (original lesson text, questions and answer keys, cases) is
readable by anyone who browses the repository. It contains no personal data: the learner's
profile, progress, notes, journal and results exist only in D1. If the curriculum itself should be
private, make the repository private (Cloudflare Pages keeps deploying; the GitHub Pages mirror
needs a paid plan for private repositories) or move APERTURE to a private repository.

## One-time setup for secure accounts (Cloudflare dashboard — owner action, not needed for the beta)

Until this is done the server API answers 503 to everything (it is not used by the public beta).

1. **D1:** Workers & Pages → D1 → *Create database*, name `aperture`.
2. **Binding:** the Sandbox Pages project → Settings → Bindings → *Add* → D1 database, variable
   name `APERTURE_DB`, database `aperture`, for **Production** (add a separate database for
   Preview if you want previews to work).
3. **Access:** Zero Trust → Access → Applications. Either add the path `apps/aperture/api` to the
   existing self-hosted application that protects Recollect (then reuse its AUD tag), or create a
   new self-hosted application: domain `cperez.app`, path `apps/aperture/api`, policy *Allow* →
   your email, session duration of your choice. (Protecting only the `api` path keeps the Sandbox
   card logo public; the page shell contains nothing private. You may protect `apps/aperture`
   entirely if you prefer.) Copy the application's **Audience (AUD) tag**.
4. **Variables** (Settings → Variables and Secrets, Production):
   - `APERTURE_ACCESS_ISSUER` = `https://<your-team>.cloudflareaccess.com`
   - `APERTURE_ACCESS_AUD` = the AUD tag from step 3
   - `APERTURE_ALLOWED_EMAILS` = your email address (comma-separate several)
5. **Redeploy** (Deployments → latest → *Retry deployment*), open
   `https://cperez.app/apps/aperture/`, choose **Sign in**.

The tables are created on first use; deploys never touch them. D1 Time Travel restores the
database to any minute in the last 30 days (7 on the Free plan).

## Testing locally

`npx wrangler pages dev _site --d1 APERTURE_DB=local` with the three variables passed as
`--binding NAME=value` and a local test token issuer (an `http://127.0.0.1` issuer is accepted
only for local testing). Keep `.wrangler/` out of git.

## Watch & Learn lectures

Optional narrated, interactive lectures that teach an existing lesson (same objectives, sources and
comprehension check; either path completes the lesson). Pilot: Week 1 · Lesson 2. Narration is
rendered offline with the open Kokoro-82M voice model — no recurring cost. Production guide and costs:
`aperture/docs/lectures.md`. Feature flag: `lectures` in `apps/aperture/config.js`.
