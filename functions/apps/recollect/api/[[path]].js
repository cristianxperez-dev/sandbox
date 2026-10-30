/* Recollect API: a Cloudflare Pages Function backed by Cloudflare D1.
   Serves /apps/recollect/api/* only (see site/_routes.json).

   Security model
   - Every request must carry a Cloudflare Access token (the Cf-Access-Jwt-Assertion header, or the
     CF_Authorization cookie). The token's signature, issuer, audience and expiry are verified here,
     and its email must be on RECOLLECT_ALLOWED_EMAILS. Access in front of the path is not trusted on
     its own: a direct request to any hostname (pages.dev, previews) is refused without a valid token.
   - Missing configuration means every request is refused (503). Nothing is ever served by default.
   - Each person's memories are stored under their email; queries always filter by it.
   - All SQL is parameterized. Requests must be same-origin JSON with an X-Recollect header, so a
     page on another site can't make the browser send them.

   Configuration (Cloudflare dashboard → the Pages project → Settings)
     Binding   RECOLLECT_DB              D1 database
     Variable  RECOLLECT_ACCESS_ISSUER   https://<team>.cloudflareaccess.com
     Variable  RECOLLECT_ACCESS_AUD      the Access application's Audience (AUD) tag
     Variable  RECOLLECT_ALLOWED_EMAILS  comma-separated addresses allowed to use Recollect
   The tables are created on first use. Deploys never touch them. */

const MAX_BODY = 6 * 1024 * 1024;          // one push request
const MAX_MEMORY = 256 * 1024;             // one memory, serialized
const MAX_CHANGES = 100;                   // memories per push
const PAGE = 500;                          // changes per pull
const KEEP_VERSIONS = 50;                  // history kept per memory
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/api\/?/, '').replace(/\/+$/, '');

    const config = readConfig(env);
    if (!config) return json(503, { error: 'not_configured', message: 'Recollect’s cloud storage isn’t set up yet.' });

    // Sign-in entry point: Access sends the person here after they sign in, and we send them back to the app.
    if (path === 'login' && request.method === 'GET') {
      const user = await authenticate(request, config);
      if (!user) return html(401, 'You’re not signed in to Recollect, or this address isn’t allowed to use it.');
      return new Response(null, { status: 302, headers: { Location: new URL('../', url).pathname + '#home', 'Cache-Control': 'no-store' } });
    }

    if (request.headers.get('X-Recollect') !== '1') return json(400, { error: 'bad_request' });
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json(403, { error: 'forbidden' });

    const user = await authenticate(request, config);
    if (!user) return json(401, { error: 'unauthorized', message: 'Sign in to Recollect to continue.' });

    const db = env.RECOLLECT_DB;
    await ensureSchema(db);

    if (path === 'status' && request.method === 'GET') return json(200, await status(db, user));
    if (path === 'changes' && request.method === 'GET') return json(200, await changes(db, user, url.searchParams));
    if (path === 'push' && request.method === 'POST') {
      const body = await readBody(request);
      if (!body) return json(400, { error: 'bad_request', message: 'The request wasn’t valid JSON.' });
      if (Array.isArray(body.changes) && body.changes.length > MAX_CHANGES) return json(413, { error: 'too_many', message: `Send at most ${MAX_CHANGES} memories at a time.` });
      return json(200, await push(db, user, body));
    }
    if (path === 'versions' && request.method === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return json(400, { error: 'bad_request' });
      return json(200, await versions(db, user, id));
    }
    if (path === 'export' && request.method === 'GET') return json(200, await exportAll(db, user), { 'Content-Disposition': 'attachment; filename="recollect-cloud-backup.json"' });
    return json(404, { error: 'not_found' });
  } catch (err) {
    console.error('recollect api', err && err.stack || err);
    return json(500, { error: 'server_error', message: 'Something went wrong on the server. Your changes are still on this device.' });
  }
}

