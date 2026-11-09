# Manager Hub — Describe Your Day: design

## 1. Audit of the current capability (Nov 9 2026)

Pipeline today:

1. Text goes to `assistant.js` `buildDraft`.
2. If an AI service is connected, the model rewrites the text as a plain-English **brief**. That service is not deployed.
3. The brief or the raw text goes to `SchedulePlanner.plan` (index.html), a keyword/regex planner. Rotations go to `MHAssist.parseRotation`.
4. The result is events, then a review panel.

Measured on real prompts:

| Prompt | Result |
|---|---|
| "10 AM stretch, 1 PM game. Team fundy, indy defense. … 30-minute BP rounds and 30 minutes off pregame." | Stretch, then a canned game-day tail. **Team fundy, indy defense, BP rounds and the 30-min buffer are all dropped.** |
| "Game at 6. Early work at 2:30, BP at 3:30, 45 minutes off before stretch." | A **Stretch at "45:00"** (the duration read as a clock time). BP is 20 min. Overlap warnings point to a non-existent 9:15 block. |
| "No game tomorrow. Start at 9, defense-heavy day, two hitting groups, lunch at noon, finish by 2." | **Start 9, lunch and finish-by-2 are all ignored.** The day starts at 8:00 with no defense. |
| "FCL day. Stretch at 8:30, hitting stations, pitchers throw, defense after, done by noon." | **Stretch 8:30, pitchers, defense and the noon stop are all ignored.** |

Root causes:

- **Interpretation.** Keyword matching with no baseball vocabulary: "fundy", "indy", "PFP", "30 off", "BP rounds" are unknown. Durations collide with clock times. There is no model of "off before X".
- **Intermediate representation.** There is none. Even the AI path flattens the model's understanding back into prose for the same weak planner, so a better prompt or model cannot fix it.
- **Scheduling.**
  - Anchors (start, finish-by, first pitch, buffers) are not first-class constraints.
  - There is no fill/compress within a window, no feasibility arithmetic and no alternatives.
  - Concurrency (pitchers vs position players) exists only through pre-named groups.
- **Editing.** Follow-ups are regex commands against row text. They work for simple shifts, but nothing holds the constraints, so a change can't be re-solved.
- **UI.**
  - Assumptions are a flat list.
  - Fixed and flexible items aren't distinguished.
  - Conflicts carry no one-click resolutions.

## 2. Architecture

```
text ──► Interpreter ──► DayRequest (IR, JSON-schema validated) ──► Solver ──► DayPlan ──► preview / refine ──► existing rows (publish)
          ├─ AI interpreter: Pages Function → model with structured output (schema = IR)
          └─ built-in reader: deterministic baseball lexicon (offline, always available, labelled as such)
follow-up text ──► Interpreter (edit mode) ──► EditOp[] ──► applied to the IR (not to rows) ──► Solver again (locked items kept)
```

- **Language understanding** is the only probabilistic step. The model never produces times directly; it produces the IR.
- **Timing, feasibility and conflicts** are deterministic and unit-tested.
- **Both interpreters emit the same IR.** The solver and the evaluation suite don't care which one ran. The UI labels which one did ("Built-in reader" vs "AI interpreter"). A keyword reader is never called AI.

### Files (all in `apps/manager-hub/assistant/`, UMD like `engine.js`, no dependencies)

| File | Owns | API |
|---|---|---|
| `day-kb.js` | Baseball knowledge: activity kinds, phases, durations, who does it, resources, concurrency | `DayKB.kinds`, `DayKB.kind(id)`, `DayKB.PHASE` |
| `day-read.js` | Built-in reader: text → DayRequest; follow-up text → EditOp[]; lexicon of shorthand | `DayRead.read(text, ctx)`, `DayRead.readEdit(text, request, plan, ctx)`, `DayRead.lexicon` |
| `day-solve.js` | IR validation, solver, edit application, conflicts + alternatives | `DaySolve.validate(ir)`, `DaySolve.solve(ir, ctx)`, `DaySolve.applyEdits(ir, ops)`, `DaySolve.SCHEMA` |
| `day-engine.js` | Facade used by the UI and tests | `DayEngine.plan(text, ctx)`, `DayEngine.refine(state, text, ctx)` |

