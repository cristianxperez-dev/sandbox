/* CP English API (Cloudflare Pages Function). Behind the CP English access code (access-gate/apps.js).

   GET  /apps/english/api/status   AI availability (presence only, never values), limits, this month's usage
   POST /apps/english/api/speech   multipart: audio (≤ 2 MB, ≤ 45 s) + meta (JSON)
        meta.mode "repeat"  → transcription + deterministic word comparison with meta.reference (no AI evaluation)
        meta.mode "answer" | "conversation" | "placement" → transcription + structured evaluation of meta.task
   POST /apps/english/api/text     JSON {task, text}: typed answer (no microphone) → structured evaluation

   Privacy: audio is read into memory, sent to the transcription service and dropped; nothing is stored.
   Transcripts and feedback are returned to the learner's browser only, never logged. Logs carry metrics.
   Cost: every paid call reserves its worst case against the daily and monthly ceilings first
   (english/server/budget.js); rate limits per device and per IP (hashed). Missing configuration → 503 with
   a reason, and the page says feedback is unavailable (never a made-up score). */
import { aiState, settings } from "../../../../english/server/config.js";
import * as Budget from "../../../../english/server/budget.js";
import { compareRepeat, recognitionQuality, evalRequest, validateEval, readTask, words } from "../../../../english/server/evaluate.js";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const AUDIO = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "video/webm": "webm", "video/mp4": "mp4" };
const STT_TIMEOUT = 30000, EVAL_TIMEOUT = 30000;

export async function onRequest(ctx) {
  try { return await handle(ctx); }
  catch (e) { log(ctx.env || {}, { status: "internal-error", detail: String((e && e.message) || e).slice(0, 120) }); return reply(500, { error: "internal-error" }); }
}

async function handle({ request, env }) {
  const url = new URL(request.url), path = url.pathname.replace(/^.*?\/api\/?/, "").replace(/\/+$/, "");
  const lim = settings(env), state = aiState(env, url.hostname);
  if (path === "status" && request.method === "GET") {
    return reply(200, { ai: { active: state.active, reason: state.reason, deployment: state.deployment }, models: { stt: lim.sttModel, eval: lim.evalModel },
      limits: { maxSeconds: lim.maxSeconds, maxBytes: lim.maxBytes, dailyUsd: lim.dailyUsd, monthlyUsd: lim.monthlyUsd },
      prices: { sttPerMinute: Budget.sttPrice(env, lim.sttModel), eval: Budget.textPrice(env, lim.evalModel) }, usage: await Budget.status(env, lim) });
  }
  if (request.method !== "POST" || !["speech", "text"].includes(path)) return reply(404, { error: "not-found" });
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, { error: "cross-origin" });
  if (!state.active) return reply(503, { error: "not-configured", reason: state.reason });

  // rate limits (hashed keys: no raw IP or device id is stored)
  const device = String(request.headers.get("X-EN-Device") || "").slice(0, 64) || "anon";
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const [kd, ki] = await Promise.all([hash(env, "d:" + device), hash(env, "i:" + ip)]);
  if (!(await Budget.allow(env, kd, lim.perDeviceHour)) || !(await Budget.allow(env, ki, lim.perIpHour))) return reply(429, { error: "rate-limited" });

  if (path === "text") {
    let body; try { body = await request.json(); } catch (e) { return reply(400, { error: "bad-json" }); }
    const task = readTask(body && body.task), text = String((body && body.text) || "").slice(0, 600).trim();
    if (!task || !text) return reply(400, { error: "bad-request" });
    const ev = await evaluate(env, lim, task, text);
    log(env, { route: "text", kind: task.kind, status: ev.error || "ok", costUsd: ev.costUsd });
    return ev.error ? reply(ev.status, { error: ev.error }) : reply(200, { typed: true, evaluation: ev.evaluation });
  }

  // speech: multipart audio + meta
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len && len > lim.maxBytes + 64 * 1024) return reply(413, { error: "too-large" });
  let form; try { form = await request.formData(); } catch (e) { return reply(400, { error: "bad-form" }); }
  const audio = form.get("audio");
  let meta; try { meta = JSON.parse(String(form.get("meta") || "{}")); } catch (e) { return reply(400, { error: "bad-meta" }); }
  if (!audio || typeof audio === "string" || !audio.size) return reply(400, { error: "no-audio" });
  if (audio.size > lim.maxBytes) return reply(413, { error: "too-large" });
  const type = String(audio.type || "").split(";")[0].toLowerCase();
  if (!AUDIO[type]) return reply(415, { error: "unsupported-audio" });
  const seconds = Math.max(0.5, Math.min(lim.maxSeconds, Number(meta.seconds) || lim.maxSeconds));
  if (Number(meta.seconds) > lim.maxSeconds + 2) return reply(413, { error: "too-long" });
  const mode = ["repeat", "answer", "conversation", "placement"].includes(meta.mode) ? meta.mode : null;
  if (!mode) return reply(400, { error: "bad-mode" });
  const task = mode === "repeat" ? null : readTask(Object.assign({}, meta.task, { kind: mode === "placement" ? "placement" : mode }));
  const reference = mode === "repeat" ? String(meta.reference || "").slice(0, 300) : "";
  if (mode === "repeat" ? !words(reference).length : !task) return reply(400, { error: "bad-task" });

  const tr = await transcribe(env, lim, audio, type, seconds);
  if (tr.error) { log(env, { route: "speech", mode, status: tr.error }); return reply(tr.status, { error: tr.error }); }
  const recognition = recognitionQuality(tr.text, seconds, tr.logprobs);
  const out = { transcript: tr.text, recognition };
  if (!recognition.ok) { log(env, { route: "speech", mode, status: "unclear", sttUsd: tr.costUsd }); return reply(200, out); }
  if (mode === "repeat") {
    out.compare = compareRepeat(reference, tr.text);
    log(env, { route: "speech", mode, status: "ok", sttUsd: tr.costUsd });
    return reply(200, out);
  }
  const ev = await evaluate(env, lim, task, tr.text);
  log(env, { route: "speech", mode, status: ev.error || "ok", sttUsd: tr.costUsd, evalUsd: ev.costUsd });
  if (ev.error) return reply(200, Object.assign(out, { evaluationError: ev.error }));   // the transcript is still useful
  return reply(200, Object.assign(out, { evaluation: ev.evaluation }));
}

