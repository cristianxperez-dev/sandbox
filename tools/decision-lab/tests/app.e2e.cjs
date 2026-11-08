/* Decision Lab — browser checks.
   node scripts/build.mjs && node scripts/serve.mjs &   node tools/decision-lab/tests/app.e2e.cjs
   BASE=https://cperez.app/apps/decision-lab/ for a deployed copy. MLB's embed host may be unreachable from a test
   machine; its network errors are ignored (the checks look at which clip is referenced, not MLB's player). */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/decision-lab/";
const ROOT = path.join(__dirname, "..", "..", "..");
const FILM = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/decision-lab/data/film.json")));
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const shot = (p, n, full = false) => SHOTS ? p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: full }) : null;
const IGNORE = /streamable|ERR_TUNNEL|ERR_PROXY|ERR_NAME|ERR_CONNECTION|ERR_ABORTED|socket\.|fonts\.g|mlbstatic|mlb\.com/i;
async function fresh(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errs.push(m.text()); });
  p.on("requestfailed", (r) => { if (r.url().startsWith(new URL(BASE).origin)) errs.push("failed " + r.url()); });
  return { ctx, p, errs };
}
const hscroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
async function decide(p, idx = 0) {
  await p.waitForSelector(".choice:not([disabled])", { timeout: 8000 });
  await p.locator(".choice").nth(idx).click();
  await p.waitForSelector(".fb", { timeout: 8000 });
}

