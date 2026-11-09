// Describe Your Day — built-in reader (day-read.js) unit tests.
// Run from the repository root: node --test manager-hub/tests/day-read.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load the browser file the way the page does (a classic script on `self`).
const file = join(dirname(fileURLToPath(import.meta.url)), "../../apps/manager-hub/assistant/day-read.js");
const sandbox = { self: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(file, "utf8"), sandbox, { filename: "day-read.js" });
const R = sandbox.self.DayRead;
// values built inside the VM have their own prototypes: compare by value
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const deq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);

const read = (t, ctx) => J(R.read(t, ctx || {}));
const edit = (t, req, plan, ctx) => J(R.readEdit(t, req, plan || null, ctx || {}));
const acts = (r, kind) => r.activities.filter((a) => a.kind === kind);
const one = (r, kind) => { const l = acts(r, kind); assert.equal(l.length, 1, `exactly one ${kind} in ${JSON.stringify(r.activities.map((a) => a.kind))}`); return l[0]; };
const kinds = (r) => r.activities.map((a) => a.kind);
const KINDS = ["arrival", "meeting", "meal", "earlyWork", "activation", "stretch", "throwing", "teamDefense", "indDefense", "pfp", "bullpen", "pitcherWork",
  "baserunning", "bp", "cage", "liveBp", "conditioning", "free", "pregamePrep", "game", "postgame", "custom"];

function wellFormed(r) {
  assert.equal(r.version, 1);
  assert.equal(r.source, "reader");
  for (const k of ["start", "end", "firstPitch", "offBeforeGame"]) assert.ok(k in r.anchors, k);
  assert.ok(Array.isArray(r.activities) && Array.isArray(r.notes) && Array.isArray(r.unknown) && Array.isArray(r.edits) && Array.isArray(r.offBefore));
  const ids = r.activities.map((a) => a.id);
  r.activities.forEach((a, i) => {
    assert.ok(KINDS.includes(a.kind), a.kind);
    assert.ok(["all", "position", "pitchers", "catchers"].includes(a.who), a.who);
    assert.equal(a.order, i + 1);
    for (const x of a.after.concat(a.before)) assert.ok(x === "game" || ids.includes(x), `edge ${x}`);
  });
  for (const o of r.offBefore) assert.ok(o.before === "game" || ids.includes(o.before));
}

/* ================================================================ helpers */
test("parseClock: practice and game rules, explicit meridiem wins", () => {
  assert.equal(R.parseClock("10 AM"), 600);
  assert.equal(R.parseClock("10"), 600);
  assert.equal(R.parseClock("1 PM"), 780);
  assert.equal(R.parseClock("1"), 780, "bare 1–5 is afternoon for practice");
  assert.equal(R.parseClock("2:30"), 870);
  assert.equal(R.parseClock("noon"), 720);
  assert.equal(R.parseClock("12:15"), 735);
  assert.equal(R.parseClock("6:05"), 365, "practice: 6 is morning");
  assert.equal(R.parseClock("6:05", "game"), 1085, "game: 6 is evening");
  assert.equal(R.parseClock("7", "game"), 1140);
  assert.equal(R.parseClock("12", "game"), 720);
  assert.equal(R.parseClock("11", "game"), 660, "an 11 o'clock game is morning");
  assert.equal(R.parseClock("6 am", "game"), 360, "explicit am wins");
  assert.equal(R.parseClock("330"), 930);
  assert.equal(R.parseClock("ten am"), 600);
  assert.equal(R.parseClock("18:30"), 1110);
  assert.equal(R.parseClock("30 minutes"), null);
  assert.equal(R.parseClock("25:00"), null);
});

test("parseDuration: durations only, never clock times", () => {
  assert.equal(R.parseDuration("30-minute"), 30);
  assert.equal(R.parseDuration("30 min"), 30);
  assert.equal(R.parseDuration("45 minutes"), 45);
  assert.equal(R.parseDuration("an hour"), 60);
  assert.equal(R.parseDuration("hour and a half"), 90);
  assert.equal(R.parseDuration("1.5 hours"), 90);
  assert.equal(R.parseDuration("for 90"), 90);
  assert.equal(R.parseDuration("30 off"), 30);
  assert.equal(R.parseDuration("thirty minutes"), 30);
  assert.equal(R.parseDuration("10:30"), null);
  assert.equal(R.parseDuration("at 10"), null);
});

test("lexicon is exported with kinds from the shared contract", () => {
  const lx = J(R.lexicon);
  assert.ok(lx.length > 30);
  for (const e of lx) for (const k of e.kind.split("+")) assert.ok(KINDS.includes(k), k);
  assert.ok(lx.some((e) => e.examples.includes("team fundy")));
  assert.ok(lx.some((e) => e.examples.includes("indy D")));
  assert.ok(!JSON.stringify(lx).match(/\bAI\b/), "never called AI");
  assert.equal(R.LABEL, "Built-in reader");
});

/* ============================================================ acceptance */
test("ACCEPTANCE: 10 AM stretch, 1 PM game, team fundy, indy defense, 30-minute BP rounds, 30 off pregame", () => {
  const r = read("10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame.");
  wellFormed(r);
  assert.equal(r.dayType, "game");
  deq(r.anchors, { start: 600, end: null, firstPitch: 780, offBeforeGame: 30 });
  assert.equal(one(r, "stretch").at, 600);
  assert.equal(one(r, "teamDefense").at, null);
  assert.equal(one(r, "indDefense").who, "position");
  assert.equal(one(r, "bp").rounds.each, 30);
  deq(kinds(r), ["stretch", "teamDefense", "indDefense", "bp"]);
  deq(r.unknown, []);
  assert.equal(acts(r, "pregamePrep").length, 0, "“off pregame” is the buffer, not an activity");
});

