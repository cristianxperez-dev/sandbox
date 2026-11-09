/* Manager Hub — AI interpreter for "Describe Your Day".
   POST /apps/manager-hub/api/interpret   (behind the Manager Hub access code: functions/_middleware.js)
   body: { mode: "build" | "refine", text, ctx, request? }
   The model reads the coach's words and returns the day's structure (the DayRequest IR) or edit
   operations — never clock times it made up, never rows. The page's deterministic solver does all
   timing, feasibility and conflict work, and the coach reviews before anything is saved.

   Secrets (Cloudflare Pages → Settings → Variables and Secrets, Production and Preview):
     ANTHROPIC_API_KEY  required. Without it this answers 503 and the page uses its built-in reader.
     MH_AI_MODEL        optional model id (default below).
   The key never leaves this function. Only the request text and a compact context are sent
   (group names, resource counts, game time, the current day's structure) — no roster names. */
import DaySolve from "../../../../apps/manager-hub/assistant/day-solve.js";
import DayKB from "../../../../apps/manager-hub/assistant/day-kb.js";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TEXT = 1500, MAX_CTX = 16000, TIMEOUT_MS = 25000;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function kindTable() {
  return DayKB.IDS.map((id) => {
    const k = DayKB.kind(id), d = k.dur || {};
    return `- ${id} — ${k.label}; who: ${k.who}; minutes default ${d.def ?? "–"} (min ${d.min ?? "–"}, max ${d.max ?? "–"})`;
  }).join("\n");
}

// Stable across requests (cached): instructions, the vocabulary, worked examples.
function systemPrompt() {
  return `You read short, informal descriptions of a baseball team's day written or dictated by coaches and coordinators in a minor-league organisation, and turn them into a structured request for a scheduling engine. You do not schedule: the engine places every activity, checks feasibility and reports conflicts. Your job is to capture exactly what the coach said and meant — times they stated, activities they asked for, order they implied, buffers, hard stops, groups — and nothing they didn't.

Rules
- Times are minutes after midnight (10:00 AM = 600, 1:00 PM = 780, 6:05 PM = 1085). Put a time on an activity ("at") only when the coach stated it. Never invent clock times.
- AM/PM when unstated: a game or first pitch at 1–10 is PM; practice activities at 6–11 are AM, 12 is noon, 1–5 is PM; "finish by 2" is 2 PM. A number followed by minutes/min/off is a duration, never a clock time.
- Durations: set "dur" only when stated ("30-minute", "for 45"). "30-minute BP rounds" means rounds: {each: 30, count: null} unless a number of rounds or groups is stated.
- "30 off pregame" / "30 minutes off before the game" sets anchors.offBeforeGame = 30. "45 minutes off before stretch" is an offBefore entry {min: 45, before: <stretch activity id>}.
- "finish/done/wrap by X", "hard stop at X" set anchors.end. "start at X", "report at X", or a clearly first activity at a stated time set anchors.start. A game time sets anchors.firstPitch and dayType "game"; "no game"/"off day"/"workout" sets dayType "workout".
- Shorthand: fundy/fundies = team fundamentals (teamDefense); indy/indys/indy D = individual defense (indDefense); PFP = pitchers' fielding practice (pfp); pens = bullpens; BP = batting practice; "hitting stations"/cage/tee/flips/machine = cage; "pitchers throw" = pitcherWork (who pitchers); catch play/long toss = throwing; FCL/complex day = level "fcl".
- Order: list activities in the order the coach mentioned them ("order" 1, 2, 3…). Add "after"/"before" ids only for explicit sequencing words (then, after, before, followed by, "defense after").
- who: "all" for whole-team items (stretch, meetings, meals, game, free time), "position" for position-player work (defense, BP, cage, baserunning), "pitchers" for pitcher work. Do not add pitcher work unless the coach mentioned pitchers.
- Groups: set groups.hitting only when a number of hitting/BP groups is stated. Never invent group names, coaches or facilities.
- "same as yesterday but…" sets base {ref: "yesterday"} and puts the changes in edits. A refinement of the current draft sets base {ref: "current"}.
- Anything you cannot map goes into "unknown" as the coach's own words. Short notes on genuine ambiguity go into "notes" (one line each, at most three).
- Every activity needs a short id ("a1", "a2", …), the closest kind, and a clean label in a coach's words ("Team Fundamentals", "Individual Defense", "Batting Practice").

Activity kinds
${kindTable()}

Worked example
Coach: "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame."
→ dayType "game"; anchors {start: 600, end: null, firstPitch: 780, offBeforeGame: 30}; activities: a1 stretch at 600 who all, order 1; a2 teamDefense "Team Fundamentals" who all, order 2; a3 indDefense "Individual Defense" who position, order 3; a4 bp "Batting Practice" who position, rounds {each: 30, count: null}, order 4. No unknown.

For refinements you return edit operations against the current request instead (see the schema): move, duration (set or delta), shift, at, add, remove, anchor, rounds, parallel, lock, indoor. Target activities by kind/who/label as they appear in the current request. Keep everything the coach did not mention unchanged — return only the operations needed.`;
}

