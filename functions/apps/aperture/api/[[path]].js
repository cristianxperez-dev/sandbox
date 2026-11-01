/* APERTURE API — a Cloudflare Pages Function backed by Cloudflare D1.
   Serves /apps/aperture/api/* only (see site/_routes.json). The static page at /apps/aperture/
   is an empty shell: every lesson, reading, question, case and lab — and every byte of the
   learner's own data — is served from here, and only to a verified, allowed Cloudflare Access
   identity. Implementation lives in aperture/server/ (not published as static files).

   Security model
   - Access token verified on every request (signature, issuer, audience, expiry, allowlist).
   - Missing configuration → 503 for everything. Nothing is served by default.
   - Same-origin JSON only: X-Aperture header required, Origin must match.
   - Answer keys, hidden exercise material, case teaching notes and model answers never leave the
     server before the learner submits; grades and the review schedule are computed server-side.
   - Learner records are validated per kind (aperture/server/kinds.js); all SQL is parameterized
     and filtered by the signed-in email. Per-isolate throttles back up Access.
   Configuration: see aperture/server/auth.js and aperture/README.md. */

import { readConfig, authenticate, throttle } from '../../../../aperture/server/auth.js';
import * as store from '../../../../aperture/server/store.js';
import { CONTENT, index, catalog, publicWeek, publicCapstone, publicMidterm, publicDiagnostic, stripKeys } from '../../../../aperture/server/content.js';
import { scoreQuestion, feedback, publicQuestion, selfScore, rubricScore, formatChecks, countWords } from '../../../../aperture/server/grading.js';
import { makeKinds, STATE_KINDS } from '../../../../aperture/server/kinds.js';
import { schedule, relapse, RATINGS, RULES_TEXT, INTERVAL_DAYS } from '../../../../aperture/server/srs.js';
import { computeProgress, autoRatio } from '../../../../aperture/server/insights.js';