/* ======================================================= §1 audit table */
test("audit 2: game at 6, early work 2:30, BP 3:30, 45 off before stretch (no duration read as a clock)", () => {
  const r = read("Game at 6. Early work at 2:30, BP at 3:30, 45 minutes off before stretch.");
  wellFormed(r);
  assert.equal(r.dayType, "game");
  assert.equal(r.anchors.firstPitch, 1080);
  assert.equal(one(r, "earlyWork").at, 870);
  assert.equal(one(r, "bp").at, 930);
  const s = one(r, "stretch");
  assert.equal(s.at, null, "45 is never a clock time");
  deq(r.offBefore, [{ min: 45, before: s.id }]);
  deq(r.unknown, []);
});

test("audit 3: no game, start 9, defense-heavy, two hitting groups, lunch at noon, finish by 2", () => {
  const r = read("No game tomorrow. Start at 9, defense-heavy day, two hitting groups, lunch at noon, finish by 2.");
  wellFormed(r);
  assert.equal(r.dayType, "workout");
  assert.equal(r.anchors.start, 540);
  assert.equal(r.anchors.end, 840);
  assert.equal(r.groups.hitting, 2);
  deq(r.emphasis, ["defense"]);
  assert.equal(one(r, "meal").at, 720);
  assert.equal(one(r, "bp").rounds.count, 2);
  assert.ok(acts(r, "teamDefense").length === 1 && one(r, "teamDefense").emphasis === "heavy", "defense present and weighted");
  deq(r.unknown, []);
});

test("audit 4: FCL day, stretch 8:30, hitting stations, pitchers throw, defense after, done by noon", () => {
  const r = read("FCL day. Stretch at 8:30, hitting stations, pitchers throw, defense after, done by noon.");
  wellFormed(r);
  assert.equal(r.level, "fcl");
  assert.equal(r.anchors.start, 510);
  assert.equal(r.anchors.end, 720);
  assert.equal(one(r, "stretch").at, 510);
  const cage = one(r, "cage"); assert.equal(cage.who, "position");
  assert.equal(one(r, "pitcherWork").who, "pitchers");
  const d = one(r, "teamDefense");
  deq(d.after, [cage.id], "defense after the hitting stations, not after the pitchers' track");
  assert.ok(r.notes.some((n) => /defense/i.test(n)), "plain defense is noted");
  deq(r.unknown, []);
});

/* ======================================================== dictation / typos */
test("dictation without punctuation reads like the typed acceptance prompt", () => {
  const r = read("ten am stretch one pm game team fundy indy d thirty minute bp rounds thirty off");
  wellFormed(r);
  assert.equal(r.dayType, "game");
  deq(r.anchors, { start: 600, end: null, firstPitch: 780, offBeforeGame: 30 });
  deq(kinds(r), ["stretch", "teamDefense", "indDefense", "bp"]);
  assert.equal(one(r, "bp").rounds.each, 30);
  deq(r.unknown, []);
});

test("typos: fundys, indys, pfps, bp at 330, strech, defence", () => {
  const r = read("strech at 9, fundys, indys, pfps, defence, bp at 330");
  wellFormed(r);
  assert.equal(one(r, "stretch").at, 540);
  one(r, "teamDefense"); one(r, "indDefense"); one(r, "pfp");
  assert.equal(one(r, "bp").at, 930);
  deq(r.unknown, []);
});

test("dictated times: eight thirty stretch, quarter past nine meeting", () => {
  const r = read("eight thirty stretch then quarter past nine meeting");
  assert.equal(one(r, "stretch").at, 510);
  assert.equal(one(r, "meeting").at, 555);
});

test("b.p. and B P are BP", () => {
  assert.equal(one(read("B.P. at 4"), "bp").at, 960);
  assert.equal(one(read("b p at 4"), "bp").at, 960);
});

/* ==================================================== clock vs duration */
test("30-minute / 30 min / 45 minutes are durations", () => {
  const r = read("30 min stretch, cage for 45 minutes, 20-minute PFP");
  assert.equal(one(r, "stretch").dur, 30);
  assert.equal(one(r, "cage").dur, 45);
  assert.equal(one(r, "pfp").dur, 20);
  for (const a of r.activities) assert.equal(a.at, null);
  assert.equal(r.anchors.start, null);
});

test("an hour / hour and a half / for 90 are durations", () => {
  const r = read("Hour and a half of BP, an hour of defense, live BP for 90, first pitch 7");
  assert.equal(one(r, "bp").dur, 90);
  assert.equal(one(r, "teamDefense").dur, 60);
  assert.equal(one(r, "liveBp").dur, 90);
  assert.equal(r.anchors.firstPitch, 1140);
});

test("first pitch 6:05 is evening; game at 12:05 is noon; game at 11 is morning", () => {
  assert.equal(read("first pitch 6:05").anchors.firstPitch, 1085);
  assert.equal(read("game at 12:05").anchors.firstPitch, 725);
  assert.equal(read("game at 11").anchors.firstPitch, 660);
  assert.equal(read("1 pm game").anchors.firstPitch, 780);
  assert.equal(read("game at 7 pm").anchors.firstPitch, 1140);
});

