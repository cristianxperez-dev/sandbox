/* Call the Game — 3D world (three.js). One coordinate system, in metres:
     x = catcher's right (first-base side), y = up, z = toward the catcher (the pitcher stands at z = −18.44 m).
   The engine's plate coordinates (feet: x right, y toward the pitcher, z up) map as (x, y, z)ft → (x, z, −y)·0.3048 m.
   Players are a MakeHuman (CC0) body skinned to its default rig, animated by CMU motion capture retargeted offline
   (call-the-game/pipeline). Equipment is rigid geometry attached to bones. */
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import * as SkeletonUtils from "./vendor/SkeletonUtils.js";

export const FT = 0.3048;
export const toWorld = (x, y, z) => new THREE.Vector3(x * FT, z * FT, -y * FT);
export const RUBBER_Z = -60.5 * FT, MOUND_H = 10 / 12 * FT;

/* ------------------------------------------------------------------ equipment */
function batGeometry() {
  // 34-inch bat: knob 2.5 in, handle 0.94 in, taper to a 2.61-in barrel, rounded end (lathe profile, inches)
  const prof = [[0, 0], [1.25, 0.05], [1.25, 0.35], [0.62, 0.7], [0.48, 1.2], [0.47, 8], [0.5, 13], [0.62, 17], [0.9, 21], [1.18, 24.5], [1.3, 27], [1.3, 33.2], [1.18, 33.75], [0.8, 34], [0, 34.05]];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r * 0.0254, y * 0.0254));
  const g = new THREE.LatheGeometry(pts, 20);
  g.computeVertexNormals();
  return g;
}
function helmetGeometry(side) {
  // batting helmet shell with an ear flap on the side that faces the pitcher, plus a short brim (metres, head-local)
  const grp = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.128, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.58));
  shell.scale.set(1, 0.98, 1.12);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.115, 0.012, 24, 1, false, -Math.PI * 0.3, Math.PI * 0.6));
  brim.position.set(0, -0.005, 0.07); brim.scale.set(1.1, 1, 1.25);
  const flap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12, 0, Math.PI * 0.62, Math.PI * 0.38, Math.PI * 0.42));
  flap.rotation.y = side === "L" ? Math.PI * 0.08 : Math.PI * 1.3; flap.scale.set(1.25, 1.1, 1.2);
  grp.add(shell, brim, flap);
  return grp;
}
function capGeometry() {
  // fitted cap: six-panel crown hugging the skull, a curved bill
  const grp = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.112, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56)); crown.scale.set(0.98, 0.92, 1.1);
  const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 24, 1, false, -Math.PI / 2, Math.PI));
  bill.position.set(0, 0.008, 0.055); bill.scale.set(0.92, 1, 1.05); bill.rotation.x = 0.16;
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6)); button.position.set(0, 0.104, 0);
  grp.add(crown, bill, button); return grp;
}
function gloveGeometry() {
  const grp = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14)); shell.scale.set(0.62, 1.25, 1.05);
  const web = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10)); web.position.set(0, 0.08, 0.05); web.scale.set(0.5, 1, 1);
  grp.add(shell, web); return grp;
}
export function ballMesh() {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = "#f4f1e8"; g.fillRect(0, 0, 128, 64); g.strokeStyle = "#c0392b"; g.lineWidth = 2;
  g.beginPath(); for (let x = 0; x <= 128; x += 2) { const y = 32 + Math.sin((x / 128) * Math.PI * 4) * 18; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.0366, 20, 14), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  m.castShadow = true; return m;
}

