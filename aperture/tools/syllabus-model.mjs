// APERTURE — Semester syllabus model.
// One function turns the compiled course bundle (aperture/build/content.json) into the syllabus data that
// BOTH the interactive Syllabus page (apps/aperture/data/syllabus.json) and the PDF
// (aperture/tools/syllabus.mjs → apps/aperture/syllabus/*.pdf) are rendered from. Every schedule entry, reading,
// assessment, weight and count comes from the curriculum; compile.mjs regenerates it and `--check` fails when the
// published syllabus or the PDF no longer match the deployed coursework.
//
// Course-level framing (description, philosophy, outcomes) is not stored in the curriculum, so it is written
// here, describes only what the application actually does, and cites the weeks each outcome draws on.
import { createHash } from 'node:crypto';

const SECTION_NAMES = ['Explore', 'Understand', 'Challenge', 'Apply', 'Retain'];
const ACCESS = {
  open: { label: 'Open access', open: true },
  'free-registration': { label: 'Free with registration', open: true },
  paywalled: { label: 'Paywalled', open: false },
  library: { label: 'Library access', open: false },
  purchase: { label: 'Purchase', open: false },
};
const KINDS = [
  ['established', 'Established research', 'A well-supported finding or theory. Always cites at least one library record.'],
  ['contested', 'Contested finding', 'A finding that failed to replicate or is disputed. Both sides are stated and cited.'],
  ['original', 'APERTURE explanation', 'Original APERTURE instruction: explanation, synthesis or a teaching device. It is not presented as research.'],
  ['example', 'Illustrative example', 'A real example (sourced) or a clearly hypothetical one. Cases, organizations and data in exercises are fictional and say so.'],
  ['application', 'Professional application', 'How the idea transfers to executive work, player development or baseball operations.'],
  ['hypothesis', 'Speculative hypothesis', 'APERTURE’s own conjecture, labelled so it is never mistaken for evidence.'],
];

// Composed from the weekly objectives; each outcome lists the weeks it draws on.
const OUTCOMES = [
  { title: 'Calibrated judgment', weeks: ['w01', 'w04', 'w13'], text: 'Judge when intuition can be trusted, correct for base rates and confirmation, and state confidence that matches your accuracy — measured, not assumed, in the Judgment Lab and the Decision Journal.' },
  { title: 'Behavioral diagnosis', weeks: ['w02', 'w03'], text: 'Explain behavior through situations, incentives, norms and motivation, and design incentives and learning environments that do not crowd out the behavior they are meant to produce.' },
  { title: 'Evidence and causal reasoning', weeks: ['w04', 'w03', 'w13'], text: 'Read research critically: distinguish correlation from causation, recognize study-design limits, and weigh contested findings before acting on them.' },
  { title: 'Leadership and influence', weeks: ['w05', 'w06'], text: 'Lead as a participant in a social system: build trust, communicate one recommendation to different audiences, and map power and stakeholders before seeking support.' },
  { title: 'Negotiation', weeks: ['w07'], text: 'Prepare and conduct negotiations from interests, alternatives and reservation values, and turn the preparation into a written strategy.' },
  { title: 'Organizational and strategic design', weeks: ['w08', 'w09', 'w12'], text: 'Design structures, decision rights and strategies that fit the work, and translate strategy into a sequenced, measurable implementation plan.' },
  { title: 'Financial decision-making', weeks: ['w10'], text: 'Build and defend a business case: allocate capital under constraints, test sensitivity to assumptions, and state the non-financial considerations.' },
  { title: 'Legal and ethical reasoning', weeks: ['w11', 'w13'], text: 'Spot contractual and legal issues for counsel without overstepping into legal advice, and reason through ethical and governance dilemmas under uncertainty.' },
  { title: 'Executive communication and integration', weeks: ['w05', 'w14'], text: 'Integrate every school of the semester in one executive recommendation — memo, model, roadmap and presentation — and defend it under hard questions.' },
];

