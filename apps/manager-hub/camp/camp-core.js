/* Manager Hub — Camp: pure logic (no DOM).
   Organisation-wide camps and workouts: player pool across affiliates, camp groups, staff,
   a facility-by-time schedule per day, conflicts, draft → published snapshots, copy/templates,
   print/CSV helpers and storage recovery.

   Time model: a camp has an IANA timezone. Dates are "YYYY-MM-DD" strings and times are whole
   minutes after local midnight *in the camp's timezone*. Nothing here converts through the
   viewer's Date timezone: calendar arithmetic uses Date.UTC only, and "today/now in the camp"
   comes from Intl.DateTimeFormat with the camp's timeZone.

   Browser: global `CampCore`. Node: require("./camp-core.js"). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CampCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "cs.camp.v1";
  const VERSION = 1;
  const DEFAULT_TZ = "America/New_York";
  const DEFAULT_WINDOW = { start: 7 * 60, end: 14 * 60 };

  /* ---------- categories (the Library's five, plus "other") ---------- */
  const CATEGORIES = [
    { id: "fundamentals", name: "Team Fundamentals / Defense", short: "Fundamentals", color: "#C8102E" },
    { id: "hitting", name: "Hitting", short: "Hitting", color: "#1D6FD0" },
    { id: "pitching", name: "Pitching", short: "Pitching", color: "#1E8A5A" },
    { id: "strength", name: "Strength & Conditioning", short: "Strength", color: "#7A4BC4" },
    { id: "meetings", name: "Meetings", short: "Meetings", color: "#D89B0B" },
    { id: "other", name: "Other", short: "Other", color: "#6B7280" }
  ];
  const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

  /* A starter catalogue for titles (mirrors the Library seed). The UI prefers the live Library. */
  const ACTIVITY_CATALOGUE = [
    ["Team Fundamentals", "fundamentals", 20], ["Bunt Defense", "fundamentals", 20], ["First & Third Defense", "fundamentals", 25],
    ["Cuts & Relays", "fundamentals", 25], ["Pickoffs", "fundamentals", 20], ["Rundowns", "fundamentals", 20],
    ["Defensive Stations", "fundamentals", 30], ["PFP", "fundamentals", 15], ["Catcher Receiving", "fundamentals", 30],
    ["Catcher Blocking", "fundamentals", 20], ["On-Field BP", "hitting", 30], ["Live BP", "hitting", 20],
    ["Machine BP", "hitting", 20], ["Cage Work", "hitting", 40], ["Bullpen", "pitching", 30], ["Throwing", "pitching", 20],
    ["Sides", "pitching", 20], ["Pitch Design", "pitching", 30], ["Recovery Throw", "pitching", 15], ["Stretch", "strength", 15],
    ["Lift", "strength", 45], ["Conditioning", "strength", 15], ["Recovery", "strength", 15], ["Team Meeting", "meetings", 20],
    ["Walk-Through", "meetings", 20]
  ].map(([title, cat, dur]) => ({ title, cat, dur }));

  /* ---------- facilities ---------- */
  const FACILITY_TYPES = [
    { id: "field", name: "Field" }, { id: "cage", name: "Cage" }, { id: "bullpen", name: "Bullpen" },
    { id: "catching", name: "Catching" }, { id: "weight", name: "Weight room" }, { id: "indoor", name: "Indoor / Turf" },
    { id: "meeting", name: "Meeting room" }, { id: "other", name: "Other" }
  ];
  /* capacity = most players at once (null = not set, so headcount isn't checked);
     concurrent = most activities at once (null = any number may share it).
     The bullpen is ONE facility with capacity 8 — eight mounds — rather than eight columns:
     pen sessions are scheduled as one block of pitchers sharing the mound row, the grid stays
     readable, and the capacity check flags a ninth thrower. Split it into separate mounds in
     Setup if you assign mounds individually. */
  const FLORIDA_PRESET = [
    ["Field 1", "field", 30, 1], ["Field 2", "field", 30, 1], ["Field 3", "field", 30, 1], ["Field 4", "field", 30, 1],
    ["Cage 1", "cage", 6, 1], ["Cage 2", "cage", 6, 1], ["Cage 3", "cage", 6, 1], ["Cage 4", "cage", 6, 1],
    ["Bullpen mounds (8)", "bullpen", 8, null], ["Catching area", "catching", 8, 1],
    ["Weight room", "weight", 30, null], ["Indoor / Turf", "indoor", 30, null], ["Meeting room", "meeting", 60, 1]
  ];
  const presetFacilities = () =>
    FLORIDA_PRESET.map(([name, type, capacity, concurrent]) => ({ id: uid("f"), name, type, capacity, concurrent }));

  const PRESET_GROUPS = ["Catchers", "Starting Pitchers", "Relievers", "Early Work", "Hitting Group A",
    "Hitting Group B", "Defensive Group A", "Defensive Group B", "Rehab / Modified"];
  const GROUP_COLORS = ["#0F766E", "#7C3AED", "#B45309", "#0369A1", "#BE185D", "#4D7C0F", "#475569", "#9A3412", "#1D4ED8", "#A21CAF"];

  /* ---------- small helpers ---------- */
  function uid(p) { return (p || "x") + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const snap = (m, step) => Math.round(m / (step || 5)) * (step || 5);
  const str = (v) => (v == null ? "" : String(v));
  const uniq = (a) => Array.from(new Set(a));

  /* ---------- dates (calendar only, never the viewer's timezone) ---------- */
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function isDate(s) {
    const m = DATE_RE.exec(str(s)); if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function toUTC(s) { const m = DATE_RE.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function fromUTC(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  const addDays = (s, n) => fromUTC(toUTC(s) + n * 86400000);
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  function dateRange(a, b) {
    if (!isDate(a) || !isDate(b)) return [];
    const n = daysBetween(a, b); if (n < 0 || n > 366) return n < 0 ? [] : [a];
    const out = []; for (let i = 0; i <= n; i++) out.push(addDays(a, i)); return out;
  }
  const weekday = (s) => new Date(toUTC(s)).getUTCDay(); // 0 = Sunday
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(s, opts) {
    if (!isDate(s)) return str(s);
    const m = DATE_RE.exec(s), o = opts || {};
    const core = MON[+m[2] - 1] + " " + (+m[3]) + (o.year ? ", " + m[1] : "");
    if (o.noDow) return core;
    return (o.long ? DOW_LONG : DOW)[weekday(s)] + ", " + core;
  }
  const fmtShort = (s) => (isDate(s) ? (+s.slice(5, 7)) + "/" + (+s.slice(8, 10)) : str(s));
  function fmtRange(a, b) {
    if (!isDate(a)) return "";
    if (!isDate(b) || a === b) return fmtDate(a, { noDow: true, year: true });
    if (a.slice(0, 4) !== b.slice(0, 4)) return fmtDate(a, { noDow: true, year: true }) + " – " + fmtDate(b, { noDow: true, year: true });
    if (a.slice(0, 7) === b.slice(0, 7)) return fmtDate(a, { noDow: true }) + "–" + (+b.slice(8, 10)) + ", " + a.slice(0, 4);
    return fmtDate(a, { noDow: true }) + " – " + fmtDate(b, { noDow: true }) + ", " + a.slice(0, 4);
  }
  /** Monday of the week containing s */
  const weekStart = (s) => addDays(s, -((weekday(s) + 6) % 7));

  /* ---------- times: minutes after local midnight in the camp's timezone ---------- */
  function fmtTime(min, opts) {
    const o = opts || {};
    min = ((Math.round(min) % 1440) + 1440) % 1440;
    const H = Math.floor(min / 60), m = min % 60;
    const h = H % 12 === 0 ? 12 : H % 12;
    const ap = H < 12 ? "AM" : "PM";
    if (o.short && m === 0) return h + (o.ampm === false ? "" : " " + ap);
    return h + ":" + String(m).padStart(2, "0") + (o.ampm === false ? "" : " " + ap);
  }
  function fmtSpan(start, dur) {
    const end = start + dur;
    const sameHalf = (start < 720) === (end < 720);
    return sameHalf ? fmtTime(start, { ampm: false }) + "–" + fmtTime(end) : fmtTime(start) + "–" + fmtTime(end);
  }
  /** "7:30", "07:30", "7:30 PM", "1930", "730" → minutes; null if unreadable. 24-hour unless AM/PM given. */
  function parseTime(t) {
    const s = str(t).trim().toUpperCase();
    let m = /^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM|A|P)?$/.exec(s);
    if (!m) return null;
    let h = +m[1], mi = m[2] ? +m[2] : 0;
    if (!m[2] && m[1].length > 2) return null;
    if (mi > 59 || h > 23) return null;
    if (m[3]) { if (h < 1 || h > 12) return null; const pm = m[3][0] === "P"; h = (h % 12) + (pm ? 12 : 0); }
    return h * 60 + mi;
  }
  const toHHMM = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

  /* ---------- timezones (Intl only) ---------- */
  function isTimeZone(tz) {
    if (!tz || typeof tz !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  /** today's date and the current minute in tz */
  function nowIn(tz, now) {
    const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const zone = isTimeZone(tz) ? tz : DEFAULT_TZ;
    const parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
    const H = +parts.hour === 24 ? 0 : +parts.hour;
    return { date: parts.year + "-" + parts.month + "-" + parts.day, minute: H * 60 + (+parts.minute) };
  }
  /** "EST" / "EDT" etc. for that date (noon UTC sits inside the local day everywhere in the Americas) */
  function tzAbbr(tz, date) {
    const zone = isTimeZone(tz) ? tz : DEFAULT_TZ;
    const ms = isDate(date) ? toUTC(date) + 12 * 3600000 + 5 * 3600000 : Date.now();
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms));
      const n = p.find((x) => x.type === "timeZoneName"); return n ? n.value : zone;
    } catch (e) { return zone; }
  }
  const tzCity = (tz) => str(tz).split("/").pop().replace(/_/g, " ");
  const COMMON_TZ = [
    ["America/New_York", "Eastern — Florida (West Palm Beach), New York"],
    ["America/Chicago", "Central — Houston, Corpus Christi"],
    ["America/Denver", "Mountain"],
    ["America/Phoenix", "Arizona (no DST)"],
    ["America/Los_Angeles", "Pacific"],
    ["America/Santo_Domingo", "Dominican Republic"],
    ["America/Caracas", "Venezuela"],
    ["America/Puerto_Rico", "Puerto Rico"]
  ];

  /* ---------- state ---------- */
  const emptyState = () => ({ version: VERSION, camps: [], templates: [], activeCampId: null });

  function normActivity(a) {
    if (!a || typeof a !== "object" || !isDate(a.date)) return null;
    const start = Number.isFinite(+a.start) ? clamp(Math.round(+a.start), 0, 1435) : 480;
    const dur = Number.isFinite(+a.dur) ? clamp(Math.round(+a.dur), 5, 1440 - start) : 30;
    const arr = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === "string" && v) : []);
    return {
      id: str(a.id) || uid("a"), date: a.date, title: str(a.title) || "Activity",
      cat: CATEGORIES.some((c) => c.id === a.cat) ? a.cat : "other",
      facilityId: a.facilityId ? str(a.facilityId) : null, start, dur,
      groups: uniq(arr(a.groups)), players: uniq(arr(a.players)), staff: uniq(arr(a.staff)), notes: str(a.notes)
    };
  }
  function normFacility(f) {
    if (!f || typeof f !== "object") return null;
    const num = (v) => (v === "" || v == null || !Number.isFinite(+v) || +v <= 0 ? null : Math.round(+v));
    return { id: str(f.id) || uid("f"), name: str(f.name) || "Facility", type: FACILITY_TYPES.some((t) => t.id === f.type) ? f.type : "other",
      capacity: num(f.capacity), concurrent: num(f.concurrent) };
  }
  function normCamp(c) {
    if (!c || typeof c !== "object") return null;
    const start = isDate(c.start) ? c.start : null;
    if (!start) return null;
    const end = isDate(c.end) && c.end >= start ? c.end : start;
    const arr = (x) => (Array.isArray(x) ? x : []);
    const win = c.dayWindow && Number.isFinite(+c.dayWindow.start) && Number.isFinite(+c.dayWindow.end) && +c.dayWindow.end > +c.dayWindow.start
      ? { start: clamp(+c.dayWindow.start, 0, 1380), end: clamp(+c.dayWindow.end, 60, 1440) } : clone(DEFAULT_WINDOW);
    const snapNorm = (s) => (s && typeof s === "object" ? {
      at: str(s.at), activities: arr(s.activities).map(normActivity).filter(Boolean),
      groups: arr(s.groups).map(normGroup).filter(Boolean), facilities: arr(s.facilities).map(normFacility).filter(Boolean),
      staff: arr(s.staff).map(normStaff).filter(Boolean)
    } : null);
    return {
      id: str(c.id) || uid("c"), name: str(c.name) || "Camp", location: str(c.location),
      tz: isTimeZone(c.tz) ? c.tz : DEFAULT_TZ, start, end, notes: str(c.notes), dayWindow: win,
      facilities: arr(c.facilities).map(normFacility).filter(Boolean),
      staff: arr(c.staff).map(normStaff).filter(Boolean),
      players: uniq(arr(c.players).filter((p) => typeof p === "string" && p.includes(":"))),
      groups: arr(c.groups).map(normGroup).filter(Boolean),
      draft: { activities: arr(c.draft && c.draft.activities).map(normActivity).filter(Boolean) },
      published: snapNorm(c.published),
      created: str(c.created), updated: str(c.updated)
    };
  }
  function normGroup(g) {
    if (!g || typeof g !== "object") return null;
    return { id: str(g.id) || uid("g"), name: str(g.name) || "Group", color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : GROUP_COLORS[0],
      players: uniq((Array.isArray(g.players) ? g.players : []).filter((p) => typeof p === "string" && p)) };
  }
  function normStaff(s) {
    if (!s || typeof s !== "object" || !str(s.name).trim()) return null;
    return { id: str(s.id) || uid("s"), name: str(s.name).trim(), role: str(s.role), from: str(s.from) };
  }
  function normTemplate(t) {
    if (!t || typeof t !== "object") return null;
    return { id: str(t.id) || uid("t"), name: str(t.name) || "Template", created: str(t.created), source: t.source && typeof t.source === "object" ? { campId: str(t.source.campId), campName: str(t.source.campName), date: str(t.source.date) } : null,
      activities: (Array.isArray(t.activities) ? t.activities : []).filter((a) => a && typeof a === "object").map((a) => ({
        title: str(a.title) || "Activity", cat: CATEGORIES.some((c) => c.id === a.cat) ? a.cat : "other",
        start: Number.isFinite(+a.start) ? clamp(+a.start, 0, 1435) : 480, dur: Number.isFinite(+a.dur) ? clamp(+a.dur, 5, 1440) : 30,
        notes: str(a.notes), facilityId: a.facilityId ? str(a.facilityId) : null, facilityName: str(a.facilityName), facilityType: str(a.facilityType),
        groups: (Array.isArray(a.groups) ? a.groups : []).filter((g) => g && g.name).map((g) => ({ id: str(g.id), name: str(g.name) })),
        staff: (Array.isArray(a.staff) ? a.staff : []).filter((s) => s && s.name).map((s) => ({ id: str(s.id), name: str(s.name) })),
        players: (Array.isArray(a.players) ? a.players : []).filter((p) => typeof p === "string")
      })) };
  }
  function normalizeState(d) {
    const s = emptyState();
    if (!d || typeof d !== "object") return s;
    s.camps = (Array.isArray(d.camps) ? d.camps : []).map(normCamp).filter(Boolean);
    s.templates = (Array.isArray(d.templates) ? d.templates : []).map(normTemplate).filter(Boolean);
    s.activeCampId = s.camps.some((c) => c.id === d.activeCampId) ? d.activeCampId : (s.camps[0] ? s.camps[0].id : null);
    return s;
  }

  /** Read cs.camp.v1. A parse failure keeps the unreadable text under a backup key before anything
      could overwrite it, and the caller gets an empty state plus `recovered`. */
  function loadState(storage, nowMs) {
    let raw = null;
    try { raw = storage.getItem(STORAGE_KEY); } catch (e) { return { state: emptyState(), error: "unavailable" }; }
    if (raw == null || raw === "") return { state: emptyState() };
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = undefined; }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { state: normalizeState(parsed) };
    const backupKey = STORAGE_KEY + ".backup." + (nowMs || Date.now());
    let backedUp = false;
    try { storage.setItem(backupKey, raw); backedUp = true; } catch (e) { backedUp = false; }
    return { state: emptyState(), recovered: true, backupKey: backedUp ? backupKey : null };
  }
  function saveState(storage, state) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  /* ---------- camps ---------- */
  function newCamp(o) {
    o = o || {};
    const start = isDate(o.start) ? o.start : nowIn(o.tz || DEFAULT_TZ).date;
    const end = isDate(o.end) && o.end >= start ? o.end : start;
    const now = new Date().toISOString();
    return normCamp({
      id: uid("c"), name: str(o.name).trim() || "Camp", location: str(o.location).trim(), tz: isTimeZone(o.tz) ? o.tz : DEFAULT_TZ,
      start, end, notes: str(o.notes), dayWindow: clone(DEFAULT_WINDOW), facilities: o.preset === false ? [] : presetFacilities(),
      staff: [], players: [], groups: [], draft: { activities: [] }, published: null, created: now, updated: now
    });
  }
  const campDates = (camp) => dateRange(camp.start, camp.end);
  const activitiesOn = (acts, date) => acts.filter((a) => a.date === date).sort((a, b) => a.start - b.start || a.dur - b.dur || a.title.localeCompare(b.title));

  /* ---------- the organisation-wide player pool ---------- */
  const PITCHER_POS = /^(P|RHP|LHP|SP|RP|PITCHER)$/i;
  /** Union of every affiliate's roster. Never mutates the roster records: each entry is a new object. */
  function buildPool(affiliates, readRoster) {
    const out = [], seen = new Set();
    (affiliates || []).forEach((a) => {
      let list = [];
      try { list = readRoster(a.id) || []; } catch (e) { list = []; }
      if (!Array.isArray(list)) return;
      list.forEach((p) => {
        if (!p || typeof p !== "object" || p.id == null) return;
        const first = str(p.first).trim(), last = str(p.last).trim();
        if (!first && !last) return;
        const pid = a.id + ":" + p.id;
        if (seen.has(pid)) return; seen.add(pid);
        const position = str(p.position).trim().toUpperCase(), pos2 = str(p.pos2).trim().toUpperCase();
        const group = p.group === "pitcher" || (!p.group && PITCHER_POS.test(position)) ? "pitcher" : "position";
        out.push({
          pid, affId: a.id, aff: a.short || a.id.toUpperCase(), affName: a.name || a.id, affLevel: str(a.level).split(" · ")[0],
          id: str(p.id), first, last, name: (first + " " + last).trim(), sortName: (last + " " + first).toLowerCase(),
          position, pos2, group, bats: str(p.bats).trim().toUpperCase(), throws: str(p.throws).trim().toUpperCase(),
          number: str(p.number).trim(), status: str(p.status).trim().toUpperCase(), age: str(p.age).trim(),
          isPitcher: group === "pitcher", isCatcher: position === "C" || pos2 === "C"
        });
      });
    });
    out.sort((x, y) => x.sortName.localeCompare(y.sortName) || x.affId.localeCompare(y.affId));
    return out;
  }
  const poolIndex = (pool) => new Map(pool.map((p) => [p.pid, p]));

  /** what the filters can offer — only values present in the data */
  function facets(pool, affiliates) {
    const has = (k) => uniq(pool.map((p) => p[k]).filter(Boolean)).sort();
    const affs = (affiliates || []).filter((a) => pool.some((p) => p.affId === a.id))
      .map((a) => ({ id: a.id, short: a.short || a.id.toUpperCase(), level: str(a.level).split(" · ")[0], count: pool.filter((p) => p.affId === a.id).length }));
    return { affiliates: affs, positions: has("position"), throws: has("throws"), bats: has("bats"), statuses: has("status") };
  }

  /** f: {q, affs:[affId], role:"pitcher"|"position"|"catcher", position, throws, bats, status, group (camp group id), inCamp:"in"|"out"} */
  function filterPool(pool, f, camp) {
    f = f || {};
    const tokens = str(f.q).toLowerCase().replace(/#/g, " ").split(/[\s,]+/).filter(Boolean);
    const inCamp = camp ? new Set(camp.players) : new Set();
    const grp = camp && f.group ? camp.groups.find((g) => g.id === f.group) : null;
    const gset = grp ? new Set(grp.players) : null;
    return pool.filter((p) => {
      if (f.affs && f.affs.length && !f.affs.includes(p.affId)) return false;
      if (f.role === "pitcher" && !p.isPitcher) return false;
      if (f.role === "position" && p.isPitcher) return false;
      if (f.role === "catcher" && !p.isCatcher) return false;
      if (f.position && p.position !== f.position && p.pos2 !== f.position) return false;
      if (f.throws && p.throws !== f.throws) return false;
      if (f.bats && p.bats !== f.bats) return false;
      if (f.status && p.status !== f.status) return false;
      if (gset && !gset.has(p.pid)) return false;
      if (f.inCamp === "in" && !inCamp.has(p.pid)) return false;
      if (f.inCamp === "out" && inCamp.has(p.pid)) return false;
      if (tokens.length) {
        const hay = (p.first + " " + p.last).toLowerCase();
        return tokens.every((t) => (/^\d+$/.test(t) ? p.number === t || p.number.startsWith(t) : hay.split(/\s+/).some((w) => w.startsWith(t)) || hay.includes(t)));
      }
      return true;
    });
  }
  /** a sensible group name for the current filter */
  function filterLabel(f, camp, affiliates) {
    const bits = [];
    if (f.affs && f.affs.length) bits.push(f.affs.map((id) => ((affiliates || []).find((a) => a.id === id) || { short: id.toUpperCase() }).short).join("/"));
    if (f.role === "catcher") bits.push("Catchers"); else if (f.role === "pitcher") bits.push("Pitchers"); else if (f.role === "position") bits.push("Position players");
    if (f.position) bits.push(f.position);
    if (f.throws) bits.push(f.throws + "HP");
    if (f.bats) bits.push("Bats " + f.bats);
    if (f.status) bits.push(f.status);
    if (f.group && camp) { const g = camp.groups.find((x) => x.id === f.group); if (g) bits.push(g.name); }
    if (f.q) bits.push("“" + f.q + "”");
    return bits.join(" · ");
  }

  /* ---------- groups ---------- */
  function addGroup(camp, name, players) {
    const used = new Set(camp.groups.map((g) => g.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[camp.groups.length % GROUP_COLORS.length];
    const g = { id: uid("g"), name: str(name).trim() || "Group " + (camp.groups.length + 1), color, players: uniq(players || []) };
    camp.groups.push(g);
    return g;
  }
  function removeGroup(camp, gid) {
    camp.groups = camp.groups.filter((g) => g.id !== gid);
    camp.draft.activities.forEach((a) => { a.groups = a.groups.filter((x) => x !== gid); });
  }
  const groupsOf = (camp, pid) => camp.groups.filter((g) => g.players.includes(pid));
  /** players an activity puts somewhere: its groups' members plus individuals */
  function resolvePlayers(act, camp) {
    const out = new Set(act.players || []);
    (act.groups || []).forEach((gid) => { const g = camp.groups.find((x) => x.id === gid); if (g) g.players.forEach((p) => out.add(p)); });
    return out;
  }
  function addPlayersToCamp(camp, pids) { const s = new Set(camp.players); let n = 0; pids.forEach((p) => { if (!s.has(p)) { s.add(p); n++; } }); camp.players = Array.from(s); return n; }
  /** removes from the camp and from every camp group and activity (never from a roster) */
  function removePlayersFromCamp(camp, pids) {
    const rm = new Set(pids);
    const before = camp.players.length;
    camp.players = camp.players.filter((p) => !rm.has(p));
    camp.groups.forEach((g) => { g.players = g.players.filter((p) => !rm.has(p)); });
    camp.draft.activities.forEach((a) => { a.players = a.players.filter((p) => !rm.has(p)); });
    return before - camp.players.length;
  }

  /* ---------- activities ---------- */
  function newActivity(o) { return normActivity(Object.assign({ id: uid("a"), title: "New activity", cat: "other", start: 480, dur: 30 }, o || {})); }
  const overlaps = (a, b) => a.start < b.start + b.dur && b.start < a.start + a.dur;
  function duplicateActivity(camp, id) {
    const a = camp.draft.activities.find((x) => x.id === id); if (!a) return null;
    const c = Object.assign(clone(a), { id: uid("a"), start: clamp(a.start + a.dur, 0, 1440 - a.dur) });
    camp.draft.activities.push(c);
    return c;
  }
  function removeActivity(camp, id) { const n = camp.draft.activities.length; camp.draft.activities = camp.draft.activities.filter((a) => a.id !== id); return n !== camp.draft.activities.length; }
  /** copy every activity on `from` to each date in `to`; replace=true clears the target dates first */
  function copyDay(camp, from, to, opts) {
    const replace = !!(opts && opts.replace);
    const src = camp.draft.activities.filter((a) => a.date === from);
    let added = 0, removed = 0;
    (Array.isArray(to) ? to : [to]).filter((d) => isDate(d) && d !== from).forEach((d) => {
      if (replace) { const n = camp.draft.activities.length; camp.draft.activities = camp.draft.activities.filter((a) => a.date !== d); removed += n - camp.draft.activities.length; }
      src.forEach((a) => { camp.draft.activities.push(Object.assign(clone(a), { id: uid("a"), date: d })); added++; });
    });
    return { added, removed };
  }
  function clearDay(camp, date) { const n = camp.draft.activities.length; camp.draft.activities = camp.draft.activities.filter((a) => a.date !== date); return n - camp.draft.activities.length; }

  /* ---------- templates ---------- */
  function templateFromDay(camp, date, name) {
    const fac = (id) => camp.facilities.find((f) => f.id === id);
    return normTemplate({
      id: uid("t"), name: str(name).trim() || "Day template", created: new Date().toISOString(),
      source: { campId: camp.id, campName: camp.name, date },
      activities: activitiesOn(camp.draft.activities, date).map((a) => {
        const f = fac(a.facilityId);
        return { title: a.title, cat: a.cat, start: a.start, dur: a.dur, notes: a.notes,
          facilityId: f ? f.id : null, facilityName: f ? f.name : "", facilityType: f ? f.type : "",
          groups: a.groups.map((gid) => camp.groups.find((g) => g.id === gid)).filter(Boolean).map((g) => ({ id: g.id, name: g.name })),
          staff: a.staff.map((sid) => camp.staff.find((s) => s.id === sid)).filter(Boolean).map((s) => ({ id: s.id, name: s.name })),
          players: a.players.slice() };
      })
    });
  }
  /** Facilities match by id (same camp), then by name, then by type; groups and staff by id, then name.
      Individual players carry over only if they are in this camp. Unmatched items are reported. */
  function applyTemplate(camp, tpl, date, opts) {
    const replace = !!(opts && opts.replace);
    const lc = (s) => str(s).trim().toLowerCase();
    const report = { added: 0, removed: 0, facilities: [], groups: [], staff: [], players: 0 };
    if (replace) report.removed = clearDay(camp, date);
    const inCamp = new Set(camp.players);
    (tpl.activities || []).forEach((t) => {
      let f = camp.facilities.find((x) => x.id === t.facilityId) || camp.facilities.find((x) => t.facilityName && lc(x.name) === lc(t.facilityName))
        || camp.facilities.find((x) => t.facilityType && x.type === t.facilityType);
      if (!f && (t.facilityName || t.facilityId)) report.facilities.push(t.facilityName || "(facility)");
      const groups = [];
      (t.groups || []).forEach((g) => {
        const m = camp.groups.find((x) => x.id === g.id) || camp.groups.find((x) => lc(x.name) === lc(g.name));
        if (m) groups.push(m.id); else report.groups.push(g.name);
      });
      const staff = [];
      (t.staff || []).forEach((s) => {
        const m = camp.staff.find((x) => x.id === s.id) || camp.staff.find((x) => lc(x.name) === lc(s.name));
        if (m) staff.push(m.id); else report.staff.push(s.name);
      });
      const players = (t.players || []).filter((p) => inCamp.has(p));
      report.players += (t.players || []).length - players.length;
      camp.draft.activities.push(newActivity({ date, title: t.title, cat: t.cat, start: t.start, dur: t.dur, notes: t.notes, facilityId: f ? f.id : null, groups, staff, players }));
      report.added++;
    });
    report.facilities = uniq(report.facilities); report.groups = uniq(report.groups); report.staff = uniq(report.staff);
    return report;
  }

  /* ---------- lanes: side-by-side layout for overlapping blocks in one column ---------- */
  function layoutLanes(acts) {
    const list = acts.slice().sort((a, b) => a.start - b.start || b.dur - a.dur);
    const out = {};
    let cluster = [], clusterEnd = -1, laneEnds = [];
    const flush = () => { const n = laneEnds.length || 1; cluster.forEach((id) => { out[id].lanes = n; }); cluster = []; laneEnds = []; };
    list.forEach((a) => {
      if (a.start >= clusterEnd) { flush(); clusterEnd = -1; }
      let lane = laneEnds.findIndex((e) => e <= a.start);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = a.start + a.dur;
      out[a.id] = { lane, lanes: 1 };
      cluster.push(a.id);
      clusterEnd = Math.max(clusterEnd, a.start + a.dur);
    });
    flush();
    return out;
  }

  /* ---------- conflicts ----------
     error   = a real clash: a player or staff member in two places, a facility double-booked or over capacity.
     warning = worth knowing, not a clash: no facility, nobody assigned, a player who isn't in the camp
               (or no longer on any roster), a facility with no capacity set. Saving is never blocked. */
  function conflicts(camp, opts) {
    const o = opts || {};
    const acts = o.activities || camp.draft.activities;
    const index = o.index || null;
    const nameOf = o.nameOf || ((pid) => (index && index.get(pid) ? index.get(pid).name : pid));
    const staffName = (sid) => { const s = camp.staff.find((x) => x.id === sid); return s ? s.name : "Staff member"; };
    const facById = new Map(camp.facilities.map((f) => [f.id, f]));
    const inCamp = new Set(camp.players);
    const out = [], seen = new Set();
    const push = (c) => { const key = c.kind + "|" + c.ids.slice().sort().join(",") + "|" + (c.sub || ""); if (seen.has(key)) return; seen.add(key); c.key = key; out.push(c); };
    const dates = o.date ? [o.date] : uniq(acts.map((a) => a.date)).sort();
    dates.forEach((date) => {
      const day = activitiesOn(acts, date);
      const res = new Map(day.map((a) => [a.id, resolvePlayers(a, camp)]));
      // people in two places at once
      for (let i = 0; i < day.length; i++) for (let j = i + 1; j < day.length; j++) {
        const a = day[i], b = day[j];
        if (!overlaps(a, b)) continue;
        const both = Array.from(res.get(a.id)).filter((p) => res.get(b.id).has(p));
        if (both.length) {
          const names = both.map(nameOf).sort();
          push({ level: "error", kind: "player", date, ids: [a.id, b.id], players: both,
            msg: (both.length === 1 ? names[0] + " is" : both.length + " players are") + " in both " + a.title + " (" + fmtSpan(a.start, a.dur) + ") and " + b.title + " (" + fmtSpan(b.start, b.dur) + ")",
            detail: both.length > 1 ? names.join(", ") : "" });
        }
        const st = a.staff.filter((s) => b.staff.includes(s));
        if (st.length) push({ level: "error", kind: "staff", date, ids: [a.id, b.id], staff: st,
          msg: st.map(staffName).join(", ") + (st.length === 1 ? " is" : " are") + " assigned to both " + a.title + " and " + b.title + " at " + fmtTime(Math.max(a.start, b.start)) });
      }
      // facilities: activities at once, and headcount
      const byFac = {};
      day.forEach((a) => { if (a.facilityId && facById.has(a.facilityId)) (byFac[a.facilityId] = byFac[a.facilityId] || []).push(a); });
      Object.keys(byFac).forEach((fid) => {
        const f = facById.get(fid), list = byFac[fid];
        const points = uniq(list.map((a) => a.start)).sort((x, y) => x - y);
        points.forEach((t) => {
          const active = list.filter((a) => a.start <= t && t < a.start + a.dur);
          if (f.concurrent && active.length > f.concurrent) {
            push({ level: "error", kind: "facility", date, ids: active.map((a) => a.id), facilityId: fid,
              msg: f.name + " is double-booked at " + fmtTime(t) + ": " + active.map((a) => a.title).join(" + ") + (f.concurrent > 1 ? " (" + active.length + " activities, limit " + f.concurrent + ")" : "") });
          }
          if (f.capacity) {
            const heads = new Set(); active.forEach((a) => res.get(a.id).forEach((p) => heads.add(p)));
            if (heads.size > f.capacity) push({ level: "error", kind: "capacity", date, ids: active.map((a) => a.id), facilityId: fid, sub: String(heads.size),
              msg: f.name + " is over capacity at " + fmtTime(t) + ": " + heads.size + " players, capacity " + f.capacity });
          }
        });
        if (!f.capacity && list.some((a) => res.get(a.id).size)) push({ level: "warning", kind: "nocapacity", date, ids: list.map((a) => a.id), facilityId: fid, sub: fid,
          msg: f.name + " has no capacity set — headcount isn't checked there", per: false });
      });
      // per-activity notes
      day.forEach((a) => {
        if (!a.facilityId || !facById.has(a.facilityId)) push({ level: "warning", kind: "nofacility", date, ids: [a.id], msg: a.title + " (" + fmtSpan(a.start, a.dur) + ") has no facility" });
        const r = res.get(a.id);
        if (!r.size) push({ level: "warning", kind: "empty", date, ids: [a.id], msg: a.title + " (" + fmtSpan(a.start, a.dur) + ") has no players assigned" });
        const out1 = Array.from(r).filter((p) => !inCamp.has(p));
        if (out1.length) push({ level: "warning", kind: "notincamp", date, ids: [a.id], players: out1,
          msg: (out1.length === 1 ? nameOf(out1[0]) + " isn't" : out1.length + " players aren't") + " in the camp's participants (" + a.title + ")" });
        if (index) {
          const gone = Array.from(r).filter((p) => !index.has(p));
          if (gone.length) push({ level: "warning", kind: "unknown", date, ids: [a.id], players: gone,
            msg: gone.length + " player" + (gone.length === 1 ? " is" : "s are") + " no longer on any affiliate roster (" + a.title + ")" });
        }
      });
    });
    out.sort((x, y) => (x.level === y.level ? 0 : x.level === "error" ? -1 : 1) || x.date.localeCompare(y.date));
    return out;
  }
  /** per activity: {errors:[...], warnings:[...]} (facility-wide "no capacity" notes stay in the list only) */
  function conflictsByActivity(list) {
    const m = {};
    list.forEach((c) => {
      if (c.kind === "nocapacity") return;
      c.ids.forEach((id) => { const e = (m[id] = m[id] || { errors: [], warnings: [] }); (c.level === "error" ? e.errors : e.warnings).push(c); });
    });
    return m;
  }

  /* ---------- draft → published ---------- */
  function snapshot(camp) {
    return { activities: clone(camp.draft.activities), groups: clone(camp.groups), facilities: clone(camp.facilities), staff: clone(camp.staff) };
  }
  const stable = (s) => JSON.stringify({
    activities: s.activities.slice().sort((a, b) => a.id.localeCompare(b.id)),
    groups: s.groups.slice().sort((a, b) => a.id.localeCompare(b.id)).map((g) => Object.assign({}, g, { players: g.players.slice().sort() })),
    facilities: s.facilities, staff: s.staff
  });
  function hasUnpublished(camp) {
    if (!camp.published) return camp.draft.activities.length > 0;
    return stable(snapshot(camp)) !== stable(camp.published);
  }
  const FIELD_LABEL = { title: "title", cat: "category", facilityId: "facility", date: "date", start: "start", dur: "length", groups: "groups", players: "players", staff: "staff", notes: "notes" };
  function diffPublished(camp) {
    const pub = camp.published || { activities: [], groups: [], facilities: [], staff: [] };
    const before = new Map(pub.activities.map((a) => [a.id, a]));
    const after = new Map(camp.draft.activities.map((a) => [a.id, a]));
    const same = (x, y) => JSON.stringify(Array.isArray(x) ? x.slice().sort() : x) === JSON.stringify(Array.isArray(y) ? y.slice().sort() : y);
    const added = [], removed = [], changed = [];
    after.forEach((a, id) => {
      const b = before.get(id);
      if (!b) { added.push(a); return; }
      const fields = Object.keys(FIELD_LABEL).filter((k) => !same(a[k], b[k]));
      if (fields.length) changed.push({ id, before: b, after: a, fields, labels: fields.map((k) => FIELD_LABEL[k]) });
    });
    before.forEach((b, id) => { if (!after.has(id)) removed.push(b); });
    const gB = new Map(pub.groups.map((g) => [g.id, g])), gA = new Map(camp.groups.map((g) => [g.id, g]));
    const groups = { added: [], removed: [], changed: [] };
    gA.forEach((g, id) => { const b = gB.get(id); if (!b) groups.added.push(g.name); else if (b.name !== g.name || !same(b.players, g.players)) groups.changed.push(g.name); });
    gB.forEach((g, id) => { if (!gA.has(id)) groups.removed.push(g.name); });
    const facilitiesChanged = JSON.stringify(pub.facilities) !== JSON.stringify(camp.facilities);
    const staffChanged = JSON.stringify(pub.staff) !== JSON.stringify(camp.staff);
    const sortAct = (a, b) => a.date.localeCompare(b.date) || a.start - b.start;
    added.sort(sortAct); removed.sort(sortAct); changed.sort((x, y) => sortAct(x.after, y.after));
    const total = added.length + removed.length + changed.length + groups.added.length + groups.removed.length + groups.changed.length + (facilitiesChanged ? 1 : 0) + (staffChanged ? 1 : 0);
    return { added, removed, changed, groups, facilitiesChanged, staffChanged, total, firstPublish: !camp.published };
  }
  function publish(camp, nowIso) { camp.published = Object.assign({ at: nowIso || new Date().toISOString() }, snapshot(camp)); return camp.published; }
  function revertToPublished(camp) {
    if (!camp.published) return false;
    camp.draft.activities = clone(camp.published.activities);
    camp.groups = clone(camp.published.groups);
    camp.facilities = clone(camp.published.facilities);
    camp.staff = clone(camp.published.staff);
    return true;
  }
  /** the version a print/export reads: a camp-shaped view over the published snapshot or the draft */
  function versionView(camp, which) {
    if (which === "published" && camp.published) {
      const p = camp.published;
      return Object.assign({}, camp, { draft: { activities: p.activities }, groups: p.groups, facilities: p.facilities, staff: p.staff, _version: "published", _at: p.at });
    }
    return Object.assign({}, camp, { _version: "draft" });
  }

  /* ---------- per-person and per-facility reads ---------- */
  function itinerary(camp, pid, date) {
    return activitiesOn(camp.draft.activities, date).filter((a) => resolvePlayers(a, camp).has(pid))
      .map((a) => ({ act: a, via: a.players.includes(pid) ? [] : a.groups.map((g) => camp.groups.find((x) => x.id === g)).filter((g) => g && g.players.includes(pid)).map((g) => g.name) }));
  }
  function byStaff(camp, date) {
    const acts = activitiesOn(camp.draft.activities, date);
    return camp.staff.map((s) => ({ staff: s, acts: acts.filter((a) => a.staff.includes(s.id)) }));
  }
  function byFacility(camp, date) {
    const acts = activitiesOn(camp.draft.activities, date);
    const rows = camp.facilities.map((f) => ({ facility: f, acts: acts.filter((a) => a.facilityId === f.id) }));
    const none = acts.filter((a) => !a.facilityId || !camp.facilities.some((f) => f.id === a.facilityId));
    if (none.length) rows.push({ facility: { id: null, name: "No facility", type: "other" }, acts: none });
    return rows;
  }
  const initials = (name) => str(name).trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

  /* ---------- CSV of one day ---------- */
  function dayCSV(camp, date, nameOf) {
    const q = (v) => { const s = str(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const fac = (id) => (camp.facilities.find((f) => f.id === id) || { name: "" }).name;
    const rows = [["Camp", "Date", "Start", "End", "Timezone", "Activity", "Category", "Facility", "Groups", "Players", "Player count", "Staff", "Notes"]];
    activitiesOn(camp.draft.activities, date).forEach((a) => {
      const pl = Array.from(resolvePlayers(a, camp)).map(nameOf || ((x) => x)).sort();
      rows.push([camp.name, date, fmtTime(a.start), fmtTime(a.start + a.dur), camp.tz, a.title, catOf(a.cat).name, fac(a.facilityId),
        a.groups.map((g) => (camp.groups.find((x) => x.id === g) || { name: "" }).name).filter(Boolean).join("; "),
        pl.join("; "), pl.length, a.staff.map((s) => (camp.staff.find((x) => x.id === s) || { name: "" }).name).filter(Boolean).join("; "), a.notes]);
    });
    return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  }

  return {
    STORAGE_KEY, VERSION, DEFAULT_TZ, DEFAULT_WINDOW, CATEGORIES, catOf, ACTIVITY_CATALOGUE, FACILITY_TYPES, FLORIDA_PRESET, presetFacilities,
    PRESET_GROUPS, GROUP_COLORS, COMMON_TZ, uid, clone, clamp, snap,
    isDate, addDays, daysBetween, dateRange, weekday, weekStart, fmtDate, fmtShort, fmtRange, fmtTime, fmtSpan, parseTime, toHHMM,
    isTimeZone, nowIn, tzAbbr, tzCity,
    emptyState, normalizeState, normCamp, loadState, saveState,
    newCamp, campDates, activitiesOn, buildPool, poolIndex, facets, filterPool, filterLabel,
    addGroup, removeGroup, groupsOf, resolvePlayers, addPlayersToCamp, removePlayersFromCamp,
    newActivity, overlaps, duplicateActivity, removeActivity, copyDay, clearDay, templateFromDay, applyTemplate, layoutLanes,
    conflicts, conflictsByActivity, snapshot, hasUnpublished, diffPublished, publish, revertToPublished, versionView,
    itinerary, byStaff, byFacility, initials, dayCSV
  };
});
