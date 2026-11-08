/* Decision Lab — decision engine (pure; runs in the browser and in Node tests).
   Everything here is computed from data/model.json (see tools/decision-lab/build_model.py):
   - Run expectancy and run distributions per base-out state (Retrosheet 2023–25, by batting side).
   - Win expectancy by dynamic programming over those run distributions (home team bats last; extra innings start
     with a runner on second, as in the regular season since 2020).
   - Base-out transitions for advancing the game (empirical), by batter tier.
   - Decision families: steal second, sacrifice bunt, send from second on a single, tag from third, infield in/back.
   Bases are a bit mask: 1 = first, 2 = second, 4 = third. Score difference d = home − away. */

/* ---------------- random numbers (seeded, reproducible) ---------------- */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.seed = seed; return f;
}
export function pick(r, items, w = (x) => x.p) {      // weighted choice
  let tot = 0; for (const it of items) tot += w(it);
  let x = r() * tot;
  for (const it of items) { x -= w(it); if (x <= 0) return it; }
  return items[items.length - 1];
}
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const logistic = (z) => 1 / (1 + Math.exp(-z));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const P_MAX = 0.995;          // even the easiest send or tag fails now and then (a stumble, a missed plate, a great play)
export const BASE_NAMES = { 0: 'Bases empty', 1: 'Runner on first', 2: 'Runner on second', 4: 'Runner on third', 3: 'Runners on first and second', 5: 'Runners on first and third', 6: 'Runners on second and third', 7: 'Bases loaded' };
export const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

