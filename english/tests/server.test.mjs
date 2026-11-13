/* CP English — server tests: evaluation helpers, spending limits, rate limits and the API route,
   with an in-memory SQLite standing in for D1 and OpenAI mocked (no key, no network, no cost).
   node --test english/tests/server.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as E from "../server/evaluate.js";
import * as B from "../server/budget.js";
import { aiState, settings } from "../server/config.js";
import { onRequest } from "../../functions/apps/english/api/[[path]].js";

/* ---- a minimal D1 on node:sqlite (prepare/bind/first/run/all/batch, ?1-style params) ---- */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { const r = db.prepare(sql).get(...args.map(fix)); return r ? { ...r } : null; },
    all: async () => ({ results: db.prepare(sql).all(...args.map(fix)).map((r) => ({ ...r })) }),
    run: async () => { db.prepare(sql).run(...args.map(fix)); return { success: true }; },
    _exec: () => db.prepare(sql).run(...args.map(fix)),
  });
  const fix = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  return { prepare: (sql) => stmt(sql), batch: async (list) => { db.exec("BEGIN"); try { const out = list.map((s) => s._exec()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } }, _db: db };
}
const KEY = "sk-test-" + "x".repeat(40);
const envOn = (extra) => Object.assign({ OPENAI_API_KEY: KEY, EN_AI_ENABLED: "1", EN_AI_PRODUCTION: "approved", EN_AI_USAGE: fakeD1(), SANDBOX_SESSION_SECRET: "s".repeat(40) }, extra);

/* ---- OpenAI mock ---- */
const realFetch = globalThis.fetch;
let calls = [];
let lastSTT = null;
function mockOpenAI({ transcript = "I work with young players.", logprobs = [-0.05, -0.1, -0.02, -0.08], evalOut, evalStatus = 200, lang = "en" } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/audio/transcriptions")) {
      const fd = init.body; lastSTT = fd;
      assert.equal(fd.get("language"), lang);
      return new Response(JSON.stringify({ text: transcript, logprobs: logprobs && logprobs.map((lp) => ({ token: "x", logprob: lp })) }), { status: 200 });
    }
    if (String(url).endsWith("/responses")) {
      const body = JSON.parse(init.body);
      assert.equal(body.text.format.strict, true); assert.equal(body.store, false);
      const out = evalOut === undefined ? goodEval() : evalOut;
      return new Response(JSON.stringify({ status: "completed", model: body.model, usage: { input_tokens: 1500, output_tokens: 300, input_tokens_details: { cached_tokens: 1000 } },
        output: [{ type: "message", content: [{ type: "output_text", text: typeof out === "string" ? out : JSON.stringify(out) }] }] }), { status: evalStatus });
    }
    throw new Error("unexpected fetch " + url);
  };
}
test.after(() => { globalThis.fetch = realFetch; });
function goodEval(over) {
  return Object.assign({ on_task: true, understandable: true, in_target_language: true, possible_recognition_issue: false, scores: { clarity: 3, grammar: 2, vocabulary: 3, naturalness: 3, task: 3 },
    level_estimate: "A1", strengths: ["Clear answer"], corrections: [{ said: "I have 30 years", better: "I'm 30", why: "La edad se dice con \"I am\"." }],
    better_sentence: "I'm a baseball coach. I work with young players.", feedback: "Bien: se entendió lo que quisiste decir.", feedback_target: "Good — your meaning was clear.", follow_up: "Nice! How long have you been coaching?" }, over);
}
const audio = (bytes = 4000, type = "audio/webm") => new Blob([new Uint8Array(bytes)], { type });
function speechReq(meta, opts = {}) {
  const fd = new FormData();
  if (!opts.noAudio) fd.append("audio", opts.blob || audio(), "speech");
  fd.append("meta", JSON.stringify(meta));
  return new Request("https://cperez.app/apps/english/api/speech", { method: "POST", body: fd, headers: Object.assign({ Origin: "https://cperez.app", "X-EN-Device": "dev1", "CF-Connecting-IP": "1.2.3.4" }, opts.headers) });
}
const call = async (req, env) => { const r = await onRequest({ request: req, env }); return { status: r.status, body: await r.json() }; };

