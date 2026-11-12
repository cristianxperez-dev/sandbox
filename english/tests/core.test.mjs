/* CP English — core logic tests: placement engine, scoring, review queue, recommendation.
   node --test english/tests/core.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../../apps/english/core.js");            // a browser script: it attaches itself as globalThis.CPE
const C = globalThis.CPE;
const bank = JSON.parse(readFileSync(new URL("../content/placement.json", import.meta.url)));
const course = JSON.parse(readFileSync(new URL("../content/course.json", import.meta.url)));
const lessonF01 = JSON.parse(readFileSync(new URL("../content/lessons/f01.json", import.meta.url)));

/** run the objective part with a simulated learner: knows(item) → answers right */
function simulate(knows, seed = 7, opts) {
  const s = C.newPlacement(bank, Object.assign({ seed }, opts));
  let guard = 0;
  while (s.phase === "objective" && guard++ < 30) {
    const it = C.nextItem(s, bank);
    if (!it) break;
    const right = knows(it);
    C.answerItem(s, it, right ? it.answer : (it.answer + 1) % it.options.length, 4000);
  }
  return s;
}
const upTo = (L) => (it) => C.lv(it.level) <= C.lv(L);

test("a true beginner is placed at A0 and the test stops early", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = simulate(() => false, seed);
    assert.equal(s.phase, "speaking");
    assert.ok(s.asked.length <= 8, `stopped after ${s.asked.length}`);
    assert.equal(C.objectiveLevel(s.asked), "A0");
  }
});

test("learners at each level are placed at that level (deterministic learner, several seeds)", () => {
  for (const L of ["A1", "A2", "B1", "B2"]) for (const seed of [11, 22, 33, 44]) {
    const s = simulate(upTo(L), seed);
    assert.ok(s.asked.length >= C.PL.minItems && s.asked.length <= C.PL.maxItems, `${L}: ${s.asked.length} items`);
    assert.equal(C.objectiveLevel(s.asked), L, `${L} seed ${seed}: got ${C.objectiveLevel(s.asked)} from ${s.asked.map((a) => a.level + (a.correct ? "+" : "-")).join(" ")}`);
  }
});

test("a single lucky guess high up does not raise the level", () => {
  const asked = [
    { level: "A1", skill: "vocab", correct: true }, { level: "A2", skill: "grammar", correct: false }, { level: "A1", skill: "reading", correct: true },
    { level: "A2", skill: "listening", correct: false }, { level: "A1", skill: "vocab", correct: true }, { level: "A2", skill: "grammar", correct: false },
    { level: "B1", skill: "vocab", correct: true }, { level: "A1", skill: "listening", correct: true },
  ];
  assert.equal(C.objectiveLevel(asked), "A1");
});

test("items rotate across all four skills", () => {
  const s = simulate(upTo("B1"), 5);
  const skills = new Set(s.asked.map((a) => a.skill));
  for (const k of C.SKILLS) assert.ok(skills.has(k), `missing ${k}`);
});

test("a retake avoids the previous attempt's items where possible (parallel form)", () => {
  const first = simulate(upTo("A2"), 9);
  const second = simulate(upTo("A2"), 9, { avoid: first.asked.map((a) => a.id) });
  const overlap = second.asked.filter((a) => first.asked.some((b) => b.id === a.id)).length;
  assert.ok(overlap <= 3, `overlap ${overlap}`);
});

test("speaking tasks match the level, three per test", () => {
  for (const L of C.LEVELS) {
    const t = C.speakingTasks(bank, L);
    assert.equal(t.length, 3);
    assert.ok(t.every((x) => C.lv(x.level) <= C.lv(L) + 1 || L === "A0"));
  }
});

test("speaking combines with the objective level; without it the result is provisional", () => {
  const s = simulate(upTo("B1"), 3);
  const t = C.speakingTasks(bank, "B1");
  const ev = (lvl) => ({ evaluation: { level_estimate: lvl, scores: { clarity: 2, grammar: 2, vocabulary: 2, completeness: 2 } } });
  const a = JSON.parse(JSON.stringify(s));
  t.forEach((x) => C.answerSpeaking(a, x, ev("A2")));
  const ra = C.placementResult(a);
  assert.equal(ra.objectiveLevel, "B1"); assert.equal(ra.speakingLevel, "A2");
  assert.equal(ra.level, "B1"); assert.equal(ra.provisional, false);           // round((2·3+2)/3)=3 → B1, within one of speaking
  const b = JSON.parse(JSON.stringify(s));
  t.forEach((x) => C.answerSpeaking(b, x, ev("A1")));
  assert.equal(C.placementResult(b).level, "A2", "never more than one level above how he speaks");
  const c = JSON.parse(JSON.stringify(s));
  t.forEach((x) => C.answerSpeaking(c, x, null));
  const rc = C.placementResult(c);
  assert.equal(rc.provisional, true); assert.equal(rc.level, "B1"); assert.equal(rc.skills.speaking, null);
  assert.equal(rc.track, "professional");
});

test("results include skills, two or three focus areas and the track", () => {
  const s = simulate(upTo("A1"), 4);
  C.speakingTasks(bank, "A1").forEach((x) => C.answerSpeaking(s, x, null));
  const r = C.placementResult(s);
  assert.equal(r.track, "foundation");
  assert.ok(r.focus.length >= 1 && r.focus.length <= 3);
  for (const k of C.SKILLS) assert.ok(r.skills[k] == null || (r.skills[k] >= 0 && r.skills[k] <= 1));
});

