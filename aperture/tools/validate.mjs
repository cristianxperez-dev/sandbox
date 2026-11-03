#!/usr/bin/env node
// APERTURE content validator.
//   node aperture/tools/validate.mjs              validate everything present (warn about missing files)
//   node aperture/tools/validate.mjs --week 4     validate one week (+ its sources) — for content writers
//   node aperture/tools/validate.mjs --only capstone|diagnostic|midterm|audit|labs
//   node aperture/tools/validate.mjs --strict     every file must exist (used before commit / in CI)
//   node aperture/tools/validate.mjs --course b   validate Course B (aperture/content-b; weeks b01…, only the
//                                                 weeks listed as available in course.json are required)
// Exit code 1 on any error. Warnings never fail.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const COURSE = opt('--course') === 'b' ? 'b' : 'a';
const P = COURSE === 'b' ? 'b' : 'w'; // week-id prefix
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', COURSE === 'b' ? 'content-b' : 'content');
const COURSE_META = COURSE === 'b' ? JSON.parse(readFileSync(join(ROOT, 'course.json'), 'utf8')) : null;
const STRICT = args.includes('--strict');
const ONLY_WEEK = opt('--week') ? Number(opt('--week')) : null;
const ONLY = opt('--only');
const QUIET = args.includes('--quiet');

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

export const DOMAINS = COURSE_META ? COURSE_META.domains.map((d) => d.id) : ['behavioral-science', 'statistical-reasoning', 'business-strategy', 'financial-literacy', 'legal-reasoning', 'negotiation', 'organizational-behavior', 'leadership-judgment', 'communication'];
const SCHOOLS = COURSE_META ? COURSE_META.schools.map((d) => d.id) : ['behavioral', 'business', 'law'];
const KINDS = ['established', 'original', 'example', 'application', 'hypothesis', 'contested'];
const LABS = ['behavioral-decision-lab', 'negotiation-simulator', 'organizational-design-studio', 'research-critique-lab', 'financial-decision-studio', 'executive-communication-studio', 'contract-issue-spotting-lab', 'strategic-decision-journal', 'biomechanics-laboratory'];
const ENGINES = ['calibration', 'simulation', 'design', 'branching', 'negotiation', 'allocation', 'orgdesign', 'stakeholder', 'issues', 'composer', 'frames', 'measurement'];
const QTYPES = ['mc', 'multi', 'scenario', 'flaw', 'research', 'decision', 'issue', 'rank', 'numeric', 'short'];
const SINGLE = ['mc', 'scenario', 'flaw', 'research', 'decision'];
const AUTO = QTYPES.filter((t) => t !== 'short');
const RES_TYPES = ['journal-article', 'book', 'book-chapter', 'working-paper', 'course', 'lecture', 'report', 'textbook', 'article', 'practitioner-article', 'legal-primary', 'dataset', 'website'];
const ACCESS = ['open', 'free-registration', 'paywalled', 'library', 'purchase'];
const STATUS = ['metadata-confirmed', 'partially-confirmed', 'unverified'];
const EVIDENCE = ['meta-analysis', 'systematic-review', 'rct', 'field-experiment', 'lab-experiment', 'quasi-experimental', 'observational', 'longitudinal', 'qualitative', 'theoretical', 'review', 'textbook', 'practitioner', 'legal-primary', 'course'];
const SETTINGS = ['baseball', 'technology', 'healthcare', 'finance', 'government', 'international', 'sports', 'consulting', 'education', 'military', 'nonprofit', 'legal'];
const RES_ID = /^R-[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const readJSON = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return undefined;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { err(rel, `invalid JSON — ${e.message}`); return null; }
};
const isStr = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;
const isArr = (v, min = 0, max = Infinity) => Array.isArray(v) && v.length >= min && v.length <= max;
const words = (s) => (typeof s === 'string' ? (s.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.%$-]*/g) || []).length : 0);

/* ---------------- load sources ---------------- */
const sources = new Map();          // id -> record
const sourceFiles = existsSync(join(ROOT, 'sources')) ? readdirSync(join(ROOT, 'sources')).filter((f) => f.endsWith('.json')) : [];
for (const f of sourceFiles) {
  const list = readJSON(`sources/${f}`);
  if (!Array.isArray(list)) { if (list !== null) err(`sources/${f}`, 'must be an array'); continue; }
  for (const r of list) {
    const where = `sources/${f} ${r && r.id}`;
    checkResource(r, where);
    if (!r || !r.id) continue;
    if (sources.has(r.id)) {
      const prev = sources.get(r.id);
      if (norm(prev.title) !== norm(r.title)) err(where, `duplicate id with a different title ("${prev.title}" vs "${r.title}")`);
    } else sources.set(r.id, r);
  }
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function checkResource(r, where) {
  if (!r || typeof r !== 'object') return err(where, 'not an object');
  if (!RES_ID.test(r.id || '')) err(where, `id "${r.id}" does not match R-<surname>-<year>-<word>`);
  for (const k of ['title', 'publication', 'summary', 'strengths', 'limitations', 'generalizability', 'relevance', 'license']) if (!isStr(r[k])) err(where, `missing ${k}`);
  if (!isArr(r.authors, 1) || !r.authors.every((a) => isStr(a))) err(where, 'authors must be a non-empty array of names');
  if (!Number.isInteger(r.year) || r.year < 1700 || r.year > 2026) err(where, 'year must be an integer ≤ 2026');
  if (r.id && Number.isInteger(r.year) && !r.id.includes(`-${r.year}-`)) err(where, 'id year does not match year');
  if (!/^https:\/\/[^\s]+$/.test(r.url || '')) err(where, 'url must be https://');
  if (r.doi != null && !/^10\.\d{4,9}\/\S+$/.test(r.doi)) err(where, `doi "${r.doi}" malformed`);
  if (!isStr(r.discipline)) err(where, 'missing discipline');
  if (!RES_TYPES.includes(r.type)) err(where, `type "${r.type}" not allowed`);
  if (!ACCESS.includes(r.access)) err(where, `access "${r.access}" not allowed`);
  if (!EVIDENCE.includes(r.evidence)) err(where, `evidence "${r.evidence}" not allowed`);
  if (!isArr(r.arguments, 1)) err(where, 'arguments must list 1+ key arguments');
  if (!Number.isFinite(r.readingMinutes) || r.readingMinutes <= 0) err(where, 'readingMinutes must be a positive number');
  const v = r.verified || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) err(where, 'verified.date YYYY-MM-DD');
  if (!STATUS.includes(v.status)) err(where, `verified.status "${v.status}"`);
  if (!isStr(v.evidence)) err(where, 'verified.evidence must say what was confirmed where');
  if (!isStr(v.method)) err(where, 'verified.method missing');
  if (v.status === 'unverified') warn(where, 'UNVERIFIED source (will be flagged in the manifest)');
}

