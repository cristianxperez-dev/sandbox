/* CP English — speech evaluation (pure functions; no I/O). Used by functions/apps/english/api and tests.

   Responsibilities are kept apart:
     transcription  → the API route (OpenAI audio transcription), returns text + confidence signals
     recognition    → recognitionQuality(): is the transcript trustworthy enough to judge?
     repeat tasks   → compareRepeat(): deterministic word comparison with the reference (no AI)
     open answers   → evalRequest() builds a strict-JSON evaluation request; validateEval() checks the
                      model's output before anything is shown or saved
   Nothing here judges pronunciation: a transcript cannot support phonetic claims, so feedback talks about
   meaning, words and grammar, and says when the recording was hard to recognise. */

export const LEVELS = ["A0", "A1", "A2", "B1", "B2"];
export const TASKS = ["answer", "conversation", "placement"];

/* ---------------- text ---------------- */
const NUM = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirty: "30", fifteen: "15", forty: "40", fortyfive: "45", twenty: "20" };
const CONTRACT = { "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "he's": "he is", "she's": "she is", "it's": "it is", "that's": "that is", "what's": "what is", "let's": "let us", "don't": "do not", "doesn't": "does not", "can't": "cannot", "i'll": "i will", "we'll": "we will", "you've": "you have", "i've": "i have", "isn't": "is not", "aren't": "are not" };
/** lower-case words, contractions expanded, numbers as digits, punctuation removed */
export function words(s) {
  return String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean)
    .flatMap((w) => (CONTRACT[w] || w).split(" ")).map((w) => w.replace(/'/g, "")).map((w) => NUM[w] || w).filter(Boolean);
}

/** longest-common-subsequence alignment of reference vs said words */
export function compareRepeat(reference, said) {
  const a = words(reference), b = words(said);
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
export function recognitionQuality(text, seconds, logprobs) {
  const w = words(text);
  if (!w.length) return { ok: false, reason: "empty" };
  if (seconds > 4 && w.length < 2) return { ok: false, reason: "too-little" };
  if (Array.isArray(logprobs) && logprobs.length >= 3) {
    const lp = logprobs.map(Number).filter(Number.isFinite);
    const mean = lp.reduce((s, x) => s + x, 0) / lp.length;
    const conf = Math.exp(mean);                       // geometric-mean token probability
    if (conf < 0.45) return { ok: false, reason: "low-confidence", confidence: Math.round(conf * 100) / 100 };
    return { ok: true, confidence: Math.round(conf * 100) / 100 };
  }
  return { ok: true, confidence: null };
}

/* ---------------- open-answer evaluation ---------------- */
export const EVAL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["on_task", "understandable", "possible_recognition_issue", "scores", "level_estimate", "strengths", "corrections", "better_sentence", "feedback", "feedback_es", "follow_up"],
  properties: {
    on_task: { type: "boolean", description: "The response answers the prompt or fits the conversation turn." },
    understandable: { type: "boolean", description: "An English speaker would understand the intended meaning." },
    possible_recognition_issue: { type: "boolean", description: "The transcript contains words that look like speech-recognition errors rather than the learner's language." },
    scores: { type: "object", additionalProperties: false, required: ["clarity", "grammar", "vocabulary", "completeness"], properties: {
      clarity: { type: "integer", enum: [0, 1, 2, 3, 4] }, grammar: { type: "integer", enum: [0, 1, 2, 3, 4] },
      vocabulary: { type: "integer", enum: [0, 1, 2, 3, 4] }, completeness: { type: "integer", enum: [0, 1, 2, 3, 4] } } },
    level_estimate: { type: "string", enum: LEVELS, description: "Level shown by THIS response only." },
    strengths: { type: "array", maxItems: 2, items: { type: "string" } },
    corrections: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["said", "better", "why_es"], properties: {
      said: { type: "string" }, better: { type: "string" }, why_es: { type: "string" } } } },
    better_sentence: { type: "string", description: "A natural American English version that keeps the learner's own meaning." },
    feedback: { type: "string", description: "One to three short sentences, encouraging and specific." },
    feedback_es: { type: "string", description: "The same feedback in natural Latin American Spanish." },
    follow_up: { type: "string", description: "Conversation tasks only: the partner's natural next line. Otherwise empty." },
  },
};

export const SYSTEM = `You evaluate short spoken English responses from adult, Spanish-speaking baseball coaches (mostly Dominican) who are learning practical English. You receive the task, what a good answer should do, example answers and an automatic speech-recognition (ASR) transcript of what the learner said.

Rules:
- Judge communication: did the learner answer the prompt, could an English speaker understand the meaning, and how accurate are the words and grammar? Many valid answers exist; never require the example wording.
- Score each dimension 0-4 for the learner's stated level (0 nothing usable, 2 understandable with clear errors, 4 natural and accurate for that level). Be fair and consistent; do not inflate.
- Never judge pronunciation or accent: you only have text. Do not mention accent. Dominican and other Spanish accents are not errors.
- The transcript may contain ASR mistakes. If a word looks like a recognition error (a sound-alike, a nonsense word, a missing small word), do not count it as the learner's grammar or vocabulary error; set possible_recognition_issue to true instead.
- corrections: at most three, the most useful first, only real language errors (not ASR artifacts). "why_es" is one short, plain Spanish explanation.
- better_sentence: a natural, simple American English version of what the learner meant (for A0-A2 keep it short and simple). If the response is already natural, repeat it with at most small improvements.
- feedback: encouraging and direct, one to three short sentences, no grades, no exaggerated praise. Use English. feedback_es: the same in natural Latin American Spanish, using "tú".
- follow_up: only for conversation tasks, the partner's natural next line given what the learner said (stay in the scenario, max 20 words). Otherwise "".
- If the response is empty, off-topic or not English, say so kindly, give an example answer as better_sentence, and score accordingly.
Output only the JSON object.`;

