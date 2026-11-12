/* Baseball Feud 2.0 — the default game (apps/baseball-feud-2/games/default-game.js).
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node tools/baseball-feud-discovery/tests/default-game.e2e.cjs
   BASE=https://cperez.app/apps/baseball-feud-2/ for the live site. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/baseball-feud-2/";
/* whichever export games/default-game.js was generated from (games/make-default.mjs) */
global.window = global.window || {}; require(path.join(__dirname, "../../../apps/baseball-feud-2/games/default-game.js"));
const DEF = window.BF2_DEFAULT_GAME;
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../apps/baseball-feud-2", DEF.file), "utf8"));
const DEF_ID = DEF.id;
const IGNORE = /streamable|ERR_TUNNEL|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|socket\.|fonts\.g|mlbstatic|mlb\.com|ERR_ABORTED/i;
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
async function gamesUI(p) {
  if (await p.isVisible("#bfGames")) return;
  if (await p.isVisible("#stGames")) await p.click("#stGames");
  else { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press("g"); }
  await wait(p, 500);
  if (!(await p.isVisible("#bfGames"))) { await p.evaluate(() => document.querySelector("#bGames").click()); await wait(p, 500); }
}
const LS = (p) => p.evaluate(() => ({ cur: JSON.parse(localStorage.getItem("baseballFeud2.v1") || "null"), games: JSON.parse(localStorage.getItem("baseballFeud2.games.v1") || "[]") }));
async function open(ctx, errs) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errs.push("console: " + m.text()); });
  await p.goto(BASE); await wait(p, 1200);
  await p.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.style.display = "none"; });
  return p;
}
/* the file's generic "WHAT WENT WRONG?" is read as the app's current default question; any other wording stays as written */
const promptOf = (q) => (String(q || "").trim().toUpperCase() === "WHAT WENT WRONG?" ? "WHAT DO YOU SEE?" : q);
const sameContent = (cur) => {
  const errs = [];
  if (cur.sessionName !== SRC.sessionName) errs.push("name");
  if (cur.plays.length !== SRC.plays.length) errs.push("play count");
  SRC.plays.forEach((s, i) => {
    const g = cur.plays[i] || {};
    for (const k of ["id", "title", "videoName"]) if (g[k] !== s[k]) errs.push(`play ${i + 1} ${k}`);
    if (g.prompt !== promptOf(s.prompt)) errs.push(`play ${i + 1} prompt`);
    for (const k of ["libId", "embedUrl", "pageUrl", "title", "situation"]) if ((g.mlb || {})[k] !== s.mlb[k]) errs.push(`play ${i + 1} mlb.${k}`);
    if (JSON.stringify(g.mlb.angle) !== JSON.stringify(s.mlb.angle)) errs.push(`play ${i + 1} angle`);
    if (s.mlb.sit === null ? g.mlb.sit !== null : false) errs.push(`play ${i + 1} sit`);
    for (const [k, v] of Object.entries(s.mlb.sit || {})) if (JSON.stringify(g.mlb.sit[k]) !== JSON.stringify(v)) errs.push(`play ${i + 1} sit.${k}`);
    if (JSON.stringify(g.observations.map((o) => [o.text, o.points, o.note])) !== JSON.stringify(s.observations.map((o) => [o.text, o.points, o.note || ""]))) errs.push(`play ${i + 1} answers`);
  });
  const pp = cur.practice.play;
  if (cur.practice.enabled !== SRC.practice.enabled || pp.title !== SRC.practice.play.title || pp.prompt !== promptOf(SRC.practice.play.prompt) ||
      JSON.stringify(pp.observations.map((o) => [o.text, o.points])) !== JSON.stringify(SRC.practice.play.observations.map((o) => [o.text, o.points]))) errs.push("practice");
  if (cur.fastMoney.seconds !== SRC.fastMoney.seconds || JSON.stringify(cur.fastMoney.questions.map((q) => [q.q, q.answer, q.points])) !== JSON.stringify(SRC.fastMoney.questions.map((q) => [q.q, q.answer, q.points]))) errs.push("fast money");
  return errs;
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });

  // 1–2. first visit: the default game, complete and faithful
  let p = await open(ctx, errs);
  let { cur, games } = await LS(p);
  ok(cur && cur.gameId === DEF_ID && cur.ui.mode === "game", `first visit opens the default game (${cur && cur.gameId}) ready to play`);
  const c1 = sameContent(cur); ok(c1.length === 0, "every play, answer, point value, note, video reference, angle, situation, practice play and Fast Money question matches the file " + c1.join(", "));
  ok(JSON.stringify(cur.settings) === JSON.stringify(SRC.settings), "the file's settings apply (teams, host, strikes, Fast Money on)");
  ok(Object.values(cur.session.revealed).flat().length === 0 && Object.keys(cur.session.rounds).length === 0, "fresh game state");
  ok(games.some((g) => g.id === DEF_ID), "the default game is in GAMES");
  ok(await p.isVisible("#stGo") || await p.isVisible("#stLive"), "start screen shown");
  ok((await p.textContent("body")).includes(SRC.sessionName), "the game's title is on screen");
  // practice → live plays, board, situation strip, video
  if (await p.isVisible("#stLive")) await p.click("#stLive"); else await p.click("#stGo");
  await wait(p, 4300);
  const g1 = await p.evaluate(() => ({ title: document.querySelector("#gTitle").textContent, count: document.querySelector("#gCount").textContent, tiles: document.querySelectorAll("#board .tile").length,
    emb: (document.querySelector("#vFrame iframe.emb") || {}).src || "", sit: document.querySelector("#sitStrip").innerText.replace(/\s+/g, " "), s0: document.querySelector("#gS0").textContent }));
  ok(g1.title.toUpperCase().includes(SRC.plays[0].title.toUpperCase()) && /PLAY 1 OF 4/.test(g1.count) && g1.tiles === SRC.plays[0].observations.length, `play 1 on the board: “${g1.title}”, ${g1.tiles} answers`);
  ok(g1.emb.startsWith(SRC.plays[0].mlb.embedUrl), "play 1 plays its MLB embed");
  const s1 = SRC.plays[0].mlb.sit, inn = String(s1.inning).match(/\d+/)[0];
  ok(new RegExp(inn + "(ST|ND|RD|TH)").test(g1.sit) && new RegExp(s1.outs + " OUTS?", "i").test(g1.sit), "situation strip shows the base-out state: " + g1.sit.slice(0, 80));
  // play a little: reveal an answer, add a strike
  ok((await p.textContent("#gPrompt")).trim() === "WHAT DO YOU SEE?", "the default question reads WHAT DO YOU SEE?");
  const cam = await p.evaluate(() => { const i = document.querySelector("#hImg"), r = i.getBoundingClientRect(), b = document.querySelector("#board").getBoundingClientRect();
    return { mood: i.dataset.mood, ok: i.complete && i.naturalWidth > 0, w: r.width, clear: r.bottom <= b.top || r.left >= b.right }; });
  ok(cam.ok && cam.w > 150 && cam.clear && ["serious", "thinking", "curious", "skeptical", "confused", "welcome"].includes(cam.mood), `the host cam is on screen, beside the board (${cam.mood}, ${Math.round(cam.w)}px)`);
  // a right answer: ding + flip + a happy host
  await p.click("#board .tile >> nth=0"); await wait(p, 600);
  const good = await p.evaluate(() => ({ show: document.querySelector("#rxGood").classList.contains("show"), mood: document.querySelector("#rxGood .rx-img").dataset.mood, cam: document.querySelector("#hImg").dataset.mood }));
  ok(good.show && ["laughing", "excited", "celebratory"].includes(good.mood) && good.cam === good.mood, `a right answer brings the happy host (${good.mood})`);
  await wait(p, 2400);
  // a wrong answer: the X, then the disappointed host, held on screen, then back to the game
  await p.keyboard.press("x"); await wait(p, 400);
  const bad = await p.evaluate(() => ({ x: document.querySelector("#fxX").classList.contains("show"), show: document.querySelector("#rxBad").classList.contains("show"), mood: document.querySelector("#rxBad .rx-img").dataset.mood,
    loaded: document.querySelector("#rxBad .rx-img").naturalWidth > 0 }));
  ok(bad.x && bad.show && bad.loaded && bad.mood === "disappointed", `a wrong answer shows the X and the disappointed host (${bad.mood})`);
  await wait(p, 1800);
  ok(await p.evaluate(() => document.querySelector("#rxBad").classList.contains("show")), "the wrong-answer host is still up after 2 seconds");
  await wait(p, 900);
  ok(await p.evaluate(() => !document.querySelector("#rxBad").classList.contains("show") && getComputedStyle(document.querySelector("#fxX")).opacity === "0"), "then the game is back");
  const mid = (await LS(p)).cur.session;
  ok(Object.values(mid.revealed).flat().length >= 1, "revealing an answer works");
  // 5a. refresh mid-game resumes (existing recovery)
  await p.reload(); await wait(p, 1200);
  const after = (await LS(p)).cur;
  ok(after.gameId === DEF_ID && JSON.stringify(after.session.revealed) === JSON.stringify(mid.revealed) && JSON.stringify(after.session.rounds) === JSON.stringify(mid.rounds), "a refresh resumes the game in progress (revealed answers and strikes kept)");

  // 3. select another game: import one
  const tmp = path.join(os.tmpdir(), "bf2-other-game.json");
  const other = JSON.parse(JSON.stringify(SRC)); other.sessionName = "OTHER TEST GAME"; other.plays = other.plays.slice(0, 2).map((x, i) => ({ ...x, id: "other" + i, title: "Other " + (i + 1) })); other.settings.teamNames = ["Red", "Blue"];
  fs.writeFileSync(tmp, JSON.stringify(other));
  await p.keyboard.press("Escape"); await p.evaluate(() => document.querySelector("#bSetup") && document.querySelector("#bSetup").click()); await wait(p, 400);
  p.once("dialog", (d) => d.accept());
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.querySelector("#bImport").click())]);
  await fc.setFiles(tmp); await wait(p, 1200);
  ({ cur, games } = await LS(p));
  ok(cur.sessionName === "OTHER TEST GAME" && cur.gameId !== DEF_ID, "importing another game still works (existing workflow)");
  await p.reload(); await wait(p, 1200);
  ok((await LS(p)).cur.sessionName === "OTHER TEST GAME", "the chosen game holds for the rest of the session (refresh)");
  await gamesUI(p);
  const list = await p.$$eval("#bfGames .bf-game", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ")));
  ok(list.some((t) => t.includes(SRC.sessionName) && /DEFAULT/.test(t)) && list.some((t) => /OTHER TEST GAME/.test(t)), "GAMES lists the default (tagged DEFAULT) and the other game");
  ok(!(await p.$(`#bfGames [data-bf="gDel"][data-id="${DEF_ID}"]`)), "the default game can't be deleted");
  // 4. back to the default game
  await p.click(`#bfGames [data-bf="gPlay"][data-id="${DEF_ID}"]`); await wait(p, 5000);
  ({ cur } = await LS(p));
  ok(cur.gameId === DEF_ID && sameContent(cur).length === 0 && JSON.stringify(cur.settings.teamNames) === JSON.stringify(SRC.settings.teamNames), "returning to the default game restores its plays and its team names");
  ok(Object.keys(cur.session.rounds).length === 0, "…with a fresh game state");

  // open the other game again, then a NEW SESSION (new tab) → default, fresh; the other game is kept
  await gamesUI(p);
  const otherId = (await LS(p)).games.find((g) => g.name === "OTHER TEST GAME").id;
  await p.click(`#bfGames [data-bf="gPlay"][data-id="${otherId}"]`); await wait(p, 5000);
  await p.click("#board .tile >> nth=0"); await wait(p, 500);
  await p.close();
  p = await open(ctx, errs);
  ({ cur, games } = await LS(p));
  ok(cur.gameId === DEF_ID && Object.values(cur.session.revealed).flat().length === 0 && Object.keys(cur.session.rounds).length === 0, "a returning visitor's new session starts on the default game, fresh (no strikes, reveals or scores carried over)");
  ok(games.some((g) => g.id === otherId && g.data.plays.length === 2), "the game they had open is kept in GAMES");
  // edits made to the default game stay on it (no separate “(your edits)” game), session after session
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("baseballFeud2.v1")); s.plays[0].observations[0].text = "Short edited answer"; localStorage.setItem("baseballFeud2.v1", JSON.stringify(s)); });
  await p.close(); p = await open(ctx, errs);
  ({ cur, games } = await LS(p));
  ok(cur.gameId === DEF_ID && cur.plays[0].observations[0].text === "Short edited answer" && cur.plays[0].observations.length === SRC.plays[0].observations.length, "an edited answer on the default game is kept in the next session");
  ok(!games.some((g) => /your edits/.test(g.name)), "…on the default itself, not as a separate “(your edits)” game");
  await p.close(); p = await open(ctx, errs);
  ok((await LS(p)).cur.plays[0].observations[0].text === "Short edited answer", "…and again in the session after that (never overwritten from the file)");
  ({ cur, games } = await LS(p));
  ok(games.filter((g) => g.id === DEF_ID).length === 1, "exactly one default record");
  // Fast Money + practice still on
  ok(cur.settings.fastMoneyOn === true && cur.practice.enabled === true, "practice round and Fast Money enabled as in the file");
  ok(errs.length === 0, "no page errors " + errs.join(" | ").slice(0, 300));
  await ctx.close();

  // 8. a tab still open on an earlier default (same tab session) switches to the new default once; the old game is kept
  {
    const c2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
    let q = await open(c2, errs);
    // what a browser that last saw the old sample game has stored (written as the reloaded page starts, after its own save-on-exit)
    await q.addInitScript(() => {
      if (sessionStorage.getItem("planted")) return; sessionStorage.setItem("planted", "1");
      const s = JSON.parse(localStorage.getItem("baseballFeud2.v1")); s.gameId = "g-sample-game-volume-1"; s.sessionName = "SAMPLE GAME — VOLUME 1"; s.plays = s.plays.slice(0, 2).map((x, i) => ({ ...x, id: "old" + i, title: "Old sample play " + (i + 1) }));
      localStorage.setItem("baseballFeud2.v1", JSON.stringify(s)); localStorage.setItem("baseballFeud2.defaultSeen", "g-sample-game-volume-1");
    });
    await q.reload(); await wait(q, 1500);
    const r = await LS(q);
    ok(r.cur.gameId === DEF_ID && r.cur.plays.length === 4, "a tab that still had the old sample game open loads the new default after the update");
    ok(r.games.some((g) => g.id === "g-sample-game-volume-1" && /Old sample play 1/.test(g.data.plays[0].title)), "…and the old game is kept in GAMES");
    await q.reload(); await wait(q, 1200);
    ok((await LS(q)).cur.gameId === DEF_ID, "…after that, a refresh resumes as usual");
    await c2.close();
  }
  // 9. today's game, exactly as specified: plays, order, library clips, question, answers and teaching notes
  {
    const SPEC = [
      ["wwgw-v1-06-wheres-the-cutoff", "2025-05-25", "Ryan O'Hearn", "Zack Kelly", ["Poor OF communication", "Airmailing the cut guy(s)", "Batter runner keeps moving", "LF hanging out most of the play", "1B nice job staying engaged"]],
      ["wwgw-v1-07-bunt-chaos", "2025-06-09", "Ke'Bryan Hayes", "Janson Junk", ["Pitcher nowhere close to the correct spot backing the plate", "Catcher does not clear bat from home plate area", "Catcher does not secure the baseball", "2B and SS both break to the bag to cover", "2B standing in no man's land as the play is happening", "RF immediately drifted toward backing up 1B on the bunt", "No one backs up the plate following the error"]],
      ["wwgw-v1-08-rundown-that-wouldnt-end", "2025-09-10", "Casey Schmitt", "Jake Woodford", ["2B secured the baseball on the throw from the C", "2B made the runner at 3B commit to go to HP", "Good throw from 2B to 3B", "BR at 3B did a good job initially running inside the lane to block the throw attempt", "Runner at 3B did a good job trying to run through the catcher to draw contact", "Catcher secured the ball and recorded the out", "C could've delayed the throw to 3B longer in the rundown"]],
      ["wwgw-v1-12-two-runners-one-base", "2026-06-01", "Kody Clemens", "David Sandlin", ["Good feed from 1B to SS for 1st out", "Poor high throw to 1B from SS", "Batter runner did not break down quickly", "Good tag from SS on 2nd out", "1B coach gave no input", "Catcher could begin drifting down the 1B line earlier"]],
    ];
    const NOTES = { "1:6": /3B backing up the plate because the pitcher rotated around to 3B/, "2:6": /so the 3B could catch and tag/, "3:2": /turning an opportunity to advance to 2B into a bang-bang play/, "3:5": /begin running harder to back up the base/ };
    const c3 = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const q = await open(c3, errs), r = await LS(q);
    const lib = await q.evaluate(() => JSON.parse(localStorage.getItem("baseballFeud2.library.v1")));
    const libPlays = lib.plays.concat(lib.queue || []);
    const errsSpec = [];
    if (r.cur.plays.length !== 4) errsSpec.push("play count " + r.cur.plays.length);
    SPEC.forEach(([libId, date, bat, pit, answers], i) => {
      const g = r.cur.plays[i] || {}, m = g.mlb || {};
      if (m.libId !== libId) errsSpec.push(`play ${i + 1} is ${m.libId}`);
      if (!m.sit || m.sit.date !== date || m.sit.batter !== bat || m.sit.pitcher !== pit) errsSpec.push(`play ${i + 1} situation`);
      const lp = libPlays.filter((x) => x.id === libId);
      if (lp.length !== 1 || lp[0].video.embedUrl !== m.embedUrl) errsSpec.push(`play ${i + 1} library record / clip`);
      if (g.prompt !== "WHAT DO YOU SEE?") errsSpec.push(`play ${i + 1} question ${g.prompt}`);
      if (JSON.stringify((g.observations || []).map((o) => o.text)) !== JSON.stringify(answers)) errsSpec.push(`play ${i + 1} answers`);
      (g.observations || []).forEach((o, j) => { const n = NOTES[i + ":" + j]; if (n && !n.test(o.note || "")) errsSpec.push(`play ${i + 1} note ${j + 1}`); });
    });
    ok(errsSpec.length === 0, "today's default: BAL@BOS, MIA@PIT, AZ@SF, CWS@MIN from their library records, WHAT DO YOU SEE?, answers 5/7/7/6 exactly as given, teaching notes kept " + errsSpec.join(", "));
    ok(libPlays.length === new Set(libPlays.map((x) => x.id)).size, "no duplicate library records");
    if (await q.isVisible("#stLive")) await q.click("#stLive"); else await q.click("#stGo");
    await wait(q, 4300);
    const shown = await q.evaluate(() => ({ prompt: document.querySelector("#gPrompt").textContent.trim(), tiles: document.querySelectorAll("#board .tile").length, title: document.querySelector("#gTitle").textContent }));
    ok(shown.prompt === "WHAT DO YOU SEE?" && shown.tiles === 5 && /cutoff/i.test(shown.title), `the game opens on BAL@BOS with 5 answer tiles and WHAT DO YOU SEE? (${shown.title})`);
    await c3.close();
  }

  // 7. phone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const merrs = []; const mp = await open(m, merrs);
  ({ cur } = await LS(mp));
  ok(cur.gameId === DEF_ID && sameContent(cur).length === 0, "phone: the default game loads");
  ok(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "phone: no horizontal overflow");
  if (await mp.isVisible("#stLive")) await mp.click("#stLive"); else await mp.click("#stGo");
  await wait(mp, 4300);
  ok((await mp.locator("#board .tile").count()) === SRC.plays[0].observations.length, "phone: play 1's board is shown");
  if (process.env.SHOTS) await mp.screenshot({ path: path.join(process.env.SHOTS, "default-game-phone.png") });
  ok(merrs.length === 0, "phone: no page errors " + merrs.join(" | ").slice(0, 300));
  await m.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
