#!/usr/bin/env node
// Compiles aperture/content/** into aperture/build/content.json — the one file the protected API
// bundles — plus the auditable source manifest (aperture/build/manifest.json and
// aperture/docs/source-manifest.md). Generated files: never hand-edit; rerun this script.
//   node aperture/tools/compile.mjs           validate (non-strict) + compile
//   node aperture/tools/compile.mjs --strict  every content file must exist and validate
//   node aperture/tools/compile.mjs --check   fail if the committed build is out of date (CI)

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, '..');
const C = join(BASE, 'content');
const OUT = join(BASE, 'build');
const DOCS = join(BASE, 'docs');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const CHECK = args.includes('--check');

try {
  execFileSync(process.execPath, [join(HERE, 'validate.mjs'), '--quiet', ...(STRICT ? ['--strict'] : [])], { stdio: 'inherit' });
} catch { console.error('✖ validation failed — nothing compiled'); process.exit(1); }

const read = (rel) => (existsSync(join(C, rel)) ? JSON.parse(readFileSync(join(C, rel), 'utf8')) : null);

const weeks = [];
for (let n = 1; n <= 14; n++) { const w = read(`weeks/w${String(n).padStart(2, '0')}.json`); if (w) weeks.push(w); }
const diagnostic = read('diagnostic.json');
const midterm = read('midterm.json');
const capstone = read('capstone.json');
const audit = read('audit.json');
const labs = read('labs.json') || [];

/* ---------- library: merge every sources file, compute relationships ---------- */
const library = new Map();
for (const f of readdirSync(join(C, 'sources')).filter((x) => x.endsWith('.json')).sort()) {
  for (const r of JSON.parse(readFileSync(join(C, 'sources', f), 'utf8'))) {
    const prev = library.get(r.id);
    if (!prev) { library.set(r.id, { ...r, files: [f] }); continue; }
    prev.files.push(f);
    // Keep the better-verified record's metadata.
    const rank = { 'metadata-confirmed': 3, 'partially-confirmed': 2, unverified: 1 };
    if ((rank[r.verified?.status] || 0) > (rank[prev.verified?.status] || 0)) library.set(r.id, { ...r, files: prev.files });
  }
}
const relate = new Map(); // id -> { lessons:Set, weeks:Set, uses:[] }
const rel = (id) => { if (!relate.has(id)) relate.set(id, { lessons: new Set(), weeks: new Set(), places: new Set() }); return relate.get(id); };
function walkRefs(node, ctx) {
  if (Array.isArray(node)) return node.forEach((n) => walkRefs(n, ctx));
  if (!node || typeof node !== 'object') {
    if (typeof node === 'string') for (const [, , t] of node.matchAll(/\[([^\]]+)\]\((R-[^)\s]+)\)/g)) note(t, ctx);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'refs') && Array.isArray(v)) v.forEach((r) => note(r, ctx));
    else if ((k === 'ref' || k === 'cite') && typeof v === 'string' && v.startsWith('R-')) note(v, ctx);
    else walkRefs(v, ctx);
  }
}
function note(id, ctx) { const r = rel(id); if (ctx.lesson) r.lessons.add(ctx.lesson); if (ctx.week) r.weeks.add(ctx.week); r.places.add(ctx.place); }
for (const w of weeks) {
  for (const l of w.lessons) walkRefs(l, { week: w.id, lesson: l.id, place: l.id });
  const { lessons, ...rest } = w;
  walkRefs(rest, { week: w.id, place: w.id });
}
if (diagnostic) walkRefs(diagnostic, { place: 'diagnostic' });
if (midterm) walkRefs(midterm, { place: 'midterm' });
if (capstone) walkRefs(capstone, { week: 'w14', place: 'capstone' });
if (audit) walkRefs(audit, { place: 'audit' });

const lib = [...library.values()].sort((a, b) => a.authors[0].localeCompare(b.authors[0]) || a.year - b.year).map((r) => {
  const x = relate.get(r.id);
  const { files, ...clean } = r;
  return { ...clean, lessons: x ? [...x.lessons].sort() : [], weeks: x ? [...x.weeks].sort() : [], places: x ? [...x.places].sort() : [], flags: flagsFor(r, x) };
});
function flagsFor(r, x) {
  const f = [];
  if (r.verified?.status === 'unverified') f.push('unverified');
  if (r.verified?.status === 'partially-confirmed') f.push('partially-confirmed');
  if (r.verified?.link === 'not-opened') f.push('link-untested');
  if (r.type === 'journal-article' && !r.doi) f.push('no-doi');
  if (r.access === 'paywalled' || r.access === 'purchase') f.push('restricted-access');
  if (r.contested) f.push('contested');
  if (!x) f.push('uncited');
  return f;
}

/* ---------- concepts and glossary indices ---------- */
const concepts = {};
for (const w of weeks) for (const c of w.concepts) {
  const e = concepts[c.id] || (concepts[c.id] = { id: c.id, name: c.name, domain: c.domain, weeks: [], lessons: [] });
  if (!e.weeks.includes(w.id)) e.weeks.push(w.id);
  for (const l of c.lessons || []) if (!e.lessons.includes(l)) e.lessons.push(l);
}
const glossary = [];
for (const w of weeks) for (const g of w.glossary) glossary.push({ ...g, week: w.id });

