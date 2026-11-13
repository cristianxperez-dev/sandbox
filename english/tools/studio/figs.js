/* Figure specifications. Each returns { scene, camera, w, h, anchors: {name: Vector3} } for the studio renderer.
   Character space: the athlete faces +Z, +X is his LEFT, +Y up, metres, origin on the ground under the pelvis. */
import { THREE, load, Athlete, KITS, SKIN, gloveMesh, ballMesh, capMesh, cleatMesh, stage, helpers, meta } from "./studio.js";
const { V } = helpers;

function cam(camera, pos, look, fov, w, h) { camera.fov = fov; camera.aspect = w / h; camera.position.set(...pos); camera.lookAt(...look); camera.updateProjectionMatrix(); }
function wearGlove(a, side, scene, o = {}) {
  const gl = gloveMesh(a.style, o), f = a.handFrame(side);
  gl.quaternion.copy(f.quat); gl.scale.x = f.mirror; gl.position.copy(f.origin).addScaledVector(f.z, -0.01);
  scene.add(gl); return { glove: gl, frame: f };
}
function wearCleats(a, style) { for (const s of ["L", "R"]) a.bones["foot_" + s].add(cleatMesh(style)); }
function dress(a, scene) { wearCap(a, scene); wearCleats(a, a.style); }
function wearCap(a, scene, color) {
  const c = capMesh(a.style, color), h = a.bones.head; h.updateMatrixWorld(true);
  c.position.set(0, 0.078, 0.012); h.add(c); return c;
}

/* ---- poses (character space) — authored from reference photographs; see english/research/visual-reference.md */
export const POSES = {
  // infield pre-pitch: athletic base wider than the shoulders, hips back, knees flexed, chest over the knees, hands out front
  ready: {
    root: { drop: 0.3, pitch: 0.42 }, spine: { flex: 0.32 }, head: { pitch: -0.62 },
    legs: { L: { ankle: [0.34, 0.08, 0.02], knee: [0.5, 0, 1], yaw: -0.28 }, R: { ankle: [-0.34, 0.08, 0.02], knee: [-0.5, 0, 1], yaw: 0.28 } },
    arms: { L: { hand: [0.16, 0.66, 0.5], fingers: [0.05, -0.55, 0.83], palm: [0, 0.83, 0.55], elbow: [1, -0.2, -0.3] },
            R: { hand: [-0.12, 0.66, 0.48], fingers: [-0.05, -0.55, 0.83], palm: [0.4, 0.5, 0.75], elbow: [-1, -0.2, -0.3] } },
    fingers: { L: { curl: 0.15, thumb: [0.2, 0] }, R: { curl: 0.45, thumb: [0.35, 0.2] } },
  },
};

