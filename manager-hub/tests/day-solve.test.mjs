// Describe Your Day — solver unit tests (node --test manager-hub/tests/day-solve.test.mjs)
// IR objects are built by hand; the built-in reader is not involved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The sandbox package is "type": "module", so load the UMD files as classic scripts, like the page does.
const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../apps/manager-hub/assistant");
const vmctx = { self: {}, console };
vm.createContext(vmctx);
for (const f of ["day-kb.js", "day-solve.js"]) vm.runInContext(readFileSync(join(DIR, f), "utf8"), vmctx, { filename: f });
const S = vmctx.self.DaySolve, KB = vmctx.self.DayKB;
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/* ---------------------------------------------------------------- helpers */
const act = (id, kind, o = {}) => Object.assign({ id, kind, label: null, who: null, at: null, dur: null, rounds: null,
  order: +id.replace(/\D/g, ""), after: [], before: [], indoor: null, location: null, emphasis: null, text: null }, o);
const req = (o) => Object.assign({ version: 1, source: "reader", dayType: null, level: null, weather: null,
  anchors: { start: null, end: null, firstPitch: null, offBeforeGame: null }, offBefore: [], groups: { hitting: null, pitchers: null },
  activities: [], emphasis: [], parallel: [], base: null, edits: [], notes: [], unknown: [] }, o);
const T = (id) => ({ kind: null, who: null, label: null, id });
const work = (p) => p.items.filter((i) => !["game", "free", "pregamePrep", "arrival"].includes(i.kind));
const of = (p, kind) => p.items.filter((i) => i.kind === kind);
const one = (p, kind) => { const x = of(p, kind); assert.equal(x.length, 1, `exactly one ${kind}`); return x[0]; };
const len = (i) => i.end - i.start;
const clashes = (a, b) => a.track === "all" || b.track === "all" || a.track === b.track;
function assertNoOverlap(p) {
  const it = p.items.filter((i) => i.end > i.start);
  for (let i = 0; i < it.length; i++) for (let j = i + 1; j < it.length; j++) {
    const a = it[i], b = it[j];
    if (!clashes(a, b)) continue;
    if (a.group && b.group && a.group !== b.group && a.track === b.track && a.track !== "all") continue; // parallel groups
    assert.ok(!(a.start < b.end && b.start < a.end), `overlap: ${a.label} ${S.fmt(a.start)}–${S.fmt(a.end)} / ${b.label} ${S.fmt(b.start)}–${S.fmt(b.end)}`);
  }
}
const table = (p) => p.items.map((i) => `${S.fmt(i.start).padStart(5)}–${S.fmt(i.end).padEnd(5)} ${i.track.padEnd(9)} ${i.label}`).join("\n");

/* The IR the reader is expected to produce for:
   "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame." */
const ACCEPT = () => req({
  dayType: "game",
  anchors: { start: 600, end: null, firstPitch: 780, offBeforeGame: 30 },
  activities: [
    act("a1", "stretch", { at: 600, who: "all", label: "Team Stretch", text: "10 AM stretch" }),
    act("a2", "teamDefense", { who: "all", label: "Team Fundamentals", text: "Team fundy" }),
    act("a3", "indDefense", { who: "position", label: "Individual Defense", text: "indy defense" }),
    act("a4", "bp", { who: "position", label: "Batting Practice", rounds: { each: 30, count: null, atOnce: null }, text: "30-minute BP rounds" })
  ]
});
const CTX = { hittingGroups: [], resources: { fields: 1, cages: 1 } };

