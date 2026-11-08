/* Decision Lab — field diagrams. One SVG field (home plate at the bottom), runners as dots, the ball and the throw as
   restrained animations. The scene stops at the decision point; the outcome plays only after the user decides.
   Under prefers-reduced-motion every animation jumps to its end state. */
const NS = 'http://www.w3.org/2000/svg';
// coordinates: home (200, 380); 90 ft ≈ 82 units
const P = { H: [200, 380], '1': [258, 322], '2': [200, 264], '3': [142, 322] };
const OFPOS = { '7': [95, 175], '8': [200, 120], '9': [305, 175] };
const DEPTH = { shallow: 0.72, medium: 1, deep: 1.22 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (n, a = {}, kids = []) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); kids.forEach((c) => e.appendChild(c)); return e; };

export function fieldSVG({ compact = false } = {}) {
  const svg = el('svg', { viewBox: compact ? '80 230 240 175' : '0 40 400 360', class: 'field', role: 'img', 'aria-label': 'Field diagram' });
  svg.appendChild(el('path', { d: 'M200 380 L-10 170 A300 300 0 0 1 410 170 Z', class: 'f-grass' }));
  svg.appendChild(el('path', { d: 'M200 380 L95 275 A148 148 0 0 1 305 275 Z', class: 'f-dirt' }));
  svg.appendChild(el('path', { d: 'M200 380 L258 322 L200 264 L142 322 Z', class: 'f-infield' }));
  svg.appendChild(el('path', { d: 'M200 380 L-10 170 M200 380 L410 170', class: 'f-line' }));
  svg.appendChild(el('circle', { cx: 200, cy: 330, r: 7, class: 'f-mound' }));
  for (const b of ['1', '2', '3']) svg.appendChild(el('rect', { x: P[b][0] - 6, y: P[b][1] - 6, width: 12, height: 12, transform: `rotate(45 ${P[b][0]} ${P[b][1]})`, class: 'f-base', 'data-base': b }));
  svg.appendChild(el('path', { d: 'M193 376 h14 v5 l-7 7 l-7 -7 z', class: 'f-plate' }));
  svg.appendChild(el('g', { class: 'f-layer' }));
  return svg;
}
/* draw runners (bit mask or {1,2,3: label}), and an optional outfielder marker */
export function drawSituation(svg, { bases = 0, labels = {}, fielder = null, depth = 'medium', infield = null } = {}) {
  const layer = svg.querySelector('.f-layer'); layer.innerHTML = '';
  svg.querySelectorAll('.f-base').forEach((b) => b.classList.toggle('on', !!(bases & (1 << (+b.dataset.base - 1)))));
  if (infield) for (const [x, y] of infieldSpots(infield)) layer.appendChild(el('circle', { cx: x, cy: y, r: 5, class: 'f-fielder' }));
  if (fielder) { const [x, y] = ofSpot(fielder, depth); layer.appendChild(el('circle', { cx: x, cy: y, r: 6, class: 'f-fielder of' })); }
  for (const b of ['1', '2', '3']) if (bases & (1 << (+b - 1))) {
    const g = el('g', { class: 'f-runner', 'data-on': b, transform: `translate(${P[b][0]} ${P[b][1] - 13})` });
    g.appendChild(el('circle', { r: 7 }));
    if (labels[b]) { const t = el('text', { y: -11, 'text-anchor': 'middle' }); t.textContent = labels[b]; g.appendChild(t); }
    layer.appendChild(g);
  }
}
function infieldSpots(kind) {       // infield in / back / corners-in: where the four infielders stand
  const back = [[245, 282], [222, 262], [178, 262], [155, 282]], inn = [[236, 312], [214, 300], [186, 300], [164, 312]];
  if (kind === 'in') return inn; if (kind === 'back') return back;
  return [inn[0], back[1], back[2], inn[3]];
}
const ofSpot = (pos, depth) => { const [x, y] = OFPOS[pos] || OFPOS['8'], k = DEPTH[depth] || 1; return [200 + (x - 200) * k, 380 + (y - 380) * k]; };

