/* NMSBSBL — unit tests: pitch parsing and movement conventions, arsenal aggregation, the access gate's NMSBSBL rules
   and the data endpoints' input checks. node --test nmsbsbl/tests/core.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../../apps/nmsbsbl/core.js");
const { createGate } = await import("../../access-gate/app-gate.js");
const { PROTECTED_APPS } = await import("../../access-gate/apps.js");
const pitches = await import("../../functions/apps/nmsbsbl/api/pitches.js");
const pitcher = await import("../../functions/apps/nmsbsbl/api/pitcher.js");
const shared = await import("../../functions/apps/nmsbsbl/api/_shared.js");

const HEAD = '"pitch_type","game_date","release_speed","release_pos_x","release_pos_z","pfx_x","pfx_z","release_spin_rate","release_extension","spin_axis","stand","p_throws","description","events","game_pk","at_bat_number","pitch_number","balls","strikes","arm_angle"';
const row = (o) => [o.t, o.d || "2026-04-01", o.v ?? 95, o.rx ?? -2, o.rz ?? 6, o.px ?? 0, o.pz ?? 1, o.s ?? 2300, o.e ?? 6.5, o.ax ?? 210, o.st || "R", o.th || "R", o.desc || "ball", o.ev || "", o.g || 1, o.ab || 1, o.pn || 1, 0, 0, o.arm ?? 40].map((v) => `"${v}"`).join(",");

test("movement conventions: IVB = 12·pfx_z; HB pitcher's view = −12·pfx_x; release side = −release_pos_x", () => {
  const P = C.parsePitches([HEAD, row({ t: "FF", px: -0.9, pz: 1.4, rx: -2.1 }), row({ t: "SL", px: 0.5, pz: 0.1 })].join("\n"));
  assert.equal(P[0].ivb, 16.8); assert.equal(P[0].hb, 10.8, "a right-hander's four-seamer runs arm side: + from the pitcher's view"); assert.equal(P[0].relX, 2.1);
  assert.equal(P[1].hb, -6, "a slider breaks glove side");
});
test("pitchouts and intentional balls are not part of an arsenal; missing values stay missing", () => {
  const P = C.parsePitches([HEAD, row({ t: "PO" }), row({ t: "IN" }), row({ t: "CH", s: "" })].join("\n"));
  assert.equal(P.length, 1); assert.equal(P[0].spin, null);
  const a = C.arsenal(P); assert.equal(a.rows[0].spin, null, "an average of nothing is nothing, never 0");
});
test("arsenal: usage, averages, whiff and CSW from real descriptions; batter-side split", () => {
  const rows = [HEAD];
  for (let i = 0; i < 6; i++) rows.push(row({ t: "FF", v: 96 + (i % 2), desc: i < 2 ? "swinging_strike" : i < 4 ? "foul" : "called_strike", st: i % 2 ? "L" : "R", pn: i + 1 }));
  for (let i = 0; i < 4; i++) rows.push(row({ t: "SL", v: 86, desc: i ? "ball" : "swinging_strike", st: "R", pn: 10 + i }));
  const P = C.parsePitches(rows.join("\n")), a = C.arsenal(P);
  const ff = a.rows.find((r) => r.type === "FF");
  assert.equal(a.total, 10); assert.equal(ff.usage, 0.6); assert.equal(ff.velo, 96.5); assert.equal(ff.veloMax, 97);
  assert.equal(ff.whiffPct, 0.5, "2 whiffs on 4 swings"); assert.equal(ff.cswPct, 4 / 6, "2 whiffs + 2 called strikes");
  const vsL = C.arsenal(P, { side: "L" });
  assert.equal(vsL.total, 3); assert.equal(vsL.rows.length, 1);
});
test("spin axis to tilt, circular mean across 0°/360°", () => {
  assert.equal(C.tilt(180), "12:00"); assert.equal(C.tilt(210), "1:00"); assert.equal(C.tilt(225), "1:30"); assert.equal(C.tilt(30), "7:00");
  assert.ok(Math.abs(C.axisMean([350, 10]) % 360) < 1e-9 || Math.abs(C.axisMean([350, 10]) - 360) < 1e-9);
});
test("68% ellipse: a horizontal cloud gives a wide, flat ellipse", () => {
  const pts = []; for (let i = 0; i < 200; i++) pts.push({ hb: 10 + Math.sin(i) * 4, ivb: 5 + Math.cos(i * 1.7) * 1 });
  const e = C.ellipse(pts);
  assert.ok(e.rx > e.ry * 2); assert.ok(Math.abs(Math.sin(e.angle)) < 0.2, "major axis horizontal");
  assert.equal(C.ellipse(pts.slice(0, 5)), null, "too few pitches: no spread drawn");
});
test("side words follow handedness (+ = toward third base)", () => {
  assert.deepEqual(C.sideWords("R"), { plus: "Arm side", minus: "Glove side" });
  assert.deepEqual(C.sideWords("L"), { plus: "Glove side", minus: "Arm side" });
});
test("axis range: symmetric, multiples of 5, covers every pitch", () => {
  assert.equal(C.axisRange([], [{ hb: 21.2, ivb: 3 }]), 25); assert.equal(C.axisRange([], [{ hb: 3, ivb: 2 }]), 20);
});

/* ---------- the gate's NMSBSBL rules ---------- */
const ENV = { SANDBOX_SESSION_SECRET: "x".repeat(40), NMSBSBL_ACCESS_CODE: "Right-Code" };
const gate = createGate(PROTECTED_APPS, { failureDelayMs: 0 });
const call = async (path, init = {}, env = ENV) => { let reached = false; const r = await gate({ request: new Request("https://cperez.app" + path, init), env, next: async () => { reached = true; return new Response("APP", { headers: { "Content-Type": "text/html" } }); } }); return { r, reached, body: await r.text() }; };
test("gate: signed out, pages go to the branded access screen; data endpoints answer 401; nothing reaches the app", async () => {
  let x = await call("/apps/nmsbsbl/");
  assert.equal(x.r.status, 303); assert.match(x.r.headers.get("location"), /^\/apps\/nmsbsbl\/access\/\?next=/);
  x = await call("/apps/nmsbsbl/access/");
  assert.equal(x.r.status, 200); assert.match(x.body, /NMSBSBL/); assert.match(x.body, /Pitching Intelligence/); assert.match(x.body, /name="code"/);
  assert.doesNotMatch(x.body, /Right-Code/, "the code is never in the page");
  for (const p of ["/apps/nmsbsbl/api/roster", "/apps/nmsbsbl/api/pitches?id=694973&season=2026", "/apps/nmsbsbl/app.js", "/apps/nmsbsbl/index.html"]) {
    x = await call(p, { headers: { Accept: "*/*" } }); assert.ok([401, 303].includes(x.r.status), p); assert.equal(x.reached, false, p);
  }
  x = await call("/apps/nmsbsbl/logo.png"); assert.equal(x.reached, true, "the homepage card image stays public");
});
test("gate: wrong code rejected with a discreet message; right code sets an HttpOnly session that opens the app", async () => {
  const post = (code, ip) => call("/apps/nmsbsbl/access/login", { method: "POST", headers: { Origin: "https://cperez.app", "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip }, body: `code=${encodeURIComponent(code)}&next=%2Fapps%2Fnmsbsbl%2F` });
  let x = await post("nope", "203.0.113.5");
  assert.equal(x.r.status, 401); assert.match(x.body, /That code isn(&#39;|')t right/); assert.match(x.body, /aria-invalid="true"/);
  x = await post("  right-code ", "203.0.113.6");
  assert.equal(x.r.status, 303); const ck = x.r.headers.get("set-cookie");
  assert.match(ck, /^sbx_nmsbsbl=v1\./); assert.match(ck, /HttpOnly/); assert.match(ck, /Secure/); assert.match(ck, /Path=\/apps\/nmsbsbl\//);
  const cookie = ck.split(";")[0];
  x = await call("/apps/nmsbsbl/api/roster", { headers: { Cookie: cookie } }); assert.equal(x.reached, true);
  x = await call("/apps/manager-hub/", { headers: { Cookie: cookie } }); assert.equal(x.reached, false, "an NMSBSBL session never opens another app");
  x = await call("/apps/nmsbsbl/", { headers: { Cookie: cookie } }); assert.doesNotMatch(x.body, /sbx-signout/, "NMSBSBL draws its own Sign out");
  x = await call("/apps/nmsbsbl/access/logout", { headers: { Cookie: cookie } }); assert.match(x.r.headers.get("set-cookie"), /Max-Age=0/);
});
test("gate: five failures lock the IP out", async () => {
  const post = (code) => call("/apps/nmsbsbl/access/login", { method: "POST", headers: { Origin: "https://cperez.app", "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "198.51.100.77" }, body: `code=${code}` });
  for (let i = 0; i < 5; i++) await post("bad" + i);
  const x = await post("Right-Code"); assert.equal(x.r.status, 429, "even the right code waits out the lockout");
});
test("gate: no secret → access denied (503), never open", async () => {
  const x = await call("/apps/nmsbsbl/", {}, { SANDBOX_SESSION_SECRET: "x".repeat(40) });
  assert.equal(x.r.status, 503); assert.equal(x.reached, false); assert.match(x.body, /Access isn(&#39;|')t configured/);
});
test("gate: Manager Hub's test header is not a key to NMSBSBL", async () => {
  const x = await call("/apps/nmsbsbl/api/roster", { headers: { "X-MH-Access-Key": "Right-Code" } });
  assert.equal(x.reached, false);
});

/* ---------- endpoints: only covered pitchers, valid seasons ---------- */
test("endpoints refuse pitchers NMSBSBL doesn't cover and bad seasons (no open proxy)", async () => {
  let r = await pitches.onRequestGet({ request: new Request("https://x/apps/nmsbsbl/api/pitches?id=592450&season=2026") }); assert.equal(r.status, 404);
  r = await pitches.onRequestGet({ request: new Request("https://x/apps/nmsbsbl/api/pitches?id=694973&season=2014") }); assert.equal(r.status, 400);
  r = await pitches.onRequestGet({ request: new Request("https://x/apps/nmsbsbl/api/pitches?id=694973&season=2026x") }); assert.equal(r.status, 400);
  r = await pitcher.onRequestGet({ request: new Request("https://x/apps/nmsbsbl/api/pitcher?id=1") }); assert.equal(r.status, 404);
  assert.ok(shared.PITCHERS.length >= 16 && new Set(shared.PITCHERS).size === shared.PITCHERS.length);
  assert.match(pitches.upstreamFor(694973, 2026), /pitchers_lookup%5B%5D=694973&hfSea=2026%7C&hfGT=R%7C/);
  assert.equal(pitches.looksLikeStatcast("<html>error"), false);
});