POSES.fieldLow = {
  // fielding a ground ball: wide base, glove-side foot slightly ahead, hips down and back, back flat, glove out in front of
  // the eyes on the ground with the fingers pointing down, throwing hand above it; eyes on the ball
  root: { drop: 0.47, pitch: 0.62, shift: [0.02, 0, -0.06] }, spine: { flex: 0.38 }, head: { pitch: -0.25 },
  legs: { L: { ankle: [0.38, 0.08, 0.16], knee: [0.55, 0, 1], yaw: -0.35 }, R: { ankle: [-0.4, 0.08, -0.08], knee: [-0.6, 0, 1], yaw: 0.45 } },
  arms: { L: { hand: [0.06, 0.18, 0.66], fingers: [0.0, -0.85, 0.52], palm: [0.0, 0.52, 0.85], elbow: [1, 0.2, -0.2] },
          R: { hand: [-0.04, 0.37, 0.6], fingers: [0.15, -0.55, 0.82], palm: [0.25, -0.7, 0.6], elbow: [-1, 0.3, -0.2] } },
  fingers: { L: { curl: 0.1, thumb: [0.2, 0] }, R: { curl: 0.35, thumb: [0.3, 0.2] } },
};
POSES.catchHigh = {
  // a ball at the chest: athletic but taller, glove up in front of the chest with the fingers up, pocket to the ball,
  // throwing hand next to the glove ready to cover and transfer
  root: { drop: 0.2, pitch: 0.2 }, spine: { flex: 0.1 }, head: { pitch: -0.12, yaw: -0.08 },
  legs: { L: { ankle: [0.3, 0.08, 0.12], knee: [0.4, 0, 1], yaw: -0.2 }, R: { ankle: [-0.3, 0.08, -0.06], knee: [-0.4, 0, 1], yaw: 0.25 } },
  arms: { L: { hand: [0.3, 1.14, 0.6], fingers: [0.12, 0.96, 0.22], palm: [-0.15, -0.2, 0.97], elbow: [0.9, -0.6, -0.2] },
          R: { hand: [0.1, 1.08, 0.58], fingers: [0.1, 0.95, 0.25], palm: [0.6, -0.1, 0.8], elbow: [-0.9, -0.6, -0.2] } },
  fingers: { L: { curl: 0.1, thumb: [0.2, 0] }, R: { curl: 0.3, thumb: [0.3, 0.2] } },
};
POSES.throwSet = {
  // right-handed infielder after the shuffle, feet set to the target (+X): back (right) foot square to the throwing line,
  // front (left) foot striding on the line, weight still on the back leg; hands separated — glove arm leading at the
  // target, throwing arm back with the ball facing away; glove shoulder and eyes on the target
  root: { drop: 0.2, yaw: 0.0, roll: -0.08, shift: [-0.12, 0, 0] }, spine: { flex: 0.1, side: -0.12, twist: -0.18 }, head: { yaw: 1.3, pitch: 0.04 },
  legs: { L: { ankle: [0.52, 0.08, 0.04], knee: [0.6, 0, 0.6], yaw: 1.05 }, R: { ankle: [-0.3, 0.08, 0.0], knee: [-0.2, 0, 1], yaw: 0.2 } },
  arms: { L: { hand: [0.5, 1.3, 0.26], fingers: [0.35, 0.8, 0.45], palm: [-0.2, -0.5, 0.84], elbow: [0.3, -1, -0.1] },
          R: { hand: [-0.6, 1.5, -0.28], fingers: [-0.25, 0.85, -0.45], palm: [-0.85, -0.1, 0.5], elbow: [0.1, -1, -0.4] } },
  fingers: { L: { curl: 0.1, thumb: [0.2, 0] }, R: { curl: 0.85, per: { ring: 1.3, pinky: 1.4 }, thumb: [0.6, 0.6] } },
};

function ballAt(scene, p, style) { const b = ballMesh(style); b.position.copy(p); scene.add(b); return b; }

