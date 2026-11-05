// FUEL — logic tests against the shared handlers with an in-memory store.   node --test fuel/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/fuel/shared/handlers.js";
import { MemoryStore } from "../../apps/fuel/shared/memstore.js";
import { quickParse, splitLegacyNotes } from "../../apps/fuel/shared/parse.js";
import { pairObservations, pearson, analyze } from "../../apps/fuel/shared/stats.js";
import { parseCSV } from "../../apps/fuel/shared/util.js";

const TODAY = "2026-11-05";
const users = {
  admin: { email: "admin@example.test", name: "Ada Admin", role: "admin", initials: "AA" },
  diet: { email: "rd@example.test", name: "Dana Whitfield", role: "dietitian", initials: "DW", staff_id: "st_dw" },
  perf: { email: "perf@example.test", name: "Pat Perf", role: "performance", initials: "PP" },
  ro: { email: "ro@example.test", name: "Rory Read", role: "readonly", initials: "RR" },
};
function env(store = new MemoryStore({ staff: [{ id: "st_dw", name: "Dana Whitfield", initials: "DW", role: "dietitian" }] })) {
  let tick = 0;
  const call = (who, method, path, body, params) => handle({ method, path, body, params: new URLSearchParams(params || {}) },
    { store, user: users[who], today: TODAY, now: new Date(Date.UTC(2026, 10, 5, 12, 0, tick++)).toISOString(), mode: "test" });
  return { store, call };
}
const ROSTER = `Player ID,First Name,Last Name,DOB,Position,Affiliate,Bats,Throws,Mobile Phone,WhatsApp #
10001,Mateo,Rodriguez,2001-04-12,SS,Corpus Christi,R,R,555-0101,555-0101
10002,Luis,Rodriguez,1999-08-30,RHP,Sugar Land,R,R,555-0102,
10003,Jake,Miller,2002-01-05,LHP,Asheville,L,L,,
`;

test("1–2 · create a player and find him in the directory", async () => {
  const { call } = env();
  const { player } = await call("diet", "POST", "player.create", { fields: { first_name: "Evan", last_name: "Cole", dob: "2000-02-02", position: "CF" }, affiliate: "Houston" });
  assert.match(player.id, /^pl_/);
  const dir = await call("diet", "GET", "players");
  assert.equal(dir.length, 1);
  assert.equal(dir[0].affiliate, "Houston");
  assert.equal(dir[0].age, 26);
});

test("3–4 · roster import, then re-import: no duplicate players; same name stays separate by Player ID", async () => {
  const { call, store } = env();
  const prev = await call("admin", "POST", "import.preview", { kind: "roster", csv: ROSTER });
  assert.equal(prev.summary.new, 3);
  const c1 = await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  assert.equal(c1.counts.players_created, 3);
  const c2 = await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  assert.equal(c2.counts.players_created, 0);
  assert.equal((await store.all("players")).length, 3, "re-import does not duplicate");
  const rods = (await store.all("players")).filter((p) => p.last_name === "Rodriguez");
  assert.equal(rods.length, 2, "two Rodriguez players remain distinct");
});

test("roster without IDs: a same-name player is only a suggestion and waits for review", async () => {
  const { call, store } = env();
  await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const csv = "First Name,Last Name,Affiliate\nJake,Miller,Corpus Christi\n";
  const p = await call("admin", "POST", "import.preview", { kind: "roster", csv });
  assert.equal(p.rows[0].status, "review");
  const skip = await call("admin", "POST", "import.commit", { kind: "roster", csv });
  assert.equal(skip.counts.skipped, 1, "undecided review rows are never guessed");
  assert.equal((await store.all("players")).length, 3);
});

