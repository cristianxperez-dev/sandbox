/* Manager Hub — render the Quick Start Guide to a one-page US Letter PDF (and a PNG preview for checking).
   node manager-hub/guide/src/build-pdf.cjs        (Playwright / Chromium) */
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const SRC = path.join(__dirname, "quick-start.html");
const OUT = path.join(__dirname, "..", "..", "..", "apps", "manager-hub", "guide", "Manager_Hub_Quick_Start_Guide.pdf");   // served with the app (behind the access code)
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  await p.goto("file://" + SRC);
  await p.evaluate(() => document.fonts.ready);
  // the page must fit: nothing may spill out of the 8.5 × 11 in sheet
  const fit = await p.evaluate(() => { const pg = document.querySelector(".page"); const r = pg.getBoundingClientRect(); const over = [...pg.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && (b.bottom > r.bottom + 0.5 || b.right > r.right + 0.5); }).map((e) => e.className || e.tagName); const ft = pg.querySelector(".ft").getBoundingClientRect(); const tips = pg.querySelector(".tips").getBoundingClientRect(); return { over, slack: Math.round(ft.top - tips.bottom), fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family) }; });
  console.log("fit:", JSON.stringify(fit));
  if (fit.over.length) { console.error("Content overflows the page:", fit.over.slice(0, 10)); process.exitCode = 1; }
  await p.pdf({ path: OUT, format: "Letter", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await p.screenshot({ path: path.join(__dirname, "preview.png"), fullPage: false });
  await b.close();
  const pdf = fs.readFileSync(OUT, "latin1");
  console.log("pages:", (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, "·", OUT, Math.round(fs.statSync(OUT).size / 1024) + " KB");
})();