/* ---------------- the model ---------------- */
export function createEngine(M) {
  const RD = {}; for (const k in M.runDist) RD[k] = M.runDist[k];
  const MAXR = RD['all:0:0'].length - 1;
  const rd = (side, o, b) => RD[`${side}:${o}:${b}`];
  const re = (o, b) => (o >= 3 ? 0 : M.re24[`all:${o}:${b}`]);
  const EXTRA = (i) => i >= 10;
  const startBases = (i) => (EXTRA(i) ? 2 : 0);

  /* P(home team wins) */
  const memo = new Map();
  let Xextra = null;                    // P(home wins | top of an extra inning starts tied)
  function extraX() {
    if (Xextra !== null) return Xextra;
    const pa = rd('away', 0, 2), ph = rd('home', 0, 2);
    let A = 0, B = 0;
    for (let a = 0; a <= MAXR; a++) { let gt = 0; for (let b = a + 1; b <= MAXR; b++) gt += ph[b]; A += pa[a] * gt; B += pa[a] * ph[a]; }
    Xextra = A / (1 - B); return Xextra;
  }
  function vTopStart(i, d) {             // start of the top of inning i, home leading by d
    if (i >= 10 && d === 0) return extraX();
    return halfValue(Math.min(i, 10), 'top', 0, startBases(i), d);
  }
  function vBotStart(i, d) {             // start of the bottom of inning i
    if (i >= 9 && d > 0) return 1;       // home already ahead after the top of the 9th or later: game over
    return halfValue(Math.min(i, 10), 'bottom', 0, startBases(i), d);
  }
  function halfValue(i, half, o, b, d) {
    d = clamp(d, -25, 25);
    const key = `${i}|${half}|${o}|${b}|${d}`; if (memo.has(key)) return memo.get(key);
    let v = 0;
    if (half === 'top') { const p = rd('away', o, b); for (let k = 0; k <= MAXR; k++) v += p[k] * vBotStart(i, d - k); }
    else {
      const p = rd('home', o, b);
      for (let k = 0; k <= MAXR; k++) {
        const nd = d + k;
        if (i >= 9) v += p[k] * (nd > 0 ? 1 : nd === 0 ? vTopStart(i + 1, 0) : 0);
        else v += p[k] * vTopStart(i + 1, nd);
      }
    }
    memo.set(key, v); return v;
  }
  /* win expectancy for a game state; also handles "inning over" (outs = 3) and finished games */
  function weHome(s) {
    const d = s.score.home - s.score.away;
    if (s.final) return d > 0 ? 1 : 0;
    if (s.half === 'bottom' && s.inning >= 9 && d > 0) return 1;       // walk-off already happened
    if (s.outs >= 3) return s.half === 'top' ? vBotStart(s.inning, d) : (s.inning >= 9 && d !== 0 ? (d > 0 ? 1 : 0) : vTopStart(s.inning + 1, d));
    return halfValue(Math.min(s.inning, 10), s.half, s.outs, s.bases, d);
  }
  const weFor = (s, side) => (side === 'home' ? weHome(s) : 1 - weHome(s));

  /* apply a post-play (outs, bases, runs) to a state → a new legal state */
  function applyPost(s, outs, bases, runs) {
    const n = { ...s, score: { ...s.score }, outs: Math.min(3, outs), bases: outs >= 3 ? 0 : bases };
    if (s.half === 'top') n.score.away += runs; else n.score.home += runs;
    if (n.half === 'bottom' && n.inning >= 9 && n.score.home > n.score.away) { n.final = true; n.walkoff = true; }
    return n;
  }
  /* close a half-inning when there are three outs; end the game when it's over */
  function nextHalf(s) {
    if (s.final || s.outs < 3) return s;
    const d = s.score.home - s.score.away;
    if (s.half === 'top') {
      if (s.inning >= 9 && d > 0) return { ...s, final: true };
      return { ...s, half: 'bottom', outs: 0, bases: startBases(s.inning) };
    }
    if (s.inning >= 9 && d !== 0) return { ...s, final: true };
    return { ...s, inning: s.inning + 1, half: 'top', outs: 0, bases: startBases(s.inning + 1) };
  }
  const battingSide = (s) => (s.half === 'top' ? 'away' : 'home');

  /* ---------------- outcome distributions → expected value ---------------- */
  const dist = (rows, total) => rows.map((r) => ({ outs: r[0], bases: r[1], runs: r[2], tag: typeof r[3] === 'string' ? r[3] : '', p: r[r.length - 1] / total }));
  const fromTable = (rows) => { const t = rows.reduce((a, r) => a + r[r.length - 1], 0); return dist(rows, t); };
  function value(s, side, outcomes) {           // expected win expectancy (user side) and expected runs (batting team)
    let we = 0, rv = 0;
    for (const o of outcomes) {
      const n = applyPost(s, o.outs, o.bases, o.runs);
      we += o.p * weFor(n.outs >= 3 ? nextHalf(n) : n, side);
      rv += o.p * (o.runs + re(o.outs, o.bases));
    }
    return { we, re: rv };
  }

  /* ---------------- decision families ---------------- */
  const A = M.assumptions, F = M.fits;
  const ASSUME = (key, over) => (over && over[key] != null ? over[key] : A[key].value);

  /* steal success from sprint speed (fitted) and battery (assumption) */
  function stealP(speed, battery = 'avg', over) {
    const f = M.steal.speedFit, eff = ASSUME('steal_catcher_effect', over);
    const base = logistic(f.intercept + f.slope * (speed - f.center));
    const p = clamp(base + (battery === 'strong' ? -eff : battery === 'weak' ? eff : 0), 0.05, 0.98);
    const se = f.slopeSE * Math.abs(speed - f.center) * base * (1 - base);
    return { p, low: clamp(p - 1.96 * se - eff / 2, 0, 1), high: clamp(p + 1.96 * se + eff / 2, 0, 1) };
  }
  /* time margin (s) of a throw home over the runner from second on a single; > 0 favours the defence */
  function sendMargin({ speed, arm, depth, pos, outs, charging }, over) {
    const T = A.send_timing;
    const dist = T.fieldDist[depth] + (pos === '8' ? T.cfExtra : 0);
    const tThrow = T.fieldTime[depth] - (charging ? ASSUME('charging_time', over) : 0) + T.release + dist / (arm * 1.4667 * T.carry) + T.tag;
    const tRun = T.contactDelay[outs === 2 ? 'twoOuts' : 'lessThanTwo'] + (T.runDist2 - T.lead2) / speed + T.turn;
    return tThrow - tRun;
  }
  function sendP(x, over) {
    const m = sendMargin(x, over), f = F.send2, em = ASSUME('throw_miss', over);
    const p = Math.min(P_MAX, em + (1 - em) * phi((m - f.mu) / f.sigma));
    const lo = A.throw_miss.range[0] + (1 - A.throw_miss.range[0]) * phi((m - f.mu - 0.15) / f.sigma);
    const hi = A.throw_miss.range[1] + (1 - A.throw_miss.range[1]) * phi((m - f.mu + 0.15) / f.sigma);
    return { p, low: Math.min(lo, p), high: Math.max(hi, p), margin: m };
  }
  /* a runner from first on a double: two throws (outfielder → relay → home) */
  function send1Margin({ speed, arm, depth, outs }) {
    const T = A.send1_timing;
    const tThrow = T.fieldTime[depth] + T.release + T.relayDist[depth] / (arm * 1.4667 * T.carry) + T.relayRelease + T.relayHome / (T.relayArm * 1.4667 * T.carry) + T.tag;
    const tRun = T.contactDelay[outs === 2 ? 'twoOuts' : 'lessThanTwo'] + (T.runDist1 - T.lead1) / speed + T.turns;
    return tThrow - tRun;
  }
  function send1P(x, over) {
    const m = send1Margin(x), f = F.send1, em = ASSUME('throw_miss', over);
    const p = Math.min(P_MAX, em + (1 - em) * phi((m - f.mu) / f.sigma));
    const lo = A.throw_miss.range[0] + (1 - A.throw_miss.range[0]) * phi((m - f.mu - 0.15) / f.sigma);
    const hi = A.throw_miss.range[1] + (1 - A.throw_miss.range[1]) * phi((m - f.mu + 0.15) / f.sigma);
    return { p, low: Math.min(lo, p), high: Math.max(hi, p), margin: m };
  }
  /* stealing third: the same speed fit, shifted to the observed league success rate for steals of third */
  const st3 = (() => { const t = M.steal.third, s2 = M.steal.second; let a3 = 0, b3 = 0, a2 = 0, b2 = 0;
    for (const o in t) { a3 += t[o].att; b3 += t[o].sb; } for (const o in s2) { a2 += s2[o].att; b2 += s2[o].sb; }
    const lg = (p) => Math.log(p / (1 - p)); return { shift: lg(b3 / a3) - lg(b2 / a2), rate: b3 / a3, att: a3 }; })();
  function steal3P(speed, battery = 'avg', over) {
    const f = M.steal.speedFit, eff = ASSUME('steal_catcher_effect', over);
    const base = logistic(f.intercept + st3.shift + f.slope * (speed - f.center));
    const p = clamp(base + (battery === 'strong' ? -eff : battery === 'weak' ? eff : 0), 0.05, 0.98);
    const se = f.slopeSE * Math.abs(speed - f.center) * base * (1 - base);
    return { p, low: clamp(p - 1.96 * se - eff / 2, 0, 1), high: clamp(p + 1.96 * se + eff / 2, 0, 1) };
  }
  function tagMargin({ speed, arm, depth, pos }) {
    const T = A.tag_timing, dist = T.catchDist[depth] + (pos === '8' ? T.cfExtra : 0);
    return T.release + dist / (arm * 1.4667 * T.carry) + T.tag - (T.start + T.runDist / speed);
  }
  function tagP(x, over) {
    const m = tagMargin(x), f = F.tag3, em = ASSUME('throw_miss', over);
    const p = Math.min(P_MAX, em + (1 - em) * phi((m - f.mu) / f.sigma));
    const lo = A.throw_miss.range[0] + (1 - A.throw_miss.range[0]) * phi((m - f.mu - 0.15) / f.sigma);
    const hi = A.throw_miss.range[1] + (1 - A.throw_miss.range[1]) * phi((m - f.mu + 0.15) / f.sigma);
    return { p, low: Math.min(lo, p), high: Math.max(hi, p), margin: m };
  }
  /* plate-appearance type mix for a batter (ground-ball and strikeout tendencies) */
  function typeMix(gb = 'mid', k = 'mid') {
    const all = M.typeMix.all, g = M.typeMix['gb:' + gb], kk = M.typeMix['k:' + k], out = {};
    for (const t of ['K', 'BB', 'HR', 'GB', 'FB', 'LD', 'OTH']) out[t] = all[t] || 0;
    for (const t of ['GB', 'FB', 'LD']) out[t] *= (g[t] || 0) / (all[t] || 1);
    out.K *= (kk.K || 0) / (all.K || 1);
    const tot = Object.values(out).reduce((a, b) => a + b, 0); for (const t in out) out[t] /= tot;
    return out;
  }
  /* ground ball with a runner on third only: the infield's choice changes hit rate and what the runner does */
  /* the drawn-in effect on each batted-ball type: (hit rate with < 2 outs − with 2 outs, infield back) ÷ how often infields are in */
  function inEffect(type, over) {
    const c = M.bipControl, u = ASSUME('infield_in_usage', over);
    return Math.max(0, c[`r3_lt2:${type}`].hit - c[`r3_2out:${type}`].hit) / u;
  }
  function gbOutcomes(outs, align, over) {
    const ctrl = M.bipControl['r3_2out:GB'], dIn = inEffect('GB', over), cs = ASSUME('corners_in_share', over);
    const sBack = ASSUME('infield_back_score_on_gb_out', over), sIn = ASSUME('infield_in_score_on_gb_out', over);
    const hBack = A.infield_out_at_home.back, hIn = A.infield_out_at_home.in;
    const w = align === 'in' ? 1 : align === 'corners' ? cs : 0;           // share of the drawn-in effect
    const hit = ctrl.hit + w * dIn, err = ctrl.error, outP = 1 - hit - err;
    const sc = sBack + w * (sIn - sBack), home = hBack + w * (hIn - hBack), held = Math.max(0, 1 - sc - home);
    const o1 = outs + 1;
    return [
      { p: hit, outs, bases: 1, runs: 1, what: 'Ground-ball single — the run scores' },
      { p: err, outs, bases: 1, runs: 1, what: 'Error — the run scores' },
      { p: outP * sc, outs: o1, bases: 0, runs: 1, what: 'Ground-ball out — the runner scores' },
      { p: outP * home, outs: o1, bases: 1, runs: 0, what: 'Runner thrown out at home — batter safe at first' },
      { p: outP * held, outs: o1, bases: 4, runs: 0, what: 'Ground-ball out — the runner holds at third' },
    ];
  }
  const R3_TYPE_LABEL = { K: 'Strikeout', BB: 'Walk', HR: 'Home run', FB: 'Fly ball / pop-up', LD: 'Line drive', OTH: 'Other' };
  function infieldOutcomes(s, batter, align, over) {
    const mix = typeMix(batter.gb, batter.k), out = [];
    for (const [t, pt] of Object.entries(mix)) {
      if (!pt) continue;
      if (t === 'GB') { for (const g of gbOutcomes(s.outs, align, over)) out.push({ ...g, p: pt * g.p, type: 'GB' }); continue; }
      const rows = M.r3Types[String(s.outs)][t]; if (!rows) continue;
      let rs = fromTable(rows);
      if (t === 'LD' || t === 'FB') {          // the infield also changes how many liners and bloops fall in
        const w = align === 'in' ? 1 : align === 'corners' ? ASSUME('corners_in_share', over) : 0;
        const target = M.bipControl[`r3_2out:${t}`].hit + w * inEffect(t, over);
        const safe = rs.filter((g) => g.outs === s.outs), outR = rs.filter((g) => g.outs > s.outs);
        const ps = safe.reduce((a, g) => a + g.p, 0), po = outR.reduce((a, g) => a + g.p, 0);
        if (ps > 0 && po > 0) rs = [...safe.map((g) => ({ ...g, p: g.p * target / ps })), ...outR.map((g) => ({ ...g, p: g.p * (1 - target) / po }))];
      }
      for (const g of rs) out.push({ ...g, p: pt * g.p, type: t, what: R3_TYPE_LABEL[t] });
    }
    return out;
  }
  /* swing away: the batter-tier's empirical plate appearances from this base-out state */
  function swingOutcomes(s, tier = 'avg') {
    const t = M.paTransitions[tier] && M.paTransitions[tier][`${s.outs}:${s.bases}`] ? tier : 'all';
    return fromTable(M.paTransitions[t][`${s.outs}:${s.bases}`]);
  }
  function buntOutcomes(s, over) {           // bunts put in play (empirical) + attempts that never get one down (assumption)
    const q = ASSUME('bunt_fail', over);
    return [...fromTable(M.bunt[`${s.outs}:${s.bases}`]).map((o) => ({ ...o, p: o.p * (1 - q) })), { p: q, outs: s.outs + 1, bases: s.bases, runs: 0, what: 'Bunt attempt fails — batter out, runner stays' }];
  }
  function stealOutcomes(s, p) {
    const ok = fromTable(M.steal.secondPost[`${s.outs}:1`]), no = fromTable(M.steal.secondPost[`${s.outs}:0`]);
    return [...ok.map((o) => ({ ...o, p: o.p * p, success: true })), ...no.map((o) => ({ ...o, p: o.p * (1 - p), success: false }))];
  }
  /* runners on a single when the lead runner starts on second: third scores, first goes to second, batter to first */
  function singleBase(s) { let runs = s.bases & 4 ? 1 : 0, b = 1; if (s.bases & 1) b |= 2; return { runs, b }; }
  function sendOutcomes(s, p) {
    const { runs, b } = singleBase(s);
    return [
      { p, outs: s.outs, bases: b, runs: runs + 1, success: true, what: 'Safe at home — the run scores' },
      { p: 1 - p, outs: s.outs + 1, bases: b, runs, success: false, what: 'Thrown out at home' },
    ];
  }
  function holdSingle(s) { const { runs, b } = singleBase(s); return [{ p: 1, outs: s.outs, bases: b | 4, runs, what: 'Held at third' }]; }
  /* fly ball caught with a runner on third (fewer than two outs before the catch); other runners hold */
  function tagOutcomes(s, p) {
    const o1 = s.outs + 1, rest = s.bases & 3;
    return [
      { p, outs: o1, bases: rest, runs: 1, success: true, what: 'Tags and scores' },
      { p: 1 - p, outs: o1 + 1, bases: o1 + 1 >= 3 ? 0 : rest, runs: 0, success: false, what: 'Thrown out at home' },
    ];
  }
  function holdTag(s) { return [{ p: 1, outs: s.outs + 1, bases: s.bases, runs: 0, what: 'Holds at third' }]; }

  /* break-even success rate for a go / no-go choice: p* with p·V(success) + (1−p)·V(fail) = V(stay) */
  function breakEven(s, side, succ, fail, stay) {
    const vs = value(s, side, succ.map((o) => ({ ...o, p: o.p / succ.reduce((a, x) => a + x.p, 0) }))).we;
    const vf = value(s, side, fail.map((o) => ({ ...o, p: o.p / fail.reduce((a, x) => a + x.p, 0) }))).we;
    const vh = value(s, side, stay).we;
    return vs === vf ? null : clamp((vh - vf) / (vs - vf), 0, 1);
  }

  /* Evaluate one decision. ctx: { family, state, side (user's team), personnel, over (assumption overrides) }
     Returns options with outcomes, expected WE / runs, success probabilities and break-even. */
  function evaluate(ctx) {
    const { family, state: s, side, x = {}, over } = ctx;
    const opts = [];
    if (family === 'steal') {
      const sp = stealP(x.speed, x.battery, over), att = stealOutcomes(s, sp.p);
      opts.push({ id: 'attempt', label: 'Steal second', outcomes: att, success: sp });
      opts.push({ id: 'hold', label: 'Hold the runner', outcomes: [{ p: 1, outs: s.outs, bases: s.bases, runs: 0, what: 'Runner stays at first' }] });
      const be = breakEven(s, side, att.filter((o) => o.success), att.filter((o) => !o.success), opts[1].outcomes);
      opts[0].breakEven = be;
    } else if (family === 'steal3') {
      const sp = steal3P(x.speed, x.battery, over);
      const att = [{ p: sp.p, outs: s.outs, bases: s.bases | 4 & ~2 | (s.bases & 1), runs: 0, success: true, what: 'Safe at third' },
        { p: 1 - sp.p, outs: s.outs + 1, bases: s.bases & 1, runs: 0, success: false, what: 'Caught stealing third' }];
      att[0].bases = (s.bases & 1) | 4;
      opts.push({ id: 'attempt', label: 'Steal third', outcomes: att, success: sp });
      opts.push({ id: 'hold', label: 'Hold the runner', outcomes: [{ p: 1, outs: s.outs, bases: s.bases, runs: 0, what: 'Runner stays at second' }] });
      opts[0].breakEven = breakEven(s, side, [att[0]], [att[1]], opts[1].outcomes);
    } else if (family === 'send1') {
      const sp = send1P({ ...x, outs: s.outs }, over);
      const so = [{ p: sp.p, outs: s.outs, bases: 2, runs: 1, success: true, what: 'Safe at home — the run scores' },
        { p: 1 - sp.p, outs: s.outs + 1, bases: 2, runs: 0, success: false, what: 'Thrown out at home' }];
      opts.push({ id: 'send', label: 'Send him', outcomes: so, success: sp });
      opts.push({ id: 'hold', label: 'Hold at third', outcomes: [{ p: 1, outs: s.outs, bases: 6, runs: 0, what: 'Held at third — runners on second and third' }] });
      opts[0].breakEven = breakEven(s, side, [so[0]], [so[1]], opts[1].outcomes);
    } else if (family === 'bunt') {
      opts.push({ id: 'bunt', label: 'Sacrifice bunt', outcomes: buntOutcomes(s, over) });
      opts.push({ id: 'swing', label: 'Swing away', outcomes: swingOutcomes(s, x.tier) });
    } else if (family === 'send') {
      const sp = sendP({ ...x, outs: s.outs }, over), so = sendOutcomes(s, sp.p);
      opts.push({ id: 'send', label: 'Send him', outcomes: so, success: sp });
      opts.push({ id: 'hold', label: 'Hold at third', outcomes: holdSingle(s) });
      opts[0].breakEven = breakEven(s, side, [so[0]], [so[1]], opts[1].outcomes);
    } else if (family === 'tag') {
      const tp = tagP(x, over), to = tagOutcomes(s, tp.p);
      opts.push({ id: 'tag', label: 'Tag and go', outcomes: to, success: tp });
      opts.push({ id: 'hold', label: 'Hold at third', outcomes: holdTag(s) });
      opts[0].breakEven = breakEven(s, side, [to[0]], [to[1]], opts[1].outcomes);
    } else if (family === 'infield') {
      for (const [id, label] of [['in', 'Infield in'], ['back', 'Infield back'], ['corners', 'Corners in, middle back']])
        opts.push({ id, label, outcomes: infieldOutcomes(s, x, id, over) });
    }
    for (const o of opts) { const v = value(s, side, o.outcomes); o.we = v.we; o.re = v.re; }
    const best = opts.reduce((a, b) => (b.we > a.we ? b : a));
    const now = weFor(s, side);
    for (const o of opts) { o.dWE = o.we - best.we; o.best = o === best; o.addWE = o.we - now; }
    // robustness: does the preferred choice change anywhere inside the assumption ranges this family depends on?
    const sens = sensitivity(ctx, best.id);
    return { family, state: s, side, x, options: opts, best: best.id, weNow: now, sensitive: sens };
  }
  const FAMILY_ASSUMPTIONS = { infield: ['infield_in_usage', 'infield_in_score_on_gb_out', 'infield_back_score_on_gb_out', 'corners_in_share'],
    send: ['throw_miss', 'charging_time'], send1: ['throw_miss'], tag: ['throw_miss'], steal: ['steal_catcher_effect'], steal3: ['steal_catcher_effect'], bunt: ['bunt_fail'] };
  function sensitivity(ctx, bestId) {
    if (ctx.noSens) return [];
    const flips = [];
    for (const key of FAMILY_ASSUMPTIONS[ctx.family] || []) {
      for (const v of A[key].range) {
        const r = evaluate({ ...ctx, noSens: true, over: { ...(ctx.over || {}), [key]: v } });
        if (r.best !== bestId) flips.push({ key, value: v, best: r.best });
      }
    }
    return flips;
  }
  /* decision quality: how much win expectancy the choice gave up against the model's preferred option */
  function grade(ev, choiceId) {
    const c = ev.options.find((o) => o.id === choiceId), loss = -c.dWE;
    const close = ev.sensitive.length > 0;
    let label, tone;
    if (c.best) { label = close ? 'Sound — but a close call' : 'Sound decision'; tone = 'good'; }
    else if (loss < 0.005) { label = 'Defensible — essentially even'; tone = 'good'; }
    else if (loss < 0.015 || (close && ev.sensitive.some((f) => f.best === choiceId))) { label = 'Questionable'; tone = 'mid'; }
    else { label = 'Costly decision'; tone = 'bad'; }
    return { label, tone, lossWE: loss, choice: c, best: ev.options.find((o) => o.best) };
  }
  /* sample the outcome of a chosen option */
  function resolve(ev, choiceId, r) {
    const c = ev.options.find((o) => o.id === choiceId);
    const o = pick(r, c.outcomes);
    let n = applyPost(ev.state, o.outs, o.bases, o.runs);
    return { outcome: o, state: n };
  }

  /* ---------------- leverage: how much win expectancy typically moves on the next plate appearance ---------------- */
  function leverage(s) {
    const rows = swingOutcomes(s), now = weHome(s); let e = 0;
    for (const o of rows) { const n = applyPost(s, o.outs, o.bases, o.runs); e += o.p * Math.abs(weHome(n.outs >= 3 ? nextHalf(n) : n) - now); }
    return e / 0.034;                   // ≈ 1.0 for an average plate appearance (league mean |ΔWE| per PA)
  }

  return { M, re, rd, weHome, weFor, applyPost, nextHalf, battingSide, evaluate, grade, resolve, value, stealP, steal3P, st3, sendP, send1P, tagP, sendMargin,
    typeMix, gbOutcomes, inEffect, swingOutcomes, buntOutcomes, leverage, fromTable, extraX, startBases, MAXR };
}

