/* Clubhouse Bag Tags: the app. Everything stays on this device: the roster (IndexedDB), the settings
   (tag size, destination mode, print options) and destination edits (localStorage), and uploaded logo /
   background images (IndexedDB). Nothing is sent to a server. */
(function () {
  "use strict";
  var CBT = window.CBT, $ = function (s, r) { return (r || document).querySelector(s); };
  var PREFIX = "clubhouse-bag-tags:";
  var DEFAULTS = window.CBT_DESTINATIONS, SHARED = window.CBT_SHARED_LOGOS || {};
  var WP_DEF = window.CBT_WEST_PALM, ALL_DEFS = DEFAULTS.concat(WP_DEF ? [WP_DEF] : []);

  /* ---------- state ---------- */
  var fonts = null;                    // {bold, medium} TTFonts
  var fontBytes = {};
  var dests = [];                      // the six assignable destinations, with staff overrides applied
  var westPalm = null;                 // the West Palm destination, with staff overrides applied
  var art = {};                        // logo key / "background" → {blob, url, w, h, key, version}
  var roster = [];                     // [{uid, name, dest, raw, copies, selected}]
  var rosterInfo = { fileName: null, columns: null };   // where the list came from, for the "loaded" line
  var saveState = "idle";              // roster storage: "idle", "saving", "saved" or "unavailable"
  var restored = false;                // nothing is saved until the saved roster has been read back
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

  /* ---------- settings (saved in this browser) ----------
     All settings live in one object; every control is drawn from it (syncControls) and every change
     goes through it and is saved at once, so the screen, the preview, the sheets and the PDF can never
     disagree, and a reload comes back exactly as it was left. */
  var PRESETS = { "3x5": { w: 5, h: 3 }, "4x6": { w: 6, h: 4 } };   // index cards, landscape (width × height in inches)
  var MIN_IN = 1.5, MAX_IN = 8;
  function inches(v, dflt) { var n = +v; return isFinite(n) && n >= MIN_IN && n <= MAX_IN ? Math.round(n * 1000) / 1000 : dflt; }
  var prefs = (function () {
    var p = store("prefs") || {};
    var size = PRESETS[p.size] ? p.size : p.size === "custom" ? "custom" : "3x5";
    var dim = size === "custom" ? { w: inches(p.w, 5), h: inches(p.h, 3) } : PRESETS[size];
    return { mode: p.mode === "west-palm" ? "west-palm" : "affiliate", size: size, w: dim.w, h: dim.h, cut: p.cut !== false, scope: p.scope === "all" ? "all" : "selected" };
  })();
  function savePrefs() { store("prefs", prefs); }
  function tagSize() { return { w: prefs.w * 72, h: prefs.h * 72 }; }
  function num(n) { return String(Math.round(n * 1000) / 1000); }
  function sizeText() { return num(prefs.w) + " × " + num(prefs.h) + " in"; }       // width × height
  function westPalmMode() { return prefs.mode === "west-palm"; }
  // the destination a person's tag prints for: their assignment, or West Palm in West Palm mode
  function tagDest(p) { return westPalmMode() ? westPalm : destById(p.dest); }

  /* ---------- browser storage (IndexedDB): images in "assets", the roster in "roster" ---------- */
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r;
      try { r = window.indexedDB && indexedDB.open("clubhouse-bag-tags", 2); } catch (e) { r = null; }
      if (!r) return rej(new Error("no indexedDB"));
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets");
        if (!d.objectStoreNames.contains("roster")) d.createObjectStore("roster");
      };
      r.onsuccess = function () { r.result.onversionchange = function () { r.result.close(); dbp = null; }; res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { setTimeout(function () { rej(new Error("storage is busy in another tab")); }, 4000); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function idb(name, mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var tx = d.transaction(name, mode), st = tx.objectStore(name), out = fn(st);
      tx.oncomplete = function () { res(out && out.result); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error("storage failed")); };
    }); });
  }
  var assetGet = function (k) { return idb("assets", "readonly", function (s) { return s.get(k); }).catch(function () { return null; }); };
  var assetPut = function (k, blob) { return idb("assets", "readwrite", function (s) { s.put(blob, k); }).catch(function () { toast("This browser couldn’t save the image; it will last until you close the tab."); }); };
  var assetDel = function (k) { return idb("assets", "readwrite", function (s) { s.delete(k); }).catch(function () {}); };

  /* ---------- the saved roster ----------
     Saved on this device after every change (import, edit, copies, selection, removal) and read back
     when the app opens. Only the fields the tags need are kept. */
  var saveTimer = null;
  function saveRoster() {
    if (!restored) return;
    clearTimeout(saveTimer);
    if (saveState !== "unavailable") saveState = "saving";
    saveTimer = setTimeout(function () {
      var work = roster.length
        ? idb("roster", "readwrite", function (s) {
            s.put({ v: 1, savedAt: Date.now(), fileName: rosterInfo.fileName, columns: rosterInfo.columns,
              people: roster.map(function (p) { return { name: p.name, dest: p.dest, raw: p.raw, copies: p.copies, selected: p.selected }; }) }, "current");
          })
        : idb("roster", "readwrite", function (s) { s.delete("current"); });
      work.then(function () {
        saveState = roster.length ? "saved" : "idle"; renderLoaded();
        if (roster.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      }, function () { saveState = "unavailable"; renderLoaded(); });
    }, 300);
  }
  function restoreRoster() {
    return idb("roster", "readonly", function (s) { return s.get("current"); }).then(function (data) {
      if (data && Array.isArray(data.people) && data.people.length) {
        roster = data.people.map(function (x) {
          var dest = destById(x.dest) ? x.dest : x.raw ? matcher(x.raw).id : null;
          var copies = parseInt(x.copies, 10);
          return { uid: ++uidSeq, name: String(x.name || ""), dest: dest, raw: String(x.raw || ""), copies: isNaN(copies) ? 1 : Math.max(0, Math.min(50, copies)), selected: x.selected !== false };
        });
        rosterInfo = { fileName: data.fileName || null, columns: data.columns || null };
        saveState = "saved";
      }
    }, function () { saveState = "unavailable"; }).then(function () { restored = true; });
  }
  function clearSavedRoster() {
    clearTimeout(saveTimer);
    roster = []; rosterInfo = { fileName: null, columns: null }; focusUid = null; filter = "all"; lastImport = null;
    idb("roster", "readwrite", function (s) { s.delete("current"); }).then(function () { saveState = "idle"; }, function () {}).then(function () { renderAll(); });
    $("#drop").querySelector(".big").textContent = "Drop your roster CSV here";
    renderAll();
    toast("Saved roster cleared from this device");
  }


  /* ---------- destinations with staff edits ---------- */
  var EDITABLE = ["tagLine", "facility", "address", "city", "accent"];
  function loadDests() {
    var saved = store("destinations") || {};
    var all = ALL_DEFS.map(function (d) {
      var o = {}; Object.keys(d).forEach(function (k) { o[k] = d[k]; });
      var s = saved[d.id] || {};
      EDITABLE.forEach(function (k) { if (typeof s[k] === "string") o[k] = s[k]; });
      return o;
    });
    dests = all.filter(function (d) { return !WP_DEF || d.id !== WP_DEF.id; });
    westPalm = WP_DEF ? all[all.length - 1] : null;
    matcher = CBT.buildMatcher(dests);
  }
  function saveDest(id, field, value) {
    var saved = store("destinations") || {};
    saved[id] = saved[id] || {};
    var def = ALL_DEFS.filter(function (d) { return d.id === id; })[0];
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
  function setArt(k, blob, official) {
    if (art[k]) { URL.revokeObjectURL(art[k].url); delete art[k]; }
    if (!blob) return Promise.resolve();
    return imageSize(blob).then(function (s) { art[k] = { blob: blob, url: s.url, w: s.w, h: s.h, img: s.img, key: k + "#" + (++versions), official: !!official }; });
  }
  // the official logo file shipped in logos/ (named in destinations.js), if there is one
  // Images: "<logo key>" for logos, "bg:<destination id>" for a destination's ballpark photo, and
  // "background" for the photo used where a destination has none.
  function officialFile(k) {
    var bg = /^bg:/.test(k), d = ALL_DEFS.filter(function (x) { return bg ? "bg:" + x.id === k && x.background : logoKey(x.id) === k && x.logo; })[0];
    return d ? (bg ? d.background : d.logo) : null;
  }
  function officialArt(k) {
    var file = officialFile(k);
    if (!file) return Promise.resolve(null);
    return fetch(file).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { return b && setArt(k, b, true); }).catch(function () {});
  }
  function loadArt() {
    var keys = Array.from(new Set(ALL_DEFS.map(function (d) { return logoKey(d.id); })))
      .concat(ALL_DEFS.map(function (d) { return "bg:" + d.id; }), ["background"]);
    return Promise.all(keys.map(function (k) {
      return assetGet(k).then(function (blob) {
        if (blob) return setArt(k, blob);                        // a staff upload replaces the official file
        return officialArt(k);
      }).catch(function () {});
    }));
  }
  function artFor(dest) {
    var lk = dest && logoKey(dest.id), lg = dest && art[lk];
    var bk = dest && art["bg:" + dest.id] ? "bg:" + dest.id : "background", bg = art[bk];
    // the built-in photo keeps its chosen focal point when cropped; an uploaded one is cropped from the centre
    var focus = bg && bg.official && bk !== "background" ? dest.focus : null;
    return { logo: lg ? { key: lg.key, w: lg.w, h: lg.h, src: lk } : null, background: bg ? { key: bg.key, w: bg.w, h: bg.h, src: bk, focus: focus } : null };
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
    if (/^(background|bg:)/.test(k)) {
      var c = canvasFrom(a.img, 1800);
      p = new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.86); }).then(function (b) { return b.arrayBuffer(); })
        .then(function (buf) { return { key: a.key, kind: "jpeg", bytes: new Uint8Array(buf), w: c.width, h: c.height }; });
    } else {
      var lc = canvasFrom(a.img, 720);   // about 1000 dpi at tag size
      p = Promise.resolve({ key: a.key, kind: "rgba", data: lc.getContext("2d").getImageData(0, 0, lc.width, lc.height).data, w: lc.width, h: lc.height });
    }
    pdfImageCache.set(a.key, p);
    return p;
  }

  /* ---------- tags ---------- */
  function layoutFor(p) { var d = tagDest(p); return CBT.layoutTag(p.name, d, fonts, artFor(d), tagSize()); }
  function flagsFor(p, dupes) {
    var f = [], d = tagDest(p);
    if (!String(p.name || "").trim()) f.push(["err", "Missing name"]);
    if (!destById(p.dest)) f.push([westPalmMode() ? "info" : "err", p.raw ? "Needs assignment (“" + p.raw + "”)" : "Needs assignment"]);
    if (d && !art[logoKey(d.id)]) f.push(["warn", "Logo missing"]);
    if (dupes && dupes.has(normName(p.name))) f.push(["info", "Duplicate name"]);
    if (p.name && fonts) {
      var L = layoutFor(p);
      if (L.warnings.indexOf("characters") > -1) f.push(["warn", "Unsupported character"]);
      else if (L.warnings.indexOf("overflow") > -1) f.push(["warn", "Too long for this tag size"]);
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
  function printable(p) { return p.name.trim() && tagDest(p) && p.copies > 0; }
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
    rosterInfo = { fileName: mode === "add" && rosterInfo.fileName ? rosterInfo.fileName + " + " + pending.fileName : pending.fileName, columns: "Name: " + used[0] + " · Assignment: " + used[1] };
    lastImport = { pending: pending, added: added };
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

  /* ---------- the "loaded" line: file, count and whether it is saved on this device ---------- */
  var lastImport = null;           // the most recent import, so its columns can still be changed
  var confirmClear = false;
  function renderLoaded() {
    var el = $("#loaded");
    if (!roster.length && !rosterInfo.fileName) { el.hidden = true; confirmClear = false; return; }
    el.hidden = false;
    if (confirmClear) {
      el.innerHTML = '<span class="meta"><b>Clear the saved roster from this device?</b> All ' + roster.length + " " + (roster.length === 1 ? "person" : "people") + " will be removed from the list. This can’t be undone.</span>" +
        '<button class="btn btn-sm btn-danger" id="clearYes" type="button">Clear roster</button><button class="btn btn-sm" id="clearNo" type="button">Cancel</button>';
      $("#clearYes").onclick = function () { confirmClear = false; clearSavedRoster(); };
      $("#clearNo").onclick = function () { confirmClear = false; renderLoaded(); };
      return;
    }
    var review = roster.filter(needsReview).length;
    var saved = saveState === "saved" ? '<span class="saved" title="Kept in this browser only, on this device. Nothing is uploaded.">✓ Saved on this device</span>'
      : saveState === "saving" ? '<span class="saved">Saving…</span>'
      : saveState === "unavailable" ? '<span class="saved off">Not saved: this browser is blocking storage (for example a private window), so the list lasts only until this tab closes</span>' : "";
    el.innerHTML = '<span class="file">' + esc(rosterInfo.fileName || "Roster") + '</span><span class="meta">' + roster.length + " " + (roster.length === 1 ? "person" : "people") +
      (rosterInfo.columns ? " · " + esc(rosterInfo.columns) : "") + (review ? ' · <b style="color:#9A3F07">' + review + " need review</b>" : "") + "</span>" + saved +
      (lastImport ? '<button class="link" id="reMap" type="button">Change columns</button>' : "") +
      (roster.length ? '<button class="link" id="clearRoster" type="button">' + (saveState === "unavailable" ? "Clear list" : "Clear saved roster") + "</button>" : "");

    if (lastImport) $("#reMap").onclick = function () {
      var li = lastImport; lastImport = null;
      roster = roster.filter(function (p) { return li.added.indexOf(p) < 0; }); pending = li.pending; showMapping(); renderAll();
    };
    if ($("#clearRoster")) $("#clearRoster").onclick = function () { confirmClear = true; renderLoaded(); };
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
    var d = tagDest(p), flags = flagsFor(p, dupes), urls = artUrls();
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
    var dupes = duplicates(), flags = flagsFor(p, dupes), d = tagDest(p);
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
    var d = tagDest(p), own = destById(p.dest);
    $("#bigPreview").innerHTML = CBT.tagSVG(layoutFor(p).ops, artUrls(), fonts, { label: "Tag for " + p.name });
    $("#sideInfo").innerHTML = '<div class="who">' + esc(p.name || "(no name)") + "</div>" +
      '<div class="where">' + (d ? esc(d.label) + "\n" + esc(d.facility) + "\n" + esc(d.address) + "\n" + esc(d.city) : "Choose an assignment to finish this tag.") + "</div>" +
      (westPalmMode() ? '<div class="size">West Palm tag · assignment in the list: ' + esc(own ? own.label : "none") + "</div>" : "") +
      '<div class="btns"><button class="btn btn-dark" type="button" id="oneTag"' + (printable(p) ? "" : " disabled") + ">Print this tag (" + sizeText() + ")</button>" +
      '<button class="btn" type="button" id="oneSheet"' + (printable(p) ? "" : " disabled") + ">Letter sheet with this tag</button></div>" +
      '<div class="size">' + (p.copies > 1 ? p.copies + " copies" : "1 copy") + " · exactly " + sizeText() + " at 100%</div>";
    var one = function (kind, print) { return function () { exportTags(kind, [p], print); }; };
    if ($("#oneTag")) { $("#oneTag").onclick = one("single", true); $("#oneSheet").onclick = one("sheet", true); }
  }
  function outputList() { return roster.filter(function (p) { return prefs.scope === "all" || p.selected; }); }
  function expand(list) {
    var tags = [];
    list.forEach(function (p) { if (printable(p)) for (var i = 0; i < p.copies; i++) tags.push(p); });
    return tags;
  }
  function renderTotals() {
    var list = outputList(), tags = expand(list), skipped = list.filter(function (p) { return !printable(p) && p.copies > 0; }).length;
    var sheets = Math.ceil(tags.length / sheetLayout().n);
    $("#totals").textContent = (tags.length ? tags.length + " tag" + (tags.length === 1 ? "" : "s") + " · " + sheets + " sheet" + (sheets === 1 ? "" : "s") : "No tags to print yet") + (westPalmMode() ? " · West Palm" : "");
    $("#reviewSub").textContent = roster.length ? roster.length + " " + (roster.length === 1 ? "person" : "people") + " · " + roster.filter(function (p) { return p.selected; }).length + " selected" : "No one added yet";
    ["#sheetPrint", "#sheetSave", "#singlePrint", "#singleSave"].forEach(function (s) { $(s).disabled = !tags.length; });
    if (!busy) $("#status").textContent = skipped ? skipped + " selected " + (skipped === 1 ? "person isn’t" : "people aren’t") + " included until they have " + (westPalmMode() ? "a name." : "a name and an assignment.") : "";
    renderSheets(tags);
    saveRoster();
  }
  // print view: the Letter sheets as they will print (first pages)
  var sheetTimer = null;
  function renderSheets(tags) {
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      var S = sheetLayout(), pages = Math.ceil(tags.length / S.n), show = Math.min(pages, 4), urls = artUrls(), html = "", cache = new Map();
      for (var pg = 0; pg < show; pg++) {
        var s = '<svg viewBox="0 0 ' + S.w + " " + S.h + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sheet ' + (pg + 1) + '">';
        for (var i = 0; i < S.n; i++) {
          var p = tags[pg * S.n + i]; if (!p) break;
          var x = S.x0 + (i % S.cols) * S.tw, y = S.y0 + Math.floor(i / S.cols) * S.th;
          if (!cache.has(p.uid)) cache.set(p.uid, CBT.tagSVG(layoutFor(p).ops, urls, fonts, {}).replace("<svg ", '<svg width="' + S.tw + '" height="' + S.th + '" '));
          s += '<g transform="translate(' + x + "," + y + ')">' + cache.get(p.uid).replace("<svg ", '<svg x="0" y="0" ') + "</g>";
        }
        s += sheetGuidesSVG(S, prefs.cut) + "</svg>";
        html += '<div class="sheet">' + s + '<div class="cap">Sheet ' + (pg + 1) + " of " + pages + "</div></div>";
      }
      if (pages > show) html += '<div class="sheet" style="align-self:center"><div class="cap">+ ' + (pages - show) + " more sheet" + (pages - show === 1 ? "" : "s") + " in the PDF</div></div>";
      $("#sheets").innerHTML = html;
    }, 60);
  }
  // every control shows the saved settings
  function syncControls() {
    var press = function (sel, attr, val) { document.querySelectorAll(sel + " button[" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute(attr) === val)); }); };
    press("#tagMode", "data-mode", prefs.mode);
    press("#tagSize", "data-size", prefs.size);
    ["w", "h"].forEach(function (k) { var inp = $("#size" + k.toUpperCase()); if (document.activeElement !== inp) inp.value = num(prefs[k]); });
    $("#modeNote").hidden = !westPalmMode();
    if (westPalm) $("#wpAddr").textContent = [westPalm.tagLine, westPalm.facility].join(" · ") + ", " + [westPalm.address, westPalm.city].filter(Boolean).join(", ");
    $("#cutLines").checked = prefs.cut;
    document.querySelectorAll("input[name=scope]").forEach(function (r) { r.checked = r.value === prefs.scope; });
    var S = sheetLayout();
    document.querySelectorAll(".js-size").forEach(function (el) { el.textContent = sizeText(); });
    $("#sheetHead").textContent = "Letter sheets · " + S.n + " tag" + (S.n === 1 ? "" : "s") + " per page";
    $("#sheetDesc").textContent = "US Letter " + (S.w > S.h ? "landscape (11 × 8.5 in)" : "(8.5 × 11 in)") + ", " + S.cols + " column" + (S.cols === 1 ? "" : "s") + " × " + S.rows + " row" + (S.rows === 1 ? "" : "s") + " of " + sizeText() + " tags, with cutting guides.";
  }
  function renderAll() { syncControls(); renderLoaded(); renderChips(); renderRows(); renderSide(); renderTotals(); }

  /* ---------- Letter sheet geometry ----------
     As many tags of the chosen size as fit on US Letter, portrait or landscape (whichever holds more),
     centred, with a 0.25 in margin for the crop marks and room at the bottom for the print note. */
  function sheetLayout() {
    var t = tagSize(), M = 18, FOOT = 22, best = null;
    [[612, 792], [792, 612]].forEach(function (pg) {
      var cols = Math.floor((pg[0] - 2 * M + 0.01) / t.w), rows = Math.floor((pg[1] - 2 * M - FOOT + 0.01) / t.h);
      if (cols < 1 || rows < 1 || (best && cols * rows <= best.n)) return;
      best = { w: pg[0], h: pg[1], cols: cols, rows: rows, n: cols * rows, tw: t.w, th: t.h,
        x0: (pg[0] - cols * t.w) / 2, y0: M + (pg[1] - 2 * M - FOOT - rows * t.h) / 2 };
    });
    return best;
  }
  function guideLines(S, cut) {
    var L = [], xs = [], ys = [], i;
    for (i = 0; i <= S.cols; i++) xs.push(S.x0 + i * S.tw);
    for (i = 0; i <= S.rows; i++) ys.push(S.y0 + i * S.th);
    var right = xs[S.cols], bottom = ys[S.rows];
    xs.forEach(function (x) { L.push([x, Math.max(2, S.y0 - 20), x, S.y0 - 5], [x, bottom + 5, x, Math.min(S.h - 27, bottom + 20)]); });
    ys.forEach(function (y) { L.push([Math.max(2, S.x0 - 20), y, S.x0 - 5, y], [right + 5, y, Math.min(S.w - 2, right + 20), y]); });
    var cuts = [];
    if (cut) {
      xs.slice(1, -1).forEach(function (x) { cuts.push([x, ys[0], x, bottom]); });
      ys.slice(1, -1).forEach(function (y) { cuts.push([xs[0], y, right, y]); });
    }
    return { marks: L, cuts: cuts };
  }
  function sheetGuidesSVG(S, cut) {
    var g = guideLines(S, cut);

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
      tags.forEach(function (p) { var a = artFor(tagDest(p)); if (a.logo) keys.add(a.logo.src); if (a.background) keys.add(a.background.src); });
      for (var k of keys) { var data = await pdfImage(k); images[art[k].key] = await doc.addImage(data); }
      var layouts = new Map();
      var L = function (p) { if (!layouts.has(p.uid)) layouts.set(p.uid, layoutFor(p).ops); return layouts.get(p.uid); };
      var T = tagSize(), S = sheetLayout(), pages = kind === "single" ? tags.length : Math.ceil(tags.length / S.n);
      if (kind === "single") {
        tags.forEach(function (p) { var pg = doc.page(T.w, T.h); CBT.drawTagPDF(pg, L(p), 0, 0, images); });
      } else {
        var g = guideLines(S, prefs.cut);
        for (var n = 0; n < pages; n++) {
          var pg2 = doc.page(S.w, S.h);
          for (var i = 0; i < S.n; i++) {
            var p = tags[n * S.n + i]; if (!p) break;
            CBT.drawTagPDF(pg2, L(p), S.x0 + (i % S.cols) * S.tw, S.y0 + Math.floor(i / S.cols) * S.th, images);
          }
          g.marks.forEach(function (l) { pg2.path([[l[0], l[1]], [l[2], l[3]]], [85, 85, 85], 0.5, false); });
          g.cuts.forEach(function (l) {   // dashed, light, on top of the artwork
            pg2.save(); pg2.alpha(0.55); pg2.ops.push("[3 3] 0 d"); pg2.path([[l[0], l[1]], [l[2], l[3]]], [255, 255, 255], 0.5, false); pg2.restore();
          });
          var foot = "PRINT AT ACTUAL SIZE (100%) · NOT FIT TO PAGE · " + (S.w > S.h ? "LETTER LANDSCAPE · " : "") + "EACH TAG " + sizeText().toUpperCase() + " · SHEET " + (n + 1) + " OF " + pages;
          var fg = fonts.medium.shape(foot), fw = fonts.medium.width(fg, 6.5, 0.6);
          pg2.text("FM", 6.5, (S.w - fw) / 2, S.h - 20, fg, [110, 120, 135], 0.6);
        }
      }
      var blob = await doc.output();
      var stamp = new Date().toISOString().slice(0, 10);
      var name = "bag-tags-" + (westPalmMode() ? "west-palm-" : "") + (kind === "single" ? num(prefs.w) + "x" + num(prefs.h) + "in" : "letter") + "-" + stamp + (people.length === 1 ? "-" + people[0].name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() : "") + ".pdf";
      var url = URL.createObjectURL(blob);
      if (win) { win.location.href = url; setTimeout(function () { URL.revokeObjectURL(url); }, 120000); }
      else downloadBlob(blob, name);
      $("#status").textContent = (kind === "single" ? tags.length + " page" + (tags.length === 1 ? "" : "s") + " at " + sizeText() : pages + " Letter sheet" + (pages === 1 ? "" : "s")) +
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
    var shown = new Set(), html = '<p class="note" style="margin-top:0">The clubs’ official logos and ballpark photos are built in; FCL, Rehab and West Palm use the Houston Astros logo and the CACTI Park photo. Address edits and replacement logos or photos are saved in this browser only.</p>';
    dests.concat(westPalm ? [westPalm] : []).forEach(function (d) {
      var k = logoKey(d.id), a = art[k], first = !shown.has(k); shown.add(k);
      var def = ALL_DEFS.filter(function (x) { return x.id === d.id; })[0];
      var edited = EDITABLE.some(function (f) { return d[f] !== def[f]; });
      html += '<div class="dest" data-id="' + d.id + '"><div><div class="logo-box">' + (a ? '<img src="' + a.url + '" alt="' + esc(d.label) + ' logo">' : '<div class="none">No logo yet</div>') + "</div>" +
        '<div class="lbtns">' + (first ? '<button class="btn btn-sm" type="button" data-act="logo">' + (a ? "Replace logo" : "Upload logo") + "</button>" + (a && !a.official ? '<button class="btn btn-sm" type="button" data-act="nologo">' + (DEFAULTS.some(function (x) { return logoKey(x.id) === k && x.logo; }) ? "Use official logo" : "Remove") + "</button>" : "") : '<span class="note">Same logo as FCL</span>') + "</div>" +
        photoBox("bg:" + d.id, "dbg") + "</div>" +
        "<div><h3>" + (d === westPalm ? "West Palm mode" : esc(d.label)) + ' <span class="note">· ' + (d === westPalm ? "used for every tag when West Palm is chosen" : esc(d.level)) + "</span></h3>" +
        '<div class="fields">' +
        '<div class="wide"><label>Line on tag</label><input type="text" data-f="tagLine" value="' + esc(d.tagLine) + '"></div>' +
        '<div class="wide"><label>Stadium or facility</label><input type="text" data-f="facility" value="' + esc(d.facility) + '"></div>' +
        '<div><label>Street address</label><input type="text" data-f="address" value="' + esc(d.address) + '"></div>' +
        '<div><label>City, state, ZIP</label><input type="text" data-f="city" value="' + esc(d.city) + '"></div></div>' +
        '<div class="row"><label class="note" style="display:flex;gap:6px;align-items:center">Accent <input type="color" data-f="accent" value="' + esc(d.accent) + '"></label>' +
        (edited ? '<button class="link" type="button" data-act="reset">Reset to default</button>' : "") + "</div></div></div>";
    });
    var without = dests.filter(function (d) { return !art["bg:" + d.id]; }).map(function (d) { return d.label; });
    html += '<div class="dest"><div>' + photoBox("background", "bg") + "</div>" +
      "<div><h3>Other destinations’ photo</h3><p class=\"note\">Used behind tags for any destination without its own ballpark photo" + (without.length ? " (now: " + esc(without.join(", ")) + ")" : "") +
      ". Landscape, at least 1600 px wide; it is shown under a navy wash, like the reference design. Without one, those tags use a navy ballpark drawing.</p></div></div>";
    $("#destBody").innerHTML = html;
  }
  // a ballpark photo with its buttons (a destination's own, or the shared one)
  function photoBox(k, act) {
    var a = art[k], hasOfficial = !!officialFile(k);
    return '<div class="photo-col"><div class="logo-box photo-box">' + (a ? '<img src="' + a.url + '" alt="Ballpark photo">' : '<div class="none">' + (act === "bg" ? "Navy ballpark drawing" : "No photo: uses the shared one") + "</div>") + "</div>" +
      '<div class="lbtns"><button class="btn btn-sm" type="button" data-act="' + act + '">' + (a ? "Replace photo" : "Upload photo") + "</button>" +
      (a && !a.official ? '<button class="btn btn-sm" type="button" data-act="no' + act + '">' + (hasOfficial ? "Use official photo" : "Remove") + "</button>" : "") + "</div></div>";
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
      var keyFor = function (a) { return a === "bg" || a === "nobg" ? "background" : a === "dbg" || a === "nodbg" ? "bg:" + id : logoKey(id); };
      if (act === "logo" || act === "bg" || act === "dbg") pickImage(function (file) {
        var k = keyFor(act);
        setArt(k, file).then(function () { assetPut(k, file); after(); toast(act === "logo" ? "Logo saved in this browser" : "Photo saved in this browser"); })
          .catch(function (err) { toast(err.message); });
      });
      else if (act === "nologo" || act === "nobg" || act === "nodbg") {
        var k2 = keyFor(act);
        setArt(k2, null); assetDel(k2);
        officialArt(k2).then(after);
      }
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
    document.querySelectorAll("input[name=scope]").forEach(function (r) { r.onchange = function () { prefs.scope = r.value; savePrefs(); renderTotals(); }; });
    $("#cutLines").onchange = function () { prefs.cut = $("#cutLines").checked; savePrefs(); renderTotals(); };
    var sel = function () { return outputList(); };
    $("#sheetPrint").onclick = function () { exportTags("sheet", sel(), true); };
    $("#sheetSave").onclick = function () { exportTags("sheet", sel(), false); };
    $("#singlePrint").onclick = function () { exportTags("single", sel(), true); };
    $("#singleSave").onclick = function () { exportTags("single", sel(), false); };
    // Tag destination: By Affiliate / West Palm. Changes only what the tags print, never the roster.
    $("#tagMode").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]"); if (!b) return;
      prefs.mode = b.getAttribute("data-mode") === "west-palm" ? "west-palm" : "affiliate";
      savePrefs(); renderAll();
    });
    // Tag size: a preset, or custom width and height in inches
    $("#tagSize").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-size]"); if (!b) return;
      var k = b.getAttribute("data-size");
      if (PRESETS[k]) { prefs.size = k; prefs.w = PRESETS[k].w; prefs.h = PRESETS[k].h; savePrefs(); renderAll(); }
      else { prefs.size = "custom"; savePrefs(); syncControls(); $("#sizeW").focus(); $("#sizeW").select(); }
    });
    var sizeTimer = null;
    ["w", "h"].forEach(function (k) {
      var inp = $("#size" + k.toUpperCase());
      inp.addEventListener("input", function () {
        var v = inches(inp.value, null);
        inp.setAttribute("aria-invalid", String(v === null));
        $("#sizeMsg").textContent = v === null ? "Width and height must be between " + MIN_IN + " and " + MAX_IN + " in." : "";
        if (v === null || v === prefs[k]) return;
        prefs[k] = v; prefs.size = "custom";
        Object.keys(PRESETS).forEach(function (p) { if (PRESETS[p].w === prefs.w && PRESETS[p].h === prefs.h) prefs.size = p; });
        savePrefs();
        clearTimeout(sizeTimer); sizeTimer = setTimeout(renderAll, 120);
      });
      inp.addEventListener("change", function () { inp.value = num(prefs[k]); inp.removeAttribute("aria-invalid"); $("#sizeMsg").textContent = ""; });
    });
    $("#btnHelp").onclick = function () { $("#dlgHelp").showModal(); };
    $("#btnDest").onclick = function () { renderDestDialog(); $("#dlgDest").showModal(); };
    document.querySelectorAll("dialog").forEach(function (d) {
      d.addEventListener("click", function (e) { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
    });
    wireDestDialog();
    // warn before closing only if the roster couldn't be saved on this device
    window.addEventListener("beforeunload", function (e) { if (roster.length && saveState !== "saved") { e.preventDefault(); e.returnValue = ""; } });
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
  syncControls();
  Promise.all([loadFont("fonts/Montserrat-ExtraBold.ttf", "CBT Bold"), loadFont("fonts/Montserrat-Medium.ttf", "CBT Medium"), loadArt(), restoreRoster()]).then(function (r) {
    fonts = { bold: r[0], medium: r[1] };
    if (roster.length) {
      $("#drop").querySelector(".big").textContent = "Drop another CSV to replace or add";
      if (roster.some(needsReview)) filter = "review";
    }
    renderAll();

  }).catch(function (e) {
    $("#status").textContent = "Couldn’t load the tag fonts. Check your connection and reload. (" + e.message + ")";
  });
})();
