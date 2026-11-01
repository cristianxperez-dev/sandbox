/* APERTURE — server-side scoring. Answer keys never leave the server before submission.
   Scoring rules (shown to the learner on every results page):
   - mc / scenario / flaw / research / decision: all or nothing.
   - multi / issue: partial credit = max(0, (correct picks − wrong picks) / number of correct options).
   - rank: 1 − (Spearman footrule distance / maximum distance); exact order = full credit.
   - numeric: correct when within the stated tolerance.
   - short: never auto-graded; self-assessed against the rubric and model answer, labelled so. */

const SINGLE = new Set(['mc', 'scenario', 'flaw', 'research', 'decision']);

export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/[,$€£%\s]/g, '').replace(/^\+/, '');
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function scoreQuestion(q, response) {
  const ids = (q.options || []).map((o) => o.id);
  if (q.type === 'short') {
    const text = typeof response === 'string' ? response.slice(0, 20000) : '';
    return { score: null, response: text, answered: text.trim().length > 0 };
  }
  if (SINGLE.has(q.type)) {
    const r = typeof response === 'string' && ids.includes(response) ? response : null;
    return { score: r === q.answer ? 1 : 0, response: r, answered: r !== null };
  }
  if (q.type === 'multi' || q.type === 'issue') {
    const r = Array.isArray(response) ? [...new Set(response.filter((x) => ids.includes(x)))] : [];
    const correct = r.filter((x) => q.answer.includes(x)).length;
    const wrong = r.length - correct;
    return { score: r.length ? Math.max(0, (correct - wrong) / q.answer.length) : 0, response: r, answered: r.length > 0 };
  }
  if (q.type === 'rank') {
    const r = Array.isArray(response) && response.length === ids.length && ids.every((x) => response.includes(x)) ? response.slice() : null;
    if (!r) return { score: 0, response: null, answered: false };
    let dist = 0;
    for (const id of ids) dist += Math.abs(r.indexOf(id) - q.answer.indexOf(id));
    const max = Math.floor((ids.length * ids.length) / 2);
    return { score: max ? Math.max(0, 1 - dist / max) : 1, response: r, answered: true };
  }
  if (q.type === 'numeric') {
    const n = parseNumber(response);
    if (n === null) return { score: 0, response: null, answered: false };
    return { score: Math.abs(n - q.answer.value) <= q.answer.tolerance + 1e-9 ? 1 : 0, response: n, answered: true };
  }
  return { score: 0, response: null, answered: false };
}

// Full feedback for one question after submission.
export function feedback(q, scored) {
  const out = {
    id: q.id, type: q.type, score: scored.score, response: scored.response, answered: scored.answered,
    explanation: q.explanation || null, concepts: q.concepts || [], domain: q.domain, lesson: q.lesson || null, points: q.points || 1,
  };
  if (q.type === 'short') { out.modelAnswer = q.modelAnswer; out.rubric = q.rubric; return out; }
  out.answer = q.type === 'numeric' ? q.answer : q.answer;
  if (q.working) out.working = q.working;
  if (q.optionFeedback) out.optionFeedback = q.optionFeedback;
  const wrongPicks = SINGLE.has(q.type) ? (scored.response && scored.response !== q.answer ? [scored.response] : [])
    : (q.type === 'multi' || q.type === 'issue') ? (scored.response || []).filter((x) => !q.answer.includes(x)) : [];
  const tags = wrongPicks.map((x) => q.errorTags && q.errorTags[x]).filter(Boolean);
  if (tags.length) out.errorTags = tags;
  return out;
}

// Removes everything a learner must not see before answering.
export function publicQuestion(q) {
  const { answer, explanation, optionFeedback, errorTags, modelAnswer, working, ...rest } = q;
  if (q.type === 'numeric' && answer && answer.unit) rest.unit = answer.unit;
  return rest;
}

// Short answers: self-assessment against the question rubric. scores = { criterionIndex: points }
export function selfScore(q, scores) {
  if (q.type !== 'short' || !Array.isArray(q.rubric)) return null;
  let got = 0, max = 0;
  q.rubric.forEach((r, i) => {
    max += r.points;
    const v = Number(scores && scores[i]);
    if (Number.isFinite(v)) got += Math.min(r.points, Math.max(0, Math.round(v)));
  });
  return max ? got / max : null;
}

// Assignment rubric self-assessment: scores = { criterionId: 1..4 } → weighted percentage (0–1)
export function rubricScore(rubric, scores) {
  let total = 0, weight = 0, complete = true;
  for (const r of rubric || []) {
    const v = Number(scores && scores[r.id]);
    if (![1, 2, 3, 4].includes(v)) { complete = false; continue; }
    total += r.weight * (v / 4);
    weight += r.weight;
  }
  return { score: weight ? total / 100 : null, complete: complete && weight === 100 };
}

const countWords = (s) => (typeof s === 'string' ? (s.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.%$-]*/g) || []).length : 0);
export { countWords };

// Automated FORMAT checks only — never content judgments.
export function formatChecks(assignment, sections) {
  const out = [];
  const texts = (assignment.template || []).map((t, i) => (sections && typeof sections[i] === 'string' ? sections[i] : ''));
  const total = texts.reduce((a, t) => a + countWords(t), 0);
  if ((assignment.checks || []).includes('words') && Array.isArray(assignment.words)) {
    const [lo, hi] = assignment.words;
    out.push({ id: 'words', label: `Length ${lo}–${hi} words`, pass: total >= lo && total <= hi, detail: `${total} words` });
  }
  if ((assignment.checks || []).includes('sections')) {
    const empty = (assignment.template || []).filter((t, i) => countWords(texts[i]) < 15).map((t) => t.heading);
    out.push({ id: 'sections', label: 'Every template section addressed (15+ words each)', pass: empty.length === 0, detail: empty.length ? `Thin or empty: ${empty.join(', ')}` : 'All sections addressed' });
  }
  return { checks: out, words: total };
}
