/* Manager Hub — customizable dashboard (Hub view): widgets, customize mode, persistence.
   BASE=…/apps/manager-hub/ [MH_ACCESS_CODE=…] node manager-hub/tests/dashboard.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
async function signIn(ctx) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(BASE);
  const r = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign-in failed " + r.status());
}
const order = (p) => p.$$eval("#hubGrid .dash-w", (ws) => ws.map((w) => w.dataset.w));

(async () => {
  const b = await chromium.launch();
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await signIn(ctx);
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await p.reload(); await p.waitForTimeout(1200);
    const def = await order(p);
    const campReady = await p.evaluate(() => !!(window.CampUI && CampUI.ready));
    const N = 4;                                         // Camps appear in the Complex workspace only; Day schedule / Describe start hidden (the day planner covers them)
    ok(def.join() === "games,roster,month,modules", `default widgets in order (${def.join(", ")})`);
    ok(await p.isVisible("#hubPlan .pl-build"), "the day planner leads the page");
    ok(!(await p.isVisible('.seg button[data-view="camp"]')), "Camps tab only in the Complex workspace");
    ok(!(await p.$("#mhaIntro")), "no old intro card");
    ok(!(await p.$(".dash-grip")) && !(await p.$(".dash-editbar")), "no editing controls outside customize mode");
    ok((await p.locator(".dash-w[data-w=roster] .dash-stats").count()) === 1, "roster widget shows real roster counts");

    await p.click("#dashCustomize"); await p.waitForTimeout(200);
    ok(await p.isVisible(".dash-editbar") && (await p.$$(".dash-grip")).length === N, "customize mode: edit bar and a drag handle per widget");
    // hide, then add back
    await p.click('[data-hide="games"]'); await p.waitForTimeout(150);
    ok(!(await order(p)).includes("games"), "hide removes a widget");
    await p.click('[data-dash="add"]'); await p.click('[data-dash-add="games"]'); await p.waitForTimeout(150);
    ok((await order(p)).slice(-1)[0] === "games", "Add widget brings it back (at the end)");
    // move with buttons (accessible alternative)
    await p.click('[data-move="-1"][data-id="games"]'); await p.waitForTimeout(150);
    let o = await order(p); ok(o.indexOf("games") === o.length - 2, "arrow button moves a widget one place");
    // keyboard on the handle
    await p.focus('[data-grip="games"]'); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(150);
    o = await order(p); ok(o.indexOf("games") === o.length - 3 && (await p.evaluate(() => document.activeElement && document.activeElement.dataset.grip)) === "games", "arrow keys on the handle move it and keep focus");
    // resize
    const before = await p.getAttribute('.dash-w[data-w="roster"]', "class");
    await p.click('[data-size="roster"]'); await p.waitForTimeout(150);
    const after = await p.getAttribute('.dash-w[data-w="roster"]', "class");
    ok(/size-s/.test(before) && /size-m/.test(after), "width cycles Small → Medium");
    // drag the Next 7 days widget to the top
    await p.locator("#hubGrid").scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -40));
    const grip = await p.locator('[data-grip="month"]').boundingBox(), first = await p.locator(".dash-w").first().boundingBox();
    await p.mouse.move(grip.x + 8, grip.y + 8); await p.mouse.down();
    await p.mouse.move(first.x + 40, first.y + 20, { steps: 12 }); await p.mouse.move(first.x + 30, first.y + 12, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(250);
    o = await order(p); ok(o[0] === "month", `drag and drop reorders (${o.slice(0, 3).join(", ")}…)`);
    await p.click('[data-dash="done"]'); await p.waitForTimeout(150);
    ok(!(await p.$(".dash-grip")) && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === "dashCustomize", "Done leaves customize mode and returns focus");

    // persistence: reload and switch affiliate
    const saved = await order(p);
    await p.reload(); await p.waitForTimeout(900);
    ok((await order(p)).join() === saved.join() && /size-m/.test(await p.getAttribute('.dash-w[data-w="roster"]', "class")), "layout and sizes survive a reload");
    await p.evaluate(() => localStorage.setItem("cs.affiliate", "fay")); await p.reload(); await p.waitForTimeout(900);
    ok((await order(p)).join() === saved.join(), "layout is a personal preference across affiliates in this browser");
    // reset
    await p.click("#dashCustomize"); p.once("dialog", (d) => d.accept()); await p.click('[data-dash="reset"]'); await p.waitForTimeout(150);
    ok((await order(p)).join() === def.join(), "Reset restores the default layout");
    await p.click('[data-dash="done"]');
    // widgets link into the app
    await p.click('#hubPlan [data-plb="build"]'); await p.waitForTimeout(250);
    ok(await p.isVisible('#hubPlan [data-plb="manual"]') && await p.isVisible('#hubPlan [data-plb="voice"]'), "Build Daily Schedule offers build manually / describe / voice");
    await p.click('#hubPlan [data-plb="cancel"]');
    // empty dashboard state
    await p.evaluate(() => { localStorage.setItem("cs.dashboard.v1", JSON.stringify({ order: [], hidden: ["today", "describe", "roster", "games", "month", "camp", "modules"], size: {} })); go("hub"); });
    await p.waitForTimeout(200);
    ok(await p.isVisible(".dash-empty"), "all widgets hidden → a useful empty state");
    // corrupt preference never breaks the hub
    await p.evaluate(() => { localStorage.setItem("cs.dashboard.v1", "{not json"); go("hub"); }); await p.waitForTimeout(200);
    ok((await order(p)).length === N, "corrupt preference falls back to the default layout");
    ok(errs.length === 0, "no page errors " + errs.join(" | "));
    await ctx.close();
  }
  for (const [w, h, tag] of [[820, 1180, "tablet"], [390, 844, "phone"]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await signIn(ctx);
    const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await p.reload(); await p.waitForTimeout(1000);
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: no horizontal overflow`);
    await p.click("#dashCustomize"); await p.waitForTimeout(150);
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) && await p.isVisible('[data-move="1"][data-id="games"]'), `${tag}: customize mode fits, move buttons usable`);
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