/* ===================================================== primary acceptance */
test("acceptance: 10 AM stretch, 1 PM game, fundy, indy, 30-min BP rounds, 30 off pregame", () => {
  const ir = ACCEPT();
  assert.ok(S.validate(ir).ok, JSON.stringify(S.validate(ir).errors));
  const p = S.solve(ir, CTX);
  console.log("\n" + table(p) + "\n");
  assert.equal(p.ok, true, JSON.stringify(p.conflicts));
  const st = one(p, "stretch"), tf = one(p, "teamDefense"), id = one(p, "indDefense"), bp = of(p, "bp"), prep = one(p, "pregamePrep");
  const free = one(p, "free"), game = one(p, "game");
  assert.equal(st.start, 600); assert.ok(len(st) >= 10 && len(st) <= 20);
  assert.equal(game.start, 780); assert.equal(game.fixed, true);
  assert.equal(free.start, 750); assert.equal(free.end, 780); assert.equal(free.fixed, true);
  assert.equal(bp.length, 2);
  bp.forEach((b) => assert.equal(len(b), 30));
  assert.deepEqual(J(bp.map((b) => b.label)), ["Batting Practice — Round 1", "Batting Practice — Round 2"]);
  // order: stretch → fundamentals → individual defense → BP 1 → BP 2 → transition → free → game
  const seq = [st, tf, id, bp[0], bp[1], prep, free];
  for (let i = 1; i < seq.length; i++) assert.equal(seq[i].start, seq[i - 1].end, `${seq[i].label} follows ${seq[i - 1].label}`);
  assert.equal(prep.source, "inferred");
  assert.ok(len(prep) >= 10, "transition long enough to be useful");
  work(p).forEach((i) => { assert.ok(i.start >= 600 && i.end <= 750, `${i.label} inside 10:00–12:30`); });
  p.items.forEach((i) => { assert.equal(i.start % 5, 0); assert.equal(i.end % 5, 0); });
  assertNoOverlap(p);
  assert.ok(p.assumptions.some((a) => /2 BP rounds/.test(a.text)), "assumes two rounds");
  assert.ok(p.assumptions.length <= 5);
  assert.equal(p.window.start, 600); assert.equal(p.window.end, 750);
});

/* =============================================================== conflicts */
const OVERFULL = () => req({
  dayType: "game",
  anchors: { start: 600, end: null, firstPitch: 750, offBeforeGame: 30 },
  activities: [act("a1", "stretch"), act("a2", "teamDefense"), act("a3", "indDefense", { who: "position" }),
    act("a4", "bp", { who: "position", rounds: { each: 30, count: 2 } }), act("a5", "cage", { who: "position", dur: 45 })]
});
test("overfull: exact numbers and EditOp alternatives", () => {
  const p = S.solve(OVERFULL(), CTX);
  assert.equal(p.ok, false);
  const c = p.conflicts.find((x) => x.code === "overfull");
  assert.ok(c, "overfull raised");
  assert.equal(c.severity, "error");
  // requested: 15 + 25 + 30 + 2×30 + 45 = 175 min; available 10:00–12:00 = 120 min
  assert.match(c.message, /^Your requested activities need about 2 h 55 min, but only 2 h are available before pregame\. Left out: [^.]+\./);
  const labels = c.alternatives.map((a) => a.label).join(" | ");
  assert.ok(c.alternatives.some((a) => a.ops.some((o) => o.op === "parallel")), labels);
  const earlier = c.alternatives.find((a) => a.ops.some((o) => o.op === "anchor" && o.key === "start"));
  assert.ok(earlier, labels);
  assert.equal(earlier.ops[0].value, 600 - 25); // the minimums need 145 min: 25 over
  c.alternatives.forEach((a) => assert.ok(S.validateEdits(J(a.ops), { strict: true }).ok, JSON.stringify(S.validateEdits(J(a.ops), { strict: true }))));
  // every alternative resolves the conflict
  c.alternatives.forEach((a) => {
    const q = S.solve(S.applyEdits(OVERFULL(), J(a.ops), CTX), CTX);
    assert.ok(!q.conflicts.some((x) => x.code === "overfull"), `${a.label} still overfull`);
  });
});