test("5–6 · weights and DEXA accumulate; nothing is overwritten; corrections void with a reason", async () => {
  const { call, store } = env();
  const { player } = await call("diet", "POST", "player.create", { fields: { first_name: "A", last_name: "B" } });
  await call("diet", "POST", "weight", { player_id: player.id, date: "2026-11-01", weight: 200.2, unit: "lb" });
  const { weight } = await call("diet", "POST", "weight", { player_id: player.id, date: "2026-11-02", weight: 201.0, unit: "lb" });
  await call("diet", "POST", "dexa", { player_id: player.id, date: "2026-10-01", body_fat_pct: 12.1, lean_mass: 168.2, fat_mass: 24.3, alm: 80.1, unit: "lb" });
  await assert.rejects(call("diet", "POST", "weight", { player_id: player.id, date: "2026-11-02", weight: 20, unit: "lb" }), /plausible/);
  await assert.rejects(call("diet", "POST", "weight", { player_id: player.id, date: "2026-12-30", weight: 200, unit: "lb" }), /future/);
  await assert.rejects(call("diet", "POST", "void", { table: "weights", id: weight.id }), /reason/);
  await call("diet", "POST", "void", { table: "weights", id: weight.id, reason: "typo — scale not zeroed" });
  const ws = await store.all("weights");
  assert.equal(ws.length, 2, "the voided weight is kept");
  assert.equal(ws.find((w) => w.id === weight.id).voided, true);
  const dir = await call("diet", "GET", "players");
  assert.equal(dir[0].latest_weight.value, 200.2, "voided weight no longer counts");
  assert.equal(dir[0].latest_bf.value, 12.1);
});

test("7–10 · quick entry: note kept verbatim, weight extracted, follow-up resolved from the entry date, one atomic save", async () => {
  const { call, store } = env();
  const { player } = await call("diet", "POST", "player.create", { fields: { first_name: "Mateo", last_name: "Rodriguez" } });
  const note = "Met with Rodriguez after workouts. Weight was 197.4 this morning, up about 2 pounds from last week. Talked about increasing breakfast calories and adding a shake after training. Follow up next Thursday.";
  const parsed = quickParse(note, "2026-11-05");
  assert.deepEqual(parsed.weight, { value: 197.4, unit: "lb", date: "2026-11-05" });
  assert.equal(parsed.weights.length, 1, "the 2-pound change is not a measurement");
  assert.equal(parsed.followup.date, "2026-11-12");
  assert.equal(parsed.type, "in_person");
  // relative dates use the ENTRY date, not today
  assert.equal(quickParse("follow up next Thursday", "2026-10-01").followup.date, "2026-10-08");
  const r = await call("diet", "POST", "quick", { player_id: player.id, entry_date: "2026-11-05", note, type: parsed.type, weight: parsed.weight, followup: parsed.followup, parsed });
  assert.ok(r.interaction && r.weight && r.followup);
  const i = (await store.all("interactions"))[0];
  assert.equal(i.text, note); assert.equal(i.original_text, note);
  assert.equal((await store.all("weights"))[0].weight, 197.4);
  assert.equal((await store.all("followups"))[0].due_date, "2026-11-12");
  assert.equal((await store.all("followups"))[0].interaction_id, i.id);
  const qe = (await store.all("quick_entries"))[0];
  assert.deepEqual(Object.keys(qe.created).sort(), ["followup", "interaction", "weight"]);
  // an invalid extracted weight fails the whole entry — nothing half-saved
  await assert.rejects(call("diet", "POST", "quick", { player_id: player.id, entry_date: "2026-11-05", note: "x", weight: { value: 19, unit: "lb" } }));
  assert.equal((await store.all("interactions")).length, 1);
  // an edit keeps the earlier version
  await call("diet", "POST", "interaction.edit", { id: i.id, text: "corrected text", reason: "typo" });
  const e = (await store.all("interactions"))[0];
  assert.equal(e.original_text, note); assert.equal(e.history[0].previous_text, note);
});

