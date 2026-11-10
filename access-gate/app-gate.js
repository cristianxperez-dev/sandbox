/* Sandbox — per-application access codes (Cloudflare Pages Functions).

   One gate in front of every request (functions/_middleware.js). A request whose path — after full
   percent-decoding, backslash and dot-segment normalisation and lower-casing — falls inside a protected
   app is handled here; everything else goes straight to next() untouched.

   Inside a protected app:
     <base>access/          login page              POST <base>access/login   check the code
     <base>access/logout    sign out                <base>logo.png etc.       public files listed per app
     anything else          needs a valid session cookie, else 303 to the login page (pages) or 401 (files)
   Paths that aren't already in canonical form are refused (400), so no encoded or oddly-cased variant of a
   protected URL is ever served.

   Session: cookie "<v1>.<expiry>.<HMAC>" for 15 days, fixed expiry, never renewed. The HMAC key is derived
   from SANDBOX_SESSION_SECRET + the app id + the app's access code, so a cookie works for one app only and
   rotating either secret signs everyone out. Cookie: HttpOnly; Secure; SameSite=Lax; Path=<base>.
   Login: same-origin POST only, constant-time comparison (trimmed, case-insensitive), 0.7 s delay on every
   failure, 5 failures in 10 minutes from one IP → 15-minute lockout (per edge isolate; pair it with a
   Cloudflare WAF rate-limiting rule). Missing secrets → 503 for the protected app only (fails closed). */
import { deploymentOf } from "../manager-hub/server/ai-config.js";

const SESSION_SECONDS = 15 * 24 * 60 * 60;
const MAX_FAILURES = 5, FAILURE_WINDOW_MS = 10 * 60 * 1000, LOCKOUT_MS = 15 * 60 * 1000, FAILURE_DELAY_MS = 700;
const enc = new TextEncoder();
const attempts = new Map();                  // `${app}|${ip}` → { first, failures, lockedUntil }

/* ---------------- paths ---------------- */
/** fully decoded, normalised, lower-cased path (what a lenient file server might resolve the request to) */
export function canonicalPath(raw) {
  let p = String(raw || "/");
  for (let i = 0; i < 4; i++) {                // %252e → %2e → .
    let d; try { d = decodeURIComponent(p); } catch (e) { d = p.replace(/%(?![0-9a-f]{2})/gi, "%25"); try { d = decodeURIComponent(d); } catch (e2) { break; } }
    if (d === p) break; p = d;
  }
  p = p.replace(/\\/g, "/").replace(/[\u0000-\u001f\u007f]/g, "");
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return ("/" + out.join("/") + (p.endsWith("/") && out.length ? "/" : "")).toLowerCase();
}
const appFor = (apps, canon) => apps.find((a) => canon === a.base.slice(0, -1) || canon.startsWith(a.base));

/* ---------------- tokens ---------------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmacKey(raw) { return crypto.subtle.importKey("raw", typeof raw === "string" ? enc.encode(raw) : raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); }
async function sign(key, data) { return crypto.subtle.sign("HMAC", key, enc.encode(data)); }
/** per-app signing key: bound to the session secret, the app and its access code */
async function appKey(secret, app, code) {
  const root = await hmacKey(secret);
  return hmacKey(await sign(root, `sandbox-access:v1:${app}:${String(code).trim().toLowerCase()}`));
}
function same(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}
export async function issueToken(secret, app, code, nowSec) {
  const exp = nowSec + SESSION_SECONDS, key = await appKey(secret, app, code);
  return { token: `v1.${exp}.${b64url(await sign(key, `${app}|v1.${exp}`))}`, exp };
}
export async function verifyToken(secret, app, code, token, nowSec) {
  const m = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""));
  if (!m) return null;
  const exp = +m[1];
  if (exp <= nowSec || exp > nowSec + SESSION_SECONDS + 60) return null;   // expired, or not one we could have issued
  const key = await appKey(secret, app, code);
  const want = enc.encode(b64url(await sign(key, `${app}|v1.${exp}`))), got = enc.encode(m[2]);
  return same(want, got) ? exp : null;
}
async function codeMatches(secret, expected, input) {
  // compare HMACs of both, so the comparison takes the same time whatever the input
  const k = await hmacKey(secret);
  const a = await sign(k, "code:" + String(expected).trim().toLowerCase()), b = await sign(k, "code:" + String(input || "").trim().toLowerCase());
  return same(a, b);
}

