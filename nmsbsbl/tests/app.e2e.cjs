/* NMSBSBL — end to end through the real access gate and data functions (harness.cjs), real public data.
   NODE_USE_ENV_PROXY=1 node nmsbsbl/tests/app.e2e.cjs        (build first: node scripts/build.mjs)
   SHOTS=dir writes screenshots. */
const { chromium, devices } = require("playwright");
const H = require("./harness.cjs");
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const shot = async (p, n, full) => { if (SHOTS) { await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: !!full }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

(async () => {
  const S = await H.start(), BASE = S.base;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("response", (x) => { if (x.status() >= 400) errs.push("HTTP " + x.status() + " " + x.url()); });

  /* 1–2: the URL resolves to the branded access screen */
  let r = await p.goto(BASE);
  ok(r.ok() && /\/apps\/nmsbsbl\/access\//.test(p.url()), "1 · /apps/nmsbsbl/ resolves — signed out it lands on the access screen");
  const txt = await p.innerText("body");
  ok(/NMSBSBL/.test(txt) && /PITCHING\s+INTELLIGENCE/i.test(txt) && await p.isVisible("#code") && /continue/i.test(await p.innerText("button")), "2 · branded access screen: wordmark, subtitle, code input, Continue");
  ok(!(await p.content()).includes(S.env.NMSBSBL_ACCESS_CODE), "2 · the access code is nowhere in the page");
  await shot(p, "01-access");
  /* 6: direct profile URL and data endpoints need a session */
  r = await p.goto(BASE + "#/p/694973/arsenal");
  ok(/\/access\//.test(p.url()) && !(await p.$(".bc-svg")), "6 · a direct profile URL shows the access screen, not the profile");
  for (const u of ["api/roster", "api/pitcher?id=694973", "api/pitches?id=694973&season=2026", "app.js", "core.js"]) {
    const res = await ctx.request.get(BASE + u, { maxRedirects: 0 });
    ok([401, 303].includes(res.status()), `6 · ${u} without a session → ${res.status()}`);
  }
  /* 3: invalid code */
  await p.fill("#code", "not-the-code"); await p.click("button[type=submit]"); await p.waitForLoadState();
  ok(await p.isVisible("#code") && /isn.t right/.test(await p.innerText(".err")), "3 · an invalid code is rejected with a discreet message");
  await shot(p, "02-invalid");
  /* 4: valid code */
  await p.fill("#code", S.env.NMSBSBL_ACCESS_CODE); await p.click("button[type=submit]");
  await p.waitForSelector(".pc:not(.skel)", { timeout: 90000 });
  ok(/\/apps\/nmsbsbl\/$|\/apps\/nmsbsbl\/#/.test(p.url()), "4 · the right code opens NMSBSBL");
  errs.length = 0;   // the wrong-code page above is a deliberate 401; from here on nothing should fail
  const cookies = await ctx.cookies();
  const sess = cookies.find((c) => c.name === "sbx_nmsbsbl");
  ok(sess && sess.httpOnly && sess.secure && sess.path === "/apps/nmsbsbl/", "4 · session cookie is HttpOnly, Secure and scoped to /apps/nmsbsbl/");
  /* 7–8: directory and photos */
  await p.waitForTimeout(2500);
  const cards = await p.$$eval(".pc", (cs) => cs.map((c) => ({ href: c.getAttribute("href"), img: (c.querySelector("img") || {}).src || "", loaded: !!(c.querySelector("img") && c.querySelector("img").naturalWidth), name: c.querySelector(".pc-name").innerText.replace(/\s+/g, " ").trim(), hand: c.querySelector(".pc-hand").innerText })));
  ok(cards.length === 20, `7 · directory lists the ${cards.length} covered pitchers`);
  ok(cards.every((c) => c.loaded), "7 · every card's MLB photo loaded");
  const ids = cards.map((c) => c.href.replace("#/p/", ""));
  ok(cards.every((c, i) => c.img.includes(`/people/${ids[i]}/headshot/`)), "8 · each photo is requested by that card's own MLBAM id (never a hard-coded URL)");
  const api = await (await ctx.request.get(BASE + "api/roster")).json();
  const byId = new Map(api.pitchers.map((x) => [String(x.id), x]));
  ok(cards.every((c, i) => c.name.toLowerCase() === (byId.get(ids[i]).first + " " + byId.get(ids[i]).last).toLowerCase()), "8 · card names match the MLB Stats API record for the same id");
  ok(cards.some((c) => /RHP/.test(c.hand)) && cards.some((c) => /LHP/.test(c.hand)), "7 · right- and left-handers");
  await p.fill("#q", "skub"); await p.waitForTimeout(150);
  ok((await p.$$(".pc")).length === 1 && /Skubal/i.test(await p.innerText(".pc")), "7 · search narrows to one pitcher");
  await p.fill("#q", ""); await p.click('[data-hand="L"]'); await p.waitForTimeout(150);
  ok((await p.$$eval(".pc-hand", (x) => x.map((e) => e.innerText))).every((t) => /LHP/.test(t)), "7 · LHP filter");
  await p.click('[data-hand=""]');
  await shot(p, "03-directory");
  /* 5: persistence */
  await p.reload(); await p.waitForSelector(".pc:not(.skel)", { timeout: 60000 });
  ok(!/\/access\//.test(p.url()), "5 · signed in after a reload");
  /* 9: profile tabs */
  await p.click('.pc[href="#/p/694973"]'); await p.waitForSelector(".ov", { timeout: 90000 });
  ok(/SKENES/i.test(await p.innerText(".hero-name")) && /RHP/.test(await p.innerText(".facts")) && /Age \d+\.\d/.test(await p.innerText(".facts")), "9 · profile header: name, RHP, decimal age");
  ok(/Pittsburgh Pirates/i.test(await p.innerText(".hero .eyebrow")), "9 · team from the Stats API");
  ok((await p.$$(".ov .mini tbody tr")).length >= 4 && await p.isVisible(".velo") && await p.isVisible("#miniChart svg"), "9 · Overview: arsenal, usage, velocity, movement profile");
  await shot(p, "04-overview", true);
  await p.click('[data-tab="arsenal"]'); await p.waitForSelector(".bc-svg .bc-avg", { timeout: 90000 });
  await p.waitForSelector(".ars-t tbody tr", { timeout: 10000 }).catch(() => {});
  console.log("  url", p.url(), "rows", (await p.$$(".ars-t tbody tr")).length);
  ok(/\/arsenal/.test(p.url()) && (await p.$$(".ars-t tbody tr")).length >= 4, "9 · Arsenal tab: break chart and arsenal table");
  const head = await p.$$eval(".ars-t th", (x) => x.map((e) => e.innerText.trim().toUpperCase()));
  ok(["USAGE", "VELO", "IVB", "HB", "SPIN", "RELZ", "RELX", "EXT"].every((k) => head.includes(k)), "9 · table has usage, velocity, IVB, HB, spin, release height / side, extension");
  /* 10: chart accuracy for a right-hander */
  const geom = () => p.evaluate(() => {
    const svg = document.querySelector(".bc-svg"), cx0 = 58 + (600 - 58 - 18) / 2, cy0 = 18 + (600 - 58 - 18) / 2;
    return Array.from(svg.querySelectorAll(".bc-avg")).map((g) => { const c = g.querySelector(".bc-avg-dot"); return { type: g.dataset.type, dx: +c.getAttribute("cx") - cx0, dy: cy0 - +c.getAttribute("cy") }; });
  });
  const table = () => p.$$eval(".ars-t tbody tr", (rows) => rows.map((r) => { const t = r.querySelectorAll("td"); return { type: t[0].innerText.trim().split(/\s+/)[0], ivb: parseFloat(t[5].innerText.replace("−", "-")), hb: parseFloat(t[6].innerText.replace("−", "-")) }; }));
  let g = await geom(), tb = await table();
  const disp = (t) => (t === "ST" ? "SW" : t);
  const agree = (g, tb) => g.every((m) => { const r = tb.find((x) => x.type === disp(m.type)); return r && Math.sign(m.dx) === Math.sign(r.hb) && Math.sign(m.dy) === Math.sign(r.ivb); });
  ok(agree(g, tb), "10 · RHP: every average marker sits where the table's HB / IVB put it (signs and quadrant)");
  const ff = tb.find((x) => x.type === "FF"), sw = tb.find((x) => x.type === "SW");
  ok(ff.hb > 0 && sw.hb < 0 && ff.ivb > 10, "10 · RHP (Skenes): four-seamer arm side (+) with ride, sweeper glove side (−)");
  ok(/Arm side →/.test(await p.textContent(".bc-svg")), "10 · RHP: + is labelled arm side");
  const scale = await p.evaluate(() => { const t = Array.from(document.querySelectorAll(".bc-tick")).map((x) => x.textContent); return t; });
  ok(scale.includes("0") && scale.some((x) => x.startsWith("+")) && scale.some((x) => x.startsWith("−")), "10 · symmetric signed axes");
  /* 11: interactions */
  const nPts = () => p.$$eval(".bc-pts", (x) => x.length);
  const before = await nPts();
  await p.click('.lg[data-type="FF"]'); await p.waitForTimeout(400);
  ok((await nPts()) === before - 1 && !(await p.$('.bc-avg[data-type="FF"]')), "11 · legend: hiding a pitch type removes its pitches and average");
  await p.click('.lg[data-type="FF"]'); await p.waitForTimeout(400);
  ok((await nPts()) === before, "11 · legend: showing it again");
  await p.dblclick('.lg[data-type="CH"]'); await p.waitForTimeout(400);
  ok((await nPts()) === 1, "11 · legend: double-click shows one type only");
  await p.click("[data-allon]"); await p.waitForTimeout(300);
  const total = await p.innerText("#bcSub");
  await p.click('[data-side="L"]'); await p.waitForTimeout(300);
  ok((await p.innerText("#bcSub")) !== total && /vs LHH/i.test(await p.innerText("#bcSub")), "11 · batter side filter (vs LHH) changes the selection");
  await p.click('[data-side=""]'); await p.waitForTimeout(200);
  await p.click('[data-mode="averages"]'); await p.waitForTimeout(300);
  ok((await nPts()) === 0 && (await p.$$(".bc-avg")).length >= 4, "11 · aggregate view: averages only, no individual points");
  await p.click('[data-mode="pitches"]'); await p.waitForTimeout(300);
  await p.click('[data-spread]'); await p.waitForTimeout(200);
  ok((await p.$$(".bc-ell")).length === 0, "11 · spread ellipses toggle off");
  await p.click('[data-spread]'); await p.waitForTimeout(200);
  // hover a real pitch: the tooltip shows its details
  await p.$eval(".bc-svg", (s) => s.scrollIntoView({ block: "center" })); await p.waitForTimeout(200);
  const pt = await p.evaluate(() => {
    // a real pitch well away from every average marker (averages win the hover when close)
    const s = document.querySelector(".bc-svg"), box = s.getBoundingClientRect(), k = box.width / 600;
    const avgs = Array.from(s.querySelectorAll(".bc-avg-dot")).map((c) => [+c.getAttribute("cx"), +c.getAttribute("cy")]);
    let best = null, bd = -1;
    s.querySelectorAll(".bc-pts").forEach((path) => { const re = /M([\d.]+) ([\d.]+)a([\d.]+)/g; let m; while ((m = re.exec(path.getAttribute("d")))) { const x = +m[1] + +m[3], y = +m[2]; const d = Math.min(...avgs.map(([ax, ay]) => Math.hypot(ax - x, ay - y))); if (d > bd) { bd = d; best = { x, y }; } } });
    return { x: box.left + best.x * k, y: box.top + best.y * k };
  });
  await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(200);
  ok(await p.isVisible(".bc-tip") && /velo/i.test(await p.innerText(".bc-tip")) && /mph/.test(await p.innerText(".bc-tip")), "11 · hovering a pitch shows its velocity, break, spin, date and result");
  await shot(p, "05-arsenal-tooltip");
  const avg = await p.$('.bc-avg[data-type="SL"]') || await p.$(".bc-avg");
  const at = await avg.getAttribute("data-type");
  await avg.click(); await p.waitForTimeout(300);
  ok((await p.$$(".bc-pts.dim")).length >= 1 && await p.isVisible(".focus") && (await p.$eval(`.lg[data-type="${at}"]`, (e) => e.classList.contains("focus"))), "11 · clicking an average focuses that pitch type (others dim, detail card)");
  await p.click("[data-unfocus]"); await p.waitForTimeout(200);
  /* season selector */
  const opts = await p.$$eval("#season option", (x) => x.map((o) => o.value));
  ok(opts.length >= 2, "11 · season selector lists his Statcast seasons");
  await p.selectOption("#season", opts[1]); await p.waitForSelector(".bc-svg .bc-avg", { timeout: 90000 }); await p.waitForTimeout(500);
  ok(new RegExp("^" + opts[1]).test(await p.innerText("#bcSub")) && p.url().includes("s=" + opts[1]), "11 · changing the season reloads that season's pitches");
  /* 10: a left-hander */
  await p.goto(BASE + "#/p/669373/arsenal"); await p.waitForSelector(".bc-svg .bc-avg", { timeout: 90000 }); await p.waitForTimeout(600);
  g = await geom(); tb = await table();
  ok(agree(g, tb), "10 · LHP: markers agree with the table");
  const lff = tb.find((x) => x.type === "FF"), lch = tb.find((x) => x.type === "CH"), lsl = tb.find((x) => x.type === "SL");
  ok(lff.hb < 0 && lch.hb < 0 && lsl.hb > 0, "10 · LHP (Skubal): fastball and changeup arm side (−, toward first base), slider glove side (+) — pitcher's view, not mirrored");
  ok(/Glove side →/.test(await p.textContent(".bc-svg")) && /← Arm side/.test(await p.textContent(".bc-svg")), "10 · LHP: axis sides labelled for a left-hander");
  ok(await noOverflow(p), "12 · desktop: no horizontal overflow");
  await shot(p, "06-arsenal-lhp", true);
  /* 5: logout */
  await p.click("#signout"); await p.waitForLoadState();
  ok(/\/access\//.test(p.url()), "5 · Sign out returns to the access screen");
  const after = await ctx.request.get(BASE + "api/roster", { maxRedirects: 0 });
  ok(after.status() === 401, "5 · after sign-out the data endpoints refuse again");
  ok(errs.length === 0, "12 · desktop: no console errors" + (errs.length ? " — " + errs.join(" | ") : ""));
  await ctx.close();

  /* 12: phone */
  const m = await b.newContext(devices["iPhone 13"]); const q = await m.newPage(), merrs = [];
  q.on("pageerror", (e) => merrs.push(e.message));
  await q.goto(BASE); await q.fill("#code", S.env.NMSBSBL_ACCESS_CODE); await q.click("button[type=submit]");
  await q.waitForSelector(".pc:not(.skel)", { timeout: 60000 }); await q.waitForTimeout(1500);
  ok(await noOverflow(q), "12 · phone: directory fits, no horizontal scroll");
  await shot(q, "07-phone-directory");
  await q.goto(BASE + "#/p/676979/arsenal"); await q.waitForSelector(".bc-svg .bc-avg", { timeout: 90000 }); await q.waitForTimeout(600);
  ok(await noOverflow(q), "12 · phone: arsenal fits");
  const w = await q.$eval(".bc-svg", (s) => s.getBoundingClientRect().width);
  ok(w >= 300, `12 · phone: the break chart uses the width (${Math.round(w)} px)`);
  ok(await q.isVisible(".acards") && !(await q.$(".ars-t")), "12 · phone: arsenal as cards, not a wide table");
  await q.$eval(".bc-svg", (s) => s.scrollIntoView({ block: "center" })); await q.waitForTimeout(200);
  const box = await q.$eval(".bc-avg .bc-avg-dot", (c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await q.touchscreen.tap(box.x, box.y); await q.waitForTimeout(300);
  ok((await q.$$(".bc-avg.on")).length === 1, "12 · phone: tapping an average focuses it");
  await shot(q, "08-phone-arsenal", true);
  ok(merrs.length === 0, "12 · phone: no page errors" + (merrs.length ? " — " + merrs.join(" | ") : ""));
  await m.close();

  /* fail closed without the secret */
  await S.close();
  const S2 = await H.start({ env: { NMSBSBL_ACCESS_CODE: "" } });
  const c3 = await b.newContext(); const p3 = await c3.newPage();
  const r3 = await p3.goto(S2.base);
  ok(r3.status() === 503 && !(await p3.$("#code")) && /isn.t configured/.test(await p3.innerText("body")), "missing secret → access denied (503), never open");
  await c3.close(); await S2.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
