// APERTURE — Semester syllabus PDF.
//   node aperture/tools/compile.mjs      (writes apps/aperture/data/syllabus.json from the curriculum)
//   node aperture/tools/syllabus.mjs     (renders it → apps/aperture/syllabus/APERTURE-Semester-I-Syllabus.pdf)
// The PDF is drawn from exactly the same syllabus.json as the in-app Syllabus page. stamp.json records the
// syllabus hash it was drawn from; `compile.mjs --check` (run by the deploy workflow) fails if they differ.
// Needs Playwright's Chromium (pre-installed in Claude Code cloud sessions); pdftotext (poppler) is used, when
// present, to put real page numbers in the table of contents.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'apps', 'aperture');
const OUTDIR = join(APP, 'syllabus');
export const PDF_NAME = 'APERTURE-Semester-I-Syllabus.pdf';
const S = JSON.parse(readFileSync(join(APP, 'data', 'syllabus.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
const pct = (x) => `${Math.round(x * 100)}%`;
const authors = (a) => (a.length > 3 ? `${a[0]} et al.` : a.length > 1 ? `${a.slice(0, -1).join(', ')} & ${a.at(-1)}` : a[0] || '');
const shortAuthors = (a) => { const last = (n) => n.split(' ').at(-1); return a.length > 2 ? `${last(a[0])} et al.` : a.map(last).join(' & '); };
const R = new Map(S.readingList.map((r) => [r.id, r]));
const font = (f) => pathToFileURL(join(APP, 'fonts', f)).href;
const mark = readFileSync(join(APP, 'mark.svg'), 'utf8');
const hrs = (h) => (Math.round(h * 10) / 10).toFixed(1).replace(/\.0$/, '');
const issued = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const SECTIONS = [
  ['overview', '1', 'Course Overview'], ['structure', '2', 'Academic Structure'], ['schedule', '3', 'Weekly Schedule'],
  ['readings', '4', 'Reading List'], ['grading', '5', 'Assessments & Grading'], ['lectures', '6', 'Lecture Format'],
  ['capstone', '7', 'Capstone Project'], ['resources', '8', 'Learning Resources'], ['integrity', '9', 'Academic Integrity & Source Standards'],
  ['outcomes', '10', 'Learning Outcomes'], ['notes', 'A', 'Appendix: Not Specified in the Curriculum'],
];
const H = (id) => { const [, n, t] = SECTIONS.find((x) => x[0] === id); return `<h2 id="${id}"><span class="num">${n}</span>${esc(t)}</h2>`; };

function html(pages = {}) {
  const sem = S.semester;
  const w = S.weeks;
  const lessonsAll = w.flatMap((x) => x.lessons);
  const ref = (r) => { const x = R.get(r.ref); return x ? `<a href="${esc(x.url)}">${esc(shortAuthors(x.authors))} (${x.year})</a>${x.open ? '<sup class="oa-mark">◦</sup>' : ''}` : esc(r.ref); };

  const title = `<section class="cover">
    <div class="cover-top"><div class="mark">${mark}</div><div class="eyebrow">The Applied Intelligence Academy</div></div>
    <div class="cover-mid">
      <div class="word">APERTURE</div>
      <p class="kicker">${esc(sem.title)} · Syllabus</p>
      <h1>${md(sem.name)}</h1>
      <p class="sub">${sem.weeks} weeks · ${esc(sem.hoursPerWeek)} hours a week · ${S.stats.lessons} lessons · ${sem.schools.length} schools</p>
    </div>
    <div class="cover-foot">
      <p>${sem.schools.map((s) => esc(s.name)).join('<br>')}</p>
      <p class="small">Issued ${esc(issued)}. Generated from the deployed APERTURE curriculum (syllabus ${esc(S.hash)}).<br>${esc(S.disclaimer)}</p>
    </div>
  </section>`;

  const toc = `<section class="toc"><h2 class="plain">Contents</h2><ol>${SECTIONS.map(([id, n, t]) => `<li><a href="#${id}"><span class="n">${n}</span><span class="t">${esc(t)}</span><span class="dots"></span><span class="p">${pages[id] || ''}</span></a></li>`).join('')}</ol>
    <div class="glance"><h3>At a glance</h3><dl>
      <dt>Program</dt><dd>${esc(S.program)}</dd>
      <dt>Format</dt><dd>Self-paced, online; written lessons or narrated lectures, labs, cases, readings</dd>
      <dt>Workload</dt><dd>${esc(sem.hoursPerWeek)} hours a week; ${hrs(sem.plannedHours)} planned hours in all</dd>
      <dt>Assessment</dt><dd>${S.grading.weights.map((g) => `${esc(g.label)} ${g.weight}%`).join(' · ')}</dd>
      <dt>Mastery</dt><dd>${pct(S.grading.mastery)} on quizzes and the midterm, with focused review and reassessment below it</dd>
      <dt>Narrated lectures</dt><dd>${S.lectures.available} released (Week 1 and Week 2, Lesson 1); ${S.lectures.soon} coming soon</dd>
      <dt>Access</dt><dd>cperez.app/apps/aperture · Syllabus page: Curriculum → Syllabus</dd>
    </dl></div></section>`;

  const overview = `<section class="major">${H('overview')}
    <p class="lede">${md(S.description[0])}</p><p>${md(S.description[1])}</p>
    <h3>Educational philosophy</h3><div class="pairs">${S.philosophy.map((p) => `<div><h4>${esc(p.title)}</h4><p>${md(p.text)}</p></div>`).join('')}</div>
    <h3>Course objectives</h3><p class="note">Each week’s own objectives (${S.objectives.reduce((a, o) => a + o.objectives.length, 0)} in all) appear in the app’s Syllabus page and on each week page. Across the semester they build toward nine objectives:</p>
    <ol class="cols tight">${S.outcomes.map((o) => `<li><b>${esc(o.title)}</b> <span class="muted">Wk ${o.weeks.join(', ')}</span></li>`).join('')}</ol>
    <h3>Expected outcomes</h3><p>By the end of the semester you will have produced a working decision journal, fourteen pieces of applied professional work and a full executive capstone, and you will have a measured record of your calibration, mastery and progress. Section 10 lists the competencies the course is designed to build.</p>
  </section>`;

  const structure = `<section>${H('structure')}
    <h3>The fourteen-week semester</h3>
    <p>Each week is planned at ${esc(sem.hoursPerWeek)} hours: about 3 hours of lessons (or lectures — watching replaces reading the same lesson), 1 hour of reading, and the lab, case, quiz, assignment and reflection. Optional readings are not counted.</p>
    <table class="grid compact"><thead><tr><th>Wk</th><th>Theme</th><th>School</th><th class="r">Lessons</th><th class="r">Hours</th></tr></thead><tbody>
    ${w.map((x) => `<tr><td>${x.number}</td><td><b>${md(x.title)}</b>${x.midterm ? ' <span class="tag">Midterm</span>' : ''}${x.number === 14 ? ' <span class="tag">Capstone</span>' : ''}</td><td>${esc(sem.schools.find((s) => s.id === x.school)?.name.replace('School of ', ''))}</td><td class="r">${x.lessons.length}</td><td class="r">${hrs(x.totalHours)}</td></tr>`).join('')}
    <tr class="total"><td></td><td>Semester</td><td></td><td class="r">${lessonsAll.length}</td><td class="r">${hrs(sem.plannedHours)}</td></tr></tbody></table>
    <p>${sem.schools.map((s) => `The <b>${esc(s.name)}</b> leads Weeks ${s.weeks.join(', ')}`).join('; ')}. The schools are interleaved, and every week draws on the others.</p>
    <h3>Instructional formats</h3><div class="pairs">${S.formats.map((f) => `<div><h4>${esc(f.title)}</h4><p>${md(f.text)}</p></div>`).join('')}</div>
  </section>`;

  const weekBlock = (x) => `<article class="week">
    <header><span class="wk">Week ${x.number}</span><h3>${md(x.title)}</h3><span class="hrs">${hrs(x.totalHours)} h</span></header>
    <p class="theme">${md(x.theme)}</p><p class="q">${md(x.question)}</p>
    <table class="lessons"><tbody>${x.lessons.map((l) => `<tr><td class="ln">${l.number}</td><td>${md(l.title)}</td><td class="r">${l.minutes} min</td><td class="lec">${l.lecture?.status === 'available' ? `<span class="on">▶ Lecture ${l.lecture.minutes} min</span>` : l.lecture?.status === 'soon' ? '<span class="soon">Lecture coming soon</span>' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="kv"><b>Key concepts</b> ${x.concepts.map(md).join(' · ')}</p>
    <p class="kv"><b>Readings</b> ${x.readings.required.map(ref).join('; ')}${x.readings.optional.length ? ` <span class="muted">· Recommended:</span> ${x.readings.optional.map(ref).join('; ')}` : ''}</p>
    <div class="work">
      <div><b>Lab</b> ${md(x.exercise.title)} <span>${esc(x.exercise.labName)} · ${x.exercise.minutes} min</span></div>
      <div><b>Case</b> ${md(x.case.title)} <span>${x.case.minutes} min</span></div>
      <div><b>Quiz</b> ${x.quiz.count} questions <span>${x.quiz.minutes} min · mastery ${pct(x.quiz.mastery)}</span></div>
      <div><b>Assignment</b> ${md(x.assignment.title)} <span>${x.assignment.minutes} min${x.assignment.words ? ` · ${x.assignment.words[0]}–${x.assignment.words[1]} words` : ''}</span></div>
    </div>
    ${x.midterm && S.midterm ? `<p class="flag"><b>Midterm</b> — ${md(S.midterm.title)}, covering Weeks ${S.midterm.covers[0]}–${S.midterm.covers.at(-1)} (${S.midterm.minutes} min), taken after this week.</p>` : ''}
    ${x.capstone ? `<p class="flag"><b>Capstone milestone</b> — ${md(x.capstone)}</p>` : ''}
  </article>`;
  const schedule = `<section class="major">${H('schedule')}<p class="note">Lesson titles, concepts, readings, labs, cases, quizzes and assignments for every week, exactly as deployed. Readings are cited by author and year (full entries in Section 4); ◦ marks open access. Week 1 also opens with the ungraded baseline diagnostic.</p>${w.map(weekBlock).join('')}</section>`;

  const entry = (r) => `<li><span class="au">${esc(authors(r.authors))}</span> (${r.year}). <a href="${esc(r.url)}">${md(r.title)}</a>. <span class="acc ${r.open ? 'is-open' : ''}">${esc(r.accessLabel)}</span> <span class="wks">Wk ${r.weeks.join(', ')}</span></li>`;
  const readings = `<section class="major">${H('readings')}
    <p>${S.readingTotals.required} required and ${S.readingTotals.optional} recommended readings, drawn from a library of ${S.readingTotals.library} sources. <b>${S.readingTotals.open}</b> are open access or free with registration; <b>${S.readingTotals.restricted}</b> are restricted (paywalled, library access or purchase) — use a library, an author copy where the library notes one, or the APERTURE summary. Every title links to its publisher, DOI or official page.</p>
    <h3>Required</h3><ol class="refs">${S.readingList.filter((r) => r.required).map(entry).join('')}</ol>
    <h3>Recommended</h3><ol class="refs">${S.readingList.filter((r) => !r.required).map(entry).join('')}</ol>
  </section>`;

  const g = S.grading;
  const grading = `<section class="major">${H('grading')}
    <table class="grid weights"><thead><tr><th>Component</th><th class="r">Weight</th><th>How it is scored in V1</th></tr></thead><tbody>${g.weights.map((x) => `<tr><td><b>${esc(x.label)}</b></td><td class="r big">${x.weight}%</td><td>${md(x.basis)}</td></tr>`).join('')}</tbody></table>
    <p><b>Mastery.</b> Mastery is ${pct(g.mastery)} of the auto-graded points on each weekly quiz and on the midterm. Below it, APERTURE lists the lessons and concepts behind your misses and offers a reassessment drawn from reserve questions plus the items you missed. <b>Standing.</b> ${md(g.standing)}</p>
    <div class="pairs">
      <div><h4>Weekly quizzes</h4><p>${S.weeks.length} quizzes, ${S.stats.quizQuestions} questions in all (${S.stats.reserveQuestions} more in reserve for reassessment), in nine formats including scenarios, ranking, numeric estimates and short answers.</p></div>
      <div><h4>Applied assignments</h4><p>One a week, written as professional work — from a decision-journal template in Week 1 to a 90-day roadmap in Week 12 — with a template, a weighted rubric and format checks.</p></div>
      ${S.midterm ? `<div><h4>Midterm</h4><p>${md(S.midterm.title)}. An original cumulative case, <i>${md(S.midterm.caseTitle)}</i>, then ${S.midterm.count} questions (${S.midterm.reserve} in reserve); about ${Math.round(S.midterm.minutes / 60)} hours; covers Weeks ${S.midterm.covers[0]}–${S.midterm.covers.at(-1)}.</p></div>` : ''}
      ${S.capstone ? `<div><h4>Executive capstone</h4><p>${S.capstone.deliverables.length} deliverables built from ${S.capstone.components.length} components over Weeks 8–14 (Section 7).</p></div>` : ''}
    </div>
    <h3>Scoring rules</h3><ul class="tight">${g.scoring.map((x) => `<li>${md(x)}</li>`).join('')}</ul>
    <h3>Formative work (not graded)</h3><p>${g.ungraded.join(' · ')}. ${S.diagnostic ? `The ${esc(S.diagnostic.title.toLowerCase())} (${S.diagnostic.count} questions, ${S.diagnostic.minutes} min) sets your starting point and can adapt the course’s suggestions.` : ''}</p>
    <p class="note">Each assignment’s weighted rubric is shown with the assignment and in the in-app Syllabus page.</p>
  </section>`;

  const lec = lessonsAll.filter((l) => l.lecture?.status === 'available');
  const lectures = `<section>${H('lectures')}
    <p>Every lesson can be learned two ways. <b>Watch Lecture</b> is a narrated, interactive version (Watch & Learn): one narration track drives synchronized visuals, captions and a transcript, and pauses at interactive checkpoints — predict a number, decide a case, explore a model, or reflect. <b>Read Lesson</b> is the full written lesson. Both cover the same objectives and sources and lead to the same comprehension check; finishing either completes the lesson.</p>
    <div class="pairs">
      <div><h4>Player</h4><p>Play, pause and ±10-second skips; speed from 0.75× to 2×; chapters; captions; a synchronized transcript (click any line to jump); audio-only mode for listening on the move; downloadable transcript and captions; keyboard shortcuts; works on desktop and phone.</p></div>
      <div><h4>Progress</h4><p>Position, furthest point, checkpoint answers and time are saved; the lecture resumes where you stopped and the dashboard offers “Resume lecture”. Checkpoints are formative and never graded.</p></div>
    </div>
    <h3>Release status</h3><p>The first ${lec.length} narrated lectures are released now, in Voice C, the official APERTURE narration voice. The remaining ${S.lectures.soon} are scripted and will be released in order; until then their lessons show “Narrated Lecture — Coming Soon” and open in the written view. Only the narrated version is pending — every lesson is complete and available.</p>
    <table class="grid small"><thead><tr><th>Lesson</th><th>Title</th><th class="r">Lecture</th><th class="r">Checkpoints</th></tr></thead><tbody>${lec.map((l) => `<tr><td>${esc(l.id.replace('w0', 'W').replace('-l', '·L'))}</td><td>${md(l.title)}</td><td class="r">${l.lecture.minutes} min</td><td class="r">${l.lecture.checkpoints}</td></tr>`).join('')}</tbody></table>
  </section>`;

  const c = S.capstone;
  const capstone = c ? `<section class="major">${H('capstone')}
    <p class="lede">${md(c.title)}</p>
    <p>${md(c.organization.context)}</p><p class="note">${md(c.fiction)}</p>
    <p>You lead a new department and must design, fund and launch it. The capstone runs from Week 8 to Week 14: ${c.components.length} components, each drafted in the week that teaches its tools, are assembled into ${c.deliverables.length} deliverables and defended against ${c.defense} hard questions. You work from ${c.exhibits} exhibits with three tools: ${c.tools.join('; ')}.</p>
    <h3>Deliverables and evaluation criteria</h3>
    <table class="grid small"><thead><tr><th>Deliverable</th><th class="r">Length</th><th>Rubric criteria (weight)</th></tr></thead><tbody>${c.deliverables.map((d) => `<tr><td><b>${md(d.title)}</b></td><td class="r">${d.words[0].toLocaleString('en-US')}–${d.words[1].toLocaleString('en-US')} words</td><td>${d.rubric.map((r) => `${md(r.criterion)} (${r.weight})`).join('; ')}</td></tr>`).join('')}</tbody></table>
    <p class="note">Each deliverable is self-assessed against its four-level rubric; the capstone’s ${S.grading.weights.find((x) => x.id === 'capstone').weight}% is the average of the deliverables assessed.</p>
    <h3>Milestones</h3><table class="grid small"><tbody>${c.milestones.map((m) => `<tr><td class="nowrap">Week ${m.week}</td><td>${md(m.text)}</td></tr>`).join('')}</tbody></table>
  </section>` : '';

  const resources = `<section>${H('resources')}<div class="pairs">${S.resources.map((r) => `<div><h4>${esc(r.title)}</h4><p>${md(r.text)}</p></div>`).join('')}</div>
    <h3>Labs</h3><ul class="tight">${S.labs.map((l) => `<li><b>${esc(l.name)}</b> — ${md(l.summary)}</li>`).join('')}</ul></section>`;

  const integrity = `<section class="major">${H('integrity')}
    <p>APERTURE separates what research shows from what APERTURE says. Every prose passage in the lessons carries one of six labels, shown beside it and counted in each lesson’s source panel.</p>
    <table class="grid small"><thead><tr><th>Label</th><th>Meaning</th><th class="r">Passages</th></tr></thead><tbody>${S.integrity.kinds.map((k) => `<tr><td class="nowrap"><b>${esc(k.label)}</b></td><td>${md(k.text)}</td><td class="r">${k.count}</td></tr>`).join('')}</tbody></table>
    <h3>AI-assisted materials</h3><ul>${S.integrity.ai.map((x) => `<li>${md(x)}</li>`).join('')}</ul>
    <h3>Fiction and legal material</h3><p>${md(S.integrity.fiction)}</p>
    <h3>Your own work</h3><p>Self-assessment only works if it is honest: rate your work against the rubric as a demanding reviewer would, and keep the Decision Journal contemporaneous. Cite the sources you use in assignments the way the lessons do.</p>
  </section>`;

  const outcomes = `<section>${H('outcomes')}<p>By the end of Semester I you should be able to:</p>
    <ol class="outcomes">${S.outcomes.map((o) => `<li><b>${esc(o.title)}.</b> ${md(o.text)} <span class="muted">Weeks ${o.weeks.join(', ')}.</span></li>`).join('')}</ol></section>`;

  const notes = `<section>${H('notes')}<p>The following are not defined in the deployed curriculum. They are listed rather than invented.</p>
    <dl class="gaps">${S.gaps.map((x) => `<dt>${esc(x.topic)}</dt><dd>${md(x.detail)}</dd>`).join('')}</dl>
</section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>APERTURE — ${esc(sem.title)} Syllabus</title><style>${CSS}</style></head>
  <body>${title}${toc}${overview}${structure}${schedule}${readings}${grading}${lectures}${capstone}${resources}${integrity}${outcomes}${notes}</body></html>`;
}

const CSS = `
@font-face { font-family: 'Newsreader'; src: url('${font('newsreader-latin-opsz-normal.woff2')}') format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Newsreader'; src: url('${font('newsreader-latin-opsz-italic.woff2')}') format('woff2'); font-weight: 200 800; font-style: italic; }
@font-face { font-family: 'Inter'; src: url('${font('inter-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'JetBrains Mono'; src: url('${font('jetbrains-mono-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 800; }
:root { --cream: #F2EBDD; --paper: #F7F2E8; --ink: #252525; --muted: #5B524A; --ox: #581B20; --line: rgba(37,37,37,.18); }
@page { size: letter; margin: 0.6in 0.7in 0.7in; background: #F7F2E8;
  @bottom-left { content: "APERTURE · Semester I Syllabus"; font: 500 7pt 'JetBrains Mono', monospace; letter-spacing: .12em; text-transform: uppercase; color: #6B5A4B; }
  @bottom-right { content: counter(page); font: 500 7.5pt 'JetBrains Mono', monospace; color: #6B5A4B; } }
@page :first { margin: 0; @bottom-left { content: none } @bottom-right { content: none } }
html { background: var(--paper); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 400 9.4pt/1.5 'Newsreader', Georgia, serif; color: var(--ink); font-variant-numeric: oldstyle-nums; }
a { color: inherit; text-decoration: none; border-bottom: .5px solid rgba(88,27,32,.45); }
h1, h2, h3, h4 { font-weight: 500; margin: 0; }
h2 { font-size: 20pt; line-height: 1.1; color: var(--ink); padding-top: .1in; margin: 0 0 .16in; border-bottom: 1px solid var(--ink); padding-bottom: .08in; break-after: avoid; }
h2 .num { font: 500 9pt 'JetBrains Mono', monospace; color: var(--ox); margin-right: .14in; vertical-align: .35em; letter-spacing: .1em; }
h3 { font: 600 7.4pt 'JetBrains Mono', monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--ox); margin: .2in 0 .07in; break-after: avoid; }
h4 { font: 600 9.6pt 'Newsreader', serif; margin: 0 0 .03in; }
p { margin: 0 0 .08in; } ul, ol { margin: 0 0 .08in; padding-left: 1.2em; } li { margin: 0 0 .03in; }
section.major { break-before: page; } section { margin-bottom: .12in; }
section.cover, section.toc { break-before: auto; }
.lede { font-size: 12pt; line-height: 1.45; }
.note { color: var(--muted); font-size: 8.6pt; font-style: italic; }
.muted { color: var(--muted); }
.small { font-size: 8pt; }
.tight li { margin: 0 0 .015in; }
.nowrap { white-space: nowrap; }
.tag, .oa, .acc { font: 600 5.8pt 'JetBrains Mono', monospace; letter-spacing: .1em; text-transform: uppercase; border: .5px solid var(--line); padding: .5pt 2.5pt; border-radius: 1px; color: var(--muted); vertical-align: 1pt; white-space: nowrap; }
.tag { color: var(--ox); border-color: var(--ox); }
.oa-mark { color: #2F4A3E; font-weight: 700; }
.oa, .acc.is-open { color: #2F4A3E; border-color: #2F4A3E; }
/* cover */
.cover { height: 11in; box-sizing: border-box; padding: .9in .95in .8in; background: var(--cream); display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
.cover-top { display: flex; align-items: center; gap: .14in; }
.cover-top .mark svg { width: .42in; height: .42in; display: block; }
.eyebrow { font: 500 7.5pt 'JetBrains Mono', monospace; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
.cover .word { font: 400 15pt 'Newsreader', serif; letter-spacing: .42em; margin-bottom: .5in; color: var(--ink); }
.kicker { font: 600 8pt 'JetBrains Mono', monospace; letter-spacing: .2em; text-transform: uppercase; color: var(--ox); margin-bottom: .14in; }
.cover h1 { font-size: 34pt; line-height: 1.06; letter-spacing: -.01em; max-width: 5.6in; margin-bottom: .22in; }
.cover .sub { font: 400 9pt 'Inter', sans-serif; color: var(--muted); letter-spacing: .02em; }
.cover-foot { border-top: 1px solid var(--ink); padding-top: .16in; display: grid; grid-template-columns: 1fr 1.6fr; gap: .4in; font-size: 9pt; }
.cover-foot .small { color: var(--muted); font-size: 7.4pt; line-height: 1.5; }
/* toc */
.toc ol { list-style: none; padding: 0; margin: 0 0 .35in; }
.toc li { margin: 0; border-bottom: .5px solid var(--line); }
.toc li a { display: flex; align-items: baseline; gap: .12in; padding: .07in 0; border: 0; font-size: 12pt; }
.toc .n { font: 500 8pt 'JetBrains Mono', monospace; color: var(--ox); width: .3in; }
.toc .t { flex: none; } .toc .dots { flex: 1; } .toc .p { font: 500 9pt 'JetBrains Mono', monospace; color: var(--muted); }
h2.plain { margin-top: 0; }
.glance { background: var(--cream); padding: .18in .22in; }
.glance h3 { margin-top: 0; }
.glance dl { display: grid; grid-template-columns: 1.15in 1fr; gap: .05in .15in; margin: 0; font-size: 9pt; }
.glance dt { font: 600 6.8pt 'JetBrains Mono', monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding-top: 2pt; }
.glance dd { margin: 0; }
/* blocks */
.pairs { display: grid; grid-template-columns: 1fr 1fr; gap: .1in .3in; margin-bottom: .06in; }
.pairs p { font-size: 8.7pt; line-height: 1.42; }
.objs { columns: 2; column-gap: .3in; }
.obj { break-inside: avoid; margin-bottom: .08in; }
.obj h4 { font-size: 9.2pt; } .obj h4 span { font: 600 6.6pt 'JetBrains Mono', monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--ox); margin-right: 3pt; }
.obj ul { font-size: 8.4pt; line-height: 1.38; padding-left: 1em; }
table { border-collapse: collapse; width: 100%; margin: 0 0 .1in; }
.grid th { font: 600 6.6pt 'JetBrains Mono', monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); text-align: left; border-bottom: 1px solid var(--ink); padding: 3pt 5pt 3pt 0; }
.grid td { border-bottom: .5px solid var(--line); padding: 3.5pt 6pt 3.5pt 0; vertical-align: top; }
.grid.small td { font-size: 8.4pt; line-height: 1.38; }
.grid tr.total td { border-top: 1px solid var(--ink); border-bottom: 0; font-weight: 600; }
.grid tr { break-inside: avoid; }
.grid.compact td { padding: 2pt 6pt 2pt 0; font-size: 9pt; }
.r { text-align: right; } .big { font-size: 13pt; color: var(--ox); }
/* weeks */
.week { break-inside: avoid; border-top: 1px solid var(--ink); padding: .09in 0 .14in; }
.week + .week { margin-top: .04in; }
.week header { display: flex; align-items: baseline; gap: .12in; }
.week .wk { font: 600 7pt 'JetBrains Mono', monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--ox); white-space: nowrap; }
.week h3 { font: 500 13.5pt 'Newsreader', serif; letter-spacing: 0; text-transform: none; color: var(--ink); margin: 0; flex: 1; }
.week .hrs { font: 500 7pt 'JetBrains Mono', monospace; color: var(--muted); }
.week .theme { font-size: 9pt; margin: .03in 0 .01in; }
.week .q { font-style: italic; color: var(--muted); font-size: 8.8pt; margin-bottom: .05in; }
.lessons { margin-bottom: .05in; } .lessons td { font-size: 8.8pt; padding: 1.5pt 6pt 1.5pt 0; border-bottom: .5px solid var(--line); }
.lessons .ln { width: .18in; font: 500 7pt 'JetBrains Mono', monospace; color: var(--ox); }
.lessons .lec { text-align: right; white-space: nowrap; width: 1.25in; font: 500 6.4pt 'JetBrains Mono', monospace; letter-spacing: .06em; text-transform: uppercase; }
.lec .on { color: var(--ox); } .lec .soon { color: #8A7C6E; }
.kv { font-size: 8.3pt; line-height: 1.42; margin-bottom: .04in; }
.kv b, .work b { font: 600 6.4pt 'JetBrains Mono', monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-right: 3pt; }
.work { display: grid; grid-template-columns: 1fr 1fr; gap: .02in .25in; font-size: 8.5pt; margin-top: .05in; }
.work span { color: var(--muted); font-size: 7.8pt; }
.flag { font-size: 8.4pt; background: var(--cream); padding: 3pt 6pt; margin: .06in 0 0; }
.flag b { color: var(--ox); }
/* readings */
.refs { columns: 2; column-gap: .28in; font-size: 7.7pt; line-height: 1.36; padding-left: 0; list-style: none; }
.refs li { break-inside: avoid; margin-bottom: .05in; padding-left: .12in; text-indent: -.12in; }
.refs .au { font-weight: 600; } .refs .wks { font: 500 6pt 'JetBrains Mono', monospace; color: var(--muted); white-space: nowrap; }
.cols { columns: 2; column-gap: .3in; font-size: 8.6pt; }
.outcomes li { margin-bottom: .09in; font-size: 9.6pt; }
.gaps dt { font-weight: 600; margin-top: .07in; } .gaps dd { margin: 0 0 0 .0in; }
.end { margin-top: .3in; border-top: .5px solid var(--line); padding-top: .1in; }
`;

async function render(out, pages) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const tmp = join(tmpdir(), `aperture-syllabus-${process.pid}.html`);
  writeFileSync(tmp, html(pages));
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  await b.close(); rmSync(tmp);
}

function pageMap(pdf) {
  try {
    const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).split('\f');
    const map = {};
    for (const [id, n, t] of SECTIONS) {
      const i = text.findIndex((pg, k) => k > 1 && pg.split('\n').some((ln) => ln.trim().replace(/\s+/g, ' ').startsWith(`${n} ${t}`.replace(/&/g, '&')) || ln.trim().replace(/\s+/g, ' ') === `${n}${t}`));
      if (i >= 0) map[id] = i + 1;
    }
    return { map, pages: text.filter((x) => x.trim()).length };
  } catch { return { map: {}, pages: null }; }
}

mkdirSync(OUTDIR, { recursive: true });
const out = join(OUTDIR, PDF_NAME);
await render(out, {});
let { map, pages } = pageMap(out);
if (Object.keys(map).length) { await render(out, map); ({ map, pages } = pageMap(out)); }
writeFileSync(join(OUTDIR, 'stamp.json'), JSON.stringify({ hash: S.hash, file: PDF_NAME, pages, generated: new Date().toISOString().slice(0, 10) }) + '\n');
console.log(`✓ ${PDF_NAME}: ${pages ?? '?'} pages, syllabus ${S.hash}; contents pages ${JSON.stringify(map)}`);