/* ---------- manifest ---------- */
const count = (pred) => lib.filter(pred).length;
const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  method: 'Metadata verified through web-search results on the date shown per record. The build environment could not open pages, so every link is flagged link-untested until checked in a browser.',
  totals: {
    resources: lib.length,
    metadataConfirmed: count((r) => r.verified?.status === 'metadata-confirmed'),
    partiallyConfirmed: count((r) => r.verified?.status === 'partially-confirmed'),
    unverified: count((r) => r.verified?.status === 'unverified'),
    linkUntested: count((r) => r.flags.includes('link-untested')),
    open: count((r) => r.access === 'open'),
    restricted: count((r) => r.flags.includes('restricted-access')),
    contested: count((r) => r.flags.includes('contested')),
    uncited: count((r) => r.flags.includes('uncited')),
  },
  records: lib.map((r) => ({ id: r.id, title: r.title, year: r.year, url: r.url, doi: r.doi, status: r.verified?.status, verifiedOn: r.verified?.date, evidence: r.verified?.evidence, access: r.access, license: r.license, flags: r.flags, citedIn: r.places })),
};

/* ---------- stats ---------- */
const words = (s) => (typeof s === 'string' ? (s.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.%$-]*/g) || []).length : 0);
function blockWords(bs) { let n = 0; (bs || []).forEach((b) => { if (b.text) n += words(b.text); if (b.items && b.type === 'list') b.items.forEach((t) => (n += words(t))); if (b.blocks) n += blockWords(b.blocks); }); return n; }
const stats = {
  weeks: weeks.length,
  lessons: weeks.reduce((a, w) => a + w.lessons.length, 0),
  lessonWords: weeks.reduce((a, w) => a + w.lessons.reduce((b, l) => b + Object.values(l.sections).reduce((c, s) => c + blockWords(s), 0), 0), 0),
  quizQuestions: weeks.reduce((a, w) => a + w.quiz.questions.length, 0),
  reserveQuestions: weeks.reduce((a, w) => a + w.quiz.reserve.length, 0),
  checkQuestions: weeks.reduce((a, w) => a + w.lessons.reduce((b, l) => b + l.check.length, 0), 0),
  diagnosticQuestions: diagnostic ? diagnostic.questions.length : 0,
  midtermQuestions: midterm ? midterm.questions.length + midterm.reserve.length : 0,
  reviewCards: weeks.reduce((a, w) => a + w.review.length, 0),
  glossaryTerms: glossary.length,
  cases: weeks.length + (midterm ? 1 : 0),
  assignments: weeks.length,
  capstoneComponents: capstone ? capstone.components.length : 0,
  resources: lib.length,
  plannedHours: Math.round(weeks.reduce((a, w) => a + Object.values(w.hours).reduce((b, h) => b + h, 0), 0) * 10) / 10,
};

const content = {
  schema: 1,
  semester: {
    id: 's1', title: 'Semester I', name: 'Foundations of Human Behavior, Evidence & Executive Leadership',
    weeks: 14, hoursPerWeek: '5–7',
    schools: [
      { id: 'behavioral', name: 'School of Behavioral & Social Science' },
      { id: 'business', name: 'School of Business & Leadership' },
      { id: 'law', name: 'School of Law & Strategy' },
    ],
    grading: { quizzes: 30, assignments: 25, midterm: 20, capstone: 25, mastery: 0.8 },
  },
  stats, weeks, diagnostic, midterm, capstone, audit, labs, library: lib, concepts, glossary,
  manifest: { generated: manifest.generated, method: manifest.method, totals: manifest.totals },
};

const json = JSON.stringify(content);
const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
const md = renderManifest(manifest);
if (CHECK) {
  const same = (p, s) => existsSync(p) && stripDate(readFileSync(p, 'utf8')) === stripDate(s);
  if (!same(join(OUT, 'content.json'), json) || !same(join(OUT, 'manifest.json'), manifestJson)) { console.error('✖ aperture/build is out of date — run node aperture/tools/compile.mjs'); process.exit(1); }
  console.log('✓ aperture/build is up to date'); process.exit(0);
}
mkdirSync(OUT, { recursive: true }); mkdirSync(DOCS, { recursive: true });
writeFileSync(join(OUT, 'content.json'), json);
writeFileSync(join(OUT, 'manifest.json'), manifestJson);
writeFileSync(join(DOCS, 'source-manifest.md'), md);
console.log(`✓ compiled ${stats.weeks} weeks, ${stats.lessons} lessons, ${stats.lessonWords.toLocaleString('en-US')} lesson words, ${lib.length} resources → aperture/build/content.json (${(json.length / 1024).toFixed(0)} KB)`);

function stripDate(s) { return s.replace(/"generated":\s*"\d{4}-\d{2}-\d{2}"/g, ''); }
function renderManifest(m) {
  const t = m.totals;
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let out = `# APERTURE source manifest\n\nGenerated ${m.generated} by \`aperture/tools/compile.mjs\` — do not edit by hand.\n\n${m.method}\n\n`;
  out += `| Total | Metadata confirmed | Partially confirmed | Unverified | Link untested | Open access | Restricted access | Contested | Not cited |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  out += `| ${t.resources} | ${t.metadataConfirmed} | ${t.partiallyConfirmed} | ${t.unverified} | ${t.linkUntested} | ${t.open} | ${t.restricted} | ${t.contested} | ${t.uncited} |\n\n`;
  out += `| ID | Title | Year | Status | Access | Flags | Cited in |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const r of m.records) out += `| \`${r.id}\` | [${esc(r.title)}](${r.url}) | ${r.year} | ${r.status} | ${r.access} | ${r.flags.join(', ')} | ${r.citedIn.join(', ')} |\n`;
  return out;
}
