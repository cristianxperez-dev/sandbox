/* FUEL — pairing and correlation, kept simple and honest.

   pairObservations: deterministic one-to-one matching of a physical series and a performance series by date.
   Every candidate pair within the window is ranked by (days apart, physical date, performance date, ids); pairs
   are taken greedily in that order and neither observation is ever reused. A single DEXA scan can therefore
   pair with at most one performance measurement. Nothing is interpolated: only real observations are used.

   pearson: Pearson's r with its sample size. Not shown below MIN_PAIRS; flagged unstable below 10. */

import { toDays } from "./util.js";

export const MIN_PAIRS = 5;
export const STABLE_PAIRS = 10;

export function pairObservations(physical, performance, windowDays = 7) {
  const P = physical.filter((x) => x && x.date && Number.isFinite(x.value));
  const Q = performance.filter((x) => x && x.date && Number.isFinite(x.value));
  const cands = [];
  for (let i = 0; i < P.length; i++) {
    const di = toDays(P[i].date);
    for (let j = 0; j < Q.length; j++) {
      const gap = Math.abs(toDays(Q[j].date) - di);
      if (gap <= windowDays) cands.push({ i, j, gap });
    }
  }
  cands.sort((a, b) => a.gap - b.gap || P[a.i].date.localeCompare(P[b.i].date) || Q[a.j].date.localeCompare(Q[b.j].date)
    || String(P[a.i].id || a.i).localeCompare(String(P[b.i].id || b.i)) || String(Q[a.j].id || a.j).localeCompare(String(Q[b.j].id || b.j)));
  const usedP = new Set(), usedQ = new Set(), pairs = [];
  for (const c of cands) {
    if (usedP.has(c.i) || usedQ.has(c.j)) continue;
    usedP.add(c.i); usedQ.add(c.j);
    pairs.push({ x: P[c.i].value, y: Q[c.j].value, xDate: P[c.i].date, yDate: Q[c.j].date, gap: c.gap, xId: P[c.i].id, yId: Q[c.j].id });
  }
  pairs.sort((a, b) => a.xDate.localeCompare(b.xDate) || a.yDate.localeCompare(b.yDate));
  return pairs;
}

export function pearson(pairs) {
  const n = pairs.length;
  if (n < 2) return { n, r: null };
  let sx = 0, sy = 0;
  for (const p of pairs) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pairs) { const dx = p.x - mx, dy = p.y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return { n, r: null, reason: "One of the two measurements didn't vary across the pairs, so a correlation can't be calculated." };
  return { n, r: sxy / Math.sqrt(sxx * syy) };
}

/** The full, plain-language result the Performance section shows. */
export function analyze(physical, performance, windowDays = 7) {
  const pairs = pairObservations(physical, performance, windowDays);
  const res = { pairs, n: pairs.length, windowDays, r: null, show: false, message: "" };
  if (pairs.length < MIN_PAIRS) {
    res.message = `${pairs.length} matched pair${pairs.length === 1 ? "" : "s"} within ${windowDays} days — at least ${MIN_PAIRS} are needed before a correlation is shown. The trends above are the real measurements.`;
    return res;
  }
  const p = pearson(pairs);
  if (p.r == null) { res.message = p.reason; return res; }
  res.r = p.r; res.show = true;
  const a = Math.abs(p.r);
  const strength = a < 0.1 ? "no clear" : a < 0.3 ? "a weak" : a < 0.5 ? "a moderate" : "a strong";
  const dir = p.r > 0 ? "higher values of one tended to come with higher values of the other" : "higher values of one tended to come with lower values of the other";
  res.strength = strength;
  res.message = `${strength[0].toUpperCase() + strength.slice(1)} ${a < 0.1 ? "linear relationship" : "relationship"} (r = ${p.r.toFixed(2)}, ${pairs.length} pairs)${a < 0.1 ? "" : ": " + dir}. ` +
    (pairs.length < STABLE_PAIRS ? `With fewer than ${STABLE_PAIRS} pairs this number is unstable and can change a lot with one more measurement. ` : "") +
    "This describes how the measurements moved together; it doesn't show that one caused the other.";
  return res;
}

/** simple descriptive change between the first and last real observation in a window */
export function change(series, from, to) {
  const s = series.filter((x) => x.date && (!from || x.date >= from) && (!to || x.date <= to) && Number.isFinite(x.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < 2) return { n: s.length, first: s[0] || null, last: s[s.length - 1] || null, delta: null };
  return { n: s.length, first: s[0], last: s[s.length - 1], delta: s[s.length - 1].value - s[0].value };
}
