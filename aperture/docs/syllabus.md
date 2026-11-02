# APERTURE — Semester I syllabus

Two versions, one source:

| | Where | Built by |
| --- | --- | --- |
| Interactive syllabus | `#/syllabus` (Curriculum → Course syllabus; `#/syllabus/w07` opens a week) — `apps/aperture/syllabus.js` | `apps/aperture/data/syllabus.json` |
| Full academic syllabus (PDF, letter) | `apps/aperture/syllabus/APERTURE-Semester-I-Syllabus.pdf` | the same `syllabus.json` |

```
aperture/build/content.json  ──compile.mjs + syllabus-model.mjs──▶  apps/aperture/data/syllabus.json  (hash)
                                                                          │
                                       node aperture/tools/syllabus.mjs ──┴──▶  PDF + syllabus/stamp.json (same hash)
```

**No drift.** Every lesson, concept, reading, lab, case, quiz, assignment, rubric, weight, mastery rule,
midterm and capstone detail is read from the compiled curriculum. `node aperture/tools/compile.mjs --check`
(run by the deploy workflow) fails when `syllabus.json` is stale or the PDF's stamp does not match it. Lecture
availability is part of the syllabus, so releasing more narrated lectures means re-running
`node aperture/tools/syllabus.mjs`. The page itself reads lecture availability and your progress live.

**Course-level framing** (description, philosophy, the nine semester outcomes, the AI-assistance note) is not
stored in the curriculum; it is written in `aperture/tools/syllabus-model.mjs`, describes only what the
application does, and each outcome cites the weeks whose objectives it summarizes. Weekly objectives are shown
verbatim in the interactive syllabus (the PDF summarizes them to stay readable).

**Not specified in the curriculum** (shown in the syllabus appendix rather than invented): calendar dates;
instructor and office hours; letter grades or a passing mark; attempt limits and late policy; course-level
statements; plus computed notes — Weeks 4 and 13 are planned slightly above 7 hours (7.45 h, 7.3 h), all 197
library links are marked "link untested" and 27 records only partially confirmed, and 55 of 60 narrated
lectures are coming soon.

**Verification** (November 2, 2026): a browser test compares the published syllabus with `data/content.json`
— all 60 lessons (id, title, minutes), all 110 weekly reading assignments, every library entry's URL / year /
access, the quiz, assignment, lab and case of all 14 weeks, the grading weights and mastery, the midterm and
the capstone — and exercises the page on desktop and phone (expandable weeks, 60 lesson links, 5 lecture
links and 55 "coming soon" indicators, reading filters, PDF download, deep links).