/* a plain-English line for any outcome */
export function outcomeText(s, o) {
  if (o.what && (o.success != null || o.type === 'GB' || !o.type)) return o.what;
  const outsOn = o.outs - s.outs;
  const tail = `${outsOn >= 3 - s.outs && o.outs >= 3 ? 'inning over' : outsOn ? outsOn + ' out' + (outsOn > 1 ? 's' : '') : 'no out'}${o.runs ? `, ${o.runs} run${o.runs > 1 ? 's' : ''} score${o.runs > 1 ? '' : 's'}` : ''}${o.outs < 3 ? ' · ' + BASE_NAMES[o.bases].toLowerCase() : ''}`;
  return (o.what ? o.what + ' — ' : '') + tail;
}

/* ---------------- players (hypothetical, drawn from MLB 2023–25 distributions) ---------------- */
const FIRST = ['Mateo', 'Jalen', 'Cole', 'Diego', 'Owen', 'Marcus', 'Luis', 'Tyler', 'Andrés', 'Kai', 'Brady', 'Elian', 'Noah', 'Rafael', 'Caden', 'Isaac', 'Jonah', 'Wes', 'Darius', 'Santiago', 'Reid', 'Nico', 'Grant', 'Tomás'];
const LAST = ['Alvarez', 'Brooks', 'Castillo', 'Dunn', 'Ellison', 'Fuentes', 'Garrity', 'Hale', 'Ibarra', 'Jensen', 'Kemp', 'Lozano', 'Maddox', 'Navarro', 'Ortega', 'Pruitt', 'Quinn', 'Rojas', 'Sutter', 'Tejada', 'Ulrich', 'Vance', 'Whitaker', 'Yates', 'Zamora'];
const POS = ['CF', 'SS', 'RF', '1B', '3B', 'LF', 'C', '2B', 'DH'];
export function makeTeam(M, r, name) {
  const sp = M.speed, used = new Set(), nm = () => { let n; do n = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)]; while (used.has(n)); used.add(n); return n; };
  const norm = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const lineup = POS.map((pos, i) => {
    const tier = i <= 1 ? (r() < 0.5 ? 'strong' : 'avg') : i <= 4 ? (r() < 0.45 ? 'strong' : 'avg') : i >= 7 ? (r() < 0.6 ? 'weak' : 'avg') : (r() < 0.3 ? 'weak' : 'avg');
    const speedBias = pos === 'CF' || pos === 'SS' || i === 0 ? 0.9 : pos === 'C' || pos === '1B' || pos === 'DH' ? -0.9 : 0;
    const speed = Math.round(clamp(sp.mean + speedBias + sp.sd * 0.8 * norm(), 23.5, 30.5) * 10) / 10;
    const gb = r() < 0.25 ? 'high' : r() < 0.33 ? 'low' : 'mid', k = tier === 'weak' ? (r() < 0.5 ? 'high' : 'mid') : r() < 0.25 ? 'high' : r() < 0.33 ? 'low' : 'mid';
    return { name: nm(), pos, slot: i + 1, tier, speed, gb, k };
  });
  const arm = (p) => Math.round(clamp(M.arm[p].mean + M.arm[p].sd * norm(), M.arm[p].p10 - 3, M.arm[p].p90 + 3) * 10) / 10;
  return { name, lineup, idx: 0, arms: { '7': arm('7'), '8': arm('8'), '9': arm('9') }, battery: r() < 0.25 ? 'strong' : r() < 0.33 ? 'weak' : 'avg', hypothetical: true };
}

