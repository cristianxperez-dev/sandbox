/* Manager Hub — the shipped organisation roster (apps/manager-hub/rosters/org-roster.csv) loads itself.
   Expected counts are derived from the served file, so no player data is written into this test.
   Run against a host with the access gate: MH_ACCESS_CODE=… BASE=…/apps/manager-hub/ node manager-hub/tests/org-roster.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:8788/apps/manager-hub/";
const LEVEL = { R: "fcl", "1F": "fay", "1A": "ash", "2A": "cc", "3A": "sl" };
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);

function expected(text) {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1).filter(Boolean);
  const uniq = [...new Set(lines)], by = {};
  for (const l of uniq) {
    const lvl = l.split(",")[0], pos = l.split(",").slice(-2)[0];
    const a = (by[LEVEL[lvl]] = by[LEVEL[lvl]] || { total: 0, pitchers: 0 });
    a.total++; if (pos === "P") a.pitchers++;
  }
  return { by, unique: uniq.length, rows: lines.length };
}
(async () => {
  const b = await chromium.launch(), u = new URL(BASE);
  // the file is behind the access code
  const anon = await (await b.newContext()).request.get(BASE + "rosters/org-roster.csv", { headers: { Accept: "*/*" }, maxRedirects: 0 });
  ok(anon.status() === 401, `signed out: the roster file is refused (${anon.status()})`);

  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const lr = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE || "" }, headers: { Origin: u.origin }, maxRedirects: 0 });
  ok(lr.status() === 303, "signed in");
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  // a fresh browser where a coach already added one of the file's players by hand
  await p.goto(BASE); await p.evaluate(() => localStorage.clear());
  // read through the page: the session cookie is Secure, which the browser (not the API client) sends to a local http host
  const [status, csv] = await p.evaluate(async () => { const r = await fetch("rosters/org-roster.csv", { cache: "no-store" }); return [r.status, await r.text()]; });
  ok(status === 200 && /^LEVELOFPLAY_LK/.test(csv.replace(/^\uFEFF/, "")), `signed in: the roster file is served (${status})`);
  const E = expected(csv);
  const firstSL = csv.split(/\r?\n/).find((l) => l.startsWith("3A,"));
  const [last, first] = firstSL.match(/"([^"]+)"/)[1].split(",").map((s) => s.trim());
  await p.evaluate(([last, first]) => { localStorage.setItem("cs.affiliate", "sl"); RosterRoute.writeRoster("sl", [{ id: "hand-entered", first, last, position: "P", group: "pitcher", bats: "", throws: "", number: "99", level: "", status: "", notes: "coach note", extra: {} }]); }, [last, first]);
  await p.reload(); await wait(p, 1500);
  const R = await p.evaluate(() => Object.fromEntries(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)])));
  for (const [aff, e] of Object.entries(E.by)) {
    const l = R[aff] || [];
    ok(l.length === e.total && l.filter((x) => x.group === "pitcher").length === e.pitchers, `${aff}: ${l.length} players (${l.filter((x) => x.group === "pitcher").length} pitchers) — file has ${e.total} (${e.pitchers})`);
  }
  ok(Object.values(R).reduce((n, l) => n + l.length, 0) === E.unique, `${E.unique} unique players loaded from ${E.rows} rows (repeated rows skipped)`);
  const hand = R.sl.filter((x) => x.last === last && x.first === first);
  ok(hand.length === 1 && hand[0].id === "hand-entered" && hand[0].number === "99" && hand[0].notes === "coach note" && hand[0].level === "3A", "a player added by hand is matched, kept, and only filled in");
  // reopening changes nothing
  await p.evaluate(() => { const l = RosterRoute.readRoster("cc"); l[0].status = "EDITED BY COACH"; RosterRoute.writeRoster("cc", l); });
  await p.reload(); await wait(p, 1200);
  const R2 = await p.evaluate(() => Object.fromEntries(AFFILIATES.map((a) => [a.id, RosterRoute.readRoster(a.id)])));
  ok(Object.values(R2).reduce((n, l) => n + l.length, 0) === E.unique && R2.cc[0].status === "EDITED BY COACH", "reopening the app changes nothing (and keeps a coach's edit)");
  // an updated file: new players are added; a coach's edit to an existing player is kept
  await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: csv.trimEnd() + '\n2A,"Testplayer, Newman","Testplayer, N",R,22,P,ACT\n' }));
  await p.reload(); await wait(p, 1200);
  const R3 = await p.evaluate(() => RosterRoute.readRoster("cc"));
  ok(R3.length === R2.cc.length + 1 && R3.some((x) => x.last === "Testplayer") && R3[0].status === "EDITED BY COACH", "an updated file adds new players and never overwrites a coach's edit");
  await ctx.unroute("**/rosters/org-roster.csv");
  // the roster screen shows them
  await p.evaluate(() => { ROSTER_GROUP = "pitcher"; rosterModal(); });
  ok((await p.locator("#rosBody .ros-row").count()) > 0, "players appear on the roster screen");
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
