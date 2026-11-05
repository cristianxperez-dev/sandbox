/* FUEL — small SVG charts (no dependencies).
   Points are real observations. Lines join consecutive points only when they're within `join` days of each other;
   a longer gap is left open, so missing measurements are never drawn as if they existed. */
import { toDays, fromDays } from "./shared/util.js";

let W = 800;
const PADL = 50, PADR = 50, PADT = 14, PADB = 28;
const fit = (host) => { W = Math.max(300, Math.min(1400, Math.round(host.clientWidth || (host.parentElement && host.parentElement.clientWidth) || 800))); return W; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function niceScale(lo, hi, n = 4) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo: a, hi: b, ticks };
}
function dateTicks(d0, d1) {
  const span = d1 - d0, out = [];
  const step = span > 500 ? 90 : span > 200 ? 30 : span > 100 ? 21 : span > 45 ? 14 : span > 21 ? 7 : 2;
  if (step >= 30) { let d = new Date(fromDays(d0) + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); while (toDays(d.toISOString().slice(0, 10)) <= d1) { out.push(toDays(d.toISOString().slice(0, 10))); d.setUTCMonth(d.getUTCMonth() + (step === 90 ? 3 : 1)); } }
  else for (let d = d0; d <= d1; d += step) out.push(d);
  return out;
}

/** series: [{ label, color, unit, axis: "left"|"right", points: [{date, value, tip}], join: days, shape, dashed }] */
export function timeChart(host, { series, from, to, height = 250, refLines = [], emptyText = "No measurements in this window." }) {
  fit(host);
  const H = height;
  const all = series.flatMap((s) => s.points);
  if (!all.length) { host.innerHTML = `<div class="empty">${esc(emptyText)}</div>`; return; }
  const d0 = from ? toDays(from) : Math.min(...all.map((p) => toDays(p.date))), d1 = to ? toDays(to) : Math.max(...all.map((p) => toDays(p.date)));
  const X = (d) => PADL + ((d - d0) / Math.max(1, d1 - d0)) * (W - PADL - PADR);
  const axes = {};
  for (const side of ["left", "right"]) {
    const vals = series.filter((s) => (s.axis || "left") === side).flatMap((s) => s.points.map((p) => p.value)).concat(refLines.filter((r) => (r.axis || "left") === side).map((r) => r.value));
    if (vals.length) { const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.12 || 1; axes[side] = niceScale(lo - pad, hi + pad); }
  }
  const Y = (side, v) => { const a = axes[side]; return PADT + (1 - (v - a.lo) / (a.hi - a.lo)) * (H - PADT - PADB); };
  let g = "";
  const primary = axes.left ? "left" : "right";
  for (const t of axes[primary].ticks) g += `<line class="grid" x1="${PADL}" x2="${W - PADR}" y1="${Y(primary, t)}" y2="${Y(primary, t)}"/>`;
  for (const side of Object.keys(axes)) {
    const x = side === "left" ? PADL - 6 : W - PADR + 6, anchor = side === "left" ? "end" : "start";
    const s0 = series.find((s) => (s.axis || "left") === side);
    for (const t of axes[side].ticks) g += `<text class="ax" x="${x}" y="${Y(side, t) + 4}" text-anchor="${anchor}" fill="${s0 ? s0.color : ""}">${+t.toFixed(2)}</text>`;
  }
  const monthly = d1 - d0 > 200;
  for (const d of dateTicks(d0, d1)) g += `<text class="ax" x="${X(d)}" y="${H - 8}" text-anchor="middle">${esc(new Date(fromDays(d) + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: monthly ? undefined : "numeric", timeZone: "UTC" }))}</text>`;
  for (const r of refLines) { const y = Y(r.axis || "left", r.value); g += `<line x1="${PADL}" x2="${W - PADR}" y1="${y}" y2="${y}" stroke="${r.color}" stroke-dasharray="5 4" stroke-width="1.3"/><text class="ax" x="${W - PADR - 4}" y="${y - 4}" text-anchor="end" fill="${r.color}">${esc(r.label)}</text>`; }
  const hits = [];
  series.forEach((s, si) => {
    const pts = s.points.slice().sort((a, b) => a.date.localeCompare(b.date));
    const side = s.axis || "left";
    let path = "";
    for (let i = 0; i < pts.length; i++) {
      const x = X(toDays(pts[i].date)), y = Y(side, pts[i].value);
      const joined = i > 0 && s.join && toDays(pts[i].date) - toDays(pts[i - 1].date) <= s.join;
      path += `${joined ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      hits.push({ x, y, s, p: pts[i] });
    }
    if (s.join) g += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-opacity=".55" ${s.dashed ? 'stroke-dasharray="4 3"' : ""}/>`;
    const r = s.size || (pts.length > 120 ? 2.2 : pts.length > 40 ? 2.8 : 4);
    for (const h of hits.filter((h) => h.s === s)) g += s.shape === "diamond"
      ? `<rect x="${h.x - r - 1.5}" y="${h.y - r - 1.5}" width="${2 * r + 3}" height="${2 * r + 3}" transform="rotate(45 ${h.x} ${h.y})" fill="#fff" stroke="${s.color}" stroke-width="2"/>`
      : `<circle cx="${h.x}" cy="${h.y}" r="${r}" fill="${s.hollow ? "#fff" : s.color}" stroke="${s.color}" stroke-width="${s.hollow ? 1.8 : 0}"/>`;
  });
  host.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(" and "))} over time">${g}<line class="cross" x1="0" x2="0" y1="${PADT}" y2="${H - PADB}" stroke="#98A2B3" stroke-dasharray="3 3" visibility="hidden"/></svg><div class="tip" hidden></div></div>`;
  wireTip(host, hits, (h) => `<b>${esc(h.s.label)}</b><br>${esc(fmtD(h.p.date))} · <b>${esc(h.p.value)}</b> ${esc(h.s.unit || "")}${h.p.tip ? "<br>" + esc(h.p.tip) : ""}`, H);
}

