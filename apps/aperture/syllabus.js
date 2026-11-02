/* APERTURE — Syllabus page (#/syllabus). Rendered from data/syllabus.json, which compile.mjs generates from the
   deployed curriculum (the PDF is drawn from the same file), so the page cannot drift from the coursework.
   Lecture availability and your own progress come live from the catalog and the progress record. */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const PDF = 'syllabus/APERTURE-Semester-I-Syllabus.pdf';
  const pct = (x) => `${Math.round(x * 100)}%`;
  const hrs = (x) => String(Math.round(x * 10) / 10);
  const authors = (a) => (a.length > 3 ? `${a[0]} et al.` : a.length > 1 ? `${a.slice(0, -1).join(', ')} & ${a[a.length - 1]}` : a[0] || '');
  const short = (a) => { const last = (n) => n.split(' ').pop(); return a.length > 2 ? `${last(a[0])} et al.` : a.map(last).join(' & '); };

  AP.views.syllabus = async function (weekId) {
    const [S, stamp, cat, prog] = await Promise.all([
      fetch('data/syllabus.json', { credentials: 'same-origin', cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('The syllabus could not be loaded.'); return r.json(); }),
      fetch('syllabus/stamp.json', { credentials: 'same-origin', cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      AP.catalog(), AP.api('progress'),
    ]);
    await AP.loadState(['progress']);
    const R = new Map(S.readingList.map((r) => [r.id, r]));
    const lecOn = AP.lecturesOn();
    const liveLec = (id) => (lecOn && cat.lectures && cat.lectures[id]) || null;
    const soon = (id) => AP.lectureSoon && AP.lectureSoon(cat, id);
    const done = (id) => !!AP.getRec('progress', id)?.done;
    const pdfCurrent = stamp && stamp.hash === S.hash;
    const sections = [];
    const section = (id, n, title, ...body) => { const el = h('section', { class: 'syl-sec rule', id: `syl-${id}` }, h('h2', null, h('span', { class: 'syl-n', text: n }), title), ...body); sections.push([id, n, title, el]); return el; };
    const pairs = (list) => h('div', { class: 'syl-pairs' }, list.map((p) => h('div', null, h('h3', { text: p.title }), h('p', { html: AP.inline(p.text) }))));

    /* ---- weekly schedule ---- */
    const weekDetails = S.weeks.map((w) => {
      const pw = prog.weeks.find((x) => x.id === w.id);
      const cite = (r) => { const x = R.get(r.ref); return h('li', null,
        h('a', { href: `#/library/${r.ref}`, html: AP.inline(x ? `${short(x.authors)} (${x.year}), ${x.title}` : r.ref) }),
        x ? h('span', { class: `tag ${x.open ? 'tag--done' : ''}`, text: x.accessLabel }) : null,
        x ? h('a', { class: 'syl-ext small', href: x.url, target: '_blank', rel: 'noopener noreferrer', text: 'Source ↗', 'aria-label': `Open the source for ${x.title} (new tab)` }) : null,
        h('div', { class: 'small muted', html: AP.inline(`${r.what}. ${r.why} · ${r.minutes} min`) })); };
      const d = h('details', { class: 'syl-week', id: `syl-${w.id}`, open: weekId === w.id },
        h('summary', null, h('span', { class: 'syl-wk', text: `Week ${w.number}` }), h('span', { class: 'syl-wt', html: AP.inline(w.title) }),
          h('span', { class: 'syl-wmeta' },
            w.midterm ? h('span', { class: 'tag tag--accent', text: 'Midterm' }) : null,
            w.number === 14 ? h('span', { class: 'tag tag--accent', text: 'Capstone' }) : null,
            (() => { const n = w.lessons.filter((l) => liveLec(l.id)).length; return n ? h('span', { class: 'tag tag--accent', text: `▶ ${n} lecture${n > 1 ? 's' : ''}` }) : null; })(),
            h('span', { class: 'small muted num', text: `${pw ? pw.lessonsDone : 0}/${w.lessons.length} lessons · ${hrs(w.totalHours)} h` }))),
        h('div', { class: 'syl-wbody' },
          h('p', { class: 'syl-theme', html: AP.inline(w.theme) }), h('p', { class: 'question', html: AP.inline(w.question) }),
          h('h3', { text: 'Objectives' }), h('ul', null, w.objectives.map((o) => h('li', { html: AP.inline(o) }))),
          h('h3', { text: 'Lessons' }),
          h('ol', { class: 'syl-lessons' }, w.lessons.map((l) => { const lec = liveLec(l.id); return h('li', null,
            h('a', { class: 'syl-lt', href: `#/lesson/${l.id}${lec ? '/watch' : ''}`, html: AP.inline(l.title) }),
            done(l.id) ? h('span', { class: 'tag tag--done', text: 'Done' }) : null,
            h('span', { class: 'syl-lmeta' },
              lec ? h('a', { class: 'tag tag--accent syl-lec', href: `#/lesson/${l.id}/watch`, 'aria-label': `Watch the lecture for ${l.title}`, text: `▶ Lecture · ${lec.minutes} min` })
                : soon(l.id) ? h('span', { class: 'tag syl-soon', title: 'Only the narrated lecture is coming soon; the written lesson is available now.', text: 'Lecture coming soon' }) : null,
              h('a', { class: 'small', href: `#/lesson/${l.id}/read`, 'aria-label': `Read the lesson ${l.title}`, text: `Read · ${l.minutes} min` })),
            h('div', { class: 'small muted', text: l.concepts.join(' · ') })); })),
          h('h3', { text: 'Key concepts' }), h('p', { class: 'small', text: w.concepts.join(' · ') }),
          h('h3', { text: 'Required readings' }), h('ul', { class: 'syl-reads' }, w.readings.required.map(cite)),
          w.readings.optional.length ? [h('h3', { text: 'Recommended readings' }), h('ul', { class: 'syl-reads' }, w.readings.optional.map(cite))] : null,
          h('h3', { text: 'Lab, case and assessment' }),
          h('ul', { class: 'items' },
            h('li', null, h('a', { href: `#/exercise/${w.exercise.id}` }, h('span', { class: 'label', text: `Lab · ${w.exercise.minutes} min` }), h('span', null, h('span', { class: 'items__t', html: AP.inline(w.exercise.title) }), h('span', { class: 'items__d', text: w.exercise.labName })), h('span'))),
            h('li', null, h('a', { href: `#/case/${w.case.id}` }, h('span', { class: 'label', text: `Case · ${w.case.minutes} min` }), h('span', null, h('span', { class: 'items__t', html: AP.inline(w.case.title) }), h('span', { class: 'items__d', text: `Original case · ${w.case.setting} · ${w.case.questions} discussion questions` })), h('span'))),
            h('li', null, h('a', { href: `#/assess/${w.quiz.id}` }, h('span', { class: 'label', text: `Quiz · ${w.quiz.minutes} min` }), h('span', null, h('span', { class: 'items__t', text: w.quiz.title }), h('span', { class: 'items__d', text: `${w.quiz.count} questions · mastery at ${pct(w.quiz.mastery)} · ${w.quiz.reserve} reserve questions for reassessment` })), pw && pw.quiz ? h('span', { class: `tag ${pw.quiz.mastered ? 'tag--done' : 'tag--accent'}`, text: pw.quiz.mastered ? 'Mastered' : 'Taken' }) : h('span'))),
            h('li', null, h('a', { href: `#/assignment/${w.assignment.id}` }, h('span', { class: 'label', text: `Assignment · ${w.assignment.minutes} min` }), h('span', null, h('span', { class: 'items__t', html: AP.inline(w.assignment.title) }), h('span', { class: 'items__d', html: AP.inline(`${w.assignment.deliverable || ''}${w.assignment.words ? ` · ${w.assignment.words[0]}–${w.assignment.words[1]} words` : ''}`) })), pw && pw.assignment ? h('span', { class: 'tag tag--done', text: 'Submitted' }) : h('span')))),
          w.assignment.rubric.length ? h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Rubric' }), h('b', { text: `${w.assignment.rubric.length} weighted criteria` })), h('div', { class: 'fold__body' }, h('table', { class: 'syl-table' }, h('tbody', null, w.assignment.rubric.map((r) => h('tr', null, h('td', { html: AP.inline(r.criterion) }), h('td', { class: 'num', text: `${r.weight}%` }))))))) : null,
          w.midterm && S.midterm ? h('p', { class: 'syl-flag' }, h('b', { text: 'Midterm. ' }), h('a', { href: '#/midterm', html: AP.inline(S.midterm.title) }), ` — covers Weeks ${S.midterm.covers[0]}–${S.midterm.covers[S.midterm.covers.length - 1]}, ${S.midterm.minutes} min, taken after this week.`) : null,
          w.capstone ? h('p', { class: 'syl-flag' }, h('b', { text: 'Capstone milestone. ' }), h('span', { html: AP.inline(w.capstone) }), ' ', h('a', { href: '#/capstone', text: 'Open the capstone' })) : null,
          h('p', { class: 'small' }, h('a', { href: `#/week/${w.id}`, text: `Go to Week ${w.number} →` }))));
      return d;
    });

    /* ---- reading list ---- */
    const readHost = h('div');
    let readFilter = 'all';
    const drawReads = () => {
      const list = S.readingList.filter((r) => readFilter === 'all' || (readFilter === 'open' ? r.open : readFilter === 'restricted' ? !r.open : readFilter === 'required' ? r.required : !r.required));
      const entry = (r) => h('li', null, h('span', { class: 'syl-au', text: authors(r.authors) }), ` (${r.year}). `, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', html: AP.inline(r.title) }), '. ', h('i', { html: AP.inline(r.publication || '') }), ' ',
        h('span', { class: `tag ${r.open ? 'tag--done' : ''}`, text: r.accessLabel }), ' ', h('span', { class: 'small muted', text: `Week ${r.weeks.join(', ')}` }), ' ', h('a', { class: 'small', href: `#/library/${r.id}`, text: 'Library record' }));
      AP.clear(readHost).append(...[
        list.some((r) => r.required) ? [h('h3', { text: `Required (${list.filter((r) => r.required).length})` }), h('ol', { class: 'syl-refs' }, list.filter((r) => r.required).map(entry))] : [],
        list.some((r) => !r.required) ? [h('h3', { text: `Recommended (${list.filter((r) => !r.required).length})` }), h('ol', { class: 'syl-refs' }, list.filter((r) => !r.required).map(entry))] : []].flat());
    };
    drawReads();
    const readSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter readings' }, [['all', 'All'], ['required', 'Required'], ['recommended', 'Recommended'], ['open', 'Open access'], ['restricted', 'Restricted']].map(([k, l]) => h('button', { 'aria-pressed': String(k === readFilter), onclick: (e) => { readFilter = k; readSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); drawReads(); }, text: l })));

    const g = S.grading, c = S.capstone;
    const released = S.weeks.flatMap((w) => w.lessons).filter((l) => liveLec(l.id));
    const expandAll = (open) => weekDetails.forEach((d) => { d.open = open; });

    section('overview', '1', 'Course Overview',
      S.description.map((t, i) => h('p', { class: i ? null : 'lede', html: AP.inline(t) })),
      h('h3', { text: 'Educational philosophy' }), pairs(S.philosophy),
      h('h3', { text: 'Course objectives' }),
      h('p', { class: 'small muted', text: 'Each week states its own objectives (open any week below). Across the semester they build toward these nine:' }),
      h('ol', { class: 'syl-obj' }, S.outcomes.map((o) => h('li', null, h('b', { text: o.title }), h('span', { class: 'small muted', text: ` · Weeks ${o.weeks.join(', ')}` })))),
      h('h3', { text: 'Expected outcomes' }), h('p', { text: 'A working decision journal, fourteen pieces of applied professional work and a full executive capstone, with a measured record of your calibration, mastery and progress.' }));

    section('structure', '2', 'Academic Structure',
      h('p', { text: `${S.semester.weeks} weeks, planned at ${S.semester.hoursPerWeek} hours a week (${hrs(S.semester.plannedHours)} hours in all). Watching a lecture replaces reading the same lesson; optional readings are not counted.` }),
      h('div', { class: 'tablewrap' }, h('table', { class: 'syl-table' }, h('thead', null, h('tr', null, ['Week', 'Theme', 'School', 'Lessons', 'Hours'].map((x) => h('th', { text: x })))),
        h('tbody', null, S.weeks.map((w) => h('tr', null, h('td', { class: 'num', text: String(w.number) }), h('td', null, h('a', { href: `#/week/${w.id}`, html: AP.inline(w.title) })), h('td', { text: (S.semester.schools.find((s) => s.id === w.school) || {}).name?.replace('School of ', '') || '' }), h('td', { class: 'num', text: String(w.lessons.length) }), h('td', { class: 'num', text: hrs(w.totalHours) })))))),
      h('p', { class: 'small', text: S.semester.schools.map((s) => `${s.name}: Weeks ${s.weeks.join(', ')}`).join(' · ') }),
      h('h3', { text: 'Instructional formats' }), pairs(S.formats));

    section('schedule', '3', 'Weekly Schedule',
      h('div', { class: 'row' }, h('button', { class: 'btn btn--small', onclick: () => expandAll(true), text: 'Expand all weeks' }), h('button', { class: 'btn btn--small btn--quiet', onclick: () => expandAll(false), text: 'Collapse all' })),
      S.diagnostic ? h('p', { class: 'small muted' }, 'Week 1 begins with the ', h('a', { href: '#/diagnostic', text: S.diagnostic.title.toLowerCase() }), ` (${S.diagnostic.count} questions, ${S.diagnostic.minutes} min, not graded).`) : null,
      weekDetails);

    section('readings', '4', 'Reading List',
      h('p', { text: `${S.readingTotals.required} required and ${S.readingTotals.optional} recommended readings from a library of ${S.readingTotals.library} sources. ${S.readingTotals.open} are open access or free with registration; ${S.readingTotals.restricted} are restricted (paywalled, library access or purchase). Titles open the source in a new tab.` }),
      readSeg, readHost);

    section('grading', '5', 'Assessments & Grading',
      h('div', { class: 'tablewrap' }, h('table', { class: 'syl-table' }, h('thead', null, h('tr', null, ['Component', 'Weight', 'How it is scored in V1'].map((x) => h('th', { text: x })))),
        h('tbody', null, g.weights.map((x) => h('tr', null, h('td', null, h('b', { text: x.label })), h('td', { class: 'num syl-big', text: `${x.weight}%` }), h('td', { html: AP.inline(x.basis) })))))),
      h('p', null, h('b', { text: 'Mastery. ' }), `${pct(g.mastery)} of the auto-graded points on each weekly quiz and on the midterm. Below it, APERTURE lists the lessons and concepts behind your misses and offers a reassessment drawn from reserve questions. `, h('b', { text: 'Standing. ' }), g.standing, ' ', h('a', { href: '#/progress', text: 'See your standing' })),
      S.midterm ? h('p', null, h('b', { text: 'Midterm. ' }), h('a', { href: '#/midterm', html: AP.inline(S.midterm.title) }), ` — an original cumulative case, `, h('i', { text: S.midterm.caseTitle }), `, then ${S.midterm.count} questions (${S.midterm.reserve} in reserve); about ${Math.round(S.midterm.minutes / 60)} hours; Weeks ${S.midterm.covers[0]}–${S.midterm.covers[S.midterm.covers.length - 1]}.`) : null,
      h('h3', { text: 'Scoring rules' }), h('ul', null, g.scoring.map((x) => h('li', { html: AP.inline(x) }))),
      h('h3', { text: 'Formative work (not graded)' }), h('p', { text: g.ungraded.join(' · ') }),
      h('p', { class: 'small' }, h('a', { href: '#/assessments', text: 'Go to Assessments →' })));

    section('lectures', '6', 'Lecture Format',
      h('p', { text: 'Every lesson can be learned two ways. Watch Lecture is a narrated, interactive version: one narration track drives synchronized visuals, captions and a transcript, and pauses at interactive checkpoints (predict, decide, explore, reflect). Read Lesson is the full written lesson. Both cover the same objectives and sources and lead to the same comprehension check; finishing either completes the lesson.' }),
      h('p', { text: 'The player offers speed from 0.75× to 2×, chapters, captions, a clickable transcript, audio-only mode and keyboard shortcuts, on desktop and phone. Position and checkpoint answers are saved, so a lecture resumes where you stopped; checkpoints are never graded.' }),
      h('h3', { text: 'Release status' }),
      h('p', { text: `${released.length} narrated lectures are released now${S.lectures.voice ? `, in ${S.lectures.voice}, the official APERTURE narration voice` : ''}. The other ${S.weeks.flatMap((w) => w.lessons).filter((l) => soon(l.id)).length} are scripted and coming soon; their lessons open in the written view. Only the narrated version is pending — every lesson is complete and available.` }),
      released.length ? h('ul', { class: 'items' }, released.map((l) => { const lec = liveLec(l.id); return h('li', null, h('a', { href: `#/lesson/${l.id}/watch` }, h('span', { class: 'label', text: `▶ ${lec.minutes} min` }), h('span', null, h('span', { class: 'items__t', html: AP.inline(lec.title) }), h('span', { class: 'items__d', html: AP.inline(`Lesson: ${l.title} · ${lec.checkpoints} checkpoints`) })), h('span'))); })) : null);

    if (c) section('capstone', '7', 'Capstone Project',
      h('p', { class: 'lede', html: AP.inline(c.title) }), h('p', { html: AP.inline(c.organization.context) }), h('p', { class: 'small muted', html: AP.inline(c.fiction) }),
      h('p', { text: `From Week 8 to Week 14 you draft ${c.components.length} components, each in the week that teaches its tools, assemble them into ${c.deliverables.length} deliverables and defend them against ${c.defense} hard questions, working from ${c.exhibits} exhibits with three tools: ${c.tools.join('; ')}.` }),
      h('h3', { text: 'Deliverables and evaluation criteria' }),
      h('div', { class: 'tablewrap' }, h('table', { class: 'syl-table' }, h('thead', null, h('tr', null, ['Deliverable', 'Length', 'Rubric criteria (weight)'].map((x) => h('th', { text: x })))),
        h('tbody', null, c.deliverables.map((d) => h('tr', null, h('td', null, h('b', { text: d.title })), h('td', { class: 'num', text: `${d.words[0].toLocaleString('en-US')}–${d.words[1].toLocaleString('en-US')} words` }), h('td', { html: AP.inline(d.rubric.map((r) => `${r.criterion} (${r.weight})`).join('; ')) })))))),
      h('p', { class: 'small muted', text: 'Each deliverable is self-assessed against its four-level rubric; the capstone component is the average of the deliverables assessed.' }),
      h('h3', { text: 'Milestones' }), h('ul', null, c.milestones.map((m) => h('li', null, h('b', { text: `Week ${m.week}. ` }), h('span', { html: AP.inline(m.text) })))),
      h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Components' }), h('b', { text: `${c.components.length} components` })), h('div', { class: 'fold__body' }, h('ol', null, c.components.map((k) => h('li', null, h('a', { href: `#/capstone/k${String(k.number).padStart(2, '0')}`, html: AP.inline(k.title) }), h('span', { class: 'small muted', text: ` · Week ${k.week}` })))))),
      h('p', { class: 'small' }, h('a', { href: '#/capstone', text: 'Open the capstone →' })));

    section('resources', '8', 'Learning Resources', pairs(S.resources),
      h('h3', { text: 'Labs' }), h('ul', null, S.labs.map((l) => h('li', null, h('a', { href: `#/labs/${l.id}`, text: l.name }), h('span', { html: AP.inline(` — ${l.summary}`) })))),
      h('p', { class: 'small' }, h('a', { href: '#/library', text: 'Library' }), ' · ', h('a', { href: '#/notebook', text: 'Notebook' }), ' · ', h('a', { href: '#/labs', text: 'Labs' }), ' · ', h('a', { href: '#/glossary', text: 'Glossary' }), ' · ', h('a', { href: '#/progress', text: 'Progress' })));

    section('integrity', '9', 'Academic Integrity & Source Standards',
      h('p', { text: 'APERTURE separates what research shows from what APERTURE says. Every prose passage in the lessons carries one of six labels, shown beside it and counted in each lesson’s source panel.' }),
      h('div', { class: 'tablewrap' }, h('table', { class: 'syl-table' }, h('thead', null, h('tr', null, ['Label', 'Meaning', 'Passages'].map((x) => h('th', { text: x })))), h('tbody', null, S.integrity.kinds.map((k) => h('tr', null, h('td', null, h('b', { text: k.label })), h('td', { html: AP.inline(k.text) }), h('td', { class: 'num', text: String(k.count) })))))),
      h('h3', { text: 'AI-assisted materials' }), h('ul', null, S.integrity.ai.map((x) => h('li', { html: AP.inline(x) }))),
      h('h3', { text: 'Fiction and legal material' }), h('p', { html: AP.inline(S.integrity.fiction) }));

    section('outcomes', '10', 'Learning Outcomes', h('p', { text: 'By the end of Semester I you should be able to:' }),
      h('ol', { class: 'syl-outcomes' }, S.outcomes.map((o) => h('li', null, h('b', { text: `${o.title}. ` }), h('span', { html: AP.inline(o.text) }), h('span', { class: 'small muted', text: ` Weeks ${o.weeks.join(', ')}.` })))));

    section('notes', 'A', 'Not Specified in the Curriculum', h('p', { text: 'These are not defined in the deployed curriculum. They are listed rather than invented.' }),
      h('dl', { class: 'syl-gaps' }, S.gaps.flatMap((x) => [h('dt', { text: x.topic }), h('dd', { html: AP.inline(x.detail) })])));

    const toc = h('nav', { class: 'syl-toc', 'aria-label': 'Syllabus sections' }, h('span', { class: 'label', text: 'Contents' }),
      h('ol', null, sections.map(([id, n, t, el]) => h('li', null, h('button', { class: 'linklike', onclick: () => el.scrollIntoView({ behavior: AP.settings.reducedMotion ? 'auto' : 'smooth', block: 'start' }) }, h('span', { class: 'syl-n', text: n }), t)))));

    const el = h('div', { class: 'syl' },
      h('header', { class: 'pagehead' }, h('span', { class: 'label', text: `${S.semester.title} · Syllabus` }), h('h1', { html: AP.inline(S.semester.name) }),
        h('p', { class: 'lede', text: `${S.semester.weeks} weeks · ${S.semester.hoursPerWeek} hours a week · ${S.stats.lessons} lessons · ${S.semester.schools.length} schools` }),
        h('div', { class: 'row' },
          h('a', { class: 'btn btn--primary', href: PDF, download: '', 'aria-label': 'Download the syllabus as a PDF' }, `Download PDF${stamp && stamp.pages ? ` · ${stamp.pages} pages` : ''}`),
          h('a', { class: 'btn', href: '#/curriculum', text: 'Back to the curriculum' })),
        pdfCurrent ? null : h('p', { class: 'small muted', text: 'The PDF is being regenerated for the latest curriculum; this page is current.' })),
      h('div', { class: 'syl-glance panel' }, h('dl', { class: 'kv small' },
        h('dt', { text: 'Assessment' }), h('dd', { text: g.weights.map((x) => `${x.label} ${x.weight}%`).join(' · ') }),
        h('dt', { text: 'Mastery' }), h('dd', { text: `${pct(g.mastery)} on quizzes and the midterm` }),
        h('dt', { text: 'Lectures' }), h('dd', { text: `${released.length} narrated now · the rest coming soon` }),
        h('dt', { text: 'Format' }), h('dd', { text: 'Self-paced; every lesson open; the sequence is a recommendation' }))),
      h('p', { class: 'small muted', text: S.disclaimer }),
      toc, sections.map((s) => s[3]));
    if (weekId) requestAnimationFrame(() => { const d = document.getElementById(`syl-${weekId}`); if (d) d.scrollIntoView({ block: 'start' }); });
    return { el, title: 'Syllabus' };
  };
})();
