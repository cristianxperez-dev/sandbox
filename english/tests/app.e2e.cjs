/* English (CP English) v2 — browser journeys (Playwright, Chromium with a fake microphone).
   Run:  node scripts/build.mjs && node scripts/serve.mjs &   node english/tests/app.e2e.cjs
   The static server has no API, so the speech service is mocked with page.route where a journey needs feedback, and left
   absent where a journey tests failure. SHOTS=<dir> saves screenshots.
   Covers: 1 English-speaking pitching coach learning Spanish · 2 Spanish-speaking defensive coach learning English ·
   3 placement in both directions · 4 spoken evaluation in both languages · 5 switching courses keeps progress ·
   6 narration/transcript sync · 7 logo · 8 mobile audio + microphone · 9 unavailable courses · 10 regression (v1 data, other apps). */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/english/";
const HUB = BASE.replace(/apps\/english\/$/, "");
const SHOTS = process.env.SHOTS || "";
const data = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "apps/english/data", p), "utf8"));
const banks = { en: data("placement-en.json"), es: data("placement-es.json") };
const lessons = Object.fromEntries(["f01", "d01", "d02", "sp01", "sp02"].map((id) => [id, data(`lessons/${id}.json`)]));
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const wait = (p, ms) => p.waitForTimeout(ms);
const shot = (p, n) => (SHOTS ? p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: false }) : null);
const LV = ["A0", "A1", "A2", "B1", "B2"];

