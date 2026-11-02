/* APERTURE — progress, transcript and learning profile. Everything here is computed from the
   learner's actual responses; an insight appears only when its evidence threshold is met, and it
   carries the rule and the evidence that produced it. No personality or psychological claims. */

import { CONTENT, index } from './content-core.js';
import { INTERVAL_DAYS, RULES_TEXT } from './srs.js';

const DOMAIN_LABEL = {
  'behavioral-science': 'Behavioral science', 'statistical-reasoning': 'Statistical reasoning', 'business-strategy': 'Business strategy',
  'financial-literacy': 'Financial literacy', 'legal-reasoning': 'Legal reasoning', negotiation: 'Negotiation',
  'organizational-behavior': 'Organizational behavior', 'leadership-judgment': 'Leadership judgment', communication: 'Communication',
};
export { DOMAIN_LABEL };
const pct = (x) => Math.round(x * 100);
const humanTag = (t) => t.replace(/-/g, ' ');

// Combined score of an attempt: auto-graded points + self-assessed short-answer points.
export function attemptScore(a) {
  const max = (a.autoMax || 0) + (a.selfMax || 0);
  return max ? ((a.autoScore || 0) + (a.selfScore || 0)) / max : null;
}
export function autoRatio(a) { return a.autoMax ? a.autoScore / a.autoMax : null; }

