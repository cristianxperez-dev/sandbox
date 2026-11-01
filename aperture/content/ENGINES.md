# APERTURE lab engines — configuration reference

Every weekly exercise names an `engine` and gives a `config`. The engines live in
`apps/aperture/labs.js` and are reused by the eight labs. Rules shared by all engines:

- **Transparent rules.** Every number an engine shows comes from a rule the learner can open
  ("Show the rules"). No hidden scoring, no invented precision, no claim that an output is a
  validated prediction of human behavior. Effects in design/branching engines are *ordinal
  teaching heuristics* (−3…+3) grounded in the cited literature, displayed in words.
- **Hidden material** (answers, the counterpart's private values, the author's read) goes
  under a property named `key`. The API strips every `key` before sending a config; the engine
  receives it at the moment the rules say (end of the exercise, or at start for engines that
  must run a hidden counterpart — marked below).
- **Text** fields use the inline markup in SCHEMA.md §2. Block lists use SCHEMA.md §5 blocks.
- All data is synthetic and says so.

---

## `calibration` — Judgment Lab (Behavioral Decision Lab)

Answer factual questions and state confidence; scored for accuracy *and* calibration.

```jsonc
{
  "binary": [   // 10–16 true/false statements across domains (history of science, business, statistics, sport, law, medicine)
    { "id": "b1", "statement": "…", "key": { "answer": true, "explanation": "…", "ref": "R-… or null" } }
  ],
  "intervals": [ // 6–10 numeric quantities with a well-documented true value; learner gives a 90% interval
    { "id": "i1", "question": "In what year …?", "unit": "year", "key": { "answer": 1903, "explanation": "…", "ref": "R-… or null" } }
  ],
  "confidenceLevels": [50, 60, 70, 80, 90, 100]
}
```

Engine output: proportion correct; Brier score (mean of (p − outcome)², with p the stated
probability that the chosen answer is right); calibration table (stated confidence bucket vs.
actual hit rate, with counts); interval hit rate vs. the 90% target; plain-language
interpretation ("With 8 statements at 90% you were right on 5 — overconfident in that band").
Facts must be stable, checkable, and sourced in the explanation (use `ref` when a library
resource supports it). Avoid trick questions.

## `simulation` — Evidence Lab (Research Critique Lab)

A seeded statistical simulation of many two-group studies. The engine (not the config)
implements the math; the config provides guided presets and questions.

```jsonc
{
  "presets": [
    { "id": "p1", "title": "A promising pilot", "story": "…(fictional study framing)…",
      "params": { "n": 20, "effect": 0.3, "outcomes": 1, "publishOnlySignificant": false, "reliability": 1.0, "studies": 2000 },
      "predict": "Before you run it: what share of these studies will find p < .05?" ,
      "key": { "lesson": "What this preset demonstrates (shown after the run)." } }
  ],
  "limits": { "n": [5, 500], "effect": [0, 1], "outcomes": [1, 10], "reliability": [0.3, 1], "studies": [200, 5000] }
}
```

