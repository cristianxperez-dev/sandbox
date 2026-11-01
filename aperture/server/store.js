/* APERTURE — D1 storage. All SQL is parameterized and every query is filtered by the signed-in
   email. Tables are created on first use; deploys never touch existing data.

   ap_state     learner-owned records (progress, notes, journal, drafts, settings …), validated by kind
   ap_attempts  graded attempts — written ONLY by the server's grading code
   ap_cards     spaced-repetition schedule — written ONLY by the server's scheduling code
   ap_events    small activity log (lesson completions, reviews, reveals) for retention over time */

let ready = false;
export async function ensureSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ap_state (email TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
      data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (email, kind, key))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ap_attempts (id TEXT PRIMARY KEY, email TEXT NOT NULL, assessment TEXT NOT NULL,
      kind TEXT NOT NULL, submitted INTEGER NOT NULL, auto_score REAL, auto_max REAL, self_score REAL, self_max REAL, data TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS ap_attempts_owner ON ap_attempts (email, assessment, submitted)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS ap_cards (email TEXT NOT NULL, card TEXT NOT NULL, box INTEGER NOT NULL, due INTEGER NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, last INTEGER, history TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (email, card))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ap_events (email TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL, ref TEXT, data TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS ap_events_owner ON ap_events (email, at)'),
  ]);
  ready = true;
}

export async function getState(db, email, kinds) {
  const marks = kinds.map(() => '?').join(',');
  const rows = (await db.prepare(`SELECT kind, key, data, updated FROM ap_state WHERE email = ? AND kind IN (${marks})`).bind(email, ...kinds).all()).results || [];
  const out = {};
  for (const k of kinds) out[k] = {};
  for (const r of rows) out[r.kind][r.key] = { data: JSON.parse(r.data), updated: r.updated };
  return out;
}
export async function getOne(db, email, kind, key) {
  const r = await db.prepare('SELECT data, updated FROM ap_state WHERE email = ? AND kind = ? AND key = ?').bind(email, kind, key).first();
  return r ? { data: JSON.parse(r.data), updated: r.updated } : null;
}
export async function putState(db, email, kind, key, data) {
  const now = Date.now();
  await db.prepare(`INSERT INTO ap_state (email, kind, key, data, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (email, kind, key) DO UPDATE SET data = excluded.data, updated = excluded.updated`).bind(email, kind, key, JSON.stringify(data), now).run();
  return now;
}
export async function deleteState(db, email, kind, key) {
  await db.prepare('DELETE FROM ap_state WHERE email = ? AND kind = ? AND key = ?').bind(email, kind, key).run();
}
export async function countKind(db, email, kind) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM ap_state WHERE email = ? AND kind = ?').bind(email, kind).first();
  return (r && r.n) || 0;
}

export async function addAttempt(db, email, a) {
  await db.prepare(`INSERT INTO ap_attempts (id, email, assessment, kind, submitted, auto_score, auto_max, self_score, self_max, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(a.id, email, a.assessment, a.kind, a.submitted, a.autoScore, a.autoMax, a.selfScore ?? null, a.selfMax ?? null, JSON.stringify(a.data)).run();
}
export async function updateAttemptSelf(db, email, id, selfScore, selfMax, data) {
  await db.prepare('UPDATE ap_attempts SET self_score = ?, self_max = ?, data = ? WHERE id = ? AND email = ?').bind(selfScore, selfMax, JSON.stringify(data), id, email).run();
}
export async function getAttempt(db, email, id) {
  const r = await db.prepare('SELECT * FROM ap_attempts WHERE id = ? AND email = ?').bind(id, email).first();
  return r ? rowAttempt(r) : null;
}
export async function listAttempts(db, email, assessment) {
  const q = assessment
    ? db.prepare('SELECT * FROM ap_attempts WHERE email = ? AND assessment = ? ORDER BY submitted').bind(email, assessment)
    : db.prepare('SELECT * FROM ap_attempts WHERE email = ? ORDER BY submitted').bind(email);
  return ((await q.all()).results || []).map(rowAttempt);
}
function rowAttempt(r) {
  return { id: r.id, assessment: r.assessment, kind: r.kind, submitted: r.submitted, autoScore: r.auto_score, autoMax: r.auto_max, selfScore: r.self_score, selfMax: r.self_max, data: JSON.parse(r.data) };
}

export async function getCards(db, email) {
  return ((await db.prepare('SELECT card, box, due, reps, lapses, last, history FROM ap_cards WHERE email = ?').bind(email).all()).results || [])
    .map((r) => ({ ...r, history: JSON.parse(r.history) }));
}
export async function upsertCard(db, email, c) {
  await db.prepare(`INSERT INTO ap_cards (email, card, box, due, reps, lapses, last, history) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (email, card) DO UPDATE SET box = excluded.box, due = excluded.due, reps = excluded.reps, lapses = excluded.lapses, last = excluded.last, history = excluded.history`)
    .bind(email, c.card, c.box, c.due, c.reps, c.lapses, c.last ?? null, JSON.stringify((c.history || []).slice(-40))).run();
}
export async function activateCards(db, email, cardIds, due) {
  if (!cardIds.length) return 0;
  const stmts = cardIds.map((id) => db.prepare(`INSERT OR IGNORE INTO ap_cards (email, card, box, due, reps, lapses, last, history) VALUES (?, ?, 1, ?, 0, 0, NULL, '[]')`).bind(email, id, due));
  await db.batch(stmts);
  return cardIds.length;
}

export async function logEvent(db, email, type, ref, data) {
  await db.prepare('INSERT INTO ap_events (email, at, type, ref, data) VALUES (?, ?, ?, ?, ?)').bind(email, Date.now(), type, ref || null, data ? JSON.stringify(data) : null).run();
}
export async function listEvents(db, email, since) {
  return ((await db.prepare('SELECT at, type, ref, data FROM ap_events WHERE email = ? AND at >= ? ORDER BY at').bind(email, since).all()).results || [])
    .map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
}

export async function exportAll(db, email) {
  const state = (await db.prepare('SELECT kind, key, data, updated FROM ap_state WHERE email = ? ORDER BY kind, key').bind(email).all()).results || [];
  return {
    app: 'APERTURE', exported: new Date().toISOString(), account: email,
    state: state.map((r) => ({ kind: r.kind, key: r.key, updated: new Date(r.updated).toISOString(), data: JSON.parse(r.data) })),
    attempts: await listAttempts(db, email),
    reviewSchedule: await getCards(db, email),
    events: await listEvents(db, email, 0),
  };
}
export async function deleteAll(db, email) {
  await db.batch([
    db.prepare('DELETE FROM ap_state WHERE email = ?').bind(email),
    db.prepare('DELETE FROM ap_attempts WHERE email = ?').bind(email),
    db.prepare('DELETE FROM ap_cards WHERE email = ?').bind(email),
    db.prepare('DELETE FROM ap_events WHERE email = ?').bind(email),
  ]);
}
