/* ==========================================================================
   Manager Hub — Schedule Assistant interpretation proxy (Cloudflare Worker)

   NOT DEPLOYED. A reference implementation for the optional AI interpreter.
   The page never holds a key: it POSTs {mode, text, context} here, this
   Worker adds the key from a Worker secret, asks the model for JSON in the
   app's interpretation contract, and returns {interpretation, model}.
   The page validates the reply again and runs it through the same
   deterministic planner and edit operations as the built-in reader, and the
   coach reviews every change before anything is saved.

   Secrets / vars (Cloudflare dashboard → Worker → Settings → Variables):
     ANTHROPIC_API_KEY  (secret, required)
     ALLOWED_ORIGIN     (var, e.g. https://cperez.app — required; requests from other origins are refused)
     MODEL              (var, optional; default claude-opus-5-5)
     PROVIDER           (var, optional; "anthropic" — add another adapter below to switch providers)
   ========================================================================== */

// Keep identical to MHAssist.INTERPRETATION_SCHEMA in apps/manager-hub/assistant/commands.js
// (manager-hub/tests/proxy.test.mjs fails if they drift).
export const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["intent", "brief", "edits", "monthRules", "clarifications", "assumptions"],
  properties: {
    intent: { type: "string", enum: ["build", "edit", "month", "clarify"] },
    brief: { type: "string", description: "For intent=build: the day restated as plain sentences the deterministic planner reads (groups, what each needs with minutes, fixed times, first pitch, deadlines, rotations, ordering). Empty otherwise." },
    edits: {
      type: "array", description: "For intent=edit: one entry per change, in order.",
      items: {
        type: "object", additionalProperties: false,
        required: ["op", "target", "value", "group"],
        properties: {
          op: { type: "string", enum: ["shift", "setStart", "setDur", "extend", "setLoc", "setStaff", "remove", "add", "swapGroups", "swapTimes", "indoor", "rename"] },
          target: { type: "string", description: "The block(s) affected, in the coach's words, e.g. \"Blue's hitting\", \"everything after lunch\", \"the 10:00 block\". For swapGroups/swapTimes: \"A | B\"." },
          value: { type: "string", description: "shift/extend: signed minutes (\"15\", \"-10\"). setStart: clock time \"10:30\". setDur: minutes. setLoc: place. setStaff: coach. rename: new activity. add: \"activity @ time (minutes) on place\". Empty for remove/indoor/swaps." },
          group: { type: "string", description: "For add: the group; otherwise empty." }
        }
      }
    },
    monthRules: { type: "array", items: { type: "string" }, description: "For intent=month: each rule as a short sentence, e.g. \"bunt defense every Tuesday\", \"team defense 3 times a week\", \"avoid heavy defense before morning games\"." },
    clarifications: { type: "array", items: { type: "string" }, description: "Targeted questions when something essential is missing or ambiguous." },
    assumptions: { type: "array", items: { type: "string" } }
  }
};

export const SYSTEM = `You interpret a professional baseball coach's scheduling request for a minor-league affiliate's daily schedule tool.
You do not schedule anything yourself. You translate the request into the JSON contract; the app's own engine assigns times, checks fields, cages, mounds and coaches, and shows the coach every change for approval.

Rules:
- mode "build": restate the day as short plain sentences in "brief" — report time, number of position-player and pitcher groups, what each needs (with minutes when given), fixed times ("7:45 Team Meeting"), first pitch, "off the field by", rotations ("4 groups rotate through cages, defense, baserunning and bunt defense, 20 minutes each, starting at 9:00"), and ordering ("Bullpens should finish before BP begins"). Use the group, activity and location names from the context when they match. Never add work the coach didn't ask for.
- mode "edit": one entry in "edits" per change, in the order given. "back"/"later" means later; "up"/"earlier" means earlier; if a direction or target is genuinely ambiguous, ask in "clarifications" instead of guessing.
- mode "month": one short sentence per rule in "monthRules", using activity names from the context's library.
- Use baseball's day: 6–11 are morning, 12–5 afternoon, unless the coach says otherwise.
- Never invent players, staff, opponents or facilities. Put anything you assumed in "assumptions".
- intent "clarify" with questions only when the request cannot be acted on at all.`;

const MAX_TEXT = 4000, MAX_BODY = 60000;
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": origin || "null", "vary": "Origin", "cache-control": "no-store" } });

/* ------------------------------------------------------------ providers */
const PROVIDERS = {
  async anthropic(env, user) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01"
      },
      body: JSON.stringify({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        // parsing a request into a fixed contract: low effort keeps it fast and inexpensive
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        // if a safety classifier declines, the API retries on a fallback model in the same call
        fallbacks: "default"
      })
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body) return { error: `model service answered ${r.status}`, status: 502 };
    if (body.stop_reason === "refusal") return { error: "the model declined this request", status: 422 };
    if (body.stop_reason === "max_tokens") return { error: "the reply was cut off", status: 502 };
    const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let interpretation;
    try { interpretation = JSON.parse(text); } catch (e) { return { error: "the reply was not valid JSON", status: 502 }; }
    return { interpretation, model: body.model };
  }
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const allowed = env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN ? origin : null;
    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? { "access-control-allow-origin": allowed, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } : {} });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, allowed);
    if (!allowed) return json({ error: "origin not allowed" }, 403, null);
    const provider = PROVIDERS[env.PROVIDER || "anthropic"];
    if (!provider) return json({ error: "unknown provider" }, 500, allowed);
    if (!env.ANTHROPIC_API_KEY && (env.PROVIDER || "anthropic") === "anthropic") return json({ error: "AI interpreter not configured" }, 503, allowed);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "request too large" }, 413, allowed);
    let req; try { req = JSON.parse(raw); } catch (e) { return json({ error: "invalid JSON" }, 400, allowed); }
    if (!["build", "edit", "month"].includes(req.mode) || typeof req.text !== "string" || !req.text.trim()) return json({ error: "mode and text required" }, 400, allowed);
    if (req.text.length > MAX_TEXT) return json({ error: "text too long" }, 413, allowed);
    const user = JSON.stringify({ mode: req.mode, request: req.text, context: req.context || {} });
    const out = await provider(env, user);
    if (out.error) return json({ error: out.error }, out.status || 502, allowed);
    return json({ interpretation: out.interpretation, model: out.model }, 200, allowed);
  }
};