test("parallel alternative: BP group on the field while the other is in the cage, then swap", () => {
  const ir = S.applyEdits(OVERFULL(), [{ op: "parallel", targets: [T("a4"), T("a5")] }], CTX);
  const p = S.solve(ir, CTX);
  assert.equal(p.ok, true, JSON.stringify(p.conflicts));
  const bp = of(p, "bp"), cage = of(p, "cage");
  assert.equal(bp.length, 2); assert.equal(cage.length, 2);
  assert.equal(cage[0].start, bp[0].start); assert.notEqual(cage[0].group, bp[0].group);
  assert.equal(cage[1].start, bp[1].start); assert.notEqual(cage[1].group, bp[1].group);
  assertNoOverlap(p);
});

test("impossible: start 2 PM, finish by 1 PM", () => {
  const p = S.solve(req({ dayType: "workout", anchors: { start: 840, end: 780, firstPitch: null, offBeforeGame: null }, activities: [act("a1", "stretch"), act("a2", "bp")] }), CTX);
  assert.equal(p.ok, false);
  const c = p.conflicts.find((x) => x.code === "impossible");
  assert.ok(c);
  assert.match(c.message, /2:00 PM.*1:00 PM/);
  assert.ok(c.alternatives.length >= 1);
  assert.ok(p.items.length >= 3, "best-effort items still returned");
});

test("fixed overlap, stated time after the hard stop, before the start", () => {
  const p = S.solve(req({ anchors: { start: 540, end: 720, firstPitch: null, offBeforeGame: null }, activities: [
    act("a1", "meeting", { at: 540, dur: 30 }), act("a2", "stretch", { at: 555 }), act("a3", "bp", { at: 710 }), act("a4", "activation", { at: 520 })] }), CTX);
  const codes = p.conflicts.map((c) => c.code);
  assert.ok(codes.includes("fixedOverlap"), codes.join());
  assert.ok(codes.includes("afterEnd"), codes.join());
  assert.ok(codes.includes("beforeStart"), codes.join());
  assert.equal(p.ok, false);
  const fo = p.conflicts.find((c) => c.code === "fixedOverlap");
  assert.ok(fo.alternatives.some((a) => a.ops[0].op === "at" && a.ops[0].at === 570));
});

test("resource: BP rounds side by side with no cage", () => {
  const ir = req({ anchors: { start: 600, end: 720, firstPitch: null, offBeforeGame: null }, parallel: [["a1"]], activities: [act("a1", "bp", { rounds: { each: 30, count: 2 } })] });
  const p = S.solve(ir, { resources: { fields: 1, cages: 0 } });
  assert.ok(p.conflicts.some((c) => c.code === "resource" && c.severity === "error"));
  const ok = S.solve(ir, { resources: { fields: 1, cages: 1 } });
  assert.ok(!ok.conflicts.some((c) => c.code === "resource"));
  const bp = of(ok, "bp"), cage = of(ok, "cage");
  assert.equal(bp.length, 1); assert.equal(cage.length, 1);
  assert.equal(bp[0].start, cage[0].start, "rounds run together: one on the field, one in the cage");
  assert.equal(cage[0].location, "Cage");
});

/* ============================================================ day shapes */
test("hard stop without a game: no invented activity, leftover is an Open note", () => {
  const p = S.solve(req({ dayType: "workout", anchors: { start: 540, end: 720, firstPitch: null, offBeforeGame: null },
    activities: [act("a1", "stretch"), act("a2", "indDefense"), act("a3", "bp", { rounds: { each: 20, count: 2 } })] }), CTX);
  assert.equal(p.ok, true);
  assert.equal(of(p, "pregamePrep").length, 0);
  assert.equal(of(p, "game").length, 0);
  work(p).forEach((i) => assert.ok(i.start >= 540 && i.end <= 720));
  assert.equal(one(p, "stretch").start, 540);
  assert.ok(p.assumptions.some((a) => /^Open: /.test(a.text)));
  assert.ok(len(one(p, "indDefense")) > 30, "expanded toward max");
  assertNoOverlap(p);
});

