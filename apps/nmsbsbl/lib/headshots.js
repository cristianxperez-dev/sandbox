/* Reused unchanged from AGORA (cpbaseball-site, public/ephyra/apps/_shared/headshots.js @ f058159) — NMSBSBL keeps its own copy so it never depends on AGORA's deployment. */
/* EPHYRA — shared player headshots (AGORA, Trade Deadline Board and any later EPHYRA app).
 *
 * Source: MLB's official images (img.mlbstatic.com), by MLBAM id only — never by name. Two versions of
 * the same official portrait are tried in order, each only when the previous one fails to load:
 *   1. silo  — MLB's own transparent-background cut-out (headshot/silo): processed by MLB, so the head
 *              and shoulders float on any background. EPHYRA never alters or re-hosts an image.
 *   2. photo — the regular portrait on MLB's grey backdrop (headshot/67), framed with the face raised.
 *   3. the player's initials (no default-image parameter, so a missing photo is never replaced by a
 *      generic or wrong picture).
 * An app may put a stored cut-out first (opts.cut — a same-origin path): a transparent version of MLB's own
 * photograph that the app produced where MLB has no cut-out (the Trade Deadline Board's older players,
 * scripts/ephyra/trade-deadline-board/cutouts/). It is framed like MLB's cut-out; if it fails to load, MLB's
 * original follows as usual. The cut-out is never recorded in the cache below (that records only what MLB has).
 * Which version loaded for an id is remembered (memory + localStorage "ephyra.shared.headshots", 30 days;
 * a player with no image, 7 days), so later renders go straight to the right file and a missing image is
 * not requested again and again. Nothing here needs a key or a server.
 *
 * Rendering: one 4:5 box (.shot, headshots.css) that records which version is shown (.is-silo / .is-photo /
 * .is-wide) so CSS frames each one — the floating-head treatment AGORA introduced. Two ways to use it:
 *   element(id, name, opts)  a DOM node;
 *   html(id, name, opts)     the same markup as a string, for apps that render with templates (the
 *                            Trade Deadline Board); load / error are handled by one capturing listener on
 *                            the document, so no inline handler is needed (CSP script-src 'self').
 * opts: { size: 'lg' | 'sm' | 'xs', alt, lazy, cut } — the box fills its container's width unless an app sizes it.
 */
(function (root) {
  'use strict';
  const IMG = 'https://img.mlbstatic.com/mlb-photos/image/upload/';
  const SILO = (id) => `${IMG}w_240,q_auto:best,f_png/v1/people/${id}/headshot/silo/current`;
  const PHOTO = (id) => `${IMG}w_240,q_auto:good/v1/people/${id}/headshot/67/current`;
  const ORDER = ['silo', 'photo'];
  const URL_OF = { silo: SILO, photo: PHOTO };
  const KEY = 'ephyra.shared.headshots';
  const DAY = 864e5, KEEP = { silo: 30 * DAY, photo: 30 * DAY, none: 7 * DAY };

  // ── which version an id resolved to ──
  let memo = null;
  function cache() {
    if (memo) return memo;
    memo = {};
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const now = Date.now();
      for (const [id, v] of Object.entries(raw)) if (v && KEEP[v.k] && now - v.t < KEEP[v.k]) memo[id] = v;
    } catch (e) { /* storage unavailable: memory only */ }
    return memo;
  }
  function remember(id, k) {
    const c = cache();
    if (c[id] && c[id].k === k) return;
    c[id] = { k, t: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* memory only */ }
  }
  const resolved = (id) => (cache()[String(id)] || {}).k || null;
  const validId = (id) => /^\d{1,7}$/.test(String(id == null ? '' : id));
  const validCut = (u) => typeof u === 'string' && /^(?!.*\.\.)[\w-]+(?:\/[\w-]+)*\.(?:webp|png)$/.test(u);  // relative, same origin
  const urlOf = (kind, id, box) => kind === 'cut' ? box.dataset.hsCut : URL_OF[kind](id);
  /** The versions still worth trying for an id, best first. */
  function plan(id) {
    if (!validId(id)) return [];
    const k = resolved(id);
    if (k === 'none') return [];
    return k ? ORDER.slice(ORDER.indexOf(k)) : ORDER.slice();
  }

  const initialsOf = (name) => { const w = String(name || '?').split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Markup for one headshot box. */
  function html(id, name, opts = {}) {
    const cut = validId(id) && validCut(opts.cut) ? opts.cut : null;
    const steps = (cut ? ['cut'] : []).concat(plan(id)), size = opts.size && opts.size !== 'lg' ? ' ' + opts.size : '';
    const init = `<span class="shot__init" aria-hidden="true">${esc(initialsOf(name))}</span>`;
    if (!steps.length) return `<div class="shot${size}" data-hs="none">${init}</div>`;
    const alt = opts.alt != null ? opts.alt : (opts.size === 'sm' || opts.size === 'xs' ? '' : `${name} headshot`);
    return `<div class="shot${size}" data-hs="${esc(id)}" data-hs-try="${steps.join(' ')}"${cut ? ` data-hs-cut="${esc(cut)}"` : ''}>` +
      `<img class="shot__img" src="${esc(cut || URL_OF[steps[0]](id))}" data-hs-kind="${steps[0]}" alt="${esc(alt)}" width="240" height="300" decoding="async"` +
      `${opts.lazy === false ? '' : ' loading="lazy"'} referrerpolicy="no-referrer" draggable="false">${init}</div>`;
  }
  /** The same box as a DOM node. */
  function element(id, name, opts = {}) {
    const t = document.createElement('template');
    t.innerHTML = html(id, name, opts);
    return t.content.firstElementChild;
  }

  // ── one listener for every headshot in the document (works for markup inserted at any time) ──
  function onLoad(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('shot__img')) return;
    const box = img.closest('.shot'), kind = img.dataset.hsKind;
    if (!box) return;
    const silo = kind === 'silo' || kind === 'cut';   // a stored cut-out is framed exactly like MLB's
    box.classList.remove('is-silo', 'is-photo', 'is-wide', 'is-cut');
    box.classList.add('has-img', silo ? 'is-silo' : 'is-' + kind);
    if (kind === 'cut') box.classList.add('is-cut');
    // a cut-out wider than the box is shown whole, shoulders on the bottom edge, never side-cropped
    if (silo && img.naturalWidth && img.naturalHeight / img.naturalWidth < 1.25) box.classList.add('is-wide');
    if (kind !== 'cut') remember(box.dataset.hs, kind);
  }
  function onError(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('shot__img')) return;
    const box = img.closest('.shot');
    if (!box) return;
    const id = box.dataset.hs, tried = (box.dataset.hsTry || '').split(' ').filter(Boolean);
    const i = tried.indexOf(img.dataset.hsKind), next = tried[i + 1];
    if (next) { img.dataset.hsKind = next; img.src = urlOf(next, id, box); return; }
    img.remove();
    box.classList.remove('has-img', 'is-silo', 'is-photo', 'is-wide', 'is-cut');
    box.dataset.hs = 'none';
    if (img.dataset.hsKind !== 'cut') remember(id, 'none');   // only what MLB lacks is remembered
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('load', onLoad, true);
    document.addEventListener('error', onError, true);
  }

  root.EPHYRA_HEADSHOTS = { SILO, PHOTO, html, element, initialsOf, resolved, plan, validId, validCut, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