test("practice hours: bare 6–11 morning, 12 noon, 1–5 afternoon", () => {
  assert.equal(one(read("stretch at 8"), "stretch").at, 480);
  assert.equal(one(read("lunch at 12"), "meal").at, 720);
  assert.equal(one(read("bp at 3"), "bp").at, 900);
  assert.equal(one(read("conditioning at 7 pm"), "conditioning").at, 1140);
});

test("contextual consistency: a morning reading earlier than an evening game's prep becomes afternoon", () => {
  const r = read("game at 7. stretch at 4, cage at 6");
  assert.equal(one(r, "stretch").at, 960);
  assert.equal(one(r, "cage").at, 1080);
  assert.ok(r.notes.some((n) => /afternoon/.test(n)));
});

test("finish by 2 is 2 PM; finish by 11:30 stays morning after a 10 AM start", () => {
  assert.equal(read("start at 9, finish by 2").anchors.end, 840);
  const r = read("Off day. Stretch at 10, defense before hitting, finish by 11:30");
  assert.equal(r.anchors.start, 600);
  assert.equal(r.anchors.end, 690);
});

test("hard stop at 1 / done by noon / wrap up by 12:15", () => {
  assert.equal(read("hard stop at 1").anchors.end, 780);
  assert.equal(read("done by noon").anchors.end, 720);
  assert.equal(read("wrap up by 12:15").anchors.end, 735);
});

test("report at 1 sets the start and a report item", () => {
  const r = read("Report at 1, first pitch 6:05, BP at 330, 30 off before the game");
  wellFormed(r);
  assert.equal(r.anchors.start, 780);
  assert.equal(one(r, "arrival").at, 780);
  assert.equal(r.anchors.firstPitch, 1085);
  assert.equal(r.anchors.offBeforeGame, 30);
  assert.equal(one(r, "bp").at, 930);
  deq(r.unknown, []);
});

test("bare stated time after an activity: 'Stretch 9.'", () => {
  const r = read("Workout day. Stretch 9. Long toss");
  assert.equal(one(r, "stretch").at, 540);
  assert.equal(r.anchors.start, 540);
  deq(r.unknown, []);
});

/* ============================================================== buffers */
test("off-before-game phrasings", () => {
  assert.equal(read("game at 7, 30 minutes off pregame").anchors.offBeforeGame, 30);
  assert.equal(read("game at 7, 30 off before the game").anchors.offBeforeGame, 30);
  assert.equal(read("game at 7, 30 min free before first pitch").anchors.offBeforeGame, 30);
  assert.equal(read("game at 7, 45 minutes of down time before the game").anchors.offBeforeGame, 45);
});

test("45 minutes off before stretch → offBefore, not a clock", () => {
  const r = read("BP at 2, 45 minutes off before stretch, game at 7");
  deq(r.offBefore, [{ min: 45, before: one(r, "stretch").id }]);
  assert.equal(r.anchors.offBeforeGame, null);
});

test("30 off on a workout day is free time", () => {
  const r = read("No game. Stretch at 9, BP, 30 off, conditioning");
  assert.equal(r.dayType, "workout");
  assert.equal(one(r, "free").dur, 30);
  assert.equal(r.anchors.offBeforeGame, null);
});

test("spread at 11 and a 1 PM game", () => {
  const r = read("spread at 11, 30 min free before first pitch, game at 1");
  assert.equal(one(r, "meal").at, 660);
  assert.equal(one(r, "meal").label, "Spread");
  assert.equal(r.anchors.firstPitch, 780);
  assert.equal(r.anchors.offBeforeGame, 30);
});

/* ============================================================ rounds / groups */
test("3 BP groups and 30-minute BP rounds", () => {
  const r = read("3 BP groups, 30-minute BP rounds");
  const bp = one(r, "bp");
  deq(bp.rounds, { each: 30, count: 3 });
  assert.equal(r.groups.hitting, 3);
});

test("two hitting groups with cage only → cage rounds count 2", () => {
  const r = read("two hitting groups, cage at 10");
  assert.equal(one(r, "cage").rounds.count, 2);
  assert.equal(acts(r, "bp").length, 0);
});

test("BP rounds of 20 and 'rounds of 25' alone", () => {
  assert.equal(one(read("BP rounds of 20"), "bp").rounds.each, 20);
  assert.equal(one(read("make a schedule with rounds of 25"), "bp").rounds.each, 25);
});

test("hitting day: rounds bind to BP, not live BP; then-edge", () => {
  const r = read("Hitting day. BP 30-minute rounds, cage, live BP, then lift");
  deq(r.emphasis, ["hitting"]);
  assert.equal(one(r, "bp").rounds.each, 30);
  assert.equal(one(r, "liveBp").rounds, null);
  deq(one(r, "conditioning").after, [one(r, "liveBp").id]);
  assert.equal(one(r, "conditioning").label, "Lift");
});

/* ============================================================== sequencing */
test("then-chain builds after edges", () => {
  const r = read("start at 9 finish by 1 stretch then team d then indy then bp");
  wellFormed(r);
  deq(r.anchors, { start: 540, end: 780, firstPitch: null, offBeforeGame: null });
  const [s, t, i, b] = ["stretch", "teamDefense", "indDefense", "bp"].map((k) => one(r, k));
  deq(t.after, [s.id]); deq(i.after, [t.id]); deq(b.after, [i.id]);
  deq(r.unknown, []);
});

