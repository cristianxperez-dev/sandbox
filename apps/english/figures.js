/* English (CP English) — lecture illustrations, drawn as SVG (schematic line art; colours come from app.css, light and dark).
   Every figure is labelled as an illustration. The delivery figures are a schematic top view of foot strike — never a real
   pitcher, never a mechanical diagnosis. Labels are bilingual (English · Spanish) because both courses use them. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    kids.flat().forEach((k) => k != null && el.append(typeof k === "string" ? document.createTextNode(k) : k));
    return el;
  }
  const svg = (title, w, hgt, ...kids) => s("svg", { viewBox: `0 0 ${w} ${hgt}`, class: "fig", role: "img", "aria-label": title }, s("title", {}, title), ...kids);
  /* English on one line, Spanish under it (keeps every label inside the figure on a phone) */
  const label = (x, y, en, es, anchor) => s("text", { x, y, class: "fig__lbl", "text-anchor": anchor || "start" },
    en ? s("tspan", { class: "fig__en", x }, en) : null, es ? s("tspan", { class: "fig__es", x, dy: en ? "13" : "0" }, es) : null);
  const line = (x1, y1, x2, y2, cls) => s("line", { x1, y1, x2, y2, class: cls || "fig__ln" });
  const tag = (w) => s("text", { x: w - 8, y: 14, class: "fig__tag", "text-anchor": "end" }, "ILLUSTRATION");
  const seamStitches = (path) => s("path", { d: path, class: "fig__stitch" });

  /* a ball seen from the front: the two seam curves ("horseshoe") */
  function ball(cx, cy, r, extra) {
    return s("g", {}, s("circle", { cx, cy, r, class: "fig__ball" }),
      s("path", { d: `M ${cx - r * 0.62} ${cy - r * 0.78} C ${cx - r * 0.2} ${cy - r * 0.3}, ${cx - r * 0.2} ${cy + r * 0.3}, ${cx - r * 0.62} ${cy + r * 0.78}`, class: "fig__seam" }),
      s("path", { d: `M ${cx + r * 0.62} ${cy - r * 0.78} C ${cx + r * 0.2} ${cy - r * 0.3}, ${cx + r * 0.2} ${cy + r * 0.3}, ${cx + r * 0.62} ${cy + r * 0.78}`, class: "fig__seam" }),
      seamStitches(`M ${cx - r * 0.62} ${cy - r * 0.78} C ${cx - r * 0.2} ${cy - r * 0.3}, ${cx - r * 0.2} ${cy + r * 0.3}, ${cx - r * 0.62} ${cy + r * 0.78}`),
      seamStitches(`M ${cx + r * 0.62} ${cy - r * 0.78} C ${cx + r * 0.2} ${cy - r * 0.3}, ${cx + r * 0.2} ${cy + r * 0.3}, ${cx + r * 0.62} ${cy + r * 0.78}`), extra || null);
  }
  const finger = (x, y, w, hgt, rot, cls) => s("rect", { x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, rx: w / 2, class: cls || "fig__finger", transform: rot ? `rotate(${rot} ${x} ${y})` : null });

  const F = {};
  F["ball-seams"] = () => svg("A baseball and its seams", 360, 200, tag(360), ball(110, 105, 70),
    line(165, 66, 212, 52, "fig__ptr"), label(218, 50, "Seams", "las costuras"),
    label(218, 102, "Ball", "la pelota"),
    line(150, 152, 212, 152, "fig__ptr"), label(218, 150, "Horseshoe", "la herradura"));

  /* the hand: numbered fingers and a legend (no crossing pointers) */
  F["hand-fingers"] = () => {
    const fingers = [[60, 140, 22, 62, -50, "1"], [85, 85, 22, 70, 0, "2"], [112, 72, 22, 86, 0, "3"], [139, 78, 22, 78, 0, "4"], [164, 92, 20, 60, 0, "5"]];
    const names = [["Thumb", "el pulgar"], ["Index finger", "el dedo índice"], ["Middle finger", "el dedo medio"], ["Ring finger", "el dedo anular"], ["Pinky", "el meñique"]];
    return svg("A hand and the names of the fingers", 360, 230, tag(360),
      s("rect", { x: 70, y: 110, width: 110, height: 90, rx: 26, class: "fig__palm" }),
      fingers.map(([x, y, w, hh, r]) => finger(x, y, w, hh, r)),
      fingers.map(([x, y, , , r, n]) => { const [cx, cy] = r ? [x - 12, y + 10] : [x, y + 4]; return s("g", {}, s("circle", { cx, cy, r: 8, class: "fig__num" }), s("text", { x: cx, y: cy + 3.5, class: "fig__numtx", "text-anchor": "middle" }, n)); }),
      s("circle", { cx: 112, cy: 34, r: 4, class: "fig__dot" }), s("circle", { cx: 85, cy: 54, r: 4, class: "fig__dot" }),
      s("text", { x: 125, y: 175, class: "fig__lbl", "text-anchor": "middle" }, s("tspan", { class: "fig__en" }, "Palm")), s("text", { x: 125, y: 188, class: "fig__lbl", "text-anchor": "middle" }, s("tspan", { class: "fig__es" }, "la palma")),
      names.map(([en, es], i) => label(210, 30 + i * 32, `${i + 1}  ${en}`, `    ${es}`)),
      s("circle", { cx: 214, cy: 196, r: 4, class: "fig__dot" }), label(224, 199, "Fingertips", "las yemas de los dedos"));
  };

  F["grip-4s"] = () => svg("Four-seam grip: fingers across the seams", 360, 210, tag(360), ball(110, 108, 70),
    finger(92, 80, 18, 60, 90), finger(92, 106, 18, 60, 90), finger(110, 170, 18, 40, 0, "fig__finger fig__finger--under"),
    label(200, 64, "Four-seam", "la recta de cuatro costuras"),
    label(200, 114, "Index + middle across", "dedos sobre las costuras"),
    label(200, 164, "Thumb underneath", "el pulgar debajo"));

  F["grip-2s"] = () => svg("Two-seam grip: fingers along the seams", 360, 210, tag(360), ball(110, 108, 70),
    finger(82, 95, 18, 66, 0), finger(138, 95, 18, 66, 0), finger(110, 172, 18, 38, 0, "fig__finger fig__finger--under"),
    label(200, 64, "Two-seam / sinker", "de dos costuras / el sinker"),
    label(200, 114, "Fingers along the seams", "a lo largo de las costuras"),
    label(200, 164, "Thumb underneath", "el pulgar debajo"));

  F["grip-change"] = () => svg("Changeup grip: three fingers on top, a circle on the side", 360, 210, tag(360), ball(110, 108, 70),
    finger(95, 82, 18, 58, 0), finger(118, 78, 18, 64, 0), finger(141, 86, 18, 54, 0),
    s("circle", { cx: 58, cy: 118, r: 16, class: "fig__circle" }),
    label(200, 64, "Changeup", "el cambio"),
    label(200, 114, "Ball deeper in the hand", "más profunda en la mano"),
    label(200, 164, "Thumb + index circle", "círculo con pulgar e índice"));

  /* the delivery, schematic top view at front-foot strike: rubber, feet, hips and shoulders, direction to the plate */
  function delivery(open) {
    const W = 380, H = 250, rad = (d) => (d * Math.PI) / 180;
    const cx = 175, cy = 140, half = 44;
    const ang = (deg, len, dy) => [cx - Math.cos(rad(deg)) * len, cy + dy - Math.sin(rad(deg)) * len, cx + Math.cos(rad(deg)) * len, cy + dy + Math.sin(rad(deg)) * len];
    const sh = ang(open ? -34 : -5, half, 0), hp = ang(-10, 34, 0);
    return svg(open ? "Illustrated rep A: the front side opens early" : "Illustrated rep B: the front side stays closed longer", W, H, tag(W),
      label(14, 30, open ? "Rep A — front shoulder already open" : "Rep B — front shoulder still closed", open ? "repetición A: el hombro de adelante ya abrió" : "repetición B: el hombro de adelante sigue cerrado"),
      line(46, cy, 352, cy, "fig__dir"), s("polygon", { points: `352,${cy - 6} 364,${cy} 352,${cy + 6}`, class: "fig__arrow" }), label(364, cy + 24, "To the plate", "hacia el plato", "end"),
      s("rect", { x: 30, y: cy - 13, width: 10, height: 26, class: "fig__rubber" }), label(14, cy + 34, "Rubber", "la goma"),
      s("ellipse", { cx: 70, cy: cy + 18, rx: 14, ry: 7, class: "fig__foot" }),
      s("ellipse", { cx: 282, cy: cy + 6, rx: 14, ry: 7, class: "fig__foot fig__foot--front" }), line(282, cy + 14, 282, cy + 38, "fig__ptr"), label(282, cy + 52, "Front foot lands", "cae el pie de adelante", "middle"),
      s("line", { x1: hp[0], y1: hp[1], x2: hp[2], y2: hp[3], class: "fig__hips" }),
      s("line", { x1: sh[0], y1: sh[1], x2: sh[2], y2: sh[3], class: "fig__shoulders" }), s("circle", { cx: sh[2], cy: sh[3], r: 5, class: "fig__dot" }),
      line(cx - 30, cy + 6, cx - 52, cy + 40, "fig__ptr"), label(cx - 52, cy + 54, "Hips", "las caderas", "middle"),
      line(sh[2] + 4, sh[3] - 4, 250, 62, "fig__ptr"), label(254, 64, "Front shoulder", "el hombro de adelante"),
      s("text", { x: 14, y: H - 8, class: "fig__cap" }, "Seen from above at foot strike · illustration, not a real pitcher"));
  }
  F["delivery-a"] = () => delivery(true);
  F["delivery-b"] = () => delivery(false);

  /* the infield: bases, positions; shade = the shortstop shifted a few steps toward second base */
  function infield(shade) {
    const W = 340, H = 240;
    const home = [170, 220], first = [255, 135], second = [170, 50], third = [85, 135];
    const base = ([x, y]) => s("rect", { x: x - 6, y: y - 6, width: 12, height: 12, class: "fig__base", transform: `rotate(45 ${x} ${y})` });
    const pos = (x, y, t, cls) => s("g", {}, s("circle", { cx: x, cy: y, r: 11, class: cls || "fig__pos" }), s("text", { x, y: y + 4, class: "fig__postx", "text-anchor": "middle" }, t));
    return svg(shade ? "Positioning: the shortstop shades a few steps toward second base" : "The infield", W, H, tag(W),
      s("polygon", { points: [home, first, second, third].map((p) => p.join(",")).join(" "), class: "fig__diamond" }),
      base(first), base(second), base(third), s("polygon", { points: `${home[0] - 7},${home[1] - 6} ${home[0] + 7},${home[1] - 6} ${home[0] + 7},${home[1] + 2} ${home[0]},${home[1] + 8} ${home[0] - 7},${home[1] + 2}`, class: "fig__base" }),
      pos(232, 95, "2B"), pos(258, 150, "1B"), pos(82, 150, "3B"), s("circle", { cx: 170, cy: 135, r: 6, class: "fig__mound" }),
      shade ? [pos(110, 92, "SS", "fig__pos fig__pos--ghost"), line(122, 90, 141, 86, "fig__move"), s("polygon", { points: "141,81 150,85 142,91", class: "fig__arrow" }), pos(160, 84, "SS", "fig__pos fig__pos--on"),
        label(14, 30, "Shade a few steps toward the middle", "unos pasos hacia el medio")] : pos(110, 92, "SS"),
      !shade ? label(14, 30, "Infield positions", "las posiciones del cuadro") : null,
      s("text", { x: 14, y: H - 8, class: "fig__cap" }, "Schematic infield · illustration"));
  }
  F.infield = () => infield(false);
  F["infield-shade"] = () => infield(true);

  F["ready-position"] = () => svg("Ready position: feet wide, knees bent, weight forward, glove out", 360, 240, tag(360),
    s("circle", { cx: 110, cy: 50, r: 16, class: "fig__head" }),
    line(110, 66, 110, 122, "fig__body"),
    line(110, 122, 78, 154, "fig__body"), line(78, 154, 70, 200, "fig__body"),
    line(110, 122, 142, 154, "fig__body"), line(142, 154, 150, 200, "fig__body"),
    line(110, 86, 82, 124, "fig__body"), line(110, 86, 140, 124, "fig__body"),
    s("ellipse", { cx: 140, cy: 132, rx: 14, ry: 10, class: "fig__glove" }),
    line(50, 204, 172, 204, "fig__ground"),
    line(126, 74, 196, 50, "fig__ptr"), label(200, 48, "Weight forward", "el peso hacia adelante"),
    line(156, 132, 196, 100, "fig__ptr"), label(200, 98, "Glove out front", "el guante al frente"),
    line(150, 154, 196, 150, "fig__ptr"), label(200, 148, "Knees bent", "las rodillas dobladas"),
    line(156, 200, 196, 196, "fig__ptr"), label(200, 194, "Feet wider than the shoulders", "los pies abiertos"));

  function draw(id) {
    const f = F[id];
    if (!f) return null;
    const fig = document.createElement("figure");
    fig.className = "figwrap"; fig.append(f());
    return fig;
  }
  window.CPEFig = { draw, ids: Object.keys(F) };
})();
