/* Baseball Feud 2.0 — keyboard host controls: 1–9 correct, X wrong / failed steal, G good thought, S successful steal,
   no repeats, no actions mid-transition, nothing while typing.
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node tools/baseball-feud-discovery/tests/keys.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/baseball-feud-2/";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const st = (p) => p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("baseballFeud2.v1")), play = s.plays[Math.min(Math.max(s.session.current | 0, 0), s.plays.length - 1)];
  const r = s.session.rounds[play.id] || {};
  return { pid: play.id, n: play.observations.length, revealed: (s.session.revealed[play.id] || []).length, phase: r.phase || "play", strikes: r.strikes || 0,
    winner: r.winner ?? null, control: r.control ?? 0, stealTeam: r.stealTeam ?? null, outcome: r.outcome || null,
    bank: +document.querySelector("#gBankV").textContent, s0: +document.querySelector("#gS0").dataset.v, s1: +document.querySelector("#gS1").dataset.v };
});
const shown = (p, sel) => p.evaluate((q) => document.querySelector(q).classList.contains("show"), sel);

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE); await wait(p, 1000);
  await p.evaluate(() => { const t = document.querySelector("#toast"); if (t) t.style.visibility = "hidden"; });
  if (await p.isVisible("#stLive")) await p.click("#stLive"); else await p.click("#stGo");

  // intro lock: a number pressed while the round intro is still playing does nothing
  await wait(p, 300); await p.keyboard.press("1"); await wait(p, 300);
  ok((await st(p)).revealed === 0, "a number key during the round intro is ignored");
  await wait(p, 4000);

  // 1 = correct answer #1: reveal, points, ding, happy host
  let s0 = await st(p);
  await p.keyboard.press("1"); await wait(p, 500);
  let s1 = await st(p);
  ok(s1.revealed === 1 && s1.bank > 0 && await shown(p, "#rxGood"), `1 reveals answer #1 and banks its points (${s1.bank})`);
  await wait(p, 600);
  await p.keyboard.press("1"); await wait(p, 500);
  let s2 = await st(p);
  ok(s2.revealed === 1 && s2.bank === s1.bank, "pressing 1 again neither hides nor scores it twice");
  await p.keyboard.press("9"); await wait(p, 400);
  ok((await st(p)).revealed === 1, `9 does nothing on a ${s0.n}-answer board`);

  // key repeat: holding 2 down reveals once
  await p.keyboard.down("2"); await wait(p, 60); await p.keyboard.down("2"); await p.keyboard.down("2"); await p.keyboard.up("2"); await wait(p, 500);
  const s3 = await st(p);
  ok(s3.revealed === 2, "a held key fires once (answer #2 revealed once)");
  await wait(p, 2400);

  // G = good thought: no points, no strike, nothing revealed
  const g0 = await st(p);
  await p.keyboard.press("g"); await wait(p, 300);
  const g1 = await st(p);
  ok(await shown(p, "#fxGood") && g1.bank === g0.bank && g1.strikes === g0.strikes && g1.revealed === g0.revealed, "G shows Good Thought without points, strikes or reveals");
  ok(await p.evaluate(() => ["proud", "grateful"].includes(document.querySelector("#fxGood .gt-host").dataset.mood)), "Good Thought brings an encouraging host");
  await wait(p, 2200);

  // typing in a text field never triggers shortcuts
  await p.evaluate(() => { const i = document.createElement("input"); i.id = "tmpField"; i.style.cssText = "position:fixed;top:0;left:0;z-index:999"; document.body.appendChild(i); i.focus(); });
  await p.keyboard.type("3xgs"); await wait(p, 400);
  const t1 = await st(p);
  ok(t1.revealed === 2 && t1.strikes === 0 && t1.control === g0.control && await p.inputValue("#tmpField") === "3xgs", "typing 3, x, g, s in a text field triggers nothing");
  await p.evaluate(() => document.querySelector("#tmpField").remove());

  // X = wrong answer: X, buzz, disappointed host, one strike
  await p.keyboard.press("x"); await wait(p, 350);
  let x1 = await st(p);
  ok(x1.strikes === 1 && await shown(p, "#fxX") && await shown(p, "#rxBad"), "X shows the wrong-answer X and host and adds one strike");
  await wait(p, 2800);
  await p.keyboard.press("x"); await wait(p, 2800);
  await p.keyboard.press("x"); await wait(p, 500);
  x1 = await st(p);
  ok(x1.strikes === 3 && x1.phase === "steal", "the third X opens the steal");
  // S right as the steal banner starts is ignored
  await p.keyboard.press("s"); await wait(p, 300);
  ok((await st(p)).phase === "steal", "S while the steal is still starting is ignored");
  await wait(p, 3200);

  // X during the steal = failed steal (X first, then the team in control holds)
  const f0 = await st(p);
  await p.keyboard.press("x"); await wait(p, 400);
  ok(await shown(p, "#fxX") && (await st(p)).phase === "steal", "X during a steal shows the X first");
  await wait(p, 2600);
  const f1 = await st(p);
  ok(f1.phase === "done" && f1.winner === f0.control && f1.outcome === "hold", `…then the steal fails: ${f1.winner === 0 ? "team 1" : "team 2"} holds the bank`);
  ok(f1.strikes === 3, "a failed steal adds no extra strike to the team in control");
  const total = f1.s0 + f1.s1;

  // next play: S during a steal = successful steal
  await p.keyboard.press("Escape"); await p.keyboard.press("Shift+ArrowRight"); await wait(p, 4300);
  await p.keyboard.press("1"); await wait(p, 900);
  await p.keyboard.press("Shift+S"); await wait(p, 3400);
  const k0 = await st(p);
  ok(k0.phase === "steal", "Shift+S starts a steal");
  await p.keyboard.press("s"); await wait(p, 700);
  const k1 = await st(p);
  ok(k1.phase === "done" && k1.winner === k0.stealTeam && k1.outcome === "steal" && (k1.s0 + k1.s1) > total, "S during the steal = successful steal: the stealing team takes the bank");
  ok(await p.evaluate(() => ["shocked", "celebratory"].includes(document.querySelector("#fxBig .fx-host").dataset.mood)), "a successful steal brings a shocked or celebratory host");
  await p.keyboard.press("x"); await wait(p, 400);
  ok((await st(p)).winner === k1.winner, "X right after the round settles changes nothing");

  // outside a steal, S still switches the team in control (existing shortcut)
  await p.keyboard.press("Escape"); await p.keyboard.press("Shift+ArrowRight"); await wait(p, 4300);
  const c0 = (await st(p)).control;
  await p.keyboard.press("s"); await wait(p, 400);
  ok((await st(p)).control === 1 - c0, "outside a steal S still switches the team in control");

  // the mouse controls are unchanged
  await p.click("#bX"); await wait(p, 400);
  ok((await st(p)).strikes === 1, "the WRONG ANSWER button still adds a strike");
  await wait(p, 2800);
  await p.click("#bGood"); await wait(p, 300);
  ok(await shown(p, "#fxGood"), "the GOOD THOUGHT button still works");

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})();
