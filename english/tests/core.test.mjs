/* English (CP English) — core logic tests, v2: placement (both languages, general vs coaching), scoring, store + migration,
   progress per course, review queue, recommendations.  node --test english/tests/core.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../apps/english/core.js");            // a browser script: it attaches itself as globalThis.CPE
const C = globalThis.CPE;
const J = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const enBase = J("../content/placement.json"), enCoach = J("../content/placement-en-coaching.json");
const bankEn = { id: "placement-en", target: "en", items: enBase.items.concat(enCoach.items), speaking: enBase.speaking.concat(enCoach.speaking) };
const bankEs = J("../content/placement-es.json");
const catalog = J("../content/catalog.json");
catalog.courses.forEach((c) => (c.key = `${c.target}/${c.specialty}`));
const foundation = { key: "en/general", lessons: J("../content/course.json").lessons, title: "Everyday English" };

/** run the objective + coaching parts with a simulated learner: knows(item) → answers right */
function simulate(bank, knows, seed = 7, opts) {
  const s = C.newPlacement(bank, Object.assign({ seed }, opts));
  let guard = 0;
  while ((s.phase === "objective" || s.phase === "coaching") && guard++ < 40) {
    const it = C.nextItem(s, bank);
    if (!it) { s.phase = "speaking"; break; }
    C.answerItem(s, it, knows(it) ? it.answer : (it.answer + 1) % it.options.length, 4000, bank);
  }
  return s;
}
const upTo = (L, coachL) => (it) => C.lv(it.level) <= C.lv((it.domain && it.domain !== "general" && coachL) || L);

test("a true beginner is placed at A0 and the general part stops early (both languages)", () => {
  for (const bank of [bankEn, bankEs]) for (const seed of [1, 2, 3, 4, 5]) {
    const s = simulate(bank, () => false, seed);
    assert.ok(s.asked.length <= 8, `stopped after ${s.asked.length}`);
    assert.equal(C.objectiveLevel(s.asked), "A0");
  }
});

test("learners at each level are placed at that level, in English and in Spanish", () => {
  for (const bank of [bankEn, bankEs]) for (const L of ["A1", "A2", "B1", "B2"]) for (const seed of [11, 22, 33]) {
    const s = simulate(bank, upTo(L), seed);
    assert.ok(s.asked.length >= C.PL.minItems && s.asked.length <= C.PL.maxItems, `${bank.id} ${L}: ${s.asked.length} items`);
    assert.equal(C.objectiveLevel(s.asked), L, `${bank.id} ${L} seed ${seed}`);
  }
});

test("the coaching block follows the general part, uses only the learner's specialty, and never moves the general level", () => {
  for (const [bank, spec] of [[bankEn, "defense"], [bankEs, "pitching"]]) {
    const s = simulate(bank, upTo("A2"), 5, { specialty: spec });
    assert.equal(s.coaching.length, C.PL.coachingItems);
    assert.ok(s.coaching.every((c) => c.domain === spec));
    assert.ok(s.asked.every((a) => a.domain === "general"));
    assert.equal(s.phase, "speaking");
  }
  const none = simulate(bankEs, upTo("A2"), 5, { specialty: "hitting" });   // a planned specialty: no coaching items yet
  assert.equal(none.coaching.length, 0); assert.equal(none.phase, "speaking");
});

test("general and coaching ability are scored separately (knows the field terms, weak everyday language — and the reverse)", () => {
  const techie = simulate(bankEs, upTo("A1", "B2"), 9, { specialty: "pitching" });
  const r1 = C.placementResult(techie);
  assert.equal(r1.generalLevel, "A1");
  assert.ok(C.lv(r1.coachingLevel) > C.lv(r1.generalLevel), `coaching ${r1.coachingLevel} vs general ${r1.generalLevel}`);
  const talker = simulate(bankEn, upTo("B1", "A0"), 9, { specialty: "defense" });
  const r2 = C.placementResult(talker);
  assert.equal(r2.generalLevel, "B1");
  assert.ok(C.lv(r2.coachingLevel) < C.lv(r2.generalLevel));
  const gen = ["vocab", "grammar", "reading", "listening"].map((k) => r2.skills[k]).filter((v) => v != null);
  assert.ok(r2.skills.coaching < 0.5 && gen.reduce((a, b) => a + b, 0) / gen.length > r2.skills.coaching);
});

