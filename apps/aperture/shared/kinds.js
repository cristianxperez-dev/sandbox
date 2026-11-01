/* APERTURE — validation of learner-owned records (ap_state). Every write is checked here: the
   kind must be known, the key must name something that exists in the course (or be a safe random
   id), and the data is sanitized (types, depth, sizes). Unknown fields are dropped. */

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const bool = (v) => v === true;
const strs = (v, maxItems, maxLen) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, maxLen)) : []);
const MODES = ['foundation', 'graduate', 'executive'];

// Generic JSON sanitizer for engine state blobs (lab runs): bounded depth/size, plain data only.
function plain(v, depth = 0) {
  if (depth > 8) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 50000);
  if (Array.isArray(v)) return v.slice(0, 2000).map((x) => plain(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 400)) if (/^[A-Za-z0-9_.:-]{1,64}$/.test(k)) o[k] = plain(x, depth + 1);
    return o;
  }
  return null;
}

export function makeKinds(ix) {
  return {
    progress: {
      key: (k) => ix.lessons.has(k),
      clean: (d) => ({ section: ['explore', 'understand', 'challenge', 'apply', 'retain'].includes(d.section) ? d.section : 'explore', scroll: num(d.scroll, 0, 1) ?? 0, done: bool(d.done), seconds: Math.round(num(d.seconds, 0, 360000) ?? 0) }),
    },
    bookmark: {
      key: (k) => ix.targets.has(k),
      clean: (d) => ({ label: str(d.label, 200) }),
    },
    note: {
      key: (k) => ID.test(k),
      clean: (d) => {
        if (!ix.targets.has(d.target)) throw new Error('note target unknown');
        return { target: d.target, section: str(d.section, 20), block: Math.round(num(d.block, 0, 1000) ?? 0), quote: str(d.quote, 2000), text: str(d.text, 20000), highlight: bool(d.highlight), concept: ix.concepts.has(d.concept) ? d.concept : null, created: num(d.created, 0, 9e15) ?? Date.now() };
      },
      limit: 5000,
    },
    journal: {
      key: (k) => ID.test(k),
      clean: (d) => ({
        title: str(d.title, 300), date: str(d.date, 10), context: str(d.context, 20000), options: str(d.options, 20000), choice: str(d.choice, 5000), rationale: str(d.rationale, 20000),
        assumptions: str(d.assumptions, 10000), changeMind: str(d.changeMind, 10000), expected: str(d.expected, 10000), reviewDate: str(d.reviewDate, 10), state: str(d.state, 2000),
        forecasts: (Array.isArray(d.forecasts) ? d.forecasts : []).slice(0, 20).map((f) => ({ id: str(f.id, 40), text: str(f.text, 1000), p: num(f.p, 0, 1) ?? 0.5, by: str(f.by, 10), outcome: f.outcome === true || f.outcome === false ? f.outcome : null })),
        outcome: str(d.outcome, 20000), quality: ['good-good', 'good-bad', 'bad-good', 'bad-bad', ''].includes(d.quality) ? d.quality : '', lessons: str(d.lessons, 20000), reviewed: bool(d.reviewed),
      }),
      limit: 2000,
    },
    draft: {
      key: (k) => ix.drafts.has(k),
      clean: (d) => ({ sections: strs(d.sections, 20, 30000), formats: plain(d.formats || {}), checklist: plain(d.checklist || {}), words: Math.round(num(d.words, 0, 1e6) ?? 0) }),
    },
    reflection: {
      key: (k) => ix.weeks.has(k),
      clean: (d) => ({ answers: strs(d.answers, 6, 20000) }),
    },
    case: {
      key: (k) => ix.cases.has(k),
      clean: (d) => ({ analysis: str(d.analysis, 30000) }),
    },
    lab: {
      key: (k) => ix.exercises.has(k),
      clean: (d) => {
        const out = { state: plain(d.state), finished: bool(d.finished), summary: d.summary ? { label: str(d.summary.label, 300), metrics: plain(d.summary.metrics || {}) } : null };
        if (JSON.stringify(out).length > 400000) throw new Error('lab state too large');
        return out;
      },
    },
    lecture: {
      key: (k) => ix.lectures && ix.lectures.has(k),
      clean: (d) => {
        const responses = {};
        if (d.responses && typeof d.responses === 'object') for (const [id, r] of Object.entries(d.responses).slice(0, 40)) {
          if (!/^cp-[a-z0-9-]{1,40}$/.test(id) || !r || typeof r !== 'object') continue;
          responses[id] = { value: typeof r.value === 'number' ? (Number.isFinite(r.value) ? r.value : null) : str(r.value, 4000), correct: r.correct === true ? true : r.correct === false ? false : null, at: num(r.at, 0, 9e15) ?? Date.now() };
        }
        return { position: num(d.position, 0, 36000) ?? 0, furthest: num(d.furthest, 0, 36000) ?? 0, duration: num(d.duration, 0, 36000) ?? 0, completed: bool(d.completed), rate: num(d.rate, 0.5, 2.5) ?? 1, responses, seconds: Math.round(num(d.seconds, 0, 360000) ?? 0) };
      },
    },
    settings: {
      key: (k) => k === 'main',
      clean: (d) => ({
        mode: MODES.includes(d.mode) ? d.mode : 'graduate', textSize: num(d.textSize, 0.85, 1.5) ?? 1, lineHeight: num(d.lineHeight, 1.4, 2.1) ?? 1.7,
        theme: ['light', 'dark', 'system'].includes(d.theme) ? d.theme : 'system', reducedMotion: bool(d.reducedMotion), serifBody: d.serifBody !== false,
        weeklyHours: num(d.weeklyHours, 1, 20) ?? 6, studyDays: strs(d.studyDays, 7, 3), adaptFromDiagnostic: d.adaptFromDiagnostic !== false,
        reminders: ['in-app', 'off'].includes(d.reminders) ? d.reminders : 'in-app', chatgptLink: d.chatgptLink !== false,
        lessonView: d.lessonView === 'watch' ? 'watch' : 'read', captions: d.captions !== false,
      }),
    },
    profile: {
      key: (k) => k === 'main',
      clean: (d) => ({ name: str(d.name, 120), role: str(d.role, 300), background: str(d.background, 4000), goals: str(d.goals, 4000), priorities: strs(d.priorities, 12, 120), interests: str(d.interests, 2000) }),
    },
  };
}
export const STATE_KINDS = ['progress', 'bookmark', 'note', 'journal', 'draft', 'reflection', 'case', 'lab', 'lecture', 'settings', 'profile'];
