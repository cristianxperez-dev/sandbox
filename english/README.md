# CP English

Practical English for Spanish-speaking baseball coaches: an adaptive placement test, a 16-week roadmap in three tracks, and narrated lessons with listening and speaking practice. It is served at `<site>/apps/english/`, and it is separate from APERTURE: it has its own data, progress and storage key (`cpEnglish.v1`).

| Path | What |
| --- | --- |
| `english/content/` | Source content: `course.json` (levels, tracks, 12 units, 48 lessons; 2 available), `placement.json` (40 items, 6 speaking tasks), `lessons/f01.json`, `lessons/f03.json` |
| `english/tools/narrate.py` | Renders lectures and dialogue clips to `apps/english/media/` (incremental, hash-checked) |
| `english/tools/build.mjs` | Validates content and compiles it, with audio timings, into `apps/english/data/`. `--check` validates only |
| `english/server/` | Configuration, budget and rate limits, evaluation schema and validation, used by the Pages Function |
| `functions/apps/english/api/[[path]].js` | `GET status`, `POST speech` (transcribe and evaluate), `POST text` (typed answers) |
| `apps/english/` | The static app: `core.js` (placement, grading, progress, review, recommendations; pure), `speech.js`, `ui.js`, `activities.js`, `lecture.js`, `app.js` |
| `english/tests/` | `core.test.mjs`, `server.test.mjs` (node --test) and `app.e2e.cjs` (Playwright journeys A–F) |

## Voice

The narrator is **Voice C**, exactly as APERTURE's `aperture/content/narration.json` defines it: Kokoro-82M v1.0 (q8 ONNX), voice `af_heart`, speed 1.02, cue gap 0.3 s. Dialogues use other Kokoro voices: `am_michael`, `af_bella`, `am_fenrir`, `am_puck`, `af_kore`.

All audio is generated in advance and committed. No speech is generated at runtime. To re-render after a text change:

```bash
python english/tools/narrate.py        # needs kokoro-onnx + the model/voices files (see the script header)
node english/tools/build.mjs           # fails if any audio is stale
```

## Access

CP English is public: no access code (owner's decision, Nov 2026). Paid AI calls stay protected server-side (switches, same-origin check, rate limits, spending ceilings below). `GET /apps/english/api/status` reports whether feedback is available, never any value.

## AI feedback (off by default)

Speech is transcribed and the response evaluated **on the server only**. The key never reaches the browser.

AI runs only when **all** of the following are true:

| Setting | Kind | Value |
| --- | --- | --- |
| `OPENAI_API_KEY` | secret | The Sandbox's existing OpenAI key, already set for Manager Hub |
| `EN_AI_ENABLED` | variable | `1` |
| `EN_AI_PRODUCTION` | variable | `approved`. Needed on cperez.app and the main pages.dev address. Preview deployments don't need it |
| `EN_AI_USAGE` *or* `MH_AI_USAGE` | D1 binding | Spending ledger and rate limits. The tables `en_ai_usage` and `en_rate` are created automatically and are separate from Manager Hub's |

### Optional settings

| Setting | Default | Notes |
| --- | --- | --- |
| `EN_STT_MODEL` | `gpt-4o-mini-transcribe` | **Unverified.** OpenAI's documentation was unreachable from the build environment. Confirm the model name before enabling |
| `EN_EVAL_MODEL` | `gpt-6-luna` | Responses API, strict JSON schema, `store: false` |
| `EN_AI_EFFORT` | `low` | Use `none` to omit the reasoning setting |
| `EN_AI_DAILY_USD` / `EN_AI_MONTHLY_USD` | `1` / `10` | Hard caps are 5 and 40 |
| `EN_AI_PER_DEVICE_HOUR` / `EN_AI_PER_IP_HOUR` | `40` / `120` | |
| `EN_AI_PRICES` | — | JSON that overrides the price table, for example `{"gpt-4o-mini-transcribe":{"perMinute":0.003}}` |
| `EN_AI_LOG` | on | Set to `0` to silence the request log. The log only records counts, cost and status, never audio or transcripts |

### Behaviour when a setting is missing

If anything above is missing, the app still works:

- Lessons, listening, typed practice and placement scoring all work. They are graded on the device.
- A speaking task says **"Automatic feedback isn't available right now"** and gives the reason.
- The learner can still play back their own recording and compare it with the model.
- Nothing is scored. A placement taken without speech is labelled **provisional**.

### Safeguards

- **Recordings:** at most 45 s and 2 MB, audio MIME types only. Requests must come from the same origin.
- **Spending:** before each call, its worst-case cost is reserved against the daily and monthly ceilings, then settled at the actual cost. When a ceiling is reached, the app answers "unavailable", never with a made-up score.
- **Rate limits:** applied per device and per IP. Keys are hashed.
- **Validation:** the evaluator's JSON is validated before use. Anything invalid is discarded.
- **Privacy:** no audio is stored on the server or on the device, and the server keeps no transcripts. Before the first upload, a consent notice explains what is sent. The Privacy page deletes the speaking history or everything.
- **Fairness:** the evaluator is told not to judge pronunciation or accent. Low-confidence recognition is reported as **unclear audio, not a language mistake**. Listen-and-repeat shows the transcript and the word differences and labels them **"not a pronunciation score"**.

### Cost estimate (assumptions, not a quote)

Prices are the last known values, not verified against OpenAI today:

- transcription: $0.003 per audio minute;
- `gpt-6-luna`: $0.10 per 1M input tokens and $0.50 per 1M output tokens.

**Per lesson session:** about 12 spoken responses averaging 10 s gives about 2 audio minutes, which is roughly $0.006. Twelve evaluations at about 1,500 input and 400 output tokens each come to roughly $0.004. That is about **$0.01 per session**.

**Example academy:** 30 coaches doing 4 sessions a week is about 480 sessions a month, so roughly **$5 a month**. The placement test adds well under $0.01 per attempt.

The default $10 monthly ceiling covers this with room to spare. Check the real figures in the OpenAI usage dashboard after the first week.

## Progress and future admin

Progress is stored in the browser (`localStorage` key `cpEnglish.v1`), the same approach as APERTURE's public beta. It is per device and never visible to other coaches.

The store is versioned (`migrate`) and keeps placement attempts separate from lesson progress, so a server-side store and a coach/admin view can be added later without changing the shape of the data.

## Tests

```bash
node english/tools/build.mjs --check
node --test english/tests/core.test.mjs english/tests/server.test.mjs
node scripts/build.mjs && node scripts/serve.mjs &   # then:
node english/tests/app.e2e.cjs                        # journeys A–F + mobile + privacy (speech API mocked)
```
