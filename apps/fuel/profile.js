/* FUEL — the player profile. */
import { api } from "./api.js";
import { METRICS, PHYSICAL, GOAL_TYPES, INTERACTION_TYPES, toLb, metricLabel, isPitcher } from "./shared/model.js";
import { addDays, daysBetween, isISODate, round } from "./shared/util.js";
import { analyze, MIN_PAIRS, STABLE_PAIRS } from "./shared/stats.js";
import { timeChart, scatter, sparkline } from "./charts.js";
import { $, $$, esc, S, can, toast, errToast, fmtDate, relDay, w, delta, playerName, openModal, closeModal, today, invalidate, table } from "./ui.js";
import { openQuickEntry } from "./quickentry.js";

const TABS = [["overview", "Overview"], ["body", "Weight & Body Comp"], ["goals", "Goals"], ["hydration", "Hydration & Protocols"], ["comms", "Communication"], ["performance", "Performance"]];
const live = (r) => !r.voided;
const lb = (r, k = "weight") => toLb(r[k], r.unit);
let P = null; // the loaded profile
let VIEW = { host: null, id: null, tab: "overview" };

export async function renderProfile(host, id, tab = "overview") {
  host.innerHTML = `<div class="loading">Loading…</div>`;
  try { P = await api("GET", "player", { params: { id } }); } catch (e) { host.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)} <a href="#/players">Back to players</a></div></div>`; return; }
  if (!TABS.some(([k]) => k === tab)) tab = "overview";
  VIEW = { host, id, tab };
  const p = P.player;
  const ws = P.weights.filter((x) => live(x) && x.date);
  const lastW = ws[ws.length - 1];
  const dx = P.dexa.filter((x) => live(x) && x.date);
  const lastD = dx[dx.length - 1];
  const gw = P.goals.filter((g) => g.type === "weight" && g.status === "active" && g.target_value != null).pop();
  const lastI = (P.interactions || []).filter((i) => live(i) && i.date).pop();
  const w30 = ws.filter((x) => x.date >= addDays(today(), -30));
  const ch30 = w30.length > 1 ? lb(w30[w30.length - 1]) - lb(w30[0]) : null;
  host.innerHTML = `
    <section class="phead">
      <div>
        <div class="row" style="gap:10px;align-items:baseline"><h1>${esc(playerName(p))}</h1>${p.status && p.status !== "active" ? `<span class="tag warn">${esc(p.status)}</span>` : ""}</div>
        <div class="meta">
          <span class="tag navy">${esc(p.position || "—")}</span><span>${esc(p.affiliate || "No affiliate")}</span><span class="sep">|</span>
          <span>${p.dob ? `${esc(fmtDate(p.dob))} · age ${esc(p.age)}` : "DOB not on file"}</span><span class="sep">|</span>
          <span>B/T ${esc(p.bats || "–")}/${esc(p.throws || "–")}${p.height ? " · " + esc(p.height) : ""}</span><span class="sep">|</span>
          <span class="muted">Player ID ${esc(p.external_id || "— (none on file)")}</span>
          ${!P.restricted.contact && (p.phone || p.whatsapp) ? `<span class="sep">|</span><span class="muted">${p.phone ? "Mobile " + esc(p.phone) : ""}${p.whatsapp ? " · WhatsApp " + esc(p.whatsapp) : ""}</span>` : ""}
        </div>
        <div class="figs">
          <div class="fig"><div class="v num">${lastW ? `${w(lastW.weight)}<small>${esc(lastW.unit)}</small>` : "—"}</div><div class="l">Current weight · ${lastW ? esc(relDay(lastW.date)) : "no weigh-in"} ${ch30 != null ? "· 30d " + delta(ch30, "lb", { neutral: true }) : ""}</div></div>
          <div class="fig"><div class="v num">${gw ? `${w(gw.target_value)}<small>${esc(gw.target_unit || "lb")}</small>` : "—"}</div><div class="l">Goal weight ${gw && lastW ? "· " + delta(lb(lastW) - toLb(gw.target_value, gw.target_unit), "lb from goal", { invert: true }) : ""}</div></div>
          <div class="fig"><div class="v num">${lastD && lastD.body_fat_pct != null ? `${lastD.body_fat_pct}<small>%</small>` : "—"}</div><div class="l">DEXA body fat · ${lastD ? esc(fmtDate(lastD.date)) : "no scan"}</div></div>
          <div class="fig"><div class="v num" style="font-size:16px;line-height:1.6">${P.restricted.notes ? '<span class="muted">restricted</span>' : lastI ? esc(relDay(lastI.date)) : "—"}</div><div class="l">Last interaction${lastI && !P.restricted.notes ? " · " + esc(INTERACTION_TYPES[lastI.type] || "") : ""}</div></div>
        </div>
      </div>
      <div class="row no-print" style="justify-content:flex-end">
        ${can("write_nutrition") ? `<button class="btn accent" id="pQE" type="button">+ Quick Entry</button>` : ""}
        ${can("write_players") ? `<button class="btn" id="pEdit" type="button">Edit / move</button>` : ""}
        <button class="btn" id="pPrint" type="button" title="Print or save a one-page summary">Print summary</button>
      </div>
    </section>
    <nav class="tabs no-print" role="tablist">${TABS.map(([k, l]) => `<a href="#/player/${esc(p.id)}/${k}" role="tab" aria-selected="${k === tab}" class="${k === tab ? "on" : ""}">${esc(l)}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  const qe = $("#pQE"); if (qe) qe.onclick = () => openQuickEntry(p);
  const ed = $("#pEdit"); if (ed) ed.onclick = () => editPlayer(p);
  $("#pPrint").onclick = () => { location.hash = `#/player/${p.id}/overview`; setTimeout(() => window.print(), 300); };
  ({ overview, body, goals, hydration, comms, performance })[tab]($("#tab"));
}
/* re-render this profile in place (keeps scroll position and any open dialog, e.g. Quick Entry's "add another") */
const reload = () => { if (VIEW.host && location.hash.startsWith("#/player/")) { const y = window.scrollY; renderProfile(VIEW.host, VIEW.id, VIEW.tab).then(() => window.scrollTo(0, y)); } };
window.addEventListener("fuel:saved", (e) => { if (P && e.detail && e.detail.player_id === P.player.id && location.hash.startsWith("#/player/")) reload(); });

/* ------------------------------------------------------------------ overview */
function overview(host) {
  const ws = P.weights.filter((x) => live(x) && x.date && x.date >= addDays(today(), -120));
  const gw = P.goals.filter((g) => g.type === "weight" && g.status === "active" && g.target_value != null).pop();
  const dx = P.dexa.filter((x) => live(x) && x.date);
  const [d1, d2] = [dx[dx.length - 2], dx[dx.length - 1]];
  const goals = P.goals.filter((g) => g.status === "active");
  const fus = (P.followups || []).filter((f) => f.status === "open");
  const notes = (P.interactions || []).filter(live).slice(-4).reverse();
  const perf = latestPerf();
  host.innerHTML = `<div class="grid2">
    <div class="stack">
      <section class="panel"><header><h2>Weight — last 120 days</h2><span class="sp"></span><a class="btn ghost sm no-print" href="#/player/${P.player.id}/body">All measurements →</a></header><div class="body"><div id="ovW"></div>
        <p class="muted small" style="margin:6px 0 0">Points are real weigh-ins; the line breaks where more than 10 days passed without one.</p></div></section>
      <section class="panel"><header><h2>Body composition (DEXA)</h2><span class="count">${dx.length} scan${dx.length === 1 ? "" : "s"}</span></header>
        ${d2 ? `<table class="tbl"><thead><tr><th></th><th class="n">${d1 ? esc(fmtDate(d1.date)) : ""}</th><th class="n">${esc(fmtDate(d2.date))}</th><th class="n">Change</th></tr></thead><tbody>
        ${[["Body fat", "body_fat_pct", "%"], ["Lean mass", "lean_mass", d2.unit], ["Fat mass", "fat_mass", d2.unit], ["App. lean mass", "alm", d2.unit]].map(([l, k, u]) => `<tr><td>${l}</td><td class="n">${d1 && d1[k] != null ? d1[k] : "—"}</td><td class="n">${d2[k] != null ? d2[k] + " " + esc(u) : "—"}</td><td class="n">${d1 && d1[k] != null && d2[k] != null ? delta(d2[k] - d1[k], u === "%" ? "pts" : u, { invert: k === "body_fat_pct" || k === "fat_mass" }) : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">No DEXA scans on file.</div>`}</section>
      <section class="panel"><header><h2>Performance snapshot</h2></header>${perf.length ? `<table class="tbl"><tbody>${perf.map((x) => `<tr><td>${esc(metricLabel(x.metric, x.definition))}</td><td class="n">${x.value} mph</td><td class="muted small">${esc(fmtDate(x.date))}</td><td class="n">${x.prev ? delta(x.value - x.prev.value, "mph") : ""}</td></tr>`).join("")}</tbody></table><p class="muted small" style="margin:0;padding:6px 12px 10px">Change vs. the previous measurement with the same definition.</p>` : `<div class="empty">No performance measurements yet.</div>`}</section>
    </div>
    <div class="stack">
      <section class="panel"><header><h2>Active goals</h2><span class="count">${goals.length}</span><span class="sp"></span><a class="btn ghost sm no-print" href="#/player/${P.player.id}/goals">Goals →</a></header>
        ${goals.length ? `<ul class="list">${goals.map((g) => `<li><span class="tag ${g.type === "weakness" ? "warn" : g.type === "strength" ? "good" : "navy"}">${esc(GOAL_TYPES[g.type])}</span><span>${esc(g.description)}${g.type === "weight" && g.target_value != null ? goalProgress(g) : ""}</span></li>`).join("")}</ul>` : `<div class="empty">No active goals.</div>`}</section>
      ${P.followups ? `<section class="panel"><header><h2>Open follow-ups</h2><span class="count">${fus.length}</span></header>${fus.length ? `<ul class="list">${fus.map((f) => `<li><span class="d">${esc(fmtDate(f.due_date, { year: false }))}</span><span class="grow">${esc(f.description)}</span>${f.due_date < today() ? '<span class="tag bad">overdue</span>' : ""}${can("write_nutrition") ? `<button class="btn sm no-print" data-done="${esc(f.id)}">Done</button>` : ""}</li>`).join("")}</ul>` : `<div class="empty">Nothing open.</div>`}</section>` : ""}
      ${P.interactions ? `<section class="panel"><header><h2>Recent interactions</h2><span class="sp"></span><a class="btn ghost sm no-print" href="#/player/${P.player.id}/comms">Timeline →</a></header>${notes.length ? `<ul class="tl" style="padding:0 12px">${notes.map((i) => noteItem(i)).join("")}</ul>` : `<div class="empty">No notes yet.</div>`}</section>` : `<section class="panel"><div class="empty"><span class="lock">🔒 Nutrition notes are restricted for your role</span></div></section>`}
      <section class="panel"><header><h2>Affiliate history</h2></header><ul class="list">${P.assignments.slice().reverse().map((a) => `<li><span class="grow">${esc(a.affiliate)}</span><span class="muted small">${esc(fmtDate(a.start_date))} – ${a.end_date ? esc(fmtDate(a.end_date)) : "present"}</span></li>`).join("") || '<li class="muted">No assignments recorded.</li>'}</ul></section>
    </div></div>`;
  timeChart($("#ovW"), { series: [{ label: "Body weight", color: "#002D62", unit: "lb", points: ws.map((x) => ({ date: x.date, value: round(lb(x)), tip: x.note || "" })), join: 10 }], from: addDays(today(), -120), to: today(), height: 210,
    refLines: gw ? [{ value: toLb(gw.target_value, gw.target_unit), label: `goal ${gw.target_value} ${gw.target_unit || "lb"}`, color: "#EB6E1F" }] : [] });
  $$("[data-done]", host).forEach((b) => (b.onclick = async () => { try { await api("POST", "followup.update", { body: { id: b.dataset.done, status: "completed" } }); invalidate(); toast("Follow-up completed"); reload(); } catch (e) { errToast(e); } }));
}
function goalProgress(g) {
  const ws = P.weights.filter((x) => live(x) && x.date);
  if (!ws.length) return "";
  const start = g.start_date ? ws.filter((x) => x.date >= g.start_date)[0] || ws[0] : ws[0], now = ws[ws.length - 1];
  const tgt = toLb(g.target_value, g.target_unit), from = lb(start), cur = lb(now);
  if (Math.abs(tgt - from) < 0.5) return ` <span class="muted small">· now ${w(cur)} lb</span>`;
  const pct = Math.max(0, Math.min(1, (cur - from) / (tgt - from)));
  return ` <span class="muted small">· ${w(from)} → ${w(cur)} lb (${Math.round(pct * 100)}% of the way)</span>`;
}
function latestPerf() {
  const by = {};
  for (const x of P.performance.filter(live)) (by[x.metric + "|" + x.definition] = by[x.metric + "|" + x.definition] || []).push(x);
  return Object.values(by).map((s) => { s.sort((a, b) => a.date.localeCompare(b.date)); return { ...s[s.length - 1], prev: s[s.length - 2] }; });
}
function noteItem(i, q) {
  const hl = (t) => { const e = esc(t); if (!q) return e; const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); return e.replace(re, (m) => `<mark>${m}</mark>`); };
  return `<li class="item${i.voided ? " void" : ""}" data-id="${esc(i.id)}"><div class="when">${i.date ? esc(fmtDate(i.date, { year: false })) : "Date unknown"}${i.time ? `<small>${esc(i.time)}</small>` : ""}${i.date ? `<small>${esc(i.date.slice(0, 4))}</small>` : ""}</div>
    <div><div class="row" style="gap:6px;margin-bottom:3px"><span class="tag ${i.type === "history" ? "ghost" : "navy"}">${esc(i.title || INTERACTION_TYPES[i.type] || i.type)}</span>${i.source && i.source.kind === "legacy" ? `<span class="tag ghost" title="Imported from ${esc(i.source.column || "")}">imported · ${esc(i.source.column || "")}</span>` : ""}${i.source && i.source.kind === "quick_entry" ? '<span class="tag ghost">quick entry</span>' : ""}${i.voided ? `<span class="tag bad">void: ${esc(i.void_reason)}</span>` : ""}</div>
    <div class="txt">${hl(i.text)}</div>
    <div class="by">${esc(i.author_name || i.author_initials || (i.source && i.source.kind === "legacy" ? "author unknown" : i.author || ""))}${i.history && i.history.length ? ` · <button class="btn ghost sm" data-hist="${esc(i.id)}">edited ${i.history.length}× — show earlier versions</button>` : ""}${can("write_nutrition") && !i.voided ? ` · <button class="btn ghost sm no-print" data-edit="${esc(i.id)}">Edit</button>` : ""}</div></div></li>`;
}

/* ------------------------------------------------------------------ weight & body composition */
function body(host) {
  const win = sessionStorage.getItem("fuel:win") || "180";
  const from = win === "all" ? null : addDays(today(), -+win);
  const ws = P.weights.filter((x) => live(x) && x.date && (!from || x.date >= from));
  const gw = P.goals.filter((g) => g.type === "weight" && g.status === "active" && g.target_value != null).pop();
  const dx = P.dexa.filter((x) => live(x) && x.date && (!from || x.date >= from));
  host.innerHTML = `
    <div class="filters"><span class="k">Window</span><div class="seg" id="win">${[["30", "30 d"], ["90", "90 d"], ["180", "180 d"], ["365", "1 yr"], ["all", "All"]].map(([k, l]) => `<button type="button" data-w="${k}" class="${k === win ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <section class="panel"><header><h2>Body weight</h2><span class="count">${ws.length} weigh-ins</span></header><div class="body">
      <div class="legend"><span><i style="background:#002D62"></i>Weigh-in (lb)</span>${gw ? `<span><i style="background:#EB6E1F;border-radius:0;height:2px;width:14px;vertical-align:3px"></i>Goal ${esc(gw.target_value)} ${esc(gw.target_unit || "lb")}</span>` : ""}<span class="muted">Line breaks where >10 days passed with no weigh-in</span></div>
      <div id="wChart"></div></div></section>
    <div class="grid2" style="margin-top:14px">
      <section class="panel"><header><h2>Weight measurements</h2><span class="sp"></span>${can("write_nutrition") ? '<button class="btn sm primary no-print" id="addW">+ Weight</button>' : ""}</header><div class="tblwrap short" id="wTable"></div></section>
      <section class="panel"><header><h2>DEXA assessments</h2><span class="sp"></span>${can("write_nutrition") ? '<button class="btn sm primary no-print" id="addD">+ DEXA</button>' : ""}</header><div class="body" id="dCharts"></div><div class="tblwrap short" id="dTable"></div></section>
    </div>`;
  $$("#win button").forEach((b) => (b.onclick = () => { sessionStorage.setItem("fuel:win", b.dataset.w); body(host); }));
  timeChart($("#wChart"), { series: [{ label: "Body weight", color: "#002D62", unit: "lb", points: ws.map((x) => ({ date: x.date, value: round(lb(x)), tip: [x.note, (x.source || {}).kind].filter(Boolean).join(" · ") })), join: 10 }], from: from || undefined, to: today(),
    refLines: gw ? [{ value: toLb(gw.target_value, gw.target_unit), label: "goal", color: "#EB6E1F" }] : [] });
  const all = P.weights.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.created_at.localeCompare(a.created_at));
  table($("#wTable"), { rows: all.map((x, i) => ({ ...x, __cls: x.voided ? "void" : "" })), cols: [
    { key: "date", label: "Measured", render: (r) => r.date ? esc(fmtDate(r.date)) : '<span class="tag warn">date unknown</span>' },
    { key: "weight", label: "Weight", cls: "n", render: (r) => `${w(r.weight)} ${esc(r.unit)}` },
    { key: "chg", label: "Δ prev", cls: "n", render: (r) => { if (r.voided || !r.date) return ""; const prev = all.filter((x) => live(x) && x.date && x.date < r.date)[0]; return prev ? delta(lb(r) - lb(prev), "", { neutral: true }) : ""; } },
    { key: "note", label: "Note / source", render: (r) => `${esc(r.note || "")} <span class="muted small">${esc((r.source || {}).kind || "")}</span>${r.voided ? ` <span class="tag bad">void: ${esc(r.void_reason)}</span>` : ""}` },
    { key: "by", label: "", cls: "keep", render: (r) => !r.voided && can("write_nutrition") ? `<button class="btn ghost sm" data-void="weights:${esc(r.id)}">Void</button>` : "" },
  ], empty: "No weigh-ins recorded." });
  // DEXA small multiples on real scan dates
  const dAll = P.dexa.filter((x) => live(x) && x.date);
  $("#dCharts").innerHTML = dAll.length ? `<div class="grid2" style="gap:8px">${["lean_mass", "body_fat_pct", "fat_mass", "alm"].map((k) => `<div><div class="k">${esc({ lean_mass: "Lean mass (lb)", body_fat_pct: "Body fat %", fat_mass: "Fat mass (lb)", alm: "App. lean mass (lb)" }[k])}</div><div data-dc="${k}"></div></div>`).join("")}</div><p class="muted small" style="margin:4px 0 0">Each point is a scan on its real date; lines only join scans ≤ 150 days apart.</p>` : "";
  for (const k of ["lean_mass", "body_fat_pct", "fat_mass", "alm"]) { const el = $(`[data-dc="${k}"]`); if (el) timeChart(el, { series: [{ label: k, color: "#0B3D7A", unit: k === "body_fat_pct" ? "%" : "lb", points: dAll.filter((x) => x[k] != null).map((x) => ({ date: x.date, value: k === "body_fat_pct" ? x[k] : round(toLb(x[k], x.unit)) })), join: 150, shape: "diamond" }], height: 150 }); }
  const dl = P.dexa.slice().reverse();
  table($("#dTable"), { rows: dl.map((x) => ({ ...x, __cls: x.voided ? "void" : "" })), cols: [
    { key: "date", label: "Scan", render: (r) => r.date ? esc(fmtDate(r.date)) : '<span class="tag warn">date unknown</span>' },
    { key: "body_fat_pct", label: "BF%", cls: "n", render: (r) => r.body_fat_pct ?? "—" },
    { key: "lean_mass", label: "Lean", cls: "n", render: (r) => r.lean_mass ?? "—" },
    { key: "fat_mass", label: "Fat", cls: "n", render: (r) => r.fat_mass ?? "—" },
    { key: "alm", label: "ALM", cls: "n", render: (r) => r.alm ?? "—" },
    { key: "unit", label: "Unit", render: (r) => esc(r.unit) + ((r.source || {}).kind === "legacy" ? ' <span class="tag ghost">imported</span>' : "") },
    { key: "v", label: "", cls: "keep", render: (r) => !r.voided && can("write_nutrition") ? `<button class="btn ghost sm" data-void="dexa:${esc(r.id)}">Void</button>` : r.voided ? `<span class="tag bad">void</span>` : "" },
  ], empty: "No DEXA assessments recorded." });
  wireVoid(host);
  const aw = $("#addW"); if (aw) aw.onclick = () => formModal("Add a weight", `
    <div class="row"><div class="f"><label for="fD">Measured on</label><input type="date" id="fD" value="${today()}" max="${addDays(today(), 1)}" required></div>
    <div class="f"><label for="fW">Weight</label><input type="number" id="fW" step="0.1" class="w110" autofocus required inputmode="decimal"></div>
    <div class="f"><label for="fU">Unit</label><select id="fU" class="w80"><option>lb</option><option>kg</option></select></div></div>
    <div class="f"><label for="fN">Note <span class="muted">(optional)</span></label><input type="text" id="fN" placeholder="e.g. post-workout, home scale"></div>`,
    () => api("POST", "weight", { body: { player_id: P.player.id, date: $("#fD").value, weight: $("#fW").value, unit: $("#fU").value, note: $("#fN").value } }), "Weight saved");
  const ad = $("#addD"); if (ad) ad.onclick = () => formModal("Add a DEXA assessment", `
    <div class="row"><div class="f"><label for="fD">Scan date</label><input type="date" id="fD" value="${today()}" required></div><div class="f"><label for="fU">Mass unit</label><select id="fU" class="w80"><option>lb</option><option>kg</option></select></div>
    <div class="f grow"><label for="fS">Source <span class="muted">(optional)</span></label><input type="text" id="fS" placeholder="e.g. Minute Maid Park clinic"></div></div>
    <div class="row"><div class="f"><label for="fBF">Body fat %</label><input type="number" id="fBF" step="0.1" class="w110" autofocus></div><div class="f"><label for="fLM">Lean mass</label><input type="number" id="fLM" step="0.1" class="w110"></div>
    <div class="f"><label for="fFM">Fat mass</label><input type="number" id="fFM" step="0.1" class="w110"></div><div class="f"><label for="fALM">App. lean mass</label><input type="number" id="fALM" step="0.1" class="w110"></div></div>
    <div class="f"><label for="fN">Note <span class="muted">(optional)</span></label><input type="text" id="fN"></div>`,
    () => api("POST", "dexa", { body: { player_id: P.player.id, date: $("#fD").value, unit: $("#fU").value, source_label: $("#fS").value, body_fat_pct: $("#fBF").value, lean_mass: $("#fLM").value, fat_mass: $("#fFM").value, alm: $("#fALM").value, note: $("#fN").value } }), "DEXA saved");
}
function wireVoid(host) {
  $$("[data-void]", host).forEach((b) => (b.onclick = () => {
    const [t, id] = b.dataset.void.split(":");
    formModal("Void this record", `<p class="muted" style="margin:0">The record stays in the history, marked void, and stops counting in charts and reports. It is never deleted or overwritten.</p><div class="f"><label for="fR">Reason</label><input type="text" id="fR" autofocus placeholder="e.g. entered for the wrong player"></div>`,
      () => api("POST", "void", { body: { table: t, id, reason: $("#fR").value } }), "Record voided");
  }));
}
function formModal(title, inner, submit, ok) {
  const m = openModal(`<header><h2 id="modalTitle">${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></header><form class="mb form" id="fm">${inner}<div class="err" id="fErr" role="alert"></div></form><footer><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" type="submit" form="fm">Save</button></footer>`);
  $("#fm", m).onsubmit = async (e) => { e.preventDefault(); try { await submit(); invalidate(); closeModal(); toast(ok); reload(); } catch (err) { $("#fErr", m).textContent = err.message; } };
}

/* ------------------------------------------------------------------ goals */
function goals(host) {
  const act = P.goals.filter((g) => g.status === "active"), past = P.goals.filter((g) => g.status !== "active");
  const row = (g) => `<li style="display:block"><div class="row" style="gap:8px"><span class="tag ${g.status === "active" ? "navy" : g.status === "achieved" ? "good" : "ghost"}">${esc(GOAL_TYPES[g.type])}</span><b class="grow">${esc(g.description)}</b>
      ${g.status === "active" && can("write_nutrition") ? `<select class="no-print" data-gs="${esc(g.id)}" aria-label="Goal status" style="height:28px"><option value="">Set status…</option><option value="achieved">Achieved</option><option value="revised">Revised</option><option value="discontinued">Discontinued</option></select><button class="btn ghost sm no-print" data-gp="${esc(g.id)}">+ Progress note</button>` : `<span class="tag ghost">${esc(g.status)}${g.closed_date ? " " + esc(fmtDate(g.closed_date)) : ""}</span>`}</div>
    <div class="muted small" style="margin-top:3px">${g.start_date ? "Since " + esc(fmtDate(g.start_date)) : "Start date unknown"}${g.target_date ? " · target " + esc(fmtDate(g.target_date)) : ""}${g.target_value != null ? ` · target ${esc(g.target_value)} ${esc(g.target_unit || "")}` : ""}${(g.source || {}).kind === "legacy" ? ` · imported from “${esc(g.source.column)}”` : ""}${g.type === "weight" && g.target_value != null ? goalProgress(g) : ""}</div>
    ${(g.progress || []).map((n) => `<div class="small" style="margin:4px 0 0 12px;border-left:2px solid var(--line);padding-left:8px">${esc(fmtDate(n.date))} — ${esc(n.text)}</div>`).join("")}</li>`;
  host.innerHTML = `<div class="grid2"><section class="panel"><header><h2>Active goals</h2><span class="count">${act.length}</span><span class="sp"></span>${can("write_nutrition") ? '<button class="btn sm primary no-print" id="addG">+ Goal</button>' : ""}</header>${act.length ? `<ul class="list">${act.map(row).join("")}</ul>` : '<div class="empty">No active goals.</div>'}</section>
    <section class="panel"><header><h2>Completed &amp; earlier goals</h2><span class="count">${past.length}</span></header>${past.length ? `<ul class="list">${past.map(row).join("")}</ul>` : '<div class="empty">None yet — completed goals are kept here.</div>'}</section></div>`;
  $$("[data-gs]", host).forEach((s) => (s.onchange = async () => { if (!s.value) return; try { await api("POST", "goal.update", { body: { id: s.dataset.gs, status: s.value } }); toast("Goal updated — kept in the history"); reload(); } catch (e) { errToast(e); } }));
  $$("[data-gp]", host).forEach((b) => (b.onclick = () => formModal("Progress note", `<div class="f"><label for="fT">Note</label><textarea id="fT" rows="3" autofocus></textarea></div>`, () => api("POST", "goal.update", { body: { id: b.dataset.gp, progress_note: $("#fT").value } }), "Progress note added")));
  const ag = $("#addG"); if (ag) ag.onclick = () => formModal("Add a goal", `
    <div class="row"><div class="f"><label for="fT">Type</label><select id="fT">${Object.entries(GOAL_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
    <div class="f"><label for="fS">Start</label><input type="date" id="fS" value="${today()}"></div><div class="f"><label for="fTD">Target date <span class="muted">(optional)</span></label><input type="date" id="fTD"></div></div>
    <div class="f"><label for="fDsc">Description</label><input type="text" id="fDsc" autofocus placeholder="e.g. Reach 205 lb by Opening Day, mostly lean mass"></div>
    <div class="row"><div class="f"><label for="fV">Numeric target <span class="muted">(optional)</span></label><input type="number" id="fV" step="0.1" class="w110"></div><div class="f"><label for="fVU">Unit</label><select id="fVU" class="w80"><option value="">—</option><option>lb</option><option>kg</option></select></div></div>`,
    () => api("POST", "goal", { body: { player_id: P.player.id, type: $("#fT").value, start_date: $("#fS").value, target_date: $("#fTD").value, description: $("#fDsc").value, target_value: $("#fV").value, target_unit: $("#fVU").value || ($("#fV").value ? "lb" : null) } }), "Goal added");
}

/* ------------------------------------------------------------------ hydration & protocols */
function hydration(host) {
  if (!P.hydration) { host.innerHTML = `<section class="panel"><div class="empty"><span class="lock">🔒 Hydration and protocol records are restricted to nutrition staff and administrators.</span></div></section>`; return; }
  host.innerHTML = `<div class="callout" style="margin-bottom:14px">Restricted information. FUEL records what was measured or agreed — it doesn't interpret it or make clinical recommendations.</div>
  <div class="grid2"><section class="panel"><header><h2>Hydration assessments</h2><span class="sp"></span>${can("write_protocols") ? '<button class="btn sm primary" id="addH">+ Assessment</button>' : ""}</header><div class="tblwrap short" id="hT"></div></section>
  <section class="panel"><header><h2>Protocols</h2><span class="sp"></span>${can("write_protocols") ? '<button class="btn sm primary" id="addPr">+ Protocol record</button>' : ""}</header><div class="tblwrap short" id="prT"></div></section></div>`;
  table($("#hT"), { rows: P.hydration.slice().reverse().map((x) => ({ ...x, __cls: x.voided ? "void" : "" })), cols: [
    { key: "date", label: "Tested", render: (r) => r.date ? esc(fmtDate(r.date)) : '<span class="tag warn">date unknown</span>' },
    { key: "hydration_card", label: "Hydration card", render: (r) => r.hydration_card === true ? "Yes" : r.hydration_card === false ? "No" : esc(r.hydration_card_text || "—") },
    { key: "fluid_loss_oz_hr", label: "Fluid loss", cls: "n", render: (r) => r.fluid_loss_oz_hr != null ? `${r.fluid_loss_oz_hr} oz/hr` : "—" },
    { key: "sodium_loss_mg_hr", label: "Sodium loss", cls: "n", render: (r) => r.sodium_loss_mg_hr != null ? `${r.sodium_loss_mg_hr} mg/hr` : "—" },
    { key: "note", label: "Note", render: (r) => esc(r.note || "") + ((r.source || {}).kind === "legacy" ? ' <span class="tag ghost">imported</span>' : "") },
  ], empty: "No hydration assessments." });
  table($("#prT"), { rows: P.protocols.slice().reverse(), cols: [
    { key: "type", label: "Protocol", render: (r) => r.type === "vitamin_d" ? "Vitamin D" : esc(r.label || "Other") },
    { key: "active", label: "Status", render: (r) => r.active === true ? '<span class="tag good">on protocol</span>' : r.active === false ? '<span class="tag ghost">not on protocol</span>' : '<span class="tag ghost">see details</span>' },
    { key: "date", label: "Date", render: (r) => r.date ? esc(fmtDate(r.date)) : "—" },
    { key: "details", label: "Details", render: (r) => esc(r.details || "") },
  ], empty: "No protocol records." });
  const ah = $("#addH"); if (ah) ah.onclick = () => formModal("Hydration assessment", `
    <div class="row"><div class="f"><label for="fD">Test date</label><input type="date" id="fD" value="${today()}"></div><div class="f"><label for="fC">Hydration card</label><select id="fC"><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></div></div>
    <div class="row"><div class="f"><label for="fF">Fluid loss (oz/hr)</label><input type="number" id="fF" step="1" class="w110"></div><div class="f"><label for="fNa">Sodium loss (mg/hr)</label><input type="number" id="fNa" step="10" class="w140"></div></div>
    <div class="f"><label for="fN">Note</label><input type="text" id="fN"></div>`,
    () => api("POST", "hydration", { body: { player_id: P.player.id, date: $("#fD").value, hydration_card: $("#fC").value === "yes" ? true : $("#fC").value === "no" ? false : null, fluid_loss_oz_hr: $("#fF").value, sodium_loss_mg_hr: $("#fNa").value, note: $("#fN").value } }), "Hydration assessment saved");
  const ap = $("#addPr"); if (ap) ap.onclick = () => formModal("Protocol record", `
    <div class="row"><div class="f"><label for="fT">Protocol</label><select id="fT"><option value="vitamin_d">Vitamin D</option><option value="other">Other</option></select></div><div class="f"><label for="fL">Name (if other)</label><input type="text" id="fL"></div>
    <div class="f"><label for="fA">Status</label><select id="fA"><option value="yes">On protocol</option><option value="no">Not on protocol</option></select></div><div class="f"><label for="fD">Date</label><input type="date" id="fD" value="${today()}"></div></div>
    <div class="f"><label for="fDt">Details</label><input type="text" id="fDt" placeholder="as documented by the medical staff"></div>`,
    () => api("POST", "protocol", { body: { player_id: P.player.id, type: $("#fT").value, label: $("#fL").value, active: $("#fA").value === "yes", date: $("#fD").value, details: $("#fDt").value } }), "Protocol record saved");
}

/* ------------------------------------------------------------------ communication */
function comms(host) {
  if (!P.interactions) { host.innerHTML = `<section class="panel"><div class="empty"><span class="lock">🔒 Nutrition notes are restricted for your role</span></div></section>`; return; }
  host.innerHTML = `<div class="filters"><input type="search" id="cQ" class="w240" placeholder="Search notes…" aria-label="Search notes"><select id="cT" aria-label="Type"><option value="">All types</option>${Object.entries(INTERACTION_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
    <label class="small"><input type="checkbox" id="cV"> show voided</label><span class="sp"></span>${can("write_nutrition") ? '<button class="btn primary sm" id="addN">+ Note</button>' : ""}</div>
    <section class="panel"><div class="body" id="tl"></div></section>`;
  const draw = () => {
    const q = $("#cQ").value.trim().toLowerCase(), t = $("#cT").value, sv = $("#cV").checked;
    const list = P.interactions.filter((i) => (sv || live(i)) && (!t || i.type === t) && (!q || i.text.toLowerCase().includes(q) || (i.author_name || "").toLowerCase().includes(q)));
    const dated = list.filter((i) => i.date).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""))), undated = list.filter((i) => !i.date);
    let html = "", mon = "";
    for (const i of dated) { const m = new Date(i.date + "T12:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); if (m !== mon) { html += `<li class="mon">${esc(m)}</li>`; mon = m; } html += noteItem(i, q); }
    if (undated.length) html += `<li class="mon">Undated — from imported history (kept as written; not placed on the timeline)</li>` + undated.map((i) => noteItem(i, q)).join("");
    $("#tl").innerHTML = list.length ? `<ul class="tl">${html}</ul>` : '<div class="empty">No notes match.</div>';
    $$("[data-hist]").forEach((b) => (b.onclick = () => { const i = P.interactions.find((x) => x.id === b.dataset.hist); openModal(`<header><h2 id="modalTitle">Earlier versions</h2><button class="x" data-close aria-label="Close">×</button></header><div class="mb"><p class="muted small" style="margin-top:0">Original text, as first saved:</p><div class="callout" style="white-space:pre-wrap">${esc(i.original_text || "")}</div>${i.history.map((h) => `<p class="small muted" style="margin:12px 0 4px">Replaced ${esc(new Date(h.at).toLocaleString())} by ${esc(h.by)}${h.reason ? " — " + esc(h.reason) : ""}:</p><div class="callout" style="white-space:pre-wrap">${esc(h.previous_text)}</div>`).join("")}</div>`); }));
    $$("[data-edit]").forEach((b) => (b.onclick = () => { const i = P.interactions.find((x) => x.id === b.dataset.edit);
      formModal("Edit note", `<p class="muted small" style="margin:0">The earlier version is kept and can be viewed from the timeline.</p><div class="f"><label for="fT">Note</label><textarea id="fT" rows="6">${esc(i.text)}</textarea></div><div class="f"><label for="fR">Reason for the edit <span class="muted">(optional)</span></label><input type="text" id="fR"></div>`,
        () => api("POST", "interaction.edit", { body: { id: i.id, text: $("#fT").value, reason: $("#fR").value } }), "Note updated — earlier version kept"); }));
  };
  $("#cQ").oninput = draw; $("#cT").onchange = draw; $("#cV").onchange = draw;
  draw();
  const an = $("#addN"); if (an) an.onclick = () => formModal("Add a note", `
    <div class="row"><div class="f"><label for="fD">Date</label><input type="date" id="fD" value="${today()}"></div><div class="f"><label for="fTm">Time <span class="muted">(optional)</span></label><input type="time" id="fTm"></div>
    <div class="f"><label for="fTy">Type</label><select id="fTy">${Object.entries(INTERACTION_TYPES).filter(([k]) => k !== "history").map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
    <div class="f grow"><label for="fG">Related goal <span class="muted">(optional)</span></label><select id="fG"><option value="">—</option>${P.goals.filter((g) => g.status === "active").map((g) => `<option value="${esc(g.id)}">${esc(GOAL_TYPES[g.type])}: ${esc(g.description.slice(0, 50))}</option>`).join("")}</select></div></div>
    <div class="f"><label for="fT">Note</label><textarea id="fT" rows="5" autofocus></textarea></div>`,
    () => api("POST", "interaction", { body: { player_id: P.player.id, date: $("#fD").value, time: $("#fTm").value, type: $("#fTy").value, goal_id: $("#fG").value, text: $("#fT").value } }), "Note saved");
}

/* ------------------------------------------------------------------ performance */
function performance(host) {
  const pf = P.performance.filter(live);
  const series = {};
  for (const x of pf) (series[x.metric + "|" + x.definition] = series[x.metric + "|" + x.definition] || []).push(x);
  const defRank = (k) => (/\|(average|average_fastball)$/.test(k) ? 0 : 1);
  const keys = Object.keys(series).sort((a, b) => a.split("|")[0].localeCompare(b.split("|")[0]) || defRank(a) - defRank(b));
  const pref = JSON.parse(sessionStorage.getItem("fuel:cmp") || "{}");
  const physKeys = Object.keys(PHYSICAL);
  const physAvail = (k) => (k === "weight" ? P.weights.filter((x) => live(x) && x.date).length : P.dexa.filter((x) => live(x) && x.date && x[PHYSICAL[k].field] != null).length);
  let phys = physKeys.includes(pref.phys) ? pref.phys : "weight";
  let perfKey = keys.includes(pref.perf) ? pref.perf : keys.find((k) => k.startsWith(isPitcher(P.player.position) && P.player.position !== "TWP" ? "pitch_velocity" : "bat_speed")) || keys[0] || "";
  let win = +(pref.win || 7);
  host.innerHTML = `
    <section class="panel"><header><h2>Body composition × performance</h2></header><div class="body">
      <div class="filters">
        <div class="f"><label for="cmpPhys">Physical measure</label><select id="cmpPhys">${physKeys.map((k) => `<option value="${k}"${k === phys ? " selected" : ""}>${esc(PHYSICAL[k].label)} (${physAvail(k)})</option>`).join("")}</select></div>
        <div class="f"><label for="cmpPerf">Performance metric — definition</label><select id="cmpPerf">${keys.length ? keys.map((k) => { const [m, d] = k.split("|"); return `<option value="${esc(k)}"${k === perfKey ? " selected" : ""}>${esc(metricLabel(m, d))} (${series[k].length})</option>`; }).join("") : "<option value=''>No performance data</option>"}</select></div>
        <div class="f"><label for="cmpWin">Match within</label><div class="row" style="gap:4px"><input type="number" id="cmpWin" class="w80" min="0" max="30" value="${win}"><span class="small muted">days</span></div></div>
      </div>
      <div class="legend" id="cmpLeg"></div>
      <div id="cmpChart"></div>
      <p class="muted small" style="margin:6px 0 0" id="cmpNote"></p>
    </div></section>
    <div class="grid2" style="margin-top:14px">
      <section class="panel"><header><h2>Do they move together?</h2></header><div class="body"><div id="cmpStat"></div><div id="cmpScatter" style="margin-top:8px"></div>
        <details style="margin-top:10px"><summary class="small" style="cursor:pointer;color:var(--navy-2)">How this is calculated</summary><p class="small muted">Each physical measurement is paired with the closest performance measurement taken within the matching window — one-to-one, so no measurement is used twice and a single DEXA scan counts once. Nothing is estimated for days without a measurement. With ${MIN_PAIRS}+ pairs FUEL shows Pearson's r (−1 to +1): how consistently the two rose and fell together. Below ${STABLE_PAIRS} pairs it is unstable. It describes the data; it doesn't show that one caused the other and isn't a recommendation.</p></details></div></section>
      <section class="panel"><header><h2>Performance measurements</h2><span class="sp"></span>${can("write_performance") ? '<button class="btn sm primary" id="addPf">+ Measurement</button>' : ""}</header><div class="tblwrap short" id="pfT"></div></section>
    </div>`;
  const draw = () => {
    phys = $("#cmpPhys").value; perfKey = $("#cmpPerf").value; win = Math.max(0, Math.min(30, +$("#cmpWin").value || 0));
    sessionStorage.setItem("fuel:cmp", JSON.stringify({ phys, perf: perfKey, win }));
    const ph = PHYSICAL[phys];
    const physPts = (phys === "weight" ? P.weights.filter((x) => live(x) && x.date).map((x) => ({ id: x.id, date: x.date, value: round(lb(x)) }))
      : P.dexa.filter((x) => live(x) && x.date && x[ph.field] != null).map((x) => ({ id: x.id, date: x.date, value: ph.unit === "%" ? x[ph.field] : round(toLb(x[ph.field], x.unit)) })));
    const [m, d] = (perfKey || "|").split("|");
    const perfPts = perfKey ? series[perfKey].map((x) => ({ id: x.id, date: x.date, value: x.value, tip: x.source_label || "" })) : [];
    const lo = [...physPts, ...perfPts].map((x) => x.date).sort()[0];
    $("#cmpLeg").innerHTML = `<span><i style="background:#002D62"></i>${esc(ph.label)} (${esc(ph.unit)}) — left axis${phys !== "weight" ? ", scan dates" : ""}</span>${perfKey ? `<span><i style="background:#EB6E1F"></i>${esc(metricLabel(m, d))} (mph) — right axis</span>` : ""}`;
    timeChart($("#cmpChart"), { series: [
      { label: ph.label, color: "#002D62", unit: ph.unit, axis: "left", points: physPts, join: phys === "weight" ? 10 : 150, shape: phys === "weight" ? "circle" : "diamond", size: phys === "weight" ? 2.4 : 5 },
      ...(perfKey ? [{ label: metricLabel(m, d), color: "#EB6E1F", unit: "mph", axis: "right", points: perfPts, join: 14, hollow: true, size: 3.2 }] : []),
    ], height: 280, emptyText: "No measurements for this combination yet." });
    $("#cmpNote").textContent = `${physPts.length} ${phys === "weight" ? "weigh-ins" : "scans"} and ${perfPts.length} performance measurements, all on their real dates. Lines break where measurements are far apart.`;
    const a = perfKey ? analyze(physPts, perfPts, win) : { n: 0, show: false, message: "Add performance measurements to compare." };
    const first = a.pairs && a.pairs[0], last = a.pairs && a.pairs[a.pairs.length - 1];
    $("#cmpStat").innerHTML = `<div class="stat"><div><div class="v">${a.n}</div><div class="l">matched pairs (±${win} d)</div></div>${a.show ? `<div><div class="v">${a.r.toFixed(2)}</div><div class="l">Pearson r</div></div>` : ""}
      ${first && last && a.n > 1 ? `<div><div class="v">${delta(last.x - first.x, ph.unit === "%" ? "pts" : ph.unit, { neutral: true })}</div><div class="l">${esc(ph.label)}, first → last pair</div></div><div><div class="v">${delta(last.y - first.y, "mph")}</div><div class="l">${esc(METRICS[m] ? METRICS[m].label : "")}, first → last pair</div></div>` : ""}</div>
      <div class="callout ${a.show ? (a.n < STABLE_PAIRS ? "warn" : "") : "warn"}">${esc(a.message)}</div>`;
    scatter($("#cmpScatter"), { pairs: a.pairs || [], xLabel: ph.label, yLabel: METRICS[m] ? METRICS[m].label : "", xUnit: ph.unit, yUnit: "mph", height: 230 });
  };
  ["#cmpPhys", "#cmpPerf", "#cmpWin"].forEach((s) => ($(s).onchange = draw));
  $("#cmpWin").oninput = draw;
  draw();
  table($("#pfT"), { rows: pf.slice().sort((a, b) => b.date.localeCompare(a.date)), cols: [
    { key: "date", label: "Date", render: (r) => esc(fmtDate(r.date)) },
    { key: "metric", label: "Metric", render: (r) => esc(METRICS[r.metric].label) },
    { key: "definition", label: "Definition", render: (r) => `<span class="tag ghost">${esc(METRICS[r.metric].definitions[r.definition] || r.definition)}</span>` },
    { key: "value", label: "mph", cls: "n" },
    { key: "source_label", label: "Source", render: (r) => `<span class="small muted">${esc(r.source_label || (r.source || {}).kind || "")}</span>` },
    { key: "v", label: "", render: (r) => can("write_performance") ? `<button class="btn ghost sm" data-void="performance:${esc(r.id)}">Void</button>` : "" },
  ], empty: "No measurements yet." });
  wireVoid(host);
  const ap = $("#addPf"); if (ap) ap.onclick = () => {
    formModal("Add a performance measurement", `
      <div class="row"><div class="f"><label for="fD">Date</label><input type="date" id="fD" value="${today()}"></div>
      <div class="f"><label for="fM">Metric</label><select id="fM">${Object.entries(METRICS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>
      <div class="f"><label for="fDef">Definition</label><select id="fDef"></select></div>
      <div class="f"><label for="fV">Value (mph)</label><input type="number" id="fV" step="0.1" class="w110" autofocus></div></div>
      <div class="row"><div class="f grow"><label for="fS">Source <span class="muted">(optional)</span></label><input type="text" id="fS" placeholder="e.g. cage sensor, game tracking"></div><div class="f grow"><label for="fN">Notes</label><input type="text" id="fN"></div></div>
      <p class="muted small" style="margin:0">Different definitions are kept as separate series and never combined.</p>`,
      () => api("POST", "performance", { body: { player_id: P.player.id, date: $("#fD").value, metric: $("#fM").value, definition: $("#fDef").value, value: $("#fV").value, source_label: $("#fS").value, notes: $("#fN").value } }), "Measurement saved");
    const fill = () => { $("#fDef").innerHTML = Object.entries(METRICS[$("#fM").value].definitions).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(""); };
    $("#fM").onchange = fill; $("#fM").value = isPitcher(P.player.position) && P.player.position !== "TWP" ? "pitch_velocity" : "bat_speed"; fill();
  };
}

/* ------------------------------------------------------------------ edit / move */
function editPlayer(p) {
  const v = S.session.vocab;
  formModal("Edit player", `
    <div class="row"><div class="f grow"><label for="eF">First name</label><input type="text" id="eF" value="${esc(p.first_name)}"></div><div class="f grow"><label for="eL">Last name</label><input type="text" id="eL" value="${esc(p.last_name)}"></div></div>
    <div class="row"><div class="f"><label for="eId">Player ID</label><input type="text" id="eId" class="w140" value="${esc(p.external_id || "")}"></div><div class="f"><label for="eDob">Date of birth</label><input type="date" id="eDob" value="${esc(p.dob || "")}"></div>
    <div class="f"><label for="ePos">Position</label><select id="ePos">${v.positions.map((x) => `<option${x === p.position ? " selected" : ""}>${x}</option>`).join("")}</select></div>
    <div class="f"><label for="eSt">Roster status</label><select id="eSt">${v.rosterStatus.map((x) => `<option${x === p.status ? " selected" : ""}>${x}</option>`).join("")}</select></div></div>
    <div class="row"><div class="f"><label for="eAff">Affiliate</label><select id="eAff">${v.affiliates.map((x) => `<option${x === p.affiliate ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div><div class="f"><label for="eEff">Move effective</label><input type="date" id="eEff" value="${today()}"></div>
    <div class="f"><label for="eRD">Dietitian</label><select id="eRD"><option value="">—</option>${S.staff.filter((s) => s.role === "dietitian" || s.role === "admin").map((s) => `<option value="${esc(s.id)}"${s.id === p.dietitian ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
    ${P.restricted.contact ? "" : `<div class="row"><div class="f grow"><label for="ePh">Mobile phone</label><input type="text" id="ePh" value="${esc(p.phone || "")}"></div><div class="f grow"><label for="eWa">WhatsApp #</label><input type="text" id="eWa" value="${esc(p.whatsapp || "")}"></div></div>`}
    <p class="muted small" style="margin:0">Changing the affiliate closes the current assignment and opens a new one. All history stays with this player.</p>`,
    () => api("POST", "player.update", { body: { id: p.id, affiliate: $("#eAff").value, effective_date: $("#eEff").value, fields: { first_name: $("#eF").value, last_name: $("#eL").value, external_id: $("#eId").value, dob: $("#eDob").value || null, position: $("#ePos").value, status: $("#eSt").value, dietitian: $("#eRD").value || null, ...(P.restricted.contact ? {} : { phone: $("#ePh").value, whatsapp: $("#eWa").value }) } } }), "Player updated");
}
