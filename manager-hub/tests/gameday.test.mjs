/* Manager Hub — game-day defaults (games/gameday.js), the settings endpoint and games-core rules.
   node --test manager-hub/tests/gameday.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { onRequestGet, onRequestPut } from "../../functions/apps/manager-hub/api/settings.js";
import { fakeD1 } from "./fake-d1.mjs";
const require = createRequire(import.meta.url);
const G = require("../../apps/manager-hub/games/gameday.js");
const { GamesCore: C, DateCore: D } = require("../../apps/manager-hub/games/games-core.js");
const E = require("../../apps/manager-hub/assistant/day-engine.js");
const f = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
const solve = (r) => E.Solve.solve(E.Solve.normalize(r), {});

test("game at 6:30 PM → the four standard activities at the owner's times, the game separate", () => {
  const s = G.startRequest({ game: true, gameTime: "18:30", settings: G.resolve(null, "sl") });
  assert.ok(E.Solve.validate(E.Solve.normalize(s.request), { strict: true }).ok);
  const p = solve(s.request);
  assert.deepEqual(p.items.map((i) => `${f(i.start)}–${f(i.end)} ${i.label}`), ["4:00–4:45 Home BP", "4:45–5:30 Visitor BP", "6:10–6:20 Pregame Warmup", "6:20–6:30 Anthem", "6:30–6:30 Game"]);
  assert.ok(p.ok);
});
test("TBD game → no invented times; Start Empty → only the game", () => {
  assert.equal(G.startRequest({ game: true, gameTime: "", settings: G.resolve(null, "sl") }).request.activities.length, 0);
  const e = G.startRequest({ game: true, gameTime: "19:05", empty: true, settings: G.resolve(null, "sl") });
  assert.equal(e.request.activities.length, 0); assert.equal(e.request.anchors.firstPitch, 1145);
});
test("game moved: untouched activities follow; a customised one stays unless 'all' is approved", () => {
  const set = G.resolve(null, "sl");
  const s = G.startRequest({ game: true, gameTime: "18:30", settings: set });
  s.request.activities.find((a) => a.id === "std-warmup").dur = 15;            // the coach changed it
  const r = G.recalc(s.request, s.generated, "19:05", set.gameDay, "untouched");
  assert.equal(r.moved, 3); assert.deepEqual(r.kept, ["std-warmup"]);
  assert.equal(r.request.activities.find((a) => a.id === "std-home-bp").at, 1145 - 150);
  assert.equal(r.request.activities.find((a) => a.id === "std-warmup").at, 1110 - 20, "kept where it was");
  const all = G.recalc(s.request, s.generated, "19:05", set.gameDay, "all");
  assert.equal(all.request.activities.find((a) => a.id === "std-warmup").at, 1145 - 20);
});
test("settings: affiliate override replaces the organization list; disabled / renamed activities respected", () => {
  const doc = { org: { gameDay: [{ key: "home-bp", label: "Our BP", before: 180, dur: 60, enabled: true }, { key: "anthem", label: "Anthem", before: 10, dur: 10, enabled: false }] }, affiliates: { fay: { gameDay: [{ key: "x", label: "Road BP", before: 120, dur: 30 }] } } };
  const sl = G.resolve(doc, "sl"), fay = G.resolve(doc, "fay");
  const a = G.startRequest({ game: true, gameTime: "19:00", settings: sl }).request.activities;
  assert.deepEqual(a.map((x) => [x.label, x.at, x.dur]), [["Our BP", 960, 60]]);
  assert.equal(fay.overridden.gameDay, true); assert.equal(G.startRequest({ game: true, gameTime: "19:00", settings: fay }).request.activities[0].label, "Road BP");
});
test("a description keeps the standard activities and our BP takes the BP slot (no second BP)", () => {
  const set = G.resolve(null, "sl");
  const std = G.startRequest({ game: true, gameTime: "18:30", settings: set }).request.activities;
  const described = E.Solve.normalize(E.Read.read("Catchers report at 1:30, hitters have early work at 2:00, pitchers stretch at 3:00, BP after", {}));
  const m = G.mergeStandard(described, std, true);
  const bp = m.activities.filter((a) => a.kind === "bp" || /BP/.test(a.label || ""));
  assert.ok(!m.activities.some((a) => a.id === "std-home-bp"), "home BP slot taken by the team's BP");
  assert.ok(m.activities.some((a) => a.id === "std-visitor-bp") && m.activities.some((a) => a.id === "std-anthem"));
  assert.equal(m.activities.find((a) => a.kind === "bp").at, 960);
  assert.ok(solve(m).ok, "the merged day solves");
  assert.ok(bp.length >= 1);
});
test("Complex workout day (no game)", () => {
  const p = solve(G.startRequest({ workout: true, settings: G.resolve(null, "fcl") }).request);
  assert.equal(p.items[0].label, "Staff Meeting"); assert.ok(p.items.some((i) => i.label === "Conditioning")); assert.ok(p.ok);
});
test("settings endpoint: stored in D1, versioned, sanitized; no store → defaults (GET) / 503 (PUT)", async () => {
  const env = { MH_AI_USAGE: fakeD1() };
  const req = (m, b) => new Request("https://cperez.app/apps/manager-hub/api/settings", { method: m, headers: { "Content-Type": "application/json", Origin: "https://cperez.app" }, body: b ? JSON.stringify(b) : undefined });
  let r = await (await onRequestGet({ env })).json(); assert.equal(r.version, 0); assert.equal(r.stored, true);
  r = await onRequestPut({ env, request: req("PUT", { doc: { org: { gameDay: [{ label: "<b>BP</b>", before: 150, dur: 45 }] } }, baseVersion: 0 }) });
  assert.equal(r.status, 200); const v1 = await r.json(); assert.equal(v1.version, 1);
  r = await onRequestPut({ env, request: req("PUT", { doc: { org: {} }, baseVersion: 0 }) }); assert.equal(r.status, 409, "stale write refused");
  r = await (await onRequestGet({ env })).json(); assert.equal(r.doc.org.gameDay[0].label, "<b>BP</b>".slice(0, 60));
  assert.equal((await onRequestPut({ env: {}, request: req("PUT", { doc: {} }) })).status, 503);
  assert.equal((await (await onRequestGet({ env: {} })).json()).stored, false);
  assert.equal((await onRequestPut({ env, request: new Request("https://cperez.app/x", { method: "PUT", headers: { Origin: "https://evil.example" }, body: "{}" }) })).status, 403);
});
test("games-core: migration, merge without duplicates, edits kept, deletions kept, doubleheaders", () => {
  const sched = (id, date, n, t) => ({ id, affiliate: "sl", date, gameNumber: n, home: true, opponent: { code: "OKC", name: "Oklahoma City Comets" }, venue: { name: "Constellation Field", city: "Sugar Land, TX", tz: "America/Chicago" }, localTime: t, tz: "America/Chicago", startUTC: "", timeTBD: false, status: "scheduled", type: "regular", doubleheader: n > 1 || false, seq: 1 });
  const ship = [sched("sl-2027-05-01-g1", "2027-05-01", 1, "13:05"), sched("sl-2027-05-01-g2", "2027-05-01", 2, "18:05"), sched("sl-2027-05-02-g1", "2027-05-02", 1, "19:05")];
  const old = { "2027-05-02": { id: "mine", date: "2027-05-02", opponent: "OKC", homeAway: "home", time: "19:00", notes: "my note" } };
  let r = C.merge(old, ship, "v1");
  assert.equal(r.summary.added, 2); assert.equal(r.summary.linked, 1);
  assert.equal(C.forDate(r.state, "2027-05-01").length, 2, "doubleheader = two games");
  const mine = C.forDate(r.state, "2027-05-02"); assert.equal(mine.length, 1); assert.equal(mine[0].notes, "my note"); assert.ok(mine[0].scheduleChange, "time difference flagged for review");
  r = C.merge(r.state, ship, "v1"); assert.equal(r.summary.added, 0); assert.equal(Object.keys(r.state.games).length, 3, "rerun adds nothing");
  const g1 = C.forDate(r.state, "2027-05-01")[0];
  C.edit(r.state, g1.id, { time: "12:05" });
  ship[0].localTime = "14:05"; r = C.merge(r.state, ship, "v2");
  assert.equal(C.forDate(r.state, "2027-05-01")[0].time, "12:05", "the user's edit wins"); assert.ok(C.forDate(r.state, "2027-05-01")[0].scheduleChange);
  C.remove(r.state, C.forDate(r.state, "2027-05-01")[1].id); r = C.merge(r.state, ship, "v3");
  assert.equal(C.forDate(r.state, "2027-05-01").length, 1, "a deleted imported game stays deleted");
  r = C.merge(r.state, ship.slice(0, 2), "v4"); assert.equal(r.summary.removedFromSchedule, 0, "linked/edited games are not marked");
});
test("DateCore: today in a time zone, across midnight", () => {
  const t = Date.UTC(2026, 10, 11, 4, 30);                                       // 11:30 PM ET / 10:30 PM CT on Nov 10
  assert.equal(D.todayIn("America/New_York", t), "2026-11-10"); assert.equal(D.todayIn("America/Chicago", t), "2026-11-10");
  assert.equal(D.todayIn("America/New_York", t + 3600e3), "2026-11-11"); assert.equal(D.todayIn("America/Chicago", t + 3600e3), "2026-11-10");
  const ms = D.msToMidnight("America/Chicago", t); assert.ok(Math.abs(ms - 90 * 60e3) < 2000, "90 minutes to Chicago midnight: " + ms);
  assert.equal(D.addDays("2027-02-28", 1), "2027-03-01");
});
