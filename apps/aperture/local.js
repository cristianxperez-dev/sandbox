/* APERTURE — public-beta mode: everything runs in this browser.
   Course content is loaded from data/content.json (public). Scoring, the review schedule and the
   learner's records use the same handlers as the secure server mode (shared/handlers.js), with a
   store kept in this browser's localStorage under keys prefixed "aperture:v1:".
   - Nothing the learner writes leaves the browser; there is no server, account or analytics.
   - Progress is device- and browser-specific and is lost if site data is cleared.
   - Because scoring runs in the browser and answer keys ship with the page, assessments are
     learning exercises, not secure examinations. */

import { setContent, index } from './shared/content-core.js';
import { handle, validateRecord } from './shared/handlers.js';
import { STATE_KINDS } from './shared/kinds.js';

const P = 'aperture:v1:';
const MAX_EVENTS = 3000;

function read(key, fallback) {
  try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
let quotaWarned = false;
function write(key, value) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); return true; }
  catch (e) {
    if (!quotaWarned) { quotaWarned = true; window.dispatchEvent(new CustomEvent('aperture:storage-error', { detail: String(e && e.name || e) })); }
    throw Object.assign(new Error('This browser refused to save (storage full or blocked). Export your data from Settings.'), { status: 507 });
  }
}

// In-memory mirror, persisted on every change.
const mem = { state: read('state', {}), attempts: read('attempts', []), cards: read('cards', []), events: read('events', []) };
const save = (k) => write(k, mem[k]);

