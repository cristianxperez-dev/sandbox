/* Manager Hub — shared operations store for camps / Spring Training (behind the Manager Hub access code).

   Documents (JSON, one row each, versioned):
     camp:<campId>     the camp: facilities, staff, players, groups, schedule draft + published snapshot
     games:<campId>    exhibition games + the Game Play Matrix (planned and actual participation)
     lineup:<gameId>   the submitted / approved / published lineup for one game and its review history

   GET  ?camp=<campId>          every document of that camp (one call; the page polls this) → { docs:[…], stored, coordinator }
   GET  ?list=camps             camps on the server → { camps:[{id, title, version, updated, by}] }
   GET  ?doc=<id>               one document → { id, doc, version, updated, by }
   GET  ?history=<id>           audit trail (newest first, 100) → { history:[{version, at, by, action, summary}] }
   PUT  { id, doc, baseVersion, by, action, summary }  → 200 { version, updated } | 409 { doc, version, updated, by }
        Optimistic concurrency: a write must name the version it was based on. A newer version answers 409 with
        that version, and the page merges (StCore.merge3) and tries again — nothing is overwritten silently.

   Roles. Manager Hub has one shared access code and no user accounts, so "by" is the name a person picked in
   the app (self-reported, shown in the history as such). Approving / returning / publishing a lineup and
   publishing a camp schedule can be limited to coordinators: set the secret MH_COORDINATOR_CODE and those
   writes need it in the X-MH-Coordinator header. Without it they are open to anyone signed in (the app says so).

   Storage: the D1 database bound as MH_AI_USAGE (the one the AI spending limit and settings use); tables
   mh_ops and mh_ops_audit are created on first use. Without it: GET answers { stored:false } and PUT 503 —
   the page keeps working in that browser only. */
import CampCore from "../../../../apps/manager-hub/camp/camp-core.js";
import StCore from "../../../../apps/manager-hub/st/st-core.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const ID_RE = /^(camp|games|lineup):[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 1800000;   // D1 rows hold up to 2 MB
const ready = new WeakSet();
const dbOf = (env) => (env && env.MH_AI_USAGE && typeof env.MH_AI_USAGE.prepare === "function" ? env.MH_AI_USAGE : null);

async function tables(db) {
  if (ready.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS mh_ops (id TEXT PRIMARY KEY, kind TEXT NOT NULL, camp TEXT, title TEXT, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated TEXT, by TEXT)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS mh_ops_camp ON mh_ops (camp)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS mh_ops_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, version INTEGER, at TEXT, by TEXT, action TEXT, summary TEXT)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS mh_ops_audit_id ON mh_ops_audit (id, seq)").run();
  ready.add(db);
}
const all = async (stmt) => { const r = await stmt.all(); return (r && r.results) || []; };

/** constant-time comparison of the coordinator code */
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}
const coordinatorConfigured = (env) => !!(env && env.MH_COORDINATOR_CODE);
const isCoordinator = (env, request) => coordinatorConfigured(env) && same(request.headers.get("X-MH-Coordinator"), env.MH_COORDINATOR_CODE);

/** normalise by kind; returns {doc, campId, title} or {error} */
function clean(id, doc) {
  const kind = id.split(":")[0], key = id.slice(kind.length + 1);
  if (kind === "camp") {
    const c = CampCore.normalizeState({ camps: [Object.assign({}, doc, { id: key })] }).camps[0];
    if (!c) return { error: "bad-camp" };
    c.kind = StCore.KINDS.some((k) => k.id === doc.kind) ? doc.kind : undefined;
    if (!c.kind) delete c.kind;
    return { doc: c, campId: key, title: c.name };
  }
  if (kind === "games") return { doc: StCore.normGamesDoc(doc), campId: key, title: "" };
  const l = StCore.normLineupDoc(doc, key, String(doc && doc.campId || ""));
  return { doc: l, campId: l.campId, title: "" };
}

