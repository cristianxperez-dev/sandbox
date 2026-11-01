# APERTURE content schema and writing guide

APERTURE — The Applied Intelligence Academy. Semester I: *Foundations of Human Behavior,
Evidence & Executive Leadership*. 14 weeks, graduate level, 5–7 hours per week.

All course content is structured JSON in `aperture/content/`. It is **never** published as a
static file: the protected API (`functions/apps/aperture/api/`) bundles it, checks the session,
strips answer keys and serves it. `node aperture/tools/validate.mjs` must pass before anything
is committed.

```
aperture/content/
  weeks/w01.json … w14.json     one file per week (schema below)
  sources/w01.json … w14.json   resource records cited by that week (merged into the library)
  sources/extra.json            diagnostic / midterm / capstone / audit sources
  diagnostic.json               Week 1 baseline diagnostic
  midterm.json                  cumulative midterm (after Week 7)
  capstone.json                 Week 14 capstone (18 components)
  audit.json                    Deliverable A — research audit of reference programs
  labs.json                     the eight labs and the exercises they host
```

## 1. Writing guide (applies to every word)

**Voice.** Second person ("you"), precise, calm, intellectually serious: a demanding
graduate seminar written by a scholar who has also run organizations. No hype, no
exclamation marks, no emojis, no "in today's fast-paced world", no motivational filler.
American English. Prefer short declarative sentences; use technical terms, then define them.

**The learner.** A senior leader in professional baseball player development (bilingual,
U.S. and Latin American experience; sociology and economics background; builds analytics
and operations software) who wants executive breadth: behavioral science, evidence,
strategy, finance, law, negotiation, organizations. Treat the learner as intelligent but not
pre-trained in each field. **Do not** name the learner, their employer, any real club, or any
role they may or may not hold next. Do not write about "your next promotion". Personal
details live only in the learner's private profile, never in content.

**Breadth.** Do not make every lesson about baseball. In each week, at least two thirds of
examples and the case setting rotation must come from technology, finance, law, healthcare,
government, consulting, the military, education, or other sports. Baseball / player
development appears as an explicit *professional application* (kind `application`), not as
the default frame.

**Evidence discipline (non-negotiable).**
- Never invent a study, statistic, effect size, sample size, quote, URL, DOI, author, course,
  date or affiliation. If you are not sure a detail is right, confirm it with WebSearch or
  leave it out.
- Every claim presented as established research must cite a resource record (`refs`).
- Say how strong the evidence is: meta-analysis vs. single lab study vs. theory vs.
  practitioner heuristic. Name replication problems explicitly where they exist
  (e.g. ego depletion, power posing, social priming, growth-mindset effect sizes, learning
  styles, "10,000 hours", grit, the marshmallow test, Dunning–Kruger as a statistical
  artifact, stereotype threat, contextual interference transfer to applied settings).
