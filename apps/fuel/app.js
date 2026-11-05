/* FUEL — app shell, router, home, players, daily log, follow-ups. */
import { api, init, mode, demoRole, setDemoRole } from "./api.js";
import { ROLES } from "./shared/model.js";
import { addDays, daysBetween } from "./shared/util.js";
import { $, $$, esc, S, can, toast, errToast, fmtDate, relDay, w, playerName, players, invalidate, findPlayers, table, openModal, closeModal, today, playerPicker } from "./ui.js";
import { openQuickEntry, mountQuickEntry } from "./quickentry.js";
import { renderProfile } from "./profile.js";
import { renderReports, renderData } from "./admin.js";

const app = $("#app");

/* launch screen: shown while FUEL starts; in secure mode it's also where a sign-in problem is explained */
function splash(state, e) {
  const el = $("#splash"), msg = $("#splashMsg");
  if (state === "done") { el.classList.add("out"); setTimeout(() => (el.hidden = true), 300); return; }
  el.hidden = false; el.classList.remove("out");
  if (state === "loading") { msg.innerHTML = mode === "demo" ? "Loading the sandbox demo — synthetic players only." : "Signing you in…"; return; }
  const st = e && e.status;
  msg.innerHTML = st === 401 ? "<b>Sign in to continue.</b><br>Your session ended or this account isn't on FUEL's staff list."
    : st === 503 ? "<b>FUEL's secure mode isn't switched on yet.</b><br>Ask the administrator to finish the setup."
    : `<b>FUEL couldn't start.</b><br>${esc(e && e.message ? e.message : "Unknown error.")}`;
  msg.insertAdjacentHTML("afterend", `<button class="btn accent" type="button" id="splashRetry">${st === 401 ? "Sign in" : "Try again"}</button>`);
  $("#splashRetry").onclick = () => location.reload(); // in secure mode, Cloudflare Access shows its sign-in page on reload
}

async function boot() {
  let info;
  splash("loading");
  try { info = await init(); S.session = await api("GET", "session"); S.staff = await api("GET", "staff"); }
  catch (e) { splash("error", e); return; }
  strip(info);
  wireSearch();
  $("#qeBtn").onclick = () => openQuickEntry(currentPlayer());
  $("#qeTab").onclick = () => openQuickEntry(currentPlayer());
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "q" && !e.ctrlKey && !e.metaKey && !e.altKey && !/input|textarea|select/i.test(document.activeElement.tagName) && $("#scrim").hidden) { e.preventDefault(); openQuickEntry(currentPlayer()); }
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#gsearch").focus(); }
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("fuel:saved", () => { const r = (location.hash || "").slice(2).split("/")[0]; if (["home", "log", "followups", "players"].includes(r)) route(); });
  await route();
  splash("done");
}
function currentPlayer() {
  const m = (location.hash || "").match(/^#\/player\/([^/]+)/);
  return m && S.players ? S.players.find((p) => p.id === m[1]) || null : null;
}

function strip(info) {
  const el = $("#strip");
  if (mode === "demo") {
    const r = demoRole();
    el.innerHTML = `<b>Sandbox demo</b><span>Synthetic players only<span class="long"> — never enter real player information here</span>.</span><span class="long">${info.persistent ? "Saved in this browser." : "This browser blocks storage — changes are lost on refresh."}</span><span class="sp"></span>
      <label>Viewing as <select id="roleSel" aria-label="Demo role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === r ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label><span class="faint long">(demo role, not a sign-in)</span>`;
    $("#roleSel").onchange = async (e) => { setDemoRole(e.target.value); S.session = await api("GET", "session"); invalidate(); toast(`Now viewing as ${ROLES[e.target.value].label}`); route(); };
  } else {
    el.innerHTML = `<span class="secure">● Secure mode</span><span>Signed in as <b>${esc(S.session.user.name || S.session.user.email)}</b> · ${esc(ROLES[S.session.user.role].label)}</span>`;
  }
}

function wireSearch() {
  const inp = $("#gsearch"), box = $("#gsearchList");
  let idx = 0, list = [];
  const draw = async () => {
    const q = inp.value.trim();
    if (!q) { box.hidden = true; inp.setAttribute("aria-expanded", "false"); return; }
    list = findPlayers(await players(), q, 10); idx = 0;
    box.hidden = false; inp.setAttribute("aria-expanded", "true");
    box.innerHTML = list.length ? list.map((p, i) => `<div class="gs-item${i === idx ? " on" : ""}" role="option" data-i="${i}"><span class="nm">${esc(playerName(p))}</span><span class="muted small">${esc([p.position, p.affiliate].filter(Boolean).join(" · "))}</span><span class="sp"></span><span class="faint small">${esc(p.external_id || "")}</span></div>`).join("") : `<div class="empty">No player matches “${esc(q)}”.</div>`;
    $$(".gs-item", box).forEach((d) => (d.onmousedown = (e) => { e.preventDefault(); go(list[+d.dataset.i]); }));
  };
  const go = (p) => { if (!p) return; inp.value = ""; box.hidden = true; inp.blur(); location.hash = "#/player/" + p.id; };
  inp.oninput = draw;
  inp.onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!list.length) return; idx = (idx + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length; $$(".gs-item", box).forEach((d, i) => d.classList.toggle("on", i === idx)); }
    if (e.key === "Enter") { e.preventDefault(); go(list[idx]); }
    if (e.key === "Escape") { inp.value = ""; box.hidden = true; }
  };
  inp.onblur = () => setTimeout(() => (box.hidden = true), 150);
}

