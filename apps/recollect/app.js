'use strict';
/* =====================================================================
   RECOLLECT — application code (v2, single-file edition: all icons and
   assets embedded; no manifest, launch screens or offline cache)
   Data compatibility: the IndexedDB database keeps its original name
   ("memory-bank"), stores and record shape, and the backup format keeps its
   original identifier, so V1 data and backups load unchanged.
   Sections:
     1. Configuration & constants
     2. Utilities
     3. Approximate-date parsing
     4. Storage (IndexedDB)
     5. Memory model
     6. Search & related memories
     7. AI entry parser
     8. Export, backup & restore
     9. Voice dictation
    10. UI helpers (dialog, toast, chip inputs)
    11. Views
    12. Router & startup
   ===================================================================== */

/* ---------- 1. Configuration & constants ---------- */
const APP = { name: 'Recollect', version: '3.0.0', schemaVersion: 1, dbName: 'memory-bank', dbVersion: 2 }; // dbName is intentionally unchanged from V1; v2 adds the versions store
const TAGLINE = 'Your experience. Within reach.';

const DEFAULT_THEMES = [
  'Leadership & Management', 'Player Development', 'Staff Development & Mentorship',
  'Personnel & Hiring Decisions', 'Organizational Challenges', 'Projects & Initiatives',
  'Strategy & Decision-Making', 'Accomplishments & Results', 'Relationships & Conversations',
  'Mistakes & Lessons Learned', 'Career Development', 'Personal Reflections'
];

const DEFAULT_COMPETENCIES = [
  'Building a process from scratch', 'Developing staff members', 'Handling personnel challenges',
  'Leading without formal authority', 'Collaborating across departments',
  'Identifying and correcting organizational inefficiencies', 'Making difficult decisions', 'Learning from mistakes'
];

// One group per line. Searching any word in a group also finds the others (ranked lower).
const DEFAULT_SYNONYMS = [
  'DR, Dominican, Dominican Republic, DSL',
  'hire, hiring, recruit, candidate, interview',
  'decision, decide, choice',
  'difficult, hard, tough, challenging',
  'staff, coaches, coaching staff',
  'communication, communicate, conversation, dialogue',
  'mistake, error, misstep',
  'mentor, mentorship, mentoring'
].join('\n');

const CONFIDENCE = { confirmed: 'Confirmed', approximate: 'Approximate', uncertain: 'Uncertain' };
const STATUS = { resolved: 'Resolved', ongoing: 'Ongoing', reflective: 'Reflective' };
const SOURCE = { quick: 'Quick capture', ai: 'AI-assisted entry', guided: 'Worked through', manual: 'Written in editor', import: 'Imported' };

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = MONTH_NAMES.map(m => m.slice(0, 3));

const INTAKE_PROMPT = `RECOLLECT INTAKE PROMPT (v2)

You are helping me document a professional memory for Recollect, my private archive of my career experiences. Your job is to help me remember and organize what happened, not to embellish it.

HOW TO WORK WITH ME
1. Start by asking what I'd like to remember. Let me tell it my own way first.
2. Then ask follow-up questions, one or two at a time, to help me reconstruct the experience. Useful angles:
   - Roughly when did this happen? (A season, a year, or "around" is fine.)
   - Where was I working, and which team, department, or project was this part of?
   - Who was involved, and what were their roles?
   - What led up to it?
   - What did I personally do, decide, or say?
   - Was there a decision, conflict, or particular challenge?
   - What happened afterward? Is it resolved, still ongoing, or mostly a reflection?
   - Why does it stand out to me? What did I learn, or what would I do differently?
   - Is there anything I'm unsure about that I should verify later?
3. Stop when I say I'm done, or after roughly 6-10 questions. Don't interrogate me, and skip anything I don't remember.

RULES
- Never invent details. Use only what I told you.
- Keep my uncertainty visible. If I said "I think," "around," or "maybe," keep that qualification. List anything uncertain under Uncertain Details.
- If I didn't provide something, leave that field empty (nothing after the colon). Don't fill gaps with guesses or "N/A".
- Not every memory is an accomplishment. Ongoing, unresolved, or purely reflective memories are fine; say so in Status.
- Write Narrative, My Involvement, Outcome and Lessons in the first person ("I..."), in plain professional language.
- Original Recollection should be my own words from this conversation, lightly cleaned up (remove filler, keep my phrasing).

OUTPUT
When we're finished, produce the entry in EXACTLY this format inside one code block so I can copy it. Keep every label, in this order, even when a value is empty. Each label must start at the beginning of a line. Do not use bold or bullets on the labels.

=== RECOLLECT ENTRY ===
Title: [concise description, under 80 characters]
When: [e.g. "July 2024", "Summer 2023", "around 2019", "2022-03-14", "2021 to 2023"; empty if unknown]
People: [names only, separated by semicolons]
People Roles: [optional, e.g. "Dana Whitlock - pitching coordinator; Luis Fermin - academy pitching coach"]
Organization: [company, team, or organization]
Project: [project or initiative name, if any]
Themes: [1-3 of these, separated by semicolons: Leadership & Management; Player Development; Staff Development & Mentorship; Personnel & Hiring Decisions; Organizational Challenges; Projects & Initiatives; Strategy & Decision-Making; Accomplishments & Results; Relationships & Conversations; Mistakes & Lessons Learned; Career Development; Personal Reflections]
Tags: [3-8 specific searchable keywords, separated by semicolons]
Confidence: [confirmed / approximate / uncertain]
Status: [resolved / ongoing / reflective]
Story Bank: [yes / no; yes if this would make a good interview or professional example]
Story Competencies: [if yes, any that apply, separated by semicolons: Building a process from scratch; Developing staff members; Handling personnel challenges; Leading without formal authority; Collaborating across departments; Identifying and correcting organizational inefficiencies; Making difficult decisions; Learning from mistakes]
Story Headline: [if yes, one sentence I could use to introduce this story]
Original Recollection:
[my words]
Narrative:
[a coherent account of what happened, in order]
My Involvement:
[what I personally did or contributed]
Outcome:
[what resulted, or "Still unfolding" if ongoing]
Lessons:
[what I learned or would do differently]
Uncertain Details:
[anything I wasn't sure about or should verify]
Supporting Information:
[documents, links, quotes, or numbers I mentioned]
=== END ENTRY ===

If I describe more than one distinct memory, produce a separate entry for each, one after another.

Now begin by asking me what I'd like to remember.`;

const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

/* ---------- 2. Utilities ---------- */
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nowISO = () => new Date().toISOString();
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const clone = o => JSON.parse(JSON.stringify(o));
const isBlank = v => !v || !String(v).trim();

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function uniqCI(arr) {
  const seen = new Set(); const out = [];
  for (const v of arr) { const s = String(v ?? '').trim(); const k = norm(s); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMonthYear(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }); }
function daysSince(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity; }
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s; }
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'memory'; }
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
function loadLocal(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function saveLocal(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }
function splitList(v) {
  if (Array.isArray(v)) return v;
  const s = String(v || '').trim(); if (!s) return [];
  const parts = /[;\n]/.test(s) ? s.split(/\s*[;\n]\s*/) : s.split(/\s*,\s*/);
  return parts.map(p => p.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}
function autoTitle(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/^(so,?\s+|ok(ay)?,?\s+|um,?\s+)+/i, '')
       .replace(/^i\s+(remember|recall)\s+(when|that|how|the time)?\s*/i, '')
       .replace(/^there\s+was\s+(a|this|that)\s+time\s+(when\s+)?/i, '');
  const m = s.match(/^.*?[.!?](\s|$)/);
  let t = (m ? m[0] : s).trim().replace(/[.!?]+$/, '');
  if (t.length > 72) t = t.slice(0, 72).replace(/\s+\S*$/, '') + '…';
  return cap(t);
}

/* ---------- 3. Approximate-date parsing ----------
   Accepts how people actually remember dates: "July 2024", "summer 2023",
   "spring training 2022", "early 2021", "around 2019", "2022-03-14",
   "3/14/2022", "Q2 2023", "2021 to 2023". Text that can't be read as a
   date is kept exactly as written (it just won't sort on the timeline). */
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const validYear = y => y >= 1900 && y <= 2100;
const SEASONS = {
  'spring training': [2, 3, 'Spring training'], spring: [3, 5, 'Spring'], summer: [6, 8, 'Summer'],
  fall: [9, 11, 'Fall'], autumn: [9, 11, 'Fall'], winter: [1, 3, 'Winter'], offseason: [10, 12, 'Offseason']
};
const PARTS = { early: [1, 4, 'Early'], mid: [5, 8, 'Mid'], middle: [5, 8, 'Mid'], late: [9, 12, 'Late'] };

function monthFromWord(w) {
  if (!w || w.length < 3) return 0;
  w = w.toLowerCase(); if (w === 'sept') return 9;
  const i = MONTH_NAMES.findIndex(n => n.toLowerCase().startsWith(w));
  return i + 1;
}

function parseOne(raw) {
  let s = norm(raw).replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let approx = false;
  if (s.startsWith('~')) { approx = true; s = s.slice(1).trim(); }
  const AP = /(^|\s)(about|around|approximately|approx\.?|circa|c\.|ca\.?|roughly|maybe|probably|possibly|sometime|somewhere|i think|i believe)(?=\s|$)/g;
  if (AP.test(s)) { approx = true; s = s.replace(AP, ' '); }
  s = s.replace(/(^|\s)(in|of|during|the|on|at)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const out = (y1, m1, d1, y2, m2, d2, precision, label, ap = false) => {
    if (!validYear(y1) || !validYear(y2) || m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return null;
    if (d1 < 1 || d1 > lastDay(y1, m1) || d2 < 1 || d2 > lastDay(y2, m2)) return null;
    return { start: `${y1}-${pad(m1)}-${pad(d1)}`, end: `${y2}-${pad(m2)}-${pad(d2)}`, precision, label, approx: approx || ap };
  };
  const day = (y, mo, d) => out(y, mo, d, y, mo, d, 'day', `${MONTH_NAMES[mo - 1]} ${d}, ${y}`);
  const month = (y, mo, ap) => (mo >= 1 && mo <= 12) ? out(y, mo, 1, y, mo, lastDay(y, mo), 'month', `${MONTH_NAMES[mo - 1]} ${y}`, ap) : null;
  let m;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return day(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) return month(+m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { let y = +m[3]; if (y < 100) y += 2000; return day(y, +m[1], +m[2]); }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return month(+m[2], +m[1]);
  if ((m = s.match(/^([a-z]+) (\d{1,2}) (\d{4})$/))) { const mo = monthFromWord(m[1]); if (mo) return day(+m[3], mo, +m[2]); }
  if ((m = s.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/))) { const mo = monthFromWord(m[2]); if (mo) return day(+m[3], mo, +m[1]); }
  if ((m = s.match(/^(early|mid|middle|late) ([a-z]+) (\d{4})$/))) {
    const mo = monthFromWord(m[2]);
    if (mo) { const r = month(+m[3], mo, true); if (r) r.label = `${cap(m[1] === 'middle' ? 'mid' : m[1])} ${r.label}`; return r; }
    const se = SEASONS[m[2]];
    if (se) { const y = +m[3]; return out(y, se[0], 1, y, se[1], lastDay(y, se[1]), 'season', `${cap(m[1] === 'middle' ? 'mid' : m[1])} ${se[2].toLowerCase()} ${y}`, true); }
  }
  if ((m = s.match(/^([a-z]+(?: training)?) (\d{4})$/))) {
    const w = m[1], y = +m[2];
    const mo = w.includes(' ') ? 0 : monthFromWord(w);
    if (mo) return month(y, mo);
    const se = SEASONS[w]; if (se) return out(y, se[0], 1, y, se[1], lastDay(y, se[1]), 'season', `${se[2]} ${y}`);
    const pt = PARTS[w]; if (pt) return out(y, pt[0], 1, y, pt[1], lastDay(y, pt[1]), 'season', `${pt[2]} ${y}`, true);
  }
  if ((m = s.match(/^q([1-4]) (\d{4})$/))) { const q = +m[1], y = +m[2]; return out(y, q * 3 - 2, 1, y, q * 3, lastDay(y, q * 3), 'season', `Q${q} ${y}`); }
  if ((m = s.match(/^(\d{4})$/))) return out(+m[1], 1, 1, +m[1], 12, 31, 'year', m[1]);
  return null;
}

function parseWhen(text) {
  const t = String(text || '').trim(); if (!t) return null;
  const one = parseOne(t); if (one) return one;
  const s = t.replace(/^\s*(between|from)\s+/i, '');
  const m = norm(s).match(/^~?\s*(\d{4})\s*[-–—/]\s*(\d{2}|\d{4})$/);
  if (m) {
    const y1 = +m[1]; const y2 = m[2].length === 2 ? +(m[1].slice(0, 2) + m[2]) : +m[2];
    if (y2 >= y1 && validYear(y1) && validYear(y2)) return { start: `${y1}-01-01`, end: `${y2}-12-31`, precision: 'range', label: `${y1} – ${y2}`, approx: /~|about|around/i.test(t) };
  }
  const parts = s.split(/\s+(?:to|through|thru|until|till|and)\s+|\s*[–—]\s*|\s+-\s+/i);
  if (parts.length === 2) {
    const a = parseOne(parts[0]), b = parseOne(parts[1]);
    if (a && b && b.end >= a.start) return { start: a.start, end: b.end, precision: 'range', label: `${a.label} – ${b.label}`, approx: a.approx || b.approx };
  }
  return null;
}
function buildEventDate(text, approx) {
  const t = String(text || '').trim(); if (!t) return null;
  const p = parseWhen(t);
  return p ? { text: t, ...p, approx: !!approx || p.approx } : { text: t, start: null, end: null, precision: 'text', label: t, approx: !!approx };
}
function whenShort(ev) { if (!ev) return ''; return ev.start ? (ev.approx ? '~' : '') + ev.label : ev.text; }
function whenLong(ev) { if (!ev) return ''; return ev.start ? ev.label + (ev.approx ? ' (approximate)' : '') : `“${ev.text}”`; }

/* ---------- 4. Storage (IndexedDB) ----------
   Stores: memories (one record per memory), meta (settings and sync state),
   tombstones (deleted memories: the id, when, and a copy of the memory so it can be
   restored from Recently deleted until it is deleted permanently), versions (earlier
   versions of edited memories). With cloud storage set up, this is the device's copy;
   the cloud copy is the one that lasts (see section 4b). */
const Store = {
  db: null,
  async open() {
    if (!('indexedDB' in window)) return;
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(APP.dbName, APP.dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'key' }).createIndex('id', 'id');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
    } catch (e) { console.warn('IndexedDB unavailable', e); this.db = null; }
  },
  _run(store, mode, fn) {
    if (!this.db) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const r = fn(os);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  getAll(store) { return this._run(store, 'readonly', os => os.getAll()).then(r => r || []); },
  getByIndex(store, index, key) { return this._run(store, 'readonly', os => os.index(index).getAll(key)).then(r => r || []); },
  get(store, key) { return this._run(store, 'readonly', os => os.get(key)); },
  put(store, obj) { return this._run(store, 'readwrite', os => os.put(obj)); },
  putMany(store, arr) { return this._run(store, 'readwrite', os => { arr.forEach(o => os.put(o)); }); },
  del(store, key) { return this._run(store, 'readwrite', os => os.delete(key)); },
  delMany(store, keys) { return this._run(store, 'readwrite', os => { keys.forEach(k => os.delete(k)); }); },
  clear(store) { return this._run(store, 'readwrite', os => os.clear()); }
};

async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not supported */ }
}

/* ---------- 5. Memory model ---------- */
const S = {
  memories: [], tombstones: [], settings: null, index: null, syn: new Map(),
  dirty: false, suppress: false, prevHash: '', navCount: 0,
  draftNew: null, importQueue: [], importTotal: 0, guided: null
};

function defaultSettings() {
  return {
    key: 'settings', themes: [...DEFAULT_THEMES], competencies: [...DEFAULT_COMPETENCIES], synonyms: DEFAULT_SYNONYMS,
    deviceId: uid(), lastBackupAt: null, welcomed: false, voiceNoticeShown: false
  };
}
async function saveSettings() { await Store.put('meta', S.settings); Sync.noteSettings(); }

function blankMemory() {
  const t = nowISO();
  return {
    id: uid(), schemaVersion: APP.schemaVersion,
    title: '', titleAuto: false, eventDate: null,
    people: [], organization: '', project: '', themes: [], tags: [],
    original: '', narrative: '', involvement: '', outcome: '', lessons: '', uncertainties: '', supporting: '',
    confidence: '', status: '',
    story: { starred: false, competencies: [], headline: '' },
    needsReview: false, source: 'manual', sample: false, archived: false,
    createdAt: t, updatedAt: t, rev: 1, deviceId: S.settings ? S.settings.deviceId : ''
  };
}

const TEXT_FIELDS = ['title', 'organization', 'project', 'original', 'narrative', 'involvement', 'outcome', 'lessons', 'uncertainties', 'supporting'];
function validISO(v) { return typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null; }

// Coerces anything (old versions, imports, AI JSON) into the current shape.
function normalizeMemory(x) {
  x = x || {};
  const m = blankMemory();
  // Ids end up in links and attributes, so only plain ids are kept (a crafted backup can't inject markup).
  if (typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.id.trim())) m.id = x.id.trim();
  for (const k of TEXT_FIELDS) m[k] = x[k] == null ? '' : String(x[k]).trim();
  for (const k of ['people', 'themes', 'tags']) m[k] = uniqCI(splitList(x[k] || []).map(String));
  let ev = x.eventDate ?? x.when ?? null;
  if (typeof ev === 'string') ev = buildEventDate(ev, false);
  else if (ev && typeof ev === 'object') {
    if (!ev.start && (ev.text || ev.label)) ev = buildEventDate(ev.text || ev.label, !!ev.approx);
    else if (ev.start) ev = { text: String(ev.text || ev.label || ''), start: ev.start, end: ev.end || ev.start, precision: ev.precision || 'day', label: ev.label || ev.text || ev.start, approx: !!ev.approx };
    else ev = null;
  } else ev = null;
  m.eventDate = ev;
  const st = x.story || {};
  m.story = { starred: !!(st.starred ?? x.storyBank), competencies: uniqCI(splitList(st.competencies || [])), headline: String(st.headline || '').trim() };
  m.confidence = CONFIDENCE[x.confidence] ? x.confidence : '';
  m.status = STATUS[x.status] ? x.status : '';
  m.source = SOURCE[x.source] ? x.source : 'manual';
  m.createdAt = validISO(x.createdAt) || m.createdAt;
  m.updatedAt = validISO(x.updatedAt) || m.createdAt;
  m.rev = Number(x.rev) || 1;
  m.deviceId = String(x.deviceId || m.deviceId);
  m.sample = !!x.sample; m.needsReview = !!x.needsReview; m.titleAuto = !!x.titleAuto; m.archived = !!x.archived;
  // Keep any fields added by a future version so they survive a round trip.
  const extra = { ...x }; delete extra.when; delete extra.storyBank;
  return { ...extra, ...m };
}

const byId = id => S.memories.find(m => m.id === id);
// Memories in everyday use. Archived ones stay searchable from Memories (Show: Archived) and by link.
const live = () => S.memories.filter(m => !m.archived);
function hasContent(m) { return ['title', 'original', 'narrative', 'involvement', 'outcome', 'lessons'].some(k => !isBlank(m[k])); }
function contentKey(m) { const c = clone(m); ['createdAt', 'updatedAt', 'rev', 'deviceId'].forEach(k => delete c[k]); return JSON.stringify(c); }
function fingerprint(m) { return norm(m.title).replace(/[^a-z0-9]/g, '') + '|' + norm(m.original || m.narrative).replace(/[^a-z0-9]/g, '').slice(0, 160); }

async function saveMemory(m, { touch = true } = {}) {
  const prev = byId(m.id);
  // An edit never destroys the earlier text: the version it replaces goes into the history.
  if (touch && prev && contentKey(prev) !== contentKey(m)) await Versions.add(prev, 'edit');
  if (touch) { m.updatedAt = nowISO(); m.rev = (m.rev || 0) + 1; m.deviceId = S.settings.deviceId; }
  const i = S.memories.findIndex(x => x.id === m.id);
  if (i >= 0) S.memories[i] = m; else S.memories.push(m);
  // Add any new themes to the master list
  const known = new Set(S.settings.themes.map(norm));
  const newThemes = m.themes.filter(t => !known.has(norm(t)));
  if (newThemes.length) { S.settings.themes.push(...newThemes); await saveSettings(); }
  await Store.put('memories', m);
  const ti = S.tombstones.findIndex(t => t.id === m.id);
  if (ti >= 0) { S.tombstones.splice(ti, 1); await Store.del('tombstones', m.id); }
  buildIndex();
  requestPersistence();
  Sync.mark([m]);
  return m;
}
async function saveMany(list) {
  for (const m of list) {
    const i = S.memories.findIndex(x => x.id === m.id);
    if (i >= 0) { if (contentKey(S.memories[i]) !== contentKey(m)) await Versions.add(S.memories[i], 'edit'); S.memories[i] = m; } else S.memories.push(m);
  }
  await Store.putMany('memories', list);
  const ids = new Set(list.map(m => m.id)), back = S.tombstones.filter(t => ids.has(t.id)).map(t => t.id);
  if (back.length) { S.tombstones = S.tombstones.filter(t => !ids.has(t.id)); await Store.delMany('tombstones', back); }
  buildIndex();
  Sync.mark(list);
}
// Deleting moves a memory to Recently deleted (a tombstone that keeps a copy), so it can be restored.
// Fictional samples are simply removed.
async function deleteMemory(id, { tombstone = true } = {}) {
  const m = byId(id);
  S.memories = S.memories.filter(x => x.id !== id);
  await Store.del('memories', id);
  if (tombstone && m) {
    const t = { id, deletedAt: nowISO(), deviceId: S.settings.deviceId, memory: m };
    S.tombstones = S.tombstones.filter(x => x.id !== id).concat(t); await Store.put('tombstones', t);
    Sync.markIds([id]);
  }
  buildIndex();
}
const trash = () => S.tombstones.filter(t => t.memory).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
async function restoreFromTrash(id) {
  const t = S.tombstones.find(x => x.id === id && x.memory); if (!t) return null;
  const m = normalizeMemory(t.memory);
  await saveMemory(m);       // counts as an edit (so it wins over the deletion everywhere); also removes the tombstone
  return m;
}
async function purgeFromTrash(ids) {
  const set = new Set(ids);
  S.tombstones = S.tombstones.map(t => set.has(t.id) ? { id: t.id, deletedAt: t.deletedAt, deviceId: t.deviceId, purged: true } : t);
  await Store.putMany('tombstones', S.tombstones.filter(t => set.has(t.id)));
  await Store.delMany('versions', (await Promise.all(ids.map(id => Versions.list(id)))).flat().map(v => v.key));
  Sync.markIds(ids);
}

/* Earlier versions of a memory, kept on this device (the cloud keeps its own, shared by every device). */
const Versions = {
  KEEP: 30,
  async add(m, reason) {
    if (!Store.db || !m || m.sample) return;
    const v = { key: `${m.id}:${m.rev}:${m.updatedAt}`, id: m.id, rev: m.rev, savedAt: m.updatedAt, replacedAt: nowISO(), reason, data: clone(m) };
    await Store.put('versions', v);
    const all = await this.list(m.id);
    if (all.length > this.KEEP) await Store.delMany('versions', all.slice(this.KEEP).map(x => x.key));
  },
  async list(id) { return (await Store.getByIndex('versions', 'id', id)).sort((a, b) => b.replacedAt.localeCompare(a.replacedAt)); }
};


/* ---------- 4b. Cloud storage & sync ----------
   When cloud storage is set up (a Cloudflare D1 database behind Cloudflare Access, see
   functions/apps/recollect/api), the cloud holds the lasting copy of every memory and each
   device keeps a working copy in IndexedDB, so Recollect opens instantly and keeps working
   offline. Every change is saved on the device first, then sent up; changes made on other
   devices come down when the app opens, regains focus, and every minute while it's open.
   A conflict never loses text: the later edit becomes current and the other one is kept in
   the version history. Without cloud storage, Recollect works on this device alone, as before. */
