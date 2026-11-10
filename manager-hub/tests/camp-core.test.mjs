/* Manager Hub — Camp pure logic. node --test manager-hub/tests/camp-core.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../../apps/manager-hub/camp/camp-core.js");

const AFF = [
  { id: "sl", short: "SL", name: "Sugar Land", level: "Triple-A" },
  { id: "cc", short: "CC", name: "Corpus Christi", level: "Double-A" },
  { id: "ash", short: "ASH", name: "Asheville", level: "High-A" },
  { id: "fcl", short: "FCL", name: "FCL Astros", level: "Rookie · Florida Complex League" }
];
const P = (id, first, last, position, group, extra) => Object.assign({ id, first, last, position, group, bats: "R", throws: "R", number: "", status: "ACT" }, extra || {});
const ROSTERS = {
  sl: [P("a", "Alan", "Testcatch", "C", "position", { number: "12" }), P("b", "Ben", "Testarm", "RHP", "pitcher", { throws: "R", status: "60D" })],
  cc: [P("a", "Cal", "Testlefty", "LHP", "pitcher", { throws: "L" }), P("d", "Dan", "Testinf", "IF", "position", { bats: "L" })],
  ash: [],
  fcl: [P("e", "Eli", "Testcatchtoo", "OF", "position", { pos2: "C" }), { id: "x" }, null]
};
const read = (id) => ROSTERS[id];
const pool = () => C.buildPool(AFF, read);

function campWith() {
  const camp = C.newCamp({ name: "T", start: "2027-02-15", end: "2027-02-21" });
  const pl = pool();
  C.addPlayersToCamp(camp, pl.map((p) => p.pid));
  return camp;
}
const fac = (camp, name) => camp.facilities.find((f) => f.name === name).id;

test("pool: union across affiliates, ids affId:playerId, no mutation, skips bad records", () => {
  const before = JSON.stringify(ROSTERS);
  const pl = pool();
  assert.equal(pl.length, 5);
  assert.deepEqual(pl.map((p) => p.pid).sort(), ["cc:a", "cc:d", "fcl:e", "sl:a", "sl:b"]);
  assert.equal(JSON.stringify(ROSTERS), before, "rosters not mutated");
  pl[0].first = "changed";
  assert.equal(JSON.stringify(ROSTERS), before, "pool entries are copies");
  assert.ok(pl.find((p) => p.pid === "fcl:e").isCatcher, "pos2 C counts as a catcher");
  assert.equal(pl.find((p) => p.pid === "fcl:e").affLevel, "Rookie");
});
test("pool: tolerates a roster reader that throws or returns junk", () => {
  const pl = C.buildPool(AFF, (id) => { if (id === "sl") throw new Error("boom"); return id === "cc" ? "nope" : []; });
  assert.deepEqual(pl, []);
});
test("facets list only what is present", () => {
  const f = C.facets(pool(), AFF);
  assert.deepEqual(f.affiliates.map((a) => a.id), ["sl", "cc", "fcl"]);
  assert.ok(!f.affiliates.some((a) => a.id === "ash"), "empty affiliate not offered");
  assert.deepEqual(f.statuses, ["60D", "ACT"]);
});
test("filters: search name/number, affiliate, role, catcher, throws, status, in camp, group", () => {
  const pl = pool(), camp = C.newCamp({ name: "T", start: "2027-02-15" });
  assert.deepEqual(C.filterPool(pl, { q: "testl" }).map((p) => p.pid), ["cc:a"]);
  assert.deepEqual(C.filterPool(pl, { q: "#12" }).map((p) => p.pid), ["sl:a"]);
  assert.deepEqual(C.filterPool(pl, { q: "alan testcatch" }).map((p) => p.pid), ["sl:a"]);
  assert.equal(C.filterPool(pl, { affs: ["cc"] }).length, 2);
  assert.equal(C.filterPool(pl, { role: "pitcher" }).length, 2);
  assert.deepEqual(C.filterPool(pl, { role: "catcher" }).map((p) => p.pid).sort(), ["fcl:e", "sl:a"]);
  assert.deepEqual(C.filterPool(pl, { throws: "L" }).map((p) => p.pid), ["cc:a"]);
  assert.deepEqual(C.filterPool(pl, { status: "60D" }).map((p) => p.pid), ["sl:b"]);
  C.addPlayersToCamp(camp, ["sl:a"]);
  assert.deepEqual(C.filterPool(pl, { inCamp: "in" }, camp).map((p) => p.pid), ["sl:a"]);
  assert.equal(C.filterPool(pl, { inCamp: "out" }, camp).length, 4);
  const g = C.addGroup(camp, "Pen", ["cc:a", "sl:b"]);
  assert.equal(C.filterPool(pl, { group: g.id }, camp).length, 2);
  assert.equal(C.filterLabel({ role: "catcher", affs: ["sl"] }, camp, AFF), "SL · Catchers");
});
test("groups resolve to player ids; a player may be in several groups; removing from camp cleans up", () => {
  const camp = campWith();
  const g1 = C.addGroup(camp, "Catchers", ["sl:a", "fcl:e"]);
  const g2 = C.addGroup(camp, "Early", ["sl:a"]);
  assert.notEqual(g1.color, g2.color);
  assert.deepEqual(C.groupsOf(camp, "sl:a").map((g) => g.name), ["Catchers", "Early"]);
  const a = C.newActivity({ date: "2027-02-15", groups: [g1.id, g2.id], players: ["cc:d"] });
  assert.deepEqual(Array.from(C.resolvePlayers(a, camp)).sort(), ["cc:d", "fcl:e", "sl:a"]);
  camp.draft.activities.push(a);
  C.removePlayersFromCamp(camp, ["sl:a", "cc:d"]);
  assert.ok(!camp.players.includes("sl:a") && !g1.players.includes("sl:a") && !camp.draft.activities[0].players.length);
  C.removeGroup(camp, g1.id);
  assert.deepEqual(camp.draft.activities[0].groups, [g2.id]);
});

test("conflicts: player double-booked via groups is an error naming both activities", () => {
  const camp = campWith();
  const g = C.addGroup(camp, "Catchers", ["sl:a", "fcl:e"]);
  const a = C.newActivity({ date: "2027-02-15", title: "Receiving", start: 480, dur: 30, facilityId: fac(camp, "Catching area"), groups: [g.id] });
  const b = C.newActivity({ date: "2027-02-15", title: "Cage Work", start: 495, dur: 30, facilityId: fac(camp, "Cage 1"), players: ["sl:a"] });
  camp.draft.activities.push(a, b);
  const cf = C.conflicts(camp, { index: C.poolIndex(pool()) });
  const pc = cf.filter((c) => c.kind === "player");
  assert.equal(pc.length, 1);
  assert.equal(pc[0].level, "error");
  assert.match(pc[0].msg, /Alan Testcatch is in both Receiving .* and Cage Work/);
  // back-to-back is fine
  b.start = 510;
  assert.equal(C.conflicts(camp).filter((c) => c.kind === "player").length, 0);
  // other dates don't clash
  b.start = 480; b.date = "2027-02-16";
  assert.equal(C.conflicts(camp).filter((c) => c.level === "error").length, 0);
});
test("conflicts: staff double-booked", () => {
  const camp = campWith();
  camp.staff.push({ id: "s1", name: "Test Coach", role: "Hitting" });
  camp.draft.activities.push(
    C.newActivity({ date: "2027-02-15", title: "A", start: 480, dur: 60, facilityId: fac(camp, "Field 1"), staff: ["s1"], players: ["sl:a"] }),
    C.newActivity({ date: "2027-02-15", title: "B", start: 500, dur: 20, facilityId: fac(camp, "Field 2"), staff: ["s1"], players: ["cc:d"] }));
  const s = C.conflicts(camp).filter((c) => c.kind === "staff");
  assert.equal(s.length, 1);
  assert.match(s[0].msg, /Test Coach is assigned to both A and B/);
});
test("conflicts: facility one-at-a-time and capacity (shared bullpen)", () => {
  const camp = campWith();
  const f1 = fac(camp, "Field 1"), pen = fac(camp, "Bullpen mounds (8)");
  camp.draft.activities.push(
    C.newActivity({ date: "2027-02-15", title: "Defense", start: 480, dur: 30, facilityId: f1, players: ["sl:a"] }),
    C.newActivity({ date: "2027-02-15", title: "BP", start: 490, dur: 30, facilityId: f1, players: ["cc:d"] }));
  const fc = C.conflicts(camp).filter((c) => c.kind === "facility");
  assert.equal(fc.length, 1);
  assert.match(fc[0].msg, /Field 1 is double-booked at 8:10 AM/);
  // the bullpen takes several activities at once, up to 8 throwers
  const penFac = camp.facilities.find((f) => f.id === pen);
  assert.equal(penFac.capacity, 8); assert.equal(penFac.concurrent, null);
  const nine = Array.from({ length: 9 }, (_, i) => "zz:" + i);
  camp.draft.activities.push(
    C.newActivity({ date: "2027-02-15", title: "Pens A", start: 600, dur: 30, facilityId: pen, players: nine.slice(0, 5) }),
    C.newActivity({ date: "2027-02-15", title: "Pens B", start: 600, dur: 30, facilityId: pen, players: nine.slice(5) }));
  const cap = C.conflicts(camp).filter((c) => c.kind === "capacity");
  assert.equal(cap.length, 1);
  assert.match(cap[0].msg, /9 players, capacity 8/);
  assert.equal(C.conflicts(camp).filter((c) => c.kind === "facility" && c.facilityId === pen).length, 0);
});
test("conflicts: warnings for no facility, nobody assigned, not in camp, off-roster, no capacity", () => {
  const camp = campWith();
  camp.facilities.push({ id: "fx", name: "Back lot", type: "other", capacity: null, concurrent: 1 });
  camp.draft.activities.push(
    C.newActivity({ date: "2027-02-15", title: "Loose", start: 480, dur: 30 }),
    C.newActivity({ date: "2027-02-15", title: "Guest", start: 600, dur: 30, facilityId: "fx", players: ["ash:ghost"] }));
  const cf = C.conflicts(camp, { index: C.poolIndex(pool()) });
  const kinds = cf.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["empty", "nocapacity", "nofacility", "notincamp", "unknown"]);
  assert.ok(cf.every((c) => c.level === "warning"));
  const by = C.conflictsByActivity(cf);
  assert.equal(by[camp.draft.activities[1].id].warnings.length, 2, "no-capacity note stays in the list, not on the block");
});

test("duplicate activity, copy day (append / replace / range), clear day", () => {
  const camp = campWith();
  const a = C.newActivity({ date: "2027-02-15", title: "Stretch", start: 480, dur: 15 });
  camp.draft.activities.push(a, C.newActivity({ date: "2027-02-15", title: "Lift", start: 495, dur: 45 }));
  const d = C.duplicateActivity(camp, a.id);
  assert.equal(d.start, 495); assert.notEqual(d.id, a.id); assert.equal(d.title, "Stretch");
  camp.draft.activities.push(C.newActivity({ date: "2027-02-16", title: "Old", start: 480, dur: 15 }));
  let r = C.copyDay(camp, "2027-02-15", ["2027-02-16"]);
  assert.deepEqual(r, { added: 3, removed: 0 });
  assert.equal(C.activitiesOn(camp.draft.activities, "2027-02-16").length, 4);
  r = C.copyDay(camp, "2027-02-15", C.dateRange("2027-02-16", "2027-02-18"), { replace: true });
  assert.deepEqual(r, { added: 9, removed: 4 });
  const ids = new Set(camp.draft.activities.map((x) => x.id));
  assert.equal(ids.size, camp.draft.activities.length, "copies get new ids");
  assert.equal(C.clearDay(camp, "2027-02-18"), 3);
});
test("templates: save a day, apply to another date and to another camp (match by name, report misses)", () => {
  const camp = campWith();
  const g = C.addGroup(camp, "Catchers", ["sl:a"]);
  camp.staff.push({ id: "s1", name: "Test Coach", role: "" });
  camp.draft.activities.push(C.newActivity({ date: "2027-02-15", title: "Receiving", cat: "fundamentals", start: 480, dur: 30, facilityId: fac(camp, "Catching area"), groups: [g.id], staff: ["s1"], players: ["cc:d"] }));
  const t = C.templateFromDay(camp, "2027-02-15", "Std");
  assert.equal(t.activities.length, 1);
  let r = C.applyTemplate(camp, t, "2027-02-17");
  assert.equal(r.added, 1);
  const copy = C.activitiesOn(camp.draft.activities, "2027-02-17")[0];
  assert.equal(copy.facilityId, fac(camp, "Catching area")); assert.deepEqual(copy.groups, [g.id]); assert.deepEqual(copy.staff, ["s1"]);
  // a different camp: facilities matched by name, missing group/staff/player reported
  const other = C.newCamp({ name: "Other", start: "2027-03-01" });
  r = C.applyTemplate(other, t, "2027-03-01");
  assert.equal(other.draft.activities[0].facilityId, fac(other, "Catching area"));
  assert.deepEqual(r.groups, ["Catchers"]); assert.deepEqual(r.staff, ["Test Coach"]); assert.equal(r.players, 1);
  // replace clears the target day first
  r = C.applyTemplate(other, t, "2027-03-01", { replace: true });
  assert.equal(r.removed, 1); assert.equal(other.draft.activities.length, 1);
});
test("publish: snapshot, unpublished state, diff (added / changed / removed / groups), revert", () => {
  const camp = campWith();
  assert.equal(C.hasUnpublished(camp), false, "an empty never-published camp has nothing to publish");
  const a = C.newActivity({ date: "2027-02-15", title: "A", start: 480 }), b = C.newActivity({ date: "2027-02-15", title: "B", start: 540 });
  camp.draft.activities.push(a, b);
  let d = C.diffPublished(camp);
  assert.equal(d.firstPublish, true); assert.equal(d.added.length, 2);
  C.publish(camp, "2027-02-14T12:00:00.000Z");
  assert.equal(C.hasUnpublished(camp), false);
  a.start = 495; C.removeActivity(camp, b.id); camp.draft.activities.push(C.newActivity({ date: "2027-02-16", title: "C" })); C.addGroup(camp, "G", []);
  assert.equal(C.hasUnpublished(camp), true);
  d = C.diffPublished(camp);
  assert.equal(d.added.length, 1); assert.equal(d.removed.length, 1); assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0].labels, ["start"]);
  assert.deepEqual(d.groups.added, ["G"]);
  assert.equal(camp.published.activities.find((x) => x.id === a.id).start, 480, "snapshot is independent of the draft");
  const v = C.versionView(camp, "published");
  assert.equal(v._version, "published"); assert.equal(v.draft.activities.length, 2);
  assert.equal(C.versionView(camp, "draft").draft.activities.length, 2);
  C.revertToPublished(camp);
  assert.equal(C.hasUnpublished(camp), false);
});
test("lanes: overlapping blocks share a column side by side", () => {
  const L = C.layoutLanes([{ id: "a", start: 480, dur: 60 }, { id: "b", start: 490, dur: 20 }, { id: "c", start: 515, dur: 10 }, { id: "d", start: 600, dur: 10 }]);
  assert.deepEqual([L.a.lane, L.b.lane, L.c.lane], [0, 1, 1]);
  assert.equal(L.a.lanes, 2); assert.equal(L.d.lanes, 1); assert.equal(L.d.lane, 0);
});

test("dates are calendar-only (no viewer timezone) across DST and month ends", () => {
  assert.equal(C.addDays("2027-03-13", 1), "2027-03-14");
  assert.equal(C.addDays("2027-03-14", 1), "2027-03-15", "spring-forward day is still one day");
  assert.equal(C.addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(C.addDays("2028-02-28", 1), "2028-02-29");
  assert.deepEqual(C.dateRange("2027-03-13", "2027-03-15"), ["2027-03-13", "2027-03-14", "2027-03-15"]);
  assert.equal(C.weekday("2027-02-15"), 1);
  assert.equal(C.weekStart("2027-02-21"), "2027-02-15");
  assert.equal(C.isDate("2027-02-30"), false);
  assert.equal(C.fmtDate("2027-02-15"), "Mon, Feb 15");
  assert.equal(C.fmtRange("2027-02-15", "2027-02-21"), "Feb 15–21, 2027");
  const prev = process.env.TZ;
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
    process.env.TZ = tz;
    assert.equal(C.addDays("2027-03-14", 1), "2027-03-15", "independent of the process timezone " + tz);
    assert.equal(C.weekday("2027-03-14"), 0);
  }
  process.env.TZ = prev;
});
test("times are minutes in the camp's local day; now/abbr come from the camp's timezone", () => {
  assert.equal(C.fmtTime(450), "7:30 AM"); assert.equal(C.fmtTime(780), "1:00 PM"); assert.equal(C.fmtTime(720, { short: true }), "12 PM");
  assert.equal(C.fmtSpan(450, 30), "7:30–8:00 AM"); assert.equal(C.fmtSpan(690, 60), "11:30 AM–12:30 PM");
  assert.equal(C.parseTime("07:30"), 450); assert.equal(C.parseTime("7:30 PM"), 1170); assert.equal(C.parseTime("1930"), 1170); assert.equal(C.parseTime("25:00"), null);
  assert.equal(C.toHHMM(545), "09:05");
  // 2027-03-14 12:30 UTC is 08:30 EDT (after the DST change) and 05:30 in Phoenix
  const t = Date.UTC(2027, 2, 14, 12, 30);
  assert.deepEqual(C.nowIn("America/New_York", t), { date: "2027-03-14", minute: 510 });
  assert.deepEqual(C.nowIn("America/Phoenix", t), { date: "2027-03-14", minute: 330 });
  // just after UTC midnight it is still the previous day in Florida
  assert.equal(C.nowIn("America/New_York", Date.UTC(2027, 1, 16, 2, 0)).date, "2027-02-15");
  assert.equal(C.tzAbbr("America/New_York", "2027-02-15"), "EST");
  assert.equal(C.tzAbbr("America/New_York", "2027-07-15"), "EDT");
  assert.equal(C.isTimeZone("Mars/Base"), false);
  assert.equal(C.newCamp({ name: "x", start: "2027-02-15", tz: "Mars/Base" }).tz, "America/New_York");
});

function mem(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
test("storage: round trip, normalisation of bad shapes, corrupt JSON backed up, blocked storage", () => {
  const s = mem();
  assert.deepEqual(C.loadState(s).state.camps, []);
  const st = C.emptyState(); const camp = campWith(); st.camps.push(camp); st.activeCampId = camp.id;
  assert.equal(C.saveState(s, st), true);
  const back = C.loadState(s).state;
  assert.equal(back.camps[0].players.length, 5); assert.equal(back.activeCampId, camp.id);
  // shapes that would crash a naive reader
  const odd = mem({ [C.STORAGE_KEY]: JSON.stringify({ camps: [null, { name: "no dates" }, { id: "k", name: "ok", start: "2027-01-02", end: "2026-01-01", facilities: "x", draft: { activities: [{ date: "bad" }, { date: "2027-01-02", start: 2000, dur: -5, cat: "weird" }] } }], templates: "x" }) });
  const o = C.loadState(odd).state;
  assert.equal(o.camps.length, 1); assert.equal(o.camps[0].end, "2027-01-02"); assert.deepEqual(o.camps[0].facilities, []);
  assert.equal(o.camps[0].draft.activities.length, 1); assert.equal(o.camps[0].draft.activities[0].cat, "other");
  assert.ok(o.camps[0].draft.activities[0].start <= 1435 && o.camps[0].draft.activities[0].dur >= 5);
  // corrupt JSON: empty state, unreadable text kept under a backup key before anything overwrites it
  const bad = mem({ [C.STORAGE_KEY]: "{oops" });
  const r = C.loadState(bad, 1234);
  assert.equal(r.recovered, true); assert.equal(r.backupKey, C.STORAGE_KEY + ".backup.1234");
  assert.equal(bad.m.get(r.backupKey), "{oops");
  C.saveState(bad, r.state);
  assert.equal(bad.m.get(r.backupKey), "{oops", "backup survives the next save");
  assert.equal(C.loadState(mem({ [C.STORAGE_KEY]: "[1,2]" })).recovered, true, "a non-object is treated as corrupt");
  // blocked storage
  const blocked = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(C.loadState(blocked).error, "unavailable");
  assert.equal(C.saveState(blocked, st), false);
});
test("CSV of a day: header, quoting, resolved player names", () => {
  const camp = campWith();
  const g = C.addGroup(camp, "Catchers", ["sl:a"]);
  camp.draft.activities.push(C.newActivity({ date: "2027-02-15", title: "Receiving, live", start: 480, dur: 30, facilityId: fac(camp, "Catching area"), groups: [g.id], notes: 'say "hi"' }));
  const idx = C.poolIndex(pool());
  const csv = C.dayCSV(camp, "2027-02-15", (pid) => idx.get(pid).name);
  const lines = csv.trim().split("\r\n");
  assert.match(lines[0], /^Camp,Date,Start,End,Timezone,Activity/);
  assert.match(lines[1], /"Receiving, live"/);
  assert.match(lines[1], /Alan Testcatch/);
  assert.match(lines[1], /"say ""hi"""/);
});
test("itinerary / by staff / by facility", () => {
  const camp = campWith();
  const g = C.addGroup(camp, "Catchers", ["sl:a"]);
  camp.staff.push({ id: "s1", name: "Test Coach", role: "" });
  camp.draft.activities.push(
    C.newActivity({ date: "2027-02-15", title: "Late", start: 600, facilityId: fac(camp, "Field 2"), players: ["sl:a"] }),
    C.newActivity({ date: "2027-02-15", title: "Early", start: 480, facilityId: fac(camp, "Field 1"), groups: [g.id], staff: ["s1"] }),
    C.newActivity({ date: "2027-02-15", title: "Nowhere", start: 700 }));
  const it = C.itinerary(camp, "sl:a", "2027-02-15");
  assert.deepEqual(it.map((x) => x.act.title), ["Early", "Late"]);
  assert.deepEqual(it[0].via, ["Catchers"]);
  assert.deepEqual(C.byStaff(camp, "2027-02-15")[0].acts.map((a) => a.title), ["Early"]);
  const bf = C.byFacility(camp, "2027-02-15");
  assert.equal(bf[bf.length - 1].facility.name, "No facility");
  assert.equal(C.initials("Test Coach"), "TC");
});
