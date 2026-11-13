/* NMSBSBL — the break chart. One SVG (crisp at any size, prints cleanly): every pitch as a point, each pitch
   type's average as a labelled marker, optional 68% spread ellipses, the pitcher's arm-angle slot.

   Axes (AGORA's convention): x = horizontal break, inches, pitcher's view (+ = toward third base — arm side for a
   right-hander, glove side for a left-hander; never mirrored); y = induced vertical break, inches. Square, symmetric
   scale, 0 at the centre, so a pitch's direction and size read true.

   window.NMS_CHART.mount(el, { pitches, arsenal, throws, armAngle, mode, side, hidden, focus, spread, onChange })
     → { update(partial), destroy() }
   pitches: parsed by NMS_CORE (hb, ivb …); arsenal: NMS_CORE.arsenal rows for the same selection.
   Individual points are only drawn from real pitches; the aggregate view only from their averages. */
(function () {
  "use strict";
  const PT = window.AGORA_PITCHES, C = window.NMS_CORE;
  const NS = "http://www.w3.org/2000/svg";
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const S = 600, PAD = { l: 58, r: 18, t: 18, b: 56 }, W = S - PAD.l - PAD.r;   // plot square W × W
  const f1 = (v) => (isNum(v) ? v.toFixed(1) : "—"), f0 = (v) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
  const sgn = (v) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) : "—");
  const pctT = (v) => (isNum(v) ? (v * 100).toFixed(1) + "%" : "—");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateT = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : "—"; };
  const RESULT = { swinging_strike: "Swinging strike", swinging_strike_blocked: "Swinging strike", called_strike: "Called strike", ball: "Ball", blocked_ball: "Ball", foul: "Foul", foul_tip: "Foul tip", hit_into_play: "In play", hit_into_play_no_out: "In play", hit_into_play_score: "In play", hit_by_pitch: "Hit by pitch", foul_bunt: "Foul bunt", missed_bunt: "Missed bunt", pitchout: "Pitchout" };
  const EVENT = (e) => (e ? e.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
  function lum(hex) { const n = parseInt(String(hex).slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

  function mount(host, opts) {
    let o = Object.assign({ mode: "pitches", side: "", hidden: new Set(), focus: null, spread: true }, opts);
    host.classList.add("bc");
    host.innerHTML = `<div class="bc-plot"><svg class="bc-svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="Pitch movement chart"></svg><div class="bc-tip" role="status" aria-live="polite" hidden></div></div>`;
    const svg = host.querySelector("svg"), tip = host.querySelector(".bc-tip"), plot = host.querySelector(".bc-plot");
    let R = 25, scale = W / 50, hits = [], hoverKey = null;
    const X = (hb) => PAD.l + W / 2 + hb * scale, Y = (ivb) => PAD.t + W / 2 - ivb * scale;

    function render() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rows = o.arsenal.rows.filter((r) => r.movementN);
      const pts = o.pitches.filter((p) => isNum(p.hb) && isNum(p.ivb));
      R = C.axisRange(rows, pts); scale = W / (2 * R);
      const words = C.sideWords(o.throws);
      svg.setAttribute("aria-label", `Pitch movement chart: horizontal break against induced vertical break, ±${R} inches, ${o.mode === "pitches" ? pts.length + " pitches" : rows.length + " pitch-type averages"}. ${words.plus} to the right.`);
      // ── frame and grid ──
      const g = el("g", { class: "bc-grid" }, svg);
      el("rect", { x: PAD.l, y: PAD.t, width: W, height: W, class: "bc-bg" }, g);
      for (let v = -R; v <= R; v += 5) {
        const major = v % 10 === 0;
        el("line", { x1: X(v), x2: X(v), y1: PAD.t, y2: PAD.t + W, class: v === 0 ? "bc-zero" : major ? "bc-major" : "bc-minor" }, g);
        el("line", { y1: Y(v), y2: Y(v), x1: PAD.l, x2: PAD.l + W, class: v === 0 ? "bc-zero" : major ? "bc-major" : "bc-minor" }, g);
        if (major) {
          el("text", { x: X(v), y: PAD.t + W + 17, class: "bc-tick", "text-anchor": "middle" }, g).textContent = v > 0 ? "+" + v : v < 0 ? "−" + Math.abs(v) : "0";
          el("text", { x: PAD.l - 9, y: Y(v) + 4, class: "bc-tick", "text-anchor": "end" }, g).textContent = v > 0 ? "+" + v : v < 0 ? "−" + Math.abs(v) : "0";
        }
      }
      el("rect", { x: PAD.l, y: PAD.t, width: W, height: W, class: "bc-frame" }, g);
      // axis titles, with which way is arm side for THIS pitcher
      el("text", { x: PAD.l + W / 2, y: S - 12, class: "bc-axis", "text-anchor": "middle" }, g).textContent = "Horizontal break (in) · pitcher’s view";
      el("text", { x: PAD.l + 8, y: PAD.t + W - 9, class: "bc-side" }, g).textContent = "← " + words.minus;
      el("text", { x: PAD.l + W - 8, y: PAD.t + W - 9, class: "bc-side", "text-anchor": "end" }, g).textContent = words.plus + " →";
      const yt = el("text", { x: 16, y: PAD.t + W / 2, class: "bc-axis", "text-anchor": "middle", transform: `rotate(-90 16 ${PAD.t + W / 2})` }, g); yt.textContent = "Induced vertical break (in)";
      // arm-angle slot (Statcast arm_angle, degrees above horizontal), drawn toward the arm side
      if (isNum(o.armAngle)) {
        const dir = o.throws === "L" ? -1 : 1, th = (o.armAngle * Math.PI) / 180, L = R * 0.97;
        const ex = dir * L * Math.cos(th), ey = L * Math.sin(th);
        el("line", { x1: X(0), y1: Y(0), x2: X(ex), y2: Y(ey), class: "bc-arm" }, svg);
        // label at the outer end of the slot line, clear of the pitch clusters near the middle
        const lx = X(ex), ly = Y(ey);
        const t = el("text", { x: lx + (dir > 0 ? -4 : 4), y: Math.max(PAD.t + 14, ly + 15), class: "bc-armt", "text-anchor": dir > 0 ? "end" : "start" }, svg);
        t.textContent = `Arm angle ${Math.round(o.armAngle)}°`;
      }
      // clip so nothing spills over the frame
      const defs = el("defs", {}, svg), cp = el("clipPath", { id: "bcClip" + uid }, defs);
      el("rect", { x: PAD.l, y: PAD.t, width: W, height: W }, cp);
      const layer = el("g", { "clip-path": `url(#bcClip${uid})` }, svg);
      const visible = (t) => !o.hidden.has(t);
      const dim = (t) => o.focus && o.focus !== t;
      hits = [];
      // ── spread ellipses (68% of each type's pitches) ──
      if (o.spread) rows.forEach((r) => {
        if (!visible(r.type) || !r.ellipse) return;
        const i = PT.info(r.type), e = r.ellipse;
        el("ellipse", { cx: X(e.cx), cy: Y(e.cy), rx: e.rx * scale, ry: e.ry * scale, transform: `rotate(${(-e.angle * 180) / Math.PI} ${X(e.cx)} ${Y(e.cy)})`,
          class: "bc-ell" + (o.mode === "averages" ? " fill" : "") + (dim(r.type) ? " dim" : ""), style: `--c:${i.color}` }, layer);
      });
      // ── individual pitches: one path per type (thousands of points, one DOM node each type) ──
      if (o.mode === "pitches") {
        const r0 = pts.length > 2500 ? 2.6 : pts.length > 1200 ? 3 : 3.5;
        const byType = new Map();
        pts.forEach((p) => { if (!visible(p.type)) return; if (!byType.has(p.type)) byType.set(p.type, []); byType.get(p.type).push(p); });
        // draw the most-used types first so rarer pitches stay visible on top
        Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length).forEach(([t, list]) => {
          const i = PT.info(t); let d = "";
          list.forEach((p) => { const x = X(p.hb), y = Y(p.ivb); d += `M${(x - r0).toFixed(1)} ${y.toFixed(1)}a${r0} ${r0} 0 1 0 ${2 * r0} 0a${r0} ${r0} 0 1 0 ${-2 * r0} 0`; hits.push({ x, y, p }); });
          el("path", { d, class: "bc-pts" + (dim(t) ? " dim" : "") + (PT.needsOutline(i.color) ? " dark" : ""), style: `--c:${i.color}` }, layer);
        });
      }
      // ── averages: labelled markers; in the aggregate view sized by usage ──
      const avgLayer = el("g", { class: "bc-avgs" }, svg);
      rows.slice().sort((a, b) => a.usage - b.usage).forEach((r) => {
        if (!visible(r.type) || !isNum(r.hb) || !isNum(r.ivb)) return;
        const i = PT.info(r.type), x = X(r.hb), y = Y(r.ivb);
        const rad = o.mode === "averages" ? 9 + 22 * Math.sqrt(r.usage) : 11.5;
        const gm = el("g", { class: "bc-avg" + (dim(r.type) ? " dim" : "") + (o.focus === r.type ? " on" : ""), tabindex: "0", role: "button", "data-type": r.type,
          "aria-label": `${i.name}: ${pctT(r.usage)} of pitches, ${f1(r.velo)} mph, ${sgn(r.ivb)} in induced vertical break, ${sgn(r.hb)} in horizontal break` }, avgLayer);
        el("circle", { cx: x, cy: y, r: rad + 2.5, class: "bc-avg-halo" }, gm);
        el("circle", { cx: x, cy: y, r: rad, class: "bc-avg-dot", style: `fill:${i.color}` }, gm);
        const tx = el("text", { x, y: y + 4, "text-anchor": "middle", class: "bc-avg-t", style: `fill:${lum(i.color) > 0.55 ? "#111315" : "#fff"}` }, gm);
        tx.textContent = i.code;
        hits.push({ x, y, avg: r, rad });
      });
      if (!pts.length && !rows.length) el("text", { x: PAD.l + W / 2, y: PAD.t + W / 2, "text-anchor": "middle", class: "bc-empty" }, svg).textContent = "No pitches in this selection";
      hover(null);
    }

    // ── hover / tap: nearest point within reach (averages win when close) ──
    function svgPoint(ev) { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }
    function nearest(sx, sy) {
      let best = null, bd = Infinity;
      for (const h of hits) {
        if (h.avg) { const d = Math.hypot(h.x - sx, h.y - sy); if (d <= h.rad + 4 && d - 20 < bd) { best = h; bd = d - 20; } continue; }
        if (o.focus && h.p.type !== o.focus) continue;
        const d = Math.hypot(h.x - sx, h.y - sy); if (d < bd && d <= 9) { best = h; bd = d; }
      }
      return best;
    }
    let marker = null;
    function hover(h, ev) {
      if (marker) { marker.remove(); marker = null; }
      if (!h) { tip.hidden = true; hoverKey = null; return; }
      const i = PT.info(h.avg ? h.avg.type : h.p.type);
      if (h.p) { marker = el("circle", { cx: h.x, cy: h.y, r: 6.5, class: "bc-hover", style: `--c:${i.color}` }, svg); }
      tip.innerHTML = h.avg ? avgTip(h.avg, i) : pitchTip(h.p, i);
      tip.hidden = false;
      // place beside the point, inside the plot, in CSS pixels
      const box = svg.getBoundingClientRect(), k = box.width / S, pr = plot.getBoundingClientRect();
      const px = box.left - pr.left + h.x * k, py = box.top - pr.top + h.y * k;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = px + 14, top = py - th / 2;
      if (left + tw > pr.width - 4) left = px - tw - 14;
      left = Math.max(4, left); top = Math.max(4, Math.min(pr.height - th - 4, top));
      tip.style.left = left + "px"; tip.style.top = top + "px";
      hoverKey = h;
      void ev;
    }
    function pitchTip(p, i) {
      const res = RESULT[p.desc] || EVENT(p.desc), ev = p.event ? EVENT(p.event) : "";
      return `<div class="bc-tip-h"><i style="background:${i.color}"></i><b>${esc(i.name)}</b><span>${esc(dateT(p.date))}</span></div>
        <dl><dt>Velo</dt><dd>${f1(p.velo)} <small>mph</small></dd><dt>IVB</dt><dd>${sgn(p.ivb)} <small>in</small></dd><dt>HB</dt><dd>${sgn(p.hb)} <small>in</small></dd>
        <dt>Spin</dt><dd>${f0(p.spin)} <small>rpm</small></dd>${p.axis != null ? `<dt>Tilt</dt><dd>${C.tilt(p.axis)}</dd>` : ""}<dt>Ext</dt><dd>${f1(p.ext)} <small>ft</small></dd></dl>
        <div class="bc-tip-f">${p.balls != null ? `${p.balls}–${p.strikes} · ` : ""}vs ${p.stand === "L" ? "LHH" : "RHH"}${res ? " · " + esc(res) : ""}${ev && ev !== res ? " · " + esc(ev) : ""}</div>`;
    }
    function avgTip(r, i) {
      return `<div class="bc-tip-h"><i style="background:${i.color}"></i><b>${esc(i.name)}</b><span>Average · ${r.n.toLocaleString()} pitches</span></div>
        <dl><dt>Usage</dt><dd>${pctT(r.usage)}</dd><dt>Velo</dt><dd>${f1(r.velo)} <small>mph</small></dd><dt>IVB</dt><dd>${sgn(r.ivb)} <small>in</small></dd><dt>HB</dt><dd>${sgn(r.hb)} <small>in</small></dd>
        <dt>Spin</dt><dd>${f0(r.spin)} <small>rpm</small></dd>${r.axis != null ? `<dt>Tilt</dt><dd>${C.tilt(r.axis)}</dd>` : ""}<dt>Whiff</dt><dd>${pctT(r.whiffPct)}</dd></dl>
        <div class="bc-tip-f">${o.focus === r.type ? "Click to show every pitch type" : "Click to focus this pitch"}</div>`;
    }
    const onMove = (ev) => { const p = svgPoint(ev); const h = nearest(p.x, p.y); if (h !== hoverKey) hover(h, ev); };
    const onLeave = (ev) => { if (ev.pointerType === "mouse") hover(null); };
    const onClick = (ev) => {
      const p = svgPoint(ev), h = nearest(p.x, p.y);
      if (h && h.avg) { o.focus = o.focus === h.avg.type ? null : h.avg.type; render(); if (o.onChange) o.onChange({ focus: o.focus }); return; }
      if (ev.pointerType !== "mouse") hover(h, ev);
    };
    const onKey = (ev) => {
      const g = ev.target.closest && ev.target.closest(".bc-avg"); if (!g) return;
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); const t = g.dataset.type; o.focus = o.focus === t ? null : t; render(); if (o.onChange) o.onChange({ focus: o.focus }); const n = svg.querySelector(`.bc-avg[data-type="${t}"]`); if (n) n.focus(); }
    };
    const onFocusIn = (ev) => { const g = ev.target.closest && ev.target.closest(".bc-avg"); if (!g) return; const h = hits.find((x) => x.avg && x.avg.type === g.dataset.type); if (h) hover(h); };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);
    svg.addEventListener("pointerup", onClick);
    svg.addEventListener("keydown", onKey);
    svg.addEventListener("focusin", onFocusIn);
    svg.addEventListener("focusout", () => hover(null));
    const uid = Math.random().toString(36).slice(2, 7);
    render();
    return {
      update(partial) { o = Object.assign(o, partial); render(); },
      get state() { return { mode: o.mode, focus: o.focus, hidden: new Set(o.hidden), spread: o.spread, range: R }; },
      destroy() { host.innerHTML = ""; }
    };
  }
  window.NMS_CHART = { mount };
})();