test("defense before hitting → before edge; plain words noted", () => {
  const r = read("Off day. Stretch at 10, defense before hitting, finish by 11:30");
  const d = one(r, "teamDefense"), b = one(r, "bp");
  deq(d.before, [b.id]);
  assert.ok(r.notes.some((n) => /Hitting/.test(n)) && r.notes.some((n) => /Defense/.test(n)));
});

test("followed by / after X", () => {
  const r = read("Stretch followed by PFP. Bullpens after stretch.");
  const s = one(r, "stretch");
  deq(one(r, "pfp").after, [s.id]);
  deq(one(r, "bullpen").after, [s.id]);
});

test("'after BP, conditioning' and 'lift after the game'", () => {
  const r = read("BP at 3. After BP, conditioning. Game at 7, postgame lift");
  deq(one(r, "conditioning").after, [one(r, "bp").id]);
  one(r, "postgame");
  const r2 = read("game at 1, lift after the game");
  deq(one(r2, "conditioning").after, ["game"]);
});

/* ================================================= vocabulary coverage */
test("shorthand vocabulary maps to the right kinds", () => {
  const r = read("meeting at 9:30, dynamic, stretch, catch play, long toss, early work, tee/flips, machine, cuts and relays, rundowns, bunt plays, PFPs, pens, speed work, conditioning, lift");
  wellFormed(r);
  const k = kinds(r);
  for (const x of ["meeting", "activation", "stretch", "throwing", "earlyWork", "cage", "teamDefense", "pfp", "bullpen", "baserunning", "conditioning"]) assert.ok(k.includes(x), x);
  assert.equal(acts(r, "teamDefense").length, 3, "cuts & relays, rundowns and bunt plays stay separate");
  assert.equal(one(r, "meeting").at, 570);
  deq(r.unknown, []);
});

test("pitchers throw / catchers' work / indy D", () => {
  const r = read("pitchers throw, catchers' work, indy D");
  assert.equal(one(r, "pitcherWork").who, "pitchers");
  assert.equal(acts(r, "indDefense").find((a) => a.label === "Catchers' Work").who, "catchers");
  assert.equal(acts(r, "indDefense").find((a) => a.label === "Individual Defense").who, "position");
});

test("pitchers' long toss is pitcher work", () => {
  const r = read("pitchers long toss, position players stretch");
  const p = one(r, "pitcherWork");
  assert.equal(p.who, "pitchers");
  assert.equal(one(r, "stretch").who, "position");
});

test("stretch and throw → stretch then throwing", () => {
  const r = read("stretch and throw at 3");
  const s = one(r, "stretch"), t = one(r, "throwing");
  deq(t.after, [s.id]);
});

test("hitting stations is cage work for position players", () => {
  const c = one(read("hitting stations"), "cage");
  assert.equal(c.who, "position");
  assert.equal(c.label, "Hitting Stations");
});

test("bare 'stations' and repeated BP mentions merge sensibly", () => {
  const r = read("BP, stations, BP at 4");
  assert.equal(one(r, "bp").at, 960);
  one(r, "indDefense");
});

/* =============================================================== day-level */
test("FCL / complex day and full-season", () => {
  assert.equal(read("complex day, stretch at 8").level, "fcl");
  assert.equal(read("full-season schedule, game at 7").level, "full-season");
});

test("game day without a time uses ctx.game", () => {
  const r = read("game day. Stretch at 3, BP, 30 off pregame", { game: { firstPitch: 1085, opponent: null } });
  assert.equal(r.dayType, "game");
  assert.equal(r.anchors.firstPitch, 1085);
  assert.ok(r.notes.some((n) => /Games list/.test(n)));
  const r2 = read("game day, BP after stretch");
  assert.equal(r2.anchors.firstPitch, null);
  assert.ok(r2.notes.some((n) => /not stated/.test(n)));
});

test("off day / workout day → workout, no game anchors", () => {
  for (const t of ["off day, stretch at 10", "workout day, stretch at 10", "no game, stretch at 10"]) {
    const r = read(t);
    assert.equal(r.dayType, "workout", t);
    assert.equal(r.anchors.firstPitch, null);
  }
});

test("light day sets light emphasis", () => {
  const r = read("Light day, catchers' work, pitchers throw, rundowns, team stretch at 9");
  assert.ok(r.activities.every((a) => a.emphasis === "light"));
  assert.equal(one(r, "stretch").at, 540);
});

test("rain without a current draft: weather, indoor hitting, pitcher work, shortened defense", () => {
  const r = read("Rain expected. Move hitting indoors, keep pitchers on throwing schedules, shorten defensive work.");
  wellFormed(r);
  assert.equal(r.weather, "rain");
  assert.equal(r.base, null);
  assert.ok(r.activities.filter((a) => ["bp", "cage"].includes(a.kind)).every((a) => a.indoor === true));
  assert.equal(one(r, "pitcherWork").who, "pitchers");
  assert.equal(one(r, "teamDefense").emphasis, "light");
  deq(r.unknown, []);
});

test("rain with a current draft: edits on base current", () => {
  const current = read("Stretch at 10, team fundy, indy, BP, pitchers throw");
  const r = read("Rain expected. Move hitting indoors, keep pitchers on throwing schedules, shorten defensive work.", { current });
  assert.equal(r.weather, "rain");
  deq(r.base, { ref: "current" });
  assert.ok(r.edits.some((o) => o.op === "indoor" && o.target === "all-hitting"));
  assert.ok(r.edits.some((o) => o.op === "lock" && o.target.who === "pitchers"));
  const dur = r.edits.filter((o) => o.op === "duration");
  deq(dur.map((o) => o.target.kind).sort(), ["indDefense", "teamDefense"]);
  assert.ok(dur.every((o) => o.delta < 0));
  deq(r.activities, []);
});

