/* FUEL — reports and data management (imports, history, exports, audit). */
import { api, mode, resetDemo } from "./api.js";
import { addDays } from "./shared/util.js";
import { $, $$, esc, S, can, toast, errToast, fmtDate, playerName, players, invalidate, table, openModal, closeModal, today, playerPicker, download } from "./ui.js";

/* ------------------------------------------------------------------ reports */
const REPORTS = [
  ["weight_change", "Weight change over a period", ["from", "to", "affiliate"]],
  ["missing_weighins", "Missing recent weigh-ins", ["days", "affiliate"]],
  ["dexa_change", "Body composition between DEXA scans", ["affiliate"]],
  ["performance_trends", "Performance alongside body composition", ["from", "to", "affiliate"]],
  ["followup_status", "Follow-up status", ["status"], "read_notes"],
  ["weight_history", "Weight history — one player", ["player_id"]],
  ["nutrition_history", "Nutrition history — one player", ["player_id"], "read_notes"],
];
let REPORT_NAME = "";
export async function renderReports(app, name = "weight_change") {
  const avail = REPORTS.filter((r) => !r[3] || can(r[3]));
  if (!avail.some((r) => r[0] === name)) name = avail[0][0];
  const def = avail.find((r) => r[0] === name);
  REPORT_NAME = name;
  const prm = JSON.parse(sessionStorage.getItem("fuel:rp:" + name) || "{}");
  await players();
  app.innerHTML = `<div class="pagehead"><div><h1>Reports</h1><div class="sub">On-screen summaries${can("export") ? " and CSV exports (every export is logged)" : ""}</div></div></div>
    <div style="display:grid;grid-template-columns:minmax(0,240px) minmax(0,1fr);gap:14px" class="rgrid">
      <nav class="panel" aria-label="Reports"><ul class="list">${avail.map(([k, l]) => `<li><a href="#/reports/${k}" class="${k === name ? "pname" : ""}" style="text-decoration:none;${k === name ? "" : "color:var(--ink-2)"}">${esc(l)}</a></li>`).join("")}</ul></nav>
      <section class="panel"><header><h2>${esc(def[1])}</h2><span class="sp"></span><button class="btn sm" id="rCsv" ${can("export") ? "" : "disabled title='Your role can’t export'"}>Download CSV</button><button class="btn sm" id="rPrint">Print</button></header>
        <div class="body"><form class="filters" id="rF">${def[2].map((p) => param(p, prm)).join("")}<button class="btn primary" type="submit">Run</button></form><p class="muted small" id="rNote" style="margin:0 0 8px"></p></div>
        <div class="tblwrap" id="rT"></div></section></div>`;
  if (window.matchMedia("(max-width:860px)").matches) $(".rgrid").style.gridTemplateColumns = "minmax(0,1fr)";
  let picked = null;
  const pp = $("#rPick"); if (pp) { const cur = prm.player_id && S.players.find((p) => p.id === prm.player_id); picked = cur || null; playerPicker(pp, { initial: cur, onPick: (p) => { picked = p; if (p) run(); } }); }
  const params = () => { const o = {}; for (const p of def[2]) { if (p === "player_id") { if (picked) o.player_id = picked.id; } else { const el = $("#rp_" + p); if (el && el.value) o[p] = el.value; } } return o; };
  const run = async () => {
    const o = params(); sessionStorage.setItem("fuel:rp:" + name, JSON.stringify(o));
    if (def[2].includes("player_id") && !o.player_id) { $("#rT").innerHTML = '<div class="empty">Choose a player.</div>'; return; }
    try {
      const r = await api("GET", "report", { params: { name, ...o } });
      $("#rNote").textContent = r.note || "";
      table($("#rT"), { rows: r.rows, cols: r.columns.map((c) => ({ key: c.key, label: c.label, cls: /change|first|last|days|^n$|bf_|_from|_to|weight$|^last$/.test(c.key) && c.key !== "last_date" && c.key !== "first_date" ? "n" : "", sort: (x) => x[c.key],
        render: (x) => c.key === "player" ? esc(x[c.key]) : /change$/.test(c.key) && x[c.key] != null ? `<span class="delta ${x[c.key] > 0 ? "up" : x[c.key] < 0 ? "down" : "flat"}">${x[c.key] > 0 ? "+" : ""}${esc(x[c.key])}</span>` : esc(x[c.key] ?? "") })), empty: "No rows for these settings." });
    } catch (e) { $("#rT").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $("#rF").onsubmit = (e) => { e.preventDefault(); run(); };
  $("#rCsv").onclick = async () => { try { const r = await api("GET", "report", { params: { name, ...params(), format: "csv" } }); download(r.filename, r.csv); toast("CSV downloaded — the export is recorded in the audit log"); } catch (e) { errToast(e); } };
  $("#rPrint").onclick = () => window.print();
  run();
}
function param(p, v) {
  const t = today();
  if (p === "from") return `<div class="f"><label for="rp_from">From</label><input type="date" id="rp_from" value="${esc(v.from || addDays(t, REPORT_NAME === "performance_trends" ? -365 : -30))}"></div>`;
  if (p === "to") return `<div class="f"><label for="rp_to">To</label><input type="date" id="rp_to" value="${esc(v.to || t)}"></div>`;
  if (p === "days") return `<div class="f"><label for="rp_days">No weigh-in for more than</label><select id="rp_days">${[3, 5, 7, 10, 14, 30].map((n) => `<option value="${n}"${String(n) === String(v.days || 7) ? " selected" : ""}>${n} days</option>`).join("")}</select></div>`;
  if (p === "affiliate") return `<div class="f"><label for="rp_affiliate">Affiliate</label><select id="rp_affiliate"><option value="">All</option>${S.session.vocab.affiliates.map((a) => `<option${a === v.affiliate ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>`;
  if (p === "status") return `<div class="f"><label for="rp_status">Status</label><select id="rp_status"><option value="">All</option>${["open", "overdue", "completed", "cancelled"].map((s) => `<option${s === v.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>`;
  if (p === "player_id") return `<div class="f" style="min-width:280px"><span class="lbl">Player</span><div id="rPick"></div></div>`;
  return "";
}

/* ------------------------------------------------------------------ data management */
const KINDS = { roster: "Roster", legacy: "Legacy nutrition spreadsheet", performance: "Performance" };
const IMPORT_PERM = { roster: "import_roster", legacy: "import_legacy", performance: "import_performance" };
export async function renderData(app, tab = "import") {
  const tabs = [["import", "Import", "import_performance"], ["history", "Import history", "import_performance"], ["export", "Export", "export"], ["audit", "Audit log", "audit"], ...(mode === "demo" ? [["demo", "Demo data", null]] : [])].filter((t) => !t[2] || can(t[2]));
  if (!tabs.length) { app.innerHTML = `<div class="pagehead"><h1>Data</h1></div><section class="panel"><div class="empty"><span class="lock">🔒 Your role doesn't include data management.</span></div></section>`; return; }
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
  app.innerHTML = `<div class="pagehead"><div><h1>Data management</h1><div class="sub">Imports always preview first, never overwrite, and can be rolled back</div></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/data/${k}" class="${k === tab ? "on" : ""}">${esc(l)}</a>`).join("")}</nav><div id="dBody"></div>`;
  const host = $("#dBody");
  if (tab === "import") return importer(host);
  if (tab === "history") return history(host);
  if (tab === "export") return exporter(host);
  if (tab === "audit") return auditLog(host);
  if (tab === "demo") return demo(host);
}

function importer(host) {
  const kinds = Object.keys(KINDS).filter((k) => can(IMPORT_PERM[k]));
  const st = { kind: sessionStorage.getItem("fuel:ik") && kinds.includes(sessionStorage.getItem("fuel:ik")) ? sessionStorage.getItem("fuel:ik") : kinds[0], csv: "", filename: "", options: { year: "", massUnit: "lb" }, mapping: null, plan: null, decisions: {}, filter: "" };
  step1();
  function steps(n) { return `<div class="steps"><span class="${n === 1 ? "on" : "done"}">1 · File</span><span class="${n === 2 ? "on" : n > 2 ? "done" : ""}">2 · Check &amp; decide</span><span class="${n === 3 ? "on" : ""}">3 · Done</span></div>`; }
  function step1() {
    host.innerHTML = `${steps(1)}<div class="grid2"><section class="panel"><header><h2>What are you importing?</h2></header><div class="body form">
      <div class="seg" id="iK">${kinds.map((k) => `<button type="button" data-k="${k}" class="${k === st.kind ? "on" : ""}">${esc(KINDS[k])}</button>`).join("")}</div>
      <div class="drop" id="iDrop"><b>Drop a CSV file here</b> or <label class="btn sm" style="margin-left:6px">Choose file<input type="file" id="iFile" accept=".csv,text/csv,.txt" hidden></label><div class="small" id="iFn" style="margin-top:6px">${esc(st.filename)}</div></div>
      <details><summary class="small" style="cursor:pointer;color:var(--navy-2)">…or paste CSV text</summary><textarea id="iPaste" rows="6" style="width:100%;margin-top:6px;font-family:ui-monospace,monospace;font-size:12px">${esc(st.filename ? "" : st.csv)}</textarea></details>
      ${st.kind === "legacy" ? `<div class="row"><div class="f"><label for="iYear">Season year for dates written without a year</label><input type="number" id="iYear" class="w110" placeholder="e.g. 2026" value="${esc(st.options.year)}"><span class="hint">Leave blank to keep “3/14”-style dates as date unknown.</span></div>
        <div class="f"><label for="iUnit">Weight & DEXA units in the sheet</label><select id="iUnit"><option value="lb"${st.options.massUnit === "lb" ? " selected" : ""}>lb</option><option value="kg"${st.options.massUnit === "kg" ? " selected" : ""}>kg</option></select></div></div>` : ""}
      <div class="err" id="iErr" role="alert"></div>
      <div class="row"><span class="sp"></span><button class="btn primary" id="iNext">Check the file →</button></div></div></section>
      <section class="panel"><header><h2>${esc(KINDS[st.kind])} — what FUEL does with it</h2></header><div class="body small">${guide(st.kind)}</div></section></div>`;
    $$("#iK button").forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; sessionStorage.setItem("fuel:ik", st.kind); st.mapping = null; step1(); }));
    const drop = $("#iDrop");
    const read = (file) => { if (!file) return; if (file.size > 5 * 1024 * 1024) { $("#iErr").textContent = "That file is larger than 5 MB — split it first."; return; } const r = new FileReader(); r.onload = () => { st.csv = String(r.result); st.filename = file.name; $("#iFn").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`; }; r.readAsText(file); };
    $("#iFile").onchange = (e) => read(e.target.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("on"); }; drop.ondragleave = () => drop.classList.remove("on");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("on"); read(e.dataTransfer.files[0]); };
    $("#iNext").onclick = async () => {
      const pasted = $("#iPaste").value.trim();
      if (pasted) { st.csv = pasted; st.filename = "pasted text"; }
      if (!st.csv) { $("#iErr").textContent = "Choose a CSV file or paste CSV text."; return; }
      if ($("#iYear")) { st.options.year = $("#iYear").value; st.options.massUnit = $("#iUnit").value; }
      st.mapping = null; st.decisions = {};
      await preview();
    };
  }
  async function preview() {
    try { st.plan = await api("POST", "import.preview", { body: { kind: st.kind, csv: st.csv, mapping: st.mapping, options: st.options } }); }
    catch (e) { const el = $("#iErr"); if (el) el.textContent = e.message; else errToast(e); return; }
    st.mapping = st.plan.mapping || st.mapping || {};
    step2();
  }
  function step2() {
    const p = st.plan, fields = p.fields || [];
    const sm = p.summary || {};
    const reviewRows = p.rows.filter((r) => r.status === "review");
    const undecided = reviewRows.filter((r) => !st.decisions[r.line]).length;
    host.innerHTML = `${steps(2)}
      ${p.errors.length ? `<div class="callout warn" style="margin-bottom:12px"><b>Fix before importing:</b> ${esc(p.errors.join(" "))}</div>` : ""}
      <div class="grid2" style="grid-template-columns:minmax(0,340px) minmax(0,1fr)">
        <section class="panel"><header><h2>Columns</h2><span class="count">${esc(st.filename)}</span></header><div class="tblwrap" style="max-height:560px"><table class="tbl"><thead><tr><th>FUEL field</th><th>Your column</th></tr></thead><tbody>
          ${fields.map((f) => `<tr><td>${esc(f.label)}${f.required ? ' <span class="err">*</span>' : ""}</td><td><select data-map="${esc(f.key)}" aria-label="Column for ${esc(f.label)}" style="max-width:170px"><option value="">— not in file —</option>${p.headers.filter(Boolean).map((h) => `<option${st.mapping[f.key] === h ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></td></tr>`).join("")}
          </tbody></table></div><div class="body"><button class="btn sm" id="iRemap">Re-check with these columns</button>${unmapped(p, st.mapping)}</div></section>
        <section class="panel"><header><h2>Preview — nothing is saved yet</h2></header><div class="body">
          <div class="row" style="gap:6px;margin-bottom:8px">${[["", `All ${sm.rows || 0}`], ["new", `New ${sm.new || 0}`], ["update", `Updates ${sm.update || 0}`], ["review", `Needs decision ${sm.review || 0}`], ["duplicate", `Already in FUEL ${sm.duplicate || 0}`], ["error", `Errors ${sm.error || 0}`]].map(([k, l]) => `<button type="button" class="btn sm${st.filter === k ? " primary" : ""}" data-flt="${k}">${l}</button>`).join("")}</div>
          ${reviewRows.length ? `<div class="callout warn" style="margin-bottom:8px">${reviewRows.length} row${reviewRows.length === 1 ? "" : "s"} could match an existing player by name. FUEL never merges on a name alone — choose for each (undecided rows are skipped). ${reviewRows.some((r) => r.match && r.match.proposal) ? '<button class="btn sm" id="iAccept">Accept the suggested matches</button>' : ""}</div>` : ""}
          <p class="small muted" style="margin:0">${sm.records || 0} records ready to add. Existing records are never changed${st.kind === "roster" ? " (except roster fields on matched players, with the old values kept for rollback)" : ""}.</p></div>
          <div class="tblwrap" style="max-height:520px" id="iRows"></div>
          <div class="row" style="padding:10px 12px;border-top:1px solid var(--line)"><button class="btn ghost" id="iBack">← Choose another file</button><span class="sp"></span><span class="small muted">${undecided ? undecided + " undecided — will be skipped" : ""}</span><button class="btn accent" id="iCommit" ${p.errors.length || !p.rows.length ? "disabled" : ""}>Import…</button></div></section></div>`;
    $$("[data-flt]").forEach((b) => (b.onclick = () => { st.filter = b.dataset.flt; step2(); }));
    $("#iRemap").onclick = () => { $$("[data-map]").forEach((s) => (st.mapping[s.dataset.map] = s.value || undefined)); for (const k of Object.keys(st.mapping)) if (!st.mapping[k]) delete st.mapping[k]; preview(); };
    $("#iBack").onclick = step1;
    const acc = $("#iAccept"); if (acc) acc.onclick = () => { for (const r of reviewRows) if (r.match && r.match.proposal) st.decisions[r.line] = { action: "link", player_id: r.match.proposal }; step2(); };
    rows();
    $("#iCommit").onclick = confirmCommit;
  }
  function rows() {
    const p = st.plan;
    const list = p.rows.filter((r) => !st.filter || r.status === st.filter).slice(0, 400);
    $("#iRows").innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Line</th><th>Player</th><th>Status</th><th>What will happen</th></tr></thead><tbody>${list.map((r) => `<tr><td class="n">${r.line}</td><td>${esc(r.label)}${r.match && r.match.how ? `<div class="faint small">matched by ${esc(r.match.how)}</div>` : ""}</td>
      <td class="st-${esc(r.status)}"><b>${esc({ new: "new", update: "update", review: "needs decision", duplicate: "already in FUEL", error: "error" }[r.status] || r.status)}</b></td>
      <td>${decision(r)}${describe(r)}${(r.issues || []).map((i) => `<div class="issue ${esc(i.level)}">${i.level === "error" ? "✕" : i.level === "warn" ? "!" : "·"} ${esc(i.text)}</div>`).join("")}</td></tr>`).join("")}</tbody></table>${p.rows.length > 400 ? `<div class="empty">Showing the first 400 of ${p.rows.length} rows.</div>` : ""}` : '<div class="empty">No rows in this view.</div>';
    $$("[data-dec]").forEach((s) => (s.onchange = () => { const line = +s.dataset.dec; const v = s.value; st.decisions[line] = !v ? undefined : v === "new" ? { action: "new" } : v === "skip" ? { action: "skip" } : v === "keep" ? { action: "keep" } : { action: "link", player_id: v }; if (!v) delete st.decisions[line]; step2(); }));
  }
  function decision(r) {
    if (r.status !== "review") return "";
    const d = st.decisions[r.line] || {};
    const cur = d.action === "link" ? d.player_id : d.action || "";
    if (st.kind === "performance") return `<select data-dec="${r.line}" aria-label="Decision for line ${r.line}"><option value="">Decide…</option><option value="keep"${cur === "keep" ? " selected" : ""}>Keep both values</option><option value="skip"${cur === "skip" ? " selected" : ""}>Skip this row</option></select>`;
    const c = (r.match && r.match.candidates) || [];
    return `<select data-dec="${r.line}" aria-label="Decision for line ${r.line}" style="max-width:100%;margin-bottom:4px"><option value="">Decide…</option>${c.map((x) => `<option value="${esc(x.player.id)}"${cur === x.player.id ? " selected" : ""}>Same player: ${esc(playerName(x.player))}${x.player.external_id ? " (ID " + esc(x.player.external_id) + ")" : ""} — ${esc(x.why)}</option>`).join("")}<option value="new"${cur === "new" ? " selected" : ""}>A different player — create new</option><option value="skip"${cur === "skip" ? " selected" : ""}>Skip this row</option></select>${r.match && r.match.note ? `<div class="issue warn">! ${esc(r.match.note)}</div>` : ""}`;
  }
  function describe(r) {
    const out = [];
    if (r.player_action === "create") out.push("create player");
    if (r.status === "update" && r.changes) out.push("update: " + Object.entries(r.changes).map(([k, c]) => `${k} ${c.from ?? "—"} → ${c.to}`).join(", "));
    const recs = (r.records || []).filter((x) => !x.duplicate);
    if (recs.length) { const c = {}; for (const x of recs) c[x.table] = (c[x.table] || 0) + 1; out.push("add " + Object.entries(c).map(([t, n]) => `${n} ${{ weights: "weight", dexa: "DEXA", hydration: "hydration", protocols: "protocol", goals: "goal", interactions: "note", performance: "measurement" }[t] || t}${n > 1 ? "s" : ""}`).join(", ")); }
    const undated = recs.filter((x) => x.table === "interactions" && !x.date).length;
    if (undated) out.push(`${undated} note${undated > 1 ? "s" : ""} with date unknown`);
    return out.length ? `<div class="small">${esc(out.join(" · "))}</div>` : "";
  }
  function confirmCommit() {
    const p = st.plan, sm = p.summary;
    const reviewRows = p.rows.filter((r) => r.status === "review");
    const decided = reviewRows.filter((r) => st.decisions[r.line]).length;
    const m = openModal(`<header><h2 id="modalTitle">Import ${esc(KINDS[st.kind].toLowerCase())}?</h2><button class="x" data-close aria-label="Close">×</button></header><div class="mb">
      <ul class="small" style="margin:0 0 10px;padding-left:18px"><li>${sm.new || 0} new / ${sm.update || 0} updated rows; about ${sm.records || 0} records added</li><li>${sm.duplicate || 0} rows already in FUEL — skipped</li><li>${sm.error || 0} rows with errors — skipped</li>${reviewRows.length ? `<li>${decided} of ${reviewRows.length} name matches decided; undecided rows skipped</li>` : ""}</ul>
      <div class="callout">Nothing existing is overwritten. The import is recorded as one batch, with its source rows, and an administrator can roll it back.</div><div class="err" id="cErr" role="alert"></div></div>
      <footer><button class="btn ghost" data-close>Cancel</button><button class="btn accent" id="cGo">Import now</button></footer>`);
    $("#cGo", m).onclick = async () => {
      $("#cGo", m).disabled = true;
      try {
        const r = await api("POST", "import.commit", { body: { kind: st.kind, csv: st.csv, mapping: st.mapping, options: st.options, decisions: st.decisions, filename: st.filename } });
        invalidate(); closeModal(); done(r);
      } catch (e) { $("#cErr", m).textContent = e.message; $("#cGo", m).disabled = false; }
    };
  }
  function done(r) {
    const c = r.counts;
    host.innerHTML = `${steps(3)}<section class="panel"><header><h2>Import complete</h2></header><div class="body">
      <div class="stat"><div><div class="v">${c.players_created}</div><div class="l">players created</div></div><div><div class="v">${c.players_updated}</div><div class="l">players updated</div></div><div><div class="v">${c.records}</div><div class="l">records added</div></div><div><div class="v">${c.duplicates}</div><div class="l">duplicates skipped</div></div><div><div class="v">${c.skipped}</div><div class="l">rows skipped</div></div><div><div class="v">${c.errors}</div><div class="l">rows with errors</div></div></div>
      <div class="row"><a class="btn" href="#/data/history">Import history</a><a class="btn primary" href="#/players">Go to players</a><button class="btn" id="dAgain">Import another file</button></div></div></section>`;
    $("#dAgain").onclick = () => importer(host);
  }
}
function unmapped(p, mapping) {
  const used = new Set(Object.values(mapping || {}));
  const left = p.headers.filter((h) => h && !used.has(h));
  return left.length ? `<p class="small muted" style="margin:8px 0 0">Columns not used: ${left.map(esc).join(", ")}</p>` : `<p class="small" style="margin:8px 0 0;color:var(--good)">Every column in the file is mapped.</p>`;
}
function guide(kind) {
  if (kind === "roster") return `<p>Creates or updates players. <b>Player ID</b> is the matching key; without it, a same-name player is only suggested for you to confirm. Re-importing the same roster changes nothing. Changing a player's affiliate closes the old assignment and opens a new one — nutrition history is never touched. Blank cells never erase existing values.</p><p><a href="templates/roster-template.csv" download>Download the roster template</a></p>`;
  if (kind === "legacy") return `<p>Every column of the current Excel tracker lands somewhere:</p><ul style="padding-left:18px;margin:0"><li><b>Current Weight + date</b> → a dated weight</li><li><b>DEXA BF%, LM, FM, ALM + date</b> → a DEXA assessment</li><li><b>Hydration card, fluid loss, Na loss</b> → a hydration assessment; <b>Vitamin D</b> → a protocol record</li><li><b>Goal Weight, Body Comp Goal, Pre-Season Bullets</b> → goals (goal / strengths / weakness / maintain)</li><li><b>History</b> → a historical note; <b>Week 5 Goal Check-In's</b> → a check-in note</li><li><b>Nutrition Actions + both continuation columns</b> → one note per dated entry, keeping the wording, date and initials</li></ul><p>Missing dates stay “date unknown” — never guessed. Save the sheet as CSV (File → Save As → CSV UTF-8).</p><p><a href="templates/legacy-nutrition-template.csv" download>Download the legacy template / mapping example</a></p>`;
  return `<p>Bat speed, exit velocity and pitch velocity, in mph, each with its definition (average, p90, max, average_fastball…). Every row must match an existing <b>Player ID</b> — unknown IDs are reported, never created. Re-importing skips rows already in FUEL; a different value for the same date and definition is flagged for you, never written over.</p><p><a href="templates/performance-template.csv" download>Download the performance template</a></p>`;
}

