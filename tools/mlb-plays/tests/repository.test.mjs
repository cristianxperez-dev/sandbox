// Play Repository — data integrity + filter / search / similarity logic (node --test tools/mlb-plays/tests/)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore, J, index, detail } from "./load-core.mjs";

const PR = loadCore();
const IDX = index();
const P = IDX.plays;
const FL = IDX.flags;
const run = (f, user = {}) => J(PR.filter(P, f, user, FL)).map((p) => p.id).sort();
const ids = (pred) => P.filter(pred).map((p) => p.id).sort();
const F = (o) => Object.assign(J(PR.emptyFilters()), o);

/* ------------------------------------------------------------- the 200 */
test("200 unique plays, 200 detail files, ids are MLB game + event ids", () => {
  assert.ok(P.length >= 200, "at least the 200 curated plays");
  assert.equal(new Set(P.map((p) => p.id)).size, P.length);
  for (const p of P) {
    assert.match(p.id, /^mlb-\d{6}-\d{1,3}(-e\d{1,3})?$/);
    const d = detail(p.id);
    assert.equal(d.id, p.id);
    assert.equal(String(d.game.gamePk), p.id.split("-")[1]);
    assert.equal(String(d.source.atBatIndex), p.id.split("-")[2]);
  }
});
test("category distribution: the brief's 35/35/35/25/25/25/20, plus only High Home imports beyond it", () => {
  const want = { "Baserunning & advancement": 35, "Infield defense & decisions": 35, "Outfield defense, cutoffs & relays": 35,
    "Catcher defense & plays at the plate": 25, "Situational hitting": 25, "High-leverage & unusual situations": 25, "Miscellaneous teaching moments": 20 };
  const orig = new Set(JSON.parse(readFileSync(new URL("./original-200.json", import.meta.url), "utf8")));
  const c = {};
  P.filter((p) => orig.has(p.id)).forEach((p) => (c[p.category] = (c[p.category] || 0) + 1));
  assert.deepEqual(c, want);
  for (const p of P.filter((x) => !orig.has(x.id))) assert.ok(p.cameras.highHome, p.id + " added beyond the 200 only because High Home was verified");
});
test("no duplicate events or clips, and no glut of home runs or strikeouts", () => {
  const ev = new Set(), clips = new Set();
  for (const p of P) {
    const d = detail(p.id);
    const key = `${d.game.gamePk}:${d.source.playId || d.source.atBatIndex + ":" + (d.source.eventIndex ?? "")}`;
    assert.ok(!ev.has(key), "duplicate event " + key); ev.add(key);
    const first = d.clips[0].slug;
    assert.ok(!clips.has(first), "duplicate primary clip " + first); clips.add(first);
  }
  const n = (e) => P.filter((p) => p.event === e).length;
  assert.ok(n("home_run") <= 8 && n("strikeout") <= 10, `home runs ${n("home_run")}, strikeouts ${n("strikeout")}`);
  assert.ok(new Set(P.map((p) => p.bases)).size === 8 && new Set(P.map((p) => p.outs)).size === 3, "every base and out state is represented");
});
test("the 50 original plays are all still published", () => {
  const orig = JSON.parse(readFileSync(new URL("./original-50.json", import.meta.url), "utf8"));
  for (const id of orig) assert.ok(P.some((p) => p.id === id), "kept " + id);
});
test("every play has at least one verified, playable MLB clip with provenance", () => {
  for (const p of P) {
    const d = detail(p.id);
    assert.ok(d.clips.length >= 1, p.id);
    for (const c of d.clips) {
      assert.match(c.embedUrl, /^https:\/\/streamable\.com\/m\/[a-z0-9-]+$/, p.id);
      assert.match(c.pageUrl, /^https:\/\/www\.mlb\.com\/video\/[a-z0-9-]+$/, p.id);
      assert.equal(c.embedUrl.split("/m/")[1], c.pageUrl.split("/video/")[1], "embed and page are the same MLB clip");
      assert.ok(c.checks && c.checks.pageEmbed === true && [200, 206].includes(c.checks.embedStatus), `${p.id} ${c.slug} checks`);
      assert.ok(["high-home", "broadcast", "alternate"].includes(c.angle.category));
      assert.ok(c.howVerified && c.howVerified.length > 20);
      if (c.kind === "highlight") assert.equal(c.match.guid, d.source.playId, "highlight guid = playId");
      if (c.kind === "filmroom") assert.ok(Object.values(c.match.filmroom).every(Boolean), "Film Room play info matches");
    }
  }
});
test("High Home is only ever MLB-labelled or visually confirmed High Home footage; the original two are kept", () => {
  const hh = P.filter((p) => p.angles.includes("high-home"));
  assert.ok(hh.length >= 2 && ["mlb-813036-24", "mlb-813037-58"].every((id) => hh.some((p) => p.id === id)));
  for (const p of P) for (const c of detail(p.id).clips) {
    if (c.angle.category === "high-home") { assert.equal(c.kind, "high-home"); assert.match(c.angle.label, /HIGH HOME/); if (!/high home/i.test(c.title)) assert.ok(c.angle.visual && c.angle.visual.verdict === "high-home"); }
    else assert.doesNotMatch(c.angle.label, /high home/i);
  }
  // High Home is the first clip shown whenever a play has one
  hh.forEach((p) => assert.equal(detail(p.id).clips[0].kind, "high-home"));
});
test("camera availability: stored per play, matches verified clips, High Home only when MLB labels it", () => {
  for (const p of P) {
    const d = detail(p.id), c = d.cameras;
    assert.ok(c && c.broadcast && c.highHome, p.id);
    const ok = (x) => x.checks && x.checks.pageEmbed && [200, 206].includes(x.checks.embedStatus);
    assert.equal(c.broadcast.available, d.clips.some((x) => x.angle.category === "broadcast" && ok(x)), p.id);
    assert.equal(c.highHome.available, d.clips.some((x) => x.kind === "high-home" && ok(x)), p.id);
    assert.deepEqual(p.cameras.broadcast, c.broadcast.available); assert.deepEqual(p.cameras.highHome, c.highHome.available);
    for (const i of c.highHome.clips) {
      const x = d.clips[i];
      assert.equal(x.kind, "high-home");
      // High Home either because MLB says so, or because a person confirmed MLB's own frame (recorded verdict)
      if (!/high home/i.test(x.title)) assert.ok(x.angle.visual && x.angle.visual.verdict === "high-home" && x.angle.visual.by, p.id + " visual verdict recorded");
    }
    for (const i of c.broadcast.clips) assert.equal(d.clips[i].angle.category, "broadcast");
    assert.ok(Array.isArray(c.highHome.searched) && c.highHome.searched.length >= 2, "High Home was actively searched for " + p.id);
  }
  for (const p of P) {
    const h = detail(p.id).cameras.highHome;
    assert.ok(["verified", "inaccessible", "not_found", "not_searched"].includes(h.status), p.id + " status " + h.status);
    assert.equal(h.status === "verified", h.available, p.id + " verified ⇔ playable High Home clip");
    assert.equal(p.cameras.highHomeStatus, h.status, p.id);
    if (h.status !== "not_searched") assert.ok((h.sources || []).length >= 4, p.id + " every source logged");
    const g = detail(p.id).cameras.gameday;
    assert.ok(g && /^https:\/\/www\.mlb\.com\/gameday\//.test(g.url) && g.url.includes(String(p.gamePk)), p.id + " Gameday link");
  }
  const f = (k) => run(F({ camera: k })).length;
  assert.equal(f("highHome"), P.filter((p) => p.cameras.highHome).length);
  assert.equal(f("both"), P.filter((p) => p.cameras.highHome && p.cameras.broadcast).length);
  assert.equal(f("broadcast"), P.filter((p) => p.cameras.broadcast).length);
});
test("game state fields are well-formed and consistent with the official record", () => {
  for (const p of P) {
    const d = detail(p.id);
    assert.match(p.bases, /^[1_][2_][3_]$/);
    assert.ok([0, 1, 2].includes(p.outs));
    assert.ok(p.inning >= 1 && ["top", "bottom"].includes(p.half));
    assert.equal(p.batting, p.half === "top" ? "away" : "home");
    // runners named on the occupied bases, none on empty ones
    ["1B", "2B", "3B"].forEach((b, i) => assert.equal(!!p.runnersOn[b], p.bases[i] !== "_", `${p.id} ${b}`));
    // outs and runs on the play reconcile with before → after
    if (p.after.outs < 3) assert.equal(p.after.outs - p.outs, p.outsOnPlay, `${p.id} outs`);
    const side = p.batting === "away" ? 0 : 1;
    assert.equal(p.after.score[side] - p.score[side], p.runs, `${p.id} runs`);
    assert.equal(p.after.score[1 - side], p.score[1 - side], `${p.id} fielding team score unchanged`);
    assert.equal(d.event.description, p.description);
    p.flags.forEach((f) => assert.ok(FL[f], `${p.id} unknown flag ${f}`));
  }
});
test("Savant cross-check: every terminal play with a pitch clip names the same game, batter and pitcher", () => {
  for (const p of P) {
    const d = detail(p.id);
    if (d.source.terminal && d.savant) assert.equal(d.savant.match, true, p.id);
  }
  assert.ok(P.filter((p) => (detail(p.id).savant || {}).match).length >= 44);
});

/* ---------------------------------------------------------- base-out filters */
const CODES = ["___", "1__", "_2_", "__3", "12_", "1_3", "_23", "123"];
const toSel = (c) => [1, 2, 3].filter((b) => c[b - 1] !== "_");
test("diamond 'Exactly' returns exactly the plays with that occupancy, for all 8 states × 3 out counts", () => {
  for (const c of CODES) {
    assert.deepEqual(run(F({ bases: { mode: "exact", sel: toSel(c) } })), ids((p) => p.bases === c), c);
    for (const o of [0, 1, 2]) assert.deepEqual(run(F({ bases: { mode: "exact", sel: toSel(c) }, outs: [o] })), ids((p) => p.bases === c && p.outs === o), `${c} ${o}`);
  }
});
test("diamond 'At least', runner counts and quick situations", () => {
  assert.deepEqual(run(F({ bases: { mode: "includes", sel: [2] } })), ids((p) => p.bases[1] === "2"));
  assert.deepEqual(run(F({ bases: { mode: "includes", sel: [1, 3] } })), ids((p) => p.bases[0] === "1" && p.bases[2] === "3"));
  assert.deepEqual(run(F({ runners: [1, 2, 3] })), ids((p) => p.bases !== "___"));
  assert.deepEqual(run(F({ runners: [2] })), ids((p) => [...p.bases].filter((x) => x !== "_").length === 2));
  assert.deepEqual(run(F({ flags: ["risp"] })), ids((p) => p.bases[1] === "2" || p.bases[2] === "3"));
  assert.deepEqual(run(F({ flags: ["force_available"] })), ids((p) => p.bases[0] === "1"));
  assert.deepEqual(run(F({ flags: ["dp_situation"] })), ids((p) => p.bases[0] === "1" && p.outs < 2));
  assert.deepEqual(run(F({ flags: ["two_outs"] })), ids((p) => p.outs === 2));
  assert.deepEqual(run(F({ outs: [0, 1] })), ids((p) => p.outs < 2));
});
test("inning, score and context filters use the state before the play", () => {
  const d = (p) => p.score[p.batting === "away" ? 0 : 1] - p.score[p.batting === "away" ? 1 : 0];
  assert.deepEqual(run(F({ phases: ["late"] })), ids((p) => p.inning >= 7 && p.inning <= 9));
  assert.deepEqual(run(F({ phases: ["extra"] })), ids((p) => p.inning >= 10));
  assert.deepEqual(run(F({ scoreState: ["tied"] })), ids((p) => d(p) === 0));
  assert.deepEqual(run(F({ scoreState: ["trailing"] })), ids((p) => d(p) < 0));
  assert.deepEqual(run(F({ flags: ["tying_run_on"] })), ids((p) => d(p) < 0 && [...p.bases].filter((x) => x !== "_").length >= -d(p)));
  assert.deepEqual(run(F({ flags: ["walkoff_situation"] })), ids((p) => p.half === "bottom" && p.inning >= 9 && d(p) <= 0));
  assert.deepEqual(run(F({ innMin: 4, innMax: 6, half: "bottom" })), ids((p) => p.inning >= 4 && p.inning <= 6 && p.half === "bottom"));
  assert.deepEqual(run(F({ batSide: "home" })), ids((p) => p.half === "bottom"));
});
test("combined filters: late innings + close + runner in scoring position + fewer than two outs", () => {
  const got = run(F({ phases: ["late", "extra"], flags: ["close", "risp"], outs: [0, 1] }));
  const want = ids((p) => p.inning >= 7 && Math.abs(p.score[0] - p.score[1]) <= 2 && (p.bases[1] === "2" || p.bases[2] === "3") && p.outs < 2);
  assert.deepEqual(got, want);
  assert.ok(got.length >= 1, "the starter set has examples of this teaching situation");
});
test("outcome chips OR within a group, AND across groups", () => {
  const got = run(F({ flags: ["single", "double", "outfield_assist"] }));    // offense: single|double, defense: outfield assist
  assert.deepEqual(got, ids((p) => (p.flags.includes("single") || p.flags.includes("double")) && p.flags.includes("outfield_assist")));
});
test("team (either / batting / fielding), batter, pitcher, outcome, handedness, fielder, season", () => {
  const t = P[0].home;
  assert.deepEqual(run(F({ team: t })), ids((p) => p.home === t || p.away === t));
  assert.deepEqual(run(F({ team: t, teamRole: "fielding" })), ids((p) => (p.batting === "away" ? p.home : p.away) === t));
  const b = P[5].batter.name;
  assert.deepEqual(run(F({ batter: b })), ids((p) => p.batter.name === b));
  assert.deepEqual(run(F({ batter: b.split(" ").pop() })), ids((p) => p.batter.name.split(" ").pop() === b.split(" ").pop()));
  assert.deepEqual(run(F({ pitcher: P[7].pitcher.name })), ids((p) => p.pitcher.name === P[7].pitcher.name));
  assert.deepEqual(run(F({ events: ["single"] })), ids((p) => p.event === "single"));
  assert.deepEqual(run(F({ batHand: "L" })), ids((p) => p.batter.side === "L"));
  assert.deepEqual(run(F({ positions: ["C"] })), ids((p) => p.positions.includes("C")));
  assert.deepEqual(run(F({ seasons: [2024] })), ids((p) => p.season === 2024));
  assert.deepEqual(run(F({ gameTypes: ["post"] })), ids((p) => ["F", "D", "L", "W"].includes(p.gameType)));
  assert.deepEqual(run(F({ locations: [9] })), ids((p) => (p.batted || {}).location === 9));
});
test("coach data filters: saved, manual tags, collection", () => {
  const user = { saved: [P[1].id], tags: { [P[2].id]: ["late cutoff alignment"], [P[3].id]: ["Late Cutoff Alignment", "x"] }, collections: { c1: { plays: [P[4].id, P[6].id] } } };
  assert.deepEqual(run(F({ savedOnly: true }), user), [P[1].id]);
  assert.deepEqual(run(F({ tags: ["late cutoff alignment"] }), user), [P[2].id, P[3].id].sort());
  assert.deepEqual(run(F({ collection: "c1" }), user), [P[4].id, P[6].id].sort());
});

/* ---------------------------------------------------------- natural language */
const ctx = () => {
  const teams = {}; P.forEach((p) => { teams[p.away] = []; teams[p.home] = []; });
  const people = []; P.forEach((p) => { people.push({ name: p.batter.name, role: "batter" }); people.push({ name: p.pitcher.name, role: "pitcher" }); });
  return { teams, people, tags: ["late cutoff alignment"], flagDefs: FL };
};
test("NL: the brief's examples become the right structured filters", () => {
  let r = J(PR.parseQuery("Runner on third, less than two outs, ground ball.", ctx()));
  assert.deepEqual(r.filters.bases, { mode: "exact", sel: [3] }); assert.deepEqual(r.filters.outs, [0, 1]); assert.ok(r.filters.flags.includes("ground_ball"));
  r = J(PR.parseQuery("Outfielders making throws to home plate.", ctx()));
  assert.deepEqual(r.filters.positions, ["LF", "CF", "RF"]); assert.ok(r.filters.flags.includes("play_at_plate"));
  r = J(PR.parseQuery("Two-out baserunning mistakes.", ctx()));
  assert.deepEqual(r.filters.outs, [2]); assert.ok(r.filters.flags.includes("runner_out_on_bases"));
  r = J(PR.parseQuery("Double-play opportunities with runners on first and second.", ctx()));
  assert.deepEqual(r.filters.bases, { mode: "exact", sel: [1, 2] }); assert.ok(r.filters.flags.includes("dp_situation"));
  r = J(PR.parseQuery("Late-inning plays where the tying run was on second.", ctx()));
  assert.deepEqual(r.filters.phases, ["late"]); assert.ok(r.filters.flags.includes("tying_run_on")); assert.deepEqual(r.filters.bases, { mode: "includes", sel: [2] });
  r = J(PR.parseQuery("runners on first and third, less than two outs, ground ball hit to the middle infield", ctx()));
  assert.deepEqual(r.filters.bases, { mode: "exact", sel: [1, 3] }); assert.deepEqual(r.filters.outs, [0, 1]);
  assert.ok(r.filters.flags.includes("ground_ball") && r.filters.flags.includes("middle_infield"));
  r = J(PR.parseQuery("Runner on second | 1 out | Single to right field | Play at home", ctx()));
  assert.deepEqual(r.filters.bases, { mode: "exact", sel: [2] }); assert.deepEqual(r.filters.outs, [1]); assert.deepEqual(r.filters.locations, [9]);
  assert.ok(r.filters.flags.includes("single") && r.filters.flags.includes("play_at_plate"));
});
test("NL: concepts MLB's data can't establish are reported, never guessed; the coach's own tags are used", () => {
  let r = J(PR.parseQuery("defensive communication with the infield in and a runner on third", ctx()));
  assert.ok(r.unsupported.includes("communication") && r.unsupported.includes("infield in"));
  assert.deepEqual(r.filters.bases, { mode: "exact", sel: [3] });
  assert.ok(!r.filters.flags.length || r.filters.flags.every((f) => FL[f]));
  r = J(PR.parseQuery("plays with late cutoff alignment", ctx()));
  assert.deepEqual(r.filters.tags, ["late cutoff alignment"]);
  r = J(PR.parseQuery("show me Aaron Judge", ctx()));
  if (P.some((p) => p.batter.name === "Aaron Judge")) assert.equal(r.filters.batter, "Aaron Judge");
});
test("NL: every parsed example returns only plays satisfying its filters", () => {
  ["runner on third, less than two outs", "outfielders throws to home", "stolen bases with two outs", "bases loaded", "walk-off", "extra innings", "double plays", "relay"].forEach((q) => {
    const r = PR.parseQuery(q, ctx());
    const got = PR.filter(P, r.filters, {}, FL);
    got.forEach((p) => assert.ok(PR.matches(p, r.filters, {}, FL)));
  });
});

/* ---------------------------------------------------------- similarity + url */
test("Find Similar: ranked, never the play itself, top match shares the situation", () => {
  for (const p of P.slice(0, 15)) {
    const s = J(PR.similar(p, P, FL, {}, 8));
    assert.ok(s.length > 0 && s.every((x) => x.p.id !== p.id));
    for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].s >= s[i].s);
    const top = s[0].p;
    assert.ok(top.bases === p.bases || top.outs === p.outs || top.event === p.event || top.flags.some((f) => p.flags.includes(f) && FL[f].group !== "context"));
  }
  const user = { tags: { [P[0].id]: ["a"], [P[9].id]: ["a"] } };
  assert.ok(PR.similarity(P[0], P[9], FL, ["a"], ["a"]) > PR.similarity(P[0], P[9], FL, [], []), "shared teaching tags raise similarity");
  void user;
});
test("filters survive the URL round trip (search state preserved when returning from a video)", () => {
  const f = F({ bases: { mode: "exact", sel: [1, 3] }, outs: [0, 1], flags: ["ground_ball", "middle_infield"], team: "NYY", evMin: 95 });
  assert.deepEqual(J(PR.decodeFilters(PR.encodeFilters(f))), J(f));
  assert.equal(PR.encodeFilters(PR.emptyFilters()), "");
  assert.deepEqual(J(PR.decodeFilters("%7Bbad")), J(PR.emptyFilters()));
});