const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/** OpenAI Responses API body for one evaluation (strict JSON schema output) */
export function evalRequest(model, task, transcript) {
  const t = {
    kind: TASKS.includes(task.kind) ? task.kind : "answer",
    level: LEVELS.includes(task.level) ? task.level : "A1",
    prompt: clip(task.prompt, 400), goal: clip(task.goal, 400),
    examples: (Array.isArray(task.examples) ? task.examples : []).slice(0, 3).map((x) => clip(x, 240)),
    setting: clip(task.setting, 400),
    history: (Array.isArray(task.history) ? task.history : []).slice(-6).map((h) => ({ who: h.who === "learner" ? "learner" : "partner", text: clip(h.text, 240) })),
  };
  const user = [
    `Task type: ${t.kind}`, `Learner level (estimated): ${t.level}`,
    t.setting ? `Scenario: ${t.setting}` : "",
    t.history.length ? `Conversation so far:\n${t.history.map((h) => `${h.who === "learner" ? "Learner" : "Partner"}: ${h.text}`).join("\n")}` : "",
    `Prompt the learner answered: "${t.prompt}"`, `A good answer: ${t.goal}`,
    t.examples.length ? `Example answers (not required wording):\n- ${t.examples.join("\n- ")}` : "",
    `ASR transcript of the learner's spoken response: "${clip(transcript, 800)}"`,
  ].filter(Boolean).join("\n\n");
  return {
    model, instructions: SYSTEM, input: [{ role: "user", content: user }],
    text: { format: { type: "json_schema", name: "speaking_feedback", strict: true, schema: EVAL_SCHEMA } },
    max_output_tokens: 700, store: false, prompt_cache_key: "cp-english-eval",
  };
}

/** validate + sanitise model output; null when it can't be trusted (nothing is shown or saved then) */
export function validateEval(o, kind) {
  if (!o || typeof o !== "object") return null;
  const b = (k) => typeof o[k] === "boolean";
  if (!b("on_task") || !b("understandable") || !b("possible_recognition_issue")) return null;
  const s = o.scores || {}, dims = ["clarity", "grammar", "vocabulary", "completeness"];
  if (!dims.every((d) => Number.isInteger(s[d]) && s[d] >= 0 && s[d] <= 4)) return null;
  if (!LEVELS.includes(o.level_estimate)) return null;
  const str = (k, n) => (typeof o[k] === "string" ? clip(o[k], n) : null);
  const feedback = str("feedback", 500), feedback_es = str("feedback_es", 600), better = str("better_sentence", 300), follow = str("follow_up", 200);
  if (feedback == null || feedback_es == null || better == null || follow == null || !feedback) return null;
  if (!Array.isArray(o.strengths) || !Array.isArray(o.corrections)) return null;
  const corrections = o.corrections.filter((c) => c && typeof c.said === "string" && typeof c.better === "string" && typeof c.why_es === "string")
    .slice(0, 3).map((c) => ({ said: clip(c.said, 200), better: clip(c.better, 200), why_es: clip(c.why_es, 300) })).filter((c) => c.said && c.better);
  return {
    on_task: o.on_task, understandable: o.understandable, possible_recognition_issue: o.possible_recognition_issue,
    scores: Object.fromEntries(dims.map((d) => [d, s[d]])), level_estimate: o.level_estimate,
    strengths: o.strengths.filter((x) => typeof x === "string").slice(0, 2).map((x) => clip(x, 200)),
    corrections, better_sentence: better, feedback, feedback_es,
    follow_up: kind === "conversation" ? follow : "",
  };
}

/** validates the browser's task description for an open answer */
export function readTask(t) {
  if (!t || typeof t !== "object") return null;
  const kind = TASKS.includes(t.kind) ? t.kind : null;
  if (!kind || !clip(t.prompt, 400)) return null;
  return { kind, level: LEVELS.includes(t.level) ? t.level : "A1", prompt: clip(t.prompt, 400), goal: clip(t.goal, 400),
    examples: Array.isArray(t.examples) ? t.examples.slice(0, 3).map((x) => clip(x, 240)) : [], setting: clip(t.setting, 400),
    history: Array.isArray(t.history) ? t.history.slice(-6).map((h) => ({ who: h && h.who === "learner" ? "learner" : "partner", text: clip(h && h.text, 240) })) : [] };
}
