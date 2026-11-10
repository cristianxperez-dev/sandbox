/* Sandbox applications behind their own access code.
   Protecting another app later = one entry here + its secret in Cloudflare (see access-gate/README.md).
   This list is shared by the Cloudflare gate (functions/_middleware.js) and by the GitHub Pages build,
   which leaves these apps out of the public mirror (scripts/strip-protected.mjs). */
import { aiState } from "../manager-hub/server/ai-config.js";

export const PROTECTED_APPS = [
  {
    id: "manager-hub",
    name: "Astros Manager Hub",
    base: "/apps/manager-hub/",
    codeSecret: "MANAGER_HUB_ACCESS_CODE",
    // the Sandbox homepage card shows this image; it stays public
    publicFiles: ["/apps/manager-hub/logo.png"],
    // GET /apps/manager-hub/access/status — presence of settings only, never values
    status: (env, host) => {
      const a = aiState(env, host);
      return { ai: { active: a.active, reason: a.reason, openaiKeyPresent: a.keyPresent, enabledFlag: a.enabledFlag, productionApproved: a.productionApproved, budgetConfigured: a.budgetConfigured, model: a.model } };
    },
  },
];
