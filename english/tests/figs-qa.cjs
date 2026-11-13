/* English — visual QA of every instructional figure through the app's own component (CPEFig.draw), at desktop and phone
   widths, light and dark. node english/tests/figs-qa.cjs <outDir>  (serve the site first: node scripts/serve.mjs)
   Checks: every lesson figure id renders; plate images load (naturalWidth > 0); callout markers sit inside their image;
   legend text ≥ 11 px; no horizontal overflow at phone width. Writes one screenshot per figure per viewport. */
const { chromium, devices } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:4173/apps/english/";
const out = process.argv[2] || "figs-qa";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const [name, opts, scheme] of [["desktop", { viewport: { width: 1280, height: 900 } }, "light"], ["iphone", devices["iPhone 13"], "light"], ["iphone-dark", devices["iPhone 13"], "dark"]]) {
    const ctx = await b.newContext(Object.assign({}, opts, { colorScheme: scheme })), pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await pg.goto(BASE); await pg.waitForFunction(() => window.CPEFig && window.CPEPlates, null, { timeout: 20000 });
    const ids = await pg.evaluate(() => window.CPEFig.ids.concat(Object.keys(window.CPEPlates)).filter((v, i, a) => a.indexOf(v) === i));
    for (const id of ids) {
      await pg.evaluate((id) => {
        const host = document.getElementById("qa-host") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "qa-host" }));
        host.replaceChildren(); host.style.maxWidth = "760px"; host.style.margin = "16px auto"; host.style.padding = "0 16px";
        document.querySelector("main") && (document.querySelector("main").style.display = "none");
        const f = window.CPEFig.draw(id, { highlight: id === "grip-4s" ? ["index", "middle"] : id === "grip-change" ? ["circle"] : id === "delivery-side" ? ["stride"] : [] , caption: "QA render" });
        host.append(f); window.scrollTo(0, 0);
      }, id);
      await pg.waitForFunction(() => Array.from(document.querySelectorAll("#qa-host img")).every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
      const r = await pg.evaluate(() => {
        const host = document.getElementById("qa-host"), imgs = Array.from(host.querySelectorAll("img"));
        const small = Array.from(host.querySelectorAll(".plate__legend li span, .fg__lbl")).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).length;
        const mk = Array.from(host.querySelectorAll(".plate__mk")).filter((m) => { const a = m.parentElement.getBoundingClientRect(), r = m.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          return r.width < 20 || x < a.left - 1 || x > a.right + 1 || y < a.top - 1 || y > a.bottom + 1; }).length;
        return { plate: !!host.querySelector(".plate"), imgs: imgs.length, broken: imgs.filter((i) => !i.naturalWidth).length, small, outside: mk, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      ok(!r.broken, `${name} ${id}: ${r.broken} broken images`);
      ok(r.outside === 0, `${name} ${id}: ${r.outside} callout pins outside the image or under 20 px`);
      ok(r.small === 0, `${name} ${id}: ${r.small} labels under 11px`);
      ok(!r.overflow, `${name} ${id}: horizontal overflow`);
      await (await pg.$("#qa-host")).screenshot({ path: `${out}/${name}-${id}.png` });
    }
    ok(errs.length === 0, `${name}: console errors ${errs.join(" | ")}`);
    await ctx.close();
  }
  await b.close();
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
