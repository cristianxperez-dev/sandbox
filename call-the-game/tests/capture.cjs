/* Call the Game — animation previews: plays crafted pitch records through the real 3D scene (the same records the engine
   produces) and renders them frame by frame (20 fps) for inspection. Output: <dir>/<name>-NNN.png (+ GIFs via the Python step).
   node call-the-game/tests/capture.cjs <dir> [scenario,...] */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:4173/apps/call-the-game/";
const out = process.argv[2] || ".", only = (process.argv[3] || "").split(",").filter(Boolean);
const FPS = +(process.env.FPS || 20);
const SCEN = {
  "rhh-take": { hand: "R", pitcher: "whitaker", rec: { code: "FF", target: { x: 0.1, z: 3.3 }, end: { x: 0.25, z: 3.4, velo: 95.8 }, result: "called", swing: false } },
  "lhh-whiff": { hand: "L", pitcher: "whitaker", rec: { code: "SL", target: { x: 0.6, z: 1.6 }, end: { x: 0.7, z: 1.45, velo: 85.4 }, result: "whiff", swing: true } },
  "rhh-foul": { hand: "R", pitcher: "kessler", rec: { code: "FF", target: { x: -0.2, z: 3.2 }, end: { x: -0.35, z: 3.1, velo: 93.4 }, result: "foul", swing: true } },
  "lhh-inplay": { hand: "L", pitcher: "fuentes", rec: { code: "FT", target: { x: -0.5, z: 2.0 }, end: { x: -0.3, z: 2.3, velo: 93.2 }, result: "inplay", swing: true, bip: { type: "line", quality: 0.7, result: "single", spray: -0.2 } } },
  "delivery": { hand: "R", pitcher: "whitaker", cam: "pitcher", rec: { code: "FF", target: { x: 0, z: 2.6 }, end: { x: 0.1, z: 2.7, velo: 95.8 }, result: "ball", swing: false } },
};
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const pg = await b.newPage({ viewport: { width: 960, height: 600 } });
  pg.on("pageerror", (e) => console.log("ERR", e.message));
  await pg.goto(BASE); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem("ctg.v1", JSON.stringify({ settings: { speed: 1, showZone: true } })); });
  await pg.reload(); await pg.goto(BASE + "#/report/whitaker"); await pg.click("#start"); await pg.waitForSelector("#scene");
  await pg.waitForFunction(() => window.CTGDebug && window.CTGDebug.scene(), null, { timeout: 30000 });
  await pg.evaluate(() => window.CTGDebug.scene().ready()); await pg.waitForTimeout(1500);
  for (const [name, s] of Object.entries(SCEN)) {
    if (only.length && !only.includes(name)) continue;
    const tl = await pg.evaluate((s) => {
      const sc = window.CTGDebug.scene(), C = window.CTG;
      sc.set({ pitcher: C.pitcherById(s.pitcher), batter: { id: "cap-" + s.hand, name: "Test", hand: s.hand, body: { scale: 1 }, skin: "#a0673a", stance: { open: 0 } }, target: s.rec.target, code: s.rec.code, last: null, aim: false });
      const d = sc._debug; d.freeze(!!s.cam);
      if (s.cam === "pitcher") { d.camera.position.set(-3.2, 1.7, -11.5); d.camera.lookAt(0.2, 1.2, -18.2); d.camera.fov = 30; d.camera.updateProjectionMatrix(); }
      sc.play(Object.assign({ n: 1, pitcherId: s.pitcher }, s.rec), { speed: 1 });
      return null;
    }, s);
    await pg.waitForTimeout(400);
    const t = await pg.evaluate(() => window.CTGDebug.scene().seek(0));
    const t0 = Math.max(0, t.rel - 1.35), t1 = Math.min(t.end, t.arr + (s.rec.result === "inplay" ? 1.6 : 0.9));
    let i = 0;
    for (let tt = t0; tt <= t1; tt += 1 / FPS, i++) {
      await pg.evaluate((tt) => window.CTGDebug.scene().seek(tt), tt); await pg.waitForTimeout(60);
      await (await pg.$(".stage")).screenshot({ path: `${out}/${name}-${String(i).padStart(3, "0")}.png` });
    }
    console.log(name, i, "frames", JSON.stringify(t));
    await pg.evaluate(() => { const sc = window.CTGDebug.scene(); sc.skip(); sc._debug.freeze(false); }); await pg.waitForTimeout(800);
    await pg.evaluate(() => { const d = window.CTGDebug.scene()._debug; d.camera.fov = 33; d.camera.updateProjectionMatrix(); });
  }
  await b.close();
})();
