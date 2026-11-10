/* Manager Hub — standard game-day activities and the Complex workout day (pure; shared by the page and tests).

   Defaults (organization-wide; editable in Game Day Defaults, with optional per-affiliate overrides):
     Home BP          game − 2:30   45 min
     Visitor BP       game − 1:45   45 min
     Pregame Warmup   game − 0:20   10 min
     Anthem           game − 0:10   10 min
   They become fixed activities in the day's request (day-solve.js), each with a stable id ("std-<key>") so
   reopening a day never adds them twice, and with the values they were generated from so a later game-time
   change can recalculate the ones nobody customised. Times are minutes after midnight in the game's local
   (ballpark) time. A TBD game generates nothing — the user supplies a time first.

   The Complex workspace has no full-season schedule: on a day without a game it starts from a general
   workout (absolute times, from the existing "Camp" day template), also editable in Game Day Defaults. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GameDay = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ORG_DEFAULTS = {
    version: 1,
    gameDay: [
      { key: "home-bp", label: "Home BP", before: 150, dur: 45, enabled: true, location: "" },
      { key: "visitor-bp", label: "Visitor BP", before: 105, dur: 45, enabled: true, location: "" },
      { key: "warmup", label: "Pregame Warmup", before: 20, dur: 10, enabled: true, location: "" },
      { key: "anthem", label: "Anthem", before: 10, dur: 10, enabled: true, location: "" }
    ],
    workout: [
      { key: "staff-meeting", label: "Staff Meeting", at: 420, dur: 15, enabled: true, location: "Conference Room", who: "all" },
      { key: "stretch", label: "Stretch", at: 480, dur: 15, enabled: true, location: "Turf", who: "all" },
      { key: "throwing", label: "Throwing", at: 510, dur: 20, enabled: true, location: "Turf", who: "all" },
      { key: "defense", label: "Defense", at: 530, dur: 40, enabled: true, location: "Field 1", who: "position" },
      { key: "hitting", label: "Hitting", at: 570, dur: 45, enabled: true, location: "Cage", who: "position" },
      { key: "conditioning", label: "Conditioning", at: 615, dur: 20, enabled: true, location: "Turf", who: "all" }
    ]
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const toMin = (hhmm) => { const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const clean = (list, kind) => (Array.isArray(list) ? list : []).map((x, i) => ({
    key: String(x.key || `${kind}-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    label: String(x.label || "Activity").slice(0, 60),
    ...(kind === "gameDay" ? { before: Math.max(0, Math.min(600, Math.round(+x.before || 0))) } : { at: Math.max(0, Math.min(1439, Math.round(+x.at || 0))) }),
    dur: Math.max(0, Math.min(300, Math.round(+x.dur || 0))),
    enabled: x.enabled !== false, location: String(x.location || "").slice(0, 60),
    ...(kind === "workout" ? { who: ["all", "position", "pitchers", "catchers"].includes(x.who) ? x.who : "all" } : {})
  }));

  /** settings document → the lists in effect for an affiliate (its override replaces the organization's list) */
  function resolve(doc, affId) {
    const d = doc && typeof doc === "object" ? doc : {};
    const org = { gameDay: d.org && d.org.gameDay ? clean(d.org.gameDay, "gameDay") : clone(ORG_DEFAULTS.gameDay), workout: d.org && d.org.workout ? clean(d.org.workout, "workout") : clone(ORG_DEFAULTS.workout) };
    const ov = (d.affiliates && d.affiliates[affId]) || {};
    return {
      gameDay: ov.gameDay ? clean(ov.gameDay, "gameDay") : org.gameDay, workout: ov.workout ? clean(ov.workout, "workout") : org.workout,
      overridden: { gameDay: !!ov.gameDay, workout: !!ov.workout }
    };
  }
  function sanitize(doc) {
    const out = { org: {}, affiliates: {} };
    if (doc && doc.org) { if (doc.org.gameDay) out.org.gameDay = clean(doc.org.gameDay, "gameDay"); if (doc.org.workout) out.org.workout = clean(doc.org.workout, "workout"); }
    Object.entries((doc && doc.affiliates) || {}).forEach(([k, v]) => {
      if (!/^[a-z]{2,4}$/.test(k) || !v) return;
      const o = {}; if (v.gameDay) o.gameDay = clean(v.gameDay, "gameDay"); if (v.workout) o.workout = clean(v.workout, "workout");
      if (Object.keys(o).length) out.affiliates[k] = o;
    });
    return out;
  }

  /** the game's standard activities → request activities (fixed, stable ids) + the values they came from */
  function gameDayActivities(gameTime, list, order0 = 1) {
    const fp = typeof gameTime === "number" ? gameTime : toMin(gameTime);
    if (fp == null) return { activities: [], generated: {}, firstPitch: null };
    const acts = [], gen = {};
    list.filter((x) => x.enabled && x.dur > 0).forEach((x, i) => {
      const at = fp - x.before;
      if (at < 0) return;
      acts.push(std("std-" + x.key, x.label, at, x.dur, x.location, "all", order0 + i));
      gen["std-" + x.key] = { at, dur: x.dur };
    });
    return { activities: acts, generated: gen, firstPitch: fp };
  }
  function workoutActivities(list, order0 = 1) {
    const acts = [], gen = {};
    list.filter((x) => x.enabled && x.dur > 0).forEach((x, i) => {
      acts.push(std("std-" + x.key, x.label, x.at, x.dur, x.location, x.who || "all", order0 + i));
      gen["std-" + x.key] = { at: x.at, dur: x.dur };
    });
    return { activities: acts, generated: gen };
  }
  function std(id, label, at, dur, location, who, order) {
    return { id, kind: "custom", label, text: label, who, at, dur, rounds: null, order, after: [], before: [], emphasis: null, indoor: null, location: location || null };
  }

  /** a request for a day: the game (anchors.firstPitch) and its standard activities — nothing else */
  function startRequest(opts) {
    const o = opts || {};
    let acts = [], generated = {}, fp = null;
    if (o.game && !o.empty) {
      const r = gameDayActivities(o.gameTime, o.settings.gameDay); acts = r.activities; generated = r.generated; fp = r.firstPitch;
    } else if (o.game) fp = toMin(o.gameTime);
    else if (o.workout && !o.empty) { const r = workoutActivities(o.settings.workout); acts = r.activities; generated = r.generated; }
    return {
      request: { version: 1, dayType: o.game ? "game" : "workout", level: o.level || null, anchors: { start: null, end: null, firstPitch: fp, offBeforeGame: null },
        groups: { hitting: null, pitchers: null }, weather: null, base: null, edits: [], activities: acts, parallel: [], offBefore: [], notes: [], unknown: [] },
      generated
    };
  }

  /** which standard activities the user changed (time or length) since they were generated */
  function customized(request, generated) {
    const out = [];
    Object.entries(generated || {}).forEach(([id, g]) => {
      const a = (request.activities || []).find((x) => x.id === id);
      if (a && (a.at !== g.at || a.dur !== g.dur)) out.push(id);
    });
    return out;
  }
  /** the game moved: move the standard activities with it. mode "untouched" keeps customised ones; "all" moves every one */
  function recalc(request, generated, newTime, list, mode) {
    const fp = toMin(newTime); if (fp == null) return null;
    const r = clone(request), gen = clone(generated || {}), keep = mode === "all" ? [] : customized(request, generated);
    const fresh = gameDayActivities(fp, list).generated;
    let moved = 0;
    r.activities.forEach((a) => {
      if (!fresh[a.id] || keep.includes(a.id)) return;
      a.at = fresh[a.id].at; a.dur = fresh[a.id].dur; gen[a.id] = fresh[a.id]; moved++;
    });
    r.anchors.firstPitch = fp;
    return { request: r, generated: gen, moved, kept: keep };
  }

  /** an interpreted description + the day's standard activities: keep every standard activity unless the
      description names it; our own BP takes the BP slot (Home BP at home, Visitor BP on the road) instead of
      appearing twice */
  function mergeStandard(described, stdActs, home) {
    const r = clone(described);
    const names = (r.activities || []).map((a) => String(a.label || a.text || "").toLowerCase());
    const ownKey = home ? "std-home-bp" : "std-visitor-bp";
    const ownBp = (r.activities || []).find((a) => a.kind === "bp");
    const add = [];
    stdActs.forEach((s) => {
      const nm = s.label.toLowerCase();
      if (names.some((n) => n && (n === nm || n.includes(nm)))) return;            // the coach mentioned it: theirs wins
      if (s.id === ownKey && ownBp) {                                            // "BP" = our standard BP slot
        if (ownBp.at == null) { ownBp.at = s.at; if (ownBp.dur == null && !(ownBp.rounds && (ownBp.rounds.each || ownBp.rounds.count))) ownBp.dur = s.dur; }
        return;
      }
      add.push(Object.assign(clone(s), { order: 900 + add.length }));
    });
    r.activities = (r.activities || []).concat(add);
    return r;
  }

  return { ORG_DEFAULTS, resolve, sanitize, gameDayActivities, workoutActivities, startRequest, customized, recalc, mergeStandard, toMin };
});
