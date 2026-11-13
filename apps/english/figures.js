/* English (CP English) — instructional graphics system, v3: "schematic but representative".

   Acceptance standard (english/content/GRAPHICS.md): a learner names the subject within 1–2 seconds without the labels;
   the teaching point is visually obvious; labels support the image, they never rescue it; it reads at phone size.

   Shared vocabulary (one drawing language for the whole library):
     athlete(J, o)   a filled athletic silhouette from joint positions — tapered limbs, torso, capped head, shoes, far limbs
                     toned back, near limbs separated by a knockout outline (no stick figures)
     glove(...)      a fielder's glove: four finger stalls, thumb, web, heel and pocket, oriented fingers up/down/out
     ball(...)       a baseball with horseshoe seams and stitching; ballSm for small balls in body diagrams
     gripHand(...)   a pitcher's hand holding the ball, seen from behind (knuckles, nails, curled fingers)
     sideGrip(...)   the hand and ball in profile (thumb placement)
     shoePrint(...)  a top-view cleat print, for footwork
     label/lead/arrow: bilingual callouts (language being learned first), leaders, cue arrows
   Colours come from app.css tokens (cream, charcoal, oxblood for the one emphasis, taupe for secondary).
   draw(id, opts) → <figure> card (title, diagram, caption, highlight, Expand sheet on phones). */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
    kids.flat(4).forEach((k) => k != null && k !== false && el.append(typeof k === "string" ? document.createTextNode(k) : k));
    return el;
  }
  const ctx = () => (window.CPEContext ? window.CPEContext() : { target: "en", native: "es" });
  const R = (d) => (d * Math.PI) / 180;
  const P = (pts) => pts.map((p) => p.map((v) => Math.round(v * 10) / 10).join(",")).join(" ");

  /* ---------------- bilingual labels ---------------- */
  const T = {
    seams: ["Seams", "las costuras"], ball: ["Ball", "la pelota"], horseshoe: ["Horseshoe", "la herradura"],
    o4: ["Four-seam orientation", "orientación de cuatro costuras"], o2: ["Two-seam orientation", "orientación de dos costuras"],
    o4n: ["Fingers cross the horseshoe", "los dedos cruzan la herradura"], o2n: ["Fingers ride the seams", "los dedos van sobre las costuras"],
    thumb: ["Thumb", "el pulgar"], index: ["Index finger", "el dedo índice"], middle: ["Middle finger", "el dedo medio"],
    ring: ["Ring finger", "el dedo anular"], pinky: ["Pinky", "el meñique"], palm: ["Palm", "la palma"], tips: ["Fingertips (pads)", "las yemas de los dedos"],
    wrist: ["Wrist", "la muñeca"], knuckles: ["Knuckles", "los nudillos"],
    fourSeam: ["Four-seam fastball", "la recta de cuatro costuras"], twoSeam: ["Two-seam / sinker", "de dos costuras / el sinker"], change: ["Changeup", "el cambio"],
    across: ["Index + middle across the seams", "índice y medio sobre las costuras"], along: ["Index + middle along the seams", "índice y medio a lo largo de las costuras"],
    thumbUnder: ["Thumb underneath", "el pulgar debajo"], deeper: ["Ball deeper in the hand", "la pelota más profunda en la mano"], circle: ["Thumb + index circle", "círculo con pulgar e índice"],
    threeTop: ["Middle + ring on top", "medio y anular arriba"], ringSide: ["Ring + pinky on the side", "anular y meñique al lado"],
    moveThumb: ["Move the thumb a little", "mueve el pulgar un poquito"], spread: ["Spread the fingers a little", "separa un poco los dedos"],
    thumbSide: ["Thumb on the side", "pulgar al lado"], thumbBelow: ["Thumb under the ball", "pulgar debajo de la pelota"],
    together: ["Fingers together", "dedos juntos"], apart: ["A little apart", "un poco separados"],
    balance: ["Balance and posture", "balance y postura"], stride: ["Stride toward the plate", "el paso hacia el plato"], frontSide: ["Front side (glove side)", "el lado de adelante"],
    release: ["Release out front", "suelta la pelota adelante"], toPlate: ["To the plate", "hacia el plato"], rubber: ["Rubber", "la goma"],
    hips: ["Hips", "las caderas"], shoulder: ["Front shoulder", "el hombro de adelante"], frontFoot: ["Front foot lands", "cae el pie de adelante"],
    open: ["Front shoulder already open", "el hombro de adelante ya abrió"], closed: ["Front shoulder still closed", "el hombro sigue cerrado"],
    feetWide: ["Feet wider than shoulders", "pies más abiertos que los hombros"], knees: ["Knees bent", "rodillas dobladas"], weight: ["Weight on the balls of the feet", "el peso adelante, en la punta de los pies"],
    gloveOut: ["Glove out front, open", "el guante al frente, abierto"], eyes: ["Eyes on the ball", "la vista en la pelota"], low: ["Stay low, back flat", "quédate abajo, espalda recta"],
    fingersDown: ["Ball below the waist: fingers down", "abajo de la cintura: dedos hacia abajo"], fingersUp: ["Ball above the waist: fingers up", "arriba de la cintura: dedos hacia arriba"],
    waist: ["Waist", "la cintura"], triangle: ["Feet and glove make a triangle", "pies y guante forman un triángulo"], fromAbove: ["From above", "vista desde arriba"],
    throwHand: ["Throwing hand on top", "la mano de tirar encima"],
    firstStep: ["First step: open toward the ball", "primer paso: abre hacia la pelota"], angle: ["Take a good angle", "toma un buen ángulo"], through: ["Work through the ball", "ve hacia la pelota"], ballPath: ["Ground ball", "el roletazo"],
    start: ["Ready", "listo"], fieldIt: ["Field it", "fildea"],
    target: ["Target: first base", "el objetivo: primera base"], setFeet: ["Set your feet in line", "planta los pies en línea"], lane: ["Throwing lane", "línea de tiro"], gloveShoulder: ["Glove shoulder to the target", "hombro del guante hacia el objetivo"],
    positions: ["Infield positions", "las posiciones del cuadro"], shade: ["Shade a few steps toward the middle", "unos pasos hacia el medio"],
  };
  const words = (k) => { const t = T[k] || [k, ""]; return ctx().target === "es" ? [t[1] || t[0], t[0]] : [t[0], t[1]]; };
  function wrap(t, n) {
    const out = []; let cur = "";
    for (const w of String(t || "").split(" ")) { if (cur && (cur + " " + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    if (cur) out.push(cur); return out;
  }
  /** callout label: primary (the language being learned) then secondary (taupe italic), wrapped to o.w characters */
  function label(x, y, key, o) {
    const [a, b] = words(key), anchor = (o && o.anchor) || "start", n = (o && o.w) || 24, spans = [];
    wrap(a, n).forEach((t, i) => spans.push(s("tspan", { class: "fg__p", x, dy: i ? "14" : null }, t)));
    if (b) wrap(b, n + 2).forEach((t, i) => spans.push(s("tspan", { class: "fg__s", x, dy: i ? "12.5" : "13" }, t)));
    return s("text", { x, y, class: "fg__lbl" + (o && o.hl ? " fg__lbl--hl" : ""), "text-anchor": anchor }, spans);
  }
  const ln = (x1, y1, x2, y2, cls) => s("line", { x1, y1, x2, y2, class: cls || "fg__lead" });
  const lead = (x1, y1, x2, y2) => [ln(x1, y1, x2, y2), s("circle", { cx: x1, cy: y1, r: 2.6, class: "fg__leaddot" })];
  function arrow(x1, y1, x2, y2, cls, curve) {
    const a = Math.atan2(y2 - y1, x2 - x1), L = 8, w = 0.45;
    const p1 = [x2 - L * Math.cos(a - w), y2 - L * Math.sin(a - w)], p2 = [x2 - L * Math.cos(a + w), y2 - L * Math.sin(a + w)];
    const body = curve ? s("path", { d: `M ${x1} ${y1} Q ${curve[0]} ${curve[1]} ${x2 - 4 * Math.cos(a)} ${y2 - 4 * Math.sin(a)}`, fill: "none" })
      : s("line", { x1, y1, x2: x2 - 4 * Math.cos(a), y2: y2 - 4 * Math.sin(a) });
    return s("g", { class: cls || "fg__arrow" }, body, s("polygon", { points: `${x2},${y2} ${p1.join(",")} ${p2.join(",")}` }));
  }
  const svg = (w, h, title, ...kids) => s("svg", { viewBox: `0 0 ${w} ${h}`, class: "fg", role: "img", "aria-label": title }, s("title", {}, title), ...kids);
  const cap = (x, y, t) => s("text", { x, y, class: "fg__cap" }, t);
  const ground = (x1, x2, y) => [s("line", { x1, y1: y, x2, y2: y, class: "fg__ground" }), s("rect", { x: x1, y: y + 1, width: x2 - x1, height: 7, class: "fg__dirt" })];

  /* ---------------- primitives: limbs, athlete ---------------- */
  /** a tapered capsule from p1 (width w1) to p2 (width w2) */
  function capsule(p1, p2, w1, w2, cls) {
    const a = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), nx = -Math.sin(a), ny = Math.cos(a), r1 = w1 / 2, r2 = w2 / 2;
    const A1 = [p1[0] + nx * r1, p1[1] + ny * r1], B1 = [p1[0] - nx * r1, p1[1] - ny * r1], A2 = [p2[0] + nx * r2, p2[1] + ny * r2], B2 = [p2[0] - nx * r2, p2[1] - ny * r2];
    return s("path", { d: `M ${A1} L ${A2} A ${r2} ${r2} 0 0 0 ${B2} L ${B1} A ${r1} ${r1} 0 0 0 ${A1} Z`, class: cls });
  }
  /** a cleated shoe in profile from ankle to toe */
  function shoe(an, to, cls) {
    const a = Math.atan2(to[1] - an[1], to[0] - an[0]), len = Math.hypot(to[0] - an[0], to[1] - an[1]);
    return s("g", { transform: `translate(${an[0]} ${an[1]}) rotate(${(a * 180) / Math.PI})`, class: cls },
      s("path", { d: `M -4 -5 C 2 -7 ${len - 6} -5 ${len} -1 C ${len + 2} 2 ${len - 1} 4 ${len - 4} 4 L -4 4 C -7 4 -7 -4 -4 -5 Z` }));
  }
  /** a filled athletic figure. J: head, neck (top of spine), pelvis, shN/shF, elN/elF, haN/haF, hipN/hipF, knN/knF, anN/anF, toN/toF; o.face ±1 */
  function athlete(J, o) {
    const opt = o || {}, face = opt.face || 1;
    const far = "fg__far", near = "fg__near";
    const KO = (el) => { const k = el.cloneNode(true); k.setAttribute("class", "fg__ko"); return [k, el]; };
    const torso = (() => {
      const a = Math.atan2(J.pelvis[1] - J.neck[1], J.pelvis[0] - J.neck[0]), nx = -Math.sin(a), ny = Math.cos(a);
      const cw = opt.chest || 12, hw = opt.hipw || 10.5;
      const c1 = [J.neck[0] + nx * cw, J.neck[1] + ny * cw], c2 = [J.neck[0] - nx * cw, J.neck[1] - ny * cw];
      const h1 = [J.pelvis[0] + nx * hw, J.pelvis[1] + ny * hw], h2 = [J.pelvis[0] - nx * hw, J.pelvis[1] - ny * hw];
      return s("path", { d: `M ${c1} Q ${(c1[0] + h1[0]) / 2 + nx * 2} ${(c1[1] + h1[1]) / 2 + ny * 2} ${h1} L ${h2} Q ${(c2[0] + h2[0]) / 2 - nx * 2} ${(c2[1] + h2[1]) / 2 - ny * 2} ${c2} Z`, class: near + " fg__torso" });
    })();
    const H = J.head;
    const head = s("g", {},
      s("circle", { cx: H[0], cy: H[1], r: 10.5, class: near }),
      s("path", { d: `M ${H[0] - 10.8} ${H[1] - 1.5} A 10.8 10.8 0 0 1 ${H[0] + 10.8} ${H[1] - 1.5} Z`, class: "fg__capc" }),
      s("path", { d: `M ${H[0] + face * 6} ${H[1] - 2.2} L ${H[0] + face * 19} ${H[1] - 0.5} L ${H[0] + face * 18} ${H[1] + 1.4} L ${H[0] + face * 5} ${H[1] + 0.6} Z`, class: "fg__capc" }));
    const neck = capsule(J.neck, [H[0] - face * 1, H[1] + 6], 9, 8, near);
    const farLeg = [capsule(J.hipF, J.knF, 15, 12, far), capsule(J.knF, J.anF, 12, 8.5, far), shoe(J.anF, J.toF, far)];
    const farArm = [capsule(J.shF, J.elF, 10, 8.5, far), capsule(J.elF, J.haF, 8.5, 7, far)];
    const nearLeg = [capsule(J.hipN, J.knN, 16, 12.5, near), capsule(J.knN, J.anN, 12.5, 9, near), shoe(J.anN, J.toN, near)];
    const nearArm = [capsule(J.shN, J.elN, 10.5, 9, near), capsule(J.elN, J.haN, 9, 7.5, near)];
    const belt = ln(...((() => { const a = Math.atan2(J.pelvis[1] - J.neck[1], J.pelvis[0] - J.neck[0]); const nx = -Math.sin(a) * 11, ny = Math.cos(a) * 11; const b = [J.pelvis[0] - Math.cos(a) * 6, J.pelvis[1] - Math.sin(a) * 6]; return [b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny]; })()), "fg__belt");
    return s("g", { class: "fg__athlete" },
      opt.noFarArm ? null : farArm, farLeg,
      nearLeg.map(KO), neck, torso, belt,
      opt.gloveFar ? opt.gloveFar : null,
      nearArm.map(KO), head, opt.extra || null);
  }
  /** a small ball (for body diagrams) */
  const ballSm = (cx, cy, r) => s("g", {}, s("circle", { cx, cy, r: r || 6, class: "fg__ballsm" }),
    s("path", { d: `M ${cx - (r || 6) * 0.45} ${cy - (r || 6) * 0.8} Q ${cx - (r || 6) * 0.05} ${cy} ${cx - (r || 6) * 0.45} ${cy + (r || 6) * 0.8}`, class: "fg__seamsm" }));

  /* ---------------- glove ---------------- */
  /** a fielder's glove drawn pocket-side (fingers up at rot 0), centred on the pocket; sc = scale */
  function glove(cx, cy, rot, sc, o) {
    const back = o && o.back;
    const stall = (x, top, w) => `M ${x - w / 2} 2 L ${x - w / 2} ${top + w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${top + w / 2} L ${x + w / 2} 2`;
    return s("g", { transform: `translate(${cx} ${cy}) rotate(${rot || 0}) scale(${sc || 1})`, class: "fg__glovegrp" },
      s("path", { d: "M -17 -4 C -22 -10 -24 -19 -21 -24 C -18 -27 -14 -24 -12 -18 L -10 -10 Z", class: "fg__glove" }),   // thumb
      s("path", { d: [stall(-7, -30, 6.5), stall(-0.5, -34, 6.5), stall(6, -32, 6.5), stall(12, -27, 6)].join(" ") + " Z", class: "fg__glove" }),
      s("path", { d: "M -16 -4 C -17 6 -14 14 -6 18 C 2 21 10 19 14 13 C 17 7 16 -2 15 -6 L -12 -10 Z", class: "fg__glove" }),        // heel / palm
      s("path", { d: "M -10.5 -9 L -11 -24 L -3 -27 L -3 -9 Z", class: "fg__web" }),                                                           // web
      s("path", { d: "M -10.5 -9 L -3 -27 M -11 -18 L -3 -18 M -11 -13 L -3 -13 M -7 -26 L -7 -9", class: "fg__lace" }),
      back ? null : s("ellipse", { cx: 0, cy: 2, rx: 9.5, ry: 8, class: "fg__pocket" }),
      s("path", { d: "M -14 15 C -6 21 8 20 14 13", class: "fg__lace" }),
      [-7, -0.5, 6, 12].map((x, i) => ln(x, [-26, -30, -28, -23][i], x, -10, "fg__seamline")));
  }

  /* ---------------- baseball ---------------- */
  /** a baseball; rot 0: horseshoe seams left/right (two-seam view across), 90: seams top/bottom */
  function ball(cx, cy, r, rot, o) {
    const seam = (side) => `M ${cx + side * r * 0.62} ${cy - r * 0.79} C ${cx + side * r * 0.12} ${cy - r * 0.3}, ${cx + side * r * 0.12} ${cy + r * 0.3}, ${cx + side * r * 0.62} ${cy + r * 0.79}`;
    return s("g", { class: o && o.cls },
      s("circle", { cx, cy, r, class: "fg__ball" }),
      s("path", { d: `M ${cx - r * 0.72} ${cy - r * 0.2} A ${r} ${r} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.95}`, class: "fg__shine" }),
      s("g", { transform: rot ? `rotate(${rot} ${cx} ${cy})` : null },
        [-1, 1].map((sd) => [s("path", { d: seam(sd), class: "fg__stitch" }), s("path", { d: seam(sd), class: "fg__seam" })])));
  }

  /* ---------------- hands ---------------- */
  /** one finger seen from the back of the hand: base (knuckle) → tip, curving onto the ball; nail near the tip */
  function backFinger(base, tip, w, o) {
    const opt = o || {}, a = Math.atan2(tip[1] - base[1], tip[0] - base[0]), nx = -Math.sin(a), ny = Math.cos(a), len = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
    const t = w * 0.86, r = t / 2;
    const at = (f, off) => [base[0] + (tip[0] - base[0]) * f + nx * off, base[1] + (tip[1] - base[1]) * f + ny * off];
    const A = at(0, w / 2), B = at(0, -w / 2), A2 = at(1, r), B2 = at(1, -r);
    const d = `M ${A} L ${A2} A ${r} ${r} 0 0 0 ${B2} L ${B} Z`;
    const nail = (() => { const c = at(0.86, 0); return s("rect", { x: c[0] - r * 0.62, y: c[1] - len * 0.08, width: r * 1.24, height: len * 0.17, rx: r * 0.55, transform: `rotate(${(a * 180) / Math.PI + 90} ${c[0]} ${c[1]})`, class: "fg__nail" }); })();
    const crease = (f) => { const c1 = at(f, r * 0.7), c2 = at(f, -r * 0.7); return s("path", { d: `M ${c1} Q ${at(f + 0.03, 0)} ${c2}`, class: "fg__crease" }); };
    return s("g", { class: (opt.cls || "") + " fg__finger", "data-part": opt.part },
      s("path", { d, class: "fg__skin" + (opt.ghost ? " fg__skin--ghost" : "") }), opt.ghost ? null : [crease(0.38), crease(0.66), nail]);
  }
  /** the back of a right hand: knuckle bumps along the top, tapering to the wrist */
  function handBack(cx, top, w, h) {
    const X = (f) => cx + f * w, d = `M ${X(-0.5)} ${top + 20} C ${X(-0.5)} ${top + 6} ${X(-0.44)} ${top - 2} ${X(-0.33)} ${top - 1}
      Q ${X(-0.22)} ${top + 5} ${X(-0.1)} ${top - 4} Q ${X(0.02)} ${top + 4} ${X(0.13)} ${top - 2} Q ${X(0.24)} ${top + 5} ${X(0.34)} ${top + 2}
      C ${X(0.46)} ${top + 2} ${X(0.52)} ${top + 14} ${X(0.5)} ${top + 28} C ${X(0.48)} ${top + h * 0.62} ${X(0.3)} ${top + h} ${X(0.25)} ${top + h + 18}
      L ${X(-0.27)} ${top + h + 18} C ${X(-0.32)} ${top + h} ${X(-0.52)} ${top + h * 0.55} ${X(-0.5)} ${top + 20} Z`;
    return s("g", {}, s("path", { d, class: "fg__skin fg__handback" }),
      [-0.33, -0.1, 0.13, 0.34].map((f) => s("path", { d: `M ${X(f)} ${top + 8} Q ${X(f * 0.8)} ${top + h * 0.45} ${X(f * 0.5)} ${top + h * 0.8}`, class: "fg__crease" })));
  }
  /** a curved band of skin hugging the ball (side-profile fingers and thumb); angles in degrees, 0 = right, 90 = down */
  function band(cx, cy, rad, a1, a2, w, o) {
    const p = (a) => [cx + Math.cos(R(a)) * rad, cy + Math.sin(R(a)) * rad];
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0, sweep = a2 > a1 ? 1 : 0;
    const d = `M ${p(a1)} A ${rad} ${rad} 0 ${large} ${sweep} ${p(a2)}`;
    const ghost = o && o.ghost;
    return s("g", { class: (o && o.cls) || "" }, ghost ? s("path", { d, class: "fg__bandghost", "stroke-width": w }) : [s("path", { d, class: "fg__bandout", "stroke-width": w + 2.6 }), s("path", { d, class: "fg__bandin", "stroke-width": w })],
      ghost || !(o && o.nail) ? null : s("circle", { cx: p(a2)[0], cy: p(a2)[1], r: w * 0.26, class: "fg__nail" }));
  }
  /** a grip seen from behind the pitcher's hand (fingers on top of the ball, knuckles toward the viewer) */
  function gripHand(variant, hl, o) {
    const cx = 120, cy = 112, r = 76, H = new Set(hl || []);
    const opt = o || {};
    const fc = (k) => (H.has(k) ? "fg--hl" : "");
    if (variant === "change") {
      return s("g", {},
        ball(cx, cy, r, 20),
        handBack(cx + 4, cy + 34, 118, 64),
        backFinger([cx - 16, cy + 36], [cx - 22, cy - 50], 24, { part: "middle", cls: fc("middle") }),
        backFinger([cx + 12, cy + 36], [cx + 12, cy - 46], 23, { part: "ring", cls: fc("ring") }),
        backFinger([cx + 36, cy + 40], [cx + 62, cy - 4], 20, { part: "pinky" }),
        s("g", { "data-part": "circle", class: fc("circle") },
          capsule([cx - 40, cy + 40], [cx - 62, cy + 14], 19, 17, "fg__skin"),
          s("circle", { cx: cx - 66, cy: cy + 4, r: 20, class: "fg__skin" }), s("circle", { cx: cx - 66, cy: cy + 4, r: 8.5, class: "fg__hole" }),
          s("path", { d: `M ${cx - 84} ${cy + 2} Q ${cx - 66} ${cy - 2} ${cx - 50} ${cy + 10}`, class: "fg__crease" })));
    }
    const four = variant === "four";
    const gap = opt.gap != null ? opt.gap : 26;
    return s("g", {},
      ball(cx, cy, r, four ? 90 : 0),
      handBack(cx + 2, cy + 44, 110, 58),
      s("g", { class: "fg__thumbcue" + (H.has("thumb") ? " fg--hl" : "") }, capsule([cx + 2, cy + 82], [cx + 2, cy + 50], 22, 19, "fg__skin fg__skin--ghost")),
      backFinger([cx + 44, cy + 48], [cx + 66, cy + 6], 20, { part: "ring", cls: "fg__curled" }),
      opt.ghostGap != null ? [backFinger([cx - opt.ghostGap / 2, cy + 46], [cx - opt.ghostGap / 2 - 2, cy - 52], 23, { ghost: true }), backFinger([cx + opt.ghostGap / 2, cy + 46], [cx + opt.ghostGap / 2 + 2, cy - 56], 24, { ghost: true })] : null,
      backFinger([cx - gap / 2, cy + 46], [cx - gap / 2 - 2, cy - 52], 23, { part: "index", cls: fc("index") }),
      backFinger([cx + gap / 2, cy + 46], [cx + gap / 2 + 2, cy - 56], 24, { part: "middle", cls: fc("middle") }));
  }
  /** the hand and ball in profile (thumb side): index finger over the top, thumb under the ball (thumbAt "under" | "side") */
  function sideGrip(cx, cy, r, thumbAt, ghost) {
    const thumbArc = (at) => (at === "side" ? [184, 150] : [150, 98]);
    return s("g", {},
      capsule([cx - r - 44, cy + 66], [cx - r - 10, cy + 18], 30, 34, "fg__skin"),
      s("ellipse", { cx: cx - r - 8, cy: cy + 8, rx: 22, ry: 30, class: "fg__skin" }),
      ball(cx, cy, r, 90),
      ghost ? band(cx, cy, r + 7, ...thumbArc(ghost), 15, { ghost: true }) : null,
      band(cx, cy, r + 7, ...thumbArc(thumbAt), 15, { cls: "fg--hl", nail: true }),
      band(cx, cy, r + 8, 196, 318, 16, { nail: true }));
  }

  /* ---------------- shoe prints (top view) ---------------- */
  function shoePrint(x, y, rot, o) {
    return s("g", { transform: `translate(${x} ${y}) rotate(${rot || 0})`, class: "fg__print" + (o && o.ghost ? " fg__print--ghost" : "") + (o && o.hl ? " fg__print--hl" : "") },
      s("path", { d: "M -5 -13 C -2 -16 3 -16 5.5 -12 C 7 -7 6 -2 4.5 1 L 4 5 C 5 9 3 14 0 14 C -3 14 -5 10 -4.5 6 L -5.5 0 C -7 -4 -7 -9 -5 -13 Z" }),
      s("path", { d: "M -2 -9 L 2 -9 M -3 -4 L 3 -4 M -1.5 9 L 1.5 9", class: "fg__cleat" }));
  }

  /* ---------------- components ---------------- */
  const C = {};

  C.SeamDiagram = () => svg(340, 220, "A baseball and its seams", ball(110, 110, 80, 0),
    lead(164, 52, 206, 40), label(212, 38, "seams"),
    label(212, 100, "ball"),
    lead(152, 170, 206, 168), label(212, 166, "horseshoe"));

  C.SeamOrientationDiagram = () => svg(360, 270, "Seam orientation: four-seam and two-seam views",
    ball(90, 100, 62, 90), ball(270, 100, 62, 0),
    s("g", { class: "fg__guide" }, ln(72, 30, 72, 172), ln(108, 30, 108, 172), ln(252, 30, 252, 172), ln(288, 30, 288, 172)),
    label(20, 190, "o4", { hl: true, w: 30 }), label(20, 228, "o4n", { w: 22 }),
    label(200, 190, "o2", { hl: true, w: 30 }), label(200, 228, "o2n", { w: 22 }),
    ln(180, 20, 180, 240, "fg__divider"));

  /* an open right hand, palm side (thumb on the viewer's right), numbered fingers */
  C.HandDiagram = (o) => {
    const hl = new Set((o && o.highlight) || []);
    const fingers = { pinky: [[64, 132], -12, 50, 17], ring: [[88, 124], -5, 68, 19], middle: [[113, 121], 0, 76, 20], index: [[138, 124], 6, 68, 19] };
    const f = (k) => {
      const [b, ang, len, w] = fingers[k], tip = [b[0] + Math.sin(R(ang)) * len, b[1] - Math.cos(R(ang)) * len];
      const g = capsule(b, tip, w, w * 0.84, "fg__skin");
      const pad = s("ellipse", { cx: tip[0] - Math.sin(R(ang)) * 4, cy: tip[1] + Math.cos(R(ang)) * 4, rx: w * 0.3, ry: w * 0.38, transform: `rotate(${ang} ${tip[0]} ${tip[1]})`, class: "fg__pad" });
      const cr = (t) => { const c = [b[0] + (tip[0] - b[0]) * t, b[1] + (tip[1] - b[1]) * t]; return ln(c[0] - w * 0.32, c[1] + 0.5, c[0] + w * 0.32, c[1] - 0.5, "fg__crease"); };
      return s("g", { class: hl.has(k) ? "fg--hl" : "", "data-part": k }, g, cr(0.42), cr(0.7), pad);
    };
    const num = (x, y, n, part) => s("g", { class: "fg__num" + (hl.has(part) ? " fg__num--hl" : "") }, s("circle", { cx: x, cy: y, r: 8.5 }), s("text", { x, y: y + 3.6, "text-anchor": "middle" }, String(n)));
    const thumbTip = [196, 128];
    return svg(360, 262, "An open right hand, palm side, with the fingers numbered",
      ["pinky", "ring", "middle", "index"].map(f),
      s("g", { class: hl.has("thumb") ? "fg--hl" : "", "data-part": "thumb" }, capsule([154, 196], thumbTip, 26, 19, "fg__skin"),
        s("ellipse", { cx: 192, cy: 133, rx: 6, ry: 8, transform: "rotate(52 192 133)", class: "fg__pad" }), ln(168, 168, 180, 160, "fg__crease")),
      s("path", { d: "M 56 140 C 52 180 58 214 78 238 L 82 262 L 142 262 L 144 240 C 160 224 168 206 166 188 C 162 160 150 136 146 124 C 120 116 82 118 56 132 Z", class: "fg__skin fg__palmfill" }),
      s("path", { d: "M 56 140 C 52 180 58 214 78 238 L 82 262 M 142 262 L 144 240 C 160 224 168 206 166 188", class: "fg__outline" }),
      s("path", { d: "M 70 168 C 92 158 122 156 146 164 M 80 196 C 100 186 124 184 142 190 M 128 230 C 122 210 128 186 146 168", class: "fg__crease" }),
      num(56, 74, 5, "pinky"), num(80, 50, 4, "ring"), num(113, 40, 3, "middle"), num(150, 50, 2, "index"), num(208, 112, 1, "thumb"),
      s("text", { x: 108, y: 214, class: "fg__lbl", "text-anchor": "middle" }, s("tspan", { class: "fg__p", x: 108 }, words("palm")[0]), s("tspan", { class: "fg__s", x: 108, dy: 13 }, words("palm")[1])),
      [["thumb", 1], ["index", 2], ["middle", 3], ["ring", 4], ["pinky", 5]].map(([k, n], i) => s("g", {}, num(240, 32 + i * 36, n, k), label(256, 36 + i * 36, k, { hl: hl.has(k), w: 15 }))),
      s("ellipse", { cx: 240, cy: 214, rx: 6, ry: 8, class: "fg__pad fg__pad--key" }), label(256, 212, "tips", { hl: hl.has("tips"), w: 15 }));
  };

  C.GripDiagram = (o) => {
    const v = (o && o.variant) || "four-seam", hl = (o && o.highlight) || [];
    const key = v === "four-seam" ? "four" : v === "two-seam" ? "two" : "change";
    const L = key === "four" ? [["fourSeam", 30, true], ["across", 86], ["thumbUnder", 146]] : key === "two" ? [["twoSeam", 30, true], ["along", 86], ["thumbUnder", 146]]
      : [["change", 30, true], ["threeTop", 76], ["circle", 124], ["deeper", 172]];
    const title = { four: "Four-seam grip, seen from behind the hand", two: "Two-seam grip, seen from behind the hand", change: "Changeup grip, seen from behind the hand" }[key];
    return svg(380, 268, title, gripHand(key, hl),
      L.map(([k, y, h]) => label(236, y, k, { hl: h, w: 19 })),
      key === "change" ? lead(60, 120, 230, 124) : lead(key === "four" ? 110 : 108, 74, 230, 82),
      key !== "change" ? [s("path", { d: "M 98 190 Q 120 206 142 190", class: "fg__dashcue" }), lead(120, 200, 230, 150)] : lead(150, 170, 230, 170),
      cap(10, 262, "View: from behind the pitcher's hand · right-handed"));
  };

  C.GripAdjustDiagram = (o) => {
    const v = (o && o.variant) || "both";
    const thumbPanel = (x) => s("g", { transform: `translate(${x} 0)` },
      sideGrip(110, 108, 50, "under", "side"),
      arrow(46, 128, 92, 168, "fg__arrow fg__arrow--hl", [44, 166]),
      label(10, 222, "moveThumb", { hl: true, w: 22 }));
    const spreadPanel = (x) => s("g", { transform: `translate(${x} 0) scale(0.72) translate(24 2)` },
      gripHand("four", [], { gap: 40, ghostGap: 24 }),
      arrow(110, 40, 84, 40, "fg__arrow fg__arrow--hl"), arrow(132, 40, 158, 40, "fg__arrow fg__arrow--hl"));
    if (v === "thumb") { const g = svg(200, 262, "Move the thumb under the ball", thumbPanel(0)); g.classList.add("fg--narrow"); return g; }
    if (v === "spread") { const g = svg(200, 262, "Spread the fingers a little", spreadPanel(4), label(10, 222, "spread", { hl: true, w: 22 })); g.classList.add("fg--narrow"); return g; }
    return svg(380, 262, "Two grip adjustments: move the thumb, spread the fingers",
      thumbPanel(0), ln(190, 16, 190, 250, "fg__divider"), spreadPanel(196), label(206, 222, "spread", { hl: true, w: 22 }));
  };

  /* the delivery: side view at front-foot strike (right-handed pitcher facing right), or top views of two illustrated reps */
  C.DeliveryDiagram = (o) => {
    const v = (o && o.variant) || "side", hl = new Set((o && o.highlight) || []);
    if (v === "side") {
      const J = { head: [170, 70], neck: [164, 88], pelvis: [146, 140], shN: [170, 92], shF: [160, 90], elN: [138, 76], haN: [122, 50], elF: [190, 96], haF: [206, 112],
        hipN: [142, 142], hipF: [152, 142], knN: [112, 166], anN: [82, 196], toN: [100, 198], knF: [196, 152], anF: [228, 194], toF: [246, 196] };
      return svg(380, 270, "A pitcher's delivery at front-foot strike, side view",
        s("path", { d: "M 10 202 C 60 192 120 194 180 200 L 370 206", class: "fg__mound" }), s("rect", { x: 74, y: 197, width: 22, height: 5, class: "fg__rubber" }),
        athlete(J, { face: 1, gloveFar: glove(212, 114, 100, 0.42, { back: true }), extra: ballSm(120, 46, 5.5) }),
        arrow(214, 222, 300, 222, "fg__arrow" + (hl.has("stride") ? " fg__arrow--hl" : "")),
        s("circle", { cx: 250, cy: 74, r: 15, class: "fg__zone" + (hl.has("release") ? " fg__zone--hl" : "") }),
        lead(170, 64, 266, 22), label(272, 20, "balance", { hl: hl.has("balance"), w: 15 }),
        lead(258, 80, 290, 88), label(296, 86, "release", { hl: hl.has("release"), w: 13 }),
        lead(206, 110, 290, 152), label(296, 150, "frontSide", { hl: hl.has("frontSide"), w: 13 }),
        label(214, 242, "stride", { hl: hl.has("stride"), w: 26 }), label(16, 228, "rubber"));
    }
    // top view: head, shoulders and hips from above, cleat prints, direction to the plate
    const open = v === "open", W = 380, H = 240, cx = 186, cy = 128;
    const bar = (deg, len, w, cls) => { const a = R(deg); return capsule([cx - Math.cos(a) * len, cy - Math.sin(a) * len], [cx + Math.cos(a) * len, cy + Math.sin(a) * len], w, w, cls); };
    const sh = open ? -34 : -5, sx = cx + Math.cos(R(sh)) * 44, sy = cy + Math.sin(R(sh)) * 44;
    return svg(W, H, open ? "Illustrated rep A, from above: the front shoulder opens early" : "Illustrated rep B, from above: the front shoulder stays closed longer",
      label(14, 26, open ? "open" : "closed", { hl: true, w: 30 }),
      ln(40, cy, 350, cy, "fg__dir"), arrow(330, cy, 364, cy), label(364, cy + 24, "toPlate", { anchor: "end" }),
      s("rect", { x: 30, y: cy - 13, width: 8, height: 26, class: "fg__rubber" }),
      shoePrint(70, cy + 14, 90), shoePrint(290, cy + 8, 78, { hl: true }),
      bar(-10, 32, 22, "fg__hipsbar"), bar(sh, 44, 18, "fg__shbar"),
      s("circle", { cx, cy: cy, r: 13, class: "fg__headtop" }), s("path", { d: `M ${cx + 6} ${cy - 9} Q ${cx + 22} ${cy} ${cx + 6} ${cy + 9}`, class: "fg__brim" }),
      s("circle", { cx: sx, cy: sy, r: 5, class: "fg__hldot" }),
      lead(cx - 22, cy + 8, cx - 52, cy + 44), label(cx - 52, cy + 58, "hips", { anchor: "middle" }),
      lead(sx, sy, 262, 58), label(268, 56, "shoulder", { w: 16 }),
      lead(290, cy + 22, 290, cy + 44), label(290, cy + 58, "frontFoot", { anchor: "middle", w: 18 }),
      cap(14, H - 6, `Rep ${open ? "A" : "B"} · seen from above at foot strike · illustration, not a real pitcher`));
  };

  /* infielder's ready position, front view */
  C.ReadyPositionDiagram = (o) => {
    const hl = new Set((o && o.highlight) || []);
    const cx = 116;
    const J = { head: [cx, 62], neck: [cx, 80], pelvis: [cx, 132], shN: [cx - 20, 86], shF: [cx + 20, 86], elN: [cx - 26, 118], haN: [cx - 18, 146], elF: [cx + 26, 118], haF: [cx + 16, 146],
      hipN: [cx - 11, 134], hipF: [cx + 11, 134], knN: [cx - 34, 166], anN: [cx - 40, 200], toN: [cx - 52, 204], knF: [cx + 34, 166], anF: [cx + 40, 200], toF: [cx + 52, 204] };
    const front = (J) => {
      const KO = (el) => { const k = el.cloneNode(true); k.setAttribute("class", "fg__ko"); return [k, el]; };
      const legs = ["N", "F"].map((x) => [capsule(J["hip" + x], J["kn" + x], 16, 12.5, "fg__near"), capsule(J["kn" + x], J["an" + x], 12.5, 9, "fg__near"), shoe(J["an" + x], J["to" + x], "fg__near")]);
      const arms = ["N", "F"].map((x) => [capsule(J["sh" + x], J["el" + x], 10.5, 9, "fg__near"), capsule(J["el" + x], J["ha" + x], 9, 7.5, "fg__near")]);
      return s("g", { class: "fg__athlete" }, legs.flat().map(KO),
        s("path", { d: `M ${cx - 22} 84 C ${cx - 22} 110 ${cx - 15} 128 ${cx - 13} 138 L ${cx + 13} 138 C ${cx + 15} 128 ${cx + 22} 110 ${cx + 22} 84 C ${cx + 12} 78 ${cx - 12} 78 ${cx - 22} 84 Z`, class: "fg__near" }),
        ln(cx - 13, 132, cx + 13, 132, "fg__belt"), capsule([cx, 82], [cx, 70], 9, 8, "fg__near"),
        arms.flat().map(KO),
        s("circle", { cx, cy: 62, r: 10.5, class: "fg__near" }), s("path", { d: `M ${cx - 10.8} 60.5 A 10.8 10.8 0 0 1 ${cx + 10.8} 60.5 Z`, class: "fg__capc" }),
        s("path", { d: `M ${cx - 11} 60 L ${cx + 11} 60 L ${cx + 8} 64 L ${cx - 8} 64 Z`, class: "fg__capc" }));
    };
    return svg(380, 250, "Infielder's ready position, front view", ground(20, 220, 206), front(J), glove(cx - 8, 158, 0, 0.62),
      s("g", { class: "fg__dimg" }, ln(cx - 52, 222, cx + 52, 222, "fg__dim"), ln(cx - 52, 218, cx - 52, 226, "fg__dim"), ln(cx + 52, 218, cx + 52, 226, "fg__dim")),
      lead(cx, 64, 236, 30), label(242, 28, "eyes", { w: 18 }),
      lead(cx - 8, 152, 236, 86), label(242, 84, "gloveOut", { hl: hl.has("glove"), w: 18 }),
      lead(cx + 34, 166, 236, 140), label(242, 138, "knees", { hl: hl.has("knees"), w: 18 }),
      lead(cx + 52, 218, 236, 192), label(242, 190, "feetWide", { hl: hl.has("feet"), w: 18 }));
  };

  /* glove position: two side-view fielders — a low ball (fingers down) and a chest-high ball (fingers up) */
  C.GlovePositionDiagram = () => {
    const low = { head: [96, 98], neck: [88, 112], pelvis: [62, 146], shN: [94, 116], shF: [86, 114], elN: [112, 148], haN: [124, 176], elF: [104, 150], haF: [118, 176],
      hipN: [58, 148], hipF: [66, 148], knN: [96, 166], anN: [96, 202], toN: [112, 204], knF: [44, 178], anF: [34, 202], toF: [50, 204] };
    const high = { head: [276, 48], neck: [272, 66], pelvis: [262, 122], shN: [278, 70], shF: [268, 68], elN: [298, 82], haN: [306, 64], elF: [290, 86], haF: [302, 70],
      hipN: [258, 124], hipF: [266, 124], knN: [276, 160], anN: [272, 202], toN: [288, 204], knF: [248, 162], anF: [240, 202], toF: [256, 204] };
    return svg(380, 278, "Glove position: fingers down for a low ball, fingers up for a high ball",
      ground(14, 180, 206), ground(200, 366, 206),
      ln(14, 128, 180, 128, "fg__waist"), ln(200, 128, 366, 128, "fg__waist"), s("text", { x: 178, y: 122, class: "fg__dimtx", "text-anchor": "end" }, words("waist")[0].toUpperCase()),
      athlete(low, { face: 1, gloveFar: null }), glove(130, 190, 180, 0.6), ballSm(148, 200, 5.5), arrow(130, 160, 130, 172, "fg__arrow fg__arrow--hl"),
      athlete(high, { face: 1 }), glove(312, 58, 0, 0.6), ballSm(336, 56, 5.5), arrow(312, 34, 312, 20, "fg__arrow fg__arrow--hl"),
      ln(190, 16, 190, 220, "fg__divider"),
      label(14, 238, "fingersDown", { hl: true, w: 24 }), label(200, 238, "fingersUp", { hl: true, w: 24 }));
  };

  /* fielding a ground ball: side view + the triangle from above */
  C.GroundBallDiagram = () => {
    const J = { head: [150, 108], neck: [140, 120], pelvis: [100, 140], shN: [146, 124], shF: [138, 122], elN: [164, 156], haN: [176, 184], elF: [156, 156], haF: [170, 182],
      hipN: [96, 142], hipF: [104, 142], knN: [140, 158], anN: [146, 200], toN: [162, 202], knF: [84, 176], anF: [70, 200], toF: [86, 202] };
    return svg(380, 296, "Fielding a ground ball: wide base, low, glove out front",
      ground(20, 270, 204), athlete(J, { face: 1 }), glove(184, 190, 160, 0.62), ballSm(214, 198, 6), arrow(262, 198, 224, 198),
      s("path", { d: "M 156 110 L 210 192", class: "fg__sight" }),
      lead(152, 106, 262, 30), label(268, 28, "eyes", { w: 16 }),
      lead(110, 132, 262, 86), label(268, 84, "low", { w: 16 }),
      lead(186, 186, 262, 146), label(268, 144, "gloveOut", { hl: true, w: 16 }),
      s("g", { transform: "translate(282 214)" },
        s("polygon", { points: "12,52 66,52 39,10", class: "fg__tri" }), shoePrint(12, 52, 20), shoePrint(66, 52, -20), glove(39, 14, 0, 0.42, { back: true })),
      label(20, 236, "triangle", { w: 34 }), s("text", { x: 311, y: 290, class: "fg__dimtx", "text-anchor": "middle" }, words("fromAbove")[0].toUpperCase()));
  };

  /* approach: cleat prints from the ready position, first step, angle, through the ball (top view) */
  C.FootworkDiagram = () => svg(380, 270, "Approach to a ground ball, from above: first step, angle, through the ball",
    cap(14, 22, "From above · infielder facing home plate (bottom)"),
    s("path", { d: "M 170 262 L 352 60", class: "fg__ballpath" }), ballSm(330, 84, 6), arrow(300, 117, 324, 91), label(262, 44, "ballPath", { w: 12 }),
    shoePrint(96, 92, 180), shoePrint(122, 92, 180), label(72, 62, "start"),
    shoePrint(146, 116, 140, { hl: true }), label(20, 132, "firstStep", { hl: true, w: 18 }), ln(98, 128, 136, 118, "fg__lead"),
    arrow(150, 128, 214, 170, "fg__arrow fg__arrow--hl", [160, 176]), label(118, 206, "angle", { w: 14 }),
    shoePrint(222, 166, 150), shoePrint(246, 150, 150), glove(254, 178, 140, 0.4, { back: true }), label(178, 128, "fieldIt"),
    arrow(264, 176, 316, 150, "fg__arrow fg__arrow--soft"), label(286, 200, "through", { w: 14 }));

  /* throwing setup: side view, feet set in line with the target, glove shoulder to the target */
  C.ThrowingDiagram = () => {
    const J = { head: [134, 70], neck: [128, 88], pelvis: [124, 140], shN: [128, 92], shF: [138, 90], elN: [104, 84], haN: [92, 62], elF: [160, 94], haF: [176, 102],
      hipN: [120, 142], hipF: [128, 142], knN: [100, 170], anN: [86, 200], toN: [102, 202], knF: [158, 168], anF: [176, 200], toF: [192, 202] };
    return svg(380, 270, "Throwing setup: feet set in line with the target, glove shoulder pointing at it",
      ground(20, 360, 204), ln(196, 96, 330, 96, "fg__lane"),
      s("g", {}, s("rect", { x: 330, y: 186, width: 22, height: 10, class: "fg__base" }), s("path", { d: "M 341 186 L 341 120", class: "fg__dir" }), glove(344, 104, 0, 0.5)),
      athlete(J, { face: 1, gloveFar: glove(182, 104, 70, 0.42, { back: true }), extra: ballSm(90, 58, 5.5) }),
      ln(70, 212, 210, 212, "fg__align"), s("circle", { cx: 94, cy: 212, r: 2.5, class: "fg__hldot" }), s("circle", { cx: 184, cy: 212, r: 2.5, class: "fg__hldot" }),
      lead(140, 90, 200, 40), label(206, 38, "gloveShoulder", { hl: true, w: 18 }),
      label(216, 118, "lane"), label(262, 160, "target", { w: 12 }),
      label(30, 232, "setFeet", { w: 30 }));
  };

  C.InfieldDiagram = (o) => {
    const shade = o && o.variant === "shade", W = 360, H = 250;
    const home = [180, 226], first = [266, 140], second = [180, 54], third = [94, 140];
    const base = ([x, y]) => s("rect", { x: x - 6, y: y - 6, width: 12, height: 12, class: "fg__base", transform: `rotate(45 ${x} ${y})` });
    const pos = (x, y, t, cls) => s("g", {}, s("circle", { cx: x, cy: y, r: 11, class: cls || "fg__pos" }), s("text", { x, y: y + 4, class: "fg__postx" + (cls && cls.includes("on") ? " fg__postx--on" : ""), "text-anchor": "middle" }, t));
    return svg(W, H, shade ? "Positioning: the shortstop shades a few steps toward the middle" : "The infield",
      s("path", { d: `M ${home[0]} ${home[1] + 6} L 20 ${home[1] - 154} A 250 250 0 0 1 340 ${home[1] - 154} Z`, class: "fg__grass" }),
      s("polygon", { points: [home, first, second, third].map((q) => q.join(",")).join(" "), class: "fg__diamond" }),
      base(first), base(second), base(third), s("polygon", { points: `${home[0] - 7},${home[1] - 6} ${home[0] + 7},${home[1] - 6} ${home[0] + 7},${home[1] + 2} ${home[0]},${home[1] + 8} ${home[0] - 7},${home[1] + 2}`, class: "fg__base" }),
      pos(242, 98, "2B"), pos(268, 156, "1B"), pos(92, 156, "3B"), s("circle", { cx: 180, cy: 140, r: 9, class: "fg__moundsm" }),
      shade ? [pos(118, 96, "SS", "fg__pos fg__pos--ghost"), arrow(132, 94, 156, 90, "fg__arrow fg__arrow--hl"), pos(170, 88, "SS", "fg__pos fg__pos--on"), label(14, 28, "shade", { hl: true })]
        : [pos(118, 96, "SS"), label(14, 28, "positions")],
      cap(14, H - 6, "Infield from above · illustration"));
  };

  /* ---------------- ids used by lesson content ---------------- */
  const FIGURES = {
    "ball-seams": ["SeamDiagram"], "seam-orientation": ["SeamOrientationDiagram"],
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

  /* ---------------- illustrated plates (english/tools/studio → build-plates.py → plates.js + figs/*.webp) ----------------
     Each plate: one or more panels (an editorial illustration rendered from a posed 3D athlete) with numbered markers placed
     on 3D-projected anchors, an SVG overlay for lines/arrows, and a bilingual legend. Text in the image stays out of the art. */
  const tr = (t) => { const c = ctx(); return c.target === "es" ? [t[1] || t[0], t[0]] : [t[0], c.native === "es" ? t[1] : ""]; };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function plate(id, o) {
    const P = window.CPEPlates && window.CPEPlates[id]; if (!P) return null;
    const hl = new Set([].concat(o.highlight || []));
    const root = el("div", "plate plate--n" + P.panels.length); let n = 0; const legend = el("ol", "plate__legend");
    const alt = [];
    for (const p of P.panels) {
      const panel = el("div", "plate__panel" + (p.tag ? " plate__panel--" + p.tag : ""));
      const art = el("div", "plate__art"); art.style.setProperty("--ar", (p.w / p.h).toFixed(4));
      const img = el("img", "plate__img"); img.src = p.src; img.width = p.w; img.height = p.h; img.loading = "lazy"; img.decoding = "async";
      const pins = [], H = Math.round(1000 * p.h / p.w), svg = s("svg", { class: "plate__ov", viewBox: `0 0 1000 ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
      const X = (v) => v[0] * 1000, Y = (v) => v[1] * H;
      for (const ov of p.overlays || []) {
        if (ov.kind === "hline") { svg.append(s("line", { x1: 0, y1: ov.y * H, x2: 1000, y2: ov.y * H, class: "plate__line plate__line--belt" })); const [a] = tr(ov.text); svg.append(s("text", { x: 990, y: ov.y * H - 10, class: "plate__ovtx", "text-anchor": "end" }, a)); }
        if (ov.kind === "arrow") {
          const [x1, y1, x2, y2] = [X(ov.from), Y(ov.from), X(ov.to), Y(ov.to)], a = Math.atan2(y2 - y1, x2 - x1), L = ov.style === "foot" ? 22 : 30;
          svg.append(s("line", { x1, y1, x2, y2, class: "plate__line plate__line--" + ov.style }));
          svg.append(s("polygon", { points: `${x2},${y2} ${x2 - L * Math.cos(a - 0.42)},${y2 - L * Math.sin(a - 0.42)} ${x2 - L * Math.cos(a + 0.42)},${y2 - L * Math.sin(a + 0.42)}`, class: "plate__head plate__head--" + ov.style }));
          if (ov.text) { const [t1] = tr(ov.text); svg.append(s("text", { x: Math.min(985, x2 - 6), y: y2 - 22, class: "plate__ovtx plate__ovtx--strong", "text-anchor": "end" }, t1)); }
        }
        if (ov.kind === "path") { const d = ov.pts.map((q, i) => (i ? "L" : "M") + X(q) + " " + Y(q)).join(" "); svg.append(s("path", { d, class: "plate__line plate__line--" + ov.style })); const q = ov.pts[ov.pts.length - 1], q0 = ov.pts[ov.pts.length - 2], a = Math.atan2(Y(q) - Y(q0), X(q) - X(q0)); svg.append(s("polygon", { points: `${X(q)},${Y(q)} ${X(q) - 30 * Math.cos(a - 0.42)},${Y(q) - 30 * Math.sin(a - 0.42)} ${X(q) - 30 * Math.cos(a + 0.42)},${Y(q) - 30 * Math.sin(a + 0.42)}`, class: "plate__head plate__head--" + ov.style })); }
        if (ov.kind === "dot") { svg.append(s("circle", { cx: X(ov.at), cy: Y(ov.at), r: 14, class: "plate__ball" })); const [a] = tr(ov.text); svg.append(s("text", { x: X(ov.at), y: Y(ov.at) - 26, class: "plate__ovtx", "text-anchor": "middle" }, a)); }
      }
      for (const c of p.callouts) {
        n++; const isHl = hl.has(c.key), pin = el("span", "plate__mk" + (isHl ? " plate__mk--hl" : ""), String(n));
        pin.style.left = (c.at[0] * 100).toFixed(2) + "%"; pin.style.top = (c.at[1] * 100).toFixed(2) + "%"; pins.push(pin);
        const [a, b] = tr(c.text), li = el("li", isHl ? "is-hl" : "");
        li.append(el("span", "plate__num", String(n)), el("span", "plate__p", a)); if (b) li.append(el("span", "plate__s", b));
        legend.append(li); alt.push(a);
      }
      art.append(img, svg, ...pins); panel.append(art);
      if (p.cap) { const [a, b] = tr(p.cap), cp = el("p", "plate__cap"); cp.append(el("span", "", a)); if (b) cp.append(el("span", "plate__s", b)); panel.append(cp); }
      root.append(panel);
    }
    root.setAttribute("role", "img"); root.setAttribute("aria-label", (TITLES[id] || [id])[0] + ". " + alt.join("; "));
    if (legend.children.length) root.append(legend);
    if (P.note) { const [a, b] = tr(P.note), nt = el("p", "plate__note"); nt.append(el("span", "", a)); if (b) nt.append(el("span", "plate__s", b)); root.append(nt); }
    return root;
  }

  function render(id, o) {
    const pl = plate(id, o || {}); if (pl) return pl;
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
    const box = document.createElement("div"); box.className = "fgc__art" + (window.CPEPlates && window.CPEPlates[id] ? " fgc__art--plate" : ""); box.append(g);
    box.onclick = (e) => { if (window.matchMedia("(max-width: 759px)").matches && !e.target.closest("button")) expand(id, o, title, sub); };
    fig.append(head, box);
    if (o.caption) { const cp = document.createElement("p"); cp.className = "fgc__cap"; cp.textContent = o.caption; fig.append(cp); if (o.caption_tr) { const tr = document.createElement("p"); tr.className = "fgc__cap fgc__cap--tr"; tr.textContent = o.caption_tr; fig.append(tr); } }
    return fig;
  }
  function expand(id, o, title, sub) {
    const d = document.createElement("dialog"); d.className = "fgsheet"; d.setAttribute("aria-label", title);
    const top = document.createElement("div"); top.className = "fgsheet__top";
    const t = document.createElement("div"); const a = document.createElement("strong"); a.textContent = title; t.append(a);
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
  window.CPEFig = { draw, render, ids: Object.keys(FIGURES), components: C, primitives: { athlete, glove, ball, ballSm, gripHand, sideGrip, shoePrint, capsule } };
})();