/* ---------- responses ---------- */
const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}
function html(status, message) {
  const safe = message.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recollect</title><p style="font:16px -apple-system,system-ui,sans-serif;color:#18233A;max-width:32em;margin:40px auto;padding:0 20px">${safe} <a href="../">Back to Recollect</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return null;
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/* ---------- configuration & authentication ---------- */
function readConfig(env) {
  const issuer = String(env.RECOLLECT_ACCESS_ISSUER || '').trim().replace(/\/+$/, '');
  const aud = String(env.RECOLLECT_ACCESS_AUD || '').trim();
  const emails = String(env.RECOLLECT_ALLOWED_EMAILS || '').split(/[,\s;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!env.RECOLLECT_DB || !issuer || !aud || !emails.length) return null;
  let u;
  try { u = new URL(issuer); } catch { return null; }
  // Certificates must come over HTTPS (plain HTTP is accepted only for a local test server).
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  return { issuer, aud, emails: new Set(emails) };
}

let jwksCache = { issuer: '', at: 0, keys: [] };
async function signingKeys(issuer, force) {
  if (!force && jwksCache.issuer === issuer && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Access certificates returned ${res.status}`);
  const data = await res.json();
  jwksCache = { issuer, at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}
function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJSON(s) { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); }
function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}
// Returns the signed-in, allowed email address, or null.
async function authenticate(request, config) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJSON(parts[0]); payload = b64urlJSON(parts[1]); } catch { return null; }
  if (!header || header.alg !== 'RS256' || !header.kid) return null;
  let keys = await signingKeys(config.issuer, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await signingKeys(config.issuer, true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk || jwk.kty !== 'RSA') return null;
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
  if (payload.iss !== config.issuer) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.aud)) return null;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !config.emails.has(email)) return null;
  return email;
}

/* ---------- storage ---------- */
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rc_memories (
      owner TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL, deleted_at TEXT, purged INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
      PRIMARY KEY (owner, id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS rc_memories_seq ON rc_memories (owner, seq)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS rc_versions (
      owner TEXT NOT NULL, memory_id TEXT NOT NULL, rev INTEGER NOT NULL, saved_at TEXT NOT NULL,
      replaced_at TEXT NOT NULL, reason TEXT NOT NULL, data TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS rc_versions_memory ON rc_versions (owner, memory_id, replaced_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS rc_state (
      owner TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0,
      settings TEXT, settings_seq INTEGER NOT NULL DEFAULT 0, settings_updated_at TEXT)`)
  ]);
  schemaReady = true;
}

function validISO(v) { return typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null; }
function rowOut(r) {
  return { id: r.id, rev: r.rev, seq: r.seq, deleted: !!r.deleted_at, deletedAt: r.deleted_at || null, purged: !!r.purged, data: r.purged ? null : JSON.parse(r.data) };
}

async function status(db, owner) {
  const st = await db.prepare('SELECT seq FROM rc_state WHERE owner = ?').bind(owner).first();
  const c = await db.prepare('SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS live, SUM(CASE WHEN deleted_at IS NOT NULL AND purged = 0 THEN 1 ELSE 0 END) AS trash FROM rc_memories WHERE owner = ?').bind(owner).first();
  return { ok: true, user: owner, seq: st ? st.seq : 0, counts: { memories: (c && c.live) || 0, deleted: (c && c.trash) || 0 }, serverTime: new Date().toISOString() };
}

async function changes(db, owner, params) {
  const since = Math.max(0, parseInt(params.get('since') || '0', 10) || 0);
  // Read the high-water mark first, so a write that lands during this request is picked up next time, never skipped.
  const st = await db.prepare('SELECT seq, settings, settings_seq, settings_updated_at FROM rc_state WHERE owner = ?').bind(owner).first();
  const top = st ? st.seq : 0;
  const rows = (await db.prepare('SELECT id, rev, seq, deleted_at, purged, data FROM rc_memories WHERE owner = ? AND seq > ? AND seq <= ? ORDER BY seq LIMIT ?').bind(owner, since, top, PAGE + 1).all()).results || [];
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE).map(rowOut);
  const cursor = more ? list[list.length - 1].seq : Math.max(since, top);
  const settings = st && st.settings && st.settings_seq > since && st.settings_seq <= cursor ? { data: JSON.parse(st.settings), updatedAt: st.settings_updated_at } : null;
  return { changes: list, cursor, more, settings };
}

