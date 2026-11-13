# English (CP English) — content schema, v2

Content lives in `english/content/`. `node english/tools/build.mjs` validates it and compiles it to `apps/english/data/`;
`python3 english/tools/narrate.py` renders all audio. Never hand-edit `apps/english/data/` or `english/build/`.

## Languages and translations

Every course has a **target** language (what the coach is learning) and a **native** language (the coach's own,
used for instructions and explanations).

| Course direction | target | native | voices |
| --- | --- | --- | --- |
| Learn English (Spanish-speaking coaches) | `en` | `es` | narrator = Voice C (`af_heart`, read from APERTURE); English speakers `am_*` / `af_*` |
| Learn Spanish (English-speaking coaches) | `es` | `en` | narrator = Voice C, **English only**; Spanish speakers `em_alex`, `em_santa`, `ef_dora` (Latin American `es-419`) |

Source files name translations by language: a field `X_es` / key `es` is Spanish, `X_en` / key `en` is English.
The build turns the **native-language** translation into a generic `tr` (`X_es → X_tr` in an English course,
`X_en → X_tr` in a Spanish course) and `{en, es}` pairs into `{text, tr}`, so the app has one renderer for both
directions.

Rules for writers:
- **Spanish lessons (target `es`):** instructions, prompts, explanations and feedback are written in **English** (the
  learner's language); Spanish appears as the thing being learned (model sentences, options, dialogue) and always has
  an English translation (`en`). Beginners: never a long block of untranslated Spanish.
- **English lessons (target `en`):** as in Lessons f01/f03 — English with a Spanish translation for every
  instruction (`prompt_es`, `explain_es`, `goal_es` …) and every model sentence (`es`).
- **Narration never mixes languages in one spoken cue.** The narrator (Voice C) speaks English only; any Spanish word
  or sentence is a separate cue with a Spanish `speaker`. Use `say` when the shown text and the spoken text differ
  (e.g. text `The grip: el agarre.` → split into a narrator cue `The word for grip is…` and a speaker cue `el agarre`).
- Natural usage over literal translation; loanwords (slider, sinker, bullpen, spin…) are fine where coaches use
  them. Mark field shorthand vs. formal usage in `note` fields. Never present one regional form as the only correct one.
- Pitching mechanics and grips are individual: model language that **observes, asks and tests**
  ("I noticed…", "¿Qué sentiste?", "Vamos a probar…"), never universal commands or unsafe changes.
- No invented facts, statistics, player names presented as real, or claims of motion analysis. Illustrations are
  labelled as illustrations.

## Lesson file `lessons/<id>.json`

```jsonc
{
  "id": "p01",                       // unique across all courses
  "course": "es-pitching",           // catalog course id
  "target": "es", "native": "en",
  "minutes": 14,
  "intro": { "can": "…native…", "can_tr": "…target, optional…", "outcomes": [{ "en": "…", "es": "…" }] },
  "speakers": { "alex": { "name": "Coach Alex", "role": "Pitching coach", "role_es": "Coach de pitcheo", "voice": "em_alex" } },
  "lecture": { "scenes": [ { "visual": { … }, "cues": [ { "text": "…", "es"|"en": "…", "speaker": "alex"?, "say": "…"?, "repeat": true?, "reveal": 1? } ] } ] },
  "clips": { "<clip id>": { "title": "…", "lines": [ { "speaker": "alex", "text": "…", "es"|"en": "…" } ] } },
  "sections": [ { "id": "learn"|"listen"|"practice"|"speak"|"apply"|"review", "activities": [ … ] } ],
  "phrases": [ { "en": "…", "es": "…", "note": "…"? } ],
  "next": "…native…"
}
```

A cue without `speaker` is the narrator (Voice C, English). Target ≈ 3–5 minutes of narration
(≈ 450–700 spoken words in English lessons; Spanish lessons similar overall incl. the Spanish model cues).

### Visuals (`lecture.scenes[].visual`)
`title {kicker, title, sub}` · `dialogue {title, title_es}` · `phrases {title, items:[{en, es, answer?}], note_es|note_en}` ·
`pattern {title, rows:[{en, example, es}], note_*}` · `steps {title, steps:[{en, es}], note_*}` · `summary {title, items}` ·
`figure {title, figure: "<figure id>", caption, caption_*}` — figure ids are drawn by `apps/english/figures.js`:
`ball-seams`, `hand-fingers`, `grip-4s`, `grip-2s`, `grip-change`, `delivery-a`, `delivery-b` (illustrated delivery,
front side opens early vs. stays closed — always labelled "Illustration"), `infield`, `infield-shade`, `ready-position`.

### Activities
| type | fields |
| --- | --- |
| `lecture` | `id` (the lesson's lecture) |
| `match` | `skill`, `prompt`, `prompt_*`, `pairs: [[target, native] …]` (4–7), `explain_*` |
| `choice` | `skill`, `prompt`, `prompt_*`, `options` (3), `answer` (index), `explain`, `explain_*`, `clip`? |
| `order` | `skill`, `prompt`, `prompt_*`, `words` (target words, shuffled by the app), `answers` (accepted sentences), `explain_*` |
| `listen` | `skill: "listening"`, `clip`, `intro`, `intro_*`, `questions: [{id, prompt, prompt_*, options, answer, explain, explain_*}]` (2–3) |
| `repeat` | `skill: "speaking"`, `clip` (one line), `text` (target), `es`/`en` (translation), `tip_*`? |
| `answer` | `skill: "speaking"`, `clip` (the question), `prompt` (target), `prompt_*`, `goal` (English, for the evaluator), `goal_*` (shown), `examples` (2–3 target-language model answers), `focus`? (vocabulary the evaluator should look for) |
| `conversation` | `skill: "speaking"`, `partner` (speaker id), `setting`, `setting_*`, `objective`, `objective_*`, `turns` (2–4, below) |
| `mastery` | `pass` (e.g. 4), `items` (5 choice items with `id`) |

Each complete lesson: 1 lecture · ≥ 1 vocabulary match · ≥ 2 listening · 8–12 practice items (choice/order, incl.
≥ 2 sentence-building `order`) · ≥ 2 `repeat` · ≥ 2 `answer` · 1 `conversation` · 1 `mastery`.

### Conversation turns (branching, pre-recorded)
```jsonc
{ "clip": "p01-c1", "line": "Coach, ¿cómo quieres que agarre la pelota?", "en": "Coach, how do you want me to grip the ball?",
  "goal": "Tell the pitcher where to put his fingers (on/across the seams).", "goal_en": "…shown…",
  "examples": ["Pon los dedos encima de las costuras.", "…"],
  "fallback": { "options": ["…best…", "…", "…"], "answer": 0 },          // no-mic / no-AI path, graded
  "ack":     { "clip": "p01-c1a", "line": "Ok, así. ¿Y el pulgar?", "en": "…" },   // partner continues when the reply was clear
  "clarify": { "clip": "p01-c1b", "line": "Perdón, coach, ¿dónde pongo los dedos?", "en": "…" } } // when unclear/off-task: learner retries once
```
The next prompt depends on the response: a clear, on-task reply plays `ack`; an unclear one plays `clarify` and the
learner tries again (once). The evaluator may add an improvised `follow_up` (shown as text, labelled improvised).

## Placement bank `placement-<target>.json`
```jsonc
{ "id": "placement-es", "target": "es", "native": "en", "speakers": {…}, "clips": {…},
  "items": [ { "id": "es-a1-v1", "level": "A0"|"A1"|"A2"|"B1"|"B2", "skill": "vocab"|"grammar"|"reading"|"listening",
               "domain": "general"|"pitching"|"hitting"|"defense", "prompt": "…", "prompt_*": "…", "options": [3], "answer": 0, "clip"? } ],
  "speaking": [ { "id": "es-sp1", "level": "A1", "domain": "general"|"pitching"|…, "clip": "…", "prompt": "…target…", "prompt_*": "…",
                  "goal": "…English…", "goal_*": "…", "examples": ["…"] } ] }
```
Source convention: the correct option is index 0 (`answer: 0`); the app shuffles options per attempt.
General: 8 items per level (A0–B2), every skill at each level where sensible, listening items with clips.
Each active specialty: ≥ 8 coaching items (2 per level A1–B2) and 2 speaking scenarios (A1–A2 and B1–B2).

## Catalog `catalog.json`
Languages, specialties and the course matrix (target × specialty) with status `active` | `planned`, each course's
roadmap (lessons with `status: "available"` only when a lesson file exists) and planned-lesson schemas
(objectives, vocabulary targets, scenario, assessment criteria). Shared general-language foundations per target
language (`en-general` = the 16-week Everyday English track) are listed under `foundations` and can be recommended
inside any course of that language.

## Terminology `terms.json`
Built from `english/research/terms-*.json`: `id, en, es, es_alt, loanword, meaning, example_en, example_es,
specialty, category, level, register, region_note, sources`. Audio: every entry gets an English and a Spanish clip.