const MISSING_STATIC = [
  { topic: 'Calendar dates', detail: 'Semester I is self-paced. The curriculum has no start date, due dates or session times, so the schedule is given by week number only.' },
  { topic: 'Instructor and office hours', detail: 'APERTURE is self-directed. There is no instructor, teaching staff, office hours or discussion section.' },
  { topic: 'Letter grades and passing mark', detail: 'V1 reports a weighted percentage standing over completed components. It defines no letter-grade scale, passing mark, honors or failing grade, and awards no credit.' },
  { topic: 'Attempt limits and late policy', detail: 'V1 sets no limit on quiz or midterm attempts, no deadlines and no late penalties. A reassessment becomes available after an attempt below mastery.' },
  { topic: 'Course-level statements', detail: 'The curriculum stores week-level objectives, not a course description, philosophy or semester outcomes. Those sections of this syllabus are composed from the weekly objectives and the application’s own features.' },
];

export function syllabusHash(model) {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex').slice(0, 16);
}

export function buildSyllabus(C, { narration } = {}) {
  const libIx = new Map(C.library.map((r) => [r.id, r]));
  const labIx = new Map(C.labs.map((l) => [l.id, l]));
  const conceptName = (id) => (C.concepts[id] ? C.concepts[id].name : id);
  const lectures = C.lectures || {};
  const soon = new Set(C.lecturesSoon || []);
  const sum = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 100) / 100;
  const midCovers = C.midterm ? C.midterm.covers : [];
  const lastCovered = midCovers.length ? midCovers[midCovers.length - 1] : null;
  const milestones = new Map((C.capstone?.milestones || []).map((m) => [m.week, m.text]));
  const readingRefs = new Map(); // ref → { weeks:Set, required:bool }

  const weeks = C.weeks.map((w) => {
    const reading = (r, required) => {
      const e = readingRefs.get(r.ref) || { weeks: new Set(), required: false };
      e.weeks.add(w.number); e.required = e.required || required; readingRefs.set(r.ref, e);
      return { ref: r.ref, what: r.what, why: r.why, minutes: r.minutes };
    };
    return {
      id: w.id, number: w.number, title: w.title, theme: w.theme, question: w.question,
      school: w.school, schools: w.schools, objectives: w.objectives,
      hours: w.hours, totalHours: sum(w.hours),
      concepts: (w.concepts || []).map((c) => (typeof c === 'string' ? conceptName(c) : c.name)),
      lessons: w.lessons.map((l, i) => {
        const lec = lectures[l.id];
        return {
          id: l.id, number: i + 1, title: l.title, minutes: l.minutes, summary: l.summary,
          concepts: l.concepts.map(conceptName), checks: (l.check || []).length, sources: l.sources.length,
          lecture: lec ? { status: 'available', minutes: lec.minutes, checkpoints: lec.checkpoints, chapters: lec.chapters.length } : soon.has(l.id) ? { status: 'soon' } : null,
        };
      }),
      readings: { required: w.readings.required.map((r) => reading(r, true)), optional: (w.readings.optional || []).map((r) => reading(r, false)) },
      exercise: { id: w.exercise.id, title: w.exercise.title, lab: w.exercise.lab, labName: labIx.get(w.exercise.lab)?.name || w.exercise.lab, minutes: w.exercise.minutes },
      case: { id: w.case.id, title: w.case.title, setting: w.case.setting, minutes: w.case.minutes, questions: (w.case.questions || []).length, perspectives: (w.case.perspectives || []).length },
      quiz: { id: w.quiz.id, title: w.quiz.title, minutes: w.quiz.minutes, count: w.quiz.questions.length, reserve: (w.quiz.reserve || []).length, mastery: w.quiz.mastery ?? C.semester.grading.mastery },
      assignment: { id: w.assignment.id, title: w.assignment.title, minutes: w.assignment.minutes, deliverable: w.assignment.deliverable, words: w.assignment.words || null, rubric: (w.assignment.rubric || []).map((r) => ({ criterion: r.criterion, weight: r.weight })) },
      reflection: { minutes: w.reflection?.minutes || 0, prompts: (w.reflection?.prompts || []).length },
      reviewCards: (w.review || []).length,
      midterm: w.id === lastCovered,
      capstone: milestones.get(w.number) || null,
    };
  });

  const resource = (id) => {
    const r = libIx.get(id);
    const e = readingRefs.get(id);
    return {
      id, title: r.title, authors: r.authors, year: r.year, publication: r.publication, url: r.url, doi: r.doi || null,
      type: r.type, access: r.access, accessLabel: ACCESS[r.access]?.label || r.access, open: !!ACCESS[r.access]?.open,
      verified: r.verified.status, weeks: [...e.weeks].sort((a, b) => a - b), required: e.required,
    };
  };
  const readingList = [...readingRefs.keys()].map(resource).sort((a, b) => (a.authors[0] || a.title).localeCompare(b.authors[0] || b.title) || a.year - b.year);

  const cap = C.capstone;
  const kindCounts = {};
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.kind && x.type) kindCounts[x.kind] = (kindCounts[x.kind] || 0) + 1; Object.values(x).forEach(walk); } };
  C.weeks.forEach((w) => w.lessons.forEach(walk));
  const g = C.semester.grading;

  // Gaps computed from the data itself (in addition to the static list above).
  const gaps = [...MISSING_STATIC];
  const over = weeks.filter((w) => w.totalHours > 7.05);
  if (over.length) gaps.push({ topic: 'Weekly workload', detail: `The stated workload is ${C.semester.hoursPerWeek} hours a week. The planned hours of ${over.map((w) => `Week ${w.number} (${w.totalHours} h)`).join(' and ')} are slightly above 7.` });
  const m = C.manifest?.totals;
  if (m?.linkUntested) gaps.push({ topic: 'Source links', detail: `Library metadata was verified through search results; ${m.linkUntested} of ${m.resources} links are marked “link untested” until opened in a browser, and ${m.partiallyConfirmed} records are only partially confirmed.` });
  const lecAvail = weeks.flatMap((w) => w.lessons).filter((l) => l.lecture?.status === 'available').length;
  const lecSoon = weeks.flatMap((w) => w.lessons).filter((l) => l.lecture?.status === 'soon').length;
  if (lecSoon) gaps.push({ topic: 'Narrated lectures', detail: `${lecAvail} of ${C.stats.lessons} narrated lectures are released. The other ${lecSoon} are scripted and marked Coming Soon; every lesson is complete in its written form.` });

  return {
    schema: 1,
    program: 'APERTURE — The Applied Intelligence Academy',
    motto: 'Broaden perspective. Deepen understanding. Strengthen judgment.',
    disclaimer: 'APERTURE is an independent learning program by Cristian Perez. It carries no academic credit or accreditation and has no affiliation with, or endorsement by, any university. Its structure is modelled on graduate programs; it is not one.',
    semester: { id: C.semester.id, title: C.semester.title, name: C.semester.name, weeks: C.semester.weeks, hoursPerWeek: C.semester.hoursPerWeek, plannedHours: C.stats.plannedHours, schools: C.semester.schools.map((s) => ({ ...s, weeks: weeks.filter((w) => w.school === s.id).map((w) => w.number) })) },
    stats: C.stats,
    description: [
      `${C.semester.title}, *${C.semester.name}*, is a ${C.semester.weeks}-week program in how people judge, decide, learn, lead and negotiate, and how organizations turn evidence, strategy, finance and law into decisions. It moves from the individual (judgment, motivation, learning, evidence) to the social (leadership, power, negotiation) and the organizational (design, strategy, finance, law, execution, ethics), and ends in an executive capstone that uses all of it.`,
      `The course draws on ${C.semester.schools.length} schools — ${C.semester.schools.map((s) => s.name).join(', ')} — and on a research library of ${C.stats.resources} verified sources. It is written for working professionals and asks for about ${C.semester.hoursPerWeek} hours a week.`,
    ],
    philosophy: [
      { title: 'Evidence, labelled', text: 'Every passage of every lesson says what it is — established research, a contested finding, APERTURE’s own explanation, an illustrative example, a professional application or a speculative hypothesis — and research claims cite the library.' },
      { title: 'Mastery before momentum', text: `Quizzes and the midterm set mastery at ${Math.round(g.mastery * 100)}%. Below it, you get the lessons and concepts behind your misses and a reassessment drawn from reserve questions.` },
      { title: 'Retrieval and spacing', text: `Comprehension checks after each lesson, ${C.stats.reviewCards} spaced-repetition review cards and weekly reflections turn reading into memory.` },
      { title: 'Calibration over confidence', text: 'Labs and assessments ask how sure you are, not only what you think, so the semester measures the match between confidence and accuracy.' },
      { title: 'Practice on realistic problems', text: `Each week pairs an interactive lab with an original case (${C.stats.cases} in all) and an applied assignment written as professional work.` },
      { title: 'Honest assessment', text: 'Objective items are auto-graded with the scoring rules shown on every results page. Written work is self-assessed against published rubrics and labelled as such; automated checks cover format only, never content.' },
    ],
    objectives: weeks.map((w) => ({ week: w.number, title: w.title, objectives: w.objectives })),
    outcomes: OUTCOMES.map((o) => ({ ...o, weeks: o.weeks.map((id) => C.weeks.find((w) => w.id === id)?.number).filter(Boolean).sort((a, b) => a - b) })),
    formats: [
      { title: 'Written lessons', text: `${C.stats.lessons} lessons (about ${Math.round(C.stats.lessonWords / 1000)},000 words), each in five parts — ${SECTION_NAMES.join(', ')} — with a source panel and a short comprehension check (${C.stats.checkQuestions} questions in all).` },
      { title: 'Narrated lectures (Watch & Learn)', text: 'An interchangeable narrated version of a lesson with synchronized visuals, captions, transcript and interactive checkpoints. Either the lecture or the written lesson completes the lesson.' },
      { title: 'Readings', text: `Required and optional readings each week, ${readingList.filter((r) => r.required).length} required and ${readingList.filter((r) => !r.required).length} optional across the semester, with a reason to read each one.` },
      { title: 'Interactive labs', text: `${C.labs.length} labs and studios — simulations, calibration tests, a negotiation simulator, design and capital-allocation tools — with one exercise each week.` },
      { title: 'Cases', text: `An original, clearly fictional case each week with discussion questions; write your position before reading alternative perspectives.` },
      { title: 'Assessments', text: `A weekly quiz (${C.stats.quizQuestions} questions), a weekly applied assignment, a midterm after Week ${C.weeks.find((w) => w.id === lastCovered)?.number ?? 7} and the executive capstone. A baseline diagnostic in Week 1 is not graded.` },
    ],
    weeks,
    readingList,
    readingTotals: { required: readingList.filter((r) => r.required).length, optional: readingList.filter((r) => !r.required).length, open: readingList.filter((r) => r.open).length, restricted: readingList.filter((r) => !r.open).length, library: C.stats.resources },
    grading: {
      weights: [
        { id: 'quizzes', label: 'Weekly quizzes', weight: g.quizzes, basis: `Best attempt per week, averaged over the weeks taken. ${C.weeks.length} quizzes. Auto-graded items plus your self-assessed short responses (labelled).` },
        { id: 'assignments', label: 'Applied assignments', weight: g.assignments, basis: `${C.weeks.length} assignments, each self-assessed against its weighted rubric (four levels: Exemplary, Proficient, Developing, Beginning). Automated checks cover format only.` },
        { id: 'midterm', label: 'Midterm', weight: g.midterm, basis: 'Best attempt. Auto-graded items plus self-assessed short responses.' },
        { id: 'capstone', label: 'Executive capstone', weight: g.capstone, basis: `${cap ? cap.deliverables.length : 0} deliverables, each self-assessed against its rubric; the component is their average.` },
      ],
      mastery: g.mastery,
      standing: 'Your current standing is the weighted average of the components you have completed, using the published weights. It is shown on the Progress page.',
      ungraded: ['Baseline diagnostic', 'Lesson comprehension checks', 'Lecture checkpoints', 'Lab exercises', 'Case analyses', 'Weekly reflections', 'Review cards'],
      scoring: [
        'Single-answer items (multiple choice, scenario, flaw, research, decision): all or nothing.',
        'Multi-select and issue-spotting: partial credit = max(0, (correct − wrong picks) / correct options).',
        'Ranking: 1 − footrule distance / maximum distance.',
        'Numeric: correct within the stated tolerance.',
        'Short answer: never auto-graded; self-assessed against the rubric and model answer.',
      ],
    },
    diagnostic: C.diagnostic ? { title: C.diagnostic.title, minutes: C.diagnostic.minutes, count: C.diagnostic.questions.length } : null,
    midterm: C.midterm ? { title: C.midterm.title, minutes: C.midterm.minutes, count: C.midterm.questions.length, reserve: (C.midterm.reserve || []).length, covers: C.midterm.covers.map((id) => C.weeks.find((w) => w.id === id)?.number), caseTitle: C.midterm.case?.title || null, mastery: C.midterm.mastery } : null,
    capstone: cap ? {
      title: cap.title, organization: cap.organization, fiction: cap.fiction,
      components: cap.components.map((k) => ({ number: k.number, title: k.title, week: k.week, deliverable: k.deliverable, words: k.words })),
      deliverables: cap.deliverables.map((d) => ({ id: d.id, title: d.title, description: d.description, words: d.words, components: d.components.length, rubric: d.rubric.map((r) => ({ criterion: r.criterion, weight: r.weight })) })),
      milestones: cap.milestones, defense: cap.defense.length, exhibits: (cap.exhibits || []).length,
      tools: ['Organization Builder (Organizational Design Studio)', 'Capital Allocation Lab (Financial Decision Studio)', 'Decision Presentation Studio (Executive Communication Studio)'],
    } : null,
    lectures: { available: lecAvail, soon: lecSoon, voice: narration?.default?.label || null },
    labs: C.labs.map((l) => ({ id: l.id, name: l.name, summary: l.summary })),
    resources: [
      { title: 'Research library', text: `${C.stats.resources} sources (${m ? `${m.open} open access, ${m.restricted} restricted` : ''}), each with a summary, research design, evidence level, strengths, limitations, replication status and the lessons that use it.` },
      { title: 'Notebook', text: 'Highlights and notes made in any lesson, bookmarks, weekly reflections, assignment drafts and saved concepts, all searchable.' },
      { title: 'Labs and simulations', text: `${C.labs.length} labs, including the Strategic Decision Journal you begin in Week 1 and use all semester.` },
      { title: 'Review and glossary', text: `${C.stats.reviewCards} spaced-repetition review cards and a ${C.stats.glossaryTerms}-term glossary.` },
      { title: 'Progress and insights', text: 'Lessons, quizzes, assignments and lectures completed, the weighted standing, time on task and concept-level evidence of what to review.' },
      { title: 'Study help prompts', text: 'Each lesson can generate a study prompt (explain, quiz me, apply, critique) to copy into ChatGPT. Nothing is sent unless you copy it or open ChatGPT yourself.' },
    ],
    integrity: {
      kinds: KINDS.map(([id, label, text]) => ({ id, label, text, count: kindCounts[id] || 0 })),
      ai: [
        'APERTURE’s original explanations, cases, quiz items, lecture scripts and this syllabus were drafted with AI assistance and are labelled as APERTURE material, not research. Research claims are tied to library records whose bibliographic details were checked; the library records how each was verified.',
        'Lecture narration is synthesized speech (the open Kokoro-82M voice model). It reads APERTURE’s scripts; it is not a recording of a person.',
        'The optional ChatGPT study prompts are a study aid. Graded written work — assignments, short answers and capstone deliverables — should be your own; you assess it yourself against the rubric.',
      ],
      fiction: 'All people, organizations and data in cases, exercises, the midterm and the capstone are fictional and say so. Legal material is educational and general, never legal advice.',
    },
    gaps,
  };
}
