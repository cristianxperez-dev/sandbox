/* CP English — AI spending limits, usage metering and rate limits (D1).

   reserve → call → settle, like Manager Hub (manager-hub/server/ai-budget.js), with two ceilings checked
   in ONE conditional statement each so concurrent requests can't overshoot:
     day  row  "d:YYYY-MM-DD"   ≤ daily ceiling     month row "m:YYYY-MM"  ≤ monthly ceiling
   plus per-feature meter rows "f:YYYY-MM:<feature>" (stt / eval) for reporting. All amounts are integer
   micro-dollars (1 USD = 1,000,000). Fails safe: no binding, a database error or a model without a known
   price → no AI call.

   Prices: transcription in USD per audio minute, text models in USD per 1M tokens [input, cached, output].
   They are the last list prices known to this code (not re-verified on the day of writing — the OpenAI
   pricing page was not reachable from the build environment). EN_AI_PRICES (JSON) overrides them without
   a code change: {"gpt-4o-mini-transcribe":{"perMinute":0.003},"gpt-6-luna":[0.10,0.01,0.50]}. */
import { dbOf } from "./config.js";

export const STT_PRICES = {            // USD per minute of audio
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
  "whisper-1": 0.006,
};
export const TEXT_PRICES = {           // USD per 1M tokens [input, cached input, output]
  "gpt-6-luna": [0.10, 0.01, 0.50],    // as recorded by Manager Hub from OpenAI's pricing page, Nov 10 2026
};
const M = 1e6;
export const usd = (micro) => Math.round(micro) / 1e6;

function overrides(env) {
  try { return env && env.EN_AI_PRICES ? JSON.parse(env.EN_AI_PRICES) || {} : {}; } catch (e) { return {}; }
}
const family = (table, m) => Object.keys(table).filter((k) => m === k || m.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];

/** USD per minute for a transcription model, or null (unknown → no call) */
export function sttPrice(env, model) {
  const o = overrides(env), m = String(model || "");
  const ok = (v) => v && Number.isFinite(+v.perMinute) && +v.perMinute >= 0;
  const ko = family(o, m); if (ko && ok(o[ko])) return +o[ko].perMinute;
  const k = family(STT_PRICES, m); return k ? STT_PRICES[k] : null;
}
/** [input, cached, output] per 1M tokens for a text model, or null */
export function textPrice(env, model) {
  const o = overrides(env), m = String(model || "");
  const ok = (v) => Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(+x) && +x >= 0);
  const ko = family(o, m); if (ko && ok(o[ko])) return o[ko].map(Number);
  const k = family(TEXT_PRICES, m); return k ? TEXT_PRICES[k] : null;
}
/** worst case for one transcription: the whole allowed length, rounded up to the minute */
export const sttWorstMicro = (price, seconds) => Math.ceil(Math.ceil(Math.max(1, seconds) / 60) * price * M);
/** actual transcription cost from the measured duration (seconds) */
export const sttCostMicro = (price, seconds) => Math.ceil((Math.max(1, seconds) / 60) * price * M);
/** worst case for one evaluation: every prompt token uncached (~3 chars/token) + the full output allowance */
export const textWorstMicro = (price, promptChars, maxOut) => Math.ceil((Math.ceil(promptChars / 3) + 200) * price[0] + maxOut * price[2]);
export function textCostMicro(price, u) {
  const input = Math.max(0, +u.input_tokens || 0), cached = Math.min(input, Math.max(0, +u.cached_input_tokens || 0)), out = Math.max(0, +u.output_tokens || 0);
  return Math.ceil((input - cached) * price[0] + cached * price[1] + out * price[2]);
}

export const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const monthOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

const ready = new WeakSet();
async function ensure(db) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS en_ai_usage (period TEXT PRIMARY KEY, spent INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, updated TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS en_rate (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL)"),
  ]);
  ready.add(db);
}

