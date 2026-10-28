/* Clubhouse Bag Tags: the app. Rosters live only in memory (this tab). Only destination preferences
   (address edits, accent colours) and uploaded logo / background images are saved, in this browser. */
(function () {
  "use strict";
  var CBT = window.CBT, $ = function (s, r) { return (r || document).querySelector(s); };
  var PREFIX = "clubhouse-bag-tags:";
  var DEFAULTS = window.CBT_DESTINATIONS, SHARED = window.CBT_SHARED_LOGOS || {};

  /* ---------- state ---------- */
  var fonts = null;                    // {bold, medium} TTFonts
  var fontBytes = {};
  var dests = [];                      // destinations with staff overrides applied
  var art = {};                        // logo key / "background" → {blob, url, w, h, key, version}
  var roster = [];                     // [{uid, name, dest, raw, copies, selected}]
  var uidSeq = 0, focusUid = null, filter = "all", query = "";
  var matcher = null;

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(PREFIX + k)); localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { return null; } }
  function logoKey(id) { return SHARED[id] || id; }
  function destById(id) { return dests.filter(function (d) { return d.id === id; })[0] || null; }

  /* ---------- browser storage for images (IndexedDB) ---------- */
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("no indexedDB"));
      var r = indexedDB.open("clubhouse-bag-tags", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("assets"); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idb(mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var tx = d.transaction("assets", mode), st = tx.objectStore("assets"), out = fn(st);
      tx.oncomplete = function () { res(out && out.result); }; tx.onerror = function () { rej(tx.error); };
    }); });
  }
  var assetGet = function (k) { return idb("readonly", function (s) { return s.get(k); }).catch(function () { return null; }); };
  var assetPut = function (k, blob) { return idb("readwrite", function (s) { s.put(blob, k); }).catch(function () { toast("This browser couldn’t save the image; it will last until you close the tab."); }); };
  var assetDel = function (k) { return idb("readwrite", function (s) { s.delete(k); }).catch(function () {}); };

  /* ---------- destinations with staff edits ---------- */
  var EDITABLE = ["tagLine", "facility", "address", "city", "accent"];
  function loadDests() {
    var saved = store("destinations") || {};
    dests = DEFAULTS.map(function (d) {
      var o = {}; Object.keys(d).forEach(function (k) { o[k] = d[k]; });
      var s = saved[d.id] || {};
      EDITABLE.forEach(function (k) { if (typeof s[k] === "string") o[k] = s[k]; });
      return o;
    });
    matcher = CBT.buildMatcher(dests);
  }
  function saveDest(id, field, value) {
    var saved = store("destinations") || {};
    saved[id] = saved[id] || {};
    var def = DEFAULTS.filter(function (d) { return d.id === id; })[0];
    if (value === def[field]) delete saved[id][field]; else saved[id][field] = value;
    store("destinations", saved);
    loadDests();
  }

  /* ---------- images ---------- */
  function imageSize(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { var w = img.naturalWidth || 600, h = img.naturalHeight || 600; res({ url: url, w: w, h: h, img: img }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("That file isn’t an image this browser can read.")); };
      img.src = url;
    });
  }
  var versions = 0;
  function setArt(k, blob) {
    if (art[k]) { URL.revokeObjectURL(art[k].url); delete art[k]; }
    if (!blob) return Promise.resolve();
    return imageSize(blob).then(function (s) { art[k] = { blob: blob, url: s.url, w: s.w, h: s.h, img: s.img, key: k + "#" + (++versions) }; });
  }
  function loadArt() {
    var keys = Array.from(new Set(DEFAULTS.map(function (d) { return logoKey(d.id); }))).concat(["background"]);
    return Promise.all(keys.map(function (k) {
      return assetGet(k).then(function (blob) {
        if (blob) return setArt(k, blob);
        // an official file shipped in logos/ (named in destinations.js)
        var d = DEFAULTS.filter(function (x) { return logoKey(x.id) === k && x.logo; })[0];
        if (!d) return null;
        return fetch(d.logo).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { return b && setArt(k, b); }).catch(function () {});
      }).catch(function () {});
    }));
  }
  function artFor(dest) {
    var lg = dest && art[logoKey(dest.id)], bg = art.background;
    return { logo: lg ? { key: lg.key, w: lg.w, h: lg.h } : null, background: bg ? { key: bg.key, w: bg.w, h: bg.h } : null };
  }
  function artUrls() { var o = {}; Object.keys(art).forEach(function (k) { o[art[k].key] = art[k].url; }); return o; }

  // image data for the PDF (cached per version)
  var pdfImageCache = new Map();
  function canvasFrom(img, maxSide) {
    var w = img.naturalWidth || 600, h = img.naturalHeight || 600, s = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function pdfImage(k) {
    var a = art[k];
    if (pdfImageCache.has(a.key)) return pdfImageCache.get(a.key);
    var p;
    if (k === "background") {
      var c = canvasFrom(a.img, 1800);
      p = new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.86); }).then(function (b) { return b.arrayBuffer(); })
        .then(function (buf) { return { key: a.key, kind: "jpeg", bytes: new Uint8Array(buf), w: c.width, h: c.height }; });
    } else {
      var lc = canvasFrom(a.img, 1000);
      p = Promise.resolve({ key: a.key, kind: "rgba", data: lc.getContext("2d").getImageData(0, 0, lc.width, lc.height).data, w: lc.width, h: lc.height });
    }
    pdfImageCache.set(a.key, p);
    return p;
  }

  /* ---------- tags ---------- */
  function layoutFor(p) { var d = destById(p.dest); return CBT.layoutTag(p.name, d, fonts, artFor(d)); }
  function flagsFor(p, dupes) {
    var f = [], d = destById(p.dest);
    if (!String(p.name || "").trim()) f.push(["err", "Missing name"]);
    if (!d) f.push(["err", p.raw ? "Needs assignment (“" + p.raw + "”)" : "Needs assignment"]);
    if (d && !art[logoKey(d.id)]) f.push(["warn", "Logo missing"]);
    if (dupes && dupes.has(normName(p.name))) f.push(["info", "Duplicate name"]);
    if (p.name && fonts) {
      var L = layoutFor(p);
      if (L.warnings.indexOf("characters") > -1) f.push(["warn", "Unsupported character"]);
      else if (L.nameSize < 15) f.push(["info", "Long name, check preview"]);
    }
    return f;
  }
  function normName(n) { return String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function duplicates() {
    var seen = new Map(), d = new Set();
    roster.forEach(function (p) { var k = normName(p.name); if (!k) return; if (seen.has(k)) d.add(k); seen.set(k, 1); });
    return d;
  }
  function printable(p) { return p.name.trim() && destById(p.dest) && p.copies > 0; }
  function needsReview(p) { return !p.name.trim() || !destById(p.dest); }

  /* ---------- import ---------- */
  var pending = null;   // {fileName, rows}
  function readFile(file) {
    if (!/\.(csv|txt|tsv)$/i.test(file.name) && file.type && !/csv|text/.test(file.type)) { toast("Please choose a .csv file."); return; }
    var r = new FileReader();
    r.onload = function () { startImport(file.name, String(r.result)); };
    r.onerror = function () { toast("That file couldn’t be read."); };
    r.readAsText(file);
  }
  function startImport(fileName, text) {
    var rows = CBT.parseCSV(text);
    if (rows.length < 2) { toast("No rows found in " + fileName + "."); return; }
    pending = { fileName: fileName, headers: rows[0].map(function (h) { return String(h).trim(); }), rows: rows.slice(1) };
    var m = CBT.guessColumns(pending.headers);
    pending.map = m;
    var copies = pending.headers.findIndex(function (h) { return /^(copies|copy|qty|quantity|tags|count|#)$/i.test(h.trim()); });
    pending.map.copies = copies;
    if (m.ok) applyImport(); else showMapping();
  }
  function showMapping() {
    var h = pending.headers, opts = function (sel, allowNone) {
      return (allowNone ? '<option value="-1">— none —</option>' : '<option value="-1">— choose —</option>') +
        h.map(function (x, i) { return '<option value="' + i + '"' + (sel === i ? " selected" : "") + ">" + esc(x || "Column " + (i + 1)) + "</option>"; }).join("");
    };
    var m = pending.map, el = $("#mapping");
    el.hidden = false;
    el.innerHTML = "<h3>Match the columns in " + esc(pending.fileName) + "</h3><p>Pick the column with each person’s full name, or the first and last name columns, and the assignment column.</p>" +
      '<div class="map-grid">' +
      '<div><label for="mName">Full name</label><select id="mName">' + opts(m.name, true) + "</select></div>" +
      '<div><label for="mFirst">First name</label><select id="mFirst">' + opts(m.first, true) + "</select></div>" +
      '<div><label for="mLast">Last name</label><select id="mLast">' + opts(m.last, true) + "</select></div>" +
      '<div><label for="mAssign">Assignment</label><select id="mAssign">' + opts(m.assignment, false) + "</select></div></div>" +
      '<div style="display:flex;gap:8px;margin-top:12px;align-items:center"><button class="btn btn-dark" id="mGo" type="button">Import ' + pending.rows.length + " rows</button>" +
      '<button class="btn" id="mCancel" type="button">Cancel</button><span class="note" id="mMsg"></span></div>';
    $("#mGo").onclick = function () {
      var v = function (id) { return +$(id).value; };
      var nm = { name: v("#mName"), first: v("#mFirst"), last: v("#mLast"), assignment: v("#mAssign"), copies: pending.map.copies };
      if (nm.name < 0 && (nm.first < 0 || nm.last < 0)) { $("#mMsg").textContent = "Choose a full-name column, or both first and last name."; return; }
      if (nm.assignment < 0) { $("#mMsg").textContent = "Choose the assignment column."; return; }
      pending.map = nm; applyImport();
    };
    $("#mCancel").onclick = function () { pending = null; el.hidden = true; };
  }
  function applyImport(mode) {
    var m = pending.map, added = [];
    if (roster.length && !mode) {                                   // ask once: replace the list, or add to it
      var el = $("#mapping"); el.hidden = false;
      el.innerHTML = "<h3>" + esc(pending.fileName) + "</h3><p>You already have " + roster.length + " " + (roster.length === 1 ? "person" : "people") + " in the list.</p>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-dark" type="button" id="impReplace">Replace the list</button><button class="btn" type="button" id="impAdd">Add to the list</button><button class="btn" type="button" id="impCancel">Cancel</button></div>';
      $("#impReplace").onclick = function () { applyImport("replace"); };
      $("#impAdd").onclick = function () { applyImport("add"); };
      $("#impCancel").onclick = function () { pending = null; el.hidden = true; };
      return;
    }
    if (mode !== "add") roster = [];
    pending.rows.forEach(function (r) {
      var cell = function (i) { return i > -1 ? String(r[i] == null ? "" : r[i]).trim() : ""; };
      var name = m.name > -1 && cell(m.name) ? cell(m.name) : [cell(m.first), cell(m.last)].filter(Boolean).join(" ");
      var raw = cell(m.assignment), match = matcher(raw);
      var copies = parseInt(cell(m.copies), 10);
      if (!name && !raw) return;
      var p = { uid: ++uidSeq, name: name.replace(/\s+/g, " "), dest: match.id, raw: raw, copies: copies > 0 ? Math.min(copies, 50) : 1, selected: true };
      roster.push(p); added.push(p);
    });
    var unmatched = added.filter(needsReview).length;
    $("#mapping").hidden = true;
    var used = [m.name > -1 ? pending.headers[m.name] : pending.headers[m.first] + " + " + pending.headers[m.last], pending.headers[m.assignment]];
    $("#loaded").hidden = false;
    $("#loaded").innerHTML = '<span class="file">' + esc(pending.fileName) + '</span><span class="meta">' + added.length + " people · Name: " + esc(used[0]) + " · Assignment: " + esc(used[1]) +
      (unmatched ? ' · <b style="color:#9A3F07">' + unmatched + " need review</b>" : "") + '</span><button class="link" id="reMap" type="button">Change columns</button>';
    var keep = pending;
    $("#reMap").onclick = function () { roster = roster.filter(function (p) { return added.indexOf(p) < 0; }); pending = keep; showMapping(); renderAll(); };
    $("#drop").querySelector(".big").textContent = "Drop another CSV to replace or add";
    focusUid = added[0] ? added[0].uid : focusUid;
    if (unmatched) filter = "review";
    renderAll();
    toast(added.length + " people imported" + (unmatched ? ", " + unmatched + " need review" : ""));
  }

  /* ---------- sample data and template (fictional people only) ---------- */
  var SAMPLE = [
    ["Alex Example", "Sugar Land"], ["José Ejemplo Peña", "AA"], ["Jordan Placeholder", "High-A"], ["Taylor Muestra", "FAY"],
    ["Juan Carlos Demostración-Iglesias Ejemplo", "Florida Complex League"], ["Ñico Prueba", "REHAB"], ["Casey Trainer-Example", "Corpus Christi"],
    ["Sam Testcase", "A"], ["Alex Example", "Space Cowboys"], ["María Fernanda De La Cruz-Hernández", "Low-A"]
  ];
  function downloadBlob(blob, name) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
  }

  /* ---------- rendering ---------- */
  function visible() {
    var q = normName(query);
    return roster.filter(function (p) {
      if (q && normName(p.name).indexOf(q) < 0) return false;
      if (filter === "review") return needsReview(p);
      if (filter !== "all") return p.dest === filter;
      return true;
    });
  }
  function renderChips() {
    var count = function (fn) { return roster.filter(fn).length; };
    var items = [["all", "All", roster.length]].concat(dests.map(function (d) { return [d.id, d.short === "RHB" ? "Rehab" : d.short, count(function (p) { return p.dest === d.id; })]; }));
    var nr = count(needsReview);
    if (nr) items.push(["review", "Needs review", nr]);
    else if (filter === "review") filter = "all";
    $("#chips").innerHTML = items.map(function (c) {
      return '<button class="chip' + (c[0] === "review" ? " warn" : "") + '" type="button" data-f="' + c[0] + '" aria-pressed="' + (filter === c[0]) + '">' + esc(c[1]) + '<span class="n">' + c[2] + "</span></button>";
    }).join("");
  }
  function destOptions(sel) {
    return '<option value=""' + (sel ? "" : " selected") + ">— Choose —</option>" + dests.map(function (d) { return '<option value="' + d.id + '"' + (sel === d.id ? " selected" : "") + ">" + esc(d.label) + "</option>"; }).join("");
  }
  function rowHtml(p, dupes) {
    var d = destById(p.dest), flags = flagsFor(p, dupes), urls = artUrls();
    var thumb = fonts ? CBT.tagSVG(layoutFor(p).ops, urls, fonts, { label: "Tag for " + p.name }) : "";
    return '<tr data-uid="' + p.uid + '" class="' + (p.uid === focusUid ? "focus" : "") + (p.selected ? "" : " off") + '">' +
      '<td class="c-check"><input type="checkbox" data-k="sel" aria-label="Print tag for ' + esc(p.name) + '"' + (p.selected ? " checked" : "") + "></td>" +
      '<td class="c-thumb"><button class="thumb" type="button" data-k="focus" aria-label="Preview">' + thumb + "</button></td>" +
      '<td class="c-name"><input type="text" data-k="name" value="' + esc(p.name) + '" aria-label="Name" spellcheck="false"><div class="flags">' +
        flags.map(function (f) { return '<span class="flag ' + f[0] + '">' + esc(f[1]) + "</span>"; }).join("") + "</div></td>" +
      '<td class="c-assign"><select data-k="dest" aria-label="Assignment">' + destOptions(p.dest) + "</select></td>" +
      '<td class="c-dest">' + (d ? esc(d.facility) + "<br>" + esc(d.city) : "—") + "</td>" +
      '<td class="c-copies"><input type="number" min="0" max="50" step="1" inputmode="numeric" data-k="copies" value="' + p.copies + '" aria-label="Copies"></td>' +
      '<td class="c-act"><button class="icon" type="button" data-k="focus" title="Preview" aria-label="Preview">👁</button><button class="icon" type="button" data-k="del" title="Remove" aria-label="Remove ' + esc(p.name) + '">×</button></td></tr>';
  }
  function renderRows() {
    var list = visible(), dupes = duplicates();
    $("#rows").innerHTML = list.map(function (p) { return rowHtml(p, dupes); }).join("");
    $("#empty").hidden = list.length > 0;
    $("#empty").textContent = roster.length ? "No one matches this filter." : "Upload a roster or add a person to see tags here.";
  }
  function refreshRow(p) {
    var tr = $('#rows tr[data-uid="' + p.uid + '"]');
    if (!tr) return;
    var dupes = duplicates(), flags = flagsFor(p, dupes), d = destById(p.dest);
    tr.querySelector(".thumb").innerHTML = CBT.tagSVG(layoutFor(p).ops, artUrls(), fonts, { label: "Tag for " + p.name });
    tr.querySelector(".flags").innerHTML = flags.map(function (f) { return '<span class="flag ' + f[0] + '">' + esc(f[1]) + "</span>"; }).join("");
    tr.querySelector(".c-dest").innerHTML = d ? esc(d.facility) + "<br>" + esc(d.city) : "—";
    tr.classList.toggle("off", !p.selected);
  }
  function renderSide() {
    var p = roster.filter(function (x) { return x.uid === focusUid; })[0] || visible()[0] || null;
    if (!p) {
      var demo = { name: "Your Name Here", dest: "fcl" };
      $("#bigPreview").innerHTML = fonts ? CBT.tagSVG(layoutFor(demo).ops, artUrls(), fonts, { label: "Example tag" }) : "";
      $("#sideInfo").innerHTML = '<p class="note">Example tag. Upload a roster or add a person to see their tags.</p>';
      return;
    }
    focusUid = p.uid;
    var d = destById(p.dest);
    $("#bigPreview").innerHTML = CBT.tagSVG(layoutFor(p).ops, artUrls(), fonts, { label: "Tag for " + p.name });
    $("#sideInfo").innerHTML = '<div class="who">' + esc(p.name || "(no name)") + "</div>" +
      '<div class="where">' + (d ? esc(d.label) + "\n" + esc(d.facility) + "\n" + esc(d.address) + "\n" + esc(d.city) : "Choose an assignment to finish this tag.") + "</div>" +
      '<div class="btns"><button class="btn btn-dark" type="button" id="oneTag"' + (printable(p) ? "" : " disabled") + ">Print this tag (4 × 3 in)</button>" +
      '<button class="btn" type="button" id="oneSheet"' + (printable(p) ? "" : " disabled") + ">Letter sheet with this tag</button></div>" +
      '<div class="size">' + (p.copies > 1 ? p.copies + " copies" : "1 copy") + " · exact 4 × 3 in at 100%</div>";
    var one = function (kind, print) { return function () { exportTags(kind, [p], print); }; };
    if ($("#oneTag")) { $("#oneTag").onclick = one("single", true); $("#oneSheet").onclick = one("sheet", true); }
  }
  function outputList() {
    var scope = document.querySelector('input[name=scope]:checked').value;
    return roster.filter(function (p) { return (scope === "all" || p.selected); });
  }
  function expand(list) {
    var tags = [];
    list.forEach(function (p) { if (printable(p)) for (var i = 0; i < p.copies; i++) tags.push(p); });
    return tags;
  }
  function renderTotals() {
    var list = outputList(), tags = expand(list), skipped = list.filter(function (p) { return !printable(p) && p.copies > 0; }).length;
    var sheets = Math.ceil(tags.length / 6);
    $("#totals").textContent = tags.length ? tags.length + " tag" + (tags.length === 1 ? "" : "s") + " · " + sheets + " sheet" + (sheets === 1 ? "" : "s") : "No tags to print yet";
    $("#reviewSub").textContent = roster.length ? roster.length + " " + (roster.length === 1 ? "person" : "people") + " · " + roster.filter(function (p) { return p.selected; }).length + " selected" : "No one added yet";
    ["#sheetPrint", "#sheetSave", "#singlePrint", "#singleSave"].forEach(function (s) { $(s).disabled = !tags.length; });
    $("#status").textContent = skipped ? skipped + " selected " + (skipped === 1 ? "person isn’t" : "people aren’t") + " included until they have a name and an assignment." : "";
    renderSheets(tags);
  }
  // print view: the Letter sheets as they will print (first pages)
  var sheetTimer = null;
  function renderSheets(tags) {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      var pages = Math.ceil(tags.length / 6), show = Math.min(pages, 4), urls = artUrls(), cut = $("#cutLines").checked, html = "", cache = new Map();
      for (var pg = 0; pg < show; pg++) {
        var s = '<svg viewBox="0 0 612 792" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sheet ' + (pg + 1) + '">';
        for (var i = 0; i < 6; i++) {
          var p = tags[pg * 6 + i]; if (!p) break;
          var x = SHEET.x0 + (i % 2) * 288, y = SHEET.y0 + Math.floor(i / 2) * 216;
          if (!cache.has(p.uid)) cache.set(p.uid, CBT.tagSVG(layoutFor(p).ops, urls, fonts, {}).replace("<svg ", '<svg width="288" height="216" '));
          s += '<g transform="translate(' + x + "," + y + ')">' + cache.get(p.uid).replace("<svg ", '<svg x="0" y="0" ') + "</g>";
        }
        s += sheetGuidesSVG(cut) + "</svg>";
        html += '<div class="sheet">' + s + '<div class="cap">Sheet ' + (pg + 1) + " of " + pages + "</div></div>";
      }
      if (pages > show) html += '<div class="sheet" style="align-self:center"><div class="cap">+ ' + (pages - show) + " more sheet" + (pages - show === 1 ? "" : "s") + " in the PDF</div></div>";
      $("#sheets").innerHTML = html;
    }, 60);
  }
  function renderAll() { renderChips(); renderRows(); renderSide(); renderTotals(); }

  /* ---------- Letter sheet geometry ---------- */
  var SHEET = { w: 612, h: 792, x0: 18, y0: 72 };        // 2 × 3 tags of 288 × 216 pt, centered
  function guideLines(cut) {
    var L = [], xs = [SHEET.x0, SHEET.x0 + 288, SHEET.x0 + 576], ys = [SHEET.y0, SHEET.y0 + 216, SHEET.y0 + 432, SHEET.y0 + 648];
    xs.forEach(function (x) { L.push([x, SHEET.y0 - 24, x, SHEET.y0 - 6], [x, SHEET.y0 + 654, x, SHEET.y0 + 672]); });
    ys.forEach(function (y) { L.push([2, y, SHEET.x0 - 5, y], [SHEET.x0 + 581, y, 610, y]); });
    var cuts = cut ? [[xs[1], ys[0], xs[1], ys[3]], [xs[0], ys[1], xs[2], ys[1]], [xs[0], ys[2], xs[2], ys[2]]] : [];
    return { marks: L, cuts: cuts };
  }
  function sheetGuidesSVG(cut) {
    var g = guideLines(cut);
    return g.marks.map(function (l) { return '<line x1="' + l[0] + '" y1="' + l[1] + '" x2="' + l[2] + '" y2="' + l[3] + '" stroke="#555" stroke-width="0.5"/>'; }).join("") +
      g.cuts.map(function (l) { return '<line x1="' + l[0] + '" y1="' + l[1] + '" x2="' + l[2] + '" y2="' + l[3] + '" stroke="#fff" stroke-opacity=".55" stroke-width="0.5" stroke-dasharray="3 3"/>'; }).join("");
  }

  /* ---------- PDF export ---------- */
  var busy = false;
  async function exportTags(kind, people, print) {
    if (busy) return;
    var tags = expand(people);
    if (!tags.length) { toast("No tags to print. Check names, assignments and copies."); return; }
    var win = null;
    if (print) { try { win = window.open("", "_blank"); if (win) win.document.write('<title>Preparing tags…</title><p style="font:15px -apple-system,Segoe UI,sans-serif;padding:24px;color:#002D62">Preparing your PDF…</p>'); } catch (e) { win = null; } }
    busy = true;
    $("#status").textContent = "Making " + tags.length + " tag" + (tags.length === 1 ? "" : "s") + "…";
    try {
      var doc = new CBT.PdfDoc({ title: "Clubhouse Bag Tags" });
      doc.addFont("FB", fonts.bold); doc.addFont("FM", fonts.medium);
      var images = {};
      var keys = new Set();
      tags.forEach(function (p) { var a = artFor(destById(p.dest)); if (a.logo) keys.add(logoKey(p.dest)); if (a.background) keys.add("background"); });
      for (var k of keys) { var data = await pdfImage(k); images[art[k].key] = await doc.addImage(data); }
      var layouts = new Map();
      var L = function (p) { if (!layouts.has(p.uid)) layouts.set(p.uid, layoutFor(p).ops); return layouts.get(p.uid); };
      if (kind === "single") {
        tags.forEach(function (p) { var pg = doc.page(288, 216); CBT.drawTagPDF(pg, L(p), 0, 0, images); });
      } else {
        var cut = $("#cutLines").checked, pages = Math.ceil(tags.length / 6), g = guideLines(cut);
        for (var n = 0; n < pages; n++) {
          var pg2 = doc.page(SHEET.w, SHEET.h);
          for (var i = 0; i < 6; i++) {
            var p = tags[n * 6 + i]; if (!p) break;
            CBT.drawTagPDF(pg2, L(p), SHEET.x0 + (i % 2) * 288, SHEET.y0 + Math.floor(i / 2) * 216, images);
          }
          g.marks.forEach(function (l) { pg2.path([[l[0], l[1]], [l[2], l[3]]], [85, 85, 85], 0.5, false); });
          g.cuts.forEach(function (l) {   // dashed, light, on top of the artwork
            pg2.save(); pg2.alpha(0.55); pg2.ops.push("[3 3] 0 d"); pg2.path([[l[0], l[1]], [l[2], l[3]]], [255, 255, 255], 0.5, false); pg2.restore();
          });
          var foot = "PRINT AT ACTUAL SIZE (100%) · NOT FIT TO PAGE · EACH TAG 4 × 3 IN · SHEET " + (n + 1) + " OF " + pages;
          var fg = fonts.medium.shape(foot), fw = fonts.medium.width(fg, 6.5, 0.6);
          pg2.text("FM", 6.5, (SHEET.w - fw) / 2, SHEET.h - 34, fg, [110, 120, 135], 0.6);
        }
      }
      var blob = await doc.output();
      var stamp = new Date().toISOString().slice(0, 10);
      var name = "bag-tags-" + (kind === "single" ? "4x3" : "letter") + "-" + stamp + (people.length === 1 ? "-" + people[0].name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() : "") + ".pdf";
      var url = URL.createObjectURL(blob);
      if (win) { win.location.href = url; setTimeout(function () { URL.revokeObjectURL(url); }, 120000); }
      else downloadBlob(blob, name);
      $("#status").textContent = (kind === "single" ? tags.length + " page" + (tags.length === 1 ? "" : "s") + " at 4 × 3 in" : Math.ceil(tags.length / 6) + " Letter sheet" + (Math.ceil(tags.length / 6) === 1 ? "" : "s")) +
        (win ? " opened in a new tab. Print at Actual size / 100%." : " saved as " + name + ". Print at Actual size / 100%.");
    } catch (e) {
      if (win) win.close();
      $("#status").textContent = "The PDF couldn’t be made: " + (e && e.message ? e.message : e);
      console.error(e);
    } finally { busy = false; }
  }
  window.CBT_export = exportTags;   // for automated tests

  /* ---------- Destinations & logos dialog ---------- */
  function renderDestDialog() {
    var shown = new Set(), html = '<p class="note" style="margin-top:0">Changes are saved in this browser only. Logos should be the clubs’ official files. FCL and Rehab share the Houston Astros logo.</p>';
    dests.forEach(function (d) {
      var k = logoKey(d.id), a = art[k], first = !shown.has(k); shown.add(k);
      var def = DEFAULTS.filter(function (x) { return x.id === d.id; })[0];
      var edited = EDITABLE.some(function (f) { return d[f] !== def[f]; });
      html += '<div class="dest" data-id="' + d.id + '"><div><div class="logo-box">' + (a ? '<img src="' + a.url + '" alt="' + esc(d.label) + ' logo">' : '<div class="none">No logo yet</div>') + "</div>" +
        '<div class="lbtns">' + (first ? '<button class="btn btn-sm" type="button" data-act="logo">' + (a ? "Replace logo" : "Upload logo") + "</button>" + (a ? '<button class="btn btn-sm" type="button" data-act="nologo">Remove</button>' : "") : '<span class="note">Same logo as FCL</span>') + "</div></div>" +
        "<div><h3>" + esc(d.label) + ' <span class="note">· ' + esc(d.level) + "</span></h3>" +
        '<div class="fields">' +
        '<div class="wide"><label>Line on tag</label><input type="text" data-f="tagLine" value="' + esc(d.tagLine) + '"></div>' +
        '<div class="wide"><label>Stadium or facility</label><input type="text" data-f="facility" value="' + esc(d.facility) + '"></div>' +
        '<div><label>Street address</label><input type="text" data-f="address" value="' + esc(d.address) + '"></div>' +
        '<div><label>City, state, ZIP</label><input type="text" data-f="city" value="' + esc(d.city) + '"></div></div>' +
        '<div class="row"><label class="note" style="display:flex;gap:6px;align-items:center">Accent <input type="color" data-f="accent" value="' + esc(d.accent) + '"></label>' +
        (edited ? '<button class="link" type="button" data-act="reset">Reset to default</button>' : "") + "</div></div></div>";
    });
    var bg = art.background;
    html += '<div class="dest"><div><div class="logo-box">' + (bg ? '<img src="' + bg.url + '" alt="Tag background" style="max-width:100%;max-height:100%;object-fit:cover">' : '<div class="none">Navy ballpark drawing</div>') + "</div>" +
      '<div class="lbtns"><button class="btn btn-sm" type="button" data-act="bg">' + (bg ? "Replace photo" : "Upload photo") + "</button>" + (bg ? '<button class="btn btn-sm" type="button" data-act="nobg">Remove</button>' : "") + "</div></div>" +
      "<div><h3>Tag background photo</h3><p class=\"note\">Optional. A ballpark photo (landscape, at least 1600 px wide) is shown behind every tag with a navy wash, like the reference design. Without one, tags use a navy ballpark drawing.</p></div></div>";
    $("#destBody").innerHTML = html;
  }
  function pickImage(cb) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
    inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }
  function wireDestDialog() {
    var body = $("#destBody");
    body.addEventListener("change", function (e) {
      var f = e.target.getAttribute("data-f"); if (!f) return;
      var id = e.target.closest(".dest").getAttribute("data-id");
      saveDest(id, f, e.target.value.trim());
      renderAll();
      if (e.target.type === "color") renderDestDialog();
    });
    body.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var box = b.closest(".dest"), id = box.getAttribute("data-id"), act = b.getAttribute("data-act");
      var after = function () { pdfImageCache.clear(); renderDestDialog(); renderAll(); };
      if (act === "logo" || act === "bg") pickImage(function (file) {
        var k = act === "bg" ? "background" : logoKey(id);
        setArt(k, file).then(function () { assetPut(k, file); after(); toast(act === "bg" ? "Background photo saved in this browser" : "Logo saved in this browser"); })
          .catch(function (err) { toast(err.message); });
      });
      else if (act === "nologo" || act === "nobg") { var k2 = act === "nobg" ? "background" : logoKey(id); setArt(k2, null); assetDel(k2); after(); }
      else if (act === "reset") { var saved = store("destinations") || {}; delete saved[id]; store("destinations", saved); loadDests(); after(); }
    });
  }

  /* ---------- events ---------- */
  function addPerson() {
    var p = { uid: ++uidSeq, name: "", dest: null, raw: "", copies: 1, selected: true };
    roster.unshift(p); focusUid = p.uid; filter = "all"; query = ""; $("#search").value = "";
    renderAll();
    var inp = $('#rows tr[data-uid="' + p.uid + '"] input[data-k=name]'); if (inp) inp.focus();
  }
  function wire() {
    var drop = $("#drop"), file = $("#file");
    $("#btnBrowse").onclick = function () { file.click(); };
    file.onchange = function () { if (file.files[0]) readFile(file.files[0]); file.value = ""; };
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) { e.preventDefault(); });
    $("#btnTemplate").onclick = function () {
      var rows = [["Name", "Assignment", "Copies"]].concat(DEFAULTS.map(function (d, i) { return [["Alex Example", "José Ejemplo Peña", "Jordan Placeholder", "Taylor Muestra", "Casey Trainer-Example", "Ñico Prueba"][i], d.label, i === 0 ? "2" : "1"]; }));
      downloadBlob(new Blob(["﻿" + CBT.toCSV(rows)], { type: "text/csv;charset=utf-8" }), "bag-tags-template.csv");
    };
    $("#btnSample").onclick = function () { startImport("sample-roster.csv (fictional)", CBT.toCSV([["Player Name", "Affiliate"]].concat(SAMPLE))); };
    $("#btnAdd1").onclick = addPerson; $("#btnAdd2").onclick = addPerson;
    $("#search").addEventListener("input", function (e) { query = e.target.value; renderRows(); });
    $("#chips").addEventListener("click", function (e) { var b = e.target.closest("[data-f]"); if (!b) return; filter = b.getAttribute("data-f"); renderChips(); renderRows(); });
    $("#selAll").onclick = function () { visible().forEach(function (p) { p.selected = true; }); renderRows(); renderTotals(); renderSide(); };
    $("#selNone").onclick = function () { visible().forEach(function (p) { p.selected = false; }); renderRows(); renderTotals(); renderSide(); };
    var rows = $("#rows");
    var person = function (el) { var tr = el.closest("tr"); var uid = tr && +tr.getAttribute("data-uid"); return roster.filter(function (p) { return p.uid === uid; })[0]; };
    rows.addEventListener("click", function (e) {
      var k = e.target.closest("[data-k]"), p = person(e.target); if (!p) return;
      var kind = k && k.getAttribute("data-k");
      if (kind === "del") { roster = roster.filter(function (x) { return x !== p; }); if (focusUid === p.uid) focusUid = null; renderAll(); return; }
      if (kind === "sel") return;
      if (focusUid !== p.uid) {
        focusUid = p.uid;
        rows.querySelectorAll("tr.focus").forEach(function (t) { t.classList.remove("focus"); });
        e.target.closest("tr").classList.add("focus");
        renderSide();
      }
    });
    rows.addEventListener("input", function (e) {
      var k = e.target.getAttribute("data-k"), p = person(e.target); if (!p) return;
      if (k === "name") { p.name = e.target.value; focusUid = p.uid; refreshRow(p); renderSide(); renderTotals(); }
      if (k === "copies") { var n = parseInt(e.target.value, 10); p.copies = isNaN(n) ? 0 : Math.max(0, Math.min(50, n)); renderTotals(); renderSide(); }
    });
    rows.addEventListener("change", function (e) {
      var k = e.target.getAttribute("data-k"), p = person(e.target); if (!p) return;
      if (k === "sel") { p.selected = e.target.checked; refreshRow(p); renderTotals(); renderSide(); }
      if (k === "dest") { p.dest = e.target.value || null; focusUid = p.uid; renderChips(); refreshRow(p); renderSide(); renderTotals(); }
      if (k === "name") { p.name = p.name.replace(/\s+/g, " ").trim(); e.target.value = p.name; renderChips(); renderRows(); }
      if (k === "copies") e.target.value = p.copies;
    });
    document.querySelectorAll("input[name=scope]").forEach(function (r) { r.onchange = renderTotals; });
    $("#cutLines").onchange = renderTotals;
    var sel = function () { return outputList(); };
    $("#sheetPrint").onclick = function () { exportTags("sheet", sel(), true); };
    $("#sheetSave").onclick = function () { exportTags("sheet", sel(), false); };
    $("#singlePrint").onclick = function () { exportTags("single", sel(), true); };
    $("#singleSave").onclick = function () { exportTags("single", sel(), false); };
    $("#btnHelp").onclick = function () { $("#dlgHelp").showModal(); };
    $("#btnDest").onclick = function () { renderDestDialog(); $("#dlgDest").showModal(); };
    document.querySelectorAll("dialog").forEach(function (d) {
      d.addEventListener("click", function (e) { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
    });
    wireDestDialog();
    // the roster is only in memory: warn before it is lost
    window.addEventListener("beforeunload", function (e) { if (roster.length) { e.preventDefault(); e.returnValue = ""; } });
  }

  /* ---------- start ---------- */
  function loadFont(url, family) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("Couldn’t load " + url); return r.arrayBuffer(); }).then(function (buf) {
      fontBytes[family] = buf;
      var ff = new FontFace(family, buf.slice(0)); document.fonts.add(ff);
      return ff.load().then(function () { return new CBT.TTFont(buf, url.indexOf("Bold") > -1 ? "Montserrat-ExtraBold" : "Montserrat-Medium"); });
    });
  }
  loadDests();
  wire();
  Promise.all([loadFont("fonts/Montserrat-ExtraBold.ttf", "CBT Bold"), loadFont("fonts/Montserrat-Medium.ttf", "CBT Medium"), loadArt()]).then(function (r) {
    fonts = { bold: r[0], medium: r[1] };
    renderAll();
  }).catch(function (e) {
    $("#status").textContent = "Couldn’t load the tag fonts. Check your connection and reload. (" + e.message + ")";
  });
})();
