/* NMSBSBL — pitch data, pure (no DOM): Statcast CSV → pitches → arsenal. Browser: window.NMS_CORE; Node: require().

   Conventions (AGORA's, unchanged):
     IVB  induced vertical break, inches = 12 × pfx_z (gravity removed; + = rise relative to a spinless pitch)
     HB   horizontal break, inches, PITCHER'S VIEW = −12 × pfx_x (Statcast records pfx_x from the catcher's view).
          + = toward third base: a right-hander's arm side, a left-hander's glove side. Never mirrored.
     RelX release side, ft, pitcher's view = −release_pos_x (+ = toward third base); RelZ release height, ft.
     Pitch types are Statcast's codes (pitch_type); names and colours come from AGORA's palette (lib/pitch-types.js).
   Nothing is estimated: a value Statcast didn't record stays missing and is excluded from that average only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NMS_CORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const num = (v) => { if (v == null || v === "" || v === "NA" || v === "null") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const EXCLUDE = new Set(["PO", "IN", ""]);   // pitchouts and intentional balls aren't pitches in an arsenal
  const SWING = new Set(["swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "foul_bunt", "missed_bunt", "bunt_foul_tip", "hit_into_play", "hit_into_play_no_out", "hit_into_play_score"]);
  const WHIFF = new Set(["swinging_strike", "swinging_strike_blocked", "missed_bunt", "foul_tip"]);
  const CALLED = new Set(["called_strike"]);

  /** RFC-4180-ish CSV → array of row arrays (quotes, doubled quotes, CRLF). */
  function csvRows(text) {
    const out = []; let row = [], cell = "", q = false;
    const s = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); out.push(row); }
    return out;
  }
  /** Statcast search CSV → pitches (only the fields NMSBSBL uses). */
  function parsePitches(text) {
    const rows = csvRows(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim()), ix = {};
    head.forEach((h, i) => { ix[h] = i; });
    if (ix.pitch_type == null || ix.pfx_x == null) throw new Error("Not a Statcast pitch file");
    const g = (r, k) => (ix[k] == null ? "" : r[ix[k]]);
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (r.length < 10) continue;
      const type = String(g(r, "pitch_type") || "").trim().toUpperCase();
      if (EXCLUDE.has(type)) continue;
      const pfxX = num(g(r, "pfx_x")), pfxZ = num(g(r, "pfx_z")), rx = num(g(r, "release_pos_x"));
      out.push({
        type, date: g(r, "game_date"), game: num(g(r, "game_pk")), ab: num(g(r, "at_bat_number")), pn: num(g(r, "pitch_number")),
        velo: num(g(r, "release_speed")), spin: num(g(r, "release_spin_rate")), axis: num(g(r, "spin_axis")), ext: num(g(r, "release_extension")),
        ivb: pfxZ === null ? null : Math.round(1200 * pfxZ) / 100, hb: pfxX === null ? null : Math.round(-1200 * pfxX) / 100,
        relX: rx === null ? null : -rx, relZ: num(g(r, "release_pos_z")), arm: num(g(r, "arm_angle")),
        stand: g(r, "stand"), throws: g(r, "p_throws"), desc: g(r, "description"), event: g(r, "events"),
        balls: num(g(r, "balls")), strikes: num(g(r, "strikes")), inning: num(g(r, "inning")), year: num(g(r, "game_year"))
      });
    }
    // Savant lists newest first; keep the game order for anything that reads in sequence
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.game - b.game) || (a.ab - b.ab) || (a.pn - b.pn)));
    return out;
  }

  const mean = (xs) => { let s = 0, n = 0; for (const x of xs) if (isNum(x)) { s += x; n++; } return n ? s / n : null; };
  const sd = (xs) => { const m = mean(xs); if (m === null) return null; let s = 0, n = 0; for (const x of xs) if (isNum(x)) { s += (x - m) * (x - m); n++; } return n > 1 ? Math.sqrt(s / (n - 1)) : null; };
  /** circular mean of clock-face spin axes (degrees) */
  function axisMean(xs) { let c = 0, s = 0, n = 0; for (const x of xs) if (isNum(x)) { const r = (x * Math.PI) / 180; c += Math.cos(r); s += Math.sin(r); n++; } if (!n) return null; let d = (Math.atan2(s / n, c / n) * 180) / Math.PI; if (d < 0) d += 360; return d; }
  /** degrees → "1:30" tilt (Statcast spin axis: 180° = 12:00 for the classic backspin … same as Savant's clock) */
  function tilt(deg) { if (!isNum(deg)) return null; let mins = Math.round(((deg + 180) % 360) * 2); mins = ((mins % 720) + 720) % 720; const h = Math.floor(mins / 60) || 12; return h + ":" + String(mins % 60).padStart(2, "0"); }

  /** the 68% covariance ellipse of a cloud of (hb, ivb) points: center, radii (1 SD along principal axes), angle (rad) */
  function ellipse(points) {
    const P = points.filter((p) => isNum(p.hb) && isNum(p.ivb));
    if (P.length < 8) return null;
    const mx = mean(P.map((p) => p.hb)), my = mean(P.map((p) => p.ivb));
    let sxx = 0, syy = 0, sxy = 0;
    P.forEach((p) => { const dx = p.hb - mx, dy = p.ivb - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
    const n = P.length - 1; sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    const angle = Math.abs(sxy) < 1e-12 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
    // 68% of a bivariate normal lies inside 1.51 SD (chi-square 2 df at .68 = 2.28)
    const k = Math.sqrt(2.28);
    return { cx: mx, cy: my, rx: k * Math.sqrt(l1), ry: k * Math.sqrt(l2), angle };
  }

  const FASTBALLS = new Set(["FF", "SI", "FT", "FC"]);
  /** one season's arsenal, optionally against one batter side ("L" | "R"). Types under `minShare` of pitches stay listed but marked rare. */
  function arsenal(pitches, opts) {
    opts = opts || {};
    const P = opts.side ? pitches.filter((p) => p.stand === opts.side) : pitches;
    const total = P.length, by = new Map();
    P.forEach((p) => { if (!by.has(p.type)) by.set(p.type, []); by.get(p.type).push(p); });
    const rows = Array.from(by.entries()).map(([type, list]) => {
      const swings = list.filter((p) => SWING.has(p.desc)).length, whiffs = list.filter((p) => WHIFF.has(p.desc)).length;
      const csw = list.filter((p) => WHIFF.has(p.desc) || CALLED.has(p.desc)).length;
      const velos = list.map((p) => p.velo).filter(isNum);
      return {
        type, n: list.length, usage: total ? list.length / total : 0,
        velo: mean(velos), veloMax: velos.length ? Math.max(...velos) : null, veloSd: sd(velos),
        ivb: mean(list.map((p) => p.ivb)), hb: mean(list.map((p) => p.hb)), ivbSd: sd(list.map((p) => p.ivb)), hbSd: sd(list.map((p) => p.hb)),
        spin: mean(list.map((p) => p.spin)), axis: axisMean(list.map((p) => p.axis)), relZ: mean(list.map((p) => p.relZ)), relX: mean(list.map((p) => p.relX)),
        ext: mean(list.map((p) => p.ext)), arm: mean(list.map((p) => p.arm)),
        swings, whiffs, whiffPct: swings ? whiffs / swings : null, cswPct: list.length ? csw / list.length : null,
        vsL: list.filter((p) => p.stand === "L").length, vsR: list.filter((p) => p.stand === "R").length,
        movementN: list.filter((p) => isNum(p.hb) && isNum(p.ivb)).length, ellipse: ellipse(list)
      };
    }).sort((a, b) => b.n - a.n);
    return { total, rows, side: opts.side || null };
  }
  /** season-level characteristics for the Overview: primary fastball, hardest pitch, release, extension, spread of pitch types */
  function summary(pitches, ars) {
    ars = ars || arsenal(pitches);
    const fb = ars.rows.filter((r) => FASTBALLS.has(r.type) && r.type !== "FC").sort((a, b) => b.n - a.n)[0] || ars.rows.filter((r) => r.type === "FC")[0] || null;
    const games = new Set(pitches.map((p) => p.game)).size;
    const used = ars.rows.filter((r) => r.usage >= 0.03);
    const relZ = mean(pitches.map((p) => p.relZ)), relX = mean(pitches.map((p) => p.relX)), ext = mean(pitches.map((p) => p.ext)), arm = mean(pitches.map((p) => p.arm));
    const swings = pitches.filter((p) => SWING.has(p.desc)).length, whiffs = pitches.filter((p) => WHIFF.has(p.desc)).length;
    const csw = pitches.filter((p) => WHIFF.has(p.desc) || CALLED.has(p.desc)).length;
    const maxVelo = Math.max(...pitches.map((p) => p.velo).filter(isNum));
    return { pitches: pitches.length, games, fastball: fb, types: ars.rows.length, mainTypes: used.length, relZ, relX, ext, arm,
      whiffPct: swings ? whiffs / swings : null, cswPct: pitches.length ? csw / pitches.length : null, maxVelo: Number.isFinite(maxVelo) ? maxVelo : null,
      first: pitches.length ? pitches[0].date : null, last: pitches.length ? pitches[pitches.length - 1].date : null };
  }
  /** which side "+" is for this thrower */
  const sideWords = (throws) => (throws === "L" ? { plus: "Glove side", minus: "Arm side" } : { plus: "Arm side", minus: "Glove side" });
  /** a tidy axis limit (multiple of 5 inches, at least 20) covering every point and ellipse */
  function axisRange(rows, pitches) {
    let m = 20;
    (pitches || []).forEach((p) => { if (isNum(p.hb)) m = Math.max(m, Math.abs(p.hb)); if (isNum(p.ivb)) m = Math.max(m, Math.abs(p.ivb)); });
    (rows || []).forEach((r) => { if (isNum(r.hb)) m = Math.max(m, Math.abs(r.hb) + 3); if (isNum(r.ivb)) m = Math.max(m, Math.abs(r.ivb) + 3); });
    return Math.min(35, Math.ceil(m / 5) * 5);
  }
  return { csvRows, parsePitches, arsenal, summary, ellipse, mean, sd, axisMean, tilt, sideWords, axisRange, SWING, WHIFF, FASTBALLS, isNum };
});
