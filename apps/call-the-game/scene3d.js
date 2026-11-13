/* Call the Game — the 3D game scene. Same interface as the old 2D scene (window.CTGScene.create), so app.js, the engine,
   the rules and the grading are untouched: the engine decides what happens; this file only makes each pitch record visible.

   Choreography per pitch record (rec.end = the engine's simulated endpoint at the front of the plate):
     pitcher delivery (CMU 124_01 retargeted) → ball held in the throwing hand until the release frame → flight
     p(k) = R + (E − R)k + B(k² − k): R = the hand's actual release point, E = the engine endpoint, B = the engine's movement
     (so the ball lands exactly where the engine says) → hitter (CMU 124_07): swing clips aligned so the calibrated contact
     instant is the ball's arrival; height matched by a short torso tilt; whiffs pass a few inches under/over; takes stop
     after the stride and re-set → ball continuation (caught / foul / batted) → reset. */
import { THREE, loadPlayerAssets, Player, createRenderer, UNIFORMS, RUBBER_Z, MOUND_H, ballMesh, FT, catcherCamera } from "./world3d.js";
import { buildStadium } from "./stadium3d.js";

const C = window.CTG;
const PAD = { x0: -1.7, x1: 1.7, z0: 0.7, z1: 4.3 };
let ready = null;
const assets = () => (ready = ready || loadPlayerAssets());

function pickQuality() {
  const q = new URLSearchParams(location.search).get("q");
  if (q) return q;
  try { const s = localStorage.getItem("ctg.quality"); if (s) return s; } catch (_) {}
  const mobile = /iPhone|iPad|Android/.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  return mobile ? "medium" : "high";
}