// Reserve the next change number for this person (atomic in D1).
const nextSeq = (db, owner) => db.prepare('UPDATE rc_state SET seq = seq + 1 WHERE owner = ? RETURNING seq').bind(owner);
function versionStmt(db, owner, row, reason, replacedAt) {
  return db.prepare('INSERT INTO rc_versions (owner, memory_id, rev, saved_at, replaced_at, reason, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(owner, row.id, row.rev, row.updated_at, replacedAt, reason, row.data);
}
const trimVersions = (db, owner, id) => db.prepare(`DELETE FROM rc_versions WHERE owner = ? AND memory_id = ? AND rowid NOT IN
  (SELECT rowid FROM rc_versions WHERE owner = ? AND memory_id = ? ORDER BY replaced_at DESC LIMIT ${KEEP_VERSIONS})`).bind(owner, id, owner, id);

/* Applies changes from one device. Every memory carries the server revision the device last saw
   (baseRev). If someone else changed it in between, the later edit becomes current and the other is
   kept in the version history, so a conflict never loses text. Deletions keep the memory (it can be
   restored) until it is purged. */
async function push(db, owner, body) {
  await db.prepare('INSERT OR IGNORE INTO rc_state (owner, seq) VALUES (?, 0)').bind(owner).run();
  const list = Array.isArray(body.changes) ? body.changes : [];
  const results = [];
  for (const ch of list) results.push(await applyChange(db, owner, ch));
  let settings = null;
  if (body.settings && typeof body.settings === 'object') settings = await applySettings(db, owner, body.settings);
  return { results, settings };
}

async function applyChange(db, owner, ch) {
  const id = ch && typeof ch.id === 'string' ? ch.id : '';
  if (!ID_RE.test(id)) return { id, status: 'rejected', reason: 'invalid id' };
  const op = ch.op;
  if (!['put', 'delete', 'purge'].includes(op)) return { id, status: 'rejected', reason: 'invalid operation' };
  const baseRev = Number.isInteger(ch.baseRev) && ch.baseRev >= 0 ? ch.baseRev : 0;
  let data = null, text = null, updatedAt = null;
  if (op !== 'purge') {
    data = ch.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== id) return { id, status: 'rejected', reason: 'invalid memory' };
    text = JSON.stringify(data);
    if (text.length > MAX_MEMORY) return { id, status: 'rejected', reason: 'memory too large' };
    updatedAt = validISO(data.updatedAt);
    if (!updatedAt) return { id, status: 'rejected', reason: 'invalid timestamp' };
  }
  const now = new Date().toISOString();
  const deletedAt = op === 'delete' ? (validISO(ch.deletedAt) || now) : null;
  const cur = await db.prepare('SELECT id, rev, seq, updated_at, deleted_at, purged, data FROM rc_memories WHERE owner = ? AND id = ?').bind(owner, id).first();
  const read = async () => rowOut(await db.prepare('SELECT id, rev, seq, deleted_at, purged, data FROM rc_memories WHERE owner = ? AND id = ?').bind(owner, id).first());

  if (op === 'purge') {
    if (!cur) return { id, status: 'applied', record: null };
    await db.batch([
      nextSeq(db, owner),
      db.prepare(`UPDATE rc_memories SET rev = rev + 1, seq = (SELECT seq FROM rc_state WHERE owner = ?), purged = 1, data = '{}',
        deleted_at = COALESCE(deleted_at, ?) WHERE owner = ? AND id = ?`).bind(owner, now, owner, id),
      db.prepare('DELETE FROM rc_versions WHERE owner = ? AND memory_id = ?').bind(owner, id)
    ]);
    return { id, status: 'applied', record: await read() };
  }

  if (!cur) {
    await db.batch([
      nextSeq(db, owner),
      db.prepare('INSERT INTO rc_memories (owner, id, rev, seq, updated_at, deleted_at, purged, data) VALUES (?, ?, 1, (SELECT seq FROM rc_state WHERE owner = ?), ?, ?, 0, ?)')
        .bind(owner, id, owner, updatedAt, deletedAt, text)
    ]);
    return { id, status: 'applied', record: await read() };
  }

  // When was the server's copy last changed (edited, or deleted)?
  const serverTime = cur.deleted_at && cur.deleted_at > cur.updated_at ? cur.deleted_at : cur.updated_at;
  const incomingTime = op === 'delete' ? deletedAt : updatedAt;
  const inSync = cur.rev === baseRev;
  const incomingWins = inSync || cur.purged || incomingTime >= serverTime;

  if (!incomingWins) {
    // The server's copy is newer: keep it, and file the incoming text in the history.
    if (op === 'put' && text !== cur.data) {
      await db.batch([
        db.prepare('INSERT INTO rc_versions (owner, memory_id, rev, saved_at, replaced_at, reason, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(owner, id, Number(data.rev) || 0, updatedAt, now, 'conflict', text),
        trimVersions(db, owner, id)
      ]);
    }
    return { id, status: 'kept_server', record: await read() };
  }

  const stmts = [nextSeq(db, owner)];
  // The text being replaced goes into the history first.
  if (!cur.purged && text !== cur.data) stmts.push(versionStmt(db, owner, cur, inSync ? 'edit' : 'conflict', now), trimVersions(db, owner, id));
  if (op === 'put') {
    stmts.push(db.prepare(`UPDATE rc_memories SET rev = rev + 1, seq = (SELECT seq FROM rc_state WHERE owner = ?), updated_at = ?,
      deleted_at = NULL, purged = 0, data = ? WHERE owner = ? AND id = ?`).bind(owner, updatedAt, text, owner, id));
  } else {
    stmts.push(db.prepare(`UPDATE rc_memories SET rev = rev + 1, seq = (SELECT seq FROM rc_state WHERE owner = ?), updated_at = ?,
      deleted_at = ?, purged = 0, data = ? WHERE owner = ? AND id = ?`).bind(owner, updatedAt, deletedAt, text, owner, id));
  }
  await db.batch(stmts);
  return { id, status: inSync ? 'applied' : 'merged', record: await read() };
}

async function applySettings(db, owner, s) {
  const data = s.data, updatedAt = validISO(s.updatedAt);
  const cur = await db.prepare('SELECT settings, settings_updated_at FROM rc_state WHERE owner = ?').bind(owner).first();
  if (data && typeof data === 'object' && !Array.isArray(data) && updatedAt) {
    const clean = {
      themes: Array.isArray(data.themes) ? data.themes.filter(x => typeof x === 'string').slice(0, 500) : [],
      competencies: Array.isArray(data.competencies) ? data.competencies.filter(x => typeof x === 'string').slice(0, 500) : [],
      synonyms: typeof data.synonyms === 'string' ? data.synonyms.slice(0, 50000) : ''
    };
    if (!cur || !cur.settings_updated_at || updatedAt >= cur.settings_updated_at) {
      await db.batch([
        nextSeq(db, owner),
        db.prepare('UPDATE rc_state SET settings = ?, settings_updated_at = ?, settings_seq = seq WHERE owner = ?').bind(JSON.stringify(clean), updatedAt, owner)
      ]);
      return { data: clean, updatedAt };
    }
  }
  return cur && cur.settings ? { data: JSON.parse(cur.settings), updatedAt: cur.settings_updated_at } : null;
}

async function versions(db, owner, id) {
  const rows = (await db.prepare('SELECT rev, saved_at, replaced_at, reason, data FROM rc_versions WHERE owner = ? AND memory_id = ? ORDER BY replaced_at DESC LIMIT ?').bind(owner, id, KEEP_VERSIONS).all()).results || [];
  return { versions: rows.map(r => ({ rev: r.rev, savedAt: r.saved_at, replacedAt: r.replaced_at, reason: r.reason, data: JSON.parse(r.data) })) };
}

// Everything stored for this person, in Recollect's backup format.
async function exportAll(db, owner) {
  const rows = (await db.prepare('SELECT id, rev, seq, deleted_at, purged, data FROM rc_memories WHERE owner = ? ORDER BY seq').bind(owner).all()).results || [];
  const st = await db.prepare('SELECT settings FROM rc_state WHERE owner = ?').bind(owner).first();
  const memories = [], tombstones = [];
  for (const r of rows) {
    if (!r.deleted_at) memories.push(JSON.parse(r.data));
    else tombstones.push(r.purged ? { id: r.id, deletedAt: r.deleted_at, purged: true } : { id: r.id, deletedAt: r.deleted_at, memory: JSON.parse(r.data) });
  }
  const settings = st && st.settings ? JSON.parse(st.settings) : undefined;
  return {
    format: 'memory-bank-backup', schemaVersion: 1, app: 'Recollect', source: 'cloud', exportedAt: new Date().toISOString(),
    counts: { memories: memories.length, tombstones: tombstones.length }, settings, memories, tombstones
  };
}