test("offBefore: game at 6, early work 2:30, BP 3:30, 45 minutes off before stretch", () => {
  const p = S.solve(req({ dayType: "game", anchors: { start: null, end: null, firstPitch: 1080, offBeforeGame: null }, offBefore: [{ min: 45, before: "a3" }],
    activities: [act("a1", "earlyWork", { at: 870 }), act("a2", "bp", { at: 930 }), act("a3", "stretch")] }), CTX);
  console.log("\n" + table(p) + "\n");
  assert.equal(p.ok, true, JSON.stringify(p.conflicts));
  const st = one(p, "stretch"), free = p.items.find((i) => i.kind === "free" && i.end === st.start);
  assert.ok(free, "a free block ends exactly at stretch");
  assert.equal(len(free), 45);
  assert.equal(one(p, "earlyWork").start, 870);
  const bp = of(p, "bp");
  assert.equal(bp[0].start, 930); assert.equal(bp[0].fixed, true);
  assert.ok(bp[bp.length - 1].end <= free.start, "BP before the off time");
  assert.ok(st.end < 1080, "stretch is done before first pitch");
  assert.equal(one(p, "game").start, 1080);
  assertNoOverlap(p);
});

test("pitchers run beside position work, never during team items", () => {
  const p = S.solve(req({ level: "fcl", anchors: { start: null, end: 720, firstPitch: null, offBeforeGame: null }, activities: [
    act("a1", "stretch", { at: 510 }), act("a2", "cage", { who: "position" }), act("a3", "pitcherWork", { who: "pitchers" }), act("a4", "indDefense", { who: "position", after: ["a2"] })] }), CTX);
  assert.equal(p.ok, true);
  const pw = one(p, "pitcherWork"), st = one(p, "stretch"), cage = one(p, "cage"), d = one(p, "indDefense");
  assert.equal(pw.track, "pitchers");
  assert.ok(pw.start >= st.end, "after team stretch");
  assert.ok(p.items.filter((i) => i.track === "position").some((i) => i.start < pw.end && pw.start < i.end), "runs beside position work");
  p.items.filter((i) => i.track === "all").forEach((i) => assert.ok(!(i.start < pw.end && pw.start < i.end)));
  assert.ok(d.start >= cage.end, "defense after hitting stations");
  assert.ok(!p.assumptions.some((a) => a.key === "pitchers"), "no suggestion when pitchers are mentioned");
  assertNoOverlap(p);
});

test("no pitcher work is invented — one suggestion only", () => {
  const p = S.solve(ACCEPT(), CTX);
  assert.equal(p.items.filter((i) => i.track === "pitchers").length, 0);
  assert.equal(p.assumptions.filter((a) => /pitcher/i.test(a.text)).length, 1);
});

test("lunch fixed at noon splits the day", () => {
  const p = S.solve(req({ dayType: "workout", emphasis: ["defense"], groups: { hitting: 2, pitchers: null },
    anchors: { start: 540, end: 840, firstPitch: null, offBeforeGame: null },
    activities: [act("a1", "stretch"), act("a2", "teamDefense"), act("a3", "indDefense"), act("a4", "bp"), act("a5", "conditioning"), act("a6", "meal", { at: 720, label: "Lunch" })] }), CTX);
  assert.equal(p.ok, true);
  const lunch = one(p, "meal");
  assert.equal(lunch.start, 720); assert.equal(lunch.end, 750); assert.equal(lunch.label, "Lunch");
  work(p).filter((i) => i.kind !== "meal").forEach((i) => assert.ok(i.end <= 720 || i.start >= 750, `${i.label} avoids lunch`));
  assert.ok(work(p).some((i) => i.end <= 720) && work(p).some((i) => i.start >= 750), "work on both sides of lunch");
  assert.equal(of(p, "bp").length, 2, "two hitting groups → two rounds");
  assert.ok(!p.assumptions.some((a) => /BP rounds/.test(a.text)), "stated group count needs no assumption");
  assert.equal(one(p, "stretch").start, 540);
  work(p).forEach((i) => assert.ok(i.end <= 840));
  assertNoOverlap(p);
});

