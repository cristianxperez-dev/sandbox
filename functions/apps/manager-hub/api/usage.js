/* Manager Hub — this month's estimated AI spending (Describe Your Day).
   GET /apps/manager-hub/api/usage   (behind the Manager Hub access code: functions/_middleware.js)
   Figures only — no keys, no request text. The limit itself is enforced in interpret.js. */
import { aiState } from "../../../../manager-hub/server/ai-config.js";
import { status } from "../../../../manager-hub/server/ai-budget.js";

export async function onRequestGet({ request, env }) {
  const a = aiState(env, new URL(request.url).hostname);
  const budget = await status(env);
  return new Response(JSON.stringify({ ai: { active: a.active, reason: a.reason }, budget }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}
export function onRequest() {
  return new Response(JSON.stringify({ error: "GET only" }), { status: 405, headers: { "Content-Type": "application/json" } });
}
