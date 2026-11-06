// FUEL — end-to-end checks in a real browser against the built sandbox demo (synthetic data).
// node scripts/build.mjs && node scripts/serve.mjs &   then   node fuel/tests/app.e2e.cjs     (BASE=… for another host)
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/fuel/";
const ORIGIN = new URL(BASE).origin;
const TPL = path.join(__dirname, "../../apps/fuel/templates");
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);

async function fresh(b, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1440, height: 950 }, acceptDownloads: true }, opts));
  const p = await ctx.newPage();
  p.setDefaultTimeout(12000);
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && (m.location().url || "").startsWith(ORIGIN)) errs.push("console: " + m.text()); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(ORIGIN)) errs.push(`${r.status()} ${r.url()}`); });
  await p.goto(BASE + "#/home");
  await p.waitForSelector(".kpis", { timeout: 20000 });
  return { ctx, p, errs };
}
/** call FUEL's own API inside the page (same module instance as the app) */
const api = (p, method, pathName, opts = {}) => p.evaluate(async ([m, pa, o]) => (await import("./api.js")).api(m, pa, o), [method, pathName, opts]);
const go = async (p, hash) => {
  if (p.url() === BASE + hash) await p.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange"))); // same address: re-render
  else await p.goto(BASE + hash);
  await wait(p, 500);
};
const hscroll = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - document.documentElement.clientWidth);
/** fill a field and confirm it took (a just-opened dialog can still be settling focus); logged if a retry was needed */
async function fillOk(p, sel, val) {
  await p.waitForTimeout(60);
  await p.fill(sel, val);
  if ((await p.inputValue(sel)) !== val) { console.log(`  note: re-filled ${sel}`); await p.fill(sel, val); }
}
/** submit the open form dialog and wait until it closes; if it doesn't, report what it says */
async function submitModal(p) {
  await p.click("#modal button[type=submit]");
  try { await p.waitForSelector("#scrim", { state: "hidden", timeout: 8000 }); await wait(p, 300); return true; }
  catch {
    const info = await p.evaluate(() => [...document.querySelectorAll("#modal input,#modal select")].map((e) => `${e.id}=${JSON.stringify(e.value)}${e.validity.valid ? "" : " INVALID:" + e.validationMessage}`).join(" ; ") + " | today=" + new Date().toString());
    console.log("  dialog stayed open:", (await p.locator("#modal").innerText()).replace(/\s+/g, " ").slice(0, 200), "||", info);
    return false;
  }
}
async function setRole(p, role) { await p.selectOption("#roleSel", role); await wait(p, 600); }
async function pickPlayer(p, scope, text) { await p.fill(`${scope} .qe-pick input`, text); await wait(p, 250); await p.keyboard.press("Enter"); await wait(p, 150); }
async function importFile(p, kind, file, { year, decide } = {}) {
  await go(p, "#/data/import");
  await p.click(`#iK [data-k="${kind}"]`);
  if (file.endsWith(".csv")) await p.setInputFiles("#iFile", file); else { await p.click("details summary"); await p.fill("#iPaste", file); }
  await wait(p, 300);
  if (year != null && (await p.$("#iYear"))) await p.fill("#iYear", String(year));
  await p.click("#iNext"); await p.waitForSelector("#iRows", { timeout: 15000 });
  if (decide) await decide(p);
  return true;
}
async function commitImport(p) { await p.click("#iCommit"); await p.click("#cGo"); await p.waitForSelector(".steps .on:has-text('Done')"); return p.locator("#dBody").innerText(); }

