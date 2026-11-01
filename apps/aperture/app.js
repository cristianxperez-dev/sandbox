/* APERTURE — boot and router. */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const main = document.getElementById('main');

  const ROUTES = [
    [/^$/, 'home', () => AP.views.home()],
    [/^curriculum$/, 'curriculum', () => AP.views.curriculum()],
    [/^week\/(w\d{2})$/, 'curriculum', (m) => AP.views.week(m[1])],
    [/^lesson\/(w\d{2}-l\d)(?:\/(explore|understand|challenge|apply|retain|watch|read))?$/, 'curriculum', (m) => AP.study.lesson(m[1], m[2])],
    [/^case\/([a-z0-9-]+)$/, 'curriculum', (m) => AP.study.caseView(m[1])],
    [/^exercise\/([a-z0-9-]+)$/, 'labs', (m) => AP.study.exercise(m[1])],
    [/^assignment\/([a-z0-9-]+)$/, 'assessments', (m) => AP.study.assignment(m[1])],
    [/^assess\/([a-z0-9-]+)(?:\/(reassess))?$/, 'assessments', (m) => AP.study.assess(m[1], m[2] || 'main')],
    [/^attempt\/([a-f0-9]{8,64})$/, 'assessments', (m) => AP.study.attempt(m[1])],
    [/^review$/, 'progress', () => AP.study.review()],
    [/^library$/, 'library', () => AP.views.library()],
    [/^library\/(R-[a-z0-9-]+)$/, 'library', (m) => AP.views.resource(m[1])],
    [/^manifest$/, 'library', () => AP.views.manifest()],
    [/^audit$/, 'library', () => AP.views.audit()],
    [/^glossary(?:\/(g-[a-z0-9-]+))?$/, 'library', (m) => AP.views.glossary(m[1])],
    [/^labs$/, 'labs', () => AP.views.labs()],
    [/^labs\/([a-z-]+)$/, 'labs', (m) => AP.views.lab(m[1])],
    [/^journal$/, 'labs', () => AP.study.journal()],
    [/^journal\/([A-Za-z0-9_-]{6,64}|new)$/, 'labs', (m) => AP.study.journalEntry(m[1])],
    [/^assessments$/, 'assessments', () => AP.views.assessments()],
    [/^diagnostic$/, 'assessments', () => AP.study.diagnostic()],
    [/^midterm$/, 'assessments', () => AP.study.midterm()],
    [/^capstone$/, 'assessments', () => AP.study.capstone()],
    [/^capstone\/(k\d{2})$/, 'assessments', (m) => AP.study.component(m[1])],
    [/^notebook$/, 'notebook', () => AP.views.notebook()],
    [/^progress$/, 'progress', () => AP.views.progress()],
    [/^settings$/, 'settings', () => AP.views.settings()],
  ];

  let current = null;
  async function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/\/+$/, '');
    if (current && current.destroy) { try { current.destroy(); } catch {} }
    current = null;
    document.getElementById('readbar').hidden = true;
    document.getElementById('nav').classList.remove('open');
    document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
    for (const [re, nav, fn] of ROUTES) {
      const m = hash.match(re);
      if (!m) continue;
      document.querySelectorAll('[data-nav]').forEach((a) => (a.getAttribute('data-nav') === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
      AP.clear(main).appendChild(h('p', { class: 'loading', text: 'Loading…' }));
      try {
        const view = await fn(m);
        if (location.hash.replace(/^#\/?/, '').replace(/\/+$/, '') !== hash && decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/\/+$/, '') !== hash) return; // navigated away meanwhile
        AP.clear(main);
        if (view && view.el) { main.appendChild(view.el); current = view; } else if (view) main.appendChild(view);
        document.title = `${(view && view.title) || 'APERTURE'} — APERTURE`;
        if (!(view && view.keepScroll)) window.scrollTo(0, 0);
        main.focus({ preventScroll: true });
      } catch (e) { showError(e); }
      return;
    }
    AP.clear(main).appendChild(h('div', { class: 'pagehead' }, h('span', { class: 'label', text: 'Not found' }), h('h1', { text: 'There is nothing at this address.' }), h('p', { class: 'lede' }, h('a', { href: '#/', text: 'Return home' }))));
  }
  function showError(e) {
    if (e && (e.status === 401 || e.status === 503)) return gate(e);
    console.error(e);
    AP.clear(main).appendChild(h('div', { class: 'pagehead' }, h('span', { class: 'label', text: 'Something went wrong' }), h('h2', { text: (e && e.message) || 'This page could not be loaded.' }), h('p', null, h('button', { class: 'btn', onclick: () => route(), text: 'Try again' }))));
  }
  AP.rerender = route;

  /* ---------------- gate screens ---------------- */
  function gate(e) {
    document.getElementById('top').hidden = true;
    document.getElementById('foot').hidden = true;
    const box = h('div', { class: 'gate' }, h('img', { src: 'mark.svg', alt: '' }), h('h1', { text: 'APERTURE' }), h('span', { class: 'label', text: 'The Applied Intelligence Academy' }));
    if (e.status === 401) {
      box.append(h('p', { class: 'lede', text: 'A private learning environment. Sign in to continue.' }), h('p', null, h('a', { class: 'btn btn--primary', href: 'api/login', text: 'Sign in' })), h('p', { class: 'small muted', text: 'Sign-in is handled by Cloudflare Access. Only approved addresses can open APERTURE.' }));
    } else if (e.status === 503) {
      box.append(h('p', { class: 'lede', text: 'APERTURE is installed but its secure sign-in and storage are not configured yet.' }), h('p', { class: 'small muted', text: 'Nothing is served until they are. The owner completes the one-time setup in the Cloudflare dashboard (see aperture/README.md in the repository).' }));
    } else if (AP.local()) {
      box.append(h('p', { class: 'lede', text: e.message || 'APERTURE could not load its course content.' }), h('p', null, h('button', { class: 'btn', onclick: () => location.reload(), text: 'Try again' })));
    } else {
      box.append(h('p', { class: 'lede', text: e.message || 'APERTURE could not reach its server.' }), h('p', { class: 'small muted', text: 'APERTURE runs only where its private server is available (cperez.app). Course material is never published with this page.' }));
    }
    AP.clear(main).appendChild(box);
    document.title = 'APERTURE';
  }

  /* ---------------- boot ---------------- */
  document.getElementById('menuBtn').addEventListener('click', (ev) => {
    const nav = document.getElementById('nav');
    const open = nav.classList.toggle('open');
    ev.currentTarget.setAttribute('aria-expanded', String(open));
  });
  async function boot() {
    try {
      AP.session = await AP.api('session');
      await AP.loadState(['settings', 'progress', 'bookmark']);
      AP.applySettings(AP.getRec('settings', 'main'));
      const lib = await AP.library();
      AP.cache.libIndex = new Map(lib.resources.map((r) => [r.id, r]));
      document.getElementById('top').hidden = false;
      document.getElementById('foot').hidden = false;
      if (AP.local()) betaNotice();
      window.addEventListener('hashchange', route);
      route();
    } catch (e) {
      if (e && e.status === 503 && !AP.local()) { AP.fallbackToLocal(); AP.cache = {}; return boot(); }
      gate(e);
    }
  }
  // Public beta: say plainly where progress lives (dismissible; the choice is remembered here).
  function betaNotice() {
    const KEY = 'aperture:v1:beta-notice';
    let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch {}
    const storageOk = (() => { try { localStorage.setItem('aperture:v1:probe', '1'); localStorage.removeItem('aperture:v1:probe'); return true; } catch { return false; } })();
    if (seen && storageOk) return;
    const bar = h('div', { class: 'beta', role: 'note' },
      h('p', null, h('b', { text: storageOk ? 'Public beta. ' : 'This browser is not saving. ' }),
        storageOk ? 'Your progress, notes and results are saved only in this browser on this device — not on a server and not in an account. Clearing site data or switching browser or device starts you from scratch. Export a backup from ' : 'Storage is blocked (private browsing or site data disabled), so nothing you do will be kept after you close this tab. Use a regular window, or export from ',
        h('a', { href: '#/settings', text: 'Settings' }), '. Assessments are scored in your browser: they are learning exercises, not secure exams.'),
      storageOk ? h('button', { class: 'btn btn--small', onclick: () => { try { localStorage.setItem(KEY, '1'); } catch {} bar.remove(); }, text: 'Understood' }) : null);
    document.getElementById('top').after(bar);
  }
  window.addEventListener('aperture:storage-error', () => AP.toast('This browser refused to save. Export your data from Settings, then free up space or leave private browsing.'));
  AP.applySettings(null);
  boot();
})();
