/* Export studio figures: node english/tools/render-figs.cjs <outDir> name[:style] ...   (serve the repo root on :4180 first:
   python3 -m http.server 4180 --directory <repo>) */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [, , out, ...names] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  pg.on("pageerror", (e) => console.log("ERR", e.message)); pg.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
  await pg.goto("http://localhost:4180/english/tools/studio/studio.html"); await pg.waitForFunction(() => window.STUDIO_READY, null, { timeout: 60000 });
  fs.mkdirSync(out, { recursive: true });
  for (const spec of names) {
    const [name, style = "ink"] = spec.split(":");
    const t0 = Date.now();
    const r = await pg.evaluate(([n, s]) => window.RENDER(n, s), [name, style]);
    const file = path.join(out, `${name}${style === "ink" ? "" : "." + style}`);
    fs.writeFileSync(file + ".png", Buffer.from(r.url.split(",")[1], "base64"));
    fs.writeFileSync(file + ".json", JSON.stringify({ w: r.w, h: r.h, anchors: r.anchors }, null, 1));
    console.log(spec, r.w + "x" + r.h, ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(r.anchors));
  }
  await b.close();
})();
