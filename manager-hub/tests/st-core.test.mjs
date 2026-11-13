/* Spring Training core: games, plan/actual, summaries, lineups, workflow, merge, describe reader, ops store. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fakeD1 } from "./fake-d1.mjs";
const require = createRequire(import.meta.url);
const S = require("../../apps/manager-hub/st/st-core.js");
const D = require("../../apps/manager-hub/st/st-describe.js");
const C = require("../../apps/manager-hub/camp/camp-core.js");
const ops = await import("../../functions/apps/manager-hub/api/ops.js");

const g1 = S.newGame({ id: "g1", date: "2027-03-01", start: 780, opponent: "Club X", squad: "Triple-A" });
const g2 = S.newGame({ id: "g2", date: "2027-03-01", start: 790, opponent: "Club Y", squad: "Double-A", format: { innings: 7, dh: true, extraHitters: 2 } });
const g3 = S.newGame({ id: "g3", date: "2027-03-02", start: 780, opponent: "Club Z" });

test("kinds: explicit, or Spring Training read from the name", () => {
  assert.equal(S.kindOf({ kind: "instructs" }).id, "instructs");
  assert.equal(S.kindOf({ name: "2027 Spring Training" }).id, "spring");
  assert.equal(S.kindOf({ name: "Winter workouts" }).id, "workout");
});

test("positions and innings pitched", () => {
  assert.equal(S.normPos("6"), "SS"); assert.equal(S.normPos("dh"), "DH"); assert.equal(S.normPos("eh"), "EH"); assert.equal(S.normPos("ZZ"), "");
  assert.equal(S.outsOf("2.1"), 7); assert.equal(S.outsOf("3"), 9); assert.equal(S.outsOf("2.3"), null); assert.equal(S.ipOf(7), "2.1");
});

test("games: normalised, format defaults, duration estimate, title", () => {
  assert.equal(g1.format.innings, 9); assert.equal(S.gameDur(g1), 180); assert.equal(S.gameDur(g2), 140);
  assert.equal(S.gameTitle(g1), "Triple-A vs Club X");
  assert.equal(S.normGame({ date: "bad" }), null);
  assert.equal(S.normGame({ date: "2027-03-01", format: { innings: 40 } }).format.innings, 15);
});

test("plan cells: set, clear, text; plan and actual stay separate", () => {
  const doc = S.normGamesDoc({ games: [g1, g2, g3] });
  S.setCell(doc, "g1", "fcl:1", { role: "start", pos: "ss", inn: 5 });
  S.setCell(doc, "g1", "fcl:2", { role: "pitch", outs: 6, pitches: 35 });
  assert.equal(S.cellText(S.cellOf(doc, "g1", "fcl:1")), "SS 5");
  assert.equal(S.cellText(S.cellOf(doc, "g1", "fcl:2"), true), "P 2.0·35p");
  assert.deepEqual(S.plannedIn(doc, "g1").sort(), ["fcl:1", "fcl:2"]);
  assert.equal(S.hasActuals(doc, "g1"), false, "a plan is never an appearance");
  S.setCell(doc, "g1", "fcl:1", null);
  assert.equal(S.cellOf(doc, "g1", "fcl:1"), null);
  // cells for unknown games are dropped on normalise
  assert.deepEqual(S.normGamesDoc({ games: [g1], plan: { nope: { "a:1": { role: "start" } } } }).plan, {});
});

test("summaries: projected innings use actuals where recorded, plan elsewhere; catcher innings; pitcher rest", () => {
  const doc = S.normGamesDoc({ games: [g1, g2, g3] });
  S.setCell(doc, "g1", "a:1", { role: "start", pos: "C", inn: 5 });
  S.setCell(doc, "g3", "a:1", { role: "start", pos: "C", inn: 4 });
  S.setActual(doc, "g1", "a:1", { pos: "C", inn: 6, pa: 3 });
  S.setCell(doc, "g1", "a:2", { role: "pitch", outs: 6 });
  S.setActual(doc, "g1", "a:2", { outs: 7, pitches: 31 });
  S.setCell(doc, "g3", "a:2", { role: "pitch", outs: 3 });
  const games = S.gamesIn(doc);
  const s1 = S.playerSummary(doc, "a:1", games, "2027-03-02");
  assert.equal(s1.innProjected, 10); assert.equal(s1.innPlayed, 6); assert.equal(s1.innPlanned, 9); assert.equal(s1.pa, 3);
  const s2 = S.playerSummary(doc, "a:2", games, "2027-03-02");
  assert.equal(s2.outsPlayed, 7); assert.equal(s2.pitches, 31); assert.equal(s2.lastOuting, "2027-03-01"); assert.equal(s2.daysSinceOuting, 1); assert.equal(s2.nextOuting, "2027-03-02");
  const ci = S.catcherInnings(doc, ["a:1"], games);
  assert.deepEqual(ci, [{ pid: "a:1", played: 6, planned: 4 }]);
  const pva = S.planVsActual(doc, games);
  assert.ok(pva.some((x) => x.kind === "innings" && x.pid === "a:1"));
  assert.ok(pva.some((x) => x.kind === "outs" && x.pid === "a:2"));
});

test("low playing time is relative: under half the median", () => {
  const sums = [10, 12, 11, 4, 0, 13].map((n, i) => ({ pid: "p" + i, innProjected: n }));
  const r = S.lowPlayingTime(sums);
  assert.equal(r.median, 10.5);
  assert.deepEqual(r.list.map((x) => x.pid), ["p4", "p3"]);
  assert.deepEqual(S.lowPlayingTime([{ pid: "a", innProjected: 0 }]).list, []);
});

const players = {
  "a:1": { pid: "a:1", name: "One", status: "ACT" }, "a:2": { pid: "a:2", name: "Two", status: "60D" }, "a:3": { pid: "a:3", name: "Three", status: "RES" }
};
test("lineup checks: duplicates, positions, DH/EH rules, availability — drafts never blocked", () => {
  const l = S.newLineup(g2, "Coach");
  assert.equal(l.order.length, 11);
  l.order[0] = { pid: "a:1", pos: "SS" }; l.order[1] = { pid: "a:1", pos: "SS" }; l.order[2] = { pid: "a:2", pos: "EH" }; l.order[3] = { pid: "a:3", pos: "EH" }; l.order[4] = { pid: "x:9", pos: "EH" };
  const issues = S.checkLineup(l, g2, { player: (p) => players[p] || null, nameOf: (p) => (players[p] || { name: p }).name });
  const kinds = issues.map((i) => i.kind);
  assert.ok(kinds.includes("dupe")); assert.ok(kinds.includes("pos")); assert.ok(kinds.includes("eh")); assert.ok(kinds.includes("sp"));
  assert.ok(issues.some((i) => i.kind === "status" && i.level === "error" && /60-day/.test(i.msg)));
  assert.ok(issues.some((i) => i.kind === "status" && i.level === "warning" && /reserve/.test(i.msg)));
  assert.ok(issues.some((i) => i.kind === "unknown"));
});

test("lineup ↔ plan: differences reported both ways; approval writes only on request, never the reverse", () => {
  const doc = S.normGamesDoc({ games: [g1, g2] });
  S.setCell(doc, "g1", "a:1", { role: "start", pos: "2B", inn: 5 });
  S.setCell(doc, "g1", "a:4", { role: "pitch", outs: 6 });
  S.setCell(doc, "g2", "a:5", { role: "start", pos: "CF" });
  const l = S.newLineup(g1, "Coach");
  l.order[0] = { pid: "a:1", pos: "SS" }; l.order[1] = { pid: "a:5", pos: "CF" }; l.order[2] = { pid: "a:6", pos: "LF" };
  l.grid = { "a:1": ["SS", "SS", "SS", "SS", "", "", "", "", ""] };
  const cmp = S.compareToPlan(l, doc, g1, { games: doc.games });
  const kinds = cmp.map((c) => c.kind);
  assert.ok(kinds.includes("pos")); assert.ok(kinds.includes("notplanned")); assert.ok(kinds.includes("missing")); assert.ok(kinds.includes("overlap"), "a:5 is planned in the overlapping g2");
  const before = JSON.stringify(doc);
  const preview = S.lineupToPlan(l, doc, g1);
  assert.equal(JSON.stringify(doc), before, "previewing changes nothing");
  assert.deepEqual(preview.dropped, ["a:4"]);
  S.applyLineupToPlan(doc, l, g1);
  assert.equal(S.cellOf(doc, "g1", "a:1").pos, "SS"); assert.equal(S.cellOf(doc, "g1", "a:1").inn, 4, "innings from the innings grid"); assert.equal(S.cellOf(doc, "g1", "a:1").src, "lineup");
  assert.equal(S.cellOf(doc, "g1", "a:4").role, "pitch", "players dropped from the lineup stay unless asked");
  S.applyLineupToPlan(doc, l, g1, { dropRemoved: true });
  assert.equal(S.cellOf(doc, "g1", "a:4").role, "off");
});

test("review workflow: submit → approve → publish; a revision leaves the published lineup in place", () => {
  let d = S.emptyLineupDoc("g1", "c1");
  assert.equal(S.transition(d, "approve", { by: "C" }).ok, false);
  const l = S.newLineup(g1, "Coach A"); l.order[0] = { pid: "a:1", pos: "SS" };
  d = S.transition(d, "submit", { by: "Coach A", lineup: l }).doc;
  assert.equal(d.status, "submitted"); assert.equal(d.rev, 1);
  d = S.transition(d, "approve", { by: "Coord" }).doc;
  d = S.transition(d, "publish", { by: "Coord" }).doc;
  assert.equal(d.status, "published"); assert.equal(d.published.order[0].pid, "a:1");
  const l2 = S.normLineup(d.current); l2.order[0] = { pid: "a:7", pos: "SS" };
  d = S.transition(d, "submit", { by: "Coach A", lineup: l2 }).doc;
  assert.equal(d.status, "submitted"); assert.equal(d.rev, 2);
  assert.equal(S.officialLineup(d).order[0].pid, "a:1", "the published lineup stands until a coordinator publishes again");
  d = S.transition(d, "return", { by: "Coord", note: "Swap 2B" }).doc;
  assert.equal(d.status, "returned"); assert.equal(d.history.at(-1).note, "Swap 2B");
  assert.deepEqual(d.history.map((x) => x.action), ["submit", "approve", "publish", "submit", "return"]);
});

test("schedule conflicts: a player in a game and a workout, two games sharing a field", () => {
  const camp = C.newCamp({ name: "ST", start: "2027-03-01", end: "2027-03-05" });
  const f1 = camp.facilities[0].id;
  camp.groups.push({ id: "gA", name: "Group A", color: "#000000", players: ["a:1", "a:2"] });
  camp.draft.activities.push(C.newActivity({ date: "2027-03-01", title: "Defense", start: 800, dur: 30, groups: ["gA"], facilityId: f1 }));
  const doc = S.normGamesDoc({ games: [Object.assign({}, g1, { facilityId: f1 }), Object.assign({}, g2, { facilityId: f1 })] });
  S.setCell(doc, "g1", "a:1", { role: "start", pos: "SS" });
  S.setCell(doc, "g2", "a:1", { role: "start", pos: "SS" });
  const k = S.scheduleConflicts(camp, doc, "2027-03-01").map((c) => c.kind);
  assert.ok(k.includes("game-player")); assert.ok(k.includes("game-facility")); assert.ok(k.includes("game-game"));
  const av = S.availabilityConflicts(doc, doc.games, (p) => ({ "a:1": { name: "One", status: "FSIL" } })[p]);
  assert.equal(av.length, 2);
});

test("merge3: independent edits combine; a true clash keeps the server's value and is reported", () => {
  const base = { name: "ST", groups: [{ id: "g1", name: "A", players: ["p1", "p2"] }], acts: [{ id: "a1", start: 540 }, { id: "a2", start: 600 }] };
  const mine = S.clone(base), theirs = S.clone(base);
  mine.groups[0].players.push("p3"); mine.acts[0].start = 545; mine.acts.push({ id: "a3", start: 700 });
  theirs.groups[0].players = ["p1"]; theirs.acts = theirs.acts.filter((a) => a.id !== "a2"); theirs.name = "ST 2027";
  const r = S.merge3(base, mine, theirs);
  assert.deepEqual(r.value.groups[0].players, ["p1", "p3"]);
  assert.deepEqual(r.value.acts.map((a) => a.id), ["a1", "a3"]); assert.equal(r.value.acts[0].start, 545); assert.equal(r.value.name, "ST 2027");
  assert.equal(r.conflicts.length, 0);
  const m2 = S.clone(base), t2 = S.clone(base); m2.acts[0].start = 560; t2.acts[0].start = 570;
  const r2 = S.merge3(base, m2, t2);
  assert.equal(r2.value.acts[0].start, 570); assert.equal(r2.conflicts.length, 1);
  const m3 = S.clone(base), t3 = S.clone(base); m3.acts[1].start = 610; t3.acts = t3.acts.filter((a) => a.id !== "a2");
  const r3 = S.merge3(base, m3, t3);
  assert.ok(r3.value.acts.some((a) => a.id === "a2"), "an edit is never lost to someone else's delete"); assert.equal(r3.conflicts[0].kind, "changed-but-deleted");
  // plan cells keyed by game and player merge per cell
  const pb = { plan: { g1: { "a:1": { role: "start" } } } }, pm = S.clone(pb), pt = S.clone(pb);
  pm.plan.g1["a:2"] = { role: "sub" }; pt.plan.g1["a:3"] = { role: "pitch" };
  assert.deepEqual(Object.keys(S.merge3(pb, pm, pt).value.plan.g1).sort(), ["a:1", "a:2", "a:3"]);
});

test("CSV: matrix export and actuals import with name matching", () => {
  const doc = S.normGamesDoc({ games: [g1] });
  S.setCell(doc, "g1", "a:1", { role: "start", pos: "SS", inn: 5 });
  S.setActual(doc, "g1", "a:1", { pos: "SS", inn: 5, pa: 2 });
  const pl = [{ pid: "a:1", name: "Ana Uno", first: "Ana", last: "Uno", aff: "FCL", position: "SS" }, { pid: "a:2", name: "Bo Dos", first: "Bo", last: "Dos", aff: "FCL", position: "P" }];
  const csv = S.matrixCSV(doc, [g1], pl);
  assert.match(csv, /SS 5 → SS 5 · 2 PA/);
  const imp = S.actualsFromCSV("Player,IN,PA,POS,IP,Pitches\nUno, Ana,5,2,SS,,\n\"Dos, Bo\",,,,1.2,22\nNobody,1,1,C,,\n", pl);
  assert.equal(imp.rows.length, 1, "an unquoted comma splits the name: that row isn't matched");
  const imp2 = S.actualsFromCSV("Player,IN,PA,POS,IP,Pitches\nAna Uno,5,2,SS,,\n\"Dos, Bo\",,,,1.2,22\nNobody,1,1,C,,\n", pl);
  assert.equal(imp2.rows.length, 2); assert.equal(imp2.rows[1].actual.outs, 5); assert.deepEqual(imp2.unmatched, ["Nobody"]);
});

/* ---------- describe ---------- */
const ctx = { groups: ["Group A", "Group B", "Group C", "Group D", "Catchers"].map((n, i) => ({ id: "g" + i, name: n })),
  facilities: [["Field 1", "field"], ["Field 2", "field"], ["Cage 1", "cage"], ["Cage 2", "cage"], ["Bullpen mounds (8)", "bullpen"], ["Weight room", "weight"]].map(([n, t], i) => ({ id: "f" + i, name: n, type: t })),
  staff: [{ id: "s1", name: "Lee" }], roles: { pitcher: ["p:1", "p:2"], catcher: ["c:1"] } };