const MAX_BODY = 512 * 1024;
const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow' };

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/api\/?/, '').replace(/\/+$/, '');
    const method = request.method;

    const config = readConfig(env);
    if (!config) return json(503, { error: 'not_configured', message: 'APERTURE’s secure storage and sign-in are not set up yet.' });

    if (path === 'login' && method === 'GET') {
      const user = await authenticate(request, config);
      if (!user) return html(401, 'You are not signed in to APERTURE, or this address is not allowed to use it.');
      return new Response(null, { status: 302, headers: { Location: new URL('../', url).pathname + '#/', ...SECURITY_HEADERS } });
    }

    if (request.headers.get('X-Aperture') !== '1') return json(400, { error: 'bad_request' });
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json(403, { error: 'forbidden' });

    const user = await authenticate(request, config);
    if (!user) return json(401, { error: 'unauthorized', message: 'Sign in to APERTURE to continue.' });
    const email = user.email;

    const wait = throttle(email, 'all', 900, 5 * 60 * 1000) || (method !== 'GET' ? throttle(email, 'write', 300, 5 * 60 * 1000) : 0);
    if (wait) return json(429, { error: 'rate_limited', message: 'Too many requests. Try again shortly.' }, { 'Retry-After': String(wait) });

    const db = env.APERTURE_DB;
    await store.ensureSchema(db);
    const ix = index();
    const q = url.searchParams;

    if (method === 'GET') {
      switch (path) {
        case 'session': return json(200, { email, expires: user.exp, now: Date.now(), version: CONTENT.schema });
        case 'catalog': return json(200, catalog());
        case 'week': { const w = publicWeek(q.get('id') || ''); return w ? json(200, w) : json(404, { error: 'not_found' }); }
        case 'library': return json(200, { resources: CONTENT.library, manifest: CONTENT.manifest });
        case 'audit': return CONTENT.audit ? json(200, CONTENT.audit) : json(404, { error: 'not_found' });
        case 'capstone': return CONTENT.capstone ? json(200, publicCapstone()) : json(404, { error: 'not_found' });
        case 'midterm': return CONTENT.midterm ? json(200, publicMidterm()) : json(404, { error: 'not_found' });
        case 'diagnostic': return CONTENT.diagnostic ? json(200, publicDiagnostic()) : json(404, { error: 'not_found' });
        case 'exercise': { const x = ix.exercises.get(q.get('id') || ''); return x ? json(200, stripKeys(x)) : json(404, { error: 'not_found' }); }
        case 'assessment': return json(...await getAssessment(db, email, ix, q.get('id') || '', q.get('set') || 'main'));
        case 'attempts': {
          const id = q.get('id') || '';
          if (id && !ix.assessments.has(id) && !ix.assignments.has(id)) return json(404, { error: 'not_found' });
          const list = await store.listAttempts(db, email, id || null);
          return json(200, { attempts: list.map(summaryOf) });
        }
        case 'attempt': {
          const a = await store.getAttempt(db, email, q.get('id') || '');
          return a ? json(200, attemptDetail(a, ix)) : json(404, { error: 'not_found' });
        }
        case 'state': {
          const kinds = (q.get('kinds') || '').split(',').filter((k) => STATE_KINDS.includes(k));
          if (!kinds.length) return json(400, { error: 'bad_request' });
          return json(200, await store.getState(db, email, kinds));
        }
        case 'review': return json(200, await reviewQueue(db, email, ix));
        case 'progress': {
          const [attempts, cards, state, events] = await Promise.all([
            store.listAttempts(db, email), store.getCards(db, email),
            store.getState(db, email, ['progress', 'lab', 'reflection', 'case', 'journal', 'draft']), store.listEvents(db, email, Date.now() - 90 * 86400000),
          ]);
          return json(200, computeProgress({ attempts, cards, state, events }));
        }
        case 'export': return json(200, await store.exportAll(db, email), { 'Content-Disposition': 'attachment; filename="aperture-export.json"' });
      }
      return json(404, { error: 'not_found' });
    }

    if (method === 'PUT' || method === 'POST' || method === 'DELETE') {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'bad_request', message: 'The request was not valid JSON.' });
      const submitWait = /submit|self|grade|reveal/.test(path) ? throttle(email, 'submit', 120, 10 * 60 * 1000) : 0;
      if (submitWait) return json(429, { error: 'rate_limited', message: 'Too many submissions. Try again shortly.' }, { 'Retry-After': String(submitWait) });
      switch (`${method} ${path}`) {
        case 'PUT state': return json(...await putState(db, email, ix, body));
        case 'DELETE state': {
          if (!STATE_KINDS.includes(body.kind) || typeof body.key !== 'string') return json(400, { error: 'bad_request' });
          await store.deleteState(db, email, body.kind, body.key);
          return json(200, { ok: true });
        }
        case 'POST assessment/submit': return json(...await submitAssessment(db, email, ix, body));
        case 'POST assessment/self': return json(...await selfAssess(db, email, ix, body));
        case 'POST assignment/submit': return json(...await submitAssignment(db, email, ix, body));
        case 'POST lab/reveal': {
          const x = ix.exercises.get(String(body.id || ''));
          if (!x) return json(404, { error: 'not_found' });
          await store.logEvent(db, email, 'reveal', x.id);
          return json(200, { config: x.config });
        }
        case 'POST case/reveal': {
          const c = ix.cases.get(String(body.id || ''));
          if (!c) return json(404, { error: 'not_found' });
          const saved = await store.getOne(db, email, 'case', c.id);
          if (!saved || countWords(saved.data.analysis) < 50) return json(409, { error: 'analysis_required', message: 'Write and save your own analysis (50+ words) before reading the alternative perspectives.' });
          await store.logEvent(db, email, 'case-reveal', c.id);
          return json(200, { perspectives: c.perspectives || [] });
        }
        case 'POST review/grade': return json(...await gradeCard(db, email, ix, body));
        case 'POST review/activate': {
          const l = ix.lessons.get(String(body.lesson || ''));
          if (!l) return json(404, { error: 'not_found' });
          const n = await activateLesson(db, email, ix, l.id);
          return json(200, { activated: n });
        }
        case 'POST delete-all': {
          if (body.confirm !== 'DELETE MY APERTURE DATA') return json(400, { error: 'confirm_required' });
          await store.deleteAll(db, email);
          return json(200, { ok: true });
        }
      }
      return json(404, { error: 'not_found' });
    }
    return json(405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('aperture api', (err && err.message) || err);
    return json(500, { error: 'server_error', message: 'Something went wrong on the server. Nothing you saved was lost.' });
  }
}

