/* APERTURE — API route handling, shared by both deployment modes.
   - Server mode: functions/apps/aperture/api/[[path]].js authenticates (Cloudflare Access) and calls
     handle() with the D1 store (aperture/server/store.js).
   - Public-beta mode: apps/aperture/local.js calls handle() in the browser with a localStorage
     store. Scoring and scheduling then run in the learner's browser.
   A store implements: ensureSchema, getState, getOne, putState, deleteState, countKind, addAttempt,
   updateAttemptSelf, getAttempt, listAttempts, getCards, upsertCard, activateCards, logEvent,
   listEvents, exportAll, deleteAll — all taking (db, owner, …). */

import { CONTENT, index, catalog, publicWeek, publicCapstone, publicMidterm, publicDiagnostic, stripKeys } from './content-core.js';
import { scoreQuestion, feedback, publicQuestion, selfScore, rubricScore, formatChecks, countWords } from './grading.js';
import { makeKinds, STATE_KINDS } from './kinds.js';
import { schedule, relapse, RATINGS, RULES_TEXT, INTERVAL_DAYS } from './srs.js';
import { computeProgress, autoRatio } from './insights.js';

const rid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').slice(0, 32));

// req: { method, path, params (URLSearchParams), body }. ctx: { store, db, owner, mode }
// Returns [status, data, extraHeaders?].
export async function handle(req, ctx) {
  const { method, path } = req;
  const q = req.params;
  const { store, db, owner } = ctx;
  const ix = index();
  await store.ensureSchema(db);

  if (method === 'GET') {
    switch (path) {
      case 'session': return [200, { email: ctx.mode === 'local' ? null : owner, mode: ctx.mode, now: Date.now(), version: CONTENT.schema }];
      case 'catalog': return [200, catalog()];
      case 'week': { const w = publicWeek(q.get('id') || ''); return w ? [200, w] : [404, { error: 'not_found' }]; }
      case 'library': return [200, { resources: CONTENT.library, manifest: CONTENT.manifest }];
      case 'audit': return CONTENT.audit ? [200, CONTENT.audit] : [404, { error: 'not_found' }];
      case 'capstone': return CONTENT.capstone ? [200, publicCapstone()] : [404, { error: 'not_found' }];
      case 'midterm': return CONTENT.midterm ? [200, publicMidterm()] : [404, { error: 'not_found' }];
      case 'diagnostic': return CONTENT.diagnostic ? [200, publicDiagnostic()] : [404, { error: 'not_found' }];
      case 'exercise': { const x = ix.exercises.get(q.get('id') || ''); return x ? [200, stripKeys(x)] : [404, { error: 'not_found' }]; }
      case 'assessment': return getAssessment(ctx, ix, q.get('id') || '', q.get('set') || 'main');
      case 'attempts': {
        const id = q.get('id') || '';
        if (id && !ix.assessments.has(id) && !ix.assignments.has(id)) return [404, { error: 'not_found' }];
        const list = await store.listAttempts(db, owner, id || null);
        return [200, { attempts: list.map(summaryOf) }];
      }
      case 'attempt': {
        const a = await store.getAttempt(db, owner, q.get('id') || '');
        return a ? [200, attemptDetail(a, ix)] : [404, { error: 'not_found' }];
      }
      case 'state': {
        const kinds = (q.get('kinds') || '').split(',').filter((k) => STATE_KINDS.includes(k));
        if (!kinds.length) return [400, { error: 'bad_request' }];
        return [200, await store.getState(db, owner, kinds)];
      }
      case 'review': return [200, await reviewQueue(ctx, ix)];
      case 'progress': {
        const [attempts, cards, state, events] = await Promise.all([
          store.listAttempts(db, owner), store.getCards(db, owner),
          store.getState(db, owner, ['progress', 'lab', 'reflection', 'case', 'journal', 'draft', 'lecture']), store.listEvents(db, owner, Date.now() - 90 * 86400000),
        ]);
        return [200, computeProgress({ attempts, cards, state, events })];
      }
      case 'export': return [200, await store.exportAll(db, owner), { 'Content-Disposition': 'attachment; filename="aperture-export.json"' }];
    }
    return [404, { error: 'not_found' }];
  }

  if (method === 'PUT' || method === 'POST' || method === 'DELETE') {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [400, { error: 'bad_request', message: 'The request was not valid JSON.' }];
    switch (`${method} ${path}`) {
      case 'PUT state': return putState(ctx, ix, body);
      case 'DELETE state': {
        if (!STATE_KINDS.includes(body.kind) || typeof body.key !== 'string') return [400, { error: 'bad_request' }];
        await store.deleteState(db, owner, body.kind, body.key);
        return [200, { ok: true }];
      }
      case 'POST assessment/submit': return submitAssessment(ctx, ix, body);
      case 'POST assessment/self': return selfAssess(ctx, ix, body);
      case 'POST assignment/submit': return submitAssignment(ctx, ix, body);
      case 'POST lab/reveal': {
        const x = ix.exercises.get(String(body.id || ''));
        if (!x) return [404, { error: 'not_found' }];
        await store.logEvent(db, owner, 'reveal', x.id);
        return [200, { config: x.config }];
      }
      case 'POST case/reveal': {
        const c = ix.cases.get(String(body.id || ''));
        if (!c) return [404, { error: 'not_found' }];
        const saved = await store.getOne(db, owner, 'case', c.id);
        if (!saved || countWords(saved.data.analysis) < 50) return [409, { error: 'analysis_required', message: 'Write and save your own analysis (50+ words) before reading the alternative perspectives.' }];
        await store.logEvent(db, owner, 'case-reveal', c.id);
        return [200, { perspectives: c.perspectives || [] }];
      }
      case 'POST review/grade': return gradeCard(ctx, ix, body);
      case 'POST review/activate': {
        const l = ix.lessons.get(String(body.lesson || ''));
        if (!l) return [404, { error: 'not_found' }];
        return [200, { activated: await activateLesson(ctx, ix, l.id) }];
      }
      case 'POST import': {
        if (!store.importAll) return [404, { error: 'not_found' }];
        return store.importAll(body, KINDS || (KINDS = kindsFor(ix)));
      }
      case 'POST delete-all': {
        if (body.confirm !== 'DELETE MY APERTURE DATA') return [400, { error: 'confirm_required' }];
        await store.deleteAll(db, owner);
        return [200, { ok: true }];
      }
    }
    return [404, { error: 'not_found' }];
  }
  return [405, { error: 'method_not_allowed' }];
}