const Sync = {
  API: 'api/',
  state: 'starting',   // starting · local (no server here) · unconfigured · signed-out · syncing · synced · offline · error · other-account
  message: '', user: '', firstPull: false, running: false, again: false, timer: null, failures: 0, rejected: {},
  meta: { key: 'sync', owner: '', cursor: 0, srv: {}, pending: {}, localHash: '', localAt: '', settingsHash: '', settingsInit: false, lastSyncAt: '' },

  on() { return !!this.meta.owner && ['syncing', 'synced', 'offline', 'error'].includes(this.state); },
  pendingCount() { return Object.keys(this.meta.pending).length + (this.settingsPayload() ? 1 : 0); },
  saveMeta() { return Store.db ? Store.put('meta', this.meta).catch(() => {}) : Promise.resolve(); },

  async api(path, opts = {}) {
    let res;
    try {
      res = await fetch(this.API + path, { method: opts.method || 'GET', body: opts.body, credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
        headers: { 'X-Recollect': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
    } catch { throw Object.assign(new Error('Can’t reach the cloud right now.'), { kind: 'offline' }); }
    // Cloudflare Access answers a request without a valid sign-in with a redirect to its login page.
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw Object.assign(new Error('Sign in to continue.'), { kind: 'signed-out' });
    const isJSON = /json/i.test(res.headers.get('Content-Type') || '');
    if (!isJSON) throw Object.assign(new Error(res.status === 404 ? 'No cloud storage at this address.' : `The cloud answered ${res.status}.`), { kind: res.status === 404 ? 'local' : 'error' });
    let data = {};
    try { data = await res.json(); } catch { throw Object.assign(new Error('The cloud sent an unreadable reply.'), { kind: 'error' }); }
    if (res.status === 503 && data.error === 'not_configured') throw Object.assign(new Error(data.message || ''), { kind: 'unconfigured' });
    if (!res.ok) throw Object.assign(new Error(data.message || 'The cloud couldn’t complete the request.'), { kind: 'error' });
    return data;
  },

  async init() {
    const saved = Store.db ? await Store.get('meta', 'sync').catch(() => null) : null;
    if (saved) this.meta = { ...this.meta, ...saved };
    window.addEventListener('online', () => this.schedule(300));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.schedule(300); });
    setInterval(() => { if (!document.hidden) this.schedule(0); }, 60000);
    await this.connect();
  },
  async connect() {
    if (this.running) return;
    this.firstPull = !this.meta.owner && !S.memories.some(m => !m.sample);
    let st;
    try { st = await this.api('status'); } catch (e) { this.fail(e); return; }
    if (this.meta.owner && this.meta.owner !== st.user) { this.user = st.user; this.set('other-account', `This device holds memories from ${this.meta.owner}, but you’re signed in as ${st.user}.`); return; }
    if (!this.meta.owner) {
      // First connection from this device: everything already here is offered to the cloud. Nothing is replaced.
      this.meta = { ...this.meta, owner: st.user, cursor: 0, srv: {}, settingsInit: true };
      for (const m of S.memories) if (!m.sample) this.meta.pending[m.id] = 1;
      for (const t of S.tombstones) this.meta.pending[t.id] = 1;
      this.meta.localHash = this.meta.settingsHash = settingsHash(S.settings);
      await this.saveMeta();
    }
    this.user = st.user;
    await this.run();
  },
  schedule(ms) {
    if (['local', 'unconfigured', 'other-account'].includes(this.state)) return;
    if (this.state === 'signed-out' && ms > 0) return;     // retried on focus, or after signing in
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.user ? this.run() : this.connect()), ms);
  },
  mark(list) { const ids = list.filter(m => m && !m.sample).map(m => m.id); if (ids.length) this.markIds(ids); },
  markIds(ids) { ids.forEach(id => { this.meta.pending[id] = 1; }); this.saveMeta(); this.schedule(1200); updateSyncUI(); },
  noteSettings() {
    const h = settingsHash(S.settings);
    if (h === this.meta.localHash) return;
    this.meta.localHash = h; this.meta.localAt = nowISO(); this.saveMeta(); this.schedule(1200); updateSyncUI();
  },

  async run() {
    if (this.running) { this.again = true; return; }
    if (!this.user) return this.connect();
    this.running = true; this.set('syncing');
    try {
      await this.push();
      const changed = await this.pull();
      if (this.meta.settingsInit) {
        // First sync: the cloud's lists were merged in during the pull; send the combined lists back up.
        this.meta.settingsInit = false;
        if (this.meta.localHash !== this.meta.settingsHash) { this.meta.localAt = nowISO(); await this.push(); }
      }
      this.meta.lastSyncAt = nowISO(); this.failures = 0;
      await this.saveMeta();
      this.running = false;
      this.set(this.pendingCount() ? 'syncing' : 'synced');
      if (changed) { buildIndex(); refreshIfSafe(); }
    } catch (e) { this.running = false; this.fail(e); }
    this.firstPull = false;
    if (this.again || (this.state === 'syncing' && this.pendingCount())) { this.again = false; this.schedule(300); }
  },
  fail(e) {
    const kind = (e && e.kind) || 'offline';
    if (kind === 'local' || kind === 'unconfigured' || kind === 'signed-out') { this.set(kind, e.message); this.firstPull = false; return; }
    this.failures++;
    this.set(kind === 'offline' || navigator.onLine === false ? 'offline' : 'error', e && e.message);
    this.schedule(Math.min(60000, 4000 * 2 ** Math.min(this.failures - 1, 4)));
  },
  set(state, message = '') {
    const was = this.state; this.state = state; this.message = message || '';
    updateSyncUI();
    if (was !== state && (state === 'local' || state === 'unconfigured' || state === 'signed-out') && !S.memories.length) refreshIfSafe();
  },

  // What to send for one memory, from its current state on this device.
  changeFor(id) {
    const m = byId(id), t = S.tombstones.find(x => x.id === id), baseRev = this.meta.srv[id] || 0;
    if (m) return m.sample ? null : { id, op: 'put', baseRev, data: m };
    if (t && t.memory) return { id, op: 'delete', baseRev, deletedAt: t.deletedAt, data: { ...t.memory, id } };
    return { id, op: 'purge', baseRev };
  },
  settingsPayload() {
    if (!this.meta.owner || this.meta.settingsInit || this.meta.localHash === this.meta.settingsHash) return null;
    return { data: syncedSettings(S.settings), updatedAt: this.meta.localAt || nowISO() };
  },
  async push() {
    for (let round = 0; round < 500; round++) {
      const ids = Object.keys(this.meta.pending).slice(0, 50);
      const settings = this.settingsPayload();
      if (!ids.length && !settings) return;
      const changes = [], sent = new Map();
      for (const id of ids) {
        const ch = this.changeFor(id);
        if (!ch) { delete this.meta.pending[id]; continue; }
        changes.push(ch); sent.set(id, JSON.stringify(ch.data || null) + ch.op);
      }
      const res = await this.api('push', { method: 'POST', body: JSON.stringify({ changes, settings }) });
      for (const r of res.results || []) {
        if (r.status === 'rejected') { this.rejected[r.id] = r.reason; delete this.meta.pending[r.id]; continue; }
        if (r.record) this.meta.srv[r.id] = r.record.rev;
        const now = this.changeFor(r.id);
        const unchanged = !now || JSON.stringify(now.data || null) + now.op === sent.get(r.id);
        if (unchanged) delete this.meta.pending[r.id];
        // The cloud already had a newer version: keep it here too (this device's text is in the history).
        if (r.status === 'kept_server' && unchanged && r.record) {
          const local = byId(r.id); if (local) await Versions.add(local, 'conflict');
          await this.applyRemote(r.record, true); buildIndex(); refreshIfSafe();
        }
      }
      if (settings && res.settings) this.applySettings(res.settings, true);
      else if (settings) this.meta.settingsHash = this.meta.localHash;
      await this.saveMeta();
      updateSyncUI();
    }
  },
  async pull() {
    let changed = false;
    for (let page = 0; page < 1000; page++) {
      const d = await this.api('changes?since=' + encodeURIComponent(this.meta.cursor));
      for (const c of d.changes || []) if (await this.applyRemote(c, false)) changed = true;
      if (d.settings && this.applySettings(d.settings, false)) changed = true;
      this.meta.cursor = d.cursor; await this.saveMeta();
      if (!d.more) break;
    }
    return changed;
  },
  // Applies one memory from the cloud to this device. Returns true if anything here changed.
  async applyRemote(c, force) {
    if (!c || !/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) return false;
    this.meta.srv[c.id] = c.rev;
    if (this.meta.pending[c.id] && !force) return false;   // this device's newer change goes up next; the cloud reconciles
    const local = byId(c.id), t = S.tombstones.find(x => x.id === c.id);
    const dropLocal = async () => { if (local) { S.memories = S.memories.filter(x => x.id !== c.id); await Store.del('memories', c.id); } };
    const putTomb = async nt => { S.tombstones = S.tombstones.filter(x => x.id !== c.id).concat(nt); await Store.put('tombstones', nt); };
    if (c.purged) {
      if (!local && t && t.purged) return false;
      await dropLocal(); await putTomb({ id: c.id, deletedAt: c.deletedAt || nowISO(), purged: true });
      await Store.delMany('versions', (await Versions.list(c.id)).map(v => v.key));
      return true;
    }
    const m = normalizeMemory(c.data);
    if (m.id !== c.id) return false;
    if (c.deleted) {
      if (!local && t && t.memory && contentKey(t.memory) === contentKey(m)) return false;
      await dropLocal(); await putTomb({ id: c.id, deletedAt: c.deletedAt || nowISO(), memory: m });
      return true;
    }
    if (local && contentKey(local) === contentKey(m) && local.updatedAt === m.updatedAt) return false;
    const i = S.memories.findIndex(x => x.id === c.id);
    if (i >= 0) S.memories[i] = m; else S.memories.push(m);
    await Store.put('memories', m);
    if (t) { S.tombstones = S.tombstones.filter(x => x.id !== c.id); await Store.del('tombstones', c.id); }
    return true;
  },
  applySettings(s, fromPush) {
    if (!s || !s.data) return false;
    const h = settingsHash(s.data);
    if (this.meta.settingsInit) {
      // First sync on this device: combine the cloud's themes, competencies and synonyms with this device's.
      mergeSettings(s.data, false);
      this.meta.settingsHash = h; this.meta.localHash = settingsHash(S.settings);
      Store.put('meta', S.settings).catch(() => {}); buildIndex();
      return true;
    }
    if (!fromPush && this.meta.localHash !== this.meta.settingsHash) return false;   // local edits go up next
    this.meta.settingsHash = h;
    if (h === this.meta.localHash) return false;
    Object.assign(S.settings, syncedSettings(s.data));
    this.meta.localHash = h;
    Store.put('meta', S.settings).catch(() => {});
    return true;
  },

  async cloudBackup() {
    const data = await this.api('export');
    return download(`recollect-cloud-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  },
  async versions(id) { try { return (await this.api('versions?id=' + encodeURIComponent(id))).versions || []; } catch { return null; } },
  signIn() { location.href = this.API + 'login'; },
  // Removes this device's copy (the cloud copy stays) and signs out of Cloudflare Access.
  async forgetDevice() {
    await Store.clear('memories'); await Store.clear('tombstones'); await Store.clear('versions');
    if (Store.db) await Store.del('meta', 'sync');
    S.memories = []; S.tombstones = []; buildIndex();
    location.href = new URL('/cdn-cgi/access/logout', location.origin).href;
  }
};
const syncedSettings = s => ({ themes: Array.isArray(s.themes) ? s.themes.slice() : [], competencies: Array.isArray(s.competencies) ? s.competencies.slice() : [], synonyms: typeof s.synonyms === 'string' ? s.synonyms : '' });
const settingsHash = s => JSON.stringify(syncedSettings(s));

// Re-draws the current screen after changes arrive from the cloud, unless that would disturb typing or an open form.
function refreshIfSafe() {
  const r = parseHash().name;
  if (['edit', 'new', 'capture', 'guided', 'import'].includes(r) || S.dirty) return;
  const a = document.activeElement;
  if (a && $('#view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if ($('#dlg').open) return;
  const y = window.scrollY; render(); window.scrollTo(0, y);
}
const SYNC_TEXT = {
  starting: '', local: 'This device only', unconfigured: 'This device only', 'signed-out': 'Sign in to sync',
  syncing: 'Saving…', synced: 'Saved', offline: 'Offline', error: 'Sync problem', 'other-account': 'Sync paused'
};
function syncSummary() {
  const n = Sync.pendingCount();
  switch (Sync.state) {
    case 'synced': if (n) return `Saving ${plural(n, 'change')} to the cloud…`; return `Saved to your Recollect cloud${Sync.meta.lastSyncAt ? `, last checked ${new Date(Sync.meta.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.`;
    case 'syncing': return n ? `Saving ${plural(n, 'change')} to the cloud…` : 'Checking for changes…';
    case 'offline': return `Offline. ${n ? `${plural(n, 'change is', 'changes are')} saved on this device and will upload when the connection returns.` : 'Your memories are available from this device.'}`;
    case 'error': return `Cloud storage had a problem: ${(Sync.message || 'unknown error').replace(/\.$/, '')}. ${n ? `${plural(n, 'change is', 'changes are')} safe on this device and will be retried.` : 'It will be retried.'}`;
    case 'signed-out': return `You’re signed out of the cloud. ${n ? `${plural(n, 'change is', 'changes are')} saved on this device and will upload after you sign in.` : 'Sign in to see memories from your other devices.'}`;
    case 'unconfigured': return 'Cloud storage isn’t set up yet, so memories are saved in this browser only. Back up regularly.';
    case 'local': return 'This copy of Recollect has no cloud storage, so memories are saved in this browser only. Back up regularly.';
    case 'other-account': return Sync.message;
    default: return 'Connecting…';
  }
}
function updateSyncUI() {
  const pill = $('#sync-status');
  if (pill) {
    // "Saved" only when nothing is waiting: a change still on its way shows as Saving…
    const n = Sync.pendingCount(), st = Sync.state === 'synced' && n ? 'syncing' : Sync.state;
    pill.hidden = st === 'starting';
    pill.dataset.state = st;
    pill.querySelector('span').textContent = SYNC_TEXT[st] + (st === 'offline' && n ? ` · ${n} waiting` : '');
    pill.title = syncSummary();
    pill.href = st === 'signed-out' ? Sync.API + 'login' : '#data';
  }
  const note = $('#sync-note');
  if (note) {
    const show = ['signed-out', 'error', 'other-account'].includes(Sync.state) || (Sync.state === 'offline' && Sync.pendingCount());
    note.innerHTML = show ? `<div class="notice gray" style="margin:0 0 16px"><span style="flex:1;min-width:200px">${esc(syncSummary())}</span>${Sync.state === 'signed-out' ? '<button class="btn btn-sm" data-action="sync-signin">Sign in</button>' : ''}</div>` : '';
  }
  const card = $('#sync-card');
  if (card) card.innerHTML = syncCardHTML();
}

function aggregate(field) {
  const map = new Map();
  for (const m of live()) {
    const vals = Array.isArray(m[field]) ? m[field] : (m[field] ? [m[field]] : []);
    for (const v of vals) {
      const k = norm(v);
      if (!map.has(k)) map.set(k, { name: v, count: 0, min: null, max: null });
      const e = map.get(k); e.count++;
      if (m.eventDate && m.eventDate.start) {
        const y1 = m.eventDate.start.slice(0, 4), y2 = (m.eventDate.end || m.eventDate.start).slice(0, 4);
        if (!e.min || y1 < e.min) e.min = y1;
        if (!e.max || y2 > e.max) e.max = y2;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
function yearsPresent() {
  const ys = new Set();
  for (const m of live()) {
    const ev = m.eventDate; if (!ev || !ev.start) continue;
    const a = +ev.start.slice(0, 4), b = +(ev.end || ev.start).slice(0, 4);
    for (let y = a; y <= Math.min(b, a + 30); y++) ys.add(String(y));
  }
  return [...ys].sort().reverse();
}
function allThemes() { return uniqCI([...S.settings.themes, ...live().flatMap(m => m.themes)]); }
function spanText(e) { return e.min ? (e.min === e.max ? e.min : `${e.min}–${e.max}`) : ''; }

/* ---------- 6. Search & related memories ----------
   Honest keyword search: words are reduced to simple stems (hiring → hir,
   decisions → decis), then matched across weighted fields. It also tries
   prefixes, one-letter typos, and the editable synonym list. It does not
   understand meaning the way an AI model would. */
const STOP = new Set(('a an the and or but nor of to in on at for with about from by as is are was were be been being am ' +
  'i me my mine myself we us our you your he him his she her they them their it its this that these those ' +
  'had has have do did does done doing make made making times any some what when where who whom which why how ' +
  'there here then than so if into out up over just also very really kind sort thing things stuff ' +
  'remember remembered recall situation would could should can will get got').split(' '));
const FIELD_W = {
  title: 8, people: 7, tags: 6, project: 6, organization: 5, themes: 4, date: 4, story: 3,
  narrative: 3, original: 3, involvement: 2.5, outcome: 2.5, lessons: 2.5, uncertainties: 1.5, supporting: 1.5
};
const tokenize = text => norm(text).split(/[^a-z0-9]+/).filter(Boolean);

function stem(w) {
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  const hasVowel = s => /[aeiouy]/.test(s);
  let r;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/(ations?|ments?)$/.test(w) && w.length > 8) w = w.replace(/(ations?|ments?)$/, '');
  else if (/ions?$/.test(w) && w.length > 6) w = w.replace(/ions?$/, '');
  else if (/ings?$/.test(w) && w.length > 5 && hasVowel(r = w.replace(/ings?$/, '')) && r.length >= 3) w = r;
  else if (/ed$/.test(w) && w.length > 4 && hasVowel(w.slice(0, -2))) w = w.slice(0, -2);
  else if (/(ch|sh|x|ss|z)es$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (/e$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  return w;
}

function memFields(m) {
  return {
    title: m.title, people: m.people.join(' '), tags: m.tags.join(' '), project: m.project, organization: m.organization,
    themes: m.themes.join(' '), date: dateSearchText(m.eventDate),
    story: m.story && m.story.starred ? [m.story.headline, ...m.story.competencies, 'story bank'].join(' ') : '',
    narrative: m.narrative, original: m.original, involvement: m.involvement, outcome: m.outcome,
    lessons: m.lessons, uncertainties: m.uncertainties, supporting: m.supporting
  };
}
function dateSearchText(ev) {
  if (!ev) return '';
  const parts = [ev.text || '', ev.label || ''];
  if (ev.start) {
    const y1 = +ev.start.slice(0, 4), y2 = +(ev.end || ev.start).slice(0, 4);
    for (let y = y1; y <= Math.min(y2, y1 + 15); y++) parts.push(String(y));
    if (ev.precision === 'day' || ev.precision === 'month') parts.push(MONTH_NAMES[+ev.start.slice(5, 7) - 1]);
  }
  return parts.join(' ');
}
function buildIndex() {
  const docs = new Map(); const vocab = new Set();
  for (const m of S.memories) {
    const f = memFields(m); const d = { stems: {}, text: {} };
    for (const k in f) {
      const set = new Set();
      for (const t of tokenize(f[k])) { if (STOP.has(t)) continue; const s = stem(t); set.add(s); vocab.add(s); }
      d.stems[k] = set;
      d.text[k] = ' ' + norm(f[k]).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    }
    docs.set(m.id, d);
  }
  S.index = { docs, vocab: [...vocab] };
  S.syn = buildSynonyms(S.settings.synonyms);
}
function buildSynonyms(text) {
  const map = new Map();
  for (const line of String(text || '').split('\n')) {
    const entries = line.split(/[,;]/).map(e => e.trim()).filter(Boolean);
    if (entries.length < 2) continue;
    const sets = entries.map(e => tokenize(e).filter(t => !STOP.has(t)).map(stem));
    sets.forEach((toks, i) => toks.forEach(t => {
      if (!map.has(t)) map.set(t, new Set());
      sets.forEach((other, j) => { if (j !== i) other.forEach(o => { if (o !== t) map.get(t).add(o); }); });
    }));
  }
  return map;
}
function within1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function expandTerm(s) {
  const exp = new Map([[s, 1]]);
  const add = (t, w) => { if ((exp.get(t) || 0) < w) exp.set(t, w); };
  for (const t of (S.syn.get(s) || [])) add(t, 0.6);
  if (/^\d+$/.test(s)) return exp; // years and numbers match exactly
  for (const v of S.index.vocab) {
    if (v === s) continue;
    if (s.length >= 3 && v.startsWith(s)) add(v, 0.75);
    else if (v.length >= 5 && s.startsWith(v) && v.length / s.length >= 0.7) add(v, 0.65);
    else if (s.length >= 5 && within1(s, v)) add(v, 0.45);
  }
  return exp;
}

function search(query, list) {
  const phrases = [...String(query).matchAll(/"([^"]+)"/g)].map(x => norm(x[1]).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  const raw = tokenize(String(query).replace(/"/g, ' '));
  let toks = raw.filter(t => !STOP.has(t)); if (!toks.length) toks = raw;
  const terms = [...new Set(toks.map(stem))];
  if (!terms.length && !phrases.length) return list.map(m => ({ m, score: 0, hits: [] }));
  const exps = terms.map(expandTerm);
  const whole = raw.length >= 2 && !phrases.length ? ' ' + raw.join(' ') + ' ' : '';
  const out = [];
  for (const m of list) {
    const d = S.index.docs.get(m.id); if (!d) continue;
    let total = 0, matched = 0; const hits = new Set();
    for (const exp of exps) {
      let best = 0;
      for (const [tok, w] of exp) for (const f in FIELD_W) {
        if (d.stems[f] && d.stems[f].has(tok)) { const sc = FIELD_W[f] * w; if (sc > best) best = sc; hits.add(tok); }
      }
      if (best > 0) { matched++; total += best; }
    }
    let phrasesOK = true;
    for (const p of phrases) {
      let found = false;
      for (const f in FIELD_W) if (d.text[f].includes(' ' + p + ' ') || d.text[f].includes(p)) { total += FIELD_W[f] * 1.5; found = true; p.split(' ').forEach(t => hits.add(stem(t))); break; }
      if (!found) phrasesOK = false;
    }
    if (!phrasesOK) continue;
    if (whole) for (const f in FIELD_W) if (d.text[f].includes(whole)) { total += FIELD_W[f] * 1.5; break; }
    if (terms.length && matched === 0 && !phrases.length) continue;
    const cov = terms.length ? matched / terms.length : 1;
    out.push({ m, score: total * (0.3 + 0.7 * cov * cov), cov, hits: [...hits] });
  }
  return out.sort((a, b) => b.score - a.score);
}

function hitRegex(hits) {
  const pats = (hits || []).filter(h => h.length >= 2).sort((a, b) => b.length - a.length).map(escRe);
  return pats.length ? new RegExp(`\\b(?:${pats.join('|')})[a-z0-9]*`, 'gi') : null;
}
function highlight(text, hits) {
  text = String(text || ''); const re = hitRegex(hits);
  if (!re) return esc(text);
  let out = '', last = 0;
  for (const mt of text.matchAll(re)) { out += esc(text.slice(last, mt.index)) + '<mark>' + esc(mt[0]) + '</mark>'; last = mt.index + mt[0].length; }
  return out + esc(text.slice(last));
}
function snippetFor(m, hits) {
  const re = hitRegex(hits);
  if (re) {
    for (const f of ['narrative', 'original', 'involvement', 'outcome', 'lessons', 'uncertainties', 'supporting']) {
      const t = String(m[f] || '').replace(/\s+/g, ' '); if (!t) continue;
      re.lastIndex = 0; const mt = re.exec(t);
      if (mt) {
        const start = Math.max(0, mt.index - 70);
        let s = t.slice(start, start + 210);
        return (start > 0 ? '…' : '') + highlight(s, hits) + (start + 210 < t.length ? '…' : '');
      }
    }
  }
  return esc(clip(m.narrative || m.original || m.involvement || m.outcome || m.lessons, 180));
}

function relatedMemories(m, limit = 6) {
  const P = new Set(m.people.map(norm)), G = new Set(m.tags.map(norm)), T = new Set(m.themes.map(norm));
  const res = [];
  for (const o of live()) {
    if (o.id === m.id) continue;
    let s = 0; const why = [];
    o.people.filter(p => P.has(norm(p))).forEach(p => { s += 3; why.push(p); });
    if (m.project && norm(o.project) === norm(m.project)) { s += 3; why.push(o.project); }
    o.tags.filter(t => G.has(norm(t))).forEach(t => { s += 2; why.push('#' + t); });
    o.themes.filter(t => T.has(norm(t))).forEach(t => { s += 1; why.push(t); });
    if (m.organization && norm(o.organization) === norm(m.organization) && s > 0) s += 0.5;
    if (s >= 2) res.push({ o, s, why });
  }
  return res.sort((a, b) => b.s - a.s).slice(0, limit);
}

/* Filters shared by the Memories view, links, and URL parameters */
const FILTER_KEYS = ['q', 'person', 'org', 'project', 'theme', 'tag', 'from', 'to', 'conf', 'status', 'story', 'inbox', 'arch', 'sort'];
const FILTER_LABELS = { person: 'Person', org: 'Organization', project: 'Project', theme: 'Theme', tag: 'Tag', from: 'From', to: 'To', conf: 'Confidence', status: 'Status', story: 'Story Bank', inbox: 'Needs details', arch: 'Showing' };
const ARCH = { archived: 'Archived only', all: 'Active and archived' };
function applyFilters(list, f) {
  let from = f.from, to = f.to;
  if (from && to && from > to) [from, to] = [to, from];
  return list.filter(m => {
    if (f.arch === 'archived' ? !m.archived : f.arch !== 'all' && m.archived) return false;
    if (f.person && !m.people.some(p => norm(p) === norm(f.person))) return false;
    if (f.org && norm(m.organization) !== norm(f.org)) return false;
    if (f.project && norm(m.project) !== norm(f.project)) return false;
    if (f.theme && !m.themes.some(t => norm(t) === norm(f.theme))) return false;
    if (f.tag && !m.tags.some(t => norm(t) === norm(f.tag))) return false;
    if (f.conf && m.confidence !== f.conf) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.story && !(m.story && m.story.starred)) return false;
    if (f.inbox && !m.needsReview) return false;
    if (from || to) {
      const ev = m.eventDate; if (!ev || !ev.start) return false;
      if (from && (ev.end || ev.start) < `${from}-01-01`) return false;
      if (to && ev.start > `${to}-12-31`) return false;
    }
    return true;
  });
}
function sortList(list, mode) {
  const a = list.slice();
  const ev = m => (m.eventDate && m.eventDate.start) || '';
  switch (mode) {
    case 'event-asc': return a.sort((x, y) => (ev(x) ? 0 : 1) - (ev(y) ? 0 : 1) || ev(x).localeCompare(ev(y)) || x.createdAt.localeCompare(y.createdAt));
    case 'created': return a.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    case 'updated': return a.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    case 'title': return a.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
    default: return a.sort((x, y) => (ev(x) ? 0 : 1) - (ev(y) ? 0 : 1) || ev(y).localeCompare(ev(x)) || y.createdAt.localeCompare(x.createdAt));
  }
}
function filterQS(f) {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]);
  const s = p.toString(); return s ? '?' + s : '';
}

/* ---------- 7. AI entry parser ----------
   Reads the "=== MEMORY BANK ENTRY ===" format produced by the intake
   prompt. Tolerates markdown bold, bullets, headings, missing labels,
   reordered fields, several entries in one paste, and JSON. */
const AI_LABELS = {
  'title': 'title', 'memory title': 'title',
  'when': 'when', 'event date': 'when', 'date': 'when',
  'people': 'people', 'people involved': 'people',
  'people roles': 'roles', 'roles': 'roles',
  'organization': 'organization', 'organisation': 'organization', 'team': 'organization', 'company': 'organization',
  'project': 'project', 'initiative': 'project', 'project / initiative': 'project', 'project or initiative': 'project',
  'themes': 'themes', 'theme': 'themes',
  'tags': 'tags', 'keywords': 'tags',
  'confidence': 'confidence', 'status': 'status',
  'story bank': 'story', 'story': 'story',
  'story competencies': 'competencies', 'competencies': 'competencies',
  'story headline': 'headline', 'headline': 'headline',
  'original recollection': 'original', 'original': 'original', 'in my words': 'original',
  'narrative': 'narrative', 'organized narrative': 'narrative', 'what happened': 'narrative',
  'my involvement': 'involvement', 'involvement': 'involvement', 'my role': 'involvement',
  'outcome': 'outcome', 'result': 'outcome', 'results': 'outcome',
  'lessons': 'lessons', 'lessons / reflections': 'lessons', 'lessons and reflections': 'lessons', 'reflections': 'lessons', 'lessons learned': 'lessons',
  'uncertain details': 'uncertainties', 'uncertainties': 'uncertainties', 'to verify': 'uncertainties', 'open questions': 'uncertainties',
  'supporting information': 'supporting', 'supporting info': 'supporting', 'references': 'supporting', 'supporting': 'supporting'
};
const ENTRY_RE = /(MEMORY BANK|RECOLLECT) ENTRY/i; // V1 and V2 markers
function cleanLine(line) { return line.replace(/^\s*(?:>\s*)*(?:[-*•]\s+)?/, '').replace(/\*\*|__/g, ''); }
function parseLabelLine(line) {
  const c = cleanLine(line).replace(/^#{1,6}\s*/, '').trim();
  const m = c.match(/^([A-Za-z][A-Za-z /&'()-]{0,48}?)\s*:\s*(.*)$/);
  if (m) { const key = AI_LABELS[m[1].replace(/\(.*?\)/g, '').trim().toLowerCase()]; if (key) return { key, value: m[2] }; }
  if (c.length <= 40) { const key = AI_LABELS[c.replace(/:$/, '').toLowerCase()]; if (key) return { key, value: '' }; }
  return null;
}
function looksStructured(text) {
  if (ENTRY_RE.test(text)) return true;
  let n = 0; for (const line of String(text).split('\n')) if (parseLabelLine(line)) n++;
  return n >= 3;
}
function cleanValue(v) {
  v = String(v || '').replace(/\*\*/g, '').replace(/^\n+|\s+$/g, '').trim();
  if (/^\[[^\]\n]*\]$/.test(v)) return '';
  if (/^(n\/?a|none|unknown|not (mentioned|provided|specified|stated|sure)|-+|—|blank|tbd|empty)\.?$/i.test(v)) return '';
  return v;
}
function matchFromList(value, list) {
  const key = s => norm(s).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const k = key(value); if (!k) return '';
  return list.find(t => key(t) === k) || list.find(t => key(t).startsWith(k) && k.length >= 5) || list.find(t => k.startsWith(key(t).slice(0, 10)) && key(t).length >= 10) || value.trim();
}
function mapConfidence(v) { v = norm(v); if (/confirm|certain|sure/.test(v) && !/uncertain|unsure|not sure/.test(v)) return 'confirmed'; if (/approx|roughly|mostly/.test(v)) return 'approximate'; if (/uncertain|unsure|fuzzy|not sure|vague/.test(v)) return 'uncertain'; return ''; }
function mapStatus(v) { v = norm(v); if (/ongoing|unresolved|in progress|open|unfolding/.test(v)) return 'ongoing'; if (/reflect/.test(v)) return 'reflective'; if (/resolved|complete|closed|done|finished/.test(v)) return 'resolved'; return ''; }

function fieldsToMemory(f) {
  const m = blankMemory(); m.source = 'ai';
  m.title = f.title || '';
  if (f.when) { const p = parseWhen(f.when); m.eventDate = buildEventDate(f.when, p ? p.approx : false); }
  const roles = [];
  m.people = uniqCI(splitList(f.people).map(p => {
    const mm = p.match(/^(.*?)\s*[(\[](.+?)[)\]]\s*$/) || p.match(/^(.*?)\s+[–—-]\s+(.+)$/);
    if (mm) { roles.push(`${mm[1].trim()} – ${mm[2].trim()}`); return mm[1].trim(); }
    return p;
  }));
  if (f.roles) roles.push(...splitList(f.roles));
  m.organization = f.organization || '';
  m.project = f.project || '';
  m.themes = uniqCI(splitList(f.themes).map(t => matchFromList(t, S.settings.themes)));
  m.tags = uniqCI(splitList(f.tags).map(t => t.replace(/^#/, '')));
  m.confidence = mapConfidence(f.confidence || '');
  m.status = mapStatus(f.status || '');
  const starred = /^(y|yes|true|x|✓)/i.test((f.story || '').trim());
  m.story = { starred, competencies: starred ? uniqCI(splitList(f.competencies).map(c => matchFromList(c, S.settings.competencies))) : [], headline: starred ? (f.headline || '') : '' };
  for (const k of ['original', 'narrative', 'involvement', 'outcome', 'lessons', 'uncertainties', 'supporting']) m[k] = f[k] || '';
  if (roles.length) m.supporting = (m.supporting ? m.supporting + '\n\n' : '') + 'People & roles: ' + uniqCI(roles).join('; ');
  if (!m.title) { m.title = autoTitle(m.original || m.narrative); m.titleAuto = true; }
  return m;
}
function parseBlock(b) {
  const fields = {}; let cur = null, found = 0;
  for (const line of b.split('\n')) {
    const l = parseLabelLine(line);
    if (l) { cur = l.key; found++; fields[cur] = (fields[cur] ? fields[cur] + '\n' : '') + l.value; continue; }
    if (cur) fields[cur] += '\n' + line.replace(/^\s*>\s?/, '');
  }
  if (found < 2) return null;
  for (const k in fields) fields[k] = cleanValue(fields[k]);
  return fieldsToMemory(fields);
}
function parseAIEntries(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n').replace(/^\s*```[a-z]*\s*$/gim, '').replace(/[“”]/g, '"');
  const s = t.trim();
  if (/^[\[{]/.test(s)) {
    try {
      let d = JSON.parse(s);
      if (d && d.format === 'memory-bank-backup') return { backup: true };
      if (d && Array.isArray(d.memories)) d = d.memories;
      if (!Array.isArray(d)) d = [d];
      return d.filter(x => x && typeof x === 'object').map(x => { const m = normalizeMemory({ ...x, id: undefined, createdAt: undefined, updatedAt: undefined }); m.source = 'ai'; if (!m.title) { m.title = autoTitle(m.original || m.narrative); m.titleAuto = true; } return m; }).filter(hasContent);
    } catch { /* not JSON; fall through */ }
  }
  let blocks = [t];
  if (ENTRY_RE.test(t)) blocks = t.split(/^[^\n]*(?:MEMORY BANK|RECOLLECT) ENTRY[^\n]*$/im).slice(1).map(b => b.split(/^[^\n]*END (?:OF )?(?:MEMORY )?ENTRY[^\n]*$/im)[0]);
  return blocks.map(parseBlock).filter(m => m && hasContent(m));
}

/* ---------- 8. Export, backup & restore ---------- */
// Saves a file. On iPhone/iPad the share sheet ("Save to Files") is used when available,
// because downloads are unreliable in Home Screen apps. Resolves true if the file was handed off.
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const plain = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return true;
  };
  if (IS_IOS && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: filename }).then(() => true, err => (err && err.name === 'AbortError') ? false : plain());
      }
    } catch { /* fall through to a normal download */ }
  }
  return Promise.resolve(plain());
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}
const today = () => new Date().toISOString().slice(0, 10);

function memoryToMarkdown(m) {
  const L = [`## ${m.title || 'Untitled memory'}`, ''];
  const meta = [];
  if (m.eventDate) meta.push(`**When:** ${whenLong(m.eventDate)}`);
  if (m.organization) meta.push(`**Organization:** ${m.organization}`);
  if (m.project) meta.push(`**Project:** ${m.project}`);
  if (m.people.length) meta.push(`**People:** ${m.people.join(', ')}`);
  if (m.themes.length) meta.push(`**Themes:** ${m.themes.join(', ')}`);
  if (m.tags.length) meta.push(`**Tags:** ${m.tags.map(t => '#' + t.replace(/\s+/g, '-')).join(' ')}`);
  const cs = [m.confidence && `Confidence: ${CONFIDENCE[m.confidence]}`, m.status && `Status: ${STATUS[m.status]}`].filter(Boolean);
  if (cs.length) meta.push(`**${cs.join(' · ')}**`);
  if (meta.length) L.push(meta.join('  \n'), '');
  const sec = (h, t) => { if (!isBlank(t)) L.push(`### ${h}`, '', t.trim(), ''); };
  sec('What happened', m.narrative); sec('My involvement', m.involvement); sec('Outcome', m.outcome);
  sec('Lessons & reflections', m.lessons); sec('Uncertain details', m.uncertainties); sec('Supporting information', m.supporting);
  if (!isBlank(m.original)) L.push('### Original recollection', '', m.original.trim().split('\n').map(l => '> ' + l).join('\n'), '');
  if (m.story && m.story.starred) L.push(`**Story Bank:** ${m.story.competencies.join(', ') || 'yes'}${m.story.headline ? ` — ${m.story.headline}` : ''}`, '');
  L.push(`*Recorded ${fmtDate(m.createdAt)} · Last edited ${fmtDate(m.updatedAt)}*`, '');
  return L.join('\n');
}
function memoriesToMarkdown(list, title) {
  return `# ${title}\n\n*Exported ${fmtDate(nowISO())} from Recollect · ${plural(list.length, 'memory', 'memories')}*\n\n---\n\n` + list.map(memoryToMarkdown).join('\n---\n\n');
}
function storiesToMarkdown(list) {
  const L = ['# Professional Story Bank', '', `*Prepared ${fmtDate(nowISO())} · ${plural(list.length, 'story', 'stories')}*`, ''];
  const comps = uniqCI(list.flatMap(m => m.story.competencies));
  if (comps.length) {
    L.push('## Index by competency', '');
    for (const c of comps) L.push(`- **${c}:** ${list.filter(m => m.story.competencies.some(x => norm(x) === norm(c))).map(m => m.title).join('; ')}`);
    L.push('');
  }
  for (const m of list) {
    L.push('---', '', `## ${m.title || 'Untitled'}`);
    const where = [whenLong(m.eventDate), m.organization, m.project].filter(Boolean).join(' · ');
    if (where) L.push(`*${where}*`);
    L.push('');
    if (m.story.competencies.length) L.push(`**Demonstrates:** ${m.story.competencies.join(', ')}`, '');
    if (m.story.headline) L.push(`> ${m.story.headline}`, '');
    const sec = (h, t) => { if (!isBlank(t)) L.push(`**${h}:** ${t.trim()}`, ''); };
    sec('Situation', m.narrative || m.original); sec('What I did', m.involvement); sec('Result', m.outcome); sec('What I learned', m.lessons);
    if (m.confidence && m.confidence !== 'confirmed') L.push(`*Note: details marked ${m.confidence}. Verify before using.*`, '');
    if (!isBlank(m.uncertainties)) L.push(`*To verify: ${m.uncertainties.trim().replace(/\n+/g, ' ')}*`, '');
  }
  return L.join('\n');
}

function backupJSON() {
  return JSON.stringify({
    format: 'memory-bank-backup', /* unchanged identifier so V1 and V2 backups are interchangeable */ schemaVersion: APP.schemaVersion, app: APP.name,
    appVersion: APP.version, exportedAt: nowISO(), deviceId: S.settings.deviceId,
    counts: { memories: S.memories.length, tombstones: S.tombstones.length },
    settings: { themes: S.settings.themes, competencies: S.settings.competencies, synonyms: S.settings.synonyms },
    memories: S.memories, tombstones: S.tombstones
  }, null, 2);
}
async function downloadBackup({ silent = false } = {}) {
  const ok = await download(`recollect-backup-${today()}.json`, backupJSON(), 'application/json');
  if (!ok) return false;
  S.settings.lastBackupAt = nowISO(); await saveSettings();
  if (!silent) toast(IS_IOS ? 'Backup ready. Save it to Files or iCloud Drive.' : 'Backup downloaded. Keep it somewhere private.');
  return true;
}

function analyzeImport(incoming) {
  const local = new Map(S.memories.map(m => [m.id, m]));
  const fps = new Set(S.memories.map(fingerprint));
  const tomb = new Map(S.tombstones.map(t => [t.id, t]));
  const plan = { new: [], newer: [], same: [], older: [], dup: [], deleted: [] };
  const seen = new Set();
  for (const m of incoming) {
    if (!hasContent(m)) continue;
    const ex = local.get(m.id);
    if (ex) {
      if (contentKey(ex) === contentKey(m)) plan.same.push(m);
      else if (m.updatedAt > ex.updatedAt) plan.newer.push(m);
      else plan.older.push(m);
    } else if (tomb.has(m.id) && tomb.get(m.id).deletedAt >= m.updatedAt) plan.deleted.push(m);
    else if (fps.has(fingerprint(m)) || seen.has(fingerprint(m))) plan.dup.push(m);
    else { plan.new.push(m); seen.add(fingerprint(m)); }
  }
  return plan;
}
async function restoreFromFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { await modal('Can’t read that file', '<p>That file isn’t valid JSON. Choose a backup created by Memory Bank (memory-bank-backup-….json).</p>', [{ label: 'OK', value: 'ok', cls: 'btn-primary' }]); return; }
  const list = Array.isArray(data) ? data : (data && data.memories);
  if (!Array.isArray(list)) { await modal('No memories found', '<p>This file doesn’t contain a list of memories.</p>', [{ label: 'OK', value: 'ok', cls: 'btn-primary' }]); return; }
  const incoming = list.map(normalizeMemory);
  const plan = analyzeImport(incoming);
  const row = (label, n) => `<tr><td>${label}</td><td>${n}</td></tr>`;
  const dupList = plan.dup.slice(0, 5).map(m => `<li>${esc(m.title || 'Untitled')}</li>`).join('');
  const body = `
    <p>Found ${plural(incoming.length, 'memory', 'memories')} in <strong>${esc(file.name)}</strong>${data.exportedAt ? `, exported ${fmtDate(data.exportedAt)}` : ''}.</p>
    <table class="dlg-table">
      ${row('New to this device', plan.new.length)}
      ${row('Newer versions of memories you have', plan.newer.length)}
      ${row('Already here, identical (skipped)', plan.same.length)}
      ${row('Older than your copy (yours kept)', plan.older.length)}
      ${row('Possible duplicates', plan.dup.length)}
      ${row('Previously deleted on this device', plan.deleted.length)}
    </table>
    ${plan.dup.length ? `<p class="small muted">Possible duplicates have the same title and opening text as something you already have:</p><ul class="small muted">${dupList}${plan.dup.length > 5 ? '<li>…</li>' : ''}</ul>
      <label class="check"><input type="checkbox" name="dups"> Import possible duplicates anyway</label>` : ''}
    ${plan.deleted.length ? `<label class="check" style="margin-top:8px"><input type="checkbox" name="undelete"> Restore memories I deleted on this device</label>` : ''}
    <div class="field"><label>How to restore</label>
      <label class="check"><input type="radio" name="mode" value="merge" checked> Merge into what’s here (recommended)</label>
      <label class="check"><input type="radio" name="mode" value="replace"> Replace everything with this file</label>
      <span class="hint">Replace downloads a safety backup of your current data first. Memories that aren’t in the file move to Recently deleted, where they can still be restored.</span>
    </div>`;
  const r = await modal('Restore from backup', body, [{ label: 'Restore', value: 'ok', cls: 'btn-primary' }, { label: 'Cancel', value: 'cancel' }]);
  if (r.value !== 'ok') return;
  if (r.data.get('mode') === 'replace') {
    if (S.memories.length) await downloadBackup({ silent: true });
    // Nothing is destroyed: memories missing from the file go to Recently deleted.
    const all = incoming.filter(hasContent), keep = new Set(all.map(m => m.id));
    for (const m of S.memories.filter(x => !keep.has(x.id))) await deleteMemory(m.id, { tombstone: !m.sample });
    await saveMany(all);
    if (data.settings) mergeSettings(data.settings, true);
    await saveSettings(); buildIndex();
    toast(`Restored ${plural(all.length, 'memory', 'memories')}.`);

  } else {
    const add = [...plan.new, ...plan.newer];
    if (r.data.get('dups') === 'on') add.push(...plan.dup.map(m => ({ ...m, id: S.memories.some(x => x.id === m.id) ? uid() : m.id })));
    if (r.data.get('undelete') === 'on') add.push(...plan.deleted);
    await saveMany(add);
    const restoredIds = new Set(add.map(m => m.id));
    const removeT = S.tombstones.filter(t => restoredIds.has(t.id)).map(t => t.id);
    if (removeT.length) { S.tombstones = S.tombstones.filter(t => !restoredIds.has(t.id)); await Store.delMany('tombstones', removeT); }
    if (data.settings) mergeSettings(data.settings, false);
    await saveSettings(); buildIndex();
    toast(`Added ${plan.new.length}, updated ${plan.newer.length}${r.data.get('dups') === 'on' ? `, plus ${plan.dup.length} possible duplicates` : ''}.`);
  }
  render();
}
function mergeSettings(incoming, replace) {
  if (Array.isArray(incoming.themes)) S.settings.themes = replace ? uniqCI(incoming.themes) : uniqCI([...S.settings.themes, ...incoming.themes]);
  if (Array.isArray(incoming.competencies)) S.settings.competencies = replace ? uniqCI(incoming.competencies) : uniqCI([...S.settings.competencies, ...incoming.competencies]);
  if (typeof incoming.synonyms === 'string') {
    S.settings.synonyms = replace ? incoming.synonyms : uniqCI([...S.settings.synonyms.split('\n'), ...incoming.synonyms.split('\n')]).join('\n');
  }
}

/* ---------- 9. Voice dictation ----------
   Uses the browser's built-in Web Speech API when present (Chrome, Edge,
   Safari 14.5+ on iPhone/Mac). Audio is processed by the browser vendor's
   speech service. Typing always works; this is only a convenience. */
const Voice = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition,
  // Safari and every iPhone browser use WebKit's speech engine, which works best one phrase at a time.
  isSafari: /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || /^((?!chrome|android|edg).)*safari/i.test(navigator.userAgent),
  rec: null, on: false, target: null, btn: null, base: '', restarts: 0,
  broken: (() => { try { return sessionStorage.getItem('rc.voiceBroken') === '1'; } catch { return false; } })(),
  get supported() { return !!this.SR; },
  toggle(target, btn) { if (this.on && this.target === target) { this.stop(); return; } this.stop(); this.start(target, btn); },
  start(target, btn) {
    if (!this.supported || !target) return;
    if (!S.settings.voiceNoticeShown) {
      toast('Dictation uses your browser’s speech service (Apple in Safari, Google in Chrome).');
      S.settings.voiceNoticeShown = true; saveSettings();
    }
    this.target = target; this.btn = btn; this.on = true; this.restarts = 0; this.base = target.value;
    const rec = new this.SR(); this.rec = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = !this.isSafari;   // Safari is more reliable one phrase at a time; we restart automatically
    rec.interimResults = true;
    rec.onresult = e => {
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
      }
      if (fin) this.base = joinText(this.base, fin);
      target.value = joinText(this.base, interim);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = e => {
      const msg = {
        'not-allowed': 'Microphone access was blocked. Tap the microphone on your keyboard to dictate instead.',
        'service-not-allowed': 'In-app dictation isn’t available here. Tap the microphone on your keyboard to dictate instead.',
        'audio-capture': 'No microphone was found.',
        'network': 'The speech service couldn’t be reached. Check your connection, or type instead.',
        'language-not-supported': 'Dictation isn’t available for this language in this browser.'
      }[e.error];
      if (msg) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.broken = true; try { sessionStorage.setItem('rc.voiceBroken', '1'); } catch { /* ignore */ } }
        toast(msg); this.stop();
      }
    };
    rec.onend = () => {
      if (!this.on) return;
      target.value = this.base;
      if (this.restarts++ < 200) { try { rec.start(); } catch { this.stop(); } } else this.stop();
    };
    try { rec.start(); } catch { this.stop(); return; }
    this.ui(true);
  },
  stop() {
    if (!this.on) return;
    this.on = false;
    try { this.rec && this.rec.stop(); } catch { /* ignore */ }
    if (this.target) { this.target.value = this.base; this.target.dispatchEvent(new Event('input', { bubbles: true })); }
    this.ui(false); this.rec = null;
  },
  ui(listening) {
    if (!this.btn) return;
    this.btn.classList.toggle('listening', listening);
    this.btn.setAttribute('aria-pressed', listening);
    const label = this.btn.querySelector('span'); if (label) label.textContent = listening ? 'Stop' : 'Dictate';
    const status = document.getElementById(this.btn.dataset.status || '');
    if (status) status.textContent = listening ? 'Listening… speak naturally.' : '';
  }
};
function joinText(a, b) {
  b = String(b || '').trim(); if (!b) return a;
  if (!a) return b.charAt(0).toUpperCase() + b.slice(1);
  return /\s$/.test(a) ? a + b : a + ' ' + b;
}
function micButton(targetId, statusId, cls = 'btn btn-mic') {
  return `<button type="button" class="${cls}" data-action="mic" data-target="${targetId}" data-status="${statusId}" aria-pressed="false">${ICON_MIC}<span>Dictate</span></button>`;
}
// When the browser can't transcribe, raise the keyboard so its own dictation key can be used.
function dictationFallback(target) {
  if (target) { target.focus(); const n = target.value.length; try { target.setSelectionRange(n, n); } catch { /* ignore */ } }
  toast(IS_IOS ? 'Tap the microphone on your keyboard to dictate.' : 'Use your device’s built-in dictation (for example, the microphone key on the keyboard).');
}