/* ------------------------------------------------------------------ player */
const _q1 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _up = new THREE.Vector3(0, 1, 0);
function setWorldRot(bone, q) {
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q));
}
let template = null, meta = null, maskTex = null;
export async function loadPlayerAssets(base = "assets/") {
  if (template) return { template, meta };
  const [gltf, m, tex] = await Promise.all([new GLTFLoader().loadAsync(base + "player.glb"), fetch(base + "player.json").then((r) => r.json()),
    new THREE.TextureLoader().loadAsync(base + "uniform-mask.png")]);
  tex.flipY = false; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace;
  template = gltf; meta = m; maskTex = tex; return { template, meta };
}
/** body material: the uniform mask (region ids) coloured from a per-player palette; roughness per fabric */
const REGIONS = ["skin", "jersey", "pants", "belt", "undershirt", "socks", "shoes", "hands", "trim", "hair"];
const ROUGH = { hair: 0.9, skin: 0.55, jersey: 0.88, pants: 0.86, belt: 0.45, undershirt: 0.7, socks: 0.85, shoes: 0.35, hands: 0.6, trim: 0.7 };
function uniformMaterial(colors) {
  const m = new THREE.MeshStandardMaterial({ map: maskTex, roughness: 0.8, metalness: 0 });
  const pal = REGIONS.map((r) => new THREE.Color(colors[r] || "#888")), rough = REGIONS.map((r) => ROUGH[r]);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPal = { value: pal }; sh.uniforms.uRough = { value: rough };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uPal[10];\nuniform float uRough[10];")
      .replace("#include <map_fragment>", `float rid = floor(texture2D(map, vMapUv).r * 255.0 + 0.5);
        vec3 pc = uPal[0]; float pr = uRough[0];
        for (int i = 1; i < 10; i++) { if (abs(rid - float(i)) < 0.5) { pc = uPal[i]; pr = uRough[i]; } }
        diffuseColor.rgb *= pc;`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = pr;");
  };
  m.customProgramCacheKey = () => "ctg-uniform";
  m.userData.pal = pal;
  return m;
}
export const UNIFORMS = {
  road: { jersey: "#9ba1a9", pants: "#9ba1a9", undershirt: "#1f2a44", socks: "#1f2a44", belt: "#1a1d24", helmet: "#1f2a44", hands: "#e8e4dc", shoes: "#141519", trim: "#1f2a44" },
  home: { jersey: "#f1ede4", pants: "#f1ede4", undershirt: "#7a1f27", socks: "#7a1f27", belt: "#181818", helmet: "#7a1f27", hands: "#2a1a14", shoes: "#141414", cap: "#7a1f27" },
};
const SKIN = ["#8d5a3b", "#c58a5f", "#e0ac7e", "#6b4128", "#b07650", "#f0c49c"];