/* ---------------- scenarios: one decision with a hypothetical game context ---------------- */
export const FAMILIES = {
  steal: { name: 'Stolen base', seat: 'manager', side: 'offense', q: 'Steal second, or hold the runner?' },
  bunt: { name: 'Sacrifice bunt', seat: 'manager', side: 'offense', q: 'Bunt the runner over, or swing away?' },
  infield: { name: 'Infield positioning', seat: 'manager', side: 'defense', q: 'Where do you want the infield?' },
  steal3: { name: 'Stealing third', seat: 'manager', side: 'offense', q: 'Steal third, or hold the runner at second?' },
  send: { name: 'Send or hold', seat: 'coach', side: 'offense', q: 'Single to the outfield — send him home or hold him at third?' },
  send1: { name: 'Send from first', seat: 'coach', side: 'offense', q: 'Double to the outfield — send the runner from first home, or hold him at third?' },
  tag: { name: 'Tag from third', seat: 'coach', side: 'offense', q: 'Fly ball caught — tag and go, or hold?' },
};
function pickDepth(M, r, kind, pos) {
  const mix = M.depthMix[`${kind}:${pos}`]; return pick(r, Object.entries(mix).map(([d, n]) => ({ d, p: n }))).d;
}
/* a playable standalone scenario; close calls are preferred (they're the instructive ones) */
export function scenario(E, family, r, opts = {}) {
  const M = E.M;
  for (let tries = 0; tries < 40; tries++) {
    const side = opts.side || (r() < 0.5 ? 'home' : 'away');
    const userBats = FAMILIES[family].side === 'offense';
    const half = (side === 'home') === userBats ? 'bottom' : 'top';
    const inning = opts.inning || (r() < 0.65 ? 6 + Math.floor(r() * 4) : 3 + Math.floor(r() * 3));
    const diffUser = opts.diff != null ? opts.diff : [-2, -1, -1, 0, 0, 0, 1, 1, 2, 3][Math.floor(r() * 10)];   // user's team minus opponent
    const base = 1 + Math.floor(r() * 4);
    const score = side === 'home' ? { home: base + Math.max(0, diffUser), away: base + Math.max(0, -diffUser) } : { away: base + Math.max(0, diffUser), home: base + Math.max(0, -diffUser) };
    if (half === 'bottom' && inning >= 9 && score.home > score.away) continue;    // that game would already be over
    let outs, bases, x;
    const speed = Math.round(Math.min(30.5, Math.max(24, M.speed.mean + M.speed.sd * (r() * 2.4 - 1.2))) * 10) / 10;
    if (family === 'steal') { outs = Math.floor(r() * 3); bases = 1; x = { speed: Math.round((speed + 0.6) * 10) / 10, battery: r() < 0.25 ? 'strong' : r() < 0.33 ? 'weak' : 'avg' }; }
    else if (family === 'steal3') { outs = Math.floor(r() * 2); bases = 2; x = { speed: Math.round((speed + 0.6) * 10) / 10, battery: r() < 0.25 ? 'strong' : r() < 0.33 ? 'weak' : 'avg' }; }
    else if (family === 'bunt') { outs = 0; bases = r() < 0.65 ? 1 : 3; x = { tier: r() < 0.5 ? 'weak' : r() < 0.7 ? 'avg' : 'strong' }; }
    else if (family === 'infield') { outs = r() < 0.7 ? 1 : 0; bases = 4; x = { gb: r() < 0.35 ? 'high' : r() < 0.4 ? 'low' : 'mid', k: r() < 0.3 ? 'high' : r() < 0.35 ? 'low' : 'mid' }; }
    else {
      const pos = ['7', '8', '9'][Math.floor(r() * 3)], arm = Math.round((M.arm[pos].mean + M.arm[pos].sd * (r() * 3 - 1.5)) * 10) / 10;
      if (family === 'send') { outs = Math.floor(r() * 3); bases = r() < 0.7 ? 2 : 3; x = { speed, arm, pos, depth: pickDepth(M, r, 'single', pos), charging: r() < 0.35 }; }
      else if (family === 'send1') { outs = Math.floor(r() * 3); bases = 1; x = { speed, arm, pos, depth: pickDepth(M, r, 'double', pos) }; }
      else { outs = Math.floor(r() * 2); bases = r() < 0.75 ? 4 : 5; x = { speed, arm, pos, depth: pickDepth(M, r, 'fly', pos) }; }
    }
    const state = { inning, half, outs, bases, score };
    const ev = E.evaluate({ family, state, side, x });
    // keep the instructive ones: options within a few points of each other, or a near-break-even go / no-go
    const spread = Math.max(...ev.options.map((o) => o.we)) - Math.min(...ev.options.map((o) => o.we));
    const go = ev.options[0];
    const near = go.success && go.breakEven != null ? Math.abs(go.success.p - go.breakEven) < 0.22 : spread < 0.05;
    if (near || tries > 30 || r() < 0.2) return { family, state, side, x, ev };
  }
}

