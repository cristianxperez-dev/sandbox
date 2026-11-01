/* APERTURE — core: API client, safe rendering, content blocks, learner state, settings.
   Security: authored text is rendered through inline() (escape first, then a tiny markup set);
   learner text only ever goes through textContent / value. No eval, no inline handlers. */
(function () {
  'use strict';
  const AP = (window.AP = { cache: {}, state: {}, settings: null });

  /* ---------------- API ---------------- */
  class ApiError extends Error { constructor(status, body) { super((body && body.message) || `HTTP ${status}`); this.status = status; this.body = body || {}; } }
  AP.ApiError = ApiError;
  // Public beta is the default: only an explicit "server" mode uses the protected API.
  AP.local = () => !(window.APERTURE_CONFIG && window.APERTURE_CONFIG.mode === 'server');
  // If server mode is selected but the secure backend is not configured, fall back to the
  // public beta instead of stranding the learner on a "not configured" screen.
  AP.fallbackToLocal = function () {
    window.APERTURE_CONFIG = { mode: 'local' };
    if (!window.__apertureLocal) { let res, rej; const pr = new Promise((a, b) => { res = a; rej = b; }); pr.catch(() => {}); window.__apertureLocal = { promise: pr, resolve: res, reject: rej }; }
    if (!document.querySelector('script[src^="local.js"]')) { const sc = document.createElement('script'); sc.type = 'module'; sc.src = 'local.js'; document.head.appendChild(sc); }
  };
  AP.api = async function (path, opts = {}) {
    if (AP.local()) {
      if (!window.__apertureLocal) AP.fallbackToLocal();
      let L;
      try { L = await window.__apertureLocal.promise; } catch (e) { throw new ApiError(0, { error: 'content', message: e.message || 'APERTURE could not load its course content.' }); }
      let r;
      try { r = await L.api(path, opts); } catch (e) { throw new ApiError(e.status || 500, { error: 'local', message: e.message }); }
      if (r.status !== 200) throw new ApiError(r.status, r.data);
      return r.data;
    }
    return serverApi(path, opts);
  };
  async function serverApi(path, { method = 'GET', body, params } = {}) {
    let url = `api/${path}`;
    if (params) url += '?' + new URLSearchParams(params).toString();
    const init = { method, credentials: 'same-origin', headers: { 'X-Aperture': '1', Accept: 'application/json' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, init); } catch (e) { throw new ApiError(0, { error: 'offline', message: 'APERTURE could not reach its server. Check your connection.' }); }
    let data = null;
    const type = res.headers.get('Content-Type') || '';
    if (type.includes('application/json')) data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data || { error: res.status === 404 ? 'not_found' : 'http', message: res.status === 404 ? 'Not found.' : `The server answered ${res.status}.` });
    if (!data) throw new ApiError(res.status, { error: 'not_api', message: 'APERTURE’s server did not answer. This copy of the page has no server (for example the GitHub Pages mirror).' });
    return data;
  }
  AP.get = async function (key, path, params) {
    const k = key || path + JSON.stringify(params || {});
    if (AP.cache[k]) return AP.cache[k];
    const p = AP.api(path, { params });
    AP.cache[k] = p;
    try { return await p; } catch (e) { delete AP.cache[k]; throw e; }
  };
  AP.catalog = () => AP.get('catalog', 'catalog');
  AP.week = (id) => AP.get(`week:${id}`, 'week', { id });
  AP.library = () => AP.get('library', 'library');

  /* ---------------- DOM helpers ---------------- */
  AP.h = function h(tag, attrs, ...kids) {
    const el = document.createElementNS(/^(svg|path|circle|line|rect|text|g|polyline|polygon|title)$/.test(tag) ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'html') el.innerHTML = v; // only ever fed by inline(), which escapes
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'open') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  };
  const h = AP.h;
  AP.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  AP.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Authored inline markup → safe HTML.
  AP.inline = function (text) {
    let s = AP.esc(text);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, target) => {
      let href = null;
      if (/^R-[a-z0-9-]+$/.test(target)) href = `#/library/${target}`;
      else if (/^#w\d{2}-l\d$/.test(target)) href = `#/lesson/${target.slice(1)}`;
      else if (/^#w\d{2}$/.test(target)) href = `#/week/${target.slice(1)}`;
      else if (/^#gl:g-[a-z0-9-]+$/.test(target)) href = `#/glossary/${target.slice(4)}`;
      return href ? `<a href="${href}">${label}</a>` : label;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
  };
  AP.plain = (text) => String(text ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1');

  /* ---------------- content blocks ---------------- */
  const KIND_LABEL = { established: 'Established research', original: 'APERTURE explanation', example: 'Illustrative example', application: 'Professional application', hypothesis: 'Speculative hypothesis', contested: 'Contested finding' };
  AP.KIND_LABEL = KIND_LABEL;
  AP.mode = () => (AP.settings && AP.settings.mode) || 'graduate';

  // opts: { section, counter: {n}, forceFoundation }
  AP.blocks = function (el, blocks, opts = {}) {
    const counter = opts.counter || { n: 0 };
    for (const b of blocks || []) el.appendChild(block(b, { ...opts, counter }));
    return el;
  };
  function kindTag(b) {
    if (!b.kind || b.kind === 'original') return null;
    const refs = (b.refs || []).map((r) => `<a href="#/library/${AP.esc(r)}">${AP.esc(shortRef(r))}</a>`).join(', ');
    return h('div', { class: 'kindtag', html: `${KIND_LABEL[b.kind]}${refs ? ' · ' + refs : ''}` });
  }
  function shortRef(id) {
    const r = AP.cache.libIndex && AP.cache.libIndex.get(id);
    if (r) return `${r.authors[0].split(' ').slice(-1)[0]}${r.authors.length > 2 ? ' et al.' : r.authors.length === 2 ? ' & ' + r.authors[1].split(' ').slice(-1)[0] : ''} ${r.year}`;
    const m = id.match(/^R-([a-z0-9]+)-(\d{4})/);
    return m ? `${m[1][0].toUpperCase() + m[1].slice(1)} ${m[2]}` : id;
  }
  AP.shortRef = shortRef;
  function wrap(b, inner, opts) {
    const n = opts.counter.n++;
    const w = h('div', { class: 'blk', dataset: { blk: String(n), sec: opts.section || '' } });
    if (b.kind) w.dataset.kind = b.kind;
    const t = kindTag(b); if (t) w.appendChild(t);
    w.appendChild(inner);
    return w;
  }
  function block(b, opts) {
    switch (b.type) {
      case 'p': return wrap(b, h('p', { html: AP.inline(b.text) }), opts);
      case 'h': return h('h3', { html: AP.inline(b.text) });
      case 'prompt': return h('div', { class: 'prompt', html: AP.inline(b.text) });
      case 'quote': return h('blockquote', { class: 'quote' }, h('span', { html: AP.inline(b.text) }), h('cite', { html: `— <a href="#/library/${AP.esc(b.cite)}">${AP.esc(shortRef(b.cite))}</a>` }));
      case 'list': { const L = h(b.ordered ? 'ol' : 'ul'); b.items.forEach((t) => L.appendChild(h('li', { html: AP.inline(t) }))); return wrap(b, L, opts); }
      case 'table': {
        const t = h('table', null, h('thead', null, h('tr', null, b.headers.map((x) => h('th', { scope: 'col', html: AP.inline(String(x)) })))), h('tbody', null, b.rows.map((r) => h('tr', null, r.map((c) => h('td', { class: typeof c === 'number' ? 'num' : null, html: AP.inline(String(c)) }))))));
        return wrap(b, figure(b, h('div', { class: 'tablewrap' }, t)), opts);
      }
      case 'matrix': {
        const m = h('div', { class: 'matrix', role: 'table', 'aria-label': AP.plain(b.caption || '2 by 2 matrix') });
        m.appendChild(h('div', { class: 'matrix__y', 'aria-hidden': 'true' }, h('span', { text: AP.plain(b.y[0]) }), h('span', { text: AP.plain(b.y[1]) })));
        // top row = high y (cells[1]), then low y (cells[0])
        for (const row of [b.cells[1], b.cells[0]]) for (const c of row) m.appendChild(h('div', { class: 'matrix__cell', role: 'cell', html: AP.inline(c) }));
        m.appendChild(h('div', { class: 'matrix__x', 'aria-hidden': 'true' }, h('span', { text: AP.plain(b.x[0]) }), h('span', { text: AP.plain(b.x[1]) })));
        return wrap(b, figure(b, m, `Vertical axis: ${AP.plain(b.y[0])} (bottom) to ${AP.plain(b.y[1])} (top). Horizontal axis: ${AP.plain(b.x[0])} (left) to ${AP.plain(b.x[1])} (right).`), opts);
      }
      case 'flow': return wrap(b, figure(b, h('div', { class: 'flow' }, b.steps.map((s) => h('div', { class: 'flow__step' }, h('b', { html: AP.inline(s.label) }), s.text ? h('span', { html: AP.inline(s.text) }) : null)))), opts);
      case 'bars': {
        const max = Math.max(...b.items.map((i) => Math.abs(i.value)), 1e-9);
        const g = h('div', { class: 'bars' });
        for (const it of b.items) {
          const fill = h('div', { class: 'bars__fill' }); fill.style.width = `${(Math.abs(it.value) / max) * 100}%`;
          g.append(h('span', { html: AP.inline(it.label) }), h('div', { class: 'bars__track', 'aria-hidden': 'true' }, fill), h('span', { class: 'num', text: `${fmtNum(it.value)}${b.unit || ''}` }));
        }
        return wrap(b, figure(b, g), opts);
      }
      case 'mode': {
        const open = b.mode === AP.mode() || (b.mode === 'foundation' && opts.forceFoundation);
        const label = b.mode === 'foundation' ? 'Foundation' : 'Executive';
        return fold(label, b.title, b.blocks, open, opts);
      }
      case 'depth': return fold('Graduate depth', b.title, b.blocks, AP.mode() !== 'foundation', opts);
      default: return h('div');
    }
  }
  function fold(label, title, blocks, open, opts) {
    const d = h('details', { class: 'fold', open });
    d.appendChild(h('summary', null, h('span', { class: 'label', text: label }), h('b', { html: AP.inline(title) })));
    const body = h('div', { class: 'fold__body' });
    AP.blocks(body, blocks, opts);
    d.appendChild(body);
    return d;
  }
  function figure(b, inner, desc) {
    const f = h('figure', { class: 'figure' });
    if (b.caption) f.appendChild(h('figcaption', { html: AP.inline(b.caption) }));
    f.appendChild(inner);
    if (desc) f.appendChild(h('p', { class: 'sr', text: desc }));
    if (b.note) f.appendChild(h('p', { class: 'note', html: AP.inline(b.note) }));
    return f;
  }
  function fmtNum(v) { return Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100); }
  AP.fmtNum = fmtNum;
  AP.countKinds = function (blocks, acc = {}) {
    for (const b of blocks || []) { if (b.kind) acc[b.kind] = (acc[b.kind] || 0) + 1; if (b.blocks) AP.countKinds(b.blocks, acc); }
    return acc;
  };
  AP.words = (s) => (typeof s === 'string' ? (s.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.%$-]*/g) || []).length : 0);

  /* ---------------- learner state ---------------- */
  const pending = new Map();
  let inflight = 0;
  function syncLabel(state, text) { const el = document.getElementById('sync'); if (el) { el.dataset.state = state; el.textContent = text; } }
  AP.loadState = async function (kinds) {
    const need = kinds.filter((k) => !AP.state[k]);
    if (need.length) {
      const res = await AP.api('state', { params: { kinds: need.join(',') } });
      for (const k of need) AP.state[k] = res[k] || {};
    }
    return AP.state;
  };
  AP.getRec = (kind, key) => (AP.state[kind] && AP.state[kind][key] ? AP.state[kind][key].data : null);
  // Saves are debounced per record; the server validates and returns the cleaned record.
  AP.save = function (kind, key, data, { delay = 700 } = {}) {
    AP.state[kind] = AP.state[kind] || {};
    AP.state[kind][key] = { data, updated: Date.now() };
    const id = `${kind}\u0000${key}`;
    clearTimeout(pending.get(id)?.t);
    return new Promise((resolve) => {
      const t = setTimeout(async () => {
        pending.delete(id);
        inflight++; syncLabel('saving', 'Saving…');
        try {
          const r = await AP.api('state', { method: 'PUT', body: { kind, key, data } });
          AP.state[kind][key] = { data: r.data, updated: r.updated };
          syncLabel('ok', AP.local() ? 'Saved on this device' : 'Saved'); resolve(r);
        } catch (e) { syncLabel('error', 'Not saved'); AP.toast(e.message || 'Could not save.'); resolve(null); }
        finally { inflight--; }
      }, delay);
      pending.set(id, { t });
    });
  };
  AP.remove = async function (kind, key) {
    await AP.api('state', { method: 'DELETE', body: { kind, key } });
    if (AP.state[kind]) delete AP.state[kind][key];
  };
  AP.flush = () => new Promise((r) => { const check = () => (pending.size || inflight ? setTimeout(check, 150) : r()); check(); });
  window.addEventListener('beforeunload', (e) => { if (pending.size || inflight) { e.preventDefault(); e.returnValue = ''; } });
  AP.newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2)).slice(0, 24);

  /* ---------------- settings ---------------- */
  AP.DEFAULT_SETTINGS = { mode: 'graduate', textSize: 1, lineHeight: 1.7, theme: 'system', reducedMotion: false, serifBody: true, weeklyHours: 6, studyDays: ['mon', 'tue', 'wed', 'thu', 'sat'], adaptFromDiagnostic: true, reminders: 'in-app', chatgptLink: true };
  AP.applySettings = function (s) {
    AP.settings = { ...AP.DEFAULT_SETTINGS, ...(s || {}) };
    const r = document.documentElement;
    if (AP.settings.theme === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = AP.settings.theme;
    r.dataset.motion = AP.settings.reducedMotion ? 'reduce' : '';
    r.dataset.body = AP.settings.serifBody ? 'serif' : 'sans';
    r.style.setProperty('--read-size', `${1.125 * AP.settings.textSize}rem`);
    r.style.setProperty('--read-leading', String(AP.settings.lineHeight));
  };

  /* ---------------- feedback ---------------- */
  let toastT;
  AP.toast = function (msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
  };
  AP.announce = (msg) => { const l = document.getElementById('live'); if (l) { l.textContent = ''; setTimeout(() => (l.textContent = msg), 50); } };
  AP.pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  AP.date = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  AP.mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} min`);

  /* ---------------- Continue in ChatGPT ---------------- */
  // Builds a prompt from PUBLIC course material only. Learner text is included only when the
  // learner explicitly adds it. Nothing is sent anywhere by APERTURE: the learner copies it or
  // opens ChatGPT themselves.
  AP.HELP_TYPES = [
    ['deeper', 'Explain this concept more deeply'], ['challenge', 'Challenge my argument'], ['socratic', 'Give me a Socratic examination'],
    ['test', 'Test me with five difficult questions'], ['baseball', 'Provide a baseball application'], ['compare', 'Compare opposing theories'],
    ['critique', 'Help me critique this research'], ['exercise', 'Turn this concept into an executive exercise'],
  ];
  AP.chatPrompt = function ({ title, context, objectives, concept, citations, question, help, own }) {
    const helpText = (AP.HELP_TYPES.find((x) => x[0] === help) || AP.HELP_TYPES[0])[1];
    const lines = [
      'I am studying a graduate-level executive-education unit and want help as a demanding, rigorous tutor.',
      '', `Course unit: ${title}`, context ? `Context: ${context}` : null,
      objectives && objectives.length ? `Learning objectives:\n${objectives.map((o) => `- ${AP.plain(o)}`).join('\n')}` : null,
      concept ? `Concept in focus: ${concept}` : null,
      citations && citations.length ? `Public sources the unit draws on:\n${citations.map((c) => `- ${c}`).join('\n')}` : null,
      question ? `My question or exercise: ${question}` : null,
      own ? `My own work (I chose to share this):\n"""\n${own}\n"""` : null,
      '', `What I want: ${helpText}.`,
      'Distinguish well-established findings from contested or failed-to-replicate ones, cite sources I can check, say when you are uncertain, and do not invent studies, statistics or quotations.',
    ];
    return lines.filter((x) => x !== null).join('\n');
  };
  AP.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); AP.toast('Copied to the clipboard.'); return true; }
    catch { AP.toast('Copy failed — select the text and copy it manually.'); return false; }
  };
})();
