/*!
 * APERTURE — interactive lab engines (labs.js)
 *
 * Classic script: no modules, no dependencies, no build step. Defines window.ApertureLabs:
 *   ApertureLabs.engines            the ten engines, by name (ENGINES.md)
 *   ApertureLabs.mount(el, options) → { destroy() }
 *   ApertureLabs.math               the pure functions the engines compute with (exposed for tests)
 *
 * Config shapes: aperture/content/ENGINES.md. Inline markup: SCHEMA.md §2, rendered by options.ui.inline.
 * Safety: authored text only through ui.inline (escaped by the shell) or ui.blocks; learner-typed text
 * only through textContent / value. No inline styles or handlers in markup, no eval, no network.
 */
(function (global) {
  'use strict';

  /* ===================================================================== helpers */

  var SVGNS = 'http://www.w3.org/2000/svg';
  var MINUS = '−';
  var uidCounter = 0;
  function uid(p) { uidCounter += 1; return 'aplab' + uidCounter + (p ? '-' + p : ''); }

  var PROP_KEYS = { value: 1, checked: 1, selected: 1, disabled: 1, hidden: 1, open: 1, readOnly: 1, indeterminate: 1 };

  /** Create an HTML element. props: class, text, html (trusted ui.inline output only), on<event>, properties, attributes. */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) setProps(el, props);
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function setProps(el, props) {
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROP_KEYS[k]) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return el;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return el; }
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    return el;
  }
  /** Create an SVG element (attributes only; colours come from classes in labs.css). */
  function sv(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(x, d) { return isNum(x) ? x : d; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function str(x) { return typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x); }
  function escapeHTML(s) {
    return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function sum(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s; }
  function maxOf(xs) { return xs.length ? Math.max.apply(null, xs) : 0; }
  function minOf(xs) { return xs.length ? Math.min.apply(null, xs) : 0; }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }

  /** Fixed decimals with a true minus sign; never shows "−0". */
  function fixed(x, d) {
    if (!isNum(x)) return 'n/a';
    var s = x.toFixed(d || 0);
    if (Number(s) === 0) return s.replace('-', '');
    return s.charAt(0) === '-' ? MINUS + s.slice(1) : s;
  }
  function signed(x, d) {
    if (!isNum(x)) return 'n/a';
    var s = fixed(Math.abs(x), d || 0);
    if (Number(s.replace(MINUS, '-')) === 0) return s;
    return (x > 0 ? '+' : MINUS) + s;
  }
  function pct(x, d) { return isNum(x) ? fixed(x * 100, d || 0) + '%' : 'n/a'; }
  function grouped(x, d) {
    if (!isNum(x)) return 'n/a';
    var f = new Intl.NumberFormat('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
    var s = f.format(Math.abs(x));
    return (x < 0 && Number(Math.abs(x).toFixed(d || 0)) !== 0 ? MINUS : '') + s;
  }
  function money(x, currency) {
    if (!isNum(x)) return 'n/a';
    var f;
    try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }); }
    catch (e) { f = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }); }
    var s = f.format(Math.abs(x));
    return (Math.round(x) < 0 ? MINUS : '') + s;
  }
  function pText(p) { return p < 0.001 ? 'p < .001' : 'p = ' + p.toFixed(3).replace(/^0/, ''); }
  function plural(n, one, many) { return grouped(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
  function refOk(id) { return typeof id === 'string' && /^R-[A-Za-z0-9-]+$/.test(id); }

  /** A <li> whose `backticked` segments become <code>. Text only — never HTML. */
  function ruleItem(text) {
    var li = h('li');
    str(text).split('`').forEach(function (part, i) {
      if (part) li.appendChild(i % 2 ? h('code', { text: part }) : document.createTextNode(part));
    });
    return li;
  }

  function button(text, onClick, variant, extra) {
    var props = { type: 'button', class: 'lab-btn' + (variant ? ' lab-btn--' + variant : ''), text: text, onclick: onClick };
    if (extra) Object.keys(extra).forEach(function (k) { props[k] = extra[k]; });
    return h('button', props);
  }
  function label(text, cls) { return h('p', { class: 'lab-label' + (cls ? ' ' + cls : ''), text: text }); }
  function heading(level, text, cls) { return h('h' + level, { class: 'lab-h' + (cls ? ' ' + cls : ''), text: text }); }

  /**
   * Accessible table inside its own horizontal scroll container.
   * o = { caption, headers: [text | {text, num}], rows: [[cell]], rowHeader: bool, cls, foot: [[cell]] }
   * A cell is a string/number, a Node, or { text|node|html, num, cls }.
   */
  function table(o) {
    var t = h('table', { class: 'lab-table' + (o.cls ? ' ' + o.cls : '') });
    if (o.caption) t.appendChild(h('caption', { class: 'lab-caption', text: o.caption }));
    var heads = arr(o.headers);
    if (heads.length) {
      var tr = h('tr');
      heads.forEach(function (c) {
        var cell = typeof c === 'object' && c !== null ? c : { text: c };
        tr.appendChild(h('th', { scope: 'col', class: cell.num ? 'num' : null, text: cell.text }));
      });
      t.appendChild(h('thead', null, tr));
    }
    function row(r, inFoot) {
      var tr = h('tr');
      r.forEach(function (c, i) {
        var cell = c && typeof c === 'object' && !(c instanceof Node) ? c : { v: c };
        var isHead = (o.rowHeader && i === 0) || inFoot && i === 0;
        var el = h(isHead ? 'th' : 'td', { scope: isHead ? 'row' : null, class: [cell.num ? 'num' : '', cell.cls || ''].join(' ').trim() || null });
        if (cell.node) el.appendChild(cell.node);
        else if (cell.html !== undefined) el.innerHTML = cell.html;
        else if (cell.text !== undefined) el.textContent = str(cell.text);
        else if (cell.v instanceof Node) el.appendChild(cell.v);
        else el.textContent = str(cell.v);
        tr.appendChild(el);
      });
      return tr;
    }
    var tb = h('tbody');
    arr(o.rows).forEach(function (r) { tb.appendChild(row(r)); });
    t.appendChild(tb);
    if (o.foot) { var tf = h('tfoot'); o.foot.forEach(function (r) { tf.appendChild(row(r, true)); }); t.appendChild(tf); }
    var wrap = h('div', { class: 'lab-tablewrap' }, t);
    if (heads.length >= 5 || o.scroll) { wrap.setAttribute('tabindex', '0'); wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', (o.caption || 'Table') + ' (scrolls sideways)'); }
    return wrap;
  }

  /** Definition-list style metric grid: items = [{ k, v, note }] (v and note are text). */
  function metrics(items, cls) {
    var dl = h('dl', { class: 'lab-metrics' + (cls ? ' ' + cls : '') });
    items.forEach(function (it) {
      if (!it) return;
      var d = h('div', { class: 'lab-metric' + (it.cls ? ' ' + it.cls : '') });
      d.appendChild(h('dt', { text: it.k }));
      d.appendChild(h('dd', null, h('span', { class: 'lab-metric-v', text: it.v }), it.note ? h('span', { class: 'lab-metric-note', text: it.note }) : null));
      dl.appendChild(d);
    });
    return dl;
  }

  /** A labelled severity / status word ("Problem", "Caution", "OK", …). Never colour alone. */
  function tag(word, kind) { return h('span', { class: 'lab-tag lab-tag--' + (kind || 'note'), text: word }); }

  function focusEl(el) {
    if (!el) return;
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); }
  }

  /* ===================================================================== math */

  var M = {};

  /** mulberry32: small, fast, seedable 32-bit PRNG returning floats in [0, 1). */
  M.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Standard normal draws by the Box–Muller transform. */
  M.normalGen = function (rng) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0; while (u === 0) u = rng();
      var v = rng(), r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  };
  /** Gamma(shape, 1) by Marsaglia–Tsang (2000); shape < 1 by the boost u^(1/shape). */
  M.gamma = function (rng, nrm, shape) {
    if (shape < 1) { var u0 = 0; while (u0 === 0) u0 = rng(); return M.gamma(rng, nrm, shape + 1) * Math.pow(u0, 1 / shape); }
    var d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x, v;
      do { x = nrm(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      var u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  M.chiSquare = function (rng, nrm, df) { return 2 * M.gamma(rng, nrm, df / 2); };

  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  /** ln Γ(x), Lanczos approximation (g = 7). */
  M.logGamma = function (x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - M.logGamma(1 - x);
    x -= 1;
    var a = LANCZOS[0], t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  function betacf(a, b, x) {
    var FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var hh = d;
    for (var m = 1; m <= 400; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; hh *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      hh *= del;
      if (Math.abs(del - 1) < 3e-15) break;
    }
    return hh;
  }
  /** Regularized incomplete beta I_x(a, b) by its continued fraction (Numerical Recipes §6.4). */
  M.incBeta = function (x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(M.logGamma(a + b) - M.logGamma(a) - M.logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  };
  /** Student-t CDF: P(T ≤ t) with df degrees of freedom. */
  M.tCdf = function (t, df) {
    if (!isFinite(t)) return t > 0 ? 1 : 0;
    var tail = 0.5 * M.incBeta(df / (df + t * t), df / 2, 0.5);
    return t >= 0 ? 1 - tail : tail;
  };
  /** Two-sided p-value for a t statistic: P(|T| ≥ |t|) = I_{df/(df+t²)}(df/2, 1/2). */
  M.tTwoSidedP = function (t, df) {
    if (!isFinite(t)) return 0;
    return Math.min(1, M.incBeta(df / (df + t * t), df / 2, 0.5));
  };
  /** Binomial CDF P(X ≤ k) for X ~ Bin(n, p). */
  M.binomCdf = function (k, n, p) {
    if (k < 0) return 0;
    if (k >= n) return 1;
    var s = 0;
    for (var i = 0; i <= k; i++) {
      var lc = M.logGamma(n + 1) - M.logGamma(i + 1) - M.logGamma(n - i + 1);
      s += Math.exp(lc + (i ? i * Math.log(p) : 0) + (n - i ? (n - i) * Math.log(1 - p) : 0));
    }
    return Math.min(1, s);
  };

  /** Brier score: mean of (p − outcome)². */
  M.brier = function (probs, outcomes) {
    if (!probs.length) return NaN;
    var s = 0;
    for (var i = 0; i < probs.length; i++) s += Math.pow(probs[i] - (outcomes[i] ? 1 : 0), 2);
    return s / probs.length;
  };

  /**
   * Simulation of two-group studies with normal data (σ = 1 on the observed scale).
   * Each group's mean and the pooled variance are drawn from their exact sampling distributions
   * (mean difference ~ N(δ, 2/n); pooled variance ~ χ²(2n − 2)/(2n − 2)), which is equivalent in
   * distribution to drawing 2n individual observations. δ = d × √reliability.
   * The "researcher" tests `outcomes` independent outcomes and reports the one with the smallest p.
   */
  M.simulate = function (params, seed) {
    var n = Math.max(2, Math.round(params.n)), k = Math.max(1, Math.round(params.outcomes));
    var N = Math.max(1, Math.round(params.studies));
    var rel = clamp(params.reliability, 0.0001, 1), delta = params.effect * Math.sqrt(rel);
    var df = 2 * n - 2, se = Math.sqrt(2 / n);
    var rng = M.mulberry32(seed), nrm = M.normalGen(rng);
    var est = new Float64Array(N), pv = new Float64Array(N), tv = new Float64Array(N);
    var i = 0;
    return {
      N: N, n: n, df: df, est: est, pv: pv, tv: tv,
      count: function () { return i; },
      step: function (m) {
        var end = Math.min(N, i + m);
        for (; i < end; i++) {
          var bp = 2, bd = 0, bt = 0;
          for (var j = 0; j < k; j++) {
            var diff = delta + se * nrm();
            var sp = Math.sqrt(M.chiSquare(rng, nrm, df) / df);
            var t = diff / (sp * se);
            var p = M.tTwoSidedP(t, df);
            if (p < bp) { bp = p; bd = diff / sp; bt = t; }
          }
          est[i] = bd; pv[i] = bp; tv[i] = bt;
        }
        return i >= N;
      },
    };
  };
  function quantileSorted(s, q) {
    if (!s.length) return 0;
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  M.histogram = function (est, pv, alpha) {
    var sorted = Array.prototype.slice.call(est).sort(function (a, b) { return a - b; });
    var lo = Math.min(-0.5, quantileSorted(sorted, 0.005)), hi = Math.max(1, quantileSorted(sorted, 0.995));
    var steps = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
    var raw = (hi - lo) / 28, w = steps[steps.length - 1];
    for (var s = 0; s < steps.length; s++) if (steps[s] >= raw) { w = steps[s]; break; }
    lo = Math.floor(lo / w - 1e-9) * w; hi = Math.ceil(hi / w + 1e-9) * w;
    var nb = Math.max(1, Math.round((hi - lo) / w)), sig = [], ns = [], below = 0, above = 0;
    for (var b = 0; b < nb; b++) { sig.push(0); ns.push(0); }
    for (var i = 0; i < est.length; i++) {
      var idx = Math.floor((est[i] - lo) / w);
      if (idx < 0) { idx = 0; below++; } else if (idx >= nb) { idx = nb - 1; above++; }
      if (pv[i] < alpha) sig[idx]++; else ns[idx]++;
    }
    return { lo: lo, hi: hi, width: w, sig: sig, ns: ns, below: below, above: above };
  };
  M.summarizeSimulation = function (sim, params) {
    var alpha = 0.05, d = params.effect, N = sim.N, est = sim.est, pv = sim.pv;
    var nSig = 0, sumAll = 0, sumSig = 0, sumAbsSig = 0, signErr = 0;
    for (var i = 0; i < N; i++) {
      var e = est[i];
      sumAll += e;
      if (pv[i] < alpha) { nSig++; sumSig += e; sumAbsSig += Math.abs(e); if (d > 0 && e < 0) signErr++; }
    }
    var pub = params.publishOnlySignificant;
    return {
      N: N, df: sim.df, nSig: nSig, shareSig: nSig / N,
      meanAll: sumAll / N,
      meanSig: nSig ? sumSig / nSig : null,
      meanAbsSig: nSig ? sumAbsSig / nSig : null,
      exaggeration: d > 0 && nSig ? (sumAbsSig / nSig) / d : null,
      signErrors: d > 0 ? signErr : null,
      signErrorShare: d > 0 && nSig ? signErr / nSig : null,
      nPub: pub ? nSig : N,
      meanPub: pub ? (nSig ? sumSig / nSig : null) : sumAll / N,
      attenuated: d * Math.sqrt(params.reliability),
      fpReference: 1 - Math.pow(1 - alpha, Math.max(1, Math.round(params.outcomes))),
      bins: M.histogram(est, pv, alpha),
    };
  };

  /** Net present value; cash flows at the end of years 0…N. */
  M.npv = function (cfs, r) {
    var s = 0;
    for (var t = 0; t < cfs.length; t++) s += cfs[t] / Math.pow(1 + r, t);
    return s;
  };
  /** Scenario cash flows: the multiplier applies to inflows (positive flows) only. */
  M.scenarioFlows = function (cfs, m) { return cfs.map(function (cf) { return cf > 0 ? cf * m : cf; }); };
  /**
   * IRR by bisection. Scans r from −99% to 1,000% for sign changes of NPV(r); bisects the first
   * bracket. Returns { value, roots, multiple } or null when NPV never changes sign ("n/a").
   */
  M.irr = function (cfs) {
    var grid = [], r;
    for (r = -0.99; r < 1; r += 0.01) grid.push(Math.round(r * 1000) / 1000);
    for (r = 1; r <= 10.0001; r += 0.05) grid.push(Math.round(r * 1000) / 1000);
    var roots = [], prev = M.npv(cfs, grid[0]);
    if (prev === 0) roots.push(grid[0]);
    for (var i = 1; i < grid.length; i++) {
      var cur = M.npv(cfs, grid[i]);
      if (cur === 0) { roots.push(grid[i]); prev = cur; continue; }
      if (prev !== 0 && (prev < 0) !== (cur < 0)) {
        var lo = grid[i - 1], hi = grid[i], flo = prev;
        for (var it = 0; it < 200 && hi - lo > 1e-12; it++) {
          var mid = (lo + hi) / 2, fm = M.npv(cfs, mid);
          if (fm === 0) { lo = hi = mid; break; }
          if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        roots.push((lo + hi) / 2);
      }
      prev = cur;
    }
    if (!roots.length) return null;
    return { value: roots[0], roots: roots, multiple: roots.length > 1 };
  };
  /** Payback (years): first time cumulative (discounted, if rate given) cash flow turns ≥ 0, interpolated within the year. */
  M.payback = function (cfs, rate) {
    var cum = 0;
    for (var t = 0; t < cfs.length; t++) {
      var cf = rate === undefined || rate === null ? cfs[t] : cfs[t] / Math.pow(1 + rate, t);
      var prev = cum;
      cum += cf;
      if (t === 0 && cum >= 0) return 0;
      if (t > 0 && prev < 0 && cum >= 0) return (t - 1) + (-prev / cf);
    }
    return null;
  };
  /** Profitability index: PV of flows in years 1…N ÷ the year-0 outlay. */
  M.profitabilityIndex = function (cfs, r) {
    var out = -cfs[0];
    if (!(out > 0)) return null;
    return (M.npv(cfs, r) - cfs[0]) / out;
  };
  /** Herfindahl index of shares: Σ (xᵢ / Σx)². */
  M.herfindahl = function (xs) {
    var tot = sum(xs);
    if (!(tot > 0)) return null;
    var s = 0;
    xs.forEach(function (x) { s += Math.pow(x / tot, 2); });
    return s;
  };
  /** Diminishing-returns value: weight × scale × (1 − e^(−x / saturation)) × multiplier. */
  M.saturating = function (x, scale, saturation, weight, mult) {
    return weight * scale * (1 - Math.exp(-x / saturation)) * mult;
  };
  /** Indexes of Pareto-efficient points (no other point is ≥ on both and > on one). */
  M.paretoFrontier = function (pts) {
    var idx = pts.map(function (_, i) { return i; });
    idx.sort(function (a, b) { return pts[b].x - pts[a].x || pts[b].y - pts[a].y; });
    var best = -Infinity, out = [];
    idx.forEach(function (i) { if (pts[i].y > best) { out.push(i); best = pts[i].y; } });
    return out;
  };

  /* ---- text metrics (composer) ---- */
  var WORD_RE = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;
  var ABBR = ['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'no', 'u.s', 'u.k', 'inc', 'ltd', 'co', 'corp', 'jr', 'sr', 'fig', 'approx', 'dept', 'est', 'a.m', 'p.m', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
  M.HEDGES = ['may', 'might', 'could', 'perhaps', 'possibly', 'probably', 'seems', 'seem', 'seemed', 'appears', 'appear',
    'somewhat', 'fairly', 'rather', 'quite', 'relatively', 'arguably', 'presumably', 'apparently', 'generally', 'largely',
    'basically', 'essentially', 'hopefully', 'I think', 'I believe', 'I feel', 'we think', 'we believe', 'sort of', 'kind of',
    'to some extent', 'in some ways', 'tend to', 'tends to', 'it is possible that'];
  M.PARTICIPLES = ['known', 'made', 'done', 'given', 'taken', 'seen', 'shown', 'written', 'built', 'held', 'led', 'paid', 'sold',
    'told', 'found', 'kept', 'left', 'brought', 'bought', 'thought', 'taught', 'caught', 'set', 'put', 'cut', 'sent', 'spent',
    'won', 'lost', 'met', 'begun', 'chosen', 'driven', 'drawn', 'broken', 'spoken', 'stolen', 'thrown', 'grown', 'understood',
    'hit', 'hurt', 'said', 'heard', 'felt', 'meant', 'bound', 'struck', 'sought', 'run', 'read', 'shut', 'spread', 'forgotten', 'hidden'];
  var PASSIVE_STOP = ['even', 'often', 'then', 'when', 'open', 'seven', 'eleven', 'ten', 'been', 'oven', 'need', 'indeed', 'speed', 'seed', 'red', 'bed', 'hundred', 'shed', 'fed'];
  M.PASSIVE_RULE = 'A form of “to be” (am, is, are, was, were, be, been, being), optionally followed by one word ending in -ly, then a word ending in -ed or -en or an irregular past participle from the list. It over-counts adjectives (“is interested”) and misses passives without “to be” (“got approved”).';

  function wordsOf(text) { return str(text).match(WORD_RE) || []; }
  function splitSentences(line) {
    var out = [], start = 0, re = /[.!?]+["'’”)\]]*\s+/g, m;
    while ((m = re.exec(line))) {
      var end = m.index + m[0].length, next = line.charAt(end);
      if (!next || !/[\p{Lu}\p{N}"'‘“(\[]/u.test(next)) continue;
      var before = line.slice(start, m.index + 1).trim();
      var lastTok = (before.match(/(\S+)$/) || ['', ''])[1].replace(/[.!?]+$/, '').replace(/^[("'‘“\[]+/, '').toLowerCase();
      if (ABBR.indexOf(lastTok) >= 0 || /^\p{L}$/u.test(lastTok) || /^(\p{L}\.)+\p{L}$/u.test(lastTok)) continue;
      out.push(line.slice(start, end).trim());
      start = end;
    }
    var rest = line.slice(start).trim();
    if (rest) out.push(rest);
    return out;
  }
  M.textMetrics = function (text, wpm) {
    var t = str(text), words = wordsOf(t), rate = wpm > 0 ? wpm : 150;
    var sentences = [];
    t.split(/\n/).forEach(function (raw) {
      var line = raw.replace(/^\s*(?:[-*•]|\d+[.)]|#+)\s+/, '').trim();
      if (!line) return;
      var w = wordsOf(line).length;
      if (!w) return;
      if (!/[.!?]["'’”)\]]*$/.test(line) && w < 8) return; // heading or label
      splitSentences(line).forEach(function (s) { var n = wordsOf(s).length; if (n) sentences.push({ text: s, words: n }); });
    });
    var lens = sentences.map(function (s) { return s.words; });
    var lower = ' ' + words.join(' ').toLowerCase() + ' ';
    var hedges = [];
    M.HEDGES.forEach(function (hw) {
      var needle = ' ' + hw.toLowerCase() + ' ', c = 0, i = lower.indexOf(needle);
      while (i >= 0) { c++; i = lower.indexOf(needle, i + needle.length - 1); }
      if (c) hedges.push({ word: hw, count: c });
    });
    var passive = [];
    var pre = /\b(am|is|are|was|were|be|been|being)\s+(?:(\p{L}+ly)\s+)?(\p{L}+)\b/giu, m;
    while ((m = pre.exec(t))) {
      var w2 = m[3].toLowerCase();
      if (PASSIVE_STOP.indexOf(w2) >= 0) continue;
      if (/(ed|en)$/.test(w2) && w2.length > 3 || M.PARTICIPLES.indexOf(w2) >= 0) passive.push(m[0]);
    }
    var passiveSentences = sentences.filter(function (s) {
      var re2 = new RegExp(pre.source, 'giu'), mm;
      while ((mm = re2.exec(s.text))) {
        var ww = mm[3].toLowerCase();
        if (PASSIVE_STOP.indexOf(ww) >= 0) continue;
        if (/(ed|en)$/.test(ww) && ww.length > 3 || M.PARTICIPLES.indexOf(ww) >= 0) return true;
      }
      return false;
    }).length;
    return {
      words: words.length,
      minutes: words.length / rate,
      wpm: rate,
      sentences: sentences.length,
      meanSentence: lens.length ? sum(lens) / lens.length : 0,
      longestSentence: maxOf(lens),
      longShare: lens.length ? lens.filter(function (n) { return n > 25; }).length / lens.length : 0,
      longCount: lens.filter(function (n) { return n > 25; }).length,
      hedges: hedges,
      hedgeCount: sum(hedges.map(function (x) { return x.count; })),
      passive: passive,
      passiveSentences: passiveSentences,
    };
  };

  /* ===================================================================== context */

  var ENGINE_NAMES = {
    calibration: 'Calibration', simulation: 'Simulation', design: 'Design studio', branching: 'Branching scenario',
    negotiation: 'Negotiation', allocation: 'Allocation', orgdesign: 'Organization builder', stakeholder: 'Stakeholder map',
    issues: 'Issue spotting', composer: 'Composer',
  };
  var ENGINE_NOTES = {
    calibration: 'Scored only on your own answers, by the rules shown. Facts are sourced in the explanations.',
    simulation: 'Synthetic data from a seeded simulation: a model of research practice, not real studies.',
    design: 'Effects are ordinal teaching heuristics drawn from the cited research, not predictions.',
    branching: 'A fictional scenario. Indicator moves are ordinal teaching heuristics, not predictions.',
    negotiation: 'A rule-based counterpart with synthetic values: a teaching device, not a model of any real person.',
    allocation: 'Synthetic numbers and a transparent teaching model, not a forecast.',
    orgdesign: 'Synthetic roles and costs. The checks are rules of thumb, shown in full.',
    stakeholder: 'Fictional people. The power–interest grid is a practitioner heuristic, not a research finding.',
    issues: 'A fictional document. Educational exercise, not legal advice.',
    composer: 'Transparent text metrics only. Nothing here grades the content of your writing.',
  };

  function makeContext(container, opts) {
    var exercise = obj(opts.exercise), ui = obj(opts.ui), api = obj(opts.api);
    var mode = ['foundation', 'graduate', 'executive'].indexOf(opts.mode) >= 0 ? opts.mode : 'graduate';
    var engine = str(opts.engine);
    var titleId = uid('title');
    var saveEl = h('span', { class: 'lab-save' });
    var meta = ['Interactive lab', ENGINE_NAMES[engine] || 'Lab'];
    if (isNum(exercise.minutes)) meta.push(exercise.minutes + ' min');
    var root = h('section', { class: 'lab lab--' + engine, 'data-mode': mode, 'aria-labelledby': titleId });
    var head = h('header', { class: 'lab-head' },
      h('p', { class: 'lab-eyebrow' }, h('span', { text: meta.join(' · ') }), saveEl),
      h('h3', { class: 'lab-title', id: titleId, text: str(exercise.title) || ENGINE_NAMES[engine] || 'Lab' }),
      ENGINE_NOTES[engine] ? h('p', { class: 'lab-honest', text: ENGINE_NOTES[engine] }) : null);
    var body = h('div', { class: 'lab-body' });
    var live = h('div', { class: 'lab-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
    root.appendChild(head);
    root.appendChild(body);
    root.appendChild(live);
    container.appendChild(root);

    var destroyed = false, timers = [], cleanups = [];
    function later(fn, ms) {
      var t = setTimeout(function () {
        var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1);
        if (!destroyed) fn();
      }, ms || 0);
      timers.push(t);
      return t;
    }
    function cancel(t) { if (t === null || t === undefined) return; clearTimeout(t); var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }

    var annT = null;
    function announce(msg) {
      cancel(annT);
      live.textContent = '';
      annT = later(function () { live.textContent = msg; }, 80);
    }

    function inline(text) {
      var t = str(text);
      if (typeof ui.inline === 'function') {
        try { return str(ui.inline(t)); } catch (e) { return escapeHTML(t); }
      }
      return escapeHTML(t);
    }
    /** Authored rich value: a block list (SCHEMA §5) through ui.blocks, or a string through ui.inline. */
    function rich(el, value) {
      if (Array.isArray(value)) {
        if (!value.length) return el;
        if (typeof ui.blocks === 'function') ui.blocks(el, value);
        else value.forEach(function (b) { if (b && b.text) el.appendChild(h('p', { html: inline(b.text) })); });
      } else if (value) {
        el.appendChild(h('p', { html: inline(value) }));
      }
      return el;
    }
    function refs(list, cls) {
      var ids = arr(list).filter(refOk);
      if (!ids.length) return null;
      var md = ids.length === 1 ? '[source](' + ids[0] + ')' : ids.map(function (id, i) { return '[source ' + (i + 1) + '](' + id + ')'; }).join(' · ');
      return h('p', { class: 'lab-refs' + (cls ? ' ' + cls : '') }, h('span', { class: 'lab-label lab-label--inline', text: ids.length > 1 ? 'Sources' : 'Source' }), ' ', h('span', { html: inline(md) }));
    }

    var revealP = null;
    function reveal() {
      if (!revealP) {
        if (typeof api.reveal !== 'function') return Promise.reject(new Error('reveal unavailable'));
        revealP = Promise.resolve().then(function () { return api.reveal(); }).then(function (full) {
          if (!full || typeof full !== 'object') throw new Error('The answer key came back empty.');
          return full;
        });
        revealP.catch(function () { revealP = null; });
      }
      return revealP;
    }

    var payloadFn = null, saveT = null, dirty = false, retries = 0;
    function setSaveStatus(t) { saveEl.textContent = t || ''; }
    function setPayload(fn) {
      payloadFn = function () {
        var p = fn() || {};
        var out = { state: p.state || {}, finished: !!p.finished, summary: p.summary };
        if (!out.finished && out.state && out.state.previous) out.summary = out.state.previous;
        if (!out.summary || typeof out.summary !== 'object') out.summary = { label: 'In progress', metrics: {} };
        if (!out.summary.metrics) out.summary.metrics = {};
        out.summary.label = str(out.summary.label) || 'In progress';
        return out;
      };
    }
    function flush() {
      cancel(saveT); saveT = null;
      if (!dirty || !payloadFn || typeof api.save !== 'function') return Promise.resolve();
      dirty = false;
      var payload;
      try { payload = copy(payloadFn()); } catch (e) { return Promise.resolve(); }
      if (!destroyed) setSaveStatus('Saving…');
      return Promise.resolve().then(function () { return api.save(payload); }).then(function () {
        retries = 0;
        if (!destroyed && !dirty) setSaveStatus('Saved');
      }, function () {
        if (destroyed) return;
        dirty = true;
        if (retries < 3) { retries += 1; setSaveStatus('Not saved yet — retrying'); saveT = later(flush, 3000 * retries); }
        else { retries = 0; setSaveStatus('Not saved — your next change will try again'); }
      });
    }
    function touch() {
      if (destroyed) return;
      dirty = true;
      cancel(saveT);
      setSaveStatus('Unsaved changes');
      saveT = later(flush, 800);
    }
    function saveNow() { dirty = true; return flush(); }

    var saved = null;
    if (opts.saved && typeof opts.saved === 'object' && opts.saved.state && typeof opts.saved.state === 'object') {
      saved = { state: opts.saved.state, finished: !!opts.saved.finished };
    }

    function rulesPanel(items, extra) {
      var d = h('details', { class: 'lab-rules', open: mode === 'foundation' });
      var sm = h('summary', { class: 'lab-rules-summary', text: d.open ? 'Hide the rules' : 'Show the rules' });
      d.addEventListener('toggle', function () { sm.textContent = d.open ? 'Hide the rules' : 'Show the rules'; });
      var inner = h('div', { class: 'lab-rules-body' });
      inner.appendChild(heading(4, 'How every number here is computed', 'lab-h--small'));
      inner.appendChild(h('ul', { class: 'lab-list' }, items.map(ruleItem)));
      if (extra) append(inner, extra);
      var as = arr(exercise.assumptions).filter(Boolean);
      if (as.length) {
        inner.appendChild(heading(4, 'Assumptions for this exercise', 'lab-h--small'));
        inner.appendChild(h('ul', { class: 'lab-list' }, as.map(function (a) { return h('li', { html: inline(a) }); })));
      }
      d.appendChild(sm);
      d.appendChild(inner);
      return d;
    }

    /** "Start again" (optionally with an inline confirmation step for engines that would discard writing). */
    function startAgain(onGo, confirmText) {
      var wrap = h('div', { class: 'lab-actions lab-actions--again' });
      var b = button('Start again', null, 'quiet');
      wrap.appendChild(b);
      b.addEventListener('click', function () {
        if (!confirmText) { onGo(); return; }
        clear(wrap);
        var yes = button('Clear and start again', onGo, 'primary');
        var no = button('Cancel', function () { clear(wrap); wrap.appendChild(b); b.focus(); });
        wrap.appendChild(h('p', { class: 'lab-confirm', text: confirmText }));
        wrap.appendChild(h('div', { class: 'lab-actions' }, yes, no));
        yes.focus();
      });
      return wrap;
    }

    /** Re-render while keeping focus on the element with the same data-fk key. */
    function keepFocus(fn) {
      var a = document.activeElement, key = a && root.contains(a) ? a.getAttribute('data-fk') : null;
      fn();
      if (key) {
        var els = root.querySelectorAll('[data-fk]');
        for (var i = 0; i < els.length; i++) if (els[i].getAttribute('data-fk') === key) { els[i].focus(); break; }
      }
    }

    /** Standard "loading the key" / error-with-retry panel. */
    function waitPanel(text) { return h('p', { class: 'lab-wait', role: 'status', text: text || 'Loading…' }); }
    function errorPanel(text, retry) {
      return h('div', { class: 'lab-error', role: 'alert' }, h('p', { text: text }), retry ? button('Try again', retry) : null);
    }

    return {
      engine: engine, exercise: exercise, cfg: obj(exercise.config), mode: mode, root: root, body: body, saved: saved,
      inline: inline, rich: rich, refs: refs, reveal: reveal, announce: announce, later: later, cancel: cancel,
      setPayload: setPayload, touch: touch, saveNow: saveNow, rulesPanel: rulesPanel, startAgain: startAgain,
      keepFocus: keepFocus, waitPanel: waitPanel, errorPanel: errorPanel,
      get destroyed() { return destroyed; },
      onDestroy: function (fn) { cleanups.push(fn); },
      destroy: function () {
        if (destroyed) return;
        if (dirty) flush();
        destroyed = true;
        timers.slice().forEach(function (t) { clearTimeout(t); });
        timers = [];
        cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  /** Inline "how to read this" note shown in Foundation mode only. */
  function foundationNote(ctx, text) {
    if (ctx.mode !== 'foundation') return null;
    return h('p', { class: 'lab-note lab-note--foundation' }, h('span', { class: 'lab-label lab-label--inline', text: 'How to read this' }), ' ', text);
  }

  /** Results heading + standard "Start again" placement helper. */
  function resultsHeading(text) { return heading(4, text || 'Results', 'lab-h--results'); }

  var ENGINES = {};

  /* ===================================================================== 1. calibration */

  ENGINES.calibration = function (ctx) {
    var cfg = ctx.cfg;
    var binary = arr(cfg.binary).filter(function (b) { return b && b.id; });
    var intervals = arr(cfg.intervals).filter(function (b) { return b && b.id; });
    var levels = arr(cfg.confidenceLevels).filter(function (x) { return isNum(x) && x >= 0 && x <= 100; });
    levels = levels.length ? levels.filter(function (x, i) { return levels.indexOf(x) === i; }).sort(function (a, b) { return a - b; }) : [50, 60, 70, 80, 90, 100];

    function fresh(prev) { return { v: 1, answers: {}, ranges: {}, result: null, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      binary.forEach(function (b) {
        var a = obj(obj(s0.answers)[b.id]);
        st.answers[b.id] = { choice: typeof a.choice === 'boolean' ? a.choice : null, conf: levels.indexOf(a.conf) >= 0 ? a.conf : null };
      });
      intervals.forEach(function (q) { var r = obj(obj(s0.ranges)[q.id]); st.ranges[q.id] = { lo: str(r.lo), hi: str(r.hi) }; });
      st.result = s0.result || null;
      finished = ctx.saved.finished && !!st.result;
    }
    function answer(id) { return st.answers[id] || (st.answers[id] = { choice: null, conf: null }); }
    function range(id) { return st.ranges[id] || (st.ranges[id] = { lo: '', hi: '' }); }
    function parseNum(s) { var t = str(s).replace(/[,\s ]/g, '').replace(/−/g, '-'); if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(t)) return null; var v = Number(t); return isFinite(v) ? v : null; }
    function answeredCount() {
      var n = 0;
      binary.forEach(function (b) { var a = answer(b.id); if (a.choice !== null && a.conf !== null) n++; });
      intervals.forEach(function (q) { var r = range(q.id); if (parseNum(r.lo) !== null && parseNum(r.hi) !== null) n++; });
      return n;
    }
    var total = binary.length + intervals.length;

    ctx.setPayload(function () {
      return { state: st, finished: finished, summary: finished && st.result ? st.result.summary : { label: 'In progress — ' + answeredCount() + ' of ' + total + ' answered', metrics: { Answered: answeredCount() } } };
    });

    var rules = ctx.rulesPanel([
      'For each statement you choose True or False and your confidence that your answer is right. Confidence is your probability p that your chosen answer is correct: 50% means a pure guess, 100% means certain.',
      'Accuracy = statements answered correctly ÷ statements.',
      'Brier score = mean of `(p − outcome)²`, where outcome = 1 if your answer was right and 0 if not. Lower is better: 0 is a perfect, certain record; answering 50% on every statement always scores 0.25.',
      'Calibration table: statements grouped by the confidence you stated. Hit rate = share correct in that group. A group reads “overconfident” when its hit rate is more than 10 points below the stated confidence, “underconfident” when more than 10 points above, and “about right” otherwise. Groups with fewer than 3 statements are reported as too few to judge.',
      'Overall: your mean stated confidence minus your accuracy. More than +5 points reads as overconfident overall, less than −5 points as underconfident.',
      'Intervals: an interval is a hit when low ≤ true value ≤ high (bounds included). Hit rate is compared with the 90% target. The chance figure is the binomial probability of getting that many hits or fewer if each interval truly had a 90% chance of containing the answer.',
      'Answers are revealed only after you submit; the exercise records that moment.',
    ]);
    ctx.body.appendChild(rules);
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function render() { clear(view); if (finished) renderResults(); else renderForm(); }

    /* ---------- form ---------- */
    function renderForm() {
      var progress = h('p', { class: 'lab-progress', text: '' });
      function upd() { progress.textContent = answeredCount() + ' of ' + total + ' answered'; }
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'Confidence is not how hard the question felt. It is the probability that your answer is right. If you would win a fair bet at 4-to-1 odds on your answer, say 80%.'));
      var errBox = h('div', { class: 'lab-formerror', role: 'alert' });

      if (binary.length) {
        var partA = h('section', { class: 'lab-section' }, heading(4, 'Part A — True or false'),
          h('p', { class: 'lab-help', text: 'Choose True or False, then how confident you are that your answer is right.' }));
        binary.forEach(function (b, i) {
          var a = answer(b.id), name = uid('b');
          var fs = h('fieldset', { class: 'lab-item', id: uid('item') });
          fs.setAttribute('data-item', b.id);
          fs.appendChild(h('legend', { class: 'lab-item-legend' }, h('span', { class: 'lab-item-num', text: 'A' + (i + 1) + '. ' }), h('span', { html: ctx.inline(b.statement) })));
          var ansFs = h('fieldset', { class: 'lab-subgroup' }, h('legend', { class: 'lab-sublegend', text: 'Your answer' }));
          var row = h('div', { class: 'lab-chips' });
          [true, false].forEach(function (val) {
            var inp = h('input', { type: 'radio', name: name + '-a', value: String(val), checked: a.choice === val, onchange: function () { a.choice = val; upd(); ctx.touch(); } });
            row.appendChild(h('label', { class: 'lab-chip' }, inp, h('span', { text: val ? 'True' : 'False' })));
          });
          ansFs.appendChild(row);
          var confFs = h('fieldset', { class: 'lab-subgroup' }, h('legend', { class: 'lab-sublegend', text: 'Confidence that you are right' }));
          var row2 = h('div', { class: 'lab-chips' });
          levels.forEach(function (lv) {
            var inp = h('input', { type: 'radio', name: name + '-c', value: String(lv), checked: a.conf === lv, onchange: function () { a.conf = lv; upd(); ctx.touch(); } });
            row2.appendChild(h('label', { class: 'lab-chip' }, inp, h('span', { text: lv + '%' })));
          });
          confFs.appendChild(row2);
          fs.appendChild(ansFs);
          fs.appendChild(confFs);
          partA.appendChild(fs);
        });
        view.appendChild(partA);
      }
      if (intervals.length) {
        var partB = h('section', { class: 'lab-section' }, heading(4, 'Part B — 90% intervals'),
          h('p', { class: 'lab-help', text: 'Give a low and a high value so that you are 90% sure the true value lies between them. About nine in ten of your intervals should contain the answer.' }));
        intervals.forEach(function (q, i) {
          var r = range(q.id), loId = uid('lo'), hiId = uid('hi');
          var fs = h('fieldset', { class: 'lab-item' });
          fs.setAttribute('data-item', q.id);
          fs.appendChild(h('legend', { class: 'lab-item-legend' }, h('span', { class: 'lab-item-num', text: 'B' + (i + 1) + '. ' }), h('span', { html: ctx.inline(q.question) })));
          var unit = str(q.unit);
          function field(id, lab, key) {
            return h('div', { class: 'lab-field lab-field--inline' },
              h('label', { for: id, text: lab + (unit ? ' (' + unit + ')' : '') }),
              h('input', { id: id, type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'lab-input lab-input--num', value: r[key], oninput: function (e) { r[key] = e.target.value; upd(); ctx.touch(); } }));
          }
          fs.appendChild(h('div', { class: 'lab-row' }, field(loId, 'Low', 'lo'), field(hiId, 'High', 'hi')));
          partB.appendChild(fs);
        });
        view.appendChild(partB);
      }
      upd();
      var submit = button('Submit and see your scores', null, 'primary');
      var actions = h('div', { class: 'lab-actions lab-actions--submit' }, submit, progress);
      view.appendChild(errBox);
      view.appendChild(actions);
      submit.addEventListener('click', function () {
        clear(errBox);
        var missing = [], bad = [];
        binary.forEach(function (b, i) { var a = answer(b.id); if (a.choice === null || a.conf === null) missing.push({ id: b.id, label: 'A' + (i + 1) }); });
        intervals.forEach(function (q, i) {
          var r = range(q.id), lo = parseNum(r.lo), hi = parseNum(r.hi);
          if (lo === null || hi === null) missing.push({ id: q.id, label: 'B' + (i + 1) });
          else if (lo > hi) bad.push({ id: q.id, label: 'B' + (i + 1) });
        });
        if (missing.length || bad.length) {
          var msg = [];
          if (missing.length) msg.push('Still to answer: ' + missing.map(function (m) { return m.label; }).join(', ') + '.');
          if (bad.length) msg.push('Low is above high in: ' + bad.map(function (m) { return m.label; }).join(', ') + '.');
          errBox.appendChild(h('p', { text: msg.join(' ') }));
          var first = (missing[0] || bad[0]).id;
          var fsEl = view.querySelector('[data-item="' + first + '"]');
          if (fsEl) { var inp = fsEl.querySelector('input:not(:checked)') || fsEl.querySelector('input'); if (inp) inp.focus(); }
          return;
        }
        submit.disabled = true;
        var wait = ctx.waitPanel('Checking your answers…');
        actions.appendChild(wait);
        ctx.reveal().then(function (full) {
          if (ctx.destroyed) return;
          st.result = score(full);
          finished = true;
          ctx.saveNow();
          render();
          ctx.announce('Results ready. ' + st.result.summary.label + '.');
          focusEl(view.querySelector('.lab-h--results'));
        }, function () {
          if (ctx.destroyed) return;
          submit.disabled = false;
          if (wait.parentNode) wait.parentNode.removeChild(wait);
          errBox.appendChild(ctx.errorPanel('The answers could not be loaded. Your responses are kept; try again in a moment.'));
        });
      });
    }

    /* ---------- scoring ---------- */
    function keyMap(full, field) {
      var m = {};
      arr(obj(full)[field]).forEach(function (it) { if (it && it.id) m[it.id] = obj(it.key); });
      return m;
    }
    function score(full) {
      var kb = keyMap(full, 'binary'), ki = keyMap(full, 'intervals');
      var probs = [], outs = [], correct = 0, items = [];
      binary.forEach(function (b) {
        var a = answer(b.id), k = kb[b.id] || {}, ok = typeof k.answer === 'boolean' && a.choice === k.answer;
        probs.push(a.conf / 100); outs.push(ok ? 1 : 0); if (ok) correct++;
        items.push({ id: b.id, ok: ok, conf: a.conf });
      });
      var buckets = levels.map(function (lv) {
        var inB = items.filter(function (it) { return it.conf === lv; });
        var hits = inB.filter(function (it) { return it.ok; }).length;
        return { level: lv, n: inB.length, hits: hits, rate: inB.length ? hits / inB.length : null };
      });
      var ihits = 0, icount = 0;
      intervals.forEach(function (q) {
        var k = ki[q.id] || {}, r = range(q.id), lo = parseNum(r.lo), hi = parseNum(r.hi);
        if (isNum(k.answer)) { icount++; if (lo <= k.answer && k.answer <= hi) ihits++; }
      });
      var n = binary.length, acc = n ? correct / n : null, brier = n ? M.brier(probs, outs) : null;
      var meanConf = n ? sum(probs) / n : null;
      var label = [];
      if (n) label.push(correct + ' of ' + n + ' correct', 'Brier ' + fixed(brier, 3));
      if (intervals.length) label.push('intervals ' + ihits + ' of ' + icount);
      var met = {};
      if (n) { met.Correct = correct + '/' + n; met.Accuracy = Number(acc.toFixed(3)); met['Brier score'] = Number(brier.toFixed(3)); met['Mean confidence'] = Number(meanConf.toFixed(3)); }
      if (icount) { met['Interval hits'] = ihits + '/' + icount; met['Interval hit rate'] = Number((ihits / icount).toFixed(3)); }
      return { correct: correct, n: n, acc: acc, brier: brier, meanConf: meanConf, buckets: buckets, ihits: ihits, icount: icount, summary: { label: label.join(' · '), metrics: met } };
    }

    /* ---------- results ---------- */
    function bucketReading(b) {
      if (!b.n) return '';
      var lead = 'With ' + plural(b.n, 'statement') + ' at ' + b.level + '% you were right on ' + b.hits;
      if (b.n < 3) return lead + ' — too few to judge this band.';
      var diff = b.rate - b.level / 100;
      if (diff < -0.1) return lead + ' — overconfident in that band.';
      if (diff > 0.1) return lead + ' — underconfident in that band.';
      return lead + ' — about right for that band.';
    }
    function renderResults() {
      var wait = ctx.waitPanel('Loading your results…');
      view.appendChild(wait);
      ctx.reveal().then(function (full) {
        if (ctx.destroyed) return;
        clear(view);
        var R = score(full);
        st.result = R;
        drawResults(full, R);
      }, function () {
        if (ctx.destroyed) return;
        clear(view);
        view.appendChild(ctx.errorPanel('Your results could not be loaded.', function () { clear(view); renderResults(); }));
        view.appendChild(ctx.startAgain(again));
      });
    }
    function drawResults(full, R) {
      var sec = h('section', { class: 'lab-section lab-results' });
      sec.appendChild(resultsHeading('Your results'));
      var items = [];
      if (R.n) {
        var over = R.meanConf * 100 - R.acc * 100;
        items.push({ k: 'Accuracy', v: R.correct + ' of ' + R.n + ' (' + pct(R.acc) + ')' });
        items.push({ k: 'Brier score', v: fixed(R.brier, 3), note: 'Lower is better. 0.250 = always answering 50%.' });
        items.push({ k: 'Mean confidence', v: pct(R.meanConf), note: (over > 5 ? 'Overconfident by ' : over < -5 ? 'Underconfident by ' : 'Close to your accuracy: ') + fixed(Math.abs(over), 0) + ' points' });
      }
      if (R.icount) items.push({ k: '90% intervals', v: R.ihits + ' of ' + R.icount + ' contained the answer (' + pct(R.ihits / R.icount) + ')', note: 'Target: 90%' });
      sec.appendChild(metrics(items));

      var interp = h('div', { class: 'lab-interpret' }, heading(5, 'What the numbers say'));
      var ul = h('ul', { class: 'lab-list' });
      if (R.n) {
        var diff = R.meanConf * 100 - R.acc * 100;
        ul.appendChild(h('li', { text: diff > 5 ? 'Your average confidence (' + pct(R.meanConf) + ') was ' + fixed(diff, 0) + ' points above your accuracy (' + pct(R.acc) + '): overconfident overall on this set.' :
          diff < -5 ? 'Your average confidence (' + pct(R.meanConf) + ') was ' + fixed(-diff, 0) + ' points below your accuracy (' + pct(R.acc) + '): underconfident overall on this set.' :
            'Your average confidence (' + pct(R.meanConf) + ') was within 5 points of your accuracy (' + pct(R.acc) + '): well calibrated overall on this set.' }));
        R.buckets.forEach(function (b) { if (b.n) ul.appendChild(h('li', { text: bucketReading(b) })); });
        var costly = 0, costlySum = 0;
        binary.forEach(function (b) {
          var a = answer(b.id), k = keyMap(full, 'binary')[b.id] || {};
          if (a.choice !== k.answer && a.conf >= 80) { costly++; costlySum += Math.pow(a.conf / 100, 2); }
        });
        if (costly) ul.appendChild(h('li', { text: plural(costly, 'confident miss', 'confident misses') + ' (80% or more, wrong) contributed ' + fixed(costlySum / R.n, 3) + ' of your Brier score of ' + fixed(R.brier, 3) + '. Confident errors cost the most.' }));
      }
      if (R.icount) {
        var expHits = 0.9 * R.icount, chance = M.binomCdf(R.ihits, R.icount, 0.9);
        var txt = 'Your intervals contained the true value ' + R.ihits + ' times out of ' + R.icount + '; true 90% intervals would average about ' + fixed(expHits, 1) + '.';
        if (R.ihits < expHits) txt += ' If each interval really had a 90% chance, ' + R.ihits + ' or fewer hits would happen ' + (chance < 0.001 ? 'less than 0.1%' : pct(chance, 1)) + ' of the time' + (chance < 0.05 ? ': your intervals were narrower than your actual uncertainty (overprecision). Widen them until about nine in ten contain the answer.' : ': consistent with chance at this sample size.');
        else txt += ' That is consistent with — or wider than — a 90% interval.';
        ul.appendChild(h('li', { text: txt }));
      }
      interp.appendChild(ul);
      sec.appendChild(interp);

      if (R.n) {
        sec.appendChild(heading(5, 'Calibration table'));
        sec.appendChild(table({
          caption: 'Stated confidence vs. actual hit rate',
          headers: ['Confidence', { text: 'Statements', num: true }, { text: 'Correct', num: true }, { text: 'Hit rate', num: true }, 'Reading'],
          rowHeader: true,
          rows: R.buckets.map(function (b) {
            var reading = !b.n ? '—' : b.n < 3 ? 'Too few to judge' : b.rate < b.level / 100 - 0.1 ? 'Overconfident' : b.rate > b.level / 100 + 0.1 ? 'Underconfident' : 'About right';
            return [b.level + '%', { text: String(b.n), num: true }, { text: b.n ? String(b.hits) : '—', num: true }, { text: b.n ? pct(b.rate) : '—', num: true }, reading];
          }),
        }));
        sec.appendChild(calibrationPlot(R));
      }

      if (binary.length) {
        var kb = keyMap(full, 'binary');
        var rev = h('section', { class: 'lab-review' }, heading(5, 'Statements, answers and explanations'));
        var ol = h('ol', { class: 'lab-reviewlist' });
        binary.forEach(function (b) {
          var a = answer(b.id), k = kb[b.id] || {}, ok = a.choice === k.answer;
          var li = h('li', { class: 'lab-reviewitem' });
          li.appendChild(h('p', { class: 'lab-review-q', html: ctx.inline(b.statement) }));
          li.appendChild(h('p', { class: 'lab-review-a' }, tag(ok ? 'Correct' : 'Incorrect', ok ? 'ok' : 'problem'), ' You said ' + (a.choice ? 'True' : 'False') + ' at ' + a.conf + '%. The answer is ' + (k.answer === true ? 'True' : k.answer === false ? 'False' : 'not available') + '.'));
          if (k.explanation) li.appendChild(h('p', { class: 'lab-review-x', html: ctx.inline(k.explanation) }));
          var rf = ctx.refs(k.ref ? [k.ref] : []);
          if (rf) li.appendChild(rf);
          ol.appendChild(li);
        });
        rev.appendChild(ol);
        sec.appendChild(rev);
      }
      if (intervals.length) {
        var ki = keyMap(full, 'intervals');
        var rev2 = h('section', { class: 'lab-review' }, heading(5, 'Intervals, true values and explanations'));
        var ol2 = h('ol', { class: 'lab-reviewlist' });
        intervals.forEach(function (q) {
          var k = ki[q.id] || {}, r = range(q.id), lo = parseNum(r.lo), hi = parseNum(r.hi), unit = str(q.unit);
          var hit = isNum(k.answer) && lo <= k.answer && k.answer <= hi;
          var li = h('li', { class: 'lab-reviewitem' });
          li.appendChild(h('p', { class: 'lab-review-q', html: ctx.inline(q.question) }));
          li.appendChild(h('p', { class: 'lab-review-a' }, tag(hit ? 'Inside' : 'Outside', hit ? 'ok' : 'problem'),
            ' Your interval: ' + grouped(lo, decimals(lo)) + ' to ' + grouped(hi, decimals(hi)) + (unit ? ' ' + unit : '') + '. True value: ' + (isNum(k.answer) ? grouped(k.answer, decimals(k.answer)) + (unit ? ' ' + unit : '') : 'not available') + '.'));
          if (k.explanation) li.appendChild(h('p', { class: 'lab-review-x', html: ctx.inline(k.explanation) }));
          var rf = ctx.refs(k.ref ? [k.ref] : []);
          if (rf) li.appendChild(rf);
          ol2.appendChild(li);
        });
        rev2.appendChild(ol2);
        sec.appendChild(rev2);
      }
      sec.appendChild(ctx.startAgain(again));
      view.appendChild(sec);
    }
    function decimals(x) { if (!isNum(x)) return 0; var s = String(x); var i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); }

    function calibrationPlot(R) {
      var W = 360, H = 300, m = { l: 48, r: 16, t: 16, b: 44 };
      var lo = Math.min(50, levels[0]), hi = 100;
      function x(v) { return m.l + (v - lo) / (hi - lo || 1) * (W - m.l - m.r); }
      function y(v) { return H - m.b - v * (H - m.t - m.b); }
      var tid = uid('t'), did = uid('d');
      var used = R.buckets.filter(function (b) { return b.n; });
      var desc = used.map(function (b) { return b.level + '% stated: ' + b.hits + ' of ' + b.n + ' right (' + pct(b.rate) + ')'; }).join('; ');
      var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-chart lab-chart--square', role: 'img', 'aria-labelledby': tid + ' ' + did },
        sv('title', { id: tid, text: 'Calibration plot: stated confidence against actual hit rate' }),
        sv('desc', { id: did, text: 'The dashed diagonal is perfect calibration. ' + desc + '.' }));
      [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
        svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'lab-grid' }));
        svg.appendChild(sv('text', { x: m.l - 6, y: y(v) + 4, class: 'lab-tick', 'text-anchor': 'end', text: Math.round(v * 100) + '%' }));
      });
      levels.forEach(function (lv) { svg.appendChild(sv('text', { x: x(lv), y: H - m.b + 16, class: 'lab-tick', 'text-anchor': 'middle', text: lv + '%' })); });
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'lab-axis' }));
      svg.appendChild(sv('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'lab-axis' }));
      svg.appendChild(sv('line', { x1: x(lo), y1: y(lo / 100), x2: x(100), y2: y(1), class: 'lab-ref lab-ref--dashed' }));
      svg.appendChild(sv('text', { x: (m.l + W - m.r) / 2, y: H - 6, class: 'lab-axislabel', 'text-anchor': 'middle', text: 'Stated confidence' }));
      svg.appendChild(sv('text', { x: 12, y: (m.t + H - m.b) / 2, class: 'lab-axislabel', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + H - m.b) / 2 + ')', text: 'Actual hit rate' }));
      var pts = used.map(function (b) { return x(b.level) + ',' + y(b.rate); });
      if (pts.length > 1) svg.appendChild(sv('polyline', { points: pts.join(' '), class: 'lab-series' }));
      used.forEach(function (b) {
        var r = 4 + Math.sqrt(b.n) * 2;
        svg.appendChild(sv('circle', { cx: x(b.level), cy: y(b.rate), r: r, class: 'lab-point' }));
        svg.appendChild(sv('text', { x: x(b.level) + r + 3, y: y(b.rate) - r + 2, class: 'lab-pointlabel', text: 'n=' + b.n }));
      });
      return h('figure', { class: 'lab-figure' }, svg,
        h('figcaption', { class: 'lab-figcaption', text: 'Each circle is one confidence band (larger = more statements; label shows the count). Points below the dashed diagonal mean overconfidence; above it, underconfidence. The table above holds the same numbers.' }));
    }

    function again() {
      var prev = finished && st.result ? st.result.summary : st.previous;
      st = fresh(prev);
      finished = false;
      ctx.saveNow();
      render();
      ctx.announce('Started again. Your previous result is kept until you submit.');
      focusEl(view.querySelector('.lab-section .lab-h') || view);
    }

    render();
  };

  /* ===================================================================== 2. simulation */

  var SIM_PARAMS = [
    { k: 'n', label: 'Participants per group (n)', step: 1, int: true, fmt: function (v) { return grouped(v); } },
    { k: 'effect', label: 'True effect (Cohen’s d)', step: 0.05, fmt: function (v) { return fixed(v, 2); } },
    { k: 'outcomes', label: 'Outcomes measured per study', step: 1, int: true, fmt: function (v) { return String(v); } },
    { k: 'reliability', label: 'Reliability of the measure', step: 0.05, fmt: function (v) { return fixed(v, 2); } },
    { k: 'studies', label: 'Studies simulated', step: 100, int: true, fmt: function (v) { return grouped(v); } },
  ];
  function simLimits(l) {
    l = obj(l);
    function pair(k, d) { var v = arr(l[k]); return v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] <= v[1] ? [v[0], v[1]] : d.slice(); }
    var L = { n: pair('n', [5, 500]), effect: pair('effect', [0, 1]), outcomes: pair('outcomes', [1, 10]), reliability: pair('reliability', [0.3, 1]), studies: pair('studies', [200, 5000]) };
    L.n = [Math.max(2, Math.round(L.n[0])), Math.max(2, Math.round(L.n[1]))];
    L.outcomes = [Math.max(1, Math.round(L.outcomes[0])), Math.max(1, Math.round(L.outcomes[1]))];
    L.reliability = [clamp(L.reliability[0], 0.05, 1), clamp(L.reliability[1], 0.05, 1)];
    L.studies = [clamp(Math.round(L.studies[0]), 100, 5000), clamp(Math.round(L.studies[1]), 100, 5000)];
    return L;
  }
  function simNorm(p, L) {
    p = obj(p);
    return {
      n: Math.round(clamp(num(p.n, 20), L.n[0], L.n[1])),
      effect: clamp(num(p.effect, 0), L.effect[0], L.effect[1]),
      outcomes: Math.round(clamp(num(p.outcomes, 1), L.outcomes[0], L.outcomes[1])),
      reliability: clamp(num(p.reliability, 1), L.reliability[0], L.reliability[1]),
      studies: Math.round(clamp(num(p.studies, 2000), L.studies[0], L.studies[1])),
      publishOnlySignificant: !!p.publishOnlySignificant,
    };
  }
  function simSame(a, b) {
    return a && b && a.n === b.n && Math.abs(a.effect - b.effect) < 1e-9 && a.outcomes === b.outcomes &&
      Math.abs(a.reliability - b.reliability) < 1e-9 && a.studies === b.studies && !!a.publishOnlySignificant === !!b.publishOnlySignificant;
  }
  function simParamText(p, seed) {
    return 'n = ' + grouped(p.n) + ' per group · true d = ' + fixed(p.effect, 2) + ' · ' + plural(p.outcomes, 'outcome') +
      ' · reliability ' + fixed(p.reliability, 2) + ' · ' + plural(p.studies, 'study', 'studies') + ' · ' +
      (p.publishOnlySignificant ? 'only significant results published' : 'all results published') + (seed !== undefined ? ' · seed ' + seed : '');
  }

  ENGINES.simulation = function (ctx) {
    var cfg = ctx.cfg, L = simLimits(cfg.limits), DEFAULT_SEED = 2718;
    var presets = arr(cfg.presets).filter(function (p) { return p && p.id && p.params; });
    function presetById(id) { for (var i = 0; i < presets.length; i++) if (presets[i].id === id) return presets[i]; return null; }
    function fresh(prev) {
      var p0 = presets[0];
      return { v: 1, preset: p0 ? p0.id : null, params: simNorm(p0 ? p0.params : {}, L), seed: DEFAULT_SEED, predictions: {}, ran: [], runs: {}, last: null, previous: prev || null };
    }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      if (presetById(s0.preset)) st.preset = s0.preset;
      if (s0.params) st.params = simNorm(s0.params, L);
      if (isNum(s0.seed)) st.seed = Math.abs(Math.round(s0.seed)) >>> 0;
      Object.keys(obj(s0.predictions)).forEach(function (k) { if (presetById(k)) st.predictions[k] = str(s0.predictions[k]).slice(0, 2000); });
      st.ran = arr(s0.ran).filter(presetById);
      Object.keys(obj(s0.runs)).forEach(function (k) { if (presetById(k)) st.runs[k] = s0.runs[k]; });
      if (s0.last && s0.last.params) st.last = { params: simNorm(s0.last.params, L), seed: Math.abs(Math.round(num(s0.last.seed, DEFAULT_SEED))) >>> 0, preset: presetById(s0.last.preset) ? s0.last.preset : null, exact: !!s0.last.exact };
      finished = !!ctx.saved.finished;
    }
    var fullCfg = null, current = null, single = 0, job = null;

    function summary() {
      var met = { 'Scenarios run': st.ran.length + '/' + presets.length };
      presets.forEach(function (p) { var r = st.runs[p.id]; if (r) met[str(p.title) + ': share p < .05'] = Number(r.shareSig.toFixed(3)); });
      return { label: (finished ? 'Completed — ' : 'In progress — ') + st.ran.length + ' of ' + presets.length + ' scenarios run', metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Each simulated study compares two groups of n people with normally distributed scores. The true difference is d standard deviations of the true score.',
      'Reliability ρ attenuates what the measure can see: the observed standardized difference is `d × √ρ` (observed SD = 1).',
      'Each group mean and the pooled variance are drawn from their exact sampling distributions — mean difference ~ `N(d√ρ, 2/n)`, pooled variance ~ `χ²(2n − 2) / (2n − 2)` — which is equivalent to drawing 2n individual scores.',
      'Test: Student’s two-sample t-test with pooled variance, `t = (m₁ − m₂) / (s_p √(2/n))`, df = 2n − 2. The two-sided p-value uses the Student-t distribution, computed through the regularized incomplete beta function: `p = I_{df/(df+t²)}(df/2, 1/2)`. Significant means p < .05.',
      'Estimate reported by a study: `d̂ = (m₁ − m₂) / s_p`.',
      'With k outcomes, each outcome is an independent measurement with the same true effect. The “researcher” reports only the outcome with the smallest p — a model of undisclosed multiple testing. With no true effect, the chance that at least one of k reaches p < .05 is `1 − 0.95^k`.',
      'Publication filter: when on, only significant studies reach the published literature; the rest stay in the file drawer.',
      'Share significant = studies with p < .05 ÷ studies. With a true effect this is the power of the design as reported; with no true effect it is the false-positive rate.',
      'Exaggeration ratio (type M) = mean |d̂| among significant studies ÷ true d. Sign errors (type S) = significant studies whose estimate points the opposite way from the true effect. Both are “n/a” when the true effect is 0.',
      'Random numbers come from the mulberry32 generator with the seed shown, so the same seed and settings always reproduce the same results. Normal draws use the Box–Muller transform; chi-square draws use the Marsaglia–Tsang gamma method.',
      'A run counts as a scenario’s run when it uses that scenario’s own settings. You make a prediction before a scenario’s first run; the scenario’s lesson is revealed after it.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function render() { clear(view); if (finished) renderFinished(); else renderWork(); }

    /* ---------- working view ---------- */
    var els = {};
    function renderWork() {
      els = {};
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'p < .05 means: if there were no true effect, a result at least this extreme would turn up less than 5% of the time. It does not mean a 95% chance that the effect is real.'));
      // scenarios
      var name = uid('preset');
      var fsP = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: '1. Choose a scenario' }));
      els.presetStatus = {};
      presets.forEach(function (p) {
        var stEl = h('span', { class: 'lab-option-status' });
        els.presetStatus[p.id] = stEl;
        var inp = h('input', { type: 'radio', name: name, value: p.id, checked: st.preset === p.id, disabled: !!job, onchange: function () { choosePreset(p.id); } });
        fsP.appendChild(h('label', { class: 'lab-option' }, inp, h('span', { class: 'lab-option-body' },
          h('span', { class: 'lab-option-title' }, h('span', { text: str(p.title) || p.id }), stEl),
          p.story ? h('span', { class: 'lab-option-text', html: ctx.inline(p.story) }) : null)));
      });
      els.presetInputs = fsP.querySelectorAll('input');
      view.appendChild(fsP);

      // parameters
      var fsC = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: '2. Settings' }));
      els.ctrl = {};
      SIM_PARAMS.forEach(function (sp) {
        var id = uid(sp.k), lim = L[sp.k];
        var range = h('input', { type: 'range', id: id, min: lim[0], max: lim[1], step: sp.step, value: st.params[sp.k], class: 'lab-range' });
        var box = h('input', { type: 'number', min: lim[0], max: lim[1], step: sp.step, value: st.params[sp.k], class: 'lab-input lab-input--num', 'aria-label': sp.label + ' (exact value)' });
        function set(v, from) {
          v = Number(v);
          if (!isFinite(v)) return;
          v = clamp(v, lim[0], lim[1]);
          if (sp.int) v = Math.round(v); else v = Math.round(v * 1000) / 1000;
          st.params[sp.k] = v;
          if (from !== range) range.value = v;
          if (from !== box) box.value = v;
          paramsChanged();
        }
        range.addEventListener('input', function () { set(range.value, range); });
        box.addEventListener('change', function () { set(box.value, box); box.value = st.params[sp.k]; });
        els.ctrl[sp.k] = [range, box];
        fsC.appendChild(h('div', { class: 'lab-field lab-field--range' }, h('label', { for: id, text: sp.label }), h('div', { class: 'lab-rangerow' }, range, box),
          h('span', { class: 'lab-hint', text: 'Range ' + sp.fmt(lim[0]) + '–' + sp.fmt(lim[1]) })));
      });
      var pubId = uid('pub');
      els.pub = h('input', { type: 'checkbox', id: pubId, checked: st.params.publishOnlySignificant, onchange: function () { st.params.publishOnlySignificant = els.pub.checked; paramsChanged(); } });
      fsC.appendChild(h('div', { class: 'lab-field lab-field--check' }, els.pub, h('label', { for: pubId, text: 'Publish only significant results (publication filter)' })));
      els.match = h('p', { class: 'lab-hint lab-match' });
      els.reset = button('Reset to the scenario’s settings', function () { var p = presetById(st.preset); if (p) { st.params = simNorm(p.params, L); syncControls(); paramsChanged(); } }, 'quiet');
      fsC.appendChild(h('div', { class: 'lab-row lab-row--between' }, els.match, els.reset));
      view.appendChild(fsC);

      // prediction
      els.predict = h('section', { class: 'lab-predict' });
      view.appendChild(els.predict);

      // run row
      var seedId = uid('seed');
      els.seed = h('input', { id: seedId, type: 'number', min: 0, max: 4294967295, step: 1, value: st.seed, class: 'lab-input lab-input--num lab-input--seed' });
      els.seed.addEventListener('change', function () { var v = Math.abs(Math.round(Number(els.seed.value))); if (isFinite(v)) { st.seed = v >>> 0; ctx.touch(); } els.seed.value = st.seed; });
      els.run = button('Run the simulation', function () { run(); }, 'primary');
      els.rerun = button('Re-run with a new seed', function () { st.seed = newSeed(); els.seed.value = st.seed; run(); });
      els.progress = h('p', { class: 'lab-progress', role: 'status' });
      view.appendChild(h('div', { class: 'lab-runrow' },
        h('div', { class: 'lab-field lab-field--inline' }, h('label', { for: seedId, text: 'Seed' }), els.seed),
        h('div', { class: 'lab-actions' }, els.run, els.rerun), els.progress));

      els.results = h('section', { class: 'lab-section lab-results', 'aria-label': 'Simulation results' });
      view.appendChild(els.results);
      els.lesson = h('div', { class: 'lab-lesson' });
      view.appendChild(els.lesson);
      els.finish = h('div', { class: 'lab-finish' });
      view.appendChild(els.finish);

      syncControls();
      paramsChanged(true);
      renderResults();
      renderLesson();
      renderFinish();
      if (st.ran.length) ensureLesson();
      if (!current && st.last && !job) restoreLast();
    }
    function newSeed() {
      try { var a = new Uint32Array(1); global.crypto.getRandomValues(a); return (a[0] % 999999) + 1; } catch (e) { return Math.floor(Math.random() * 999999) + 1; }
    }
    function syncControls() {
      SIM_PARAMS.forEach(function (sp) { els.ctrl[sp.k][0].value = st.params[sp.k]; els.ctrl[sp.k][1].value = st.params[sp.k]; });
      els.pub.checked = st.params.publishOnlySignificant;
    }
    function isExact() { var p = presetById(st.preset); return !!p && simSame(st.params, simNorm(p.params, L)); }
    function needsPrediction() { return isExact() && st.ran.indexOf(st.preset) < 0; }
    function paramsChanged(silent) {
      var p = presetById(st.preset), exact = isExact();
      els.match.textContent = !p ? 'Custom settings.' : exact ? 'Settings match “' + str(p.title) + '”.' : 'Custom settings, based on “' + str(p.title) + '” — this run will not count as the scenario’s run.';
      els.reset.disabled = exact || !p;
      renderPredict();
      if (!silent) ctx.touch();
    }
    function choosePreset(id) {
      if (job) return;
      st.preset = id;
      var p = presetById(id);
      if (p) st.params = simNorm(p.params, L);
      syncControls();
      paramsChanged();
      renderLesson();
    }
    function renderPredict() {
      var box = els.predict;
      clear(box);
      var p = presetById(st.preset);
      if (!p || !needsPrediction()) { box.hidden = true; return; }
      box.hidden = false;
      var id = uid('pred');
      box.appendChild(heading(4, 'Predict first'));
      if (p.predict) box.appendChild(h('p', { class: 'lab-predict-q', html: ctx.inline(p.predict) }));
      var ta = h('textarea', { id: id, class: 'lab-textarea lab-textarea--short', rows: '2', value: str(st.predictions[p.id]) });
      ta.addEventListener('input', function () { st.predictions[p.id] = ta.value.slice(0, 2000); if (els.predErr) els.predErr.textContent = ''; ctx.touch(); });
      els.predInput = ta;
      els.predErr = h('p', { class: 'lab-formerror', role: 'alert' });
      box.appendChild(h('div', { class: 'lab-field' }, h('label', { for: id, text: 'Your prediction (kept with your work; any honest guess is fine)' }), ta));
      box.appendChild(els.predErr);
    }
    function setRunning(on) {
      els.run.disabled = on; els.rerun.disabled = on; els.seed.disabled = on;
      Array.prototype.forEach.call(els.presetInputs || [], function (i) { i.disabled = on; });
      SIM_PARAMS.forEach(function (sp) { els.ctrl[sp.k][0].disabled = on; els.ctrl[sp.k][1].disabled = on; });
      els.pub.disabled = on;
      if (!on) els.reset.disabled = isExact() || !presetById(st.preset);
    }
    function startJob(params, seed, done) {
      var sim = M.simulate(params, seed);
      setRunning(true);
      function tick() {
        job = ctx.later(function () {
          var fin = sim.step(400);
          els.progress.textContent = 'Simulating… ' + grouped(sim.count()) + ' of ' + grouped(sim.N) + ' studies';
          if (fin) { job = null; setRunning(false); els.progress.textContent = ''; done(sim, M.summarizeSimulation(sim, params)); }
          else tick();
        }, 0);
      }
      tick();
    }
    function run() {
      if (job) return;
      var pid = st.preset, p = presetById(pid), exact = isExact();
      if (exact && p && st.ran.indexOf(pid) < 0 && !str(st.predictions[pid]).trim()) {
        els.predErr.textContent = 'Write your prediction first — any honest guess.';
        els.predInput.focus();
        return;
      }
      var params = copy(st.params), seed = st.seed;
      startJob(params, seed, function (sim, res) {
        var first = exact && p && st.ran.indexOf(pid) < 0;
        st.last = { params: params, seed: seed, preset: pid, exact: exact };
        if (exact && p) {
          if (first) st.ran.push(pid);
          st.runs[pid] = { seed: seed, shareSig: res.shareSig, nSig: res.nSig, N: res.N, meanSig: res.meanSig, exaggeration: res.exaggeration, signErrorShare: res.signErrorShare, meanPub: res.meanPub };
        }
        current = { sim: sim, res: res, params: params, seed: seed, preset: pid, exact: exact };
        single = 0;
        renderResults();
        renderPredict();
        renderFinish();
        updatePresetStatus();
        ctx.touch();
        ctx.announce('Simulation complete: ' + pct(res.shareSig, 1) + ' of ' + grouped(res.N) + ' studies reached p < .05.');
        if (exact && p) ensureLesson();
      });
    }
    function restoreLast() {
      var l = st.last;
      startJob(l.params, l.seed, function (sim, res) {
        current = { sim: sim, res: res, params: l.params, seed: l.seed, preset: l.preset, exact: l.exact };
        renderResults();
      });
    }
    function updatePresetStatus() {
      presets.forEach(function (p) { var e = els.presetStatus && els.presetStatus[p.id]; if (e) e.textContent = st.ran.indexOf(p.id) >= 0 ? 'Run' : ''; });
    }

    function renderResults() {
      var box = els.results;
      if (!box) return;
      clear(box);
      updatePresetStatus();
      if (!current) { box.hidden = true; return; }
      box.hidden = false;
      var r = current.res, P = current.params, p = presetById(current.preset);
      box.appendChild(resultsHeading('Results — ' + (current.exact && p ? str(p.title) : 'custom settings')));
      box.appendChild(h('p', { class: 'lab-runmeta', text: simParamText(P, current.seed) }));
      if (current.exact && p && st.predictions[p.id]) {
        box.appendChild(h('p', { class: 'lab-yourpred' }, h('span', { class: 'lab-label lab-label--inline', text: 'Your prediction' }), ' ', h('span', { text: st.predictions[p.id] })));
      }
      var items = [
        { k: 'Studies reaching p < .05', v: pct(r.shareSig, 1) + ' (' + grouped(r.nSig) + ' of ' + grouped(r.N) + ')',
          note: P.effect === 0 ? 'No true effect: this is the false-positive rate. Reference with ' + plural(P.outcomes, 'outcome') + ': 1 − 0.95^' + P.outcomes + ' = ' + pct(r.fpReference, 1) + '.' : (P.outcomes > 1 ? 'Power as reported — inflated by taking the best of ' + P.outcomes + ' outcomes.' : 'The power of this design.') },
        { k: 'Mean estimate among significant studies', v: r.meanSig === null ? 'n/a (none significant)' : 'd̂ = ' + fixed(r.meanSig, 2), note: 'True effect d = ' + fixed(P.effect, 2) + (P.reliability < 1 ? '; what the measure can see, d√ρ = ' + fixed(r.attenuated, 2) : '') },
        { k: 'Exaggeration ratio (type M)', v: r.exaggeration === null ? 'n/a' : fixed(r.exaggeration, 2) + '×', note: P.effect === 0 ? 'Undefined with no true effect: every significant result is a false positive.' : 'Mean |d̂| among significant studies ÷ true d.' },
        { k: 'Sign errors (type S)', v: r.signErrors === null ? 'n/a' : grouped(r.signErrors) + ' of ' + grouped(r.nSig) + (r.nSig ? ' (' + pct(r.signErrorShare, 1) + ')' : ''), note: P.effect === 0 ? 'Undefined with no true effect.' : 'Significant studies pointing the wrong way.' },
        { k: 'Mean estimate across all studies run', v: 'd̂ = ' + fixed(r.meanAll, 2), note: 'Expected about d√ρ = ' + fixed(r.attenuated, 2) + (P.outcomes > 1 ? ' before picking the best outcome' : '') },
      ];
      if (P.publishOnlySignificant) items.push({ k: 'What the published literature shows', v: r.nPub ? grouped(r.nPub) + ' studies, mean d̂ = ' + fixed(r.meanPub, 2) : 'Nothing published', note: grouped(r.N - r.nPub) + ' studies stayed in the file drawer.' });
      box.appendChild(metrics(items));
      box.appendChild(histogramFigure(r, P));
      box.appendChild(singleStudy());
    }

    function histogramFigure(r, P) {
      var b = r.bins, nb = b.sig.length, W = 640, H = 250, m = { l: 48, r: 14, t: 14, b: 42 };
      var maxC = 1;
      for (var i = 0; i < nb; i++) maxC = Math.max(maxC, b.sig[i] + b.ns[i]);
      function x(v) { return m.l + (v - b.lo) / (b.hi - b.lo) * (W - m.l - m.r); }
      function y(c) { return H - m.b - c / maxC * (H - m.t - m.b); }
      var tid = uid('t'), did = uid('d'), pat = uid('hatch');
      var sigWord = P.publishOnlySignificant ? 'published (p < .05)' : 'significant (p < .05)';
      var nsWord = P.publishOnlySignificant ? 'file drawer (p ≥ .05)' : 'not significant (p ≥ .05)';
      var mode = 0, modeC = -1;
      for (var j = 0; j < nb; j++) if (b.sig[j] + b.ns[j] > modeC) { modeC = b.sig[j] + b.ns[j]; mode = j; }
      var desc = 'Histogram of ' + grouped(r.N) + ' estimated effects from ' + fixed(b.lo, 2) + ' to ' + fixed(b.hi, 2) + ' in bins of ' + b.width + '. The most common bin is ' + fixed(b.lo + mode * b.width, 2) + ' to ' + fixed(b.lo + (mode + 1) * b.width, 2) + '. ' +
        grouped(r.nSig) + ' estimates are ' + sigWord + (r.meanSig !== null ? ', averaging ' + fixed(r.meanSig, 2) : '') + '; the true effect is ' + fixed(P.effect, 2) + '.';
      var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-chart', role: 'img', 'aria-labelledby': tid + ' ' + did },
        sv('title', { id: tid, text: 'Distribution of estimated effects across simulated studies' }),
        sv('desc', { id: did, text: desc }),
        sv('defs', null, sv('pattern', { id: pat, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
          sv('rect', { width: 6, height: 6, class: 'lab-hatch-bg' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'lab-hatch-line' }))));
      var yt = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return Math.round(maxC * f); });
      yt.forEach(function (c) {
        svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(c), y2: y(c), class: 'lab-grid' }));
        svg.appendChild(sv('text', { x: m.l - 6, y: y(c) + 4, class: 'lab-tick', 'text-anchor': 'end', text: grouped(c) }));
      });
      var bw = (W - m.l - m.r) / nb;
      for (var k = 0; k < nb; k++) {
        var x0 = m.l + k * bw, ns = b.ns[k], sg = b.sig[k];
        if (ns) svg.appendChild(sv('rect', { x: x0 + 0.5, y: y(ns), width: Math.max(0.5, bw - 1), height: y(0) - y(ns), class: 'lab-bar-ns' }));
        if (sg) svg.appendChild(sv('rect', { x: x0 + 0.5, y: y(ns + sg), width: Math.max(0.5, bw - 1), height: y(ns) - y(ns + sg), class: 'lab-bar-sig', fill: 'url(#' + pat + ')' }));
      }
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: 'lab-axis' }));
      var span = b.hi - b.lo, tstep = span > 4 ? 1 : span > 2 ? 0.5 : 0.25;
      for (var tv = Math.ceil(b.lo / tstep) * tstep; tv <= b.hi + 1e-9; tv += tstep) {
        svg.appendChild(sv('line', { x1: x(tv), x2: x(tv), y1: y(0), y2: y(0) + 4, class: 'lab-axis' }));
        svg.appendChild(sv('text', { x: x(tv), y: y(0) + 17, class: 'lab-tick', 'text-anchor': 'middle', text: fixed(tv, 2) }));
      }
      svg.appendChild(sv('text', { x: (m.l + W - m.r) / 2, y: H - 4, class: 'lab-axislabel', 'text-anchor': 'middle', text: 'Estimated effect d̂ reported by each study' }));
      function vline(v, cls, text, anchorRight) {
        if (v < b.lo || v > b.hi) return;
        svg.appendChild(sv('line', { x1: x(v), x2: x(v), y1: m.t, y2: y(0), class: cls }));
        svg.appendChild(sv('text', { x: x(v) + (anchorRight ? -4 : 4), y: m.t + 10, class: 'lab-reflabel', 'text-anchor': anchorRight ? 'end' : 'start', text: text }));
      }
      vline(P.effect, 'lab-ref', 'true d = ' + fixed(P.effect, 2), P.reliability < 1);
      if (P.reliability < 1 && Math.abs(r.attenuated - P.effect) > 0.005) vline(r.attenuated, 'lab-ref lab-ref--dashed', 'd√ρ', false);
      function swatch(sig) {
        var p2 = uid('hatch');
        return sv('svg', { viewBox: '0 0 14 14', width: 14, height: 14, class: 'lab-swatch', 'aria-hidden': 'true', focusable: 'false' },
          sig ? sv('defs', null, sv('pattern', { id: p2, width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, sv('rect', { width: 4, height: 4, class: 'lab-hatch-bg' }), sv('line', { x1: 0, y1: 0, x2: 0, y2: 4, class: 'lab-hatch-line' }))) : null,
          sv('rect', { x: 0.5, y: 0.5, width: 13, height: 13, class: sig ? 'lab-bar-sig' : 'lab-bar-ns', fill: sig ? 'url(#' + p2 + ')' : null }));
      }
      var legend = h('ul', { class: 'lab-legend-list' },
        h('li', null, swatch(true), ' Hatched: ' + sigWord),
        h('li', null, swatch(false), ' Plain: ' + nsWord),
        h('li', null, h('span', { class: 'lab-legend-line', 'aria-hidden': 'true' }), ' Solid line: the true effect' + (P.reliability < 1 ? '; dashed: d√ρ' : '')));
      var rows = [];
      for (var q = 0; q < nb; q++) {
        if (!b.sig[q] && !b.ns[q]) continue;
        var lo = b.lo + q * b.width, hi = lo + b.width;
        var lab = (q === 0 && b.below ? '≤ ' : '') + fixed(lo, 2) + ' to ' + fixed(hi, 2) + (q === nb - 1 && b.above ? ' and above' : '');
        rows.push([lab, { text: grouped(b.sig[q]), num: true }, { text: grouped(b.ns[q]), num: true }]);
      }
      var det = h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Show the histogram as a table' }),
        table({ caption: 'Estimates by bin', headers: ['Estimated d̂', { text: P.publishOnlySignificant ? 'Published' : 'p < .05', num: true }, { text: P.publishOnlySignificant ? 'File drawer' : 'p ≥ .05', num: true }], rowHeader: true, rows: rows }));
      var note = b.below || b.above ? ' Estimates beyond the axis (' + grouped(b.below + b.above) + ') are counted in the end bins.' : '';
      return h('figure', { class: 'lab-figure' }, svg, legend, h('figcaption', { class: 'lab-figcaption', text: desc + note }), det);
    }

    function singleStudy() {
      var box = h('div', { class: 'lab-single' });
      function draw() {
        clear(box);
        var c = current, P = c.params, i = single % c.sim.N;
        var d = c.sim.est[i], p = c.sim.pv[i], t = c.sim.tv[i], sig = p < 0.05;
        box.appendChild(heading(5, 'What a single study would have told you'));
        box.appendChild(h('p', { class: 'lab-single-stats', text: 'Study ' + grouped(i + 1) + ' of ' + grouped(c.sim.N) + ': d̂ = ' + fixed(d, 2) + ', t(' + c.sim.df + ') = ' + fixed(t, 2) + ', ' + pText(p) + ' — ' + (sig ? 'significant' : 'not significant') + (P.publishOnlySignificant ? (sig ? ', published.' : ', left in the file drawer.') : '.') }));
        var msg;
        if (P.effect === 0) msg = sig ? 'Read alone, this study reports an effect that does not exist: a false positive.' : 'Read alone, this study finds nothing — correctly here, although a non-significant result cannot by itself show that there is no effect.';
        else if (sig && d < 0) msg = 'Read alone, this study reports a significant effect in the wrong direction (a sign error).';
        else if (sig) msg = 'Read alone, this study reports a significant effect of d̂ = ' + fixed(d, 2) + ' — ' + fixed(Math.abs(d) / P.effect, 1) + ' times the true effect of ' + fixed(P.effect, 2) + '.';
        else msg = 'Read alone, this study finds no significant effect, although the true effect is d = ' + fixed(P.effect, 2) + '.';
        box.appendChild(h('p', { class: 'lab-single-msg', text: msg + (P.outcomes > 1 ? ' It reports the best of ' + P.outcomes + ' outcomes without saying so.' : '') }));
        box.appendChild(button('Show another single study', function () { single += 1; draw(); ctx.announce(box.querySelector('.lab-single-stats').textContent); }, 'quiet'));
      }
      draw();
      return box;
    }

    function ensureLesson() {
      if (fullCfg) { renderLesson(); return; }
      ctx.reveal().then(function (full) { if (ctx.destroyed) return; fullCfg = full; render2(); }, function () {
        if (ctx.destroyed) return;
        var box = finished ? view.querySelector('.lab-lesson') : els.lesson;
        if (box) { clear(box); box.appendChild(ctx.errorPanel('The scenario’s lesson could not be loaded.', ensureLesson)); }
      });
      function render2() { if (finished) render(); else renderLesson(); }
    }
    function lessonFor(id) {
      if (!fullCfg) return null;
      var ps = arr(fullCfg.presets);
      for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return obj(ps[i].key).lesson || null;
      return null;
    }
    function renderLesson() {
      var box = els.lesson;
      if (!box) return;
      clear(box);
      var p = presetById(st.preset);
      if (!p || st.ran.indexOf(p.id) < 0) { box.hidden = true; return; }
      box.hidden = false;
      var text = lessonFor(p.id);
      box.appendChild(heading(5, 'Lesson — ' + str(p.title)));
      if (text) box.appendChild(h('p', { html: ctx.inline(text) }));
      else box.appendChild(ctx.waitPanel('Loading the lesson…'));
    }
    function renderFinish() {
      var box = els.finish;
      if (!box) return;
      clear(box);
      var done = presets.length ? presets.every(function (p) { return st.ran.indexOf(p.id) >= 0; }) : !!st.last;
      box.appendChild(h('p', { class: 'lab-hint', text: presets.length ? 'Run every scenario with its own settings to finish: ' + st.ran.length + ' of ' + presets.length + ' done. You can keep exploring custom settings at any time.' : 'Run the simulation at least once to finish.' }));
      box.appendChild(button('Finish the lab', function () {
        finished = true;
        ctx.saveNow();
        render();
        ctx.announce('Lab finished. ' + summary().label + '.');
        focusEl(view.querySelector('.lab-h--results'));
      }, 'primary', { disabled: !done }));
    }

    /* ---------- finished view ---------- */
    function renderFinished() {
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Your scenarios'));
      sec.appendChild(table({
        caption: 'Your runs, one per scenario (latest run with the scenario’s settings)',
        headers: ['Scenario', 'Your prediction', { text: 'p < .05', num: true }, { text: 'Mean d̂ (significant)', num: true }, { text: 'Exaggeration', num: true }, { text: 'Sign errors', num: true }],
        rowHeader: true,
        rows: presets.map(function (p) {
          var r = st.runs[p.id];
          return [str(p.title), st.predictions[p.id] || '—',
            { text: r ? pct(r.shareSig, 1) : '—', num: true }, { text: r && isNum(r.meanSig) ? fixed(r.meanSig, 2) : 'n/a', num: true },
            { text: r && isNum(r.exaggeration) ? fixed(r.exaggeration, 2) + '×' : 'n/a', num: true }, { text: r && isNum(r.signErrorShare) ? pct(r.signErrorShare, 1) : 'n/a', num: true }];
        }),
      }));
      var lessons = h('div', { class: 'lab-lesson' });
      if (!fullCfg) { lessons.appendChild(ctx.waitPanel('Loading the lessons…')); ensureLesson(); }
      else presets.forEach(function (p) { var t = lessonFor(p.id); if (t) lessons.appendChild(h('div', { class: 'lab-lessonitem' }, heading(5, str(p.title)), h('p', { html: ctx.inline(t) }))); });
      sec.appendChild(lessons);
      sec.appendChild(ctx.startAgain(function () {
        st = fresh(summary());
        finished = false;
        current = null;
        ctx.saveNow();
        render();
        ctx.announce('Started again with fresh scenarios. Your previous result is kept until you finish.');
        focusEl(view.querySelector('.lab-legend'));
      }));
      view.appendChild(sec);
    }

    ctx.onDestroy(function () { if (job) ctx.cancel(job); job = null; });
    render();
  };

  /* ===================================================================== 3. design */

  var BANDS = [
    { max: -4, word: 'Strong risk' }, { max: -2, word: 'Risk' }, { max: 1, word: 'Mixed or neutral' },
    { max: 3, word: 'Support' }, { max: 6, word: 'Strong support' },
  ];
  function bandWord(o) { for (var i = 0; i < BANDS.length; i++) if (o <= BANDS[i].max) return BANDS[i].word; return BANDS[BANDS.length - 1].word; }

  ENGINES.design = function (ctx) {
    var cfg = ctx.cfg;
    var indicators = arr(cfg.indicators).filter(function (i) { return i && i.id; });
    var dims = arr(cfg.dimensions).filter(function (d) { return d && d.id && arr(d.options).length; });
    var rulesCfg = arr(cfg.rules).filter(function (r) { return r && r.when; });
    function optionOf(dim, id) { var os = arr(dim.options); for (var i = 0; i < os.length; i++) if (os[i].id === id) return os[i]; return null; }

    function fresh(prev) { return { v: 1, choices: {}, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      dims.forEach(function (d) { var c = obj(s0.choices)[d.id]; if (optionOf(d, c)) st.choices[d.id] = c; });
      finished = !!ctx.saved.finished && dims.every(function (d) { return st.choices[d.id]; });
    }

    function totals() {
      var t = {};
      indicators.forEach(function (i) { t[i.id] = 0; });
      dims.forEach(function (d) {
        var o = optionOf(d, st.choices[d.id]);
        if (o) Object.keys(obj(o.effects)).forEach(function (k) { if (k in t && isNum(o.effects[k])) t[k] += o.effects[k]; });
      });
      return indicators.map(function (i) {
        var raw = t[i.id], clamped = clamp(raw, -6, 6), oriented = i.good === 'low' ? -clamped : clamped;
        return { ind: i, raw: raw, clamped: clamped, oriented: oriented, word: bandWord(oriented) };
      });
    }
    function fired() {
      return rulesCfg.filter(function (r) {
        var w = obj(r.when), ks = Object.keys(w);
        return ks.length > 0 && ks.every(function (k) { return st.choices[k] === w[k]; });
      });
    }
    function chosenCount() { return dims.filter(function (d) { return st.choices[d.id]; }).length; }
    function summary() {
      var met = {};
      totals().forEach(function (t) { met[str(t.ind.label)] = t.word + ' (' + signed(t.oriented) + ')'; });
      met['Combination notes'] = fired().length;
      var strongRisk = totals().filter(function (t) { return t.oriented <= -4; }).length;
      return { label: 'Design recorded — ' + plural(strongRisk, 'strong risk', 'strong risks') + ', ' + plural(fired().length, 'combination note'), metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: finished ? summary() : { label: 'In progress — ' + chosenCount() + ' of ' + dims.length + ' dimensions chosen', metrics: { 'Dimensions chosen': chosenCount() } } }; });

    // rules disclosure: formulas + every option's effects + every rule
    var extra = [heading(4, 'Every option’s effects', 'lab-h--small')];
    function effText(eff) {
      var ks = Object.keys(obj(eff)).filter(function (k) { return isNum(eff[k]) && eff[k] !== 0; });
      if (!ks.length) return 'no effect on any indicator';
      return ks.map(function (k) { var ind = indicators.filter(function (i) { return i.id === k; })[0]; return (ind ? str(ind.label) : k) + ' ' + signed(eff[k]); }).join(', ');
    }
    dims.forEach(function (d) {
      extra.push(heading(5, str(d.label)));
      extra.push(h('ul', { class: 'lab-list' }, arr(d.options).map(function (o) { return h('li', null, h('strong', { text: str(o.label) }), ': ' + effText(o.effects)); })));
    });
    if (rulesCfg.length) {
      extra.push(heading(4, 'Every combination rule', 'lab-h--small'));
      extra.push(h('ul', { class: 'lab-list' }, rulesCfg.map(function (r) {
        var cond = Object.keys(obj(r.when)).map(function (k) {
          var d = dims.filter(function (x) { return x.id === k; })[0], o = d && optionOf(d, r.when[k]);
          return (d ? str(d.label) : k) + ' = ' + (o ? str(o.label) : str(r.when[k]));
        }).join(' and ');
        return h('li', null, h('span', { text: 'When ' + cond + ': ' }), h('span', { html: ctx.inline(r.text) }));
      })));
    }
    ctx.body.appendChild(ctx.rulesPanel([
      'Choose one option per dimension. Each option has integer effects (−3…+3) on named indicators.',
      'Indicator total = sum of the chosen options’ effects, clamped to −6…+6. Dimensions not yet chosen contribute nothing.',
      'Direction: for an indicator where higher is good, the total is shown as is; where lower is good (for example a risk), its sign is flipped, so the scale always runs from risk to support.',
      'Words on the scale: −6 to −4 strong risk; −3 to −2 risk; −1 to +1 mixed or neutral; +2 to +3 support; +4 to +6 strong support.',
      'Combination notes fire when every condition of a rule matches your current choices.',
      'These are ordinal teaching heuristics drawn from the cited research — an aid to reasoning about trade-offs, not predictions or percentages.',
    ], extra));

    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);
    var out = {};

    function render() { clear(view); if (finished) renderFinished(); else renderWork(); }

    function renderWork() {
      if (cfg.brief) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.brief));
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'Try several designs. Watch which indicators move together and which trade off — no design scores well on everything.'));
      var grid = h('div', { class: 'lab-split' });
      var left = h('div', { class: 'lab-split-main' }), right = h('div', { class: 'lab-split-side' });
      out.progress = h('p', { class: 'lab-progress' });
      left.appendChild(out.progress);
      dims.forEach(function (d) {
        var name = uid('dim'), fs = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: str(d.label) }));
        if (d.help) fs.appendChild(h('p', { class: 'lab-help', html: ctx.inline(d.help) }));
        var why = h('div', { class: 'lab-why', 'aria-live': 'off' });
        arr(d.options).forEach(function (o) {
          var inp = h('input', { type: 'radio', name: name, value: o.id, checked: st.choices[d.id] === o.id });
          inp.addEventListener('change', function () { st.choices[d.id] = o.id; showWhy(); update(true); ctx.touch(); });
          fs.appendChild(h('label', { class: 'lab-option' }, inp, h('span', { class: 'lab-option-body' }, h('span', { class: 'lab-option-title', text: str(o.label) }))));
        });
        function showWhy() {
          clear(why);
          var o = optionOf(d, st.choices[d.id]);
          if (!o) return;
          why.appendChild(h('p', null, h('span', { class: 'lab-label lab-label--inline', text: 'Why' }), ' ', h('span', { html: ctx.inline(o.why) })));
          why.appendChild(h('p', { class: 'lab-effects', text: 'Effects: ' + effText(o.effects) }));
          var rf = ctx.refs(o.refs);
          if (rf) why.appendChild(rf);
        }
        showWhy();
        fs.appendChild(why);
        left.appendChild(fs);
      });
      out.indicators = h('div', { class: 'lab-indicators' });
      out.rules = h('div', { class: 'lab-fired' });
      right.appendChild(heading(4, 'Indicators'));
      right.appendChild(out.indicators);
      right.appendChild(out.rules);
      if (cfg.disclaimer) right.appendChild(h('p', { class: 'lab-disclaimer', html: ctx.inline(cfg.disclaimer) }));
      out.finish = h('div', { class: 'lab-finish' });
      right.appendChild(out.finish);
      grid.appendChild(left);
      grid.appendChild(right);
      view.appendChild(grid);
      update(false);
    }

    var lastFired = null;
    function update(announce) {
      out.progress.textContent = chosenCount() + ' of ' + dims.length + ' dimensions chosen';
      drawIndicators(out.indicators);
      var f = fired();
      drawRules(out.rules, f);
      clear(out.finish);
      var all = chosenCount() === dims.length;
      out.finish.appendChild(button('Record this design', function () {
        finished = true; ctx.saveNow(); render();
        ctx.announce('Design recorded. ' + summary().label + '.');
        focusEl(view.querySelector('.lab-h--results'));
      }, 'primary', { disabled: !all }));
      if (!all) out.finish.appendChild(h('p', { class: 'lab-hint', text: 'Choose an option on every dimension to record the design.' }));
      var ids = f.map(function (r) { return r.id; }).join(',');
      if (announce && ids !== lastFired) {
        var t = totals().map(function (x) { return str(x.ind.label) + ': ' + x.word.toLowerCase(); }).join('; ');
        ctx.announce(t + '. ' + plural(f.length, 'combination note') + ' apply.');
      }
      lastFired = ids;
    }

    function scaleSVG(t) {
      var W = 260, H = 30, m = 10;
      function x(v) { return m + (v + 6) / 12 * (W - 2 * m); }
      var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-scale', 'aria-hidden': 'true', focusable: 'false' });
      svg.appendChild(sv('line', { x1: x(-6), x2: x(6), y1: 14, y2: 14, class: 'lab-axis' }));
      for (var v = -6; v <= 6; v++) svg.appendChild(sv('line', { x1: x(v), x2: x(v), y1: v === 0 ? 7 : 10, y2: v === 0 ? 21 : 18, class: v === 0 ? 'lab-axis' : 'lab-grid' }));
      var cx = x(t.oriented);
      svg.appendChild(sv('path', { d: 'M' + cx + ' 5 L' + (cx + 6) + ' 14 L' + cx + ' 23 L' + (cx - 6) + ' 14 Z', class: 'lab-marker' }));
      return svg;
    }
    function drawIndicators(el) {
      clear(el);
      var ul = h('ul', { class: 'lab-indlist' });
      totals().forEach(function (t) {
        var dir = t.ind.good === 'low' ? 'lower is better' : 'higher is better';
        ul.appendChild(h('li', { class: 'lab-ind' },
          h('div', { class: 'lab-ind-head' }, h('span', { class: 'lab-ind-label', text: str(t.ind.label) }), h('span', { class: 'lab-ind-word', text: t.word })),
          scaleSVG(t),
          h('div', { class: 'lab-scale-ends', 'aria-hidden': 'true' }, h('span', { text: 'strong risk' }), h('span', { text: 'strong support' })),
          h('p', { class: 'lab-ind-detail', text: 'Score ' + signed(t.oriented) + ' on a −6 to +6 scale (raw total ' + signed(t.raw) + (t.raw !== t.clamped ? ', clamped' : '') + '; ' + dir + ')' })));
      });
      el.appendChild(ul);
    }
    function drawRules(el, f) {
      clear(el);
      el.appendChild(heading(4, 'Combination notes'));
      if (!f.length) { el.appendChild(h('p', { class: 'lab-hint', text: 'None of the combination rules applies to the current choices.' })); return; }
      var ul = h('ul', { class: 'lab-list lab-list--notes' });
      f.forEach(function (r) { var li = h('li', null, h('p', { html: ctx.inline(r.text) })); var rf = ctx.refs(r.refs); if (rf) li.appendChild(rf); ul.appendChild(li); });
      el.appendChild(ul);
    }

    function renderFinished() {
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Your recorded design'));
      sec.appendChild(table({
        caption: 'Your choices', headers: ['Dimension', 'Your choice', 'Effects'], rowHeader: true,
        rows: dims.map(function (d) { var o = optionOf(d, st.choices[d.id]); return [str(d.label), o ? str(o.label) : '—', o ? effText(o.effects) : '—']; }),
      }));
      var ind = h('div', { class: 'lab-indicators' });
      drawIndicators(ind);
      sec.appendChild(heading(5, 'Indicators'));
      sec.appendChild(ind);
      var rl = h('div', { class: 'lab-fired' });
      drawRules(rl, fired());
      sec.appendChild(rl);
      var whys = h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Why each choice moves the indicators' }));
      dims.forEach(function (d) {
        var o = optionOf(d, st.choices[d.id]);
        if (!o) return;
        whys.appendChild(h('div', { class: 'lab-whyitem' }, heading(5, str(d.label) + ': ' + str(o.label)), h('p', { html: ctx.inline(o.why) }), ctx.refs(o.refs)));
      });
      sec.appendChild(whys);
      if (cfg.disclaimer) sec.appendChild(h('p', { class: 'lab-disclaimer', html: ctx.inline(cfg.disclaimer) }));
      sec.appendChild(ctx.startAgain(function () {
        st = fresh(summary()); finished = false; ctx.saveNow(); render();
        ctx.announce('Started a new design. Your recorded design is kept until you record another.');
        focusEl(view.querySelector('.lab-legend'));
      }));
      view.appendChild(sec);
    }
    render();
  };

  /* ===================================================================== 4. branching */

  ENGINES.branching = function (ctx) {
    var cfg = ctx.cfg, nodes = obj(cfg.nodes);
    var indicators = arr(cfg.indicators).filter(function (i) { return i && i.id; });
    function node(id) { return Object.prototype.hasOwnProperty.call(nodes, id) ? obj(nodes[id]) : null; }
    function choiceOf(n, id) { var cs = arr(n && n.choices); for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i]; return null; }
    var startId = node(cfg.start) ? cfg.start : Object.keys(nodes)[0];

    function fresh(prev) { return { v: 1, at: startId, path: [], feedback: false, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state), ok = true, at = startId, path = [];
      arr(s0.path).forEach(function (p) {
        if (!ok) return;
        var n = node(p && p.node), c = choiceOf(n, p && p.choice);
        if (!n || !c || p.node !== at) { ok = false; return; }
        path.push({ node: p.node, choice: p.choice });
        at = c.next;
      });
      st = fresh(s0.previous || null);
      if (ok) {
        st.path = path;
        st.feedback = !!s0.feedback && path.length > 0;
        st.at = st.feedback ? path[path.length - 1].node : at;
        if (!node(st.at)) { st = fresh(s0.previous || null); }
        finished = !!ctx.saved.finished && !st.feedback && !!node(st.at) && !!node(st.at).end;
      }
    }

    function values() {
      var v = {};
      indicators.forEach(function (i) { v[i.id] = num(i.start, 0); });
      st.path.forEach(function (p) {
        var c = choiceOf(node(p.node), p.choice);
        if (c) Object.keys(obj(c.effects)).forEach(function (k) { if (k in v && isNum(c.effects[k])) v[k] += c.effects[k]; });
      });
      return v;
    }
    function indLabel(id) { var i = indicators.filter(function (x) { return x.id === id; })[0]; return i ? str(i.label) : id; }
    function effList(eff) {
      var ks = Object.keys(obj(eff)).filter(function (k) { return isNum(eff[k]) && eff[k] !== 0; });
      return ks.map(function (k) { return indLabel(k) + ' ' + signed(eff[k]); });
    }
    function summary() {
      var n = node(st.at), v = values(), met = {};
      indicators.forEach(function (i) { met[str(i.label)] = v[i.id]; });
      met.Decisions = st.path.length;
      return { label: (finished ? 'Ending: ' : 'In progress — at: ') + str(n && n.title), metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: finished ? summary() : { label: 'In progress — ' + plural(st.path.length, 'decision') + ' made', metrics: { Decisions: st.path.length } } }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Each indicator starts at its starting value' + (indicators.length ? ' (' + indicators.map(function (i) { return str(i.label) + ' ' + signed(num(i.start, 0)); }).join(', ') + ')' : '') + '.',
      'Each choice adds its integer effects (−2…+2 per indicator) to the running totals, and leads to the next moment of the scenario. Totals are shown as signed numbers.',
      'Feedback appears immediately after each choice; the ending depends on the path you take. No path is simply “correct” — the scenario is built around trade-offs.',
      'Indicator moves are ordinal teaching heuristics grounded in the cited ideas, not measurements or predictions of how a real person would respond.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function indicatorStrip(deltas) {
      var v = values(), ul = h('ul', { class: 'lab-strip', 'aria-label': 'Indicators' });
      indicators.forEach(function (i) {
        var d = deltas && isNum(deltas[i.id]) && deltas[i.id] !== 0 ? deltas[i.id] : null;
        ul.appendChild(h('li', { class: 'lab-strip-item' },
          h('span', { class: 'lab-strip-label', text: str(i.label) + (i.good === 'low' ? ' (lower is better)' : '') }),
          h('span', { class: 'lab-strip-value', text: signed(v[i.id]) }),
          d !== null ? h('span', { class: 'lab-strip-delta', text: '(' + signed(d) + ' this step)' }) : null));
      });
      return ul;
    }
    function pathReview(full) {
      var ol = h('ol', { class: 'lab-pathlist' });
      st.path.forEach(function (p) {
        var n = node(p.node), c = choiceOf(n, p.choice);
        var li = h('li', { class: 'lab-pathitem' }, h('p', { class: 'lab-path-title', text: str(n.title) }),
          h('p', { class: 'lab-path-choice' }, h('span', { class: 'lab-label lab-label--inline', text: 'You' }), ' ', h('span', { html: ctx.inline(c.label) })));
        var e = effList(c.effects);
        li.appendChild(h('p', { class: 'lab-effects', text: e.length ? 'Moves: ' + e.join(', ') : 'No change to the indicators' }));
        if (full) {
          if (c.feedback) li.appendChild(h('p', { class: 'lab-path-feedback', html: ctx.inline(c.feedback) }));
          var rf = ctx.refs(c.refs); if (rf) li.appendChild(rf);
          var others = arr(n.choices).filter(function (x) { return x.id !== c.id; });
          if (others.length) li.appendChild(h('div', { class: 'lab-others' }, h('p', { class: 'lab-label', text: 'Other options at this point' }),
            h('ul', { class: 'lab-list' }, others.map(function (o) { var oe = effList(o.effects); return h('li', null, h('span', { html: ctx.inline(o.label) }), h('span', { class: 'lab-effects', text: ' — ' + (oe.length ? oe.join(', ') : 'no indicator change') })); }))));
        }
        ol.appendChild(li);
      });
      return ol;
    }

    function render(focusSel) {
      clear(view);
      var n = node(st.at);
      if (!n) { view.appendChild(h('p', { class: 'lab-error', role: 'alert', text: 'This scenario is missing a step (“' + str(st.at) + '”).' })); view.appendChild(ctx.startAgain(again)); return; }
      if (finished) { renderEnd(n); }
      else if (st.feedback) { renderFeedback(n); }
      else { renderNode(n); }
      if (focusSel) focusEl(view.querySelector(focusSel));
    }
    function renderNode(n) {
      view.appendChild(indicatorStrip());
      var sec = h('section', { class: 'lab-node' });
      sec.appendChild(label('Decision ' + (st.path.length + 1)));
      sec.appendChild(heading(4, str(n.title), 'lab-node-title'));
      if (n.speaker) sec.appendChild(h('p', { class: 'lab-speaker', text: str(n.speaker) }));
      ctx.rich(sec, n.text);
      var list = h('ul', { class: 'lab-choices', 'aria-label': 'Your options' });
      arr(n.choices).forEach(function (c) {
        list.appendChild(h('li', null, h('button', { type: 'button', class: 'lab-choice', html: ctx.inline(c.label), onclick: function () { choose(c); } })));
      });
      sec.appendChild(list);
      view.appendChild(sec);
      if (st.path.length) {
        var d = h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Your path so far (' + plural(st.path.length, 'decision') + ')' }), pathReview(false));
        view.appendChild(d);
      }
    }
    function choose(c) {
      st.path.push({ node: st.at, choice: c.id });
      st.feedback = true;
      ctx.touch();
      render('.lab-feedback .lab-h');
      var e = effList(c.effects);
      ctx.announce((e.length ? e.join(', ') : 'No change to the indicators') + '.');
    }
    function renderFeedback(n) {
      var last = st.path[st.path.length - 1], c = choiceOf(n, last.choice);
      view.appendChild(indicatorStrip(c.effects));
      var sec = h('section', { class: 'lab-node lab-feedback' });
      sec.appendChild(label('Decision ' + st.path.length + ' — feedback'));
      sec.appendChild(heading(4, str(n.title), 'lab-node-title'));
      sec.appendChild(h('p', { class: 'lab-path-choice' }, h('span', { class: 'lab-label lab-label--inline', text: 'You chose' }), ' ', h('span', { html: ctx.inline(c.label) })));
      var e = effList(c.effects);
      sec.appendChild(h('p', { class: 'lab-effects lab-effects--strong', text: e.length ? 'Moves: ' + e.join(', ') : 'No change to the indicators' }));
      if (c.feedback) sec.appendChild(h('p', { class: 'lab-feedback-text', html: ctx.inline(c.feedback) }));
      var rf = ctx.refs(c.refs); if (rf) sec.appendChild(rf);
      var nextNode = node(c.next);
      sec.appendChild(h('div', { class: 'lab-actions' }, button(nextNode && nextNode.end ? 'See how it ends' : 'Continue', function () {
        st.at = c.next; st.feedback = false;
        var nn = node(st.at);
        if (nn && nn.end) { finished = true; ctx.saveNow(); render('.lab-h--results'); ctx.announce('Ending reached: ' + str(nn.title) + '.'); }
        else { ctx.touch(); render('.lab-node-title'); }
      }, 'primary')));
      view.appendChild(sec);
    }
    function renderEnd(n) {
      var sec = h('section', { class: 'lab-section lab-results lab-ending' });
      sec.appendChild(label('Ending'));
      sec.appendChild(resultsHeading(str(n.title)));
      ctx.rich(sec, n.text);
      var v = values();
      sec.appendChild(heading(5, 'Where the indicators ended'));
      sec.appendChild(table({
        caption: 'Final indicators', headers: ['Indicator', { text: 'Start', num: true }, { text: 'End', num: true }, { text: 'Change', num: true }], rowHeader: true,
        rows: indicators.map(function (i) { var s = num(i.start, 0); return [str(i.label) + (i.good === 'low' ? ' (lower is better)' : ''), { text: signed(s), num: true }, { text: signed(v[i.id]), num: true }, { text: signed(v[i.id] - s), num: true }]; }),
      }));
      sec.appendChild(heading(5, 'Your full path'));
      sec.appendChild(pathReview(true));
      if (arr(cfg.debrief).length || typeof cfg.debrief === 'string') sec.appendChild(ctx.rich(h('div', { class: 'lab-debrief' }, heading(5, 'Debrief')), cfg.debrief));
      sec.appendChild(ctx.startAgain(again));
      view.appendChild(sec);
    }
    function again() {
      st = fresh(finished ? summary() : st.previous);
      finished = false;
      ctx.saveNow();
      render('.lab-node-title');
      ctx.announce('Scenario restarted.');
    }
    render();
  };

  /* ===================================================================== 5. negotiation */

  /** Pure counterpart model, shared by the engine and the tests. */
  M.negotiation = function (cfg, key) {
    var issues = arr(cfg.issues).filter(function (i) { return i && i.id && arr(i.options).length; });
    var them = obj(key && key.them), R = Math.max(1, Math.round(num(cfg.rounds, 6)));
    var batnaThem = num(key && key.batna, 0), batnaYou = num(obj(cfg.batna).you, 0);
    function you(i, j) { return num(arr(i.you)[j], 0); }
    function th(i, j) { return num(arr(them[i.id])[j], 0); }
    var api = {
      issues: issues, rounds: R, batnaThem: batnaThem, batnaYou: batnaYou,
      you: function (pkg) { return issues.reduce(function (s, i) { return s + you(i, pkg[i.id]); }, 0); },
      them: function (pkg) { return issues.reduce(function (s, i) { return s + th(i, pkg[i.id]); }, 0); },
      themMax: issues.reduce(function (s, i) { return s + maxOf(arr(i.options).map(function (_, j) { return th(i, j); })); }, 0),
      youMax: issues.reduce(function (s, i) { return s + maxOf(arr(i.options).map(function (_, j) { return you(i, j); })); }, 0),
      /** Aspiration in round r (1-based): 90% of max, falling linearly to batna + 5 at round R. */
      aspiration: function (r) {
        var hi = 0.9 * api.themMax, lo = batnaThem + 5;
        if (R <= 1) return lo;
        return hi - (hi - lo) * (clamp(r, 1, R) - 1) / (R - 1);
      },
      accepts: function (pkg, r) { return api.them(pkg) >= api.aspiration(r) - 1e-9; },
      /** One step from `prev` on the issue that costs the counterpart the fewest points per point it gives you. */
      counter: function (prev) {
        var best = null;
        issues.forEach(function (i, ii) {
          var cur = prev[i.id];
          [cur - 1, cur + 1].forEach(function (j) {
            if (j < 0 || j >= arr(i.options).length) return;
            var gain = you(i, j) - you(i, cur);
            if (gain <= 0) return;
            var cost = th(i, cur) - th(i, j), ratio = cost / gain;
            var cand = copy(prev); cand[i.id] = j;
            if (api.them(cand) < batnaThem) return; // never offers less than its walk-away score
            if (!best || ratio < best.ratio - 1e-12 || (Math.abs(ratio - best.ratio) <= 1e-12 && (cost < best.cost - 1e-12 || (Math.abs(cost - best.cost) <= 1e-12 && ii < best.ii)))) best = { id: i.id, j: j, ratio: ratio, cost: cost, gain: gain, ii: ii };
          });
        });
        var next = copy(prev);
        if (best) next[best.id] = best.j;
        return { pkg: next, move: best };
      },
      /** Every package (product of options), with both scores. */
      packages: function (limit) {
        var out = [], cap = limit || 200000, pkg = {};
        (function rec(k) {
          if (out.length >= cap) return;
          if (k === issues.length) { out.push({ pkg: copy(pkg), you: api.you(pkg), them: api.them(pkg) }); return; }
          for (var j = 0; j < arr(issues[k].options).length; j++) { pkg[issues[k].id] = j; rec(k + 1); }
        })(0);
        return out;
      },
      jointBest: function (i) {
        var best = 0;
        for (var j = 1; j < arr(i.options).length; j++) if (you(i, j) + th(i, j) > you(i, best) + th(i, best)) best = j;
        return best;
      },
      pointsYou: you, pointsThem: th,
    };
    return api;
  };

  ENGINES.negotiation = function (ctx) {
    var cfg = ctx.cfg;
    var issues = arr(cfg.issues).filter(function (i) { return i && i.id && arr(i.options).length; });
    var R = Math.max(1, Math.round(num(cfg.rounds, 6)));
    var cp = obj(cfg.counterpart), cpName = str(cp.name) || 'The counterpart';
    var hints = obj(cfg.hints), batnaYou = num(obj(cfg.batna).you, 0);
    function validPkg(p) {
      var out = {};
      issues.forEach(function (i) { var v = obj(p)[i.id]; out[i.id] = Number.isInteger(v) && v >= 0 && v < arr(i.options).length ? v : 0; });
      return out;
    }
    var opening = validPkg(cfg.opening);
    function youPts(i, j) { return num(arr(i.you)[j], 0); }
    function youScore(pkg) { return issues.reduce(function (s, i) { return s + youPts(i, pkg[i.id]); }, 0); }
    function pkgText(pkg) { return issues.map(function (i) { return str(i.label) + ': ' + str(arr(i.options)[pkg[i.id]]); }).join(' · '); }

    function fresh(prev) { return { v: 1, round: 0, offer: copy(opening), draft: copy(opening), log: [], asked: [], outcome: null, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      st.round = clamp(Math.round(num(s0.round, 0)), 0, R);
      st.offer = validPkg(s0.offer || opening);
      st.draft = validPkg(s0.draft || opening);
      st.log = arr(s0.log).filter(function (e) { return e && (e.type === 'propose' || e.type === 'ask'); }).map(function (e) {
        return { round: num(e.round, 0), type: e.type, pkg: e.pkg ? validPkg(e.pkg) : null, issue: str(e.issue) || null, response: str(e.response), counter: e.counter ? validPkg(e.counter) : null };
      });
      st.asked = arr(s0.asked).filter(function (id) { return issues.some(function (i) { return i.id === id; }); });
      var o = s0.outcome;
      if (o && (o.type === 'deal' || o.type === 'walk' || o.type === 'impasse')) st.outcome = { type: o.type, pkg: o.pkg ? validPkg(o.pkg) : null, by: str(o.by), round: num(o.round, st.round) };
      finished = !!ctx.saved.finished && !!st.outcome;
    }
    var model = null, key = null, maxJointCache = null;

    function scoresNow() {
      var y = st.outcome && st.outcome.type === 'deal' ? youScore(st.outcome.pkg) : batnaYou;
      var t = model ? (st.outcome && st.outcome.type === 'deal' ? model.them(st.outcome.pkg) : model.batnaThem) : null;
      return { you: y, them: t };
    }
    function summary() {
      var s = scoresNow(), met = { 'Your score': s.you, 'Your BATNA': batnaYou, Deal: st.outcome && st.outcome.type === 'deal' ? 'yes' : 'no', 'Rounds used': st.round };
      if (model) {
        if (maxJointCache === null) maxJointCache = maxOf(model.packages().map(function (p) { return p.you + p.them; }));
        met['Their score'] = s.them; met['Joint value'] = s.you + s.them; met['Maximum joint value'] = maxJointCache;
      }
      var lab = st.outcome && st.outcome.type === 'deal' ? 'Deal in round ' + st.outcome.round + ': ' + s.you + ' points (BATNA ' + batnaYou + ')' : 'No agreement: BATNA ' + batnaYou + ' points';
      return { label: lab, metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: finished ? summary() : { label: 'In progress — round ' + Math.min(R, st.round + 1) + ' of ' + R, metrics: { 'Rounds used': st.round } } }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'There are ' + R + ' rounds. Each round you either propose a full package (one option per issue) or ask one question about one issue, which reveals what a good question would uncover and uses the round.',
      'Your score = sum of your points for the chosen option on each issue (your table). The counterpart scores packages with its own private table, hidden until the end.',
      'The counterpart accepts your package when its score ≥ its aspiration. Aspiration in round r: `A(r) = A₁ − (A₁ − (B + 5)) × (r − 1) / (R − 1)`, where A₁ = 90% of the counterpart’s maximum possible score and B its walk-away (BATNA) score.',
      'Otherwise it counter-proposes: starting from its previous offer (first: its opening offer), it moves one step on the issue that costs it the fewest of its points per point it gives you (logrolling). Ties go to the smaller cost, then to the issue listed first. It never offers a package worth less than its walk-away score; if no step qualifies it repeats its offer.',
      'You may accept the counterpart’s current offer at any time. After the final round, its last offer stands until you accept it or walk away; with no agreement, both sides take their BATNA.',
      'Debrief: joint value = your score + the counterpart’s score. Every possible package is enumerated; the Pareto-efficient frontier is the set of packages that no other package beats for one side without hurting the other.',
      'The counterpart is a simple rule-based teaching device. It does not model any real person’s psychology.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function load() {
      clear(view);
      view.appendChild(ctx.waitPanel('Preparing the counterpart…'));
      ctx.reveal().then(function (full) {
        if (ctx.destroyed) return;
        key = obj(obj(full).key);
        if (!key.them) throw new Error('missing key');
        model = M.negotiation(cfg, key);
        render();
      }).catch(function () {
        if (ctx.destroyed) return;
        clear(view);
        view.appendChild(ctx.errorPanel('The counterpart could not be prepared.', load));
      });
    }

    function render(focusSel) {
      ctx.keepFocus(function () {
        clear(view);
        if (finished) renderEnd(); else renderTable();
      });
      if (focusSel) focusEl(view.querySelector(focusSel));
    }

    function yourTable() {
      return table({
        caption: 'Your points by issue and option (confidential)', headers: ['Issue', 'Options and your points'], rowHeader: true,
        rows: issues.map(function (i) { return [str(i.label), arr(i.options).map(function (o, j) { return str(o) + ' (' + youPts(i, j) + ')'; }).join(' · ')]; }),
      });
    }
    function renderTable() {
      var brief = h('section', { class: 'lab-section' }, heading(4, 'Your confidential brief'));
      ctx.rich(brief, cfg.role);
      brief.appendChild(yourTable());
      brief.appendChild(h('p', { class: 'lab-batna' }, h('span', { class: 'lab-label lab-label--inline', text: 'Your BATNA' }), ' ' + batnaYou + ' points. ', cfg.batna && cfg.batna.text ? h('span', { html: ctx.inline(cfg.batna.text) }) : null));
      var d = h('details', { class: 'lab-brief-toggle', open: st.round === 0 && !st.log.length }, h('summary', { text: 'Your brief and your points' }), brief);
      view.appendChild(d);

      view.appendChild(h('section', { class: 'lab-counterpart' }, label('Across the table'),
        h('p', { class: 'lab-cp-name' }, h('strong', { text: cpName }), cp.title ? h('span', { text: ', ' + str(cp.title) }) : null),
        cp.style ? h('p', { class: 'lab-cp-style', html: ctx.inline(cp.style) }) : null));

      var over = st.round >= R;
      view.appendChild(h('p', { class: 'lab-roundline', text: over ? 'All ' + R + ' rounds used — ' + cpName + '’s last offer stands until you accept it or walk away.' : 'Round ' + (st.round + 1) + ' of ' + R }));

      // their offer
      var ys = youScore(st.offer);
      var offer = h('section', { class: 'lab-offer' }, heading(4, st.log.length ? cpName + '’s current offer' : cpName + '’s opening offer'),
        h('ul', { class: 'lab-list' }, issues.map(function (i) { return h('li', null, h('span', { class: 'lab-offer-issue', text: str(i.label) + ': ' }), h('span', { text: str(arr(i.options)[st.offer[i.id]]) + ' (' + youPts(i, st.offer[i.id]) + ')' })); })),
        h('p', { class: 'lab-offer-score', text: 'Worth ' + ys + ' points to you — ' + (ys > batnaYou ? ys - batnaYou + ' above' : ys < batnaYou ? batnaYou - ys + ' below' : 'equal to') + ' your BATNA of ' + batnaYou + '.' }),
        h('div', { class: 'lab-actions' }, button('Accept this offer', function () { end({ type: 'deal', pkg: copy(st.offer), by: 'them', round: Math.max(1, Math.min(R, st.round)) }); }, null, { 'data-fk': 'accept' }),
          button(over ? 'Walk away (take your BATNA)' : 'Walk away now', function () { end({ type: over ? 'impasse' : 'walk', pkg: null, by: 'you', round: st.round }); }, 'quiet', { 'data-fk': 'walk' })));
      view.appendChild(offer);

      if (!over) {
        // propose
        var fs = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: 'Propose a package' }));
        var scoreEl = h('p', { class: 'lab-offer-score' });
        function upd() { var s = youScore(st.draft); scoreEl.textContent = 'This package is worth ' + s + ' points to you (BATNA ' + batnaYou + ').'; }
        issues.forEach(function (i) {
          var id = uid('iss');
          var sel = h('select', { id: id, class: 'lab-select', 'data-fk': 'draft-' + i.id });
          arr(i.options).forEach(function (o, j) { sel.appendChild(h('option', { value: String(j), text: str(o) + ' — ' + youPts(i, j) + ' pts', selected: st.draft[i.id] === j })); });
          sel.addEventListener('change', function () { st.draft[i.id] = Number(sel.value); upd(); ctx.touch(); });
          fs.appendChild(h('div', { class: 'lab-field' }, h('label', { for: id, text: str(i.label) }), sel));
        });
        upd();
        fs.appendChild(scoreEl);
        fs.appendChild(h('div', { class: 'lab-actions' }, button('Propose this package', propose, 'primary', { 'data-fk': 'propose' })));
        var move = h('div', { class: 'lab-moves' }, fs);
        var askable = issues.filter(function (i) { return hints[i.id] && st.asked.indexOf(i.id) < 0; });
        if (issues.some(function (i) { return hints[i.id]; })) {
          var fa = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: 'Or ask a question (uses this round)' }));
          if (askable.length) {
            var aid = uid('ask');
            var asel = h('select', { id: aid, class: 'lab-select', 'data-fk': 'ask-sel' }, askable.map(function (i) { return h('option', { value: i.id, text: str(i.label) }); }));
            fa.appendChild(h('div', { class: 'lab-field' }, h('label', { for: aid, text: 'Ask about' }), asel));
            fa.appendChild(h('div', { class: 'lab-actions' }, button('Ask', function () { ask(asel.value); }, null, { 'data-fk': 'ask' })));
          } else fa.appendChild(h('p', { class: 'lab-hint', text: 'You have asked about every issue with more to learn.' }));
          move.appendChild(fa);
        }
        view.appendChild(move);
      }
      view.appendChild(transcript());
    }
    function transcript() {
      var sec = h('section', { class: 'lab-transcript' }, heading(4, 'Transcript'));
      var asked = st.asked.filter(function (id) { return hints[id]; });
      if (!st.log.length) { sec.appendChild(h('p', { class: 'lab-hint', text: 'No rounds yet. ' + cpName + ' opened with: ' + pkgText(opening) + ' (' + youScore(opening) + ' points to you).' })); return sec; }
      var ol = h('ol', { class: 'lab-log' });
      st.log.forEach(function (e) {
        var li = h('li', { class: 'lab-logitem' }, h('p', { class: 'lab-label', text: 'Round ' + e.round }));
        if (e.type === 'ask') {
          var iss = issues.filter(function (i) { return i.id === e.issue; })[0];
          li.appendChild(h('p', { text: 'You asked about ' + (iss ? str(iss.label) : e.issue) + '.' }));
          li.appendChild(h('p', { class: 'lab-hintreveal' }, h('span', { class: 'lab-label lab-label--inline', text: 'What you learn' }), ' ', h('span', { html: ctx.inline(hints[e.issue]) })));
        } else {
          li.appendChild(h('p', { text: 'You proposed ' + pkgText(e.pkg) + ' (' + youScore(e.pkg) + ' points to you).' }));
          if (e.response === 'accept') li.appendChild(h('p', { class: 'lab-log-resp', text: cpName + ' accepted.' }));
          else li.appendChild(h('p', { class: 'lab-log-resp', text: cpName + ' declined and countered: ' + pkgText(e.counter) + ' (' + youScore(e.counter) + ' points to you).' }));
        }
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      if (asked.length && !finished) sec.appendChild(h('p', { class: 'lab-hint', text: 'Answers you have gathered stay in the transcript above.' }));
      return sec;
    }
    function propose() {
      var r = st.round + 1, pkg = copy(st.draft);
      if (model.accepts(pkg, r)) {
        st.round = r;
        st.log.push({ round: r, type: 'propose', pkg: pkg, response: 'accept', counter: null });
        end({ type: 'deal', pkg: pkg, by: 'you', round: r });
        return;
      }
      var c = model.counter(st.offer);
      st.offer = c.pkg;
      st.round = r;
      st.log.push({ round: r, type: 'propose', pkg: pkg, response: 'counter', counter: copy(c.pkg) });
      ctx.touch();
      render('.lab-offer .lab-h');
      ctx.announce('Round ' + r + ': ' + cpName + ' declined and countered, worth ' + youScore(c.pkg) + ' points to you.' + (st.round >= R ? ' That was the final round.' : ''));
    }
    function ask(id) {
      if (!hints[id]) return;
      var r = st.round + 1;
      st.round = r;
      st.asked.push(id);
      st.log.push({ round: r, type: 'ask', pkg: null, issue: id, response: 'answer', counter: null });
      ctx.touch();
      render('.lab-transcript .lab-logitem:last-child');
      ctx.announce('Round ' + r + ': you asked a question. The answer is at the end of the transcript.');
    }
    function end(outcome) {
      st.outcome = outcome;
      finished = true;
      ctx.saveNow();
      render('.lab-h--results');
      ctx.announce('Negotiation over. ' + summary().label + '.');
    }

    function renderEnd() {
      var o = st.outcome, deal = o.type === 'deal', s = scoresNow();
      var pk = model.packages(), maxJ = maxOf(pk.map(function (p) { return p.you + p.them; }));
      var front = M.paretoFrontier(pk.map(function (p) { return { x: p.you, y: p.them }; })).map(function (i) { return pk[i]; });
      var sec = h('section', { class: 'lab-section lab-results' });
      sec.appendChild(resultsHeading(deal ? 'Deal reached in round ' + o.round : 'No agreement'));
      sec.appendChild(h('p', { class: 'lab-outcome', text: deal ? (o.by === 'you' ? cpName + ' accepted your package: ' : 'You accepted ' + cpName + '’s offer: ') + pkgText(o.pkg) + '.' : (o.type === 'walk' ? 'You walked away in round ' + Math.max(1, o.round) + '.' : 'The rounds ran out without agreement.') + ' Both sides take their BATNA.' }));
      var joint = s.you + s.them;
      var onFront = deal && front.some(function (f) { return f.you === s.you && f.them === s.them; });
      sec.appendChild(metrics([
        { k: 'Your score', v: s.you + ' points', note: (s.you > batnaYou ? 'Beat your BATNA by ' + (s.you - batnaYou) : s.you < batnaYou ? 'Below your BATNA by ' + (batnaYou - s.you) : 'Equal to your BATNA') + ' (' + batnaYou + ')' },
        { k: cpName + '’s score', v: s.them + ' points', note: 'Their BATNA: ' + model.batnaThem + (deal ? (s.them >= model.batnaThem ? ' — the deal beat it' : ' — below it') : '') },
        { k: 'Joint value', v: joint + ' of ' + maxJ + ' possible', note: pct(maxJ ? joint / maxJ : 0) + ' of the maximum' },
        { k: 'Pareto-efficient?', v: deal ? (onFront ? 'Yes' : 'No') : 'No deal', note: deal ? (onFront ? 'No package was better for one side without being worse for the other.' : 'Another package was better for both sides, or better for one and no worse for the other.') : 'Both sides took their BATNA.' },
      ]));
      if (deal && !onFront) {
        var dom = pk.filter(function (p) { return p.you >= s.you && p.them >= s.them && (p.you > s.you || p.them > s.them); })
          .sort(function (a, b) { return (b.you + b.them) - (a.you + a.them) || b.you - a.you; })[0];
        if (dom) sec.appendChild(h('p', { class: 'lab-note', text: 'For example, ' + pkgText(dom.pkg) + ' gives you ' + dom.you + ' and ' + cpName + ' ' + dom.them + ' — at least as good for both.' }));
      }
      sec.appendChild(scatter(pk, front, deal ? { you: s.you, them: s.them } : null));

      // issues: trades
      sec.appendChild(heading(5, 'Issue by issue: where value was created or left'));
      var rows = issues.map(function (i) {
        var yr = maxOf(arr(i.you)) - minOf(arr(i.you)), tPts = arr(obj(key.them)[i.id]), tr = maxOf(tPts) - minOf(tPts);
        var yBest = arr(i.you).indexOf(maxOf(arr(i.you))), tBest = tPts.indexOf(maxOf(tPts)), jb = model.jointBest(i);
        var kind = yBest === tBest ? 'Compatible — both prefer “' + str(arr(i.options)[yBest]) + '”' : yr > tr ? 'Matters more to you (' + yr + ' vs ' + tr + ' points at stake)' : tr > yr ? 'Matters more to ' + cpName + ' (' + tr + ' vs ' + yr + ')' : 'Equal stakes (' + yr + ' each) — purely distributive';
        var cell = '—', lost = '—';
        if (deal) {
          var j = o.pkg[i.id], jl = (model.pointsYou(i, jb) + model.pointsThem(i, jb)) - (model.pointsYou(i, j) + model.pointsThem(i, j));
          cell = str(arr(i.options)[j]) + ' (you ' + model.pointsYou(i, j) + '/' + maxOf(arr(i.you)) + ', them ' + model.pointsThem(i, j) + '/' + maxOf(tPts) + ')';
          lost = jl > 0 ? jl + ' joint points (best: “' + str(arr(i.options)[jb]) + '”)' : 'None';
        }
        return [str(i.label), kind, cell, lost];
      });
      sec.appendChild(table({ caption: 'Issues, priorities and the deal', headers: ['Issue', 'Who cares more', 'Deal (your / their points)', 'Joint value left'], rowHeader: true, rows: rows }));
      if (deal) {
        var gave = [], got = [];
        issues.forEach(function (i) {
          var j = o.pkg[i.id], tPts = arr(obj(key.them)[i.id]);
          if (model.pointsYou(i, j) < maxOf(arr(i.you))) gave.push(str(i.label));
          if (model.pointsThem(i, j) < maxOf(tPts)) got.push(str(i.label));
        });
        sec.appendChild(h('p', { class: 'lab-note', text: 'You gave ground on ' + (gave.length ? gave.join(', ') : 'nothing') + '; ' + cpName + ' gave ground on ' + (got.length ? got.join(', ') : 'nothing') + '. Trades create value when each side concedes on the issues it cares about less; a joint-value gap above shows where a different trade would have helped both.' }));
      }

      // aspiration schedule
      var asp = [];
      for (var r = 1; r <= R; r++) {
        var e = st.log.filter(function (x) { return x.round === r; })[0];
        asp.push(['Round ' + r, { text: fixed(model.aspiration(r), 1), num: true },
          e && e.type === 'propose' ? { text: String(model.them(e.pkg)), num: true } : { text: e ? 'question' : '—', num: true },
          e ? (e.type === 'ask' ? 'Answered' : e.response === 'accept' ? 'Accepted' : 'Countered') : '—']);
      }
      sec.appendChild(h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'The counterpart’s aspiration, round by round' }),
        table({ caption: 'Aspiration (its score needed to accept) vs. your proposals’ value to it', headers: ['Round', { text: 'Aspiration', num: true }, { text: 'Your proposal, to them', num: true }, 'Response'], rowHeader: true, rows: asp }),
        h('p', { class: 'lab-hint', text: 'Its maximum possible score was ' + model.themMax + '; 90% of that is ' + fixed(0.9 * model.themMax, 1) + '; its walk-away score was ' + model.batnaThem + '.' })));

      // their table + notes
      sec.appendChild(heading(5, cpName + '’s private points (now revealed)'));
      sec.appendChild(table({ caption: 'Both sides’ points per option', headers: ['Issue', 'Option', { text: 'You', num: true }, { text: 'Them', num: true }, { text: 'Joint', num: true }], rowHeader: true,
        rows: [].concat.apply([], issues.map(function (i) { return arr(i.options).map(function (op, j) { return [j === 0 ? str(i.label) : '', str(op), { text: String(model.pointsYou(i, j)), num: true }, { text: String(model.pointsThem(i, j)), num: true }, { text: String(model.pointsYou(i, j) + model.pointsThem(i, j)), num: true }]; }); })) }));
      if (key.notes) sec.appendChild(h('div', { class: 'lab-reveal' }, heading(5, 'What ' + cpName + ' really wanted'), h('p', { html: ctx.inline(key.notes) })));
      sec.appendChild(transcript());
      if (cfg.debrief) sec.appendChild(ctx.rich(h('div', { class: 'lab-debrief' }, heading(5, 'Debrief')), cfg.debrief));
      sec.appendChild(ctx.startAgain(function () {
        st = fresh(summary()); finished = false; ctx.saveNow(); render('.lab-roundline');
        ctx.announce('New negotiation started. Your previous result is kept until this one ends.');
      }));
      view.appendChild(sec);
    }

    function scatter(pk, front, dealPt) {
      var W = 420, H = 320, m = { l: 48, r: 16, t: 16, b: 44 };
      var xs = pk.map(function (p) { return p.you; }).concat([batnaYou]), ys = pk.map(function (p) { return p.them; }).concat([model.batnaThem]);
      var x0 = Math.min(0, minOf(xs)), x1 = maxOf(xs) || 1, y0 = Math.min(0, minOf(ys)), y1 = maxOf(ys) || 1;
      function x(v) { return m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r); }
      function y(v) { return H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b); }
      var tid = uid('t'), did = uid('d');
      var fsorted = front.slice().sort(function (a, b) { return a.you - b.you; });
      var desc = grouped(pk.length) + ' possible packages. The efficient frontier runs through ' + fsorted.map(function (f) { return '(' + f.you + ', ' + f.them + ')'; }).join(', ') + '. ' +
        (dealPt ? 'Your deal sits at you ' + dealPt.you + ', them ' + dealPt.them + '.' : 'No deal: both sides at their BATNA (' + batnaYou + ', ' + model.batnaThem + ').');
      var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-chart lab-chart--scatter', role: 'img', 'aria-labelledby': tid + ' ' + did },
        sv('title', { id: tid, text: 'Every possible package: your points against the counterpart’s points' }), sv('desc', { id: did, text: desc }));
      [0, 0.5, 1].forEach(function (f) {
        var vx = x0 + (x1 - x0) * f, vy = y0 + (y1 - y0) * f;
        svg.appendChild(sv('text', { x: x(vx), y: H - m.b + 16, class: 'lab-tick', 'text-anchor': 'middle', text: fixed(vx, 0) }));
        svg.appendChild(sv('text', { x: m.l - 6, y: y(vy) + 4, class: 'lab-tick', 'text-anchor': 'end', text: fixed(vy, 0) }));
      });
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'lab-axis' }));
      svg.appendChild(sv('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'lab-axis' }));
      svg.appendChild(sv('line', { x1: x(batnaYou), x2: x(batnaYou), y1: m.t, y2: H - m.b, class: 'lab-ref lab-ref--dashed' }));
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(model.batnaThem), y2: y(model.batnaThem), class: 'lab-ref lab-ref--dashed' }));
      svg.appendChild(sv('text', { x: x(batnaYou) + 4, y: m.t + 10, class: 'lab-reflabel', text: 'your BATNA' }));
      svg.appendChild(sv('text', { x: W - m.r, y: y(model.batnaThem) - 4, class: 'lab-reflabel', 'text-anchor': 'end', text: 'their BATNA' }));
      var seen = {};
      pk.forEach(function (p) { var k = p.you + ',' + p.them; if (seen[k]) return; seen[k] = 1; svg.appendChild(sv('circle', { cx: x(p.you), cy: y(p.them), r: 2.2, class: 'lab-dot' })); });
      svg.appendChild(sv('polyline', { points: fsorted.map(function (f) { return x(f.you) + ',' + y(f.them); }).join(' '), class: 'lab-series' }));
      fsorted.forEach(function (f) { svg.appendChild(sv('circle', { cx: x(f.you), cy: y(f.them), r: 3.5, class: 'lab-point lab-point--hollow' })); });
      if (dealPt) {
        var cx = x(dealPt.you), cy = y(dealPt.them);
        svg.appendChild(sv('path', { d: 'M' + cx + ' ' + (cy - 8) + ' L' + (cx + 8) + ' ' + cy + ' L' + cx + ' ' + (cy + 8) + ' L' + (cx - 8) + ' ' + cy + ' Z', class: 'lab-marker' }));
        svg.appendChild(sv('text', { x: cx + 11, y: cy - 6, class: 'lab-pointlabel', text: 'your deal' }));
      }
      svg.appendChild(sv('text', { x: (m.l + W - m.r) / 2, y: H - 6, class: 'lab-axislabel', 'text-anchor': 'middle', text: 'Your points' }));
      svg.appendChild(sv('text', { x: 12, y: (m.t + H - m.b) / 2, class: 'lab-axislabel', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + H - m.b) / 2 + ')', text: 'Their points' }));
      var det = h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Show the efficient frontier as a table' }),
        table({ caption: 'Pareto-efficient packages', headers: ['Package', { text: 'You', num: true }, { text: 'Them', num: true }, { text: 'Joint', num: true }],
          rows: fsorted.map(function (f) { return [pkgText(f.pkg), { text: String(f.you), num: true }, { text: String(f.them), num: true }, { text: String(f.you + f.them), num: true }]; }) }));
      return h('figure', { class: 'lab-figure' }, svg,
        h('figcaption', { class: 'lab-figcaption', text: 'Small dots: every possible package. Hollow circles joined by a line: the efficient frontier. Diamond: your deal. Dashed lines: each side’s BATNA. ' + desc }), det);
    }

    load();
  };

  /* ===================================================================== 6. allocation */

  /** Capital-mode analysis of one project at rate r (pure; used by the engine and the tests). */
  M.projectAnalysis = function (p, r) {
    var cf = arr(p.cashflows).map(function (x) { return num(x, 0); });
    var sc = obj(p.scenarios), irr = M.irr(cf);
    var signChanges = 0;
    for (var i = 1; i < cf.length; i++) if (cf[i] !== 0 && cf[i - 1] !== 0 && (cf[i] < 0) !== (cf[i - 1] < 0)) signChanges++;
    return {
      cost: cf[0] < 0 ? -cf[0] : 0,
      npv: M.npv(cf, r),
      irr: irr,
      multipleSignChanges: signChanges > 1,
      payback: M.payback(cf),
      discPayback: M.payback(cf, r),
      pi: M.profitabilityIndex(cf, r),
      low: isNum(sc.low) ? M.npv(M.scenarioFlows(cf, sc.low), r) : null,
      base: isNum(sc.base) ? M.npv(M.scenarioFlows(cf, sc.base), r) : null,
      high: isNum(sc.high) ? M.npv(M.scenarioFlows(cf, sc.high), r) : null,
    };
  };
  /** Best subset by total NPV with total outlay ≤ budget (exhaustive up to 16 projects). */
  M.bestPortfolio = function (items, budget) {
    var n = items.length, best = { set: [], npv: 0, cost: 0 }, exhaustive = n <= 16;
    if (exhaustive) {
      for (var mask = 1; mask < (1 << n); mask++) {
        var c = 0, v = 0;
        for (var i = 0; i < n; i++) if (mask & (1 << i)) { c += items[i].cost; v += items[i].npv; }
        if (c <= budget + 1e-6 && (v > best.npv + 1e-6 || (Math.abs(v - best.npv) <= 1e-6 && c < best.cost))) {
          var set = []; for (var j = 0; j < n; j++) if (mask & (1 << j)) set.push(items[j].id);
          best = { set: set, npv: v, cost: c };
        }
      }
    } else {
      var order = items.filter(function (x) { return x.npv > 0; }).sort(function (a, b) { return b.npv / (b.cost || 1) - a.npv / (a.cost || 1); });
      var cost = 0, val = 0, chosen = [];
      order.forEach(function (x) { if (cost + x.cost <= budget) { cost += x.cost; val += x.npv; chosen.push(x.id); } });
      best = { set: chosen, npv: val, cost: cost };
    }
    best.exhaustive = exhaustive;
    return best;
  };

  ENGINES.allocation = function (ctx) {
    if (ctx.cfg.mode === 'strategy') return strategyMode(ctx);
    return capitalMode(ctx);
  };

  function capitalMode(ctx) {
    var cfg = ctx.cfg, cur = str(cfg.currency) || 'USD', budget = num(cfg.budget, 0);
    var rc = obj(cfg.rate), rMin = num(rc.min, 0.02), rMax = num(rc.max, 0.16), rStep = num(rc.step, 0.005), rDef = clamp(num(rc.default, 0.08), rMin, rMax);
    var projects = arr(cfg.projects).filter(function (p) { return p && p.id && arr(p.cashflows).length; });
    function fresh(prev) { return { v: 1, rate: rDef, selected: [], previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      if (isNum(s0.rate)) st.rate = clamp(s0.rate, rMin, rMax);
      st.selected = arr(s0.selected).filter(function (id) { return projects.some(function (p) { return p.id === id; }); });
      finished = !!ctx.saved.finished;
    }
    var fullCfg = null;
    function analysis() {
      var rows = projects.map(function (p) { var a = M.projectAnalysis(p, st.rate); a.id = p.id; a.p = p; return a; });
      var sel = rows.filter(function (a) { return st.selected.indexOf(a.id) >= 0; });
      var cost = sum(sel.map(function (a) { return a.cost; })), npv = sum(sel.map(function (a) { return a.npv; }));
      var best = M.bestPortfolio(rows.map(function (a) { return { id: a.id, cost: a.cost, npv: a.npv }; }), budget);
      return { rows: rows, cost: cost, npv: npv, within: cost <= budget + 1e-6, best: best, opp: best.npv - npv };
    }
    function money0(x) { return money(x, cur); }
    function yrs(x) { return x === null ? 'Not within horizon' : fixed(x, 1) + ' yrs'; }
    function irrText(a) { if (!a.irr) return 'n/a'; return a.irr.multiple ? a.irr.roots.map(function (r) { return pct(r, 1); }).join(' / ') + ' (multiple)' : pct(a.irr.value, 1); }
    function summary() {
      var A = analysis();
      return { label: (finished ? 'Portfolio submitted' : 'In progress') + ' — ' + plural(st.selected.length, 'project') + ', NPV ' + money0(A.npv) + (A.within ? '' : ' (over budget)'),
        metrics: { 'Discount rate': pct(st.rate, 1), 'Projects selected': st.selected.length, 'Total outlay': Math.round(A.cost), 'Portfolio NPV': Math.round(A.npv), 'Best NPV within budget': Math.round(A.best.npv), 'Opportunity cost': A.within ? Math.round(A.opp) : 'n/a (over budget)', 'Within budget': A.within ? 'yes' : 'no' } };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Cash flows arrive at the end of each year; year 0 is today. `NPV(r) = Σ CFₜ / (1 + r)ᵗ` for t = 0…N.',
      'IRR: the rate at which NPV = 0, found by bisection after scanning r from −99% to 1,000% for a change of sign. “n/a” when NPV never changes sign. If cash flows change sign more than once, several IRRs can exist; all found are shown.',
      'Payback: the first year in which cumulative cash flow turns non-negative, interpolated within the year as if that year’s cash flow arrived evenly. Discounted payback does the same with discounted cash flows. “Not within horizon” if it never happens.',
      'Profitability index (PI) = PV of the year 1…N cash flows ÷ the year-0 outlay. PI > 1 exactly when NPV > 0.',
      'Scenarios: low / base / high multiply inflows (positive cash flows) only; outflows are unchanged. All other columns use the cash flows as given.',
      'Portfolio: total outlay = sum of the selected projects’ year-0 outlays, compared with the capital budget. Unspent budget is assumed to earn exactly the cost of capital (NPV 0). Projects are assumed independent and indivisible.',
      'Best portfolio: every combination of projects is enumerated (up to 16 projects; beyond that, a greedy NPV-per-dollar heuristic, labelled as such); the one with the highest total NPV whose outlay fits the budget wins. Opportunity cost = best NPV − your portfolio’s NPV (when yours fits the budget).',
      'Ranking disagreements: pairs of projects that NPV ranks one way and IRR or PI ranks the other.',
      'These are synthetic numbers in a teaching model, not a forecast.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);
    var cells = {}, out = {};

    function render() { clear(view); cells = {}; out = {}; build(); }
    function build() {
      if (cfg.brief) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.brief));
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'A dollar today is worth more than a dollar next year because it could be invested at the cost of capital. NPV adds up every cash flow after converting it into today’s dollars; a positive NPV means the project earns more than the cost of capital.'));
      // rate
      var rid = uid('rate');
      var rateOut = h('output', { for: rid, class: 'lab-output', text: pct(st.rate, 1) });
      var rate = h('input', { type: 'range', id: rid, min: rMin, max: rMax, step: rStep, value: st.rate, class: 'lab-range', disabled: finished });
      rate.addEventListener('input', function () { st.rate = clamp(Number(rate.value), rMin, rMax); rateOut.textContent = pct(st.rate, 1); update(); ctx.touch(); });
      view.appendChild(h('div', { class: 'lab-field lab-field--range' }, h('label', { for: rid, text: str(rc.label) || 'Discount rate' }), h('div', { class: 'lab-rangerow' }, rate, rateOut),
        h('span', { class: 'lab-hint', text: pct(rMin, 1) + ' to ' + pct(rMax, 1) + ' in steps of ' + pct(rStep, 1) })));
      // table
      var anyBase = projects.some(function (p) { var b = obj(p.scenarios).base; return isNum(b) && b !== 1; });
      var heads = ['Select', 'Project', { text: 'Outlay (yr 0)', num: true }, { text: 'NPV', num: true }, { text: 'IRR', num: true }, { text: 'Payback', num: true }, { text: 'Disc. payback', num: true }, { text: 'PI', num: true }, { text: 'NPV low', num: true }];
      if (anyBase) heads.push({ text: 'NPV base', num: true });
      heads.push({ text: 'NPV high', num: true });
      var rows = projects.map(function (p) {
        var cid = uid('sel');
        var cb = h('input', { type: 'checkbox', id: cid, checked: st.selected.indexOf(p.id) >= 0, disabled: finished, 'data-fk': 'sel-' + p.id });
        cb.addEventListener('change', function () {
          var i = st.selected.indexOf(p.id);
          if (cb.checked && i < 0) st.selected.push(p.id); else if (!cb.checked && i >= 0) st.selected.splice(i, 1);
          update(true); ctx.touch();
        });
        var c = { npv: h('span'), irr: h('span'), pb: h('span'), dpb: h('span'), pi: h('span'), low: h('span'), base: h('span'), high: h('span'), cost: h('span') };
        cells[p.id] = c;
        var r = [{ node: cb }, { node: h('label', { for: cid, text: str(p.label) || p.id }) }, { node: c.cost, num: true }, { node: c.npv, num: true }, { node: c.irr, num: true }, { node: c.pb, num: true }, { node: c.dpb, num: true }, { node: c.pi, num: true }, { node: c.low, num: true }];
        if (anyBase) r.push({ node: c.base, num: true });
        r.push({ node: c.high, num: true });
        return r;
      });
      view.appendChild(heading(4, 'Projects'));
      view.appendChild(table({ caption: 'Projects at the chosen discount rate', headers: heads, rows: rows, cls: 'lab-table--dense', scroll: true }));
      // details
      var det = h('div', { class: 'lab-projects' });
      projects.forEach(function (p) {
        var cf = arr(p.cashflows), sc = obj(p.scenarios);
        var d = h('details', { class: 'lab-project' }, h('summary', { text: (str(p.label) || p.id) + ' — details and cash flows' }));
        if (p.description) d.appendChild(h('p', { html: ctx.inline(p.description) }));
        d.appendChild(table({ caption: 'Cash flows (' + cur + ')', headers: cf.map(function (_, t) { return { text: 'Year ' + t, num: true }; }), rows: [cf.map(function (x) { return { text: money0(x), num: true }; })], scroll: true }));
        d.appendChild(h('p', { class: 'lab-hint', text: 'Scenario multipliers on inflows: low ×' + num(sc.low, 1) + ', base ×' + num(sc.base, 1) + ', high ×' + num(sc.high, 1) + '.' }));
        if (p.notes) d.appendChild(h('p', null, h('span', { class: 'lab-label lab-label--inline', text: 'Assumptions' }), ' ', h('span', { html: ctx.inline(p.notes) })));
        if (p.nonfinancial) d.appendChild(h('p', null, h('span', { class: 'lab-label lab-label--inline', text: 'Not in the cash flows' }), ' ', h('span', { html: ctx.inline(p.nonfinancial) })));
        det.appendChild(d);
      });
      view.appendChild(det);
      out.portfolio = h('section', { class: 'lab-section lab-portfolio', 'aria-label': 'Your portfolio' });
      out.ranks = h('section', { class: 'lab-section' });
      view.appendChild(out.portfolio);
      view.appendChild(out.ranks);
      if (arr(cfg.questions).length) view.appendChild(h('section', { class: 'lab-section' }, heading(4, 'Questions to weigh'), h('ol', { class: 'lab-list' }, arr(cfg.questions).map(function (q) { return h('li', { html: ctx.inline(q) }); }))));
      out.end = h('section', { class: 'lab-section lab-results' });
      view.appendChild(out.end);
      update(false);
      renderEnd();
    }
    function update(announce) {
      var A = analysis();
      A.rows.forEach(function (a) {
        var c = cells[a.id];
        c.cost.textContent = money0(a.cost); c.npv.textContent = money0(a.npv); c.irr.textContent = irrText(a);
        c.pb.textContent = a.payback === null ? 'n/a' : fixed(a.payback, 1); c.dpb.textContent = a.discPayback === null ? 'n/a' : fixed(a.discPayback, 1);
        c.pi.textContent = a.pi === null ? 'n/a' : fixed(a.pi, 2); c.low.textContent = money0(a.low); c.base.textContent = money0(a.base); c.high.textContent = money0(a.high);
      });
      var P = out.portfolio;
      clear(P);
      P.appendChild(heading(4, 'Your portfolio'));
      var names = function (ids) { return ids.map(function (id) { var p = projects.filter(function (x) { return x.id === id; })[0]; return p ? str(p.label) || id : id; }); };
      P.appendChild(metrics([
        { k: 'Selected', v: st.selected.length ? names(st.selected).join(', ') : 'None yet' },
        { k: 'Total outlay vs. budget', v: money0(A.cost) + ' of ' + money0(budget), note: A.within ? 'Within budget — ' + money0(budget - A.cost) + ' unspent' : 'Over budget by ' + money0(A.cost - budget), cls: A.within ? '' : 'lab-metric--alert' },
        { k: 'Portfolio NPV at ' + pct(st.rate, 1), v: money0(A.npv) },
        { k: 'Best portfolio within budget' + (A.best.exhaustive ? '' : ' (greedy heuristic)'), v: A.best.set.length ? names(A.best.set).join(', ') : 'None (no positive-NPV project fits)', note: 'NPV ' + money0(A.best.npv) + ', outlay ' + money0(A.best.cost) },
        { k: 'Opportunity cost of your selection', v: A.within ? money0(A.opp) : 'n/a', note: A.within ? (A.opp <= 0.5 ? 'Your selection is the best portfolio at this rate.' : 'NPV given up versus the best portfolio at this rate.') : 'Your selection exceeds the budget.' },
      ]));
      // ranks
      var R = out.ranks;
      clear(R);
      R.appendChild(heading(4, 'How the measures rank the projects'));
      var byNpv = A.rows.slice().sort(function (a, b) { return b.npv - a.npv; });
      var irrV = function (a) { return a.irr ? a.irr.value : -Infinity; };
      var byIrr = A.rows.slice().sort(function (a, b) { return irrV(b) - irrV(a); });
      var piV = function (a) { return a.pi === null ? -Infinity : a.pi; };
      var byPi = A.rows.slice().sort(function (a, b) { return piV(b) - piV(a); });
      var nm = function (a) { return str(a.p.label) || a.id; };
      R.appendChild(table({ caption: 'Rank by each measure', headers: [{ text: 'Rank', num: true }, 'By NPV', 'By IRR', 'By PI'],
        rows: byNpv.map(function (_, i) { return [{ text: String(i + 1), num: true }, nm(byNpv[i]), nm(byIrr[i]) + (byIrr[i].irr ? '' : ' (n/a)'), nm(byPi[i])]; }) }));
      var dis = [];
      for (var i = 0; i < A.rows.length; i++) for (var j = i + 1; j < A.rows.length; j++) {
        var a = A.rows[i], b = A.rows[j];
        if (Math.abs(a.npv - b.npv) < 0.5) continue;
        var hi = a.npv > b.npv ? a : b, lo = hi === a ? b : a, why = [];
        if (hi.irr && lo.irr && irrV(lo) > irrV(hi) + 1e-9) why.push('IRR (' + pct(irrV(lo), 1) + ' vs. ' + pct(irrV(hi), 1) + ')');
        if (hi.pi !== null && lo.pi !== null && lo.pi > hi.pi + 1e-9) why.push('PI (' + fixed(lo.pi, 2) + ' vs. ' + fixed(hi.pi, 2) + ')');
        if (why.length) dis.push('NPV ranks ' + nm(hi) + ' above ' + nm(lo) + ' (' + money0(hi.npv) + ' vs. ' + money0(lo.npv) + '), but ' + why.join(' and ') + ' rank' + (why.length > 1 ? '' : 's') + ' ' + nm(lo) + ' higher.');
      }
      R.appendChild(dis.length ? h('ul', { class: 'lab-list' }, dis.map(function (t) { return h('li', { text: t }); })) : h('p', { class: 'lab-hint', text: 'At this rate NPV, IRR and PI agree on every pair of projects.' }));
      if (dis.length) R.appendChild(h('p', { class: 'lab-hint', text: 'Disagreements usually come from differences in scale (IRR and PI ignore size) and timing (IRR assumes reinvestment at the IRR itself). With a budget, maximize total NPV within it.' }));
      if (announce) ctx.announce('Portfolio: ' + plural(st.selected.length, 'project') + ', outlay ' + money0(A.cost) + (A.within ? ' within budget' : ', over budget') + ', NPV ' + money0(A.npv) + '.');
    }
    function renderEnd() {
      var E = out.end;
      clear(E);
      if (!finished) {
        var btn = button('Submit this portfolio', function () {
          btn.disabled = true;
          E.appendChild(ctx.waitPanel('Loading the analyst’s notes…'));
          ctx.reveal().then(function (full) {
            if (ctx.destroyed) return;
            fullCfg = full; finished = true; ctx.saveNow(); render();
            ctx.announce('Portfolio submitted. ' + summary().label + '.');
            focusEl(view.querySelector('.lab-h--results'));
          }, function () { if (ctx.destroyed) return; renderEnd(); E.appendChild(ctx.errorPanel('The notes could not be loaded. Try again in a moment.')); });
        }, 'primary');
        E.appendChild(h('div', { class: 'lab-actions' }, btn));
        E.appendChild(h('p', { class: 'lab-hint', text: 'Submitting records your portfolio at ' + 'the current rate and reveals what a careful analyst notices.' }));
        return;
      }
      E.appendChild(resultsHeading('Submitted portfolio'));
      E.appendChild(h('p', { class: 'lab-hint', text: 'Recorded at a discount rate of ' + pct(st.rate, 1) + '. The controls above are locked; start again to change them.' }));
      if (!fullCfg) {
        E.appendChild(ctx.waitPanel('Loading the analyst’s notes…'));
        ctx.reveal().then(function (full) { if (ctx.destroyed) return; fullCfg = full; renderEnd(); }, function () { if (ctx.destroyed) return; clear(E); E.appendChild(ctx.errorPanel('The notes could not be loaded.', renderEnd)); E.appendChild(ctx.startAgain(again)); });
        return;
      }
      var ins = obj(fullCfg.key).insights;
      if (ins) E.appendChild(ctx.rich(h('div', { class: 'lab-reveal' }, heading(5, 'What a careful analyst notices')), ins));
      E.appendChild(ctx.startAgain(again));
    }
    function again() { st = fresh(summary()); finished = false; ctx.saveNow(); render(); ctx.announce('Started again. Your submitted portfolio is kept until you submit a new one.'); focusEl(view.querySelector('input[type=range]')); }
    render();
  }

  function strategyMode(ctx) {
    var cfg = ctx.cfg, budget = num(cfg.budget, 100), step = num(cfg.step, 5) > 0 ? num(cfg.step, 5) : 5, unit = str(cfg.unit) || 'points';
    var strategies = arr(cfg.strategies).filter(function (s) { return s && s.id; });
    var inits = arr(cfg.initiatives).filter(function (i) { return i && i.id; });
    var scenarios = arr(cfg.scenarios).filter(function (s) { return s && s.id; });
    if (!scenarios.length) scenarios = [{ id: 'base', label: 'Base case', multipliers: {} }];
    var rules = arr(cfg.rules).filter(function (r) { return r && r.when; });
    function fresh(prev) { var a = {}; inits.forEach(function (i) { a[i.id] = 0; }); return { v: 1, strategy: null, alloc: a, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      if (strategies.some(function (s) { return s.id === s0.strategy; })) st.strategy = s0.strategy;
      var tot = 0;
      inits.forEach(function (i) { var x = clamp(num(obj(s0.alloc)[i.id], 0), 0, num(i.max, budget)); if (tot + x > budget) x = Math.max(0, budget - tot); st.alloc[i.id] = x; tot += x; });
      finished = !!ctx.saved.finished && !!st.strategy;
    }
    var fullCfg = null;
    function strat() { return strategies.filter(function (s) { return s.id === st.strategy; })[0] || null; }
    function weight(i) { var s = strat(); var w = s ? obj(s.weights)[i.id] : undefined; return isNum(w) ? w : 1; }
    function mult(sc, i) { var m = obj(sc.multipliers)[i.id]; return isNum(m) ? m : 1; }
    function value(i, x, sc) { return M.saturating(x, num(i.scale, 0), num(i.saturation, 1) || 1, weight(i), mult(sc, i)); }
    function allocated() { return sum(inits.map(function (i) { return st.alloc[i.id]; })); }
    function totals() { return scenarios.map(function (sc) { return sum(inits.map(function (i) { return value(i, st.alloc[i.id], sc); })); }); }
    function hhi() { return M.herfindahl(inits.map(function (i) { return st.alloc[i.id]; })); }
    function firedRules() {
      return rules.filter(function (r) {
        var w = obj(r.when);
        if (w.strategy && w.strategy !== st.strategy) return false;
        var okMin = Object.keys(obj(w.min)).every(function (k) { return num(st.alloc[k], 0) >= w.min[k]; });
        var okMax = Object.keys(obj(w.max)).every(function (k) { return num(st.alloc[k], 0) <= w.max[k]; });
        return okMin && okMax;
      });
    }
    function concWord(x) { return x === null ? 'nothing allocated' : x >= 0.5 ? 'highly concentrated' : x >= 0.25 ? 'moderately concentrated' : 'diversified'; }
    function summary() {
      var s = strat(), t = totals(), met = { Strategy: s ? str(s.label) : 'none', Allocated: allocated(), Budget: budget };
      scenarios.forEach(function (sc, k) { met['Value — ' + str(sc.label)] = Number(t[k].toFixed(1)); });
      var x = hhi(); met['Concentration (HHI)'] = x === null ? 'n/a' : Number(x.toFixed(3));
      return { label: (finished ? 'Allocation submitted' : 'In progress') + ' — ' + (s ? str(s.label) : 'no strategy') + ', ' + allocated() + ' of ' + budget + ' allocated', metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Value of an initiative = `weight × scale × (1 − e^(−x / saturation)) × scenario multiplier`, where x is the amount allocated. The weight comes from the chosen strategy (1 if the strategy gives none); a missing scenario multiplier counts as 1.',
      'Diminishing returns: each extra step adds less than the one before. “Next step adds” shows the base-scenario value of one more step.',
      'Total value per scenario = sum over initiatives. Allocations move in steps of ' + step + ', up to each initiative’s maximum, and the total can never exceed the budget of ' + budget + ' ' + unit + ' — a slider stops where the budget runs out.',
      'Concentration: Herfindahl index `HHI = Σ sᵢ²`, with sᵢ each initiative’s share of the amount allocated. 1/HHI is the “effective number” of equally funded initiatives. Labels used here: HHI ≥ 0.50 highly concentrated, 0.25–0.50 moderately concentrated, below 0.25 diversified (teaching thresholds).',
      'Rules fire when the strategy matches (if the rule names one) and every listed minimum and maximum allocation holds.',
      'A teaching model of diminishing returns and strategic fit, not a forecast.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);
    var out = {}, sliders = {};

    function render() { clear(view); out = {}; sliders = {}; build(); }
    function build() {
      if (cfg.brief) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.brief));
      var name = uid('strat'), fs = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: 'Strategy' }));
      strategies.forEach(function (s) {
        var inp = h('input', { type: 'radio', name: name, value: s.id, checked: st.strategy === s.id, disabled: finished });
        inp.addEventListener('change', function () { st.strategy = s.id; update(true); ctx.touch(); });
        fs.appendChild(h('label', { class: 'lab-option' }, inp, h('span', { class: 'lab-option-body' }, h('span', { class: 'lab-option-title', text: str(s.label) }), s.description ? h('span', { class: 'lab-option-text', html: ctx.inline(s.description) }) : null)));
      });
      view.appendChild(fs);
      out.budget = h('p', { class: 'lab-budgetline', role: 'status' });
      view.appendChild(out.budget);
      var list = h('div', { class: 'lab-initiatives' });
      inits.forEach(function (i) {
        var id = uid('ini'), mx = Math.min(num(i.max, budget), budget);
        var outEl = h('output', { for: id, class: 'lab-output' });
        var next = h('span', { class: 'lab-hint' });
        var r = h('input', { type: 'range', id: id, min: 0, max: mx, step: step, value: st.alloc[i.id], class: 'lab-range', disabled: finished });
        r.addEventListener('input', function () {
          var want = Number(r.value), others = allocated() - st.alloc[i.id], room = budget - others;
          var x = want;
          if (x > room) { x = Math.max(0, Math.floor(room / step + 1e-9) * step); r.value = x; ctx.announce('Budget fully allocated: ' + str(i.label) + ' stops at ' + x + '.'); }
          st.alloc[i.id] = x;
          update(false); ctx.touch();
        });
        sliders[i.id] = { r: r, out: outEl, next: next, i: i };
        var card = h('div', { class: 'lab-initiative' },
          h('div', { class: 'lab-field lab-field--range' }, h('label', { for: id, text: str(i.label) }), h('div', { class: 'lab-rangerow' }, r, outEl), next),
          i.description ? h('p', { class: 'lab-help', html: ctx.inline(i.description) }) : null,
          h('p', { class: 'lab-hint', text: 'Maximum ' + mx + ' · scale ' + num(i.scale, 0) + ' · saturation ' + num(i.saturation, 0) + (i.risk ? ' · risk: ' + str(i.risk) : '') }),
          i.notes ? h('p', { class: 'lab-hint', html: ctx.inline(i.notes) }) : null);
        list.appendChild(card);
      });
      view.appendChild(list);
      out.values = h('section', { class: 'lab-section' });
      out.rules = h('section', { class: 'lab-section' });
      out.end = h('section', { class: 'lab-section lab-results' });
      view.appendChild(out.values);
      view.appendChild(out.rules);
      view.appendChild(out.end);
      update(false);
      renderEnd();
    }
    function update(announce) {
      var a = allocated();
      out.budget.textContent = 'Allocated ' + a + ' of ' + budget + ' ' + unit + ' · ' + (budget - a) + ' unallocated';
      var base = scenarios[0];
      inits.forEach(function (i) {
        var s = sliders[i.id], x = st.alloc[i.id];
        s.out.textContent = String(x);
        var room = budget - a, mx = Math.min(num(i.max, budget), budget);
        s.next.textContent = x + step <= mx && room >= step ? 'Next step (+' + step + ') adds ' + fixed(value(i, x + step, base) - value(i, x, base), 2) + ' (' + str(base.label) + ')' : x >= mx ? 'At this initiative’s maximum' : 'No budget left for another step';
      });
      var V = out.values;
      clear(V);
      V.appendChild(heading(4, 'Value by scenario' + (strat() ? ' — ' + str(strat().label) : ' (no strategy chosen: weights of 1)')));
      var t = totals();
      V.appendChild(table({
        caption: 'Value by initiative and scenario (teaching units)', rowHeader: true,
        headers: ['Initiative', { text: 'Allocated', num: true }, { text: 'Weight', num: true }].concat(scenarios.map(function (sc) { return { text: str(sc.label), num: true }; })),
        rows: inits.map(function (i) { return [str(i.label), { text: String(st.alloc[i.id]), num: true }, { text: fixed(weight(i), 2), num: true }].concat(scenarios.map(function (sc) { return { text: fixed(value(i, st.alloc[i.id], sc), 1), num: true }; })); }),
        foot: [['Total', { text: String(a), num: true }, { text: '', num: true }].concat(t.map(function (v) { return { text: fixed(v, 1), num: true }; }))],
      }));
      var x = hhi();
      V.appendChild(metrics([
        { k: 'Concentration (HHI)', v: x === null ? 'n/a' : fixed(x, 3), note: x === null ? 'Nothing allocated yet' : concWord(x) + ' — like ' + fixed(1 / x, 1) + ' equally funded initiatives' },
        { k: 'Range across scenarios', v: fixed(minOf(t), 1) + ' to ' + fixed(maxOf(t), 1), note: 'A wide range means the allocation’s value depends heavily on which scenario occurs.' },
      ]));
      var Rl = out.rules;
      clear(Rl);
      Rl.appendChild(heading(4, 'Rules that apply'));
      var f = firedRules();
      Rl.appendChild(f.length ? h('ul', { class: 'lab-list lab-list--notes' }, f.map(function (r) { return h('li', { html: ctx.inline(r.text) }); })) : h('p', { class: 'lab-hint', text: 'No rule applies to the current strategy and allocation.' }));
      if (announce) ctx.announce('Strategy ' + (strat() ? str(strat().label) : 'none') + '. ' + plural(f.length, 'rule') + ' apply.');
    }
    function renderEnd() {
      var E = out.end;
      clear(E);
      if (!finished) {
        var btn = button('Submit this allocation', function () {
          if (!st.strategy) { E.appendChild(h('p', { class: 'lab-formerror', role: 'alert', text: 'Choose a strategy first.' })); return; }
          btn.disabled = true;
          E.appendChild(ctx.waitPanel('Loading the insights…'));
          ctx.reveal().then(function (full) {
            if (ctx.destroyed) return;
            fullCfg = full; finished = true; ctx.saveNow(); render();
            ctx.announce('Allocation submitted. ' + summary().label + '.');
            focusEl(view.querySelector('.lab-h--results'));
          }, function () { if (ctx.destroyed) return; renderEnd(); E.appendChild(ctx.errorPanel('The insights could not be loaded. Try again in a moment.')); });
        }, 'primary');
        E.appendChild(h('div', { class: 'lab-actions' }, btn));
        return;
      }
      E.appendChild(resultsHeading('Submitted allocation'));
      if (!fullCfg) {
        E.appendChild(ctx.waitPanel('Loading the insights…'));
        ctx.reveal().then(function (full) { if (ctx.destroyed) return; fullCfg = full; renderEnd(); }, function () { if (ctx.destroyed) return; clear(E); E.appendChild(ctx.errorPanel('The insights could not be loaded.', renderEnd)); E.appendChild(ctx.startAgain(again)); });
        return;
      }
      var ins = obj(fullCfg.key).insights;
      if (ins) E.appendChild(ctx.rich(h('div', { class: 'lab-reveal' }, heading(5, 'Insights')), ins));
      E.appendChild(ctx.startAgain(again));
    }
    function again() { st = fresh(summary()); finished = false; ctx.saveNow(); render(); ctx.announce('Started again. Your submitted allocation is kept until you submit a new one.'); focusEl(view.querySelector('.lab-legend')); }
    render();
  }

  /* ===================================================================== 7. orgdesign */

  var DECISION_ROLES = [{ id: 'R', label: 'Recommend' }, { id: 'D', label: 'Decide' }, { id: 'I', label: 'Input' }, { id: 'N', label: 'Informed' }];

  /** Built-in organization checks (pure; used by the engine and the tests). */
  M.orgChecks = function (cfg, st) {
    var roles = {}, out = [];
    arr(cfg.roles).forEach(function (r) { if (r && r.id) roles[r.id] = r; });
    var lim = obj(cfg.limits), span = arr(lim.span).length === 2 ? lim.span : [3, 8], maxLayers = num(lim.maxLayers, 4), budget = num(cfg.budget, 0);
    var pos = arr(st.positions), byId = {};
    pos.forEach(function (p) { byId[p.id] = p; });
    function role(p) { return roles[p.role] || { label: p.role, cost: 0, hours: 0, skills: [] }; }
    var names = M.orgNames(cfg, pos);
    // cost
    var cost = sum(pos.map(function (p) { return num(role(p).cost, 0); }));
    out.push(cost > budget ? { sev: 'problem', text: 'Cost ' + money(cost) + ' exceeds the budget of ' + money(budget) + ' by ' + money(cost - budget) + '.' } : { sev: 'ok', text: 'Cost ' + money(cost) + ' is within the budget of ' + money(budget) + ' (' + money(budget - cost) + ' spare).' });
    // structure: reports, roots, layers
    var reports = {};
    pos.forEach(function (p) { reports[p.id] = []; });
    var roots = [];
    pos.forEach(function (p) { if (p.reportsTo && byId[p.reportsTo] && p.reportsTo !== p.id) reports[p.reportsTo].push(p.id); else roots.push(p.id); });
    var depth = {};
    function walk(id, d, seen) { if (seen[id]) return; seen[id] = 1; depth[id] = d; reports[id].forEach(function (c) { walk(c, d + 1, seen); }); }
    var seen = {};
    roots.forEach(function (r) { walk(r, 1, seen); });
    pos.forEach(function (p) { if (!seen[p.id]) { out.push({ sev: 'problem', text: names[p.id] + ' is part of a reporting loop.' }); depth[p.id] = 1; } });
    var layers = pos.length ? maxOf(pos.map(function (p) { return depth[p.id] || 1; })) : 0;
    if (roots.length > 1) out.push({ sev: 'caution', text: roots.length + ' positions report to no one (' + roots.map(function (r) { return names[r]; }).join(', ') + '): the organization has no single head.' });
    out.push(layers > maxLayers ? { sev: 'problem', text: layers + ' layers exceed the limit of ' + maxLayers + '.' } : { sev: 'ok', text: plural(layers, 'layer') + ' (limit ' + maxLayers + ').' });
    var spanIssues = 0;
    pos.forEach(function (p) {
      var c = reports[p.id].length;
      if (!c) return;
      if (c < span[0]) { spanIssues++; out.push({ sev: 'caution', text: names[p.id] + ' manages ' + c + ' — below the span range of ' + span[0] + '–' + span[1] + ' (a narrow span adds layers and cost).' }); }
      else if (c > span[1]) { spanIssues++; out.push({ sev: 'caution', text: names[p.id] + ' manages ' + c + ' — above the span range of ' + span[0] + '–' + span[1] + '.' }); }
    });
    if (!spanIssues && pos.some(function (p) { return reports[p.id].length; })) out.push({ sev: 'ok', text: 'Every manager’s span is within ' + span[0] + '–' + span[1] + '.' });
    // work
    var load = {};
    pos.forEach(function (p) { load[p.id] = 0; });
    var unassigned = 0;
    arr(cfg.work).forEach(function (w) {
      if (!w || !w.id) return;
      var who = arr(obj(st.work)[w.id]).filter(function (id) { return byId[id]; });
      var hrs = num(w.hours, 0);
      if (!who.length) { unassigned++; out.push({ sev: w.critical ? 'problem' : 'caution', text: '“' + str(w.label) + '”' + (w.critical ? ' (critical)' : '') + ' is not assigned to anyone.' }); return; }
      who.forEach(function (id) { load[id] += hrs / who.length; });
      var have = {};
      who.forEach(function (id) { arr(role(byId[id]).skills).forEach(function (s) { have[s] = 1; }); });
      var missing = arr(w.skills).filter(function (s) { return !have[s]; });
      if (missing.length) out.push({ sev: 'caution', text: '“' + str(w.label) + '” needs ' + missing.join(', ') + ', which no assignee’s role has.' });
      if (w.critical && who.length === 1) out.push({ sev: 'caution', text: 'Critical work “' + str(w.label) + '” depends on one person (' + names[who[0]] + '): a single point of failure.' });
    });
    if (!unassigned && arr(cfg.work).length) out.push({ sev: 'ok', text: 'All ' + arr(cfg.work).length + ' work items are assigned.' });
    var over = 0;
    pos.forEach(function (p) {
      var cap = num(role(p).hours, 0);
      if (load[p.id] > cap + 1e-9) { over++; out.push({ sev: 'problem', text: names[p.id] + ' is assigned ' + fixed(load[p.id], 1) + ' hours against a capacity of ' + cap + '.' }); }
    });
    if (!over && pos.length) out.push({ sev: 'ok', text: 'No position is assigned more hours than its capacity.' });
    // decisions
    var decGaps = 0;
    arr(cfg.decisions).forEach(function (d) {
      if (!d || !d.id) return;
      var m = obj(obj(st.decisions)[d.id]), dec = Object.keys(m).filter(function (id) { return byId[id] && m[id] === 'D'; });
      if (!dec.length) { decGaps++; out.push({ sev: 'problem', text: 'No one decides “' + str(d.label) + '”.' }); }
      else if (dec.length > 1) { decGaps++; out.push({ sev: 'problem', text: '“' + str(d.label) + '” has ' + dec.length + ' deciders (' + dec.map(function (id) { return names[id]; }).join(', ') + '): decision rights are duplicated.' }); }
    });
    if (!decGaps && arr(cfg.decisions).length) out.push({ sev: 'ok', text: 'Every decision has exactly one “Decide”.' });
    var rank = { problem: 0, caution: 1, ok: 2 };
    out.sort(function (a, b) { return rank[a.sev] - rank[b.sev]; });
    return { items: out, cost: cost, layers: layers, load: load, reports: reports, roots: roots, names: names,
      problems: out.filter(function (x) { return x.sev === 'problem'; }).length, cautions: out.filter(function (x) { return x.sev === 'caution'; }).length };
  };
  /** Display names: the role label, numbered when a role is used more than once. */
  M.orgNames = function (cfg, pos) {
    var roles = {}, counts = {}, idx = {}, names = {};
    arr(cfg.roles).forEach(function (r) { if (r && r.id) roles[r.id] = r; });
    pos.forEach(function (p) { counts[p.role] = (counts[p.role] || 0) + 1; });
    pos.forEach(function (p) {
      idx[p.role] = (idx[p.role] || 0) + 1;
      var base = roles[p.role] ? str(roles[p.role].label) : str(p.role);
      names[p.id] = counts[p.role] > 1 ? base + ' ' + idx[p.role] : base;
    });
    return names;
  };

  ENGINES.orgdesign = function (ctx) {
    var cfg = ctx.cfg;
    var roles = arr(cfg.roles).filter(function (r) { return r && r.id; });
    var work = arr(cfg.work).filter(function (w) { return w && w.id; });
    var decisions = arr(cfg.decisions).filter(function (d) { return d && d.id; });
    function roleOf(id) { return roles.filter(function (r) { return r.id === id; })[0] || null; }
    function fresh(prev) {
      var positions = arr(cfg.start).filter(function (p) { return p && p.id && roleOf(p.role); }).map(function (p) { return { id: str(p.id), role: p.role, reportsTo: p.reportsTo || null }; });
      return { v: 1, positions: positions, seq: 1, work: {}, decisions: {}, previous: prev || null };
    }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      if (Array.isArray(s0.positions)) st.positions = s0.positions.filter(function (p) { return p && p.id && roleOf(p.role); }).map(function (p) { return { id: str(p.id), role: p.role, reportsTo: p.reportsTo || null }; });
      var ids = {}; st.positions.forEach(function (p) { ids[p.id] = 1; });
      st.positions.forEach(function (p) { if (!ids[p.reportsTo]) p.reportsTo = null; });
      st.seq = Math.max(1, Math.round(num(s0.seq, 1)));
      work.forEach(function (w) { var a = arr(obj(s0.work)[w.id]).filter(function (id) { return ids[id]; }); if (a.length) st.work[w.id] = a; });
      decisions.forEach(function (d) { var m = obj(obj(s0.decisions)[d.id]), o = {}; Object.keys(m).forEach(function (id) { if (ids[id] && DECISION_ROLES.some(function (r) { return r.id === m[id]; })) o[id] = m[id]; }); st.decisions[d.id] = o; });
      finished = !!ctx.saved.finished;
    }
    function checks() { return M.orgChecks(cfg, st); }
    function summary() {
      var c = checks();
      return { label: (finished ? 'Design recorded' : 'In progress') + ' — ' + plural(st.positions.length, 'position') + ', ' + plural(c.problems, 'problem') + ', ' + plural(c.cautions, 'caution'),
        metrics: { Positions: st.positions.length, Cost: c.cost, Budget: num(cfg.budget, 0), Layers: c.layers, Problems: c.problems, Cautions: c.cautions } };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    var lim = obj(cfg.limits), span = arr(lim.span).length === 2 ? lim.span : [3, 8];
    ctx.body.appendChild(ctx.rulesPanel([
      'Cost = sum of each position’s role cost, compared with the budget of ' + money(num(cfg.budget, 0)) + '. Over budget is a problem.',
      'Span of control = number of direct reports. A manager with fewer than ' + span[0] + ' or more than ' + span[1] + ' reports is flagged as a caution. Positions with no reports are individual contributors and are not checked.',
      'Layers = the longest chain from a top position down, counting the top as layer 1. More than ' + num(lim.maxLayers, 4) + ' is a problem. More than one position reporting to no one is a caution.',
      'Hours: a work item shared by several positions is split equally among them. A position assigned more hours than its role’s capacity is a problem.',
      'Work: an unassigned item is a caution (a problem if it is critical). Skill mismatch: a caution when a required skill is held by none of the item’s assignees’ roles. Critical work held by exactly one position is a caution (single point of failure).',
      'Decision rights (practitioner heuristic in the RAPID / RACI family): every decision needs exactly one “Decide”; none or several is a problem. Recommend, Input and Informed are not checked.',
      'Scenario-specific checks below are described in words for you to judge; the engine does not compute them.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function render(focusSel) {
      ctx.keepFocus(function () { clear(view); if (finished) renderFinished(); else renderWork(); });
      if (focusSel) focusEl(view.querySelector(focusSel));
    }
    function change(msg) { ctx.touch(); render(); if (msg) ctx.announce(msg); }
    function names() { return M.orgNames(cfg, st.positions); }
    function posSelect(id, value, includeNone, exclude, fk) {
      var nm = names(), sel = h('select', { id: id, class: 'lab-select', 'data-fk': fk });
      if (includeNone) sel.appendChild(h('option', { value: '', text: includeNone, selected: !value }));
      st.positions.forEach(function (p) { if (exclude && exclude[p.id]) return; sel.appendChild(h('option', { value: p.id, text: nm[p.id], selected: value === p.id })); });
      return sel;
    }
    function descendants(id) {
      var out = {}, stack = [id];
      while (stack.length) { var x = stack.pop(); if (out[x]) continue; out[x] = 1; st.positions.forEach(function (p) { if (p.reportsTo === x) stack.push(p.id); }); }
      return out;
    }
    function addPosition(roleId, reportsTo) {
      var id;
      do { id = 'p' + st.seq; st.seq += 1; } while (st.positions.some(function (p) { return p.id === id; }));
      st.positions.push({ id: id, role: roleId, reportsTo: reportsTo || null });
      return id;
    }
    function removePosition(id) {
      var p = st.positions.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      st.positions.forEach(function (x) { if (x.reportsTo === id) x.reportsTo = p.reportsTo; });
      st.positions = st.positions.filter(function (x) { return x.id !== id; });
      Object.keys(st.work).forEach(function (w) { st.work[w] = st.work[w].filter(function (x) { return x !== id; }); if (!st.work[w].length) delete st.work[w]; });
      Object.keys(st.decisions).forEach(function (d) { delete st.decisions[d][id]; });
    }

    function tree(C) {
      var nm = C.names, ul = h('ul', { class: 'lab-tree' });
      function node(id) {
        var p = st.positions.filter(function (x) { return x.id === id; })[0], r = roleOf(p.role) || {};
        var kids = C.reports[id] || [];
        var li = h('li', null, h('span', { class: 'lab-tree-node' }, h('strong', { text: nm[id] }),
          h('span', { class: 'lab-tree-meta', text: ' — ' + fixed(C.load[id] || 0, 0) + '/' + num(r.hours, 0) + ' h' + (kids.length ? ' · ' + plural(kids.length, 'report') : '') })));
        if (kids.length) { var sub = h('ul'); kids.forEach(function (k) { sub.appendChild(node(k)); }); li.appendChild(sub); }
        return li;
      }
      var seen = {};
      C.roots.forEach(function (r) { if (!seen[r]) { seen[r] = 1; ul.appendChild(node(r)); } });
      return st.positions.length ? ul : h('p', { class: 'lab-hint', text: 'No positions yet.' });
    }
    function checkList(C) {
      var ul = h('ul', { class: 'lab-checks' });
      C.items.forEach(function (it) { ul.appendChild(h('li', { class: 'lab-check lab-check--' + it.sev }, tag(it.sev === 'problem' ? 'Problem' : it.sev === 'caution' ? 'Caution' : 'OK', it.sev), ' ', h('span', { text: it.text }))); });
      return ul;
    }

    function renderWork() {
      var C = checks(), nm = C.names;
      if (cfg.brief) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.brief));
      view.appendChild(metrics([
        { k: 'Positions', v: String(st.positions.length) },
        { k: 'Cost vs. budget', v: money(C.cost) + ' of ' + money(num(cfg.budget, 0)), cls: C.cost > num(cfg.budget, 0) ? 'lab-metric--alert' : '' },
        { k: 'Layers', v: C.layers + ' (limit ' + num(lim.maxLayers, 4) + ')' },
        { k: 'Checks', v: plural(C.problems, 'problem') + ', ' + plural(C.cautions, 'caution') },
      ], 'lab-metrics--compact'));
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'Build in this order: positions and reporting lines, then work, then decision rights. Watch the checks update as you go.'));

      // roles reference
      view.appendChild(h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Available roles' }),
        table({ caption: 'Roles', headers: ['Role', { text: 'Cost', num: true }, { text: 'Hours', num: true }, 'Skills'], rowHeader: true,
          rows: roles.map(function (r) { return [str(r.label), { text: money(num(r.cost, 0)), num: true }, { text: String(num(r.hours, 0)), num: true }, arr(r.skills).join(', ') || '—']; }) })));

      // positions
      var ps = h('section', { class: 'lab-section' }, heading(4, '1. Positions and reporting lines'));
      var rows = st.positions.map(function (p) {
        var r = roleOf(p.role) || {}, selId = uid('rep');
        var sel = posSelect(selId, p.reportsTo, 'No one (top)', descendants(p.id), 'rep-' + p.id);
        sel.setAttribute('aria-label', nm[p.id] + ' reports to');
        sel.addEventListener('change', function () { p.reportsTo = sel.value || null; change(nm[p.id] + ' now reports to ' + (p.reportsTo ? names()[p.reportsTo] : 'no one') + '.'); });
        var rm = button('Remove', function () { var n = nm[p.id]; removePosition(p.id); change(n + ' removed. Their reports now report to their manager.'); }, 'quiet', { 'aria-label': 'Remove ' + nm[p.id], 'data-fk': 'rm-' + p.id });
        return [nm[p.id], { node: sel }, { text: money(num(r.cost, 0)), num: true }, { text: fixed(C.load[p.id] || 0, 0) + ' / ' + num(r.hours, 0), num: true }, { node: rm }];
      });
      ps.appendChild(table({ caption: 'Positions', headers: ['Position', 'Reports to', { text: 'Cost', num: true }, { text: 'Hours (assigned / capacity)', num: true }, 'Remove'], rowHeader: true, rows: rows }));
      var aRole = uid('arole'), aRep = uid('arep');
      var roleSel = h('select', { id: aRole, class: 'lab-select', 'data-fk': 'add-role' }, roles.map(function (r) { return h('option', { value: r.id, text: str(r.label) + ' — ' + money(num(r.cost, 0)) }); }));
      var repSel = posSelect(aRep, st.positions.length ? st.positions[0].id : '', 'No one (top)', null, 'add-rep');
      ps.appendChild(h('fieldset', { class: 'lab-fieldset lab-fieldset--inline' }, h('legend', { class: 'lab-legend', text: 'Add a position' }),
        h('div', { class: 'lab-row' }, h('div', { class: 'lab-field' }, h('label', { for: aRole, text: 'Role' }), roleSel), h('div', { class: 'lab-field' }, h('label', { for: aRep, text: 'Reports to' }), repSel)),
        h('div', { class: 'lab-actions' }, button('Add position', function () { var id = addPosition(roleSel.value, repSel.value); change(names()[id] + ' added.'); }, 'primary', { 'data-fk': 'add-pos' }))));
      ps.appendChild(heading(5, 'Organization chart'));
      ps.appendChild(tree(C));
      view.appendChild(ps);

      // work
      var ws = h('section', { class: 'lab-section' }, heading(4, '2. Work'));
      var wl = h('ul', { class: 'lab-assignlist' });
      work.forEach(function (w) {
        var who = arr(st.work[w.id]);
        var li = h('li', { class: 'lab-assign' }, h('p', { class: 'lab-assign-head' }, h('strong', { text: str(w.label) }), w.critical ? ' ' : null, w.critical ? tag('Critical', 'caution') : null,
          h('span', { class: 'lab-hint', text: ' ' + num(w.hours, 0) + ' h · skills: ' + (arr(w.skills).join(', ') || 'none') })));
        var chips = h('ul', { class: 'lab-chiplist', 'aria-label': 'Assigned to' });
        who.forEach(function (id) {
          chips.appendChild(h('li', { class: 'lab-chiptag' }, h('span', { text: nm[id] }), button('Remove', function () { st.work[w.id] = arr(st.work[w.id]).filter(function (x) { return x !== id; }); if (!st.work[w.id].length) delete st.work[w.id]; change(nm[id] + ' removed from ' + str(w.label) + '.'); }, 'mini', { 'aria-label': 'Unassign ' + nm[id] + ' from ' + str(w.label), 'data-fk': 'wrm-' + w.id + '-' + id })));
        });
        if (!who.length) chips.appendChild(h('li', { class: 'lab-hint', text: 'Unassigned' }));
        li.appendChild(chips);
        var avail = {}; who.forEach(function (id) { avail[id] = 1; });
        if (st.positions.some(function (p) { return !avail[p.id]; })) {
          var sid = uid('w'), sel = posSelect(sid, null, null, avail, 'wsel-' + w.id);
          li.appendChild(h('div', { class: 'lab-row lab-row--compact' }, h('label', { for: sid, class: 'lab-sr', text: 'Assign ' + str(w.label) + ' to' }), sel,
            button('Assign', function () { if (!sel.value) return; st.work[w.id] = arr(st.work[w.id]).concat([sel.value]); change(str(w.label) + ' assigned to ' + names()[sel.value] + '.'); }, null, { 'aria-label': 'Assign ' + str(w.label), 'data-fk': 'wadd-' + w.id })));
        }
        wl.appendChild(li);
      });
      ws.appendChild(wl);
      view.appendChild(ws);

      // decisions
      var ds = h('section', { class: 'lab-section' }, heading(4, '3. Decision rights'));
      ds.appendChild(h('p', { class: 'lab-help', text: 'For each decision, give positions a role: Recommend, Decide, Input or Informed. Exactly one position should Decide.' }));
      var dl = h('ul', { class: 'lab-assignlist' });
      decisions.forEach(function (d) {
        var m = st.decisions[d.id] || (st.decisions[d.id] = {});
        var li = h('li', { class: 'lab-assign' }, h('p', { class: 'lab-assign-head' }, h('strong', { text: str(d.label) })));
        var chips = h('ul', { class: 'lab-chiplist', 'aria-label': 'Decision roles' });
        Object.keys(m).forEach(function (id) {
          var rl = DECISION_ROLES.filter(function (r) { return r.id === m[id]; })[0];
          chips.appendChild(h('li', { class: 'lab-chiptag' }, h('span', { text: nm[id] + ': ' + rl.label }), button('Remove', function () { delete m[id]; change(nm[id] + ' removed from ' + str(d.label) + '.'); }, 'mini', { 'aria-label': 'Remove ' + nm[id] + ' from ' + str(d.label), 'data-fk': 'drm-' + d.id + '-' + id })));
        });
        if (!Object.keys(m).length) chips.appendChild(h('li', { class: 'lab-hint', text: 'No one assigned' }));
        li.appendChild(chips);
        var used = {}; Object.keys(m).forEach(function (id) { used[id] = 1; });
        if (st.positions.some(function (p) { return !used[p.id]; })) {
          var sid = uid('d'), rid = uid('dr'), sel = posSelect(sid, null, null, used, 'dsel-' + d.id);
          var rsel = h('select', { id: rid, class: 'lab-select', 'data-fk': 'drole-' + d.id }, DECISION_ROLES.map(function (r) { return h('option', { value: r.id, text: r.label }); }));
          li.appendChild(h('div', { class: 'lab-row lab-row--compact' }, h('label', { for: sid, class: 'lab-sr', text: 'Position for ' + str(d.label) }), sel,
            h('label', { for: rid, class: 'lab-sr', text: 'Role in ' + str(d.label) }), rsel,
            button('Add', function () { if (!sel.value) return; m[sel.value] = rsel.value; change(names()[sel.value] + ' added to ' + str(d.label) + ' as ' + DECISION_ROLES.filter(function (r) { return r.id === rsel.value; })[0].label + '.'); }, null, { 'aria-label': 'Add role for ' + str(d.label), 'data-fk': 'dadd-' + d.id })));
        }
        dl.appendChild(li);
      });
      ds.appendChild(dl);
      view.appendChild(ds);

      // checks
      var cs = h('section', { class: 'lab-section' }, heading(4, 'Checks'), checkList(C));
      if (arr(cfg.rules).length) cs.appendChild(h('div', { class: 'lab-selfcheck' }, heading(5, 'Also consider (judged by you, not computed)'),
        h('ul', { class: 'lab-list' }, arr(cfg.rules).map(function (r) { return h('li', { html: ctx.inline(r && r.text) }); }))));
      cs.appendChild(h('div', { class: 'lab-actions' }, button('Record this design', function () {
        finished = true; ctx.saveNow(); render('.lab-h--results');
        ctx.announce('Design recorded. ' + summary().label + '.');
      }, 'primary', { 'data-fk': 'record' })));
      view.appendChild(cs);
    }

    function renderFinished() {
      var C = checks(), nm = C.names;
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Your recorded design'));
      sec.appendChild(metrics([
        { k: 'Positions', v: String(st.positions.length) },
        { k: 'Cost vs. budget', v: money(C.cost) + ' of ' + money(num(cfg.budget, 0)) },
        { k: 'Layers', v: String(C.layers) },
        { k: 'Checks', v: plural(C.problems, 'problem') + ', ' + plural(C.cautions, 'caution') },
      ]));
      sec.appendChild(heading(5, 'Organization chart'));
      sec.appendChild(tree(C));
      sec.appendChild(heading(5, 'Checks'));
      sec.appendChild(checkList(C));
      sec.appendChild(heading(5, 'Work and decision rights'));
      sec.appendChild(table({ caption: 'Work assignments', headers: ['Work', { text: 'Hours', num: true }, 'Assigned to'], rowHeader: true,
        rows: work.map(function (w) { return [str(w.label) + (w.critical ? ' (critical)' : ''), { text: String(num(w.hours, 0)), num: true }, arr(st.work[w.id]).map(function (id) { return nm[id]; }).join(', ') || 'Unassigned']; }) }));
      sec.appendChild(table({ caption: 'Decision rights', headers: ['Decision'].concat(DECISION_ROLES.map(function (r) { return r.label; })), rowHeader: true,
        rows: decisions.map(function (d) { var m = obj(st.decisions[d.id]); return [str(d.label)].concat(DECISION_ROLES.map(function (r) { return Object.keys(m).filter(function (id) { return m[id] === r.id; }).map(function (id) { return nm[id]; }).join(', ') || '—'; })); }) }));
      sec.appendChild(h('div', { class: 'lab-actions' }, button('Revise this design', function () {
        finished = false; ctx.touch(); render('.lab-section .lab-h'); ctx.announce('Editing the design again.');
      })));
      sec.appendChild(ctx.startAgain(function () {
        st = fresh(summary()); finished = false; ctx.saveNow(); render('.lab-section .lab-h'); ctx.announce('Started again from the initial organization.');
      }, 'This replaces your design with the starting organization. Your recorded summary is kept until you record a new design.'));
      view.appendChild(sec);
    }
    render();
  };

  /* ===================================================================== 8. stakeholder */

  var STANCES = [{ v: -2, label: 'Strong opponent' }, { v: -1, label: 'Opponent' }, { v: 0, label: 'Neutral' }, { v: 1, label: 'Supporter' }, { v: 2, label: 'Strong supporter' }];
  var QUADRANTS = {
    'hh': { name: 'Manage closely', text: 'High power, high interest: involve them in shaping the change, meet one to one, and resolve concerns early. Supporters can sponsor; opponents need their objections understood and negotiated, never surprised.' },
    'hl': { name: 'Keep satisfied', text: 'High power, low interest: brief, concise updates; no surprises; ask for specific, limited help. Watch for rising interest.' },
    'lh': { name: 'Keep informed', text: 'Lower power, high interest: regular two-way communication; they are an early-warning network and can become allies or carry objections upward.' },
    'll': { name: 'Monitor', text: 'Lower power, lower interest: light-touch updates; watch for changes in power or interest.' },
  };
  function quadrant(r) { return (r.power >= 3 ? 'h' : 'l') + (r.interest >= 3 ? 'h' : 'l'); }
  function stanceWord(v) { var s = STANCES.filter(function (x) { return x.v === v; })[0]; return s ? s.label : 'Unrated'; }
  function camp(v) { return v > 0 ? 'support' : v < 0 ? 'oppose' : 'neutral'; }

  /** Coalitions, high-power neutrals and brokers for a set of ratings (pure). */
  M.stakeholderAnalysis = function (people, ratings, ties) {
    var rated = people.filter(function (p) { var r = ratings[p.id]; return r && isNum(r.power) && isNum(r.interest) && isNum(r.stance); });
    var R = function (p) { return ratings[p.id]; };
    var sup = rated.filter(function (p) { return R(p).stance > 0; }), opp = rated.filter(function (p) { return R(p).stance < 0; }), neu = rated.filter(function (p) { return R(p).stance === 0; });
    var byId = {}; rated.forEach(function (p) { byId[p.id] = p; });
    var brokers = [], rivalries = [];
    rated.forEach(function (p) {
      var toSup = false, toOpp = false;
      arr(ties).forEach(function (t) {
        if (!Array.isArray(t) || t.length < 2) return;
        var other = t[0] === p.id ? t[1] : t[1] === p.id ? t[0] : null;
        if (!other || !byId[other] || str(t[2]) === 'rival') return;
        if (R(byId[other]).stance > 0) toSup = true;
        if (R(byId[other]).stance < 0) toOpp = true;
      });
      if (toSup && toOpp) brokers.push(p);
    });
    arr(ties).forEach(function (t) {
      if (!Array.isArray(t) || str(t[2]) !== 'rival' || !byId[t[0]] || !byId[t[1]]) return;
      var a = camp(R(byId[t[0]]).stance), b = camp(R(byId[t[1]]).stance);
      if (a !== b) rivalries.push([byId[t[0]], byId[t[1]]]);
    });
    return {
      rated: rated, supporters: sup, opponents: opp, neutrals: neu,
      supportPower: sum(sup.map(function (p) { return R(p).power; })), opposePower: sum(opp.map(function (p) { return R(p).power; })), neutralPower: sum(neu.map(function (p) { return R(p).power; })),
      highPowerNeutrals: neu.filter(function (p) { return R(p).power >= 3; }), brokers: brokers, rivalries: rivalries,
    };
  };

  ENGINES.stakeholder = function (ctx) {
    var cfg = ctx.cfg;
    var people = arr(cfg.stakeholders).filter(function (s) { return s && s.id; });
    var ties = arr(cfg.ties);
    function fresh(prev) { return { v: 1, ratings: {}, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      people.forEach(function (p) {
        var r = obj(obj(s0.ratings)[p.id]);
        st.ratings[p.id] = { power: [1, 2, 3, 4, 5].indexOf(r.power) >= 0 ? r.power : null, interest: [1, 2, 3, 4, 5].indexOf(r.interest) >= 0 ? r.interest : null, stance: [-2, -1, 0, 1, 2].indexOf(r.stance) >= 0 ? r.stance : null };
      });
      finished = !!ctx.saved.finished && people.every(function (p) { var r = st.ratings[p.id]; return r.power !== null && r.interest !== null && r.stance !== null; });
    }
    function rating(id) { return st.ratings[id] || (st.ratings[id] = { power: null, interest: null, stance: null }); }
    function complete(id) { var r = rating(id); return r.power !== null && r.interest !== null && r.stance !== null; }
    function doneCount() { return people.filter(function (p) { return complete(p.id); }).length; }
    var fullCfg = null;
    function authorRatings() {
      var m = {};
      arr(obj(fullCfg).stakeholders).forEach(function (s) { if (s && s.id) { var k = obj(s.key); m[s.id] = { power: k.power, interest: k.interest, stance: k.stance, why: k.why }; } });
      return m;
    }
    function summary() {
      var met = { Rated: doneCount() + '/' + people.length };
      if (finished && fullCfg) {
        var a = authorRatings(), dp = [], di = [], same = 0;
        people.forEach(function (p) { var r = rating(p.id), k = a[p.id]; if (!k) return; dp.push(Math.abs(r.power - k.power)); di.push(Math.abs(r.interest - k.interest)); if (camp(r.stance) === camp(k.stance)) same++; });
        met['Mean power gap'] = Number((sum(dp) / (dp.length || 1)).toFixed(2));
        met['Mean interest gap'] = Number((sum(di) / (di.length || 1)).toFixed(2));
        met['Same camp as author'] = same + '/' + people.length;
      }
      var A = M.stakeholderAnalysis(people, st.ratings, ties);
      met['Supporting power'] = A.supportPower; met['Opposing power'] = A.opposePower;
      return { label: (finished ? 'Map submitted' : 'In progress') + ' — ' + doneCount() + ' of ' + people.length + ' rated; support ' + A.supportPower + ' vs. opposition ' + A.opposePower + ' (power)', metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'You rate each person’s power (1–5), interest in this change (1–5) and stance (−2 strong opponent … +2 strong supporter).',
      'Grid: interest across, power up. A rating of 3 or more counts as high (at or above the midpoint of the scale), so the dashed quadrant lines sit between 2 and 3.',
      'Quadrants and engagement (practitioner heuristic in the style of Mendelow’s power/interest grid — not a research finding): high power and interest = manage closely; high power, lower interest = keep satisfied; lower power, high interest = keep informed; both lower = monitor.',
      'Coalitions: supporting power = sum of power ratings of people with stance +1 or +2; opposing power = the same for −1 or −2; neutrals are shown separately.',
      'High-power neutrals: stance 0 and power 3 or more.',
      'Brokers: people with a non-rival tie to at least one supporter and at least one opponent (by your ratings). Rivalries across camps are listed too.',
      'After you submit, the case author’s read is shown beside yours with the differences. It is one informed reading, not the truth.',
    ], cfg.rules ? h('p', { class: 'lab-note', html: ctx.inline(cfg.rules) }) : null));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);
    var out = {};

    function render(focusSel) { clear(view); out = {}; if (finished) renderFinished(); else renderWork(); if (focusSel) focusEl(view.querySelector(focusSel)); }
    function nameOf(p) { return str(p.name) || p.id; }
    function initials(p) { var w = nameOf(p).split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : nameOf(p).slice(0, 2)).toUpperCase(); }

    function renderWork() {
      if (cfg.brief) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.brief));
      if (cfg.goal) view.appendChild(h('p', { class: 'lab-goal' }, h('span', { class: 'lab-label lab-label--inline', text: 'Goal' }), ' ', h('span', { html: ctx.inline(cfg.goal) })));
      out.progress = h('p', { class: 'lab-progress' });
      view.appendChild(out.progress);
      var list = h('div', { class: 'lab-people' });
      people.forEach(function (p) {
        var r = rating(p.id), card = h('article', { class: 'lab-person' });
        card.setAttribute('data-person', p.id);
        card.appendChild(heading(5, nameOf(p), 'lab-person-name'));
        if (p.title) card.appendChild(h('p', { class: 'lab-person-title', text: str(p.title) }));
        if (p.profile) card.appendChild(h('p', { class: 'lab-person-profile', html: ctx.inline(p.profile) }));
        function group(legend, field, opts) {
          var fs = h('fieldset', { class: 'lab-subgroup' }, h('legend', { class: 'lab-sublegend', text: legend }));
          var row = h('div', { class: 'lab-chips' }), name = uid('r');
          opts.forEach(function (o) {
            var inp = h('input', { type: 'radio', name: name, value: String(o.v), checked: r[field] === o.v });
            inp.addEventListener('change', function () { r[field] = o.v; update(); ctx.touch(); });
            row.appendChild(h('label', { class: 'lab-chip', title: o.title || null }, inp, h('span', { text: o.text })));
          });
          fs.appendChild(row);
          return fs;
        }
        var scale = [1, 2, 3, 4, 5].map(function (v) { return { v: v, text: String(v) }; });
        card.appendChild(group('Power (1 low – 5 high)', 'power', scale));
        card.appendChild(group('Interest in this change (1 low – 5 high)', 'interest', scale));
        card.appendChild(group('Stance', 'stance', STANCES.map(function (s) { return { v: s.v, text: signed(s.v) + ' ' + s.label }; })));
        list.appendChild(card);
      });
      view.appendChild(list);
      out.analysis = h('section', { class: 'lab-section', 'aria-label': 'Your map' });
      view.appendChild(out.analysis);
      out.submit = h('div', { class: 'lab-finish' });
      view.appendChild(out.submit);
      update();
    }
    function update() {
      out.progress.textContent = doneCount() + ' of ' + people.length + ' people rated';
      clear(out.analysis);
      out.analysis.appendChild(heading(4, 'Your map'));
      out.analysis.appendChild(mapBlock(st.ratings, 'Your read'));
      clear(out.submit);
      var all = doneCount() === people.length;
      var err = h('p', { class: 'lab-formerror', role: 'alert' });
      var btn = button('Submit and compare with the author', function () {
        if (!all) { err.textContent = 'Rate everyone first (' + doneCount() + ' of ' + people.length + ' done).'; var first = people.filter(function (p) { return !complete(p.id); })[0]; var c = first && view.querySelector('[data-person="' + first.id + '"] input'); if (c) c.focus(); return; }
        btn.disabled = true;
        out.submit.appendChild(ctx.waitPanel('Loading the author’s read…'));
        ctx.reveal().then(function (full) {
          if (ctx.destroyed) return;
          fullCfg = full; finished = true; ctx.saveNow(); render('.lab-h--results');
          ctx.announce('Submitted. ' + summary().label + '.');
        }, function () { if (ctx.destroyed) return; update(); out.submit.appendChild(ctx.errorPanel('The author’s read could not be loaded. Try again in a moment.')); });
      }, 'primary');
      out.submit.appendChild(h('div', { class: 'lab-actions' }, btn));
      out.submit.appendChild(err);
    }

    function mapBlock(ratings, who) {
      var wrap = h('div', { class: 'lab-map' });
      var A = M.stakeholderAnalysis(people, ratings, ties);
      wrap.appendChild(grid(ratings, A, who));
      wrap.appendChild(metrics([
        { k: 'Supporting power', v: String(A.supportPower), note: plural(A.supporters.length, 'person', 'people') },
        { k: 'Opposing power', v: String(A.opposePower), note: plural(A.opponents.length, 'person', 'people') },
        { k: 'Neutral power', v: String(A.neutralPower), note: plural(A.neutrals.length, 'person', 'people') },
      ], 'lab-metrics--compact'));
      var notes = h('ul', { class: 'lab-list' });
      notes.appendChild(h('li', { text: A.highPowerNeutrals.length ? 'High-power neutrals: ' + A.highPowerNeutrals.map(nameOf).join(', ') + '. Where they land may decide the outcome.' : 'No high-power neutrals.' }));
      notes.appendChild(h('li', { text: A.brokers.length ? 'Brokers (ties to both camps): ' + A.brokers.map(nameOf).join(', ') + '.' : 'No brokers: no one has non-rival ties to both camps.' }));
      if (A.rivalries.length) notes.appendChild(h('li', { text: 'Rivalries across camps: ' + A.rivalries.map(function (pr) { return nameOf(pr[0]) + ' – ' + nameOf(pr[1]); }).join('; ') + '.' }));
      wrap.appendChild(notes);
      var eng = h('div', { class: 'lab-engage' }, heading(5, 'Engagement by quadrant (practitioner heuristic)'));
      ['hh', 'hl', 'lh', 'll'].forEach(function (q) {
        var inQ = A.rated.filter(function (p) { return quadrant(ratings[p.id]) === q; });
        if (!inQ.length) return;
        eng.appendChild(h('div', { class: 'lab-engage-q' }, h('p', null, h('strong', { text: QUADRANTS[q].name + ': ' }), h('span', { text: inQ.map(function (p) { return nameOf(p) + ' (' + stanceWord(ratings[p.id].stance).toLowerCase() + ')'; }).join(', ') })),
          h('p', { class: 'lab-hint', text: QUADRANTS[q].text })));
      });
      wrap.appendChild(eng);
      return wrap;
    }

    function grid(ratings, A, who) {
      var W = 360, H = 360, m = { l: 44, r: 14, t: 14, b: 44 };
      function x(v) { return m.l + (v - 0.5) / 5 * (W - m.l - m.r); }
      function y(v) { return H - m.b - (v - 0.5) / 5 * (H - m.t - m.b); }
      var tid = uid('t'), did = uid('d');
      var desc = A.rated.map(function (p) { var r = ratings[p.id]; return nameOf(p) + ': power ' + r.power + ', interest ' + r.interest + ', ' + stanceWord(r.stance).toLowerCase() + ' (' + QUADRANTS[quadrant(r)].name.toLowerCase() + ')'; }).join('; ');
      var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'lab-chart lab-chart--square', role: 'img', 'aria-labelledby': tid + ' ' + did },
        sv('title', { id: tid, text: who + ': power–interest grid' }), sv('desc', { id: did, text: desc ? desc + '.' : 'No one rated yet.' }));
      [1, 2, 3, 4, 5].forEach(function (v) {
        svg.appendChild(sv('text', { x: x(v), y: H - m.b + 16, class: 'lab-tick', 'text-anchor': 'middle', text: v }));
        svg.appendChild(sv('text', { x: m.l - 8, y: y(v) + 4, class: 'lab-tick', 'text-anchor': 'end', text: v }));
      });
      svg.appendChild(sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'lab-frame' }));
      svg.appendChild(sv('line', { x1: x(2.5), x2: x(2.5), y1: m.t, y2: H - m.b, class: 'lab-ref lab-ref--dashed' }));
      svg.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: y(2.5), y2: y(2.5), class: 'lab-ref lab-ref--dashed' }));
      [['Keep satisfied', x(0.6), y(5.35), 'start'], ['Manage closely', x(5.4), y(5.35), 'end'], ['Monitor', x(0.6), y(0.75), 'start'], ['Keep informed', x(5.4), y(0.75), 'end']].forEach(function (q) {
        svg.appendChild(sv('text', { x: q[1], y: q[2], class: 'lab-quadlabel', 'text-anchor': q[3], text: q[0] }));
      });
      svg.appendChild(sv('text', { x: (m.l + W - m.r) / 2, y: H - 6, class: 'lab-axislabel', 'text-anchor': 'middle', text: 'Interest' }));
      svg.appendChild(sv('text', { x: 12, y: (m.t + H - m.b) / 2, class: 'lab-axislabel', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + H - m.b) / 2 + ')', text: 'Power' }));
      var groups = {};
      A.rated.forEach(function (p) { var r = ratings[p.id], k = r.power + ',' + r.interest; (groups[k] = groups[k] || []).push(p); });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        g.forEach(function (p, i) {
          var r = ratings[p.id], ang = g.length > 1 ? (i / g.length) * 2 * Math.PI : 0, rad = g.length > 1 ? 13 : 0;
          var cx = x(r.interest) + Math.cos(ang) * rad, cy = y(r.power) + Math.sin(ang) * rad;
          svg.appendChild(markerShape(cx, cy, r.stance));
          svg.appendChild(sv('text', { x: cx + 8, y: cy - 6, class: 'lab-pointlabel', text: initials(p) }));
        });
      });
      var legend = h('ul', { class: 'lab-legend-list' }, STANCES.map(function (s) {
        return h('li', null, sv('svg', { viewBox: '0 0 16 16', width: 16, height: 16, class: 'lab-swatch', 'aria-hidden': 'true', focusable: 'false' }, markerShape(8, 8, s.v)), ' ' + signed(s.v) + ' ' + s.label);
      }));
      var keyTable = table({ caption: who + ': the grid as a table', headers: ['Person', 'Label', { text: 'Power', num: true }, { text: 'Interest', num: true }, 'Stance', 'Quadrant'], rowHeader: true,
        rows: A.rated.map(function (p) { var r = ratings[p.id]; return [nameOf(p), initials(p), { text: String(r.power), num: true }, { text: String(r.interest), num: true }, signed(r.stance) + ' ' + stanceWord(r.stance), QUADRANTS[quadrant(r)].name]; }) });
      return h('figure', { class: 'lab-figure lab-figure--grid' }, svg, legend,
        h('figcaption', { class: 'lab-figcaption', text: 'Each person is labelled with their initials. Shape shows stance: triangles up for supporters, triangles down for opponents, circles for neutrals; filled shapes are strong positions. People with identical ratings are spread around the shared point.' }),
        h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Show the grid as a table' }), keyTable));
    }
    function markerShape(cx, cy, stance) {
      var strong = Math.abs(stance) === 2, cls = 'lab-shape' + (strong ? ' lab-shape--filled' : '');
      if (stance > 0) return sv('path', { d: 'M' + cx + ' ' + (cy - 6) + ' L' + (cx + 6) + ' ' + (cy + 5) + ' L' + (cx - 6) + ' ' + (cy + 5) + ' Z', class: cls });
      if (stance < 0) return sv('path', { d: 'M' + cx + ' ' + (cy + 6) + ' L' + (cx + 6) + ' ' + (cy - 5) + ' L' + (cx - 6) + ' ' + (cy - 5) + ' Z', class: cls });
      return sv('circle', { cx: cx, cy: cy, r: 5, class: 'lab-shape' });
    }

    function renderFinished() {
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Your read and the author’s'));
      if (!fullCfg) {
        sec.appendChild(ctx.waitPanel('Loading the author’s read…'));
        view.appendChild(sec);
        ctx.reveal().then(function (full) { if (ctx.destroyed) return; fullCfg = full; render(); }, function () {
          if (ctx.destroyed) return; clear(sec); sec.appendChild(ctx.errorPanel('The author’s read could not be loaded.', function () { render(); })); sec.appendChild(ctx.startAgain(again));
        });
        return;
      }
      var a = authorRatings(), aR = {};
      people.forEach(function (p) { if (a[p.id]) aR[p.id] = { power: a[p.id].power, interest: a[p.id].interest, stance: a[p.id].stance }; });
      var rows = [], gaps = [];
      people.forEach(function (p) {
        var r = rating(p.id), k = a[p.id];
        if (!k) return;
        var dP = r.power - k.power, dI = r.interest - k.interest, dS = r.stance - k.stance;
        gaps.push({ p: p, g: Math.abs(dP) + Math.abs(dI) + Math.abs(dS), dS: dS });
        rows.push([nameOf(p), r.power + ' / ' + k.power + (dP ? ' (' + signed(dP) + ')' : ''), r.interest + ' / ' + k.interest + (dI ? ' (' + signed(dI) + ')' : ''),
          signed(r.stance) + ' / ' + signed(k.stance) + (dS ? ' (' + signed(dS) + ')' : ''), QUADRANTS[quadrant(r)].name + (quadrant(r) !== quadrant(k) ? ' / ' + QUADRANTS[quadrant(k)].name : ' (same)')]);
      });
      sec.appendChild(table({ caption: 'You / the author (difference = yours − author’s)', headers: ['Person', 'Power', 'Interest', 'Stance', 'Quadrant'], rowHeader: true, rows: rows }));
      gaps.sort(function (x, y) { return y.g - x.g; });
      var big = gaps.filter(function (g) { return g.g >= 2; }).slice(0, 4);
      var campMiss = gaps.filter(function (g) { return camp(rating(g.p.id).stance) !== camp(a[g.p.id].stance); });
      var ul = h('ul', { class: 'lab-list' });
      ul.appendChild(h('li', { text: big.length ? 'Largest differences: ' + big.map(function (g) { return nameOf(g.p) + ' (' + g.g + ' points across the three ratings)'; }).join(', ') + '.' : 'Your ratings are within one point of the author’s on almost every dimension.' }));
      ul.appendChild(h('li', { text: campMiss.length ? 'You placed ' + campMiss.map(function (g) { return nameOf(g.p); }).join(', ') + ' in a different camp (support / neutral / opposition) from the author.' : 'You and the author agree on every person’s camp.' }));
      sec.appendChild(ul);
      var two = h('div', { class: 'lab-compare' }, h('div', null, heading(5, 'Your map'), mapBlock(st.ratings, 'Your read')), h('div', null, heading(5, 'The author’s map'), mapBlock(aR, 'The author’s read')));
      sec.appendChild(two);
      sec.appendChild(heading(5, 'The author’s reasoning'));
      var rl = h('ul', { class: 'lab-reviewlist' });
      people.forEach(function (p) { var k = a[p.id]; if (k && k.why) rl.appendChild(h('li', { class: 'lab-reviewitem' }, h('p', { class: 'lab-review-q', text: nameOf(p) + (p.title ? ', ' + str(p.title) : '') }), h('p', { html: ctx.inline(k.why) }))); });
      sec.appendChild(rl);
      sec.appendChild(ctx.startAgain(again));
      view.appendChild(sec);
    }
    function again() { st = fresh(summary()); finished = false; ctx.saveNow(); render('.lab-person-name'); ctx.announce('Started again with blank ratings. Your submitted map is kept until you submit again.'); }
    render();
  };

  /* ===================================================================== 9. issues */

  var SEV_RANK = { high: 0, medium: 1, low: 2 };
  var SEV_WEIGHT = { high: 3, medium: 2, low: 1 };

  /** Matches flags to key issues by clause + category (pure; used by the engine and the tests). */
  M.issueScore = function (flags, keyIssues) {
    var found = [], missed = [], matchedFlags = {};
    keyIssues.forEach(function (ki, idx) {
      var hits = flags.filter(function (f) { return f.clause === ki.clause && f.category === ki.category; });
      hits.forEach(function (f) { matchedFlags[f.id] = idx; });
      (hits.length ? found : missed).push({ issue: ki, flags: hits });
    });
    var unmatched = flags.filter(function (f) { return !(f.id in matchedFlags); });
    var w = function (list) { return sum(list.map(function (x) { return SEV_WEIGHT[x.issue.severity] || 1; })); };
    return {
      found: found, missed: missed, unmatched: unmatched,
      precision: flags.length ? (flags.length - unmatched.length) / flags.length : null,
      recall: keyIssues.length ? found.length / keyIssues.length : null,
      weightedRecall: keyIssues.length ? w(found) / (w(found) + w(missed)) : null,
    };
  };

  ENGINES.issues = function (ctx) {
    var cfg = ctx.cfg, doc = obj(cfg.document);
    var clauses = arr(doc.clauses).filter(function (c) { return c && c.id; });
    var cats = arr(cfg.categories).filter(function (c) { return c && c.id; });
    function clauseOf(id) { return clauses.filter(function (c) { return c.id === id; })[0] || null; }
    function catLabel(id) { var c = cats.filter(function (x) { return x.id === id; })[0]; return c ? str(c.label) : id; }
    function fresh(prev) { return { v: 1, flags: [], seq: 1, previous: prev || null }; }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      var seenPair = {};
      st.flags = arr(s0.flags).filter(function (f) {
        if (!f || !clauseOf(f.clause) || !cats.some(function (c) { return c.id === f.category; })) return false;
        var k = f.clause + '|' + f.category; if (seenPair[k]) return false; seenPair[k] = 1; return true;
      }).map(function (f) { return { id: str(f.id) || 'f' + Math.random().toString(36).slice(2, 8), clause: f.clause, category: f.category, note: str(f.note).slice(0, 2000) }; });
      st.seq = Math.max(st.flags.length + 1, Math.round(num(s0.seq, 1)));
      finished = !!ctx.saved.finished;
    }
    var fullCfg = null;
    function summary() {
      var met = { Flags: st.flags.length };
      if (finished && fullCfg) {
        var S = M.issueScore(st.flags, arr(obj(fullCfg.key).issues));
        met['Issues found'] = S.found.length + '/' + (S.found.length + S.missed.length);
        met.Precision = S.precision === null ? 'n/a' : Number(S.precision.toFixed(3));
        met.Recall = S.recall === null ? 'n/a' : Number(S.recall.toFixed(3));
        return { label: 'Found ' + S.found.length + ' of ' + (S.found.length + S.missed.length) + ' issues · precision ' + (S.precision === null ? 'n/a' : pct(S.precision)) + ' · recall ' + pct(S.recall), metrics: met };
      }
      return { label: 'In progress — ' + plural(st.flags.length, 'flag'), metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Flag any clause with an issue category and an optional note. A clause can carry several flags with different categories.',
      'After you submit, a flag matches a key issue when both the clause and the category are the same. Your notes are not scored.',
      'Recall = key issues found ÷ key issues. Precision = flags that match a key issue ÷ your flags. Severity-weighted recall counts high, medium and low issues as 3, 2 and 1.',
      'A flag on a clause that has a key issue under a different category is shown as a near miss. The key is the case author’s list, not an exhaustive legal review: an unmatched flag may still be a fair point.',
      'Educational exercise on a fictional document — not legal advice.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);
    var counter = null;

    function render(focusSel) { clear(view); if (finished) renderFinished(); else renderWork(); if (focusSel) focusEl(view.querySelector(focusSel)); }
    function renderWork() {
      if (cfg.disclaimer) view.appendChild(h('p', { class: 'lab-disclaimer', html: ctx.inline(cfg.disclaimer) }));
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'Read each clause asking: what could go wrong for my side, who decides, what is undefined, and what happens at the end?'));
      view.appendChild(h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: 'Issue categories' }), h('ul', { class: 'lab-list' }, cats.map(function (c) { return h('li', { text: str(c.label) }); }))));
      var docEl = h('section', { class: 'lab-document' });
      docEl.appendChild(h('p', { class: 'lab-doc-title', html: ctx.inline(doc.title) }));
      if (doc.parties) docEl.appendChild(h('p', { class: 'lab-doc-parties', html: ctx.inline(doc.parties) }));
      clauses.forEach(function (c) { docEl.appendChild(clauseBlock(c)); });
      view.appendChild(docEl);
      counter = h('p', { class: 'lab-progress' });
      var err = h('div', { class: 'lab-formerror', role: 'alert' });
      var btn = button('Submit and see the issues', function () {
        clear(err);
        if (!st.flags.length) { err.appendChild(h('p', { text: 'Flag at least one clause first.' })); return; }
        btn.disabled = true;
        var w = ctx.waitPanel('Loading the issue list…');
        err.appendChild(w);
        ctx.reveal().then(function (full) {
          if (ctx.destroyed) return;
          fullCfg = full; finished = true; ctx.saveNow(); render('.lab-h--results');
          ctx.announce('Submitted. ' + summary().label + '.');
        }, function () { if (ctx.destroyed) return; btn.disabled = false; clear(err); err.appendChild(ctx.errorPanel('The issue list could not be loaded. Try again in a moment.')); });
      }, 'primary');
      view.appendChild(h('div', { class: 'lab-actions lab-actions--submit' }, btn, counter));
      view.appendChild(err);
      updCounter();
    }
    function updCounter() { if (counter) counter.textContent = plural(st.flags.length, 'flag') + ' on ' + plural(clauses.filter(function (c) { return st.flags.some(function (f) { return f.clause === c.id; }); }).length, 'clause'); }
    function clauseBlock(c) {
      var art = h('article', { class: 'lab-clause' });
      art.setAttribute('data-clause', c.id);
      art.appendChild(h('h5', { class: 'lab-clause-head', html: ctx.inline(c.heading) }));
      art.appendChild(h('p', { class: 'lab-clause-text', html: ctx.inline(c.text) }));
      var flagsEl = h('ul', { class: 'lab-flags', 'aria-label': 'Your flags on this clause' });
      art.appendChild(flagsEl);
      var msg = h('p', { class: 'lab-formerror', role: 'status' });
      var catId = uid('cat'), noteId = uid('note');
      var sel = h('select', { id: catId, class: 'lab-select' }, h('option', { value: '', text: 'Choose a category' }), cats.map(function (x) { return h('option', { value: x.id, text: str(x.label) }); }));
      var note = h('textarea', { id: noteId, class: 'lab-textarea lab-textarea--short', rows: '2', maxlength: '2000' });
      var add = button('Add flag', function () {
        msg.textContent = '';
        if (!sel.value) { msg.textContent = 'Choose a category for this flag.'; sel.focus(); return; }
        if (st.flags.some(function (f) { return f.clause === c.id && f.category === sel.value; })) { msg.textContent = 'This clause already has a flag in that category.'; sel.focus(); return; }
        st.flags.push({ id: 'f' + st.seq, clause: c.id, category: sel.value, note: note.value.slice(0, 2000) });
        st.seq += 1;
        var lab = catLabel(sel.value);
        sel.value = ''; note.value = '';
        drawFlags(); updCounter(); ctx.touch();
        ctx.announce('Flag added: ' + lab + '.');
      }, null, { 'aria-label': 'Add flag to ' + plainText(c.heading) });
      var form = h('details', { class: 'lab-flagform' }, h('summary', { text: 'Flag an issue in this clause' }),
        h('div', { class: 'lab-field' }, h('label', { for: catId, text: 'Category' }), sel),
        h('div', { class: 'lab-field' }, h('label', { for: noteId, text: 'Note (optional)' }), note),
        h('div', { class: 'lab-actions' }, add), msg);
      art.appendChild(form);
      function drawFlags() {
        clear(flagsEl);
        st.flags.filter(function (f) { return f.clause === c.id; }).forEach(function (f) {
          var li = h('li', { class: 'lab-flag' }, tag('Flag', 'flag'), ' ', h('strong', { text: catLabel(f.category) }));
          if (f.note) li.appendChild(h('span', { class: 'lab-flag-note', text: ' — ' + f.note }));
          li.appendChild(button('Remove', function () {
            st.flags = st.flags.filter(function (x) { return x.id !== f.id; });
            drawFlags(); updCounter(); ctx.touch();
            ctx.announce('Flag removed.');
            focusEl(form.querySelector('summary'));
          }, 'mini', { 'aria-label': 'Remove flag ' + catLabel(f.category) }));
          flagsEl.appendChild(li);
        });
      }
      drawFlags();
      return art;
    }
    function plainText(s) { return str(s).replace(/\*+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); }

    function renderFinished() {
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Issues found and missed'));
      if (!fullCfg) {
        sec.appendChild(ctx.waitPanel('Loading the issue list…'));
        view.appendChild(sec);
        ctx.reveal().then(function (full) { if (ctx.destroyed) return; fullCfg = full; render(); }, function () { if (ctx.destroyed) return; clear(sec); sec.appendChild(ctx.errorPanel('The issue list could not be loaded.', function () { render(); })); sec.appendChild(ctx.startAgain(again)); });
        return;
      }
      var keyIssues = arr(obj(fullCfg.key).issues).filter(function (i) { return i && clauseOf(i.clause); });
      var S = M.issueScore(st.flags, keyIssues);
      sec.appendChild(metrics([
        { k: 'Issues found (recall)', v: S.found.length + ' of ' + keyIssues.length + ' (' + pct(S.recall) + ')' },
        { k: 'Flags that matched (precision)', v: (st.flags.length - S.unmatched.length) + ' of ' + st.flags.length + ' (' + (S.precision === null ? 'n/a' : pct(S.precision)) + ')' },
        { k: 'Severity-weighted recall', v: pct(S.weightedRecall), note: 'High = 3, medium = 2, low = 1' },
      ]));
      function sevTag(s) { var w = str(s) || 'unrated'; return tag(w.charAt(0).toUpperCase() + w.slice(1) + ' severity', w === 'high' ? 'problem' : w === 'medium' ? 'caution' : 'note'); }
      function issueItem(x, foundIt) {
        var ki = x.issue, c = clauseOf(ki.clause);
        var li = h('li', { class: 'lab-reviewitem' },
          h('p', { class: 'lab-review-a' }, tag(foundIt ? 'Found' : 'Missed', foundIt ? 'ok' : 'problem'), ' ', sevTag(ki.severity), ' ', h('span', { html: ctx.inline(c.heading) }), h('span', { text: ' — ' + catLabel(ki.category) })));
        if (ki.explanation) li.appendChild(h('p', { html: ctx.inline(ki.explanation) }));
        if (ki.ask) li.appendChild(h('p', { class: 'lab-ask' }, h('span', { class: 'lab-label lab-label--inline', text: 'Ask' }), ' ', h('span', { html: ctx.inline(ki.ask) })));
        x.flags.forEach(function (f) { if (f.note) li.appendChild(h('p', { class: 'lab-flag-note' }, h('span', { class: 'lab-label lab-label--inline', text: 'Your note' }), ' ', h('span', { text: f.note }))); });
        return li;
      }
      var bySev = function (a, b) { return (SEV_RANK[a.issue.severity] !== undefined ? SEV_RANK[a.issue.severity] : 3) - (SEV_RANK[b.issue.severity] !== undefined ? SEV_RANK[b.issue.severity] : 3); };
      sec.appendChild(heading(5, 'Found (' + S.found.length + ')'));
      sec.appendChild(S.found.length ? h('ul', { class: 'lab-reviewlist' }, S.found.slice().sort(bySev).map(function (x) { return issueItem(x, true); })) : h('p', { class: 'lab-hint', text: 'None.' }));
      sec.appendChild(heading(5, 'Missed (' + S.missed.length + ')'));
      sec.appendChild(S.missed.length ? h('ul', { class: 'lab-reviewlist' }, S.missed.slice().sort(bySev).map(function (x) { return issueItem(x, false); })) : h('p', { class: 'lab-hint', text: 'None — you found every issue on the list.' }));
      sec.appendChild(heading(5, 'Flags with no matching issue (' + S.unmatched.length + ')'));
      if (S.unmatched.length) {
        sec.appendChild(h('ul', { class: 'lab-reviewlist' }, S.unmatched.map(function (f) {
          var c = clauseOf(f.clause), same = keyIssues.filter(function (ki) { return ki.clause === f.clause; });
          var li = h('li', { class: 'lab-reviewitem' }, h('p', { class: 'lab-review-a' }, tag(same.length ? 'Near miss' : 'Unmatched', same.length ? 'caution' : 'note'), ' ', h('span', { html: ctx.inline(c.heading) }), h('span', { text: ' — your category: ' + catLabel(f.category) })));
          li.appendChild(h('p', { class: 'lab-hint', text: same.length ? 'The key lists this clause under ' + same.map(function (k) { return catLabel(k.category); }).join(', ') + '.' : 'The key lists no issue in this clause. Your point may still be reasonable; the key is not exhaustive.' }));
          if (f.note) li.appendChild(h('p', { class: 'lab-flag-note' }, h('span', { class: 'lab-label lab-label--inline', text: 'Your note' }), ' ', h('span', { text: f.note })));
          return li;
        })));
      } else sec.appendChild(h('p', { class: 'lab-hint', text: 'None — every flag matched an issue.' }));
      if (cfg.disclaimer) sec.appendChild(h('p', { class: 'lab-disclaimer', html: ctx.inline(cfg.disclaimer) }));
      sec.appendChild(ctx.startAgain(again));
      view.appendChild(sec);
    }
    function again() { st = fresh(summary()); finished = false; ctx.saveNow(); render('.lab-clause-head'); ctx.announce('Started again with no flags. Your submitted result is kept until you submit again.'); }
    render();
  };

  /* ===================================================================== 10. composer */

  ENGINES.composer = function (ctx) {
    var cfg = ctx.cfg;
    var formats = arr(cfg.formats).filter(function (f) { return f && f.id; });
    var checklist = arr(cfg.checklist).filter(Boolean);
    function fresh(prev) {
      var d = {}, c = {};
      formats.forEach(function (f) { d[f.id] = ''; c[f.id] = checklist.map(function () { return false; }); });
      return { v: 1, drafts: d, checks: c, tab: formats.length ? formats[0].id : null, previous: prev || null };
    }
    var st = fresh(), finished = false;
    if (ctx.saved) {
      var s0 = obj(ctx.saved.state);
      st = fresh(s0.previous || null);
      formats.forEach(function (f) {
        st.drafts[f.id] = str(obj(s0.drafts)[f.id]).slice(0, 100000);
        var c = arr(obj(s0.checks)[f.id]);
        st.checks[f.id] = checklist.map(function (_, i) { return c[i] === true; });
      });
      if (formats.some(function (f) { return f.id === s0.tab; })) st.tab = s0.tab;
      finished = !!ctx.saved.finished;
    }
    function range(f) { var w = arr(f.words); return [num(w[0], 0), num(w[1], Infinity)]; }
    function summary() {
      var met = {}, parts = [];
      formats.forEach(function (f) { var n = M.textMetrics(st.drafts[f.id], f.wpm).words; met[str(f.label) + ' — words'] = n; if (n) parts.push(str(f.label) + ' ' + n + ' words'); met[str(f.label) + ' — checklist'] = st.checks[f.id].filter(Boolean).length + '/' + checklist.length; });
      return { label: (finished ? 'Drafts complete' : 'Drafting') + (parts.length ? ' — ' + parts.join(' · ') : ' — no text yet'), metrics: met };
    }
    ctx.setPayload(function () { return { state: st, finished: finished, summary: summary() }; });

    ctx.body.appendChild(ctx.rulesPanel([
      'Words: runs of letters or digits (apostrophes, hyphens and periods inside a word keep it whole, so “p.m.” and “3.5” count as one word). Compared with each format’s range.',
      'Speaking time = words ÷ words per minute (the format’s rate, or 150 when none is given).',
      'Sentences: each line is split at . ! or ? followed by a space and a capital letter, digit or quotation mark; common abbreviations (e.g., i.e., Dr., U.S.) and initials do not end a sentence. A line with no closing punctuation and fewer than 8 words counts as a heading and is skipped. Bullets count as their own sentences.',
      'Long sentences: more than 25 words. Shown as a share of all sentences.',
      'Hedge words (counted wherever they appear, whole words only): ' + M.HEDGES.join(', ') + '. Some are fine — a calibrated probability is not a hedge. The count only flags words to review.',
      'Passive-voice heuristic: ' + M.PASSIVE_RULE,
      'Sections reminder: a section counts as present when a line begins with its name (ignoring case, #, * and numbering).',
      'Nothing here grades the content of your writing. The checklist is a self-check that you tick.',
    ]));
    var view = h('div', { class: 'lab-view' });
    ctx.body.appendChild(view);

    function render(focusSel) { clear(view); if (finished) renderFinished(); else renderWork(); if (focusSel) focusEl(view.querySelector(focusSel)); }
    function renderWork() {
      if (cfg.scenario) view.appendChild(ctx.rich(h('div', { class: 'lab-brief' }), cfg.scenario));
      if (arr(cfg.audience).length) view.appendChild(table({ caption: 'Audience', headers: ['Who', 'What they care about'], rowHeader: true, rows: arr(cfg.audience).map(function (a) { return [{ html: ctx.inline(a && a.who) }, { html: ctx.inline(a && a.cares) }]; }) }));
      if (ctx.mode === 'foundation') view.appendChild(foundationNote(ctx, 'Metrics describe form, not quality. Use them to spot a buried recommendation, a sentence that runs on, or a draft far outside its length.'));
      var tabs = h('div', { class: 'lab-tabs', role: 'tablist', 'aria-label': 'Formats' });
      var panels = h('div', { class: 'lab-tabpanels' });
      var tabEls = [];
      formats.forEach(function (f) {
        var tid = uid('tab'), pid = uid('panel');
        var t = h('button', { type: 'button', role: 'tab', id: tid, class: 'lab-tab', 'aria-controls': pid, 'aria-selected': String(st.tab === f.id), tabindex: st.tab === f.id ? '0' : '-1', text: str(f.label) });
        t.addEventListener('click', function () { select(f.id, false); });
        t.addEventListener('keydown', function (e) {
          var i = tabEls.indexOf(t), n = tabEls.length, j = null;
          if (e.key === 'ArrowRight') j = (i + 1) % n; else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = n - 1;
          if (j !== null) { e.preventDefault(); select(formats[j].id, true); }
        });
        tabEls.push(t);
        tabs.appendChild(t);
        var p = h('div', { role: 'tabpanel', id: pid, 'aria-labelledby': tid, class: 'lab-tabpanel', hidden: st.tab !== f.id });
        p.setAttribute('data-format', f.id);
        buildPanel(p, f);
        panels.appendChild(p);
      });
      function select(id, focus) {
        st.tab = id;
        formats.forEach(function (f, i) {
          var on = f.id === id;
          tabEls[i].setAttribute('aria-selected', String(on)); tabEls[i].setAttribute('tabindex', on ? '0' : '-1');
          panels.children[i].hidden = !on;
          if (on && focus) tabEls[i].focus();
        });
        ctx.touch();
      }
      if (formats.length > 1) view.appendChild(tabs);
      view.appendChild(panels);
      view.appendChild(h('div', { class: 'lab-actions' }, button('Mark drafts complete', function () {
        finished = true; ctx.saveNow(); render('.lab-h--results'); ctx.announce('Drafts marked complete. ' + summary().label + '.');
      }, 'primary')));
    }
    function buildPanel(p, f) {
      var rg = range(f), wpm = num(f.wpm, 0) > 0 ? f.wpm : 150;
      p.appendChild(h('p', { class: 'lab-hint', text: 'Target ' + rg[0] + '–' + rg[1] + ' words · speaking rate ' + wpm + ' words per minute' + (f.wpm ? '' : ' (default)') }));
      var secList = arr(f.sections);
      var secEl = secList.length ? h('ul', { class: 'lab-sectionlist', 'aria-label': 'Sections for this format' }) : null;
      if (secEl) p.appendChild(h('div', { class: 'lab-sections' }, label('Sections'), secEl));
      var id = uid('draft');
      var ta = h('textarea', { id: id, class: 'lab-textarea lab-textarea--draft', rows: f.id === 'verbal' || rg[1] < 250 ? '8' : '16', spellcheck: 'true', value: st.drafts[f.id] });
      p.appendChild(h('div', { class: 'lab-field' }, h('label', { for: id, text: 'Draft — ' + str(f.label) }), ta));
      var mEl = h('div', { class: 'lab-textmetrics', 'aria-live': 'off' });
      p.appendChild(mEl);
      var copyMsg = h('span', { class: 'lab-hint', role: 'status' });
      p.appendChild(h('div', { class: 'lab-actions' }, button('Copy draft', function () { copyDraft(ta, copyMsg); }), copyMsg,
        button('Read the metrics aloud', function () { ctx.announce(metricSentence(f)); }, 'quiet')));
      if (checklist.length) {
        var fs = h('fieldset', { class: 'lab-fieldset' }, h('legend', { class: 'lab-legend', text: 'Self-check — ' + str(f.label) }));
        checklist.forEach(function (c, i) {
          var cid = uid('chk');
          var cb = h('input', { type: 'checkbox', id: cid, checked: st.checks[f.id][i] });
          cb.addEventListener('change', function () { st.checks[f.id][i] = cb.checked; ctx.touch(); });
          fs.appendChild(h('div', { class: 'lab-field lab-field--check' }, cb, h('label', { for: cid, html: ctx.inline(c) })));
        });
        p.appendChild(fs);
      }
      var raf = null;
      function upd() { raf = null; drawMetrics(mEl, f); drawSections(secEl, f); }
      ta.addEventListener('input', function () {
        st.drafts[f.id] = ta.value;
        ctx.touch();
        if (raf === null) raf = ctx.later(upd, 120);
      });
      upd();
    }
    function sectionPresent(text, name) {
      var n = str(name).toLowerCase().trim();
      return str(text).split(/\n/).some(function (line) { return line.replace(/^[\s#*\-•]*(\d+[.)]\s*)?/, '').toLowerCase().indexOf(n) === 0; });
    }
    function drawSections(el, f) {
      if (!el) return;
      clear(el);
      arr(f.sections).forEach(function (s) {
        var ok = sectionPresent(st.drafts[f.id], s);
        el.appendChild(h('li', { class: 'lab-sectionitem' }, tag(ok ? 'Present' : 'Not yet', ok ? 'ok' : 'note'), ' ', h('span', { text: str(s) })));
      });
    }
    function mmss(min) { var s = Math.round(min * 60); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
    function metricSentence(f) {
      var m = M.textMetrics(st.drafts[f.id], f.wpm), rg = range(f);
      return str(f.label) + ': ' + m.words + ' words (target ' + rg[0] + '–' + rg[1] + '), about ' + mmss(m.minutes) + ' spoken, ' + m.sentences + ' sentences averaging ' + fixed(m.meanSentence, 1) + ' words, ' + m.hedgeCount + ' hedge words, ' + m.passiveSentences + ' sentences with a passive-voice match.';
    }
    function drawMetrics(el, f) {
      clear(el);
      var m = M.textMetrics(st.drafts[f.id], f.wpm), rg = range(f);
      var rangeNote = m.words < rg[0] ? 'Under the range by ' + (rg[0] - m.words) : m.words > rg[1] ? 'Over the range by ' + (m.words - rg[1]) : 'Within the range';
      el.appendChild(metrics([
        { k: 'Words', v: grouped(m.words) + ' (target ' + rg[0] + '–' + rg[1] + ')', note: rangeNote, cls: m.words > rg[1] || (m.words && m.words < rg[0]) ? 'lab-metric--alert' : '' },
        { k: 'Speaking time', v: mmss(m.minutes), note: 'at ' + m.wpm + ' words per minute' },
        { k: 'Sentences', v: String(m.sentences), note: 'Mean ' + fixed(m.meanSentence, 1) + ' words · longest ' + m.longestSentence },
        { k: 'Over 25 words', v: m.sentences ? pct(m.longShare) : '—', note: plural(m.longCount, 'sentence') },
        { k: 'Hedge words', v: String(m.hedgeCount), note: m.hedges.length ? m.hedges.map(function (x) { return x.word + (x.count > 1 ? ' ×' + x.count : ''); }).join(', ') : 'None found' },
        { k: 'Passive-voice matches', v: String(m.passiveSentences) + ' sentence' + (m.passiveSentences === 1 ? '' : 's'), note: m.passive.length ? m.passive.slice(0, 6).map(function (x) { return '“' + x + '”'; }).join(', ') + (m.passive.length > 6 ? ' …' : '') : 'None found' },
      ], 'lab-metrics--compact'));
    }
    function copyDraft(ta, msg) {
      var text = ta.value;
      function ok() { msg.textContent = 'Draft copied.'; ctx.announce('Draft copied to the clipboard.'); }
      function fail() { ta.focus(); ta.select(); msg.textContent = 'Copy blocked by the browser — the draft is selected; press Ctrl+C or ⌘C.'; }
      try {
        if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { legacy() ? ok() : fail(); });
        else if (legacy()) ok(); else fail();
      } catch (e) { fail(); }
      function legacy() { try { ta.focus(); ta.select(); return document.execCommand && document.execCommand('copy'); } catch (e) { return false; } }
    }
    function renderFinished() {
      var sec = h('section', { class: 'lab-section lab-results' }, resultsHeading('Drafts marked complete'));
      sec.appendChild(table({ caption: 'Your drafts by format', headers: ['Format', { text: 'Words', num: true }, 'Target', { text: 'Speaking time', num: true }, { text: 'Sentences', num: true }, { text: 'Checklist', num: true }], rowHeader: true,
        rows: formats.map(function (f) { var m = M.textMetrics(st.drafts[f.id], f.wpm), rg = range(f); return [str(f.label), { text: grouped(m.words), num: true }, rg[0] + '–' + rg[1], { text: mmss(m.minutes), num: true }, { text: String(m.sentences), num: true }, { text: st.checks[f.id].filter(Boolean).length + '/' + checklist.length, num: true }]; }) }));
      formats.forEach(function (f) {
        if (!st.drafts[f.id]) return;
        var msg = h('span', { class: 'lab-hint', role: 'status' });
        var ta = h('textarea', { class: 'lab-textarea lab-textarea--draft', rows: '8', readOnly: true, value: st.drafts[f.id], 'aria-label': str(f.label) + ' (read only)' });
        sec.appendChild(h('details', { class: 'lab-tabledisclosure' }, h('summary', { text: str(f.label) + ' — read your draft' }), ta, h('div', { class: 'lab-actions' }, button('Copy draft', function () { copyDraft(ta, msg); }), msg)));
      });
      sec.appendChild(h('div', { class: 'lab-actions' }, button('Revise drafts', function () { finished = false; ctx.touch(); render('.lab-tab[aria-selected="true"], .lab-textarea'); ctx.announce('Editing your drafts again.'); })));
      sec.appendChild(ctx.startAgain(function () { st = fresh(summary()); finished = false; ctx.saveNow(); render('.lab-textarea'); ctx.announce('All drafts cleared.'); }, 'This clears every draft and checklist in this exercise. Copy anything you want to keep first.'));
      view.appendChild(sec);
    }
    render();
  };


  /* ===================================================================== mount */

  function mount(container, options) {
    var opts = obj(options);
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('ApertureLabs.mount: a container element is required');
    var ctx = makeContext(container, opts);
    var run = ENGINES[opts.engine];
    if (typeof run !== 'function') {
      ctx.body.appendChild(h('p', { class: 'lab-error', role: 'alert', text: 'Unknown lab engine: ' + str(opts.engine) }));
    } else {
      try { run(ctx); } catch (err) {
        if (typeof console !== 'undefined') console.error('[ApertureLabs] the ' + opts.engine + ' engine could not start', err);
        clear(ctx.body).appendChild(h('p', { class: 'lab-error', role: 'alert', text: 'This lab could not start. Its configuration may be incomplete.' }));
      }
    }
    var done = false;
    return { destroy: function () { if (done) return; done = true; ctx.destroy(); } };
  }

  global.ApertureLabs = { engines: ENGINES, mount: mount, math: M, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : globalThis);
