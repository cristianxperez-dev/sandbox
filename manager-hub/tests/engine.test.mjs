// Schedule Assistant engine — unit tests (node --test manager-hub/tests/)
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.mjs";

const M = load();
// values built inside the VM have their own Array/Object prototypes: compare by value
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const deq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);
const KIND = (l) => (/cage|tunnel/i.test(l) ? "cage" : /field/i.test(l) ? "field" : /mound|bullpen|pen\b/i.test(l) ? "mound" : /turf/i.test(l) ? "turf" : /weight|gym/i.test(l) ? "gym" : /room|clubhouse/i.test(l) ? "room" : "none");
const DUR = { stretch: 15, "cage hitting": 20, defense: 30, bullpen: 30, lift: 45, "on-field bp": 30, pfp: 15, "team meeting": 20 };
const CTX = {
  durationOf: (a) => DUR[String(a).toLowerCase().replace(/:$/, "")] || null,
  keyOf: (t) => { const s = String(t).toLowerCase(); return /\bbp\b|batting practice/.test(s) ? "bp" : /bullpen|pens?\b|sides?/.test(s) ? "bullpen" : /hit|cage/.test(s) ? "hitting" : /defen/.test(s) ? "defense" : /lift|weights/.test(s) ? "lift" : /stretch/.test(s) ? "stretch" : null; },
  isStaff: (t) => /^(rc|cl|dk|casey|jordan|tg)$/i.test(String(t).trim()),
  staffLabel: (t) => ({ casey: "CW", jordan: "JN" })[String(t).toLowerCase()] || String(t).toUpperCase(),
  isLocation: (t) => /^(field [1-3]|cage [1-3]|mlb cage|turf|weight room|bullpen|indoor turf)$/i.test(String(t).replace(/^the\s+/i, "")),
  canonLocation: (t) => String(t).replace(/^the\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase()),
  canonActivity: (t) => String(t).replace(/\b\w/g, (c) => c.toUpperCase()),
  kindOf: KIND,
  indoorFor: (ev) => (/bp|hit/i.test(ev.activity) ? "Cage 2" : /stretch|defen/i.test(ev.activity) ? "Indoor Turf" : null)
};
function day() {
  return [
    { id: "team", kind: "table", name: "All Players & Staff", gtype: "other", headers: { staff: "Personnel" }, rows: [
      { id: "t1", time: "7:30", activity: "Team Meeting", location: "Clubhouse" },
      { id: "t2", time: "12:05", activity: "First Pitch", location: "Field 1", ev: { dur: 0, flex: "anchor" } }] },
    { id: "lu", kind: "lineup", name: "Lineup", rows: [] },
    { id: "blue", kind: "table", name: "Blue Position Players", gtype: "position", roster: ["A", "B"], rows: [
      { id: "b1", time: "8:00", activity: "Stretch", location: "Turf", staff: "DK", rowColor: "#fde" },
      { id: "b2", time: "8:15", activity: "Cage Hitting", location: "MLB Cage", staff: "RC" },
      { id: "b3", time: "8:35", activity: "Defense", location: "Field 2", staff: "CL", detail: "Infielders" },
      { id: "b4", time: "Post", activity: "Dress & Snack Break", location: "Clubhouse" }] },
    { id: "orange", kind: "table", name: "Orange Position Players", gtype: "position", rows: [
      { id: "o1", time: "8:00", activity: "Stretch", location: "Turf", staff: "DK" },
      { id: "o2", time: "8:15", activity: "Defense", location: "Field 1", staff: "TG" },
      { id: "o3", time: "8:45", activity: "Cage Hitting", location: "MLB Cage", staff: "RC" }] },
    { id: "g1", kind: "table", name: "Group 1 Pitchers", gtype: "pitcher", rows: [
      { id: "p1", time: "8:00", activity: "Throwing", location: "Turf" },
      { id: "p2", time: "8:30", activity: "Bullpen", location: "Bullpen", staff: "CW" }] }
  ];
}
const ev = () => M.fromSections(day(), CTX);
const byId = (list, id) => list.find((e) => e.id === id);
const fmt = (e) => M.fmtAP(e.start);

