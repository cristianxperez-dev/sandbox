/* CP English — AI configuration (speech transcription + response evaluation). Values are never returned
   or logged: only whether each setting is present.

   AI runs only when ALL of these hold (same rules as Manager Hub, separate switches):
     OPENAI_API_KEY      Cloudflare secret (the Sandbox project's existing key), present
     EN_AI_ENABLED       "1"
     EN_AI_PRODUCTION    "approved" on production hosts (cperez.app, the main pages.dev address, unknown hosts):
                         the owner's explicit go-ahead. Preview deployments only need EN_AI_ENABLED.
     a D1 binding for the spending limits: EN_AI_USAGE, or the existing MH_AI_USAGE (separate table)
   Without any one of them the app still works; speaking tasks say feedback is unavailable and never
   show a score. */
import { deploymentOf } from "../../manager-hub/server/ai-config.js";

export const DEFAULTS = {
  sttModel: "gpt-4o-mini-transcribe",   // configurable: EN_STT_MODEL (verify the current model list before enabling)
  evalModel: "gpt-6-luna",              // the Sandbox's least expensive text model (Manager Hub, Nov 10 2026); EN_EVAL_MODEL
  dailyUsd: 1,                          // EN_AI_DAILY_USD   (can lower or raise up to HARD_MAX_DAILY_USD)
  monthlyUsd: 10,                       // EN_AI_MONTHLY_USD (up to HARD_MAX_MONTHLY_USD)
  maxSeconds: 45,                       // longest recording accepted
  maxBytes: 2 * 1024 * 1024,            // largest upload accepted
  perDeviceHour: 40,                    // speech/eval requests per learner device per hour
  perIpHour: 120,                       // per IP per hour (a whole academy may share one IP)
};
export const HARD_MAX_DAILY_USD = 5, HARD_MAX_MONTHLY_USD = 40;

export const dbOf = (env) => {
  const d = env && (env.EN_AI_USAGE || env.MH_AI_USAGE);
  return d && typeof d.prepare === "function" ? d : null;
};
const num = (v, def, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };

export function settings(env) {
  return {
    sttModel: String(env.EN_STT_MODEL || DEFAULTS.sttModel),
    evalModel: String(env.EN_EVAL_MODEL || DEFAULTS.evalModel),
    dailyUsd: num(env.EN_AI_DAILY_USD, DEFAULTS.dailyUsd, HARD_MAX_DAILY_USD),
    monthlyUsd: num(env.EN_AI_MONTHLY_USD, DEFAULTS.monthlyUsd, HARD_MAX_MONTHLY_USD),
    maxSeconds: DEFAULTS.maxSeconds, maxBytes: DEFAULTS.maxBytes,
    perDeviceHour: num(env.EN_AI_PER_DEVICE_HOUR, DEFAULTS.perDeviceHour, 200),
    perIpHour: num(env.EN_AI_PER_IP_HOUR, DEFAULTS.perIpHour, 1000),
  };
}

export function aiState(env, host) {
  const deployment = deploymentOf(host);
  const keyPresent = typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length >= 20;
  const enabledFlag = env.EN_AI_ENABLED === "1";
  const productionApproved = env.EN_AI_PRODUCTION === "approved";
  const budgetConfigured = !!dbOf(env);
  const active = keyPresent && enabledFlag && (deployment !== "production" || productionApproved) && budgetConfigured;
  const reason = active ? "on" : !keyPresent ? "no-key" : !enabledFlag ? "disabled" : (deployment === "production" && !productionApproved) ? "production-not-approved" : "no-budget-store";
  return { deployment, keyPresent, enabledFlag, productionApproved, budgetConfigured, active, reason };
}