export class Player {
  constructor(scene, { role, hand, kit, skin, scale = 1 }) {
    this.role = role; this.hand = hand; this.meta = meta; this.tilt = 0; this.tiltW = 0;
    this.root = SkeletonUtils.clone(template.scene);
    this.root.scale.setScalar(scale);
    this.bones = {};
    this.root.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const cl = mats.map((m) => {
          if (m.name === "eyes") return m.clone();
          return uniformMaterial(Object.assign({ skin, hair: "#1b1512", trim: kit.trim || kit.undershirt }, kit, role === "pitcher" ? { hands: skin } : {}, kit.bareArms ? { undershirt: skin } : {}));
        });
        o.material = Array.isArray(o.material) ? cl : cl[0];
      }
    });
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = {};
    for (const c of template.animations) this.clips[c.name] = c;
    this.kit = kit;
    this.equip(kit, skin);
  }
  equip(kit, skin) {
    const head = this.bones.head;
    const std = (col, r = 0.5, m = 0) => new THREE.MeshStandardMaterial({ color: col, roughness: r, metalness: m });
    // the head bone's origin sits at the base of the skull; the cranium centre is ~11 cm above and slightly forward
    if (this.role === "batter") {
      const h = helmetGeometry(this.hand === "R" ? "L" : "R"); h.traverse((o) => { if (o.isMesh) { o.material = std(kit.helmet, 0.25, 0.1); o.castShadow = true; } });
      h.position.set(0, 0.105, 0.012); head.add(h); this.helmet = h;
      const clipName = this.hand === "R" ? "batR" : "batL", info = meta.clips[clipName].bat;
      const bat = new THREE.Mesh(batGeometry(), std("#c9a06a", 0.45)); bat.castShadow = true;
      const hb = this.bones[info.bone], H = meta.hands[info.bone];
      const palm = new THREE.Vector3(...H.palm), dir = new THREE.Vector3(...info.dir).normalize();
      dir.addScaledVector(palm, -0.85 * dir.dot(palm)).normalize();             // the handle lies across the palm
      bat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // the handle passes through the centre of the closed bottom hand; the knob sits just below the little finger
      this.gripB = new THREE.Vector3(...H.center);
      bat.position.copy(this.gripB).addScaledVector(dir, -0.065);
      hb.add(bat); this.bat = bat; this.batDir = dir;
      // top hand: its own capture-derived handle axis, corrected onto the real bat by IK each frame
      const T = meta.hands[info.topBone];
      this.grip = { top: info.topBone, side: info.topBone.slice(-1), topCenter: new THREE.Vector3(...T.center),
        topAxis: new THREE.Vector3(...info.topDir).addScaledVector(new THREE.Vector3(...T.palm), -0.85 * new THREE.Vector3(...info.topDir).dot(new THREE.Vector3(...T.palm))).normalize() };
    } else {
      const c = capGeometry(); c.traverse((o) => { if (o.isMesh) { o.material = std(kit.cap || kit.helmet, 0.8); o.castShadow = true; } });
      c.position.set(0, 0.098, 0.008); head.add(c);
      const gl = gloveGeometry(); gl.traverse((o) => { if (o.isMesh) { o.material = std("#5b3420", 0.7); o.castShadow = true; } });
      const gh = this.hand === "R" ? this.bones.wrist_L : this.bones.wrist_R;
      gl.position.set(0, -0.09, 0.02); gh.add(gl);
      this.ballHand = this.hand === "R" ? this.bones.wrist_R : this.bones.wrist_L;
      this.ballLocal = new THREE.Vector3(...meta.hands[this.ballHand.name].center);
    }
  }
  play(name, { time = 0, timeScale = 1 } = {}) {
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(this.clips[name]); a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.timeScale = timeScale; a.play();
    this.action = a; this.mixer.setTime(time); return a;
  }
  pose(name, t) { if (!this.action || this.action.getClip().name !== name) this.play(name); this.action.time = t; this.mixer.update(0); this.root.updateMatrixWorld(true); this.post(); }
  /** runtime corrections after the clip is sampled: the top hand closes on the bat handle (two-bone IK) */
  post() {
    if (this.tilt && this.tiltW) {
      // pitch height: a little forward trunk flexion (about the chest's own lateral axis) plus barrel tilt at the bottom
      // hand — hitters reach low pitches mostly by dropping the barrel, a little with the trunk. tilt ∈ [-1, 1].
      const k = this.tilt * this.tiltW, sp = this.bones.spine03, wq = sp.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(wq), lat = new THREE.Vector3().crossVectors(_up, fwd).normalize();
      setWorldRot(sp, new THREE.Quaternion().setFromAxisAngle(lat, 0.16 * k).multiply(wq)); sp.updateMatrixWorld(true);
      if (this.bat) {
        const hb = this.bat.parent, bq = hb.getWorldQuaternion(new THREE.Quaternion());
        const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(this.bat.getWorldQuaternion(new THREE.Quaternion()));
        const tiltAxis = new THREE.Vector3().crossVectors(ax, _up); if (tiltAxis.lengthSq() > 1e-6) {
          tiltAxis.normalize(); setWorldRot(hb, new THREE.Quaternion().setFromAxisAngle(tiltAxis, 0.42 * k).multiply(bq)); hb.updateMatrixWorld(true);
        }
      }
    }
    if (!this.grip || this.gripOff) return;
    const g = this.grip, s = g.side, b = this.bones;
    const up = b["upperarm01_" + s], lo = b["lowerarm01_" + s], wr = b[g.top];
    const batQ = this.bat.getWorldQuaternion(_q1), axis = _v1.set(0, 1, 0).applyQuaternion(batQ);
    const bottomCenter = this.gripB.clone().applyMatrix4(this.bat.parent.matrixWorld);
    const target = bottomCenter.addScaledVector(axis, 0.098);                     // fists touch, top hand toward the barrel
    // desired top-hand orientation: rotate its own handle axis onto the bat's
    const wq = wr.getWorldQuaternion(new THREE.Quaternion());
    const cur = g.topAxis.clone().applyQuaternion(wq);
    const wqT = new THREE.Quaternion().setFromUnitVectors(cur, axis).multiply(wq);
    const wristT = target.sub(g.topCenter.clone().applyQuaternion(wqT));
    const S = up.getWorldPosition(new THREE.Vector3()), E = lo.getWorldPosition(new THREE.Vector3()), W = wr.getWorldPosition(new THREE.Vector3());
    const l1 = E.distanceTo(S), l2 = W.distanceTo(E);
    const toT = wristT.clone().sub(S); let d = toT.length(); d = Math.min(d, (l1 + l2) * 0.999); const u = toT.normalize();
    const bend = E.clone().sub(S); bend.addScaledVector(u, -bend.dot(u)); if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0); bend.normalize();
    const a1 = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
    const E2 = S.clone().addScaledVector(u, a1).addScaledVector(bend, h);
    setWorldRot(up, new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize()).multiply(up.getWorldQuaternion(new THREE.Quaternion())));
    up.updateMatrixWorld(true);
    const W2 = wr.getWorldPosition(new THREE.Vector3()), E3 = lo.getWorldPosition(new THREE.Vector3());
    setWorldRot(lo, new THREE.Quaternion().setFromUnitVectors(W2.sub(E3).normalize(), wristT.clone().sub(E3).normalize()).multiply(lo.getWorldQuaternion(new THREE.Quaternion())));
    lo.updateMatrixWorld(true);
    setWorldRot(wr, wqT); wr.updateMatrixWorld(true);
  }
  /** cross-fade between two moments of a clip (take → re-set, follow-through → stance) */
  blendTo(name, tA, tB, w) {
    this.pose(name, tA);
    const A = {}; for (const k in this.bones) A[k] = this.bones[k].quaternion.clone();
    const rA = this.bones.root.position.clone();
    this.pose(name, tB);
    for (const k in this.bones) this.bones[k].quaternion.slerpQuaternions(A[k], this.bones[k].quaternion.clone(), w);
    this.bones.root.position.lerpVectors(rA, this.bones.root.position.clone(), w);
    this.root.updateMatrixWorld(true); this.post();
  }
  setSkin(col) { this.root.traverse((o) => { if (o.isMesh && o.material && o.material.userData.pal) { o.material.userData.pal[0].set(col); if (this.role === "pitcher") o.material.userData.pal[7].set(col); } }); }
  bonePos(n, v = new THREE.Vector3()) { return this.bones[n].getWorldPosition(v); }
  /** the ball held in the throwing hand (centre of the curled fingers) */
  ballInHand(v = new THREE.Vector3()) { return v.copy(this.ballLocal).applyMatrix4(this.ballHand.matrixWorld); }
}

