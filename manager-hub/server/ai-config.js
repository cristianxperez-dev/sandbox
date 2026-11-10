/* Manager Hub — AI interpreter configuration, shared by the access gate's status route and the
   interpreter function. Values are never returned or logged: only whether each setting is present.

   AI runs only when ALL of these hold:
     OPENAI_API_KEY   Cloudflare secret, present
     MH_AI_ENABLED    "1"
     and, on Production hosts (cperez.app, the project's main pages.dev address, or any host not
     recognised as a preview), MH_AI_PRODUCTION = "approved" — the owner's explicit go-ahead;
     MH_AI_USAGE      a D1 database binding: the server-side monthly spending limit (ai-budget.js).
                      Without it the spend can't be tracked, so AI stays off (fails safe).
   So MH_AI_ENABLED=1 set in Production by mistake cannot switch AI on for cperez.app. */
export const DEFAULT_MODEL = "gpt-6-luna";       // the least expensive model (owner's decision, Nov 10 2026)
export const FALLBACK_MODEL = null;              // none: never switch to another (more expensive) model on its own
export const PRODUCTION_HOSTS = ["cperez.app", "www.cperez.app", "sandbox-34x.pages.dev"];

export function deploymentOf(host) {
  const h = String(host || "").toLowerCase().replace(/:\d+$/, "");
  if (PRODUCTION_HOSTS.includes(h)) return "production";
  if (h === "127.0.0.1" || h === "localhost") return "local";
  if (/^[a-z0-9-]+\.sandbox-34x\.pages\.dev$/.test(h)) return "preview";
  return "production";                       // unknown host: treat as production (fails safe)
}

export function aiState(env, host) {
  const deployment = deploymentOf(host);
  const keyPresent = typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length >= 20;
  const enabledFlag = env.MH_AI_ENABLED === "1";
  const productionApproved = env.MH_AI_PRODUCTION === "approved";
  const budgetConfigured = !!(env.MH_AI_USAGE && typeof env.MH_AI_USAGE.prepare === "function");
  const active = keyPresent && enabledFlag && (deployment !== "production" || productionApproved) && budgetConfigured;
  const reason = active ? "on" : !keyPresent ? "no-key" : !enabledFlag ? "disabled" : (deployment === "production" && !productionApproved) ? "production-not-approved" : "no-budget-store";
  return { deployment, keyPresent, enabledFlag, productionApproved, budgetConfigured, active, reason, model: env.MH_AI_MODEL || DEFAULT_MODEL, fallbackModel: env.MH_AI_FALLBACK_MODEL || FALLBACK_MODEL };
}