/* ---------------------------------------------------------- time + speech */
test("parseClock follows the sheet's baseball-day rule and explicit suffixes", () => {
  assert.equal(M.parseClock("8"), 480);
  assert.equal(M.parseClock("8:15"), 495);
  assert.equal(M.parseClock("815"), 495);
  assert.equal(M.parseClock("1:30"), 810, "1–5 without a suffix is afternoon");
  assert.equal(M.parseClock("6:05 pm"), 1085);
  assert.equal(M.parseClock("6:05p"), 1085);
  assert.equal(M.parseClock("12:00"), 720);
  assert.equal(M.parseClock("noon"), 720);
  assert.equal(M.parseClock("7:00 am"), 420);
  assert.equal(M.parseClock("25:00"), null);
  assert.equal(M.parseClock("Postgame"), null);
});
test("rowTime writes plain h:mm in the sheet window and a suffix outside it", () => {
  assert.equal(M.rowTime(495), "8:15");
  assert.equal(M.rowTime(810), "1:30");
  assert.equal(M.rowTime(1085), "6:05 PM");
  assert.equal(M.rowTime(330), "5:30 AM");
  assert.equal(M.rowStart(M.rowTime(1085)), 1085, "suffix round-trips");
});
test("normalizeSpeech cleans dictation: spoken times, durations, punctuation errors", () => {
  const t = M.normalizeSpeech("Blue starts at eight thirty, lift for forty five minutes, quarter past nine bullpens, half an hour of BP, game at 6:05 p. m.");
  assert.match(t, /at 8:30/);
  assert.match(t, /45 minutes/);
  assert.match(t, /9:15 bullpens/);
  assert.match(t, /30 minutes of BP/);
  assert.match(t, /6:05 pm/);
  assert.match(M.normalizeSpeech("meeting at 8. 15 then stretch"), /8:15/);
  assert.match(M.normalizeSpeech("lift at 9 15 am"), /9:15 am/);
  assert.match(M.normalizeSpeech("quarter to ten"), /9:45/);
  assert.match(M.normalizeSpeech("two groups, three fields"), /2 groups, 3 fields/);
  assert.match(M.normalizeSpeech("team defense twice a week"), /2 times a week/);
  assert.match(M.normalizeSpeech("an hour and a half of camp"), /90 minutes/);
});

/* ------------------------------------------------------------ data model */
test("fromSections maps rows to canonical events with assumed durations flagged", () => {
  const e = ev();
  const b2 = byId(e, "b2");
  assert.equal(b2.start, 495); assert.equal(b2.dur, 20); assert.equal(b2.group, "Blue Position Players"); assert.equal(b2.gtype, "position");
  assert.equal(b2.assumedDur, true);
  assert.equal(byId(e, "b4").start, null, "Post has no clock time");
  assert.equal(byId(e, "t2").dur, 0); assert.equal(byId(e, "t2").flex, "anchor");
  assert.ok(!e.some((x) => x.sec === "lu"), "the lineup card is not an event");
});
test("toSections round-trips without losing rows, ids, order or row-level fields", () => {
  const secs = day();
  const back = M.toSections(M.fromSections(secs, CTX), secs);
  assert.equal(back.length, secs.length);
  const blue = back.find((s) => s.id === "blue");
  deq(blue.rows.map((r) => r.id), ["b1", "b2", "b3", "b4"], "untimed Post row stays after what preceded it");
  assert.equal(blue.rows[0].rowColor, "#fde", "fields the assistant doesn't own survive");
  deq(blue.roster, ["A", "B"]);
  assert.equal(back.find((s) => s.kind === "lineup").id, "lu");
  assert.equal(blue.rows[1].time, "8:15");
});
test("toSections creates a section for a new group and stores duration metadata", () => {
  const e = ev().concat([M.makeEvent({ group: "Green Position Players", gtype: "position", activity: "Bunt Defense", start: 600, dur: 25, location: "Field 2" })]);
  const secs = M.toSections(e, day());
  const g = secs.find((s) => s.name === "Green Position Players");
  assert.ok(g); assert.equal(g.rows[0].time, "10:00"); assert.equal(g.rows[0].ev.dur, 25); assert.equal(g.gtype, "position");
  const again = M.fromSections(secs, CTX).find((x) => x.activity === "Bunt Defense");
  assert.equal(again.dur, 25, "duration survives without an end time on the sheet");
});
test("JSON round trip of a published schedule is lossless", () => {
  const secs = M.toSections(ev(), day());
  const json = JSON.parse(JSON.stringify({ schedule: { sections: secs } }));
  deq(M.fromSections(json.schedule.sections, CTX).map((x) => [x.id, x.start, x.dur, x.location]), M.fromSections(secs, CTX).map((x) => [x.id, x.start, x.dur, x.location]));
});

