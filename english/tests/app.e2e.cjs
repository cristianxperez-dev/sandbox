/* CP English — browser journeys A–F (Playwright, Chromium with a fake microphone).
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node english/tests/app.e2e.cjs
   The static server has no API, so the speech service is mocked with page.route where a journey needs
   feedback (A–C), and left absent where a journey tests failure (E). SHOTS=<dir> saves screenshots. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/english/";
const SHOTS = process.env.SHOTS || "";
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "../content/placement.json"), "utf8"));
const lessons = { f01: JSON.parse(fs.readFileSync(path.join(__dirname, "../content/lessons/f01.json"), "utf8")), f03: JSON.parse(fs.readFileSync(path.join(__dirname, "../content/lessons/f03.json"), "utf8")) };
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const shot = (p, n) => (SHOTS ? p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: false }) : null);
const LV = ["A0", "A1", "A2", "B1", "B2"];

/* the mocked speech service: returns a validated-shape evaluation at a chosen level */
function mockApi(page, level, opts = {}) {
  const seen = { speech: 0, text: 0 };
  page.route("**/apps/english/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/status")) return route.fulfill({ json: { ai: { active: true, reason: "on" } } });
    const body = route.request().postData() || "";
    if (url.endsWith("/api/text")) seen.text++; else seen.speech++;
    if (/"mode":"repeat"/.test(body)) return route.fulfill({ json: { transcript: "keep your head still and watch the ball", recognition: { ok: true },
      compare: { ref: [{ w: "keep", ok: true }, { w: "your", ok: true }, { w: "head", ok: false }], missing: ["head"], extra: [], matched: 2, total: 3, ratio: 0.67, verdict: "close" } } });
    if (opts.unclear) return route.fulfill({ json: { transcript: "", recognition: { ok: false, reason: "empty" } } });
    return route.fulfill({ json: { transcript: "My name is Carlos, I'm from Santo Domingo.", recognition: { ok: true }, evaluation: {
      on_task: true, understandable: true, possible_recognition_issue: false, scores: { clarity: 3, grammar: 2, vocabulary: 3, completeness: 3 }, level_estimate: level,
      strengths: ["Clear"], corrections: [{ said: "I have 30 years", better: "I'm 30", why_es: "La edad se dice con I am." }], better_sentence: "My name is Carlos, and I'm from Santo Domingo.",
      feedback: "Good — your meaning was clear.", feedback_es: "Bien: se entendió.", follow_up: "Nice to meet you! What do you do?" } } });
  });
  return seen;
}
async function fresh(b, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts.ctx));
  if (opts.mic !== false) await ctx.grantPermissions(["microphone"], { origin: new URL(BASE).origin }).catch(() => {});
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/api\/status|404/.test(m.text())) errs.push("console: " + m.text()); });
  return { ctx, p, errs };
}
async function record(p, scope = "") {
  await p.click(`${scope} .rec`); await wait(p, 1600); await p.click(`${scope} .rec`); await wait(p, 300);
  if (await p.isVisible("dialog.dlg")) await p.click("dialog.dlg >> text=I agree");
  await wait(p, 600);
}
/** placement: answer as a learner who knows everything up to `level` */
async function takePlacement(p, level, speakLevel) {
  await p.goto(BASE + "#/placement"); await wait(p, 500);
  await p.click("text=Start the test"); await wait(p, 300);
  let n = 0;
  while (n++ < 25) {
    const k = await p.textContent(".kicker");
    if (!/Question/.test(k)) break;
    const prompt = (await p.textContent("h2.q__prompt")).trim();
    const opts = await p.$$eval(".opts .opt", (b) => b.map((x) => x.textContent));
    const item = bank.items.find((i) => i.prompt === prompt && i.options.every((o) => opts.includes(o)));
    if (!item) throw new Error("unknown item: " + prompt);
    const knows = LV.indexOf(item.level) <= LV.indexOf(level);
    const want = knows ? item.options[item.answer] : item.options.find((o, i) => i !== item.answer);
    await p.click(`.opts .opt >> text="${want}"`); await wait(p, 120);
  }
  return n - 1;
}
async function speakPlacement(p, speaking) {
  for (let k = 0; k < 3; k++) {
    await p.waitForSelector(".rec");
    if (speaking === "skip") await p.click("text=I can't speak now");
    else { await record(p); await p.click("text=/Next question|See my results/"); }
    await wait(p, 400);
  }
}