/* ---------------- learner records ---------------- */
let KINDS = null;
const kindsFor = (ix) => makeKinds({ lessons: ix.lessons, targets: ix.targets, concepts: ix.concepts, weeks: ix.weeks, cases: ix.cases, exercises: ix.exercises, drafts: ix.drafts, lectures: ix.lectures });
export function validateRecord(ix, kind, key, data) {
  KINDS = KINDS || kindsFor(ix);
  const spec = KINDS[kind];
  if (!spec || typeof key !== 'string' || !spec.key(key) || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  try { return spec.clean(data); } catch { return null; }
}
async function putState(ctx, ix, body) {
  const { store, db, owner } = ctx;
  KINDS = KINDS || kindsFor(ix);
  const spec = KINDS[body.kind];
  const key = typeof body.key === 'string' ? body.key : '';
  if (!spec || !spec.key(key) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return [400, { error: 'bad_request', message: 'That record isn’t valid.' }];
  let data;
  try { data = spec.clean(body.data); } catch (e) { return [400, { error: 'bad_request', message: e.message }]; }
  if (spec.limit && !(await store.getOne(db, owner, body.kind, key)) && (await store.countKind(db, owner, body.kind)) >= spec.limit) return [413, { error: 'limit', message: 'Storage limit for this kind of record reached.' }];
  if (body.kind === 'progress') {
    const prev = await store.getOne(db, owner, 'progress', key);
    if (prev) data.seconds = Math.max(data.seconds, prev.data.seconds || 0);
    if (data.done && !(prev && prev.data.done)) { await activateLesson(ctx, ix, key); await store.logEvent(db, owner, 'lesson-done', key); }
    if (prev && prev.data.done) data.done = true;
  }
  const updated = await store.putState(db, owner, body.kind, key, data);
  return [200, { ok: true, updated, data }];
}
async function activateLesson(ctx, ix, lessonId) {
  const ids = [...ix.cards.values()].filter((c) => c.lesson === lessonId).map((c) => c.id);
  return ctx.store.activateCards(ctx.db, ctx.owner, ids, Date.now() + 86400000);
}

/* ---------------- assessments ---------------- */
async function itemSet(ctx, ix, id, set) {
  const a = ix.assessments.get(id);
  if (!a) return { error: [404, { error: 'not_found' }] };
  if (set === 'main') return { a, ids: a.main };
  if (set !== 'reassess' || !a.reserve.length) return { error: [400, { error: 'bad_request' }] };
  const prior = (await ctx.store.listAttempts(ctx.db, ctx.owner, id)).filter((x) => x.kind === 'quiz' || x.kind === 'midterm' || x.kind === 'reassess');
  if (!prior.length) return { error: [409, { error: 'not_eligible', message: 'Take the assessment once before reassessment.' }] };
  const last = prior[prior.length - 1];
  if (prior.some((x) => (autoRatio(x) ?? 0) >= a.mastery)) return { error: [409, { error: 'not_eligible', message: 'You have already reached mastery on this assessment.' }] };
  const missed = (last.data.items || []).filter((r) => r.score != null && r.score < 1).map((r) => r.id).filter((qid) => a.main.includes(qid));
  return { a, ids: [...new Set([...a.reserve, ...missed])].slice(0, 14) };
}
const stripOwner = ({ owner, ...q }) => q;
export const SCORING_RULES = 'Single-answer items: all or nothing. Select-all items: (correct picks − wrong picks) ÷ number correct, never below zero. Ranking: credit falls with the distance from the defensible order. Numerical: correct within the stated tolerance. Short responses: never auto-graded — you self-assess them against the rubric and model answer, and they are labelled self-assessed.';
async function getAssessment(ctx, ix, id, set) {
  const s = await itemSet(ctx, ix, id, set);
  if (s.error) return s.error;
  const items = s.ids.map((qid) => publicQuestion(stripOwner(ix.questions.get(qid))));
  return [200, { id, kind: s.a.kind, title: s.a.title, minutes: s.a.minutes || null, mastery: s.a.mastery, set, items, rules: SCORING_RULES }];
}
async function submitAssessment(ctx, ix, body) {
  const { store, db, owner } = ctx;
  const id = String(body.id || '');
  const set = body.set === 'reassess' ? 'reassess' : 'main';
  const s = await itemSet(ctx, ix, id, set);
  if (s.error) return s.error;
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const conf = body.confidence && typeof body.confidence === 'object' ? body.confidence : {};
  const results = [], items = [], short = [];
  let autoScore = 0, autoMax = 0;
  for (const qid of s.ids) {
    const qq = ix.questions.get(qid);
    const sc = scoreQuestion(qq, answers[qid]);
    const fb = feedback(qq, sc);
    results.push(fb);
    const pts = qq.points || 1;
    const c = Number(conf[qid]);
    const confidence = Number.isFinite(c) && c >= 50 && c <= 100 ? Math.round(c) : null;
    if (qq.type === 'short') { short.push(qid); items.push({ id: qid, type: qq.type, score: null, concepts: qq.concepts, domain: qq.domain, lesson: qq.lesson || null, response: sc.response }); continue; }
    autoScore += sc.score * pts; autoMax += pts;
    items.push({ id: qid, type: qq.type, score: sc.score, concepts: qq.concepts, domain: qq.domain, lesson: qq.lesson || null, errorTags: fb.errorTags || [], confidence, response: sc.response });
  }
  const kind = set === 'reassess' ? 'reassess' : s.a.kind;
  const attempt = { id: rid(), assessment: id, kind, submitted: Date.now(), autoScore, autoMax, selfScore: null, selfMax: null, data: { set, items, short, started: Number(body.started) || null } };
  await store.addAttempt(db, owner, attempt);
  const missedConcepts = new Set(items.filter((i) => i.score != null && i.score < 1).flatMap((i) => i.concepts || []));
  if (missedConcepts.size) {
    const cards = await store.getCards(db, owner);
    for (const c of cards) { const meta = ix.cards.get(c.card); if (meta && missedConcepts.has(meta.concept) && c.box > 1) await store.upsertCard(db, owner, relapse(c)); }
  }
  await store.logEvent(db, owner, 'assessment', id, { kind, ratio: autoMax ? autoScore / autoMax : null });
  const ratio = autoMax ? autoScore / autoMax : null;
  const mastered = s.a.mastery != null && ratio != null && ratio >= s.a.mastery;
  const focus = s.a.mastery != null && !mastered ? focusFor(ix, items) : null;
  return [200, { attempt: attempt.id, kind, autoScore, autoMax, ratio, mastery: s.a.mastery, mastered, results, focus, reassessAvailable: !mastered && s.a.reserve.length > 0, rules: SCORING_RULES }];
}
function focusFor(ix, items) {
  const missed = items.filter((i) => i.score != null && i.score < 1);
  const concepts = [...new Set(missed.flatMap((i) => i.concepts || []))].map((c) => ({ id: c, name: ix.concepts.get(c)?.name || c, lessons: ix.concepts.get(c)?.lessons || [] }));
  const lessons = [...new Set(missed.map((i) => i.lesson).filter(Boolean))].map((l) => ({ id: l, title: ix.lessons.get(l)?.title || l }));
  return { concepts, lessons, note: 'Review these lessons and concepts, then take the reassessment (reserve questions plus the items you missed).' };
}
async function selfAssess(ctx, ix, body) {
  const { store, db, owner } = ctx;
  const a = await store.getAttempt(db, owner, String(body.attempt || ''));
  if (!a) return [404, { error: 'not_found' }];
  const scores = body.scores && typeof body.scores === 'object' ? body.scores : {};
  let got = 0, max = 0;
  const selfItems = {};
  for (const qid of a.data.short || []) {
    const qq = ix.questions.get(qid);
    const r = selfScore(qq, scores[qid]);
    if (r == null) continue;
    const pts = qq.points || 1;
    got += r * pts; max += pts;
    selfItems[qid] = { ratio: r, scores: scores[qid] };
  }
  if (!max) return [400, { error: 'bad_request', message: 'Rate each short response against its rubric.' }];
  await store.updateAttemptSelf(db, owner, a.id, got, max, { ...a.data, self: selfItems, selfAt: Date.now() });
  return [200, { ok: true, selfScore: got, selfMax: max }];
}
function summaryOf(a) {
  return { id: a.id, assessment: a.assessment, kind: a.kind, submitted: a.submitted, autoScore: a.autoScore, autoMax: a.autoMax, selfScore: a.selfScore, selfMax: a.selfMax, ratio: a.autoMax ? a.autoScore / a.autoMax : null, pendingSelf: (a.data.short || []).length > 0 && a.selfMax == null, complete: a.data.complete ?? null };
}
function attemptDetail(a, ix) {
  const results = (a.data.items || []).map((it) => {
    const qq = ix.questions.get(it.id);
    if (!qq) return { id: it.id, missing: true };
    const fb = feedback(qq, { score: it.score, response: it.response, answered: it.response != null });
    return { ...fb, prompt: qq.prompt, stimulus: qq.stimulus || null, options: qq.options || null, confidence: it.confidence ?? null, self: a.data.self?.[it.id] || null };
  });
  return { ...summaryOf(a), results, checks: a.data.checks || null, sections: a.data.sections || null, rubric: a.data.rubric || null, aiFeedback: a.data.aiFeedback || null, metrics: a.data.metrics || null, rules: SCORING_RULES };
}

/* ---------------- assignments (and capstone deliverables) ---------------- */
async function submitAssignment(ctx, ix, body) {
  const { store, db, owner } = ctx;
  const asg = ix.assignments.get(String(body.id || ''));
  if (!asg) return [404, { error: 'not_found' }];
  const sections = Array.isArray(body.sections) ? body.sections.slice(0, 20).map((s) => (typeof s === 'string' ? s.slice(0, 40000) : '')) : [];
  const { checks, words } = formatChecks(asg, sections);
  const rub = {};
  for (const r of asg.rubric || []) { const v = Number(body.rubric && body.rubric[r.id]); if ([1, 2, 3, 4].includes(v)) rub[r.id] = v; }
  const { score, complete } = rubricScore(asg.rubric, rub);
  const text = sections.join('\n');
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => countWords(s) > 0);
  const metrics = { words, sentences: sentences.length, meanSentence: sentences.length ? words / sentences.length : 0, longSentences: sentences.filter((s) => countWords(s) > 25).length };
  const lowest = (asg.rubric || []).filter((r) => rub[r.id]).sort((a, b) => rub[a.id] - rub[b.id])[0];
  const aiFeedback = typeof body.aiFeedback === 'string' && body.aiFeedback.trim() ? body.aiFeedback.slice(0, 30000) : null;
  const attempt = {
    id: rid(), assessment: asg.id, kind: asg.capstone ? 'capstone' : 'assignment', submitted: Date.now(), autoScore: null, autoMax: null,
    selfScore: complete ? score : null, selfMax: complete ? 1 : null,
    data: { sections, rubric: rub, complete, checks, metrics, lowestCriterion: lowest ? lowest.criterion : null, aiFeedback, provenance: { checks: 'automated (format only)', rubric: 'self-assessed', aiFeedback: aiFeedback ? 'external AI review pasted by the learner' : null } },
  };
  await store.addAttempt(db, owner, attempt);
  await store.putState(db, owner, 'draft', asg.id, { sections, formats: {}, checklist: {}, words });
  await store.logEvent(db, owner, 'assignment', asg.id, { complete });
  return [200, { attempt: attempt.id, checks, metrics, selfScore: attempt.selfScore, complete }];
}

/* ---------------- spaced repetition ---------------- */
async function reviewQueue(ctx, ix) {
  const now = Date.now();
  const cards = await ctx.store.getCards(ctx.db, ctx.owner);
  const dueList = cards.filter((c) => c.due <= now && ix.cards.has(c.card)).sort((a, b) => a.due - b.due);
  const upcoming = [];
  for (let d = 1; d <= 7; d++) upcoming.push({ day: d, count: cards.filter((c) => c.due > now + (d - 1) * 86400000 && c.due <= now + d * 86400000).length });
  return {
    due: dueList.slice(0, 60).map((c) => { const m = ix.cards.get(c.card); return { card: c.card, box: c.box, front: m.front, back: m.back, concept: m.concept, conceptName: ix.concepts.get(m.concept)?.name || m.concept, lesson: m.lesson, week: m.week }; }),
    dueCount: dueList.length, activated: cards.length, upcoming,
    boxes: [1, 2, 3, 4, 5, 6].map((b) => ({ box: b, days: INTERVAL_DAYS[b], count: cards.filter((c) => c.box === b).length })),
    rules: RULES_TEXT,
  };
}
async function gradeCard(ctx, ix, body) {
  const id = String(body.card || '');
  if (!ix.cards.has(id) || !RATINGS.includes(body.rating)) return [400, { error: 'bad_request' }];
  const cards = await ctx.store.getCards(ctx.db, ctx.owner);
  const c = cards.find((x) => x.card === id);
  if (!c) return [409, { error: 'not_active', message: 'This card is not in your review schedule yet.' }];
  const next = schedule(c, body.rating, body.confidence);
  await ctx.store.upsertCard(ctx.db, ctx.owner, next);
  return [200, { card: id, box: next.box, due: next.due }];
}
