/* Decision Lab — app shell: Home · Manager's Seat · Third-Base Coach's Seat · Quick Decision · Decision Matrix ·
   Film Room · Performance · The Model. Everything runs in the browser from data/model.json and data/film.json. */
import { createEngine, createGame, scenario, rng, FAMILIES, BASE_NAMES, ord, outcomeText } from './engine.js';
import { fieldSVG, drawSituation, playUpTo, playOutcome, playSimple } from './field.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 0) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
const pts = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);   // win-probability points
const app = $('#app');
let E, FILM, M;
const STORE = 'decision-lab:v1';

/* ---------------- persistence: decisions and sessions (this browser) ---------------- */
function load() { try { return JSON.parse(localStorage.getItem(STORE)) || { decisions: [], sessions: [] }; } catch (e) { return { decisions: [], sessions: [] }; } }
function save(d) { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) { /* private window: performance just isn't kept */ } }
function record(sessionId, mode, entry) {
  const d = load();
  d.decisions.push({ t: Date.now(), session: sessionId, mode, family: entry.family, choice: entry.choice, best: entry.best, lossWE: entry.grade.lossWE, tone: entry.grade.tone,
    sensitive: entry.sensitive, realized: entry.realized, expected: entry.expectedWE, before: entry.weBefore });
  if (d.decisions.length > 3000) d.decisions = d.decisions.slice(-3000);
  save(d);
}
function startSession(mode, meta = {}) { const d = load(), id = 's' + Date.now().toString(36); d.sessions.push({ id, mode, started: Date.now(), ...meta }); save(d); return id; }
function endSession(id, meta) { const d = load(), s = d.sessions.find((x) => x.id === id); if (s) Object.assign(s, { ended: Date.now(), ...meta }); save(d); }

