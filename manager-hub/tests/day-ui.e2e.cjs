/* Manager Hub — Describe Your Day, in the real app: describe → preview → refine → undo/redo → review & save.
   BASE=…/apps/manager-hub/ [MH_ACCESS_CODE=…] node manager-hub/tests/day-ui.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
const PRIMARY = "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame.";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
async function signIn(ctx) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(BASE);
  const r = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign-in failed " + r.status());
}
const blocks = (p) => p.$$eval("#dyPreview .dy-blk, #dyPreview .dy-game", (bs) => bs.map((b) => ({ text: b.innerText.replace(/\s+/g, " ").trim(), cls: b.className })));

(async () => {
  const b = await chromium.launch();
  for (const [w, hgt, tag] of [[1366, 900, "desktop"], [390, 844, "phone"]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: hgt } });
    await signIn(ctx);
    await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await p.reload(); await p.waitForTimeout(700);
    const before = await p.evaluate(() => JSON.stringify(S.sections));

    await p.click("#btnAI"); await p.waitForTimeout(300);
    ok(await p.isVisible("#dayui #dyText"), `${tag}: the Assistant button opens Describe Your Day`);
    await p.fill("#dyText", PRIMARY); await p.click("[data-build]"); await p.waitForTimeout(600);
    const bl = await blocks(p), txt = bl.map((x) => x.text).join(" | ");
    ok(/10:00–10:15 .*Stretch/.test(txt) && bl.find((x) => /Stretch/.test(x.text)).cls.includes("fixed"), `${tag}: stretch fixed at 10:00`);
    ok(/Team Fundamentals/.test(txt) && /Individual Defense/.test(txt), `${tag}: team fundamentals and individual defense scheduled`);
    ok((txt.match(/Batting Practice — Round \d/g) || []).length >= 2 && bl.filter((x) => /Batting Practice/.test(x.text)).every((x) => /30 min/.test(x.text)), `${tag}: BP in 30-minute rounds`);
    ok(/12:30–1:00 .*Pregame Free Time/.test(txt), `${tag}: 30 minutes off 12:30–1:00`);
    ok(/1:00 PM Game/.test(txt), `${tag}: game marked at 1:00 PM`);
    ok(await p.isVisible(".dy-asm"), `${tag}: assumptions shown`);
    ok(/Built-in reader|AI interpreter/.test(await p.innerText("#dayui .mha-head")), `${tag}: says which interpreter read the request`);
    if (process.env.MH_EXPECT_AI) ok(/AI interpreter/.test(await p.innerText("#dayui .mha-head")), `${tag}: the real AI interpreter answered (not the fallback)`);
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: no horizontal overflow`);

    // conversational refinement keeps everything else
    await p.fill("#dyRefine", "Shorten team fundy to 20"); await p.click("[data-refine]"); await p.waitForTimeout(500);
    const t2 = (await blocks(p)).map((x) => x.text).join(" | ");
    ok(/10:15–10:35 Team Fundamentals/.test(t2) && /10:00–10:15 .*Stretch/.test(t2) && /12:30–1:00 .*Pregame Free Time/.test(t2), `${tag}: "shorten team fundy to 20" applied, fixed items unchanged`);
    await p.click("[data-undo]"); await p.waitForTimeout(300);
    ok(/10:15–10:40 Team Fundamentals/.test((await blocks(p)).map((x) => x.text).join(" | ")), `${tag}: undo restores the previous draft`);
    await p.click("[data-redo]"); await p.waitForTimeout(300);
    ok(/10:15–10:35 Team Fundamentals/.test((await blocks(p)).map((x) => x.text).join(" | ")), `${tag}: redo reapplies it`);

    // block tools
    await p.click("#dyPreview .dy-blk:has-text('Individual Defense')"); await p.waitForTimeout(200);
    await p.click("[data-tool=longer]"); await p.waitForTimeout(300);
    ok(/Individual Defense 35 min|Individual Defense.*35 min/.test((await blocks(p)).map((x) => x.text).join(" | ")), `${tag}: +5 on a block lengthens it`);

    // an impossible day: a numeric explanation and one-click alternatives
    p.once("dialog", (d) => d.accept()); await p.click("[data-restart]"); await p.waitForTimeout(300);
    if (await p.isVisible("#dyText")) {
      await p.fill("#dyText", "Start at 9, done by 10:30. Stretch, team defense 45, indy 45, BP 3 rounds of 30.");
      await p.click("[data-build]"); await p.waitForTimeout(500);
      const conf = await p.$$eval(".dy-conf", (cs) => cs.map((c) => c.innerText));
      ok(conf.length > 0 && /\d+\s*(h|min)/.test(conf.join(" ")) && (await p.$$("[data-alt]")).length > 0, `${tag}: overfull day explained with numbers and alternatives`);
      await p.click("[data-alt]"); await p.waitForTimeout(400);
      ok((await p.$$eval(".dy-msg.you", (m) => m.length)) >= 2, `${tag}: an alternative applies in one click`);
    } else ok(false, `${tag}: start over returned to the describe step`);

    // back to the primary day and save it
    p.once("dialog", (d) => d.accept()); await p.click("[data-restart]"); await p.waitForTimeout(300);
    await p.fill("#dyText", PRIMARY); await p.click("[data-build]"); await p.waitForTimeout(500);
    await p.click("[data-accept]"); await p.waitForTimeout(500);
    ok(await p.isVisible("#mhaPublish"), `${tag}: review & save goes to the publish step (diff shown before writing)`);
    await p.click("#mhaPublish"); await p.waitForTimeout(600);
    const saved = await p.evaluate(() => ({ rows: S.sections.flatMap((s) => (s.rows || []).map((r) => `${r.time} ${r.activity}`)), req: !!(S.meta.dayRequest && S.meta.dayRequest.activities) }));
    ok(saved.rows.some((r) => /^10:15 Team Fundamentals/.test(r)) && saved.rows.some((r) => /^10:00 .*Stretch/.test(r)) && saved.rows.some((r) => /^12:30 Pregame Free Time/.test(r)) && saved.req, `${tag}: rows written to the day and the request saved with it`);
    await p.evaluate(() => undo()); await p.waitForTimeout(300);
    ok(await p.evaluate((b) => JSON.stringify(S.sections) === b, before), `${tag}: the app's Undo restores the previous schedule`);

    // interpreter states are told apart: AI answered / AI configured but failed (fallback) / AI not configured
    if (tag === "desktop") {
      const reqFor = await p.evaluate((t) => DayEngine.Solve.normalize(DayEngine.Read.read(t, {})), PRIMARY);
      for (const [label, route, want] of [
        ["AI answered", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request: Object.assign({}, reqFor, { source: "ai" }), model: "test", ms: 900, usage: {} }) }), /AI interpreter/],
        ["AI configured but timed out", (r) => r.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "timeout" }) }), /AI unavailable/],
        ["AI not configured", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not-configured" }) }), /^Built-in reader$/m]
      ]) {
        const c2 = await b.newContext({ viewport: { width: 1366, height: 900 } });
        await signIn(c2);
        await c2.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
        await c2.route("**/api/interpret", route);
        const q = await c2.newPage();
        await q.goto(BASE); await q.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await q.reload(); await q.waitForTimeout(500);
        await q.click("#btnAI"); await q.fill("#dyText", PRIMARY); await q.click("[data-build]"); await q.waitForTimeout(500);
        const chip = (await q.locator("#dayui .mha-chip").innerText()).trim();
        const fb = await q.locator(".dy-fallback").count();
        ok(want.test(chip) && (label === "AI configured but timed out" ? fb === 1 : fb === 0) && (await q.locator("#dyPreview .dy-blk").count()) > 4, `${label}: shown as “${chip}”${fb ? " with a fallback notice" : ""}, day still built`);
        await c2.close();
      }
    }

    // the classic assistant is still there
    await p.click("#btnAI"); await p.waitForTimeout(200); await p.click("[data-classic]").catch(() => {}); await p.waitForTimeout(300);
    ok(await p.isVisible("#mha #mhaText"), `${tag}: classic assistant still opens`);
    ok(errs.length === 0, `${tag}: no page errors ${errs.join(" | ")}`);
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
