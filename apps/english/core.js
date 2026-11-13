/* English (CP English) — core logic, v2 (pure; shared by the page and the tests). No DOM, no network.

   Bilingual: every learner has a profile (target language, native language, coaching specialty). Progress is kept
   per learner and per course key (`<target>/<specialty>`, or `<target>/general` for the shared everyday-language
   foundation), so switching language or specialty never loses anything. Placement is per target language and
   scores general (everyday) ability and coaching communication separately.

   Placement: a staircase over GENERAL items (8–12, rotating vocabulary, grammar, reading, listening), then a short
   COACHING block for the learner's specialty (4 items around the general level), then 3 spoken tasks (2 general +
   1 coaching scenario). Results are CEFR-inspired estimates, never a certification. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPE = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  const LEVELS = ["A0", "A1", "A2", "B1", "B2"];
  const SKILLS = ["vocab", "grammar", "reading", "listening"];
  const SPECIALTIES = ["pitching", "hitting", "defense"];
  const LANGS = ["en", "es"];
  const lv = (l) => Math.max(0, LEVELS.indexOf(l));
  const clampL = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
  const DAY = 86400000;
  const otherLang = (l) => (l === "es" ? "en" : "es");

  /* ---------------- seeded shuffle (stable per attempt) ---------------- */
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shuffle(arr, seed) { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  /** options in display order, each with its original index (grading is by original index, never by position) */
  const orderOptions = (options, seed) => shuffle(options.map((text, i) => ({ text, i })), seed);
  const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ---------------- course keys ---------------- */
  const courseKey = (target, specialty) => `${target}/${specialty}`;
  const foundationKey = (target) => `${target}/general`;
  const lessonKey = (ck, lessonId) => `${ck}/${lessonId}`;
  const courseFor = (catalog, target, specialty) => catalog.courses.find((c) => c.target === target && c.specialty === specialty) || null;
  const courseByKey = (catalog, key) => { const [t, s] = String(key).split("/"); return courseFor(catalog, t, s); };

  /* ---------------- placement ---------------- */
  const PL = { minItems: 8, maxItems: 12, coachingItems: 4, start: "A1", speakingTasks: 3, retakeAfterMs: DAY };
  const isGeneral = (i) => !i.domain || i.domain === "general";

  function newPlacement(bank, opts) {
    const o = opts || {};
    return { v: 2, bank: bank.id, lang: bank.target || "en", specialty: o.specialty || null, seed: o.seed || (Date.now() >>> 0), started: o.now || Date.now(),
      avoid: o.avoid || [], level: PL.start, asked: [], coaching: [], phase: "objective", speaking: [], micAvailable: o.micAvailable !== false, done: false };
  }
  const coachingPool = (bank, state) => bank.items.filter((i) => state.specialty && i.domain === state.specialty);
  function pickFrom(pool, state, skillCounts, salt) {
    const avoid = new Set(state.avoid), fresh = pool.filter((i) => !avoid.has(i.id)), use = fresh.length ? fresh : pool;
    if (!use.length) return null;
    const minCount = Math.min(...use.map((i) => skillCounts[i.skill] || 0));
    return shuffle(use.filter((i) => (skillCounts[i.skill] || 0) === minCount), state.seed + salt)[0];
  }
  function nextItem(state, bank) {
    if (state.phase === "objective") {
      const asked = new Set(state.asked.map((a) => a.id));
      const counts = Object.fromEntries(SKILLS.map((s) => [s, state.asked.filter((a) => a.skill === s).length]));
      const target = lv(state.level);
      for (const d of [0, 1, -1, 2, -2]) {                         // the target level first, then the nearest
        const L = LEVELS[target + d]; if (!L) continue;
        const it = pickFrom(bank.items.filter((i) => isGeneral(i) && i.level === L && !asked.has(i.id)), state, counts, state.asked.length);
        if (it) return it;
      }
      return null;
    }
    if (state.phase === "coaching") {
      const asked = new Set(state.coaching.map((a) => a.id));
      const base = lv(objectiveLevel(state.asked));
      const want = [base, base, base - 1, base + 1][state.coaching.length] ?? base;
      const counts = Object.fromEntries(SKILLS.map((s) => [s, state.coaching.filter((a) => a.skill === s).length]));
      const pool = coachingPool(bank, state).filter((i) => !asked.has(i.id));
      for (const d of [0, -1, 1, -2, 2]) {
        const L = LEVELS[Math.max(0, Math.min(4, want)) + d]; if (!L) continue;
        const it = pickFrom(pool.filter((i) => i.level === L), state, counts, 100 + state.coaching.length);
        if (it) return it;
      }
      return null;
    }
    return null;
  }
  /** record an objective answer. choice = the ORIGINAL option index chosen; ms = time to answer */
  function answerItem(state, item, choice, ms, bank) {
    const correct = choice === item.answer;
    const rec = { id: item.id, level: item.level, skill: item.skill, domain: item.domain || "general", correct, ms: Math.max(0, Math.round(ms || 0)) };
    if (state.phase === "coaching") {
      state.coaching.push(rec);
      if (state.coaching.length >= PL.coachingItems || (bank && !nextItem(state, bank))) state.phase = "speaking";
      return correct;
    }
    state.asked.push(rec);
    state.level = clampL(lv(state.level) + (correct ? 1 : -1));
    if (objectiveFinished(state)) state.phase = bank && coachingPool(bank, state).length ? "coaching" : (bank || !state.specialty) ? "speaking" : "coaching";
    return correct;
  }
  function objectiveFinished(state) {
    const a = state.asked, n = a.length;
    if (n >= PL.maxItems) return true;
    // clear beginner: four misses at A0/A1 with nothing right above A0 → stop early (6 items minimum)
    if (n >= 6 && a.filter((x) => !x.correct && lv(x.level) <= 1).length >= 4 && !a.some((x) => x.correct && lv(x.level) >= 1)) return true;
    if (n < PL.minItems) return false;
    const last = a.slice(-5).map((x) => lv(x.level));             // stable: the last five within one level
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
    if (!asked.some((x) => x.correct)) return "A0";
    return LEVELS[best];
  }
  /** strength 0–1, weighted by item level (harder items count more) */
  function weighted(rows) {
    if (!rows.length) return null;
    const w = (x) => lv(x.level) + 1;
    return Math.round((rows.filter((x) => x.correct).reduce((t, x) => t + w(x), 0) / rows.reduce((t, x) => t + w(x), 0)) * 100) / 100;
  }
  function skillProfile(asked) {
    const out = {};
    for (const s of SKILLS) out[s] = weighted(asked.filter((x) => x.skill === s));
    return out;
  }
  const GENERAL_PICK = { A0: [0, 1], A1: [0, 1], A2: [0, 3], B1: [3, 4], B2: [4, 5] };
  const GENERAL_PICK3 = { A0: [0, 1, 3], A1: [0, 1, 3], A2: [0, 2, 3], B1: [2, 3, 4], B2: [3, 4, 5] };
  /** the spoken tasks: two general for the level + one coaching scenario for the specialty (else three general) */
  function speakingTasks(bank, level, specialty) {
    const general = bank.speaking.filter(isGeneral);
    const scen = specialty ? bank.speaking.filter((s) => s.domain === specialty).sort((a, b) => lv(a.level) - lv(b.level)) : [];
    if (!scen.length) return (GENERAL_PICK3[level] || GENERAL_PICK3.A1).map((i) => general[i]).filter(Boolean);
    const pick = (GENERAL_PICK[level] || GENERAL_PICK.A1).map((i) => general[i]).filter(Boolean);
    pick.push(lv(level) >= 3 && scen.length > 1 ? scen[scen.length - 1] : scen[0]);
    return pick;
  }
  /** record a spoken task's result: evaluation (validated server output) or null when not evaluated */
  function answerSpeaking(state, task, result) {
    const ev = result && result.evaluation;
    state.speaking.push({ id: task.id, level: task.level, domain: task.domain || "general", evaluated: !!ev, typed: !!(result && result.typed),
      estimate: ev ? ev.level_estimate : null, scores: ev ? ev.scores : null, unclear: !!(result && result.unclear) });
  }
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const scoreOf = (s) => { const v = Object.values(s || {}).filter(Number.isFinite); return v.length ? v.reduce((t, x) => t + x, 0) / (4 * v.length) : null; };
  /** final result: general level (objective + spoken), coaching estimate, skills; provisional when speech wasn't evaluated */
  function placementResult(state, now) {
    const obj = objectiveLevel(state.asked), profile = skillProfile(state.asked);
    const evAll = state.speaking.filter((s) => s.evaluated && s.estimate);
    const evGen = evAll.filter((s) => s.domain === "general"), evCoach = evAll.filter((s) => s.domain !== "general");
    const spoken = evGen.length >= 1 && evAll.length >= 2 ? median(evGen.map((s) => lv(s.estimate))) : evAll.length >= 2 ? median(evAll.map((s) => lv(s.estimate))) : null;
    let general = lv(obj);
    if (spoken != null) general = Math.min(Math.round((2 * lv(obj) + spoken) / 3), spoken + 1);   // never more than one level above how he speaks
    const speakingScore = evAll.length ? Math.round((evAll.reduce((t, s) => t + (scoreOf(s.scores) || 0), 0) / evAll.length) * 100) / 100 : null;
    // coaching communication: the coaching items (+ the coaching scenario when evaluated), relative to the general level
    const coachScore = weighted(state.coaching || []);
    let coaching = null;
    if (coachScore != null) {
      coaching = general + (coachScore >= 0.8 ? 1 : coachScore >= 0.5 ? 0 : -1);
      if (evCoach.length) coaching = Math.round((coaching + lv(evCoach[0].estimate)) / 2);
      coaching = Math.max(0, Math.min(4, coaching));
    }
    const rushed = state.asked.filter((a) => (a.skill === "reading" || a.skill === "listening") && a.ms > 0 && a.ms < 1500).length;
    const level = LEVELS[general];
    const listening = profile.listening;
    return {
      lang: state.lang || "en", specialty: state.specialty || null,
      level, generalLevel: level, objectiveLevel: obj, speakingLevel: spoken != null ? LEVELS[spoken] : null,
      coachingLevel: coaching != null ? LEVELS[coaching] : null, coachingScore: coachScore,
      provisional: spoken == null, skipped: false,
      speakingNote: spoken != null ? null : state.speaking.some((s) => s.typed) ? "typed" : state.micAvailable ? "not-evaluated" : "no-microphone",
      skills: Object.assign({}, profile, { speaking: speakingScore, coaching: coachScore }), listening, speaking: speakingScore,
      items: state.asked.length + (state.coaching || []).length, speakingTasks: state.speaking.length,
      lowConfidence: rushed >= 3, track: trackFor(level), focus: focusAreas(profile, speakingScore, coachScore),
      at: now || Date.now(), seconds: Math.round(((now || Date.now()) - state.started) / 1000),
      seen: state.asked.map((a) => a.id).concat((state.coaching || []).map((a) => a.id)),
    };
  }
  /** "skip for now": a clearly labelled provisional beginner placement */
  function skippedPlacement(lang, specialty, now) {
    return { lang, specialty: specialty || null, level: "A0", generalLevel: "A0", objectiveLevel: null, speakingLevel: null, coachingLevel: null, coachingScore: null,
      provisional: true, skipped: true, speakingNote: "skipped", skills: { vocab: null, grammar: null, reading: null, listening: null, speaking: null, coaching: null },
      listening: null, speaking: null, items: 0, speakingTasks: 0, lowConfidence: false, track: "foundation", focus: [], at: now || Date.now(), seconds: 0, seen: [] };
  }
  const trackFor = (level) => (lv(level) <= 1 ? "foundation" : lv(level) === 2 ? "functional" : "professional");
  /** two or three improvement areas, weakest first */
  const SKILL_NAMES = {
    vocab: { en: "Vocabulary", es: "Vocabulario" }, grammar: { en: "Grammar and sentence building", es: "Gramática y construcción de oraciones" },
    reading: { en: "Reading", es: "Lectura" }, listening: { en: "Listening", es: "Comprensión auditiva" }, speaking: { en: "Speaking", es: "Expresión oral" },
    coaching: { en: "Coaching communication", es: "Comunicación de coaching" },
  };
  function focusAreas(profile, speaking, coaching) {
    const all = Object.assign({}, profile, { speaking, coaching });
    const rows = Object.entries(all).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    const out = rows.slice(0, 3).filter(([, v], i) => i < 2 || v < 0.75).map(([k, v]) => ({ skill: k, name: SKILL_NAMES[k].en, name_es: SKILL_NAMES[k].es, score: v }));
    if (!out.length) out.push({ skill: "speaking", name: SKILL_NAMES.speaking.en, name_es: SKILL_NAMES.speaking.es, score: null });
    return out;
  }

  /* ---------------- grading (deterministic) ---------------- */
  const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const gradeChoice = (item, originalIndex) => originalIndex === item.answer;
  const gradeOrder = (item, words) => item.answers.map(norm).includes(norm(words.join(" ")));
  /** match: pairs [[target, native]], answer {target: native}; returns wrong keys */
  const gradeMatch = (item, chosen) => item.pairs.filter(([a, b]) => chosen[a] !== b).map(([a]) => a);

  /* ---------------- learner store (this device) ---------------- */
  const KEY = "cpEnglish.v1";            // one key for the app (the v2 document lives under the original key)
  const uid = (now) => "l" + Math.random().toString(36).slice(2, 10) + (now || Date.now()).toString(36);
  function newLearner(now, profile) {
    return { id: uid(now), name: "", created: now || Date.now(),
      profile: Object.assign({ target: null, native: null, specialty: null, onboarded: false }, profile || {}),
      placements: { en: { attempts: [], inProgress: null }, es: { attempts: [], inProgress: null } },
      progress: {}, review: { cards: {} }, speaking: [], events: [] };
  }
  function emptyStore(now) {
    const l = newLearner(now);
    return { v: 2, created: now || Date.now(), device: "d" + Math.random().toString(36).slice(2, 12) + (now || Date.now()).toString(36),
      consent: null, settings: { support: "auto", speed: 1 }, active: l.id, learners: { [l.id]: l } };
  }
  /** v1 (English only, one learner) → v2. Nothing is dropped: lessons f01/f03 become en/general progress,
      placement attempts become English placements (general), review cards and speaking history move across. */
  function migrate(s, now) {
    if (s && typeof s === "object" && s.v === 2 && s.learners && s.learners[s.active]) {
      const base = emptyStore(now);
      const out = Object.assign({}, base, s, { settings: Object.assign({}, base.settings, s.settings || {}) });
      for (const l of Object.values(out.learners)) {
        const nl = newLearner(now);
        l.profile = Object.assign(nl.profile, l.profile || {});
        l.placements = Object.assign(nl.placements, l.placements || {});
        for (const k of LANGS) l.placements[k] = Object.assign({ attempts: [], inProgress: null }, l.placements[k] || {});
        l.progress = l.progress || {}; l.review = Object.assign({ cards: {} }, l.review || {}); l.speaking = l.speaking || []; l.events = l.events || [];
      }
      return out;
    }
    const base = emptyStore(now);
    if (!s || typeof s !== "object" || s.v !== 1) return base;
    const l = base.learners[base.active];
    l.created = s.created || l.created;
    const hadAny = (s.placement && (s.placement.attempts || []).length) || Object.keys(s.lessons || {}).length;
    l.profile = { target: "en", native: "es", specialty: null, onboarded: false, migratedFrom: hadAny ? 1 : 0 };
    l.placements.en = { attempts: ((s.placement && s.placement.attempts) || []).map((a) => Object.assign({ lang: "en", specialty: null, generalLevel: a.level, coachingLevel: null }, a)), inProgress: null };
    for (const [id, st] of Object.entries(s.lessons || {})) l.progress[lessonKey(foundationKey("en"), id)] = st;
    for (const [id, c] of Object.entries((s.review && s.review.cards) || {})) l.review.cards[id] = Object.assign({ course: foundationKey("en") }, c);
    l.speaking = (s.speaking || []).map((x) => Object.assign({ course: foundationKey("en") }, x));
    l.events = s.events || [];
    base.device = s.device || base.device; base.consent = s.consent || null;
    base.settings.support = (s.settings && s.settings.spanish) || "auto";
    return base;
  }
  const learner = (store) => store.learners[store.active];
  const placementsOf = (l, lang) => (l.placements[lang] = l.placements[lang] || { attempts: [], inProgress: null });
  /** the latest placement result for a language (null when none) */
  const currentPlacement = (l, lang) => (placementsOf(l, lang || l.profile.target).attempts || []).slice(-1)[0] || null;
  /** translation support: shown by default up to A1 in the target language (the learner can override) */
  function supportDefault(store) {
    const m = store.settings.support; if (m === "always" || m === "never") return m === "always";
    const l = learner(store), p = currentPlacement(l, l.profile.target);
    return !p || lv(p.generalLevel || p.level) <= 1;
  }
  /** retake allowed after a day, or after completing a lesson in that language since (prevents re-rolling by guessing);
      a skipped placement never blocks */
  function canRetake(l, lang, now) {
    const last = (placementsOf(l, lang).attempts || []).filter((a) => !a.skipped).slice(-1)[0];
    if (!last) return { ok: true };
    const t = now || Date.now();
    const lessonSince = Object.entries(l.progress || {}).some(([k, v]) => k.startsWith(lang + "/") && v.completed && v.completedAt > last.at);
    if (t - last.at >= PL.retakeAfterMs || lessonSince) return { ok: true };
    return { ok: false, wait: PL.retakeAfterMs - (t - last.at) };
  }

  /* ---------------- lesson progress (keyed by course and lesson) ---------------- */
  function lessonState(l, key) {
    if (!l.progress[key]) l.progress[key] = { started: Date.now(), section: 0, activity: 0, done: {}, completed: false, mastery: null };
    return l.progress[key];
  }
  function recordActivity(l, key, actId, outcome) {
    const ls = lessonState(l, key), prev = ls.done[actId];
    ls.done[actId] = Object.assign({ attempts: 0 }, prev, outcome, { attempts: ((prev && prev.attempts) || 0) + 1, at: Date.now() });
    ls.updated = Date.now();
    return ls.done[actId];
  }
  function completeLesson(l, key, mastery) {
    const ls = lessonState(l, key);
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
  /** progress summary for a course key: available lessons completed / total available */
  function courseProgress(l, ck, lessons) {
    const avail = lessons.filter((x) => x.status === "available");
    const done = avail.filter((x) => (l.progress[lessonKey(ck, x.id)] || {}).completed).length;
    const started = avail.filter((x) => l.progress[lessonKey(ck, x.id)]).length;
    return { done, started, available: avail.length, total: lessons.length };
  }

  /* ---------------- review queue (Leitner) ---------------- */
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  function addReview(l, card, now) {
    const t = now || Date.now(), c = l.review.cards[card.id];
    l.review.cards[card.id] = Object.assign({ box: 0, added: t, seen: 0 }, c, card, { box: 0, due: t });   // a new miss starts over
  }
  function dueCards(l, now, filter) {
    const t = now || Date.now();
    return Object.values(l.review.cards).filter((c) => c.due <= t && c.box < BOX_DAYS.length && (!filter || filter(c))).sort((a, b) => a.due - b.due);
  }
  function reviewAnswer(l, id, knew, now) {
    const c = l.review.cards[id]; if (!c) return null;
    const t = now || Date.now();
    c.seen++; c.box = knew ? Math.min(BOX_DAYS.length, c.box + 1) : 0;
    c.due = c.box >= BOX_DAYS.length ? Infinity : t + BOX_DAYS[c.box] * DAY + (knew ? 0 : 10 * 60 * 1000);
    if (c.box >= BOX_DAYS.length) c.mastered = t;
    return c;
  }

  /* ---------------- recommendation (explainable rules) ----------------
     course: the catalog course for the learner's language × specialty; foundation: { key, lessons } of the shared
     everyday-language course for that language (or null). Returns the next lesson, an optional foundation lesson
     to add, and plain reasons in both languages. */
  function recommend(l, catalog, foundation) {
    const target = l.profile.target, spec = l.profile.specialty;
    const course = courseFor(catalog, target, spec);
    const ck = courseKey(target, spec), p = currentPlacement(l, target);
    const due = dueCards(l).length;
    const reasons = [];
    const R = (en, es, skill) => reasons.push({ en, es, skill: skill || null });
    const doneIn = (key, id) => (l.progress[lessonKey(key, id)] || {}).completed;
    const startedIn = (key, id) => l.progress[lessonKey(key, id)] && !doneIn(key, id);
    if (!course || course.status !== "active") {
      return { course, courseKey: ck, mode: "planned", lesson: null, also: null, reasons, due };
    }
    const avail = course.lessons.filter((x) => x.status === "available");
    const started = avail.find((x) => startedIn(ck, x.id));
    const next = started || avail.find((x) => !doneIn(ck, x.id)) || null;
    const mode = next ? (started ? "continue" : "start") : "complete";
    // the shared everyday-language foundation when the general level is low or clearly below the coaching level
    let also = null;
    if (foundation && foundation.lessons) {
      const fAvail = foundation.lessons.filter((x) => x.status === "available");
      const fNext = fAvail.find((x) => startedIn(foundation.key, x.id)) || fAvail.find((x) => !doneIn(foundation.key, x.id));
      const gl = p ? lv(p.generalLevel || p.level) : null, cl = p && p.coachingLevel ? lv(p.coachingLevel) : null;
      if (fNext && p && !p.skipped && (gl <= 1 || (cl != null && cl - gl >= 1))) {
        also = fNext;
        if (cl != null && cl > gl) R(`Your everyday ${langName(target)} (${LEVELS[gl]}) is below your coaching ${langName(target)} (${LEVELS[cl]}): add the shared Everyday ${langName(target)} lessons.`,
          `Tu ${langNameEs(target)} cotidiano (${LEVELS[gl]}) está por debajo de tu ${langNameEs(target)} de coaching (${LEVELS[cl]}): agrega las lecciones de ${langNameEs(target)} cotidiano.`, "general");
        else R(`Your everyday ${langName(target)} estimate is ${LEVELS[gl]}: the Everyday ${langName(target)} lessons build the basics alongside this course.`,
          `Tu nivel estimado de ${langNameEs(target)} cotidiano es ${LEVELS[gl]}: las lecciones de ${langNameEs(target)} cotidiano refuerzan lo básico junto con este curso.`, "general");
      }
    }
    if (!p) R("Take the placement test (10–15 minutes) so lessons and feedback match your level, or start Lesson 1 now.", "Haz la prueba de nivel (10–15 minutos) para que las lecciones se ajusten a tu nivel, o empieza la Lección 1 ahora.", "placement");
    else if (p.skipped) R("You skipped the placement test, so you start as a provisional beginner. Take the test when you're ready.", "Omitiste la prueba de nivel: empiezas como principiante provisional. Haz la prueba cuando quieras.", "placement");
    if (p && p.skills) {
      const s = p.skills;
      if (s.listening != null && s.listening < 0.5) R("Listening was your hardest area: replay each conversation and use the slower speed before answering.", "La comprensión auditiva fue lo más difícil: repite cada conversación y usa la velocidad lenta antes de responder.", "listening");
      if (s.vocab != null && s.grammar != null && s.vocab - s.grammar >= 0.25) R("You know many words; focus on building full sentences.", "Conoces muchas palabras; enfócate en formar oraciones completas.", "grammar");
      if (s.speaking != null && s.speaking < 0.5) R("Speak every sentence out loud and use the microphone often; short answers are fine.", "Di cada oración en voz alta y usa el micrófono a menudo; las respuestas cortas están bien.", "speaking");
      if (s.coaching != null && s.coaching < 0.5) R("Coaching vocabulary was harder than everyday language: the lesson vocabulary and the glossary will help most.", "El vocabulario de coaching fue más difícil que el lenguaje cotidiano: el vocabulario de las lecciones y el glosario te ayudarán más.", "coaching");
    }
    if (due) reasons.unshift({ en: `${due} review item${due === 1 ? "" : "s"} due — a few minutes of review first helps you remember.`, es: `Tienes ${due} elemento${due === 1 ? "" : "s"} para repasar: unos minutos de repaso primero te ayudan a recordar.`, skill: "review" });
    return { course, courseKey: ck, mode, lesson: next, also, reasons, due };
  }
  const langName = (t) => (t === "es" ? "Spanish" : "English");
  const langNameEs = (t) => (t === "es" ? "español" : "inglés");

  return { LEVELS, SKILLS, SPECIALTIES, LANGS, PL, KEY, BOX_DAYS, SKILL_NAMES, lv, rng, shuffle, orderOptions, hashStr, otherLang,
    courseKey, foundationKey, lessonKey, courseFor, courseByKey,
    newPlacement, nextItem, answerItem, objectiveFinished, objectiveLevel, skillProfile, speakingTasks, answerSpeaking, placementResult, skippedPlacement,
    trackFor, focusAreas, canRetake, norm, gradeChoice, gradeOrder, gradeMatch,
    emptyStore, newLearner, migrate, learner, placementsOf, currentPlacement, supportDefault,
    lessonState, recordActivity, completeLesson, lessonSkills, courseProgress, addReview, dueCards, reviewAnswer, recommend };
});