/* ---------------- evaluation helpers ---------------- */
test("repeat comparison: words, contractions and numbers", () => {
  const c = E.compareRepeat("Hi, my name is Carlos. I'm from Santo Domingo.", "hi my name is carlos i am from santo domingo");
  assert.equal(c.verdict, "match"); assert.equal(c.missing.length, 0);
  const d = E.compareRepeat("Let's do five more.", "let us do 5");
  assert.deepEqual(d.missing, ["more"]); assert.equal(d.verdict, "close");
  assert.equal(E.compareRepeat("Keep your head still and watch the ball.", "I like pizza").verdict, "different");
});
test("recognition quality: empty, too little and low confidence are not judged", () => {
  assert.equal(E.recognitionQuality("", 3).ok, false);
  assert.equal(E.recognitionQuality("uh", 8).ok, false);
  assert.equal(E.recognitionQuality("I work with young players", 3, [-2, -2.5, -1.9, -2.2]).ok, false);
  assert.equal(E.recognitionQuality("I work with young players", 3, [-0.1, -0.05, -0.2]).ok, true);
  assert.equal(E.recognitionQuality("I work with young players", 3, null).ok, true);
});
test("model output is validated before it is shown or saved", () => {
  assert.ok(E.validateEval(goodEval(), "conversation"));
  assert.equal(E.validateEval(goodEval(), "answer").follow_up, "", "follow-up only in conversations");
  assert.equal(E.validateEval(goodEval({ scores: { clarity: 7, grammar: 2, vocabulary: 3, naturalness: 3, task: 3 } })), null);
  assert.equal(E.validateEval(goodEval({ level_estimate: "C2" })), null);
  assert.equal(E.validateEval(goodEval({ feedback: "" })), null);
  assert.equal(E.validateEval({ hello: 1 }), null);
  assert.equal(E.validateEval(goodEval({ corrections: [{ said: 1 }, { said: "a", better: "b", why: "c" }] })).corrections.length, 1);
  const r = E.evalRequest("gpt-6-luna", { kind: "answer", level: "A1", prompt: "What do you do?", goal: "job", examples: ["I'm a coach."] }, "I am coach");
  assert.equal(r.text.format.strict, true); assert.ok(/never judge pronunciation/i.test(r.instructions));
});

/* ---------------- configuration ---------------- */
test("AI stays off unless key + enabled + production approval + budget store", () => {
  assert.equal(aiState({}, "cperez.app").reason, "no-key");
  assert.equal(aiState({ OPENAI_API_KEY: KEY }, "cperez.app").reason, "disabled");
  assert.equal(aiState({ OPENAI_API_KEY: KEY, EN_AI_ENABLED: "1" }, "cperez.app").reason, "production-not-approved");
  assert.equal(aiState({ OPENAI_API_KEY: KEY, EN_AI_ENABLED: "1", EN_AI_PRODUCTION: "approved" }, "cperez.app").reason, "no-budget-store");
  assert.equal(aiState(envOn(), "cperez.app").active, true);
  assert.equal(aiState({ OPENAI_API_KEY: KEY, EN_AI_ENABLED: "1", MH_AI_USAGE: fakeD1() }, "abc123.sandbox-34x.pages.dev").active, true, "preview needs no production approval");
  assert.equal(settings({ EN_AI_DAILY_USD: "999" }).dailyUsd, 5, "ceilings are capped");
});