Times are **minutes after midnight** (integers) throughout.

## 3. Activity kinds (shared contract)

Each kind has: `phase` (ordering rank), `who` (default track), default/min/max minutes, `resource`, `flex`.

| id | Typical phrases (reader) | phase | who | dur def/min/max | resource |
|---|---|---|---|---|---|
| `arrival` | report, arrive, report time | 0 | all | 0 | – |
| `meeting` | meeting, team meeting, hitters' meeting, pitchers' meeting | 5 | all | 15/10/30 | clubhouse |
| `meal` | lunch, breakfast, pregame meal, spread, snack | (anchored) | all | 30/20/45 | clubhouse |
| `earlyWork` | early work, early hitting, early defense, extra work | 8 | position | 30/20/60 | field/cage |
| `activation` | activation, movement prep, dynamic, warm-up, band work | 9 | all | 10/5/20 | field |
| `stretch` | stretch, team stretch, stretch & throw | 10 | all | 15/10/20 | field |
| `throwing` | throw, catch play, throwing progression, long toss, play catch, throwing program | 20 | all (pitchers: own program) | 15/10/25 | field |
| `teamDefense` | team fundy, fundamentals, team defense, cuts and relays, bunt plays, rundowns, pickoffs, situations | 30 | all | 25/15/40 | field |
| `indDefense` | indy, individual defense, defensive stations, positional work, infield/outfield work, catchers' work | 32 | position | 30/15/45 | field |
| `pfp` | PFP, pitchers fielding practice, comebackers | 31 | pitchers | 20/15/30 | field |
| `bullpen` | bullpens, pens, side sessions | 25 | pitchers | 30/20/60 | mound |
| `pitcherWork` | pitchers throw, pitchers' program, arm care, recovery throws | 22 | pitchers | 30/20/60 | field |
| `baserunning` | baserunning, base running, speed work, jumps, secondary leads | 34 | position | 20/10/30 | field |
| `bp` | BP, batting practice, on-field BP, rounds, hitting groups | 40 | position | 30 per round | field |
| `cage` | cage, cage work, tee/flips, machine work, hitting stations, indoor hitting | 38 | position | 30/20/45 | cage |
| `liveBp` | live BP, live ABs, live at-bats | 42 | all | 30/20/45 | field+mound |
| `conditioning` | conditioning, running, sprints, lift, weights | 60 | all | 30/20/45 | field/weight room |
| `free` | off, free time, down time, rest, recovery window, "30 off" | 80 | all | stated | – |
| `pregamePrep` | pregame, dress, clubhouse time, pregame prep, transition | 85 | all | 20/10/40 | clubhouse |
| `game` | game, first pitch, game time | 100 | all | – (fixed) | field |
| `postgame` | postgame, postgame lift, postgame meeting | 110 | all | 20/10/40 | – |
| `custom` | anything else, label kept as written | 50 | all | 20/10/45 | – |

**Concurrency rules.**
- `who:"pitchers"` work and `who:"position"` work may run at the same time on separate tracks.
- `all` blocks the whole team.
- Within a track, nothing overlaps.
- Two items needing the same single-capacity resource (one field, cage or mound unless ctx says more) don't overlap.

## 4. DayRequest (IR)