test("ctx: hitting group names label rounds; Activity Library durations override defaults", () => {
  const p = S.solve(req({ anchors: { start: 600, end: null, firstPitch: null, offBeforeGame: null }, activities: [act("a1", "stretch"), act("a2", "bp")] }),
    { hittingGroups: ["Blue", "Orange", "Gray"], durations: { stretch: 20, bp: 25 } });
  const bp = of(p, "bp");
  assert.deepEqual(J(bp.map((b) => b.group)), ["Blue", "Orange", "Gray"]);
  bp.forEach((b) => assert.equal(len(b), 25));
  assert.equal(len(one(p, "stretch")), 20);
});

test("game day without a start: works back from first pitch", () => {
  const p = S.solve(req({ dayType: "game", anchors: { start: null, end: null, firstPitch: 1145, offBeforeGame: 30 }, activities: [act("a1", "stretch"), act("a2", "bp", { rounds: { each: 30, count: 2 } })] }), CTX);
  assert.equal(p.ok, true);
  assert.ok(p.assumptions.some((a) => a.key === "start"));
  assert.equal(one(p, "free").end, 1145);
  assert.ok(of(p, "bp").every((b) => b.end <= 1115));
});

/* ================================================================= edits */
const base = () => S.solve(ACCEPT(), CTX);
const pos = (p) => work(p).map((i) => i.kind + (i.round || ""));

test("edit duration: shorten team fundy to 20 — others keep order and length", () => {
  const ir = S.applyEdits(ACCEPT(), [{ op: "duration", target: { kind: "teamDefense", who: null, label: null, id: null }, set: 20, delta: null }], CTX);
  const p = S.solve(ir, CTX), b = base();
  assert.equal(len(one(p, "teamDefense")), 20);
  assert.equal(len(one(p, "indDefense")), len(one(b, "indDefense")));
  assert.deepEqual(J(of(p, "bp").map(len)), [30, 30]);
  assert.deepEqual(J(pos(p)), J(pos(b)));
  assert.equal(p.ok, true);
});

test("edit duration delta: give pitchers another 15", () => {
  const ir0 = req({ anchors: { start: 600, end: 750, firstPitch: null, offBeforeGame: null }, activities: [act("a1", "stretch"), act("a2", "indDefense"), act("a3", "bp"), act("a4", "pitcherWork", { who: "pitchers" })] });
  const p0 = S.solve(ir0, CTX);
  const ir = S.applyEdits(ir0, [{ op: "duration", target: { kind: null, who: "pitchers", label: null, id: null }, set: null, delta: 15 }], CTX);
  const p = S.solve(ir, CTX);
  assert.equal(len(one(p, "pitcherWork")), len(one(p0, "pitcherWork")) + 15);
});

test("edit move: defense before hitting, and individual before team", () => {
  // "BP, then indy" — the stated sequence arrives as an edge and outranks the KB phase
  const ir0 = req({ anchors: { start: 600, end: 750, firstPitch: null, offBeforeGame: null }, activities: [act("a1", "stretch"), act("a2", "bp", { rounds: { each: 30, count: 2 } }), act("a3", "indDefense", { after: ["a2"] })] });
  const p0 = S.solve(ir0, CTX);
  assert.ok(one(p0, "indDefense").start >= of(p0, "bp")[1].end, "stated sequence kept");
  // without an edge, mention order alone doesn't put hitting before defense
  const p1 = S.solve(Object.assign(J(ir0), { activities: J(ir0.activities).map((a) => Object.assign(a, { after: [] })) }), CTX);
  assert.ok(one(p1, "indDefense").end <= of(p1, "bp")[0].start, "KB phase when no sequence was stated");
  const p = S.solve(S.applyEdits(ir0, [{ op: "move", target: { kind: "defense", who: null, label: null, id: null }, before: { kind: "hitting", who: null, label: null, id: null }, after: null }], CTX), CTX);
  assert.ok(one(p, "indDefense").end <= of(p, "bp")[0].start);
  assert.equal(one(p, "stretch").start, 600, "stretch still first");

  const q = S.solve(S.applyEdits(ACCEPT(), [{ op: "move", target: T("a3"), before: T("a2"), after: null }], CTX), CTX);
  assert.ok(one(q, "indDefense").end <= one(q, "teamDefense").start);
  assert.equal(len(one(q, "indDefense")), 30); assert.equal(len(one(q, "teamDefense")), 25);
  assert.ok(of(q, "bp")[0].start >= one(q, "teamDefense").end, "BP still after defense");
});

