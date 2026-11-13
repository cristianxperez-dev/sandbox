/* Call the Game — browser tests (Playwright): full innings on desktop, iPhone and iPad; report, review, retry, resume, layout.
   Serve first: node scripts/build.mjs && node scripts/serve.mjs   then: node call-the-game/tests/app.e2e.cjs [shotDir] */
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "http://localhost:4173/apps/call-the-game/";
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

async function pickAndCall(pg, i) {
  const codes = await pg.$$eval(".pbtn", (b) => b.map((x) => x.dataset.code));
  await pg.click(`.pbtn[data-code="${codes[i % codes.length]}"]`);
  const box = await (await pg.$("#pad svg")).boundingBox();
  const fx = [0.35, 0.62, 0.5, 0.7, 0.3][i % 5], fz = [0.35, 0.6, 0.72, 0.45, 0.55][i % 5];
  await pg.mouse.click(box.x + box.width * fx, box.y + box.height * fz);
  await pg.click("#call");
  await pg.waitForFunction(() => { const b = document.querySelector("#call"); return !b || !b.disabled || /review|over/i.test(b.textContent); }, null, { timeout: 15000 });
}
async function playInning(pg, maxPitches = 80) {
  for (let i = 0; i < maxPitches; i++) {
    if (await pg.evaluate(() => location.hash === "#/review")) return i;
    const txt = await pg.textContent("#call");
    if (/review|over/i.test(txt)) { await pg.waitForFunction(() => location.hash === "#/review", null, { timeout: 8000 }); return i; }
    await pickAndCall(pg, i);
  }
  return -1;
}
const setSpeed = (pg, sp) => pg.evaluate((sp) => { const s = JSON.parse(localStorage.getItem("ctg.v1")); s.settings.speed = sp; localStorage.setItem("ctg.v1", JSON.stringify(s)); }, sp);

async function run(name, ctxOpts) {
  console.log(name);
  const b = await chromium.launch(); const ctx = await b.newContext(ctxOpts); const pg = await ctx.newPage();
  const errs = [], failed = [];
  pg.on("console", (m) => m.type() === "error" && errs.push(m.text())); pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("requestfailed", (r) => failed.push(r.url()));
  await pg.goto(BASE);
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem("ctg.v1", JSON.stringify({ settings: { speed: "skip" } })); });
  await pg.goto(BASE + "#/"); await pg.reload();
  ok((await pg.$$(".pcard")).length === 3, "three pitcher cards");
  const noHScroll = () => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(await noHScroll(), "home: no horizontal scroll");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-1-home.png`, fullPage: true });

  // advance report
  await pg.click('[data-pick="kessler"]');
  await pg.waitForSelector(".report");
  ok((await pg.$$(".pitch")).length === 3, "report: three pitch cards");
  const sums = await pg.$$eval(".usage .ubar__track", (ts) => ts.map((t) => Array.from(t.querySelectorAll(".ubar__seg")).reduce((s, x) => s + parseFloat(x.dataset.w), 0)));
  ok(sums.length === 2 && sums.every((s) => Math.abs(s - 100) < 0.1), "report: usage bars total 100% per split");
  ok((await pg.$$(".zc--corr")).length === 3 && (await pg.$$(".zc--miss")).length === 3 && (await pg.$$(".mv")).length === 3, "report: corridors, miss clouds and separate movement charts");
  ok(/glove/i.test(await pg.textContent(".plan")), "report: game plan text");
  ok(await noHScroll(), "report: no horizontal scroll");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-2-report.png`, fullPage: true });

  // game
  await pg.click("#start"); await pg.waitForSelector("#scene");
  ok((await pg.$$(".pbtn")).length === 3, "game: only the arsenal's pitch buttons");
  ok(await pg.$eval("#call", (b) => b.disabled), "game: call disabled until pitch + glove set");
  ok(await noHScroll(), "game: no horizontal scroll");
  const callBox = await (await pg.$("#call")).boundingBox(), vp = pg.viewportSize();
  ok(callBox.y + callBox.height <= vp.height + 1, "game: Call pitch visible without scrolling");
  const cb = await (await pg.$("#scene")).boundingBox();
  await pg.click(".pbtn >> nth=0"); await pg.mouse.click(cb.x + cb.width / 2, cb.y + cb.height * 0.6);
  ok(!(await pg.$eval("#call", (b) => b.disabled)), "game: tapping the scene places the glove");
  await pg.click("#btn-report"); ok(await pg.$eval("#modal", (d) => d.open), "game: compact report reopens");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-3b-modal.png` });
  await pg.click("#modal-close");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-3-game.png` });
  // one animated pitch at 2×
  await pg.click("#btn-speed"); await pg.click("#btn-speed");   // skip → 1× → 2×
  ok((await pg.textContent("#btn-speed")).trim() === "2×", "speed control cycles");
  await pickAndCall(pg, 0);
  ok(/P 1/.test(await pg.textContent("#sb")), "scoreboard counts the pitch");
  ok((await pg.$("#last b")) !== null, "last pitch shown");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-4-after-pitch.png` });
  await pg.click("#btn-speed");                                  // 2× → skip
  const sbBefore = await pg.textContent("#sb");
  await pg.reload(); await pg.waitForSelector("#scene");
  ok((await pg.textContent("#sb")) === sbBefore, "reload resumes the inning in progress");
  const n = await playInning(pg);
  ok(n > 0, "inning completes with three outs");
  await pg.waitForSelector(".review");

  // review
  const grade = await pg.$eval(".rv__head h1", (h) => parseInt(h.textContent, 10));
  ok(grade >= 0 && grade <= 100, "review: overall grade 0–100");
  ok((await pg.$$(".fb h3")).length === 3, "review: well / opportunity / takeaway");
  ok((await pg.$$(".usplit")).length === 2, "review: usage per split");
  ok((await pg.$$(".rv")).length >= 1 && (await pg.$$(".rv__opt")).length >= 1, "review: per-pitch charts with model-preferred setups");
  ok((await pg.$$(".plog")).length >= 3, "review: pitch-by-pitch log");
  ok(await noHScroll(), "review: no horizontal scroll");
  await setSpeed(pg, 1);
  await pg.click('[data-replay="0"]'); await pg.waitForTimeout(1600);
  ok(/#1 /.test(await pg.textContent("#rcap")), "review: replay plays the selected pitch");
  if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}-5-review.png`, fullPage: true });
  ok((await pg.evaluate(() => JSON.parse(localStorage.getItem("ctg.v1")).history.length)) >= 1, "history persisted");

  // retry: same seed → same leadoff hitter
  const lead = (await pg.$eval(".plog__b", (e) => e.textContent)).replace(/\s+[RL]$/, "").trim();
  await pg.click("#retry"); await pg.waitForSelector("#scene");
  ok((await pg.textContent("#batter")).includes(lead), "retry: same leadoff hitter (" + lead + ")");
  ok(errs.length === 0, "no console errors: " + errs.join(" | "));
  ok(failed.length === 0, "no failed requests: " + failed.join(" | "));
  await b.close();
}

(async () => {
  await run("desktop", { viewport: { width: 1440, height: 900 } });
  await run("iphone", devices["iPhone 13"]);
  await run("ipad", devices["iPad Mini"]);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
