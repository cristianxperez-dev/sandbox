/* Manager Hub — server-side monthly AI spending limit (manager-hub/server/ai-budget.js + interpret.js).
   node --test manager-hub/tests/budget.test.mjs      No network, no key: fetch is stubbed, D1 is SQLite in memory. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { onRequestPost, _resetLimits } from "../../functions/apps/manager-hub/api/interpret.js";
import { onRequestGet as usageGet } from "../../functions/apps/manager-hub/api/usage.js";
import * as B from "../../manager-hub/server/ai-budget.js";
import { aiState } from "../../manager-hub/server/ai-config.js";
import { fakeD1 } from "./fake-d1.mjs";
const require = createRequire(import.meta.url);
const DayRead = require("../../apps/manager-hub/assistant/day-read.js");
const DaySolve = require("../../apps/manager-hub/assistant/day-solve.js");

const KEY = "sk-test-key-not-real-0123456789";
const TEXT = "Tomorrow, catchers report at 8:30 AM, hitting starts at 9:00 AM, defensive work begins at 10:00 AM, and everyone finishes at noon.";
const IR = DaySolve.normalize(DayRead.read(TEXT, {}));
const USAGE = { input_tokens: 5000, output_tokens: 1000, input_tokens_details: { cached_tokens: 4000 }, output_tokens_details: { reasoning_tokens: 300 } };
let fetches = 0;
function mock(kind = "ok") {
  fetches = 0;
  globalThis.fetch = async (url, init) => {
    fetches++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    if (kind === "timeout") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    if (kind === "credit") return new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "no credit" } }), { status: 429 });
    return new Response(JSON.stringify({ model: "gpt-6.1-sol-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ request: IR }) }] }], usage: USAGE }), { status: 200 });
  };
}
const env = (extra = {}) => ({ OPENAI_API_KEY: KEY, MH_AI_ENABLED: "1", MH_AI_PRODUCTION: "approved", MH_AI_USAGE: fakeD1(), ...extra });
let ip = 0;
const post = (e, body = { mode: "build", text: TEXT }, host = "https://cperez.app") => onRequestPost({ env: e, request: new Request(host + "/apps/manager-hub/api/interpret", { method: "POST", headers: { "Content-Type": "application/json", Origin: host, "CF-Connecting-IP": "203.0.113." + (++ip % 250) }, body: JSON.stringify(body) }) });

test("no spending store bound → AI is off (503), OpenAI is never called; the status route says why", async () => {
  mock(); _resetLimits();
  const e = env(); delete e.MH_AI_USAGE;
  const r = await post(e);
  assert.equal(r.status, 503); assert.equal((await r.json()).reason, "no-budget-store");
  assert.equal(fetches, 0);
  const a = aiState(e, "cperez.app"); assert.equal(a.active, false); assert.equal(a.budgetConfigured, false);
});

test("a successful call is charged its actual cost from OpenAI's usage (cached input at the cached price)", async () => {
  mock(); _resetLimits();
  const e = env();
  const r = await post(e); const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d)); assert.equal(fetches, 1);
  const expected = (1000 * 2 + 4000 * 0.1 + 1000 * 10) / 1e6;    // $0.0124
  assert.equal(d.costUsd, Math.round(expected * 100) / 100);
  const s = await B.status(e);
  assert.equal(s.configured, true); assert.equal(s.calls, 1); assert.equal(s.pendingUsd, 0, "the reservation is released");
  const row = e.MH_AI_USAGE._db.prepare("SELECT spent, reserved FROM mh_ai_usage").get();
  assert.equal(row.spent, Math.ceil(expected * 1e6)); assert.equal(row.reserved, 0);
  assert.equal(d.budget.capUsd, 9); assert.ok(!JSON.stringify(d).includes(KEY), "the key is never in a response");
});

test("the cap stops calls before they are made: once the worst case doesn't fit, 402 and no OpenAI call", async () => {
  mock(); _resetLimits();
  const e = env({ MH_AI_BUDGET_USD: "0.10" });                    // a lower cap so the test reaches it quickly
  let ok = 0, refused = 0;
  for (let i = 0; i < 20; i++) { const r = await post(e); if (r.status === 200) ok++; else { assert.equal(r.status, 402); assert.equal((await r.json()).error, "budget-reached"); refused++; } }
  assert.ok(ok >= 1 && refused >= 1, `${ok} ok, ${refused} refused`);
  assert.equal(fetches, ok, "refused requests never reach OpenAI");
  const row = e.MH_AI_USAGE._db.prepare("SELECT spent, reserved, refused FROM mh_ai_usage").get();
  assert.ok(row.spent + row.reserved <= 100000, "never above the cap"); assert.equal(row.refused, refused);
});

test("the cap can be lowered by configuration, never raised above $9", () => {
  assert.equal(B.capMicro({}), 9e6);
  assert.equal(B.capMicro({ MH_AI_BUDGET_USD: "50" }), 9e6);
  assert.equal(B.capMicro({ MH_AI_BUDGET_USD: "9.01" }), 9e6);
  assert.equal(B.capMicro({ MH_AI_BUDGET_USD: "abc" }), 9e6);
  assert.equal(B.capMicro({ MH_AI_BUDGET_USD: "4" }), 4e6);
});

test("concurrent requests cannot overshoot: reservations are one conditional update each", async () => {
  const e = env();
  const res = await Promise.all(Array.from({ length: 40 }, () => B.reserve(e, 1e6)));   // $1 each against $9
  assert.equal(res.filter((r) => r.ok).length, 9);
  assert.equal(res.filter((r) => !r.ok && r.error === "budget-reached").length, 31);
});

test("fails safe: a database error, or a model without a known price, refuses the call", async () => {
  mock(); _resetLimits();
  let r = await post(env({ MH_AI_USAGE: fakeD1({ fail: true }) }));
  assert.equal(r.status, 503); assert.equal((await r.json()).error, "budget-store-error"); assert.equal(fetches, 0);
  r = await post(env({ MH_AI_MODEL: "gpt-unpriced-9" }));
  assert.equal(r.status, 503); assert.equal((await r.json()).error, "budget-unknown-cost"); assert.equal(fetches, 0);
});

test("a timeout is charged the full reservation; an error with no usage (e.g. no credit) is charged nothing", async () => {
  mock("timeout"); _resetLimits();
  let e = env(); let r = await post(e); assert.equal(r.status, 504);
  let row = e.MH_AI_USAGE._db.prepare("SELECT spent, reserved FROM mh_ai_usage").get();
  assert.ok(row.spent > 50000 && row.reserved === 0, "worst case charged: " + row.spent);
  mock("credit"); e = env(); r = await post(e); assert.equal(r.status, 429);
  row = e.MH_AI_USAGE._db.prepare("SELECT spent, reserved FROM mh_ai_usage").get();
  assert.equal(row.spent, 0); assert.equal(row.reserved, 0);
});

test("the browser cannot choose an unpriced or more expensive path: production ignores model overrides", async () => {
  mock(); _resetLimits();
  const e = env();
  let sent = null; const f = globalThis.fetch; globalThis.fetch = async (u, i) => { sent = JSON.parse(i.body); return f(u, i); };
  const r = await post(e, { mode: "build", text: TEXT, model: "o9-pro-unpriced", effort: "high" });
  assert.equal(r.status, 200); assert.equal(sent.model, "gpt-6.1-sol"); assert.deepEqual(sent.reasoning, { effort: "low" });
});

test("usage endpoint: this month's estimate, no secrets", async () => {
  mock(); _resetLimits();
  const e = env(); await post(e);
  const r = await usageGet({ env: e, request: new Request("https://cperez.app/apps/manager-hub/api/usage") });
  const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.ai.active, true); assert.equal(d.budget.capUsd, 9); assert.equal(d.budget.calls, 1);
  assert.match(d.budget.month, /^\d{4}-\d{2}$/); assert.ok(!JSON.stringify(d).includes(KEY));
});

test("cost arithmetic", () => {
  const p = B.priceOf({}, "gpt-6.1-sol");
  assert.deepEqual(p, [2, 0.1, 10]); assert.deepEqual(B.priceOf({}, "gpt-6-luna-2026-01-01"), [0.1, 0.01, 0.5]);
  assert.equal(B.priceOf({}, "gpt-6.1-sol-mini"), p, "dated / suffixed ids match their family"); assert.equal(B.priceOf({}, "gpt-7"), null);
  assert.equal(B.costMicro(p, { input_tokens: 1e6, cached_input_tokens: 0, output_tokens: 0 }), 2e6);
  assert.ok(B.worstCaseMicro(p, 30000, 6000) >= B.costMicro(p, { input_tokens: 10000, cached_input_tokens: 0, output_tokens: 6000 }));
  assert.deepEqual(B.priceOf({ MH_AI_PRICES: '{"gpt-6.1-sol":[3,0.3,12]}' }, "gpt-6.1-sol"), [3, 0.3, 12]);
});
