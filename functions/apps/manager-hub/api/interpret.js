/* Manager Hub — AI interpreter for "Describe Your Day" (OpenAI Responses API, strict Structured Outputs).
   POST /apps/manager-hub/api/interpret   (behind the Manager Hub access code: functions/_middleware.js)
   body: { mode: "build" | "refine", text, ctx, request?, plan? }

   The model reads the coach's words and returns the day's structure (the DayRequest IR) or edit
   operations — never a timetable. The page's deterministic solver does all timing, feasibility and
   conflict work, and the coach reviews before anything is saved. The built-in reader's parse is sent
   along as a draft for the model to correct.

   Configuration (Cloudflare Pages → Settings → Variables and Secrets; per environment):
     OPENAI_API_KEY      secret, required.
     MH_AI_ENABLED       "1" switches the interpreter on.
     MH_AI_PRODUCTION    "approved" is ALSO required on production hosts (cperez.app) — the owner's explicit
                         go-ahead. See manager-hub/server/ai-config.js. Check any deployment's state at
                         GET /apps/manager-hub/access/status (presence only, never values).
     MH_AI_MODEL         model id (default in ai-config.js).
     MH_AI_EFFORT        reasoning effort: low (default) | medium | high | none (omit the parameter).
     MH_AI_RATE          requests per client IP per 10 minutes (default 20).
     MH_AI_DAILY         requests per client IP per day (default 150).
     MH_AI_USAGE         D1 database binding, required: the monthly spending limit ($9.00 estimated, enforced
                         here before every call — manager-hub/server/ai-budget.js). Without it AI stays off.
   The per-IP limits below only stop runaway use from one browser; the OpenAI project budget is the
   final backstop. The key never leaves this function. Only the request text and a
   compact context are sent (group names, resource counts, game time, the day's structure) — no roster.
   Logs record mode, status, model, tokens and latency only — never the coach's text or the key. */
import DaySolve from "../../../../apps/manager-hub/assistant/day-solve.js";
import DayKB from "../../../../apps/manager-hub/assistant/day-kb.js";
import DayRead from "../../../../apps/manager-hub/assistant/day-read.js";
import { aiState } from "../../../../manager-hub/server/ai-config.js";
import * as Budget from "../../../../manager-hub/server/ai-budget.js";

const MAX_TEXT = 1500, MAX_CTX = 16000, TIMEOUT_MS = 25000;
const MAX_TOKENS = { build: 6000, refine: 3000 };
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const reply = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/* ---------------------------------------------------------- rate limits
   Per edge isolate (best effort, like the access gate's lockout). Real spend caps: the OpenAI project budget. */
const hits = new Map();   // ip -> {short:[ts…], day:{d, n}}
function limited(ip, env, now = Date.now()) {
  const perTen = +env.MH_AI_RATE || 20, perDay = +env.MH_AI_DAILY || 150;
  const h = hits.get(ip) || { short: [], day: { d: "", n: 0 } };
  const today = new Date(now).toISOString().slice(0, 10);
  h.short = h.short.filter((t) => now - t < 600000);
  if (h.day.d !== today) h.day = { d: today, n: 0 };
  if (h.short.length >= perTen) return { retry: Math.ceil((600000 - (now - h.short[0])) / 1000) };
  if (h.day.n >= perDay) return { retry: 3600 };
  h.short.push(now); h.day.n++; hits.set(ip, h);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return null;
}
export function _resetLimits() { hits.clear(); }

