/* Manager Hub — AI interpreter endpoint (functions/apps/manager-hub/api/interpret.js), model call mocked.
   node --test manager-hub/tests/interpret.test.mjs      No network, no key: fetch is stubbed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { onRequestPost, onRequest, _resetLimits } from "../../functions/apps/manager-hub/api/interpret.js";
const require = createRequire(import.meta.url);
const DayRead = require("../../apps/manager-hub/assistant/day-read.js");
const DaySolve = require("../../apps/manager-hub/assistant/day-solve.js");

const ORIGIN = "https://cperez.app";
const PRIMARY = "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame.";
const ENV = { ANTHROPIC_API_KEY: "test-key-not-real", MH_AI_ENABLED: "1" };
const realFetch = globalThis.fetch;
let calls = [];
function mockModel(payload, { status = 200, stop = "end_turn" } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ model: "claude-opus-5-5", stop_reason: stop, content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }], usage: { input_tokens: 4200, output_tokens: 900, cache_read_input_tokens: 3000 } }), { status, headers: { "Content-Type": "application/json" } });
  };
}
let ipN = 0;
const post = (body, { env = ENV, origin = ORIGIN, ip = "198.51.100." + (++ipN % 250) } = {}) => onRequestPost({ env, request: new Request(ORIGIN + "/apps/manager-hub/api/interpret", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }) });
const json = async (r) => [r.status, await r.json()];

test("no key configured → 503, the page falls back to the built-in reader", async () => {
  const [s, b] = await json(await post({ mode: "build", text: PRIMARY }, { env: {} }));
  assert.equal(s, 503); assert.equal(b.error, "not-configured");
  assert.equal((await post({ mode: "build", text: PRIMARY }, { env: { ANTHROPIC_API_KEY: "k" } })).status, 503, "a key alone does not switch it on");
});
test("cross-origin posts are refused; GET is not allowed; empty and oversized text refused", async () => {
  assert.equal((await post({ mode: "build", text: PRIMARY }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await onRequest({ request: new Request(ORIGIN + "/x") })).status, 405);
  assert.equal((await post({ mode: "build", text: "  " })).status, 400);
  assert.equal((await post({ mode: "build", text: "x".repeat(2000) })).status, 413);
});
test("build: a valid model reply is returned as the request (source ai); the request sent is well-formed", async () => {
  const ir = DaySolve.normalize(DayRead.read(PRIMARY, {}));
  assert.ok(DaySolve.validate(ir, { strict: true }).ok, "reader IR satisfies the strict schema: " + DaySolve.validate(ir, { strict: true }).errors.join("; "));
  mockModel({ request: ir });
  const [s, b] = await json(await post({ mode: "build", text: PRIMARY, ctx: { hittingGroups: ["Blue", "Orange"], resources: { fields: 1, cages: 1, mounds: 1 } } }));
  assert.equal(s, 200); assert.equal(b.request.source, "ai"); assert.equal(b.request.anchors.firstPitch, 780);
  const sent = calls[0];
  assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  assert.equal(sent.init.headers["x-api-key"], "test-key-not-real");
  assert.equal(sent.body.output_config.format.type, "json_schema");
  assert.deepEqual(sent.body.output_config.format.schema, DaySolve.BUILD_RESPONSE_SCHEMA);
  assert.equal(sent.body.system[0].cache_control.type, "ephemeral");
  assert.ok(sent.body.messages[0].content.includes(PRIMARY));
  assert.ok(/fundy|fundies/i.test(sent.body.system[0].text) && /indy/i.test(sent.body.system[0].text), "shorthand guidance in the system prompt");
  assert.ok(/Draft parse from the rule-based reader/.test(sent.body.messages[0].content), "the built-in reader's draft is sent for correction");
  assert.ok(sent.body.max_tokens <= 6000 && sent.body.output_config.effort === "low", "output capped; low effort by default");
  assert.ok(b.usage && typeof b.usage.input_tokens === "number" && typeof b.ms === "number", "usage and latency reported");
});
test("the model never sees roster names — only what the page sends in ctx", async () => {
  mockModel({ request: DaySolve.normalize(DayRead.read(PRIMARY, {})) });
  await post({ mode: "build", text: PRIMARY, ctx: { hittingGroups: ["Blue"] } });
  assert.ok(!/Guillemette|Schiavone|roster/i.test(calls[0].body.messages[0].content));
});
test("malformed or schema-breaking model output is refused, never repaired", async () => {
  mockModel("not json at all");
  assert.equal((await post({ mode: "build", text: PRIMARY })).status, 502);
  const bad = DaySolve.normalize(DayRead.read(PRIMARY, {})); bad.activities[0].kind = "teleport";
  mockModel({ request: bad });
  const [s, b] = await json(await post({ mode: "build", text: PRIMARY }));
  assert.equal(s, 502); assert.equal(b.error, "invalid-output");
});
test("refusal, truncation and rate limits map to clear errors", async () => {
  mockModel({}, { stop: "refusal" }); assert.equal((await post({ mode: "build", text: PRIMARY })).status, 422);
  mockModel({}, { stop: "max_tokens" }); assert.equal((await post({ mode: "build", text: PRIMARY })).status, 502);
  mockModel({}, { status: 429 }); assert.equal((await post({ mode: "build", text: PRIMARY })).status, 429);
});
test("refine: valid ops are returned; ops that break the request are refused; a bad current request is rejected", async () => {
  const ir = DaySolve.normalize(DayRead.read(PRIMARY, {}));
  mockModel({ ops: [{ op: "duration", target: { kind: "teamDefense", who: null, label: null, id: null }, set: 20, delta: null }], notes: [] });
  let [s, b] = await json(await post({ mode: "refine", text: "shorten team fundy to 20", request: ir, plan: { items: [{ start: 600, end: 615, track: "all", label: "Team Stretch", actId: "a1", fixed: true }] } }));
  assert.ok(/10:00–10:15 \[all\] Team Stretch/.test(calls[0].body.messages[0].content), "the current timetable is sent with a follow-up");
  if (s !== 200) console.log(b);
  assert.equal(s, 200); assert.equal(b.ops.length, 1);
  assert.deepEqual(calls[0].body.output_config.format.schema, DaySolve.REFINE_RESPONSE_SCHEMA);
  assert.equal((await post({ mode: "refine", text: "x", request: { nope: 1 } })).status, 400);
  mockModel({ ops: "nope", notes: [] });
  assert.equal((await post({ mode: "refine", text: "x", request: ir })).status, 502);
});
test("network timeout → 504", async () => {
  globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  assert.equal((await post({ mode: "build", text: PRIMARY })).status, 504);
  globalThis.fetch = realFetch;
});

test("rate limits per client: a burst is refused with Retry-After, other clients unaffected", async () => {
  _resetLimits();
  mockModel({ request: DaySolve.normalize(DayRead.read(PRIMARY, {})) });
  const env = Object.assign({}, ENV, { MH_AI_RATE: "3" });
  for (let i = 0; i < 3; i++) assert.equal((await post({ mode: "build", text: PRIMARY }, { env, ip: "203.0.113.9" })).status, 200);
  const r = await post({ mode: "build", text: PRIMARY }, { env, ip: "203.0.113.9" });
  assert.equal(r.status, 429); assert.ok(+r.headers.get("Retry-After") > 0);
  assert.equal(calls.length, 3, "the refused request never reached the model");
  assert.equal((await post({ mode: "build", text: PRIMARY }, { env, ip: "203.0.113.10" })).status, 200);
  globalThis.fetch = realFetch;
});
