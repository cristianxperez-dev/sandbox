/* Manager Hub — monthly AI spending limit, enforced on the server (Describe Your Day).

   Every OpenAI call is paid for in advance from a monthly allowance kept in Cloudflare D1:
     1. reserve  — before the call, the WORST-CASE cost (whole prompt at the uncached price + the full
                   max_output_tokens at the output price) is added to the month's "reserved" total in ONE
                   conditional UPDATE. If spent + reserved + this call would pass the cap, nothing is
                   reserved and the call is refused. D1 runs statements one at a time, so two requests
                   can never both squeeze under the cap.
     2. settle   — after the call, the reservation is replaced by the cost computed from the usage OpenAI
                   reports (cached input billed at the cached price). A timeout or network failure is
                   charged the full reservation (OpenAI may still have billed it); an HTTP error with no
                   usage is charged nothing.
   A reservation whose request dies before settling (isolate killed) simply stays counted: the error is
   always on the side of spending less.

   Fails safe: no D1 binding, a database error, or a model without a known price → no AI call (the page
   uses the built-in reader). The cap is $9.00 per UTC calendar month (OpenAI bills by calendar month);
   MH_AI_BUDGET_USD may LOWER it, never raise it.

   Amounts are integers in micro-dollars (1 USD = 1,000,000). Prices are estimates in USD per 1M tokens
   [input, cached input, output]; MH_AI_PRICES (JSON, same shape) can update them without a code change.

   Binding: a D1 database bound as MH_AI_USAGE (Pages → Settings → Bindings), in Production and Preview.
   The table is created on first use. */
export const CAP_USD = 9;
export const PRICES = {
  "gpt-6.1-sol": [2.0, 0.1, 10.0],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};
const M = 1e6;

export function capMicro(env) {
  const v = Number(env && env.MH_AI_BUDGET_USD);
  const usd = Number.isFinite(v) && v >= 0 && v < CAP_USD ? v : CAP_USD;
  return Math.round(usd * M);
}
function priceTable(env) {
  let extra = {};
  try { extra = env && env.MH_AI_PRICES ? JSON.parse(env.MH_AI_PRICES) : {}; } catch (e) { extra = {}; }
  const t = Object.assign({}, PRICES);
  for (const [k, v] of Object.entries(extra || {})) if (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(+x) && +x >= 0)) t[k] = v.map(Number);
  return t;
}
/** price row for a model id (dated snapshots like "gpt-6.1-sol-2026-09-01" match their family) or null */
export function priceOf(env, model) {
  const t = priceTable(env), m = String(model || "");
  const key = Object.keys(t).filter((k) => m === k || m.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];
  return key ? t[key] : null;
}
/** worst case in micro-dollars: every prompt token uncached (~3 characters per token, generous) + all output */
export function worstCaseMicro(price, promptChars, maxOutputTokens) {
  const inTok = Math.ceil(promptChars / 3) + 200;
  return Math.ceil(inTok * price[0] + maxOutputTokens * price[2]);
}
/** actual cost in micro-dollars from the usage OpenAI reports */
export function costMicro(price, u) {
  const input = Math.max(0, +u.input_tokens || 0), cached = Math.min(input, Math.max(0, +u.cached_input_tokens || 0));
  const out = Math.max(0, +u.output_tokens || 0);
  return Math.ceil((input - cached) * price[0] + cached * price[1] + out * price[2]);
}
export const monthOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export const usd = (micro) => Math.round(micro / 10000) / 100;

export const budgetConfigured = (env) => !!(env && env.MH_AI_USAGE && typeof env.MH_AI_USAGE.prepare === "function");

const ready = new WeakSet();
async function ensure(db) {
  if (ready.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS mh_ai_usage (month TEXT PRIMARY KEY, spent INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, updated TEXT)").run();
  ready.add(db);
}

/** this month's figures, or {configured:false} / {error} */
export async function status(env, now = Date.now()) {
  const cap = capMicro(env), month = monthOf(now);
  if (!budgetConfigured(env)) return { configured: false, month, capUsd: usd(cap) };
  try {
    const db = env.MH_AI_USAGE; await ensure(db);
    const r = (await db.prepare("SELECT spent, reserved, calls, refused FROM mh_ai_usage WHERE month = ?1").bind(month).first()) || { spent: 0, reserved: 0, calls: 0, refused: 0 };
    const used = r.spent + r.reserved;
    return { configured: true, month, capUsd: usd(cap), spentUsd: usd(r.spent), pendingUsd: usd(r.reserved), remainingUsd: usd(Math.max(0, cap - used)), calls: r.calls, refused: r.refused, reached: used >= cap, estimate: true };
  } catch (e) { return { configured: true, error: "budget-store-error", month, capUsd: usd(cap) }; }
}

/** reserve the worst case for one call. → {ok:true, ticket} | {ok:false, error, status} */
export async function reserve(env, amount, now = Date.now()) {
  if (!budgetConfigured(env)) return { ok: false, error: "budget-not-configured", status: 503 };
  if (!(amount > 0)) return { ok: false, error: "budget-unknown-cost", status: 503 };
  const db = env.MH_AI_USAGE, month = monthOf(now), cap = capMicro(env), ts = new Date(now).toISOString();
  try {
    await ensure(db);
    await db.prepare("INSERT OR IGNORE INTO mh_ai_usage (month, updated) VALUES (?1, ?2)").bind(month, ts).run();
    const got = await db.prepare("UPDATE mh_ai_usage SET reserved = reserved + ?1, calls = calls + 1, updated = ?4 WHERE month = ?2 AND spent + reserved + ?1 <= ?3 RETURNING spent, reserved").bind(amount, month, cap, ts).first();
    if (!got) {
      await db.prepare("UPDATE mh_ai_usage SET refused = refused + 1, updated = ?2 WHERE month = ?1").bind(month, ts).run();
      return { ok: false, error: "budget-reached", status: 402 };
    }
    return { ok: true, ticket: { month, amount } };
  } catch (e) { return { ok: false, error: "budget-store-error", status: 503 }; }
}

/** replace a reservation by the actual cost */
export async function settle(env, ticket, actual, now = Date.now()) {
  if (!ticket) return false;
  const cost = Math.max(0, Math.ceil(actual));
  try {
    await env.MH_AI_USAGE.prepare("UPDATE mh_ai_usage SET reserved = MAX(0, reserved - ?1), spent = spent + ?2, updated = ?4 WHERE month = ?3").bind(ticket.amount, cost, ticket.month, new Date(now).toISOString()).run();
    return true;
  } catch (e) { return false; }   // the reservation stays counted — errs on the side of spending less
}
