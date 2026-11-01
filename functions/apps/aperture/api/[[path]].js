/* APERTURE API — secure server mode (Cloudflare Pages Function + D1). Not used by the public beta.
   The public beta (apps/aperture/config.js → mode "local") runs the same handlers in the browser and
   never calls this endpoint. This Function stays deployed for future activation and fails closed:
   until the D1 binding and the Access variables are configured, every request returns 503.

   Security model (when activated)
   - Cloudflare Access token verified on every request (signature, issuer, audience, expiry, allowlist).
   - Same-origin JSON only: X-Aperture header required, Origin must match.
   - Answer keys, hidden exercise material and case teaching notes are released only by the
     handlers after submission; grades and the review schedule are computed server-side.
   - Records are validated per kind; SQL is parameterized and filtered by the signed-in email.
   Configuration: aperture/README.md → "Secure accounts (future activation)". */

import { readConfig, authenticate, throttle } from '../../../../aperture/server/auth.js';
import * as store from '../../../../aperture/server/store.js';
import '../../../../aperture/server/content.js';
import { handle } from '../../../../apps/aperture/shared/handlers.js';

const MAX_BODY = 512 * 1024;
const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow' };

export async function onRequest({ request, env }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/api\/?/, '').replace(/\/+$/, '');
    const method = request.method;

    const config = readConfig(env);
    if (!config) return json(503, { error: 'not_configured', message: 'APERTURE’s secure accounts are not activated. The public beta stores progress in the browser.' });

    if (path === 'login' && method === 'GET') {
      const user = await authenticate(request, config);
      if (!user) return html(401, 'You are not signed in to APERTURE, or this address is not allowed to use it.');
      return new Response(null, { status: 302, headers: { Location: new URL('../', url).pathname + '#/', ...SECURITY_HEADERS } });
    }

    if (request.headers.get('X-Aperture') !== '1') return json(400, { error: 'bad_request' });
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json(403, { error: 'forbidden' });

    const user = await authenticate(request, config);
    if (!user) return json(401, { error: 'unauthorized', message: 'Sign in to APERTURE to continue.' });

    const wait = throttle(user.email, 'all', 900, 5 * 60 * 1000) || (method !== 'GET' ? throttle(user.email, 'write', 300, 5 * 60 * 1000) : 0)
      || (/submit|self|grade|reveal/.test(path) ? throttle(user.email, 'submit', 120, 10 * 60 * 1000) : 0);
    if (wait) return json(429, { error: 'rate_limited', message: 'Too many requests. Try again shortly.' }, { 'Retry-After': String(wait) });

    let body = null;
    if (method !== 'GET') {
      body = await readBody(request);
      if (!body) return json(400, { error: 'bad_request', message: 'The request was not valid JSON.' });
    }
    if (path === 'import') return json(404, { error: 'not_found' }); // browser-only (public beta)
    const [status, data, extra] = await handle({ method, path, params: url.searchParams, body }, { store, db: env.APERTURE_DB, owner: user.email, mode: 'server' });
    return json(status, status === 200 && path === 'session' ? { ...data, expires: user.exp } : data, extra);
  } catch (err) {
    console.error('aperture api', (err && err.message) || err);
    return json(500, { error: 'server_error', message: 'Something went wrong on the server. Nothing you saved was lost.' });
  }
}

function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}
function html(status, message) {
  const safe = message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>APERTURE</title><p style="font:16px Georgia,serif;color:#252525;background:#F2EBDD;max-width:32em;margin:40px auto;padding:0 20px">${safe} <a href="../">Back to APERTURE</a></p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return null;
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
