/* Manager Hub 3.0 — Spring Training, end to end in the real app.
   One coordinator and two coaches in separate browsers (separate storage) share one store: the REAL
   functions/apps/manager-hub/api/ops.js handler over an in-memory D1 (st-fixture.cjs), with a coordinator code.
   160 fictional players, groups A–D + role groups, several facilities, two games at once on the same day.
     node manager-hub/tests/st.e2e.cjs            (serve the site first: node scripts/serve.mjs)
     SHOTS=dir node manager-hub/tests/st.e2e.cjs  (also writes screenshots) */
const { chromium, devices } = require("playwright");
const F = require("./st-fixture.cjs");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const shot = async (p, n, full) => { if (SHOTS) { await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: !!full }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const wait = (p, ms) => p.waitForTimeout(ms || 200);

async function browserFor(b, env, who, view) {
  const ctx = await b.newContext(Object.assign({ acceptDownloads: true }, view || { viewport: { width: 1440, height: 920 } }));
  await F.shareStore(ctx, env);
  await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? (p._prompt || "") : undefined));
  await p.goto(BASE);
  await p.evaluate((w) => { localStorage.clear(); localStorage.setItem("cs.affiliate", "fcl"); if (w) localStorage.setItem("cs.st.me", JSON.stringify(w)); }, who || null);
  await p.reload(); await wait(p, 600);
  await p.evaluate(F.seedRosters);
  await p.evaluate(() => go("camp")); await wait(p, 300);
  return { ctx, p, errs };
}
const server = async (env, sql, ...args) => { const st = env.MH_AI_USAGE._db.prepare(sql); return st.all(...args); };
const doc = async (env, id) => { const r = await server(env, "SELECT value, version FROM mh_ops WHERE id = ?", id); return r[0] ? Object.assign(JSON.parse(r[0].value), { _v: r[0].version }) : null; };
const pull = async (p) => { await p.evaluate(() => StSync.pullCamp(CampUI.api, CampUI.api.cur().id)); await wait(p, 250); };

