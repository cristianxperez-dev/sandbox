/* APERTURE — authentication.
   Same model as Recollect (README → Recollect): Cloudflare Access signs the owner in, and this code
   verifies the Access token itself on every request (RS256 signature against the team's published
   keys, issuer, audience, expiry, not-before) and checks the email against an allowlist. Access in
   front of the path is never trusted on its own, so a direct request to *.pages.dev, a preview
   deployment or any other hostname is refused without a valid token.

   Configuration (Cloudflare dashboard → the Sandbox Pages project → Settings → Variables / Bindings):
     APERTURE_DB              D1 binding
     APERTURE_ACCESS_ISSUER   https://<team>.cloudflareaccess.com
     APERTURE_ACCESS_AUD      the Access application's Audience (AUD) tag
     APERTURE_ALLOWED_EMAILS  comma-separated addresses allowed to use APERTURE
   Missing or malformed configuration → readConfig returns null → every request is refused (503). */

export function readConfig(env) {
  const issuer = String(env.APERTURE_ACCESS_ISSUER || '').trim().replace(/\/+$/, '');
  const aud = String(env.APERTURE_ACCESS_AUD || '').trim();
  const emails = String(env.APERTURE_ALLOWED_EMAILS || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!env.APERTURE_DB || !issuer || !aud || !emails.length) return null;
  let u;
  try { u = new URL(issuer); } catch { return null; }
  // Signing keys must come over HTTPS (plain HTTP only for a local test issuer).
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  return { issuer, aud, emails: new Set(emails) };
}

let jwksCache = { issuer: '', at: 0, keys: [] };
async function signingKeys(issuer, force) {
  if (!force && jwksCache.issuer === issuer && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Access certificates returned ${res.status}`);
  const data = await res.json();
  jwksCache = { issuer, at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJSON(s) { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); }

export function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

// Returns { email, exp } for a signed-in, allowed person, or null.
export async function authenticate(request, config) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJSON(parts[0]); payload = b64urlJSON(parts[1]); } catch { return null; }
  if (!header || header.alg !== 'RS256' || !header.kid) return null;
  let keys = await signingKeys(config.issuer, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await signingKeys(config.issuer, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk || jwk.kty !== 'RSA') return null;
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
  if (payload.iss !== config.issuer) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.aud)) return null;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !config.emails.has(email)) return null;
  return { email, exp: payload.exp };
}

/* Per-isolate request throttle (a second line behind Cloudflare Access, which handles sign-in).
   Limits are generous for one learner and stop a runaway script or a stolen-cookie replay loop. */
const buckets = new Map();
export function throttle(id, kind, limit, windowMs) {
  const k = `${kind}:${id}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(k, b); }
  b.count++;
  if (buckets.size > 5000) for (const [key, v] of buckets) if (now - v.start > windowMs) buckets.delete(key);
  return b.count <= limit ? 0 : Math.ceil((b.start + windowMs - now) / 1000);
}