test("ambiguous weights are never preselected", () => {
  const p = quickParse("Called — weighed 210 yesterday, scale at home said 212", "2026-11-05");
  assert.equal(p.weightAmbiguous, true);
  assert.equal(p.weight, null);
});

const LEGACY = `Last Name,First Name,Position,Affiliate,Mobile Phone,What's App #,Date of Current Weight,Current Weight,Most Recent DEXA Date,Most Recent DEXA BF%,Most Recent DEXA LM,Most Recent DEXA FM,Most Recent ALM,Hydration Card?,Fluid Loss (oz) / HR,Na Loss / HR,Vitamin D Protocol?,Goal Weight,Body Comp Goal,"Pre-Season Bullets (goal, strengths, weakness; if nothing, put maintain if accurate)",History,Nutrition Actions (include date & initials),Nutrition Actions Cont... (include date & initials),Nutrition Actions Cont... (include date & initials)2,Week 5 Goal Check-In's
Miller,Jake,LHP,Asheville,,,10/20/2026,188.5,9/15/2026,14.2,152.1,25.3,70.2,Yes,38,1100,Yes - 5000 IU,195,Gain lean mass,"Goal: +6 lb lean; Strengths: hydration; Weakness: breakfast",Grew up skipping breakfast,"3/14 talked breakfast + shake (CP); 4/2 - added PB&J pregame -DW","5/20/2026 reviewed DEXA with him (CP)","Travel snack list sent",On track - up 2 lb
Newman,Sam,C,Fayetteville,,,,,,,,,,,,,,,,maintain,,,,,
`;
test("11–12 · legacy spreadsheet: every column lands somewhere; continuation columns split into dated notes", async () => {
  const { call, store } = env();
  await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const prev = await call("diet", "POST", "import.preview", { kind: "legacy", csv: LEGACY, options: { year: 2026 } });
  const mapped = Object.keys(prev.mapping);
  for (const k of ["weight_date", "weight", "dexa_date", "bf", "lm", "fm", "alm", "hydration_card", "fluid_loss", "sodium_loss", "vitamin_d", "goal_weight", "body_comp_goal", "preseason", "history", "actions1", "actions2", "actions3", "week5", "phone", "whatsapp", "position", "affiliate"])
    assert.ok(mapped.includes(k), "mapped " + k);
  assert.equal(prev.rows[0].status, "review", "name-only match to the rostered Jake Miller needs confirmation");
  const jake = (await store.all("players")).find((p) => p.last_name === "Miller");
  const c = await call("diet", "POST", "import.commit", { kind: "legacy", csv: LEGACY, options: { year: 2026 }, decisions: { 2: { action: "link", player_id: jake.id }, 3: { action: "new" } } });
  assert.equal(c.counts.players_created, 1);
  const prof = await call("diet", "GET", "player", null, { id: jake.id });
  assert.equal(prof.weights[0].weight, 188.5); assert.equal(prof.weights[0].date, "2026-10-20");
  assert.equal(prof.dexa[0].lean_mass, 152.1); assert.equal(prof.dexa[0].date, "2026-09-15");
  assert.equal(prof.hydration[0].fluid_loss_oz_hr, 38); assert.equal(prof.hydration[0].sodium_loss_mg_hr, 1100); assert.equal(prof.hydration[0].hydration_card, true);
  assert.equal(prof.protocols[0].type, "vitamin_d"); assert.equal(prof.protocols[0].details, "Yes - 5000 IU");
  assert.deepEqual(prof.goals.map((g) => g.type).sort(), ["body_comp", "preseason", "strength", "weakness", "weight"]);
  const notes = prof.interactions;
  const actions = notes.filter((n) => /Nutrition Actions/.test(n.source.column));
  assert.equal(actions.length, 4, "two dated entries + one from Cont... + one undated from Cont...2");
  const a1 = actions.find((n) => n.date === "2026-03-14");
  assert.equal(a1.author_initials, "CP"); assert.match(a1.text, /talked breakfast \+ shake/);
  assert.ok(actions.find((n) => n.date === "2026-04-02" && n.author_initials === "DW"));
  assert.ok(actions.find((n) => n.date === "2026-05-20" && n.source.column === "Nutrition Actions Cont..."));
  const undated = actions.find((n) => n.source.column === "Nutrition Actions Cont...2");
  assert.equal(undated.date, null, "no date in the source → stays unknown");
  assert.ok(notes.find((n) => n.type === "history" && n.date === null));
  assert.ok(notes.find((n) => n.type === "check_in" && /Week 5/.test(n.title)));
  // the source row is kept with the batch
  const b = (await store.all("imports")).find((x) => x.kind === "legacy");
  assert.ok(b.source_rows[0].raw["Current Weight"] === "188.5");
  // re-import is a no-op
  const again = await call("diet", "POST", "import.commit", { kind: "legacy", csv: LEGACY, options: { year: 2026 }, decisions: { 2: { action: "link", player_id: jake.id }, 3: { action: "skip" } } });
  assert.equal(again.counts.records, 0); assert.ok(again.counts.duplicates >= 10);
  // without a season year, "3/14" stays undated rather than guessed
  const p2 = await call("diet", "POST", "import.preview", { kind: "legacy", csv: LEGACY, options: {} });
  const r0 = p2.rows[0].records.find((x) => x.table === "interactions" && x.date_text === "3/14");
  assert.equal(r0.date, null);
});

