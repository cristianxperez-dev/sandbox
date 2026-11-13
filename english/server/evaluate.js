/* English (CP English) — speech evaluation, v2: language-aware (pure functions; no I/O). Used by the API route and tests.

   A learner practises a TARGET language (English or Spanish) and gets feedback in their NATIVE language.
     transcription  → the API route (OpenAI audio transcription, language = target), text + confidence signals
     recognition    → recognitionQuality(): is the transcript trustworthy enough to judge?
     repeat tasks   → compareRepeat(): deterministic word comparison with the reference (no AI)
     open answers   → evalRequest() builds a strict-JSON evaluation request; validateEval() checks the
                      model's output before anything is shown or saved
   Nothing here judges pronunciation: a transcript cannot support phonetic claims, so feedback talks about meaning,
   words, grammar, naturalness and whether the coaching instruction came across — and says when the recording was
   hard to recognise. */

export const LEVELS = ["A0", "A1", "A2", "B1", "B2"];
export const TASKS = ["answer", "conversation", "placement"];
export const LANGS = ["en", "es"];
export const SPECIALTIES = ["pitching", "hitting", "defense"];
export const DIMS = ["clarity", "grammar", "vocabulary", "naturalness", "task"];
const NAME = { en: "English", es: "Spanish" };

/* ---------------- text ---------------- */
const NUM = {
  en: { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40" },
  es: { cero: "0", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", once: "11", doce: "12", quince: "15", veinte: "20", treinta: "30", cuarenta: "40" },
};
const CONTRACT = { "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "he's": "he is", "she's": "she is", "it's": "it is", "that's": "that is", "what's": "what is", "let's": "let us", "don't": "do not", "doesn't": "does not", "can't": "cannot", "i'll": "i will", "we'll": "we will", "you've": "you have", "i've": "i have", "isn't": "is not", "aren't": "are not" };
/** strip accents for matching (ASR output varies: "cómo"/"como"); the learner's text is shown as said */
const fold = (s) => s.normalize("NFD").replace(/\p{M}+/gu, "");
/** lower-case words, contractions expanded (English), numbers as digits, punctuation removed, accents folded */
export function words(s, lang) {
  const L = lang === "es" ? "es" : "en";
  return fold(String(s || "").toLowerCase()).replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean)
    .flatMap((w) => (L === "en" ? (CONTRACT[w] || w) : w).split(" ")).map((w) => w.replace(/'/g, "")).map((w) => NUM[L][w] || w).filter(Boolean);
}

/** longest-common-subsequence alignment of reference vs said words */
export function compareRepeat(reference, said, lang) {
  const a = words(reference, lang), b = words(said, lang);
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ref = [], extra = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ref.push({ w: a[i], ok: true }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ref.push({ w: a[i], ok: false }); i++; }
    else { extra.push(b[j]); j++; }
  }
  while (i < n) ref.push({ w: a[i++], ok: false });
  while (j < m) extra.push(b[j++]);
  const matched = ref.filter((x) => x.ok).length;
  const ratio = n ? matched / n : 0;
  return { ref, missing: ref.filter((x) => !x.ok).map((x) => x.w), extra, matched, total: n, ratio: Math.round(ratio * 100) / 100,
    verdict: ratio >= 0.9 && extra.length <= 2 ? "match" : ratio >= 0.6 ? "close" : "different" };
}

/* ---------------- recognition ---------------- */
/** decides whether a transcript is trustworthy enough to evaluate.
    logprobs: optional array of token log-probabilities from the transcription service. */
export function recognitionQuality(text, seconds, logprobs, lang) {
  const w = words(text, lang);
  if (!w.length) return { ok: false, reason: "empty" };
  if (seconds > 4 && w.length < 2) return { ok: false, reason: "too-little" };
  if (Array.isArray(logprobs) && logprobs.length >= 3) {
    const lp = logprobs.map(Number).filter(Number.isFinite);
    const conf = Math.exp(lp.reduce((s, x) => s + x, 0) / lp.length);     // geometric-mean token probability
    if (conf < 0.45) return { ok: false, reason: "low-confidence", confidence: Math.round(conf * 100) / 100 };
    return { ok: true, confidence: Math.round(conf * 100) / 100 };
  }
  return { ok: true, confidence: null };
}

/* ---------------- open-answer evaluation ---------------- */
const score = { type: "integer", enum: [0, 1, 2, 3, 4] };
export const EVAL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["on_task", "understandable", "in_target_language", "possible_recognition_issue", "scores", "level_estimate", "strengths", "corrections", "better_sentence", "feedback", "feedback_target", "follow_up"],
  properties: {
    on_task: { type: "boolean", description: "The response answers the prompt or fits the conversation turn." },
    understandable: { type: "boolean", description: "A native speaker of the target language would understand the intended meaning." },
    in_target_language: { type: "boolean", description: "The response is mainly in the target language (normal baseball loanwords allowed)." },
    possible_recognition_issue: { type: "boolean", description: "The transcript contains words that look like speech-recognition errors rather than the learner's language." },
    scores: { type: "object", additionalProperties: false, required: DIMS, properties: Object.fromEntries(DIMS.map((d) => [d, score])) },
    level_estimate: { type: "string", enum: LEVELS, description: "Level shown by THIS response only." },
    strengths: { type: "array", maxItems: 2, items: { type: "string" } },
    corrections: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["said", "better", "why"], properties: {
      said: { type: "string" }, better: { type: "string" }, why: { type: "string", description: "One short explanation in the learner's native language." } } } },
    better_sentence: { type: "string", description: "A natural target-language version that keeps the learner's own meaning." },
    feedback: { type: "string", description: "One to three short sentences in the learner's NATIVE language, encouraging and specific." },
    feedback_target: { type: "string", description: "One short, simple sentence of the same feedback in the TARGET language." },
    follow_up: { type: "string", description: "Conversation tasks only: the partner's natural next line, in the target language. Otherwise empty." },
  },
};