test("edit anchor: make everything finish by 12:15 (game time unchanged)", () => {
  const p = S.solve(S.applyEdits(ACCEPT(), [{ op: "anchor", key: "end", value: 735 }], CTX), CTX);
  work(p).forEach((i) => assert.ok(i.end <= 735, `${i.label} ends ${S.fmt(i.end)}`));
  assert.equal(one(p, "game").start, 780);
  assert.equal(p.ok, true);
});

test("edit rounds: a third BP group", () => {
  const p = S.solve(S.applyEdits(ACCEPT(), [{ op: "rounds", target: { kind: "bp", who: null, label: null, id: null }, count: 3, each: null, groups: null }], CTX), CTX);
  assert.deepEqual(J(of(p, "bp").map(len)), [30, 30, 30]);
  assert.equal(p.ok, true);
  assert.ok(p.assumptions.some((a) => a.key === "compressed"), "defense compressed to fit");
});

test("edit parallel: run the BP rounds simultaneously halves the hitting block", () => {
  const p = S.solve(S.applyEdits(ACCEPT(), [{ op: "parallel", targets: [{ kind: "bp", who: null, label: null, id: null }] }], CTX), CTX);
  const bp = of(p, "bp").concat(of(p, "cage"));
  assert.equal(bp.length, 2);
  assert.equal(bp[0].start, bp[1].start);
  assert.equal(Math.max(...bp.map((b) => b.end)) - bp[0].start, 30);
  assert.equal(p.ok, true);
  assertNoOverlap(p);
});

test("edit shift / at / lock / add / remove", () => {
  const b = base();
  const sh = S.solve(S.applyEdits(ACCEPT(), [{ op: "shift", target: { kind: "bp", who: null, label: null, id: null }, delta: -20 }], CTX), CTX);
  assert.equal(of(sh, "bp")[0].start, of(b, "bp")[0].start - 20);
  assert.equal(of(sh, "bp")[0].fixed, true);
  assertNoOverlap(sh);

  const at = S.solve(S.applyEdits(ACCEPT(), [{ op: "at", target: T("a4"), at: 660 }], CTX), CTX);
  assert.equal(of(at, "bp")[0].start, 660);

  const lk = S.applyEdits(ACCEPT(), [{ op: "lock", target: T("a2") }], CTX);
  assert.equal(lk.activities.find((a) => a.id === "a2").at, one(b, "teamDefense").start);

  const add = S.solve(S.applyEdits(ACCEPT(), [{ op: "add", activity: act("x", "baserunning", { order: null }) }], CTX), CTX);
  assert.equal(of(add, "baserunning").length, 1);
  assert.equal(add.ok, true);

  const ir = S.applyEdits(Object.assign(ACCEPT(), { offBefore: [{ min: 10, before: "a3" }] }), [{ op: "remove", target: { kind: "indDefense", who: null, label: null, id: null } }], CTX);
  assert.ok(!ir.activities.some((a) => a.kind === "indDefense"));
  assert.equal(ir.offBefore.length, 0, "references scrubbed");
  assert.ok(S.validate(ir).ok);
  const rm = S.solve(ir, CTX);
  assert.deepEqual(J(pos(rm)), ["stretch", "teamDefense", "bp1", "bp2"]);

  const ind = S.applyEdits(ACCEPT(), [{ op: "indoor", target: "all-hitting" }], CTX);
  assert.equal(ind.activities.find((a) => a.id === "a4").indoor, true);
  assert.ok(of(S.solve(ind, CTX), "bp").every((i) => i.resource === "cage"));
});

