/* English (CP English) — compile content + rendered audio into the app's data files, with validation. v2 (bilingual).
     node english/tools/build.mjs --jobs    write english/build/jobs.json (every audio file the app needs) — narrate.py renders it
     node english/tools/build.mjs           validate + build apps/english/data/
     node english/tools/build.mjs --check   validate only (CI / tests)
   Inputs:  english/content/catalog.json, course.json (Everyday English foundation), placement.json (+ placement-en-coaching.json),
            placement-es.json, lessons/<id>.json, english/research/terms-*.json, english/build/audio.json (from narrate.py)
   Outputs: apps/english/data/{catalog,foundation-en,placement-en,placement-es,terms}.json, lessons/<id>.json (generated — never hand-edit)
   Translations: each lesson/bank has a target and a native language; source fields name languages (X_es, {en, es}); the build
   rewrites the NATIVE-language translation to a generic `tr` (X_tr, {text, tr}) so one renderer serves both directions.
   Fails on: missing or stale audio, an answer outside its options, duplicate ids, an available lesson without content, a planned
   lesson in an active course without a plan, unknown activity types / speakers / clips / figures, narration that mixes languages. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = join(ROOT, "english", "content"), OUT = join(ROOT, "apps", "english", "data"), BUILD = join(ROOT, "english", "build");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const check = process.argv.includes("--check"), jobsOnly = process.argv.includes("--jobs");
const errors = [], warnings = [];
const DRAFT = process.env.ENGLISH_DRAFT === "1";      // development only: build with missing audio (never for a commit — check.mjs and tests use the strict build)
const err = (m) => errors.push(m);

const catalog = read(join(C, "catalog.json"));
const foundationEn = read(join(C, "course.json"));
const audio = existsSync(join(BUILD, "audio.json")) ? read(join(BUILD, "audio.json")) : { files: {} };
const vc = read(join(ROOT, "aperture", "content", "narration.json")).default;

/* ---------------- audio jobs (the digest narrate.py records) ---------------- */
const ENGINE = "Kokoro-82M v1.0 (q8 ONNX) via kokoro-onnx";
const DIALOGUE_SPEED = 0.98, TERM_SPEED = 0.95, GAP_SCENE = 0.85, GAP_TURN = 0.45;
const SPANISH = new Set(["ef_dora", "em_alex", "em_santa"]);
const langOfVoice = (v) => (SPANISH.has(v) ? "es" : "en");
const pyFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
function digest(segs) {
  const payload = "[" + segs.map((x) => `[${JSON.stringify(x.voice)},${pyFloat(x.speed)},${JSON.stringify(x.text)},${x.gap === 0 ? "0" : pyFloat(x.gap)}]`).join(",") + "]";
  return createHash("sha256").update(ENGINE + payload).digest("hex");
}
const jobs = [];
const voiceOf = (speakers, who) => (who == null || who === "narrator" ? [vc.voice, vc.speed] : speakers[who] ? [speakers[who].voice, DIALOGUE_SPEED] : null);
function clipSegs(clip, speakers, id) {
  return clip.lines.map((ln, i) => {
    const v = voiceOf(speakers, ln.speaker); if (!v) err(`${id}: unknown speaker ${ln.speaker}`);
    return { voice: v ? v[0] : "?", speed: v ? v[1] : 1, text: ln.text, gap: i === 0 ? 0 : GAP_TURN };
  });
}
function audioFor(kind, id, segs) {
  jobs.push({ kind, id, hash: digest(segs), segs: segs.map((s) => Object.assign({ lang: langOfVoice(s.voice) }, s)) });
  if (jobsOnly) return null;
  const a = audio.files[id];
  if (!a) { if (DRAFT) { warnings.push(id); return null; } err(`audio missing: ${id} (run english/tools/narrate.py)`); return null; }
  if (a.hash !== digest(segs)) err(`audio stale: ${id} (text or voice changed; run english/tools/narrate.py)`);
  if (!existsSync(join(ROOT, "apps", "english", a.audio))) err(`audio file missing on disk: ${a.audio}`);
  return a;
}

