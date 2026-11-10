/* Manager Hub — games and dates (pure logic, no page or storage access; shared by index.html and the tests).

   GamesCore  the per-affiliate game store format (v2: games by id, so a date can hold a doubleheader), the
              non-destructive migration from the old one-game-per-date map, the merge of the shipped affiliate
              schedule (schedules/games.json) into a workspace, and display helpers.
   DateCore   "today" in a time zone (an affiliate's ballpark, not the browser's), time-zone labels, week/month
              helpers. Nothing here hard-codes a year or a date.

   Merge rules (never silently overwrite, never duplicate):
     - a schedule game is matched by its stable id (affiliate · date · game number);
     - an unedited imported game takes the schedule's corrections (time, opponent, status …);
     - a game the user edited keeps the user's values; a later schedule change is kept beside it for review
       (scheduleChange) instead of replacing it;
     - a game the user deleted stays deleted (tombstone) — re-running the import doesn't bring it back;
     - a game the user added by hand on the same date is linked to the schedule game (no second card) and keeps
       the user's values, with any difference flagged for review;
     - an imported game that is no longer in the schedule is kept and marked removedFromSchedule. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GamesCore = api.GamesCore; root.DateCore = api.DateCore;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  /* ------------------------------------------------------------------ dates */
  const pad = (n) => String(n).padStart(2, "0");
  const DateCore = {
    /** YYYY-MM-DD of `now` in `tz` (IANA); the browser's own zone when tz is missing or unknown */
    todayIn(tz, now) {
      const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
      if (tz) {
        try {
          const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
          const g = (t) => p.find((x) => x.type === t).value;
          return `${g("year")}-${g("month")}-${g("day")}`;
        } catch (e) { /* unknown zone: fall through */ }
      }
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    /** "CT", "ET", "PT", "MT" (or the zone's short name) at a given date */
    tzAbbr(tz, iso) {
      if (!tz) return "";
      const fixed = { "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Los_Angeles": "PT" };
      if (fixed[tz]) return fixed[tz];
      try {
        const d = iso ? new Date(iso + "T12:00:00Z") : new Date();
        return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(d).find((x) => x.type === "timeZoneName").value;
      } catch (e) { return ""; }
    },
    /** local HH:MM of an instant in a zone */
    localTime(utcIso, tz) {
      const d = new Date(utcIso);
      if (isNaN(d)) return "";
      try {
        const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
        return `${p.find((x) => x.type === "hour").value}:${p.find((x) => x.type === "minute").value}`;
      } catch (e) { return ""; }
    },
    addDays(iso, n) {
      const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    },
    /** Sunday-start week containing iso → [7 dates] */
    weekOf(iso) {
      const d = new Date(iso + "T12:00:00Z"), dow = d.getUTCDay();
      return Array.from({ length: 7 }, (_, i) => DateCore.addDays(iso, i - dow));
    },
    clock12(hhmm) {
      const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/); if (!m) return "";
      let h = +m[1]; const ap = h < 12 ? "AM" : "PM"; h = h % 12 || 12;
      return `${h}:${m[2]} ${ap}`;
    },
    /** ms until the next local midnight in tz (for re-rendering "today" markers), ≥ 1 s */
    msToMidnight(tz, now) {
      const t = now == null ? Date.now() : +now;
      const today = DateCore.todayIn(tz, t);
      let lo = t, hi = t + 26 * 3600e3;
      while (hi - lo > 1000) { const mid = (lo + hi) / 2; if (DateCore.todayIn(tz, mid) === today) lo = mid; else hi = mid; }
      return Math.max(1000, hi - t);
    }
  };

  /* ------------------------------------------------------------------ games */
  const FIELDS = ["date", "gameNumber", "opponent", "opponentCode", "homeAway", "time", "tz", "startUTC", "timeTBD", "location", "venueCity", "status", "type", "doubleheader", "seq", "notes"];
  const uidG = () => "gm" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const empty = () => ({ v: 2, games: {} });

  /** any stored value → v2 state; the old { "2026-04-15": {…} } map becomes one game per date, ids kept */
  function migrate(raw) {
    let o = raw;
    if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== "object") return empty();
    if (o.v === 2 && o.games && typeof o.games === "object") return o;
    const st = empty();
    Object.entries(o).forEach(([k, g]) => {
      if (!g || typeof g !== "object") return;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") ? g.date : (/^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null);
      if (!date) return;
      const id = g.id || uidG();
      st.games[id] = Object.assign({ gameNumber: 1, opponent: "", homeAway: "home", time: "", location: "", notes: "", status: "scheduled", source: "manual" }, g, { id, date });
    });
    return st;
  }

  const live = (g) => g && !g.deleted;
  const order = (a, b) => a.date.localeCompare(b.date) || (a.gameNumber || 1) - (b.gameNumber || 1) || String(a.time || "").localeCompare(String(b.time || ""));
  const all = (st) => Object.values(st.games).filter(live).sort(order);
  const forDate = (st, iso) => all(st).filter((g) => g.date === iso);
  const playable = (g) => g && g.status !== "canceled" && g.status !== "postponed";

  /** the shipped record → the fields a workspace game stores */
  function fromSchedule(s) {
    return {
      date: s.date, gameNumber: s.gameNumber || 1, doubleheader: !!s.doubleheader,
      opponent: (s.opponent && (s.opponent.name || s.opponent.code)) || "", opponentCode: (s.opponent && s.opponent.code) || "",
      homeAway: s.home ? "home" : "away", time: s.timeTBD ? "" : (s.localTime || ""), tz: s.tz || "", startUTC: s.startUTC || "",
      timeTBD: !!s.timeTBD, location: (s.venue && s.venue.name) || "", venueCity: (s.venue && s.venue.city) || "",
      status: s.status || "scheduled", type: s.type || "regular", seq: s.seq == null ? null : s.seq, notes: s.notes || ""
    };
  }
  const sig = (o) => JSON.stringify(FIELDS.map((k) => (o[k] == null ? "" : o[k])));
  const diffKeys = (a, b) => FIELDS.filter((k) => String(a[k] == null ? "" : a[k]) !== String(b[k] == null ? "" : b[k]));

  /** merge one affiliate's shipped games into a workspace state; returns {state, summary} (input not mutated) */
  function merge(stateIn, shipped, version) {
    const st = JSON.parse(JSON.stringify(migrate(stateIn)));
    const sum = { version, added: 0, updated: 0, unchanged: 0, keptEdits: 0, linked: 0, removedFromSchedule: 0, deletedKept: 0, total: shipped.length };
    const bySched = {};
    Object.values(st.games).forEach((g) => { if (g.scheduleId) bySched[g.scheduleId] = g; });
    const ids = new Set();
    shipped.forEach((s) => {
      ids.add(s.id);
      const fresh = fromSchedule(s), freshSig = sig(fresh);
      let g = bySched[s.id];
      if (!g) {
        // a hand-entered game on the same date and game number is the same game: link it, keep the user's values
        g = Object.values(st.games).find((x) => !x.scheduleId && !x.deleted && x.date === s.date && (x.gameNumber || 1) === (s.gameNumber || 1));
        if (g) {
          g.scheduleId = s.id; g.scheduleBase = freshSig; g.source = g.source || "manual"; g.edited = true;
          const d = diffKeys(g, fresh).filter((k) => ["opponent", "homeAway", "time", "location", "status"].includes(k) && String(g[k] || "") !== "");
          if (d.length) g.scheduleChange = { fields: d, values: fresh };
          ["opponentCode", "tz", "startUTC", "venueCity", "type", "seq", "doubleheader", "timeTBD"].forEach((k) => { if (g[k] == null || g[k] === "") g[k] = fresh[k]; });
          if (!g.opponent) g.opponent = fresh.opponent;
          if (!g.time && !fresh.timeTBD) g.time = fresh.time;
          if (!g.location) g.location = fresh.location;
          sum.linked++; return;
        }
        const id = "sch-" + s.id;
        st.games[id] = Object.assign({ id, source: "schedule", scheduleId: s.id, scheduleBase: freshSig, scheduleVersion: version, edited: false }, fresh);
        sum.added++; return;
      }
      if (g.deleted) { g.scheduleBase = freshSig; sum.deletedKept++; return; }
      delete g.removedFromSchedule;
      if (g.edited) {
        if (g.scheduleBase !== freshSig) {
          const d = diffKeys(g, fresh);
          if (d.length) g.scheduleChange = { fields: d, values: fresh }; else delete g.scheduleChange;
          g.scheduleBase = freshSig;
        }
        sum.keptEdits++; return;
      }
      if (sig(g) === freshSig) { sum.unchanged++; g.scheduleVersion = version; return; }
      Object.assign(g, fresh, { scheduleBase: freshSig, scheduleVersion: version });
      sum.updated++;
    });
    Object.values(st.games).forEach((g) => {
      if (g.source === "schedule" && g.scheduleId && !ids.has(g.scheduleId) && !g.deleted && !g.removedFromSchedule) { g.removedFromSchedule = true; sum.removedFromSchedule++; }
    });
    return { state: st, summary: sum };
  }

  /** a user edit: imported games become `edited` (so later imports never overwrite them) */
  function edit(st, id, patch) {
    const g = st.games[id]; if (!g) return null;
    const before = sig(g);
    Object.assign(g, patch);
    if (g.timeTBD && g.time) g.timeTBD = false;
    if (g.scheduleId && sig(g) !== before) g.edited = true;
    if (g.scheduleId && g.scheduleBase === sig(g)) { g.edited = false; delete g.scheduleChange; }
    return g;
  }
  function add(st, g) {
    const id = g.id || uidG();
    st.games[id] = Object.assign({ id, gameNumber: 1, opponent: "", homeAway: "home", time: "", location: "", notes: "", status: "scheduled", source: "manual" }, g, { id });
    return st.games[id];
  }
  /** deleting an imported game leaves a tombstone, so re-importing doesn't bring it back */
  function remove(st, id) {
    const g = st.games[id]; if (!g) return;
    if (g.scheduleId) { g.deleted = true; } else delete st.games[id];
  }
  /** accept the schedule's newer values for an edited game */
  function acceptChange(st, id) {
    const g = st.games[id]; if (!g || !g.scheduleChange) return null;
    Object.assign(g, g.scheduleChange.values); delete g.scheduleChange; g.edited = false; g.scheduleBase = sig(g);
    return g;
  }

  /* ---- display ---- */
  const label = (g) => (g.homeAway === "away" ? "@ " : "vs. ") + (g.opponent || g.opponentCode || "TBD");
  /** "7:05 PM", plus the ballpark's zone when it differs from the affiliate's ("6:45 PM PT"); "TBD" when unknown */
  function timeText(g, affTz) {
    if (!g || g.timeTBD || !g.time) return "TBD";
    const t = DateCore.clock12(g.time);
    return g.tz && affTz && g.tz !== affTz ? `${t} ${DateCore.tzAbbr(g.tz, g.date)}` : t;
  }
  /** the start in the affiliate's own zone, for road games in another zone ("8:45 PM CT") */
  function homeTimeText(g, affTz) {
    if (!g || g.timeTBD || !g.startUTC || !affTz || !g.tz || g.tz === affTz) return "";
    return `${DateCore.clock12(DateCore.localTime(g.startUTC, affTz))} ${DateCore.tzAbbr(affTz, g.date)}`;
  }
  const STATUS = { scheduled: "", postponed: "Postponed", canceled: "Canceled", suspended: "Suspended", rescheduled: "Rescheduled" };
  const statusText = (g) => STATUS[g && g.status] || "";

  return { GamesCore: { migrate, merge, all, forDate, playable, fromSchedule, edit, add, remove, acceptChange, label, timeText, homeTimeText, statusText, FIELDS }, DateCore };
});
