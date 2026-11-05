/* FUEL — Quick Entry. One note (always kept exactly as typed) plus whatever the person accepts from the review:
   a weight, a follow-up. Everything is saved together in one atomic request, linked to the quick-entry record. */
import { api } from "./api.js";
import { quickParse } from "./shared/parse.js";
import { isISODate, addDays } from "./shared/util.js";
import { $, esc, S, can, toast, errToast, openModal, closeModal, playerPicker, fmtDate, today, invalidate, playerName } from "./ui.js";

const TYPES = () => S.session.vocab.interactionTypes;

export function openQuickEntry(player) {
  if (!can("write_nutrition")) { toast("Your role can't add nutrition notes.", { error: true }); return; }
  const m = openModal(`<header><h2 id="modalTitle">Quick Entry</h2><span class="muted small hide-m"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> to continue</span><button class="x" data-close aria-label="Close">×</button></header><div id="qeHost"></div>`, {});
  mountQuickEntry($("#qeHost", m), { player, modal: true });
}

export function mountQuickEntry(host, { player = null, modal = false, onSaved } = {}) {
  const st = { player, date: today(), note: "", type: null, typeTouched: false, w: "", wu: "lb", fu: "", step: "compose", review: null };
  compose();

  function compose() {
    st.step = "compose";
    host.innerHTML = `<div class="${modal ? "mb" : ""}"><div class="qe-grid">
      <div class="f"><span class="lbl" id="qePl">Player</span><div id="qePick"></div></div>
      <div class="f"><label for="qeNote">Note</label><textarea id="qeNote" rows="${modal ? 5 : 4}" placeholder="e.g. Met with him after workouts. Weight was 197.4 this morning. Talked about adding a shake after training. Follow up next Thursday.">${esc(st.note)}</textarea>
        <span class="hint">Write it the way you'd say it. Weights and follow-up dates in the note are picked up for you to confirm.</span></div>
      <div class="row">
        <div class="f"><label for="qeDate">Entry date</label><input type="date" id="qeDate" value="${esc(st.date)}" max="${esc(addDays(today(), 1))}"></div>
        <div class="f"><label for="qeType">Type</label><select id="qeType">${Object.entries(TYPES()).filter(([k]) => k !== "history").map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
        <div class="f"><label for="qeW">Weight <span class="muted">(optional)</span></label><div class="row" style="gap:4px"><input type="number" id="qeW" class="w110" step="0.1" inputmode="decimal" value="${esc(st.w)}" placeholder="lb"><select id="qeWu" class="w80" aria-label="Weight unit"><option${st.wu === "lb" ? " selected" : ""}>lb</option><option${st.wu === "kg" ? " selected" : ""}>kg</option></select></div></div>
        <div class="f"><label for="qeFu">Follow-up <span class="muted">(optional)</span></label><input type="date" id="qeFu" value="${esc(st.fu)}"></div>
      </div>
      <div class="err" id="qeErr" role="alert"></div>
    </div></div>
    <${modal ? "footer" : "div class=\"row\" style=\"margin-top:10px\""}>
      ${modal ? '<button class="btn ghost" data-close type="button">Cancel</button>' : ""}
      <span class="sp"></span>
      <button class="btn primary" id="qeNext" type="button">Continue</button>
    </${modal ? "footer" : "div"}>`;
    if (modal) host.closest(".modal").querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
    const picker = playerPicker($("#qePick", host), { initial: st.player, onPick: (p) => { st.player = p; if (p) $("#qeNote", host).focus(); } });
    const note = $("#qeNote", host), type = $("#qeType", host);
    type.value = st.type || "general";
    const detect = () => { st.note = note.value; if (!st.typeTouched) { try { type.value = quickParse(note.value, isISODate($("#qeDate", host).value) ? $("#qeDate", host).value : today()).type; } catch { /* ignore */ } } };
    note.oninput = detect;
    type.onchange = () => { st.typeTouched = true; st.type = type.value; };
    host.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); next(); } };
    $("#qeNext", host).onclick = next;
    (st.player ? note : null) ? note.focus() : picker.focus();

    function next() {
      st.note = note.value; st.date = $("#qeDate", host).value; st.type = type.value; st.w = $("#qeW", host).value; st.wu = $("#qeWu", host).value; st.fu = $("#qeFu", host).value;
      const err = $("#qeErr", host);
      if (!st.player) { err.textContent = "Choose a player."; picker.focus(); return; }
      if (!st.note.trim()) { err.textContent = "Write a note (or at least a few words about the measurement)."; note.focus(); return; }
      if (!isISODate(st.date)) { err.textContent = "Entry date isn't a valid date."; return; }
      const p = quickParse(st.note, st.date);
      const rv = { note: true, type: st.type, weight: null, weightOn: false, weightCands: [], weightAmbiguous: false, weightFrom: null, fu: null, fuOn: false, fuFrom: null };
      if (st.w !== "") { rv.weight = { value: +st.w, unit: st.wu, date: st.date }; rv.weightOn = true; rv.weightFrom = "entered"; }
      else if (p.weights.length) {
        rv.weightCands = p.weights; rv.weightAmbiguous = p.weightAmbiguous; rv.weightFrom = "note";
        if (p.weight) { rv.weight = { ...p.weight }; rv.weightOn = true; }
        else if (p.weightAmbiguous) rv.weightOn = true; // ticked but empty: Save asks the person to pick one or untick it — never silently dropped
      }
      if (st.fu) { rv.fu = { date: st.fu, description: p.followup ? p.followup.description : "Follow up", priority: "normal", assignee: S.session.user.staff_id || "" }; rv.fuOn = true; rv.fuFrom = "entered"; }
      else if (p.followup) { rv.fu = { ...p.followup, priority: "normal", assignee: S.session.user.staff_id || "" }; rv.fuOn = true; rv.fuFrom = "note"; }
      st.review = rv; st.parsed = p;
      if (!rv.weight && !rv.weightCands.length && !rv.fu) return save(false, false); // nothing to confirm — just the note
      review();
    }
  }

  function review() {
    st.step = "review";
    const rv = st.review;
    const wBlock = () => {
      if (rv.weightAmbiguous && rv.weightFrom === "note") {
        return `<div class="rv${rv.weightOn ? "" : " off"}"><input type="checkbox" id="rvW" ${rv.weightOn ? "checked" : ""} aria-label="Save a weight"><div><div class="what">Weight — the note mentions more than one</div>
          <div class="detail">Pick the measured weight, or leave it out. Nothing is saved until you choose.</div>
          <div class="row" style="margin-top:6px">${rv.weightCands.map((c, i) => `<label class="tag ghost" style="height:28px;cursor:pointer"><input type="radio" name="rvWc" value="${i}" ${rv.weight && rv.weight.value === c.value ? "checked" : ""}> ${c.value} ${c.unit} <span class="muted">“${esc(c.text)}”</span></label>`).join("")}</div>
          ${rv.weight ? weightEditor() : ""}</div></div>`;
      }
      if (!rv.weight) return "";
      return `<div class="rv${rv.weightOn ? "" : " off"}"><input type="checkbox" id="rvW" ${rv.weightOn ? "checked" : ""} aria-label="Save the weight"><div><div class="what">Weight record</div>
        <div class="detail">${rv.weightFrom === "entered" ? "From the weight field." : `Found in the note: “${esc((rv.weightCands[0] || {}).text || "")}”. A change such as “up 2 lb” is never saved as a weight.`}</div>${weightEditor()}</div></div>`;
    };
    const weightEditor = () => `<div class="row" style="margin-top:6px"><div class="f"><label for="rvWv">Weight</label><div class="row" style="gap:4px"><input type="number" id="rvWv" class="w110" step="0.1" value="${esc(rv.weight.value)}"><select id="rvWu" class="w80" aria-label="Unit"><option${rv.weight.unit === "lb" ? " selected" : ""}>lb</option><option${rv.weight.unit === "kg" ? " selected" : ""}>kg</option></select></div></div>
      <div class="f"><label for="rvWd">Measured on</label><input type="date" id="rvWd" value="${esc(rv.weight.date)}"></div></div>`;
    const staffOpts = S.staff.filter((s) => s.role !== "readonly").map((s) => `<option value="${esc(s.id)}"${rv.fu && rv.fu.assignee === s.id ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    host.innerHTML = `<div class="${modal ? "mb" : ""}">
      <p class="muted small" style="margin:0 0 8px">For <b>${esc(playerName(st.player))}</b> · entry date ${esc(fmtDate(st.date))}. Untick anything you don't want saved.</p>
      <div class="review">
        <div class="rv"><input type="checkbox" checked disabled aria-label="The note is always saved"><div><div class="what">Nutrition note · <select id="rvType" aria-label="Note type" style="height:26px">${Object.entries(TYPES()).filter(([k]) => k !== "history").map(([k, v]) => `<option value="${k}"${k === rv.type ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
          <div class="detail" style="white-space:pre-wrap">${esc(st.note.length > 400 ? st.note.slice(0, 400) + "…" : st.note)}</div><div class="detail muted">Saved exactly as written.</div></div></div>
        ${wBlock()}
        ${rv.fu ? `<div class="rv${rv.fuOn ? "" : " off"}"><input type="checkbox" id="rvF" ${rv.fuOn ? "checked" : ""} aria-label="Create the follow-up"><div><div class="what">Follow-up</div>
          <div class="detail">${rv.fuFrom === "entered" ? "From the follow-up field." : `From the note: ${esc(rv.fu.rule || "")}, counted from the entry date (${esc(fmtDate(st.date))}).`}</div>
          <div class="row" style="margin-top:6px"><div class="f"><label for="rvFd">Due</label><input type="date" id="rvFd" value="${esc(rv.fu.date)}"></div>
            <div class="f grow"><label for="rvFt">What</label><input type="text" id="rvFt" value="${esc(rv.fu.description)}"></div>
            <div class="f"><label for="rvFa">Assigned to</label><select id="rvFa"><option value="">—</option>${staffOpts}</select></div>
            <div class="f"><label for="rvFp">Priority</label><select id="rvFp"><option>normal</option><option>high</option><option>low</option></select></div></div></div></div>` : ""}
      </div>
      <div class="err" id="rvErr" role="alert" style="margin-top:8px"></div>
    </div>
    <${modal ? "footer" : "div class=\"row\" style=\"margin-top:10px\""}>
      <button class="btn ghost" id="rvBack" type="button">← Edit</button><span class="sp"></span>
      <button class="btn" id="rvNoteOnly" type="button">Save note only</button>
      <button class="btn" id="rvAnother" type="button">Save &amp; add another</button>
      <button class="btn primary" id="rvSave" type="button">Save</button>
    </${modal ? "footer" : "div"}>`;
    const sync = () => {
      rv.type = $("#rvType", host).value;
      const wc = $("#rvW", host); if (wc) rv.weightOn = wc.checked;
      const pickC = host.querySelector('input[name="rvWc"]:checked'); if (pickC && (!rv.weight || rv.weight.value !== rv.weightCands[+pickC.value].value)) { const c = rv.weightCands[+pickC.value]; rv.weight = { value: c.value, unit: c.unit, date: c.date }; rv.weightOn = true; review(); return false; }
      if ($("#rvWv", host)) rv.weight = { value: $("#rvWv", host).value, unit: $("#rvWu", host).value, date: $("#rvWd", host).value };
      const fc = $("#rvF", host); if (fc) { rv.fuOn = fc.checked; rv.fu = { ...rv.fu, date: $("#rvFd", host).value, description: $("#rvFt", host).value, assignee: $("#rvFa", host).value, priority: $("#rvFp", host).value }; }
      host.querySelectorAll(".rv").forEach((el) => { const cb = el.querySelector("input[type=checkbox]"); if (cb && !cb.disabled) el.classList.toggle("off", !cb.checked); });
      return true;
    };
    host.querySelectorAll("input,select").forEach((el) => (el.onchange = sync));
    $("#rvBack", host).onclick = () => { sync(); compose(); };
    $("#rvNoteOnly", host).onclick = () => save(true, false);
    $("#rvSave", host).onclick = () => { if (sync() !== false) save(false, false); };
    $("#rvAnother", host).onclick = () => { if (sync() !== false) save(false, true); };
    host.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (sync() !== false) save(false, false); } };
    $("#rvSave", host).focus();
  }

  async function save(noteOnly, another) {
    const rv = st.review || {};
    if (!noteOnly && rv.weightOn && rv.weightAmbiguous && !rv.weight) { $("#rvErr", host).textContent = "Pick which weight was measured, or untick the weight."; return; }
    const body = { player_id: st.player.id, entry_date: st.date, note: st.note, type: rv.type || st.type || "general", parsed: st.parsed || null,
      weight: !noteOnly && rv.weightOn && rv.weight ? rv.weight : null, followup: !noteOnly && rv.fuOn && rv.fu ? rv.fu : null };
    const btns = host.querySelectorAll("button"); btns.forEach((b) => (b.disabled = true));
    try {
      const r = await api("POST", "quick", { body });
      invalidate();
      const parts = ["note"]; if (r.weight) parts.push(`weight ${r.weight.weight} ${r.weight.unit}`); if (r.followup) parts.push(`follow-up ${fmtDate(r.followup.due_date, { year: false })}`);
      const pl = st.player;
      toast(`Saved for ${playerName(pl)}: ${parts.join(" + ")}`, { action: { label: "Open player", fn: () => (location.hash = "#/player/" + pl.id) } });
      window.dispatchEvent(new CustomEvent("fuel:saved", { detail: { player_id: pl.id } }));
      if (onSaved) onSaved(r);
      if (another) { const keepDate = st.date; Object.assign(st, { player: null, note: "", type: null, typeTouched: false, w: "", fu: "", review: null, parsed: null, date: keepDate }); compose(); }
      else if (modal) closeModal();
      else { Object.assign(st, { note: "", type: null, typeTouched: false, w: "", fu: "", review: null, parsed: null }); compose(); }
    } catch (e) {
      btns.forEach((b) => (b.disabled = false));
      const el = $("#rvErr", host) || $("#qeErr", host); if (el) el.textContent = e.message; else errToast(e);
    }
  }
}
