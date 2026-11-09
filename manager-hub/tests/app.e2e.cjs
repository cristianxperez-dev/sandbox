// Manager Hub + Schedule Assistant — end-to-end tests against the real app.
// Run: node scripts/build.mjs && node scripts/serve.mjs &  then  node manager-hub/tests/app.e2e.cjs
// BASE=<url> to point it at another server.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";

/* behind the Sandbox access gate: sign the browser context in first (MH_ACCESS_CODE; never stored in the repo) */
async function signIn(ctx, base) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(base), app = u.pathname.replace(/[^/]*$/, "");
  const r = await ctx.request.post(u.origin + app + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("access gate sign-in failed: " + r.status());
}
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const DAY = "Report at 8:00. Two position player groups and two pitcher groups. Team meeting at 7:45. Pitchers throw first, then bullpens and PFP. Blue starts on defense while Orange begins in the cages. Everyone gets on-field BP after rotations. First pitch at 12:05, and bullpens should finish before BP begins.";

async function fresh(b, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }, opts.ctx || {}));
  await signIn(ctx, BASE);
  // these checks control the roster themselves: the shipped organisation roster is tested separately
  await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
  if (opts.init) await ctx.addInitScript(opts.init);
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
  p.on("requestfailed", (r) => !r.url().startsWith("blob:") && !r.url().startsWith("data:") && errs.push("requestfailed: " + r.url()));
  p.on("response", (r) => r.status() >= 400 && !r.url().includes("/__mha_ai") && errs.push(`${r.status()} ${r.url()}`));
  p.on("dialog", (d) => d.accept(opts.prompt || "Test"));
  await p.goto(BASE); await wait(p, 600);
  if (await p.locator("#affGate").isVisible()) { await p.locator("#affGateList button", { hasText: "FCL" }).first().click(); await wait(p, 700); }
  return { ctx, p, errs };
}
const draft = (p, mine) => p.evaluate((mine) => { const d = MHAssistUI.draft; return d ? d.events.concat(d.keepOthers && !mine ? d.kept : []).map((e) => ({ id: e.id, g: e.group, a: e.activity, s: e.start, e: e.end, d: e.dur, l: e.location, st: e.staff })) : null; }, !!mine);
const minOf = (list, re) => Math.min(...list.filter((x) => re.test(x.a)).map((x) => x.s));
const maxEnd = (list, re) => Math.max(...list.filter((x) => re.test(x.a)).map((x) => x.e));
async function describe(p, text) {
  if (!(await p.locator("#mha").isVisible())) { await p.click("#btnAI"); await wait(p, 300); }
  if (!(await p.locator("#mhaText").count())) { await p.click('[data-mstep="describe"]'); await wait(p, 200); }
  await p.fill("#mhaText", text); await p.click("#mhaBuild"); await wait(p, 700);
}
async function say(p, text) { await p.fill("#mhaAsk", text); await p.press("#mhaAsk", "Enter"); await wait(p, 350); }
const lastMsg = (p) => p.evaluate(() => { const l = MHAssistUI.draft.log; return l[l.length - 1].text; });

