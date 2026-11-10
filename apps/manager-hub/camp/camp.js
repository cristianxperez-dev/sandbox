/* Manager Hub — Camp: organisation-wide camp / workout scheduler (UI).
   window.CampUI.show(hostEl) is called every time the top-level Camp tab opens; it builds once,
   then re-reads rosters and storage and re-renders. Pure logic lives in camp-core.js (CampCore).

   Reads (never writes) every affiliate's roster through RosterRoute.readRoster, and the affiliates'
   Resources coach lists through store.getFor. Camp data is one org-wide key, cs.camp.v1.
   No network, no AI. */
(function () {
  "use strict";
  const C = window.CampCore;
  if (!C) return;

  const PPM = 2;            // day grid: pixels per minute (5 min = 10 px, 15 min = 30 px)
  const NARROW = 760;       // below this the schedule opens on the agenda
  const COL_MIN = 150;

  /* ---------- environment (the host app's globals, read defensively) ---------- */
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const affs = () => { try { return typeof AFFILIATES !== "undefined" ? AFFILIATES : []; } catch (e) { return []; } };
  const readRoster = (id) => { try { return window.RosterRoute ? window.RosterRoute.readRoster(id) : []; } catch (e) { return []; } };
  const say = (msg, action) => { try { if (typeof toast === "function") return toast(msg, action); } catch (e) { /* fall through */ } };
  const LS = { getItem: (k) => window.localStorage.getItem(k), setItem: (k, v) => window.localStorage.setItem(k, v) };
  const narrow = () => window.innerWidth < NARROW;

  /* ---------- module state ---------- */
  let host = null, root = null, main = null, layer = null, printRoot = null;
  let state = C.emptyState(), pool = [], index = new Map(), hist = [];
  let storageNote = "", memoryOnly = false;
  let drag = null, gridMeta = null, menuOpen = null, dlgOpen = null;
  const blankFilter = () => ({ q: "", affs: [], role: "", position: "", throws: "", bats: "", status: "", group: "", inCamp: "" });
  const ui = { tab: "schedule", date: null, view: null, sel: null, facFilter: "", confOpen: false, weekOf: null,
    pf: blankFilter(), psel: new Set(), lastIdx: null, flash: null, focusTitle: false };

  const cur = () => state.camps.find((c) => c.id === state.activeCampId) || state.camps[0] || null;
  const actById = (id) => { const c = cur(); return c ? c.draft.activities.find((a) => a.id === id) : null; };
  const nameOf = (pid) => (index.get(pid) ? index.get(pid).name : "Unknown player");
  const facName = (camp, id) => { const f = camp.facilities.find((x) => x.id === id); return f ? f.name : "No facility"; };
  const plural = (n, w, pl) => n + " " + (n === 1 ? w : (pl || w + "s"));

  /* ---------- icons (stroke, 24 grid) ---------- */
  const I = (d, extra) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ""}>${d}</svg>`;
  const ICON = {
    undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    print: I('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
    send: I('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    left: I('<path d="m15 18-6-6 6-6"/>'), right: I('<path d="m9 18 6-6-6-6"/>'),
    warn: I('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    info: I('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    check: I('<path d="M20 6 9 17l-5-5"/>'),
    copy: I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    trash: I('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
    more: I('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
    up: I('<path d="m18 15-6-6-6 6"/>'), down: I('<path d="m6 9 6 6 6-6"/>'),
    camp: I('<path d="M3.5 20h17"/><path d="M5.5 20V9.5L12 4l6.5 5.5V20"/><path d="M10 20v-5h4v5"/>'),
    users: I('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
    download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'),
    clock: I('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>')
  };

  /* =====================================================================
     STORAGE + HISTORY
     ===================================================================== */
  function loadAll() {
    const r = C.loadState(LS);
    if (r.error) {
      memoryOnly = true;
      storageNote = "Browser storage is unavailable here, so camp changes last only until this tab closes.";
    } else {
      memoryOnly = false;
      state = r.state;
      if (r.recovered) storageNote = "Saved camp data couldn't be read, so Camp started fresh." + (r.backupKey ? " The unreadable copy is kept in this browser under “" + r.backupKey + "”." : "");
    }
    pool = C.buildPool(affs(), readRoster);
    index = C.poolIndex(pool);
  }
  function persist() {
    if (memoryOnly) return;
    if (!C.saveState(LS, state)) { storageNote = "Couldn't save to this browser (storage full or blocked). Changes are kept until this tab closes."; memoryOnly = true; }
  }
  /** every edit goes through here: snapshot for undo, apply, save, redraw */
  function mutate(label, fn, opts) {
    opts = opts || {};
    const now = Date.now(), last = hist[hist.length - 1];
    if (opts.coalesce && last && last.key === opts.coalesce && now - last.t < 1500) last.t = now;
    else hist.push({ label, json: JSON.stringify(state), key: opts.coalesce || null, t: now });
    if (hist.length > 40) hist.shift();
    const camp = cur();
    const r = fn(camp);
    if (camp) camp.updated = new Date().toISOString();
    persist();
    if (opts.render === "all") render();
    else if (opts.render !== "none") refresh(opts);
    return r;
  }
  function undo() {
    const last = hist.pop();
    if (!last) { say("Nothing to undo"); return; }
    state = C.normalizeState(JSON.parse(last.json));
    persist();
    if (ui.sel && !actById(ui.sel)) ui.sel = null;
    render();
    say("Undone: " + last.label);
  }

  /* =====================================================================
     RENDER — top level
     ===================================================================== */
  function render() {
    closeMenu();
    const camp = cur();
    if (!camp) { main.innerHTML = bannerHTML() + firstRunHTML(); bindTzSelect(main.querySelector("#cCreateForm")); return; }
    ensureDate(camp);
    if (ui.sel && !actById(ui.sel)) ui.sel = null;
    main.innerHTML = bannerHTML() + `<div id="cTop">${topHTML(camp)}</div><div class="c-body" id="cBody"></div>`;
    renderBody();
  }
  function refresh(opts) {
    const camp = cur();
    if (!camp) return render();
    ensureDate(camp);
    const top = main.querySelector("#cTop"); if (top) top.innerHTML = topHTML(camp);
    if (ui.tab === "schedule") {
      if (ui.sel && !actById(ui.sel)) ui.sel = null;
      const sched = main.querySelector(".c-sched");
      if (!sched) return renderBody();
      sched.classList.toggle("with-panel", !!ui.sel);
      renderSchedMain();
      if (!(opts && opts.keepPanel)) renderPanel();
    } else if (!(opts && opts.keepBody)) renderBody();
  }
  function ensureDate(camp) {
    const dates = C.campDates(camp);
    if (!ui.date || !dates.includes(ui.date)) {
      const today = C.nowIn(camp.tz).date;
      ui.date = dates.includes(today) ? today : camp.start;
    }
    if (!ui.view) ui.view = narrow() ? "agenda" : "grid";
  }
  function bannerHTML() {
    return storageNote ? `<div class="c-banner" role="status">${ICON.warn}<span>${h(storageNote)}</span><button class="btn sm quiet" data-ca="banner-x">Dismiss</button></div>` : "";
  }

  /* ---------- first run ---------- */
  function poolSummaryHTML() {
    const f = C.facets(pool, affs());
    if (!pool.length) return `<div class="c-empty-roster">${ICON.users}<div><b>No affiliate rosters yet</b><p>Camp builds its player list from each affiliate's <b>Roster</b>. Open an affiliate workspace and import its roster (or the organization roster file), then come back — players appear here automatically. You can create the camp now and add players later.</p></div></div>`;
    return `<div class="c-poolsum"><b>${pool.length} players</b> available across ${plural(f.affiliates.length, "affiliate")}<div class="c-afftags">${f.affiliates.map((a) => `<span class="c-aff">${h(a.short)}</span><span class="c-afftag-n">${h(a.level)} · ${a.count}</span>`).join("")}</div></div>`;
  }
  function campFormHTML(o) {
    o = o || {};
    const tz = o.tz || C.DEFAULT_TZ;
    const tzOpts = C.COMMON_TZ.some(([z]) => z === tz) ? C.COMMON_TZ : C.COMMON_TZ.concat([[tz, tz]]);
    return `<div class="field"><label for="cfName">Camp name</label><input type="text" id="cfName" value="${h(o.name || "")}" placeholder="e.g. Minor League Spring Training" autocomplete="off"></div>
      <div class="grid2"><div class="field"><label for="cfStart">First day</label><input type="date" id="cfStart" value="${h(o.start || "")}"></div>
      <div class="field"><label for="cfEnd">Last day</label><input type="date" id="cfEnd" value="${h(o.end || "")}"></div></div>
      <div class="grid2"><div class="field"><label for="cfLoc">Location</label><input type="text" id="cfLoc" value="${h(o.location || "")}" placeholder="e.g. West Palm Beach, FL"></div>
      <div class="field"><label for="cfTz">Timezone</label><select id="cfTz">${tzOpts.map(([z, l]) => `<option value="${h(z)}" ${z === tz ? "selected" : ""}>${h(l)}</option>`).join("")}<option value="__other">Other (IANA name)…</option></select>
      <input type="text" id="cfTzOther" class="c-mt6" placeholder="e.g. America/Phoenix" hidden></div></div>
      ${o.edit ? "" : `<label class="c-check"><input type="checkbox" id="cfPreset" checked> <span><b>Start with the Florida complex facilities</b><br><small>Fields 1–4, Cages 1–4, Bullpen mounds (8), Catching area, Weight room, Indoor / Turf, Meeting room — rename, reorder or remove them any time in Setup.</small></span></label>`}
      <p class="c-formerr" id="cfErr" role="alert"></p>`;
  }
  function readCampForm(scope) {
    const v = (id) => (scope.querySelector("#" + id) || {}).value || "";
    const name = v("cfName").trim(), start = v("cfStart"), end = v("cfEnd") || start, location = v("cfLoc").trim();
    let tz = v("cfTz"); if (tz === "__other") tz = v("cfTzOther").trim();
    const err = !name ? "Give the camp a name." : !C.isDate(start) ? "Choose the first day." : !C.isDate(end) || end < start ? "The last day must be on or after the first day."
      : C.daysBetween(start, end) > 120 ? "A camp can run up to 120 days." : !C.isTimeZone(tz) ? "That timezone isn't recognised — use an IANA name such as America/New_York." : "";
    const presetEl = scope.querySelector("#cfPreset");
    return { err, name, start, end, location, tz, preset: presetEl ? presetEl.checked : true };
  }
  function bindTzSelect(scope) {
    if (!scope) return;
    const sel = scope.querySelector("#cfTz"), other = scope.querySelector("#cfTzOther");
    if (sel && other) sel.addEventListener("change", () => { other.hidden = sel.value !== "__other"; if (!other.hidden) other.focus(); });
  }
  function firstRunHTML() {
    const today = C.nowIn(C.DEFAULT_TZ).date;
    return `<section class="c-hero">
      <div class="c-hero-copy">
        <div class="c-eyebrow">Camp · Organization-wide</div>
        <h2 class="c-h1">Create your first camp</h2>
        <p class="c-lede">One schedule for players from every affiliate — facilities down to the cage and mound, temporary camp groups, staff, and a printable “where do I need to be” sheet for every player.</p>
        <ol class="c-steps">
          <li><b>Create the camp</b><span>Name, dates and the complex's facilities.</span></li>
          <li><b>Add players and groups</b><span>Search the whole organization; group catchers, starters, early work.</span></li>
          <li><b>Lay out each day, then publish</b><span>Drag blocks on the facility grid; conflicts are flagged as you go.</span></li>
        </ol>
        ${poolSummaryHTML()}
      </div>
      <form class="c-hero-form" id="cCreateForm" autocomplete="off">
        ${campFormHTML({ start: today, end: C.addDays(today, 6) })}
        <button type="submit" class="btn primary c-wide" data-ca="create-camp">${ICON.plus} Create camp</button>
      </form>
    </section>`;
  }
  function createFromForm(scope) {
    const f = readCampForm(scope);
    const err = scope.querySelector("#cfErr");
    if (f.err) { if (err) err.textContent = f.err; return false; }
    mutate("Create camp", () => {
      const camp = C.newCamp(f);
      state.camps.push(camp);
      state.activeCampId = camp.id;
    }, { render: "none" });
    ui.tab = "schedule"; ui.date = null; ui.sel = null; ui.psel.clear(); ui.pf = blankFilter();
    render();
    say("Camp created — add players next, or start laying out the first day");
    return true;
  }

  /* ---------- header + tabs ---------- */
  function statusHTML(camp) {
    if (!camp.published) return `<span class="c-status draft" title="Nothing has been published yet">Draft · not published</span>`;
    const at = fmtInstant(camp.published.at, camp.tz);
    if (C.hasUnpublished(camp)) return `<button class="c-status changed" data-ca="publish" title="Published ${h(at)} — review changes">Unpublished changes</button>`;
    return `<span class="c-status live" title="Published ${h(at)}">${ICON.check} Published ${h(at)}</span>`;
  }
  function fmtInstant(iso, tz) {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return iso || ""; }
  }
  function topHTML(camp) {
    const days = C.campDates(camp).length;
    const tabs = [["schedule", "Schedule", ""], ["players", "Players", camp.players.length], ["groups", "Groups", camp.groups.length], ["staff", "Staff", camp.staff.length], ["setup", "Setup", ""]];
    return `<header class="c-head">
      <div class="c-title">
        <div class="c-eyebrow">Camp · Organization-wide</div>
        <div class="c-namerow"><h2 class="c-h1">${h(camp.name)}</h2>
          ${state.camps.length > 1 ? `<label class="c-switch"><span class="c-sr">Switch camp</span><select data-cf="camp-switch" aria-label="Switch camp">${state.camps.map((c) => `<option value="${h(c.id)}" ${c.id === camp.id ? "selected" : ""}>${h(c.name)}</option>`).join("")}<option value="__new">+ New camp…</option></select></label>` : `<button class="btn sm quiet" data-ca="new-camp">${ICON.plus} New camp</button>`}
        </div>
        <div class="c-meta">${camp.location ? `<span>${h(camp.location)}</span>` : ""}<span>${h(C.fmtRange(camp.start, camp.end))} · ${plural(days, "day")}</span><span class="c-tz" title="${h(camp.tz)}">${ICON.clock} Times in ${h(C.tzAbbr(camp.tz, ui.date || camp.start))} · ${h(C.tzCity(camp.tz))}</span></div>
      </div>
      <div class="c-headact">
        ${statusHTML(camp)}
        <button class="btn sm quiet" data-ca="undo" ${hist.length ? "" : "disabled"} title="${hist.length ? "Undo: " + h(hist[hist.length - 1].label) : "Nothing to undo"}">${ICON.undo}<span class="c-hide-s">Undo</span></button>
        <button class="btn sm" data-ca="print">${ICON.print}<span class="c-hide-s">Print / export</span></button>
        <button class="btn sm primary" data-ca="publish">${ICON.send} Publish</button>
      </div>
    </header>
    <nav class="c-tabs" role="tablist" aria-label="Camp sections">${tabs.map(([id, l, n]) => `<button role="tab" aria-selected="${ui.tab === id}" data-ca="tab" data-k="${id}">${l}${n !== "" ? `<span class="c-n">${n}</span>` : ""}</button>`).join("")}</nav>`;
  }

  function renderBody() {
    const b = main.querySelector("#cBody"); if (!b) return;
    const camp = cur();
    if (ui.tab === "schedule") {
      b.innerHTML = `<div class="c-sched ${ui.sel ? "with-panel" : ""}"><div class="c-sched-main" id="cSchedMain"></div><aside class="c-panel" id="cPanel" aria-label="Edit activity"></aside></div>`;
      renderSchedMain(); renderPanel();
    } else if (ui.tab === "players") { b.innerHTML = playersHTML(camp); renderPlayerTable(); }
    else if (ui.tab === "groups") b.innerHTML = groupsHTML(camp);
    else if (ui.tab === "staff") b.innerHTML = staffHTML(camp);
    else { b.innerHTML = setupHTML(camp); bindTzSelect(b.querySelector("#cDetails")); }
  }

  /* =====================================================================
     SCHEDULE
     ===================================================================== */
  function dayConflicts(camp) { return C.conflicts(camp, { index }); }
  function renderSchedMain() {
    const el = main.querySelector("#cSchedMain"); if (!el) return;
    const camp = cur();
    const wrap = el.querySelector("#cGridWrap");
    const keep = wrap ? [wrap.scrollTop, wrap.scrollLeft] : null;
    const all = dayConflicts(camp);
    const byAct = C.conflictsByActivity(all);
    const today = all.filter((c) => c.date === ui.date);
    let body;
    if (ui.view === "week") body = weekHTML(camp, all);
    else if (ui.view === "agenda") body = agendaHTML(camp, byAct);
    else body = gridHTML(camp, byAct);
    el.innerHTML = toolbarHTML(camp, all, today) + (ui.confOpen ? confListHTML(camp, all) : "") + body;
    const nw = el.querySelector("#cGridWrap");
    if (nw) {
      if (keep) { nw.scrollTop = keep[0]; nw.scrollLeft = keep[1]; }
      else {
        const first = C.activitiesOn(camp.draft.activities, ui.date)[0];
        if (first && gridMeta && first.start - gridMeta.win.start > 90) nw.scrollTop = (first.start - gridMeta.win.start - 30) * PPM;
      }
    }
    if (ui.flash) {
      const ids = ui.flash; ui.flash = null;
      const els = ids.map((id) => el.querySelector(`[data-aid="${id}"]`)).filter(Boolean);
      els.forEach((b) => b.classList.add("c-flash"));
      if (els[0]) { els[0].scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); }
      setTimeout(() => els.forEach((b) => b.classList.remove("c-flash")), 1800);
    }
  }
  function toolbarHTML(camp, all, today) {
    const dates = C.campDates(camp), i = dates.indexOf(ui.date);
    const errs = (ui.view === "week" ? all : today).filter((c) => c.level === "error").length;
    const warns = (ui.view === "week" ? all : today).filter((c) => c.level === "warning").length;
    const scope = ui.view === "week" ? "camp" : "day";
    const conf = errs ? `${plural(errs, "conflict")}${warns ? ` · ${plural(warns, "note")}` : ""}` : warns ? plural(warns, "note") : "No conflicts";
    const facOpts = ui.view === "agenda" ? `<label class="c-facfilter"><span class="c-sr">Facility</span><select data-cf="fac-filter" aria-label="Filter by facility"><option value="">All facilities</option>${camp.facilities.map((f) => `<option value="${h(f.id)}" ${ui.facFilter === f.id ? "selected" : ""}>${h(f.name)}</option>`).join("")}</select></label>` : "";
    return `<div class="c-tb">
      <div class="c-daynav">
        <button class="btn sm quiet c-icon" data-ca="day-prev" ${i <= 0 ? "disabled" : ""} aria-label="Previous day">${ICON.left}</button>
        <select data-cf="day" aria-label="Camp day">${dates.map((d, k) => `<option value="${d}" ${d === ui.date ? "selected" : ""}>${h(C.fmtDate(d))} · Day ${k + 1}</option>`).join("")}</select>
        <button class="btn sm quiet c-icon" data-ca="day-next" ${i >= dates.length - 1 ? "disabled" : ""} aria-label="Next day">${ICON.right}</button>
      </div>
      <div class="c-seg" role="tablist" aria-label="Schedule view">
        ${[["grid", "Facility grid"], ["agenda", "Agenda"], ["week", "Week"]].map(([v, l]) => `<button role="tab" aria-selected="${ui.view === v}" data-ca="view" data-k="${v}">${l}</button>`).join("")}
      </div>
      ${facOpts}
      <span class="c-tb-sp"></span>
      <button class="c-confbtn ${errs ? "err" : warns ? "warn" : "ok"}" data-ca="conf-toggle" aria-expanded="${ui.confOpen}" title="Conflicts this ${scope}">${errs ? ICON.warn : warns ? ICON.info : ICON.check}<span>${conf}</span></button>
      ${ui.view !== "week" ? `<button class="btn sm" data-ca="day-menu" aria-haspopup="menu">Day ${ICON.down}</button>` : ""}
      <button class="btn sm primary" data-ca="add-act">${ICON.plus}<span>Activity</span></button>
    </div>`;
  }
  function confListHTML(camp, all) {
    if (!all.length) return `<div class="c-conflist"><p class="c-muted">No conflicts or notes anywhere in this camp.</p></div>`;
    const dates = Array.from(new Set(all.map((c) => c.date))).sort((a, b) => (a === ui.date ? -1 : b === ui.date ? 1 : a.localeCompare(b)));
    return `<div class="c-conflist" role="region" aria-label="Conflicts">
      <div class="c-cl-head"><b>Conflicts and notes</b><span class="c-muted">Errors are real clashes; notes are worth a look. Nothing here blocks saving or publishing.</span><button class="btn sm quiet" data-ca="conf-toggle">Close</button></div>
      ${dates.map((d) => `<div class="c-cl-day"><div class="c-cl-date">${h(C.fmtDate(d))}${d === ui.date ? " · this day" : ""}</div>
        ${all.filter((c) => c.date === d).map((c) => `<button class="c-cl-item ${c.level}" data-ca="conf-go" data-k="${h(c.ids.join(","))}" data-k2="${d}">
          <span class="c-cl-ico">${c.level === "error" ? ICON.warn : ICON.info}</span><span class="c-cl-msg">${h(c.msg)}${c.detail ? `<small>${h(c.detail)}</small>` : ""}</span><span class="c-cl-go">Show</span></button>`).join("")}</div>`).join("")}
    </div>`;
  }

  /* ---------- day grid ---------- */
  function gridWindow(camp, acts) {
    let s = camp.dayWindow.start, e = camp.dayWindow.end;
    acts.forEach((a) => { s = Math.min(s, a.start); e = Math.max(e, a.start + a.dur); });
    return { start: Math.floor(s / 60) * 60, end: Math.min(1440, Math.ceil(e / 60) * 60) };
  }
  function gridCols(camp, acts) {
    const cols = camp.facilities.map((f) => ({ id: f.id, name: f.name, f }));
    const known = new Set(camp.facilities.map((f) => f.id));
    if (!cols.length || acts.some((a) => !a.facilityId || !known.has(a.facilityId))) cols.push({ id: "", name: "No facility", f: null });
    return cols;
  }
  function blockHTML(camp, a, lane, conf, opts) {
    const cat = C.catOf(a.cat), res = C.resolvePlayers(a, camp);
    const groups = a.groups.map((g) => camp.groups.find((x) => x.id === g)).filter(Boolean);
    const staff = a.staff.map((s) => camp.staff.find((x) => x.id === s)).filter(Boolean);
    const tall = a.dur * PPM;
    const e = conf ? conf.errors.length : 0, w = conf ? conf.warnings.length : 0;
    const label = `${a.title}, ${C.fmtSpan(a.start, a.dur)}, ${facName(camp, a.facilityId)}, ${plural(res.size, "player")}${e ? ", " + plural(e, "conflict") : ""}. Arrow keys move 5 minutes or between facilities, Alt+arrows change length, Enter edits.`;
    const style = `--cat:${cat.color};top:${(a.start - opts.win.start) * PPM}px;height:${tall}px;left:calc(${lane.lane} * 100% / ${lane.lanes} + 2px);width:calc(100% / ${lane.lanes} - 4px)`;
    const size = tall < 34 ? "xs" : tall < 56 ? "s" : "";
    return `<div class="c-blk ${size} ${ui.sel === a.id ? "sel" : ""} ${e ? "has-err" : ""}" data-aid="${h(a.id)}" tabindex="0" role="button" aria-label="${h(label)}" style="${style}">
      <div class="c-blk-t">${h(a.title)}</div>
      <div class="c-blk-m"><span class="c-blk-time">${h(C.fmtSpan(a.start, a.dur))}</span>${res.size ? `<span class="c-blk-n" title="${res.size} players">${ICON.users}${res.size}</span>` : ""}${staff.length ? `<span class="c-blk-staff" title="${h(staff.map((s) => s.name).join(", "))}">${h(staff.map((s) => C.initials(s.name)).join(" · "))}</span>` : ""}</div>
      ${groups.length || a.players.length ? `<div class="c-blk-chips">${groups.map((g) => `<span class="c-gchip" style="--g:${g.color}">${h(g.name)}</span>`).join("")}${a.players.length ? `<span class="c-gchip ind">+${a.players.length} individual</span>` : ""}</div>` : ""}
      ${e ? `<span class="c-flag err" title="${h(conf.errors.map((c) => c.msg).join("\n"))}">${e}</span>` : w ? `<span class="c-flag warn" title="${h(conf.warnings.map((c) => c.msg).join("\n"))}">i</span>` : ""}
      <div class="c-rsz" title="Drag to change length" aria-hidden="true"></div>
    </div>`;
  }
  function gridHTML(camp, byAct) {
    const acts = C.activitiesOn(camp.draft.activities, ui.date);
    const win = gridWindow(camp, acts), cols = gridCols(camp, acts);
    gridMeta = { win, cols };
    const H = (win.end - win.start) * PPM;
    const labels = [];
    for (let m = win.start; m < win.end; m += 30) labels.push(`<div class="c-tl ${m % 60 ? "half" : ""}" style="top:${(m - win.start) * PPM}px">${m % 60 ? C.fmtTime(m, { ampm: false }) : C.fmtTime(m, { short: true })}</div>`);
    const now = C.nowIn(camp.tz);
    const nowLine = now.date === ui.date && now.minute >= win.start && now.minute < win.end ? `<div class="c-now" style="top:${(now.minute - win.start) * PPM}px"><span>Now</span></div>` : "";
    const known = new Set(camp.facilities.map((f) => f.id));
    const colActs = (col) => acts.filter((a) => (col.id ? a.facilityId === col.id : !a.facilityId || !known.has(a.facilityId)));
    const empty = !acts.length ? `<div class="c-grid-empty"><b>Nothing scheduled on ${h(C.fmtDate(ui.date, { long: true }))}.</b><span>Click any slot on the grid to add an activity there, or <button class="c-link" data-ca="copy-day-in">copy another day</button>${state.templates.length ? ` / <button class="c-link" data-ca="apply-tpl">apply a template</button>` : ""}.</span></div>` : "";
    return `${empty}<div class="c-gridwrap" id="cGridWrap" style="--cols:${cols.length}">
      <div class="c-grow c-ghead">
        <div class="c-gcorner">${h(C.tzAbbr(camp.tz, ui.date))}</div>
        ${cols.map((c) => `<div class="c-gh" title="${h(c.name)}"><b>${h(c.name)}</b><span>${c.f ? h(facMeta(c.f)) : "Pick a facility"}</span></div>`).join("")}
      </div>
      <div class="c-grow c-gbody" style="height:${H}px">
        <div class="c-gtimes">${labels.join("")}</div>
        ${cols.map((c) => {
          const list = colActs(c), lanes = C.layoutLanes(list);
          return `<div class="c-gcol" data-fid="${h(c.id)}" style="height:${H}px" aria-label="${h(c.name)} column — click an empty slot to add">${list.map((a) => blockHTML(camp, a, lanes[a.id], byAct[a.id], { win })).join("")}</div>`;
        }).join("")}
        ${nowLine}
      </div>
    </div>
    <p class="c-hint">Drag a block to move it (5-minute steps) or across facilities; drag its bottom edge to change length. Keyboard: focus a block, arrows move it, Alt+arrows change length, Enter edits, Delete removes.</p>`;
  }
  function facMeta(f) {
    const t = (C.FACILITY_TYPES.find((x) => x.id === f.type) || { name: "" }).name;
    return [t, f.capacity ? "cap " + f.capacity : "", f.concurrent && f.concurrent > 1 ? f.concurrent + " at once" : ""].filter(Boolean).join(" · ");
  }

  /* ---------- agenda ---------- */
  function agendaHTML(camp, byAct) {
    let acts = C.activitiesOn(camp.draft.activities, ui.date);
    if (ui.facFilter) acts = acts.filter((a) => a.facilityId === ui.facFilter);
    const now = C.nowIn(camp.tz), isToday = now.date === ui.date;
    if (!acts.length) {
      return `<div class="c-empty"><b>${ui.facFilter ? "Nothing booked at " + h(facName(camp, ui.facFilter)) : "Nothing scheduled"} on ${h(C.fmtDate(ui.date, { long: true }))}.</b>
        <p>Add an activity, copy another day's plan, or apply a saved template.</p>
        <div class="c-row"><button class="btn sm primary" data-ca="add-act">${ICON.plus} Add activity</button><button class="btn sm" data-ca="copy-day-in">Copy another day</button>${state.templates.length ? `<button class="btn sm" data-ca="apply-tpl">Apply template</button>` : ""}</div></div>`;
    }
    let nowDone = !isToday;
    const items = [];
    acts.forEach((a) => {
      if (!nowDone && a.start + a.dur > now.minute) { items.push(`<div class="c-ag-now"><span>Now · ${h(C.fmtTime(now.minute))}</span></div>`); nowDone = true; }
      const res = C.resolvePlayers(a, camp), cf = byAct[a.id];
      const groups = a.groups.map((g) => camp.groups.find((x) => x.id === g)).filter(Boolean).map((g) => g.name);
      const staff = a.staff.map((s) => camp.staff.find((x) => x.id === s)).filter(Boolean).map((s) => s.name);
      const live = isToday && a.start <= now.minute && now.minute < a.start + a.dur;
      items.push(`<button class="c-ag-item ${live ? "live" : ""} ${ui.sel === a.id ? "sel" : ""}" data-ca="open-act" data-k="${h(a.id)}" data-aid="${h(a.id)}" style="--cat:${C.catOf(a.cat).color}">
        <span class="c-ag-time"><b>${h(C.fmtTime(a.start, { ampm: false }))}</b><small>${h(C.fmtTime(a.start + a.dur))}</small></span>
        <span class="c-ag-main"><b>${h(a.title)}</b><span>${h(facName(camp, a.facilityId))} · ${plural(res.size, "player")}${groups.length ? " · " + h(groups.join(", ")) : ""}</span>${staff.length ? `<span class="c-ag-staff">${h(staff.join(", "))}</span>` : ""}</span>
        ${cf && cf.errors.length ? `<span class="c-flag err static">${cf.errors.length}</span>` : cf && cf.warnings.length ? `<span class="c-flag warn static">i</span>` : ""}
      </button>`);
    });
    return `<div class="c-agenda">${items.join("")}</div>`;
  }

  /* ---------- week ---------- */
  function weekHTML(camp, all) {
    const dates = C.campDates(camp);
    const ws = C.weekStart(ui.weekOf || ui.date);
    const week = []; for (let i = 0; i < 7; i++) week.push(C.addDays(ws, i));
    const shown = week.filter((d) => dates.includes(d));
    const prevOk = dates[0] < ws, nextOk = dates[dates.length - 1] > week[6];
    return `<div class="c-weeknav"><button class="btn sm quiet c-icon" data-ca="week-prev" ${prevOk ? "" : "disabled"} aria-label="Previous week">${ICON.left}</button><b>Week of ${h(C.fmtDate(ws, { noDow: true }))}</b><button class="btn sm quiet c-icon" data-ca="week-next" ${nextOk ? "" : "disabled"} aria-label="Next week">${ICON.right}</button></div>
    <div class="c-week" style="--days:${shown.length}">${shown.map((d) => {
      const acts = C.activitiesOn(camp.draft.activities, d);
      const e = all.filter((c) => c.date === d && c.level === "error").length;
      const heads = new Set(); acts.forEach((a) => C.resolvePlayers(a, camp).forEach((p) => heads.add(p)));
      return `<div class="c-wday ${d === ui.date ? "cur" : ""}">
        <button class="c-wd-head" data-ca="open-day" data-k="${d}"><b>${h(C.fmtDate(d))}</b><span>Day ${dates.indexOf(d) + 1} · ${plural(acts.length, "activity", "activities")} · ${plural(heads.size, "player")}</span>${e ? `<span class="c-flag err static">${e}</span>` : ""}</button>
        <div class="c-wd-list">${acts.length ? acts.map((a) => `<button class="c-wd-item" data-ca="open-day" data-k="${d}" data-k2="${h(a.id)}" style="--cat:${C.catOf(a.cat).color}"><span>${h(C.fmtTime(a.start, { ampm: false }))}</span><b>${h(a.title)}</b><small>${h(facName(camp, a.facilityId))}</small></button>`).join("") : `<p class="c-muted">Nothing yet</p>`}</div>
      </div>`;
    }).join("")}</div>`;
  }

  /* ---------- the activity editor (side panel / sheet on phones) ---------- */
  function catalogue() {
    const out = [], seen = new Set();
    try {
      if (typeof Library !== "undefined" && Library.activities) Library.activities().forEach((a) => {
        const t = String(a.label || "").trim(); if (!t || seen.has(t.toLowerCase())) return; seen.add(t.toLowerCase());
        out.push({ title: t, cat: C.CATEGORIES.some((c) => c.id === a.cat) ? a.cat : "other", dur: +a.dur || 30 });
      });
    } catch (e) { /* the library is optional */ }
    C.ACTIVITY_CATALOGUE.forEach((a) => { if (!seen.has(a.title.toLowerCase())) { seen.add(a.title.toLowerCase()); out.push(a); } });
    return out;
  }
  function renderPanel() {
    const p = main.querySelector("#cPanel"); if (!p) return;
    const camp = cur(), a = ui.sel ? actById(ui.sel) : null;
    const sched = main.querySelector(".c-sched"); if (sched) sched.classList.toggle("with-panel", !!a);
    if (!a) { p.innerHTML = ""; p.hidden = true; return; }
    p.hidden = false;
    const cat = C.catOf(a.cat), res = C.resolvePlayers(a, camp);
    const mine = C.conflicts(camp, { index, date: a.date }).filter((c) => c.ids.includes(a.id) && c.kind !== "nocapacity");
    const dates = C.campDates(camp);
    const durs = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240];
    if (!durs.includes(a.dur)) durs.push(a.dur), durs.sort((x, y) => x - y);
    const viaGroups = new Set(); a.groups.forEach((g) => { const gr = camp.groups.find((x) => x.id === g); if (gr) gr.players.forEach((x) => viaGroups.add(x)); });
    p.innerHTML = `<div class="c-ph" style="--cat:${cat.color}"><span class="c-catdot"></span><div><b>${h(a.title)}</b><small>${h(C.fmtDate(a.date))} · ${h(C.fmtSpan(a.start, a.dur))}</small></div><button class="x" data-ca="panel-close" aria-label="Close editor">×</button></div>
      <div class="c-pb">
        ${mine.length ? `<div class="c-pconf">${mine.map((c) => `<div class="c-pc ${c.level}">${c.level === "error" ? ICON.warn : ICON.info}<span>${h(c.msg)}</span></div>`).join("")}</div>` : ""}
        <div class="field"><label for="caTitle">Activity</label><input type="text" id="caTitle" data-cf="a-title" value="${h(a.title)}" list="cActList" autocomplete="off">
          <datalist id="cActList">${catalogue().map((x) => `<option value="${h(x.title)}">`).join("")}</datalist></div>
        <div class="grid2">
          <div class="field"><label for="caCat">Category</label><select id="caCat" data-cf="a-cat">${C.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === a.cat ? "selected" : ""}>${h(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="caFac">Facility</label><select id="caFac" data-cf="a-fac"><option value="">— None —</option>${camp.facilities.map((f) => `<option value="${h(f.id)}" ${f.id === a.facilityId ? "selected" : ""}>${h(f.name)}</option>`).join("")}</select></div>
        </div>
        <div class="grid3">
          <div class="field"><label for="caDate">Day</label><select id="caDate" data-cf="a-date">${dates.map((d) => `<option value="${d}" ${d === a.date ? "selected" : ""}>${h(C.fmtDate(d))}</option>`).join("")}${dates.includes(a.date) ? "" : `<option value="${a.date}" selected>${h(C.fmtDate(a.date))}</option>`}</select></div>
          <div class="field"><label for="caStart">Start</label><input type="time" id="caStart" data-cf="a-start" step="300" value="${C.toHHMM(a.start)}"></div>
          <div class="field"><label for="caDur">Length</label><select id="caDur" data-cf="a-dur">${durs.map((d) => `<option value="${d}" ${d === a.dur ? "selected" : ""}>${d < 60 ? d + " min" : Math.floor(d / 60) + " h" + (d % 60 ? " " + (d % 60) : "")}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Groups</label>
          ${camp.groups.length ? `<div class="c-cks">${camp.groups.map((g) => `<label class="c-ck"><input type="checkbox" data-cf="a-group" value="${h(g.id)}" ${a.groups.includes(g.id) ? "checked" : ""}><i style="background:${g.color}"></i>${h(g.name)}<small>${g.players.length}</small></label>`).join("")}</div>`
            : `<p class="c-note-s">No camp groups yet. <button class="c-link" data-ca="tab" data-k="groups">Create groups</button> to assign several players at once.</p>`}
        </div>
        <div class="field"><label for="caPSearch">Individual players</label>
          <div class="c-pchips">${a.players.map((pid) => `<span class="c-pchip ${index.has(pid) ? "" : "gone"}">${h(nameOf(pid))}${index.get(pid) ? `<span class="c-aff sm">${h(index.get(pid).aff)}</span>` : ""}<button data-ca="a-rmp" data-k="${h(pid)}" aria-label="Remove ${h(nameOf(pid))}">×</button></span>`).join("")}</div>
          <input type="text" id="caPSearch" data-cf="a-psearch" placeholder="${camp.players.length ? "Add a camp player by name or number" : "Add players to the camp first (Players tab)"}" autocomplete="off" ${camp.players.length ? "" : "disabled"}>
          <div class="c-sugg" id="cPSugg"></div>
        </div>
        <p class="c-whos">${ICON.users}<span><b>${plural(res.size, "player")}</b> in this activity${viaGroups.size ? ` · ${viaGroups.size} via groups` : ""}${a.players.length ? ` · ${a.players.length} individually` : ""}</span></p>
        <div class="field"><label>Staff</label>
          ${camp.staff.length ? `<div class="c-cks">${camp.staff.map((s) => `<label class="c-ck"><input type="checkbox" data-cf="a-staff" value="${h(s.id)}" ${a.staff.includes(s.id) ? "checked" : ""}><span class="c-ini">${h(C.initials(s.name))}</span>${h(s.name)}${s.role ? `<small>${h(s.role)}</small>` : ""}</label>`).join("")}</div>`
            : `<p class="c-note-s">No camp staff yet. <button class="c-link" data-ca="tab" data-k="staff">Add staff</button> (optional).</p>`}
        </div>
        <div class="field"><label for="caNotes">Notes</label><textarea id="caNotes" data-cf="a-notes" rows="2" placeholder="Drills, equipment, who throws…">${h(a.notes)}</textarea></div>
      </div>
      <div class="c-pf"><button class="btn sm" data-ca="dup-act">${ICON.copy} Duplicate</button><button class="btn sm danger" data-ca="del-act">${ICON.trash} Delete</button><span class="c-tb-sp"></span><button class="btn sm" data-ca="panel-close">Done</button></div>`;
    if (ui.focusTitle) { ui.focusTitle = false; const t = p.querySelector("#caTitle"); if (t) { t.focus(); t.select(); } }
  }
  function renderPanelKeepFocus() {
    setTimeout(() => {
      const ae = document.activeElement;
      const key = ae && ae.dataset && ae.dataset.cf ? { cf: ae.dataset.cf, v: ae.type === "checkbox" ? ae.value : null } : null;
      const panelScroll = (main.querySelector("#cPanel .c-pb") || {}).scrollTop || 0;
      renderPanel();
      const pb = main.querySelector("#cPanel .c-pb"); if (pb) pb.scrollTop = panelScroll;
      if (key) {
        const sel = `#cPanel [data-cf="${key.cf}"]` + (key.v != null ? `[value="${CSS.escape(key.v)}"]` : "");
        const el = main.querySelector(sel); if (el) el.focus({ preventScroll: true });
      }
    }, 0);
  }
  function suggestPlayers(q) {
    const box = main.querySelector("#cPSugg"); if (!box) return;
    const camp = cur(), a = actById(ui.sel);
    if (!a || !q.trim()) { box.innerHTML = ""; return; }
    const inCamp = pool.filter((p) => camp.players.includes(p.pid) && !a.players.includes(p.pid));
    const hits = C.filterPool(inCamp, { q }).slice(0, 8);
    box.innerHTML = hits.length ? hits.map((p) => `<button class="c-sg" data-ca="a-addp" data-k="${h(p.pid)}"><b>${h(p.name)}</b><span class="c-aff sm">${h(p.aff)}</span><small>${h([p.number ? "#" + p.number : "", p.position].filter(Boolean).join(" · "))}</small></button>`).join("")
      : `<p class="c-note-s">No camp player matches “${h(q)}”. Add players from the Players tab.</p>`;
  }

  function openActivity(id, focusTitle) {
    ui.sel = id; ui.focusTitle = !!focusTitle;
    const a = actById(id); if (a && a.date !== ui.date) ui.date = a.date;
    if (ui.tab !== "schedule") { ui.tab = "schedule"; render(); return; }
    refresh();
    if (narrow()) { const p = main.querySelector("#cPanel"); if (p) p.scrollTop = 0; }
  }
  function addActivityAt(date, start, facilityId) {
    const camp = cur();
    const a = mutate("Add activity", (c) => {
      const act = C.newActivity({ date, start: C.clamp(start, 0, 1410), dur: 30, facilityId: facilityId || null, title: "New activity", cat: "other" });
      c.draft.activities.push(act); return act;
    }, { render: "none" });
    void camp;
    openActivity(a.id, true);
  }
  function nextFreeStart(camp) {
    const acts = C.activitiesOn(camp.draft.activities, ui.date);
    return acts.length ? C.clamp(Math.max(...acts.map((a) => a.start + a.dur)), 0, 1410) : camp.dayWindow.start;
  }

  /* =====================================================================
     PLAYERS
     ===================================================================== */
  function playersHTML(camp) {
    if (!pool.length) return `<div class="c-card c-pad">${poolSummaryHTML()}${camp.players.length ? `<p class="c-note-s">This camp lists ${plural(camp.players.length, "player")} who are no longer on any affiliate roster.</p>` : ""}</div>`;
    const f = C.facets(pool, affs()), pf = ui.pf;
    const sel = (cf, label, opts, v) => `<label class="c-fsel"><span>${label}</span><select data-cf="${cf}">${opts.map(([val, l]) => `<option value="${h(val)}" ${val === v ? "selected" : ""}>${h(l)}</option>`).join("")}</select></label>`;
    const byAff = {}; camp.players.forEach((pid) => { const p = index.get(pid); const k = p ? p.aff : "?"; byAff[k] = (byAff[k] || 0) + 1; });
    return `<div class="c-players">
      <div class="c-incamp"><b>${plural(camp.players.length, "player")} in this camp</b>${Object.keys(byAff).map((k) => `<span class="c-aff">${h(k)}</span><span class="c-afftag-n">${byAff[k]}</span>`).join("")}<span class="c-muted c-ml">Camp only references roster players — rosters and affiliate assignments never change here.</span></div>
      <div class="c-filters">
        <label class="c-search"><span class="c-sr">Search players</span><input type="search" data-cf="pf-q" value="${h(pf.q)}" placeholder="Search name or number" autocomplete="off"></label>
        <div class="c-affchips" role="group" aria-label="Affiliates">${f.affiliates.map((a) => `<button class="c-fchip ${pf.affs.includes(a.id) ? "on" : ""}" aria-pressed="${pf.affs.includes(a.id)}" data-ca="pf-aff" data-k="${a.id}"><b>${h(a.short)}</b><span>${h(a.level)}</span><small>${a.count}</small></button>`).join("")}</div>
        <div class="c-fsels">
          ${sel("pf-role", "Role", [["", "All"], ["pitcher", "Pitchers"], ["position", "Position players"], ["catcher", "Catchers"]], pf.role)}
          ${f.positions.length > 1 ? sel("pf-position", "Position", [["", "Any"]].concat(f.positions.map((x) => [x, x])), pf.position) : ""}
          ${f.throws.length ? sel("pf-throws", "Throws", [["", "Any"]].concat(f.throws.map((x) => [x, x])), pf.throws) : ""}
          ${f.bats.length ? sel("pf-bats", "Bats", [["", "Any"]].concat(f.bats.map((x) => [x, x])), pf.bats) : ""}
          ${f.statuses.length > 1 ? sel("pf-status", "Status", [["", "Any"]].concat(f.statuses.map((x) => [x, x])), pf.status) : ""}
          ${camp.groups.length ? sel("pf-group", "Camp group", [["", "Any"]].concat(camp.groups.map((g) => [g.id, g.name])), pf.group) : ""}
          ${sel("pf-incamp", "Show", [["", "Everyone"], ["in", "In camp"], ["out", "Not in camp"]], pf.inCamp)}
          <button class="btn sm quiet" data-ca="pf-clear">Clear filters</button>
        </div>
      </div>
      <div id="cPTable"></div>
    </div>`;
  }
  function filtered() { return C.filterPool(pool, ui.pf, cur()); }
  function renderPlayerTable() {
    const el = main.querySelector("#cPTable"); if (!el) return;
    const camp = cur(), list = filtered();
    const inCamp = new Set(camp.players);
    const nSel = list.filter((p) => ui.psel.has(p.pid)).length;
    const allOn = list.length && nSel === list.length;
    const head = `<div class="c-ptools"><span><b>${list.length}</b> of ${pool.length} shown${ui.psel.size ? ` · <b>${ui.psel.size}</b> selected` : ""}</span>
      <span class="c-tb-sp"></span>
      <button class="btn sm" data-ca="p-addfiltered" ${list.length ? "" : "disabled"}>${ICON.plus} Add all ${list.length} to camp</button>
      <button class="btn sm" data-ca="p-groupfilter" ${list.length ? "" : "disabled"}>Group from filter</button></div>`;
    const rows = list.map((p, i) => {
      const gs = C.groupsOf(camp, p.pid);
      const on = ui.psel.has(p.pid), ic = inCamp.has(p.pid);
      return `<div class="c-pr ${on ? "on" : ""} ${ic ? "in" : ""}" data-ca="p-row" data-k="${h(p.pid)}" data-i="${i}">
        <span class="c-pc-cb"><input type="checkbox" data-ca="p-cb" data-k="${h(p.pid)}" data-i="${i}" ${on ? "checked" : ""} aria-label="Select ${h(p.name)}"></span>
        <span class="c-pc-num">${p.number ? "#" + h(p.number) : ""}</span>
        <span class="c-pc-name"><b>${h(p.last)}</b>${p.first ? ", " + h(p.first) : ""}</span>
        <span class="c-pc-aff"><span class="c-aff" title="${h(p.affName)} · ${h(p.affLevel)}">${h(p.aff)}</span></span>
        <span class="c-pc-pos">${h(p.position || (p.isPitcher ? "P" : ""))}${p.pos2 ? "/" + h(p.pos2) : ""}</span>
        <span class="c-pc-bt">${h(p.bats || "–")}/${h(p.throws || "–")}</span>
        <span class="c-pc-st">${p.status && p.status !== "ACT" ? `<span class="c-st">${h(p.status)}</span>` : ""}</span>
        <span class="c-pc-grp">${gs.map((g) => `<span class="c-gchip" style="--g:${g.color}">${h(g.name)}</span>`).join("")}</span>
        <span class="c-pc-in"><button class="c-intoggle ${ic ? "in" : ""}" data-ca="p-toggle" data-k="${h(p.pid)}" aria-label="${ic ? "Remove " + h(p.name) + " from camp" : "Add " + h(p.name) + " to camp"}">${ic ? ICON.check + "In camp" : ICON.plus + "Add"}</button></span>
      </div>`;
    }).join("");
    const bar = ui.psel.size ? `<div class="c-selbar" role="region" aria-label="Selection">
        <b>${ui.psel.size} selected</b>
        <button class="btn sm primary" data-ca="p-add">Add to camp</button>
        <button class="btn sm" data-ca="p-togroup">Add to group…</button>
        <button class="btn sm" data-ca="p-newgroup">New group from selection</button>
        <button class="btn sm danger" data-ca="p-remove">Remove from camp</button>
        <button class="btn sm quiet" data-ca="p-clearsel">Clear</button></div>` : "";
    el.innerHTML = head + `<div class="c-ptable" role="table" aria-label="Organization players">
      <div class="c-pr c-phead" role="row"><span class="c-pc-cb"><input type="checkbox" data-ca="p-all" ${allOn ? "checked" : ""} aria-label="Select all ${list.length} shown"></span><span class="c-pc-num">#</span><span class="c-pc-name">Player</span><span class="c-pc-aff">Affiliate</span><span class="c-pc-pos">Pos</span><span class="c-pc-bt">B/T</span><span class="c-pc-st">Status</span><span class="c-pc-grp">Camp groups</span><span class="c-pc-in">Camp</span></div>
      ${rows || `<div class="c-empty"><b>No players match these filters.</b><p><button class="c-link" data-ca="pf-clear">Clear filters</button></p></div>`}
    </div>` + bar;
    const all = el.querySelector('[data-ca="p-all"]'); if (all) all.indeterminate = nSel > 0 && !allOn;
  }
  function toggleSel(pid, i, shift) {
    const list = filtered();
    const on = !ui.psel.has(pid);
    if (shift && ui.lastIdx != null && list[ui.lastIdx]) {
      const [a, b] = [Math.min(ui.lastIdx, i), Math.max(ui.lastIdx, i)];
      for (let k = a; k <= b; k++) on ? ui.psel.add(list[k].pid) : ui.psel.delete(list[k].pid);
    } else on ? ui.psel.add(pid) : ui.psel.delete(pid);
    ui.lastIdx = i;
    renderPlayerTable();
  }

  /* =====================================================================
     GROUPS
     ===================================================================== */
  function groupsHTML(camp) {
    const used = (gid) => camp.draft.activities.filter((a) => a.groups.includes(gid)).length;
    const presets = C.PRESET_GROUPS.filter((n) => !camp.groups.some((g) => g.name.toLowerCase() === n.toLowerCase()));
    const catchers = camp.players.filter((pid) => index.get(pid) && index.get(pid).isCatcher).length;
    return `<div class="c-groups">
      <div class="c-card c-pad c-gtop">
        <div><b>Camp groups</b><p class="c-note-s">Temporary groups for this camp only. A player can be in several groups; groups never change a player's affiliate or roster. Assign a group to an activity and everyone in it is scheduled.</p></div>
        <div class="c-row"><button class="btn sm primary" data-ca="g-new">${ICON.plus} New group</button></div>
        ${presets.length ? `<div class="c-presets"><span class="c-muted">Quick add:</span>${presets.map((n) => `<button class="c-fchip" data-ca="g-preset" data-k="${h(n)}">+ ${h(n)}${n === "Catchers" && catchers ? ` <small>${catchers}</small>` : ""}</button>`).join("")}</div>` : ""}
      </div>
      ${camp.groups.length ? `<div class="c-gcards">${camp.groups.map((g) => {
        const n = used(g.id);
        return `<section class="c-card c-gcard" style="--g:${g.color}">
          <div class="c-gc-head"><input type="color" data-cf="g-color" data-k="${h(g.id)}" value="${g.color}" aria-label="Group colour"><input type="text" class="c-gname" data-cf="g-name" data-k="${h(g.id)}" value="${h(g.name)}" aria-label="Group name"><span class="c-n">${g.players.length}</span><button class="btn sm quiet c-icon" data-ca="g-del" data-k="${h(g.id)}" aria-label="Delete group ${h(g.name)}">${ICON.trash}</button></div>
          <p class="c-gc-use">${n ? "Used in " + plural(n, "activity", "activities") : "Not used in the schedule yet"}</p>
          <div class="c-gmembers">${g.players.length ? g.players.map((pid) => `<span class="c-pchip ${index.has(pid) ? "" : "gone"} ${camp.players.includes(pid) ? "" : "out"}">${h(nameOf(pid))}${index.get(pid) ? `<span class="c-aff sm">${h(index.get(pid).aff)}</span>` : ""}<button data-ca="g-rmp" data-k="${h(g.id)}" data-k2="${h(pid)}" aria-label="Remove ${h(nameOf(pid))} from ${h(g.name)}">×</button></span>`).join("") : `<span class="c-muted">No members yet — add them here or select players on the Players tab.</span>`}</div>
          <div class="c-gadd"><input type="text" data-cf="g-search" data-k="${h(g.id)}" placeholder="Add a player by name or number" autocomplete="off"><div class="c-sugg" data-sugg="${h(g.id)}"></div></div>
        </section>`;
      }).join("")}</div>` : `<div class="c-empty"><b>No groups yet.</b><p>Use the quick-add buttons above, or select players on the Players tab and choose “New group from selection”.</p></div>`}
    </div>`;
  }
  function suggestGroup(gid, q) {
    const box = main.querySelector(`[data-sugg="${CSS.escape(gid)}"]`); if (!box) return;
    const camp = cur(), g = camp.groups.find((x) => x.id === gid);
    if (!g || !q.trim()) { box.innerHTML = ""; return; }
    const hits = C.filterPool(pool.filter((p) => !g.players.includes(p.pid)), { q }).sort((a, b) => camp.players.includes(b.pid) - camp.players.includes(a.pid)).slice(0, 8);
    box.innerHTML = hits.length ? hits.map((p) => `<button class="c-sg" data-ca="g-addp" data-k="${h(gid)}" data-k2="${h(p.pid)}"><b>${h(p.name)}</b><span class="c-aff sm">${h(p.aff)}</span><small>${h([p.number ? "#" + p.number : "", p.position].filter(Boolean).join(" · "))}${camp.players.includes(p.pid) ? "" : " · adds to camp"}</small></button>`).join("") : `<p class="c-note-s">No player matches “${h(q)}”.</p>`;
  }

  /* =====================================================================
     STAFF
     ===================================================================== */
  const ROLES = ["Coordinator", "Manager", "Pitching", "Hitting", "Defense / Infield", "Outfield / Baserunning", "Catching", "Strength & Conditioning", "Athletic Trainer", "Rehab", "Other"];
  function staffHTML(camp) {
    const n = (sid) => camp.draft.activities.filter((a) => a.staff.includes(sid)).length;
    return `<div class="c-staff">
      <div class="c-card c-pad">
        <div class="c-row c-between"><div><b>Camp staff</b><p class="c-note-s">Optional. Staff assigned to activities appear as initials on the grid and get their own Coach view printout.</p></div>
          <button class="btn sm" data-ca="s-import">${ICON.users} Pick from affiliate coach lists</button></div>
        <form class="c-staffadd" id="cStaffAdd" autocomplete="off">
          <div class="field"><label for="csName">Name</label><input type="text" id="csName" placeholder="First Last"></div>
          <div class="field"><label for="csRole">Role</label><select id="csRole">${ROLES.map((r) => `<option>${h(r)}</option>`).join("")}</select></div>
          <button class="btn primary" type="submit" data-ca="s-add">${ICON.plus} Add</button>
        </form>
      </div>
      ${camp.staff.length ? `<div class="c-card"><div class="c-slist">${camp.staff.map((s) => `<div class="c-srow"><span class="c-ini lg">${h(C.initials(s.name))}</span>
        <input type="text" data-cf="s-name" data-k="${h(s.id)}" value="${h(s.name)}" aria-label="Name">
        <select data-cf="s-role" data-k="${h(s.id)}" aria-label="Role">${(ROLES.includes(s.role) || !s.role ? ROLES : ROLES.concat([s.role])).map((r) => `<option ${r === s.role ? "selected" : ""}>${h(r)}</option>`).join("")}</select>
        <span class="c-muted">${s.from ? h(s.from) + " · " : ""}${plural(n(s.id), "activity", "activities")}</span>
        <button class="btn sm quiet c-icon" data-ca="s-del" data-k="${h(s.id)}" aria-label="Remove ${h(s.name)}">${ICON.trash}</button></div>`).join("")}</div></div>`
        : `<div class="c-empty"><b>No staff yet.</b><p>Add names above, or pick from the coach lists saved in each affiliate's Resources.</p></div>`}
    </div>`;
  }
  function affiliateCoaches() {
    const out = [];
    affs().forEach((a) => {
      let list = [];
      try {
        const raw = typeof store !== "undefined" && store.getFor ? store.getFor(a.id, "cs.resources.v3") : null;
        const d = raw ? JSON.parse(raw) : null;
        list = d && Array.isArray(d.coaches) ? d.coaches : [];
      } catch (e) { list = []; }
      list.filter((c) => c && c.on !== false && (c.first || c.last)).forEach((c) => out.push({ aff: a, name: (String(c.first || "") + " " + String(c.last || "")).trim(), role: String(c.type || "") }));
    });
    return out;
  }

  /* =====================================================================
     SETUP
     ===================================================================== */
  function setupHTML(camp) {
    const dates = C.campDates(camp);
    const outside = camp.draft.activities.filter((a) => !dates.includes(a.date)).length;
    const winOpts = (v, from, to) => { let s = ""; for (let m = from; m <= to; m += 30) s += `<option value="${m}" ${m === v ? "selected" : ""}>${C.fmtTime(m)}</option>`; return s; };
    return `<div class="c-setup">
      <section class="c-card c-pad">
        <h3 class="c-h3">Camp details</h3>
        <form id="cDetails" autocomplete="off">${campFormHTML(Object.assign({ edit: true }, camp))}
          <div class="grid2"><div class="field"><label for="cfWinS">Grid starts</label><select id="cfWinS">${winOpts(camp.dayWindow.start, 300, 720)}</select></div>
          <div class="field"><label for="cfWinE">Grid ends</label><select id="cfWinE">${winOpts(camp.dayWindow.end, 600, 1440 - 30)}</select></div></div>
          <div class="field"><label for="cfNotes">Notes</label><textarea id="cfNotes" rows="2">${h(camp.notes)}</textarea></div>
          <button class="btn primary" type="submit">Save details</button>
          ${outside ? `<p class="c-note-s c-warnline">${ICON.warn} ${plural(outside, "activity", "activities")} fall outside the camp dates and are hidden. <button type="button" class="c-link" data-ca="del-outside">Delete them</button></p>` : ""}
        </form>
      </section>
      <section class="c-card c-pad">
        <div class="c-row c-between"><h3 class="c-h3">Facilities <span class="c-n">${camp.facilities.length}</span></h3><div class="c-row"><button class="btn sm" data-ca="f-preset">Add Florida complex preset</button><button class="btn sm primary" data-ca="f-add">${ICON.plus} Facility</button></div></div>
        <p class="c-note-s">Each facility is a column on the day grid. <b>Capacity</b> is the most players at once (leave blank to skip the headcount check). <b>At once</b> is how many activities may share it — 1 flags any overlap; blank lets groups share (the bullpen is one facility with capacity 8, one per mound).</p>
        ${camp.facilities.length ? `<div class="c-flist"><div class="c-frow c-fhead"><span></span><span>Name</span><span>Type</span><span>Capacity</span><span>At once</span><span></span></div>
          ${camp.facilities.map((f, i) => `<div class="c-frow">
            <span class="c-fmove"><button class="btn sm quiet c-icon" data-ca="f-up" data-k="${h(f.id)}" ${i ? "" : "disabled"} aria-label="Move ${h(f.name)} up">${ICON.up}</button><button class="btn sm quiet c-icon" data-ca="f-down" data-k="${h(f.id)}" ${i < camp.facilities.length - 1 ? "" : "disabled"} aria-label="Move ${h(f.name)} down">${ICON.down}</button></span>
            <input type="text" data-cf="f-name" data-k="${h(f.id)}" value="${h(f.name)}" aria-label="Facility name">
            <select data-cf="f-type" data-k="${h(f.id)}" aria-label="Type">${C.FACILITY_TYPES.map((t) => `<option value="${t.id}" ${t.id === f.type ? "selected" : ""}>${h(t.name)}</option>`).join("")}</select>
            <input type="number" min="1" data-cf="f-cap" data-k="${h(f.id)}" value="${f.capacity || ""}" placeholder="—" aria-label="Capacity (players)">
            <input type="number" min="1" data-cf="f-conc" data-k="${h(f.id)}" value="${f.concurrent || ""}" placeholder="any" aria-label="Activities at once">
            <button class="btn sm quiet c-icon" data-ca="f-del" data-k="${h(f.id)}" aria-label="Remove ${h(f.name)}">${ICON.trash}</button></div>`).join("")}</div>`
          : `<div class="c-empty"><b>No facilities.</b><p>Add the Florida complex preset or your own.</p></div>`}
      </section>
      <section class="c-card c-pad">
        <h3 class="c-h3">Day templates <span class="c-n">${state.templates.length}</span></h3>
        <p class="c-note-s">Save a day from the Schedule's <b>Day</b> menu; apply it to any date in any camp. Templates are shared across camps — facilities and groups are matched by name when a template is applied elsewhere.</p>
        ${state.templates.length ? `<div class="c-tlist">${state.templates.map((t) => `<div class="c-trow"><input type="text" data-cf="t-name" data-k="${h(t.id)}" value="${h(t.name)}" aria-label="Template name"><span class="c-muted">${plural(t.activities.length, "activity", "activities")}${t.source && t.source.campName ? " · from " + h(t.source.campName) : ""}</span><button class="btn sm quiet c-icon" data-ca="t-del" data-k="${h(t.id)}" aria-label="Delete template ${h(t.name)}">${ICON.trash}</button></div>`).join("")}</div>` : ""}
      </section>
      <section class="c-card c-pad c-danger">
        <h3 class="c-h3">Delete this camp</h3>
        <p class="c-note-s">Removes the camp, its groups, staff list and schedule (draft and published). Rosters are not affected. Templates stay.</p>
        <button class="btn sm danger" data-ca="camp-del">${ICON.trash} Delete “${h(camp.name)}”</button>
      </section>
    </div>`;
  }

  /* =====================================================================
     DIALOGS + MENU
     ===================================================================== */
  function openDialog(o) {
    closeDialog();
    const el = document.createElement("div");
    el.className = "c-scrim";
    el.innerHTML = `<div class="modal c-dlg ${o.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="cDlgT">
      <div class="mhead"><div><h2 id="cDlgT">${h(o.title)}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}</div><button class="x" data-dlg="close" aria-label="Close">×</button></div>
      <div class="mbody">${o.body}</div>
      <div class="mfoot">${(o.foot || []).map((b, i) => `<button class="btn ${b.cls || ""}" data-dlg="${i}" ${b.disabled ? "disabled" : ""}>${b.label}</button>`).join("")}</div></div>`;
    layer.appendChild(el);
    dlgOpen = { el, o, prev: document.activeElement };
    el.addEventListener("mousedown", (e) => { if (e.target === el) closeDialog(); });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      if (b.dataset.dlg === "close") return closeDialog();
      const btn = o.foot[+b.dataset.dlg];
      if (btn && btn.fn) { const keep = btn.fn(el.querySelector(".mbody")); if (keep !== true) closeDialog(); } else closeDialog();
    });
    if (o.mount) o.mount(el.querySelector(".mbody"), el);
    const f = el.querySelector(".mbody input:not([type=hidden]):not([type=checkbox]):not([type=radio]),.mbody select,.mbody textarea") || el.querySelector(".mfoot .btn.primary");
    if (f) f.focus();
    return el;
  }
  function closeDialog() {
    if (!dlgOpen) return;
    const prev = dlgOpen.prev; dlgOpen.el.remove(); dlgOpen = null;
    if (prev && prev.isConnected) try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  /** a one-field prompt that resolves through a callback */
  function askText(title, label, value, okLabel, fn) {
    openDialog({ title, body: `<div class="field"><label for="cAsk">${h(label)}</label><input type="text" id="cAsk" value="${h(value || "")}" autocomplete="off"></div>`,
      foot: [{ label: "Cancel" }, { label: okLabel || "Save", cls: "primary", fn: (b) => { const v = b.querySelector("#cAsk").value.trim(); if (!v) { b.querySelector("#cAsk").focus(); return true; } fn(v); } }],
      mount: (b) => { const i = b.querySelector("#cAsk"); i.select(); i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); dlgOpen.el.querySelector('.mfoot .btn.primary').click(); } }); } });
  }
  function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement("div");
    m.className = "c-menu"; m.setAttribute("role", "menu");
    m.innerHTML = items.map((it, i) => it.sep ? `<div class="c-msep"></div>` : it.head ? `<div class="c-mhead">${h(it.head)}</div>`
      : `<button role="menuitem" data-mi="${i}" class="${it.danger ? "danger" : ""}" ${it.disabled ? "disabled" : ""}>${it.label}${it.hint ? `<small>${h(it.hint)}</small>` : ""}</button>`).join("");
    layer.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
    m.style.top = (r.bottom + 6) + "px";
    m.addEventListener("click", (e) => { const b = e.target.closest("[data-mi]"); if (!b) return; const it = items[+b.dataset.mi]; closeMenu(); if (it && it.fn) it.fn(); });
    menuOpen = m;
    const first = m.querySelector("button:not([disabled])"); if (first) first.focus();
  }
  function closeMenu() { if (menuOpen) { menuOpen.remove(); menuOpen = null; } }

  /* ---------- day operations ---------- */
  function dayMenu(anchor) {
    const camp = cur(), dates = C.campDates(camp), i = dates.indexOf(ui.date);
    const n = C.activitiesOn(camp.draft.activities, ui.date).length;
    openMenu(anchor, [
      { head: C.fmtDate(ui.date, { long: true }) },
      { label: "Duplicate to next day", hint: dates[i + 1] ? C.fmtDate(dates[i + 1]) : "last camp day", disabled: !n || !dates[i + 1], fn: () => copyDayTo([dates[i + 1]]) },
      { label: "Copy this day to…", disabled: !n, fn: copyDayDialog },
      { label: "Copy another day here…", fn: copyInDialog },
      { sep: 1 },
      { label: "Save day as template…", disabled: !n, fn: saveTemplateDialog },
      { label: "Apply a template…", disabled: !state.templates.length, hint: state.templates.length ? "" : "none saved yet", fn: applyTemplateDialog },
      { sep: 1 },
      { label: "Export day as CSV", disabled: !n, fn: () => exportCSV(camp, ui.date, "draft") },
      { label: "Clear this day…", danger: true, disabled: !n, fn: () => {
        if (!window.confirm(`Delete all ${plural(n, "activity", "activities")} on ${C.fmtDate(ui.date, { long: true })}? You can undo this.`)) return;
        mutate("Clear day", (c) => C.clearDay(c, ui.date)); ui.sel = null; refresh(); say("Day cleared", { label: "Undo", fn: undo });
      } }
    ]);
  }
  function existingOn(dates) { const c = cur(); return c.draft.activities.filter((a) => dates.includes(a.date)).length; }
  function copyDayTo(targets, replace) {
    const from = ui.date;
    const r = mutate("Copy day", (c) => C.copyDay(c, from, targets, { replace: !!replace }));
    say(`Copied ${plural(r.added, "activity", "activities")} to ${targets.length === 1 ? C.fmtDate(targets[0]) : plural(targets.length, "day")}`, { label: "Open", fn: () => { ui.date = targets[0]; refresh(); } });
  }
  function copyDayDialog() {
    const camp = cur(), dates = C.campDates(camp).filter((d) => d !== ui.date);
    if (!dates.length) { say("This camp has only one day — extend it in Setup"); return; }
    const opts = (v) => dates.map((d) => `<option value="${d}" ${d === v ? "selected" : ""}>${h(C.fmtDate(d))}</option>`).join("");
    const next = dates.find((d) => d > ui.date) || dates[0];
    openDialog({ title: "Copy this day", sub: `${plural(C.activitiesOn(camp.draft.activities, ui.date).length, "activity", "activities")} from ${h(C.fmtDate(ui.date, { long: true }))}`,
      body: `<div class="grid2"><div class="field"><label for="ccFrom">To</label><select id="ccFrom">${opts(next)}</select></div>
        <div class="field"><label for="ccTo">Through (optional)</label><select id="ccTo"><option value="">Just that day</option>${opts("")}</select></div></div>
        <label class="c-check"><input type="checkbox" id="ccReplace"> <span><b>Replace what's already there</b><br><small id="ccInfo"></small></span></label>`,
      mount: (b) => {
        const upd = () => { const t = targetsFrom(b); const n = existingOn(t); b.querySelector("#ccInfo").textContent = n ? `${plural(n, "activity", "activities")} already on ${t.length === 1 ? "that day" : "those days"} — otherwise the copies are added alongside.` : "Those days are empty."; };
        b.addEventListener("change", upd); upd();
      },
      foot: [{ label: "Cancel" }, { label: "Copy", cls: "primary", fn: (b) => { const t = targetsFrom(b); if (!t.length) return true; copyDayTo(t, b.querySelector("#ccReplace").checked); } }] });
    function targetsFrom(b) {
      const a = b.querySelector("#ccFrom").value, z = b.querySelector("#ccTo").value;
      return (z && z > a ? C.dateRange(a, z) : [a]).filter((d) => d !== ui.date && C.campDates(cur()).includes(d));
    }
  }
  function copyInDialog() {
    const camp = cur(), dates = C.campDates(camp).filter((d) => d !== ui.date && camp.draft.activities.some((a) => a.date === d));
    if (!dates.length) { say("No other day has activities yet"); return; }
    openDialog({ title: "Copy another day here", sub: "Into " + h(C.fmtDate(ui.date, { long: true })),
      body: `<div class="field"><label for="ciFrom">Copy from</label><select id="ciFrom">${dates.map((d) => `<option value="${d}">${h(C.fmtDate(d))} — ${plural(C.activitiesOn(camp.draft.activities, d).length, "activity", "activities")}</option>`).join("")}</select></div>
        ${existingOn([ui.date]) ? `<label class="c-check"><input type="checkbox" id="ciReplace" checked> <span><b>Replace this day's ${plural(existingOn([ui.date]), "activity", "activities")}</b></span></label>` : ""}`,
      foot: [{ label: "Cancel" }, { label: "Copy here", cls: "primary", fn: (b) => {
        const from = b.querySelector("#ciFrom").value, rep = b.querySelector("#ciReplace"), to = ui.date;
        const r = mutate("Copy day", (c) => C.copyDay(c, from, [to], { replace: rep ? rep.checked : false }));
        say(`Copied ${plural(r.added, "activity", "activities")} from ${C.fmtDate(from)}`);
      } }] });
  }
  function saveTemplateDialog() {
    const camp = cur();
    askText("Save day as template", "Template name", `${C.fmtDate(ui.date, { long: true }).split(",")[0]} plan — ${camp.name}`, "Save template", (name) => {
      mutate("Save template", (c) => { state.templates.push(C.templateFromDay(c, ui.date, name)); });
      say(`Template “${name}” saved`);
    });
  }
  function applyTemplateDialog() {
    const n = existingOn([ui.date]);
    openDialog({ title: "Apply a template", sub: "To " + h(C.fmtDate(ui.date, { long: true })),
      body: `<div class="c-tpick">${state.templates.map((t, i) => `<label class="c-check"><input type="radio" name="ctpl" value="${h(t.id)}" ${i ? "" : "checked"}> <span><b>${h(t.name)}</b><br><small>${plural(t.activities.length, "activity", "activities")}${t.source && t.source.campName ? " · from " + h(t.source.campName) : ""}</small></span></label>`).join("")}</div>
        ${n ? `<label class="c-check"><input type="checkbox" id="ctReplace" checked> <span><b>Replace this day's ${plural(n, "activity", "activities")}</b><br><small>Unchecked, the template's activities are added alongside.</small></span></label>` : ""}`,
      foot: [{ label: "Cancel" }, { label: "Apply template", cls: "primary", fn: (b) => {
        const id = (b.querySelector('input[name="ctpl"]:checked') || {}).value, t = state.templates.find((x) => x.id === id); if (!t) return true;
        const rep = b.querySelector("#ctReplace");
        const r = mutate("Apply template", (c) => C.applyTemplate(c, t, ui.date, { replace: rep ? rep.checked : false }));
        const miss = [r.facilities.length ? "facilities: " + r.facilities.join(", ") : "", r.groups.length ? "groups: " + r.groups.join(", ") : "", r.staff.length ? "staff: " + r.staff.join(", ") : ""].filter(Boolean);
        say(`Applied “${t.name}” — ${plural(r.added, "activity", "activities")}` + (miss.length ? `. Not found in this camp — ${miss.join("; ")}` : ""));
      } }] });
  }

  /* ---------- publish ---------- */
  function publishDialog() {
    const camp = cur(), d = C.diffPublished(camp);
    const errs = C.conflicts(camp, { index }).filter((c) => c.level === "error").length;
    const line = (a) => `<li><b>${h(a.title)}</b> <span class="c-muted">${h(C.fmtDate(a.date))} · ${h(C.fmtSpan(a.start, a.dur))} · ${h(facName(camp, a.facilityId))}</span></li>`;
    const list = (arr, fn) => arr.slice(0, 10).map(fn).join("") + (arr.length > 10 ? `<li class="c-muted">…and ${arr.length - 10} more</li>` : "");
    const nothing = !d.total && !d.firstPublish;
    const body = nothing ? `<p>Nothing has changed since the last publish (${h(fmtInstant(camp.published.at, camp.tz))}).</p>` : `
      <div class="c-diffsum"><span class="add">${d.added.length} added</span><span class="chg">${d.changed.length} changed</span><span class="rem">${d.removed.length} removed</span></div>
      ${d.firstPublish ? `<p class="c-note-s">First publish: printouts and exports will read this version until you publish again.</p>` : ""}
      ${d.added.length ? `<h4 class="c-h4">Added</h4><ul class="c-dlist add">${list(d.added, line)}</ul>` : ""}
      ${d.changed.length ? `<h4 class="c-h4">Changed</h4><ul class="c-dlist chg">${list(d.changed, (c) => `<li><b>${h(c.after.title)}</b> <span class="c-muted">${h(C.fmtDate(c.after.date))} · ${h(c.labels.join(", "))}</span>${c.fields.includes("start") || c.fields.includes("dur") || c.fields.includes("date") ? ` <span class="c-muted">(${h(C.fmtSpan(c.before.start, c.before.dur))} → ${h(C.fmtSpan(c.after.start, c.after.dur))})</span>` : ""}</li>`)}</ul>` : ""}
      ${d.removed.length ? `<h4 class="c-h4">Removed</h4><ul class="c-dlist rem">${list(d.removed, line)}</ul>` : ""}
      ${d.groups.added.length + d.groups.changed.length + d.groups.removed.length ? `<p class="c-note-s"><b>Groups:</b> ${[d.groups.added.length ? d.groups.added.length + " new" : "", d.groups.changed.length ? d.groups.changed.length + " changed (" + h(d.groups.changed.join(", ")) + ")" : "", d.groups.removed.length ? d.groups.removed.length + " removed" : ""].filter(Boolean).join(" · ")}</p>` : ""}
      ${d.facilitiesChanged ? `<p class="c-note-s"><b>Facilities</b> changed.</p>` : ""}${d.staffChanged ? `<p class="c-note-s"><b>Staff</b> list changed.</p>` : ""}
      ${errs ? `<p class="c-warnline">${ICON.warn} ${plural(errs, "conflict")} still open — you can publish anyway.</p>` : ""}`;
    const foot = [{ label: "Cancel" }];
    if (camp.published && d.total) foot.push({ label: "Discard changes", cls: "danger", fn: () => {
      if (!window.confirm("Throw away every change since the last publish? You can undo this.")) return true;
      mutate("Discard changes", (c) => C.revertToPublished(c), { render: "all" }); say("Draft reset to the published version", { label: "Undo", fn: undo });
    } });
    if (!nothing) foot.push({ label: d.firstPublish ? "Publish" : "Publish changes", cls: "primary", fn: () => {
      mutate("Publish", (c) => C.publish(c));
      say("Published — printouts now use this version");
    } });
    openDialog({ title: d.firstPublish ? "Publish camp schedule" : "Publish changes", sub: h(camp.name), body, foot });
  }

  /* =====================================================================
     PRINT + CSV
     ===================================================================== */
  function printDialog() {
    const camp = cur();
    const pubAt = camp.published ? fmtInstant(camp.published.at, camp.tz) : "";
    const kinds = [["daily", "Daily schedule", "Full facility grid — admin copy (landscape)"], ["coach", "Coach view", "Each staff member's activities"], ["player", "Player view", "Each player's itinerary — “where do I need to be”"], ["facility", "Facility view", "Bookings per station"]];
    openDialog({ title: "Print / export", sub: h(camp.name), wide: true,
      body: `<div class="c-pkinds">${kinds.map(([k, l, s], i) => `<label class="c-pkind"><input type="radio" name="cpk" value="${k}" ${i ? "" : "checked"}><span><b>${l}</b><small>${s}</small></span></label>`).join("")}</div>
        <div class="grid3">
          <div class="field"><label for="cpDays">Days</label><select id="cpDays"><option value="day">${h(C.fmtDate(ui.date))} only</option><option value="all">Whole camp (${C.campDates(camp).length} days)</option></select></div>
          <div class="field"><label for="cpVer">Version</label><select id="cpVer">${camp.published ? `<option value="published">Published · ${h(pubAt)}</option>` : ""}<option value="draft">Draft (marked DRAFT)</option></select></div>
          <div class="field" id="cpGrpF"><label for="cpGrp">Players</label><select id="cpGrp"><option value="">Everyone scheduled</option>${camp.groups.map((g) => `<option value="${h(g.id)}">${h(g.name)}</option>`).join("")}</select></div>
        </div>
        ${camp.published ? (C.hasUnpublished(camp) ? `<p class="c-warnline">${ICON.info} The draft has unpublished changes. Published is what staff and players should see.</p>` : "") : `<p class="c-warnline">${ICON.info} Nothing published yet, so printouts use the draft and are marked DRAFT.</p>`}`,
      foot: [{ label: ICON.download + " CSV of the day", fn: (b) => { exportCSV(camp, ui.date, b.querySelector("#cpVer").value); return true; } }, { label: "Cancel" },
        { label: ICON.print + " Preview", cls: "primary", fn: (b) => {
          const kind = b.querySelector('input[name="cpk"]:checked').value;
          openPrint(kind, b.querySelector("#cpDays").value, b.querySelector("#cpVer").value, b.querySelector("#cpGrp").value);
        } }] });
  }
  function exportCSV(camp, date, ver) {
    const v = C.versionView(camp, ver);
    const csv = C.dayCSV(v, date, nameOf);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${camp.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "camp"}-${date}${v._version === "draft" ? "-draft" : ""}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say("CSV downloaded");
  }
  function openPrint(kind, days, ver, grp) {
    const camp = cur(), v = C.versionView(camp, ver);
    const dates = days === "all" ? C.campDates(camp) : [ui.date];
    const draft = v._version === "draft";
    const stamp = draft ? "DRAFT — not published" : "Published " + fmtInstant(v._at, camp.tz);
    const head = (title, d) => `<div class="c-sh-head"><div><div class="c-sh-eyebrow">${h(camp.name)}${camp.location ? " · " + h(camp.location) : ""}</div><h1>${h(title)}</h1><div class="c-sh-date">${h(C.fmtDate(d, { long: true, year: true }))} · times ${h(C.tzAbbr(camp.tz, d))}</div></div><div class="c-sh-stamp ${draft ? "draft" : ""}">${h(stamp)}</div></div>`;
    let pages = "";
    dates.forEach((d) => {
      const acts = C.activitiesOn(v.draft.activities, d);
      if (kind === "daily") pages += `<section class="c-sheet land">${head("Daily schedule", d)}${printGrid(v, d, acts)}</section>`;
      else if (kind === "coach") pages += `<section class="c-sheet">${head("Coach view", d)}${printCoach(v, d)}</section>`;
      else if (kind === "facility") pages += `<section class="c-sheet">${head("Facility view", d)}${printFacility(v, d)}</section>`;
      else pages += `<section class="c-sheet">${head("Player itineraries", d)}${printPlayers(v, d, grp)}</section>`;
    });
    printRoot.innerHTML = `<div class="c-pv-bar"><button class="btn sm" data-ca="print-close">${ICON.left} Back</button><b>${h({ daily: "Daily schedule", coach: "Coach view", player: "Player view", facility: "Facility view" }[kind])}</b><span class="c-muted">${dates.length === 1 ? h(C.fmtDate(dates[0])) : plural(dates.length, "day")} · ${draft ? "Draft" : "Published"}</span><span class="c-tb-sp"></span><button class="btn sm primary" data-ca="print-go">${ICON.print} Print</button></div>
      <div class="c-pv-pages ${draft ? "draft" : ""} ${kind === "daily" ? "land" : "port"}">${pages}</div>`;
    printRoot.hidden = false;
    printRoot.dataset.orient = kind === "daily" ? "landscape" : "portrait";
    root.classList.add("printing");
    printRoot.scrollTop = 0;
    const b = printRoot.querySelector('[data-ca="print-go"]'); if (b) b.focus();
  }
  function closePrint() { printRoot.hidden = true; printRoot.innerHTML = ""; root.classList.remove("printing"); }
  function doPrint() {
    let rule = document.getElementById("campPageRule");
    if (!rule) { rule = document.createElement("style"); rule.id = "campPageRule"; document.head.appendChild(rule); }
    rule.textContent = `@page{size:Letter ${printRoot.dataset.orient || "portrait"};margin:.35in}`;
    const done = () => { rule.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  }
  function printGrid(v, d, acts) {
    if (!acts.length) return `<p class="c-sh-empty">Nothing scheduled.</p>`;
    const known = new Set(v.facilities.map((f) => f.id));
    const cols = v.facilities.filter((f) => acts.some((a) => a.facilityId === f.id)).map((f) => ({ id: f.id, name: f.name }));
    if (acts.some((a) => !a.facilityId || !known.has(a.facilityId))) cols.push({ id: "", name: "No facility" });
    const win = gridWindow(v, acts);
    const ppm = Math.min(1.6, 600 / (win.end - win.start));
    const H = (win.end - win.start) * ppm;
    let labels = ""; for (let m = win.start; m < win.end; m += 30) labels += `<div class="c-ptl ${m % 60 ? "half" : ""}" style="top:${(m - win.start) * ppm}px">${m % 60 ? C.fmtTime(m, { ampm: false }) : C.fmtTime(m, { short: true })}</div>`;
    return `<div class="c-pgrid" style="--cols:${cols.length};--ppm:${ppm}">
      <div class="c-pgrow head"><div></div>${cols.map((c) => `<div class="c-pgh">${h(c.name)}</div>`).join("")}</div>
      <div class="c-pgrow" style="height:${H}px"><div class="c-ptimes">${labels}</div>
      ${cols.map((c) => {
        const list = acts.filter((a) => (c.id ? a.facilityId === c.id : !a.facilityId || !known.has(a.facilityId))), lanes = C.layoutLanes(list);
        return `<div class="c-pgcol" style="background-size:100% ${30 * ppm}px">${list.map((a) => {
          const l = lanes[a.id], res = C.resolvePlayers(a, v);
          const gs = a.groups.map((g) => v.groups.find((x) => x.id === g)).filter(Boolean).map((g) => g.name);
          const st = a.staff.map((s) => v.staff.find((x) => x.id === s)).filter(Boolean).map((s) => C.initials(s.name));
          return `<div class="c-pblk" style="--cat:${C.catOf(a.cat).color};top:${(a.start - win.start) * ppm}px;height:${a.dur * ppm}px;left:calc(${l.lane} * 100% / ${l.lanes});width:calc(100% / ${l.lanes})"><b>${h(a.title)}</b><span>${h(C.fmtSpan(a.start, a.dur))}${res.size ? " · " + res.size + "p" : ""}${st.length ? " · " + h(st.join(" ")) : ""}</span>${gs.length ? `<span>${h(gs.join(", "))}</span>` : ""}</div>`;
        }).join("")}</div>`;
      }).join("")}</div>
    </div>
    <div class="c-plegend">${C.CATEGORIES.filter((c) => acts.some((a) => a.cat === c.id)).map((c) => `<span style="--cat:${c.color}">${h(c.name)}</span>`).join("")}${v.staff.length ? `<span class="c-muted">${h(v.staff.map((s) => C.initials(s.name) + " " + s.name).join(" · "))}</span>` : ""}</div>`;
  }
  function whoText(v, a) {
    const gs = a.groups.map((g) => v.groups.find((x) => x.id === g)).filter(Boolean).map((g) => g.name);
    const n = C.resolvePlayers(a, v).size;
    return [gs.join(", "), a.players.length ? a.players.map(nameOf).join(", ") : ""].filter(Boolean).join(" + ") + ` (${n})`;
  }
  function printCoach(v, d) {
    const rows = C.byStaff(v, d);
    if (!rows.length) return `<p class="c-sh-empty">No camp staff listed. Add staff on the Staff tab to print coach sheets.</p>`;
    const busy = rows.filter((r) => r.acts.length), idle = rows.filter((r) => !r.acts.length);
    return busy.map((r) => `<div class="c-pcard"><div class="c-pc-h"><b>${h(r.staff.name)}</b><span>${h(r.staff.role)}</span></div>
      <table class="c-ptab"><thead><tr><th>Time</th><th>Activity</th><th>Where</th><th>Players</th></tr></thead><tbody>${r.acts.map((a) => `<tr><td class="t">${h(C.fmtSpan(a.start, a.dur))}</td><td><b>${h(a.title)}</b>${a.notes ? `<div class="n">${h(a.notes)}</div>` : ""}</td><td>${h(facName(v, a.facilityId))}</td><td>${h(whoText(v, a))}</td></tr>`).join("")}</tbody></table></div>`).join("")
      + (idle.length ? `<p class="c-sh-foot">No assignments: ${h(idle.map((r) => r.staff.name).join(", "))}</p>` : "")
      + (!busy.length ? `<p class="c-sh-empty">No staff are assigned to activities this day.</p>` : "");
  }
  function printFacility(v, d) {
    const rows = C.byFacility(v, d).filter((r) => r.acts.length);
    if (!rows.length) return `<p class="c-sh-empty">Nothing scheduled.</p>`;
    return rows.map((r) => `<div class="c-pcard"><div class="c-pc-h"><b>${h(r.facility.name)}</b><span>${r.facility.capacity ? "Capacity " + r.facility.capacity : ""}</span></div>
      <table class="c-ptab"><thead><tr><th>Time</th><th>Activity</th><th>Players</th><th>Staff</th></tr></thead><tbody>${r.acts.map((a) => `<tr><td class="t">${h(C.fmtSpan(a.start, a.dur))}</td><td><b>${h(a.title)}</b></td><td>${h(whoText(v, a))}</td><td>${h(a.staff.map((s) => (v.staff.find((x) => x.id === s) || { name: "" }).name).filter(Boolean).join(", "))}</td></tr>`).join("")}</tbody></table></div>`).join("");
  }
  function printPlayers(v, d, grp) {
    let pids = v.players.slice();
    if (grp) { const g = v.groups.find((x) => x.id === grp); pids = g ? g.players.slice() : []; }
    pids.sort((a, b) => ((index.get(a) || {}).sortName || a).localeCompare((index.get(b) || {}).sortName || b));
    const cards = [], none = [];
    pids.forEach((pid) => {
      const it = C.itinerary(v, pid, d), p = index.get(pid);
      if (!it.length) { none.push(nameOf(pid)); return; }
      cards.push(`<div class="c-pcard pl"><div class="c-pc-h"><b>${h(nameOf(pid))}</b><span>${p ? h([p.number ? "#" + p.number : "", p.position, p.aff].filter(Boolean).join(" · ")) : ""}</span></div>
        <table class="c-ptab"><tbody>${it.map(({ act: a, via }) => `<tr><td class="t">${h(C.fmtSpan(a.start, a.dur))}</td><td><b>${h(a.title)}</b>${via.length ? `<div class="n">${h(via.join(", "))}</div>` : ""}</td><td>${h(facName(v, a.facilityId))}</td><td>${h(a.staff.map((s) => (v.staff.find((x) => x.id === s) || { name: "" }).name).filter(Boolean).map(C.initials).join(" "))}</td></tr>`).join("")}</tbody></table></div>`);
    });
    if (!pids.length) return `<p class="c-sh-empty">No players in ${grp ? "this group" : "the camp"} yet.</p>`;
    return `<div class="c-pcols">${cards.join("")}</div>${none.length ? `<p class="c-sh-foot">Not scheduled this day: ${h(none.join(", "))}</p>` : ""}`;
  }

  /* =====================================================================
     EVENTS
     ===================================================================== */
  function bind() {
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("keydown", onKey);
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", () => { if (drag) { drag = null; renderSchedMain(); } });
    document.addEventListener("pointerdown", (e) => { if (menuOpen && !menuOpen.contains(e.target)) closeMenu(); }, true);
    window.addEventListener("resize", () => { if (root && root.isConnected && ui.tab === "schedule" && ui.view !== "week") { /* layout is CSS-driven */ } });
  }

  function onSubmit(e) {
    e.preventDefault();
    const f = e.target;
    if (f.id === "cCreateForm") return createFromForm(f);
    if (f.id === "cDetails") {
      const v = readCampForm(f), err = f.querySelector("#cfErr");
      if (v.err) { if (err) err.textContent = v.err; return; }
      const ws = +f.querySelector("#cfWinS").value, we = +f.querySelector("#cfWinE").value;
      if (we <= ws) { if (err) err.textContent = "The grid must end after it starts."; return; }
      mutate("Edit camp details", (c) => {
        Object.assign(c, { name: v.name, start: v.start, end: v.end, location: v.location, tz: v.tz, notes: f.querySelector("#cfNotes").value, dayWindow: { start: ws, end: we } });
      }, { render: "all" });
      say("Camp details saved");
      return;
    }
    if (f.id === "cStaffAdd") {
      const name = f.querySelector("#csName").value.trim(); if (!name) { f.querySelector("#csName").focus(); return; }
      const role = f.querySelector("#csRole").value;
      mutate("Add staff", (c) => { c.staff.push({ id: C.uid("s"), name, role, from: "" }); }, { render: "all" });
      const n = main.querySelector("#csName"); if (n) n.focus();
    }
  }

  function onClick(e) {
    const t = e.target.closest("[data-ca]");
    if (!t || !root.contains(t)) {
      // click on an empty grid slot adds an activity there
      const col = e.target.closest(".c-gcol");
      if (col && e.target === col && !drag) {
        const r = col.getBoundingClientRect();
        const m = gridMeta.win.start + Math.floor((e.clientY - r.top) / PPM / 15) * 15;
        addActivityAt(ui.date, m, col.dataset.fid || null);
      }
      return;
    }
    const a = t.dataset.ca, k = t.dataset.k, k2 = t.dataset.k2;
    const camp = cur();
    switch (a) {
      case "banner-x": storageNote = ""; render(); return;
      case "create-camp": return; // handled by submit
      case "new-camp": return newCampDialog();
      case "tab": ui.tab = k; if (k !== "schedule") ui.sel = null; render(); return;
      case "undo": return undo();
      case "publish": return publishDialog();
      case "print": return printDialog();
      case "print-close": return closePrint();
      case "print-go": return doPrint();
      case "day-prev": case "day-next": {
        const ds = C.campDates(camp), i = ds.indexOf(ui.date) + (a === "day-next" ? 1 : -1);
        if (ds[i]) { ui.date = ds[i]; ui.sel = null; refresh(); }
        return;
      }
      case "view": ui.view = k; ui.weekOf = null; if (k === "week") ui.sel = null; refresh(); return;
      case "conf-toggle": ui.confOpen = !ui.confOpen; renderSchedMain(); return;
      case "conf-go": {
        const ids = k.split(","); ui.date = k2; if (ui.view === "week") ui.view = narrow() ? "agenda" : "grid";
        ui.flash = ids; ui.sel = ids[0]; ui.confOpen = false; refresh(); return;
      }
      case "day-menu": return dayMenu(t);
      case "add-act": return addActivityAt(ui.date, nextFreeStart(camp), ui.view === "agenda" && ui.facFilter ? ui.facFilter : (camp.facilities[0] || {}).id);
      case "copy-day-in": return copyInDialog();
      case "apply-tpl": return applyTemplateDialog();
      case "open-act": return openActivity(k);
      case "open-day": ui.date = k; ui.view = narrow() ? "agenda" : "grid"; ui.sel = k2 || null; if (k2) ui.flash = [k2]; refresh(); return;
      case "week-prev": case "week-next": ui.weekOf = C.addDays(C.weekStart(ui.weekOf || ui.date), a === "week-next" ? 7 : -7); renderSchedMain(); return;
      case "panel-close": { const id = ui.sel; ui.sel = null; refresh(); const b = id && main.querySelector(`.c-blk[data-aid="${id}"]`); if (b) b.focus({ preventScroll: true }); return; }
      case "dup-act": {
        const c2 = mutate("Duplicate activity", (c) => C.duplicateActivity(c, ui.sel), { render: "none" });
        if (c2) { ui.flash = [c2.id]; openActivity(c2.id); say("Duplicated — placed right after the original"); }
        return;
      }
      case "del-act": return deleteActivity(ui.sel);
      case "a-rmp": mutate("Remove player", () => { const x = actById(ui.sel); x.players = x.players.filter((p) => p !== k); }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-addp": {
        mutate("Add player", () => { const x = actById(ui.sel); if (!x.players.includes(k)) x.players.push(k); }, { keepPanel: true });
        renderPanel(); const s = main.querySelector("#caPSearch"); if (s) s.focus(); return;
      }
      /* players */
      case "pf-aff": { const s = new Set(ui.pf.affs); s.has(k) ? s.delete(k) : s.add(k); ui.pf.affs = Array.from(s); renderBody(); return; }
      case "pf-clear": ui.pf = blankFilter(); renderBody(); return;
      case "p-cb": e.stopPropagation(); toggleSel(k, +t.dataset.i, e.shiftKey); return;
      case "p-row": if (e.target.closest("button,input,a")) return; toggleSel(k, +t.dataset.i, e.shiftKey); return;
      case "p-all": { const list = filtered(); const all = list.every((p) => ui.psel.has(p.pid)); list.forEach((p) => (all ? ui.psel.delete(p.pid) : ui.psel.add(p.pid))); renderPlayerTable(); return; }
      case "p-clearsel": ui.psel.clear(); ui.lastIdx = null; renderPlayerTable(); return;
      case "p-toggle": {
        const inC = camp.players.includes(k);
        if (inC && usedBy(camp, [k]) && !window.confirm(`Remove ${nameOf(k)} from the camp? They'll also come off this camp's groups and activities.`)) return;
        mutate(inC ? "Remove player from camp" : "Add player to camp", (c) => (inC ? C.removePlayersFromCamp(c, [k]) : C.addPlayersToCamp(c, [k])), { keepBody: true });
        renderPlayerTable(); refreshTop(); return;
      }
      case "p-add": { const n = mutate("Add players to camp", (c) => C.addPlayersToCamp(c, Array.from(ui.psel)), { keepBody: true }); say(n ? `Added ${plural(n, "player")} to the camp` : "Already in the camp"); ui.psel.clear(); renderPlayerTable(); refreshTop(); return; }
      case "p-addfiltered": { const list = filtered(); const n = mutate("Add players to camp", (c) => C.addPlayersToCamp(c, list.map((p) => p.pid)), { keepBody: true }); say(n ? `Added ${plural(n, "player")} to the camp` : "Everyone shown is already in the camp"); renderPlayerTable(); refreshTop(); return; }
      case "p-remove": {
        const ids = Array.from(ui.psel).filter((p) => camp.players.includes(p));
        if (!ids.length) { say("None of the selected players are in the camp"); return; }
        if (!window.confirm(`Remove ${plural(ids.length, "player")} from the camp? They'll also come off this camp's groups and activities. Rosters are not changed.`)) return;
        mutate("Remove players from camp", (c) => C.removePlayersFromCamp(c, ids), { keepBody: true }); ui.psel.clear(); renderPlayerTable(); refreshTop(); say(`Removed ${plural(ids.length, "player")} from the camp`, { label: "Undo", fn: undo }); return;
      }
      case "p-newgroup": case "p-groupfilter": {
        const ids = a === "p-newgroup" ? Array.from(ui.psel) : filtered().map((p) => p.pid);
        const def = a === "p-groupfilter" ? (C.filterLabel(ui.pf, camp, affs()) || "All players") : "Group " + (camp.groups.length + 1);
        askText("New camp group", `Name for a group of ${plural(ids.length, "player")}`, def, "Create group", (name) => {
          mutate("Create group", (c) => { C.addPlayersToCamp(c, ids); C.addGroup(c, name, ids); }, { keepBody: true });
          if (a === "p-newgroup") ui.psel.clear();
          renderBody(); refreshTop(); say(`Group “${name}” created with ${plural(ids.length, "player")}`);
        });
        return;
      }
      case "p-togroup": {
        if (!camp.groups.length) { say("No groups yet — use “New group from selection”"); return; }
        const ids = Array.from(ui.psel);
        openMenu(t, [{ head: "Add " + plural(ids.length, "player") + " to" }].concat(camp.groups.map((g) => ({ label: `<i class="c-dot" style="background:${g.color}"></i>${h(g.name)}`, hint: String(g.players.length), fn: () => {
          mutate("Add to group", (c) => { C.addPlayersToCamp(c, ids); const gg = c.groups.find((x) => x.id === g.id); gg.players = Array.from(new Set(gg.players.concat(ids))); }, { keepBody: true });
          ui.psel.clear(); renderBody(); refreshTop(); say(`Added to ${g.name}`);
        } }))));
        return;
      }
      /* groups */
      case "g-new": askText("New camp group", "Group name", "Group " + (camp.groups.length + 1), "Create group", (name) => mutate("Create group", (c) => C.addGroup(c, name, []), { render: "all" })); return;
      case "g-preset": {
        const ids = k === "Catchers" ? camp.players.filter((pid) => index.get(pid) && index.get(pid).isCatcher) : [];
        mutate("Create group", (c) => C.addGroup(c, k, ids), { render: "all" });
        say(ids.length ? `“${k}” created with the camp's ${plural(ids.length, "catcher")}` : `“${k}” created — add members below`);
        return;
      }
      case "g-del": {
        const g = camp.groups.find((x) => x.id === k); if (!g) return;
        const n = camp.draft.activities.filter((x) => x.groups.includes(k)).length;
        if (!window.confirm(`Delete the group “${g.name}”?${n ? ` It's assigned to ${plural(n, "activity", "activities")}; those activities lose it.` : ""} Players stay in the camp.`)) return;
        mutate("Delete group", (c) => C.removeGroup(c, k), { render: "all" }); say("Group deleted", { label: "Undo", fn: undo }); return;
      }
      case "g-rmp": mutate("Remove from group", (c) => { const g = c.groups.find((x) => x.id === k); g.players = g.players.filter((p) => p !== k2); }, { render: "all" }); return;
      case "g-addp": {
        mutate("Add to group", (c) => { C.addPlayersToCamp(c, [k2]); const g = c.groups.find((x) => x.id === k); if (!g.players.includes(k2)) g.players.push(k2); }, { render: "all" });
        const inp = main.querySelector(`[data-cf="g-search"][data-k="${CSS.escape(k)}"]`); if (inp) inp.focus(); return;
      }
      /* staff */
      case "s-add": return; // submit
      case "s-del": {
        const s = camp.staff.find((x) => x.id === k); if (!s) return;
        const n = camp.draft.activities.filter((x) => x.staff.includes(k)).length;
        if (n && !window.confirm(`Remove ${s.name}? They're assigned to ${plural(n, "activity", "activities")}.`)) return;
        mutate("Remove staff", (c) => { c.staff = c.staff.filter((x) => x.id !== k); c.draft.activities.forEach((x) => { x.staff = x.staff.filter((y) => y !== k); }); }, { render: "all" }); return;
      }
      case "s-import": return importStaffDialog();
      /* setup */
      case "f-add": mutate("Add facility", (c) => { c.facilities.push({ id: C.uid("f"), name: "New facility", type: "other", capacity: null, concurrent: 1 }); }, { render: "all" });
        { const ins = main.querySelectorAll('[data-cf="f-name"]'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } } return;
      case "f-preset": {
        const have = new Set(camp.facilities.map((f) => f.name.toLowerCase()));
        const add = C.presetFacilities().filter((f) => !have.has(f.name.toLowerCase()));
        if (!add.length) { say("Every preset facility is already here"); return; }
        mutate("Add preset facilities", (c) => { c.facilities = c.facilities.concat(add); }, { render: "all" }); say(`Added ${plural(add.length, "facility", "facilities")}`); return;
      }
      case "f-up": case "f-down": mutate("Reorder facilities", (c) => {
        const i = c.facilities.findIndex((f) => f.id === k), j = i + (a === "f-up" ? -1 : 1);
        if (i < 0 || j < 0 || j >= c.facilities.length) return; const [f] = c.facilities.splice(i, 1); c.facilities.splice(j, 0, f);
      }, { render: "all" }); { const b = main.querySelector(`[data-ca="${a}"][data-k="${CSS.escape(k)}"]`); if (b && !b.disabled) b.focus(); } return;
      case "f-del": {
        const f = camp.facilities.find((x) => x.id === k); if (!f) return;
        const n = camp.draft.activities.filter((x) => x.facilityId === k).length;
        if (!window.confirm(`Remove ${f.name}?${n ? ` ${plural(n, "activity", "activities")} booked there will have no facility.` : ""}`)) return;
        mutate("Remove facility", (c) => { c.facilities = c.facilities.filter((x) => x.id !== k); c.draft.activities.forEach((x) => { if (x.facilityId === k) x.facilityId = null; }); }, { render: "all" }); return;
      }
      case "t-del": {
        const tp = state.templates.find((x) => x.id === k); if (!tp || !window.confirm(`Delete the template “${tp.name}”?`)) return;
        mutate("Delete template", () => { state.templates = state.templates.filter((x) => x.id !== k); }, { render: "all" }); return;
      }
      case "del-outside": {
        const ds = C.campDates(camp), n = camp.draft.activities.filter((x) => !ds.includes(x.date)).length;
        if (!window.confirm(`Delete ${plural(n, "activity", "activities")} outside the camp dates?`)) return;
        mutate("Delete activities outside the dates", (c) => { c.draft.activities = c.draft.activities.filter((x) => ds.includes(x.date)); }, { render: "all" }); return;
      }
      case "camp-del": {
        if (!window.confirm(`Delete the camp “${camp.name}” with its groups, staff and schedule? Rosters are not affected. You can undo this right after.`)) return;
        mutate("Delete camp", () => { state.camps = state.camps.filter((c) => c.id !== camp.id); state.activeCampId = state.camps[0] ? state.camps[0].id : null; }, { render: "none" });
        ui.tab = "schedule"; ui.sel = null; ui.date = null; render(); say("Camp deleted", { label: "Undo", fn: undo }); return;
      }
    }
  }
  function refreshTop() { const top = main.querySelector("#cTop"), camp = cur(); if (top && camp) top.innerHTML = topHTML(camp); }
  function usedBy(camp, pids) { const s = new Set(pids); return camp.groups.some((g) => g.players.some((p) => s.has(p))) || camp.draft.activities.some((a) => a.players.some((p) => s.has(p))); }
  function deleteActivity(id) {
    const a = actById(id); if (!a) return;
    if (!window.confirm(`Delete “${a.title}” (${C.fmtSpan(a.start, a.dur)})?`)) return;
    mutate("Delete activity", (c) => C.removeActivity(c, id), { render: "none" });
    if (ui.sel === id) ui.sel = null;
    refresh();
    say(`Deleted “${a.title}”`, { label: "Undo", fn: undo });
  }
  function importStaffDialog() {
    const camp = cur(), list = affiliateCoaches();
    const have = new Set(camp.staff.map((s) => s.name.toLowerCase()));
    const byAff = {}; list.forEach((c, i) => { (byAff[c.aff.id] = byAff[c.aff.id] || { aff: c.aff, rows: [] }).rows.push(Object.assign({ i }, c)); });
    const body = list.length ? `<p class="c-note-s">Names as entered in each affiliate's Resources → coach list. Only the name and role are copied into this camp.</p>
      ${Object.values(byAff).map((g) => `<div class="c-imp"><div class="c-imp-h"><span class="c-aff">${h(g.aff.short)}</span>${h(g.aff.team)}</div>
        <div class="c-cks">${g.rows.map((c) => `<label class="c-ck ${have.has(c.name.toLowerCase()) ? "dis" : ""}"><input type="checkbox" value="${c.i}" ${have.has(c.name.toLowerCase()) ? "disabled checked" : ""}>${h(c.name)}<small>${h(c.role)}</small></label>`).join("")}</div></div>`).join("")}`
      : `<p>No affiliate has a saved coach list yet. Coach lists live in each affiliate's <b>Resources</b>; add names here directly instead.</p>`;
    openDialog({ title: "Pick staff from affiliate coach lists", wide: true, body,
      foot: [{ label: "Cancel" }].concat(list.length ? [{ label: "Add selected", cls: "primary", fn: (b) => {
        const picks = Array.from(b.querySelectorAll("input[type=checkbox]:checked:not(:disabled)")).map((x) => list[+x.value]);
        if (!picks.length) return true;
        mutate("Add staff", (c) => { const seen = new Set(c.staff.map((s) => s.name.toLowerCase())); picks.forEach((p) => { if (seen.has(p.name.toLowerCase())) return; seen.add(p.name.toLowerCase()); c.staff.push({ id: C.uid("s"), name: p.name, role: mapRole(p.role), from: p.aff.short }); }); }, { render: "all" });
        say(`Added ${plural(picks.length, "staff member")}`);
      } }] : []) });
  }
  function mapRole(t) {
    const s = String(t || "").toLowerCase();
    return /pitch/.test(s) ? "Pitching" : /hit/.test(s) ? "Hitting" : /strength/.test(s) ? "Strength & Conditioning" : /athletic|train/.test(s) ? "Athletic Trainer" : /defen/.test(s) ? "Defense / Infield" : /coord/.test(s) ? "Coordinator" : t || "Other";
  }

  function onInput(e) {
    const t = e.target, cf = t.dataset.cf; if (!cf) return;
    if (cf === "pf-q") { ui.pf.q = t.value; renderPlayerTable(); return; }
    if (cf === "a-psearch") { suggestPlayers(t.value); return; }
    if (cf === "g-search") { suggestGroup(t.dataset.k, t.value); return; }
  }
  function onChange(e) {
    const t = e.target, cf = t.dataset.cf; if (!cf) return;
    const camp = cur(), v = t.value, k = t.dataset.k;
    const a = ui.sel ? actById(ui.sel) : null;
    switch (cf) {
      case "camp-switch":
        if (v === "__new") { t.value = camp.id; return newCampDialog(); }
        state.activeCampId = v; persist(); ui.date = null; ui.sel = null; ui.psel.clear(); ui.pf = blankFilter(); render(); return;
      case "day": ui.date = v; ui.sel = null; refresh(); return;
      case "fac-filter": ui.facFilter = v; renderSchedMain(); return;
      /* activity editor */
      case "a-title": if (!a) return; mutate("Rename activity", () => {
        a.title = v.trim() || "Activity";
        const lib = catalogue().find((x) => x.title.toLowerCase() === a.title.toLowerCase());
        if (lib) { if (a.cat === "other") a.cat = lib.cat; if (a.title !== lib.title) a.title = lib.title; }
      }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-cat": if (!a) return; mutate("Change category", () => { a.cat = v; }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-fac": if (!a) return; mutate("Change facility", () => { a.facilityId = v || null; }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-date": if (!a) return; mutate("Change day", () => { a.date = v; }, { keepPanel: true }); ui.date = v; refresh(); return;
      case "a-start": { if (!a) return; const m = C.parseTime(v); if (m == null) { t.value = C.toHHMM(a.start); return; }
        mutate("Change start", () => { a.start = C.clamp(C.snap(m, 5), 0, 1440 - a.dur); }, { keepPanel: true }); renderPanelKeepFocus(); return; }
      case "a-dur": if (!a) return; mutate("Change length", () => { a.dur = C.clamp(+v, 5, 1440 - a.start); }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-group": if (!a) return; mutate(t.checked ? "Assign group" : "Unassign group", () => { a.groups = t.checked ? Array.from(new Set(a.groups.concat(v))) : a.groups.filter((g) => g !== v); }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-staff": if (!a) return; mutate(t.checked ? "Assign staff" : "Unassign staff", () => { a.staff = t.checked ? Array.from(new Set(a.staff.concat(v))) : a.staff.filter((s) => s !== v); }, { keepPanel: true }); renderPanelKeepFocus(); return;
      case "a-notes": if (!a) return; mutate("Edit notes", () => { a.notes = v; }, { keepPanel: true }); return;
      /* players filters */
      case "pf-role": case "pf-position": case "pf-throws": case "pf-bats": case "pf-status": case "pf-group": case "pf-incamp":
        ui.pf[{ "pf-role": "role", "pf-position": "position", "pf-throws": "throws", "pf-bats": "bats", "pf-status": "status", "pf-group": "group", "pf-incamp": "inCamp" }[cf]] = v;
        ui.lastIdx = null; renderPlayerTable(); return;
      /* groups */
      case "g-name": mutate("Rename group", (c) => { const g = c.groups.find((x) => x.id === k); if (g) g.name = v.trim() || g.name; }, { keepBody: true }); return;
      case "g-color": mutate("Recolour group", (c) => { const g = c.groups.find((x) => x.id === k); if (g) g.color = v; }, { keepBody: true }); { const card = t.closest(".c-gcard"); if (card) card.style.setProperty("--g", v); } return;
      /* staff */
      case "s-name": mutate("Rename staff", (c) => { const s = c.staff.find((x) => x.id === k); if (s && v.trim()) s.name = v.trim(); }, { keepBody: true }); return;
      case "s-role": mutate("Change staff role", (c) => { const s = c.staff.find((x) => x.id === k); if (s) s.role = v; }, { keepBody: true }); return;
      /* facilities */
      case "f-name": mutate("Rename facility", (c) => { const f = c.facilities.find((x) => x.id === k); if (f && v.trim()) f.name = v.trim(); }, { keepBody: true }); return;
      case "f-type": mutate("Change facility type", (c) => { const f = c.facilities.find((x) => x.id === k); if (f) f.type = v; }, { keepBody: true }); return;
      case "f-cap": case "f-conc": mutate(cf === "f-cap" ? "Change capacity" : "Change activities at once", (c) => {
        const f = c.facilities.find((x) => x.id === k); if (!f) return;
        const n = v === "" ? null : Math.max(1, Math.round(+v)) || null;
        f[cf === "f-cap" ? "capacity" : "concurrent"] = n;
      }, { keepBody: true }); return;
      case "t-name": mutate("Rename template", () => { const tp = state.templates.find((x) => x.id === k); if (tp && v.trim()) tp.name = v.trim(); }, { keepBody: true }); return;
    }
  }
  function newCampDialog() {
    const tz = (cur() || {}).tz || C.DEFAULT_TZ, today = C.nowIn(tz).date;
    openDialog({ title: "New camp", sub: "Players, groups and staff are chosen per camp.", body: campFormHTML({ start: today, end: C.addDays(today, 6), tz }),
      mount: (b) => bindTzSelect(b),
      foot: [{ label: "Cancel" }, { label: "Create camp", cls: "primary", fn: (b) => (createFromForm(b) ? undefined : true) }] });
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    const t = e.target;
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      if (menuOpen) { closeMenu(); e.stopPropagation(); return; }
      if (dlgOpen) { closeDialog(); e.stopPropagation(); return; }
      if (!printRoot.hidden) { closePrint(); e.stopPropagation(); return; }
      if (ui.sel && t.closest && t.closest("#cPanel")) { ui.sel = null; refresh(); e.stopPropagation(); return; }
    }
    if (meta && e.key.toLowerCase() === "z" && !e.shiftKey && !(t.matches && t.matches("input[type=text],input[type=search],textarea"))) {
      e.preventDefault(); e.stopPropagation(); undo(); return;
    }
    if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const items = Array.from(menuOpen.querySelectorAll("button:not([disabled])")); const i = items.indexOf(document.activeElement);
      const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); e.preventDefault(); e.stopPropagation(); return;
    }
    const blk = t.classList && t.classList.contains("c-blk") ? t : null;
    if (!blk) return;
    const a = actById(blk.dataset.aid); if (!a) return;
    const id = a.id;
    const step = e.shiftKey ? 15 : 5;
    const camp = cur();
    let handled = true;
    if (e.key === "Enter" || e.key === " ") openActivity(id);
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey) {
      const d = e.key === "ArrowUp" ? -step : step;
      mutate("Change length", () => { a.dur = C.clamp(a.dur + d, 5, 1440 - a.start); }, { coalesce: "dur:" + id });
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const d = e.key === "ArrowUp" ? -step : step;
      mutate("Move activity", () => { a.start = C.clamp(a.start + d, 0, 1440 - a.dur); }, { coalesce: "move:" + id });
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const cols = (gridMeta ? gridMeta.cols : []).map((c) => c.id);
      const i = cols.indexOf(a.facilityId && camp.facilities.some((f) => f.id === a.facilityId) ? a.facilityId : "");
      const j = C.clamp(i + (e.key === "ArrowLeft" ? -1 : 1), 0, cols.length - 1);
      if (j !== i) mutate("Move activity", () => { a.facilityId = cols[j] || null; }, { coalesce: "move:" + id });
    } else if (e.key === "Delete" || e.key === "Backspace") deleteActivity(id);
    else if (meta && e.key.toLowerCase() === "d") { const c2 = mutate("Duplicate activity", (c) => C.duplicateActivity(c, id)); if (c2) { const nb = main.querySelector(`.c-blk[data-aid="${c2.id}"]`); if (nb) nb.focus(); } return e.preventDefault(), e.stopPropagation(); }
    else handled = false;
    if (handled) {
      e.preventDefault(); e.stopPropagation();
      const nb = main.querySelector(`.c-blk[data-aid="${id}"]`); if (nb && document.activeElement !== nb && !(e.key === "Enter" || e.key === " ")) nb.focus({ preventScroll: false });
    }
  }

  /* ---------- pointer drag on the day grid (mouse, pen and touch) ---------- */
  function onPointerDown(e) {
    const blk = e.target.closest(".c-gcol .c-blk"); if (!blk || e.button > 0) return;
    const a = actById(blk.dataset.aid); if (!a) return;
    const wrap = main.querySelector("#cGridWrap");
    const cols = Array.from(main.querySelectorAll(".c-gcol")).map((c) => { const r = c.getBoundingClientRect(); return { fid: c.dataset.fid, left: r.left + wrap.scrollLeft, right: r.right + wrap.scrollLeft }; });
    const fid = a.facilityId && cur().facilities.some((f) => f.id === a.facilityId) ? a.facilityId : "";
    drag = { blk, a, rsz: !!e.target.closest(".c-rsz"), x0: e.clientX, y0: e.clientY, sx0: wrap.scrollLeft, sy0: wrap.scrollTop, wrap, cols,
      col0: cols.find((c) => c.fid === fid) || cols[0], start: a.start, dur: a.dur, fid, moved: false, nStart: a.start, nDur: a.dur, nFid: fid };
    try { blk.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
    blk.focus({ preventScroll: true });
  }
  function onPointerMove(e) {
    if (!drag) return;
    const d = drag, w = d.wrap;
    // auto-scroll near the edges of the grid's own scroller
    const wr = w.getBoundingClientRect();
    if (e.clientY > wr.bottom - 28) w.scrollTop += 12; else if (e.clientY < wr.top + 56) w.scrollTop -= 12;
    const dy = e.clientY - d.y0 + (w.scrollTop - d.sy0), dx = e.clientX - d.x0 + (w.scrollLeft - d.sx0);
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; d.blk.classList.add("dragging"); }
    const win = gridMeta.win;
    if (d.rsz) {
      d.nDur = C.clamp(C.snap(d.dur + dy / PPM, 5), 5, Math.min(1440, win.end) - d.start);
      d.blk.style.height = d.nDur * PPM + "px";
    } else {
      d.nStart = C.clamp(C.snap(d.start + dy / PPM, 5), win.start, win.end - d.dur);
      d.blk.style.top = (d.nStart - win.start) * PPM + "px";
      const x = e.clientX + w.scrollLeft;
      const col = d.cols.find((c) => x >= c.left && x < c.right) || (x < d.cols[0].left ? d.cols[0] : x >= d.cols[d.cols.length - 1].right ? d.cols[d.cols.length - 1] : null);
      if (col) { d.nFid = col.fid; d.blk.style.transform = `translateX(${col.left - d.col0.left}px)`; d.blk.style.left = "2px"; d.blk.style.width = "calc(100% - 4px)"; }
      main.querySelectorAll(".c-gcol.drop").forEach((c) => c.classList.remove("drop"));
      const ce = main.querySelector(`.c-gcol[data-fid="${CSS.escape(d.nFid)}"]`); if (ce) ce.classList.add("drop");
    }
    const tm = d.blk.querySelector(".c-blk-time"); if (tm) tm.textContent = C.fmtSpan(d.nStart, d.nDur);
  }
  function onPointerUp() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { openActivity(d.a.id); return; }
    const changed = d.nStart !== d.start || d.nDur !== d.dur || d.nFid !== d.fid;
    if (!changed) { renderSchedMain(); return; }
    mutate(d.rsz ? "Resize activity" : "Move activity", () => {
      d.a.start = d.nStart; d.a.dur = d.nDur;
      if (d.nFid !== d.fid) d.a.facilityId = d.nFid || null;
    }, { keepPanel: ui.sel !== d.a.id });
    const nb = main.querySelector(`.c-blk[data-aid="${d.a.id}"]`); if (nb) nb.focus({ preventScroll: true });
  }

  /* =====================================================================
     PUBLIC
     ===================================================================== */
  function show(el) {
    if (!el) return;
    if (host !== el || !root || !el.contains(root)) {
      host = el;
      el.innerHTML = `<div class="camp"><div class="c-main"></div><div class="c-layer"></div><div class="c-printroot" hidden></div></div>`;
      root = el.querySelector(".camp"); main = root.querySelector(".c-main"); layer = root.querySelector(".c-layer"); printRoot = root.querySelector(".c-printroot");
      bind();
    }
    closeDialog(); closeMenu(); if (printRoot && !printRoot.hidden) closePrint();
    loadAll();
    render();
  }

  window.CampUI = { show, ready: true, _debug: { state: () => state, ui, pool: () => pool } };
})();
