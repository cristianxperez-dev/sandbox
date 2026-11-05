/* FUEL API — secure mode (Cloudflare Pages Function + D1 + Cloudflare Access). Not used by the sandbox demo.
   The demo (apps/fuel/config.js → mode "demo") runs the same handlers in the browser on synthetic players and never
   calls this endpoint. This Function is deployed so the secure mode can be switched on later, and it FAILS CLOSED:
   until the D1 binding, the Access variables and FUEL_USERS are configured, every request returns 503.

   On every request (when configured):
   - the Cloudflare Access token is verified here (signature, issuer, audience, expiry) — Access in front of the
     path is never trusted on its own, so *.pages.dev, previews and other hostnames are refused without a token;
   - the email must be on FUEL_USERS, which also sets the person's role (never the browser);
   - same-origin JSON only (X-Fuel header, Origin check), size-limited bodies, a per-person rate limit;
   - the shared handlers enforce the role and redact what the role may not see, and audit every write and export;
   - responses are never cached. Setup: fuel/README.md → "Switching on secure mode". */

import { readConfig, authenticate, throttle } from "../../../../fuel/server/auth.js";
import { D1Store } from "../../../../fuel/server/d1store.js";
import { handle, HttpError } from "../../../../apps/fuel/shared/handlers.js";

const MAX_BODY = 6 * 1024 * 1024;
const H = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow" };

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/api\/?/, "").replace(/\/+$/, "");
    const config = readConfig(env);
    if (!config) return json(503, { error: "not_configured", message: "FUEL's secure mode isn't switched on. The sandbox demo runs in the browser with synthetic players only." });
    if (request.headers.get("X-Fuel") !== "1") return json(400, { error: "bad_request" });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json(403, { error: "forbidden" });
    const user = await authenticate(request, config);
    if (!user) return json(401, { error: "unauthorized", message: "Sign in to FUEL to continue." });
    const wait = throttle(user.email, "all", 1200, 5 * 60 * 1000) || (request.method !== "GET" ? throttle(user.email, "write", 400, 5 * 60 * 1000) : 0);
    if (wait) return json(429, { error: "rate_limited", message: "Too many requests — try again shortly." }, { "Retry-After": String(wait) });
    let body = null;
    if (request.method === "POST") {
      body = await readBody(request);
      if (!body) return json(400, { error: "bad_request", message: "The request wasn't valid JSON." });
    } else if (request.method !== "GET") return json(405, { error: "method_not_allowed" });
    const store = new D1Store(env.FUEL_DB);
    await store.syncStaff(config.users);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("today") || "") ? url.searchParams.get("today") : new Date().toISOString().slice(0, 10);
    const data = await handle({ method: request.method, path, params: url.searchParams, body }, { store, user, today, now: new Date().toISOString(), mode: "secure" });
    return json(200, data);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
    console.error("fuel api", (err && err.message) || err);
    return json(500, { error: "server_error", message: "Something went wrong on the server. Nothing was saved." });
  }
}
function json(status, data, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...H, ...extra } }); }
async function readBody(request) {
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return null;
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