/* ---- grips: the ball is oriented from seam landmarks (see studio.js seamPoint: horseshoe tips meet near the +z pole) */
const S2 = Math.SQRT1_2;
const GRIPS = {
  // fingertips across the seam at the tip of the horseshoe; ring finger and pinky curled along the side; thumb underneath
  "four-seam": { top: [0, 0, 1], along: [S2, S2, 0], out: 0.046, depth: 0.016, spread: 0.07, fixed: { ring: 1.55, pinky: 1.75 } },
  // index and middle fingers each along one of the narrow seams
  "two-seam": { top: [0.28, 0.28, 0.92], along: [0, 1, 0], out: 0.044, depth: 0.016, spread: 0.09, fixed: { ring: 1.55, pinky: 1.75 } },
  // circle change: ball deeper in the hand; middle and ring fingers on top, index and thumb forming the circle on the side
  "changeup": { top: [0, 0, 1], along: [S2, -S2, 0], out: 0.0, depth: 0.004, spread: 0.06, fingers: ["middle", "ring"], fixed: { index: 1.9, pinky: 1.6 }, thumb: [0.9, 1.1], circle: true },
};
async function gripScene(variant, style, { view = "front", thumbVariant = null, spreadMul = 1, oppose = null, phi = null } = {}) {
  await load();
  const G0 = GRIPS[variant], G = phi == null ? G0 : Object.assign({}, G0, { along: [Math.cos(phi), Math.sin(phi), 0] }), { scene, camera } = stage({ style, ground: false, light: [-1.5, 3, 3] });
  const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.light, style }).pose({
    arms: { R: { hand: [-0.7, 1.3, 0.52], fingers: [-0.25, 0.25, 0.93], palm: [0.0, -0.96, 0.26], elbow: [-0.6, -0.7, -0.4] } },
    fingers: { R: { curl: 0.3, thumb: [0.3, 0.6] } },
  });
  const hf = a.handFrame("R"), r = 0.0368;
  // anchor the ball to the base knuckles (not the palm centre): one finger-pad in front of them, out toward the tips
  const knuckles = a.bones["finger2-1_R"].getWorldPosition(new THREE.Vector3()).add(a.bones["finger3-1_R"].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const center = knuckles.addScaledVector(hf.z, r + G.depth).addScaledVector(hf.y, G.out);
  const ball = ballMesh(style); ball.position.copy(center);
  // orient: ball-local `top` → toward the finger pads (−palm normal), `along` → finger direction
  const T = V(G.top).normalize(), F = V(G.along).normalize().addScaledVector(T, -V(G.along).dot(T)).normalize();
  const Tw = hf.z.clone().negate(), Fw = hf.y.clone().addScaledVector(Tw, -hf.y.dot(Tw)).normalize();
  const mL = new THREE.Matrix4().makeBasis(F, T, F.clone().cross(T)), mW = new THREE.Matrix4().makeBasis(Fw, Tw, Fw.clone().cross(Tw));
  ball.quaternion.setFromRotationMatrix(mW.multiply(mL.transpose()));
  scene.add(ball);
  // thumb target: under the ball, opposite the two fingers (changeup: on the side, closing the circle with the index finger)
  const under = G.circle ? center.clone().addScaledVector(hf.x, r + 0.006).addScaledVector(Tw, -0.004)
    : center.clone().addScaledVector(Tw, -(r + 0.008)).addScaledVector(hf.y, -0.004);
  if (thumbVariant === "side") under.copy(center).addScaledVector(hf.x, r + 0.008).addScaledVector(Tw, -0.01);
  const grip = a.gripBall("R", center, r, { fingers: G.fingers || ["index", "middle"], fixed: G.fixed, spread: G.spread * spreadMul, thumbTarget: under });
  const tip = (k) => { const b = a.bones[`finger${k}-3_R`]; return b.getWorldPosition(new THREE.Vector3()); };
  const w = 900, h = 700;
  // grip-photo views: "top" looks down over the fingertips at the seams under them; "side" is from the thumb side, level
  const eye = view === "under" ? center.clone().addScaledVector(hf.x, 0.3).addScaledVector(Tw, -0.3).addScaledVector(hf.y, 0.12) : view === "side" ? center.clone().addScaledVector(hf.x, 0.42).addScaledVector(Tw, -0.04).addScaledVector(hf.y, 0.06)
    : view === "catcher" ? center.clone().addScaledVector(hf.y, 0.3).addScaledVector(Tw, 0.34).addScaledVector(hf.x, 0.05)
    : center.clone().addScaledVector(hf.x, 0.3).addScaledVector(Tw, 0.3).addScaledVector(hf.y, 0.1);
  cam(camera, eye.toArray(), center.clone().addScaledVector(hf.y, -0.02).addScaledVector(Tw, 0.012).toArray(), view === "catcher" ? 18 : 19, w, h);
  return { scene, camera, w, h, a, ball, center, anchors: { index: tip(2), middle: tip(3), ring: tip(4), thumb: tip(1), ball: center, seam: center.clone().addScaledVector(Tw, r) } };
}

async function pitcherAt(style, t, { open = 0, cam: cv = "side", w = 1000, h = 760 } = {}) {
  await load();
  const { scene, camera } = stage({ style, light: [-2, 5, 3] });
  const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.medium, style });
  a.clipPose("pitchR", t);
  // "front side opens early": the same instant with the trunk already rotated toward the plate (+Z in the capture)
  if (open) { const sp = a.bones.spine04; sp.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), open)); a.root.updateMatrixWorld(true); }
  dress(a, scene); const { frame } = wearGlove(a, "L", scene, { open: 0.3 });
  const hand = a.handFrame("R"), ball = ballMesh(style); ball.position.copy(hand.origin).addScaledVector(hand.z, 0.04).addScaledVector(hand.y, 0.03); scene.add(ball);
  const mid = a.joint("root"); mid.y = 0.95;
  if (cv === "side") cam(camera, [mid.x - 4.6, 1.05, mid.z + 0.3], [mid.x, 0.95, mid.z + 0.3], 30, w, h);     // third-base side: chest, front side, hips
  else cam(camera, [mid.x + 0.2, 1.3, mid.z + 6.5], [mid.x, 1.05, mid.z], 19, w, h);                  // from home plate
  return { scene, camera, w, h, anchors: { hips: a.joint("root"), shoulder: a.joint("upperarm01_L"), glove: frame.origin.clone(), frontFoot: a.joint("foot_L"), backFoot: a.joint("foot_R"), head: a.joint("head"), ball: ball.position.clone() } };
}

