/* FUEL — authentication and roles for secure mode (Cloudflare Pages Function).
   Same model as Recollect and APERTURE: Cloudflare Access signs people in, and this code verifies the Access token
   itself on every request (RS256 signature against the team's published keys, issuer, audience, expiry, not-before).
   The person's ROLE comes only from the server-side FUEL_USERS setting — never from the browser.

   Configuration (Cloudflare dashboard → the Sandbox Pages project → Settings):
     FUEL_DB              D1 database binding
     FUEL_ACCESS_ISSUER   https://<team>.cloudflareaccess.com
     FUEL_ACCESS_AUD      the Access application's Audience (AUD) tag
     FUEL_USERS           JSON: [{"email":"rd@club.com","role":"dietitian","name":"Dana Whitfield","initials":"DW"}, …]
                          roles: admin | dietitian | performance | readonly
   Anything missing or malformed → readConfig returns null → every request is refused (503). */

import { ROLES } from "../../apps/fuel/shared/model.js";
import { fingerprint } from "../../apps/fuel/shared/util.js";

export function readConfig(env) {
  const issuer = String(env.FUEL_ACCESS_ISSUER || "").trim().replace(/\/+$/, "");
  const aud = String(env.FUEL_ACCESS_AUD || "").trim();
  if (!env.FUEL_DB || !issuer || !aud) return null;
  let users;
  try { users = JSON.parse(String(env.FUEL_USERS || "")); } catch { return null; }
  if (!Array.isArray(users) || !users.length) return null;
  const map = new Map();
  for (const u of users) {
    const email = String((u && u.email) || "").trim().toLowerCase();
    if (!email || !ROLES[u.role]) return null;          // one bad entry disables everything rather than guessing
    map.set(email, { email, role: u.role, name: String(u.name || email).slice(0, 80), initials: String(u.initials || "").toUpperCase().slice(0, 4) || null, staff_id: "st_" + fingerprint(email) });
  }
  let url;
  try { url = new URL(issuer); } catch { return null; }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return { issuer, aud, users: map };
}

let jwksCache = { issuer: "", at: 0, keys: [] };
async function signingKeys(issuer, force) {
  if (!force && jwksCache.issuer === issuer && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Access certificates returned ${res.status}`);
  const data = await res.json();
  jwksCache = { issuer, at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}
export function _resetKeyCache() { jwksCache = { issuer: "", at: 0, keys: [] }; }

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJSON = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
export function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return "";
}

/** { email, role, name, initials, staff_id, exp } for a signed-in person on the FUEL_USERS list, else null */
export async function authenticate(request, config) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
  if (!token || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJSON(parts[0]); payload = b64urlJSON(parts[1]); } catch { return null; }
  if (!header || header.alg !== "RS256" || !header.kid) return null;
  let keys = await signingKeys(config.issuer, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await signingKeys(config.issuer, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk || jwk.kty !== "RSA") return null;
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 30) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (payload.iss !== config.issuer) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(config.aud)) return null;
  const email = String(payload.email || "").trim().toLowerCase();
  const user = email && config.users.get(email);
  if (!user) return null;
  return { ...user, exp: payload.exp };
}

const buckets = new Map();
export function throttle(id, kind, limit, windowMs) {
  const k = `${kind}:${id}`, now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(k, b); }
  b.count++;
  if (buckets.size > 5000) for (const [key, v] of buckets) if (now - v.start > windowMs) buckets.delete(key);
  return b.count <= limit ? 0 : Math.ceil((b.start + windowMs - now) / 1000);
}
