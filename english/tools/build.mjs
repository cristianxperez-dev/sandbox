/* CP English — compile content + rendered audio into the app's data files, with validation.
     node english/tools/build.mjs           build apps/english/data/
     node english/tools/build.mjs --check   validate only (CI / tests)
   Inputs:  english/content/{course,placement}.json, english/content/lessons/<id>.json,
            english/build/audio.json (written by english/tools/narrate.py)
   Outputs: apps/english/data/course.json, placement.json, lessons/<id>.json  (generated — never hand-edit)
   Fails on: missing or stale audio, an answer index outside its options, duplicate ids, an "available"
   lesson without a content file, unknown activity types or speakers. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = join(ROOT, "english", "content"), OUT = join(ROOT, "apps", "english", "data");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const check = process.argv.includes("--check");
const errors = [];
const err = (m) => errors.push(m);

const course = read(join(C, "course.json"));
const placement = read(join(C, "placement.json"));
const audio = existsSync(join(ROOT, "english", "build", "audio.json")) ? read(join(ROOT, "english", "build", "audio.json")) : { files: {} };
const vc = read(join(ROOT, "aperture", "content", "narration.json")).default;

/* the same digest narrate.py computes (stale-audio check) */
const ENGINE = "Kokoro-82M v1.0 (q8 ONNX) via kokoro-onnx";
const DIALOGUE_SPEED = 0.98, GAP_SCENE = 0.85, GAP_TURN = 0.45;
const pyFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
function digest(segs) {
  const payload = "[" + segs.map((x) => `[${JSON.stringify(x.voice)},${pyFloat(x.speed)},${JSON.stringify(x.text)},${x.gap === 0 ? "0" : pyFloat(x.gap)}]`).join(",") + "]";
  return createHash("sha256").update(ENGINE + payload).digest("hex");
}
const voiceOf = (speakers, who) => (who == null || who === "narrator" ? [vc.voice, vc.speed] : speakers[who] ? [speakers[who].voice, DIALOGUE_SPEED] : null);
function clipSegs(clip, speakers, id) {
  return clip.lines.map((ln, i) => {
    const v = voiceOf(speakers, ln.speaker); if (!v) err(`${id}: unknown speaker ${ln.speaker}`);
    return { voice: v ? v[0] : "?", speed: v ? v[1] : 1, text: ln.text, gap: i === 0 ? 0 : GAP_TURN };
  });
}
function audioFor(id, segs) {
  const a = audio.files[id];
  if (!a) { err(`audio missing: ${id} (run english/tools/narrate.py)`); return null; }
  if (a.hash !== digest(segs)) err(`audio stale: ${id} (text or voice changed; run english/tools/narrate.py)`);
  if (!existsSync(join(ROOT, "apps", "english", a.audio))) err(`audio file missing on disk: ${a.audio}`);
  return a;
}

/* ---------------- validation helpers ---------------- */
const ids = new Set();
const uniq = (id, where) => { if (ids.has(id)) err(`duplicate id ${id} (${where})`); ids.add(id); };
function choiceOk(q, where) {
  if (!Array.isArray(q.options) || q.options.length < 2) return err(`${where}: needs options`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) err(`${where}: answer index out of range`);
  if (new Set(q.options).size !== q.options.length) err(`${where}: duplicate options`);
}
const TYPES = new Set(["lecture", "match", "listen", "choice", "order", "repeat", "answer", "conversation", "mastery"]);

/* ---------------- course ---------------- */
const unitIds = new Set(course.units.map((u) => u.id)), trackIds = new Set(course.tracks.map((t) => t.id));
for (const l of course.lessons) {
  uniq(l.id, "course");
  if (!unitIds.has(l.unit)) err(`lesson ${l.id}: unknown unit ${l.unit}`);
  if (!trackIds.has(l.track)) err(`lesson ${l.id}: unknown track ${l.track}`);
  if (l.status === "available" && !existsSync(join(C, "lessons", l.id + ".json"))) err(`lesson ${l.id} is available but has no content file`);
}
for (const t of course.tracks) {
  const weeks = course.lessons.filter((l) => l.track === t.id).map((l) => l.week).sort((a, b) => a - b);
  if (weeks.length !== 16 || weeks.some((w, i) => w !== i + 1)) err(`track ${t.id}: needs one lesson per week 1–16`);
}

