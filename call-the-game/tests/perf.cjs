/* Call the Game — performance measurement.
   GPU: this container has no GPU (Chromium falls back to SwiftShader, a CPU rasteriser), so fill-rate numbers here are a
   software-rendering worst case. What it measures reliably:
     • CPU animation cost per frame (clip sampling + IK + equipment) — the part that scales with device CPU,
     • scene complexity (draw calls, triangles, textures) at each quality tier,
     • asset payload and time to first rendered scene,
     • frame rate under SwiftShader at phone and desktop sizes (a floor, not a forecast).
   node call-the-game/tests/perf.cjs */
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "http://localhost:4173/apps/call-the-game/";
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const rows = [];
  for (const [label, ctxOpts, q] of [["desktop 1440×900 · high", { viewport: { width: 1440, height: 900 } }, "high"], ["iPhone 13 · medium", devices["iPhone 13"], "medium"], ["iPhone 13 · low", devices["iPhone 13"], "low"]]) {
    const ctx = await b.newContext(ctxOpts), pg = await ctx.newPage();
    let bytes = 0; pg.on("response", async (r) => { try { const h = r.headers()["content-length"]; if (h) bytes += +h; else bytes += (await r.body()).length; } catch (_) {} });
    const t0 = Date.now();
    await pg.goto(BASE + "?q=" + q); await pg.evaluate(() => { localStorage.setItem("ctg.v1", JSON.stringify({ settings: { speed: 1 } })); });
    await pg.goto(BASE + "?q=" + q + "#/report/whitaker"); await pg.click("#start");
    await pg.waitForFunction(() => window.CTGDebug && window.CTGDebug.scene() && window.CTGDebug.scene()._debug.S.ready && window.CTGDebug.scene()._debug.S.pitcher, null, { timeout: 120000 });
    const ready = Date.now() - t0;
    await pg.waitForTimeout(3000);
    const r = await pg.evaluate(async () => {
      const sc = window.CTGDebug.scene(), d = sc._debug, S = d.S, b = S.batter, p = S.pitcher;
      // CPU animation cost: sample both clips + IK + equipment, as one game frame does
      const N = 300, t0 = performance.now();
      for (let i = 0; i < N; i++) { const t = (i / N) * 2.4; p.pose(p.clipName, t); b.pose(b.clipName, Math.min(2.3, 0.2 + t)); }
      const animMs = (performance.now() - t0) / N;
      // render cost (SwiftShader): time 60 renders
      const t1 = performance.now(); for (let i = 0; i < 30; i++) d.renderer.render(d.scene, d.camera); const renderMs = (performance.now() - t1) / 30;
      const info = d.renderer.info;
      return { animMs, renderMs, calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries, pr: d.renderer.getPixelRatio(), shadows: d.renderer.shadowMap.enabled };
    });
    rows.push({ label, readyMs: ready, payloadMB: +(bytes / 1e6).toFixed(2), ...r });
    await ctx.close();
  }
  console.table(rows.map((x) => ({ device: x.label, "first scene (s)": (x.readyMs / 1000).toFixed(1), "payload MB": x.payloadMB, "anim CPU ms/frame": x.animMs.toFixed(2), "render ms (SwiftShader)": x.renderMs.toFixed(1), "draw calls": x.calls, triangles: x.tris, "pixel ratio": x.pr, shadows: x.shadows })));
  console.log(JSON.stringify(rows));
  await b.close();
})();
