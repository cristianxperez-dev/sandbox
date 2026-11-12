/* CP English — core logic (pure; shared by the page and the tests).
   Placement engine, level estimate and track recommendation, objective grading, lesson progress,
   review queue (Leitner spaced repetition) and an explainable recommendation. No DOM, no network. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPE = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  const LEVELS = ["A0", "A1", "A2", "B1", "B2"];
  const SKILLS = ["vocab", "grammar", "reading", "listening"];
  const lv = (l) => Math.max(0, LEVELS.indexOf(l));
  const DAY = 86400000;

  /* ---------------- seeded shuffle (stable per attempt) ---------------- */
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shuffle(arr, seed) { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  /** options in display order, each with its original index (grading is by original index, never by position) */
  const orderOptions = (options, seed) => shuffle(options.map((text, i) => ({ text, i })), seed);
  const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------------- placement ----------------
     Staircase over the item bank: start at A1 (accessible), one level up after a correct answer, one down
     after a wrong one, rotating skills so vocabulary, grammar, reading and listening are all sampled.
     8–12 objective items (shorter when the level is already clear), then 3 spoken tasks chosen for the
     estimated level. Items seen in the previous attempt are used last (a parallel form for retakes). */
  const PL = { minItems: 8, maxItems: 12, start: "A1", speakingTasks: 3, retakeAfterMs: DAY };

  function newPlacement(bank, opts) {
    const o = opts || {};
    return { v: 1, bank: bank.id, seed: o.seed || (Date.now() >>> 0), started: o.now || Date.now(), avoid: o.avoid || [],
      level: PL.start, asked: [], phase: "objective", speaking: [], micAvailable: o.micAvailable !== false, done: false };
  }
  function nextItem(state, bank) {
    if (state.phase !== "objective") return null;
    const asked = new Set(state.asked.map((a) => a.id)), avoid = new Set(state.avoid);
    const counts = Object.fromEntries(SKILLS.map((s) => [s, state.asked.filter((a) => a.skill === s).length]));
    const target = lv(state.level);
    for (const d of [0, 1, -1, 2, -2]) {                         // the target level first, then the nearest
      const L = LEVELS[target + d]; if (!L) continue;
      const pool = bank.items.filter((i) => i.level === L && !asked.has(i.id));
      if (!pool.length) continue;
      const fresh = pool.filter((i) => !avoid.has(i.id)), use = fresh.length ? fresh : pool;
      const minCount = Math.min(...use.map((i) => counts[i.skill]));
      const cands = shuffle(use.filter((i) => counts[i.skill] === minCount), state.seed + state.asked.length);
      return cands[0];
    }
    return null;
  }
  /** record an objective answer. choice = the ORIGINAL option index chosen; ms = time to answer */
  function answerItem(state, item, choice, ms) {
    const correct = choice === item.answer;
    state.asked.push({ id: item.id, level: item.level, skill: item.skill, correct, ms: Math.max(0, Math.round(ms || 0)) });
    const i = lv(state.level) + (correct ? 1 : -1);
    state.level = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
    if (objectiveFinished(state)) state.phase = "speaking";
    return correct;
  }
  function objectiveFinished(state) {
    const a = state.asked, n = a.length;
    if (n >= PL.maxItems) return true;
    // clear beginner: four misses at A0/A1 with nothing right above A0 → stop early (6 items minimum)
    if (n >= 6 && a.filter((x) => !x.correct && lv(x.level) <= 1).length >= 4 && !a.some((x) => x.correct && lv(x.level) >= 1)) return true;
    if (n < PL.minItems) return false;
    // stable: the last five items sit within one level of each other
    const last = a.slice(-5).map((x) => lv(x.level));
    return Math.max(...last) - Math.min(...last) <= 1;
  }
  /** objective level: highest level answered correctly at least twice with ≥ 60% accuracy there,
      supported by the level below (a lucky guess high up does not count on its own) */
  function objectiveLevel(asked) {
    const at = (L) => asked.filter((x) => x.level === L);
    const acc = (L) => { const r = at(L); return r.length ? r.filter((x) => x.correct).length / r.length : null; };
    let best = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      const r = at(LEVELS[i]), ok = r.filter((x) => x.correct).length;
      const below = i === 0 ? 1 : acc(LEVELS[i - 1]);
      if (ok >= 2 && acc(LEVELS[i]) >= 0.6 && (below == null || below >= 0.5)) best = i;
    }
    // nothing right anywhere → A0
    if (!asked.some((x) => x.correct)) return "A0";
    return LEVELS[best];
  }
  /** per-skill strength 0–1, weighted by item level (harder items count more) */
  function skillProfile(asked) {
    const out = {};
    for (const s of SKILLS) {
      const r = asked.filter((x) => x.skill === s);
      if (!r.length) { out[s] = null; continue; }
      const w = (x) => lv(x.level) + 1;
      out[s] = Math.round((r.filter((x) => x.correct).reduce((t, x) => t + w(x), 0) / r.reduce((t, x) => t + w(x), 0)) * 100) / 100;
    }
    return out;
  }
  /** the three spoken tasks for a level */
  function speakingTasks(bank, level) {
    const pick = { A0: ["sp1", "sp2", "sp4"], A1: ["sp1", "sp2", "sp4"], A2: ["sp1", "sp3", "sp4"], B1: ["sp3", "sp4", "sp5"], B2: ["sp4", "sp5", "sp6"] }[level] || ["sp1", "sp2", "sp4"];
    return pick.map((id) => bank.speaking.find((s) => s.id === id)).filter(Boolean);
  }
  /** record a spoken task's result: evaluation (validated server output) or null when not evaluated */
  function answerSpeaking(state, task, result) {
    state.speaking.push({ id: task.id, level: task.level, evaluated: !!(result && result.evaluation),
      typed: !!(result && result.typed), estimate: result && result.evaluation ? result.evaluation.level_estimate : null,
      scores: result && result.evaluation ? result.evaluation.scores : null, unclear: !!(result && result.unclear) });
  }
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  /** final result: objective level combined with spoken evidence; provisional when speech wasn't evaluated */
  function placementResult(state, now) {
    const obj = objectiveLevel(state.asked), profile = skillProfile(state.asked);
    const ev = state.speaking.filter((s) => s.evaluated && s.estimate);
    const spoken = ev.length >= 2 ? median(ev.map((s) => lv(s.estimate))) : null;
    let final = lv(obj);
    if (spoken != null) final = Math.min(Math.round((2 * lv(obj) + spoken) / 3), spoken + 1);   // never more than one level above how he speaks
    const speakingScore = ev.length ? Math.round((ev.reduce((t, s) => t + (s.scores.clarity + s.scores.grammar + s.scores.vocabulary + s.scores.completeness) / 16, 0) / ev.length) * 100) / 100 : null;
    const rushed = state.asked.filter((a) => (a.skill === "reading" || a.skill === "listening") && a.ms > 0 && a.ms < 1500).length;
    const level = LEVELS[final];
    return {
      level, objectiveLevel: obj, speakingLevel: spoken != null ? LEVELS[spoken] : null,
      provisional: spoken == null, speakingNote: spoken != null ? null : state.speaking.some((s) => s.typed) ? "typed" : state.micAvailable ? "not-evaluated" : "no-microphone",
      skills: Object.assign({}, profile, { speaking: speakingScore }), items: state.asked.length, speakingTasks: state.speaking.length,
      lowConfidence: rushed >= 3, track: trackFor(level), focus: focusAreas(profile, speakingScore, level),
      at: now || Date.now(), seconds: Math.round(((now || Date.now()) - state.started) / 1000), seen: state.asked.map((a) => a.id),
    };
  }
  const trackFor = (level) => (lv(level) <= 1 ? "foundation" : lv(level) === 2 ? "functional" : "professional");
  /** two or three improvement areas, weakest first, with plain reasons */
  function focusAreas(profile, speaking, level) {
    const names = { vocab: "Vocabulary", grammar: "Grammar and sentence building", reading: "Reading", listening: "Listening", speaking: "Speaking" };
    const es = { vocab: "Vocabulario", grammar: "Gramática y construcción de oraciones", reading: "Lectura", listening: "Comprensión auditiva", speaking: "Expresión oral" };
    const all = Object.assign({}, profile, { speaking });
    const rows = Object.entries(all).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    const out = rows.slice(0, 3).filter(([, v], i) => i < 2 || v < 0.75).map(([k, v]) => ({ skill: k, name: names[k], name_es: es[k], score: v }));
    if (!out.length) out.push({ skill: "speaking", name: names.speaking, name_es: es.speaking, score: null });
    return out;
  }
  /** retake allowed after a day, or after finishing a lesson since the last attempt (prevents re-rolling by guessing) */
  function canRetake(store, now) {
    const last = (store.placement && store.placement.attempts || []).slice(-1)[0];
    if (!last) return { ok: true };
    const t = now || Date.now();
    const lessonSince = Object.values(store.lessons || {}).some((l) => l.completed && l.completedAt > last.at);
    if (t - last.at >= PL.retakeAfterMs || lessonSince) return { ok: true };
    return { ok: false, wait: PL.retakeAfterMs - (t - last.at) };
  }

  /* ---------------- grading (deterministic) ---------------- */
  const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  const gradeChoice = (item, originalIndex) => originalIndex === item.answer;
  const gradeOrder = (item, words) => item.answers.map(norm).includes(norm(words.join(" ")));
  /** match: pairs [[en, es]], answer {en: es}; returns wrong English keys */
  const gradeMatch = (item, chosen) => item.pairs.filter(([en, es]) => chosen[en] !== es).map(([en]) => en);

  /* ---------------- learner store ---------------- */
  const KEY = "cpEnglish.v1";
  function emptyStore(now) {
    return { v: 1, created: now || Date.now(), device: "d" + Math.random().toString(36).slice(2, 12) + (now || Date.now()).toString(36),
      consent: null, settings: { spanish: "auto", speed: 1 }, placement: { attempts: [], inProgress: null }, lessons: {}, review: { cards: {} }, speaking: [], events: [] };
  }
  function migrate(s, now) {
    const base = emptyStore(now);
    if (!s || typeof s !== "object" || s.v !== 1) return base;
    return Object.assign(base, s, { settings: Object.assign(base.settings, s.settings || {}), placement: Object.assign(base.placement, s.placement || {}), review: Object.assign(base.review, s.review || {}) });
  }
  /** current recommended level: the latest completed placement, if any */
  const currentPlacement = (store) => (store.placement.attempts || []).slice(-1)[0] || null;
  /** Spanish support: shown by default for A0–A1, available on demand above (the learner can override) */
  function spanishDefault(store) {
    const m = store.settings.spanish; if (m === "always" || m === "never") return m === "always";
    const p = currentPlacement(store); return !p || lv(p.level) <= 1;
  }

  /* ---------------- lesson progress ---------------- */
  function lessonState(store, id) {
    if (!store.lessons[id]) store.lessons[id] = { started: Date.now(), section: 0, activity: 0, done: {}, completed: false, mastery: null, speech: 0 };
    return store.lessons[id];
  }
  /** record an activity outcome; correct: true/false/null (null = not graded, e.g. lecture or unevaluated speech) */
  function recordActivity(store, lessonId, actId, outcome) {
    const ls = lessonState(store, lessonId), prev = ls.done[actId];
    ls.done[actId] = Object.assign({ attempts: 0 }, prev, outcome, { attempts: ((prev && prev.attempts) || 0) + 1, at: Date.now() });
    ls.updated = Date.now();
    return ls.done[actId];
  }
  function completeLesson(store, lessonId, mastery) {
    const ls = lessonState(store, lessonId);
    ls.mastery = mastery; ls.completed = !!(mastery && mastery.passed); if (ls.completed) ls.completedAt = ls.completedAt || Date.now();
    ls.updated = Date.now();
    return ls;
  }
  /** skills shown in a lesson, from its graded activities: share correct per skill */
  function lessonSkills(ls, lesson) {
    const by = {};
    for (const sec of lesson.sections) for (const a of sec.activities) {
      const d = ls.done[a.id]; if (!d || d.correct == null || !a.skill) continue;
      const s = (by[a.skill] = by[a.skill] || { ok: 0, n: 0 }); s.n++; if (d.correct) s.ok++;
    }
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round((v.ok / v.n) * 100) / 100]));
  }

  /* ---------------- review queue (Leitner) ---------------- */
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  function addReview(store, card, now) {
    const t = now || Date.now(), c = store.review.cards[card.id];
    store.review.cards[card.id] = Object.assign({ box: 0, added: t, seen: 0 }, c, card, { box: 0, due: t });   // a new miss starts over
  }
  function dueCards(store, now) {
    const t = now || Date.now();
    return Object.values(store.review.cards).filter((c) => c.due <= t && c.box < BOX_DAYS.length).sort((a, b) => a.due - b.due);
  }
  function reviewAnswer(store, id, knew, now) {
    const c = store.review.cards[id]; if (!c) return null;
    const t = now || Date.now();
    c.seen++; c.box = knew ? Math.min(BOX_DAYS.length, c.box + 1) : 0;
    c.due = c.box >= BOX_DAYS.length ? Infinity : t + BOX_DAYS[c.box] * DAY + (knew ? 0 : 10 * 60 * 1000);
    if (c.box >= BOX_DAYS.length) c.mastered = t;
    return c;
  }

  /* ---------------- recommendation (explainable rules) ---------------- */
  function recommend(store, course) {
    const p = currentPlacement(store);
    const track = p ? p.track : "foundation";
    const avail = course.lessons.filter((l) => l.status === "available");
    const inTrack = course.lessons.filter((l) => l.track === track).sort((a, b) => a.week - b.week);
    const nextInTrack = inTrack.find((l) => l.status === "available" && !(store.lessons[l.id] && store.lessons[l.id].completed));
    const started = avail.find((l) => store.lessons[l.id] && !store.lessons[l.id].completed);
    const due = dueCards(store).length;
    const reasons = [];
    let lesson = started || nextInTrack || null, mode = lesson ? (started ? "continue" : "start") : "forthcoming";
    if (!lesson) {   // the learner's track has no lessons yet: offer the available lessons as warm-up/stretch practice
      lesson = avail.find((l) => !(store.lessons[l.id] && store.lessons[l.id].completed)) || null;
      reasons.push({ en: "Lessons for your level are being written. Meanwhile, the available lessons include harder 'going further' tasks.", es: "Las lecciones para tu nivel se están preparando. Mientras tanto, las lecciones disponibles incluyen tareas más avanzadas." });
    }
    if (p && p.skills) {
      const s = p.skills;
      if (s.listening != null && s.listening < 0.5) reasons.push({ skill: "listening", en: "Listening was your hardest area: replay each conversation and use the slower speed before answering.", es: "La comprensión auditiva fue lo más difícil: repite cada conversación y usa la velocidad lenta antes de responder." });
      if (s.vocab != null && s.grammar != null && s.vocab - s.grammar >= 0.25) reasons.push({ skill: "grammar", en: "You know many words; focus on building full sentences (I work…, I usually…).", es: "Conoces muchas palabras; enfócate en formar oraciones completas (I work…, I usually…)." });
      if (s.speaking != null && s.speaking < 0.5) reasons.push({ skill: "speaking", en: "Speak every sentence out loud and use the microphone often; short answers are fine.", es: "Di cada oración en voz alta y usa el micrófono a menudo; las respuestas cortas están bien." });
      if (s.speaking != null && s.speaking >= 0.7 && p.level !== "A0" && track !== "foundation") reasons.push({ skill: "vocab", en: "Your conversation is solid; build baseball and workplace vocabulary next.", es: "Tu conversación es sólida; ahora amplía el vocabulario de béisbol y de trabajo." });
    }
    if (due) reasons.unshift({ en: `${due} review item${due === 1 ? "" : "s"} due — a few minutes of review first helps you remember.`, es: `Tienes ${due} elemento${due === 1 ? "" : "s"} para repasar: unos minutos de repaso primero te ayudan a recordar.` });
    return { track, lesson, mode, reasons, due };
  }

  return { LEVELS, SKILLS, PL, KEY, lv, rng, shuffle, orderOptions, hashStr, newPlacement, nextItem, answerItem, objectiveFinished, objectiveLevel,
    skillProfile, speakingTasks, answerSpeaking, placementResult, trackFor, focusAreas, canRetake, norm, gradeChoice, gradeOrder, gradeMatch,
    emptyStore, migrate, currentPlacement, spanishDefault, lessonState, recordActivity, completeLesson, lessonSkills,
    BOX_DAYS, addReview, dueCards, reviewAnswer, recommend };
});
