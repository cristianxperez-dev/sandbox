/* Manager Hub — Game Day Defaults (settings): the organization's standard game-day activities and the Complex
   workout day, with optional per-affiliate overrides. Stored on the server (api/settings, D1) so every
   browser uses the same defaults; when the server store isn't available the built-in defaults apply and any
   change is kept in this browser only (and says so). Logic: games/gameday.js. */
(function () {
  "use strict";
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LOCAL = "cs.gameday.local";
  const S0 = { doc: null, version: 0, stored: null, updated: null, loaded: false };
  let st = Object.assign({}, S0);
  const aff = () => (typeof store !== "undefined" && store.affiliate()) || null;

  async function load() {
    try {
      const r = await fetch("api/settings", { headers: { Accept: "application/json" }, cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      if (d && d.stored) { st = { doc: d.doc, version: d.version, stored: true, updated: d.updated, loaded: true }; return st; }
    } catch (e) { /* offline / not deployed: fall through */ }
    let local = null; try { local = JSON.parse(localStorage.getItem(LOCAL) || "null"); } catch (e) { local = null; }
    st = { doc: local, version: 0, stored: false, updated: null, loaded: true };
    return st;
  }
  const resolved = (a) => GameDay.resolve(st.doc, a || aff());

  async function save(doc) {
    const clean = GameDay.sanitize(doc);
    if (st.stored) {
      const r = await fetch("api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: clean, baseVersion: st.version }) });
      const d = await r.json().catch(() => null);
      if (r.status === 409 && d) { st.doc = d.doc; st.version = d.version; st.updated = d.updated; return { ok: false, conflict: true }; }
      if (!r.ok || !d) return { ok: false };
      st.doc = d.doc; st.version = d.version; st.updated = d.updated; return { ok: true };
    }
    try { localStorage.setItem(LOCAL, JSON.stringify(clean)); } catch (e) {}
    st.doc = clean; return { ok: true, local: true };
  }

  /* ------------------------------------------------------------------ the settings window */
  let tab = "gameDay", scope = "org", work = null;
  const mm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  function current() {
    const doc = JSON.parse(JSON.stringify(st.doc || {})); doc.org = doc.org || {}; doc.affiliates = doc.affiliates || {};
    return doc;
  }
  function listFor(doc) {
    if (scope === "org") return doc.org[tab] || GameDay.resolve(null, null)[tab];
    const o = doc.affiliates[aff()] || {};
    return o[tab] || null;
  }
  async function open(startTab) {
    if (!st.loaded) await load();
    tab = startTab || (aff() === "fcl" ? "workout" : "gameDay"); scope = "org"; work = current();
    openModal(`
      <div class="mhead"><div><h2>Game Day Defaults</h2><p id="gdsSub"></p></div><button class="x" data-close>×</button></div>
      <div class="ai-tabs gtabs" role="tablist">
        <button role="tab" data-gds-tab="gameDay">Game day</button>
        <button role="tab" data-gds-tab="workout">Complex workout day</button>
      </div>
      <div class="mbody" id="gdsBody"></div>
      <div class="mfoot"><span class="mha-note" id="gdsNote" style="margin-right:auto"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="gdsSave">Save defaults</button></div>`, () => {
      document.getElementById("modal").classList.add("wide");
      const m = document.getElementById("modal");
      m.addEventListener("click", (e) => {
        const t = e.target.closest("[data-gds-tab]"); if (t) { capture(); tab = t.dataset.gdsTab; draw(); return; }
        const sc = e.target.closest("[data-gds-scope]"); if (sc) { capture(); scope = sc.dataset.gdsScope; draw(); return; }
        if (e.target.closest("[data-gds-add]")) { capture(); const l = ensureList(); l.push(tab === "gameDay" ? { key: "act-" + Date.now().toString(36), label: "New activity", before: 30, dur: 15, enabled: true, location: "" } : { key: "act-" + Date.now().toString(36), label: "New activity", at: 600, dur: 30, enabled: true, location: "", who: "all" }); draw(); return; }
        const rm = e.target.closest("[data-gds-rm]"); if (rm) { capture(); ensureList().splice(+rm.dataset.gdsRm, 1); draw(); return; }
        if (e.target.closest("[data-gds-override]")) { capture(); const o = (work.affiliates[aff()] = work.affiliates[aff()] || {}); o[tab] = JSON.parse(JSON.stringify(work.org[tab] || GameDay.resolve(null, null)[tab])); draw(); return; }
        if (e.target.closest("[data-gds-inherit]")) { const o = work.affiliates[aff()] || {}; delete o[tab]; draw(); return; }
        if (e.target.closest("[data-gds-reset]")) { if (scope === "org") delete work.org[tab]; draw(); return; }
      });
      document.getElementById("gdsSave").onclick = async () => {
        capture();
        const r = await save(work);
        if (r.conflict) { toast("Someone else saved the defaults first — their version is shown; make your change again"); work = current(); draw(); return; }
        if (!r.ok) { toast("Couldn't save the defaults — try again"); return; }
        closeModal(); toast(r.local ? "Defaults saved in this browser (the shared settings store isn't available)" : "Game Day Defaults saved for the organization");
      };
      draw();
    });
  }
  function ensureList() {
    if (scope === "org") { work.org[tab] = work.org[tab] || JSON.parse(JSON.stringify(GameDay.resolve(null, null)[tab])); return work.org[tab]; }
    const o = (work.affiliates[aff()] = work.affiliates[aff()] || {}); o[tab] = o[tab] || JSON.parse(JSON.stringify(work.org[tab] || GameDay.resolve(null, null)[tab])); return o[tab];
  }
  /** read the table back into the working copy */
  function capture() {
    const rows = [...document.querySelectorAll("#gdsBody tr[data-i]")]; if (!rows.length) return;
    const l = scope === "org" ? (work.org[tab] = work.org[tab] || JSON.parse(JSON.stringify(GameDay.resolve(null, null)[tab]))) : (work.affiliates[aff()] || {})[tab];
    if (!l) return;
    rows.forEach((tr) => {
      const x = l[+tr.dataset.i]; if (!x) return;
      const v = (k) => tr.querySelector(`[data-k="${k}"]`);
      x.label = v("label").value.trim() || x.label; x.dur = Math.max(0, Math.round(+v("dur").value || 0)); x.enabled = v("enabled").checked; x.location = v("location").value.trim();
      if (tab === "gameDay") x.before = Math.max(0, Math.round(+v("before").value || 0));
      else { const t = v("at").value.match(/^(\d{1,2}):(\d{2})/); if (t) x.at = +t[1] * 60 + +t[2]; x.who = v("who").value; }
    });
  }
  function draw() {
    document.querySelectorAll("[data-gds-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.gdsTab === tab)));
    const meta = (typeof store !== "undefined" && store.affiliateMeta()) || { name: "this affiliate" };
    const sub = document.getElementById("gdsSub");
    if (sub) sub.textContent = tab === "gameDay" ? "Placed automatically from first pitch when a manager builds a game day. Every one stays editable on the day." : "The Complex's starting point on a day without a game.";
    const note = document.getElementById("gdsNote");
    if (note) note.textContent = st.stored ? `Shared by every browser${st.updated ? " · last saved " + new Date(st.updated).toLocaleString() : ""}. Anyone signed in with the access code can change these.` : "The shared settings store isn't available — changes stay in this browser.";
    const list = listFor(work);
    const body = document.getElementById("gdsBody");
    const scopeBar = `<div class="gds-scope"><span class="gseg"><button class="${scope === "org" ? "on" : ""}" data-gds-scope="org">Organization</button><button class="${scope === "aff" ? "on" : ""}" data-gds-scope="aff">${h(meta.name)} only</button></span></div>`;
    if (scope === "aff" && !list) {
      body.innerHTML = scopeBar + `<p>${h(meta.name)} uses the organization's ${tab === "gameDay" ? "game-day" : "workout"} defaults.</p><button class="btn" data-gds-override>Use different defaults for ${h(meta.name)}</button>`;
      return;
    }
    body.innerHTML = scopeBar + `<table class="gds"><thead><tr><th>On</th><th>Activity</th><th>${tab === "gameDay" ? "Minutes before first pitch" : "Start"}</th><th>Minutes</th>${tab === "workout" ? "<th>Who</th>" : ""}<th>Facility</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr data-i="${i}"><td><input type="checkbox" data-k="enabled" ${x.enabled !== false ? "checked" : ""} aria-label="Enabled"></td>
        <td><input data-k="label" value="${h(x.label)}" aria-label="Activity"></td>
        <td>${tab === "gameDay" ? `<input type="number" data-k="before" min="0" max="600" step="5" value="${x.before}" aria-label="Minutes before first pitch">` : `<input type="time" data-k="at" value="${mm(x.at)}" aria-label="Start">`}</td>
        <td><input type="number" data-k="dur" min="0" max="300" step="5" value="${x.dur}" aria-label="Minutes"></td>
        ${tab === "workout" ? `<td><select data-k="who">${[["all", "Team"], ["position", "Position"], ["pitchers", "Pitchers"], ["catchers", "Catchers"]].map(([v, l]) => `<option value="${v}" ${x.who === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>` : ""}
        <td><input data-k="location" value="${h(x.location || "")}" placeholder="—" aria-label="Facility"></td>
        <td><button class="btn sm quiet" data-gds-rm="${i}" aria-label="Remove">×</button></td></tr>`).join("")}
      </tbody></table>
      <div class="gds-a"><button class="btn sm" data-gds-add>+ Add activity</button>
        ${scope === "org" ? `<button class="btn sm quiet" data-gds-reset>Restore the built-in defaults</button>` : `<button class="btn sm quiet" data-gds-inherit>Use the organization's defaults again</button>`}</div>
      ${tab === "gameDay" ? `<p class="mha-note">Example: first pitch 6:30 PM → ${list.filter((x) => x.enabled !== false && x.dur > 0).map((x) => `${h(x.label)} ${fmt12(1110 - x.before)}`).join(" · ")}.</p>` : ""}`;
  }
  const fmt12 = (m) => { const H = Math.floor(m / 60), M = m % 60; return `${H % 12 || 12}:${String(M).padStart(2, "0")}`; };

  window.GameDaySettings = { load, resolved, save, open, get state() { return st; } };
  load();
})();