```js
{
  version: 1,
  source: "reader" | "ai",
  dayType: "game" | "workout" | null,      // workout = no game
  level: "fcl" | "full-season" | null,      // complex-level day changes defaults (no game tail, earlier hours)
  weather: "rain" | null,                    // rain: outdoor hitting moves indoors, defense shortened
  anchors: {
    start: min|null,        // first activity / report time
    end: min|null,          // hard stop ("done by noon", "finish by 2")
    firstPitch: min|null,
    offBeforeGame: min|null // protected free window ending at first pitch (or at the anchor named in offBefore)
  },
  offBefore: [{ min, before: activityId|"game" }],   // "45 minutes off before stretch"
  groups: { hitting: n|null, pitchers: bool|null },  // stated counts only; null = unknown
  activities: [{
    id: "a1", kind: "<kind id>", label: "Team Fundamentals",
    who: "all"|"position"|"pitchers"|"catchers",
    at: min|null,            // fixed start (stated)
    dur: min|null,           // stated length
    rounds: { each: min|null, count: n|null } | null,   // BP-style rounds
    order: n,                // order of mention
    after: [id], before: [id],   // explicit sequencing ("defense after", "then", "before hitting")
    indoor: bool|null, location: string|null,
    emphasis: "heavy"|"light"|null,
    text: "original phrase"
  }],
  emphasis: ["defense"|"hitting"|"pitching"|"conditioning"],   // "defense-heavy day"
  base: { ref: "yesterday"|"current"|"template", name?: string } | null,   // "same as yesterday but…"
  edits: EditOp[],          // relative changes applied on top of base
  notes: [string],          // reader's own uncertainty, shown as assumptions
  unknown: [string]         // phrases not understood (shown, never silently dropped)
}
```

### EditOp

```js
{ op: "move", target, before?: target, after?: target }   // "move defense before hitting"
{ op: "duration", target, set?: min, delta?: min }         // "shorten team fundy to 20", "give pitchers another 15"
{ op: "shift", target, delta: min }                         // "move BP 20 minutes earlier"
{ op: "at", target, at: min }                               // "BP at 3:30"
{ op: "add", activity: <activity> }                         // "add baserunning"
{ op: "remove", target }
{ op: "anchor", key: "start"|"end"|"firstPitch"|"offBeforeGame", value: min|null }   // "make everything finish by 12:15"
{ op: "rounds", target, count?: n, each?: min, groups?: n }   // "add a second BP group"
{ op: "parallel", targets: [target, …] }                     // "run the cage groups simultaneously"
{ op: "lock", target }                                       // "keep game time fixed"
{ op: "indoor", target|"all-hitting" }                      // rain
```

A `target` is `{ kind?, who?, label? }`. It is resolved against the request's activities: kind first, then label words, then who ("pitchers" → every pitcher item).

## 5. Solver

Input: DayRequest + ctx. Output, a **DayPlan**:

```js
{
  items: [{ id, actId, kind, label, track: "all"|"position"|"pitchers", group?: "Group 1",
            start, end, fixed: bool, flexible: bool, source: "stated"|"inferred"|"default",
            round?: n, resource?: string, location?: string }],
  window: { start, end, available, required },
  assumptions: [{ key, text }],                         // concise, deduplicated
  conflicts: [{ code, severity: "error"|"warn", message, alternatives: [{ label, ops: EditOp[] }] }],
  ok: bool
}
```

Algorithm:

1. **Window.**
   - Start = `anchors.start` ?? the earliest fixed `at` ?? a default (game day: firstPitch − 4h, rounded; workout: 9:00; FCL: 8:30).
   - End = `anchors.end` ?? `firstPitch − offBeforeGame` ?? start + the sum of defaults.
2. **Anchored items.** `at` items, the game (`firstPitch`), the free window (`firstPitch − offBeforeGame`), meals at stated times, and `offBefore` buffers. They split the window into **segments**.
3. **Order of flexible items.**
   - Explicit `after`/`before` edges, then stated order where the user listed a sequence, then KB `phase`.
   - Topological sort; ties go to mention order.
   - Stretch/activation always precede throwing, defense and hitting in the same track.
   - BP precedes the pregame buffer.
4. **Tracks.**
   - `all` items occupy both tracks.
   - Pitcher items are placed in the pitcher track alongside position work. Defaults: during defense; PFP with team defense when the request says so.