/** the instructions for one language direction and coaching specialty */
export function system(lang, native, specialty) {
  const T = NAME[lang], N = NAME[native];
  const who = lang === "en"
    ? "adult, Spanish-speaking professional baseball coaches (mostly Dominican) learning practical American English to coach English-speaking players"
    : "adult, English-speaking professional baseball coaches learning practical Latin American Spanish to coach Spanish-speaking players (many from the Dominican Republic)";
  const field = specialty ? `Their coaching specialty is ${specialty}. ` : "";
  const natural = lang === "es"
    ? `Accept natural Latin American and Dominican variants and normal baseball code-switching (slider, sinker, spin, release, bullpen, cutter, strike…). Both tú and usted are acceptable unless the task asks for one; mention register only if it would sound wrong to the player.`
    : `Accept natural American coaching English, including short imperatives ("Stay low.", "Set your feet.") — direct commands are normal on a US field, not rude.`;
  return `You evaluate short spoken ${T} responses from ${who}. ${field}You receive the task, what a good answer should communicate, example answers and an automatic speech-recognition (ASR) transcript of what the learner said.

Rules:
- Judge communication: did the learner do what the task asks, would a ${T}-speaking player understand the instruction or question, and how accurate and natural are the words and grammar? Many valid answers exist; never require the example wording, and never penalise a natural alternative expression.
- Score each dimension 0-4 for the learner's stated level (0 nothing usable, 2 understandable with clear errors, 4 natural and accurate for that level): clarity (meaning comes across), grammar (appropriate for the level), vocabulary (the relevant baseball/coaching words are correct), naturalness (sounds like something a coach would really say), task (the intended instruction, question or information was communicated). Be fair and consistent; do not inflate.
- ${natural}
- Never judge pronunciation or accent: you only have text. Do not mention accent. A non-native accent is not an error.
- The transcript may contain ASR mistakes. If a word looks like a recognition error (a sound-alike, a nonsense word, a missing small word or accent mark), do not count it as the learner's error; set possible_recognition_issue to true instead.
- If the response is mostly in ${N} instead of ${T}, set in_target_language to false, score task and grammar low, and give a ${T} model as better_sentence.
- corrections: at most three, the most useful first, only real language errors (not ASR artifacts). "why" is one short, plain explanation in ${N}.
- better_sentence: a natural, simple ${T} version of what the learner meant (for A0-A2 keep it short). If the response is already natural, repeat it with at most small improvements.
- feedback: encouraging and direct, one to three short sentences in ${N}, no grades, no exaggerated praise; name one thing that worked and the one most useful improvement. feedback_target: one short, simple ${T} sentence with the same message${lang === "es" ? ", using tú" : ""}.
- follow_up: only for conversation tasks, the partner's natural next line in ${T} given what the learner said (stay in the scenario, max 20 words). Otherwise "".
- If the response is empty or off-topic, say so kindly, give an example answer as better_sentence, and score accordingly.
Output only the JSON object.`;
}
export const SYSTEM = system("en", "es", null);   // v1 default (kept for reference/tests)

const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/** OpenAI Responses API body for one evaluation (strict JSON schema output) */
export function evalRequest(model, task, transcript) {
  const t = readTask(Object.assign({ kind: "answer" }, task)) || readTask({ kind: "answer", prompt: "-" });
  const user = [
    `Target language: ${NAME[t.lang]}. Learner's native language: ${NAME[t.native]}.`,
    `Task type: ${t.kind}`, `Learner level in ${NAME[t.lang]} (estimated): ${t.level}`,
    t.setting ? `Scenario: ${t.setting}` : "",
    t.history.length ? `Conversation so far:\n${t.history.map((h) => `${h.who === "learner" ? "Learner" : "Partner"}: ${h.text}`).join("\n")}` : "",
    `Prompt the learner answered: "${t.prompt}"`, `A good answer: ${t.goal}`,
    t.focus.length ? `Key vocabulary for this task (not required word-for-word): ${t.focus.join(", ")}` : "",
    t.examples.length ? `Example answers (not required wording):\n- ${t.examples.join("\n- ")}` : "",
    `ASR transcript of the learner's spoken response: "${clip(transcript, 800)}"`,
  ].filter(Boolean).join("\n\n");
  return {
    model, instructions: system(t.lang, t.native, t.specialty), input: [{ role: "user", content: user }],
    text: { format: { type: "json_schema", name: "speaking_feedback", strict: true, schema: EVAL_SCHEMA } },
    max_output_tokens: 800, store: false, prompt_cache_key: `cp-english-eval-${t.lang}-${t.specialty || "general"}`,
  };
}

