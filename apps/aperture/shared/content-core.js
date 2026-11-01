/* APERTURE — course content index and views (shared by the browser and the server).
   The content is supplied with setContent(): by the protected Pages Function (from
   aperture/build/content.json) or, in public-beta mode, by the page (data/content.json).
   The "public" views strip answer keys, hidden exercise material (`key`), case teaching notes
   and model answers before anything is shown, in both modes. */

import { publicQuestion } from './grading.js';

export let CONTENT = null;
export function setContent(c) { CONTENT = c; IX = null; }

export function stripKeys(v) {
  if (Array.isArray(v)) return v.map(stripKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'key') o[k] = stripKeys(x);
    return o;
  }
  return v;
}

let IX = null;
export function index() {
  if (IX) return IX;
  const ix = {
    weeks: new Map(), lessons: new Map(), questions: new Map(), assessments: new Map(), exercises: new Map(), cases: new Map(),
    assignments: new Map(), drafts: new Set(), targets: new Set(), concepts: new Map(), cards: new Map(), resources: new Map(),
  };
  for (const r of CONTENT.library) { ix.resources.set(r.id, r); ix.targets.add(r.id); }
  for (const [id, c] of Object.entries(CONTENT.concepts)) { ix.concepts.set(id, c); ix.targets.add(id); }
  for (const g of CONTENT.glossary) ix.targets.add(g.id);
  const addQs = (list, owner) => (list || []).forEach((q) => ix.questions.set(q.id, { ...q, owner }));
  for (const w of CONTENT.weeks) {
    ix.weeks.set(w.id, w); ix.targets.add(w.id);
    w.lessons.forEach((l, i) => {
      ix.lessons.set(l.id, { ...l, week: w.id, index: i }); ix.targets.add(l.id);
      addQs(l.check, `${l.id}-check`);
      ix.assessments.set(`${l.id}-check`, { id: `${l.id}-check`, kind: 'check', week: w.id, title: `Comprehension check — ${l.title}`, main: l.check.map((q) => q.id), reserve: [], mastery: 0.8 });
    });
    addQs(w.quiz.questions, w.quiz.id); addQs(w.quiz.reserve, w.quiz.id);
    ix.assessments.set(w.quiz.id, { id: w.quiz.id, kind: 'quiz', week: w.id, title: w.quiz.title, minutes: w.quiz.minutes, main: w.quiz.questions.map((q) => q.id), reserve: w.quiz.reserve.map((q) => q.id), mastery: w.quiz.mastery || 0.8 });
    ix.exercises.set(w.exercise.id, { ...w.exercise, week: w.id });
    if (w.assignment.composer) ix.exercises.set(`${w.assignment.id}-studio`, { id: `${w.assignment.id}-studio`, title: `${w.assignment.title} — studio`, lab: 'executive-communication-studio', engine: 'composer', config: w.assignment.composer, assumptions: [], week: w.id });
    ix.cases.set(w.case.id, { ...w.case, week: w.id }); ix.targets.add(w.case.id);
    ix.assignments.set(w.assignment.id, { ...w.assignment, week: w.id }); ix.drafts.add(w.assignment.id);
    w.review.forEach((c) => ix.cards.set(c.id, { ...c, week: w.id }));
  }
  const d = CONTENT.diagnostic;
  if (d) { addQs(d.questions, 'diagnostic'); ix.assessments.set('diagnostic', { id: 'diagnostic', kind: 'diagnostic', title: d.title, minutes: d.minutes, main: d.questions.map((q) => q.id), reserve: [], mastery: null }); }
  const m = CONTENT.midterm;
  if (m) {
    addQs(m.questions, 'midterm'); addQs(m.reserve, 'midterm');
    ix.assessments.set('midterm', { id: 'midterm', kind: 'midterm', title: m.title, minutes: m.minutes, main: m.questions.map((q) => q.id), reserve: m.reserve.map((q) => q.id), mastery: m.mastery || 0.8 });
    ix.cases.set(m.case.id || 'midterm-case', { ...m.case, id: m.case.id || 'midterm-case', week: 'midterm' }); ix.targets.add(m.case.id || 'midterm-case');
  }
  const cap = CONTENT.capstone;
  if (cap) {
    ix.targets.add('capstone');
    for (const k of cap.components) { ix.drafts.add(`capstone-${k.id}`); ix.targets.add(`capstone-${k.id}`); }
    for (const dl of cap.deliverables) { ix.drafts.add(`capstone-${dl.id}`); ix.assignments.set(`capstone-${dl.id}`, { ...dl, id: `capstone-${dl.id}`, capstone: true, template: dl.components.map((k) => ({ heading: cap.components.find((c) => c.id === k)?.title || k, guidance: '' })), checks: ['sections'] }); }
    if (cap.tools?.orgdesign) ix.exercises.set('capstone-orgdesign', { id: 'capstone-orgdesign', title: 'Capstone — organization design', lab: 'organizational-design-studio', engine: 'orgdesign', config: cap.tools.orgdesign, assumptions: cap.assumptions || [], week: 'w14' });
    if (cap.tools?.allocation) ix.exercises.set('capstone-allocation', { id: 'capstone-allocation', title: 'Capstone — budget model', lab: 'financial-decision-studio', engine: 'allocation', config: cap.tools.allocation, assumptions: cap.assumptions || [], week: 'w14' });
    ix.exercises.set('capstone-presentation', { id: 'capstone-presentation', title: 'Capstone — decision presentation', lab: 'executive-communication-studio', engine: 'composer', config: presentationComposer(cap), assumptions: [], week: 'w14' });
  }
  ix.labs = new Map(CONTENT.labs.map((l) => [l.id, l]));
  ix.lectures = new Map(Object.values(CONTENT.lectures || {}).map((l) => [l.id, l]));
  IX = ix;
  return ix;
}