export const FIGS = {
  async "delivery-side"(style = "editorial") { return pitcherAt(style, meta().clips.pitchR.events.footStrike); },
  async "delivery-a"(style = "editorial") { return pitcherAt(style, meta().clips.pitchR.events.footStrike, { open: 0.75, cam: "front", w: 800, h: 760 }); },
  async "delivery-b"(style = "editorial") { return pitcherAt(style, meta().clips.pitchR.events.footStrike, { open: 0, cam: "front", w: 800, h: 760 }); },
  async "ready-position"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.deep, style }).pose(POSES.ready);
    dress(a, scene); const { frame } = wearGlove(a, "L", scene, { open: 0.35 });
    const w = 1000, h = 800; cam(camera, [3.4, 1.0, 2.6], [0.0, 0.6, 0.12], 24, w, h);
    return { scene, camera, w, h, anchors: { feet: a.joint("foot_L"), knees: a.joint("lowerleg01_L"), hips: a.joint("root"), glove: frame.origin.clone(), head: a.joint("head") } };
  },
  async "ground-ball"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.deep, style }).pose(POSES.fieldLow);
    dress(a, scene); const { frame } = wearGlove(a, "L", scene, { open: 0.3 });
    const ball = ballAt(scene, new THREE.Vector3(0.08, 0.037, 0.98), style);
    const w = 1000, h = 760; cam(camera, [3.7, 0.75, 1.0], [0.05, 0.45, 0.35], 25, w, h);
    return { scene, camera, w, h, anchors: { glove: frame.origin.clone(), ball: ball.position.clone(), back: a.joint("spine03"), eyes: a.joint("head"), hips: a.joint("root") } };
  },
  async "footwork-angle"(style = "editorial") {
    // overhead: ready stance, first step (right foot, open), then the route — real cleats placed on the ground
    await load();
    const { scene } = stage({ style, light: [0.3, 6, 0.5] });
    const put = (x, z, yaw, ghost) => { const c = cleatMesh(style); c.position.set(x, 0.08, z); c.rotation.y = yaw; if (ghost) c.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; } }); scene.add(c); return c; };
    put(0.34, 0, -0.28, true); put(-0.34, 0, 0.28, true);            // ready
    put(-0.62, -0.22, 1.25, false);                                  // first step: right foot opens toward the ball
    put(-0.05, -0.62, 1.05, false);                                  // crossover
    const w = 1000, h = 620, oc = new THREE.OrthographicCamera(-1.45, 1.45, 0.9, -0.9, 0.1, 20);
    oc.position.set(-0.75, 8, -0.55); oc.up.set(0, 0, -1); oc.lookAt(-0.75, 0, -0.55); oc.updateProjectionMatrix();
    return { scene, camera: oc, w, h, anchors: { ready: new THREE.Vector3(0, 0, 0.05), step1: new THREE.Vector3(-0.62, 0, -0.22), step2: new THREE.Vector3(0.05, 0, -0.75), ball: new THREE.Vector3(-2.05, 0, -1.25), routeEnd: new THREE.Vector3(-1.8, 0, -1.1), step2: new THREE.Vector3(-0.05, 0, -0.62) } };
  },
  async "sweep"(style = "editorial", opts = {}) { return gripScene(opts.v, style, { view: "catcher", phi: opts.phi }); },
  async "thumb-test"(style = "editorial", opts = {}) { const f = await gripScene("four-seam", style, { view: "under", oppose: opts.o }); return f; },
  async "grip-4s"(style = "editorial") { return gripScene("four-seam", style, { view: "catcher" }); },
  async "grip-2s"(style = "editorial") { return gripScene("two-seam", style, { view: "catcher" }); },
  async "grip-change"(style = "editorial") { return gripScene("changeup", style, { view: "under" }); },
  async "grip-change-side"(style = "editorial") { return gripScene("changeup", style, { view: "side" }); },
  async "grip-change-catcher"(style = "editorial") { return gripScene("changeup", style, { view: "catcher" }); },
  async "grip-spread-after"(style = "editorial") { return gripScene("four-seam", style, { view: "catcher", spreadMul: 2.6 }); },
  async "grip-4s-side"(style = "editorial") { return gripScene("four-seam", style, { view: "side" }); },
  async "grip-thumb-before"(style = "editorial") { return gripScene("four-seam", style, { view: "under", thumbVariant: "side" }); },
  async "grip-thumb-after"(style = "editorial") { return gripScene("four-seam", style, { view: "under" }); },
  async "grip-spread-before"(style = "editorial") { return gripScene("four-seam", style, { view: "catcher", spreadMul: -0.8 }); },
  async "ball-seams"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, ground: false, light: [-1, 3, 4] });
    const b = ballMesh(style); b.scale.setScalar(3); b.lookAt(new THREE.Vector3(0, 1, 0)); b.rotateZ(0.5); scene.add(b);
    const w = 800, h = 640; cam(camera, [0, 0.12, 1.0], [0, 0, 0], 17, w, h);
    // anchors: one horseshoe tip and a stitch, in world space
    const tipL = new THREE.Vector3(0.33, 0.33, 0.89).normalize().multiplyScalar(0.0368 * 3).applyQuaternion(b.quaternion);
    const st = new THREE.Vector3(0.95, 0.1, 0.3).normalize().multiplyScalar(0.0368 * 3).applyQuaternion(b.quaternion);
    return { scene, camera, w, h, anchors: { horseshoe: tipL, stitches: st } };
  },
  async "hand-fingers"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, ground: false, light: [-1, 3, 4] });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.light, style }).pose({
      arms: { R: { hand: [-0.42, 1.38, 0.45], fingers: [0.0, 0.98, 0.15], palm: [0, -0.15, 0.98], elbow: [-1, -1, 0] } },
      fingers: { R: { curl: 0.05, spread: 0.1, thumb: [0.05, -0.3] } },
    });
    const hf = a.handFrame("R"), tip = (k) => a.bones[`finger${k}-3_R`].getWorldPosition(new THREE.Vector3());
    const w = 760, h = 760; cam(camera, hf.origin.clone().addScaledVector(hf.z, 0.75).add(new THREE.Vector3(0, 0.03, 0)).toArray(), hf.origin.clone().addScaledVector(hf.y, 0.05).toArray(), 20, w, h);
    return { scene, camera, w, h, anchors: { thumb: tip(1), index: tip(2), middle: tip(3), ring: tip(4), pinky: tip(5), palm: hf.origin.clone(), wrist: a.joint("wrist_R") } };
  },
  async "ball-study"(style = "editorial", opts = {}) {
    await load();
    const { scene, camera } = stage({ style, ground: false, light: [-1, 3, 4] });
    const dirs = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, -1], [-1, 0, 0], [0, -1, 0]];
    dirs.forEach((d, i) => { const b = ballMesh(style); b.position.set((i % 3) * 0.1 - 0.1, i < 3 ? 0.05 : -0.05, 0); b.lookAt(b.position.clone().add(new THREE.Vector3(...d))); scene.add(b); });
    const w = 900, h = 600; cam(camera, [0, 0, 1.0], [0, 0, 0], 20, w, h);
    return { scene, camera, w, h };
  },
  async "glove-low"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, light: [-2.5, 5, 4] });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.medium, style }).pose(POSES.fieldLow);
    dress(a, scene); const { glove, frame } = wearGlove(a, "L", scene, { open: 0.3 });
    const ball = ballAt(scene, new THREE.Vector3(0.08, 0.037, 0.98), style);
    const w = 900, h = 760;
    cam(camera, [1.9, 0.95, 3.4], [0.08, 0.42, 0.45], 25, w, h);
    const tip = frame.origin.clone().addScaledVector(frame.y, 0.2);
    return { scene, camera, w, h, anchors: { fingers: tip, pocket: frame.origin.clone().addScaledVector(frame.z, 0.05), ball: ball.position.clone(), belt: a.joint("root").add(new THREE.Vector3(0, 0.1, 0.15)) } };
  },
  async "glove-high"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, light: [-2.5, 5, 4] });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.medium, style }).pose(POSES.catchHigh);
    dress(a, scene); const { glove, frame } = wearGlove(a, "L", scene, { open: 0.3 });
    const ball = ballAt(scene, new THREE.Vector3(0.3, 1.16, 1.25), style);
    const w = 900, h = 760;
    cam(camera, [-1.35, 1.15, 3.9], [0.1, 0.82, 0.4], 26, w, h);
    const tip = frame.origin.clone().addScaledVector(frame.y, 0.2);
    return { scene, camera, w, h, anchors: { fingers: tip, pocket: frame.origin.clone().addScaledVector(frame.z, 0.05), ball: ball.position.clone(), belt: a.joint("root").add(new THREE.Vector3(0, 0.1, 0.15)) } };
  },
  async "throw-set"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, light: [1.5, 5, 4] });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.light, style }).pose(POSES.throwSet);
    dress(a, scene); const { frame } = wearGlove(a, "L", scene, { open: 0.25 });
    const hand = a.handFrame("R"); const ball = ballAt(scene, hand.origin.clone().addScaledVector(hand.z, 0.03).addScaledVector(hand.y, 0.03), style);
    const w = 1000, h = 760;
    cam(camera, [0.9, 1.15, 4.7], [0.1, 0.88, 0], 26, w, h);
    return { scene, camera, w, h, anchors: { glove: frame.origin.clone(), ball: ball.position.clone(), backFoot: a.joint("foot_R"), frontFoot: a.joint("foot_L"), shoulder: a.joint("upperarm01_L"), target: new THREE.Vector3(1.6, 1.3, 0) } };
  },
  async "throw-feet"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style, light: [0.5, 6, 1] });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.light, style }).pose(POSES.throwSet);
    dress(a, scene); a.root.traverse((o) => { if (o.isSkinnedMesh || (o.isMesh && !o.parent.isBone && !o.parent.parent?.isBone)) o.visible = false; }); a.root.traverse((o) => { if (o.isMesh && o.parent && o.parent.isBone && o.parent.name === "head") o.visible = false; });
    a.root.traverse((o) => { if (o.isGroup && o.parent && o.parent.name === "head") o.visible = false; });
    const toeOf = (s) => { const f = a.bones["foot_" + s]; return new THREE.Vector3(0, -0.07, 0.2).applyMatrix4(f.matrixWorld).setY(0); };
    const heelOf = (s) => { const f = a.bones["foot_" + s]; return new THREE.Vector3(0, -0.07, -0.07).applyMatrix4(f.matrixWorld).setY(0); };
    const w = 1000, h = 760, cx = [toeOf("L"), heelOf("L"), toeOf("R"), heelOf("R")].reduce((m, v) => [Math.min(m[0], v.x), Math.max(m[1], v.x)], [9, -9]).reduce((p, q) => (p + q) / 2), cz = [toeOf("L"), heelOf("L"), toeOf("R"), heelOf("R")].reduce((m, v) => m + v.z / 4, 0);   // framed tight on the two cleats so they read at phone size
    const oc = new THREE.OrthographicCamera(-0.74, 0.74, 0.56, -0.56, 0.1, 20); oc.position.set(cx, 8, cz); oc.up.set(0, 0, -1); oc.lookAt(cx, 0, cz); oc.updateProjectionMatrix();
    const bf = a.joint("foot_R"), ff = a.joint("foot_L");
    return { scene, camera: oc, w, h, anchors: { backHeel: heelOf("R"), backToe: toeOf("R"), frontHeel: heelOf("L"), frontToe: toeOf("L"), lineStart: new THREE.Vector3(cx - 0.7, 0, cz), target: new THREE.Vector3(cx + 0.72, 0, cz) } };
  },
  async "test-cap"(style = "editorial") {
    await load();
    const { scene, camera } = stage({ style });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.medium, style }).pose({ head: { pitch: 0 } });
    dress(a, scene); const w = 700, h = 700, hp = a.joint("head");
    cam(camera, [hp.x + 0.9, hp.y + 0.1, hp.z + 0.9], [hp.x, hp.y + 0.08, hp.z], 22, w, h);
    return { scene, camera, w, h };
  },
  async "test-ready"(style = "ink") {
    await load();
    const { scene, camera } = stage({ style });
    const a = new Athlete(scene, { kit: KITS.home, skin: SKIN.medium, style }).pose(POSES.ready);
    dress(a, scene); const { glove } = wearGlove(a, "L", scene, { open: 0.35 });
    const w = 1000, h = 800;
    cam(camera, [3.3, 1.05, 3.0], [0.0, 0.62, 0.15], 24, w, h);
    return { scene, camera, w, h, anchors: { glove: glove.getWorldPosition(new THREE.Vector3()), knees: a.joint("lowerleg01_L"), feet: a.joint("foot_L"), hips: a.joint("root") } };
  },
};