/* ---------------- lessons ---------------- */
const lessons = {};
for (const f of readdirSync(join(C, "lessons")).filter((x) => x.endsWith(".json"))) {
  const les = read(join(C, "lessons", f)), sp = les.speakers || {}, where = les.id;
  if (!course.lessons.some((l) => l.id === les.id && l.status === "available")) err(`${where}: not an available lesson in course.json`);
  // lecture: one narration file, cue timings from the render
  const segs = []; let prev = null;
  les.lecture.scenes.forEach((sc, si) => sc.cues.forEach((cue, ci) => {
    const v = voiceOf(sp, cue.speaker); if (!v) err(`${where} lecture: unknown speaker ${cue.speaker}`);
    if (!cue.es) err(`${where} lecture: cue without Spanish: ${cue.text.slice(0, 40)}`);
    segs.push({ voice: v ? v[0] : "?", speed: v ? v[1] : 1, text: cue.say || cue.text, gap: si === 0 && ci === 0 ? 0 : ci === 0 ? GAP_SCENE : (cue.speaker !== prev ? GAP_TURN : vc.cueGap) });
    prev = cue.speaker;
  }));
  const la = audioFor(les.id, segs);
  let k = 0;
  const lecture = { ...les.lecture, audio: la && la.audio, duration: la && la.duration, scenes: les.lecture.scenes.map((sc) => ({ ...sc, cues: sc.cues.map((c) => {
    const t = la && la.cues[k++]; const { say, ...rest } = c;
    return { ...rest, start: t ? t[0] : null, end: t ? t[1] : null };
  }) })) };
  if (la && la.cues.length !== segs.length) err(`${where}: lecture timing count mismatch`);
  // clips
  const clips = {};
  for (const [cid, clip] of Object.entries(les.clips || {})) {
    uniq(cid, where);
    const a = audioFor(cid, clipSegs(clip, sp, cid));
    clips[cid] = { ...clip, audio: a && a.audio, duration: a && a.duration, lines: clip.lines.map((ln, i) => ({ ...ln, start: a ? a.cues[i][0] : null, end: a ? a.cues[i][1] : null })) };
  }
  // activities
  let practice = 0, listening = 0, speech = 0;
  for (const sec of les.sections) for (const a of sec.activities) {
    uniq(a.id, where);
    if (!TYPES.has(a.type)) err(`${where}/${a.id}: unknown type ${a.type}`);
    if (a.clip && !clips[a.clip]) err(`${where}/${a.id}: unknown clip ${a.clip}`);
    if (a.type === "choice") { choiceOk(a, `${where}/${a.id}`); practice++; }
    if (a.type === "order") { if (!a.answers || !a.answers.length) err(`${where}/${a.id}: order needs answers`); practice++; }
    if (a.type === "match") practice++;
    if (a.type === "listen") { listening++; a.questions.forEach((q) => choiceOk(q, `${where}/${a.id}/${q.id}`)); }
    if (["repeat", "answer", "conversation"].includes(a.type)) speech++;
    if (a.type === "repeat" && !a.text) err(`${where}/${a.id}: repeat needs text`);
    if (a.type === "answer" && !(a.goal && a.examples && a.examples.length)) err(`${where}/${a.id}: answer needs goal + examples`);
    if (a.type === "conversation") a.turns.forEach((t, i) => { if (!clips[t.clip]) err(`${where}/${a.id} turn ${i + 1}: unknown clip`); choiceOk(t.fallback, `${where}/${a.id} turn ${i + 1} fallback`); });
    if (a.type === "mastery") a.items.forEach((q) => { choiceOk(q, `${where}/${a.id}/${q.id}`); if (q.clip && !clips[q.clip]) err(`${where}/${a.id}/${q.id}: unknown clip`); });
  }
  if (practice < 8) err(`${where}: needs at least 8 practice items (has ${practice})`);
  if (listening < 2) err(`${where}: needs at least 2 listening activities`);
  if (speech < 3) err(`${where}: needs at least 3 speech interactions`);
  lessons[les.id] = { ...les, lecture, clips };
}

/* ---------------- placement ---------------- */
const pClips = {};
for (const [cid, clip] of Object.entries(placement.clips)) {
  const a = audioFor(cid, clipSegs(clip, placement.speakers, cid));
  pClips[cid] = { audio: a && a.audio, duration: a && a.duration, transcript: clip.lines.map((l) => l.text).join(" ") };
}
for (const it of placement.items) {
  uniq(it.id, "placement"); choiceOk(it, `placement/${it.id}`);
  if (!placement.levels.includes(it.level)) err(`placement/${it.id}: bad level`);
  if (it.clip && !pClips[it.clip]) err(`placement/${it.id}: unknown clip`);
}
for (const lv of placement.levels) {
  const n = placement.items.filter((i) => i.level === lv).length;
  if (n < 6) err(`placement: level ${lv} needs at least 6 items (has ${n})`);
}
for (const s of placement.speaking) if (!pClips[s.clip]) err(`placement/${s.id}: unknown clip`);

if (errors.length) { console.error("CP English build failed:\n  " + errors.join("\n  ")); process.exit(1); }
if (!check) {
  mkdirSync(join(OUT, "lessons"), { recursive: true });
  const narrator = { label: vc.label, voice: vc.voice, speed: vc.speed, engine: ENGINE };
  writeFileSync(join(OUT, "course.json"), JSON.stringify({ ...course, narrator, built: new Date().toISOString().slice(0, 10) }) + "\n");
  writeFileSync(join(OUT, "placement.json"), JSON.stringify({ ...placement, clips: pClips }) + "\n");
  for (const [id, l] of Object.entries(lessons)) writeFileSync(join(OUT, "lessons", id + ".json"), JSON.stringify(l) + "\n");
}
console.log(`CP English ${check ? "content valid" : "built"}: ${course.lessons.length} lessons in the roadmap (${Object.keys(lessons).length} available), ${placement.items.length} placement items + ${placement.speaking.length} speaking tasks.`);
