/* ==========================================================================
   Manager Hub — Describe Your Day (panel)
   Describe → preview (timeline by track) → refine conversationally → review & save.
   Interpretation: the AI interpreter (api/interpret, server-side model) when it is
   configured, otherwise the built-in reader — the panel always says which ran.
   Timing, feasibility and conflicts: DaySolve (deterministic). Saving goes through the
   Schedule Assistant's review/publish step, so the diff, removal warnings and Undo apply.
   ========================================================================== */
(function () {
  "use strict";
  if (typeof DayEngine === "undefined") return;
  const E = DayEngine, A = window.MHAssist;
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (m) => { if (m == null) return ""; const H = Math.floor(m / 60), M = m % 60, h12 = ((H + 11) % 12) + 1; return `${h12}:${String(M).padStart(2, "0")}`; };
  const fmtAP = (m) => (m == null ? "" : `${fmt(m)} ${m >= 720 ? "PM" : "AM"}`);
  const mins = (n) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? " " + (n % 60) + " min" : ""}` : `${n} min`);

  const EXAMPLES = [
    "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame.",
    "Game at 6. Early work at 2:30, BP at 3:30, 45 minutes off before stretch.",
    "No game tomorrow. Start at 9, defense-heavy day, two hitting groups, lunch at noon, finish by 2.",
    "FCL day. Stretch at 8:30, hitting stations, pitchers throw, defense after, done by noon.",
    "Same as yesterday but move BP 20 minutes earlier and add baserunning."
  ];
  const REFINE_EXAMPLES = ["Move defense before hitting", "Shorten team fundy to 20", "Add a second BP group", "Make everything finish by 12:15", "Run the cage groups simultaneously", "Give pitchers another 15 minutes"];
  const BUILD_EXAMPLES_GAME = ["Catchers report at 1:30", "Hitters have early work at 2:00", "Pitchers stretch at 3:00", "Add a defensive meeting before BP", "Move the warmup 5 minutes earlier"];
  const BUILD_EXAMPLES_DAY = ["Stretch at 9, defense, then BP", "Pitchers throw at 9:30", "Add a team meeting at 8:45", "Everyone done by noon"];
  const TRACK_LABEL = { all: "Team", position: "Position players", pitchers: "Pitchers", catchers: "Catchers" };

  let panel = null, st = null, log = [], busy = false, sel = null, aiState = "unknown", lastReason = "", budget = null;
  /* Build Daily Schedule: the same panel, opened on a day's starting plan (the game-day activities, the Complex
     workout, or nothing). B = { start, games, game, generated, std, status, pending, recalc, home } */
  let B = null;

  /* ------------------------------------------------------------- context */
  function appCtx() {
    const secs = (S && S.sections) || [];
    const names = (g) => secs.filter((s) => s.kind !== "lineup" && s.gtype === g).map((s) => s.name).filter(Boolean);
    const cnt = (k) => { try { const n = Resources.count(k); return n === Infinity ? null : n; } catch (e) { return null; } };
    const fp = S && S.meta && S.meta.firstPitch ? A.parseClock(S.meta.firstPitch) : null;
    let yesterday = null; try { yesterday = window.MHAssistUI && MHAssistUI.yesterdayRequest(); } catch (e) {}
    return {
      date: S && S.meta && S.meta.date, affiliate: store.affiliate && store.affiliate(),
      hittingGroups: names("position"), pitcherGroups: names("pitcher"),
      resources: { fields: cnt("field"), cages: cnt("cage"), mounds: cnt("mound") },
      game: { firstPitch: fp, opponent: (S && S.meta && S.meta.opponent) || null },
      current: st ? st.request : (S && S.meta && S.meta.dayRequest) || null,
      yesterday
    };
  }
  /** what the model may see: names of groups and counts, never the roster */
  const wireCtx = (c) => ({ date: c.date, affiliate: c.affiliate, hittingGroups: c.hittingGroups, pitcherGroups: c.pitcherGroups, resources: c.resources, game: c.game });

  /* ------------------------------------------------------- interpreters */
  async function ai(mode, text, ctx, request, plan) {
    if (aiState === "off") return null;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch("api/interpret", { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, text, ctx: wireCtx(ctx), request, plan: plan ? { items: plan.items.map((i) => ({ start: i.start, end: i.end, track: i.track, group: i.group || null, label: i.label, actId: i.actId || null, fixed: !!i.fixed })) } : undefined }) });
      if (r.status === 404 || r.status === 405) { aiState = "off"; lastReason = ""; return null; }
      const d = await r.json().catch(() => null);
      if (d && d.budget) setBudget(d.budget);
      if (r.status === 402) { aiState = "off"; lastReason = `This month's AI limit is reached (${money(budget && budget.capUsd)}, estimated) — the built-in reader is used until next month`; return null; }
      if (r.status === 503) { aiState = "off"; lastReason = d && /^budget/.test(d.error || "") ? "AI spending can't be tracked right now, so the AI is paused" : ""; return null; }
      if (r.status === 429) { aiState = "on"; lastReason = `AI request limit reached — try again in ${Math.max(1, Math.round(((d && d.retryAfter) || 600) / 60))} min`; return null; }
      if (!r.ok || !d) { aiState = "on"; lastReason = { timeout: "The AI interpreter timed out", "invalid-output": "The AI's answer didn't pass validation", declined: "The AI declined this request" }[(d && d.error)] || `The AI interpreter is unavailable (${(d && d.error) || r.status})`; return null; }
      aiState = "on"; return d;
    } catch (e) { aiState = aiState === "off" ? "off" : "on"; lastReason = "The AI interpreter timed out"; return null; }
    finally { clearTimeout(t); }
  }
  /* ------------------------------------------- monthly AI spend (estimate) */
  const money = (x) => "$" + (Number(x) || 0).toFixed(2);
  function budgetText() {
    if (!budget || !budget.configured || budget.error || budget.spentUsd == null) return "";
    const used = (budget.spentUsd || 0) + (budget.pendingUsd || 0);
    return budget.reached ? `AI limit reached this month (${money(budget.capUsd)}, est.)` : `AI this month: ${money(used)} of ${money(budget.capUsd)} (est.)`;
  }
  function setBudget(b) {
    budget = b;
    const el = panel && panel.querySelector("#dyBudget");
    if (el) { el.textContent = budgetText(); el.hidden = !el.textContent; }
  }
  async function loadBudget() {
    try {
      const r = await fetch("api/usage", { headers: { Accept: "application/json" } });
      const d = r.ok ? await r.json() : null;
      if (d && d.ai && d.ai.active && d.budget) setBudget(d.budget);
    } catch (e) { /* no figures: nothing shown */ }
  }

  async function build(text) {
    const ctx = appCtx(); ctx.current = null;
    const r = await ai("build", text, ctx);
    let s = E.plan(text, ctx, r && r.request ? { request: r.request } : {});
    s.fallback = s.interpreter === "reader" ? lastReason : "";
    // Build Daily Schedule on a game / workout day: the standard activities stay unless the description names them
    if (B && B.std && B.std.length && window.GameDay) {
      let req = s.request;
      if (s.interpreter === "ai") { try { req = GameDay.adoptEdges(req, E.Solve.normalize(E.Read.read(text, ctx))); } catch (e) {} }
      const merged = GameDay.mergeStandard(req, B.std, B.home, (k) => { try { return E.KB.kind(k).dur.def; } catch (e) { return 15; } });
      if (B.game && B.game.time && merged.anchors && merged.anchors.firstPitch == null) merged.anchors.firstPitch = GameDay.toMin(B.game.time);
      s = Object.assign(E.fromRequest(merged, ctx), { text, interpreter: s.interpreter, fallback: s.fallback });
    }
    return s;
  }
  async function refine(text) {
    const ctx = appCtx();
    const r = await ai("refine", text, ctx, st.request, st.plan);
    const ops = r && Array.isArray(r.ops) ? r.ops : E.Read.readEdit(text, st.request, st.plan, ctx);
    const next = E.applyOps(st, ops, ctx, text);
    next.interpreter = r && r.ops ? "ai" : "reader";
    next.fallback = next.interpreter === "reader" ? lastReason : "";
    return { next, ops, notes: (r && r.notes) || [] };
  }

  /* ------------------------------------------------------------ panel */
  function ensure() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "dayui"; panel.className = "mha dayui"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Describe your day");
    document.body.appendChild(panel);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (sel) { sel = null; renderPreview(); } else close(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !/TEXTAREA|INPUT/.test(e.target.tagName)) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    });
    return panel;
  }
  function open(opts = {}) {
    ensure();
    if (!opts.keepBuilder) B = null;
    panel.hidden = false; document.body.classList.add("mha-open");
    render();
    loadBudget();
    if (opts.text) { q("#dyText", panel).value = opts.text; if (opts.run) doBuild(); }
  }
  function close() { if (!panel) return; panel.hidden = true; document.body.classList.remove("mha-open"); stopMic(); }

  function head() {
    const b = typeof Brand !== "undefined" && store.affiliate ? Brand.get(store.affiliate()) : null;
    const chip = !st || st.interpreter === "manual" ? "" : st.interpreter === "ai"
      ? `<span class="mha-chip on" title="Read by the AI interpreter, then scheduled and checked by Manager Hub">✦ AI interpreter</span>`
      : st.fallback
        ? `<span class="mha-chip warn" title="${h(st.fallback)} — Manager Hub's built-in reader was used instead">Built-in reader · AI unavailable</span>`
        : `<span class="mha-chip" title="Read by Manager Hub's built-in baseball reader (no AI service is switched on)">Built-in reader</span>`;
    const gl = B && B.game ? ` · ${B.game.homeAway === "away" ? "@" : "vs."} ${h(B.game.opponent || "TBD")}${B.game.time ? " " + h(fmtAP(GameDay.toMin(B.game.time))) : ""}` : "";
    const stTag = B ? `<span class="dy-status ${B.status || "new"}">${{ draft: "Draft", published: "Published" }[B.status] || "Not saved"}</span>` : "";
    return `<div class="mha-head">
      <div class="mha-title"><b>${B ? "Build daily schedule" : "Describe your day"}</b><span>${h(b ? (b.short || b.team) + " — " : "")}${h(S && S.meta && S.meta.date ? longDate(S.meta.date) : "No date set")}${gl}</span></div>${stTag}
      <span class="sp"></span>
      <div class="mha-hr">${chip}${B ? "" : `<button class="dy-classic" data-classic title="Groups, rotations, templates and monthly planning">Classic assistant</button>`}<button class="mha-x" data-close aria-label="Close">×</button></div>
    </div>`;
  }
  function render() {
    panel.innerHTML = head() + `<div class="dy-body">
      <section class="dy-left">${B && B.pending ? pendingCard() : B && st && !(st.history || []).length && st.interpreter === "manual" && B.start !== "manual" ? describe() : st ? (B ? builderLeft() : "") + conversation() : describe()}</section>
      <section class="dy-right" id="dyPreview"></section>
    </div>
    <div class="mha-foot">
      <button class="btn sm" data-undo ${st && st.history && st.history.length ? "" : "disabled"} title="Undo (⌘Z)">Undo</button>
      <button class="btn sm" data-redo ${st && st.redo && st.redo.length ? "" : "disabled"} title="Redo (⇧⌘Z)">Redo</button>
      ${st ? `<button class="btn sm quiet" data-restart>Start over</button>` : ""}
      <span class="sp"></span><span class="mha-note dy-budget" id="dyBudget" title="Estimated from the tokens each request used. The limit is enforced by the server; OpenAI's own bill is the authority."${budgetText() ? "" : " hidden"}>${h(budgetText())}</span><span class="mha-note dy-footnote">${B ? (B.status === "published" ? "Published — changes here stay a draft until you publish again." : "Nothing is published until you choose Publish.") : st ? "Nothing changes in the schedule until you save." : "Type or dictate — a few sentences is enough."}</span>
      ${B ? `<button class="btn" data-savedraft ${st ? "" : "disabled"}>Save draft</button>` : ""}
      <button class="btn primary" data-accept ${st && st.plan.items.length ? "" : "disabled"}>${B ? "Publish →" : "Review &amp; save →"}</button>
    </div>`;
    bind(); renderPreview();
  }
  function describe() {
    return `${B && B.std && B.std.length ? `<div class="dy-keep">${B.game ? "The standard game-day activities are on the timeline" : "The Complex workout is on the timeline"} — they stay unless you say otherwise. <button class="dy-link" data-manual>Edit the timeline instead →</button></div>` : ""}
      <label class="mha-lbl" for="dyText">${B ? "Describe the day — type or dictate" : "What does the day look like?"}</label>
      <textarea id="dyText" class="mha-ta dy-ta" rows="6" spellcheck="true" placeholder="${h(EXAMPLES[0])}"></textarea>
      <div class="mha-bar">${micBtn("dyMic")}<span class="mha-hint" id="dyMicHint"></span><span class="sp"></span><button class="btn primary" data-build>Build the day</button></div>
      <div class="dy-examples"><span class="mha-note">Try one:</span>${EXAMPLES.map((x, i) => `<button class="dy-ex" data-ex="${i}">${h(x)}</button>`).join("")}</div>
      <p class="mha-note dy-how">Say what's fixed (times, first pitch, hard stop, time off) and what needs to happen. Manager Hub fills in order, lengths and transitions, shows what it assumed, and flags anything that won't fit.</p>`;
  }
  function conversation() {
    return `<div class="dy-log" id="dyLog">${log.map((m) => `<div class="dy-msg ${m.who}">${m.who === "you" ? h(m.text) : m.html || h(m.text)}</div>`).join("")}</div>
      <div class="dy-refine">
        <label class="mha-lbl" for="dyRefine">Change something</label>
        <div class="dy-refine-row"><textarea id="dyRefine" rows="2" class="mha-ta dy-rta" placeholder="e.g. Move defense before hitting"></textarea>${micBtn("dyMic2")}<button class="btn primary" data-refine>Apply</button></div>
        <div class="dy-examples tight">${(B ? (B.game ? BUILD_EXAMPLES_GAME : BUILD_EXAMPLES_DAY) : REFINE_EXAMPLES).map((x) => `<button class="dy-ex sm" data-rex="${h(x)}">${h(x)}</button>`).join("")}</div>
      </div>`;
  }
  function bind() {
    q("[data-close]", panel).onclick = close;
    const cl = q("[data-classic]", panel); if (cl) cl.onclick = () => { close(); MHAssistUI.open(); };
    const ta = q("#dyText", panel);
    if (ta) {
      qa("[data-ex]", panel).forEach((b) => (b.onclick = () => { ta.value = EXAMPLES[+b.dataset.ex]; ta.focus(); }));
      q("[data-build]", panel).onclick = doBuild;
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doBuild(); });
      wireMic("dyMic", (t) => { ta.value = (ta.value ? ta.value.replace(/\s*$/, " ") : "") + t; });
      setTimeout(() => ta.focus(), 30);
    }
    const rt = q("#dyRefine", panel);
    if (rt) {
      q("[data-refine]", panel).onclick = () => doRefine(rt.value);
      rt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doRefine(rt.value); } });
      qa("[data-rex]", panel).forEach((b) => (b.onclick = () => { rt.value = b.dataset.rex; rt.focus(); }));
      wireMic("dyMic2", (t) => { rt.value = (rt.value ? rt.value.replace(/\s*$/, " ") : "") + t; });
      const lg = q("#dyLog", panel); if (lg) lg.scrollTop = lg.scrollHeight;
      setTimeout(() => rt.focus(), 30);
    }
    q("[data-undo]", panel).onclick = doUndo;
    q("[data-redo]", panel).onclick = doRedo;
    const rs = q("[data-restart]", panel); if (rs) rs.onclick = () => { if (st && !confirm("Start over? This draft is discarded (the schedule itself hasn't changed).")) return; if (B) { startPlan({ fresh: true }); return; } st = null; log = []; sel = null; render(); };
    q("[data-accept]", panel).onclick = accept;
    const sd = q("[data-savedraft]", panel); if (sd) sd.onclick = () => { saveDayPlan("draft"); toast("Draft saved — not published"); render(); };
    if (B) bindBuilder();
  }

  /* --------------------------------------------------------- actions */
  async function doBuild() {
    if (busy) return;
    const text = q("#dyText", panel).value.trim();
    if (!text) { toast("Describe the day first — or pick an example"); return; }
    busy = true; stopMic(); working("Reading your day…");
    try {
      st = await build(text);
      log = [{ who: "you", text }, { who: "me", html: planSummary() }];
      sel = null; render();
    } catch (e) { console.error(e); toast("Something went wrong building that — nothing was changed"); }
    finally { busy = false; working(null); }
  }
  async function doRefine(text) {
    text = String(text || "").trim(); if (!text || busy || !st) return;
    busy = true; stopMic(); working("Updating…");
    try {
      const r = await refine(text);
      if (!r.ops.length) { log.push({ who: "you", text }, { who: "me", text: "I couldn't tell what to change there. Try naming the activity and the change — “shorten team fundy to 20”, “move BP before defense”, “finish by 12:15”." }); render(); return; }
      const before = st.plan;
      st = r.next; sel = null;
      log.push({ who: "you", text }, { who: "me", html: changeSummary(before, st.plan, r.notes) });
      render();
    } catch (e) { console.error(e); toast("That change couldn't be applied — the draft is unchanged"); }
    finally { busy = false; working(null); }
  }
  function applyOps(ops, label) {
    const before = st.plan;
    st = Object.assign(E.applyOps(st, ops, appCtx(), label), { interpreter: st.interpreter, fallback: st.fallback });
    log.push({ who: "you", text: label }, { who: "me", html: changeSummary(before, st.plan, []) });
    render();
  }
  function doUndo() { if (!st || !(st.history || []).length) return; const keep = { interpreter: st.interpreter, fallback: st.fallback }; st = Object.assign(E.undo(st), keep); log.push({ who: "me", text: "Undone." }); render(); }
  function doRedo() { if (!st || !(st.redo || []).length) return; const keep = { interpreter: st.interpreter, fallback: st.fallback }; st = Object.assign(E.redo(st), keep); log.push({ who: "me", text: "Redone." }); render(); }
  function working(msg) {
    const p = q("#dyPreview", panel); if (!p) return;
    p.classList.toggle("busy", !!msg);
    let w = q(".dy-working", p);
    if (msg) { if (!w) { w = document.createElement("div"); w.className = "dy-working"; p.prepend(w); } w.textContent = msg; }
    else if (w) w.remove();
  }

  /* --------------------------------------------------------- summaries */
  function planSummary() {
    const p = st.plan, its = p.items.filter((i) => i.kind !== "game");
    if (!p.items.length) return "I couldn't find anything to schedule in that. Name what needs to happen and any fixed times — “stretch at 10, BP, game at 1”.";
    const s = Math.min(...p.items.map((i) => i.start)), e = Math.max(...p.items.map((i) => i.end));
    const game = p.items.find((i) => i.kind === "game");
    const errs = p.conflicts.filter((c) => c.severity === "error").length;
    const fb = st.interpreter !== "ai" && st.fallback ? `<div class="dy-fallback">${h(st.fallback)}. I used the built-in reader instead — check anything under “Not understood”.</div>` : "";
    return fb + `Built <b>${its.length} blocks</b>, ${fmtAP(s)}–${fmtAP(game ? game.start : e)}${game ? ` · game at ${fmtAP(game.start)}` : ""}. ${errs ? `<b class="dy-bad">${errs} thing${errs > 1 ? "s" : ""} won't fit</b> — see the options on the right.` : "Everything fits."}${(st.request.unknown || []).length ? ` I didn't understand: ${st.request.unknown.map((u) => "“" + h(u) + "”").join(", ")}.` : ""}`;
  }
  function changeSummary(a, b, notes) {
    const key = (i) => i.label + "|" + (i.round || "") + "|" + i.track;
    const A1 = new Map(a.items.map((i) => [key(i), i])), B1 = new Map(b.items.map((i) => [key(i), i]));
    const out = [];
    B1.forEach((i, k) => { const o = A1.get(k); if (!o) out.push(`+ ${h(i.label)} ${fmt(i.start)}–${fmt(i.end)}`); else if (o.start !== i.start || o.end !== i.end) out.push(`${h(i.label)}: ${fmt(o.start)}–${fmt(o.end)} → ${fmt(i.start)}–${fmt(i.end)}`); });
    A1.forEach((i, k) => { if (!B1.has(k)) out.push(`− ${h(i.label)}`); });
    const errs = b.conflicts.filter((c) => c.severity === "error").length;
    return (out.length ? `<b>Changed</b><ul class="dy-chg">${out.slice(0, 8).map((x) => `<li>${x}</li>`).join("")}${out.length > 8 ? `<li>…and ${out.length - 8} more</li>` : ""}</ul>` : "No times changed.") +
      (notes && notes.length ? `<div class="mha-note">${notes.map(h).join(" ")}</div>` : "") + (errs ? `<div class="dy-bad">${errs} conflict${errs > 1 ? "s" : ""} to resolve.</div>` : "");
  }

  /* ------------------------------------------------------------ preview */
  function renderPreview() {
    const host = q("#dyPreview", panel); if (!host) return;
    if (!st) { host.innerHTML = `<div class="dy-empty"><b>Your day appears here</b><span>Fixed times are solid, flexible blocks are outlined, and time off is shaded. Click any block to adjust it.</span></div>`; return; }
    const p = st.plan;
    const conflicts = p.conflicts || [], asm = p.assumptions || [];
    host.innerHTML = `
      ${conflicts.length ? `<div class="dy-conflicts">${conflicts.map((c, ci) => `<div class="dy-conf ${c.severity}"><b>${c.severity === "error" ? "Won't fit" : "Check"}</b> ${h(c.message)}
        ${(c.alternatives || []).length ? `<div class="dy-alts">${c.alternatives.map((a, ai) => `<button class="btn sm" data-alt="${ci}:${ai}">${h(a.label)}</button>`).join("")}</div>` : ""}</div>`).join("")}</div>` : ""}
      ${asm.length ? `<details class="dy-asm" ${asm.length <= 3 ? "open" : ""}><summary>What I assumed <span>(${asm.length})</span></summary><ul>${asm.map((a) => `<li>${h(a.text || a)}</li>`).join("")}</ul></details>` : ""}
      ${timeline(p)}
      ${sel ? (B ? builderToolbar() : toolbar()) : ""}
      <div class="dy-legend"><span><i class="lg fixed"></i>Fixed</span><span><i class="lg flex"></i>Flexible</span><span><i class="lg free"></i>Time off</span><span><i class="lg inf"></i>Added by Manager Hub</span></div>`;
    qa("[data-alt]", host).forEach((b) => (b.onclick = () => { const [ci, ai] = b.dataset.alt.split(":").map(Number); const alt = conflicts[ci].alternatives[ai]; applyOps(alt.ops, alt.label); }));
    qa("[data-item]", host).forEach((b) => (b.onclick = () => { sel = sel === b.dataset.item ? null : b.dataset.item; renderPreview(); }));
    qa("[data-tool]", host).forEach((b) => (b.onclick = () => tool(b.dataset.tool)));
    if (B) { bindEdit(host); bindDrag(host); }
  }
  function timeline(p) {
    const items = p.items.slice().sort((a, b) => a.start - b.start || (a.round || 0) - (b.round || 0));
    if (!items.length) return `<div class="dy-empty"><b>Nothing scheduled</b></div>`;
    const tracks = ["position", "pitchers", "catchers"].filter((t) => items.some((i) => i.track === t));
    const cols = tracks.length ? tracks : ["all"];
    // BP rounds that run at the same time for different groups get their own sub-columns
    const lanes = [];
    cols.forEach((t) => {
      const mine = items.filter((i) => i.track === t);
      const groups = [...new Set(mine.filter((i) => i.group && mine.some((j) => j !== i && j.start < i.end && i.start < j.end)).map((i) => i.group))];
      if (groups.length > 1) groups.forEach((g) => lanes.push({ track: t, group: g })); else lanes.push({ track: t, group: null });
    });
    const t0 = Math.floor(Math.min(...items.map((i) => i.start)) / 15) * 15, t1 = Math.ceil(Math.max(...items.map((i) => i.end || i.start)) / 15) * 15 + 15;
    const SLOT = 5, rows = Math.max(1, (t1 - t0) / SLOT);
    const row = (m) => Math.round((m - t0) / SLOT) + 2;
    const laneOf = (i) => {
      if (i.track === "all") return null;
      const exact = lanes.findIndex((l) => l.track === i.track && l.group && l.group === i.group);
      if (exact >= 0) return [exact, exact + 1];
      const idx = lanes.map((l, k) => (l.track === i.track ? k : -1)).filter((k) => k >= 0);
      return idx.length ? [idx[0], idx[idx.length - 1] + 1] : [0, lanes.length];
    };
    let ticks = "";
    for (let m = t0; m <= t1; m += 15) ticks += `<div class="dy-tick ${m % 60 ? "" : "hour"}" style="grid-row:${row(m)};"><span>${m % 30 ? "" : fmt(m)}</span></div>`;
    const blocks = items.map((i) => {
      const key = itemKey(i);
      if (i.kind === "game") return `<button class="dy-game" data-item="${h(key)}" style="grid-row:${row(i.start)};grid-column:2/${lanes.length + 2}"><b>${fmtAP(i.start)}</b> ${h(i.label)}</button>`;
      const [c0, c1] = laneOf(i) || [0, lanes.length];
      const len = Math.max(1, row(i.end) - row(i.start));
      const cls = ["dy-blk", i.kind === "free" ? "free" : i.fixed ? "fixed" : "flex", i.source === "inferred" ? "inf" : "", sel === key ? "sel" : "", len < 3 ? "tiny" : ""].join(" ");
      const col = B ? colorOf(i.label) : null;
      return `<button class="${cls}${B && i.actId ? " editable" : ""}" data-item="${h(key)}" data-kind="${h(i.kind)}" style="grid-row:${row(i.start)}/span ${len};grid-column:${c0 + 2}/${c1 + 2}${col ? `;--c:${h(col)}` : ""}" title="${h(`${fmtAP(i.start)}–${fmtAP(i.end)} · ${i.label}${B ? " — drag to move, drag the lower edge to resize" : ""}`)}">
        <span class="t">${fmt(i.start)}–${fmt(i.end)}</span><span class="l">${i.fixed ? '<i class="pin" aria-label="fixed"></i>' : ""}${h(i.label)}${i.group && !lanes.some((l) => l.group === i.group) ? ` <em>${h(i.group)}</em>` : ""}</span><span class="d">${i.end - i.start ? mins(i.end - i.start) : ""}</span></button>`;
    }).join("");
    const headers = lanes.map((l, k) => `<div class="dy-lane-h" style="grid-column:${k + 2}">${h(l.group || TRACK_LABEL[l.track] || l.track)}</div>`).join("");
    const w = p.window || {};
    return `<div class="dy-sum">${w.start != null ? `<b>${fmtAP(w.start)} – ${fmtAP(w.end)}</b>` : ""}${w.available != null ? `<span>${mins(w.available)} available · ${mins(w.required || 0)} planned</span>` : ""}</div>
      <div class="dy-tl" style="grid-template-columns:52px repeat(${lanes.length},minmax(0,1fr));grid-template-rows:28px repeat(${rows},11px)">
        <div class="dy-lane-h"></div>${headers}${ticks}${blocks}</div>`;
  }
  const itemKey = (i) => `${i.actId || i.id}#${i.round || 0}`;
  const selected = () => st && sel ? st.plan.items.find((i) => itemKey(i) === sel) : null;
  function toolbar() {
    const i = selected(); if (!i) return "";
    const act = (st.request.activities || []).find((a) => a.id === i.actId);
    const locked = act && act.at != null;
    return `<div class="dy-tools"><b>${h(i.label)}</b><span>${fmtAP(i.start)}–${fmtAP(i.end)}</span>
      ${act ? `<button class="btn sm" data-tool="shorter" title="5 minutes shorter">−5</button><button class="btn sm" data-tool="longer" title="5 minutes longer">+5</button>
      <button class="btn sm" data-tool="earlier" ${locked ? "disabled" : ""}>Earlier</button><button class="btn sm" data-tool="later" ${locked ? "disabled" : ""}>Later</button>
      <button class="btn sm" data-tool="lock">${locked ? "Unpin time" : "Pin this time"}</button><button class="btn sm quiet" data-tool="remove">Remove</button>`
      : `<span class="mha-note">Set by the day's fixed times — change those to move it.</span>`}</div>`;
  }
  function tool(t) {
    const i = selected(); if (!i) return;
    const act = (st.request.activities || []).find((a) => a.id === i.actId); if (!act) return;
    const target = { kind: act.kind, who: act.who, label: act.label };
    const peers = st.plan.items.filter((x) => x.actId && x.actId !== i.actId && (x.track === i.track || x.track === "all" || i.track === "all") && x.kind !== "game" && x.kind !== "free").sort((a, b) => a.start - b.start);
    const prev = peers.filter((x) => x.start < i.start).pop(), next = peers.find((x) => x.start > i.start);
    const tgt = (x) => { const a = st.request.activities.find((y) => y.id === x.actId); return { kind: a.kind, who: a.who, label: a.label }; };
    const isRound = act.rounds && (act.rounds.each || act.rounds.count);
    const ops = {
      shorter: [isRound ? { op: "rounds", target, each: Math.max(5, (i.end - i.start) - 5) } : { op: "duration", target, delta: -5 }],
      longer: [isRound ? { op: "rounds", target, each: (i.end - i.start) + 5 } : { op: "duration", target, delta: 5 }],
      earlier: prev ? [{ op: "move", target, before: tgt(prev) }] : [],
      later: next ? [{ op: "move", target, after: tgt(next) }] : [],
      lock: act.at != null ? [{ op: "at", target, at: null }] : [{ op: "lock", target }],
      remove: [{ op: "remove", target }]
    }[t];
    if (!ops || !ops.length) { toast(t === "earlier" ? "Already first" : "Already last"); return; }
    const words = { shorter: `${act.label} 5 min shorter`, longer: `${act.label} 5 min longer`, earlier: `Move ${act.label} earlier`, later: `Move ${act.label} later`, lock: act.at != null ? `Unpin ${act.label}` : `Pin ${act.label} at ${fmtAP(i.start)}`, remove: `Remove ${act.label}` }[t];
    applyOps(ops, words);
  }

  /* -------------------------------------------------------------- save */
  function accept() {
    if (!st || !st.plan.items.length) return;
    const errs = st.plan.conflicts.filter((c) => c.severity === "error");
    if (errs.length && !confirm(`${errs.length} conflict${errs.length > 1 ? "s are" : " is"} unresolved:\n\n${errs.map((c) => "• " + c.message).join("\n")}\n\nReview and save anyway?`)) return;
    const events = toEvents(st.plan);
    const game = st.plan.items.find((i) => i.kind === "game");
    close();
    const builder = B;
    if (builder) saveDayPlan("draft");
    MHAssistUI.adopt({ events, text: log.filter((m) => m.who === "you").map((m) => m.text).join("\n"), request: st.request, firstPitch: game ? game.start : null,
      onPublished: builder ? () => { if (S.meta.dayPlan) { S.meta.dayPlan.status = "published"; S.meta.dayPlan.published = new Date().toISOString(); } if (typeof saveSchedule === "function") saveSchedule(true); } : null,
      notes: [`Built with Describe Your Day (${st.interpreter === "ai" ? "AI interpreter" : "built-in reader"}).`], assumptions: (st.plan.assumptions || []).map((a) => a.text || a) });
  }
  /** plan items → the app's rows. Whole-team items go on the team strip; position/pitcher work goes
      to each of the day's existing groups of that kind (or one generic group when there are none). */
  function toEvents(plan) {
    const secs = ((S && S.sections) || []).filter((s) => s.kind !== "lineup");
    const team = (secs.find((s) => /all players|team|staff/i.test(s.name)) || {}).name || "All Players & Staff";
    const of = (g) => secs.filter((s) => s.gtype === g).map((s) => s.name);
    const pos = of("position"), pit = of("pitcher");
    const out = [];
    const push = (group, gtype, i, extra = {}) => out.push(A.makeEvent(Object.assign({ group, gtype, activity: i.label, start: i.start, dur: Math.max(0, i.end - i.start), flex: i.fixed ? "fixed" : "flexible", source: "describe", confidence: st.interpreter === "ai" ? 0.85 : 0.8, location: i.location || "", detail: i.group && !secs.some((s) => s.name === i.group) ? i.group : "" }, extra)));
    plan.items.forEach((i) => {
      if (i.kind === "game") return push(team, "other", i, { activity: `First Pitch${S && S.meta && S.meta.opponent ? " vs " + S.meta.opponent : ""}`, dur: 0 });
      if (i.track === "all") return push(team, "other", i);
      if (i.track === "pitchers") return (pit.length ? pit : ["Pitchers"]).forEach((g) => push(g, "pitcher", i));
      if (i.group && pos.includes(i.group)) return push(i.group, "position", i);
      if (i.group && pos.length) { const n = +String(i.group).replace(/\D/g, ""); const g = pos[(n || 1) - 1]; if (g) return push(g, "position", i, { detail: "" }); }
      (pos.length ? pos : ["Position Players"]).forEach((g) => push(g, "position", i));
    });
    return out;
  }

  /* --------------------------------------------------------- dictation */
  let rec = null;
  const micBtn = (id) => (window.SpeechRecognition || window.webkitSpeechRecognition) ? `<button class="btn sm mha-mic" id="${id}" title="Dictate">🎙 Dictate</button>` : "";
  function wireMic(id, onText) {
    const b = q("#" + id, panel); if (!b) return;
    b.onclick = () => {
      if (rec) { stopMic(); return; }
      const R = window.SpeechRecognition || window.webkitSpeechRecognition; rec = new R();
      rec.lang = "en-US"; rec.interimResults = false; rec.continuous = true;
      rec.onresult = (e) => { const t = [...e.results].slice(e.resultIndex).map((r) => r[0].transcript).join(" "); onText(A.normalizeSpeech ? A.normalizeSpeech(t) : t); };
      rec.onend = () => { rec = null; b.classList.remove("rec"); };
      b.classList.add("rec"); rec.start();
    };
  }
  function stopMic() { try { rec && rec.stop(); } catch (e) {} rec = null; }


  /* ================================================================ BUILD DAILY SCHEDULE
     openBuilder({ start: "manual" | "describe" | "voice", empty, fresh }) on the day open in the Daily view (S).
     A saved plan (S.meta.dayPlan) reopens as it was — the standard activities are never generated twice. */
  const toMin = (t) => (window.GameDay ? GameDay.toMin(t) : null);
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const isComplex = () => store.affiliate && store.affiliate() === "fcl";
  const settings = () => (window.GameDaySettings ? GameDaySettings.resolved() : GameDay.resolve(null, store.affiliate && store.affiliate()));
  function openBuilder(opts = {}) {
    ensure();
    B = { start: opts.start || "manual", empty: !!opts.empty };
    const iso = S && S.meta && S.meta.date;
    B.games = iso && typeof Games !== "undefined" ? Games.listForDate(iso).filter((g) => g.status !== "canceled" && g.status !== "postponed") : [];
    const saved = S && S.meta && S.meta.dayPlan;
    log = []; sel = null;
    if (saved && saved.request && !opts.fresh) {
      B.game = saved.anchor && saved.anchor.gameId ? B.games.find((g) => g.id === saved.anchor.gameId) || null : null;
      B.generated = saved.generated || {}; B.status = saved.status || "draft"; B.home = !B.game || B.game.homeAway !== "away";
      B.std = (saved.request.activities || []).filter((a) => String(a.id).startsWith("std-"));
      st = E.fromRequest(saved.request, appCtx(), { interpreter: saved.interpreter || "manual" });
      if (B.game && B.game.time && saved.anchor && saved.anchor.time && saved.anchor.time !== B.game.time) B.recalc = { from: saved.anchor.time, to: B.game.time };
      if (saved.anchor && saved.anchor.gameId && !B.game) log.push({ who: "me", text: "The game this plan was built around is no longer on the schedule for this date." });
      log.push({ who: "me", text: B.status === "published" ? "This is the published schedule. Edit it here, then publish again." : "Your saved draft." });
      B.start = "manual";
    } else startPlan({ fresh: true, keep: true });
    panel.hidden = false; document.body.classList.add("mha-open");
    render(); loadBudget();
    if (B.start === "voice") setTimeout(() => { const m = q("#dyMic", panel); if (m) m.click(); else toast("Voice input isn't available in this browser — type the day instead"); }, 60);
  }
  /** the day's starting plan: game-day activities (or the Complex workout), or nothing for Start Empty */
  function startPlan(o = {}) {
    const st0 = { start: B.start, empty: B.empty, games: B.games, status: B.status };
    B = Object.assign(B, { pending: null, recalc: null, std: [], generated: {}, game: null, home: true });
    const games = B.games || [];
    if (games.length > 1 && !o.gameId && !B.empty) { B.pending = { kind: "anchor" }; st = null; if (!o.keep) render(); return; }
    const g = games.length ? (games.find((x) => x.id === o.gameId) || games[0]) : null;
    B.game = g; B.home = !g || g.homeAway !== "away";
    if (g && !g.time && !o.time && !B.empty) { B.pending = { kind: "tbd" }; st = null; if (!o.keep) render(); return; }
    const time = o.time || (g && g.time) || "";
    const r = GameDay.startRequest({ game: !!g, gameTime: time, workout: !g && isComplex(), empty: B.empty, settings: settings() });
    B.generated = r.generated; B.std = r.request.activities.slice(); B.time = time;
    st = E.fromRequest(r.request, appCtx(), { interpreter: "manual" });
    log = [{ who: "me", html: introLine(g, time) }]; sel = null;
    if (!o.keep) render();
  }
  function introLine(g, time) {
    const n = B.std.length;
    if (B.empty) return g ? `Empty day around the game at <b>${fmtAP(toMin(time))}</b>. Add activities, or describe the day.` : "Empty day. Add activities, describe the day, or start from a saved template in the Daily view.";
    if (g) return `<b>${n} standard game-day activit${n === 1 ? "y" : "ies"}</b> placed from first pitch at <b>${fmtAP(toMin(time))}</b> (${g.homeAway === "away" ? "road" : "home"} game). Drag a block, edit a time, add or remove activities — or describe changes below.`;
    if (n) return `<b>Complex workout day</b>: ${n} default activities. Change anything, or describe the day below.`;
    return "No game on this date. Add activities, describe the day, or start from a saved template in the Daily view.";
  }
  function pendingCard() {
    if (B.pending.kind === "anchor") return `<div class="dy-pend"><b>Doubleheader</b><p>Which game should the standard game-day activities be built around?</p>
      ${B.games.map((g) => `<button class="btn" data-anchor="${h(g.id)}">Game ${g.gameNumber || 1} · ${g.homeAway === "away" ? "@" : "vs."} ${h(g.opponent || "TBD")} · ${g.time ? h(fmtAP(toMin(g.time))) : "TBD"}</button>`).join("")}
      <button class="btn quiet" data-anchor-empty>Neither — start empty</button></div>`;
    return `<div class="dy-pend"><b>First pitch is TBD</b><p>The game-day activities are timed from first pitch. Enter it to add them — or start empty.</p>
      <div class="dy-pend-row"><input type="time" id="dyTbd" aria-label="First pitch"><button class="btn primary" data-tbd>Add game-day activities</button></div>
      <button class="btn quiet" data-anchor-empty>Start empty</button></div>`;
  }
  /** builder controls on the left: add an activity, recalculation offer */
  function builderLeft() {
    const lib = libraryLabels();
    return `${B.recalc ? `<div class="dy-recalc"><b>The game time changed</b> — ${h(fmtAP(toMin(B.recalc.from)))} → ${h(fmtAP(toMin(B.recalc.to)))}.
        ${GameDay.customized(st.request, B.generated).length ? `<p>You changed ${GameDay.customized(st.request, B.generated).length} of the standard activities.</p>` : ""}
        <div class="dy-alts"><button class="btn sm primary" data-recalc="untouched">Recalculate the standard activities${GameDay.customized(st.request, B.generated).length ? " I haven't changed" : ""}</button>
        ${GameDay.customized(st.request, B.generated).length ? `<button class="btn sm" data-recalc="all">Recalculate all of them</button>` : ""}<button class="btn sm quiet" data-recalc="keep">Keep the times</button></div></div>` : ""}
      <details class="dy-add" ${B.addOpen ? "open" : ""}><summary>+ Add activity</summary>
        <div class="dy-add-f">
          <label>Activity<input id="dyaLabel" list="dyaList" placeholder="e.g. Defensive Meeting"></label>
          <datalist id="dyaList">${lib.map((l) => `<option value="${h(l)}">`).join("")}</datalist>
          <label>Start<input id="dyaAt" type="time"></label>
          <label>Minutes<input id="dyaDur" type="number" min="5" max="300" step="5" value="30"></label>
          <label>Who<select id="dyaWho">${WHO.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
          <label>Facility<input id="dyaLoc" list="dyaLocs" placeholder="Optional"></label>
          <datalist id="dyaLocs">${locations().map((l) => `<option value="${h(l)}">`).join("")}</datalist>
          <button class="btn primary sm" data-addact>Add</button>
        </div></details>`;
  }
  const WHO = [["all", "Team"], ["position", "Position players"], ["pitchers", "Pitchers"], ["catchers", "Catchers"]];
  function libraryLabels() { try { return (typeof Library !== "undefined" ? Library.grouped().flatMap((g) => g.items.map((i) => i.label)) : []).slice(0, 200); } catch (e) { return []; } }
  function locations() { try { const L = (typeof LIB !== "undefined" && LIB.locations) || []; return L.slice(0, 80); } catch (e) { return []; } }
  /** an activity's colour from the Activity Library (by name), so blocks read by type */
  const colorOf = (() => { let map = null; return (label) => { try { if (!map) { map = {}; Library.grouped().forEach((g) => g.items.forEach((i) => { map[String(i.label).toLowerCase()] = g.cat.color; })); } } catch (e) { map = map || {}; } return map[String(label || "").toLowerCase().replace(/ — round \d+$/, "")] || null; }; })();

  function bindBuilder() {
    qa("[data-anchor]", panel).forEach((b) => (b.onclick = () => { B.pending = null; startPlan({ gameId: b.dataset.anchor }); }));
    const ae = q("[data-anchor-empty]", panel); if (ae) ae.onclick = () => { B.empty = true; B.pending = null; startPlan({ gameId: (B.games[0] || {}).id }); };
    const tb = q("[data-tbd]", panel); if (tb) tb.onclick = () => { const t = q("#dyTbd", panel).value; if (!t) return toast("Enter first pitch first"); B.pending = null; startPlan({ gameId: (B.games[0] || {}).id, time: t }); };
    const mm = q("[data-manual]", panel); if (mm) mm.onclick = () => { B.start = "manual"; render(); };
    qa("[data-recalc]", panel).forEach((b) => (b.onclick = () => {
      const mode = b.dataset.recalc;
      if (mode !== "keep") {
        const r = GameDay.recalc(st.request, B.generated, B.recalc.to, settings().gameDay, mode);
        if (r) { st = Object.assign(E.edit(st, () => r.request, appCtx(), "Recalculated for the new game time"), { interpreter: st.interpreter }); B.generated = r.generated; log.push({ who: "me", text: `Moved ${r.moved} standard activit${r.moved === 1 ? "y" : "ies"} to the new first pitch${r.kept.length ? `; kept ${r.kept.length} you changed` : ""}.` }); }
      } else {
        st = Object.assign(E.edit(st, (req) => { req.anchors.firstPitch = toMin(B.recalc.to); return req; }, appCtx(), "Game time updated"), { interpreter: st.interpreter });
        log.push({ who: "me", text: "Kept your times; the game marker moved." });
      }
      B.recalc = null; B.time = B.game && B.game.time; saveDayPlan(B.status === "published" ? "published" : "draft", true); render();
    }));
    const add = q("[data-addact]", panel);
    if (add) {
      q(".dy-add", panel).ontoggle = (e) => { B.addOpen = e.target.open; };
      add.onclick = () => {
        const label = q("#dyaLabel", panel).value.trim(); if (!label) return toast("Name the activity");
        const at = toMin(q("#dyaAt", panel).value), dur = Math.max(5, +q("#dyaDur", panel).value || 30);
        const who = q("#dyaWho", panel).value, loc = q("#dyaLoc", panel).value.trim();
        editReq((r) => { r.activities.push({ id: "u" + Math.random().toString(36).slice(2, 8), kind: "custom", label, text: label, who, at, dur, rounds: null, order: r.activities.length + 1, after: [], before: [], emphasis: null, indoor: null, location: loc || null }); return r; }, `Add ${label}`);
        B.addOpen = true; render();
      };
    }
  }
  function editReq(fn, label) {
    const before = st.plan;
    st = Object.assign(E.edit(st, fn, appCtx(), label), { interpreter: st.interpreter, fallback: st.fallback });
    log.push({ who: "you", text: label }, { who: "me", html: changeSummary(before, st.plan, []) });
    if (log.length > 40) log = log.slice(-40);
  }
  /** the selected block: edit it in place */
  function builderToolbar() {
    const i = selected(); if (!i) return "";
    const act = (st.request.activities || []).find((a) => a.id === i.actId);
    if (!act) return `<div class="dy-tools"><b>${h(i.label)}</b><span>${fmtAP(i.start)}${i.end > i.start ? "–" + fmtAP(i.end) : ""}</span><span class="mha-note">${i.kind === "game" ? "The game comes from the schedule — it can't be moved here." : "Placed by Manager Hub around your fixed times."}</span></div>`;
    const rounds = act.rounds && (act.rounds.each || act.rounds.count);
    const len = rounds ? (i.end - i.start) : (act.dur != null ? act.dur : i.end - i.start);
    return `<div class="dy-tools dy-edit">
      <label class="dy-f wide">Activity<input data-ef="label" value="${h(act.label || i.label)}"></label>
      <label class="dy-f">Start<input data-ef="at" type="time" value="${hhmm(i.start)}"></label>
      <label class="dy-f sm">${rounds ? "Min / round" : "Minutes"}<input data-ef="dur" type="number" min="5" max="300" step="5" value="${len}"></label>
      <label class="dy-f">Who<select data-ef="who">${WHO.map(([v, l]) => `<option value="${v}" ${act.who === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="dy-f">Facility<input data-ef="location" list="dyaLocs" value="${h(act.location || "")}" placeholder="—"></label>
      <div class="dy-ea">
        <button class="btn sm" data-tool="shorter" title="5 minutes shorter">−5</button><button class="btn sm" data-tool="longer" title="5 minutes longer">+5</button>
        <button class="btn sm" data-edup>Duplicate</button>
        ${act.at != null ? `<button class="btn sm quiet" data-tool="lock">Unpin</button>` : ""}
        <button class="btn sm danger" data-tool="remove">Remove</button>
      </div>
      ${String(act.id).startsWith("std-") ? `<p class="mha-note">Standard ${B.game ? "game-day" : "workout"} activity — change it or remove it for this day.</p>` : ""}
    </div>`;
  }
  function bindEdit(host) {
    const i = selected(); if (!i) return;
    const act = (st.request.activities || []).find((a) => a.id === i.actId); if (!act) return;
    qa("[data-ef]", host).forEach((el) => (el.onchange = () => {
      const f = el.dataset.ef, v = el.value;
      if (f === "at" && !v) return;
      editReq((r) => {
        const a = r.activities.find((x) => x.id === act.id); if (!a) return r;
        if (f === "at") a.at = toMin(v);
        else if (f === "dur") { const d = Math.max(5, Math.min(300, Math.round(+v / 5) * 5 || 5)); if (a.rounds && (a.rounds.each || a.rounds.count)) a.rounds.each = d; else a.dur = d; }
        else if (f === "label") { a.label = v.trim() || a.label; a.text = a.label; }
        else if (f === "who") a.who = v;
        else if (f === "location") a.location = v.trim() || null;
        return r;
      }, { at: `Start ${act.label} at ${v}`, dur: `${act.label}: ${v} min`, label: `Rename to ${v}`, who: `${act.label} for ${(WHO.find((w) => w[0] === v) || [, v])[1]}`, location: `${act.label} at ${v || "no facility"}` }[f]);
      render();
    }));
    const dup = q("[data-edup]", host);
    if (dup) dup.onclick = () => {
      editReq((r) => { const a = r.activities.find((x) => x.id === act.id); const c = JSON.parse(JSON.stringify(a)); c.id = "u" + Math.random().toString(36).slice(2, 8); c.order = r.activities.length + 1; c.at = i.end; r.activities.push(c); return r; }, `Duplicate ${act.label}`);
      render();
    };
  }
  /* drag a block to move it (5-minute steps, pins the time); drag its lower edge to change the length */
  function bindDrag(host) {
    const tl = q(".dy-tl", host); if (!tl) return;
    qa(".dy-blk[data-item]", tl).forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const key = el.dataset.item, item = st.plan.items.find((x) => itemKey(x) === key);
        const act = item && (st.request.activities || []).find((a) => a.id === item.actId); if (!act) return;
        const rect = el.getBoundingClientRect(), resize = e.clientY > rect.bottom - 8;
        const y0 = e.clientY, px = 11 / 5;                          // 11 px per 5-minute row
        let moved = false;
        const mv = (ev) => { const dy = ev.clientY - y0; if (Math.abs(dy) > 4) moved = true; if (!moved) return; el.classList.add("dragging"); el.style.transform = resize ? "" : `translateY(${dy}px)`; if (resize) el.style.minHeight = Math.max(8, rect.height + dy) + "px"; };
        const up = (ev) => {
          document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
          el.classList.remove("dragging"); el.style.transform = ""; el.style.minHeight = "";
          if (!moved) return;
          const dm = Math.round((ev.clientY - y0) / px / 5) * 5; if (!dm) { render(); return; }
          sel = key;
          if (resize) editReq((r) => { const a = r.activities.find((x) => x.id === act.id); const cur = (a.rounds && a.rounds.each) || a.dur || (item.end - item.start); const d = Math.max(5, cur + dm); if (a.rounds && (a.rounds.each || a.rounds.count)) a.rounds.each = d; else a.dur = d; return r; }, `${act.label}: ${dm > 0 ? "+" : ""}${dm} min`);
          else { const first = Math.min(...st.plan.items.filter((x) => x.actId === act.id).map((x) => x.start)); editReq((r) => { const a = r.activities.find((x) => x.id === act.id); a.at = Math.max(0, first + dm); return r; }, `Move ${act.label} to ${fmtAP(first + dm)}`); }
          render();
        };
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
      });
    });
  }
  /** keep the plan with the day (a draft) — or mark it published */
  function saveDayPlan(status, quiet) {
    if (!S || !S.meta || !st) return;
    S.meta.dayPlan = { v: 1, request: st.request, generated: B.generated || {}, anchor: B.game ? { gameId: B.game.id, time: B.time || B.game.time || "" } : null,
      interpreter: st.interpreter, status: status || "draft", updated: new Date().toISOString(), published: (S.meta.dayPlan && S.meta.dayPlan.published) || null };
    B.status = S.meta.dayPlan.status;
    if (typeof saveDraft === "function") { dirty = true; saveDraft(); }
    if (!quiet) { try { if (typeof renderHub === "function" && VIEW === "hub") renderHub(); } catch (e) {} }
  }

  window.DayUI = { openBuilder, get builder() { return B; }, open, close, get state() { return st; }, toEvents: () => st && toEvents(st.plan), build: async (t) => { st = await build(t); log = [{ who: "you", text: t }, { who: "me", html: planSummary() }]; if (panel && !panel.hidden) render(); return st; }, refine: (t) => doRefine(t) };
})();