test("same as yesterday but move BP 20 minutes earlier and add baserunning", () => {
  const r = read("same as yesterday but move BP 20 minutes earlier and add baserunning");
  deq(r.base, { ref: "yesterday" });
  deq(r.edits[0], { op: "shift", target: { kind: "bp" }, delta: -20 });
  assert.equal(r.edits[1].op, "add");
  assert.equal(r.edits[1].activity.kind, "baserunning");
  deq(r.activities, []);
  deq(r.unknown, []);
});

test("indoor / location / emphasis on single items", () => {
  const r = read("cage inside, BP on field 2, extra PFP, quick stretch");
  assert.equal(one(r, "cage").indoor, true);
  assert.equal(one(r, "bp").location, "Field 2");
  assert.equal(one(r, "pfp").emphasis, "heavy");
  assert.equal(one(r, "stretch").emphasis, "light");
});

test("elliptical group times: 'pitchers stretch at 9:30, position players at 10'", () => {
  const r = read("Pitchers stretch at 9:30, position players at 10, PFP then pens, team fundy 30 minutes");
  const s = acts(r, "stretch");
  deq(s.map((a) => [a.who, a.at]), [["pitchers", 570], ["position", 600]]);
  assert.equal(one(r, "pfp").at, null, "a time never crosses a comma to the next item");
  deq(one(r, "bullpen").after, [one(r, "pfp").id]);
  assert.equal(one(r, "teamDefense").dur, 30);
  deq(r.unknown, []);
});

test("'stretch 15' is a length; '3 rounds of BP at 20 minutes each'", () => {
  const r = read("Let's do activation 10 min, stretch 15, throw, then 3 rounds of BP at 20 minutes each, finish by 1");
  assert.equal(one(r, "activation").dur, 10);
  assert.equal(one(r, "stretch").dur, 15);
  deq(one(r, "bp").rounds, { each: 20, count: 3 });
  assert.equal(r.anchors.end, 780);
  deq(r.unknown, []);
});

test("ranges: practice from 9 to 12, BP from 10:30 to 11:15", () => {
  const r = read("practice from 9 to 12, BP from 10:30 to 11:15");
  assert.equal(r.anchors.start, 540);
  assert.equal(r.anchors.end, 720);
  const bp = one(r, "bp");
  assert.equal(bp.at, 630);
  assert.equal(bp.dur, 45);
});

test("'No BP.' removes BP and says so; getaway day with a bus after the game", () => {
  const r = read("Getaway day, game 12:05 then bus. No BP. Stretch 10:30, throw, indy, 30 off");
  assert.equal(acts(r, "bp").length, 0);
  assert.ok(r.notes.some((n) => /No BP/.test(n)));
  assert.equal(r.anchors.firstPitch, 725);
  assert.equal(one(r, "stretch").at, 630);
  deq(one(r, "custom").after, ["game"]);
  deq(r.unknown, []);
});

test("shorthand: gm, LT, grps, 20s, CR", () => {
  const r = read("stretch 3:30, LT pitchers 3:45, bp 3 grps 20s, gm 7, 30 off");
  assert.equal(r.anchors.firstPitch, 1140);
  const lt = one(r, "pitcherWork"); assert.equal(lt.at, 945);
  deq(one(r, "bp").rounds, { each: 20, count: 3 });
  const c = read("cr and bunt d after stretch at 3, bp, gm 6:05 30 off");
  assert.ok(acts(c, "teamDefense").some((a) => a.label === "Cuts & Relays"));
  assert.ok(c.notes.some((n) => /CR/.test(n)));
  assert.equal(c.anchors.firstPitch, 1085);
  assert.equal(c.anchors.offBeforeGame, 30);
});

test("leading bare hours and ranges: '9 stretch', 'done 11:30', '10 to 12', 'stretch 9 bp 10 done 11'", () => {
  const a = read("FCL. 7:45 report, 8 meeting, 8:15 stretch, pens, indy, BP 3 groups, done 11:30");
  assert.equal(one(a, "meeting").at, 480);
  assert.equal(one(a, "stretch").at, 495);
  assert.equal(a.anchors.end, 690);
  const b = read("Off day workout. 10 to 12. stretch, throw, cage work, done");
  deq([b.anchors.start, b.anchors.end], [600, 720]);
  deq(b.unknown, []);
  const c = read("stretch 9 bp 10 done 11");
  deq([one(c, "stretch").at, one(c, "bp").at, c.anchors.end], [540, 600, 660]);
});

test("slash lists are an ordered sequence per track", () => {
  const r = read("stretch 9 / indy / cage / pfp + pens / lift / done by 12");
  const id = (k) => one(r, k).id;
  assert.equal(one(r, "stretch").at, 540);
  deq(one(r, "indDefense").after, [id("stretch")]);
  deq(one(r, "cage").after, [id("indDefense")]);
  deq(one(r, "conditioning").after.slice().sort(), [id("cage"), id("bullpen")].sort(), "lift (whole team) follows both tracks");
  assert.equal(r.anchors.end, 720);
  deq(r.unknown, []);
});