- Practitioner frameworks (e.g. power/interest grids, RACI, BLUF, Kotter's eight steps) must
  be labelled as practitioner heuristics, not science.
- Numbers in cases and exhibits are **synthetic** and say so.
- Short quotations only (≤ 40 words), attributed. Never reproduce copyrighted case text,
  course packs or substantial passages of books or papers. Summarize in your own words.
- Nothing may imply affiliation with, endorsement by, or credit from any university.
  Reference programs are "programs whose public curricula informed this course".

**Original cases.** Fictional people and organizations, synthetic data, explicit
assumptions, real tradeoffs, more than one defensible answer. Fictional organizations must
not share a name with a real organization (search if unsure). Fictional baseball clubs: use
invented names such as "the Harbor City Navigators" or "the Mesa Verde Condors"; never a real
MLB/MiLB/NPB/KBO club, player, or executive.

**Legal content.** Educational and general. Never phrase it as advice to the learner about
their own situation ("you should sign…"). Week 11 material carries the disclaimer:
"Educational material about general legal concepts — not legal advice. Consult a qualified
attorney about any specific agreement."

## 2. Inline text markup

Text fields accept a tiny, safe subset (rendered by APERTURE; HTML is never allowed):
`**bold**`, `*italic*`, `[label](R-id)` link to a library resource, `[label](#w04-l2)` link to
a lesson, `[label](#w04)` link to a week, `[label](#gl:term-id)` glossary term. No raw URLs in
prose (put URLs only in resource records). No `<`, `>` HTML tags.

## 3. Identifiers

| Thing | Pattern | Example |
| --- | --- | --- |
| Week | `wNN` | `w04` |
| Lesson | `wNN-lN` | `w04-l2` |
| Question | `wNN-qNN` (quiz), `wNN-rsN` (reserve), `wNN-lN-cN` (lesson check), `dg-NN`, `mt-NN` | `w04-q07` |
| Review card | `wNN-srNN` | `w04-sr03` |
| Concept | `c-<kebab>` (globally unique, reuse across weeks) | `c-base-rate-neglect` |
| Glossary term | `g-<kebab>` | `g-regression-to-the-mean` |
| Resource | `R-<firstauthorlastname>-<year>-<firstword>` lowercase ASCII, first author's surname without diacritics, publication year, first title word that is not *a, an, the, of, on, in, and, to, for, why, how, what* | `R-tversky-1974-judgment` |
| Exercise | `wNN-x` | `w07-x` |
| Case | `wNN-case` | `w05-case` |
| Assignment | `wNN-as` | `w05-as` |

Use the deterministic resource-ID rule so two writers citing the same work produce the same
ID. For an organization author use its short name (`R-oecd-2019-…`, `R-mitocw-2001-negotiation`).

## 4. Domains (learning profile)

Every question has one `domain`:
`behavioral-science`, `statistical-reasoning`, `business-strategy`, `financial-literacy`,
`legal-reasoning`, `negotiation`, `organizational-behavior`, `leadership-judgment`,
`communication`.

Schools: `behavioral` (Behavioral & Social Science), `business` (Business & Leadership),
`law` (Law & Strategy).

## 5. Blocks (lesson sections, case bodies, briefs)

A *block list* is an array of objects. Every prose block carries a `kind` that tells the
learner what sort of material it is (shown in the lesson's source panel and as a quiet
marker):

| `kind` | Meaning | `refs` |
| --- | --- | --- |
| `established` | Established academic material (well-supported finding/theory) | **required** |
| `original` | Original APERTURE explanation, synthesis or teaching device | optional |
| `example` | Illustrative example (real and sourced, or clearly hypothetical) | required if it describes a real event |
| `application` | Professional application (player development, baseball ops, executive work) | optional |
| `hypothesis` | Speculative hypothesis / APERTURE's own conjecture, labelled as such | optional |
| `contested` | Contested or failed-to-replicate finding; state both sides | **required** (cite both sides) |

Block types:

```jsonc
{ "type": "p", "kind": "established", "text": "…", "refs": ["R-tversky-1974-judgment"] }
{ "type": "h", "text": "Subheading" }                     // sparingly, within a section
{ "type": "list", "kind": "original", "ordered": false, "items": ["…", "…"], "refs": [] }
{ "type": "prompt", "text": "Before reading on, estimate …" }  // pause-and-think prompt
{ "type": "quote", "text": "≤ 40 words", "cite": "R-…" }
{ "type": "table", "kind": "original", "caption": "…", "headers": ["…"], "rows": [["…"]], "note": "Synthetic data." }
{ "type": "matrix", "kind": "original", "caption": "…", "x": ["low …", "high …"], "y": ["low …", "high …"],
  "cells": [["bottom-left", "bottom-right"], ["top-left", "top-right"]], "note": "…" }   // 2×2; cells[0] is the LOW-y row
{ "type": "flow", "kind": "original", "caption": "…", "steps": [{ "label": "…", "text": "…" }] }  // left-to-right process / causal chain
{ "type": "bars", "kind": "original", "caption": "…", "unit": "%", "items": [{ "label": "…", "value": 42 }], "note": "Synthetic / source" }
{ "type": "mode", "mode": "foundation", "title": "Prerequisite: …", "blocks": [ … ] }  // shown in Foundation mode, collapsed otherwise
{ "type": "mode", "mode": "executive", "title": "Executive twist: …", "blocks": [ … ] } // ambiguity / limited information; shown in Executive mode, collapsed otherwise
{ "type": "depth", "title": "Methodological note: …", "blocks": [ … ] }                 // theory / method depth; shown in Graduate and Executive, collapsed in Foundation
```

`table`, `matrix`, `flow` and `bars` are APERTURE's original diagrams — use at least one per
lesson. Real data in `bars` must cite `refs`; synthetic data must say "Synthetic" in `note`.

## 6. Week file (`weeks/wNN.json`)

```jsonc
{
  "id": "w04",
  "number": 4,
  "title": "How to Know What Is True",
  "theme": "Research Literacy, Statistics & Causal Reasoning",
  "school": "behavioral",                    // primary school
  "schools": ["behavioral", "business"],      // all that apply
  "question": "The week's intellectual question (one sentence, ends with ?)",
  "overview": [ blocks ],                     // 2–4 paragraphs, kind original
  "objectives": ["Distinguish …", "…"],       // 4–6, measurable verbs
  "hours": { "lessons": 2.5, "reading": 1.5, "exercise": 0.75, "case": 0.5, "quiz": 0.4, "assignment": 1.25, "reflection": 0.25 }, // sums to 5–7
  "concepts": [ { "id": "c-…", "name": "…", "domain": "statistical-reasoning", "lessons": ["w04-l1"] } ], // 8–15
  "lessons": [ Lesson, … ],                   // 3–5
  "readings": {
    "required": [ { "ref": "R-…", "what": "Chapter 2 (pp. 30–55) / full article", "why": "…", "minutes": 40 } ], // 2–4
    "optional": [ { "ref": "R-…", "what": "…", "why": "…", "minutes": 30 } ]                                    // 2–5
  },
  "glossary": [ { "id": "g-…", "term": "…", "definition": "…", "lesson": "w04-l1", "related": ["g-…"] } ], // 10–20
  "exercise": Exercise,
  "case": Case,
  "quiz": Quiz,
  "assignment": Assignment,
  "reflection": { "minutes": 15, "prompts": ["…", "…", "…"] },  // 3–4 prompts, personal and specific
  "review": [ { "id": "w04-sr01", "front": "…", "back": "…", "concept": "c-…", "lesson": "w04-l1" } ], // 12–16
  "preview": { "text": "…", "links": [ { "week": 6, "why": "…" } ] }   // how this week connects to later weeks
}
```

### Lesson

```jsonc
{
  "id": "w04-l2",
  "title": "…",
  "minutes": 35,                                // honest estimate incl. diagrams and checks
  "summary": "One sentence.",
  "objectives": ["…", "…"],                   // 2–4
  "concepts": ["c-…"],
  "executive": "80–120 word executive brief (shown first in Executive mode).",
  "sections": {
    "explore":    [ blocks ],   // situation, dilemma, surprising finding, or prediction prompt
    "understand": [ blocks ],   // the theory, explained; at least one diagram block
    "challenge":  [ blocks ],   // counterarguments, limits, competing frameworks, replication
    "apply":      [ blocks ],   // scenario / worked problem / application to executive work
    "retain":     [ blocks ]    // 2–4 sentence synthesis + 2–3 retrieval prompts (type prompt)
  },
  "takeaways": ["…", "…", "…"],              // 3–5
  "check": [ Question, Question ],             // 2–3 comprehension questions, auto-gradable types only
  "sources": [ { "ref": "R-…", "use": "What this source supports in this lesson" } ], // ≥ 2
  "crosslinks": [ { "to": "w07-l1", "why": "…" } ]   // 1–3, may point forward or back
}
```

Length: each lesson's five sections together contain **1,300–2,300 words** of real
instruction (diagrams and prompts don't count). Each lesson includes at least one
`mode: foundation` block, at least one `depth` block, and each week at least two
`mode: executive` blocks.

### Question (quiz, reserve, lesson checks, diagnostic, midterm)

```jsonc
{
  "id": "w04-q03",
  "type": "mc",             // see table
  "prompt": "…",
  "stimulus": [ blocks ],   // optional: vignette, data table, flawed argument, clause, study abstract (fictional)
  "options": [ { "id": "a", "text": "…" }, … ],      // 4–5 options for choice types
  "answer": "b",            // shape depends on type (below)
  "explanation": "Why the correct answer is correct (2–5 sentences).",
  "optionFeedback": { "a": "Why a is wrong …", "c": "…", "d": "…" },   // every non-correct option
  "errorTags": { "a": "confuses-correlation-causation" },              // optional: names the reasoning error a wrong option reveals (kebab)
  "concepts": ["c-…"],
  "domain": "statistical-reasoning",
  "lesson": "w04-l2",
  "difficulty": "core",      // core | stretch
  "points": 1
}
```

| `type` | Use | `options` | `answer` |
| --- | --- | --- | --- |
| `mc` | Multiple choice | 4–5 | `"b"` |
| `multi` | Multiple select ("select all that apply") | 5–6 | `["a","d"]` |
| `scenario` | Scenario analysis (stimulus required) | 4–5 | `"c"` |
| `flaw` | Identify the flawed reasoning (stimulus = argument) | 4–5 | `"a"` |
| `research` | Interpret a research finding (stimulus = fictional abstract/table) | 4–5 | `"d"` |
| `decision` | Decision simulation: best next move under constraints | 4–5 | `"b"` |
| `issue` | Legal/commercial issue spotting: select every real issue | 5–7 | `["a","c","e"]` |
| `rank` | Rank competing options (best first) | 3–5 | `["c","a","d","b"]` (complete order) |
| `numeric` | Numerical problem | — | `{ "value": 12.5, "tolerance": 0.25, "unit": "%" }` (+ `"working": "step-by-step solution"`) |
| `short` | Short constructed response (self-assessed) | — | none; give `"modelAnswer"` and `"rubric": [ { "criterion": "…", "points": 2, "levels": ["0 — …", "1 — …", "2 — …"] } ]` |

Scoring (server-side): `mc/scenario/flaw/research/decision` all-or-nothing; `multi/issue`
partial credit = max(0, (correct picks − wrong picks) / number correct); `rank` partial credit
from position distance; `numeric` within tolerance; `short` is never auto-graded — the learner
self-assesses against the rubric and model answer, and it is labelled self-assessed.

### Quiz

```jsonc
{
  "id": "w04-quiz", "title": "Week 4 quiz", "minutes": 25, "mastery": 0.8,
  "questions": [ … ],   // 10–12 questions, ≥ 6 distinct types, ≥ 1 short, ≥ 8 auto-gradable, spread over all lessons
  "reserve":   [ … ]    // 4 additional auto-gradable questions used for reassessment below 80%
}
```

### Exercise (the week's interactive tool)

```jsonc
{
  "id": "w04-x", "title": "Evidence Lab", "lab": "research-critique-lab",
  "engine": "simulation",          // see ENGINES.md
  "minutes": 45,
  "intro": [ blocks ],             // what to do and what to notice
  "config": { … },                 // engine-specific (ENGINES.md); anything the learner must not see before finishing goes under a key named "key"
  "debrief": [ blocks ],           // what the exercise shows and what it does NOT show
  "assumptions": ["…"]             // transparent rules / assumptions, shown to the learner
}
```

Labs: `behavioral-decision-lab`, `negotiation-simulator`, `organizational-design-studio`,
`research-critique-lab`, `financial-decision-studio`, `executive-communication-studio`,
`contract-issue-spotting-lab`, `strategic-decision-journal`.

### Case

```jsonc
{
  "id": "w05-case", "title": "The Brilliant Analyst", "setting": "technology", // baseball | technology | healthcare | finance | government | international | sports | consulting | education
  "minutes": 35,
  "fiction": "All people, organizations and data in this case are fictional.",
  "body": [ blocks ],              // 900–1,600 words, narrative with tension and incomplete information
  "exhibits": [ { "title": "Exhibit 1 — …", "type": "table", "headers": [], "rows": [], "note": "Synthetic data. Assumptions: …" } ],
  "assumptions": ["…"],
  "questions": ["…"],              // 3–5 discussion questions
  "perspectives": [ { "title": "…", "text": "…" } ], // 2–4 defensible positions, revealed after the learner writes
  "application": "1 paragraph: how this transfers to player development / baseball operations (or to another field if the case is baseball)."
}
```

### Assignment

```jsonc
{
  "id": "w05-as", "title": "…", "minutes": 90,
  "brief": [ blocks ],
  "deliverable": "One sentence: what to produce.",
  "words": [600, 900],                         // range; or null when not a text product
  "template": [ { "heading": "…", "guidance": "…" } ],  // 3–8 sections the learner fills in
  "rubric": [ { "id": "r1", "criterion": "…", "weight": 25,
                "levels": [ { "score": 4, "label": "Exemplary", "descriptor": "…" },
                            { "score": 3, "label": "Proficient", "descriptor": "…" },
                            { "score": 2, "label": "Developing", "descriptor": "…" },
                            { "score": 1, "label": "Beginning", "descriptor": "…" } ] } ], // 4–6 criteria, weights sum to 100
  "checks": ["words", "sections"]               // automated FORMAT checks only (never content)
}
```

## 7. Resource records (`sources/wNN.json`)

An array. Cite only what you verified.

```jsonc
{
  "id": "R-tversky-1974-judgment",
  "title": "Judgment under Uncertainty: Heuristics and Biases",
  "authors": ["Amos Tversky", "Daniel Kahneman"],
  "publication": "Science, 185(4157), 1124–1131",     // journal + volume/pages, or publisher, or institution
  "year": 1974,
  "url": "https://doi.org/10.1126/science.185.4157.1124",   // DOI URL when a DOI is confirmed; otherwise the official page seen in search results
  "doi": "10.1126/science.185.4157.1124",              // or null
  "discipline": "psychology",   // psychology | behavioral-economics | economics | sociology | management | organizational-behavior | statistics | methodology | education | kinesiology | finance | accounting | strategy | law | negotiation | ethics | political-science | communication | public-policy
  "type": "journal-article",    // journal-article | book | book-chapter | working-paper | course | lecture | report | textbook | article | practitioner-article | legal-primary | dataset | website
  "access": "paywalled",        // open | free-registration | paywalled | library | purchase
  "license": "© AAAS. Linked, not reproduced.",   // or "CC BY 4.0", "CC BY-NC-SA 4.0 (MIT OpenCourseWare)", etc. — only state a license you confirmed; otherwise "Copyright holder's terms. Linked, not reproduced."
  "verified": {
    "date": "2026-11-01",
    "method": "web-search",
    "status": "metadata-confirmed",   // metadata-confirmed | partially-confirmed | unverified
    "evidence": "Title, authors, journal, volume, pages and DOI matched on pubmed.ncbi.nlm.nih.gov.",
    "link": "not-opened"              // the build environment cannot open pages; links are flagged untested
  },
  "summary": "Original 2–4 sentence summary in your own words.",
  "arguments": ["…", "…"],            // 2–4 key arguments / findings
  "evidence": "theoretical",          // meta-analysis | systematic-review | rct | field-experiment | lab-experiment | quasi-experimental | observational | longitudinal | qualitative | theoretical | review | textbook | practitioner | legal-primary | course
  "design": "Short description of the study design, only details you confirmed (or null).",
  "strengths": "…",
  "limitations": "…",
  "contested": "Replication status / contradictory findings with the competing resource IDs, or null.",
  "generalizability": "Does it transfer to organizations / sports? How confidently?",
  "readingMinutes": 45,
  "relevance": "Why it matters for this learner's executive development."
}
```

`metadata-confirmed` = title, authors, year and venue all matched in search results from an
authoritative source (DOI resolver, publisher, journal, PubMed, university, SSRN/NBER, the
author's institutional page). `partially-confirmed` = some fields matched. `unverified` = you
could not confirm it — avoid citing those; if you must, the validator and the library will flag
it. Prefer open-access versions (author/university copies, OER) and say so in `access`.

Writing-heavy assignments may add `"composer": { … }` (ENGINES.md `composer` config) so the
learner can draft in the Executive Communication Studio. Week 5 must.

## 8. Diagnostic, midterm, capstone, audit

**`diagnostic.json`** — Week 1 baseline (never graded, never skips foundations):

```jsonc
{ "id": "diagnostic", "title": "Baseline diagnostic", "minutes": 45,
  "intro": [ blocks ],
  "questions": [ Question … ],          // 27–36, auto-gradable only, ids dg-01…, ≥ 3 per domain (SCHEMA §4)
  "interpretation": { "<domain>": { "strong": "…", "developing": "…", "foundation": "…", "lessons": ["w04-l1", "…"] } } }
```

**`midterm.json`** — cumulative, after Week 7:

```jsonc
{ "id": "midterm", "title": "…", "minutes": 120, "mastery": 0.8, "covers": ["w01", …, "w07"],
  "intro": [ blocks ], "case": Case,     // cumulative case, 1,200+ words
  "questions": [ … ],                   // 16–22, ids mt-01…, ≥ 7 types, ≥ 2 short
  "reserve": [ … ] }                    // 6+ auto-gradable, ids mt-rs1…
```

**`capstone.json`** — Week 14, built incrementally from Week 8:

```jsonc
{ "id": "capstone", "title": "…", "fiction": "…", "organization": { "name": "…", "context": "…" },
  "scenario": [ blocks ], "exhibits": [ … ], "assumptions": ["…"],
  "components": [ { "id": "k01", "number": 1, "title": "Department mission and vision", "week": 9,
                    "draws": ["w05", "w08"], "guidance": [ blocks ], "prompts": ["…"],
                    "template": [ { "heading": "…", "guidance": "…" } ], "words": [150, 300],
                    "tool": null, "deliverable": "memo" } ],               // exactly 18
  "deliverables": [ { "id": "memo", "title": "Strategic memo", "description": "…", "components": ["k01"],
                      "words": [2000, 3000], "rubric": [ … ] } ],          // exactly 7
  "tools": { "orgdesign": { … }, "allocation": { … } },
  "milestones": [ { "week": 8, "text": "…" } ],
  "defense": ["Questions a skeptical president will ask"] }
```

**`audit.json`** — Deliverable A:

```jsonc
{ "title": "…", "updated": "2026-11-01", "disclaimer": "…",
  "method": [ blocks ], "criteria": [ { "id": "…", "label": "…", "description": "…" } ],
  "programs": [ { "id": "P-hbs-phd-ob", "name": "…", "institution": "…", "category": "phd|mba|jdmba",
                  "url": "https://…", "verified": { …as resources… }, "summary": "…", "coreAreas": ["…"],
                  "methods": ["…"], "distinctive": "…", "informs": ["w01"], "howUsed": "…", "limitations": "…" } ],
  "oer": [ { "ref": "R-…", "note": "…" } ],
  "synthesis": [ blocks ], "mapping": [ { "week": "w01", "programs": ["P-…"], "how": "…" } ], "gaps": [ blocks ] }
```