/* ------------------------------------------------------------ validation */
test("validate: a clean day has no warnings", () => {
  const issues = M.validate(ev(), { kindOf: KIND });
  deq(issues.filter((i) => i.level !== "info"), []);
});
test("validate: facility double-booked, but joint sessions are not conflicts", () => {
  const e = ev();
  byId(e, "o3").activity = "Machine BP"; M.setStart(byId(e, "o3"), 495);   // Orange in the same cage, different work
  let iss = M.validate(e, { kindOf: KIND });
  assert.ok(iss.some((i) => i.code === "facility" && /MLB Cage/.test(i.msg)));
  byId(e, "o3").activity = "Cage Hitting"; byId(e, "o3").dur = 20; M.setStart(byId(e, "o3"), 495);
  // same activity, same place, same start = one session (Live BP / shared lift)
  iss = M.validate(e, { kindOf: KIND });
  assert.ok(!iss.some((i) => i.code === "facility"), "joint session");
});
test("validate: a group double-booked; a split group is informational", () => {
  const e = ev();
  e.push(M.makeEvent({ id: "dup", sec: "blue", group: "Blue Position Players", activity: "Lift", start: 500, dur: 30, location: "Weight Room" }));
  let iss = M.validate(e, { kindOf: KIND });
  assert.ok(iss.some((i) => i.code === "group-overlap" && i.level === "warning"));
  const s = ev();
  s.push(M.makeEvent({ id: "split", sec: "blue", group: "Blue Position Players", activity: "Cage Hitting", start: 515, dur: 30, location: "Cage 2", detail: "Outfielders" }));
  iss = M.validate(s, { kindOf: KIND });
  assert.ok(iss.some((i) => i.code === "split-group" && i.level === "info"));
  assert.ok(!iss.some((i) => i.code === "group-overlap"));
});
test("validate: one coach in two places; duplicates; transitions; zero-length", () => {
  const e = ev();
  M.setStart(byId(e, "o2"), 515); byId(e, "o2").staff = "CL"; byId(e, "o2").location = "Field 3";
  let iss = M.validate(e, { kindOf: KIND });
  assert.ok(iss.some((i) => i.code === "staff" && /CL/.test(i.msg)));
  const d = ev(); d.push(Object.assign(M.clone(byId(d, "b2")), { id: "b2x" }));
  assert.ok(M.validate(d, { kindOf: KIND }).some((i) => i.code === "duplicate"));
  const t = ev(); byId(t, "b2").location = "Weight Room"; byId(t, "b2").activity = "Lift"; M.setDur(byId(t, "b2"), 20);
  assert.ok(M.validate(t, { kindOf: KIND }).some((i) => i.code === "transition"));
});
test("validate: game-day dependencies — pregame window, during the game, deadline", () => {
  const e = ev(); M.setStart(byId(e, "b3"), 11 * 60 + 40);
  const iss = M.validate(e, { kindOf: KIND, firstPitch: 725 });
  assert.ok(iss.some((i) => i.code === "pregame"), "group work inside the last 45 minutes");
  const g = ev(); M.setStart(byId(g, "b3"), 12 * 60 + 30);
  assert.ok(M.validate(g, { kindOf: KIND, firstPitch: 725 }).some((i) => i.code === "during-game"));
  assert.ok(M.validate(ev(), { kindOf: KIND, deadline: 8 * 60 + 40 }).some((i) => i.code === "deadline"));
});
test("validate: ordering the coach asked for (bullpens before BP)", () => {
  const e = ev(); e.push(M.makeEvent({ id: "bp", sec: "orange", group: "Orange Position Players", activity: "On-Field BP", start: 520, dur: 30, location: "Field 2" }));
  const ctx = { kindOf: KIND, precedence: [{ before: "bullpen", after: "bp" }], keysOf: (a) => [CTX.keyOf(a)].filter(Boolean) };
  assert.ok(M.validate(e, ctx).some((i) => i.code === "dependency"));
  M.setStart(byId(e, "bp"), 545);
  assert.ok(!M.validate(e, ctx).some((i) => i.code === "dependency"));
});
test("validate: beyond-day and outside-window times are flagged, missing times noted", () => {
  const e = [M.makeEvent({ group: "X", activity: "Lift", start: 23 * 60 + 30, dur: 60 }), M.makeEvent({ group: "Y", activity: "Dinner", start: 18 * 60 + 30, dur: 30 })];
  e.push(Object.assign(M.makeEvent({ group: "Z", activity: "Video" }), { start: null, end: null, timeText: "" }));
  const iss = M.validate(e, {});
  assert.ok(iss.some((i) => i.code === "beyond-day"));
  assert.ok(iss.some((i) => i.code === "outside-window"));
  assert.ok(iss.some((i) => i.code === "no-time"));
});