/* ---------- 10. UI helpers ---------- */
function modal(title, bodyHTML, buttons) {
  return new Promise(resolve => {
    const d = $('#dlg'), form = $('#dlg-form');
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = bodyHTML;
    $('#dlg-actions').innerHTML = buttons.map(b => `<button value="${esc(b.value)}" class="btn ${b.cls || ''}" ${b.value === 'cancel' ? 'formnovalidate' : ''}>${esc(b.label)}</button>`).join('');
    const onClose = () => { d.removeEventListener('close', onClose); resolve({ value: d.returnValue || 'cancel', data: new FormData(form) }); };
    d.returnValue = ''; d.addEventListener('close', onClose);
    d.showModal();
    const first = $('#dlg-body input:not([type=checkbox]):not([type=radio]), #dlg-body textarea', d); if (first) first.focus();
  });
}
async function confirmDialog(title, msg, okLabel = 'OK', danger = false) {
  const r = await modal(title, `<p>${msg}</p>`, [{ label: okLabel, value: 'ok', cls: danger ? 'btn-danger' : 'btn-primary' }, { label: 'Cancel', value: 'cancel' }]);
  return r.value === 'ok';
}
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn" type="button">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 4000);
}

function chipInput(name, values, listId, placeholder) {
  return `<div class="chips-input" data-name="${name}">${values.map(chipTag).join('')}<input type="text" list="${listId}" placeholder="${esc(placeholder)}" enterkeyhint="done" autocomplete="off" autocapitalize="${name === 'people' ? 'words' : 'none'}" aria-label="${esc(placeholder)}"></div>`;
}
function chipTag(v) { return `<span class="chip chip-edit" data-value="${esc(v)}">${esc(v)}<button type="button" class="chip-x" data-action="chip-remove" aria-label="Remove ${esc(v)}">×</button></span>`; }
function chipValues(root, name) {
  const box = $(`.chips-input[data-name="${name}"]`, root); if (!box) return [];
  const vals = $$('.chip-edit', box).map(c => c.dataset.value);
  const pending = $('input', box).value; if (pending.trim()) vals.push(...splitList(pending.replace(/,/g, ';')));
  return uniqCI(vals);
}
function addChips(box, text) {
  const input = $('input', box);
  const existing = new Set($$('.chip-edit', box).map(c => norm(c.dataset.value)));
  for (const v of splitList(String(text).replace(/,/g, ';'))) {
    if (existing.has(norm(v))) continue; existing.add(norm(v));
    input.insertAdjacentHTML('beforebegin', chipTag(v));
  }
  input.value = ''; input.placeholder = '';
  S.dirty = true;
}
function datalist(id, values) { return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`; }
function options(values, selected, placeholder) {
  return `<option value="">${esc(placeholder)}</option>` + values.map(v => {
    const [val, label] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(val)}" ${norm(val) === norm(selected) && selected !== '' ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function cardHTML(m, { hits = null, select = false, selected = false } = {}) {
  const meta = [whenShort(m.eventDate), m.organization, m.project].filter(Boolean).map(esc).join(' · ');
  const badges = [
    m.sample && '<span class="badge">Sample</span>',
    m.story && m.story.starred && '<span class="badge badge-navy">Story</span>',
    m.status === 'ongoing' && '<span class="badge">Ongoing</span>',
    m.needsReview && '<span class="badge badge-outline">Needs details</span>',
    m.archived && '<span class="badge badge-outline">Archived</span>'
  ].filter(Boolean).join('');
  const people = m.people.length ?
 `<div class="card-people">${hits ? highlight(m.people.slice(0, 5).join(', '), hits) : esc(m.people.slice(0, 5).join(', '))}${m.people.length > 5 ? ` +${m.people.length - 5}` : ''}</div>` : '';
  const snippet = hits ? snippetFor(m, hits) : esc(clip(m.narrative || m.original || m.involvement || m.outcome || m.lessons, 180));
  return `<article class="card mem-card">
    ${select ? `<label class="sel"><input type="checkbox" class="selbox" data-id="${m.id}" ${selected ? 'checked' : ''} aria-label="Select ${esc(m.title)}" style="width:18px;height:18px;accent-color:var(--navy)"></label>` : ''}
    <a class="card-link" href="#memory/${m.id}">
      <div class="card-top"><h3>${hits ? highlight(m.title || 'Untitled', hits) : esc(m.title || 'Untitled')}</h3>${badges ? `<span class="badges">${badges}</span>` : ''}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ''}${people}
      ${snippet ? `<p class="snippet">${snippet}</p>` : ''}
    </a></article>`;
}

/* ---------- 11. Views ---------- */

/* ===== Home ===== */
function renderHome(view) {
  const real = S.memories.filter(m => !m.sample);
  const n = S.memories.length;
  const people = aggregate('people');
  const themes = aggregate('themes');
  const years = yearsPresent();
  const recent = live().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const inbox = live().filter(m => m.needsReview).length;
  const samples = n - real.length;
  const changed = real.filter(m => !S.settings.lastBackupAt || m.updatedAt > S.settings.lastBackupAt).length;
  const backupDue = changed > 0 && (!S.settings.lastBackupAt || daysSince(S.settings.lastBackupAt) >= 7 || changed >= 5);
  const stories = live().filter(m => m.story && m.story.starred).length;
  const range = years.length ? (years.length > 1 ? `${years[years.length - 1]}–${years[0]}` : years[0]) : '';
  const draft = String(loadLocal('mb.quickDraft') || '').trim();
  const showInstallTip = IS_IOS && !isStandalone() && real.length > 0 && !S.settings.installTipDismissed;
  // On a new device with cloud storage, wait for the first download instead of offering a fresh start.
  const loading = n === 0 && (Sync.state === 'starting' || (Sync.firstPull && Sync.state === 'syncing'));
  const fresh = !S.settings.welcomed && n === 0 && !loading;

  view.innerHTML = `
    <div id="sync-note"></div>
    ${loading ? `<section class="panel welcome"><svg class="welcome-logo" aria-hidden="true"><use href="#rc-symbol"/></svg><p class="muted" role="status">Loading your memories…</p></section>` : ''}
    ${fresh ? `
      <section class="panel welcome">
        <svg class="welcome-logo" aria-hidden="true"><use href="#rc-symbol"/></svg>
        <h2 style="font-size:21px">Welcome to Recollect</h2>
        <p class="tagline">${TAGLINE}</p>
        ${isStandalone()
          ? `<p>This Home Screen app keeps its own storage, separate from Safari. If you used Recollect in Safari before, restore the backup you saved there.</p>`
          : `<p>Capture a recollection the moment it surfaces, then find it later by a name, a theme, a period, or one stray detail. ${Sync.on() ? 'Everything is saved to your private Recollect cloud and kept on this device for quick access.' : 'Everything stays on this device.'}</p>`}
        <div class="row-actions">
          ${isStandalone() ? `<button class="btn btn-primary" data-action="home-restore">Restore from a backup</button>` : ''}
          <button class="btn ${isStandalone() ? '' : 'btn-primary'}" data-action="load-samples">Explore with sample memories</button>
          ${isStandalone() ? '' : `<button class="btn" data-action="home-restore">Restore a backup</button>`}
          <button class="btn btn-quiet" data-action="dismiss-welcome">Start empty</button>
        </div>
        <input type="file" id="home-restore-file" ${IS_IOS ? '' : 'accept=".json,application/json"'} hidden>
      </section>` : ''}
    ${samples ? `<div class="notice gray" style="margin:0 0 16px">${plural(samples, 'fictional sample memory', 'fictional sample memories')} ${samples === 1 ? 'is' : 'are'} loaded. <button class="btn btn-sm" data-action="remove-samples">Remove samples</button></div>` : ''}
    ${showInstallTip ? `<div class="notice" style="margin:0 0 16px"><span style="flex:1;min-width:200px">Add Recollect to your Home Screen for an app-like experience. ${Sync.on() ? 'Sign in there and your memories appear.' : 'Back up first: the Home Screen app has its own storage.'}</span><button class="btn btn-sm" data-action="install-steps">Show me how</button><button class="btn btn-sm btn-quiet" data-action="dismiss-install">Not now</button></div>` : ''}
    <section class="home-grid">
      <div class="panel">
        <h2 class="section-label">Recall</h2>
        <form id="home-search" class="search-wrap" role="search">
          <input id="home-q" type="search" placeholder="Search a name, place, phrase, or year" autocomplete="off" autocorrect="off" enterkeyhint="search" aria-label="Search memories">
        </form>
        <div id="home-results"></div>
        <div class="starts only-desktop" id="starts">
          ${people.length ? `<div class="starts-group"><div class="starts-label">Start from a person</div><div class="chips">${people.slice(0, 8).map(p => `<a class="chip chip-person" href="#memories?person=${encodeURIComponent(p.name)}">${esc(p.name)}</a>`).join('')}${people.length > 8 ? `<a class="chip dim" href="#browse">All ${people.length}</a>` : ''}</div></div>` : ''}
          ${years.length ? `<div class="starts-group"><div class="starts-label">A period</div><div class="chips">${years.slice(0, 10).map(y => `<a class="chip" href="#memories?from=${y}&to=${y}">${y}</a>`).join('')}<a class="chip dim" href="#timeline">Timeline</a></div></div>` : ''}
          ${themes.length ? `<div class="starts-group"><div class="starts-label">A theme</div><div class="chips">${themes.slice(0, 6).map(t => `<a class="chip" href="#memories?theme=${encodeURIComponent(t.name)}">${esc(t.name)}</a>`).join('')}</div></div>` : ''}
          ${!n ? '<p class="muted small" style="margin-top:12px">Once you add memories, people, years and themes appear here as starting points.</p>' : ''}
        </div>
      </div>
      <div class="panel capture only-desktop">
        <h2 class="section-label">Capture</h2>
        <textarea id="qc" placeholder="What do you remember? Type, paste, or dictate. Details can come later." aria-label="Quick capture"></textarea>
        <div id="qc-detect" class="notice" hidden>This looks like a structured AI entry. <button class="btn btn-sm" data-action="qc-import">Review &amp; import</button></div>
        <div class="capture-bar">
          ${micButton('qc', 'qc-mic')}
          <span id="qc-mic" class="muted small"></span>
          <span class="spacer"></span>
          <button class="btn" data-action="qc-details">Add details</button>
          <button class="btn btn-primary" data-action="qc-save">Save</button>
        </div>
        <div class="capture-links">
          <a href="#guided">Work through a memory</a>
          <a href="#import">Paste an AI entry</a>
        </div>
      </div>
      <div class="only-mobile">
        <button type="button" class="m-capture" data-action="open-capture" aria-label="${draft ? 'Continue your draft' : 'Capture a memory'}">
          ${draft ? `<span class="draft-label">Draft · tap to continue</span><span class="draft">${esc(draft)}</span>` : `<span class="ph">What do you remember?</span>`}
        </button>
        <div class="m-capture-row">
          <button type="button" class="btn" data-action="open-capture" data-dictate="1">${ICON_MIC}<span>Dictate</span></button>
          <a class="btn" href="#import">Paste AI entry</a>
        </div>
      </div>
    </section>
    ${n ? `<p class="stats">${plural(n, 'memory', 'memories')} · ${plural(people.length, 'person', 'people')}${stories ? ` · ${stories} in Story Bank` : ''}${range ? ` · ${range}` : ''}</p>` : ''}
    ${inbox ? `<div class="notice">${plural(inbox, 'quick capture', 'quick captures')} could use a date, people, or themes. <a href="#memories?inbox=1"><strong>Review</strong></a></div>` : ''}
    ${backupDue ? `<div class="notice gray">${plural(changed, 'memory has', 'memories have')} changed since your ${S.settings.lastBackupAt ? `last backup (${fmtDate(S.settings.lastBackupAt)})` : 'first save, and there’s no backup yet'}. <button class="btn btn-sm" data-action="backup">Back up now</button></div>` : ''}
    ${recent.length ? `<div class="section-head"><h2>Recent</h2><a href="#memories?sort=updated" class="small only-desktop">View all</a></div><div class="list">${recent.map(m => cardHTML(m)).join('')}</div>` : ''}
    <div class="only-mobile" style="margin-top:14px">
      ${n ? `<a class="m-row-link" href="#memories">All ${plural(n, 'memory', 'memories')}<span class="chev">›</span></a>` : ''}
      <a class="m-row-link" href="#explore">Browse people, periods &amp; themes<span class="chev">›</span></a>
      <a class="m-row-link" href="#guided">Work through a memory<span class="chev">›</span></a>
    </div>
  `;

  const qc = $('#qc');
  qc.value = loadLocal('mb.quickDraft') || '';
  const detect = () => { $('#qc-detect').hidden = !looksStructured(qc.value); };
  detect();
  qc.addEventListener('input', debounce(() => { saveLocal('mb.quickDraft', qc.value); detect(); }, 250));
  qc.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); quickSave(false); } });

  const rf = $('#home-restore-file');
  if (rf) rf.addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) { S.settings.welcomed = true; saveSettings(); restoreFromFile(file); } });

  const q = $('#home-q'), out = $('#home-results'), starts = $('#starts');
  q.addEventListener('input', debounce(() => {
    const v = q.value.trim();
    starts.hidden = !!v;
    if (!v) { out.innerHTML = ''; return; }
    const res = search(v, live());

    out.innerHTML = res.length ? `<div class="quick-results">${res.slice(0, 5).map(r => `
      <a href="#memory/${r.m.id}"><span class="qr-title">${highlight(r.m.title || 'Untitled', r.hits)}</span>
      <span class="qr-meta">${esc([whenShort(r.m.eventDate), r.m.organization, r.m.people.slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</span></a>`).join('')}
      <a href="#memories?q=${encodeURIComponent(v)}" class="qr-all">See all ${plural(res.length, 'result')} →</a></div>`
      : `<p class="muted small" style="margin-top:10px">No matches for “${esc(v)}”. Try a single distinctive word, a person, or a year.</p>`;
  }, 120));
  $('#home-search').addEventListener('submit', e => { e.preventDefault(); q.blur(); if (q.value.trim()) go('#memories?q=' + encodeURIComponent(q.value.trim())); });
}

async function quickSave(openEditor) {
  const ta = $('#qc'); const text = ta.value.trim();
  if (!text) { toast('Type, paste, or dictate something first.'); ta.focus(); return; }
  Voice.stop();
  if (looksStructured(text)) { if (startImport(text)) { ta.value = ''; saveLocal('mb.quickDraft', ''); } return; }
  const m = blankMemory();
  m.original = text; m.title = autoTitle(text); m.titleAuto = true; m.source = 'quick';
  if (openEditor) { S.draftNew = m; ta.value = ''; saveLocal('mb.quickDraft', ''); go('#new'); return; }
  m.needsReview = true;
  await saveMemory(m);
  ta.value = ''; saveLocal('mb.quickDraft', '');
  toast('Saved.', { label: 'Add details', run: () => go('#edit/' + m.id) });
  render();
}

/* ===== Memories (list, search, filters) ===== */
function renderMemories(view, r) {
  const f = {}; for (const k of FILTER_KEYS) f[k] = r.params.get(k) || '';
  const years = yearsPresent().slice().sort();
  const sel = new Set(); let selectMode = false; let shown = 200;
  const activeCount = () => FILTER_KEYS.filter(k => k !== 'q' && k !== 'sort' && f[k]).length;

  view.innerHTML = `
    <div class="page-head"><h1>Memories</h1><div class="page-actions"><a class="btn hide-mobile" href="#guided">Work through one</a><a class="btn btn-primary" href="#new">New memory</a></div></div>
    <div class="search-row">
      <div class="search-wrap"><input id="mq" type="search" value="${esc(f.q)}" placeholder="Search all memories" autocomplete="off" enterkeyhint="search" aria-label="Search all memories"></div>
      <button class="btn" id="ftoggle" type="button" aria-expanded="false">Filters</button>
    </div>
    <div class="sheet-backdrop" id="fback"></div>
    <div class="filters" id="fpanel" hidden>
      <div class="filters-head"><h2>Filters</h2><button type="button" class="btn btn-quiet" id="fdone">Done</button></div>
      <label>Person<select data-f="person">${options(aggregate('people').map(x => x.name), f.person, 'Anyone')}</select></label>
      <label>Organization<select data-f="org">${options(aggregate('organization').map(x => x.name), f.org, 'Any')}</select></label>
      <label>Project / initiative<select data-f="project">${options(aggregate('project').map(x => x.name), f.project, 'Any')}</select></label>
      <label>Theme<select data-f="theme">${options(allThemes(), f.theme, 'Any')}</select></label>
      <label>Tag<select data-f="tag">${options(aggregate('tags').map(x => x.name).sort((a, b) => a.localeCompare(b)), f.tag, 'Any')}</select></label>
      <label>Confidence<select data-f="conf">${options(Object.entries(CONFIDENCE), f.conf, 'Any')}</select></label>
      <label>From year<select data-f="from">${options(years, f.from, 'Earliest')}</select></label>
      <label>To year<select data-f="to">${options(years, f.to, 'Latest')}</select></label>
      <label>Status<select data-f="status">${options(Object.entries(STATUS), f.status, 'Any')}</select></label>
      <label>Show<select data-f="arch">${options(Object.entries(ARCH), f.arch, 'Active memories')}</select></label>
      <label class="check"><input type="checkbox" data-f="story" ${f.story ? 'checked' : ''}> In Story Bank</label>
      <label class="check"><input type="checkbox" data-f="inbox" ${f.inbox ? 'checked' : ''}> Needs details</label>
      <div style="align-self:end"><button type="button" class="btn btn-quiet" data-action="clear-filters">Clear filters</button></div>
    </div>
    <div id="chips-active" class="active-filters"></div>
    <div id="person-head"></div>
    <div class="list-head">
      <span id="count" class="muted"></span><span class="spacer"></span>
      <select id="sort" aria-label="Sort"></select>
      <button class="btn btn-quiet" id="selbtn" type="button">Select</button>
    </div>
    <div id="list" class="list"></div>
    <div id="more"></div>
    <p class="search-note muted small">Search matches words, word variations (hire, hired, hiring), close spellings, and your <a href="#data/synonyms">synonym list</a>. It is keyword matching, not AI understanding. Put phrases in quotes for exact matches.${S.memories.some(m => m.archived) ? ` Archived memories are left out unless you choose them under Filters → Show.` : ''}${trash().length ? ` <a href="#trash">Recently deleted (${trash().length})</a>` : ''}</p>
    <div id="selbar" class="selbar" hidden>
      <span class="count" id="selcount">0 selected</span>
      <button class="btn btn-sm" type="button" id="selall">Select all</button>
      <button class="btn btn-sm" type="button" id="selexport">Export .md</button>
      <button class="btn btn-sm" type="button" id="selcopy">Copy</button>
      <button class="btn btn-sm" type="button" id="seldone">Done</button>
    </div>`;

  const fpanel = $('#fpanel'), ftoggle = $('#ftoggle');
  const syncToggle = () => { const n = activeCount(); ftoggle.textContent = n ? `Filters (${n})` : 'Filters'; ftoggle.setAttribute('aria-expanded', !fpanel.hidden); };
  if (activeCount() && !isPhone()) fpanel.hidden = false;
  const fback = $('#fback');
  const closeSheet = () => { fpanel.classList.remove('sheet-open'); fback.classList.remove('on'); fpanel.hidden = true; syncToggle(); };
  ftoggle.addEventListener('click', () => {
    if (isPhone()) { fpanel.hidden = false; fpanel.classList.add('sheet-open'); fback.classList.add('on'); fpanel.scrollTop = 0; }
    else fpanel.hidden = !fpanel.hidden;
    syncToggle();
  });
  $('#fdone').addEventListener('click', closeSheet);
  fback.addEventListener('click', closeSheet);

  let current = [];
  function results() {
    let list = applyFilters(S.memories, f);
    if (f.q.trim()) {
      const res = search(f.q, list);
      if (f.sort && f.sort !== 'relevance') { const order = sortList(res.map(x => x.m), f.sort); const map = new Map(res.map(x => [x.m.id, x])); return order.map(m => map.get(m.id)); }
      return res;
    }
    return sortList(list, f.sort || 'event').map(m => ({ m, hits: null }));
  }
  function update() {
    const qs = filterQS(f);
    history.replaceState(null, '', '#memories' + qs); S.prevHash = location.hash;
    syncToggle();
    // sort options depend on whether there's a query
    const sortOpts = [...(f.q.trim() ? [['relevance', 'Best match']] : []), ['event', 'Newest events'], ['event-asc', 'Oldest events'], ['created', 'Recently added'], ['updated', 'Recently edited'], ['title', 'Title A–Z']];
    const sortSel = $('#sort'); const want = f.sort || (f.q.trim() ? 'relevance' : 'event');
    sortSel.innerHTML = sortOpts.map(([v, l]) => `<option value="${v}" ${v === want ? 'selected' : ''}>${l}</option>`).join('');
    // active filter chips
    $('#chips-active').innerHTML = Object.keys(FILTER_LABELS).filter(k => f[k]).map(k => {
      const val = k === 'conf' ? CONFIDENCE[f[k]] : k === 'status' ? STATUS[f[k]] : k === 'arch' ? ARCH[f[k]] : (k === 'story' || k === 'inbox') ? '' : f[k];

      return `<button class="chip chip-person" type="button" data-clear="${k}">${FILTER_LABELS[k]}${val ? ': ' + esc(val) : ''} <span aria-hidden="true">×</span></button>`;
    }).join('');
    // person header
    const ph = $('#person-head');
    if (f.person && !f.q.trim()) {
      const mine = S.memories.filter(m => m.people.some(p => norm(p) === norm(f.person)));
      const e = aggregate('people').find(x => norm(x.name) === norm(f.person)) || { count: 0 };
      const orgs = uniqCI(mine.map(m => m.organization).filter(Boolean));
      const co = new Map(); mine.forEach(m => m.people.forEach(p => { if (norm(p) !== norm(f.person)) co.set(p, (co.get(p) || 0) + 1); }));
      const coTop = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      ph.innerHTML = `<div class="person-head"><h2>${esc(f.person)}</h2><p>${plural(e.count, 'memory', 'memories')}${spanText(e) ? ` · ${spanText(e)}` : ''}${orgs.length ? ` · ${esc(orgs.join(', '))}` : ''}</p>
        ${coTop.length ? `<p style="margin-top:8px">Often appears with: </p><div class="chips" style="margin-top:6px">${coTop.map(([p, c]) => `<a class="chip" href="#memories?person=${encodeURIComponent(p)}">${esc(p)} <span class="chip-count">${c}</span></a>`).join('')}</div>` : ''}</div>`;
    } else ph.innerHTML = '';
    current = results();
    $('#count').textContent = f.q.trim() ? `${plural(current.length, 'match', 'matches')}` : plural(current.length, 'memory', 'memories');
    const listEl = $('#list');
    if (!S.memories.length) listEl.innerHTML = `<div class="empty"><h3>No memories yet</h3><p>Capture your first one on <a href="#home">Home</a>, or <a href="#guided">work through a memory</a>.</p></div>`;
    else if (!current.length) listEl.innerHTML = `<div class="empty"><h3>Nothing matches</h3><p>Try fewer or different words, a person’s first name, or clear some filters.</p></div>`;
    else listEl.innerHTML = current.slice(0, shown).map(x => cardHTML(x.m, { hits: x.hits, select: selectMode, selected: sel.has(x.m.id) })).join('');
    $('#more').innerHTML = current.length > shown ? `<div class="row-actions"><button class="btn" type="button" id="showmore">Show all ${current.length}</button></div>` : '';
    const sm = $('#showmore'); if (sm) sm.onclick = () => { shown = Infinity; update(); };
    updateSelbar();
  }
  function updateSelbar() { $('#selbar').hidden = !selectMode; $('#selcount').textContent = `${sel.size} selected`; $('#selbtn').textContent = selectMode ? 'Cancel' : 'Select'; }

  $('#mq').addEventListener('input', debounce(e => { f.q = e.target.value; if (!f.q.trim() && f.sort === 'relevance') f.sort = ''; update(); }, 150));
  $('#mq').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $$('[data-f]', view).forEach(el => el.addEventListener('change', () => { f[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value; update(); }));
  $('#sort').addEventListener('change', e => { f.sort = e.target.value; update(); });
  $('#chips-active').addEventListener('click', e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const k = b.dataset.clear; f[k] = '';
    const ctl = $(`[data-f="${k}"]`, view); if (ctl) { if (ctl.type === 'checkbox') ctl.checked = false; else ctl.value = ''; }
    update();
  });
  view.querySelector('[data-action="clear-filters"]').addEventListener('click', e => {
    e.stopPropagation();
    for (const k of Object.keys(FILTER_LABELS)) f[k] = '';
    $$('[data-f]', view).forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
    update();
  });
  $('#selbtn').addEventListener('click', () => { selectMode = !selectMode; if (!selectMode) sel.clear(); update(); });
  $('#list').addEventListener('change', e => { if (e.target.classList.contains('selbox')) { e.target.checked ? sel.add(e.target.dataset.id) : sel.delete(e.target.dataset.id); updateSelbar(); } });
  $('#selall').addEventListener('click', () => { const all = current.every(x => sel.has(x.m.id)); current.forEach(x => all ? sel.delete(x.m.id) : sel.add(x.m.id)); update(); });
  const selected = () => current.map(x => x.m).filter(m => sel.has(m.id));
  $('#selexport').addEventListener('click', () => { const l = selected(); if (!l.length) return toast('Select at least one memory.'); download(`memories-${today()}.md`, memoriesToMarkdown(l, 'Selected memories'), 'text/markdown'); });
  $('#selcopy').addEventListener('click', async () => { const l = selected(); if (!l.length) return toast('Select at least one memory.'); toast(await copyText(memoriesToMarkdown(l, 'Selected memories')) ? `Copied ${plural(l.length, 'memory', 'memories')}.` : 'Copy failed. Use Export instead.'); });
  $('#seldone').addEventListener('click', () => { selectMode = false; sel.clear(); update(); });
  update();
}

/* ===== Memory detail ===== */
function renderDetail(view, r) {
  const m = byId(r.arg);
  if (!m) {
    const t = trash().find(x => x.id === r.arg);
    view.innerHTML = t ? `<div class="empty"><h3>This memory was deleted</h3><p>“${esc(t.memory.title || 'Untitled')}” was deleted ${fmtDate(t.deletedAt)}. It can still be restored.</p><div class="row-actions" style="justify-content:center"><button class="btn btn-primary" data-action="trash-restore" data-id="${esc(t.id)}">Restore</button><a class="btn" href="#trash">Recently deleted</a></div></div>`
      : `<div class="empty"><h3>Memory not found</h3><p>It may have been deleted. <a href="#memories">Back to memories</a></p></div>`;
    return;
  }
  const chipLinks = (vals, key, cls = '') => vals.map(v => `<a class="chip ${cls}" href="#memories?${key}=${encodeURIComponent(v)}">${esc(v)}</a>`).join('');
  const section = (title, text, extra = '') => isBlank(text) ? '' : `<section class="detail-section"><h2>${title}</h2><div class="prose ${extra}">${linkify(text.trim())}</div></section>`;
  const badges = [
    m.sample && '<span class="badge">Sample</span>', m.story.starred && '<span class="badge badge-navy">Story Bank</span>',
    m.needsReview && '<span class="badge badge-outline">Needs details</span>',
    m.archived && '<span class="badge badge-outline">Archived</span>'
  ].filter(Boolean).join('');
  const rel = relatedMemories(m);
  const metaBits = [
    m.eventDate && `<span><strong>When</strong> ${esc(whenLong(m.eventDate))}</span>`,
    m.organization && `<span><strong>Organization</strong> <a href="#memories?org=${encodeURIComponent(m.organization)}">${esc(m.organization)}</a></span>`,
    m.project && `<span><strong>Project</strong> <a href="#memories?project=${encodeURIComponent(m.project)}">${esc(m.project)}</a></span>`,
    m.confidence && `<span><strong>Details</strong> ${CONFIDENCE[m.confidence].toLowerCase()}</span>`,
    m.status && `<span><strong>Status</strong> ${STATUS[m.status].toLowerCase()}</span>`
  ].filter(Boolean).join('');
  detailHeader(m);
  const onlyOriginal = isBlank(m.narrative) && isBlank(m.involvement) && isBlank(m.outcome) && isBlank(m.lessons);

  view.innerHTML = `
    <div class="detail">
      <button class="back" data-action="back">← Back</button>
      <header class="detail-head">
        ${badges ? `<div class="badges">${badges}</div>` : ''}
        <h1>${esc(m.title || 'Untitled memory')}</h1>
        ${metaBits ? `<div class="detail-meta">${metaBits}</div>` : `<div class="detail-meta"><span class="muted">No date or details yet. <a href="#edit/${m.id}">Add some</a></span></div>`}
      </header>
      ${(m.people.length || m.themes.length || m.tags.length) ? `<div class="detail-tags">
        ${m.people.length ? `<div class="row"><span class="row-label">People</span><div class="chips">${chipLinks(m.people, 'person', 'chip-person')}</div></div>` : ''}
        ${m.themes.length ? `<div class="row"><span class="row-label">Themes</span><div class="chips">${chipLinks(m.themes, 'theme')}</div></div>` : ''}
        ${m.tags.length ? `<div class="row"><span class="row-label">Tags</span><div class="chips">${m.tags.map(t => `<a class="chip chip-tag" href="#memories?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div></div>` : ''}
      </div>` : ''}
      <div class="detail-actions">
        <a class="btn btn-primary only-desktop" href="#edit/${m.id}">Edit</a>
        <button class="btn" data-action="story-edit" data-id="${m.id}">${m.story.starred ? 'Story Bank details' : 'Add to Story Bank'}</button>
        <button class="btn only-desktop" data-action="export-one" data-id="${m.id}">Export .md</button>
        <button class="btn only-desktop" data-action="copy-one" data-id="${m.id}">Copy</button>
        <button class="btn only-desktop" data-action="${m.archived ? 'unarchive' : 'archive'}" data-id="${m.id}">${m.archived ? 'Unarchive' : 'Archive'}</button>
        <button class="btn only-mobile" data-action="detail-more" data-id="${m.id}">More…</button>
        <span class="spacer"></span>
        <button class="btn btn-danger only-desktop" data-action="delete" data-id="${m.id}">Delete</button>
      </div>
      ${m.story.starred ? `<div class="story-box"><div class="section-label" style="margin:0">Story Bank</div>
        ${m.story.headline ? `<div class="headline">${esc(m.story.headline)}</div>` : ''}
        ${m.story.competencies.length ? `<div class="chips" style="margin-top:6px">${m.story.competencies.map(c => `<a class="chip" href="#story?c=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>` : ''}</div>` : ''}
      ${onlyOriginal && !isBlank(m.original) ? section('What I remember', m.original) : ''}
      ${section('What happened', m.narrative)}
      ${section('My involvement', m.involvement)}
      ${section('Outcome', m.outcome)}
      ${section('Lessons & reflections', m.lessons)}
      ${section('Uncertain details / to verify', m.uncertainties, 'uncertain-box')}
      ${section('Supporting information', m.supporting)}
      ${!onlyOriginal && !isBlank(m.original) ? section('Original recollection', m.original, 'original') : ''}
      ${m.archived ? `<div class="notice gray">Archived. It’s kept and searchable (Memories → Filters → Show), but left out of Home, the timeline and browsing. <button class="btn btn-sm" data-action="unarchive" data-id="${m.id}">Unarchive</button></div>` : ''}
      <p class="record-line">Recorded ${fmtDate(m.createdAt)} · Last edited ${fmtDate(m.updatedAt)} · ${SOURCE[m.source] || 'Written in editor'}${m.sample ? '' : ` · <a href="#history/${m.id}">Version history</a>`}</p>

      ${rel.length ? `<section class="related"><h2 style="margin-bottom:6px">Related memories</h2><p class="muted small">Shares people, a project, tags, or themes with this one.</p>
        ${rel.map(x => `<a class="rel" href="#memory/${x.o.id}"><span class="rel-title">${esc(x.o.title || 'Untitled')}</span><br><span class="rel-why">${esc(whenShort(x.o.eventDate) ? whenShort(x.o.eventDate) + ' · ' : '')}Shares: ${esc(uniqCI(x.why).slice(0, 4).join(', '))}</span></a>`).join('')}</section>` : ''}
    </div>`;
}

function detailHeader(m) { setHeader('Memory', 'Edit', () => go('#edit/' + m.id)); }

/* ===== Editor (new, edit, review imports) ===== */
function renderEditor(view, r) {
  let m, isNew = r.name === 'new';
  if (!isNew) { const ex = byId(r.arg); if (!ex) { view.innerHTML = `<div class="empty"><h3>Memory not found</h3><p><a href="#memories">Back to memories</a></p></div>`; return; } m = clone(ex); }
  else { m = S.draftNew || blankMemory(); S.draftNew = null; }
  const fromImport = isNew && m.source === 'ai' && S.importTotal > 0;
  const importPos = S.importTotal - S.importQueue.length;
  const similar = isNew ? S.memories.filter(x => fingerprint(x) === fingerprint(m) || (m.title && norm(x.title) === norm(m.title))).slice(0, 3) : [];
  const themes = uniqCI([...S.settings.themes, ...m.themes]);
  const comps = uniqCI([...S.settings.competencies, ...m.story.competencies]);
  const hasOrganized = ['narrative', 'involvement', 'outcome', 'lessons', 'uncertainties', 'supporting'].some(k => !isBlank(m[k]));
  const radio = (name, val, label, cur) => `<label><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><span>${label}</span></label>`;
  const ta = (name, label, hint, rows = 4) => `<div class="field"><label for="f-${name}">${label}${hint ? ` <span class="muted">${hint}</span>` : ''}</label><textarea id="f-${name}" name="${name}" rows="${rows}">${esc(m[name])}</textarea></div>`;

  view.innerHTML = `
    <form id="ed" class="editor" novalidate>
      <div class="page-head"><h1>${isNew ? (fromImport ? 'Review imported memory' : 'New memory') : 'Edit memory'}</h1></div>
      ${fromImport ? `<div class="notice">Entry ${importPos} of ${S.importTotal} from your AI conversation. Check the fields, adjust anything, then save.</div>` : ''}
      ${m.source === 'guided' && isNew ? `<div class="notice">Here’s what you worked through. Your answers are kept word for word in the original recollection. Adjust anything, then save.</div>` : ''}
      ${similar.length ? `<div class="notice gray">This may already be in your bank: ${similar.map(x => `<a href="#memory/${x.id}" target="_blank">${esc(x.title || 'Untitled')}</a> (recorded ${fmtDate(x.createdAt)})`).join(', ')}</div>` : ''}
      ${m.needsReview ? `<div class="notice gray">Quick capture from ${fmtDate(m.createdAt)}. Add whatever you remember; everything is optional.</div>` : ''}

      <div class="field"><label for="f-title">Title</label>
        <input id="f-title" name="title" value="${esc(m.title)}" placeholder="Short description. Leave blank to use your first sentence." autocomplete="off"></div>

      <div class="field"><label for="f-original">What do you remember? <span class="muted">Your own words, kept as written</span></label>
        <textarea id="f-original" name="original" rows="6" placeholder="Fragments are fine.">${esc(m.original)}</textarea>
        <div class="capture-bar" style="margin-top:4px">${micButton('f-original', 'ed-mic')}<span id="ed-mic" class="muted small"></span></div>
      </div>
      <div id="suggest"></div>

      <div class="grid-2">
        <div class="field"><label for="f-when">When did it happen?</label>
          <input id="f-when" name="when" value="${esc(m.eventDate ? m.eventDate.text : '')}" placeholder="July 2024, summer 2023, around 2019…" autocomplete="off">
          <div class="hint" id="when-preview"></div>
          <label class="check"><input type="checkbox" name="approx" ${m.eventDate && m.eventDate.approx ? 'checked' : ''}> Date is approximate</label>
        </div>
        <div class="field"><label for="f-org">Organization</label>
          <input id="f-org" name="organization" value="${esc(m.organization)}" list="dl-orgs" autocomplete="off" placeholder="Team, company, or organization"></div>
      </div>
      <div class="field"><label>People involved</label>${chipInput('people', m.people, 'dl-people', 'Add a name, then press Enter')}</div>
      <div class="field"><label for="f-project">Project or initiative</label>
        <input id="f-project" name="project" value="${esc(m.project)}" list="dl-projects" autocomplete="off" placeholder="Optional"></div>
      <div class="field"><label>Themes <span class="muted">— choose any that fit</span></label>
        <div class="theme-picker" id="theme-picker">${themes.map(t => `<button type="button" class="chip theme-opt" data-action="toggle-theme" data-value="${esc(t)}" aria-pressed="${m.themes.some(x => norm(x) === norm(t))}">${esc(t)}</button>`).join('')}</div>
        <div class="inline-add"><input id="new-theme" placeholder="Add a new theme" autocomplete="off"><button type="button" class="btn btn-sm" data-action="add-theme">Add</button></div>
      </div>
      <div class="field"><label>Tags <span class="muted">— specific words you might search for later</span></label>${chipInput('tags', m.tags, 'dl-tags', 'Add a tag, then press Enter')}</div>

      <details class="fold" ${hasOrganized ? 'open' : ''}>
        <summary>Organize the details <span class="muted" style="font-weight:400">(optional)</span></summary>
        ${ta('narrative', 'What happened', '— a coherent account', 5)}
        ${ta('involvement', 'My involvement', '— what I did or contributed')}
        ${ta('outcome', 'Outcome', '— what resulted, or where it stands')}
        ${ta('lessons', 'Lessons & reflections', '— what I learned or would do differently')}
        ${ta('uncertainties', 'Uncertain details', '— things to verify', 3)}
        ${ta('supporting', 'Supporting information', '— links, documents, quotes, numbers', 3)}
      </details>

      <div class="grid-2">
        <div class="field"><label>How sure are you of the details?</label>
          <div class="seg">${radio('confidence', '', 'Not set', m.confidence)}${radio('confidence', 'confirmed', 'Confirmed', m.confidence)}${radio('confidence', 'approximate', 'Approximate', m.confidence)}${radio('confidence', 'uncertain', 'Uncertain', m.confidence)}</div></div>
        <div class="field"><label>Where does it stand?</label>
          <div class="seg">${radio('status', '', 'Not set', m.status)}${radio('status', 'resolved', 'Resolved', m.status)}${radio('status', 'ongoing', 'Ongoing', m.status)}${radio('status', 'reflective', 'Reflection', m.status)}</div></div>
      </div>

      <details class="fold" ${m.story.starred ? 'open' : ''}>
        <summary>Story Bank <span class="muted" style="font-weight:400">(professional examples)</span></summary>
        <label class="check"><input type="checkbox" name="story" ${m.story.starred ? 'checked' : ''}> Mark as a professional story I could use in interviews</label>
        <div class="field"><label for="f-headline">Headline <span class="muted">— one sentence to introduce it</span></label><input id="f-headline" name="headline" value="${esc(m.story.headline)}" autocomplete="off"></div>
        <fieldset class="comp-list"><legend>Demonstrates</legend>
          ${comps.map(c => `<label class="check"><input type="checkbox" name="comp" value="${esc(c)}" ${m.story.competencies.some(x => norm(x) === norm(c)) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}
        </fieldset>
      </details>

      <div class="editor-actions">
        <button type="button" class="btn" data-action="editor-cancel">Cancel</button>
        ${fromImport && S.importQueue.length ? `<button type="button" class="btn btn-quiet" data-action="editor-skip">Skip this one</button>` : ''}
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary">Save memory</button>
      </div>
      ${datalist('dl-people', aggregate('people').map(x => x.name))}
      ${datalist('dl-orgs', aggregate('organization').map(x => x.name))}
      ${datalist('dl-projects', aggregate('project').map(x => x.name))}
      ${datalist('dl-tags', aggregate('tags').map(x => x.name))}
    </form>`;

  const form = $('#ed');
  setHeader(fromImport ? 'Review Entry' : isNew ? 'New Memory' : 'Edit Memory', 'Save', () => (form.requestSubmit ? form.requestSubmit() : $('button[type=submit]', form).click()));
  const whenInput = $('#f-when'), preview = $('#when-preview');
  const showWhen = (auto) => {
    const v = whenInput.value.trim();
    if (!v) { preview.textContent = 'Optional. A year or season is fine.'; return; }
    const p = parseWhen(v);
    preview.textContent = p ? `Read as: ${p.label}${p.approx ? ' (approximate)' : ''}` : 'Kept as written. It won’t be placed on the timeline by date.';
    if (auto && p && p.approx) form.approx.checked = true;
  };
  showWhen(false);
  whenInput.addEventListener('input', () => showWhen(true));
  form.addEventListener('input', () => { S.dirty = true; });
  const updSuggest = () => renderSuggestions(form);
  updSuggest();
  $('#f-original').addEventListener('input', debounce(updSuggest, 400));
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    Voice.stop();
    const fd = new FormData(form);
    const prevTitle = m.title;
    for (const k of ['title', 'original', 'organization', 'project', 'narrative', 'involvement', 'outcome', 'lessons', 'uncertainties', 'supporting']) m[k] = String(fd.get(k) || '').trim();
    m.eventDate = buildEventDate(fd.get('when'), fd.get('approx') === 'on');
    m.people = chipValues(form, 'people');
    m.tags = chipValues(form, 'tags');
    m.themes = $$('.theme-opt[aria-pressed="true"]', form).map(b => b.dataset.value);
    m.confidence = fd.get('confidence') || '';
    m.status = fd.get('status') || '';
    m.story = { starred: fd.get('story') === 'on', headline: String(fd.get('headline') || '').trim(), competencies: fd.getAll('comp').map(String) };
    if (!hasContent(m)) { toast('Write at least a few words about what you remember.'); $('#f-original').focus(); return; }
    if (!m.title) { m.title = autoTitle(m.original || m.narrative || m.involvement || m.outcome || m.lessons); m.titleAuto = true; }
    else if (m.title !== prevTitle) m.titleAuto = false;
    if (m.story.starred) { const known = new Set(S.settings.competencies.map(norm)); const add = m.story.competencies.filter(c => !known.has(norm(c))); if (add.length) { S.settings.competencies.push(...add); await saveSettings(); } }
    m.needsReview = false;
    await saveMemory(m);
    S.dirty = false;
    if (fromImport && S.importQueue.length) { toast(`Saved. Next entry (${importPos + 1} of ${S.importTotal}).`); nextImport(); return; }
    S.importQueue = []; S.importTotal = 0;
    if (S.captureHandoff) { clearCaptureDraft(); S.captureHandoff = false; }
    toast(isNew ? 'Memory saved.' : 'Changes saved.');
    go('#memory/' + m.id, { replace: isNew });
  });
}

const THEME_HINTS = {
  'Personnel & Hiring Decisions': ['hire', 'hiring', 'hired', 'candidate', 'interview', 'promot', 'fired', 'let go', 'released', 'reassign'],
  'Player Development': ['player', 'prospect', 'pitcher', 'hitter', 'athlete', 'development plan'],
  'Staff Development & Mentorship': ['mentor', 'staff development', 'train the', 'coaching staff', 'grow as a coach', 'professional development'],
  'Leadership & Management': ['led ', 'leading', 'manag', 'my team', 'direct report', 'supervis'],
  'Organizational Challenges': ['short on', 'shortage', 'gap', 'silo', 'inefficien', 'breakdown', 'understaff', 'budget'],
  'Projects & Initiatives': ['initiative', 'project', 'program', 'launched', 'rolled out', 'built', 'set up', 'organized', 'organizing'],
  'Strategy & Decision-Making': ['decid', 'decision', 'strategy', 'trade-off', 'tradeoff', 'chose'],
  'Accomplishments & Results': ['improv', 'increase', 'award', 'success', 'record', 'reduced', 'saved'],
  'Relationships & Conversations': ['conversation', 'talked', 'told me', 'meeting with', 'relationship', 'communicat'],
  'Mistakes & Lessons Learned': ['mistake', 'should have', 'lesson', 'regret', 'went wrong', 'misjudg', 'failed'],
  'Career Development': ['promotion', 'new job', 'career', 'job offer', 'interviewed for', 'my role'],
  'Personal Reflections': ['i felt', 'i realized', 'looking back', 'reflect', 'i wonder']
};
function renderSuggestions(form) {
  const box = $('#suggest'); if (!box) return;
  const text = $('#f-original').value; const t = ' ' + norm(text) + ' ';
  if (text.trim().length < 12) { box.innerHTML = ''; return; }
  const have = new Set(chipValues(form, 'people').map(norm));
  const people = aggregate('people').map(x => x.name).filter(p => !have.has(norm(p)) && new RegExp(`\\b${escRe(norm(p))}\\b`).test(t)).slice(0, 5);
  const orgVal = norm(form.organization.value);
  const orgs = !orgVal ? aggregate('organization').map(x => x.name).filter(o => o.length > 2 && t.includes(norm(o))).slice(0, 2) : [];
  const dates = [];
  if (!form.when.value.trim()) {
    const re = /\b((?:early|mid|late)\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|spring training|spring|summer|fall|autumn|winter)\s+(?:of\s+)?((?:19|20)\d{2})\b|\b((?:19|20)\d{2})\b/gi;
    for (const mt of text.matchAll(re)) { const s = mt[0].replace(/\s+of\s+/i, ' '); if (parseWhen(s) && !dates.some(d => norm(d) === norm(s))) dates.push(s); if (dates.length >= 3) break; }
  }
  const chosen = new Set($$('.theme-opt[aria-pressed="true"]', form).map(b => norm(b.dataset.value)));
  const themes = Object.entries(THEME_HINTS).filter(([th, words]) => !chosen.has(norm(th)) && S.settings.themes.some(x => norm(x) === norm(th)) && words.some(w => t.includes(w))).map(([th]) => th).slice(0, 4);
  if (!people.length && !orgs.length && !dates.length && !themes.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="suggest"><div class="small muted">Suggestions from your words. Tap to add; nothing is added automatically.</div><div class="chips">
    ${dates.map(d => `<button type="button" class="chip" data-action="sg-date" data-value="${esc(d)}">When: ${esc(d)}</button>`).join('')}
    ${people.map(p => `<button type="button" class="chip chip-person" data-action="sg-person" data-value="${esc(p)}">+ ${esc(p)}</button>`).join('')}
    ${orgs.map(o => `<button type="button" class="chip" data-action="sg-org" data-value="${esc(o)}">Organization: ${esc(o)}</button>`).join('')}
    ${themes.map(th => `<button type="button" class="chip" data-action="sg-theme" data-value="${esc(th)}">+ ${esc(th)}</button>`).join('')}
  </div></div>`;
}

/* ===== Timeline ===== */
function renderTimeline(view, r, explore = false) {
  const by = r.params.get('by') === 'recorded' ? 'recorded' : 'event';
  const asc = r.params.get('order') === 'asc';
  const items = [], undated = [];
  for (const m of live()) {
    if (by === 'recorded') {
      const d = new Date(m.createdAt); const key = m.createdAt;
      items.push({ m, key, y: String(d.getFullYear()), mo: d.getMonth() + 1, label: `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}` });
    } else {
      const ev = m.eventDate;
      if (!ev || !ev.start) { undated.push(m); continue; }
      const p = ev.precision; const mo = (p === 'day' || p === 'month') ? +ev.start.slice(5, 7) : 0;
      const label = p === 'day' ? `${MONTH_SHORT[mo - 1]} ${+ev.start.slice(8, 10)}` : p === 'month' ? MONTH_SHORT[mo - 1] : ev.label;
      items.push({ m, key: ev.start, y: ev.start.slice(0, 4), mo, label: (ev.approx ? '~' : '') + label });
    }
  }
  items.sort((a, b) => asc ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key));
  const years = [];
  for (const it of items) { let y = years.find(x => x.y === it.y); if (!y) { y = { y: it.y, groups: new Map() }; years.push(y); } if (!y.groups.has(it.mo)) y.groups.set(it.mo, []); y.groups.get(it.mo).push(it); }
  const link = (params) => (explore ? '#explore?tab=timeline&' : '#timeline?') + new URLSearchParams({ by, order: asc ? 'asc' : 'desc', ...params }).toString();
  const row = it => {
    const m = it.m;
    const meta = by === 'event'
      ? [m.organization, m.people.slice(0, 3).join(', '), `recorded ${fmtMonthYear(m.createdAt)}`]
      : [m.eventDate ? `happened ${whenShort(m.eventDate)}` : 'no event date', m.organization];
    return `<a class="tl-row" href="#memory/${m.id}"><span class="tl-date">${esc(it.label)}</span><span><span class="tl-title">${esc(m.title || 'Untitled')}</span><span class="tl-meta">${esc(meta.filter(Boolean).join(' · '))}</span></span></a>`;
  };
  view.innerHTML = `
    ${explore ? `<div class="page-head"><h1>Explore</h1></div>${exploreTabs('timeline')}` : `<div class="page-head"><h1>Timeline</h1></div>`}
    <div class="toolbar">
      <div class="seg-links" role="group" aria-label="Arrange by">
        <a href="${link({ by: 'event' })}" class="${by === 'event' ? 'on' : ''}">When it happened</a>
        <a href="${link({ by: 'recorded' })}" class="${by === 'recorded' ? 'on' : ''}">When I recorded it</a>
      </div>
      <div class="seg-links" role="group" aria-label="Order">
        <a href="${link({ order: 'desc' })}" class="${!asc ? 'on' : ''}">Newest first</a>
        <a href="${link({ order: 'asc' })}" class="${asc ? 'on' : ''}">Oldest first</a>
      </div>
    </div>
    ${years.length > 1 ? `<div class="year-jump">${years.map(y => `<button type="button" class="chip" data-action="jump" data-y="${y.y}">${y.y}</button>`).join('')}${undated.length ? `<button type="button" class="chip dim" data-action="jump" data-y="undated">Undated</button>` : ''}</div>` : ''}
    ${!S.memories.length ? `<div class="empty"><h3>Nothing on the timeline yet</h3><p>Memories with a date, even an approximate one like “summer 2023,” appear here.</p></div>` : ''}
    ${years.map(y => {
      const months = [...y.groups.keys()].sort((a, b) => a === 0 ? -1 : b === 0 ? 1 : asc ? a - b : b - a);
      const count = [...y.groups.values()].reduce((s, g) => s + g.length, 0);
      return `<section class="tl-year"><h2 id="y-${y.y}">${y.y} <span class="muted">${plural(count, 'memory', 'memories')}</span></h2>
        ${months.map(mo => `<div class="tl-month"><h3>${mo === 0 ? `Broader period` : MONTH_NAMES[mo - 1]}</h3>${y.groups.get(mo).map(row).join('')}</div>`).join('')}</section>`;
    }).join('')}
    ${undated.length && by === 'event' ? `<section class="tl-year"><h2 id="y-undated">No date recorded <span class="muted">${undated.length}</span></h2>
      <p class="muted small" style="margin-top:8px">Add even a rough date (“around 2019”) to place these on the timeline.</p>
      ${undated.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(m => `<a class="tl-row" href="#memory/${m.id}"><span class="tl-date">${m.eventDate ? esc(clip(m.eventDate.text, 18)) : '—'}</span><span><span class="tl-title">${esc(m.title || 'Untitled')}</span><span class="tl-meta">recorded ${fmtDate(m.createdAt)}</span></span></a>`).join('')}</section>` : ''}`;
}

/* ===== People & Themes ===== */
const BROWSE_TABS = [['people', 'People', 'people', 'person'], ['orgs', 'Organizations', 'organization', 'org'], ['projects', 'Projects', 'project', 'project'], ['themes', 'Themes', 'themes', 'theme'], ['tags', 'Tags', 'tags', 'tag']];
function renderBrowse(view, r, explore = false) {
  const tab = BROWSE_TABS.find(t => t[0] === r.params.get('tab')) || BROWSE_TABS[0];
  const [key, label, field, param] = tab;
  let sortMode = 'count';
  view.innerHTML = `
    ${explore ? `<div class="page-head"><h1>Explore</h1></div>${exploreTabs(key)}` : `<div class="page-head"><h1>People &amp; Themes</h1></div>
    <p class="page-sub">Start from whoever or whatever you remember. Select a name to see every memory connected to it.</p>
    <nav class="tabs">${BROWSE_TABS.map(t => `<a href="#browse?tab=${t[0]}" class="${t[0] === key ? 'on' : ''}">${t[1]}</a>`).join('')}</nav>`}
    <div class="b-tools"><input id="bfilter" type="search" placeholder="Filter ${label.toLowerCase()}" autocomplete="off" aria-label="Filter ${label.toLowerCase()}">
      <select id="bsort" aria-label="Sort"><option value="count">Most memories</option><option value="name">A–Z</option><option value="recent">Most recent</option></select></div>
    <div id="blist"></div>
    ${field === 'themes' ? `<div class="inline-add" style="margin-top:16px"><input id="add-theme-browse" placeholder="Add a theme" autocomplete="off"><button class="btn btn-sm" data-action="browse-add-theme">Add theme</button></div>` : ''}
    <p class="muted small" style="margin-top:16px">Rename fixes a spelling everywhere at once. Renaming to an existing name merges the two.</p>`;
  const draw = () => {
    let rows = aggregate(field);
    if (field === 'themes') for (const t of S.settings.themes) if (!rows.some(x => norm(x.name) === norm(t))) rows.push({ name: t, count: 0, min: null, max: null });
    const q = norm($('#bfilter').value);
    if (q) rows = rows.filter(x => norm(x.name).includes(q));
    if (sortMode === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === 'recent') rows.sort((a, b) => (b.max || '').localeCompare(a.max || '') || b.count - a.count);
    else rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    $('#blist').innerHTML = rows.length ? rows.map(x => `<div class="b-row">
        <a class="b-main" href="#memories?${param}=${encodeURIComponent(x.name)}"><span class="b-name">${esc(x.name)}</span><span class="b-meta">${plural(x.count, 'memory', 'memories')}${spanText(x) ? ' · ' + spanText(x) : ''}</span></a>
        <button class="btn btn-quiet btn-sm" data-action="rename" data-kind="${field}" data-value="${esc(x.name)}">Rename</button>
        ${field === 'themes' ? `<button class="btn btn-quiet btn-sm" data-action="remove-theme" data-value="${esc(x.name)}">Remove</button>` : ''}
      </div>`).join('') : `<div class="empty"><p>${q ? 'No matches.' : `No ${label.toLowerCase()} recorded yet.`}</p></div>`;
  };
  $('#bfilter').addEventListener('input', draw);
  $('#bsort').addEventListener('change', e => { sortMode = e.target.value; draw(); });
  draw();
}
async function renameValue(field, from, to) {
  const changed = [];
  for (const m of S.memories) {
    if (Array.isArray(m[field])) {
      if (m[field].some(v => norm(v) === norm(from))) { m[field] = uniqCI(m[field].map(v => norm(v) === norm(from) ? to : v)); changed.push(m); }
    } else if (norm(m[field]) === norm(from)) { m[field] = to; changed.push(m); }
  }
  const t = nowISO(); changed.forEach(m => { m.updatedAt = t; m.rev = (m.rev || 0) + 1; });
  if (changed.length) await saveMany(changed);
  if (field === 'themes') { S.settings.themes = uniqCI(S.settings.themes.map(v => norm(v) === norm(from) ? to : v)); await saveSettings(); }
  buildIndex();
  return changed.length;
}

/* ===== Story Bank ===== */
function renderStory(view, r) {
  const comp = r.params.get('c') || '';
  const stories = live().filter(m => m.story && m.story.starred).sort((a, b) => ((b.eventDate && b.eventDate.start) || '').localeCompare((a.eventDate && a.eventDate.start) || ''));
  const comps = uniqCI([...S.settings.competencies, ...stories.flatMap(m => m.story.competencies)]);
  const count = c => stories.filter(m => m.story.competencies.some(x => norm(x) === norm(c))).length;
  const shown = comp ? stories.filter(m => m.story.competencies.some(x => norm(x) === norm(comp))) : stories;
  const gaps = comps.filter(c => !count(c));
  const sel = new Set();
  view.innerHTML = `
    <div class="page-head"><h1>Story Bank</h1><div class="page-actions"><button class="btn btn-quiet" data-action="edit-comps">Edit competencies</button></div></div>
    <p class="page-sub">Memories you’ve marked as professional examples. Each one links to the original memory; nothing is duplicated.</p>
    ${stories.length ? `
      <div class="chips" style="margin-bottom:6px"><a class="chip ${!comp ? 'on' : ''}" href="#story">All <span class="chip-count">${stories.length}</span></a>
        ${comps.map(c => `<a class="chip ${norm(c) === norm(comp) ? 'on' : ''} ${count(c) ? '' : 'dim'}" href="#story?c=${encodeURIComponent(c)}">${esc(c)} <span class="chip-count">${count(c)}</span></a>`).join('')}</div>
      ${gaps.length ? `<p class="gaps">No stories yet for: ${esc(gaps.join('; '))}.</p>` : ''}
      <div class="list-head"><span class="muted">${plural(shown.length, 'story', 'stories')}${comp ? ` demonstrating “${esc(comp)}”` : ''}</span><span class="spacer"></span>
        <button class="btn btn-sm" id="st-all" type="button">Select all</button>
        <button class="btn btn-sm" id="st-copy" type="button">Copy</button>
        <button class="btn btn-sm btn-primary" id="st-export" type="button">Export reference (.md)</button></div>
      <div class="list">${shown.map(m => `
        <article class="card mem-card story-card">
          <label class="sel"><input type="checkbox" class="selbox" data-id="${m.id}" aria-label="Select ${esc(m.title)}" style="width:18px;height:18px;accent-color:var(--navy)"></label>
          <a class="card-link" href="#memory/${m.id}">
            <div class="card-top"><h3>${esc(m.title || 'Untitled')}</h3>${m.confidence && m.confidence !== 'confirmed' ? `<span class="badge">${CONFIDENCE[m.confidence]}</span>` : ''}</div>
            <div class="meta">${esc([whenShort(m.eventDate), m.organization].filter(Boolean).join(' · '))}</div>
            ${m.story.headline ? `<div class="headline">${esc(m.story.headline)}</div>` : ''}
            ${m.story.competencies.length ? `<div class="chips">${m.story.competencies.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
          </a></article>`).join('')}</div>
      <p class="muted small" style="margin-top:14px">Export uses the selected stories, or everything shown if none are selected. Approximate details are flagged in the export so you can verify them first.</p>`
    : `<div class="empty"><h3>No stories yet</h3><p>Open any memory and choose <strong>Add to Story Bank</strong>, then tag what it demonstrates, such as making difficult decisions or developing staff.</p>
       <p class="small">Competencies you’re tracking: ${esc(comps.join('; '))}</p></div>`}`;
  if (!stories.length) return;
  const list = $('.list', view);
  list.addEventListener('change', e => { if (e.target.classList.contains('selbox')) e.target.checked ? sel.add(e.target.dataset.id) : sel.delete(e.target.dataset.id); });
  const chosen = () => { const l = shown.filter(m => sel.has(m.id)); return l.length ? l : shown; };
  $('#st-all').addEventListener('click', () => { const all = shown.every(m => sel.has(m.id)); $$('.selbox', list).forEach(b => { b.checked = !all; all ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); }); });
  $('#st-export').addEventListener('click', () => download(`story-bank-${today()}.md`, storiesToMarkdown(chosen()), 'text/markdown'));
  $('#st-copy').addEventListener('click', async () => toast(await copyText(storiesToMarkdown(chosen())) ? 'Copied as Markdown.' : 'Copy failed. Use Export instead.'));
}
async function editStory(m) {
  const comps = uniqCI([...S.settings.competencies, ...m.story.competencies]);
  const body = `
    <label class="check"><input type="checkbox" name="starred" checked> Include in Story Bank</label>
    <div class="field"><label>Headline <span class="muted">(optional)</span></label><input name="headline" value="${esc(m.story.headline)}" placeholder="One sentence to introduce this story" autocomplete="off"></div>
    <fieldset class="comp-list"><legend>Demonstrates</legend>${comps.map(c => `<label class="check"><input type="checkbox" name="comp" value="${esc(c)}" ${m.story.competencies.some(x => norm(x) === norm(c)) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</fieldset>`;
  const r = await modal(m.story.starred ? 'Story Bank details' : 'Add to Story Bank', body, [{ label: 'Save', value: 'ok', cls: 'btn-primary' }, { label: 'Cancel', value: 'cancel' }]);
  if (r.value !== 'ok') return;
  const updated = clone(m);
  updated.story = { starred: r.data.get('starred') === 'on', headline: String(r.data.get('headline') || '').trim(), competencies: r.data.getAll('comp').map(String) };
  await saveMemory(updated);
  toast(updated.story.starred ? 'Saved to Story Bank.' : 'Removed from Story Bank.');
  render();
}

/* ===== Guided reconstruction ===== */
const GUIDED_QS = [
  { key: 'happening', q: 'What do you remember happening?', hint: 'Start anywhere. Fragments, a single image, or a feeling are all fine.', type: 'long' },
  { key: 'when', q: 'Roughly when did this occur?', hint: '“Summer 2023,” “spring training a few years ago,” “around 2019.” Rough is fine.', type: 'short' },
  { key: 'where', q: 'Where were you working, or which organization was this with?', type: 'short' },
  { key: 'people', q: 'Who was involved?', hint: 'Names separated by commas. First names are fine.', type: 'short' },
  { key: 'context', q: 'What led to this situation?', type: 'long' },
  { key: 'involvement', q: 'What did you personally do?', hint: 'What you said, decided, organized, or tried.', type: 'long' },
  { key: 'challenge', q: 'Was there a decision or particular challenge?', type: 'long' },
  { key: 'after', q: 'What happened afterward?', hint: 'It’s fine if it’s still unfolding or you aren’t sure.', type: 'long', status: true },
  { key: 'why', q: 'Why does this experience stand out to you?', hint: 'What you learned, what you’d do differently, or why it stuck.', type: 'long' },
  { key: 'confidence', q: 'How sure are you about these details?', type: 'choice' }
];
function renderGuided(view) {
  if (!S.guided) S.guided = loadLocal('mb.guided') || { step: 0, a: {} };
  const g = S.guided; const N = GUIDED_QS.length;
  g.step = Math.max(0, Math.min(g.step, N - 1));
  const q = GUIDED_QS[g.step];
  const answered = GUIDED_QS.filter(x => !isBlank(g.a[x.key])).length;
  const val = esc(g.a[q.key] || '');
  let input;
  if (q.type === 'long') input = `<textarea id="g-in" aria-label="${esc(q.q)}">${val}</textarea><div class="capture-bar">${micButton('g-in', 'g-mic')}<span id="g-mic" class="muted small"></span></div>`;
  else if (q.type === 'short') input = `<input id="g-in" value="${val}" autocomplete="off" aria-label="${esc(q.q)}" ${q.key === 'people' ? 'autocapitalize="words"' : ''}>`;
  else input = `<div class="choice-list">${[['confirmed', 'Confirmed', 'I’m confident about what happened.'], ['approximate', 'Approximate', 'Broadly right; some details are fuzzy.'], ['uncertain', 'Uncertain', 'I’d need to verify this before relying on it.']].map(([v, l, d]) => `<label class="choice"><input type="radio" name="g-conf" value="${v}" ${g.a.confidence === v ? 'checked' : ''}><span><strong>${l}</strong><span class="muted small">${d}</span></span></label>`).join('')}</div>`;
  const statusPick = q.status ? `<div class="field"><label>Where does it stand? <span class="muted">(optional)</span></label><div class="seg">${[['resolved', 'Resolved'], ['ongoing', 'Still ongoing'], ['reflective', 'More of a reflection']].map(([v, l]) => `<label><input type="radio" name="g-status" value="${v}" ${g.a.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>` : '';

  view.innerHTML = `
    <div class="guided">
      <div class="guided-top"><a href="#home" class="back" style="margin:0">← Home</a><span class="muted small">Question ${g.step + 1} of ${N}</span></div>
      <div class="progress"><span style="width:${((g.step + 1) / N) * 100}%"></span></div>
      <div class="card guided-card">
        <h1 class="guided-q">${esc(q.q)}</h1>
        ${q.hint ? `<p class="muted" style="margin:0">${esc(q.hint)}</p>` : ''}
        ${input}${statusPick}
      </div>
      <div class="guided-actions">
        <button class="btn" type="button" data-action="g-back" ${g.step === 0 ? 'disabled' : ''}>Back</button>
        <span class="spacer"></span>
        ${g.step < N - 1 ? `<button class="btn btn-quiet" type="button" data-action="g-skip">Skip</button>` : ''}
        <button class="btn btn-primary" type="button" data-action="g-next">${g.step < N - 1 ? 'Next' : 'Review & save'}</button>
      </div>
      <div class="guided-foot">
        <span class="muted small">${plural(answered, 'answer')} so far. Answer what you can and skip the rest.</span>
        <span class="spacer"></span>
        <button class="btn btn-quiet btn-sm" type="button" data-action="g-finish" ${answered ? '' : 'disabled'}>Finish now</button>
        <button class="btn btn-quiet btn-sm" type="button" data-action="g-reset">Start over</button>
      </div>
    </div>`;
  const inp = $('#g-in');
  const store = () => saveLocal('mb.guided', S.guided);
  if (inp) {
    inp.addEventListener('input', () => { g.a[q.key] = inp.value; store(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && (q.type === 'short' || e.metaKey || e.ctrlKey)) { e.preventDefault(); guidedStep(1); } });
    if (window.innerWidth > 760) inp.focus();
  }
  $$('input[name="g-conf"]', view).forEach(x => x.addEventListener('change', () => { g.a.confidence = x.value; store(); }));
  $$('input[name="g-status"]', view).forEach(x => x.addEventListener('change', () => { g.a.status = x.value; store(); }));
}
function guidedStep(delta) {
  Voice.stop();
  const g = S.guided; const N = GUIDED_QS.length;
  if (delta > 0 && g.step >= N - 1) { finishGuided(); return; }
  g.step = Math.max(0, Math.min(N - 1, g.step + delta));
  saveLocal('mb.guided', g); render();
}
function finishGuided() {
  Voice.stop();
  const a = S.guided ? S.guided.a : {};
  const v = k => String(a[k] || '').trim();
  const m = blankMemory(); m.source = 'guided';
  m.original = GUIDED_QS.filter(q => q.type !== 'choice' && v(q.key)).map(q => `${q.q}\n${v(q.key)}`).join('\n\n');
  m.narrative = [v('context') && `Background: ${v('context')}`, v('happening'), v('challenge') && `Decision or challenge: ${v('challenge')}`].filter(Boolean).join('\n\n');
  m.involvement = v('involvement');
  m.outcome = v('after');
  m.lessons = v('why');
  m.eventDate = buildEventDate(v('when'), false);
  m.organization = v('where').length <= 80 ? v('where') : '';
  if (v('where').length > 80) m.supporting = `Where: ${v('where')}`;
  m.people = uniqCI(splitList(v('people')));
  m.confidence = CONFIDENCE[a.confidence] ? a.confidence : '';
  m.status = STATUS[a.status] ? a.status : '';
  m.title = autoTitle(v('happening') || v('involvement') || v('challenge') || v('why')); m.titleAuto = true;
  if (!hasContent(m)) { toast('Answer at least one question first.'); return; }
  S.guided = null; saveLocal('mb.guided', null);
  S.draftNew = m; go('#new');
}

/* ===== AI import ===== */
function renderImport(view) {
  view.innerHTML = `
    <div class="page-head"><h1>Paste an AI entry</h1></div>
    <ol class="steps">
      <li><strong>Copy the intake prompt</strong> and paste it into ChatGPT or Claude. <button class="btn btn-sm" data-action="copy-prompt" style="margin-left:6px">Copy prompt</button></li>
      <li><strong>Talk the memory through.</strong> The assistant asks follow-up questions, then produces a block that starts with <code>=== MEMORY BANK ENTRY ===</code>.</li>
      <li><strong>Copy that block and paste it below.</strong> You’ll review every field before anything is saved.</li>
    </ol>
    <textarea id="ai-in" rows="12" placeholder="Paste the entry here. Several entries at once are fine." aria-label="AI entry"></textarea>
    <div class="row-actions"><button class="btn btn-primary" data-action="ai-read">Read entry</button><span class="muted small">No AI service is contacted. The app only reads the text you paste.</span></div>
    <div id="ai-msg"></div>
    <details class="plain"><summary>View the intake prompt</summary><pre class="prompt">${esc(INTAKE_PROMPT)}</pre></details>`;
}
function startImport(textOrEntries) {
  const entries = typeof textOrEntries === 'string' ? parseAIEntries(textOrEntries) : textOrEntries;
  if (entries && entries.backup) { toast('That’s a full backup file. Use Data → Restore instead.'); return false; }
  if (!entries || !entries.length) return false;
  S.importQueue = entries.slice(); S.importTotal = entries.length;
  nextImport(); return true;
}
function nextImport() {
  const m = S.importQueue.shift();
  if (!m) { S.importTotal = 0; go('#memories?sort=created'); return; }
  S.draftNew = m; go('#new', { replace: parseHash().name === 'capture' });
}

/* ===== Data & backup ===== */
function renderData(view, r) {
  const real = S.memories.filter(m => !m.sample).length;
  const samples = S.memories.length - real;
  const mode = isStandalone() ? 'Home Screen app' : (IS_IOS ? 'Safari' : 'Browser');
  view.innerHTML = `
    <div class="page-head"><h1>Data &amp; backup</h1></div>
    <div class="data-grid">
      <section class="card pad" id="sync-card">${syncCardHTML()}</section>
      ${IS_IOS && !isStandalone() && real && !Sync.on() ? `
      <section class="card pad highlight-card">
        <h2>Moving to the Home Screen app?</h2>
        <p>On iPhone, the Home Screen app keeps its own storage, separate from Safari. Your ${plural(real, 'memory', 'memories')} won’t appear there automatically.</p>
        <ol class="facts">
          <li>Download a backup below and save it to Files or iCloud Drive.</li>
          <li>Add Recollect to your Home Screen (Share → Add to Home Screen).</li>
          <li>Open it from the Home Screen and choose <strong>Restore from a backup</strong>.</li>
          <li>Use the Home Screen app from then on. Your Safari copy stays as a fallback until you clear it.</li>
        </ol>
        <div class="row-actions"><button class="btn btn-primary" data-action="backup">Download backup</button><button class="btn" data-action="install-steps">Home Screen steps</button></div>
      </section>` : ''}
      <section class="card pad">
        <h2>Where your memories live</h2>
        <p>${Sync.on() ? `Memories are saved in your private Recollect cloud (a database only your signed-in account can read), and a working copy is kept in this ${isStandalone() ? 'app' : 'browser'} so Recollect opens instantly and works offline.`
          : `Memories are stored in this ${isStandalone() ? 'app' : 'browser'}, on this device only. Nothing is sent anywhere; the app makes no network requests apart from loading itself and checking for cloud storage (dictation excepted, see below).`}</p>
        <dl class="kv">
          <dt>Memories</dt><dd>${real}${samples ? ` <span class="muted">(+${samples} samples)</span>` : ''}</dd>
          <dt>Running as</dt><dd>${mode}</dd>
          <dt>Storage</dt><dd>${Sync.on() ? 'Recollect cloud, with a copy on this device' : Store.db ? 'On-device database (IndexedDB)' : '<strong>Not saving on this device.</strong> Storage is blocked here.'}</dd>
          <dt>Protection</dt><dd id="persist">Checking…</dd>
          <dt>Last backup</dt><dd>${S.settings.lastBackupAt ? fmtDate(S.settings.lastBackupAt) : 'Never'}</dd>
        </dl>
        <ul class="facts">${Sync.on() ? `
          <li>Every device and browser you sign in on shows the same memories. Changes made offline upload when you reconnect.</li>
          <li>Clearing this browser’s data only removes this device’s copy; the cloud copy stays.</li>
          <li>Deleting moves a memory to Recently deleted, and every edit keeps the earlier version.</li>` : `
          <li>Each browser, device, and Home Screen app has separate storage. Move memories with a backup file.</li>
          <li>Clearing website data for this site erases its memories. Private windows don’t keep them at all.</li>
          <li>On iPhone, Safari may clear data for sites you haven’t opened in a while. The Home Screen app is exempt; regular backups protect you either way.</li>`}
        </ul>
      </section>
      <section class="card pad">
        <h2>Back up</h2>
        <p>Save a complete copy as a JSON file. Keep it somewhere private, such as iCloud Drive or a personal folder, never in a public GitHub repository.${IS_IOS ? ' On iPhone, choose “Save to Files” in the share sheet.' : ''}</p>
        <div class="row-actions"><button class="btn btn-primary" data-action="backup">${IS_IOS ? 'Save backup' : 'Download backup'}</button></div>
      </section>
      <section class="card pad">
        <h2>Restore or move to this device</h2>
        <p>Choose a backup file (from Recollect or the earlier Memory Bank). You’ll see what’s new, what’s changed, and any possible duplicates before anything is written.</p>
        <div class="row-actions"><label class="btn">Choose backup file<input type="file" id="restore-file" ${IS_IOS ? '' : 'accept=".json,application/json"'} hidden></label></div>
      </section>
      <section class="card pad">
        <h2>Export to read or share</h2>
        <p>A clean Markdown document that opens in any text editor, Word, Google Docs, or Notes. To export only some memories, use Select on the Memories page; for interview stories, use the Story Bank.</p>
        <div class="row-actions"><button class="btn" data-action="export-all-md" ${S.memories.length ? '' : 'disabled'}>Export all as Markdown</button><button class="btn" data-action="export-csv" ${S.memories.length ? '' : 'disabled'}>Export as spreadsheet (.csv)</button></div>
      </section>
      <section class="card pad">
        <h2>Recently deleted</h2>
        <p>Deleted memories are kept here until you delete them permanently, so a mistaken delete can always be undone. Every edit also keeps the earlier version: open a memory and choose <strong>Version history</strong>.</p>
        <div class="row-actions"><a class="btn" href="#trash">Recently deleted${trash().length ? ` (${trash().length})` : ''}</a></div>
      </section>
      <section class="card pad">
        <h2>AI intake prompt</h2>
        <p>Paste this into ChatGPT or Claude to talk a memory through. It returns an entry Recollect can read.</p>
        <div class="row-actions"><button class="btn" data-action="copy-prompt">Copy prompt</button><a href="#import">Paste an AI entry</a></div>
        <details class="plain"><summary>View prompt</summary><pre class="prompt">${esc(INTAKE_PROMPT)}</pre></details>
      </section>
      <section class="card pad" id="synonyms">
        <h2>Search synonyms</h2>
        <p>One group per line, separated by commas. Searching any word in a group also finds the others. Add nicknames, abbreviations, and your own shorthand.</p>
        <textarea id="syn" rows="8" aria-label="Synonym groups">${esc(S.settings.synonyms)}</textarea>
        <div class="row-actions"><button class="btn" data-action="save-syn">Save synonyms</button></div>
      </section>
      <section class="card pad">
        <h2>Dictation</h2>
        <p>${Voice.supported && !Voice.broken ? 'This browser offers in-app dictation: tap Dictate while capturing.' : 'In-app dictation isn’t available here. Tap the microphone on your keyboard instead; it works in every text box.'} In-app dictation sends speech to the browser’s speech service (Apple in Safari, Google in Chrome). For fully on-device dictation, use the keyboard microphone.</p>
      </section>
      <section class="card pad">
        <h2>Sample memories</h2>
        <p>${samples ? `${plural(samples, 'fictional sample memory', 'fictional sample memories')} ${samples === 1 ? 'is' : 'are'} loaded. They’re marked “Sample” everywhere.` : 'Five clearly fictional memories that show how different kinds of entries look.'}</p>
        <div class="row-actions">${samples ? '<button class="btn" data-action="remove-samples">Remove samples</button>' : '<button class="btn" data-action="load-samples">Load samples</button>'}</div>
      </section>
      <section class="card pad danger-zone">
        ${Sync.meta.owner ? `<h2>Remove from this device</h2>
        <p>Signs out and deletes this device’s copy, for example on a shared or borrowed computer. Your memories stay in your Recollect cloud and come back when you sign in again.</p>
        <div class="row-actions"><button class="btn btn-danger" data-action="forget-device">Sign out and remove from this device</button></div>`
        : `<h2>Erase this device</h2>
        <p>Permanently deletes every memory stored here. Save a backup first.</p>
        <div class="row-actions"><button class="btn btn-danger" data-action="erase">Erase all memories on this device</button></div>`}
      </section>
      <section class="card pad">
        <div class="about"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAAQAElEQVR4nOydB1xUV77HDwxdVHoTpPcioGIBG2LBEo1lNZoEkzwTS9ZNWX2JmrpvNdmnWc3G7NNN1Giixv5EUHqv0kG69N6l12H/rrusC3Pn3oGZc+8M5/u5Hz8wcw7gzG/+51/OPX8FbTtvRCAIQgERCBQQcRAoIeIgUELEQaCEiINACREHgRIiDgIlRBwESog4CJQQcRAoIeIgUELEQaCEiINACREHgRIiDgIlRBwESog4CJQQcRAoIeIgUELEQaCEiINACREHgRIiDgIlRBwESog4CJQQcRAoIeIgUELEQaCEiINACREHgZLJKA5dbQ0dzem6WtPh68rahqraxoHBIUQYwyQSx4LZDm6O1rYWxmOfKi6rzikoz8grbm3rQIR/ITcZDm8xNtT127xCT0eTdmRtfXNOYRlcZZV1aNIj++Jwd7L227ISiUhnd29uYVlG7pPHhWVosiLj4tCYpv7FB35oAvQPDOQ/qQShZOaVdPf0ocmEjIvjja2rXB2tkJh4Ul4DhiQrr6Sx5SmaBMiyOPS0NQ6/u0NOTg6Jm/rGluyCsuz80rIqWXZNZDlaAZshCWUA+rpacPl4ubd3doMtyckvhaVncEjW4mFZFoeJkS6SMNPU1Ra4O8AFrknBk6rHhaWy5Jrw1HTMkYzivdB9+tQpCAs8Hk9fR9PJ1hzMia2FiaqKUlNre//AIJJmZFkca5Z6KCsrIuxoTp9qbzVzuacbmC6enHxbe6eUZmBleVnho2HEKk425nDBF5BSyy0uzy0sr6xtRNKDLEcrykoKDtZmro6W9lamykosmJCxdHb15BWXZ+eXFZRU9vb1I24zKdLn8vLyNuYznO0snOzMNXB5IcIZGuKXgjkpKs8rKq9paEacRMrEYWNpOtfVYYah3vNvu7t7ohLSsvOKmf+EmTP0XOwsnO3MDXS1EDcApwRWnNziisKSir5+Dvmw0iEOXW3Nw797c90KL02NaWOfraqpD4pIeBARHxmXihijpTF1trM1+ARmJgaIM8Sn5kYmZkKSDXEAKRDHMs85Z08c0RIki1F0dfeGxyb7B8eERCV1dHYhZkxRVXG0NXNztHKwNkXcIC276PbD2I6ubsQqXBeHs71V8K9nFBVFi6pgRU9My34YHg9CAbvCcJaSoiLow8HGdJa9hYqyEmKVnt6+X+6GZ+eXIPbgujgyw6+OeBjjI7+o7GFEQnBkQnL6Y4ZT5OXlrEyNnO0tnW3MNDWmIpYYHh6+ERAVl8L0zxY7nBbH7/e99tFvdyEx0fa0Izgq8X5wTERcCnwuGc4yMdSFvKeLg4WRnjZig+DoRwHhyYgNuCsOMPKFCbfVp6ghcQMJhpjEdFh0AsPiGptbGc7SmKbu5mjtbGdmaWqE8BKVmAkuCMIOd8WxfuXiC6c/QxImPTv/QXjC/ZCYwiflDKeoqSo7PsutWTnZmiFcXLoZnJpThPDC3drKnFn2vss9kYQx1NdZNN/trR0bNvou1dPRetre2dBEE0ZCoaSmvjktpygsNq2iuoE/PAxGRVSXWVRMTQxik7PhdyGMcFcckNoyNTFysrNEWNDW0lg412XXtvVb1vsY6Gl3dHTV0SUu+fzhhua2rLySsLj04rIq8GOmqqupqSgjCQDRU0NzK4gSYYTTDqm25vSC+NuIJSpr6v2DoiEYfpQhQrxgpK/tYm/hbGtubCjm3STZBaU/XA1EGOF6KFuZHqgqmc8ic2rqGgNCY+8FRSekZDGfNW3qFFcIhu0trEwNobiDJszg0NChY+cghYNwwXVxNOWFIc4AWW1QiX9QVExSBvNZsCJAKcfFztzOaiaEYGgCfHfxblFZNcIFp8VhMkM/PfQK4h6QMgGV3HkQIVI1R0lRAWKcZQtdx50yuRMUG5mQiXDB6Z1gro422zaKfD8SBlRUlF0crH/z0oq9u7ZYmhn3DwyWVtB/oIf4/Oq6prhHOQo83viSJU2t7VDlR7jgtDjKq+rAH6ytb4L124ClBKVwlJWUoPqzdb3P69vWqamqFD6p6O7ppZ1VWFpVVdvkYm/OE9EXAW3hvAOP63tIm1raElOzL10PuHQjsKK6ToGnYDYTd4KSCZDJ9Zrn+u5b23R1tOKSMwYGabZlQAxcWlHn4WqHRKG6rjGnoAzhghPi2LB6yaH9flCUz3hcSDWms6s7LTv/+r2QMxeuZ+UW8/n8mcaGSoqc2wPr5mQLhgT+VHgjhY9saevo6e23t5qJGFNV15RTUIpwwaY49HQ0v/7kwPd/+hheTTsrM1iS7wRG0M4aGBiEVDcsN6fOXUnOeNze0QV+6xQ1VcQZpk1V37nZt69/ICktR/jI8qp6VwfLqYzrRzX1LTiL+KyJA0ondy9+4+5sNxLdFZdWMhHHi5RV1oZGJ585fz0kOrmpuVVj+lRdbfpzFvCwZIG7mppqZDxNONP6tHO2sw1iRk19U1a+rFuO/9q58bvjh0YtCqXl1bcCwtG4qGtogtzDhav3fr71ANLe4CeCOUFs4+Hm2NDUKmStBBqb2+a52jFM9NU2tkC2HuFCDJk7UVm3ctFXR3+LJANkM8Epeen19y3nbdhz8NiD8Hh27wA48fl7nh6zhI95XMg0OpWXzK2/lL8O4QUCv4unPxf4lFhyzCNAffXm/bDX9n9i7Or76r6jP12/D5krxAa0G2BLKmsRM+RkWxznT1Fu0RiWWD36YUTCh5/92Wr+xrU7f/eXH3+FkBhhxEBX+9MPdwsZ0NLKVLWybDleXrPMnDpLweNJ/I+B8OGLE+fcfXYuWPvGH775ITUzbxjLDontG1cJ2Qk7xPjsBjl52RXHds7kwotKKk7/7eqq7e/aeW7+4LNvwmIku0lTQYH34Z5XqZ5lLk95WRUHhKyQQxQyAPOC+pzm1qeQft329scz3de++d6XN/xDwVlBEmDHptX6OoLvsYOEHmKGHJJRcTg7WEGEibgK1ETuBUXtPXQcwpxNbx48e+mWeG87A+Pht329wKeYr2zi9dlpwZd+tjQ1RlJCdEIaXEeOfw9l4dXeC32XezraWqAJQxXTMt8Zitly4BOH+hSaDDdPnoWki3AgfwXXV3+5aGykv26FFwjFy8N13D8Nyi6Cn+Dj29wlEvjeDznuvffMqaqp/7+fbm30+xDi4YNfnMovKkOiAzV9gQkP5pZjGO9xNBjFQT+CBYdUVCCTduGav9dLb0FIjERHT9C5D8zDaT5eG4NPHDweT/gAOWkQxwiQTPNY/fqTsiqRZikIehGI5aC3C8N479iZOCXl1d6b30nPzmc+RWC4IYI48DonGC2HPI3lwJzhEQtd3b3b3zlcXdvAcLxA8zksgjhk1HLQvvfStayMAGm0V/Yc7utnVPsVWCJgHqDykYz6HFL63jMht7D0q28vMhkpsHLG3GTyJ63lkGp++OUumBDaYQKXFVpXfQTMbhlOcdD5HNJsWnp6++4y2OOoIGhZYZ4Ux+yycypaQVLNg4h42jECM4E8OY4uK/jS57TvvbSvO2lZ9DGtwDwHT4H5R1RGHVLaLS3S7rG2d3T19Q8IHyM4WuGq5cAnjsFJ0LuV9v8osLiowNghxasNjMsK7R2CMgCtdRToezJfTzGnz/GJg/aF4+C9jaJCWxgTGIvSxnEj9PcNIIzgez9oXzhrS66cLj1uaKskgsXB2Ofo6OpBGMHoc9BZDnU11dXLFiBphvYDIFA9zLfdt7S1I4zgEweTVlYHdr+CpBnaDKZA9ehqT0fMKK9meo67WMAYyjIQh4eb4+a1nD6jbIIIFI+lCaMTR+qb21rasN60h1EczHYxnfzyA2tzEySjjDUtykqKLg6Mdi/HP8pBeMEnDoYNUMDz8P/5lIONGHZ7c5Cx4nBj1k29q7snIQ13+wR84ihn3NlbR0sj8MppX++FSOYY5ZCC2VizzIPJxKv3IvF3+MInDuYnz6N/HLF1+cwf7v50cp67E5IhRlmOl1YsnD5NnXZWSlYhK115sN4uEJ2QJtJ4Lw/XgF9OB175do/f5gm25MEDffH9BXE42Zh5zaWXfmVNw/X7kYgNsCYlgyITFy9wRyICIQxc//PRvuy84oDQ2MDQuNxCNptbCYE2nTVSOfNwtdu5cTmiIy2n6NqzBQVrYnQErCcYG+hq50RfRxOmsqb+fnDM/ZAY2hPZMFOceFdjurC2Xxv8PohLzgQndNfWVUgond29twOj8fdYeRGslqOusTk89pG311w0MUyM9Pfu2gJXY3Prw/CEwLDYqPi0/gF2Pl4vQpvrfF62TX9c3NHVPcfF1snWbOxRgm1PO4OjU1KyC1jvMYv77PPF891uXziBxE1Xd29YTBII5UF4PPOmoWKnLMVfeN8x7817snL/wxjoamuYzdDX1vpnkrSxqTUzr2RwiBPbG1g4GP/a2eM+ixnFb+NgYGAwNjkjICQWzElDE9P+beKiPDVgipqKkAHOS7fV1jchKYEFcYDnEXPvB00GTYQnSFpWPvglcJWUY2pDUZEWoKYqTBw69vROKHdgp6XGgjku/pf/jHBRVFLxLMwJi2OyzXMiCO8OExKV9Mqew0h6YK3fyraNK88c/2+EFzDpgaGxona9Z45wcez/+Otf7wYj6YHNZjzvvb3j6PtvITbo7OqOiEsB1yQ0JlmM55MKEUd7R5fDoi3snpgrKix3atqxafW3fzyIWCUlI/dhREJodFJO/hM0MYSI47M/nT1zQQw5Hpyw38ZrrqvjuZNHIHWB2KauoelBeEJIVCKk+cfxEYcqWnXmQ4FPQfgKQSySNrjS423Ncs9jh/cbc0AizwmNTg6JToJ1BxTDcIq6mmpZ6v2xj3d29yzZsLu8iukZ1tyBQw0AVZSVdr/68t5dW/V0uNIWA4C1BmxJcGQSbXdZSJxD+nzUg+Dc/Gb3R8npuLdiiAUudoeE4txaH6+1K7wgI4I4A/itUDgEoYBRgbd87ADQdG7MzRcfgXLB9rc/nrgrwxacbh3q7mK3bsWiNT5eVmbcOsM0JikjNCopOCoRMigjDxoZ6GZFXBv5Nigy4b2jJ6H6g6QWrjcdfo6tlelan0VgTmY5WiMuUVpR8zA8HuLhqPhUU2PD1JCf0T/6R3369V8h54akHOkQxwgzDPXWr1y0ZrnXwrkuiEt09/TmFpQ42FocOX7m8g2sHeclB9dbh44CKq4pmXlX7wT99adbmY8LoXpppK+rwnaze0BRUQGWFfh34ZxZcnIoMZVbG03Gh5RZDoFApmTVsvk+i+c52VkibgCB67FT56GgI10p0VHIgjhGMNDT8fVesGLJfIh3IDBGbPO0vfPgl6dvj7erIevIlDheZMWSeRtWL1m5dIGW5PcGCAfE8f6nJ7u66duYcw2ZFcdz5OTk5s92hjBnjY/nzBkGiCWKSyt37jsq6lnYrCPj4ngRZ3ur57k1e2sWfHDIoa3cth/btiOxMInEMYKZieH6lYt9l3t6uDkijICX6rN1XyveYxQmwmQUcjQwdwAAAvpJREFUxwiQ8Pb19gRbsmiemyKWc4Wg3rvpTZa3KDBHyvIc4gWcREiW3PAPPXvpduGTCv4w39hQX6KnT5maGLa0tadlS3a3oriY1JZjLEqKiks9Z4Nrstp7obYm0zNVRKK59emsZdulIv8xqS3HWIb4fIgpoFzy3Y+/QnUNqq/GRvq03elEQk1V5Wl7F+0GAC5ALAcNCgq8l32XveO32dXRBokJiFk8Vr+OOA+xHDTw+cO5hSWXrgdEJ6ZrakwTy6lD8HOgoC/evrWSgIiDKVW1DXcCI0KikoyN9MxnzkATo7WtIzpRtAMp8EPEIRp1Dc0Q3YTFPrKzMp1hMP4jQ5SVlS7fCEDcBuvhLTJDamae7ysH9h46znz78ShspeFEXiKO8QMmZP6aN27eDxvHXIhZlJUUEbch4pgQEOvuOXjs7d//UeCWY+EoKnD9rHciDjEARfnlW/aWVtSINEuB840AiDjEA6TOlm16Jzz2EfMpPHmuv/hEHGLj+f1LN/1DGY6H9BriNkQcYmbPoePnLt9mMlJOjliOycfhY2e+O09/Q/0g51tXEXFIhM//9+y1u0HCx/T29iFuQ8QhKQ4cOREVL+z8oK4erm85JuKQFHw+3+/A51Qp1IGBQcy9x8cBEYcEeZYiO3Rc4FO9fVxfUxARh6SJTcr48cr/j30c/xmp44CIQ+KAc9rU0jbqwZSMXMR5iDgkTk9v35cn/zbqwdCYZMR5iDhwcOX2w8cF/24D0t7RGRASizgPEQcmPvnq+5Gvz1/150KPB1qIODARnZheWfOsK2x9Y8upc1eQNEDEgY8LV+/Bv6+9+8k4Nn+wArk1AR/qU9Sc7a0SUrKQlEDEQaCE65uRCCxCxEGghIiDQAkRB4ESIg4CJUQcBEqIOAiUEHEQKCHiIFBCxEGghIiDQAkRB4ESIg4CJUQcBEqIOAiUEHEQKCHiIFBCxEGghIiDQAkRB4ESIg4CJUQcBEqIOAiUEHEQKCHiIFBCxEGghIiDQAkRB4GSvwMAAP//YSxU1AAAAAZJREFUAwBeY0SdzYoDfgAAAABJRU5ErkJggg==" alt=""><div><strong>Recollect</strong> <span class="muted small">v${APP.version}</span><br><span class="muted">${TAGLINE}</span></div></div>
      </section>
    </div>`;
  (async () => {
    const el = $('#persist'); if (!el) return;
    try {
      const p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      el.textContent = isStandalone() && IS_IOS ? 'Home Screen app (exempt from Safari’s cleanup)' : p === true ? 'Protected from automatic cleanup' : p === false ? 'Standard (the browser may clear it under storage pressure)' : 'Unknown in this browser';
    } catch { el.textContent = 'Unknown in this browser'; }
  })();
  $('#restore-file').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) restoreFromFile(file); });
  if (r.arg === 'synonyms') setTimeout(() => $('#synonyms').scrollIntoView({ block: 'start' }), 50);
}

/* ===== Cloud storage card (Data & backup) ===== */
function syncCardHTML() {
  const st = Sync.state, n = Sync.pendingCount(), rejected = Object.keys(Sync.rejected).length;
  const head = `<h2>Cloud storage</h2><p>${esc(syncSummary())}</p>`;
  if (st === 'starting') return head;
  if (st === 'local' || st === 'unconfigured') return head + `<p class="small muted">${st === 'unconfigured' ? 'Once it’s set up, signing in moves everything on this device to the cloud automatically. Nothing here is replaced.' : 'Open Recollect at its usual address to use cloud storage.'}</p>`;
  if (st === 'signed-out') return head + `<div class="row-actions"><button class="btn btn-primary" data-action="sync-signin">Sign in</button></div>`;
  if (st === 'other-account') return head + `<div class="row-actions"><button class="btn" data-action="cloud-backup-local">Back up this device first</button><button class="btn btn-danger" data-action="forget-device">Sign out and remove from this device</button></div>`;
  return head + `
    <dl class="kv">
      <dt>Signed in as</dt><dd>${esc(Sync.user || Sync.meta.owner)}</dd>
      <dt>Last synced</dt><dd>${Sync.meta.lastSyncAt ? `${fmtDate(Sync.meta.lastSyncAt)}, ${new Date(Sync.meta.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not yet'}</dd>
      <dt>Waiting to upload</dt><dd>${n ? plural(n, 'change') : 'Nothing'}</dd>
    </dl>
    ${rejected ? `<p class="small" style="color:var(--danger)">${plural(rejected, 'memory', 'memories')} couldn’t be saved to the cloud (${esc(Object.values(Sync.rejected)[0])}). ${rejected === 1 ? 'It is' : 'They are'} still on this device; download a backup to keep a copy.</p>` : ''}
    <div class="row-actions"><button class="btn" data-action="sync-now">Sync now</button><button class="btn" data-action="cloud-backup">Download cloud backup</button></div>`;
}

/* ===== Spreadsheet export ===== */
function memoriesToCSV(list) {
  const cols = [['id', m => m.id], ['title', m => m.title], ['when', m => m.eventDate ? m.eventDate.text : ''], ['start', m => (m.eventDate && m.eventDate.start) || ''], ['end', m => (m.eventDate && m.eventDate.end) || ''],
    ['approximate', m => m.eventDate && m.eventDate.approx ? 'yes' : ''], ['organization', m => m.organization], ['project', m => m.project], ['people', m => m.people.join('; ')],
    ['themes', m => m.themes.join('; ')], ['tags', m => m.tags.join('; ')], ['confidence', m => m.confidence], ['status', m => m.status],
    ['story_bank', m => m.story.starred ? 'yes' : ''], ['story_competencies', m => m.story.competencies.join('; ')], ['story_headline', m => m.story.headline],
    ['original', m => m.original], ['narrative', m => m.narrative], ['involvement', m => m.involvement], ['outcome', m => m.outcome], ['lessons', m => m.lessons],
    ['uncertainties', m => m.uncertainties], ['supporting', m => m.supporting], ['archived', m => m.archived ? 'yes' : ''], ['created', m => m.createdAt], ['updated', m => m.updatedAt]];
  // Quoted per RFC 4180; a leading =, +, - or @ is neutralised so a spreadsheet never runs it as a formula.
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map(c => c[0]).join(','), ...list.map(m => cols.map(c => cell(c[1](m))).join(','))].join('\r\n') + '\r\n';
}

/* ===== Recently deleted ===== */
function renderTrash(view) {
  const list = trash();
  view.innerHTML = `
    <div class="page-head"><h1>Recently deleted</h1>${list.length ? `<div class="page-actions"><button class="btn btn-quiet" data-action="trash-empty">Delete all permanently</button></div>` : ''}</div>
    <p class="page-sub">Deleted memories stay here until you delete them permanently${Sync.on() ? ', on every device' : ''}. Restoring puts a memory back exactly as it was.</p>
    ${list.length ? `<div class="list">${list.map(t => `
      <article class="card mem-card"><div class="card-link" style="cursor:default">
        <div class="card-top"><h3>${esc(t.memory.title || 'Untitled')}</h3></div>
        <div class="meta">${esc([whenShort(t.memory.eventDate), t.memory.organization].filter(Boolean).join(' · '))}${t.memory.eventDate || t.memory.organization ? ' · ' : ''}Deleted ${fmtDate(t.deletedAt)}</div>
        <p class="snippet">${esc(clip(t.memory.narrative || t.memory.original || t.memory.outcome || '', 160))}</p>
        <div class="row-actions" style="margin-top:8px"><button class="btn btn-sm btn-primary" data-action="trash-restore" data-id="${esc(t.id)}">Restore</button><button class="btn btn-sm btn-quiet" data-action="trash-purge" data-id="${esc(t.id)}">Delete permanently</button></div>
      </div></article>`).join('')}</div>`
    : `<div class="empty"><h3>Nothing here</h3><p>Memories you delete appear here, so they can be restored.</p></div>`}`;
}

/* ===== Version history ===== */
const HISTORY_FIELDS = [['title', 'Title'], ['when', 'When'], ['organization', 'Organization'], ['project', 'Project'], ['people', 'People'], ['themes', 'Themes'], ['tags', 'Tags'],
  ['original', 'Original recollection'], ['narrative', 'What happened'], ['involvement', 'My involvement'], ['outcome', 'Outcome'], ['lessons', 'Lessons & reflections'],
  ['uncertainties', 'Uncertain details'], ['supporting', 'Supporting information'], ['confidence', 'Confidence'], ['status', 'Status'], ['story', 'Story Bank'], ['archived', 'Archived']];
function historyValue(m, k) {
  if (k === 'when') return m.eventDate ? whenLong(m.eventDate) : '';
  if (['people', 'themes', 'tags'].includes(k)) return m[k].join(', ');
  if (k === 'confidence') return CONFIDENCE[m.confidence] || '';
  if (k === 'status') return STATUS[m.status] || '';
  if (k === 'story') return m.story.starred ? ['Yes', m.story.headline, m.story.competencies.join(', ')].filter(Boolean).join(' · ') : '';
  if (k === 'archived') return m.archived ? 'Yes' : '';
  return String(m[k] || '');
}
async function renderHistory(view, r) {
  const m = byId(r.arg);
  if (!m) { view.innerHTML = `<div class="empty"><h3>Memory not found</h3><p><a href="#memories">Back to memories</a></p></div>`; return; }
  view.innerHTML = `<div class="detail"><button class="back" data-action="back">← Back</button><div class="page-head"><h1>Version history</h1></div><p class="page-sub">${esc(m.title || 'Untitled memory')}</p><p class="muted" role="status">Loading earlier versions…</p></div>`;
  const local = await Versions.list(m.id);
  const cloud = Sync.on() ? await Sync.versions(m.id) : [];
  if (parseHash().name !== 'history' || parseHash().arg !== m.id) return;      // moved on while loading
  const seen = new Set(), all = [];
  for (const v of [...(cloud || []), ...local]) {
    const data = normalizeMemory({ ...v.data, id: m.id });
    const k = contentKey(data); if (seen.has(k) || k === contentKey(m)) continue; seen.add(k);
    all.push({ savedAt: v.savedAt || data.updatedAt, replacedAt: v.replacedAt, reason: v.reason, data });
  }
  all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  S.historyView = { id: m.id, versions: all };
  const when = iso => `${fmtDate(iso)}, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  view.innerHTML = `<div class="detail">
    <button class="back" data-action="back">← Back</button>
    <div class="page-head"><h1>Version history</h1></div>
    <p class="page-sub"><a href="#memory/${m.id}">${esc(m.title || 'Untitled memory')}</a> · recorded ${fmtDate(m.createdAt)} · current version saved ${when(m.updatedAt)}</p>
    ${cloud === null ? '<div class="notice gray">The cloud’s history couldn’t be loaded right now; showing versions kept on this device.</div>' : ''}
    ${all.length ? all.map((v, i) => {
      const diffs = HISTORY_FIELDS.filter(([k]) => historyValue(v.data, k) !== historyValue(m, k));
      return `<details class="fold history-item"><summary>Version saved ${when(v.savedAt)}${v.reason === 'conflict' ? ' <span class="badge">From another device</span>' : ''}
        <span class="muted" style="font-weight:400"> · ${diffs.length ? `differs in ${esc(diffs.map(d => d[1].toLowerCase()).slice(0, 4).join(', '))}${diffs.length > 4 ? '…' : ''}` : 'same text'}</span></summary>
        ${diffs.map(([k, label]) => `<section class="detail-section"><h2>${label}</h2><div class="prose">${historyValue(v.data, k) ? linkify(historyValue(v.data, k)) : '<span class="muted">(empty)</span>'}</div>
          <p class="small muted" style="margin-top:4px">Now: ${historyValue(m, k) ? esc(clip(historyValue(m, k), 160)) : '(empty)'}</p></section>`).join('')}
        <div class="row-actions"><button class="btn btn-sm" data-action="history-restore" data-i="${i}">Restore this version</button><span class="muted small">The current text is kept in the history.</span></div>
      </details>`;
    }).join('') : `<div class="empty"><h3>No earlier versions</h3><p>When this memory is edited, the version it replaces is kept here.</p></div>`}
  </div>`;
}

/* ===== Sample data (fictional) ===== */
const SAMPLE_MEMORIES = [
  {
    id: 'sample-0001', sample: true, source: 'ai',
    title: 'Started monthly roundtables between academy and stateside pitching coaches',
    when: 'Summer 2023', people: ['Dana Whitlock', 'Luis Fermín', 'Rafael Ozuna'],
    organization: 'Harbor City Navigators', project: 'Pitching Coach Roundtables',
    themes: ['Projects & Initiatives', 'Staff Development & Mentorship', 'Organizational Challenges'],
    tags: ['dominican academy', 'pitching', 'staff communication', 'cross-site collaboration', 'development gaps'],
    original: 'We were short on pitching staff at the academy that summer, and the coaches there were basically working in isolation from what we were doing stateside. I set up a monthly video call so the academy coaches and our stateside coordinators could walk through the same pitchers together. Luis translated at first. It turned into the place where we found out our pitch-design language didn’t match what they were teaching.',
    narrative: 'The Dominican academy was down a pitching coach for most of the summer, and the remaining staff had little regular contact with the stateside pitching group. Development plans were being written in two places with different vocabulary.\n\nI proposed a monthly roundtable on video: one academy pitcher and one stateside pitcher per session, with both staffs reviewing video and plans together. Luis Fermín translated for the first few sessions until the group settled into a bilingual rhythm.',
    involvement: 'Proposed the format to Dana, built a one-page agenda template, scheduled the calls around both staffs’ game times, and facilitated the first four sessions before handing facilitation to Luis.',
    outcome: 'The roundtables continued into the following season. We found several pitchers whose plans conflicted between sites and aligned them. Attendance dipped during the season.',
    lessons: 'Shared vocabulary mattered more than shared data. Next time I’d have the academy coaches help set the agenda from the start rather than inviting them into ours.',
    uncertainties: 'Not sure whether it was three or four pitchers we realigned. The first call may have been late June rather than July.',
    supporting: 'Agenda template saved in the shared drive (Development > Roundtables).',
    confidence: 'approximate', status: 'resolved',
    story: { starred: true, headline: 'Created a cross-site forum that exposed gaps in how two coaching staffs were developing the same pitchers.', competencies: ['Building a process from scratch', 'Collaborating across departments', 'Leading without formal authority'] }
  },
  {
    id: 'sample-0002', sample: true, source: 'manual',
    title: 'Chose an internal candidate over an outside hire for hitting coordinator',
    when: 'March 2024', people: ['Marcus Bell', 'Priya Raman', 'Dana Whitlock'],
    organization: 'Harbor City Navigators', project: '',
    themes: ['Personnel & Hiring Decisions', 'Strategy & Decision-Making'],
    tags: ['hiring', 'hitting coordinator', 'internal promotion', 'interview process'],
    original: 'Had two finalists for hitting coordinator. The outside candidate had the bigger résumé. Marcus had been with us four years and the hitters trusted him. Went with Marcus, with a development plan attached.',
    narrative: 'We had two finalists for the hitting coordinator role: an outside candidate with stronger technical credentials and broader experience, and Marcus Bell, an internal coach with four years in the system and strong relationships with players.\n\nPriya and I ran a structured second interview with a practical exercise. The outside candidate was stronger on the technical portion; Marcus was stronger on communication and buy-in.',
    involvement: 'Designed the second-round exercise with Priya, gathered feedback from three affiliate managers, and made the recommendation to Dana. I wrote a six-month development plan for Marcus focused on the technical gaps the exercise revealed.',
    outcome: 'Marcus was hired. The development plan was followed for most of the year. Player feedback in the end-of-season survey was positive.',
    lessons: 'A structured exercise made a judgment call much easier to explain. Pairing a hire with a written development plan made the decision feel less like a gamble.',
    uncertainties: '', supporting: 'Interview exercise and scoring sheet are in my 2024 hiring folder.',
    confidence: 'confirmed', status: 'resolved',
    story: { starred: true, headline: 'Recommended an internal hire over a stronger résumé, and paired it with a plan to close the gap.', competencies: ['Making difficult decisions', 'Developing staff members'] }
  },
  {
    id: 'sample-0003', sample: true, source: 'quick',
    title: 'Rebuilt the weekly player development report template',
    when: 'November 2022', people: ['Jordan Tate'],
    organization: 'Harbor City Navigators', project: 'Development Report Redesign',
    themes: ['Accomplishments & Results', 'Projects & Initiatives'],
    tags: ['reporting', 'templates', 'efficiency', 'affiliates'],
    original: 'Coaches were spending hours every week on reports nobody read past the first page. Jordan and I cut it to one page with three required sections and a notes field. Report time dropped a lot and the front office started actually reading them.',
    narrative: 'Weekly development reports had grown to several pages per player and were inconsistent across affiliates. Coaches were frustrated by the time involved, and the front office was skimming them.\n\nJordan Tate and I interviewed coaches at two affiliates, then rebuilt the report as a one-page template: current focus, measurable progress, and next steps, plus a free-notes field.',
    involvement: 'Led the coach interviews, drafted the template, piloted it at one affiliate for a month, and wrote the short guide used for the rollout.',
    outcome: 'Adopted across all affiliates the following spring. Coaches estimated their weekly report time dropped from roughly three hours to under one.',
    lessons: 'Asking the people who fill out the form what they’d cut was faster than designing in the abstract.',
    uncertainties: 'Time savings were coach estimates, not measured.',
    supporting: '', confidence: 'approximate', status: 'resolved',
    story: { starred: true, headline: 'Cut weekly reporting time by about two-thirds by redesigning the template with the coaches who used it.', competencies: ['Identifying and correcting organizational inefficiencies'] }
  },
  {
    id: 'sample-0004', sample: true, source: 'guided',
    title: 'Told a veteran coach his role was being reduced',
    when: 'January 2025', people: ['Walt Kessler', 'Dana Whitlock'],
    organization: 'Harbor City Navigators', project: '',
    themes: ['Leadership & Management', 'Relationships & Conversations', 'Personnel & Hiring Decisions'],
    tags: ['difficult conversation', 'restructuring', 'veteran staff', 'role change'],
    original: 'Had to tell Walt that his role was being cut back to part-time after the restructuring. He’d been in the organization longer than I had. I did it in person and he was angry at first. We still talk, but it’s not the same yet.',
    narrative: 'Background: the restructuring reduced several coordinator roles, including Walt Kessler’s, from full-time to part-time.\n\nWalt had been with the organization for many years and was respected by players. Dana and I agreed I should deliver the news because I worked with him most directly.',
    involvement: 'Prepared with Dana, met Walt in person rather than over the phone, explained the reasoning without blaming him, and offered specific projects he could own in the part-time role.',
    outcome: 'Walt accepted the part-time role after a few weeks. Our working relationship is still recovering.',
    lessons: 'Delivering it in person was right. I’d involve him earlier in shaping what the part-time role would look like instead of presenting a finished plan.',
    uncertainties: '', supporting: '',
    confidence: 'confirmed', status: 'ongoing',
    story: { starred: true, headline: '', competencies: ['Handling personnel challenges'] }
  },
  {
    id: 'sample-0005', sample: true, source: 'quick',
    title: 'Launched a dashboard without asking coaches what they needed',
    when: 'early 2021', people: ['Priya Raman'],
    organization: 'Lakeside Performance Group', project: 'Coach Dashboard',
    themes: ['Mistakes & Lessons Learned', 'Personal Reflections'],
    tags: ['dashboard', 'data', 'stakeholder input', 'adoption'],
    original: 'I think it was early 2021. I built a dashboard I was proud of and almost nobody used it. I never asked the coaches what questions they were trying to answer. Priya pointed that out, kindly.',
    narrative: 'I built a performance dashboard on my own initiative, focused on the metrics I found interesting. After launch, usage was very low.',
    involvement: 'Designed and built the dashboard alone; presented it at a staff meeting.',
    outcome: 'The dashboard was mostly unused and eventually retired.',
    lessons: 'Start with the questions people are already asking. Now I talk to at least three end users before building anything.',
    uncertainties: 'Not certain of the year; could have been late 2020.',
    supporting: '', confidence: 'uncertain', status: 'reflective',
    story: { starred: true, headline: 'An early mistake that changed how I start every project.', competencies: ['Learning from mistakes'] }
  }
];
async function loadSamples() {
  const t = Date.now();
  const list = SAMPLE_MEMORIES.map((x, i) => normalizeMemory({ ...x, createdAt: new Date(t - (5 - i) * 86400000 * 3).toISOString() }));
  await saveMany(list);
  S.settings.welcomed = true; await saveSettings();
  toast('Loaded 5 fictional sample memories.');
  render();
}
async function removeSamples() {
  const ids = S.memories.filter(m => m.sample).map(m => m.id);
  S.memories = S.memories.filter(m => !m.sample);
  await Store.delMany('memories', ids);
  buildIndex();
  toast(`Removed ${plural(ids.length, 'sample')}.`);
  render();
}

/* ---------- 13. iPhone experience: header, Capture, Explore, sheets, keyboard ---------- */
const ICON_PASTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8v.7M9 10h6M9 14h4"/></svg>';
const ICON_DETAILS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';

/* Header: title + optional right-hand action on iPhone detail screens */
function setHeader(title, actionLabel, onAction) {
  const t = $('#hdr-title'); if (t && title != null) t.textContent = title;
  const b = $('#hdr-action'); if (!b) return;
  b.textContent = actionLabel || ''; b.onclick = actionLabel && onAction ? (e => { e.preventDefault(); onAction(); }) : null;
}
function routeNameOf(hash) { return (String(hash || '').replace(/^#\/?/, '').split(/[?/]/)[0]) || 'home'; }
function backFallback() {
  const r = parseHash();
  if (r.name === 'edit') return '#memory/' + r.arg;
  if (r.name === 'memory') return '#memories';
  return '#home';
}

/* ===== Explore (iPhone tab): timeline + people/themes/projects/orgs/tags ===== */
const EXPLORE_TABS = [['people', 'People'], ['timeline', 'Timeline'], ['themes', 'Themes'], ['projects', 'Projects'], ['orgs', 'Organizations'], ['tags', 'Tags']];
function exploreTabs(active) { return `<nav class="tabs" aria-label="Explore by">${EXPLORE_TABS.map(([k, l]) => `<a href="#explore?tab=${k}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`; }
function renderExplore(view, r) {
  const tab = r.params.get('tab') || 'people';
  if (tab === 'timeline') renderTimeline(view, r, true); else renderBrowse(view, r, true);
}

/* ===== Capture: the fastest path from a thought to a saved memory =====
   Open → speak/type/paste → Save. Drafts are kept continuously (shared with
   the desktop Quick Capture box) so switching apps never loses a word. */
function captureMeta() { const m = loadLocal('mb.captureMeta') || {}; return { when: m.when || '', people: Array.isArray(m.people) ? m.people : [], themes: Array.isArray(m.themes) ? m.themes : [] }; }
function clearCaptureDraft() { saveLocal('mb.quickDraft', ''); saveLocal('mb.captureMeta', null); }
function readCaptureMeta() {
  const root = $('#cap-details'); if (!root) return captureMeta();
  return { when: $('#cap-when').value.trim(), people: chipValues(root, 'people'), themes: $$('.theme-opt[aria-pressed="true"]', root).map(b => b.dataset.value) };
}
function flushCaptureDraft() {
  const ta = $('#cap-text'); if (!ta || S.captureClosed) return;
  saveLocal('mb.quickDraft', ta.value);
  saveLocal('mb.captureMeta', readCaptureMeta());
  const note = $('#cap-saved'); if (note) note.textContent = ta.value.trim() ? 'Draft saved' : '';
}

function renderCapture(view) {
  S.captureClosed = false;
  const text = loadLocal('mb.quickDraft') || '';
  const meta = captureMeta();
  const themes = uniqCI([...S.settings.themes, ...meta.themes]);
  const hasMeta = !!(meta.when || meta.people.length || meta.themes.length);
  view.innerHTML = `
    <div class="compose">
      <div class="compose-bar">
        <button type="button" class="btn btn-quiet compose-cancel" data-action="compose-cancel">Cancel</button>
        <h1>Capture</h1>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary compose-save" data-action="cap-save">Save</button>
      </div>
      <div id="cap-detect" class="notice" hidden style="margin:10px 0 0">This looks like an AI entry. <button type="button" class="btn btn-sm" data-action="cap-import">Review &amp; import</button></div>
      <textarea id="cap-text" class="compose-text" placeholder="What do you remember? Type, paste, or dictate. Details can come later." aria-label="What do you remember?" autocapitalize="sentences" spellcheck="true">${esc(text)}</textarea>
      <div class="compose-tools" id="cap-tools">
        ${micButton('cap-text', 'cap-status', 'tool')}
        <button type="button" class="tool" data-action="cap-paste">${ICON_PASTE}<span>Paste</span></button>
        <button type="button" class="tool" data-action="cap-details" aria-expanded="${hasMeta}" aria-controls="cap-details">${ICON_DETAILS}<span>Details</span></button>
        <span class="spacer"></span>
        <span class="compose-status" id="cap-status"></span><span class="saved-note" id="cap-saved"></span>
      </div>
      <div id="cap-details" class="compose-details" ${hasMeta ? '' : 'hidden'}>
        <div class="field"><label for="cap-when">When did it happen? <span class="muted">Optional</span></label>
          <input id="cap-when" value="${esc(meta.when)}" placeholder="July 2024, summer 2023, around 2019…" autocomplete="off" enterkeyhint="done">
          <div class="hint" id="cap-when-preview"></div></div>
        <div class="field"><label>People</label>${chipInput('people', meta.people, 'dl-people', 'Add a name, then tap Done')}</div>
        <div class="field"><label>Themes</label>
          <div class="theme-picker">${themes.map(t => `<button type="button" class="chip theme-opt" data-action="toggle-theme" data-value="${esc(t)}" aria-pressed="${meta.themes.some(x => norm(x) === norm(t))}">${esc(t)}</button>`).join('')}</div></div>
        <div class="row-actions"><button type="button" class="btn" data-action="cap-full">Open the full editor</button><button type="button" class="btn btn-quiet" data-action="cap-discard">Discard draft</button></div>
      </div>
      <div class="compose-save-row">
        <button type="button" class="btn" data-action="cap-full">Add more details</button>
        <button type="button" class="btn btn-primary" data-action="cap-save">Save memory</button>
      </div>
      ${datalist('dl-people', aggregate('people').map(x => x.name))}
    </div>`;

  const ta = $('#cap-text'), compose = $('.compose', view);
  const detect = () => { $('#cap-detect').hidden = !looksStructured(ta.value); sizeCompose(); };
  const persist = debounce(flushCaptureDraft, 300);
  ta.addEventListener('input', () => { detect(); persist(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveCapture(); } if (e.key === 'Escape') ACTIONS['compose-cancel'](); });
  ta.addEventListener('focus', () => { if (isPhone()) setTimeout(() => { window.scrollTo(0, 0); sizeCompose(); }, 80); });
  // Details changes are autosaved, so they never count as "unsaved changes"
  const settle = () => setTimeout(() => { S.dirty = false; flushCaptureDraft(); }, 0);
  compose.addEventListener('click', settle);
  compose.addEventListener('keyup', settle);
  compose.addEventListener('focusout', settle);
  const when = $('#cap-when'), prev = $('#cap-when-preview');
  const showWhen = () => { const v = when.value.trim(); const p = parseWhen(v); prev.textContent = !v ? '' : p ? `Read as: ${p.label}${p.approx ? ' (approximate)' : ''}` : 'Kept as written.'; };
  when.addEventListener('input', () => { showWhen(); persist(); });
  showWhen();
  detect();
  if (!isPhone()) { ta.focus(); const n = ta.value.length; try { ta.setSelectionRange(n, n); } catch { /* ignore */ } }
}

// Fit the writing area between the top bar and the keyboard on iPhone.
function sizeCompose() {
  const ta = $('#cap-text');
  if (!ta) return;
  if (!isPhone()) { ta.style.height = ''; return; }
  const det = $('#cap-details');
  const vv = window.visualViewport;
  const vh = vv ? vv.height : window.innerHeight;
  const top = ta.getBoundingClientRect().top - (vv ? vv.offsetTop : 0);
  const tools = ($('#cap-tools') || {}).offsetHeight || 60;
  const roomy = !det || det.hidden;
  const h = roomy ? vh - Math.max(top, 0) - tools : Math.min(vh * 0.32, 260);
  ta.style.height = Math.max(document.body.classList.contains('kb-open') ? 96 : 140, Math.floor(h)) + 'px';
}

function openCapture({ dictate = false } = {}) {
  // Rendering synchronously inside the tap lets iOS raise the keyboard straight away.
  if (parseHash().name !== 'capture') { history.pushState(null, '', '#capture'); onRoute(); }
  const ta = $('#cap-text'); if (!ta) return;
  ta.focus({ preventScroll: true });
  const n = ta.value.length; try { ta.setSelectionRange(n, n); } catch { /* ignore */ }
  if (dictate) { const btn = $('#cap-tools [data-action="mic"]'); if (Voice.supported && !Voice.broken) Voice.start(ta, btn); else dictationFallback(ta); }
}
function leaveCapture() { if (S.navCount > 1) history.back(); else go('#home', { replace: true }); }

async function saveCapture({ details = false } = {}) {
  const ta = $('#cap-text'); const text = ta.value.trim();
  if (!text) { toast('Type, paste, or dictate something first.'); ta.focus(); return; }
  Voice.stop();
  if (looksStructured(text)) {
    S.captureClosed = true;
    if (startImport(text)) clearCaptureDraft();
    else { S.captureClosed = false; toast('Couldn’t read the entry’s fields. Save it as a regular memory instead.'); }
    return;
  }
  const meta = readCaptureMeta();
  const m = blankMemory();
  m.original = text; m.title = autoTitle(text); m.titleAuto = true; m.source = 'quick';
  m.eventDate = buildEventDate(meta.when, false);
  m.people = uniqCI(meta.people); m.themes = uniqCI(meta.themes);
  if (details) { flushCaptureDraft(); S.draftNew = m; S.captureHandoff = true; go('#new', { replace: true }); return; }
  m.needsReview = !(m.eventDate || m.people.length || m.themes.length);
  S.captureClosed = true; // ignore late blur/autosave events from the closing screen
  await saveMemory(m);
  clearCaptureDraft();
  if (document.activeElement) document.activeElement.blur();
  toast('Memory saved.', { label: 'Add details', run: () => go('#edit/' + m.id) });
  leaveCapture();
}

async function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, s), after = ta.value.slice(e);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + text + after;
  const pos = (before + sep + text).length; try { ta.setSelectionRange(pos, pos); } catch { /* ignore */ }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ===== Keyboard awareness (iOS Safari doesn't resize the page for the keyboard) ===== */
function initKeyboardTracking() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const isField = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range|color|reset)$/i.test(el.type)));
  let raf;
  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const vv = window.visualViewport;
      const byViewport = vv && (window.innerHeight - vv.height) > 140;
      const open = !!(byViewport || (coarse && isField(document.activeElement)));
      document.body.classList.toggle('kb-open', open && isPhone());
      sizeCompose();
    });
  };
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 80));
  if (window.visualViewport) { visualViewport.addEventListener('resize', update); visualViewport.addEventListener('scroll', update); }
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 300));
  // Keep the draft if the app is backgrounded or closed mid-thought
  const flush = () => { if ($('#cap-text')) flushCaptureDraft(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);
}