/* ---------------- budget ---------------- */
test("budget: daily ceiling refuses before overspending; settle replaces the reservation", async () => {
  const env = envOn(), lim = settings({ EN_AI_DAILY_USD: "0.01", EN_AI_MONTHLY_USD: "1" });
  const r1 = await B.reserve(env, lim, "stt", 6000);                 // $0.006
  assert.equal(r1.ok, true);
  const r2 = await B.reserve(env, lim, "stt", 6000);                 // would make $0.012 > $0.01
  assert.equal(r2.ok, false); assert.equal(r2.error, "daily-limit-reached");
  await B.settle(env, r1.ticket, 1500);                               // actual $0.0015
  const r3 = await B.reserve(env, lim, "stt", 6000);
  assert.equal(r3.ok, true, "room again once the actual cost replaced the worst case");
  const s = await B.status(env, lim);
  assert.equal(s.configured, true); assert.ok(s.today.spentUsd > 0 && s.today.spentUsd <= 0.01);
  assert.ok(s.features.stt && s.features.stt.calls >= 1);
});
test("budget: unknown model price → no call", () => {
  assert.equal(B.sttPrice({}, "some-new-model"), null);
  assert.equal(B.textPrice({}, "gpt-9-unknown"), null);
  assert.equal(B.sttPrice({ EN_AI_PRICES: JSON.stringify({ "some-new-model": { perMinute: 0.004 } }) }, "some-new-model"), 0.004);
  assert.equal(B.sttWorstMicro(0.003, 45), 3000);
});
test("rate limit per key and window", async () => {
  const env = envOn();
  for (let i = 0; i < 3; i++) assert.equal(await B.allow(env, "k", 3, 3600e3, 1000), true);
  assert.equal(await B.allow(env, "k", 3, 3600e3, 2000), false);
  assert.equal(await B.allow(env, "k", 3, 3600e3, 3600e3 + 5), true, "new window");
});