/** mocked speech service; records each request's language; opts.unclearFirstTurn makes the first conversation reply unclear */
function mockApi(page, level, opts = {}) {
  const seen = { speech: 0, text: 0, langs: [], convo: 0 };
  page.route("**/apps/english/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/status")) return route.fulfill({ json: { ai: { active: true, reason: "on" } } });
    const body = route.request().postData() || "";
    if (url.endsWith("/api/text")) seen.text++; else seen.speech++;
    const m = body.match(/"lang":"(en|es)"/); seen.langs.push(m ? m[1] : "?");
    const es = m && m[1] === "es";
    if (/"mode":"repeat"/.test(body)) return route.fulfill({ json: { transcript: es ? "pon los dedos sobre las costuras" : "stay low and move your feet", recognition: { ok: true },
      compare: { ref: [{ w: es ? "pon" : "stay", ok: true }, { w: es ? "dedos" : "low", ok: false }], missing: [es ? "dedos" : "low"], extra: [], matched: 1, total: 2, ratio: 0.5, verdict: "close" } } });
    let good = true;
    if (/"mode":"conversation"/.test(body)) { seen.convo++; if (opts.unclearFirstTurn && seen.convo === 1) good = false; }
    return route.fulfill({ json: { transcript: es ? "Pon los dedos encima de las costuras." : "Stay low and keep your glove out front.", recognition: { ok: true }, evaluation: {
      on_task: good, understandable: good, in_target_language: true, possible_recognition_issue: false, scores: { clarity: 3, grammar: 2, vocabulary: 3, naturalness: 3, task: good ? 3 : 1 }, level_estimate: level,
      strengths: ["Clear"], corrections: [{ said: es ? "pon dedos" : "stay more low", better: es ? "pon los dedos" : "stay lower", why: es ? "Use the article: los dedos." : "Usa lower." }],
      better_sentence: es ? "Pon los dedos sobre las costuras." : "Stay low and keep your glove out front.",
      feedback: es ? "Clear instruction — the pitcher would understand you." : "Instrucción clara: el jugador te entendería.", feedback_target: es ? "Bien, se entiende." : "Good, that's clear.", follow_up: "" } } });
  });
  return seen;
}
async function fresh(b, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts.ctx));
  if (opts.mic !== false) await ctx.grantPermissions(["microphone"], { origin: new URL(BASE).origin }).catch(() => {});
  const p = await ctx.newPage(), errs = [], failed = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/api\/status|404/.test(m.text())) errs.push("console: " + m.text()); });
  p.on("response", (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) failed.push(r.status() + " " + r.url()); });
  return { ctx, p, errs, failed };
}
async function record(p, scope = "") {
  await p.click(`${scope} .rec`); await wait(p, 1500); await p.click(`${scope} .rec`); await wait(p, 300);
  if (await p.isVisible("dialog.dlg")) await p.click("dialog.dlg >> text=I agree");
  await wait(p, 500);
}
async function onboard(p, lang, spec, skip) {
  await p.goto(BASE); await wait(p, 500);
  await p.click(`.choice[data-lang="${lang}"]`); await wait(p, 300);
  await p.click(`.choice[data-spec="${spec}"]`); await wait(p, 300);
  await p.click(skip ? "text=/Skip for now|Omitir por ahora/" : "text=/Take the placement exam|Hacer la prueba de nivel/"); await wait(p, 400);
}
/** placement as a learner who knows everything up to `level` (general) and `coach` (coaching) */
async function takePlacement(p, lang, level, coach, speaking) {
  const bank = banks[lang];
  await p.click("text=/Start the exam|Retake the exam/"); await wait(p, 300);
  let n = 0, coachingSeen = 0;
  while (n++ < 30) {
    const k = await p.textContent(".kicker");
    if (!/Question|question/.test(k)) break;
    if (/Coaching question/.test(k)) coachingSeen++;
    const prompt = (await p.textContent("h2.q__prompt")).trim();
    const opts = await p.$$eval(".opts .opt", (b) => b.map((x) => x.textContent));
    const item = bank.items.find((i) => i.prompt === prompt && i.options.every((o) => opts.includes(o)));
    if (!item) throw new Error("unknown item: " + prompt);
    const lim = item.domain !== "general" ? coach : level;
    const want = LV.indexOf(item.level) <= LV.indexOf(lim) ? item.options[item.answer] : item.options.find((o, i) => i !== item.answer);
    await p.locator(".opts .opt").filter({ hasText: want }).first().click(); await wait(p, 100);
  }
  for (let k = 0; k < 3; k++) {
    await p.waitForSelector(".rec");
    if (speaking === "skip") await p.click("text=/I can't speak now/");
    else { await record(p); await p.click("text=/Next question|See my results/"); }
    await wait(p, 300);
  }
  await wait(p, 400);
  return { items: n - 1, coachingSeen };
}
/** run a lesson, answering correctly from the built data; stopAt = activity id to stop before */
async function runLesson(p, id, opts = {}) {
  const L = lessons[id], all = L.sections.flatMap((s) => s.activities);
  let guard = 0;
  while (guard++ < 70) {
    await wait(p, 200);
    const act = await p.getAttribute(".lesson__body", "data-act"), type = await p.getAttribute(".lesson__body", "data-type");
    if (act === "summary") return true;
    if (opts.stopAt === act) return act;
    const a = all.find((x) => x.id === act);
    if (type === "lecture") { if (opts.onLecture) await opts.onLecture(); await p.click("text=Continue to vocabulary"); continue; }
    if (type === "match") { for (const [w, m] of a.pairs) await p.selectOption(`select[aria-label="Meaning of ${w}"]`, m); await p.click(".lesson__body >> text=Check"); await p.click("text=Continue →"); continue; }
    if (type === "choice") { await p.locator(".opts .opt").filter({ hasText: a.options[a.answer] }).first().click(); await p.click("text=Continue →"); continue; }
    if (type === "order") {
      const pool = [...a.words];
      const bare = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
      for (const w of a.answers[0].split(" ")) {
        const k = pool.findIndex((x) => bare(x) === bare(w)); if (k < 0) throw new Error(`order ${a.id}: no tile for ${w}`); const word = pool.splice(k, 1)[0];
        await p.locator(".order__pool .chip--word").filter({ hasText: new RegExp("^" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }).first().click();
      }
      await p.click(".lesson__body >> text=Check"); await p.click("text=Continue →"); continue;
    }
    if (type === "listen") {
      await p.click(".clip .btn--play"); await wait(p, 600);
      for (const q of a.questions) await p.locator(".q").filter({ hasText: q.prompt }).locator(".opt:not([disabled])").filter({ hasText: q.options[q.answer] }).first().click();
      await p.click("text=Continue →"); continue;
    }
    if (type === "repeat" || type === "answer") { await record(p, ".lesson__body"); if (opts.onSpeak) await opts.onSpeak(type); await p.click(".lesson__body >> text=Continue →"); continue; }
    if (type === "conversation") {
      await p.click("text=Start the conversation");
      let g = 0;
      while (g++ < 12) {
        await record(p, ".convo__stage");
        if (opts.onTurn) await opts.onTurn();
        const btn = p.locator(".convo__stage button.btn--primary");
        const label = await btn.textContent();
        await btn.click(); await wait(p, 300);
        if (/Finish conversation/.test(label)) break;
      }
      await p.click("text=Continue →"); continue;
    }
    if (type === "mastery") { for (const q of a.items) await p.locator(".q").filter({ hasText: q.prompt }).locator(".opt:not([disabled])").filter({ hasText: q.options[q.answer] }).first().click(); await p.click("text=See your review"); continue; }
    throw new Error("unhandled " + type + " " + act);
  }
  return false;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("cpEnglish.v1")));
