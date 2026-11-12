/* Baseball Feud 2.0 — pacing: 20-second shot clock after each judged answer, 3 replays per turn with a 10-second
   clock after each, Shot Clock on/off, steals, Fast Money independence, host rotation every ~4.5 s.
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node tools/baseball-feud-discovery/tests/pace.e2e.cjs
   A local 3-second test clip is attached to play 1 (MLB's embedded player isn't reachable from a test machine). */
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/baseball-feud-2/";
const BCAST = path.join(__dirname, "fixtures", "broadcast-test.mp4");
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const st = (p) => p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("baseballFeud2.v1")), play = s.plays[Math.min(Math.max(s.session.current | 0, 0), s.plays.length - 1)];
  const r = s.session.rounds[play.id] || {}, el = document.querySelector("#shot");
  return { revealed: (s.session.revealed[play.id] || []).length, strikes: r.strikes || 0, phase: r.phase || "play", control: r.control ?? 0,
    s0: +document.querySelector("#gS0").dataset.v, s1: +document.querySelector("#gS1").dataset.v, bank: +document.querySelector("#gBankV").textContent,
    shot: el.hidden ? null : document.querySelector("#shotV").textContent, shotL: document.querySelector("#shotL").textContent, shotCls: el.className,
    rp: document.querySelector("#rpN").textContent, spent: document.querySelector("#bReplay").classList.contains("spent"), libId: (play.mlb || {}).libId };
});
const untilEnded = (p) => p.waitForFunction(() => { const v = document.querySelector("#gv"); return v.ended; }, null, { timeout: 15000 });

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {   // record the pitch of every tone the app plays
    window.__tones = []; const orig = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function () { const o = orig.call(this), st = o.start.bind(o), sv = o.frequency.setValueAtTime.bind(o.frequency); let f = o.frequency.value;
      o.frequency.setValueAtTime = (v, t) => { f = v; return sv(v, t); }; o.start = (t) => { window.__tones.push(Math.round(f * 100) / 100); return st(t); }; return o; };
  });
  await p.goto(BASE); await wait(p, 1000);
  await p.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.style.visibility = "hidden"; });
  if (await p.isVisible("#stLive")) await p.click("#stLive"); else await p.click("#stGo");
  await wait(p, 4300);

  // attach the local test clip to play 1 (Manage Video), then back to the game
  const lib = (await st(p)).libId;
  await p.click('[data-g="lib"]'); await wait(p, 500);
  await p.click(`#bfLib [data-card="${lib}"] [data-bf="manage"]`); await wait(p, 400);
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click('#bfVid .mv-slot[data-drop="broadcast"] [data-bf="mvChoose"]')]);
  await fc.setFiles(BCAST); await wait(p, 400);
  await p.click('#bfVid [data-bf="mvSave"]'); await wait(p, 600);
  await p.click('#bfLib [data-bf="close"]'); await wait(p, 800);
  ok(await p.evaluate(() => !!document.querySelector("#gv").dataset.url), "play 1 plays the local test clip");

  // host rotation: no actions for a while → a new waiting expression about every 4.5 s
  const moods = await p.evaluate(() => new Promise((res) => { const seen = []; let last = document.querySelector("#hImg").dataset.mood; const t0 = Date.now();
    const iv = setInterval(() => { const m = document.querySelector("#hImg").dataset.mood; if (m !== last) { seen.push(Date.now() - t0); last = m; } if (Date.now() - t0 > 14000) { clearInterval(iv); res(seen); } }, 100); }));
  const gaps = moods.slice(1).map((t, i) => t - moods[i]);
  ok(moods.length >= 2 && gaps.every((g) => g > 3800 && g < 5600), `passive host rotation every ~4.5 s (changes at ${moods.map((x) => (x / 1000).toFixed(1)).join(", ")} s)`);

  let s = await st(p);
  ok(s.shot === null && s.rp === "· 3 LEFT", "no clock before any judgment; the turn starts with 3 replays");

  // 1–9 / click → fresh 20; X → fresh 20; one clock only
  await p.keyboard.press("1"); await wait(p, 300);
  s = await st(p); ok(s.shot === "20" && s.shotL === "SHOT CLOCK", "pressing 1 reveals answer 1 and starts a 20-second clock");
  await wait(p, 2600); const before = +(await st(p)).shot;
  await p.keyboard.press("x"); await wait(p, 300);
  s = await st(p); ok(before <= 18 && s.shot === "20" && s.strikes === 1, `X resets the clock to 20 (it was at ${before})`);
  ok(await p.evaluate(() => document.querySelectorAll("#shot, .shot").length) === 1, "there is only ever one shot clock");
  await wait(p, 2600);
  await p.click("#board .tile >> nth=1"); await wait(p, 300);
  ok((await st(p)).shot === "20", "clicking an answer tile also restarts the clock at 20");
  await wait(p, 2600);
  await p.click("#bX"); await wait(p, 300);
  ok((await st(p)).shot === "20", "clicking WRONG ANSWER also restarts the clock at 20");
  await wait(p, 2700);
  // Good Thought doesn't touch the clock
  const g0 = +(await st(p)).shot;
  await p.keyboard.press("g"); await wait(p, 400);
  ok(+(await st(p)).shot <= g0, "Good Thought does not restart the clock");
  await wait(p, 2100);

  // replay 1: clock stops during the video, 10 after it
  await p.click("#bReplay"); await wait(p, 250);
  s = await st(p); ok(s.shot === null && s.rp === "· 2 LEFT", "Replay #1: the clock stops at once and 2 replays remain");
  const st0 = await st(p);
  await p.keyboard.press("3"); await wait(p, 250);
  ok((await st(p)).revealed === st0.revealed, "answer keys are ignored while the replay is on screen");
  await untilEnded(p); await wait(p, 300);
  s = await st(p); ok(s.shot === "10" && s.shotL === "AFTER REPLAY" && /warn/.test(s.shotCls), "when the replay ends a 10-second clock starts");
  ok(s.revealed === st0.revealed && s.strikes === st0.strikes && s.bank === st0.bank, "a replay changes no answer, strike or score");
  // replay 2: a double click uses one replay; a fresh 10 afterwards
  await wait(p, 2200);
  await p.dblclick("#bReplay"); await wait(p, 250);
  ok((await st(p)).rp === "· 1 LEFT", "Replay #2 (double-clicked) uses exactly one replay");
  await untilEnded(p); await wait(p, 300);
  ok((await st(p)).shot === "10", "after Replay #2 a new 10-second clock starts");
  // replay 3 via R
  await wait(p, 1500);
  await p.keyboard.press("r"); await wait(p, 250);
  s = await st(p); ok(s.rp === "· 0 LEFT" && s.spent, "Replay #3 (R key) leaves 0 and the Replay button looks spent");
  await untilEnded(p); await wait(p, 300);
  ok((await st(p)).shot === "10", "after Replay #3 a final 10-second clock starts");
  await p.evaluate(() => { window.__tones = []; });
  // replay 4 is impossible
  await wait(p, 1200);
  await p.click("#bReplay", { force: true }); await wait(p, 300);   // aria-disabled: clicked anyway
  s = await st(p); ok(s.rp === "· 0 LEFT" && s.shot !== null && await p.evaluate(() => document.querySelector("#gv").paused), "Replay #4 is refused: no video, the clock keeps running");
  // expiry: TIME, nothing scored
  const e0 = await st(p);
  await p.waitForFunction(() => document.querySelector("#shotV").textContent === "TIME", null, { timeout: 15000 });
  s = await st(p);
  const cd = await p.evaluate(() => window.__tones.filter((f) => f === 880 || f === 1046.5));
  ok(JSON.stringify(cd) === JSON.stringify([880, 880, 880, 880, 1046.5]), "the post-replay 10-second clock beeps 5, 4, 3, 2, 1 once each " + JSON.stringify(cd));
  ok(/time/.test(s.shotCls) && s.revealed === e0.revealed && s.strikes === e0.strikes && s.bank === e0.bank, "at zero the clock shows TIME and nothing is revealed, struck or scored");
  // manual controls
  await p.click('[data-g="shotRestart"]'); await wait(p, 300);
  ok((await st(p)).shot === "10", "Restart Timer restarts the current window");
  await p.click('[data-g="shotPause"]'); await wait(p, 1500);
  s = await st(p); ok(s.shotL === "PAUSED" && +s.shot >= 9, "Pause holds the clock");
  await p.click('[data-g="shotPause"]'); await wait(p, 1300);
  ok(+(await st(p)).shot <= 9 && (await st(p)).shotL !== "PAUSED", "Resume continues it");
  await p.click('[data-g="shotClear"]'); await wait(p, 200);
  ok((await st(p)).shot === null, "Clear Timer hides it");

  // control passes → fresh allowance
  await p.keyboard.press("s"); await wait(p, 400);
  s = await st(p); ok(s.rp === "· 3 LEFT" && s.control === 1, "when control passes to the other team, replays reset to 3");

  // steal: no clock under the banner, then the stealing team's own 20 and own 3 replays
  await p.keyboard.press("s"); await wait(p, 400);   // back to team 1 (another fresh turn)
  for (let i = (await st(p)).strikes; i < 3; i++) { await p.keyboard.press("x"); await wait(p, 2900); }
  s = await st(p); ok(s.phase === "steal", "three strikes open the steal");
  await wait(p, 1200);
  ok((await st(p)).shot === null, "no clock while the steal banner plays");
  await wait(p, 4200);
  s = await st(p); ok(s.shot !== null && +s.shot >= 14 && s.rp === "· 3 LEFT", `the stealing team then gets a 20-second window and 3 replays (${s.shot})`);
  await p.keyboard.press("x"); await wait(p, 3000);
  s = await st(p); ok(s.phase === "done" && s.shot === null, "the failed steal settles the round and clears the clock");

  // Shot Clock OFF: no countdowns, replays still counted
  await p.evaluate(() => { const c = document.querySelector("#setShot"); c.checked = false; c.dispatchEvent(new Event("change")); });
  await p.keyboard.press("Escape"); await p.keyboard.press("Shift+ArrowRight"); await wait(p, 4400);
  await p.keyboard.press("x"); await wait(p, 400);
  s = await st(p); ok(s.shot === null && s.strikes === 1, "Shot Clock OFF: an X starts no clock");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".cb-shot")).display === "none"), "Shot Clock OFF hides the timer controls");
  ok(s.rp === "· 3 LEFT", "Shot Clock OFF: replays are still counted per turn");
  await p.evaluate(() => { const c = document.querySelector("#setShot"); c.checked = true; c.dispatchEvent(new Event("change")); });

  // Fast Money keeps its own clock
  await wait(p, 2600); await p.keyboard.press("x"); await wait(p, 400);
  ok((await st(p)).shot === "20", "Shot Clock back ON: X starts the 20 again");
  await p.keyboard.press("Shift+M"); await wait(p, 900);
  await p.keyboard.press("Enter"); await wait(p, 1500);
  ok((await st(p)).shot === null && /^\d+$/.test(await p.textContent("#fmTime")), "Fast Money: the shot clock is cleared, Fast Money's own clock runs");

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})();
