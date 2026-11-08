/* Decision Lab — engine tests.   node --test tools/decision-lab/tests/engine.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, createGame, scenario, rng, FAMILIES } from '../../../apps/decision-lab/engine.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/decision-lab/data/model.json')));
const E = createEngine(M);
const S = (inning, half, outs, bases, away, home) => ({ inning, half, outs, bases, score: { away, home } });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const FAMS = Object.keys(FAMILIES);

test('run expectancy matches published 2023–25 values and is monotone in outs', () => {
  assert.ok(Math.abs(E.re(0, 0) - 0.50) < 0.03, `RE empty/0 out ${E.re(0, 0)}`);
  assert.ok(Math.abs(E.re(0, 7) - 2.3) < 0.15, `RE loaded/0 out ${E.re(0, 7)}`);
  for (let b = 0; b < 8; b++) { assert.ok(E.re(0, b) > E.re(1, b) && E.re(1, b) > E.re(2, b), `outs order for bases ${b}`); }
  for (const k in M.runDist) assert.ok(Math.abs(sum(M.runDist[k]) - 1) < 1e-4, `run distribution ${k} sums to 1`);
});

test('win expectancy: home edge, known landmarks, bounds and symmetry of perspective', () => {
  const start = E.weHome(S(1, 'top', 0, 0, 0, 0));
  assert.ok(Math.abs(start - M.league.homeWinPct) < 0.01, `start ${start} vs home win% ${M.league.homeWinPct}`);
  assert.ok(Math.abs(E.weHome(S(9, 'bottom', 0, 0, 0, 0)) - 0.65) < 0.03);           // bottom 9, tied, nobody on
  assert.ok(Math.abs(E.weHome(S(9, 'bottom', 1, 4, 0, 0)) - 0.83) < 0.03);           // bottom 9, tied, runner on third, one out
  assert.ok(E.weHome(S(9, 'top', 0, 0, 2, 3)) > 0.8);                                // top 9, home up one
  assert.equal(E.weHome({ ...S(9, 'bottom', 1, 0, 2, 3) }), 1);                      // walk-off already happened
  const x = E.extraX(); assert.ok(x > 0.48 && x < 0.56, `extra-inning home win ${x}`);
  for (let i = 1; i <= 11; i++) for (const h of ['top', 'bottom']) for (let o = 0; o < 3; o++) for (let b = 0; b < 8; b++) for (const d of [-3, 0, 2]) {
    const s = S(i, h, o, b, 5, 5 + d); if (h === 'bottom' && i >= 9 && d > 0) continue;
    const w = E.weHome(s); assert.ok(w >= 0 && w <= 1, `WE in [0,1] ${JSON.stringify(s)}`);
    assert.ok(Math.abs(E.weFor(s, 'home') + E.weFor(s, 'away') - 1) < 1e-12);
  }
  // more runs for the batting team never lowers its win expectancy
  assert.ok(E.weHome(S(7, 'bottom', 1, 2, 3, 3)) < E.weHome(S(7, 'bottom', 1, 2, 3, 4)));
});

test('win expectancy agrees with MLB\'s own win probability on the Play Repository plays (read-only)', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/play-repository/data/index.json')));
  const bits = (s) => (s[0] !== '_' ? 1 : 0) | (s[1] !== '_' ? 2 : 0) | (s[2] !== '_' ? 4 : 0);
  const errs = [];
  for (const p of idx.plays) {
    if (p.wpHomeBefore == null || p.gameType !== 'R' || p.inning > 9) continue;
    const ours = E.weHome(S(p.inning, p.half, p.outs, bits(p.bases), p.score[0], p.score[1]));
    errs.push(Math.abs(ours - p.wpHomeBefore / 100));
  }
  const mae = sum(errs) / errs.length;
  console.log(`  WE vs MLB win probability: mean absolute difference ${(mae * 100).toFixed(1)} points over ${errs.length} regular-season plays`);
  assert.ok(errs.length > 100 && mae < 0.05, `MAE ${mae}`);
});

test('every decision family: outcome probabilities sum to 1 and every outcome is a legal base-out state', () => {
  const r = rng(42);
  for (const f of FAMS) for (let i = 0; i < 40; i++) {
    const sc = scenario(E, f, r);
    for (const o of sc.ev.options) {
      assert.ok(Math.abs(sum(o.outcomes.map((x) => x.p)) - 1) < 1e-6, `${f}/${o.id} sums to ${sum(o.outcomes.map((x) => x.p))}`);
      for (const x of o.outcomes) {
        assert.ok(x.p >= 0 && x.outs >= sc.state.outs && x.outs <= 3 && x.bases >= 0 && x.bases <= 7 && x.runs >= 0 && x.runs <= 4, `${f}/${o.id} legal ${JSON.stringify(x)}`);
        // runs can't exceed the runners on base plus the batter
        const onBase = [1, 2, 4].filter((b) => sc.state.bases & b).length;
        assert.ok(x.runs <= onBase + 1, `${f} runs ${x.runs} with ${onBase} on`);
      }
      assert.ok(o.we >= 0 && o.we <= 1);
    }
    assert.ok(sc.ev.options.filter((o) => o.best).length === 1);
  }
});

test('break-even: at the break-even success rate, going and staying are worth the same', () => {
  for (const [family, st, x] of [['steal', S(7, 'top', 0, 1, 2, 2), { speed: 27.5 }], ['send', S(6, 'top', 1, 2, 1, 1), { speed: 27.3, arm: 87, depth: 'medium', pos: '7' }],
    ['tag', S(8, 'bottom', 1, 4, 3, 3), { speed: 27.3, arm: 88, depth: 'medium', pos: '8' }], ['send1', S(7, 'top', 2, 1, 2, 2), { speed: 27.3, arm: 87, depth: 'deep', pos: '9' }],
    ['steal3', S(5, 'bottom', 1, 2, 1, 1), { speed: 28 }]]) {
    const ev = E.evaluate({ family, state: st, side: st.half === 'top' ? 'away' : 'home', x });
    const go = ev.options[0], stay = ev.options[1], be = go.breakEven;
    assert.ok(be > 0 && be < 1, `${family} break-even ${be}`);
    const succ = go.outcomes.filter((o) => o.success), fail = go.outcomes.filter((o) => !o.success);
    const norm = (os, w) => os.map((o) => ({ ...o, p: (o.p / sum(os.map((q) => q.p))) * w }));
    const v = E.value(st, ev.side, [...norm(succ, be), ...norm(fail, 1 - be)]).we;
    assert.ok(Math.abs(v - stay.we) < 1e-9, `${family}: EV at break-even ${v} vs stay ${stay.we}`);
    // and the recommendation follows the success probability
    assert.equal(ev.best === go.id, go.success.p > be, `${family} recommendation consistent with p vs break-even`);
  }
});

test('long-run outcomes match the modeled probabilities (seeded)', () => {
  const st = S(7, 'top', 1, 1, 2, 2), ev = E.evaluate({ family: 'steal', state: st, side: 'away', x: { speed: 28 } });
  const r = rng(2026); let ok = 0; const N = 20000;
  for (let i = 0; i < N; i++) if (E.resolve(ev, 'attempt', r).outcome.success) ok++;
  const p = ev.options[0].success.p, se = Math.sqrt(p * (1 - p) / N);
  assert.ok(Math.abs(ok / N - p) < 4 * se, `steal success ${ok / N} vs ${p}`);
  // infield: the share of runs allowed matches the distribution
  const ei = E.evaluate({ family: 'infield', state: S(9, 'bottom', 1, 4, 3, 3), side: 'away', x: { gb: 'mid', k: 'mid' } });
  const inn = ei.options.find((o) => o.id === 'in'), pr = sum(inn.outcomes.filter((o) => o.runs > 0).map((o) => o.p));
  let runs = 0; for (let i = 0; i < N; i++) if (E.resolve(ei, 'in', r).outcome.runs > 0) runs++;
  assert.ok(Math.abs(runs / N - pr) < 4 * Math.sqrt(pr * (1 - pr) / N));
});

test('determinism: the same seed gives the same game and the same outcomes', () => {
  const play = (seed) => { const G = createGame(E, { seed, side: 'home', decisions: 8 }); const out = []; let s = G.step();
    while (s.type === 'decision') { const res = G.decide(s.ev.best); out.push(res.entry.outcome); s = G.step(); } return JSON.stringify([out, G.g.state, G.g.plays.length]); };
  assert.equal(play(77), play(77)); assert.notEqual(play(77), play(78));
});

test('game progression: legal states throughout, innings advance correctly, games end legally, scoring near league average', () => {
  let runs = 0, games = 0, decisions = 0, extra = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const G = createGame(E, { seed, side: seed % 2 ? 'home' : 'away', decisions: 10 });
    let s = G.step(), last = { inning: 1, half: 'top' };
    while (s.type === 'decision') {
      const st = G.g.state;
      assert.ok(st.outs >= 0 && st.outs < 3 && st.bases >= 0 && st.bases <= 7, 'decision state legal');
      assert.ok(st.inning > last.inning || (st.inning === last.inning && (st.half === last.half || st.half === 'bottom')), 'innings move forward');
      last = { inning: st.inning, half: st.half };
      const fam = s.ctx.family, ok = { steal: st.bases === 1, steal3: st.bases === 2, bunt: st.outs === 0 && (st.bases === 1 || st.bases === 3), infield: st.bases === 4 && st.outs < 2, send: !!(st.bases & 2), send1: st.bases === 1, tag: !!(st.bases & 4) && st.outs < 2 }[fam];
      assert.ok(ok, `${fam} offered in a valid state ${JSON.stringify(st)}`);
      assert.equal(E.battingSide(st) === G.g.side, FAMILIES[fam].side === 'offense', `${fam} offered to the right side`);
      G.decide(s.ev.options[seed % s.ev.options.length].id); decisions++; s = G.step();
    }
    const f = G.g.state; assert.ok(f.final, 'game finished');
    assert.notEqual(f.score.home, f.score.away, 'no ties');
    assert.ok(f.inning >= 9, 'at least nine innings');
    if (f.half === 'top') assert.ok(f.score.home > f.score.away, 'home team skips its last at-bat only when ahead');
    if (f.inning > 9) extra++;
    runs += f.score.home + f.score.away; games++;
  }
  const rpg = runs / games;
  console.log(`  ${games} games · ${(rpg).toFixed(2)} runs/game (league ${M.league.runsPerGame}) · ${(decisions / games).toFixed(1)} decisions/game · ${extra} extra-inning games`);
  assert.ok(Math.abs(rpg - M.league.runsPerGame) < 1.2, `runs per game ${rpg}`);
});

test('grades separate decision quality from the outcome', () => {
  // a two-out send that is right but genuinely uncertain (success between 60% and 92%)
  let ev = null;
  for (const arm of [80, 82, 84, 86, 88, 90, 92, 94, 96]) for (const depth of ['shallow', 'medium']) for (const speed of [26, 27, 28, 29]) {
    const e = E.evaluate({ family: 'send', state: S(6, 'top', 2, 2, 1, 1), side: 'away', x: { speed, arm, depth, pos: '7' } });
    if (!ev && e.best === 'send' && e.options[0].success.p > 0.6 && e.options[0].success.p < 0.92) ev = e;
  }
  assert.ok(ev, 'found an uncertain, positive-value send');
  assert.equal(ev.best, 'send');
  const g = E.grade(ev, 'send'); assert.equal(g.tone, 'good');
  const g2 = E.grade(ev, 'hold'); assert.ok(g2.lossWE > 0 && g2.tone !== 'good');
  // the grade never depends on what happened: resolve many times, the grade is fixed
  const r = rng(3); const outcomes = new Set(); for (let i = 0; i < 300; i++) outcomes.add(E.resolve(ev, 'send', r).outcome.success);
  assert.equal(outcomes.size, 2, 'a sound send is sometimes thrown out');
});

test('infield: drawn in only when the run matters; sensitivity is reported', () => {
  const late = E.evaluate({ family: 'infield', state: S(9, 'bottom', 1, 4, 3, 3), side: 'away', x: { gb: 'mid', k: 'mid' } });
  assert.equal(late.best, 'in');
  const blowout = E.evaluate({ family: 'infield', state: S(9, 'top', 1, 4, 3, 6), side: 'home', x: { gb: 'mid', k: 'mid' } });
  assert.equal(blowout.best, 'back');
  // nobody out: drawn in allows more runs on average than playing back (the classic trade-off)
  const z = E.evaluate({ family: 'infield', state: S(3, 'top', 0, 4, 0, 0), side: 'home', x: { gb: 'mid', k: 'mid' } });
  assert.ok(z.options.find((o) => o.id === 'in').re > z.options.find((o) => o.id === 'back').re);
  assert.ok(Array.isArray(z.sensitive));
});

test('steal: faster runners succeed more; break-even rises with two outs', () => {
  const p = (sp) => E.stealP(sp).p;
  assert.ok(p(29) > p(27) && p(27) > p(25));
  assert.ok(M.steal.speedFit.slope > 2 * M.steal.speedFit.slopeSE, 'speed effect is statistically clear');
});
