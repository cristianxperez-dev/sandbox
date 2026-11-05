// FUEL secure mode — the real Pages Function, a real SQLite database behind a D1-compatible adapter, and Access
// tokens signed by a key served from a local JWKS endpoint.   node --test fuel/tests/server.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../../functions/apps/fuel/api/[[path]].js";
import { _resetKeyCache } from "../server/auth.js";

/* ---------------- a D1 lookalike over node:sqlite (prepare/bind/all/first/run, atomic batch, foreign keys on) */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    run: async () => db.prepare(sql).run(...args),
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) s._exec(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
    raw: db,
  };
}

/* ---------------- a local Access issuer */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
let server, issuer, keyPair, jwk;
test.before(async () => {
  keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  jwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "k1" };
  server = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function token(claims, { kid = "k1", key = keyPair.privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64u(JSON.stringify({ iss: issuer, aud: ["aud-fuel"], exp: now + 600, iat: now, ...claims }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const USERS = [
  { email: "rd@club.test", role: "dietitian", name: "Dana Whitfield", initials: "DW" },
  { email: "ro@club.test", role: "readonly", name: "Rory Read", initials: "RR" },
  { email: "admin@club.test", role: "admin", name: "Ada Admin", initials: "AA" },
];
function envFor(db) { return { FUEL_DB: db, FUEL_ACCESS_ISSUER: issuer, FUEL_ACCESS_AUD: "aud-fuel", FUEL_USERS: JSON.stringify(USERS) }; }
async function call(env, path, { method = "GET", body, tok, headers = {} } = {}) {
  const h = new Headers({ "X-Fuel": "1", ...headers });
  if (tok) h.set("Cf-Access-Jwt-Assertion", tok);
  if (body) h.set("Content-Type", "application/json");
  const res = await onRequest({ request: new Request(`https://cperez.app/apps/fuel/api/${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

test("fails closed until configured", async () => {
  for (const env of [{}, { FUEL_DB: d1() }, { FUEL_DB: d1(), FUEL_ACCESS_ISSUER: "https://x.cloudflareaccess.com", FUEL_ACCESS_AUD: "a" },
    { FUEL_DB: d1(), FUEL_ACCESS_ISSUER: "https://x.cloudflareaccess.com", FUEL_ACCESS_AUD: "a", FUEL_USERS: '[{"email":"a@b.c","role":"superuser"}]' },
    { FUEL_DB: d1(), FUEL_ACCESS_ISSUER: "http://evil.example", FUEL_ACCESS_AUD: "a", FUEL_USERS: JSON.stringify(USERS) }]) {
    const r = await call(env, "players");
    assert.equal(r.status, 503, JSON.stringify(Object.keys(env)));
  }
});

test("23 · unauthorized access is blocked; the role comes from the server, never the browser", async () => {
  _resetKeyCache();
  const env = envFor(d1());
  assert.equal((await call(env, "players")).status, 401, "no token");
  assert.equal((await call(env, "players", { tok: await token({ email: "stranger@club.test" }) })).status, 401, "not on FUEL_USERS");
  assert.equal((await call(env, "players", { tok: await token({ email: "rd@club.test", aud: ["other"] }) })).status, 401, "wrong audience");
  assert.equal((await call(env, "players", { tok: await token({ email: "rd@club.test", exp: Math.floor(Date.now() / 1000) - 3600 }) })).status, 401, "expired");
  assert.equal((await call(env, "players", { tok: await token({ email: "rd@club.test", iss: "https://evil.example" }) })).status, 401, "wrong issuer");
  const t = await token({ email: "rd@club.test" });
  const tampered = t.split(".").map((x, i) => (i === 1 ? b64u(JSON.stringify({ ...JSON.parse(Buffer.from(x, "base64url")), email: "admin@club.test" })) : x)).join(".");
  assert.equal((await call(env, "players", { tok: tampered })).status, 401, "tampered payload");
  const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  assert.equal((await call(env, "players", { tok: await token({ email: "rd@club.test" }, { key: other.privateKey }) })).status, 401, "signed by another key");
  assert.equal((await call(env, "players", { tok: t, headers: { "X-Fuel": "" } })).status, 400, "missing X-Fuel");
  assert.equal((await call(env, "players", { tok: t, headers: { Origin: "https://evil.example" } })).status, 403, "cross-origin");
  const s = await call(env, "session?role=admin", { tok: t });
  assert.equal(s.status, 200); assert.equal(s.data.user.role, "dietitian"); assert.equal(s.data.mode, "secure");
  assert.equal(s.headers.get("Cache-Control"), "no-store");
});

test("secure mode end to end: roles enforced, D1 keys and foreign keys hold, import → re-import → rollback", async () => {
  _resetKeyCache();
  const db = d1(), env = envFor(db);
  const rd = await token({ email: "rd@club.test" }), ro = await token({ email: "ro@club.test" }), admin = await token({ email: "admin@club.test" });
  const csv = "Player ID,First Name,Last Name,DOB,Position,Affiliate,Mobile Phone\n10001,Mateo,Rodriguez,2001-04-12,SS,Corpus Christi,555-0101\n10002,Luis,Rodriguez,1999-08-30,RHP,Sugar Land,\n";
  const c1 = await call(env, "import.commit", { method: "POST", tok: rd, body: { kind: "roster", csv } });
  assert.equal(c1.status, 200); assert.equal(c1.data.counts.players_created, 2);
  const c2 = await call(env, "import.commit", { method: "POST", tok: rd, body: { kind: "roster", csv } });
  assert.equal(c2.data.counts.players_created, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM fuel_players").get().n, 2);
  const dir = (await call(env, "players", { tok: rd })).data;
  const pid = dir.find((p) => p.external_id === "10001").id;
  assert.equal((await call(env, "weight", { method: "POST", tok: ro, body: { player_id: pid, date: "2026-11-01", weight: 200 } })).status, 403, "read-only can't write");
  const w = await call(env, "weight", { method: "POST", tok: rd, body: { player_id: pid, date: "2026-11-01", weight: 200.4, unit: "lb" } });
  assert.equal(w.status, 200);
  assert.equal((await call(env, "weight", { method: "POST", tok: rd, body: { player_id: "pl_nope", date: "2026-11-01", weight: 200 } })).status, 404);
  const roDir = (await call(env, "players", { tok: ro })).data;
  assert.equal(roDir[0].phone, undefined, "read-only never receives contact details");
  // the database itself refuses a second player with the same organizational ID, and orphan records
  assert.throws(() => db.raw.prepare("INSERT INTO fuel_players (id, external_id, data) VALUES ('x', '10001', '{}')").run(), /UNIQUE/);
  assert.throws(() => db.raw.prepare("INSERT INTO fuel_weights (id, player_id, data) VALUES ('y', 'pl_missing', '{}')").run(), /FOREIGN KEY/);
  // rollback by an admin; a dietitian can't
  const csv2 = "Player ID,First Name,Last Name\n10003,New,Player\n";
  const c3 = await call(env, "import.commit", { method: "POST", tok: rd, body: { kind: "roster", csv: csv2 } });
  assert.equal((await call(env, "import.rollback", { method: "POST", tok: rd, body: { id: c3.data.batch.id } })).status, 403);
  const rb = await call(env, "import.rollback", { method: "POST", tok: admin, body: { id: c3.data.batch.id } });
  assert.equal(rb.status, 200, JSON.stringify(rb.data));
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM fuel_players").get().n, 2);
  // a batch the staff built on can't be rolled back
  assert.equal((await call(env, "import.rollback", { method: "POST", tok: admin, body: { id: c1.data.batch.id } })).status, 409);
  // audit trail in D1
  const actions = db.raw.prepare("SELECT data FROM fuel_audit").all().map((r) => JSON.parse(r.data).action);
  assert.ok(actions.includes("import") && actions.includes("create") && actions.includes("rollback"));
  // persistence: a fresh store over the same database sees everything
  assert.equal((await call(env, "players", { tok: rd })).data.length, 2);
  // bad input is a 400, not a 500
  assert.equal((await call(env, "weight", { method: "POST", tok: rd, body: { player_id: pid, date: "11/1", weight: 200 } })).status, 400);
  const notJson = await onRequest({ request: new Request("https://cperez.app/apps/fuel/api/weight", { method: "POST", headers: { "X-Fuel": "1", "Cf-Access-Jwt-Assertion": rd, "Content-Type": "application/json" }, body: "{not json" }), env });
  assert.equal(notJson.status, 400);
});