/* ---------------- text + blocks ---------------- */
const lessonIds = new Set();
const weekIds = new Set();
const glossaryIds = new Set();
const pendingLinks = []; // [where, target]
const usedRefs = new Map(); // ref -> Set(where)

function noteRef(ref, where) {
  if (!usedRefs.has(ref)) usedRefs.set(ref, new Set());
  usedRefs.get(ref).add(where);
}
function checkText(s, where, field = 'text') {
  if (typeof s !== 'string') return err(where, `${field} must be a string`);
  if (/<\/?[a-zA-Z][^>]*>/.test(s)) err(where, `${field} contains HTML tags (use the inline markup)`);
  if (/https?:\/\//.test(s)) err(where, `${field} contains a raw URL (put URLs in resource records)`);
  for (const [, , target] of s.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    if (target.startsWith('R-')) { noteRef(target, where); if (!sources.has(target)) err(where, `link to unknown resource ${target}`); }
    else if (target.startsWith('#')) pendingLinks.push([where, target.slice(1)]);
    else err(where, `link target "${target}" must be R-… or #…`);
  }
}
function checkRefs(refs, where, required) {
  if (refs == null) { if (required) err(where, 'refs required for this kind'); return; }
  if (!Array.isArray(refs)) return err(where, 'refs must be an array');
  if (required && !refs.length) err(where, 'refs required for this kind');
  for (const r of refs) { noteRef(r, where); if (!sources.has(r)) err(where, `unknown resource ${r}`); }
}
// returns {words, diagrams, foundation, depth, executive}
function checkBlocks(blocks, where, opts = {}) {
  const stat = { words: 0, diagrams: 0, foundation: 0, depth: 0, executive: 0, kinds: {} };
  if (!Array.isArray(blocks)) { err(where, 'must be a block list'); return stat; }
  blocks.forEach((b, i) => {
    const w = `${where}[${i}]`;
    if (!b || typeof b !== 'object') return err(w, 'block is not an object');
    const needKind = ['p', 'list', 'table', 'matrix', 'flow', 'bars'].includes(b.type);
    if (needKind) {
      if (!KINDS.includes(b.kind)) err(w, `kind "${b.kind}" must be one of ${KINDS.join(', ')}`);
      stat.kinds[b.kind] = (stat.kinds[b.kind] || 0) + 1;
      checkRefs(b.refs, w, b.kind === 'established' || b.kind === 'contested');
      if (b.kind === 'contested' && Array.isArray(b.refs) && b.refs.length < 2) warn(w, 'contested block cites one source — cite both sides where possible');
    }
    switch (b.type) {
      case 'p': checkText(b.text, w); stat.words += words(b.text); break;
      case 'h': checkText(b.text, w); break;
      case 'prompt': checkText(b.text, w); break;
      case 'quote':
        checkText(b.text, w); if (words(b.text) > 40) err(w, 'quotation longer than 40 words');
        if (!b.cite) err(w, 'quote needs cite'); else { noteRef(b.cite, w); if (!sources.has(b.cite)) err(w, `unknown cite ${b.cite}`); }
        break;
      case 'list':
        if (!isArr(b.items, 1)) err(w, 'list needs items');
        else b.items.forEach((t, j) => { checkText(t, `${w}.items[${j}]`); stat.words += words(t); });
        break;
      case 'table':
        stat.diagrams++;
        if (!isArr(b.headers, 1)) err(w, 'table needs headers');
        if (!isArr(b.rows, 1)) err(w, 'table needs rows');
        else b.rows.forEach((r, j) => { if (!Array.isArray(r) || r.length !== (b.headers || []).length) err(`${w}.rows[${j}]`, 'row length must match headers'); else r.forEach((c) => typeof c === 'string' ? checkText(c, `${w}.rows[${j}]`) : typeof c === 'number' || err(`${w}.rows[${j}]`, 'cell must be string or number')); });
        break;
      case 'matrix':
        stat.diagrams++;
        if (!isArr(b.x, 2, 2) || !isArr(b.y, 2, 2)) err(w, 'matrix needs x and y with two labels each');
        if (!isArr(b.cells, 2, 2) || !b.cells.every((r) => isArr(r, 2, 2))) err(w, 'matrix cells must be 2×2');
        else b.cells.flat().forEach((c) => checkText(c, w, 'cell'));
        break;
      case 'flow':
        stat.diagrams++;
        if (!isArr(b.steps, 2)) err(w, 'flow needs 2+ steps');
        else b.steps.forEach((s, j) => { if (!isStr(s.label)) err(`${w}.steps[${j}]`, 'label missing'); if (s.text != null) checkText(s.text, `${w}.steps[${j}]`); });
        break;
      case 'bars':
        stat.diagrams++;
        if (!isArr(b.items, 2)) err(w, 'bars needs 2+ items');
        else b.items.forEach((it, j) => { if (!isStr(it.label) || !Number.isFinite(it.value)) err(`${w}.items[${j}]`, 'label + numeric value required'); });
        if (!isStr(b.note)) err(w, 'bars needs a note saying Synthetic or citing the source');
        else if (!/synthetic/i.test(b.note) && !(Array.isArray(b.refs) && b.refs.length)) err(w, 'bars data must be labelled Synthetic or cite refs');
        break;
      case 'mode': {
        if (!['foundation', 'executive'].includes(b.mode)) err(w, 'mode must be foundation or executive');
        if (!isStr(b.title)) err(w, 'mode block needs a title');
        const s = checkBlocks(b.blocks, `${w}.blocks`, opts);
        stat.words += s.words; stat.diagrams += s.diagrams; merge(stat.kinds, s.kinds);
        if (b.mode === 'foundation') stat.foundation++; else stat.executive++;
        break;
      }
      case 'depth': {
        if (!isStr(b.title)) err(w, 'depth block needs a title');
        const s = checkBlocks(b.blocks, `${w}.blocks`, opts);
        stat.words += s.words; stat.diagrams += s.diagrams; merge(stat.kinds, s.kinds); stat.depth++;
        break;
      }
      default: err(w, `unknown block type "${b.type}"`);
    }
  });
  return stat;
}
function merge(a, b) { for (const k in b) a[k] = (a[k] || 0) + b[k]; }

/* ---------------- questions ---------------- */
const questionIds = new Set();
function checkQuestion(q, where, { autoOnly = false, idPattern } = {}) {
  if (!q || typeof q !== 'object') return err(where, 'question not an object');
  const w = `${where} ${q.id || '?'}`;
  if (!isStr(q.id)) err(w, 'id missing'); else {
    if (questionIds.has(q.id)) err(w, 'duplicate question id'); questionIds.add(q.id);
    if (idPattern && !idPattern.test(q.id)) err(w, `id does not match ${idPattern}`);
  }
  if (!QTYPES.includes(q.type)) return err(w, `type "${q.type}" invalid`);
  if (autoOnly && q.type === 'short') err(w, 'short responses are not allowed here (auto-gradable only)');
  checkText(q.prompt, w, 'prompt');
  if (q.stimulus != null) checkBlocks(q.stimulus, `${w}.stimulus`);
  if (['scenario', 'flaw', 'research'].includes(q.type) && !isArr(q.stimulus, 1) && words(q.prompt) < 50) err(w, `${q.type} questions need a stimulus (or a prompt of 50+ words)`);
  if (!DOMAINS.includes(q.domain)) err(w, `domain "${q.domain}" invalid`);
  if (!isArr(q.concepts, 1)) err(w, 'concepts required');
  if (!['core', 'stretch'].includes(q.difficulty)) err(w, 'difficulty core|stretch');
  if (q.points != null && !(q.points > 0)) err(w, 'points must be > 0');
  if (q.type === 'short') {
    if (!isStr(q.modelAnswer, 40)) err(w, 'short needs modelAnswer');
    if (!isArr(q.rubric, 1) || !q.rubric.every((r) => isStr(r.criterion) && r.points > 0 && isArr(r.levels, 2))) err(w, 'short needs rubric [{criterion, points, levels}]');
    return;
  }
  if (!isStr(q.explanation, 40)) err(w, 'explanation required (2–5 sentences)'); else checkText(q.explanation, w, 'explanation');
  if (q.type === 'numeric') {
    const a = q.answer || {};
    if (!Number.isFinite(a.value) || !Number.isFinite(a.tolerance) || a.tolerance < 0) err(w, 'numeric answer {value, tolerance}');
    if (!isStr(q.working)) warn(w, 'numeric question without working');
    return;
  }
  if (!isArr(q.options, 3, 7)) return err(w, 'options 3–7 required');
  const ids = q.options.map((o) => o && o.id);
  if (new Set(ids).size !== ids.length || !ids.every((x) => /^[a-g]$/.test(x || ''))) err(w, 'option ids must be unique letters a–g');
  q.options.forEach((o) => checkText(o.text, w, `option ${o.id}`));
  if (SINGLE.includes(q.type)) {
    if (!ids.includes(q.answer)) err(w, `answer "${q.answer}" not an option`);
    const missing = ids.filter((x) => x !== q.answer && !(q.optionFeedback && isStr(q.optionFeedback[x])));
    if (missing.length) err(w, `optionFeedback missing for ${missing.join(', ')}`);
  } else if (q.type === 'multi' || q.type === 'issue') {
    if (!isArr(q.answer, 1) || !q.answer.every((x) => ids.includes(x)) || q.answer.length === ids.length) err(w, 'answer must be a proper subset of option ids');
  } else if (q.type === 'rank') {
    if (!isArr(q.answer) || q.answer.length !== ids.length || !ids.every((x) => q.answer.includes(x))) err(w, 'rank answer must order every option');
  }
  if (q.errorTags) for (const [k, v] of Object.entries(q.errorTags)) { if (!ids.includes(k)) err(w, `errorTags key ${k} not an option`); if (!/^[a-z0-9-]+$/.test(v)) err(w, `errorTag "${v}" must be kebab-case`); }
}

/* ---------------- engines ---------------- */
function checkEngine(engine, c, w) {
  if (!c || typeof c !== 'object') return err(w, 'config missing');
  const blocks = (b, n) => b != null && checkBlocks(b, `${w}.${n}`);
  switch (engine) {
    case 'frames':
    case 'measurement': {
      // Course B labs: every prediction task's truth is computed by the engine from stated mathematics.
      const checks = engine === 'frames' ? ['reported', 'frameElev', 'moment', 'choice', 'value'] : ['bias', 'teB', 'mdcB', 'realA', 'realB', 'obsB', 'choice', 'value'];
      if (!isArr(c.tasks, 3, 12)) err(w, `${engine} needs 3–12 prediction tasks`);
      (c.tasks || []).forEach((t) => {
        if (!/^t\d{1,2}$/.test(t.id || '') || !isStr(t.prompt) || !checks.includes(t.check) || !['number', 'choice'].includes(t.type)) err(w, `task ${t.id} needs id t#, prompt, type and check (${checks.join('|')})`);
        if (t.type === 'number' && !(t.tolerance > 0)) err(w, `task ${t.id} needs a positive tolerance`);
        if (t.type === 'choice' && (!isArr(t.options, 2) || (t.check === 'choice' && !t.options.some((o) => o.id === t.answer)))) err(w, `task ${t.id} choice options/answer`);
        if (engine === 'frames' && !['rotation', 'frames', 'moment', 'chain'].includes(t.station)) err(w, `task ${t.id} station`);
        if (t.prompt) checkText(t.prompt, `${w} task ${t.id}`, 'prompt');
      });
      break;
    }
    case 'calibration':
      if (!isArr(c.binary, 10, 20)) err(w, 'calibration.binary needs 10–20 items');
      (c.binary || []).forEach((b) => { if (!isStr(b.statement) || typeof b.key?.answer !== 'boolean' || !isStr(b.key?.explanation)) err(w, `binary ${b.id} needs statement + key.answer boolean + key.explanation`); });
      if (!isArr(c.intervals, 6, 12)) err(w, 'calibration.intervals needs 6–12 items');
      (c.intervals || []).forEach((b) => { if (!isStr(b.question) || !Number.isFinite(b.key?.answer) || !isStr(b.key?.explanation)) err(w, `interval ${b.id} needs question + numeric key.answer + key.explanation`); });
      break;
    case 'simulation':
      if (!isArr(c.presets, 3)) err(w, 'simulation needs 3+ presets');
      (c.presets || []).forEach((p) => { const a = p.params || {}; if (!isStr(p.title) || !isStr(p.predict) || !(a.n > 1) || !(a.effect >= 0) || !(a.outcomes >= 1) || !(a.studies >= 100) || !(a.reliability > 0 && a.reliability <= 1) || typeof a.publishOnlySignificant !== 'boolean' || !isStr(p.key?.lesson)) err(w, `preset ${p.id} incomplete`); });
      break;
    case 'design': {
      blocks(c.brief, 'brief');
      if (!isArr(c.indicators, 3, 7)) err(w, 'design needs 3–7 indicators');
      const ind = new Set((c.indicators || []).map((i) => i.id));
      if (!isArr(c.dimensions, 4, 8)) err(w, 'design needs 4–8 dimensions');
      const dims = new Map();
      (c.dimensions || []).forEach((d) => {
        if (!isArr(d.options, 2, 5)) err(w, `dimension ${d.id} needs 2–5 options`);
        dims.set(d.id, new Set((d.options || []).map((o) => o.id)));
        (d.options || []).forEach((o) => { for (const [k, v] of Object.entries(o.effects || {})) { if (!ind.has(k)) err(w, `option ${d.id}.${o.id} effect on unknown indicator ${k}`); if (!Number.isInteger(v) || Math.abs(v) > 3) err(w, `option ${d.id}.${o.id} effect must be an integer −3…3`); } if (!isStr(o.why)) err(w, `option ${d.id}.${o.id} needs why`); if (o.refs) checkRefs(o.refs, w); });
      });
      if (!isArr(c.rules, 3)) err(w, 'design needs 3+ rules');
      (c.rules || []).forEach((r) => { for (const [k, v] of Object.entries(r.when || {})) if (!dims.get(k)?.has(v)) err(w, `rule ${r.id} refers to unknown ${k}=${v}`); if (!isStr(r.text)) err(w, `rule ${r.id} text`); if (r.refs) checkRefs(r.refs, w); });
      if (!isStr(c.disclaimer)) err(w, 'design needs disclaimer');
      break;
    }
    case 'branching': {
      const nodes = c.nodes || {};
      const ind = new Set((c.indicators || []).map((i) => i.id));
      if (!isArr(c.indicators, 2, 6)) err(w, 'branching needs 2–6 indicators');
      if (!nodes[c.start]) err(w, 'start node missing');
      const ids = Object.keys(nodes);
      if (ids.length < 8) err(w, 'branching needs 8+ nodes');
      if (ids.filter((k) => nodes[k].end).length < 3) err(w, 'branching needs 3+ endings');
      for (const [k, n] of Object.entries(nodes)) {
        blocks(n.text, `nodes.${k}.text`);
        if (n.end) continue;
        if (!isArr(n.choices, 2, 4)) err(w, `node ${k} needs 2–4 choices`);
        (n.choices || []).forEach((ch) => { if (!nodes[ch.next]) err(w, `node ${k} choice ${ch.id} → unknown ${ch.next}`); if (!isStr(ch.feedback)) err(w, `node ${k} choice ${ch.id} feedback`); for (const [ik, v] of Object.entries(ch.effects || {})) { if (!ind.has(ik)) err(w, `node ${k} choice ${ch.id} unknown indicator ${ik}`); if (!Number.isInteger(v) || Math.abs(v) > 2) err(w, `node ${k} choice ${ch.id} effect must be −2…2`); } if (ch.refs) checkRefs(ch.refs, w); });
      }
      // reachability
      const seen = new Set(); const stack = [c.start];
      while (stack.length) { const k = stack.pop(); if (!k || seen.has(k) || !nodes[k]) continue; seen.add(k); (nodes[k].choices || []).forEach((ch) => stack.push(ch.next)); }
      ids.filter((k) => !seen.has(k)).forEach((k) => warn(w, `node ${k} unreachable`));
      break;
    }
    case 'negotiation': {
      blocks(c.role, 'role');
      if (!isArr(c.issues, 3, 5)) err(w, 'negotiation needs 3–5 issues');
      (c.issues || []).forEach((i) => { if (!isArr(i.options, 2) || !isArr(i.you) || i.you.length !== i.options.length) err(w, `issue ${i.id}: options and you must align`); const t = c.key?.them?.[i.id]; if (!isArr(t) || t.length !== (i.options || []).length) err(w, `key.them.${i.id} must align with options`); if (!Number.isInteger(c.opening?.[i.id]) || c.opening[i.id] < 0 || c.opening[i.id] >= (i.options || []).length) err(w, `opening.${i.id} must be an option index`); });
      if (!Number.isFinite(c.batna?.you) || !Number.isFinite(c.key?.batna)) err(w, 'batna.you and key.batna numbers required');
      if (!(c.rounds >= 3 && c.rounds <= 10)) err(w, 'rounds 3–10');
      break;
    }
    case 'allocation':
      blocks(c.brief, 'brief');
      if (c.mode === 'capital') {
        if (!(c.budget > 0) || !c.rate || !isArr(c.projects, 4)) err(w, 'capital mode needs budget, rate, 4+ projects');
        (c.projects || []).forEach((p) => { if (!isArr(p.cashflows, 3) || !(p.cashflows[0] < 0) || !p.cashflows.every(Number.isFinite)) err(w, `project ${p.id} cashflows: year-0 outflow then numbers`); if (!p.scenarios || !Number.isFinite(p.scenarios.low)) err(w, `project ${p.id} scenarios`); });
      } else if (c.mode === 'strategy') {
        const ini = new Set((c.initiatives || []).map((i) => i.id));
        if (!(c.budget > 0) || !isArr(c.initiatives, 4) || !isArr(c.strategies, 2) || !isArr(c.scenarios, 1)) err(w, 'strategy mode needs budget, 4+ initiatives, 2+ strategies, scenarios');
        (c.initiatives || []).forEach((i) => { if (!(i.scale > 0) || !(i.saturation > 0) || !(i.max > 0)) err(w, `initiative ${i.id} needs scale, saturation, max`); });
        (c.strategies || []).forEach((s) => Object.keys(s.weights || {}).forEach((k) => ini.has(k) || err(w, `strategy ${s.id} weight for unknown initiative ${k}`)));
      } else err(w, 'allocation.mode capital|strategy');
      break;
    case 'orgdesign': {
      blocks(c.brief, 'brief');
      const roles = new Set((c.roles || []).map((r) => r.id));
      if (!(c.budget > 0) || !isArr(c.roles, 4) || !isArr(c.work, 6) || !isArr(c.decisions, 3)) err(w, 'orgdesign needs budget, 4+ roles, 6+ work items, 3+ decisions');
      (c.roles || []).forEach((r) => { if (!(r.cost > 0) || !(r.hours > 0)) err(w, `role ${r.id} cost/hours`); });
      (c.start || []).forEach((p) => roles.has(p.role) || err(w, `start position uses unknown role ${p.role}`));
      break;
    }
    case 'stakeholder':
      blocks(c.brief, 'brief');
      if (!isArr(c.stakeholders, 6, 12)) err(w, 'stakeholder needs 6–12 stakeholders');
      (c.stakeholders || []).forEach((s) => { const k = s.key || {}; if (!(k.power >= 1 && k.power <= 5 && k.interest >= 1 && k.interest <= 5 && k.stance >= -2 && k.stance <= 2) || !isStr(k.why)) err(w, `stakeholder ${s.id} key {power, interest, stance, why}`); });
      break;
    case 'issues': {
      const cl = new Set((c.document?.clauses || []).map((x) => x.id));
      const cat = new Set((c.categories || []).map((x) => x.id));
      if (cl.size < 10) err(w, 'issues document needs 10+ clauses');
      if (cat.size < 6) err(w, 'issues needs 6+ categories');
      if (!isArr(c.key?.issues, 8)) err(w, 'issues key needs 8+ issues');
      (c.key?.issues || []).forEach((i) => { if (!cl.has(i.clause) || !cat.has(i.category)) err(w, `key issue refers to unknown clause/category ${i.clause}/${i.category}`); if (!isStr(i.explanation)) err(w, 'key issue explanation'); });
      if (!isStr(c.disclaimer)) err(w, 'issues needs disclaimer');
      break;
    }
    case 'composer':
      blocks(c.scenario, 'scenario');
      if (!isArr(c.formats, 1)) err(w, 'composer needs formats');
      (c.formats || []).forEach((f) => { if (!isArr(f.words, 2, 2)) err(w, `format ${f.id} words [min,max]`); });
      if (!isArr(c.checklist, 3)) err(w, 'composer needs a 3+ item checklist');
      break;
    default: err(w, `unknown engine ${engine}`);
  }
}

/* ---------------- case / assignment ---------------- */
function checkCase(c, where, minWords = 900) {
  if (!c) return err(where, 'case missing');
  for (const k of ['id', 'title', 'fiction', 'application']) if (!isStr(c[k])) err(where, `case.${k} missing`);
  if (!SETTINGS.includes(c.setting)) err(where, `case.setting "${c.setting}" not in ${SETTINGS.join(', ')}`);
  const s = checkBlocks(c.body, `${where}.body`);
  if (s.words < minWords) err(where, `case body has ${s.words} words (min ${minWords})`);
  (c.exhibits || []).forEach((e, i) => { if (!isStr(e.title) || !isArr(e.headers, 1) || !isArr(e.rows, 1)) err(where, `exhibit ${i} needs title, headers, rows`); if (!/synthetic/i.test(e.note || '')) err(where, `exhibit ${i} note must say Synthetic`); });
  if (!isArr(c.questions, 3, 6)) err(where, 'case needs 3–5 discussion questions');
  if (!isArr(c.perspectives, 2, 4)) err(where, 'case needs 2–4 perspectives');
  return s.words;
}
function checkRubric(rubric, where) {
  if (!isArr(rubric, 3, 7)) return err(where, 'rubric needs 3–7 criteria');
  const total = rubric.reduce((a, r) => a + (r.weight || 0), 0);
  if (total !== 100) err(where, `rubric weights sum to ${total}, not 100`);
  rubric.forEach((r) => { if (!isStr(r.criterion) || !isArr(r.levels, 4, 4) || !r.levels.every((l) => [1, 2, 3, 4].includes(l.score) && isStr(l.descriptor))) err(where, `rubric ${r.id} needs 4 levels with score 1–4 + descriptor`); });
}
function checkAssignment(a, where) {
  if (!a) return err(where, 'assignment missing');
  for (const k of ['id', 'title', 'deliverable']) if (!isStr(a[k])) err(where, `assignment.${k} missing`);
  checkBlocks(a.brief, `${where}.brief`);
  if (a.words !== null && !isArr(a.words, 2, 2)) err(where, 'assignment.words [min,max] or null');
  if (!isArr(a.template, 3, 10)) err(where, 'assignment.template 3–10 sections');
  checkRubric(a.rubric, `${where}.rubric`);
  if (a.composer) checkEngine('composer', a.composer, `${where}.composer`);
  if (a.checks && !a.checks.every((c) => ['words', 'sections'].includes(c))) err(where, 'checks may only be words|sections');
}

/* ---------------- week ---------------- */
const stats = { lessons: 0, words: 0, questions: 0, quizQuestions: 0, checks: 0, review: 0, glossary: 0, cases: 0, weeks: 0 };
const weekFiles = [];
const REQUIRED_WEEKS = COURSE_META ? new Set(COURSE_META.available) : null; // Course B: later weeks are planned, not missing
for (let n = 1; n <= 14; n++) {
  const id = `${P}${String(n).padStart(2, '0')}`;
  if (ONLY_WEEK && n !== ONLY_WEEK) { // still register ids from other weeks for link resolution
    const other = readJSON(`weeks/${id}.json`);
    if (other) registerWeekIds(other);
    continue;
  }
  if (ONLY && !ONLY_WEEK) { const other = readJSON(`weeks/${id}.json`); if (other) registerWeekIds(other); continue; }
  const wk = readJSON(`weeks/${id}.json`);
  if (wk === undefined) { if (REQUIRED_WEEKS && !REQUIRED_WEEKS.has(n)) continue; (STRICT ? err : warn)(`weeks/${id}.json`, 'missing'); continue; }
  if (wk) weekFiles.push(wk);
}
function registerWeekIds(wk) {
  if (wk && wk.id) weekIds.add(wk.id);
  (wk?.lessons || []).forEach((l) => l && lessonIds.add(l.id));
  (wk?.glossary || []).forEach((g) => g && glossaryIds.add(g.id));
}
weekFiles.forEach(registerWeekIds);

const conceptNames = new Map();
for (const wk of weekFiles) checkWeek(wk);

function checkWeek(wk) {
  const W = `weeks/${wk.id}.json`;
  stats.weeks++;
  const n = wk.number;
  if (wk.id !== `${P}${String(n).padStart(2, '0')}`) err(W, 'id / number mismatch');
  for (const k of ['title', 'theme', 'question']) if (!isStr(wk[k])) err(W, `${k} missing`);
  if (!/\?$/.test((wk.question || '').trim())) err(W, 'question must end with ?');
  if (!SCHOOLS.includes(wk.school) || !isArr(wk.schools, 1) || !wk.schools.every((s) => SCHOOLS.includes(s))) err(W, 'school / schools invalid');
  const ov = checkBlocks(wk.overview, `${W} overview`); if (ov.words < 150) err(W, `overview only ${ov.words} words`);
  if (!isArr(wk.objectives, 4, 6)) err(W, 'objectives 4–6');
  const h = wk.hours || {}; const total = Object.values(h).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total < 5 || total > 7.5) err(W, `hours sum to ${total.toFixed(2)} (want 5–7)`);
  if (!isArr(wk.concepts, 8, 18)) err(W, 'concepts 8–18');
  const concepts = new Set();
  (wk.concepts || []).forEach((c) => { if (!/^c-[a-z0-9-]+$/.test(c.id || '')) err(W, `concept id ${c.id}`); if (!DOMAINS.includes(c.domain)) err(W, `concept ${c.id} domain`); concepts.add(c.id); if (conceptNames.has(c.id) && norm(conceptNames.get(c.id)) !== norm(c.name)) warn(W, `concept ${c.id} named differently elsewhere ("${conceptNames.get(c.id)}" vs "${c.name}")`); conceptNames.set(c.id, c.name); });
  if (!isArr(wk.lessons, 3, 5)) err(W, 'lessons 3–5');
  let executive = 0;
  (wk.lessons || []).forEach((l, i) => {
    const L = `${W} ${l.id}`;
    stats.lessons++;
    if (l.id !== `${wk.id}-l${i + 1}`) err(L, `lesson id should be ${wk.id}-l${i + 1}`);
    for (const k of ['title', 'summary', 'executive']) if (!isStr(l[k])) err(L, `${k} missing`);
    if (words(l.executive) < 60 || words(l.executive) > 150) warn(L, `executive brief is ${words(l.executive)} words (want 80–120)`);
    if (!(l.minutes >= 15 && l.minutes <= 75)) err(L, 'minutes 15–75');
    if (!isArr(l.objectives, 2, 4)) err(L, 'objectives 2–4');
    (l.concepts || []).forEach((c) => concepts.has(c) || err(L, `concept ${c} not declared in week concepts`));
    let lw = 0, diagrams = 0, foundation = 0, depth = 0;
    for (const s of ['explore', 'understand', 'challenge', 'apply', 'retain']) {
      if (!isArr(l.sections?.[s], 1)) { err(L, `section ${s} empty`); continue; }
      const st = checkBlocks(l.sections[s], `${L}.${s}`);
      lw += st.words; diagrams += st.diagrams; foundation += st.foundation; depth += st.depth; executive += st.executive;
    }
    stats.words += lw;
    if (lw < 1300) err(L, `lesson body has ${lw} words (min 1,300)`); else if (lw > 2600) warn(L, `lesson body has ${lw} words (target ≤ 2,300)`);
    if (!diagrams) err(L, 'needs at least one diagram block (table/matrix/flow/bars)');
    if (!foundation) err(L, 'needs a mode:foundation block');
    if (!depth) err(L, 'needs a depth block');
    if (!isArr(l.takeaways, 3, 5)) err(L, 'takeaways 3–5');
    if (!isArr(l.check, 2, 3)) err(L, 'check 2–3 questions');
    (l.check || []).forEach((q) => { checkQuestion(q, `${L} check`, { autoOnly: true, idPattern: new RegExp(`^${l.id}-c\\d$`) }); stats.checks++; });
    if (!isArr(l.sources, 2)) err(L, 'sources ≥ 2');
    (l.sources || []).forEach((s) => { noteRef(s.ref, L); if (!sources.has(s.ref)) err(L, `source ${s.ref} unknown`); if (!isStr(s.use)) err(L, `source ${s.ref} needs use`); });
    if (!isArr(l.crosslinks, 1, 4)) err(L, 'crosslinks 1–3');
    (l.crosslinks || []).forEach((c) => pendingLinks.push([L, c.to]));
  });
  if (executive < 2) err(W, `only ${executive} mode:executive blocks (need 2+)`);
  for (const kind of ['required', 'optional']) {
    const list = wk.readings?.[kind];
    if (!isArr(list, kind === 'required' ? 2 : 2, 5)) err(W, `readings.${kind} count`);
    (list || []).forEach((r) => { noteRef(r.ref, W); if (!sources.has(r.ref)) err(W, `reading ${r.ref} unknown`); if (!isStr(r.what) || !isStr(r.why) || !(r.minutes > 0)) err(W, `reading ${r.ref} needs what, why, minutes`); });
  }
  const resCount = new Set([...(wk.readings?.required || []), ...(wk.readings?.optional || [])].map((r) => r.ref)).size;
  if (resCount < 4) err(W, 'fewer than 4 distinct readings');
  if (!isArr(wk.glossary, 10, 24)) err(W, 'glossary 10–20 terms');
  stats.glossary += (wk.glossary || []).length;
  (wk.glossary || []).forEach((g) => { if (!/^g-[a-z0-9-]+$/.test(g.id || '') || !isStr(g.term) || !isStr(g.definition, 20)) err(W, `glossary ${g.id} incomplete`); else checkText(g.definition, `${W} ${g.id}`); });
  // exercise
  const x = wk.exercise || {};
  if (x.id !== `${wk.id}-x`) err(W, `exercise id should be ${wk.id}-x`);
  if (!LABS.includes(x.lab)) err(W, `exercise.lab "${x.lab}"`);
  if (!ENGINES.includes(x.engine)) err(W, `exercise.engine "${x.engine}"`); else checkEngine(x.engine, x.config, `${W} exercise`);
  checkBlocks(x.intro, `${W} exercise.intro`); checkBlocks(x.debrief, `${W} exercise.debrief`);
  if (!isArr(x.assumptions, 2)) err(W, 'exercise.assumptions 2+');
  // case, quiz, assignment
  if (wk.case?.id !== `${wk.id}-case`) err(W, `case id should be ${wk.id}-case`);
  checkCase(wk.case, `${W} case`); stats.cases++;
  const q = wk.quiz || {};
  if (q.id !== `${wk.id}-quiz`) err(W, 'quiz id');
  if (!isArr(q.questions, 10, 12)) err(W, `quiz has ${(q.questions || []).length} questions (10–12)`);
  const types = new Set((q.questions || []).map((x) => x.type));
  if (types.size < 6) err(W, `quiz uses ${types.size} question types (need 6+)`);
  if (!(q.questions || []).some((x) => x.type === 'short')) err(W, 'quiz needs a short response');
  if ((q.questions || []).filter((x) => AUTO.includes(x.type)).length < 8) err(W, 'quiz needs 8+ auto-gradable questions');
  (q.questions || []).forEach((x) => { checkQuestion(x, `${W} quiz`, { idPattern: new RegExp(`^${wk.id}-q\\d{2}$`) }); stats.quizQuestions++; });
  const lessonsCovered = new Set((q.questions || []).map((x) => x.lesson));
  (wk.lessons || []).forEach((l) => lessonsCovered.has(l.id) || err(W, `quiz has no question on ${l.id}`));
  if (!isArr(q.reserve, 4, 6)) err(W, 'quiz.reserve needs 4 questions');
  (q.reserve || []).forEach((x) => checkQuestion(x, `${W} reserve`, { autoOnly: true, idPattern: new RegExp(`^${wk.id}-rs\\d$`) }));
  if (wk.assignment?.id !== `${wk.id}-as`) err(W, 'assignment id');
  checkAssignment(wk.assignment, `${W} assignment`);
  if (!isArr(wk.reflection?.prompts, 3, 4)) err(W, 'reflection prompts 3–4');
  if (!isArr(wk.review, 12, 18)) err(W, 'review cards 12–16');
  stats.review += (wk.review || []).length;
  (wk.review || []).forEach((r, i) => { if (r.id !== `${wk.id}-sr${String(i + 1).padStart(2, '0')}`) err(W, `review id ${r.id}`); if (!isStr(r.front) || !isStr(r.back) || !concepts.has(r.concept) || !lessonIds.has(r.lesson)) err(W, `review ${r.id} needs front, back, a week concept and lesson`); });
  if (!isStr(wk.preview?.text) || !isArr(wk.preview?.links, 1)) err(W, 'preview text + links');
  // question concept coverage
  const qs = [...(q.questions || []), ...(q.reserve || []), ...(wk.lessons || []).flatMap((l) => l.check || [])];
  stats.questions += qs.length;
  qs.forEach((x) => (x.concepts || []).forEach((c) => concepts.has(c) || conceptNames.has(c) || warn(W, `${x.id} concept ${c} not declared`)));
  // kind balance
  const kinds = {}; (wk.lessons || []).forEach((l) => Object.values(l.sections || {}).forEach((b) => merge(kinds, checkBlocksQuiet(b))));
  if (!kinds.established) err(W, 'no established blocks');
  if (!kinds.contested) warn(W, 'no contested blocks this week — is nothing in this field contested?');
  if (!kinds.application) err(W, 'no application blocks');
}
function checkBlocksQuiet(blocks) {
  const k = {};
  (function walk(bs) { (bs || []).forEach((b) => { if (b.kind) k[b.kind] = (k[b.kind] || 0) + 1; if (b.blocks) walk(b.blocks); }); })(blocks);
  return k;
}

