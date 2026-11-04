/* ==========================================================================
   Manager Hub — Schedule Assistant engine
   Pure functions, no DOM. The page (assistant.js) hands it a context built
   from the app's own Library / Resources / Roster / Month / Games, and every
   proposal it makes goes back through review before anything is saved.

   Hybrid by design: an interpreter (the built-in rules here, or an optional
   AI service behind a server-side proxy) turns language into intent; this
   engine validates, schedules, diffs and applies that intent deterministically.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MHAssist = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */
  let seq = 0;
  const uid = (p = "ev") => p + Date.now().toString(36).slice(-4) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uniq = (a) => [...new Set(a)];
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const stem = (t) => norm(t).replace(/\b(\w{3,}?)(ings|ing|es|s)\b/g, "$1").trim();
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

  /* ----------------------------------------------------------------- time */
  // The sheet's own rule: 6–11 = morning, 12 = noon, 1–5 = afternoon.
  function hourOf(h, mer) {
    h = +h;
    if (mer === "a") return h === 12 ? 0 : h;
    if (mer === "p") return h < 12 ? h + 12 : 12;
    if (h >= 1 && h <= 5) return h + 12;
    return h;
  }
  /** "8", "8:15", "815", "8:15 am", "6:05p", "noon" -> minutes after midnight */
  function parseClock(str) {
    const s = String(str || "").trim().toLowerCase();
    if (!s) return null;
    if (/^noon\b/.test(s)) return 720;
    if (/^midnight\b/.test(s)) return 0;
    let m = s.match(/^(\d{1,2})[:.](\d{2})\s*(a\.?m?\.?|p\.?m?\.?)?/);
    if (m) {
      const h = +m[1], mm = +m[2];
      if (h > 23 || mm > 59) return null;
      if (h > 12) return h * 60 + mm;
      return hourOf(h, m[3] ? m[3][0] : "") * 60 + mm;
    }
    m = s.match(/^(\d{3,4})\s*(a\.?m?\.?|p\.?m?\.?)?$/);
    if (m) {
      const d = m[1], h = +d.slice(0, d.length - 2), mm = +d.slice(-2);
      if (h > 12 || mm > 59) return null;
      return hourOf(h, m[2] ? m[2][0] : "") * 60 + mm;
    }
    m = s.match(/^(\d{1,2})\s*(a\.?m?\.?|p\.?m?\.?|o'?clock)?$/);
    if (m) {
      const h = +m[1]; if (h < 1 || h > 12) return null;
      const mer = m[2] && /^[ap]/.test(m[2]) ? m[2][0] : "";
      return hourOf(h, mer) * 60;
    }
    return null;
  }
  /** the first clock time inside a row's time text, honouring an explicit AM/PM */
  function rowStart(text) {
    const m = String(text || "").match(/(\d{1,2}):(\d{2})\s*(a\.?m?\.?|p\.?m?\.?)?/i);
    if (!m) return null;
    return parseClock(m[0]);
  }
  const fmt = (x) => { x = ((Math.round(x) % 1440) + 1440) % 1440; const H = Math.floor(x / 60), m = x % 60; return (H % 12 || 12) + ":" + String(m).padStart(2, "0"); };
  const fmtAP = (x) => { x = ((Math.round(x) % 1440) + 1440) % 1440; return fmt(x) + (x < 720 ? "a" : "p"); };
  /** what goes in a row's time cell: plain h:mm inside the sheet's 6:00–5:59 window, an explicit suffix outside it */
  const rowTime = (x) => { x = ((Math.round(x) % 1440) + 1440) % 1440; return fmt(x) + (x >= 18 * 60 ? " PM" : x < 6 * 60 ? " AM" : ""); };
  const DAYMIN = 0, DAYMAX = 1439;

  /* ------------------------------------------------------- speech cleanup */
  const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, ninety: 90 };
  const NUMWORD = "(?:" + [...Object.keys(TENS), ...Object.keys(UNITS)].join("|") + ")";
  function wordNum(w) {
    const parts = String(w).toLowerCase().split(/[\s-]+/);
    let n = 0;
    for (const p of parts) { if (p in TENS) n += TENS[p]; else if (p in UNITS) n += UNITS[p]; else return null; }
    return n;
  }
  /**
   * Dictation and fast typing arrive messy: "eight thirty", "quarter past nine",
   * "8. 15", "a. m.", "fifteen minutes", "an hour and a half". Normalise those
   * into the forms the readers below understand. Pure text in, text out.
   */
  function normalizeSpeech(text) {
    let t = " " + String(text || "") + " ";
    t = t.replace(/\b([ap])\s*\.\s*m\s*\.?/gi, (m, a) => a.toLowerCase() + "m");
    t = t.replace(/\b(\d{1,2})\s*\.\s+(\d{2})\b/g, "$1:$2");                     // "8. 15"
    t = t.replace(/\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/gi, "$1:$2 $3");            // "8 15 am"
    t = t.replace(/\bat\s+(\d{1,2})\s+(\d{2})\b(?!\s*min)/gi, "at $1:$2");        // "at 8 15"
    t = t.replace(/\b(an?|one)\s+hour\s+and\s+a\s+half\b/gi, "90 minutes");
    t = t.replace(/\bhour and a half\b/gi, "90 minutes");
    t = t.replace(/\bhalf\s+(?:an\s+)?hour\b/gi, "30 minutes");
    t = t.replace(/\b(?:an|one)\s+hour\b/gi, "60 minutes");
    t = t.replace(/\b(\d+)\s+hours?\b/gi, (m, h) => `${h * 60} minutes`);
    t = t.replace(new RegExp("\\bquarter\\s+(?:past|after)\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => `${wordNum(h) ?? +h}:15`);
    t = t.replace(new RegExp("\\bhalf\\s+past\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => `${wordNum(h) ?? +h}:30`);
    t = t.replace(new RegExp("\\bquarter\\s+(?:to|of|till)\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => { const n = (wordNum(h) ?? +h) - 1; return `${n < 1 ? 12 : n}:45`; });
    // "twelve oh five", "7 oh 5"
    t = t.replace(new RegExp("\\b(" + NUMWORD + "|\\d{1,2})\\s+(?:oh|o)\\s+(one|two|three|four|five|six|seven|eight|nine|\\d)\\b", "gi"),
      (m, h, mm) => { const H = wordNum(h) ?? +h, M = wordNum(mm) ?? +mm; return H >= 1 && H <= 12 && M >= 0 && M <= 9 ? `${H}:0${M}` : m; });
    // "eight thirty", "nine o'clock", "ten fifteen am"
    t = t.replace(new RegExp("\\b(" + NUMWORD + ")\\s+(" + NUMWORD + "(?:[\\s-]" + NUMWORD + ")?|o'?clock|hundred)\\b(?!\\s*(?:min|minutes|groups?|fields?|cages?|stations?|times?))", "gi"),
      (m, h, mm) => {
        const H = wordNum(h); if (H == null || H < 1 || H > 12) return m;
        if (/o'?clock|hundred/i.test(mm)) return `${H}:00`;
        const M = wordNum(mm); if (M == null || M < 10 || M > 59) return m;
        return `${H}:${String(M).padStart(2, "0")}`;
      });
    t = t.replace(new RegExp("\\b(" + NUMWORD + "(?:[\\s-]" + NUMWORD + ")?)\\s+(min(?:ute)?s?|groups?|fields?|cages?|mounds?|stations?|times|coaches|rounds?)\\b", "gi"),
      (m, n, w) => { const v = wordNum(n); return v == null ? m : `${v} ${w}`; });
    t = t.replace(new RegExp("\\b(?:at|by|around)\\s+(" + NUMWORD + ")\\b(?!\\s*(?:min|groups?))", "gi"), (m, h) => { const v = wordNum(h); return v && v <= 12 ? m.replace(h, String(v)) : m; });
    t = t.replace(/\b(twice)\b/gi, "2 times").replace(/\bthrice\b/gi, "3 times").replace(/\bonce\b/gi, "1 time");
    t = t.replace(/\b(\d+)\s*x\s*(?:a|per|\/)\s*week\b/gi, "$1 times a week").replace(/\b(\d+)x\b/gi, "$1 times");
    t = t.replace(/\s+([,.;!?])/g, "$1").replace(/([,.;!?]){2,}/g, "$1");
    return t.replace(/[ \t]{2,}/g, " ").trim();
  }

  /* --------------------------------------------------------------- events
     One canonical shape for every block on a day. It maps 1:1 onto a row of
     the existing schedule (time / timeEnd / activity / detail / location /
     staff / notes) plus optional assistant metadata stored on row.ev, which
     the rest of the app ignores. */
  const TEAM_RE = /all players|everyone|whole team|all staff/i;
  const RELATIVE_TIME = /^(post|postgame|pre|pregame|tbd|tba|after|as needed|following)/i;

  function fromSections(sections, ctx = {}) {
    const out = [];
    (sections || []).forEach((sec, si) => {
      if (!sec || sec.kind === "lineup") return;
      const rows = sec.rows || [];
      rows.forEach((r, ri) => {
        if (!r) return;
        const blank = !String(r.activity || "").trim() && !String(r.time || "").trim() && !String(r.detail || "").trim();
        const start = rowStart(r.time);
        let end = rowStart(r.timeEnd), dur = null, assumed = false;
        const meta = r.ev || {};
        if (start != null) {
          if (end != null && end > start) dur = end - start;
          else if (meta.dur != null && meta.dur !== "") { dur = +meta.dur; end = start + dur; }
          else {
            let next = null;
            for (let j = ri + 1; j < rows.length; j++) { const t = rowStart(rows[j] && rows[j].time); if (t != null && t > start) { next = t; break; } }
            const lib = ctx.durationOf ? ctx.durationOf(r.activity) : null;
            dur = lib || (next != null ? Math.min(next - start, 60) : 20);
            if (next != null && lib && next - start < lib) dur = next - start;
            end = start + dur; assumed = true;
          }
        }
        out.push({
          id: r.id || uid(), sec: sec.id, group: sec.name || "", gtype: sec.gtype || "", ord: si * 1000 + ri,
          activity: r.activity || "", detail: r.detail || "", location: r.location || "", staff: r.staff || "", notes: r.notes || "",
          start, end, dur, assumedDur: assumed, timeText: r.time || "", blank,
          flex: meta.flex || (TEAM_RE.test(sec.name || "") ? "anchor" : "flexible"),
          source: meta.source || "manual", confidence: meta.confidence ?? null, rotation: meta.rotation || null,
          parent: meta.parent || null, deps: meta.deps || [], flags: meta.flags || [], showEnd: !!r.timeEnd
        });
      });
    });
    return out;
  }

  const ROW_FIELDS = ["time", "timeEnd", "activity", "detail", "location", "staff", "notes"];
  /**
   * Write events back into a copy of `base` sections. Existing rows keep their
   * ids and any field the event doesn't own (colours, staffIds, showDetail…).
   * Events naming a group that doesn't exist yet get a new section.
   */
  function toSections(events, base, opts = {}) {
    const secs = clone(base || []);
    const byId = new Map(secs.map((s) => [s.id, s]));
    const oldRows = new Map();
    secs.forEach((s) => (s.rows || []).forEach((r) => oldRows.set(r.id, r)));
    const bucket = new Map(secs.filter((s) => s.kind !== "lineup").map((s) => [s.id, []]));
    events.forEach((ev) => {
      let sec = byId.get(ev.sec);
      if (!sec) sec = secs.find((s) => s.kind !== "lineup" && norm(s.name) === norm(ev.group));
      if (!sec) {
        const gtype = ev.gtype || (/pitch/i.test(ev.group) ? "pitcher" : TEAM_RE.test(ev.group) ? "other" : "position");
        sec = { id: uid("sec"), kind: "table", gtype, name: ev.group || "New Group", width: TEAM_RE.test(ev.group) ? 0.66 : 0.5, band: "", roster: ev.roster || [], rows: [] };
        if (TEAM_RE.test(ev.group)) { sec.headers = { staff: "Personnel" }; secs.unshift(sec); } else secs.push(sec);
        byId.set(sec.id, sec); bucket.set(sec.id, []);
      }
      ev.sec = sec.id; ev.group = sec.name;
      bucket.get(sec.id).push(ev);
    });
    secs.forEach((s) => {
      if (s.kind === "lineup" || !bucket.has(s.id)) return;
      const list = bucket.get(s.id);
      // timed events in clock order; untimed ones ("Post", "Postgame") stay after whatever preceded them
      const timed = list.filter((e) => e.start != null).sort((a, b) => a.start - b.start || a.ord - b.ord);
      const untimed = list.filter((e) => e.start == null).sort((a, b) => a.ord - b.ord);
      const merged = timed.slice();
      untimed.forEach((u) => {
        const prev = list.filter((e) => e.start != null && e.ord < u.ord).sort((a, b) => b.ord - a.ord)[0];
        const at = prev ? merged.indexOf(prev) + 1 : merged.length;
        merged.splice(at < 0 ? merged.length : at, 0, u);
      });
      s.rows = merged.map((ev) => {
        const old = oldRows.get(ev.id) || {};
        const row = Object.assign({}, old, { id: ev.id });
        row.time = ev.start != null ? rowTime(ev.start) : ev.timeText || "";
        if (ev.start != null && (ev.showEnd || opts.showEnd)) row.timeEnd = rowTime(ev.end);
        else delete row.timeEnd;
        row.activity = ev.activity || ""; row.detail = ev.detail || ""; row.location = ev.location || "";
        if (row.staff !== ev.staff) { row.staff = ev.staff || ""; delete row.staffId; row.staffIds = []; }
        row.notes = ev.notes || "";
        if (ev.source !== "manual" || ev.rotation || (old.ev)) {
          row.ev = { dur: ev.dur, flex: ev.flex, source: ev.source, confidence: ev.confidence, rotation: ev.rotation, parent: ev.parent, deps: ev.deps && ev.deps.length ? ev.deps : undefined, flags: ev.flags && ev.flags.length ? ev.flags : undefined };
          Object.keys(row.ev).forEach((k) => row.ev[k] == null && delete row.ev[k]);
        }
        return row;
      });
      if (opts.dropEmptyNew && !s.rows.length && !(base || []).some((b) => b.id === s.id)) s._drop = true;
    });
    return secs.filter((s) => !s._drop);
  }

  /** a plain, validated event; used by planners and the AI contract */
  function makeEvent(p) {
    const start = typeof p.start === "number" ? p.start : parseClock(p.start);
    const dur = p.dur != null ? Math.max(0, Math.round(+p.dur)) : p.end != null ? (typeof p.end === "number" ? p.end : parseClock(p.end)) - start : 20;
    return {
      id: p.id || uid(), sec: p.sec || null, group: p.group || "All Players & Staff", gtype: p.gtype || "", ord: p.ord ?? 999999,
      activity: p.activity || "", detail: p.detail || "", location: p.location || "", staff: p.staff || "", notes: p.notes || "",
      start, end: start != null ? start + dur : null, dur, assumedDur: !!p.assumedDur, timeText: "", blank: false,
      flex: p.flex || "flexible", source: p.source || "assistant", confidence: p.confidence ?? 0.8,
      rotation: p.rotation || null, parent: p.parent || null, deps: p.deps || [], flags: p.flags || [], showEnd: !!p.showEnd
    };
  }
  const setStart = (ev, s) => { ev.start = s; if (ev.dur == null) ev.dur = 20; ev.end = s + ev.dur; };
  const setDur = (ev, d) => { ev.dur = Math.max(0, d); ev.assumedDur = false; if (ev.start != null) ev.end = ev.start + ev.dur; };

  /* ------------------------------------------------------------ rotations
     A real station rotation: N groups through M stations in fixed blocks,
     Latin-square order so every group sees every station once. */
  function parseRotation(text) {
    const t = normalizeSpeech(text);
    const sentences = t.split(/(?<=[.!?])\s+|\n+/);
    for (const s of sentences) {
      if (!/\brotat(?:e|es|ing|ion|ions)\b|\bstations?\b/i.test(s)) continue;
      let stationsTxt = null;
      let m = s.match(/\b(?:through|thru|between|across|around)\s+(?:the\s+)?(?:stations?\s*(?:of)?\s*)?(.+?)(?:,?\s*\(?\b\d{1,3}\s*(?:min|minutes)\b|,?\s+(?:every|starting|start|from|at|beginning|with|each|for)\b|[.;]|$)/i);
      if (m) stationsTxt = m[1];
      if (!stationsTxt && (m = s.match(/\(([^)]+)\)/))) stationsTxt = m[1];
      if (!stationsTxt && (m = s.match(/\bstations?\s*[:—-]\s*(.+?)(?:[.;]|$)/i))) stationsTxt = m[1];
      if (!stationsTxt) continue;
      const stations = stationsTxt.split(/\s*(?:,|&|\/|\band\b|\bplus\b)\s*/i)
        .map((x) => x.replace(/^(?:the|a|an)\s+/i, "").replace(/\b(?:station|stations)\b/i, "").trim()).filter((x) => x && x.length > 1 && !/^\d+$/.test(x));
      if (stations.length < 2) continue;
      const out = { stations, sentence: s.trim() };
      if ((m = s.match(/\b(\d{1,3})\s*[- ]?(?:min|minutes|minute)\b(?!\s*(?:transition|break|between))/i))) out.dur = +m[1];
      if ((m = s.match(/\bevery\s+(\d{1,3})\s*(?:min|minutes)\b/i))) out.dur = +m[1];
      if ((m = s.match(/\b(\d{1,2})\s*[- ]?(?:min|minutes|minute)\s+(?:transitions?|breaks?|between)\b/i)) || (m = s.match(/\btransitions?\s+(?:of\s+)?(\d{1,2})\s*(?:min|minutes)\b/i))) out.transition = +m[1];
      if ((m = s.match(/\b(?:starting|start|starts|beginning|begin|from|at)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i))) { const c = parseClock(m[1]); if (c != null) out.start = c; }
      if ((m = s.match(/\b(\d|one|two|three|four|five|six)\s+groups?\b/i))) out.count = /\d/.test(m[1]) ? +m[1] : wordNum(m[1]);
      let pre = s.split(/\brotat/i)[0];
      const after = s.match(/\brotate\s+(?:the\s+)?(.+?)\s+(?:through|thru|between|across)\b/i);
      if (!pre.trim() && after) pre = after[1];
      const named = pre.match(/\b(?:have\s+)?([A-Z][a-z]+(?:\s*(?:,|and|&)\s*[A-Z][a-z]+)+)\b/);
      if (named) out.groupNames = named[1].split(/\s*(?:,|and|&)\s*/).filter(Boolean);
      if (/\bpitchers?\b/i.test(pre) && !/position|hitters/i.test(pre)) out.kind = "pitcher";
      else out.kind = "position";
      return out;
    }
    return null;
  }

  /**
   * groups: [{name, sec?, gtype?}]   stations: [{label, location?, staff?}]
   * Returns {events, matrix:[[station per group]], end}
   */
  function buildRotation({ groups, stations, start, dur = 20, transition = 0, rotationId }) {
    const rid = rotationId || uid("rot");
    const nG = groups.length, nS = stations.length;
    const rounds = Math.max(nG, nS);
    const events = [], matrix = [];
    for (let r = 0; r < rounds; r++) {
      const t0 = start + r * (dur + transition);
      const row = [];
      groups.forEach((g, gi) => {
        const k = (gi + r) % rounds;
        if (k >= nS) { row.push(null); return; }     // more groups than stations: a bye this round
        const st = stations[k];
        row.push(st.label);
        events.push(makeEvent({ group: g.name, sec: g.sec || null, gtype: g.gtype || "", activity: st.label, location: st.location || "", staff: st.staff || "",
          start: t0, dur, rotation: rid, parent: "Rotation", source: "assistant", confidence: 0.9, detail: rounds > 1 ? `Rotation ${r + 1} of ${rounds}` : "" }));
      });
      matrix.push({ start: t0, end: t0 + dur, cells: row });
    }
    return { id: rid, events, matrix, end: start + rounds * dur + (rounds - 1) * transition, byes: nG > nS ? (nG - nS) * rounds : 0 };
  }

  /** split a roster into n balanced groups, keeping catchers/infielders/outfielders spread */
  function splitRoster(players, n, by = "balanced") {
    const out = Array.from({ length: n }, () => []);
    const key = (p) => /^C$/i.test(p.pos || "") ? 0 : /^(1B|2B|SS|3B|IF|INF|UTIL)$/i.test(p.pos || "") ? 1 : /^(LF|CF|RF|OF)$/i.test(p.pos || "") ? 2 : 3;
    const sorted = players.slice().sort((a, b) => key(a) - key(b) || String(a.name).localeCompare(String(b.name)));
    if (by === "position") {
      sorted.forEach((p) => out[Math.min(n - 1, key(p) % n)].push(p));
    } else {
      // snake order so each group gets a similar mix
      sorted.forEach((p, i) => { const round = Math.floor(i / n), pos = i % n; out[round % 2 ? n - 1 - pos : pos].push(p); });
    }
    return out;
  }

  /* ----------------------------------------------------------- validation */
  const LIMITED = new Set(["field", "cage", "mound"]);
  const PREGAME_RE = /dress|snack|pre-?game|walk to|bus|first pitch|meal|lunch|dinner|meeting|treatment|travel|depart/i;
  const POSTGAME_RE = /post-?game|bus|hotel|treatment|recovery|lift|meal|dinner/i;
  const STAFF_GROUP_RE = /^(all staff|atcs?|strong guys|s&c|hitting coaches|pitching coaches|nutrition staff|all players.*|game players|rehab.*|all fcl.*|coaches|staff|tbd)$/i;

  function overlaps(a, b) { return a.start != null && b.start != null && a.start < b.end && b.start < a.end; }
  const joint = (a, b) => norm(a.activity) === norm(b.activity) && a.start === b.start && (norm(a.location) === norm(b.location) || !a.location || !b.location);
  const splitStaff = (s) => String(s || "").split(/\s*(?:&|,|\/|\band\b|\+)\s*/i).map((x) => x.trim()).filter((x) => x && !STAFF_GROUP_RE.test(x));

  /**
   * ctx: kindOf(location) -> field|cage|mound|turf|gym|room|none, capacityOf(location) -> n,
   *      firstPitch (min), homeAway, gameLocation, deadline (min), dayStart (min)
   * returns [{level:"error"|"warning"|"info", code, msg, ids}]
   */
  function validate(events, ctx = {}) {
    const issues = [];
    const add = (level, code, msg, ids) => issues.push({ level, code, msg, ids: uniq(ids || []) });
    const timed = events.filter((e) => e.start != null && !e.blank);
    const kindOf = ctx.kindOf || (() => "none");
    const capOf = ctx.capacityOf || ((l) => (LIMITED.has(kindOf(l)) ? 1 : Infinity));
    const label = (e) => `${e.activity || "Untitled"} (${e.group})`;

    // 1. impossible or missing timing
    events.forEach((e) => {
      if (e.blank) return;
      if (e.start == null && e.activity && !RELATIVE_TIME.test(e.timeText || "") && !String(e.timeText || "").trim())
        add("info", "no-time", `${label(e)} has no time yet.`, [e.id]);
      if (e.start != null && (e.dur == null || e.dur < 0)) add("error", "bad-duration", `${label(e)} ends before it starts.`, [e.id]);
      if (e.start != null && e.dur === 0 && !/first pitch|bus|depart|walk|game/i.test(e.activity)) add("info", "zero-duration", `${label(e)} has no length.`, [e.id]);
      if (e.start != null && (e.start < 5 * 60 || e.end > 23 * 60)) add("warning", "beyond-day", `${label(e)} runs ${e.start < 300 ? "before 5:00 AM" : "past 11:00 PM"}.`, [e.id]);
      else if (e.start != null && (e.start >= 18 * 60 || e.start < 6 * 60)) add("info", "outside-window", `${label(e)} is outside 6:00 AM–6:00 PM, so it is written with ${e.start >= 1080 ? "PM" : "AM"} on the sheet.`, [e.id]);
    });

    // 2. a group in two places at once
    const bySec = new Map();
    timed.forEach((e) => { const k = e.sec || norm(e.group); if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(e); });
    bySec.forEach((list) => {
      list.sort((a, b) => a.start - b.start);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (b.start >= a.end) break;
        if (!overlaps(a, b)) continue;
        if (TEAM_RE.test(a.group)) continue;                 // the team strip lists simultaneous things on purpose
        if (norm(a.activity) === norm(b.activity) && a.start === b.start) { add("warning", "duplicate", `${label(a)} is listed twice at ${fmtAP(a.start)}.`, [a.id, b.id]); continue; }
        const split = a.detail && b.detail && norm(a.detail) !== norm(b.detail);
        if (split || (a.parent && a.parent === b.parent && a.rotation !== b.rotation)) {
          add("info", "split-group", `${a.group} splits at ${fmtAP(Math.max(a.start, b.start))}: ${a.activity}${a.detail ? " (" + a.detail + ")" : ""} and ${b.activity}${b.detail ? " (" + b.detail + ")" : ""}.`, [a.id, b.id]);
        } else add("warning", "group-overlap", `${a.group} is booked for ${a.activity} and ${b.activity} at the same time (${fmtAP(Math.max(a.start, b.start))}).`, [a.id, b.id]);
      }
    });

    // 3. facilities over capacity (joint sessions — Live BP, one lift for two groups — are not conflicts)
    const byLoc = new Map();
    timed.forEach((e) => {
      if (!e.location || /&/.test(e.location)) return;
      const k = norm(e.location); if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(e);
    });
    byLoc.forEach((list) => {
      const capN = capOf(list[0].location);
      if (!isFinite(capN)) return;
      list.sort((a, b) => a.start - b.start);
      const seen = new Set();
      list.forEach((a) => {
        const live = list.filter((b) => b !== a && (b.sec || b.group) !== (a.sec || a.group) && overlaps(a, b) && !joint(a, b));
        const sessions = uniq([norm(a.activity) + "@" + a.start, ...live.map((b) => norm(b.activity) + "@" + b.start)]);
        if (live.length && sessions.length > capN) {
          const ids = [a.id, ...live.map((b) => b.id)].sort();
          const key = ids.join("|"); if (seen.has(key)) return; seen.add(key);
          add("warning", "facility", `${a.location} is double-booked at ${fmtAP(Math.max(a.start, ...live.map((b) => b.start)))}: ${uniq([label(a), ...live.map(label)]).join(" and ")}.`, ids);
        }
      });
    });

    // 4. one coach in two places
    const byStaff = new Map();
    timed.forEach((e) => splitStaff(e.staff).forEach((s) => { const k = s.toLowerCase(); if (!byStaff.has(k)) byStaff.set(k, []); byStaff.get(k).push(e); }));
    byStaff.forEach((list, who) => {
      const seen = new Set();
      list.forEach((a) => list.forEach((b) => {
        if (a === b || !overlaps(a, b) || joint(a, b) || (a.sec || a.group) === (b.sec || b.group)) return;
        if (norm(a.location) === norm(b.location) && a.location) return;  // same place — one coach can run it
        const key = [a.id, b.id].sort().join("|"); if (seen.has(key)) return; seen.add(key);
        add("warning", "staff", `${list[0].staff.split(/[&,/]/).find((x) => x.trim().toLowerCase() === who) || who} is assigned to ${label(a)} and ${label(b)} at the same time.`, [a.id, b.id]);
      }));
    });

    // 5. no transition time between far-apart places
    const FAR = { field: 1, cage: 1, mound: 1, turf: 1, gym: 2, room: 2 };
    bySec.forEach((list) => {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (b.start !== a.end || !a.location || !b.location || norm(a.location) === norm(b.location)) continue;
        const ka = FAR[kindOf(a.location)], kb = FAR[kindOf(b.location)];
        if (ka && kb && ka !== kb) add("info", "transition", `${a.group} goes straight from ${a.location} to ${b.location} at ${fmtAP(b.start)} — no time to change or walk over.`, [a.id, b.id]);
      }
    });

    // 6. game-day dependencies
    if (ctx.firstPitch != null) {
      const fp = ctx.firstPitch;
      timed.forEach((e) => {
        if (/first pitch|game/i.test(e.activity) && Math.abs(e.start - fp) < 5) return;
        if (e.start >= fp && !POSTGAME_RE.test(e.activity) && !TEAM_RE.test(e.group))
          add("warning", "during-game", `${label(e)} at ${fmtAP(e.start)} is after first pitch (${fmtAP(fp)}).`, [e.id]);
        else if (e.end > fp - 45 && e.start < fp && !PREGAME_RE.test(e.activity) && !TEAM_RE.test(e.group))
          add("warning", "pregame", `${label(e)} runs to ${fmtAP(e.end)}, inside the last 45 minutes before first pitch.`, [e.id]);
        else if (ctx.homeAway !== "away" && kindOf(e.location) === "field" && e.end > fp - 75 && e.start < fp && ctx.gameLocation && norm(e.location) === norm(ctx.gameLocation))
          add("warning", "game-field", `${label(e)} uses ${e.location} within 75 minutes of first pitch — the field is needed for pregame.`, [e.id]);
      });
    }
    // ordering the coach asked for ("bullpens finish before BP")
    if (ctx.precedence && ctx.precedence.length && ctx.keysOf) {
      const has = (ev, k) => ctx.keysOf(ev.activity.replace(/:$/, "")).includes(k);
      ctx.precedence.forEach((p) => {
        const B = timed.filter((ev) => has(ev, p.before)), Af = timed.filter((ev) => has(ev, p.after));
        if (!B.length || !Af.length) return;
        const lastB = Math.max(...B.map((ev) => ev.end));
        const early = Af.filter((ev) => ev.start < lastB).sort((x, y) => x.start - y.start);
        if (early.length) add("warning", "dependency", `${label(early[0])} starts at ${fmtAP(early[0].start)}, but ${B[0].activity} runs until ${fmtAP(lastB)} — you asked for ${B[0].activity} to finish first.`, [...early.map((ev) => ev.id), ...B.filter((ev) => ev.end > early[0].start).map((ev) => ev.id)]);
      });
    }
    if (ctx.deadline != null) timed.forEach((e) => { if (e.end > ctx.deadline && !TEAM_RE.test(e.group)) add("warning", "deadline", `${label(e)} ends at ${fmtAP(e.end)}, after the ${fmtAP(ctx.deadline)} cutoff.`, [e.id]); });
    if (ctx.dayStart != null) timed.forEach((e) => { if (e.start < ctx.dayStart && !TEAM_RE.test(e.group)) add("info", "before-start", `${label(e)} starts before the ${fmtAP(ctx.dayStart)} report time.`, [e.id]); });

    // 7. assumptions worth seeing
    const assumed = events.filter((e) => e.assumedDur && e.source !== "manual");
    if (assumed.length) add("info", "assumed-duration", `Standard lengths used for ${uniq(assumed.map((e) => e.activity)).slice(0, 5).join(", ")}${assumed.length > 5 ? "…" : ""}.`, assumed.map((e) => e.id));
    const low = events.filter((e) => e.confidence != null && e.confidence < 0.6);
    if (low.length) add("info", "low-confidence", `Check ${uniq(low.map(label)).slice(0, 4).join(", ")} — the request didn't say clearly.`, low.map((e) => e.id));

    const order = { error: 0, warning: 1, info: 2 };
    return issues.sort((a, b) => order[a.level] - order[b.level]);
  }

  /* ----------------------------------------------------------------- diff */
  const DIFF_FIELDS = ["start", "dur", "activity", "location", "staff", "detail", "group", "notes"];
  function diff(before, after) {
    const A = new Map(before.filter((e) => !e.blank).map((e) => [e.id, e]));
    const B = new Map(after.filter((e) => !e.blank).map((e) => [e.id, e]));
    const added = [], removed = [], changed = [];
    B.forEach((b, id) => {
      const a = A.get(id);
      if (!a) { added.push(b); return; }
      const fields = DIFF_FIELDS.filter((f) => String(a[f] ?? "") !== String(b[f] ?? ""));
      if (fields.length) changed.push({ before: a, after: b, fields });
    });
    A.forEach((a, id) => { if (!B.has(id)) removed.push(a); });
    return { added, removed, changed, count: added.length + removed.length + changed.length };
  }
  function describeChange(c) {
    const a = c.before, b = c.after, bits = [];
    if (c.fields.includes("start")) bits.push(`${a.start != null ? fmtAP(a.start) : "—"} → ${b.start != null ? fmtAP(b.start) : "—"}`);
    if (c.fields.includes("dur")) bits.push(`${a.dur ?? "?"} → ${b.dur ?? "?"} min`);
    if (c.fields.includes("location")) bits.push(`${a.location || "no place"} → ${b.location || "no place"}`);
    if (c.fields.includes("staff")) bits.push(`staff ${a.staff || "—"} → ${b.staff || "—"}`);
    if (c.fields.includes("group")) bits.push(`${a.group} → ${b.group}`);
    if (c.fields.includes("activity")) bits.push(`renamed from ${a.activity}`);
    if (c.fields.includes("detail")) bits.push("detail edited");
    if (c.fields.includes("notes")) bits.push("note edited");
    return `${b.activity} (${b.group}): ${bits.join(", ")}`;
  }
  function summarize(d, limit = 12) {
    const lines = [];
    d.added.forEach((e) => lines.push(`+ ${e.activity} (${e.group})${e.start != null ? " at " + fmtAP(e.start) : ""}`));
    d.removed.forEach((e) => lines.push(`− ${e.activity} (${e.group})${e.start != null ? " at " + fmtAP(e.start) : ""}`));
    d.changed.forEach((c) => lines.push(`~ ${describeChange(c)}`));
    return lines.length > limit ? lines.slice(0, limit).concat([`…and ${lines.length - limit} more`]) : lines;
  }

  return { uid, clone, uniq, norm, stem, escRe, plural, cap, parseClock, rowStart, fmt, fmtAP, rowTime, wordNum, normalizeSpeech,
    fromSections, toSections, makeEvent, setStart, setDur, parseRotation, buildRotation, splitRoster, validate, overlaps,
    diff, summarize, describeChange, TEAM_RE, DAYMIN, DAYMAX, _ext: {} };
});