(async () => {
  const b = await chromium.launch();
  const safe = async (fn) => { safe.n = (safe.n || 0) + 1; if (process.env.ONLY && !process.env.ONLY.split(",").includes(String(safe.n))) return; try { await fn(); } catch (e) { ok(false, "scenario crashed: " + String(e.message).split("\n").filter((l) => !/waiting \d+ms|retrying/.test(l)).slice(8, 16).join(" / ")); } };

  /* ---------------- A. landing, first-use guidance, help ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    ok(await p.locator("#mhaIntro").isVisible(), "hub shows the first-use card");
    ok(/Build a day by describing it/.test(await p.locator("#mhaIntro").innerText()), "first-use card explains the three steps");
    await p.click("#btnHelp"); await wait(p, 250);
    const help = await p.locator("#modal").innerText();
    ok(/Describe the day/.test(help) && /Plan the month/.test(help) && /no API key is ever stored/i.test(help), "top-right ? opens concise help, states the interpreter honestly");
    await p.click(".mha-help details summary"); await p.fill("#mhaEndpoint", "sk-ant-abc123"); await p.click("#mhaEndpointSave"); await wait(p, 150);
    ok(await p.evaluate(() => !JSON.parse(localStorage.getItem("cs.fcl.assistant") || "{}").endpoint), "help refuses to store an API key as the service address");
    await p.click("#modal [data-close]"); await wait(p, 150);
    await p.click("#mhaIntroX"); await wait(p, 150);
    ok(!(await p.locator("#mhaIntro").count()), "first-use card can be dismissed");
    await p.reload(); await wait(p, 600);
    ok(!(await p.locator("#mhaIntro").count()), "dismissal persists");
    // preserved modules all still open without errors
    for (const v of ["schedule", "month", "docs", "matrix", "pitch", "hub"]) { await p.click(`.seg [data-view="${v}"]`); await wait(p, 250); }
    await p.click('.seg [data-view="schedule"]'); await wait(p, 250);
    for (const v of ["lineup", "print", "schedule"]) { await p.click(`#dailyNav [data-view="${v}"]`); await wait(p, 250); }
    ok((await p.locator("#viewSchedule .sec, #viewSchedule section, #sections > *").count()) > 0, "manual schedule builder renders the sample day");
    ok(errs.length === 0, "landing + every module: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- B–H. the success criterion, end to end ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    const before = await p.evaluate(() => JSON.stringify(S.sections));
    await describe(p, DAY);
    let d = await draft(p);
    ok(d && d.length >= 14, `paragraph → draft with ${d && d.length} blocks`);
    const lanes = await p.locator(".mha-lane").count();
    ok(lanes >= 5, `review shows parallel lanes (${lanes})`);
    ok(minOf(d, /On-Field BP/) >= maxEnd(d, /Bullpen/), "bullpens finish before BP begins, as asked");
    ok(d.some((x) => x.g === "Blue Position Players" && /Defense/.test(x.a)) && d.some((x) => x.g === "Orange Position Players" && /Hitting|Cage/.test(x.a)), "Blue opens on defense, Orange in the cages");
    ok(d.some((x) => /First Pitch/.test(x.a) && x.s === 725) && d.some((x) => /Pre-Game/.test(x.a)), "first pitch anchored at 12:05 with a pregame tail");
    ok(d.some((x) => /Team Meeting/.test(x.a) && x.s === 465), "fixed 7:45 team meeting kept");
    ok(await p.evaluate((b0) => JSON.stringify(S.sections) === b0, before), "nothing saved before publishing");
    ok(!(await p.locator(".mha-issues li.error").count()), "no hard errors in the draft");

    // conversational adjustments
    const h0 = d.filter((x) => /Hitting/.test(x.a));
    await say(p, "move hitting back 15");
    d = await draft(p);
    const h1 = d.filter((x) => /Hitting/.test(x.a));
    ok(h0.length && h1.every((x, i) => x.s === h0.find((y) => y.id === x.id).s + 15), "edit 1: “move hitting back 15” shifts hitting 15 minutes later");
    ok(/later/.test(await lastMsg(p)), "edit 1 explains how “back” was read");
    const blueBefore = d.filter((x) => x.g === "Blue Position Players").map((x) => x.id).sort();
    await say(p, "swap Blue and Orange");
    d = await draft(p);
    ok(blueBefore.every((id) => d.find((x) => x.id === id).g === "Orange Position Players"), "edit 2: “swap Blue and Orange” trades the groups' schedules");
    await say(p, "make defense 25 minutes");
    d = await draft(p);
    ok(d.filter((x) => /^Defense$/.test(x.a)).every((x) => x.d === 25), "edit 3: “make defense 25 minutes”");
    ok((await p.locator(".mha-msg").count()) >= 7, "conversation log shows each request and its change summary");
    await p.click("#mhaUndo"); await wait(p, 250);
    ok((await draft(p)).filter((x) => /^Defense$/.test(x.a)).some((x) => x.d !== 25), "draft undo reverts the last edit");
    await say(p, "make defense 25 minutes");
    await say(p, "push BP forward 10");
    ok(/earlier or later/.test(await lastMsg(p)), "ambiguous request gets a targeted question, nothing changes");
    const snap = JSON.stringify(await draft(p));
    await say(p, "make it pop");
    ok(/didn't understand|couldn't find/i.test(await lastMsg(p)) && JSON.stringify(await draft(p)) === snap, "nonsense is refused with examples, draft untouched");
    await say(p, "move yoga to 10");
    ok(/couldn't find “yoga”/.test(await lastMsg(p)), "unknown activity: says it couldn't find it");

    // inline edit from the timeline
    await p.locator(".mha-blk", { hasText: "PFP" }).first().click(); await wait(p, 200);
    await p.fill('[data-ef="dur"]', "20"); await p.click("#mhaSave"); await wait(p, 250);
    ok((await draft(p)).some((x) => /PFP/.test(x.a) && x.d === 20), "inline edit on a block updates the draft");

    // publish, with a template
    await p.click('[data-mstep="publish"]'); await wait(p, 250);
    ok(/added/.test(await p.locator(".mha-pubstats").innerText()), "publish step shows the diff before writing");
    await p.check("#mhaTpl"); await p.fill("#mhaTplName", "Normal Monday");
    await p.click("#mhaPublish"); await wait(p, 600);
    const pub = await p.evaluate(() => S.sections.filter((s) => s.kind === "table").flatMap((s) => s.rows.map((r) => s.name + "|" + r.time + "|" + r.activity)));
    ok(pub.some((r) => /Pitchers\|.*\|Bullpen/.test(r)) && pub.some((r) => /\|12:05\|First Pitch/.test(r)), "publish writes the schedule into the app's own sections");
    ok(await p.evaluate(() => ScheduleActions.list().some((t) => t.name === "Normal Monday")), "approved schedule saved as a template");
    ok(await p.evaluate(() => JSON.parse(localStorage.getItem("cs.fcl.draft")).sections.some((s) => (s.rows || []).some((r) => r.activity === "PFP"))), "autosave to localStorage after publishing");

    // print: Player and Leadership views share the data
    ok(await p.locator("#viewPrint.on").count() === 1, "publish opens the printable sheet");
    const player = await p.locator("#sheetInner").innerText();
    ok(/Bullpen/.test(player) && /PFP/.test(player) && /First Pitch/.test(player), "Player sheet shows the published day");
    await p.click("#vwLeader"); await wait(p, 300);
    const lead = await p.locator("#sheetInner").innerText();
    ok(/Bullpen/.test(lead) && /PFP/.test(lead), "Leadership view shows the same published data");
    await p.click("#vwPlayer"); await wait(p, 200);
    await p.emulateMedia({ media: "print" });
    ok(await p.locator("#mha").isHidden(), "assistant never prints");
    const pdf = await p.pdf({ format: "Letter" });
    ok(pdf.length > 5000, `print/PDF renders (${pdf.length} bytes)`);
    await p.emulateMedia({ media: "screen" });

    // JSON export → import round trip through the app's own buttons
    await p.click("#btnOpen"); await wait(p, 250);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#expJSON")]);
    const file = path.join(os.tmpdir(), "mh-export.json"); await dl.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    ok(exported.schedule.sections.some((s) => (s.rows || []).some((r) => r.activity === "PFP" && r.ev && r.ev.dur === 20)), "JSON export carries the published rows and their durations");
    await p.click("#modal [data-close]"); await wait(p, 150);
    await p.evaluate(() => mutate(() => { S.sections = []; }));
    await p.click("#btnOpen"); await wait(p, 250);
    await p.setInputFiles("#filePick", file); await p.click("#impJSON").catch(() => {});
    await p.locator("#filePick").setInputFiles(file); await wait(p, 600);
    const back = await p.evaluate(() => S.sections.flatMap((s) => (s.rows || []).map((r) => r.id + r.time + r.activity)).join());
    ok(back === exported.schedule.sections.flatMap((s) => (s.rows || []).map((r) => r.id + r.time + r.activity)).join(), "JSON import restores the identical schedule");

    // app-level undo after a publish
    await p.evaluate(() => { if (document.querySelector("#scrim.on")) closeModal(); });
    await describe(p, "Use our Normal Monday template but move BP to 10:30");
    d = await draft(p);
    ok(d.some((x) => /On-Field BP/.test(x.a) && x.s === 630), "“use our Normal Monday template but…” starts from the template and applies the edit");
    ok(/Started from your “Normal Monday” template/.test(await p.locator(".mha-side").innerText()), "says which template it started from");
    await p.click('[data-mstep="publish"]'); await p.uncheck("#mhaThen"); await p.click("#mhaPublish"); await wait(p, 500);
    const afterPub = await p.evaluate(() => JSON.stringify(S.sections));
    await p.evaluate(() => undo()); await wait(p, 300);
    ok(await p.evaluate((a) => JSON.stringify(S.sections) !== a, afterPub), "the app's own Undo reverses a publish");
    ok(errs.length === 0, "success-criterion run: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- I. same as yesterday, rain, rotations ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    await describe(p, DAY + " Everyone needs lift.");
    await p.click('[data-mstep="publish"]'); await p.uncheck("#mhaThen"); await p.click("#mhaPublish"); await wait(p, 400);
    await p.evaluate(() => saveSchedule()); await wait(p, 200);
    const date0 = await p.evaluate(() => S.meta.date);
    await p.evaluate(() => { const d = new Date(S.meta.date + "T12:00:00"); d.setDate(d.getDate() + 1); S.id = uid(); S.meta.date = d.toISOString().slice(0, 10); renderMeta(); });
    await describe(p, "Same as yesterday but cancel lift and move BP to 10:30");
    let d = await draft(p);
    ok(d && d.length > 8 && !d.some((x) => /^Lift$/.test(x.a)) && d.some((x) => /On-Field BP/.test(x.a) && x.s === 630), `“same as yesterday but…” loads ${date0} and applies both edits`);
    await say(p, "It's raining — move everything indoors");
    d = await draft(p);
    ok(d.some((x) => /Cage BP/.test(x.a) && /cage/i.test(x.l)) && !d.some((x) => /On-Field BP/.test(x.a)), "rain: on-field BP becomes Cage BP in a cage");
    ok(/indoor/i.test(await lastMsg(p)), "rain: reports what moved and what has nowhere to go");
    await describe(p, "Camp day. Report at 8:00. Everyone stretches first. Four groups rotate through cages, defense, baserunning and bunt defense, 25 minutes each, starting at 8:45 with 5 minute transitions. Lunch at 12:00.");
    d = await draft(p);
    const rot = d.filter((x) => /Hitting|Cage|^Defense|Baserunning|Bunt Defense/.test(x.a) && x.s >= 525 && x.s < 650);
    const groups = [...new Set(rot.map((x) => x.g))];
    ok(groups.length === 4 && rot.length === 16, `rotation: 4 groups × 4 stations (${groups.length} groups, ${rot.length} blocks)`);
    ok(groups.every((g) => new Set(rot.filter((x) => x.g === g).map((x) => x.a)).size === 4), "rotation: every group sees every station once");
    ok([525, 555, 585, 615].every((t) => new Set(rot.filter((x) => x.s === t).map((x) => x.a)).size === 4), "rotation: each round uses each station once, 30-minute steps");
    ok(!(await p.locator(".mha-issues li.error").count()), "rotation draft has no hard errors");
    ok(errs.length === 0, "references/rain/rotation: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- J. voice: honest fallback and a dictated transcript ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b, { init: () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } });
    await p.click("#btnAI"); await wait(p, 250);
    ok(await p.locator("#mhaMic").isDisabled() && /isn't available in this browser/.test(await p.locator("#mhaMic").getAttribute("title")), "no Web Speech API: mic disabled with an honest explanation");
    await ctx.close();
    const fake = () => {
      class FakeRec { start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "report at eight thirty. two position player groups need defense for thirty minutes and cage work. pitchers need throwing and bullpens. first pitch at twelve oh five" }], { isFinal: true })] }), 50); }
        stop() { this.onend && this.onend(); } }
      window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
    };
    const v = await fresh(b, { init: fake });
    await v.p.click("#btnAI"); await wait(v.p, 250);
    await v.p.click("#mhaMic"); await wait(v.p, 300); await v.p.click("#mhaMic"); await wait(v.p, 150);
    const tr = await v.p.inputValue("#mhaText");
    ok(/eight thirty/.test(tr), "dictation lands in an editable transcript first");
    await v.p.click("#mhaBuild"); await wait(v.p, 700);
    const dd = await draft(v.p, true); if (process.env.DEBUG) console.log(JSON.stringify(dd.map((x) => [x.a, x.s, x.d])));
    ok(dd && Math.min(...dd.filter((x) => x.s != null && !/Meeting/.test(x.a)).map((x) => x.s)) === 510 && dd.some((x) => /Defense/.test(x.a) && x.d === 30), "spoken times and minutes (“eight thirty”, “thirty minutes”) are understood");
    ok(errs.length === 0 && v.errs.length === 0, "voice: no errors " + v.errs.join(" | ").slice(0, 200));
    await v.ctx.close();
  });

  /* ---------------- K. monthly planner ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.evaluate(() => { S.meta.date = "2026-04-13"; renderMeta(); Games.upsert({ date: "2026-04-15", opponent: "Test Club", time: "11:05", homeAway: "home" }); });
    await p.click('.seg [data-view="month"]'); await wait(p, 300);
    const daySecs = await p.evaluate(() => JSON.stringify(S.sections));
    await p.click("#calAssist"); await wait(p, 250);
    ok(/monthly plan/.test(await p.locator("#modal .mhead").innerText()) && /aren't touched/.test(await p.locator("#modal .mhead").innerText()), "month assistant says it edits the plan, not finalized days");
    await p.fill("#mhaMonthText", "Bunt defense every Tuesday. Team defense 3 times a week. Avoid heavy defense before morning games. Yoga every Friday.");
    await p.click("#mhaMonthPrev"); await wait(p, 300);
    const out = await p.locator("#mhaMonthOut").innerText();
    ok(/would change/.test(out) && /Bunt Defense/.test(out), "month preview lists the proposed days");
    ok(/Not in your Activity Library/.test(out) && /Yoga/.test(out), "unknown activity flagged, not invented");
    await p.click("#mhaMonthApply"); await wait(p, 400);
    const tue = await p.evaluate(() => ["2026-04-07", "2026-04-14", "2026-04-21", "2026-04-28"].every((d) => Month.forDate(d).includes("bunt-defense")));
    ok(tue, "applied: bunt defense on every Tuesday");
    ok(await p.evaluate(() => !Month.forDate("2026-04-14").includes("team-defense")), "no team defense the day before the 11:05 game");
    ok(await p.evaluate((s0) => JSON.stringify(S.sections) === s0, daySecs), "daily schedule untouched by a monthly edit");
    ok((await p.locator(".cal-a", { hasText: "Bunt Defense" }).count()) >= 4, "calendar shows the plan");
    await p.click("#toastAct"); await wait(p, 300);
    ok(await p.evaluate(() => !Month.forDate("2026-04-07").includes("bunt-defense")), "month change can be undone");
    // the monthly plan feeds the day
    await p.click("#calAssist"); await wait(p, 200); await p.fill("#mhaMonthText", "Bunt defense every Tuesday"); await p.click("#mhaMonthPrev"); await wait(p, 200); await p.click("#mhaMonthApply"); await wait(p, 300);
    await p.evaluate(() => { S.meta.date = "2026-04-14"; renderMeta(); });
    await p.click('.seg [data-view="schedule"]'); await wait(p, 200);
    await describe(p, "Report at 8:00. Two position player groups. Position players need stretch, defense and cage work.");
    ok((await draft(p)).some((x) => /Bunt Defense/.test(x.a)), "a day built on a planned Tuesday includes the monthly plan's bunt defense");
    ok(errs.length === 0, "monthly: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- L. optional AI service: contract, validation, fallback ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.route("**/__mha_ai", (route) => {
      const body = JSON.parse(route.request().postData());
      ok(!/key|token|secret/i.test(JSON.stringify(Object.keys(body))) && body.context && Array.isArray(body.context.groups), "client sends text + context only, never a key");
      const reply = body.mode === "edit"
        ? { interpretation: { intent: "edit", brief: "", edits: [{ op: "shift", target: "hitting", value: "20", group: "" }], monthRules: [], clarifications: [], assumptions: [] }, model: "test-double" }
        : { interpretation: { intent: "build", brief: DAY, edits: [], monthRules: [], clarifications: [], assumptions: ["Read as a home game."] }, model: "test-double" };
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
    });
    await p.evaluate(() => localStorage.setItem("cs.fcl.assistant", JSON.stringify({ endpoint: "./__mha_ai" })));
    await describe(p, "we got 2 hitting groups and 2 pitching groups, game at 12:05, the usual");
    ok(/AI service · test-double/.test(await p.locator(".mha-head").innerText()), "status chip shows the AI service when one is connected");
    const d0 = await draft(p);
    ok(d0.length >= 14, "AI interpretation becomes a brief that the deterministic planner schedules");
    await say(p, "nudge the hitting a little later");
    const d1 = await draft(p);
    ok(d1.filter((x) => /Hitting/.test(x.a)).every((x) => x.s === d0.find((y) => y.id === x.id).s + 20), "AI edits run through the same validated operations");
    await p.unroute("**/__mha_ai");
    await p.route("**/__mha_ai", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ interpretation: { intent: "edit", edits: [{ op: "rm -rf" }] } }) }));
    await say(p, "move hitting back 15");
    ok(/Built-in reader \(AI service failed\)/.test(await p.locator(".mha-head").innerText()), "malformed AI reply is rejected and the built-in reader takes over");
    ok(/later/.test(await lastMsg(p)), "…and the request still works");
    ok(errs.filter((e) => !/__mha_ai/.test(e)).length === 0, "AI path: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- M. phone layout ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b, { ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    await p.click("#btnAI"); await wait(p, 250);
    await p.fill("#mhaText", DAY); await p.click("#mhaBuild"); await wait(p, 700);
    ok((await p.locator(".mha-blk").count()) > 10, "phone: draft renders");
    ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, "phone: no horizontal page scroll");
    await say(p, "move hitting back 15");
    ok(/later/.test(await lastMsg(p)), "phone: conversational edit works");
    const foot = await p.locator(".mha-foot button").first().boundingBox();
    ok(foot && foot.x >= 56, "phone: footer buttons clear the Sandbox return badge");
    ok(errs.length === 0, "phone: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* ---------------- N. classic tools are still there ---------------- */
  await safe(async () => {
    const { ctx, p, errs } = await fresh(b);
    await describe(p, DAY);
    await p.click("#mhaClassic"); await wait(p, 300);
    ok(/Classic Schedule Builder/i.test(await p.locator("#modal").innerText()), "classic planner/transcriber still available");
    await p.click('[data-aitab="text"]'); await p.fill("#aiText", "Blue Position Players:\n8:00 Stretch - Turf\n8:15 Defense - Field 1"); await wait(p, 300);
    ok(/2 rows/i.test(await p.locator("#aiPreview").innerText()), "classic transcriber parses rows");
    await p.click("#modal [data-close]"); await wait(p, 200);
    await p.click("#btnNew"); await wait(p, 200);
    ok(/Plan the day with the Assistant/.test(await p.locator("#modal").innerText()) && /Duplicate/.test(await p.locator("#modal").innerText()), "New day keeps duplicate/templates and offers the Assistant");
    ok(errs.length === 0, "classic tools: no errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
