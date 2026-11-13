/* Reused unchanged from AGORA (cpbaseball-site, public/ephyra/apps/agora/age-core.js @ f058159) — NMSBSBL keeps its own copy so it never depends on AGORA's deployment. */
/* AGORA — decimal player age, pure (no DOM). One definition for every player-facing age: profiles, Club
 * Rosters, the Advance packet and PDFs, Player Queries. Tested in scripts/ephyra/agora/tests/age-core.test.mjs.
 *
 *   age(born, ref)      full precision: completed years + the share of the current birthday year elapsed,
 *                       counted in calendar days between the last and the next birthday (so 365 or 366)
 *   ageText(born, ref)  one decimal, truncated like a whole-number age — 28 years 10 months → "28.8", and
 *                       never "29.0" the week before a 29th birthday
 *   ageRef(season, today)  the reference date: today for the current season (the default), June 30 of a past
 *                       season (mid-season, the convention Baseball-Reference uses for season age)
 *
 * Dates are calendar days (YYYY-MM-DD, or a Date read in the viewer's local calendar); no time zones, no
 * year subtraction. A February 29 birthday falls on March 1 in common years. Decimal age is a fraction of a
 * year — never the years.days of MLB service time.
 */
(function (root) {
  'use strict';
  const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;

  /** "1997-01-20" or a Date → { y, m, d }, or null for anything that is not a real calendar day. */
  function parseDay(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    const m = ISO.exec(String(v || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
  }
  const birthday = (b, year) => (b.m === 2 && b.d === 29 && !leap(year) ? dayNum(year, 3, 1) : dayNum(year, b.m, b.d));

  /** Age in years at `ref` (default: today), full precision; null without a birth date or before it. */
  function age(born, ref) {
    const b = parseDay(born), r = parseDay(ref === undefined || ref === null ? new Date() : ref);
    if (!b || !r) return null;
    const t = dayNum(r.y, r.m, r.d);
    if (t < dayNum(b.y, b.m, b.d)) return null;
    let years = r.y - b.y;
    if (t < birthday(b, r.y)) years -= 1;
    const last = birthday(b, b.y + years), next = birthday(b, b.y + years + 1);
    return years + (t - last) / (next - last);
  }
  /** One decimal, truncated: "28.8"; null when the age is unknown. */
  function ageText(born, ref) {
    const a = age(born, ref);
    return a === null ? null : (Math.floor(a * 10 + 1e-9) / 10).toFixed(1);
  }
  /** Today (local calendar) for the current or a future season; June 30 of a past season. */
  function ageRef(season, today) {
    const now = parseDay(today === undefined || today === null ? new Date() : today);
    if (!Number.isInteger(season) || !now || season >= now.y) return now ? `${now.y}-${String(now.m).padStart(2, '0')}-${String(now.d).padStart(2, '0')}` : null;
    return `${season}-06-30`;
  }

  root.AGORA_AGE = { age, ageText, ageRef, parseDay };
})(typeof window !== 'undefined' ? window : globalThis);