test("spoken tasks: two general for the level plus one coaching scenario for the specialty", () => {
  for (const [bank, spec] of [[bankEn, "defense"], [bankEs, "pitching"]]) for (const L of C.LEVELS) {
    const t = C.speakingTasks(bank, L, spec);
    assert.equal(t.length, 3);
    assert.equal(t.filter((x) => x.domain === spec).length, 1, `${bank.id} ${L}`);
    if (C.lv(L) >= 3) assert.ok(C.lv(t[2].level) >= 3, "advanced learners get the harder scenario");
  }
  assert.equal(C.speakingTasks(bankEs, "A2", "hitting").filter((x) => (x.domain || "general") === "general").length, 3, "no scenario → three general tasks");
});

test("speaking combines with the general level; without it the result is provisional", () => {
  const s = simulate(bankEn, upTo("B1"), 3, { specialty: "defense" });
  const tasks = C.speakingTasks(bankEn, "B1", "defense");
  const ev = (lvl) => ({ evaluation: { level_estimate: lvl, scores: { clarity: 2, grammar: 2, vocabulary: 2, naturalness: 2, task: 2 } } });
  const a = JSON.parse(JSON.stringify(s)); tasks.forEach((x) => C.answerSpeaking(a, x, ev("A2")));
  const ra = C.placementResult(a);
  assert.equal(ra.objectiveLevel, "B1"); assert.equal(ra.speakingLevel, "A2"); assert.equal(ra.generalLevel, "B1"); assert.equal(ra.provisional, false);
  const b = JSON.parse(JSON.stringify(s)); tasks.forEach((x) => C.answerSpeaking(b, x, ev("A1")));
  assert.equal(C.placementResult(b).generalLevel, "A2", "never more than one level above how he speaks");
  const c = JSON.parse(JSON.stringify(s)); tasks.forEach((x) => C.answerSpeaking(c, x, null));
  const rc = C.placementResult(c);
  assert.equal(rc.provisional, true); assert.equal(rc.skills.speaking, null); assert.equal(rc.lang, "en"); assert.equal(rc.specialty, "defense");
});

test("skipping the exam gives a clearly labelled provisional beginner placement", () => {
  const r = C.skippedPlacement("es", "pitching");
  assert.equal(r.skipped, true); assert.equal(r.provisional, true); assert.equal(r.generalLevel, "A0"); assert.equal(r.coachingLevel, null);
});

test("store v1 → v2 migration keeps lessons, placements, review and speaking history", () => {
  const v1 = { v: 1, created: 5, device: "dabc", consent: { v: 1, ok: true }, settings: { spanish: "always" },
    placement: { attempts: [{ level: "A2", track: "functional", at: 10, skills: {} }], inProgress: null },
    lessons: { f01: { completed: true, completedAt: 20, done: { "f01-p1": { correct: true } } } },
    review: { cards: { "f01:f01-p2": { id: "f01:f01-p2", box: 1, due: 0 } } }, speaking: [{ at: 1, lesson: "f01" }], events: [{ type: "lesson" }] };
  const s = C.migrate(v1);
  assert.equal(s.v, 2); assert.equal(s.device, "dabc"); assert.equal(s.settings.support, "always");
  const l = C.learner(s);
  assert.equal(l.profile.target, "en"); assert.equal(l.profile.native, "es"); assert.equal(l.profile.onboarded, false);
  assert.equal(l.progress["en/general/f01"].completed, true);
  assert.equal(C.currentPlacement(l, "en").generalLevel, "A2");
  assert.equal(C.currentPlacement(l, "es"), null, "an English result is never reused for Spanish");
  assert.equal(l.review.cards["f01:f01-p2"].course, "en/general");
  assert.equal(l.speaking.length, 1);
  assert.deepEqual(C.migrate(JSON.parse(JSON.stringify(s))).learners[s.active].progress, l.progress, "v2 survives a reload");
  assert.equal(C.migrate(null).v, 2);
});