export function computeProgress({ attempts, cards, state, events, now = Date.now() }) {
  const ix = index();
  const byAssessment = new Map();
  for (const a of attempts) { if (!byAssessment.has(a.assessment)) byAssessment.set(a.assessment, []); byAssessment.get(a.assessment).push(a); }
  const best = (id, kinds) => {
    const list = (byAssessment.get(id) || []).filter((a) => !kinds || kinds.includes(a.kind));
    let b = null; for (const a of list) { const s = attemptScore(a); if (s !== null && (!b || s > b.s)) b = { s, a }; }
    return b;
  };
  const latest = (id) => { const l = byAssessment.get(id) || []; return l[l.length - 1] || null; };

  /* ---------- weeks ---------- */
  const progress = state.progress || {};
  const weeks = CONTENT.weeks.map((w) => {
    const done = w.lessons.filter((l) => progress[l.id]?.data?.done).length;
    const q = best(w.quiz.id, ['quiz', 'reassess']);
    const lastQ = latest(w.quiz.id);
    const asg = latest(w.assignment.id);
    return {
      id: w.id, number: w.number, title: w.title,
      lessonsDone: done, lessonsTotal: w.lessons.length,
      quiz: q ? { best: q.s, auto: autoRatio(q.a), mastered: (autoRatio(q.a) ?? 0) >= 0.8, attempts: (byAssessment.get(w.quiz.id) || []).length, pendingSelf: lastQ ? (lastQ.data.short || []).length > 0 && lastQ.selfMax == null : false } : null,
      assignment: asg ? { submitted: asg.submitted, score: asg.selfScore, complete: asg.data.complete } : null,
      exercise: !!state.lab?.[w.exercise.id]?.data?.finished,
      reflection: !!(state.reflection?.[w.id]?.data?.answers || []).some((t) => t && t.trim()),
      caseAnalysis: !!(state.case?.[w.case.id]?.data?.analysis || '').trim(),
      lectures: w.lessons.filter((l) => CONTENT.lectures && CONTENT.lectures[l.id]).map((l) => ({ lesson: l.id, id: CONTENT.lectures[l.id].id, completed: !!state.lecture?.[CONTENT.lectures[l.id].id]?.data?.completed })),
      started: done > 0 || !!q,
    };
  });

  /* ---------- transcript (grade-based) ---------- */
  const quizScores = weeks.filter((w) => w.quiz).map((w) => w.quiz.best);
  const asgScores = weeks.filter((w) => w.assignment && w.assignment.score != null).map((w) => w.assignment.score);
  const mid = best('midterm', ['midterm', 'reassess']);
  const capDel = CONTENT.capstone ? CONTENT.capstone.deliverables.map((d) => latest(`capstone-${d.id}`)).filter((a) => a && a.selfScore != null) : [];
  const g = CONTENT.semester.grading;
  const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const components = [
    { id: 'quizzes', label: 'Weekly quizzes', weight: g.quizzes, completed: quizScores.length, of: CONTENT.weeks.length, score: avg(quizScores), basis: 'Best attempt per week. Auto-graded items plus your self-assessed short responses (labelled).' },
    { id: 'assignments', label: 'Applied assignments', weight: g.assignments, completed: asgScores.length, of: CONTENT.weeks.length, score: avg(asgScores), basis: 'Self-assessed against each rubric. Automated checks cover format only — never content.' },
    { id: 'midterm', label: 'Midterm', weight: g.midterm, completed: mid ? 1 : 0, of: CONTENT.midterm ? 1 : 0, score: mid ? mid.s : null, basis: 'Best attempt. Auto-graded items plus self-assessed short responses.' },
    { id: 'capstone', label: 'Capstone', weight: g.capstone, completed: capDel.length, of: CONTENT.capstone ? CONTENT.capstone.deliverables.length : 0, score: capDel.length ? avg(capDel.map((a) => a.selfScore)) : null, basis: 'Self-assessed against each deliverable rubric.' },
  ];
  const counted = components.filter((c) => c.score != null);
  const wsum = counted.reduce((a, c) => a + c.weight, 0);
  const standing = wsum ? counted.reduce((a, c) => a + c.weight * c.score, 0) / wsum : null;

  /* ---------- item-level evidence ---------- */
  const items = []; // every auto-graded item response
  const confidenceItems = [];
  for (const a of attempts) {
    for (const r of a.data.items || []) {
      if (r.score == null) continue;
      items.push({ ...r, assessment: a.assessment, kind: a.kind, at: a.submitted });
      if (Number.isFinite(r.confidence)) confidenceItems.push({ c: r.confidence / 100, s: r.score });
    }
  }
  const conceptStats = new Map();
  for (const it of items) for (const c of it.concepts || []) {
    const s = conceptStats.get(c) || { n: 0, sum: 0, last: 0 };
    s.n++; s.sum += it.score; s.last = Math.max(s.last, it.at); conceptStats.set(c, s);
  }

  /* ---------- review schedule ---------- */
  const cardByConcept = new Map();
  for (const c of cards) { const meta = ix.cards.get(c.card); if (!meta) continue; if (!cardByConcept.has(meta.concept)) cardByConcept.set(meta.concept, []); cardByConcept.get(meta.concept).push(c); }
  const due = cards.filter((c) => c.due <= now).length;
  const introduced = new Set([...conceptStats.keys(), ...cardByConcept.keys()].filter((c) => ix.concepts.has(c)));
  const concepts = [...introduced].map((id) => {
    const meta = ix.concepts.get(id); const s = conceptStats.get(id); const cs = cardByConcept.get(id) || [];
    const acc = s ? s.sum / s.n : null;
    const minBox = cs.length ? Math.min(...cs.map((c) => c.box)) : null;
    const dueNow = cs.some((c) => c.due <= now);
    const mastered = s && s.n >= 3 && acc >= 0.8 && (!cs.length || minBox >= 4);
    const review = dueNow || (s && s.n >= 2 && acc < 0.8);
    return { id, name: meta.name, domain: meta.domain, weeks: meta.weeks, accuracy: acc, n: s ? s.n : 0, minBox, due: dueNow, status: mastered ? 'mastered' : review ? 'review' : 'introduced' };
  }).sort((a, b) => a.weeks[0].localeCompare(b.weeks[0]) || a.name.localeCompare(b.name));

  /* ---------- domains ---------- */
  const diag = latest('diagnostic');
  const domains = Object.keys(DOMAIN_LABEL).map((d) => {
    const its = items.filter((i) => i.domain === d && i.assessment !== 'diagnostic');
    const dg = diag ? (diag.data.items || []).filter((i) => i.domain === d && i.score != null) : [];
    return { domain: d, label: DOMAIN_LABEL[d], n: its.length, accuracy: its.length ? its.reduce((a, i) => a + i.score, 0) / its.length : null, diagnostic: dg.length ? dg.reduce((a, i) => a + i.score, 0) / dg.length : null, diagnosticN: dg.length };
  });

  /* ---------- common errors ---------- */
  const tagCount = new Map();
  for (const it of items) for (const t of it.errorTags || []) { const e = tagCount.get(t) || { tag: t, count: 0, items: [] }; e.count++; e.items.push(it.id); tagCount.set(t, e); }
  const errors = [...tagCount.values()].sort((a, b) => b.count - a.count);
  const missedConcepts = [...conceptStats.entries()].filter(([, s]) => s.n >= 2 && s.sum / s.n < 0.6).map(([c, s]) => ({ concept: c, name: ix.concepts.get(c)?.name || c, n: s.n, accuracy: s.sum / s.n }));

  /* ---------- calibration ---------- */
  const calQuiz = confidenceItems.length ? { n: confidenceItems.length, meanConfidence: avg(confidenceItems.map((x) => x.c)), accuracy: avg(confidenceItems.map((x) => x.s)), brier: avg(confidenceItems.map((x) => (x.c - (x.s === 1 ? 1 : 0)) ** 2)) } : null;
  const labCal = Object.entries(state.lab || {}).filter(([id]) => ix.exercises.get(id)?.engine === 'calibration').map(([, v]) => v.data.summary).filter(Boolean);
  const forecasts = Object.values(state.journal || {}).flatMap((j) => (j.data.forecasts || []).filter((f) => f.outcome !== null));
  const calJournal = forecasts.length ? { n: forecasts.length, brier: avg(forecasts.map((f) => (f.p - (f.outcome ? 1 : 0)) ** 2)) } : null;

  /* ---------- retention ---------- */
  const reviewsAll = cards.flatMap((c) => c.history || []).filter((h) => h.rating !== 'quiz-miss');
  const recent = reviewsAll.filter((h) => h.at >= now - 30 * 86400000);
  const retention = {
    activated: cards.length, due, retained: cards.filter((c) => c.box >= 4).length,
    reviews30: recent.length, recall30: recent.length ? recent.filter((h) => h.rating !== 'again').length / recent.length : null,
    boxes: [1, 2, 3, 4, 5, 6].map((b) => ({ box: b, days: INTERVAL_DAYS[b], count: cards.filter((c) => c.box === b).length })),
    rules: RULES_TEXT,
  };

  /* ---------- cross-disciplinary connections: concepts met in 2+ weeks ---------- */
  const connections = concepts.filter((c) => c.weeks.length > 1).map((c) => ({ id: c.id, name: c.name, weeks: c.weeks }));

  /* ---------- time ---------- */
  const seconds = Object.values(progress).reduce((a, p) => a + (p.data.seconds || 0), 0);

  /* ---------- insights (evidence thresholds) ---------- */
  const insights = [];
  for (const d of domains) {
    if (d.n >= 6 && d.accuracy >= 0.85) insights.push({ kind: 'strength', text: `You have answered ${d.label.toLowerCase()} items correctly ${pct(d.accuracy)}% of the time across ${d.n} graded items.`, rule: 'Shown when a domain has 6+ graded items (diagnostic excluded) at 85%+ accuracy.' });
    if (d.n >= 6 && d.accuracy < 0.65) {
      const weak = missedConcepts.filter((m) => ix.concepts.get(m.concept)?.domain === d.domain).slice(0, 3).map((m) => m.name);
      insights.push({ kind: 'gap', text: `${d.label} is your least secure area so far: ${pct(d.accuracy)}% across ${d.n} items${weak.length ? `, with most misses on ${weak.join(', ')}` : ''}.`, rule: 'Shown when a domain has 6+ graded items below 65% accuracy.' });
    }
    if (d.diagnostic != null && d.diagnosticN >= 3 && d.diagnostic < 0.5 && d.n >= 6 && d.accuracy >= 0.8) insights.push({ kind: 'growth', text: `${d.label}: ${pct(d.diagnostic)}% on the Week 1 diagnostic, ${pct(d.accuracy)}% on ${d.n} later items.`, rule: 'Shown when a diagnostic domain under 50% is followed by 6+ later items at 80%+.' });
  }
  const strong = [...conceptStats.entries()].filter(([, s]) => s.n >= 3 && s.sum / s.n >= 0.85);
  const weakC = [...conceptStats.entries()].filter(([, s]) => s.n >= 3 && s.sum / s.n <= 0.5);
  for (const [wc, ws] of weakC.slice(0, 3)) {
    const dom = ix.concepts.get(wc)?.domain;
    const pair = strong.find(([sc]) => ix.concepts.get(sc)?.domain === dom);
    if (pair) insights.push({ kind: 'contrast', text: `You consistently answer items on ${ix.concepts.get(pair[0]).name} correctly (${Math.round(pair[1].sum)} of ${pair[1].n}) but have had difficulty with ${ix.concepts.get(wc).name} (${Math.round(ws.sum)} of ${ws.n}).`, rule: 'Shown when, within one domain, one concept has 3+ items at 85%+ and another 3+ items at 50% or less.' });
  }
  for (const e of errors.filter((e) => e.count >= 2).slice(0, 3)) insights.push({ kind: 'pattern', text: `In ${e.count} answers you chose an option reflecting “${humanTag(e.tag)}”.`, rule: 'Shown when the same reasoning error (tagged on a wrong option) appears in 2+ of your answers.', evidence: e.items });
  if (calQuiz && calQuiz.n >= 10) {
    const gap = calQuiz.meanConfidence - calQuiz.accuracy;
    if (Math.abs(gap) >= 0.1) insights.push({ kind: 'calibration', text: `Across ${calQuiz.n} rated answers your average confidence was ${pct(calQuiz.meanConfidence)}% and your accuracy ${pct(calQuiz.accuracy)}% — ${gap > 0 ? 'overconfident' : 'underconfident'} by ${pct(Math.abs(gap))} points.`, rule: 'Shown after 10+ answers with a confidence rating when confidence and accuracy differ by 10+ points.' });
  }
  const subs = attempts.filter((a) => a.kind === 'assignment' && a.data.metrics);
  if (subs.length >= 3) {
    const msl = avg(subs.map((a) => a.data.metrics.meanSentence));
    if (msl > 22) insights.push({ kind: 'writing', text: `Your submitted assignments average ${msl.toFixed(1)} words per sentence across ${subs.length} submissions. Executive readers usually absorb recommendations faster in shorter sentences; check whether your recommendation leads.`, rule: 'Shown after 3+ assignment submissions when mean sentence length exceeds 22 words (a readability measure, not a content judgment).' });
    const lowest = new Map();
    for (const a of subs) { const r = a.data.lowestCriterion; if (r) lowest.set(r, (lowest.get(r) || 0) + 1); }
    const top = [...lowest.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 3) insights.push({ kind: 'writing', text: `In ${top[1]} of your self-assessments, the criterion you rated lowest concerned “${top[0]}”.`, rule: 'Shown when the same lowest-rated rubric criterion recurs in 3+ self-assessments (your own ratings).' });
  }
  for (const [cid, cs] of cardByConcept) {
    const lapses = cs.reduce((a, c) => a + (c.lapses || 0), 0);
    if (lapses >= 3 && ix.concepts.get(cid)) insights.push({ kind: 'retention', text: `Review cards on ${ix.concepts.get(cid).name} have slipped back to box 1 ${lapses} times. Re-reading ${ix.concepts.get(cid).lessons[0] || 'its lesson'} before the next review may help.`, rule: 'Shown when a concept\'s cards record 3+ “Again” ratings.' });
  }

  return {
    weeks,
    transcript: { components, standing, completedWeight: wsum, note: 'Current standing averages only the components you have completed, using their published weights. APERTURE is an independent learning program: no academic credit, accreditation or university affiliation is implied.' },
    concepts: { introduced: concepts.length, mastered: concepts.filter((c) => c.status === 'mastered').length, review: concepts.filter((c) => c.status === 'review').length, list: concepts },
    domains, errors: errors.slice(0, 12), missedConcepts: missedConcepts.slice(0, 12),
    calibration: { quiz: calQuiz, lab: labCal.slice(-5), journal: calJournal },
    retention, connections, time: { seconds: seconds + Object.values(state.lecture || {}).reduce((a, r) => a + (r.data.seconds || 0), 0) },
    lectures: (() => { // only released (narrated) lectures count; Coming Soon lessons never do
      const ids = new Set(Object.values(CONTENT.lectures || {}).map((l) => l.id));
      const recs = Object.entries(state.lecture || {}).filter(([id]) => ids.has(id)).map(([, r]) => r);
      return { available: ids.size, started: recs.length, completed: recs.filter((r) => r.data.completed).length };
    })(),
    insights, insightNote: 'Insights appear only when your responses meet the stated evidence threshold. They describe performance on APERTURE items, not personality or ability.',
    diagnostic: diag ? { submitted: diag.submitted, overall: autoRatio(diag) } : null,
  };
}