Parameters: `n` per group; true standardized effect `effect` (Cohen's d); `outcomes`
measured per study (the "researcher" reports the best one — a model of undisclosed
multiple testing); `publishOnlySignificant` (publication filter); `reliability` of the
measure (attenuates the observed effect by √reliability); `studies` simulated.
Outputs: share significant (power, or false-positive rate when effect = 0), mean estimated
effect among significant results vs. true effect (exaggeration ratio / type-M error), sign
errors (type-S), histogram of estimates, and a "what a single study would have told you" draw.

## `design` — Incentive Designer, Learning Architect (Organizational Design Studio)

Choose one option per design dimension; the engine totals each option's effects on named
indicators and fires combination rules.

```jsonc
{
  "brief": [ blocks ],
  "indicators": [ { "id": "effort", "label": "Effort on the measured task", "good": "high" }, … ], // 4–6; "good": "high" | "low"
  "dimensions": [
    { "id": "measure", "label": "What is rewarded", "help": "…",
      "options": [
        { "id": "units", "label": "Units sold", "effects": { "effort": 2, "gaming": 2, "quality": -1 },
          "why": "Short rationale tied to the literature.", "refs": ["R-…"] }
      ] }
  ],   // 4–7 dimensions, 3–4 options each
  "rules": [ { "id": "r1", "when": { "measure": "units", "horizon": "quarter" }, "text": "Warning or insight that only appears for this combination.", "refs": ["R-…"] } ], // 4–10
  "disclaimer": "Effects are ordinal teaching heuristics drawn from the cited research, not predictions."
}
```

Display: each indicator as a labelled scale from "strong risk" to "strong support" (sum of
effects clamped to −6…+6), never as a percentage. "Show the rules" lists every option's
effects and every rule.

## `branching` — Leadership Conversation Simulator, Change Simulator, Executive Dilemma

A multi-step scenario. Choices move named indicators and lead to the next node.

```jsonc
{
  "indicators": [ { "id": "trust", "label": "Trust", "start": 0 }, … ],   // 3–5
  "start": "n1",
  "nodes": {
    "n1": { "title": "Monday, 8:10 a.m.", "speaker": "Name, role (fictional)", "text": [ blocks ],
            "choices": [
              { "id": "a", "label": "What you say or do", "effects": { "trust": 1, "clarity": -1 }, "next": "n2",
                "feedback": "Why this moves the indicators, citing the idea behind it.", "refs": ["R-…"] }
            ] },
    "end-1": { "end": true, "title": "Outcome", "text": [ blocks ] }
  },
  "debrief": [ blocks ]
}
```

Rules: 8–16 nodes, 3–6 decision points on any path, 2–4 choices per node, at least three
distinct endings, no single "correct" path (trade-offs). Effects are integers −2…+2 per
choice. Feedback is shown immediately after each choice.

## `negotiation` — Negotiation Chamber (Negotiation Simulator)

Multi-issue, multi-round bargaining against a rule-based counterpart. **`key` is delivered
at start** (the counterpart needs it) and displayed only after the negotiation ends.

```jsonc
{
  "role": [ blocks ],                   // your confidential instructions
  "counterpart": { "name": "…", "title": "…", "style": "One sentence on demeanor." },
  "issues": [
    { "id": "fee", "label": "Annual fee", "options": ["$1.2M", "$1.1M", "$1.0M", "$0.9M"], "you": [0, 15, 30, 45] }
  ],                                    // 3–5 issues; "you" = your points per option (same length as options)
  "batna": { "you": 40, "text": "Your best alternative …" },
  "rounds": 6,
  "opening": { "fee": 0, "term": 1 },   // counterpart's opening package (option indexes)
  "hints": { "fee": "What a good question about this issue would reveal (shown when the learner asks about it)." },
  "key": {
    "them": { "fee": [45, 30, 15, 0], "term": [ … ] },   // counterpart points per option
    "batna": 35,                                            // counterpart's walk-away score
    "notes": "The counterpart's real interests, revealed after the deal."
  },
  "debrief": [ blocks ]
}
```

Engine rules (shown in "Show the rules"): you propose a full package each round, or ask one
question (reveals one `hints` entry, costs the round). The counterpart accepts when its score
≥ its aspiration, which starts at 90% of its maximum and falls linearly to `batna + 5` by the
final round; otherwise it counter-proposes by moving from its last offer one step on the issue
that costs it the fewest points per point it gives you (logrolling). After the last round with
no agreement, both sides take their BATNA. Debrief: both scores, joint value vs. the maximum
joint value available (Pareto-efficient frontier computed by enumeration), whether you beat
your BATNA, which trades created value.

## `allocation` — Strategy Table, Capital Allocation Lab (Financial Decision Studio)

Two modes.

**`"mode": "capital"`** — choose projects within a capital budget and inspect NPV logic.

```jsonc
{
  "mode": "capital",
  "brief": [ blocks ],
  "budget": 5000000,
  "currency": "USD",
  "rate": { "default": 0.08, "min": 0.02, "max": 0.16, "step": 0.005, "label": "Discount rate (cost of capital)" },
  "projects": [
    { "id": "p1", "label": "…", "description": "…", "cashflows": [-1200000, 300000, 400000, 450000, 450000], // year 0…N
      "scenarios": { "low": 0.7, "base": 1.0, "high": 1.2 },   // multipliers applied to inflows only
      "notes": "Assumptions behind the numbers.", "nonfinancial": "Strategic or ethical considerations not in the cash flows." }
  ],
  "questions": ["…"],
  "key": { "insights": "What a careful analyst notices (shown after submit)." }
}
```

Engine computes per project: NPV at the chosen rate, IRR (bisection; "n/a" if no sign change),
simple and discounted payback, profitability index, NPV in low/base/high; for the selected
portfolio: total cost vs. budget, total NPV, best portfolio by enumeration, opportunity cost of
the selection vs. the best one, ranking disagreements (NPV vs. IRR vs. PI). All formulas shown.

**`"mode": "strategy"`** — spread a fixed budget across initiatives under a chosen strategy.

```jsonc
{
  "mode": "strategy",
  "brief": [ blocks ],
  "budget": 100, "unit": "points ($100k each)", "step": 5,
  "strategies": [ { "id": "s1", "label": "…", "description": "…", "weights": { "i1": 1.5, "i2": 0.5 } } ],  // multiplies initiative value
  "initiatives": [ { "id": "i1", "label": "…", "description": "…", "max": 60, "scale": 30, "saturation": 20, "risk": "low", "notes": "…" } ],
  "scenarios": [ { "id": "base", "label": "Base case", "multipliers": { "i1": 1.0 } } ],
  "rules": [ { "id": "r1", "when": { "strategy": "s1", "min": { "i2": 30 } }, "text": "…" } ],
  "key": { "insights": "…" }
}
```

Value of an initiative = `weight × scale × (1 − e^(−x / saturation)) × scenario multiplier`
(diminishing returns). Engine shows value by scenario, the concentration of the allocation
(Herfindahl index of shares), and fired rules. Labelled "a teaching model of diminishing
returns and strategic fit, not a forecast".

## `orgdesign` — Organization Builder (Organizational Design Studio; reused by the capstone)

```jsonc
{
  "brief": [ blocks ],
  "budget": 2400000,
  "roles": [ { "id": "director", "label": "Director", "cost": 210000, "hours": 45, "skills": ["leadership", "strategy"] } ],
  "work":  [ { "id": "w1", "label": "Daily opponent reports", "hours": 30, "skills": ["analysis"], "critical": true } ],
  "decisions": [ { "id": "d1", "label": "Approve the season's research agenda" } ],   // decision rights to assign (Recommend / Decide / Input / Informed)
  "limits": { "span": [3, 8], "maxLayers": 4 },
  "start": [ { "id": "head", "role": "director", "reportsTo": null } ],
  "rules": [ { "id": "x1", "text": "…" } ]   // extra, scenario-specific checks described in words
}
```

The learner adds positions (role + manager), assigns work items to positions and decision
roles to positions. Built-in checks: cost vs. budget; span of control per manager vs. limits;
layers; hours assigned vs. each position's capacity; unassigned or skill-mismatched work;
critical work covered by a single person; decisions with zero or several "Decide" holders. Org
chart rendered as an indented tree.

## `stakeholder` — Influence Map (Organizational Design Studio)

```jsonc
{
  "brief": [ blocks ],
  "goal": "The change you are trying to make.",
  "stakeholders": [ { "id": "s1", "name": "…", "title": "…", "profile": "What you know about them.",
                      "key": { "power": 5, "interest": 4, "stance": -1, "why": "The case author's read." } } ],   // 6–10
  "ties": [ ["s1", "s3", "ally"], ["s2", "s4", "rival"] ],   // known relationships
  "rules": "Practitioner heuristic: power/interest grid (Mendelow-style). Labelled as such."
}
```

The learner rates power 1–5, interest 1–5 and stance −2…+2 for each person, then the engine
plots the grid, totals supporting vs. opposing power, flags high-power neutrals and brokers
(people tied to both camps), and suggests an engagement approach per quadrant. After
submitting, the author's read (`key`) is shown beside the learner's, with differences.

## `issues` — Contract Lab (Contract Issue-Spotting Lab)

```jsonc
{
  "document": { "title": "… (fictional)", "parties": "…", "clauses": [ { "id": "c1", "heading": "1. Services", "text": "…" } ] }, // 10–18 clauses
  "categories": [ { "id": "scope", "label": "Ambiguous scope or duties" }, … ],   // 6–10
  "key": { "issues": [ { "clause": "c4", "category": "ip", "severity": "high", "explanation": "…", "ask": "Question to put to counsel or the other side." } ] }, // 8–14
  "disclaimer": "Educational exercise on a fictional document — not legal advice."
}
```

The learner flags clause + category (+ optional note). Scoring after submit: issues found,
missed, and flags with no matching issue (precision/recall), each with the explanation.

## `composer` — Executive Communication Studio

```jsonc
{
  "scenario": [ blocks ],
  "audience": [ { "who": "…", "cares": "…" } ],
  "formats": [
    { "id": "memo", "label": "Analytical memo", "words": [600, 900], "sections": ["Recommendation", "Context", "Analysis", "Risks", "Decision needed"] },
    { "id": "brief", "label": "One-page brief", "words": [250, 400] },
    { "id": "verbal", "label": "60-second verbal", "words": [130, 165], "wpm": 150 }
  ],
  "checklist": ["Recommendation in the first two sentences", "…"]
}
```

Live, transparent text metrics only (no content grading): word count vs. range, speaking time
at `wpm`, mean and longest sentence length, share of sentences over 25 words, hedge words from
a listed lexicon, a passive-voice heuristic, and a self-check checklist. Drafts save to the
learner's notebook.

## Strategic Decision Journal (app feature, no config)

Structured entries: decision, date, context, options, choice, rationale, key assumptions, what
would change my mind, forecasts (outcome + probability + resolve-by date), review date; later:
what happened, each forecast resolved, process-vs-outcome assessment, lessons. Resolved
forecasts feed a Brier score and calibration table.