/* ---------------- words for players and situations ---------------- */
function speedWord(s) { return s >= 29 ? 'Plus runner' : s >= 28 ? 'Above-average runner' : s >= 26.6 ? 'Average runner' : s >= 25.6 ? 'Below-average runner' : 'Slow runner'; }
function armWord(arm, pos) { const a = M.arm[pos] || M.arm['8'], z = (arm - a.mean) / a.sd; return z >= 1 ? 'Strong arm' : z >= 0.35 ? 'Above-average arm' : z > -0.35 ? 'Average arm' : z > -1 ? 'Below-average arm' : 'Weak arm'; }
const TIER = { weak: 'Light-hitting', avg: 'Average hitter', strong: 'Dangerous hitter' };
const GB = { high: 'heavy ground-ball hitter', mid: 'average ground-ball rate', low: 'fly-ball hitter' };
const KK = { high: 'strikes out a lot', mid: 'average strikeout rate', low: 'rarely strikes out' };
const POSN = { '7': 'left field', '8': 'center field', '9': 'right field' };
const DEPTHW = { shallow: 'shallow', medium: 'medium-depth', deep: 'deep' };
const BATTERY = { strong: 'Strong-throwing catcher, quick to the plate', avg: 'Average battery', weak: 'Weak-throwing catcher / slow delivery' };
function half(s) { return `${s.half === 'top' ? 'Top' : 'Bottom'} ${ord(s.inning)}`; }
function scoreLine(s, side) {
  const us = s.score[side], them = s.score[side === 'home' ? 'away' : 'home'];
  return us === them ? `Tied ${us}–${them}` : us > them ? `You lead ${us}–${them}` : `You trail ${us}–${them}`;
}
function outsWord(o) { return `${o} out${o === 1 ? '' : 's'}`; }
function diamondMini(bases, outs) {
  const b = (x, y, on) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${x} ${y})" class="${on ? 'on' : ''}"/>`;
  return `<svg class="mini" viewBox="0 0 80 64" aria-label="${esc(BASE_NAMES[bases])}, ${outsWord(outs)}">${b(58, 34, bases & 1)}${b(40, 16, bases & 2)}${b(22, 34, bases & 4)}
    ${[0, 1, 2].map((i) => `<circle cx="${28 + i * 12}" cy="58" r="4" class="${i < outs ? 'on' : ''}"/>`).join('')}</svg>`;
}
function situationHTML(ctx, { compact = false } = {}) {
  const s = ctx.state, x = ctx.x || {}, f = FAMILIES[ctx.family], userBats = (s.half === 'top') === (ctx.side === 'away');
  const people = [];
  if (['steal', 'steal3'].includes(ctx.family)) {
    people.push(['Runner', `${x.runner ? esc(x.runner) + ' · ' : ''}${speedWord(x.speed)} <span class="num">${x.speed.toFixed(1)} ft/s</span>`]);
    people.push(['Battery', BATTERY[x.battery || 'avg']]);
  }
  if (ctx.family === 'bunt') people.push(['Batter', `${x.batter ? esc(x.batter) + ' · ' : ''}${TIER[x.tier || 'avg']}`]);
  if (ctx.family === 'infield') people.push(['Batter', `${x.batter ? esc(x.batter) + ' · ' : ''}${TIER[x.tier || 'avg']}, ${GB[x.gb || 'mid']}, ${KK[x.k || 'mid']}`]);
  if (['send', 'send1', 'tag'].includes(ctx.family)) {
    people.push(['Runner', `${x.runner ? esc(x.runner) + ' · ' : ''}${speedWord(x.speed)} <span class="num">${x.speed.toFixed(1)} ft/s</span>`]);
    people.push(['Ball', `${ctx.family === 'tag' ? 'Fly ball caught in' : ctx.family === 'send1' ? 'Double to' : 'Single to'} ${DEPTHW[x.depth]} ${POSN[x.pos]}${x.charging ? ' — outfielder charging hard' : ''}`]);
    people.push(['Outfielder', `${armWord(x.arm, x.pos)} <span class="num">${x.arm.toFixed(1)} mph</span>`]);
  }
  return `<div class="sit">
    <div class="sit-top"><div class="sit-inn"><b>${half(s)}</b><span>${outsWord(s.outs)}</span></div>${diamondMini(s.bases, s.outs)}
      <div class="sit-sc"><b>${esc(scoreLine(s, ctx.side))}</b><span>${userBats ? 'You are batting' : 'You are in the field'} · ${ctx.side === 'home' ? 'home team' : 'visitors'}</span></div></div>
    <div class="sit-run">${esc(BASE_NAMES[s.bases])}</div>
    ${compact ? '' : `<dl class="sit-pp">${people.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`}
    ${ctx.hypothetical !== false ? '<p class="hyp">Hypothetical players · ratings drawn from MLB 2023–25 distributions (Statcast sprint speed and arm strength)</p>' : ''}</div>`;
}

/* ---------------- the assessment: decision quality and outcome, kept apart ---------------- */
function explain(ev, choiceId) {
  const o = ev.options, best = o.find((q) => q.best), ch = o.find((q) => q.id === choiceId), fam = ev.family, go = o[0];
  const diff = Math.abs(o[0].we - o[1].we);
  if (go.success && go.breakEven >= 0.985) {
    return `With ${ev.state.outs === 0 ? 'nobody out' : 'this many outs'}, ${o[1].label.toLowerCase()} leaves you so likely to score anyway that even a near-certain ${go.label.toLowerCase()} gains little or nothing: the break-even is about 100%. Estimated success ${pct(go.success.p)}; ${best.label.toLowerCase()} is better by ${pts(diff)} points of win probability.`;
  }
  if (go.success) {
    const verdict = go.success.p >= go.breakEven ? `above the ${pct(go.breakEven)} break-even, so ${go.label.toLowerCase()} is worth ${pts(go.we - o[1].we)} points of win probability against ${o[1].label.toLowerCase()}`
      : `below the ${pct(go.breakEven)} break-even, so ${o[1].label.toLowerCase()} is worth ${pts(o[1].we - go.we)} points of win probability against ${go.label.toLowerCase()}`;
    return `Estimated success ${pct(go.success.p)} (plausible range ${pct(go.success.low)}–${pct(go.success.high)}) — ${verdict}.`;
  }
  if (fam === 'bunt') return `${best.id === 'bunt' ? 'Bunting' : 'Swinging away'} is worth ${pts(diff)} points over the alternative here. A bunt trades an out for a base: it helps most when one run matters and the hitter is weak; with a good hitter, the out costs more than the base is worth.`;
  if (fam === 'infield') {
    const g = E.gbOutcomes(ev.state.outs, 'in'), gb = E.gbOutcomes(ev.state.outs, 'back');
    return `Drawn in, a ground ball gets through ${pct(g[0].p)} of the time (vs ${pct(gb[0].p)} back), but the runner scores on only ${pct(M.assumptions.infield_in_score_on_gb_out.value)} of ground-ball outs (vs ${pct(M.assumptions.infield_back_score_on_gb_out.value)} back). ${best.label} is best by ${pts(diff)} points: ${ev.state.inning >= 7 && Math.abs(ev.state.score.home - ev.state.score.away) <= 1 ? 'late and close, the single run decides more games than the extra baserunners do.' : 'the bigger the cushion and the earlier the inning, the more the extra hits through a drawn-in infield cost.'}`;
  }
  return '';
}
function feedbackHTML(ev, res, opts = {}) {
  const gr = res.grade, ch = gr.choice, best = gr.best, o = res.outcome;
  const realized = res.realized, expected = ch.we, luck = realized - expected;
  const oc = o.success === true ? 'good' : o.success === false ? 'bad' : luck >= 0 ? 'good' : 'bad';
  const verdict = gr.tone === 'good' ? (oc === 'good' ? 'Good decision, good result.' : 'Good decision, bad result — it happens; the decision was still right.')
    : (oc === 'good' ? 'It worked — but the odds were against this choice. Don’t count on it next time.' : 'The odds were against this choice, and it didn’t work.');
  const sens = ev.sensitive.length ? `<p class="sens">Close call: inside the model's uncertainty the preferred option changes (${ev.sensitive.map((f) => `${esc(M.assumptions[f.key] ? f.key.replace(/_/g, ' ') : f.key)} = ${f.value}`).join(', ')}).</p>` : '';
  return `<section class="fb">
    <div class="fb-grid">
      <div class="fb-box q ${gr.tone}"><div class="k">DECISION QUALITY</div><b>${esc(gr.label)}</b>
        <p>Your call: <b>${esc(ch.label)}</b>${ch.best ? ' — the model’s preferred option' : ` · the model prefers <b>${esc(best.label)}</b> (${pts(-gr.lossWE)} win prob.)`}.</p>
        ${ch.success ? `<p class="num-line">Estimated success <b>${pct(ch.success.p)}</b> · break-even <b>${ch.breakEven >= 0.985 ? '≈100%' : pct(ch.breakEven)}</b></p>` : ''}</div>
      <div class="fb-box o ${oc}"><div class="k">WHAT HAPPENED</div><b>${esc(outcomeText(ev.state, o))}</b>
        <p>Win probability ${pct(ev.weNow, 1)} → <b>${pct(realized, 1)}</b> <span class="muted">(this choice averages ${pct(expected, 1)})</span></p></div>
    </div>
    <p class="verdict">${esc(verdict)}</p>
    <p class="why"><b>Why.</b> ${esc(explain(ev, ch.id))}</p>${sens}
    <details class="analysis"><summary>The analysis</summary>${analysisHTML(ev)}</details>
    ${opts.whatIf !== false ? whatIfHTML(ev) : ''}
    ${filmHTML(ev.family, o)}
  </section>`;
}
function analysisHTML(ev) {
  return `<table class="tbl"><thead><tr><th>Option</th><th class="n">Win prob.</th><th class="n">vs best</th><th class="n">Exp. runs</th><th class="n">Success</th><th class="n">Break-even</th></tr></thead><tbody>
    ${ev.options.map((o) => `<tr class="${o.best ? 'best' : ''}"><td>${esc(o.label)}${o.best ? ' <span class="tag">BEST</span>' : ''}</td><td class="n">${pct(o.we, 1)}</td><td class="n">${o.best ? '—' : pts(o.dWE)}</td>
      <td class="n">${o.re.toFixed(2)}</td><td class="n">${o.success ? pct(o.success.p) : '—'}</td><td class="n">${o.breakEven != null ? pct(o.breakEven) : '—'}</td></tr>`).join('')}</tbody></table>
    <p class="note">Win probability is for your team, from Retrosheet 2023–25 run distributions (home team bats last; extra innings start with a runner on second). Expected runs are for the batting team through the end of the inning. ${modelNote(ev.family)}</p>`;
}
function modelNote(f) {
  const A = M.assumptions;
  return {
    steal: `Success: logistic fit of steal success on Statcast sprint speed (${M.steal.speedFit.attempts.toLocaleString()} attempts, ${M.steal.speedFit.players} player-seasons); battery adjustment ±${pct(A.steal_catcher_effect.value)} is an assumption.`,
    steal3: `Success: the same sprint-speed fit, shifted to the league rate for steals of third (${pct(E.st3.rate)} of ${E.st3.att} attempts).`,
    bunt: `Bunt outcomes: every bunt put in play from this base-out state (Retrosheet); ${pct(A.bunt_fail.value)} of attempts are assumed to fail before one is put in play. Swing away: this hitter tier's plate appearances from the same state.`,
    infield: `Ground balls: hit rate with the infield back from two-out plays (${pct(M.bipControl['r3_2out:GB'].hit, 1)}); drawn-in effects derived from the observed difference with fewer than two outs (assumes infields are in ${pct(A.infield_in_usage.value)} of the time). Runner-scoring shares are assumptions — see The Model.`,
    send: `Success: a timing model of the throw home (preliminary), fitted to Retrosheet's two-out send and out-at-home rates; ${pct(A.throw_miss.value)} of throws assumed off-line.`,
    send1: `Success: a timing model of the relay home (preliminary), fitted to Retrosheet's two-out send rates from first on doubles.`,
    tag: `Success: a timing model of the throw home after the catch (preliminary), fitted to Retrosheet's tag-up rates.`,
  }[f] || '';
}
/* recompute one variable at a time */
function variants(ev) {
  const s = ev.state, x = ev.x, side = ev.side, out = [];
  const flipHome = () => { const ns = { ...s, half: s.half === 'top' ? 'bottom' : 'top', score: { home: s.score.away, away: s.score.home } }; return { state: ns, side: side === 'home' ? 'away' : 'home' }; };
  const userLead = (d) => { const them = side === 'home' ? 'away' : 'home', base = Math.min(s.score.home, s.score.away); return { state: { ...s, score: { [side]: base + Math.max(0, d), [them]: base + Math.max(0, -d) } } }; };
  const late = () => ({ state: { ...s, inning: 9 } });
  if (['send', 'send1', 'tag'].includes(ev.family)) {
    out.push(['A stronger arm (+6 mph)', { x: { ...x, arm: x.arm + 6 } }], ['A weaker arm (−6 mph)', { x: { ...x, arm: x.arm - 6 } }], ['A faster runner (+1.5 ft/s)', { x: { ...x, speed: x.speed + 1.5 } }]);
    if (ev.family !== 'tag') out.push([s.outs === 2 ? 'One out instead of two' : 'Two outs', { state: { ...s, outs: s.outs === 2 ? 1 : 2 } }]);
    if (ev.family === 'send') out.push([x.charging ? 'Outfielder not charging' : 'Outfielder charging hard', { x: { ...x, charging: !x.charging } }]);
    out.push([x.depth === 'deep' ? 'Ball not as deep' : 'Ball hit deeper', { x: { ...x, depth: x.depth === 'deep' ? 'medium' : x.depth === 'medium' ? 'deep' : 'medium' } }]);
  }
  if (ev.family === 'steal' || ev.family === 'steal3') out.push(['A faster runner (+1.5 ft/s)', { x: { ...x, speed: x.speed + 1.5 } }], ['A slower runner (−1.5 ft/s)', { x: { ...x, speed: x.speed - 1.5 } }], ['A strong-throwing catcher', { x: { ...x, battery: 'strong' } }], [s.outs === 2 ? 'Nobody out' : 'Two outs', { state: { ...s, outs: s.outs === 2 ? 0 : 2 } }]);
  if (ev.family === 'bunt') out.push(['A dangerous hitter at the plate', { x: { ...x, tier: 'strong' } }], ['A light-hitting batter', { x: { ...x, tier: 'weak' } }]);
  if (ev.family === 'infield') out.push(['A heavy ground-ball hitter', { x: { ...x, gb: 'high' } }], ['A hitter who strikes out a lot', { x: { ...x, k: 'high', gb: 'low' } }], [s.outs === 1 ? 'Nobody out' : 'One out', { state: { ...s, outs: s.outs === 1 ? 0 : 1 } }]);
  out.push(['Tie game', userLead(0)], ['Up by three', userLead(3)], ['Ninth inning', late()], [side === 'home' ? 'If we were the visitors' : 'If we were the home team', flipHome()]);
  return out;
}
function whatIfHTML(ev) {
  return `<div class="whatif"><div class="k">WHAT IF…</div><div class="wi-btns">${variants(ev).map(([label], i) => `<button class="chip" data-wi="${i}">${esc(label)}</button>`).join('')}</div><div class="wi-out" aria-live="polite"></div></div>`;
}
function bindWhatIf(root, ev) {
  const vs = variants(ev);
  $$('[data-wi]', root).forEach((b) => (b.onclick = () => {
    $$('[data-wi]', root).forEach((x) => x.classList.toggle('on', x === b));
    const [label, ch] = vs[+b.dataset.wi];
    const nev = E.evaluate({ family: ev.family, state: ch.state || ev.state, side: ch.side || ev.side, x: ch.x || ev.x });
    const nb = nev.options.find((o) => o.best), ob = ev.options.find((o) => o.best);
    $('.wi-out', root).innerHTML = `<p><b>${esc(label)}:</b> ${nb.id === ob.id ? `still <b>${esc(nb.label)}</b>` : `the call changes to <b>${esc(nb.label)}</b>`}.
      ${nev.options.map((o) => `${esc(o.label)} ${pct(o.we, 1)}${o.success ? ` (success ${pct(o.success.p)}, break-even ${pct(o.breakEven)})` : ''}`).join(' · ')}${nev.sensitive.length ? ' · close call' : ''}</p>`;
  }));
}
/* real plays that illustrate this kind of outcome (never this game's play) */
const OUTCOME_FOR = (fam, o) => {
  if (['send', 'send1', 'tag'].includes(fam)) return o.success === true ? 'scored' : o.success === false ? 'out_home' : 'held';
  if (fam === 'steal' || fam === 'steal3') return o.success ? 'safe' : 'caught';
  if (fam === 'infield') return o.runs > 0 && o.type === 'GB' && o.outs > 0 ? 'scored_on_out' : /home/i.test(o.what || '') ? 'out_home' : /single|gets through|error/i.test(o.what || '') ? 'hit_through' : /holds/i.test(o.what || '') ? 'held_on_out' : null;
  if (fam === 'bunt') return o.what && /fails/.test(o.what) ? null : 'sacrifice';
  return null;
};
function filmFor(fam, outcome) {
  const all = FILM.films.filter((f) => f.families.some((x) => x.family === fam));
  const exact = outcome ? all.filter((f) => f.families.some((x) => x.family === fam && x.outcome === outcome)) : [];
  return { exact, all };
}
function filmCard(f, fam) {
  const x = f.families.find((y) => y.family === fam) || f.families[0];
  return `<button class="film" data-film="${esc(f.id)}"><span class="thumb" style="background-image:url('${esc(f.thumb)}')"><span class="play">▶</span></span>
    <span class="fm-b"><span class="fm-k">REAL PLAY · ${esc(f.date)}</span><b>${esc(f.title)}</b><span class="fm-s">${esc(f.away.abbr)} @ ${esc(f.home.abbr)} · ${f.before.half === 'top' ? 'Top' : 'Bot'} ${ord(f.before.inning)} · ${outsWord(f.before.outs)} · ${esc(x.outcomeLabel)}</span></span></button>`;
}
function filmHTML(fam, o) {
  const { exact, all } = filmFor(fam, OUTCOME_FOR(fam, o));
  const show = (exact.length ? exact : all).slice(0, 3);
  if (!show.length) return '';
  return `<div class="filmrow"><div class="k">FROM THE FILM ROOM <span class="muted">— real MLB plays of this kind${exact.length ? ' with this outcome' : ''}. They did not happen in your game.</span></div><div class="films">${show.map((f) => filmCard(f, fam)).join('')}</div></div>`;
}
function openFilm(id) {
  const f = FILM.films.find((x) => x.id === id); if (!f) return;
  const v = f.video.highHome || f.video.broadcast;
  const m = $('#modal'), sc = $('#scrim');
  m.innerHTML = `<header><div><div class="k">REAL PLAY · ${esc(f.date)} · ${esc(f.away.name)} at ${esc(f.home.name)}</div><h2 id="modalTitle">${esc(f.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></header>
    <div class="mb">${v ? `<div class="vid"><iframe src="${esc(v.embedUrl)}" title="MLB video" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>` : ''}
      <p class="cap">${esc(v ? v.label : '')}${f.video.highHome && f.video.broadcast ? ' · also on <a href="' + esc(f.video.broadcast.pageUrl) + '" target="_blank" rel="noopener">MLB.com (broadcast)</a>' : ''}</p>
      <dl class="ctx"><dt>Situation before the play</dt><dd>${f.before.half === 'top' ? 'Top' : 'Bottom'} ${ord(f.before.inning)} · ${outsWord(f.before.outs)} · ${esc(BASE_NAMES[(f.before.bases[0] !== '_' ? 1 : 0) | (f.before.bases[1] !== '_' ? 2 : 0) | (f.before.bases[2] !== '_' ? 4 : 0)])} · ${esc(f.away.abbr)} ${f.before.score.away}, ${esc(f.home.abbr)} ${f.before.score.home}</dd>
        <dt>Matchup</dt><dd>${esc(f.batter)} vs ${esc(f.pitcher)}</dd><dt>What happened (MLB's record)</dt><dd>${esc(f.description)}</dd>
        <dt>Illustrates</dt><dd>${f.families.map((x) => `${esc(FAMILIES[x.family].name)} — ${esc(x.outcomeLabel)}`).join('<br>')}</dd>
        ${f.ifAlign ? `<dt>Infield alignment (Statcast)</dt><dd>${esc(f.ifAlign)} <span class="muted">— Statcast doesn't record whether an infield was drawn in</span></dd>` : ''}</dl>
      <p class="note">A real play from Play Repository, shown as an example of this kind of situation and outcome. It is not a replay of a simulated decision. <a href="${esc(f.playRepository)}" target="_blank" rel="noopener">Open in Play Repository ↗</a> · <a href="${esc((f.video.broadcast || v).pageUrl)}" target="_blank" rel="noopener">MLB.com ↗</a></p></div>`;
  sc.hidden = false; m.querySelector('[data-close]').focus();
}
function closeModal() { const sc = $('#scrim'); sc.hidden = true; $('#modal').innerHTML = ''; }

/* ---------------- one decision on screen: situation → choice → outcome → assessment ---------------- */
async function decisionScreen(host, ctx, ev, { onResolved, resolveWith, seat, timer = 0, label = '' }) {
  const f = FAMILIES[ctx.family], third = ['send', 'send1', 'tag'].includes(ctx.family);
  host.innerHTML = `<article class="dec">
    <div class="dec-l"><div class="fieldbox"></div>${situationHTML(ctx)}</div>
    <div class="dec-r"><div class="k">${esc(label || f.name.toUpperCase())}</div><h2 class="q">${esc(f.q)}</h2>
      <div class="choices">${ev.options.map((o) => `<button class="choice" data-c="${o.id}">${esc(o.label)}</button>`).join('')}</div>
      ${timer ? `<div class="clock"><i></i><span>Decide in <b>${timer}</b> s</span></div>` : ''}
      <p class="hint">Decide first — the numbers come after.</p><div class="after"></div></div></article>`;
  const svg = fieldSVG(); $('.fieldbox', host).appendChild(svg);
  const x = ctx.x || {}, labels = {};
  if (third) labels[ctx.family === 'tag' ? '3' : ctx.family === 'send1' ? '1' : '2'] = x.runner ? x.runner.split(' ').pop() : 'R';
  if (ctx.family === 'steal') labels['1'] = x.runner ? x.runner.split(' ').pop() : 'R';
  if (ctx.family === 'steal3') labels['2'] = x.runner ? x.runner.split(' ').pop() : 'R';
  drawSituation(svg, { bases: ctx.state.bases, labels, fielder: third ? x.pos : null, depth: x.depth, infield: ctx.family === 'infield' ? 'back' : null });
  $$('.choice', host).forEach((b) => (b.disabled = third));
  if (third) await playUpTo(svg, { family: ctx.family, pos: x.pos, depth: x.depth });
  $$('.choice', host).forEach((b) => (b.disabled = false));
  if (ctx.family === 'infield') $$('.choice', host).forEach((b) => (b.onmouseenter = b.onfocus = () => drawSituation(svg, { bases: ctx.state.bases, infield: b.dataset.c })));
  let clockT = null;
  return new Promise((done) => {
    const choose = async (id) => {
      clearInterval(clockT); $$('.choice', host).forEach((b) => { b.disabled = true; b.classList.toggle('picked', b.dataset.c === id); });
      $('.hint', host).remove(); const cl = $('.clock', host); if (cl) cl.remove();
      if (ctx.family === 'infield') drawSituation(svg, { bases: ctx.state.bases, infield: id });
      const res = resolveWith(id);
      const o = res.outcome;
      if (third) await playOutcome(svg, { family: ctx.family, pos: x.pos, depth: x.depth, choice: id, success: o.success });
      else await playSimple(svg, { family: ctx.family, success: o.success, outcome: o.what });
      $('.after', host).innerHTML = feedbackHTML(ev, res) + `<div class="next"></div>`;
      bindWhatIf(host, ev);
      $$('[data-film]', host).forEach((b) => (b.onclick = () => openFilm(b.dataset.film)));
      $('.after', host).scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      done({ res, nextHost: $('.next', host) });
    };
    $$('.choice', host).forEach((b) => (b.onclick = () => choose(b.dataset.c)));
    if (timer) {
      let left = timer; const bar = $('.clock i', host); if (bar) bar.style.animationDuration = timer + 's';
      clockT = setInterval(() => { left--; const n = $('.clock b', host); if (n) n.textContent = left; if (left <= 0) { clearInterval(clockT); const hold = ev.options.find((o) => o.id === 'hold'); toast('Time — the runner stops at third.'); choose(hold ? 'hold' : ev.options[1].id); } }, 1000);
    }
  });
}

/* ---------------- screens ---------------- */
function nav(r) { $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === r)); }
async function route() {
  closeModal();
  const [r, q] = (location.hash.slice(2) || 'home').split('?');
  nav(r); window.scrollTo(0, 0);
  const P = new URLSearchParams(q || '');
  if (r === 'manager') return managerSetup(P);
  if (r === 'coach') return coachSeat(P);
  if (r === 'quick') return quick(P);
  if (r === 'matrix') return matrix(P);
  if (r === 'film') return filmRoom(P);
  if (r === 'performance') return performance();
  if (r === 'model') return modelPage();
  return home();
}
function home() {
  const d = load(), n = d.decisions.length;
  app.innerHTML = `<section class="hero"><div class="k">CP SYSTEMS · DECISION LAB</div><h1>Make the call.<br><em>Then live with the result.</em></h1>
    <p class="lede">A baseball decision simulator built on real play-by-play data. Every choice is judged twice: was it the right decision with what you knew — and what actually happened.</p></section>
    <section class="modes">
      <a class="mode" href="#/manager"><div class="k">MODE A</div><h2>Manager’s Seat</h2><p>Manage a simulated game: steals, bunts, the infield, sending runners. The game carries on from every result.</p><span class="go">Start a game →</span></a>
      <a class="mode" href="#/coach"><div class="k">MODE B</div><h2>Third-Base Coach’s Seat</h2><p>Fast, visual send-or-hold calls on singles, doubles and fly balls. Arm, depth, speed, outs — decide.</p><span class="go">Coach third →</span></a>
      <a class="mode sm" href="#/quick"><h2>Quick Decision</h2><p>One situation, 30 seconds.</p></a>
      <a class="mode sm" href="#/matrix"><h2>Decision Matrix</h2><p>Build a situation and compare the options.</p></a>
    </section>
    <section class="strip"><a href="#/film"><b>${FILM.films.length}</b> real plays in the Film Room</a><a href="#/performance"><b>${n}</b> decision${n === 1 ? '' : 's'} on record</a><a href="#/model">How the model works →</a></section>
    <p class="principle">Good process can produce bad outcomes. Bad process can produce good outcomes. Decision Lab grades the process.</p>`;
}
/* Manager's Seat */
function managerSetup(P) {
  if (P.get('go')) return managerGame({ side: P.get('side') || 'home', decisions: +P.get('n') || 10, startInning: +P.get('from') || 1, seed: +P.get('seed') || Math.floor(Math.random() * 1e9) });
  app.innerHTML = `<section class="page"><div class="k">MODE A</div><h1>Manager’s Seat</h1><p class="lede">You manage one club for a simulated game. The game moves between meaningful moments; between them it plays itself from real base-out transitions (Retrosheet 2023–25).</p>
    <form class="setup" id="mgr">
      <fieldset><legend>Your club bats</legend><label><input type="radio" name="side" value="home" checked> At home (bottom of the inning)</label><label><input type="radio" name="side" value="away"> On the road (top)</label></fieldset>
      <fieldset><legend>Decisions</legend>${[6, 8, 10, 12].map((n) => `<label><input type="radio" name="n" value="${n}" ${n === 10 ? 'checked' : ''}> ${n}</label>`).join('')}</fieldset>
      <fieldset><legend>Start making decisions in</legend>${[[1, 'the 1st'], [5, 'the 5th'], [7, 'the 7th']].map(([v, l]) => `<label><input type="radio" name="from" value="${v}" ${v === 1 ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <details><summary>Replay a game (seed)</summary><label class="seed">Seed <input type="number" name="seed" min="1" placeholder="random"></label></details>
      <button class="btn primary" type="submit">Play ball</button></form>
    <p class="note">A game offers as many decisions as it naturally creates — usually 6–10 for one club. Players are hypothetical, with ratings drawn from MLB distributions.</p></section>`;
  $('#mgr').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/manager?go=1&side=${f.get('side')}&n=${f.get('n')}&from=${f.get('from')}${f.get('seed') ? '&seed=' + f.get('seed') : ''}`; };
}
async function managerGame(opts) {
  const G = createGame(E, opts), sid = startSession('manager', { seed: opts.seed, side: opts.side });
  let lastPlay = 0;
  app.innerHTML = `<section class="game"><header class="gh"><div class="board" id="board"></div><div class="gh-r"><span class="seedl">Seed ${opts.seed}</span><button class="btn ghost sm" id="endGame">Finish the game</button></div></header>
    <div class="feed" id="feed"></div><div id="stage"></div></section>`;
  const board = () => { const s = G.g.state, t = G.g.teams; $('#board').innerHTML = `<div class="bd-t"><span class="${opts.side === 'away' ? 'us' : ''}">${opts.side === 'away' ? 'YOU' : 'OPP'} <b>${s.score.away}</b></span><span class="${opts.side === 'home' ? 'us' : ''}">${opts.side === 'home' ? 'YOU' : 'OPP'} <b>${s.score.home}</b></span></div>
      <div class="bd-s">${s.final ? 'FINAL' + (s.inning > 9 ? ` / ${s.inning}` : '') : `${s.half === 'top' ? '▲' : '▼'} ${ord(s.inning)} · ${outsWord(Math.min(2, s.outs))}`}</div>${s.final ? '' : diamondMini(s.bases, Math.min(2, s.outs))}<div class="bd-n">${s.final ? `${G.g.made} decision${G.g.made === 1 ? '' : 's'} made` : `Decision ${Math.min(G.g.made + 1, opts.decisions)} of ${opts.decisions}`}</div>`; };
  const feed = () => {
    const ps = G.g.plays.slice(lastPlay); lastPlay = G.g.plays.length;
    if (!ps.length) return;
    const byHalf = []; for (const p of ps) { const k = `${p.half === 'top' ? 'Top' : 'Bottom'} ${ord(p.inning)}`; if (!byHalf.length || byHalf[byHalf.length - 1].k !== k) byHalf.push({ k, items: [] }); byHalf[byHalf.length - 1].items.push(p); }
    $('#feed').innerHTML = `<details ${ps.length < 8 ? 'open' : ''}><summary>Since your last decision · ${ps.length} play${ps.length === 1 ? '' : 's'}</summary>${byHalf.map((h) => `<div class="fd-h">${h.k}</div><ul>${h.items.map((p) => `<li class="${p.kind}">${esc(p.text)}</li>`).join('')}</ul>`).join('')}</details>`;
  };
  $('#endGame').onclick = () => { if (confirm('Simulate the rest of the game without more decisions?')) { G.simToEnd(); finish(); } };
  const finish = () => { board(); feed(); recap(G, opts, sid); };
  let st = G.step();
  while (st.type === 'decision') {
    board(); feed();
    const ctx = { ...st.ctx, side: opts.side };
    const { nextHost } = await decisionScreen($('#stage'), ctx, st.ev, {
      label: `${FAMILIES[ctx.family].name.toUpperCase()} · YOUR CALL`,
      resolveWith: (id) => { const r = G.decide(id); r.realized = r.entry.weAfter; r.entry.realized = r.entry.weAfter; record(sid, 'manager', r.entry); board(); return { ...r, realized: r.entry.weAfter }; },
    });
    await new Promise((res) => { nextHost.innerHTML = `<button class="btn primary" id="cont">${G.g.made >= opts.decisions ? 'Play out the game →' : 'Continue the game →'}</button>`; $('#cont').onclick = res; $('#cont').focus({ preventScroll: true }); });
    window.scrollTo(0, 0);
    st = G.step();
  }
  finish();
}
function recap(G, opts, sid) {
  const g = G.g, s = g.state, us = s.score[opts.side], them = s.score[opts.side === 'home' ? 'away' : 'home'], won = us > them;
  const sound = g.log.filter((e) => e.grade.tone === 'good').length, lost = g.log.reduce((a, e) => a + e.grade.lossWE, 0);
  const luck = g.log.reduce((a, e) => a + (e.weAfter - e.expectedWE), 0);
  endSession(sid, { result: `${us}-${them}`, won, decisions: g.log.length, sound, lostWE: lost });
  $('#stage').innerHTML = `<section class="recap"><div class="k">FINAL${s.inning > 9 ? ` · ${s.inning} INNINGS` : ''}</div><h2>${won ? 'You won' : 'You lost'} ${us}–${them}</h2>
    <div class="rc-kpi"><div><b>${g.log.length}</b><span>decisions${g.log.length < opts.decisions ? ` (the game offered ${g.log.length})` : ''}</span></div><div><b>${sound}</b><span>sound or defensible</span></div>
      <div><b>${pts(-lost)}</b><span>win prob. given up vs the model’s choices</span></div><div><b>${pts(luck)}</b><span>luck — results vs expectations</span></div></div>
    <p class="note">Skill and luck are separate: the first number counts only your choices against the model’s preferred options; the second is how the dice fell after them.</p>
    <table class="tbl"><thead><tr><th>#</th><th>Situation</th><th>Decision</th><th>Your call</th><th>Quality</th><th>What happened</th></tr></thead><tbody>
    ${g.log.map((e) => `<tr><td>${e.n}</td><td>${half(e.state)} · ${outsWord(e.state.outs)} · ${esc(BASE_NAMES[e.state.bases])}</td><td>${esc(FAMILIES[e.family].name)}</td><td>${esc(e.options.find((o) => o.id === e.choice).label)}</td>
      <td><span class="tone ${e.grade.tone}">${esc(e.grade.label)}</span>${e.grade.lossWE > 0.0005 ? ` <span class="muted">${pts(-e.grade.lossWE)}</span>` : ''}</td><td>${esc(e.outcome)}</td></tr>`).join('')}</tbody></table>
    <details class="pbp"><summary>Play-by-play</summary><ul>${g.plays.map((p) => `<li class="${p.kind}">${p.half === 'top' ? '▲' : '▼'}${p.inning} · ${esc(p.text)}</li>`).join('')}</ul></details>
    <div class="rc-act"><a class="btn primary" href="#/manager">New game</a><a class="btn ghost" href="#/manager?go=1&side=${opts.side}&n=${opts.decisions}&from=${opts.startInning}&seed=${opts.seed}">Replay this game (seed ${opts.seed})</a><a class="btn ghost" href="#/performance">Your performance</a></div></section>`;
}
/* Third-Base Coach's Seat: a run of send / hold calls */
async function coachSeat(P) {
  const n = +P.get('n') || 0;
  if (!n) {
    app.innerHTML = `<section class="page"><div class="k">MODE B</div><h1>Third-Base Coach’s Seat</h1><p class="lede">The ball is in the outfield and the runner is coming. Send him or hold him — before the throw is made.</p>
      <form class="setup" id="cs"><fieldset><legend>Calls</legend>${[5, 10, 15].map((k) => `<label><input type="radio" name="n" value="${k}" ${k === 10 ? 'checked' : ''}> ${k}</label>`).join('')}</fieldset>
      <fieldset><legend>Shot clock</legend><label><input type="radio" name="t" value="0" checked> Off</label><label><input type="radio" name="t" value="6"> 6 seconds</label></fieldset>
      <button class="btn primary" type="submit">Coach third</button></form>
      <p class="note">Singles with a runner on second, doubles with a runner on first, and fly balls with a runner on third. Success probabilities come from a preliminary timing model fitted to Retrosheet send and tag-up rates.</p></section>`;
    $('#cs').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `#/coach?n=${f.get('n')}&t=${f.get('t')}`; };
    return;
  }
  const timer = +P.get('t') || 0, r = rng(+P.get('seed') || Math.floor(Math.random() * 1e9)), sid = startSession('coach');
  app.innerHTML = `<section class="game"><header class="gh"><div class="board coach" id="cboard"></div></header><div id="stage"></div></section>`;
  const log = [];
  for (let i = 0; i < n; i++) {
    const fam = r() < 0.55 ? 'send' : r() < 0.6 ? 'tag' : 'send1', sc = scenario(E, fam, r);
    $('#cboard').innerHTML = `<b>Call ${i + 1} of ${n}</b><span>${log.filter((e) => e.tone === 'good').length} sound · ${log.filter((e) => e.success).length} runs scored</span>`;
    const ctx = { family: fam, state: sc.state, side: sc.side, x: sc.x };
    const { res, nextHost } = await decisionScreen($('#stage'), ctx, sc.ev, { seat: 'coach', timer, label: `CALL ${i + 1} OF ${n}`,
      resolveWith: (id) => { const gr = E.grade(sc.ev, id), rr = E.resolve(sc.ev, id, r), st = rr.state, realized = E.weFor(st.outs >= 3 ? E.nextHalf(st) : st, sc.side);
        const entry = { family: fam, choice: id, best: sc.ev.best, grade: gr, sensitive: sc.ev.sensitive.length > 0, realized, expectedWE: gr.choice.we, weBefore: sc.ev.weNow };
        record(sid, 'coach', entry); log.push({ tone: gr.tone, success: rr.outcome.success === true, loss: gr.lossWE, choice: id, best: sc.ev.best, fam, what: outcomeText(sc.state, rr.outcome) });
        return { grade: gr, outcome: rr.outcome, realized };
      } });
    await new Promise((res2) => { nextHost.innerHTML = `<button class="btn primary" id="cont">${i + 1 < n ? 'Next call →' : 'See your run of calls →'}</button>`; $('#cont').onclick = res2; });
    window.scrollTo(0, 0);
  }
  const sound = log.filter((e) => e.tone === 'good').length, lost = log.reduce((a, e) => a + e.loss, 0);
  endSession(sid, { decisions: n, sound, lostWE: lost });
  $('#stage').innerHTML = `<section class="recap"><div class="k">THIRD-BASE COACH · ${n} CALLS</div><h2>${sound} of ${n} sound calls</h2>
    <div class="rc-kpi"><div><b>${log.filter((e) => e.choice !== 'hold').length}</b><span>sent</span></div><div><b>${log.filter((e) => e.best !== 'hold').length}</b><span>the model would send</span></div><div><b>${pts(-lost)}</b><span>win prob. given up</span></div><div><b>${log.filter((e) => e.success).length}</b><span>runs that scored</span></div></div>
    <table class="tbl"><thead><tr><th>#</th><th>Play</th><th>Your call</th><th>Model</th><th>Quality</th><th>Result</th></tr></thead><tbody>${log.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(FAMILIES[e.fam].name)}</td><td>${esc(e.choice)}</td><td>${esc(e.best)}</td><td><span class="tone ${e.tone}">${e.tone === 'good' ? 'Sound' : e.tone === 'mid' ? 'Questionable' : 'Costly'}</span></td><td>${esc(e.what)}</td></tr>`).join('')}</tbody></table>
    <div class="rc-act"><a class="btn primary" href="#/coach?n=${n}&t=${timer}&seed=${Math.floor(Math.random() * 1e9)}">Another run</a><a class="btn ghost" href="#/performance">Your performance</a></div></section>`;
}
/* Quick Decision */
async function quick(P) {
  const fams = Object.keys(FAMILIES), want = P.get('f'), r = rng(+P.get('seed') || Math.floor(Math.random() * 1e9));
  const fam = fams.includes(want) ? want : fams[Math.floor(r() * fams.length)], sc = scenario(E, fam, r), sid = startSession('quick');
  app.innerHTML = `<section class="game"><div class="qh"><div class="k">QUICK DECISION</div><div class="qf">${fams.map((f) => `<a href="#/quick?f=${f}&seed=${Math.floor(Math.random() * 1e9)}" class="${f === fam ? 'on' : ''}">${esc(FAMILIES[f].name)}</a>`).join('')}</div></div><div id="stage"></div></section>`;
  const ctx = { family: fam, state: sc.state, side: sc.side, x: sc.x };
  const { nextHost } = await decisionScreen($('#stage'), ctx, sc.ev, {
    resolveWith: (id) => { const gr = E.grade(sc.ev, id), rr = E.resolve(sc.ev, id, r), st = rr.state, realized = E.weFor(st.outs >= 3 ? E.nextHalf(st) : st, sc.side);
      record(sid, 'quick', { family: fam, choice: id, best: sc.ev.best, grade: gr, sensitive: sc.ev.sensitive.length > 0, realized, expectedWE: gr.choice.we, weBefore: sc.ev.weNow });
      return { grade: gr, outcome: rr.outcome, realized }; } });
  nextHost.innerHTML = `<a class="btn primary" href="#/quick?seed=${Math.floor(Math.random() * 1e9)}">Another situation →</a> <a class="btn ghost" href="#/matrix?${matrixQuery(ctx)}">Open in the Decision Matrix</a>`;
}
/* Decision Matrix */
function matrixQuery(ctx) {
  const s = ctx.state, x = ctx.x || {};
  const q = { f: ctx.family, inn: s.inning, half: s.half, outs: s.outs, bases: s.bases, side: ctx.side, us: s.score[ctx.side], them: s.score[ctx.side === 'home' ? 'away' : 'home'], ...x };
  delete q.runner; delete q.batter;
  return new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
}
const FAM_BASES = { steal: [1], steal3: [2], bunt: [1, 3, 2], infield: [4], send: [2, 3, 6, 7], send1: [1], tag: [4, 5, 6, 7] };
const FAM_OUTS = { steal: [0, 1, 2], steal3: [0, 1], bunt: [0], infield: [0, 1], send: [0, 1, 2], send1: [0, 1, 2], tag: [0, 1] };
function matrix(P) {
  const f = FAMILIES[P.get('f')] ? P.get('f') : 'infield';
  const st = { f, inn: +P.get('inn') || 9, side: P.get('side') || 'home', us: P.get('us') != null ? +P.get('us') : 3, them: P.get('them') != null ? +P.get('them') : 3,
    outs: P.get('outs') != null ? +P.get('outs') : FAM_OUTS[f][Math.min(1, FAM_OUTS[f].length - 1)], bases: P.get('bases') != null ? +P.get('bases') : FAM_BASES[f][0],
    speed: +P.get('speed') || 27.3, arm: +P.get('arm') || 87, pos: P.get('pos') || '8', depth: P.get('depth') || 'medium', charging: P.get('charging') === 'true',
    battery: P.get('battery') || 'avg', tier: P.get('tier') || 'avg', gb: P.get('gb') || 'mid', k: P.get('k') || 'mid', usage: +P.get('usage') || M.assumptions.infield_in_usage.value };
  if (!FAM_BASES[f].includes(st.bases)) st.bases = FAM_BASES[f][0];
  if (!FAM_OUTS[f].includes(st.outs)) st.outs = FAM_OUTS[f][0];
  const sel = (name, opts, v) => `<select name="${name}">${opts.map(([val, l]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const field = (l, h) => `<label class="mf"><span>${l}</span>${h}</label>`;
  const offense = FAMILIES[f].side === 'offense';
  app.innerHTML = `<section class="page wide"><div class="k">DECISION MATRIX</div><h1>Build a situation. Compare the options.</h1>
    <form class="mx" id="mx">
      <div class="mx-fam">${Object.keys(FAMILIES).map((k) => `<label><input type="radio" name="f" value="${k}" ${k === f ? 'checked' : ''}> ${esc(FAMILIES[k].name)}</label>`).join('')}</div>
      <div class="mx-row">
        ${field('Inning', sel('inn', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [i, ord(i)]), st.inn))}
        ${field('Your club', sel('side', [['home', 'Home'], ['away', 'Visitors']], st.side))}
        ${field('Your runs', `<input type="number" name="us" min="0" max="20" value="${st.us}">`)}
        ${field('Their runs', `<input type="number" name="them" min="0" max="20" value="${st.them}">`)}
        ${field('Outs', sel('outs', FAM_OUTS[f].map((o) => [o, o]), st.outs))}
        ${field('Runners', sel('bases', FAM_BASES[f].map((b) => [b, BASE_NAMES[b]]), st.bases))}
      </div>
      <div class="mx-row">
        ${['steal', 'steal3', 'send', 'send1', 'tag'].includes(f) ? field('Runner speed (ft/s)', `<input type="range" name="speed" min="24" max="30.5" step="0.1" value="${st.speed}"><output>${st.speed.toFixed(1)} · ${speedWord(st.speed)}</output>`) : ''}
        ${['steal', 'steal3'].includes(f) ? field('Battery', sel('battery', [['strong', 'Strong arm / quick'], ['avg', 'Average'], ['weak', 'Weak arm / slow']], st.battery)) : ''}
        ${['send', 'send1', 'tag'].includes(f) ? field('Fielder', sel('pos', [['7', 'Left field'], ['8', 'Center field'], ['9', 'Right field']], st.pos)) + field('Depth', sel('depth', [['shallow', 'Shallow'], ['medium', 'Medium'], ['deep', 'Deep']], st.depth))
          + field('Arm (mph)', `<input type="range" name="arm" min="78" max="99" step="0.5" value="${st.arm}"><output>${st.arm.toFixed(1)} · ${armWord(st.arm, st.pos)}</output>`) : ''}
        ${f === 'send' ? field('Outfielder', sel('charging', [['false', 'Normal approach'], ['true', 'Charging hard']], String(st.charging))) : ''}
        ${f === 'bunt' ? field('Batter', sel('tier', [['weak', 'Light-hitting'], ['avg', 'Average'], ['strong', 'Dangerous']], st.tier)) : ''}
        ${f === 'infield' ? field('Ground balls', sel('gb', [['high', 'Heavy ground-ball hitter'], ['mid', 'Average'], ['low', 'Fly-ball hitter']], st.gb)) + field('Strikeouts', sel('k', [['high', 'Strikes out a lot'], ['mid', 'Average'], ['low', 'Rarely']], st.k))
          + field('Infields drawn in (assumption)', `<input type="range" name="usage" min="0.4" max="0.8" step="0.05" value="${st.usage}"><output>${pct(st.usage)} of the time</output>`) : ''}
      </div></form>
    <div id="mxOut"></div></section>`;
  const read = () => { const fd = new FormData($('#mx')), o = Object.fromEntries(fd.entries()); return o; };
  const draw = () => {
    const o = read(); if (o.f !== f) { location.hash = `#/matrix?f=${o.f}`; return; }
    const side = o.side, them = side === 'home' ? 'away' : 'home';
    const half = (side === 'home') === offense ? 'bottom' : 'top';
    const s = { inning: +o.inn, half, outs: +o.outs, bases: +o.bases, score: { [side]: +o.us, [them]: +o.them } };
    const x = { speed: +o.speed || 27.3, arm: +o.arm || 87, pos: o.pos || '8', depth: o.depth || 'medium', charging: o.charging === 'true', battery: o.battery, tier: o.tier, gb: o.gb, k: o.k };
    $$('#mx input[type=range]').forEach((r) => { const out = r.nextElementSibling; if (r.name === 'speed') out.textContent = `${(+r.value).toFixed(1)} · ${speedWord(+r.value)}`; if (r.name === 'arm') out.textContent = `${(+r.value).toFixed(1)} · ${armWord(+r.value, o.pos)}`; if (r.name === 'usage') out.textContent = `${pct(+r.value)} of the time`; });
    const over = f === 'infield' ? { infield_in_usage: +o.usage } : undefined;
    if (half === 'bottom' && s.inning >= 9 && s.score.home > s.score.away) { $('#mxOut').innerHTML = '<p class="note">The home team is already ahead in the bottom of the 9th — the game would be over.</p>'; return; }
    const ev = E.evaluate({ family: f, state: s, side, x, over });
    history.replaceState(null, '', '#/matrix?' + matrixQuery({ family: f, state: s, side, x: { ...x, usage: o.usage } }));
    $('#mxOut').innerHTML = `<div class="mx-res"><div class="mx-best"><div class="k">MODEL’S PREFERRED OPTION</div><b>${esc(ev.options.find((q) => q.best).label)}</b>
        <span>${half === 'top' ? 'Top' : 'Bottom'} ${ord(s.inning)} · ${outsWord(s.outs)} · ${esc(BASE_NAMES[s.bases])} · win probability now ${pct(ev.weNow, 1)}</span>${ev.sensitive.length ? '<span class="sens">Close call — the preferred option changes inside the model’s uncertainty.</span>' : ''}</div>
      ${analysisHTML(ev)}<p class="why">${esc(explain(ev, ev.best))}</p></div>
      <div class="mx-sweep"><div class="k">WHAT CHANGES THE RECOMMENDATION</div>${sweeps(f, s, side, x, over).map((l) => `<p>${l}</p>`).join('') || '<p class="muted">Nothing in the usual ranges flips it.</p>'}</div>
      ${observedHTML(f)}${filmHTML(f, {})}`;
    $$('[data-film]', $('#mxOut')).forEach((b) => (b.onclick = () => openFilm(b.dataset.film)));
  };
  $('#mx').addEventListener('input', draw); $('#mx').addEventListener('change', draw);
  draw();
}
/* sweep one input and report where the preferred option changes */
function sweeps(f, s, side, x, over) {
  const out = [], bestAt = (ss, xx, sd = side) => E.evaluate({ family: f, state: ss, side: sd, x: xx, over, noSens: true }).options.find((o) => o.best);
  const base = bestAt(s, x);
  const scan = (label, vals, mk, fmt) => {
    let prev = null; const flips = [];
    for (const v of vals) { const { s: ss, x: xx } = mk(v); if (ss.half === 'bottom' && ss.inning >= 9 && ss.score.home > ss.score.away) continue; const b = bestAt(ss, xx); if (prev && b.id !== prev.id) flips.push(`${esc(prev.label)} → <b>${esc(b.label)}</b> at ${fmt(v)}`); prev = b; }
    if (flips.length) out.push(`<b>${label}:</b> ${flips.join('; ')}`);
  };
  const them = side === 'home' ? 'away' : 'home', lead = (d) => ({ [side]: Math.max(s.score[side], s.score[them]) + Math.max(0, d) - Math.max(0, -d) * 0, [them]: Math.max(s.score[side], s.score[them]) + Math.max(0, -d) });
  if (x.speed != null && ['steal', 'steal3', 'send', 'send1', 'tag'].includes(f)) scan('Runner speed', Array.from({ length: 33 }, (_, i) => 24 + i * 0.2), (v) => ({ s, x: { ...x, speed: v } }), (v) => `${v.toFixed(1)} ft/s`);
  if (['send', 'send1', 'tag'].includes(f)) scan('Outfielder’s arm', Array.from({ length: 22 }, (_, i) => 78 + i), (v) => ({ s, x: { ...x, arm: v } }), (v) => `${v} mph`);
  scan('Score (your lead)', [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5], (v) => ({ s: { ...s, score: lead(v) }, x }), (v) => (v === 0 ? 'a tie' : v > 0 ? `up ${v}` : `down ${-v}`));
  scan('Inning', [1, 2, 3, 4, 5, 6, 7, 8, 9], (v) => ({ s: { ...s, inning: v }, x }), (v) => `the ${ord(v)}`);
  if (f === 'bunt') { const t = ['weak', 'avg', 'strong'].map((v) => [v, bestAt(s, { ...x, tier: v })]); if (new Set(t.map((y) => y[1].id)).size > 1) out.push(`<b>Batter:</b> ${t.map(([v, b]) => `${TIER[v]} → ${esc(b.label)}`).join(' · ')}`); }
  if (f === 'infield') { const t = ['high', 'mid', 'low'].map((v) => [v, bestAt(s, { ...x, gb: v })]); if (new Set(t.map((y) => y[1].id)).size > 1) out.push(`<b>Batter:</b> ${t.map(([v, b]) => `${GB[v]} → ${esc(b.label)}`).join(' · ')}`); }
  const flip = { ...s, half: s.half === 'top' ? 'bottom' : 'top', score: { home: s.score.away, away: s.score.home } }, other = side === 'home' ? 'away' : 'home';
  if (!(flip.half === 'bottom' && flip.inning >= 9 && flip.score.home > flip.score.away)) { const b2 = bestAt(flip, x, other); if (b2.id !== base.id) out.push(`<b>Home vs road:</b> as the ${other === 'home' ? 'home team' : 'visitors'}, the call is <b>${esc(b2.label)}</b>.`); }
  if (['steal', 'steal3', 'send', 'send1', 'tag'].includes(f)) { const ev = E.evaluate({ family: f, state: s, side, x, over }); out.unshift(`<b>Break-even:</b> ${esc(ev.options[0].label.toLowerCase())} needs to succeed at least <b>${pct(ev.options[0].breakEven)}</b> of the time here; the estimate is ${pct(ev.options[0].success.p)}.`); }
  return out;
}
function observedHTML(f) {
  const fit = M.fits;
  if (f === 'send') return `<div class="obs"><div class="k">WHAT COACHES ACTUALLY DO (RETROSHEET 2023–25)</div><p>Runner on second, single to the outfield: sent home <b>${pct(fit.send2.target.sendRate)}</b> of the time with two outs (thrown out on ${pct(fit.send2.target.outRateWhenSent, 1)} of sends) and <b>${pct(fit.send2.lessThanTwoOuts.observed.sendRate)}</b> with fewer than two outs (${pct(fit.send2.lessThanTwoOuts.observed.outRateWhenSent, 1)} thrown out). Low out rates mean coaches send mostly the safe ones — the model’s break-evens say when a riskier send is worth it.</p></div>`;
  if (f === 'send1') return `<div class="obs"><div class="k">WHAT COACHES ACTUALLY DO</div><p>Runner on first, double to the outfield: sent home ${pct(fit.send1.target.sendRate)} of the time with two outs (${pct(fit.send1.target.outRateWhenSent, 1)} thrown out), ${pct(fit.send1.lessThanTwoOuts.observed.sendRate)} with fewer (${pct(fit.send1.lessThanTwoOuts.observed.outRateWhenSent, 1)}).</p></div>`;
  if (f === 'tag') return `<div class="obs"><div class="k">WHAT COACHES ACTUALLY DO</div><p>Runner on third, fly ball caught by an outfielder: the runner tags and goes ${pct(fit.tag3.byOuts['0'].sendRate)} of the time with nobody out and ${pct(fit.tag3.byOuts['1'].sendRate)} with one out; ${pct(fit.tag3.target.outRateWhenSent, 1)} of those are thrown out.</p></div>`;
  if (f === 'steal' || f === 'steal3') return `<div class="obs"><div class="k">WHAT HAPPENS LEAGUE-WIDE</div><p>Steals of second succeed ${pct((M.steal.second['0'].sb + M.steal.second['1'].sb + M.steal.second['2'].sb) / (M.steal.second['0'].att + M.steal.second['1'].att + M.steal.second['2'].att))} of the time since the 2023 rule changes (${(M.steal.second['0'].att + M.steal.second['1'].att + M.steal.second['2'].att).toLocaleString()} attempts with only first occupied); steals of third ${pct(E.st3.rate)}.</p></div>`;
  if (f === 'infield') return `<div class="obs"><div class="k">WHAT TEAMS ACTUALLY DO — AND WHAT THE DATA CAN’T SAY</div><p>No public data records when an infield is drawn in. What it does show: with a runner on third, ground balls become hits <b>${pct(M.bipControl['r3_2out:GB'].hit, 1)}</b> of the time with two outs (infield back) but <b>${pct(M.bipControl['r3_lt2:GB'].hit, 1)}</b> with fewer than two outs — the footprint of infields playing in. How often they do, and exactly what it costs, is an assumption here (adjustable above); the comparison of observed behavior with the preferred decision is therefore indirect.</p></div>`;
  if (f === 'bunt') return `<div class="obs"><div class="k">LIMITS</div><p>Retrosheet records bunts put in play; foul and missed bunts aren’t visible, so ${pct(M.assumptions.bunt_fail.value)} of attempts are assumed to fail. Batters who bunt are a selected group — their bunt results may be better than a random hitter’s would be.</p></div>`;
  return '';
}
/* Film Room */
function filmRoom(P) {
  const fam = P.get('f') || '', list = FILM.films.filter((f) => !fam || f.families.some((x) => x.family === fam));
  app.innerHTML = `<section class="page wide"><div class="k">FILM ROOM</div><h1>Real plays, by decision.</h1><p class="lede">${FILM.films.length} plays from Play Repository whose official records match a Decision Lab decision. Each is a real MLB play — shown as an example of a kind of situation and outcome, never as the result of a simulated choice.</p>
    <div class="qf">${['', ...Object.keys(FAMILIES)].map((f) => `<a href="#/film${f ? '?f=' + f : ''}" class="${f === fam ? 'on' : ''}">${f ? esc(FAMILIES[f].name) : 'All'} <span class="muted">${f ? FILM.films.filter((x) => x.families.some((y) => y.family === f)).length : FILM.films.length}</span></a>`).join('')}</div>
    <div class="films grid">${list.map((f) => filmCard(f, fam || f.families[0].family)).join('')}</div>
    <p class="note">Video: MLB.com’s own clips, played through MLB’s embed — never downloaded or rehosted. Source records: Play Repository (read-only; index ${esc(FILM.source.indexGenerated)}).</p></section>`;
  $$('[data-film]').forEach((b) => (b.onclick = () => openFilm(b.dataset.film)));
}
/* Performance */
function performance() {
  const d = load(), D = d.decisions;
  if (!D.length) { app.innerHTML = `<section class="page"><div class="k">PERFORMANCE</div><h1>No decisions yet.</h1><p class="lede">Play a game, coach third or try a quick decision — every call is recorded here, in this browser.</p><a class="btn primary" href="#/quick">Quick decision →</a></section>`; return; }
  const by = {}; for (const x of D) (by[x.family] = by[x.family] || []).push(x);
  const avg = (xs, k) => xs.reduce((a, y) => a + y[k], 0) / xs.length;
  const sound = (xs) => xs.filter((y) => y.tone === 'good').length / xs.length;
  const luck = (xs) => xs.reduce((a, y) => a + ((y.realized ?? y.expected) - y.expected), 0) / xs.length;
  const sessions = d.sessions.filter((s) => D.some((x) => x.session === s.id)).slice(-12);
  const trend = sessions.map((s) => { const xs = D.filter((x) => x.session === s.id); return { s, n: xs.length, sound: sound(xs), loss: avg(xs, 'lossWE') }; });
  app.innerHTML = `<section class="page wide"><div class="k">PERFORMANCE · THIS BROWSER</div><h1>Your decisions</h1>
    <div class="rc-kpi"><div><b>${D.length}</b><span>decisions</span></div><div><b>${pct(sound(D))}</b><span>sound or defensible</span></div><div><b>${pts(-avg(D, 'lossWE'), 2)}</b><span>avg. win prob. vs the model’s choice (skill)</span></div><div><b>${pts(luck(D), 2)}</b><span>avg. result vs expectation (luck)</span></div></div>
    <p class="note">Skill is measured before the outcome: what each choice was worth against the model’s preferred option. Results are tracked separately — a good outcome never improves a poor decision’s grade.</p>
    <table class="tbl"><thead><tr><th>Decision</th><th class="n">Made</th><th class="n">Sound</th><th class="n">Avg. given up</th><th class="n">Close calls</th><th class="n">Luck</th></tr></thead><tbody>
      ${Object.entries(by).map(([f, xs]) => `<tr><td>${esc(FAMILIES[f] ? FAMILIES[f].name : f)}</td><td class="n">${xs.length}</td><td class="n">${pct(sound(xs))}</td><td class="n">${pts(-avg(xs, 'lossWE'), 2)}</td><td class="n">${xs.filter((y) => y.sensitive).length}</td><td class="n">${pts(luck(xs), 2)}</td></tr>`).join('')}</tbody></table>
    <h2 class="h2">Sessions</h2><div class="trend">${trend.map((t) => `<div class="tr-b" title="${new Date(t.s.started).toLocaleString()} · ${t.n} decisions"><i style="height:${Math.max(4, t.sound * 100)}%"></i><span>${esc(t.s.mode)}</span></div>`).join('')}</div>
    <p class="note">Bars: share of sound decisions per session, oldest to newest.</p>
    <button class="btn ghost sm" id="reset">Clear my record</button></section>`;
  $('#reset').onclick = () => { if (confirm('Clear every recorded decision in this browser?')) { save({ decisions: [], sessions: [] }); performance(); } };
}
/* The model */
function modelPage() {
  const A = M.assumptions, f = M.fits;
  const rows = [
    ['Run expectancy, run distributions', 'Empirical', `Retrosheet ${M.seasons.join(', ')} regular season, ${M.league.games.toLocaleString()} games, innings 1–8, by batting side.`],
    ['Win expectancy', 'Computed', `Dynamic programming over the run distributions (home bats last; extra innings start with a runner on second). Agrees with MLB’s own win probability within 1.7 points on average (125 Play Repository plays).`],
    ['Game between decisions', 'Empirical', 'Every base-out transition in the data (plate appearances by batter tier, plus wild pitches, steals, pickoffs).'],
    ['Steal success', 'Fitted', `Logistic fit on Statcast sprint speed: ${f ? '' : ''}slope ${M.steal.speedFit.slope.toFixed(3)} ± ${M.steal.speedFit.slopeSE.toFixed(3)} per ft/s (${M.steal.speedFit.attempts.toLocaleString()} attempts). Battery effect: assumption.`],
    ['Bunt and swing-away outcomes', 'Empirical + assumption', `Bunts put in play by base-out state; ${pct(A.bunt_fail.value)} of attempts assumed to fail.`],
    ['Send from second / first, tag from third', 'Preliminary model', `Timing of the throw versus the runner, two parameters fitted to Retrosheet send and out-at-home rates (two outs: ${pct(f.send2.target.sendRate)} sent, ${pct(f.send2.target.outRateWhenSent, 1)} out; fit ${pct(f.send2.fit.sendRate)}, ${pct(f.send2.fit.outRateWhenSent, 1)}). No public per-play throw or runner timing exists.`],
    ['Infield in / back / corners', 'Assumption, bounded by data', `Effect on hits from the observed difference between two-out and fewer-than-two-out batted balls with a runner on third, divided by an assumed infield-in usage (${pct(A.infield_in_usage.value)}); runner-scoring shares are assumptions.`],
  ];
  app.innerHTML = `<section class="page wide prose"><div class="k">THE MODEL</div><h1>How Decision Lab decides</h1>
    <p class="lede">Every option is valued by the win probability it leaves your club, averaged over everything that can happen next. The option with the higher average is the better decision — whatever then happens.</p>
    <table class="tbl"><thead><tr><th>Component</th><th>Basis</th><th>Detail</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td><span class="basis">${r[1]}</span></td><td>${r[2]}</td></tr>`).join('')}</tbody></table>
    <h2 class="h2">Assumptions you should know about</h2>
    <dl class="assume">${Object.entries(A).filter(([, v]) => v.why).map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}${v.value != null ? ` — ${v.value}${v.range ? ` (range ${v.range.join('–')})` : ''}` : ''}</dt><dd>${esc(v.why)}</dd>`).join('')}</dl>
    <h2 class="h2">Limits</h2><ul>
      <li>Players are hypothetical; ratings use real MLB distributions (Statcast sprint speed ${M.speed.p10}–${M.speed.p90} ft/s, outfield arms ~${M.arm['7'].p10}–${M.arm['9'].p90} mph). Real player data would sharpen every estimate.</li>
      <li>The counts and pitchers aren’t modeled; a steal attempt is valued as if the plate appearance then continues normally.</li>
      <li>Send and tag probabilities come from a preliminary timing model calibrated to league rates, not to tracked throws. They are most reliable near the middle of their range.</li>
      <li>No public source says when an infield was drawn in; infield results are the most assumption-dependent, and the app flags close calls.</li>
      <li>Observed coach and manager behavior is shown where the data records it (sends, tags, steals); a comparison with individual managers’ choices is not part of this version.</li></ul>
    <p class="note">${esc(M.sources.retrosheet)}<br>${esc(M.sources.savant)} ${esc(M.sources.statsapi)}</p></section>`;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    const [m, f] = await Promise.all([fetch('data/model.json').then((r) => r.json()), fetch('data/film.json').then((r) => r.json())]);
    M = m; FILM = f; E = createEngine(M);
  } catch (e) { app.innerHTML = `<section class="page"><h1>Decision Lab couldn’t load its model.</h1><p>${esc(e.message)}</p></section>`; return; }
  $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#scrim').hidden) closeModal(); });
  window.addEventListener('hashchange', route);
  route();
})();
