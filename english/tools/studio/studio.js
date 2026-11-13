/* English — illustration studio (offline production tool; not shipped to users).
   Figures are posed on an anatomically proportioned CC0 body (MakeHuman base mesh + default rig, from the Call the Game
   pipeline) — from real motion capture where it exists (CMU 124 pitch / swing) or by IK against references — with real
   equipment geometry (a laced fielding glove, a ball with the true seam curve), then rendered as editorial ink illustrations:
   flat tonal shading + an outline pass from normal/depth edges, supersampled. Callout anchors are projected from 3D, so
   labels in the app register with the subject. Output: PNG (→ WebP) + JSON manifest per figure.  See ../../content/GRAPHICS.md */
import * as THREE from "/apps/call-the-game/vendor/three.module.min.js";
import { GLTFLoader } from "/apps/call-the-game/vendor/GLTFLoader.js";
import * as SkeletonUtils from "/apps/call-the-game/vendor/SkeletonUtils.js";

export { THREE };
const log = (m) => { document.getElementById("log").textContent = m; };

/* ------------------------------------------------------------------ assets */
let TPL = null, META = null, MASK = null;
export async function load() {
  if (TPL) return;
  const [g, m, t] = await Promise.all([new GLTFLoader().loadAsync("/apps/call-the-game/assets/player.glb"), fetch("/apps/call-the-game/assets/player.json").then((r) => r.json()),
    new THREE.TextureLoader().loadAsync("/apps/call-the-game/assets/uniform-mask.png")]);
  t.flipY = false; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace;
  TPL = g; META = m; MASK = t;
}

/* ------------------------------------------------------------------ palette & materials */
export const INK = "#252525";
const REGIONS = ["skin", "jersey", "pants", "belt", "undershirt", "socks", "shoes", "hands", "trim", "hair"];
let GRADIENT = null;
function gradient() {
  if (GRADIENT) return GRADIENT;
  const d = new Uint8Array([150, 150, 150, 255, 196, 196, 196, 255, 236, 236, 236, 255, 255, 255, 255, 255]);   // 4 soft tones
  GRADIENT = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat); GRADIENT.magFilter = GRADIENT.minFilter = THREE.NearestFilter; GRADIENT.needsUpdate = true;
  return GRADIENT;
}
export function mat(color, style, o = {}) {
  if (style === "real" || style === "editorial") return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o));
  if (style === "flat") return new THREE.MeshBasicMaterial(Object.assign({ color: flatTone(color) }, o));
  return new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradient() }, o));
}
/** "flat" style: every surface becomes one of three tones — charcoal figure, taupe secondary, oxblood for equipment */
function flatTone(color) { const c = new THREE.Color(color), hsl = {}; c.getHSL(hsl); return hsl.l > 0.75 ? "#d9cfbd" : hsl.s > 0.35 && hsl.l < 0.5 ? "#581B20" : hsl.l < 0.3 ? "#3a3734" : "#a28b77"; }
function bodyMaterial(colors, style) {
  if (style === "flat") return new THREE.MeshBasicMaterial({ color: "#4a4643" });
  const m = style === "real" || style === "editorial" ? new THREE.MeshStandardMaterial({ map: MASK, roughness: 0.75 }) : new THREE.MeshToonMaterial({ map: MASK, gradientMap: gradient() });
  const pal = REGIONS.map((r) => new THREE.Color(colors[r] || "#888"));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPal = { value: pal };
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uPal[10];")
      .replace("#include <map_fragment>", `float rid = floor(texture2D(map, vMapUv).r * 255.0 + 0.5); vec3 pc = uPal[0];
        for (int i = 1; i < 10; i++) { if (abs(rid - float(i)) < 0.5) pc = uPal[i]; } diffuseColor.rgb *= pc;`);
  };
  m.customProgramCacheKey = () => "studio-body-" + style;
  return m;
}
export const KITS = {
  home: { jersey: "#efe9dd", pants: "#efe9dd", belt: "#252525", undershirt: "#581B20", socks: "#581B20", shoes: "#1f1d1c", trim: "#581B20", hair: "#1c1714" },
  practice: { jersey: "#3a3d44", pants: "#d9d3c6", belt: "#252525", undershirt: "#3a3d44", socks: "#581B20", shoes: "#1f1d1c", trim: "#efe9dd", hair: "#1c1714" },
};
export const SKIN = { light: "#e2b48e", medium: "#b9825a", deep: "#7b4b2f" };

