# APERTURE — Watch & Learn narrated lectures

A lecture is an interchangeable way to learn an existing lesson. It covers the same objectives, uses
the same verified sources and leads into the same comprehension check. Watching to the end, passing
the check, or finishing the written lesson all count the same, so no workload is added. The written
lesson is unchanged and one click away ("Read Lesson").

## Status (November 2, 2026)

- **Voice:** **Voice C** is the official APERTURE lecture voice (approved by the owner on
  November 2, 2026): Kokoro `af_heart` (American English), speed 1.02, 0.30 s between sentences. It is
  the configurable default in `aperture/content/narration.json` → `default`; scripts carry no voice of
  their own, so every lecture inherits it. A script may override `voice` / `speed` / `cueGap`, but
  should not without the owner's approval.
- **Released (narrated):** the first five lessons, in curriculum order — `w01-l1`, `w01-l2`, `w01-l3`,
  `w01-l4`, `w02-l1` (`release` in `narration.json`).
- **Coming soon:** the other 55 lessons. Their scripts are complete, validated on every compile and
  kept in `aperture/content/lectures/`. Nothing is published for them: no player, no play button. The
  lesson page shows "Narrated Lecture — Coming Soon" beside the written lesson, which opens by
  default and completes the lesson as before. Coming-soon lectures never count in lecture totals.
- **Hold:** do not render lectures 6–60 until the owner explicitly authorizes it.

## Continuing the rollout (after authorization)

Rendering is incremental and resumable — each lecture is written on its own, and anything already
current is skipped, so an interrupted batch simply continues.

1. Add the authorized lesson ids to `release` in `aperture/content/narration.json` (in curriculum
   order; a batch of 5–10 at a time keeps each session short — about 3 minutes of CPU per lecture).
2. `python3 aperture/tools/narrate.py --status` — shows released / current / needing rendering /
   coming soon. `narrate.py` refuses any id not in `release`.
3. `APERTURE_TTS_MODEL=… APERTURE_TTS_VOICES=… python3 aperture/tools/narrate.py --all` — renders only
   released lectures that are missing or stale.
4. `node aperture/tools/compile.mjs` (fails if a released lecture has no current narration), then
   `node aperture/tools/lectures.mjs --audit` (exit 0 = every released lecture works and every other
   lesson has a ready script).
5. Test `#/lesson/<id>/watch` on desktop and phone, commit, deploy.

Size: about 4–6 MB of MP3 per lecture (48 kbps mono). All 60 ≈ 300 MB; consider moving media to
Cloudflare R2 before committing the full set to git.

## How it works

```
aperture/content/lectures/w01-l2.json      authored script: chapters → scenes → narration cues,
                                           a visual per scene, optional checkpoint per scene
        │  python3 aperture/tools/narrate.py w01-l2        (offline neural TTS, ~3× real time on CPU;
        │                                                   voice from aperture/content/narration.json)
        ▼
apps/aperture/media/lectures/<id>/         narration.mp3 (MP3 48 kbps mono — plays in every current browser)
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
- **Reliability:** the narration is downloaded once (4–6 MB, with a progress label) and played from
  memory, so seeking, checkpoints and resume work on any host, including hosts that ignore HTTP
  Range requests (Safari needs them for seeking). One MP3 file serves every browser.
- **Visual vocabulary** (reusable, no images or video required): `title`, `statement`, `numbers`,
  `cards`, `compare`, `steps`, `grid`, `flow`, `bars`, `calc`, `matrix`, `timeline`, `quote`,
  `definition`, `next`, and the pilot's `anchor`, `tree`, `triples`, `replication`. New types are one renderer function each.
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
| Voice | **Voice C**: `af_heart` (American English), speed 1.02, 0.30 s sentence gap | Approved Nov 2, 2026. Default in `aperture/content/narration.json`; changing it there re-renders every released lecture on the next `narrate.py --all` |
| Recurring cost | **None** | No API, no key, no subscription; audio is static files on Cloudflare Pages |
| Hosting cost | None at this scale | ~4–6 MB per lecture. All 60 ≈ 300 MB: move media to Cloudflare R2 (10 GB free) before committing that much to git |

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
3. Add the lesson to `release` in `narration.json` (only when authorized), then
   `APERTURE_TTS_MODEL=… APERTURE_TTS_VOICES=… python3 aperture/tools/narrate.py <lesson>`
4. `node aperture/tools/compile.mjs`, then test `#/lesson/<lesson>/watch`. Visuals and checkpoints can
   be edited without re-rendering; changing any narration text requires step 3 (the compiler refuses
   stale audio).
