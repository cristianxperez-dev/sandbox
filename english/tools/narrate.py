#!/usr/bin/env python3
"""CP English — renders lecture narration and audio clips (offline, no API, no recurring cost).

  python3 english/tools/narrate.py            # everything missing or stale (incremental, resumable)
  python3 english/tools/narrate.py --status   # what is current / stale (renders nothing)

Voice: the instructional narrator is APERTURE's approved Voice C, read from aperture/content/narration.json
→ "default" (Kokoro af_heart, speed 1.02, 0.30 s between sentences), so both apps always use the same voice.
Dialogue speakers (lessons' "speakers", placement "speakers") use other Kokoro American voices, so
conversations are never one person talking to himself. Each cue is synthesized on its own, so the lecture
player's sentence timings are exact.

Engine: Kokoro-82M (Apache-2.0) via kokoro-onnx, the same setup as APERTURE (aperture/docs/lectures.md):
  CP_TTS_MODEL / APERTURE_TTS_MODEL    path to model_quantized.onnx (npm kokoro-q8-shards@1.0.0, parts 0-5 concatenated)
  CP_TTS_VOICES / APERTURE_TTS_VOICES  path to voices .npz (kokoro-js@1.2.1 voices/*.bin as 510x1x256 arrays)

Outputs (generated — never hand-edit):
  apps/english/media/lectures/<lesson>.mp3   lecture narration (MP3 mono 24 kHz 48 kbps)
  apps/english/media/clips/<clip>.mp3        dialogues, questions, model sentences
  english/build/audio.json                   timings + content hash for every rendered file
Then `node english/tools/build.mjs` compiles the app data and refuses stale or missing audio.
"""
import glob, hashlib, json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CONTENT = os.path.join(ROOT, 'english', 'content')
MEDIA = os.path.join(ROOT, 'apps', 'english', 'media')
BUILD = os.path.join(ROOT, 'english', 'build')
MANIFEST = os.path.join(BUILD, 'audio.json')
VOICE_C = os.path.join(ROOT, 'aperture', 'content', 'narration.json')
SR = 24000
GAP_SCENE, GAP_LINE, GAP_TURN = 0.85, 0.3, 0.45
DIALOGUE_SPEED = 0.98      # conversational voices, a touch slower for learners
ENGINE = 'Kokoro-82M v1.0 (q8 ONNX) via kokoro-onnx'


def voice_c():
    with open(VOICE_C, encoding='utf-8') as f:
        d = json.load(f)['default']
    return {'voice': d['voice'], 'speed': float(d['speed']), 'gap': float(d['cueGap']), 'label': d.get('label', 'Voice C')}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def jobs():
    """every audio file the app needs: (kind, id, spec) where spec lists (voice, speed, text) segments"""
    vc = voice_c()
    out = []
    sources = [load(p) for p in sorted(glob.glob(os.path.join(CONTENT, 'lessons', '*.json')))]
    placement = load(os.path.join(CONTENT, 'placement.json'))
    def voice_of(speakers, who):
        if who in (None, 'narrator'):
            return vc['voice'], vc['speed']
        return speakers[who]['voice'], DIALOGUE_SPEED
    for les in sources:
        sp = les.get('speakers', {})
        segs, prev_speaker = [], None
        for si, sc in enumerate(les['lecture']['scenes']):
            for ci, cue in enumerate(sc['cues']):
                v, s = voice_of(sp, cue.get('speaker'))
                gap = 0 if (si == 0 and ci == 0) else (GAP_SCENE if ci == 0 else (GAP_TURN if cue.get('speaker') != prev_speaker else vc['gap']))
                segs.append({'voice': v, 'speed': s, 'text': cue.get('say') or cue['text'], 'gap': gap})
                prev_speaker = cue.get('speaker')
        out.append(('lecture', les['id'], segs))
        for cid, clip in les.get('clips', {}).items():
            out.append(('clip', cid, clip_segs(clip, lambda w: voice_of(sp, w))))
    psp = placement.get('speakers', {})
    for cid, clip in placement['clips'].items():
        out.append(('clip', cid, clip_segs(clip, lambda w: voice_of(psp, w))))
    return out


def clip_segs(clip, voice_of):
    segs = []
    for i, ln in enumerate(clip['lines']):
        v, s = voice_of(ln.get('speaker'))
        segs.append({'voice': v, 'speed': s, 'text': ln['text'], 'gap': 0 if i == 0 else GAP_TURN})
    return segs


def digest(segs):
    payload = json.dumps([[x['voice'], x['speed'], x['text'], x['gap']] for x in segs], separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256((ENGINE + payload).encode('utf-8')).hexdigest()


def out_path(kind, jid):
    return os.path.join(MEDIA, 'lectures' if kind == 'lecture' else 'clips', f'{jid}.mp3')


def render(k, kind, jid, segs):
    import numpy as np
    import soundfile as sf
    parts, t, cues = [], 0.0, []
    for x in segs:
        if x['gap']:
            parts.append(np.zeros(int(x['gap'] * SR), dtype=np.float32)); t += x['gap']
        lang = 'en-gb' if x['voice'].startswith('b') else 'en-us'
        audio, rate = k.create(x['text'], voice=x['voice'], speed=x['speed'], lang=lang)
        assert rate == SR
        audio = audio.astype(np.float32)
        start = t; parts.append(audio); t += len(audio) / SR
        cues.append([round(start, 3), round(t, 3)])
    parts.append(np.zeros(int(0.4 * SR), dtype=np.float32)); t += 0.4
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
    status = '--status' in sys.argv
    vc = voice_c()
    man = load(MANIFEST) if os.path.exists(MANIFEST) else {'files': {}}
    todo = []
    for kind, jid, segs in jobs():
        h = digest(segs)
        cur = man['files'].get(jid)
        if not (cur and cur.get('hash') == h and os.path.exists(out_path(kind, jid))):
            todo.append((kind, jid, segs, h))
    print(f'{len(todo)} file(s) to render ({vc["label"]}: {vc["voice"]} @ {vc["speed"]})')
    if status or not todo:
        for kind, jid, *_ in todo: print('  stale:', kind, jid)
        return
    model = os.environ.get('CP_TTS_MODEL') or os.environ.get('APERTURE_TTS_MODEL')
    voices = os.environ.get('CP_TTS_VOICES') or os.environ.get('APERTURE_TTS_VOICES')
    if not (model and voices and os.path.exists(model) and os.path.exists(voices)):
        sys.exit('Set CP_TTS_MODEL and CP_TTS_VOICES (see the docstring / aperture/docs/lectures.md).')
    from kokoro_onnx import Kokoro
    k = Kokoro(model, voices)
    os.makedirs(BUILD, exist_ok=True)
    for i, (kind, jid, segs, h) in enumerate(todo, 1):
        r = render(k, kind, jid, segs)
        man['files'][jid] = {'kind': kind, 'hash': h, 'audio': os.path.relpath(out_path(kind, jid), os.path.join(ROOT, 'apps', 'english')), **r}
        man['narrator'] = {'label': vc['label'], 'voice': vc['voice'], 'speed': vc['speed'], 'cueGap': vc['gap'], 'engine': ENGINE, 'license': 'Kokoro-82M model and voices: Apache-2.0'}
        with open(MANIFEST, 'w', encoding='utf-8') as f:
            json.dump(man, f, ensure_ascii=False, indent=0, sort_keys=True); f.write('\n')
        print(f'  [{i}/{len(todo)}] {kind} {jid}: {r["duration"]:.1f}s')


if __name__ == '__main__':
    main()
