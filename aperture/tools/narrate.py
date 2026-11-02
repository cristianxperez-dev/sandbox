#!/usr/bin/env python3
"""APERTURE lecture narration — renders a lecture script to audio with synchronized timings.

  python3 aperture/tools/narrate.py w01-l2            # one released lecture (aperture/content/lectures/w01-l2.json)
  python3 aperture/tools/narrate.py --all             # every RELEASED lecture whose narration is missing or stale
  python3 aperture/tools/narrate.py --status          # what is released, rendered, stale or coming soon (renders nothing)

Voice and release list: aperture/content/narration.json. "default" is the approved narration voice
(Voice C: Kokoro af_heart, speed 1.02, 0.30 s between sentences) — a script may override voice / speed /
cueGap, but none does. Only lessons listed in "release" are rendered or published; every other script
stays ready and the course shows "Narrated Lecture — Coming Soon". Rendering is incremental and
resumable: each lecture is written on its own, and --all skips anything already current.

Engine: Kokoro-82M (Apache-2.0), run offline with kokoro-onnx (MIT) and ONNX Runtime — no API, no
key, no recurring cost. Each narration cue is synthesized on its own, so caption, transcript and
slide timings are exact to the sample. Outputs (all generated — never hand-edit):

  apps/aperture/media/lectures/<id>/narration.mp3   MP3, mono, 24 kHz, 48 kbps (plays in every current browser)
  apps/aperture/media/lectures/<id>/captions.vtt    WebVTT captions
  apps/aperture/media/lectures/<id>/transcript.txt  plain-text transcript
  aperture/build/narration/<id>.json                cue / scene / chapter timings + narration hash
Then run `node aperture/tools/compile.mjs`, which merges the script and the timings into
apps/aperture/data/lectures/<id>.json and refuses stale narration.

Setup (once): see aperture/docs/lectures.md. Environment variables:
  APERTURE_TTS_MODEL   path to the Kokoro ONNX model (model_quantized.onnx)
  APERTURE_TTS_VOICES  path to a voices .npz (built from the kokoro-js voice files)
"""
import hashlib, json, os, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'aperture', 'content', 'lectures')
MEDIA = os.path.join(ROOT, 'apps', 'aperture', 'media', 'lectures')
DATA = os.path.join(ROOT, 'aperture', 'build', 'narration')
CONFIG = os.path.join(ROOT, 'aperture', 'content', 'narration.json')
SR = 24000
GAP_SCENE, GAP_CHAPTER, GAP_CHECKPOINT = 0.85, 1.25, 0.6
ENGINE = 'Kokoro-82M v1.0 (q8 ONNX) via kokoro-onnx'


def config():
    with open(CONFIG, encoding='utf-8') as f:
        return json.load(f)


def voice_of(s, cfg=None):
    """Effective narration settings: the approved default, overridden by any field the script sets.
    Must match aperture/tools/lectures.mjs → voiceOf()."""
    d = (cfg or config())['default']
    return {k: s.get(k, d[k]) for k in ('voice', 'speed', 'cueGap')}


