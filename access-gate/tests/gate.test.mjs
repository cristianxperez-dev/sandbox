/* Sandbox access gate — unit tests (Node 20+: WebCrypto, Request/Response built in).
   node --test access-gate/tests/gate.test.mjs        Placeholder secrets only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate, canonicalPath, issueToken, verifyToken } from "../app-gate.js";
import { PROTECTED_APPS } from "../apps.js";

const SECRET = "test-session-secret-0123456789-abcdefghijklmnop";   // placeholder (≥ 32 chars)
const CODE = "Placeholder-Code-42";
const ENV = { SANDBOX_SESSION_SECRET: SECRET, MANAGER_HUB_ACCESS_CODE: CODE };
const ORIGIN = "https://cperez.app";
const DAY = 86400 * 1000;
let clock = Date.UTC(2026, 10, 9, 12);
const gate = createGate(PROTECTED_APPS, { now: () => clock, failureDelayMs: 0 });
const PASSED = new Response("static file", { status: 200, headers: { "Content-Type": "text/plain" } });
async function hit(path, { method = "GET", cookie, body, headers = {}, env = ENV, ip = "203.0.113.7" } = {}) {
  let nextCalled = false;
  const h = new Headers({ "CF-Connecting-IP": ip, ...headers });
  if (cookie) h.set("Cookie", cookie);
  const init = { method, headers: h };
  if (body) { init.body = new URLSearchParams(body); h.set("Content-Type", "application/x-www-form-urlencoded"); }
  // the raw path goes on the URL exactly as an attacker would send it
  const request = new Request(ORIGIN + path, init);
  const res = await gate({ request, env, next: async () => { nextCalled = true; return new Response("static file", { status: 200, headers: { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" } }); } });
  return { res, nextCalled, text: res.status !== 204 ? await res.clone().text() : "" };
}
const cookieOf = (res) => (res.headers.get("Set-Cookie") || "").split(";")[0];
async function login(ip = "198.51.100.1", code = CODE, next) {
  return hit("/apps/manager-hub/access/login", { method: "POST", body: { code, ...(next ? { next } : {}) }, headers: { Origin: ORIGIN }, ip });
}

test("other Sandbox apps and pages pass straight through, untouched", async () => {
  for (const p of ["/", "/apps/fuel/", "/apps/fuel/api/session", "/apps/decision-lab/data/model.json", "/apps/play-repository/", "/assets/x.css", "/apps/manager-hubx/", "/apps/manager-hu"]) {
    const { nextCalled, res } = await hit(p);
    assert.ok(nextCalled && res.status === 200, p);
  }
});

test("canonical paths: decoding, dot-segments, backslashes, case", () => {
  assert.equal(canonicalPath("/apps/manag%65r-hub/"), "/apps/manager-hub/");
  assert.equal(canonicalPath("/apps/x/..%2fmanager-hub/index.html"), "/apps/manager-hub/index.html");
  assert.equal(canonicalPath("/apps/x/%252e%252e/manager-hub/"), "/apps/manager-hub/");
  assert.equal(canonicalPath("/APPS/Manager-Hub//assistant\\engine.js"), "/apps/manager-hub/assistant/engine.js");
});

test("no encoded, upper-case or dot-segment variant of a Manager Hub URL is ever served", async () => {
  for (const p of ["/apps/manag%65r-hub/", "/apps/manager-hub/index%2ehtml", "/apps/fuel/..%2fmanager-hub/index.html", "/APPS/MANAGER-HUB/", "/apps/Manager-Hub/index.html",
    "/apps/manager-hub//index.html", "/apps/manager-hub/assistant%2fengine.js", "/apps/x/%252e%252e/manager-hub/", "/apps/manager-hub/%2e%2e/manager-hub/index.html", "/apps/manager-hub/logo%2epng"]) {
    const { res, nextCalled } = await hit(p);
    assert.ok(!nextCalled && [400, 303, 401].includes(res.status), `${p} → ${res.status}`);
    assert.ok(res.status !== 200, p);
  }
});

test("signed out: pages redirect to the access page, files get 401; the card logo stays public", async () => {
  let r = await hit("/apps/manager-hub/");
  assert.equal(r.res.status, 303); assert.equal(r.res.headers.get("Location"), "/apps/manager-hub/access/?next=%2Fapps%2Fmanager-hub%2F"); assert.ok(!r.nextCalled);
  for (const p of ["/apps/manager-hub/index.html", "/apps/manager-hub/assistant/engine.js", "/apps/manager-hub/assistant/assistant.css"]) {
    r = await hit(p, { headers: { Accept: "*/*" } });
    assert.ok(!r.nextCalled && (r.res.status === 401 || r.res.status === 303), p);
  }
  r = await hit("/apps/manager-hub/logo.png"); assert.ok(r.nextCalled && r.res.status === 200);
  r = await hit("/apps/manager-hub"); assert.equal(r.res.status, 308);
  r = await hit("/apps/manager-hub/access/"); assert.equal(r.res.status, 200); assert.ok(/Enter the access code/.test(r.text) && /name="code"/.test(r.text));
  assert.equal(r.res.headers.get("Cache-Control"), "private, no-store");
});

