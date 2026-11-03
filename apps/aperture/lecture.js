/* APERTURE — narrated lecture player (Watch & Learn).
   A reusable component: AP.Lecture.mount(el, { lecture, saved, onSave, onComplete, onCheckpoint }).
   One AAC narration track drives everything else: each narration cue has exact start/end times, so
   the animated scene, its reveal step, captions, the transcript highlight and the interactive
   checkpoints all follow the audio clock. Checkpoints are formative: the lecture pauses, the learner
   answers (or skips), the response is saved, and narration resumes.
   Accessibility: native buttons and range inputs, keyboard shortcuts, captions, a full synchronized
   transcript, audio-only mode, reduced motion respected. No inline styles in markup (CSP). */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const svg = (tag, attrs, ...kids) => h(tag, attrs, ...kids);

  /* ---------------- scene renderers: return { el, steps } ----------------
     A visual shows step 0 at once; elements marked data-step="n" appear when the reveal reaches n. */
  const R = {};
  const step = (n, el) => { el.dataset.step = String(n); el.classList.add('lv-step'); return el; };
  R.title = (v) => ({ el: h('div', { class: 'lv lv-title' }, h('span', { class: 'lv-kicker', text: v.kicker || '' }), h('h2', { class: 'lv-h', text: v.title }), v.sub ? h('p', { class: 'lv-sub', text: v.sub }) : null) });
  R.statement = (v) => ({ el: h('div', { class: 'lv lv-statement' }, v.lines.map((l, i) => step(i, h('p', { class: `lv-line${i ? ' lv-line--accent' : ''}`, text: l }))), v.sub ? step(Math.max(0, v.lines.length - 1), h('p', { class: 'lv-sub', text: v.sub })) : null) });
  R.numbers = (v) => ({ el: h('div', { class: 'lv lv-numbers' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-num-row' }, v.items.map((it, i) => step(i + 1, h('div', { class: 'lv-num' }, h('b', { text: it.value }), h('span', { text: it.label }))))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) });
  R.cards = (v) => ({ el: h('div', { class: 'lv lv-cards' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-card-row' }, v.cards.map((c, i) => step(i + 1, h('div', { class: 'lv-card' }, h('b', { text: c.title }), h('span', { class: 'lv-q', text: `“${c.q}”` }), h('span', { class: 'lv-fail', text: c.fail })))))) });
  R.anchor = (v) => {
    const row = (n, anchor, est) => step(n, h('div', { class: 'lv-anchor-row' }, h('span', { class: 'lv-anchor-wheel', text: String(anchor) }),
      h('div', { class: 'lv-anchor-bar' }, (() => { const f = h('i'); f.style.width = `${est}%`; return f; })()), h('span', { class: 'lv-anchor-est', text: `median estimate ${est}%` })));
    return { el: h('div', { class: 'lv lv-anchor' }, h('h3', { class: 'lv-t', text: v.title }), h('p', { class: 'lv-sub', text: `“${v.question}”` }), row(1, v.low, v.lowEstimate), row(2, v.high, v.highEstimate), h('p', { class: 'lv-note', text: 'The wheel was rigged to stop at one of two numbers. Tversky & Kahneman (1974).' })) };
  };
  R.tree = (v, params) => {
    const p = { ...v, ...(params || {}) };
    const N = p.population, ill = Math.round(N * p.prevalence), well = N - ill;
    const tp = Math.round(ill * p.sensitivity), fp = Math.round(well * p.falsePositive), pos = tp + fp;
    const ppv = pos ? tp / pos : 0;
    const n = (x) => x.toLocaleString('en-US');
    const node = (s, cls, big, small) => step(s, h('div', { class: `lv-node ${cls || ''}` }, h('b', { text: big }), h('span', { text: small })));
    return { el: h('div', { class: 'lv lv-tree' }, h('h3', { class: 'lv-t', text: v.title }),
      node(1, 'lv-node--root', n(N), 'people screened'),
      h('div', { class: 'lv-tree-row' }, node(2, '', n(ill), `have the condition (${Math.round(p.prevalence * 1000) / 10}%)`), node(2, '', n(well), 'do not')),
      h('div', { class: 'lv-tree-row lv-tree-row--4' }, node(3, 'lv-node--pos', n(tp), 'test positive'), node(3, 'lv-node--dim', n(ill - tp), 'test negative'), node(4, 'lv-node--pos lv-node--fp', n(fp), 'test positive'), node(4, 'lv-node--dim', n(well - fp), 'test negative')),
      step(5, h('div', { class: 'lv-result' }, h('span', { text: `${n(pos)} positives, ${n(tp)} actually ill` }), h('b', { text: `${Math.round(ppv * 100)}%` })))), ppv };
  };
  R.triples = (v) => ({ el: h('div', { class: 'lv lv-triples' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-triple' }, h('b', { text: v.example }), h('span', { class: 'lv-ok', text: 'fits the rule' })), step(1, h('p', { class: 'lv-sub', text: 'Propose sequences. You will be told only whether each fits the rule.' }))) });
  R.grid = (v) => {
    const cell = (s, text) => step(s, h('div', { class: 'lv-cell', text }));
    const at = (r, c) => v.order.findIndex(([cc, rr]) => cc === c && rr === r) + 2;
    return { el: h('div', { class: 'lv lv-grid' }, h('h3', { class: 'lv-t', text: v.title }),
      step(1, h('div', { class: 'lv-grid-tbl' }, h('span'), v.cols.map((c) => h('span', { class: 'lv-grid-h', text: c })),
        v.rows.map((row, r) => [h('span', { class: 'lv-grid-h lv-grid-h--row', text: row.label }), row.cells.map((t, c) => cell(at(r, c), t))])))) };
  };
  R.compare = (v) => ({ el: h('div', { class: 'lv lv-compare' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-cols' }, [v.left, v.right].map((side, i) => step(i + 1, h('div', { class: 'lv-col' }, h('b', { text: side.title }), h('ul', null, side.points.map((pt) => h('li', { text: pt })))))))) });
  R.replication = (v) => {
    const dots = h('div', { class: 'lv-dots', role: 'img', 'aria-label': `${v.replicated} of ${v.total} effects replicated consistently; ${v.failed} did not` });
    for (let i = 0; i < v.total; i++) dots.appendChild(h('i', { class: i < v.replicated ? 'is-rep' : i < v.replicated + v.failed ? 'is-fail' : 'is-other' }));
    return { el: h('div', { class: 'lv lv-replication', dataset: { r: '0' } }, h('h3', { class: 'lv-t', text: v.title }), step(1, h('p', { class: 'lv-sub', text: `${v.total} classic effects · ${v.samples} samples · many countries` })), step(1, dots),
      h('div', { class: 'lv-legend' }, step(2, h('span', { class: 'lg-rep', text: `${v.replicated} replicated consistently (including anchoring)` })), step(3, h('span', { class: 'lg-fail', text: `${v.failed} social-priming effects did not` })), step(3, h('span', { class: 'lg-other', text: 'the remaining effect: weaker support' }))),
      h('p', { class: 'lv-note', text: 'Many Labs replication project — Klein et al. (2014).' })) };
  };
  R.steps = (v) => ({ el: h('div', { class: 'lv lv-steps' }, h('h3', { class: 'lv-t', text: v.title }), h('ol', null, v.steps.map((s, i) => step(i + 1, h('li', { text: s }))))) });
  R.flow = (v) => ({ el: h('div', { class: 'lv lv-flow' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-flow-row' }, v.steps.map((x, i) => step(i + 1, h('div', { class: 'lv-flow-step' }, h('span', { class: 'lv-flow-n', text: String(i + 1).padStart(2, '0') }), h('b', { text: x.label }), x.text ? h('span', { text: x.text }) : null))))) });
  R.bars = (v) => {
    const max = Math.max(...v.items.map((i) => Math.abs(i.value)), 1e-9);
    return { el: h('div', { class: 'lv lv-bars' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-bars-g' }, v.items.map((it, i) => step(i + 1, h('div', { class: 'lv-bar' }, h('span', { class: 'lv-bar-l', text: it.label }), h('div', { class: 'lv-bar-t' }, (() => { const f = h('i'); f.style.width = `${(Math.abs(it.value) / max) * 100}%`; return f; })()), h('b', { class: 'lv-bar-v', text: `${it.value.toLocaleString('en-US')}${v.unit || ''}` }))))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) };
  };
  R.calc = (v) => ({ el: h('div', { class: 'lv lv-calc' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-calc-g' }, v.lines.map((ln, i) => step(i + 1, h('div', { class: 'lv-calc-line' }, h('span', { text: ln.label }), h('b', { class: 'num', text: ln.value })))), step(v.lines.length + 1, h('div', { class: 'lv-calc-line lv-calc-res' }, h('span', { text: v.result.label }), h('b', { class: 'num', text: v.result.value })))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) });
  R.matrix = (v) => ({ el: h('div', { class: 'lv lv-matrix' }, h('h3', { class: 'lv-t', text: v.title }),
    h('div', { class: 'lv-mx' }, h('span', { class: 'lv-mx-y', text: `${v.y[1]} ↑` }), step(1, h('div', { class: 'lv-cell', text: v.cells[0][0] })), step(2, h('div', { class: 'lv-cell', text: v.cells[0][1] })),
      h('span', { class: 'lv-mx-y', text: `${v.y[0]}` }), step(3, h('div', { class: 'lv-cell', text: v.cells[1][0] })), step(4, h('div', { class: 'lv-cell', text: v.cells[1][1] })),
      h('span'), h('span', { class: 'lv-mx-x', text: v.x[0] }), h('span', { class: 'lv-mx-x', text: `${v.x[1]} →` }))) });
  R.timeline = (v) => ({ el: h('div', { class: 'lv lv-timeline' }, h('h3', { class: 'lv-t', text: v.title }), h('ol', { class: 'lv-tl' }, v.events.map((e, i) => step(i + 1, h('li', null, h('b', { text: e.when }), h('span', { text: e.text })))))) });
  R.quote = (v) => ({ el: h('div', { class: 'lv lv-quote' }, h('p', { class: 'lv-quote-t', text: `“${v.text}”` }), step(1, h('p', { class: 'lv-quote-c', text: `— ${v.who}` }))) });
  R.definition = (v) => ({ el: h('div', { class: 'lv lv-def' }, h('span', { class: 'lv-kicker', text: v.kicker || 'Key concept' }), h('h2', { class: 'lv-h', text: v.term }), step(1, h('p', { class: 'lv-def-d', text: v.definition })), v.example ? step(2, h('p', { class: 'lv-sub', text: v.example })) : null) });
  /* ---- Course B: biomechanics visuals. Geometry and statistics are computed here, exactly, from the script's numbers. ---- */
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (name, attrs, text) => { const e = document.createElementNS(NS, name); for (const [k, x] of Object.entries(attrs || {})) e.setAttribute(k, x); if (text != null) e.textContent = text; return e; };
  const svgBox = (w, hh, label) => { const e = sv('svg', { viewBox: `0 0 ${w} ${hh}`, class: 'lv-svg', role: 'img', 'aria-label': label }); return e; };
  const DEG = Math.PI / 180;
  const mm = (A, B) => A.map((r, i) => B[0].map((_, j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
  const rotA = (ax, t) => { const c = Math.cos(t), s2 = Math.sin(t); return ax === 'X' ? [[1, 0, 0], [0, c, -s2], [0, s2, c]] : ax === 'Y' ? [[c, 0, s2], [0, 1, 0], [-s2, 0, c]] : [[c, -s2, 0], [s2, c, 0], [0, 0, 1]]; };
  const applyR = (Rm, v) => Rm.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const cl = (x) => Math.max(-1, Math.min(1, x));
  function eulerOf(seq, Rm) {
    if (seq === 'YXY') return [Math.atan2(Rm[0][1], Rm[2][1]) / DEG, Math.acos(cl(Rm[1][1])) / DEG, Math.atan2(Rm[1][0], -Rm[1][2]) / DEG];
    const I = { X: 0, Y: 1, Z: 2 }, p = I[seq[0]], q = I[seq[1]], r = I[seq[2]], e = (q - p + 3) % 3 === 1 ? 1 : -1;
    return [Math.atan2(-e * Rm[q][r], Rm[r][r]) / DEG, Math.asin(cl(e * Rm[p][r])) / DEG, Math.atan2(-e * Rm[p][q], Rm[p][p]) / DEG];
  }
  R.frame3d = (v) => {
    const s = svgBox(420, 300, `${v.title}: a segment rotated by the ${v.sequence} sequence`);
    const az = 35 * DEG, el = 18 * DEG, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const P = (q) => { const x = q[0] * ca - q[2] * sa, z = q[0] * sa + q[2] * ca; return [210 + x * 105, 165 - (q[1] * ce - z * se) * 105]; };
    const ln = (g, a, b, cls, w) => { const p = P(a), q = P(b); g.appendChild(sv('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: cls, 'stroke-width': w })); };
    const tx = (g, a, t, cls) => { const p = P(a); g.appendChild(sv('text', { x: p[0] + 4, y: p[1] - 4, class: cls }, t)); };
    const lab = sv('g');
    [['X', [1.3, 0, 0]], ['Y', [0, 1.3, 0]], ['Z', [0, 0, 1.3]]].forEach(([n, q]) => { ln(lab, [0, 0, 0], q, 'lv-gax', 1); tx(lab, q, (v.axisLabels && v.axisLabels[n]) || n, 'lv-glab'); });
    s.appendChild(lab);
    const segment = (Rm, cls) => { const g = sv('g', { class: cls }); const c = []; for (const x of [-0.1, 0.1]) for (const y of [-0.05, 1]) for (const z of [-0.1, 0.1]) c.push(applyR(Rm, [x, y, z])); [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => ln(g, c[a], c[b], 'lv-seg', 1.4)); [['x', [0.75, 0, 0], 'lv-lx'], ['y', [0, 1.1, 0], 'lv-ly'], ['z', [0, 0, 0.75], 'lv-lz']].forEach(([n, q, k]) => { const e = applyR(Rm, q); ln(g, [0, 0, 0], e, k, 2.4); tx(g, e, n, `lv-llab ${k}`); }); return g; };
    let Rm = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    s.appendChild(segment(Rm, 'lv-stage0'));
    const label = (k) => `${k}. ${v.sequence[k - 1]} ${v.angles[k - 1] >= 0 ? '+' : ''}${v.angles[k - 1]}°`;
    v.sequence.split('').forEach((ax, i) => { Rm = mm(Rm, rotA(ax, v.angles[i] * DEG)); const g = segment(Rm, `lv-stage lv-stage${i + 1}`); g.appendChild(sv('text', { x: 12, y: 22 + i * 18, class: 'lv-steplab' }, label(i + 1))); s.appendChild(step(i + 1, g)); });
    const extra = [];
    if (v.compare) {
      const a = eulerOf(v.compare, Rm), b = eulerOf(v.sequence, Rm);
      extra.push(step(4, h('table', { class: 'lv-angtab' }, h('tbody', null,
        h('tr', null, h('th', { text: `${v.sequence} (as set)` }), ...b.map((x) => h('td', { class: 'num', text: `${x.toFixed(1)}°` }))),
        h('tr', null, h('th', { text: `${v.compare} (same orientation)` }), ...a.map((x) => h('td', { class: 'num', text: `${x.toFixed(1)}°` })))))));
    }
    return { el: h('div', { class: 'lv lv-frame3d' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-svgwrap' }, s), ...extra, v.note ? h('p', { class: 'lv-note', text: v.note }) : null) };
  };
  R.curves = (v) => {
    const s = svgBox(440, 260, v.title);
    const xs = v.series.flatMap((q) => q.points.map((p) => p[0])), ys = v.series.flatMap((q) => q.points.map((p) => p[1])).concat(v.yMin ?? [], v.yMax ?? []);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, 0), y1 = Math.max(...ys);
    const X = (x) => 52 + ((x - x0) / (x1 - x0 || 1)) * 370, Y = (y) => 220 - ((y - y0) / (y1 - y0 || 1)) * 195;
    s.appendChild(sv('line', { x1: 52, y1: Y(Math.max(y0, 0)), x2: 425, y2: Y(Math.max(y0, 0)), class: 'lv-gax' }));
    s.appendChild(sv('line', { x1: 52, y1: 20, x2: 52, y2: 222, class: 'lv-gax' }));
    s.appendChild(sv('text', { x: 425, y: 248, 'text-anchor': 'end', class: 'lv-glab' }, `${v.xLabel} →`));
    s.appendChild(sv('text', { x: 6, y: 14, class: 'lv-glab' }, v.yLabel));
    [x0, x1].forEach((x) => s.appendChild(sv('text', { x: X(x), y: 236, 'text-anchor': 'middle', class: 'lv-glab' }, String(x))));
    [y0, y1].forEach((y) => s.appendChild(sv('text', { x: 46, y: Y(y) + 3, 'text-anchor': 'end', class: 'lv-glab' }, String(Math.round(y * 100) / 100))));
    (v.markers || []).forEach((m) => { s.appendChild(sv('line', { x1: X(m.x), y1: 20, x2: X(m.x), y2: 220, class: 'lv-gax', 'stroke-dasharray': '3 4' })); s.appendChild(sv('text', { x: X(m.x) + 3, y: 30, class: 'lv-glab' }, m.label)); });
    v.series.forEach((q, i) => { const g = sv('g', { class: `lv-ser lv-ser${i % 4}` }); g.appendChild(sv('path', { d: q.points.map((p, j) => `${j ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(''), class: 'lv-curve' })); const pk = q.points.reduce((a, b) => (b[1] > a[1] ? b : a)); g.appendChild(sv('text', { x: X(pk[0]) + 4, y: Y(pk[1]) - 5, class: 'lv-llab' }, q.label)); s.appendChild(step(i + 1, g)); });
    return { el: h('div', { class: 'lv lv-curves' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-svgwrap' }, s), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) };
  };
  R.torque = (v) => {
    const tau = v.arm * v.force * Math.sin(v.angle * DEG), d = v.arm * Math.sin(v.angle * DEG);
    const s = svgBox(420, 240, `${v.title}: moment of a force about an axis`);
    const ox = 80, oy = 170, px = ox + 240, ux = Math.cos(-v.angle * DEG), uy = Math.sin(-v.angle * DEG);
    s.appendChild(sv('circle', { cx: ox, cy: oy, r: 6, class: 'lv-dot' })); s.appendChild(sv('text', { x: ox - 22, y: oy + 24, class: 'lv-glab' }, v.axisLabel || 'axis'));
    const g1 = sv('g'); g1.appendChild(sv('line', { x1: ox, y1: oy, x2: px, y2: oy, class: 'lv-seg', 'stroke-width': 6 })); g1.appendChild(sv('text', { x: (ox + px) / 2 - 20, y: oy + 22, class: 'lv-glab' }, `r = ${v.arm} m`)); s.appendChild(step(1, g1));
    const g2 = sv('g'); g2.appendChild(sv('line', { x1: px, y1: oy, x2: px + 110 * ux, y2: oy + 110 * uy, class: 'lv-lx', 'stroke-width': 3.5 })); g2.appendChild(sv('circle', { cx: px + 110 * ux, cy: oy + 110 * uy, r: 4, class: 'lv-dotx' })); g2.appendChild(sv('text', { x: px + 110 * ux + 6, y: oy + 110 * uy, class: 'lv-llab lv-lx' }, `F = ${v.force} N at ${v.angle}°`)); s.appendChild(step(2, g2));
    const t = (ox - px) * ux, qx = px + t * ux, qy = oy + t * uy;
    const g3 = sv('g'); g3.appendChild(sv('line', { x1: px - 260 * ux, y1: oy - 260 * uy, x2: px + 120 * ux, y2: oy + 120 * uy, class: 'lv-gax', 'stroke-dasharray': '3 4' })); g3.appendChild(sv('line', { x1: ox, y1: oy, x2: qx, y2: qy, class: 'lv-ly', 'stroke-width': 2.4 })); s.appendChild(step(3, g3));
    return { el: h('div', { class: 'lv lv-torque' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-svgwrap' }, s),
      step(3, h('p', { class: 'lv-calc-line lv-calc-res' }, h('span', { text: `τ = r · F · sin θ = ${v.arm} × ${v.force} × sin ${v.angle}° · moment arm ${d.toFixed(3)} m` }), h('b', { class: 'num', text: `${tau.toFixed(1)} N·m` }))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) };
  };
  R.agreement = (v) => {
    const diffs = v.pairs.map((p) => p[1] - p[0]), means = v.pairs.map((p) => (p[0] + p[1]) / 2);
    const m = diffs.reduce((a, b) => a + b, 0) / diffs.length, sd = Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / (diffs.length - 1));
    const lo = m - 1.96 * sd, hi = m + 1.96 * sd, u = v.unit || '';
    const s = svgBox(440, 250, `${v.title}: Bland–Altman plot`);
    const x0 = Math.min(...means) - 1, x1 = Math.max(...means) + 1, y0 = Math.min(...diffs, lo, 0) - 1, y1 = Math.max(...diffs, hi, 0) + 1;
    const X = (x) => 52 + ((x - x0) / (x1 - x0)) * 370, Y = (y) => 215 - ((y - y0) / (y1 - y0)) * 190;
    s.appendChild(sv('line', { x1: 52, y1: Y(0), x2: 425, y2: Y(0), class: 'lv-gax', 'stroke-dasharray': '2 4' }));
    s.appendChild(sv('text', { x: 425, y: 244, 'text-anchor': 'end', class: 'lv-glab' }, `mean of the two systems (${u}) →`)); s.appendChild(sv('text', { x: 6, y: 14, class: 'lv-glab' }, `${v.labels ? `${v.labels[1]} − ${v.labels[0]}` : 'B − A'} (${u})`));
    const g1 = sv('g'); means.forEach((x, i) => g1.appendChild(sv('circle', { cx: X(x), cy: Y(diffs[i]), r: 3.5, class: 'lv-dotx' }))); s.appendChild(step(1, g1));
    const line = (yv, t, cls) => { const g = sv('g'); g.appendChild(sv('line', { x1: 52, y1: Y(yv), x2: 425, y2: Y(yv), class: cls, 'stroke-width': 1.6 })); g.appendChild(sv('text', { x: 300, y: Y(yv) - 4, class: `lv-llab ${cls}` }, `${t} ${yv.toFixed(1)}${u}`)); return g; };
    s.appendChild(step(2, line(m, 'bias', 'lv-lx')));
    const g3 = sv('g'); g3.appendChild(line(lo, '−1.96 SD', 'lv-ly')); g3.appendChild(line(hi, '+1.96 SD', 'lv-ly')); s.appendChild(step(3, g3));
    return { el: h('div', { class: 'lv lv-agree' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-svgwrap' }, s),
      step(3, h('p', { class: 'lv-calc-line lv-calc-res' }, h('span', { text: `n = ${diffs.length} · bias ${m.toFixed(2)}${u} · SD of differences ${sd.toFixed(2)}${u}` }), h('b', { class: 'num', text: `LoA ${lo.toFixed(1)} to ${hi.toFixed(1)}${u}` }))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) };
  };
  R.next = (v) => ({ el: h('div', { class: 'lv lv-next' }, h('h3', { class: 'lv-t', text: v.title }), step(1, h('div', { class: 'lv-next-row' }, v.items.map((it) => h('a', { class: 'lv-next-item', href: it.href || '#', dataset: { href: it.href || '' } }, h('b', { text: it.label }), h('span', { text: it.detail })))))) });

  /* ---------------- player ---------------- */
  function mount(root, { lecture: L, saved, onSave, onComplete, onCheckpoint, settings }) {
    const st = { position: 0, furthest: 0, completed: false, rate: 1, responses: {}, seconds: 0, ...(saved || {}) };
    const prefs = { captions: !(settings && settings.captions === false), audioOnly: false };
    const cues = [], scenes = [], checkpoints = [];
    L.chapters.forEach((ch, ci) => ch.scenes.forEach((sc) => {
      const s = { ...sc, chapter: ci, index: scenes.length };
      scenes.push(s);
      sc.cues.forEach((c) => cues.push({ ...c, scene: s.index, chapter: ci, index: cues.length }));
      if (sc.checkpoint) checkpoints.push({ ...sc.checkpoint, scene: s.index });
    }));
    const probe = document.createElement('audio');
    const primaryOk = L.audio.endsWith('.mp3') ? probe.canPlayType('audio/mpeg') : probe.canPlayType('audio/mp4; codecs="mp4a.40.2"');
    const src = !primaryOk && L.audioAlt ? L.audioAlt : L.audio;
    // The narration is fetched whole and played from an in-memory blob: that makes seeking,
    // checkpoints and resume work on every host (some static hosts ignore HTTP Range requests,
    // which Safari needs for seeking). If the fetch fails, fall back to streaming the file.
    const audio = h('audio', { preload: 'none' });
    let blobUrl = null, ready = false;
    audio.playbackRate = st.rate;
    const handled = new Set(Object.keys(st.responses));
    let curScene = -1, curReveal = -1, curCue = -1, active = null, raf = 0, lastTick = 0, saveT = 0, destroyed = false;

    /* layout */
    const sceneHost = h('div', { class: 'lec-scene', 'aria-hidden': 'true' });
    const caption = h('div', { class: 'lec-cap', 'aria-hidden': 'true' });
    const cpHost = h('div', { class: 'lec-cp', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Checkpoint' });
    const bigLabel = h('span', { text: 'Loading narration…' });
    const bigPlay = h('button', { class: 'lec-bigplay', 'aria-label': 'Play lecture', disabled: true, onclick: () => toggle() }, bigLabel);
    const readyLabel = () => (st.position > 2 ? `Resume at ${fmt(st.position)}` : 'Play lecture');
    (async () => {
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const total = Number(res.headers.get('Content-Length')) || L.audioBytes || 0;
        const reader = res.body.getReader(); const chunks = []; let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) bigLabel.textContent = `Loading narration… ${Math.min(99, Math.round((got / total) * 100))}%`; if (destroyed) return; }
        blobUrl = URL.createObjectURL(new Blob(chunks, { type: src.endsWith('.webm') ? 'audio/webm' : src.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4' }));
        audio.src = blobUrl;
      } catch { audio.src = src; }
      audio.preload = 'auto'; audio.load();
      ready = true; bigPlay.disabled = false; bigLabel.textContent = readyLabel();
    })();
    const stage = h('div', { class: 'lec-stage' }, sceneHost, caption, bigPlay, cpHost);
    const playBtn = h('button', { class: 'lec-btn lec-play', 'aria-label': 'Play', onclick: () => toggle() }, h('span', { class: 'lec-ico', text: '▶' }));
    const back = h('button', { class: 'lec-btn', 'aria-label': 'Back 10 seconds', onclick: () => seek(audio.currentTime - 10), text: '−10' });
    const fwd = h('button', { class: 'lec-btn', 'aria-label': 'Forward 10 seconds', onclick: () => seek(audio.currentTime + 10), text: '+10' });
    const time = h('span', { class: 'lec-time num', text: `0:00 / ${fmt(L.duration)}` });
    const scrub = h('input', { type: 'range', class: 'lec-scrub', min: 0, max: Math.round(L.duration * 10), step: 1, value: Math.round(st.position * 10), 'aria-label': 'Seek', 'aria-valuetext': '0:00' });
    scrub.addEventListener('input', () => seek(Number(scrub.value) / 10));
    const ticks = h('div', { class: 'lec-ticks', 'aria-hidden': 'true' }, L.chapters.map((ch) => { const t = h('i'); t.style.left = `${(ch.start / L.duration) * 100}%`; return t; }),
      checkpoints.map((cp) => { const t = h('b'); t.style.left = `${(cp.at / L.duration) * 100}%`; return t; }));
    const rate = h('select', { class: 'lec-select', 'aria-label': 'Playback speed', onchange: (e) => { st.rate = Number(e.target.value); audio.playbackRate = st.rate; persist(); } }, RATES.map((r) => h('option', { value: String(r), selected: r === st.rate, text: `${r}×` })));
    const ccBtn = h('button', { class: 'lec-btn', 'aria-pressed': String(prefs.captions), onclick: () => { prefs.captions = !prefs.captions; ccBtn.setAttribute('aria-pressed', String(prefs.captions)); caption.hidden = !prefs.captions; }, text: 'CC', title: 'Captions' });
    const aoBtn = h('button', { class: 'lec-btn', 'aria-pressed': 'false', onclick: () => setAudioOnly(!prefs.audioOnly), text: 'Audio only' });
    const trBtn = h('button', { class: 'lec-btn', 'aria-expanded': 'false', onclick: () => { const open = side.classList.toggle('is-open'); trBtn.setAttribute('aria-expanded', String(open)); if (open) scrollTranscript(true); }, text: 'Transcript' });
    const controls = h('div', { class: 'lec-controls' }, h('div', { class: 'lec-scrubwrap' }, ticks, scrub), h('div', { class: 'lec-row' }, h('div', { class: 'lec-grp' }, playBtn, back, fwd, time), h('div', { class: 'lec-grp' }, rate, ccBtn, trBtn, aoBtn)));
    const chapList = h('ol', { class: 'lec-chapters' }, L.chapters.map((ch, i) => h('li', null, h('button', { onclick: () => { seek(ch.start); play(); }, dataset: { ch: String(i) } }, h('span', { class: 'num', text: fmt(ch.start) }), h('b', { text: ch.title })))));
    const trList = h('ol', { class: 'lec-transcript' });
    L.chapters.forEach((ch, ci) => {
      trList.appendChild(h('li', { class: 'lec-tr-ch', text: ch.title }));
      cues.filter((c) => c.chapter === ci).forEach((c) => trList.appendChild(h('li', null, h('button', { dataset: { cue: String(c.index) }, onclick: () => { seek(c.start + 0.01); play(); } }, h('span', { class: 'num', text: fmt(c.start) }), h('span', { text: c.text })))));
    });
    const side = h('aside', { class: 'lec-side' }, h('div', { class: 'lec-side-h' }, h('span', { class: 'label', text: 'Transcript' }), h('a', { class: 'small', href: L.transcriptFile, download: '', text: 'Download' }), h('a', { class: 'small', href: L.captions, download: '', text: 'Captions (.vtt)' })), trList);
    const live = h('div', { class: 'sr', 'aria-live': 'polite' });
    const el = h('div', { class: 'lec', tabindex: '-1' }, h('div', { class: 'lec-main' }, stage, controls, h('div', { class: 'lec-under' }, h('div', null, h('span', { class: 'label', text: 'Chapters' }), chapList), refsPanel())), side, live, audio);
    root.appendChild(el);

    function refsPanel() {
      const refs = (L.refs || []).map((id) => AP.cache.libIndex && AP.cache.libIndex.get(id)).filter(Boolean);
      return h('div', null, h('span', { class: 'label', text: 'Sources in this lecture' }), h('ul', { class: 'lec-refs' }, refs.map((r) => h('li', null, h('a', { href: `#/library/${r.id}`, text: r.title }), h('span', { class: 'small muted', text: ` ${AP.shortRef(r.id)} · ${r.evidence}` })))),
        h('p', { class: 'small muted', text: `Narration: ${L.narration.engine}, synthesized for APERTURE. Visuals are original; numbers in examples are synthetic unless a source is cited.` }));
    }

    /* rendering */
    function renderScene(i) {
      curScene = i; curReveal = -1;
      const s = scenes[i];
      const r = (R[s.visual.type] || R.statement)(s.visual);
      AP.clear(sceneHost).appendChild(r.el);
      sceneHost.classList.remove('is-in'); void sceneHost.offsetWidth; sceneHost.classList.add('is-in');
      chapList.querySelectorAll('button').forEach((b) => b.classList.toggle('is-current', Number(b.dataset.ch) === s.chapter));
    }
    function applyReveal(n) {
      if (n === curReveal) return;
      curReveal = n;
      sceneHost.querySelectorAll('.lv-step').forEach((e) => e.classList.toggle('is-on', Number(e.dataset.step) <= n));
    }
    function sync(t) {
      // cue at t (last cue started)
      let ci = -1;
      for (let i = 0; i < cues.length; i++) { if (cues[i].start <= t + 0.02) ci = i; else break; }
      let si = 0;
      for (let i = 0; i < scenes.length; i++) if (scenes[i].start <= t + 0.02) si = i;
      if (si !== curScene) renderScene(si);
      let rv = 0;
      for (const c of cues) if (c.scene === si && c.start <= t + 0.02 && c.reveal != null) rv = Math.max(rv, c.reveal);
      applyReveal(rv);
      const showCue = ci >= 0 && cues[ci].scene === si && t <= cues[ci].end + 0.25 ? ci : -1;
      if (showCue !== curCue) {
        curCue = showCue;
        caption.textContent = showCue >= 0 ? cues[showCue].text : '';
        trList.querySelectorAll('button.is-current').forEach((b) => b.classList.remove('is-current'));
        if (showCue >= 0) { const b = trList.querySelector(`button[data-cue="${showCue}"]`); if (b) b.classList.add('is-current'); scrollTranscript(false); }
      }
      time.textContent = `${fmt(t)} / ${fmt(L.duration)}`;
      if (document.activeElement !== scrub) { scrub.value = String(Math.round(t * 10)); scrub.setAttribute('aria-valuetext', fmt(t)); }
    }
    function scrollTranscript(force) {
      if (!side.classList.contains('is-open') && !prefs.audioOnly) return;
      const b = trList.querySelector('button.is-current'); if (!b) return;
      const top = b.offsetTop - trList.offsetTop - trList.clientHeight / 3;
      if (force || Math.abs(trList.scrollTop - top) > trList.clientHeight / 3) trList.scrollTop = top;
    }

    /* clock */
    function tick() {
      const t = audio.currentTime;
      const now = performance.now();
      if (!audio.paused) st.seconds += (now - lastTick) / 1000;
      lastTick = now;
      // Checkpoint gate: pause at its time the first time it is reached.
      const cp = checkpoints.find((c) => !handled.has(c.id) && t >= c.at - 0.05 && t < c.at + 1.5);
      if (cp && !active) { audio.pause(); audio.currentTime = cp.at; openCheckpoint(cp); }
      sync(audio.currentTime);
      if (t > st.furthest) st.furthest = t;
      st.position = t;
      if (!st.completed && st.furthest >= L.duration * 0.92) { st.completed = true; persist(true); onComplete && onComplete(st); live.textContent = 'Lecture complete.'; }
      if (now - saveT > 5000) { saveT = now; persist(); }
    }
    function play() {
      if (active || !ready) return;
      bigPlay.hidden = true;
      const p = audio.play();
      if (p && p.catch) p.catch(() => { bigPlay.hidden = false; });
    }
    function pause() { audio.pause(); }
    function toggle() { if (audio.paused) play(); else pause(); }
    function seek(t) {
      t = Math.max(0, Math.min(L.duration - 0.05, t));
      if (active) closeCheckpoint();
      // Seeking past a checkpoint never forces it; it stays available from the chapter list.
      for (const c of checkpoints) if (c.at < t - 0.5) handled.add(c.id);
      for (const c of checkpoints) if (c.at >= t - 0.05 && !st.responses[c.id]) handled.delete(c.id);
      audio.currentTime = t; st.position = t; sync(t);
    }
    audio.addEventListener('play', () => { playBtn.firstChild.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); lastTick = performance.now(); clearInterval(raf); raf = setInterval(tick, 100); el.classList.add('is-playing'); });
    audio.addEventListener('timeupdate', () => { if (!audio.paused) tick(); });
    audio.addEventListener('pause', () => { playBtn.firstChild.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); clearInterval(raf); el.classList.remove('is-playing'); persist(); sync(audio.currentTime); });
    audio.addEventListener('ended', () => { st.furthest = L.duration; tick(); persist(true); });
    audio.addEventListener('loadedmetadata', () => { if (st.position > 0 && st.position < L.duration - 1) audio.currentTime = st.position; sync(st.position); });
    audio.addEventListener('error', () => { AP.clear(cpHost); cpHost.hidden = false; cpHost.appendChild(h('div', { class: 'lec-cp-box' }, h('p', { text: 'The narration could not be loaded. Check your connection, or read the written lesson.' }))); });

    /* checkpoints (formative) */
    function openCheckpoint(cp) {
      active = cp;
      cpHost.hidden = false; el.classList.add('has-cp');
      AP.clear(cpHost);
      const box = h('div', { class: 'lec-cp-box' }, h('span', { class: 'label label--accent', text: { estimate: 'Pause and predict', choice: 'Decide', explore: 'Explore', reflect: 'Reflect' }[cp.type] || 'Checkpoint' }), h('p', { class: 'lec-cp-q', text: cp.prompt }));
      const fb = h('div', { class: 'lec-cp-fb', 'aria-live': 'polite' });
      const cont = h('button', { class: 'btn btn--primary', onclick: () => { closeCheckpoint(); play(); }, text: 'Continue the lecture' });
      const skip = h('button', { class: 'btn btn--quiet', onclick: () => { handled.add(cp.id); closeCheckpoint(); play(); }, text: 'Skip' });
      const record = (value, correct) => { st.responses[cp.id] = { value, correct, at: Date.now() }; handled.add(cp.id); persist(true); onCheckpoint && onCheckpoint(cp, st.responses[cp.id]); };
      const prev = st.responses[cp.id];
      if (cp.type === 'estimate') {
        const out = h('output', { class: 'lec-est-out num', text: `${prev ? prev.value : cp.initial}${cp.unit || ''}` });
        const rng = h('input', { type: 'range', min: cp.min, max: cp.max, step: cp.step || 1, value: prev ? prev.value : cp.initial, 'aria-label': cp.prompt, oninput: (e) => { out.textContent = `${e.target.value}${cp.unit || ''}`; } });
        const lock = h('button', { class: 'btn btn--primary', text: 'Lock in my estimate', onclick: () => {
          const v = Number(rng.value); const ok = Math.abs(v - cp.answer) <= (cp.tolerance || 0);
          record(v, ok); rng.disabled = true; lock.remove();
          AP.clear(fb).append(h('p', null, h('b', { text: `You said ${v}${cp.unit || ''}. ` }), cp.feedback[ok ? 'correct' : 'incorrect'])); actions.prepend(cont); skip.remove(); cont.focus();
        } });
        box.append(h('div', { class: 'lec-est' }, rng, out), fb);
        var actions = h('div', { class: 'row' }, lock, skip);
        box.appendChild(actions);
      } else if (cp.type === 'choice' || cp.type === 'explore') {
        let tree = null, treeHost = null;
        if (cp.type === 'explore') {
          const scene = scenes[cp.scene]; let idx = cp.control.values.indexOf(scene.visual.prevalence); if (idx < 0) idx = 0;
          treeHost = h('div', { class: 'lec-explore' });
          const lab = h('span', { class: 'num' });
          const draw = () => { const r = R.tree(scene.visual, { [cp.control.param]: cp.control.values[idx] }); AP.clear(treeHost).appendChild(r.el); r.el.querySelectorAll('.lv-step').forEach((e) => e.classList.add('is-on')); lab.textContent = `${Math.round(cp.control.values[idx] * 1000) / 10}%`; };
          const rng = h('input', { type: 'range', min: 0, max: cp.control.values.length - 1, step: 1, value: idx, 'aria-label': cp.control.label, oninput: (e) => { idx = Number(e.target.value); draw(); } });
          draw();
          box.append(h('div', { class: 'lec-est' }, h('span', { class: 'label', text: cp.control.label }), rng, lab), treeHost);
        }
        const opts = h('div', { class: 'lec-opts' });
        cp.options.forEach((o) => opts.appendChild(h('button', { class: 'choice', dataset: { id: o.id }, onclick: () => {
          const ok = o.id === cp.answer; record(o.id, ok);
          opts.querySelectorAll('button').forEach((b) => { b.disabled = true; if (b.dataset.id === cp.answer) b.classList.add('is-correct'); else if (b.dataset.id === o.id) b.classList.add('is-wrong'); });
          AP.clear(fb).append(h('p', null, h('b', { text: ok ? 'Yes. ' : 'Not quite. ' }), cp.feedback[o.id])); actions.prepend(cont); skip.remove(); cont.focus();
        } }, h('span', { text: o.text }))));
        box.append(opts, fb);
        var actions = h('div', { class: 'row' }, skip);
        box.appendChild(actions);
      } else if (cp.type === 'reflect') {
        const ta = h('textarea', { 'aria-label': cp.prompt, placeholder: 'A few sentences. Private to you; saved to this lecture.', value: prev && typeof prev.value === 'string' ? prev.value : '' });
        const saveBtn = h('button', { class: 'btn btn--primary', text: 'Save and continue', onclick: () => { if (ta.value.trim()) record(ta.value.trim(), null); closeCheckpoint(); play(); } });
        box.append(ta, h('div', { class: 'row' }, saveBtn, skip), h('p', { class: 'small muted', text: 'Formative: nothing here is graded.' }));
      }
      cpHost.appendChild(box);
      live.textContent = 'Checkpoint. The lecture is paused.';
      const first = box.querySelector('input, button.choice, textarea, button'); if (first) first.focus({ preventScroll: true });
    }
    function closeCheckpoint() { if (active) handled.add(active.id); active = null; cpHost.hidden = true; AP.clear(cpHost); el.classList.remove('has-cp'); }

    function setAudioOnly(on) {
      prefs.audioOnly = on; aoBtn.setAttribute('aria-pressed', String(on)); el.classList.toggle('is-audio', on);
      if (on) { side.classList.add('is-open'); trBtn.setAttribute('aria-expanded', 'true'); scrollTranscript(true); }
    }

    function persist(now) {
      clearTimeout(persist.t);
      const write = () => onSave && onSave({ position: Math.round(st.position * 10) / 10, furthest: Math.round(st.furthest * 10) / 10, duration: L.duration, completed: st.completed, rate: st.rate, responses: st.responses, seconds: Math.round(st.seconds) });
      if (now) write(); else persist.t = setTimeout(write, 400);
    }

    /* keyboard: active only when focus is inside the player */
    function onKey(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range') return;
      if (active && e.key !== 'Escape') return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft' && e.target.type !== 'range') { seek(audio.currentTime - 5); }
      else if (e.key === 'ArrowRight' && e.target.type !== 'range') { seek(audio.currentTime + 5); }
      else if (e.key === 'j') seek(audio.currentTime - 10);
      else if (e.key === 'l') seek(audio.currentTime + 10);
      else if (e.key === 'c') ccBtn.click();
    }
    document.addEventListener('keydown', onKey);

    /* lock-screen controls for audio-only listening */
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title: L.title, artist: 'APERTURE', album: 'Semester I lectures' });
        navigator.mediaSession.setActionHandler('play', play); navigator.mediaSession.setActionHandler('pause', pause);
        navigator.mediaSession.setActionHandler('seekbackward', () => seek(audio.currentTime - 10)); navigator.mediaSession.setActionHandler('seekforward', () => seek(audio.currentTime + 10));
      } catch {}
    }

    sync(st.position);
    return {
      el, audio, play, pause, seek, state: () => ({ ...st }),
      destroy() { if (destroyed) return; destroyed = true; persist(true); audio.pause(); clearInterval(raf); document.removeEventListener('keydown', onKey); audio.removeAttribute('src'); audio.load(); if (blobUrl) URL.revokeObjectURL(blobUrl); },
    };
  }

  AP.Lecture = { mount, renderers: R };
})();