/* -------------------------------------------------------------- prompt */
function kindTable() {
  return DayKB.IDS.map((id) => {
    const k = DayKB.kind(id), d = k.dur || {};
    return `- ${id} — ${k.label}; usual who: ${k.who}; minutes ${d.def ?? "–"} (${d.min ?? "–"}–${d.max ?? "–"})`;
  }).join("\n");
}
// Stable across requests (prompt-cached): role, rules, vocabulary, worked examples.
const SYSTEM = () => `You are the language-understanding step of a baseball scheduling assistant used by coaches and coordinators in a minor-league organisation (Triple-A down to the Florida Complex League). They type or dictate the day loosely — run-ons, shorthand, afterthoughts, self-corrections. You turn what they said into a structured request for a deterministic scheduling engine. You do NOT build the timetable: the engine places every block, fills or compresses time, runs pitchers alongside position players, checks fields/cages and reports conflicts with alternatives. Your job is to capture exactly what the coach said and clearly meant, and nothing they didn't.

You also receive a DRAFT parse from a rule-based reader. Use it as a hint only: it is often incomplete or wrong (lost times, missed activities, wrong kinds). Return the request a careful, experienced baseball coordinator would write down.

Rules
- Times are minutes after midnight (10:00 AM = 600, 1:00 PM = 780, 6:05 PM = 1085). Put "at" on an activity only when the coach gave it a time (including "at", "starts", "from 4 to 5", "4:10-5:10", "around 10"). Never invent a clock time.
- AM/PM when unstated: a game/first pitch at 1–10 is PM unless "am" is said or it's clearly a morning complex game; practice items at 6–11 are AM, 12 is noon, 1–5 PM; a stop like "done by 2" is PM. "twelve oh five" = 12:05. A number followed by min/minutes/off/down/each/apiece is a duration, never a clock time.
- Day anchors: "start/report/in by/on the field at X" → anchors.start (unless an earlier stated item like a bus or meeting clearly opens the day — then start is that earlier time). "done/finish/off the field/out of there/gone/need the field back by X" → anchors.end. A game time → anchors.firstPitch and dayType "game"; "no game", "off day", "workout", "practice only", "camp" → dayType "workout". FCL/complex/instructs → level "fcl".
- Time off: "30 off", "30 down", "45 before first pitch to eat", "give them 35 before the game" → anchors.offBeforeGame (on a game day). "N minutes off before stretch" → offBefore [{min: N, before: <that activity's id>}].
- Durations: "dur" only when stated ("45 of team defense", "fundies maybe twenty minutes", "speed session 20"). BP: "2 groups of 30", "3 rounds 20 apiece", "two rounds of 25" → rounds {count, each, atOnce: null}; "4:10-5:10 three groups" → at 610, rounds {count: 3, each: 20}. "Make it 30-minute rounds" without a number → rounds {each: 30, count: null}. "groups" means hitting groups; set groups.hitting when a number is stated.
- Activities: one item per distinct piece of work the coach asked for. Fold sub-items into their parent ("team defense with bunt coverage and pickoffs" = one teamDefense, label "Team Defense — bunt coverage, pickoffs"). Don't create an item for a phrase that only modifies another ("quick infield" = indDefense, emphasis light). Map work to the closest kind; use "custom" with the coach's words for things like film/video, bus, sim game when no kind fits (a sim game or live at-bats is liveBp).
- Who: "all" for whole-team items (stretch, meetings, meals, film, bus, free time); "position" for position-player work; "pitchers" for pitcher work (starters, relievers, arms, "the bullpen guys"); "catchers" for catcher-only work. Never add pitcher work the coach didn't mention. If both groups stretch together, that is one stretch for all.
- Order: "order" = order of mention (1, 2, 3…). Add "after"/"before" ids only for explicit sequencing words (then, after, before, followed by, right after, to finish, "X after that"). "while"/"during"/"at the same time" between two groups → put both ids in "parallel" (a list of id lists).
- Emphasis: "keep it light", "guys are beat", "getaway day" → emphasis light on the day's items; "defense-heavy day" → emphasis ["defense"].
- Rain/inside: "everything inside", "rain day" → weather "rain" and indoor true on outdoor items.
- "no X", "nothing else", "no early work" → leave X out (and note it).
- "same as yesterday but…" → base {ref: "yesterday"} with the changes as edits.
- Anything you genuinely can't map → "unknown" (the coach's words). Up to three one-line "notes" for real ambiguity. Don't put things you did map into unknown.

Activity kinds
${kindTable()}

Worked examples
1) "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame."
→ dayType game; anchors {start 600, end null, firstPitch 780, offBeforeGame 30}; a1 stretch at 600 who all; a2 teamDefense "Team Fundamentals" who all; a3 indDefense "Individual Defense" who position; a4 bp "Batting Practice" who position rounds {each 30, count null}.
2) "Game at 6. Early work at 2:30, BP at 3:30, 45 minutes off before stretch."
→ firstPitch 1080; a1 earlyWork at 870 who position; a2 bp at 930; a3 stretch (no time); offBefore [{min 45, before "a3"}].
3) "Position guys: stretch 9, fundies 30, cage. Pitchers: stretch 9 with everyone, then long toss and PFP. Lunch 11:30."
→ dayType workout; a1 stretch at 540 who all (one stretch); a2 teamDefense dur 30 who position; a3 cage who position; a4 throwing "Long Toss" who pitchers after [a1]; a5 pfp who pitchers after [a4]; a6 meal at 690; parallel [[a2, a4]].

Refinements
For a follow-up you get the current request (JSON) and the current timetable. Return only the edit operations needed — move, duration (set or delta), shift, at, add, remove, anchor, rounds, parallel, lock, indoor — targeting activities by their id when you can. Keep everything the coach didn't mention unchanged. "push everything back half an hour except the game" = anchor start +30 (and shift stated times), never moving first pitch. "one more round" = rounds count + 1 on BP. "squeeze in 15 of baserunning after fundies" = add baserunning dur 15 with after [fundies id].`;

