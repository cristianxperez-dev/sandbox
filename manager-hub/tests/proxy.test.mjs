// AI proxy contract tests — no network: fetch is replaced by a recorder.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { SCHEMA } from "../ai-proxy/worker.js";
import { load } from "./load.mjs";

const M = load();
const ORIGIN = "https://cperez.app";
const ENV = { ANTHROPIC_API_KEY: "test-key", ALLOWED_ORIGIN: ORIGIN };
const post = (body, env = ENV, origin = ORIGIN) => worker.fetch(new Request("https://proxy.example/interpret", { method: "POST", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
const good = { intent: "edit", brief: "", edits: [{ op: "shift", target: "hitting", value: "15", group: "" }], monthRules: [], clarifications: [], assumptions: [] };
function mockFetch(reply, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(reply), { status }); };
  return calls;
}

test("the proxy's schema is the app's contract, byte for byte", () => {
  assert.equal(JSON.stringify(SCHEMA), JSON.stringify(M.INTERPRETATION_SCHEMA));
});
test("refuses other origins, non-POST, and runs nothing without a key", async () => {
  assert.equal((await post({ mode: "edit", text: "x" }, ENV, "https://evil.example")).status, 403);
  assert.equal((await worker.fetch(new Request("https://p/x", { method: "GET", headers: { origin: ORIGIN } }), ENV)).status, 405);
  const calls = mockFetch({});
  const r = await post({ mode: "edit", text: "move hitting back 15" }, { ALLOWED_ORIGIN: ORIGIN });
  assert.equal(r.status, 503); assert.equal(calls.length, 0);
});
test("validates input size and shape before calling the model", async () => {
  const calls = mockFetch({});
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({ mode: "delete", text: "x" })).status, 400);
  assert.equal((await post({ mode: "edit", text: "x".repeat(5000) })).status, 413);
  assert.equal(calls.length, 0);
});
test("calls the Messages API with the key server-side and a JSON-schema output", async () => {
  const calls = mockFetch({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(good) }] });
  const r = await post({ mode: "edit", text: "move hitting back 15", context: { groups: [] } });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.deepEqual(out.interpretation, good); assert.equal(out.model, "claude-opus-5-5");
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.headers["x-api-key"], "test-key");
  assert.equal(c.body.model, "claude-opus-5-5");
  assert.equal(c.body.output_config.format.type, "json_schema");
  assert.equal(c.body.fallbacks, "default");
  assert.ok(!("thinking" in c.body) && !("temperature" in c.body));
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  assert.ok(M.validateInterpretation(out.interpretation).ok, "the page's validator accepts it");
});
test("refusals, cut-off replies and non-JSON never reach the page as data", async () => {
  mockFetch({ stop_reason: "refusal", content: [] });
  assert.equal((await post({ mode: "edit", text: "x" })).status, 422);
  mockFetch({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] });
  assert.equal((await post({ mode: "edit", text: "x" })).status, 502);
  mockFetch({ stop_reason: "end_turn", content: [{ type: "text", text: "sure! here you go" }] });
  assert.equal((await post({ mode: "edit", text: "x" })).status, 502);
  mockFetch({ error: { type: "overloaded" } }, 529);
  assert.equal((await post({ mode: "edit", text: "x" })).status, 502);
});
