/* Manager Hub — games in the interface: game cards, the game detail panel, add / edit, the Daily view's
   game strip and empty state, calendar chips, the calendar day panel, the affiliate game list and the
   organisation board ("who plays today?"). Data: the page's Games store (index.html) over
   games/games-core.js; nothing here changes a workout, and a workout never changes a game.
   Loaded after the main script; every caller in index.html guards with `window.GamesUI`. */
(function () {
  "use strict";
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const C = () => window.GamesCore, D = () => window.DateCore;
  const affMeta = (id) => AFFILIATES.find((a) => a.id === id) || null;
  const curTz = () => (typeof Today !== "undefined" ? Today.tz() : null);
  const today = () => (typeof Today !== "undefined" ? Today.iso() : D().todayIn(null));
  const dayName = (iso, o) => { try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, o || { weekday: "long", month: "long", day: "numeric", year: "numeric" }); } catch (e) { return iso; } };
  const SOURCE = { schedule: "Organization schedule", csv: "Imported from a CSV", manual: "Added by hand" };

  /* ---------------------------------------------------------------- pieces */
  /** "GAME · vs. St. Paul Saints" / "AWAY · @ Sacramento River Cats" + "7:05 PM · Home" / "6:45 PM PT · Sacramento, CA" */
  function lines(g, tz) {
    const away = g.homeAway === "away";
    const k = `${away ? "AWAY" : "GAME"} · ${away ? "@" : "vs."} ${g.opponent || g.opponentCode || "TBD"}`;
    const st = C().statusText(g);
    const where = away ? (g.venueCity || g.location || "Away") : "Home";
    const s = [C().timeText(g, tz), where].concat(g.doubleheader ? [`Game ${g.gameNumber || 1}`] : []).join(" · ");
    return { k, s, st };
  }
  function card(g, o = {}) {
    const tz = o.tz || curTz(), L = lines(g, tz);
    const cls = ["gcard", g.homeAway === "away" ? "away" : "home", g.status && g.status !== "scheduled" ? "st-" + g.status : "", o.compact ? "compact" : ""].join(" ");
    return `<button type="button" class="${cls}" data-gid="${h(g.id)}"${o.aff ? ` data-gaff="${h(o.aff)}"` : ""} title="Game details">
      <span class="gc-k">${h(L.k)}${L.st ? ` <i class="gc-st">${h(L.st)}</i>` : ""}${g.scheduleChange ? ` <i class="gc-rev" title="The schedule changed this game — review">Schedule changed</i>` : ""}</span>
      <span class="gc-s">${h(L.s)}</span></button>`;
  }
  /** compact calendar chip(s) for a date */
  function chips(iso) {
    const list = Games.listForDate(iso);
    return list.map((g) => {
      const away = g.homeAway === "away", t = g.timeTBD || !g.time ? "TBD" : D().clock12(g.time).replace(":00 ", " ").replace(/ (AM|PM)$/, (m, p) => p[0].toLowerCase());
      const opp = g.opponentCode || g.opponent || "TBD";
      const full = `${away ? "@" : "vs."} ${g.opponent || opp} · ${C().timeText(g, curTz())}${C().statusText(g) ? " · " + C().statusText(g) : ""}`;
      return `<span class="cal-gm ${away ? "away" : "home"}${g.status && g.status !== "scheduled" ? " st-" + g.status : ""}" data-gid="${h(g.id)}" role="button" tabindex="0" title="${h(full)} — details">
        <span class="cal-gm-o">${away ? "@" : "vs"} ${h(opp)}</span><span class="cal-gm-t">${h(t)}</span></span>`;
    }).join("");
  }

  /* ---------------------------------------------------------------- detail */
  function rowsFor(g, tz, affId) {
    const L = lines(g, tz), R = [];
    const own = affMeta(affId) || (typeof store !== "undefined" && store.affiliateMeta());
    R.push(["Date", dayName(g.date)]);
    R.push(["Matchup", `${own ? own.team : ""} ${g.homeAway === "away" ? "@" : "vs."} ${g.opponent || g.opponentCode || "TBD"}`]);
    R.push(["Home / away", g.homeAway === "away" ? "Away" : "Home"]);
    R.push(["First pitch", g.timeTBD || !g.time ? "TBD" : `${C().timeText(g, null)}${g.tz ? " " + D().tzAbbr(g.tz, g.date) : ""}${C().homeTimeText(g, tz) ? ` (${C().homeTimeText(g, tz)} at home)` : ""}`]);
    if (g.location || g.venueCity) R.push(["Ballpark", [g.location, g.venueCity].filter(Boolean).join(", ")]);
    if (g.doubleheader) R.push(["Doubleheader", `Game ${g.gameNumber || 1}`]);
    if (g.status && g.status !== "scheduled") R.push(["Status", C().statusText(g)]);
    if (g.type && g.type !== "regular") R.push(["Type", g.type[0].toUpperCase() + g.type.slice(1)]);
    else if (g.source === "schedule") R.push(["Type", "Regular season"]);
    if (g.seq) R.push(["Season game", `#${g.seq}`]);
    if (g.notes) R.push(["Notes", g.notes]);
    R.push(["Source", SOURCE[g.source] || "Added by hand"].concat([]));
    return { L, R };
  }
  function detail(id, affId) {
    const mine = !affId || (typeof store !== "undefined" && affId === store.affiliate());
    const g = mine ? Games.byId(id) : C().all(C().migrate(store.getFor(affId, "cs.games"))).find((x) => x.id === id);
    if (!g) return;
    const tz = mine ? curTz() : (affMeta(affId) || {}).tz;
    const { L, R } = rowsFor(g, tz, affId || store.affiliate());
    const ch = g.scheduleChange;
    openModal(`
      <div class="mhead"><div><h2>${h(L.k)}</h2><p>${h(L.s)}${L.st ? " · " + h(L.st) : ""}</p></div><button class="x" data-close>×</button></div>
      <div class="mbody">
        <dl class="gdl">${R.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join("")}</dl>
        ${g.removedFromSchedule ? `<p class="note">This game is no longer in the latest organization schedule. It stays here until you remove it.</p>` : ""}
        ${ch ? `<div class="gnote"><b>The schedule changed this game.</b> You edited it, so your version was kept. The schedule now says:
            ${h(ch.fields.filter((f) => ["opponent", "homeAway", "time", "location", "status", "date"].includes(f)).map((f) => `${f === "homeAway" ? "home/away" : f}: ${f === "time" ? D().clock12(ch.values[f]) || "TBD" : ch.values[f] || "—"}`).join(" · ") || "updated details")}.
            ${mine ? `<div class="gnote-a"><button class="btn sm primary" id="gdAccept">Use the schedule's version</button></div>` : ""}</div>` : ""}
        <p class="note gfoot">Games are fixed on the calendar: moving or changing workouts never changes a game.</p>
      </div>
      <div class="mfoot">
        ${mine ? `<button class="btn" id="gdEdit" style="margin-right:auto">Edit game</button>` : ""}
        <button class="btn" data-close>Close</button>
        ${mine ? `<button class="btn primary" id="gdOpen">Open this day</button>` : ""}
      </div>`, () => {
      const o = document.getElementById("gdOpen"); if (o) o.onclick = () => { closeModal(); openDate(g.date); go("schedule"); };
      const e = document.getElementById("gdEdit"); if (e) e.onclick = () => form(g.date, g.id, refreshAll);
      const a = document.getElementById("gdAccept"); if (a) a.onclick = () => { Games.acceptChange(g.id); closeModal(); refreshAll(); toast("Game updated from the schedule"); };
    });
  }

  /* ---------------------------------------------------------------- add / edit */
  function form(iso, id, after) {
    const g = id ? Games.byId(id) : null;
    openModal(`
      <div class="mhead"><div><h2>${g ? "Edit game" : "Add game"}</h2><p>${h(dayName(iso))}${g && g.source === "schedule" ? " · from the organization schedule — your changes are kept if the schedule is re-imported" : ""}</p></div>
        <button class="x" data-close>×</button></div>
      <div class="mbody">
        <div class="grid2">
          <div class="field"><label for="gmOpp">Opponent</label><input id="gmOpp" type="text" value="${h(g ? g.opponent : "")}" placeholder="Opponent"></div>
          <div class="field"><label for="gmHA">Home / Away</label>
            <select id="gmHA"><option value="home" ${!g || g.homeAway !== "away" ? "selected" : ""}>Home</option><option value="away" ${g && g.homeAway === "away" ? "selected" : ""}>Away</option></select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="gmTime">First pitch${g && g.tz ? ` (${h(D().tzAbbr(g.tz, iso))}, ballpark time)` : ""}</label><input id="gmTime" type="time" value="${h(g && !g.timeTBD ? g.time : "")}"><small class="hint">Leave empty for TBD.</small></div>
          <div class="field"><label for="gmLoc">Ballpark / location</label><input id="gmLoc" type="text" value="${h(g ? g.location : "")}" placeholder="Ballpark"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="gmStatus">Status</label><select id="gmStatus">${["scheduled", "postponed", "canceled", "suspended", "rescheduled"].map((s) => `<option value="${s}" ${(g ? g.status || "scheduled" : "scheduled") === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></div>
          <div class="field"><label for="gmNotes">Notes</label><input id="gmNotes" type="text" value="${h(g ? g.notes : "")}" placeholder="Optional"></div>
        </div>
      </div>
      <div class="mfoot">
        ${g ? `<button class="btn danger" id="gmDel" style="margin-right:auto">Remove game</button>` : ""}
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="gmSave">${g ? "Save" : "Add game"}</button>
      </div>`, () => {
      document.getElementById("gmSave").onclick = () => {
        const opp = document.getElementById("gmOpp").value.trim();
        if (!opp) return toast("Give the opponent a name");
        const t = document.getElementById("gmTime").value;
        const rec = { date: iso, opponent: opp, homeAway: document.getElementById("gmHA").value, time: t, timeTBD: !t,
          location: document.getElementById("gmLoc").value.trim(), notes: document.getElementById("gmNotes").value.trim(), status: document.getElementById("gmStatus").value };
        if (g) { rec.id = g.id; if (g.opponentCode && opp !== g.opponent) rec.opponentCode = ""; }
        else { rec.source = "manual"; rec.gameNumber = Games.listForDate(iso).length + 1; if (rec.gameNumber > 1) rec.doubleheader = true; }
        Games.upsert(g ? rec : Object.assign({ id: "gm" + Math.random().toString(36).slice(2, 9) }, rec));
        if (S && S.meta && S.meta.date === iso) { syncGameToDay(iso); renderMeta(); }
        closeModal(); after && after(); toast(g ? "Game updated" : "Game added");
      };
      const del = document.getElementById("gmDel");
      if (del) del.onclick = () => {
        if (g.source === "schedule" && !confirm("Remove this game from your calendar? It came from the organization schedule; re-importing the schedule won't add it back.")) return;
        Games.remove(g.id); if (S && S.meta && S.meta.date === iso) { syncGameToDay(iso); renderMeta(); }
        closeModal(); after && after(); toast("Game removed");
      };
    });
  }

  /* ---------------------------------------------------------------- Daily view */
  /** the strip above the Daily schedule: the day's game(s), fixed — plus a clean empty state */
  function banner() {
    if (typeof S === "undefined" || !S || !S.meta) return "";
    const iso = S.meta.date, list = iso ? Games.listForDate(iso) : [];
    const empty = !(S.sections || []).some((sec) => (sec.rows || []).some((r) => r.activity || r.time));
    const games = list.length ? `<div class="dgame" aria-label="Games on this day">
        ${list.map((g) => card(g)).join("")}
        <span class="dgame-n">Fixed on the calendar — plan around it.</span></div>` : "";
    if (!empty) return games;
    const isToday = iso === today();
    return games + `<div class="day-empty">
        <h3>${isToday ? "Nothing scheduled for today yet" : "Nothing scheduled for " + h(dayName(iso, { weekday: "long", month: "long", day: "numeric" }))}</h3>
        <p>${list.length ? "Build the day around the game: describe it, start from a template, or add a section." : "Describe the day, start from a template, or add a section."}</p>
        <div class="day-empty-a">
          <button class="btn primary sm" id="deDescribe">✦ Describe your day</button>
          <button class="btn sm" id="deTemplate">Start from a template</button>
          <button class="btn sm quiet" id="deOpen">Open a saved day</button>
        </div></div>`;
  }

  /* ---------------------------------------------------------------- calendar day panel */
  function dayPanel(iso, host, after) {
    const list = Games.listForDate(iso);
    host.innerHTML = `<div class="gp-list">${list.map((g) => card(g)).join("")}
      <button class="btn sm${list.length ? " quiet" : ""}" data-gadd="${h(iso)}">⚾ ${list.length ? "Add another game (doubleheader)" : "Add a game for this day"}</button></div>`;
    const b = host.querySelector("[data-gadd]"); if (b) b.onclick = () => form(iso, null, after);
  }

  /* ---------------------------------------------------------------- the affiliate's games + the organisation board */
  let tab = "list", orgDate = null, orgFilter = "all", orgAffs = null, listShow = "upcoming";
  function listModal(start) {
    tab = start || "list"; orgDate = orgDate || today();
    openModal(`
      <div class="mhead"><div><h2>Games</h2><p id="gmSub"></p></div><button class="x" data-close>×</button></div>
      <div class="ai-tabs gtabs" role="tablist">
        <button role="tab" data-gtab="list">${h((store.affiliateMeta() || {}).name || "This affiliate")}</button>
        <button role="tab" data-gtab="org">Organization</button>
        <button role="tab" data-gtab="import">Import</button>
      </div>
      <div class="mbody" id="gmBody"></div>
      <div class="mfoot"><button class="btn primary" data-close>Done</button></div>`, () => {
      document.getElementById("modal").classList.add("wide");
      const m = document.getElementById("modal");
      m.addEventListener("click", (e) => {
        const t = e.target.closest("[data-gtab]"); if (t) { tab = t.dataset.gtab; draw(); return; }
        const d = e.target.closest("[data-gday]"); if (d) { orgDate = d.dataset.gday === "today" ? today() : D().addDays(orgDate, +d.dataset.gday); draw(); return; }
        const f = e.target.closest("[data-gf]"); if (f) { orgFilter = f.dataset.gf; draw(); return; }
        const a = e.target.closest("[data-gaffsel]"); if (a) { const id = a.dataset.gaffsel; orgAffs = orgAffs || new Set(AFFILIATES.map((x) => x.id)); orgAffs.has(id) ? orgAffs.delete(id) : orgAffs.add(id); if (!orgAffs.size) orgAffs = null; draw(); return; }
        const s = e.target.closest("[data-gshow]"); if (s) { listShow = s.dataset.gshow; draw(); return; }
        if (e.target.closest("#gmAdd")) return form((S && S.meta && S.meta.date) || today(), null, draw);
        if (e.target.closest("#gmImport")) return importCSV(draw);
      });
      m.addEventListener("change", (e) => { if (e.target.id === "gmDate") { orgDate = e.target.value || today(); draw(); } });
      draw();
    });
  }
  function draw() {
    const body = document.getElementById("gmBody"); if (!body) return;
    document.querySelectorAll("[data-gtab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.gtab === tab)));
    const sub = document.getElementById("gmSub");
    if (tab === "org") { if (sub) sub.textContent = "Every affiliate's games on one day."; body.innerHTML = orgHTML(); return; }
    if (tab === "import") { if (sub) sub.textContent = "Where these games came from."; body.innerHTML = importHTML(); return; }
    const all = Games.all(), t = today();
    const shown = listShow === "all" ? all : all.filter((g) => g.date >= t);
    if (sub) sub.textContent = all.length ? `${all.length} games · ${all.filter((g) => g.homeAway !== "away").length} home, ${all.filter((g) => g.homeAway === "away").length} away` : "No games on file.";
    const byMonth = {};
    shown.forEach((g) => { const k = g.date.slice(0, 7); (byMonth[k] = byMonth[k] || []).push(g); });
    body.innerHTML = `<div class="ai-bar" style="margin:0 0 12px">
        <button class="btn primary sm" id="gmAdd">Add game</button>
        <button class="btn sm" id="gmImport">Import CSV</button>
        <span class="gseg"><button class="${listShow === "upcoming" ? "on" : ""}" data-gshow="upcoming">Upcoming</button><button class="${listShow === "all" ? "on" : ""}" data-gshow="all">Whole season</button></span>
      </div>
      ${shown.length ? Object.entries(byMonth).map(([k, l]) => `<h4 class="gmonth">${h(dayName(k + "-01", { month: "long", year: "numeric" }))} <span>${l.length}</span></h4>
        <div class="glist">${l.map((g) => `<div class="glist-r${g.date === t ? " is-today" : ""}"><span class="glist-d">${h(dayName(g.date, { weekday: "short", month: "short", day: "numeric" }))}</span>${card(g, { compact: true })}</div>`).join("")}</div>`).join("")
        : `<div class="ai-empty">${all.length ? "No games from today on. Switch to “Whole season” to see past games." : "No games yet. They load from the organization schedule; you can also import a CSV or add one by hand."}</div>`}`;
  }
  function orgRows(iso) {
    return AFFILIATES.map((a) => ({ a, games: C().forDate(C().migrate(store.getFor(a.id, "cs.games")), iso) }));
  }
  function orgHTML() {
    const iso = orgDate || today();
    let rows = orgRows(iso);
    if (orgAffs) rows = rows.filter((r) => orgAffs.has(r.a.id));
    const kind = (r) => (!r.games.length ? "off" : r.games.every((g) => g.homeAway === "away") ? "road" : "home");
    const n = { home: rows.filter((r) => kind(r) === "home").length, road: rows.filter((r) => kind(r) === "road").length, off: rows.filter((r) => kind(r) === "off").length };
    const vis = orgFilter === "all" ? rows : rows.filter((r) => kind(r) === orgFilter);
    return `<div class="gorg-nav">
        <button class="btn sm quiet" data-gday="-1" aria-label="Previous day">‹</button>
        <input type="date" id="gmDate" value="${h(iso)}" aria-label="Date">
        <button class="btn sm quiet" data-gday="1" aria-label="Next day">›</button>
        <button class="btn sm" data-gday="today">Today</button>
        <b class="gorg-day">${h(dayName(iso, { weekday: "long", month: "long", day: "numeric" }))}${iso === today() ? " · today" : ""}</b>
      </div>
      <div class="gorg-f">
        <span class="gseg">${[["all", `All ${rows.length}`], ["home", `Home ${n.home}`], ["road", `Road ${n.road}`], ["off", `Off ${n.off}`]].map(([k, l]) => `<button class="${orgFilter === k ? "on" : ""}" data-gf="${k}">${h(l)}</button>`).join("")}</span>
        <span class="gaffs">${AFFILIATES.map((a) => `<button class="gaff${!orgAffs || orgAffs.has(a.id) ? " on" : ""}" data-gaffsel="${a.id}" title="${h(a.team)}">${h(a.short)}</button>`).join("")}</span>
      </div>
      <div class="gorg">${vis.map((r) => `<div class="gorg-r ${kind(r)}">
          <span class="gorg-t"><img src="${h(r.a.logo)}" alt="" width="26" height="26"><span><b>${h(r.a.name)}</b><i>${h(r.a.level)}</i></span></span>
          <span class="gorg-g">${r.games.length ? r.games.map((g) => card(g, { tz: r.a.tz, aff: r.a.id, compact: true })).join("") : `<span class="gorg-off">Off day</span>`}</span>
        </div>`).join("") || `<div class="ai-empty">No affiliates match.</div>`}</div>
      <p class="note">Times are local to each ballpark; road games in another time zone show it (PT, MT …).</p>`;
  }
  function importHTML() {
    const rows = AFFILIATES.map((a) => ({ a, s: OrgSchedule.lastSummary(a.id), n: C().all(C().migrate(store.getFor(a.id, "cs.games"))).length }));
    return `<p>The organization's game schedules ship with Manager Hub and load into every affiliate automatically. Re-importing never duplicates a game; games you edited keep your changes, and games you removed stay removed.</p>
      <table class="gimp"><thead><tr><th>Affiliate</th><th>Games</th><th>Last import</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${h(r.a.team)}</td><td>${r.n}</td><td>${r.s ? `${h(r.s.file || "schedule")} · ${r.s.added} added, ${r.s.updated} updated, ${r.s.unchanged} unchanged${r.s.keptEdits ? `, ${r.s.keptEdits} kept your edits` : ""}${r.s.linked ? `, ${r.s.linked} matched your own games` : ""}${r.s.removedFromSchedule ? `, ${r.s.removedFromSchedule} no longer listed` : ""}` : (r.n ? "Added here" : "No schedule on file")}</td></tr>`).join("")}
      </tbody></table>
      <p class="note">CSV import (this affiliate): columns <b>Date, Opponent, Home/Away, Time, Location, Notes</b>, with or without a header row; a game on the same date is updated, never duplicated.</p>`;
  }
  function importCSV(after) {
    const f = document.getElementById("filePick"); f.accept = ".csv,text/csv";
    f.onchange = () => {
      const file = f.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const r = Games.importCSV(rd.result);
        if (!r.total) { toast("Couldn't read any games out of that file"); return; }
        after && after(); refreshAll();
        toast(`${r.added} added, ${r.updated} updated${r.invalid ? `, ${r.invalid} skipped (no date)` : ""}`);
      };
      rd.readAsText(file); f.value = "";
    };
    f.click();
  }

  function refreshAll() {
    try { if (S && S.meta && S.meta.date) { syncGameToDay(S.meta.date); renderMeta(); } } catch (e) {}
    try { renderSections(); } catch (e) {}
    try { if (VIEW === "month") renderMonth(); } catch (e) {}
    try { if (VIEW === "hub") renderHub(); } catch (e) {}
    try { if (typeof refreshPlanned === "function") refreshPlanned(); } catch (e) {}
  }

  /* any game card / chip opens its details (and never the calendar day underneath) */
  function onGame(e) {
    const el = e.target.closest("[data-gid]"); if (!el) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation();
    detail(el.dataset.gid, el.dataset.gaff || null);
  }
  document.addEventListener("click", onGame, true);
  document.addEventListener("keydown", onGame, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest("#deDescribe")) { if (window.DayUI) DayUI.open(); else if (window.MHAssistUI) MHAssistUI.open(); }
    else if (e.target.closest("#deTemplate")) newDayModal();
    else if (e.target.closest("#deOpen")) openModalLibrary();
  });

  window.GamesUI = { card, chips, detail, form, banner, dayPanel, listModal, lines, refreshAll };
  // this script loads after the app booted: draw the game strip / chips that were skipped
  try { renderSections(); if (VIEW === "month") renderMonth(); if (VIEW === "hub") renderHub(); } catch (e) {}
})();
