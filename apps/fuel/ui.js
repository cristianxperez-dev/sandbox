/* FUEL — shared UI helpers. All dynamic text is escaped with esc(); no user text is ever inserted as HTML. */
import { api } from "./api.js";
import { localToday, daysBetween, norm } from "./shared/util.js";

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const today = () => localToday();

export const S = { session: null, players: null, staff: [], dirty: true };
export const can = (perm) => !!(S.session && S.session.permissions.includes(perm));

export function fmtDate(iso, { year = true } = {}) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}
export function relDay(iso) {
  if (!iso) return "—";
  const n = daysBetween(iso, today());
  if (n === 0) return "today"; if (n === 1) return "yesterday"; if (n === -1) return "tomorrow";
  if (n > 1 && n < 14) return `${n} days ago`; if (n < -1 && n > -14) return `in ${-n} days`;
  return fmtDate(iso, { year: Math.abs(n) > 300 });
}
export const fmtNum = (v, d = 1) => (v == null || !Number.isFinite(+v) ? "—" : (+v).toFixed(d).replace(/\.0+$/, d ? ".0" : ""));
export const w = (v) => (v == null ? "—" : (+v).toFixed(1));
export function delta(v, unit = "", { invert = false, d = 1, neutral = false } = {}) {
  if (v == null || !Number.isFinite(v)) return "";
  const cls = neutral || Math.abs(v) < 0.05 ? "flat" : (v > 0) !== invert ? "up" : "down";
  return `<span class="delta ${cls}">${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}${unit ? " " + unit : ""}</span>`;
}
export const playerName = (p) => (p ? `${p.first_name} ${p.last_name}` : "Unknown player");

let toastT;
export function toast(msg, { error = false, action } = {}) {
  const t = $("#toast");
  t.className = "toast on" + (error ? " err" : "");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  if (action) t.querySelector("button").onclick = () => { t.className = "toast"; action.fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), error ? 6000 : 3200);
}
export function errToast(e) { toast(e && e.message ? e.message : String(e), { error: true }); }

let lastFocus = null, onClose = null;
export function openModal(html, { wide = false, close } = {}) {
  lastFocus = document.activeElement; onClose = close || null;
  const m = $("#modal");
  m.className = "modal" + (wide ? " wide" : "");
  m.innerHTML = html;
  $("#scrim").hidden = false;
  document.body.style.overflow = "hidden"; document.body.classList.add("modal-open");
  const f = m.querySelector("[autofocus]") || m.querySelector("input,select,textarea,button:not(.x)");
  setTimeout(() => f && f.focus(), 20);
  m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  return m;
}
export function closeModal() {
  if ($("#scrim").hidden) return;
  $("#scrim").hidden = true; $("#modal").innerHTML = ""; document.body.style.overflow = ""; document.body.classList.remove("modal-open");
  const cb = onClose; onClose = null; if (cb) cb();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#scrim").hidden) closeModal(); });
$("#scrim").addEventListener("mousedown", (e) => { if (e.target.id === "scrim") closeModal(); });

export async function players(force) {
  if (!S.players || S.dirty || force) { S.players = await api("GET", "players"); S.dirty = false; }
  return S.players;
}
export const invalidate = () => { S.dirty = true; };

/** score a player against a typed query: last name, first name, full name, Player ID */
export function matchScore(p, q) {
  const s = norm(q); if (!s) return 0;
  const f = norm(p.first_name), l = norm(p.last_name), full = f + " " + l;
  if (p.external_id && p.external_id === q.trim()) return 100;
  if (full === s || l === s) return 90;
  if (l.startsWith(s)) return 80;
  if (full.startsWith(s) || f.startsWith(s)) return 70;
  if ((l + " " + f).startsWith(s)) return 65;
  if (full.includes(s)) return 50;
  return 0;
}
export function findPlayers(list, q, limit = 8) {
  return list.map((p) => [matchScore(p, q), p]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].last_name.localeCompare(b[1].last_name)).slice(0, limit).map(([, p]) => p);
}

