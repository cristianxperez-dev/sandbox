/* Manager Hub — the affiliate page's day planner: Select a date → Build (or Edit) Daily Schedule.
   A month calendar (every date tappable; games and schedule status marked) beside the selected date: its game,
   its schedule (none / draft / published) and one primary action. Building opens Build Daily Schedule
   (assistant/day-ui.js openBuilder) — by hand on the standard game-day plan, empty, or described by text / voice.
   Opens on today (the affiliate's time zone); a date picked here holds for the session. */
(function () {
  "use strict";
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const D = () => window.DateCore;
  const KEY = () => "cs.hubdate." + (store.affiliate() || "");
  let sel = null, ym = null, chooser = false;
  const today = () => Today.iso();
  const long = (iso, o) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, o || { weekday: "long", month: "long", day: "numeric" });
  const fmt = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;

  function selected() {
    if (!sel) { try { sel = sessionStorage.getItem(KEY()) || null; } catch (e) { sel = null; } }
    if (!sel || !/^\d{4}-\d{2}-\d{2}$/.test(sel)) sel = today();
    if (!ym) ym = sel.slice(0, 7);
    return sel;
  }
  function pick(iso) { sel = iso; ym = iso.slice(0, 7); chooser = false; try { sessionStorage.setItem(KEY(), iso); } catch (e) {} }

  /** the latest saved day for each date (+ the open day) — for status dots without loading every day */
  function statusMap() {
    const out = {};
    try { index().forEach((x) => { if (!out[x.date]) out[x.date] = dayStatus(x.date); }); } catch (e) {}
    if (S && S.meta && S.meta.date) out[S.meta.date] = dayStatus(S.meta.date);
    return out;
  }
  function dayOf(iso) {
    if (S && S.meta && S.meta.date === iso) return S;
    const hit = index().filter((x) => x.date === iso).sort((a, b) => b.saved - a.saved)[0];
    return hit ? loadById(hit.id) : null;
  }
  /** a short look at the day's schedule: the published rows, or the draft plan's blocks */
  function preview(day) {
    if (!day) return [];
    if (day.meta && day.meta.dayPlan && day.meta.dayPlan.request && window.DayEngine) {
      try { return DayEngine.Solve.solve(DayEngine.Solve.normalize(day.meta.dayPlan.request), {}).items.filter((i) => i.kind !== "free").sort((a, b) => a.start - b.start).map((i) => ({ t: i.kind === "game" ? fmt(i.start) : `${fmt(i.start)}`, a: i.kind === "game" ? "Game" : i.label })); } catch (e) { return []; }
    }
    return (day.sections || []).filter((s) => s.kind !== "lineup").flatMap((s) => (s.rows || []).filter((r) => r.activity).map((r) => ({ t: r.time || "", a: String(r.activity).replace(/:$/, ""), g: s.name })));
  }

  function render(host) {
    if (!host || !store.affiliate()) return;
    const iso = selected(), t = today();
    const [Y, M] = ym.split("-").map(Number);
    const first = new Date(Y, M - 1, 1), lead = first.getDay(), last = new Date(Y, M, 0).getDate();
    const status = statusMap();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);
    const games = (d) => Games.listForDate(d);
    const cal = `<div class="pl-cal" role="grid" aria-label="${h(first.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}">
      <div class="pl-calh"><button class="pl-nav" data-plm="-1" aria-label="Previous month">‹</button><b>${h(first.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</b><button class="pl-nav" data-plm="1" aria-label="Next month">›</button>
        <button class="btn sm pl-today" data-plm="today" ${iso === t ? "disabled" : ""}>Today</button></div>
      <div class="pl-dow">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<span>${x}</span>`).join("")}</div>
      <div class="pl-days">${cells.map((d) => {
        if (!d) return `<span class="pl-d empty"></span>`;
        const g = games(d), s = status[d] || "none";
        const gm = g.length ? `<i class="pl-g ${g[0].homeAway === "away" ? "away" : "home"}" title="${h(g.map((x) => (x.homeAway === "away" ? "@ " : "vs. ") + (x.opponent || "TBD")).join(" · "))}">${h(g[0].homeAway === "away" ? "@" : "vs")} ${h(g[0].opponentCode || (g[0].opponent || "").split(" ").pop())}${g.length > 1 ? " ×2" : ""}</i>` : "";
        return `<button class="pl-d${d === iso ? " sel" : ""}${d === t ? " today" : ""}${g.length ? " game" : ""}" data-pld="${d}" aria-pressed="${d === iso}" aria-label="${h(long(d))}${g.length ? ", game" : ""}${s !== "none" ? ", " + s : ""}">
          <span class="pl-n">${+d.slice(8)}</span>${gm}${s !== "none" ? `<i class="pl-s ${s}" aria-hidden="true"></i>` : ""}</button>`;
      }).join("")}</div>
      <div class="pl-key"><span><i class="pl-g home">vs</i> home</span><span><i class="pl-g away">@</i> road</span><span><i class="pl-s draft"></i> draft</span><span><i class="pl-s published"></i> published</span></div>
    </div>`;

    const g = games(iso), s = (status[iso] || dayStatus(iso)), day = s !== "none" ? dayOf(iso) : null, rows = preview(day);
    const cx = store.affiliate() === "fcl";
    const what = g.length ? (g.length > 1 ? "Doubleheader" : "Game day") : cx ? "Workout day" : "No game";
    const card = `<div class="pl-card">
      <div class="pl-ch"><div><span class="pl-k">${iso === t ? "Today" : iso < t ? "Past" : "Selected"} · ${h(what)}</span><h2>${h(long(iso))}</h2></div>
        <span class="pl-st ${s}">${{ none: "No schedule yet", draft: "Draft", published: "Published" }[s]}</span></div>
      ${g.length ? `<div class="pl-games">${g.map((x) => GamesUI.card(x)).join("")}</div>` : `<p class="pl-nogame">${cx ? "No game — the Complex workout day is the starting point." : "No game on this date."}</p>`}
      ${s === "none" ? (chooser ? choices(g, cx) : `<button class="btn primary pl-build" data-plb="build">Build Daily Schedule</button>`)
        : `<div class="pl-acts"><button class="btn primary pl-build" data-plb="edit">Edit Daily Schedule</button><button class="btn" data-plb="daily">Open in Daily view</button></div>`}
      ${rows.length ? `<ol class="pl-rows">${rows.slice(0, 8).map((r) => `<li><time>${h(r.t)}</time><span>${h(r.a)}</span>${r.g ? `<em>${h(r.g)}</em>` : ""}</li>`).join("")}${rows.length > 8 ? `<li class="more">+ ${rows.length - 8} more</li>` : ""}</ol>` : ""}
      <button class="pl-set" data-plb="defaults">Game Day Defaults</button>
    </div>`;
    host.innerHTML = `<div class="pl">${card}${cal}</div>`;
    bind(host);
  }
  function choices(g, cx) {
    const tbd = g.length && !g.some((x) => x.time);
    return `<div class="pl-choose" role="group" aria-label="Build Daily Schedule">
      <button class="pl-opt" data-plb="manual"><b>Build manually</b><span>${g.length ? (tbd ? "First pitch is TBD — you'll enter it, then the game-day activities appear" : "The standard game-day schedule appears, ready to edit") : cx ? "The Complex workout day appears, ready to edit" : "A clean timeline — add activities or use a template"}</span></button>
      <button class="pl-opt" data-plb="describe"><b>Describe your day</b><span>Type it — the AI builds a proposal for you to review</span></button>
      <button class="pl-opt" data-plb="voice"><b>🎙 Describe by voice</b><span>Speak it — you'll see and edit the words first</span></button>
      ${g.length || cx ? `<button class="pl-empty" data-plb="empty">Start empty instead</button>` : ""}
      <button class="pl-empty" data-plb="cancel">Cancel</button>
    </div>`;
  }
  function bind(host) {
    host.onclick = (e) => {
      const d = e.target.closest("[data-pld]"); if (d) { pick(d.dataset.pld); render(host); return; }
      const m = e.target.closest("[data-plm]"); if (m) {
        if (m.dataset.plm === "today") pick(today());
        else { const [y, mo] = ym.split("-").map(Number); const n = new Date(y, mo - 1 + +m.dataset.plm, 1); ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }
        render(host); return;
      }
      const b = e.target.closest("[data-plb]"); if (!b) return;
      const k = b.dataset.plb, iso = selected();
      if (k === "build") { chooser = true; render(host); const f = host.querySelector(".pl-opt"); if (f) f.focus(); return; }
      if (k === "cancel") { chooser = false; render(host); return; }
      if (k === "defaults") return window.GameDaySettings && GameDaySettings.open();
      openDate(iso);
      if (k === "daily") return go("schedule");
      if (k === "edit") { if (S.meta.dayPlan && window.DayUI && DayUI.openBuilder) return DayUI.openBuilder({}); return go("schedule"); }
      chooser = false;
      if (window.DayUI && DayUI.openBuilder) DayUI.openBuilder({ start: k === "empty" ? "manual" : k, empty: k === "empty" });
    };
  }
  window.HubPlanner = { render, pick, get date() { return selected(); } };
  // this script loads after the app booted
  try { if (typeof VIEW !== "undefined" && VIEW === "hub") renderHub(); } catch (e) {}
})();
