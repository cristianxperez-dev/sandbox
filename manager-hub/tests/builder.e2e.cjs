/* Manager Hub — affiliate page → date → Build Daily Schedule (manual / described / voice), game-day defaults,
   recalculation, TBD, doubleheaders, drafts vs published, the Complex workspace, phone layout.
   BASE=…/apps/manager-hub/ [MH_ACCESS_CODE=…] node manager-hub/tests/builder.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
async function signIn(ctx) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(BASE);
  const r = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign-in failed " + r.status());
}
const f = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
const items = (p) => p.evaluate(() => DayUI.state.plan.items.filter((i) => i.kind !== "free").map((i) => ({ s: i.start, e: i.end, l: i.label, k: i.kind })));
const rows = (p) => p.evaluate(() => S.sections.flatMap((s) => s.rows.map((r) => `${r.time} ${r.activity}`)));

async function open(b, aff, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1440, height: 950 }, timezoneId: "America/New_York" }, opts.ctx || {}));
  await signIn(ctx);
  if (opts.init) await ctx.addInitScript(opts.init);
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("response", (r) => { if (r.status() >= 400 && !/\/api\/(settings|usage|interpret)$/.test(r.url())) errs.push(r.status() + " " + r.url()); });
  await p.goto(BASE); await p.evaluate((a) => { localStorage.clear(); localStorage.setItem("cs.affiliate", a); }, aff); await p.reload(); await wait(p, 2200);
  await p.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.style.display = "none"; });
  return { ctx, p, errs };
}
async function pickAndBuild(p, iso, how) {
  await p.evaluate((d) => { go("hub"); HubPlanner.pick(d); renderHub(); }, iso); await wait(p, 250);
  await p.click('#hubPlan [data-plb="build"]'); await wait(p, 150);
  await p.click(`#hubPlan [data-plb="${how}"]`); await wait(p, 600);
}

(async () => {
  const b = await chromium.launch();
  /* ------------------------------------------------ 1–9: Fayetteville, a 6:30 PM home game */
  {
    const { ctx, p, errs } = await open(b, "fay");
    const sel = await p.evaluate(() => ({ sel: HubPlanner.date, today: Today.iso(), card: document.querySelector("#hubPlan .pl-card").innerText }));
    ok(sel.sel === sel.today && /today/i.test(sel.card), `1. the affiliate page opens on today (${sel.today})`);
    const game = await p.evaluate(() => Games.all().find((g) => g.time === "18:30" && g.homeAway === "home" && g.date > Today.iso()));
    ok(!!game, `a future 6:30 PM home game exists (${game && game.date} vs ${game && game.opponent})`);
    await p.evaluate((d) => { HubPlanner.pick(d); renderHub(); }, game.date); await wait(p, 250);
    const card = await p.locator("#hubPlan .pl-card").innerText();
    ok(card.includes(game.opponent) && /6:30 PM/.test(card) && /No schedule yet/i.test(card), "2. selecting the date shows its game and that nothing is scheduled yet");
    ok(await p.isVisible('#hubPlan [data-plb="build"]'), "3. Build Daily Schedule is the primary action");
    await p.click('#hubPlan [data-plb="build"]'); await wait(p, 150);
    ok(await p.isVisible('#hubPlan [data-plb="manual"]') && await p.isVisible('#hubPlan [data-plb="describe"]') && await p.isVisible('#hubPlan [data-plb="voice"]') && await p.isVisible('#hubPlan [data-plb="empty"]'), "three ways to build + Start empty");
    const before = await p.evaluate(() => JSON.stringify(S.sections));
    await p.click('#hubPlan [data-plb="manual"]'); await wait(p, 600);
    let it = await items(p);
    ok(JSON.stringify(it.map((i) => `${f(i.s)}–${f(i.e)} ${i.l}`)) === JSON.stringify(["4:00–4:45 Home BP", "4:45–5:30 Visitor BP", "6:10–6:20 Pregame Warmup", "6:20–6:30 Anthem", `6:30–6:30 Game vs ${game.opponent}`]), "4–5. Build manually: the four standard activities at the right times, the game separate: " + it.map((i) => `${f(i.s)}–${f(i.e)} ${i.l}`).join(", "));
    ok(await p.evaluate((b0) => JSON.stringify(S.sections) === b0, before), "nothing is written to the day until it's published");
    // 7. edit and remove a default
    await p.click('#dyPreview .dy-blk:has-text("Pregame Warmup")'); await wait(p, 150);
    await p.fill('[data-ef="dur"]', "15"); await p.dispatchEvent('[data-ef="dur"]', "change"); await wait(p, 250);
    await p.click('#dyPreview .dy-blk:has-text("Anthem")'); await wait(p, 150); await p.click('#dyPreview [data-tool="remove"]'); await wait(p, 250);
    it = await items(p);
    ok(it.find((i) => i.l === "Pregame Warmup").e - it.find((i) => i.l === "Pregame Warmup").s === 15 && !it.some((i) => i.l === "Anthem"), "7. a default activity can be edited (warmup 15 min) and removed (anthem)");
    // add an activity with the form, then undo it
    await p.click(".dy-add summary"); await p.fill("#dyaLabel", "Defensive Meeting"); await p.fill("#dyaAt", "15:30"); await p.fill("#dyaDur", "15"); await p.click("[data-addact]"); await wait(p, 300);
    ok((await items(p)).some((i) => i.l === "Defensive Meeting" && i.s === 930), "Add activity puts it at the chosen time");
    await p.click("#dayui [data-undo]"); await wait(p, 200);
    ok(!(await items(p)).some((i) => i.l === "Defensive Meeting"), "Undo takes it back");
    // drag Home BP 15 minutes later (snap to 5)
    const hb = await p.locator('#dyPreview .dy-blk:has-text("Home BP")').boundingBox();
    await p.mouse.move(hb.x + hb.width / 2, hb.y + 10); await p.mouse.down(); await p.mouse.move(hb.x + hb.width / 2, hb.y + 10 + 33, { steps: 6 }); await p.mouse.up(); await wait(p, 300);
    ok((await items(p)).find((i) => i.l === "Home BP").s === 975, "dragging a block moves it in 5-minute steps (Home BP 4:15)");
    await p.click("#dayui [data-undo]"); await wait(p, 200);
    // 8. save draft, reopen without duplication
    await p.click("#dayui [data-savedraft]"); await wait(p, 200);
    await p.click("#dayui [data-close]"); await p.evaluate(() => { go("hub"); renderHub(); }); await wait(p, 250);
    ok(/Draft/.test(await p.locator("#hubPlan .pl-st").innerText()) && /Edit Daily Schedule/.test(await p.locator("#hubPlan .pl-card").innerText()), "8. saved as a draft; the action becomes Edit Daily Schedule");
    await p.click('#hubPlan [data-plb="edit"]'); await wait(p, 500);
    it = await items(p);
    ok(it.filter((i) => i.l === "Home BP").length === 1 && it.filter((i) => i.l === "Visitor BP").length === 1 && !it.some((i) => i.l === "Anthem"), "reopening the draft keeps the edits and adds nothing twice");
    // publish (review step first), then reopen + publish again: still no duplicates
    await p.click("#dayui [data-accept]"); await wait(p, 400);
    ok(await p.isVisible("#mhaPublish"), "Publish goes through the review step");
    await p.click("#mhaPublish"); await wait(p, 500);
    let r = await rows(p);
    ok(r.length === 4 && r.some((x) => /Home BP/.test(x)) && r.some((x) => /First Pitch/.test(x)), `published rows: ${r.join(" · ")}`);
    await p.evaluate(() => { go("hub"); renderHub(); }); await wait(p, 200);
    ok(/Published/.test(await p.locator("#hubPlan .pl-st").innerText()), "status: Published");
    await p.click('#hubPlan [data-plb="edit"]'); await wait(p, 400); await p.click("#dayui [data-accept]"); await wait(p, 300); await p.click("#mhaPublish"); await wait(p, 400);
    ok((await rows(p)).length === 4, "publishing again replaces the rows (no duplicates)");
    // 6. the game moves to 7:05 → offer to recalculate; the customised warmup is kept unless approved
    await p.evaluate((id) => Games.upsert({ id, time: "19:05" }), game.id);
    await p.evaluate(() => { go("hub"); renderHub(); }); await wait(p, 150);
    await p.click('#hubPlan [data-plb="edit"]'); await wait(p, 500);
    ok(await p.isVisible(".dy-recalc") && /7:05 PM/.test(await p.locator(".dy-recalc").innerText()), "6. a changed game time offers to recalculate");
    await p.click('[data-recalc="untouched"]'); await wait(p, 300);
    it = await items(p);
    ok(it.find((i) => i.l === "Home BP").s === 1145 - 150 && it.find((i) => i.l === "Visitor BP").s === 1145 - 105 && it.find((i) => i.l === "Pregame Warmup").s === 1110 - 20, "untouched activities follow the new first pitch; the customised warmup stays");
    ok(it.some((i) => i.k === "game" && i.s === 1145), "the game marker moved to 7:05");
    await p.click("#dayui [data-close]");
    // 9. an off day: a clean, empty timeline
    const off = await p.evaluate(() => { let d = Today.iso(); for (let i = 1; i < 400; i++) { const x = DateCore.addDays(d, i); if (!Games.listForDate(x).length) return x; } return null; });
    await pickAndBuild(p, off, "manual");
    ok((await items(p)).length === 0 && /No game on this date/.test(await p.locator("#dayui .dy-log").innerText()), "9. an off day opens a clean, empty manual schedule");
    await p.click(".dy-add summary"); await p.fill("#dyaLabel", "Lift"); await p.fill("#dyaAt", "10:00"); await p.fill("#dyaDur", "45"); await p.click("[data-addact]"); await wait(p, 300);
    ok((await items(p)).some((i) => i.l === "Lift" && i.s === 600 && i.e === 645), "an off-day activity can be added");
    await p.click("#dayui [data-close]");
    ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  }

  /* ------------------------------------------------ 10–12: described by text and by voice (built-in reader here) */
  {
    const init = () => {
      class FakeRec { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "catchers report at two pitchers stretch at three and everybody finishes early work before batting practice" }], { isFinal: true })] }), 60); setTimeout(() => this.onend && this.onend(), 120); } stop() { this.onend && this.onend(); } }
      window.SpeechRecognition = FakeRec;
    };
    const { ctx, p, errs } = await open(b, "fay", { init });
    const game = await p.evaluate(() => Games.all().find((g) => g.time === "18:30" && g.homeAway === "home" && g.date > Today.iso()));
    const before = await p.evaluate(() => JSON.stringify(S.sections));
    await pickAndBuild(p, game.date, "describe");
    ok(await p.isVisible("#dyText") && /stay unless you say otherwise/.test(await p.locator(".dy-keep").innerText()), "Describe your day: the standard activities are already on the timeline and stay");
    await p.fill("#dyText", "Catchers report at 1:30, hitters have early work at 2:00, pitchers stretch at 3:00, and add a defensive meeting before BP.");
    await p.click("[data-build]");
    await p.waitForFunction(() => DayUI.state && DayUI.state.text, null, { timeout: 45000 }); await wait(p, 300);   // the AI interpreter takes a few seconds
    const it = await items(p);
    ok(it.some((i) => i.s === 810) && it.some((i) => /Early Work/i.test(i.l) && i.s === 840) && it.some((i) => /Stretch/.test(i.l) && i.s === 900), "10. typed instructions → proposal with the catchers' report (1:30), early work (2:00), pitchers' stretch (3:00)");
    ok(it.some((i) => i.l === "Visitor BP") && it.some((i) => i.l === "Anthem") && it.some((i) => i.l === "Pregame Warmup"), "the standard game-day activities are kept");
    const meet = it.find((i) => /Meeting/.test(i.l)), bp1 = it.filter((i) => /Batting Practice|^BP/.test(i.l)).sort((x, y) => x.s - y.s)[0];
    ok(meet && bp1 && meet.e === bp1.s, `the defensive meeting sits right before BP (${meet && f(meet.s)}–${meet && f(meet.e)}, BP ${bp1 && f(bp1.s)}) · interpreter: ${await p.evaluate(() => DayUI.state.interpreter)}`);
    ok(it.filter((i) => /BP|Batting Practice/.test(i.l)).length >= 2 && !it.some((i) => i.l === "Home BP" && it.some((j) => /Batting Practice/.test(j.l) && j.s !== 960)), "our BP took the Home BP slot instead of a second BP");
    ok(await p.evaluate((b0) => JSON.stringify(S.sections) === b0, before), "12. the proposal changes nothing until it's published");
    await p.click("#dayui [data-close]");
    // 11. voice
    await p.evaluate(() => { go("hub"); renderHub(); }); await wait(p, 150);
    await p.click('#hubPlan [data-plb="build"]'); await wait(p, 100); await p.click('#hubPlan [data-plb="voice"]'); await wait(p, 700);
    const tr = await p.inputValue("#dyText");
    ok(/catchers report at/.test(tr), `11. voice: dictation lands in the editable text first (“${tr.slice(0, 60)}…”)`);
    await p.click("[data-build]"); await p.waitForFunction(() => DayUI.state && DayUI.state.text, null, { timeout: 45000 }); await wait(p, 300);
    ok((await items(p)).some((i) => i.s === 840) && (await p.evaluate((b0) => JSON.stringify(S.sections) === b0, before)), "the dictated day is built as a proposal; nothing published");
    ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  }

  /* ------------------------------------------------ TBD and doubleheaders */
  {
    const { ctx, p, errs } = await open(b, "sl");
    const day = await p.evaluate(() => { let d = Today.iso(); for (let i = 10; i < 400; i++) { const x = DateCore.addDays(d, i); if (!Games.listForDate(x).length) return x; } return null; });
    await p.evaluate((d) => { Games.upsert({ id: "tbd1", date: d, opponent: "Test Club", homeAway: "home", time: "", timeTBD: true }); }, day);
    await pickAndBuild(p, day, "manual");
    ok(await p.isVisible("#dyTbd") && (await p.evaluate(() => !DayUI.state)), "TBD game: asks for first pitch, invents nothing");
    await p.fill("#dyTbd", "19:00"); await p.click("[data-tbd]"); await wait(p, 300);
    ok((await items(p)).find((i) => i.l === "Home BP").s === 1140 - 150, "after entering 7:00 PM the game-day activities appear");
    await p.click("#dayui [data-close]");
    const dh = DateCoreAdd(day, 1);
    await p.evaluate((d) => { Games.upsert({ id: "dh1", date: d, opponent: "Club A", homeAway: "home", time: "13:05", gameNumber: 1 }); Games.upsert({ id: "dh2", date: d, opponent: "Club A", homeAway: "home", time: "18:05", gameNumber: 2, doubleheader: true }); }, dh);
    await pickAndBuild(p, dh, "manual");
    ok((await p.locator("[data-anchor]").count()) === 2, "doubleheader: the manager chooses which game anchors the routine");
    await p.click('[data-anchor="dh2"]'); await wait(p, 300);
    ok((await items(p)).find((i) => i.l === "Home BP").s === 1085 - 150, "built around game 2 (6:05 PM)");
    await p.click("#dayui [data-close]");
    ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  }

  /* ------------------------------------------------ 13: the Complex workspace */
  {
    const { ctx, p, errs } = await open(b, "fcl");
    ok(await p.isVisible('.seg button[data-view="camp"]') && /camps/i.test(await p.locator('.seg button[data-view="camp"]').innerText()), "13. Complex: the Camps tab (org-wide players, groups, facilities) is here");
    await p.click('.seg button[data-view="camp"]'); await wait(p, 400);
    ok(await p.isVisible("#campRoot") && (await p.locator("#campRoot").innerText()).length > 20, "Camps opens");
    await p.evaluate(() => go("hub")); await wait(p, 200);
    ok(/Workout day/i.test(await p.locator("#hubPlan .pl-card").innerText()), "Complex: a day without a game is a workout day");
    await pickAndBuild(p, await p.evaluate(() => Today.iso()), "manual");
    const it = await items(p);
    ok(it.length >= 5 && it[0].l === "Staff Meeting" && it.some((i) => i.l === "Conditioning") && !it.some((i) => /BP/.test(i.l)), "Complex Build manually starts from the workout day, not game-day activities");
    await p.click("#dayui [data-close]");
    // the other workspaces have no Camps tab
    await p.evaluate(() => { localStorage.setItem("cs.affiliate", "cc"); }); await p.reload(); await wait(p, 1500);
    ok(!(await p.isVisible('.seg button[data-view="camp"]')), "the four affiliates don't show Camps (one entry point: Complex)");
    ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  }

  /* ------------------------------------------------ 14: phone */
  {
    const { ctx, p, errs } = await open(b, "fay", { ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "14. phone: affiliate page fits (no sideways scroll)");
    const pb = await p.locator("#hubPlan .pl-build").boundingBox();
    ok(pb && pb.y < 844, "phone: Build Daily Schedule is on the first screen");
    const game = await p.evaluate(() => Games.all().find((g) => g.time === "18:30" && g.date > Today.iso()));
    await pickAndBuild(p, game.date, "manual");
    ok((await items(p)).some((i) => i.l === "Home BP") && !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "phone: the builder opens with the game-day activities and fits");
    await p.click('#dyPreview .dy-blk:has-text("Visitor BP")'); await wait(p, 150);
    ok(await p.isVisible('[data-ef="at"]'), "phone: a block's time can be edited in place");
    ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
function DateCoreAdd(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