def script_hash(s, cfg=None):
    """Must match aperture/tools/lectures.mjs → narrationHash()."""
    v = voice_of(s, cfg)
    cues = [c.get('say') or c['text'] for ch in s['chapters'] for sc in ch['scenes'] for c in sc['cues']]
    payload = json.dumps({'voice': v['voice'], 'speed': v['speed'], 'cueGap': v['cueGap'], 'cues': cues}, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def vtt_time(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'


def render(lecture_file):
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    with open(lecture_file, encoding='utf-8') as f:
        s = json.load(f)
    lid = s['id']
    model = os.environ.get('APERTURE_TTS_MODEL')
    voices = os.environ.get('APERTURE_TTS_VOICES')
    if not (model and voices and os.path.exists(model) and os.path.exists(voices)):
        sys.exit('Set APERTURE_TTS_MODEL and APERTURE_TTS_VOICES (see aperture/docs/lectures.md).')
    k = Kokoro(model, voices)
    v = voice_of(s)
    voice, speed, gap_cue = v['voice'], float(v['speed']), float(v['cueGap'])
    lang = 'en-gb' if voice.startswith('b') else 'en-us'

    parts, t = [], 0.0
    def silence(sec):
        nonlocal t
        parts.append(np.zeros(int(sec * SR), dtype=np.float32)); t += sec

    out = dict(s)
    out['chapters'] = []
    n_cues = 0
    for ci, ch in enumerate(s['chapters']):
        if ci: silence(GAP_CHAPTER)
        ch_out = dict(ch); ch_out['start'] = round(t, 3); ch_out['scenes'] = []
        for si, sc in enumerate(ch['scenes']):
            if si: silence(GAP_SCENE)
            sc_out = dict(sc); sc_out['start'] = round(t, 3); sc_out['cues'] = []
            for qi, cue in enumerate(sc['cues']):
                if qi: silence(gap_cue)
                audio, rate = k.create(cue.get('say') or cue['text'], voice=voice, speed=speed, lang=lang)
                assert rate == SR
                audio = audio.astype(np.float32)
                c_out = dict(cue); c_out['start'] = round(t, 3)
                parts.append(audio); t += len(audio) / SR
                c_out['end'] = round(t, 3)
                sc_out['cues'].append(c_out); n_cues += 1
                print(f'  {lid} cue {n_cues}: {c_out["end"]:.1f}s', end='\r', flush=True)
            if sc.get('checkpoint'):
                silence(GAP_CHECKPOINT)
                sc_out['checkpoint'] = dict(sc['checkpoint'], at=round(t, 3))
            sc_out['end'] = round(t, 3)
            ch_out['scenes'].append(sc_out)
        ch_out['end'] = round(t, 3)
        out['chapters'].append(ch_out)
    silence(0.8)

    audio = np.concatenate(parts)
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = (audio * min(1.0, 0.89 / peak)).astype(np.float32)  # gentle peak normalization
    media_dir = os.path.join(MEDIA, lid)
    os.makedirs(media_dir, exist_ok=True); os.makedirs(DATA, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'n.wav')
        sf.write(wav, audio, SR)
        mp3 = os.path.join(media_dir, 'narration.mp3')
        # One universal file: MP3 plays in every current browser, including Safari and Chromium builds without AAC.
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '48k', mp3], check=True)
        for old in ('narration.m4a', 'narration.webm'):
            if os.path.exists(os.path.join(media_dir, old)): os.remove(os.path.join(media_dir, old))

    duration = round(len(audio) / SR, 3)
    timing = {
        'id': lid, 'duration': duration, 'audio': f'media/lectures/{lid}/narration.mp3',
        'narration': {'engine': ENGINE, 'voice': voice, 'speed': v['speed'], 'cueGap': v['cueGap'], 'label': config()['default'].get('label') if voice_of({}) == v else None, 'hash': script_hash(s), 'license': 'Kokoro-82M model and voices: Apache-2.0'},
        'chapters': [{'start': ch['start'], 'end': ch['end'], 'scenes': [{'start': sc['start'], 'end': sc['end'], 'checkpointAt': sc.get('checkpoint', {}).get('at'), 'cues': [[c['start'], c['end']] for c in sc['cues']]} for sc in ch['scenes']]} for ch in out['chapters']],
    }
    with open(os.path.join(DATA, f'{lid}.json'), 'w', encoding='utf-8') as f:
        json.dump(timing, f, ensure_ascii=False, separators=(',', ':')); f.write('\n')

    cues = [c for ch in out['chapters'] for sc in ch['scenes'] for c in sc['cues']]
    with open(os.path.join(media_dir, 'captions.vtt'), 'w', encoding='utf-8') as f:
        f.write('WEBVTT\n\n')
        for i, c in enumerate(cues, 1):
            f.write(f'{i}\n{vtt_time(c["start"])} --> {vtt_time(c["end"])}\n{c["text"]}\n\n')
    with open(os.path.join(media_dir, 'transcript.txt'), 'w', encoding='utf-8') as f:
        f.write(f'{s["title"]}\n{s["subtitle"]}\nAPERTURE lecture transcript (narration synthesized with {ENGINE})\n\n')
        for ch in out['chapters']:
            f.write(f'\n{ch["title"].upper()}  [{vtt_time(ch["start"])[:8]}]\n\n')
            f.write(' '.join(c['text'] for sc in ch['scenes'] for c in sc['cues']) + '\n')
    print(f'\n✓ {lid}: {n_cues} cues, {duration / 60:.1f} min → {os.path.relpath(media_dir, ROOT)}')


def stale(lecture_file):
    with open(lecture_file, encoding='utf-8') as f:
        s = json.load(f)
    data = os.path.join(DATA, f'{s["id"]}.json')
    if not os.path.exists(data) or not os.path.exists(os.path.join(MEDIA, s['id'], 'narration.mp3')):
        return True
    with open(data, encoding='utf-8') as f:
        return json.load(f).get('narration', {}).get('hash') != script_hash(s)


if __name__ == '__main__':
    args = sys.argv[1:]
    cfg = config()
    release = cfg.get('release', [])
    every = sorted(f[:-5] for f in os.listdir(SRC) if f.endswith('.json'))
    path = lambda l: os.path.join(SRC, f'{l}.json')
    if args == ['--status']:
        for l in every:
            state = ('current' if not stale(path(l)) else 'needs rendering') if l in release else 'coming soon (script ready)'
            print(f'{l:7} {state}')
        n = sum(1 for l in release if not stale(path(l)))
        print(f'\nScripts: {len(every)} · released: {len(release)} · rendered and current: {n} · coming soon: {len(every) - len(release)}')
        sys.exit(0)
    if args == ['--all']:
        todo = [l for l in release if stale(path(l))]
    elif args and not any(a.startswith('-') for a in args):
        held = [a for a in args if a not in release]
        if held:
            sys.exit(f'Not released: {", ".join(held)}. Add them to "release" in aperture/content/narration.json '
                     'only once the owner authorizes rendering them.')
        todo = args
    else:
        sys.exit(__doc__)
    if not todo:
        print('All released lecture narration is up to date.')
    for l in todo:
        render(path(l))