/* ------------------------------------------------------------------ field */
export function buildField(scene, quality = "high") {
  const g = new THREE.Group();
  const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const grass = new THREE.Mesh(new THREE.CircleGeometry(140, 64), mat("#3f7a34")); grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; g.add(grass);
  const dirtHome = new THREE.Mesh(new THREE.CircleGeometry(13 * FT, 64), mat("#a9774f")); dirtHome.rotation.x = -Math.PI / 2; dirtHome.position.set(0, 0.002, 0.7 * FT); dirtHome.receiveShadow = true; g.add(dirtHome);
  // home plate (17 in wide) — front edge at z = 0, point toward the catcher
  const s = new THREE.Shape(); const w = 8.5 / 12 * FT; s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, w); s.lineTo(0, 2 * w); s.lineTo(-w, w); s.closePath();
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(s), mat("#f5f3ec", 0.6)); plate.rotation.x = -Math.PI / 2; plate.position.y = 0.006; plate.scale.set(1, -1, 1); plate.receiveShadow = true; g.add(plate);
  // batter's boxes: 4 ft × 6 ft, 6 in from the plate
  const line = mat("#efeae0", 0.8);
  for (const sg of [-1, 1]) {
    const box = new THREE.Group();
    const add = (x, z, wd, dp) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, dp), line); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.005, z); m.receiveShadow = true; box.add(m); };
    const x0 = sg * (w + 6 / 12 * FT), x1 = sg * (w + 6 / 12 * FT + 4 * FT), zf = -(3 * FT) + w, zb = 3 * FT + w, t = 0.05;
    add((x0 + x1) / 2, zf, Math.abs(x1 - x0) + t, t); add((x0 + x1) / 2, zb, Math.abs(x1 - x0) + t, t); add(x0, (zf + zb) / 2, t, zb - zf); add(x1, (zf + zb) / 2, t, zb - zf);
    g.add(box);
  }
  // pitcher's mound: 18-ft circle, 10 in high, flat 5 ft × 34 in table, 1 in/ft slope toward home
  const prof = []; const R = 9 * FT;
  for (let i = 0; i <= 24; i++) { const r = (i / 24) * R; const hgt = r < 0.5 ? MOUND_H : Math.max(0, MOUND_H - (r - 0.5) * (1 / 12)); prof.push(new THREE.Vector2(r, hgt)); }
  prof.push(new THREE.Vector2(R, 0));
  const mound = new THREE.Mesh(new THREE.LatheGeometry(prof.reverse(), 48), mat("#b07e55")); mound.position.set(0, 0, RUBBER_Z + 1.5 * FT); mound.receiveShadow = true; g.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(24 / 12 * FT, 0.03, 6 / 12 * FT), mat("#f6f3ec", 0.6)); rubber.position.set(0, MOUND_H + 0.01, RUBBER_Z); g.add(rubber);
  scene.add(g); return g;
}