const store = {
  async ensureSchema() {},
  async getState(_db, _o, kinds) {
    const out = {};
    for (const k of kinds) out[k] = { ...(mem.state[k] || {}) };
    return out;
  },
  async getOne(_db, _o, kind, key) { return mem.state[kind]?.[key] || null; },
  async putState(_db, _o, kind, key, data) {
    const updated = Date.now();
    (mem.state[kind] = mem.state[kind] || {})[key] = { data, updated };
    save('state');
    return updated;
  },
  async deleteState(_db, _o, kind, key) { if (mem.state[kind]) { delete mem.state[kind][key]; save('state'); } },
  async countKind(_db, _o, kind) { return Object.keys(mem.state[kind] || {}).length; },
  async addAttempt(_db, _o, a) { mem.attempts.push(a); save('attempts'); },
  async updateAttemptSelf(_db, _o, id, s, m, data) { const a = mem.attempts.find((x) => x.id === id); if (a) { a.selfScore = s; a.selfMax = m; a.data = data; save('attempts'); } },
  async getAttempt(_db, _o, id) { return mem.attempts.find((x) => x.id === id) || null; },
  async listAttempts(_db, _o, assessment) { return mem.attempts.filter((a) => !assessment || a.assessment === assessment).sort((a, b) => a.submitted - b.submitted); },
  async getCards() { return mem.cards.map((c) => ({ ...c, history: [...(c.history || [])] })); },
  async upsertCard(_db, _o, c) {
    const i = mem.cards.findIndex((x) => x.card === c.card);
    const rec = { card: c.card, box: c.box, due: c.due, reps: c.reps || 0, lapses: c.lapses || 0, last: c.last ?? null, history: (c.history || []).slice(-40) };
    if (i >= 0) mem.cards[i] = rec; else mem.cards.push(rec);
    save('cards');
  },
  async activateCards(_db, _o, ids, due) {
    const have = new Set(mem.cards.map((c) => c.card));
    for (const id of ids) if (!have.has(id)) mem.cards.push({ card: id, box: 1, due, reps: 0, lapses: 0, last: null, history: [] });
    save('cards');
    return ids.length;
  },
  async logEvent(_db, _o, type, ref, data) {
    mem.events.push({ at: Date.now(), type, ref: ref || null, data: data || null });
    if (mem.events.length > MAX_EVENTS) mem.events = mem.events.slice(-MAX_EVENTS);
    try { save('events'); } catch { /* the activity log is optional */ }
  },
  async listEvents(_db, _o, since) { return mem.events.filter((e) => e.at >= since); },
  async exportAll() {
    const state = [];
    for (const [kind, recs] of Object.entries(mem.state)) for (const [key, r] of Object.entries(recs)) state.push({ kind, key, updated: new Date(r.updated).toISOString(), data: r.data });
    return { app: 'APERTURE', format: 1, exported: new Date().toISOString(), storage: 'this browser (public beta)', state, attempts: mem.attempts, reviewSchedule: mem.cards, events: mem.events };
  },
  async deleteAll() {
    mem.state = {}; mem.attempts = []; mem.cards = []; mem.events = [];
    for (const k of ['state', 'attempts', 'cards', 'events']) { try { localStorage.removeItem(P + k); } catch {} }
  },
  // Restores an export made by this app (merges; newer records win). Every record is re-validated.
  async importAll(body) {
    const ix = index();
    let added = 0, skipped = 0;
    for (const r of Array.isArray(body.state) ? body.state : []) {
      if (!r || !STATE_KINDS.includes(r.kind)) { skipped++; continue; }
      const clean = validateRecord(ix, r.kind, r.key, r.data);
      if (!clean) { skipped++; continue; }
      const t = Date.parse(r.updated) || Date.now();
      const cur = mem.state[r.kind]?.[r.key];
      if (!cur || cur.updated < t) { (mem.state[r.kind] = mem.state[r.kind] || {})[r.key] = { data: clean, updated: t }; added++; }
    }
    const haveA = new Set(mem.attempts.map((a) => a.id));
    for (const a of Array.isArray(body.attempts) ? body.attempts : []) {
      if (!a || typeof a.id !== 'string' || haveA.has(a.id) || !(ix.assessments.has(a.assessment) || ix.assignments.has(a.assessment)) || !a.data || typeof a.data !== 'object') { skipped++; continue; }
      mem.attempts.push({ id: a.id.slice(0, 64), assessment: a.assessment, kind: String(a.kind).slice(0, 20), submitted: Number(a.submitted) || Date.now(), autoScore: num(a.autoScore), autoMax: num(a.autoMax), selfScore: num(a.selfScore), selfMax: num(a.selfMax), data: a.data });
      added++;
    }
    const haveC = new Map(mem.cards.map((c) => [c.card, c]));
    for (const c of Array.isArray(body.reviewSchedule) ? body.reviewSchedule : []) {
      if (!c || !ix.cards.has(c.card)) { skipped++; continue; }
      const prev = haveC.get(c.card);
      if (prev && (prev.last || 0) >= (c.last || 0)) continue;
      const rec = { card: c.card, box: Math.min(6, Math.max(1, Math.round(c.box) || 1)), due: Number(c.due) || Date.now(), reps: Number(c.reps) || 0, lapses: Number(c.lapses) || 0, last: c.last ?? null, history: Array.isArray(c.history) ? c.history.slice(-40) : [] };
      if (prev) Object.assign(prev, rec); else { mem.cards.push(rec); haveC.set(c.card, rec); }
      added++;
    }
    save('state'); save('attempts'); save('cards');
    return [200, { ok: true, added, skipped }];
  },
};
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function boot() {
  const res = await fetch('data/content.json?v=20261101b', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Course content could not be loaded (HTTP ${res.status}).`);
  setContent(await res.json());
  index();
  return {
    mode: 'local',
    async api(path, { method = 'GET', body, params } = {}) {
      const [status, data] = await handle({ method, path, params: new URLSearchParams(params || {}), body: body === undefined ? null : JSON.parse(JSON.stringify(body)) }, { store, db: null, owner: 'local', mode: 'local' });
      return { status, data };
    },
    storageAvailable() { try { localStorage.setItem(P + 'probe', '1'); localStorage.removeItem(P + 'probe'); return true; } catch { return false; } },
    usage() { let n = 0; try { for (const k of ['state', 'attempts', 'cards', 'events']) n += (localStorage.getItem(P + k) || '').length; } catch {} return n; },
  };
}

boot().then((api) => window.__apertureLocal.resolve(api), (e) => window.__apertureLocal.reject(e));
