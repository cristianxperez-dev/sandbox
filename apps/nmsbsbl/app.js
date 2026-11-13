/* NMSBSBL — application shell: pitcher directory, pitcher profile (Overview · Arsenal), routing.
   Data (all behind the access gate): api/roster, api/pitcher, api/pitches (see functions/apps/nmsbsbl/api/).
   Routes (hash): #/  ·  #/p/<MLBAM id>  ·  #/p/<id>/arsenal  ·  …?s=<season> */
(function () {
  "use strict";
  const C = window.NMS_CORE, PT = window.AGORA_PITCHES, HS = window.EPHYRA_HEADSHOTS, AGE = window.AGORA_AGE, CH = window.NMS_CHART;
  const main = document.getElementById("main");
  const isNum = C.isNum;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (v) => (isNum(v) ? v.toFixed(1) : "—"), f2 = (v) => (isNum(v) ? v.toFixed(2) : "—"), f0 = (v) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
  const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : "—");
  const pct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + "%" : "—");
  const YEAR = new Date().getFullYear();
  const narrow = () => window.matchMedia("(max-width: 760px)").matches;
  const handLabel = (t) => (t === "L" ? "LHP" : t === "R" ? "RHP" : "P");

  /* ---------------- data ---------------- */
  const cache = new Map();
  async function getJSON(url) {
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(async (r) => {
      if (r.status === 401) { location.href = "access/?next=" + encodeURIComponent(location.pathname + location.hash); throw new Error("signed-out"); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      return j;
    });
    cache.set(url, p); p.catch(() => cache.delete(url));
    return p;
  }
  function getPitches(id, season) {
    const url = `api/pitches?id=${id}&season=${season}`;
    if (cache.has(url)) return cache.get(url);
    const p = fetch(url, { credentials: "same-origin" }).then(async (r) => {
      if (r.status === 401) { location.href = "access/?next=" + encodeURIComponent(location.pathname + location.hash); throw new Error("signed-out"); }
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "HTTP " + r.status); }
      return { pitches: C.parsePitches(await r.text()), stale: r.headers.get("X-Stale") === "1", fetchedAt: r.headers.get("X-Fetched-At") };
    });
    cache.set(url, p); p.catch(() => cache.delete(url));
    return p;
  }

  /* ---------------- routing ---------------- */
  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?"), q = new URLSearchParams(qs || "");
    const m = /^\/p\/(\d{5,7})(?:\/(arsenal|overview))?\/?$/.exec(path);
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", !m));
    if (m) return profile(+m[1], m[2] || "overview", q.get("s"));
    return directory(q);
  }
  window.addEventListener("hashchange", () => { const prev = state.profileKey; route(); if (!state.profileKey || state.profileKey !== prev) window.scrollTo(0, 0); });
  const state = { dir: { q: "", hand: "", role: "" }, profileKey: null, chart: null, ars: { mode: "pitches", side: "", hidden: new Set(), focus: null, spread: true } };

  /* ---------------- directory ---------------- */
  async function directory() {
    state.profileKey = null; state.chart = null;
    document.title = "NMSBSBL — Pitchers";
    main.innerHTML = `<section class="dir">
      <div class="dir-hero"><div><div class="eyebrow">Pitching Intelligence</div><h1 class="h1">Pitchers</h1></div>
        <div class="dir-tools">
          <label class="search"><span class="sr">Search pitchers</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="q" placeholder="Search name or team" autocomplete="off" value="${esc(state.dir.q)}"></label>
          <div class="seg" role="group" aria-label="Filter">${[["", "All"], ["R", "RHP"], ["L", "LHP"]].map(([v, l]) => `<button data-hand="${v}" aria-pressed="${state.dir.hand === v}">${l}</button>`).join("")}<span class="seg-sep"></span>${[["SP", "Starters"], ["RP", "Relievers"]].map(([v, l]) => `<button data-role="${v}" aria-pressed="${state.dir.role === v}">${l}</button>`).join("")}</div>
        </div></div>
      <div class="grid" id="grid">${Array.from({ length: 8 }, () => `<div class="pc skel"><div class="pc-photo"></div><div class="pc-body"><i></i><i></i><i></i></div></div>`).join("")}</div>
    </section>`;
    let data;
    try { data = await getJSON(`api/roster?season=${YEAR}`); }
    catch (e) { if (e.message === "signed-out") return; main.querySelector("#grid").innerHTML = errorHTML("The pitcher list couldn't load.", e.message); return; }
    const role = (p) => (p.season && isNum(p.season.gs) && isNum(p.season.gp) ? (p.season.gs >= p.season.gp / 2 ? "SP" : "RP") : null);
    const list = data.pitchers.slice().sort((a, b) => a.last.localeCompare(b.last));
    const draw = () => {
      const q = state.dir.q.trim().toLowerCase();
      const shown = list.filter((p) => (!state.dir.hand || p.throws === state.dir.hand) && (!state.dir.role || role(p) === state.dir.role)
        && (!q || (p.name + " " + (p.team || "") + " " + (p.teamAbbr || "")).toLowerCase().includes(q)));
      const grid = main.querySelector("#grid"); if (!grid) return;
      grid.innerHTML = shown.length ? shown.map((p) => cardHTML(p, role(p), data.season)).join("") : `<p class="none">No pitchers match “${esc(state.dir.q)}”.</p>`;
      const c = main.querySelector(".count"); if (c) c.textContent = `${shown.length} of ${list.length}`;
    };
    main.querySelector(".dir-hero h1").insertAdjacentHTML("afterend", `<div class="count" aria-live="polite"></div>`);
    draw();
    main.querySelector("#q").addEventListener("input", (e) => { state.dir.q = e.target.value; draw(); });
    main.querySelectorAll("[data-hand]").forEach((b) => b.addEventListener("click", () => { state.dir.hand = b.dataset.hand; main.querySelectorAll("[data-hand]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
    main.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => { state.dir.role = state.dir.role === b.dataset.role ? "" : b.dataset.role; main.querySelectorAll("[data-role]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.role === state.dir.role)); draw(); }));
    if (!narrow()) main.querySelector("#q").focus({ preventScroll: true });
  }
  function cardHTML(p, role, season) {
    const s = p.season;
    const line = s ? [["IP", s.ip], ["ERA", s.era], ["K%", isNum(s.kPct) ? s.kPct.toFixed(1) : "—"], [role === "RP" ? "SV" : "GS", role === "RP" ? s.saves : s.gs]] : null;
    return `<a class="pc" href="#/p/${p.id}" aria-label="${esc(p.name)}, ${esc(p.team || "")}, ${handLabel(p.throws)}">
      <div class="pc-photo">${HS.html(p.id, p.name, { size: "lg", alt: "" })}<span class="pc-hand">${handLabel(p.throws)}${role ? " · " + role : ""}</span></div>
      <div class="pc-body"><div class="pc-name"><span>${esc(p.first)}</span> <b>${esc(p.last)}</b></div><div class="pc-team-n">${esc(p.team || "Free agent")}</div>
      ${line ? `<dl class="pc-line">${line.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v == null ? "—" : v)}</dd></div>`).join("")}</dl><div class="pc-season">${esc(season)} MLB</div>` : `<div class="pc-season muted">No ${esc(season)} MLB innings</div>`}</div></a>`;
  }
  const errorHTML = (msg, detail) => `<div class="err-box" role="alert"><b>${esc(msg)}</b><span>${esc(detail || "")}</span><button class="btn" data-reload>Try again</button></div>`;

  /* ---------------- profile ---------------- */
  async function profile(id, tab, seasonQ) {
    const key = id + "|" + tab + "|" + (seasonQ || "");
    if (state.profileKey && state.profileKey.split("|")[0] === String(id) && main.querySelector(".prof")) {
      // same pitcher: switch tab / season in place
      state.profileKey = key;
      return renderProfile(id, tab, seasonQ, true);
    }
    state.profileKey = key;
    state.ars = { mode: "pitches", side: "", hidden: new Set(), focus: null, spread: true };
    main.innerHTML = `<div class="prof"><div class="hero skel"><div class="hero-in"><div class="hero-photo"></div><div class="hero-id"><i></i><i></i><i></i></div></div></div><div class="loading">Loading pitcher…</div></div>`;
    return renderProfile(id, tab, seasonQ, false);
  }
  async function renderProfile(id, tab, seasonQ, inPlace) {
    let d;
    try { d = await getJSON(`api/pitcher?id=${id}`); }
    catch (e) { if (e.message === "signed-out") return; main.innerHTML = errorHTML("This pitcher couldn't load.", e.message); return; }
    const seasons = d.statcastSeasons.length ? d.statcastSeasons : [YEAR];
    const season = seasons.includes(+seasonQ) ? +seasonQ : seasons[0];
    const p = d.player, line = d.seasons.find((s) => +s.season === season) || null;
    document.title = `${p.name} — NMSBSBL`;
    const ageRef = AGE.ageRef(season), age = AGE.ageText(p.birthDate, ageRef);
    if (!inPlace || !main.querySelector(".hero:not(.skel)")) {
      main.innerHTML = `<div class="prof">
        <section class="hero"><div class="hero-in">
          <div class="hero-photo"><span class="hero-team" aria-hidden="true">${esc(p.teamAbbr || "")}</span>${HS.html(p.id, p.name, { size: "lg", lazy: false })}</div>
          <div class="hero-id">
            <a class="back" href="#/">← Pitchers</a>
            <div class="eyebrow">${esc(p.team || "")}${p.number ? ` · #${esc(p.number)}` : ""}</div>
            <h1 class="hero-name"><span>${esc(p.first)}</span><b>${esc(p.last)}</b></h1>
            <ul class="facts"><li><b>${handLabel(p.throws)}</b></li><li id="ageFact"></li>${p.height ? `<li>${esc(p.height.replace(/\s/g, ""))}</li>` : ""}${p.weight ? `<li>${esc(p.weight)} lb</li>` : ""}${p.debut ? `<li>Debut ${esc(p.debut.slice(0, 4))}</li>` : ""}</ul>
            <div class="hero-line" id="heroLine"></div>
          </div></div></section>
        <div class="tabbar"><div class="tabs" role="tablist" aria-label="Profile">
          <a role="tab" data-tab="overview" href="#/p/${p.id}">Overview</a><a role="tab" data-tab="arsenal" href="#/p/${p.id}/arsenal">Arsenal</a></div>
          <label class="season-sel"><span>Season</span><select id="season" aria-label="Season">${seasons.map((y) => `<option value="${y}">${y}</option>`).join("")}</select></label></div>
        <div id="tabBody" class="tabbody"></div></div>`;
      main.querySelector("#season").addEventListener("change", (e) => { location.hash = `#/p/${p.id}${state.tab === "arsenal" ? "/arsenal" : ""}?s=${e.target.value}`; });
    }
    state.tab = tab;
    main.querySelector("#season").value = String(season);
    main.querySelectorAll("[data-tab]").forEach((a) => { const on = a.dataset.tab === tab; a.setAttribute("aria-selected", on); a.classList.toggle("on", on); a.href = `#/p/${p.id}${a.dataset.tab === "arsenal" ? "/arsenal" : ""}${season !== seasons[0] ? "?s=" + season : ""}`; });
    main.querySelector("#ageFact").innerHTML = age ? `Age <b>${age}</b>${season < YEAR ? ` <small>(${season} season)</small>` : ""}` : "";
    main.querySelector("#heroLine").innerHTML = line ? heroLineHTML(line, season) : `<span class="muted">No ${season} MLB line</span>`;
    const body = main.querySelector("#tabBody");
    body.innerHTML = `<div class="loading">Loading ${season} pitches…</div>`;
    let px;
    try { px = await getPitches(p.id, season); }
    catch (e) { if (e.message === "signed-out") return; body.innerHTML = errorHTML(`${season} Statcast data couldn't load.`, e.message); return; }
    if (state.profileKey && !state.profileKey.startsWith(p.id + "|")) return;   // navigated away meanwhile
    if (!px.pitches.length) { body.innerHTML = `<div class="err-box"><b>No tracked ${season} MLB pitches.</b><span>Choose another season.</span></div>`; return; }
    const ctx = { p, d, line, season, pitches: px.pitches, stale: px.stale };
    if (tab === "arsenal") renderArsenal(body, ctx); else renderOverview(body, ctx);
  }
  function heroLineHTML(s, season) {
    const role = isNum(s.gs) && isNum(s.gp) && s.gs >= s.gp / 2 ? "SP" : "RP";
    const items = [["G", s.gp], [role === "RP" ? "SV" : "GS", role === "RP" ? s.saves : s.gs], ["IP", s.ip], ["ERA", s.era], ["WHIP", s.whip], ["K%", isNum(s.kPct) ? s.kPct.toFixed(1) : null], ["BB%", isNum(s.bbPct) ? s.bbPct.toFixed(1) : null]];
    return `<span class="hl-k">${season}${s.teams && s.teams.length > 1 ? " · " + s.teams.join("/") : ""}</span>${items.map(([k, v]) => `<span class="hl"><b>${esc(v == null ? "—" : v)}</b><small>${k}</small></span>`).join("")}`;
  }

  /* ---------------- overview ---------------- */
  function renderOverview(body, ctx) {
    const { pitches, season, d, p } = ctx;
    const ars = C.arsenal(pitches), sum = C.summary(pitches, ars), vsL = C.arsenal(pitches, { side: "L" }), vsR = C.arsenal(pitches, { side: "R" });
    const rows = ars.rows, fb = sum.fastball;
    const vmin = Math.floor(Math.min(...rows.map((r) => r.velo).filter(isNum)) - 3), vmax = Math.ceil(Math.max(...rows.map((r) => r.veloMax).filter(isNum)) + 1);
    const vx = (v) => ((v - vmin) / (vmax - vmin)) * 100;
    const bar = (a) => `<div class="ubar" role="img" aria-label="${esc(a.rows.map((r) => PT.info(r.type).name + " " + pct(r.usage, 0)).join(", "))}">${a.rows.filter((r) => r.usage >= 0.005).map((r) => { const i = PT.info(r.type); return `<span style="flex:${r.usage};background:${i.color}" title="${esc(i.name)} ${pct(r.usage)}">${r.usage >= 0.07 ? `<em style="color:${lum(i.color) > 0.55 ? "#111315" : "#fff"}">${i.code}</em>` : ""}</span>`; }).join("")}</div>`;
    const careers = d.seasons.slice(0, 6);
    body.innerHTML = `<div class="ov">
      ${ctx.stale ? `<p class="stale">Showing the last saved copy of the Statcast data — Baseball Savant couldn't be reached.</p>` : ""}
      <section class="card ov-chars"><h2 class="h2">${season} at a glance</h2>
        <div class="kpis">
          ${kpi("Primary fastball", fb ? `${f1(fb.velo)}<small> mph</small>` : "—", fb ? `${PT.info(fb.type).name} · ${sgn(fb.ivb)} IVB · ${sgn(fb.hb)} HB` : "")}
          ${kpi("Peak velocity", sum.maxVelo ? `${f1(sum.maxVelo)}<small> mph</small>` : "—", fb ? `${f0(fb.spin)} rpm fastball spin` : "")}
          ${kpi("Release", `${f1(sum.relZ)}<small> ft</small>`, `height · side ${sgn(sum.relX)} ft`)}
          ${kpi("Extension", `${f1(sum.ext)}<small> ft</small>`, isNum(sum.arm) ? `arm angle ${f0(sum.arm)}°` : "")}
          ${kpi("Whiff rate", pct(sum.whiffPct), `CSW ${pct(sum.cswPct)}`)}
          ${kpi("Pitch mix", `${sum.mainTypes}<small> pitches</small>`, `${sum.pitches.toLocaleString()} tracked · ${sum.games} games`)}
        </div></section>
      <div class="ov-cols">
        <section class="card"><div class="card-h"><h2 class="h2">Arsenal</h2><a class="link" href="#/p/${p.id}/arsenal${season !== d.statcastSeasons[0] ? "?s=" + season : ""}">Break chart →</a></div>
          ${bar(ars)}
          <table class="mini"><thead><tr><th>Pitch</th><th class="n">Usage</th><th class="n">Velo</th><th class="n">IVB</th><th class="n">HB</th><th class="n">Spin</th></tr></thead><tbody>
          ${rows.map((r) => { const i = PT.info(r.type); return `<tr><td>${ptag(r.type)}</td><td class="n">${pct(r.usage)}</td><td class="n">${f1(r.velo)}</td><td class="n">${sgn(r.ivb)}</td><td class="n">${sgn(r.hb)}</td><td class="n">${f0(r.spin)}</td></tr>`; }).join("")}</tbody></table>
          <p class="note">IVB and HB in inches; HB from the pitcher’s view (+ = ${p.throws === "L" ? "glove" : "arm"} side for a ${handLabel(p.throws)}).</p></section>
        <section class="card ov-move"><div class="card-h"><h2 class="h2">Movement profile</h2><a class="link" href="#/p/${p.id}/arsenal${season !== d.statcastSeasons[0] ? "?s=" + season : ""}">Explore →</a></div><div id="miniChart"></div></section>
      </div>
      <div class="ov-cols">
        <section class="card"><h2 class="h2">Velocity by pitch</h2>
          <div class="velo" role="img" aria-label="Average velocity by pitch type">${rows.filter((r) => isNum(r.velo)).map((r) => { const i = PT.info(r.type), lo = isNum(r.veloSd) ? r.velo - r.veloSd : r.velo, hi = isNum(r.veloSd) ? r.velo + r.veloSd : r.velo; return `<div class="vrow"><span class="vlab">${ptag(r.type, true)}</span><div class="vtrack"><i class="vband" style="left:${vx(lo)}%;width:${Math.max(0.6, vx(hi) - vx(lo))}%;background:${i.color}"></i><i class="vmean" style="left:${vx(r.velo)}%;background:${i.color}"></i>${isNum(r.veloMax) ? `<i class="vmax" style="left:${vx(r.veloMax)}%" title="Max ${f1(r.veloMax)}"></i>` : ""}</div><b class="vval">${f1(r.velo)}</b></div>`; }).join("")}
          <div class="vaxis"><span></span><div>${[0, 0.25, 0.5, 0.75, 1].map((t) => `<em style="left:${t * 100}%">${Math.round(vmin + t * (vmax - vmin))}</em>`).join("")}</div><span></span></div></div>
          <p class="note">Average (dot), ±1 SD (bar), season max (tick), mph.</p></section>
        <section class="card"><h2 class="h2">Usage by batter side</h2>
          <div class="side"><div class="side-r"><b>vs LHH</b><small>${vsL.total.toLocaleString()} pitches</small></div>${bar(vsL)}</div>
          <div class="side"><div class="side-r"><b>vs RHH</b><small>${vsR.total.toLocaleString()} pitches</small></div>${bar(vsR)}</div>
          <table class="mini"><thead><tr><th>Pitch</th><th class="n">vs LHH</th><th class="n">vs RHH</th></tr></thead><tbody>${rows.map((r) => { const l = vsL.rows.find((x) => x.type === r.type), rr = vsR.rows.find((x) => x.type === r.type); return `<tr><td>${ptag(r.type)}</td><td class="n">${pct(l ? l.usage : 0)}</td><td class="n">${pct(rr ? rr.usage : 0)}</td></tr>`; }).join("")}</tbody></table></section>
      </div>
      <section class="card"><h2 class="h2">Pitching by season <small>MLB · regular season</small></h2>
        <div class="tscroll"><table class="stats"><thead><tr><th>Season</th><th>Team</th><th class="n">G</th><th class="n">GS</th><th class="n">IP</th><th class="n">ERA</th><th class="n">WHIP</th><th class="n">K%</th><th class="n">BB%</th><th class="n">K/9</th><th class="n">SV</th></tr></thead>
        <tbody>${careers.map((s) => `<tr class="${+s.season === season ? "on" : ""}"><td>${s.season}</td><td>${esc((s.teams || []).join(" / "))}</td><td class="n">${s.gp ?? "—"}</td><td class="n">${s.gs ?? "—"}</td><td class="n">${esc(s.ip || "—")}</td><td class="n">${esc(s.era || "—")}</td><td class="n">${esc(s.whip || "—")}</td><td class="n">${isNum(s.kPct) ? s.kPct.toFixed(1) : "—"}</td><td class="n">${isNum(s.bbPct) ? s.bbPct.toFixed(1) : "—"}</td><td class="n">${esc(s.k9 || "—")}</td><td class="n">${s.saves ?? "—"}</td></tr>`).join("")}</tbody></table></div></section>
    </div>`;
    CH.mount(body.querySelector("#miniChart"), { pitches, arsenal: ars, throws: p.throws, armAngle: sum.arm, mode: "averages", spread: true, hidden: new Set() });
  }
  const kpi = (k, v, sub) => `<div class="kpi"><span class="kpi-k">${esc(k)}</span><b class="kpi-v">${v}</b><span class="kpi-s">${esc(sub || "")}</span></div>`;
  function lum(hex) { const n = parseInt(String(hex).slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
  const ptag = (t, short) => { const i = PT.info(t); return `<span class="ptag"><i style="background:${i.color}"></i><b>${i.code}</b>${short ? "" : `<span>${esc(i.name)}</span>`}</span>`; };

  /* ---------------- arsenal ---------------- */
  function renderArsenal(body, ctx) {
    const { pitches, p, season } = ctx, A = state.ars;
    const sel = () => (A.side ? pitches.filter((x) => x.stand === A.side) : pitches);
    const armAll = C.mean(pitches.map((x) => x.arm));
    body.innerHTML = `<div class="ars">
      ${ctx.stale ? `<p class="stale">Showing the last saved copy of the Statcast data — Baseball Savant couldn't be reached.</p>` : ""}
      <section class="card bc-card">
        <div class="bc-head"><div><h2 class="h2">Break chart</h2><p class="sub" id="bcSub"></p></div>
          <div class="bc-ctrls">
            <div class="seg" role="group" aria-label="View">${[["pitches", "Pitches"], ["averages", "Averages"]].map(([v, l]) => `<button data-mode="${v}" aria-pressed="${A.mode === v}">${l}</button>`).join("")}</div>
            <div class="seg" role="group" aria-label="Batter side">${[["", "All"], ["R", "vs RHH"], ["L", "vs LHH"]].map(([v, l]) => `<button data-side="${v}" aria-pressed="${A.side === v}">${l}</button>`).join("")}</div>
            <button class="tgl" data-spread aria-pressed="${A.spread}"><i></i>Spread</button>
          </div></div>
        <div class="bc-body"><div id="bc" class="bc-wrap"></div>
          <aside class="bc-panel"><div class="lg-h"><span>Pitch types</span><button class="link sm" data-allon hidden>Show all</button></div><div class="legend" id="legend" role="group" aria-label="Pitch types — click to show or hide, double-click to show one"></div>
          <div id="focusCard" class="focus"></div>
          <p class="note">Each dot is one pitch (Statcast). Large markers are pitch-type averages; rings show where 68% of that type’s pitches land. Click a marker or a legend item to focus it. HB is from the pitcher’s view, never mirrored — for a ${handLabel(p.throws)}, + is ${p.throws === "L" ? "glove" : "arm"} side.</p></aside></div>
      </section>
      <section class="card"><div class="card-h"><h2 class="h2">Arsenal <small id="arsSub"></small></h2></div><div id="arsTable"></div></section>
    </div>`;
    const bcEl = body.querySelector("#bc");
    function draw() {
      const P = sel(), ars = C.arsenal(P), allArs = C.arsenal(pitches);
      // the legend keeps every type the pitcher threw this season (stable order), counts follow the selection
      const legend = body.querySelector("#legend");
      legend.innerHTML = allArs.rows.map((r) => { const i = PT.info(r.type), cur = ars.rows.find((x) => x.type === r.type); const off = A.hidden.has(r.type); return `<button class="lg ${A.focus === r.type ? "focus" : ""}" data-type="${r.type}" aria-pressed="${!off}" ${!cur ? "disabled" : ""}><i style="background:${i.color}"></i><b>${i.code}</b><span class="lg-n">${esc(i.name)}</span><span class="lg-u">${cur ? pct(cur.usage, 0) : "—"}</span></button>`; }).join("");
      body.querySelector("[data-allon]").hidden = !A.hidden.size;
      const sub = `${season} · ${P.length.toLocaleString()} pitches${A.side ? " vs " + (A.side === "L" ? "LHH" : "RHH") : ""}${A.hidden.size ? ` · ${A.hidden.size} type${A.hidden.size > 1 ? "s" : ""} hidden` : ""}`;
      body.querySelector("#bcSub").textContent = sub;
      body.querySelector("#arsSub").textContent = `${season}${A.side ? " · vs " + (A.side === "L" ? "LHH" : "RHH") : ""}`;
      const opts = { pitches: P, arsenal: ars, throws: p.throws, armAngle: armAll, mode: A.mode, side: A.side, hidden: A.hidden, focus: A.focus, spread: A.spread, onChange: (c) => { if ("focus" in c) { A.focus = c.focus; draw(); } } };
      if (state.chart && state.chart.el === bcEl) state.chart.api.update(opts); else state.chart = { el: bcEl, api: CH.mount(bcEl, opts) };
      focusCard(body.querySelector("#focusCard"), ars);
      body.querySelector("#arsTable").innerHTML = narrow() ? arsCardsHTML(ars) : arsTableHTML(ars);
    }
    function focusCard(elx, ars) {
      const r = A.focus && ars.rows.find((x) => x.type === A.focus);
      if (!r) { elx.innerHTML = ""; return; }
      const i = PT.info(r.type);
      elx.innerHTML = `<div class="focus-h"><i style="background:${i.color}"></i><b>${esc(i.name)}</b><button class="link sm" data-unfocus>Clear</button></div>
        <dl class="focus-d"><div><dt>Usage</dt><dd>${pct(r.usage)}</dd></div><div><dt>Velo</dt><dd>${f1(r.velo)}</dd></div><div><dt>IVB</dt><dd>${sgn(r.ivb)}</dd></div><div><dt>HB</dt><dd>${sgn(r.hb)}</dd></div>
        <div><dt>Spin</dt><dd>${f0(r.spin)}</dd></div><div><dt>Tilt</dt><dd>${C.tilt(r.axis) || "—"}</dd></div><div><dt>Whiff</dt><dd>${pct(r.whiffPct)}</dd></div><div><dt>Pitches</dt><dd>${r.n.toLocaleString()}</dd></div></dl>`;
    }
    body.querySelector(".bc-ctrls").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.mode) { A.mode = b.dataset.mode; body.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
      else if (b.dataset.side != null && b.hasAttribute("data-side")) { A.side = b.dataset.side; body.querySelectorAll("[data-side]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }
      else if (b.hasAttribute("data-spread")) { A.spread = !A.spread; b.setAttribute("aria-pressed", A.spread); }
      draw();
    });
    let clickT = null;
    body.querySelector(".bc-panel").addEventListener("click", (e) => {
      if (e.target.closest("[data-allon]")) { A.hidden.clear(); draw(); return; }
      if (e.target.closest("[data-unfocus]")) { A.focus = null; draw(); return; }
      const b = e.target.closest(".lg"); if (!b) return;
      const t = b.dataset.type;
      if (e.detail === 2) {   // double-click: show only this one
        clearTimeout(clickT);
        const all = Array.from(body.querySelectorAll(".lg")).map((x) => x.dataset.type);
        const solo = A.hidden.size === all.length - 1 && !A.hidden.has(t);
        A.hidden = solo ? new Set() : new Set(all.filter((x) => x !== t)); A.focus = null; draw(); return;
      }
      clickT = setTimeout(() => { if (A.hidden.has(t)) A.hidden.delete(t); else { A.hidden.add(t); if (A.focus === t) A.focus = null; } draw(); }, 220);
    });
    draw();
    const mq = window.matchMedia("(max-width: 760px)");
    const onMq = () => { if (body.isConnected) body.querySelector("#arsTable").innerHTML = mq.matches ? arsCardsHTML(C.arsenal(sel())) : arsTableHTML(C.arsenal(sel())); };
    mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener(onMq);
  }
  const COLS = [
    ["Usage", (r) => pct(r.usage), "Share of the selection’s pitches"], ["#", (r) => r.n.toLocaleString(), "Pitches"],
    ["Velo", (r) => f1(r.velo), "Average release speed, mph"], ["Max", (r) => f1(r.veloMax), "Fastest, mph"],
    ["IVB", (r) => sgn(r.ivb), "Induced vertical break, in (Statcast pfx_z × 12)"], ["HB", (r) => sgn(r.hb), "Horizontal break, in, pitcher’s view (−12 × pfx_x)"],
    ["Spin", (r) => f0(r.spin), "Release spin rate, rpm"], ["Tilt", (r) => C.tilt(r.axis) || "—", "Spin axis on a clock face (Statcast spin_axis)"],
    ["RelZ", (r) => f2(r.relZ), "Release height, ft"], ["RelX", (r) => sgn(r.relX, 2), "Release side, ft, pitcher’s view"], ["Ext", (r) => f1(r.ext), "Extension, ft"],
    ["Whiff%", (r) => pct(r.whiffPct), "Whiffs per swing"], ["CSW%", (r) => pct(r.cswPct), "Called strikes + whiffs per pitch"]
  ];
  function arsTableHTML(ars) {
    const A = state.ars;
    return `<div class="tscroll"><table class="ars-t"><thead><tr><th>Pitch</th>${COLS.map(([k, , t]) => `<th class="n" title="${esc(t)}">${k}</th>`).join("")}</tr></thead>
      <tbody>${ars.rows.map((r) => `<tr class="${A.focus === r.type ? "on" : ""} ${A.hidden.has(r.type) ? "off" : ""}"><td>${ptag(r.type)}</td>${COLS.map(([, fn]) => `<td class="n">${fn(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="note">Statcast, regular season. RelX and HB from the pitcher’s view (+ = toward third base). Averages exclude pitches where a value wasn’t recorded; nothing is estimated.</p>`;
  }
  function arsCardsHTML(ars) {
    return `<div class="acards">${ars.rows.map((r) => `<div class="acard"><div class="acard-h">${ptag(r.type)}<b>${pct(r.usage)}</b></div><dl>${COLS.slice(2).map(([k, fn]) => `<div><dt>${k}</dt><dd>${fn(r)}</dd></div>`).join("")}</dl></div>`).join("")}</div>
      <p class="note">Statcast, regular season. HB and RelX from the pitcher’s view.</p>`;
  }

  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("[data-reload]")) location.reload(); });
  // the gate's sign-out route (a server route, not a file — set here so the static link check doesn't look for it)
  const so = document.getElementById("signout"); if (so) so.href = "access/logout";
  route();
})();
