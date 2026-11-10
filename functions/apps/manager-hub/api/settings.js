/* Manager Hub — organization settings shared by every browser (Game Day Defaults).
   GET  /apps/manager-hub/api/settings      → { doc, version, updated, stored }
   PUT  /apps/manager-hub/api/settings      body { doc, baseVersion } → { doc, version, updated }   (409 on a newer version)
   Behind the Manager Hub access code (functions/_middleware.js); writes are same-origin only.
   Stored in the D1 database bound as MH_AI_USAGE (the one the AI spending limit uses), table mh_settings,
   created on first use. Without it: GET answers { stored:false } (the app uses its built-in defaults) and PUT 503.
   The access code is shared — there are no per-user roles, so anyone signed in can change these. */
import GameDay from "../../../../apps/manager-hub/games/gameday.js";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const KEY = "gameday";
const ready = new WeakSet();
async function table(db) {
  if (ready.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS mh_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated TEXT)").run();
  ready.add(db);
}
const db = (env) => (env && env.MH_AI_USAGE && typeof env.MH_AI_USAGE.prepare === "function" ? env.MH_AI_USAGE : null);

export async function onRequestGet({ env }) {
  const d = db(env);
  if (!d) return reply(200, { doc: null, version: 0, updated: null, stored: false });
  try {
    await table(d);
    const r = await d.prepare("SELECT value, version, updated FROM mh_settings WHERE key = ?1").bind(KEY).first();
    return reply(200, { doc: r ? JSON.parse(r.value) : null, version: r ? r.version : 0, updated: r ? r.updated : null, stored: true });
  } catch (e) { return reply(503, { error: "settings-store-error" }); }
}

export async function onRequestPut({ request, env }) {
  const url = new URL(request.url), origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, { error: "cross-origin" });
  const d = db(env);
  if (!d) return reply(503, { error: "settings-not-configured" });
  let body; try { body = await request.json(); } catch (e) { return reply(400, { error: "bad-json" }); }
  const raw = JSON.stringify((body && body.doc) || {});
  if (raw.length > 20000) return reply(413, { error: "too-large" });
  const doc = GameDay.sanitize(body.doc || {});
  const base = Math.max(0, +body.baseVersion || 0), now = new Date().toISOString();
  try {
    await table(d);
    if (base === 0) {
      const ins = await d.prepare("INSERT OR IGNORE INTO mh_settings (key, value, version, updated) VALUES (?1, ?2, 1, ?3) RETURNING version").bind(KEY, JSON.stringify(doc), now).first();
      if (ins) return reply(200, { doc, version: 1, updated: now });
    } else {
      const up = await d.prepare("UPDATE mh_settings SET value = ?2, version = version + 1, updated = ?3 WHERE key = ?1 AND version = ?4 RETURNING version").bind(KEY, JSON.stringify(doc), now, base).first();
      if (up) return reply(200, { doc, version: up.version, updated: now });
    }
    const cur = await d.prepare("SELECT value, version, updated FROM mh_settings WHERE key = ?1").bind(KEY).first();
    return reply(409, { error: "newer-version", doc: cur ? JSON.parse(cur.value) : null, version: cur ? cur.version : 0, updated: cur ? cur.updated : null });
  } catch (e) { return reply(503, { error: "settings-store-error" }); }
}

export function onRequest() { return reply(405, { error: "GET or PUT" }); }