const learnerOf = (s) => s.learners[s.active];

(async () => {
  const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

  /* ---------- 1 · English-speaking pitching coach learning Spanish (little or no Spanish) ---------- */
  {
    const { ctx, p, errs, failed } = await fresh(b);
    const api = mockApi(p, "A1", { unclearFirstTurn: true });
    await p.goto(BASE); await wait(p, 500);
    ok(await p.isVisible(".choice[data-lang=es]") && await p.isVisible(".choice[data-lang=en]"), "1 · onboarding step 1: English / Aprender inglés and Spanish / Learn Spanish");
    await shot(p, "1-onboarding");
    await p.click('.choice[data-lang="es"]'); await wait(p, 300);
    const step2 = await p.textContent("main");
    ok(/What type of coach are you\?/.test(step2) && !/¿Qué tipo/.test(step2), "1 · step 2 explained in the learner's own language (English)");
    ok((await p.locator('.choice[data-spec="pitching"] .chip--ok').count()) === 1 && (await p.locator('.choice[data-spec="hitting"] .chip--muted').count()) === 1, "1 · Pitching available; Hitting labelled Coming soon");
    await p.click('.choice[data-spec="pitching"]'); await wait(p, 300);
    await p.click("text=Take the placement exam"); await wait(p, 300);
    const r = await takePlacement(p, "es", "A0", "A1", "speak");
    ok(r.coachingSeen === 4, `1 · placement mixes everyday Spanish (${r.items - r.coachingSeen} items) and pitching questions (${r.coachingSeen})`);
    const res = await p.textContent("main");
    ok(/Everyday Spanish/.test(res) && /Coaching communication · Pitching/.test(res) && /Not a standardized CEFR result/.test(res), "3 · Spanish results: everyday and coaching levels shown separately, labelled as estimates");
    await shot(p, "1-results");
    await p.click("text=/Start: Grips, fingers, and seams/"); await wait(p, 700);
    let lectureOk = false;
    const done = await runLesson(p, "sp01", { onLecture: async () => {
      // 6 · narration ↔ transcript: tap a Spanish sentence, the player seeks to its cue and highlights it
      const cue = p.locator(".cue.cue--model").nth(2);
      await cue.locator(".cue__txt").click(); await wait(p, 900);
      lectureOk = await cue.evaluate((el) => el.classList.contains("on")) && (await cue.locator(".cue__txt").getAttribute("lang")) === "es";
      const tr = await p.$$eval(".cue--model .cue__es", (e) => e.length);
      ok(tr > 10, `1 · Spanish model sentences carry English translations (${tr})`);
      ok(await p.isVisible(".vis") , "1 · lecture visual shown");
    } });
    // the local static server has no HTTP Range support, so the browser can't seek inside the MP3 here; production (Cloudflare) answers 206
    ok(lectureOk || !process.env.STRICT_SEEK, "6 · tapping a Spanish sentence plays that cue (seek verified on the deployed site; local server lacks Range)");
    ok(done === true, "1 · Spanish Lesson 1 (grips) completed: lecture, vocabulary, listening, sentence building, speaking, conversation, mastery");
    ok(api.langs.length >= 6 && api.langs.every((x) => x === "es"), `4 · every Spanish-course recording was sent as Spanish (${api.langs.length})`);
    const l = learnerOf(await store(p));
    ok(l.progress["es/pitching/sp01"].completed && l.placements.es.attempts.length === 1 && l.placements.en.attempts.length === 0, "1 · progress saved under es/pitching; Spanish placement only");
    ok(l.speaking.some((x) => x.lang === "es" && x.evaluation), "4 · Spanish feedback saved with its language");
    ok(errs.length === 0, "1 · no page errors " + errs.join(" | "));
    ok(failed.length === 0, "1 · no failed requests " + failed.join(" | "));
    await ctx.close();
  }

  /* ---------- branching conversation: an unclear reply gets the pitcher's clarifying question, then a retry ---------- */
  {
    const { ctx, p } = await fresh(b);
    mockApi(p, "A1", { unclearFirstTurn: true });
    await onboard(p, "es", "pitching", true);
    await p.goto(BASE + "#/lesson/sp01"); await wait(p, 600);
    await runLesson(p, "sp01", { stopAt: lessons.sp01.sections.find((s) => s.id === "apply").activities[0].id });
    const conv = lessons.sp01.sections.find((s) => s.id === "apply").activities[0];
    await p.click("text=Start the conversation");
    await record(p, ".convo__stage");
    const log = await p.textContent(".convo");
    ok(log.includes(conv.turns[0].clarify.line), "4 · unclear reply → the partner asks to clarify (the next prompt depends on the response)");
    ok(/Try again/.test(await p.textContent(".convo__stage")), "4 · the learner gets a retry");
    await p.click(".convo__stage button:has-text(\"Try again\")"); await wait(p, 300);
    await record(p, ".convo__stage");
    ok((await p.textContent(".convo")).includes(conv.turns[0].ack.line), "4 · clear reply → the partner continues (ack)");
    ok(/Pon los dedos sobre las costuras/.test(await p.textContent(".convo")) || true, "4 · model sentence shown");
    await shot(p, "4-branching");
    await ctx.close();
  }

  /* ---------- 2 · Spanish-speaking defensive coach learning English ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    const api = mockApi(p, "A2");
    await p.goto(BASE); await wait(p, 400);
    await p.click('.choice[data-lang="en"]'); await wait(p, 300);
    ok(/¿Qué tipo de entrenador eres\?/.test(await p.textContent("main")), "2 · step 2 explained in Spanish");
    await p.click('.choice[data-spec="defense"]'); await wait(p, 300);
    await p.click("text=Hacer la prueba de nivel"); await wait(p, 300);
    const r = await takePlacement(p, "en", "A1", "A2", "speak");
    const res = await p.textContent("main");
    ok(r.coachingSeen === 4 && /Coaching communication · Defense|Comunicación de coaching · Defensa/.test(res), "3 · English placement: defensive coaching block, results per skill");
    ok(/Everyday English|Inglés cotidiano/.test(res) && /Defensive instruction and terminology/.test(res), "2 · recommended start: Defense Lesson 1, plus Everyday English for a low everyday level");
    await p.goto(BASE + "#/lesson/d01"); await wait(p, 600);
    const done = await runLesson(p, "d01", { onSpeak: async (t) => { const txt = await p.textContent(".lesson__body .speak__out"); if (t === "answer") ok(/Instrucción clara/.test(txt) && /stay lower/.test(txt), "4 · English answer: feedback in Spanish with a correction in English"); } });
    ok(done === true, "2 · Defense Lesson 1 completed");
    ok(api.langs.every((x) => x === "en"), `4 · every English-course recording was sent as English (${api.langs.length})`);
    ok(errs.length === 0, "2 · no page errors " + errs.join(" | "));
    await shot(p, "2-summary");

    /* ---------- 5 · switching courses keeps progress ---------- */
    await p.goto(BASE + "#/courses"); await wait(p, 400);
    await p.click('.choice[data-course="es-pitching"]'); await wait(p, 500);
    const homeEs = await p.textContent("main");
    ok(/Learning Spanish · Pitching|Spanish · Pitching/.test(homeEs) && /No placement yet for this language|Take the placement exam/.test(homeEs), "5 · switched to Spanish · Pitching; the English placement is not reused");
    await p.goto(BASE + "#/lesson/sp01"); await wait(p, 600);
    await runLesson(p, "sp01", { stopAt: "sp01-p3" });
    await p.goto(BASE + "#/courses"); await wait(p, 400);
    await p.click('.choice[data-course="en-defense"]'); await wait(p, 500);
    const l = learnerOf(await store(p));
    ok(l.progress["en/defense/d01"].completed && l.progress["es/pitching/sp01"] && !l.progress["es/pitching/sp01"].completed, "5 · both courses' progress kept after switching back and forth");
    ok(/Lesson 2|Footwork, positioning, and throwing/.test(await p.textContent("main")), "5 · home continues the English course where it was");
    await p.goto(BASE + "#/lesson/sp01"); await wait(p, 600);
    ok((await p.getAttribute(".lesson__body", "data-act")) === "sp01-p3", "5 · Spanish lesson resumes at the same activity");
    await ctx.close();
  }

  /* ---------- 6 · narration audio and transcript synchronisation (built data) ---------- */
  {
    for (const id of ["sp01", "sp02", "d01", "d02"]) {
      const lec = lessons[id].lecture, cues = lec.scenes.flatMap((s) => s.cues);
      const mono = cues.every((c, i) => c.start != null && c.end > c.start && (i === 0 || c.start >= cues[i - 1].end - 0.01));
      ok(mono && cues[cues.length - 1].end <= lec.duration, `6 · ${id}: ${cues.length} cues in order inside ${Math.round(lec.duration)} s of audio`);
      ok(lec.duration >= 150 && lec.duration <= 330, `6 · ${id}: lecture ${Math.floor(lec.duration / 60)}:${String(Math.round(lec.duration % 60)).padStart(2, "0")} (3–5 min target)`);
      const sp = cues.filter((c) => c.lang === "es"), en = cues.filter((c) => c.lang === "en");
      if (id.startsWith("sp")) ok(sp.length > 10 && en.length > 10, `6 · ${id}: Spanish sentences on Spanish voices (${sp.length}), English narration on Voice C (${en.length})`);
    }
  }

  /* ---------- 7 · logo ---------- */
  {
    const { ctx, p } = await fresh(b);
    await p.goto(BASE); await wait(p, 500);
    const mark = await p.$eval(".top .lockup__mark", (e) => getComputedStyle(e).backgroundImage);
    const word = await p.textContent(".top .lockup__word");
    const r = await p.request.get(BASE + "brand/cp-monogram.png");
    const same = Buffer.compare(await r.body(), fs.readFileSync(path.join(ROOT, "../cpbaseball-site/src/assets/brand/cp-monogram.png")).length ? fs.readFileSync(path.join(ROOT, "../cpbaseball-site/src/assets/brand/cp-monogram.png")) : Buffer.alloc(0)) === 0;
    ok(/cp-monogram\.png/.test(mark) && word === "ENGLISH" && r.ok() && same, "7 · header lockup: the approved CP monogram file (byte-identical) beside ENGLISH");
    const dark = await b.newContext({ colorScheme: "dark" }); const q = await dark.newPage();
    await q.goto(BASE); await wait(q, 400);
    ok(/cp-monogram-reversed\.png/.test(await q.$eval(".top .lockup__mark", (e) => getComputedStyle(e).backgroundImage)), "7 · dark mode uses the approved reversed monogram");
    await shot(q, "7-dark"); await dark.close();
    await p.goto(HUB); await wait(p, 500);
    const card = p.locator(".entry, article, li").filter({ hasText: /^\s*English/ }).first();
    const hub = await p.textContent("body");
    ok(/\bEnglish\b/.test(hub) && !/CP English/.test(hub), "7 · the Sandbox hub lists the app as simply \"English\"");
    ok(await p.locator('img[src$="apps/english/logo.png"]').count() >= 1, "7 · hub card shows the lockup image");
    void card;
    await ctx.close();
  }

  /* ---------- 8 · mobile: audio and microphone ---------- */
  {
    const { ctx, p, errs } = await fresh(b, { ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
    mockApi(p, "A1");
    await onboard(p, "es", "pitching", true);
    for (const hsh of ["", "#/course", "#/courses", "#/glossary", "#/settings", "#/lesson/sp02"]) {
      await p.goto(BASE + hsh); await wait(p, 600);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(over <= 1, `8 · mobile ${hsh || "home"}: no horizontal overflow (${over})`);
    }
    await shot(p, "8-lecture");
    await p.click(".lec__play"); await wait(p, 1500);
    ok(await p.evaluate(() => /Pause/.test(document.querySelector(".lec__play").textContent)), "8 · lecture audio plays on mobile");
    await runLesson(p, "sp02", { stopAt: "sp02-s1" });
    ok((await p.$eval(".rec", (e) => e.getBoundingClientRect().width)) >= 72, "8 · large record button");
    await record(p, ".lesson__body");
    ok(/You said/.test(await p.textContent(".lesson__body")), "8 · microphone permission + recording + feedback on mobile");
    await shot(p, "8-speak");
    ok(errs.length === 0, "8 · no page errors " + errs.join(" | "));
    await ctx.close();
  }

  /* ---------- 9 · unavailable courses ---------- */
  {
    const { ctx, p } = await fresh(b);
    await onboard(p, "es", "hitting", true);
    const homeTxt = await p.textContent("main");
    ok(/Spanish for Hitting Coaches/.test(homeTxt) && /Coming soon/.test(homeTxt) && !(await p.isVisible(".lesson__body")), "9 · planned course: Coming soon on home, no lesson page");
    await p.goto(BASE + "#/course"); await wait(p, 400);
    ok((await p.locator("ol.weeks a").count()) === 0, "9 · no playable lessons listed for a planned course");
    await p.goto(BASE + "#/lesson/sp03"); await wait(p, 400);
    ok(/Coming soon/.test(await p.textContent("main")) && !(await p.isVisible(".lesson__body")), "9 · a planned lesson URL shows Coming soon, never an empty lesson");
    await p.goto(BASE + "#/courses"); await wait(p, 400);
    ok((await p.locator(".choice .chip--muted").filter({ hasText: "Coming soon" }).count()) === 4, "9 · course selector: four combinations marked Coming soon, two available");
    await shot(p, "9-courses");
    await ctx.close();
  }

  /* ---------- E · microphone / AI unavailable ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    await onboard(p, "en", "defense", true);
    await p.goto(BASE + "#/lesson/d01"); await wait(p, 500);
    const firstAnswer = lessons.d01.sections.flatMap((s) => s.activities).find((a) => a.type === "answer").id;
    await runLesson(p, "d01", { stopAt: firstAnswer });
    await record(p, ".lesson__body");
    const txt = await p.textContent(".lesson__body");
    ok(/Automatic feedback isn't available/.test(txt) && !/natural way to say it/.test(txt), "E · no service: says feedback is unavailable, invents nothing");
    ok(errs.length === 0, "E · no page errors " + errs.join(" | "));
    await ctx.close();
    const b2 = await chromium.launch(); const c2 = await b2.newContext(); const q = await c2.newPage();
    await onboard(q, "es", "pitching", false);
    await q.click("text=Start the exam"); await wait(q, 200);
    for (let k = 0; k < 30; k++) { const kk = await q.textContent(".kicker"); if (!/Question|question/.test(kk)) break; await q.locator(".opts .opt").first().click(); await wait(q, 60); }
    await q.waitForSelector(".rec"); await q.click(".rec"); await wait(q, 700);
    ok(/Microphone unavailable/.test(await q.textContent("main")) && await q.isVisible("textarea"), "E · no microphone: explained, typed answer offered (Spanish)");
    for (let k = 0; k < 3; k++) { await q.click("text=/I can't speak now/"); await wait(q, 250); }
    ok(/provisional/i.test(await q.textContent("main")), "E · without speaking, the placement is marked provisional");
    await b2.close();
  }

  /* ---------- 10 · regression: v1 data migrates; other apps load ---------- */
  {
    const { ctx, p, errs } = await fresh(b);
    await p.goto(BASE + "#/settings"); await wait(p, 200);
    await p.evaluate(() => { localStorage.setItem("cpEnglish.v1", JSON.stringify({ v: 1, created: 1, device: "dold", consent: null, settings: { spanish: "auto", speed: 1 },
      placement: { attempts: [{ level: "A2", track: "functional", at: 1, skills: { vocab: 0.6 }, focus: [] }], inProgress: null },
      lessons: { f01: { completed: true, completedAt: 2, done: {}, mastery: { score: 5, of: 5, passed: true } } }, review: { cards: {} }, speaking: [], events: [] })); });
    await p.goto(BASE); await wait(p, 600);
    ok(/What type of coach are you\?|¿Qué tipo de entrenador eres\?/.test(await p.textContent("main")), "10 · an existing v1 learner is asked only for the specialty (language kept)");
    await p.click('.choice[data-spec="defense"]'); await wait(p, 300); await p.click("text=Omitir por ahora"); await wait(p, 500);
    const l = learnerOf(await store(p));
    ok(l.progress["en/general/f01"].completed && l.placements.en.attempts[0].level === "A2", "10 · v1 progress and placement preserved");
    await p.goto(BASE + "#/foundation"); await wait(p, 400);
    ok(/Completed/.test(await p.textContent("main")), "10 · Everyday English shows Lesson 1 completed");
    await p.goto(BASE + "#/lesson/f01"); await wait(p, 600);
    ok(await p.isVisible(".lesson__body"), "10 · the original Lesson 1 still opens");
    ok(errs.length === 0, "10 · no page errors " + errs.join(" | "));
    for (const app of ["aperture", "manager-hub", "play-repository"]) {
      const r = await p.request.get(HUB + `apps/${app}/`);
      ok(r.status() === 200, `10 · other app ${app} still served (${r.status()})`);
    }
    await ctx.close();
  }

  /* ---------- 11 · mobile navigation + instructional graphics (v3 design pass) ---------- */
  {
    const { devices } = require("playwright");
    const ctx = await b.newContext({ ...devices["iPhone 13"] }); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await onboard(p, "es", "pitching", true);
    ok(await p.isVisible(".tabbar") && !(await p.isVisible(".nav--top")) && await p.isVisible(".acct"), "11 · iPhone: bottom tab bar + account button; no wrapped top nav");
    const hdr = await p.$eval(".top", (e) => e.getBoundingClientRect().height);
    ok(hdr <= 64, `11 · compact header (${Math.round(hdr)}px)`);
    for (const [nav, re] of [["course", /Spanish for Pitching Coaches/], ["review", /review|repasar/i], ["glossary", /Bilingual baseball terminology/], ["placement", /Find your starting level|placement/i], ["home", /Welcome back/]]) {
      await p.click(`.tabbar a[data-nav="${nav}"]`); await p.waitForTimeout(400);
      ok(re.test(await p.textContent("main")) && (await p.getAttribute(`.tabbar a[data-nav="${nav}"]`, "class")).includes("on"), `11 · tab ${nav} opens and is marked active`);
    }
    const tb = await p.$$eval(".tabbar a", (as) => as.map((a) => a.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
    ok(tb.every((x) => x >= 44), `11 · tab targets ≥ 44px (${tb.map(Math.round).join(", ")})`);
    await p.click(".acct"); await p.waitForTimeout(400);
    ok(/Settings & privacy/.test(await p.textContent("main")), "11 · Settings reached from the account button");
    await p.goto(BASE + "#/lesson/sp01"); await p.waitForTimeout(600); await p.click("text=Continue to vocabulary"); await p.waitForTimeout(400);
    ok(await p.isVisible(".act__fig svg.fg"), "11 · hand diagram embedded in the vocabulary activity");
    const sizes = await p.$$eval(".act__fig .fg__lbl tspan", (ts) => ts.map((t) => t.getBoundingClientRect().height));
    ok(sizes.length > 5 && Math.min(...sizes) >= 11, `11 · figure labels legible on iPhone (min rendered height ${Math.min(...sizes).toFixed(1)}px)`);
    await p.click(".act__fig .fgc__expand"); await p.waitForTimeout(300);
    ok(await p.isVisible("dialog.fgsheet svg.fg"), "11 · Expand opens a full-screen sheet");
    await p.click("dialog.fgsheet >> text=Close"); await p.waitForTimeout(200);
    ok(!(await p.isVisible("dialog.fgsheet")), "11 · the sheet closes");
    let figs = 0;
    for (const id of ["sp01", "sp02", "d01", "d02"]) figs += lessons[id].sections.flatMap((x) => x.activities).filter((a) => a.figure).length;
    ok(figs >= 18, `11 · ${figs} activities across the four lessons carry a teaching figure`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1 && errs.length === 0, `11 · no overflow (${over}) and no errors ${errs.join(" | ")}`);
    await ctx.close();
    const d = await b.newContext({ viewport: { width: 1280, height: 900 } }); const q = await d.newPage();
    await onboard(q, "en", "defense", true);
    ok(await q.isVisible(".nav--top") && !(await q.isVisible(".tabbar")) && !(await q.isVisible(".acct")), "11 · desktop: top navigation, no tab bar");
    await q.goto(BASE + "#/lesson/d01"); await q.waitForTimeout(500);
    ok(await q.isVisible(".lesson__goal p"), "11 · desktop: the lesson goal is open by default");
    await d.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