test("describe: the brief's example becomes six blocks, paired groups and fields", () => {
  const r = D.read("Tomorrow we have four groups. Everybody stretches at 9. Groups A and B take defense on Fields 1 and 2 at 9:30. Pitchers start bullpens at 10. Group C hits at 10:15. All groups break for lunch at noon.", ctx);
  assert.deepEqual(r.items.map((i) => [D.fmt(i.start), i.title, i.groups.join("+") || (i.all ? "all" : i.roles.join("+")), i.facilities.join("+")]), [
    ["9:00 AM", "Stretch", "all", ""], ["9:30 AM", "Defense", "Group A", "Field 1"], ["9:30 AM", "Defense", "Group B", "Field 2"],
    ["10:00 AM", "Bullpens", "pitcher", "Bullpen mounds (8)"], ["10:15 AM", "Hitting", "Group C", ""], ["12:00 PM", "Lunch", "all", ""]]);
  assert.equal(r.notUnderstood.length, 0);
  const t = D.toActivities(r, ctx, "2027-03-02");
  assert.equal(t.activities[0].groups.length, 5, "everybody = every group");
  assert.deepEqual(t.activities[3].players, ["p:1", "p:2"]);
  assert.equal(t.activities[1].facilityId, "f0");
});
test("describe: ranges, lengths, afternoon hours, unknown names reported", () => {
  const r = D.read("Group D lifts from 1 to 1:45. Catchers block for 20 minutes at 2:15 pm in the cages. Group Q runs at 3.", ctx);
  assert.equal(r.items[0].start, 780); assert.equal(r.items[0].dur, 45);
  assert.equal(r.items[1].dur, 20); assert.deepEqual(r.items[1].groups, ["Catchers"]);
  assert.ok(r.assumptions.some((a) => /Group Q/.test(a)));
  const t = D.toActivities(r, ctx, "2027-03-02");
  assert.ok(t.unresolved.some((u) => /Group Q/.test(u)), "never invents a group");
});
test("describe: AI output is validated, malformed refused", () => {
  assert.equal(D.validate({ items: [{ title: "x", cat: "hitting", start: "25:00", dur: 30, all: false, groups: [], roles: [], facilities: [], staff: [], note: "" }], assumptions: [], notUnderstood: [] }).ok, false);
  const ok = D.validate({ items: [{ title: "Defense", cat: "fundamentals", start: "09:30", dur: 30, all: false, groups: ["Group A"], roles: [], facilities: ["Field 1"], staff: [], note: "" }], assumptions: ["a"], notUnderstood: [] });
  assert.equal(ok.ok, true); assert.equal(ok.value.items[0].start, 570); assert.equal(ok.value.source, "ai");
});