/** which coordinator-only changes this write makes (empty = none) */
function coordinatorChanges(id, before, after) {
  const kind = id.split(":")[0], out = [];
  if (kind === "camp") {
    const a = before && before.published ? before.published.at : null, b = after && after.published ? after.published.at : null;
    if (a !== b) out.push("publish-schedule");
  }
  if (kind === "lineup") {
    const s0 = before ? before.status : "none", s1 = after.status;
    if (s1 !== s0 && ["approved", "published", "returned"].includes(s1)) out.push(s1 === "returned" ? "return" : s1 === "approved" ? "approve" : "publish");
    if (JSON.stringify(before ? before.published : null) !== JSON.stringify(after.published) && !out.includes("publish")) out.push("publish");
  }
  return out;
}
/** a lineup's status can only move along the review workflow */
function lineupStepOk(before, after) {
  const s0 = before ? before.status : "none", s1 = after.status;
  if (s0 === s1) return true;
  const next = { none: ["submitted"], submitted: ["submitted", "approved", "returned", "published"], returned: ["submitted", "approved"], approved: ["published", "returned", "submitted"], published: ["submitted"] };
  return (next[s0] || []).includes(s1);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), db = dbOf(env);
  const coordinator = { required: coordinatorConfigured(env), valid: isCoordinator(env, request) };
  if (!db) return reply(200, { stored: false, docs: [], camps: [], coordinator });
  try {
    await tables(db);
    const p = url.searchParams;
    if (p.get("camp")) {
      const camp = p.get("camp");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(camp)) return reply(400, { error: "bad-id" });
      const rows = await all(db.prepare("SELECT id, value, version, updated, by FROM mh_ops WHERE camp = ?1").bind(camp));
      return reply(200, { stored: true, coordinator, docs: rows.map((r) => ({ id: r.id, doc: JSON.parse(r.value), version: r.version, updated: r.updated, by: r.by })) });
    }
    if (p.get("list") === "camps") {
      const rows = await all(db.prepare("SELECT id, title, version, updated, by FROM mh_ops WHERE kind = 'camp' ORDER BY updated DESC LIMIT 200"));
      return reply(200, { stored: true, coordinator, camps: rows });
    }
    if (p.get("history")) {
      const id = p.get("history"); if (!ID_RE.test(id)) return reply(400, { error: "bad-id" });
      const rows = await all(db.prepare("SELECT version, at, by, action, summary FROM mh_ops_audit WHERE id = ?1 ORDER BY seq DESC LIMIT 100").bind(id));
      return reply(200, { stored: true, history: rows });
    }
    const id = p.get("doc");
    if (!id || !ID_RE.test(id)) return reply(400, { error: "bad-id" });
    const r = await db.prepare("SELECT value, version, updated, by FROM mh_ops WHERE id = ?1").bind(id).first();
    return reply(200, { stored: true, coordinator, id, doc: r ? JSON.parse(r.value) : null, version: r ? r.version : 0, updated: r ? r.updated : null, by: r ? r.by : null });
  } catch (e) { return reply(503, { error: "ops-store-error" }); }
}

export async function onRequestPut({ request, env }) {
  const url = new URL(request.url), origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, { error: "cross-origin" });
  const db = dbOf(env);
  if (!db) return reply(503, { error: "ops-not-configured" });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return reply(413, { error: "too-large" });
  let body; try { body = JSON.parse(raw); } catch (e) { return reply(400, { error: "bad-json" }); }
  const id = String((body && body.id) || "");
  if (!ID_RE.test(id) || !body.doc || typeof body.doc !== "object") return reply(400, { error: "bad-request" });
  const c = clean(id, body.doc);
  if (c.error) return reply(400, { error: c.error });
  const by = String(body.by || "").trim().slice(0, 60) || "Unnamed", action = String(body.action || "save").slice(0, 40), summary = String(body.summary || "").slice(0, 300);
  const base = Math.max(0, +body.baseVersion || 0), now = new Date().toISOString(), value = JSON.stringify(c.doc);
  try {
    await tables(db);
    const cur = await db.prepare("SELECT value, version, updated, by FROM mh_ops WHERE id = ?1").bind(id).first();
    const before = cur ? JSON.parse(cur.value) : null;
    if ((cur ? cur.version : 0) !== base) return reply(409, { error: "newer-version", doc: before, version: cur ? cur.version : 0, updated: cur ? cur.updated : null, by: cur ? cur.by : null });
    if (id.startsWith("lineup:") && !lineupStepOk(before, c.doc)) return reply(422, { error: "bad-transition", from: before ? before.status : "none", to: c.doc.status });
    const needs = coordinatorChanges(id, before, c.doc);
    if (needs.length && coordinatorConfigured(env) && !isCoordinator(env, request)) return reply(403, { error: "coordinator-required", actions: needs });
    let ok;
    if (base === 0) ok = await db.prepare("INSERT OR IGNORE INTO mh_ops (id, kind, camp, title, value, version, updated, by) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7) RETURNING version").bind(id, id.split(":")[0], c.campId, c.title, value, now, by).first();
    else ok = await db.prepare("UPDATE mh_ops SET value = ?2, title = ?3, camp = ?4, version = version + 1, updated = ?5, by = ?6 WHERE id = ?1 AND version = ?7 RETURNING version").bind(id, value, c.title, c.campId, now, by, base).first();
    if (!ok) {   // lost a race between the read and the write
      const r = await db.prepare("SELECT value, version, updated, by FROM mh_ops WHERE id = ?1").bind(id).first();
      return reply(409, { error: "newer-version", doc: r ? JSON.parse(r.value) : null, version: r ? r.version : 0, updated: r ? r.updated : null, by: r ? r.by : null });
    }
    await db.prepare("INSERT INTO mh_ops_audit (id, version, at, by, action, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, ok.version, now, by, needs.length ? needs.join("+") : action, summary).run();
    return reply(200, { id, version: ok.version, updated: now, by, doc: c.doc, coordinator: { required: coordinatorConfigured(env), used: needs } });
  } catch (e) { return reply(503, { error: "ops-store-error" }); }
}

export function onRequest() { return reply(405, { error: "GET or PUT" }); }
