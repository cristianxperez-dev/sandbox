/* Baseball Feud 2.0 — browser checks for the video / library / situation workflows.
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node tools/baseball-feud-discovery/tests/app.e2e.cjs
   BASE=https://cperez.app/apps/baseball-feud-2/ for the live site. Fixture clips are synthetic test patterns.
   MLB's embedded player (Streamable) may be unreachable from a test machine: its network errors are ignored, and the
   checks only look at which clip the app chose (the iframe's address), never at MLB's player itself. */
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/baseball-feud-2/";
const FX = path.join(__dirname, "fixtures");
const BCAST = path.join(FX, "broadcast-test.mp4"), IHOME = path.join(FX, "ihome-test.mp4");
const SHOTS = process.env.SHOTS || "";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const shot = (p, n) => SHOTS ? p.screenshot({ path: path.join(SHOTS, n + ".png") }) : null;
const IGNORE = /streamable|ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|socket\.|fonts\.g|mlbstatic|mlb\.com|ERR_ABORTED/i;

async function fresh(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => {});
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errs.push("console: " + m.text()); });
  p.on("requestfailed", (r) => { if (r.url().startsWith(new URL(BASE).origin) && !/blob:/.test(r.url())) errs.push("failed: " + r.url()); });
  await p.goto(BASE); await wait(p, 900);
  await p.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.style.display = "none"; });
  return { ctx, p, errs };
}
/* start the live plays (skip the practice play) and let the intro finish */
async function startLive(p) {
  if (await p.isVisible("#stLive")) await p.click("#stLive"); else await p.click("#stGo");
  await wait(p, 4300);
}
async function nextPlay(p) { await p.keyboard.press("Shift+ArrowRight"); await wait(p, 4200); }
const video = (p) => p.evaluate(() => {
  const gv = document.querySelector("#gv"), f = document.querySelector("#vFrame iframe.emb");
  return { file: !gv.hidden && gv.dataset.url ? gv.dataset.url : "", emb: f ? f.src : "", cap: document.querySelector("#mlbCap").innerText.replace(/\s+/g, " "),
    empty: !document.querySelector("#vEmpty").hidden, angles: [...document.querySelectorAll('#mlbCap [data-g="angle"]')].map((x) => x.dataset.a + (x.classList.contains("on") ? "*" : "")) };
});
const game = (p) => p.evaluate(() => ({
  s0: document.querySelector("#gS0").textContent, s1: document.querySelector("#gS1").textContent, count: document.querySelector("#gCount").textContent,
  title: document.querySelector("#gTitle").textContent, revealed: document.querySelectorAll("#board .tile.rev").length,
  bank: document.querySelector("#gBankV").textContent, strikes: document.querySelectorAll("#gK0 i.on").length + "|" + document.querySelectorAll("#gK1 i.on").length,
  queue: JSON.parse(localStorage.getItem("baseballFeud2.v1")).plays.map((x) => x.title).join(" / "),
}));
const sit = (p) => p.evaluate(() => {
  const st = document.querySelector("#sitStrip");
  const on = [...st.querySelectorAll("svg.ss-dia rect")].map((r) => r.classList.contains("on"));   // order: 1B, 2B, 3B
  return { shown: getComputedStyle(st).display !== "none", bases: on, outs: (st.querySelector(".ss-out b") || {}).textContent || "", dots: st.querySelectorAll(".odots i.on").length,
    inning: (st.querySelector(".ss-inn") || {}).textContent || "", bat: ((st.querySelector(".ss-bat") || {}).textContent || "").replace(/\s+/g, " ").trim(), text: st.innerText.replace(/\s+/g, " ") };
});
async function libFromGame(p) { await p.click('[data-g="lib"]'); await wait(p, 500); }
async function backToGame(p) { await p.click('#bfLib [data-bf="close"]'); await wait(p, 500); }
const cardSel = (id) => `#bfLib [data-card="${id}"]`;
async function choose(p, slot, file) {
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click(`#bfVid .mv-slot[data-drop="${slot}"] [data-bf="mvChoose"]`)]);
  await fc.setFiles(file); await wait(p, 400);
}
const P1 = "wwgw-v1-01-high-home-chaos", P3 = "wwgw-v1-03-three-extra-outs", P4 = "wwgw-v1-04-little-league-walk-off", P8 = "wwgw-v1-08-rundown-that-wouldnt-end", P12 = "wwgw-v1-12-two-runners-one-base";