(async () => {
  const b = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const safe = async (name, fn) => { if (only && !only.some((o) => name.startsWith(o))) return; try { await fn(); } catch (e) { ok(false, `${name} crashed: ${String(e.message).split("\n")[0]}`); } };

  /* 1–2, 5–6, 20–21: players, measurements, affiliate move, persistence */
  await safe("players", async () => {
    const { ctx, p, errs } = await fresh(b);
    // 1 · create a player
    await go(p, "#/players");
    const n0 = (await api(p, "GET", "players")).length;
    await p.click("#newP"); await fillOk(p, "#nF", "Testy"); await fillOk(p, "#nL", "McTestface"); await fillOk(p, "#nId", "99901"); await p.selectOption("#nPos", "CF"); await p.selectOption("#nAff", "Asheville");
    await p.click("#modal button[type=submit]"); await p.waitForSelector(".phead h1:has-text('Testy McTestface')");
    ok((await api(p, "GET", "players")).length === n0 + 1, "1 · create a player");
    const pid = decodeURIComponent(p.url().match(/#\/player\/([^/]+)/)[1]);
    // duplicate Player ID refused
    await go(p, "#/players"); await p.click("#newP"); await fillOk(p, "#nF", "Other"); await fillOk(p, "#nL", "Person"); await fillOk(p, "#nId", "99901"); await p.click("#modal button[type=submit]"); await p.waitForFunction(() => document.querySelector("#npErr") && document.querySelector("#npErr").textContent.length > 0, null, { timeout: 8000 });
    ok(/already belongs to Testy McTestface/.test(await p.locator("#npErr").innerText()), "a Player ID can't be given to a second player");
    await p.keyboard.press("Escape");
    // 2 · search: global search by last name and by Player ID
    await go(p, "#/home");
    await p.fill("#gsearch", "mctest"); await wait(p, 300); await p.keyboard.press("Enter"); await p.waitForSelector(".phead h1:has-text('Testy McTestface')");
    await p.fill("#gsearch", "99901"); await wait(p, 300); await p.keyboard.press("Enter"); await wait(p, 400);
    ok(/Testy McTestface/.test(await p.locator(".phead h1").innerText()), "2 · search finds a player by name and by Player ID");
    const rods = (await api(p, "GET", "players")).filter((x) => x.last_name === "Rodriguez");
    ok(rods.length === 2 && rods[0].id !== rods[1].id && rods[0].external_id !== rods[1].external_id, "two players named Rodriguez remain two separate players");
    // 5 · record a weight
    await go(p, `#/player/${pid}/body`);
    await p.click("#addW"); await fillOk(p, "#fW", "201.6"); await fillOk(p, "#fN", "post-workout"); await submitModal(p);
    let prof = await api(p, "GET", "player", { params: { id: pid } });
    ok(prof.weights.length === 1 && prof.weights[0].weight === 201.6 && /201\.6/.test(await p.locator("#wTable").innerText()), "5 · record a weight");
    await p.click("#addW"); await fillOk(p, "#fW", "21.6"); await p.click("#modal button[type=submit]"); await p.waitForFunction(() => (document.querySelector("#fErr") || {}).textContent, null, { timeout: 8000 });
    ok(/plausible/.test(await p.locator("#fErr").innerText()), "an implausible weight (typo) is refused with a message");
    await p.keyboard.press("Escape");
    // 6 · record a DEXA
    await p.click("#addD"); await fillOk(p, "#fBF", "11.8"); await fillOk(p, "#fLM", "171.2"); await fillOk(p, "#fFM", "22.9"); await fillOk(p, "#fALM", "81.5"); await submitModal(p);
    prof = await api(p, "GET", "player", { params: { id: pid } });
    ok(prof.dexa.length === 1 && prof.dexa[0].lean_mass === 171.2 && /171\.2/.test(await p.locator("#dTable").innerText()), "6 · record a DEXA assessment");
    // corrections never overwrite
    await p.locator('[data-void^="weights:"]').first().click(); await fillOk(p, "#fR", "wrong scale"); await submitModal(p);
    prof = await api(p, "GET", "player", { params: { id: pid } });
    ok(prof.weights.length === 1 && prof.weights[0].voided && /void: wrong scale/.test(await p.locator("#wTable").innerText()), "a voided weight stays in the history, marked void");
    // 20 · move affiliate; history retained
    await p.click("#pEdit"); await p.selectOption("#eAff", "Corpus Christi"); await submitModal(p);
    prof = await api(p, "GET", "player", { params: { id: pid } });
    ok(prof.player.affiliate === "Corpus Christi" && prof.assignments.length === 2 && prof.assignments.find((a) => a.affiliate === "Asheville").end_date && prof.weights.length === 1 && prof.dexa.length === 1, "20 · affiliate change keeps all history (old assignment closed)");
    ok((await api(p, "GET", "players")).filter((x) => x.external_id === "99901").length === 1, "20 · …and creates no duplicate player");
    // 21 · persistence after refresh
    await p.reload(); await p.waitForSelector(".phead h1"); await wait(p, 500);
    prof = await api(p, "GET", "player", { params: { id: pid } });
    ok(prof.player.affiliate === "Corpus Christi" && prof.dexa.length === 1 && /Corpus Christi/.test(await p.locator(".phead").innerText()), "21 · data persists after refresh");
    ok(errs.length === 0, "players: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 7–10: Quick Entry */
  await safe("quick entry", async () => {
    const { ctx, p, errs } = await fresh(b);
    const players = await api(p, "GET", "players");
    const target = players.find((x) => x.last_name === "Castillo");
    const note = "Met with Castillo after workouts. Weight was 197.4 this morning, up about 2 pounds from last week. Talked about increasing breakfast calories and adding a shake after training. Follow up next Thursday.";
    await p.click("#qeBtn"); await pickPlayer(p, "#modal", "Castillo");
    await p.fill("#qeDate", "2026-10-01");
    await p.fill("#qeNote", note);
    ok((await p.inputValue("#qeType")) === "in_person", "7 · the note's type is suggested from its wording (in person)");
    await p.keyboard.press("Control+Enter"); await p.waitForSelector("#rvSave");
    const rv = await p.locator("#modal .review").innerText();
    ok((await p.inputValue("#rvWv")) === "197.4" && (await p.inputValue("#rvWd")) === "2026-10-01" && !/\b2 lb\b.*weight record/i.test(rv), "8 · the weight 197.4 is extracted (the 2-lb change is not)");
    ok((await p.inputValue("#rvFd")) === "2026-10-08", "9 · 'next Thursday' resolves against the ENTRY date (Oct 1 → Oct 8), not today");
    await p.click("#rvSave"); await wait(p, 800);
    const prof = await api(p, "GET", "player", { params: { id: target.id } });
    const i = prof.interactions.find((x) => x.source && x.source.kind === "quick_entry");
    const wgt = prof.weights.find((x) => x.weight === 197.4);
    const fu = prof.followups.find((x) => x.due_date === "2026-10-08");
    ok(i && wgt && fu && wgt.date === "2026-10-01" && fu.interaction_id === i.id && wgt.quick_entry === i.quick_entry, "8–9 · note, weight and follow-up saved together and linked to one quick entry");
    ok(i && i.text === note && i.original_text === note, "10 · the original note is stored exactly as typed");
    await go(p, `#/player/${target.id}/comms`);
    ok((await p.locator("#tl").innerText()).includes("Talked about increasing breakfast calories"), "10 · …and shown in the communication timeline");
    // ambiguous weight: nothing preselected; untick → note only
    await p.click("#qeBtn"); await wait(p, 200);
    ok(/Castillo/.test(await p.locator("#modal .qe-chosen").innerText()), "Quick Entry from a profile starts with that player selected");
    await p.fill("#qeNote", "Called him — weighed 210 yesterday, scale at home said 212."); await p.click("#qeNext"); await p.waitForSelector("#rvSave");
    ok((await p.locator('input[name="rvWc"]').count()) === 2 && (await p.locator('input[name="rvWc"]:checked').count()) === 0, "an ambiguous note offers both weights and selects neither");
    await p.click("#rvSave"); await wait(p, 300);
    ok(/Pick which weight/.test(await p.locator("#rvErr").innerText()), "…and won't save a weight until one is picked");
    await p.click("#rvNoteOnly"); await wait(p, 700);
    const prof2 = await api(p, "GET", "player", { params: { id: target.id } });
    ok(prof2.weights.length === prof.weights.length && prof2.interactions.length === prof.interactions.length + 1, "'Save note only' saves the note and no weight");
    // Save & add another keeps the date and clears the player
    await p.click("#qeBtn"); await p.fill("#qeDate", "2026-10-02"); await p.fill("#qeNote", "Weighed 205.0. f/u in 2 weeks"); await p.click("#qeNext"); await wait(p, 200);
    await p.click("#rvAnother"); await wait(p, 700);
    ok((await p.$(".qe-pick input")) && (await p.inputValue("#qeDate")) === "2026-10-02" && (await p.inputValue("#qeNote")) === "", "Save & add another: ready for the next player, same entry date");
    await pickPlayer(p, "#modal", "Navarro"); await p.fill("#qeNote", "Quick hello in the cafeteria."); await p.click("#qeNext"); await wait(p, 700);
    ok(await p.locator("#scrim").isHidden(), "a note with nothing to extract saves straight away");
    ok(errs.length === 0, "quick entry: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 3–4, 11–14, 24–25: imports */
  await safe("imports", async () => {
    const { ctx, p, errs } = await fresh(b);
    const n0 = (await api(p, "GET", "players")).length;
    // 3 · roster import (2 new + 1 existing ID)
    await importFile(p, "roster", path.join(TPL, "roster-template.csv"));
    const prev = await p.locator("#iRows").innerText();
    ok(/new/.test(prev) && /update|already in FUEL/.test(prev), "3 · roster preview shows new and existing players before anything is saved");
    ok((await api(p, "GET", "players")).length === n0, "…and the preview saved nothing");
    await commitImport(p);
    const n1 = (await api(p, "GET", "players")).length;
    ok(n1 === n0 + 2, `3 · roster import creates the 2 new players (${n1 - n0})`);
    // 4 · re-import: no duplicates
    await importFile(p, "roster", path.join(TPL, "roster-template.csv"));
    await commitImport(p);
    ok((await api(p, "GET", "players")).length === n1, "4 · re-importing the same roster creates no duplicates");
    // 11–12 · legacy spreadsheet incl. continuation columns
    await importFile(p, "legacy", path.join(TPL, "legacy-nutrition-template.csv"), { year: 2026 });
    ok(/Every column in the file is mapped/.test(await p.locator("#dBody").innerText()), "11 · every legacy column maps to a FUEL field");
    const lp = await p.locator("#iRows").innerText();
    ok(/needs decision/.test(lp), "legacy rows matching a rostered player by name wait for a decision (no auto-merge)");
    if (await p.$("#iAccept")) await p.click("#iAccept"); else for (const s of await p.$$("[data-dec]")) { const v = await s.evaluate((el) => el.options[1].value); await s.selectOption(v); }
    await wait(p, 300);
    await commitImport(p);
    const whit = (await api(p, "GET", "players")).filter((x) => x.last_name === "Whitman");
    ok(whit.length === 1, "11 · legacy rows linked to the rostered player — no duplicate created");
    const prof = await api(p, "GET", "player", { params: { id: whit[0].id } });
    const cols = prof.interactions.map((x) => x.source && x.source.column);
    ok(prof.weights.some((x) => x.weight === 197.6 && x.date === "2026-10-28") && prof.dexa.some((x) => x.lean_mass === 162.3) && prof.hydration.length === 1 && prof.protocols.length === 1, "11 · weight, DEXA, hydration and vitamin D land in their own records");
    ok(prof.goals.some((g) => g.type === "weight" && g.target_value === 203) && prof.goals.some((g) => g.type === "strength") && prof.goals.some((g) => g.type === "weakness"), "11 · goal weight, body comp and pre-season bullets become goals");
    ok(cols.includes("Nutrition Actions") && cols.includes("Nutrition Actions Cont...") && cols.includes("Nutrition Actions Cont...2") && cols.includes("History") && cols.includes("Week 5 Goal Check-In's"), "12 · history, all three Nutrition Actions columns and Week 5 check-in import as notes");
    const a = prof.interactions.find((x) => x.date === "2026-03-14");
    ok(a && a.author_initials === "DW" && /breakfast plan reviewed/.test(a.text) && prof.interactions.some((x) => x.date === "2026-04-02" && x.author_initials === "CP"), "12 · each dated entry becomes its own note with date and initials");
    ok(prof.interactions.some((x) => x.source.column === "Nutrition Actions Cont...2" && x.date === null), "12 · an entry with no date stays 'date unknown' — not invented");
    await go(p, `#/player/${whit[0].id}/comms`);
    ok(/Undated — from imported history/i.test(await p.locator("#tl").innerText()), "undated imported notes are listed separately, not forced into the timeline");
    // 13 · performance import by Player ID
    await importFile(p, "performance", path.join(TPL, "performance-template.csv"));
    await commitImport(p);
    const m = (await api(p, "GET", "players")).find((x) => x.external_id === "70001");
    const pm = await api(p, "GET", "player", { params: { id: m.id } });
    ok(pm.performance.some((x) => x.date === "2026-04-10" && x.metric === "bat_speed" && x.value === 72.4 && x.definition === "average"), "13 · performance rows import onto the player with that Player ID");
    // 14 · unknown IDs rejected, nothing created
    const nP = (await api(p, "GET", "players")).length;
    await importFile(p, "performance", "player_id,date,metric,value,unit,definition\n55555,2026-05-01,bat_speed,70.2,mph,average\n70001,2026-05-02,bat_speed,71.0,mph,average\n");
    ok(/Unknown Player ID 55555/.test(await p.locator("#iRows").innerText()), "14 · an unknown Player ID is reported in the preview");
    await commitImport(p);
    ok((await api(p, "GET", "players")).length === nP, "14 · …and never creates a player");
    // 25 · a conflicting value can't silently overwrite
    await importFile(p, "performance", "player_id,date,metric,value,unit,definition\n70001,2026-04-10,bat_speed,75.5,mph,average\n");
    ok(/needs decision/.test(await p.locator("#iRows").innerText()) && /never replaced/.test(await p.locator("#iRows").innerText()), "25 · a different value for an existing measurement needs a decision");
    await commitImport(p);
    const pm2 = await api(p, "GET", "player", { params: { id: m.id } });
    ok(pm2.performance.filter((x) => x.date === "2026-04-10" && x.metric === "bat_speed").map((x) => x.value).join() === "72.4", "25 · …and the existing value is untouched");
    // 24 · malformed CSVs
    await importFile(p, "roster", 'Player ID,First Name,Last Name\n"1,Broken,Quote\n').catch(() => {});
    await wait(p, 300);
    const t1 = await p.locator("#dBody").innerText();
    ok(/never closed|First name/.test(t1) || /error/.test(t1), "24 · a malformed CSV (unclosed quote) is reported");
    await go(p, "#/data/import"); await p.click('#iK [data-k="roster"]'); await p.click("details summary"); await p.fill("#iPaste", "Foo,Bar\n1,2\n"); await p.click("#iNext"); await wait(p, 800);
    ok(/Map these required columns first: First name, Last name/.test(await p.locator("#dBody").innerText()) && await p.locator("#iCommit").isDisabled(), "24 · a CSV without required columns can't be imported");
    ok((await api(p, "GET", "players")).length === nP, "24 · …nothing was created");
    // rollback (admin)
    await setRole(p, "admin");
    await go(p, "#/data/history");
    ok((await p.locator("#hT tbody tr").count()) >= 5, "import history lists every batch");
    errs.splice(0);
    ok(errs.length === 0, "imports: no app errors");
    await ctx.close();
  });

  /* 15–19: body composition × performance */
  await safe("analysis", async () => {
    const { ctx, p, errs } = await fresh(b);
    const all = await api(p, "GET", "players");
    const hitter = all.find((x) => !["RHP", "LHP"].includes(x.position) && x.position !== "TWP");
    const pitcher = all.find((x) => ["RHP", "LHP"].includes(x.position));
    await go(p, `#/player/${hitter.id}/performance`);
    await p.selectOption("#cmpPhys", "weight");
    const bsOpt = await p.$eval("#cmpPerf", (s) => [...s.options].find((o) => o.value === "bat_speed|average").value);
    await p.selectOption("#cmpPerf", bsOpt); await wait(p, 400);
    const leg = await p.locator("#cmpLeg").innerText();
    ok(/Body Weight/.test(leg) && /Bat Speed — Average/.test(leg) && (await p.locator("#cmpChart svg circle").count()) > 10, "15 · body weight vs bat speed renders (two axes, real points)");
    // 18 · matching and r agree with an independent calculation
    const shown = await p.evaluate(() => ({ n: +document.querySelector("#cmpStat .stat .v").textContent, r: (document.querySelectorAll("#cmpStat .stat .v")[1] || {}).textContent }));
    const indep = await p.evaluate(async (id) => {
      const { api } = await import("./api.js");
      const prof = await api("GET", "player", { params: { id } });
      const W = prof.weights.filter((x) => !x.voided && x.date).map((x) => ({ id: x.id, date: x.date, value: Math.round(x.weight * 10) / 10 }));
      const B = prof.performance.filter((x) => x.metric === "bat_speed" && x.definition === "average").map((x) => ({ id: x.id, date: x.date, value: x.value }));
      const day = (d) => Date.parse(d + "T00:00:00Z") / 864e5;
      // brute force: all pairs within 7 days, greedy by gap — written independently of shared/stats.js
      const c = []; W.forEach((w, i) => B.forEach((q, j) => { const g = Math.abs(day(w.date) - day(q.date)); if (g <= 7) c.push([g, w.date, q.date, w.id, q.id, i, j]); }));
      c.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]) || a[4].localeCompare(b[4]));
      const ui = new Set(), uj = new Set(), pr = [];
      for (const x of c) if (!ui.has(x[5]) && !uj.has(x[6])) { ui.add(x[5]); uj.add(x[6]); pr.push([W[x[5]].value, B[x[6]].value]); }
      const n = pr.length, mx = pr.reduce((s, q) => s + q[0], 0) / n, my = pr.reduce((s, q) => s + q[1], 0) / n;
      const r = pr.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / Math.sqrt(pr.reduce((s, q) => s + (q[0] - mx) ** 2, 0) * pr.reduce((s, q) => s + (q[1] - my) ** 2, 0));
      return { n, r: r.toFixed(2), w: W.length, b: B.length, inWindow: prof.weights.filter((x) => !x.voided && x.date).length };
    }, hitter.id);
    ok(shown.n === indep.n && shown.r === indep.r, `18 · one-to-one date matching and Pearson r match an independent calculation (n=${indep.n}, r=${indep.r})`);
    // 19 · no interpolation: one point per real measurement, nothing more
    const circles = await p.locator("#cmpChart svg circle").count();
    ok(circles === indep.w + indep.b, `19 · the chart draws exactly one point per real measurement (${circles} = ${indep.w} weigh-ins + ${indep.b} bat-speed)`);
    // matching window changes the pair count; tiny windows show no r
    await p.fill("#cmpWin", "0"); await p.dispatchEvent("#cmpWin", "input"); await wait(p, 300);
    const n0 = +(await p.locator("#cmpStat .stat .v").first().innerText());
    ok(n0 <= shown.n, "a narrower matching window never adds pairs");
    // 16 · DEXA lean mass vs exit velocity: few scans → honest message, no r
    await p.fill("#cmpWin", "7"); await p.dispatchEvent("#cmpWin", "input");
    await p.selectOption("#cmpPhys", "lean_mass");
    await p.selectOption("#cmpPerf", await p.$eval("#cmpPerf", (s) => [...s.options].find((o) => o.value.startsWith("exit_velocity|average")).value)); await wait(p, 400);
    const st = await p.locator("#cmpStat").innerText();
    ok((await p.locator("#cmpChart svg rect").count()) >= 2 && /at least 5 are needed/.test(st) && !/Pearson r/.test(st), "16 · DEXA lean mass vs exit velocity: scans on real dates; too few pairs → no correlation shown");
    // 17 · body weight vs pitch velocity for a pitcher
    await go(p, `#/player/${pitcher.id}/performance`);
    await p.selectOption("#cmpPhys", "weight"); await wait(p, 300);
    ok(/Pitch Velocity — Average fastball/.test(await p.locator("#cmpLeg").innerText()) && /matched pairs/.test(await p.locator("#cmpStat").innerText()), "17 · body weight vs pitch velocity for a pitcher");
    ok(/doesn't show that one caused the other|needed/.test(await p.locator("#cmpStat").innerText()), "the analysis says correlation is not causation");
    ok(errs.length === 0, "analysis: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 23: roles (the browser demo simulates roles with the same server-side handler checks; secure mode is tested in server.test.mjs) */
  await safe("roles", async () => {
    const { ctx, p, errs } = await fresh(b);
    const pl = (await api(p, "GET", "players"))[0];
    await setRole(p, "readonly");
    await go(p, `#/player/${pl.id}/overview`);
    ok(!(await p.$("#pQE")) && !(await p.$("#pEdit")), "23 · read-only: no Quick Entry or edit controls");
    const blocked = await p.evaluate(async (id) => { try { await (await import("./api.js")).api("POST", "weight", { body: { player_id: id, date: "2026-11-01", weight: 200 } }); return false; } catch (e) { return e.status === 403; } }, pl.id);
    ok(blocked, "23 · read-only: a direct write request is refused (403)");
    ok(!/Mobile 555/.test(await p.locator(".phead").innerText()), "23 · read-only: contact details hidden");
    await setRole(p, "performance");
    await go(p, `#/player/${pl.id}/comms`);
    ok(/restricted/.test(await p.locator("#tab").innerText()), "23 · performance staff: nutrition notes restricted");
    await go(p, `#/player/${pl.id}/hydration`);
    ok(/restricted/.test(await p.locator("#tab").innerText()), "23 · performance staff: hydration & protocols restricted");
    const prof = await api(p, "GET", "player", { params: { id: pl.id } });
    ok(prof.interactions === undefined && prof.hydration === undefined && prof.player.phone === undefined, "23 · …and the data itself is never sent to that role");
    await setRole(p, "dietitian");
    ok(errs.length === 0, "roles: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 22: phones */
  for (const W of [375, 390, 430]) await safe("phone " + W, async () => {
    const { ctx, p, errs } = await fresh(b, { viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true });
    for (const h of ["#/home", "#/players", "#/followups", "#/weighins", "#/reports", "#/data"]) { await go(p, h); if ((await hscroll(p)) > 0) ok(false, `${W}: horizontal scroll on ${h}`); }
    ok(true, `${W}: no horizontal scroll on the main pages`);
    await go(p, "#/home");
    await p.click("#qeTab"); await pickPlayer(p, "#modal", "Navarro");
    await p.fill("#qeNote", "Weighed 211.2 this morning. Follow up Monday."); await p.click("#qeNext"); await p.waitForSelector("#rvSave");
    ok((await p.locator("#rvSave").boundingBox()).width > W * 0.8, `${W}: Quick Entry is full-screen with a full-width Save`);
    await p.click("#rvSave"); await wait(p, 700);
    const nav = (await api(p, "GET", "players")).find((x) => x.last_name === "Navarro");
    const prof = await api(p, "GET", "player", { params: { id: nav.id } });
    ok(prof.weights.some((x) => x.weight === 211.2) && prof.followups.some((f) => f.description.startsWith("Follow up")), `${W}: mobile Quick Entry saves a note, weight and follow-up`);
    await go(p, `#/player/${nav.id}/overview`);
    ok((await hscroll(p)) <= 0, `${W}: player profile fits the screen`);
    await go(p, "#/weighins");
    const first = p.locator("tr:not([hidden]) [data-pid]").first();
    await first.fill("199.9"); await first.press("Enter");
    await p.click("#bSave"); await wait(p, 800);
    ok(/1 weight saved/.test(await p.locator("#toast").innerText()), `${W}: bulk weigh-in works on a phone`);
    ok(errs.length === 0, `${W}: no app errors ` + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* weigh-ins: bulk-only page with a player search that never drops unsaved entries */
  await safe("weigh-ins", async () => {
    const { ctx, p, errs } = await fresh(b);
    await go(p, "#/home");
    ok((await p.locator('.nav a[data-nav="weighins"]').innerText()).trim() === "Weigh-Ins" && (await p.locator('.nav a', { hasText: "Daily Log" }).count()) === 0, "nav: Daily Log is now Weigh-Ins");
    await go(p, "#/log/bulk");
    ok(/#\/weighins$/.test(p.url()), "old Daily Log links land on Weigh-Ins");
    ok((await p.locator("#qeInline, #todayList, .tabs").count()) === 0 && (await p.locator("#bBody").count()) === 1, "Weigh-Ins is bulk entry only (no inline quick entry, no tabs)");
    ok((await p.locator("#qeBtn").isVisible()), "global Quick Entry is still in the top bar");
    await p.selectOption("#bA", "");
    const all = await p.locator("#bBody tr:not([hidden])").count();
    const pl = (await api(p, "GET", "players")).slice().sort((x, y) => x.last_name.localeCompare(y.last_name));
    const A = pl[0], B = pl.find((x) => x.id !== A.id && !`${A.first_name} ${A.last_name}`.toLowerCase().includes(x.last_name.slice(0, 4).toLowerCase()));
    await p.fill(`[data-pid="${A.id}"]`, "201.4");
    await p.fill(`[data-note="${A.id}"]`, "search test");
    await p.fill("#bQ", B.last_name.slice(0, 4).toUpperCase());
    const shown = await p.locator("#bBody tr:not([hidden])").count();
    ok(shown >= 1 && shown < all && (await p.locator(`[data-row="${B.id}"]`).isVisible()), "search filters as you type (partial, case-insensitive)");
    ok(!(await p.locator(`[data-row="${A.id}"]`).isVisible()) && (await p.inputValue(`[data-pid="${A.id}"]`)) === "201.4", "a hidden row keeps its unsaved weight");
    ok(/1 entered · 1 not shown/.test(await p.locator("#bN").innerText()), "the count says an entry is hidden by the filter");
    await p.fill(`[data-pid="${B.id}"]`, "188.8");
    await p.fill("#bQ", `${B.first_name.toLowerCase()} ${B.last_name.slice(0, 3).toLowerCase()}`);
    ok(await p.locator(`[data-row="${B.id}"]`).isVisible(), "search matches first + partial last name");
    await p.fill("#bQ", "zzqq");
    ok(await p.locator("#bNone").isVisible(), "no-match message shows");
    await p.click("#bQx");
    ok((await p.inputValue("#bQ")) === "" && (await p.locator("#bBody tr:not([hidden])").count()) === all, "clear restores every player");
    await p.fill("#bQ", A.last_name); await p.press("#bQ", "Escape");
    ok((await p.inputValue("#bQ")) === "", "Escape clears the search");
    await p.selectOption("#bA", A.affiliate === B.affiliate ? "" : B.affiliate);
    ok((await p.inputValue(`[data-pid="${A.id}"]`)) === "201.4", "changing affiliate keeps unsaved weights");
    await p.click("#bSave"); await wait(p, 800);
    ok(/2 weights saved/.test(await p.locator("#toast").innerText()), "saving includes entries hidden by the filter");
    const pa = await api(p, "GET", "player", { params: { id: A.id } }), pb = await api(p, "GET", "player", { params: { id: B.id } });
    const wa = pa.weights.find((x) => x.weight === 201.4), wb = pb.weights.find((x) => x.weight === 188.8);
    ok(wa && wb && wa.player_id === A.id && wb.player_id === B.id && wa.note === "search test" && wa.date === wb.date, "weights saved to the right players with date and note");
    ok(errs.length === 0, "weigh-ins: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* follow-ups, reports, exports */
  await safe("followups & reports", async () => {
    const { ctx, p, errs } = await fresh(b);
    await go(p, "#/followups/overdue");
    const before = await api(p, "GET", "followups");
    const od = before.filter((f) => f.overdue).length;
    ok(od > 0 && (await p.locator("#fT tr.fu").count()) === od, "overdue view lists exactly the overdue follow-ups");
    ok((await p.locator("#fT thead th").allInnerTexts()).map((x) => x.trim().toLowerCase()).join("|") === "player|reason|latest weight|status", "follow-ups table has four columns: player, reason, latest weight, status");
    await p.locator("[data-t]").first().click();
    ok(/Assigned to/i.test(await p.locator("#fT tr.fu-more").innerText()) && (await p.locator("#fT tr.fu-more [data-r]").count()) === 1, "row details show assignment, priority and Reschedule");
    await p.locator("[data-c]").first().click(); await wait(p, 600);
    ok((await api(p, "GET", "followups")).filter((f) => f.overdue).length === od - 1, "completing a follow-up removes it from overdue");
    await go(p, "#/reports/weight_change");
    ok((await p.locator("#rT tbody tr").count()) > 10, "report: weight change over a period");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#rCsv")]);
    const f = path.join(os.tmpdir(), "fuel-report.csv"); await dl.saveAs(f);
    ok(/^Player,Player ID,Affiliate,Weigh-ins/.test(fs.readFileSync(f, "utf8")), "report CSV export downloads with headers");
    await setRole(p, "admin");
    await go(p, "#/data/audit");
    ok(/Exported report/.test(await p.locator("#aT").innerText()), "the export is recorded in the audit log");
    for (const r of ["missing_weighins", "dexa_change", "performance_trends", "followup_status"]) { await go(p, "#/reports/" + r); ok((await p.locator("#rT tbody tr").count()) > 0, `report: ${r}`); }
    ok(errs.length === 0, "reports: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
