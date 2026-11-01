/* APERTURE — navigation views: Home, Curriculum, Week, Library, Labs, Assessments, Notebook,
   Progress, Settings. Study views (lesson reader, assessments, labs, journal) live in study.js. */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const V = (AP.views = {});
  const SCHOOL = { behavioral: 'Behavioral & Social Science', business: 'Business & Leadership', law: 'Law & Strategy' };
  AP.SCHOOL = SCHOOL;
  const head = (label, title, lede) => h('header', { class: 'pagehead' }, h('span', { class: 'label', text: label }), h('h1', { html: AP.inline(title) }), lede ? h('p', { class: 'lede', html: AP.inline(lede) }) : null);
  AP.head = head;
  const lessonDone = (id) => !!AP.getRec('progress', id)?.done;

  /* ---------- shared status helpers ---------- */
  function weekStatus(w, prog) {
    const p = prog && prog.weeks.find((x) => x.id === w.id);
    if (!p) return { label: 'Upcoming', cls: '' };
    const complete = p.lessonsDone === p.lessonsTotal && p.quiz && p.quiz.mastered && p.assignment;
    if (complete) return { label: 'Completed', cls: 'tag--done', p };
    if (p.started) return { label: 'Active', cls: 'tag--accent', p };
    return { label: 'Upcoming', cls: '', p };
  }
  AP.currentWeek = function (cat, prog) {
    for (const w of cat.weeks) { const s = weekStatus(w, prog); if (s.label !== 'Completed') return w; }
    return cat.weeks[cat.weeks.length - 1];
  };

  /* ---------- Home ---------- */
  V.home = async function () {
    const [cat, prog] = await Promise.all([AP.catalog(), AP.api('progress')]);
    await AP.loadState(['note', 'lecture']);
    const cur = AP.currentWeek(cat, prog);
    const totalLessons = cat.weeks.reduce((a, w) => a + w.lessons.length, 0);
    const doneLessons = prog.weeks.reduce((a, w) => a + w.lessonsDone, 0);
    const progRecs = Object.entries(AP.state.progress || {}).filter(([, v]) => !v.data.done).sort((a, b) => b[1].updated - a[1].updated);
    const resume = progRecs[0] ? findLesson(cat, progRecs[0][0]) : null;
    const nextLesson = cur.lessons.find((l) => !lessonDone(l.id));
    const cw = prog.weeks.find((x) => x.id === cur.id);

    const lecFor = (lid) => (AP.lecturesOn() && cat.lectures && cat.lectures[lid]) || null;
    const fmtT = (t) => `${Math.floor((t || 0) / 60)}:${String(Math.floor((t || 0) % 60)).padStart(2, '0')}`;
    const lecRecs = Object.entries(AP.state.lecture || {}).filter(([, v]) => !v.data.completed && v.data.position > 5).sort((a, b) => b[1].updated - a[1].updated);
    const resumeLec = (() => { if (!lecRecs.length) return null; const [lid, v] = lecRecs[0]; const lessonId = lid.replace(/-lecture$/, ''); const fl = findLesson(cat, lessonId); const meta = lecFor(lessonId); return fl && meta ? { lesson: lessonId, title: meta.title, w: fl.w, position: v.data.position, duration: v.data.duration || meta.duration } : null; })();
    const nextLec = nextLesson && lecFor(nextLesson.id);
    // Today's suggested activity — transparent priority order.
    let suggest;
    if (!prog.diagnostic && cat.diagnostic) suggest = { t: 'Take the baseline diagnostic', d: `${cat.diagnostic.count} questions, about ${cat.diagnostic.minutes} minutes. It calibrates explanations; it never skips material.`, href: '#/diagnostic' };
    else if (prog.retention.due >= 5) suggest = { t: `Review ${prog.retention.due} concepts due today`, d: 'Spaced retrieval now is worth more than a new lesson.', href: '#/review' };
    else if (resumeLec) suggest = { t: `Resume the lecture “${resumeLec.title}”`, d: `Week ${resumeLec.w.number} · at ${fmtT(resumeLec.position)} of ${fmtT(resumeLec.duration)}`, href: `#/lesson/${resumeLec.lesson}/watch` };
    else if (resume) suggest = { t: `Continue “${resume.l.title}”`, d: `Week ${resume.w.number} · ${resume.l.minutes} min`, href: `#/lesson/${resume.l.id}` };
    else if (nextLesson && lecFor(nextLesson.id)) suggest = { t: `Watch the lecture “${lecFor(nextLesson.id).title}”`, d: `Week ${cur.number} · ${lecFor(nextLesson.id).minutes}-minute narrated lecture for “${nextLesson.title}” — or read the lesson instead`, href: `#/lesson/${nextLesson.id}/watch` };
    else if (nextLesson) suggest = { t: `Begin “${nextLesson.title}”`, d: `Week ${cur.number} · ${nextLesson.minutes} min`, href: `#/lesson/${nextLesson.id}` };
    else if (!(cw && cw.quiz && cw.quiz.mastered)) suggest = { t: `Take the Week ${cur.number} quiz`, d: `${cur.quiz.count} questions · mastery at 80%`, href: `#/assess/${cur.quiz.id}` };
    else if (!(cw && cw.assignment)) suggest = { t: cur.assignment.title, d: `Week ${cur.number} applied assignment`, href: `#/assignment/${cur.assignment.id}` };
    else suggest = { t: 'Open the next week', d: '', href: `#/week/${cur.id}` };
    const why = 'Order: diagnostic first; then five or more reviews due; then the lecture or lesson you left open; then the next lesson (lecture first), quiz and assignment of the current week.';

    const upcoming = [];
    if (cw && !(cw.quiz && cw.quiz.mastered)) upcoming.push({ t: `Week ${cur.number} quiz`, d: cw.quiz ? `Best ${AP.pct(cw.quiz.auto)} auto-graded · reassess below 80%` : `${cur.quiz.count} questions`, href: `#/assess/${cur.quiz.id}` });
    if (cat.midterm && cur.number >= 6) upcoming.push({ t: cat.midterm.title, d: `Covers Weeks 1–7 · ${cat.midterm.minutes} min`, href: '#/midterm' });
    if (cur.number >= 8 && cat.capstone) upcoming.push({ t: 'Capstone components', d: 'Drafted incrementally from Week 8', href: '#/capstone' });

    const wk = await AP.week(cur.id);
    const notes = Object.entries(AP.state.note || {}).sort((a, b) => b[1].updated - a[1].updated).slice(0, 3);

    const el = h('div', null,
      h('header', { class: 'pagehead' },
        h('span', { class: 'label', text: `${cat.semester.title} · ${cat.semester.name}` }),
        h('h1', { text: `Week ${cur.number}. ${cur.title}` }),
        h('p', { class: 'question', text: cur.question })),
      h('div', { class: 'grid grid--2' },
        h('section', { class: 'panel' }, h('span', { class: 'label label--accent', text: 'Today’s suggested activity' }), h('h3', null, h('a', { href: suggest.href, text: suggest.t })), h('p', { class: 'muted', text: suggest.d }), h('p', { class: 'small muted', text: why })),
        h('section', { class: 'panel' }, h('span', { class: 'label', text: 'Overall progress' }),
          h('dl', { class: 'kv' },
            h('dt', { text: 'Lessons' }), h('dd', { class: 'num', text: `${doneLessons} of ${totalLessons}` }),
            prog.lectures && prog.lectures.available ? [h('dt', { text: 'Lectures watched' }), h('dd', { class: 'num', text: `${prog.lectures.completed} of ${prog.lectures.available}` })] : null,
            h('dt', { text: 'Quizzes at mastery' }), h('dd', { class: 'num', text: `${prog.weeks.filter((w) => w.quiz && w.quiz.mastered).length} of ${cat.weeks.length}` }),
            h('dt', { text: 'Concepts mastered' }), h('dd', { class: 'num', text: `${prog.concepts.mastered} of ${prog.concepts.introduced} introduced` }),
            h('dt', { text: 'Due for review' }), h('dd', null, prog.retention.due ? h('a', { href: '#/review', text: `${prog.retention.due} cards` }) : '0 cards')),
          h('div', { class: 'meter', 'aria-hidden': 'true' }, meterFill(doneLessons / Math.max(1, totalLessons))))),
      h('div', { class: 'grid grid--3 rule' },
        h('section', null, h('span', { class: 'label', text: 'Resume lecture' }),
          resumeLec ? h('div', null, h('a', { class: 'btn btn--primary', href: `#/lesson/${resumeLec.lesson}/watch` }, `▶ Resume “${resumeLec.title}”`), h('p', { class: 'small muted', text: `Week ${resumeLec.w.number} · ${fmtT(resumeLec.position)} of ${fmtT(resumeLec.duration)}` }))
            : nextLec ? h('div', null, h('a', { class: 'btn btn--primary', href: `#/lesson/${nextLesson.id}/watch` }, `▶ Watch “${nextLec.title}”`), h('p', { class: 'small muted', text: `Next lecture · Week ${cur.number} · ${nextLec.minutes} min` })) : h('p', { class: 'empty', text: 'No lecture in progress.' }),
          h('span', { class: 'label rule', text: 'Resume reading' }),
          resume ? h('p', null, h('a', { href: `#/lesson/${resume.l.id}`, text: resume.l.title }), h('br'), h('span', { class: 'small muted', text: `Week ${resume.w.number} · saved at ${AP.getRec('progress', resume.l.id).section}` })) : h('p', { class: 'empty', text: 'Nothing open. Begin with the suggested activity.' })),
        h('section', null, h('span', { class: 'label', text: 'Upcoming assessment' }), upcoming.length ? h('ul', { class: 'list' }, upcoming.map((u) => h('li', null, h('a', { href: u.href, text: u.t }), h('div', { class: 'small muted', text: u.d })))) : h('p', { class: 'empty', text: 'Nothing pending this week.' })),
        h('section', null, h('span', { class: 'label', text: 'Reading queue' }), h('ul', { class: 'list' }, (wk.readings.required || []).map((r) => {
          const res = AP.cache.libIndex.get(r.ref);
          return h('li', null, h('a', { href: `#/library/${r.ref}`, text: res ? res.title : r.ref }), h('div', { class: 'small muted', text: `${r.what} · ${r.minutes} min` }));
        })))),
      h('div', { class: 'grid grid--2 rule' },
        h('section', null, h('span', { class: 'label', text: 'Recent notes' }), notes.length ? h('ul', { class: 'list' }, notes.map(([, n]) => h('li', null, h('div', { class: 'small muted', text: targetLabel(cat, n.data.target) }), h('div', { text: (n.data.text || n.data.quote || '').slice(0, 220) })))) : h('p', { class: 'empty', text: 'Highlights and notes you make while reading appear here.' }), h('p', null, h('a', { class: 'small', href: '#/notebook', text: 'Open the notebook' }))),
        h('section', null, h('span', { class: 'label', text: 'Mastery overview' }), masteryStrip(cat, prog), h('p', null, h('a', { class: 'small', href: '#/progress', text: 'Full progress and transcript' })))),
    );
    return { el, title: 'Home' };
  };
  function meterFill(x) { const s = h('span'); s.style.width = `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`; return s; }
  AP.meterFill = meterFill;
  function masteryStrip(cat, prog) {
    const t = h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Week' }), h('th', { text: 'Lessons' }), h('th', { text: 'Quiz' }), h('th', { text: 'Assignment' }))));
    const b = h('tbody');
    for (const w of prog.weeks) b.appendChild(h('tr', null, h('td', null, h('a', { href: `#/week/${w.id}`, text: `${w.number}. ${w.title}` })), h('td', { class: 'num', text: `${w.lessonsDone}/${w.lessonsTotal}` }), h('td', { text: w.quiz ? `${AP.pct(w.quiz.auto)}${w.quiz.mastered ? ' ✓' : ''}` : '—' }), h('td', { text: w.assignment ? 'Submitted' : '—' })));
    t.appendChild(b);
    return h('div', { class: 'tablewrap' }, t);
  }
  function findLesson(cat, id) { for (const w of cat.weeks) for (const l of w.lessons) if (l.id === id) return { w, l }; return null; }
  AP.findLesson = findLesson;
  function targetLabel(cat, t) {
    if (!t) return '';
    const fl = findLesson(cat, t); if (fl) return `Week ${fl.w.number} · ${fl.l.title}`;
    const w = cat.weeks.find((x) => x.id === t); if (w) return `Week ${w.number}`;
    const r = AP.cache.libIndex.get(t); if (r) return `Library · ${r.title}`;
    const g = cat.glossary.find((x) => x.id === t); if (g) return `Glossary · ${g.term}`;
    if (cat.concepts[t]) return `Concept · ${cat.concepts[t].name}`;
    return t;
  }
  AP.targetLabel = targetLabel;

  /* ---------- Curriculum ---------- */
  V.curriculum = async function () {
    const [cat, prog] = await Promise.all([AP.catalog(), AP.api('progress')]);
    const list = h('ol', { class: 'weeks' });
    const extra = (href, n, t, d, tag) => h('li', null, h('a', { class: 'week-row', href }, h('span', { class: 'week-row__n', text: n }), h('span', null, h('h3', { text: t }), h('p', { class: 'week-row__q', text: d })), h('span', { class: 'week-row__meta' }, tag)));
    if (cat.diagnostic) list.appendChild(extra('#/diagnostic', '0', 'Baseline diagnostic', 'Where are you starting? Nine domains, never graded.', h('span', { class: `tag ${prog.diagnostic ? 'tag--done' : 'tag--accent'}`, text: prog.diagnostic ? 'Completed' : 'Start here' })));
    for (const w of cat.weeks) {
      const s = weekStatus(w, prog);
      list.appendChild(h('li', null, h('a', { class: 'week-row', href: `#/week/${w.id}` },
        h('span', { class: 'week-row__n', text: String(w.number) }),
        h('span', null, h('span', { class: 'label', text: w.schools.map((x) => SCHOOL[x]).join(' · ') }), h('h3', { text: w.title }), h('p', { class: 'week-row__q', text: w.question })),
        h('span', { class: 'week-row__meta' }, h('span', { class: `tag ${s.cls}`, text: s.label }), h('span', { class: 'small muted num', text: `${s.p ? s.p.lessonsDone : 0}/${w.lessons.length} lessons · ${hours(w.hours)} h` }), (() => { const n = w.lessons.filter((l) => cat.lectures && cat.lectures[l.id]).length; return n && AP.lecturesOn() ? h('span', { class: 'tag tag--accent', text: `▶ ${n} lecture${n > 1 ? 's' : ''}` }) : null; })()))));
      if (w.number === 7 && cat.midterm) list.appendChild(extra('#/midterm', 'M', cat.midterm.title, 'Cumulative case and questions on Weeks 1–7.', h('span', { class: 'tag', text: `${cat.midterm.minutes} min` })));
    }
    if (cat.capstone) list.appendChild(extra('#/capstone', 'C', cat.capstone.title, `${cat.capstone.components} components, built incrementally from Week 8.`, h('span', { class: 'tag', text: 'Capstone' })));
    const s = cat.stats;
    return { el: h('div', null, head(`${cat.semester.title} · 14 weeks · ${cat.semester.hoursPerWeek} hours a week`, cat.semester.name, 'Broaden perspective. Deepen understanding. Strengthen judgment. Every lesson is open to you; the sequence is a recommendation, not a gate.'),
      h('p', { class: 'small muted', text: `${s.lessons} lessons · ${s.quizQuestions + s.checkQuestions} assessment questions · ${s.cases} original cases · ${s.resources} library resources · about ${Math.round(s.plannedHours)} planned hours` }), list), title: 'Curriculum' };
  };
  const hours = (hh) => Math.round(Object.values(hh).reduce((a, b) => a + b, 0) * 10) / 10;

  /* ---------- Week ---------- */
  V.week = async function (id) {
    const [cat, w, prog] = await Promise.all([AP.catalog(), AP.week(id), AP.api('progress')]);
    await AP.loadState(['reflection', 'lab', 'case', 'draft']);
    const p = prog.weeks.find((x) => x.id === id);
    const item = (label, href, title, desc, status) => h('li', null, h('a', { href }, h('span', { class: 'label', text: label }), h('span', null, h('span', { class: 'items__t', html: AP.inline(title) }), desc ? h('span', { class: 'items__d', html: AP.inline(desc) }) : null), status ? h('span', { class: `tag ${status[1] || ''}`, text: status[0] }) : h('span')));
    const lecOf = (l) => AP.lecturesOn && AP.lecturesOn() && cat.lectures && cat.lectures[l.id];
    await AP.loadState(['lecture']);
    const lessons = h('ol', { class: 'items items--lessons' }, w.lessons.map((l, i) => {
      const lec = lecOf(l);
      const st = lessonDone(l.id) ? ['Done', 'tag--done'] : AP.getRec('progress', l.id) || (lec && AP.getRec('lecture', lec.id)) ? ['In progress', 'tag--accent'] : null;
      return h('li', { class: 'lesson-item' },
        h('a', { href: `#/lesson/${l.id}${lec ? '/watch' : ''}` }, h('span', { class: 'label', text: `Lesson ${i + 1}` }), h('span', null, h('span', { class: 'items__t', html: AP.inline(l.title) }), h('span', { class: 'items__d', html: AP.inline(l.summary) })), st ? h('span', { class: `tag ${st[1]}`, text: st[0] }) : h('span')),
        h('div', { class: 'lesson-actions' },
          lec ? h('a', { class: 'btn btn--primary btn--small lesson-play', href: `#/lesson/${l.id}/watch`, 'aria-label': `Watch the lecture for ${l.title}` }, `▶ Watch lecture · ${lec.minutes} min`) : null,
          h('a', { class: 'btn btn--small', href: `#/lesson/${l.id}/read`, 'aria-label': `Read the lesson ${l.title}` }, `Read lesson · ${l.minutes} min`)));
    }));
    const lecs = w.lessons.map(lecOf).filter(Boolean);
    const labRec = AP.getRec('lab', w.exercise.id);
    const work = h('ul', { class: 'items' },
      item(`Exercise · ${w.exercise.minutes} min`, `#/exercise/${w.exercise.id}`, w.exercise.title, labName(cat, w.exercise.lab), labRec && labRec.finished ? ['Done', 'tag--done'] : labRec ? ['In progress', 'tag--accent'] : null),
      item(`Case · ${w.case.minutes} min`, `#/case/${w.case.id}`, w.case.title, `Original case · ${w.case.setting}`, AP.getRec('case', w.case.id)?.analysis ? ['Analysis saved', 'tag--accent'] : null),
      item(`Quiz · ${w.quiz.minutes} min`, `#/assess/${w.quiz.id}`, w.quiz.title, `${w.quiz.count} questions · mastery at ${Math.round(w.quiz.mastery * 100)}%`, p && p.quiz ? [p.quiz.mastered ? `Mastered ${AP.pct(p.quiz.auto)}` : `Best ${AP.pct(p.quiz.auto)}`, p.quiz.mastered ? 'tag--done' : 'tag--accent'] : null),
      item(`Assignment · ${w.assignment.minutes} min`, `#/assignment/${w.assignment.id}`, w.assignment.title, w.assignment.deliverable, p && p.assignment ? ['Submitted', 'tag--done'] : AP.getRec('draft', w.assignment.id) ? ['Draft saved', 'tag--accent'] : null),
    );
    const readings = (kind) => h('ul', { class: 'items' }, (w.readings[kind] || []).map((r) => { const res = AP.cache.libIndex.get(r.ref); return item(`${kind === 'required' ? 'Required' : 'Optional'} · ${r.minutes} min`, `#/library/${r.ref}`, res ? res.title : r.ref, `${res ? AP.shortRef(r.ref) + ' · ' : ''}${r.what}. ${r.why}`, res && res.access !== 'open' ? [res.access] : res ? ['Open access', 'tag--done'] : null); }));
    const refl = reflectionForm(w);
    const el = h('div', null,
      h('div', { class: 'weekhead' },
        h('div', null, h('span', { class: 'label', text: `Week ${w.number} · ${w.schools.map((x) => SCHOOL[x]).join(' · ')}` }), h('h1', { text: w.title }), h('p', { class: 'lede', text: w.theme }), h('p', { class: 'question', text: w.question }), AP.blocks(h('div', { class: 'prose' }), w.overview)),
        h('aside', { class: 'panel' }, h('span', { class: 'label', text: 'This week' }), h('dl', { class: 'kv small' }, ...Object.entries(w.hours).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: 'num', text: `${v} h` })])), h('hr'), h('span', { class: 'label', text: 'Objectives' }), h('ul', { class: 'small' }, w.objectives.map((o) => h('li', { html: AP.inline(o) }))))),
      h('section', { class: 'rule' }, h('div', { class: 'row row--between' }, h('h2', { text: 'Lessons' }), lecs.length ? h('span', { class: 'tag tag--accent', text: `${lecs.length} narrated lectures · ${lecs.reduce((a, x) => a + x.minutes, 0)} min` }) : null), h('p', { class: 'small muted', text: lecs.length ? 'Each lesson can be watched as a narrated lecture or read in full. Either one completes the lesson — you do not need both.' : '' }), lessons),
      h('section', { class: 'rule' }, h('h2', { text: 'Apply and assess' }), work),
      h('section', { class: 'rule' }, h('h2', { text: 'Readings' }), readings('required'), h('h3', { class: 'rule', text: 'Optional' }), readings('optional')),
      h('section', { class: 'rule' }, h('h2', { text: 'Reflection' }), h('p', { class: 'muted small', text: `${w.reflection.minutes} minutes. Private to you; saved to your notebook.` }), refl),
      h('section', { class: 'rule' }, h('h2', { text: 'Glossary' }), h('dl', { class: 'kv' }, w.glossary.flatMap((g) => [h('dt', { id: g.id }, h('a', { href: `#/glossary/${g.id}`, text: g.term })), h('dd', { html: AP.inline(g.definition) })]))),
      h('section', { class: 'rule' }, h('h2', { text: 'Looking ahead' }), h('p', { class: 'prose', html: AP.inline(w.preview.text) }), h('ul', null, w.preview.links.map((l) => { const t = cat.weeks.find((x) => x.number === l.week); return h('li', null, t ? h('a', { href: `#/week/${t.id}`, text: `Week ${t.number}: ${t.title}` }) : `Week ${l.week}`, ' — ', h('span', { html: AP.inline(l.why) })); }))),
    );
    return { el, title: `Week ${w.number}` };
  };
  function labName(cat, id) { const l = cat.labs.find((x) => x.id === id); return l ? l.name : id; }
  function reflectionForm(w) {
    const rec = AP.getRec('reflection', w.id) || { answers: [] };
    const answers = w.reflection.prompts.map((_, i) => rec.answers[i] || '');
    return h('div', null, w.reflection.prompts.map((pr, i) => h('label', { class: 'field' }, h('span', { html: AP.inline(pr) }), h('textarea', { value: answers[i], oninput: (e) => { answers[i] = e.target.value; AP.save('reflection', w.id, { answers }); } }))));
  }

  /* ---------- Library ---------- */
  V.library = async function () {
    const [lib, cat] = await Promise.all([AP.library(), AP.catalog()]);
    await AP.loadState(['bookmark']);
    const opts = (vals) => [...new Set(vals)].filter(Boolean).sort();
    const f = { q: '', discipline: '', type: '', evidence: '', week: '', saved: false };
    const out = h('div');
    const sel = (key, label, values) => h('label', { class: 'field' }, h('span', { text: label }), h('select', { onchange: (e) => { f[key] = e.target.value; draw(); } }, h('option', { value: '', text: 'All' }), values.map((v) => h('option', { value: v, text: v }))));
    const filters = h('div', { class: 'filters', role: 'search' },
      h('label', { class: 'field' }, h('span', { text: 'Search' }), h('input', { type: 'search', placeholder: 'Title, author, idea…', oninput: (e) => { f.q = e.target.value.toLowerCase(); draw(); } })),
      sel('discipline', 'Discipline', opts(lib.resources.map((r) => r.discipline))), sel('type', 'Type', opts(lib.resources.map((r) => r.type))),
      sel('evidence', 'Evidence', opts(lib.resources.map((r) => r.evidence))), sel('week', 'Week', cat.weeks.map((w) => w.id)));
    function draw() {
      const list = lib.resources.filter((r) => (!f.q || `${r.title} ${r.authors.join(' ')} ${r.summary} ${r.publication}`.toLowerCase().includes(f.q)) && (!f.discipline || r.discipline === f.discipline) && (!f.type || r.type === f.type) && (!f.evidence || r.evidence === f.evidence) && (!f.week || r.weeks.includes(f.week)) && (!f.saved || AP.getRec('bookmark', r.id)));
      AP.clear(out).appendChild(h('p', { class: 'small muted', text: `${list.length} of ${lib.resources.length} resources` }));
      for (const r of list) out.appendChild(resRow(r));
      if (!list.length) out.appendChild(h('p', { class: 'empty', text: 'No resources match these filters.' }));
    }
    draw();
    const savedBtn = h('button', { class: 'btn btn--small', 'aria-pressed': 'false', onclick: (e) => { f.saved = !f.saved; e.currentTarget.setAttribute('aria-pressed', String(f.saved)); draw(); }, text: 'Bookmarked only' });
    const t = lib.manifest.totals;
    return { el: h('div', null, head('Library', 'A curated research library', 'Every lesson cites these records by stable ID. Each shows how it was verified, what kind of evidence it is, and its limitations.'),
      h('div', { class: 'row', style: null }, h('a', { class: 'btn btn--small', href: '#/audit', text: 'Research audit (reference programs)' }), h('a', { class: 'btn btn--small', href: '#/manifest', text: 'Source manifest' }), h('a', { class: 'btn btn--small', href: '#/glossary', text: 'Glossary' }), savedBtn),
      h('p', { class: 'small muted', text: `${t.metadataConfirmed} metadata-confirmed · ${t.partiallyConfirmed} partially confirmed · ${t.unverified} unverified · links not yet opened from the build environment: ${t.linkUntested}` }),
      filters, out), title: 'Library' };
  };
  function resRow(r) {
    return h('article', { class: 'res' }, h('div', { class: 'res__t' }, h('a', { href: `#/library/${r.id}`, text: r.title })), h('div', { class: 'res__m', text: `${r.authors.join(', ')} · ${r.year} · ${r.publication}` }),
      h('div', { class: 'row' }, h('span', { class: 'tag', text: r.type }), h('span', { class: 'tag', text: r.evidence }), h('span', { class: `tag ${r.access === 'open' ? 'tag--done' : ''}`, text: r.access }), r.verified.status !== 'metadata-confirmed' ? h('span', { class: 'tag tag--accent', text: r.verified.status }) : null, r.contested ? h('span', { class: 'tag tag--accent', text: 'contested' }) : null, AP.getRec('bookmark', r.id) ? h('span', { class: 'tag', text: 'bookmarked' }) : null));
  }
  V.resource = async function (id) {
    const [lib, cat] = await Promise.all([AP.library(), AP.catalog()]);
    await AP.loadState(['bookmark', 'note']);
    const r = lib.resources.find((x) => x.id === id);
    if (!r) return h('p', { class: 'empty', text: 'This resource is not in the library.' });
    const bm = h('button', { class: 'btn btn--small', 'aria-pressed': String(!!AP.getRec('bookmark', id)), onclick: async (e) => { const on = !AP.getRec('bookmark', id); if (on) await AP.save('bookmark', id, { label: r.title }, { delay: 0 }); else await AP.remove('bookmark', id); e.target.setAttribute('aria-pressed', String(on)); e.target.textContent = on ? 'Bookmarked' : 'Bookmark'; }, text: AP.getRec('bookmark', id) ? 'Bookmarked' : 'Bookmark' });
    const row = (k, v) => (v ? [h('dt', { text: k }), h('dd', { html: AP.inline(String(v)) })] : []);
    const lessons = r.lessons.map((lid) => findLesson(cat, lid)).filter(Boolean);
    const myNotes = Object.entries(AP.state.note || {}).filter(([, n]) => n.data.target === id);
    const noteBox = h('textarea', { placeholder: 'A private note about this source…' });
    const el = h('div', null,
      h('header', { class: 'pagehead' }, h('span', { class: 'label', text: `${r.type} · ${r.discipline} · ${r.id}` }), h('h1', { text: r.title }), h('p', { class: 'lede', text: `${r.authors.join(', ')} (${r.year}). ${r.publication}.` }),
        h('div', { class: 'row' }, h('a', { class: 'btn btn--primary btn--small', href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.access === 'open' ? 'Open the source' : 'Find the source' }), bm)),
      r.flags.length ? h('div', { class: 'notice notice--plain small', text: `Flags: ${r.flags.join(', ')}. ${r.flags.includes('link-untested') ? 'The link was taken from verified search results but could not be opened from the build environment; confirm it in your browser.' : ''}` }) : null,
      h('div', { class: 'grid grid--2' },
        h('section', null, h('h3', { text: 'Summary' }), h('p', { class: 'prose', html: AP.inline(r.summary) }), h('h3', { text: 'Key arguments' }), h('ul', null, r.arguments.map((a) => h('li', { html: AP.inline(a) }))),
          h('h3', { text: 'Strengths' }), h('p', { html: AP.inline(r.strengths) }), h('h3', { text: 'Limitations' }), h('p', { html: AP.inline(r.limitations) }), r.contested ? [h('h3', { text: 'Contested' }), h('p', { html: AP.inline(r.contested) })] : null,
          h('h3', { text: 'Does it generalize?' }), h('p', { html: AP.inline(r.generalizability) }), h('h3', { text: 'Why it matters to you' }), h('p', { html: AP.inline(r.relevance) })),
        h('aside', null, h('div', { class: 'panel' }, h('span', { class: 'label', text: 'Record' }), h('dl', { class: 'kv small' }, ...row('Evidence', r.evidence), ...row('Design', r.design), ...row('DOI', r.doi), ...row('Access', r.access), ...row('License', r.license), ...row('Reading time', `${r.readingMinutes} min`))),
          h('div', { class: 'panel', style: null }, h('span', { class: 'label', text: 'Verification' }), h('dl', { class: 'kv small' }, ...row('Status', r.verified.status), ...row('Checked', r.verified.date), ...row('Method', r.verified.method), ...row('Evidence', r.verified.evidence), ...row('Link', r.verified.link))),
          h('div', { class: 'panel panel--plain' }, h('span', { class: 'label', text: 'Cited in' }), lessons.length ? h('ul', { class: 'small' }, lessons.map(({ w, l }) => h('li', null, h('a', { href: `#/lesson/${l.id}`, text: `Week ${w.number}: ${l.title}` })))) : h('p', { class: 'small muted', text: r.places.join(', ') || 'Not cited yet.' })),
          h('div', { class: 'panel panel--plain' }, h('span', { class: 'label', text: 'Your notes' }), h('ul', { class: 'list small' }, myNotes.map(([, n]) => h('li', { text: n.data.text }))), noteBox, h('p', null, h('button', { class: 'btn btn--small', onclick: async () => { if (!noteBox.value.trim()) return; await AP.save('note', AP.newId(), { target: id, text: noteBox.value, created: Date.now() }, { delay: 0 }); AP.rerender(); }, text: 'Save note' }))))));
    return { el, title: r.title };
  };
  V.manifest = async function () {
    const lib = await AP.library();
    const t = lib.manifest.totals;
    const tb = h('tbody', null, lib.resources.map((r) => h('tr', null, h('td', null, h('a', { href: `#/library/${r.id}`, text: r.title })), h('td', { class: 'num', text: String(r.year) }), h('td', { text: r.verified.status }), h('td', { text: r.verified.date }), h('td', { text: r.access }), h('td', { class: 'small', text: r.flags.join(', ') }))));
    return { el: h('div', null, head('Library · audit trail', 'Source manifest', lib.manifest.method),
      h('dl', { class: 'kv' }, ...Object.entries(t).flatMap(([k, v]) => [h('dt', { text: k.replace(/([A-Z])/g, ' $1').toLowerCase() }), h('dd', { class: 'num', text: String(v) })])),
      h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Resource', 'Year', 'Status', 'Checked', 'Access', 'Flags'].map((x) => h('th', { text: x })))), tb))), title: 'Source manifest' };
  };
  V.audit = async function () {
    const a = await AP.get('audit', 'audit');
    const cat = { phd: 'PhD programs', mba: 'MBA programs', jdmba: 'JD/MBA programs' };
    const el = h('div', null, head('Deliverable A · Research audit', a.title || 'Reference programs', null), h('div', { class: 'notice', html: AP.inline(a.disclaimer) }),
      h('section', { class: 'prose' }, h('h2', { text: 'Method' }), AP.blocks(h('div'), a.method)),
      h('section', { class: 'rule' }, h('h2', { text: 'Criteria' }), h('dl', { class: 'kv' }, a.criteria.flatMap((c) => [h('dt', { text: c.label }), h('dd', { html: AP.inline(c.description) })]))),
      ...Object.entries(cat).map(([k, label]) => h('section', { class: 'rule' }, h('h2', { text: label }), a.programs.filter((p) => p.category === k).map((p) => h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: p.verified.status }), h('b', { text: `${p.institution} — ${p.name}` })),
        h('div', { class: 'fold__body' }, h('p', { html: AP.inline(p.summary) }), h('dl', { class: 'kv small' }, h('dt', { text: 'Core areas' }), h('dd', { text: (p.coreAreas || []).join('; ') }), h('dt', { text: 'Methods' }), h('dd', { text: (p.methods || []).join('; ') }), h('dt', { text: 'Distinctive' }), h('dd', { html: AP.inline(p.distinctive || '') }), h('dt', { text: 'Informs' }), h('dd', null, p.informs.map((w, i) => [i ? ', ' : '', h('a', { href: `#/week/${w}`, text: w })])), h('dt', { text: 'How used' }), h('dd', { html: AP.inline(p.howUsed || '') }), h('dt', { text: 'Limitations' }), h('dd', { html: AP.inline(p.limitations) }), h('dt', { text: 'Verification' }), h('dd', { html: AP.inline(p.verified.evidence || '') }), h('dt', { text: 'Official page' }), h('dd', null, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: p.url })))))))),
      h('section', { class: 'rule' }, h('h2', { text: 'Open educational resources' }), h('ul', { class: 'list' }, a.oer.map((o) => { const r = AP.cache.libIndex.get(o.ref); return h('li', null, h('a', { href: `#/library/${o.ref}`, text: r ? r.title : o.ref }), h('div', { class: 'small muted', html: AP.inline(`${r ? r.license + ' · ' : ''}${o.note}`) })); }))),
      h('section', { class: 'rule prose' }, h('h2', { text: 'Synthesis' }), AP.blocks(h('div'), a.synthesis)),
      h('section', { class: 'rule' }, h('h2', { text: 'How the programs map to the weeks' }), h('div', { class: 'tablewrap' }, h('table', null, h('tbody', null, a.mapping.map((m) => h('tr', null, h('td', null, h('a', { href: `#/week/${m.week}`, text: m.week })), h('td', { class: 'small', text: m.programs.map((id) => (a.programs.find((p) => p.id === id) || {}).institution || id).join('; ') }), h('td', { class: 'small', html: AP.inline(m.how) }))))))),
      a.gaps ? h('section', { class: 'rule prose' }, h('h2', { text: 'Gaps' }), AP.blocks(h('div'), a.gaps)) : null);
    return { el, title: 'Research audit' };
  };
  V.glossary = async function (gid) {
    const cat = await AP.catalog();
    const q = { v: '' };
    const out = h('div');
    function draw() {
      AP.clear(out);
      for (const w of cat.weeks) {
        const terms = cat.glossary.filter((g) => g.week === w.id && (!q.v || `${g.term} ${g.definition}`.toLowerCase().includes(q.v)));
        if (!terms.length) continue;
        out.appendChild(h('section', { class: 'rule' }, h('span', { class: 'label', text: `Week ${w.number} · ${w.title}` }), h('dl', { class: 'kv' }, terms.flatMap((g) => [h('dt', { id: g.id, class: g.id === gid ? 'label--accent' : null, text: g.term }), h('dd', null, h('span', { html: AP.inline(g.definition) }), ' ', h('a', { class: 'small', href: `#/lesson/${g.lesson}`, text: 'Lesson' }))]))));
      }
    }
    draw();
    const view = { el: h('div', null, head('Library', 'Glossary', `${cat.glossary.length} terms across the semester.`), h('label', { class: 'field' }, h('span', { text: 'Search terms' }), h('input', { type: 'search', oninput: (e) => { q.v = e.target.value.toLowerCase(); draw(); } })), out), title: 'Glossary' };
    if (gid) setTimeout(() => document.getElementById(gid)?.scrollIntoView({ block: 'center' }), 50);
    return view;
  };

  /* ---------- Labs ---------- */
  V.labs = async function () {
    const cat = await AP.catalog();
    await AP.loadState(['lab', 'journal']);
    return { el: h('div', null, head('Labs', 'Interactive laboratories', 'Reusable tools with transparent rules. Outputs are teaching models built from the cited research — never predictions of real behavior.'),
      h('div', { class: 'grid grid--2' }, cat.labs.map((l) => {
        const done = l.exercises.filter((x) => AP.getRec('lab', x.id)?.finished).length;
        const meta = l.id === 'strategic-decision-journal' ? `${Object.keys(AP.state.journal || {}).length} entries` : `${l.exercises.length} exercises · ${done} completed`;
        return h('a', { class: 'panel', href: l.id === 'strategic-decision-journal' ? '#/journal' : `#/labs/${l.id}` }, h('span', { class: 'label', text: SCHOOL[l.school] }), h('h3', { text: l.name }), h('p', { class: 'muted small', text: l.summary }), h('span', { class: 'small', text: meta }));
      }))), title: 'Labs' };
  };
  V.lab = async function (id) {
    const cat = await AP.catalog();
    await AP.loadState(['lab']);
    const l = cat.labs.find((x) => x.id === id);
    if (!l) return h('p', { class: 'empty', text: 'Unknown lab.' });
    return { el: h('div', null, head(`Labs · ${SCHOOL[l.school]}`, l.name, l.description),
      h('ul', { class: 'items' }, l.exercises.map((x) => { const r = AP.getRec('lab', x.id); const w = cat.weeks.find((k) => k.id === x.week); return h('li', null, h('a', { href: `#/exercise/${x.id}` }, h('span', { class: 'label', text: w ? `Week ${w.number}` : 'Capstone' }), h('span', null, h('span', { class: 'items__t', text: x.title }), h('span', { class: 'items__d', text: `${x.engine} engine${r && r.summary ? ' · ' + r.summary.label : ''}` })), r ? h('span', { class: `tag ${r.finished ? 'tag--done' : 'tag--accent'}`, text: r.finished ? 'Completed' : 'In progress' }) : h('span'))); }))), title: l.name };
  };

  /* ---------- Assessments ---------- */
  V.assessments = async function () {
    const [cat, prog, att] = await Promise.all([AP.catalog(), AP.api('progress'), AP.api('attempts')]);
    const rows = cat.weeks.map((w) => { const p = prog.weeks.find((x) => x.id === w.id); return h('tr', null, h('td', null, h('a', { href: `#/week/${w.id}`, text: `${w.number}. ${w.title}` })), h('td', null, h('a', { href: `#/assess/${w.quiz.id}`, text: p.quiz ? `${AP.pct(p.quiz.auto)} auto${p.quiz.mastered ? ' · mastered' : ''}` : 'Not taken' })), h('td', null, h('a', { href: `#/assignment/${w.assignment.id}`, text: p.assignment ? (p.assignment.score != null ? `${AP.pct(p.assignment.score)} self-assessed` : 'Submitted') : 'Not submitted' }))); });
    const hist = h('tbody', null, att.attempts.slice().reverse().slice(0, 40).map((a) => h('tr', null, h('td', { text: AP.date(a.submitted) }), h('td', null, h('a', { href: `#/attempt/${a.id}`, text: a.assessment })), h('td', { text: a.kind }), h('td', { class: 'num', text: a.ratio != null ? AP.pct(a.ratio) : a.selfScore != null ? `${AP.pct(a.selfScore)} (self)` : '—' }), h('td', { class: 'small', text: a.pendingSelf ? 'Short responses await your self-assessment' : '' }))));
    return { el: h('div', null, head('Assessments', 'Quizzes, assignments, midterm and capstone', `Grading model: quizzes ${cat.semester.grading.quizzes}%, assignments ${cat.semester.grading.assignments}%, midterm ${cat.semester.grading.midterm}%, capstone ${cat.semester.grading.capstone}%. Mastery threshold 80% — below it you get focused review and a reassessment.`),
      h('div', { class: 'grid grid--3' },
        cat.diagnostic ? h('a', { class: 'panel', href: '#/diagnostic' }, h('span', { class: 'label', text: 'Week 1 · not graded' }), h('h3', { text: 'Baseline diagnostic' }), h('p', { class: 'small muted', text: prog.diagnostic ? `Taken ${AP.date(prog.diagnostic.submitted)}` : `${cat.diagnostic.count} questions` })) : null,
        cat.midterm ? h('a', { class: 'panel', href: '#/midterm' }, h('span', { class: 'label', text: `${cat.semester.grading.midterm}% of the grade` }), h('h3', { text: cat.midterm.title }), h('p', { class: 'small muted', text: `${cat.midterm.count} questions and a cumulative case` })) : null,
        cat.capstone ? h('a', { class: 'panel', href: '#/capstone' }, h('span', { class: 'label', text: `${cat.semester.grading.capstone}% of the grade` }), h('h3', { text: 'Capstone' }), h('p', { class: 'small muted', text: `${cat.capstone.components} components · ${cat.capstone.deliverables.length} deliverables` })) : null),
      h('section', { class: 'rule' }, h('h2', { text: 'Weekly work' }), h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Week' }), h('th', { text: 'Quiz (best)' }), h('th', { text: 'Assignment' }))), h('tbody', null, rows)))),
      h('section', { class: 'rule' }, h('h2', { text: 'History and feedback' }), att.attempts.length ? h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Date', 'Assessment', 'Kind', 'Score', ''].map((x) => h('th', { text: x })))), hist)) : h('p', { class: 'empty', text: 'No attempts yet.' }))), title: 'Assessments' };
  };

  /* ---------- Notebook ---------- */
  V.notebook = async function () {
    const cat = await AP.catalog();
    await AP.loadState(['note', 'bookmark', 'reflection', 'draft', 'journal']);
    const tabs = [['notes', 'Notes & highlights'], ['bookmarks', 'Bookmarks'], ['reflections', 'Reflections'], ['drafts', 'Drafts'], ['concepts', 'Saved concepts']];
    let tab = 'notes'; let q = '';
    const out = h('div');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Notebook sections' }, tabs.map(([k, l]) => h('button', { 'aria-pressed': String(k === tab), onclick: (e) => { tab = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); draw(); }, text: l })));
    const match = (s) => !q || String(s || '').toLowerCase().includes(q);
    function draw() {
      AP.clear(out);
      if (tab === 'notes' || tab === 'concepts') {
        const notes = Object.entries(AP.state.note || {}).filter(([, n]) => (tab === 'concepts' ? n.data.concept || /^g-|^c-/.test(n.data.target) : true) && match(`${n.data.text} ${n.data.quote}`)).sort((a, b) => b[1].updated - a[1].updated);
        if (!notes.length) out.appendChild(h('p', { class: 'empty', text: tab === 'concepts' ? 'Save a concept from a lesson (select text → “Save concept”) and it appears here.' : 'Select text in any lesson to highlight it or add a note.' }));
        for (const [id, n] of notes) out.appendChild(h('article', { class: 'res' }, h('div', { class: 'label', text: `${targetLabel(cat, n.data.target)} · ${AP.date(n.updated)}` }), n.data.quote ? h('blockquote', { class: 'quote', text: n.data.quote }) : null, n.data.concept ? h('div', { class: 'small', text: `Concept: ${cat.concepts[n.data.concept]?.name || n.data.concept}` }) : null, n.data.text ? h('p', { text: n.data.text }) : null,
          h('div', { class: 'row' }, findLesson(cat, n.data.target) ? h('a', { class: 'btn btn--small', href: `#/lesson/${n.data.target}`, text: 'Open lesson' }) : null, h('button', { class: 'btn btn--small btn--quiet', onclick: async () => { await AP.remove('note', id); draw(); }, text: 'Delete' }))));
      } else if (tab === 'bookmarks') {
        const b = Object.entries(AP.state.bookmark || {}).filter(([k, v]) => match(`${v.data.label} ${targetLabel(cat, k)}`));
        if (!b.length) out.appendChild(h('p', { class: 'empty', text: 'Bookmark lessons and library resources to collect them here.' }));
        out.appendChild(h('ul', { class: 'list' }, b.map(([k]) => h('li', null, h('a', { href: findLesson(cat, k) ? `#/lesson/${k}` : k.startsWith('R-') ? `#/library/${k}` : `#/week/${k}`, text: targetLabel(cat, k) })))));
      } else if (tab === 'reflections') {
        const r = cat.weeks.filter((w) => (AP.getRec('reflection', w.id)?.answers || []).some((t) => t && match(t)));
        if (!r.length) out.appendChild(h('p', { class: 'empty', text: 'Weekly reflections you write appear here.' }));
        for (const w of r) out.appendChild(h('article', { class: 'res' }, h('div', { class: 'label', text: `Week ${w.number} · ${w.title}` }), AP.getRec('reflection', w.id).answers.filter(Boolean).map((t) => h('p', { text: t })), h('a', { class: 'small', href: `#/week/${w.id}`, text: 'Edit' })));
      } else if (tab === 'drafts') {
        const d = Object.entries(AP.state.draft || {}).filter(([, v]) => match((v.data.sections || []).join(' ')));
        if (!d.length) out.appendChild(h('p', { class: 'empty', text: 'Assignment and capstone drafts save here automatically.' }));
        out.appendChild(h('ul', { class: 'list' }, d.map(([k, v]) => h('li', null, h('a', { href: k.startsWith('capstone-k') ? `#/capstone/${k.slice(9)}` : k.startsWith('capstone-') ? '#/capstone' : `#/assignment/${k}`, text: k }), h('span', { class: 'small muted', text: ` · ${v.data.words || 0} words · ${AP.date(v.updated)}` })))));
      }
    }
    draw();
    return { el: h('div', null, head('Notebook', 'Your research and learning notebook', 'Private to you. Highlights, notes, reflections, drafts and saved concepts — searchable and exportable from Settings.'),
      h('div', { class: 'row row--between' }, seg, h('a', { class: 'btn btn--small', href: '#/journal', text: 'Strategic Decision Journal' })),
      h('label', { class: 'field rule' }, h('span', { text: 'Search the notebook' }), h('input', { type: 'search', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } })), out), title: 'Notebook' };
  };

  /* ---------- Progress ---------- */
  V.progress = async function () {
    const [cat, p] = await Promise.all([AP.catalog(), AP.api('progress')]);
    const tr = p.transcript;
    const trans = h('table', { class: 'transcript' }, h('thead', null, h('tr', null, ['Component', 'Weight', 'Completed', 'Score', 'Basis'].map((x) => h('th', { text: x })))), h('tbody', null, tr.components.map((c) => h('tr', null, h('td', { text: c.label }), h('td', { class: 'num', text: `${c.weight}%` }), h('td', { class: 'num', text: `${c.completed} of ${c.of}` }), h('td', { class: 'num', text: AP.pct(c.score) }), h('td', { class: 'small muted', text: c.basis })))));
    const conceptsT = h('table', null, h('thead', null, h('tr', null, ['Concept', 'Domain', 'Items', 'Accuracy', 'Review box', 'Status'].map((x) => h('th', { text: x })))), h('tbody', null, p.concepts.list.map((c) => h('tr', null, h('td', { text: c.name }), h('td', { class: 'small', text: c.domain }), h('td', { class: 'num', text: String(c.n) }), h('td', { class: 'num', text: AP.pct(c.accuracy) }), h('td', { class: 'num', text: c.minBox ?? '—' }), h('td', null, h('span', { class: `tag ${c.status === 'mastered' ? 'tag--done' : c.status === 'review' ? 'tag--accent' : ''}`, text: c.status }))))));
    const doms = h('table', null, h('thead', null, h('tr', null, ['Domain', 'Diagnostic', 'Course items', 'Accuracy'].map((x) => h('th', { text: x })))), h('tbody', null, p.domains.map((d) => h('tr', null, h('td', { text: d.label }), h('td', { class: 'num', text: d.diagnostic != null ? `${AP.pct(d.diagnostic)} (${d.diagnosticN})` : '—' }), h('td', { class: 'num', text: String(d.n) }), h('td', { class: 'num', text: AP.pct(d.accuracy) })))));
    const cal = p.calibration;
    const el = h('div', null, head('Progress', 'Transcript, mastery and learning profile', null),
      h('section', null, h('h2', { text: 'Academic record' }), h('p', { class: 'small muted', text: tr.note }), h('p', null, h('span', { class: 'scorebig num', text: AP.pct(tr.standing) }), h('span', { class: 'muted', text: tr.standing != null ? `  current standing over ${tr.completedWeight}% of the weight completed` : '  no graded components yet' })), h('div', { class: 'tablewrap' }, trans)),
      h('section', { class: 'rule' }, h('h2', { text: 'Learning profile' }), h('p', { class: 'small muted', text: p.insightNote }), p.insights.length ? p.insights.map((i) => h('div', { class: 'insight' }, h('p', { text: i.text }), h('small', { text: `${i.kind} · rule: ${i.rule}` }))) : h('p', { class: 'empty', text: 'No insights yet — each one needs enough of your responses to meet its evidence threshold.' })),
      h('section', { class: 'rule' }, h('h2', { text: 'Domains' }), h('div', { class: 'tablewrap' }, doms)),
      h('div', { class: 'grid grid--2 rule' },
        h('section', null, h('h3', { text: 'Calibration' }), h('dl', { class: 'kv small' },
          h('dt', { text: 'Quiz confidence' }), h('dd', { text: cal.quiz ? `${cal.quiz.n} rated answers · confidence ${AP.pct(cal.quiz.meanConfidence)} vs accuracy ${AP.pct(cal.quiz.accuracy)} · Brier ${cal.quiz.brier.toFixed(3)}` : 'Rate your confidence on quiz items to build this.' }),
          h('dt', { text: 'Judgment Lab' }), h('dd', { text: cal.lab.length ? cal.lab.map((x) => x.label).join(' · ') : 'Not completed yet.' }),
          h('dt', { text: 'Decision journal' }), h('dd', { text: cal.journal ? `${cal.journal.n} resolved forecasts · Brier ${cal.journal.brier.toFixed(3)} (0 is perfect, 0.25 is a coin flip)` : 'Resolve forecasts in the journal to build this.' }))),
        h('section', null, h('h3', { text: 'Retention' }), h('dl', { class: 'kv small' }, h('dt', { text: 'Cards activated' }), h('dd', { class: 'num', text: String(p.retention.activated) }), h('dt', { text: 'Due now' }), h('dd', { class: 'num', text: String(p.retention.due) }), h('dt', { text: 'Retained (box 4+)' }), h('dd', { class: 'num', text: String(p.retention.retained) }), h('dt', { text: 'Recall, last 30 days' }), h('dd', { class: 'num', text: p.retention.recall30 != null ? `${AP.pct(p.retention.recall30)} of ${p.retention.reviews30} reviews` : '—' })),
          boxChart(p.retention.boxes), h('p', { class: 'small muted', text: p.retention.rules }), h('a', { class: 'btn btn--small', href: '#/review', text: 'Review now' }))),
      h('section', { class: 'rule' }, h('h2', { text: 'Concepts' }), h('p', { class: 'muted', text: `${p.concepts.introduced} introduced · ${p.concepts.mastered} mastered · ${p.concepts.review} need review. Mastered = 3+ items at 80%+ and every review card in box 4 or higher.` }), p.concepts.list.length ? h('div', { class: 'tablewrap' }, conceptsT) : h('p', { class: 'empty', text: 'Concepts appear as you complete lessons and assessments.' })),
      h('div', { class: 'grid grid--2 rule' },
        h('section', null, h('h3', { text: 'Common errors' }), p.errors.length ? h('ul', { class: 'list small' }, p.errors.map((e) => h('li', { text: `${e.tag.replace(/-/g, ' ')} — ${e.count} time${e.count > 1 ? 's' : ''}` }))) : h('p', { class: 'empty', text: 'None recorded yet.' })),
        h('section', null, h('h3', { text: 'Cross-disciplinary connections' }), p.connections.length ? h('ul', { class: 'list small' }, p.connections.map((c) => h('li', { text: `${c.name} — ${c.weeks.join(', ')}` }))) : h('p', { class: 'empty', text: 'Concepts you meet in more than one week will appear here.' }))),
      h('p', { class: 'small muted rule', text: `Time on lessons and lectures: ${Math.round(p.time.seconds / 60)} minutes.${p.lectures && p.lectures.available ? ` Lectures: ${p.lectures.completed} watched to the end, ${p.lectures.started} started, of ${p.lectures.available}.` : ''}` }));
    return { el, title: 'Progress' };
  };
  function boxChart(boxes) {
    const max = Math.max(1, ...boxes.map((b) => b.count));
    const W = 300, H = 90, bw = W / boxes.length;
    const svg = h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + 18}`, role: 'img', 'aria-label': `Review cards by box: ${boxes.map((b) => `box ${b.box} ${b.count}`).join(', ')}` });
    boxes.forEach((b, i) => {
      const bh = (b.count / max) * H;
      svg.appendChild(h('rect', { x: i * bw + 6, y: H - bh, width: bw - 12, height: Math.max(bh, 1), fill: 'currentColor', opacity: '0.75' }));
      svg.appendChild(h('text', { x: i * bw + bw / 2, y: H + 13, 'text-anchor': 'middle', text: `${b.box}·${b.count}` }));
    });
    return svg;
  }

  /* ---------- Settings ---------- */
  V.settings = async function () {
    await AP.loadState(['settings', 'profile']);
    const s = { ...AP.DEFAULT_SETTINGS, ...(AP.getRec('settings', 'main') || {}) };
    const prof = { name: '', role: '', background: '', goals: '', priorities: [], interests: '', ...(AP.getRec('profile', 'main') || {}) };
    const save = () => { AP.applySettings(s); AP.save('settings', 'main', s); };
    const seg = (key, vals) => { const g = h('div', { class: 'seg', role: 'group' }); vals.forEach(([v, l]) => g.appendChild(h('button', { 'aria-pressed': String(s[key] === v), onclick: (e) => { s[key] = v; g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); save(); }, text: l }))); return g; };
    const range = (key, min, max, step, fmt) => { const out = h('span', { class: 'small muted', text: fmt(s[key]) }); return h('div', { class: 'row' }, h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': key, oninput: (e) => { s[key] = Number(e.target.value); out.textContent = fmt(s[key]); save(); } }), out); };
    const check = (key, label) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; save(); } }), h('span', { text: label }));
    const pf = (key, label, tall) => h('label', { class: 'field' }, h('span', { text: label }), h(tall ? 'textarea' : 'input', { type: 'text', value: prof[key], oninput: (e) => { prof[key] = e.target.value; AP.save('profile', 'main', prof); } }));
    const PRIOR = ['Executive communication', 'Organizational influence', 'Managing through others', 'Change management', 'Strategic restraint and prioritization', 'Negotiation and advocacy', 'Financial and commercial judgment', 'Legal and institutional literacy', 'Research skepticism', 'Executive presence and judgment'];
    const days = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
    const el = h('div', null, head('Settings', 'Study preferences and privacy', null),
      h('section', null, h('h2', { text: 'Academic difficulty' }), seg('mode', [['foundation', 'Foundation'], ['graduate', 'Graduate (default)'], ['executive', 'Executive']]),
        h('ul', { class: 'small muted' }, h('li', { text: 'Foundation — prerequisite support opens by default; guided examples first.' }), h('li', { text: 'Graduate — theoretical depth, methodological notes and academic readings open by default.' }), h('li', { text: 'Executive — every lesson opens with its executive brief, and the ambiguous “executive twist” scenarios open by default.' })),
        check('adaptFromDiagnostic', 'Use my diagnostic: in weeks tied to a domain I scored under 50%, open prerequisite support by default (material is never skipped).')),
      h('section', { class: 'rule' }, h('h2', { text: 'Reading and accessibility' }),
        h('div', { class: 'field' }, h('span', { text: 'Text size' }), range('textSize', 0.85, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`)),
        h('div', { class: 'field' }, h('span', { text: 'Line spacing' }), range('lineHeight', 1.4, 2.1, 0.05, (v) => v.toFixed(2))),
        h('div', { class: 'field' }, h('span', { text: 'Theme' }), seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
        check('serifBody', 'Serif reading text (turn off for a sans-serif body)'), check('reducedMotion', 'Reduce motion')),
      h('section', { class: 'rule' }, h('h2', { text: 'Study plan and reminders' }),
        h('div', { class: 'field' }, h('span', { text: 'Weekly hours' }), range('weeklyHours', 3, 12, 0.5, (v) => `${v} hours`)),
        h('fieldset', null, h('legend', { class: 'label', text: 'Study days' }), h('div', { class: 'row' }, days.map(([v, l]) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: s.studyDays.includes(v), onchange: (e) => { s.studyDays = e.target.checked ? [...new Set([...s.studyDays, v])] : s.studyDays.filter((x) => x !== v); save(); } }), h('span', { text: l }))))),
        h('div', { class: 'field' }, h('span', { text: 'Notifications' }), seg('reminders', [['in-app', 'In-app only'], ['off', 'Off']]), h('small', { text: 'APERTURE shows due reviews and the next suggested activity when you open it. It sends no email or push notifications in this beta.' }))),
      h('section', { class: 'rule' }, h('h2', { text: 'Learner profile' }), h('p', { class: 'small muted', text: 'Private, stored only in your APERTURE account, never in course content and never sent anywhere. Used to remind you of your own goals; it does not change grading.' }),
        h('div', { class: 'grid grid--2' }, pf('name', 'Name'), pf('role', 'Current role')), pf('background', 'Background', true), pf('goals', 'Goals for this semester', true), pf('interests', 'Research interests', true),
        h('fieldset', null, h('legend', { class: 'label', text: 'Development priorities (self-selected, not a diagnosis)' }), h('div', { class: 'grid grid--2' }, PRIOR.map((p) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: prof.priorities.includes(p), onchange: (e) => { prof.priorities = e.target.checked ? [...new Set([...prof.priorities, p])] : prof.priorities.filter((x) => x !== p); AP.save('profile', 'main', prof); } }), h('span', { text: p })))))),
      h('section', { class: 'rule' }, h('h2', { text: 'AI assistance' }), check('chatgptLink', 'Show the “Open ChatGPT” link beside “Copy prompt”.'),
        h('p', { class: 'small muted', text: 'APERTURE has no AI provider and sends nothing to one. “Continue in ChatGPT” builds a prompt from public course material; your notes, drafts and results are included only if you add them yourself. Copying or opening ChatGPT is always your action.' })),
      h('section', { class: 'rule' }, h('h2', { text: 'Your data' }),
        h('p', { class: 'small muted', text: AP.local() ? 'Public beta: everything you do — reading progress, notes and highlights, bookmarks, reflections, drafts, journal entries, lab runs, assessment results, your review schedule, settings and profile — is stored only in this browser on this device. Nothing is sent to a server. Clearing site data, using private browsing, or switching browser or device starts you from scratch, so export a backup regularly. No account, analytics or third-party scripts.' : 'Stored in APERTURE’s private Cloudflare D1 database under your signed-in address: reading progress, notes and highlights, bookmarks, reflections, drafts, journal entries, lab runs, assessment attempts, your review schedule and settings. No analytics, no third-party scripts, no advertising.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: exportJSON, text: 'Export everything (JSON)' }), h('button', { class: 'btn', onclick: exportMarkdown, text: 'Export notebook (Markdown)' }), AP.local() ? importButton() : null),
        h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Privacy' }), h('b', { text: 'Delete all my APERTURE data' })), h('div', { class: 'fold__body' }, h('p', { class: 'small', text: (AP.local() ? 'This permanently deletes every APERTURE record stored in this browser.' : 'This permanently deletes every record listed above from APERTURE’s database.') + ' Export first if you want a copy. Type DELETE MY APERTURE DATA to confirm.' }), deleteForm()))));
    return { el, title: 'Settings' };
  };
  function importButton() {
    const inp = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr', onchange: async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || data.app !== 'APERTURE') throw new Error('This is not an APERTURE export.');
        const r = await AP.api('import', { method: 'POST', body: data });
        AP.state = {}; AP.toast(`Imported ${r.added} records${r.skipped ? ` (${r.skipped} skipped as invalid)` : ''}.`); location.hash = '#/';
      } catch (err) { AP.toast(err.message || 'Import failed.'); }
      e.target.value = '';
    } });
    return h('label', { class: 'btn' }, 'Import a backup (JSON)', inp);
  }
  function deleteForm() {
    const inp = h('input', { type: 'text', 'aria-label': 'Confirmation phrase' });
    return h('div', null, inp, h('p', null, h('button', { class: 'btn', onclick: async () => {
      if (inp.value !== 'DELETE MY APERTURE DATA') return AP.toast('Type the phrase exactly to confirm.');
      await AP.api('delete-all', { method: 'POST', body: { confirm: inp.value } });
      AP.state = {}; AP.cache = { libIndex: AP.cache.libIndex }; AP.toast('All APERTURE data deleted.'); location.hash = '#/';
    }, text: 'Delete permanently' })));
  }
  function download(name, text, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function exportJSON() { const d = await AP.api('export'); download(`aperture-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2), 'application/json'); }
  async function exportMarkdown() {
    const [cat, d] = await Promise.all([AP.catalog(), AP.api('export')]);
    let md = `# APERTURE notebook\n\nExported ${new Date().toISOString()}\n\n`;
    const by = (k) => d.state.filter((s) => s.kind === k);
    md += '## Notes and highlights\n\n' + by('note').map((n) => `- **${targetLabel(cat, n.data.target)}**${n.data.quote ? ` — “${n.data.quote}”` : ''}${n.data.text ? `\n  ${n.data.text}` : ''}`).join('\n') + '\n\n';
    md += '## Reflections\n\n' + by('reflection').map((r) => `### ${r.key}\n\n${r.data.answers.filter(Boolean).join('\n\n')}`).join('\n\n') + '\n\n';
    md += '## Decision journal\n\n' + by('journal').map((j) => `### ${j.data.title || 'Untitled'} (${j.data.date})\n\n**Decision:** ${j.data.choice}\n\n**Rationale:** ${j.data.rationale}\n\n**Assumptions:** ${j.data.assumptions}\n\n**Forecasts:**\n${(j.data.forecasts || []).map((f) => `- ${f.text} — ${Math.round(f.p * 100)}%${f.outcome == null ? '' : f.outcome ? ' (happened)' : ' (did not happen)'}`).join('\n')}\n\n**Outcome:** ${j.data.outcome}\n\n**Lessons:** ${j.data.lessons}`).join('\n\n') + '\n\n';
    md += '## Drafts\n\n' + by('draft').map((x) => `### ${x.key}\n\n${(x.data.sections || []).join('\n\n')}`).join('\n\n') + '\n';
    download(`aperture-notebook-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown');
  }
})();