const PERF = `player_id,date,metric,value,unit,definition
10001,2026-04-10,bat_speed,72.4,mph,average
10001,2026-05-10,bat_speed,73.8,mph,average
10001,2026-04-10,exit_velocity,89.2,mph,average
10002,2026-04-10,pitch_velocity,93.1,mph,average_fastball
10002,2026-05-10,pitch_velocity,94.0,mph,average_fastball
99999,2026-05-10,pitch_velocity,94.0,mph,average_fastball
10001,2026-05-11,bat_speed,fast,mph,average
10001,2026-05-12,swing_length,7.1,ft,average
10001,2026-05-13,bat_speed,72.0,kph,average
10001,2026-05-14,bat_speed,72.0,mph,
`;
test("13–14 · performance import matches by Player ID and rejects unknown IDs and bad rows", async () => {
  const { call, store } = env();
  await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const prev = await call("perf", "POST", "import.preview", { kind: "performance", csv: PERF });
  const st = prev.rows.map((r) => r.status);
  assert.deepEqual(st.slice(0, 5), ["new", "new", "new", "new", "new"]);
  assert.equal(st.slice(5).filter((s) => s === "error").length, 5);
  assert.match(prev.rows[5].issues[0].text, /Unknown Player ID 99999/);
  const c = await call("perf", "POST", "import.commit", { kind: "performance", csv: PERF });
  assert.equal(c.counts.records, 5);
  assert.equal((await store.all("players")).length, 3, "no player created from a performance row");
  const again = await call("perf", "POST", "import.commit", { kind: "performance", csv: PERF });
  assert.equal(again.counts.records, 0);
  // 25 · a different value for an existing date/definition is NOT silently written over the old one
  const conflict = "player_id,date,metric,value,unit,definition\n10001,2026-04-10,bat_speed,75.0,mph,average\n";
  const pc = await call("perf", "POST", "import.preview", { kind: "performance", csv: conflict });
  assert.equal(pc.rows[0].status, "review");
  const cc = await call("perf", "POST", "import.commit", { kind: "performance", csv: conflict });
  assert.equal(cc.counts.records, 0, "skipped unless the person chooses to keep both");
  const vals = (await store.all("performance")).filter((x) => x.date === "2026-04-10" && x.metric === "bat_speed").map((x) => x.value);
  assert.deepEqual(vals, [72.4]);
});

