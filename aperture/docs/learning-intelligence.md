# APERTURE — Learning intelligence (Deliverable E)

Everything here is computed on the server from the learner's own responses
(`aperture/server/insights.js`, `aperture/server/srs.js`). Nothing is a personality assessment or
a psychological diagnosis, and no insight appears unless its evidence threshold is met. Each insight
is shown with the rule that produced it.

## 1. Baseline diagnostic (Week 1)

- 32 auto-graded questions across nine domains: behavioral science, statistical reasoning,
  business strategy, financial literacy, legal reasoning, negotiation, organizational behavior,
  leadership judgment, communication (3–4 each, core and stretch).
- Never graded and never used to skip material. Its per-domain scores are stored with the attempt.
- **Calibration of explanations:** with *Use my diagnostic* on (Settings, default on), any week whose
  concepts belong to a domain scored under 50% opens the lessons' *Foundation* (prerequisite)
  blocks by default, whatever the chosen mode. The learner can collapse them.
- Each domain has an interpretation (strong / developing / foundation) and lessons to revisit.

## 2. Instructional modes

| Mode | What changes |
| --- | --- |
| Foundation | Prerequisite blocks open; graduate-depth blocks collapsed; lab rules open with "How to read this" notes |
| Graduate (default) | Methodological and theoretical depth open; executive scenarios collapsed |
| Executive | Each lesson opens with its 100-word executive brief; "executive twist" scenarios (ambiguity, limited information, competing objectives) open |

Content is identical in every mode — only what is open by default changes.

## 3. Mastery and reassessment

- Mastery threshold 80% on auto-graded items. Below it, the result page lists the missed concepts and
  lessons (focused review), sends those concepts' review cards back to box 1, and unlocks a
  reassessment: the quiz's four reserve questions plus the items missed. The server enforces
  eligibility (no reassessment before a first attempt or after mastery).
- Short responses are never auto-graded: the learner self-assesses against the rubric and model
  answer; those points are labelled self-assessed in every view.

## 4. Spaced repetition

Leitner boxes 1–6 with intervals of 1, 3, 7, 16, 35 and 90 days. *Again* → box 1 (due in 10
minutes); *Hard* → same box, half the interval; *Good* → up one box; *Easy* → up two. A *Good* given
with confidence ≤ 2 of 5 counts as *Hard*. Cards join the schedule the day after their lesson is
completed. A concept missed on any assessment sends its cards back to box 1. A card in box 4 or
higher counts as retained.

## 5. What is tracked

| Measure | Definition |
| --- | --- |
| Concepts introduced | Concepts with an assessed item or an activated review card |
| Concepts mastered | ≥ 3 graded items at ≥ 80% **and** every activated card in box ≥ 4 |
| Concepts requiring review | A card due now, or ≥ 2 items below 80% |
| Common errors | Wrong options carry an `errorTag` naming the reasoning error (e.g. *confuses correlation with causation*); counts across all attempts |
| Retention over time | Cards by box; share of non-*Again* ratings in the last 30 days |
| Calibration | Quiz confidence vs. accuracy and Brier score; Judgment Lab Brier score; decision-journal Brier score over resolved forecasts |
| Cross-disciplinary connections | Concepts taught in more than one week |
| Domains | Accuracy per domain on course items, beside the diagnostic score |

## 6. Insight rules (all thresholds shown to the learner)

| Kind | Shown when |
| --- | --- |
| Strength | A domain has 6+ graded course items at 85%+ |
| Gap | A domain has 6+ graded items below 65% (names the weakest concepts) |
| Growth | A diagnostic domain under 50% is followed by 6+ later items at 80%+ |
| Contrast | Within one domain, one concept has 3+ items at 85%+ and another 3+ items at ≤ 50% (e.g. "You consistently answer items on confirmation bias correctly but have had difficulty with base-rate neglect") |
| Pattern | The same tagged reasoning error appears in 2+ answers |
| Calibration | 10+ confidence-rated answers with confidence and accuracy 10+ points apart |
| Writing | 3+ assignment submissions averaging over 22 words per sentence (a readability measure, never a content judgment); or the same lowest-rated rubric criterion in 3+ self-assessments |
| Retention | A concept's cards record 3+ *Again* ratings |

## 7. Transcript

Weights: quizzes 30%, assignments 25%, midterm 20%, capstone 25%. *Current standing* averages only
completed components with their published weights, and every component states its basis (auto-graded,
self-assessed). The page says plainly that APERTURE is an independent learning program with no
academic credit, accreditation or university affiliation.

## 8. Continue in ChatGPT

A copyable prompt built from public course material (lesson, objectives, concept, up to six public
citations, the learner's question, the requested help type — eight options). Learner text is added
only when the learner ticks *Include my draft*. "Open ChatGPT" opens `chatgpt.com/?q=…` in a new tab
(prefill where ChatGPT supports it; long prompts fall back to copy-and-paste). APERTURE sends nothing
anywhere itself and has no AI provider; the core works without one.