async function history(host) {
  const list = await api("GET", "imports");
  host.innerHTML = `<section class="panel"><div class="tblwrap" id="hT"></div></section>`;
  table($("#hT"), { rows: list, empty: "No imports yet.", cols: [
    { key: "created_at", label: "When", sort: (r) => r.created_at, render: (r) => esc(new Date(r.created_at).toLocaleString()) },
    { key: "kind", label: "Type", render: (r) => esc(KINDS[r.kind]) },
    { key: "filename", label: "File", render: (r) => esc(r.filename || "") },
    { key: "created_by", label: "By", render: (r) => esc(r.created_by) },
    { key: "counts", label: "Result", render: (r) => `<span class="small">${r.counts.players_created} new players · ${r.counts.players_updated} updated · ${r.counts.records} records · ${r.counts.duplicates} duplicates · ${r.counts.skipped + r.counts.errors} skipped</span>` },
    { key: "status", label: "Status", render: (r) => r.status === "rolled_back" ? `<span class="tag ghost">rolled back</span>` : '<span class="tag good">committed</span>' },
    { key: "act", label: "", render: (r) => r.status === "committed" && can("rollback") ? `<button class="btn sm danger" data-rb="${esc(r.id)}">Roll back</button>` : "" },
  ] });
  $$("[data-rb]").forEach((b) => (b.onclick = () => {
    const m = openModal(`<header><h2 id="modalTitle">Roll back this import?</h2><button class="x" data-close aria-label="Close">×</button></header><div class="mb"><p>Removes everything this import added and restores what it changed. It's refused if staff have since added records to players it created or edited its records.</p><div class="err" id="rbErr" role="alert"></div></div><footer><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="rbGo">Roll back</button></footer>`);
    $("#rbGo", m).onclick = async () => { try { await api("POST", "import.rollback", { body: { id: b.dataset.rb } }); invalidate(); closeModal(); toast("Import rolled back"); history(host); } catch (e) { $("#rbErr", m).textContent = e.message; } };
  }));
}