(async () => {
  const { fakeD1 } = await import("./fake-d1.mjs");
  const env = { MH_AI_USAGE: fakeD1(), MH_COORDINATOR_CODE: "bullpen-7" };
  const b = await chromium.launch();

  /* ============ 1. Coordinator: camp, 160 players, groups, sharing ============ */
  const A = await browserFor(b, env, null);
  const pa = A.p;
  const rostersBefore = await pa.evaluate(() => JSON.stringify(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)])));
  const sectionsBefore = await pa.evaluate(() => JSON.stringify(S.sections));
  ok(await pa.isVisible("#cCreateForm") && (await pa.$eval("#cfKind", (e) => e.value)) === "spring", "new camp form offers a type, Spring Training first");
  const campId = await pa.evaluate(F.seedCamp, {});
  ok(await pa.evaluate(() => CampUI.api.cur().players.length) === 160, "160 players from five affiliates in the Spring Training pool");
  ok(await pa.isVisible('[data-ca="tab"][data-k="today"]') && await pa.isVisible('[data-ca="tab"][data-k="games"]'), "Spring Training adds Today and Games; Complex stays the workspace (no sixth affiliate)");
  ok(await pa.evaluate(() => AFFILIATES.length) === 5, "still five workspaces");
  // who's working + share
  await pa.click('[data-ca="tab"][data-k="setup"]'); await wait(pa);
  ok(await pa.isVisible(".st-share") && /This browser only/.test(await pa.innerText(".st-share")), "Setup explains sharing; a camp starts in this browser only");
  await pa.click('[data-ca="st-share"]'); await wait(pa, 300);
  ok(await pa.isVisible("#stWhoName"), "sharing asks who's working first");
  await pa.selectOption("#stWhoPick", "s1"); await wait(pa, 80);
  ok((await pa.inputValue("#stWhoName")) === "Coord Testone" && await pa.isChecked('[name="stRole"][value="coordinator"]'), "picking camp staff fills the name and the coordinator role");
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 800);   // saving the name carries on with the share
  let sv = await doc(env, "camp:" + campId);
  ok(sv && sv.players.length === 160 && sv.groups.length === 7 && sv.kind === "spring", "camp shared: the server has the camp, its 160 player references and 7 groups");
  ok(/Shared/.test(await pa.innerText("#stSyncChip")), "header shows Shared");

  /* ============ 2. Today — the command center ============ */
  await pa.click('[data-ca="tab"][data-k="today"]'); await wait(pa);
  ok(/Day \d+ of 37/i.test(await pa.innerText(".st-hero")) && await pa.isVisible(".st-primary"), "Today: date, camp day and one primary action");
  ok(/Build today's schedule/.test(await pa.innerText(".st-primary")), "with nothing scheduled, the primary action is to build today's schedule");
  ok((await pa.$$(".st-hero-act .btn")).length >= 4 && (await pa.$$(".st-hero-act .btn.primary")).length === 1, "secondary actions are quiet; only one is prominent");
  await shot(pa, "01-today-empty");

  /* ============ 3. Describe the day → proposal → review → added ============ */
  await pa.click('.st-hero [data-ca="st-describe"]'); await wait(pa);
  await pa.fill("#stDText", "Tomorrow we have four groups. Everybody stretches at 9. Groups A and B take defense on Fields 1 and 2 at 9:30. Pitchers start bullpens at 10. Group C hits at 10:15 in Cage 1. All groups break for lunch at noon.");
  await pa.click('[data-ca="st-d-read"]'); await wait(pa, 300);
  const rows = await pa.$$eval(".st-prop tbody tr", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ")));
  ok(rows.length === 6 && /Group A/.test(rows[1]) && /Field 1/.test(rows[1]) && /Group B/.test(rows[2]) && /Field 2/.test(rows[2]), "Describe: six blocks, Groups A/B paired with Fields 1/2 in the order said");
  ok(/Built-in reader/.test(await pa.innerText(".st-d-src")), "the built-in reader is labelled as such");
  await pa.click('[data-ca="st-d-ai"]'); await wait(pa, 400);
  ok(/AI unavailable \(not switched on here\)/.test(await pa.innerText(".st-d-src")) && (await pa.$$(".st-prop tbody tr")).length === 6, "AI unavailable → falls back to the built-in reader and says why");
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 400);
  const today = await pa.evaluate(() => CampUI.api.C.nowIn("America/New_York").date);
  const acts = await pa.evaluate((d) => CampUI.api.cur().draft.activities.filter((a) => a.date === d).length, today);
  ok(acts === 6 && await pa.isVisible("#cGridWrap"), "review → six blocks added to the draft, shown on the facility grid");
  await shot(pa, "02-schedule-described");

  /* ============ 4. Games: two at once on the same day ============ */
  await pa.click('[data-ca="tab"][data-k="games"]'); await wait(pa);
  ok(/No games yet/.test(await pa.innerText(".st-games")), "Games starts empty — nothing invented");
  await pa.click('.st-empty [data-ca="st-new-game"]'); await wait(pa);
  await pa.selectOption("#sgStart", "780"); await pa.fill("#sgSquad", "Triple-A"); await pa.fill("#sgOpp", "Testclub Reds");
  const f1 = await pa.evaluate(() => CampUI.api.cur().facilities.find((f) => f.name === "Field 1").id);
  await pa.selectOption("#sgFac", f1);
  await pa.check('[name="sgCoach"][value="s2"]'); await pa.check('[name="sgGrp"][value="gA"]');
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 300);
  await pa.evaluate(() => {   // the second game (and a few more) through the same path the dialog uses
    const S = StCore, A2 = CampUI.api, c = A2.cur(), d = StSync.games(c.id), t = A2.C.nowIn(c.tz).date;
    d.games.push(S.newGame({ id: "gB", date: t, start: 790, opponent: "Testclub Blues", squad: "Double-A", side: "away", site: "Visitor complex", coaches: ["s3"], groups: ["gB"], format: { innings: 7, dh: true, extraHitters: 2, reentry: true } }));
    for (let i = 1; i <= 8; i++) d.games.push(S.newGame({ id: "gx" + i, date: A2.C.addDays(t, i), start: 780, opponent: "Testclub " + i, squad: i % 2 ? "Single-A" : "Complex" }));
    StSync.setGames(A2, c.id, d); A2.render();
  });
  await wait(pa, 300);
  const gA = await pa.evaluate(() => StSync.games(CampUI.api.cur().id).games.find((g) => g.opponent === "Testclub Reds").id);
  ok(await pa.evaluate(() => StSync.games(CampUI.api.cur().id).games.length) === 10, "ten games entered");

  /* ============ 5. Game Play Matrix ============ */
  await pa.click('[data-ca="st-view"][data-k="matrix"]'); await wait(pa, 300);
  const t0 = Date.now(); await pa.evaluate(() => CampUI.api.setTab("games")); await pa.waitForSelector(".st-mx-t"); const renderMs = Date.now() - t0;
  const cells = await pa.$$eval("td.st-mx-c", (x) => x.length);
  ok(cells > 0 && renderMs < 2500, `matrix renders ${cells} cells for 160 players in ${renderMs} ms`);
  ok(await pa.evaluate(() => { const w = document.querySelector(".st-mx-wrap"); const th = w.querySelector("thead th"); return getComputedStyle(th).position === "sticky" && getComputedStyle(w.querySelector(".st-mx-p")).position === "sticky"; }), "sticky player names and game headers");
  // quick typing in a cell
  const firstPos = await pa.evaluate(() => { const c = CampUI.api.cur(); return c.players.map((p) => CampUI.api.index().get(p)).find((p) => p && p.isCatcher).pid; });
  const cell = (g, pid) => `td.st-mx-c[data-g="${g}"][data-p="${pid}"]`;
  await pa.click(cell(gA, firstPos)); await pa.keyboard.type("c 5"); await pa.keyboard.press("Enter"); await wait(pa, 250);
  let gd = await pa.evaluate(() => StSync.games(CampUI.api.cur().id));
  ok(gd.plan[gA][firstPos].role === "start" && gd.plan[gA][firstPos].pos === "C" && gd.plan[gA][firstPos].inn === 5, "typing “c 5” plans a start at catcher for 5 innings");
  ok(/C 5/.test(await pa.innerText(cell(gA, firstPos))), "the cell shows it");
  // add Group A to the game as available, then a range fill
  await pa.click(`.st-mx-gh button[data-k="${gA}"]`); await wait(pa);
  await pa.click('.c-menu button:has-text("Add players to this game")'); await wait(pa);
  ok(await pa.isChecked('[name="atGrp"][value="gA"]'), "the game's feeding group is preselected");
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 300);
  gd = await pa.evaluate(() => StSync.games(CampUI.api.cur().id));
  const nA = Object.keys(gd.plan[gA]).length;
  ok(nA >= 20, `Group A added to the game (${nA} players in the plan)`);
  // a pitcher via the editor, and a player in BOTH of today's games
  const pitcher = await pa.evaluate(() => CampUI.api.cur().groups.find((g) => g.id === "gSP").players[0]);
  await pa.evaluate(([g, p]) => { const d = StSync.games(CampUI.api.cur().id); StCore.setCell(d, g, p, { role: "pitch", outs: 6, pitches: 35 }); StSync.setGames(CampUI.api, CampUI.api.cur().id, d); }, [gA, pitcher]);
  const both = await pa.evaluate(() => CampUI.api.cur().groups.find((g) => g.id === "gA").players[1]);
  await pa.evaluate(([p]) => { const d = StSync.games(CampUI.api.cur().id); StCore.setCell(d, "gB", p, { role: "start", pos: "SS", inn: 5 }); StSync.setGames(CampUI.api, CampUI.api.cur().id, d); }, [both]);
  await pa.evaluate(() => CampUI.api.render()); await wait(pa, 200);
  // the editor for many cells
  await pa.evaluate(() => CampUI.api.setTab("games")); await wait(pa, 200);
  const rowsPids = await pa.$$eval(`td.st-mx-c[data-g="${gA}"]`, (x) => x.slice(0, 40).map((td) => td.dataset.p));
  await pa.click(cell(gA, rowsPids[10])); await pa.click(cell(gA, rowsPids[13]), { modifiers: ["Shift"] }); await wait(pa, 120);
  ok(/4 cells selected/.test(await pa.innerText(".st-mx-batch")), "shift-click selects a range of cells");
  await pa.keyboard.type("off"); await pa.keyboard.press("Enter"); await wait(pa, 250);
  gd = await pa.evaluate(() => StSync.games(CampUI.api.cur().id));
  ok([10, 11, 12, 13].every((i) => gd.plan[gA][rowsPids[i]] && gd.plan[gA][rowsPids[i]].role === "off"), "typing with a range selected fills every selected cell");
  await pa.keyboard.press("Control+z"); await wait(pa, 250);
  gd = await pa.evaluate(() => StSync.games(CampUI.api.cur().id));
  ok(!gd.plan[gA][rowsPids[10]] || gd.plan[gA][rowsPids[10]].role !== "off", "Ctrl+Z undoes the fill");
  // search + filters keep it fast
  await pa.fill('[data-cf="st-mx-q"]', "TeststSL0"); await wait(pa, 400);
  ok((await pa.$$("tr[data-pid]")).length === 10, "player search narrows the matrix");
  await pa.fill('[data-cf="st-mx-q"]', ""); await wait(pa, 300);
  await pa.selectOption('[data-cf="st-mx-group"]', "gCat"); await wait(pa, 200);
  ok((await pa.$$("tr[data-pid]")).length === await pa.evaluate(() => CampUI.api.cur().groups.find((g) => g.id === "gCat").players.length), "group filter: Catchers only");
  ok(/Catcher innings/i.test(await pa.innerText(".st-mx-sum")), "summary lists catcher innings");
  await pa.selectOption('[data-cf="st-mx-group"]', ""); await wait(pa, 200);
  ok(/Least playing time/i.test(await pa.innerText(".st-mx-sum")) && /have no innings played or planned yet/.test(await pa.innerText(".st-mx-sum")), "summary flags players without playing time");
  // CSV export
  const [dl] = await Promise.all([pa.waitForEvent("download"), (async () => { await pa.click('[data-ca="st-mx-export"]'); await pa.click('.c-menu button:has-text("Spreadsheet")'); })()]);
  const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  ok(/^Player,Affiliate,Position,/.test(csv) && csv.split("\r\n").length > 150, "matrix exports to CSV");
  await shot(pa, "03-matrix");
  // availability: an injured-list player planned → conflict
  const ilPid = await pa.evaluate(() => CampUI.api.pool().find((p) => p.status === "60D").pid);
  await pa.evaluate(([g, p]) => { const d = StSync.games(CampUI.api.cur().id); StCore.setCell(d, g, p, { role: "start", pos: "2B" }); StSync.setGames(CampUI.api, CampUI.api.cur().id, d); CampUI.api.render(); }, [gA, ilPid]);
  // schedule conflicts: games on the grid, players in a game and a workout, the same player in two games
  await pa.evaluate(() => CampUI.api.setTab("schedule")); await wait(pa, 300);
  ok(await pa.evaluate((f) => !!document.querySelector(`.c-gcol[data-fid="${f}"] .c-blk.c-game`), f1) && await pa.evaluate(() => !!document.querySelector('.c-gcol[data-fid=""] .c-blk.c-game')), "games sit on the facility grid: the home game on Field 1, the away game under No facility");
  const conf = await pa.evaluate(() => CampUI.api.conflicts(CampUI.api.cur()).map((c) => c.kind));
  ok(conf.includes("game-game"), "conflict: a player planned in two games at once");
  ok(conf.includes("status"), "conflict: a player on an injured list planned in a game");
  await pa.evaluate(() => { const A2 = CampUI.api, c = A2.cur(), t = A2.C.nowIn(c.tz).date; A2.mutate("late defense", (cc) => cc.draft.activities.push(A2.C.newActivity({ date: t, title: "Team Defense", cat: "fundamentals", start: 800, dur: 30, groups: ["gA"], facilityId: c.facilities.find((f) => f.name === "Field 2").id }))); });
  const conf2 = await pa.evaluate(() => CampUI.api.conflicts(CampUI.api.cur()).map((c) => c.kind));
  ok(conf2.includes("game-player"), "conflict: Group A players in the game and in a workout at the same time");
  await pa.click('[data-ca="conf-toggle"]'); await wait(pa);
  ok(/planned in two games at once/.test(await pa.innerText(".c-conflist")), "conflicts are explained in words");
  await pa.click('[data-ca="conf-toggle"]');
  await pa.evaluate(() => { const A2 = CampUI.api; A2.mutate("undo late defense", (cc) => { cc.draft.activities = cc.draft.activities.filter((a) => !(a.title === "Team Defense" && a.start === 800)); }); });
  // group view
  await pa.click('[data-ca="view"][data-k="agenda"]'); await wait(pa);
  await pa.selectOption('[data-cf="grp-filter"]', "gC"); await wait(pa);
  const agendaC = await pa.innerText(".c-agenda");
  ok(/Cage Work/.test(agendaC) && /Stretch/.test(agendaC) && /Lunch/.test(agendaC) && !/Defense/.test(agendaC), "Group view: Group C's day only (stretch, cage work, lunch — not A/B's defense)");
  await pa.selectOption('[data-cf="grp-filter"]', ""); await pa.click('[data-ca="view"][data-k="grid"]');
  await wait(pa, 1500);   // let the shared store catch up
  await pa.evaluate(() => StSync.flush(CampUI.api, "games:" + CampUI.api.cur().id));
  await pa.evaluate(() => StSync.flush(CampUI.api, "camp:" + CampUI.api.cur().id));
  sv = await doc(env, "games:" + campId);
  ok(sv && sv.games.length === 10 && Object.keys(sv.plan[gA]).length >= 20, "the games and the plan are on the shared store");

  /* ============ 6. Two coaches build lineups independently ============ */
  const B = await browserFor(b, env, { name: "Coach Testtwo", role: "coach", staffId: "s2" });
  const C2 = await browserFor(b, env, { name: "Coach Testthree", role: "coach", staffId: "s3" });
  for (const X of [B, C2]) {
    await wait(X.p, 400);
    ok(await X.p.isVisible(".st-shared-first") && /2027 Minor League Spring Training/.test(await X.p.innerText(".st-shared-first")), "a coach with no local camp is offered the staff's shared camp first");
    await X.p.click('.st-shared-first [data-ca="st-open-remote"]'); await wait(X.p, 900);
  }
  const pb = B.p;
  ok(await pb.evaluate(() => CampUI.api.cur().players.length) === 160 && await pb.evaluate(() => StSync.games(CampUI.api.cur().id).games.length) === 10, "the coach sees the same camp, players and games — no copies");
  ok(/Build lineup/.test(await pb.innerText(".st-primary")), "Today leads a coach to their own game's lineup");
  await shot(pb, "04-coach-today");
  await pb.click(".st-primary"); await wait(pb, 300);
  ok(await pb.isVisible(".st-lb") && /Testclub Reds/i.test(await pb.innerText(".st-lb-head")), "the lineup builder opens on the coach's game");
  ok(/Your draft/.test(await pb.innerText(".st-lb-head")), "a new lineup is a private draft");
  // nine hitters from this game's plan + a starter + bench
  for (let i = 0; i < 9; i++) { const btn = await pb.$('.st-pool li:not(.used) [data-ca="st-lb-add"]'); await btn.click(); await wait(pb, 90); }
  await pb.click('[data-ca="st-lb-prole"][data-k="p"]'); await wait(pb, 150);
  await pb.click('[data-ca="st-lb-tier"][data-k="2"]'); await wait(pb, 150);
  await pb.click('.st-pool li:not(.used) [data-ca="st-lb-add"]'); await wait(pb, 120);
  await pb.click('.st-pool li:not(.used) [data-ca="st-lb-add"]'); await wait(pb, 120);
  await pb.click('[data-ca="st-lb-prole"][data-k=""]'); await pb.click('[data-ca="st-lb-pick"][data-k="b"]'); await wait(pb, 150);
  await pb.click('.st-pool li:not(.used) [data-ca="st-lb-add"]'); await wait(pb, 120);
  let L = await pb.evaluate(() => StUI._st.lb.lineup);
  ok(L.order.filter((o) => o.pid).length === 9 && L.pitchers.length === 2 && L.bench.length === 1, "nine in the order, a starter and a reliever, one on the bench");
  ok(L.order.filter((o) => o.pos).length >= 8, "positions come from the game plan where it has them");
  // reorder (move spot 2 up)
  const before2 = L.order[1].pid;
  await pb.click('[data-ca="st-lb-up"][data-k="1"]'); await wait(pb, 120);
  L = await pb.evaluate(() => StUI._st.lb.lineup);
  ok(L.order[0].pid === before2, "batting order can be reordered");
  await pb.selectOption('[data-cf="st-lb-pos"][data-k="8"]', "DH"); await wait(pb, 100);
  await pb.fill("#stLbPriv", "Private: watch his first step"); await pb.dispatchEvent("#stLbPriv", "change"); await wait(pb, 100);
  await pb.fill("#stLbShared", "Looking at Group A's infield"); await pb.dispatchEvent("#stLbShared", "change");
  ok(await pb.isVisible(".st-dia .pos.on"), "the diamond shows the alignment");
  await shot(pb, "05-lineup-builder");
  ok(!(await doc(env, "lineup:" + gA)), "a draft never leaves the coach's browser");
  // coach C builds the other game's lineup at the same time
  const pc = C2.p;
  await pc.evaluate(() => StUI.openBuilder("gB")); await wait(pc, 300);
  for (let i = 0; i < 9; i++) { const btn = await pc.$('.st-pool li:not(.used) [data-ca="st-lb-add"]'); if (btn) { await btn.click(); await wait(pc, 80); } }
  await pc.click('[data-ca="st-lb-submit"]'); await wait(pc, 600);
  // B submits
  await pb.click('[data-ca="st-lb-submit"]'); await wait(pb, 600);
  let lsv = await doc(env, "lineup:" + gA);
  ok(lsv && lsv.status === "submitted" && lsv.current.by === "Coach Testtwo" && lsv.current.sharedNote === "Looking at Group A's infield", "submitted: the lineup and its shared note are on the server");
  ok(!JSON.stringify(lsv).includes("watch his first step"), "the private note stayed private");
  ok(/Submitted/.test(await pb.innerText(".st-lb-head")), "the coach sees Submitted");
  ok((await doc(env, "lineup:gB")).status === "submitted", "the second coach's lineup is submitted too");

  /* ============ 7. Coordinator reviews: approve & publish → the matrix updates ============ */
  await pull(pa);
  await pa.evaluate(() => CampUI.api.setTab("today")); await wait(pa, 200);
  ok(/2 lineups waiting for review/.test(await pa.innerText(".st-tasks")), "Today: “2 lineups waiting for review”");
  await pa.evaluate(() => { StUI._st.view = "lineups"; CampUI.api.setTab("games"); }); await wait(pa, 200);
  ok(/Waiting for review/i.test(await pa.innerText(".st-lineups")), "Lineups: a review queue for coordinators");
  await shot(pa, "06-review-queue");
  await pa.click(`.st-lrow [data-k="${gA}"]`); await wait(pa, 300);
  ok(await pa.isVisible('[data-ca="st-lb-publish"]') && /Submitted · v1 by Coach Testtwo/.test(await pa.innerText(".st-lb-head")), "the coordinator sees the submitted lineup, who and which version");
  ok(/plan/i.test(await pa.innerText(".st-lb-mid")) || /agree/i.test(await pa.innerText(".st-lb-mid")), "differences between lineup and plan are listed (or confirmed in agreement)");
  await pa.click('[data-ca="st-lb-publish"]'); await wait(pa, 300);
  ok(/Update the Game Play Matrix from this lineup/.test(await pa.innerText(".c-dlg")), "approving shows the exact plan changes first");
  await shot(pa, "07-approve-dialog");
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 500);
  ok(await pa.isVisible("#stCoord"), "approving needs the coordinator code on this deployment");
  await pa.fill("#stCoord", "wrong"); await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 200);
  await pa.click('[data-ca="st-lb-publish"]'); await wait(pa, 300); await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 500);
  ok(await pa.isVisible("#stCoord"), "a wrong code is refused by the server");
  await pa.fill("#stCoord", "bullpen-7"); await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 200);
  await pa.click('[data-ca="st-lb-publish"]'); await wait(pa, 300); await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 900);
  lsv = await doc(env, "lineup:" + gA);
  ok(lsv.status === "published" && lsv.published.rev === 1, "published with the code");
  await pa.evaluate(() => StSync.flush(CampUI.api, "games:" + CampUI.api.cur().id));
  sv = await doc(env, "games:" + campId);
  const fromLineup = Object.values(sv.plan[gA]).filter((c) => c.src === "lineup").length;
  ok(fromLineup >= 11, `the Game Play Matrix took the approved lineup (${fromLineup} cells marked from the lineup)`);
  const hist = await server(env, "SELECT action, by FROM mh_ops_audit WHERE id = ? ORDER BY seq", "lineup:" + gA);
  ok(hist.map((x) => x.action).join(",") === "submit,approve,publish" && hist[2].by === "Coord Testone (coordinator)", "audit history: submit → approve → publish, with names");
  // print
  await pa.click('[data-ca="st-lb-more"]'); await pa.click('.c-menu button:has-text("Print dugout card")'); await wait(pa, 300);
  ok(await pa.isVisible(".c-printroot .st-sheet") && /Published v1/.test(await pa.innerText(".c-printroot")), "printable dugout card of the published lineup");
  await shot(pa, "08-lineup-card");
  await pa.click('.c-pv-bar [data-ca="print-close"]'); await wait(pa);

  /* ============ 8. Revision after publication ============ */
  await pull(pb);
  await pb.evaluate((g) => StUI.openBuilder(g), gA); await wait(pb, 300);
  ok(/Published/.test(await pb.innerText(".st-lb-head")) && await pb.isVisible('[data-ca="st-lb-revise"]'), "the coach sees it published and can start a revision");
  await pb.click('[data-ca="st-lb-revise"]'); await wait(pb, 200);
  await pb.click('[data-ca="st-lb-clear"][data-k="8"]'); await wait(pb, 100);
  await pb.click('.st-pool li:not(.used) [data-ca="st-lb-add"]'); await wait(pb, 150);
  await pb.click('[data-ca="st-lb-submit"]'); await wait(pb, 600);
  lsv = await doc(env, "lineup:" + gA);
  ok(lsv.status === "submitted" && lsv.rev === 2 && lsv.published.rev === 1, "revision v2 is under review; v1 stays the published lineup");

  /* ============ 9. Simultaneous edits never silently overwrite ============ */
  await pull(pa); await pull(pb);
  // coordinator moves a block; a second coordinator (the coach's browser, for the test) renames another — both survive
  await pa.evaluate(() => { const A2 = CampUI.api; A2.mutate("move stretch", (c) => { const a = c.draft.activities.find((x) => x.title === "Stretch"); a.start = 545; }); });
  await pb.evaluate(() => { const A2 = CampUI.api; A2.mutate("rename lunch", (c) => { const a = c.draft.activities.find((x) => x.title === "Lunch"); a.title = "Lunch & Video"; }); });
  await pa.evaluate(() => StSync.flush(CampUI.api, "camp:" + CampUI.api.cur().id)); await pb.evaluate(() => StSync.flush(CampUI.api, "camp:" + CampUI.api.cur().id));
  await pull(pa);
  sv = await doc(env, "camp:" + campId);
  ok(sv.draft.activities.some((a) => a.title === "Stretch" && a.start === 545) && sv.draft.activities.some((a) => a.title === "Lunch & Video"), "two people's edits to different things are both kept");
  // a real clash: both change the same block's start
  await pa.evaluate(() => { CampUI.api.mutate("A moves", (c) => { c.draft.activities.find((x) => x.title === "Cage Work").start = 630; }); });
  await pb.evaluate(() => { CampUI.api.mutate("B moves", (c) => { c.draft.activities.find((x) => x.title === "Cage Work").start = 640; }); });
  await pa.evaluate(() => StSync.flush(CampUI.api, "camp:" + CampUI.api.cur().id));
  const clashSeen = pb.evaluate(() => new Promise((res) => { StSync.on((w) => { if (w === "clash") res(true); }); setTimeout(() => res(false), 4000); }));
  await pb.evaluate(() => StSync.flush(CampUI.api, "camp:" + CampUI.api.cur().id));
  ok(await clashSeen, "a true clash (same block, same field) is reported to the second person, not silently dropped");
  sv = await doc(env, "camp:" + campId);
  ok(sv.draft.activities.find((x) => x.title === "Cage Work").start === 630, "…and the version saved first is kept");

  /* ============ 10. Group changes flow everywhere ============ */
  const mover = await pa.evaluate(() => CampUI.api.cur().groups.find((g) => g.id === "gD").players[0]);
  await pa.evaluate((pid) => CampUI.api.mutate("move player", (c) => { c.groups.find((g) => g.id === "gD").players = c.groups.find((g) => g.id === "gD").players.filter((x) => x !== pid); c.groups.find((g) => g.id === "gC").players.push(pid); }), mover);
  const it = await pa.evaluate((pid) => { const c = CampUI.api.cur(); return CampUI.api.C.itinerary(c, pid, CampUI.api.C.nowIn(c.tz).date).map((x) => x.act.title); }, mover);
  ok(it.includes("Cage Work"), "moving a player from Group D to Group C changes their schedule (now in C's cage work)");
  ok(await pa.evaluate((pid) => { const c = CampUI.api.cur(); return !c.groups.find((g) => g.id === "gD").players.includes(pid); }, mover), "…and the matrix group filter follows (one group list, no copies)");

  /* ============ 11. Actual participation after the game ============ */
  await pa.evaluate(() => CampUI.api.setTab("games")); await wait(pa, 200);
  await pa.evaluate((g) => { StUI._st.lb = null; }, gA);
  await pa.click('[data-ca="st-view"][data-k="games"]'); await wait(pa, 200);
  await pa.click(`.st-gcard [data-ca="st-actuals"][data-k="${gA}"]`); await wait(pa, 300);
  const nRows = (await pa.$$("#stActRows tr")).length;
  ok(nRows >= 11, `actuals list the game's players (${nRows})`);
  ok(await pa.evaluate(() => Array.from(document.querySelectorAll('#stActRows [data-a="inn"]')).every((x) => !x.value)), "actuals start empty — the plan is never copied silently");
  await pa.click('[data-ca="st-act-fill"]'); await wait(pa, 150);
  const firstRow = await pa.$("#stActRows tr");
  await (await firstRow.$('[data-a="inn"]')).fill("6"); await (await firstRow.$('[data-a="pa"]')).fill("3");
  const second = (await pa.$$("#stActRows tr"))[1];   // a planned starter who didn't play
  for (const n of ["pos", "inn", "pa", "ip", "pc"]) await (await second.$(`[data-a="${n}"]`)).fill("");
  await (await second.$('[data-a="played"]')).uncheck();
  await pa.click(".c-dlg .mfoot .btn.primary"); await wait(pa, 400);
  gd = await pa.evaluate(() => StSync.games(CampUI.api.cur().id));
  const g0 = gd.games.find((x) => x.id === gA);
  ok(g0.status === "final" && Object.keys(gd.actual[gA]).length >= 11, "actuals saved; the game is final");
  const firstPid = await firstRow.evaluate((tr) => tr.dataset.pid).catch(() => null);
  void firstPid;
  await pa.click('[data-ca="st-view"][data-k="matrix"]'); await wait(pa, 200);
  await pa.click('[data-ca="st-mx-mode"][data-k="both"]'); await wait(pa, 300);
  ok((await pa.$$(`td.st-mx-c[data-g="${gA}"] .a`)).length >= 11, "Plan vs actual shows both in the matrix");
  ok(/Plan vs actual/i.test(await pa.innerText(".st-mx-sum")), "the summary lists plan-vs-actual differences");
  await shot(pa, "09-plan-vs-actual");

  /* ============ 12. Data safety ============ */
  ok(await pa.evaluate(() => JSON.stringify(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)]))) === rostersBefore, "official rosters unchanged by every Spring Training operation");
  ok(await pa.evaluate(() => JSON.stringify(S.sections)) === sectionsBefore, "the affiliate daily schedule is untouched");
  ok(await noOverflow(pa), "desktop: no horizontal page overflow");
  for (const X of [A, B, C2]) ok(X.errs.length === 0, "no page errors" + (X.errs.length ? " — " + X.errs.join(" | ") : ""));

  /* ============ 13. Tablet (coach) and phone ============ */
  const T = await browserFor(b, env, { name: "Coach Testtwo", role: "coach", staffId: "s2" }, devices["iPad (gen 7)"]);
  await wait(T.p, 400); await T.p.click('.st-shared-first [data-ca="st-open-remote"]'); await wait(T.p, 900);
  await T.p.evaluate((g) => StUI.openBuilder(g), "gx1"); await wait(T.p, 300);
  ok(await noOverflow(T.p) && await T.p.isVisible(".st-lb-pool"), "tablet: lineup builder fits, with the player list");
  await shot(T.p, "10-tablet-builder");
  const P = await browserFor(b, env, { name: "Coord Testone", role: "coordinator", staffId: "s1" }, devices["iPhone 13"]);
  await wait(P.p, 400); await P.p.click('.st-shared-first [data-ca="st-open-remote"]'); await wait(P.p, 900);
  await P.p.evaluate(() => CampUI.api.setTab("today")); await wait(P.p, 250);
  ok(await noOverflow(P.p) && !(await P.p.$(".st-glance")) && await P.p.isVisible(".st-nn, .st-empty"), "phone: Today shows now / next instead of the timeline");
  await shot(P.p, "11-phone-today", true);
  await P.p.evaluate(() => { StUI._st.view = "matrix"; CampUI.api.setTab("games"); }); await wait(P.p, 300);
  ok(await P.p.isVisible('[data-cf="st-pgame"]') && !(await P.p.$(".st-mx-t")), "phone: the matrix becomes one game at a time");
  await P.p.selectOption('[data-cf="st-pgame"]', gA); await wait(P.p, 200);
  ok(/Starting/i.test(await P.p.innerText(".st-pg")), "phone: a game's players by role");
  await shot(P.p, "12-phone-game", true);
  await P.p.fill('[data-cf="st-pplayer"]', "TeststSL20"); await wait(P.p, 500);
  ok(await P.p.isVisible(".st-pp"), "phone: find a player and see their games");
  await P.p.fill('[data-cf="st-pplayer"]', ""); await wait(P.p, 400);
  await P.p.evaluate((g) => StUI.openBuilder(g), gA); await wait(P.p, 300);
  ok(await noOverflow(P.p) && await P.p.isVisible(".st-slots"), "phone: a lineup can be reviewed");
  await shot(P.p, "13-phone-lineup", true);
  await P.p.evaluate(() => CampUI.api.setTab("schedule")); await wait(P.p, 250);
  ok(await P.p.isVisible(".c-agenda") && await noOverflow(P.p), "phone: schedule opens on the agenda");
  for (const X of [T, P]) ok(X.errs.length === 0, "no page errors" + (X.errs.length ? " — " + X.errs.join(" | ") : ""));

  /* ============ 14. Existing local camps are never lost ============ */
  const Lc = await browserFor(b, env, null);
  await Lc.p.evaluate(() => { const C = CampUI.api.C; localStorage.setItem("cs.camp.v1", JSON.stringify({ version: 1, camps: [C.newCamp({ name: "Old offseason camp", start: "2026-12-01", end: "2026-12-05" })], templates: [], activeCampId: null })); });
  await Lc.p.reload(); await wait(Lc.p, 600); await Lc.p.evaluate(() => go("camp")); await wait(Lc.p, 400);
  ok(/Old offseason camp/.test(await Lc.p.innerText(".camp")), "a camp saved before 3.0 opens unchanged (kind read from its name)");
  ok(/Camp \/ workouts/i.test(await Lc.p.innerText(".c-eyebrow")) && !(await Lc.p.$('[data-ca="tab"][data-k="games"]')), "…as a plain camp without Games until someone sets its type");

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