/* ===== Sheets ===== */
async function actionSheet(title, items) {
  const r = await modal(title, '', [...items.map(i => ({ label: i.label, value: i.value, cls: i.danger ? 'btn-danger' : '' })), { label: 'Cancel', value: 'cancel', cls: 'btn-quiet' }]);
  return r.value;
}
async function showInstallSteps() {
  const body = `
    <ol class="steps" style="padding-left:20px">
      <li><strong>Back up first.</strong> The Home Screen app starts with its own, separate storage.</li>
      <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow).</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
      <li>Open <strong>Recollect</strong> from your Home Screen and choose <strong>Restore from a backup</strong>.</li>
    </ol>
    <p class="small muted">If Safari asks, keep “Open as Web App” turned on so Recollect opens full screen.</p>`;
  const r = await modal('Add Recollect to your Home Screen', body, [{ label: 'Back up now', value: 'backup', cls: 'btn-primary' }, { label: 'Done', value: 'cancel' }]);
  if (r.value === 'backup') downloadBackup().then(ok => { if (ok) render(); });
}

const IPHONE_ACTIONS = {
  'open-capture': el => openCapture({ dictate: el.dataset.dictate === '1' }),
  'cap-save': () => saveCapture(),
  'cap-full': () => saveCapture({ details: true }),
  'cap-import': () => { const ta = $('#cap-text'); S.captureClosed = true; if (startImport(ta.value)) clearCaptureDraft(); else { S.captureClosed = false; toast('Couldn’t read the entry’s fields.'); } },
  'cap-details': el => {
    const d = $('#cap-details'); d.hidden = !d.hidden; el.setAttribute('aria-expanded', !d.hidden);
    sizeCompose(); if (!d.hidden) setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  },
  'cap-paste': async () => {
    const ta = $('#cap-text'); ta.focus();
    if (!(navigator.clipboard && navigator.clipboard.readText)) { toast('Touch and hold in the text area, then tap Paste.'); return; }
    try { const t = await navigator.clipboard.readText(); if (t) insertAtCursor(ta, t); else toast('The clipboard is empty.'); }
    catch { toast('Touch and hold in the text area, then tap Paste.'); }
  },
  'cap-discard': async () => {
    if (!(await confirmDialog('Discard this draft?', 'The text and details you’ve entered will be deleted.', 'Discard', true))) return;
    S.captureClosed = true; clearCaptureDraft(); render(); toast('Draft discarded.');
  },
  'compose-cancel': () => {
    Voice.stop(); flushCaptureDraft();
    const ta = $('#cap-text'); if (ta && ta.value.trim()) toast('Draft kept. It’ll be here when you come back.');
    if (document.activeElement) document.activeElement.blur();
    leaveCapture();
  },
  'more-sheet': async () => {
    const v = await actionSheet('Recollect', [
      { label: 'Data & backup', value: 'data' }, { label: 'Paste an AI entry', value: 'import' },
      { label: 'Work through a memory', value: 'guided' }, { label: 'New memory (full form)', value: 'new' }
    ]);
    if (v !== 'cancel') go('#' + v);
  },
  'detail-more': async el => {
    const m = byId(el.dataset.id); if (!m) return;
    const v = await actionSheet(m.title || 'Memory', [
      { label: 'Edit', value: 'edit' }, { label: IS_IOS ? 'Share as Markdown' : 'Export as Markdown', value: 'export' },
      { label: 'Copy text', value: 'copy' }, { label: m.archived ? 'Unarchive' : 'Archive', value: 'archive' },
      ...(m.sample ? [] : [{ label: 'Version history', value: 'history' }]), { label: 'Delete memory', value: 'delete', danger: true }
    ]);
    if (v === 'archive') ACTIONS[m.archived ? 'unarchive' : 'archive'](el);
    else if (v === 'history') go('#history/' + m.id);
    else if (v === 'edit') go('#edit/' + m.id);
    else if (v === 'export') download(`${slug(m.title)}.md`, memoryToMarkdown(m), 'text/markdown');
    else if (v === 'copy') toast(await copyText(memoryToMarkdown(m)) ? 'Copied.' : 'Copy failed.');
    else if (v === 'delete') ACTIONS['delete'](el);
  },
  'install-steps': () => showInstallSteps(),
  'dismiss-install': async () => { S.settings.installTipDismissed = true; await saveSettings(); render(); },
  'home-restore': () => { const f = $('#home-restore-file'); if (f) f.click(); }
};