test("progress is keyed by course: switching language or specialty keeps everything", () => {
  const s = C.emptyStore(), l = C.learner(s);
  l.profile = { target: "es", native: "en", specialty: "pitching", onboarded: true };
  C.recordActivity(l, "es/pitching/sp01", "sp01-p1", { correct: true });
  C.completeLesson(l, "es/pitching/sp01", { score: 5, of: 5, passed: true });
  l.profile = { target: "en", native: "es", specialty: "defense", onboarded: true };
  C.recordActivity(l, "en/defense/d01", "d01-p1", { correct: false });
  l.profile = { target: "es", native: "en", specialty: "pitching", onboarded: true };
  assert.equal(l.progress["es/pitching/sp01"].completed, true);
  assert.equal(l.progress["en/defense/d01"].done["d01-p1"].correct, false);
  const es = catalog.courses.find((c) => c.id === "es-pitching");
  assert.deepEqual(C.courseProgress(l, "es/pitching", es.lessons), { done: 1, started: 1, available: 2, total: 5 });
});

test("retakes are per language: blocked for a day unless a lesson in that language was completed since", () => {
  const now = Date.now(), l = C.newLearner(now);
  assert.equal(C.canRetake(l, "es", now).ok, true);
  C.placementsOf(l, "es").attempts.push({ at: now, level: "A1" });
  assert.equal(C.canRetake(l, "es", now + 3600e3).ok, false);
  assert.equal(C.canRetake(l, "en", now + 3600e3).ok, true, "the other language is independent");
  l.progress["en/defense/d01"] = { completed: true, completedAt: now + 60e3 };
  assert.equal(C.canRetake(l, "es", now + 3600e3).ok, false, "an English lesson doesn't unlock the Spanish retake");
  l.progress["es/pitching/sp01"] = { completed: true, completedAt: now + 60e3 };
  assert.equal(C.canRetake(l, "es", now + 3600e3).ok, true);
  C.placementsOf(l, "en").attempts.push(C.skippedPlacement("en", "defense", now));
  assert.equal(C.canRetake(l, "en", now + 60e3).ok, true, "a skipped placement never blocks");
});

test("recommendations: course lesson first; the shared foundation when everyday language is weak; planned courses say so", () => {
  const l = C.newLearner();
  l.profile = { target: "es", native: "en", specialty: "pitching", onboarded: true };
  let r = C.recommend(l, catalog, null);
  assert.equal(r.lesson.id, "sp01"); assert.equal(r.mode, "start"); assert.ok(r.reasons.some((x) => x.skill === "placement"));
  l.progress["es/pitching/sp01"] = { completed: true, done: {} };
  assert.equal(C.recommend(l, catalog, null).lesson.id, "sp02");
  const d = C.newLearner();
  d.profile = { target: "en", native: "es", specialty: "defense", onboarded: true };
  C.placementsOf(d, "en").attempts.push({ generalLevel: "A1", level: "A1", coachingLevel: "A2", skills: { listening: 0.3 }, at: 1 });
  r = C.recommend(d, catalog, foundation);
  assert.equal(r.lesson.id, "d01"); assert.equal(r.also.id, "f01");
  assert.ok(r.reasons.some((x) => x.skill === "general" && /Everyday English/.test(x.en)));
  assert.ok(r.reasons.some((x) => x.skill === "listening"));
  const p = C.newLearner();
  p.profile = { target: "es", native: "en", specialty: "hitting", onboarded: true };
  assert.equal(C.recommend(p, catalog, null).mode, "planned");
});

