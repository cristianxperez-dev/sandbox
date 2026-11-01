# APERTURE — Watch & Learn narrated lectures

A lecture is an optional, interchangeable way to learn an existing lesson. It covers the same
objectives, uses the same verified sources and leads into the same comprehension check. Watching to
the end, passing the check, or marking the lesson complete all count the same, so no workload is
added and nothing is duplicated. The written lesson is unchanged and one click away
("Read & Explore").

**Pilot:** Week 1 · Lesson 2 — *Why Intelligent People Make Irrational Decisions* (the lecture for
"Heuristics, Base Rates and the Search for Confirmation"). Ten minutes of narration in five
chapters, 78 synchronized cues, five formative checkpoints (an estimate, two case decisions, an
interactive base-rate visualization, a reflection), six cited sources.
URL: `https://cperez.app/apps/aperture/#/lesson/w01-l2/watch`

## How it works

```
aperture/content/lectures/w01-l2.json      authored script: chapters → scenes → narration cues,
                                           a visual per scene, optional checkpoint per scene
        │  python3 aperture/tools/narrate.py w01-l2        (offline neural TTS, ~3× real time on CPU)
        ▼
apps/aperture/media/lectures/<id>/         narration.m4a (AAC 56 kbps) · narration.webm (Opus 40 kbps)
                                           captions.vtt · transcript.txt
aperture/build/narration/<id>.json         exact start/end of every cue + narration hash
        │  node aperture/tools/compile.mjs                 (validates; refuses stale narration)
        ▼
apps/aperture/data/lectures/<id>.json      script + timings, fetched by the player
```

- **Player** (`apps/aperture/lecture.js`, `lecture.css`): one narration track is the clock. Scene
  changes, reveal steps of the animated diagrams, captions, the transcript highlight and the
  checkpoint pauses all follow the cue timings. Controls: play/pause, ±10 s, scrubber with chapter
  and checkpoint marks, speed 0.75–2×, captions, synchronized transcript (click any line to jump),
  chapter list, audio-only mode (with lock-screen controls), downloadable transcript and WebVTT
  captions, keyboard shortcuts, resume from the saved position.
- **Reliability:** the narration is downloaded once (4.5 MB, with a progress label) and played from
  memory, so seeking, checkpoints and resume work on any host, including hosts that ignore HTTP
  Range requests (Safari needs them for seeking). AAC is used where supported; Opus otherwise.
- **Visual vocabulary** (reusable, no images or video required): `title`, `statement`, `numbers`,
  `cards`, `anchor`, `tree` (natural-frequency tree, parameterized), `triples`, `grid`, `compare`,
  `replication`, `steps`, `next`. New types are one renderer function each.
- **Checkpoints** (formative, never graded): `estimate` (slider; feedback quotes the learner's own
  number), `choice` (case or scenario decision with per-option feedback), `explore` (an interactive
  visualization with a control, then a question), `reflect` (free text, private). Responses are
  saved in the learner's `lecture` record and shown back on return; the lecture can be skipped
  through at any point.
- **Progress:** the `lecture` record (position, furthest point, completion, speed, checkpoint
  responses, time) is validated by the same shared rules in both deployment modes; lecture time
  counts toward time on task, and completing the lecture completes the lesson. Feature flag:
  `lectures` in `apps/aperture/config.js`.

## Narration engine and costs

| | Choice for APERTURE | Notes |
| --- | --- | --- |
| Voice model | **Kokoro-82M v1.0** (Apache-2.0), 8-bit ONNX | Open weights; commercial use allowed |
| Runtime | `kokoro-onnx` (MIT) + ONNX Runtime on CPU | Runs offline in a Claude Code session or on any laptop |
| Voice | `af_heart` (American English) | 54 voices available; change `voice` in the script and re-render (e.g. `am_michael`, `bm_george`, `bf_emma`) |
| Recurring cost | **None** | No API, no key, no subscription; audio is static files on Cloudflare Pages |
| Hosting cost | None at this scale | ~7.5 MB per lecture (both formats). A full semester of ~60 lectures ≈ 450 MB: move media to Cloudflare R2 (10 GB free) before committing that much to git |

Paid alternatives, if a different voice is wanted later (all would render at build time, so no key is
ever exposed to the browser): OpenAI TTS, Google Cloud Text-to-Speech or Azure Neural voices cost on
the order of US$15–30 per million characters; one 10-minute lecture is roughly 9,000 characters, so
the whole semester would be a one-time cost of well under US$50. ElevenLabs is subscription-based.
Remotion (rendered MP4 video) was considered and not used: it needs a render pipeline and a license for
company use, produces large files that are poor on mobile data, and cannot host live interaction.

## Producing another lecture

1. Write `aperture/content/lectures/<lesson>.json` from the lesson's objectives, sections and
   sources (cite only library IDs). Spoken style — explain, demonstrate, ask; never read the lesson
   aloud. Target 8–15 minutes. Add `say` to a cue when pronunciation needs help.
2. One-time setup in a session: `python3 -m venv venv && venv/bin/pip install kokoro-onnx soundfile`;
   model weights from the npm package `kokoro-q8-shards@1.0.0` (concatenate the six parts; sha256
   `fbae9257…a1478`), voices from `kokoro-js@1.2.1` (`voices/*.bin` → a `.npz` of 510×1×256 arrays).
3. `APERTURE_TTS_MODEL=… APERTURE_TTS_VOICES=… python3 aperture/tools/narrate.py <lesson>`
4. `node aperture/tools/compile.mjs`, then test `#/lesson/<lesson>/watch`. Visuals and checkpoints can
   be edited without re-rendering; changing any narration text requires step 3 (the compiler refuses
   stale audio).

## Reviewing the pilot

Open `#/lesson/w01-l2/watch` on desktop and on your phone. Listen to at least the first chapter and
answer the first checkpoint; try the transcript, speed, audio-only mode and a chapter jump; close the
tab mid-way and come back (it resumes). Then judge: voice (keep `af_heart` or try a male / British
voice), pacing (`speed` 0.94 now), depth, visual density, and whether the checkpoints feel worth the
pause. Changes to voice or speed are a one-line edit and a four-minute re-render.
