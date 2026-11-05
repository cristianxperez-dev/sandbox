/* Play Repository — page layer. Data: data/index.json (+ data/plays/<id>.json on demand).
   Coach data (saved plays, collections, notes, manual tags, imported plays) lives in this browser under
   localStorage "playRepository.v1" — export/import keeps a copy. Video is MLB.com's own embed, driven
   through its player.js interface; nothing is downloaded or rehosted. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PR = window.PR;
  const KEY = "playRepository.v1";
  const EMBED_ORIGIN = "https://streamable.com";
  const S = { plays: [], byId: new Map(), flags: {}, details: new Map(), f: PR.emptyFilters(), sort: "category", understood: null, lastExplore: "#/explore" };

  /* ================================================================ user data */
  const U = load();
  function load() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { d = {}; }
    return Object.assign({ saved: [], collections: {}, order: [], notes: {}, tags: {}, imported: [], queue: [], v: 1 }, d);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(U)); } catch (e) { toast("Couldn't save in this browser — export a copy from Help"); } }
  const userView = () => ({ saved: U.saved, collections: U.collections, tags: U.tags });
  const isSaved = (id) => U.saved.includes(id);
  function toggleSaved(id) {
    const i = U.saved.indexOf(id);
    if (i >= 0) U.saved.splice(i, 1); else U.saved.unshift(id);
    save(); toast(i >= 0 ? "Removed from Saved Plays" : "Saved", i >= 0 ? null : { label: "Undo", fn: () => { toggleSaved(id); if (!$("#vExplore").hidden) renderResults(); } });
    return i < 0;
  }
  const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function newCollection(name, desc = "") {
    const c = { id: uid(), name: name.trim() || "Untitled collection", desc, plays: [], created: new Date().toISOString() };
    U.collections[c.id] = c; U.order.unshift(c.id); save(); return c;
  }
  const collections = () => U.order.map((id) => U.collections[id]).filter(Boolean);
  const allTags = () => [...new Set(Object.values(U.tags).flat())].sort((a, b) => a.localeCompare(b));

  /* ================================================================ ui bits */
  let tt = null;
  function toast(msg, act) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>` + (act ? `<button>${esc(act.label)}</button>` : "");
    if (act) t.querySelector("button").onclick = () => { act.fn(); t.classList.remove("on"); };
    t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), act ? 6000 : 2600);
  }
  function modal(html, mount) {
    $("#modal").innerHTML = html; $("#scrim").hidden = false;
    $$("[data-close]", $("#modal")).forEach((b) => (b.onclick = closeModal));
    mount && mount($("#modal"));
    const f = $("#modal input, #modal button"); f && f.focus();
  }
  function closeModal() { $("#scrim").hidden = true; $("#modal").innerHTML = ""; }
  $("#scrim").addEventListener("mousedown", (e) => { if (e.target.id === "scrim") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#scrim").hidden) closeModal(); });

  /** the base-out diamond: bases "1_3", outs 0–2 */
  function diamond(code, { size = 44, outs = null, names = null, dark = false } = {}) {
    const on = (i) => code && code[i] !== "_";
    const fillOn = dark ? "#E6C9A6" : "#581B20", fillOff = dark ? "transparent" : "#FFFDF8", stroke = dark ? "#E6C9A6" : "#252525";
    const b = (x, y, i) => `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" transform="rotate(45 ${x} ${y})" fill="${on(i) ? fillOn : fillOff}" stroke="${stroke}" stroke-width="2.4"/>`;
    const outsSvg = outs == null ? "" : [0, 1].map((k) => `<circle cx="${38 + k * 24}" cy="104" r="6" fill="${k < outs ? fillOn : "none"}" stroke="${stroke}" stroke-width="2"/>`).join("");
    const lab = names ? [[1, 94, 53, "start"], [2, 50, 2, "middle"], [3, 6, 53, "end"]].map(([i, x, y, a]) => on(i - 1) && names[i + "B"] ? `<text x="${x}" y="${y}" text-anchor="${a}" font-size="8.5" font-family="Inter,sans-serif" fill="${dark ? "#F2EBDD" : "#4A4642"}">${esc(names[i + "B"].split(" ").slice(-1)[0])}</text>` : "").join("") : "";
    const h = outs == null ? 90 : 114;
    return `<svg viewBox="${names ? "-30 -10 160" : "0 0 100"} ${h + (names ? 10 : 0)}" width="${size}" height="${Math.round(size * h / 100)}" aria-label="${esc(PR.basesLabel(code))}${outs != null ? ", " + PR.outsLabel(outs) : ""}" role="img">
      <path d="M50 82 L82 50 L50 18 L18 50 Z" fill="none" stroke="${stroke}" stroke-opacity=".35" stroke-width="1.5"/>
      ${b(82, 50, 0)}${b(50, 18, 1)}${b(18, 50, 2)}<path d="M44 76 h12 v6 l-6 6 l-6 -6 z" fill="${stroke}" opacity=".7"/>${outsSvg}${lab}</svg>`;
  }
  const teamLine = (p) => `${p.away} ${p.score[0]}–${p.score[1]} ${p.home}`;
  const angleChip = (cat) => `<span class="ang a-${esc(cat)}">${cat === "high-home" ? "High Home" : cat === "alternate" ? "Alt angle" : "Broadcast"}</span>`;
  const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  /* ================================================================ data */
  async function boot() {
    let idx;
    try { idx = await (await fetch("data/index.json", { cache: "no-cache" })).json(); }
    catch (e) { $("#app").innerHTML = `<div class="page"><div class="empty">The play index couldn't be loaded. Reload to try again.</div></div>`; return; }
    S.flags = idx.flags;
    S.plays = idx.plays.concat(U.imported.map((x) => x.index));
    S.plays.forEach((p) => S.byId.set(p.id, p));
    S.generated = idx.generated;
    renderFilters();
    window.addEventListener("hashchange", route);
    route();
  }
  async function detail(id) {
    if (S.details.has(id)) return S.details.get(id);
    const imp = U.imported.find((x) => x.index.id === id);
    let d = imp ? imp.detail : null;
    if (!d) d = await (await fetch(`data/plays/${encodeURIComponent(id)}.json`)).json();
    S.details.set(id, d); return d;
  }

  /* ================================================================ router */
  function route() {
    const h = location.hash || "#/explore";
    const [path, query] = h.slice(2).split("?");
    const parts = path.split("/");
    const views = { explore: "#vExplore", play: "#vPlay", collections: "#vCollections", saved: "#vSaved", import: "#vImport" };
    if (parts[0] !== "present") closePresent(true);
    $$(".view").forEach((v) => (v.hidden = true));
    $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (parts[0] === "play" ? "explore" : parts[0])));
    if (parts[0] === "play") { $(views.play).hidden = false; renderPlay(decodeURIComponent(parts[1] || "")); }
    else if (parts[0] === "collections") { $(views.collections).hidden = false; renderCollections(parts[1] ? decodeURIComponent(parts[1]) : null); }
    else if (parts[0] === "saved") { $(views.saved).hidden = false; renderSaved(); }
    else if (parts[0] === "import") { $(views.import).hidden = false; renderImport(); }
    else if (parts[0] === "present") { openPresent(decodeURIComponent(parts[1] || ""), +(parts[2] || 0)); $$(".view").forEach((v) => (v.hidden = true)); $("#vExplore").hidden = false; }
    else {
      $(views.explore).hidden = false;
      const q = new URLSearchParams(query || "");
      S.f = PR.decodeFilters(q.get("f") || "");
      S.sort = q.get("sort") || S.sort;
      S.lastExplore = h;
      renderFilters(); renderResults();
      const y = +(sessionStorage.getItem("pr.scroll") || 0);
      if (y) requestAnimationFrame(() => { window.scrollTo(0, y); sessionStorage.removeItem("pr.scroll"); });
    }
    if (parts[0] !== "explore" && parts[0] !== "") stopPlayer(parts[0] === "play");
  }
  function pushFilters() {
    const enc = PR.encodeFilters(S.f);
    const h = "#/explore" + (enc || S.sort !== "category" ? "?" + [enc ? "f=" + enc : "", S.sort !== "category" ? "sort=" + S.sort : ""].filter(Boolean).join("&") : "");
    if (location.hash !== h) history.replaceState(null, "", h);
    S.lastExplore = h;
    renderFilters(); renderResults();
  }

  /* ================================================================ filters panel
     One renderer for the desktop sidebar and the mobile sheet. Five collapsible sections; which ones are open is
     remembered separately for desktop and mobile. */
  const MQ = window.matchMedia("(max-width: 900px)");
  const isMobile = () => MQ.matches;
  const UI_KEY = "playRepository.ui";
  const UI = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) || "{}") || {}; } catch (e) { return {}; } })();
  UI.open = UI.open || { desktop: ["sit", "play"], mobile: ["sit"] };
  UI.sub = UI.sub || ["offense"];
  const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(UI)); } catch (e) { /* private mode */ } };
  const openList = () => UI.open[isMobile() ? "mobile" : "desktop"];
  const SECTIONS = [["sit", "Game situation"], ["inn", "Inning & score"], ["play", "Play type"], ["who", "Players & teams"], ["adv", "Advanced"]];
  const PLAY_GROUPS = [["offense", "Hitting & results", ["offense"]], ["baserunning", "Baserunning", ["baserunning"]], ["defense", "Defense", ["defense"]], ["catching", "Catching & pitching", ["catcher", "pitching"]]];
  const QUICK = ["risp", "dp", "loaded", "third", "twoouts", "onerun"];
  const MORE = ["empty", "anyon", "firstsecond", "corners", "force", "nooutsrisp", "tying", "goahead", "walkoff", "highlev"];

  function chip(label, on, attrs, count, disabled) {
    return `<button type="button" class="chip${on ? " on" : ""}" ${attrs}${disabled ? " disabled" : ""} aria-pressed="${on}">${esc(label)}${count != null ? ` <span class="n">${count}</span>` : ""}</button>`;
  }
  const seg = (items, cls = "") => `<div class="seg ${cls}" role="group">${items.map(([lab, attrs, on]) => `<button type="button" ${attrs} class="${on ? "on" : ""}" aria-pressed="${!!on}">${lab}</button>`).join("")}</div>`;
  function conflictHTML() {
    const cs = PR.conflicts(S.f, S.flags);
    if (!cs.length) return "";
    const c = cs[0];
    return `<div class="conflict" role="alert"><b>These can't happen together:</b> ${esc(c.a.label)} + ${esc(c.b.label)}.
      <div class="conflict-a"><button type="button" class="btn sm" data-fix="${esc(c.b.id)}">Keep “${esc(c.a.label)}”</button><button type="button" class="btn sm" data-fix="${esc(c.a.id)}">Keep “${esc(c.b.label)}”</button></div></div>`;
  }
  function removeConstraint(id) {
    const f = S.f;
    if (id === "bases") f.bases = { mode: "any", sel: [] };
    else if (id === "outs") f.outs = [];
    else if (id === "runners") f.runners = [];
    else if (id.startsWith("flag:")) { const i = f.flags.indexOf(id.slice(5)); if (i >= 0) f.flags.splice(i, 1); }
  }
  function renderFilters() {
    const f = S.f, fc = PR.facets(S.plays), host = $("#filters");
    const scroller = $(".fscroll", host), keep = scroller ? scroller.scrollTop : 0;
    const open = new Set(openList());
    const counts = {}; activeChips().forEach((c) => (counts[c.sec] = (counts[c.sec] || 0) + 1));
    const nActive = activeChips().length, nNow = PR.filter(S.plays, f, userView(), S.flags).length;
    const sel = f.bases.sel || [];
    const sum = PR.situationSummary(f);
    const baseG = (i, x, y) => `<g class="base${sel.includes(i) ? " on" : ""}" data-base="${i}" tabindex="0" role="checkbox" aria-checked="${sel.includes(i)}" aria-label="${["", "First", "Second", "Third"][i]} base"><rect x="${x - 15}" y="${y - 15}" width="30" height="30" transform="rotate(45 ${x} ${y})"/><rect class="hit" x="${x - 26}" y="${y - 26}" width="52" height="52" fill="transparent" stroke="none"/></g>`;
    const flagChip = (id, label) => chip(label || (S.flags[id] || {}).label || id, f.flags.includes(id), `data-flag="${id}" title="${esc((S.flags[id] || {}).rule || "")}"`, fc.flags[id] || 0, !fc.flags[id] && !f.flags.includes(id));
    const groupChips = (groups) => Object.entries(S.flags).filter(([id, d]) => groups.includes(d.group) && (fc.flags[id] || f.flags.includes(id))).map(([id]) => flagChip(id)).join("");
    const preset = (k) => { const P = PR.PRESETS[k]; return chip(P.label, P.on(f), `data-preset="${k}"`); };
    const opts = (obj, cur, fmt = (x) => x) => Object.keys(obj).sort().map((k) => `<option value="${esc(k)}"${String(cur) === k ? " selected" : ""}>${esc(fmt(k))} (${obj[k]})</option>`).join("");
    const people = [...new Set(S.plays.map((p) => p.batter.name))].sort();
    const pitchers = [...new Set(S.plays.map((p) => p.pitcher.name))].sort();
    const section = (id, title, body) => `<details class="fsec" data-s="${id}"${open.has(id) ? " open" : ""}><summary><span>${title}</span>${counts[id] ? `<span class="fbadge">${counts[id]}</span>` : ""}</summary><div class="fin">${body}</div></details>`;
    const lev = f.flags.includes("high_leverage") ? "high" : f.flags.includes("low_leverage") ? "low" : "";
    const secs = {
      sit: `
        <div class="gs">
          <svg class="dia-ctl" viewBox="-4 -6 158 140" aria-label="Runners on base — tap bases">
            <path d="M75 120 L130 66 L75 12 L20 66 Z" fill="none" stroke="#A28B77" stroke-width="1.5"/>
            ${baseG(1, 130, 66)}${baseG(2, 75, 18)}${baseG(3, 20, 66)}
            <path d="M68 112 h14 v7 l-7 7 l-7 -7 z" fill="#252525" opacity=".75"/>
          </svg>
          <div class="gs-r">
            <span class="k">Runners</span>${seg([["Any", 'data-bmode="any"', f.bases.mode === "any"], ["Exactly", 'data-bmode="exact" title="Exactly the bases you tap (none = bases empty)"', f.bases.mode === "exact"], ["At least", 'data-bmode="includes" title="At least the bases you tap"', f.bases.mode === "includes"]], "seg3")}
            <span class="k">Outs</span>${seg([["Any", 'data-outs="any"', !f.outs.length], ["0", 'data-outs="0"', f.outs.includes(0)], ["1", 'data-outs="1"', f.outs.includes(1)], ["2", 'data-outs="2"', f.outs.includes(2)]], "seg4")}
          </div>
        </div>
        <div class="gs-sum" aria-live="polite"><span><b>Runners on:</b> ${esc(sum.runners)}</span><span><b>Outs:</b> ${esc(sum.outs)}</span></div>
        ${conflictHTML()}
        <span class="k">Quick situations</span>
        <div class="cgrid c2">${QUICK.map(preset).join("")}</div>
        <details class="more" data-more="1"${UI.more ? " open" : ""}><summary>More situations</summary><div class="cgrid c2">${MORE.map(preset).join("")}</div></details>
        <span class="k">Number of runners</span>${seg([["Any", 'data-rn="any"', !f.runners.length], ["0", 'data-rn="0"', f.runners.includes(0)], ["1", 'data-rn="1"', f.runners.includes(1)], ["2", 'data-rn="2"', f.runners.includes(2)], ["3", 'data-rn="3"', f.runners.includes(3)]], "seg5")}`,
      inn: `
        <span class="k">Innings</span>
        <div class="cgrid c4">${[["early", "1–3"], ["middle", "4–6"], ["late", "7–9"], ["extra", "Extra"]].map(([k, l]) => chip(l, f.phases.includes(k), `data-phase="${k}" title="${k} innings"`)).join("")}</div>
        <div class="frow"><input type="number" inputmode="numeric" min="1" max="20" placeholder="From" data-num="innMin" value="${f.innMin ?? ""}" aria-label="Inning from"><input type="number" inputmode="numeric" min="1" max="20" placeholder="To" data-num="innMax" value="${f.innMax ?? ""}" aria-label="Inning to">
          ${seg([["Both", 'data-half=""', !f.half], ["Top", 'data-half="top"', f.half === "top"], ["Bot", 'data-half="bottom"', f.half === "bottom"]])}</div>
        <span class="k">Batting team is</span>
        ${seg([["Any", 'data-ss="any"', !f.scoreState.length], ["Tied", 'data-ss="tied"', f.scoreState.includes("tied")], ["Leading", 'data-ss="leading"', f.scoreState.includes("leading")], ["Trailing", 'data-ss="trailing"', f.scoreState.includes("trailing")]], "seg4")}
        ${seg([["Home or away", 'data-bside=""', !f.batSide], ["Home", 'data-bside="home"', f.batSide === "home"], ["Away", 'data-bside="away"', f.batSide === "away"]], "seg3 mt")}
        <span class="k">Score margin</span>
        <div class="cgrid c3">${flagChip("one_run", "One-run")}${flagChip("close", "Within 2")}${flagChip("blowout", "5+ runs")}</div>
        <span class="k">Stakes</span>
        <div class="cgrid c2">${["tying_run_on", "go_ahead_on", "walkoff_situation", "winning_run_on", "postseason", "challenge"].map((x) => flagChip(x)).join("")}</div>
        <span class="k">Leverage</span>
        ${seg([["Any", 'data-lev=""', !lev], ["High (LI ≥ 2)", 'data-lev="high"', lev === "high"], ["Low (< 0.85)", 'data-lev="low"', lev === "low"]], "seg3")}
        <div class="frow">LI <input type="number" step="0.1" min="0" placeholder="min" data-num="liMin" value="${f.liMin ?? ""}" aria-label="Leverage index minimum"><input type="number" step="0.1" min="0" placeholder="max" data-num="liMax" value="${f.liMax ?? ""}" aria-label="Leverage index maximum"></div>
        <p class="fnote">Every game-state filter uses the state <b>before</b> the play. Leverage and win probability are MLB's own.</p>`,
      play: `
        ${PLAY_GROUPS.map(([id, label, groups]) => { const n = f.flags.filter((x) => groups.includes((S.flags[x] || {}).group)).length;
          return `<details class="sub" data-sub="${id}"${UI.sub.includes(id) ? " open" : ""}><summary>${label}${n ? ` <span class="fbadge">${n}</span>` : ""}<span class="any">any of</span></summary><div class="cgrid c2">${groupChips(groups)}</div></details>`; }).join("")}
        <span class="k">Official result</span><select class="fsel wide" data-sel="event"><option value="">Any result</option>${opts(fc.events, f.events[0] || "", (k) => k.replace(/_/g, " "))}</select>
        <p class="fnote">Computed from MLB's official play-by-play — hover or long-press a chip for its rule. Communication, "infield in" and other judgements aren't in MLB's data: tag plays yourself (Advanced → your tags).</p>`,
      who: `
        <span class="k">Team</span><div class="frow"><select class="fsel" data-sel="team"><option value="">Any team</option>${opts(fc.teams, f.team)}</select>
          ${seg([["Either", 'data-trole="any"', (f.teamRole || "any") === "any"], ["Batting", 'data-trole="batting"', f.teamRole === "batting"], ["Fielding", 'data-trole="fielding"', f.teamRole === "fielding"]])}</div>
        <span class="k">Batter · pitcher</span><div class="frow two"><input list="dlBatters" placeholder="Batter" data-txt="batter" value="${esc(f.batter)}" aria-label="Batter"><input list="dlPitchers" placeholder="Pitcher" data-txt="pitcher" value="${esc(f.pitcher)}" aria-label="Pitcher"></div>
        <datalist id="dlBatters">${people.map((n) => `<option value="${esc(n)}">`).join("")}</datalist><datalist id="dlPitchers">${pitchers.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        <span class="k">Handedness</span><div class="cgrid c4">${chip("LHB", f.batHand === "L", 'data-bh="L"')}${chip("RHB", f.batHand === "R", 'data-bh="R"')}${chip("LHP", f.pitHand === "L", 'data-ph="L"')}${chip("RHP", f.pitHand === "R", 'data-ph="R"')}</div>
        <span class="k">Fielder involved (official credits)</span><div class="cgrid c5">${["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"].map((x) => chip(x, f.positions.includes(x), `data-pos="${x}"`, null, !fc.positions[x])).join("")}</div>`,
      adv: `
        <span class="k">Teaching</span>
        <select class="fsel wide" data-sel="category"><option value="">Any curated category</option>${opts(fc.categories, f.categories[0] || "")}</select>
        <div class="cgrid c2 mt">${allTags().map((t) => chip(t, f.tags.includes(t), `data-tag="${esc(t)}" title="Your coaching tag"`)).join("")}${chip("★ Saved only", f.savedOnly, 'data-saved="1"')}</div>
        ${allTags().length ? "" : '<p class="fnote">Your coaching tags appear here once you add some to plays.</p>'}
        <span class="k">Fielded in</span><div class="cgrid c3">${[7, 8, 9, 5, 6, 4, 3, 1, 2].map((n) => chip(PR.LOC_NAME[n], f.locations.includes(n), `data-loc="${n}"`)).join("")}</div>
        <span class="k">Spray</span>${seg([["Any", 'data-spray="any"', !f.spray.length], ["Pull", 'data-spray="pull"', f.spray.includes("pull")], ["Center", 'data-spray="center"', f.spray.includes("center")], ["Oppo", 'data-spray="opposite"', f.spray.includes("opposite")]], "seg4")}
        <span class="k">Exit velocity · launch angle · distance</span>
        <div class="frow">EV <input type="number" inputmode="decimal" placeholder="min" data-num="evMin" value="${f.evMin ?? ""}" aria-label="Exit velocity minimum"><input type="number" inputmode="decimal" placeholder="max" data-num="evMax" value="${f.evMax ?? ""}" aria-label="Exit velocity maximum"></div>
        <div class="frow">LA <input type="number" inputmode="decimal" placeholder="min" data-num="laMin" value="${f.laMin ?? ""}" aria-label="Launch angle minimum"><input type="number" inputmode="decimal" placeholder="max" data-num="laMax" value="${f.laMax ?? ""}" aria-label="Launch angle maximum"></div>
        <div class="frow">Distance ≥ <input type="number" inputmode="numeric" placeholder="ft" data-num="distMin" value="${f.distMin ?? ""}" aria-label="Distance minimum"></div>
        <span class="k">Pitch</span><div class="frow"><select class="fsel" data-sel="pitchType"><option value="">Any pitch type</option>${opts(fc.pitchTypes, f.pitchTypes[0] || "")}</select>
          <input type="number" inputmode="decimal" placeholder="mph ≥" data-num="veloMin" value="${f.veloMin ?? ""}" aria-label="Velocity minimum"></div>
        <div class="frow">Count <select class="fsel" data-cnt="balls" aria-label="Balls"><option value="">Balls</option>${[0, 1, 2, 3].map((n) => `<option ${f.balls === n ? "selected" : ""}>${n}</option>`).join("")}</select><select class="fsel" data-cnt="strikes" aria-label="Strikes"><option value="">Strikes</option>${[0, 1, 2].map((n) => `<option ${f.strikes === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <span class="k">Statcast alignment</span><div class="frow two"><select class="fsel" data-sel="ifAlign"><option value="">Infield: any</option>${opts(fc.ifAlign, f.ifAlign[0] || "")}</select><select class="fsel" data-sel="ofAlign"><option value="">Outfield: any</option>${opts(fc.ofAlign, f.ofAlign[0] || "")}</select></div>
        <span class="k">Result of the play</span>${seg([["Any", 'data-oop="any"', !f.outsOnPlay.length], ["0 outs", 'data-oop="0"', f.outsOnPlay.includes(0)], ["1", 'data-oop="1"', f.outsOnPlay.includes(1)], ["2+", 'data-oop="2"', f.outsOnPlay.includes(2)]], "seg4")}
        <div class="cgrid c2 mt">${chip("Run(s) scored", f.runsMin === 1, 'data-runs="1"')}</div>
        <div class="frow">ΔRE <input type="number" step="0.05" placeholder="min" data-num="dreMin" value="${f.dreMin ?? ""}" aria-label="Run expectancy change minimum"><input type="number" step="0.05" placeholder="max" data-num="dreMax" value="${f.dreMax ?? ""}" aria-label="Run expectancy change maximum"></div>
        <div class="frow">ΔWP pts <input type="number" step="1" placeholder="min" data-num="wpaMin" value="${f.wpaMin ?? ""}" aria-label="Win probability change minimum"><input type="number" step="1" placeholder="max" data-num="wpaMax" value="${f.wpaMax ?? ""}" aria-label="Win probability change maximum"></div>
        <span class="k">Season · dates · level</span>
        <div class="cgrid c3">${Object.keys(fc.seasons).sort().map((y) => chip(y, f.seasons.includes(+y), `data-season="${y}"`, fc.seasons[y])).join("")}${chip("Regular", f.gameTypes.includes("regular"), 'data-gt="regular"')}${chip("Postseason", f.gameTypes.includes("post"), 'data-gt="post"')}</div>
        <div class="frow two"><input type="date" data-txt="dateFrom" value="${esc(f.dateFrom)}" aria-label="From date"><input type="date" data-txt="dateTo" value="${esc(f.dateTo)}" aria-label="To date"></div>
        <p class="fnote">Level: MLB. MiLB isn't included — MLB Film Room clips and these Statcast fields are MLB-only.</p>`,
    };
    host.innerHTML = `
      <div class="fhead"><button type="button" class="fback" data-done="1" aria-label="Close filters">‹ Back</button><b>Filters</b><span class="fcount">${nActive ? nActive + " active" : "None active"}</span></div>
      <div class="fscroll">${SECTIONS.map(([id, t]) => section(id, t, secs[id])).join("")}</div>
      <div class="ffoot"><button class="btn" type="button" data-clear="all"${nActive ? "" : " disabled"}>Clear all</button><button class="btn primary" type="button" data-done="1">Show ${nNow} play${nNow === 1 ? "" : "s"}</button></div>`;
    const sc2 = $(".fscroll", host); if (sc2) sc2.scrollTop = keep;
    host.dataset.init = "1";
  }
  const code = (sel) => (sel.includes(1) ? "1" : "_") + (sel.includes(2) ? "2" : "_") + (sel.includes(3) ? "3" : "_");
  const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
  const anyOr = (arr, v, parse = (x) => x) => { if (v === "any") arr.splice(0); else toggleIn(arr, parse(v)); };
  function filterClick(e) {
    const t = e.target.closest("button, g.base"); if (!t || t.disabled) return;
    const f = S.f, d = t.dataset;
    if (d.base) { const b = +d.base; toggleIn(f.bases.sel, b); f.bases.sel.sort(); if (f.bases.mode === "any") f.bases.mode = "exact"; if (f.runners.length && f.bases.mode === "exact" && !f.runners.includes(f.bases.sel.length)) f.runners = []; }
    else if (d.bmode) { f.bases.mode = d.bmode; if (d.bmode === "any") f.bases.sel = []; }
    else if (d.outs) { anyOr(f.outs, d.outs, Number); f.outs.sort(); }
    else if (d.preset) { const P = PR.PRESETS[d.preset]; P.apply(f, P.on(f)); }
    else if (d.fix) removeConstraint(d.fix);
    else if (d.flag) toggleIn(f.flags, d.flag);
    else if (d.rn) { anyOr(f.runners, d.rn, Number); f.runners.sort(); }
    else if (d.phase) toggleIn(f.phases, d.phase);
    else if (d.half !== undefined) f.half = d.half || null;
    else if (d.bside !== undefined) f.batSide = d.bside || null;
    else if (d.ss) anyOr(f.scoreState, d.ss);
    else if (d.lev !== undefined) { ["high_leverage", "low_leverage"].forEach((x) => { const i = f.flags.indexOf(x); if (i >= 0) f.flags.splice(i, 1); }); if (d.lev) f.flags.push(d.lev + "_leverage"); }
    else if (d.trole) f.teamRole = d.trole;
    else if (d.bh) f.batHand = f.batHand === d.bh ? null : d.bh;
    else if (d.ph) f.pitHand = f.pitHand === d.ph ? null : d.ph;
    else if (d.pos) toggleIn(f.positions, d.pos);
    else if (d.loc) toggleIn(f.locations, +d.loc);
    else if (d.spray) anyOr(f.spray, d.spray);
    else if (d.oop) anyOr(f.outsOnPlay, d.oop, Number);
    else if (d.runs) f.runsMin = f.runsMin ? null : 1;
    else if (d.season) toggleIn(f.seasons, +d.season);
    else if (d.gt) toggleIn(f.gameTypes, d.gt);
    else if (d.tag) toggleIn(f.tags, d.tag);
    else if (d.saved) f.savedOnly = !f.savedOnly;
    else if (d.done) { closeSheet(true); return; }
    else if (d.clear === "all") { S.f = PR.emptyFilters(); S.understood = null; $("#ask").value = ""; }
    else return;
    pushFilters();
  }
  $("#filters").addEventListener("click", filterClick);
  $("#filters").addEventListener("keydown", (e) => { const g = e.target.closest("g.base"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); setTimeout(() => { const n = $(`g.base[data-base="${g.dataset.base}"]`); n && n.focus(); }); } });
  // remember which sections are open (toggle doesn't bubble — listen in the capture phase)
  $("#filters").addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.dataset.s) { const L = openList(), i = L.indexOf(d.dataset.s); if (d.open && i < 0) L.push(d.dataset.s); if (!d.open && i >= 0) L.splice(i, 1); }
    else if (d.dataset.sub) { const i = UI.sub.indexOf(d.dataset.sub); if (d.open && i < 0) UI.sub.push(d.dataset.sub); if (!d.open && i >= 0) UI.sub.splice(i, 1); }
    else if (d.dataset.more) UI.more = d.open;
    saveUI();
  }, true);
  $("#filters").addEventListener("change", (e) => {
    const t = e.target, f = S.f, d = t.dataset;
    if (d.num) f[d.num] = t.value === "" ? null : +t.value;
    else if (d.txt) f[d.txt] = t.value.trim();
    else if (d.sel === "event") f.events = t.value ? [t.value] : [];
    else if (d.sel === "team") f.team = t.value;
    else if (d.sel === "category") f.categories = t.value ? [t.value] : [];
    else if (d.sel === "pitchType") f.pitchTypes = t.value ? [t.value] : [];
    else if (d.sel === "ifAlign") f.ifAlign = t.value ? [t.value] : [];
    else if (d.sel === "ofAlign") f.ofAlign = t.value ? [t.value] : [];
    else if (d.cnt) f[d.cnt] = t.value === "" ? null : +t.value;
    else return;
    pushFilters();
  });
  /* the mobile sheet */
  function openSheet() { $("#filters").classList.add("open"); document.body.classList.add("sheet-open"); renderFilters(); const b = $(".fback"); b && b.focus({ preventScroll: true }); }
  function closeSheet(toResults) {
    const was = $("#filters").classList.contains("open");
    $("#filters").classList.remove("open"); document.body.classList.remove("sheet-open");
    if (was && toResults && isMobile()) { const y = $(".results").getBoundingClientRect().top + window.scrollY - 58; window.scrollTo({ top: Math.max(0, y), behavior: "instant" }); }
  }
  $("#mOuts").addEventListener("click", (e) => { const b = e.target.closest("[data-mouts]"); if (!b) return; anyOr(S.f.outs, b.dataset.mouts, Number); S.f.outs.sort(); pushFilters(); });
  $("#btnFilters").onclick = () => ($("#filters").classList.contains("open") ? closeSheet(true) : openSheet());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#filters").classList.contains("open")) closeSheet(true); });
  MQ.addEventListener("change", () => { closeSheet(false); renderFilters(); });

  /* ================================================================ results */
  function activeChips(f = S.f) {
    const out = [];
    let sec = "sit";
    const add = (label, fn) => out.push({ label, fn, sec });
    const flagSec = (x) => { const g = (S.flags[x] || {}).group; return g === "situation" ? "sit" : g === "context" ? "inn" : "play"; };
    if (f.bases.mode !== "any") add(f.bases.mode === "exact" ? PR.basesLabel(code(f.bases.sel)) : "Includes " + f.bases.sel.map((b) => PR.ORD(b)).join(" & "), () => (f.bases = { mode: "any", sel: [] }));
    if (f.outs.length) add(f.outs.map((o) => PR.outsLabel(o)).join(" or "), () => (f.outs = []));
    if (f.runners.length) add(f.runners.join() === "1,2,3" ? "Any runner on" : f.runners.join("/") + " runners", () => (f.runners = []));
    f.flags.forEach((x) => { sec = flagSec(x); add((S.flags[x] || {}).label || x, () => f.flags.splice(f.flags.indexOf(x), 1)); });
    sec = "inn";
    f.phases.forEach((x) => add(x + " innings", () => f.phases.splice(f.phases.indexOf(x), 1)));
    if (f.innMin != null || f.innMax != null) add(`Inning ${f.innMin ?? 1}–${f.innMax ?? "…"}`, () => (f.innMin = f.innMax = null));
    if (f.half) add(f.half === "top" ? "Top half" : "Bottom half", () => (f.half = null));
    if (f.batSide) add(`${f.batSide} team batting`, () => (f.batSide = null));
    f.scoreState.forEach((x) => add("Batting team " + x, () => f.scoreState.splice(f.scoreState.indexOf(x), 1)));
    [["liMin", "LI ≥ "], ["liMax", "LI ≤ "]].forEach(([k, l]) => f[k] != null && add(l + f[k], () => (f[k] = null)));
    sec = "play";
    f.events.forEach((x) => add(x.replace(/_/g, " "), () => (f.events = [])));
    f.categories.forEach((x) => add(x, () => f.categories.splice(f.categories.indexOf(x), 1)));
    f.positions.forEach((x) => add("Fielder " + x, () => f.positions.splice(f.positions.indexOf(x), 1)));
    f.locations.forEach((x) => add("To " + PR.LOC_NAME[x], () => f.locations.splice(f.locations.indexOf(x), 1)));
    f.spray.forEach((x) => add(x + " field", () => f.spray.splice(f.spray.indexOf(x), 1)));
    f.outsOnPlay.forEach((x) => add(x + " out(s) on play", () => f.outsOnPlay.splice(f.outsOnPlay.indexOf(x), 1)));
    if (f.runsMin) add("Run(s) scored", () => (f.runsMin = null));
    sec = "who";
    if (f.team) add(`${f.team}${f.teamRole !== "any" ? " " + f.teamRole : ""}`, () => (f.team = ""));
    if (f.batter) add("Batter: " + f.batter, () => (f.batter = ""));
    if (f.pitcher) add("Pitcher: " + f.pitcher, () => (f.pitcher = ""));
    if (f.batHand) add(f.batHand + "HB", () => (f.batHand = null));
    if (f.pitHand) add(f.pitHand + "HP", () => (f.pitHand = null));
    sec = "adv";
    f.pitchTypes.forEach((x) => add(x, () => (f.pitchTypes = [])));
    [["evMin", "EV ≥ "], ["evMax", "EV ≤ "], ["laMin", "LA ≥ "], ["laMax", "LA ≤ "], ["distMin", "Distance ≥ "], ["veloMin", "Pitch ≥ "], ["veloMax", "Pitch ≤ "], ["dreMin", "ΔRE ≥ "], ["dreMax", "ΔRE ≤ "], ["wpaMin", "ΔWP ≥ "], ["wpaMax", "ΔWP ≤ "]]
      .forEach(([k, l]) => f[k] != null && add(l + f[k], () => (f[k] = null)));
    if (f.balls != null || f.strikes != null) add(`Count ${f.balls ?? "?"}-${f.strikes ?? "?"}`, () => (f.balls = f.strikes = null));
    f.seasons.forEach((x) => add(String(x), () => f.seasons.splice(f.seasons.indexOf(x), 1)));
    f.gameTypes.forEach((x) => add(x === "post" ? "Postseason" : "Regular season", () => f.gameTypes.splice(f.gameTypes.indexOf(x), 1)));
    if (f.dateFrom || f.dateTo) add(`${f.dateFrom || "…"} → ${f.dateTo || "…"}`, () => (f.dateFrom = f.dateTo = ""));
    f.ifAlign.forEach((x) => add("IF: " + x, () => (f.ifAlign = []))); f.ofAlign.forEach((x) => add("OF: " + x, () => (f.ofAlign = [])));
    f.tags.forEach((x) => add("Tag: " + x, () => f.tags.splice(f.tags.indexOf(x), 1)));
    if (f.savedOnly) add("★ Saved", () => (f.savedOnly = false));
    return out;
  }
  function sortPlays(list) {
    const s = S.sort;
    const k = { date: (a, b) => b.date.localeCompare(a.date), leverage: (a, b) => (b.li || 0) - (a.li || 0), inning: (a, b) => a.inning - b.inning || (a.half === "top" ? -1 : 1),
      category: (a, b) => a.category.localeCompare(b.category) || b.date.localeCompare(a.date) }[s];
    return list.slice().sort(k);
  }
  function card(p, extra = "") {
    const tags = (U.tags[p.id] || []).slice(0, 2);
    const teach = p.flags.filter((x) => S.flags[x] && ["baserunning", "defense", "catcher", "offense", "pitching"].includes(S.flags[x].group)).slice(0, 3);
    const sv = isSaved(p.id);
    return `<article class="card" data-open="${esc(p.id)}" tabindex="0" role="link" aria-label="${esc(p.title)}">
      <div class="thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<div class="alt" ${p.thumb ? "style=\"z-index:-1\"" : ""}>${diamond(p.bases, { size: 70, outs: p.outs, dark: true })}</div>
        ${angleChip(p.angles[0])}
        <div class="bug">${diamond(p.bases, { size: 22, dark: true })}<span>${esc(PR.halfLabel(p))} · ${esc(PR.outsLabel(p.outs))}</span><span class="sp"></span><span>${esc(teamLine(p))}</span></div></div>
      <div class="cbody"><div class="cmeta"><span>${esc(fmtDate(p.date))}</span><span>${esc(p.away)} @ ${esc(p.home)}</span></div>
        <div class="ctitle">${esc(p.title)}</div>
        <div class="csit"><span class="cdia">${diamond(p.bases, { size: 18 })}</span>${esc(PR.basesLabel(p.bases))}, ${esc(PR.outsLabel(p.outs).toLowerCase())} · ${esc(p.eventLabel)}</div>
        ${extra}
        <div class="ctags"><span class="tag" style="border-color:var(--oxblood);color:var(--oxblood)" title="Teaching slot this play was curated for">${esc(p.slot)}</span>${teach.slice(0, 2).map((x) => `<span class="tag" title="${esc(S.flags[x].rule)}">${esc(S.flags[x].label)}</span>`).join("")}${tags.map((t) => `<span class="tag coach" title="Your coaching tag">${esc(t)}</span>`).join("")}</div></div>
      <button class="csave${sv ? " on" : ""}" type="button" data-save="${esc(p.id)}" aria-pressed="${sv}" aria-label="${sv ? "Remove from saved" : "Save play"}" title="${sv ? "Saved" : "Save"}">${sv ? "★" : "☆"}</button></article>`;
  }
  function renderResults() {
    const list = sortPlays(PR.filter(S.plays, S.f, userView(), S.flags));
    $("#count").innerHTML = `${list.length} play${list.length === 1 ? "" : "s"}<small>of ${S.plays.length}</small>`;
    $("#sort").value = S.sort;
    const chips = activeChips();
    $("#btnFilters").innerHTML = `${diamond(S.f.bases.mode === "any" ? "___" : code(S.f.bases.sel), { size: 24 })}Filters${chips.length ? ` <span class="fbadge">${chips.length}</span>` : ""}`;
    $("#btnFilters").setAttribute("aria-label", `Filters, ${chips.length} active`);
    $("#mOuts").innerHTML = `<span class="k">Outs</span>` + seg([["Any", 'data-mouts="any"', !S.f.outs.length], ["0", 'data-mouts="0"', S.f.outs.includes(0)], ["1", 'data-mouts="1"', S.f.outs.includes(1)], ["2", 'data-mouts="2"', S.f.outs.includes(2)]]);
    $("#activeBar").innerHTML = chips.map((c, i) => `<span class="af">${esc(c.label)}<button data-rm="${i}" aria-label="Remove ${esc(c.label)}">×</button></span>`).join("") +
      (chips.length ? `<button class="btn sm ghost" data-rm="all">Clear all</button>` : "");
    $$("#activeBar [data-rm]").forEach((b) => (b.onclick = () => { if (b.dataset.rm === "all") { S.f = PR.emptyFilters(); S.understood = null; } else chips[+b.dataset.rm].fn(); pushFilters(); }));
    $("#grid").innerHTML = list.length ? list.map((p) => card(p)).join("") : emptyState(chips);
    const u = S.understood;
    $("#understood").hidden = !u;
    if (u) $("#understood").innerHTML = `<span class="k">Understood as</span>${u.understood.map((x) => `<span class="u">${esc(x)}</span>`).join("") || "<span>nothing specific</span>"}` +
      (u.unsupported.length ? `<span class="x" title="MLB's public data doesn't record this">Not in MLB's data — tag plays yourself: ${esc(u.unsupported.join(", "))}</span>` : "") +
      (u.unknown.length ? `<span class="x">Didn't use: ${esc(u.unknown.slice(0, 6).join(", "))}</span>` : "");
  }
  /** nothing matches: show what each single relaxation would return, so the nearest real examples are one click away */
  function emptyState(chips) {
    const opts = chips.map((c, i) => {
      const g = JSON.parse(JSON.stringify(S.f));
      activeChips(g)[i].fn();
      return { i, label: c.label, n: PR.filter(S.plays, g, userView(), S.flags).length, g };
    }).filter((o) => o.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
    S.relax = opts;
    return `<div class="empty" style="grid-column:1/-1">No play in the repository matches all of these yet.${opts.length ? `<br><br><b>Nearest matches</b> — drop one condition:<div class="chips" style="justify-content:center;margin-top:8px">${opts.map((o) => `<button class="chip" data-relax="${o.i}">without “${esc(o.label)}” · ${o.n}</button>`).join("")}</div>` : "<br>Remove a filter above, or import more plays."}</div>`;
  }
  $("#grid").addEventListener("click", (e) => {
    const r = e.target.closest("[data-relax]");
    if (r) { const o = (S.relax || []).find((x) => x.i === +r.dataset.relax); if (o) { S.f = o.g; pushFilters(); } return; }
    const sv = e.target.closest("[data-save]");
    if (sv) { e.stopPropagation(); toggleSaved(sv.dataset.save); renderResults(); return; }
    const c = e.target.closest("[data-open]"); if (c) openPlay(c.dataset.open);
  });
  $("#grid").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("article[data-open]")) { e.preventDefault(); openPlay(e.target.dataset.open); }
  });
  $("#sort").onchange = (e) => { S.sort = e.target.value; pushFilters(); };
  function openPlay(id) { sessionStorage.setItem("pr.scroll", String(window.scrollY)); location.hash = "#/play/" + encodeURIComponent(id); }
  $("#askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#ask").value.trim(); if (!text) return;
    const teams = {}; S.plays.forEach(() => {});
    const res = PR.parseQuery(text, nlContext(), $("#askRefine").checked ? S.f : null);
    S.f = res.filters; S.understood = res; pushFilters();
  });
  function nlContext() {
    const teams = {};
    S.plays.forEach((p) => { teams[p.away] = teams[p.away] || []; teams[p.home] = teams[p.home] || []; });
    (S.teamNames || []).forEach(([abbr, names]) => { if (teams[abbr]) teams[abbr] = names; });
    const people = [];
    const seen = new Set();
    S.plays.forEach((p) => { [[p.batter, "batter"], [p.pitcher, "pitcher"]].forEach(([x, role]) => { if (!seen.has(x.name)) { seen.add(x.name); people.push({ name: x.name, id: x.id, role }); } }); });
    return { teams, people, tags: allTags(), flagDefs: S.flags };
  }

  /* ================================================================ play detail */
  let cur = null;     // {p, d, clip, loop:{a,b,on}}
  async function renderPlay(id) {
    const p = S.byId.get(id), host = $("#vPlay");
    if (!p) { host.innerHTML = `<div class="empty">That play isn't in the repository. <a href="#/explore">Back to Explore</a></div>`; return; }
    host.innerHTML = `<div class="empty">Loading…</div>`;
    let d;
    try { d = await detail(id); } catch (e) { host.innerHTML = `<div class="empty">The play's details couldn't be loaded. <a href="#/explore">Back</a></div>`; return; }
    if (location.hash.indexOf(encodeURIComponent(id)) < 0 && location.hash.indexOf(id) < 0) return;
    cur = { p, d, clip: 0, loop: { a: null, b: null, on: false } };
    const notes = U.notes[id] || {};
    const colsWith = collections().filter((c) => c.plays.includes(id));
    host.innerHTML = `
      <div class="dhead"><a class="btn ghost sm" href="${esc(S.lastExplore)}">← Results</a>
        <span class="label">${esc(p.category)} · ${esc(p.slot)}</span><span class="sp"></span>
        <div class="actions">
          <button class="btn${isSaved(id) ? " on" : ""}" id="dSave">${isSaved(id) ? "★ Saved" : "☆ Save"}</button>
          <button class="btn" id="dAdd">+ Add to collection</button>
          <button class="btn" id="dSim">Find similar plays</button>
        </div></div>
      <div class="dgrid">
        <div>
          <div class="stagewrap">
            <div class="angles" id="angles">${d.clips.map((c, i) => `<button data-clip="${i}" class="${i === 0 ? "on" : ""}" title="${esc(c.howVerified)}">${angleChip(c.angle.category)}${esc(clipName(c))}</button>`).join("")}</div>
            <div class="stage" id="stage">${scorebug(p, d)}</div>
            <div class="ctl" id="ctl">
              <button class="btn sm" data-c="play" title="Play / pause (space)">▶︎ Play</button>
              <button class="btn sm" data-c="back" title="Back 5 seconds">−5s</button>
              <button class="btn sm" data-c="fwd" title="Forward 5 seconds">+5s</button>
              <button class="btn sm" data-c="restart" title="Replay from the start">↺ Replay</button>
              <span class="t" id="ctlT">0:00</span>
              <button class="btn sm" data-c="a" title="Mark loop start at the current time">A</button>
              <button class="btn sm" data-c="b" title="Mark loop end at the current time">B</button>
              <button class="btn sm" data-c="loop" title="Loop the A–B segment" disabled>Loop A–B</button>
              <button class="btn sm" data-c="bug" title="Show or hide the scorebug">Scorebug</button>
              <button class="btn sm" data-c="fs" title="Fullscreen with the scorebug">⤢ Fullscreen</button>
              <span class="note">Speed: use MLB's player settings when it offers them — its embed doesn't accept a speed command.</span>
            </div>
            <div class="vmeta" id="vmeta"></div>
          </div>
          <div class="panel" style="margin-top:14px">
            <h2>${esc(p.title)}</h2>
            <div class="label" style="margin-bottom:10px">${esc(d.game.away.name)} at ${esc(d.game.home.name)} · ${esc(fmtDate(p.date))}${d.game.series ? " · " + esc(d.game.series) : ""} · ${esc(d.game.venue)}${p.titleSource ? ` · title: ${esc(p.titleSource)}` : ""}</div>
            <h3>What happened — MLB's official description</h3>
            <div class="official">${esc(d.event.description)}</div>
            <h3>Official outcome</h3>
            <div class="facts">${facts(p, d).map(([k, v]) => `<div class="fact"><span class="k">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
            ${d.chains && d.chains.length ? `<h3>Fielding (official credits)</h3><div class="chainl">${d.chains.map((c) => `${esc(c.runner)}${c.start ? " from " + esc(c.start) : " (batter)"}: ${esc(c.chain)}${c.out ? " — out at " + esc(c.outBase || "") : ""}`).join("<br>")}</div>` : ""}
            <h3>Data tags — computed from MLB's data</h3>
            <div class="tagrow">${p.flags.map((x) => S.flags[x] ? `<span class="tag" title="${esc(S.flags[x].rule)}">${esc(S.flags[x].label)}</span>` : "").join("")}</div>
            <h3>Source &amp; video availability</h3>
            <div class="src">${d.clips.map((c) => `<span class="ok">✓</span> ${esc(clipName(c))} — <a href="${esc(c.pageUrl)}" target="_blank" rel="noopener">MLB.com</a> · ${esc(c.angle.label)} · checked ${esc((c.checks || {}).checkedAt || "")} <span class="label">(${esc(c.howVerified)})</span>`).join("<br>")}
              ${d.savant ? `<br>${d.savant.match ? '<span class="ok">✓</span>' : "–"} Baseball Savant clip page ${d.savant.match ? "names the same game, batter and pitcher" : "not matched"} — <a href="${esc(d.savant.url)}" target="_blank" rel="noopener">open</a>` : ""}
              <br>${d.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}
              <br><span class="label">IDs: game ${esc(d.game.gamePk)} · at-bat ${esc(d.source.atBatIndex)} · event ${esc(d.source.eventIndex)} · playId ${esc(d.source.playId || "—")}</span></div>
          </div>
          <div class="panel" id="simPanel" hidden></div>
        </div>
        <div>
          <div class="panel">
            <h3>Game situation — before the play</h3>
            <div class="sit">${diamond(p.bases, { size: 150, outs: p.outs, names: p.runnersOn })}
              <dl class="sitrows">
                <dt>Inning</dt><dd>${esc(p.half === "top" ? "Top" : "Bottom")} ${esc(PR.ORD(p.inning))}</dd>
                <dt>Score</dt><dd>${esc(teamLine(p))}</dd>
                <dt>Outs</dt><dd>${esc(p.outs)}</dd>
                <dt>Runners</dt><dd>${esc(PR.basesLabel(p.bases))}</dd>
                <dt>Count</dt><dd>${esc(p.count.join("-"))}</dd>
                <dt>Batter</dt><dd>${esc(p.batter.name)} ${p.batter.side ? `(${esc(p.batter.side)})` : ""}</dd>
                <dt>Pitcher</dt><dd>${esc(p.pitcher.name)} ${p.pitcher.hand ? `(${esc(p.pitcher.hand)}HP)` : ""}</dd>
                <dt>Batting</dt><dd>${esc(PR.battingTeam(p))} ${PR.diff(p) === 0 ? "tied" : PR.diff(p) > 0 ? "up " + PR.diff(p) : "down " + -PR.diff(p)}</dd>
                ${p.li != null ? `<dt>Leverage</dt><dd>${esc(p.li.toFixed(2))}</dd>` : ""}
              </dl></div>
            <div class="ba">
              <div class="side"><span class="k">Before</span>${diamond(p.bases, { size: 64, outs: p.outs })}<span>${esc(teamLine(p))}</span></div>
              <div class="arrow">→</div>
              <div class="side"><span class="k">After</span>${diamond(p.after.bases, { size: 64, outs: Math.min(2, p.after.outs) })}<span>${p.after.outs >= 3 ? "3 outs · " : ""}${esc(p.away)} ${p.after.score[0]}–${p.after.score[1]} ${esc(p.home)}</span></div>
              <div class="res"><span><b>${p.runs}</b> run${p.runs === 1 ? "" : "s"} scored</span><span><b>${p.outsOnPlay}</b> out${p.outsOnPlay === 1 ? "" : "s"} recorded</span></div>
            </div>
          </div>
          <div class="panel coach">
            <h3>Coaching notes — your interpretation</h3>
            <p class="disc">Everything here is yours, not MLB data. It's saved in this browser and never shown as a fact.</p>
            <div class="mytags" id="myTags">${(U.tags[id] || []).map((t) => `<span class="tag coach">${esc(t)}<button data-untag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join("")}</div>
            <div style="display:flex;gap:6px"><input id="tagIn" list="dlTags" placeholder="Add a coaching tag — e.g. late cutoff alignment" aria-label="Add a coaching tag"><button class="btn sm" id="tagAdd">Add</button></div>
            <datalist id="dlTags">${allTags().map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
            ${[["teaching", "Teaching points"], ["observations", "Key observations"], ["questions", "Questions for players"], ["notes", "Notes"]].map(([k, l]) => `<label for="n_${k}">${l}</label><textarea id="n_${k}" data-note="${k}" rows="${k === "notes" ? 3 : 2}">${esc(notes[k] || "")}</textarea>`).join("")}
            <label for="n_cat">Coaching categories (comma-separated)</label><input id="n_cat" data-note="categories" value="${esc((notes.categories || []).join(", "))}">
            <p class="disc" style="margin-top:8px" id="noteState">${colsWith.length ? "In: " + colsWith.map((c) => esc(c.name)).join(", ") : "Not in a collection yet."}</p>
          </div>
        </div>
      </div>`;
    $("#dSave").onclick = () => { const on = toggleSaved(id); $("#dSave").classList.toggle("on", on); $("#dSave").textContent = on ? "★ Saved" : "☆ Save"; };
    $("#dAdd").onclick = () => addToCollection(id);
    $("#dSim").onclick = () => showSimilar(p);
    $$("#angles [data-clip]").forEach((b) => (b.onclick = () => { $$("#angles button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); mountClip(+b.dataset.clip); }));
    $("#ctl").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) control(b.dataset.c); };
    $$("[data-note]", host).forEach((el) => el.addEventListener("input", () => saveNote(id, el)));
    $("#tagAdd").onclick = () => addTag(id);
    $("#tagIn").addEventListener("keydown", (e) => { if (e.key === "Enter") addTag(id); });
    $("#myTags").onclick = (e) => { const b = e.target.closest("[data-untag]"); if (b) { U.tags[id] = (U.tags[id] || []).filter((t) => t !== b.dataset.untag); if (!U.tags[id].length) delete U.tags[id]; save(); b.parentElement.remove(); } };
    mountClip(0);
    window.scrollTo(0, 0);
  }
  function clipName(c) { return c.kind === "high-home" ? "High Home" : c.kind === "highlight" ? "MLB.com highlight" : c.kind === "filmroom" ? (c.angle.label || "Broadcast") : (c.angle.label || "Alternate angle").replace(/ \(MLB's name.*\)/, ""); }
  function facts(p, d) {
    const out = [["Result", p.eventLabel], ["Runs scored", String(p.runs)], ["Outs recorded", String(p.outsOnPlay)]];
    const b = p.batted || {};
    if (b.trajectory) out.push(["Batted ball", b.trajectory.replace(/_/g, " ")]);
    if (b.ev != null) out.push(["Exit velocity", b.ev + " mph"]);
    if (b.la != null) out.push(["Launch angle", b.la + "°"]);
    if (b.distance != null) out.push(["Distance", b.distance + " ft"]);
    if (b.location) out.push(["Fielded by", PR.LOC_NAME[b.location]]);
    if (b.spray) out.push(["Spray", b.spray]);
    const pi = p.pitch || {};
    if (pi.type) out.push(["Pitch", `${pi.type}${pi.speed ? " · " + pi.speed + " mph" : ""}`]);
    if (p.dRunExp != null) out.push(["Δ run expectancy", (p.dRunExp > 0 ? "+" : "") + p.dRunExp.toFixed(2)]);
    const w = PR.wpaBat(p);
    if (w != null) out.push(["Δ win prob. (batting)", (w > 0 ? "+" : "") + w.toFixed(1) + " pts"]);
    if (p.ifAlign) out.push(["Infield alignment", p.ifAlign]);
    if (p.ofAlign) out.push(["Outfield alignment", p.ofAlign]);
    return out;
  }
  /** broadcast-style scorebug in a slim strip above the video — never on top of the picture */
  function scorebug(p) {
    const bat = p.batting;
    return `<div class="scorebug" aria-label="Game situation before the play">
      <div class="sb-t"><span class="${bat === "away" ? "bat" : ""}">${esc(p.away)} <b>${p.score[0]}</b></span><span class="${bat === "home" ? "bat" : ""}">${esc(p.home)} <b>${p.score[1]}</b></span></div>
      <div class="sb-i">${p.half === "top" ? "▲" : "▼"}${p.inning}</div>
      <div class="sb-d">${diamond(p.bases, { size: 30, dark: true })}<span>${["○○", "●○", "●●"][p.outs]} ${p.outs} out${p.outs === 1 ? "" : "s"}</span><span>${p.count.join("-")}</span></div>
      <div class="sb-m"><span>AB ${esc(p.batter.name)}</span><span>P ${esc(p.pitcher.name)}</span></div>
      <div class="sb-r">${esc(fmtDate(p.date))}</div></div><div class="vid"></div>`;
  }
  function saveNote(id, el) {
    const n = U.notes[id] = U.notes[id] || {};
    n[el.dataset.note] = el.dataset.note === "categories" ? el.value.split(",").map((s) => s.trim()).filter(Boolean) : el.value;
    n.updated = new Date().toISOString(); save();
  }
  function addTag(id) {
    const v = $("#tagIn").value.trim(); if (!v) return;
    const list = U.tags[id] = U.tags[id] || [];
    if (!list.some((t) => t.toLowerCase() === v.toLowerCase())) list.push(v);
    save(); $("#tagIn").value = "";
    $("#myTags").innerHTML = list.map((t) => `<span class="tag coach">${esc(t)}<button data-untag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join("");
    toast(`Tagged “${v}” — your coaching tag, not MLB data`);
  }
  function showSimilar(p) {
    const list = PR.similar(p, S.plays, S.flags, userView(), 12);
    const host = $("#simPanel"); host.hidden = false;
    host.innerHTML = `<h3>Similar plays — same situation, outcome and teaching tags</h3>
      ${list.length ? `<div class="simgrid">${list.map((x) => card(x.p, `<div class="why">${esc(PR.whySimilar(p, x.p, S.flags))}</div>`)).join("")}</div>` : `<p>No similar plays yet.</p>`}
      <div style="margin-top:10px"><button class="btn sm" id="simSearch">Search this situation (${esc(PR.basesLabel(p.bases))}, ${esc(PR.outsLabel(p.outs).toLowerCase())})</button></div>`;
    host.onclick = (e) => { const c = e.target.closest("[data-open]"); if (c) openPlay(c.dataset.open); };
    $("#simSearch").onclick = () => { S.f = PR.emptyFilters(); S.f.bases = { mode: "exact", sel: [1, 2, 3].filter((b) => p.bases[b - 1] !== "_") }; S.f.outs = [p.outs]; S.understood = null; location.hash = "#/explore?f=" + PR.encodeFilters(S.f); };
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------------------------------------- MLB's embedded player (player.js) */
  const emb = { el: null, ready: false, t: 0, dur: 0, playing: false, q: [] };
  function mountClip(i, host = $("#stage")) {
    const c = cur.d.clips[i]; cur.clip = i; cur.loop = { a: null, b: null, on: false };
    stopPlayer();
    const f = document.createElement("iframe");
    f.src = c.embedUrl; f.title = `MLB video — ${c.title || cur.p.title}`; f.allowFullscreen = true;
    f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media"; f.referrerPolicy = "strict-origin-when-cross-origin";
    (host.querySelector(".vid") || host).appendChild(f);
    Object.assign(emb, { el: f, ready: false, t: 0, dur: 0, playing: false, q: [] });
    const vm = $("#vmeta");
    if (vm) vm.innerHTML = `${angleChip(c.angle.category)} <span>${esc(c.angle.label)}</span> · <span>${esc(c.title || "")}</span>${c.duration ? " · " + esc(c.duration.replace(/^00:/, "")) : ""} · <a href="${esc(c.pageUrl)}" target="_blank" rel="noopener">Open on MLB.com</a>`;
    updateCtl();
  }
  function stopPlayer(keep) { if (emb.el) { emb.el.remove(); } Object.assign(emb, { el: null, ready: false, playing: false, q: [] }); }
  function send(method, value) {
    if (!emb.el) return;
    if (!emb.ready) { emb.q.push([method, value]); return; }
    const m = { context: "player.js", version: "0.0.11", method };
    if (value !== undefined) m.value = value;
    if (method === "addEventListener") m.listener = "pr-" + value;
    emb.el.contentWindow.postMessage(JSON.stringify(m), EMBED_ORIGIN);
  }
  window.addEventListener("message", (e) => {
    if (!emb.el || e.source !== emb.el.contentWindow || e.origin !== EMBED_ORIGIN) return;
    let d = e.data; try { if (typeof d === "string") d = JSON.parse(d); } catch (x) { return; }
    if (!d || d.context !== "player.js") return;
    if (d.event === "ready") { emb.ready = true; ["play", "pause", "ended", "timeupdate"].forEach((ev) => send("addEventListener", ev)); emb.q.splice(0).forEach(([m, v]) => send(m, v)); }
    else if (d.event === "play") { emb.playing = true; updateCtl(); }
    else if (d.event === "pause" || d.event === "ended") { emb.playing = false; updateCtl(); }
    else if (d.event === "timeupdate" && d.value) {
      emb.t = +d.value.seconds || 0; emb.dur = +d.value.duration || emb.dur;
      const L = cur && cur.loop;
      if (L && L.on && L.a != null && L.b != null && emb.t >= L.b) send("setCurrentTime", L.a);
      const t = $("#ctlT") || $("#pT"); if (t) t.textContent = `${mmss(emb.t)}${emb.dur ? " / " + mmss(emb.dur) : ""}`;
    }
  });
  const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  function control(c) {
    const L = cur.loop;
    if (c === "play") send(emb.playing ? "pause" : "play");
    else if (c === "back") send("setCurrentTime", Math.max(0, emb.t - 5));
    else if (c === "fwd") send("setCurrentTime", emb.dur ? Math.min(emb.dur, emb.t + 5) : emb.t + 5);
    else if (c === "restart") { send("setCurrentTime", L.on && L.a != null ? L.a : 0); send("play"); }
    else if (c === "a") { L.a = emb.t; if (L.b != null && L.b <= L.a) L.b = null; toast(`Loop start ${mmss(L.a)}`); }
    else if (c === "b") { if (L.a == null || emb.t <= L.a) { toast("Mark A first, then B later in the clip"); return; } L.b = emb.t; L.on = true; send("setCurrentTime", L.a); send("play"); toast(`Looping ${mmss(L.a)}–${mmss(L.b)}`); }
    else if (c === "loop") { L.on = !L.on; if (L.on) send("setCurrentTime", L.a); }
    else if (c === "bug") $("#stage").classList.toggle("sb-hide");
    else if (c === "fs") { const st = $("#stage"); if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen && st.requestFullscreen().catch(() => toast("Fullscreen isn't available here — use the player's own button")); }
    updateCtl();
  }
  function updateCtl() {
    const host = $("#ctl"); if (!host || !cur) return;
    const pb = $('[data-c="play"]', host); if (pb) pb.textContent = emb.playing ? "❚❚ Pause" : "▶︎ Play";
    const L = cur.loop, lb = $('[data-c="loop"]', host);
    if (lb) { lb.disabled = L.a == null || L.b == null; lb.classList.toggle("on", L.on); lb.textContent = L.a != null && L.b != null ? `Loop ${mmss(L.a)}–${mmss(L.b)}` : "Loop A–B"; }
    $('[data-c="a"]', host).classList.toggle("on", L.a != null); $('[data-c="b"]', host).classList.toggle("on", L.b != null);
  }
  document.addEventListener("keydown", (e) => {
    if (!emb.el || /input|textarea|select/i.test((e.target.tagName || ""))) return;
    if (e.key === " " && !$("#vPlay").hidden) { e.preventDefault(); control("play"); }
  });

  /* ================================================================ collections */
  function addToCollection(id) {
    const draw = () => collections().map((c) => `<button class="opt${c.plays.includes(id) ? " in" : ""}" data-col="${esc(c.id)}"><b>${esc(c.name)}</b><span class="sp"></span><span class="label">${c.plays.length} plays${c.plays.includes(id) ? " · ✓ added" : ""}</span></button>`).join("");
    modal(`<h2>Add to collection</h2><div id="colOpts">${draw() || '<p class="fnote">No collections yet — create one below.</p>'}</div>
      <div style="display:flex;gap:6px;margin-top:8px"><input type="text" id="colNew" placeholder="New collection — e.g. First and Third Defense"><button class="btn primary" id="colCreate">Create &amp; add</button></div>
      <div class="mfoot"><button class="btn" data-close>Done</button></div>`, (m) => {
      const refresh = () => { $("#colOpts", m).innerHTML = draw(); };
      $("#colOpts", m).onclick = (e) => {
        const b = e.target.closest("[data-col]"); if (!b) return;
        const c = U.collections[b.dataset.col], i = c.plays.indexOf(id);
        if (i >= 0) c.plays.splice(i, 1); else c.plays.push(id);
        save(); refresh(); toast(i >= 0 ? `Removed from “${c.name}”` : `Added to “${c.name}”`);
      };
      const create = () => { const n = $("#colNew", m).value.trim(); if (!n) { $("#colNew", m).focus(); return; } const c = newCollection(n); c.plays.push(id); save(); $("#colNew", m).value = ""; refresh(); toast(`Added to new collection “${n}”`); };
      $("#colCreate", m).onclick = create;
      $("#colNew", m).addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
    });
  }
  function renderCollections(id) {
    const host = $("#vCollections");
    if (id && U.collections[id]) return renderCollection(U.collections[id]);
    const list = collections();
    host.innerHTML = `<div class="phead"><div><span class="label">Teaching library</span><h1>Collections</h1><p>Group plays for a class, a staff meeting or a lesson — then present them.</p></div><span class="sp"></span>
      <button class="btn primary" id="cNew">+ New collection</button></div>
      ${list.length ? `<div class="colgrid">${list.map((c) => `<button class="colcard" data-cid="${esc(c.id)}"><span class="label">${c.plays.length} play${c.plays.length === 1 ? "" : "s"}</span><h3>${esc(c.name)}</h3>${c.desc ? `<p class="fnote" style="margin:0">${esc(c.desc)}</p>` : ""}
        <div class="strip">${c.plays.slice(0, 4).map((pid) => S.byId.get(pid)).filter(Boolean).map((p) => p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : "").join("")}</div></button>`).join("")}</div>`
        : `<div class="empty">No collections yet. Open any play and choose <b>+ Add to collection</b>, or create one here.<br><br>Ideas: Baserunning Fundamentals · First and Third Defense · Cutoffs and Relays · Two-Out Baserunning · Catcher Defense</div>`}`;
    $("#cNew").onclick = () => modal(`<h2>New collection</h2><input type="text" id="cn" placeholder="Name"><textarea id="cd" rows="2" placeholder="What it's for (optional)" style="margin-top:6px"></textarea><div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cOk">Create</button></div>`,
      (m) => { $("#cOk", m).onclick = () => { const n = $("#cn", m).value.trim(); if (!n) return; const c = newCollection(n, $("#cd", m).value.trim()); closeModal(); location.hash = "#/collections/" + c.id; }; $("#cn", m).addEventListener("keydown", (e) => { if (e.key === "Enter") $("#cOk", m).click(); }); });
    host.onclick = (e) => { const c = e.target.closest("[data-cid]"); if (c) location.hash = "#/collections/" + c.dataset.cid; };
  }
  function renderCollection(c) {
    const host = $("#vCollections");
    const plays = c.plays.map((id) => S.byId.get(id)).filter(Boolean);
    host.innerHTML = `<div class="phead"><div><a class="btn ghost sm" href="#/collections">← Collections</a><h1 style="margin-top:8px">${esc(c.name)}</h1><p>${esc(c.desc || "")} ${plays.length} play${plays.length === 1 ? "" : "s"}</p></div><span class="sp"></span>
      <button class="btn" id="cRen">Rename</button><button class="btn" id="cDel">Delete</button><button class="btn primary" id="cPres" ${plays.length ? "" : "disabled"}>▶ Present</button></div>
      ${plays.length ? `<div class="clist">${plays.map((p, i) => `<div class="crow" data-pid="${esc(p.id)}"><span class="num">${i + 1}</span>${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span>${diamond(p.bases, { size: 50, outs: p.outs })}</span>`}
        <div><div class="t" data-open="${esc(p.id)}">${esc(p.title)}</div><div class="csit">${esc(PR.halfLabel(p))} · ${esc(PR.basesLabel(p.bases))}, ${esc(PR.outsLabel(p.outs).toLowerCase())} · ${esc(p.away)} @ ${esc(p.home)} · ${esc(fmtDate(p.date))}</div></div>
        <div class="ops"><button class="btn sm" data-mv="-1" ${i ? "" : "disabled"} aria-label="Move up">↑</button><button class="btn sm" data-mv="1" ${i < plays.length - 1 ? "" : "disabled"} aria-label="Move down">↓</button><button class="btn sm" data-rmp="1">Remove</button></div></div>`).join("")}</div>`
        : `<div class="empty">This collection is empty. Find plays in <a href="#/explore">Explore</a> and choose <b>+ Add to collection</b>.</div>`}`;
    $("#cPres").onclick = () => (location.hash = `#/present/${c.id}/0`);
    $("#cRen").onclick = () => modal(`<h2>Rename</h2><input type="text" id="rn" value="${esc(c.name)}"><textarea id="rd" rows="2" style="margin-top:6px">${esc(c.desc || "")}</textarea><div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rOk">Save</button></div>`,
      (m) => { $("#rOk", m).onclick = () => { c.name = $("#rn", m).value.trim() || c.name; c.desc = $("#rd", m).value.trim(); save(); closeModal(); renderCollection(c); }; });
    $("#cDel").onclick = () => modal(`<h2>Delete “${esc(c.name)}”?</h2><p>The plays stay in the repository; only this collection is removed.</p><div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dOk">Delete</button></div>`,
      (m) => { $("#dOk", m).onclick = () => { const copy = JSON.parse(JSON.stringify(c)); delete U.collections[c.id]; U.order = U.order.filter((x) => x !== c.id); save(); closeModal(); location.hash = "#/collections"; toast("Collection deleted", { label: "Undo", fn: () => { U.collections[copy.id] = copy; U.order.unshift(copy.id); save(); renderCollections(); } }); }; });
    host.onclick = (e) => {
      const row = e.target.closest("[data-pid]"); if (!row) return;
      const id = row.dataset.pid, i = c.plays.indexOf(id);
      if (e.target.closest("[data-open]")) return openPlay(id);
      const mv = e.target.closest("[data-mv]");
      if (mv) { const j = i + +mv.dataset.mv; [c.plays[i], c.plays[j]] = [c.plays[j], c.plays[i]]; save(); renderCollection(c); }
      if (e.target.closest("[data-rmp]")) { c.plays.splice(i, 1); save(); renderCollection(c); toast("Removed from the collection", { label: "Undo", fn: () => { c.plays.splice(i, 0, id); save(); renderCollection(c); } }); }
    };
  }
  function renderSaved() {
    const plays = U.saved.map((id) => S.byId.get(id)).filter(Boolean);
    const host = $("#vSaved");
    host.innerHTML = `<div class="phead"><div><span class="label">Your shortlist</span><h1>Saved Plays</h1><p>${plays.length} saved · stored in this browser</p></div></div>
      ${plays.length ? `<div class="grid">${plays.map((p) => card(p)).join("")}</div>` : `<div class="empty">Nothing saved yet. Open a play and press <b>☆ Save</b>.</div>`}`;
    host.onclick = (e) => { const c = e.target.closest("[data-open]"); if (c) openPlay(c.dataset.open); };
  }

  /* ================================================================ presentation mode */
  const P = { col: null, i: 0, reveal: false };
  async function openPresent(cid, i) {
    const c = U.collections[cid]; if (!c || !c.plays.length) { location.hash = "#/collections"; return; }
    P.col = c; P.i = Math.max(0, Math.min(c.plays.length - 1, i)); P.reveal = false;
    const p = S.byId.get(c.plays[P.i]); const d = await detail(p.id);
    cur = { p, d, clip: 0, loop: { a: null, b: null, on: false } };
    const n = U.notes[p.id] || {};
    const noteTxt = [["Teaching points", n.teaching], ["Key observations", n.observations], ["Questions for players", n.questions], ["Notes", n.notes]].filter(([, v]) => v && v.trim());
    const host = $("#present"); host.hidden = false; document.body.style.overflow = "hidden";
    host.innerHTML = `<div class="pbar"><b>${esc(c.name)}</b><span>${P.i + 1} / ${c.plays.length}</span><span class="sp"></span><span id="pT"></span>
        <span>← → next · N notes · F fullscreen · Esc exit</span><button class="btn sm" id="pX">Exit</button></div>
      <div class="pmain"><div class="stage" id="pStage">${scorebug(p)}</div>
        <div class="pside"><div class="panel"><h3>Situation</h3><div class="sit" style="grid-template-columns:110px 1fr">${diamond(p.bases, { size: 110, outs: p.outs, names: p.runnersOn, dark: true })}
          <dl class="sitrows"><dt>Inning</dt><dd>${esc(PR.halfLabel(p))}</dd><dt>Score</dt><dd>${esc(teamLine(p))}</dd><dt>Count</dt><dd>${esc(p.count.join("-"))}</dd><dt>Batter</dt><dd>${esc(p.batter.name)}</dd><dt>Pitcher</dt><dd>${esc(p.pitcher.name)}</dd></dl></div></div>
          ${d.clips.length > 1 ? `<div class="panel"><h3>Camera</h3>${d.clips.map((cl, k) => `<button class="btn sm${k === 0 ? " primary" : ""}" data-pclip="${k}" style="margin:0 4px 4px 0">${esc(clipName(cl))}</button>`).join("")}</div>` : ""}
          <div class="panel"><h3>Coaching notes</h3><div id="pNotes">${noteTxt.length ? `<button class="btn sm" id="pReveal">Reveal notes (N)</button>` : '<span class="fnote" style="color:#A79C8E">No notes for this play.</span>'}</div></div></div></div>
      <div class="pfoot"><button class="btn" id="pPrev" ${P.i ? "" : "disabled"}>← Previous</button><div class="ptitle">${esc(p.title)}</div><span class="sp"></span>
        <span class="label" style="color:#A79C8E">${esc(p.away)} @ ${esc(p.home)} · ${esc(fmtDate(p.date))}</span><button class="btn primary" id="pNext" ${P.i < c.plays.length - 1 ? "" : "disabled"}>Next →</button></div>`;
    mountClip(0, $("#pStage"));
    const reveal = () => { P.reveal = true; $("#pNotes").innerHTML = noteTxt.map(([k, v]) => `<div class="label" style="color:#C9A27E;margin-top:6px">${esc(k)}</div><div class="pnotes">${esc(v)}</div>`).join(""); };
    $("#pX").onclick = () => closePresent();
    $("#pPrev").onclick = () => (location.hash = `#/present/${c.id}/${P.i - 1}`);
    $("#pNext").onclick = () => (location.hash = `#/present/${c.id}/${P.i + 1}`);
    const rb = $("#pReveal"); if (rb) rb.onclick = reveal;
    $$("[data-pclip]").forEach((b) => (b.onclick = () => { $$("[data-pclip]").forEach((x) => x.classList.remove("primary")); b.classList.add("primary"); mountClip(+b.dataset.pclip, $("#pStage")); }));
    P.reveal_fn = reveal;
  }
  function closePresent(silent) {
    if ($("#present").hidden) return;
    $("#present").hidden = true; $("#present").innerHTML = ""; document.body.style.overflow = ""; stopPlayer();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!silent && P.col) location.hash = "#/collections/" + P.col.id;
  }
  document.addEventListener("keydown", (e) => {
    if ($("#present").hidden || /input|textarea/i.test(e.target.tagName || "")) return;
    if (e.key === "ArrowRight" && P.i < P.col.plays.length - 1) location.hash = `#/present/${P.col.id}/${P.i + 1}`;
    else if (e.key === "ArrowLeft" && P.i > 0) location.hash = `#/present/${P.col.id}/${P.i - 1}`;
    else if (e.key === "n" || e.key === "N") { if (P.reveal_fn && $("#pReveal")) P.reveal_fn(); }
    else if (e.key === "f" || e.key === "F") { if (document.fullscreenElement) document.exitFullscreen(); else $("#present").requestFullscreen && $("#present").requestFullscreen().catch(() => {}); }
    else if (e.key === "Escape" && !document.fullscreenElement) closePresent();
    else if (e.key === " ") { e.preventDefault(); control("play"); }
  });

  /* ================================================================ import */
  function renderImport() {
    const host = $("#vImport");
    host.innerHTML = `<div class="phead"><div><span class="label">Grow the repository</span><h1>Discover &amp; import plays</h1>
        <p>New plays come from the shared MLB play pipeline (tools/mlb-plays): it scans MLB's play-by-play, finds the play's own MLB clip, checks it plays, and writes a file you import here. Nothing joins the library until you approve it.</p></div></div>
      <div class="panel"><h3>1 · Discover (on a computer or in a Claude Code session)</h3>
        <pre class="code">cd tools/mlb-plays
python3 discover.py 2025-06-01:2025-06-07      # scan games → normalized plays + MLB clips
python3 curate.py                              # pick plays by teaching slot, verify video
python3 publish.py ../../apps/play-repository --bundle new-plays.json</pre>
        <p class="fnote">Plays already in the repository are skipped by id; MLB's rate limits are respected with caching and retries.</p>
        <h3>2 · Import the bundle</h3>
        <input type="file" id="impFile" accept="application/json">
        <div id="impOut" style="margin-top:10px"></div>
        <h3>Review queue</h3><div id="queue">${queueHTML()}</div>
        <h3>Your data</h3><p class="fnote">Saved plays, collections, notes, tags and imported plays live in this browser. Keep a copy, or move them to another browser.</p>
        <div class="actions"><button class="btn" id="expAll">Export my data</button><label class="btn">Restore from file<input type="file" id="impAll" accept="application/json" hidden></label></div></div>`;
    $("#impFile").onchange = (e) => readFile(e.target.files[0], (obj) => {
      const v = validateBundle(obj);
      if (!v.ok) { $("#impOut").innerHTML = `<div class="empty">That file isn't a Play Repository bundle: ${esc(v.error)}</div>`; return; }
      const known = new Set(S.plays.map((p) => p.id).concat(U.queue.map((q) => q.index.id)));
      const fresh = obj.plays.filter((x) => !known.has(x.index.id));
      U.queue.push(...fresh); save();
      $("#impOut").innerHTML = `<p>${fresh.length} play(s) added to the review queue${obj.plays.length - fresh.length ? ` · ${obj.plays.length - fresh.length} already known, skipped` : ""}.</p>`;
      $("#queue").innerHTML = queueHTML();
    });
    $("#queue").onclick = (e) => {
      const b = e.target.closest("[data-qa]"); if (!b) return;
      const i = +b.dataset.i, item = U.queue[i];
      U.queue.splice(i, 1);
      if (b.dataset.qa === "ok") { U.imported.push(item); S.plays.push(item.index); S.byId.set(item.index.id, item.index); toast("Added to the repository"); }
      save(); $("#queue").innerHTML = queueHTML();
    };
    $("#expAll").onclick = () => {
      const blob = new Blob([JSON.stringify({ app: "play-repository", kind: "user-data", exported: new Date().toISOString(), data: U }, null, 1)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "play-repository-my-data.json"; a.click();
    };
    $("#impAll").onchange = (e) => readFile(e.target.files[0], (obj) => {
      if (!obj || obj.app !== "play-repository" || obj.kind !== "user-data" || typeof obj.data !== "object") { toast("That isn't a Play Repository data file"); return; }
      Object.assign(U, obj.data); save(); toast("Restored — reloading"); setTimeout(() => location.reload(), 600);
    });
  }
  function queueHTML() {
    return U.queue.length ? U.queue.map((q, i) => `<div class="imp-row"><div><b>${esc(q.index.title)}</b><div class="csit">${esc(q.index.date)} · ${esc(q.index.away)} @ ${esc(q.index.home)} · ${esc(PR.halfLabel(q.index))} · ${esc(PR.basesLabel(q.index.bases))}, ${esc(PR.outsLabel(q.index.outs).toLowerCase())} · ${q.detail.clips.length} verified clip(s)</div></div>
      <div class="actions"><button class="btn sm" data-qa="no" data-i="${i}">Reject</button><button class="btn sm primary" data-qa="ok" data-i="${i}">Approve</button></div></div>`).join("") : `<p class="fnote">Empty.</p>`;
  }
  function validateBundle(o) {
    if (!o || o.app !== "play-repository" || o.kind !== "plays" || !Array.isArray(o.plays)) return { ok: false, error: "missing app/kind/plays" };
    for (const x of o.plays) {
      const p = x && x.index, d = x && x.detail;
      if (!p || !d || !p.id || !/^mlb-\d+-\d+(-e\d+)?$/.test(p.id) || p.id !== d.id) return { ok: false, error: "a play without a valid id" };
      if (!Array.isArray(p.flags) || typeof p.bases !== "string" || !/^[1_][2_][3_]$/.test(p.bases) || ![0, 1, 2].includes(p.outs)) return { ok: false, error: `${p.id}: bad situation fields` };
      if (!Array.isArray(d.clips) || !d.clips.length || !d.clips.every((c) => /^https:\/\/streamable\.com\/m\/[a-z0-9-]+$/.test(c.embedUrl) && /^https:\/\/www\.mlb\.com\/video\//.test(c.pageUrl)))
        return { ok: false, error: `${p.id}: every play needs a verified MLB clip` };
    }
    return { ok: true };
  }
  function readFile(file, fn) { if (!file) return; const r = new FileReader(); r.onload = () => { try { fn(JSON.parse(r.result)); } catch (e) { toast("That file isn't valid JSON"); } }; r.readAsText(file); }

  /* ================================================================ help */
  $("#btnHelp").onclick = () => modal(`<h2>How Play Repository works</h2><div class="help">
      <h4>Find a situation</h4><p>Click bases on the diamond (Exactly / At least), pick outs, then add inning, score and play-type filters — or type it: “runner on second, one out, single to right, play at home”. Every filter uses the state <b>before</b> the play.</p>
      <h4>Watch</h4><p>Each play shows MLB's own video, matched to the exact pitch. High Home is used first when MLB published it; everything else is labelled as broadcast. Mark A and B to loop a segment; Fullscreen keeps the scorebug.</p>
      <h4>Teach</h4><p>Save plays (☆), add them to collections, write teaching points and questions, then <b>Present</b> a collection — notes stay hidden until you reveal them (N).</p>
      <h4>Facts vs. coaching</h4><p>Grey tags are computed from MLB's data (hover for the rule). Gold tags and notes are yours and are never shown as fact.</p>
      <h4>Your data</h4><p>Saved plays, collections, notes and tags are kept in this browser. Use <a href="#/import" data-close>Import → Export my data</a> to keep a copy.</p>
      <p class="fnote" style="margin-top:10px">Data: MLB Stats API, Baseball Savant, MLB Film Room; video: MLB.com embeds. Repository built ${esc(S.generated || "")}.</p></div>
      <div class="mfoot"><button class="btn primary" data-close>Got it</button></div>`);

  boot();
  window.PRApp = { S, U, save, filterNow: () => PR.filter(S.plays, S.f, userView(), S.flags) };
})();