/** reserve `amount` against today's and this month's ceilings. → {ok, ticket} | {ok:false, error, status} */
export async function reserve(env, limits, feature, amount, now = Date.now()) {
  const db = dbOf(env);
  if (!db) return { ok: false, error: "budget-not-configured", status: 503 };
  if (!(amount > 0)) return { ok: false, error: "budget-unknown-cost", status: 503 };
  const d = "d:" + dayOf(now), m = "m:" + monthOf(now), f = `f:${monthOf(now)}:${feature}`, ts = new Date(now).toISOString();
  const capD = Math.round(limits.dailyUsd * M), capM = Math.round(limits.monthlyUsd * M);
  try {
    await ensure(db);
    await db.batch([d, m, f].map((p) => db.prepare("INSERT OR IGNORE INTO en_ai_usage (period, updated) VALUES (?1, ?2)").bind(p, ts)));
    const gotD = await db.prepare("UPDATE en_ai_usage SET reserved = reserved + ?1, calls = calls + 1, updated = ?4 WHERE period = ?2 AND spent + reserved + ?1 <= ?3 RETURNING period").bind(amount, d, capD, ts).first();
    if (!gotD) { await db.prepare("UPDATE en_ai_usage SET refused = refused + 1, updated = ?2 WHERE period = ?1").bind(d, ts).run(); return { ok: false, error: "daily-limit-reached", status: 402 }; }
    const gotM = await db.prepare("UPDATE en_ai_usage SET reserved = reserved + ?1, calls = calls + 1, updated = ?4 WHERE period = ?2 AND spent + reserved + ?1 <= ?3 RETURNING period").bind(amount, m, capM, ts).first();
    if (!gotM) {
      await db.batch([
        db.prepare("UPDATE en_ai_usage SET reserved = MAX(0, reserved - ?1), calls = MAX(0, calls - 1), refused = refused + 1 WHERE period = ?2").bind(amount, d),
        db.prepare("UPDATE en_ai_usage SET refused = refused + 1, updated = ?2 WHERE period = ?1").bind(m, ts),
      ]);
      return { ok: false, error: "monthly-limit-reached", status: 402 };
    }
    return { ok: true, ticket: { d, m, f, amount } };
  } catch (e) { return { ok: false, error: "budget-store-error", status: 503 }; }
}

/** replace a reservation with the actual cost (errs on the side of counting more if the write fails) */
export async function settle(env, ticket, actual, now = Date.now()) {
  if (!ticket) return false;
  const db = dbOf(env), cost = Math.max(0, Math.ceil(actual)), ts = new Date(now).toISOString();
  try {
    await db.batch([
      ...[ticket.d, ticket.m].map((p) => db.prepare("UPDATE en_ai_usage SET reserved = MAX(0, reserved - ?1), spent = spent + ?2, updated = ?4 WHERE period = ?3").bind(ticket.amount, cost, p, ts)),
      db.prepare("UPDATE en_ai_usage SET spent = spent + ?1, calls = calls + 1, updated = ?3 WHERE period = ?2").bind(cost, ticket.f, ts),
    ]);
    return true;
  } catch (e) { return false; }
}

/** usage figures for the status route (no learner data) */
export async function status(env, limits, now = Date.now()) {
  const db = dbOf(env), month = monthOf(now);
  if (!db) return { configured: false };
  try {
    await ensure(db);
    const rows = (await db.prepare("SELECT period, spent, reserved, calls, refused FROM en_ai_usage WHERE period IN (?1, ?2) OR period LIKE ?3").bind("d:" + dayOf(now), "m:" + month, `f:${month}:%`).all()).results || [];
    const by = Object.fromEntries(rows.map((r) => [r.period, r]));
    const d = by["d:" + dayOf(now)] || { spent: 0, reserved: 0, calls: 0, refused: 0 }, m = by["m:" + month] || { spent: 0, reserved: 0, calls: 0, refused: 0 };
    const features = Object.fromEntries(rows.filter((r) => r.period.startsWith("f:")).map((r) => [r.period.split(":").pop(), { spentUsd: usd(r.spent), calls: r.calls }]));
    return { configured: true, month, today: { spentUsd: usd(d.spent + d.reserved), capUsd: limits.dailyUsd, calls: d.calls, refused: d.refused },
      thisMonth: { spentUsd: usd(m.spent + m.reserved), capUsd: limits.monthlyUsd, calls: m.calls, refused: m.refused }, features };
  } catch (e) { return { configured: true, error: "budget-store-error" }; }
}

/** fixed-window rate limit: true when allowed. Keys are hashed by the caller (no raw IPs stored). */
export async function allow(env, key, limit, windowMs = 3600 * 1000, now = Date.now()) {
  const db = dbOf(env); if (!db) return false;
  const win = Math.floor(now / windowMs);
  try {
    await ensure(db);
    const r = await db.prepare(`INSERT INTO en_rate (k, win, n) VALUES (?1, ?2, 1)
      ON CONFLICT (k) DO UPDATE SET n = CASE WHEN en_rate.win = ?2 THEN en_rate.n + 1 ELSE 1 END, win = ?2 RETURNING n`).bind(key, win).first();
    return !!r && r.n <= limit;
  } catch (e) { return false; }
}
