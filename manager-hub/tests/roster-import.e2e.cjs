/* Manager Hub — organisational roster import (Last_First / Handedness / LEVELOFPLAY_LK export format).
   Uses fictional players only (fixtures/org-roster-sample.csv). Run after node scripts/serve.mjs:
     node manager-hub/tests/roster-import.e2e.cjs        (BASE=… for another host) */
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";

/* behind the Sandbox access gate: sign the browser context in first (MH_ACCESS_CODE; never stored in the repo) */
async function signIn(ctx, base) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(base), app = u.pathname.replace(/[^/]*$/, "");
  const r = await ctx.request.post(u.origin + app + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("access gate sign-in failed: " + r.status());
}
const CSV = path.join(__dirname, "fixtures", "org-roster-sample.csv");
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };

async function openImport(p) {
  await p.evaluate(() => { if (typeof closeModal === "function") closeModal(); rosterModal(); });
  await p.waitForSelector("#rosImport");
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#rosImport")]);
  await fc.setFiles(CSV); await p.waitForSelector("#impBody .imp-section");
}
const rosters = (p) => p.evaluate(() => Object.fromEntries(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)])));

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, mobile: true }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    await signIn(ctx, BASE);
    // these checks control the roster themselves: the shipped organisation roster is tested separately
    await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
    const p = await ctx.newPage(), errs = [], W = vp.width;
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await p.reload(); await p.waitForTimeout(800);
    await p.evaluate(() => RosterRoute.writeRoster("sl", [
      { id: "seedly-ivo", first: "Ivo", last: "Seedly", position: "P", group: "pitcher", bats: "", throws: "R", number: "33", level: "", status: "", notes: "kept", extra: {} },
      { id: "only-here", first: "Una", last: "Onlyhere", position: "C", group: "position", bats: "R", throws: "R", number: "", level: "", status: "", notes: "", extra: {} }]));

    await openImport(p);
    const body = await p.locator("#impBody").innerText();
    ok(!/Missing required column/.test(body), `${W}: the export's columns are recognised (no missing-column errors)`);
    ok(/from Name \(Last, First\)/.test(await p.locator("#impBody").innerHTML()) && /from Handedness/.test(await p.locator("#impBody").innerHTML()), `${W}: Last/First and Bats/Throws shown as coming from Name and Handedness`);
    ok(/1 Level value not recognised/.test(body) && /X9/.test(body) && (await p.locator("#impGo").innerText()) === "Resolve levels to import", `${W}: an unknown level is flagged and blocks the import — never guessed`);
    ok(await p.locator("#impGo").isDisabled(), `${W}: import button disabled until resolved`);
    if (W > 1000) {
      // resolve it by hand without remembering it, then import
      await p.uncheck('[data-lvlsave="X9"]'); await p.selectOption('[data-lvlfix="X9"]', "ash");
    } else {
      await p.selectOption('[data-lvlfix="X9"]', "ash");
    }
    await p.waitForTimeout(100);
    ok(/Import 11 records/.test(await p.locator("#impGo").innerText()), `${W}: 11 records ready (12 unique players minus the one already on the roster, which updates)`);
    await p.click("#impGo"); await p.waitForTimeout(300);
    const sum = await p.locator("#modal").innerText();
    ok(/10 added · 1 updated/.test(sum) && /1 skipped/.test(sum), `${W}: summary — 10 added, 1 updated, the duplicate row skipped`);
    ok(/new \(\d+ pitchers?, \d+ position players?\)/.test(sum) || /new (pitchers|position players)/.test(sum), `${W}: summary says what went to which roster`);
    let R = await rosters(p);
    const count = (id, g) => R[id].filter((x) => (g ? x.group === g : true)).length;
    ok(count("fcl") === 2 && count("fay") === 2 && count("ash") === 3 && count("cc") === 2 && count("sl") === 3, `${W}: routed by level — FCL 2, FAY 2, ASH 3 (incl. the hand-resolved row), CC 2, SL 3 (incl. one already there)`);
    ok(count("cc", "pitcher") === 1 && count("cc", "position") === 1 && count("fay", "pitcher") === 1, `${W}: pitchers and position players kept on their own rosters`);
    const find = (id, last) => R[id].find((x) => x.last === last);
    ok(find("fcl", "Sample").bats === "S" && find("fcl", "Sample").throws === "", `${W}: position player — Handedness is Bats; Throws left blank`);
    ok(find("fay", "Example").throws === "L" && find("fay", "Example").bats === "", `${W}: pitcher — Handedness is Throws; Bats left blank`);
    ok(find("fay", "Example").status === "60D" && find("ash", "Mockley").status === "FSIL" && find("cc", "Holder").status === "RES", `${W}: roster status codes kept exactly as written`);
    ok(find("sl", "Stubbs").age === "25.5" && find("sl", "Stubbs").first === "Jay", `${W}: "Last, First" split; age kept`);
    const ivo = find("sl", "Seedly");
    ok(ivo.id === "seedly-ivo" && ivo.number === "33" && ivo.notes === "kept" && ivo.status === "ACT" && R.sl.filter((x) => x.last === "Seedly").length === 1, `${W}: existing player matched (no duplicate), own details kept, blanks filled`);
    ok(!!find("sl", "Onlyhere"), `${W}: a player missing from the file is not removed`);
    // repeatable
    await p.click("#modal [data-close]"); await p.waitForTimeout(200);
    await openImport(p);
    if (await p.locator('[data-lvlfix="X9"]').count()) { await p.selectOption('[data-lvlfix="X9"]', "ash"); await p.waitForTimeout(100); }
    await p.click("#impGo"); await p.waitForTimeout(300);
    ok(/0 added · 0 updated/.test(await p.locator("#modal").innerText()), `${W}: importing the same file again changes nothing`);
    R = await rosters(p);
    { const tot = Object.values(R).reduce((n, l) => n + l.length, 0); ok(tot === 12, `${W}: still 12 players in total (10 imported + 2 already there) — no duplicates`); }
    // search and selection
    await p.evaluate(() => { closeModal(); ROSTER_GROUP = "position"; rosterModal(); });
    await p.fill("#rosSearch", "stub"); await p.waitForTimeout(100);
    ok((await p.locator("#rosBody .ros-row").count()) === 1 && /Jay Stubbs/.test(await p.locator("#rosBody").innerText()), `${W}: roster search finds a player by partial name`);
    ok(/ACT/.test(await p.locator("#rosBody").innerText()), `${W}: roster status shown on the row`);
    await p.fill("#rosSearch", ""); await p.waitForTimeout(100);
    if (W < 500) ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, `${W}: roster screen fits the phone`);
    const sel = await p.evaluate(() => ({ pitchers: Roster.pitchers().map((x) => x.last), pos: Roster.positionPlayers().map((x) => x.last + ":" + x.position) }));
    ok(sel.pitchers.includes("Seedly") && sel.pos.includes("Stubbs:OF") && sel.pos.includes("Onlyhere:C"), `${W}: imported players available to the pitching grid and lineup/matrix pickers`);
    ok(errs.length === 0, `${W}: no page errors ${errs.join(" | ")}`);
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