test("fails closed without secrets (or with a weak session secret) — for Manager Hub only", async () => {
  for (const env of [{}, { MANAGER_HUB_ACCESS_CODE: CODE }, { SANDBOX_SESSION_SECRET: SECRET }, { SANDBOX_SESSION_SECRET: "short", MANAGER_HUB_ACCESS_CODE: CODE }]) {
    let r = await hit("/apps/manager-hub/", { env }); assert.equal(r.res.status, 503); assert.ok(!r.nextCalled);
    r = await hit("/apps/manager-hub/access/login", { method: "POST", body: { code: CODE }, headers: { Origin: ORIGIN }, env }); assert.equal(r.res.status, 503);
    r = await hit("/apps/fuel/", { env }); assert.ok(r.nextCalled);
  }
});

test("valid code: a 15-day, HttpOnly, Secure, SameSite=Lax cookie scoped to Manager Hub; then the app loads", async () => {
  const r = await login("198.51.100.2", "  placeholder-code-42  ", "/apps/manager-hub/assistant/");
  assert.equal(r.res.status, 303); assert.equal(r.res.headers.get("Location"), "/apps/manager-hub/assistant/");
  const sc = r.res.headers.get("Set-Cookie");
  assert.match(sc, /^sbx_manager_hub=v1\.\d{10}\.[A-Za-z0-9_-]{43}; Path=\/apps\/manager-hub\/; Max-Age=1296000; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/);
  const page = await hit("/apps/manager-hub/", { cookie: cookieOf(r.res) });
  assert.ok(page.nextCalled && page.res.status === 200);
  assert.equal(page.res.headers.get("Cache-Control"), "private, no-store"); assert.equal(page.res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(page.res.headers.get("Set-Cookie"), null, "no renewal on use");
});

test("wrong code is refused; cross-origin login posts are refused; next can't redirect off-app", async () => {
  let r = await login("198.51.100.3", "nope"); assert.equal(r.res.status, 401); assert.ok(/isn(&#39;|')t right/.test(r.text)); assert.equal(r.res.headers.get("Set-Cookie"), null);
  r = await hit("/apps/manager-hub/access/login", { method: "POST", body: { code: CODE }, headers: { Origin: "https://evil.example" } }); assert.equal(r.res.status, 403);
  r = await hit("/apps/manager-hub/access/login", { method: "POST", body: { code: CODE }, headers: { "Sec-Fetch-Site": "cross-site" } }); assert.equal(r.res.status, 403);
  for (const n of ["https://evil.example/", "//evil.example/", "/apps/fuel/", "/apps/manager-hub/../fuel/", "/apps/manager-hub/%2e%2e/x"]) {
    r = await login("198.51.100.4", CODE, n); assert.equal(r.res.headers.get("Location"), "/apps/manager-hub/", n);
  }
  r = await hit("/apps/manager-hub/access/login"); assert.equal(r.res.status, 303);          // GET on the login URL just shows the page
});

test("rate limiting: 5 failures in 10 minutes lock that IP out for 15 minutes, even with the right code", async () => {
  const ip = "192.0.2.50";
  for (let i = 0; i < 4; i++) assert.equal((await login(ip, "bad" + i)).res.status, 401);
  assert.equal((await login(ip, "bad5")).res.status, 429);
  const locked = await login(ip, CODE); assert.equal(locked.res.status, 429); assert.equal(locked.res.headers.get("Set-Cookie"), null);
  assert.equal((await login("192.0.2.51", CODE)).res.status, 303, "other IPs unaffected");
  clock += 15 * 60 * 1000 + 1000;
  assert.equal((await login(ip, CODE)).res.status, 303, "lockout ends after 15 minutes");
});

test("expiry is fixed at 15 days and never renewed", async () => {
  const start = clock, r = await login("198.51.100.9"), c = cookieOf(r.res);
  clock = start + 14 * DAY; let p = await hit("/apps/manager-hub/", { cookie: c }); assert.ok(p.nextCalled, "valid on day 14"); assert.equal(p.res.headers.get("Set-Cookie"), null);
  clock = start + 15 * DAY - 1000; p = await hit("/apps/manager-hub/", { cookie: c }); assert.ok(p.nextCalled, "valid one second before 15 days");
  clock = start + 15 * DAY + 1000; p = await hit("/apps/manager-hub/", { cookie: c });
  assert.ok(!p.nextCalled && p.res.status === 303 && /sbx_manager_hub=; .*Max-Age=0/.test(p.res.headers.get("Set-Cookie")), "expired → back to the access page, cookie cleared");
  clock = start;
});

test("tokens: tampering, another app, a changed access code or session secret all invalidate the session", async () => {
  const now = Math.floor(clock / 1000), { token } = await issueToken(SECRET, "manager-hub", CODE, now);
  assert.ok(await verifyToken(SECRET, "manager-hub", CODE, token, now));
  assert.equal(await verifyToken(SECRET, "fuel", CODE, token, now), null);
  assert.equal(await verifyToken(SECRET, "manager-hub", CODE + "x", token, now), null);
  assert.equal(await verifyToken(SECRET + "x", "manager-hub", CODE, token, now), null);
  const [v, exp, sig] = token.split(".");
  assert.equal(await verifyToken(SECRET, "manager-hub", CODE, `${v}.${+exp + 86400}.${sig}`, now), null, "extended expiry rejected");
  assert.equal(await verifyToken(SECRET, "manager-hub", CODE, `${v}.${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, now), null);
  const forged = await issueToken(SECRET, "manager-hub", CODE, now + 40 * 86400);
  assert.equal(await verifyToken(SECRET, "manager-hub", CODE, forged.token, now), null, "an expiry further out than 15 days is never accepted");
  const p = await hit("/apps/manager-hub/", { cookie: "sbx_manager_hub=" + token.replace(/.$/, "x") }); assert.ok(!p.nextCalled);
});

test("sign-out clears the cookie and returns to the access page", async () => {
  const r = await hit("/apps/manager-hub/access/logout");
  assert.equal(r.res.status, 303); assert.equal(r.res.headers.get("Location"), "/apps/manager-hub/access/");
  assert.match(r.res.headers.get("Set-Cookie"), /^sbx_manager_hub=; Path=\/apps\/manager-hub\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
});

test("status route: presence of settings only, never values; production locked without explicit approval", async () => {
  const KEY = "sk-test-0123456789abcdefghijklmnopqrstuvwxyz";
  const env = { ...ENV, OPENAI_API_KEY: KEY, MH_AI_ENABLED: "1" };
  const statusAt = async (origin, e = env) => {
    const res = await gate({ request: new Request(origin + "/apps/manager-hub/access/status"), env: e, next: async () => new Response("x") });
    return [res.status, await res.text(), res.headers.get("Cache-Control")];
  };
  let [s, t, cc] = await statusAt("https://cperez.app");
  let b = JSON.parse(t);
  assert.equal(s, 200); assert.equal(cc, "private, no-store");
  assert.equal(b.deployment, "production"); assert.equal(b.ai.openaiKeyPresent, true); assert.equal(b.ai.enabledFlag, true);
  assert.equal(b.ai.active, false, "MH_AI_ENABLED=1 alone never switches AI on in production"); assert.equal(b.ai.reason, "production-not-approved");
  assert.ok(!t.includes(KEY) && !t.includes(CODE) && !t.includes(SECRET), "no secret values in the output");
  [s, t] = await statusAt("https://claude-youthful-mayer-58ydbz.sandbox-34x.pages.dev"); b = JSON.parse(t);
  assert.equal(b.deployment, "preview"); assert.equal(b.ai.active, true);
  [s, t] = await statusAt("https://cperez.app", { ...env, MH_AI_PRODUCTION: "approved" }); assert.equal(JSON.parse(t).ai.active, true, "explicit approval switches production on");
  [s, t] = await statusAt("https://evil.example"); assert.equal(JSON.parse(t).deployment, "production", "unknown hosts are treated as production");
  [s, t] = await statusAt("https://cperez.app", {}); b = JSON.parse(t);
  assert.equal(b.gate.accessCodePresent, false); assert.equal(b.ai.openaiKeyPresent, false); assert.equal(b.ai.reason, "no-key");
  // nothing else under the app is reachable without a session
  const other = await gate({ request: new Request("https://cperez.app/apps/manager-hub/api/interpret", { method: "POST" }), env, next: async () => new Response("x") });
  assert.equal(other.status, 401);
});

test("X-MH-Access-Key header: the right code admits a request (any host); wrong keys count toward the lockout", async () => {
  const call = (origin, key, ip = "198.51.100.200") => { let n = false; return gate({ request: new Request(origin + "/apps/manager-hub/api/x", { method: "POST", headers: { "X-MH-Access-Key": key, "CF-Connecting-IP": ip } }), env: ENV, next: async () => { n = true; return new Response("ok"); } }).then((r) => [r.status, n]); };
  assert.deepEqual(await call("https://claude-x.sandbox-34x.pages.dev", CODE), [200, true], "preview + right code → through");
  assert.deepEqual(await call("https://cperez.app", CODE), [200, true], "production + right code → through");
  assert.deepEqual(await call("https://cperez.app", "wrong"), [401, false]);
  assert.deepEqual(await call("https://cperez.app", ""), [401, false], "empty header is no access");
  for (let i = 0; i < 6; i++) await call("https://cperez.app", "wrong" + i, "198.51.100.201");
  assert.equal((await call("https://cperez.app", CODE, "198.51.100.201"))[0], 429, "locked out after repeated wrong keys, even with the right one");
  assert.deepEqual(await call("https://cperez.app", CODE, "198.51.100.202"), [200, true], "other clients unaffected");
});
