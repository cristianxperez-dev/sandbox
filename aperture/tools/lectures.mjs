// APERTURE lectures — validation and assembly (used by compile.mjs).
// Source:  aperture/content/lectures/<lesson>.json   (authored script: chapters → scenes → cues, visuals, checkpoints)
// Timings: aperture/build/narration/<id>.json        (written by narrate.py; must match the script's narration hash)
// Output:  apps/aperture/data/lectures/<id>.json      (served to the player) + an index entry in the course bundle.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const VISUALS = new Set(['title', 'numbers', 'statement', 'cards', 'anchor', 'tree', 'triples', 'grid', 'compare', 'replication', 'steps', 'next']);
const CHECKPOINTS = new Set(['estimate', 'choice', 'explore', 'reflect']);

export function narrationHash(s) {
  const cues = s.chapters.flatMap((ch) => ch.scenes.flatMap((sc) => sc.cues.map((c) => c.say || c.text)));
  // Mirrors Python json.dumps(..., separators=(',', ':'), ensure_ascii=False)
  const payload = JSON.stringify({ voice: s.voice, speed: s.speed ?? 1, cues });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function buildLectures({ base, appDir, lessonIds, resources, concepts, err }) {
  const dir = join(base, 'content', 'lectures');
  if (!existsSync(dir)) return { index: {}, files: {} };
  const index = {}, files = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const where = `lectures/${f}`;
    let s;
    try { s = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { err(where, `invalid JSON — ${e.message}`); continue; }
    if (!/^w\d{2}-l\d-lecture$/.test(s.id || '') || s.id !== `${s.lesson}-lecture`) err(where, 'id must be <lesson>-lecture');
    if (!lessonIds.has(s.lesson)) err(where, `unknown lesson ${s.lesson}`);
    for (const k of ['title', 'subtitle', 'voice', 'summary']) if (typeof s[k] !== 'string' || !s[k].trim()) err(where, `${k} missing`);
    if (!Array.isArray(s.chapters) || s.chapters.length < 2) { err(where, 'needs 2+ chapters'); continue; }
    const cpIds = new Set();
    const refs = new Set();
    let cueCount = 0;
    s.chapters.forEach((ch, ci) => {
      if (typeof ch.title !== 'string' || !Array.isArray(ch.scenes) || !ch.scenes.length) err(where, `chapter ${ci + 1} needs title and scenes`);
      (ch.scenes || []).forEach((sc, si) => {
        const w = `${where} ch${ci + 1} scene${si + 1}`;
        if (!sc.visual || !VISUALS.has(sc.visual.type)) err(w, `visual type "${sc.visual && sc.visual.type}" unknown`);
        (sc.visual?.refs || []).forEach((r) => refs.add(r));
        if (!Array.isArray(sc.cues) || !sc.cues.length) err(w, 'needs cues');
        (sc.cues || []).forEach((c) => {
          cueCount++;
          if (typeof c.text !== 'string' || c.text.length < 3) err(w, 'cue text missing');
          if (/<[a-z/]/i.test(c.text)) err(w, 'cue text contains HTML');
          if (c.reveal != null && !(Number.isInteger(c.reveal) && c.reveal >= 0)) err(w, 'reveal must be an integer ≥ 0');
          (c.refs || []).forEach((r) => refs.add(r));
        });
        const cp = sc.checkpoint;
        if (cp) {
          if (!CHECKPOINTS.has(cp.type)) err(w, `checkpoint type "${cp.type}" unknown`);
          if (!/^cp-[a-z0-9-]+$/.test(cp.id || '') || cpIds.has(cp.id)) err(w, 'checkpoint id cp-… missing or duplicate');
          cpIds.add(cp.id);
          if (typeof cp.prompt !== 'string') err(w, 'checkpoint prompt missing');
          if (cp.concept && !concepts[cp.concept]) err(w, `checkpoint concept ${cp.concept} unknown`);
          if (cp.type === 'choice' || cp.type === 'explore') {
            const ids = (cp.options || []).map((o) => o.id);
            if (ids.length < 2 || !ids.includes(cp.answer)) err(w, 'choice checkpoint needs options and a valid answer');
            for (const id of ids) if (!cp.feedback || typeof cp.feedback[id] !== 'string') err(w, `feedback missing for option ${id}`);
          }
          if (cp.type === 'estimate' && !(Number.isFinite(cp.answer) && Number.isFinite(cp.min) && Number.isFinite(cp.max))) err(w, 'estimate checkpoint needs min, max, answer');
        }
      });
    });
    for (const r of refs) if (!resources.has(r)) err(where, `unknown resource ${r}`);

    // Narration must exist and match the current script.
    const tf = join(base, 'build', 'narration', `${s.id}.json`);
    const audio = join(appDir, 'media', 'lectures', s.id, 'narration.m4a');
    if (!existsSync(tf) || !existsSync(audio)) { err(where, `narration missing — run python3 aperture/tools/narrate.py ${s.lesson}`); continue; }
    const t = JSON.parse(readFileSync(tf, 'utf8'));
    if (t.narration?.hash !== narrationHash(s)) { err(where, `narration is stale (script text changed) — run python3 aperture/tools/narrate.py ${s.lesson}`); continue; }
    // Merge timings into the script.
    const out = { ...s, duration: t.duration, minutes: Math.round(t.duration / 60), narration: t.narration,
      audio: `media/lectures/${s.id}/narration.m4a`, audioAlt: existsSync(join(appDir, 'media', 'lectures', s.id, 'narration.webm')) ? `media/lectures/${s.id}/narration.webm` : null, captions: `media/lectures/${s.id}/captions.vtt`, transcriptFile: `media/lectures/${s.id}/transcript.txt`,
      audioBytes: statSync(audio).size, refs: [...refs].sort(), chapters: [] };
    let ok = t.chapters.length === s.chapters.length;
    s.chapters.forEach((ch, ci) => {
      const tc = t.chapters[ci];
      if (!tc || tc.scenes.length !== ch.scenes.length) { ok = false; return; }
      out.chapters.push({ ...ch, start: tc.start, end: tc.end, scenes: ch.scenes.map((sc, si) => {
        const ts = tc.scenes[si];
        if (ts.cues.length !== sc.cues.length) ok = false;
        return { ...sc, start: ts.start, end: ts.end, cues: sc.cues.map((c, qi) => ({ ...c, start: ts.cues[qi]?.[0], end: ts.cues[qi]?.[1] })), checkpoint: sc.checkpoint ? { ...sc.checkpoint, at: ts.checkpointAt } : undefined };
      }) });
    });
    if (!ok) { err(where, 'timings do not match the script structure — re-run narrate.py'); continue; }
    files[s.id] = out;
    index[s.lesson] = { id: s.id, title: s.title, subtitle: s.subtitle, minutes: out.minutes, duration: out.duration, chapters: out.chapters.map((c) => c.title), checkpoints: cpIds.size, cues: cueCount, voice: s.voice };
  }
  return { index, files };
}
