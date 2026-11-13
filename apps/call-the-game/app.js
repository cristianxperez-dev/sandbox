/* Call the Game — UI controller: pitcher choice → advance report → call the inning → review.
   State lives in localStorage "ctg.v1" (settings, the inning in progress as seed + calls, and the last 10 innings). */
(function () {
  "use strict";
  const C = window.CTG, A = window.CTGAudio, $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const app = $("#app"), modal = $("#modal"), live = $("#live");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KEY = "ctg.v1";
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ store */
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } }
  let store = Object.assign({ settings: {}, current: null, history: [] }, load());
  store.settings = Object.assign({ speed: reduced ? "skip" : 1, muted: false, showZone: true, wUsage: 0.5 }, store.settings);
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {} }

  /* ------------------------------------------------------------------ header tools */
  const speeds = [1, 2, "skip"], speedLabel = (s) => (s === "skip" ? "Skip" : s + "×");
  const btnSpeed = $("#btn-speed"), btnSound = $("#btn-sound"), btnReport = $("#btn-report");
  function syncTools() {
    btnSpeed.textContent = speedLabel(store.settings.speed); btnSpeed.setAttribute("aria-label", "Playback speed: " + speedLabel(store.settings.speed));
    btnSound.textContent = store.settings.muted ? "Muted" : "Sound"; btnSound.setAttribute("aria-pressed", String(!store.settings.muted));
    btnSound.setAttribute("aria-label", store.settings.muted ? "Sound off — turn on" : "Sound on — mute");
    A.setMuted(store.settings.muted);
  }
  btnSpeed.addEventListener("click", () => { store.settings.speed = speeds[(speeds.indexOf(store.settings.speed) + 1) % speeds.length]; save(); syncTools(); });
  btnSound.addEventListener("click", () => { store.settings.muted = !store.settings.muted; save(); syncTools(); if (!store.settings.muted) A.startCrowd(); });
  btnReport.addEventListener("click", () => { if (G.pitcher) openReport(G.pitcher); });
  syncTools();

  /* ------------------------------------------------------------------ shared graphics (catcher's view charts) */
  const PAD = window.CTGScene.PAD, PX = 100;
  const mx = (x) => (x - PAD.x0) * PX, mz = (z) => (PAD.z1 - z) * PX, VW = (PAD.x1 - PAD.x0) * PX, VH = (PAD.z1 - PAD.z0) * PX;
  function zoneBase(p, opts) {
    const o = opts || {}, s = p ? C.armSign(p.hand) : -1;
    const left = s === -1 ? "Arm side" : "Glove side", right = s === -1 ? "Glove side" : "Arm side";
    const grid = [1 / 3, 2 / 3].map((t) => `<line x1="${mx(-0.83 + 1.66 * t)}" y1="${mz(3.45)}" x2="${mx(-0.83 + 1.66 * t)}" y2="${mz(1.55)}"/><line x1="${mx(-0.83)}" y1="${mz(3.45 - 1.9 * t)}" x2="${mx(0.83)}" y2="${mz(3.45 - 1.9 * t)}"/>`).join("");
    const bat = o.batter ? `<rect class="zc__bat" x="${o.batter === "R" ? 0 : mx(1.25)}" y="${mz(4.3)}" width="${mx(-1.25)}" height="${VH}"/><text class="zc__batl" x="${o.batter === "R" ? 10 : VW - 10}" y="${mz(0.95)}" text-anchor="${o.batter === "R" ? "start" : "end"}">${o.batter}HH</text>` : "";
    return `<rect class="zc__bg" x="0" y="0" width="${VW}" height="${VH}"/>${bat}<g class="zc__grid">${grid}</g><rect class="zc__zone" x="${mx(-0.83)}" y="${mz(3.45)}" width="${166}" height="${190}"/>` +
      `<path class="zc__plate" d="M${mx(-0.71)} ${mz(0.86)} h${142} l0 ${10} l${-71} ${14} l${-71} ${-14}z"/>` +
      (o.sides === false ? "" : `<text class="zc__side" x="8" y="18">${left}</text><text class="zc__side" x="${VW - 8}" y="18" text-anchor="end">${right}</text>`);
  }
  const svg = (inner, cls, label) => `<svg class="zc ${cls || ""}" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${esc(label || "Catcher's-view strike zone chart")}">${inner}</svg>`;
  function gloveIcon(x, z, r, cls) {
    const X = mx(x), Y = mz(z), R = r || 22;
    return `<g class="glove ${cls || ""}" transform="translate(${X} ${Y})"><ellipse rx="${R}" ry="${R * 0.92}" class="glove__body"/><ellipse cx="${R * 0.8}" cy="${R * 0.2}" rx="${R * 0.27}" ry="${R * 0.5}" class="glove__thumb" transform="rotate(-20 ${R * 0.8} ${R * 0.2})"/><circle r="${Math.max(3, R * 0.16)}" class="glove__aim"/></g>`;
  }
  /** the glove-target reticle — the same mark the 3D scene draws on the plate plane */
  function reticleIcon(x, z, col, small) {
    const X = mx(x), Y = mz(z), r = small ? 8 : 15, c = col || "#2a2622";
    const ticks = [0, 90, 180, 270].map((a) => { const s = Math.sin((a * Math.PI) / 180), k = Math.cos((a * Math.PI) / 180); return `<line x1="${X + k * (r + 3)}" y1="${Y + s * (r + 3)}" x2="${X + k * (r + 10)}" y2="${Y + s * (r + 10)}"/>`; }).join("");
    return `<g class="reticle" stroke="${c}"><circle cx="${X}" cy="${Y}" r="${r}"/>${small ? "" : ticks}<circle cx="${X}" cy="${Y}" r="2.5" fill="${c}" stroke="none"/></g>`;
  }
  /** covariance ellipse (catcher x/z) for a miss model, k sigmas */
  function ellipse(M, k) {
    const sx = M.sdA, sz = M.sdz, cov = M.s * M.rho * sx * sz;
    const a = sx * sx, b = cov, d = sz * sz, tr = a + d, det = a * d - b * b, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
    const ang = Math.atan2(l1 - a, b || 1e-9);
    return { rx: k * Math.sqrt(l1) * PX, rz: k * Math.sqrt(Math.max(l2, 1e-6)) * PX, deg: (-ang * 180) / Math.PI };
  }
  function corridorChart(p, a, hand) {
    const s = C.armSign(p.hand), col = C.PITCH_COLORS[a.code], corr = (a.corridorByHand && a.corridorByHand[hand]) || a.corridor;
    const blobs = corr.map((c) => { const X = mx(c.a * s), Y = mz(c.z); return `<ellipse cx="${X}" cy="${Y}" rx="${c.sa * PX * 2}" ry="${c.sz * PX * 2}" fill="${col}" fill-opacity="${0.16 * c.w}"/><ellipse cx="${X}" cy="${Y}" rx="${c.sa * PX}" ry="${c.sz * PX}" fill="${col}" fill-opacity="${0.42 * c.w}" stroke="${col}" stroke-width="2"/>`; }).join("");
    return svg(zoneBase(p) + blobs, "zc--corr", `${a.code} preferred location corridor, catcher's view`);
  }
  function missChart(p, a) {
    const s = C.armSign(p.hand), col = C.PITCH_COLORS[a.code], gloves = [];
    if (a.miss.sideSd) gloves.push({ x: 0.55 * s, z: 2.5 }, { x: -0.55 * s, z: 2.5 });
    else { const c = a.corridor[0]; gloves.push({ x: clampN(c.a * s, -1, 1), z: clampN(c.z, 1.4, 3.6) }); }
    let g = "";
    for (const t of gloves) {
      const M = C.missModel(p, a, t), cxp = mx(t.x + M.mx), cyp = mz(t.z + M.mz), e1 = ellipse(M, 1), e2 = ellipse(M, 2);
      g += `<ellipse cx="${cxp}" cy="${cyp}" rx="${e2.rx}" ry="${e2.rz}" transform="rotate(${e2.deg} ${cxp} ${cyp})" class="miss2" fill="${col}"/>` +
        `<ellipse cx="${cxp}" cy="${cyp}" rx="${e1.rx}" ry="${e1.rz}" transform="rotate(${e1.deg} ${cxp} ${cyp})" class="miss1" fill="${col}" stroke="${col}"/>` +
        gloveIcon(t.x, t.z, 16) + `<line class="miss__arrow" x1="${mx(t.x)}" y1="${mz(t.z)}" x2="${cxp}" y2="${cyp}"/><circle cx="${cxp}" cy="${cyp}" r="4" class="miss__mean"/>`;
    }
    return svg(zoneBase(p) + g, "zc--miss", `${a.code} miss tendency: where the pitch finishes relative to the glove`);
  }
  function movementInset(p, a) {
    const s = C.armSign(p.hand), sc = 2.6, cx0 = 60, cy0 = 60, hx = cx0 + a.hbArm * s * sc, hy = cy0 - a.ivb * sc, col = C.PITCH_COLORS[a.code];
    return `<svg class="mv" viewBox="0 0 120 120" role="img" aria-label="${a.code} movement: ${Math.round(a.hbArm)} in arm-side, ${Math.round(a.ivb)} in induced vertical"><rect x="1" y="1" width="118" height="118" class="mv__bg"/><line x1="60" y1="6" x2="60" y2="114" class="mv__ax"/><line x1="6" y1="60" x2="114" y2="60" class="mv__ax"/>` +
      `<line x1="${cx0}" y1="${cy0}" x2="${hx}" y2="${hy}" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="5" fill="${col}"/><text x="6" y="114" class="mv__t">↑ rise · arm side →</text></svg>`;
  }
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  function usageBar(p, mix, label, sub) {
    const segs = p.arsenal.map((a) => ({ code: a.code, v: mix[a.code] || 0 })).filter((x) => x.v > 0);
    return `<div class="ubar"><div class="ubar__l">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</div><div class="ubar__track" role="img" aria-label="${esc(label)}: ${segs.map((s) => `${s.code} ${Math.round(s.v * 100)}%`).join(", ")}">${segs.map((s) => `<span class="ubar__seg" data-w="${(s.v * 100).toFixed(2)}" data-c="${C.PITCH_COLORS[s.code]}"><b>${s.code}</b> ${Math.round(s.v * 100)}%</span>`).join("")}</div></div>`;
  }
  /** CSP forbids inline styles: apply widths and colours through the CSSOM */
  function paint(root) {
    $$("[data-w]", root).forEach((el) => { el.style.width = el.dataset.w + "%"; if (el.dataset.w < 9) el.classList.add("is-narrow"); else if (el.dataset.w < 17) el.classList.add("is-tight"); });
    $$("[data-c]", root).forEach((el) => { el.style.setProperty("--pc", el.dataset.c); });
  }
  const chip = (code) => `<span class="pchip" data-c="${C.PITCH_COLORS[code]}">${code}</span>`;

  /* ------------------------------------------------------------------ views */
  const G = { pitcher: null, st: null, scene: null, code: null, target: null, busy: false, review: null };
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [view, arg] = h.split("/");
    btnReport.hidden = view !== "play";
    document.body.dataset.view = view || "home";
    if (view === "report" && C.pitcherById(arg)) return viewReport(C.pitcherById(arg));
    if (view === "play" && G.st) return viewGame();
    if (view === "review" && G.st && G.st.over) return viewReview();
    if (view === "play" && store.current) { resume(); return viewGame(); }
    viewHome();
  }
  window.addEventListener("hashchange", route);

  function viewHome() {
    const cur = store.current && C.pitcherById(store.current.pitcherId);
    const hist = (store.history || []).slice(0, 5);
    app.innerHTML = `<section class="paper home">
      <div class="home__hero"><p class="kicker">Catcher pitch-calling simulator</p><h1>Call the Game</h1><p class="lede">You're behind the plate for one inning. Study the advance report, call every pitch, set the glove where his misses will work for you — and get graded on the plan, not the luck. <strong>Do what you do.</strong></p></div>
      ${cur && !store.current.over ? `<div class="resume"><span>Inning in progress with <b>${esc(cur.name)}</b> — ${store.current.calls.length} pitch${store.current.calls.length === 1 ? "" : "es"} called.</span><a class="btn btn--primary" href="#/play">Resume inning</a></div>` : ""}
      <h2 class="h2">Choose your pitcher</h2>
      <div class="pcards">${C.PITCHERS.map(pitcherCard).join("")}</div>
      ${hist.length ? `<h2 class="h2">Recent innings</h2><ul class="hist">${hist.map((h) => `<li><span>${esc(C.pitcherById(h.pitcherId).name)}</span><span>${new Date(h.at).toLocaleDateString()}</span><span>${h.summary.R} R · ${h.summary.H} H · ${h.summary.K} K · ${h.summary.BB} BB</span><b class="grade grade--${band(h.overall)}">${h.overall}</b></li>`).join("")}</ul>` : ""}
      <p class="fine">Fictional pitchers and hitters. The grade measures your calls — pitch mix and glove targets — never the result of the pitch.</p>
    </section>`;
    paint(app); app.focus();
  }
  function pitcherCard(p) {
    return `<article class="pcard"><div class="pcard__top"><span class="pcard__num" data-c="${p.jersey.trim}">${p.jersey.num}</span><div><h3>${esc(p.name)}</h3><p class="meta">${p.hand}HP · ${p.age} · ${esc(p.height)}, ${p.weight} lb</p></div></div>
      <p class="pcard__style">${esc(p.style)}</p>
      <ul class="arsenal">${p.arsenal.map((a) => `<li>${chip(a.code)}<span>${esc(C.PITCH_NAMES[a.code])}</span><span class="v">${a.velo.toFixed(1)}</span></li>`).join("")}</ul>
      <p class="pcard__sum">${esc(p.summary)}</p>
      <a class="btn btn--primary" href="#/report/${p.id}" data-pick="${p.id}">Scout ${esc(p.name.split(" ")[0])}</a></article>`;
  }

  /* -------------------------------------------- advance report */
  function reportBody(p, compact, hand) {
    const usage = `<div class="usage">${usageBar(p, Object.fromEntries(p.arsenal.map((a) => [a.code, a.usage.R])), "vs RHH")}${usageBar(p, Object.fromEntries(p.arsenal.map((a) => [a.code, a.usage.L])), "vs LHH")}</div>`;
    const pitches = p.arsenal.map((a) => `<article class="pitch" data-c="${C.PITCH_COLORS[a.code]}">
        <header class="pitch__h">${chip(a.code)}<h3>${esc(C.PITCH_NAMES[a.code])}</h3><span class="pitch__v">${a.velo.toFixed(1)} mph · ${Math.round(a.ivb)}″ IVB · ${Math.round(Math.abs(a.hbArm))}″ ${a.hbArm >= 0 ? "arm-side" : "glove-side"}</span><span class="pitch__u">vs R ${Math.round(a.usage.R * 100)}% · vs L ${Math.round(a.usage.L * 100)}%</span></header>
        <div class="pitch__charts">
          <figure><figcaption>Where it plays</figcaption>${corridorChart(p, a, hand || "R")}</figure>
          <figure><figcaption>How he misses <small>glove = target · cloud = where it finishes (1σ, 2σ)</small></figcaption>${missChart(p, a)}</figure>
          ${compact ? "" : `<figure class="fig-mv"><figcaption>Movement <small>not a miss</small></figcaption>${movementInset(p, a)}</figure>`}
        </div>
        <p class="pitch__note">${esc(a.note)} <span class="muted">Typical miss: ${missWords(a)}.</span></p></article>`).join("");
    return `<div class="plan"><h2 class="h2">Game plan</h2><p>${esc(p.plan)}</p></div><h2 class="h2">Target usage</h2>${usage}<p class="fine">Usage shifts with the count (more fastballs when behind, more put-away pitches with two strikes); grading accounts for the counts you were in.</p><h2 class="h2">Pitch by pitch <small>catcher's view</small></h2><div class="pitches">${pitches}</div>`;
  }
  function missWords(a) {
    const m = a.miss, h = Math.abs(m.biasArm) >= 1 ? `${Math.abs(m.biasArm).toFixed(1)} in ${m.biasArm > 0 ? "arm-side" : "glove-side"}` : "on line", v = Math.abs(m.biasUp) >= 1 ? `${Math.abs(m.biasUp).toFixed(1)} in ${m.biasUp > 0 ? "up" : "down"}` : "";
    const side = m.sideSd ? `; spread ${m.sideSd.arm > m.sideSd.glove ? "wider arm-side" : "wider glove-side"}` : "";
    return [h, v].filter(Boolean).join(", ") + ` of the glove, spread about ±${Math.round((m.sdH + m.sdV) / 2)} in${side}`;
  }
  function viewReport(p) {
    G.pitcher = p;
    app.innerHTML = `<section class="paper report"><a class="back" href="#/">← Pitchers</a>
      <header class="rhead"><span class="pcard__num pcard__num--lg" data-c="${p.jersey.trim}">${p.jersey.num}</span><div><p class="kicker">Advance report</p><h1>${esc(p.name)}</h1><p class="meta">${p.hand}HP · ${esc(p.style)}</p></div></header>
      ${reportBody(p, false)}
      <div class="startbar"><button class="btn btn--primary btn--big" id="start" type="button">Start inning</button></div></section>`;
    paint(app);
    $("#start").addEventListener("click", () => { A.startCrowd(); startInning(p, (Math.random() * 2 ** 31) >>> 0); });
    app.focus(); window.scrollTo(0, 0);
  }
  function openReport(p) {
    const b = G.st && C.batterOf(G.st);
    $("#modal-body").innerHTML = `<header class="modal__h"><h2 id="modal-title">${esc(p.name)} — advance report</h2><button class="tool tool--dark" type="button" id="modal-close">Close</button></header>${reportBody(p, true, b ? b.hand : "R")}`;
    paint(modal); modal.showModal(); $("#modal-close").addEventListener("click", () => modal.close());
  }
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

  /* -------------------------------------------- the inning */
  function startInning(p, seed) {
    G.pitcher = p; G.st = C.newInning({ seed, pitcherId: p.id }); G.code = null; G.target = null; G.lastRec = null;
    store.current = { seed, pitcherId: p.id, calls: [], over: false }; save();
    location.hash = "#/play"; if (location.hash === "#/play") route();
  }
  function resume() {
    const cur = store.current, p = C.pitcherById(cur.pitcherId);
    G.pitcher = p; G.st = C.newInning({ seed: cur.seed, pitcherId: p.id });
    for (const c of cur.calls) { if (G.st.over) break; G.lastRec = C.playPitch(G.st, c); }
    G.code = null; G.target = G.lastRec ? G.lastRec.target : null;
  }
  function viewGame() {
    const p = G.pitcher;
    app.innerHTML = `<section class="game">
      <div class="stage"><canvas id="scene" aria-label="Catcher's view of the pitcher and hitter. Tap or drag to set the glove."></canvas>
        <div class="sb" id="sb"></div><div class="toast" id="toast" hidden></div></div>
      <aside class="panel">
        <div class="batter" id="batter"></div>
        <div class="pbtns" id="pbtns" role="radiogroup" aria-label="Pitch type">${p.arsenal.map((a, i) => `<button type="button" class="pbtn" role="radio" aria-checked="false" data-code="${a.code}" data-c="${C.PITCH_COLORS[a.code]}"><span class="pbtn__k">${i + 1}</span><b>${a.code}</b><small>${esc(C.PITCH_NAMES[a.code])}</small></button>`).join("")}</div>
        <div class="aimrow"><div class="padwrap"><div class="pad__h"><span>Set the glove</span></div><div class="pad" id="pad" tabindex="0" role="application" aria-label="Glove target pad, catcher's view. Arrow keys move the glove."></div></div>
          <div class="aimside"><p class="tgt-read" id="tgt-read">Tap or drag</p><div class="last" id="last"></div><button class="btn btn--primary btn--call" id="call" type="button" disabled>Call pitch</button></div></div>
        <div class="extra"><div class="log" id="log" aria-label="Pitches this inning"></div>
        <label class="opt"><input type="checkbox" id="opt-zone" ${store.settings.showZone ? "checked" : ""}> Show strike zone in the scene</label></div>
      </aside></section>`;
    paint(app);
    const canvas = $("#scene");
    G.scene = window.CTGScene.create(canvas, { onTarget: setTarget, onImpact });
    $$(".pbtn").forEach((b) => b.addEventListener("click", () => setCode(b.dataset.code)));
    $("#call").addEventListener("click", callPitch);
    $("#opt-zone").addEventListener("change", (e) => { store.settings.showZone = e.target.checked; save(); G.scene.set({ showZone: e.target.checked }); });
    const pad = $("#pad"); renderPad();
    const padEvt = (e) => { if (G.busy) return; const svgEl = $("svg", pad); const r = svgEl.getBoundingClientRect(); const x = PAD.x0 + ((e.clientX - r.left) / r.width) * (PAD.x1 - PAD.x0), z = PAD.z1 - ((e.clientY - r.top) / r.height) * (PAD.z1 - PAD.z0); e.preventDefault(); setTarget({ x: clampN(x, PAD.x0, PAD.x1), z: clampN(z, PAD.z0, PAD.z1) }); };
    let drag = false;
    pad.addEventListener("pointerdown", (e) => { drag = true; try { pad.setPointerCapture(e.pointerId); } catch (_) {} padEvt(e); });
    pad.addEventListener("pointermove", (e) => { if (drag) padEvt(e); });
    pad.addEventListener("pointerup", () => (drag = false)); pad.addEventListener("pointercancel", () => (drag = false));
    pad.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (!k || G.busy) return;
      e.preventDefault(); const st = e.shiftKey ? 0.2 : 0.05, t = G.target || { x: 0, z: 2.5 }; setTarget({ x: clampN(t.x + k[0] * st, PAD.x0, PAD.x1), z: clampN(t.z + k[1] * st, PAD.z0, PAD.z1) });
    });
    syncGame();
  }
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.view !== "play" || modal.open || G.busy) return;
    if (/^[1-4]$/.test(e.key) && G.pitcher && G.pitcher.arsenal[+e.key - 1]) { setCode(G.pitcher.arsenal[+e.key - 1].code); }
    else if (e.key === "Enter" && !$("#call").disabled && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); callPitch(); }
  });
  function setCode(code) { if (G.busy) return; G.code = code; $$(".pbtn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.code === code))); G.scene.set({ code }); syncCall(); renderPad(); }
  function setTarget(t) { if (G.busy) return; G.target = { x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100 }; G.scene.set({ target: G.target }); renderPad(); syncCall(); }
  function syncCall() {
    const ok = !!(G.code && G.target && !G.busy && !G.st.over);
    $("#call").disabled = !ok;
    $("#call").textContent = G.st.over ? "Inning over" : !G.code ? "Choose a pitch" : !G.target ? "Set the glove" : `Call ${G.code}`;
    const tr = $("#tgt-read"); if (tr) tr.textContent = G.target ? targetWords(G.target) : "Tap or drag";
  }
  function targetWords(t) {
    const s = C.armSign(G.pitcher.hand), a = t.x * s, inX = Math.abs(t.x) <= 0.83, inZ = t.z >= 1.55 && t.z <= 3.45;
    const v = t.z > 3.45 ? "above the zone" : t.z < 1.55 ? "below the zone" : t.z > 2.85 ? "up" : t.z < 2.15 ? "down" : "middle height";
    const h = Math.abs(t.x) < 0.25 ? "middle" : (a > 0 ? "arm-side" : "glove-side") + (inX ? "" : ", off the plate");
    return `${inX && inZ ? "In zone" : "Out of zone"} · ${h} · ${v}`;
  }
  function renderPad() {
    const pad = $("#pad"); if (!pad) return;
    const b = C.batterOf(G.st), t = G.target, col = G.code ? C.PITCH_COLORS[G.code] : null;
    const recent = G.st.calls.filter((c) => c.batter.id === b.id).map((c) => `<circle cx="${mx(c.end.x)}" cy="${mz(c.end.z)}" r="7" fill="${C.PITCH_COLORS[c.code]}" class="pad__prev"/><text x="${mx(c.end.x)}" y="${mz(c.end.z) + 3.5}" class="pad__n">${c.count.balls + c.count.strikes + 1}</text>`).join("");
    pad.innerHTML = svg(zoneBase(G.pitcher, { batter: b.hand }) + recent + (t ? reticleIcon(t.x, t.z, col) : ""), "zc--pad", "Glove target pad");
    if (col) pad.style.setProperty("--pc", col);
  }
  function syncGame() {
    const st = G.st, b = C.batterOf(st), p = G.pitcher;
    G.scene.set({ pitcher: p, batter: b, target: G.target, showZone: store.settings.showZone, aim: !G.busy && !st.over, last: G.lastRec || null });
    const bases = st.bases.map((x, i) => `<span class="base b${i + 1} ${x ? "on" : ""}"></span>`).join("");
    const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? cls : ""}"></i>`).join("");
    $("#sb").innerHTML = `<div class="sb__row"><span class="sb__inn">INN 1</span><span class="sb__runs">R ${st.runs}</span><span class="diamond" aria-label="Runners: ${st.bases.map((x, i) => (x ? ["first", "second", "third"][i] : null)).filter(Boolean).join(", ") || "none"}">${bases}</span>
      <span class="sb__cnt" aria-label="Count ${st.balls}-${st.strikes}"><b>${st.balls}-${st.strikes}</b><span class="dots"><span class="dl">B</span>${dots(st.balls, 3, "ball")}</span><span class="dots"><span class="dl">S</span>${dots(st.strikes, 2, "strike")}</span></span>
      <span class="sb__outs" aria-label="${st.outs} out"><span class="dl">OUT</span>${dots(st.outs, 2, "out")}</span><span class="sb__pc">P ${st.pitches}</span></div>`;
    $("#batter").innerHTML = `<div class="batter__n"><span class="batter__ord">${(st.batterIdx % 9) + 1}</span><div><b>${esc(b.name)}</b><small>${b.pos} · Bats ${b.hand === "R" ? "right" : "left"}</small></div><span class="hand hand--${b.hand}">${b.hand}HH</span></div>
      <div class="batter__plan">Plan vs ${b.hand}HH: ${p.arsenal.map((a) => `${chip(a.code)} ${Math.round(a.usage[b.hand] * 100)}%`).join(" ")}</div>`;
    const lr = st.calls[st.calls.length - 1];
    $("#last").innerHTML = lr ? `<span class="last__k">Last</span>${chip(lr.code)} <b>${esc(lr.event.label)}</b> <span class="muted">${lr.end.velo.toFixed(1)}</span>` : "";
    $("#log").innerHTML = st.calls.length ? `<ol>${st.calls.slice().reverse().slice(0, 8).map((c) => `<li>${chip(c.code)}<span>${c.count.balls}-${c.count.strikes}</span><span class="log__r">${esc(c.event.label)}</span><span class="muted">${c.end.velo.toFixed(1)}</span></li>`).join("")}</ol>` : `<p class="muted">Choose a pitch (1–${p.arsenal.length}), set the glove, then call it. Press Report for the advance report.</p>`;
    paint($("#app")); renderPad(); syncCall();
  }
  function onImpact(rec, skipped) {
    if (skipped) return;
    if (["inplay"].includes(rec.result)) { A.crack(rec.bip && rec.bip.quality > 0.7); if (rec.bip && rec.bip.result !== "out") A.cheer(); }
    else if (rec.result === "foul" || rec.result === "foultip") A.foul();
    else A.mitt();
  }
  async function callPitch() {
    if (G.busy || !G.code || !G.target || G.st.over) return;
    G.busy = true; syncCall(); A.startCrowd();
    const call = { code: G.code, target: G.target };
    const before = { batter: C.batterOf(G.st) };
    const rec = C.playPitch(G.st, call);
    rec.pitcherId = G.pitcher.id;
    store.current.calls.push(call); store.current.over = G.st.over; save();
    G.scene.set({ aim: false, batter: before.batter });
    await G.scene.play(rec, { speed: store.settings.speed });
    G.lastRec = rec; G.busy = false;
    showToast(rec);
    live.textContent = `${C.PITCH_NAMES[rec.code]}, ${rec.end.velo} miles per hour: ${rec.event.label}. Count ${G.st.balls}-${G.st.strikes}, ${G.st.outs} out.`;
    if (rec.event.paEnd) G.lastRec = null;
    syncGame();
    if (G.st.over) finishInning();
  }
  let toastT = 0;
  function showToast(rec) {
    const t = $("#toast"); if (!t) return;
    const big = rec.event.paEnd;
    t.innerHTML = `${chip(rec.code)} <span>${rec.end.velo.toFixed(1)}</span> <b>${esc(rec.event.label)}</b>${rec.event.runs ? ` <em>${rec.event.runs} run${rec.event.runs > 1 ? "s" : ""} score${rec.event.runs > 1 ? "" : "s"}</em>` : ""}`;
    t.className = "toast" + (big ? " toast--big" : ""); t.hidden = false; paint(t);
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), big ? 2600 : 1600);
  }
  function finishInning() {
    const ev = C.evaluateInning(G.st, { weights: { usage: store.settings.wUsage, location: 1 - store.settings.wUsage } });
    store.history = [{ at: Date.now(), pitcherId: G.pitcher.id, seed: G.st.seed, overall: ev.overall, usage: ev.usage, location: ev.location, summary: ev.summary }].concat(store.history || []).slice(0, 10);
    store.current = null; save();
    const btn = $("#call"); btn.textContent = "See the review"; btn.disabled = false; btn.onclick = () => (location.hash = "#/review");
    setTimeout(() => { if (document.body.dataset.view === "play" && G.st.over) location.hash = "#/review"; }, store.settings.speed === "skip" ? 900 : 2200);
  }

  /* -------------------------------------------- review */
  function band(g) { return g == null ? "na" : g >= 85 ? "a" : g >= 70 ? "b" : g >= 55 ? "c" : "d"; }
  function viewReview() {
    const st = G.st, p = G.pitcher, ev = C.evaluateInning(st, { weights: { usage: store.settings.wUsage, location: 1 - store.settings.wUsage } });
    G.review = ev;
    const s = ev.summary, wU = Math.round(ev.weights.usage * 100);
    const usageBlock = ["R", "L"].map((h) => {
      const u = ev.usageBy[h];
      if (!u.graded) return `<div class="usplit"><h3>vs ${h}HH</h3><p class="muted">Not faced — not graded.</p></div>`;
      return `<div class="usplit"><h3>vs ${h}HH <span class="grade grade--${band(u.score)}">${u.score}</span></h3>${usageBar(p, u.target, "Plan")}${usageBar(p, u.actual, "You", `${u.n} pitch${u.n === 1 ? "" : "es"}`)}
        <table class="utab"><thead><tr><th>Pitch</th><th>Called</th><th>Expected<small> for your counts</small></th></tr></thead><tbody>${p.arsenal.map((a) => `<tr><td>${chip(a.code)}</td><td>${u.observed[a.code]}</td><td>${u.expected[a.code].toFixed(1)}</td></tr>`).join("")}</tbody></table>
        <p class="fine">Compliance test: p = ${u.pval.toFixed(2)} (how often a catcher following the plan exactly would call a mix at least this far from it in these counts).</p></div>`;
    }).join("");
    const locCharts = p.arsenal.filter((a) => ev.byPitch[a.code]).map((a) => {
      const cs = st.calls.filter((c) => c.code === a.code), col = C.PITCH_COLORS[a.code];
      const marks = cs.map((c) => `<line class="rv__link" x1="${mx(c.target.x)}" y1="${mz(c.target.z)}" x2="${mx(c.end.x)}" y2="${mz(c.end.z)}"/>` +
        `<path class="rv__opt" d="M${mx(c.eval.opt.x)} ${mz(c.eval.opt.z) - 8}l8 8l-8 8l-8 -8z"/>` + reticleIcon(c.target.x, c.target.z, "#2a2622", true) + `<circle cx="${mx(c.end.x)}" cy="${mz(c.end.z)}" r="7" fill="${col}" class="rv__end"/>`).join("");
      const bp = ev.byPitch[a.code];
      return `<figure class="rv"><figcaption>${chip(a.code)} ${esc(C.PITCH_NAMES[a.code])} <span class="grade grade--${band(bp.grade)}">${bp.grade}</span><small>${bp.n} called</small></figcaption>${svg(zoneBase(p) + marks, "zc--rv", `${a.code} setups, actual locations and model-preferred setups`)}</figure>`;
    }).join("");
    const log = st.calls.map((c, i) => `<li class="plog"><div class="plog__row"><span class="plog__n">${c.n}</span>${chip(c.code)}<span class="plog__b">${esc(c.batter.name.split(" ").slice(-1)[0])} <small>${c.batter.hand}</small></span><span>${c.count.balls}-${c.count.strikes}</span><span class="plog__res">${esc(c.event.label)}</span><span class="grade grade--${band(c.eval.grade)}" title="Glove target grade">${c.eval.grade}</span><button class="tool tool--sm" type="button" data-replay="${i}">Replay</button></div><p class="plog__why">${esc(reason(c, p))}</p></li>`).join("");
    app.innerHTML = `<section class="paper review">
      <header class="rv__head"><div><p class="kicker">Inning review · ${esc(p.name)}</p><h1>${ev.overall == null ? "—" : ev.overall}<small>/100</small></h1><p class="meta">${s.batters} batters · ${s.pitches} pitches · ${s.R} R · ${s.H} H · ${s.BB} BB · ${s.K} K</p></div>
        <div class="subs"><div><span>Pitch usage</span><b class="grade grade--${band(ev.usage)}">${ev.usage ?? "—"}</b><small>${wU}%</small></div><div><span>Glove targets</span><b class="grade grade--${band(ev.location)}">${ev.location ?? "—"}</b><small>${100 - wU}%</small></div></div></header>
      <p class="fine">Your grade counts only your decisions — the mix you called and the expected quality of each glove target given how ${esc(p.name.split(" ")[0])} misses. Hits, walks and runs don't move it.</p>
      <div class="fb"><div><h3>What you did well</h3>${list(ev.feedback.good, "Nothing stood out yet — a longer inning gives the grade more to work with.")}</div><div><h3>Opportunity</h3>${list(ev.feedback.opportunity, "No clear gaps in this inning.")}</div><div class="fb__key"><h3>Key takeaway</h3><p>${esc(ev.feedback.takeaway)}</p></div></div>
      <div class="replay"><canvas id="rscene" aria-label="Replay of the selected pitch"></canvas><p class="muted" id="rcap">Choose Replay on any pitch below.</p></div>
      <h2 class="h2">Planned vs actual usage</h2><div class="usplits">${usageBlock}</div>
      <h2 class="h2">Glove targets by pitch <small>ring = your setup · dot = where it finished · ◆ = model-preferred setup (review only)</small></h2><div class="rvs">${locCharts}</div>
      <h2 class="h2">Pitch by pitch</h2><ol class="plogs">${log}</ol>
      <div class="actions"><button class="btn btn--primary" id="retry" type="button">Retry inning <small>same hitters &amp; seed</small></button><button class="btn" id="new" type="button">New inning</button><a class="btn" href="#/">Change pitcher</a></div>
      <details class="weights"><summary>Grade weights</summary><label>Usage <input type="range" id="w" min="0" max="100" step="5" value="${wU}"> <output id="wout">${wU}% usage · ${100 - wU}% targets</output></label></details>
    </section>`;
    paint(app); app.focus(); window.scrollTo(0, 0);
    const rs = window.CTGScene.create($("#rscene"), {}); G.rscene = rs;
    rs.set({ pitcher: p, batter: st.lineup[0], showZone: true });
    $$("[data-replay]").forEach((b) => b.addEventListener("click", async () => {
      const c = st.calls[+b.dataset.replay], bat = st.lineup.find((x) => x.id === c.batter.id);
      $("#rcap").textContent = `#${c.n} ${C.PITCH_NAMES[c.code]} to ${c.batter.name}, ${c.count.balls}-${c.count.strikes}: ${c.event.label}`;
      $(".replay").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      rs.set({ batter: bat, target: c.target, last: null }); c.pitcherId = p.id;
      await rs.play(c, { speed: store.settings.speed === "skip" ? "skip" : store.settings.speed });
    }));
    $("#retry").addEventListener("click", () => startInning(p, st.seed));
    $("#new").addEventListener("click", () => startInning(p, (Math.random() * 2 ** 31) >>> 0));
    $("#w").addEventListener("input", (e) => { store.settings.wUsage = +e.target.value / 100; save(); viewReview(); const d = $(".weights"); if (d) d.open = true; });
  }
  function missRel(c, s) {
    const da = Math.round((c.end.x - c.target.x) * s * 12), dz = Math.round((c.end.z - c.target.z) * 12);
    const parts = [Math.abs(da) >= 1 ? `${Math.abs(da)} in ${da > 0 ? "arm-side" : "glove-side"}` : "", Math.abs(dz) >= 1 ? `${Math.abs(dz)} in ${dz > 0 ? "high" : "low"}` : ""].filter(Boolean);
    return parts.length ? parts.join(" and ") + " of the glove" : "right in the glove";
  }
  const list = (arr, empty) => (arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">${esc(empty)}</p>`);
  function reason(c, p) {
    const e = c.eval, s = C.armSign(p.hand), first = p.name.split(" ")[0];
    const dA = Math.round(-e.offset.arm * 12), dU = Math.round(-e.offset.up * 12);
    const move = [Math.abs(dA) >= 2 ? `${Math.abs(dA)} in ${dA > 0 ? "arm-side" : "glove-side"}` : "", Math.abs(dU) >= 2 ? `${Math.abs(dU)} in ${dU > 0 ? "higher" : "lower"}` : ""].filter(Boolean).join(" and ");
    const ctx = { first: "first pitch", ahead: "pitcher's count", even: "even count", behind: "hitter's count", two: "two-strike count" }[e.ctx];
    const share = Math.round(e.planShare * 100);
    const where = move ? `The model-preferred setup was ${move} from yours.` : "Your glove was essentially at the model-preferred setup.";
    const finish = `With ${first}'s typical miss, this target was expected to finish ${Math.round(Math.abs((e.expEnd.x - c.target.x) * s) * 12)} in ${((e.expEnd.x - c.target.x) * s) >= 0 ? "arm-side" : "glove-side"} and ${Math.round(Math.abs(e.expEnd.z - c.target.z) * 12)} in ${e.expEnd.z >= c.target.z ? "up" : "down"}`;
    return `Target grade ${e.grade}. ${where} ${finish}; it actually finished ${missRel(c, s)}. In a ${ctx} vs ${c.batter.hand}HH the plan calls the ${C.PITCH_NAMES[c.code].toLowerCase()} about ${share}% of the time.`;
  }

  window.CTGDebug = { scene: () => G.scene, replay: () => G.rscene, state: () => G.st };   // test hook (frame inspection)
  route();
})();