function presentationComposer(cap) {
  return {
    scenario: [{ type: 'p', kind: 'original', text: `Draft the decision presentation for **${cap.title}**: open with the recommendation, then the three decisions you most need the president of baseball operations to back, and the evidence and risks behind each.` }],
    audience: [{ who: 'President of baseball operations', cares: 'Whether the department wins games, stays inside budget and avoids turf wars.' }, { who: 'Field manager and coaches', cares: 'Whether reports arrive on time and respect their judgment.' }],
    formats: [
      { id: 'opening', label: 'Three-minute opening', words: [380, 470], wpm: 150, sections: ['Recommendation', 'Why now', 'Three decisions', 'Risks', 'The ask'] },
      { id: 'slide', label: 'One-slide summary', words: [80, 140] },
      { id: 'hardest', label: 'Answer to the hardest question', words: [110, 170], wpm: 150 },
    ],
    checklist: ['The recommendation is in the first two sentences', 'Each decision names its owner and timing', 'At least one risk is stated with its mitigation', 'The ask is specific (approval, budget, date)', 'No unexplained jargon'],
  };
}

export function catalog() {
  const ix = index();
  return {
    semester: CONTENT.semester,
    stats: CONTENT.stats,
    weeks: CONTENT.weeks.map((w) => ({
      id: w.id, number: w.number, title: w.title, theme: w.theme, school: w.school, schools: w.schools, question: w.question, hours: w.hours, objectives: w.objectives,
      lessons: w.lessons.map((l) => ({ id: l.id, title: l.title, minutes: l.minutes, summary: l.summary, concepts: l.concepts })),
      exercise: { id: w.exercise.id, title: w.exercise.title, lab: w.exercise.lab, engine: w.exercise.engine, minutes: w.exercise.minutes },
      case: { id: w.case.id, title: w.case.title, setting: w.case.setting, minutes: w.case.minutes },
      quiz: { id: w.quiz.id, title: w.quiz.title, minutes: w.quiz.minutes, count: w.quiz.questions.length },
      assignment: { id: w.assignment.id, title: w.assignment.title, minutes: w.assignment.minutes, studio: !!w.assignment.composer },
      cards: w.review.length,
    })),
    diagnostic: CONTENT.diagnostic ? { id: 'diagnostic', title: CONTENT.diagnostic.title, minutes: CONTENT.diagnostic.minutes, count: CONTENT.diagnostic.questions.length } : null,
    midterm: CONTENT.midterm ? { id: 'midterm', title: CONTENT.midterm.title, minutes: CONTENT.midterm.minutes, count: CONTENT.midterm.questions.length, covers: CONTENT.midterm.covers } : null,
    capstone: CONTENT.capstone ? { id: 'capstone', title: CONTENT.capstone.title, components: CONTENT.capstone.components.length, deliverables: CONTENT.capstone.deliverables.map((d) => ({ id: d.id, title: d.title })) } : null,
    labs: CONTENT.labs.map((l) => ({ ...l, exercises: [...ix.exercises.values()].filter((x) => x.lab === l.id).map((x) => ({ id: x.id, title: x.title, engine: x.engine, week: x.week, minutes: x.minutes || null })) })),
    concepts: CONTENT.concepts,
    glossary: CONTENT.glossary,
    lectures: CONTENT.lectures || {},
    manifest: CONTENT.manifest,
  };
}

export function publicWeek(id) {
  const w = index().weeks.get(id);
  if (!w) return null;
  return {
    ...w,
    lessons: w.lessons.map((l) => ({ ...l, check: l.check.map(publicQuestion) })),
    quiz: { id: w.quiz.id, title: w.quiz.title, minutes: w.quiz.minutes, count: w.quiz.questions.length, mastery: w.quiz.mastery || 0.8 },
    exercise: stripKeys(w.exercise),
    case: publicCase(w.case),
    assignment: stripKeys(w.assignment),
  };
}
export function publicCase(c) {
  const { perspectives, ...rest } = c;
  return { ...rest, perspectivesCount: (perspectives || []).length };
}
export function publicCapstone() {
  const c = CONTENT.capstone;
  return c ? stripKeys(c) : null;
}
export function publicMidterm() {
  const m = CONTENT.midterm;
  if (!m) return null;
  return { id: m.id, title: m.title, minutes: m.minutes, mastery: m.mastery, covers: m.covers, intro: m.intro, case: publicCase(m.case), count: m.questions.length };
}
export function publicDiagnostic() {
  const d = CONTENT.diagnostic;
  return d ? { id: d.id, title: d.title, minutes: d.minutes, intro: d.intro, count: d.questions.length } : null;
}