/* ------------------------------------------------------------------ athlete + pose API */
const V = (a) => new THREE.Vector3(...a);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function setWorldRot(bone, q) { const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()); bone.quaternion.copy(pq.invert().multiply(q)); bone.updateMatrixWorld(true); }
function rotWorld(bone, dq) { setWorldRot(bone, dq.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))); }
const wpos = (b) => b.getWorldPosition(new THREE.Vector3());

export class Athlete {
  constructor(scene, { kit = KITS.home, skin = SKIN.medium, style = "ink", hidden = [] } = {}) {
    this.root = SkeletonUtils.clone(TPL.scene); this.style = style; this.bones = {};
    this.root.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false; o.castShadow = true; o.receiveShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const nm = mats.map((m0) => m0.name === "eyes" ? mat("#2a2420", style) : bodyMaterial(Object.assign({ skin, hands: skin }, kit), style));
        o.material = Array.isArray(o.material) ? nm : nm[0];
        this.mesh = o;
      }
    });
    this.rest = {}; for (const k in this.bones) this.rest[k] = { q: this.bones[k].quaternion.clone(), p: this.bones[k].position.clone() };
    this.hands = META.hands; scene.add(this.root);
  }
  reset() { for (const k in this.bones) { this.bones[k].quaternion.copy(this.rest[k].q); this.bones[k].position.copy(this.rest[k].p); } this.root.updateMatrixWorld(true); }
  b(n) { return this.bones[n]; }
  /** apply a pose (character space: +Z forward, +Y up, metres; the athlete faces +Z) */
  pose(P) {
    this.reset(); const b = this.bones;
    const r = P.root || {};
    if (r.drop || r.shift) b.root.position.add(V([r.shift ? r.shift[0] : 0, -(r.drop || 0), r.shift ? r.shift[2] : 0]));
    b.root.quaternion.setFromEuler(new THREE.Euler(r.pitch || 0, r.yaw || 0, r.roll || 0, "YXZ"));
    // spine: forward flexion (+), twist (+ = chest turns toward its left), side bend; distributed over five vertebral bones
    const sp = P.spine || {}, w = [0.16, 0.2, 0.22, 0.22, 0.2], names = ["spine05", "spine04", "spine03", "spine02", "spine01"];
    names.forEach((n, i) => b[n].quaternion.setFromEuler(new THREE.Euler((sp.flex || 0) * w[i], (sp.twist || 0) * w[i], (sp.side || 0) * w[i], "YXZ")));
    const hd = P.head || {};
    ["neck01", "neck02", "neck03", "head"].forEach((n, i) => b[n].quaternion.setFromEuler(new THREE.Euler((hd.pitch || 0) * [0.2, 0.25, 0.25, 0.3][i], (hd.yaw || 0) * [0.2, 0.25, 0.25, 0.3][i], (hd.roll || 0) * 0.25, "YXZ")));
    for (const s of ["L", "R"]) if (P.clav && P.clav[s]) b["clavicle_" + s].quaternion.setFromEuler(new THREE.Euler(...P.clav[s], "YXZ"));
    this.root.updateMatrixWorld(true);
    for (const s of ["L", "R"]) {
      const L = P.legs && P.legs[s];
      if (L) {
        ik2(b["upperleg01_" + s], b["lowerleg01_" + s], b["foot_" + s], V(L.ankle), V(L.knee || [0, 0, 1]));
        setWorldRot(b["foot_" + s], new THREE.Quaternion().setFromEuler(new THREE.Euler(L.pitch || 0, L.yaw || 0, L.roll || 0, "YXZ")));
      }
    }
    for (const s of ["L", "R"]) {
      const A = P.arms && P.arms[s];
      if (A) {
        if (A.hand) ik2(b["upperarm01_" + s], b["lowerarm01_" + s], b["wrist_" + s], this.wristFor(s, V(A.hand), A), V(A.elbow || [0, -1, 0]));
        if (A.fingers) this.orientHand(s, V(A.fingers), V(A.palm));
      }
      const F = P.fingers && P.fingers[s];
      if (F) this.curl(s, F);
    }
    this.root.updateMatrixWorld(true);
    return this;
  }
  /** wrist target such that the hand's centre (palm) lands on `center` once oriented */
  wristFor(s, center, A) {
    if (!A.fingers || !A.palm) return center;
    const q = this.handQuat(s, V(A.fingers), V(A.palm));
    return center.clone().sub(V(this.hands["wrist_" + s].center).applyQuaternion(q));
  }
  handQuat(s, fingers, palm) {
    const H = this.hands["wrist_" + s], f0 = V(H.fingers).normalize(), p0 = V(H.palm).normalize();
    const p0o = p0.clone().addScaledVector(f0, -p0.dot(f0)).normalize();
    const f1 = fingers.clone().normalize(), p1 = palm.clone().addScaledVector(f1, -palm.dot(f1)).normalize();
    const m0 = new THREE.Matrix4().makeBasis(f0, p0o, f0.clone().cross(p0o)), m1 = new THREE.Matrix4().makeBasis(f1, p1, f1.clone().cross(p1));
    return new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
  }
  orientHand(s, fingers, palm) { setWorldRot(this.bones["wrist_" + s], this.handQuat(s, fingers, palm)); }
  /** finger flexion: {curl: rad (all), per: {index, middle, ring, pinky: rad}, spread: rad, thumb: [flex, oppose]} */
  curl(s, F) {
    const b = this.bones, w = META.rest, palm = V(this.hands["wrist_" + s].palm).normalize();
    const fingers = { thumb: 1, index: 2, middle: 3, ring: 4, pinky: 5 };
    for (const [name, k] of Object.entries(fingers)) {
      const c = name === "thumb" ? (F.thumb ? F.thumb[0] : 0.3) : ((F.per && F.per[name] != null) ? F.per[name] : (F.curl || 0));
      for (let j = 1; j <= 3; j++) {
        const n = `finger${k}-${j}_${s}`; if (!b[n]) continue;
        const d = V(w[n].tail).sub(V(w[n].head)).normalize();
        const axis = d.clone().cross(palm).normalize();
        let q = new THREE.Quaternion().setFromAxisAngle(axis, c * (j === 1 ? 0.85 : j === 2 ? 1.0 : 0.75));
        if (j === 1 && name !== "thumb" && F.spread) { const sp = (k - 3.3) * F.spread; q = new THREE.Quaternion().setFromAxisAngle(palm, sp).multiply(q); }
        if (j === 1 && name === "thumb" && F.thumb) q = new THREE.Quaternion().setFromAxisAngle(d.clone().cross(axis).normalize(), F.thumb[1] || 0).multiply(q);
        b[n].quaternion.copy(q);
      }
    }
    this.root.updateMatrixWorld(true);
  }
  /** close each finger until its pad rests on the ball's surface (bisection on the curl), then the thumb underneath.
      fingers: names to solve; others take `fixed` curls. skin = pad thickness. */
  gripBall(s, center, r, { fingers = ["index", "middle"], fixed = {}, spread = 0, thumb = true, skin = 0.009, base = {}, thumbTarget = null } = {}) {
    const k = { thumb: 1, index: 2, middle: 3, ring: 4, pinky: 5 }, tipOf = (name) => {
      const b3 = this.bones[`finger${k[name]}-3_${s}`]; b3.updateMatrixWorld(true);
      const rest = META.rest[`finger${k[name]}-3_${s}`], len = V(rest.tail).sub(V(rest.head)).length();
      return new THREE.Vector3(0, 0, 0).applyMatrix4(b3.matrixWorld).add(V(rest.tail).sub(V(rest.head)).normalize().multiplyScalar(len * 0.75).applyQuaternion(b3.getWorldQuaternion(new THREE.Quaternion())));
    };
    // contact is not monotonic in the curl (a fully closed finger swings past the ball), so scan forward from open to the
    // first contact, then refine between the last open and first touching step
    const per = Object.assign({}, fixed);
    const firstContact = (set, from, to, step = 0.04) => {
      let prev = from;
      for (let c = from; c <= to; c += step) { set(c); if (tipOf.cur() <= 0) { let lo = prev, hi = c; for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; set(m); if (tipOf.cur() <= 0) hi = m; else lo = m; } set(hi); return hi; } prev = c; }
      set(to); return to;
    };
    let th = base.thumb || [0.3, 0.6];
    for (const n of fingers) { tipOf.cur = () => tipOf(n).distanceTo(center) - (r + skin); firstContact((c) => { per[n] = c; this.curl(s, { per, spread, thumb: th }); }, -0.1, 2.0); }
    if (thumb && thumbTarget) {
      // thumb: 2-D search over flexion × opposition for the pad nearest the point under the ball, then settle onto the surface
      let best = null;
      for (let f = -0.6; f <= 1.4; f += 0.1) for (let o = -1.6; o <= 1.6; o += 0.1) {
        this.curl(s, { per, spread, thumb: [f, o] }); const d = tipOf("thumb").distanceTo(thumbTarget);
        if (!best || d < best.d) best = { d, f, o };
      }
      for (let f = best.f - 0.1; f <= best.f + 0.1; f += 0.02) for (let o = best.o - 0.1; o <= best.o + 0.1; o += 0.02) {
        this.curl(s, { per, spread, thumb: [f, o] }); const d = tipOf("thumb").distanceTo(thumbTarget); if (d < best.d) best = { d, f, o };
      }
      th = [best.f, best.o]; this.thumbErr = best.d;
    } else if (thumb) { tipOf.cur = () => tipOf("thumb").distanceTo(center) - (r + skin); firstContact((c) => { th = [c, (base.thumb || [0, 0.9])[1]]; this.curl(s, { per, spread, thumb: th }); }, -0.3, 1.6); }
    this.curl(s, { per, spread, thumb: th });
    return { per, thumb: th };
  }
  /** sample a motion-capture clip (from the Call the Game asset) at time t */
  clipPose(name, t) {
    if (!this.mixer) this.mixer = new THREE.AnimationMixer(this.root);
    const clip = TPL.animations.find((c) => c.name === name), act = this.mixer.clipAction(clip);
    act.reset(); act.play(); this.mixer.setTime(t); this.root.updateMatrixWorld(true); act.enabled = true; return this;
  }
  /** a point in the hand frame (palm-centre origin; x = toward thumb, y = fingers, z = palm normal) → world */
  handFrame(s) {
    const wr = this.bones["wrist_" + s]; wr.updateMatrixWorld(true);
    const q = wr.getWorldQuaternion(new THREE.Quaternion()), H = this.hands["wrist_" + s];
    const f = V(H.fingers).normalize().applyQuaternion(q), p = V(H.palm).normalize().applyQuaternion(q);
    const p2 = p.clone().addScaledVector(f, -p.dot(f)).normalize();
    const thumb = wpos(this.bones[`finger1-2_${s}`]).sub(wpos(wr));
    const xr = f.clone().cross(p2).normalize(), mirror = xr.dot(thumb) < 0 ? -1 : 1;   // right-handed basis; mirror the geometry for the other hand
    const c = V(H.center).applyMatrix4(wr.matrixWorld);
    return { origin: c, x: xr.clone().multiplyScalar(mirror), y: f, z: p2, mirror, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xr, f, p2)) };
  }
  joint(n) { return wpos(this.bones[n]); }
}