(async () => {
  const b = await chromium.launch();

  /* ---------- Workflow 1: replace video (library → manage → upload → preview → save → game → play) ---------- */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await startLive(p);
    await nextPlay(p); await nextPlay(p);                              // play 3: Three Extra Outs (broadcast, MLB embed)
    const before = await video(p);
    ok(/streamable\.com\/m\//.test(before.emb), "W1 · play 3 starts on MLB's embedded broadcast clip");
    await libFromGame(p);
    await p.click(`${cardSel(P3)} [data-bf="manage"]`); await wait(p, 400);
    ok(await p.isVisible("#bfVid .mv-slot[data-drop=broadcast]") && await p.isVisible("#bfVid .mv-slot[data-drop=high-home]"), "W1 · Manage Video shows a Broadcast and an iHome / High Home slot");
    ok(await p.isDisabled('#bfVid [data-bf="mvSave"]'), "W1 · Save is disabled until something changes");
    // cancel restores: stage a file, cancel, nothing changed
    await choose(p, "broadcast", BCAST);
    p.once("dialog", (d) => d.accept());       // “Discard these video changes?”
    await p.click('#bfVid [data-bf="mvCancel"]'); await wait(p, 300);
    const stillMlb = await p.evaluate((id) => !JSON.parse(localStorage.getItem("baseballFeud2.library.v1")).plays.find((x) => x.id === id).media.files.broadcast, P3);
    ok(stillMlb && !(await p.isVisible("#bfVid")), "W1 · Cancel after choosing a file restores the play (nothing saved)");
    // replace: choose → preview → save
    await p.click(`${cardSel(P3)} [data-bf="manage"]`); await wait(p, 300);
    await choose(p, "broadcast", BCAST);
    const pv = await p.evaluate(() => { const v = document.querySelector("#bfVid .mv-stage video"); return { src: v && v.src, txt: document.querySelector("#bfVid .mv-pvt").innerText, newRow: !!document.querySelector("#bfVid .mv-new") }; });
    ok(pv.src && pv.src.startsWith("blob:") && /not saved yet/i.test(pv.txt) && pv.newRow, "W1 · the new file previews before saving, marked unsaved");
    await shot(p, "manage-video-staged");
    await p.click('#bfVid [data-bf="mvSave"]'); await wait(p, 600);
    const card = await p.locator(cardSel(P3)).innerText();
    ok(/BROADCAST · YOURS/.test(card), "W1 · the library card shows the uploaded Broadcast clip");
    await backToGame(p);
    const after = await video(p);
    ok(after.file.startsWith("blob:") && /broadcast-test\.mp4/.test(after.cap) && /THIS COMPUTER ONLY/.test(after.cap) && !after.emb, "W1 · back in the game, play 3 now plays the uploaded file, labelled 'this computer only'");
    await p.click("#bPlay"); await wait(p, 1200);
    const t = await p.evaluate(() => ({ t: document.querySelector("#gv").currentTime, err: document.querySelector("#gv").error }));
    ok(t.t > 0.3 && !t.err, `W1 · the uploaded MP4 plays in the round (t=${t.t.toFixed(2)}s)`);
    // persistence: reload — the upload comes back from this browser's storage
    await p.reload(); await wait(p, 1200);
    await p.click("#stGo"); await wait(p, 4300);                   // resume
    const re = await video(p);
    ok(/PLAY 3 OF/.test((await game(p)).count) && re.file.startsWith("blob:") && /broadcast-test\.mp4/.test(re.cap), "W1 · after a reload the game resumes on play 3 with the uploaded clip");
    ok(errs.length === 0, "W1 · no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* ---------- Workflow 2: add iHome to a broadcast-only play; default; fallback; switch back ---------- */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await startLive(p);
    await nextPlay(p); await nextPlay(p); await nextPlay(p);          // play 4: Little League Walk-Off (broadcast only)
    ok(/streamable/.test((await video(p)).emb) && (await video(p)).angles.length === 0, "W2 · play 4 is broadcast-only (no angle switcher)");
    await libFromGame(p);
    await p.click(`${cardSel(P4)} [data-bf="manage"]`); await wait(p, 300);
    await choose(p, "high-home", IHOME);
    const radios = await p.evaluate(() => [...document.querySelectorAll('#bfVid input[name="mvdef"]')].map((r) => r.value + (r.disabled ? ":off" : ":on")));
    ok(radios.join() === "broadcast:on,high-home:on", "W2 · both angles can be set as the game default once iHome is attached");
    await p.check('#bfVid input[name="mvdef"][value="high-home"]'); await wait(p, 200);
    ok(/Games play HIGH HOME/i.test(await p.locator("#bfVid .mv-uses").innerText()), "W2 · the panel says games will play High Home");
    ok((await p.locator('#bfVid .mv-slot[data-drop="broadcast"]').innerText()).includes("MLB.COM"), "W2 · the Broadcast clip is still there (never overwritten)");
    await p.click('#bfVid [data-bf="mvSave"]'); await wait(p, 600);
    const lib = await p.evaluate((id) => JSON.parse(localStorage.getItem("baseballFeud2.library.v1")).plays.filter((x) => x.id === id), P4);
    ok(lib.length === 1 && lib[0].media.def === "high-home" && lib[0].media.files["high-home"].name === "ihome-test.mp4" && lib[0].video.embedUrl, "W2 · one play record (no duplicate) holds both angles, default High Home");
    ok(/BROADCAST/.test(await p.locator(cardSel(P4)).innerText()) && /HIGH HOME · YOURS/.test(await p.locator(cardSel(P4)).innerText()), "W2 · the card lists Broadcast + High Home");
    await shot(p, "library-desktop");
    await backToGame(p);
    let v = await video(p);
    ok(/ihome-test\.mp4/.test(v.cap) && v.file.startsWith("blob:") && v.angles.join() === "broadcast,high-home*", "W2 · gameplay uses the iHome clip, with a Broadcast / High Home switcher");
    await shot(p, "game-desktop-ihome");
    await p.click('#mlbCap [data-g="angle"][data-a="broadcast"]'); await wait(p, 400);
    v = await video(p);
    ok(/streamable/.test(v.emb) && !v.file && v.angles.join() === "broadcast*,high-home", "W2 · switching to Broadcast in the round shows MLB's broadcast clip");
    await p.click('#mlbCap [data-g="angle"][data-a="high-home"]'); await wait(p, 300);
    ok(/ihome-test/.test((await video(p)).cap), "W2 · …and back to High Home");
    // remove the iHome file → the default falls back to Broadcast
    await p.click('#mlbCap [data-g="manage"]'); await wait(p, 300);
    await p.click('#bfVid .mv-slot[data-drop="high-home"] [data-bf="mvRemove"]'); await wait(p, 200);
    ok(/Games play BROADCAST/i.test(await p.locator("#bfVid .mv-uses").innerText()), "W2 · with iHome removed, the panel says games fall back to Broadcast");
    await p.click('#bfVid [data-bf="mvSave"]'); await wait(p, 500);
    v = await video(p);
    ok(/streamable/.test(v.emb) && v.angles.length === 0, "W2 · the round falls back to Broadcast without iHome");
    ok((await game(p)).count === "PLAY 4 OF 4", "W2 · still on play 4 — replacing video never resets the round");
    ok(errs.length === 0, "W2 · no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* ---------- Workflow 3: find the original play ---------- */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await p.click("#stLib"); await wait(p, 500);
    const count = () => p.locator("#bfLib .bf-card").count();
    const all = await count();
    await p.fill('[data-bfin="q"]', "BETTS"); await wait(p, 200);
    ok((await count()) === 2, "W3 · search by player name, case-insensitive (Betts is in two plays)");
    await p.fill('[data-bfin="q"]', "betts cole"); await wait(p, 200);
    ok((await count()) === 1 && /Three Extra Outs/i.test(await p.locator("#bfLib .bf-card").innerText()), "W3 · batter + pitcher narrows to one play");
    for (const [q, n, what] of [["NYY", 1, "team abbreviation"], ["Yankees", 1, "team name"], ["2024-10-30", 1, "date"], ["168b5f9b", 1, "MLB play ID"], ["775296", 1, "game ID"], ["Gerrit Cole", 1, "pitcher"], ["dodgers", 3, "team (several plays)"], ["schmit", 1, "partial name"], ["bottom 9th", 2, "inning"]]) {
      await p.fill('[data-bfin="q"]', q); await wait(p, 150);
      ok((await count()) === n, `W3 · search by ${what} “${q}” → ${n}`);
    }
    await p.fill('[data-bfin="q"]', "betts cole"); await wait(p, 150);
    await p.click('#bfLib .bf-card [data-bf="find"]'); await wait(p, 400);
    const det = await p.locator("#bfDet .bf-det").innerText();
    const has = (k, v) => new RegExp(k + "\\s*" + v, "i").test(det.replace(/\s+/g, " "));
    ok(has("Game date", "October 30, 2024") && has("Inning", "Top 5th") && has("Outs before play", "2") && has("Runners before play", "Bases loaded"), "W3 · details: date, inning, outs, runners before the play");
    ok(has("Pitcher", "Gerrit Cole") && has("Batter", "Mookie Betts") && has("MLB game ID \\(gamePk\\)", "775296") && has("MLB play ID", "168b5f9b") && has("Score before play", "LAD 0, NYY 5"), "W3 · details: batter, pitcher, gamePk, play ID, score");
    ok(has("Batting team", "Los Angeles Dodgers") && has("Fielding team", "New York Yankees") && has("Play result", "Single") && has("Matchup", "LAD @ NYY"), "W3 · details: batting / fielding team, result, matchup");
    await p.click('#bfDet .bf-det [data-bf="copy"]'); await wait(p, 300);
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    ok(clip === "2024-10-30 LAD @ NYY Top 5th 2 outs Mookie Betts vs Gerrit Cole", `W3 · COPY SEARCH copies “${clip}”`);
    ok(await p.locator('#bfDet .bf-det a[href*="baseballsavant.mlb.com/sporty-videos?playId=168b5f9b"]').count() === 1, "W3 · the stored, verified Baseball Savant link is offered");
    await shot(p, "library-details");
    // the list keeps its place under the panel
    ok(await p.locator("#bfLib .bf-card").count() === 1 && await p.isVisible("#bfLib .bf-card"), "W3 · the list stays in place under the details panel");
    // filters
    await p.fill('[data-bfin="q"]', ""); await wait(p, 150);
    await p.selectOption('[data-bfin="video"]', "ihome"); await wait(p, 150);
    ok((await count()) === 2, "W3 · filter: iHome / High Home available → the 2 High Home plays");
    await p.selectOption('[data-bfin="video"]', "broadcast"); await wait(p, 150);
    ok((await count()) === all - 2, "W3 · filter: broadcast only");
    await p.selectOption('[data-bfin="video"]', "missing"); await wait(p, 150);
    ok((await count()) === 0, "W3 · filter: missing video → none");
    await p.selectOption('[data-bfin="video"]', ""); await p.check('[data-bfin="inGame"]'); await wait(p, 150);
    ok((await count()) === 4, "W3 · filter: plays selected for the game → 4");
    ok(errs.length === 0, "W3 · no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* ---------- Workflow 4: library ↔ game keeps the game exactly as it was ---------- */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    await startLive(p);
    await nextPlay(p);                                               // play 2
    await p.keyboard.press("1"); await wait(p, 900); await p.keyboard.press("2"); await wait(p, 900);
    await p.keyboard.press("x"); await wait(p, 2200);
    const g0 = await game(p);
    ok(g0.revealed === 2 && g0.count === "PLAY 2 OF 4", "W4 · mid-round: play 2, two answers revealed, one strike");
    await libFromGame(p);
    ok(/NOW PLAYING/.test(await p.locator("#bfLib .bf-nowbar").innerText()) && await p.locator(`${cardSel("wwgw-v1-02-the-wheel")}.now`).count() === 1, "W4 · the library highlights the play on screen");
    ok(/BACK TO GAME/.test(await p.locator('#bfLib [data-bf="close"]').innerText()), "W4 · an obvious Back to Game button");
    // keys pressed in the library never reach the game
    await p.fill('[data-bfin="q"]', "x 3"); await p.keyboard.press("Enter"); await p.fill('[data-bfin="q"]', "");
    await p.click("#bfLib .bf-hh h2"); for (const k of ["x", "3", "a", "ArrowRight", "u", "r"]) await p.keyboard.press(k);
    // edit the current play's video, add a play, try to replace the play on screen (locked), replace an upcoming one
    await p.click('#bfLib [data-bf="manageNow"]'); await wait(p, 300);
    await choose(p, "high-home", IHOME); await p.click('#bfVid [data-bf="mvSave"]'); await wait(p, 500);
    await p.click(`${cardSel(P8)} [data-bf="use"]`); await wait(p, 200);
    const use = await p.locator(`${cardSel(P8)} .bf-use`).innerText();
    ok(/1\. .*\n?.*PLAYED/i.test(use.replace(/\n/g, " ")) || /PLAYED/i.test(use), "W4 · Use in Game marks played plays as locked");
    ok(/play 2[^\n]*\n?\s*(STARTED|ON NOW)/i.test(use.replace(/^\d\. /gm, (m) => "play " + m)) || /STARTED|ON NOW/i.test(use.split("\n").find((l) => /^2\./.test(l)) || ""), "W4 · …and the play on screen (already started) as locked");
    ok(await p.locator(`${cardSel(P8)} .bf-ur li:nth-child(2) [data-bf="useReplace"]`).count() === 0, "W4 · the play on screen can't be replaced");
    p.once("dialog", (d) => d.accept());
    await p.click(`${cardSel(P8)} .bf-ur li:nth-child(4) [data-bf="useReplace"]`); await wait(p, 400);
    await p.click(`${cardSel(P12)} [data-bf="use"]`); await wait(p, 200);
    await p.click(`${cardSel(P12)} [data-bf="useAdd"]`); await wait(p, 400);
    await backToGame(p);
    const g1 = await game(p);
    ok(g1.s0 === g0.s0 && g1.s1 === g0.s1 && g1.bank === g0.bank, `W4 · scores and Round Bank unchanged (${g1.s0}–${g1.s1}, bank ${g1.bank})`);
    ok(g1.strikes === g0.strikes, "W4 · strikes unchanged");
    ok(g1.revealed === 2 && g1.title === g0.title, "W4 · same play, same two answers revealed — nothing revealed by accident");
    ok(g1.count === "PLAY 2 OF 5" && /The Rundown That Wouldn.t End/i.test(g1.queue.split(" / ")[3]) && /Two Runners, One Base/i.test(g1.queue.split(" / ")[4]) && g1.queue.split(" / ").slice(0, 3).join() === g0.queue.split(" / ").slice(0, 3).join(),
      "W4 · queue: plays 1–3 kept, upcoming play 4 replaced on purpose, a 5th added");
    ok(/ihome-test/.test((await video(p)).cap), "W4 · the play on screen now shows the video edited in the library");
    ok(errs.length === 0, "W4 · no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* ---------- Workflow 5: the base-out state before each play ---------- */
  await (async () => {
    const { ctx, p, errs } = await fresh(b);
    // a test-only play with runners on 1st and 3rd and two outs (the library has no such real play); imported into the review queue
    const fixture = { plays: [{ id: "test-first-third-two-outs", title: "Test — first and third, two outs", answers: [{ text: "A" }, { text: "B" }],
      situation: { teams: "Houston Astros at Seattle Mariners", date: "2025-08-14", inning: "Top 7th", outs: 2, bases: { "1B": true, "2B": false, "3B": true }, score: "HOU 3, SEA 2", batter: "Test Batter", pitcher: "Test Pitcher", batting: "Houston Astros", fielding: "Seattle Mariners", awayAbbr: "HOU", homeAbbr: "SEA" },
      video: {}, verification: { status: "test" } }] };
    await p.click("#stLib"); await wait(p, 400);
    await p.click('#bfLib [data-bf="tab"][data-v="find"]');
    const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click('#bfLib [data-bf="import"]')]);
    await fc.setFiles({ name: "test.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) }); await wait(p, 300);
    await p.click('#bfLib [data-bf="approve"]'); await wait(p, 300);
    // a new game: bases empty 0 out · runner on 1st 1 out · 1st and 3rd 2 outs · bases loaded 1 out
    await p.click('#bfLib [data-bf="close"]'); await wait(p, 300);
    await p.click("#stGames"); await wait(p, 300); await p.click('[data-bf="newGame"]'); await wait(p, 300);
    await p.click('#bfLib [data-bf="tab"][data-v="plays"]'); await wait(p, 200);
    for (const id of [P4, P12, "test-first-third-two-outs", P1]) await p.click(`${cardSel(id)} [data-bf="pick"]`);
    await p.fill('[data-bfin="gname"]', "Situations test"); await p.click('[data-bf="create"]'); await wait(p, 600);
    await p.click("#bPresent"); await wait(p, 600);
    await startLive(p);
    const expect = [
      ["bases empty, 0 outs", [false, false, false], "0 OUTS", 0, "BOT 9TH", "SF BATTING · TEX IN FIELD"],
      ["runner on first, 1 out", [true, false, false], "1 OUT", 1, "BOT 3RD", "MIN BATTING · CWS IN FIELD"],
      ["first and third, 2 outs", [true, false, true], "2 OUTS", 2, "TOP 7TH", "HOU BATTING · SEA IN FIELD"],
      ["bases loaded, 1 out", [true, true, true], "1 OUT", 1, "TOP 4TH", "LAD BATTING · MIL IN FIELD"],
    ];
    for (let i = 0; i < expect.length; i++) {
      const [name, bases, outs, dots, inn, bat] = expect[i], s = await sit(p);
      ok(s.shown && s.bases.join() === bases.join() && s.outs === outs && s.dots === dots && s.inning === inn && s.bat === bat,
        `W5 · play ${i + 1}: ${name} — ${s.inning} · ${s.outs} · bases ${s.bases.map((x) => (x ? "●" : "○")).join("")} · ${s.bat}`);
      if (i === 2) { ok(/HOU 3/.test(s.text) && /SEA 2/.test(s.text), "W5 · score before the play shown (HOU 3 – SEA 2)"); await shot(p, "game-situation"); }
      if (i < expect.length - 1) await nextPlay(p);
    }
    await p.keyboard.press("ArrowLeft"); await wait(p, 4200);
    ok((await sit(p)).bat === "HOU BATTING · SEA IN FIELD", "W5 · going back a play restores that play's situation");
    ok(errs.length === 0, "W5 · no app errors " + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  /* ---------- phones ---------- */
  for (const W of [375, 390, 430]) await (async () => {
    const { ctx, p, errs } = await fresh(b, { viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true });
    const hs = () => p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll(".bf2-ov:not([hidden])")].map((o) => o.scrollWidth)) - innerWidth);
    await p.click("#stLib"); await wait(p, 400);
    ok((await hs()) <= 0, `${W}: library fits the screen`);
    if (W === 390) await shot(p, "library-390");
    await p.click(`${cardSel(P3)} [data-bf="details"]`); await wait(p, 300);
    const box = await p.locator("#bfDet .bf-det").boundingBox();
    ok(box && box.width <= W && box.x >= 0 && box.y === 0 && box.height >= 840, `${W}: details panel fits and covers the screen (stays put while the list scrolls)`);
    if (W === 390) await shot(p, "details-390");
    await p.click('#bfDet .bf-det [data-bf="manage"]'); await wait(p, 400);
    ok((await hs()) <= 0, `${W}: Manage Video fits`);
    if (W === 390) await shot(p, "manage-390");
    ok(errs.length === 0, `${W}: no app errors ` + errs.join(" | ").slice(0, 300));
    await ctx.close();
  })();

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
