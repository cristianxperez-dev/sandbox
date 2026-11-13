/* Manager Hub — Spring Training operations: pure logic (no DOM, no network).

   Operating contexts (camp kinds), exhibition games, the Game Play Matrix (planned vs actual
   participation per player per game), lineups and their review workflow, lineup ↔ plan
   reconciliation, games on the master schedule, and a generic three-way merge used by the
   shared store so two people's edits are combined instead of silently overwritten.

   Data lives in three kinds of shared documents (see st-sync.js and functions/.../api/ops.js):
     camp:<campId>     the camp itself (CampCore shape) — groups, facilities, staff, schedule
     games:<campId>    { games:[Game], plan:{gameId:{pid:PlanCell}}, actual:{gameId:{pid:Actual}} }
     lineup:<gameId>   { gameId, campId, status, current:Lineup|null, published:Lineup|null, rev, history:[] }
   Players are always referenced by the pool id "<affiliate>:<rosterId>" — never copied.

   Browser: global `StCore`. Node: require("./st-core.js"). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const str = (v) => (v == null ? "" : String(v));
  const uniq = (a) => Array.from(new Set(a));
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = (v) => (v === "" || v == null || !Number.isFinite(+v) ? null : +v);
  function uid(p) { return (p || "x") + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
  const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

  /* ---------- operating contexts inside the Complex workspace ---------- */
  const KINDS = [
    { id: "spring", name: "Spring Training", short: "Spring Training", games: true },
    { id: "instructs", name: "Instructional League", short: "Instructs", games: true },
    { id: "offseason", name: "Offseason development", short: "Offseason", games: false },
    { id: "workout", name: "Camp / workouts", short: "Camp", games: false }
  ];
  /** a camp without a stored kind: "Spring Training" in its name reads as spring, anything else as a camp */
  function kindOf(camp) {
    const k = camp && KINDS.find((x) => x.id === camp.kind);
    if (k) return k;
    return /spring\s*training/i.test(str(camp && camp.name)) ? KINDS[0] : KINDS[3];
  }

  /* ---------- positions ---------- */
  const POS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
  const FIELD_POS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
  const POS_NUM = { P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9, DH: "DH" };
  const NUM_POS = { 1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF" };
  /** "ss", "6", "dh", "eh" → canonical ("EH" = extra hitter, bats but doesn't field) */
  function normPos(v) {
    const s = str(v).trim().toUpperCase();
    if (!s) return "";
    if (NUM_POS[s]) return NUM_POS[s];
    if (s === "EH" || s === "XH") return "EH";
    if (s === "PH" || s === "PR") return s;
    return POS.includes(s) ? s : "";
  }

  /* roster status codes that mean "not available to play" — taken as written from the roster (MNROSTERSTATUS_LK) */
  const UNAVAILABLE = { "60D": "60-day injured list", FSIL: "full-season injured list", "7D": "7-day injured list", "10D": "10-day injured list", "15D": "15-day injured list", IL: "injured list" };
  function availability(player) {
    const s = str(player && player.status).toUpperCase();
    if (UNAVAILABLE[s]) return { code: s, label: UNAVAILABLE[s], level: "error" };
    if (s === "RES") return { code: s, label: "reserve list", level: "warning" };
    return null;
  }

  /* ---------- outs / innings pitched ---------- */
  /** "2.1" → 7 outs; 2 → 6; "" → null */
  function outsOf(ip) {
    if (ip === "" || ip == null) return null;
    const s = str(ip).trim(); if (!/^\d+(\.[0-2])?$/.test(s)) return null;
    const [w, f] = s.split("."); return (+w) * 3 + (f ? +f : 0);
  }
  const ipOf = (outs) => (outs == null ? "" : Math.floor(outs / 3) + "." + (outs % 3));

  /* ---------- games ---------- */
  const SIDES = ["home", "away", "intrasquad"];
  const GAME_STATUS = ["scheduled", "final", "canceled"];
  const DEFAULT_FORMAT = { innings: 9, dh: true, extraHitters: 0, reentry: false, pitcherLimit: "", notes: "" };
  function normFormat(f) {
    f = f && typeof f === "object" ? f : {};
    return {
      innings: clamp(Math.round(num(f.innings) || 9), 1, 15), dh: f.dh !== false,
      extraHitters: clamp(Math.round(num(f.extraHitters) || 0), 0, 6), reentry: !!f.reentry,
      pitcherLimit: str(f.pitcherLimit).slice(0, 80), notes: str(f.notes).slice(0, 400)
    };
  }
  function normGame(g) {
    if (!g || typeof g !== "object" || !isDate(g.date)) return null;
    const start = num(g.start);
    return {
      id: str(g.id) || uid("gm"), date: g.date, start: start == null ? null : clamp(Math.round(start), 0, 1435),
      dur: num(g.dur) ? clamp(Math.round(+g.dur), 30, 600) : null,
      opponent: str(g.opponent).trim().slice(0, 80), squad: str(g.squad).trim().slice(0, 60),
      side: SIDES.includes(g.side) ? g.side : "home",
      facilityId: g.facilityId ? str(g.facilityId) : null, site: str(g.site).trim().slice(0, 80),
      format: normFormat(g.format), groups: uniq((Array.isArray(g.groups) ? g.groups : []).filter((x) => typeof x === "string" && x)),
      coaches: uniq((Array.isArray(g.coaches) ? g.coaches : []).filter((x) => typeof x === "string" && x)),
      status: GAME_STATUS.includes(g.status) ? g.status : "scheduled", notes: str(g.notes).slice(0, 600)
    };
  }
  function newGame(o) { return normGame(Object.assign({ id: uid("gm"), start: 13 * 60, side: "home", format: DEFAULT_FORMAT }, o || {})); }
  /** minutes a game holds its site: stated length, else ~20 minutes an inning (9 innings = 3:00) */
  const gameDur = (g) => g.dur || g.format.innings * 20;
  function gameTitle(g) {
    const vs = g.side === "intrasquad" ? "Intrasquad" : (g.side === "away" ? "@ " : "vs ") + (g.opponent || "TBD");
    return (g.squad ? g.squad + " " : "") + vs;
  }

  /* ---------- the games document: plan and actual participation ---------- */
  const ROLES = [
    { id: "start", name: "Starts", short: "Start" },
    { id: "sub", name: "Enters as a sub", short: "Sub" },
    { id: "pitch", name: "Pitches", short: "Pitch" },
    { id: "avail", name: "Available / reserve", short: "Avail" },
    { id: "off", name: "Off (not in this game)", short: "Off" }
  ];
  /** PlanCell: what the staff intends. inn = planned defensive innings (position players);
      outs / pitches = planned workload for a pitcher (stated by the staff, never prescribed here). */
  function normCell(c) {
    if (!c || typeof c !== "object") return null;
    const role = ROLES.some((r) => r.id === c.role) ? c.role : null;
    if (!role) return null;
    const out = { role, pos: normPos(c.pos), inn: num(c.inn) == null ? null : clamp(Math.round(+c.inn), 0, 15),
      outs: num(c.outs) == null ? null : clamp(Math.round(+c.outs), 0, 45), pitches: num(c.pitches) == null ? null : clamp(Math.round(+c.pitches), 0, 200),
      order: num(c.order) == null ? null : clamp(Math.round(+c.order), 1, 15), src: c.src === "lineup" ? "lineup" : "plan",
      rev: num(c.rev), note: str(c.note).slice(0, 200) };
    if (role === "pitch" && !out.pos) out.pos = "P";
    return out;
  }
  /** Actual: what happened, entered after the game (or imported). Never derived from the plan. */
  function normActual(a) {
    if (!a || typeof a !== "object") return null;
    const played = a.played !== false;
    return {
      played, pos: str(a.pos).split(/[\/,\s]+/).map(normPos).filter(Boolean).join("/"),
      inn: num(a.inn) == null ? null : clamp(Math.round(+a.inn), 0, 20), pa: num(a.pa) == null ? null : clamp(Math.round(+a.pa), 0, 12),
      outs: num(a.outs) == null ? null : clamp(Math.round(+a.outs), 0, 60), pitches: num(a.pitches) == null ? null : clamp(Math.round(+a.pitches), 0, 250),
      by: str(a.by).slice(0, 60), at: str(a.at).slice(0, 40), src: a.src === "import" ? "import" : "entry"
    };
  }
  const emptyGamesDoc = () => ({ v: 1, games: [], plan: {}, actual: {} });
  function normGamesDoc(d) {
    const out = emptyGamesDoc();
    if (!d || typeof d !== "object") return out;
    out.games = (Array.isArray(d.games) ? d.games : []).map(normGame).filter(Boolean);
    const ids = new Set(out.games.map((g) => g.id));
    const cells = (src, norm) => {
      const o = {};
      if (!src || typeof src !== "object") return o;
      Object.keys(src).forEach((gid) => {
        if (!ids.has(gid) || !src[gid] || typeof src[gid] !== "object") return;
        const m = {};
        Object.keys(src[gid]).forEach((pid) => { if (!pid.includes(":")) return; const c = norm(src[gid][pid]); if (c) m[pid] = c; });
        o[gid] = m;
      });
      return o;
    };
    out.plan = cells(d.plan, normCell);
    out.actual = cells(d.actual, normActual);
    return out;
  }
  const sortGames = (gs) => gs.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.start == null ? 1e4 : a.start) - (b.start == null ? 1e4 : b.start) || gameTitle(a).localeCompare(gameTitle(b)));
  const cellOf = (doc, gid, pid) => (doc.plan[gid] && doc.plan[gid][pid]) || null;
  const actualOf = (doc, gid, pid) => (doc.actual[gid] && doc.actual[gid][pid]) || null;
  /** set (or clear with null) one plan cell; returns the doc for chaining */
  function setCell(doc, gid, pid, cell) {
    const c = cell == null ? null : normCell(cell);
    if (!c) { if (doc.plan[gid]) { delete doc.plan[gid][pid]; if (!Object.keys(doc.plan[gid]).length) delete doc.plan[gid]; } return doc; }
    (doc.plan[gid] = doc.plan[gid] || {})[pid] = c;
    return doc;
  }
  function setActual(doc, gid, pid, a) {
    const c = a == null ? null : normActual(a);
    if (!c) { if (doc.actual[gid]) { delete doc.actual[gid][pid]; if (!Object.keys(doc.actual[gid]).length) delete doc.actual[gid]; } return doc; }
    (doc.actual[gid] = doc.actual[gid] || {})[pid] = c;
    return doc;
  }
  /** players planned into a game (any role but "off") */
  const plannedIn = (doc, gid) => Object.keys(doc.plan[gid] || {}).filter((pid) => doc.plan[gid][pid].role !== "off");
  const hasActuals = (doc, gid) => !!(doc.actual[gid] && Object.keys(doc.actual[gid]).length);

  /** short text for a matrix cell */
  function cellText(c, isPitcher) {
    if (!c) return "";
    if (c.role === "off") return "OFF";
    if (c.role === "avail") return "Avail";
    if (c.role === "pitch") return "P" + (c.outs != null ? " " + ipOf(c.outs) : "") + (c.pitches != null ? (c.outs != null ? "·" : " ") + c.pitches + "p" : "");
    const pos = c.pos || (isPitcher ? "P" : "");
    const base = (c.role === "sub" ? "↺" : "") + (pos || (c.role === "sub" ? "Sub" : "Start"));
    return base + (c.inn != null ? " " + c.inn : "");
  }
  function actualText(a) {
    if (!a) return "";
    if (!a.played) return "DNP";
    if (a.outs != null || a.pitches != null) return "P " + (a.outs != null ? ipOf(a.outs) : "–") + (a.pitches != null ? "·" + a.pitches + "p" : "");
    return (a.pos || "") + (a.inn != null ? " " + a.inn : "") + (a.pa != null ? " · " + a.pa + " PA" : "");
  }

  /* ---------- summaries (operational, not analytics) ---------- */
  /** games in [from, to] inclusive, sorted */
  const gamesIn = (doc, from, to) => sortGames(doc.games.filter((g) => g.status !== "canceled" && (!from || g.date >= from) && (!to || g.date <= to)));
  /** one player's totals over a set of games.
      "projected" = actual where a game's participation has been recorded, plan where it hasn't (games still to come). */
  function playerSummary(doc, pid, games, today) {
    const s = { pid, gamesPlanned: 0, gamesPlayed: 0, innPlanned: 0, innPlayed: 0, innProjected: 0, pa: 0, positions: {}, catcherInn: 0,
      pitchPlanned: 0, pitchApps: 0, outsPlanned: 0, outsPlayed: 0, pitches: 0, lastOuting: null, nextOuting: null, offs: 0, recorded: 0 };
    games.forEach((g) => {
      const c = cellOf(doc, g.id, pid), a = actualOf(doc, g.id, pid), rec = hasActuals(doc, g.id);
      if (c && c.role === "off") s.offs++;
      if (c && c.role !== "off" && c.role !== "avail") { s.gamesPlanned++; if (c.inn != null) s.innPlanned += c.inn; if (c.role === "pitch") { s.pitchPlanned++; s.outsPlanned += c.outs || 0; if (g.date >= (today || "") && (!s.nextOuting || g.date < s.nextOuting)) s.nextOuting = g.date; } }
      if (rec) s.recorded++;
      if (a && a.played) {
        s.gamesPlayed++;
        if (a.inn != null) { s.innPlayed += a.inn; const ps = a.pos ? a.pos.split("/") : []; if (ps.length) ps.forEach((p) => { s.positions[p] = (s.positions[p] || 0) + a.inn / ps.length; }); if (ps.includes("C")) s.catcherInn += a.inn / ps.length; }
        if (a.pa != null) s.pa += a.pa;
        if (a.outs != null || a.pitches != null) { s.pitchApps++; s.outsPlayed += a.outs || 0; s.pitches += a.pitches || 0; if (!s.lastOuting || g.date > s.lastOuting) s.lastOuting = g.date; }
      }
      // projected innings: what happened where recorded, what's planned where not
      if (rec) { if (a && a.played && a.inn != null) s.innProjected += a.inn; }
      else if (c && c.inn != null && c.role !== "off") s.innProjected += c.inn;
    });
    if (!Object.keys(s.positions).length) games.forEach((g) => { const c = cellOf(doc, g.id, pid); if (c && c.pos && c.inn != null && c.role !== "off" && !hasActuals(doc, g.id)) s.positions[c.pos] = (s.positions[c.pos] || 0) + c.inn; });
    s.daysSinceOuting = s.lastOuting && today ? dayDiff(s.lastOuting, today) : null;
    return s;
  }
  const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  /** position players whose projected innings are under half the median of the players shown (a relative cue, not a rule) */
  function lowPlayingTime(summaries) {
    const med = median(summaries.map((s) => s.innProjected));
    if (!med) return { median: 0, list: [] };
    return { median: med, list: summaries.filter((s) => s.innProjected < med / 2).sort((a, b) => a.innProjected - b.innProjected) };
  }
  /** catcher innings per player, played and still planned */
  function catcherInnings(doc, pids, games) {
    return pids.map((pid) => {
      let played = 0, planned = 0;
      games.forEach((g) => {
        const a = actualOf(doc, g.id, pid), c = cellOf(doc, g.id, pid);
        if (hasActuals(doc, g.id)) { if (a && a.played && a.inn != null && a.pos.split("/").includes("C")) played += a.inn / a.pos.split("/").length; }
        else if (c && c.pos === "C" && c.inn != null && c.role !== "off") planned += c.inn;
      });
      return { pid, played: Math.round(played * 10) / 10, planned };
    }).filter((r) => r.played || r.planned);
  }
  /** planned-vs-actual differences for games whose actuals are in */
  function planVsActual(doc, games) {
    const out = [];
    games.forEach((g) => {
      if (!hasActuals(doc, g.id)) return;
      const pids = uniq(Object.keys(doc.plan[g.id] || {}).concat(Object.keys(doc.actual[g.id] || {})));
      pids.forEach((pid) => {
        const c = cellOf(doc, g.id, pid), a = actualOf(doc, g.id, pid);
        const plannedPlay = c && c.role !== "off" && c.role !== "avail";
        const played = a && a.played;
        if (plannedPlay && !played) out.push({ gid: g.id, pid, kind: "missed", msg: "planned, didn't play" });
        else if (!plannedPlay && played) out.push({ gid: g.id, pid, kind: "extra", msg: "played without a plan" });
        else if (plannedPlay && played && c.inn != null && a.inn != null && c.inn !== a.inn) out.push({ gid: g.id, pid, kind: "innings", msg: "planned " + c.inn + ", played " + a.inn });
        else if (plannedPlay && played && c.role === "pitch" && c.outs != null && a.outs != null && c.outs !== a.outs) out.push({ gid: g.id, pid, kind: "outs", msg: "planned " + ipOf(c.outs) + " IP, threw " + ipOf(a.outs) });
      });
    });
    return out;
  }

  /* ---------- lineups ---------- */
  /** batting slots for a format: 9 with or without DH, plus any extra hitters */
  const slotCount = (format) => 9 + (format && format.extraHitters ? format.extraHitters : 0);
  function normLineup(l) {
    l = l && typeof l === "object" ? l : {};
    const ids = (a) => uniq((Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x.includes(":")));
    const order = (Array.isArray(l.order) ? l.order : []).slice(0, 15).map((o) => (o && typeof o === "object" ? { pid: typeof o.pid === "string" && o.pid.includes(":") ? o.pid : null, pos: normPos(o.pos) } : { pid: null, pos: "" }));
    const pitchers = (Array.isArray(l.pitchers) ? l.pitchers : []).filter((p) => p && typeof p.pid === "string" && p.pid.includes(":")).slice(0, 15)
      .map((p) => ({ pid: p.pid, outs: num(p.outs) == null ? null : clamp(Math.round(+p.outs), 0, 45), pitches: num(p.pitches) == null ? null : clamp(Math.round(+p.pitches), 0, 200), note: str(p.note).slice(0, 120) }));
    const subs = (Array.isArray(l.subs) ? l.subs : []).filter((s) => s && typeof s === "object").slice(0, 40).map((s) => ({
      inning: clamp(Math.round(num(s.inning) || 1), 1, 15), out: typeof s.out === "string" ? s.out : null, in: typeof s.in === "string" ? s.in : null, pos: normPos(s.pos), note: str(s.note).slice(0, 120) }));
    const grid = {};
    if (l.grid && typeof l.grid === "object") Object.keys(l.grid).forEach((pid) => { if (pid.includes(":") && Array.isArray(l.grid[pid])) grid[pid] = l.grid[pid].slice(0, 15).map(normPos); });
    return { rev: num(l.rev) || 0, by: str(l.by).slice(0, 60), at: str(l.at).slice(0, 40), order, pitchers, bench: ids(l.bench), subs, grid, sharedNote: str(l.sharedNote).slice(0, 1000) };
  }
  function newLineup(game, by) {
    const n = slotCount(game.format);
    return normLineup({ by, order: Array.from({ length: n }, () => ({ pid: null, pos: "" })), pitchers: [], bench: [], subs: [], grid: {} });
  }
  /** every player a lineup uses, with how */
  function lineupPlayers(l) {
    const m = new Map();
    l.order.forEach((o, i) => { if (o.pid) m.set(o.pid, { pid: o.pid, role: "start", pos: o.pos, order: i + 1 }); });
    l.pitchers.forEach((p, i) => { const e = m.get(p.pid); if (e) { e.pitch = { outs: p.outs, pitches: p.pitches, starter: i === 0 }; } else m.set(p.pid, { pid: p.pid, role: "pitch", pos: "P", starter: i === 0, outs: p.outs, pitches: p.pitches }); });
    l.bench.forEach((pid) => { if (!m.has(pid)) m.set(pid, { pid, role: "sub", pos: "" }); });
    l.subs.forEach((s) => { if (s.in && !m.has(s.in)) m.set(s.in, { pid: s.in, role: "sub", pos: s.pos }); });
    return m;
  }
  /** defensive innings a lineup implies for one player, from the innings grid if it's filled in */
  function gridInnings(l, pid, innings) {
    const row = l.grid[pid]; if (!row) return null;
    const used = row.slice(0, innings).filter((p) => p && p !== "DH" && p !== "EH" && p !== "PH" && p !== "PR");
    return row.slice(0, innings).some(Boolean) ? used.length : null;
  }
  /** checks a lineup; nothing here blocks saving a draft. level: error | warning | info */
  function checkLineup(l, game, ctx) {
    ctx = ctx || {};
    const issues = [], fmt = game.format, nameOf = ctx.nameOf || ((p) => p);
    const filled = l.order.filter((o) => o.pid);
    const need = slotCount(fmt);
    if (filled.length < 9) issues.push({ level: "warning", kind: "order", msg: filled.length + " of " + need + " batting spots filled" });
    const dupe = filled.map((o) => o.pid).filter((p, i, a) => a.indexOf(p) !== i);
    uniq(dupe).forEach((p) => issues.push({ level: "error", kind: "dupe", pid: p, msg: nameOf(p) + " bats twice" }));
    const posCount = {}; filled.forEach((o) => { if (o.pos) posCount[o.pos] = (posCount[o.pos] || 0) + 1; });
    Object.keys(posCount).forEach((p) => { if (posCount[p] > 1 && p !== "EH" && p !== "DH") issues.push({ level: "error", kind: "pos", msg: posCount[p] + " players at " + p }); });
    if (posCount.DH > 1) issues.push({ level: "error", kind: "pos", msg: posCount.DH + " designated hitters" });
    if (!fmt.dh && posCount.DH) issues.push({ level: "warning", kind: "dh", msg: "DH used, but this game is set to no DH" });
    if (posCount.EH > fmt.extraHitters) issues.push({ level: "warning", kind: "eh", msg: posCount.EH + " extra hitters; the game allows " + fmt.extraHitters });
    const fielded = new Set(filled.map((o) => o.pos));
    if (filled.length >= 9) FIELD_POS.filter((p) => p !== "P").forEach((p) => { if (!fielded.has(p)) issues.push({ level: "warning", kind: "missing", msg: "No one at " + p }); });
    filled.forEach((o, i) => { if (!o.pos) issues.push({ level: "warning", kind: "nopos", pid: o.pid, msg: "Spot " + (i + 1) + " (" + nameOf(o.pid) + ") has no position" }); });
    if (!l.pitchers.length) issues.push({ level: "warning", kind: "sp", msg: "No starting pitcher" });
    if (fielded.has("P") && l.pitchers.length && !filled.some((o) => o.pos === "P" && o.pid === l.pitchers[0].pid)) issues.push({ level: "warning", kind: "sp", msg: "The pitcher batting isn't the starting pitcher" });
    const used = lineupPlayers(l);
    if (ctx.player) used.forEach((u, pid) => {
      const p = ctx.player(pid);
      if (!p) { issues.push({ level: "warning", kind: "unknown", pid, msg: "A player is no longer on any roster" }); return; }
      const av = availability(p);
      if (av) issues.push({ level: av.level, kind: "status", pid, msg: p.name + " is on the " + av.label });
    });
    l.subs.forEach((s) => { if (s.inning > fmt.innings) issues.push({ level: "warning", kind: "sub", msg: "A substitution is planned for inning " + s.inning + " of a " + fmt.innings + "-inning game" }); });
    return issues;
  }
  /** lineup vs the Game Play Matrix plan for the same game — both views show these; nothing is overwritten */
  function compareToPlan(l, doc, game, ctx) {
    ctx = ctx || {};
    const nameOf = ctx.nameOf || ((p) => p), out = [];
    const used = lineupPlayers(l), plan = doc.plan[game.id] || {};
    used.forEach((u, pid) => {
      const c = plan[pid];
      if (!c || c.role === "off") out.push({ level: "warning", kind: "notplanned", pid, msg: nameOf(pid) + (c ? " is planned OFF for this game" : " isn't in the game plan") });
      else if (u.role === "start" && c.role === "start" && c.pos && u.pos && c.pos !== u.pos) out.push({ level: "info", kind: "pos", pid, msg: nameOf(pid) + ": plan " + c.pos + ", lineup " + u.pos });
      else if (u.role === "start" && (c.role === "sub" || c.role === "avail")) out.push({ level: "info", kind: "role", pid, msg: nameOf(pid) + " starts in the lineup; the plan has them as " + (c.role === "sub" ? "a sub" : "available") });
    });
    Object.keys(plan).forEach((pid) => {
      const c = plan[pid];
      if ((c.role === "start" || c.role === "pitch") && !used.has(pid)) out.push({ level: "warning", kind: "missing", pid, msg: nameOf(pid) + " is planned to " + (c.role === "pitch" ? "pitch" : "start") + " but isn't in the lineup" });
    });
    // the same player planned in another game that overlaps this one
    if (ctx.games) used.forEach((u, pid) => {
      ctx.games.forEach((g2) => {
        if (g2.id === game.id || g2.date !== game.date || g2.status === "canceled") return;
        if (game.start == null || g2.start == null) return;
        const a0 = game.start, a1 = a0 + gameDur(game), b0 = g2.start, b1 = b0 + gameDur(g2);
        const c2 = cellOf(doc, g2.id, pid);
        if (a0 < b1 && b0 < a1 && c2 && c2.role !== "off") out.push({ level: "error", kind: "overlap", pid, msg: nameOf(pid) + " is also planned in " + gameTitle(g2) + " at the same time" });
      });
    });
    return out;
  }
  /** what approving this lineup would write into the plan: [{pid, before, after}] plus players the plan has that the lineup doesn't */
  function lineupToPlan(l, doc, game) {
    const used = lineupPlayers(l), plan = doc.plan[game.id] || {}, changes = [];
    used.forEach((u, pid) => {
      const before = plan[pid] || null;
      const gi = gridInnings(l, pid, game.format.innings);
      const after = normCell(u.role === "pitch" || (u.pitch && u.role !== "start")
        ? { role: "pitch", pos: "P", outs: u.outs != null ? u.outs : (u.pitch ? u.pitch.outs : null), pitches: u.pitches != null ? u.pitches : (u.pitch ? u.pitch.pitches : null), src: "lineup", rev: l.rev, note: before ? before.note : "" }
        : { role: u.role, pos: u.pos || (before && before.pos) || "", order: u.order || null, inn: gi != null ? gi : (before && before.inn != null ? before.inn : null),   // never assumes a starter plays the whole game
            outs: u.pitch ? u.pitch.outs : null, pitches: u.pitch ? u.pitch.pitches : null, src: "lineup", rev: l.rev, note: before ? before.note : "" });
      const same = before && ["role", "pos", "inn", "outs", "pitches", "order"].every((k) => before[k] === after[k]);
      if (!same) changes.push({ pid, before, after });
    });
    const dropped = Object.keys(plan).filter((pid) => !used.has(pid) && plan[pid].role !== "off" && plan[pid].role !== "avail");
    return { changes, dropped };
  }
  function applyLineupToPlan(doc, l, game, opts) {
    const r = lineupToPlan(l, doc, game);
    r.changes.forEach((c) => setCell(doc, game.id, c.pid, c.after));
    if (opts && opts.dropRemoved) r.dropped.forEach((pid) => setCell(doc, game.id, pid, Object.assign({}, cellOf(doc, game.id, pid), { role: "off", inn: null })));
    return r;
  }

  /* ---------- lineup review workflow ----------
     A coach's working draft is private (it stays in their browser). Submitting puts it in the shared
     lineup document. Coordinators approve, return or publish. A published lineup stays published while a
     revision is reviewed: `published` only changes when a coordinator publishes again. */
  const LSTATUS = { none: "Not started", draft: "Draft", submitted: "Submitted", returned: "Returned", approved: "Approved", published: "Published" };
  const emptyLineupDoc = (gameId, campId) => ({ v: 1, gameId, campId, status: "none", rev: 0, current: null, published: null, publishedAt: null, history: [] });
  function normLineupDoc(d, gameId, campId) {
    const o = emptyLineupDoc(gameId, campId);
    if (!d || typeof d !== "object") return o;
    o.status = ["none", "submitted", "returned", "approved", "published"].includes(d.status) ? d.status : "none";
    o.rev = num(d.rev) || 0;
    o.current = d.current ? normLineup(d.current) : null;
    o.published = d.published ? normLineup(d.published) : null;
    o.publishedAt = str(d.publishedAt) || null;
    o.history = (Array.isArray(d.history) ? d.history : []).slice(-80).map((x) => ({ rev: num(x.rev) || 0, action: str(x.action), by: str(x.by).slice(0, 60), at: str(x.at), note: str(x.note).slice(0, 400) }));
    return o;
  }
  const COORD_ACTIONS = ["approve", "publish", "return"];
  /** apply one workflow action; returns {ok, doc} or {ok:false, error}. Pure: the input doc is not changed. */
  function transition(doc, action, o) {
    o = o || {};
    const d = clone(doc), at = o.at || new Date().toISOString(), by = str(o.by) || "Unknown";
    const log = (note) => d.history.push({ rev: d.rev, action, by, at, note: str(note || o.note) });
    if (action === "submit") {
      if (!o.lineup) return { ok: false, error: "no-lineup" };
      d.rev += 1; d.current = normLineup(Object.assign({}, o.lineup, { rev: d.rev, by, at })); d.status = "submitted"; log(); return { ok: true, doc: d };
    }
    if (!d.current) return { ok: false, error: "nothing-submitted" };
    if (action === "approve") { if (!["submitted", "returned"].includes(d.status)) return { ok: false, error: "not-submitted" }; d.status = "approved"; log(); return { ok: true, doc: d }; }
    if (action === "return") { if (!["submitted", "approved"].includes(d.status)) return { ok: false, error: "not-submitted" }; d.status = "returned"; log(); return { ok: true, doc: d }; }
    if (action === "publish") { if (!["approved", "submitted"].includes(d.status)) return { ok: false, error: "not-approved" }; d.status = "published"; d.published = clone(d.current); d.publishedAt = at; log(); return { ok: true, doc: d }; }
    return { ok: false, error: "unknown-action" };
  }
  /** the lineup everyone outside the review should read: the published one, else nothing */
  const officialLineup = (doc) => (doc && doc.published) || null;

  /* ---------- games on the master schedule ---------- */
  /** a game shaped like a camp activity, for the facility grid and conflict checks */
  function gameActivity(g, doc) {
    return { id: "game:" + g.id, game: true, date: g.date, title: gameTitle(g), cat: "other", facilityId: g.facilityId,
      start: g.start == null ? 13 * 60 : g.start, dur: gameDur(g), groups: [], players: plannedIn(doc, g.id), staff: g.coaches.slice(), notes: g.notes };
  }
  /** player / facility / staff clashes between games and the day's activities (and between games) */
  function scheduleConflicts(camp, doc, date, opts) {
    opts = opts || {};
    const nameOf = opts.nameOf || ((p) => p), out = [];
    const games = doc.games.filter((g) => g.date === date && g.status !== "canceled" && g.start != null).map((g) => gameActivity(g, doc));
    if (!games.length) return out;
    const acts = (opts.activities || camp.draft.activities).filter((a) => a.date === date);
    const resolve = (a) => { const s = new Set(a.players); (a.groups || []).forEach((gid) => { const g = camp.groups.find((x) => x.id === gid); if (g) g.players.forEach((p) => s.add(p)); }); return s; };
    const ov = (a, b) => a.start < b.start + b.dur && b.start < a.start + a.dur;
    games.forEach((g, i) => {
      const gp = new Set(g.players);
      acts.forEach((a) => {
        if (!ov(g, a)) return;
        const both = Array.from(resolve(a)).filter((p) => gp.has(p));
        if (both.length) out.push({ level: "error", kind: "game-player", date, ids: [g.id, a.id], players: both,
          msg: (both.length === 1 ? nameOf(both[0]) + " is" : both.length + " players are") + " planned in " + g.title + " and scheduled for " + a.title + " at the same time" });
        if (g.facilityId && a.facilityId === g.facilityId) out.push({ level: "error", kind: "game-facility", date, ids: [g.id, a.id], msg: a.title + " is on the same field as " + g.title });
        const st = a.staff.filter((s) => g.staff.includes(s));
        if (st.length) out.push({ level: "warning", kind: "game-staff", date, ids: [g.id, a.id], msg: "A coach assigned to " + g.title + " is also on " + a.title });
      });
      games.slice(i + 1).forEach((g2) => {
        if (!ov(g, g2)) return;
        const both = g2.players.filter((p) => gp.has(p));
        if (both.length) out.push({ level: "error", kind: "game-game", date, ids: [g.id, g2.id], players: both, msg: (both.length === 1 ? nameOf(both[0]) + " is" : both.length + " players are") + " planned in two games at once (" + g.title + ", " + g2.title + ")" });
        if (g.facilityId && g.facilityId === g2.facilityId) out.push({ level: "error", kind: "game-facility", date, ids: [g.id, g2.id], msg: g.title + " and " + g2.title + " share a field" });
      });
    });
    return out;
  }
  /** players planned in a game who are on an injured list (roster status as written) */
  function availabilityConflicts(doc, games, player) {
    const out = [];
    games.forEach((g) => plannedIn(doc, g.id).forEach((pid) => {
      const p = player(pid); const av = p && availability(p);
      if (av) out.push({ level: av.level, kind: "status", gid: g.id, pid, msg: p.name + " (" + av.label + ") is planned in " + gameTitle(g) + " on " + g.date });
    }));
    return out;
  }

  /* ---------- three-way merge ----------
     base = the version both sides started from, mine = local edits, theirs = what's on the server now.
     A side that didn't change a value takes the other side's change. Objects merge key by key, arrays of
     {id} merge item by item, arrays of strings merge as sets. When both changed the same value
     differently, the server's value is kept and the clash is reported (never silently dropped). */
  function deepEq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == b && (a === undefined || a === null) && (b === undefined || b === null);
    if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return false;
    if (typeof a !== "object") return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]));
  }
  const isIdList = (a) => Array.isArray(a) && a.every((x) => x && typeof x === "object" && typeof x.id === "string");
  const isStrList = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  function merge3(base, mine, theirs, path, conflicts) {
    conflicts = conflicts || []; path = path || "";
    if (deepEq(mine, theirs)) return { value: clone(mine), conflicts };
    if (deepEq(mine, base)) return { value: clone(theirs), conflicts };
    if (deepEq(theirs, base)) return { value: clone(mine), conflicts };
    // both sides changed this value
    if (isObj(mine) && isObj(theirs)) {
      const b = isObj(base) ? base : {}, out = {};
      uniq(Object.keys(b).concat(Object.keys(mine), Object.keys(theirs))).forEach((k) => {
        const r = merge3(b[k], mine[k], theirs[k], path + "." + k, conflicts).value;
        if (r !== undefined) out[k] = r;
      });
      return { value: out, conflicts };
    }
    const lists = [base, mine, theirs].filter((x) => x !== undefined && x !== null);
    if (lists.every(isStrList) && Array.isArray(mine) && Array.isArray(theirs)) {
      const b = new Set(Array.isArray(base) ? base : []), m = new Set(mine), t = new Set(theirs);
      const out = theirs.filter((x) => !(b.has(x) && !m.has(x)));   // keep theirs unless I removed it
      mine.forEach((x) => { if (!b.has(x) && !t.has(x)) out.push(x); });   // add what I added
      return { value: uniq(out), conflicts };
    }
    if (lists.every(isIdList) && Array.isArray(mine) && Array.isArray(theirs)) {
      const bm = new Map((Array.isArray(base) ? base : []).map((x) => [x.id, x])), mm = new Map(mine.map((x) => [x.id, x])), tm = new Map(theirs.map((x) => [x.id, x]));
      const out = [];
      theirs.forEach((t) => {
        const b = bm.get(t.id), m = mm.get(t.id);
        if (!m && b) {   // I deleted it
          if (deepEq(t, b)) return;
          conflicts.push({ path: path + "[" + t.id + "]", kind: "deleted-but-changed", label: t.title || t.name || t.id });   // they changed what I deleted: keep theirs
          out.push(clone(t)); return;
        }
        out.push(m ? merge3(b, m, t, path + "[" + t.id + "]", conflicts).value : clone(t));
      });
      mine.forEach((m) => {
        if (tm.has(m.id)) return;
        const b = bm.get(m.id);
        if (!b) { out.push(clone(m)); return; }   // I added it
        if (!deepEq(m, b)) { conflicts.push({ path: path + "[" + m.id + "]", kind: "changed-but-deleted", label: m.title || m.name || m.id }); out.push(clone(m)); }   // they deleted what I changed: keep mine
      });
      return { value: out, conflicts };
    }
    conflicts.push({ path, kind: "both-changed", mine: clone(mine), theirs: clone(theirs) });
    return { value: clone(theirs), conflicts };
  }

  /* ---------- exports ---------- */
  const q = (v) => { const s = str(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  /** the matrix as CSV: one row per player, one column per game (plan, and actual where recorded) */
  function matrixCSV(doc, games, players, opts) {
    opts = opts || {};
    const head = ["Player", "Affiliate", "Position"].concat(games.map((g) => g.date + " " + gameTitle(g))).concat(["Games planned", "Games played", "Innings planned", "Innings played", "PA", "IP", "Pitches"]);
    const rows = [head];
    players.forEach((p) => {
      const s = playerSummary(doc, p.pid, games, opts.today);
      rows.push([p.name, p.aff, p.position].concat(games.map((g) => {
        const c = cellOf(doc, g.id, p.pid), a = actualOf(doc, g.id, p.pid);
        const plan = cellText(c, p.isPitcher), act = hasActuals(doc, g.id) ? actualText(a) || "DNP" : "";
        return act ? plan + (plan ? " → " : "") + act : plan;
      })).concat([s.gamesPlanned, s.gamesPlayed, s.innPlanned, s.innPlayed, s.pa, ipOf(s.outsPlayed), s.pitches]));
    });
    return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  }
  /** Actuals from a CSV a club's game report can produce: Player (name) or Id, IN/Innings, PA, POS, IP, Pitches.
      Returns {rows:[{pid, actual}], unmatched:[name]} — the caller reviews before writing. */
  function actualsFromCSV(text, players) {
    const lines = str(text).replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (lines.length < 2) return { rows: [], unmatched: [], error: "empty" };
    const split = (l) => { const out = []; let cur = "", qd = false; for (const ch of l) { if (ch === '"') qd = !qd; else if (ch === "," && !qd) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
    const head = split(lines[0]).map((x) => x.toLowerCase());
    const col = (re) => head.findIndex((x) => re.test(x));
    const cName = col(/^(player|name)$/), cId = col(/^(id|pid)$/), cInn = col(/^(in|inn|innings|def ?inn)$/), cPa = col(/^pa$/), cPos = col(/^(pos|position)$/), cIp = col(/^ip$/), cP = col(/^(pitches|pc|np)$/);
    if (cName < 0 && cId < 0) return { rows: [], unmatched: [], error: "no-player-column" };
    const norm = (s) => str(s).toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    const byName = new Map(); players.forEach((p) => { [p.name, p.last + " " + p.first, p.last + ", " + p.first].forEach((n) => { const k = norm(n); byName.set(k, byName.has(k) && byName.get(k) !== p.pid ? "AMBIG" : p.pid); }); });
    const rows = [], unmatched = [];
    lines.slice(1).forEach((l) => {
      const c = split(l);
      let pid = cId >= 0 && players.some((p) => p.pid === c[cId]) ? c[cId] : null;
      if (!pid && cName >= 0) { const m = byName.get(norm(c[cName])); if (m && m !== "AMBIG") pid = m; }
      if (!pid) { unmatched.push(cName >= 0 ? c[cName] : c[cId]); return; }
      rows.push({ pid, actual: normActual({ played: true, pos: cPos >= 0 ? c[cPos] : "", inn: cInn >= 0 ? c[cInn] : null, pa: cPa >= 0 ? c[cPa] : null, outs: cIp >= 0 ? outsOf(c[cIp]) : null, pitches: cP >= 0 ? c[cP] : null, src: "import" }) });
    });
    return { rows, unmatched };
  }

  return {
    KINDS, kindOf, POS, FIELD_POS, POS_NUM, normPos, availability, UNAVAILABLE, outsOf, ipOf,
    SIDES, DEFAULT_FORMAT, normFormat, normGame, newGame, gameDur, gameTitle, sortGames, gamesIn,
    ROLES, normCell, normActual, emptyGamesDoc, normGamesDoc, cellOf, actualOf, setCell, setActual, plannedIn, hasActuals, cellText, actualText,
    playerSummary, median, lowPlayingTime, catcherInnings, planVsActual,
    slotCount, normLineup, newLineup, lineupPlayers, gridInnings, checkLineup, compareToPlan, lineupToPlan, applyLineupToPlan,
    LSTATUS, emptyLineupDoc, normLineupDoc, transition, COORD_ACTIONS, officialLineup,
    gameActivity, scheduleConflicts, availabilityConflicts,
    deepEq, merge3, matrixCSV, actualsFromCSV, dayDiff, uid, clone
  };
});