/** two-bone IK: rotate A then B so End reaches target, bending toward pole */
export function ik2(A, B, End, target, pole) {
  const S = wpos(A), E = wpos(B), W = wpos(End);
  const l1 = E.distanceTo(S), l2 = W.distanceTo(E);
  const to = target.clone().sub(S); const d = Math.min(to.length(), (l1 + l2) * 0.9995); const u = to.normalize();
  let bend = pole.clone().addScaledVector(u, -pole.dot(u)); if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1); bend.normalize();
  const a1 = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
  const E2 = S.clone().addScaledVector(u, a1).addScaledVector(bend, h);
  rotWorld(A, new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize()));
  const W2 = wpos(End), E3 = wpos(B);
  rotWorld(B, new THREE.Quaternion().setFromUnitVectors(W2.sub(E3).normalize(), S.clone().addScaledVector(u, d).sub(E3).normalize()));
}

/* ------------------------------------------------------------------ equipment */
/** baseball: radius 0.0368 m; the seam is the tennis-ball curve on the sphere; stitches painted as red V-marks either side */
export function seamPoint(t, b = 0.27) {
  const a = 1 - b, c = 2 * Math.sqrt(a * b);
  return new THREE.Vector3(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)).normalize();
}
export function ballMesh(style, r = 0.0368) {
  const g = new THREE.Group();
  const leather = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), mat("#f7f3ea", style)); leather.userData.part = "ball"; g.add(leather);
  // seam groove + stitches as geometry so they survive any view and the outline pass
  const N = 216, seamMat = mat("#d9d0bf", style), stitch = mat("#b8322c", style);
  const pts = []; for (let i = 0; i <= N; i++) pts.push(seamPoint((i / N) * Math.PI * 2).multiplyScalar(r * 1.0005));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 400, r * 0.035, 6, true), seamMat));
  for (let i = 0; i < 108; i++) {                         // 108 double stitches
    const t = (i / 108) * Math.PI * 2, p = seamPoint(t), p2 = seamPoint(t + 0.01), tan = p2.clone().sub(p).normalize(), side = p.clone().cross(tan).normalize();
    for (const sg of [-1, 1]) {
      const a = p.clone().addScaledVector(side, sg * 0.07).addScaledVector(tan, -0.02).normalize().multiplyScalar(r * 1.004);
      const bb = p.clone().addScaledVector(side, sg * 0.018).addScaledVector(tan, 0.03).normalize().multiplyScalar(r * 1.004);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.022, r * 0.022, a.distanceTo(bb), 5), stitch);
      m.position.copy(a).lerp(bb, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bb.clone().sub(a).normalize()); g.add(m);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** an infielder's glove (≈11.5 in heel-to-tip), built in the hand frame: x = toward the thumb, y = finger direction,
    z = pocket normal (the palm side). open: 0 = flat, 1 = closed around a ball. */