/* ---------- Global actions (event delegation) ---------- */
const ACTIONS = {
  ...IPHONE_ACTIONS,
  'qc-save': () => quickSave(false),
  'qc-details': () => quickSave(true),
  'qc-import': () => { const ta = $('#qc'); if (startImport(ta.value)) { ta.value = ''; saveLocal('mb.quickDraft', ''); } else toast('Couldn’t find structured fields. Save it as a regular memory instead.'); },
  'mic': el => { const t = document.getElementById(el.dataset.target); if (Voice.supported && !Voice.broken) Voice.toggle(t, el); else dictationFallback(t); },
  'back': () => { if (S.navCount > 1) history.back(); else go(backFallback()); },
  'load-samples': () => loadSamples(),
  'remove-samples': async () => { if (await confirmDialog('Remove sample memories?', 'This deletes the 5 fictional sample memories. Your own memories aren’t affected.', 'Remove samples')) removeSamples(); },
  'dismiss-welcome': async () => { S.settings.welcomed = true; await saveSettings(); render(); },
  'backup': () => downloadBackup().then(ok => { if (ok) render(); }),
  'export-all-md': () => download(`recollect-${today()}.md`, memoriesToMarkdown(sortList(S.memories, 'event-asc'), 'Recollect'), 'text/markdown'),
  'copy-prompt': async () => toast(await copyText(INTAKE_PROMPT) ? 'Intake prompt copied. Paste it into ChatGPT or Claude.' : 'Copy failed. Open “View prompt” and copy it manually.'),
  'save-syn': async () => { S.settings.synonyms = $('#syn').value; await saveSettings(); buildIndex(); toast('Synonyms saved.'); },
  'erase': async () => {
    const r = await modal('Erase everything on this device?', '<p>This permanently deletes every memory in this browser. It can’t be undone. Type <strong>erase</strong> to confirm.</p><input name="confirm" autocomplete="off" autocapitalize="none">', [{ label: 'Erase', value: 'ok', cls: 'btn-danger' }, { label: 'Cancel', value: 'cancel' }]);
    if (r.value !== 'ok' || norm(r.data.get('confirm')) !== 'erase') { if (r.value === 'ok') toast('Nothing erased. Type “erase” to confirm.'); return; }
    await Store.clear('memories'); await Store.clear('tombstones'); await Store.clear('versions');
    S.memories = []; S.tombstones = []; buildIndex();
    toast('All memories on this device were erased.'); go('#home');
  },
  'export-one': el => { const m = byId(el.dataset.id); if (m) download(`${slug(m.title)}.md`, memoryToMarkdown(m), 'text/markdown'); },
  'copy-one': async el => { const m = byId(el.dataset.id); if (m) toast(await copyText(memoryToMarkdown(m)) ? 'Copied as Markdown.' : 'Copy failed.'); },
  'story-edit': el => { const m = byId(el.dataset.id); if (m) editStory(m); },
  'delete': async el => {
    const m = byId(el.dataset.id); if (!m) return;
    if (!(await confirmDialog('Delete this memory?', `“${esc(m.title || 'Untitled')}” will be removed from this device.`, 'Delete', true))) return;
    const copy = clone(m);
    await deleteMemory(m.id, { tombstone: !m.sample });
    go('#memories', { replace: true });
    toast(m.sample ? 'Memory deleted.' : 'Moved to Recently deleted.', { label: 'Undo', run: async () => { if (m.sample) await saveMemory(copy, { touch: false }); else await restoreFromTrash(copy.id); go('#memory/' + copy.id); } });
  },
  'archive': async el => { const m = byId(el.dataset.id); if (!m) return; const u = clone(m); u.archived = true; await saveMemory(u); toast('Archived. Find it under Memories → Filters → Show.', { label: 'Undo', run: async () => { const x = clone(byId(u.id)); x.archived = false; await saveMemory(x); render(); } }); render(); },
  'unarchive': async el => { const m = byId(el.dataset.id); if (!m) return; const u = clone(m); u.archived = false; await saveMemory(u); toast('Back in your active memories.'); render(); },
  'trash-restore': async el => { const m = await restoreFromTrash(el.dataset.id); if (m) { toast('Memory restored.', { label: 'Open', run: () => go('#memory/' + m.id) }); render(); } },
  'trash-purge': async el => {
    const t = trash().find(x => x.id === el.dataset.id); if (!t) return;
    if (!(await confirmDialog('Delete permanently?', `“${esc(t.memory.title || 'Untitled')}” and its version history will be gone for good${Sync.on() ? ', on every device' : ''}. This can’t be undone.`, 'Delete permanently', true))) return;
    await purgeFromTrash([t.id]); toast('Deleted permanently.'); render();
  },
  'trash-empty': async () => {
    const list = trash(); if (!list.length) return;
    const r = await modal('Delete everything in Recently deleted?', `<p>${plural(list.length, 'memory', 'memories')} and their version history will be gone for good${Sync.on() ? ', on every device' : ''}. This can’t be undone. Type <strong>delete</strong> to confirm.</p><input name="confirm" autocomplete="off" autocapitalize="none">`, [{ label: 'Delete permanently', value: 'ok', cls: 'btn-danger' }, { label: 'Cancel', value: 'cancel' }]);
    if (r.value !== 'ok' || norm(r.data.get('confirm')) !== 'delete') { if (r.value === 'ok') toast('Nothing deleted. Type “delete” to confirm.'); return; }
    await purgeFromTrash(list.map(t => t.id)); toast('Recently deleted is empty.'); render();
  },
  'history-restore': async el => {
    const h = S.historyView, v = h && h.versions[+el.dataset.i], cur = h && byId(h.id); if (!v || !cur) return;
    if (!(await confirmDialog('Restore this version?', `The memory goes back to the version saved ${fmtDate(v.savedAt)}. The current text is kept in the history, so this can be undone.`, 'Restore'))) return;
    const m = normalizeMemory({ ...v.data, id: cur.id, createdAt: cur.createdAt, rev: cur.rev });
    await saveMemory(m); toast('Version restored.'); go('#memory/' + m.id);
  },
  'export-csv': () => download(`recollect-${today()}.csv`, memoriesToCSV(sortList(S.memories, 'event-asc')), 'text/csv'),
  'sync-now': () => { Sync.schedule(0); toast('Syncing…'); },
  'sync-signin': () => Sync.signIn(),
  'cloud-backup': async () => { try { if (await Sync.cloudBackup()) toast('Cloud backup downloaded. Keep it somewhere private.'); } catch (e) { toast(e.message || 'The cloud backup couldn’t be downloaded.'); } },
  'cloud-backup-local': () => downloadBackup().then(ok => { if (ok) render(); }),
  'forget-device': async () => {
    const n = Sync.pendingCount();
    const msg = n && Sync.state !== 'other-account'
      ? `<strong>${plural(n, 'change hasn’t', 'changes haven’t')} reached the cloud yet</strong> and would be lost. Connect and choose Sync now first, or download a backup. Type <strong>remove</strong> to remove this device’s copy anyway.`
      : `This device’s copy is deleted and you’re signed out. ${Sync.state === 'other-account' ? 'Memories that belong to the other account and were never uploaded are lost unless you back them up first.' : 'Everything stays in your Recollect cloud.'} Type <strong>remove</strong> to confirm.`;
    const r = await modal('Sign out and remove from this device?', `<p>${msg}</p><input name="confirm" autocomplete="off" autocapitalize="none">`, [{ label: 'Remove from this device', value: 'ok', cls: 'btn-danger' }, { label: 'Cancel', value: 'cancel' }]);
    if (r.value !== 'ok' || norm(r.data.get('confirm')) !== 'remove') { if (r.value === 'ok') toast('Nothing removed. Type “remove” to confirm.'); return; }
    await Sync.forgetDevice();
  },
  'chip-remove': el => { el.closest('.chip-edit').remove(); S.dirty = true; },
  'toggle-theme': el => { el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'); S.dirty = true; },
  'add-theme': () => {
    const inp = $('#new-theme'); const v = inp.value.trim(); if (!v) return;
    const picker = $('#theme-picker');
    const ex = $$('.theme-opt', picker).find(b => norm(b.dataset.value) === norm(v));
    if (ex) ex.setAttribute('aria-pressed', 'true');
    else picker.insertAdjacentHTML('beforeend', `<button type="button" class="chip theme-opt" data-action="toggle-theme" data-value="${esc(v)}" aria-pressed="true">${esc(v)}</button>`);
    inp.value = ''; S.dirty = true;
  },
  'sg-person': el => { addChips($('.chips-input[data-name="people"]'), el.dataset.value); renderSuggestions($('#ed')); },
  'sg-org': el => { $('#f-org').value = el.dataset.value; S.dirty = true; renderSuggestions($('#ed')); },
  'sg-date': el => { const w = $('#f-when'); w.value = el.dataset.value; w.dispatchEvent(new Event('input', { bubbles: true })); renderSuggestions($('#ed')); },
  'sg-theme': el => { const b = $$('.theme-opt').find(x => norm(x.dataset.value) === norm(el.dataset.value)); if (b) b.setAttribute('aria-pressed', 'true'); S.dirty = true; renderSuggestions($('#ed')); },
  'editor-cancel': () => { if (S.navCount > 1) history.back(); else go('#home'); },
  'editor-skip': () => { S.dirty = false; nextImport(); },
  'jump': el => { const t = document.getElementById('y-' + el.dataset.y); if (t) t.scrollIntoView({ block: 'start' }); },
  'rename': async el => {
    const kind = el.dataset.kind, from = el.dataset.value;
    const r = await modal('Rename', `<p>Updates every memory that uses “${esc(from)}”. If the new name already exists, the two are merged.</p><input name="to" value="${esc(from)}" autocomplete="off" required>`, [{ label: 'Rename', value: 'ok', cls: 'btn-primary' }, { label: 'Cancel', value: 'cancel' }]);
    if (r.value !== 'ok') return;
    const to = String(r.data.get('to') || '').trim(); if (!to || to === from) return;
    const n = await renameValue(kind, from, to); toast(`Updated ${plural(n, 'memory', 'memories')}.`); render();
  },
  'remove-theme': async el => {
    const name = el.dataset.value; const n = S.memories.filter(m => m.themes.some(t => norm(t) === norm(name))).length;
    if (!(await confirmDialog('Remove theme?', n ? `“${esc(name)}” is used by ${plural(n, 'memory', 'memories')}. It will be removed from them too. The memories themselves are kept.` : `Remove “${esc(name)}” from your theme list?`, 'Remove', n > 0))) return;
    S.settings.themes = S.settings.themes.filter(t => norm(t) !== norm(name)); await saveSettings();
    const changed = S.memories.filter(m => m.themes.some(t => norm(t) === norm(name)));
    changed.forEach(m => { m.themes = m.themes.filter(t => norm(t) !== norm(name)); m.updatedAt = nowISO(); });
    if (changed.length) await saveMany(changed);
    render();
  },
  'browse-add-theme': async () => { const inp = $('#add-theme-browse'); const v = inp.value.trim(); if (!v) return; S.settings.themes = uniqCI([...S.settings.themes, v]); await saveSettings(); toast('Theme added.'); render(); },
  'edit-comps': async () => {
    const r = await modal('Story competencies', `<p>The skills you want examples for, one per line. These appear when you add a memory to the Story Bank.</p><textarea name="list" rows="10">${esc(S.settings.competencies.join('\n'))}</textarea>`, [{ label: 'Save', value: 'ok', cls: 'btn-primary' }, { label: 'Cancel', value: 'cancel' }]);
    if (r.value !== 'ok') return;
    S.settings.competencies = uniqCI(String(r.data.get('list') || '').split('\n')); await saveSettings(); render();
  },
  'g-next': () => guidedStep(1),
  'g-skip': () => guidedStep(1),
  'g-back': () => guidedStep(-1),
  'g-finish': () => finishGuided(),
  'g-reset': async () => { if (await confirmDialog('Start over?', 'Clear your answers and begin again?', 'Start over')) { S.guided = null; saveLocal('mb.guided', null); render(); } },
  'ai-read': () => {
    const text = $('#ai-in').value; const msg = $('#ai-msg');
    if (!text.trim()) { toast('Paste an entry first.'); return; }
    const entries = parseAIEntries(text);
    if (entries.backup) { msg.innerHTML = `<div class="notice gray">That’s a full backup file. Use <a href="#data">Data → Restore</a> instead.</div>`; return; }
    if (entries.length) { startImport(entries); return; }
    msg.innerHTML = `<div class="notice gray">No structured fields were found (labels like “Title:” and “Narrative:”). You can still save the text as a memory and organize it yourself. <button class="btn btn-sm" data-action="ai-as-text">Save as a new memory</button></div>`;
  },
  'ai-as-text': () => { const text = $('#ai-in').value.trim(); const m = blankMemory(); m.original = text; m.title = autoTitle(text); m.titleAuto = true; m.source = 'manual'; S.draftNew = m; go('#new'); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action]; if (!fn) return;
  e.preventDefault(); fn(el, e);
});
// Chip inputs: Enter or comma adds a chip; Backspace on empty removes the last one.
document.addEventListener('keydown', e => {
  const box = e.target.closest && e.target.closest('.chips-input');
  if (box && e.target.tagName === 'INPUT') {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && !e.isComposing) {
      if (e.target.value.trim()) { e.preventDefault(); addChips(box, e.target.value); }
      else if (e.key === 'Enter') e.preventDefault();
    } else if (e.key === 'Backspace' && !e.target.value) { const chips = $$('.chip-edit', box); if (chips.length) { chips[chips.length - 1].remove(); S.dirty = true; } }
    return;
  }
  if (e.target.id === 'new-theme' && e.key === 'Enter') { e.preventDefault(); ACTIONS['add-theme'](); return; }
  if (e.target.id === 'add-theme-browse' && e.key === 'Enter') { e.preventDefault(); ACTIONS['browse-add-theme'](); return; }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#dlg').open) {
    const s = $('#home-q') || $('#mq'); if (s) { e.preventDefault(); s.focus(); }
  }
});
document.addEventListener('input', e => {
  const box = e.target.closest && e.target.closest('.chips-input');
  if (box && e.inputType === 'insertReplacementText') addChips(box, e.target.value); // picked from autocomplete
});
document.addEventListener('focusout', e => {
  const box = e.target.closest && e.target.closest('.chips-input');
  if (box && e.target.tagName === 'INPUT' && e.target.value.trim()) addChips(box, e.target.value);
});
document.addEventListener('click', e => { const box = e.target.closest('.chips-input'); if (box && e.target === box) $('input', box).focus(); });

