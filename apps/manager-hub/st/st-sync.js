/* Manager Hub — shared store client for camps / Spring Training.

   Local-first: every screen reads and writes this browser's copy, so nothing waits on the network and nothing
   is lost offline. When the shared store (functions/apps/manager-hub/api/ops.js) is available:
     • a camp is shared once a coordinator chooses "Share with staff"; after that every save is pushed,
     • the open camp is re-read every 20 seconds (and when the tab comes back into view),
     • a write that meets a newer version is merged three ways (StCore.merge3: base · mine · theirs) and
       retried; a value both people changed keeps the server's version and the clash is shown — never silent.
   Coaches' lineup drafts and private notes never leave the browser (cs.st.draft.*). Submitting sends the lineup.

   Identity: Manager Hub has one shared access code and no accounts, so the name/role here is what a person
   picks ("Working as"). It's recorded on every change and in the history, labelled as self-reported.
   Coordinator-only writes need the coordinator code when the owner has set MH_COORDINATOR_CODE.

   Browser global: StSync. */
(function () {
  "use strict";
  const S = window.StCore;
  if (!S) return;
  const URL_ = "api/ops";
  const LS = window.localStorage, SS = window.sessionStorage;
  const get = (k, d) => { try { const v = LS.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const del = (k) => { try { LS.removeItem(k); } catch (e) { /* ignore */ } };
  const IGNORE_PATHS = /^\.(updated|created)$/;

  const state = { status: "unknown", detail: "", coordinator: { required: false, valid: false }, remoteCamps: [], lastPull: 0, pending: new Set(), clashes: [], listeners: [] };
  const docKey = (id) => "cs.st.doc." + id;
  const meta = (id) => get(docKey(id), null);                       // {version, base, updated, by, local?}
  const setMeta = (id, m) => put(docKey(id), m);

  /* ---------- who is working ---------- */
  function me() { const m = get("cs.st.me", null); return m && m.name ? m : null; }
  function setMe(m) { put("cs.st.me", { name: String(m.name || "").trim().slice(0, 60), role: m.role === "coordinator" ? "coordinator" : "coach", staffId: m.staffId || null }); emit("me"); }
  const coordCode = () => { try { return SS.getItem("cs.st.coord") || ""; } catch (e) { return ""; } };
  function setCoordCode(c) { try { if (c) SS.setItem("cs.st.coord", c); else SS.removeItem("cs.st.coord"); } catch (e) { /* ignore */ } }
  const isCoordinator = () => { const m = me(); return !!(m && m.role === "coordinator"); };

  /* ---------- events ---------- */
  function on(fn) { state.listeners.push(fn); }
  function emit(what, data) { state.listeners.forEach((f) => { try { f(what, data); } catch (e) { console.error(e); } }); }

  /* ---------- transport ---------- */
  async function req(method, query, body) {
    const headers = { "Content-Type": "application/json" };
    const code = coordCode(); if (code) headers["X-MH-Coordinator"] = code;
    let r;
    try { r = await fetch(URL_ + (query || ""), { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin", cache: "no-store" }); }
    catch (e) { return { status: 0, body: { error: "network" } }; }
    let b = null; try { b = await r.json(); } catch (e) { b = { error: "bad-response" }; }
    return { status: r.status, body: b || {} };
  }
  function setStatus(s, detail) { if (state.status !== s || state.detail !== (detail || "")) { state.status = s; state.detail = detail || ""; emit("status"); } }

  /* ---------- reading ---------- */
  /** every shared doc of one camp; merges remote changes into the local copies. Returns the list of changed ids. */
  async function pullCamp(api, campId) {
    const r = await req("GET", "?camp=" + encodeURIComponent(campId));
    if (r.status === 0) { setStatus("offline", "Can't reach the shared store — working in this browser; changes will be sent when it's back."); return []; }
    if (r.status === 401) { setStatus("local", "Signed out of Manager Hub — sign in again to share."); return []; }
    if (r.status !== 200) { setStatus("error", "The shared store answered " + r.status + "."); return []; }
    state.coordinator = r.body.coordinator || state.coordinator;
    if (r.body.stored === false) { setStatus("local", "Shared storage isn't set up on this deployment — everything stays in this browser."); return []; }
    setStatus("shared"); state.lastPull = Date.now();
    const changed = [];
    for (const d of r.body.docs || []) { if (await absorb(api, d.id, d)) changed.push(d.id); }
    // anything still waiting to go out
    for (const id of Array.from(state.pending)) if (id.endsWith(":" + campId) || (meta(id) && meta(id).campId === campId)) flush(api, id);
    if (changed.length) emit("remote", changed);
    return changed;
  }
  /** take a remote version into this browser. true when something changed here. */
  async function absorb(api, id, remote) {
    const m = meta(id);
    if (m && m.version >= remote.version) return false;
    const kind = id.split(":")[0];
    if (kind === "camp") {
      const campId = id.slice(5);
      const local = api.state().camps.find((c) => c.id === campId);
      let merged = remote.doc, clashes = [];
      if (local && m && m.base) { const r = S.merge3(m.base, strip(local), remote.doc); merged = r.value; clashes = r.conflicts.filter((c) => !IGNORE_PATHS.test(c.path)); }
      api.setCamp(Object.assign({}, merged, { id: campId }));
      setMeta(id, { version: remote.version, base: remote.doc, updated: remote.updated, by: remote.by });
      noteClashes(id, clashes, remote.by);
      if (local && m && !S.deepEq(strip(merged), remote.doc)) queue(api, id);   // my unsent edits survive the merge
      return true;
    }
    // a lineup is never merged field by field: two coaches' lineups combined cell by cell would be nobody's lineup.
    // Lineup changes are sent the moment they're made, so the server's version simply replaces this copy.
    if (kind === "lineup") { setMeta(id, { version: remote.version, base: remote.doc, local: remote.doc, updated: remote.updated, by: remote.by, campId: remote.doc && remote.doc.campId }); return true; }
    // games docs keep their working copy here
    let merged = remote.doc, clashes = [];
    if (m && m.base && m.local && !S.deepEq(m.local, m.base)) { const r = S.merge3(m.base, m.local, remote.doc); merged = r.value; clashes = r.conflicts; }
    setMeta(id, { version: remote.version, base: remote.doc, local: merged, updated: remote.updated, by: remote.by, campId: remote.doc && remote.doc.campId });
    noteClashes(id, clashes, remote.by);
    if (!S.deepEq(merged, remote.doc)) queue(api, id);
    return true;
  }
  const strip = (camp) => { const c = S.clone(camp); return c; };
  function noteClashes(id, list, by) {
    if (!list.length) return;
    state.clashes.push({ id, at: new Date().toISOString(), by: by || "someone", list });
    if (state.clashes.length > 20) state.clashes.shift();
    emit("clash", { id, list, by });
  }
  async function listCamps() {
    const r = await req("GET", "?list=camps");
    state.remoteCamps = r.status === 200 && r.body.camps ? r.body.camps : [];
    if (r.status === 200) state.coordinator = r.body.coordinator || state.coordinator;
    if (r.status === 200 && r.body.stored === false) setStatus("local", "Shared storage isn't set up on this deployment — everything stays in this browser.");
    else if (r.status === 200) setStatus("shared");
    return state.remoteCamps;
  }
  async function openRemoteCamp(api, campId) {
    const r = await req("GET", "?doc=camp:" + encodeURIComponent(campId));
    if (r.status !== 200 || !r.body.doc) return null;
    del(docKey("camp:" + campId));
    const c = api.setCamp(Object.assign({}, r.body.doc, { id: campId }), { activate: true });
    setMeta("camp:" + campId, { version: r.body.version, base: r.body.doc, updated: r.body.updated, by: r.body.by });
    await pullCamp(api, campId);
    return c;
  }
  async function history(id) { const r = await req("GET", "?history=" + encodeURIComponent(id)); return r.status === 200 ? r.body.history || [] : null; }

  /* ---------- writing ---------- */
  const timers = {};
  function queue(api, id, delay) {
    state.pending.add(id);
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => flush(api, id), delay == null ? 1200 : delay);
    emit("pending");
  }
  /** send one doc now; merges and retries on a newer version. Resolves {ok, error?, clashes?} */
  async function flush(api, id, opts) {
    opts = opts || {};
    clearTimeout(timers[id]);
    const kind = id.split(":")[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      const m = meta(id) || { version: 0 };
      const doc = kind === "camp" ? (api.state().camps.find((c) => c.id === id.slice(5)) || null) : m.local;
      if (!doc) { state.pending.delete(id); return { ok: false, error: "missing" }; }
      const who = me();
      const r = await req("PUT", "", { id, doc, baseVersion: m.version || 0, by: who ? who.name + (who.role === "coordinator" ? " (coordinator)" : "") : "Unnamed", action: opts.action || "save", summary: opts.summary || "" });
      if (r.status === 200) {
        state.pending.delete(id);
        setMeta(id, Object.assign({}, m, { version: r.body.version, base: r.body.doc, updated: r.body.updated, by: r.body.by, local: kind === "camp" ? undefined : r.body.doc }));
        setStatus("shared"); emit("saved", id); return { ok: true };
      }
      if (r.status === 409) {
        await absorb(api, id, { doc: r.body.doc, version: r.body.version, updated: r.body.updated, by: r.body.by });
        emit("remote", [id]);
        if (kind === "lineup") { state.pending.delete(id); return { ok: false, error: "changed", by: r.body.by }; }   // review the newer version first
        continue;
      }
      if (r.status === 0) { setStatus("offline", "Can't reach the shared store — changes are kept here and will be sent."); return { ok: false, error: "offline" }; }
      if (r.status === 422) { state.pending.delete(id); return { ok: false, error: "bad-transition" }; }
      if (r.status === 403 && r.body.error === "coordinator-required") { state.pending.delete(id); return { ok: false, error: "coordinator-required", actions: r.body.actions }; }
      if (r.status === 503 && r.body.error === "ops-not-configured") { state.pending.delete(id); setStatus("local", "Shared storage isn't set up on this deployment — everything stays in this browser."); return { ok: false, error: "local" }; }
      state.pending.delete(id);
      return { ok: false, error: r.body.error || "http-" + r.status };
    }
    return { ok: false, error: "busy" };
  }

  /* ---------- camps ---------- */
  const isShared = (campId) => !!(meta("camp:" + campId) && meta("camp:" + campId).version);
  async function shareCamp(api, camp) {
    setMeta("camp:" + camp.id, { version: 0, base: null });
    const r = await flush(api, "camp:" + camp.id, { action: "share", summary: "Shared " + camp.name });
    if (!r.ok) del(docKey("camp:" + camp.id));
    if (r.ok) { const g = meta("games:" + camp.id); if (g && g.local) await flush(api, "games:" + camp.id, { action: "share", summary: "Shared games" }); }
    return r;
  }
  function campChanged(api, camp) { if (camp && isShared(camp.id)) queue(api, "camp:" + camp.id); }

  /* ---------- games (plan / actual) ---------- */
  function games(campId) { const m = meta("games:" + campId); return S.normGamesDoc(m && (m.local || m.base)); }
  /** save the working games doc; pushed if the camp is shared */
  function setGames(api, campId, doc, opts) {
    const id = "games:" + campId, m = meta(id) || { version: 0, base: null };
    setMeta(id, Object.assign({}, m, { local: S.normGamesDoc(doc), campId }));
    if (isShared(campId)) { if (opts && opts.now) return flush(api, id, opts); queue(api, id); }
    return Promise.resolve({ ok: true, local: !isShared(campId) });
  }

  /* ---------- lineups ---------- */
  function lineupDoc(gameId, campId) { const m = meta("lineup:" + gameId); return S.normLineupDoc(m && (m.local || m.base), gameId, campId); }
  /** a workflow action is sent at once; on failure the local copy is rolled back so screens don't show a status the server refused */
  async function lineupAction(api, campId, gameId, action, o) {
    const id = "lineup:" + gameId, m = meta(id) || { version: 0, base: null };
    const before = lineupDoc(gameId, campId);
    const t = S.transition(before, action, Object.assign({ by: (me() || { name: "Unnamed" }).name }, o));
    if (!t.ok) return t;
    setMeta(id, Object.assign({}, m, { local: t.doc, campId }));
    if (!isShared(campId)) return { ok: true, doc: t.doc, local: true };
    const r = await flush(api, id, { action, summary: (o && o.summary) || action });
    if (!r.ok) { if (r.error !== "changed") setMeta(id, Object.assign({}, meta(id), { local: meta(id).base || before })); return Object.assign({ ok: false }, r); }
    return { ok: true, doc: lineupDoc(gameId, campId) };
  }
  /* private drafts: this browser only */
  const draftKey = (gameId) => "cs.st.draft." + gameId;
  function draft(gameId) { const d = get(draftKey(gameId), null); return d ? Object.assign({}, d, { lineup: S.normLineup(d.lineup) }) : null; }
  function setDraft(gameId, d) { if (!d) { del(draftKey(gameId)); return; } put(draftKey(gameId), { lineup: d.lineup, privateNote: String(d.privateNote || "").slice(0, 2000), by: d.by, savedAt: new Date().toISOString(), fromRev: d.fromRev || 0 }); }

  /* ---------- polling ---------- */
  let pollTimer = null, pollApi = null;
  function startPolling(api) {
    pollApi = api;
    if (pollTimer) return;
    pollTimer = setInterval(() => { if (document.visibilityState === "visible") tick(); }, 20000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  }
  function tick() {
    const api = pollApi; if (!api) return;
    const root = api.root(); if (!root || !root.isConnected) return;
    const camp = api.cur(); if (!camp || !isShared(camp.id)) return;
    pullCamp(api, camp.id);
  }

  window.StSync = { state, me, setMe, coordCode, setCoordCode, isCoordinator, on, pullCamp, listCamps, openRemoteCamp, history,
    isShared, shareCamp, campChanged, games, setGames, lineupDoc, lineupAction, draft, setDraft, flush, startPolling, tick, meta };
})();