/* ---------------- responses ---------------- */
function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}
function html(status, message) {
  const safe = message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>APERTURE</title><p style="font:16px Georgia,serif;color:#252525;background:#F2EBDD;max-width:32em;margin:40px auto;padding:0 20px">${safe} <a href="../">Back to APERTURE</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return null;
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
const rid = () => crypto.randomUUID().replace(/-/g, '');

/* ---------------- learner records ---------------- */
let KINDS = null;
async function putState(db, email, ix, body) {
  KINDS = KINDS || makeKinds({ lessons: ix.lessons, targets: ix.targets, concepts: ix.concepts, weeks: ix.weeks, cases: ix.cases, exercises: ix.exercises, drafts: ix.drafts });
  const spec = KINDS[body.kind];
  const key = typeof body.key === 'string' ? body.key : '';
  if (!spec || !spec.key(key) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return [400, { error: 'bad_request', message: 'That record isn’t valid.' }];
  let data;
  try { data = spec.clean(body.data); } catch (e) { return [400, { error: 'bad_request', message: e.message }]; }
  if (spec.limit && !(await store.getOne(db, email, body.kind, key)) && (await store.countKind(db, email, body.kind)) >= spec.limit) return [413, { error: 'limit', message: 'Storage limit for this kind of record reached.' }];
  if (body.kind === 'progress') {
    const prev = await store.getOne(db, email, 'progress', key);
    if (prev) data.seconds = Math.max(data.seconds, prev.data.seconds || 0); // time on task never goes backwards
    if (data.done && !(prev && prev.data.done)) { await activateLesson(db, email, ix, key); await store.logEvent(db, email, 'lesson-done', key); }
    if (prev && prev.data.done) data.done = true;
  }
  const updated = await store.putState(db, email, body.kind, key, data);
  return [200, { ok: true, updated, data }];
}

async function activateLesson(db, email, ix, lessonId) {
  const ids = [...ix.cards.values()].filter((c) => c.lesson === lessonId).map((c) => c.id);
  return store.activateCards(db, email, ids, Date.now() + 86400000);
}

/* ---------------- assessments ---------------- */
async function itemSet(db, email, ix, id, set) {
  const a = ix.assessments.get(id);
  if (!a) return { error: [404, { error: 'not_found' }] };
  if (set === 'main') return { a, ids: a.main };
  if (set !== 'reassess' || !a.reserve.length) return { error: [400, { error: 'bad_request' }] };
  const prior = (await store.listAttempts(db, email, id)).filter((x) => x.kind === 'quiz' || x.kind === 'midterm' || x.kind === 'reassess');
  if (!prior.length) return { error: [409, { error: 'not_eligible', message: 'Take the assessment once before reassessment.' }] };
  const last = prior[prior.length - 1];
  if (prior.some((x) => (autoRatio(x) ?? 0) >= a.mastery)) return { error: [409, { error: 'not_eligible', message: 'You have already reached mastery on this assessment.' }] };
  const missed = (last.data.items || []).filter((r) => r.score != null && r.score < 1).map((r) => r.id).filter((qid) => a.main.includes(qid));
  const ids = [...new Set([...a.reserve, ...missed])].slice(0, 14);
  return { a, ids };
}

async function getAssessment(db, email, ix, id, set) {
  const s = await itemSet(db, email, ix, id, set);
  if (s.error) return s.error;
  const items = s.ids.map((qid) => publicQuestion(stripOwner(ix.questions.get(qid))));
  return [200, { id, kind: s.a.kind, title: s.a.title, minutes: s.a.minutes || null, mastery: s.a.mastery, set, items, rules: SCORING_RULES }];
}
const stripOwner = ({ owner, ...q }) => q;
const SCORING_RULES = 'Single-answer items: all or nothing. Select-all items: (correct picks − wrong picks) ÷ number correct, never below zero. Ranking: credit falls with the distance from the defensible order. Numerical: correct within the stated tolerance. Short responses: never auto-graded — you self-assess them against the rubric and model answer, and they are labelled self-assessed.';

async function submitAssessment(db, email, ix, body) {
  const id = String(body.id || '');
  const set = body.set === 'reassess' ? 'reassess' : 'main';
  const s = await itemSet(db, email, ix, id, set);
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
  await store.addAttempt(db, email, attempt);
  // Missed concepts send their activated review cards back to box 1.
  const missedConcepts = new Set(items.filter((i) => i.score != null && i.score < 1).flatMap((i) => i.concepts || []));
  if (missedConcepts.size) {
    const cards = await store.getCards(db, email);
    for (const c of cards) { const meta = ix.cards.get(c.card); if (meta && missedConcepts.has(meta.concept) && c.box > 1) await store.upsertCard(db, email, relapse(c)); }
  }
  await store.logEvent(db, email, 'assessment', id, { kind, ratio: autoMax ? autoScore / autoMax : null });
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

async function selfAssess(db, email, ix, body) {
  const a = await store.getAttempt(db, email, String(body.attempt || ''));
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
  const data = { ...a.data, self: selfItems, selfAt: Date.now() };
  await store.updateAttemptSelf(db, email, a.id, got, max, data);
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
async function submitAssignment(db, email, ix, body) {
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
  await store.addAttempt(db, email, attempt);
  await store.putState(db, email, 'draft', asg.id, { sections, formats: {}, checklist: {}, words });
  await store.logEvent(db, email, 'assignment', asg.id, { complete });
  return [200, { attempt: attempt.id, checks, metrics, selfScore: attempt.selfScore, complete }];
}

/* ---------------- spaced repetition ---------------- */
async function reviewQueue(db, email, ix) {
  const now = Date.now();
  const cards = await store.getCards(db, email);
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
async function gradeCard(db, email, ix, body) {
  const id = String(body.card || '');
  if (!ix.cards.has(id) || !RATINGS.includes(body.rating)) return [400, { error: 'bad_request' }];
  const cards = await store.getCards(db, email);
  const c = cards.find((x) => x.card === id);
  if (!c) return [409, { error: 'not_active', message: 'This card is not in your review schedule yet.' }];
  const next = schedule(c, body.rating, body.confidence);
  await store.upsertCard(db, email, next);
  return [200, { card: id, box: next.box, due: next.due }];
}
