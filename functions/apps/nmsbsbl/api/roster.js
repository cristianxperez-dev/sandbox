/* NMSBSBL — the pitcher directory (MLB Stats API).
   GET /apps/nmsbsbl/api/roster?season=<year>   (season optional: defaults to the current year)
   → { season, fetchedAt, stale, pitchers:[{ id, name, first, last, team, teamAbbr, teamId, throws, birthDate, number,
        active, season:{ season, gp, gs, ip, era, whip, so, bb, k9, bb9, kPct, bbPct, saves } | null }] }
   One batched Stats API request for every covered pitcher; edge-cached 6 hours. */
import { PITCHERS, json, fail, cachedJSON, validSeason, currentYear } from "./_shared.js";

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
export function seasonLine(stat, season) {
  if (!stat) return null;
  const n = (v) => (v == null || v === "" || v === "-.--" ? null : Number(v));
  const bf = n(stat.battersFaced);
  return { season: String(season), gp: n(stat.gamesPitched), gs: n(stat.gamesStarted), ip: stat.inningsPitched || null, era: stat.era || null, whip: stat.whip || null,
    so: n(stat.strikeOuts), bb: n(stat.baseOnBalls), k9: stat.strikeoutsPer9Inn || null, bb9: stat.walksPer9Inn || null, hr: n(stat.homeRuns),
    kPct: pct(n(stat.strikeOuts), bf), bbPct: pct(n(stat.baseOnBalls), bf), bf, saves: n(stat.saves), avg: stat.avg || null, w: n(stat.wins), l: n(stat.losses) };
}
export function person(p, season) {
  // a pitcher who changed clubs has one line per club plus a combined line (no team); take the combined one
  const splits = (p.stats && p.stats[0] && p.stats[0].splits) || [];
  const total = splits.find((s) => !s.team) || (splits.length === 1 ? splits[0] : null);
  return {
    id: p.id, name: p.fullName, first: p.useName || p.firstName, last: p.lastName, number: p.primaryNumber || null,
    team: p.currentTeam ? p.currentTeam.name : null, teamId: p.currentTeam ? p.currentTeam.id : null, teamAbbr: p.currentTeam && p.currentTeam.abbreviation ? p.currentTeam.abbreviation : null,
    throws: p.pitchHand ? p.pitchHand.code : null, birthDate: p.birthDate || null, height: p.height || null, weight: p.weight || null, active: !!p.active,
    debut: p.mlbDebutDate || null, season: total ? seasonLine(total.stat, season) : null
  };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const season = url.searchParams.get("season") || String(currentYear());
  if (!validSeason(season)) return fail(400, "season must be a Statcast season");
  const target = `https://statsapi.mlb.com/api/v1/people?personIds=${PITCHERS.join(",")}&hydrate=currentTeam,stats(group=[pitching],type=[season],season=${season})`;
  const r = await cachedJSON(target, 6 * 3600);
  if (!r) return fail(502, "The MLB Stats API could not be reached.");
  const teams = await cachedJSON("https://statsapi.mlb.com/api/v1/teams?sportId=1", 7 * 86400);
  const abbr = new Map(((teams && teams.data.teams) || []).map((t) => [t.id, t.abbreviation]));
  const pitchers = (r.data.people || []).map((p) => person(p, season)).map((p) => Object.assign(p, { teamAbbr: p.teamAbbr || abbr.get(p.teamId) || null }));
  return json(200, { season, fetchedAt: r.fetchedAt, stale: r.stale, pitchers }, { "Cache-Control": "private, max-age=300" });
}
export const onRequest = () => fail(405, "GET only");