/* ---------------- a connected game: Manager's Seat ---------------- */
export function createGame(E, { seed = Date.now(), side = 'home', decisions = 10, startInning = 1 } = {}) {
  const r = rng(seed), M = E.M;
  const g = { seed, side, target: decisions, r, made: 0, log: [], plays: [], pending: null,
    teams: { away: makeTeam(M, r, side === 'away' ? 'Your club' : 'Opponent'), home: makeTeam(M, r, side === 'home' ? 'Your club' : 'Opponent') },
    state: { inning: 1, half: 'top', outs: 0, bases: 0, score: { away: 0, home: 0 } }, runners: { 1: null, 2: null, 3: null }, asked: new Set() };
  const opp = (s) => (s === 'home' ? 'away' : 'home');
  const bat = () => g.teams[E.battingSide(g.state)];
  const field = () => g.teams[opp(E.battingSide(g.state))];
  const batter = () => bat().lineup[bat().idx % 9];
  const note = (text, kind = 'play') => g.plays.push({ text, kind, inning: g.state.inning, half: g.state.half, score: { ...g.state.score }, outs: g.state.outs, bases: g.state.bases });
  /* who stands where after a play: lead runners score first; remaining runners fill the occupied bases from the top */
  function moveRunners(prevBases, post, isPA, extra) {
    const cand = [3, 2, 1].filter((b) => prevBases & (1 << (b - 1))).map((b) => g.runners[b]);
    if (isPA) cand.push(batter());
    const left = cand.slice(post.runs), nr = { 1: null, 2: null, 3: null };
    if (post.outs < 3) for (const b of [3, 2, 1]) if (post.bases & (1 << (b - 1))) nr[b] = left.shift() || extra || { name: 'Runner', speed: M.speed.mean };
    g.runners = nr;
  }
  function advanceHalf() {
    if (g.state.outs < 3) return;
    const s = E.nextHalf(g.state);
    g.state = s; g.runners = { 1: null, 2: null, 3: null };
    if (s.bases & 2) g.runners[2] = bat().lineup[(bat().idx + 8) % 9];      // extra innings: the batter before the leadoff man starts on second
    g.asked.clear();
  }
  const userBats = () => E.battingSide(g.state) === side;
  function want(family) {
    if (g.made >= g.target || g.asked.has(family)) return false;
    const li = E.leverage(g.state), late = g.state.inning >= 6;
    const left = Math.max(1, (9 - g.state.inning) * 2 + (g.state.half === 'top' ? 2 : 1));
    const need = (g.target - g.made) / left;            // spread the decisions over the innings that remain
    const seen = g.log.filter((e) => e.family === family).length;
    const variety = family === 'steal' ? 1 / (1 + 1.2 * seen) : 1 / (1 + 0.5 * seen);   // steal chances are the most common: ration them
    return g.r() < Math.min(0.98, Math.max(0.1, (need * 2.6 * Math.sqrt(Math.max(0.3, li)) + (late ? 0.15 : 0)) * variety));
  }
  function ctxFor(family, extra = {}) {
    const s = g.state, b = batter(), x = { ...extra };
    if (family === 'steal') { x.speed = g.runners[1] ? g.runners[1].speed : M.speed.mean; x.battery = field().battery; x.runner = g.runners[1] && g.runners[1].name; }
    if (family === 'steal3') { x.speed = g.runners[2] ? g.runners[2].speed : M.speed.mean; x.battery = field().battery; x.runner = g.runners[2] && g.runners[2].name; }
    if (family === 'bunt') { x.tier = b.tier; x.batter = b.name; }
    if (family === 'infield') { x.gb = b.gb; x.k = b.k; x.batter = b.name; x.tier = b.tier; }
    if (family === 'send' || family === 'tag' || family === 'send1') { const rn = g.runners[{ send: 2, tag: 3, send1: 1 }[family]]; x.speed = rn ? rn.speed : M.speed.mean; x.runner = rn && rn.name; x.arm = field().arms[x.pos]; }
    return { family, state: { ...s, score: { ...s.score } }, side, x, batter: b };
  }
  /* run the game until the user has a decision to make (or the game ends) */
  function step() {
    for (let guard = 0; guard < 400; guard++) {
      advanceHalf();
      if (g.state.final) { g.pending = null; return { type: 'final' }; }
      const s = g.state, off = userBats();
      if (g.state.inning >= startInning) {
        if (off && s.bases === 1 && s.outs === 0 && (batter().tier === 'weak' || (s.inning >= 7 && Math.abs(s.score.home - s.score.away) <= 1)) && want('bunt')) return ask(ctxFor('bunt'));
        if (off && s.bases === 1 && s.outs < 2 && g.runners[1] && want('steal')) return ask(ctxFor('steal'));
        if (off && s.bases === 3 && s.outs === 0 && batter().tier !== 'strong' && want('bunt')) return ask(ctxFor('bunt'));
        if (off && s.bases === 2 && s.outs < 2 && g.runners[2] && want('steal3')) return ask(ctxFor('steal3'));
        if (!off && s.bases === 4 && s.outs < 2 && want('infield')) return ask(ctxFor('infield'));
      }
      // the plate appearance (or a non-PA event such as a wild pitch) from the empirical transitions
      const all = M.transitions[`${s.outs}:${s.bases}`], nonPA = all.filter((x) => x[3] === 0), totAll = all.reduce((a, x) => a + x[4], 0);
      const pNon = nonPA.reduce((a, x) => a + x[4], 0) / totAll;
      if (g.r() < pNon * 0.6) {                          // stolen bases, wild pitches, pickoffs …
        const row = pick(g.r, nonPA, (x) => x[4]);
        const prev = s.bases; g.state = E.applyPost(s, row[0], row[1], row[2]); moveRunners(prev, { outs: row[0], bases: row[1], runs: row[2] }, false);
        if (row[2] || row[0] > s.outs || row[1] !== prev) note(row[2] ? `${row[2]} run${row[2] > 1 ? 's' : ''} score${row[2] > 1 ? '' : 's'} on a wild pitch, passed ball or steal` : row[0] > s.outs ? 'Runner out on the bases' : 'Runners advance');
        continue;
      }
      const tier = batter().tier, rows = M.paTransitions[M.paTransitions[tier][`${s.outs}:${s.bases}`] ? tier : 'all'][`${s.outs}:${s.bases}`];
      const row = pick(g.r, rows, (x) => x[4]), tag = row[3];
      if (off && g.state.inning >= startInning && (tag === 's' || tag === 'f' || tag === 'd')) {
        const fam = { s: 'send', f: 'tag', d: 'send1' }[tag], pos = ['7', '8', '9'][Math.floor(g.r() * 3)];
        if (want(fam)) return ask(ctxFor(fam, { pos, depth: pickDepth(M, g.r, { s: 'single', f: 'fly', d: 'double' }[tag], pos), charging: fam === 'send' && g.r() < 0.35 }));
      }
      const prev = s.bases, b = batter();
      g.state = E.applyPost(s, row[0], row[1], row[2]); moveRunners(prev, { outs: row[0], bases: row[1], runs: row[2] }, true);
      note(describe(s, row, b));
      bat().idx++;
    }
    return { type: 'final' };
  }
  function describe(s, row, b) {
    const [o, bb, runs] = row, outsOn = o - s.outs;
    const who = b.name;
    if (runs >= 4 || (runs && bb === 0 && outsOn === 0 && runs === 1 + ((s.bases & 1) + ((s.bases >> 1) & 1) + ((s.bases >> 2) & 1)))) return `${who} homers${runs > 1 ? ` — ${runs} runs score` : ''}`;
    if (outsOn >= 2) return `${who} hits into a double play${runs ? ` (${runs} run${runs > 1 ? 's' : ''} score${runs > 1 ? '' : 's'})` : ''}`;
    if (outsOn === 1) return `${who} makes an out${runs ? ` — ${runs} run${runs > 1 ? 's' : ''} score${runs > 1 ? '' : 's'}` : bb !== s.bases ? ', runners move up' : ''}`;
    return `${who} reaches${runs ? ` — ${runs} run${runs > 1 ? 's' : ''} score${runs > 1 ? '' : 's'}` : ''}`;
  }
  function ask(ctx) {
    const ev = E.evaluate(ctx);
    g.pending = { ctx, ev }; g.asked.add(ctx.family);
    return { type: 'decision', ctx, ev };
  }
  /* the user's choice: resolve it with the model's probabilities and continue the game state */
  function decide(choiceId) {
    const { ctx, ev } = g.pending, s = g.state, prev = s.bases;
    const gr = E.grade(ev, choiceId), res = E.resolve(ev, choiceId, g.r), o = res.outcome;
    const isPA = ['bunt', 'infield', 'send', 'tag', 'send1'].includes(ctx.family);
    g.state = res.state;
    if (ctx.family === 'tag') {      // the batter flew out; the runner on third either scored, was out, or holds
      const r3 = g.runners[3], nr = { 1: g.runners[1], 2: g.runners[2], 3: null };
      if (choiceId === 'hold') nr[3] = r3;
      g.runners = o.outs >= 3 ? { 1: null, 2: null, 3: null } : nr;
    } else if (ctx.family === 'send') {
      const r2 = g.runners[2], r1 = g.runners[1], nr = { 1: batter(), 2: r1 || null, 3: null };
      if (choiceId === 'hold') nr[3] = r2;
      g.runners = o.outs >= 3 ? { 1: null, 2: null, 3: null } : nr;
    } else if (ctx.family === 'send1') {
      const r1 = g.runners[1], nr = { 1: null, 2: batter(), 3: choiceId === 'hold' ? r1 : null };
      g.runners = o.outs >= 3 ? { 1: null, 2: null, 3: null } : nr;
    } else moveRunners(prev, { outs: o.outs, bases: o.bases, runs: o.runs }, isPA);
    const weAfter = E.weFor(g.state.outs >= 3 ? E.nextHalf(g.state) : g.state, side);
    const entry = { n: ++g.made, family: ctx.family, state: ctx.state, x: ctx.x, options: ev.options.map((q) => ({ id: q.id, label: q.label, we: q.we, re: q.re, p: q.success ? q.success.p : null, be: q.breakEven ?? null })),
      choice: choiceId, best: ev.best, grade: { label: gr.label, tone: gr.tone, lossWE: gr.lossWE }, sensitive: ev.sensitive.length > 0,
      outcome: outcomeText(ctx.state, o), weBefore: ev.weNow, weAfter, expectedWE: gr.choice.we, score: { ...g.state.score } };
    g.log.push(entry);
    note(`${FAMILIES[ctx.family].name}: ${gr.choice.label.toLowerCase()} → ${entry.outcome}`, 'decision');
    if (isPA) bat().idx++;
    g.pending = null;
    return { entry, grade: gr, outcome: o, state: g.state };
  }
  function describeOutcome(s, o) {
    const outsOn = o.outs - s.outs;
    if (o.success === true) return 'Safe — the runner makes it';
    if (o.success === false) return 'Caught — the runner is out';
    return `${outsOn ? outsOn + ' out' + (outsOn > 1 ? 's' : '') : 'no out'}${o.runs ? `, ${o.runs} run${o.runs > 1 ? 's' : ''} score${o.runs > 1 ? '' : 's'}` : ''} · ${BASE_NAMES[o.outs >= 3 ? 0 : o.bases].toLowerCase()}`;
  }
  /* finish without more decisions */
  function simToEnd() { g.target = g.made; let s; do s = step(); while (s.type !== 'final'); return s; }
  return { g, step, decide, simToEnd, batter, userBats, describeOutcome };
}