/* ---------------- API route ---------------- */
test("status route reports availability without secrets", async () => {
  const r = await call(new Request("https://cperez.app/apps/english/api/status"), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.ai.active, true);
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  const off = await call(new Request("https://cperez.app/apps/english/api/status"), {});
  assert.equal(off.body.ai.active, false); assert.equal(off.body.ai.reason, "no-key");
});
test("speech without configuration → 503 with a reason, and no OpenAI call", async () => {
  mockOpenAI();
  const r = await call(speechReq({ mode: "repeat", reference: "Hello", seconds: 2 }), { OPENAI_API_KEY: KEY });
  assert.equal(r.status, 503); assert.equal(r.body.reason, "disabled"); assert.equal(calls.length, 0);
});
test("repeat: transcription + word comparison, no evaluation call", async () => {
  mockOpenAI({ transcript: "Keep your head still and watch the ball" });
  const r = await call(speechReq({ mode: "repeat", reference: "Keep your head still and watch the ball.", seconds: 3 }), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.compare.verdict, "match");
  assert.deepEqual(calls.map((u) => u.split("/v1/")[1]), ["audio/transcriptions"]);
});
test("answer: transcription + validated evaluation", async () => {
  mockOpenAI();
  const r = await call(speechReq({ mode: "answer", seconds: 4, task: { prompt: "What do you do?", goal: "Say your job", examples: ["I'm a coach."], level: "A1" } }), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.evaluation.understandable, true);
  assert.equal(r.body.evaluation.follow_up, "", "no follow-up outside conversations");
  assert.deepEqual(calls.map((u) => u.split("/v1/")[1]), ["audio/transcriptions", "responses"]);
});
test("unclear recording: no evaluation, no fabricated feedback", async () => {
  mockOpenAI({ transcript: "", logprobs: null });
  const r = await call(speechReq({ mode: "answer", seconds: 4, task: { prompt: "What do you do?", goal: "job" } }), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.recognition.ok, false); assert.equal(r.body.evaluation, undefined);
  assert.equal(calls.filter((u) => u.endsWith("/responses")).length, 0);
});
test("invalid model output → evaluationError, never shown as feedback", async () => {
  mockOpenAI({ evalOut: { on_task: "yes" } });
  const r = await call(speechReq({ mode: "conversation", seconds: 4, task: { prompt: "Hi!", goal: "greet" } }), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.evaluation, undefined); assert.equal(r.body.evaluationError, "evaluation-invalid");
});
test("typed answers (no microphone) are evaluated as text", async () => {
  mockOpenAI();
  const req = new Request("https://cperez.app/apps/english/api/text", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://cperez.app" }, body: JSON.stringify({ task: { kind: "placement", prompt: "Tell me your name", goal: "name", level: "A1" }, text: "My name is Luis." }) });
  const r = await call(req, envOn());
  assert.equal(r.status, 200); assert.equal(r.body.typed, true); assert.ok(r.body.evaluation);
  assert.deepEqual(calls.map((u) => u.split("/v1/")[1]), ["responses"]);
});
test("guards: cross-origin, too long, wrong type, no audio, rate limit, spending limit", async () => {
  mockOpenAI();
  const env = envOn();
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hi", seconds: 2 }, { headers: { Origin: "https://evil.example" } }), env)).status, 403);
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hi", seconds: 60 }), env)).status, 413);
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hi", seconds: 2 }, { blob: audio(1000, "text/plain") }), env)).status, 415);
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hi", seconds: 2 }, { noAudio: true }), env)).status, 400);
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hi", seconds: 2 }, { blob: audio(3 * 1024 * 1024) }), env)).status, 413);
  const tight = envOn({ EN_AI_PER_DEVICE_HOUR: "2" });
  for (let i = 0; i < 2; i++) assert.equal((await call(speechReq({ mode: "repeat", reference: "Hello there", seconds: 2 }), tight)).status, 200);
  assert.equal((await call(speechReq({ mode: "repeat", reference: "Hello there", seconds: 2 }), tight)).status, 429);
  const broke = envOn({ EN_AI_DAILY_USD: "0.001" });                    // $0.001 < one worst-case minute ($0.003)
  const r = await call(speechReq({ mode: "repeat", reference: "Hello there", seconds: 2 }), broke);
  assert.equal(r.status, 402); assert.equal(r.body.error, "daily-limit-reached");
});

test("v2: Spanish — accents folded, Spanish numbers, no English contractions", () => {
  const c = E.compareRepeat("¿Cómo se siente ese agarre?", "como se siente ese agarre", "es");
  assert.equal(c.verdict, "match");
  assert.equal(E.compareRepeat("Lanza dos rectas.", "lanza 2 rectas", "es").verdict, "match");
  assert.deepEqual(E.words("Pon los dedos sobre las costuras.", "es"), ["pon", "los", "dedos", "sobre", "las", "costuras"]);
});
test("v2: evaluation request follows the target language, native language and specialty", () => {
  const r = E.evalRequest("m", { kind: "conversation", lang: "es", native: "en", specialty: "pitching", prompt: "Coach, ¿cómo quieres que agarre la pelota?", goal: "Tell him where to put his fingers.", focus: ["costuras", "dedos"] }, "pon los dedos encima de las costuras");
  assert.ok(/spoken Spanish responses/.test(r.instructions) && /English-speaking professional baseball coaches/.test(r.instructions));
  assert.ok(/feedback: .* in English/.test(r.instructions) && /code-switching/.test(r.instructions) && /never judge pronunciation/i.test(r.instructions));
  assert.ok(/specialty is pitching/.test(r.instructions));
  assert.ok(/Target language: Spanish/.test(r.input[0].content) && /costuras, dedos/.test(r.input[0].content));
  const e = E.evalRequest("m", { kind: "answer", lang: "en", native: "es", specialty: "defense", prompt: "Coach, what should I focus on?", goal: "x" }, "stay low");
  assert.ok(/spoken English responses/.test(e.instructions) && /in Spanish, no grades/.test(e.instructions) && /direct commands are normal/.test(e.instructions));
  assert.equal(E.readTask({ kind: "answer", prompt: "x", lang: "fr" }).lang, "en", "unknown language falls back to English");
  assert.equal(E.validateEval(goodEval({ in_target_language: "yes" })), null, "in_target_language must be boolean");
});
test("v2: transcription is asked for the target language with specialty vocabulary", async () => {
  mockOpenAI({ transcript: "pon los dedos sobre las costuras", lang: "es" });
  const r = await call(speechReq({ mode: "repeat", seconds: 3, lang: "es", specialty: "pitching", reference: "Pon los dedos sobre las costuras." }), envOn());
  assert.equal(r.status, 200); assert.equal(r.body.compare.verdict, "match");
  assert.ok(/costuras/.test(lastSTT.get("prompt")));
  mockOpenAI({ transcript: "pon los dedos encima de las costuras", lang: "es" });
  const a = await call(speechReq({ mode: "conversation", seconds: 4, task: { prompt: "Coach, ¿cómo quieres que agarre la pelota?", goal: "fingers on the seams", lang: "es", native: "en", specialty: "pitching" } }), envOn());
  assert.equal(a.status, 200); assert.ok(a.body.evaluation);
});
