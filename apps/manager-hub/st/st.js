/* Manager Hub — Spring Training operations inside the Complex workspace (UI).

   Extends the Camp module (camp/camp.js) through CampUI.extend — Camp keeps owning the schedule, players,
   groups, staff and facilities; this adds, for camps whose type has games (Spring Training, instructs):
     Today    the command center: the complex at a glance, games, what needs attention, one primary action
     Games    Game Play Matrix · Games · Lineups (coach workspaces + coordinator review)
   plus games on the facility grid, game conflicts, "Describe the day", sharing with staff and the
   "Working as" identity. One shared player pool (affiliate rosters, read only), one set of camp groups,
   one games document — every screen reads the same records.

   Pure logic: st-core.js (StCore), st-describe.js (StDescribe). Shared store: st-sync.js (StSync). */
(function () {
  "use strict";
  const S = window.StCore, D = window.StDescribe, Sync = window.StSync;
  if (!S || !D || !Sync || !window.CampUI || !window.CampUI.extend) return;
  const A = window.CampUI.api, C = A.C, h = A.h, ICON = A.ICON, plural = A.plural;

  /* ---------- extra icons ---------- */
  const I = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    cloud: I('<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.9 12 3.5 3.5 0 0 1 17.5 19z"/>'),
    cloudOff: I('<path d="M2 2l20 20"/><path d="M7.6 7.6A5 5 0 0 0 8 19h9.5c.4 0 .8-.1 1.2-.2M21 15.5a3.5 3.5 0 0 0-1.1-3.5A6 6 0 0 0 11 7.1"/>'),
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
    ball: I('<circle cx="12" cy="12" r="9"/><path d="M6.6 5.6c1.6 1.8 2.4 4 2.4 6.4s-.8 4.6-2.4 6.4M17.4 5.6C15.8 7.4 15 9.6 15 12s.8 4.6 2.4 6.4"/>'),
    grid: I('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>'),
    list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    card: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
    mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    spark: I('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
    edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    flag: I('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>'),
    hist: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    drag: I('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
    lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')
  };

  /* ---------- module state ---------- */
  const st = {
    view: "matrix",                 // Games tab: matrix | games | lineups
    mx: { weekOf: null, all: false, q: "", group: "", role: "", aff: "", mode: "plan", sort: "name", sel: new Set(), anchor: null, focus: null, summary: true, phoneGame: null, phonePlayer: "" },
    lb: null,                       // the open lineup builder {gameId, lineup, privateNote, fromRev, dirty}
    hist: [],                       // undo for the games document (plan / actual / games)
    lastClash: null
  };
  const isNarrow = () => window.innerWidth < 760;
  const player = (pid) => A.index().get(pid) || null;
  const nameOf = (pid) => { const p = player(pid); return p ? p.name : "Unknown player"; };
  const shortName = (pid) => { const p = player(pid); return p ? (p.first ? p.first[0] + ". " : "") + p.last : "Unknown"; };
  const camp = () => A.cur();
  const kind = (c) => S.kindOf(c || camp());
  const gdoc = (c) => Sync.games((c || camp()).id);
  const todayOf = (c) => C.nowIn(c.tz).date;
  /** the date the camp screens focus: today when the camp is running, else its first (or last) day */
  function focusDate(c) { const t = todayOf(c); return t < c.start ? c.start : t > c.end ? c.end : t; }
  const fmtD = (d, o) => C.fmtDate(d, o);
  const fmtT = (m) => (m == null ? "TBD" : C.fmtTime(m));
  const staffName = (c, sid) => { const s = c.staff.find((x) => x.id === sid); return s ? s.name : ""; };
  const groupName = (c, gid) => { const g = c.groups.find((x) => x.id === gid); return g ? g.name : ""; };
  const lstatus = (gid, c) => Sync.lineupDoc(gid, c.id);
  const mine = () => Sync.me();

  /* ---------- the games document: every edit goes through here (undo + save + share) ---------- */
  function editGames(label, fn, opts) {
    const c = camp(), doc = gdoc(c);
    st.hist.push({ label, json: JSON.stringify(doc) }); if (st.hist.length > 40) st.hist.shift();
    const r = fn(doc);
    Sync.setGames(A, c.id, doc);
    if (!(opts && opts.quiet)) rerender(opts);
    return r;
  }
  function undoGames() {
    const last = st.hist.pop(); if (!last) { A.say("Nothing to undo"); return; }
    Sync.setGames(A, camp().id, JSON.parse(last.json)); rerender(); A.say("Undone: " + last.label);
  }
  function rerender(opts) {
    const c = camp(); if (!c) return;
    if (A.ui.tab === "games" || A.ui.tab === "today") { const b = A.main().querySelector("#cBody"); if (b) renderTab(A.ui.tab, b, opts); }
    else A.refresh();
    const top = A.main().querySelector("#cTop"); if (top && opts && opts.top) A.render();
  }
  function renderTab(id, b, opts) {
    if (id === "today") return renderToday(b);
    if (st.lb && st.lb.campId === camp().id) return renderBuilder(b, opts);
    return renderGames(b, opts);
  }

  /* =====================================================================
     EXTENSION HOOKS
     ===================================================================== */
  window.CampUI.extend({
    tabs(c) {
      const k = kind(c), doc = gdoc(c);
      const t = [{ id: "today", label: "Today", order: 10, render: (b) => { st.lb = null; renderToday(b); } }];
      if (k.games || doc.games.length) t.push({ id: "games", label: "Games", order: 40, count: doc.games.filter((g) => g.status !== "canceled").length || "", render: (b) => renderTab("games", b) });
      return t;
    },
    conflicts(c) {
      const doc = gdoc(c); if (!doc.games.length) return [];
      const out = [];
      C.uniq(doc.games.map((g) => g.date)).forEach((d) => S.scheduleConflicts(c, doc, d, { nameOf }).forEach((x) => out.push(x)));
      S.availabilityConflicts(doc, doc.games.filter((g) => g.status === "scheduled"), player).forEach((x) => {
        const g = doc.games.find((y) => y.id === x.gid);
        out.push({ level: x.level, kind: "status", date: g.date, ids: ["game:" + x.gid], msg: x.msg });
      });
      return out;
    },
    gridItems(c, date) {
      const doc = gdoc(c);
      return doc.games.filter((g) => g.date === date && g.status !== "canceled").map((g) => {
        const a = S.gameActivity(g, doc), l = lstatus(g.id, c);
        a.status = g.status === "final" ? "Final" : l.status !== "none" ? "Lineup " + S.LSTATUS[l.status].toLowerCase() : "";
        a.site = g.site;
        return a;
      });
    },
    toolbar(c) { return `<button class="btn sm" data-ca="st-describe" title="Type or say the day; review before anything is added">${IC.spark}<span class="c-hide-s">Describe the day</span></button>`; },
    headActions(c) { return syncChipHTML(c); },
    switchOptions(c) {
      const local = new Set(A.state().camps.map((x) => x.id));
      const remote = Sync.state.remoteCamps.filter((r) => !local.has(r.id.slice(5)));
      return remote.length ? `<optgroup label="Shared by staff">${remote.map((r) => `<option value="remote:${h(r.id.slice(5))}">${h(r.title || "Camp")}</option>`).join("")}</optgroup>` : "";
    },
    switchTo(v) {
      if (!v.startsWith("remote:")) return false;
      Sync.openRemoteCamp(A, v.slice(7)).then((cc) => { if (cc) { A.ui.tab = "today"; A.render(); A.say("Opened " + cc.name); } else A.say("Couldn't open that camp"); });
      return true;
    },
    afterChange(c) { Sync.campChanged(A, c); },
    setupExtra(c) { return sharingCardHTML(c); },
    /* no camp in this browser yet: offer the ones staff have shared before "create your first camp" */
    firstRun() {
      const list = Sync.state.remoteCamps;
      if (!list.length) return "";
      return `<section class="st-shared-first"><div><div class="st-eyebrow">Shared by your staff</div><h2 class="st-h1 sm">Open your organization's camp</h2><p class="c-muted">These camps are on the shared store. Opening one brings it into this browser; changes save for everyone.</p></div>
        <ul>${list.map((r) => `<li><button class="btn primary" data-ca="st-open-remote" data-k="${h(r.id.slice(5))}">${h(r.title || "Camp")}</button><small>Last saved ${h(new Date(r.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} by ${h(r.by || "")}</small></li>`).join("")}</ul></section>`;
    },
    shown() {
      Sync.startPolling(A);
      const c = camp();
      Sync.listCamps().then((l) => { if (!camp()) { if (l.length) A.render(); return; } const top = A.main().querySelector("#cTop"); if (top) A.refresh(); });
      if (c && Sync.isShared(c.id)) Sync.pullCamp(A, c.id);
    },
    onAction(a, el, e) { return onAction(a, el, e); },
    onChange(cf, el) { return onChange(cf, el); },
    onInput(cf, el) { return onInput(cf, el); },
    onKey(e) { return onKey(e); }
  });

  Sync.on((what, data) => {
    if (what === "remote") {
      const c = camp(); if (!c) return;
      if (st.lb && data.includes("lineup:" + st.lb.gameId)) st.lb.remoteChanged = true;
      if (A.ui.tab === "schedule") A.refresh(); else rerender();
      const top = A.main() && A.main().querySelector("#cTop"); if (top) top.innerHTML = top.innerHTML;   // header counts refresh on next render
    }
    if (what === "status" || what === "saved" || what === "pending") { const chip = A.main() && A.main().querySelector("#stSyncChip"); if (chip && camp()) chip.outerHTML = syncChipHTML(camp()); }
    if (what === "clash") {
      st.lastClash = data;
      const names = data.list.slice(0, 3).map((x) => x.label || x.path.replace(/^\./, "")).join(", ");
      A.say(`Merged with ${data.by}'s changes — ${data.list.length === 1 ? "one item" : data.list.length + " items"} you both edited kept their version${names ? " (" + names + ")" : ""}`);
    }
  });

  /* =====================================================================
     SHARING + IDENTITY
     ===================================================================== */
  function syncChipHTML(c) {
    const s = Sync.state, shared = Sync.isShared(c.id), who = mine();
    const pend = Array.from(s.pending).length;
    let cls = "local", label = "This browser only", ico = IC.cloudOff, tip = "Only this browser has this camp. Share it with staff in Setup.";
    if (shared && s.status === "shared") { cls = pend ? "busy" : "ok"; label = pend ? "Saving…" : "Shared"; ico = IC.cloud; tip = "Shared with staff — changes save automatically and others' changes appear within about 20 seconds."; }
    else if (shared && s.status === "offline") { cls = "warn"; label = "Offline — saved here"; tip = s.detail; }
    else if (shared) { cls = "warn"; label = "Not synced"; tip = s.detail || "Checking the shared store…"; }
    return `<span class="st-chips" id="stSyncChip"><button class="st-chip ${cls}" data-ca="st-sync" title="${h(tip)}">${ico}<span>${h(label)}</span></button><button class="st-chip who ${who ? "" : "none"}" data-ca="st-me" title="Recorded on your changes (self-reported — Manager Hub has one shared access code)">${IC.user}<span>${who ? h(who.name) + (who.role === "coordinator" ? " · Coord." : "") : "Who's working?"}</span></button></span>`;
  }
  function sharingCardHTML(c) {
    const shared = Sync.isShared(c.id), s = Sync.state, m = Sync.meta("camp:" + c.id);
    const coordNote = s.coordinator.required
      ? `Approving, returning and publishing lineups and publishing the schedule need the <b>coordinator code</b>${Sync.coordCode() ? " (entered on this device)" : ""}.`
      : `No coordinator code is set on this deployment, so anyone signed in can approve and publish. The owner can require one (Cloudflare secret <code>MH_COORDINATOR_CODE</code>).`;
    return `<section class="c-card c-pad st-share">
      <div class="c-row c-between"><h3 class="c-h3">Sharing with staff</h3>${shared ? `<span class="st-chip ok">${IC.cloud}<span>Shared</span></span>` : `<span class="st-chip local">${IC.cloudOff}<span>This browser only</span></span>`}</div>
      ${shared
        ? `<p class="c-note-s">Everyone signed in to Manager Hub can open this camp from the camp switcher. Changes save automatically; when two people change the same thing, the version saved first is kept and the other person is told. Last saved ${m && m.updated ? h(new Date(m.updated).toLocaleString()) + " by " + h(m.by || "") : ""}.</p>
           <div class="c-row"><button class="btn sm" data-ca="st-history" data-k="camp:${h(c.id)}">${IC.hist} Change history</button><button class="btn sm" data-ca="st-pull">Check for changes now</button></div>`
        : s.status === "local" ? `<p class="c-note-s">${h(s.detail)}</p>`
        : `<p class="c-note-s">This camp is only in this browser. Share it so coordinators and coaches can open the same schedule, groups, games and lineups from any device. Players stay on their affiliate rosters — only references are shared.</p>
           <button class="btn sm primary" data-ca="st-share">${IC.cloud} Share with staff</button>`}
      <p class="c-note-s">${coordNote}</p>
      <div class="c-row"><button class="btn sm" data-ca="st-me">${IC.user} ${mine() ? "Working as " + h(mine().name) : "Who's working on this device?"}</button>${s.coordinator.required ? `<button class="btn sm" data-ca="st-coord">${IC.lock} ${Sync.coordCode() ? "Change" : "Enter"} coordinator code</button>` : ""}</div>
    </section>`;
  }
  function whoDialog(then) {
    const c = camp(), m = mine() || { name: "", role: "coach" };
    const staff = c ? c.staff : [];
    A.openDialog({
      title: "Who's working on this device?",
      sub: "Your name goes on the changes you make, the lineups you submit and the history. It's self-reported: Manager Hub has one shared access code, not individual accounts.",
      body: `${staff.length ? `<div class="field"><label for="stWhoPick">Camp staff</label><select id="stWhoPick"><option value="">— choose —</option>${staff.map((s) => `<option value="${h(s.id)}" ${m.staffId === s.id ? "selected" : ""}>${h(s.name)}${s.role ? " · " + h(s.role) : ""}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="stWhoName">Name</label><input type="text" id="stWhoName" value="${h(m.name)}" placeholder="First Last" autocomplete="off"></div>
        <fieldset class="st-seg2"><legend>Role in Manager Hub</legend>
          <label><input type="radio" name="stRole" value="coach" ${m.role !== "coordinator" ? "checked" : ""}> <span><b>Coach</b><small>Build lineups for your games; see the schedule and the plan</small></span></label>
          <label><input type="radio" name="stRole" value="coordinator" ${m.role === "coordinator" ? "checked" : ""}> <span><b>Coordinator</b><small>Review, approve and publish; manage the plan</small></span></label>
        </fieldset>`,
      mount: (b) => { const pick = b.querySelector("#stWhoPick"); if (pick) pick.addEventListener("change", () => { const s = staff.find((x) => x.id === pick.value); if (s) { b.querySelector("#stWhoName").value = s.name; if (/coord|manager|director/i.test(s.role)) b.querySelector('[value="coordinator"]').checked = true; } }); },
      foot: [{ label: "Cancel" }, { label: "Save", cls: "primary", fn: (b) => {
        const name = b.querySelector("#stWhoName").value.trim(); if (!name) { b.querySelector("#stWhoName").focus(); return true; }
        const pick = b.querySelector("#stWhoPick");
        Sync.setMe({ name, role: b.querySelector('[name="stRole"]:checked').value, staffId: pick && pick.value ? pick.value : null });
        A.render(); if (then) then();
      } }]
    });
  }
  function coordDialog(then) {
    A.openDialog({
      title: "Coordinator code", sub: "Set by the owner in Cloudflare. It's kept for this browser session only and sent with approvals and publishing.",
      body: `<div class="field"><label for="stCoord">Code</label><input type="password" id="stCoord" autocomplete="off" value=""></div>`,
      foot: [{ label: "Clear", fn: () => { Sync.setCoordCode(""); A.render(); } }, { label: "Save", cls: "primary", fn: (b) => { Sync.setCoordCode(b.querySelector("#stCoord").value.trim()); A.render(); if (then) then(); } }]
    });
  }
  async function historyDialog(id, title) {
    const rows = await Sync.history(id);
    A.openDialog({ title: title || "Change history", wide: true, sub: "Names are what each person entered under “Working as” (self-reported).",
      body: rows == null ? `<p class="c-muted">History is only kept for shared camps (the shared store isn't reachable).</p>` : rows.length ? `<table class="st-tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Version</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${h(new Date(r.at).toLocaleString())}</td><td>${h(r.by)}</td><td><b>${h(r.action)}</b>${r.summary ? " — " + h(r.summary) : ""}</td><td>${r.version}</td></tr>`).join("")}</tbody></table>` : `<p class="c-muted">No changes recorded yet.</p>`,
      foot: [{ label: "Close", cls: "primary" }] });
  }

  /* =====================================================================
     TODAY — the command center
     ===================================================================== */
  function tasksFor(c, date) {
    const doc = gdoc(c), tasks = [], all = A.conflicts(c), who = mine();
    const errsToday = all.filter((x) => x.date === date && x.level === "error");
    if (errsToday.length) tasks.push({ pri: 1, cls: "err", text: plural(errsToday.length, "schedule conflict") + " today", act: "st-go-sched", k: date, cta: "Resolve" });
    const tom = C.addDays(date, 1);
    if (C.campDates(c).includes(tom) && !C.activitiesOn(c.draft.activities, tom).length) tasks.push({ pri: 3, cls: "", text: "Tomorrow (" + fmtD(tom) + ") has no schedule yet", act: "st-go-sched", k: tom, cta: "Build" });
    if (C.hasUnpublished(c)) tasks.push({ pri: 2, cls: "warn", text: c.published ? "Schedule changes aren't published" : "The schedule hasn't been published", act: "publish", cta: "Review & publish" });
    const upcoming = S.gamesIn(doc, date, C.addDays(date, 2)).filter((g) => g.status === "scheduled");
    const review = doc.games.filter((g) => ["submitted"].includes(lstatus(g.id, c).status));
    if (review.length) tasks.push({ pri: 1, cls: "warn", text: plural(review.length, "lineup") + " waiting for review", act: "st-lineups", cta: "Review" });
    const approved = doc.games.filter((g) => lstatus(g.id, c).status === "approved");
    if (approved.length) tasks.push({ pri: 2, cls: "", text: plural(approved.length, "approved lineup") + " not published", act: "st-lineups", cta: "Publish" });
    const noLineup = upcoming.filter((g) => lstatus(g.id, c).status === "none" && !Sync.draft(g.id));
    if (noLineup.length) tasks.push({ pri: 2, cls: "", text: plural(noLineup.length, "game") + " in the next 3 days without a lineup", act: "st-lineups", cta: "Open" });
    const empty = upcoming.filter((g) => !S.plannedIn(doc, g.id).length);
    if (empty.length) tasks.push({ pri: 2, cls: "", text: plural(empty.length, "game") + " with nobody planned yet", act: "st-matrix", k: empty[0].id, cta: "Plan" });
    const past = doc.games.filter((g) => g.date < date && g.status !== "canceled" && S.plannedIn(doc, g.id).length && !S.hasActuals(doc, g.id));
    if (past.length) tasks.push({ pri: 2, cls: "warn", text: plural(past.length, "played game") + " without actual participation recorded", act: "st-actuals", k: past[past.length - 1].id, cta: "Record" });
    const il = S.availabilityConflicts(doc, upcoming, player).filter((x) => x.level === "error");
    if (il.length) tasks.push({ pri: 1, cls: "err", text: plural(il.length, "player") + " on an injured list planned in a game", act: "st-matrix", cta: "Review" });
    if (who && who.role !== "coordinator" && who.staffId) {
      const myGames = upcoming.filter((g) => g.coaches.includes(who.staffId) && ["none", "returned"].includes(lstatus(g.id, c).status));
      myGames.forEach((g) => tasks.push({ pri: 0, cls: "mine", text: "Your lineup for " + S.gameTitle(g) + " (" + fmtD(g.date) + ")" + (lstatus(g.id, c).status === "returned" ? " was returned" : ""), act: "st-lineup", k: g.id, cta: "Build lineup" }));
    }
    return tasks.sort((a, b) => a.pri - b.pri);
  }
  /** the one action the page leads with — whatever moves the day forward next */
  function primaryAction(c, date, tasks) {
    const doc = gdoc(c), who = mine();
    if (!c.players.length) return { label: "Add players to the camp", act: "tab", k: "players", sub: "Start from the organization's rosters; build groups next." };
    const mineT = tasks.find((t) => t.cls === "mine"); if (mineT) return { label: mineT.cta + " — " + mineT.text.replace(/^Your lineup for /, ""), act: mineT.act, k: mineT.k, sub: "Your assigned game" };
    if (!C.activitiesOn(c.draft.activities, date).length) return { label: "Build today's schedule", act: "st-go-sched", k: date, sub: "Lay it out on the facility grid, or describe it in a sentence." };
    const rv = tasks.find((t) => /waiting for review/.test(t.text)); if (rv && (!who || who.role === "coordinator")) return { label: "Review " + rv.text.replace(" waiting for review", ""), act: "st-lineups", sub: "Approve, return or publish" };
    const tom = C.addDays(date, 1);
    if (C.campDates(c).includes(tom) && !C.activitiesOn(c.draft.activities, tom).length) return { label: "Build tomorrow's schedule", act: "st-go-sched", k: tom, sub: fmtD(tom, { long: true }) };
    if (C.hasUnpublished(c)) return { label: "Review & publish the schedule", act: "publish", sub: "Staff see the published version in printouts" };
    if (doc.games.some((g) => g.date >= date)) return { label: "Plan game participation", act: "st-matrix", sub: "Game Play Matrix" };
    return { label: "Open today's schedule", act: "st-go-sched", k: date, sub: "" };
  }
  function renderToday(b) {
    const c = camp(), date = focusDate(c), doc = gdoc(c), dates = C.campDates(c), k = kind(c);
    const now = C.nowIn(c.tz), isToday = now.date === date;
    const acts = C.activitiesOn(c.draft.activities, date), games = S.gamesIn(doc, date, date);
    const tasks = tasksFor(c, date), prim = primaryAction(c, date, tasks);
    const dayN = dates.indexOf(date) + 1;
    const pubState = !acts.length ? ["none", "No schedule"] : !c.published ? ["draft", "Draft — not published"] : C.hasUnpublished(c) ? ["changed", "Published · changes pending"] : ["live", "Published"];
    const heads = new Set(); acts.forEach((a) => C.resolvePlayers(a, c).forEach((p) => heads.add(p))); games.forEach((g) => S.plannedIn(doc, g.id).forEach((p) => heads.add(p)));
    const unsched = c.players.filter((p) => !heads.has(p));
    b.innerHTML = `<div class="st-today">
      <header class="st-hero">
        <div class="st-hero-date">
          <div class="st-eyebrow">${isToday ? "Today" : date < now.date ? "Last camp day" : "First camp day"} · Day ${dayN} of ${dates.length}</div>
          <h2 class="st-h1">${h(fmtD(date, { long: true }))}</h2>
          <div class="st-facts">
            <span class="st-pill ${pubState[0]}">${h(pubState[1])}</span>
            <span>${plural(acts.length, "activity", "activities")}</span><span>${plural(games.length, "game")}</span>
            <span>${heads.size} of ${c.players.length} players scheduled</span>
            ${unsched.length && c.players.length ? `<button class="c-link" data-ca="st-unsched">${unsched.length} not scheduled</button>` : ""}
          </div>
        </div>
        <div class="st-hero-act">
          <button class="btn primary st-primary" data-ca="${h(prim.act)}" ${prim.k ? `data-k="${h(prim.k)}"` : ""}>${h(prim.label)}</button>
          ${prim.sub ? `<small>${h(prim.sub)}</small>` : ""}
          <div class="st-quick">
            <button class="btn sm quiet" data-ca="st-describe" data-k="${h(date)}">${IC.spark} Describe a day</button>
            ${k.games || doc.games.length ? `<button class="btn sm quiet" data-ca="st-new-game" data-k="${h(date)}">${ICON.plus} New game</button><button class="btn sm quiet" data-ca="st-matrix">${IC.grid} Game Play Matrix</button>` : ""}
            <button class="btn sm quiet" data-ca="tab" data-k="players">${ICON.users} Groups</button>
          </div>
        </div>
      </header>
      <div class="st-cols">
        <section class="st-main">
          <div class="st-sec-h"><h3>The complex ${isToday ? "now" : "on " + h(fmtD(date))}</h3><button class="c-link" data-ca="st-go-sched" data-k="${h(date)}">Open the schedule →</button></div>
          ${acts.length || games.length ? (isNarrow() ? nowNextHTML(c, date, acts, games) : glanceHTML(c, date, acts, games)) : `<div class="st-empty"><b>Nothing on the schedule for this day.</b><span>Build it on the facility grid, or describe it — “Everybody stretches at 9. Groups A and B take defense on Fields 1 and 2 at 9:30…”</span><div class="c-row"><button class="btn sm primary" data-ca="st-go-sched" data-k="${h(date)}">Build the day</button><button class="btn sm" data-ca="st-describe" data-k="${h(date)}">${IC.spark} Describe it</button></div></div>`}
          ${c.groups.length ? groupsNowHTML(c, date, acts, games, isToday ? now.minute : null) : ""}
        </section>
        <aside class="st-side">
          ${k.games || doc.games.length ? `<div class="st-sec-h"><h3>Games</h3><button class="c-link" data-ca="st-view" data-k="games">All games →</button></div>${gamesTodayHTML(c, date)}` : ""}
          <div class="st-sec-h"><h3>Needs attention</h3>${tasks.length ? `<span class="c-n">${tasks.length}</span>` : ""}</div>
          ${tasks.length ? `<ul class="st-tasks">${tasks.slice(0, 8).map((t) => `<li class="${t.cls}"><span>${h(t.text)}</span><button class="btn sm ${t.cls === "mine" ? "primary" : "quiet"}" data-ca="${t.act}" ${t.k ? `data-k="${h(t.k)}"` : ""}>${h(t.cta)}</button></li>`).join("")}</ul>` : `<p class="st-allclear">${ICON.check} Nothing outstanding.</p>`}
          <div class="st-sec-h"><h3>Coming up</h3></div>
          ${comingHTML(c, date)}
        </aside>
      </div>
    </div>`;
  }
  /** the whole complex on one screen: a row per facility, the day as a horizontal timeline */
  function glanceHTML(c, date, acts, games) {
    const doc = gdoc(c), gacts = games.map((g) => S.gameActivity(g, doc));
    const all = acts.concat(gacts);
    let s = 1440, e = 0; all.forEach((a) => { s = Math.min(s, a.start); e = Math.max(e, a.start + a.dur); });   // the busy part of the day only
    s = Math.floor(s / 60) * 60; e = Math.max(s + 180, Math.ceil(e / 60) * 60);
    const span = e - s, pct = (m) => ((m - s) / span * 100).toFixed(3) + "%";
    const known = new Set(c.facilities.map((f) => f.id));
    const rows = c.facilities.map((f) => ({ f, list: all.filter((a) => a.facilityId === f.id) })).filter((r) => r.list.length);
    const none = all.filter((a) => !a.facilityId || !known.has(a.facilityId));
    if (none.length) rows.push({ f: { id: "", name: "No facility" }, list: none });
    const now = C.nowIn(c.tz), nowL = now.date === date && now.minute >= s && now.minute <= e ? `<div class="st-gl-now" style="left:${pct(now.minute)}"><span>${h(C.fmtTime(now.minute))}</span></div>` : "";
    const ticks = []; for (let m = s; m < e; m += 60) ticks.push(`<span style="left:${pct(m)}">${h(C.fmtTime(m, { short: true }))}</span>`);
    const quiet = c.facilities.filter((f) => !all.some((a) => a.facilityId === f.id)).map((f) => f.name);
    return `<div class="st-glance" role="table" aria-label="Facilities through the day">
      <div class="st-gl-ticks" aria-hidden="true"><span class="st-gl-lab"></span><div class="st-gl-track">${ticks.join("")}</div></div>
      ${rows.map((r) => {
        const lanes = C.layoutLanes(r.list), n = Math.max(1, ...r.list.map((a) => lanes[a.id].lanes));
        return `<div class="st-gl-row" role="row" style="--lanes:${n};--hours:${span / 60}"><span class="st-gl-lab" role="rowheader" title="${h(r.f.name)}">${h(r.f.name)}</span><div class="st-gl-track" role="cell">${r.list.map((a) => {
          const L = lanes[a.id], gs = (a.groups || []).map((g) => c.groups.find((x) => x.id === g)).filter(Boolean);
          const who = a.game ? plural(a.players.length, "player") : gs.length ? gs.map((g) => g.name).join(", ") : plural(C.resolvePlayers(a, c).size, "player");
          return `<button class="st-gl-blk ${a.game ? "game" : ""}" data-ca="${a.game ? "game-open" : "st-go-act"}" data-k="${h(a.game ? a.id.slice(5) : a.id)}" data-k2="${h(date)}" style="left:${pct(a.start)};width:calc(${((a.dur) / span * 100).toFixed(3)}% - 2px);top:calc(${L.lane} * 100% / ${L.lanes});height:calc(100% / ${L.lanes} - 2px);--cat:${a.game ? "#002D62" : C.catOf(a.cat).color};${gs[0] ? "--g:" + gs[0].color : ""}" title="${h(a.title + " · " + C.fmtSpan(a.start, a.dur) + " · " + who)}"><b>${a.game ? "Game · " : ""}${h(a.title)}</b><span>${h(who)}</span></button>`;
        }).join("")}${nowL}</div></div>`;
      }).join("")}
      ${quiet.length ? `<p class="st-gl-quiet">Open all day: ${h(quiet.join(" · "))}</p>` : ""}
    </div>`;
  }
  /** phones: now / next / later instead of a timeline */
  function nowNextHTML(c, date, acts, games) {
    const doc = gdoc(c), all = acts.concat(games.map((g) => S.gameActivity(g, doc))).sort((a, b) => a.start - b.start);
    const now = C.nowIn(c.tz), m = now.date === date ? now.minute : -1;
    const cur = all.filter((a) => a.start <= m && m < a.start + a.dur), next = all.filter((a) => a.start > m).slice(0, 6), later = all.filter((a) => a.start > m).slice(6);
    const row = (a) => `<button class="st-nn-item ${a.game ? "game" : ""}" data-ca="${a.game ? "game-open" : "st-go-act"}" data-k="${h(a.game ? a.id.slice(5) : a.id)}" data-k2="${h(date)}" style="--cat:${a.game ? "#002D62" : C.catOf(a.cat).color}"><span class="t">${h(C.fmtTime(a.start, { ampm: false }))}</span><span class="m"><b>${a.game ? "Game · " : ""}${h(a.title)}</b><small>${h(a.facilityId ? A.facName(c, a.facilityId) : a.site || "")}${(a.groups || []).length ? " · " + h(a.groups.map((g) => groupName(c, g)).join(", ")) : ""}</small></span></button>`;
    return `<div class="st-nn">${cur.length ? `<div class="st-nn-h">Now</div>${cur.map(row).join("")}` : ""}${next.length ? `<div class="st-nn-h">${m >= 0 ? "Next" : "Schedule"}</div>${next.map(row).join("")}` : ""}${later.length ? `<details><summary>${plural(later.length, "more block")}</summary>${later.map(row).join("")}</details>` : ""}</div>`;
  }
  /** where each group is now and next */
  function groupsNowHTML(c, date, acts, games, minute) {
    const doc = gdoc(c);
    const rows = c.groups.map((g) => {
      const who = new Set(g.players);
      const list = acts.filter((a) => a.groups.includes(g.id)).concat(games.filter((gm) => S.plannedIn(doc, gm.id).some((p) => who.has(p))).map((gm) => S.gameActivity(gm, doc))).sort((a, b) => a.start - b.start);
      const m = minute == null ? -1 : minute;
      const nowA = list.find((a) => a.start <= m && m < a.start + a.dur), nextA = list.find((a) => a.start > m);
      const cell = (a) => (a ? `<b>${h(a.title)}</b><small>${h(C.fmtTime(a.start))} · ${h(a.facilityId ? A.facName(c, a.facilityId) : a.game ? "Game" : "—")}</small>` : `<span class="c-muted">—</span>`);
      return `<tr><th scope="row"><span class="st-gdot" style="--g:${g.color}"></span>${h(g.name)} <small>${g.players.length}</small></th>${minute != null ? `<td>${cell(nowA)}</td>` : ""}<td>${cell(minute != null ? nextA : list[0])}</td><td class="st-gn-n">${list.length}</td><td><button class="c-link" data-ca="st-go-group" data-k="${h(g.id)}" data-k2="${h(date)}">Day →</button></td></tr>`;
    });
    if (isNarrow()) return `<div class="st-sec-h"><h3>Groups</h3></div><ul class="st-gnl">${c.groups.map((g) => {
      const who = new Set(g.players), m = minute == null ? -1 : minute;
      const list = acts.filter((a) => a.groups.includes(g.id)).concat(games.filter((gm) => S.plannedIn(doc, gm.id).some((p) => who.has(p))).map((gm) => S.gameActivity(gm, doc))).sort((a, b) => a.start - b.start);
      const nowA = list.find((a) => a.start <= m && m < a.start + a.dur), nextA = list.find((a) => a.start > m);
      const line = (l, a) => (a ? `${l} <b>${h(a.title)}</b> · ${h(C.fmtTime(a.start))}` : "");
      return `<li><span class="g"><span class="st-gdot" style="--g:${g.color}"></span>${h(g.name)}<small>${g.players.length}</small></span><span class="w">${[line("Now", nowA), line(nowA ? "Then" : "Next", nextA)].filter(Boolean).join("<br>") || "Nothing scheduled"}</span><button class="btn sm quiet" data-ca="st-go-group" data-k="${h(g.id)}" data-k2="${h(date)}">Day</button></li>`;
    }).join("")}</ul>`;
    return `<div class="st-sec-h"><h3>Groups</h3></div><div class="st-tblwrap"><table class="st-tbl st-gnow"><thead><tr><th>Group</th>${minute != null ? "<th>Now</th>" : ""}<th>${minute != null ? "Next" : "First"}</th><th>Blocks</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }
  function gamesTodayHTML(c, date) {
    const doc = gdoc(c), list = S.gamesIn(doc, date, C.addDays(date, 1));
    if (!list.length) return `<p class="c-muted st-pad">No games today or tomorrow. <button class="c-link" data-ca="st-new-game" data-k="${h(date)}">Add a game</button></p>`;
    return `<div class="st-gcards">${list.map((g) => gameCardHTML(c, g)).join("")}</div>`;
  }
  function gameCardHTML(c, g, opts) {
    const doc = gdoc(c), l = lstatus(g.id, c), planned = S.plannedIn(doc, g.id), pit = planned.filter((p) => (S.cellOf(doc, g.id, p) || {}).role === "pitch").length;
    const coaches = g.coaches.map((s) => staffName(c, s)).filter(Boolean);
    const dr = Sync.draft(g.id), who = mine(), isMine = who && who.staffId && g.coaches.includes(who.staffId);
    const ls = l.status === "none" && dr ? "draft" : l.status;
    return `<article class="st-gcard ${g.status}">
      <div class="st-gc-top"><span class="st-gc-when">${opts && opts.noDate ? "" : h(fmtD(g.date)) + " · "}${h(fmtT(g.start))}</span>${g.squad ? `<span class="st-tag">${h(g.squad)}</span>` : ""}${g.status !== "scheduled" ? `<span class="st-tag ${g.status}">${h(g.status === "final" ? "Final" : "Canceled")}</span>` : ""}</div>
      <h4>${h(g.side === "intrasquad" ? "Intrasquad" : (g.side === "away" ? "@ " : "vs ") + (g.opponent || "TBD"))}</h4>
      <div class="st-gc-meta">${h(g.facilityId ? A.facName(c, g.facilityId) : g.site || "Site not set")} · ${g.format.innings} inn${g.format.dh ? " · DH" : ""}${g.format.extraHitters ? " · " + g.format.extraHitters + " EH" : ""}${g.format.reentry ? " · re-entry" : ""}</div>
      <div class="st-gc-stats"><span><b>${planned.length - pit}</b> position</span><span><b>${pit}</b> pitchers</span><span class="st-ls ${ls}">${ls === "draft" ? "Draft (on this device)" : "Lineup: " + h(S.LSTATUS[ls])}</span></div>
      ${coaches.length ? `<div class="st-gc-coach">${IC.user} ${h(coaches.join(", "))}${isMine ? " · <b>you</b>" : ""}</div>` : ""}
      <div class="st-gc-act"><button class="btn sm ${isMine ? "primary" : ""}" data-ca="st-lineup" data-k="${h(g.id)}">${IC.card} Lineup</button><button class="btn sm quiet" data-ca="st-matrix" data-k="${h(g.id)}">${IC.grid} Plan</button>${g.date <= todayOf(c) && g.status !== "canceled" ? `<button class="btn sm quiet" data-ca="st-actuals" data-k="${h(g.id)}">Actuals</button>` : ""}<button class="btn sm quiet c-icon" data-ca="st-game-menu" data-k="${h(g.id)}" aria-label="More for this game">${ICON.more}</button></div>
    </article>`;
  }
  function comingHTML(c, date) {
    const doc = gdoc(c), days = [];
    for (let i = 1; i <= 5; i++) { const d = C.addDays(date, i); if (d > c.end) break; days.push(d); }
    if (!days.length) return `<p class="c-muted st-pad">The camp ends ${h(fmtD(c.end))}.</p>`;
    return `<ul class="st-coming">${days.map((d) => {
      const n = C.activitiesOn(c.draft.activities, d).length, gm = S.gamesIn(doc, d, d).length;
      return `<li><button data-ca="st-go-sched" data-k="${d}"><b>${h(fmtD(d))}</b><span>${n ? plural(n, "activity", "activities") : `<em>No schedule</em>`}${gm ? " · " + plural(gm, "game") : ""}</span></button></li>`;
    }).join("")}</ul>`;
  }
  function unschedDialog() {
    const c = camp(), date = focusDate(c), doc = gdoc(c);
    const heads = new Set(); C.activitiesOn(c.draft.activities, date).forEach((a) => C.resolvePlayers(a, c).forEach((p) => heads.add(p))); S.gamesIn(doc, date, date).forEach((g) => S.plannedIn(doc, g.id).forEach((p) => heads.add(p)));
    const list = c.players.filter((p) => !heads.has(p)).map(player).filter(Boolean).sort((a, b) => a.sortName.localeCompare(b.sortName));
    A.openDialog({ title: plural(list.length, "player") + " not scheduled on " + fmtD(date), wide: true, sub: "In the camp but in no activity, group block or game plan that day.",
      body: `<div class="st-namegrid">${list.map((p) => `<span><b>${h(p.name)}</b> <small>${h(p.aff)} · ${h(p.position || (p.isPitcher ? "P" : ""))}${S.availability(p) ? " · " + h(S.availability(p).code) : ""}</small></span>`).join("")}</div>`,
      foot: [{ label: "Close", cls: "primary" }] });
  }

  /* =====================================================================
     DESCRIBE THE DAY (typed or spoken → proposal → review → add)
     ===================================================================== */
  function describeCtx(c) {
    const pool = c.players.map(player).filter(Boolean);
    return { groups: c.groups.map((g) => ({ id: g.id, name: g.name })), facilities: c.facilities.map((f) => ({ id: f.id, name: f.name, type: f.type })), staff: c.staff.map((s) => ({ id: s.id, name: s.name })),
      roles: { pitcher: pool.filter((p) => p.isPitcher).map((p) => p.pid), catcher: pool.filter((p) => p.isCatcher).map((p) => p.pid), position: pool.filter((p) => !p.isPitcher).map((p) => p.pid), all: pool.map((p) => p.pid) }, window: c.dayWindow };
  }
  function describeDialog(date) {
    const c = camp(); date = C.campDates(c).includes(date) ? date : (A.ui.date && C.campDates(c).includes(A.ui.date) ? A.ui.date : focusDate(c));
    const rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const el = A.openDialog({
      title: "Describe the day", wide: true,
      sub: "Type or say what each group does, when and where. You'll review every block before anything is added.",
      body: `<div class="st-desc">
        <div class="grid2"><div class="field"><label for="stDDate">Day</label><select id="stDDate">${C.campDates(c).map((d, i) => `<option value="${d}" ${d === date ? "selected" : ""}>${h(fmtD(d))} · Day ${i + 1}</option>`).join("")}</select></div>
        <div class="field"><label>Groups in this camp</label><div class="st-mini">${c.groups.length ? c.groups.map((g) => `<span class="c-gchip" style="--g:${g.color}">${h(g.name)}</span>`).join("") : `<span class="c-muted">None yet — blocks can still be assigned in review</span>`}</div></div></div>
        <div class="field"><label for="stDText">The day</label><textarea id="stDText" rows="5" maxlength="1500" placeholder="Everybody stretches at 9. Groups A and B take defense on Fields 1 and 2 at 9:30. Pitchers start bullpens at 10. Group C hits at 10:15. All groups break for lunch at noon."></textarea></div>
        <div class="c-row"><button class="btn sm primary" data-ca="st-d-read">Read it</button><button class="btn sm" data-ca="st-d-ai" title="Uses the AI interpreter (server-side, within Manager Hub's monthly AI budget). Falls back to the built-in reader.">${IC.spark} Read with AI</button>${rec ? `<button class="btn sm quiet" data-ca="st-d-mic" aria-pressed="false">${IC.mic} Speak</button>` : `<span class="c-muted">Voice input isn't available in this browser.</span>`}<span class="st-d-src c-muted"></span></div>
        <div id="stDOut"></div></div>`,
      foot: [{ label: "Cancel" }, { label: "Add to the day", cls: "primary", disabled: true, fn: (b) => applyDescribe(b) }]
    });
    st.desc = { date, result: null, el };
    return el;
  }
  async function describeRun(useAI) {
    const el = st.desc && st.desc.el; if (!el) return;
    const b = el.querySelector(".mbody"), c = camp(), text = b.querySelector("#stDText").value.trim(), src = b.querySelector(".st-d-src");
    if (!text) { b.querySelector("#stDText").focus(); return; }
    const ctx = describeCtx(c);
    let res = D.read(text, ctx), note = "Built-in reader";
    if (useAI) {
      src.textContent = "Reading with AI…";
      try {
        const r = await fetch("api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "camp", text, ctx: { groups: ctx.groups.map((g) => g.name), facilities: ctx.facilities.map((f) => ({ name: f.name, type: f.type })), staff: ctx.staff.map((s) => s.name), date: b.querySelector("#stDDate").value } }) });
        const j = await r.json().catch(() => ({}));
        const v = r.ok && j.result ? D.validate(Object.assign({}, j.result, { items: j.result.items.map((i) => Object.assign({}, i, { start: D.fmt(i.start) })) })) : null;
        if (r.ok && j.result) { res = j.result; note = "AI interpreter" + (j.budget ? ` · AI this month: $${(+j.budget.spentUsd || 0).toFixed(2)} of $${(+j.budget.capUsd || 9).toFixed(2)} (est.)` : ""); }
        else note = "Built-in reader · AI unavailable (" + (j.error === "not-configured" ? "not switched on here" : j.error === "budget-reached" ? "monthly AI budget reached" : j.error || "no answer") + ")";
        void v;
      } catch (e) { note = "Built-in reader · AI unavailable (network)"; }
    }
    st.desc.result = res;
    src.textContent = note;
    renderProposal(b);
  }
  function renderProposal(b) {
    const c = camp(), res = st.desc.result, out = b.querySelector("#stDOut"), date = b.querySelector("#stDDate").value;
    const ctx = describeCtx(c), t = D.toActivities(res, ctx, date);
    const trial = C.normalizeState({ camps: [Object.assign(C.clone ? C.clone(c) : JSON.parse(JSON.stringify(c)), {})] }).camps[0];
    const add = t.activities.map((a) => C.newActivity(a));
    trial.draft.activities = trial.draft.activities.concat(add);
    const conf = C.conflicts(trial, { index: A.index(), date }).filter((x) => x.level === "error" && x.ids.some((id) => add.some((a) => a.id === id)));
    const existing = C.activitiesOn(c.draft.activities, date).length;
    out.innerHTML = res.items.length ? `<table class="st-tbl st-prop"><thead><tr><th><input type="checkbox" data-st-all checked aria-label="All"></th><th>Time</th><th>Activity</th><th>Who</th><th>Where</th></tr></thead><tbody>${res.items.map((it, i) => {
      const a = t.activities[i];
      const who = it.all ? "Everyone" : [].concat(it.groups, (it.roles || []).map((r) => ({ pitcher: "All pitchers", catcher: "All catchers", position: "All position players" })[r])).filter(Boolean).join(", ") || `<em class="c-muted">nobody named</em>`;
      return `<tr><td><input type="checkbox" data-st-i="${i}" checked aria-label="Include"></td><td>${h(C.fmtTime(it.start))}–${h(C.fmtTime(it.start + it.dur))}</td><td><b>${h(it.title)}</b></td><td>${typeof who === "string" && who.startsWith("<em") ? who : h(who)}</td><td>${a.facilityId ? h(A.facName(c, a.facilityId)) : `<em class="c-muted">${it.facilities.length ? h(it.facilities.join(", ")) + " (not found)" : "not set"}</em>`}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="c-muted">Nothing to add from that.</p>`;
    out.innerHTML += `${res.assumptions.length ? `<div class="st-notes"><b>Assumed</b><ul>${res.assumptions.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : ""}
      ${res.notUnderstood.length ? `<div class="st-notes warn"><b>Not understood</b><ul>${res.notUnderstood.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : ""}
      ${t.unresolved.length ? `<div class="st-notes warn"><b>Not in this camp</b> (left unassigned — nothing is created for you): ${h(t.unresolved.join(", "))}</div>` : ""}
      ${conf.length ? `<div class="st-notes err"><b>Would conflict</b><ul>${conf.slice(0, 6).map((x) => `<li>${h(x.msg)}</li>`).join("")}</ul></div>` : ""}
      ${existing ? `<label class="c-check"><input type="checkbox" id="stDReplace"> <span>Replace the ${plural(existing, "activity", "activities")} already on ${h(fmtD(date))} (otherwise these are added alongside)</span></label>` : ""}`;
    const btn = st.desc.el.querySelector(".mfoot .btn.primary"); if (btn) btn.disabled = !res.items.length;
    out.querySelector("[data-st-all]") && out.querySelector("[data-st-all]").addEventListener("change", (e) => out.querySelectorAll("[data-st-i]").forEach((x) => { x.checked = e.target.checked; }));
  }
  function applyDescribe(b) {
    const c = camp(), res = st.desc && st.desc.result; if (!res) return true;
    const date = b.querySelector("#stDDate").value, keep = Array.from(b.querySelectorAll("[data-st-i]")).filter((x) => x.checked).map((x) => +x.dataset.stI);
    const t = D.toActivities({ items: res.items.filter((_, i) => keep.includes(i)) }, describeCtx(c), date);
    const replace = b.querySelector("#stDReplace") && b.querySelector("#stDReplace").checked;
    const added = A.mutate("Describe the day", (cc) => { if (replace) C.clearDay(cc, date); const n = t.activities.map((a) => C.newActivity(a)); cc.draft.activities.push(...n); return n; }, { render: "none" });
    A.goTo(date, { view: isNarrow() ? "agenda" : "grid", flash: added.map((a) => a.id) });
    A.say(plural(added.length, "block") + " added to the draft — publish when it's right");
  }
  let recog = null;
  function toggleMic(btn) {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return;
    if (recog) { recog.stop(); return; }
    const ta = st.desc.el.querySelector("#stDText"), base = ta.value ? ta.value.trim() + " " : "";
    recog = new R(); recog.lang = "en-US"; recog.interimResults = true; recog.continuous = true;
    recog.onresult = (e) => { let s = ""; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; ta.value = base + s; };
    recog.onend = () => { recog = null; btn.setAttribute("aria-pressed", "false"); btn.classList.remove("rec"); };
    recog.onerror = () => { A.say("Voice input stopped"); };
    btn.setAttribute("aria-pressed", "true"); btn.classList.add("rec");
    try { recog.start(); } catch (e) { recog = null; }
  }

  /* =====================================================================
     GAMES TAB — Game Play Matrix · Games · Lineups
     ===================================================================== */
  function renderGames(b, opts) {
    const c = camp(), doc = gdoc(c), who = mine();
    const reviewN = doc.games.filter((g) => lstatus(g.id, c).status === "submitted").length;
    const keepScroll = opts && opts.keepScroll && b.querySelector(".st-mx-wrap") ? [b.querySelector(".st-mx-wrap").scrollTop, b.querySelector(".st-mx-wrap").scrollLeft] : null;
    b.innerHTML = `<div class="st-games">
      <div class="st-gbar">
        <div class="c-seg" role="tablist" aria-label="Games views">
          ${[["matrix", "Game Play Matrix", IC.grid], ["games", "Games", IC.ball], ["lineups", who && who.role !== "coordinator" ? "My Lineups" : "Lineups", IC.card]].map(([v, l, ic]) => `<button role="tab" aria-selected="${st.view === v}" data-ca="st-view" data-k="${v}">${ic}<span>${l}</span>${v === "lineups" && reviewN ? `<span class="c-n hot">${reviewN}</span>` : ""}</button>`).join("")}
        </div>
        <span class="c-tb-sp"></span>
        <button class="btn sm quiet" data-ca="st-undo" ${st.hist.length ? "" : "disabled"} title="${st.hist.length ? "Undo: " + h(st.hist[st.hist.length - 1].label) : "Nothing to undo"}">${ICON.undo}<span class="c-hide-s">Undo</span></button>
        <button class="btn sm primary" data-ca="st-new-game">${ICON.plus} Game</button>
      </div>
      <div id="stGBody"></div>
    </div>`;
    const body = b.querySelector("#stGBody");
    if (!doc.games.length && st.view !== "games") st.view = "games";
    if (st.view === "games") body.innerHTML = gamesListHTML(c);
    else if (st.view === "lineups") body.innerHTML = lineupsHTML(c);
    else { body.innerHTML = isNarrow() ? phoneMatrixHTML(c) : matrixHTML(c); if (keepScroll) { const w = body.querySelector(".st-mx-wrap"); if (w) { w.scrollTop = keepScroll[0]; w.scrollLeft = keepScroll[1]; } } focusCell(body); }
  }

  /* ---------- the games list ---------- */
  function gamesListHTML(c) {
    const doc = gdoc(c), games = S.sortGames(doc.games);
    if (!games.length) return `<div class="st-empty big"><b>No games yet.</b><span>Add the camp's exhibition games — date, opponent, site and format (innings, DH, extra hitters, re-entry). Then plan who plays in the Game Play Matrix, and coaches build lineups.</span><div class="c-row"><button class="btn primary" data-ca="st-new-game">${ICON.plus} Add the first game</button></div><p class="c-muted">Manager Hub doesn't import or invent Spring Training games — they're entered here by staff.</p></div>`;
    const byDate = {}; games.forEach((g) => (byDate[g.date] = byDate[g.date] || []).push(g));
    const today = todayOf(c);
    return `<div class="st-glist">${Object.keys(byDate).sort().map((d) => `<section class="st-gday ${d === today ? "today" : d < today ? "past" : ""}"><h3>${h(fmtD(d, { long: true }))}${d === today ? ` <span class="st-tag now">Today</span>` : ""}</h3><div class="st-gcards">${byDate[d].map((g) => gameCardHTML(c, g, { noDate: true })).join("")}</div></section>`).join("")}</div>`;
  }
  function gameDialog(gid, date) {
    const c = camp(), doc = gdoc(c), g0 = gid ? doc.games.find((x) => x.id === gid) : null;
    const g = g0 || S.newGame({ date: C.campDates(c).includes(date) ? date : focusDate(c), start: 13 * 60 });
    const fields = c.facilities.filter((f) => f.type === "field");
    const tOpts = () => { let s = `<option value="">TBD</option>`; for (let m = 7 * 60; m <= 21 * 60; m += 5) s += `<option value="${m}" ${g.start === m ? "selected" : ""}>${C.fmtTime(m)}</option>`; return s; };
    A.openDialog({
      title: g0 ? "Edit game" : "New game", wide: true,
      body: `<div class="st-gform">
        <div class="grid3"><div class="field"><label for="sgDate">Date</label><select id="sgDate">${C.campDates(c).map((d) => `<option value="${d}" ${d === g.date ? "selected" : ""}>${h(fmtD(d))}</option>`).join("")}</select></div>
        <div class="field"><label for="sgStart">First pitch</label><select id="sgStart">${tOpts()}</select></div>
        <div class="field"><label for="sgSquad">Squad / level</label><input id="sgSquad" list="sgSquads" value="${h(g.squad)}" placeholder="e.g. Triple-A, B game, Split squad"><datalist id="sgSquads">${["Major League", "Triple-A", "Double-A", "High-A", "Single-A", "Complex", "B game", "Split squad"].map((x) => `<option value="${x}">`).join("")}</datalist></div></div>
        <div class="grid3"><div class="field"><label for="sgSide">Home / away</label><select id="sgSide"><option value="home" ${g.side === "home" ? "selected" : ""}>Home</option><option value="away" ${g.side === "away" ? "selected" : ""}>Away</option><option value="intrasquad" ${g.side === "intrasquad" ? "selected" : ""}>Intrasquad</option></select></div>
        <div class="field"><label for="sgOpp">Opponent</label><input id="sgOpp" value="${h(g.opponent)}" placeholder="Opponent's name" autocomplete="off"></div>
        <div class="field"><label for="sgFac">Site</label><select id="sgFac"><option value="">${g.side === "away" ? "Away / off site" : "Not set"}</option>${(fields.length ? fields : c.facilities).map((f) => `<option value="${h(f.id)}" ${g.facilityId === f.id ? "selected" : ""}>${h(f.name)}</option>`).join("")}</select><input id="sgSite" class="c-mt6" value="${h(g.site)}" placeholder="Or a place, e.g. the opponent's complex"></div></div>
        <fieldset class="st-fmt"><legend>Game format</legend>
          <div class="grid4"><div class="field"><label for="sgInn">Innings</label><input type="number" id="sgInn" min="1" max="15" value="${g.format.innings}"></div>
          <div class="field"><label for="sgEH">Extra hitters</label><input type="number" id="sgEH" min="0" max="6" value="${g.format.extraHitters}"></div>
          <label class="c-check"><input type="checkbox" id="sgDH" ${g.format.dh ? "checked" : ""}> <span>DH</span></label>
          <label class="c-check"><input type="checkbox" id="sgRe" ${g.format.reentry ? "checked" : ""}> <span>Re-entry allowed</span></label></div>
          <div class="field"><label for="sgPL">Pitching notes for this game</label><input id="sgPL" value="${h(g.format.pitcherLimit)}" placeholder="As agreed for this game, e.g. innings may end early on a pitch count" maxlength="80"></div>
          <div class="field"><label for="sgFN">Other rules</label><input id="sgFN" value="${h(g.format.notes)}" placeholder="e.g. Runner on 2nd in extra innings; free substitution" maxlength="400"></div>
        </fieldset>
        <div class="grid2"><div class="field"><label>Lineup coaches</label><div class="st-checks">${c.staff.length ? c.staff.map((s) => `<label><input type="checkbox" name="sgCoach" value="${h(s.id)}" ${g.coaches.includes(s.id) ? "checked" : ""}> ${h(s.name)}${s.role ? ` <small>${h(s.role)}</small>` : ""}</label>`).join("") : `<span class="c-muted">Add camp staff in Setup to assign lineup coaches.</span>`}</div></div>
        <div class="field"><label>Groups that feed this game</label><div class="st-checks">${c.groups.length ? c.groups.map((gr) => `<label><input type="checkbox" name="sgGrp" value="${h(gr.id)}" ${g.groups.includes(gr.id) ? "checked" : ""}> <span class="st-gdot" style="--g:${gr.color}"></span>${h(gr.name)} <small>${gr.players.length}</small></label>`).join("") : `<span class="c-muted">No camp groups yet.</span>`}</div></div></div>
        ${g0 ? `<div class="grid2"><div class="field"><label for="sgStatus">Status</label><select id="sgStatus">${[["scheduled", "Scheduled"], ["final", "Final"], ["canceled", "Canceled"]].map(([v, l]) => `<option value="${v}" ${g.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field"><label for="sgNotes">Notes</label><input id="sgNotes" value="${h(g.notes)}"></div></div>` : `<div class="field"><label for="sgNotes">Notes</label><input id="sgNotes" value="${h(g.notes)}"></div>`}
      </div>`,
      foot: (g0 ? [{ label: "Delete game", cls: "danger", fn: () => { if (!window.confirm("Delete this game and its participation plan? Lineups stay in the history.")) return true; editGames("Delete game", (d) => { d.games = d.games.filter((x) => x.id !== g0.id); delete d.plan[g0.id]; delete d.actual[g0.id]; }); A.say("Game deleted", { label: "Undo", fn: undoGames }); } }] : []).concat([{ label: "Cancel" }, { label: g0 ? "Save" : "Add game", cls: "primary", fn: (b) => {
        const v = (id) => b.querySelector("#" + id).value;
        const ng = S.normGame(Object.assign({}, g, { date: v("sgDate"), start: v("sgStart") === "" ? null : +v("sgStart"), squad: v("sgSquad"), side: v("sgSide"), opponent: v("sgOpp"), facilityId: v("sgFac") || null, site: v("sgSite"),
          format: { innings: +v("sgInn"), extraHitters: +v("sgEH"), dh: b.querySelector("#sgDH").checked, reentry: b.querySelector("#sgRe").checked, pitcherLimit: v("sgPL"), notes: v("sgFN") },
          coaches: Array.from(b.querySelectorAll('[name="sgCoach"]:checked')).map((x) => x.value), groups: Array.from(b.querySelectorAll('[name="sgGrp"]:checked')).map((x) => x.value),
          status: b.querySelector("#sgStatus") ? v("sgStatus") : g.status, notes: v("sgNotes") }));
        if (ng.side !== "intrasquad" && !ng.opponent) { b.querySelector("#sgOpp").focus(); return true; }
        editGames(g0 ? "Edit game" : "Add game", (d) => { const i = d.games.findIndex((x) => x.id === ng.id); if (i >= 0) d.games[i] = ng; else d.games.push(ng); });
        A.say(g0 ? "Game saved" : "Game added — plan participation in the Game Play Matrix");
      } }])
    });
  }
  function gameMenu(anchor, gid) {
    const c = camp(), g = gdoc(c).games.find((x) => x.id === gid); if (!g) return;
    A.openMenu(anchor, [
      { label: "Edit game", fn: () => gameDialog(gid) },
      { label: "Plan in the matrix", fn: () => openMatrixAt(gid) },
      { label: "Lineup", fn: () => openBuilder(gid) },
      { label: "Record actual participation", fn: () => actualsDialog(gid) },
      { sep: true },
      { label: "Print participation plan", fn: () => printPlan(gid) },
      { label: "Print lineup card", disabled: !lstatus(gid, c).current, fn: () => printLineup(gid, "dugout") },
      { label: "Lineup history", disabled: !Sync.isShared(c.id), fn: () => historyDialog("lineup:" + gid, "Lineup history — " + S.gameTitle(g)) },
      { sep: true },
      { label: "Show on the schedule", fn: () => A.goTo(g.date, { flash: ["game:" + g.id] }) }
    ]);
  }

  /* =====================================================================
     GAME PLAY MATRIX
     ===================================================================== */
  const ROLE_ORDER = (p) => (p.isPitcher ? 3 : p.isCatcher ? 0 : /^(1B|2B|3B|SS|IF|INF|UTIL)$/.test(p.position) ? 1 : 2);
  const ROLE_LABEL = ["Catchers", "Infielders", "Outfielders & others", "Pitchers"];
  function mxPlayers(c) {
    const f = st.mx, q = f.q.trim().toLowerCase();
    let list = c.players.map(player).filter(Boolean);
    if (f.group) { const g = c.groups.find((x) => x.id === f.group); const s = new Set(g ? g.players : []); list = list.filter((p) => s.has(p.pid)); }
    if (f.role === "pitcher") list = list.filter((p) => p.isPitcher); else if (f.role === "position") list = list.filter((p) => !p.isPitcher); else if (f.role === "catcher") list = list.filter((p) => p.isCatcher);
    if (f.aff) list = list.filter((p) => p.affId === f.aff);
    if (q) list = list.filter((p) => (p.name + " " + p.number + " " + p.position + " " + p.aff).toLowerCase().includes(q));
    return list;
  }
  function mxGames(c) {
    const doc = gdoc(c), all = S.gamesIn(doc);
    if (st.mx.all || all.length <= 14) return all;
    const ws = C.weekStart(st.mx.weekOf || focusDate(c)), we = C.addDays(ws, 6);
    return all.filter((g) => g.date >= ws && g.date <= we);
  }
  function matrixHTML(c) {
    const doc = gdoc(c), games = mxGames(c), all = S.gamesIn(doc);
    const list = mxPlayers(c), today = todayOf(c);
    const sums = new Map(list.map((p) => [p.pid, S.playerSummary(doc, p.pid, all, today)]));
    const sort = st.mx.sort;
    const sorted = list.slice().sort((a, b) => ROLE_ORDER(a) - ROLE_ORDER(b) || (sort === "inn" ? (a.isPitcher ? sums.get(a.pid).outsPlayed + sums.get(a.pid).outsPlanned - sums.get(b.pid).outsPlayed - sums.get(b.pid).outsPlanned : sums.get(a.pid).innProjected - sums.get(b.pid).innProjected) : 0) || a.sortName.localeCompare(b.sortName));
    const fac = C.facets(A.pool(), (typeof AFFILIATES !== "undefined" ? AFFILIATES : []));
    const ws = C.weekStart(st.mx.weekOf || focusDate(c));
    const showWeek = !st.mx.all && all.length > 14;
    const low = S.lowPlayingTime(list.filter((p) => !p.isPitcher).map((p) => sums.get(p.pid)));
    const lowSet = new Set(low.list.map((x) => x.pid));
    const head = games.map((g) => {
      const l = lstatus(g.id, c), n = S.plannedIn(doc, g.id).length, rec = S.hasActuals(doc, g.id);
      return `<th class="st-mx-gh ${g.date === today ? "today" : ""} ${g.status}" scope="col"><button data-ca="st-mx-gmenu" data-k="${h(g.id)}" title="${h(S.gameTitle(g))} — options"><span class="d">${h(C.fmtDate(g.date, { noDow: false }))}${g.start != null ? " · " + h(C.fmtTime(g.start, { short: true })) : ""}</span><b>${h(g.side === "intrasquad" ? "Intrasquad" : (g.side === "away" ? "@" : "vs") + " " + (g.opponent || "TBD"))}</b><span class="m">${g.squad ? h(g.squad) + " · " : ""}${n} planned${rec ? " · actuals in" : ""}</span><span class="st-ls ${l.status}">${h(S.LSTATUS[l.status])}</span></button></th>`;
    }).join("");
    let lastRole = -1;
    const rows = sorted.map((p) => {
      const s = sums.get(p.pid), r = ROLE_ORDER(p);
      const sec = r !== lastRole ? `<tr class="st-mx-sec"><th colspan="${games.length + 3}" scope="rowgroup">${ROLE_LABEL[r]} <small>${sorted.filter((x) => ROLE_ORDER(x) === r).length}</small></th></tr>` : "";
      lastRole = r;
      return sec + mxRowHTML(c, doc, p, s, games, lowSet.has(p.pid));
    }).join("");
    const sel = st.mx.sel.size;
    return `<div class="st-mx ${st.mx.summary ? "with-sum" : ""}">
      <div class="st-mx-tools">
        <label class="c-search"><span class="c-sr">Find a player</span><input type="search" data-cf="st-mx-q" value="${h(st.mx.q)}" placeholder="Find a player" autocomplete="off"></label>
        <select data-cf="st-mx-group" aria-label="Group"><option value="">All camp players</option>${c.groups.map((g) => `<option value="${h(g.id)}" ${st.mx.group === g.id ? "selected" : ""}>${h(g.name)} (${g.players.length})</option>`).join("")}</select>
        <select data-cf="st-mx-role" aria-label="Role">${[["", "Everyone"], ["position", "Position players"], ["catcher", "Catchers"], ["pitcher", "Pitchers"]].map(([v, l]) => `<option value="${v}" ${st.mx.role === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-cf="st-mx-aff" aria-label="Affiliate"><option value="">Every level</option>${fac.affiliates.map((a) => `<option value="${h(a.id)}" ${st.mx.aff === a.id ? "selected" : ""}>${h(a.short)} · ${h(a.level)}</option>`).join("")}</select>
        <div class="c-seg sm" role="tablist" aria-label="Show">${[["plan", "Plan"], ["actual", "Actual"], ["both", "Plan vs actual"]].map(([v, l]) => `<button role="tab" aria-selected="${st.mx.mode === v}" data-ca="st-mx-mode" data-k="${v}">${l}</button>`).join("")}</div>
        <span class="c-tb-sp"></span>
        ${showWeek ? `<span class="st-weeknav"><button class="btn sm quiet c-icon" data-ca="st-mx-week" data-k="-7" aria-label="Previous week">${ICON.left}</button><b>Week of ${h(C.fmtDate(ws, { noDow: true }))}</b><button class="btn sm quiet c-icon" data-ca="st-mx-week" data-k="7" aria-label="Next week">${ICON.right}</button></span>` : ""}
        ${all.length > 14 ? `<button class="btn sm quiet" data-ca="st-mx-all">${st.mx.all ? "This week" : "All " + all.length + " games"}</button>` : ""}
        <button class="btn sm quiet" data-ca="st-mx-sort" title="Sort within each section">${st.mx.sort === "inn" ? "Fewest innings first" : "A–Z"}</button>
        <button class="btn sm quiet" data-ca="st-mx-export" aria-haspopup="menu">${ICON.download} Export</button>
        <button class="btn sm quiet" data-ca="st-mx-sum" aria-pressed="${st.mx.summary}">Summary</button>
      </div>
      ${sel > 1 ? `<div class="st-mx-batch"><b>${sel} cells selected</b><span class="c-muted">Type to fill them all (e.g. <kbd>ss 5</kbd>, <kbd>p 2</kbd>, <kbd>off</kbd>) or</span><button class="btn sm" data-ca="st-mx-edit">Edit together</button><button class="btn sm quiet" data-ca="st-mx-clear-sel">Clear selection</button></div>` : `<p class="st-mx-hint">Click a cell, then type: <kbd>ss 5</kbd> starts at short for 5 innings · <kbd>sub 2b</kbd> · <kbd>p 2</kbd> two innings pitched (<kbd>p 2 35</kbd> with a pitch count) · <kbd>avail</kbd> · <kbd>off</kbd> · <kbd>Del</kbd> clears. Shift-click selects a range. Enter opens the editor.</p>`}
      <div class="st-mx-layout">
        <div class="st-mx-wrap" tabindex="-1">
          ${games.length ? `<table class="st-mx-t mode-${st.mx.mode}" role="grid" aria-label="Game Play Matrix: players by game">
            <thead><tr><th class="st-mx-ph" scope="col">Player</th><th class="st-mx-sh" scope="col" title="Games planned · played">G</th><th class="st-mx-sh" scope="col" title="Innings: played where recorded, planned for games still to come">Inn</th>${head}</tr></thead>
            <tbody>${rows || `<tr><td colspan="${games.length + 3}" class="st-mx-none">${c.players.length ? "No players match these filters." : "Add players to the camp (Players & Groups) to plan participation."}</td></tr>`}</tbody>
          </table>` : `<div class="st-empty"><b>No games ${showWeek ? "this week" : "yet"}.</b>${showWeek ? `<span>Use the arrows to move between weeks, or show all games.</span>` : `<div class="c-row"><button class="btn sm primary" data-ca="st-new-game">${ICON.plus} Add a game</button></div>`}</div>`}
        </div>
        ${st.mx.summary ? `<aside class="st-mx-sum" aria-label="Playing-time summary">${summaryHTML(c, doc, list, all, sums, low)}</aside>` : ""}
      </div>
    </div>`;
  }
  function mxRowHTML(c, doc, p, s, games, isLow) {
    const av = S.availability(p);
    const sumG = `${s.gamesPlanned}<small>/${s.gamesPlayed}</small>`;
    const sumI = p.isPitcher ? `${S.ipOf(s.outsPlayed)}<small>${s.outsPlanned ? "+" + S.ipOf(s.outsPlanned) : ""}</small>` : `${s.innProjected}`;
    return `<tr data-pid="${h(p.pid)}" class="${isLow ? "low" : ""}">
      <th class="st-mx-p" scope="row"><button data-ca="st-player" data-k="${h(p.pid)}"><b>${h(p.last)}${p.first ? ", " + h(p.first[0]) + "." : ""}</b><span>${h(p.position || (p.isPitcher ? "P" : ""))} · ${h(p.aff)}${p.number ? " · #" + h(p.number) : ""}</span></button>${av ? `<span class="st-av ${av.level}" title="${h(av.label)} (roster status)">${h(av.code)}</span>` : ""}${isLow ? `<span class="st-low" title="Under half the median innings of the players shown">low</span>` : ""}</th>
      <td class="st-mx-s">${sumG}</td><td class="st-mx-s">${sumI}</td>
      ${games.map((g) => mxCellHTML(doc, g, p)).join("")}
    </tr>`;
  }
  function mxCellHTML(doc, g, p) {
    const c = S.cellOf(doc, g.id, p.pid), a = S.actualOf(doc, g.id, p.pid), rec = S.hasActuals(doc, g.id);
    const key = g.id + "|" + p.pid, sel = st.mx.sel.has(key), mode = st.mx.mode;
    const planT = S.cellText(c, p.isPitcher), actT = rec ? (a ? S.actualText(a) : c && c.role !== "off" ? "DNP" : "") : "";   // DNP only for players who were planned
    const diff = rec && c && c.role !== "off" && c.role !== "avail" && (!a || !a.played) ? "miss" : rec && a && a.played && (!c || c.role === "off" || c.role === "avail") ? "extra" : "";
    let inner;
    if (mode === "actual") inner = rec ? `<span class="a">${h(actT)}</span>` : c && c.role !== "off" ? `<span class="st-pv ghost">${h(planT)}</span>` : "";
    else if (mode === "both") inner = (planT ? `<span class="st-pv">${h(planT)}</span>` : "") + (rec ? `<span class="a">${h(actT)}</span>` : "");
    else inner = planT ? `<span class="st-pv">${h(planT)}</span>${rec && a && a.played ? `<i class="st-done" title="Played: ${h(actT)}"></i>` : ""}` : "";
    const lu = c && c.src === "lineup" ? " lu" : "";
    return `<td class="st-mx-c r-${c ? c.role : "none"}${lu}${sel ? " sel" : ""}${diff ? " d-" + diff : ""}${g.status === "canceled" ? " cx" : ""}" data-g="${h(g.id)}" data-p="${h(p.pid)}" tabindex="-1" role="gridcell" aria-label="${h(p.name + ", " + S.gameTitle(g) + ": " + (planT || "nothing planned") + (actT ? "; actual " + actT : ""))}">${inner}</td>`;
  }
  function summaryHTML(c, doc, list, all, sums, low) {
    const pos = list.filter((p) => !p.isPitcher), pit = list.filter((p) => p.isPitcher);
    const today = todayOf(c);
    const cat = S.catcherInnings(doc, list.filter((p) => p.isCatcher).map((p) => p.pid), all).sort((a, b) => b.played + b.planned - a.played - a.planned);
    const maxC = Math.max(1, ...cat.map((x) => x.played + x.planned));
    const pva = S.planVsActual(doc, all.filter((g) => g.date <= today));
    const played = all.filter((g) => S.hasActuals(doc, g.id)).length;
    const pitRows = pit.map((p) => ({ p, s: sums.get(p.pid) })).filter((r) => r.s.pitchPlanned || r.s.pitchApps).sort((a, b) => (a.s.daysSinceOuting == null ? 99 : a.s.daysSinceOuting) - (b.s.daysSinceOuting == null ? 99 : b.s.daysSinceOuting));
    const posDist = {}; pos.forEach((p) => Object.keys(sums.get(p.pid).positions).forEach((k) => { posDist[k] = (posDist[k] || 0) + sums.get(p.pid).positions[k]; }));
    return `<div class="st-sum">
      <div class="st-sum-kpis"><div><b>${all.length}</b><span>games</span></div><div><b>${played}</b><span>with actuals</span></div><div><b>${pos.length}</b><span>position players shown</span></div><div><b>${pit.length}</b><span>pitchers shown</span></div></div>
      <section><h4>Least playing time</h4><p class="st-sum-note">Position players under half the median innings${low.median ? " (" + Math.round(low.median * 10) / 10 + ")" : ""} of those shown — played where recorded, planned for games to come.</p>
        ${(() => { const zero = pos.filter((p) => !sums.get(p.pid).innProjected); return zero.length ? `<p class="st-sum-zero"><b>${zero.length}</b> of ${pos.length} have no innings played or planned yet. <button class="c-link" data-ca="st-mx-sort-inn">Show them first</button></p>` : ""; })()}
        ${low.list.length ? `<ol class="st-sum-list">${low.list.slice(0, 10).map((s) => `<li><button class="c-link" data-ca="st-player" data-k="${h(s.pid)}">${h(nameOf(s.pid))}</button><span>${s.innProjected} inn · ${s.gamesPlanned} G</span></li>`).join("")}</ol>` : (low.median ? `<p class="c-muted">Nobody below half the median.</p>` : "")}</section>
      ${cat.length ? `<section><h4>Catcher innings</h4><div class="st-bars">${cat.map((x) => `<div class="st-bar"><span>${h(shortName(x.pid))}</span><div class="st-bar-t"><i class="bpl" style="width:${(x.played / maxC * 100).toFixed(1)}%"></i><i class="pn" style="width:${(x.planned / maxC * 100).toFixed(1)}%"></i></div><b>${x.played}${x.planned ? `<small>+${x.planned}</small>` : ""}</b></div>`).join("")}</div><p class="st-sum-note"><i class="st-key bpl"></i> played <i class="st-key pn"></i> still planned</p></section>` : ""}
      ${Object.keys(posDist).length ? `<section><h4>Innings by position</h4><div class="st-posd">${S.FIELD_POS.filter((k) => k !== "P").concat(["DH"]).map((k) => `<span><b>${k}</b>${Math.round((posDist[k] || 0) * 10) / 10}</span>`).join("")}</div></section>` : ""}
      ${pitRows.length ? `<section><h4>Pitchers</h4><p class="st-sum-note">Counts only — workload limits are the staff's call; nothing here prescribes rest.</p><div class="st-tblwrap"><table class="st-tbl sm"><thead><tr><th>Pitcher</th><th title="Appearances: played / planned">App</th><th>IP</th><th>Pitches</th><th>Last</th><th title="Days since last outing">Days</th><th>Next</th></tr></thead><tbody>${pitRows.slice(0, 40).map(({ p, s }) => `<tr><td><button class="c-link" data-ca="st-player" data-k="${h(p.pid)}">${h(shortName(p.pid))}</button></td><td>${s.pitchApps}/${s.pitchPlanned}</td><td>${S.ipOf(s.outsPlayed) || "0.0"}</td><td>${s.pitches || "–"}</td><td>${s.lastOuting ? h(C.fmtDate(s.lastOuting, { noDow: true })) : "–"}</td><td>${s.daysSinceOuting == null ? "–" : s.daysSinceOuting}</td><td>${s.nextOuting ? h(C.fmtDate(s.nextOuting, { noDow: true })) : "–"}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      ${pva.length ? `<section><h4>Plan vs actual <span class="c-n">${pva.length}</span></h4><ul class="st-sum-list">${pva.slice(0, 12).map((x) => { const g = doc.games.find((y) => y.id === x.gid); return `<li><span>${h(shortName(x.pid))}</span><span>${h(C.fmtDate(g.date, { noDow: true }))} · ${h(x.msg)}</span></li>`; }).join("")}</ul></section>` : ""}
    </div>`;
  }
  /* phones: one game at a time, or one player's games */
  function phoneMatrixHTML(c) {
    const doc = gdoc(c), all = S.gamesIn(doc), today = todayOf(c);
    if (!all.length) return `<div class="st-empty"><b>No games yet.</b><div class="c-row"><button class="btn sm primary" data-ca="st-new-game">${ICON.plus} Add a game</button></div></div>`;
    if (!st.mx.phoneGame || !all.some((g) => g.id === st.mx.phoneGame)) st.mx.phoneGame = (all.find((g) => g.date >= today) || all[all.length - 1]).id;
    const g = all.find((x) => x.id === st.mx.phoneGame);
    const q = st.mx.phonePlayer.trim().toLowerCase();
    if (q) {
      const hits = c.players.map(player).filter(Boolean).filter((p) => (p.name + " " + p.number).toLowerCase().includes(q)).slice(0, 6);
      return phoneTop(c, all, g) + hits.map((p) => { const s = S.playerSummary(doc, p.pid, all, today); return `<section class="st-pp"><h4>${h(p.name)} <small>${h(p.position)} · ${h(p.aff)}</small></h4><p class="c-muted">${s.gamesPlanned} planned · ${s.gamesPlayed} played · ${p.isPitcher ? S.ipOf(s.outsPlayed) + " IP" : s.innProjected + " inn"}</p><ul class="st-pp-list">${all.map((gm) => { const cl = S.cellOf(doc, gm.id, p.pid), a = S.actualOf(doc, gm.id, p.pid); return cl || a ? `<li><span>${h(C.fmtDate(gm.date, { noDow: true }))} ${h(S.gameTitle(gm))}</span><b>${h(S.cellText(cl, p.isPitcher) || "—")}</b>${S.hasActuals(doc, gm.id) ? `<small>${h(a ? S.actualText(a) : "DNP")}</small>` : ""}</li>` : ""; }).join("") || "<li class='c-muted'>No games planned</li>"}</ul></section>`; }).join("");
    }
    const planned = Object.keys(doc.plan[g.id] || {}).map((pid) => ({ p: player(pid), c: doc.plan[g.id][pid] })).filter((x) => x.p);
    const groups = [["Starting", (x) => x.c.role === "start"], ["Pitching", (x) => x.c.role === "pitch"], ["Subs & available", (x) => x.c.role === "sub" || x.c.role === "avail"], ["Off", (x) => x.c.role === "off"]];
    return phoneTop(c, all, g) + `<div class="st-pg"><div class="c-row"><button class="btn sm" data-ca="st-lineup" data-k="${h(g.id)}">${IC.card} Lineup</button><button class="btn sm" data-ca="st-add-to-game" data-k="${h(g.id)}">${ICON.plus} Add players</button>${g.date <= today ? `<button class="btn sm quiet" data-ca="st-actuals" data-k="${h(g.id)}">Actuals</button>` : ""}</div>
      ${groups.map(([l, f]) => { const xs = planned.filter(f).sort((a, b) => (a.c.order || 99) - (b.c.order || 99) || a.p.sortName.localeCompare(b.p.sortName)); return xs.length ? `<h4>${l} <small>${xs.length}</small></h4><ul class="st-pg-list">${xs.map((x) => `<li><button data-ca="st-cell" data-k="${h(g.id)}" data-k2="${h(x.p.pid)}"><b>${h(x.p.name)}</b><span>${h(S.cellText(x.c, x.p.isPitcher))}</span></button></li>`).join("")}</ul>` : ""; }).join("") || `<p class="c-muted">Nobody planned for this game yet.</p>`}</div>`;
  }
  function phoneTop(c, all, g) {
    return `<div class="st-ptop"><select data-cf="st-pgame" aria-label="Game">${all.map((x) => `<option value="${h(x.id)}" ${x.id === g.id ? "selected" : ""}>${h(C.fmtDate(x.date, { noDow: true }))} · ${h(S.gameTitle(x))}</option>`).join("")}</select><label class="c-search"><span class="c-sr">Find a player</span><input type="search" data-cf="st-pplayer" value="${h(st.mx.phonePlayer)}" placeholder="Find a player's games" autocomplete="off"></label></div>`;
  }

  /* ---------- cell editing ---------- */
  /** "ss 5", "sub 2b", "p 2", "p 2.1 35", "avail", "off", "c", "5" → a plan cell (or null to clear) */
  function parseQuick(text, prev, isPitcher) {
    const t = String(text || "").trim().toLowerCase();
    if (!t || t === "-" || t === "clear") return null;
    if (/^(off|x|o)$/.test(t)) return { role: "off" };
    if (/^(avail|a|av|reserve|res)$/.test(t)) return { role: "avail" };
    let m = /^(p|pitch)(?:\s+(\d+(?:\.[0-2])?))?(?:\s+(\d+)p?)?$/.exec(t);
    if (m) return { role: "pitch", pos: "P", outs: m[2] ? S.outsOf(m[2]) : prev && prev.role === "pitch" ? prev.outs : null, pitches: m[3] ? +m[3] : prev && prev.role === "pitch" ? prev.pitches : null };
    m = /^(sub|s|in)\s*([a-z0-9]{1,2})?(?:\s+(\d{1,2}))?$/.exec(t);
    if (m && (m[1] !== "s" || !m[2] || m[2] !== "s")) return { role: "sub", pos: S.normPos(m[2] || ""), inn: m[3] ? +m[3] : null };
    m = /^(\d{1,2})$/.exec(t);
    if (m) return Object.assign({ role: "start" }, prev && prev.role !== "off" ? prev : {}, { inn: +m[1], role: prev && ["start", "sub"].includes(prev.role) ? prev.role : "start" });
    m = /^([a-z0-9]{1,2}|dh|eh)(?:\s+(\d{1,2}))?$/.exec(t);
    if (m && S.normPos(m[1])) {
      const pos = S.normPos(m[1]);
      if (pos === "P") return { role: "pitch", pos: "P", outs: m[2] ? +m[2] * 3 : null };
      return { role: "start", pos, inn: m[2] ? +m[2] : prev && prev.inn != null ? prev.inn : null };
    }
    return undefined;   // not understood
  }
  function setCells(keys, cellFn, label) {
    editGames(label, (doc) => keys.forEach((k) => { const [g, p] = k.split("|"); const nc = cellFn(S.cellOf(doc, g, p), p); S.setCell(doc, g, p, nc); }), { keepScroll: true, quiet: true });
    redrawCells(keys);
  }
  function redrawCells(keys) {
    const c = camp(), doc = gdoc(c), wrap = A.main().querySelector(".st-mx-wrap"); if (!wrap) return rerender({ keepScroll: true });
    const games = new Map(doc.games.map((g) => [g.id, g]));
    const rows = new Set(keys.map((k) => k.split("|")[1]));
    const all = S.gamesIn(doc), today = todayOf(c), shown = mxGames(c);
    rows.forEach((pid) => {
      const tr = wrap.querySelector(`tr[data-pid="${CSS.escape(pid)}"]`), p = player(pid); if (!tr || !p) return;
      const tmp = document.createElement("tbody"); tmp.innerHTML = mxRowHTML(c, doc, p, S.playerSummary(doc, pid, all, today), shown, tr.classList.contains("low"));
      tr.replaceWith(tmp.firstElementChild);
    });
    void games;
    const sum = A.main().querySelector(".st-mx-sum");
    if (sum) { const list = mxPlayers(c); const sums = new Map(list.map((p) => [p.pid, S.playerSummary(doc, p.pid, all, today)])); sum.innerHTML = summaryHTML(c, doc, list, all, sums, S.lowPlayingTime(list.filter((p) => !p.isPitcher).map((p) => sums.get(p.pid)))); }
    const bar = A.main().querySelector('[data-ca="st-undo"]'); if (bar) { bar.disabled = !st.hist.length; }
    focusCell(A.main());
  }
  function focusCell(scope) {
    const f = st.mx.focus; if (!f) return;
    const td = scope.querySelector(`td.st-mx-c[data-g="${CSS.escape(f.split("|")[0])}"][data-p="${CSS.escape(f.split("|")[1])}"]`);
    if (td) { td.tabIndex = 0; if (document.activeElement && (document.activeElement.closest(".st-mx") || document.activeElement === document.body)) td.focus({ preventScroll: false }); }
  }
  function selectCell(td, e) {
    const key = td.dataset.g + "|" + td.dataset.p;
    if (e && e.shiftKey && st.mx.anchor) {
      const wrap = td.closest("table"), cells = Array.from(wrap.querySelectorAll("td.st-mx-c"));
      const rowsP = Array.from(wrap.querySelectorAll("tr[data-pid]")).map((r) => r.dataset.pid), cols = Array.from(wrap.querySelectorAll("th.st-mx-gh button")).map((b) => b.dataset.k);
      const [ag, ap] = st.mx.anchor.split("|");
      const r0 = rowsP.indexOf(ap), r1 = rowsP.indexOf(td.dataset.p), c0 = cols.indexOf(ag), c1 = cols.indexOf(td.dataset.g);
      st.mx.sel = new Set();
      for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let k = Math.min(c0, c1); k <= Math.max(c0, c1); k++) st.mx.sel.add(cols[k] + "|" + rowsP[r]);
      void cells;
    } else if (e && (e.metaKey || e.ctrlKey)) { if (st.mx.sel.has(key)) st.mx.sel.delete(key); else st.mx.sel.add(key); st.mx.anchor = key; }
    else { st.mx.sel = new Set([key]); st.mx.anchor = key; }
    st.mx.focus = key;
    A.main().querySelectorAll("td.st-mx-c.sel").forEach((x) => x.classList.remove("sel"));
    st.mx.sel.forEach((k) => { const [g, p] = k.split("|"); const x = A.main().querySelector(`td.st-mx-c[data-g="${CSS.escape(g)}"][data-p="${CSS.escape(p)}"]`); if (x) x.classList.add("sel"); });
    A.main().querySelectorAll("td.st-mx-c[tabindex='0']").forEach((x) => { x.tabIndex = -1; });
    td.tabIndex = 0; td.focus({ preventScroll: true });
    const batch = A.main().querySelector(".st-mx-batch, .st-mx-hint");
    if (batch) { const tmp = document.createElement("div"); tmp.innerHTML = st.mx.sel.size > 1 ? `<div class="st-mx-batch"><b>${st.mx.sel.size} cells selected</b><span class="c-muted">Type to fill them all (e.g. <kbd>ss 5</kbd>, <kbd>p 2</kbd>, <kbd>off</kbd>) or</span><button class="btn sm" data-ca="st-mx-edit">Edit together</button><button class="btn sm quiet" data-ca="st-mx-clear-sel">Clear selection</button></div>` : `<p class="st-mx-hint">Click a cell, then type: <kbd>ss 5</kbd> starts at short for 5 innings · <kbd>sub 2b</kbd> · <kbd>p 2</kbd> two innings pitched (<kbd>p 2 35</kbd> with a pitch count) · <kbd>avail</kbd> · <kbd>off</kbd> · <kbd>Del</kbd> clears. Shift-click selects a range. Enter opens the editor.</p>`; batch.replaceWith(tmp.firstElementChild); }
  }
  /** an in-cell text box that appears when you start typing, like a spreadsheet */
  function quickEdit(td, first) {
    const keys = st.mx.sel.size ? Array.from(st.mx.sel) : [td.dataset.g + "|" + td.dataset.p];
    const r = td.getBoundingClientRect();
    const box = document.createElement("input");
    box.className = "st-qe"; box.value = first || ""; box.setAttribute("aria-label", "Plan for " + keys.length + " cell(s)");
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: Math.max(r.width, 120) + "px", height: r.height + "px" });
    A.layer().appendChild(box); box.focus(); box.setSelectionRange(box.value.length, box.value.length);
    let done = false;
    const commit = (move) => {
      if (done) return; done = true; box.remove();
      const v = box.value; const c = camp(), doc = gdoc(c);
      const sample = S.cellOf(doc, td.dataset.g, td.dataset.p), p = player(td.dataset.p);
      const parsed = parseQuick(v, sample, p && p.isPitcher);
      if (parsed === undefined) { A.say("Didn't understand “" + v + "” — try ss 5, sub 2b, p 2, avail or off"); return; }
      setCells(keys, (prev, pid) => { const pp = player(pid); const one = parseQuick(v, prev, pp && pp.isPitcher); return one && Object.assign({}, one, { note: prev ? prev.note : "" }); }, keys.length > 1 ? "Fill " + keys.length + " cells" : "Plan " + (p ? p.last : "player"));
      if (move) moveFocus(0, 1);
    };
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(true); } else if (e.key === "Escape") { done = true; box.remove(); focusCell(A.main()); } else if (e.key === "Tab") { e.preventDefault(); commit(false); moveFocus(e.shiftKey ? -1 : 1, 0); } });
    box.addEventListener("blur", () => commit(false));
  }
  function moveFocus(dx, dy) {
    const wrap = A.main().querySelector(".st-mx-t"); if (!wrap || !st.mx.focus) return;
    const rowsP = Array.from(wrap.querySelectorAll("tr[data-pid]")).map((r) => r.dataset.pid), cols = Array.from(wrap.querySelectorAll("th.st-mx-gh button")).map((b) => b.dataset.k);
    const [g, p] = st.mx.focus.split("|"); const r = C.clamp(rowsP.indexOf(p) + dy, 0, rowsP.length - 1), k = C.clamp(cols.indexOf(g) + dx, 0, cols.length - 1);
    const td = wrap.querySelector(`td.st-mx-c[data-g="${CSS.escape(cols[k])}"][data-p="${CSS.escape(rowsP[r])}"]`);
    if (td) { selectCell(td); td.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  /** the full editor for one or many cells */
  function cellDialog(keys) {
    const c = camp(), doc = gdoc(c);
    const [g0, p0] = keys[0].split("|"), cur0 = S.cellOf(doc, g0, p0) || { role: "start" }, pl = player(p0), game = doc.games.find((x) => x.id === g0);
    const many = keys.length > 1;
    const ctxLine = many ? plural(keys.length, "cell") : `${pl ? pl.name : ""} · ${game ? S.gameTitle(game) + ", " + fmtD(game.date) : ""}`;
    const others = !many && pl ? S.gamesIn(doc, game.date, game.date).filter((g) => g.id !== g0 && S.cellOf(doc, g.id, p0) && S.cellOf(doc, g.id, p0).role !== "off") : [];
    A.openDialog({
      title: many ? "Plan " + keys.length + " cells" : "Plan participation", sub: h(ctxLine),
      body: `<div class="st-ce">
        <div class="st-roles" role="radiogroup" aria-label="Role">${S.ROLES.map((r) => `<label><input type="radio" name="ceRole" value="${r.id}" ${cur0.role === r.id ? "checked" : ""}><span>${h(r.name)}</span></label>`).join("")}</div>
        <div class="st-ce-pos"><span>Position</span>${S.POS.concat(["EH"]).map((p) => `<label><input type="radio" name="cePos" value="${p}" ${cur0.pos === p ? "checked" : ""}><span>${p}</span></label>`).join("")}<label><input type="radio" name="cePos" value="" ${!cur0.pos ? "checked" : ""}><span>—</span></label></div>
        <div class="grid3"><div class="field"><label for="ceInn">Planned innings (defense)</label><input type="number" id="ceInn" min="0" max="15" value="${cur0.inn ?? ""}"></div>
        <div class="field"><label for="ceIP">Planned IP (pitchers)</label><input id="ceIP" value="${cur0.outs != null ? S.ipOf(cur0.outs) : ""}" placeholder="e.g. 2.0"></div>
        <div class="field"><label for="cePC">Planned pitches</label><input type="number" id="cePC" min="0" max="200" value="${cur0.pitches ?? ""}"></div></div>
        <div class="field"><label for="ceNote">Note</label><input id="ceNote" value="${h(cur0.note || "")}" maxlength="200" placeholder="e.g. first look at 3B"></div>
        ${others.length ? `<p class="st-notes warn">Also planned the same day: ${others.map((g) => h(S.gameTitle(g))).join(", ")}</p>` : ""}
        ${pl && S.availability(pl) ? `<p class="st-notes err">${h(pl.name)} is on the ${h(S.availability(pl).label)} (roster status).</p>` : ""}
        <p class="c-muted st-small">Planned workload is whatever the staff decides for this game — Manager Hub records it and shows it next to what actually happened; it doesn't set limits.</p>
      </div>`,
      foot: [{ label: "Clear", fn: () => setCells(keys, () => null, "Clear plan") }, { label: "Cancel" }, { label: "Save", cls: "primary", fn: (b) => {
        const role = (b.querySelector('[name="ceRole"]:checked') || {}).value || "start", pos = (b.querySelector('[name="cePos"]:checked') || {}).value || "";
        const inn = b.querySelector("#ceInn").value, ip = b.querySelector("#ceIP").value.trim(), pc = b.querySelector("#cePC").value, note = b.querySelector("#ceNote").value;
        if (ip && S.outsOf(ip) == null) { b.querySelector("#ceIP").focus(); A.say("Innings pitched: whole innings plus .1 or .2 — e.g. 1.2"); return true; }
        setCells(keys, (prev) => ({ role, pos, inn: inn === "" ? null : +inn, outs: ip ? S.outsOf(ip) : null, pitches: pc === "" ? null : +pc, note, src: "plan" }), many ? "Edit " + keys.length + " cells" : "Edit plan");
      } }]
    });
  }
  function matrixGameMenu(anchor, gid) {
    const c = camp(), doc = gdoc(c), g = doc.games.find((x) => x.id === gid);
    const others = S.gamesIn(doc).filter((x) => x.id !== gid && S.plannedIn(doc, x.id).length);
    A.openMenu(anchor, [{ head: S.gameTitle(g) + " · " + fmtD(g.date) },
      { label: "Add players to this game…", fn: () => addToGameDialog(gid) },
      { label: "Copy the plan from another game…", disabled: !others.length, fn: () => copyPlanDialog(gid) },
      { label: "Clear this game's plan", danger: true, disabled: !S.plannedIn(doc, gid).length, fn: () => { if (window.confirm("Clear the plan for " + S.gameTitle(g) + "? Actuals stay.")) editGames("Clear plan", (d) => { delete d.plan[gid]; }, { keepScroll: true }); } },
      { sep: true },
      { label: "Lineup", fn: () => openBuilder(gid) },
      { label: "Record actual participation", fn: () => actualsDialog(gid) },
      { label: "Print participation plan", fn: () => printPlan(gid) },
      { label: "Edit game", fn: () => gameDialog(gid) }]);
  }
  /** add a group, a role or searched players to a game (as available, starters or pitchers) */
  function addToGameDialog(gid) {
    const c = camp(), doc = gdoc(c), g = doc.games.find((x) => x.id === gid);
    const pool = c.players.map(player).filter(Boolean).sort((a, b) => a.sortName.localeCompare(b.sortName));
    const already = new Set(Object.keys(doc.plan[gid] || {}));
    A.openDialog({
      title: "Add players to " + S.gameTitle(g), wide: true, sub: fmtD(g.date) + " · players already in this game's plan are skipped",
      body: `<div class="st-add">
        <div class="field"><label>From a group</label><div class="st-checks">${c.groups.map((gr) => `<label><input type="checkbox" name="atGrp" value="${h(gr.id)}" ${g.groups.includes(gr.id) ? "checked" : ""}> <span class="st-gdot" style="--g:${gr.color}"></span>${h(gr.name)} <small>${gr.players.length}</small></label>`).join("") || `<span class="c-muted">No groups yet</span>`}</div></div>
        <div class="field"><label for="atQ">Or pick players</label><input type="search" id="atQ" placeholder="Filter by name, position, affiliate" autocomplete="off"><div class="st-pick" id="atList">${pool.map((p) => `<label data-n="${h((p.name + " " + p.position + " " + p.aff).toLowerCase())}" class="${already.has(p.pid) ? "in" : ""}"><input type="checkbox" name="atP" value="${h(p.pid)}" ${already.has(p.pid) ? "disabled" : ""}> <b>${h(p.name)}</b> <small>${h(p.position)} · ${h(p.aff)}${already.has(p.pid) ? " · already in" : ""}</small></label>`).join("")}</div></div>
        <div class="field"><label>Add them as</label><div class="st-roles">${[["avail", "Available"], ["start", "Starters"], ["sub", "Subs"], ["pitch", "Pitchers"]].map(([v, l], i) => `<label><input type="radio" name="atRole" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div><p class="c-muted st-small">Positions and innings can be set afterwards in the matrix or by the lineup.</p></div>
      </div>`,
      mount: (b) => { const q = b.querySelector("#atQ"); q.addEventListener("input", () => { const v = q.value.toLowerCase(); b.querySelectorAll("#atList label").forEach((l) => { l.hidden = v && !l.dataset.n.includes(v); }); }); },
      foot: [{ label: "Cancel" }, { label: "Add", cls: "primary", fn: (b) => {
        const role = b.querySelector('[name="atRole"]:checked').value;
        const pids = new Set(Array.from(b.querySelectorAll('[name="atP"]:checked')).map((x) => x.value));
        Array.from(b.querySelectorAll('[name="atGrp"]:checked')).forEach((x) => { const gr = c.groups.find((y) => y.id === x.value); if (gr) gr.players.forEach((p) => pids.add(p)); });
        const add = Array.from(pids).filter((p) => !already.has(p));
        if (!add.length) { A.say("Nobody new to add"); return; }
        editGames("Add " + plural(add.length, "player") + " to a game", (d) => add.forEach((pid) => { const p = player(pid); S.setCell(d, gid, pid, { role: role === "start" && p && p.isPitcher ? "pitch" : role, pos: role === "pitch" || (p && p.isPitcher && role === "start") ? "P" : "" }); }), { keepScroll: true });
        A.say(plural(add.length, "player") + " added to " + S.gameTitle(g));
      } }]
    });
  }
  function copyPlanDialog(gid) {
    const c = camp(), doc = gdoc(c), g = doc.games.find((x) => x.id === gid);
    const others = S.gamesIn(doc).filter((x) => x.id !== gid && S.plannedIn(doc, x.id).length);
    A.openDialog({ title: "Copy a plan into " + S.gameTitle(g), sub: "Copies roles and positions; innings and pitch plans too. Cells already planned in this game are kept unless you choose to replace them.",
      body: `<div class="field"><label for="cpFrom">From</label><select id="cpFrom">${others.map((x) => `<option value="${h(x.id)}">${h(fmtD(x.date))} · ${h(S.gameTitle(x))} (${S.plannedIn(doc, x.id).length})</option>`).join("")}</select></div><label class="c-check"><input type="checkbox" id="cpRep"> <span>Replace this game's plan</span></label>`,
      foot: [{ label: "Cancel" }, { label: "Copy", cls: "primary", fn: (b) => { const from = b.querySelector("#cpFrom").value, rep = b.querySelector("#cpRep").checked; editGames("Copy plan", (d) => { if (rep) delete d.plan[gid]; Object.keys(d.plan[from] || {}).forEach((pid) => { if (!rep && S.cellOf(d, gid, pid)) return; S.setCell(d, gid, pid, Object.assign({}, d.plan[from][pid], { src: "plan", rev: null, order: null })); }); }, { keepScroll: true }); } }] });
  }
  function openMatrixAt(gid) {
    const c = camp(), g = gid && gdoc(c).games.find((x) => x.id === gid);
    st.view = "matrix"; st.lb = null;
    if (g) { st.mx.weekOf = g.date; st.mx.phoneGame = g.id; }
    if (A.ui.tab !== "games") A.setTab("games"); else rerender();
    if (g) setTimeout(() => { const th = A.main().querySelector(`.st-mx-gh button[data-k="${CSS.escape(g.id)}"]`); if (th) { th.scrollIntoView({ inline: "center", block: "nearest" }); th.closest("th").classList.add("flash"); } }, 30);
  }
  function exportMenu(anchor) {
    const c = camp(), doc = gdoc(c), games = mxGames(c), list = mxPlayers(c);
    A.openMenu(anchor, [
      { label: "Spreadsheet (CSV) — what's shown", fn: () => download(c.name.replace(/\W+/g, "-") + "-game-play-matrix.csv", S.matrixCSV(doc, games, list, { today: todayOf(c) }), "text/csv") },
      { label: "Print / PDF — what's shown", fn: () => printMatrix(games, list) }
    ]);
  }
  function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function playerDialog(pid) {
    const c = camp(), doc = gdoc(c), p = player(pid), all = S.gamesIn(doc), today = todayOf(c), s = S.playerSummary(doc, pid, all, today);
    if (!p) return;
    const groups = c.groups.filter((g) => g.players.includes(pid));
    const date = focusDate(c), it = C.itinerary(c, pid, date);
    A.openDialog({ title: p.name, wide: true, sub: `${h(p.position || "")} · ${h(p.affName)}${p.number ? " · #" + h(p.number) : ""}${S.availability(p) ? " · " + h(S.availability(p).label) : ""}${groups.length ? " · " + h(groups.map((g) => g.name).join(", ")) : ""}`,
      body: `<div class="st-pd"><div class="st-sum-kpis"><div><b>${s.gamesPlanned}</b><span>games planned</span></div><div><b>${s.gamesPlayed}</b><span>played</span></div>${p.isPitcher ? `<div><b>${S.ipOf(s.outsPlayed) || "0.0"}</b><span>IP</span></div><div><b>${s.pitches}</b><span>pitches</span></div>` : `<div><b>${s.innPlayed}</b><span>innings played</span></div><div><b>${s.pa}</b><span>PA</span></div>`}</div>
        ${!p.isPitcher && Object.keys(s.positions).length ? `<p><b>Positions:</b> ${Object.keys(s.positions).sort((a, b) => s.positions[b] - s.positions[a]).map((k) => `${k} ${Math.round(s.positions[k] * 10) / 10}`).join(" · ")}</p>` : ""}
        <h4>Games</h4><table class="st-tbl sm"><thead><tr><th>Date</th><th>Game</th><th>Plan</th><th>Actual</th></tr></thead><tbody>${all.map((g) => { const cl = S.cellOf(doc, g.id, pid), a = S.actualOf(doc, g.id, pid); return cl || a ? `<tr><td>${h(C.fmtDate(g.date, { noDow: true }))}</td><td>${h(S.gameTitle(g))}</td><td>${h(S.cellText(cl, p.isPitcher) || "—")}${cl && cl.src === "lineup" ? " <small>(lineup)</small>" : ""}</td><td>${S.hasActuals(doc, g.id) ? h(a ? S.actualText(a) : "DNP") : "<span class='c-muted'>—</span>"}</td></tr>` : ""; }).join("") || `<tr><td colspan="4" class="c-muted">No games planned.</td></tr>`}</tbody></table>
        <h4>${h(fmtD(date))} schedule</h4>${it.length ? `<ul class="st-sum-list">${it.map((x) => `<li><span>${h(C.fmtSpan(x.act.start, x.act.dur))}</span><span><b>${h(x.act.title)}</b> · ${h(A.facName(c, x.act.facilityId))}${x.via.length ? " · via " + h(x.via.join(", ")) : ""}</span></li>`).join("")}</ul>` : `<p class="c-muted">Nothing scheduled.</p>`}</div>`,
      foot: [{ label: "Close", cls: "primary" }] });
  }

  /* ---------- actual participation ---------- */
  function actualsDialog(gid) {
    const c = camp(), doc = gdoc(c), g = doc.games.find((x) => x.id === gid); if (!g) return;
    const l = lstatus(gid, c), lu = l.published || l.current;
    const pids = C.uniq(S.plannedIn(doc, gid).concat(Object.keys(doc.actual[gid] || {})).concat(lu ? Array.from(S.lineupPlayers(lu).keys()) : []));
    const rows = pids.map((pid) => ({ pid, p: player(pid), c: S.cellOf(doc, gid, pid), a: S.actualOf(doc, gid, pid) })).filter((r) => r.p).sort((a, b) => (a.p.isPitcher - b.p.isPitcher) || ((a.c && a.c.order) || 99) - ((b.c && b.c.order) || 99) || a.p.sortName.localeCompare(b.p.sortName));
    const recorded = S.hasActuals(doc, gid);
    A.openDialog({
      title: "Actual participation — " + S.gameTitle(g), wide: true,
      sub: `${h(fmtD(g.date))}. What happened, entered after the game. The plan is shown for reference and is never copied unless you choose to.`,
      body: `<div class="st-act">
        <div class="c-row"><button class="btn sm" data-ca="st-act-fill" title="Fills empty rows with the planned values — check them against the scorebook">Fill empty rows from the plan</button><label class="btn sm quiet st-file">${ICON.download} Import CSV<input type="file" accept=".csv,text/csv" data-st-csv hidden></label><button class="btn sm quiet" data-ca="st-act-add">${ICON.plus} Player</button><span class="c-muted st-small">CSV columns: Player, POS, IN, PA, IP, Pitches</span></div>
        <div class="st-tblwrap"><table class="st-tbl st-act-t"><thead><tr><th>Player</th><th>Plan</th><th>Played</th><th>Pos</th><th>Inn</th><th>PA</th><th>IP</th><th>Pitches</th></tr></thead><tbody id="stActRows">${rows.map(actRowHTML).join("")}</tbody></table></div>
        <label class="c-check"><input type="checkbox" id="stActFinal" ${g.status === "final" || !recorded ? "checked" : ""}> <span>Mark the game final</span></label>
        <div id="stActNote"></div>
      </div>`,
      mount: (b) => {
        b.querySelector("[data-st-csv]").addEventListener("change", (e) => {
          const f = e.target.files[0]; if (!f) return;
          f.text().then((t) => {
            const r = S.actualsFromCSV(t, c.players.map(player).filter(Boolean));
            const note = b.querySelector("#stActNote");
            if (r.error) { note.innerHTML = `<p class="st-notes err">That file doesn't have a Player (or Id) column.</p>`; return; }
            r.rows.forEach((x) => { let tr = b.querySelector(`tr[data-pid="${CSS.escape(x.pid)}"]`); if (!tr) { b.querySelector("#stActRows").insertAdjacentHTML("beforeend", actRowHTML({ pid: x.pid, p: player(x.pid), c: S.cellOf(doc, gid, x.pid), a: null })); tr = b.querySelector(`tr[data-pid="${CSS.escape(x.pid)}"]`); } fillActRow(tr, x.actual); });
            note.innerHTML = `<p class="st-notes">Read ${plural(r.rows.length, "row")} from ${h(f.name)} — review, then Save.${r.unmatched.length ? ` Not matched to a camp player: ${h(r.unmatched.join(", "))}.` : ""}</p>`;
          });
        });
      },
      foot: [{ label: "Cancel" }, { label: "Save actuals", cls: "primary", fn: (b) => {
        const who = (mine() || { name: "" }).name, at = new Date().toISOString();
        const vals = Array.from(b.querySelectorAll("#stActRows tr")).map((tr) => {
          const q = (n) => tr.querySelector(`[data-a="${n}"]`); const played = q("played").checked;
          const any = ["pos", "inn", "pa", "ip", "pc"].some((n) => q(n).value.trim());
          if (!played && !any) return { pid: tr.dataset.pid, a: S.normActual({ played: false, by: who, at }) };
          return { pid: tr.dataset.pid, a: S.normActual({ played: true, pos: q("pos").value, inn: q("inn").value, pa: q("pa").value, outs: S.outsOf(q("ip").value), pitches: q("pc").value, by: who, at }) };
        });
        const bad = Array.from(b.querySelectorAll('[data-a="ip"]')).find((x) => x.value.trim() && S.outsOf(x.value) == null);
        if (bad) { bad.focus(); A.say("Innings pitched: whole innings plus .1 or .2 — e.g. 1.2"); return true; }
        const fin = b.querySelector("#stActFinal").checked;
        editGames("Record actuals", (d) => { delete d.actual[gid]; vals.forEach((v) => S.setActual(d, gid, v.pid, v.a)); if (fin) { const gg = d.games.find((x) => x.id === gid); if (gg) gg.status = "final"; } });
        A.say("Actuals saved for " + S.gameTitle(g));
      } }]
    });
    st.actGame = gid;
  }
  function actRowHTML(r) {
    const a = r.a, pl = r.c;
    return `<tr data-pid="${h(r.pid)}"><th scope="row">${h(r.p.name)} <small>${h(r.p.position || "")}</small></th><td class="c-muted">${h(S.cellText(pl, r.p.isPitcher) || "—")}</td>
      <td><input type="checkbox" data-a="played" ${!a || a.played ? "checked" : ""} aria-label="Played"></td>
      <td><input data-a="pos" value="${h(a ? a.pos : "")}" size="5" aria-label="Positions played, e.g. SS/2B"></td>
      <td><input type="number" data-a="inn" min="0" max="20" value="${a && a.inn != null ? a.inn : ""}" aria-label="Defensive innings"></td>
      <td><input type="number" data-a="pa" min="0" max="12" value="${a && a.pa != null ? a.pa : ""}" aria-label="Plate appearances"></td>
      <td><input data-a="ip" value="${a && a.outs != null ? S.ipOf(a.outs) : ""}" size="4" aria-label="Innings pitched"></td>
      <td><input type="number" data-a="pc" min="0" max="250" value="${a && a.pitches != null ? a.pitches : ""}" aria-label="Pitches"></td></tr>`;
  }
  function fillActRow(tr, a) {
    const q = (n) => tr.querySelector(`[data-a="${n}"]`);
    q("played").checked = a.played !== false; q("pos").value = a.pos || ""; q("inn").value = a.inn ?? ""; q("pa").value = a.pa ?? ""; q("ip").value = a.outs != null ? S.ipOf(a.outs) : ""; q("pc").value = a.pitches ?? "";
  }

  /* =====================================================================
     LINEUPS — list, builder, review
     ===================================================================== */
  function lineupsHTML(c) {
    const doc = gdoc(c), who = mine(), today = todayOf(c);
    const games = S.sortGames(doc.games).filter((g) => g.status !== "canceled");
    if (!games.length) return `<div class="st-empty"><b>No games yet.</b><span>Lineups are built per game.</span></div>`;
    const coord = !who || who.role === "coordinator";
    const mineG = who && who.staffId ? games.filter((g) => g.coaches.includes(who.staffId)) : [];
    const review = games.filter((g) => lstatus(g.id, c).status === "submitted");
    const upcoming = games.filter((g) => g.date >= today);
    const row = (g) => {
      const l = lstatus(g.id, c), dr = Sync.draft(g.id);
      const coaches = g.coaches.map((s) => staffName(c, s)).filter(Boolean).join(", ");
      const st0 = l.status === "none" && dr ? "draft" : l.status;
      const last = l.history[l.history.length - 1];
      return `<li class="st-lrow"><button data-ca="st-lineup" data-k="${h(g.id)}"><span class="d">${h(C.fmtDate(g.date, { noDow: false }))}<small>${h(fmtT(g.start))}</small></span><span class="m"><b>${h(S.gameTitle(g))}</b><small>${coaches ? h(coaches) : "No lineup coach assigned"}${last ? " · " + h(last.action) + " by " + h(last.by) : ""}</small></span><span class="st-ls ${st0}">${st0 === "draft" ? "Draft on this device" : h(S.LSTATUS[st0])}${l.published && l.status !== "published" ? " · v" + l.published.rev + " published" : ""}</span></button></li>`;
    };
    return `<div class="st-lineups">
      ${!who ? `<div class="st-notes">Tell Manager Hub who's working on this device to see your games and sign your lineups. <button class="btn sm" data-ca="st-me">${IC.user} Who's working?</button></div>` : ""}
      ${coord && review.length ? `<section><h3>Waiting for review <span class="c-n hot">${review.length}</span></h3><ul class="st-llist">${review.map(row).join("")}</ul></section>` : ""}
      ${mineG.length ? `<section><h3>My games</h3><ul class="st-llist">${mineG.filter((g) => g.date >= today).map(row).join("") || `<li class="c-muted st-pad">No upcoming games assigned to you.</li>`}</ul></section>` : ""}
      <section><h3>${mineG.length ? "All upcoming games" : "Upcoming games"}</h3><ul class="st-llist">${upcoming.map(row).join("") || `<li class="c-muted st-pad">No upcoming games.</li>`}</ul></section>
      ${games.length > upcoming.length ? `<details class="st-past"><summary>Earlier games (${games.length - upcoming.length})</summary><ul class="st-llist">${games.filter((g) => g.date < today).reverse().map(row).join("")}</ul></details>` : ""}
    </div>`;
  }

  /* ---------- builder ---------- */
  function openBuilder(gid) {
    const c = camp(), g = gdoc(c).games.find((x) => x.id === gid); if (!g) return;
    const who = mine(), l = lstatus(gid, c), dr = Sync.draft(gid);
    let lineup, fromRev = l.rev, privateNote = "";
    if (dr) { lineup = dr.lineup; privateNote = dr.privateNote || ""; fromRev = dr.fromRev || 0; }
    else if (l.current) lineup = S.normLineup(l.current);
    else lineup = S.newLineup(g, who ? who.name : "");
    const need = S.slotCount(g.format);
    while (lineup.order.length < need) lineup.order.push({ pid: null, pos: "" });
    st.lb = { campId: c.id, gameId: gid, lineup, privateNote, fromRev, dirty: false, mode: dr ? "draft" : l.current ? "review" : "draft", pick: null, showGrid: false };
    st.view = "lineups";
    if (A.ui.tab !== "games") A.setTab("games"); else rerender();
  }
  function lbGame() { return gdoc(camp()).games.find((x) => x.id === st.lb.gameId); }
  /** players a coach chooses from: this game's plan first, then the groups that feed it, then everyone in camp */
  function lbPool(c, g) {
    const doc = gdoc(c), plan = doc.plan[g.id] || {};
    const fromGroups = new Set(); g.groups.forEach((gid) => { const gr = c.groups.find((x) => x.id === gid); if (gr) gr.players.forEach((p) => fromGroups.add(p)); });
    return c.players.map(player).filter(Boolean).map((p) => ({ p, cell: plan[p.pid] || null, tier: plan[p.pid] && plan[p.pid].role !== "off" ? 0 : fromGroups.has(p.pid) ? 1 : 2 }));
  }
  function renderBuilder(b) {
    const c = camp(), g = lbGame(); if (!g) { st.lb = null; return renderGames(b); }
    const lb = st.lb, L = lb.lineup, doc = gdoc(c), ldoc = lstatus(g.id, c), who = mine();
    const coord = !who || who.role === "coordinator";
    const used = S.lineupPlayers(L);
    const ctx = { player, nameOf, games: doc.games };
    const issues = S.checkLineup(L, g, ctx).concat(S.compareToPlan(L, doc, g, ctx));
    const errs = issues.filter((i) => i.level === "error").length;
    const isDraft = lb.mode === "draft";
    const reviewing = !isDraft && ldoc.current;
    const pool = lbPool(c, g);
    const q = (lb.q || "").toLowerCase(), tier = lb.tier == null ? (pool.some((x) => x.tier === 0) ? 0 : 1) : lb.tier;
    const poolShown = pool.filter((x) => x.tier <= tier && (!q || (x.p.name + " " + x.p.position + " " + x.p.aff).toLowerCase().includes(q)) && (lb.poolRole === "p" ? x.p.isPitcher : lb.poolRole === "h" ? !x.p.isPitcher : true)).sort((a, b) => a.tier - b.tier || a.p.isPitcher - b.p.isPitcher || a.p.sortName.localeCompare(b.p.sortName));
    const all = S.gamesIn(doc), today = todayOf(c);
    const posOpts = (v) => S.POS.concat(["EH"]).filter((p) => g.format.dh || p !== "DH").filter((p) => g.format.extraHitters || p !== "EH").map((p) => `<option ${p === v ? "selected" : ""}>${p}</option>`).join("");
    const banner = ldoc.published && ldoc.status !== "published" ? `<div class="st-notes">Revision ${ldoc.rev} is <b>${h(S.LSTATUS[ldoc.status].toLowerCase())}</b>; version ${ldoc.published.rev} published ${h(new Date(ldoc.publishedAt).toLocaleString())} stays the official lineup until a coordinator publishes again.</div>` : "";
    const remoteNote = lb.remoteChanged ? `<div class="st-notes warn">This lineup was changed by someone else just now. <button class="btn sm" data-ca="st-lb-reload">Show the latest</button></div>` : "";
    const statusPill = isDraft ? `<span class="st-ls draft">Your draft · saved on this device${lb.savedAt ? " " + h(lb.savedAt) : ""}</span>` : `<span class="st-ls ${ldoc.status}">${h(S.LSTATUS[ldoc.status])} · v${ldoc.rev}${ldoc.current ? " by " + h(ldoc.current.by) : ""}</span>`;
    b.innerHTML = `<div class="st-lb">
      <header class="st-lb-head">
        <button class="btn sm quiet" data-ca="st-lb-back">${ICON.left} Lineups</button>
        <div class="st-lb-title"><div class="st-eyebrow">${h(fmtD(g.date, { long: true }))} · ${h(fmtT(g.start))} · ${h(g.facilityId ? A.facName(c, g.facilityId) : g.site || "Site not set")}</div>
          <h2>${h(S.gameTitle(g))}</h2>
          <div class="st-fmtchips"><span>${g.format.innings} innings</span><span>${g.format.dh ? "DH" : "No DH"}</span>${g.format.extraHitters ? `<span>${g.format.extraHitters} extra hitter${g.format.extraHitters > 1 ? "s" : ""}</span>` : ""}${g.format.reentry ? "<span>Re-entry</span>" : ""}${g.format.pitcherLimit ? `<span title="Pitching notes">${h(g.format.pitcherLimit)}</span>` : ""}${g.format.notes ? `<span>${h(g.format.notes)}</span>` : ""}</div></div>
        <div class="st-lb-act">${statusPill}
          ${isDraft ? `<button class="btn sm" data-ca="st-lb-save">Save draft</button><button class="btn sm primary" data-ca="st-lb-submit">${ICON.send} Submit for review</button>`
            : `${coord && ["submitted", "returned"].includes(ldoc.status) ? `<button class="btn sm" data-ca="st-lb-return">Return…</button><button class="btn sm" data-ca="st-lb-approve">${ICON.check} Approve</button><button class="btn sm primary" data-ca="st-lb-publish">Approve & publish</button>` : ""}
               ${coord && ldoc.status === "approved" ? `<button class="btn sm" data-ca="st-lb-return">Return…</button><button class="btn sm primary" data-ca="st-lb-publish">Publish</button>` : ""}
               <button class="btn sm ${coord && ldoc.status !== "none" ? "quiet" : "primary"}" data-ca="st-lb-revise">${IC.edit} ${ldoc.status === "published" ? "Start a revision" : "Edit as a new draft"}</button>`}
          <button class="btn sm quiet c-icon" data-ca="st-lb-more" aria-label="More">${ICON.more}</button>
        </div>
      </header>
      ${banner}${remoteNote}
      ${ldoc.status === "returned" && ldoc.history.length ? `<div class="st-notes warn"><b>Returned by ${h(ldoc.history[ldoc.history.length - 1].by)}:</b> ${h(ldoc.history[ldoc.history.length - 1].note || "no note")}</div>` : ""}
      <div class="st-lb-grid ${isDraft ? "edit" : "read"}">
        <section class="st-lb-order" aria-label="Batting order">
          <div class="st-sec-h"><h3>Batting order</h3><span class="c-muted">${L.order.filter((o) => o.pid).length} of ${S.slotCount(g.format)}</span></div>
          <ol class="st-slots">${L.order.map((o, i) => {
            const p = o.pid ? player(o.pid) : null, iss = issues.filter((x) => x.pid && x.pid === o.pid);
            return `<li class="st-slot ${p ? "" : "empty"} ${lb.pick === "o" + i ? "picking" : ""}" data-slot="${i}" ${isDraft ? `data-drop="order" draggable="${!!p}"` : ""}>
              <span class="n">${i + 1}</span>
              ${p ? `<span class="st-pn"><b>${h(p.name)}</b><small>${h(p.position || "")}${p.bats ? " · B " + h(p.bats) : ""} · ${h(p.aff)}</small></span>` : `<span class="st-pn ph">${isDraft ? "Drop a player or tap to choose" : "—"}</span>`}
              ${isDraft ? `<select data-cf="st-lb-pos" data-k="${i}" aria-label="Position for spot ${i + 1}"><option value="">Pos</option>${posOpts(o.pos)}</select>` : `<b class="pos">${h(o.pos || "—")}</b>`}
              ${iss.length ? `<span class="c-flag ${iss.some((x) => x.level === "error") ? "err" : "warn"} static" title="${h(iss.map((x) => x.msg).join("\n"))}">!</span>` : ""}
              ${isDraft ? `<span class="st-slot-act">${p ? `<button class="btn sm quiet c-icon" data-ca="st-lb-up" data-k="${i}" aria-label="Move up" ${i ? "" : "disabled"}>${ICON.up}</button><button class="btn sm quiet c-icon" data-ca="st-lb-down" data-k="${i}" aria-label="Move down" ${i < L.order.length - 1 ? "" : "disabled"}>${ICON.down}</button><button class="btn sm quiet c-icon" data-ca="st-lb-clear" data-k="${i}" aria-label="Remove">${ICON.x}</button>` : `<button class="btn sm quiet" data-ca="st-lb-pick" data-k="o${i}">Choose</button>`}</span>` : ""}
            </li>`;
          }).join("")}</ol>
          ${isDraft && g.format.extraHitters < 6 ? `<button class="c-link st-small" data-ca="st-lb-slot">+ Add a batting spot (extra hitter)</button>` : ""}
          <div class="st-sec-h"><h3>Pitching plan</h3></div>
          <ol class="st-pitchers" ${isDraft ? `data-drop="pitch"` : ""}>${L.pitchers.map((pp, i) => { const p = player(pp.pid); const s = p ? S.playerSummary(doc, pp.pid, all, today) : null; return `<li><span class="n">${i === 0 ? "SP" : i + 1}</span><span class="st-pn"><b>${h(p ? p.name : "Unknown")}</b><small>${s && s.lastOuting ? "last out " + h(C.fmtDate(s.lastOuting, { noDow: true })) + " (" + s.daysSinceOuting + "d)" : "no outing recorded"}</small></span>
            ${isDraft ? `<label>IP <input data-cf="st-lb-pip" data-k="${i}" value="${pp.outs != null ? S.ipOf(pp.outs) : ""}" size="3" placeholder="—"></label><label>Pitches <input type="number" data-cf="st-lb-ppc" data-k="${i}" value="${pp.pitches ?? ""}" min="0" max="200" placeholder="—"></label><span class="st-slot-act"><button class="btn sm quiet c-icon" data-ca="st-lb-pup" data-k="${i}" ${i ? "" : "disabled"} aria-label="Earlier">${ICON.up}</button><button class="btn sm quiet c-icon" data-ca="st-lb-pdel" data-k="${i}" aria-label="Remove">${ICON.x}</button></span>` : `<span class="c-muted">${pp.outs != null ? S.ipOf(pp.outs) + " IP" : ""}${pp.pitches != null ? " · " + pp.pitches + " pitches" : ""}</span>`}</li>`; }).join("") || `<li class="ph">${isDraft ? "Drop pitchers here — the first is the starter" : "No pitchers listed"}</li>`}</ol>
          ${isDraft ? `<button class="c-link st-small" data-ca="st-lb-pick" data-k="p">+ Add a pitcher</button>` : ""}
          <div class="st-sec-h"><h3>Bench</h3><span class="c-muted">available to enter</span></div>
          <div class="st-bench" ${isDraft ? `data-drop="bench"` : ""}>${L.bench.map((pid) => `<span class="st-bchip" draggable="${isDraft}" data-bpid="${h(pid)}">${h(shortName(pid))}<small>${h((player(pid) || {}).position || "")}</small>${isDraft ? `<button class="c-icon" data-ca="st-lb-bdel" data-k="${h(pid)}" aria-label="Remove from bench">${ICON.x}</button>` : ""}</span>`).join("") || `<span class="c-muted">${isDraft ? "Drop reserves here" : "None listed"}</span>`}${isDraft ? `<button class="c-link st-small" data-ca="st-lb-pick" data-k="b">+ Add</button>` : ""}</div>
          <div class="st-sec-h"><h3>Substitutions</h3><span class="c-muted">planned changes by inning</span></div>
          <table class="st-tbl sm st-subs"><thead><tr><th>Inn</th><th>Out</th><th>In</th><th>Pos</th><th>Note</th>${isDraft ? "<th></th>" : ""}</tr></thead><tbody>${L.subs.map((s, i) => isDraft ? `<tr><td><select data-cf="st-lb-sub" data-k="${i}" data-f="inning">${Array.from({ length: g.format.innings }, (_, k) => `<option ${s.inning === k + 1 ? "selected" : ""}>${k + 1}</option>`).join("")}</select></td><td><select data-cf="st-lb-sub" data-k="${i}" data-f="out"><option value="">—</option>${Array.from(used.keys()).filter((pid) => used.get(pid).role !== "sub").map((pid) => `<option value="${h(pid)}" ${s.out === pid ? "selected" : ""}>${h(shortName(pid))}</option>`).join("")}</select></td><td><select data-cf="st-lb-sub" data-k="${i}" data-f="in"><option value="">—</option>${L.bench.concat(L.pitchers.slice(1).map((x) => x.pid)).map((pid) => `<option value="${h(pid)}" ${s.in === pid ? "selected" : ""}>${h(shortName(pid))}</option>`).join("")}</select></td><td><select data-cf="st-lb-sub" data-k="${i}" data-f="pos"><option value="">—</option>${posOpts(s.pos)}</select></td><td><input data-cf="st-lb-sub" data-k="${i}" data-f="note" value="${h(s.note)}" size="10"></td><td><button class="btn sm quiet c-icon" data-ca="st-lb-sdel" data-k="${i}" aria-label="Remove">${ICON.x}</button></td></tr>`
            : `<tr><td>${s.inning}</td><td>${h(s.out ? shortName(s.out) : "—")}</td><td>${h(s.in ? shortName(s.in) : "—")}</td><td>${h(s.pos || "")}</td><td>${h(s.note)}</td></tr>`).join("") || `<tr><td colspan="${isDraft ? 6 : 5}" class="c-muted">None planned${isDraft ? "" : ""}.</td></tr>`}</tbody></table>
          ${isDraft ? `<button class="c-link st-small" data-ca="st-lb-sadd">+ Add a substitution</button>` : ""}
          <details class="st-ing" ${lb.showGrid ? "open" : ""}><summary data-ca="st-lb-grid-toggle">Innings by position <small>optional — counts feed the planned innings</small></summary>${inningsGridHTML(L, g, isDraft)}</details>
          <div class="field st-lb-note"><label for="stLbShared">Note for coordinators <small>(goes with the lineup)</small></label><textarea id="stLbShared" data-cf="st-lb-shared" rows="2" ${isDraft ? "" : "readonly"}>${h(L.sharedNote)}</textarea></div>
          ${isDraft ? `<div class="field st-lb-note"><label for="stLbPriv">${IC.lock} Private note <small>(stays on this device — never shared)</small></label><textarea id="stLbPriv" data-cf="st-lb-priv" rows="2">${h(lb.privateNote)}</textarea></div>` : ""}
        </section>
        <section class="st-lb-mid">
          ${diamondHTML(L, g)}
          <div class="st-sec-h"><h3>Checks</h3>${errs ? `<span class="c-n err">${errs}</span>` : ""}</div>
          ${issues.length ? issueListHTML(issues) : `<p class="st-allclear">${ICON.check} Lineup and game plan agree.</p>`}
          <p class="c-muted st-small">A draft can be saved with anything missing. Differences from the Game Play Matrix are listed here and in the matrix — the matrix only changes when a coordinator approves this lineup.</p>
        </section>
        ${isDraft ? `<aside class="st-lb-pool" aria-label="Available players">
          <div class="st-sec-h"><h3>${lb.pick ? "Choose a player" : "Players"}</h3>${lb.pick ? `<button class="btn sm quiet" data-ca="st-lb-unpick">Cancel</button>` : ""}</div>
          <label class="c-search"><span class="c-sr">Search</span><input type="search" data-cf="st-lb-q" value="${h(lb.q || "")}" placeholder="Search players" autocomplete="off"></label>
          <div class="c-seg sm" role="tablist">${[[0, "This game"], [1, "+ Groups"], [2, "Whole camp"]].map(([v, l]) => `<button role="tab" aria-selected="${tier === v}" data-ca="st-lb-tier" data-k="${v}">${l}</button>`).join("")}</div>
          <div class="c-seg sm" role="tablist">${[["", "All"], ["h", "Hitters"], ["p", "Pitchers"]].map(([v, l]) => `<button role="tab" aria-selected="${(lb.poolRole || "") === v}" data-ca="st-lb-prole" data-k="${v}">${l}</button>`).join("")}</div>
          <ul class="st-pool">${poolShown.map((x) => { const u = used.get(x.p.pid), av = S.availability(x.p); return `<li draggable="true" data-ppid="${h(x.p.pid)}" class="${u ? "used" : ""}"><button data-ca="st-lb-add" data-k="${h(x.p.pid)}"><span class="st-pn"><b>${h(x.p.name)}</b><small>${h(x.p.position || "")} · ${h(x.p.aff)}${x.cell ? " · plan: " + h(S.cellText(x.cell, x.p.isPitcher)) : ""}</small></span>${u ? `<span class="st-tag">${u.role === "start" ? "#" + u.order : u.role === "pitch" ? "P" : "bench"}</span>` : ""}${av ? `<span class="st-av ${av.level}">${h(av.code)}</span>` : ""}</button></li>`; }).join("") || `<li class="c-muted st-pad">Nobody here — widen the list above.</li>`}</ul>
        </aside>` : ""}
      </div>
    </div>`;
  }
  /** errors first; three or more notes of one kind become a single line with the names */
  const KIND_SUM = { role: (n) => n + " players start in the lineup but are planned as subs or available — approving updates the plan",
    pos: (n) => n + " players at a different position than the plan", notplanned: (n) => n + " players aren't in this game's plan yet",
    missing: (n) => n + " players planned to start or pitch aren't in the lineup", nopos: (n) => n + " batting spots have no position" };
  function issueListHTML(issues) {
    const rank = { error: 0, warning: 1, info: 2 }, out = [], byKind = {};
    issues.forEach((i) => (byKind[i.kind + "|" + i.level] = byKind[i.kind + "|" + i.level] || []).push(i));
    Object.keys(byKind).sort((a, b) => rank[a.split("|")[1]] - rank[b.split("|")[1]]).forEach((k) => {
      const list = byKind[k], kind = k.split("|")[0], level = k.split("|")[1];
      if (list.length >= 3 && KIND_SUM[kind] && level !== "error") out.push(`<li class="${level}">${h(KIND_SUM[kind](list.length))}<small>${h(list.filter((x) => x.pid).map((x) => shortName(x.pid)).join(", "))}</small></li>`);
      else list.forEach((i) => out.push(`<li class="${i.level}">${h(i.msg)}</li>`));
    });
    return `<ul class="st-issues">${out.join("")}</ul>`;
  }
  function inningsGridHTML(L, g, edit) {
    const rows = L.order.filter((o) => o.pid).map((o) => o.pid).concat(L.bench).concat(L.pitchers.map((p) => p.pid)).filter((v, i, a) => a.indexOf(v) === i);
    if (!rows.length) return `<p class="c-muted st-pad">Add players first.</p>`;
    const n = g.format.innings;
    return `<div class="st-tblwrap">${edit ? `<div class="c-row"><button class="btn sm" data-ca="st-lb-grid-fill">Fill starters' positions for every inning</button><button class="btn sm quiet" data-ca="st-lb-grid-clear">Clear</button></div>` : ""}<table class="st-tbl sm st-inn"><thead><tr><th>Player</th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join("")}<th>Def</th></tr></thead><tbody>${rows.map((pid) => {
      const row = L.grid[pid] || []; const cnt = S.gridInnings(L, pid, n);
      return `<tr><th scope="row">${h(shortName(pid))}</th>${Array.from({ length: n }, (_, i) => edit ? `<td><select data-cf="st-lb-gridc" data-k="${h(pid)}" data-f="${i}" aria-label="${h(shortName(pid))} inning ${i + 1}"><option value=""></option>${S.POS.concat(["EH"]).map((p) => `<option ${row[i] === p ? "selected" : ""}>${p}</option>`).join("")}</select></td>` : `<td>${h(row[i] || "")}</td>`).join("")}<td><b>${cnt == null ? "–" : cnt}</b></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  /** the defensive alignment drawn on a field */
  function diamondHTML(L, g) {
    const at = {}; L.order.forEach((o) => { if (o.pid && o.pos && S.FIELD_POS.includes(o.pos)) at[o.pos] = o.pid; });
    if (!at.P && L.pitchers[0]) at.P = L.pitchers[0].pid;
    const XY = { P: [150, 150], C: [150, 228], "1B": [212, 148], "2B": [184, 112], SS: [116, 112], "3B": [88, 148], LF: [62, 62], CF: [150, 32], RF: [238, 62] };
    const dh = L.order.find((o) => o.pos === "DH"), eh = L.order.filter((o) => o.pos === "EH");
    return `<figure class="st-dia"><svg viewBox="0 0 300 260" role="img" aria-label="Defensive alignment">
      <path d="M150 250 L20 120 A185 185 0 0 1 280 120 Z" class="grass"/><path d="M150 236 L92 178 L150 120 L208 178 Z" class="dirt"/>
      <path d="M150 236 L92 178 L150 120 L208 178 Z" class="lines"/><circle cx="150" cy="168" r="7" class="mound"/>
      ${Object.keys(XY).map((p) => { const pid = at[p]; const [x, y] = XY[p]; return `<g class="pos ${pid ? "on" : ""}"><rect x="${x - 34}" y="${y - 11}" width="68" height="22" rx="4"/><text x="${x}" y="${y + 4}">${pid ? h(player(pid) ? player(pid).last.slice(0, 10) : "?") : p}</text>${pid ? `<text class="lab" x="${x}" y="${y - 14}">${p}</text>` : ""}</g>`; }).join("")}
    </svg>${dh || eh.length ? `<figcaption>${dh && dh.pid ? `<span><b>DH</b> ${h(shortName(dh.pid))}</span>` : ""}${eh.filter((o) => o.pid).map((o) => `<span><b>EH</b> ${h(shortName(o.pid))}</span>`).join("")}</figcaption>` : ""}</figure>`;
  }
  /* builder edits: all on the private draft (this device) until submitted */
  function lbEdit(fn, opts) {
    fn(st.lb.lineup); st.lb.dirty = true;
    Sync.setDraft(st.lb.gameId, { lineup: st.lb.lineup, privateNote: st.lb.privateNote, by: (mine() || {}).name, fromRev: st.lb.fromRev });
    st.lb.savedAt = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!(opts && opts.quiet)) rerender();
  }
  function lbPlace(pid, target) {
    const p = player(pid); if (!p) return;
    lbEdit((L) => {
      // take the player out of wherever they are first
      L.order.forEach((o) => { if (o.pid === pid) { o.pid = null; } });
      L.bench = L.bench.filter((x) => x !== pid);
      if (target.type !== "pitch") L.pitchers = L.pitchers.filter((x) => x.pid !== pid || (target.type === "order" && p.isPitcher));
      if (target.type === "order") {
        const i = target.index != null ? target.index : L.order.findIndex((o) => !o.pid);
        if (i < 0) { L.bench.push(pid); return; }
        const plan = S.cellOf(gdoc(camp()), st.lb.gameId, pid);
        L.order[i].pid = pid; if (!L.order[i].pos) L.order[i].pos = (plan && plan.pos) || (p.isPitcher ? "P" : S.normPos(p.position)) || "";
      } else if (target.type === "pitch") { if (!L.pitchers.some((x) => x.pid === pid)) { const plan = S.cellOf(gdoc(camp()), st.lb.gameId, pid); L.pitchers.push({ pid, outs: plan && plan.outs != null ? plan.outs : null, pitches: plan && plan.pitches != null ? plan.pitches : null, note: "" }); } }
      else if (!L.bench.includes(pid)) L.bench.push(pid);
    });
  }
  async function lbAction(action) {
    const c = camp(), g = lbGame(), lb = st.lb;
    if (!mine()) return whoDialog(() => lbAction(action));
    if (action === "submit") {
      const ldoc = lstatus(g.id, c);
      if (Sync.isShared(c.id)) await Sync.pullCamp(A, c.id);
      const fresh = lstatus(g.id, c);
      if (fresh.rev > lb.fromRev && fresh.current && fresh.current.by !== mine().name && !window.confirm(`${fresh.current.by} submitted a lineup for this game (v${fresh.rev}) after you started. Submitting yours makes it the version under review; theirs stays in the history. Submit?`)) return;
      void ldoc;
      const r = await Sync.lineupAction(A, c.id, g.id, "submit", { lineup: lb.lineup, summary: "Submitted " + S.gameTitle(g) });
      if (!r.ok) return actionFailed(r, () => lbAction(action));
      Sync.setDraft(g.id, null); lb.mode = "review"; lb.lineup = S.normLineup(r.doc.current); lb.fromRev = r.doc.rev; lb.remoteChanged = false;
      A.say("Submitted for review" + (r.local ? " (this browser only — share the camp so coordinators see it)" : ""));
      return rerender();
    }
    if (action === "return") {
      return A.openDialog({ title: "Return to the coach", body: `<div class="field"><label for="stRet">What should change?</label><textarea id="stRet" rows="3"></textarea></div>`, foot: [{ label: "Cancel" }, { label: "Return", cls: "primary", fn: async (b) => { const note = b.querySelector("#stRet").value.trim(); const r = await Sync.lineupAction(A, c.id, g.id, "return", { note, summary: "Returned: " + note.slice(0, 80) }); if (!r.ok) return actionFailed(r); A.say("Returned to the coach"); rerender(); } }] });
    }
    if (action === "approve" || action === "publish") return approveDialog(action === "publish");
  }
  /** approving shows exactly what changes in the Game Play Matrix before anything is written */
  function approveDialog(andPublish) {
    const c = camp(), g = lbGame(), ldoc = lstatus(g.id, c), L = ldoc.current, doc = gdoc(c);
    if (!L) return;
    const d = S.lineupToPlan(L, doc, g);
    const alreadyApproved = ldoc.status === "approved";
    A.openDialog({
      title: (andPublish ? (alreadyApproved ? "Publish" : "Approve & publish") : "Approve") + " — " + S.gameTitle(g), wide: true,
      sub: `Lineup v${ldoc.rev} by ${h(L.by)}. ${andPublish ? "Publishing makes it the official lineup (printouts, dugout card)." : "Approving doesn't publish it yet."}`,
      body: `<div class="st-appr">
        ${alreadyApproved ? `<p class="c-muted">The Game Play Matrix was offered these changes when this lineup was approved.</p>` : d.changes.length ? `<label class="c-check"><input type="checkbox" id="apPlan" checked> <span><b>Update the Game Play Matrix from this lineup</b> — ${plural(d.changes.length, "change")}:</span></label>
          <div class="st-tblwrap"><table class="st-tbl sm"><thead><tr><th>Player</th><th>Plan now</th><th>From the lineup</th></tr></thead><tbody>${d.changes.map((x) => `<tr><td>${h(nameOf(x.pid))}</td><td>${h(S.cellText(x.before, (player(x.pid) || {}).isPitcher) || "—")}</td><td><b>${h(S.cellText(x.after, (player(x.pid) || {}).isPitcher))}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="st-allclear">${ICON.check} The Game Play Matrix already matches this lineup.</p>`}
        ${!alreadyApproved && d.dropped.length ? `<label class="c-check"><input type="checkbox" id="apDrop"> <span>Also mark ${plural(d.dropped.length, "player")} planned for this game but not in the lineup as <b>off</b>: ${h(d.dropped.map(shortName).join(", "))}</span></label>` : ""}
      </div>`,
      foot: [{ label: "Cancel" }, { label: andPublish ? (alreadyApproved ? "Publish" : "Approve & publish") : "Approve", cls: "primary", fn: async (b) => {
        const upd = b.querySelector("#apPlan") ? b.querySelector("#apPlan").checked : false, drop = b.querySelector("#apDrop") ? b.querySelector("#apDrop").checked : false;
        if (!alreadyApproved) {
          const r = await Sync.lineupAction(A, c.id, g.id, "approve", { summary: "Approved v" + ldoc.rev });
          if (!r.ok) return actionFailed(r, () => approveDialog(andPublish));
          if (upd || drop) editGames("Apply lineup v" + ldoc.rev + " to the plan", (dd) => { if (upd) S.applyLineupToPlan(dd, L, g, { dropRemoved: drop }); else if (drop) d.dropped.forEach((pid) => S.setCell(dd, g.id, pid, Object.assign({}, S.cellOf(dd, g.id, pid), { role: "off", inn: null }))); }, { quiet: true });
        }
        if (andPublish) { const r2 = await Sync.lineupAction(A, c.id, g.id, "publish", { summary: "Published v" + ldoc.rev }); if (!r2.ok) return actionFailed(r2); }
        A.say(andPublish ? "Lineup published" : "Lineup approved"); rerender();
      } }]
    });
  }
  function actionFailed(r, retry) {
    if (r.error === "coordinator-required") return coordDialog(retry);
    if (r.error === "changed") { A.say("Someone changed this lineup a moment ago — showing their version"); if (st.lb) { st.lb.remoteChanged = false; const l = lstatus(st.lb.gameId, camp()); if (l.current && st.lb.mode !== "draft") st.lb.lineup = S.normLineup(l.current); } return rerender(); }
    if (r.error === "offline") A.say("Can't reach the shared store — try again when you're back online");
    else A.say("That didn't go through (" + (r.error || "error") + ")");
  }
  function lbMore(anchor) {
    const c = camp(), g = lbGame(), ldoc = lstatus(g.id, c), dr = Sync.draft(g.id);
    A.openMenu(anchor, [
      { label: "Print dugout card", disabled: !(ldoc.published || ldoc.current || st.lb.mode === "draft"), fn: () => printLineup(g.id, "dugout") },
      { label: "Print full game plan", fn: () => printLineup(g.id, "full") },
      { label: "Copy a lineup from another game…", disabled: st.lb.mode !== "draft", fn: () => copyLineupDialog() },
      { label: "Lineup history", disabled: !Sync.isShared(c.id), fn: () => historyDialog("lineup:" + g.id, "Lineup history — " + S.gameTitle(g)) },
      { sep: true },
      { label: dr ? "Discard my draft" : "Start over", danger: true, disabled: st.lb.mode !== "draft", fn: () => { if (!window.confirm("Discard your draft for this game?")) return; Sync.setDraft(g.id, null); openBuilder(g.id); } },
      { label: "Edit game", fn: () => gameDialog(g.id) }
    ]);
  }
  function copyLineupDialog() {
    const c = camp(), doc = gdoc(c), g = lbGame();
    const src = S.sortGames(doc.games).filter((x) => x.id !== g.id && (lstatus(x.id, c).current || Sync.draft(x.id)));
    if (!src.length) return A.say("No other lineups to copy yet");
    A.openDialog({ title: "Copy a lineup", sub: "Copies the batting order, positions, pitchers and bench into your draft. Nothing is sent.",
      body: `<div class="field"><label for="clFrom">From</label><select id="clFrom">${src.map((x) => `<option value="${h(x.id)}">${h(fmtD(x.date))} · ${h(S.gameTitle(x))}</option>`).join("")}</select></div>`,
      foot: [{ label: "Cancel" }, { label: "Copy", cls: "primary", fn: (b) => { const id = b.querySelector("#clFrom").value; const dr = Sync.draft(id); const from = dr ? dr.lineup : lstatus(id, c).current; lbEdit((L) => { const n = S.normLineup(from); L.order = n.order.slice(0, Math.max(S.slotCount(g.format), n.order.length)); while (L.order.length < S.slotCount(g.format)) L.order.push({ pid: null, pos: "" }); L.pitchers = n.pitchers; L.bench = n.bench; L.subs = []; L.grid = {}; }); } }] });
  }

  /* =====================================================================
     PRINT
     ===================================================================== */
  const pName = (pid) => { const p = player(pid); return p ? `${h(p.last.toUpperCase())}, ${h(p.first)}` : "Unknown"; };
  function sheetHead(c, title, sub) {
    return `<header class="st-ph"><div><div class="st-ph-k">${h(kind(c).name)} · ${h(c.name)}</div><h1>${h(title)}</h1>${sub ? `<div class="st-ph-s">${sub}</div>` : ""}</div><div class="st-ph-r">Printed ${h(new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div></header>`;
  }
  function printLineup(gid, which) {
    const c = camp(), g = gdoc(c).games.find((x) => x.id === gid), ldoc = lstatus(gid, c);
    let L = ldoc.published, label = ldoc.published ? "Published v" + ldoc.published.rev : "";
    if (st.lb && st.lb.gameId === gid && st.lb.mode === "draft") { L = st.lb.lineup; label = "DRAFT — not submitted"; }
    else if (!L && ldoc.current) { L = ldoc.current; label = S.LSTATUS[ldoc.status] + " v" + ldoc.rev + " — not published"; }
    if (!L) return A.say("No lineup to print yet");
    const draft = !ldoc.published || (st.lb && st.lb.mode === "draft");
    const sub = `${h(fmtD(g.date, { long: true }))} · ${h(fmtT(g.start))} · ${h(g.facilityId ? A.facName(c, g.facilityId) : g.site || "")} · ${g.format.innings} inn${g.format.dh ? " · DH" : ""}${g.format.extraHitters ? " · " + g.format.extraHitters + " EH" : ""}${g.format.reentry ? " · re-entry" : ""} · <b>${h(label)}</b>`;
    const order = L.order.filter((o) => o.pid);
    const card = `<table class="st-pt big"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>B/T</th></tr></thead><tbody>${order.map((o, i) => { const p = player(o.pid); return `<tr><td>${i + 1}</td><td>${pName(o.pid)}${p && p.number ? ` <small>#${h(p.number)}</small>` : ""}</td><td><b>${h(o.pos)}</b></td><td>${h(p ? (p.bats || "–") + "/" + (p.throws || "–") : "")}</td></tr>`; }).join("")}</tbody></table>`;
    const pit = `<h3>Pitchers</h3><table class="st-pt"><tbody>${L.pitchers.map((pp, i) => `<tr><td>${i ? i + 1 : "SP"}</td><td>${pName(pp.pid)}</td><td>${pp.outs != null ? S.ipOf(pp.outs) + " IP" : ""}</td><td>${pp.pitches != null ? pp.pitches + " pitches" : ""}</td></tr>`).join("") || `<tr><td class="c-muted">—</td></tr>`}</tbody></table>`;
    const bench = `<h3>Bench</h3><p class="st-pbench">${L.bench.map((pid) => `${pName(pid)} <small>${h((player(pid) || {}).position || "")}</small>`).join(" · ") || "—"}</p>`;
    const subs = L.subs.length ? `<h3>Planned substitutions</h3><table class="st-pt"><thead><tr><th>Inn</th><th>Out</th><th>In</th><th>Pos</th><th>Note</th></tr></thead><tbody>${L.subs.slice().sort((a, b) => a.inning - b.inning).map((s) => `<tr><td>${s.inning}</td><td>${s.out ? pName(s.out) : ""}</td><td>${s.in ? pName(s.in) : ""}</td><td>${h(s.pos)}</td><td>${h(s.note)}</td></tr>`).join("")}</tbody></table>` : "";
    let html = `<section class="c-sheet st-sheet">${sheetHead(c, S.gameTitle(g), sub)}<div class="st-pcols"><div>${card}</div><div>${pit}${bench}</div></div>${subs}${L.sharedNote ? `<p class="st-pnote">${h(L.sharedNote)}</p>` : ""}</section>`;
    if (which === "full") {
      const rows = L.order.filter((o) => o.pid).map((o) => o.pid).concat(L.bench, L.pitchers.map((p) => p.pid)).filter((v, i, a) => a.indexOf(v) === i);
      const grid = Object.keys(L.grid).length ? `<h3>Innings by position</h3><table class="st-pt sm"><thead><tr><th>Player</th>${Array.from({ length: g.format.innings }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody>${rows.map((pid) => `<tr><td>${pName(pid)}</td>${Array.from({ length: g.format.innings }, (_, i) => `<td>${h((L.grid[pid] || [])[i] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
      html += `<section class="c-sheet st-sheet">${sheetHead(c, "Game plan — " + S.gameTitle(g), sub)}${grid}${planTableHTML(c, gid)}${g.format.pitcherLimit || g.format.notes ? `<p class="st-pnote">${h([g.format.pitcherLimit, g.format.notes].filter(Boolean).join(" · "))}</p>` : ""}</section>`;
    }
    A.printHTML(html, which === "full" ? "Game plan" : "Lineup card", { sub: S.gameTitle(g), draft });
  }
  function planTableHTML(c, gid) {
    const doc = gdoc(c), plan = doc.plan[gid] || {};
    const rows = Object.keys(plan).map((pid) => ({ p: player(pid), c: plan[pid] })).filter((x) => x.p);
    const sec = (title, f) => { const xs = rows.filter(f).sort((a, b) => (a.c.order || 99) - (b.c.order || 99) || a.p.sortName.localeCompare(b.p.sortName)); return xs.length ? `<h3>${title} <small>${xs.length}</small></h3><table class="st-pt"><tbody>${xs.map((x) => `<tr><td>${x.c.order ? x.c.order : ""}</td><td>${pName(x.p.pid)}</td><td>${h(x.p.aff)}</td><td><b>${h(S.cellText(x.c, x.p.isPitcher))}</b></td><td>${h(x.c.note || "")}</td></tr>`).join("")}</tbody></table>` : ""; };
    return sec("Starting", (x) => x.c.role === "start") + sec("Pitching", (x) => x.c.role === "pitch") + sec("Subs", (x) => x.c.role === "sub") + sec("Available", (x) => x.c.role === "avail") + (rows.some((x) => x.c.role === "off") ? `<p class="st-pbench"><b>Off:</b> ${rows.filter((x) => x.c.role === "off").map((x) => pName(x.p.pid)).join(" · ")}</p>` : "") || `<p class="c-muted">Nobody planned for this game.</p>`;
  }
  function printPlan(gid) {
    const c = camp(), g = gdoc(c).games.find((x) => x.id === gid);
    A.printHTML(`<section class="c-sheet st-sheet">${sheetHead(c, "Participation plan — " + S.gameTitle(g), `${h(fmtD(g.date, { long: true }))} · ${h(fmtT(g.start))} · ${g.format.innings} inn · from the Game Play Matrix (plan, not what happened)`)}${planTableHTML(c, gid)}</section>`, "Participation plan", { sub: S.gameTitle(g) });
  }
  function printMatrix(games, list) {
    const c = camp(), doc = gdoc(c);
    const chunk = 12, pages = [];
    for (let i = 0; i < Math.max(1, games.length); i += chunk) {
      const gs = games.slice(i, i + chunk);
      pages.push(`<section class="c-sheet land st-sheet">${sheetHead(c, "Game Play Matrix", `${plural(list.length, "player")} · ${gs.length ? h(C.fmtDate(gs[0].date, { noDow: true })) + "–" + h(C.fmtDate(gs[gs.length - 1].date, { noDow: true })) : ""} · ${st.mx.mode === "actual" ? "actual" : st.mx.mode === "both" ? "plan → actual" : "plan"}`)}
        <table class="st-pt mx"><thead><tr><th>Player</th>${gs.map((g) => `<th>${h(C.fmtDate(g.date, { noDow: true }))}<br><small>${h(S.gameTitle(g))}</small></th>`).join("")}</tr></thead><tbody>${list.slice().sort((a, b) => ROLE_ORDER(a) - ROLE_ORDER(b) || a.sortName.localeCompare(b.sortName)).map((p) => `<tr><td>${pName(p.pid)} <small>${h(p.position)}</small></td>${gs.map((g) => { const cl = S.cellOf(doc, g.id, p.pid), a = S.actualOf(doc, g.id, p.pid), rec = S.hasActuals(doc, g.id); const pt = S.cellText(cl, p.isPitcher), at = rec ? (a ? S.actualText(a) : "") : ""; return `<td>${st.mx.mode === "actual" ? h(at) : st.mx.mode === "both" ? h(pt) + (at ? "<br><b>" + h(at) + "</b>" : "") : h(pt)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></section>`);
    }
    A.printHTML(pages.join(""), "Game Play Matrix", { orient: "landscape" });
  }

  /* =====================================================================
     EVENTS
     ===================================================================== */
  function onAction(a, el, e) {
    if (!a.startsWith("st-") && a !== "game-open") return false;
    const c = camp(), k = el.dataset.k, k2 = el.dataset.k2;
    switch (a) {
      case "game-open": { const g = gdoc(c).games.find((x) => x.id === k); if (g) gameMenu(el, k); return true; }
      case "st-open-remote": el.disabled = true; Sync.openRemoteCamp(A, k).then((cc) => { if (cc) { A.ui.tab = "today"; A.render(); A.say("Opened " + cc.name); } else { el.disabled = false; A.say("Couldn't open that camp"); } }); return true;
      case "st-sync": if (!Sync.isShared(c.id)) A.setTab("setup"); else Sync.pullCamp(A, c.id).then(() => A.say("Up to date")); return true;
      case "st-me": whoDialog(); return true;
      case "st-coord": coordDialog(); return true;
      case "st-share": {
        if (!mine()) { whoDialog(() => onAction("st-share", el, e)); return true; }
        el.disabled = true;
        Sync.shareCamp(A, c).then((r) => { A.say(r.ok ? "Shared — staff can open it from the camp switcher" : r.error === "local" ? "Shared storage isn't set up on this deployment" : r.error === "coordinator-required" ? "This camp's published schedule needs the coordinator code to share" : "Couldn't share (" + r.error + ")"); if (r.error === "coordinator-required") coordDialog(); A.render(); });
        return true;
      }
      case "st-pull": Sync.pullCamp(A, c.id).then((ch) => A.say(ch.length ? "Updated with staff changes" : "Up to date")); return true;
      case "st-history": historyDialog(k); return true;
      case "st-go-sched": A.goTo(k || focusDate(c), { view: isNarrow() ? "agenda" : "grid" }); return true;
      case "st-go-act": A.goTo(k2, { flash: [k] }); setTimeout(() => A.openActivity(k), 0); return true;
      case "st-go-group": A.goTo(k2, { view: "agenda", group: k }); return true;
      case "st-unsched": unschedDialog(); return true;
      case "st-describe": describeDialog(k || A.ui.date); return true;
      case "st-d-read": describeRun(false); return true;
      case "st-d-ai": describeRun(true); return true;
      case "st-d-mic": toggleMic(el); return true;
      case "st-view": st.view = k; st.lb = null; if (A.ui.tab !== "games") A.setTab("games"); else rerender(); return true;
      case "st-matrix": openMatrixAt(k); return true;
      case "st-lineups": st.view = "lineups"; st.lb = null; if (A.ui.tab !== "games") A.setTab("games"); else rerender(); return true;
      case "st-lineup": openBuilder(k); return true;
      case "st-actuals": actualsDialog(k); return true;
      case "st-new-game": gameDialog(null, k); return true;
      case "st-game-menu": gameMenu(el, k); return true;
      case "st-undo": undoGames(); return true;
      case "st-player": playerDialog(k); return true;
      /* matrix */
      case "st-mx-mode": st.mx.mode = k; rerender({ keepScroll: true }); return true;
      case "st-mx-week": st.mx.weekOf = C.addDays(C.weekStart(st.mx.weekOf || focusDate(c)), +k); rerender(); return true;
      case "st-mx-all": st.mx.all = !st.mx.all; rerender(); return true;
      case "st-mx-sort": st.mx.sort = st.mx.sort === "inn" ? "name" : "inn"; rerender({ keepScroll: true }); return true;
      case "st-mx-sort-inn": st.mx.sort = "inn"; st.mx.role = st.mx.role === "pitcher" ? "" : st.mx.role; rerender(); return true;
      case "st-mx-sum": st.mx.summary = !st.mx.summary; rerender({ keepScroll: true }); return true;
      case "st-mx-export": exportMenu(el); return true;
      case "st-mx-gmenu": matrixGameMenu(el, k); return true;
      case "st-mx-edit": cellDialog(Array.from(st.mx.sel)); return true;
      case "st-mx-clear-sel": st.mx.sel = new Set(st.mx.focus ? [st.mx.focus] : []); rerender({ keepScroll: true }); return true;
      case "st-cell": cellDialog([k + "|" + k2]); return true;
      case "st-add-to-game": addToGameDialog(k); return true;
      case "st-act-fill": {
        const b = el.closest(".mbody"), doc = gdoc(c);
        b.querySelectorAll("#stActRows tr").forEach((tr) => {
          const q = (n) => tr.querySelector(`[data-a="${n}"]`); if (["pos", "inn", "pa", "ip", "pc"].some((n) => q(n).value.trim())) return;
          const cl = S.cellOf(doc, st.actGame, tr.dataset.pid); if (!cl || cl.role === "off" || cl.role === "avail") { q("played").checked = false; return; }
          q("pos").value = cl.pos || ""; q("inn").value = cl.role === "pitch" ? "" : cl.inn ?? ""; q("ip").value = cl.outs != null ? S.ipOf(cl.outs) : ""; q("pc").value = cl.pitches ?? "";
        });
        A.say("Filled from the plan — check against the scorebook before saving"); return true;
      }
      case "st-act-add": {
        const b = el.closest(".mbody"), name = window.prompt("Player's name"); if (!name) return true;
        const hit = c.players.map(player).filter(Boolean).find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
        if (!hit) { A.say("No camp player matches “" + name + "”"); return true; }
        if (!b.querySelector(`tr[data-pid="${CSS.escape(hit.pid)}"]`)) b.querySelector("#stActRows").insertAdjacentHTML("beforeend", actRowHTML({ pid: hit.pid, p: hit, c: S.cellOf(gdoc(c), st.actGame, hit.pid), a: null }));
        return true;
      }
      /* lineup builder */
      case "st-lb-back": st.lb = null; st.view = "lineups"; rerender(); return true;
      case "st-lb-save": lbEdit(() => {}); A.say("Draft saved on this device"); return true;
      case "st-lb-submit": lbAction("submit"); return true;
      case "st-lb-approve": lbAction("approve"); return true;
      case "st-lb-publish": lbAction("publish"); return true;
      case "st-lb-return": lbAction("return"); return true;
      case "st-lb-revise": { const l = lstatus(st.lb.gameId, c); st.lb.lineup = S.normLineup(Object.assign({}, l.current || l.published, { by: (mine() || {}).name })); st.lb.fromRev = l.rev; st.lb.mode = "draft"; lbEdit(() => {}); return true; }
      case "st-lb-reload": { st.lb.remoteChanged = false; const l = lstatus(st.lb.gameId, c); if (st.lb.mode !== "draft" && l.current) st.lb.lineup = S.normLineup(l.current); rerender(); return true; }
      case "st-lb-more": lbMore(el); return true;
      case "st-lb-up": case "st-lb-down": { const i = +k, j = a === "st-lb-up" ? i - 1 : i + 1; lbEdit((L) => { const t = L.order[i]; L.order[i] = L.order[j]; L.order[j] = t; }); return true; }
      case "st-lb-clear": lbEdit((L) => { L.order[+k] = { pid: null, pos: L.order[+k].pos }; }); return true;
      case "st-lb-slot": lbEdit((L) => { L.order.push({ pid: null, pos: "EH" }); }); return true;
      case "st-lb-pick": st.lb.pick = k; rerender(); setTimeout(() => { const q = A.main().querySelector('[data-cf="st-lb-q"]'); if (q) q.focus(); }, 0); return true;
      case "st-lb-unpick": st.lb.pick = null; rerender(); return true;
      case "st-lb-tier": st.lb.tier = +k; rerender(); return true;
      case "st-lb-prole": st.lb.poolRole = k; rerender(); return true;
      case "st-lb-add": {
        const pk = st.lb.pick; st.lb.pick = null; const p = player(k);
        if (pk && pk[0] === "o") lbPlace(k, { type: "order", index: +pk.slice(1) });
        else if (pk === "p") lbPlace(k, { type: "pitch" });
        else if (pk === "b") lbPlace(k, { type: "bench" });
        else lbPlace(k, p && p.isPitcher && !st.lb.lineup.pitchers.some((x) => x.pid === k) ? { type: "pitch" } : { type: "order" });
        return true;
      }
      case "st-lb-pup": lbEdit((L) => { const i = +k; const t = L.pitchers[i]; L.pitchers[i] = L.pitchers[i - 1]; L.pitchers[i - 1] = t; }); return true;
      case "st-lb-pdel": lbEdit((L) => { L.pitchers.splice(+k, 1); }); return true;
      case "st-lb-bdel": lbEdit((L) => { L.bench = L.bench.filter((x) => x !== k); }); return true;
      case "st-lb-sadd": lbEdit((L) => { L.subs.push({ inning: Math.min(5, lbGame().format.innings), out: null, in: null, pos: "", note: "" }); }); return true;
      case "st-lb-sdel": lbEdit((L) => { L.subs.splice(+k, 1); }); return true;
      case "st-lb-grid-toggle": st.lb.showGrid = !st.lb.showGrid; return false;
      case "st-lb-grid-fill": lbEdit((L) => { const n = lbGame().format.innings; L.order.forEach((o) => { if (o.pid && o.pos) L.grid[o.pid] = Array.from({ length: n }, (_, i) => (L.grid[o.pid] || [])[i] || o.pos); }); }); st.lb.showGrid = true; return true;
      case "st-lb-grid-clear": lbEdit((L) => { L.grid = {}; }); return true;
    }
    return false;
  }
  function onChange(cf, el) {
    if (!cf.startsWith("st-")) return false;
    const v = el.value, k = el.dataset.k;
    switch (cf) {
      case "st-mx-group": st.mx.group = v; rerender(); return true;
      case "st-mx-role": st.mx.role = v; rerender(); return true;
      case "st-mx-aff": st.mx.aff = v; rerender(); return true;
      case "st-pgame": st.mx.phoneGame = v; rerender(); return true;
      case "st-lb-pos": lbEdit((L) => { L.order[+k].pos = S.normPos(v); }); return true;
      case "st-lb-pip": { const o = S.outsOf(v); if (v.trim() && o == null) { A.say("Innings pitched: e.g. 2.0 or 1.2"); return true; } lbEdit((L) => { L.pitchers[+k].outs = o; }, { quiet: true }); return true; }
      case "st-lb-ppc": lbEdit((L) => { L.pitchers[+k].pitches = v === "" ? null : C.clamp(Math.round(+v), 0, 200); }, { quiet: true }); return true;
      case "st-lb-sub": { const f = el.dataset.f; lbEdit((L) => { const s = L.subs[+k]; if (f === "inning") s.inning = +v; else if (f === "pos") s.pos = S.normPos(v); else if (f === "note") s.note = v; else s[f] = v || null; }, { quiet: f === "note" }); return true; }
      case "st-lb-gridc": lbEdit((L) => { const row = L.grid[k] = (L.grid[k] || []).slice(); row[+el.dataset.f] = S.normPos(v); }); st.lb.showGrid = true; return true;
      case "st-lb-shared": lbEdit((L) => { L.sharedNote = v; }, { quiet: true }); return true;
      case "st-lb-priv": st.lb.privateNote = v; lbEdit(() => {}, { quiet: true }); return true;
    }
    return false;
  }
  let qTimer = null;
  function onInput(cf, el) {
    if (cf === "st-mx-q") { st.mx.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(() => { const pos = el.selectionStart; rerender(); const n = A.main().querySelector('[data-cf="st-mx-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 160); return true; }
    if (cf === "st-pplayer") { st.mx.phonePlayer = el.value; clearTimeout(qTimer); qTimer = setTimeout(() => { rerender(); const n = A.main().querySelector('[data-cf="st-pplayer"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 200); return true; }
    if (cf === "st-lb-q") { st.lb.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(() => { rerender(); const n = A.main().querySelector('[data-cf="st-lb-q"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 160); return true; }
    if (cf === "st-lb-shared" || cf === "st-lb-priv") return true;
    return false;
  }
  function onKey(e) {
    const t = e.target;
    if (t.classList && t.classList.contains("st-mx-c")) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); undoGames(); return true; }
      if (e.key === "ArrowRight") { moveFocus(1, 0); e.preventDefault(); return true; }
      if (e.key === "ArrowLeft") { moveFocus(-1, 0); e.preventDefault(); return true; }
      if (e.key === "ArrowDown") { moveFocus(0, 1); e.preventDefault(); return true; }
      if (e.key === "ArrowUp") { moveFocus(0, -1); e.preventDefault(); return true; }
      if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); cellDialog(st.mx.sel.size ? Array.from(st.mx.sel) : [t.dataset.g + "|" + t.dataset.p]); return true; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); const keys = st.mx.sel.size ? Array.from(st.mx.sel) : [t.dataset.g + "|" + t.dataset.p]; setCells(keys, () => null, "Clear " + plural(keys.length, "cell")); return true; }
      if (e.key.length === 1 && !meta && !e.altKey) { e.preventDefault(); quickEdit(t, e.key); return true; }
    }
    if (A.ui.tab === "games" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !(t.matches && t.matches("input,textarea,select"))) { e.preventDefault(); undoGames(); return true; }
    return false;
  }
  /* matrix cell clicks and builder drag-and-drop are pointer events on the camp root */
  document.addEventListener("click", (e) => {
    const td = e.target.closest && e.target.closest("td.st-mx-c"); if (!td) return;
    selectCell(td, e);
  });
  document.addEventListener("dblclick", (e) => { const td = e.target.closest && e.target.closest("td.st-mx-c"); if (td) cellDialog(st.mx.sel.size > 1 ? Array.from(st.mx.sel) : [td.dataset.g + "|" + td.dataset.p]); });
  document.addEventListener("dragstart", (e) => {
    const src = e.target.closest && (e.target.closest("[data-ppid]") || e.target.closest(".st-slot[draggable=true]") || e.target.closest("[data-bpid]"));
    if (!src || !st.lb) return;
    const pid = src.dataset.ppid || src.dataset.bpid || (st.lb.lineup.order[+src.dataset.slot] || {}).pid;
    if (!pid) return;
    e.dataTransfer.setData("text/plain", pid); e.dataTransfer.effectAllowed = "move";
    st.lb.dragFrom = src.dataset.slot != null ? +src.dataset.slot : null;
  });
  document.addEventListener("dragover", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (z && st.lb) { e.preventDefault(); z.classList.add("over"); } });
  document.addEventListener("dragleave", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (z) z.classList.remove("over"); });
  document.addEventListener("drop", (e) => {
    const z = e.target.closest && e.target.closest("[data-drop]"); if (!z || !st.lb) return;
    e.preventDefault(); z.classList.remove("over");
    const pid = e.dataTransfer.getData("text/plain"); if (!pid) return;
    const type = z.dataset.drop, from = st.lb.dragFrom; st.lb.dragFrom = null;
    if (type === "order" && from != null) {   // reorder within the batting order: swap the two spots
      const to = +z.dataset.slot; lbEdit((L) => { const t = L.order[to]; L.order[to] = L.order[from]; L.order[from] = t; }); return;
    }
    lbPlace(pid, type === "order" ? { type: "order", index: +z.dataset.slot } : { type });
  });

  window.StUI = { _st: st, parseQuick, openBuilder, openMatrixAt };
})();
