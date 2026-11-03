# APERTURE — Course B: Applied Biomechanics & Human Performance

*Advanced Hitting, Pitching, Motor Control & Skill Acquisition* — the second of APERTURE's two concurrent
14-week courses. Course A (Executive Leadership & Applied Management) is unchanged.

## Status (November 3, 2026)

- **Open:** Week 1 — Advanced Biomechanical Foundations; Week 2 — Biomechanical Measurement & Technology.
  Ten lessons, each as a written lesson and a narrated, interactive lecture (Voice C), two laboratories
  (Biomechanics Foundations Lab, Measurement Science Laboratory), quizzes with reserve questions, a research-critique
  case and an applied assignment per week, review cards, glossary, and a 28-question Course B diagnostic.
- **Coming Soon:** Weeks 3–14 show their title, overview and planned objectives only (from `content-b/course.json`).
  No lessons, lectures, labs or assessments exist for them, and nothing about them counts toward progress.
- **Hold:** do not build or narrate Weeks 3–14 until the owner authorizes the next expansion.

## How it is built

```
aperture/content-b/course.json      course metadata: schools, domains, grading (provisional), the 14-week plan,
                                    which weeks are available, the seven-question evidence standard
aperture/content-b/weeks/b0N.json   week content — same schema as Course A (aperture/content/SCHEMA.md)
aperture/content-b/sources/*.json   library records (verified metadata)
aperture/content-b/diagnostic.json  Course B diagnostic (7 domains × 4 questions)
aperture/content-b/labs.json        the Biomechanics & Measurement Laboratory
aperture/content-b/lectures/*.json  lecture scripts (no voice fields — the Voice C default applies)
        │  node aperture/tools/compile.mjs      (compiles Course B, then Course A; --check verifies both)
        ▼
aperture/build/course-b.json + apps/aperture/data/course-b.json   the Course B bundle
apps/aperture/data/lectures/b0N-lN-lecture.json                  compiled lectures
```

- **Separate records.** In the browser, Course A keeps its original storage keys (`aperture:v1:*`); Course B uses
  `aperture:v1:b:*`. Progress, attempts, review cards, notes, bookmarks and history never mix. Display settings are
  shared. Switching course (header A/B switch, Home or Curriculum cards, `#/course/b`, or any link to a `b0N` item)
  loads the other bundle and record set. Exports and imports cover the active course; "Delete all" clears both.
- **IDs.** Course B weeks are `b01…`, lessons `b01-l1…`, lectures `b01-l1-lecture`; Course A keeps `w01…`.
- **Labs.** `apps/aperture/labs-b.js` registers two engines in the shared lab framework: `frames` (rotation
  sequences with exact Cardan/ISB Y–X–Y extraction, reference frames, moments, illustrative kinetic-chain timing) and
  `measurement` (seeded synthetic data; Bland–Altman bias and limits of agreement, typical error, ICC(3,1), MDC95,
  real vs apparent change). Prediction tasks are checked against the same mathematics the lab displays.
- **Lecture visuals** added to the shared player: `frame3d` (animated 3D rotation sequence, with an exact
  comparison table), `curves`, `torque`, `agreement` (statistics computed by the player).
- **Validation:** `node aperture/tools/validate.mjs --course b [--week N] [--strict]`;
  lectures: `node aperture/tools/lectures.mjs --course b --lint|--audit`.
- **Secure server mode** serves Course A only; the course switch is hidden there.

## Continuing (Weeks 3–14, only when authorized)

1. Write `content-b/weeks/b03.json` (+ sources) from the plan in `course.json`; validate with `--course b --week 3`.
2. Add the week number to `available` in `content-b/course.json` (the curriculum then shows it as open).
3. Write lecture scripts in `content-b/lectures/`, add the lesson ids to `release` in
   `aperture/content/narration.json`, then `python3 aperture/tools/narrate.py --all` (renders only missing or
   stale released lectures; resumable).
4. `node aperture/tools/compile.mjs`, run the Course B browser tests, then deploy.