async function route() {
  closeModal();
  const parts = (location.hash || "#/home").slice(2).split("/");
  const r = parts[0] || "home";
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (r === "player" ? "players" : r)));
  window.scrollTo(0, 0);
  try {
    if (r === "player") { await players(); return renderProfile(app, decodeURIComponent(parts[1] || ""), parts[2]); }
    if (r === "players") return renderPlayers();
    if (r === "log") return renderLog(parts[1]);
    if (r === "followups") return renderFollowups(parts[1]);
    if (r === "reports") return renderReports(app, parts[1]);
    if (r === "data") return renderData(app, parts[1]);
    if (r === "more") return renderMore();
    return renderHome();
  } catch (e) { app.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; }
}

/* ------------------------------------------------------------------ home */
async function renderHome() {
  const h = await api("GET", "home");
  await players();
  const maxAff = Math.max(1, ...Object.values(h.by_affiliate));
  const link = (id, name) => `<a class="pname" href="#/player/${esc(id)}">${esc(name)}</a>`;
  app.innerHTML = `
    <div class="pagehead"><div><h1>${esc(new Date(h.today + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }))}</h1><div class="sub">${esc(S.session.user.name || "")} · ${esc(ROLES[S.session.user.role].label)}</div></div><span class="sp"></span>
      <div class="gsearch hide-m" style="flex:1;max-width:420px"><input id="homeSearch" type="search" placeholder="Search players by name or Player ID…" aria-label="Search players" style="width:100%;background:#fff;color:var(--ink);border-color:var(--line-2);height:38px"></div>
      ${can("write_nutrition") ? '<button class="btn accent" id="homeQE" type="button" style="height:38px">+ Quick Entry</button>' : ""}</div>
    <div class="kpis">
      <a class="kpi" href="#/players"><div class="v">${h.active}</div><div class="l">Active players</div></a>
      ${h.notes ? `<a class="kpi ${h.overdue.length ? "alert" : ""}" href="#/followups/overdue"><div class="v">${h.overdue.length}</div><div class="l">Overdue follow-ups</div></a>
      <a class="kpi" href="#/followups/open"><div class="v">${h.upcoming.length}</div><div class="l">Follow-ups due in 7 days</div></a>` : ""}
      <a class="kpi ${h.needs_checkin.length ? "warn" : ""}" href="#/reports/missing_weighins"><div class="v">${h.needs_checkin.length}</div><div class="l">No weigh-in in ${h.checkin_days}+ days</div></a>
      <div class="kpi aff" style="padding:0"><div class="affbars">${Object.entries(h.by_affiliate).map(([a, n]) => `<div class="affbar"><span class="small">${esc(a)}</span><span class="bar"><i style="width:${(n / maxAff) * 100}%"></i></span><span class="num small" style="text-align:right">${n}</span></div>`).join("")}</div></div>
    </div>
    <div class="grid2">
      <div class="stack">
        ${h.notes ? `<section class="panel"><header><h2>Follow-ups</h2><span class="count">${h.overdue.length} overdue · ${h.upcoming.length} this week</span><span class="sp"></span><a class="btn ghost sm" href="#/followups">All →</a></header>
          ${h.overdue.length + h.upcoming.length ? `<ul class="list">${h.overdue.concat(h.upcoming).slice(0, 12).map((f) => `<li><span class="d">${esc(fmtDate(f.due_date, { year: false }))}</span><span class="grow">${link(f.player_id, f.player_name)} — ${esc(f.description)}</span>${f.due_date < h.today ? '<span class="tag bad">overdue</span>' : f.due_date === h.today ? '<span class="tag orange">today</span>' : ""}${can("write_nutrition") ? `<button class="btn sm" data-done="${esc(f.id)}" title="Mark done">Done</button>` : ""}</li>`).join("")}</ul>` : '<div class="empty">Nothing due this week.</div>'}</section>` : ""}
        <section class="panel"><header><h2>Need a weigh-in</h2><span class="count">no weight in ${h.checkin_days}+ days</span><span class="sp"></span>${can("write_nutrition") ? '<a class="btn ghost sm" href="#/log/bulk">Bulk weigh-in →</a>' : ""}</header>
          ${h.needs_checkin.length ? `<div class="tblwrap short"><table class="tbl"><tbody>${h.needs_checkin.map((x) => `<tr><td>${link(x.id, x.name)}</td><td class="muted small">${esc(x.affiliate || "")}</td><td class="n">${x.days == null ? "never" : x.days + " d"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Everyone has a recent weigh-in.</div>'}</section>
        <section class="panel"><header><h2>Recent weights</h2></header><ul class="list">${h.recent_weights.map((x) => `<li><span class="d">${esc(fmtDate(x.date, { year: false }))}</span><span class="grow">${link(x.player_id, x.player_name)}</span><span class="num">${w(x.weight)} ${esc(x.unit)}</span></li>`).join("") || '<li class="muted">None yet.</li>'}</ul></section>
      </div>
      <div class="stack">
        ${h.notes ? `<section class="panel"><header><h2>Recent nutrition interactions</h2></header>${h.recent_interactions.length ? `<ul class="list">${h.recent_interactions.map((i) => `<li style="display:block"><div class="row" style="gap:8px"><span class="d">${esc(fmtDate(i.date, { year: false }))}</span>${link(i.player_id, i.player_name)}<span class="tag navy">${esc(S.session.vocab.interactionTypes[i.type] || i.type)}</span><span class="sp"></span><span class="faint small">${esc(i.author_initials || "")}</span></div><div class="small" style="margin:3px 0 0 56px;color:var(--ink-2)">${esc(i.text)}${i.text.length >= 220 ? "…" : ""}</div></li>`).join("")}</ul>` : '<div class="empty">No notes yet.</div>'}</section>` : ""}
        <section class="panel"><header><h2>Recent DEXA assessments</h2></header><table class="tbl"><tbody>${h.recent_dexa.map((x) => `<tr><td class="small muted">${esc(fmtDate(x.date))}</td><td>${link(x.player_id, x.player_name)}</td><td class="n">${x.body_fat_pct != null ? x.body_fat_pct + "%" : "—"}</td><td class="n">${x.lean_mass != null ? x.lean_mass + " " + esc(x.unit) + " lean" : ""}</td></tr>`).join("") || '<tr><td class="muted">None yet.</td></tr>'}</tbody></table></section>
        <section class="panel"><header><h2>Activity</h2></header><ul class="list">${h.feed.map((a) => `<li><span class="d" title="${esc(a.at)}">${esc(relDay(a.at.slice(0, 10)))}</span><span class="grow small">${a.player_id ? `<a class="pname" href="#/player/${esc(a.player_id)}">${esc(a.player_name || "")}</a> — ` : ""}${esc(a.summary)}</span><span class="faint small">${esc(a.user_name || "")}</span></li>`).join("")}</ul></section>
      </div>
    </div>`;
  const hs = $("#homeSearch");
  hs.oninput = () => { $("#gsearch").value = hs.value; $("#gsearch").dispatchEvent(new Event("input")); };
  hs.onkeydown = (e) => { if (e.key === "Enter") { const p = findPlayers(S.players, hs.value, 1)[0]; if (p) location.hash = "#/player/" + p.id; } };
  const qe = $("#homeQE"); if (qe) qe.onclick = () => openQuickEntry(null);
  $$("[data-done]").forEach((b) => (b.onclick = async () => { try { await api("POST", "followup.update", { body: { id: b.dataset.done, status: "completed" } }); invalidate(); toast("Follow-up completed"); renderHome(); } catch (e) { errToast(e); } }));
}

/* ------------------------------------------------------------------ players */
async function renderPlayers() {
  const list = await players(true);
  const f = JSON.parse(sessionStorage.getItem("fuel:pf") || "{}");
  const v = S.session.vocab;
  const affs = [...new Set(list.map((p) => p.affiliate).filter(Boolean))].sort((a, b) => v.affiliates.indexOf(a) - v.affiliates.indexOf(b));
  app.innerHTML = `
    <div class="pagehead"><div><h1>Players</h1><div class="sub">${list.length} players · records stay with each player across seasons and affiliates</div></div><span class="sp"></span>
      ${can("write_players") ? '<button class="btn" id="newP">+ New player</button>' : ""}${can("write_nutrition") ? '<button class="btn accent" id="plQE">+ Quick Entry</button>' : ""}</div>
    <div class="filters">
      <input type="search" id="fQ" class="w240" placeholder="Name or Player ID" value="${esc(f.q || "")}" aria-label="Search">
      <select id="fA" aria-label="Affiliate"><option value="">All affiliates</option>${affs.map((a) => `<option${a === f.a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>
      <select id="fP" aria-label="Position"><option value="">All positions</option><option value="P"${f.p === "P" ? " selected" : ""}>Pitchers</option><option value="H"${f.p === "H" ? " selected" : ""}>Position players</option>${v.positions.map((x) => `<option${x === f.p ? " selected" : ""}>${x}</option>`).join("")}</select>
      <select id="fS" aria-label="Roster status"><option value="">Any status</option>${v.rosterStatus.map((x) => `<option${x === f.s ? " selected" : ""}>${x}</option>`).join("")}</select>
      <select id="fD" aria-label="Dietitian"><option value="">Any dietitian</option>${S.staff.filter((s) => s.role === "dietitian" || s.role === "admin").map((s) => `<option value="${esc(s.id)}"${s.id === f.d ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      ${can("read_notes") ? `<select id="fF" aria-label="Follow-up status"><option value="">Any follow-up status</option>${["overdue", "due soon", "open", "none"].map((x) => `<option${x === f.f ? " selected" : ""}>${x}</option>`).join("")}</select>` : ""}
      <span class="muted small" id="fCount"></span>
    </div>
    <section class="panel"><div class="tblwrap" id="pTable"></div></section>`;
  const draw = () => {
    const q = $("#fQ").value.trim(), a = $("#fA").value, p = $("#fP").value, s = $("#fS").value, d = $("#fD").value, fu = $("#fF") ? $("#fF").value : "";
    sessionStorage.setItem("fuel:pf", JSON.stringify({ q, a, p, s, d, f: fu }));
    const pit = (x) => ["RHP", "LHP", "TWP"].includes(x.position);
    const rows = (q ? findPlayers(list, q, 999) : list).filter((x) => (!a || x.affiliate === a) && (!p || (p === "P" ? pit(x) : p === "H" ? !pit(x) || x.position === "TWP" : x.position === p)) && (!s || x.status === s) && (!d || x.dietitian === d) && (!fu || x.followup === fu));
    $("#fCount").textContent = `${rows.length} shown`;
    table($("#pTable"), { rows, sortKey: q ? null : "name", onRow: (r) => (location.hash = "#/player/" + r.id), empty: "No players match these filters.", id: "playersTable", cols: [
      { key: "name", label: "Player", sort: (r) => r.last_name + " " + r.first_name, render: (r) => `<a class="pname" href="#/player/${esc(r.id)}">${esc(r.last_name)}, ${esc(r.first_name)}</a> <span class="faint small">${esc(r.external_id || "")}</span>` },
      { key: "position", label: "Pos", sort: (r) => r.position },
      { key: "affiliate", label: "Affiliate", sort: (r) => v.affiliates.indexOf(r.affiliate), render: (r) => esc(r.affiliate || "—") + (r.status && r.status !== "active" ? ` <span class="tag warn">${esc(r.status)}</span>` : "") },
      { key: "age", label: "Age", cls: "n", sort: (r) => r.age },
      { key: "latest_weight", label: "Weight", cls: "n", sort: (r) => r.latest_weight && r.latest_weight.value, render: (r) => r.latest_weight ? `${w(r.latest_weight.value)} <span class="faint small">${esc(relDay(r.latest_weight.date))}</span>` : '<span class="faint">—</span>' },
      { key: "goal_weight", label: "Goal", cls: "n", sort: (r) => r.goal_weight && r.goal_weight.value, render: (r) => r.goal_weight ? w(r.goal_weight.value) : '<span class="faint">—</span>' },
      { key: "latest_bf", label: "BF%", cls: "n", sort: (r) => r.latest_bf && r.latest_bf.value, render: (r) => r.latest_bf ? r.latest_bf.value : '<span class="faint">—</span>' },
      ...(can("read_notes") ? [
        { key: "last_interaction", label: "Last interaction", sort: (r) => r.last_interaction, render: (r) => r.last_interaction ? esc(relDay(r.last_interaction)) : '<span class="faint">—</span>' },
        { key: "followup", label: "Follow-up", sort: (r) => ["overdue", "due soon", "open", "none"].indexOf(r.followup), render: (r) => r.followup === "overdue" ? '<span class="tag bad">overdue</span>' : r.followup === "due soon" ? '<span class="tag orange">due soon</span>' : r.followup === "open" ? '<span class="tag">open</span>' : '<span class="faint">—</span>' },
      ] : []),
      ...(can("write_nutrition") ? [{ key: "qe", label: "", render: (r) => `<button class="btn ghost sm" data-qe="${esc(r.id)}" aria-label="Quick Entry for ${esc(playerName(r))}" title="Quick Entry">+ Entry</button>` }] : []),
    ] });
    $$("[data-qe]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openQuickEntry(list.find((x) => x.id === b.dataset.qe)); }));
  };
  ["#fQ"].forEach((s) => ($(s).oninput = draw));
  ["#fA", "#fP", "#fS", "#fD", "#fF"].forEach((s) => $(s) && ($(s).onchange = draw));
  draw();
  const qe = $("#plQE"); if (qe) qe.onclick = () => openQuickEntry(null);
  const np = $("#newP"); if (np) np.onclick = newPlayer;
}
function newPlayer() {
  const v = S.session.vocab;
  const m = openModal(`<header><h2 id="modalTitle">New player</h2><button class="x" data-close aria-label="Close">×</button></header>
    <form class="mb form" id="npF"><div class="row"><div class="f grow"><label for="nF">First name</label><input type="text" id="nF" autofocus required></div><div class="f grow"><label for="nL">Last name</label><input type="text" id="nL" required></div></div>
    <div class="row"><div class="f"><label for="nId">Player ID <span class="muted">(organizational, if known)</span></label><input type="text" id="nId" class="w180"></div><div class="f"><label for="nDob">Date of birth</label><input type="date" id="nDob"></div></div>
    <div class="row"><div class="f"><label for="nPos">Position</label><select id="nPos">${v.positions.map((x) => `<option>${x}</option>`).join("")}</select></div><div class="f"><label for="nAff">Affiliate</label><select id="nAff">${v.affiliates.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div></div>
    <p class="muted small" style="margin:0">FUEL gives every player a permanent internal ID. Two players with the same name stay separate.</p><div class="err" id="npErr" role="alert"></div></form>
    <footer><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit" form="npF">Create player</button></footer>`);
  $("#npF", m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("POST", "player.create", { body: { fields: { first_name: $("#nF").value, last_name: $("#nL").value, external_id: $("#nId").value, dob: $("#nDob").value || null, position: $("#nPos").value }, affiliate: $("#nAff").value } });
      invalidate(); closeModal(); toast("Player created"); location.hash = "#/player/" + r.player.id;
    } catch (err) { $("#npErr").textContent = err.message; }
  };
}

/* ------------------------------------------------------------------ daily log */
async function renderLog(tab = "entry") {
  await players();
  if (!can("write_nutrition")) { app.innerHTML = `<div class="pagehead"><h1>Daily Log</h1></div><section class="panel"><div class="empty"><span class="lock">🔒 Your role can view players but not add nutrition entries.</span></div></section>`; return; }
  app.innerHTML = `<div class="pagehead"><div><h1>Daily Log</h1><div class="sub">Fast entry for weigh-ins, conversations and check-ins</div></div></div>
    <nav class="tabs"><a href="#/log/entry" class="${tab !== "bulk" ? "on" : ""}">Quick entry</a><a href="#/log/bulk" class="${tab === "bulk" ? "on" : ""}">Bulk weigh-in</a></nav><div id="logBody"></div>`;
  if (tab === "bulk") return bulk($("#logBody"));
  $("#logBody").innerHTML = `<div class="grid2"><section class="panel"><header><h2>New entry</h2><span class="sp"></span><span class="muted small hide-m"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> continue · Save &amp; add another for back-to-back entries</span></header><div class="body" id="qeInline"></div></section>
    <section class="panel"><header><h2>Entered today</h2></header><div id="todayList"></div></section></div>`;
  mountQuickEntry($("#qeInline"), { onSaved: () => todayList() });
  todayList();
}
async function todayList() {
  const h = await api("GET", "home");
  const t = today();
  const mine = h.feed.filter((a) => a.at.slice(0, 10) === t || relDay(a.at.slice(0, 10)) === "today");
  const el = $("#todayList"); if (!el) return;
  el.innerHTML = mine.length ? `<ul class="list">${mine.map((a) => `<li><span class="d">${esc(new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span><span class="grow small">${a.player_id ? `<a class="pname" href="#/player/${esc(a.player_id)}">${esc(a.player_name || "")}</a> — ` : ""}${esc(a.summary)}</span></li>`).join("")}</ul>` : '<div class="empty">Nothing entered yet today.</div>';
}
async function bulk(host) {
  const list = await players(true);
  const v = S.session.vocab;
  const affs = [...new Set(list.map((p) => p.affiliate).filter(Boolean))].sort((a, b) => v.affiliates.indexOf(a) - v.affiliates.indexOf(b));
  const aff = sessionStorage.getItem("fuel:bulkAff") || affs[0] || "";
  host.innerHTML = `<section class="panel"><header><div class="row" style="gap:10px"><div class="f"><label for="bD">Weigh-in date</label><input type="date" id="bD" value="${today()}" max="${addDays(today(), 1)}"></div>
      <div class="f"><label for="bA">Affiliate</label><select id="bA">${affs.map((a) => `<option${a === aff ? " selected" : ""}>${esc(a)}</option>`).join("")}<option value="">All players</option></select></div>
      <div class="f"><label for="bU">Unit</label><select id="bU" class="w80"><option>lb</option><option>kg</option></select></div></div><span class="sp"></span>
      <span class="muted small hide-m">Tab / Enter moves to the next player · blank rows are skipped</span></header>
    <div class="tblwrap" id="bT"></div>
    <div class="row" style="padding:10px 12px;border-top:1px solid var(--line)"><span class="err" id="bErr" role="alert"></span><span class="sp"></span><span class="muted small" id="bN">0 entered</span><button class="btn primary" id="bSave" type="button">Save weights</button></div></section>`;
  const draw = () => {
    const a = $("#bA").value; sessionStorage.setItem("fuel:bulkAff", a);
    const rows = list.filter((p) => !a || p.affiliate === a).sort((x, y) => x.last_name.localeCompare(y.last_name));
    $("#bT").innerHTML = `<table class="tbl"><thead><tr><th>Player</th><th class="hide-m">Pos</th><th class="n">Last</th><th class="n">Weight</th><th class="hide-m">Note</th></tr></thead><tbody>${rows.map((p, i) => `<tr><td><a class="pname" href="#/player/${esc(p.id)}">${esc(p.last_name)}, ${esc(p.first_name)}</a></td><td class="hide-m">${esc(p.position || "")}</td>
      <td class="n">${p.latest_weight ? `${w(p.latest_weight.value)} <span class="faint small">${esc(relDay(p.latest_weight.date))}</span>` : '<span class="faint">—</span>'}</td>
      <td class="n"><input type="number" step="0.1" inputmode="decimal" class="w110" data-pid="${esc(p.id)}" data-last="${p.latest_weight ? p.latest_weight.value : ""}" aria-label="Weight for ${esc(playerName(p))}"></td><td class="hide-m"><input type="text" data-note="${esc(p.id)}" aria-label="Note for ${esc(playerName(p))}" style="width:100%"></td></tr>`).join("")}</tbody></table>`;
    const ins = $$("[data-pid]", host);
    ins.forEach((inp, i) => {
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); (ins[i + 1] || $("#bSave")).focus(); } };
      inp.oninput = () => {
        $("#bN").textContent = `${ins.filter((x) => x.value !== "").length} entered`;
        const last = +inp.dataset.last, val = +inp.value;
        inp.style.borderColor = inp.value !== "" && last && Math.abs(val - last) > 8 ? "var(--warn)" : "";
        inp.title = inp.value !== "" && last && Math.abs(val - last) > 8 ? `More than 8 lb from the last weigh-in (${last}) — check before saving` : "";
      };
    });
  };
  $("#bA").onchange = draw;
  draw();
  $("#bSave").onclick = async () => {
    const entries = $$("[data-pid]", host).filter((x) => x.value !== "").map((x) => ({ player_id: x.dataset.pid, weight: x.value, note: ($(`[data-note="${x.dataset.pid}"]`, host) || {}).value || "" }));
    if (!entries.length) { $("#bErr").textContent = "Enter at least one weight."; return; }
    try {
      const r = await api("POST", "weights.bulk", { body: { date: $("#bD").value, unit: $("#bU").value, entries } });
      if (r.errors.length) { const names = r.errors.map((e) => `${playerName(list.find((p) => p.id === e.player_id))}: ${e.error}`); $("#bErr").textContent = "Nothing saved — fix these first: " + names.join(" · "); return; }
      invalidate(); toast(`${r.saved} weight${r.saved === 1 ? "" : "s"} saved for ${fmtDate($("#bD").value)}`); bulk(host);
    } catch (e) { $("#bErr").textContent = e.message; }
  };
}

/* ------------------------------------------------------------------ follow-ups */
async function renderFollowups(view = "open") {
  if (!can("read_notes")) { app.innerHTML = `<div class="pagehead"><h1>Follow-Ups</h1></div><section class="panel"><div class="empty"><span class="lock">🔒 Follow-ups are part of the nutrition notes, which your role can't view.</span></div></section>`; return; }
  const all = await api("GET", "followups");
  const t = today();
  const f = JSON.parse(sessionStorage.getItem("fuel:ff") || "{}");
  const views = { open: (x) => x.status === "open", overdue: (x) => x.overdue, completed: (x) => x.status === "completed", all: () => true };
  if (!views[view]) view = "open";
  app.innerHTML = `<div class="pagehead"><div><h1>Follow-Ups</h1><div class="sub">${all.filter(views.open).length} open · ${all.filter(views.overdue).length} overdue</div></div><span class="sp"></span>${can("write_nutrition") ? '<button class="btn primary" id="newF">+ Follow-up</button>' : ""}</div>
    <nav class="tabs">${[["open", "Open"], ["overdue", "Overdue"], ["completed", "Completed"], ["all", "All"]].map(([k, l]) => `<a href="#/followups/${k}" class="${k === view ? "on" : ""}">${l} <span class="num faint">${all.filter(views[k]).length}</span></a>`).join("")}</nav>
    <div class="filters"><select id="ffA" aria-label="Assigned to"><option value="">Anyone</option>${S.staff.map((s) => `<option value="${esc(s.id)}"${s.id === f.a ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <select id="ffAff" aria-label="Affiliate"><option value="">All affiliates</option>${S.session.vocab.affiliates.map((a) => `<option${a === f.aff ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
    <section class="panel"><div class="tblwrap" id="fT"></div></section>`;
  const draw = () => {
    const a = $("#ffA").value, aff = $("#ffAff").value; sessionStorage.setItem("fuel:ff", JSON.stringify({ a, aff }));
    const rows = all.filter(views[view]).filter((x) => (!a || x.assignee === a) && (!aff || x.affiliate === aff));
    table($("#fT"), { rows, sortKey: "due_date", sortDir: view === "completed" ? -1 : 1, empty: "Nothing here.", cols: [
      { key: "due_date", label: "Due", sort: (r) => r.due_date, render: (r) => `<span class="num">${esc(fmtDate(r.due_date, { year: false }))}</span> ${r.overdue ? '<span class="tag bad">overdue</span>' : r.status === "open" && r.due_date === t ? '<span class="tag orange">today</span>' : ""}` },
      { key: "player_name", label: "Player", sort: (r) => r.player_name, render: (r) => `<a class="pname" href="#/player/${esc(r.player_id)}">${esc(r.player_name)}</a> <span class="faint small">${esc(r.affiliate || "")}</span>` },
      { key: "description", label: "Follow-up", render: (r) => esc(r.description) + (r.interaction_id ? ' <span class="tag ghost" title="Created from a nutrition note">from note</span>' : "") },
      { key: "assignee_name", label: "Assigned", sort: (r) => r.assignee_name || "", render: (r) => esc(r.assignee_name || "—") },
      { key: "priority", label: "Priority", sort: (r) => ["high", "normal", "low"].indexOf(r.priority), render: (r) => r.priority === "high" ? '<span class="tag orange">high</span>' : esc(r.priority) },
      { key: "status", label: "Status", render: (r) => r.status === "completed" ? `<span class="tag good">done ${esc(fmtDate(r.completed_date, { year: false }))}</span>` : esc(r.status) },
      ...(can("write_nutrition") ? [{ key: "act", label: "", render: (r) => r.status === "open" ? `<button class="btn sm" data-c="${esc(r.id)}">Done</button> <button class="btn ghost sm" data-r="${esc(r.id)}">Reschedule</button>` : `<button class="btn ghost sm" data-o="${esc(r.id)}">Reopen</button>` }] : []),
    ] });
    const upd = async (id, body, msg) => { try { await api("POST", "followup.update", { body: { id, ...body } }); invalidate(); toast(msg); renderFollowups(view); } catch (e) { errToast(e); } };
    $$("[data-c]").forEach((b) => (b.onclick = () => upd(b.dataset.c, { status: "completed" }, "Follow-up completed")));
    $$("[data-o]").forEach((b) => (b.onclick = () => upd(b.dataset.o, { status: "open" }, "Follow-up reopened")));
    $$("[data-r]").forEach((b) => (b.onclick = () => { const r = all.find((x) => x.id === b.dataset.r); const m = openModal(`<header><h2 id="modalTitle">Reschedule</h2><button class="x" data-close aria-label="Close">×</button></header><div class="mb"><div class="f"><label for="rD">New due date</label><input type="date" id="rD" value="${esc(addDays(r.due_date < t ? t : r.due_date, 7))}" autofocus></div></div><footer><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rOk">Save</button></footer>`);
      $("#rOk", m).onclick = () => upd(r.id, { due_date: $("#rD").value }, "Rescheduled"); }));
  };
  $("#ffA").onchange = draw; $("#ffAff").onchange = draw;
  draw();
  const nf = $("#newF"); if (nf) nf.onclick = () => {
    const m = openModal(`<header><h2 id="modalTitle">New follow-up</h2><button class="x" data-close aria-label="Close">×</button></header><form class="mb form" id="nfF"><div class="f"><span class="lbl">Player</span><div id="nfP"></div></div>
      <div class="f"><label for="nfD">What</label><input type="text" id="nfD" required></div>
      <div class="row"><div class="f"><label for="nfDue">Due</label><input type="date" id="nfDue" value="${esc(addDays(t, 7))}"></div><div class="f"><label for="nfA">Assigned to</label><select id="nfA">${S.staff.filter((s) => s.role !== "readonly").map((s) => `<option value="${esc(s.id)}"${s.id === S.session.user.staff_id ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="f"><label for="nfPr">Priority</label><select id="nfPr"><option>normal</option><option>high</option><option>low</option></select></div></div><div class="err" id="nfErr" role="alert"></div></form>
      <footer><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit" form="nfF">Create</button></footer>`);
    let pl = null; playerPicker($("#nfP", m), { onPick: (p) => (pl = p) }).focus();
    $("#nfF", m).onsubmit = async (e) => { e.preventDefault(); if (!pl) { $("#nfErr").textContent = "Choose a player."; return; } try { await api("POST", "followup", { body: { player_id: pl.id, description: $("#nfD").value, due_date: $("#nfDue").value, assignee: $("#nfA").value, priority: $("#nfPr").value } }); invalidate(); closeModal(); toast("Follow-up created"); renderFollowups(view); } catch (err) { $("#nfErr").textContent = err.message; } };
  };
}

function renderMore() {
  app.innerHTML = `<div class="pagehead"><h1>More</h1></div><section class="panel more-list" style="padding:0 12px">
    <a href="#/log">Daily Log <span>›</span></a><a href="#/log/bulk">Bulk weigh-in <span>›</span></a><a href="#/reports">Reports <span>›</span></a><a href="#/data">Data management <span>›</span></a></section>`;
}

boot();
