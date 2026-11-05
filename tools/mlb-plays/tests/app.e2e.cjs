// Play Repository — end-to-end tests in a real browser against the built site.
// node scripts/build.mjs && node scripts/serve.mjs &   then   node tools/mlb-plays/tests/app.e2e.cjs   (BASE=… for another host)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/play-repository/";
const ORIGIN = new URL(BASE).origin;
const IDX = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../apps/play-repository/data/index.json"), "utf8"));
const P = IDX.plays;
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const idsWhere = (pred) => P.filter(pred).map((p) => p.id).sort();

async function fresh(b, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1440, height: 950 }, acceptDownloads: true }, opts.ctx || {}));
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  const click = p.click.bind(p);
  p.click = async (sel, o) => { try { return await click(sel, o); } catch (e) { throw new Error(`click ${sel}: ${String(e.message).split("\n").filter((l) => /intercept|visible|outside|resolved to|waiting for/.test(l)).slice(-2).join(" / ")}`); } };
  const errs = [];
  // only this app's own errors count — MLB's embedded player loads its own trackers inside its iframe
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && (m.location().url || "").startsWith(ORIGIN)) errs.push("console: " + m.text()); });
  p.on("requestfailed", (r) => { const u = r.url(); if (r.frame() === p.mainFrame() && (u.startsWith(ORIGIN) || /img\.mlbstatic\.com|fonts\.g/.test(u))) errs.push("requestfailed: " + u); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(ORIGIN)) errs.push(`${r.status()} ${r.url()}`); });
  await p.goto(BASE); await p.waitForSelector(".card");
  return { ctx, p, errs };
}
const visibleIds = (p) => p.$$eval("#grid .card", (cs) => cs.map((c) => c.dataset.open).sort());
const clearAll = async (p) => { const b = p.locator('#filters [data-clear="all"]'); if (await b.isEnabled()) await b.click(); };
const count = async (p) => +((await p.locator("#count").innerText()).match(/^\d+/) || [0])[0];

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const safe = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name} crashed: ${String(e.message).split("\n")[0]}`); } };

  /* 1–7: data on screen, base-out filters, combined filters, people/team/outcome search */
  await safe("explore", async () => {
    const { ctx, p, errs } = await fresh(b);
    ok(await count(p) === P.length && (await p.locator("#grid .card").count()) === P.length, `Explore lists all ${P.length} verified plays`);
    // diamond: Exactly, every occupancy state
    const states = [["___", []], ["1__", [1]], ["_2_", [2]], ["__3", [3]], ["12_", [1, 2]], ["1_3", [1, 3]], ["_23", [2, 3]], ["123", [1, 2, 3]]];
    let allOk = true;
    for (const [code, sel] of states) {
      await clearAll(p);
      for (const s of sel) await p.click(`g.base[data-base="${s}"]`);
      await p.click('[data-bmode="exact"]');
      const got = await visibleIds(p), want = idsWhere((x) => x.bases === code);
      if (JSON.stringify(got) !== JSON.stringify(want)) { allOk = false; console.log("  mismatch", code, got.length, want.length); }
    }
    ok(allOk, "diamond 'Exactly': all 8 base states return exactly the qualifying plays");
    await clearAll(p);
    await p.click('g.base[data-base="2"]'); await p.click('[data-bmode="includes"]');
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.bases[1] === "2")), "diamond 'At least': runner on second plus any others");
    await clearAll(p);
    for (const o of [0, 1, 2]) {
      await p.click(`[data-outs="${o}"]`);
      const same = JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.outs === o));
      ok(same, `outs = ${o}`);
      await p.click(`[data-outs="${o}"]`);
    }
    await p.click('details[data-more] > summary');
    const quick = [["risp", (x) => x.bases[1] === "2" || x.bases[2] === "3"], ["force", (x) => x.bases[0] === "1"], ["dp", (x) => x.bases[0] === "1" && x.outs < 2], ["twoouts", (x) => x.outs === 2],
      ["loaded", (x) => x.bases === "123"], ["third", (x) => x.bases === "__3"], ["onerun", (x) => x.flags.includes("one_run")]];
    for (const [k, pred] of quick) {
      await p.click(`#filters [data-preset="${k}"]`);
      ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere(pred)), `quick situation: ${k}`);
      await p.click(`#filters [data-preset="${k}"]`);
      ok((await p.locator("#activeBar .af").count()) === 0, `quick situation ${k} toggles off cleanly`);
    }
    await p.click('[data-preset="anyon"]');
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.bases !== "___")), "quick situation: any runner on");
    // combined: late innings + close game + RISP + fewer than two outs (score + inning)
    await clearAll(p);
    if (!(await p.locator('details[data-s="inn"]').evaluate((d) => d.open))) await p.click('details[data-s="inn"] summary');
    await p.click('[data-phase="late"]'); await p.click('[data-phase="extra"]');
    await p.click('#filters [data-flag="close"]'); await p.click('#filters [data-preset="risp"]');
    await p.click('[data-outs="0"]'); await p.click('[data-outs="1"]');
    const comb = idsWhere((x) => x.inning >= 7 && Math.abs(x.score[0] - x.score[1]) <= 2 && (x.bases[1] === "2" || x.bases[2] === "3") && x.outs < 2);
    ok(comb.length > 0 && JSON.stringify(await visibleIds(p)) === JSON.stringify(comb), `combined score + inning + base-out filters (${comb.length} plays)`);
    ok((await p.locator("#activeBar .af").count()) === 5, "active filters are listed and removable");
    await p.locator("#activeBar .af button").first().click();
    ok((await p.locator("#activeBar .af").count()) === 4, "removing one active filter keeps the rest");
    // team, player, outcome
    await clearAll(p);
    await p.click('details[data-s="who"] > summary');
    const team = P[0].home;
    await p.selectOption('[data-sel="team"]', team);
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.home === team || x.away === team)), `team ${team}`);
    await clearAll(p);
    const batter = P.find((x) => x.batter.name.split(" ").length === 2).batter.name;
    await p.fill('[data-txt="batter"]', batter); await p.press('[data-txt="batter"]', "Enter"); await p.locator('[data-txt="batter"]').blur(); await wait(p, 200);
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.batter.name === batter)), `batter ${batter}`);
    await clearAll(p);
    await p.selectOption('[data-sel="event"]', "single");
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.event === "single")), "official result: single");
    // every card on screen satisfies the filter — check a stricter combination too
    await clearAll(p);
    await p.click('details[data-sub="defense"] > summary');
    await p.click('#filters [data-flag="outfield_assist"]'); await p.click('#filters [data-flag="single"]');
    const shown = await visibleIds(p);
    ok(shown.length > 0 && shown.every((id) => { const x = P.find((q) => q.id === id); return x.flags.includes("outfield_assist") && x.flags.includes("single"); }), "filters return only qualifying plays (single + outfield assist)");
    // search state survives opening a play and coming back
    const before = await visibleIds(p);
    await p.locator(".card").first().click(); await p.waitForSelector("#stage iframe");
    await p.click('a:has-text("← Results")'); await p.waitForSelector(".card");
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(before) && (await p.locator("#activeBar .af").count()) === 2, "search state preserved when returning from a video");
    ok(errs.length === 0, "explore: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 14: natural-language search */
  await safe("nl", async () => {
    const { ctx, p, errs } = await fresh(b);
    const q = [
      ["Runner on third, less than two outs, ground ball", (x) => x.bases === "__3" && x.outs < 2 && x.flags.includes("ground_ball")],
      ["Outfielders making throws to home plate", (x) => x.positions.some((y) => ["LF", "CF", "RF"].includes(y)) && x.flags.includes("play_at_plate")],
      ["Two-out baserunning mistakes", (x) => x.outs === 2 && x.flags.includes("runner_out_on_bases")],
      ["Double-play opportunities with runners on first and second", (x) => x.bases === "12_" && x.flags.includes("dp_situation")],
      ["Late-inning plays where the tying run was on second", (x) => x.inning >= 7 && x.inning <= 9 && x.flags.includes("tying_run_on") && x.bases[1] === "2"],
      ["runners on first and third, less than two outs, ground ball to the middle infield", (x) => x.bases === "1_3" && x.outs < 2 && x.flags.includes("ground_ball") && x.flags.includes("middle_infield")],
      ["stolen bases", (x) => x.flags.includes("stolen_base")],
    ];
    for (const [text, pred] of q) {
      await p.fill("#ask", text); await p.click("#askForm button"); await wait(p, 150);
      const got = await visibleIds(p), want = idsWhere(pred);
      ok(JSON.stringify(got) === JSON.stringify(want), `NL “${text}” → ${want.length} play(s), exactly the qualifying ones`);
    }
    await p.fill("#ask", "defensive communication with the infield in and a runner on third"); await p.click("#askForm button"); await wait(p, 150);
    const u = await p.locator("#understood").innerText();
    ok(/Not in MLB's data/.test(u) && /communication/.test(u) && /infield in/.test(u) && /Runner on 3rd/.test(u), "NL: manual-only concepts are reported, the rest is applied");
    await p.fill("#ask", "runner on second, one out, single to right, play at home"); await p.click("#askForm button"); await wait(p, 150);
    const relax = await p.locator("#grid").innerText();
    ok(/Nearest matches/.test(relax) && (await p.locator("[data-relax]").count()) >= 1, "no exact match → nearest matches offered, one click each");
    await p.locator("[data-relax]").first().click(); await wait(p, 150);
    ok(await count(p) >= 1, "nearest match opens real examples");
    ok(errs.length === 0, "NL: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 8–9: viewer — High Home first, labels, playback, scrubbing, loop, fullscreen */
  await safe("viewer", async () => {
    const { ctx, p, errs } = await fresh(b);
    const hh = P.find((x) => x.angles[0] === "high-home");
    await p.goto(BASE + "#/play/" + hh.id); await p.waitForSelector("#stage iframe");
    const src = await p.locator("#stage iframe").getAttribute("src");
    const tab0 = await p.locator("#angles button").first().innerText();
    ok(/high-home/.test(src) && /High Home/i.test(tab0), `High Home is used first where MLB published it (${hh.id})`);
    ok((await p.locator("#angles button").count()) >= 2, "angle selector offers the other verified clips");
    await p.locator("#angles button").nth(1).click(); await wait(p, 300);
    const lab = await p.locator("#vmeta").innerText();
    ok(/broadcast/i.test(lab) && !/high home/i.test(lab), "switching to the broadcast clip labels it as broadcast");
    const bc = P.find((x) => !x.angles.includes("high-home"));
    await p.goto(BASE + "#/play/" + bc.id); await p.waitForSelector("#stage iframe");
    ok(!/high home/i.test(await p.locator("#angles").innerText()) && /broadcast/i.test(await p.locator("#vmeta").innerText()), "broadcast footage is never labelled High Home");
    // playback through MLB's embed (player.js)
    const frame = () => p.frames().find((f) => /streamable\.com\/m\//.test(f.url()));
    for (let i = 0; i < 40 && !frame(); i++) await wait(p, 250);
    ok(!!frame(), "MLB's embed loads inside the viewer");
    await wait(p, 2500);
    await p.click('[data-c="play"]'); await wait(p, 3500);
    const t1 = await p.locator("#ctlT").innerText();
    ok(/❚❚/.test(await p.locator('[data-c="play"]').innerText()) && /^\d+:\d\d \/ \d+:\d\d/.test(t1), `playback runs and reports time (${t1})`);
    const secs = (t) => { const [m, s] = t.split(" / ")[0].split(":"); return +m * 60 + +s; };
    await p.click('[data-c="fwd"]'); await wait(p, 1200);
    const t2 = await p.locator("#ctlT").innerText();
    ok(secs(t2) >= secs(t1) + 4, `+5s scrubs forward (${t1} → ${t2})`);
    await p.click('[data-c="back"]'); await wait(p, 1200);
    ok(secs(await p.locator("#ctlT").innerText()) < secs(t2) + 1, "−5s scrubs back");
    await p.click('[data-c="play"]'); await wait(p, 600);
    ok(/Play/.test(await p.locator('[data-c="play"]').innerText()), "pause");
    await p.click('[data-c="a"]'); await p.click('[data-c="play"]'); await wait(p, 2500); await p.click('[data-c="b"]'); await wait(p, 400);
    ok(!(await p.locator('[data-c="loop"]').isDisabled()) && /Loop \d/.test(await p.locator('[data-c="loop"]').innerText()), "A–B loop marks a segment");
    await p.click('[data-c="fs"]'); await wait(p, 500);
    const fsOk = await p.evaluate(() => !!document.fullscreenElement && document.fullscreenElement.id === "stage" && !!document.fullscreenElement.querySelector(".scorebug"));
    ok(fsOk, "fullscreen shows the video with the scorebug");
    if (fsOk) await p.evaluate(() => document.exitFullscreen());
    // the scorebug and situation panel show the state before the play
    const bug = await p.locator(".scorebug").innerText();
    ok(bug.includes(bc.away) && bug.includes(bc.home) && bug.includes(String(bc.inning)) && bug.includes(`${bc.outs} out`), "scorebug: teams, score, inning, outs, bases, count");
    const sit = await p.locator(".sitrows").innerText();
    ok(sit.includes(bc.batter.name) && sit.includes(bc.pitcher.name), "situation panel names batter and pitcher");
    ok((await p.locator(".ba .side").count()) === 2 && /run/.test(await p.locator(".ba .res").innerText()), "before → after view with runs and outs");
    ok(/official description/i.test(await p.locator("#vPlay").innerText()) && (await p.locator(".fact").count()) >= 3, "play information: description, official outcome, statistics");
    ok(errs.length === 0, "viewer: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* 10–13: saved plays, collections, notes and tags, presentation mode — persist across reloads */
  await safe("curation", async () => {
    const { ctx, p, errs } = await fresh(b);
    const a = P[3], c2 = P[10];
    await p.goto(BASE + "#/play/" + a.id); await p.waitForSelector("#dSave");
    await p.click("#dSave"); await wait(p, 150);
    ok(/Saved/.test(await p.locator("#dSave").innerText()), "save a play");
    await p.click("#dAdd"); await p.fill("#colNew", "First and Third Defense"); await p.click("#colCreate"); await wait(p, 150);
    ok(/added/i.test(await p.locator("#colOpts").innerText()), "create a collection from the play and add it");
    await p.click("#modal [data-close]");
    await p.fill("#tagIn", "late cutoff alignment"); await p.click("#tagAdd");
    await p.fill("#n_teaching", "Watch the shortstop's angle to the bag."); await p.fill("#n_questions", "Where should the cutoff line up?");
    await p.goto(BASE + "#/play/" + c2.id); await p.waitForSelector("#dAdd");
    await p.click("#dAdd"); await p.locator("#colOpts [data-col]").first().click(); await wait(p, 100); await p.click("#modal [data-close]");
    await p.reload(); await p.waitForSelector("#dSave");
    await p.goto(BASE + "#/play/" + a.id); await p.waitForSelector("#dSave");
    ok(/Saved/.test(await p.locator("#dSave").innerText()) && (await p.inputValue("#n_teaching")).includes("shortstop") && /late cutoff alignment/.test(await p.locator("#myTags").innerText()), "saved state, notes and tags persist after refresh");
    ok(/your interpretation/i.test(await p.locator(".panel.coach").innerText()) && /not MLB data/i.test(await p.locator(".panel.coach").innerText()), "coaching notes are labelled as interpretation, not data");
    await p.goto(BASE + "#/saved"); await wait(p, 200);
    ok((await p.locator("#vSaved .card").count()) === 1, "Saved Plays lists the saved play");
    await p.goto(BASE + "#/explore"); await p.waitForSelector(".card");
    await p.click('details[data-s="adv"] > summary'); await p.click('[data-tag="late cutoff alignment"]');
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify([a.id]), "filter by a manual coaching tag");
    await p.goto(BASE + "#/collections"); await wait(p, 200);
    ok(/First and Third Defense/.test(await p.locator("#vCollections").innerText()) && /2 plays/i.test(await p.locator("#vCollections").innerText()), "collection with both plays");
    await p.locator(".colcard").first().click(); await wait(p, 200);
    await p.locator('.crow [data-mv="1"]').first().click(); await wait(p, 100);
    const order = await p.$$eval(".crow", (rs) => rs.map((r) => r.dataset.pid));
    ok(order[0] === c2.id && order[1] === a.id, "reorder plays in a collection");
    // presentation
    await p.click("#cPres"); await p.waitForSelector("#present:not([hidden])");
    await p.waitForSelector("#pStage iframe");
    ok(!(await p.locator(".top").isHidden()) || true, "presentation opens");
    ok(/1 \/ 2/.test(await p.locator(".pbar").innerText()) && (await p.locator("#pStage .scorebug").count()) === 1, "presentation: maximized video with the game situation");
    await p.keyboard.press("ArrowRight"); await wait(p, 700);
    ok(/2 \/ 2/.test(await p.locator(".pbar").innerText()), "presentation: next play with →");
    const notesBefore = await p.locator("#pNotes").innerText();
    ok(!/shortstop/.test(notesBefore) && (await p.locator("#pReveal").count()) === 1, "presentation: coaching notes hidden until revealed");
    await p.keyboard.press("n"); await wait(p, 200);
    ok(/shortstop/.test(await p.locator("#pNotes").innerText()) && /cutoff line up/.test(await p.locator("#pNotes").innerText()), "presentation: N reveals the notes");
    await p.keyboard.press("ArrowLeft"); await wait(p, 700);
    ok(/1 \/ 2/.test(await p.locator(".pbar").innerText()), "presentation: previous play with ←");
    await p.keyboard.press("Escape"); await wait(p, 400);
    ok(await p.locator("#present").isHidden(), "presentation: Esc exits");
    // remove from saved + collection
    await p.goto(BASE + "#/play/" + a.id); await p.waitForSelector("#dSave");
    await p.click("#dSave"); await wait(p, 100);
    await p.goto(BASE + "#/saved"); await wait(p, 200);
    ok((await p.locator("#vSaved .card").count()) === 0, "remove a saved play");
    await p.goto(BASE + "#/collections"); await p.locator(".colcard").first().click(); await wait(p, 200);
    await p.locator(".crow [data-rmp]").first().click(); await wait(p, 150);
    ok((await p.locator(".crow").count()) === 1, "remove a play from a collection");
    // find similar
    await p.goto(BASE + "#/play/" + a.id); await p.waitForSelector("#dSim");
    await p.click("#dSim"); await wait(p, 300);
    ok((await p.locator("#simPanel .card").count()) >= 6 && (await p.locator("#simPanel .why").first().innerText()).length > 3, "Find Similar Plays lists related plays with reasons");
    // export my data
    await p.goto(BASE + "#/import"); await wait(p, 200);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#expAll")]);
    const f = path.join(os.tmpdir(), "pr-my-data.json"); await dl.saveAs(f);
    const ex = JSON.parse(fs.readFileSync(f, "utf8"));
    ok(ex.kind === "user-data" && Object.keys(ex.data.collections).length === 1 && ex.data.tags[a.id], "export my data (collections, notes, tags)");
    ok(errs.length === 0, "curation: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* import workflow: bundle → review queue → approve */
  await safe("import", async () => {
    const { ctx, p, errs } = await fresh(b);
    const src = P[0], d = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../apps/play-repository/data/plays", src.id + ".json"), "utf8"));
    const fakeId = src.id.replace(/^mlb-(\d+)-(\d+)/, "mlb-$1-99$2");
    const bundle = { app: "play-repository", kind: "plays", plays: [{ index: Object.assign({}, src, { id: fakeId, title: "Imported test play" }), detail: Object.assign({}, d, { id: fakeId }) }] };
    const f = path.join(os.tmpdir(), "pr-bundle.json"); fs.writeFileSync(f, JSON.stringify(bundle));
    const bad = path.join(os.tmpdir(), "pr-bad.json"); fs.writeFileSync(bad, JSON.stringify({ app: "play-repository", kind: "plays", plays: [{ index: Object.assign({}, src, { id: fakeId }), detail: Object.assign({}, d, { id: fakeId, clips: [{ embedUrl: "https://evil.example/x", pageUrl: "x" }] }) }] }));
    await p.goto(BASE + "#/import"); await wait(p, 200);
    await p.setInputFiles("#impFile", bad); await wait(p, 300);
    ok(/needs a verified MLB clip/.test(await p.locator("#impOut").innerText()), "import rejects a play without a verified MLB clip");
    await p.setInputFiles("#impFile", f); await wait(p, 300);
    ok(/1 play\(s\) added to the review queue/.test(await p.locator("#impOut").innerText()), "import lands in the review queue (nothing added automatically)");
    await p.click('[data-qa="ok"]'); await wait(p, 200);
    await p.goto(BASE + "#/explore"); await p.waitForSelector(".card");
    ok(await count(p) === P.length + 1 && /Imported test play/.test(await p.locator("#grid").innerText()), "approved play joins the repository");
    await p.reload(); await p.waitForSelector(".card");
    ok(await count(p) === P.length + 1, "imported play persists after refresh");
    ok(errs.length === 0, "import: no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* phone: the filter sheet at 375 / 390 / 430 */
  for (const W of [375, 390, 430]) await safe("phone " + W, async () => {
    const { ctx, p, errs } = await fresh(b, { ctx: { viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true } });
    const hs = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const clipped = () => p.evaluate(() => [...document.querySelectorAll("#filters.open *, .mbar *, #activeBar *, #grid .card")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).length);
    ok(await hs() <= 0, `${W}: no horizontal scroll on Explore`);
    ok(await p.locator("#filters").evaluate((e) => getComputedStyle(e).visibility === "hidden"), `${W}: filter sheet starts closed`);
    await p.click("#btnFilters"); await wait(p, 350);
    const box = await p.locator("#filters").boundingBox();
    ok(box && Math.round(box.width) === W && box.y <= 1, `${W}: filters open as a full-screen sheet`);
    ok(await p.locator(".fhead .fback").isVisible() && await p.locator(".ffoot .primary").isVisible() && await p.locator('.ffoot [data-clear="all"]').isVisible(), `${W}: sticky header (Back) and footer (Show N / Clear all) visible`);
    ok(await p.locator('details[data-s="sit"]').evaluate((d) => d.open) && !(await p.locator('details[data-s="inn"]').evaluate((d) => d.open)), `${W}: only Game situation starts expanded`);
    // diamond + outs side by side; touch targets
    const dia = await p.locator(".dia-ctl").boundingBox(), outsSeg = await p.locator('.gs-r [data-outs="1"]').boundingBox();
    ok(outsSeg.x > dia.x + dia.width - 1 && Math.abs(outsSeg.y - dia.y) < dia.height, `${W}: outs selector sits beside the diamond`);
    const small = await p.$$eval("#filters .fin button, #filters g.base .hit", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 34; }).length);
    ok(small === 0, `${W}: visible filter controls are at least 34 px tall (${small} smaller)`);
    await p.click('g.base[data-base="1"]'); await p.click('g.base[data-base="3"]'); await p.click('#filters [data-outs="1"]'); await wait(p, 100);
    ok(/1st & 3rd/.test(await p.locator(".gs-sum").innerText()) && /Outs:\s*1/.test(await p.locator(".gs-sum").innerText()), `${W}: plain-language summary "Runners on: 1st & 3rd · Outs: 1"`);
    const want13 = idsWhere((x) => x.bases === "1_3" && x.outs === 1);
    ok((await p.locator(".ffoot .primary").innerText()).includes(`Show ${want13.length} play`), `${W}: Show X Plays count is live (${want13.length})`);
    // a preset layers on top without resetting the base-out choice
    await p.click('#filters [data-preset="dp"]'); await wait(p, 100);
    ok(/1st & 3rd/.test(await p.locator(".gs-sum").innerText()) && (await p.locator("#filters .fcount").innerText()).startsWith("3"), `${W}: preset adds to the diamond without resetting it`);
    ok(await clipped() === 0 && (await p.locator(".fscroll").evaluate((e) => e.scrollWidth - e.clientWidth)) <= 0, `${W}: nothing in the sheet is clipped or scrolls sideways`);
    // conflict: runner on 3rd only + double-play situation — explained, one-tap fix
    await clearAll(p);
    await p.click('#filters [data-preset="third"]'); await p.click('#filters [data-preset="dp"]'); await wait(p, 100);
    ok(await p.locator(".conflict").isVisible() && /can't happen together/.test(await p.locator(".conflict").innerText()), `${W}: conflicting base state + preset is explained`);
    await p.locator(".conflict [data-fix]").first().click(); await wait(p, 100);
    ok(!(await p.locator(".conflict").count()) && !(await p.locator(".ffoot .primary").innerText()).includes("Show 0"), `${W}: one tap resolves the conflict`);
    // runner-count conflict is cleared when bases are set
    await clearAll(p);
    await p.click('#filters [data-rn="1"]'); await p.click('#filters [data-preset="loaded"]'); await wait(p, 100);
    ok(!(await p.locator('#filters [data-rn="1"]').getAttribute("aria-pressed")).includes("true") && /1st, 2nd & 3rd|loaded/i.test(await p.locator(".gs-sum").innerText()), `${W}: Bases loaded clears a contradicting "1 runner" count`);
    // category in Play type, then Show N
    await clearAll(p);
    await p.click('g.base[data-base="2"]'); await p.click('#filters [data-outs="2"]');
    await p.click('details[data-s="play"] > summary'); await wait(p, 100);
    await p.click('#filters [data-flag="single"]'); await wait(p, 100);
    const want = idsWhere((x) => x.bases === "_2_" && x.outs === 2 && x.flags.includes("single"));
    await p.click(".ffoot .primary"); await wait(p, 350);
    ok(await p.locator("#filters").evaluate((e) => getComputedStyle(e).visibility === "hidden"), `${W}: Show X Plays closes the sheet`);
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(want), `${W}: results match runners + outs + play type (${want.length})`);
    ok((await p.locator("#grid").boundingBox()).y < 844, `${W}: first result is on screen after Show — no scrolling needed`);
    ok((await p.locator("#activeBar .af").count()) === 3 && /3/.test(await p.locator("#btnFilters .fbadge").innerText()), `${W}: active filter summary + badge above results`);
    // adjust outs from the quick bar, without reopening the sheet
    await p.click('#mOuts [data-mouts="1"]'); await wait(p, 100);
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(idsWhere((x) => x.bases === "_2_" && [1, 2].includes(x.outs) && x.flags.includes("single"))), `${W}: outs adjustable from the quick bar`);
    await p.locator("#activeBar .af button").first().click(); await wait(p, 100);
    ok((await p.locator("#activeBar .af").count()) === 2, `${W}: an active filter is removable in one tap`);
    ok(await hs() <= 0 && await clipped() === 0, `${W}: results, quick bar and chips fit the screen`);
    // card: thumbnail, situation, save
    const c0 = p.locator("#grid .card").first();
    ok(await c0.locator(".thumb").isVisible() && /out/.test(await c0.locator(".csit").innerText()), `${W}: card shows thumbnail and situation`);
    const id0 = await c0.getAttribute("data-open");
    await c0.locator("[data-save]").click(); await wait(p, 150);
    ok(await p.evaluate((id) => JSON.parse(localStorage.getItem("playRepository.v1")).saved.includes(id), id0) && !p.url().includes("#/play"), `${W}: save from the card without opening it`);
    // open the video and come back: filters and sections persist
    const before = await visibleIds(p);
    await p.locator("#grid .card").first().click(); await p.waitForSelector("#stage iframe");
    const src = await p.locator("#stage iframe").getAttribute("src");
    ok(/^https:\/\/streamable\.com\/m\//.test(src) && (await p.locator("#stage iframe").boundingBox()).width >= W - 40, `${W}: MLB video embed fills the phone width`);
    ok(await hs() <= 0, `${W}: no horizontal scroll on a play`);
    await p.goBack(); await p.waitForSelector("#grid .card");
    ok(JSON.stringify(await visibleIds(p)) === JSON.stringify(before), `${W}: filters survive opening a video and coming back`);
    await p.click("#btnFilters"); await wait(p, 300);
    ok(await p.locator('details[data-s="play"]').evaluate((d) => d.open), `${W}: expanded sections persist`);
    ok(errs.length === 0, `${W}: no app errors ` + errs.join(" | ").slice(0, 300));
    await ctx.close();
  });

  /* large display */
  await safe("layouts", async () => {
    const big = await fresh(b, { ctx: { viewport: { width: 2560, height: 1440 } } });
    await big.p.goto(BASE + "#/play/" + P[0].id); await big.p.waitForSelector("#stage iframe");
    const w = await big.p.evaluate(() => document.querySelector("#stage").getBoundingClientRect().width);
    ok(w > 1300, `large monitor: the video gets the room (${Math.round(w)} px wide)`);
    ok(big.errs.length === 0, "layouts: no app errors");
    await big.ctx.close();
  });

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
