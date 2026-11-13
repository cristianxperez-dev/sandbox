/* Proof of concept: one RHH, one LHH, one RHP, a ball, plate, boxes and mound, fixed catcher camera.
   URL: ?hitter=R|L&clip=bat|take&t=<sec>&view=catcher|side|pitcher&paused=1 ; window.POC.set(t) for frame inspection. */
import { THREE, loadPlayerAssets, Player, buildField, createRenderer, catcherCamera, UNIFORMS, RUBBER_Z, MOUND_H, ballMesh, FT } from "./world3d.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("c"), hud = document.getElementById("hud");
const { renderer, scene, camera } = createRenderer(canvas, { quality: q.get("q") || "high" });
buildField(scene);
const { meta } = await loadPlayerAssets();

const hitterHand = q.get("hitter") || "R";
const batter = new Player(scene, { role: "batter", hand: hitterHand, kit: UNIFORMS.road, skin: "#8d5a3b" });
const pitcher = new Player(scene, { role: "pitcher", hand: q.get("pitcher") || "R", kit: UNIFORMS.home, skin: "#e0ac7e", scale: 1.02 });
const bclip = hitterHand === "R" ? "batR" : "batL", pclip = pitcher.hand === "R" ? "pitchR" : "pitchL";

// place the batter: feet midpoint of the stance in the box (catcher's left for a RHH), facing the plate
batter.root.rotation.y = Math.PI;
batter.pose(bclip, 0.2);
const fm = batter.bonePos("foot_L").add(batter.bonePos("foot_R")).multiplyScalar(0.5);
batter.root.position.x += (hitterHand === "R" ? -0.83 : 0.83) - fm.x; batter.root.position.z += 0.2 - fm.z;
// place the pitcher: pivot foot on the rubber, striding toward the plate
pitcher.root.position.y = MOUND_H;
pitcher.pose(pclip, 0);
const pv = pitcher.bonePos(pitcher.hand === "R" ? "foot_R" : "foot_L");
pitcher.root.position.x += (pitcher.hand === "R" ? 0.15 : -0.15) - pv.x; pitcher.root.position.z += RUBBER_Z + 0.1 - pv.z;

const ball = ballMesh(); scene.add(ball);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false);
  const view = q.get("view") || "catcher";
  if (view === "catcher") catcherCamera(camera, w / h);
  else if (view === "side") { camera.aspect = w / h; camera.fov = 40; camera.position.set(hitterHand === "R" ? -5 : 5, 1.3, 0.3); camera.lookAt(hitterHand === "R" ? -0.8 : 0.8, 1.0, 0.2); camera.updateProjectionMatrix(); }
  else if (view === "pitcher") { camera.aspect = w / h; camera.fov = 30; camera.position.set(6, 1.6, RUBBER_Z + 2); camera.lookAt(0, 1.2, RUBBER_Z + 0.8); camera.updateProjectionMatrix(); }
  else if (view === "hands") { camera.aspect = w / h; camera.fov = 30; const hp = batter.bonePos("wrist_L"); camera.position.set(hp.x + (+q.get("dx") || 0.0), hp.y + 0.15, hp.z + 0.9); camera.lookAt(hp); camera.updateProjectionMatrix(); }
  else if (view === "pfront") { camera.aspect = w / h; camera.fov = 26; camera.position.set(0, 1.6, RUBBER_Z + 9); camera.lookAt(0, 1.2, RUBBER_Z + 0.5); camera.updateProjectionMatrix(); }
}
window.addEventListener("resize", resize); resize();

/* timeline: pitcher delivery drives everything; the hitter's clip is aligned so contact = ball arrival */
const pe = meta.clips[pclip].events, be = meta.clips[bclip].events;
const FLIGHT = 0.43;
const tArrive = pe.release + FLIGHT;
const mode = q.get("clip") || "bat";
function frame(t) {
  pitcher.pose(pclip, Math.min(t, meta.clips[pclip].duration));
  let bt = be.contact - (tArrive - t);
  if (mode === "take") bt = Math.min(bt, be.strideLand + 0.05);
  batter.pose(bclip, Math.max(0, Math.min(bt, meta.clips[bclip].duration)));
  // ball: in the throwing hand until release, then a straight-line placeholder to the plate (the game uses the engine's flight)
  const hand = pitcher.ballInHand();
  if (t < pe.release) ball.position.copy(hand);
  else { const k = Math.min(1, (t - pe.release) / FLIGHT); const end = new THREE.Vector3(0.1, 0.8, 0); ball.position.copy(hand).lerp(end, k); }
  renderer.render(scene, camera);
  hud.textContent = `t ${t.toFixed(2)}s  pitch ${pclip}  hitter ${bclip} (${mode})`;
}
let t0 = performance.now(), paused = q.get("paused") === "1", tFixed = +(q.get("t") || 0);
function loop(now) { requestAnimationFrame(loop); const t = paused ? tFixed : ((now - t0) / 1000) % (tArrive + 1.6); frame(t); }
requestAnimationFrame(loop);
window.POC = { set(t) { paused = true; tFixed = t; frame(t); }, meta, batter, pitcher, camera, THREE, ready: true };
