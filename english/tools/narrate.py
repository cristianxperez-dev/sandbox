#!/usr/bin/env python3
"""English (CP English) — renders every audio file the app needs (offline, no API, no recurring cost). v2, bilingual.

  node english/tools/build.mjs --jobs        # list every audio file (english/build/jobs.json)
  python3 english/tools/narrate.py           # render what is missing or stale (incremental, resumable)
  python3 english/tools/narrate.py --status  # what is current / stale (renders nothing)

Voices (decided in build.mjs, recorded per segment):
  - Instructional narrator: APERTURE's approved Voice C, read from aperture/content/narration.json -> "default"
    (Kokoro af_heart, speed 1.02, 0.30 s between sentences). It speaks ENGLISH ONLY.
  - English dialogue: other Kokoro American voices (am_michael, am_fenrir, am_puck, af_bella, af_kore).
  - Spanish: Kokoro's native Spanish voices em_alex, em_santa, ef_dora with Latin American phonemization (espeak
    "es-419": seseo and yeismo, no Castilian "th"). Voice C is never used for Spanish (an English voice reading
    Spanish sounds foreign). Dominican features (aspirated or dropped final s, etc.) are not available in any
    offline voice; es-419 is general Latin American Spanish.
  Each cue is synthesized on its own, so sentence timings are exact.

Engine: Kokoro-82M (Apache-2.0) via kokoro-onnx, the same setup as APERTURE (aperture/docs/lectures.md):
  CP_TTS_MODEL / APERTURE_TTS_MODEL    path to model_quantized.onnx (npm kokoro-q8-shards@1.0.0, parts 0-5 concatenated)
  CP_TTS_VOICES / APERTURE_TTS_VOICES  path to voices .npz (kokoro-js@1.2.1 voices/*.bin as 510x1x256 arrays)

Outputs (generated — never hand-edit):
  apps/english/media/lectures/<lesson>.mp3, media/clips/<clip>.mp3, media/terms/<term>.mp3   (MP3 mono 24 kHz 48 kbps)
  english/build/audio.json   timings + content hash for every rendered file
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MEDIA = os.path.join(ROOT, 'apps', 'english', 'media')
BUILD = os.path.join(ROOT, 'english', 'build')
MANIFEST = os.path.join(BUILD, 'audio.json')
JOBS = os.path.join(BUILD, 'jobs.json')
SR = 24000
FOLDER = {'lecture': 'lectures', 'clip': 'clips', 'term': 'terms'}
LANG = {'es': 'es-419', 'en': 'en-us'}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def out_path(kind, jid):
    return os.path.join(MEDIA, FOLDER[kind], f'{jid}.mp3')


def render(k, kind, jid, segs):
    import numpy as np
    import soundfile as sf
    parts, t, cues = [], 0.0, []
    for x in segs:
        if x['gap']:
            parts.append(np.zeros(int(x['gap'] * SR), dtype=np.float32)); t += x['gap']
        lang = 'en-gb' if x['voice'].startswith('b') else LANG[x.get('lang', 'en')]
        audio, rate = k.create(x['text'], voice=x['voice'], speed=x['speed'], lang=lang)
        assert rate == SR
        audio = audio.astype(np.float32)
        start = t; parts.append(audio); t += len(audio) / SR
        cues.append([round(start, 3), round(t, 3)])
    tail = 0.4 if kind != 'term' else 0.15
    parts.append(np.zeros(int(tail * SR), dtype=np.float32)); t += tail
    audio = np.concatenate(parts)
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = (audio * min(1.0, 0.89 / peak)).astype(np.float32)
    path = out_path(kind, jid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'a.wav')
        sf.write(wav, audio, SR)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '48k', path], check=True)
    return {'duration': round(t, 3), 'cues': cues, 'bytes': os.path.getsize(path)}


def main():
    if not os.path.exists(JOBS):
        sys.exit('Run `node english/tools/build.mjs --jobs` first.')
    spec = load(JOBS)
    man = load(MANIFEST) if os.path.exists(MANIFEST) else {'files': {}}
    todo = [j for j in spec['jobs'] if not ((man['files'].get(j['id']) or {}).get('hash') == j['hash'] and os.path.exists(out_path(j['kind'], j['id'])))]
    nar = spec['narrator']
    print(f'{len(todo)} of {len(spec["jobs"])} file(s) to render ({nar["label"]}: {nar["voice"]} @ {nar["speed"]})')
    if '--status' in sys.argv or not todo:
        for j in todo[:40]: print('  stale:', j['kind'], j['id'])
        return
    model = os.environ.get('CP_TTS_MODEL') or os.environ.get('APERTURE_TTS_MODEL')
    voices = os.environ.get('CP_TTS_VOICES') or os.environ.get('APERTURE_TTS_VOICES')
    if not (model and voices and os.path.exists(model) and os.path.exists(voices)):
        sys.exit('Set CP_TTS_MODEL and CP_TTS_VOICES (see the docstring / aperture/docs/lectures.md).')
    from kokoro_onnx import Kokoro
    k = Kokoro(model, voices)
    os.makedirs(BUILD, exist_ok=True)
    man['narrator'] = {'label': nar['label'], 'voice': nar['voice'], 'speed': nar['speed'], 'engine': spec['engine'],
                       'spanish': {'voices': ['em_alex', 'em_santa', 'ef_dora'], 'phonemes': 'espeak es-419 (Latin American)'},
                       'license': 'Kokoro-82M model and voices: Apache-2.0'}
    for i, j in enumerate(todo, 1):
        r = render(k, j['kind'], j['id'], j['segs'])
        man['files'][j['id']] = {'kind': j['kind'], 'hash': j['hash'], 'audio': os.path.relpath(out_path(j['kind'], j['id']), os.path.join(ROOT, 'apps', 'english')), **r}
        if i % 20 == 0 or i == len(todo):
            with open(MANIFEST, 'w', encoding='utf-8') as f:
                json.dump(man, f, ensure_ascii=False, indent=0, sort_keys=True); f.write('\n')
        print(f'  [{i}/{len(todo)}] {j["kind"]} {j["id"]}: {r["duration"]:.1f}s', flush=True)


if __name__ == '__main__':
    main()