/* run a whole lesson, answering correctly; stopAt = activity id to stop before (for the resume journey) */
async function runLesson(p, id, opts = {}) {
  const L = lessons[id];
  const all = L.sections.flatMap((s) => s.activities);
  let guard = 0;
  while (guard++ < 60) {
    await wait(p, 250);
    const act = await p.getAttribute(".lesson__body", "data-act"), type = await p.getAttribute(".lesson__body", "data-type");
    if (act === "summary") return true;
    if (opts.stopAt === act) return act;
    const a = all.find((x) => x.id === act);
    if (type === "lecture") {
      await p.click(".lec__play"); await wait(p, 2500);
      const t = await p.textContent(".lec__time");
      opts.onLecture && opts.onLecture(t);
      await p.click("text=Continue to vocabulary"); continue;
    }
    if (type === "match") {
      for (const [en, es] of a.pairs) await p.selectOption(`select[aria-label="Meaning of ${en}"]`, es);
      await p.click(".lesson__body >> text=Check"); await p.click("text=Continue →"); continue;
    }
    if (type === "choice") { await p.click(`.opts .opt >> text="${a.options[a.answer]}"`); await p.click("text=Continue →"); continue; }
    if (type === "order") {
      const words = a.answers[0].split(" ");
      for (const w of words) await p.click(`.order__pool .chip--word >> text="${a.words.find((x) => x.toLowerCase() === w.toLowerCase())}"`);
      await p.click(".lesson__body >> text=Check"); await p.click("text=Continue →"); continue;
    }
    if (type === "listen") {
      await p.click(".clip .btn--play"); await wait(p, 800);
      opts.onListen && (await opts.onListen());
      for (const q of a.questions) await p.click(`.opts .opt:not([disabled]) >> text="${q.options[q.answer]}"`);
      await p.click("text=Continue →"); continue;
    }
    if (type === "repeat" || type === "answer") {
      await record(p, ".lesson__body");
      opts.onSpeak && (await opts.onSpeak(type));
      await p.click(".lesson__body >> text=Continue →"); continue;
    }
    if (type === "conversation") {
      await p.click("text=Start the conversation");
      for (let t = 0; t < a.turns.length; t++) {
        await record(p, ".convo__stage");
        if (opts.onTurn) await opts.onTurn(t);
        await p.click(".convo__stage >> text=/Next →|Finish conversation/");
      }
      await p.click("text=Continue →"); continue;
    }
    if (type === "mastery") {
      for (const q of a.items) await p.click(`.opts .opt:not([disabled]) >> text="${q.options[q.answer]}"`);
      await p.click("text=See your review"); continue;
    }
    throw new Error("unhandled " + type + " " + act);
  }
  return false;
}

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

  /* ---------- A: beginner ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    const api = mockApi(p, "A1");
    await p.goto(BASE); await wait(p, 600);
    ok(await p.isVisible("text=Take the placement test"), "A · first visit: welcome with the placement test as the primary action");
    await shot(p, "a-welcome");
    const items = await takePlacement(p, "A0");
    ok(items >= 6 && items <= 12, `A · adaptive objective part: ${items} questions`);
    await speakPlacement(p, "speak");
    await wait(p, 500);
    const res = await p.textContent("main");
    ok(/estimated level:\s*A[01]/i.test(res), "A · beginner placed at A0/A1: " + (res.match(/estimated level:\s*\S+/i) || [""])[0]);
    ok(/Foundation/.test(res) && /Start: Introductions/.test(res) && !/provisional/.test(res), "A · Foundation track, Lesson 1 recommended, speaking evaluated (not provisional)");
    ok(/not an official certification/i.test(res), "A · results say the level is an estimate, not a certification");
    await shot(p, "a-result");
    await p.click("text=Start: Introductions"); await wait(p, 800);
    let lecTime = "";
    const done = await runLesson(p, "f01", { onLecture: (t) => (lecTime = t), onSpeak: async () => {} });
    ok(/^0:0[1-4] \/ 3:1\d$/.test(lecTime.trim()), "A · the narrated lecture plays (" + lecTime.trim() + ")");
    ok(done === true, "A · Lesson 1 completed end to end (lecture, vocabulary, listening, practice, speaking, conversation, mastery)");
    ok(api.speech >= 7, `A · spoken responses sent for feedback (${api.speech})`);
    const sum = await p.textContent("main");
    ok(/Lesson complete/.test(sum) && /Useful phrases/.test(sum), "A · lesson review: completion, skills, useful phrases");
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem("cpEnglish.v1")));
    ok(st.lessons.f01.completed && st.placement.attempts.length === 1 && st.speaking.length >= 5, "A · progress, placement and speaking history saved");
    ok(!JSON.stringify(st).includes("blob:") && !JSON.stringify(st).includes("data:audio"), "A · no audio stored");
    ok(errs.length === 0, "A · no page errors " + errs.join(" | "));
    await ctx.close();
  }

  /* ---------- B: proficient learner ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    mockApi(p, "B1");
    const items = await takePlacement(p, "B2");
    await speakPlacement(p, "speak");
    await wait(p, 500);
    const res = await p.textContent("main");
    ok(/estimated level:\s*B[12]/i.test(res), `B · stronger learner placed higher (${(res.match(/estimated level:\s*\S+/i) || [""])[0]}, ${items} questions)`);
    ok(/Professional Communication/.test(res) && /forthcoming/i.test(res), "B · Professional track recommended; its lessons are labelled forthcoming");
    await p.goto(BASE + "#/curriculum"); await wait(p, 500);
    const cur = await p.textContent("main");
    ok(/Recommended for you/.test(cur) && (cur.match(/Forthcoming/g) || []).length >= 40, "B · curriculum: recommended track marked, unbuilt lessons labelled Forthcoming");
    await p.click("text=Feedback with reasons"); await wait(p, 300);
    ok(/not available yet/.test(await p.textContent("main")), "B · an unbuilt lesson can't be opened as if it were available");
    await shot(p, "b-curriculum");
    ok(errs.length === 0, "B · no page errors " + errs.join(" | "));
    await ctx.close();
  }

  /* ---------- C: baseball lesson ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    mockApi(p, "A1");
    await p.goto(BASE + "#/lesson/f03"); await wait(p, 600);
    let heard = false, fb = 0, cmp = 0;
    const done = await runLesson(p, "f03", {
      onListen: async () => { heard = heard || (await p.evaluate(() => document.querySelector(".clip .btn--play").textContent.includes("Pause"))); },
      onSpeak: async (t) => { const txt = await p.textContent(".lesson__body .speak__out"); if (t === "repeat" && /not a pronunciation score/i.test(txt)) cmp++; if (t === "answer" && /natural way to say it/i.test(txt)) fb++; },
    });
    ok(heard, "C · the coach's drill explanation plays");
    ok(cmp === 2, "C · listen-and-repeat: transcript + word comparison, labelled as not a pronunciation score");
    ok(fb === 2, "C · spoken coaching instruction: feedback with a more natural sentence");
    ok(done === true && /Lesson complete/.test(await p.textContent("main")), "C · Lesson 2 completed");
    await shot(p, "c-summary");
    ok(errs.length === 0, "C · no page errors " + errs.join(" | "));
    await ctx.close();
  }

  /* ---------- D: interrupted session ---------- */
  {
    const { ctx, p } = await fresh(b);
    mockApi(p, "A1");
    await p.goto(BASE + "#/lesson/f01"); await wait(p, 600);
    const at = await runLesson(p, "f01", { stopAt: "f01-p4" });
    ok(at === "f01-p4", "D · halfway through Lesson 1");
    await p.goto("about:blank"); await wait(p, 200);
    await p.goto(BASE); await wait(p, 600);
    ok(/Continue: Introductions/.test(await p.textContent("main")), "D · the dashboard offers to continue the lesson");
    await p.click("text=Continue: Introductions"); await wait(p, 600);
    ok((await p.getAttribute(".lesson__body", "data-act")) === "f01-p4", "D · resumes at the same activity");
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem("cpEnglish.v1")));
    ok(st.lessons.f01.done["f01-p1"] && st.lessons.f01.done["f01-p3"], "D · earlier answers preserved");
    await ctx.close();
  }

  /* ---------- E: microphone / API failure ---------- */
  {
    // no speech service (static server: /api is absent) → honest "unavailable", no score
    const { ctx, p, errs } = await fresh(b);
    await p.goto(BASE + "#/lesson/f01"); await wait(p, 500);
    await runLesson(p, "f01", { stopAt: "f01-s3" });
    await record(p, ".lesson__body");
    const txt = await p.textContent(".lesson__body");
    ok(/Automatic feedback isn't available/.test(txt), "E · service missing: the learner is told feedback is unavailable");
    ok(!/natural way to say it|Clear meaning|Answers the question/.test(txt), "E · no fabricated feedback or score");
    ok(await p.isVisible(".lesson__body >> text=My recording"), "E · the learner can still play back and compare his recording");
    ok(errs.length === 0, "E · no page errors " + errs.join(" | "));
    await ctx.close();
    // microphone unavailable → explained + typed fallback; placement marks speaking provisional
    const b2 = await chromium.launch();                       // no fake device: getUserMedia fails
    const c2 = await b2.newContext(); const q = await c2.newPage();
    mockApi(q, "A2");
    await takePlacement(q, "A2");
    await q.waitForSelector(".rec"); await q.click(".rec"); await wait(q, 800);
    const m = await q.textContent("main");
    ok(/Microphone unavailable/.test(m) && await q.isVisible("textarea"), "E · no microphone: explained, with a typed-answer option");
    for (let k = 0; k < 3; k++) { await q.click("text=I can't speak now"); await wait(q, 300); }
    await wait(q, 400);
    ok(/provisional/i.test(await q.textContent("main")), "E · without speaking, the placement is marked provisional");
    // unclear recording → told it's not a language mistake
    const { ctx: c3, p: r } = await fresh(b);
    mockApi(r, "A1", { unclear: true });
    await r.goto(BASE + "#/lesson/f01"); await wait(r, 500);
    await runLesson(r, "f01", { stopAt: "f01-s3" });
    await record(r, ".lesson__body");
    ok(/not a language mistake/.test(await r.textContent(".lesson__body")), "E · unclear recording: not treated as a language error");
    await c3.close(); await b2.close();
  }

  /* ---------- mobile ---------- */
  {
    const { ctx, p, errs } = await fresh(b, { ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    mockApi(p, "A1");
    for (const h of ["", "#/lesson/f01", "#/curriculum", "#/privacy"]) {
      await p.goto(BASE + h); await wait(p, 600);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(over <= 1, `mobile ${h || "home"}: no horizontal overflow (${over})`);
    }
    await p.goto(BASE + "#/lesson/f01"); await wait(p, 500);
    await runLesson(p, "f01", { stopAt: "f01-s1" });
    const rec = await p.$eval(".rec", (e) => e.getBoundingClientRect().width);
    ok(rec >= 72, `mobile: large record button (${rec}px)`);
    await shot(p, "m-speak");
    ok(errs.length === 0, "mobile: no page errors " + errs.join(" | "));
    await ctx.close();
  }

  /* ---------- privacy controls ---------- */
  {
    const { ctx, p } = await fresh(b);
    mockApi(p, "A1");
    await p.goto(BASE + "#/lesson/f01"); await wait(p, 400);
    await runLesson(p, "f01", { stopAt: "f01-s4" });
    await p.goto(BASE + "#/privacy"); await wait(p, 400);
    p.once("dialog", (d) => d.accept());
    await p.click("text=/Delete speaking history/"); await wait(p, 300);
    ok((await p.evaluate(() => JSON.parse(localStorage.getItem("cpEnglish.v1")).speaking.length)) === 0, "privacy: speaking history can be deleted");
    p.once("dialog", (d) => d.accept());
    await p.click("text=Delete everything"); await wait(p, 400);
    ok((await p.evaluate(() => localStorage.getItem("cpEnglish.v1"))) === null || /Take the placement test/.test(await p.textContent("main")), "privacy: everything can be deleted");
    await ctx.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