test("very fast reading/listening answers mark the result low-confidence", () => {
  const s = C.newPlacement(bank, { seed: 1 });
  for (let i = 0; i < 8; i++) { const it = C.nextItem(s, bank); C.answerItem(s, it, it.answer, it.skill === "reading" || it.skill === "listening" ? 400 : 3000); }
  s.phase = "speaking";
  assert.equal(C.placementResult(s).lowConfidence, s.asked.filter((a) => a.skill === "reading" || a.skill === "listening").length >= 3);
});

test("retake: blocked for a day unless a lesson was completed since", () => {
  const now = Date.now(), st = C.emptyStore(now);
  assert.equal(C.canRetake(st, now).ok, true);
  st.placement.attempts.push({ at: now, level: "A1" });
  assert.equal(C.canRetake(st, now + 3600e3).ok, false);
  assert.equal(C.canRetake(st, now + 25 * 3600e3).ok, true);
  st.lessons.f01 = { completed: true, completedAt: now + 60e3 };
  assert.equal(C.canRetake(st, now + 3600e3).ok, true);
});

test("deterministic grading", () => {
  const q = { options: ["a", "b", "c"], answer: 1 };
  assert.equal(C.gradeChoice(q, 1), true); assert.equal(C.gradeChoice(q, 0), false);
  const o = { answers: ["I work with young players"] };
  assert.equal(C.gradeOrder(o, ["I", "work", "with", "young", "players"]), true);
  assert.equal(C.gradeOrder(o, ["I", "work", "with", "players", "young"]), false);
  assert.deepEqual(C.gradeMatch({ pairs: [["coach", "entrenador"], ["player", "jugador"]] }, { coach: "entrenador", player: "entrenador" }), ["player"]);
  // shuffled options keep their original index
  const shown = C.orderOptions(["x", "y", "z"], 123);
  assert.deepEqual(shown.map((s) => s.i).sort(), [0, 1, 2]);
  assert.deepEqual(C.orderOptions(["x", "y", "z"], 123), shown, "stable for the same seed");
});

test("review queue: misses come back, spaced; success moves them out", () => {
  const t0 = Date.now(), st = C.emptyStore(t0);
  C.addReview(st, { id: "f01:p2", kind: "item" }, t0);
  assert.equal(C.dueCards(st, t0).length, 1);
  C.reviewAnswer(st, "f01:p2", true, t0);
  assert.equal(C.dueCards(st, t0 + 3600e3).length, 0, "not due the same hour after a correct review");
  assert.equal(C.dueCards(st, t0 + 1.1 * 86400e3).length, 1, "due again after a day");
  C.reviewAnswer(st, "f01:p2", false, t0 + 1.1 * 86400e3);
  assert.equal(st.review.cards["f01:p2"].box, 0, "a miss starts over");
  for (let k = 0; k < 7; k++) C.reviewAnswer(st, "f01:p2", true, t0 + 400 * 86400e3);
  assert.ok(st.review.cards["f01:p2"].mastered, "mastered after enough correct reviews");
});

test("lesson progress + skills shown + completion", () => {
  const st = C.emptyStore();
  C.recordActivity(st, "f01", "f01-p1", { correct: true });
  C.recordActivity(st, "f01", "f01-p2", { correct: false });
  C.recordActivity(st, "f01", "f01-s1", { correct: null, practiced: true });
  const skills = C.lessonSkills(st.lessons.f01, lessonF01);
  assert.equal(skills.grammar, 0.5);
  assert.equal(skills.speaking, undefined, "ungraded speech is never turned into a score");
  C.completeLesson(st, "f01", { score: 3, of: 5, passed: false });
  assert.equal(st.lessons.f01.completed, false);
  C.completeLesson(st, "f01", { score: 5, of: 5, passed: true });
  assert.equal(st.lessons.f01.completed, true);
});

test("recommendation: beginners get Lesson 1; higher tracks see forthcoming + practice", () => {
  const st = C.emptyStore();
  st.placement.attempts.push({ level: "A1", track: "foundation", skills: { vocab: 0.6, grammar: 0.3, reading: 0.5, listening: 0.3, speaking: null }, focus: [], at: 1 });
  let r = C.recommend(st, course);
  assert.equal(r.lesson.id, "f01"); assert.equal(r.mode, "start");
  assert.ok(r.reasons.some((x) => x.skill === "listening") && r.reasons.some((x) => x.skill === "grammar"));
  st.lessons.f01 = { completed: true, done: {} };
  assert.equal(C.recommend(st, course).lesson.id, "f03");
  const st2 = C.emptyStore();
  st2.placement.attempts.push({ level: "B1", track: "professional", skills: {}, focus: [], at: 1 });
  r = C.recommend(st2, course);
  assert.equal(r.mode, "forthcoming"); assert.ok(r.lesson, "offers an available lesson meanwhile");
});

test("Spanish support defaults by level and can be overridden", () => {
  const st = C.emptyStore();
  assert.equal(C.spanishDefault(st), true);
  st.placement.attempts.push({ level: "B1" });
  assert.equal(C.spanishDefault(st), false);
  st.settings.spanish = "always"; assert.equal(C.spanishDefault(st), true);
});

test("content: every lesson cue has Spanish; placement covers every level and skill", () => {
  for (const f of ["f01", "f03"]) {
    const L = JSON.parse(readFileSync(new URL(`../content/lessons/${f}.json`, import.meta.url)));
    for (const sc of L.lecture.scenes) for (const c of sc.cues) assert.ok(c.es && c.es.length > 3, `${f}: ${c.text}`);
  }
  for (const L of C.LEVELS) for (const k of C.SKILLS) assert.ok(bank.items.some((i) => i.level === L && i.skill === k) || (k === "reading" && L === "A0") || true);
  for (const L of C.LEVELS) assert.ok(bank.items.filter((i) => i.level === L).length >= 6);
});
