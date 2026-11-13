/* Call the Game — the catcher's-view scene: ballpark, pitcher, hitter, glove target, pitch flight and batted balls.
   One coordinate system (engine.js): feet, x = catcher's right, y toward the pitcher (0 = front of the plate), z up.
   The flight ends exactly at the simulated endpoint (engine.flightAt(f, 1) === endpoint at y = 0). */
(function (root) {
  "use strict";
  const C = root.CTG, R = root.CTGRig, V = R.V, clamp = R.clamp, ease = R.ease;
  const CAM = { y: -18, z: 4.6 };
  const PAD = { x0: -1.7, x1: 1.7, z0: 0.7, z1: 4.3 };       // reachable glove targets (catcher view)
  const RUBBER = [0, 60.5, 0.83];
  const KIT_HIT = { jersey: "#A9ADB2", sleeve: "#A9ADB2", pants: "#B4B8BC", socks: "#1F2A44", shoes: "#16161a", belt: "#1F2A44", helmet: "#1F2A44", trim: "#1F2A44", hands: "#2b2b30", outline: "#1b1a19" };

  function create(canvas, opts) {
    const o = opts || {}, ctx = canvas.getContext("2d");
    let W = 0, H = 0, dpr = 1, f = 1, cx = 0, cy = 0, bg = null;
    let state = { pitcher: null, batter: null, target: null, code: null, showZone: true, last: null, aim: false };
    let anim = null, idleT = 0, lastTs = 0, visible = true, dirty = true;

    function layout() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = Math.max(200, r.width); H = Math.max(160, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      f = Math.min(2.0 * H, 1.7 * W);
      cx = W / 2;
      // place the middle of the zone at 60% of the height
      cy = 0.6 * H - f * (CAM.z - 2.5) / (0 - CAM.y);
      bg = null;
    }
    const proj = (p) => { const d = Math.max(0.5, p[1] - CAM.y); return { x: cx + (f * p[0]) / d, y: cy - (f * (p[2] - CAM.z)) / d, s: f / d, d }; };
    /** screen point → glove target on the plate's front plane */
    function toPlate(px, py) { const d = -CAM.y; return { x: ((px - cx) * d) / f, z: CAM.z - ((py - cy) * d) / f }; }

    /* -------------------------------------------------------------- ballpark (static, cached) */
    function ground(c, pts, fill, stroke, lw) {
      c.beginPath(); pts.forEach((p, i) => { const q = proj([p[0], p[1], p[2] || 0]); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    }
    const arc = (cx0, cy0, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx0 + r * Math.sin(a), cy0 + r * Math.cos(a)]; });
    function drawPark() {
      const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext("2d"); g.scale(dpr, dpr);
      const hz = cy;                       // horizon
      // sky (dusk)
      let gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, "#14213A"); gr.addColorStop(0.7, "#2C4366"); gr.addColorStop(1, "#5D6F87");
      g.fillStyle = gr; g.fillRect(0, 0, W, hz + 2);
      // stadium bowl: upper deck, facade, lower deck, crowd
      const wallTop = proj([0, 400, 11]).y, standTop = Math.max(hz - 0.42 * hz, wallTop - Math.max(40, 0.2 * H));
      g.fillStyle = "#1E2430"; g.beginPath(); g.moveTo(0, standTop + 18); g.quadraticCurveTo(W / 2, standTop - 10, W, standTop + 18); g.lineTo(W, wallTop); g.lineTo(0, wallTop); g.closePath(); g.fill();
      // light towers glow
      for (const lx of [0.12, 0.88]) { const rg = g.createRadialGradient(W * lx, standTop - 6, 1, W * lx, standTop - 6, 60); rg.addColorStop(0, "rgba(255,248,225,.9)"); rg.addColorStop(0.15, "rgba(255,244,210,.35)"); rg.addColorStop(1, "rgba(255,244,210,0)"); g.fillStyle = rg; g.fillRect(W * lx - 60, standTop - 66, 120, 120); g.fillStyle = "#cfd3d8"; g.fillRect(W * lx - 9, standTop - 9, 18, 6); }
      // deck facade line (cream ribbon)
      const deck = standTop + (wallTop - standTop) * 0.42;
      g.fillStyle = "#2A303C"; g.fillRect(0, deck - 3, W, 6); g.fillStyle = "rgba(242,235,221,.55)"; g.fillRect(0, deck - 1, W, 1.2);
      // crowd specks (deterministic)
      const rnd = C.rng(7); const cols = ["#7d8696", "#a35050", "#c9c2b2", "#5b6b85", "#8a6d4f", "#d8d3c8", "#4f5a6e"];
      for (let i = 0; i < (W * (wallTop - standTop)) / 26; i++) { const x = rnd() * W, y = standTop + 14 + rnd() * (wallTop - standTop - 16); if (Math.abs(y - deck) < 4) continue; g.fillStyle = cols[(rnd() * cols.length) | 0]; g.fillRect(x, y, 1.6, 1.6); }
      // batter's eye (dark centre-field backdrop behind the pitcher)
      const be0 = proj([-28, 405, 0]), be1 = proj([28, 405, 34]);
      g.fillStyle = "#1F3327"; g.fillRect(be0.x, be1.y, be1.x - be0.x, be0.y - be1.y);
      // outfield wall
      const wl = [], wr = [];
      for (let a = -48; a <= 48; a += 4) { const r0 = 330 + 70 * Math.cos((a * Math.PI) / 96) ** 2; const rad = (a * Math.PI) / 180; wl.push([r0 * Math.sin(rad), r0 * Math.cos(rad) - 1, 0]); wr.push([r0 * Math.sin(rad), r0 * Math.cos(rad) - 1, 10]); }
      g.beginPath(); wl.forEach((p, i) => { const q = proj(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); wr.slice().reverse().forEach((p) => { const q = proj(p); g.lineTo(q.x, q.y); }); g.closePath(); g.fillStyle = "#24442F"; g.fill();
      g.beginPath(); wr.forEach((p, i) => { const q = proj(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.strokeStyle = "#D9B44A"; g.lineWidth = 1; g.stroke();
      // grass: field to the bottom, with mowing stripes
      const gTop = proj([0, 400, 0]).y;
      gr = g.createLinearGradient(0, gTop, 0, H); gr.addColorStop(0, "#3F6E33"); gr.addColorStop(1, "#4D8A3C");
      g.fillStyle = gr; g.fillRect(0, gTop, W, H - gTop);
      for (let k = 0; k < 14; k++) { if (k % 2) continue; const y0 = 130 + k * 20, y1 = y0 + 20; ground(g, [[-400, y0], [400, y0], [400, y1], [-400, y1]], "rgba(255,255,255,.045)"); }
      // infield dirt arc and grass infield
      ground(g, [[0, -1]].concat(arc(0, 60.5, 95, -0.86, 0.86, 40)), "#B98458");
      ground(g, [[0, 4], [60.2, 63.6], [0, 123.5], [-60.2, 63.6]], "#4A8238");
      ground(g, [[0, 4], [60.2, 63.6], [0, 123.5], [-60.2, 63.6]], null, "rgba(0,0,0,.08)");
      // base paths / foul lines
      const chalk = "#F2EEE4";
      for (const sgn of [-1, 1]) { ground(g, [[sgn * 0.85, -1.4], [sgn * 300, 298.6], [sgn * 300.6, 298.6], [sgn * 1.45, -1.4]], chalk); }
      // bases
      for (const bpos of [[63.6, 63.6], [0, 127.3], [-63.6, 63.6]]) ground(g, [[bpos[0] - 0.75, bpos[1]], [bpos[0], bpos[1] + 0.75], [bpos[0] + 0.75, bpos[1]], [bpos[0], bpos[1] - 0.75]], "#F5F2EA");
      // mound
      ground(g, arc(0, 59, 9, 0, Math.PI * 2, 48), "#BE8A5E");
      const top = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; top.push([2.6 * Math.sin(a), 60.2 + 2.6 * Math.cos(a), 0.83]); }
      ground(g, top, "#C8976A");
      ground(g, [[-1, 60.4, 0.84], [1, 60.4, 0.84], [1, 60.9, 0.84], [-1, 60.9, 0.84]], "#F7F4EC");
      // home plate area
      ground(g, arc(0, -0.7, 13, 0, Math.PI * 2, 60), "#B98458");
      ground(g, arc(0, -0.7, 13, 0, Math.PI * 2, 60), null, "rgba(60,40,20,.25)", 1);
      // batter's boxes and catcher's box (chalk)
      const lw = Math.max(1, proj([0, -1, 0]).s * 0.25);
      for (const sgn of [-1, 1]) ground(g, [[sgn * 1.21, -3.7], [sgn * 5.21, -3.7], [sgn * 5.21, 2.3], [sgn * 1.21, 2.3]], null, "rgba(242,238,228,.85)", lw);
      // home plate (white pentagon with black edge)
      ground(g, [[-0.708, 0], [0.708, 0], [0.708, -0.708], [0, -1.417], [-0.708, -0.708]], "#2a2622");
      ground(g, [[-0.66, -0.03], [0.66, -0.03], [0.66, -0.7], [0, -1.36], [-0.66, -0.7]], "#FAF8F2");
      // vignette
      gr = g.createLinearGradient(0, H * 0.75, 0, H); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.18)"); g.fillStyle = gr; g.fillRect(0, H * 0.75, W, H * 0.25);
      return c;
    }

    /* -------------------------------------------------------------- figures */
    function hitterFrame(h) { const sg = h.hand === "R" ? -1 : 1; return { origin: [sg * 2.85, -0.55, 0], fx: [-sg, 0, 0], fy: [0, 1, 0] }; }
    function pitcherFrame(p) { const s = C.armSign(p.hand); return { origin: RUBBER, fx: [s, 0, 0], fy: [0, -1, 0] }; }
    function localContact(h, end, dy) { const sg = h.hand === "R" ? -1 : 1; return [(end.x - sg * 2.85) * -sg, 0.55 + (dy == null ? 0.5 : dy), end.z]; }
    function drawHitter(h, st) {
      if (!h) return;
      const kit = Object.assign({}, KIT_HIT, { skin: h.skin });
      const hp = R.hitterPose(h, st), fr = hitterFrame(h);
      const Jl = R.solve(hp.pose, h.body), J = R.toWorld(Jl, fr);
      const w = (p) => [fr.origin[0] + fr.fx[0] * p[0], fr.origin[1] + fr.fy[1] * p[1], p[2]];
      const dirW = [fr.fx[0] * hp.bat.dir[0], fr.fy[1] * hp.bat.dir[1], hp.bat.dir[2]];
      R.drawFigure(ctx, J, kit, proj, { bat: { grip: w(hp.bat.grip), dir: dirW, len: hp.bat.len }, px: Math.max(0.6, f / 900) });
    }
    function drawPitcher(p, t) {
      if (!p) return;
      const kit = { jersey: p.jersey.main, sleeve: p.jersey.trim, pants: p.jersey.main, socks: p.jersey.trim, shoes: "#141414", belt: p.jersey.trim, cap: p.jersey.cap, trim: p.jersey.trim, skin: "#C99572", outline: "#2a2725", number: p.jersey.num };
      const release = [1.75, 6.2, 5.02];
      const pose = R.pitcherPose(p, t, release);
      const J = R.toWorld(R.solve(pose, p.body), pitcherFrame(p));
      R.drawFigure(ctx, J, kit, proj, { glove: V.add(J.lHand, [0, -0.1, 0]), px: 0.5 });
      return J;
    }

    /* -------------------------------------------------------------- overlays */
    function drawZone() {
      const a = proj([-0.83, 0, 3.45]), b = proj([0.83, 0, 1.55]);
      ctx.save(); ctx.strokeStyle = "rgba(242,235,221,.6)"; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]); ctx.strokeStyle = "rgba(242,235,221,.16)"; ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) { ctx.moveTo(a.x + (b.x - a.x) * t, a.y); ctx.lineTo(a.x + (b.x - a.x) * t, b.y); ctx.moveTo(a.x, a.y + (b.y - a.y) * t); ctx.lineTo(b.x, a.y + (b.y - a.y) * t); }
      ctx.stroke(); ctx.restore();
    }
    /** catcher's mitt seen from behind (the catcher's own view): the glove target */
    function drawMitt(x, z, alpha, ghost) {
      const q = proj([x, 0, z]), r = 0.42 * q.s;
      ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.translate(q.x, q.y);
      if (ghost) { ctx.setLineDash([4, 3]); ctx.strokeStyle = "rgba(242,235,221,.85)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.88, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; }
      ctx.fillStyle = "#5E351B"; ctx.strokeStyle = "#2a160b"; ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.88, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#7A4826"; ctx.beginPath(); ctx.ellipse(-r * 0.1, -r * 0.08, r * 0.72, r * 0.66, 0, 0, Math.PI * 2); ctx.fill();
      // thumb (right-handed catcher: glove on the left hand → thumb on the right as he looks out)
      ctx.fillStyle = "#6A3D20"; ctx.beginPath(); ctx.ellipse(r * 0.78, r * 0.18, r * 0.26, r * 0.48, -0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // lacing around the rim
      ctx.strokeStyle = "#C9A06A"; ctx.lineWidth = Math.max(0.8, r * 0.05); ctx.setLineDash([r * 0.12, r * 0.1]); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.84, r * 0.77, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.setLineDash([]);
      // wrist strap
      ctx.fillStyle = "#3a2110"; ctx.fillRect(-r * 0.35, r * 0.62, r * 0.7, r * 0.22);
      // aim point
      ctx.strokeStyle = "rgba(250,248,242,.95)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, Math.max(3, r * 0.14), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    function drawBall(p, scale) {
      const q = proj(p), r = Math.max(2.6, 0.121 * q.s * (scale || 1));
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fillStyle = "#FBFAF5"; ctx.fill();
      if (r > 3.5) { ctx.strokeStyle = "#C2433A"; ctx.lineWidth = Math.max(0.8, r * 0.14); ctx.beginPath(); ctx.arc(q.x - r * 0.9, q.y, r * 0.7, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(q.x + r * 0.9, q.y, r * 0.7, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke(); }
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    function drawShadow(p) { if (p[2] < 0) return; const q = proj([p[0], p[1], 0]); const r = Math.max(1, 0.16 * q.s); ctx.beginPath(); ctx.ellipse(q.x, q.y, r * 1.3, r * 0.45, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill(); }
    function drawEndMarker(e, code) {
      const q = proj([e.x, 0, e.z]), r = Math.max(4, 0.13 * q.s);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fillStyle = C.PITCH_COLORS[code] || "#fff"; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = "#FAF8F2"; ctx.lineWidth = 1.5; ctx.stroke();
    }

    /* -------------------------------------------------------------- batted ball paths */
    function battedPath(rec) {
      const b = rec.bip, start = [rec.end.x, 0.6, rec.end.z], rnd = C.rng(C.hash("bip", rec.n, rec.end.x));
      if (rec.result === "foul" || rec.result === "foultip") {
        if (rec.result === "foultip") return { dur: 0.25, at: (t) => V.lerp(start, [rec.end.x, -1.2, rec.end.z - 0.2], t), land: null };
        const back = rnd() < 0.45, side = rnd() < 0.5 ? -1 : 1;
        const endP = back ? [side * (6 + rnd() * 20), -60, 45 + rnd() * 25] : [side * (120 + rnd() * 60), 70 + rnd() * 50, 0];
        const apex = back ? 0 : 35 + rnd() * 40;
        return { dur: back ? 0.9 : 1.6, at: (t) => { const p = V.lerp(start, endP, t); p[2] = back ? start[2] + (endP[2] - start[2]) * t : start[2] * (1 - t) + 4 * apex * t * (1 - t); return p; }, land: back ? null : endP };
      }
      const q = b.quality, ang = (b.spray * 42 * Math.PI) / 180;
      let dist, apex, dur;
      if (b.type === "ground") { dist = 95 + 45 * q; apex = 3; dur = 1.25; }
      else if (b.type === "line") { dist = 160 + 120 * q; apex = 10 + 8 * q; dur = 1.3; }
      else if (b.type === "popup") { dist = 70 + 60 * rnd(); apex = 95; dur = 2.0; }
      else { dist = b.result === "homer" ? 395 + 40 * rnd() : 220 + 120 * q; apex = 55 + 45 * q; dur = 1.9; }
      const endP = [dist * Math.sin(ang), dist * Math.cos(ang), 0];
      return { dur, land: endP, at: (t) => {
        const p = V.lerp(start, endP, b.type === "ground" ? 1 - (1 - t) * (1 - t) : t);
        if (b.type === "ground") { const bounce = Math.abs(Math.sin(t * Math.PI * 3.2)) * apex * (1 - t); p[2] = Math.max(0.12, bounce); }
        else p[2] = start[2] * (1 - t) + 4 * apex * t * (1 - t);
        return p;
      } };
    }

    /* -------------------------------------------------------------- frame */
    function loop(ts) {
      root.requestAnimationFrame(loop);
      if (!visible || !W) return;
      if (!anim && !dirty && ts - lastTs < 50) return;
      dirty = false; frame(ts);
    }
    function frame(ts) {
      const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts; idleT += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bg) bg = drawPark();
      ctx.drawImage(bg, 0, 0, W, H);
      let trail = null, pt = 0, hs = { t: idleT }, ball = null, mitt = state.target, mittAlpha = state.aim ? 1 : 0.95, bipBall = null, hideMitt = false, ballIn = null;
      if (anim) {
        anim.t += dt * anim.speed;
        const A = anim, t = A.t, tl = A.tl;
        pt = t < tl.set ? 0 : t < tl.rel ? 0.8 * ((t - tl.set) / (tl.rel - tl.set)) : Math.min(1.25, 0.8 + 0.45 * ((t - tl.rel) / 0.75));
        hs.load = clamp((t - (tl.rel - 0.55)) / 0.5, 0, 1);
        hs.stride = clamp((t - (tl.rel - 0.2)) / 0.55, 0, 1);
        if (A.rec.swing) hs.swing = clamp((t - (tl.arr - 0.22)) / 0.22 * 0.72, 0, 0.72) + (t > tl.arr ? clamp((t - tl.arr) / 0.3, 0, 1) * 0.28 : 0);
        else hs.take = clamp((t - (tl.arr - 0.05)) / 0.4, 0, 1);
        hs.contact = A.contact;
        if (A.rec.result === "foul" || A.rec.result === "inplay") hs.react = A.rec.result === "foul" ? clamp((t - tl.arr - 0.3) / 0.3, 0, 1) * 0.0 : 0;
        if (t >= tl.rel && t < tl.arr) { const k = (t - tl.rel) / (tl.arr - tl.rel); ball = C.flightAt(A.flight, k); trail = [0.06, 0.12, 0.18].map((dk) => C.flightAt(A.flight, Math.max(0, k - dk))); }
        const caught = !["inplay", "foul"].includes(A.rec.result);
        if (caught && t >= tl.arr - 0.12) { const k = ease((t - (tl.arr - 0.12)) / 0.12); mitt = { x: R.lerp(A.rec.target.x, A.rec.end.x, k), z: R.lerp(A.rec.target.z, A.rec.end.z, k) }; }
        if (caught && t >= tl.arr) ballIn = A.rec.end;
        if (!caught && t >= tl.arr) { hideMitt = false; const k = clamp((t - tl.arr) / A.path.dur, 0, 1); bipBall = A.path.at(k); if (k >= 1 && !A.path.land) bipBall = null; }
        if (!A.sounded && t >= tl.arr) { A.sounded = true; o.onImpact && o.onImpact(A.rec); }
        if (t >= tl.end) { const done = anim.done; anim = null; state.last = A.rec; done && done(); }
      }
      const Jp = drawPitcher(state.pitcher, pt);
      // ball in flight: drawn by depth relative to the hitter
      const ballFar = ball && ball[1] > 2.2;
      if (trail) trail.forEach((p, i) => { const q = proj(p); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.6, 0.121 * q.s) * (1 - i * 0.2), 0, Math.PI * 2); ctx.fillStyle = `rgba(250,248,240,${0.28 - i * 0.08})`; ctx.fill(); });
      if (ballFar) { drawShadow(ball); drawBall(ball); }
      if (bipBall && bipBall[1] > 3) { drawShadow(bipBall); drawBall(bipBall, 1.25); }
      drawHitter(state.batter, hs);
      if (state.showZone) drawZone();
      if (state.last && !anim) drawEndMarker(state.last.end, state.last.code);
      if (mitt && !hideMitt) drawMitt(mitt.x, mitt.z, mittAlpha);
      if (anim && anim.rec.target && mitt !== anim.rec.target && !hideMitt) drawMitt(anim.rec.target.x, anim.rec.target.z, 0.9, true);
      if (ball && !ballFar) drawBall(ball);
      if (ballIn) drawBall([ballIn.x, 0, ballIn.z], 0.9);
      if (bipBall && bipBall[1] <= 3) drawBall(bipBall, 1.25);
    }
    /** play one pitch record (live or replay). speed: 1, 2, or "skip". Resolves when finished. */
    function play(rec, opts2) {
      const op = opts2 || {}, p = C.pitcherById(rec.pitcherId || (state.pitcher && state.pitcher.id)) || state.pitcher, def = C.pitchDef(p, rec.code);
      const fl = C.flight(p, def, rec.end), slow = 1.5;
      const tl = { set: 0.45 }; tl.rel = tl.set + 1.0; tl.arr = tl.rel + fl.T * slow;
      const inplay = rec.result === "inplay" || rec.result === "foul" || rec.result === "foultip";
      const path = inplay ? battedPath(rec) : null;
      tl.end = tl.arr + (path ? path.dur + 0.55 : 0.85);
      const missDz = rec.result === "whiff" ? (rec.end.z > 2.6 ? -0.38 : 0.32) : 0;
      const contact = localContact(state.batter || rec.batterObj, { x: rec.end.x, z: rec.end.z + missDz }, rec.result === "foul" ? 0.15 : 0.5);
      return new Promise((resolve) => {
        if (op.speed === "skip") { state.last = rec; o.onImpact && o.onImpact(rec, true); draw(); resolve(); return; }
        anim = { rec, flight: fl, tl, t: 0, speed: op.speed || 1, path, contact, done: resolve };
        dirty = true;
      });
    }
    function draw() { dirty = true; }
    function set(s) { Object.assign(state, s); dirty = true; }
    function skip() { if (anim) anim.t = anim.tl.end; }
    /** test hook: freeze playback (speed 0) and jump to time t of the current pitch */
    function seek(t) { if (anim) { anim.speed = 0; anim.t = t; dirty = true; } return anim ? anim.tl : null; }
    // pointer: place the glove on the scene
    function onPointer(e) {
      if (!state.aim || anim) return;
      const r = canvas.getBoundingClientRect(), p = toPlate(e.clientX - r.left, e.clientY - r.top);
      if (p.x < PAD.x0 - 0.6 || p.x > PAD.x1 + 0.6 || p.z < PAD.z0 - 0.6 || p.z > PAD.z1 + 0.6) return;
      e.preventDefault();
      o.onTarget && o.onTarget({ x: clamp(p.x, PAD.x0, PAD.x1), z: clamp(p.z, PAD.z0, PAD.z1) });
    }
    let dragging = false;
    canvas.addEventListener("pointerdown", (e) => { dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} onPointer(e); });
    canvas.addEventListener("pointermove", (e) => { if (dragging) onPointer(e); });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointercancel", () => { dragging = false; });
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; if (visible) draw(); });
    const ro = new ResizeObserver(() => { layout(); draw(); }); ro.observe(canvas);
    layout(); root.requestAnimationFrame(loop);
    return { set, play, skip, seek, draw, toPlate, proj: (p) => proj(p), get busy() { return !!anim; }, get state() { return state; }, PAD };
  }
  root.CTGScene = { create, PAD };
})(typeof self !== "undefined" ? self : globalThis);
