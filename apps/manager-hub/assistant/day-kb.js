/* ==========================================================================
   Manager Hub — Describe Your Day: baseball knowledge base
   Activity kinds (a shared contract with day-read.js and day-solve.js), their
   ordering phase, default track, durations, resources and emphasis area.
   Design: manager-hub/DAY-ENGINE.md §3.  Pure data + helpers, no DOM.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DayKB = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Ordering ranks. Lower runs earlier in the day. */
  const PHASE = {
    arrival: 0, meeting: 5, earlyWork: 8, activation: 9, stretch: 10,
    throwing: 20, pitcherWork: 22, bullpen: 25, teamDefense: 30, pfp: 31, indDefense: 32, baserunning: 34,
    cage: 38, bp: 40, liveBp: 42, meal: 50, custom: 50, conditioning: 60,
    free: 80, pregamePrep: 85, game: 100, postgame: 110
  };
  /** Bands used by the solver: warm-up (phase < 20), work (20–79), wind-down (≥ 80). */
  const BAND = { warmup: 0, work: 1, wind: 2 };

  // dur: minutes {def, min, max}. bp/cage durations are per round when the activity has rounds.
  // resource: what the item occupies. "field" kinds marked exclusive need the whole field.
  // area: which "emphasis" word protects / weights the kind ("defense-heavy day").
  const K = (id, label, who, def, min, max, resource, extra = {}) =>
    Object.assign({ id, label, phase: PHASE[id], who, dur: { def, min, max }, resource, flex: true, area: null, exclusive: false }, extra);

  const LIST = [
    K("arrival", "Report", "all", 0, 0, 0, null, { flex: false, point: true }),
    K("meeting", "Team Meeting", "all", 15, 10, 30, "clubhouse"),
    K("meal", "Meal", "all", 30, 20, 45, "clubhouse"),
    K("earlyWork", "Early Work", "position", 30, 20, 60, "field", { area: "hitting" }),
    K("activation", "Activation", "all", 10, 5, 20, "field"),
    K("stretch", "Team Stretch", "all", 15, 10, 20, "field"),
    K("throwing", "Throwing Progression", "all", 15, 10, 25, "field"),
    K("teamDefense", "Team Fundamentals", "all", 25, 15, 40, "field", { area: "defense", exclusive: true }),
    K("indDefense", "Individual Defense", "position", 30, 15, 45, "field", { area: "defense" }),
    K("pfp", "PFP", "pitchers", 20, 15, 30, "field", { area: "pitching" }),
    K("bullpen", "Bullpens", "pitchers", 30, 20, 60, "mound", { area: "pitching" }),
    K("pitcherWork", "Pitchers' Program", "pitchers", 30, 20, 60, "field", { area: "pitching" }),
    K("baserunning", "Baserunning", "position", 20, 10, 30, "field", { area: "defense" }),
    K("bp", "Batting Practice", "position", 30, 20, 40, "field", { area: "hitting", exclusive: true, perRound: true }),
    K("cage", "Cage Work", "position", 30, 20, 45, "cage", { area: "hitting", perRound: true }),
    K("liveBp", "Live BP", "all", 30, 20, 45, "field", { area: "hitting", exclusive: true }),
    K("conditioning", "Conditioning", "all", 30, 20, 45, "field", { area: "conditioning" }),
    K("free", "Free Time", "all", 30, 5, 240, null, { flex: false }),
    K("pregamePrep", "Transition / Pregame Preparation", "all", 20, 10, 40, "clubhouse"),
    K("game", "Game", "all", 0, 0, 0, "field", { flex: false, point: true }),
    K("postgame", "Postgame", "all", 20, 10, 40, null),
    K("custom", "Activity", "all", 20, 10, 45, null)
  ];
  const kinds = {};
  LIST.forEach((k) => (kinds[k.id] = Object.freeze(Object.assign(k, { dur: Object.freeze(k.dur) }))));
  const IDS = LIST.map((k) => k.id);

  /** Canonical display labels per kind. */
  const LABELS = {};
  LIST.forEach((k) => (LABELS[k.id] = k.label));
  LABELS.free = "Free Time";
  /** The protected window before first pitch has its own name. */
  const PREGAME_FREE_LABEL = "Pregame Free Time";

  /** Emphasis words ("defense-heavy") → kinds they cover. */
  const AREAS = {
    defense: ["teamDefense", "indDefense", "baserunning", "pfp"],
    hitting: ["bp", "cage", "liveBp", "earlyWork"],
    pitching: ["bullpen", "pitcherWork", "pfp", "liveBp"],
    conditioning: ["conditioning"]
  };
  const HITTING = ["bp", "cage", "liveBp"];
  const WARMUP = ["activation", "stretch"];
  /** Work that a team stretch (and a throwing progression) should precede. */
  const NEEDS_WARMUP = ["throwing", "teamDefense", "indDefense", "pfp", "baserunning", "bp", "cage", "liveBp", "pitcherWork", "bullpen", "conditioning"];
  const NEEDS_THROWING = ["teamDefense", "indDefense", "pfp", "baserunning", "bp", "liveBp"];

  function kind(id) { return kinds[id] || null; }
  function label(id) { return LABELS[id] || LABELS.custom; }
  function phaseOf(id) { const k = kinds[id]; return k ? k.phase : PHASE.custom; }
  function bandOf(id) { const p = phaseOf(id); return p < 20 ? BAND.warmup : p < 80 ? BAND.work : BAND.wind; }
  function areaOf(id) { return Object.keys(AREAS).filter((a) => AREAS[a].includes(id)); }
  /** Default minutes for a kind, honouring an Activity Library override (ctx.durations). */
  function durOf(id, ctx) {
    const k = kinds[id] || kinds.custom;
    const o = ctx && ctx.durations && Number.isFinite(+ctx.durations[id]) && +ctx.durations[id] > 0 ? Math.round(+ctx.durations[id]) : null;
    if (o == null) return { def: k.dur.def, min: k.dur.min, max: k.dur.max, override: false };
    return { def: o, min: Math.min(k.dur.min, o), max: Math.max(k.dur.max, o), override: true };
  }
  const isHitting = (id) => HITTING.includes(id);

  return { PHASE, BAND, kinds, IDS, LIST, LABELS, PREGAME_FREE_LABEL, AREAS, HITTING, WARMUP, NEEDS_WARMUP, NEEDS_THROWING,
    kind, label, phaseOf, bandOf, areaOf, durOf, isHitting };
});