/* tween an SVG element's translate along points */
function move(node, pts, ms) {
  return new Promise((res) => {
    if (reduced() || ms <= 0) { const [x, y] = pts[pts.length - 1]; node.setAttribute('transform', `translate(${x} ${y})`); return res(); }
    const segs = []; let tot = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); tot += d; }
    const t0 = performance.now();
    const step = (t) => {
      let k = Math.min(1, (t - t0) / ms), dist = k * tot, i = 0;
      while (i < segs.length - 1 && dist > segs[i]) { dist -= segs[i]; i++; }
      const f = segs[i] ? dist / segs[i] : 1, a = pts[i], b = pts[i + 1] || a;
      node.setAttribute('transform', `translate(${a[0] + (b[0] - a[0]) * f} ${a[1] + (b[1] - a[1]) * f})`);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
const ball = (svg, at) => { const b = el('circle', { r: 3.4, class: 'f-ball', transform: `translate(${at[0]} ${at[1]})` }); svg.querySelector('.f-layer').appendChild(b); return b; };
const runnerAt = (svg, base) => svg.querySelector(`.f-runner[data-on="${base}"]`);
const lift = ([x, y]) => [x, y - 13];

/* the lead-up to a third-base decision: hit to the outfield, the runner heads for third. Resolves at the decision point. */
export async function playUpTo(svg, { family, pos = '8', depth = 'medium' }) {
  const spot = ofSpot(pos, depth), b = ball(svg, P.H);
  if (family === 'tag') {                                   // fly ball: the runner waits on third for the catch
    await move(b, [P.H, [(P.H[0] + spot[0]) / 2, Math.min(P.H[1], spot[1]) - 60], spot], 900);
    return;
  }
  const r = runnerAt(svg, family === 'send1' ? '1' : '2');
  const path = family === 'send1' ? [lift(P['1']), lift(P['2']), lift([P['3'][0] + 10, P['3'][1] + 4])] : [lift(P['2']), lift([P['3'][0] + 10, P['3'][1] + 4])];
  await Promise.all([move(b, [P.H, spot], 900), r ? move(r, path, 1200) : null]);
}
/* the outcome after the decision */
export async function playOutcome(svg, { family, pos = '8', depth = 'medium', choice, success }) {
  const spot = ofSpot(pos, depth), lead = family === 'tag' ? '3' : family === 'send1' ? '1' : '2';
  const r = runnerAt(svg, lead), b = svg.querySelector('.f-ball') || ball(svg, spot);
  const go = choice === 'send' || choice === 'tag';
  if (!go) { if (r && family !== 'tag') await move(r, [r.getAttribute('transform').match(/[-\d.]+/g).map(Number), lift(P['3'])], 400); return; }
  const from = r ? r.getAttribute('transform').match(/[-\d.]+/g).map(Number) : lift(P['3']);
  const runEnd = success ? [P.H[0] - 2, P.H[1] - 6] : [P.H[0] - 24, P.H[1] - 30];
  const relay = family === 'send1' ? [[(spot[0] + 200) / 2, (spot[1] + 300) / 2]] : [];
  await Promise.all([r ? move(r, [from, runEnd], 1300) : null, move(b, [spot, ...relay, [P.H[0] + 4, P.H[1] - 8]], success ? 1450 : 1100)]);
  if (r) r.classList.add(success ? 'safe' : 'out');
}
/* steals, bunts and infield plays: a short schematic */
export async function playSimple(svg, { family, success, outcome }) {
  if (family === 'steal' || family === 'steal3') {
    const from = family === 'steal' ? '1' : '2', to = family === 'steal' ? '2' : '3', r = runnerAt(svg, from);
    const b = ball(svg, P.H);
    await Promise.all([r ? move(r, [lift(P[from]), lift(P[to])], 1100) : null, move(b, [P.H, [P[to][0], P[to][1] + 2]], success ? 1250 : 950)]);
    if (r) r.classList.add(success ? 'safe' : 'out');
    return;
  }
  const b = ball(svg, P.H);
  const target = family === 'bunt' ? [214, 352] : outcome && /through|single|hit/i.test(outcome) ? [255, 230] : [222, 300];
  await move(b, [P.H, target], 700);
}