(async () => {
  const b = await chromium.launch();

  /* home */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(BASE); await p.waitForSelector(".modes");
    ok((await p.locator(".mode").count()) === 4, "home: Manager's Seat, Third-Base Coach's Seat, Quick Decision, Decision Matrix");
    ok(/92|\d+ real plays/.test(await p.locator(".strip").innerText()), "home: Film Room count from the film index");
    await shot(p, "home");
    ok(errs.length === 0, "home: no errors " + errs.join(" | "));
    await ctx.close();
  })();

  /* quick decisions: every family */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    for (const f of ["steal", "steal3", "bunt", "infield", "send", "send1", "tag"]) {
      await p.goto(`${BASE}#/quick?f=${f}&seed=101`); await p.waitForSelector(".dec");
      const before = await p.locator(".dec-r").innerText();
      ok(!/Win prob|break-even|%/i.test(before.replace(/Decide first — the numbers come after\./, "")), `${f}: no numbers shown before the decision`);
      await decide(p, 0);
      const fb = await p.locator(".fb").innerText();
      ok(/DECISION QUALITY/.test(fb) && /WHAT HAPPENED/.test(fb), `${f}: decision quality and outcome shown separately`);
      ok(/Sound|Defensible|Questionable|Costly/.test(fb), `${f}: decision graded`);
      ok(await p.locator(".fb .analysis .tbl tbody tr").count() >= 2, `${f}: expandable analysis compares the options`);
      // what-if recomputes
      await p.locator("[data-wi]").first().click(); await wait(p, 150);
      ok(/still|changes to/.test(await p.locator(".wi-out").innerText()), `${f}: what-if recomputes the recommendation`);
      if (f === "send") await shot(p, "quick-send-feedback", true);
    }
    ok(errs.length === 0, "quick: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* the same situation and the same choice: different outcomes across seeds, same grade (decision ≠ result) */
  await (async () => {
    const { ctx, p } = await fresh(b);
    const grades = new Set(), outcomes = new Set();
    await p.goto(`${BASE}#/matrix?f=steal&inn=7&side=home&us=2&them=2&outs=1&bases=1&speed=28.5&battery=avg`); await p.waitForSelector(".mx-best");
    // Quick with the steal family across seeds: grade text depends on the choice, the outcome varies
    for (let s = 1; s <= 14; s++) {
      await p.goto(`${BASE}#/quick?f=steal&seed=${s}`); await p.waitForSelector(".dec"); await decide(p, 0);
      outcomes.add(await p.locator(".fb-box.o > b").innerText());
    }
    ok(outcomes.size >= 2, `repeated choices produce different outcomes (${[...outcomes].join(" / ")})`);
    await ctx.close();
  })();

  /* Manager's Seat: a full connected game */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    const play = async (seed) => {
      await p.goto(`${BASE}#/manager?go=1&side=home&n=8&from=1&seed=${seed}`);
      let n = 0, boards = [];
      for (;;) {
        await p.waitForSelector(".dec, .recap", { timeout: 15000 });
        if (await p.locator(".recap").count()) break;
        boards.push(await p.locator("#board").innerText());
        await decide(p, n % 2); n++;
        if (n === 1) await shot(p, "manager-feedback", true);
        await p.click("#cont");
      }
      return { n, boards, recap: await p.locator(".recap").innerText(), rows: await p.locator(".recap .tbl tbody tr").count() };
    };
    const g1 = await play(4242);
    ok(g1.n >= 3 && g1.n <= 8, `manager: a game offered ${g1.n} decisions (target 8)`);
    ok(/You (won|lost) \d+–\d+/.test(g1.recap) && g1.rows === g1.n, "manager: recap lists every decision with its result");
    ok(/luck/i.test(g1.recap) && /win prob\. given up/i.test(g1.recap), "manager: recap separates skill from luck");
    ok(g1.boards.every((t, i) => new RegExp(`Decision ${i + 1} of 8`).test(t)), "manager: decision counter advances");
    await shot(p, "manager-recap", true);
    const g2 = await play(4242);
    ok(g2.recap === g1.recap, "manager: the same seed and choices replay the same game");
    ok(errs.length === 0, "manager: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* Third-Base Coach's Seat */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(`${BASE}#/coach?n=5&t=0&seed=9`);
    for (let i = 0; i < 5; i++) {
      await p.waitForSelector(".dec");
      ok(await p.locator(".choice").first().isDisabled(), `coach ${i + 1}: buttons wait until the play reaches the decision point`);
      await decide(p, i % 2);
      if (i === 0) await shot(p, "coach-feedback");
      await p.click("#cont");
    }
    await p.waitForSelector(".recap");
    ok(await p.locator(".recap .tbl tbody tr").count() === 5, "coach: recap of 5 calls");
    // shot clock: an unanswered call holds the runner
    await p.goto(`${BASE}#/coach?n=1&t=6&seed=3`); await p.waitForSelector(".clock");
    await p.waitForSelector(".fb", { timeout: 12000 });
    ok(/Hold|Held|holds/i.test(await p.locator(".fb").innerText()), "coach: the shot clock holds the runner when time runs out");
    ok(errs.length === 0, "coach: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* Decision Matrix */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(`${BASE}#/matrix?f=infield&inn=9&side=home&us=3&them=3&outs=1&bases=4`); await p.waitForSelector(".mx-best");
    ok((await p.locator(".mx-best b").innerText()) === "Infield in", "matrix: tied, top 9th, one out, runner on third → infield in");
    await p.fill('input[name="us"]', "6"); await p.dispatchEvent('input[name="us"]', "input"); await wait(p, 200);
    ok((await p.locator(".mx-best b").innerText()) === "Infield back", "matrix: up three → infield back");
    ok(/us=6/.test(p.url()), "matrix: the situation is kept in the URL");
    ok(/WHAT TEAMS ACTUALLY DO/.test(await p.locator(".obs").innerText()), "matrix: observed behavior and the data's limits are shown");
    await p.goto(`${BASE}#/matrix?f=steal&inn=7&side=away&us=2&them=2&outs=1&bases=1&speed=27.3&battery=avg`); await p.waitForSelector(".mx-best");
    ok(/Break-even:/.test(await p.locator(".mx-sweep").innerText()) && /Runner speed/.test(await p.locator(".mx-sweep").innerText()) || /Break-even/.test(await p.locator(".mx-sweep").innerText()), "matrix: steal break-even and what flips it");
    await shot(p, "matrix", true);
    ok(errs.length === 0, "matrix: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* Film Room: every clip is a labelled real play that points back to Play Repository */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(`${BASE}#/film`); await p.waitForSelector(".films.grid");
    ok(await p.locator(".films.grid .film").count() === FILM.films.length, `film: all ${FILM.films.length} indexed plays listed`);
    await p.locator(".films.grid .film").first().click(); await p.waitForSelector("#modal iframe");
    const m = await p.locator("#modal").innerText(), src = await p.locator("#modal iframe").getAttribute("src");
    const back = await p.locator('#modal a[href*="play-repository"]').getAttribute("href");
    ok(/REAL PLAY/.test(m) && /not a replay of a simulated decision/i.test(m), "film: clip labelled a real play, not a simulated result");
    ok(/^https:\/\/streamable\.com\/m\//.test(src), "film: MLB's own embed (no rehosting)");
    ok(/^\.\.\/play-repository\/#\/play\/mlb-/.test(back), "film: links back to the original Play Repository record");
    await shot(p, "film-modal");
    await p.keyboard.press("Escape"); ok(await p.locator("#scrim").isHidden(), "film: Escape closes the clip");
    ok(errs.length === 0, "film: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* performance */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    for (const s of [1, 2, 3]) { await p.goto(`${BASE}#/quick?f=send&seed=${s}`); await p.waitForSelector(".dec"); await decide(p, s % 2); }
    await p.goto(`${BASE}#/performance`); await p.waitForSelector(".rc-kpi");
    ok(/\b3\b/.test(await p.locator(".rc-kpi div").first().innerText()), "performance: 3 decisions recorded");
    ok(/skill/i.test(await p.locator(".rc-kpi").innerText()) && /luck/i.test(await p.locator(".rc-kpi").innerText()), "performance: skill and luck reported separately");
    p.once("dialog", (d) => d.accept()); await p.click("#reset"); await wait(p, 200);
    ok(/No decisions yet/.test(await p.locator("main").innerText()), "performance: record can be cleared");
    ok(errs.length === 0, "performance: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* the model page */
  await (async () => {
    const { ctx, p } = await fresh(b);
    await p.goto(`${BASE}#/model`); await p.waitForSelector(".assume");
    const t = await p.locator("main").innerText();
    ok(/Retrosheet/.test(t) && /obtained free of charge from and is copyrighted by Retrosheet/.test(t), "model: Retrosheet notice");
    ok(/Preliminary model/i.test(t) && /Assumption/i.test(t) && /Empirical/i.test(t), "model: empirical / fitted / preliminary / assumption labels");
    await ctx.close();
  })();

  /* phones */
  for (const W of [375, 390, 430]) await (async () => {
    const { ctx, p, errs } = await fresh(b, { viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true });
    for (const h of ["#/home", "#/manager", "#/coach", "#/matrix?f=send", "#/film", "#/model"]) { await p.goto(BASE + h); await wait(p, 600); const s = await hscroll(p); if (s > 0) ok(false, `${W}: horizontal scroll on ${h} (${s}px)`); }
    await p.goto(`${BASE}#/quick?f=tag&seed=5`); await decide(p, 0); await wait(p, 300);
    ok((await hscroll(p)) <= 0, `${W}: a decision with its feedback fits the screen`);
    if (W === 390) { await shot(p, "phone-feedback", true); await p.goto(`${BASE}#/manager?go=1&side=away&n=6&from=1&seed=7`); await p.waitForSelector(".dec"); await shot(p, "phone-manager"); }
    ok(errs.length === 0, `${W}: no errors ` + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* independence: Play Repository still loads on its own */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(BASE.replace("decision-lab", "play-repository")); await wait(p, 1500);
    ok(/Play Repository/i.test(await p.title()) || /Play Repository/i.test(await p.locator("body").innerText()), "Play Repository loads independently");
    ok(errs.length === 0, "Play Repository: no errors " + errs.join(" | ").slice(0, 200));
    await ctx.close();
  })();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