/* ---------------- diagnostic / midterm / capstone / audit / labs ---------------- */
function want(name) { return !ONLY_WEEK && (!ONLY || ONLY === name) && !(COURSE === 'b' && ['midterm', 'capstone', 'audit'].includes(name)); } // Course B has none yet

if (want('diagnostic')) {
  const d = readJSON('diagnostic.json');
  if (d === undefined) (STRICT ? err : warn)('diagnostic.json', 'missing');
  else if (d) {
    checkBlocks(d.intro, 'diagnostic intro');
    if (!isArr(d.questions, 27, 40)) err('diagnostic.json', 'needs 27–36 questions');
    (d.questions || []).forEach((q) => checkQuestion(q, 'diagnostic', { autoOnly: true, idPattern: /^dg-\d{2}$/ }));
    for (const dom of DOMAINS) {
      const n = (d.questions || []).filter((q) => q.domain === dom).length;
      if (n < 3) err('diagnostic.json', `domain ${dom} has ${n} questions (need 3+)`);
      const it = d.interpretation?.[dom];
      if (!it || !isStr(it.strong) || !isStr(it.developing) || !isStr(it.foundation) || !isArr(it.lessons, 1)) err('diagnostic.json', `interpretation.${dom} needs strong, developing, foundation, lessons`);
      else it.lessons.forEach((l) => pendingLinks.push([`diagnostic ${dom}`, l]));
    }
  }
}
if (want('midterm')) {
  const m = readJSON('midterm.json');
  if (m === undefined) (STRICT ? err : warn)('midterm.json', 'missing');
  else if (m) {
    if (m.id !== 'midterm') err('midterm.json', 'id must be midterm');
    checkBlocks(m.intro, 'midterm intro');
    checkCase(m.case, 'midterm case', 1200);
    if (!isArr(m.questions, 16, 24)) err('midterm.json', 'needs 16–22 questions');
    (m.questions || []).forEach((q) => checkQuestion(q, 'midterm', { idPattern: /^mt-\d{2}$/ }));
    if ((m.questions || []).filter((q) => q.type === 'short').length < 2) err('midterm.json', 'needs 2+ short responses');
    if (new Set((m.questions || []).map((q) => q.type)).size < 7) err('midterm.json', 'needs 7+ question types');
    if (!isArr(m.reserve, 6, 10)) err('midterm.json', 'reserve needs 6+ questions');
    (m.reserve || []).forEach((q) => checkQuestion(q, 'midterm reserve', { autoOnly: true, idPattern: /^mt-rs\d{1,2}$/ }));
  }
}
if (want('capstone')) {
  const c = readJSON('capstone.json');
  if (c === undefined) (STRICT ? err : warn)('capstone.json', 'missing');
  else if (c) {
    for (const k of ['id', 'title', 'fiction']) if (!isStr(c[k])) err('capstone.json', `${k} missing`);
    const s = checkBlocks(c.scenario, 'capstone scenario'); if (s.words < 900) err('capstone.json', `scenario ${s.words} words (min 900)`);
    (c.exhibits || []).forEach((e, i) => { if (!/synthetic/i.test(e.note || '')) err('capstone.json', `exhibit ${i} note must say Synthetic`); });
    if (!isArr(c.components, 18, 18)) err('capstone.json', 'needs exactly 18 components');
    const compIds = new Set();
    (c.components || []).forEach((k, i) => {
      const w = `capstone ${k.id}`; compIds.add(k.id);
      if (k.id !== `k${String(i + 1).padStart(2, '0')}` || k.number !== i + 1) err(w, 'id/number sequence');
      if (!isStr(k.title) || !(k.week >= 1 && k.week <= 14) || !isArr(k.draws, 1) || !isArr(k.prompts, 2) || !isArr(k.template, 2)) err(w, 'needs title, week, draws, prompts, template');
      checkBlocks(k.guidance, `${w}.guidance`);
      if (!isArr(k.words, 2, 2)) err(w, 'words [min,max]');
    });
    if (!isArr(c.deliverables, 7, 7)) err('capstone.json', 'needs the 7 deliverables');
    (c.deliverables || []).forEach((d) => { (d.components || []).forEach((k) => compIds.has(k) || err('capstone.json', `deliverable ${d.id} → unknown component ${k}`)); checkRubric(d.rubric, `capstone deliverable ${d.id}`); });
    if (c.tools?.orgdesign) checkEngine('orgdesign', c.tools.orgdesign, 'capstone tools.orgdesign');
    if (c.tools?.allocation) checkEngine('allocation', c.tools.allocation, 'capstone tools.allocation');
    if (!isArr(c.milestones, 4)) err('capstone.json', 'milestones 4+');
  }
}
if (want('audit')) {
  const a = readJSON('audit.json');
  if (a === undefined) (STRICT ? err : warn)('audit.json', 'missing');
  else if (a) {
    checkBlocks(a.method, 'audit method');
    if (!isArr(a.criteria, 4)) err('audit.json', 'criteria 4+');
    if (!isArr(a.programs, 15)) err('audit.json', 'needs 15+ programs');
    (a.programs || []).forEach((p) => {
      const w = `audit ${p.id}`;
      if (!/^P-[a-z0-9-]+$/.test(p.id || '')) err(w, 'id P-…');
      for (const k of ['name', 'institution', 'summary', 'limitations']) if (!isStr(p[k])) err(w, `${k} missing`);
      if (!['phd', 'mba', 'jdmba'].includes(p.category)) err(w, 'category phd|mba|jdmba');
      if (!/^https:\/\//.test(p.url || '')) err(w, 'url https');
      if (!STATUS.includes(p.verified?.status)) err(w, 'verified.status');
      if (!isArr(p.informs, 1)) err(w, 'informs (weeks) required');
    });
    if (!isArr(a.oer, 3)) err('audit.json', 'oer 3+');
    (a.oer || []).forEach((o) => { noteRef(o.ref, 'audit oer'); if (!sources.has(o.ref)) err('audit.json', `oer ref ${o.ref} not in sources`); if (!isStr(o.note)) err('audit.json', `oer ${o.ref} note`); });
    (a.mapping || []).forEach((m) => { if (!/^w\d{2}$/.test(m.week || '') || !isArr(m.programs, 1) || !isStr(m.how)) err('audit.json', `mapping ${m.week} needs week, programs, how`); });
    if (!isArr(a.mapping, 14, 14)) err('audit.json', 'mapping needs one row per week (14)');
    checkBlocks(a.synthesis, 'audit synthesis');
    if (!isStr(a.disclaimer)) err('audit.json', 'disclaimer required');
  }
}

// cross-links resolve
for (const [where, target] of pendingLinks) {
  if (/^[wb]\d{2}$/.test(target)) { if (target[0] !== P) { err(where, `link to another course's week ${target}`); continue; } if (!weekIds.has(target) && STRICT && !(REQUIRED_WEEKS && !REQUIRED_WEEKS.has(Number(target.slice(1))))) err(where, `link to missing week ${target}`); continue; }
  if (/^[wb]\d{2}-l\d$/.test(target)) {
    const wk = target.slice(0, 3);
    if (target[0] !== P) { err(where, `link to another course's lesson ${target}`); continue; }
    if (lessonIds.has(target)) continue;
    if (weekIds.has(wk)) err(where, `link to unknown lesson ${target}`);
    else (STRICT ? err : warn)(where, `link to ${target} (week not written yet)`);
    continue;
  }
  if (target.startsWith('gl:')) { if (!glossaryIds.has(target.slice(3)) && STRICT) err(where, `unknown glossary term ${target}`); continue; }
  err(where, `unrecognized link target #${target}`);
}

// unused sources (only meaningful on full runs)
if (!ONLY_WEEK && !ONLY) for (const id of sources.keys()) if (!usedRefs.has(id)) warn(`sources ${id}`, 'never cited');

if (!QUIET) {
  if (warnings.length) console.warn(`⚠ ${warnings.length} warning(s):\n  ` + warnings.slice(0, 200).join('\n  '));
  console.log(`weeks ${stats.weeks} · lessons ${stats.lessons} · lesson words ${stats.words.toLocaleString('en-US')} · quiz questions ${stats.quizQuestions} · all questions ${stats.questions} · checks ${stats.checks} · review cards ${stats.review} · glossary ${stats.glossary} · sources ${sources.size}`);
}
if (errors.length) {
  console.error(`✖ ${errors.length} error(s):\n  ` + errors.slice(0, 300).join('\n  '));
  process.exit(1);
}
console.log('✓ APERTURE content valid');
