/* Call the Game — figure rig. Hitters and pitchers are posed in 3D (feet, world coordinates of engine.js: x catcher's right,
   y toward the pitcher, z up), solved with two-bone IK and drawn as depth-sorted tapered volumes with a knockout outline —
   stylized, anatomically proportioned figures, never stick figures. Pure drawing: the caller supplies a projector. */
(function (root) {
  "use strict";
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  /** rotate a local vector about Z by yaw (0 = facing +X) */
  const yawV = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];

  /** two-bone IK: joint between root A and end T with bone lengths l1, l2, bending toward pole P (a direction) */
  function ik(A, T, l1, l2, pole) {
    const d0 = V.sub(T, A), d = V.len(d0), u = V.norm(d0);
    if (d >= (l1 + l2) * 0.999) return V.add(A, V.mul(u, l1 * d / (l1 + l2)));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    let v = V.sub(pole, V.mul(u, V.dot(pole, u)));
    if (V.len(v) < 1e-6) v = [0, 0, 1];
    return V.add(V.add(A, V.mul(u, a)), V.mul(V.norm(v), h));
  }

  /** a body from a pose in local coordinates. pose: pelvis [X,Y,Z], hipYaw, chestYaw, lean (rad toward facing), side (rad toward +Y),
      lAnkle, rAnkle, lHand, rHand, lToeDir/rToeDir (yaw), headLook (local direction). Returns joints in local coords. */
  function solve(pose, body) {
    const s = body.scale || 1, b = body.build || 1;
    const L = { thigh: 1.5 * s, shin: 1.48 * s, upper: 1.02 * s, fore: 0.98 * s, spine: 1.72 * s, neck: 0.5 * s, sh: 0.66 * s * (0.94 + 0.08 * b), hip: 0.42 * s * (0.92 + 0.1 * b) };
    const P = pose.pelvis, lean = pose.lean || 0, side = pose.side || 0;
    const up = V.norm([Math.sin(lean) * Math.cos(pose.chestYaw), Math.sin(lean) * Math.sin(pose.chestYaw) + Math.sin(side), Math.cos(lean)]);
    const chest = V.add(P, V.mul(up, L.spine));
    const lHip = V.add(P, yawV([0, L.hip, 0], pose.hipYaw)), rHip = V.add(P, yawV([0, -L.hip, 0], pose.hipYaw));
    const lSh = V.add(chest, V.add(yawV([0, L.sh, 0], pose.chestYaw), [0, 0, -0.12 * s])), rSh = V.add(chest, V.add(yawV([0, -L.sh, 0], pose.chestYaw), [0, 0, -0.12 * s]));
    const head = V.add(chest, V.add(V.mul(up, L.neck * 0.7), [0, 0, L.neck * 0.55]));
    const fwdHip = yawV([1, 0, 0], pose.hipYaw), fwdCh = yawV([1, 0, 0], pose.chestYaw);
    const lKnee = ik(lHip, pose.lAnkle, L.thigh, L.shin, pose.lKneePole || V.add(fwdHip, [0, 0.2, 0]));
    const rKnee = ik(rHip, pose.rAnkle, L.thigh, L.shin, pose.rKneePole || V.add(fwdHip, [0, -0.2, 0]));
    const lElbow = ik(lSh, pose.lHand, L.upper, L.fore, pose.lElbowPole || V.add(V.mul(fwdCh, 0.3), [0, 0.4, -1]));
    const rElbow = ik(rSh, pose.rHand, L.upper, L.fore, pose.rElbowPole || V.add(V.mul(fwdCh, 0.3), [0, -0.4, -1]));
    const toe = (ank, yaw) => V.add(ank, [0.78 * s * Math.cos(yaw), 0.78 * s * Math.sin(yaw), -0.16 * s]);
    return { pelvis: P, chest, head, lHip, rHip, lSh, rSh, lKnee, rKnee, lAnkle: pose.lAnkle, rAnkle: pose.rAnkle, lToe: toe(pose.lAnkle, pose.lToe || 0), rToe: toe(pose.rAnkle, pose.rToe || 0),
      lElbow, rElbow, lHand: pose.lHand, rHand: pose.rHand, up, fwd: fwdCh, look: pose.look || [0, 1, 0], s, b };
  }
  /** local → world (origin, facing vector for +X, "left" vector for +Y) */
  function toWorld(J, frame) {
    const o = frame.origin, fx = frame.fx, fy = frame.fy, w = (p) => [o[0] + fx[0] * p[0] + fy[0] * p[1], o[1] + fx[1] * p[0] + fy[1] * p[1], o[2] + p[2]];
    const out = {};
    for (const k in J) out[k] = Array.isArray(J[k]) && J[k].length === 3 && typeof J[k][0] === "number" && k !== "up" && k !== "fwd" && k !== "look" ? w(J[k]) : J[k];
    const dir = (p) => [fx[0] * p[0] + fy[0] * p[1], fx[1] * p[0] + fy[1] * p[1], p[2]];
    out.up = dir(J.up); out.fwd = dir(J.fwd); out.look = dir(J.look);
    return out;
  }

  /* ------------------------------------------------------------------ hitter poses (local: X toward the plate, Y toward the pitcher) */
  /** st: { t (seconds, for idle), load 0..1, stride 0..1, swing 0..1 (0.7 = contact), contact [X,Y,Z] local, take 0..1, react 0..1 } */
  function hitterPose(h, st) {
    const s = h.body.scale, cr = (h.stance && h.stance.crouch) || 0, open = (h.stance && h.stance.open) || 0, hh = (h.stance && h.stance.hands) || 0;
    const bob = Math.sin((st.t || 0) * 2.1) * 0.03, waggle = Math.sin((st.t || 0) * 3.3) * (1 - (st.load || 0)) * (1 - (st.swing || 0));
    const load = ease(st.load || 0), stride = st.stride || 0, sw = st.swing || 0, take = ease(st.take || 0);
    const pelZ = (3.02 - cr * 0.28) * s + bob;
    // feet: back (right) foot planted, front (left) foot lifts and strides toward the pitcher
    const rAnk = [-0.05, -1.05 * s, 0.24 * s];
    const lift = Math.sin(Math.PI * clamp(stride, 0, 1)) * 0.32 * s;
    const lAnk = [0.05 + open * 0.35, (1.0 + 0.4 * ease(stride)) * s - open * 0.15, 0.24 * s + lift];
    const swE = ease(clamp(sw / 0.72, 0, 1)), fin = ease(clamp((sw - 0.72) / 0.28, 0, 1));
    const hipYaw = lerp(lerp(open * 0.4 - 0.05, -0.22, load), 1.25, ease(clamp((sw - 0.05) / 0.6, 0, 1))) + 0.15 * fin;
    const chestYaw = lerp(lerp(-0.12, -0.42, load), 1.15, swE) + 0.55 * fin;
    const pelvis = [0.05 - 0.05 * load + 0.1 * swE, -0.05 * s - 0.12 * load + 0.32 * ease(stride) * s, pelZ - 0.08 * swE];
    // the bat: grip (bottom hand) position + barrel direction, by phase
    const stanceH = [0.42, -0.42 + hh * 0.3, 4.75 * s + hh * 0.25], stanceU = V.norm([-0.25 + waggle * 0.08, -0.4 + waggle * 0.06, 0.88]);
    const loadH = [0.32, -0.78, 4.85 * s], loadU = V.norm([-0.15, -0.55, 0.82]);
    const launchH = [0.65, -0.35, 4.25 * s], launchU = V.norm([-0.25, -0.95, 0.1]);
    const c = st.contact || [2.85, 1.05, 2.6];
    const cU = V.norm([1, 0.38, clamp((c[2] - 3.9 * s) * 0.42, -0.85, 0.15)]);
    const contactH = V.sub(c, V.mul(cU, 2.25));
    const finH = [0.2, 0.75, 4.7 * s], finU = V.norm([-0.7, -0.55, 0.05]);
    let H, U;
    if (sw <= 0) { H = V.lerp(stanceH, loadH, load); U = V.norm(V.lerp(stanceU, loadU, load)); }
    else if (sw < 0.45) { const k = ease(sw / 0.45); H = V.lerp(loadH, launchH, k); U = V.norm(V.lerp(loadU, launchU, k)); }
    else if (sw < 0.72) { const k = ease((sw - 0.45) / 0.27); H = V.lerp(launchH, contactH, k); U = V.norm(V.lerp(launchU, cU, k)); }
    else { const k = ease((sw - 0.72) / 0.28); H = V.lerp(contactH, finH, k); U = V.norm(V.lerp(cU, finU, k)); }
    if (take > 0 && sw <= 0) { H = V.lerp(H, [0.4, -0.55, 4.6 * s], take * 0.6); U = V.norm(V.lerp(U, V.norm([-0.1, -0.2, 0.97]), take * 0.6)); }
    if (st.react) { H = V.add(H, [-0.25 * st.react, -0.1 * st.react, 0.1 * st.react]); }
    const lHand = H, rHand = V.add(H, V.mul(U, 0.32));
    return { pose: { pelvis, hipYaw, chestYaw, lean: 0.24 + 0.14 * load - 0.08 * fin + cr * 0.12, side: 0, lAnkle: lAnk, rAnkle: rAnk, lHand, rHand,
      lToe: 0.25 + open * 0.5 + 0.9 * swE, rToe: 0.05 + 1.2 * swE, lKneePole: [1, 0.35, 0], rKneePole: [1, -0.25 + 0.6 * swE, 0],
      lElbowPole: [0.2, 0.3, -1], rElbowPole: [-0.1, -0.6, -1], look: [0.15, 1, -0.05] }, bat: { grip: H, dir: U, len: 2.82 } };
  }

  /* ------------------------------------------------------------------ pitcher poses (local: X = facing in the set, Y toward home) */
  const PK = [ // [phase t, pelvis, hipYaw, chestYaw, lean, frontAnkle, backAnkle, throwHand, gloveHand]
    [0.00, [0, 0.45, 3.12], 0, 0, 0.06, [0.05, 1.35, 0.25], [0, -0.1, 0.25], [0.5, 0.3, 4.3], [0.55, 0.45, 4.35]],
    [0.30, [0, 0.22, 3.26], -0.3, -0.35, 0.02, [0.45, 0.55, 1.75], [0, -0.1, 0.25], [0.48, 0.1, 4.6], [0.55, 0.22, 4.62]],
    [0.62, [0, 2.6, 2.62], 0.85, 0.45, 0.2, [-0.2, 5.0, 0.24], [0, 0.15, 0.42], [1.35, 0.9, 5.35], [0.25, 4.1, 4.55]],
    [0.80, [0, 3.55, 2.48], 1.5, 1.75, 0.55, [-0.2, 5.0, 0.24], [0.05, 1.5, 0.7], null, [0.15, 4.35, 3.9]],
    [1.00, [-0.2, 4.15, 2.2], 1.65, 2.2, 0.95, [-0.2, 5.0, 0.24], [0.55, 3.1, 1.55], [-1.05, 4.7, 2.4], [-0.3, 4.05, 3.75]],
    [1.25, [-0.1, 4.35, 2.95], 1.57, 1.57, 0.25, [-0.5, 4.9, 0.24], [0.9, 4.7, 0.24], [0.45, 5.2, 3.7], [-0.35, 5.2, 3.7]],
  ];
  function pitcherPose(p, t, release) {
    let i = 0; while (i < PK.length - 2 && t > PK[i + 1][0]) i++;
    const a = PK[i], b = PK[i + 1], k = ease((t - a[0]) / (b[0] - a[0]));
    const L3 = (u, v) => V.lerp(u || release, v || release, k);
    const g = (Y) => -0.083 * Math.max(0, Y - 0.6);
    const fa = L3(a[5], b[5]), ba = L3(a[6], b[6]);
    fa[2] += g(fa[1]); ba[2] += g(ba[1]);
    const pel = L3(a[1], b[1]); pel[2] += g(pel[1]) * 0.8;
    return { pelvis: pel, hipYaw: lerp(a[2], b[2], k), chestYaw: lerp(a[3], b[3], k), lean: lerp(a[4], b[4], k), side: 0,
      lAnkle: fa, rAnkle: ba, lHand: L3(a[8], b[8]), rHand: L3(a[7], b[7]), lToe: 1.2, rToe: 0.2,
      lKneePole: [0.6, 1, 0.2], rKneePole: [0.8, 0.6, 0], lElbowPole: [0.4, 0.5, -1], rElbowPole: [0.6, -0.8, -0.6], look: [0, 1, 0] };
  }

  /* ------------------------------------------------------------------ drawing */
  /** tapered chain appended to the current path (joints as circles, tangent hulls between them) */
  function chainPath(ctx, pts, keep) {
    if (!keep) ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]; ctx.moveTo(p.x + p.r, p.y); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      if (i) {
        const q = pts[i - 1], dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy);
        if (d > Math.abs(p.r - q.r) + 0.01) {
          const th = Math.atan2(dy, dx), al = Math.acos(clamp((q.r - p.r) / d, -1, 1));
          // hull polygon wound the same way as the clockwise arcs, so the union fills without holes (nonzero rule)
          let poly = [[q.x + q.r * Math.cos(th + al), q.y + q.r * Math.sin(th + al)], [p.x + p.r * Math.cos(th + al), p.y + p.r * Math.sin(th + al)],
            [p.x + p.r * Math.cos(th - al), p.y + p.r * Math.sin(th - al)], [q.x + q.r * Math.cos(th - al), q.y + q.r * Math.sin(th - al)]];
          let area = 0; for (let k = 0; k < 4; k++) { const u = poly[k], v = poly[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
          if (area < 0) poly = poly.reverse();
          ctx.moveTo(poly[0][0], poly[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(poly[k][0], poly[k][1]); ctx.closePath();
        }
      }
    }
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(k >= 1 ? c + (255 - c) * (k - 1) : c * k);
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }
  /** draw a posed figure. W = world joints; kit = colours; proj(p) → {x, y, s (px per ft), d}; opts.bat {grip, dir, len} world; opts.glove.
      Each body part is one shape (outline, then fill — the fill hides internal joins); parts are painted far to near, so a near
      limb keeps a knockout outline against the torso behind it. */
  function drawFigure(ctx, W, kit, proj, opts) {
    const o = opts || {}, items = [], s = W.s, b = W.b;
    const P = (p, r) => { const q = proj(p); return { x: q.x, y: q.y, r: Math.max(0.6, r * q.s), d: q.d }; };
    const depth = (pts) => pts.reduce((t, p) => t + p.d, 0) / pts.length;
    const nearLeft = proj(W.lSh).d < proj(W.rSh).d;
    const tone = (left) => (left === nearLeft ? 1 : 0.82);
    for (const side of ["l", "r"]) {
      const t = tone(side === "l"), hip = W[side + "Hip"], kn = W[side + "Knee"], an = W[side + "Ankle"], to = W[side + "Toe"];
      const leg = [P(hip, 0.27 * b * s), P(kn, 0.19 * s), P(an, 0.13 * s)];
      const sock = [P(V.lerp(kn, an, 0.22), 0.17 * s), P(an, 0.125 * s)];
      items.push({ d: depth(leg), shapes: [{ pts: leg, fill: shade(kit.pants, t), stroke: true }, { pts: sock, fill: shade(kit.socks, t) }] });
      const shoe = [P(an, 0.15 * s), P(to, 0.1 * s)];
      items.push({ d: depth(shoe) - 0.02, shapes: [{ pts: shoe, fill: shade(kit.shoes, t), stroke: true }] });
    }
    const mid = V.lerp(W.pelvis, W.chest, 0.55);
    const torso = [[P(W.pelvis, 0.43 * b * s), P(mid, 0.47 * b * s), P(W.chest, 0.43 * b * s)], [P(W.lSh, 0.23 * s), P(W.rSh, 0.23 * s)], [P(W.lHip, 0.3 * b * s), P(W.rHip, 0.3 * b * s)]];
    items.push({ d: depth([torso[0][0], torso[0][2]]), torso: torso });
    for (const side of ["l", "r"]) {
      const t = tone(side === "l"), sh = W[side + "Sh"], el = W[side + "Elbow"], hd = W[side + "Hand"];
      const arm = [P(sh, 0.19 * s * b), P(el, 0.135 * s), P(hd, 0.1 * s)];
      const sleeve = [P(sh, 0.205 * s * b), P(V.lerp(sh, el, 0.82), 0.15 * s)];
      items.push({ d: depth(arm) - 0.01, shapes: [{ pts: arm, fill: shade(kit.skin, t), stroke: true }, { pts: sleeve, fill: shade(kit.sleeve || kit.jersey, t) }, { pts: [P(hd, 0.115 * s)], fill: shade(kit.hands || kit.skin, t) }] });
    }
    items.push({ head: true, d: proj(W.head).d - 0.05, h: P(W.head, 0.36 * s), W });
    if (o.bat) items.push({ bat: true, d: proj(V.add(o.bat.grip, V.mul(o.bat.dir, 1.0))).d - 0.25, bat: o.bat });
    if (o.glove) items.push({ glove: true, d: proj(o.glove).d - 0.05, g: P(o.glove, 0.36 * s) });
    items.sort((a, c) => c.d - a.d);
    const outline = kit.outline || "#1d1b1a", ow = Math.max(0.8, (o.px || 1) * 1.5);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const it of items) {
      if (it.torso) {
        ctx.beginPath(); for (const part of it.torso) chainPath(ctx, part, true);
        ctx.strokeStyle = outline; ctx.lineWidth = ow * 2; ctx.stroke(); ctx.fillStyle = kit.jersey; ctx.fill();
        // belt, and trousers from the belt down
        const lh = P(W.lHip, 0), rh = P(W.rHip, 0), pv = P(W.pelvis, 0.42 * b * s);
        ctx.save(); ctx.beginPath(); chainPath(ctx, it.torso[0], true); chainPath(ctx, it.torso[2], true); ctx.clip();
        ctx.fillStyle = kit.pants; ctx.fillRect(Math.min(lh.x, rh.x, pv.x) - pv.r * 2, (lh.y + rh.y) / 2 - pv.r * 0.12, pv.r * 4 + Math.abs(lh.x - rh.x), pv.r * 3);
        ctx.fillStyle = kit.belt || "#222"; ctx.fillRect(Math.min(lh.x, rh.x, pv.x) - pv.r * 2, (lh.y + rh.y) / 2 - pv.r * 0.3, pv.r * 4 + Math.abs(lh.x - rh.x), Math.max(1.2, pv.r * 0.2));
        // a soft side shade for volume
        const ch = P(W.chest, 0.43 * b * s), g = ctx.createLinearGradient(ch.x - ch.r, 0, ch.x + ch.r, 0);
        g.addColorStop(0, "rgba(0,0,0,.14)"); g.addColorStop(0.45, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(255,255,255,.06)");
        ctx.fillStyle = g; ctx.fillRect(ch.x - ch.r * 3, ch.y - ch.r * 2, ch.r * 6, ch.r * 8);
        ctx.restore();
      } else if (it.head) drawHead(ctx, it, kit, proj, outline, ow);
      else if (it.bat) drawBat(ctx, it.bat, proj, outline, ow);
      else if (it.glove) { const g = it.g; ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r * 1.05, g.r * 1.2, 0.3, 0, Math.PI * 2); ctx.fillStyle = "#6B3E1F"; ctx.strokeStyle = outline; ctx.lineWidth = ow; ctx.fill(); ctx.stroke(); }
      else for (const sh of it.shapes) { chainPath(ctx, sh.pts); if (sh.stroke) { ctx.strokeStyle = outline; ctx.lineWidth = ow * 2; ctx.stroke(); } ctx.fillStyle = sh.fill; ctx.fill(); }
    }
  }
  function drawHead(ctx, it, kit, proj, outline, ow) {
    const h = it.h, W = it.W;
    // neck
    ctx.beginPath(); const nk = proj(V.lerp(W.chest, W.head, 0.45)); ctx.arc(nk.x, nk.y, h.r * 0.55, 0, Math.PI * 2); ctx.fillStyle = shade(kit.skin, 0.85); ctx.fill();
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fillStyle = kit.skin; ctx.strokeStyle = outline; ctx.lineWidth = ow; ctx.fill(); ctx.stroke();
    // facing direction on screen (for brim and ear flap)
    const ahead = proj(V.add(W.head, V.mul(V.norm(W.look), 0.5)));
    const dx = ahead.x - h.x, dy = ahead.y - h.y, dl = Math.hypot(dx, dy) || 1;
    if (kit.helmet) {
      ctx.beginPath(); ctx.arc(h.x, h.y - h.r * 0.12, h.r * 1.1, Math.PI * 0.92, Math.PI * 2.08); ctx.closePath();
      ctx.fillStyle = kit.helmet; ctx.fill(); ctx.stroke();
      // ear flap on the side facing the pitcher's view of the camera (protects the face-side ear)
      ctx.beginPath(); ctx.ellipse(h.x - (dx / dl) * h.r * 0.25, h.y + h.r * 0.15, h.r * 0.42, h.r * 0.5, 0, 0, Math.PI * 2); ctx.fillStyle = kit.helmet; ctx.fill();
      // brim toward the pitcher
      ctx.beginPath(); ctx.ellipse(h.x + (dx / dl) * h.r * 0.75, h.y - h.r * 0.2 + (dy / dl) * h.r * 0.3, h.r * 0.55, h.r * 0.2, Math.atan2(dy, dx) * 0.3, 0, Math.PI * 2); ctx.fillStyle = shade(kit.helmet, 0.8); ctx.fill();
      ctx.beginPath(); ctx.arc(h.x - h.r * 0.25, h.y - h.r * 0.55, h.r * 0.22, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fill();
    } else if (kit.cap) {
      ctx.beginPath(); ctx.arc(h.x, h.y - h.r * 0.15, h.r * 1.02, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fillStyle = kit.cap; ctx.fill();
      ctx.beginPath(); ctx.ellipse(h.x + (dx / dl) * h.r * 0.6, h.y - h.r * 0.12, h.r * 0.6, h.r * 0.16, 0, 0, Math.PI * 2); ctx.fillStyle = shade(kit.cap, 0.8); ctx.fill();
    }
  }
  function drawBat(ctx, bat, proj, outline, ow) {
    const n = 6, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, p = proj(V.add(bat.grip, V.mul(bat.dir, -0.12 + t * (bat.len + 0.12)))); pts.push({ x: p.x, y: p.y, r: Math.max(0.8, (0.05 + 0.055 * Math.pow(t, 1.6)) * p.s) }); }
    chainPath(ctx, pts); ctx.strokeStyle = outline; ctx.lineWidth = ow * 1.6; ctx.stroke();
    chainPath(ctx, pts); ctx.fillStyle = "#C79A5B"; ctx.fill();
    // knob and end cap
    const k = pts[0]; ctx.beginPath(); ctx.arc(k.x, k.y, k.r * 1.4, 0, Math.PI * 2); ctx.fillStyle = "#3a2a1a"; ctx.fill();
    const e = pts[n]; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.9, 0, Math.PI * 2); ctx.fillStyle = "#a57c45"; ctx.fill();
  }

  root.CTGRig = { V, ease, easeOut, lerp, clamp, ik, solve, toWorld, hitterPose, pitcherPose, drawFigure, shade };
})(typeof self !== "undefined" ? self : globalThis);
