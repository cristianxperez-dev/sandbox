# APERTURE — Roadmap after beta (Deliverable G)

## Before or during the first weeks of beta

1. **Owner setup** (README → *One-time setup*): D1 database, binding, Access path, three variables.
   Until then APERTURE serves nothing.
2. **Open every library link once in a browser.** All 190-odd records were verified from search
   results; no page could be opened from the build environment, so every link carries
   `link-untested`. Fix any dead or redirected URL in `aperture/content/sources/` and recompile.
3. **Fill the open DOIs** flagged in the source manifest (partially-confirmed records).
4. **Decide repository visibility** (README → *Repository visibility*): the course source,
   including answer keys, is readable in the public Sandbox repository.
5. **Check fictional names** used in cases (e.g. Port Calder Lamplighters, Tamsin Valley Health,
   Corlund Pay, Quorvia Systems) for unintended collisions with real organizations.

## Instructional improvements (from beta feedback)

- Replace the browser `prompt()` used for notes on highlights with an in-page note editor.
- Item analysis after a few weeks of use: flag questions everyone gets right (too easy) or that
  produce the same wrong answer (possibly ambiguous) and revise them.
- A focused-review page per concept that gathers its lesson passages, glossary entries, review
  cards and missed items in one place.
- Add a written "instructor note" per rubric level with an annotated sample answer.
- Optional AI review: a pluggable provider (explicit opt-in, per submission) that returns
  rubric-referenced feedback labelled as AI review — never as the grade.

## Technical improvements

- Move APERTURE to its own subdomain (e.g. `aperture.cperez.app`) to isolate it from other
  Sandbox apps on the same origin; same code, a separate Pages project or a route.
- Durable rate limiting across edge isolates (Cloudflare rate-limiting rule on
  `/apps/aperture/api/*`) in addition to the per-isolate throttle.
- Offline reading of already-opened lessons (service worker scoped to the shell; content cached
  only after sign-in).
- Automated end-to-end tests in CI (the Playwright flows used in QA, against `wrangler pages dev`
  with a local token issuer).
- Content authoring: a preview command that renders one lesson locally without the API.

## Future semesters (not built)

The content model (weeks, lessons, blocks, resources by stable ID, engines by config) supports more
semesters without code changes: add `aperture/content/<semester>/…`, extend the compiler to emit
several semesters and the catalog to list them. Candidate topics from the brief — advanced
organizational leadership, behavioral economics, corporate finance and valuation, advanced
negotiation, legal strategy, political economy, organizational sociology, philosophy and ethics,
quantitative research, AI and decision science, executive communication, international management,
strategic innovation, advanced talent development — are deliberately not designed yet.