/** validate + sanitise model output; null when it can't be trusted (nothing is shown or saved then) */
export function validateEval(o, kind) {
  if (!o || typeof o !== "object") return null;
  const b = (k) => typeof o[k] === "boolean";
  if (!b("on_task") || !b("understandable") || !b("possible_recognition_issue") || !b("in_target_language")) return null;
  const s = o.scores || {};
  if (!DIMS.every((d) => Number.isInteger(s[d]) && s[d] >= 0 && s[d] <= 4)) return null;
  if (!LEVELS.includes(o.level_estimate)) return null;
  const str = (k, n) => (typeof o[k] === "string" ? clip(o[k], n) : null);
  const feedback = str("feedback", 600), feedback_target = str("feedback_target", 400), better = str("better_sentence", 300), follow = str("follow_up", 200);
  if (feedback == null || feedback_target == null || better == null || follow == null || !feedback) return null;
  if (!Array.isArray(o.strengths) || !Array.isArray(o.corrections)) return null;
  const corrections = o.corrections.filter((c) => c && typeof c.said === "string" && typeof c.better === "string" && typeof c.why === "string")
    .slice(0, 3).map((c) => ({ said: clip(c.said, 200), better: clip(c.better, 200), why: clip(c.why, 300) })).filter((c) => c.said && c.better);
  return {
    on_task: o.on_task, understandable: o.understandable, in_target_language: o.in_target_language, possible_recognition_issue: o.possible_recognition_issue,
    scores: Object.fromEntries(DIMS.map((d) => [d, s[d]])), level_estimate: o.level_estimate,
    strengths: o.strengths.filter((x) => typeof x === "string").slice(0, 2).map((x) => clip(x, 200)),
    corrections, better_sentence: better, feedback, feedback_target,
    follow_up: kind === "conversation" ? follow : "",
  };
}

/** validates the browser's task description for an open answer */
export function readTask(t) {
  if (!t || typeof t !== "object") return null;
  const kind = TASKS.includes(t.kind) ? t.kind : null;
  if (!kind || !clip(t.prompt, 400)) return null;
  const lang = LANGS.includes(t.lang) ? t.lang : "en";
  const native = LANGS.includes(t.native) && t.native !== lang ? t.native : (lang === "en" ? "es" : "en");
  return { kind, lang, native, specialty: SPECIALTIES.includes(t.specialty) ? t.specialty : null,
    level: LEVELS.includes(t.level) ? t.level : "A1", prompt: clip(t.prompt, 400), goal: clip(t.goal, 400),
    examples: Array.isArray(t.examples) ? t.examples.slice(0, 3).map((x) => clip(x, 240)) : [], setting: clip(t.setting, 400),
    focus: Array.isArray(t.focus) ? t.focus.slice(0, 8).map((x) => clip(x, 60)).filter(Boolean) : [],
    history: Array.isArray(t.history) ? t.history.slice(-6).map((h) => ({ who: h && h.who === "learner" ? "learner" : "partner", text: clip(h && h.text, 240) })) : [] };
}

/** the transcription hint (vocabulary the recogniser should expect) for a language and specialty */
export function sttPrompt(lang, specialty) {
  if (lang === "es") {
    const v = { pitching: "agarre, costuras, dedo índice, dedo medio, pulgar, recta de cuatro costuras, sinker, slider, cambio, curva, bullpen, montículo, soltar la pelota, balance, zancada", defense: "rolata, guante, fildear, tirar, posición, primer paso, revés", hitting: "swing, bate, turno, contacto, zona de strike, jaula" }[specialty] || "béisbol, entrenador, academia, práctica";
    return `Un entrenador de béisbol habla en español. Palabras: ${v}.`;
  }
  const v = { defense: "ready position, glove side, backhand, forehand, ground ball, set your feet, throwing lane, first step, transfer, cutoff, relay", pitching: "four-seam, two-seam, slider, changeup, bullpen, release point, spin", hitting: "batting practice, bat path, contact, approach, tee, cage" }[specialty] || "infielder, shortstop, ground ball, bullpen, batting practice, glove";
  return `A baseball coach speaking English. Baseball words: ${v}.`;
}
