#!/usr/bin/env node
// Writes aperture/docs/curriculum.md (Deliverable B) from aperture/build/content.json.
// Run after compile.mjs. Generated — never hand-edit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = JSON.parse(readFileSync(join(BASE, 'build', 'content.json'), 'utf8'));
const plain = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1');
const lib = new Map(C.library.map((r) => [r.id, r]));
const cite = (id) => { const r = lib.get(id); return r ? `${r.authors[0].split(' ').slice(-1)[0]}${r.authors.length > 1 ? ' et al.' : ''} (${r.year}), *${r.title}*` : id; };
const sum = (o) => Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 10) / 10;
const s = C.stats;

let md = `# APERTURE — Semester I curriculum\n\n*${C.semester.name}*\n\nGenerated from the course content by \`aperture/tools/docs.mjs\`. An independent learning program: no academic credit, accreditation or university affiliation.\n\n`;
md += `**Totals:** ${s.weeks} weeks · ${s.lessons} lessons · ${s.lessonWords.toLocaleString('en-US')} words of lesson instruction · ${s.quizQuestions} quiz questions (+${s.reserveQuestions} reassessment, ${s.checkQuestions} comprehension checks) · ${s.diagnosticQuestions} diagnostic and ${s.midtermQuestions} midterm questions · ${s.reviewCards} review cards · ${s.glossaryTerms} glossary terms · ${s.cases} original cases · ${s.capstoneComponents} capstone components · ${s.resources} library resources · about ${Math.round(s.plannedHours)} planned hours.\n\n`;
md += `**Grading:** quizzes ${C.semester.grading.quizzes}%, applied assignments ${C.semester.grading.assignments}%, midterm ${C.semester.grading.midterm}%, capstone ${C.semester.grading.capstone}%. Mastery threshold ${C.semester.grading.mastery * 100}%. Open-ended work is self-assessed against published rubrics and labelled so.\n\n`;
for (const w of C.weeks) {
  md += `## Week ${w.number} — ${w.title}\n\n*${w.theme}* · ${w.schools.map((x) => C.semester.schools.find((y) => y.id === x).name).join(' · ')} · ${sum(w.hours)} hours\n\n> ${w.question}\n\n**Objectives**\n\n${w.objectives.map((o) => `- ${plain(o)}`).join('\n')}\n\n**Lessons**\n\n`;
  for (const l of w.lessons) md += `${w.lessons.indexOf(l) + 1}. **${l.title}** (${l.minutes} min) — ${plain(l.summary)}\n`;
  md += `\n**Required reading:** ${w.readings.required.map((r) => `${cite(r.ref)} — ${plain(r.what)}`).join('; ')}\n\n`;
  md += `**Optional reading:** ${w.readings.optional.map((r) => cite(r.ref)).join('; ')}\n\n`;
  md += `**Exercise:** ${w.exercise.title} (${w.exercise.engine} engine, ${w.exercise.minutes} min) · **Case:** ${w.case.title} (${w.case.setting}) · **Quiz:** ${w.quiz.questions.length} questions, ${new Set(w.quiz.questions.map((q) => q.type)).size} types · **Assignment:** ${w.assignment.title} · **Review cards:** ${w.review.length} · **Glossary:** ${w.glossary.length} terms\n\n`;
  md += `**Looking ahead:** ${plain(w.preview.text)}\n\n`;
}
if (C.diagnostic) md += `## Baseline diagnostic\n\n${C.diagnostic.questions.length} auto-graded questions across nine domains. Never graded; it calibrates explanations and supplements and never skips material.\n\n`;
if (C.midterm) md += `## Midterm — ${C.midterm.title}\n\nCovers ${C.midterm.covers.join(', ')} · ${C.midterm.questions.length} questions plus ${C.midterm.reserve.length} for reassessment · cumulative case: *${C.midterm.case.title}*.\n\n`;
if (C.capstone) md += `## Capstone — ${C.capstone.title}\n\n${C.capstone.components.map((k) => `${k.number}. ${k.title} (after Week ${k.week})`).join('\n')}\n\nDeliverables: ${C.capstone.deliverables.map((d) => d.title).join(', ')}.\n`;
writeFileSync(join(BASE, 'docs', 'curriculum.md'), md);
console.log('✓ aperture/docs/curriculum.md');
