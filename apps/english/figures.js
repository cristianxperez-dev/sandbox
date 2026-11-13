/* English (CP English) — instructional graphics system, v2.
   Schematic SVG teaching diagrams in the CP palette (cream ground, charcoal line, oxblood emphasis, taupe annotation):
   clean line diagrams with restrained shaded forms, callouts and sparing arrows. Never decorative, never a real player.

   Components (window.CPEFig.components):
     SeamDiagram · HandDiagram · GripDiagram{variant: four-seam | two-seam | changeup} · GripAdjustDiagram{variant: thumb | spread | both}
     DeliveryDiagram{variant: side | open | closed} · ReadyPositionDiagram · GlovePositionDiagram · GroundBallDiagram
     FootworkDiagram · ThrowingDiagram · InfieldDiagram{variant: base | shade}
   draw(id, opts) → <figure> card: title, the diagram, optional caption, highlighted parts (opts.highlight: part keys),
   bilingual labels ordered for the learner (the language being learned first), and "Expand" (a full-screen sheet on phones).
   Lesson content refers to diagrams by id (FIGURES below) — in lecture scenes ({type: "figure", figure}) and on activities
   ({figure: {id, highlight, caption}}). */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
    kids.flat(3).forEach((k) => k != null && k !== false && el.append(typeof k === "string" ? document.createTextNode(k) : k));
    return el;
  }
  const ctx = () => (window.CPEContext ? window.CPEContext() : { target: "en", native: "es" });

  /* ---------------- bilingual labels ---------------- */
  const T = {
    seams: ["Seams", "las costuras"], ball: ["Ball", "la pelota"], horseshoe: ["Horseshoe", "la herradura"],
    thumb: ["Thumb", "el pulgar"], index: ["Index finger", "el dedo índice"], middle: ["Middle finger", "el dedo medio"],
    ring: ["Ring finger", "el dedo anular"], pinky: ["Pinky", "el meñique"], palm: ["Palm", "la palma"], tips: ["Fingertips", "las yemas de los dedos"],
    wrist: ["Wrist", "la muñeca"],
    fourSeam: ["Four-seam fastball", "la recta de cuatro costuras"], twoSeam: ["Two-seam / sinker", "de dos costuras / el sinker"], change: ["Changeup", "el cambio"],
    across: ["Fingers across the seams", "dedos sobre las costuras"], along: ["Fingers along the seams", "dedos a lo largo de las costuras"],
    thumbUnder: ["Thumb underneath", "el pulgar debajo"], deeper: ["Ball deeper in the hand", "más profunda en la mano"], circle: ["Circle: thumb + index", "círculo con pulgar e índice"],
    threeTop: ["Three fingers on top", "tres dedos arriba"], moveThumb: ["Move the thumb a little", "mueve el pulgar un poquito"],
    spread: ["Spread the fingers a little", "separa un poco los dedos"], before: ["Before", "antes"], after: ["After", "después"],
    balance: ["Balance and posture", "balance y postura"], stride: ["Stride toward the plate", "el paso hacia el plato"], frontSide: ["Front side (glove side)", "el lado de adelante"],
    release: ["Release out front", "suelta la pelota adelante"], toPlate: ["To the plate", "hacia el plato"], rubber: ["Rubber", "la goma"],
    hips: ["Hips", "las caderas"], shoulder: ["Front shoulder", "el hombro de adelante"], frontFoot: ["Front foot lands", "cae el pie de adelante"],
    open: ["Front shoulder already open", "el hombro de adelante ya abrió"], closed: ["Front shoulder still closed", "el hombro sigue cerrado"],
    feetWide: ["Feet wider than shoulders", "pies más abiertos que los hombros"], knees: ["Knees bent", "rodillas dobladas"], weight: ["Weight forward", "el peso hacia adelante"],
    gloveOut: ["Glove out front", "el guante al frente"], eyes: ["Eyes on the ball", "la vista en la pelota"], low: ["Stay low", "quédate abajo"],
    fingersDown: ["Below the waist: fingers down", "abajo de la cintura: dedos hacia abajo"], fingersUp: ["Above the waist: fingers up", "arriba de la cintura: dedos hacia arriba"],
    openFace: ["Show the pocket to the ball", "el bolsillo hacia la pelota"], triangle: ["Feet and glove make a triangle", "pies y guante forman un triángulo"],
    firstStep: ["First step", "el primer paso"], angle: ["Take a good angle", "toma un buen ángulo"], through: ["Work through the ball", "ve hacia la pelota"], ballPath: ["Ball", "la bola"],
    target: ["Target", "el objetivo"], setFeet: ["Set your feet", "planta los pies"], lane: ["Throwing lane", "línea de tiro"], gloveShoulder: ["Glove shoulder to the target", "hombro del guante hacia el objetivo"],
    positions: ["Infield positions", "las posiciones del cuadro"], shade: ["Shade a few steps toward the middle", "unos pasos hacia el medio"],
  };
  /** [primary, secondary]: the language being learned first */
  const words = (k) => { const t = T[k] || [k, ""]; return ctx().target === "es" ? [t[1] || t[0], t[0]] : [t[0], t[1]]; };
  /** wrap a string into lines of at most n characters (labels never run off a phone screen) */
  function wrap(t, n) {
    const out = []; let cur = "";
    for (const w of String(t || "").split(" ")) { if (cur && (cur + " " + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    if (cur) out.push(cur); return out;
  }
  /** a callout label: primary (charcoal, the language being learned) then secondary (taupe italic), wrapped to o.w characters */
  function label(x, y, key, o) {
    const [a, b] = words(key), anchor = (o && o.anchor) || "start", n = (o && o.w) || 24;
    const spans = [];
    wrap(a, n).forEach((t, i) => spans.push(s("tspan", { class: "fg__p", x, dy: i ? "14" : null }, t)));
    if (b) wrap(b, n + 2).forEach((t, i) => spans.push(s("tspan", { class: "fg__s", x, dy: i ? "12.5" : "13" }, t)));
    return s("text", { x, y, class: "fg__lbl" + (o && o.hl ? " fg__lbl--hl" : ""), "text-anchor": anchor, "data-part": o && o.part }, spans);
  }
  const ln = (x1, y1, x2, y2, cls) => s("line", { x1, y1, x2, y2, class: cls || "fg__lead" });
  const dot = (cx, cy, cls) => s("circle", { cx, cy, r: 2.6, class: cls || "fg__leaddot" });
  /** a leader: dot on the part, thin line to the label */
  const lead = (x1, y1, x2, y2) => [ln(x1, y1, x2, y2), dot(x1, y1)];
  function arrow(x1, y1, x2, y2, cls) {
    const a = Math.atan2(y2 - y1, x2 - x1), L = 8, w = 0.45;
    const p1 = [x2 - L * Math.cos(a - w), y2 - L * Math.sin(a - w)], p2 = [x2 - L * Math.cos(a + w), y2 - L * Math.sin(a + w)];
    return s("g", { class: cls || "fg__arrow" }, s("line", { x1, y1, x2: x2 - 4 * Math.cos(a), y2: y2 - 4 * Math.sin(a) }), s("polygon", { points: `${x2},${y2} ${p1.join(",")} ${p2.join(",")}` }));
  }
  const svg = (w, h, title, ...kids) => s("svg", { viewBox: `0 0 ${w} ${h}`, class: "fg", role: "img", "aria-label": title }, s("title", {}, title), ...kids);

  /* ---------------- shared drawing pieces ---------------- */
  /** a baseball; rot = seam orientation in degrees (0: horseshoe seams vertical, 90: horizontal) */
  function ball(cx, cy, r, rot) {
    const seam = (side) => `M ${cx + side * r * 0.6} ${cy - r * 0.8} C ${cx + side * r * 0.16} ${cy - r * 0.32}, ${cx + side * r * 0.16} ${cy + r * 0.32}, ${cx + side * r * 0.6} ${cy + r * 0.8}`;
    return s("g", { "data-part": "ball" },
      s("circle", { cx, cy, r, class: "fg__ball" }),
      s("circle", { cx: cx - r * 0.28, cy: cy - r * 0.3, r: r * 0.55, class: "fg__ballshade" }),
      s("g", { transform: rot ? `rotate(${rot} ${cx} ${cy})` : null, "data-part": "seams" },
        [-1, 1].map((sd) => [s("path", { d: seam(sd), class: "fg__seam" }), s("path", { d: seam(sd), class: "fg__stitch" })])));
  }
  /** a finger seen from above, coming down onto the ball: base at (x, y0), tip pad at (x2, y1) */
  function finger(x0, y0, x1, y1, w, part, o) {
    const ang = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(ang) * w / 2, ny = Math.cos(ang) * w / 2;
    const taper = 0.84;
    const d = `M ${x0 + nx} ${y0 + ny} L ${x1 + nx * taper} ${y1 + ny * taper} A ${w * taper / 2} ${w * taper / 2} 0 0 1 ${x1 - nx * taper} ${y1 - ny * taper} L ${x0 - nx} ${y0 - ny} Z`;
    const mid = (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    const crease = (t) => { const [mx, my] = mid(t); return s("line", { x1: mx + nx * 0.6 * taper, y1: my + ny * 0.6 * taper, x2: mx - nx * 0.6 * taper, y2: my - ny * 0.6 * taper, class: "fg__crease" }); };
    return s("g", { "data-part": part, class: (o && o.cls) || "" },
      s("path", { d, class: "fg__skin" + (o && o.under ? " fg__skin--under" : "") }),
      o && o.under ? null : [crease(0.45), crease(0.72)],
      o && o.pad === false ? null : s("ellipse", { cx: x1 - (x1 - x0) * 0.06, cy: y1 - (y1 - y0) * 0.06, rx: w * 0.32, ry: w * 0.42, transform: `rotate(${(ang * 180) / Math.PI - 90} ${x1} ${y1})`, class: "fg__pad" }));
  }
  /** a schematic athlete: limbs as thick rounded strokes with joint dots (side view); pts = named joints */
  function body(p, o) {
    const seg = (a, b, cls) => s("line", { x1: p[a][0], y1: p[a][1], x2: p[b][0], y2: p[b][1], class: "fg__limb " + (cls || "") });
    const back = (o && o.backCls) || "fg__limb--far";
    return s("g", { class: "fg__body" },
      seg("hip", "kneeB", back), seg("kneeB", "footB", back), seg("shoulder", "elbowB", back), seg("elbowB", "handB", back),
      seg("shoulder", "hip", "fg__limb--torso"),
      seg("hip", "kneeF"), seg("kneeF", "footF"), seg("shoulder", "elbowF"), seg("elbowF", "handF"),
      s("circle", { cx: p.head[0], cy: p.head[1], r: 13, class: "fg__head" }),
      ["kneeF", "kneeB", "elbowF", "elbowB", "hip", "shoulder"].map((k) => s("circle", { cx: p[k][0], cy: p[k][1], r: 3, class: "fg__joint" })));
  }
  const glove = (cx, cy, rot, sc) => s("g", { transform: `translate(${cx} ${cy}) rotate(${rot || 0}) scale(${sc || 1})`, "data-part": "glove" },
    s("path", { d: "M -12 10 C -16 -2 -14 -14 -6 -16 C -2 -17 2 -17 6 -16 C 14 -14 16 -2 12 10 C 6 14 -6 14 -12 10 Z", class: "fg__glove" }),
    s("path", { d: "M -6 -10 L -6 4 M 0 -12 L 0 6 M 6 -10 L 6 4", class: "fg__web" }));
  const ground = (x1, x2, y) => s("line", { x1, y1: y, x2, y2: y, class: "fg__ground" });

  /* ---------------- components ---------------- */
  const C = {};

  C.SeamDiagram = () => svg(340, 210, "A baseball and its seams", ball(105, 105, 74, 0),
    lead(160, 58, 205, 46), label(212, 44, "seams", { part: "seams" }),
    label(212, 100, "ball", { part: "ball" }),
    lead(146, 160, 205, 158), label(212, 156, "horseshoe", { part: "seams" }));

  C.HandDiagram = (o) => {
    const hl = new Set((o && o.highlight) || []);
    const parts = [["thumb", 1], ["index", 2], ["middle", 3], ["ring", 4], ["pinky", 5]];
    const fingers = { index: [80, 120, 72, 40, 24], middle: [106, 116, 106, 26, 25], ring: [132, 120, 140, 38, 23], pinky: [155, 130, 170, 66, 20] };
    const num = (x, y, n, part) => s("g", { class: "fg__num" + (hl.has(part) ? " fg__num--hl" : "") }, s("circle", { cx: x, cy: y, r: 8.5 }), s("text", { x, y: y + 3.6, "text-anchor": "middle" }, String(n)));
    return svg(360, 250, "A hand and the names of the fingers",
      s("path", { d: "M 66 116 C 62 160 70 196 92 214 L 150 214 C 166 196 172 164 168 128 C 150 120 92 112 66 116 Z", class: "fg__skin", "data-part": "palm" }),
      s("path", { d: "M 92 214 L 92 240 M 150 214 L 150 240", class: "fg__crease" }),
      finger(70, 150, 32, 112, 25, "thumb", { cls: hl.has("thumb") ? "fg--hl" : "" }),
      Object.entries(fingers).map(([k, [x0, y0, x1, y1, w]]) => finger(x0, y0, x1, y1, w, k, { cls: hl.has(k) ? "fg--hl" : "" })),
      s("path", { d: "M 82 170 C 100 160 130 158 150 166", class: "fg__crease" }),
      num(40, 128, 1, "thumb"), num(74, 64, 2, "index"), num(106, 52, 3, "middle"), num(139, 62, 4, "ring"), num(165, 88, 5, "pinky"),
      s("text", { x: 118, y: 192, class: "fg__lbl", "text-anchor": "middle" }, s("tspan", { class: "fg__p", x: 118 }, words("palm")[0]), s("tspan", { class: "fg__s", x: 118, dy: 13 }, words("palm")[1])),
      parts.map(([k, n], i) => s("g", {}, num(214, 30 + i * 36, n, k), label(230, 34 + i * 36, k, { hl: hl.has(k), part: k }))),
      s("ellipse", { cx: 214, cy: 212, rx: 6, ry: 8, class: "fg__pad fg__pad--key" }), label(230, 210, "tips", { hl: hl.has("tips"), part: "tips" }));
  };

  C.GripDiagram = (o) => {
    const v = (o && o.variant) || "four-seam", hl = new Set((o && o.highlight) || []);
    const cx = 110, cy = 128, r = 70;
    let parts, labels;
    if (v === "four-seam") {
      parts = [ball(cx, cy, r, 90), finger(92, 20, 92, cy - 4, 22, "index", { cls: hl.has("index") ? "fg--hl" : "" }), finger(128, 20, 128, cy - 6, 23, "middle", { cls: hl.has("middle") ? "fg--hl" : "" }),
        finger(110, 250, 110, cy + 52, 22, "thumb", { under: true, cls: hl.has("thumb") ? "fg--hl" : "" })];
      labels = [["fourSeam", 34], ["across", 92], ["thumbUnder", 150]];
    } else if (v === "two-seam") {
      parts = [ball(cx, cy, r, 0), finger(90, 20, 90, cy - 4, 22, "index", { cls: hl.has("index") ? "fg--hl" : "" }), finger(130, 20, 130, cy - 6, 23, "middle", { cls: hl.has("middle") ? "fg--hl" : "" }),
        finger(110, 250, 110, cy + 52, 22, "thumb", { under: true, cls: hl.has("thumb") ? "fg--hl" : "" })];
      labels = [["twoSeam", 34], ["along", 92], ["thumbUnder", 150]];
    } else {
      parts = [ball(cx, cy, r, 25), finger(86, 18, 84, cy + 2, 22, "middle"), finger(112, 14, 112, cy - 2, 23, "ring"), finger(138, 20, 140, cy + 4, 21, "pinky"),
        s("g", { "data-part": "circle", class: hl.has("circle") ? "fg--hl" : "" }, s("ellipse", { cx: 46, cy: cy + 6, rx: 20, ry: 17, class: "fg__ring" }), s("ellipse", { cx: 46, cy: cy + 6, rx: 20, ry: 17, class: "fg__ringline" }))];
      labels = [["change", 34], ["threeTop", 82], ["circle", 130], ["deeper", 178]];
    }
    const title = { "four-seam": "Four-seam grip", "two-seam": "Two-seam grip", changeup: "Changeup grip" }[v];
    return svg(360, 250, title, parts, labels.map(([k, y], i) => label(206, y, k, { hl: i === 0 })),
      v === "four-seam" ? lead(92, cy - 30, 200, 96) : v === "two-seam" ? lead(90, cy - 30, 200, 96) : lead(60, cy + 6, 200, 134));
  };

  C.GripAdjustDiagram = (o) => {
    const v = (o && o.variant) || "both";
    const panel = (x, kind) => {
      const cx = x + 80, cy = 120, r = 50;
      if (kind === "thumb") return s("g", {},
        ball(cx, cy, r, 90), finger(cx - 14, 30, cx - 14, cy - 6, 17, "index", { pad: true }), finger(cx + 12, 30, cx + 12, cy - 8, 18, "middle"),
        finger(cx - 70, cy + 14, cx - r + 6, cy + 10, 17, "thumb", { under: true, cls: "fg--ghost" }),
        finger(cx, cy + 96, cx, cy + 34, 17, "thumb", { under: true, cls: "fg--hl" }),
        arrow(cx - 56, cy + 30, cx - 18, cy + 56, "fg__arrow fg__arrow--hl"),
        label(x + 10, 238, "moveThumb", { hl: true, w: 22 }));
      return s("g", {},
        ball(cx, cy, r, 90),
        finger(cx - 6, 30, cx - 6, cy - 6, 17, "index", { cls: "fg--ghost" }), finger(cx + 10, 30, cx + 10, cy - 8, 18, "middle", { cls: "fg--ghost" }),
        finger(cx - 20, 30, cx - 20, cy - 6, 17, "index", { cls: "fg--hl" }), finger(cx + 22, 30, cx + 22, cy - 8, 18, "middle", { cls: "fg--hl" }),
        arrow(cx - 4, 52, cx - 34, 52, "fg__arrow fg__arrow--hl"), arrow(cx + 8, 52, cx + 38, 52, "fg__arrow fg__arrow--hl"),
        label(x + 10, 238, "spread", { hl: true, w: 22 }));
    };
    if (v === "both") return svg(360, 270, "Grip adjustments: move the thumb, spread the fingers", panel(0, "thumb"), s("line", { x1: 180, y1: 20, x2: 180, y2: 230, class: "fg__divider" }), panel(180, "spread"));
    const one = svg(200, 270, v === "thumb" ? "Move the thumb a little" : "Spread the fingers a little", panel(0, v));
    one.classList.add("fg--narrow"); return one;
  };

  /* delivery: side view at front-foot strike (variant side), or top views of two illustrated reps (open / closed) */
  C.DeliveryDiagram = (o) => {
    const v = (o && o.variant) || "side", hl = new Set((o && o.highlight) || []);
    if (v === "side") {
      const p = { head: [176, 64], shoulder: [170, 86], hip: [150, 142], kneeF: [214, 156], footF: [246, 196], kneeB: [116, 170], footB: [84, 196],
        elbowF: [204, 92], handF: [222, 118], elbowB: [140, 74], handB: [120, 52] };
      return svg(380, 268, "Delivery at front-foot strike, side view",
        s("path", { d: "M 20 200 C 80 192 140 194 200 200 L 380 204", class: "fg__mound" }), s("rect", { x: 78, y: 196, width: 14, height: 4, class: "fg__rubber" }),
        body(p), glove(226, 120, -20, 0.8), s("circle", { cx: 120, cy: 50, r: 6, class: "fg__ballsm" }),
        arrow(212, 214, 300, 214, "fg__arrow" + (hl.has("stride") ? " fg__arrow--hl" : "")),
        s("circle", { cx: 236, cy: 70, r: 16, class: "fg__zone" + (hl.has("release") ? " fg__zone--hl" : "") }),
        lead(176, 64, 262, 30), label(268, 28, "balance", { hl: hl.has("balance"), w: 16 }),
        lead(250, 74, 288, 92), label(294, 90, "release", { hl: hl.has("release"), w: 13 }),
        lead(222, 124, 288, 156), label(294, 154, "frontSide", { hl: hl.has("frontSide"), w: 13 }),
        label(212, 236, "stride", { hl: hl.has("stride"), w: 26 }), label(20, 236, "rubber"));
    }
    const open = v === "open", W = 380, H = 230, cx = 172, cy = 128, rad = (d) => (d * Math.PI) / 180;
    const seg = (deg, len) => [cx - Math.cos(rad(deg)) * len, cy - Math.sin(rad(deg)) * len, cx + Math.cos(rad(deg)) * len, cy + Math.sin(rad(deg)) * len];
    const sh = seg(open ? -34 : -5, 46), hp = seg(-10, 34);
    return svg(W, H, open ? "Illustrated rep A: the front shoulder opens early" : "Illustrated rep B: the front shoulder stays closed longer",
      label(14, 26, open ? "open" : "closed", { hl: true }),
      ln(46, cy, 350, cy, "fg__dir"), arrow(330, cy, 362, cy), label(362, cy + 22, "toPlate", { anchor: "end" }),
      s("rect", { x: 30, y: cy - 13, width: 10, height: 26, class: "fg__rubber" }),
      s("ellipse", { cx: 70, cy: cy + 18, rx: 13, ry: 7, class: "fg__foot" }), s("ellipse", { cx: 280, cy: cy + 6, rx: 13, ry: 7, class: "fg__foot fg__foot--front" }),
      s("line", { x1: hp[0], y1: hp[1], x2: hp[2], y2: hp[3], class: "fg__hips" }),
      s("line", { x1: sh[0], y1: sh[1], x2: sh[2], y2: sh[3], class: "fg__shoulders" }), s("circle", { cx: sh[2], cy: sh[3], r: 5, class: "fg__hldot" }),
      lead(cx - 26, cy + 4, cx - 50, cy + 40), label(cx - 50, cy + 54, "hips", { anchor: "middle" }),
      lead(sh[2], sh[3], 250, 60), label(256, 62, "shoulder", { w: 16 }),
      lead(280, cy + 12, 280, cy + 36), label(280, cy + 50, "frontFoot", { anchor: "middle" }),
      s("text", { x: 14, y: H - 6, class: "fg__cap" }, `Rep ${open ? "A" : "B"} · top view at foot strike · illustration`));
  };

  C.ReadyPositionDiagram = (o) => {
    const hl = new Set((o && o.highlight) || []);
    const p = { head: [118, 58], shoulder: [122, 82], hip: [104, 132], kneeF: [138, 156], footF: [150, 202], kneeB: [80, 160], footB: [70, 202], elbowF: [146, 116], handF: [156, 146], elbowB: [138, 118], handB: [150, 148] };
    return svg(360, 240, "Ready position, side view", ground(30, 200, 204), body(p), glove(160, 148, 10, 0.8),
      ln(54, 210, 166, 210, "fg__dim"), s("text", { x: 110, y: 226, class: "fg__dimtx", "text-anchor": "middle" }, "wide base"),
      lead(124, 64, 214, 40), label(220, 38, "weight", { hl: hl.has("weight") }),
      lead(162, 148, 214, 96), label(220, 94, "gloveOut", { hl: hl.has("glove") }),
      lead(138, 156, 214, 146), label(220, 144, "knees", { hl: hl.has("knees") }),
      lead(150, 200, 214, 192), label(220, 190, "feetWide", { hl: hl.has("feet") }));
  };

  C.GlovePositionDiagram = () => {
    const panel = (x, up) => s("g", {},
      s("line", { x1: x + 20, y1: 120, x2: x + 150, y2: 120, class: "fg__waist" }), s("text", { x: x + 150, y: 114, class: "fg__dimtx", "text-anchor": "end" }, "waist"),
      glove(x + 85, up ? 70 : 168, up ? 0 : 180, 2.1),
      arrow(x + 85, up ? 36 : 204, x + 85, up ? 18 : 222, "fg__arrow fg__arrow--hl"),
      label(x + 12, 238, up ? "fingersUp" : "fingersDown", { hl: true, w: 22 }));
    return svg(360, 290, "Glove position: fingers down below the waist, up above it", panel(0, false), s("line", { x1: 180, y1: 20, x2: 180, y2: 250, class: "fg__divider" }), panel(180, true));
  };

  C.GroundBallDiagram = () => {
    const p = { head: [150, 92], shoulder: [146, 112], hip: [110, 142], kneeF: [150, 160], footF: [160, 204], kneeB: [84, 170], footB: [76, 204], elbowF: [170, 146], handF: [184, 186], elbowB: [160, 150], handB: [180, 184] };
    return svg(380, 290, "Fielding a ground ball: wide base, low, glove out front",
      ground(30, 250, 206), body(p), glove(190, 192, 180, 0.9), s("circle", { cx: 236, cy: 200, r: 5.5, class: "fg__ballsm" }), arrow(300, 200, 246, 200),
      ln(150, 96, 230, 196, "fg__sight"),
      lead(150, 96, 250, 52), label(256, 50, "eyes"),
      lead(110, 142, 250, 104), label(256, 102, "low"),
      lead(192, 194, 250, 150), label(256, 148, "gloveOut", { hl: true }),
      // inset: the triangle from above
      s("g", { transform: "translate(256 214)" },
        s("polygon", { points: "8,52 58,52 33,14", class: "fg__tri" }), s("ellipse", { cx: 8, cy: 52, rx: 6, ry: 4, class: "fg__foot" }), s("ellipse", { cx: 58, cy: 52, rx: 6, ry: 4, class: "fg__foot" }), glove(33, 12, 0, 0.55)),
      label(30, 238, "triangle", { w: 30 }));
  };

  C.FootworkDiagram = () => svg(380, 260, "Approach: first step and a good angle to the ball (top view)",
    s("text", { x: 14, y: 22, class: "fg__cap" }, "Top view · shortstop"),
    s("path", { d: "M 40 230 L 300 70", class: "fg__ballpath" }), arrow(250, 101, 290, 76), label(296, 64, "ballPath"),
    s("circle", { cx: 120, cy: 120, r: 9, class: "fg__pos" }), s("text", { x: 120, y: 124, class: "fg__postx", "text-anchor": "middle" }, "SS"),
    arrow(126, 130, 142, 150, "fg__arrow fg__arrow--hl"), label(64, 176, "firstStep", { hl: true }),
    s("path", { d: "M 142 152 C 158 168 176 176 196 172", class: "fg__route" }), arrow(186, 174, 202, 171, "fg__arrow"),
    label(150, 214, "angle"),
    arrow(202, 171, 300, 150, "fg__arrow fg__arrow--soft"), label(250, 124, "through"));

  C.ThrowingDiagram = () => svg(380, 230, "Throwing setup: set the feet, glove shoulder to the target (top view)",
    s("text", { x: 14, y: 22, class: "fg__cap" }, "Top view · infielder throwing to first"),
    ln(110, 120, 352, 120, "fg__lane"), s("rect", { x: 346, y: 112, width: 16, height: 16, class: "fg__base", transform: "rotate(45 354 120)" }), label(362, 150, "target", { anchor: "end" }),
    s("ellipse", { cx: 90, cy: 136, rx: 14, ry: 7, class: "fg__foot" }), s("ellipse", { cx: 150, cy: 122, rx: 14, ry: 7, class: "fg__foot fg__foot--front" }),
    s("line", { x1: 88, y1: 108, x2: 150, y2: 104, class: "fg__shoulders" }), s("circle", { cx: 150, cy: 104, r: 5, class: "fg__hldot" }),
    lead(150, 104, 196, 64), label(202, 62, "gloveShoulder", { hl: true, w: 20 }),
    lead(120, 136, 120, 176), label(60, 190, "setFeet"),
    label(196, 146, "lane"));

  C.InfieldDiagram = (o) => {
    const shade = o && o.variant === "shade", W = 360, H = 250;
    const home = [180, 226], first = [266, 140], second = [180, 54], third = [94, 140];
    const base = ([x, y]) => s("rect", { x: x - 6, y: y - 6, width: 12, height: 12, class: "fg__base", transform: `rotate(45 ${x} ${y})` });
    const pos = (x, y, t, cls) => s("g", {}, s("circle", { cx: x, cy: y, r: 11, class: cls || "fg__pos" }), s("text", { x, y: y + 4, class: "fg__postx" + (cls && cls.includes("on") ? " fg__postx--on" : ""), "text-anchor": "middle" }, t));
    return svg(W, H, shade ? "Positioning: the shortstop shades a few steps toward the middle" : "The infield",
      s("polygon", { points: [home, first, second, third].map((q) => q.join(",")).join(" "), class: "fg__diamond" }),
      base(first), base(second), base(third), s("polygon", { points: `${home[0] - 7},${home[1] - 6} ${home[0] + 7},${home[1] - 6} ${home[0] + 7},${home[1] + 2} ${home[0]},${home[1] + 8} ${home[0] - 7},${home[1] + 2}`, class: "fg__base" }),
      pos(242, 98, "2B"), pos(268, 156, "1B"), pos(92, 156, "3B"), s("circle", { cx: 180, cy: 140, r: 6, class: "fg__moundsm" }),
      shade ? [pos(118, 96, "SS", "fg__pos fg__pos--ghost"), arrow(132, 94, 156, 90, "fg__arrow fg__arrow--hl"), pos(170, 88, "SS", "fg__pos fg__pos--on"), label(14, 28, "shade", { hl: true })]
        : [pos(118, 96, "SS"), label(14, 28, "positions")],
      s("text", { x: 14, y: H - 6, class: "fg__cap" }, "Schematic infield · illustration"));
  };

  /* ---------------- ids used by lesson content ---------------- */
  const FIGURES = {
    "ball-seams": ["SeamDiagram"], "seam-orientation": ["SeamDiagram"],
    "hand-fingers": ["HandDiagram"],
    "grip-4s": ["GripDiagram", { variant: "four-seam" }], "grip-2s": ["GripDiagram", { variant: "two-seam" }], "grip-change": ["GripDiagram", { variant: "changeup" }],
    "grip-adjust": ["GripAdjustDiagram", { variant: "both" }], "grip-adjust-thumb": ["GripAdjustDiagram", { variant: "thumb" }], "grip-adjust-spread": ["GripAdjustDiagram", { variant: "spread" }],
    "delivery-side": ["DeliveryDiagram", { variant: "side" }], "delivery-a": ["DeliveryDiagram", { variant: "open" }], "delivery-b": ["DeliveryDiagram", { variant: "closed" }],
    "ready-position": ["ReadyPositionDiagram"], "glove-position": ["GlovePositionDiagram"], "ground-ball": ["GroundBallDiagram"],
    "footwork-angle": ["FootworkDiagram"], "throwing-setup": ["ThrowingDiagram"],
    infield: ["InfieldDiagram", { variant: "base" }], "infield-shade": ["InfieldDiagram", { variant: "shade" }],
  };
  const TITLES = {
    "ball-seams": ["The ball and the seams", "La pelota y las costuras"], "seam-orientation": ["Seam orientation", "Orientación de las costuras"],
    "hand-fingers": ["The hand", "La mano"], "grip-4s": ["Four-seam grip", "Agarre de cuatro costuras"], "grip-2s": ["Two-seam / sinker grip", "Agarre de dos costuras"],
    "grip-change": ["Changeup grip", "Agarre del cambio"], "grip-adjust": ["Small grip adjustments", "Pequeños ajustes del agarre"],
    "grip-adjust-thumb": ["Move the thumb", "Mueve el pulgar"], "grip-adjust-spread": ["Spread the fingers", "Separa los dedos"],
    "delivery-side": ["The delivery at foot strike", "La entrega al caer el pie"], "delivery-a": ["Illustrated rep A", "Repetición ilustrada A"], "delivery-b": ["Illustrated rep B", "Repetición ilustrada B"],
    "ready-position": ["Ready position", "Posición de preparación"], "glove-position": ["Glove position", "Posición del guante"], "ground-ball": ["Fielding a ground ball", "Fildear un roletazo"],
    "footwork-angle": ["First step and angle", "Primer paso y ángulo"], "throwing-setup": ["Throwing setup", "Preparación para tirar"],
    infield: ["The infield", "El cuadro"], "infield-shade": ["Shading a few steps", "Moverse unos pasos"],
  };

  function render(id, o) {
    const f = FIGURES[id]; if (!f) return null;
    return C[f[0]](Object.assign({}, f[1] || {}, o || {}));
  }
  /** a figure card: title, diagram, caption, expand */
  function draw(id, opts) {
    const o = opts || {};
    const g = render(id, o); if (!g) return null;
    const c = ctx(), tt = TITLES[id] || [id, ""];
    const [title, sub] = c.target === "es" ? [o.title || tt[0], tt[1]] : [o.title || tt[0], c.native === "es" ? tt[1] : ""];
    const fig = document.createElement("figure"); fig.className = "fgc" + (o.compact ? " fgc--compact" : "");
    const head = document.createElement("figcaption"); head.className = "fgc__head";
    const k = document.createElement("span"); k.className = "fgc__kicker"; k.textContent = "Figure";
    const h = document.createElement("span"); h.className = "fgc__title"; h.textContent = title;
    head.append(k, h);
    if (sub) { const sb = document.createElement("span"); sb.className = "fgc__sub"; sb.lang = c.target === "es" ? "en" : "es"; sb.textContent = sub; head.append(sb); }
    const ex = document.createElement("button"); ex.type = "button"; ex.className = "fgc__expand"; ex.textContent = "Expand"; ex.setAttribute("aria-label", "Expand the figure: " + title);
    ex.onclick = () => expand(id, o, title, sub);
    head.append(ex);
    const box = document.createElement("div"); box.className = "fgc__art"; box.append(g);
    box.onclick = (e) => { if (window.matchMedia("(max-width: 759px)").matches && !e.target.closest("button")) expand(id, o, title, sub); };
    fig.append(head, box);
    if (o.caption) { const cp = document.createElement("p"); cp.className = "fgc__cap"; cp.textContent = o.caption; fig.append(cp); if (o.caption_tr) { const tr = document.createElement("p"); tr.className = "fgc__cap fgc__cap--tr"; tr.textContent = o.caption_tr; fig.append(tr); } }
    return fig;
  }
  /** full-screen sheet with a large version of the diagram */
  function expand(id, o, title, sub) {
    const d = document.createElement("dialog"); d.className = "fgsheet"; d.setAttribute("aria-label", title);
    const top = document.createElement("div"); top.className = "fgsheet__top";
    const t = document.createElement("div"); t.innerHTML = ""; const a = document.createElement("strong"); a.textContent = title; t.append(a);
    if (sub) { const b = document.createElement("span"); b.className = "fgc__sub"; b.textContent = sub; t.append(b); }
    const close = document.createElement("button"); close.type = "button"; close.className = "btn btn--ghost btn--sm"; close.textContent = "Close";
    close.onclick = () => d.close();
    top.append(t, close);
    const art = document.createElement("div"); art.className = "fgsheet__art"; art.append(render(id, o));
    d.append(top, art);
    if (o.caption) { const cp = document.createElement("p"); cp.className = "fgc__cap"; cp.textContent = o.caption; d.append(cp); }
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    document.body.append(d); d.showModal(); close.focus();
  }
  window.CPEFig = { draw, render, ids: Object.keys(FIGURES), components: C };
})();