/* ---------------- transcription ---------------- */
async function transcribe(env, lim, audio, type, seconds) {
  const price = Budget.sttPrice(env, lim.sttModel);
  if (price == null) return { error: "unknown-model-price", status: 503 };
  const r = await Budget.reserve(env, lim, "stt", Budget.sttWorstMicro(price, lim.maxSeconds));
  if (!r.ok) return { error: r.error, status: r.status };
  const send = async (withLogprobs) => {
    const fd = new FormData();
    fd.append("file", new File([await audio.arrayBuffer()], "speech." + AUDIO[type], { type }));
    fd.append("model", lim.sttModel); fd.append("language", "en"); fd.append("response_format", "json");
    fd.append("prompt", "A baseball coach speaking English. Baseball words: infielder, shortstop, ground ball, bullpen, batting practice, glove, cone, bucket.");
    if (withLogprobs) fd.append("include[]", "logprobs");
    return timed(STT_TIMEOUT, (signal) => fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd }));
  };
  let res = await send(/^gpt-/.test(lim.sttModel));
  if (res.ok === false && res.status === 400) res = await send(false);          // model without logprobs support
  let data = null; if (res.response) data = await res.response.json().catch(() => null);
  const ok = res.response && res.response.ok && data && typeof data.text === "string";
  // a timeout may still be billed: count the worst case; a refused request costs nothing
  await Budget.settle(env, r.ticket, ok ? Budget.sttCostMicro(price, seconds) : res.timeout ? r.ticket.amount : 0);
  if (!ok) return { error: res.timeout ? "transcription-timeout" : res.response && res.response.status === 429 ? "service-busy" : "transcription-failed", status: 502 };
  const logprobs = Array.isArray(data.logprobs) ? data.logprobs.map((x) => x && x.logprob) : null;
  return { text: String(data.text).slice(0, 1000).trim(), logprobs, costUsd: Budget.usd(Budget.sttCostMicro(price, seconds)) };
}

/* ---------------- evaluation ---------------- */
async function evaluate(env, lim, task, transcript) {
  const price = Budget.textPrice(env, lim.evalModel);
  if (!price) return { error: "unknown-model-price", status: 503 };
  const body = evalRequest(lim.evalModel, task, transcript);
  if (env.EN_AI_EFFORT !== "none") body.reasoning = { effort: env.EN_AI_EFFORT || "low" };
  const worst = Budget.textWorstMicro(price, body.instructions.length + body.input[0].content.length + JSON.stringify(body.text.format.schema).length, body.max_output_tokens);
  const r = await Budget.reserve(env, lim, "eval", worst);
  if (!r.ok) return { error: r.error, status: r.status };
  const res = await timed(EVAL_TIMEOUT, (signal) => fetch("https://api.openai.com/v1/responses", { method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body) }));
  const data = res.response ? await res.response.json().catch(() => null) : null;
  const u = data && data.usage ? { input_tokens: data.usage.input_tokens || 0, output_tokens: data.usage.output_tokens || 0, cached_input_tokens: (data.usage.input_tokens_details && data.usage.input_tokens_details.cached_tokens) || 0 } : null;
  const actual = u ? Budget.textCostMicro(price, u) : res.timeout ? worst : 0;
  await Budget.settle(env, r.ticket, actual);
  if (!res.response || !res.response.ok || !data) return { error: res.timeout ? "evaluation-timeout" : "evaluation-failed", status: 502, costUsd: Budget.usd(actual) };
  const parts = (data.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
  if (parts.some((c) => c.type === "refusal") || data.status !== "completed") return { error: "evaluation-failed", status: 502, costUsd: Budget.usd(actual) };
  let out; try { out = JSON.parse(parts.filter((c) => c.type === "output_text").map((c) => c.text).join("")); } catch (e) { out = null; }
  const evaluation = validateEval(out, task.kind);                 // nothing unvalidated reaches the learner
  if (!evaluation) return { error: "evaluation-invalid", status: 502, costUsd: Budget.usd(actual) };
  return { evaluation, costUsd: Budget.usd(actual) };
}

/* ---------------- helpers ---------------- */
async function timed(ms, go) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const response = await go(ac.signal); return { response, ok: response.ok, status: response.status }; }
  catch (e) { return { response: null, ok: false, status: 0, timeout: e && e.name === "AbortError" }; }
  finally { clearTimeout(t); }
}
async function hash(env, s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((env.SANDBOX_SESSION_SECRET || "cp-english") + "|" + s));
  return "r:" + [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function log(env, o) { if (env.EN_AI_LOG !== "0") console.log(JSON.stringify(Object.assign({ evt: "cp-english" }, o))); }