/* ------------------------------------------------------------- rotations */
test("buildRotation: Latin square — every group sees every station once, no station double-used", () => {
  const R = M.buildRotation({ groups: [1, 2, 3, 4].map((i) => ({ name: "G" + i })), stations: ["Cages", "Defense", "Baserunning", "Bunt Defense"].map((l) => ({ label: l })), start: 540, dur: 20, transition: 5 });
  assert.equal(R.events.length, 16); assert.equal(R.matrix.length, 4);
  assert.equal(R.end, 540 + 4 * 20 + 3 * 5);
  for (const g of ["G1", "G2", "G3", "G4"]) assert.equal(new Set(R.events.filter((e) => e.group === g).map((e) => e.activity)).size, 4);
  R.matrix.forEach((r) => assert.equal(new Set(r.cells).size, 4, "each station once per round"));
  assert.equal(R.matrix[1].start, 565);
});
test("buildRotation: more groups than stations gives open blocks", () => {
  const R = M.buildRotation({ groups: [1, 2, 3].map((i) => ({ name: "G" + i })), stations: [{ label: "A" }, { label: "B" }], start: 600, dur: 15 });
  assert.equal(R.byes, 3); assert.equal(R.matrix.length, 3);
  assert.equal(R.events.length, 6);
});
test("parseRotation reads stations, minutes, start and transitions from a sentence", () => {
  const r = M.parseRotation("Report at 8. Four groups rotate through cages, defense, baserunning and bunt defense, 25 minutes each, starting at 8:45 with 5 minute transitions.");
  deq(r.stations, ["cages", "defense", "baserunning", "bunt defense"]);
  assert.equal(r.dur, 25); assert.equal(r.start, 525); assert.equal(r.transition, 5); assert.equal(r.count, 4);
  const r2 = M.parseRotation("Rotate Blue, Orange and Green through tee, flips and machine every 15 minutes");
  deq(r2.groupNames, ["Blue", "Orange", "Green"]); assert.equal(r2.dur, 15);
  assert.equal(M.parseRotation("Everyone gets BP after rotations."), null, "a mention of rotations is not a rotation");
});
test("splitRoster balances positions across groups", () => {
  const ps = ["C", "C", "1B", "SS", "2B", "3B", "LF", "CF", "RF", "OF"].map((pos, i) => ({ name: "P" + i, pos }));
  const g = M.splitRoster(ps, 2);
  assert.equal(g[0].length + g[1].length, 10);
  assert.ok(Math.abs(g[0].length - g[1].length) <= 1);
  assert.equal(g[0].filter((p) => p.pos === "C").length, 1, "one catcher each");
});