/* ---------- 12. Router & startup ---------- */
const ROUTES = {
  home: renderHome, memories: renderMemories, memory: renderDetail, edit: renderEditor, new: renderEditor,
  capture: renderCapture, explore: renderExplore, timeline: renderTimeline, browse: renderBrowse,
  story: renderStory, guided: renderGuided, import: renderImport, data: renderData, trash: renderTrash, history: renderHistory
};
// Desktop top navigation highlight
const NAV_FOR = { memory: 'memories', edit: 'memories', new: '', capture: '', guided: 'home', import: 'home', explore: 'browse', trash: 'data', history: 'memories' };
// iPhone tab bar highlight
const TAB_FOR = { home: 'home', memories: 'memories', memory: 'memories', edit: 'memories', capture: 'capture', explore: 'explore', timeline: 'explore', browse: 'explore', story: 'story' };
// Screens that show a back button instead of the logo on iPhone
const SUB_ROUTES = new Set(['memory', 'edit', 'new', 'data', 'import', 'guided', 'trash', 'history']);
const TITLES = { home: 'Recollect', capture: 'Capture', explore: 'Explore', memories: 'Memories', timeline: 'Timeline', browse: 'People & Themes', story: 'Story Bank', data: 'Data & Backup', guided: 'Work Through a Memory', import: 'Paste an AI Entry', new: 'New Memory', edit: 'Edit Memory', memory: 'Memory', trash: 'Recently Deleted', history: 'Version History' };
const HDR_TITLES = { data: 'Data & Backup', guided: 'Work Through It', import: 'AI Entry', new: 'New Memory', edit: 'Edit Memory', memory: 'Memory', trash: 'Recently Deleted', history: 'Version History' };

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const qi = h.indexOf('?');
  const path = qi >= 0 ? h.slice(0, qi) : h, qs = qi >= 0 ? h.slice(qi + 1) : '';
  const [name, ...rest] = path.split('/');
  return { name: name || 'home', arg: decodeURIComponent(rest.join('/')), params: new URLSearchParams(qs) };
}
function go(hash, { replace = false } = {}) {
  if (location.hash === hash) { render(); return; }
  if (replace) { history.replaceState(null, '', hash); onRoute(); }
  else location.hash = hash;
}
function render() {
  const r = parseHash();
  const fn = ROUTES[r.name] || renderHome;
  const nav = r.name in NAV_FOR ? NAV_FOR[r.name] : r.name;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  $$('[data-tab]').forEach(a => { const on = a.dataset.tab === TAB_FOR[r.name]; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.body.classList.toggle('sub', SUB_ROUTES.has(r.name));
  document.body.classList.toggle('compose-mode', r.name === 'capture');
  setHeader(HDR_TITLES[r.name] || '', '', null);
  document.title = r.name === 'memory' && byId(r.arg) ? `${byId(r.arg).title} · Recollect` : (TITLES[r.name] && r.name !== 'home' ? `${TITLES[r.name]} · Recollect` : 'Recollect');
  Voice.stop();
  if (r.name !== 'new') { S.importQueue = []; S.importTotal = 0; S.captureHandoff = false; }
  const view = $('#view');
  view.innerHTML = '';
  fn(view, r);
  updateSyncUI();
  if (r.name === 'capture') requestAnimationFrame(sizeCompose);
}
function onRoute() {
  if (S.suppress) { S.suppress = false; return; }
  const leaving = routeNameOf(S.prevHash);
  if (S.dirty && leaving !== 'capture') {
    if (!confirm('You have unsaved changes. Leave without saving?')) { S.suppress = true; history.replaceState(null, '', S.prevHash); return; }
  }
  S.dirty = false;
  const prev = S.prevHash;
  S.prevHash = location.hash || '#home';
  S.navCount++;
  render();
  if (prev.split('?')[0] !== S.prevHash.split('?')[0]) window.scrollTo(0, 0);
}

async function init() {
  await Store.open();
  const meta = Store.db ? await Store.get('meta', 'settings') : null;
  S.settings = { ...defaultSettings(), ...(meta || {}) };
  if (!meta) await saveSettings();
  S.memories = (Store.db ? await Store.getAll('memories') : []).map(normalizeMemory);
  S.tombstones = Store.db ? await Store.getAll('tombstones') : [];
  buildIndex();
  if (!Store.db) $('#storage-warning').hidden = false;
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('beforeunload', e => { if (S.dirty && routeNameOf(location.hash) !== 'capture') { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Voice.stop(); });
  initKeyboardTracking();
  onRoute();
  registerServiceWorker();
  Sync.init();          // in the background: the device copy is already on screen
}

/* Offline support. The service worker always tries the network first for the
   app itself, so a new version is picked up on the next launch; the cached copy
   is only used when offline. It never touches memory data (that lives in IndexedDB). */
function registerServiceWorker() {
  if (document.documentElement.dataset.build === 'single-file') return; // needs sw.js beside the page (full ZIP edition)
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.update) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { /* offline support is optional */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    toast('Recollect was updated.', { label: 'Reload', run: () => { if (!S.dirty) location.reload(); } });
  });
}
init();