/* ---------------- responses ---------------- */
const cookieName = (app) => "sbx_" + app.id.replace(/[^a-z0-9]/gi, "_");
function readCookie(req, name) {
  const h = req.headers.get("Cookie") || "";
  for (const part of h.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return undefined;
}
const PRIVATE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", Vary: "Cookie", "Referrer-Policy": "same-origin" };
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", ...PRIVATE, ...extra } });
const redirect = (to, extra = {}) => new Response(null, { status: 303, headers: { Location: to, ...PRIVATE, ...extra } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function safeNext(app, v) {
  const s = String(v || "");
  return s.startsWith(app.base) && canonicalPath(s.split(/[?#]/)[0]) === s.split(/[?#]/)[0] && !/[\\]|\/\//.test(s) ? s : app.base;
}
function accessPage(app, { next, error, status = 200 }) {
  const msg = error === "wrong" ? "That code isn't right. Try again." : error === "locked" ? "Too many attempts. Try again in 15 minutes." : error === "config" ? "Access isn't configured yet." : error === "expired" ? "Your session ended. Enter the code again." : "";
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(app.name)} — Access</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap">
<style>:root{--cream:#FCF9F3;--charcoal:#2A2826;--graphite:#595552;--line:#E4DDD0}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--cream);color:var(--charcoal);font:15px/1.5 Inter,system-ui,sans-serif;padding:24px 16px}
main{width:100%;max-width:380px;text-align:center}.k{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--graphite)}
h1{font:600 34px/1.1 'Cormorant Garamond',Georgia,serif;margin:8px 0 6px}p{margin:0 0 22px;color:var(--graphite)}
img{width:64px;height:64px;object-fit:contain;margin-bottom:14px}
form{display:flex;flex-direction:column;gap:10px}input{height:46px;border:1px solid var(--line);border-radius:3px;padding:0 14px;font:inherit;background:#fff;text-align:center;letter-spacing:.06em}
input:focus{outline:2px solid var(--charcoal);outline-offset:1px}button{height:46px;border:0;border-radius:3px;background:var(--charcoal);color:var(--cream);font:600 14px Inter,sans-serif;letter-spacing:.04em;cursor:pointer}
.err{color:#8C2A22;font-size:13.5px;margin:0 0 4px}.back{display:inline-block;margin-top:22px;color:var(--graphite);font-size:13px;text-decoration:none}.back:hover{color:var(--charcoal)}</style></head>
<body><main><img src="${esc(app.base)}logo.png" alt=""><div class="k">CP Sandbox</div><h1>${esc(app.name)}</h1><p>Enter the access code to continue.</p>
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}
${error === "config" ? "" : `<form method="post" action="${esc(app.base)}access/login"><input type="password" name="code" autocomplete="current-password" aria-label="Access code" placeholder="Access code" required autofocus>
<input type="hidden" name="next" value="${esc(next || app.base)}"><button type="submit">Enter</button></form>`}
<a class="back" href="/">← Back to Sandbox</a></main></body></html>`, status);
}

/* ---------------- rate limiting (per isolate) ---------------- */
const lockedFor = (id, now) => { const a = attempts.get(id); if (!a) return 0; if (a.lockedUntil > now) return a.lockedUntil - now; if (now - a.first > FAILURE_WINDOW_MS) attempts.delete(id); return 0; };
function recordFailure(id, now) {
  let a = attempts.get(id);
  if (!a || now - a.first > FAILURE_WINDOW_MS) { a = { first: now, failures: 0, lockedUntil: 0 }; attempts.set(id, a); }
  if (++a.failures >= MAX_FAILURES) a.lockedUntil = now + LOCKOUT_MS;
  if (attempts.size > 5000) attempts.clear();
}

/* ---------------- the gate ---------------- */
export function createGate(apps, opts = {}) {
  const now = opts.now || (() => Date.now());
  const delay = opts.failureDelayMs ?? FAILURE_DELAY_MS;
  return async function onRequest(ctx) {
    const { request, env, next } = ctx;
    const url = new URL(request.url), raw = url.pathname, canon = canonicalPath(raw);
    const app = appFor(apps, canon);
    if (!app) return next();                                  // every other Sandbox app: untouched

    // encoded, upper-case, doubled-slash, dot-segment or backslash variants are never served
    if (raw !== canon) return new Response("Bad request", { status: 400, headers: PRIVATE });
    if (raw === app.base.slice(0, -1)) return Response.redirect(url.origin + app.base + url.search, 308);
    if ((app.publicFiles || []).includes(raw)) return next();

    const secret = env.SANDBOX_SESSION_SECRET, code = env[app.codeSecret];
    const configured = typeof secret === "string" && secret.length >= 32 && typeof code === "string" && code.trim().length > 0;
    const accessPath = app.base + "access/", loginPath = accessPath + "login", logoutPath = accessPath + "logout";
    const name = cookieName(app), nowMs = now(), nowSec = Math.floor(nowMs / 1000);
    const clear = `${name}=; Path=${app.base}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

    if (raw === logoutPath) return redirect(accessPath, { "Set-Cookie": clear });
    // configuration check: which settings are present in this deployment (booleans only, never values)
    if (raw === accessPath + "status" && request.method === "GET") {
      const body = Object.assign({ app: app.id, host: url.hostname, deployment: deploymentOf(url.hostname), gate: { accessCodePresent: typeof code === "string" && code.trim().length > 0, sessionSecretPresent: typeof secret === "string" && secret.length >= 32 } }, app.status ? app.status(env, url.hostname) : {});
      return new Response(JSON.stringify(body, null, 2), { status: 200, headers: { ...PRIVATE, "Content-Type": "application/json" } });
    }
    if (!configured) return accessPage(app, { error: "config", status: 503 });

    if (raw === loginPath) {
      if (request.method !== "POST") return redirect(accessPath);
      const origin = request.headers.get("Origin"), site = request.headers.get("Sec-Fetch-Site");
      if ((origin && origin !== url.origin) || (site && site !== "same-origin")) return new Response("Forbidden", { status: 403, headers: PRIVATE });
      const ip = request.headers.get("CF-Connecting-IP") || "unknown", id = `${app.id}|${ip}`;
      let form; try { form = await request.formData(); } catch (e) { form = new FormData(); }
      const nextTo = safeNext(app, form.get("next"));
      if (lockedFor(id, nowMs)) return accessPage(app, { next: nextTo, error: "locked", status: 429 });
      if (!(await codeMatches(secret, code, form.get("code")))) {
        recordFailure(id, nowMs);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        return accessPage(app, { next: nextTo, error: lockedFor(id, nowMs) ? "locked" : "wrong", status: lockedFor(id, nowMs) ? 429 : 401 });
      }
      attempts.delete(id);
      const { token, exp } = await issueToken(secret, app.id, code, nowSec);
      return redirect(nextTo, { "Set-Cookie": `${name}=${token}; Path=${app.base}; Max-Age=${exp - nowSec}; Expires=${new Date(exp * 1000).toUTCString()}; HttpOnly; Secure; SameSite=Lax` });
    }

    const tok = readCookie(request, name);
    let ok = tok && (await verifyToken(secret, app.id, code, tok, nowSec));
    // Preview and local deployments only (never production hosts): the access code in an
    // X-MH-Access-Key header also admits a request — for automated testing through an egress proxy
    // that injects it. Same constant-time check and lockout as the login form.
    const headerKey = request.headers.get("X-MH-Access-Key");
    if (!ok && headerKey && deploymentOf(url.hostname) !== "production") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown", id = `${app.id}|${ip}`;
      if (lockedFor(id, nowMs)) return new Response("Too many attempts", { status: 429, headers: PRIVATE });
      if (await codeMatches(secret, code, headerKey)) ok = true;
      else { recordFailure(id, nowMs); return new Response("Access code required", { status: 401, headers: PRIVATE }); }
    }
    if (raw === accessPath) return ok ? redirect(app.base) : accessPage(app, { next: safeNext(app, url.searchParams.get("next")), error: tok ? "expired" : "" });
    if (!ok) {
      const page = request.method === "GET" && (raw.endsWith("/") || raw.endsWith(".html") || (request.headers.get("Accept") || "").includes("text/html"));
      const extra = tok ? { "Set-Cookie": clear } : {};
      return page ? redirect(accessPath + "?next=" + encodeURIComponent(raw + url.search), extra) : new Response("Access code required", { status: 401, headers: { ...PRIVATE, ...extra } });
    }

    // signed in: serve the file, never cache it publicly, and add a sign-out link to the app's pages
    const res = await next();
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(PRIVATE)) out.headers.set(k, v);
    if ((out.headers.get("Content-Type") || "").includes("text/html") && typeof HTMLRewriter !== "undefined") {
      return new HTMLRewriter().on("body", { element(el) {
        el.append(`<a href="${logoutPath}" class="sbx-signout" style="position:fixed;left:68px;bottom:24px;z-index:2147483000;font:500 12px/1 Inter,system-ui,sans-serif;color:#595552;background:rgba(252,249,243,.94);border:1px solid #E4DDD0;border-radius:999px;padding:6px 11px;text-decoration:none">Sign out</a>`, { html: true });
      } }).transform(out);
    }
    return out;
  };
}