export function scatter(host, { pairs, xLabel, yLabel, xUnit, yUnit, height = 250 }) {
  fit(host);
  const H = height;
  if (!pairs.length) { host.innerHTML = `<div class="empty">No matched pairs yet.</div>`; return; }
  const xs = niceScale(Math.min(...pairs.map((p) => p.x)) - 0.5, Math.max(...pairs.map((p) => p.x)) + 0.5);
  const ys = niceScale(Math.min(...pairs.map((p) => p.y)) - 0.5, Math.max(...pairs.map((p) => p.y)) + 0.5);
  const X = (v) => PADL + ((v - xs.lo) / (xs.hi - xs.lo)) * (W - PADL - PADR), Y = (v) => PADT + (1 - (v - ys.lo) / (ys.hi - ys.lo)) * (H - PADT - PADB - 10);
  let g = "";
  for (const t of ys.ticks) g += `<line class="grid" x1="${PADL}" x2="${W - PADR}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${PADL - 6}" y="${Y(t) + 4}" text-anchor="end">${+t.toFixed(2)}</text>`;
  for (const t of xs.ticks) g += `<text class="ax" x="${X(t)}" y="${H - 18}" text-anchor="middle">${+t.toFixed(2)}</text>`;
  g += `<text class="ax" x="${(W) / 2}" y="${H - 2}" text-anchor="middle">${esc(xLabel)} (${esc(xUnit)}) →</text><text class="ax" x="${PADL + 4}" y="${PADT + 2}" text-anchor="start" font-weight="600">↑ ${esc(yLabel)} (${esc(yUnit)})</text>`;
  const hits = pairs.map((p) => ({ x: X(p.x), y: Y(p.y), p }));
  for (const h of hits) g += `<circle cx="${h.x}" cy="${h.y}" r="5" fill="#EB6E1F" fill-opacity=".75" stroke="#002D62" stroke-width="1.2"/>`;
  host.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(xLabel)} against ${esc(yLabel)}">${g}</svg><div class="tip" hidden></div></div>`;
  wireTip(host, hits, (h) => `${esc(xLabel)}: <b>${h.p.x}</b> ${esc(xUnit)} (${esc(fmtD(h.p.xDate))})<br>${esc(yLabel)}: <b>${h.p.y}</b> ${esc(yUnit)} (${esc(fmtD(h.p.yDate))})<br>${h.p.gap} day${h.p.gap === 1 ? "" : "s"} apart`, H, true);
}

export function sparkline(points, { width = 120, height = 28, color = "#0B3D7A", join = 10 } = {}) {
  if (points.length < 2) return "";
  const d = points.map((p) => toDays(p.date)), v = points.map((p) => p.value);
  const d0 = Math.min(...d), d1 = Math.max(...d), lo = Math.min(...v), hi = Math.max(...v);
  const X = (x) => 2 + ((x - d0) / Math.max(1, d1 - d0)) * (width - 4), Y = (y) => 2 + (1 - (y - lo) / Math.max(0.1, hi - lo)) * (height - 4);
  let path = "";
  points.forEach((p, i) => { path += `${i && d[i] - d[i - 1] <= join ? "L" : "M"}${X(d[i]).toFixed(1)},${Y(v[i]).toFixed(1)}`; });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="${X(d[d.length - 1])}" cy="${Y(v[v.length - 1])}" r="2.5" fill="${color}"/></svg>`;
}

function wireTip(host, hits, html, H, strict) {
  const CW = W;
  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), cross = host.querySelector(".cross");
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), sx = CW / r.width;
    const pt = ev.touches ? ev.touches[0] : ev;
    const mx = (pt.clientX - r.left) * sx, my = (pt.clientY - r.top) * sx;
    let best = null, bd = Infinity;
    for (const h of hits) { const dd = strict ? Math.hypot(h.x - mx, h.y - my) : Math.abs(h.x - mx) + Math.abs(h.y - my) * 0.25; if (dd < bd) { bd = dd; best = h; } }
    if (!best || bd > (strict ? 30 : 60)) { tip.hidden = true; if (cross) cross.setAttribute("visibility", "hidden"); return; }
    tip.hidden = false; tip.innerHTML = html(best);
    tip.style.left = (best.x / sx) + "px"; tip.style.top = (best.y / sx) + "px";
    if (cross) { cross.setAttribute("x1", best.x); cross.setAttribute("x2", best.x); cross.setAttribute("visibility", "visible"); }
  };
  svg.addEventListener("mousemove", move); svg.addEventListener("touchstart", move, { passive: true });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; if (cross) cross.setAttribute("visibility", "hidden"); });
}