function create(canvas, opts) {
  const o = opts || {};
  const quality = pickQuality();
  const { renderer, scene, camera, sun } = createRenderer(canvas, { quality });
  let W = 0, H = 0, raf = 0, last = 0, dirty = true;
  const state = { pitcher: null, batter: null, target: null, code: null, showZone: true, last: null, aim: false };
  const S = { players: {}, pitcher: null, batter: null, ball: null, anim: null, cal: {} };
  const ballMat = ballMesh(); const ball = ballMat; ball.visible = false; scene.add(ball);
  const perf = { frames: 0, t0: performance.now(), samples: [] };

  /* ---- overlays: strike zone, glove target reticle, last-pitch marker (registered on the plate's front plane, z = 0) */
  const zone = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.66 * FT, 1.9 * FT)), new THREE.LineBasicMaterial({ color: "#f2ebdd", transparent: true, opacity: 0.55, depthTest: false }));
  zone.position.set(0, 2.5 * FT, 0); zone.renderOrder = 10; scene.add(zone);
  const reticle = new THREE.Group(); reticle.renderOrder = 11;
  const ringMat = new THREE.MeshBasicMaterial({ color: "#f2ebdd", transparent: true, opacity: 0.95, depthTest: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.064, 40), ringMat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), ringMat);
  const ticks = new THREE.Group();
  for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.03), ringMat); const a = (k * Math.PI) / 2; t.position.set(Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0); t.rotation.z = a + Math.PI / 2; ticks.add(t); }
  reticle.add(ring, dot, ticks); reticle.visible = false; scene.add(reticle);
  reticle.traverse((m) => { m.renderOrder = 11; });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.04, 24), new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, opacity: 0.9, depthTest: false }));
  marker.visible = false; marker.renderOrder = 12; scene.add(marker);

  const stadium = buildStadium(scene, quality);

  /* ---- players */
  async function ensurePlayers() {
    await assets();
    if (!S.ready) {
      S.ready = true;
      for (const h of ["R", "L"]) {
        const p = new Player(scene, { role: "batter", hand: h, kit: UNIFORMS.road, skin: "#8d5a3b" });
        p.root.visible = false; S.players["bat" + h] = p; placeBatter(p); calibrate(p);
      }
      dirty = true;
    }
  }
  function placeBatter(p, stance) {
    const clip = p.hand === "R" ? "batR" : "batL";
    p.root.rotation.set(0, Math.PI + (stance ? stance.open * (p.hand === "R" ? 1 : -1) * 0.25 : 0), 0);
    p.root.position.set(0, 0, 0); p.pose(clip, 0.2);
    const fm = p.bonePos("foot_L").add(p.bonePos("foot_R")).multiplyScalar(0.5);
    p.root.position.x += (p.hand === "R" ? -0.84 : 0.84) - fm.x; p.root.position.z += 0.2 - fm.z;
    p.clipName = clip; p.baseX = p.root.position.x;
  }
  function setPitcher(profile) {
    if (S.pitcher && S.pitcher.profileId === profile.id) return;
    if (S.pitcher) scene.remove(S.pitcher.root);
    const kit = Object.assign({}, UNIFORMS.home, { cap: profile.jersey.cap, undershirt: profile.jersey.trim, socks: profile.jersey.trim, trim: profile.jersey.trim });
    const p = new Player(scene, { role: "pitcher", hand: profile.hand, kit, skin: ["#e0ac7e", "#c58a5f", "#f0c49c"][C.PITCHERS.indexOf(profile) % 3], scale: 0.96 + 0.06 * (profile.body.scale - 0.95) });
    p.profileId = profile.id; p.clipName = profile.hand === "R" ? "pitchR" : "pitchL";
    p.root.position.set(0, MOUND_H, 0); p.pose(p.clipName, 0);
    const pv = p.bonePos(profile.hand === "R" ? "foot_R" : "foot_L");
    p.root.position.x += (profile.hand === "R" ? 0.16 : -0.16) - pv.x; p.root.position.z += RUBBER_Z + 0.1 - pv.z;
    S.pitcher = p; dirty = true;
  }
  function setBatter(b) {
    const p = S.players["bat" + b.hand]; if (!p) return;
    for (const k in S.players) S.players[k].root.visible = false;
    p.root.visible = true;
    p.root.scale.setScalar(0.94 + 0.12 * ((b.body && b.body.scale) || 1) - 0.12 * 0.99);
    p.setSkin && p.setSkin(b.skin);
    placeBatter(p, b.stance); S.batter = p; S.batterInfo = b; dirty = true;
  }

  /** find, from the bat's own geometry, the instant the barrel is square across the plate (the contact frame), the sweet
      spot's height there, and how a torso tilt moves it (for matching pitch height) */
  function calibrate(p) {
    const clip = p.clipName, ev = assets && window.__ctgMeta ? null : null;
    const toward = new THREE.Vector3(p.hand === "R" ? 1 : -1, 0, 0);
    let best = { t: 1.6, d: -2 };
    for (let t = 1.3; t <= 1.9; t += 1 / 120) {
      p.pose(clip, t);
      const q = p.bat.getWorldQuaternion(new THREE.Quaternion()), ax = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const d = ax.dot(toward); if (d > best.d) best = { t, d };
    }
    p.pose(clip, best.t);
    const sweet = () => { const q = p.bat.getWorldQuaternion(new THREE.Quaternion()); return p.bat.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.68, 0).applyQuaternion(q)); };
    // sweet-spot height at contact for each adjustment value k ∈ [-1, 1] (a lookup the pitch inverts)
    const table = [];
    for (let k = -1; k <= 1.0001; k += 0.1) { p.tilt = k; p.tiltW = 1; p.pose(clip, best.t); table.push({ k, y: sweet().y }); }
    p.tilt = 0; p.pose(clip, best.t);
    S.cal[p.hand] = { contact: best.t, sweet: sweet(), table };
  }
  function tiltFor(cal, y) {
    let best = cal.table[0]; for (const e of cal.table) if (Math.abs(e.y - y) < Math.abs(best.y - y)) best = e;
    return best.k;
  }
  function layout() {
    const r = canvas.getBoundingClientRect(); W = Math.max(100, r.width); H = Math.max(100, r.height);
    renderer.setSize(W, H, false); catcherCamera(camera, W / H); dirty = true;
  }

  /* ---- ball flight from the engine: endpoint E exactly, movement B from the pitch's break */
  function flightPath(rec, R) {
    const p = C.pitcherById(rec.pitcherId || (state.pitcher && state.pitcher.id)), def = C.pitchDef(p, rec.code);
    const f = C.flight(p, def, rec.end);
    const E = new THREE.Vector3(rec.end.x * FT, rec.end.z * FT, 0);
    const B = new THREE.Vector3(f.breakX * FT, f.breakZ * FT, 0);
    return { R: R.clone(), E, B, T: f.T, at(k, v = new THREE.Vector3()) { const d = k * k - k; return v.copy(this.R).lerp(this.E, k).addScaledVector(this.B, d); } };
  }
  function battedPath(rec, start) {
    const b = rec.bip, rnd = C.rng(C.hash("bip3d", rec.n, rec.end.x));
    if (rec.result === "foultip") return { dur: 0.18, at: (k) => start.clone().add(new THREE.Vector3(0, -0.05 * k, 0.6 * k)) };
    if (rec.result === "foul") {
      const back = rnd() < 0.5, side = rnd() < 0.5 ? -1 : 1;
      const end = back ? new THREE.Vector3(side * (1 + rnd() * 3), 14 + rnd() * 8, 24) : new THREE.Vector3(side * (35 + rnd() * 25), 0, -(20 + rnd() * 25));
      const apex = back ? 0 : 8 + rnd() * 12;
      return { dur: back ? 0.7 : 1.5, at: (k) => { const v = start.clone().lerp(end, k); if (!back) v.y = start.y * (1 - k) + 4 * apex * k * (1 - k); return v; } };
    }
    const q = b.quality, ang = (b.spray * 42 * Math.PI) / 180;
    let dist, apex, dur;
    if (b.type === "ground") { dist = 30 + 14 * q; apex = 0.9; dur = 1.2; }
    else if (b.type === "line") { dist = 50 + 36 * q; apex = 3 + 3 * q; dur = 1.3; }
    else if (b.type === "popup") { dist = 20 + 18 * rnd(); apex = 30; dur = 2.2; }
    else { dist = b.result === "homer" ? 122 + 12 * rnd() : 68 + 36 * q; apex = 18 + 14 * q; dur = 2.0; }
    const end = new THREE.Vector3(dist * Math.sin(ang), 0, -dist * Math.cos(ang));
    return { dur, follow: b.type !== "ground", at: (k) => {
      const kk = b.type === "ground" ? 1 - (1 - k) * (1 - k) : k; const v = start.clone().lerp(end, kk);
      v.y = b.type === "ground" ? 0.04 + Math.abs(Math.sin(k * Math.PI * 3)) * apex * (1 - k) : start.y * (1 - k) + 4 * apex * k * (1 - k);
      return v; } };
  }

  /* ---- the pitch: timeline in seconds of animation time (speed scales it) */
  const P_START = 0.3;                         // into the delivery clip: the pitcher is set, then starts his motion
  function play(rec, opts2) {
    const op = opts2 || {};
    return new Promise(async (resolve) => {
      await ensurePlayers();
      if (!S.pitcher) setPitcher(C.pitcherById(rec.pitcherId));
      const bp = S.batter, cal = S.cal[bp.hand];
      const ev = S.pitcher.meta.clips[S.pitcher.clipName].events;
      const tRel = ev.release - P_START;
      S.pitcher.pose(S.pitcher.clipName, ev.release);
      const R = S.pitcher.ballInHand();
      const fl = flightPath(rec, R);
      const tArr = tRel + fl.T;
      const swing = !!rec.swing, contact = rec.result === "inplay" || rec.result === "foul" || rec.result === "foultip";
      // height match (contact) or a believable miss (whiff): tilt the torso so the sweet spot meets / passes the ball
      const ballY = rec.end.z * FT;
      let aimY = ballY;
      if (rec.result === "whiff") aimY = ballY + (rec.end.z > 2.6 ? -0.13 : 0.11);
      const tilt = swing ? tiltFor(cal, aimY) : 0;
      // inside pitches are met a touch earlier (further out front), away pitches later
      const inside = (bp.hand === "R" ? -1 : 1) * rec.end.x;          // ft toward the batter
      const tShift = swing ? THREE.MathUtils.clamp(inside * 0.012, -0.02, 0.02) + (rec.result === "foul" ? 0.012 : 0) : 0;
      // reach: on contact swings the stride lands a little closer to / further from the plate so the sweet spot meets the ball
      const ballX = rec.end.x * FT, reach = swing && rec.result !== "whiff" ? THREE.MathUtils.clamp(ballX - cal.sweet.x, -0.18, 0.18) : 0;
      const path = contact ? battedPath(rec, fl.at(1).clone().add(new THREE.Vector3(0, 0, -0.25))) : null;
      const tEnd = tArr + (path ? path.dur + 0.5 : 0.9);
      S.anim = { rec, fl, tRel, tArr, tEnd, t: 0, speed: op.speed === "skip" ? 1e6 : op.speed || 1, swing, contact, tilt, tShift, path, cal, resolve, impact: false, takeAt: null, reach };
      marker.visible = false; state.last = null;
      if (op.speed === "skip") { finish(true); }
      dirty = true;
    });
  }
  function finish(skipped) {
    const A = S.anim; if (!A) return;
    S.anim = null; state.last = A.rec; showMarker(A.rec); ball.visible = false;
    if (!A.impact && o.onImpact) o.onImpact(A.rec, skipped);
    S.resetFrom = { t: performance.now() / 1000 };
    A.resolve();
  }
  function showMarker(rec) {
    marker.material.color.set(C.PITCH_COLORS[rec.code] || "#fff");
    marker.position.set(rec.end.x * FT, rec.end.z * FT, 0.002); marker.visible = true;
  }

  /* ---- frame */
  const tmp = new THREE.Vector3(), lookTarget = new THREE.Vector3(0, 0.95, -18), lookCur = lookTarget.clone();
  let idleT = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    if (document.hidden) return;
    idleT += dt;
    const A = S.anim, p = S.pitcher, b = S.batter;
    if (!p || !b) { renderer.render(scene, camera); return; }
    // reticle + zone
    zone.visible = !!state.showZone;
    if (state.target && !A) { reticle.visible = true; reticle.position.set(state.target.x * FT, state.target.z * FT, 0.004); ringMat.color.set(state.code ? C.PITCH_COLORS[state.code] : "#f2ebdd"); }
    else reticle.visible = !!(A && A.t < A.tRel && state.target);
    if (A) {
      // wall-clock timeline: a slow device drops frames instead of playing the pitch in slow motion
      if (A.speed > 0) { if (A.wall == null) A.wall = now - (A.t / A.speed) * 1000; A.t = ((now - A.wall) / 1000) * A.speed; }
      const t = A.t, ev = p.meta.clips[p.clipName].events;
      p.pose(p.clipName, Math.min(P_START + t, p.meta.clips[p.clipName].duration));
      // ball
      if (t < A.tRel) { ball.visible = true; p.ballInHand(ball.position); }
      else if (t < A.tArr) { ball.visible = true; A.fl.at((t - A.tRel) / A.fl.T, ball.position); ball.rotation.x -= dt * 40; }
      else if (A.contact) { const k = Math.min(1, (t - A.tArr) / A.path.dur); ball.visible = k < 1 || A.rec.result !== "foul"; ball.position.copy(A.path.at(k)); }
      else { const k = Math.min(1, (t - A.tArr) / 0.08); ball.position.copy(A.fl.E).add(new THREE.Vector3(0, 0, 0.9 * k)); ball.visible = k < 1; }
      if (!A.impact && t >= A.tArr) { A.impact = true; o.onImpact && o.onImpact(A.rec); }
      // hitter
      const cal = A.cal; let bt;
      if (A.swing) {
        // the captured swing is a touch slower than a big-league one: run the last 0.3 s before contact and the follow-through
        // 25 % / 15 % faster (continuous mapping, so there is no jump in the pose)
        const u = A.tArr - t;
        bt = cal.contact + A.tShift - (u < 0 ? u * 1.15 : u < 0.3 ? u * 1.25 : 0.375 + (u - 0.3));
      }
      else { bt = cal.contact - (A.tArr - t); const ev2 = b.meta.clips[b.clipName].events; if (bt > ev2.strideLand + 0.02) { A.takeAt = A.takeAt == null ? t : A.takeAt; bt = ev2.strideLand + 0.02; } }
      const idleBt = 0.2 + 0.35 * (1 - Math.cos(idleT * 0.9)) / 2;
      if (bt < idleBt) bt = idleBt;
      b.tilt = A.tilt; b.tiltW = A.swing ? bell(bt, cal.contact, 0.24, 0.3) : 0;
      const evb = b.meta.clips[b.clipName].events;
      b.root.position.x = b.baseX + A.reach * smooth(THREE.MathUtils.clamp((bt - evb.strideStart) / (cal.contact - 0.05 - evb.strideStart), 0, 1));
      if (A.takeAt != null) { const k = Math.min(1, (t - A.takeAt - 0.35) / 0.6); if (k > 0) b.blendTo(b.clipName, bt, idleBt, k); else b.pose(b.clipName, bt); }
      else b.pose(b.clipName, Math.min(bt, b.meta.clips[b.clipName].duration));
      // follow a lofted ball with the camera, gently
      if (A.contact && A.path && A.path.follow && t > A.tArr) lookTarget.lerp(ball.position.clone().setY(Math.max(1, ball.position.y * 0.6)), 0.06);
      if (t >= A.tEnd) finish(false);
    } else {
      // between pitches: hitter's natural stance motion; pitcher stands on the rubber; a short re-set after each pitch
      const idleBt = 0.2 + 0.35 * (1 - Math.cos(idleT * 0.9)) / 2;
      b.tilt = 0;
      const r = S.resetFrom ? Math.min(1, (performance.now() / 1000 - S.resetFrom.t) / 0.9) : 1;
      if (r < 1 && S.resetFrom) {
        if (!S.resetFrom.bt) { S.resetFrom.bt = b.action ? b.action.time : idleBt; S.resetFrom.pt = p.action ? p.action.time : 0; }
        b.blendTo(b.clipName, S.resetFrom.bt, idleBt, smooth(r)); p.blendTo(p.clipName, S.resetFrom.pt, 0.05, smooth(r));
      } else { b.pose(b.clipName, idleBt); p.pose(p.clipName, 0.05 + 0.04 * Math.sin(idleT * 0.6)); }
      if (b.baseX != null) b.root.position.x += (b.baseX - b.root.position.x) * 0.06;
      lookTarget.lerp(new THREE.Vector3(0, 0.95, -18), 0.08);
    }
    if (!S.freezeCam) { lookCur.lerp(lookTarget, 0.2); camera.lookAt(lookCur); }
    { const d = ball.position.distanceTo(camera.position); ball.scale.setScalar(Math.max(1, d / 22)); }
    renderer.render(scene, camera);
    perf.frames++; perf.samples.push(dt); if (perf.samples.length > 240) perf.samples.shift();
    // progressive quality: if this device can't hold ~30 fps, step down resolution, then shadows (never below playable)
    if (perf.samples.length === 240 && !S.adapting && !new URLSearchParams(location.search).get("q")) {
      const avg = perf.samples.reduce((a, b) => a + b, 0) / 240;
      if (avg > 1 / 30) {
        S.adapting = true; const pr = renderer.getPixelRatio();
        if (pr > 1.01) renderer.setPixelRatio(Math.max(1, pr * 0.7));
        else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((m) => { if (m.material) m.material.needsUpdate = true; }); }
        layout(); perf.samples.length = 0; setTimeout(() => (S.adapting = false), 4000);
      }
    }
  }
  const smooth = (x) => x * x * (3 - 2 * x);
  function bell(t, c, a, b) { return t < c ? smooth(THREE.MathUtils.clamp((t - (c - a)) / a, 0, 1)) : smooth(THREE.MathUtils.clamp(1 - (t - c) / b, 0, 1)); }

  /* ---- input: tap/drag on the scene places the glove on the plate's front plane */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  function toPlate(px, py) {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (!hit) return null;
    return { x: hit.x / FT, z: hit.y / FT };
  }
  function onPointer(e) {
    if (!state.aim || S.anim) return;
    const r = canvas.getBoundingClientRect(), p = toPlate(e.clientX - r.left, e.clientY - r.top);
    if (!p || p.x < PAD.x0 - 0.6 || p.x > PAD.x1 + 0.6 || p.z < PAD.z0 - 0.6 || p.z > PAD.z1 + 0.6) return;
    e.preventDefault();
    o.onTarget && o.onTarget({ x: Math.max(PAD.x0, Math.min(PAD.x1, p.x)), z: Math.max(PAD.z0, Math.min(PAD.z1, p.z)) });
  }
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} onPointer(e); });
  canvas.addEventListener("pointermove", (e) => { if (dragging) onPointer(e); });
  canvas.addEventListener("pointerup", () => (dragging = false)); canvas.addEventListener("pointercancel", () => (dragging = false));
  new ResizeObserver(layout).observe(canvas); layout();
  raf = requestAnimationFrame(frame);
  ensurePlayers().then(() => { if (state.pitcher) setPitcher(state.pitcher); if (state.batter) setBatter(state.batter); o.onReady && o.onReady(); });

  function set(s) {
    Object.assign(state, s);
    if (s.pitcher && S.ready) setPitcher(s.pitcher);
    if (s.batter && S.ready && (!S.batterInfo || S.batterInfo.id !== s.batter.id || S.batterInfo.hand !== s.batter.hand)) setBatter(s.batter);
    if ("last" in s) { if (s.last) showMarker(s.last); else marker.visible = false; }
    dirty = true;
  }
  return {
    set, play, toPlate, PAD, skip() { if (S.anim) { S.anim.speed = 0; S.anim.t = S.anim.tEnd; } },
    seek(t) { if (S.anim) { S.anim.speed = 0; S.anim.t = t; S.anim.wall = null; } return S.anim ? { rel: S.anim.tRel, arr: S.anim.tArr, end: S.anim.tEnd } : null; },
    get busy() { return !!S.anim; }, get state() { return state; },
    fps() { const s = perf.samples.filter((x) => x > 0); const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length); return { fps: avg ? 1 / avg : 0, quality, frames: perf.frames }; },
    ready: () => ensurePlayers(),
    _debug: { camera, scene, renderer, S, freeze(v) { S.freezeCam = v; } },
  };
}

window.CTGScene = { create, PAD };
window.CTGSceneReady = assets();
