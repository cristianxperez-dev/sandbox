/* Manager Hub — Camp, in the real app: create a camp with the Florida preset, add players from several
   affiliates, groups, activities (add / drag / resize / duplicate / keyboard), conflicts, copy day,
   templates, publish, print preview, undo, storage recovery, phone layout. Rosters and the affiliate
   schedule must be untouched.
   BASE=…/apps/manager-hub/ [MH_ACCESS_CODE=…] [SHOTS=dir] node manager-hub/tests/camp.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
async function signIn(ctx) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(BASE);
  const r = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign-in failed " + r.status());
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

/* obviously test-only players, written through the app's own roster route */
function seedRosters() {
  const mk = (aff, pos, grp, n, start) => Array.from({ length: n }, (_, i) => ({
    id: `zz-${aff}-${pos.toLowerCase()}-${i}`, first: `Testonly${String.fromCharCode(65 + start + i)}`, last: `Zzcamp${aff.toUpperCase()}${pos}${i}`,
    position: pos, pos2: "", group: grp, bats: i % 2 ? "L" : "R", throws: i % 3 ? "R" : "L", number: String(start * 10 + i + 1),
    level: "", status: i === 0 && grp === "pitcher" ? "60D" : "ACT", notes: "", extra: {} }));
  RosterRoute.writeRoster("sl", mk("sl", "RHP", "pitcher", 4, 0).concat(mk("sl", "C", "position", 2, 4)));
  RosterRoute.writeRoster("cc", mk("cc", "LHP", "pitcher", 3, 6).concat(mk("cc", "IF", "position", 3, 9)));
  RosterRoute.writeRoster("fay", mk("fay", "OF", "position", 2, 12));
}
const rostersJSON = () => JSON.stringify(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)]));
const campState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("cs.camp.v1")));
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function freshPage(b, w, hgt) {
  const ctx = await b.newContext({ viewport: { width: w, height: hgt }, acceptDownloads: true });
  await signIn(ctx);
  await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE); await p.evaluate(() => { localStorage.clear(); localStorage.setItem("cs.affiliate", "sl"); }); await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(seedRosters);
  return { ctx, p, errs };
}
async function createCamp(p, name) {
  await p.click('[data-view="camp"]'); await p.waitForTimeout(250);
  await p.fill("#cfName", name);
  await p.fill("#cfStart", "2027-02-15"); await p.fill("#cfEnd", "2027-02-21");
  await p.click('[data-ca="create-camp"]'); await p.waitForTimeout(250);
}
/** centre-x of a facility column and the y of a minute on the grid */
async function slot(p, facName, minute) {
  return p.evaluate(([n, m]) => {
    const st = CampUI._debug.state(), camp = st.camps.find((c) => c.id === st.activeCampId);
    const f = camp.facilities.find((x) => x.name === n);
    const col = document.querySelector(`.c-gcol[data-fid="${f ? f.id : ""}"]`);
    col.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = col.getBoundingClientRect();
    const win = Math.floor(Math.min(camp.dayWindow.start, ...camp.draft.activities.map((a) => a.start)) / 60) * 60;
    return { x: r.left + r.width / 2, y: r.top + (m - win) * 2 + 6, fid: f ? f.id : "" };
  }, [facName, minute]);
}
async function addAt(p, fac, minute, title, groupName) {
  const s = await slot(p, fac, minute);
  await p.mouse.click(s.x, s.y); await p.waitForTimeout(200);
  await p.fill("#caTitle", title); await p.press("#caTitle", "Tab"); await p.waitForTimeout(150);
  if (groupName) { await p.click(`#cPanel label.c-ck:has-text("${groupName}") input`); await p.waitForTimeout(150); }
}
const actsOn = (st, date) => st.camps[0].draft.activities.filter((a) => a.date === date);