/** sortable table: cols [{key,label,cls,sort:(r)=>value,render:(r)=>html}] */
export function table(host, { cols, rows, sortKey, sortDir = 1, onRow, empty = "Nothing to show.", id }) {
  let key = sortKey, dir = sortDir;
  const draw = () => {
    const c = cols.find((x) => x.key === key);
    const data = c && c.sort ? rows.slice().sort((a, b) => { const va = c.sort(a), vb = c.sort(b); return (va == null) - (vb == null) || (va < vb ? -dir : va > vb ? dir : 0); }) : rows;
    host.innerHTML = rows.length ? `<table class="tbl"${id ? ` id="${id}"` : ""}><thead><tr>${cols.map((x) => `<th class="${x.cls || ""}${x.sort ? " sortable" : ""}" data-k="${x.key}" ${x.sort ? `aria-sort="${x.key === key ? (dir > 0 ? "ascending" : "descending") : "none"}" tabindex="0"` : ""}>${esc(x.label)}${x.key === key ? `<span class="arr">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead><tbody>${data.map((r, i) => `<tr class="${onRow ? "link" : ""}${r.__cls ? " " + r.__cls : ""}" data-i="${rows.indexOf(r)}">${cols.map((x) => `<td class="${x.cls || ""}">${x.render ? x.render(r) : esc(r[x.key])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<div class="empty">${esc(empty)}</div>`;
    host.querySelectorAll("th.sortable").forEach((th) => { const go = () => { if (key === th.dataset.k) dir = -dir; else { key = th.dataset.k; dir = 1; } draw(); }; th.onclick = go; th.onkeydown = (e) => { if (e.key === "Enter") go(); }; });
    if (onRow) host.querySelectorAll("tbody tr").forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("a,button,input,select")) return; onRow(rows[+tr.dataset.i]); }));
  };
  draw();
}

/** keyboard-friendly player picker → calls onPick(player). Returns { set(player), focus() } */
export function playerPicker(host, { onPick, initial, placeholder = "Type a name or Player ID…" }) {
  let chosen = initial || null, idx = 0, opts = [];
  const draw = () => {
    if (chosen) {
      host.innerHTML = `<div class="qe-chosen"><b>${esc(playerName(chosen))}</b><span class="muted small">${esc([chosen.position, chosen.affiliate, chosen.external_id && "ID " + chosen.external_id].filter(Boolean).join(" · "))}</span><button type="button" class="btn ghost sm" style="margin-left:auto" data-change aria-label="Change player">Change</button></div>`;
      host.querySelector("[data-change]").onclick = () => { chosen = null; draw(); host.querySelector("input").focus(); onPick(null); };
      return;
    }
    host.innerHTML = `<div class="qe-pick"><input type="search" placeholder="${esc(placeholder)}" aria-label="Player" autocomplete="off" role="combobox" aria-expanded="false"><div class="opts" hidden role="listbox"></div></div>`;
    const inp = host.querySelector("input"), box = host.querySelector(".opts");
    const render = async () => {
      opts = findPlayers(await players(), inp.value);
      idx = 0;
      box.hidden = !opts.length; inp.setAttribute("aria-expanded", String(!!opts.length));
      box.innerHTML = opts.map((p, i) => `<div class="opt${i === idx ? " on" : ""}" role="option" data-i="${i}"><b>${esc(playerName(p))}</b><span class="muted small">${esc([p.position, p.affiliate, p.external_id && "ID " + p.external_id].filter(Boolean).join(" · "))}</span></div>`).join("");
      box.querySelectorAll(".opt").forEach((o) => (o.onmousedown = (e) => { e.preventDefault(); pick(opts[+o.dataset.i]); }));
    };
    const pick = (p) => { if (!p) return; chosen = p; draw(); onPick(p); };
    inp.oninput = render;
    inp.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!opts.length) return; idx = (idx + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length; box.querySelectorAll(".opt").forEach((o, i) => o.classList.toggle("on", i === idx)); }
      else if (e.key === "Enter") { if (opts.length) { e.preventDefault(); pick(opts[idx]); } }
    };
    inp.onblur = () => setTimeout(() => (box.hidden = true), 150);
  };
  draw();
  return { set(p) { chosen = p; draw(); }, focus() { const i = host.querySelector("input"); if (i) i.focus(); else host.querySelector("button") && host.querySelector("button").focus(); }, get: () => chosen };
}

export function download(filename, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