export function gloveMesh(style, { open = 0.45, color = "#8b5a2b", lace = "#5a3418" } = {}) {
  const g = new THREE.Group(), lea = mat(color, style), dark = mat(shade(color, 0.78), style), lc = mat(lace, style), pocket = mat(shade(color, 1.12), style);
  const tube = (pts, r0, r1, m, caps = true) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(V)), segs = 32, rad = 16, geo = new THREE.TubeGeometry(curve, segs, 1, rad, false);
    const pos = geo.attributes.position;
    for (let i = 0; i <= segs; i++) { const t = i / segs, rr = r0 + (r1 - r0) * t, c = curve.getPointAt(t); for (let k = 0; k <= rad; k++) { const idx = i * (rad + 1) + k; _v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(rr).add(c); pos.setXYZ(idx, _v.x, _v.y, _v.z); } }
    geo.computeVertexNormals(); const mesh = new THREE.Mesh(geo, m); g.add(mesh);
    if (caps) for (const [p, rr] of [[pts[0], r0], [pts[pts.length - 1], r1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(rr, 16, 12), m); cap.position.copy(V(p)); g.add(cap); }
    return mesh;
  };
  const c = open;
  // back of the hand and heel: one full, rounded body (the glove is far bigger than the hand inside it)
  const back = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), lea); back.scale.set(0.086, 0.118, 0.046); back.position.set(-0.004, 0.012, -0.012); g.add(back);
  // the pocket: lighter palm leather, concave, facing +z
  const pk = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), pocket);
  pk.rotation.x = Math.PI / 2; pk.scale.set(0.074, 0.03, 0.098); pk.position.set(0.004, 0.035, 0.038 + c * 0.004); pk.material = pocket; pk.material.side = THREE.DoubleSide; g.add(pk);
  // heel roll (padded, rolled edge at the base of the pocket)
  tube([[-0.074, -0.082, 0.004], [-0.03, -0.1, 0.024], [0.03, -0.098, 0.026], [0.076, -0.07, 0.01]], 0.021, 0.019, dark);
  // four finger stalls, side by side (fused at the back), fanned slightly and cupping toward the pocket
  const fx = [-0.054, -0.019, 0.016, 0.049], len = [0.17, 0.205, 0.2, 0.175];
  fx.forEach((x, i) => {
    const L = len[i], fan = x * 0.28, tip = c * 0.085;
    tube([[x * 0.92, 0.035, -0.006], [x + fan * 0.35, 0.035 + L * 0.45, 0.004 + tip * 0.15], [x + fan * 0.8, 0.035 + L * 0.85, tip * 0.6], [x + fan, 0.035 + L, tip]], 0.022, 0.0195, lea);
  });
  // thumb stall: big, angled out from the heel toward the web
  tube([[0.07, -0.05, 0.012], [0.098, 0.03, 0.03 + c * 0.03], [0.104, 0.11, 0.05 + c * 0.05], [0.094, 0.165, 0.06 + c * 0.06]], 0.025, 0.02, lea);
  // I-web between the thumb and the first finger: two posts and three cross bars, laced
  const wz = 0.045 + c * 0.05;
  for (const x of [0.066, 0.09]) tube([[x, 0.12, wz - 0.01], [x, 0.18, wz], [x - 0.004, 0.235, wz + 0.004]], 0.006, 0.006, dark);
  for (const y of [0.14, 0.18, 0.22]) tube([[0.06, y, wz], [0.098, y, wz]], 0.005, 0.005, dark);
  // binding and lacing over the finger tips and down the little-finger side
  tube([[-0.082, 0.18, 0.0], [-0.07, 0.235, 0.012 + c * 0.05], [-0.04, 0.262, 0.02 + c * 0.075], [-0.003, 0.276, 0.02 + c * 0.08], [0.035, 0.262, 0.02 + c * 0.075], [0.062, 0.232, 0.018 + c * 0.06]], 0.0042, 0.0042, lc);
  tube([[-0.084, -0.07, 0.0], [-0.088, 0.04, 0.002], [-0.082, 0.17, 0.006]], 0.004, 0.004, lc);
  // wrist strap and the opening for the back of the hand
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.026, 0.012), dark); strap.position.set(-0.004, -0.07, -0.056); g.add(strap);
  const hole = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mat("#2b2119", style)); hole.scale.set(0.022, 0.012, 0.004); hole.position.set(-0.01, -0.045, -0.058); g.add(hole);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.part = o.userData.part || "glove"; } });
  return g;
}
/** low-cut cleat in the foot bone's rest frame (ankle origin, toes toward +z, sole at y = −ankle height) */
export function cleatMesh(style, { color = "#1f1d1c", sole = "#33302c", lace = "#d8d2c6", ankleH = 0.08 } = {}) {
  const g = new THREE.Group(), up = mat(color, style), so = mat(sole, style), lc = mat(lace, style);
  // sole: a foot-shaped outline (rounded heel, wide ball, rounded toe), bevelled
  const sh = new THREE.Shape(); sh.moveTo(0, -0.075);
  sh.bezierCurveTo(0.042, -0.075, 0.042, -0.02, 0.04, 0.04); sh.bezierCurveTo(0.05, 0.1, 0.052, 0.15, 0.035, 0.19);
  sh.bezierCurveTo(0.02, 0.215, -0.02, 0.215, -0.034, 0.19); sh.bezierCurveTo(-0.048, 0.15, -0.046, 0.1, -0.038, 0.04); sh.bezierCurveTo(-0.04, -0.02, -0.042, -0.075, 0, -0.075);
  const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 3, curveSegments: 24 });
  sg.rotateX(Math.PI / 2); const solem = new THREE.Mesh(sg, so); solem.position.set(0, -ankleH + 0.018, 0.0); g.add(solem);
  // upper: toe box + vamp + heel counter, smoothly overlapping
  const part = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), up); m.scale.set(sx, sy, sz); m.position.set(x, -ankleH + y, z); g.add(m); return m; };
  part(0.045, 0.034, 0.075, 0, 0.034, 0.13);      // toe box
  part(0.047, 0.05, 0.085, 0, 0.05, 0.05);        // vamp / instep
  part(0.044, 0.058, 0.055, 0, 0.06, -0.028);     // heel counter
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 10, 28), up); collar.rotation.x = Math.PI / 2 - 0.25; collar.position.set(0, -ankleH + 0.1, -0.01); g.add(collar);
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.003, 0.006), lc); l.position.set(0, -ankleH + 0.098 - i * 0.008, 0.03 + i * 0.022); l.rotation.x = -0.45; g.add(l); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return "#" + c.getHexString(); }
export function capMesh(style, color = "#581B20") {
  // fitted ball cap: six-panel crown hugging the skull, a 7 cm curved bill, top button
  const g = new THREE.Group(), m = mat(color, style);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.097, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), m); crown.scale.set(1.0, 0.94, 1.12);
  // bill: D-shaped, 7 cm deep, curved across its width and pitched slightly down
  const bs = new THREE.Shape(); bs.moveTo(-0.09, 0); bs.bezierCurveTo(-0.085, 0.07, 0.085, 0.07, 0.09, 0); bs.lineTo(-0.09, 0);
  const bg = new THREE.ExtrudeGeometry(bs, { depth: 0.005, bevelEnabled: false, curveSegments: 24 }); bg.rotateX(Math.PI / 2);
  const bp = bg.attributes.position; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getZ(i); bp.setY(i, bp.getY(i) - 1.6 * x * x - 0.25 * Math.max(0, -z) * 0.0); } bg.computeVertexNormals();
  const bill = new THREE.Mesh(bg, m); bill.position.set(0, -0.006, 0.094); bill.rotation.x = -0.2; bill.scale.set(1.08, 1, -1.15);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.097, 0.005, 6, 40), m); brim.rotation.x = Math.PI / 2; brim.scale.set(1.0, 1.12, 1); brim.position.y = -0.012;
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), m); btn.position.set(0, 0.092, 0);
  g.add(crown, bill, brim, btn); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}