/* ---------- the shared store ---------- */
const req = (method, path, body, headers = {}) => new Request("https://x.test/apps/manager-hub/api/ops" + path, { method, headers: Object.assign({ "Content-Type": "application/json", Origin: "https://x.test" }, headers), body: body ? JSON.stringify(body) : undefined });
const call = async (fn, r, env) => { const res = await fn({ request: r, env }); return { status: res.status, body: await res.json() }; };
test("store: no database → read-only answer, writes refused (the page stays local)", async () => {
  assert.equal((await call(ops.onRequestGet, req("GET", "?camp=c1"), {})).body.stored, false);
  assert.equal((await call(ops.onRequestPut, req("PUT", "", { id: "camp:c1", doc: {}, baseVersion: 0 }), {})).status, 503);
});
test("store: versioned writes, 409 with the newer version, audit trail, camp listing", async () => {
  const env = { MH_AI_USAGE: fakeD1() };
  const camp = C.newCamp({ name: "Spring Training 2027", start: "2027-02-20", end: "2027-03-25" }); camp.kind = "spring";
  let r = await call(ops.onRequestPut, req("PUT", "", { id: "camp:" + camp.id, doc: camp, baseVersion: 0, by: "Coord", summary: "Created" }), env);
  assert.equal(r.status, 200); assert.equal(r.body.version, 1); assert.equal(r.body.doc.kind, "spring");
  r = await call(ops.onRequestPut, req("PUT", "", { id: "camp:" + camp.id, doc: camp, baseVersion: 0, by: "Other" }), env);
  assert.equal(r.status, 409); assert.equal(r.body.version, 1); assert.equal(r.body.by, "Coord");
  r = await call(ops.onRequestPut, req("PUT", "", { id: "games:" + camp.id, doc: { games: [g1] }, baseVersion: 0, by: "Coord" }), env);
  assert.equal(r.status, 200);
  r = await call(ops.onRequestGet, req("GET", "?camp=" + camp.id), env);
  assert.deepEqual(r.body.docs.map((d) => d.id).sort(), ["camp:" + camp.id, "games:" + camp.id]);
  r = await call(ops.onRequestGet, req("GET", "?list=camps"), env);
  assert.equal(r.body.camps[0].title, "Spring Training 2027");
  r = await call(ops.onRequestGet, req("GET", "?history=camp:" + camp.id), env);
  assert.equal(r.body.history[0].by, "Coord"); assert.equal(r.body.history[0].summary, "Created");
  assert.equal((await call(ops.onRequestPut, req("PUT", "", { id: "camp:../x", doc: {} }), env)).status, 400);
  assert.equal((await call(ops.onRequestPut, req("PUT", "", { id: "camp:c9", doc: camp, baseVersion: 0 }, { Origin: "https://evil.test" }), env)).status, 403);
});
test("store: lineup workflow enforced; coordinator code required for approve/publish when configured", async () => {
  const env = { MH_AI_USAGE: fakeD1(), MH_COORDINATOR_CODE: "pen-1" };
  const l = S.newLineup(g1, "Coach A");
  let d = S.transition(S.emptyLineupDoc("g1", "c1"), "submit", { by: "Coach A", lineup: l }).doc;
  let r = await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: d, baseVersion: 0, by: "Coach A", action: "submit" }), env);
  assert.equal(r.status, 200);
  const pub = S.transition(d, "publish", { by: "Coach A" }).doc;
  r = await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: pub, baseVersion: 1, by: "Coach A" }), env);
  assert.equal(r.status, 403); assert.equal(r.body.error, "coordinator-required");
  r = await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: pub, baseVersion: 1, by: "Coord" }, { "X-MH-Coordinator": "pen-1" }), env);
  assert.equal(r.status, 200);
  r = await call(ops.onRequestGet, req("GET", "?history=lineup:g1"), env);
  assert.equal(r.body.history[0].action, "publish");
  const skip = Object.assign(S.clone(pub), { status: "approved" });   // published → approved isn't a step
  r = await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: skip, baseVersion: 2, by: "Coord" }, { "X-MH-Coordinator": "pen-1" }), env);
  assert.equal(r.status, 422);
  // publishing a camp schedule is a coordinator action too
  const camp = C.newCamp({ name: "ST", start: "2027-03-01", end: "2027-03-02" });
  await call(ops.onRequestPut, req("PUT", "", { id: "camp:" + camp.id, doc: camp, baseVersion: 0, by: "A" }), env);
  C.publish(camp);
  assert.equal((await call(ops.onRequestPut, req("PUT", "", { id: "camp:" + camp.id, doc: camp, baseVersion: 1, by: "A" }), env)).status, 403);
  // without a configured code the same write is allowed (the app says approvals are open)
  const env2 = { MH_AI_USAGE: fakeD1() };
  await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: d, baseVersion: 0, by: "A" }), env2);
  assert.equal((await call(ops.onRequestPut, req("PUT", "", { id: "lineup:g1", doc: pub, baseVersion: 1, by: "A" }), env2)).status, 200);
});
test("store: database failure answers 503, never a platform error", async () => {
  const env = { MH_AI_USAGE: fakeD1({ fail: true }) };
  assert.equal((await call(ops.onRequestGet, req("GET", "?camp=c1"), env)).status, 503);
});