5. **Durations.**
   - Stated dur, else the KB default.
   - BP = `rounds.each × rounds.count`. The count is the stated value, else the ctx hitting groups (from the workspace's position-player groups), else 2, recorded as an assumption.
   - If `required > available` in a segment: compress flexible items toward their minimum, weighted by emphasis (de-emphasised kinds first). If still short, raise a conflict (see 7).
   - If `available > required` and the segment ends at a hard anchor: expand flexible items toward their maximum, weighted by emphasis. The remainder becomes a `pregamePrep`/transition block before a game buffer, else stays as open time at the end. Reported once.
6. **Transitions.** None by default. Five minutes between field and cage moves only when the request asks for transitions.
7. **Conflicts**, each with concrete alternatives built as EditOps:
   - `overfull`: "Your requested activities need 3 h 15 min but only 2 h are available before pregame." Alternatives:
     - shorten the largest flexible item(s) by the overage;
     - run BP rounds concurrently (field + cage) if there are ≥ 2 groups and a cage exists;
     - start earlier by the overage, when no start anchor was stated by the user, or as an option anyway.
   - `fixedOverlap`: two stated times collide.
   - `afterEnd`: a stated time falls after the hard stop.
   - `resource`: more simultaneous groups than fields/cages.
   - `impossible`: the window is ≤ 0. Example: "start at 2, finish by 1".
8. **Never invent facts.**
   - Roster groups, coaches and facilities come from ctx or are generic ("Group 1", "Field", "Cage") and marked assumed.
   - Pitcher work is added only when mentioned. Otherwise, at most one suggestion ("Add pitchers' throwing program?") as an alternative, not as an item.

### ctx

```js
{
  date, affiliate,
  hittingGroups: [names],    // the workspace's position-player groups (Blue / Orange …), may be []
  pitcherGroups: [names],
  resources: { fields: n, cages: n, mounds: n, names: { field: [..], cage: [..], mound: [..] } },
  game: { firstPitch: min|null, opponent: str|null },   // from the Games list for the date, if any
  current: DayRequest|null,  // the request behind the current draft (for refine)
  yesterday: DayRequest|null,// "same as yesterday"
  durations: { kind: min }   // Activity Library overrides
}
```

## 6. AI interpreter

- **Endpoint.** Cloudflare Pages Function `functions/apps/manager-hub/api/interpret.js`. It sits behind the Manager Hub access gate (session cookie required) and is same-origin only.
- **Model output.** Structured output whose JSON schema is `DaySolve.SCHEMA`: the IR for build, `EditOp[]` for refine. Validated server-side and again in the page. If invalid, or there is no key, or a timeout: the built-in reader runs and the UI says so.
- **Secrets.** `ANTHROPIC_API_KEY` (Pages secret), optional `MH_AI_MODEL`. The key never reaches the browser. Without the secret the endpoint answers 503 and the feature runs on the built-in reader.
- **Payload.** The page sends only the request text plus a compact ctx (group names, resource counts, game time, the current IR). No roster names.

## 7. UI

The **Describe Your Day** panel replaces the Assistant's describe step. The manual builder is unchanged.

- A large input with dictation and example chips.
- **Preview timeline:**
  - one column per track (Team / Position players / Pitchers);
  - fixed items solid with a pin;
  - flexible items outlined, with their minutes;
  - free and buffer windows hatched.
- **"What I assumed"**: at most five concise lines, expandable.
- **Conflicts**: the message plus one-click alternative buttons.
- **Refine**: a conversational input. Each refinement is an EditOp batch with its own undo/redo; unaffected items keep their times.
- Durations editable inline (± 5); reorder with drag where feasible.
- **Accept** writes rows into the day (`mutate()`), so the app's Undo, autosave and print all apply. The existing review/publish path is used for the actual write.

## 8. Evaluation

`manager-hub/tests/day-eval.test.mjs` runs ≥ 60 realistic prompts. Each scenario asserts baseball-useful properties, not just valid JSON:

- fixed times honoured;
- no overlaps within a track;
- stretch before throwing and defense;
- BP before the pregame buffer;
- buffer length exact;
- hard stop respected;
- requested activities all present;
- nothing invented;
- conflicts raised with numeric explanations;
- refinements preserve unaffected items.

The Section 1 prompt is the primary acceptance test.