function planLines(plan) {
  if (!plan || !Array.isArray(plan.items)) return "";
  const f = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return plan.items.slice(0, 60).map((i) => `${f(i.start)}–${f(i.end)} [${i.track}${i.group ? "/" + i.group : ""}] ${i.label} (activity ${i.actId || "-"}${i.fixed ? ", fixed" : ""})`).join("\n");
}

/** OpenAI Responses API request body (strict JSON-schema output) */
function makeBody(env, model, { mode, text, ctx, request, plan }) {
  const schema = mode === "refine" ? DaySolve.REFINE_RESPONSE_SCHEMA : DaySolve.BUILD_RESPONSE_SCHEMA;
  let user;
  if (mode === "refine") {
    user = `Context: ${JSON.stringify(ctx)}\n\nCurrent request (JSON):\n${JSON.stringify(request)}\n\nCurrent timetable:\n${planLines(plan) || "(not provided)"}\n\nCoach's follow-up: ${text}`;
  } else {
    let draft = null; try { draft = DaySolve.normalize(DayRead.read(text, ctx)); } catch (e) { draft = null; }
    user = `Context: ${JSON.stringify(ctx)}\n\nDraft parse from the rule-based reader (may be wrong or incomplete):\n${draft ? JSON.stringify(draft) : "(none)"}\n\nCoach: ${text}`;
  }
  const effort = env.MH_AI_EFFORT || "low";
  const body = {
    model,
    instructions: SYSTEM(),                     // stable prefix: cached automatically by the API
    input: [{ role: "user", content: user }],
    text: { format: { type: "json_schema", name: mode === "refine" ? "day_edits" : "day_request", strict: true, schema } },
    max_output_tokens: MAX_TOKENS[mode],
    store: false,
    prompt_cache_key: "manager-hub-day-" + mode
  };
  if (effort !== "none") body.reasoning = { effort };
  return body;
}

/** Send one request. Returns {out, model, usage, ms} or {error, status, ms}. */
async function callModel(env, body) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(body)
    });
    const ms = Date.now() - t0;
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      const code = data && data.error && (data.error.code || data.error.type) || "";
      const msg = data && data.error && data.error.message || "";
      const unavailable = r.status === 404 || /model/i.test(code) || (r.status === 400 && /model/i.test(msg));
      return { error: r.status === 429 ? "model-rate-limited" : unavailable ? "model-unavailable" : `model-service-${r.status}`, detail: code || String(msg).slice(0, 120), status: r.status === 429 ? 429 : 502, ms };
    }
    const usage = data.usage;
    if (data.status === "incomplete") return { error: (data.incomplete_details && data.incomplete_details.reason) === "content_filter" ? "declined" : "incomplete", status: 502, ms, usage, model: data.model };
    if (data.status && data.status !== "completed") return { error: "model-failed", status: 502, ms, usage, model: data.model };
    const parts = (data.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []);
    if (parts.some((c) => c.type === "refusal")) return { error: "declined", status: 422, ms, usage, model: data.model };
    const textOut = parts.filter((c) => c.type === "output_text").map((c) => c.text).join("");
    let out; try { out = JSON.parse(textOut); } catch (e) { return { error: "malformed", status: 502, ms, usage, model: data.model }; }
    return { out, model: data.model, usage, ms };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : "network", status: 504, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

/** One paid call: reserve the worst case, call, settle the actual cost. No reservation → no call. */
async function paidCall(env, model, job) {
  const price = Budget.priceOf(env, model);
  if (!price) return { error: "budget-unknown-cost", status: 503, ms: 0 };
  const body = makeBody(env, model, job);
  const worst = Budget.worstCaseMicro(price, body.instructions.length + body.input[0].content.length, body.max_output_tokens);
  const r = await Budget.reserve(env, worst);
  if (!r.ok) return { error: r.error, status: r.status, ms: 0 };
  const res = await callModel(env, body);
  const u = usageOf(res.usage);
  const actual = u ? Budget.costMicro(Budget.priceOf(env, res.model) || price, u) : (res.error === "timeout" || res.error === "network") ? worst : 0;
  await Budget.settle(env, r.ticket, actual);
  res.costUsd = Budget.usd(actual);
  return res;
}