test("group names from ctx, 'at the same time' and field/cage swap become parallel", () => {
  const r = read("Stretch 3. BP Blue and Orange groups 25 min each, game at 6:35, 30 off", { hittingGroups: ["Blue", "Orange"] });
  deq(one(r, "bp").rounds, { each: 25, count: 2 });
  assert.equal(r.groups.hitting, 2);
  const s = read("Stretch at 3. All 3 BP groups hit at the same time at 3:30. Game at 7, 30 off.", { hittingGroups: ["Blue", "Orange", "Gray"] });
  const bp = one(s, "bp");
  assert.equal(bp.at, 930);
  deq(s.parallel, [[bp.id]]);
  const w = read("Blue and Orange hit on the field while Gray and Red are in the cage, then swap. 20 minute rounds. Stretch at 3, game 6:30, 30 off.", { hittingGroups: ["Blue", "Orange", "Gray", "Red"] });
  deq(w.parallel, [[one(w, "bp").id, one(w, "cage").id]]);
  assert.equal(one(w, "bp").rounds.each, 20);
  deq(w.unknown, []);
});

test("who carries across 'and': pitchers stretch at 3:30 and throw", () => {
  const r = read("Night game 7:05. Pitchers stretch at 3:30 and throw, position players stretch at 4, BP 4:30, 30 off before first pitch.");
  assert.equal(one(r, "pitcherWork").who, "pitchers");
  deq(acts(r, "stretch").map((a) => [a.who, a.at]), [["pitchers", 930], ["position", 960]]);
  deq(r.unknown, []);
});

test("'Stretch at 10. 30 off' is not 10:30; 'between 9 and 11' is the day's window", () => {
  const r = read("Game's at 1. Stretch at 10. 30 off before the game.");
  assert.equal(one(r, "stretch").at, 600);
  assert.equal(r.anchors.offBeforeGame, 30);
  const w = read("2 hour defensive session and 2 hours of BP between 9 and 11");
  deq([w.anchors.start, w.anchors.end], [540, 660]);
  assert.equal(one(w, "bp").at, null);
  assert.equal(one(w, "teamDefense").dur, 120);
});

test("edit: make it 3 rounds of BP", () => deq(edit("Make it 3 rounds of BP.", BASE), [{ op: "rounds", target: { kind: "bp" }, count: 3 }]));

/* ================================================ generalisation classes */
test("class 1: a time attaches through verbs and filler within its clause", () => {
  const cases = [
    ["bp starts 4:30", "bp", 990], ["BP begins at 4:30", "bp", 990], ["stretch is at 9", "stretch", 540],
    ["we'll do defense around 10", "teamDefense", 600], ["scrimmage vs the cubs at 1", "custom", 780],
    ["cage work should kick off at 2:15", "cage", 855], ["the meeting is going to be 9:30", "meeting", 570],
    ["PFP for the pitchers happens at 3:10", "pfp", 910]
  ];
  for (const [t, k, at] of cases) { const r = read(t); assert.equal(one(r, k).at, at, t); assert.ok(!r.unknown.some((u) => /\d/.test(u)), `${t}: ${r.unknown}`); }
  const r = read("stretch at 3, BP, game at 7");
  assert.equal(one(r, "bp").at, null, "a clause with no time leaves the item flexible");
});

test("class 2: hard stops without 'by' set anchors.end", () => {
  const cases = [["off by 6:30", 1110], ["done 11:15", 675], ["wrap 12", 720], ["out of there by 1", 780], ["off the field at noon", 720],
    ["need to be done 11:30", 690], ["gotta be finished at 12:45", 765], ["clear the field by 2", 840], ["stretch at 9, we leave at 11:30", 690]];
  for (const [t, end] of cases) { const r = read(t); assert.equal(r.anchors.end, end, t); deq(r.unknown, [], t); }
});

test("class 3: counts and round lengths in odd positions", () => {
  const cases = [
    ["BP x3 groups", { count: 3 }], ["bp, 3 groups", { count: 3 }], ["3 bp groups", { count: 3 }], ["BP x2", { count: 2 }],
    ["BP 4 rounds 15 each", { count: 4, each: 15 }], ["two rounds of 20", { count: 2, each: 20 }], ["bp: 3 rounds, 25 apiece", { count: 3, each: 25 }]
  ];
  for (const [t, want] of cases) {
    const r = read(t), b = one(r, "bp");
    for (const [k, v] of Object.entries(want)) assert.equal(b.rounds[k], v, `${t} ${k}`);
    deq(r.unknown, [], t);
  }
  const c = read("cage 2 groups 30 each");
  deq(one(c, "cage").rounds, { each: 30, count: 2 });
  deq(c.unknown, []);
});

test("class 4: adjacent words describing one thing make one activity", () => {
  const a = read("8:20 defense stations 40 min");
  deq(kinds(a), ["indDefense"]);
  deq([a.activities[0].at, a.activities[0].dur, a.activities[0].label], [500, 40, "Defensive Stations"]);
  for (const t of ["defensive stations at 8:20 for 40", "8:20 stations defense, 40 minutes"]) {
    const r = read(t); deq(kinds(r), ["indDefense"], t); assert.equal(r.activities[0].at, 500, t); assert.equal(r.activities[0].dur, 40, t);
  }
  const h = read("hitting cage at 2");
  deq(kinds(h), ["cage"]); assert.equal(h.activities[0].at, 840);
  const d = read("defense indy 30 min");
  deq(kinds(d), ["indDefense"]);
});

test("class 5: vague pitcher phrases are pitchers' work", () => {
  for (const t of ["pitchers do their thing", "pitchers on their program", "arms get their work in", "pitchers handle their stuff",
    "the pitching staff will go through their routine", "pitchers take care of their throwing"]) {
    const r = read(t);
    assert.equal(one(r, "pitcherWork").who, "pitchers", t);
    deq(r.unknown, [], t);
  }
});

