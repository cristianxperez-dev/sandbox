// APERTURE lectures — validation and assembly.
// Source:  aperture/content/lectures/<lesson>.json   (authored script: chapters → scenes → cues, visuals, checkpoints)
// Timings: aperture/build/narration/<id>.json        (written by narrate.py; must match the script's narration hash)
// Output:  apps/aperture/data/lectures/<id>.json      (served to the player) + an index entry in the course bundle.
//
// CLI (for authors; needs only aperture/build/content.json):
//   node aperture/tools/lectures.mjs --lint                 lint every script
//   node aperture/tools/lectures.mjs --lint w07-l3 w07-l4   lint some
//   node aperture/tools/lectures.mjs --audit                coverage + narration audit for every lesson
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const str = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;
const arr = (v, min = 1, max = 99) => Array.isArray(v) && v.length >= min && v.length <= max;
const words = (s) => (String(s).match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.%$-]*/g) || []).length;

// Per-visual required fields and the highest reveal step the visual uses.
const VISUALS = {
  title: { check: (v) => str(v.title), steps: () => 0 },
  statement: { check: (v) => arr(v.lines, 1, 4) && v.lines.every((l) => str(l)), steps: (v) => v.lines.length - 1 },
  numbers: { check: (v) => str(v.title) && arr(v.items, 2, 4) && v.items.every((i) => str(i.value) && str(i.label)), steps: (v) => v.items.length },
  cards: { check: (v) => str(v.title) && arr(v.cards, 2, 4) && v.cards.every((c) => str(c.title) && str(c.q) && str(c.fail)), steps: (v) => v.cards.length },
  compare: { check: (v) => str(v.title) && v.left && v.right && str(v.left.title) && str(v.right.title) && arr(v.left.points, 1, 5) && arr(v.right.points, 1, 5), steps: () => 2 },
  steps: { check: (v) => str(v.title) && arr(v.steps, 2, 7) && v.steps.every((x) => str(x)), steps: (v) => v.steps.length },
  grid: { check: (v) => str(v.title) && arr(v.cols, 2, 2) && arr(v.rows, 2, 2) && v.rows.every((r) => str(r.label) && arr(r.cells, 2, 2)) && arr(v.order, 4, 4), steps: () => 5 },
  flow: { check: (v) => str(v.title) && arr(v.steps, 2, 6) && v.steps.every((x) => str(x.label)), steps: (v) => v.steps.length },
  bars: { check: (v) => str(v.title) && arr(v.items, 2, 7) && v.items.every((i) => str(i.label) && Number.isFinite(i.value)) && str(v.note), steps: (v) => v.items.length },
  calc: { check: (v) => str(v.title) && arr(v.lines, 1, 6) && v.lines.every((l) => str(l.label) && str(l.value)) && v.result && str(v.result.label) && str(v.result.value), steps: (v) => v.lines.length + 1 },
  matrix: { check: (v) => str(v.title) && arr(v.x, 2, 2) && arr(v.y, 2, 2) && arr(v.cells, 2, 2) && v.cells.every((r) => arr(r, 2, 2) && r.every((c) => str(c))), steps: () => 4 },
  timeline: { check: (v) => str(v.title) && arr(v.events, 2, 7) && v.events.every((e) => str(e.when) && str(e.text)), steps: (v) => v.events.length },
  quote: { check: (v) => str(v.text) && words(v.text) <= 40 && str(v.who) && arr(v.refs, 1), steps: () => 1 },
  definition: { check: (v) => str(v.term) && str(v.definition), steps: (v) => (v.example ? 2 : 1) },
  next: { check: (v) => str(v.title) && arr(v.items, 1, 4) && v.items.every((i) => str(i.label) && str(i.detail) && /^(#check|#\/(exercise|library|assess|case|assignment|week|lesson)\/[A-Za-z0-9-]+)$/.test(i.href || '')), steps: () => 1 },
  // pilot-specific renderers
  tree: { check: (v) => Number.isFinite(v.population) && Number.isFinite(v.prevalence), steps: () => 5 },
  anchor: { check: (v) => Number.isFinite(v.low) && Number.isFinite(v.high), steps: () => 2 },
  triples: { check: (v) => str(v.example), steps: () => 1 },
  replication: { check: (v) => Number.isFinite(v.total), steps: () => 3 },
};
const CHECKPOINTS = new Set(['estimate', 'choice', 'explore', 'reflect']);

export function narrationHash(s) {
  const cues = s.chapters.flatMap((ch) => ch.scenes.flatMap((sc) => sc.cues.map((c) => c.say || c.text)));
  const payload = JSON.stringify({ voice: s.voice, speed: s.speed ?? 1, cues });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// Structural and academic lint of one script. ctx: { lessons: Map(id→lesson), resources: Set, concepts: obj, exercises: Set }
export function lintScript(s, ctx, err, warn = () => {}) {
  const where = `lectures/${s.lesson || '?'}`;
  if (!/^w\d{2}-l\d-lecture$/.test(s.id || '') || s.id !== `${s.lesson}-lecture`) err(where, 'id must be <lesson>-lecture');
  const lesson = ctx.lessons.get(s.lesson);
  if (!lesson) err(where, `unknown lesson ${s.lesson}`);
  for (const k of ['title', 'subtitle', 'voice', 'summary']) if (!str(s[k])) err(where, `${k} missing`);
  if (!arr(s.chapters, 3, 7)) { err(where, 'needs 3–7 chapters'); return null; }
  const cpIds = new Set(), refs = new Set();
  let cueCount = 0, wordCount = 0, cps = 0;
  s.chapters.forEach((ch, ci) => {
    if (!str(ch.title) || !arr(ch.scenes, 1, 8)) err(where, `chapter ${ci + 1} needs a title and 1–8 scenes`);
    (ch.scenes || []).forEach((sc, si) => {
      const w = `${where} ch${ci + 1}.s${si + 1}`;
      const spec = sc.visual && VISUALS[sc.visual.type];
      if (!spec) { err(w, `visual type "${sc.visual && sc.visual.type}" unknown`); return; }
      if (!spec.check(sc.visual)) err(w, `visual "${sc.visual.type}" is missing required fields`);
      (sc.visual.refs || []).forEach((r) => refs.add(r));
      if (!arr(sc.cues, 1, 14)) err(w, 'needs 1–14 cues');
      let maxReveal = 0;
      (sc.cues || []).forEach((c, qi) => {
        cueCount++;
        if (!str(c.text, 3)) err(w, `cue ${qi + 1} text missing`);
        if (/<[a-z/]/i.test(c.text || '') || /\[[^\]]+\]\(/.test(c.text || '')) err(w, `cue ${qi + 1}: plain spoken text only (no HTML or links)`);
        if (words(c.text) > 75) err(w, `cue ${qi + 1} is ${words(c.text)} words — split it (≤ 75)`);
        wordCount += words(c.text);
        if (c.reveal != null) { if (!(Number.isInteger(c.reveal) && c.reveal >= 0)) err(w, 'reveal must be an integer ≥ 0'); else maxReveal = Math.max(maxReveal, c.reveal); }
        (c.refs || []).forEach((r) => refs.add(r));
      });
      const need = spec.steps(sc.visual);
      if (need > 0 && maxReveal < need) err(w, `visual "${sc.visual.type}" has ${need} reveal steps but cues only reach ${maxReveal}`);
      const cp = sc.checkpoint;
      if (cp) {
        cps++;
        if (!CHECKPOINTS.has(cp.type)) err(w, `checkpoint type "${cp.type}" unknown`);
        if (!/^cp-[a-z0-9-]+$/.test(cp.id || '') || cpIds.has(cp.id)) err(w, 'checkpoint id cp-… missing or duplicate');
        cpIds.add(cp.id);
        if (!str(cp.prompt, 10)) err(w, 'checkpoint prompt missing');
        if (cp.concept && !ctx.concepts[cp.concept]) err(w, `checkpoint concept ${cp.concept} unknown`);
        if (cp.type === 'choice' || cp.type === 'explore') {
          const ids = (cp.options || []).map((o) => o.id);
          if (ids.length < 3 || !ids.includes(cp.answer)) err(w, 'choice checkpoint needs 3+ options and a valid answer');
          for (const id of ids) if (!cp.feedback || !str(cp.feedback[id], 10)) err(w, `feedback missing for option ${id}`);
        }
        if (cp.type === 'estimate') {
          if (!(Number.isFinite(cp.answer) && Number.isFinite(cp.min) && Number.isFinite(cp.max) && cp.min < cp.max && Number.isFinite(cp.initial))) err(w, 'estimate needs min < max, initial and answer');
          if (!cp.feedback || !str(cp.feedback.correct) || !str(cp.feedback.incorrect)) err(w, 'estimate needs feedback.correct and feedback.incorrect');
        }
      }
    });
  });
  if (cps < 1) err(where, 'needs at least one interactive checkpoint');
  if (cps > 6) err(where, 'at most 6 checkpoints');
  if (wordCount < 1000) err(where, `narration is ${wordCount} words — too short for a full lecture (≥ 1,000)`);
  if (wordCount > 2600) err(where, `narration is ${wordCount} words — too long (≤ 2,600)`);
  for (const r of refs) if (!ctx.resources.has(r)) err(where, `unknown resource ${r}`);
  if (lesson) {
    const lessonRefs = new Set((lesson.sources || []).map((x) => x.ref));
    if (![...refs].some((r) => lessonRefs.has(r))) err(where, "cites none of the lesson's own sources");
  }
  const last = s.chapters.at(-1).scenes.at(-1);
  if (!last || last.visual.type !== 'next') err(where, 'the final scene must be a "next" visual pointing to the check, exercise and readings');
  else for (const it of last.visual.items) { const m = (it.href || '').match(/^#\/exercise\/(.+)$/); if (m && !ctx.exercises.has(m[1])) err(where, `next links to unknown exercise ${m[1]}`); }
  return { refs, cps, cueCount, wordCount, cpIds };
}

export function buildLectures({ base, appDir, lessonIds, lessons, resources, concepts, exercises, err }) {
  const dir = join(base, 'content', 'lectures');
  if (!existsSync(dir)) return { index: {}, files: {} };
  const ctx = { lessons: lessons || new Map([...lessonIds].map((id) => [id, null])), resources, concepts, exercises: exercises || new Set() };
  const index = {}, files = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const where = `lectures/${f}`;
    let s;
    try { s = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { err(where, `invalid JSON — ${e.message}`); continue; }
    const before = err.count || 0;
    const lint = lintScript(s, ctx, (w, m) => { err(w, m); err.count = (err.count || 0) + 1; });
    if (!lint || (err.count || 0) > before) continue;
    const tf = join(base, 'build', 'narration', `${s.id}.json`);
    const t = existsSync(tf) ? JSON.parse(readFileSync(tf, 'utf8')) : null;
    const audioRel = t && t.audio ? t.audio : `media/lectures/${s.id}/narration.mp3`;
    const audio = join(appDir, audioRel);
    if (!t || !existsSync(audio)) { err(where, `narration missing — run python3 aperture/tools/narrate.py ${s.lesson}`); continue; }
    if (t.narration?.hash !== narrationHash(s)) { err(where, `narration is stale (script text changed) — run python3 aperture/tools/narrate.py ${s.lesson}`); continue; }
    const out = { ...s, duration: t.duration, minutes: Math.round(t.duration / 60), narration: t.narration,
      audio: audioRel, audioAlt: null, captions: `media/lectures/${s.id}/captions.vtt`, transcriptFile: `media/lectures/${s.id}/transcript.txt`,
      audioBytes: statSync(audio).size, refs: [...lint.refs].sort(), chapters: [] };
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
    index[s.lesson] = { id: s.id, title: s.title, subtitle: s.subtitle, minutes: out.minutes, duration: out.duration, chapters: out.chapters.map((c) => c.title), checkpoints: lint.cps, cues: lint.cueCount, voice: s.voice };
  }
  return { index, files };
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
  const C = JSON.parse(readFileSync(join(BASE, 'build', 'content.json'), 'utf8'));
  const lessons = new Map(C.weeks.flatMap((w) => w.lessons.map((l) => [l.id, l])));
  const exercises = new Set(C.weeks.flatMap((w) => [w.exercise.id, `${w.assignment.id}-studio`]));
  const ctx = { lessons, resources: new Set(C.library.map((r) => r.id)), concepts: C.concepts, exercises };
  const args = process.argv.slice(2);
  const dir = join(BASE, 'content', 'lectures');
  if (args[0] === '--lint') {
    const pick = args.slice(1);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && (!pick.length || pick.includes(f.replace('.json', ''))));
    let bad = 0;
    for (const f of files) {
      const errs = [];
      let s; try { s = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { console.log(`✖ ${f}: invalid JSON — ${e.message}`); bad++; continue; }
      const r = lintScript(s, ctx, (w, m) => errs.push(`${w}: ${m}`));
      if (errs.length) { bad++; console.log(`✖ ${f}\n  ${errs.join('\n  ')}`); }
      else console.log(`✓ ${f} — ${r.wordCount} words (~${Math.round(r.wordCount / 165)} min), ${r.cueCount} cues, ${r.cps} checkpoints, ${r.refs.size} sources`);
    }
    process.exit(bad ? 1 : 0);
  }
  if (args[0] === '--audit') {
    let ok = 0; const rows = [];
    for (const [id] of lessons) {
      const f = join(dir, `${id}.json`); const lid = `${id}-lecture`;
      const data = join(BASE, '..', 'apps', 'aperture', 'data', 'lectures', `${lid}.json`);
      const t = join(BASE, 'build', 'narration', `${lid}.json`);
      let status = 'no script';
      if (existsSync(f)) {
        const s = JSON.parse(readFileSync(f, 'utf8'));
        const tim = existsSync(t) ? JSON.parse(readFileSync(t, 'utf8')) : null;
        const audio = tim && join(BASE, '..', 'apps', 'aperture', tim.audio || `media/lectures/${lid}/narration.mp3`);
        if (!tim || !existsSync(audio)) status = 'not narrated';
        else if (tim.narration.hash !== narrationHash(s)) status = 'stale narration';
        else if (!existsSync(data)) status = 'not compiled';
        else if (!(C.lectures && C.lectures[id])) status = 'not indexed';
        else { status = `ok ${Math.round(tim.duration / 60)} min, ${(statSync(audio).size / 1048576).toFixed(1)} MB, ${C.lectures[id].checkpoints} checkpoints`; ok++; }
      }
      rows.push(`${id.padEnd(7)} ${status}`);
    }
    console.log(rows.join('\n'));
    console.log(`\nLessons: ${lessons.size} · functioning lectures: ${ok} · coverage ${((ok / lessons.size) * 100).toFixed(1)}%`);
    process.exit(ok === lessons.size ? 0 : 2);
  }
}
