/* NMSBSBL — one pitcher's Statcast season, pitch by pitch (Baseball Savant, public).
   GET /apps/nmsbsbl/api/pitches?id=<MLBAM id>&season=<year>
   → the Statcast search CSV for every regular-season pitch he threw that season, passed through unparsed
     (the browser parses it — parsing ~2 MB here would cost more edge CPU than it saves).

   Same pattern as AGORA's restricted pitch endpoint: one player-season per request, on demand — never a bulk
   download — and only for the pitchers NMSBSBL covers. Edge cache: 30 days for a past season, 12 hours for the
   current one; when Savant can't be reached the last good copy is served with X-Stale: 1. */
import { covered, fail, validSeason, currentYear } from "./_shared.js";

const UPSTREAM = "https://baseballsavant.mlb.com/statcast_search/csv";
const MAX_BYTES = 12 * 1024 * 1024;
export function upstreamFor(id, season) {
  const qs = ["all=true", "type=details", "player_type=pitcher", `pitchers_lookup%5B%5D=${id}`, `hfSea=${season}%7C`, "hfGT=R%7C",
    "min_pitches=0", "min_results=0", "min_pas=0", "group_by=name", "sort_col=pitches", "sort_order=desc"].join("&");
  return `${UPSTREAM}?${qs}`;
}
export const looksLikeStatcast = (head) => { const first = head.replace(/^﻿/, "").split("\n", 1)[0]; return /^"?pitch_type"?,/.test(first) && first.includes("pfx_x") && first.includes("release_speed"); };

export async function onRequestGet({ request }) {
  const u = new URL(request.url), id = u.searchParams.get("id") || "", season = u.searchParams.get("season") || "";
  if (!/^\d{5,7}$/.test(id) || !covered(id)) return fail(404, "Not a pitcher NMSBSBL covers.");
  if (!validSeason(season)) return fail(400, "season must be a Statcast season");
  const target = upstreamFor(id, season), ttl = +season === currentYear() ? 12 * 3600 : 30 * 86400;
  const cache = globalThis.caches && globalThis.caches.default, key = new Request(target);
  let hit = null;
  try { hit = cache ? await cache.match(key) : null; } catch (e) { hit = null; }
  const at = hit ? Date.parse(hit.headers.get("X-Fetched-At") || "") : NaN;
  const out = (res, stale) => new Response(res.body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, max-age=600", "X-Fetched-At": res.headers.get("X-Fetched-At") || "", "X-Stale": stale ? "1" : "0", "X-Content-Type-Options": "nosniff" } });
  if (hit && Date.now() - at < ttl * 1000) return out(hit, false);
  let body = null;
  try {
    const r = await fetch(target, { headers: { Accept: "text/csv", "User-Agent": "nmsbsbl/1.0 (+https://cperez.app)" }, signal: AbortSignal.timeout(25000) });
    if (r.ok) { const buf = await r.arrayBuffer(); if (buf.byteLength <= MAX_BYTES && looksLikeStatcast(new TextDecoder().decode(buf.slice(0, 4096)))) body = buf; }
  } catch (e) { body = null; }
  if (!body) return hit ? out(hit, true) : fail(502, "Baseball Savant could not be reached.");
  const fresh = new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=2592000", "X-Fetched-At": new Date().toISOString() } });
  if (cache) { try { await cache.put(key, fresh.clone()); } catch (e) { /* best effort */ } }
  return out(fresh, false);
}
export const onRequest = () => fail(405, "GET only");
