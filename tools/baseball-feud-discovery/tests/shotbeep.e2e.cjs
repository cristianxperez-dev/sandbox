/* Baseball Feud 2.0 — shot clock countdown beeps (5…1, once each) and the TIME state fitting its border.
   The page's clock is fast-forwarded (Playwright clock); every tone the app plays is recorded from the Web Audio API.
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node tools/baseball-feud-discovery/tests/shotbeep.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/baseball-feud-2/";
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const BEEP = [880, 1046.5], TIMEUP = 523.25;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript(() => {   // record every oscillator start: [frequency, page time]
    window.__tones = [];
    const orig = BaseAudioContext.prototype.createOscillator;   // the app sets each tone's pitch with frequency.setValueAtTime
    BaseAudioContext.prototype.createOscillator = function () {
      const o = orig.call(this), st = o.start.bind(o), sv = o.frequency.setValueAtTime.bind(o.frequency); let f = o.frequency.value;
      o.frequency.setValueAtTime = (v, t) => { f = v; return sv(v, t); };
      o.start = (t) => { window.__tones.push([Math.round(f * 100) / 100, Date.now()]); return st(t); };
      return o;
    };
  });
  await p.clock.install();
  await p.goto(BASE); await p.clock.runFor(1200);
  if (await p.isVisible("#stLive")) await p.click("#stLive"); else await p.click("#stGo");
  await p.clock.runFor(4500);
  const run = (ms) => p.clock.runFor(ms);
  const take = () => p.evaluate(() => { const t = window.__tones.map((x) => x[0]); window.__tones = []; return t; });
  const beeps = (t) => t.filter((f) => f === 880 || f === 1046.5);
  const shotV = () => p.evaluate(() => document.querySelector("#shot").hidden ? null : document.querySelector("#shotV").textContent);

  // 20-second clock: silent until 5, then 5-4-3-2-1 once each, then the expiration sound
  await p.keyboard.press("1"); await run(800); await take();
  await run(13500);
  ok(beeps(await take()).length === 0 && +(await shotV()) === 6, "no beeps from 20 down to 6");
  const seq = [];
  for (let i = 0; i < 5; i++) { await run(1000); seq.push(beeps(await take())); }
  ok(JSON.stringify(seq) === JSON.stringify([[880], [880], [880], [880], [1046.5]]), "5, 4, 3, 2, 1: exactly one beep each (1 slightly brighter) " + JSON.stringify(seq));
  await run(1000);
  const end = await take();
  ok((await shotV()) === "TIME" && beeps(end).length === 0 && end.includes(TIMEUP), "0: TIME with only the expiration sound (no beep on top)");
  await run(5000); ok(beeps(await take()).length === 0, "no more beeps after TIME");

  // pause / resume / restart
  await p.keyboard.press("x"); await run(600); await take();
  await run(16500);                                   // shows 3 → beeps 5,4,3 already played
  ok(beeps(await take()).length === 3 && (await shotV()) === "3", "the next 20-second clock beeps 5, 4, 3 on its way down");
  await p.click('[data-g="shotPause"]'); await run(6000);
  ok(beeps(await take()).length === 0 && (await shotV()) === "3", "paused: no beeps, the clock holds");
  await p.click('[data-g="shotPause"]'); await run(400);
  ok(beeps(await take()).length === 0, "resuming doesn't replay a beep already played");
  await run(2700);
  ok(JSON.stringify(beeps(await take())) === JSON.stringify([880, 1046.5]), "…then only 2 and 1 sound");
  await run(1500); await take();
  await p.click('[data-g="shotRestart"]'); await run(300); await take();
  await run(15000);
  ok(beeps(await take()).length === 1 && (await shotV()) === "5", "Restart resets the beeps: the restarted clock beeps again at 5");
  await p.click('[data-g="shotClear"]'); await run(6000);
  ok(beeps(await take()).length === 0, "Clear: no more beeps");

  // Shot Clock OFF: no countdown audio
  await p.evaluate(() => { const c = document.querySelector("#setShot"); c.checked = false; c.dispatchEvent(new Event("change")); });
  await p.keyboard.press("x"); await run(22000);
  ok(beeps(await take()).length === 0 && (await shotV()) === null, "Shot Clock OFF: no clock, no beeps");
  await p.evaluate(() => { const c = document.querySelector("#setShot"); c.checked = true; c.dispatchEvent(new Event("change")); });

  // the TIME state fits its border at every width, clear of the Round Bank
  for (const [W, H] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 640]]) {
    await p.setViewportSize({ width: W, height: H }); await run(400);
    for (const st of ["normal", "urgent", "time"]) {
      await p.evaluate((s) => { const el = document.querySelector("#shot"); el.hidden = false; el.className = "shot" + (s === "normal" ? "" : " " + s); document.querySelector("#shotV").textContent = s === "time" ? "TIME" : s === "urgent" ? "5" : "18"; document.querySelector("#shotL").textContent = "SHOT CLOCK"; document.querySelector("#gFound").classList.add("has-shot"); }, st);
      const m = await p.evaluate(() => {
        const s = document.querySelector("#shot"), sr = s.getBoundingClientRect(), v = document.querySelector("#shotV"), vr = v.getBoundingClientRect(), l = document.querySelector("#shotL"), lr = l.getBoundingClientRect(), bk = document.querySelector("#gBank").getBoundingClientRect();
        return { inside: vr.left >= sr.left && vr.right <= sr.right - 6 && lr.left >= sr.left + 4 && vr.top >= sr.top - 1 && vr.bottom <= sr.bottom + 1, noSpill: v.scrollWidth <= v.clientWidth + 1, oneLine: lr.height < 1.6 * parseFloat(getComputedStyle(l).fontSize), clear: sr.right <= bk.left, rowFits: bk.right <= document.querySelector("#gFound").getBoundingClientRect().right + 1 && document.querySelector("#gFoundT").getBoundingClientRect().right <= sr.left };
      });
      ok(m.inside && m.noSpill && m.oneLine && m.clear && m.rowFits, `${W}×${H} · ${st.toUpperCase()}: inside the border, label on one line, clear of FOUND and the Round Bank, which stays in the row ${JSON.stringify(m)}`);
    }
  }
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})();
