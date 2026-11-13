/* NMSBSBL — shared by the data endpoints under /apps/nmsbsbl/api/ (all behind the access gate:
   functions/_middleware.js runs first; a request without a valid NMSBSBL session never reaches these).

   The pitchers NMSBSBL covers: MLBAM ids only. Names, teams, handedness and ages always come from the
   MLB Stats API at request time — nothing about a player is typed in here. The endpoints answer only for
   these ids, so they can't be used as an open proxy. */
export const PITCHERS = [
  // right-handed
  694973, // Paul Skenes
  554430, // Zack Wheeler
  543037, // Gerrit Cole
  669203, // Corbin Burnes
  657277, // Logan Webb
  675911, // Spencer Strider
  808967, // Yoshinobu Yamamoto
  668881, // Hunter Greene
  607192, // Tyler Glasnow
  695243, // Mason Miller
  694819, // Jacob Misiorowski
  // left-handed
  669373, // Tarik Skubal
  519242, // Chris Sale
  676979, // Garrett Crochet
  664285, // Framber Valdez
  605483, // Blake Snell
  608331, // Max Fried
  684007, // Shota Imanaga
  666142, // Cole Ragans
  623352, // Josh Hader
];
export const FIRST_SEASON = 2015;   // Statcast pitch tracking

const BASE_HEADERS = { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
export const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
export const fail = (status, error) => json(status, { error }, { "Cache-Control": "no-store" });
export const currentYear = () => new Date().getUTCFullYear();
export const validSeason = (s) => /^\d{4}$/.test(String(s)) && +s >= FIRST_SEASON && +s <= currentYear();
export const covered = (id) => PITCHERS.includes(Number(id));

/** GET a JSON document upstream through the edge cache (ttl seconds). Returns {data, stale} or null. */
export async function cachedJSON(url, ttl) {
  const cache = globalThis.caches && globalThis.caches.default;
  const key = new Request(url);
  let hit = null;
  try { hit = cache ? await cache.match(key) : null; } catch (e) { hit = null; }
  const at = hit && Date.parse(hit.headers.get("X-Fetched-At") || "");
  if (hit && Date.now() - at < ttl * 1000) return { data: await hit.json(), stale: false, fetchedAt: hit.headers.get("X-Fetched-At") };
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "nmsbsbl/1.0 (+https://cperez.app)" }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json(), fetchedAt = new Date().toISOString();
      if (cache) { try { await cache.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=2592000", "X-Fetched-At": fetchedAt } })); } catch (e) { /* cache is best effort */ } }
      return { data, stale: false, fetchedAt };
    }
  } catch (e) { /* fall through to the last good copy */ }
  return hit ? { data: await hit.json(), stale: true, fetchedAt: hit.headers.get("X-Fetched-At") } : null;
}