function exporter(host) {
  const tables = [["players", "Players", "read"], ["assignments", "Affiliate assignments", "read"], ["weights", "Weights", "read"], ["dexa", "DEXA assessments", "read"], ["goals", "Goals", "read"], ["performance", "Performance", "read"], ["interactions", "Nutrition notes", "read_notes"], ["followups", "Follow-ups", "read_notes"], ["hydration", "Hydration (restricted)", "read_protocols"], ["protocols", "Protocols (restricted)", "read_protocols"]].filter((t) => can(t[2]));
  host.innerHTML = `<section class="panel"><header><h2>Download data as CSV</h2></header><div class="body"><p class="small muted" style="margin-top:0">Only what your role may see is included. Every export is recorded in the audit log${mode === "demo" ? "" : " with your name"}. Store exported files according to your organization's data policy.</p>
    <div class="row">${tables.map(([k, l]) => `<button class="btn" data-ex="${k}">${esc(l)}</button>`).join("")}</div></div></section>
    <section class="panel"><header><h2>Templates</h2></header><div class="body row"><a class="btn" href="templates/roster-template.csv" download>Roster template</a><a class="btn" href="templates/legacy-nutrition-template.csv" download>Legacy nutrition template</a><a class="btn" href="templates/performance-template.csv" download>Performance template</a></div></section>`;
  $$("[data-ex]").forEach((b) => (b.onclick = async () => { try { const r = await api("GET", "export", { params: { table: b.dataset.ex } }); download(r.filename, r.csv); toast("Exported — recorded in the audit log"); } catch (e) { errToast(e); } }));
}