async function callModel(env, { mode, text, ctx, request }) {
  const schema = mode === "refine" ? DaySolve.REFINE_RESPONSE_SCHEMA : DaySolve.BUILD_RESPONSE_SCHEMA;
  const user = mode === "refine"
    ? `Current request (JSON):\n${JSON.stringify(request)}\n\nContext: ${JSON.stringify(ctx)}\n\nCoach's follow-up: ${text}`
    : `Context: ${JSON.stringify(ctx)}\n\nCoach: ${text}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ac.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify({
        model: env.MH_AI_MODEL || DEFAULT_MODEL,
        max_tokens: 8000,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
        fallbacks: "default",
        system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }]
      })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) return { error: `model service ${r.status}`, status: r.status === 429 ? 429 : 502 };
    if (data.stop_reason === "refusal") return { error: "declined", status: 422 };
    if (data.stop_reason === "max_tokens") return { error: "incomplete", status: 502 };
    const block = (data.content || []).find((b) => b.type === "text");
    let out; try { out = JSON.parse(block ? block.text : ""); } catch (e) { return { error: "malformed", status: 502 }; }
    return { out, model: data.model, usage: data.usage };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : "network", status: 504 };
  } finally { clearTimeout(timer); }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, { error: "cross-origin" });
  if (!env.ANTHROPIC_API_KEY) return reply(503, { error: "not-configured" });
  let body; try { body = await request.json(); } catch (e) { return reply(400, { error: "bad-json" }); }
  const mode = body && body.mode === "refine" ? "refine" : "build";
  const text = String((body && body.text) || "").trim();
  if (!text) return reply(400, { error: "empty" });
  if (text.length > MAX_TEXT) return reply(413, { error: "too-long" });
  const ctx = body.ctx && typeof body.ctx === "object" ? body.ctx : {};
  if (JSON.stringify(ctx).length > MAX_CTX) return reply(413, { error: "context-too-large" });
  if (mode === "refine" && !(body.request && DaySolve.validate(body.request).ok)) return reply(400, { error: "bad-request-state" });
  if (mode === "refine") body.request = DaySolve.normalize(body.request);

  const res = await callModel(env, { mode, text, ctx, request: body.request });
  if (res.error) return reply(res.status, { error: res.error });
  // the model's output is checked here and again in the page; anything malformed is refused, never repaired
  if (mode === "build") {
    const ir = res.out && res.out.request;
    const v = ir ? DaySolve.validate(Object.assign({}, ir, { source: "ai" }), { strict: true }) : { ok: false, errors: ["missing request"] };
    if (!v.ok) return reply(502, { error: "invalid-output", details: v.errors.slice(0, 5) });
    return reply(200, { request: Object.assign({}, ir, { source: "ai" }), model: res.model });
  }
  const ops = res.out && Array.isArray(res.out.ops) ? res.out.ops : null;
  if (!ops) return reply(502, { error: "invalid-output" });
  const applied = DaySolve.applyEdits(body.request, ops);
  const v = DaySolve.validate(applied);
  if (!v.ok) return reply(502, { error: "invalid-output", details: v.errors.slice(0, 5) });
  return reply(200, { ops, notes: (res.out.notes || []).slice(0, 3), model: res.model });
}

export function onRequest({ request }) {
  return reply(405, { error: "POST only" });
}