/* ------------------------------------------------------------------ renderer: ink illustration */
let R = null;
function renderer(w, h) {
  if (!R) {
    const canvas = document.getElementById("c");
    R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  R.setPixelRatio(1); R.setSize(w, h, false); return R;
}
const QUAD_VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const INK_FS = `
uniform sampler2D tColor, tNormal, tDepth; uniform vec2 px; uniform float near, far, width, inkAlpha; uniform vec3 ink;
varying vec2 vUv;
float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
void main(){
  vec4 c = texture2D(tColor, vUv); vec3 n0 = texture2D(tNormal, vUv).xyz * 2.0 - 1.0; float d0 = lin(texture2D(tDepth, vUv).r);
  float e = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * px * width;
    vec3 n1 = texture2D(tNormal, vUv + o).xyz * 2.0 - 1.0; float d1 = lin(texture2D(tDepth, vUv + o).r);
    float a1 = texture2D(tColor, vUv + o).a;
    e = max(e, smoothstep(0.35, 0.75, 1.0 - dot(n0, n1)) * step(0.01, c.a + a1));
    e = max(e, smoothstep(0.012, 0.03, abs(d1 - d0) / max(d0, 0.001)) * step(0.01, c.a + a1));
    e = max(e, abs(a1 - c.a));
  }
  vec4 col = c;
  col.rgb = mix(col.rgb, ink, e * inkAlpha); col.a = max(col.a, e * inkAlpha);
  col.rgb = mix(pow(col.rgb, vec3(0.41666)) * 1.055 - 0.055, col.rgb * 12.92, step(col.rgb, vec3(0.0031308)));   // linear → sRGB
  gl_FragColor = col;
}`;
/** render a scene in the ink style; returns a data URL (transparent PNG) at w×h, supersampled ×ss */
export function renderInk(scene, camera, w, h, { ss = 2, width = 1.6, style = "ink", inkAlpha = 0.92 } = {}) {
  if (style === "editorial") { width = width * 0.8; inkAlpha = 0.7; }
  const W = w * ss, H = h * ss, r = renderer(W, H);
  r.setClearColor(0x000000, 0);
  const mk = (o = {}) => new THREE.WebGLRenderTarget(W, H, Object.assign({ samples: 4, type: THREE.HalfFloatType }, o));
  const colorT = mk(), normT = new THREE.WebGLRenderTarget(W, H, { depthTexture: new THREE.DepthTexture(W, H), type: THREE.HalfFloatType });
  r.setRenderTarget(colorT); r.clear(); r.render(scene, camera);
  if (style === "real") { r.setRenderTarget(null); r.render(scene, camera); const url = downsample(r.domElement, w, h); colorT.dispose(); normT.dispose(); return url; }
  const ov = new THREE.MeshNormalMaterial(); const prevBg = scene.background; scene.overrideMaterial = ov;
  const hidden = []; scene.traverse((o) => { if (o.userData && o.userData.noOutline && o.visible) { o.visible = false; hidden.push(o); } });
  r.setRenderTarget(normT); r.setClearColor(0x8080ff, 0); r.clear(); r.render(scene, camera);
  hidden.forEach((o) => (o.visible = true)); scene.overrideMaterial = null; scene.background = prevBg;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: INK_FS, transparent: true,
    uniforms: { tColor: { value: colorT.texture }, tNormal: { value: normT.texture }, tDepth: { value: normT.depthTexture }, px: { value: new THREE.Vector2(1 / W, 1 / H) },
      near: { value: camera.near }, far: { value: camera.far }, width: { value: width * ss }, inkAlpha: { value: inkAlpha }, ink: { value: new THREE.Color(INK) } } }));
  const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  r.setRenderTarget(null); r.setClearColor(0x000000, 0); r.clear(); r.render(qs, qc);
  const url = downsample(r.domElement, w, h);
  colorT.dispose(); normT.dispose(); ov.dispose();
  return url;
}
function downsample(src, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, h); return c.toDataURL("image/png");
}
/** a lit scene with a soft contact shadow; returns {scene, camera, ground} */
export function stage({ fov = 26, style = "ink", ground = true, light = [-2.5, 5, 3.5] } = {}) {
  const scene = new THREE.Scene();
  const soft = style === "real" || style === "editorial";
  scene.add(new THREE.HemisphereLight("#fff8ee", "#b9ad98", soft ? 1.5 : 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", soft ? 2.1 : 1.9); sun.position.set(...light); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.1, far: 20 }); sun.shadow.radius = 6; sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  if (ground) { const gm = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: 0x3a2f24, opacity: 0.22 })); gm.rotation.x = -Math.PI / 2; gm.receiveShadow = true; gm.userData.noOutline = true; scene.add(gm); }
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 60);
  return { scene, camera, sun };
}
/** project named 3D points to normalized image coordinates for the callout layer */
export function anchors(camera, pts) {
  const out = {}; for (const [k, p] of Object.entries(pts)) { const v = p.clone().project(camera); out[k] = [+((v.x + 1) / 2).toFixed(4), +((1 - v.y) / 2).toFixed(4)]; } return out;
}
export const helpers = { V, wpos, setWorldRot, rotWorld, log };
export function meta() { return META; }
