/* ==========================================================================
   Manager Hub — customizable dashboard (the Hub view)
   Widgets built from the app's existing data (today's schedule, games, roster,
   monthly plan, camps, modules). "Customize" turns on an editing mode: drag to
   reorder (pointer events — mouse, pen, touch), arrow buttons as the keyboard /
   accessible alternative, four widths, hide, add back, reset.
   The layout is a per-browser preference (localStorage "cs.dashboard.v1"): there
   are no user accounts to sync it across devices.
   ========================================================================== */
(function () {
  "use strict";
  const KEY = "cs.dashboard.v1";
  const SIZES = ["s", "m", "l", "xl"];                 // grid spans 4 / 6 / 8 / 12 of 12 columns
  const SIZE_NAME = { s: "Small", m: "Medium", l: "Large", xl: "Full width" };
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  // "today" in the affiliate's time zone (index.html Today / games/games-core.js DateCore)
  const isoToday = () => (typeof Today !== "undefined" ? Today.iso() : window.DateCore.todayIn(null));
  const addDays = (iso, n) => window.DateCore.addDays(iso, n);
  const shortDate = (iso) => { try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch (e) { return iso; } };
  // the app's state lives in top-level bindings of the main script (not window properties)
  const SCHED = () => (typeof S !== "undefined" && S ? S : null);
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const icon = (p) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    today: icon('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>'),
    describe: icon('<path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z"/>'),
    roster: icon('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M15.6 14.2c2.4.2 4.2 1.9 4.9 4.8"/>'),
    games: icon('<circle cx="12" cy="12" r="8.4"/><path d="M6.4 6.4c2.3 1.9 3.4 4 3.4 5.6s-1.1 3.7-3.4 5.6M17.6 6.4c-2.3 1.9-3.4 4-3.4 5.6s1.1 3.7 3.4 5.6"/>'),
    month: icon('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h3M13.5 13h3M7.5 16.8h3"/>'),
    camp: icon('<path d="M3.5 20h17"/><path d="M5.5 20V9.5L12 4l6.5 5.5V20"/><path d="M10 20v-5h4v5"/>'),
    modules: icon('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g></svg>'
  };

  /* ------------------------------------------------------------ widgets */
  const W = {
    today: { title: "Day schedule", size: "l", render: wToday },
    describe: { title: "Describe your day", size: "s", render: wDescribe },
    roster: { title: "Roster & availability", size: "s", render: wRoster },
    games: { title: "Games", size: "s", render: wGames },
    orggames: { title: "Around the organization", size: "m", render: wOrgGames, optIn: true },
    month: { title: "Next 7 days", size: "s", render: wMonth },
    camp: { title: "Camps", size: "s", render: wCamp },
    modules: { title: "Modules", size: "xl", render: wModules }
  };
  // the day planner above the widgets (hub/planner.js) covers today's schedule and building a day, so those two
  // widgets start hidden (still under "Add widget"); the Organization games widget is opt-in
  const DEFAULT = { v: 2, order: ["games", "roster", "month", "camp", "modules", "today", "describe", "orggames"], hidden: ["today", "describe", "orggames"], size: { games: "m", roster: "s", month: "s" } };

  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.order)) d = JSON.parse(JSON.stringify(DEFAULT));
    d.order = d.order.filter((id) => W[id]);
    // new widgets appear for existing users — except opt-in ones, which wait in "Add widget"
    Object.keys(W).forEach((id) => { if (!d.order.includes(id)) { d.order.push(id); if (W[id].optIn && !(d.hidden || []).includes(id)) (d.hidden = d.hidden || []).push(id); } });
    d.hidden = (d.hidden || []).filter((id) => W[id]);
    // once: layouts from before the day planner hide the two widgets it replaces (a person can add them back)
    if (!d.v || d.v < 2) { ["today", "describe"].forEach((id) => { if (!d.hidden.includes(id)) d.hidden.push(id); }); d.v = 2; save(d); }
    d.size = d.size || {};
    return d;
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  const sizeOf = (d, id) => d.size[id] || W[id].size;
  // the Camp widget shows once the Camp module is complete (it sets CampUI.ready)
  // Camps: the Complex workspace only, once the module is complete (it sets CampUI.ready)
  const available = (id) => id !== "camp" || !!(window.CampUI && window.CampUI.ready && typeof store !== "undefined" && store.affiliate() === "fcl");

  let editing = false, layout = null;

  function render(host) {
    if (!host) return;
    layout = load();
    const visible = layout.order.filter((id) => !layout.hidden.includes(id) && available(id));
    host.classList.add("dash");
    host.classList.toggle("editing", editing);
    host.innerHTML = (editing ? editBar() : "") +
      (visible.length ? visible.map((id) => card(id)).join("") : `<div class="dash-empty"><b>Your dashboard is empty</b><span>Add widgets back with <i>Add widget</i>, or reset to the default layout.</span></div>`);
    bind(host);
  }
  function editBar() {
    const hid = layout.hidden.filter(available);
    return `<div class="dash-editbar" role="toolbar" aria-label="Customize dashboard">
      <span class="dash-editbar-t"><b>Customizing</b> Drag widgets by their handle, or use the arrows. Changes save as you go.</span>
      <span class="sp"></span>
      <div class="dash-add"><button class="btn sm" data-dash="add" aria-haspopup="true" aria-expanded="false" ${hid.length ? "" : "disabled"}>Add widget${hid.length ? ` (${hid.length})` : ""}</button>
        <div class="dash-addmenu" hidden>${hid.map((id) => `<button data-dash-add="${id}">${I[id] || ""}<span>${h(W[id].title)}</span></button>`).join("")}</div></div>
      <button class="btn sm quiet" data-dash="reset">Reset layout</button>
      <button class="btn sm primary" data-dash="done">Done</button>
    </div>`;
  }
  function card(id) {
    const w = W[id], sz = sizeOf(layout, id);
    let body = ""; try { body = w.render(); } catch (e) { console.error(e); body = `<p class="dash-muted">This widget couldn't load.</p>`; }
    const i = layout.order.filter((x) => !layout.hidden.includes(x) && available(x)).indexOf(id);
    return `<section class="dash-w size-${sz}" data-w="${id}" aria-label="${h(w.title)}">
      <header class="dash-wh">
        ${editing ? `<button class="dash-grip" data-grip="${id}" aria-label="Drag to move ${h(w.title)}" title="Drag to move">${I.grip}</button>` : ""}
        <span class="dash-wi">${I[id] || ""}</span><h3>${h(w.title)}</h3>
        ${editing ? `<span class="dash-tools">
          <button class="dash-tool" data-move="-1" data-id="${id}" aria-label="Move ${h(w.title)} earlier" ${i === 0 ? "disabled" : ""}>←</button>
          <button class="dash-tool" data-move="1" data-id="${id}" aria-label="Move ${h(w.title)} later">→</button>
          <button class="dash-tool wide" data-size="${id}" aria-label="Width: ${SIZE_NAME[sz]} — change" title="Change width">${SIZE_NAME[sz]}</button>
          <button class="dash-tool" data-hide="${id}" aria-label="Hide ${h(w.title)}" title="Hide">×</button></span>` : ""}
      </header>
      <div class="dash-wb">${body}</div>
    </section>`;
  }

  /* ---------------------------------------------------------- bindings */
  function bind(host) {
    qa("[data-go]", host).forEach((b) => (b.onclick = () => { const v = b.dataset.go; if (v === "roster") return rosterModal(); if (v === "games") return gamesModal(); if (v === "orggames") return gamesModal("org"); if (v === "resources") return resourcesModal(); go(v); }));
    qa("[data-hubi]", host).forEach((b) => (b.onclick = () => { const t = (window.HUB_ACTIONS_LIST || [])[+b.dataset.hubi]; if (t) t.go(); }));
    const dy = q("#dashDescribe", host);
    if (dy) {
      const run = () => { const t = dy.value.trim(); if (window.DayUI) DayUI.open(t ? { text: t, run: true } : {}); };
      q("[data-describe]", host).onclick = run;
      dy.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); });
    }
    if (!editing) return;
    const add = q('[data-dash="add"]', host), menu = q(".dash-addmenu", host);
    if (add) add.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; add.setAttribute("aria-expanded", String(!menu.hidden)); };
    qa("[data-dash-add]", host).forEach((b) => (b.onclick = () => { const id = b.dataset.dashAdd; layout.hidden = layout.hidden.filter((x) => x !== id); layout.order = layout.order.filter((x) => x !== id).concat(id); commit(host, `${W[id].title} added`); }));
    q('[data-dash="reset"]', host).onclick = () => { if (!confirm("Reset the dashboard to the default layout? Hidden widgets come back and sizes reset.")) return; layout = JSON.parse(JSON.stringify(DEFAULT)); commit(host, "Dashboard reset"); };
    q('[data-dash="done"]', host).onclick = () => setEditing(false, host);
    qa("[data-hide]", host).forEach((b) => (b.onclick = () => { const id = b.dataset.hide; layout.hidden.push(id); commit(host, `${W[id].title} hidden — bring it back with Add widget`); }));
    qa("[data-size]", host).forEach((b) => (b.onclick = () => { const id = b.dataset.size; const cur = sizeOf(layout, id); layout.size[id] = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length]; commit(host, null, `[data-size="${id}"]`); }));
    qa("[data-move]", host).forEach((b) => (b.onclick = () => move(b.dataset.id, +b.dataset.move, host)));
    qa("[data-grip]", host).forEach((g) => g.addEventListener("pointerdown", (e) => startDrag(e, g.dataset.grip, host)));
    qa("[data-grip]", host).forEach((g) => g.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(g.dataset.grip, -1, host, `[data-grip="${g.dataset.grip}"]`); }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(g.dataset.grip, 1, host, `[data-grip="${g.dataset.grip}"]`); }
    }));
  }
  function commit(host, msg, refocus) {
    if (!editing) return;
    save(layout); render(host);
    if (msg && typeof toast === "function") toast(msg);
    if (refocus) { const el = q(refocus, host); if (el) el.focus(); }
  }
  function move(id, dir, host, refocus) {
    const vis = layout.order.filter((x) => !layout.hidden.includes(x) && available(x));
    const i = vis.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    [vis[i], vis[j]] = [vis[j], vis[i]];
    layout.order = vis.concat(layout.order.filter((x) => !vis.includes(x)));
    commit(host, null, refocus || `[data-move="${dir}"][data-id="${id}"]`);
  }
  function setEditing(on, host) {
    editing = on;
    const b = document.getElementById("dashCustomize");
    if (b) { b.setAttribute("aria-pressed", String(on)); b.hidden = on; }
    const el = host || document.getElementById("hubGrid");
    render(el);
    const f = on ? q('[data-dash="done"]', el) : b; if (f) f.focus();
  }

  /* ---- drag: a live placeholder follows the pointer; drop commits the new order ---- */
  function startDrag(e, id, host) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const el = q(`[data-w="${id}"]`, host); if (!el) return;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add("dash-ghost"); ghost.style.width = r.width + "px"; ghost.style.height = r.height + "px";
    ghost.style.left = r.left + "px"; ghost.style.top = r.top + "px";
    document.body.appendChild(ghost);
    el.classList.add("dash-placeholder");
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let target = null;
    const onMove = (ev) => {
      ghost.style.left = ev.clientX - dx + "px"; ghost.style.top = ev.clientY - dy + "px";
      const over = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList && n.classList.contains("dash-w") && n !== ghost && !ghost.contains(n));
      if (over && over !== el) {
        const rr = over.getBoundingClientRect();
        const after = ev.clientY > rr.top + rr.height / 2 || (ev.clientX > rr.left + rr.width / 2 && ev.clientY > rr.top);
        if (after) over.after(el); else over.before(el);
        target = true;
      }
      const edge = 60;                                          // auto-scroll near the viewport edges
      if (ev.clientY < edge) window.scrollBy(0, -12); else if (ev.clientY > innerHeight - edge) window.scrollBy(0, 12);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", onUp);
      ghost.remove(); el.classList.remove("dash-placeholder");
      if (target) {
        const vis = qa(".dash-w", host).map((n) => n.dataset.w);
        layout.order = vis.concat(layout.order.filter((x) => !vis.includes(x)));
        save(layout);
      }
      render(host);
    };
    document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp); document.addEventListener("pointercancel", onUp);
  }
  document.addEventListener("click", (e) => { const m = q(".dash-addmenu:not([hidden])"); if (m && !e.target.closest(".dash-add")) m.hidden = true; });

  /* ------------------------------------------------------------ widget bodies */
  const btn = (go, label, cls = "") => `<button class="btn sm ${cls}" data-go="${go}">${h(label)}</button>`;
  function wToday() {
    const st = SCHED(), m = (st && st.meta) || {};
    const secs = ((st && st.sections) || []).filter((s) => s.kind !== "lineup");
    const team = secs.find((s) => /all players|team|staff/i.test(s.name || "")) || secs[0];
    const rows = (team && team.rows || []).filter((r) => r.time || r.activity).slice(0, 7);
    const groups = secs.filter((s) => s !== team && (s.rows || []).length);
    const game = m.opponent ? `${m.homeAway === "away" ? "@" : "vs"} ${h(m.opponent)}${m.firstPitch ? ` · ${h(typeof prettyTime === "function" ? prettyTime(m.firstPitch) : m.firstPitch)}` : ""}` : "No game";
    const when = m.date ? (typeof longDate === "function" ? longDate(m.date) : m.date) : "No date set";
    const notToday = m.date && m.date !== isoToday();
    return `<div class="dash-today-h"><b>${h(when)}${notToday ? ` <span class="dash-chip" title="The day open in the Daily builder isn't today">Open day · not today</span>` : ""}</b><span>${game}${m.gameLocation ? ` · ${h(m.gameLocation)}` : ""}</span></div>
      ${rows.length ? `<ol class="dash-rows">${rows.map((r) => `<li><time>${h(r.time || "")}</time><span>${h(String(r.activity || "").replace(/:$/, ""))}</span><em>${h(r.location || "")}</em></li>`).join("")}</ol>
        <p class="dash-muted">${groups.length ? `${groups.length} group schedule${groups.length > 1 ? "s" : ""}: ${groups.slice(0, 4).map((g) => h(g.name)).join(", ")}${groups.length > 4 ? "…" : ""}` : "No group schedules yet."}</p>`
        : `<div class="dash-empty-in"><span>Nothing scheduled for this day yet.</span></div>`}
      <div class="dash-actions">${btn("schedule", "Open the day", "primary")}${btn("print", "Print & export")}</div>`;
  }
  function wDescribe() {
    return `<p class="dash-muted">Say what has to happen — Manager Hub builds the timeline and flags anything that won't fit.</p>
      <textarea id="dashDescribe" class="dash-ta" rows="3" placeholder="10 AM stretch, 1 PM game. Team fundy, indy defense, 30-minute BP rounds, 30 off pregame."></textarea>
      <div class="dash-actions"><button class="btn sm primary" data-describe>Build the day</button></div>`;
  }
  function wRoster() {
    const R = typeof Roster !== "undefined" ? Roster : null;
    const list = safe(() => (R && R.loaded() ? R.all() : []), []);
    if (!list.length) return `<div class="dash-empty-in"><span>No roster yet.</span></div><div class="dash-actions">${btn("roster", "Import roster", "primary")}</div>`;
    const pit = list.filter((p) => p.group === "pitcher").length;
    const out = list.filter((p) => p.status && !/^(ACT|ACTIVE)$/i.test(p.status));
    const byStatus = {}; out.forEach((p) => { (byStatus[p.status] = byStatus[p.status] || []).push(p); });
    const name = (p) => [p.first, p.last].filter(Boolean).join(" ");
    return `<div class="dash-stats"><div><b>${list.length - pit}</b><span>Position</span></div><div><b>${pit}</b><span>Pitchers</span></div><div class="${out.length ? "warn" : ""}"><b>${out.length}</b><span>Unavailable</span></div></div>
      ${out.length ? `<ul class="dash-list">${Object.keys(byStatus).sort().map((s) => `<li><span class="dash-chip">${h(s)}</span><span>${byStatus[s].slice(0, 4).map((p) => h(name(p))).join(", ")}${byStatus[s].length > 4 ? ` +${byStatus[s].length - 4}` : ""}</span></li>`).join("")}</ul>` : `<p class="dash-muted">Everyone on the roster is active.</p>`}
      <div class="dash-actions">${btn("roster", "Open roster")}</div>`;
  }
  function wGames() {
    const G = typeof Games !== "undefined" ? Games : null, U = window.GamesUI;
    const today = isoToday();
    const todays = safe(() => G.listForDate(today), []);
    const up = safe(() => G.all().filter((g) => g.date > today && g.status !== "canceled").slice(0, 4), []);
    if (!todays.length && !up.length) return `<div class="dash-empty-in"><span>No upcoming games on file.</span></div><div class="dash-actions">${btn("games", "Games")}</div>`;
    const card = (g) => (U ? U.card(g, { compact: true }) : h(g.opponent));
    return `${todays.length ? `<p class="dash-k">Today</p><div class="dash-gtoday">${todays.map(card).join("")}</div>` : `<p class="dash-muted">No game today.</p>`}
      ${up.length ? `<p class="dash-k">${todays.length ? "Next" : "Next game"}</p><ul class="dash-glist">${up.map((g, i) => `<li${!todays.length && i === 0 ? ' class="next"' : ""}><b>${h(shortDate(g.date))}</b>${card(g)}</li>`).join("")}</ul>` : ""}
      <div class="dash-actions">${btn("games", "All games")}${btn("orggames", "Organization")}</div>`;
  }
  /* opt-in: every affiliate's game today — who's home, who's on the road, who's off */
  function wOrgGames() {
    const U = window.GamesUI, C = window.GamesCore;
    if (!U || !C || typeof AFFILIATES === "undefined") return "";
    const today = isoToday();
    const rows = AFFILIATES.map((a) => ({ a, games: safe(() => C.forDate(C.migrate(localStorage.getItem(`cs.${a.id}.games`)), today), []) }));
    return `<ul class="dash-org">${rows.map((r) => `<li><span class="dash-org-t"><b>${h(r.a.short)}</b><em>${h(r.a.level.split(" ")[0])}</em></span>${r.games.length ? r.games.map((g) => U.card(g, { compact: true, tz: r.a.tz, aff: r.a.id })).join("") : '<span class="dash-muted">Off</span>'}</li>`).join("")}</ul>
      <div class="dash-actions">${btn("orggames", "Organization board")}</div>`;
  }
  function wMonth() {
    const M = typeof Month !== "undefined" ? Month : null;
    const start = isoToday();
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const rows = days.map((iso) => ({ iso, labels: safe(() => M.labels(iso), []) }));
    const any = rows.some((r) => r.labels.length);
    return `<ul class="dash-week">${rows.map((r) => `<li class="${r.iso === start ? "is-today" : ""}"><b>${h(shortDate(r.iso))}</b><span>${r.labels.length ? r.labels.slice(0, 4).map((l) => `<i class="dash-cat" style="--c:${h(safe(() => M.color(l), "#8A94A6"))}">${h(l)}</i>`).join("") : '<em class="dash-muted">—</em>'}${r.labels.length > 4 ? `<em class="dash-muted">+${r.labels.length - 4}</em>` : ""}</span></li>`).join("")}</ul>
      ${any ? "" : `<p class="dash-muted">Nothing planned this week.</p>`}<div class="dash-actions">${btn("month", "Monthly planner")}</div>`;
  }
  function wCamp() {
    let data = null; try { data = JSON.parse(localStorage.getItem("cs.camp.v1") || "null"); } catch (e) { data = null; }
    const camps = (data && Array.isArray(data.camps) ? data.camps : []).filter((c) => !c.archived);
    const start = (c) => c.startDate || c.start || "", end = (c) => c.endDate || c.end || start(c);
    const today = isoToday();
    const live = camps.filter((c) => start(c) <= today && end(c) >= today);
    const next = camps.filter((c) => start(c) > today).sort((a, b) => start(a).localeCompare(start(b)));
    const show = live.concat(next).slice(0, 3);
    if (!show.length) return `<div class="dash-empty-in"><span>${camps.length ? "No current or upcoming camps." : "No camps yet. Camps schedule workouts for players from every affiliate."}</span></div><div class="dash-actions">${btn("camp", camps.length ? "Open Camp" : "Create a camp", "primary")}</div>`;
    return `<ul class="dash-list">${show.map((c) => `<li><span class="dash-chip ${live.includes(c) ? "live" : ""}">${live.includes(c) ? "Now" : "Next"}</span><span><b>${h(c.name || "Camp")}</b><em>${h(c.location || "")}${c.location ? " · " : ""}${h(shortDate(start(c)))}${end(c) && end(c) !== start(c) ? ` – ${h(shortDate(end(c)))}` : ""}</em></span></li>`).join("")}</ul>
      <div class="dash-actions">${btn("camp", "Open Camp")}</div>`;
  }
  function wModules() {
    const list = window.HUB_ACTIONS_LIST || [];
    return `<div class="dash-mods">${list.map((t, i) => `<button class="dash-mod" data-hubi="${i}"><b>${h(t.title)}</b><span>${h(t.meta || t.desc || "")}</span></button>`).join("")}</div>`;
  }

  window.Dashboard = { render, setEditing, get editing() { return editing; }, KEY, DEFAULT };
  // this script loads after the app booted: take over the Hub now (the Describe widget replaces the intro card)
  const intro = document.getElementById("mhaIntro"); if (intro) intro.remove();
  try { if (typeof renderHub === "function" && typeof VIEW !== "undefined" && VIEW === "hub") renderHub(); } catch (e) { console.error(e); }
})();