/* ------------------------------------------------------- conversational */
const run = (text, events = ev()) => { const p = M.parseCommands(text, events, CTX); const r = M.applyOps(events, p.ops, CTX); return { p, r, d: M.diff(events, r.events) }; };
test("“move hitting back 15” moves every hitting block 15 later and ripples the group", () => {
  const { p, r, d } = run("move hitting back 15");
  assert.equal(p.ops[0].op, "shift"); assert.equal(p.ops[0].delta, 15);
  assert.ok(p.notes.some((n) => /later/.test(n)), "says how it read 'back'");
  assert.equal(fmt(byId(r.events, "b2")), "8:30a"); assert.equal(fmt(byId(r.events, "o3")), "9:00a");
  assert.equal(fmt(byId(r.events, "b3")), "8:50a", "Blue defense slid to make room");
  assert.ok(d.changed.length >= 3);
});
test("earlier / later / ambiguous 'forward'", () => {
  assert.equal(run("push BP 10 minutes later", (() => { const e = ev(); e.push(M.makeEvent({ id: "x", sec: "blue", group: "Blue Position Players", activity: "On-Field BP", start: 600, dur: 30 })); return e; })()).p.ops[0].delta, 10);
  assert.equal(run("move stretch up 5").p.ops[0].delta, -5);
  const f = run("push everything forward 10");
  assert.equal(f.p.ops.length, 0); assert.match(f.p.clarify[0], /earlier or later/);
});
test("shorthand without a verb: “Orange's defense 10 minutes later”", () => {
  const { r } = run("Orange's defense 10 minutes later");
  assert.equal(fmt(byId(r.events, "o2")), "8:25a");
  assert.equal(fmt(byId(r.events, "b3")), "8:35a", "only Orange's block");
});
test("absolute times, durations, extend/shorten", () => {
  assert.equal(fmt(byId(run("move Blue defense to 9:30").r.events, "b3")), "9:30a");
  assert.equal(byId(run("make defense 20 minutes").r.events, "o2").dur, 20);
  assert.equal(byId(run("extend Blue defense by 10").r.events, "b3").dur, 40);
  assert.equal(byId(run("shorten cage hitting by 5").r.events, "b2").dur, 15);
  assert.equal(byId(run("cut Blue defense to 15 minutes").r.events, "b3").dur, 15);
});
test("places, staff, rename, remove", () => {
  assert.equal(byId(run("move cage hitting to Cage 2").r.events, "b2").location, "Cage 2");
  assert.equal(byId(run("have Casey run bullpen").r.events, "p2").staff, "CW");
  assert.equal(byId(run("assign TG to Blue defense").r.events, "b3").staff, "TG");
  assert.equal(byId(run("change Blue defense to Bunt Defense").r.events, "b3").activity, "Bunt Defense");
  const rm = run("remove stretch for Blue");
  assert.ok(!byId(rm.r.events, "b1")); assert.ok(byId(rm.r.events, "o1"), "Orange's stretch stays");
});
test("add with group, place and minutes; missing time asks", () => {
  const a = run("add bunt defense at 10 for Orange on Field 2 (25 min)");
  const n = a.d.added[0];
  assert.equal(n.group, "Orange Position Players"); assert.equal(n.start, 600); assert.equal(n.dur, 25); assert.equal(n.location, "Field 2");
  const b = run("add bunt defense for Orange");
  assert.equal(b.p.ops.length, 0); assert.match(b.p.clarify[0], /When should/);
});
test("swaps: groups, activity times, and the ambiguous case", () => {
  const g = run("swap Blue and Orange");
  assert.equal(byId(g.r.events, "b2").group, "Orange Position Players");
  assert.equal(byId(g.r.events, "b2").start, 495, "times and places stay; groups trade");
  const t = run("swap cage hitting and defense for Blue");
  assert.equal(fmt(byId(t.r.events, "b2")), "8:35a"); assert.equal(fmt(byId(t.r.events, "b3")), "8:15a");
  const amb = run("swap the position groups");
  assert.ok(amb.p.ops.length === 1 || amb.p.clarify.length === 1);
});
test("rain: outdoor blocks move to indoor space, the rest is flagged, BP becomes Cage BP", () => {
  const e = ev(); e.push(M.makeEvent({ id: "bp", sec: "blue", group: "Blue Position Players", activity: "On-Field BP", start: 600, dur: 30, location: "Field 2" }));
  const { p, r } = run("It's raining — move everything indoors", e);
  assert.equal(p.ops.filter((o) => o.op === "indoor").length, 1);
  assert.equal(byId(r.events, "bp").activity, "Cage BP"); assert.equal(byId(r.events, "bp").location, "Cage 2");
  assert.equal(byId(r.events, "b3").location, "Indoor Turf");
  assert.equal(byId(r.events, "b2").location, "MLB Cage", "already indoors");
  assert.ok(r.warnings.some((w) => /No indoor space/.test(w)), "the bullpen has nowhere to go and says so");
});
test("several edits in one sentence, applied in order", () => {
  const { p, r } = run("move hitting back 15 and make defense 20 minutes, then remove stretch for Orange");
  deq(p.ops.map((o) => o.op), ["shift", "setDur", "remove"]);
  assert.ok(!byId(r.events, "o1"));
});
test("anchors never move: a ripple stops at First Pitch and warns", () => {
  const e = [
    M.makeEvent({ id: "a", sec: "t", group: "All Players & Staff", activity: "Meeting", start: 700, dur: 20 }),
    M.makeEvent({ id: "fp", sec: "t", group: "All Players & Staff", activity: "First Pitch", start: 725, dur: 0, flex: "anchor" })
  ];
  const { r } = run("extend meeting by 20", e);
  assert.equal(byId(r.events, "fp").start, 725);
  assert.ok(r.warnings.some((w) => /fixed/.test(w)));
});
test("unknown targets ask with suggestions; nonsense is refused without changes", () => {
  const a = run("move yoga to 10");
  assert.equal(a.p.ops.length, 0); assert.match(a.p.clarify[0], /couldn't find “yoga”/);
  const b = run("make it pop");
  assert.equal(b.p.ops.length, 0); assert.ok(b.p.clarify.length + b.p.unparsed.length > 0);
  assert.equal(b.d.count, 0);
  assert.equal(run("undo").p.ops[0].op, "undo");
});
test("everything after a time / activity", () => {
  const { r } = run("push everything after 8:30 back 10");
  assert.equal(fmt(byId(r.events, "b3")), "8:45a"); assert.equal(fmt(byId(r.events, "b2")), "8:15a");
  assert.equal(byId(r.events, "t2").start, 725, "first pitch is not dragged along");
});

/* ------------------------------------------------------------------ diff */
test("diff + summarize report adds, removals and changes with old → new", () => {
  const a = ev(), b = M.clone(a);
  b.splice(b.findIndex((e) => e.id === "b1"), 1); M.setStart(byId(b, "b2"), 510); b.push(M.makeEvent({ id: "n", group: "Blue Position Players", activity: "Lift", start: 600, dur: 30 }));
  const d = M.diff(a, b);
  assert.equal(d.added.length, 1); assert.equal(d.removed.length, 1); assert.equal(d.changed.length, 1);
  const s = M.summarize(d).join("\n");
  assert.match(s, /\+ Lift/); assert.match(s, /− Stretch/); assert.match(s, /8:15a → 8:30a/);
});

/* ---------------------------------------------------- references + templates */
test("references: same as yesterday / weekday / named templates", () => {
  deq(M.parseReference("Same as yesterday but no lift"), { kind: "yesterday", weekday: null, rest: "no lift" });
  const w = M.parseReference("same as last Monday, but BP at 10");
  assert.equal(w.kind, "weekday"); assert.equal(w.weekday, "Monday"); assert.equal(w.rest, "BP at 10");
  const t = M.parseReference("Use our normal Monday schedule but move BP to 10:30");
  assert.equal(t.kind, "template"); assert.equal(t.name, "Monday"); assert.equal(t.rest, "move BP to 10:30");
  assert.equal(M.parseReference("Two groups need defense"), null);
  const list = [{ name: "Normal Monday" }, { name: "Game Day — Home" }, { name: "Rain Plan" }];
  assert.equal(M.matchTemplate("Monday", list).name, "Normal Monday");
  assert.equal(M.matchTemplate("home game day", list).name, "Game Day — Home");
  assert.equal(M.matchTemplate("pitcher", list), null);
});
test("brief templates are generic: no people, all readable as briefs", () => {
  assert.ok(M.BRIEF_TEMPLATES.length >= 6);
  for (const t of M.BRIEF_TEMPLATES) { assert.ok(t.text.length > 60); assert.doesNotMatch(t.text, /\b[A-Z][a-z]+ [A-Z][a-z]+\b(?<!First Pitch)/); }
});

/* --------------------------------------------------------------- monthly */
const LIB = [
  { id: "bunt-defense", label: "Bunt Defense", cat: "fundamentals", dur: 20, pool: "field", who: "position" },
  { id: "team-defense", label: "Team Defense", cat: "fundamentals", dur: 25, pool: "field", who: "position" },
  { id: "pfp", label: "PFP", cat: "fundamentals", dur: 15, pool: "field", who: "pitcher" },
  { id: "lift", label: "Lift", cat: "strength", dur: 45, pool: "gym", who: "all" },
  { id: "cage-work", label: "Cage Work", cat: "hitting", dur: 40, pool: "cage", who: "position" },
  { id: "defense-rotation", label: "Defense Rotation", cat: "fundamentals", dur: 40, pool: "field", who: "position" }
];
const mctx = (plan = {}, games = {}) => ({ year: 2026, month: 3 /* April */, plan, games, library: LIB,
  findActivity: (p) => LIB.find((l) => l.label.toLowerCase() === p.toLowerCase().trim() || l.id === p.toLowerCase().trim().replace(/\s+/g, "-")) || null });
const dow = (iso) => new Date(iso + "T12:00:00").getDay();
test("month: “bunt defense every Tuesday” lands on every Tuesday and nowhere else", () => {
  const r = M.planMonth("Bunt defense every Tuesday", mctx());
  assert.equal(r.changes.length, 4);                    // April 2026 has four Tuesdays
  assert.ok(r.changes.every((c) => dow(c.iso) === 2 && c.add.includes("bunt-defense")));
});
test("month: “team defense 3 times a week” spreads Mon/Wed/Fri, prorates partial weeks, never duplicates", () => {
  const r = M.planMonth("Team defense 3 times a week", mctx({ "2026-04-06": { acts: ["team-defense"] } }));
  const days = r.changes.map((c) => c.iso);
  assert.ok(!days.includes("2026-04-06"), "already planned that day");
  const full = ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"];
  assert.equal(days.filter((d) => full.includes(d)).length, 3);
  deq(days.filter((d) => full.includes(d)).map(dow), [1, 3, 5]);
  assert.ok(r.notes.some((n) => /partial/.test(n)));
});
test("month: avoid heavy defense before morning games — moves the work and cleans the plan", () => {
  const games = { "2026-04-15": { time: "11:05", homeAway: "home" }, "2026-04-22": { time: "18:35", homeAway: "away" } };
  const r = M.planMonth("Team defense 3 times a week. Avoid heavy defense before morning games.", mctx({ "2026-04-21": { acts: ["defense-rotation"] } }, games));
  const add = r.changes.filter((c) => c.add.includes("team-defense")).map((c) => c.iso);
  assert.ok(!add.includes("2026-04-14"), "no heavy defense the day before an 11:05 game");
  assert.ok(!r.changes.some((c) => c.iso === "2026-04-21" && c.remove.includes("defense-rotation")), "18:35 is an evening game");
  const r2 = M.planMonth("Avoid heavy defense before morning games", mctx({ "2026-04-14": { acts: ["defense-rotation", "lift"] } }, games));
  deq(r2.changes[0].remove, ["defense-rotation"]); deq(r2.changes[0].acts, ["lift"]);
});
test("month: weekday lists, game days, clear, copy week, rebalance, unknown activities", () => {
  assert.ok(M.planMonth("PFP on Mondays and Thursdays", mctx()).changes.every((c) => [1, 4].includes(dow(c.iso))));
  const g = M.planMonth("Lift on non-game days", mctx({}, { "2026-04-10": { time: "18:35" } }));
  assert.ok(!g.changes.some((c) => c.iso === "2026-04-10")); assert.equal(g.changes.length, 29);
  const c = M.planMonth("Clear Sundays", mctx({ "2026-04-05": { acts: ["lift"] }, "2026-04-06": { acts: ["lift"] } }));
  deq(c.changes.map((x) => x.iso), ["2026-04-05"]);
  const cp = M.planMonth("Copy the second week to the rest of the month", mctx({ "2026-04-07": { acts: ["bunt-defense"] } }));
  assert.ok(cp.changes.some((x) => x.iso === "2026-04-14" && x.add.includes("bunt-defense")));
  assert.ok(cp.changes.some((x) => x.iso === "2026-04-28"));
  const rb = M.planMonth("Rebalance team defense", mctx({ "2026-04-13": { acts: ["team-defense"] }, "2026-04-14": { acts: ["team-defense"] } }));
  assert.ok(rb.changes.some((x) => x.remove.includes("team-defense")) && rb.changes.some((x) => x.add.includes("team-defense")));
  const u = M.planMonth("Yoga every Friday", mctx());
  deq(u.unknown, ["Yoga"]); assert.equal(u.changes.length, 0, "never invents an activity");
  assert.ok(M.planMonth("make it great", mctx()).clarify.length === 1);
});
test("month: high-volume and back-to-back heavy days are flagged", () => {
  const plan = { "2026-04-13": { acts: ["defense-rotation", "team-defense", "cage-work", "lift", "pfp", "bunt-defense"] }, "2026-04-14": { acts: ["team-defense"] }, "2026-04-15": { acts: ["defense-rotation"] } };
  const r = M.planMonth("PFP every Saturday", mctx(plan));
  assert.ok(r.flags.some((f) => /2026-04-13: high volume/.test(f)));
  assert.ok(r.flags.some((f) => /three heavy field days in a row/.test(f)));
});

/* ----------------------------------------------- AI interpretation contract */
test("interpretation contract: valid replies pass, malformed ones are rejected field by field", () => {
  const ok = { intent: "edit", brief: "", edits: [{ op: "shift", target: "Blue's hitting", value: "15", group: "" }], monthRules: [], clarifications: [], assumptions: [] };
  assert.equal(M.validateInterpretation(ok).ok, true);
  const bad = M.validateInterpretation({ intent: "delete-everything", brief: 3, edits: [{ op: "drop table", target: 1 }], monthRules: "x" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes("intent") && bad.errors.includes("brief") && bad.errors.includes("monthRules") && bad.errors.includes("edits[0].op"));
  assert.equal(M.validateInterpretation(null).ok, false);
  assert.equal(M.INTERPRETATION_SCHEMA.additionalProperties, false);
});
test("interpretation contract: AI edits run through the same deterministic parser", () => {
  const edits = [
    { op: "shift", target: "hitting", value: "15", group: "" }, { op: "setDur", target: "Blue defense", value: "20", group: "" },
    { op: "swapGroups", target: "Blue | Orange", value: "", group: "" }, { op: "add", target: "", value: "Bunt Defense @ 10:00 (25) on Field 2", group: "Orange" },
    { op: "indoor", target: "", value: "", group: "" }
  ];
  const cmds = M.editsToCommands(edits);
  const p = M.parseCommands(cmds, ev(), CTX);
  deq(p.ops.map((o) => o.op), ["shift", "setDur", "swapGroups", "add", "indoor"]);
  assert.equal(p.ops[3].dur, 25); assert.equal(p.ops[3].group, "Orange Position Players");
});