test("edits never mutate their input; unresolved targets become a note", () => {
  const ir = ACCEPT(), before = JSON.stringify(ir);
  const out = S.applyEdits(ir, [{ op: "remove", target: { kind: null, who: null, label: "bullpen session", id: null } }], CTX);
  assert.equal(JSON.stringify(ir), before);
  assert.equal(out.activities.length, 4);
  assert.ok(out.notes.some((n) => /couldn't find/.test(n)));
});

/* ======================================================== resolveTarget */
test("resolveTarget: id, kind, area words, label words, who", () => {
  const ir = req({ activities: [act("a1", "stretch"), act("a2", "teamDefense", { label: "Team Fundamentals" }), act("a3", "indDefense", { label: "Individual Defense" }),
    act("a4", "bp"), act("a5", "pitcherWork", { who: "pitchers" }), act("a6", "bullpen", { who: "pitchers" })], anchors: { start: 600, end: null, firstPitch: 780, offBeforeGame: null } });
  assert.deepEqual(J(S.resolveTarget(ir, T("a3"))), ["a3"]);
  assert.deepEqual(J(S.resolveTarget(ir, { kind: "bp" })), ["a4"]);
  assert.deepEqual(J(S.resolveTarget(ir, { kind: "defense" })), ["a2", "a3"]);
  assert.deepEqual(J(S.resolveTarget(ir, { label: "indy defense" })), ["a3"]);
  assert.deepEqual(J(S.resolveTarget(ir, { kind: "defense", label: "team" })), ["a2"]);
  assert.deepEqual(J(S.resolveTarget(ir, { who: "pitchers" })), ["a5", "a6"]);
  assert.deepEqual(J(S.resolveTarget(ir, "all-hitting")), ["a4"]);
  assert.deepEqual(J(S.resolveTarget(ir, { kind: "game" })), ["game"]);
  assert.deepEqual(J(S.resolveTarget(ir, { label: "lift" })), []);
  assert.deepEqual(J(S.resolveTarget(ir, {})), []);
});

/* ============================================================= validate */
test("validate: accepts lenient reader IR, rejects malformed model output", () => {
  assert.ok(S.validate({ version: 1, anchors: {}, activities: [{ id: "a1", kind: "stretch" }] }).ok);
  assert.ok(S.validate(ACCEPT(), { strict: true }).ok, JSON.stringify(S.validate(ACCEPT(), { strict: true }).errors));
  const bad = (ir, re) => { const v = S.validate(ir); assert.equal(v.ok, false); assert.ok(v.errors.some((e) => re.test(e)), v.errors.join("\n")); };
  bad(req({ activities: [act("a1", "warmup")] }), /activities\[0\]\.kind/);
  bad(req({ activities: [act("a1", "stretch", { at: "10:00" })] }), /activities\[0\]\.at: expected integer/);
  bad(req({ activities: [act("a1", "stretch", { at: 1500 })] }), /activities\[0\]\.at/);
  bad(req({ activities: [act("a1", "stretch", { who: "infielders" })] }), /who/);
  bad(req({ activities: [act("a1", "stretch", { colour: "red" })] }), /colour: unknown property/);
  bad(req({ activities: [act("a1", "stretch"), act("a1", "bp")] }), /duplicate id/);
  bad(req({ activities: [act("a1", "stretch", { after: ["zz"] })] }), /unknown activity "zz"/);
  bad(req({ anchors: { start: "9", end: null, firstPitch: null, offBeforeGame: null } }), /anchors\.start/);
  bad(req({ edits: [{ op: "teleport", target: T("a1") }] }), /unknown op "teleport"/);
  bad(req({ dayType: "scrimmage" }), /dayType/);
  bad({ version: 1, anchors: {} }, /activities: required/);
  assert.equal(S.validate(null).ok, false);
  const strict = S.validate({ version: 1, anchors: {}, activities: [{ id: "a1", kind: "stretch" }] }, { strict: true });
  assert.equal(strict.ok, false, "strict mode requires every property");

  assert.ok(S.validateEdits([{ op: "move", target: T("a1"), before: T("a2"), after: null }], { strict: true }).ok);
  assert.equal(S.validateEdits([{ op: "duration", target: T("a1"), set: "20" }]).ok, false);
  assert.equal(S.validateEdits([{ op: "anchor", key: "lunch", value: 720 }]).ok, false);
  assert.equal(S.validateEdits([{ op: "parallel", targets: "bp" }]).ok, false);
});

test("schemas are within the structured-output subset", () => {
  const ALLOWED = new Set(["type", "properties", "required", "enum", "const", "items", "anyOf", "$defs", "$ref", "additionalProperties"]);
  const walk = (s, path) => {
    if (!s || typeof s !== "object") return;
    Object.keys(s).forEach((k) => assert.ok(ALLOWED.has(k), `${path}: keyword ${k}`));
    if (s.type === "object" || (Array.isArray(s.type) && s.type.includes("object"))) {
      assert.equal(s.additionalProperties, false, `${path}: additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path}: every property required`);
    }
    if (s.properties) Object.entries(s.properties).forEach(([k, v]) => walk(v, `${path}.${k}`));
    if (s.items) walk(s.items, `${path}[]`);
    if (s.anyOf) s.anyOf.forEach((v, i) => walk(v, `${path}|${i}`));
    if (s.$defs) Object.entries(s.$defs).forEach(([k, v]) => walk(v, `${path}#${k}`));
  };
  walk(J(S.SCHEMA), "SCHEMA"); walk(J(S.EDIT_SCHEMA), "EDIT"); walk(J(S.BUILD_RESPONSE_SCHEMA), "BUILD"); walk(J(S.REFINE_RESPONSE_SCHEMA), "REFINE");
  assert.deepEqual(J(S.BUILD_RESPONSE_SCHEMA.required), ["request"]);
  assert.deepEqual(J(S.REFINE_RESPONSE_SCHEMA.required), ["ops", "notes"]);
  // no recursive refs: activity / target / rounds never reference editOp
  assert.ok(!JSON.stringify(S.DEFS.activity).includes("editOp"));
});

/* ================================================================ purity */
test("solve never mutates its input", () => {
  const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };
  const ir = deepFreeze(Object.assign(OVERFULL(), { offBefore: [{ min: 10, before: "a2" }], parallel: [["a4"]] }));
  const before = JSON.stringify(ir);
  S.solve(ir, deepFreeze({ hittingGroups: ["Blue"], resources: { fields: 1, cages: 1 }, durations: { bp: 25 } }));
  S.applyEdits(ir, [{ op: "duration", target: T("a2"), set: 20, delta: null }, { op: "move", target: T("a3"), before: T("a2"), after: null }], {});
  assert.equal(JSON.stringify(ir), before);
});

/* ============================================================== helpers */
test("fmt / fmtAP / KB contract", () => {
  assert.equal(S.fmt(600), "10:00"); assert.equal(S.fmt(780), "1:00"); assert.equal(S.fmt(725), "12:05");
  assert.equal(S.fmtAP(780), "1:00 PM"); assert.equal(S.fmtAP(540), "9:00 AM"); assert.equal(S.fmtAP(720), "12:00 PM");
  const ids = ["arrival", "meeting", "meal", "earlyWork", "activation", "stretch", "throwing", "teamDefense", "indDefense", "pfp", "bullpen", "pitcherWork",
    "baserunning", "bp", "cage", "liveBp", "conditioning", "free", "pregamePrep", "game", "postgame", "custom"];
  assert.deepEqual(J(KB.IDS), ids);
  ids.forEach((k) => { const x = KB.kind(k); assert.ok(x.label && x.dur && Number.isFinite(x.phase) && x.who, k); });
  assert.equal(KB.label("stretch"), "Team Stretch");
  assert.equal(KB.label("teamDefense"), "Team Fundamentals");
  assert.equal(KB.label("pregamePrep"), "Transition / Pregame Preparation");
  assert.equal(KB.PREGAME_FREE_LABEL, "Pregame Free Time");
});