(async () => {
  const b = await chromium.launch();

  /* ================= desktop ================= */
  {
    const { ctx, p, errs } = await freshPage(b, 1366, 900);
    const sectionsBefore = await p.evaluate(() => JSON.stringify(S.sections));
    const rostersBefore = await p.evaluate(rostersJSON);

    await p.click('[data-view="camp"]'); await p.waitForTimeout(300);
    ok(await p.isVisible("#cCreateForm") && /Create your first camp/i.test(await p.innerText(".camp")), "desktop: empty Camp tab offers “Create your first camp”");
    ok(/14 players/.test(await p.innerText(".c-poolsum")) && /3 affiliates/.test(await p.innerText(".c-poolsum")), "desktop: first run counts the org pool across affiliates");
    await shot(p, "desktop-01-first-run");
    await p.click('[data-ca="create-camp"]'); await p.waitForTimeout(150);
    ok(/name/i.test(await p.innerText("#cfErr")), "desktop: a camp needs a name (validation message)");
    await createCamp(p, "Test Camp — Florida");
    let st = await campState(p);
    ok(st && st.camps.length === 1 && st.camps[0].tz === "America/New_York" && st.camps[0].start === "2027-02-15", "desktop: camp saved to cs.camp.v1 with dates and default timezone");
    const facs = st.camps[0].facilities.map((f) => f.name);
    ok(facs.length === 13 && facs.includes("Field 4") && facs.includes("Cage 4") && facs.includes("Bullpen mounds (8)") && facs.includes("Meeting room"), "desktop: Florida preset facilities created");
    ok((await p.$$(".c-gh")).length === 13, "desktop: one grid column per facility");
    ok(/Times in EST/.test(await p.innerText(".c-head")), "desktop: header shows the camp's timezone");

    /* ---- players ---- */
    await p.click('[data-ca="tab"][data-k="players"]'); await p.waitForTimeout(200);
    ok((await p.$$(".c-pr:not(.c-phead)")).length === 14, "desktop: pool lists every affiliate's players (14)");
    await p.selectOption('[data-cf="pf-role"]', "catcher"); await p.waitForTimeout(100);
    ok((await p.$$(".c-pr:not(.c-phead)")).length === 2, "desktop: catcher filter (position C)");
    await p.selectOption('[data-cf="pf-role"]', ""); await p.fill('[data-cf="pf-q"]', "zzcampcc"); await p.waitForTimeout(100);
    ok((await p.$$(".c-pr:not(.c-phead)")).length === 6, "desktop: search by name");
    await p.fill('[data-cf="pf-q"]', "62"); await p.waitForTimeout(100);
    ok((await p.$$(".c-pr:not(.c-phead)")).length === 1, "desktop: search by number");
    await p.click('[data-ca="pf-clear"]'); await p.waitForTimeout(100);
    const filtersShown = await p.$$eval(".c-fchip", (els) => els.map((e) => e.innerText.split("\n")[0]));
    ok(filtersShown.join(",") === "SL,CC,FAY", "desktop: affiliate filters list only levels present in the data");
    // shift-click range selection
    const cbs = await p.$$('.c-pr:not(.c-phead) [data-ca="p-cb"]');
    await cbs[0].click(); await (await p.$$('.c-pr:not(.c-phead) [data-ca="p-cb"]'))[3].click({ modifiers: ["Shift"] }); await p.waitForTimeout(100);
    ok(/4 selected/.test(await p.innerText(".c-selbar")), "desktop: shift-click selects a range");
    await p.click('.c-selbar [data-ca="p-add"]'); await p.waitForTimeout(150);
    await p.click('.c-fchip[data-k="cc"]'); await p.waitForTimeout(100);
    await p.click('[data-ca="p-addfiltered"]'); await p.waitForTimeout(150);
    await p.click('.c-fchip[data-k="cc"]'); await p.click('.c-fchip[data-k="sl"]'); await p.waitForTimeout(100);
    await p.click('[data-ca="p-addfiltered"]'); await p.waitForTimeout(150);
    await p.click('.c-fchip[data-k="sl"]'); await p.waitForTimeout(100);
    st = await campState(p);
    const affsIn = new Set(st.camps[0].players.map((x) => x.split(":")[0]));
    ok(st.camps[0].players.length >= 12 && affsIn.has("sl") && affsIn.has("cc"), "desktop: players from ≥2 affiliates added (ids are affId:playerId)");
    ok((await p.$$eval(".c-pr:not(.c-phead) .c-pc-aff .c-aff", (els) => els.map((e) => e.textContent))).every((t) => /^(SL|CC|FAY)$/.test(t)), "desktop: home affiliate tag on each player");
    // group from selection: CC pitchers → Relievers
    await p.click('.c-fchip[data-k="cc"]'); await p.selectOption('[data-cf="pf-role"]', "pitcher"); await p.waitForTimeout(100);
    await p.click('[data-ca="p-all"]'); await p.waitForTimeout(80);
    await p.click('.c-selbar [data-ca="p-newgroup"]'); await p.waitForTimeout(150);
    await p.fill("#cAsk", "Relievers"); await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(150);
    await p.click('[data-ca="pf-clear"]');
    await shot(p, "desktop-02-players");
    ok(await noOverflow(p), "desktop: players tab — no horizontal overflow");

    /* ---- groups ---- */
    await p.click('[data-ca="tab"][data-k="groups"]'); await p.waitForTimeout(150);
    await p.click('[data-ca="g-preset"][data-k="Catchers"]'); await p.waitForTimeout(150);
    await p.click('[data-ca="g-preset"][data-k="Early Work"]'); await p.waitForTimeout(150);
    st = await campState(p);
    const g = (n) => st.camps[0].groups.find((x) => x.name === n);
    ok(g("Catchers") && g("Catchers").players.length === 2 && g("Relievers") && g("Relievers").players.length === 3, "desktop: groups — Catchers prefilled with camp catchers, Relievers from selection");
    // add a member by search (a player in two groups)
    const ewId = g("Early Work").id;
    await p.fill(`[data-cf="g-search"][data-k="${ewId}"]`, "Zzcampslc"); await p.waitForTimeout(150);
    await p.click(`[data-sugg="${ewId}"] .c-sg >> nth=0`); await p.waitForTimeout(150);
    st = await campState(p);
    ok(g("Early Work").players.length === 1 && g("Catchers").players.includes(g("Early Work").players[0]), "desktop: a player can be in several groups");
    await shot(p, "desktop-03-groups");

    /* ---- staff ---- */
    await p.click('[data-ca="tab"][data-k="staff"]'); await p.waitForTimeout(150);
    await p.fill("#csName", "Test Coachone"); await p.click('[data-ca="s-add"]'); await p.waitForTimeout(150);
    await p.click('[data-ca="s-import"]'); await p.waitForTimeout(150);
    ok(await p.isVisible(".c-dlg"), "desktop: “pick from affiliate coach lists” opens");
    await p.click(".c-dlg .x"); await p.waitForTimeout(80);

    /* ---- schedule: add, conflict, drag, resize, duplicate, keyboard ---- */
    await p.click('[data-ca="tab"][data-k="schedule"]'); await p.waitForTimeout(150);
    await addAt(p, "Field 1", 480, "Team Fundamentals", "Catchers");
    await p.click(`#cPanel label.c-ck:has-text("Test Coachone") input`); await p.waitForTimeout(100);
    st = await campState(p);
    let A = actsOn(st, "2027-02-15")[0];
    ok(A && A.start === 480 && A.title === "Team Fundamentals" && A.cat === "fundamentals" && A.groups.length === 1, "desktop: click an empty slot → activity at 8:00, library title sets category");
    await p.click('[data-ca="panel-close"] >> nth=0'); await p.waitForTimeout(100);
    await addAt(p, "Cage 1", 480, "Cage Work", "Catchers");
    await p.click('[data-ca="panel-close"] >> nth=0'); await p.waitForTimeout(150);
    ok(/1 conflict/.test(await p.innerText(".c-confbtn")) && (await p.$$(".c-blk.has-err")).length === 2, "desktop: catchers double-booked via the group → conflict badge and block markers");
    await p.click('[data-ca="conf-toggle"]'); await p.waitForTimeout(100);
    ok(/2 players are in both/.test(await p.innerText(".c-conflist")), "desktop: conflict list explains the clash");
    await shot(p, "desktop-04-conflict");
    await p.click('.c-cl-item.error'); await p.waitForTimeout(200);
    ok(await p.isVisible("#cPanel .c-pc.error"), "desktop: “Show” jumps to the block and opens it with its conflict");
    await p.click('[data-ca="panel-close"] >> nth=0'); await p.waitForTimeout(100);

    // drag Cage Work down an hour and across to Cage 2 (mouse)
    st = await campState(p);
    let B = actsOn(st, "2027-02-15").find((a) => a.title === "Cage Work");
    let box = await (await p.$(`.c-blk[data-aid="${B.id}"]`)).boundingBox();
    const c2 = await slot(p, "Cage 2", 540);
    box = await (await p.$(`.c-blk[data-aid="${B.id}"]`)).boundingBox();
    await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down();
    await p.mouse.move(box.x + 40, box.y + 60, { steps: 4 }); await p.mouse.move(c2.x, box.y + 10 + 120, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    st = await campState(p); B = actsOn(st, "2027-02-15").find((a) => a.id === B.id);
    ok(B.start === 540 && B.facilityId === c2.fid, "desktop: drag moves a block an hour later and to another facility");
    ok(!/\d+ conflict/.test(await p.innerText(".c-confbtn")) && (await p.$$(".c-blk.has-err")).length === 0, "desktop: conflict resolved by the move");
    // resize the bottom edge +30 px = +15 min
    box = await (await p.$(`.c-blk[data-aid="${B.id}"] .c-rsz`)).boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 3); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2, box.y + 33, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
    st = await campState(p); B = actsOn(st, "2027-02-15").find((a) => a.id === B.id);
    ok(B.dur === 45, "desktop: dragging the bottom edge resizes (30 → 45 min)");
    // keyboard: ArrowDown moves 5 min, Alt+ArrowDown lengthens
    await p.focus(`.c-blk[data-aid="${B.id}"]`); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Alt+ArrowDown"); await p.waitForTimeout(150);
    st = await campState(p); B = actsOn(st, "2027-02-15").find((a) => a.id === B.id);
    ok(B.start === 545 && B.dur === 50 && (await p.evaluate(() => document.activeElement.classList.contains("c-blk"))), "desktop: keyboard moves (+5) and resizes (+5) a focused block");
    await p.keyboard.press("ArrowUp"); await p.keyboard.press("Alt+ArrowUp"); await p.waitForTimeout(100);
    // duplicate Team Fundamentals from the panel
    A = actsOn(await campState(p), "2027-02-15").find((a) => a.title === "Team Fundamentals");
    await p.click(`.c-blk[data-aid="${A.id}"]`); await p.waitForTimeout(150);
    await p.click('[data-ca="dup-act"]'); await p.waitForTimeout(150);
    st = await campState(p);
    const tf = actsOn(st, "2027-02-15").filter((a) => a.title === "Team Fundamentals");
    ok(tf.length === 2 && tf.some((a) => a.start === 510), "desktop: duplicate places a copy right after the original");
    await p.click('[data-ca="panel-close"] >> nth=0'); await p.waitForTimeout(100);
    // staff double-booking: put the coach on Cage Work too, overlapping the 8:30 copy? (9:00 vs 8:30–8:50 no) → move copy into overlap
    const copy = tf.find((a) => a.start === 510);
    await p.click(`.c-blk[data-aid="${copy.id}"]`); await p.waitForTimeout(120);
    await p.selectOption("#caDur", "45"); await p.waitForTimeout(120);
    await p.click(`.c-blk[data-aid="${B.id}"]`); await p.waitForTimeout(120);
    await p.click(`#cPanel label.c-ck:has-text("Test Coachone") input`); await p.waitForTimeout(150);
    ok(/Test Coachone is assigned to both/.test(await p.innerText("#cPanel")), "desktop: staff double-booking detected");
    await p.click(`#cPanel label.c-ck:has-text("Test Coachone") input`); await p.waitForTimeout(150);
    await p.selectOption('#cPanel [data-cf="a-fac"]', { label: "Field 1" }); await p.waitForTimeout(150);
    ok(/Field 1 is double-booked/.test(await p.innerText("#cPanel")), "desktop: facility double-booking detected (capacity 1 activity at once)");
    await p.keyboard.press("Control+z"); await p.waitForTimeout(150);
    st = await campState(p);
    ok(actsOn(st, "2027-02-15").find((a) => a.id === B.id).facilityId === c2.fid, "desktop: Undo restores the previous facility");
    await p.click('[data-ca="panel-close"] >> nth=0'); await p.waitForTimeout(100);
    await shot(p, "desktop-05-grid");

    /* ---- agenda + week ---- */
    await p.click('[data-ca="view"][data-k="agenda"]'); await p.waitForTimeout(120);
    ok((await p.$$(".c-ag-item")).length === 3, "desktop: agenda lists the day's activities");
    await p.click('[data-ca="view"][data-k="week"]'); await p.waitForTimeout(120);
    ok((await p.$$(".c-wday")).length === 7, "desktop: week view shows the camp's days");
    await shot(p, "desktop-06-week");
    await p.click('.c-wd-head[data-k="2027-02-15"]'); await p.waitForTimeout(120);

    /* ---- copy day, template ---- */
    await p.click('[data-ca="day-menu"]'); await p.waitForTimeout(80);
    await p.click('.c-menu button:has-text("Duplicate to next day")'); await p.waitForTimeout(150);
    st = await campState(p);
    ok(actsOn(st, "2027-02-16").length === 3 && actsOn(st, "2027-02-16").every((a) => !actsOn(st, "2027-02-15").some((x) => x.id === a.id)), "desktop: duplicate day copies every activity with new ids");
    await p.click('[data-ca="day-menu"]'); await p.click('.c-menu button:has-text("Copy this day to")'); await p.waitForTimeout(120);
    await p.selectOption("#ccFrom", "2027-02-18"); await p.selectOption("#ccTo", "2027-02-19"); await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(150);
    st = await campState(p);
    ok(actsOn(st, "2027-02-18").length === 3 && actsOn(st, "2027-02-19").length === 3, "desktop: copy a day to a date range");
    await p.click('[data-ca="day-menu"]'); await p.click('.c-menu button:has-text("Save day as template")'); await p.waitForTimeout(120);
    await p.fill("#cAsk", "Standard camp day"); await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(150);
    await p.selectOption('[data-cf="day"]', "2027-02-20"); await p.waitForTimeout(120);
    await p.click('[data-ca="day-menu"]'); await p.click('.c-menu button:has-text("Apply a template")'); await p.waitForTimeout(120);
    await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(150);
    st = await campState(p);
    const d20 = actsOn(st, "2027-02-20");
    ok(st.templates.length === 1 && d20.length === 3 && d20.some((a) => a.title === "Cage Work" && a.facilityId === c2.fid && a.groups.length === 1), "desktop: template saved and applied (facility + group matched)");

    /* ---- publish ---- */
    await p.click('.c-headact [data-ca="publish"]'); await p.waitForTimeout(150);
    ok(/15 added/.test(await p.innerText(".c-dlg")), "desktop: publish shows a diff summary first");
    await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(150);
    ok(/Published/.test(await p.innerText(".c-status")), "desktop: published state shown");
    await p.selectOption('[data-cf="day"]', "2027-02-15"); await p.waitForTimeout(100);
    const blk = await p.$(".c-blk"); await blk.focus(); await p.keyboard.press("Shift+ArrowDown"); await p.waitForTimeout(150);
    ok(/Unpublished changes/.test(await p.innerText(".c-head")), "desktop: an edit after publishing shows “Unpublished changes”");
    await p.click('.c-headact [data-ca="publish"]'); await p.waitForTimeout(150);
    ok(/1 changed/.test(await p.innerText(".c-dlg")) && /start/.test(await p.innerText(".c-dlg")), "desktop: diff names the changed activity and field");
    await p.click(".c-dlg .x"); await p.waitForTimeout(80);
    st = await campState(p);
    ok(st.camps[0].published && st.camps[0].published.activities.length === 15, "desktop: the published snapshot is unchanged by later draft edits");

    /* ---- print / export ---- */
    await p.click('[data-ca="print"]'); await p.waitForTimeout(120);
    await p.click('.c-pkind:has-text("Player view")'); await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(200);
    const pv = await p.innerText(".c-printroot");
    ok(await p.isVisible(".c-printroot .c-sheet") && /Published/.test(pv) && /Zzcamp/.test(pv) && /Team Fundamentals/.test(pv), "desktop: player itinerary print preview from the published version");
    await shot(p, "desktop-07-print-player");
    await p.emulateMedia({ media: "print" }); await p.waitForTimeout(100);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".camp .c-main")).display === "none" && getComputedStyle(document.querySelector(".camp .c-printroot")).display !== "none"), "desktop: print media shows only the sheets");
    await p.emulateMedia({ media: "screen" });
    await p.click('[data-ca="print-close"]'); await p.waitForTimeout(100);
    await p.click('[data-ca="print"]'); await p.waitForTimeout(120);
    await p.selectOption("#cpVer", "draft"); await p.click(".c-dlg .mfoot .btn.primary"); await p.waitForTimeout(200);
    ok(await p.isVisible(".c-pv-pages.draft .c-sheet.land") && /DRAFT/.test(await p.innerText(".c-sh-stamp")), "desktop: daily grid prints the draft clearly marked DRAFT");
    await shot(p, "desktop-08-print-daily");
    await p.click('[data-ca="print-close"]'); await p.waitForTimeout(100);
    await p.click('[data-ca="print"]'); await p.waitForTimeout(120);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click('.c-dlg .mfoot .btn:has-text("CSV")')]);
    const csvPath = await dl.path(); const csv = require("fs").readFileSync(csvPath, "utf8");
    ok(/^Camp,Date,Start/.test(csv) && /Team Fundamentals/.test(csv), "desktop: CSV export of the day");
    await p.click(".c-dlg .x");

    /* ---- delete with confirmation, undo ---- */
    const n0 = (await campState(p)).camps[0].draft.activities.length;
    await p.focus(".c-blk"); await p.keyboard.press("Delete"); await p.waitForTimeout(150);
    const n1 = (await campState(p)).camps[0].draft.activities.length;
    await p.click('.c-headact [data-ca="undo"]'); await p.waitForTimeout(150);
    ok(n1 === n0 - 1 && (await campState(p)).camps[0].draft.activities.length === n0, "desktop: delete (confirmed) and undo");

    /* ---- invariants ---- */
    ok(await p.evaluate((r) => JSON.stringify(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)])) === r, rostersBefore), "desktop: affiliate rosters unchanged by every camp operation");
    ok(await p.evaluate((s) => JSON.stringify(S.sections) === s, sectionsBefore), "desktop: affiliate schedule (S.sections) untouched");
    ok(await p.evaluate(() => Object.keys(localStorage).filter((k) => /camp/i.test(k)).join(",") === "cs.camp.v1"), "desktop: camp data lives only in cs.camp.v1 (not affiliate-scoped)");
    ok(await noOverflow(p), "desktop: no horizontal page overflow");

    /* ---- persistence and corrupt storage ---- */
    await p.reload(); await p.waitForTimeout(500); await p.click('[data-view="camp"]'); await p.waitForTimeout(250);
    ok(/Test Camp/i.test(await p.innerText(".c-head")), "desktop: camp persists across reloads");
    await p.evaluate(() => localStorage.setItem("cs.camp.v1", "{not json")); await p.reload(); await p.waitForTimeout(500);
    await p.click('[data-view="camp"]'); await p.waitForTimeout(250);
    const bk = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cs.camp.v1.backup.")).map((k) => localStorage.getItem(k)));
    ok(await p.isVisible(".c-banner") && await p.isVisible("#cCreateForm") && bk[0] === "{not json", "desktop: corrupt storage doesn't crash; unreadable copy backed up; banner explains");
    ok(errs.length === 0, "desktop: no page errors" + (errs.length ? " — " + errs.join(" | ") : ""));
    await ctx.close();
  }

  /* ================= phone ================= */
  {
    const { ctx, p, errs } = await freshPage(b, 390, 844);
    await p.click(".seg button[data-view=camp]").catch(async () => p.evaluate(() => go("camp")));
    await p.waitForTimeout(250);
    if (!(await p.isVisible("#cCreateForm"))) await p.evaluate(() => go("camp"));
    ok(await noOverflow(p), "phone: first run — no horizontal overflow");
    await shot(p, "phone-01-first-run");
    await p.fill("#cfName", "Phone Camp"); await p.fill("#cfStart", "2027-02-15"); await p.fill("#cfEnd", "2027-02-17");
    await p.click('[data-ca="create-camp"]'); await p.waitForTimeout(250);
    ok(await p.$eval('[data-ca="view"][data-k="agenda"]', (e) => e.getAttribute("aria-selected") === "true"), "phone: schedule opens on the agenda");
    await p.click('.c-tb [data-ca="add-act"]'); await p.waitForTimeout(200);
    ok(await p.isVisible("#cPanel #caTitle"), "phone: add opens the editor sheet");
    await p.fill("#caTitle", "Stretch"); await p.press("#caTitle", "Tab"); await p.waitForTimeout(120);
    await shot(p, "phone-02-editor");
    await p.click('.c-pf [data-ca="panel-close"]'); await p.waitForTimeout(150);
    ok((await p.$$(".c-ag-item")).length === 1 && /Stretch/.test(await p.innerText(".c-agenda")), "phone: activity appears in the agenda");
    ok(await noOverflow(p), "phone: agenda — no horizontal overflow");
    await shot(p, "phone-03-agenda");
    await p.click('[data-ca="view"][data-k="grid"]'); await p.waitForTimeout(150);
    ok(await noOverflow(p) && await p.evaluate(() => { const w = document.querySelector("#cGridWrap"); return w.scrollWidth > w.clientWidth; }), "phone: facility grid scrolls inside its own container");
    await shot(p, "phone-04-grid");
    for (const t of ["players", "groups", "staff", "setup"]) {
      await p.click(`[data-ca="tab"][data-k="${t}"]`); await p.waitForTimeout(150);
      ok(await noOverflow(p), `phone: ${t} tab — no horizontal overflow`);
      if (t === "players") await shot(p, "phone-05-players");
    }
    ok(errs.length === 0, "phone: no page errors" + (errs.length ? " — " + errs.join(" | ") : ""));
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
