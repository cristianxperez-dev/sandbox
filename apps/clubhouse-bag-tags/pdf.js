/* Clubhouse Bag Tags: font metrics and a small PDF writer, all in the browser.
   - TTFont reads a TrueType font: glyph ids, advance widths, and a glyph subset for embedding.
   - PdfDoc writes PDF 1.4 with exact page sizes, embedded (subset) fonts, images and simple vector art.
   Nothing here talks to a server. */
(function (global) {
  "use strict";

  /* ---------- TrueType ---------- */
  function TTFont(buffer, name) {
    this.name = name;
    this.buf = new Uint8Array(buffer);
    var v = new DataView(buffer);
    this.v = v;
    var n = v.getUint16(4), t = {};
    for (var i = 0; i < n; i++) {
      var o = 12 + i * 16;
      var tag = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      t[tag] = { off: v.getUint32(o + 8), len: v.getUint32(o + 12) };
    }
    this.tables = t;
    var head = t.head.off;
    this.upm = v.getUint16(head + 18);
    this.bbox = [v.getInt16(head + 36), v.getInt16(head + 38), v.getInt16(head + 40), v.getInt16(head + 42)];
    this.locLong = v.getInt16(head + 50) === 1;
    this.numGlyphs = v.getUint16(t.maxp.off + 4);
    var hh = t.hhea.off;
    this.ascent = v.getInt16(hh + 4);
    this.descent = v.getInt16(hh + 6);
    var nh = v.getUint16(hh + 34);
    this.adv = new Uint16Array(this.numGlyphs);
    var last = 0;
    for (var g = 0; g < this.numGlyphs; g++) {
      if (g < nh) last = v.getUint16(t.hmtx.off + g * 4);
      this.adv[g] = last;
    }
    var os2 = t["OS/2"] && t["OS/2"].off;
    this.capHeight = os2 && v.getUint16(os2) >= 2 ? v.getInt16(os2 + 88) : Math.round(this.ascent * 0.7);
    this.cmap = this._cmap();
  }
  TTFont.prototype._cmap = function () {
    var v = this.v, base = this.tables.cmap.off, n = v.getUint16(base + 2), best = null, map = new Map();
    for (var i = 0; i < n; i++) {
      var pid = v.getUint16(base + 4 + i * 8), eid = v.getUint16(base + 6 + i * 8), off = v.getUint32(base + 8 + i * 8);
      var fmt = v.getUint16(base + off);
      if (pid === 3 && eid === 10 && fmt === 12) { best = { off: base + off, fmt: 12 }; break; }
      if (pid === 3 && eid === 1 && fmt === 4) best = { off: base + off, fmt: 4 };
    }
    if (!best) return map;
    var o = best.off;
    if (best.fmt === 12) {
      var groups = v.getUint32(o + 12);
      for (var g = 0; g < groups; g++) {
        var s = v.getUint32(o + 16 + g * 12), e = v.getUint32(o + 20 + g * 12), id = v.getUint32(o + 24 + g * 12);
        for (var c = s; c <= e; c++) map.set(c, id + (c - s));
      }
    } else {
      var segX2 = v.getUint16(o + 6), ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (var k = 0; k < segX2 / 2; k++) {
        var end = v.getUint16(ends + k * 2), start = v.getUint16(starts + k * 2), delta = v.getInt16(deltas + k * 2), ro = v.getUint16(ranges + k * 2);
        for (var cc = start; cc <= end && cc !== 0xFFFF; cc++) {
          var gid;
          if (ro === 0) gid = (cc + delta) & 0xFFFF;
          else {
            var p = ranges + k * 2 + ro + (cc - start) * 2;
            gid = v.getUint16(p);
            if (gid) gid = (gid + delta) & 0xFFFF;
          }
          if (gid) map.set(cc, gid);
        }
      }
    }
    return map;
  };
  TTFont.prototype.gid = function (cp) { return this.cmap.get(cp) || 0; };
  // glyphs for a string: [{gid, cp, adv}] (advance in font units); unknown characters fall back to their base letter
  TTFont.prototype.shape = function (str) {
    var out = [], self = this;
    Array.from(String(str).normalize("NFC")).forEach(function (ch) {
      var cp = ch.codePointAt(0), g = self.gid(cp);
      if (!g) {
        var base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (base && base !== ch) { Array.from(base).forEach(function (b) { var gb = self.gid(b.codePointAt(0)); if (gb) out.push({ gid: gb, cp: b.codePointAt(0), adv: self.adv[gb] }); }); return; }
        g = self.gid(63); cp = 63; // "?"
      }
      out.push({ gid: g, cp: cp, adv: self.adv[g] });
    });
    return out;
  };
  TTFont.prototype.missing = function (str) {
    var self = this;
    return Array.from(String(str).normalize("NFC")).filter(function (ch) { return !/\s/.test(ch) && !self.gid(ch.codePointAt(0)); });
  };
  // width in points of glyphs at a size, with letter spacing between glyphs
  TTFont.prototype.width = function (glyphs, size, spacing) {
    var w = 0;
    glyphs.forEach(function (g) { w += g.adv; });
    return w * size / this.upm + (spacing || 0) * Math.max(0, glyphs.length - 1);
  };

  // A font file containing only the glyphs in use (other glyph ids kept, but empty), for embedding
  TTFont.prototype.subset = function (used) {
    var v = this.v, buf = this.buf, t = this.tables, self = this;
    var loca = function (g) { return self.locLong ? v.getUint32(t.loca.off + g * 4) : v.getUint16(t.loca.off + g * 2) * 2; };
    var keep = new Set([0]);
    var queue = Array.from(used);
    while (queue.length) {
      var g = queue.pop();
      if (keep.has(g) && g !== 0) continue;
      keep.add(g);
      var s = loca(g), e = loca(g + 1);
      if (e > s && v.getInt16(t.glyf.off + s) < 0) {                // composite glyph: keep its parts
        var p = t.glyf.off + s + 10, flags;
        do {
          flags = v.getUint16(p); var comp = v.getUint16(p + 2);
          if (!keep.has(comp)) queue.push(comp);
          p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        } while (flags & 0x20);
      }
    }
    var parts = [], offsets = [0], size = 0;
    for (var gi = 0; gi < this.numGlyphs; gi++) {
      if (keep.has(gi)) {
        var a = loca(gi), b = loca(gi + 1), len = b - a;
        if (len > 0) { var pad = (4 - len % 4) % 4; parts.push(buf.subarray(t.glyf.off + a, t.glyf.off + b)); if (pad) parts.push(new Uint8Array(pad)); size += len + pad; }
      }
      offsets.push(size);
    }
    var glyf = concat(parts);
    var locaOut = new Uint8Array(offsets.length * 4), lv = new DataView(locaOut.buffer);
    offsets.forEach(function (o, i) { lv.setUint32(i * 4, o); });
    var head = buf.slice(t.head.off, t.head.off + t.head.len);
    new DataView(head.buffer).setInt16(50, 1);                       // long loca offsets
    new DataView(head.buffer).setUint32(8, 0);                       // checkSumAdjustment
    var out = { glyf: glyf, loca: locaOut, head: head };
    ["cvt ", "fpgm", "prep", "hhea", "hmtx", "maxp"].forEach(function (k) { if (t[k]) out[k] = buf.subarray(t[k].off, t[k].off + t[k].len); });
    return buildSfnt(out);
  };
  function buildSfnt(tables) {
    var tags = Object.keys(tables).sort(), n = tags.length, off = 12 + n * 16, total = off;
    tags.forEach(function (k) { total += (tables[k].length + 3) & ~3; });
    var out = new Uint8Array(total), v = new DataView(out.buffer);
    v.setUint32(0, 0x00010000); v.setUint16(4, n);
    var es = Math.floor(Math.log2(n)), sr = Math.pow(2, es) * 16;
    v.setUint16(6, sr); v.setUint16(8, es); v.setUint16(10, n * 16 - sr);
    tags.forEach(function (k, i) {
      var d = tables[k], r = 12 + i * 16;
      for (var c = 0; c < 4; c++) v.setUint8(r + c, k.charCodeAt(c));
      var padded = new Uint8Array((d.length + 3) & ~3); padded.set(d);
      var pv = new DataView(padded.buffer), sum = 0;
      for (var j = 0; j < padded.length; j += 4) sum = (sum + pv.getUint32(j)) >>> 0;
      v.setUint32(r + 4, sum); v.setUint32(r + 8, off); v.setUint32(r + 12, d.length);
      out.set(d, off); off += padded.length;
    });
    return out;
  }
  function concat(parts) {
    var n = 0; parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  /* ---------- compression (zlib "deflate" = PDF FlateDecode) ---------- */
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;      // older browsers: store uncompressed
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  /* ---------- PDF ---------- */
  var enc = new TextEncoder();
  function num(x) { return (Math.round(x * 1000) / 1000).toString(); }
  function pdfStr(s) { return "(" + String(s).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?") + ")"; }

  function PdfDoc(opts) {
    this.objects = [];        // [ {body: string | null, stream: Uint8Array | null, dict: string} ]
    this.pages = [];
    this.fonts = {};          // key → {font, used:Set, ref}
    this.images = new Map();  // asset key → {ref, w, h}
    this.alphas = {};         // alpha → name
    this.shadings = [];
    this.title = (opts && opts.title) || "Bag Tags";
    this.pagesRef = this._reserve();
  }
  PdfDoc.prototype._reserve = function () { this.objects.push(null); return this.objects.length; };
  PdfDoc.prototype._set = function (ref, dict, stream) { this.objects[ref - 1] = { dict: dict, stream: stream || null }; return ref; };
  PdfDoc.prototype._add = function (dict, stream) { return this._set(this._reserve(), dict, stream); };
  PdfDoc.prototype.addFont = function (key, font) { this.fonts[key] = { font: font, used: new Set(), ref: this._reserve(), uni: new Map() }; };
  PdfDoc.prototype.alpha = function (a) {
    var k = num(a);
    if (!this.alphas[k]) this.alphas[k] = "GA" + Object.keys(this.alphas).length;
    return this.alphas[k];
  };
  PdfDoc.prototype.shading = function (c0, c1, y0, y1) {
    var name = "SH" + this.shadings.length;
    this.shadings.push({ name: name, c0: c0, c1: c1, y0: y0, y1: y1 });
    return name;
  };
  // image: {key, kind:"jpeg", bytes, w, h} or {key, kind:"rgba", data:Uint8ClampedArray, w, h}
  PdfDoc.prototype.addImage = async function (img) {
    if (this.images.has(img.key)) return this.images.get(img.key);
    var ref, name = "IM" + this.images.size;
    if (img.kind === "jpeg") {
      ref = this._add("/Type /XObject /Subtype /Image /Width " + img.w + " /Height " + img.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", img.bytes);
    } else {
      var px = img.w * img.h, rgb = new Uint8Array(px * 3), a = new Uint8Array(px), opaque = true;
      for (var i = 0; i < px; i++) {
        rgb[i * 3] = img.data[i * 4]; rgb[i * 3 + 1] = img.data[i * 4 + 1]; rgb[i * 3 + 2] = img.data[i * 4 + 2];
        a[i] = img.data[i * 4 + 3]; if (a[i] !== 255) opaque = false;
      }
      var smask = "";
      if (!opaque) {
        var za = await deflate(a);
        var sref = this._add("/Type /XObject /Subtype /Image /Width " + img.w + " /Height " + img.h + " /ColorSpace /DeviceGray /BitsPerComponent 8" + (za ? " /Filter /FlateDecode" : ""), za || a);
        smask = " /SMask " + sref + " 0 R";
      }
      var zr = await deflate(rgb);
      ref = this._add("/Type /XObject /Subtype /Image /Width " + img.w + " /Height " + img.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8" + smask + (zr ? " /Filter /FlateDecode" : ""), zr || rgb);
    }
    var entry = { ref: ref, name: name };
    this.images.set(img.key, entry);
    return entry;
  };
  // A page drawing API in points with a top-left origin (like the screen); converted to PDF coordinates
  PdfDoc.prototype.page = function (w, h) {
    var doc = this, ops = [];
    var P = {
      w: w, h: h, ops: ops,
      save: function () { ops.push("q"); }, restore: function () { ops.push("Q"); },
      translate: function (x, y) { ops.push("1 0 0 1 " + num(x) + " " + num(-y) + " cm"); },
      clip: function (x, y, cw, ch) { ops.push(num(x) + " " + num(h - y - ch) + " " + num(cw) + " " + num(ch) + " re W n"); },
      fill: function (rgb) { ops.push(rgb.map(function (c) { return num(c / 255); }).join(" ") + " rg"); },
      stroke: function (rgb) { ops.push(rgb.map(function (c) { return num(c / 255); }).join(" ") + " RG"); },
      alpha: function (a) { ops.push("/" + doc.alpha(a) + " gs"); },
      rect: function (x, y, rw, rh, rgb) { P.fill(rgb); ops.push(num(x) + " " + num(h - y - rh) + " " + num(rw) + " " + num(rh) + " re f"); },
      gradient: function (x, y, gw, gh, c0, c1) {
        var name = doc.shading(c0, c1, h - y, h - y - gh);
        ops.push("q"); P.clip(x, y, gw, gh); ops.push("/" + name + " sh Q");
      },
      path: function (pts, rgb, width, closed) {
        P.stroke(rgb); ops.push(num(width) + " w 1 J 1 j");
        pts.forEach(function (p, i) { ops.push(num(p[0]) + " " + num(h - p[1]) + (i ? " l" : " m")); });
        ops.push(closed ? "s" : "S");
      },
      arc: function (cx, cy, r, a0, a1, rgb, width) {                // stroked arc, angles in radians (screen orientation)
        var pts = [], n = 48;
        for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        P.path(pts, rgb, width, false);
      },
      image: function (entry, x, y, iw, ih) {
        ops.push("q " + num(iw) + " 0 0 " + num(ih) + " " + num(x) + " " + num(h - y - ih) + " cm /" + entry.name + " Do Q");
      },
      // glyphs: [{gid, cp}], x = left edge, y = baseline
      text: function (fontKey, size, x, y, glyphs, rgb, spacing) {
        var f = doc.fonts[fontKey];
        glyphs.forEach(function (g) { f.used.add(g.gid); f.uni.set(g.gid, g.cp); });
        var hex = glyphs.map(function (g) { return ("000" + g.gid.toString(16)).slice(-4); }).join("");
        P.fill(rgb);
        ops.push("BT /" + fontKey + " " + num(size) + " Tf " + num(spacing || 0) + " Tc " + num(x) + " " + num(h - y) + " Td <" + hex + "> Tj ET");
      }
    };
    this.pages.push(P);
    return P;
  };
  PdfDoc.prototype.output = async function () {
    var doc = this, fontRes = [], xo = [], gs = [], sh = [];
    // fonts (subset now that every page is drawn)
    for (var key in this.fonts) {
      var F = this.fonts[key], font = F.font, used = Array.from(F.used).sort(function (a, b) { return a - b; });
      var tagName = "CBT" + String.fromCharCode(65 + Object.keys(this.fonts).indexOf(key)) + "AA+" + font.name;
      var sub = font.subset(used), zs = await deflate(sub);
      var ff = this._add("/Length1 " + sub.length + (zs ? " /Filter /FlateDecode" : ""), zs || sub);
      var sc = 1000 / font.upm;
      var fd = this._add("/Type /FontDescriptor /FontName /" + tagName + " /Flags 32 /FontBBox [" + font.bbox.map(function (b) { return Math.round(b * sc); }).join(" ") +
        "] /ItalicAngle 0 /Ascent " + Math.round(font.ascent * sc) + " /Descent " + Math.round(font.descent * sc) + " /CapHeight " + Math.round(font.capHeight * sc) + " /StemV 120 /FontFile2 " + ff + " 0 R");
      var w = used.map(function (g) { return g + " [" + Math.round(font.adv[g] * sc) + "]"; }).join(" ");
      var cid = this._add("/Type /Font /Subtype /CIDFontType2 /BaseFont /" + tagName + " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor " + fd + " 0 R /DW 0 /W [" + w + "] /CIDToGIDMap /Identity");
      var cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n";
      var pairs = used.filter(function (g) { return F.uni.has(g); });
      for (var i = 0; i < pairs.length; i += 100) {
        var chunk = pairs.slice(i, i + 100);
        cmap += chunk.length + " beginbfchar\n" + chunk.map(function (g) {
          var u = String.fromCodePoint(F.uni.get(g)), hex = "";
          for (var k = 0; k < u.length; k++) hex += ("000" + u.charCodeAt(k).toString(16)).slice(-4);
          return "<" + ("000" + g.toString(16)).slice(-4) + "> <" + hex + ">";
        }).join("\n") + "\nendbfchar\n";
      }
      cmap += "endcmap CMapName currentdict /CMap defineresource pop end end";
      var tu = this._add("", enc.encode(cmap));
      this._set(F.ref, "/Type /Font /Subtype /Type0 /BaseFont /" + tagName + " /Encoding /Identity-H /DescendantFonts [" + cid + " 0 R] /ToUnicode " + tu + " 0 R");
      fontRes.push("/" + key + " " + F.ref + " 0 R");
    }
    this.images.forEach(function (e) { xo.push("/" + e.name + " " + e.ref + " 0 R"); });
    Object.keys(this.alphas).forEach(function (a) { gs.push("/" + doc.alphas[a] + " << /Type /ExtGState /ca " + a + " /CA " + a + " >>"); });
    this.shadings.forEach(function (s) {
      var c = function (rgb) { return rgb.map(function (x) { return num(x / 255); }).join(" "); };
      sh.push("/" + s.name + " << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 " + num(s.y0) + " 0 " + num(s.y1) + "] /Function << /FunctionType 2 /Domain [0 1] /C0 [" + c(s.c0) + "] /C1 [" + c(s.c1) + "] /N 1 >> /Extend [true true] >>");
    });
    var res = "<< /Font << " + fontRes.join(" ") + " >> /XObject << " + xo.join(" ") + " >> /ExtGState << " + gs.join(" ") + " >> /Shading << " + sh.join(" ") + " >> >>";
    var resRef = this._add(res.slice(3, -3));
    var kids = [];
    for (var p = 0; p < this.pages.length; p++) {
      var pg = this.pages[p], content = enc.encode(pg.ops.join("\n")), zc = await deflate(content);
      var cref = this._add(zc ? "/Filter /FlateDecode" : "", zc || content);
      kids.push(this._add("/Type /Page /Parent " + this.pagesRef + " 0 R /MediaBox [0 0 " + num(pg.w) + " " + num(pg.h) + "] /Resources " + resRef + " 0 R /Contents " + cref + " 0 R") + " 0 R");
    }
    this._set(this.pagesRef, "/Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length);
    var catalog = this._add("/Type /Catalog /Pages " + this.pagesRef + " 0 R /ViewerPreferences << /PrintScaling /None >>");
    var info = this._add("/Title " + pdfStr(this.title) + " /Producer (Clubhouse Bag Tags) /Creator (Clubhouse Bag Tags)");
    // serialize
    var chunks = [enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")], offsets = [], pos = chunks[0].length;
    this.objects.forEach(function (o, i) {
      offsets.push(pos);
      var head, parts;
      if (o.stream) {
        head = enc.encode((i + 1) + " 0 obj\n<< " + o.dict + (o.dict ? " " : "") + "/Length " + o.stream.length + " >>\nstream\n");
        parts = [head, o.stream, enc.encode("\nendstream\nendobj\n")];
      } else parts = [enc.encode((i + 1) + " 0 obj\n<< " + o.dict + " >>\nendobj\n")];
      parts.forEach(function (c) { chunks.push(c); pos += c.length; });
    });
    var xref = "xref\n0 " + (this.objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map(function (o) { return ("000000000" + o).slice(-10) + " 00000 n \n"; }).join("");
    xref += "trailer\n<< /Size " + (this.objects.length + 1) + " /Root " + catalog + " 0 R /Info " + info + " 0 R >>\nstartxref\n" + pos + "\n%%EOF\n";
    chunks.push(enc.encode(xref));
    return new Blob(chunks, { type: "application/pdf" });
  };

  global.CBT = global.CBT || {};
  global.CBT.TTFont = TTFont;
  global.CBT.PdfDoc = PdfDoc;
})(window);