test("deterministic grading, incl. Spanish sentence building", () => {
  const q = { options: ["a", "b", "c"], answer: 1 };
  assert.equal(C.gradeChoice(q, 1), true); assert.equal(C.gradeChoice(q, 0), false);
  assert.equal(C.gradeOrder({ answers: ["I work with young players"] }, ["I", "work", "with", "young", "players"]), true);
  assert.equal(C.gradeOrder({ answers: ["¿Cómo se siente ese agarre?"] }, ["¿Cómo", "se", "siente", "ese", "agarre?"]), true);
  assert.equal(C.gradeOrder({ answers: ["Afloja un poco el agarre"] }, ["Afloja", "el", "agarre", "un", "poco"]), false);
  assert.deepEqual(C.gradeMatch({ pairs: [["pulgar", "thumb"], ["costuras", "seams"]] }, { pulgar: "thumb", costuras: "thumb" }), ["costuras"]);
  const shown = C.orderOptions(["x", "y", "z"], 123);
  assert.deepEqual(shown.map((s) => s.i).sort(), [0, 1, 2]);
  assert.deepEqual(C.orderOptions(["x", "y", "z"], 123), shown, "stable for the same seed");
});

test("review queue: misses come back, spaced; success moves them out", () => {
  const t0 = Date.now(), l = C.newLearner(t0);
  C.addReview(l, { id: "sp01:sp01-p2", kind: "item", course: "es/pitching" }, t0);
  assert.equal(C.dueCards(l, t0).length, 1);
  C.reviewAnswer(l, "sp01:sp01-p2", true, t0);
  assert.equal(C.dueCards(l, t0 + 3600e3).length, 0);
  assert.equal(C.dueCards(l, t0 + 1.1 * 86400e3).length, 1);
  C.reviewAnswer(l, "sp01:sp01-p2", false, t0 + 1.1 * 86400e3);
  assert.equal(l.review.cards["sp01:sp01-p2"].box, 0);
  for (let k = 0; k < 7; k++) C.reviewAnswer(l, "sp01:sp01-p2", true, t0 + 400 * 86400e3);
  assert.ok(l.review.cards["sp01:sp01-p2"].mastered);
});

test("lesson skills never turn ungraded speech into a score", () => {
  const l = C.newLearner(), lesson = J("../content/lessons/sp01.json");
  const first = lesson.sections.flatMap((s) => s.activities).filter((a) => a.skill && a.type === "choice").slice(0, 2);
  C.recordActivity(l, "es/pitching/sp01", first[0].id, { correct: true });
  C.recordActivity(l, "es/pitching/sp01", first[1].id, { correct: false });
  C.recordActivity(l, "es/pitching/sp01", "sp01-s1", { correct: null, practiced: true });
  const skills = C.lessonSkills(l.progress["es/pitching/sp01"], lesson);
  assert.equal(skills.speaking, undefined);
  assert.ok(Object.values(skills).every((v) => v >= 0 && v <= 1));
});

test("translation support defaults by the level in the language being learned", () => {
  const s = C.emptyStore(), l = C.learner(s);
  l.profile = { target: "es", native: "en", specialty: "pitching", onboarded: true };
  assert.equal(C.supportDefault(s), true);
  C.placementsOf(l, "es").attempts.push({ generalLevel: "B1", level: "B1" });
  assert.equal(C.supportDefault(s), false);
  l.profile.target = "en";
  assert.equal(C.supportDefault(s), true, "no English placement yet → support on");
  s.settings.support = "never"; assert.equal(C.supportDefault(s), false);
});

test("content: lessons carry translations in the learner's language; Spanish narration never mixes languages", () => {
  for (const f of ["f01", "f03", "d01", "d02"]) {
    const L = J(`../content/lessons/${f}.json`);
    for (const sc of L.lecture.scenes) for (const c of sc.cues) assert.ok(c.es && c.es.length > 1, `${f}: ${c.text}`);
  }
  for (const f of ["sp01", "sp02"]) {
    const L = J(`../content/lessons/${f}.json`);
    for (const sc of L.lecture.scenes) for (const c of sc.cues) {
      if (c.speaker) assert.ok(c.en, `${f}: Spanish cue without English: ${c.text}`);
      else assert.ok(!/[áéíóúñ¿¡]/i.test(c.say || c.text), `${f}: narrator reads Spanish: ${c.text}`);
    }
  }
  for (const b of [bankEn, bankEs]) for (const L of C.LEVELS) assert.ok(b.items.filter((i) => i.level === L && (i.domain || "general") === "general").length >= 6);
});