/* ---------------- translations → tr ---------------- */
const SP = /[áéíóúñ¿¡]/i;
function normalize(x, target, native) {
  if (Array.isArray(x)) return x.map((v) => normalize(v, target, native));
  if (!x || typeof x !== "object") return x;
  const o = {};
  const pair = typeof x.en === "string" && typeof x.es === "string" && x.text == null && x.line == null;
  for (const [k, v] of Object.entries(x)) {
    if (pair && (k === "en" || k === "es")) continue;
    if (!pair && k === native && typeof v === "string") { o.tr = v; continue; }
    const m = k.match(/^(.*)_(en|es)$/);
    // an English-speaking learner's own-language explanation (explain_en, tip_en, note_en…) with no other version is shown as is
    if (m && m[2] === native && typeof v === "string" && native === "en" && x[m[1]] == null && ["explain", "tip", "note", "intro", "setting", "objective", "caption", "title", "goal"].includes(m[1])) { o[m[1]] = v; continue; }
    if (m && m[2] === native && typeof v === "string") { o[m[1] + "_tr"] = v; continue; }
    o[k] = normalize(v, target, native);
  }
  if (pair) { o.text = x[target]; o.tr = x[native]; }
  return o;
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
const FIGURES = new Set(["ball-seams", "hand-fingers", "grip-4s", "grip-2s", "grip-change", "delivery-a", "delivery-b", "infield", "infield-shade", "ready-position"]);
const LEVELS = ["A0", "A1", "A2", "B1", "B2"];

/* ---------------- catalog + foundations ---------------- */
const lessonMeta = {};          // id → { course key, target, native, title… }
for (const l of foundationEn.lessons) {
  uniq(l.id, "foundation-en");
  lessonMeta[l.id] = { courseId: "en-general", key: "en/general", target: "en", native: "es", status: l.status };
  if (l.status === "available" && !existsSync(join(C, "lessons", l.id + ".json"))) err(`foundation lesson ${l.id} is available but has no content file`);
}
{
  const unitIds = new Set(foundationEn.units.map((u) => u.id)), trackIds = new Set(foundationEn.tracks.map((t) => t.id));
  for (const l of foundationEn.lessons) { if (!unitIds.has(l.unit)) err(`foundation ${l.id}: unknown unit`); if (!trackIds.has(l.track)) err(`foundation ${l.id}: unknown track`); }
  for (const t of foundationEn.tracks) {
    const weeks = foundationEn.lessons.filter((l) => l.track === t.id).map((l) => l.week).sort((a, b) => a - b);
    if (weeks.length !== 16 || weeks.some((w, i) => w !== i + 1)) err(`foundation track ${t.id}: needs one lesson per week 1–16`);
  }
}
const SPECS = Object.keys(catalog.specialties), LANGS = Object.keys(catalog.languages);
for (const t of LANGS) for (const s of SPECS) if (!catalog.courses.some((c) => c.target === t && c.specialty === s)) err(`catalog: no course for ${t} × ${s} (every combination needs an entry, active or planned)`);
for (const c of catalog.courses) {
  uniq(c.id, "catalog");
  if (c.native !== catalog.languages[c.target].native) err(`catalog ${c.id}: native language mismatch`);
  if (c.status === "active") {
    if (!(c.lessons || []).some((l) => l.status === "available")) err(`catalog ${c.id}: an active course needs at least one available lesson`);
    for (const l of c.lessons) {
      uniq(l.id, c.id);
      lessonMeta[l.id] = { courseId: c.id, key: `${c.target}/${c.specialty}`, target: c.target, native: c.native, status: l.status };
      if (l.status === "available" && !existsSync(join(C, "lessons", l.id + ".json"))) err(`${c.id}/${l.id} is available but has no content file`);
      if (l.status === "planned" && !(l.plan && l.plan.modules && l.plan.scenario && l.plan.assessment)) err(`${c.id}/${l.id}: planned lessons need a plan (modules, scenario, assessment)`);
    }
  } else if (c.lessons && c.lessons.some((l) => l.status === "available")) err(`catalog ${c.id}: a planned course can't have available lessons`);
}

/* ---------------- lessons ---------------- */
const lessons = {};
for (const f of readdirSync(join(C, "lessons")).filter((x) => x.endsWith(".json"))) {
  const src = read(join(C, "lessons", f)), where = src.id;
  const meta = lessonMeta[src.id];
  if (!meta || meta.status !== "available") { err(`${where}: not an available lesson in the catalog / foundation`); continue; }
  const target = src.target || meta.target, native = src.native || meta.native;
  if (target !== meta.target) err(`${where}: target language differs from its course`);
  const sp = src.speakers || {}, v2 = !!src.course;
  for (const [k, s] of Object.entries(sp)) if (langOfVoice(s.voice) !== target) err(`${where}: speaker ${k} has a ${langOfVoice(s.voice)} voice in a ${target} lesson`);
  // lecture: one narration file, cue timings from the render
  const segs = []; let prev = null;
  src.lecture.scenes.forEach((sc, si) => {
    if (sc.visual && sc.visual.type === "figure" && !FIGURES.has(sc.visual.figure)) err(`${where}: unknown figure ${sc.visual.figure}`);
    sc.cues.forEach((cue, ci) => {
      const v = voiceOf(sp, cue.speaker); if (!v) err(`${where} lecture: unknown speaker ${cue.speaker}`);
      const spoken = cue.say || cue.text, isNarr = !cue.speaker;
      if (isNarr && target === "es" && SP.test(spoken)) err(`${where} lecture: the English narrator would read Spanish: "${spoken.slice(0, 60)}" — split it into a Spanish speaker cue`);
      if (target === "en" && !cue.es) err(`${where} lecture: cue without Spanish: ${cue.text.slice(0, 40)}`);
      if (target === "es" && !isNarr && !cue.en) err(`${where} lecture: Spanish cue without English: ${cue.text.slice(0, 40)}`);
      segs.push({ voice: v ? v[0] : "?", speed: v ? v[1] : 1, text: spoken, gap: si === 0 && ci === 0 ? 0 : ci === 0 ? GAP_SCENE : (cue.speaker !== prev ? GAP_TURN : vc.cueGap) });
      prev = cue.speaker;
    });
  });
  const la = audioFor("lecture", src.id, segs);
  let k = 0;
  const lecture = { ...src.lecture, audio: la && la.audio, duration: la && la.duration, scenes: src.lecture.scenes.map((sc) => ({ ...sc, cues: sc.cues.map((c) => {
    const t = la && la.cues[k++]; const { say, ...rest } = c;
    return { ...rest, lang: c.speaker ? langOfVoice(sp[c.speaker] && sp[c.speaker].voice) : "en", start: t ? t[0] : null, end: t ? t[1] : null };
  }) })) };
  if (la && la.cues.length !== segs.length) err(`${where}: lecture timing count mismatch`);
  // clips
  const clips = {};
  for (const [cid, clip] of Object.entries(src.clips || {})) {
    uniq("clip:" + cid, where);
    if (v2) clip.lines.forEach((ln, i) => { if (!ln[native]) err(`${where}/${cid} line ${i + 1}: missing ${native} translation`); });
    const a = audioFor("clip", cid, clipSegs(clip, sp, cid));
    clips[cid] = { ...clip, audio: a && a.audio, duration: a && a.duration, lines: clip.lines.map((ln, i) => ({ ...ln, start: a ? a.cues[i][0] : null, end: a ? a.cues[i][1] : null })) };
  }
  // activities
  const n = { practice: 0, order: 0, listening: 0, repeat: 0, answer: 0, conversation: 0, mastery: 0, match: 0 };
  for (const sec of src.sections) for (const a of sec.activities) {
    uniq(a.id, where);
    if (!TYPES.has(a.type)) err(`${where}/${a.id}: unknown type ${a.type}`);
    if (a.clip && !clips[a.clip]) err(`${where}/${a.id}: unknown clip ${a.clip}`);
    if (a.type === "choice") { choiceOk(a, `${where}/${a.id}`); n.practice++; }
    if (a.type === "order") { if (!a.answers || !a.answers.length) err(`${where}/${a.id}: order needs answers`); n.practice++; n.order++; }
    if (a.type === "match") { n.practice++; n.match++; }
    if (a.type === "listen") { n.listening++; a.questions.forEach((q) => choiceOk(q, `${where}/${a.id}/${q.id}`)); }
    if (a.type === "repeat") { n.repeat++; if (!a.text) err(`${where}/${a.id}: repeat needs text`); }
    if (a.type === "answer") { n.answer++; if (!(a.goal && a.examples && a.examples.length)) err(`${where}/${a.id}: answer needs goal + examples`); }
    if (a.type === "conversation") {
      n.conversation++;
      if (!sp[a.partner]) err(`${where}/${a.id}: unknown partner ${a.partner}`);
      a.turns.forEach((t, i) => {
        if (!clips[t.clip]) err(`${where}/${a.id} turn ${i + 1}: unknown clip`);
        choiceOk(t.fallback, `${where}/${a.id} turn ${i + 1} fallback`);
        for (const b of ["ack", "clarify"]) if (t[b] && !clips[t[b].clip]) err(`${where}/${a.id} turn ${i + 1}: unknown ${b} clip`);
        if (v2 && (!t.ack || !t.clarify)) err(`${where}/${a.id} turn ${i + 1}: v2 turns need ack + clarify`);
      });
    }
    if (a.type === "mastery") { n.mastery++; a.items.forEach((q) => { choiceOk(q, `${where}/${a.id}/${q.id}`); if (q.clip && !clips[q.clip]) err(`${where}/${a.id}/${q.id}: unknown clip`); }); }
  }
  if (n.practice < 8) err(`${where}: needs at least 8 practice items (has ${n.practice})`);
  if (n.listening < 2) err(`${where}: needs at least 2 listening activities`);
  if (n.repeat + n.answer + n.conversation < 3) err(`${where}: needs at least 3 speech interactions`);
  if (v2) {
    if (n.repeat < 2 || n.answer < 2 || n.conversation < 1 || n.mastery < 1 || n.order < 2 || n.match < 1) err(`${where}: v2 lesson needs ≥2 repeat, ≥2 answer, 1 conversation, 1 mastery, ≥2 order, ≥1 match (${JSON.stringify(n)})`);
  }
  const intro = target === "es" ? Object.fromEntries(Object.entries(src.intro || {}).filter(([k2]) => k2 !== "can_tr")) : src.intro;   // can_tr in a Spanish lesson is the Spanish version, not a translation
  const out = normalize({ ...src, intro, lecture, clips }, target, native);
  out.target = target; out.native = native; out.course = meta.courseId; out.courseKey = meta.key;
  lessons[src.id] = out;
}

/* ---------------- placement banks ---------------- */
function bank(parts, target, native, id) {
  const speakers = {}, clipsSrc = {}, items = [], speaking = [];
  for (const p of parts) {
    for (const [k, s] of Object.entries(p.speakers || {})) { if (speakers[k] && speakers[k].voice !== s.voice) err(`${id}: speaker ${k} has two voices`); speakers[k] = s; }
    Object.assign(clipsSrc, p.clips || {}); items.push(...p.items); speaking.push(...(p.speaking || []));
  }
  const clips = {};
  for (const [cid, clip] of Object.entries(clipsSrc)) {
    uniq("clip:" + cid, id);
    const a = audioFor("clip", cid, clipSegs(clip, speakers, cid));
    clips[cid] = { audio: a && a.audio, duration: a && a.duration, transcript: clip.lines.map((l) => l.text).join(" "), lines: clip.lines.map((l) => ({ speaker: l.speaker, text: l.text, tr: l[native] || null })) };
  }
  for (const it of items) {
    uniq(it.id, id); choiceOk(it, `${id}/${it.id}`);
    if (!LEVELS.includes(it.level)) err(`${id}/${it.id}: bad level`);
    if (it.clip && !clips[it.clip]) err(`${id}/${it.id}: unknown clip`);
    it.domain = it.domain || "general";
  }
  for (const L of LEVELS) { const k = items.filter((i) => i.level === L && i.domain === "general").length; if (k < 6) err(`${id}: level ${L} needs at least 6 general items (has ${k})`); }
  for (const s of speaking) { uniq(s.id, id); if (!clips[s.clip]) err(`${id}/${s.id}: unknown clip`); s.domain = s.domain || "general"; }
  if (speaking.filter((s) => s.domain === "general").length < 6) err(`${id}: needs 6 general speaking tasks`);
  for (const c of catalog.courses.filter((c) => c.status === "active" && c.target === target)) {
    if (items.filter((i) => i.domain === c.specialty).length < 8) err(`${id}: active course ${c.id} needs ≥ 8 ${c.specialty} items`);
    if (speaking.filter((s) => s.domain === c.specialty).length < 2) err(`${id}: active course ${c.id} needs 2 ${c.specialty} speaking scenarios`);
  }
  return normalize({ id, target, native, levels: LEVELS, speakers, clips, items, speaking }, target, native);
}
const pEnParts = [read(join(C, "placement.json"))];
if (existsSync(join(C, "placement-en-coaching.json"))) pEnParts.push(read(join(C, "placement-en-coaching.json")));
const placementEn = bank(pEnParts, "en", "es", "placement-en");
const placementEs = bank([read(join(C, "placement-es.json"))], "es", "en", "placement-es");

/* ---------------- terminology library ---------------- */
const terms = [];
for (const f of ["terms-pitching.json", "terms-defense.json"]) {
  const p = join(ROOT, "english", "research", f);
  if (!existsSync(p)) continue;
  const spec = f.includes("pitching") ? "pitching" : "defense";
  for (const t of read(p)) {
    const id = `${spec[0]}-${t.id}`;
    if (terms.some((x) => x.id === id)) { err(`terms: duplicate ${id}`); continue; }
    if (!t.en || !t.es || !t.meaning) err(`terms ${id}: needs en, es and meaning`);
    const ae = audioFor("term", `t-en-${id}`, [{ voice: "am_michael", speed: TERM_SPEED, text: t.en, gap: 0 }]);
    const as = audioFor("term", `t-es-${id}`, [{ voice: "em_alex", speed: TERM_SPEED, text: t.es, gap: 0 }]);
    terms.push(Object.assign({}, t, { id, source_file: f, audio_en: ae && ae.audio, audio_es: as && as.audio }));
  }
}
const termSources = {};
for (const [f, spec] of [["pitching.md", "pitching"], ["defense.md", "defense"]]) {
  const p = join(ROOT, "english", "research", f);
  if (!existsSync(p)) continue;
  const md = readFileSync(p, "utf8"), bib = md.slice(md.search(/^#+\s*(\d+\.\s*)?Bibliography/im));
  const map = {};
  for (const m of bib.matchAll(/^\s*(?:\[(\d+)\]|(\d+)\.)\s+(.+)$/gm)) map[m[1] || m[2]] = m[3].replace(/\*\*/g, "").slice(0, 400);
  termSources[spec] = map;
}

/* ---------------- output ---------------- */
if (jobsOnly) {
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(join(BUILD, "jobs.json"), JSON.stringify({ engine: ENGINE, narrator: { label: vc.label, voice: vc.voice, speed: vc.speed }, jobs }) + "\n");
  if (errors.length) console.error("warnings while listing jobs:\n  " + errors.join("\n  "));
  console.log(`audio jobs: ${jobs.length} → english/build/jobs.json`);
  process.exit(0);
}
if (errors.length) { console.error("CP English build failed:\n  " + errors.join("\n  ")); process.exit(1); }
if (!check) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "lessons"), { recursive: true });
  const narrator = { label: vc.label, voice: vc.voice, speed: vc.speed, engine: ENGINE, spanish: ["em_alex", "em_santa", "ef_dora"] };
  const built = new Date().toISOString().slice(0, 10);
  const minutesOf = (id) => (lessons[id] ? lessons[id].minutes : null);
  const cat = normalize({ ...catalog }, "en", "es");
  const outCatalog = Object.assign({}, catalog, { narrator, built,
    courses: catalog.courses.map((c) => Object.assign({}, c, { key: `${c.target}/${c.specialty}`, lessons: (c.lessons || []).map((l) => Object.assign({ minutes: minutesOf(l.id) }, l)) })),
    foundations: Object.fromEntries(Object.entries(catalog.foundations).map(([k, f]) => [k, Object.assign({ key: `${f.target}/general` }, f, f.source ? { lessons: foundationEn.lessons.map((l) => Object.assign({ minutes: minutesOf(l.id) }, l)) } : {})])) });
  void cat;
  writeFileSync(join(OUT, "catalog.json"), JSON.stringify(outCatalog) + "\n");
  writeFileSync(join(OUT, "foundation-en.json"), JSON.stringify({ ...foundationEn, narrator, built }) + "\n");
  writeFileSync(join(OUT, "placement-en.json"), JSON.stringify(placementEn) + "\n");
  writeFileSync(join(OUT, "placement-es.json"), JSON.stringify(placementEs) + "\n");
  writeFileSync(join(OUT, "terms.json"), JSON.stringify({ terms, sources: termSources, built }) + "\n");
  for (const [id, l] of Object.entries(lessons)) writeFileSync(join(OUT, "lessons", id + ".json"), JSON.stringify(l) + "\n");
}
if (warnings.length) console.warn(`DRAFT build: ${warnings.length} audio file(s) missing`);
const avail = Object.keys(lessons).length;
console.log(`CP English ${check ? "content valid" : "built"}: ${catalog.courses.length} courses (${catalog.courses.filter((c) => c.status === "active").length} active), ${avail} lessons available, placement en ${placementEn.items.length}+${placementEn.speaking.length} · es ${placementEs.items.length}+${placementEs.speaking.length}, ${terms.length} terms.`);