/* ------------------------------------------------------------------ renderer + camera */
export function createRenderer(canvas, { quality = "high" } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== "low", powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality !== "low"; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#7ea7d8"); scene.fog = new THREE.Fog("#9db8d6", 60, 260);
  const hemi = new THREE.HemisphereLight("#dfe9ff", "#4d5a32", 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff4e0", 2.6); sun.position.set(-8, 14, 6); sun.castShadow = quality !== "low";
  sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 40 }); sun.shadow.bias = -0.0004; sun.target.position.set(0, 0, -1);
  scene.add(sun, sun.target);
  // a second, unshadowed fill on the pitcher's area
  const fill = new THREE.DirectionalLight("#fff", 0.6); fill.position.set(6, 10, -10); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600);
  return { renderer, scene, camera, sun };
}
/** catcher's-view camera: just behind and above the crouched catcher (umpire's eye line), looking out at the pitcher */
export function catcherCamera(camera, aspect) {
  camera.aspect = aspect;
  // ~6.4 m behind the front of the plate (just behind the plate umpire), eye 1.6 m: the hitter is large in the foreground,
  // the pitcher small at 60.5 ft — both purely from distance. A narrower lens keeps proportions natural.
  const vfov = aspect < 0.8 ? 40 : aspect < 1.2 ? 33 : 27;
  camera.fov = vfov;
  camera.position.set(0, 1.6, 6.4);
  camera.lookAt(0, 0.95, -18);
  camera.updateProjectionMatrix();
}
export { THREE };