async function auditLog(host) {
  const list = await api("GET", "audit", { params: { limit: 500 } });
  host.innerHTML = `<section class="panel"><header><h2>Audit log</h2><span class="count">latest ${list.length}</span></header><div class="tblwrap" id="aT"></div></section>`;
  table($("#aT"), { rows: list, cols: [
    { key: "at", label: "When", sort: (r) => r.at, render: (r) => esc(new Date(r.at).toLocaleString()) },
    { key: "user", label: "Who", render: (r) => `${esc(r.user_name || r.user)} <span class="faint small">${esc(r.role || "")}</span>` },
    { key: "action", label: "Action", render: (r) => `<span class="tag ${r.action === "export" ? "orange" : r.action === "void" || r.action === "rollback" ? "warn" : "navy"}">${esc(r.action)}</span>` },
    { key: "player_name", label: "Player", render: (r) => r.player_id ? `<a class="pname" href="#/player/${esc(r.player_id)}">${esc(r.player_name || "")}</a>` : "" },
    { key: "summary", label: "Detail", render: (r) => esc(r.summary) },
  ] });
}

function demo(host) {
  host.innerHTML = `<section class="panel"><header><h2>Demo data</h2></header><div class="body"><p>This sandbox runs entirely in your browser on <b>synthetic players</b> — names, IDs, phone numbers (555-01xx), weights, scans, notes and performance values are all generated. Nothing here is real Astros information, and nothing leaves this browser.</p>
    <p>Resetting deletes everything stored by the FUEL demo in this browser (including anything you added or imported) and regenerates the synthetic roster.</p><button class="btn danger" id="dReset">Reset demo data</button></div></section>`;
  $("#dReset").onclick = () => { const m = openModal(`<header><h2 id="modalTitle">Reset demo data?</h2><button class="x" data-close aria-label="Close">×</button></header><div class="mb">Everything stored by the FUEL demo in this browser is deleted and the synthetic roster is regenerated.</div><footer><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="dGo">Reset</button></footer>`);
    $("#dGo", m).onclick = async () => { await resetDemo(); invalidate(); closeModal(); toast("Demo data regenerated"); location.hash = "#/home"; }; };
}