test("class 6: size words weight one activity", () => {
  const cases = [["short bp", "bp", "light"], ["quick fundy", "teamDefense", "light"], ["light defense", "teamDefense", "light"], ["mini cage session", "cage", "light"],
    ["extra cage", "cage", "heavy"], ["long bp", "bp", "heavy"], ["a lot of PFP", "pfp", "heavy"], ["indy, keep it short", "indDefense", null]];
  for (const [t, k, e] of cases.slice(0, 7)) { const r = read(t); assert.equal(one(r, k).emphasis, e, t); }
  const r = read("BP short today, stretch long");
  assert.equal(one(r, "bp").emphasis, "light");
  assert.equal(one(r, "stretch").emphasis, "heavy");
});

test("class 7: global indoor marks every outdoor activity", () => {
  for (const t of ["everything indoors. stretch, bp, fundy", "all inside today: stretch, bp, fundy", "Indoor day — stretch, bp, fundy", "we're inside, stretch then bp then fundy"]) {
    const r = read(t);
    assert.ok(r.activities.length === 3 && r.activities.every((a) => a.indoor === true), t);
    deq(r.unknown, [], t);
  }
  assert.equal(one(read("everything indoors, lunch at noon, bp"), "meal").indoor, null, "a meal isn't an outdoor item");
});

test("class 8: readEdit rounds deltas, at and swap", () => {
  const req = read("Stretch at 10, team fundy, 3 BP groups, game at 1");
  const R3 = (t) => edit(t, req)[0];
  for (const t of ["give BP another round", "one more BP round", "add a round", "add another bp round"]) deq(R3(t), { op: "rounds", target: { kind: "bp" }, count: 4 }, t);
  for (const t of ["cut a round of BP", "drop a round", "one less BP round", "take a round off bp"]) deq(R3(t), { op: "rounds", target: { kind: "bp" }, count: 2 }, t);
  deq(R3("make it 3 groups"), { op: "rounds", target: { kind: "bp" }, count: 3, groups: 3 });
  deq(R3("add 2 more rounds"), { op: "rounds", target: { kind: "bp" }, count: 5 });
  const noCount = edit("give BP another round", read("BP, stretch"), null, {});
  deq(noCount, [{ op: "rounds", target: { kind: "bp" }, count: 3 }], "no count known → assumes 2 (noted)");
  for (const t of ["move bp to 11", "start bp at 11", "bp at 11 instead", "put BP at 11"]) deq(R3(t), { op: "at", target: { kind: "bp" }, at: 660 }, t);
  for (const t of ["swap BP and defense", "switch fundy with bp", "flip bp and team fundy"]) {
    const ops = edit(t, req);
    assert.equal(ops.length, 2, t);
    assert.ok(ops.every((o) => o.op === "move"), t);
    const bpOp = ops.find((o) => o.target.kind === "bp");
    deq(bpOp.before, { kind: "teamDefense" }, `${t}: BP (now after fundy) moves before it`);
  }
});

test("fresh wordings across classes: groups of 20, lunch spread, goes from, for the starters", () => {
  deq(one(read("then BP for the hitters, 3 groups of 20"), "bp").rounds, { each: 20, count: 3 });
  const g = read("4 groups of 5 hitters for BP");
  assert.equal(one(g, "bp").rounds.count, 4, "groups of 5 hitters are people, not minutes");
  const l = read("lunch spread 11:15");
  deq(kinds(l), ["meal"]); assert.equal(l.activities[0].at, 675);
  const b = read("BP goes from 4 to 5. pens at 3 for the starters");
  deq([one(b, "bp").at, one(b, "bp").dur], [960, 60]);
  assert.equal(one(b, "bullpen").at, 900); deq(b.unknown, []);
  const k = read("cage work should kick off at 2:15");
  assert.equal(one(k, "cage").at, 855); assert.equal(k.anchors.end, null);
});

/* ================================================================ unknowns */
test("phrases not understood are reported, never dropped", () => {
  const r = read("we have a scrimmage vs the cubs at 1, stretch at 10, juggling practice");
  assert.ok(r.unknown.some((u) => /cubs/.test(u)));
  assert.ok(r.unknown.some((u) => /juggling/.test(u)));
  assert.equal(one(r, "stretch").at, 600);
  one(r, "custom");
});

test("empty text gives an empty, valid request", () => {
  const r = read("   ");
  wellFormed(r);
  deq(r.activities, []);
});

test("unbound numbers become unknowns", () => {
  const r = read("stretch, 45 minutes, BP");
  assert.ok(r.unknown.includes("45 minutes") || one(r, "stretch").dur === 45 || one(r, "bp").dur === 45);
});

test("never labelled AI in any reader string", () => {
  const texts = ["10 AM stretch, 1 PM game", "rain expected, move hitting indoors", "same as yesterday but drop BP", "defense, hitting, stations, game day"];
  for (const t of texts) assert.ok(!/\bAI\b/.test(JSON.stringify(read(t))), t);
});

/* ================================================================== edits */
const BASE = read("10 AM stretch, 1 PM game. Team fundy, indy defense. 30-minute BP rounds, 30 minutes off pregame. Baserunning, cage, pens.");
const id = (k) => BASE.activities.find((a) => a.kind === k).id;
const PLAN = { window: { start: 600, end: 750 } };

