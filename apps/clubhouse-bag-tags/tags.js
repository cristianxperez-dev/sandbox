/* Clubhouse Bag Tags: tag layout, CSV reading and assignment matching.
   The layout is one list of drawing operations in points (72 per inch, top-left origin). The same list
   draws the on-screen preview (SVG) and the PDF, so what you see is what prints. */
(function (global) {
  "use strict";
  var CBT = global.CBT = global.CBT || {};

  var W = 288, H = 216;                     // 4 × 3 in
  CBT.TAG = { w: W, h: H };
  var NAVY_TOP = [11, 46, 99], NAVY_BOTTOM = [2, 24, 56], OVERLAY = [6, 22, 52], WHITE = [255, 255, 255];

  function hex(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ""); var n = m ? parseInt(m[1], 16) : 0xEB6E1F; return [n >> 16, (n >> 8) & 255, n & 255]; }
  CBT.hex = hex;
  function upper(s) { return String(s || "").normalize("NFC").toLocaleUpperCase("en-US").replace(/\s+/g, " ").trim(); }

  // the largest size (between max and min) at which a line fits, or null
  function fit(font, text, maxW, max, min, sp) {
    var g = font.shape(text);
    for (var s = max; s >= min - 1e-9; s -= 0.25) if (font.width(g, s, sp) <= maxW) return { size: s, glyphs: g };
    return null;
  }
  // every way to break a name into n lines, at a space or after a hyphen
  function breakInto(name, n) {
    var cuts = [], re = /( |-)/g, m;
    while ((m = re.exec(name))) cuts.push({ end: m.index + (m[1] === "-" ? 1 : 0), next: m.index + 1 });
    var out = [];
    (function pick(from, start, left, acc) {
      if (left === 0) { var last = name.slice(start).trim(); if (last) out.push(acc.concat([last])); return; }
      for (var i = from; i < cuts.length; i++) {
        var part = name.slice(start, cuts[i].end).trim();
        if (part) pick(i + 1, cuts[i].next, left - 1, acc.concat([part]));
      }
    })(0, 0, n - 1, []);
    return out.slice(0, 400);
  }

  /* Lay out one tag. fonts: {bold, medium} TTFonts. dest: destination (with any staff overrides).
     art: {logo: {key, w, h} | null, background: {key, w, h} | null}. Returns {ops, warnings}. */
  CBT.layoutTag = function (name, dest, fonts, art) {
    var ops = [], warnings = [], B = fonts.bold, M = fonts.medium;
    var accent = hex(dest && dest.accent);
    // background: the staff photo with a navy wash (like the reference), or a navy field drawing
    if (art.background) {
      var bw = art.background.w, bh = art.background.h, sc = Math.max(W / bw, H / bh);
      ops.push({ t: "img", key: art.background.key, x: (W - bw * sc) / 2, y: (H - bh * sc) / 2, w: bw * sc, h: bh * sc, clip: [0, 0, W, H] });
      ops.push({ t: "rect", x: 0, y: 0, w: W, h: H, c: OVERLAY, a: 0.74 });
    } else {
      ops.push({ t: "grad", x: 0, y: 0, w: W, h: H, c0: NAVY_TOP, c1: NAVY_BOTTOM });
      // a quiet ballpark: outfield arc, infield diamond and baselines
      ops.push({ t: "arc", cx: W / 2, cy: H + 40, r: 200, a0: Math.PI * 1.18, a1: Math.PI * 1.82, c: WHITE, w: 1.1, a: 0.07 });
      ops.push({ t: "arc", cx: W / 2, cy: H + 40, r: 128, a0: Math.PI * 1.22, a1: Math.PI * 1.78, c: WHITE, w: 0.8, a: 0.06 });
      ops.push({ t: "path", pts: [[W / 2, H - 6], [W / 2 + 58, H - 64], [W / 2, H - 122], [W / 2 - 58, H - 64]], closed: true, c: WHITE, w: 0.9, a: 0.07 });
      ops.push({ t: "path", pts: [[W / 2 - 150, H - 156], [W / 2, H - 6], [W / 2 + 150, H - 156]], c: WHITE, w: 0.7, a: 0.05 });
    }
    ops.push({ t: "rect", x: 0, y: 0, w: W, h: 3.2, c: accent, a: 1 });   // destination accent

    /* One centered stack, top to bottom: name, destination line, facility, street, city, logo.
       Fixed gaps between sections (so every tag has the same rhythm); the whole stack is then
       centered vertically, so short and long content both sit balanced on the tag. */
    var MARGIN = 20, maxW = W - 2 * MARGIN, cap = function (f, s) { return f.capHeight * s / f.upm; };
    var GAP = { nameLines: 0.3, toTeam: 11, toFacility: 7.5, line: 5.5, toLogo: 13 };

    // logo: same visual area for every club (round, wide or tall), never stretched
    var logo = null;
    if (art.logo) {
      var ar = art.logo.w / art.logo.h, S = 48, lw = S * Math.sqrt(ar), lh = S / Math.sqrt(ar);
      var k = Math.min(1, 52 / lh, 84 / lw);
      logo = { w: lw * k, h: lh * k };
    } else if (dest) warnings.push("logo");

    var nm = upper(name);
    if (!nm) { nm = "NAME"; warnings.push("name"); }
    // one line if it fits at 17 pt or more; otherwise two balanced lines, then three, before shrinking
    var lines, one = fit(B, nm, maxW, 30, 17, 0);
    if (one) lines = [{ size: one.size, glyphs: one.glyphs }];
    else {
      var best = null;
      [[2, 24, 12], [3, 18, 10]].forEach(function (cfg) {
        if (best && best.size >= 12) return;                    // two good lines beat three
        breakInto(nm, cfg[0]).forEach(function (parts) {
          var gs = parts.map(function (t) { return B.shape(t); });
          for (var s = cfg[1]; s >= cfg[2]; s -= 0.25) {
            if (gs.every(function (g) { return B.width(g, s, 0) <= maxW; })) { if (!best || s > best.size) best = { size: s, l: gs }; break; }
          }
        });
      });
      var single = fit(B, nm, maxW, 17, 6, 0) || { size: 6, glyphs: B.shape(nm) };
      if (best && best.size >= Math.min(single.size + 2, 15)) lines = best.l.map(function (g) { return { size: best.size, glyphs: g }; });
      else lines = [{ size: single.size, glyphs: single.glyphs }];
    }
    if (B.missing(nm).length) warnings.push("characters");
    var nameSize = lines[0].size, nameCap = cap(B, nameSize), nameGap = nameSize * GAP.nameLines;

    // an address line stays readable: it wraps onto a second line (at a comma if it can) rather than
    // shrinking below 8 pt
    function addressRows(text) {
      var one = fit(M, text, maxW, 10, 8, 0.4);
      if (one) return [one];
      var best = null;
      breakInto(text, 2).forEach(function (parts) {
        var g = parts.map(function (t) { return M.shape(t); }), comma = /,$/.test(parts[0]) ? 0.5 : 0;
        for (var s = 10; s >= 7; s -= 0.25) {
          if (g.every(function (x) { return M.width(x, s, 0.4) <= maxW; })) { if (!best || s + comma > best.score) best = { score: s + comma, size: s, g: g }; break; }
        }
      });
      if (best) return best.g.map(function (x) { return { size: best.size, glyphs: x }; });
      return [fit(M, text, maxW, 8, 6.5, 0.4) || fit(M, text, maxW, 6.5, 4.5, 0)];
    }

    var rows = [];
    if (dest) {
      var tlText = upper(dest.tagLine || dest.label);
      var tl = fit(B, tlText, maxW, 8.5, 6, 1.4) || fit(B, tlText, maxW, 6, 4, 0.4);
      rows.push({ font: "bold", f: B, size: tl.size, glyphs: tl.glyphs, c: accent.map(function (x) { return Math.min(255, x + 18); }), sp: tl.size >= 6 ? 1.4 : 0.4, gapBefore: GAP.toTeam });
      var first = true;
      [dest.facility, dest.address, dest.city].forEach(function (line) {
        String(line || "").split(/\n/).forEach(function (part) {      // a multi-line address prints line by line
          if (!part.trim()) return;
          addressRows(upper(part)).forEach(function (r) {
            rows.push({ font: "medium", f: M, size: r.size, glyphs: r.glyphs, c: WHITE, sp: r.size >= 6.5 ? 0.4 : 0, gapBefore: first ? GAP.toFacility : GAP.line });
            first = false;
          });
        });
      });
    } else {
      var na = fit(B, "ASSIGNMENT NEEDED", maxW, 8.5, 6, 1.4);
      rows.push({ font: "bold", f: B, size: na.size, glyphs: na.glyphs, c: [255, 196, 160], sp: 1.4, gapBefore: GAP.toTeam });
      warnings.push("destination");
    }
    var blockH = lines.length * nameCap + (lines.length - 1) * nameGap;
    rows.forEach(function (r) { blockH += r.gapBefore + cap(r.f, r.size); });
    if (logo) blockH += GAP.toLogo + logo.h;
    var y = Math.max(14, (H - blockH) * 0.47);              // a touch above center reads as centered
    lines.forEach(function (l, i) {
      y += nameCap;
      ops.push({ t: "text", font: "bold", size: l.size, x: (W - B.width(l.glyphs, l.size, 0)) / 2, y: y, glyphs: l.glyphs, c: WHITE, sp: 0 });
      if (i < lines.length - 1) y += nameGap;
    });
    rows.forEach(function (r) {
      y += r.gapBefore + cap(r.f, r.size);
      ops.push({ t: "text", font: r.font, size: r.size, x: (W - r.f.width(r.glyphs, r.size, r.sp)) / 2, y: y, glyphs: r.glyphs, c: r.c, sp: r.sp });
    });
    if (logo) ops.push({ t: "img", key: art.logo.key, x: (W - logo.w) / 2, y: y + GAP.toLogo, w: logo.w, h: logo.h });
    if (nameSize < 13) warnings.push("long-name");
    return { ops: ops, warnings: warnings, nameSize: nameSize, nameLines: lines.length };
  };

  /* ---------- SVG preview from the same operations ---------- */
  function rgb(c) { return "rgb(" + c.join(",") + ")"; }
  function escXml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var gradId = 0;
  CBT.tagSVG = function (ops, urls, fonts, opt) {
    var id = "g" + (++gradId), out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '"' + (opt && opt.cls ? ' class="' + opt.cls + '"' : "") + ' role="img" aria-label="' + escXml((opt && opt.label) || "Bag tag preview") + '">');
    out.push('<defs><clipPath id="c' + id + '"><rect width="' + W + '" height="' + H + '"/></clipPath></defs><g clip-path="url(#c' + id + ')">');
    ops.forEach(function (o, i) {
      if (o.t === "grad") out.push('<linearGradient id="' + id + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + rgb(o.c0) + '"/><stop offset="1" stop-color="' + rgb(o.c1) + '"/></linearGradient><rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="url(#' + id + i + ')"/>');
      else if (o.t === "rect") out.push('<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" fill="' + rgb(o.c) + '" fill-opacity="' + o.a + '"/>');
      else if (o.t === "img") { if (urls[o.key]) out.push('<image href="' + urls[o.key] + '" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" preserveAspectRatio="none"/>'); }
      else if (o.t === "path") out.push('<path d="' + o.pts.map(function (p, k) { return (k ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2); }).join("") + (o.closed ? "Z" : "") + '" fill="none" stroke="' + rgb(o.c) + '" stroke-opacity="' + o.a + '" stroke-width="' + o.w + '" stroke-linecap="round" stroke-linejoin="round"/>');
      else if (o.t === "arc") {
        var p0 = [o.cx + o.r * Math.cos(o.a0), o.cy + o.r * Math.sin(o.a0)], p1 = [o.cx + o.r * Math.cos(o.a1), o.cy + o.r * Math.sin(o.a1)];
        out.push('<path d="M' + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + "A" + o.r + " " + o.r + " 0 0 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) + '" fill="none" stroke="' + rgb(o.c) + '" stroke-opacity="' + o.a + '" stroke-width="' + o.w + '" stroke-linecap="round"/>');
      } else if (o.t === "text") {
        // every glyph placed exactly where the PDF puts it (same font metrics, no kerning)
        var f = o.font === "bold" ? fonts.bold : fonts.medium, x = o.x, xs = [], chars = "";
        o.glyphs.forEach(function (g) { xs.push(x.toFixed(2)); chars += String.fromCodePoint(g.cp); x += g.adv * o.size / f.upm + o.sp; });
        out.push('<text x="' + xs.join(" ") + '" y="' + o.y.toFixed(2) + '" font-family="' + (o.font === "bold" ? "CBT Bold" : "CBT Medium") + '" font-size="' + o.size + '" fill="' + rgb(o.c) + '" style="font-kerning:none;font-variant-ligatures:none">' + escXml(chars) + "</text>");
      }
    });
    out.push("</g></svg>");
    return out.join("");
  };

  /* ---------- draw the same operations into a PDF page ---------- */
  CBT.drawTagPDF = function (page, ops, ox, oy, images) {
    page.save(); page.translate(ox, oy); page.clip(0, 0, W, H);
    ops.forEach(function (o) {
      if (o.t === "grad") page.gradient(o.x, o.y, o.w, o.h, o.c0, o.c1);
      else if (o.t === "rect") { page.save(); if (o.a < 1) page.alpha(o.a); page.rect(o.x, o.y, o.w, o.h, o.c); page.restore(); }
      else if (o.t === "img") { if (images[o.key]) { page.save(); if (o.clip) page.clip(o.clip[0], o.clip[1], o.clip[2], o.clip[3]); page.image(images[o.key], o.x, o.y, o.w, o.h); page.restore(); } }
      else if (o.t === "path") { page.save(); page.alpha(o.a); page.path(o.pts, o.c, o.w, o.closed); page.restore(); }
      else if (o.t === "arc") { page.save(); page.alpha(o.a); page.arc(o.cx, o.cy, o.r, o.a0, o.a1, o.c, o.w); page.restore(); }
      else if (o.t === "text") page.text(o.font === "bold" ? "FB" : "FM", o.size, o.x, o.y, o.glyphs, o.c, o.sp);
    });
    page.restore();
  };

  /* ---------- CSV ---------- */
  CBT.parseCSV = function (text) {
    text = String(text).replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "", counts = { ",": 0, ";": 0, "\t": 0 }, q = false;
    for (var i = 0; i < first.length; i++) { var ch = first[i]; if (ch === '"') q = !q; else if (!q && counts[ch] !== undefined) counts[ch]++; }
    var d = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if (!counts[d]) d = ",";
    var rows = [], row = [], cell = "", inQ = false;
    for (var k = 0; k < text.length; k++) {
      var c = text[k];
      if (inQ) {
        if (c === '"') { if (text[k + 1] === '"') { cell += '"'; k++; } else inQ = false; }
        else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === d) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[k + 1] === "\n") k++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  };
  CBT.toCSV = function (rows) {
    return rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\r\n") + "\r\n";
  };

  // which columns hold the name and the assignment
  function key(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  var HEAD = {
    name: ["name", "full name", "player", "player name", "players", "staff", "staff name", "person", "traveler", "traveller", "employee", "nombre", "player staff", "name full"],
    first: ["first", "first name", "firstname", "given name", "given", "fname", "nombre"],
    last: ["last", "last name", "lastname", "surname", "family name", "lname", "apellido", "apellidos"],
    assignment: ["assignment", "affiliate", "team", "destination", "level", "club", "assigned to", "assigned", "location", "org", "affiliate team", "assignment team", "new assignment", "ship to", "equipo"]
  };
  CBT.guessColumns = function (headers) {
    var h = headers.map(key), find = function (list) { for (var i = 0; i < list.length; i++) { var j = h.indexOf(list[i]); if (j > -1) return j; } return -1; };
    var m = { name: find(HEAD.name), first: find(HEAD.first.filter(function (x) { return x !== "nombre"; })), last: find(HEAD.last), assignment: find(HEAD.assignment) };
    if (m.name > -1 && (m.name === m.first)) m.first = -1;
    // a "name"-ish column anywhere (e.g. "Player / Staff Name")
    if (m.name < 0 && m.first < 0) h.forEach(function (x, i) { if (m.name < 0 && /\bname\b/.test(x) && !/\b(first|last|team|club|file)\b/.test(x)) m.name = i; });
    if (m.assignment < 0) h.forEach(function (x, i) { if (m.assignment < 0 && /\b(affiliate|assign|team|level|destination)\b/.test(x)) m.assignment = i; });
    m.ok = (m.name > -1 || (m.first > -1 && m.last > -1)) && m.assignment > -1;
    return m;
  };

  /* Assignment matching: exact alias, or an alias found as whole words. Two possible destinations means
     ambiguous; it is flagged for review, never guessed. */
  function norm(s) { return key(String(s || "").replace(/\+/g, " plus ")); }
  CBT.buildMatcher = function (dests) {
    var exact = new Map(), phrases = [];
    dests.forEach(function (d) {
      [d.id, d.label, d.short].concat(d.aliases || []).forEach(function (a) {
        var k = norm(a); if (!k) return;
        if (exact.has(k) && exact.get(k) !== d.id) exact.set(k, null); else exact.set(k, d.id);
        phrases.push({ k: k, id: d.id });
        var squashed = k.replace(/ /g, "");
        if (squashed !== k && !exact.has(squashed)) exact.set(squashed, d.id);
      });
    });
    return function (value) {
      var k = norm(value);
      if (!k) return { id: null, reason: "blank" };
      if (exact.has(k)) return exact.get(k) ? { id: exact.get(k) } : { id: null, reason: "ambiguous" };
      if (exact.has(k.replace(/ /g, ""))) { var e = exact.get(k.replace(/ /g, "")); return e ? { id: e } : { id: null, reason: "ambiguous" }; }
      var hits = new Set(), padded = " " + k + " ";
      phrases.forEach(function (p) { if (padded.indexOf(" " + p.k + " ") > -1) hits.add(p.id); });
      if (hits.size === 1) return { id: Array.from(hits)[0] };
      return { id: null, reason: hits.size > 1 ? "ambiguous" : "unknown" };
    };
  };
})(window);
