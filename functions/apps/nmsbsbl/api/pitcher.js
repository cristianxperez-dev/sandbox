/* NMSBSBL — one pitcher's profile data (MLB Stats API).
   GET /apps/nmsbsbl/api/pitcher?id=<MLBAM id>
   → { player: {…as in roster}, seasons: [{ season, gp, gs, ip, era, whip, so, bb, k9, bb9, kPct, bbPct, … }] (MLB only, newest first) }
   Only pitchers NMSBSBL covers. Edge-cached 6 hours. */
import { covered, json, fail, cachedJSON, FIRST_SEASON } from "./_shared.js";
import { person, seasonLine } from "./roster.js";

export async function onRequestGet({ request }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^\d{5,7}$/.test(id) || !covered(id)) return fail(404, "Not a pitcher NMSBSBL covers.");
  const [p, teams] = await Promise.all([
    cachedJSON(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam,stats(group=[pitching],type=[yearByYear],sportId=1)`, 6 * 3600),
    cachedJSON("https://statsapi.mlb.com/api/v1/teams?sportId=1", 7 * 86400)
  ]);
  if (!p || !p.data.people || !p.data.people[0]) return fail(502, "The MLB Stats API could not be reached.");
  const raw = p.data.people[0];
  const abbr = new Map(((teams && teams.data.teams) || []).map((t) => [t.id, t.abbreviation]));
  const player = person(Object.assign({}, raw, { stats: [] }), null);
  player.teamAbbr = player.teamAbbr || abbr.get(player.teamId) || null;
  // year by year: one line per club per season; a season with two clubs also has a combined line (no team)
  const bySeason = new Map();
  ((raw.stats && raw.stats[0] && raw.stats[0].splits) || []).forEach((s) => {
    if (!s.season || (s.sport && s.sport.id !== 1)) return;
    const cur = bySeason.get(s.season);
    if (!cur || !s.team) bySeason.set(s.season, Object.assign(seasonLine(s.stat, s.season), { teams: cur ? cur.teams : [], combined: !s.team }));
    const line = bySeason.get(s.season);
    if (s.team) line.teams.push(abbr.get(s.team.id) || s.team.name);
  });
  const seasons = Array.from(bySeason.values()).sort((a, b) => b.season.localeCompare(a.season));
  return json(200, { player, seasons, statcastSeasons: seasons.map((s) => +s.season).filter((y) => y >= FIRST_SEASON), fetchedAt: p.fetchedAt, stale: p.stale }, { "Cache-Control": "private, max-age=300" });
}
export const onRequest = () => fail(405, "GET only");