test("18–19 · pairing is one-to-one within the window; Pearson is correct; nothing is interpolated", () => {
  const W = [["2026-04-01", 200], ["2026-04-08", 202], ["2026-04-15", 203], ["2026-04-22", 205], ["2026-04-29", 206], ["2026-05-06", 208]].map(([date, value], i) => ({ id: "w" + i, date, value }));
  const B = [["2026-04-02", 70.1], ["2026-04-09", 70.9], ["2026-04-16", 71.0], ["2026-04-23", 72.2], ["2026-04-30", 72.0], ["2026-05-30", 74]].map(([date, value], i) => ({ id: "b" + i, date, value }));
  const pairs = pairObservations(W, B, 7);
  assert.equal(pairs.length, 5, "the 5/30 measurement has no weight within 7 days → not paired, not interpolated");
  assert.ok(pairs.every((p) => p.gap === 1));
  const ids = pairs.map((p) => p.xId);
  assert.equal(new Set(ids).size, ids.length, "no weight reused");
  // hand-checked: corr([200,202,203,205,206],[70.1,70.9,71.0,72.2,72.0])
  const xs = [200, 202, 203, 205, 206], ys = [70.1, 70.9, 71.0, 72.2, 72.0];
  const mx = xs.reduce((a, b) => a + b) / 5, my = ys.reduce((a, b) => a + b) / 5;
  const r0 = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  assert.ok(Math.abs(pearson(pairs).r - r0) < 1e-12);
  const a = analyze(W, B, 7);
  assert.equal(a.show, true); assert.match(a.message, /doesn't show that one caused/);
  // a single DEXA scan pairs with ONE measurement only
  const one = pairObservations([{ id: "d", date: "2026-04-10", value: 170 }], B, 30);
  assert.equal(one.length, 1);
  assert.equal(analyze([{ id: "d", date: "2026-04-10", value: 170 }], B, 30).show, false);
  // deterministic: same input, same pairs, whatever the order
  assert.deepEqual(pairObservations([...W].reverse(), [...B].reverse(), 7), pairs);
});

test("20 · changing affiliate keeps the history and closes the old assignment", async () => {
  const { call, store } = env();
  const { player } = await call("diet", "POST", "player.create", { fields: { first_name: "A", last_name: "B" }, affiliate: "Asheville" });
  await call("diet", "POST", "weight", { player_id: player.id, date: "2026-10-01", weight: 190, unit: "lb" });
  await call("diet", "POST", "player.update", { id: player.id, fields: {}, affiliate: "Corpus Christi" });
  const prof = await call("diet", "GET", "player", null, { id: player.id });
  assert.equal(prof.player.affiliate, "Corpus Christi");
  assert.equal(prof.weights.length, 1);
  assert.equal(prof.assignments.length, 2);
  assert.ok(prof.assignments.find((a) => a.affiliate === "Asheville").end_date);
  assert.equal((await store.all("players")).length, 1);
});

test("23 · roles: read-only can't write; performance staff can't see notes, contacts or protocols; only admins roll back", async () => {
  const { call } = env();
  await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const dir = await call("ro", "GET", "players");
  const id = dir[0].id;
  await assert.rejects(call("ro", "POST", "weight", { player_id: id, date: "2026-11-01", weight: 200 }), (e) => e.status === 403);
  await assert.rejects(call("perf", "POST", "interaction", { player_id: id, date: "2026-11-01", text: "x" }), (e) => e.status === 403);
  await assert.rejects(call("ro", "POST", "import.commit", { kind: "roster", csv: ROSTER }), (e) => e.status === 403);
  await assert.rejects(call("diet", "POST", "import.rollback", { id: "x" }), (e) => e.status === 403);
  await assert.rejects(call("perf", "GET", "followups"), (e) => e.status === 403);
  await assert.rejects(call("ro", "GET", "export", null, { table: "weights" }), (e) => e.status === 403);
  const p = await call("perf", "GET", "player", null, { id });
  assert.equal(p.interactions, undefined); assert.equal(p.hydration, undefined); assert.equal(p.protocols, undefined);
  assert.equal(p.player.phone, undefined); assert.equal(p.player.whatsapp, undefined);
  const pd = await call("diet", "GET", "player", null, { id: dir.find((x) => x.external_id === "10001").id });
  assert.equal(pd.player.phone, "555-0101");
  await assert.rejects(handle({ method: "GET", path: "players" }, { store: new MemoryStore(), user: null, today: TODAY, now: "x" }), (e) => e.status === 401);
  await assert.rejects(handle({ method: "GET", path: "players" }, { store: new MemoryStore(), user: { email: "x", role: "superuser" }, today: TODAY, now: "x" }), (e) => e.status === 401);
});

test("24 · malformed CSVs are reported, not half-imported", async () => {
  const { call, store } = env();
  assert.match(parseCSV('a,b\n"1,2\n').errors.join(" "), /never closed/);
  assert.match(parseCSV("").errors.join(" "), /empty/);
  assert.match(parseCSV("\u0000\u0001binary").errors.join(" "), /binary/);
  const p = await call("admin", "POST", "import.preview", { kind: "roster", csv: "Foo,Bar\n1,2\n" });
  assert.match(p.errors.join(" "), /First name, Last name/);
  await assert.rejects(call("admin", "POST", "import.commit", { kind: "roster", csv: "Foo,Bar\n1,2\n" }), /First name/);
  const dupIds = "Player ID,First Name,Last Name\n7,A,B\n7,C,D\n";
  const pd = await call("admin", "POST", "import.preview", { kind: "roster", csv: dupIds });
  assert.equal(pd.rows[1].status, "error");
  await assert.rejects(call("admin", "POST", "import.preview", { kind: "roster", csv: "" }), /CSV/);
  assert.equal((await store.all("players")).length, 0);
  assert.equal(parseCSV('h1,h2\n"=cmd()",2\n').rows[0].h1, "=cmd()");
});

test("rollback removes exactly what an import added and restores what it changed", async () => {
  const { call, store } = env();
  const c1 = await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const moved = ROSTER.replace("SS,Corpus Christi", "SS,Houston");
  const c2 = await call("admin", "POST", "import.commit", { kind: "roster", csv: moved });
  assert.equal(c2.counts.players_updated, 1);
  assert.equal((await store.all("players")).find((p) => p.external_id === "10001").affiliate, "Houston");
  await call("admin", "POST", "import.rollback", { id: c2.batch.id });
  assert.equal((await store.all("players")).find((p) => p.external_id === "10001").affiliate, "Corpus Christi");
  // a batch staff have built on can't be rolled back
  const pid = (await store.all("players"))[0].id;
  await call("diet", "POST", "weight", { player_id: pid, date: "2026-11-01", weight: 199 });
  await assert.rejects(call("admin", "POST", "import.rollback", { id: c1.batch.id }), (e) => e.status === 409);
});

test("audit: every write leaves an event; exports are logged", async () => {
  const { call, store } = env();
  await call("admin", "POST", "import.commit", { kind: "roster", csv: ROSTER });
  const n0 = (await store.all("audit")).length;
  await call("diet", "GET", "export", null, { table: "weights" });
  const ev = await store.all("audit");
  assert.equal(ev.length, n0 + 1);
  assert.ok(ev.some((a) => a.action === "export" && a.user === "rd@example.test"));
});

test("legacy note splitting keeps wording and never invents a date or author", () => {
  const parts = splitLegacyNotes("Lead text. 3/14 talked breakfast (CP); 4/2 - added shake -DW; ate well", { year: 2026 });
  assert.equal(parts[0].dateUnknown, true); assert.equal(parts[0].initials, null);
  assert.equal(parts[1].date, "2026-03-14"); assert.equal(parts[1].initials, "CP");
  assert.match(parts[2].original, /4\/2 - added shake -DW; ate well/);
});