test("edit: move defense before hitting", () => {
  const ops = edit("Move defense before hitting.", BASE);
  deq(ops, [{ op: "move", target: { kind: "teamDefense" }, before: { kind: "bp" } }, { op: "move", target: { kind: "indDefense" }, before: { kind: "bp" } }]);
});
test("edit: give pitchers another 15 minutes", () => deq(edit("Give pitchers another 15 minutes.", BASE), [{ op: "duration", target: { who: "pitchers" }, delta: 15 }]));
test("edit: shorten team fundy to 20", () => deq(edit("Shorten team fundy to 20.", BASE), [{ op: "duration", target: { kind: "teamDefense" }, set: 20 }]));
test("edit: add a second BP group", () => deq(edit("Add a second BP group.", BASE), [{ op: "rounds", target: { kind: "bp" }, count: 2, groups: 2 }]));
test("edit: make everything finish by 12:15", () => deq(edit("Make everything finish by 12:15.", BASE), [{ op: "anchor", key: "end", value: 735 }]));
test("edit: run the cage groups simultaneously", () => deq(edit("Run the cage groups simultaneously.", BASE), [{ op: "parallel", targets: [{ kind: "cage" }] }]));
test("edit: keep game time fixed and reorganize the rest", () => {
  const ops = R.readEdit("Keep game time fixed and reorganize the rest.", BASE, PLAN, {});
  deq(ops, [{ op: "lock", target: { kind: "game" } }]);
  deq(ops.unknown, []);
});
test("edit: push BP back 15", () => deq(edit("Push BP back 15.", BASE), [{ op: "shift", target: { kind: "bp" }, delta: 15 }]));
test("edit: start 30 minutes earlier", () => deq(edit("Start 30 minutes earlier.", BASE, PLAN), [{ op: "anchor", key: "start", value: 570 }]));
test("edit: start earlier uses the plan window when no start was stated", () => {
  const req = read("team fundy, BP");
  deq(edit("start 15 minutes earlier", req, { window: { start: 540 } }), [{ op: "anchor", key: "start", value: 525 }]);
});
test("edit: drop baserunning", () => deq(edit("Drop baserunning.", BASE), [{ op: "remove", target: { kind: "baserunning" } }]));
test("edit: add 15 minutes of PFPs after stretch", () => {
  const [op] = edit("Add 15 minutes of PFPs after stretch.", BASE);
  assert.equal(op.op, "add");
  assert.equal(op.activity.kind, "pfp");
  assert.equal(op.activity.who, "pitchers");
  assert.equal(op.activity.dur, 15);
  deq(op.activity.after, [id("stretch")]);
  assert.ok(!BASE.activities.some((a) => a.id === op.activity.id), "new id");
});
test("edit: lunch at 11:45 instead", () => deq(edit("Lunch at 11:45 instead.", BASE), [{ op: "at", target: { kind: "meal" }, at: 705 }]));
test("edit: make BP rounds 20 minutes", () => deq(edit("Make BP rounds 20 minutes.", BASE), [{ op: "rounds", target: { kind: "bp" }, each: 20 }]));
test("edit: several instructions in one message", () => {
  const ops = edit("Move BP to 3:30 and add a meeting at 9:30; drop cage. Then cut bp by 10", BASE);
  deq(ops.map((o) => o.op), ["at", "add", "remove", "duration"]);
  assert.equal(ops[0].at, 930);
  assert.equal(ops[1].activity.at, 570);
  deq(ops[3], { op: "duration", target: { kind: "bp" }, delta: -10 });
});
test("edit: first pitch moved to 7:05 / 45 off before the game", () => {
  deq(edit("first pitch moved to 7:05", BASE), [{ op: "anchor", key: "firstPitch", value: 1145 }]);
  deq(edit("45 off before the game", BASE), [{ op: "anchor", key: "offBeforeGame", value: 45 }]);
});
test("edit: run cage and BP at the same time", () => deq(edit("run cage and bp at the same time", BASE), [{ op: "parallel", targets: [{ kind: "cage" }, { kind: "bp" }] }]));
test("edit: move pens before stretch / bp at 3 / start at 8:30", () => {
  deq(edit("move pens before stretch", BASE), [{ op: "move", target: { kind: "bullpen" }, before: { kind: "stretch" } }]);
  deq(edit("bp at 3", BASE), [{ op: "at", target: { kind: "bp" }, at: 900 }]);
  deq(edit("start at 8:30", BASE), [{ op: "anchor", key: "start", value: 510 }]);
});
test("edit: add 3 BP groups / move hitting indoors", () => {
  deq(edit("add 3 BP groups", BASE), [{ op: "rounds", target: { kind: "bp" }, count: 3, groups: 3 }]);
  deq(edit("move hitting indoors", BASE), [{ op: "indoor", target: "all-hitting" }]);
});
test("edit: give indy 5 more minutes / take 10 off BP", () => {
  deq(edit("give indy 5 more minutes", BASE), [{ op: "duration", target: { kind: "indDefense" }, delta: 5 }]);
  deq(edit("take 10 off bp", BASE), [{ op: "duration", target: { kind: "bp" }, delta: -10 }]);
});
test("edit: not understood is reported in .unknown", () => {
  const ops = R.readEdit("do the flux capacitor", BASE, null, {});
  deq(ops, []);
  deq(J(ops.unknown), ["do the flux capacitor"]);
  const d = J(R.readEditDetailed("do the flux capacitor", BASE, null, {}));
  deq(d.unknown, ["do the flux capacitor"]);
});
