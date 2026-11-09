/* ==========================================================================
   Manager Hub — Describe Your Day: facade
   text ─► interpreter (built-in reader, or the AI interpreter's IR) ─► DayRequest
        ─► DaySolve.solve ─► DayPlan.   Refinements become EditOps applied to the
   request (never to rows), then the plan is solved again.
   Design: manager-hub/DAY-ENGINE.md
   ========================================================================== */
(function (root, factory) {
  const deps = typeof module === "object" && module.exports
    ? { KB: require("./day-kb.js"), Read: require("./day-read.js"), Solve: require("./day-solve.js") }
    : { KB: root.DayKB, Read: root.DayRead, Solve: root.DaySolve };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DayEngine = api;
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict";
  const { KB, Read, Solve } = deps;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /** Build a day from a description. `request` may be supplied by the AI interpreter instead of the reader. */
  function plan(text, ctx = {}, opts = {}) {
    let request = opts.request || null, interpreter = opts.request ? "ai" : "reader";
    if (request) {
      const v = Solve.validate(request, { strict: true });
      if (!v.ok) { request = null; interpreter = "reader"; }
    }
    if (!request) request = Read.read(text, ctx);
    request = resolveBase(request, ctx);
    const p = Solve.solve(request, ctx);
    return { text, request, plan: p, interpreter, history: [] };
  }

  /** "same as yesterday but…": start from yesterday's (or the current) request, then apply the stated changes */
  function resolveBase(request, ctx) {
    if (!request.base) return request;
    const src = request.base.ref === "yesterday" ? ctx.yesterday : request.base.ref === "current" ? ctx.current : null;
    if (!src) {
      const r = clone(request);
      r.notes = (r.notes || []).concat([request.base.ref === "yesterday" ? "No saved schedule for the day before — built from this description only." : "No current schedule to start from — built from this description only."]);
      r.base = null;
      return r;
    }
    const merged = Solve.applyEdits(clone(src), request.edits || [], ctx);
    merged.activities = merged.activities.concat((request.activities || []).filter((a) => !merged.activities.some((m) => m.kind === a.kind && m.who === a.who)));
    merged.notes = (merged.notes || []).concat(request.notes || [], [`Started from ${request.base.ref === "yesterday" ? "yesterday's" : "the current"} schedule.`]);
    merged.base = null; merged.edits = [];
    return merged;
  }

  /** A follow-up instruction against an existing state. Unaffected items keep their stated constraints. */
  function refine(state, text, ctx = {}, opts = {}) {
    const ops = opts.ops || Read.readEdit(text, state.request, state.plan, ctx);
    return applyOps(state, ops, ctx, text);
  }
  function applyOps(state, ops, ctx = {}, text = "") {
    const before = clone(state.request);
    const request = Solve.applyEdits(clone(state.request), ops || [], ctx);
    const p = Solve.solve(request, ctx);
    return Object.assign({}, state, { request, plan: p, ops, history: (state.history || []).concat([{ text, request: before, plan: state.plan }]) });
  }
  function undo(state) {
    const h = state.history || [];
    if (!h.length) return state;
    const last = h[h.length - 1];
    return Object.assign({}, state, { request: last.request, plan: last.plan, history: h.slice(0, -1), redo: (state.redo || []).concat([{ request: state.request, plan: state.plan, text: last.text }]) });
  }
  function redo(state) {
    const r = state.redo || [];
    if (!r.length) return state;
    const next = r[r.length - 1];
    return Object.assign({}, state, { request: next.request, plan: next.plan, redo: r.slice(0, -1), history: (state.history || []).concat([{ text: next.text, request: state.request, plan: state.plan }]) });
  }
  return { plan, refine, applyOps, undo, redo, KB, Read, Solve };
});