const usageOf = (u) => (u ? { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cached_input_tokens: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0, reasoning_tokens: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0 } : null);
function log(env, o) { if (env.MH_AI_LOG !== "0") console.log(JSON.stringify(Object.assign({ evt: "mh-ai" }, o))); }

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, { error: "cross-origin" });
  // key + MH_AI_ENABLED, and on production hosts the owner's explicit approval (ai-config.js)
  const state = aiState(env, url.hostname);
  if (!state.active) return reply(503, { error: "not-configured", reason: state.reason });
  let body; try { body = await request.json(); } catch (e) { return reply(400, { error: "bad-json" }); }
  const mode = body && body.mode === "refine" ? "refine" : "build";
  const text = String((body && body.text) || "").trim();
  if (!text) return reply(400, { error: "empty" });
  if (text.length > MAX_TEXT) return reply(413, { error: "too-long" });
  const ctx = body.ctx && typeof body.ctx === "object" ? body.ctx : {};
  if (JSON.stringify(ctx).length > MAX_CTX) return reply(413, { error: "context-too-large" });
  if (mode === "refine" && !(body.request && DaySolve.validate(body.request).ok)) return reply(400, { error: "bad-request-state" });
  if (mode === "refine" && JSON.stringify(body.request).length + JSON.stringify(body.plan || {}).length > 60000) return reply(413, { error: "state-too-large" });
  // Preview-only evaluation: a model/effort from the allowlist may be chosen per request, and requests
  // that came through the gate with the preview access-code header skip the per-IP limits.
  const evalRun = state.deployment !== "production" && !!request.headers.get("X-MH-Access-Key");
  let model = state.model, effort = env.MH_AI_EFFORT || "low";
  if (state.deployment !== "production") {
    const allowed = String(env.MH_AI_MODELS || "gpt-6-luna,gpt-6.1-sol").split(",").map((x) => x.trim()).filter(Boolean);
    if (body.model && allowed.includes(body.model)) model = body.model;
    if (body.effort && ["none", "minimal", "low", "medium", "high"].includes(body.effort)) effort = body.effort;
  }
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const lim = evalRun ? null : limited(ip, env);
  if (lim) return reply(429, { error: "rate-limited", retryAfter: lim.retry }, { "Retry-After": String(lim.retry) });

  const job = { mode, text, ctx, request: mode === "refine" ? DaySolve.normalize(body.request) : null, plan: body.plan };
  const envE = Object.assign({}, env, { MH_AI_EFFORT: effort });
  let res = await paidCall(envE, model, job);
  // the main model isn't available to this OpenAI project (or rejects a parameter): try the fallback model once
  if (res.error === "model-unavailable" && state.fallbackModel && state.fallbackModel !== model) {
    log(env, { mode, status: "model-unavailable", detail: res.detail || undefined, model, retry: state.fallbackModel });
    model = state.fallbackModel;
    res = await paidCall(envE, model, job);
  }
  const budget = await Budget.status(env);
  const usage = usageOf(res.usage);
  log(env, { mode, status: res.error || "ok", detail: res.detail || undefined, ms: res.ms, model: res.model || model, usage, costUsd: res.costUsd });
  if (res.error) return reply(res.status, { error: res.error, detail: res.detail || undefined, ms: res.ms, usage, model: res.model || model, budget });
  // the model's output is checked here and again in the page; anything malformed is refused, never repaired
  if (mode === "build") {
    const ir = res.out && res.out.request ? DaySolve.normalize(Object.assign({}, res.out.request, { source: "ai" })) : null;
    const v = ir ? DaySolve.validate(ir, { strict: true }) : { ok: false, errors: ["missing request"] };
    if (!v.ok) return reply(502, { error: "invalid-output", details: v.errors.slice(0, 5), ms: res.ms, usage, model: res.model, budget });
    return reply(200, { request: ir, model: res.model, ms: res.ms, usage, costUsd: res.costUsd, budget });
  }
  const ops = res.out && Array.isArray(res.out.ops) ? DaySolve.normalizeEdits(res.out.ops) : null;
  if (!ops || !DaySolve.validateEdits(ops, { strict: true }).ok) return reply(502, { error: "invalid-output", ms: res.ms, usage, model: res.model, budget });
  const applied = DaySolve.applyEdits(DaySolve.normalize(body.request), ops);
  const v = DaySolve.validate(applied);
  if (!v.ok) return reply(502, { error: "invalid-output", details: v.errors.slice(0, 5), ms: res.ms, usage, model: res.model, budget });
  return reply(200, { ops, notes: (res.out.notes || []).slice(0, 3), model: res.model, ms: res.ms, usage, costUsd: res.costUsd, budget });
}

export function onRequest() {
  return reply(405, { error: "POST only" });
}
