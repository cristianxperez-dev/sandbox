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
  const TRACK_LABEL = { all: "Team", position: "Position players", pitchers: "Pitchers", catchers: "Catchers" };

  let panel = null, st = null, log = [], busy = false, sel = null, aiState = "unknown", lastReason = "";

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
  async function ai(mode, text, ctx, request) {
    if (aiState === "off") return null;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch("api/interpret", { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, text, ctx: wireCtx(ctx), request }) });
      if (r.status === 503 || r.status === 404 || r.status === 405) { aiState = "off"; lastReason = "No AI service is configured"; return null; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) { lastReason = `The AI interpreter didn't answer (${(d && d.error) || r.status})`; return null; }
      aiState = "on"; return d;
    } catch (e) { lastReason = "The AI interpreter timed out"; return null; }
    finally { clearTimeout(t); }
  }
  async function build(text) {
    const ctx = appCtx(); ctx.current = null;
    const r = await ai("build", text, ctx);
    const s = E.plan(text, ctx, r && r.request ? { request: r.request } : {});
    s.fallback = s.interpreter === "reader" ? lastReason : "";
    return s;
  }
  async function refine(text) {
    const ctx = appCtx();
    const r = await ai("refine", text, ctx, st.request);
    const ops = r && Array.isArray(r.ops) ? r.ops : E.Read.readEdit(text, st.request, st.plan, ctx);
    const next = E.applyOps(st, ops, ctx, text);
    next.interpreter = r && r.ops ? "ai" : "reader";
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
    panel.hidden = false; document.body.classList.add("mha-open");
    render();
    if (opts.text) { q("#dyText", panel).value = opts.text; if (opts.run) doBuild(); }
  }
  function close() { if (!panel) return; panel.hidden = true; document.body.classList.remove("mha-open"); stopMic(); }

  function head() {
    const b = typeof Brand !== "undefined" && store.affiliate ? Brand.get(store.affiliate()) : null;
    const chip = !st ? "" : st.interpreter === "ai"
      ? `<span class="mha-chip on" title="Read by the AI interpreter, then scheduled and checked by the app">AI interpreter</span>`
      : `<span class="mha-chip" title="${h(st.fallback || "Read by Manager Hub's built-in baseball reader")}">Built-in reader</span>`;
    return `<div class="mha-head">
      <div class="mha-title"><b>Describe your day</b><span>${h(S && S.meta && S.meta.date ? longDate(S.meta.date) : "No date set")}${b ? " · " + h(b.team) : ""}</span></div>
      <span class="sp"></span>
      <div class="mha-hr">${chip}<button class="dy-classic" data-classic title="Groups, rotations, templates and monthly planning">Classic assistant</button><button class="mha-x" data-close aria-label="Close">×</button></div>
    </div>`;
  }
  function render() {
    panel.innerHTML = head() + `<div class="dy-body">
      <section class="dy-left">${st ? conversation() : describe()}</section>
      <section class="dy-right" id="dyPreview"></section>
    </div>
    <div class="mha-foot">
      <button class="btn sm" data-undo ${st && st.history && st.history.length ? "" : "disabled"} title="Undo (⌘Z)">Undo</button>
      <button class="btn sm" data-redo ${st && st.redo && st.redo.length ? "" : "disabled"} title="Redo (⇧⌘Z)">Redo</button>
      ${st ? `<button class="btn sm quiet" data-restart>Start over</button>` : ""}
      <span class="sp"></span><span class="mha-note dy-footnote">${st ? "Nothing changes in the schedule until you save." : "Type or dictate — a few sentences is enough."}</span>
      <button class="btn primary" data-accept ${st && st.plan.items.length ? "" : "disabled"}>Review &amp; save →</button>
    </div>`;
    bind(); renderPreview();
  }
  function describe() {
    return `<label class="mha-lbl" for="dyText">What does the day look like?</label>
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
        <div class="dy-examples tight">${REFINE_EXAMPLES.map((x) => `<button class="dy-ex sm" data-rex="${h(x)}">${h(x)}</button>`).join("")}</div>
      </div>`;
  }
  function bind() {
    q("[data-close]", panel).onclick = close;
    q("[data-classic]", panel).onclick = () => { close(); MHAssistUI.open(); };
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
    const rs = q("[data-restart]", panel); if (rs) rs.onclick = () => { if (st && !confirm("Start over? This draft is discarded (the schedule itself hasn't changed).")) return; st = null; log = []; sel = null; render(); };
    q("[data-accept]", panel).onclick = accept;
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
    return `Built <b>${its.length} blocks</b>, ${fmtAP(s)}–${fmtAP(game ? game.start : e)}${game ? ` · game at ${fmtAP(game.start)}` : ""}. ${errs ? `<b class="dy-bad">${errs} thing${errs > 1 ? "s" : ""} won't fit</b> — see the options on the right.` : "Everything fits."}${(st.request.unknown || []).length ? ` I didn't understand: ${st.request.unknown.map((u) => "“" + h(u) + "”").join(", ")}.` : ""}`;
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
      ${sel ? toolbar() : ""}
      <div class="dy-legend"><span><i class="lg fixed"></i>Fixed</span><span><i class="lg flex"></i>Flexible</span><span><i class="lg free"></i>Time off</span><span><i class="lg inf"></i>Added by Manager Hub</span></div>`;
    qa("[data-alt]", host).forEach((b) => (b.onclick = () => { const [ci, ai] = b.dataset.alt.split(":").map(Number); const alt = conflicts[ci].alternatives[ai]; applyOps(alt.ops, alt.label); }));
    qa("[data-item]", host).forEach((b) => (b.onclick = () => { sel = sel === b.dataset.item ? null : b.dataset.item; renderPreview(); }));
    qa("[data-tool]", host).forEach((b) => (b.onclick = () => tool(b.dataset.tool)));
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
      const cls = ["dy-blk", i.kind === "free" ? "free" : i.fixed ? "fixed" : "flex", i.source === "inferred" || i.source === "default" ? "inf" : "", sel === key ? "sel" : "", len < 3 ? "tiny" : ""].join(" ");
      return `<button class="${cls}" data-item="${h(key)}" data-kind="${h(i.kind)}" style="grid-row:${row(i.start)}/span ${len};grid-column:${c0 + 2}/${c1 + 2}" title="${h(`${fmtAP(i.start)}–${fmtAP(i.end)} · ${i.label}`)}">
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
    MHAssistUI.adopt({ events, text: log.filter((m) => m.who === "you").map((m) => m.text).join("\n"), request: st.request, firstPitch: game ? game.start : null,
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

  window.DayUI = { open, close, get state() { return st; }, toEvents: () => st && toEvents(st.plan), build: async (t) => { st = await build(t); log = [{ who: "you", text: t }, { who: "me", html: planSummary() }]; if (panel && !panel.hidden) render(); return st; }, refine: (t) => doRefine(t) };
})();
