// Manager Hub — Describe Your Day: evaluation scenarios + rubric checks.
// Written against the documented contract only (manager-hub/DAY-ENGINE.md §3–§5, §8),
// never against the implementation, so the judgement of the output stays independent.
//
// Times are minutes after midnight. Scenario times are written as 24-hour "HH:MM" strings.
// A check is { name, fn(r) } where r = { plan, request, state, prev, prevRequest, ctx }
// (prev* only in refinement steps). fn returns null on pass, or a short reason string.

// ─────────────────────────────── helpers ───────────────────────────────
export const T = (s) => {
  if (typeof s === "number") return s;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) throw new Error(`bad time literal ${s}`);
  return +m[1] * 60 + +m[2];
};
export const fmt = (m) => (typeof m === "number" && Number.isFinite(m) ? `${Math.floor(m / 60)}:${String(((m % 60) + 60) % 60).padStart(2, "0")}` : String(m));
const K = (k) => (k == null ? null : Array.isArray(k) ? k : [k]);
export const items = (p) => (p && Array.isArray(p.items) ? p.items : []);
const dur = (i) => i.end - i.start;
const pick = (p, kind, o = {}) =>
  items(p)
    .filter((i) => (kind == null || K(kind).includes(i.kind)) && (!o.who || i.track === o.who))
    .sort((a, b) => a.start - b.start || a.end - b.end);
const brief = (i) => `${fmt(i.start)}–${fmt(i.end)} ${i.kind}[${i.track}${i.group ? "/" + i.group : ""}]`;
const list = (arr) => (arr.length ? arr.map(brief).join(", ") : "none");
const sum = (arr) => arr.reduce((s, i) => s + dur(i), 0);
const kname = (k) => (k == null ? "any" : K(k).join("|"));
const c = (name, fn) => ({ name, fn });
const textOf = (r) =>
  []
    .concat((r.request && r.request.unknown) || [], (r.request && r.request.notes) || [], ((r.plan && r.plan.assumptions) || []).map((a) => (a && a.text) || String(a)))
    .join(" | ");

// Kind groups (DAY-ENGINE.md §3)
export const DEF = ["teamDefense", "indDefense"];
export const HIT = ["bp", "cage", "liveBp"];
export const PITCH = ["pitcherWork", "bullpen", "pfp"];
export const WORK = ["throwing", "teamDefense", "indDefense", "pfp", "bp", "liveBp", "baserunning", "pitcherWork", "bullpen"];
const STRUCT = ["free", "pregamePrep", "arrival"]; // structural items the solver may always add
const WARMUP = ["stretch", "activation", "throwing"]; // tolerated where a coordinator would not object
const KINDS = ["arrival", "meeting", "meal", "earlyWork", "activation", "stretch", "throwing", "teamDefense", "indDefense", "pfp", "bullpen", "pitcherWork", "baserunning", "bp", "cage", "liveBp", "conditioning", "free", "pregamePrep", "game", "postgame", "custom"];
const TRACKS = ["all", "position", "pitchers", "catchers"];

// Two items compete for the same people when either is team-wide, or they are on the same
// track and not explicitly assigned to different groups (Blue in the cage while Orange hits on the field is fine).
export function collide(a, b) {
  if (a.track === "all" || b.track === "all") return true;
  if (a.track !== b.track) return false;
  if (a.group && b.group && a.group !== b.group) return false;
  return true;
}
export function overlaps(p) {
  const it = items(p).filter((i) => dur(i) > 0);
  const out = [];
  for (let x = 0; x < it.length; x++)
    for (let y = x + 1; y < it.length; y++) {
      const a = it[x], b = it[y];
      if (a.start < b.end && b.start < a.end && collide(a, b)) out.push([a, b]);
    }
  return out;
}
const timeRe = /\d{1,2}:\d{2}/;
const durRe = /\d+\s*(h\b|hr|hrs|hours?|min|mins|minutes)/i;

// ─────────────────────────────── base checks (applied by the runner) ───────────────────────────────
export const contractShape = () =>
  c("plan has the DayPlan shape (§5)", (r) => {
    const p = r.plan;
    if (!p || typeof p !== "object") return "no plan";
    if (!Array.isArray(p.items)) return "plan.items is not an array";
    if (!Array.isArray(p.conflicts)) return "plan.conflicts is not an array";
    if (!Array.isArray(p.assumptions)) return "plan.assumptions is not an array";
    if (typeof p.ok !== "boolean") return "plan.ok is not boolean";
    const bad = p.items.filter((i) => !Number.isInteger(i.start) || !Number.isInteger(i.end) || !KINDS.includes(i.kind) || !TRACKS.includes(i.track));
    return bad.length ? `malformed items: ${bad.map((i) => JSON.stringify({ kind: i.kind, track: i.track, start: i.start, end: i.end })).join("; ")}` : null;
  });
export const on5 = () =>
  c("all times on 5-minute marks", (r) => {
    const bad = items(r.plan).filter((i) => i.start % 5 !== 0 || (i.kind !== "game" && i.end % 5 !== 0));
    return bad.length ? `off-grid: ${list(bad)}` : null;
  });
const BOUNDS = { arrival: [0, 30], game: [0, 600], postgame: [5, 60], free: [5, 240], pregamePrep: [5, 120], meal: [15, 60], meeting: [5, 45], stretch: [5, 30], activation: [5, 30], throwing: [5, 40], teamDefense: [10, 60], indDefense: [10, 60], pfp: [10, 45], bullpen: [10, 75], pitcherWork: [10, 75], baserunning: [5, 45], bp: [10, 60], cage: [10, 90], liveBp: [15, 75], conditioning: [10, 75], earlyWork: [15, 90], custom: [5, 120] };
export const sane = () =>
  c("durations sane (no 0-min work, no 3-hour defense; stated lengths may exceed the cap)", (r) => {
    const bad = items(r.plan).filter((i) => {
      const b = BOUNDS[i.kind];
      if (!b) return false;
      const d = dur(i);
      if (d < 0) return true;
      if (d < b[0]) return true;
      return d > b[1] && i.source !== "stated";
    });
    return bad.length ? `out of bounds: ${bad.map((i) => `${brief(i)} (${dur(i)} min)`).join(", ")}` : null;
  });
export const honest = () =>
  c("never a silently broken plan (overlap / past hard stop / before start ⇒ conflict raised)", (r) => {
    const p = r.plan;
    const a = (r.request && r.request.anchors) || {};
    const probs = [];
    overlaps(p).forEach(([x, y]) => probs.push(`overlap ${brief(x)} × ${brief(y)}`));
    if (Number.isInteger(a.end)) items(p).filter((i) => !["game", "postgame", "free"].includes(i.kind) && i.end > a.end).forEach((i) => probs.push(`past hard stop ${fmt(a.end)}: ${brief(i)}`));
    // the day may widen to include a stated earlier item (a bus, a meeting); the plan's window says where it starts
    const st = Number.isInteger(a.start) ? Math.min(a.start, p && p.window && Number.isInteger(p.window.start) ? p.window.start : a.start) : null;
    if (st != null) items(p).filter((i) => i.kind !== "arrival" && i.start < st).forEach((i) => probs.push(`before start ${fmt(st)}: ${brief(i)}`));
    if (!probs.length) return null;
    return p && Array.isArray(p.conflicts) && p.conflicts.length && p.ok === false ? null : `problems without a conflict / ok:false — ${probs.join("; ")}`;
  });
export const assumptionsMax = (n = 6) =>
  c(`assumptions ≤ ${n}`, (r) => {
    const a = (r.plan && r.plan.assumptions) || [];
    return a.length <= n ? null : `${a.length} assumptions`;
  });
export const noOverlap = () =>
  c("no overlaps within a track; team-wide items overlap nothing", (r) => {
    const o = overlaps(r.plan);
    return o.length ? o.map(([a, b]) => `${brief(a)} × ${brief(b)}`).join("; ") : null;
  });
export const okIs = (v) => c(`ok is ${v}`, (r) => (r.plan && r.plan.ok === v ? null : `ok = ${r.plan && r.plan.ok}`));
export const noErrors = () =>
  c("no error-severity conflicts", (r) => {
    const e = ((r.plan && r.plan.conflicts) || []).filter((x) => x.severity === "error");
    return e.length ? e.map((x) => `${x.code}: ${x.message}`).join("; ") : null;
  });

// ─────────────────────────────── presence / invention ───────────────────────────────
export const has = (kind, o = {}) =>
  c(`has ${kname(kind)}${o.who ? ` [${o.who}]` : ""}${o.min > 1 ? ` ×≥${o.min}` : ""}`, (r) => {
    const n = pick(r.plan, kind, o).length;
    if (n < (o.min ?? 1)) return `found ${n}`;
    if (o.max != null && n > o.max) return `found ${n} > ${o.max}`;
    return null;
  });
export const hasLabel = (re, kind) =>
  c(`has an item labelled ${re}`, (r) => (pick(r.plan, kind).some((i) => re.test(`${i.label || ""} ${i.group || ""}`)) ? null : "no such label"));
export const lacks = (kind, o = {}) =>
  c(`nothing invented: no ${kname(kind)}${o.who ? ` [${o.who}]` : ""}`, (r) => {
    const f = pick(r.plan, kind, o);
    return f.length ? `found ${list(f)}` : null;
  });
export const noPitcherWork = () =>
  c("no invented pitcher work (no PFP/pens/pitcher program, nothing on the pitchers' track)", (r) => {
    const f = items(r.plan).filter((i) => PITCH.includes(i.kind) || i.track === "pitchers");
    return f.length ? `found ${list(f)}` : null;
  });
export const only = (allowed, o = {}) =>
  c(`nothing invented: kinds ⊆ {${allowed.join(", ")}${o.warmup ? ", warm-ups" : ""}} + structural`, (r) => {
    const ok = new Set([...allowed, ...STRUCT, ...(o.warmup ? WARMUP : [])]);
    const f = items(r.plan).filter((i) => !ok.has(i.kind));
    return f.length ? `unexpected ${list(f)}` : null;
  });

// ─────────────────────────────── times ───────────────────────────────
export const fixedAt = (kind, time, o = {}) =>
  c(`${kname(kind)}${o.who ? ` [${o.who}]` : ""} at ${time}${o.fixed === false ? "" : " (fixed)"}`, (r) => {
    const f = pick(r.plan, kind, o);
    const hit = f.find((i) => i.start === T(time));
    if (!hit) return `starts: ${f.length ? f.map((i) => fmt(i.start)).join(", ") : "none"}`;
    if (o.fixed !== false && hit.fixed !== true) return `${brief(hit)} not marked fixed`;
    return null;
  });
export const gameAt = (time) => fixedAt("game", time);
export const mealAt = (time) => fixedAt("meal", time, { fixed: false });
export const firstStartAt = (kind, time, o = {}) =>
  c(`first ${kname(kind)} starts ${time}`, (r) => {
    const f = pick(r.plan, kind, o);
    return f.length && f[0].start === T(time) ? null : `first start ${f.length ? fmt(f[0].start) : "none"}`;
  });
export const spans = (kind, from, to) =>
  c(`${kname(kind)} spans ${from}–${to}`, (r) => {
    const f = pick(r.plan, kind);
    if (!f.length) return "missing";
    const s = f[0].start, e = Math.max(...f.map((i) => i.end));
    return s === T(from) && e === T(to) ? null : `spans ${fmt(s)}–${fmt(e)}`;
  });
export const endsBy = (time) =>
  c(`all work done by ${time}`, (r) => {
    const f = items(r.plan).filter((i) => !["game", "postgame", "free"].includes(i.kind) && i.end > T(time));
    return f.length ? `late: ${list(f)}` : null;
  });
export const notBefore = (time) =>
  c(`nothing starts before ${time}`, (r) => {
    const f = items(r.plan).filter((i) => i.kind !== "arrival" && i.start < T(time));
    return f.length ? `early: ${list(f)}` : null;
  });
export const dayStartsAt = (time) =>
  c(`day's first activity at ${time}`, (r) => {
    const f = items(r.plan).filter((i) => i.kind !== "arrival" && dur(i) > 0).sort((a, b) => a.start - b.start);
    return f.length && f[0].start === T(time) ? null : `first activity ${f.length ? brief(f[0]) : "none"}`;
  });
export const freeWindow = (min, endAt) =>
  c(`free window exactly ${min} min ending ${endAt}, nobody working`, (r) => {
    const e = T(endAt), s = e - min;
    const f = pick(r.plan, "free").find((i) => i.end === e);
    if (!f) return `no free item ending ${endAt} (free: ${list(pick(r.plan, "free"))})`;
    if (f.start !== s) return `free is ${fmt(f.start)}–${fmt(f.end)} (${dur(f)} min)`;
    const intr = items(r.plan).filter((i) => i !== f && i.kind !== "free" && dur(i) > 0 && i.start < e && i.end > s);
    return intr.length ? `window occupied by ${list(intr)}` : null;
  });
export const offBefore = (min, kind) =>
  c(`${min} min off immediately before ${kind}`, (r) => {
    const t = pick(r.plan, kind)[0];
    if (!t) return `no ${kind}`;
    const e = t.start, s = e - min;
    const f = pick(r.plan, "free").find((i) => i.end === e);
    if (!f) return `no free item ending at ${kind} (${fmt(e)}); free: ${list(pick(r.plan, "free"))}`;
    if (f.start !== s) return `free is ${dur(f)} min`;
    const intr = items(r.plan).filter((i) => i !== f && i.kind !== "free" && dur(i) > 0 && i.start < e && i.end > s);
    return intr.length ? `window occupied by ${list(intr)}` : null;
  });

// ─────────────────────────────── order / concurrency ───────────────────────────────
export const order = (a, b, o = {}) =>
  c(`${kname(a)} before ${kname(b)}`, (r) => {
    const A = pick(r.plan, a, { who: o.whoA }), B = pick(r.plan, b, { who: o.whoB });
    if (!A.length) return `no ${kname(a)}`;
    if (!B.length) return `no ${kname(b)}`;
    const end = Math.max(...A.map((i) => i.end)), st = B[0].start;
    return end <= st ? null : `${kname(a)} ends ${fmt(end)} but ${kname(b)} starts ${fmt(st)}`;
  });
export const stretchFirst = (work = WORK) =>
  c("stretch precedes throwing/defense/hitting on its track", (r) => {
    const S = pick(r.plan, ["stretch", "activation"]);
    if (!S.length) return "no stretch";
    const bad = pick(r.plan, work).filter((w) => !S.some((s) => s.end <= w.start && (s.track === "all" || s.track === w.track || w.track === "all")));
    return bad.length ? `before stretch: ${list(bad)}` : null;
  });
export const parallel = () =>
  c("pitchers work while position players work (concurrency used)", (r) => {
    const P = pick(r.plan, null, { who: "pitchers" }), Q = pick(r.plan, null, { who: "position" });
    if (!P.length) return "no pitchers-track items";
    if (!Q.length) return "no position-track items";
    return P.some((p) => Q.some((q) => p.start < q.end && q.start < p.end)) ? null : "pitcher and position work never overlap in time";
  });
export const overlapsKinds = (a, b, o = {}) =>
  c(`${kname(a)} runs during ${kname(b)}`, (r) => {
    const A = pick(r.plan, a, { who: o.whoA }), B = pick(r.plan, b, { who: o.whoB });
    if (!A.length || !B.length) return `missing (${A.length}/${B.length})`;
    return A.some((x) => B.some((y) => x !== y && x.start < y.end && y.start < x.end)) ? null : `${list(A)} vs ${list(B)}`;
  });
const maxConc = (arr) => {
  let m = 0;
  for (const x of arr) m = Math.max(m, arr.filter((y) => y.start <= x.start && x.start < y.end).length);
  return m;
};
export const concurrentAtMost = (kind, n) =>
  c(`at most ${n} ${kname(kind)} at once (resources)`, (r) => {
    const m = maxConc(pick(r.plan, kind).filter((i) => dur(i) > 0));
    return m <= n ? null : `${m} at once`;
  });
export const concurrentAtLeast = (kind, n) =>
  c(`≥ ${n} ${kname(kind)} at once`, (r) => {
    const m = maxConc(pick(r.plan, kind).filter((i) => dur(i) > 0));
    return m >= n ? null : `max ${m} at once`;
  });

// ─────────────────────────────── durations / BP ───────────────────────────────
export const durTotal = (kind, lo, hi, o = {}) =>
  c(`${kname(kind)} total ${lo === hi ? lo : `${lo}–${hi}`} min`, (r) => {
    const f = pick(r.plan, kind, o);
    if (!f.length) return "missing";
    const t = sum(f);
    return t >= lo && t <= hi ? null : `total ${t} min (${list(f)})`;
  });
export const emphasis = (a, b) =>
  c(`emphasis: ${kname(a)} minutes ≥ ${kname(b)} minutes`, (r) => {
    const x = sum(pick(r.plan, a)), y = sum(pick(r.plan, b));
    return x >= y && x > 0 ? null : `${x} vs ${y} min`;
  });
export const bpRounds = (o = {}) =>
  c(`BP rounds${o.count != null ? ` = ${o.count}` : ""}${o.min != null ? ` ≥ ${o.min}` : ""}${o.max != null ? ` ≤ ${o.max}` : ""}${o.each ? `, ${o.each} min each` : ""}${o.eachIn ? `, ${o.eachIn[0]}–${o.eachIn[1]} min each` : ""}`, (r) => {
    const f = pick(r.plan, "bp");
    const n = f.length;
    if (o.count != null && n !== o.count) return `${n} rounds: ${list(f)}`;
    if (o.min != null && n < o.min) return `${n} rounds`;
    if (o.max != null && n > o.max) return `${n} rounds`;
    if (o.each && f.some((i) => dur(i) !== o.each)) return `round lengths ${f.map(dur).join("/")}`;
    if (o.eachIn && f.some((i) => dur(i) < o.eachIn[0] || dur(i) > o.eachIn[1])) return `round lengths ${f.map(dur).join("/")}`;
    return null;
  });
export const bpNamed = (names) =>
  c(`BP groups named ${names.join(", ")} (from ctx, not invented)`, (r) => {
    const f = pick(r.plan, ["bp", "cage"]);
    const miss = names.filter((n) => !f.some((i) => new RegExp(n, "i").test(`${i.label || ""} ${i.group || ""}`)));
    return miss.length ? `missing ${miss.join(", ")}` : null;
  });

// ─────────────────────────────── conflicts / assumptions ───────────────────────────────
export const conflict = (codes, o = {}) =>
  c(`conflict ${K(codes).join("|")} with ${o.numeric === "dur" ? "a duration" : "numbers"} in the message and ≥ ${o.alts ?? 1} alternative(s)`, (r) => {
    const all = (r.plan && r.plan.conflicts) || [];
    const f = all.filter((x) => K(codes).includes(x.code));
    if (!f.length) return `conflicts: ${all.length ? all.map((x) => x.code).join(", ") : "none"}`;
    const re = o.numeric === "dur" ? durRe : new RegExp(`${durRe.source}|${timeRe.source}`, "i");
    const good = f.find((x) => re.test(x.message || "") && Array.isArray(x.alternatives) && x.alternatives.length >= (o.alts ?? 1) && x.alternatives.every((a) => a && a.label));
    return good ? null : f.map((x) => `"${x.message}" (${(x.alternatives || []).length} alts)`).join("; ");
  });
export const anyConflict = () => c("some conflict raised", (r) => (((r.plan && r.plan.conflicts) || []).length ? null : "no conflicts"));
export const assumptionSays = (re) =>
  c(`assumption mentions ${re}`, (r) => {
    const a = ((r.plan && r.plan.assumptions) || []).map((x) => (x && x.text) || String(x));
    return a.some((t) => re.test(t)) ? null : `assumptions: ${a.join(" | ") || "none"}`;
  });
export const mentions = (re) => c(`reader/assumptions mention ${re}`, (r) => (re.test(textOf(r)) ? null : `text: ${textOf(r) || "none"}`));
export const either = (name, ...checks) =>
  c(name, (r) => {
    const why = checks.map((k) => k.fn(r));
    return why.some((w) => w == null) ? null : why.join(" / ");
  });

// ─────────────────────────────── refinement (need r.prev) ───────────────────────────────
export const unchanged = (kind, o = {}) =>
  c(`unchanged: ${kname(kind)}${o.who ? ` [${o.who}]` : ""}`, (r) => {
    const a = pick(r.prev, kind, o), b = pick(r.plan, kind, o);
    if (!a.length) return o.allowEmpty ? null : `nothing to compare (before: none)`;
    const sa = a.map((i) => `${i.start}-${i.end}`).join(","), sb = b.map((i) => `${i.start}-${i.end}`).join(",");
    return sa === sb ? null : `before ${list(a)} → after ${list(b)}`;
  });
export const startSame = (kind) =>
  c(`${kname(kind)} keeps its start`, (r) => {
    const a = pick(r.prev, kind)[0], b = pick(r.plan, kind)[0];
    if (!a || !b) return `missing (${!!a}/${!!b})`;
    return a.start === b.start ? null : `${fmt(a.start)} → ${fmt(b.start)}`;
  });
export const durDelta = (kind, delta, o = {}) =>
  c(`${kname(kind)}${o.who ? ` [${o.who}]` : ""} total ${delta >= 0 ? "+" : ""}${delta} min`, (r) => {
    const a = sum(pick(r.prev, kind, o)), b = sum(pick(r.plan, kind, o));
    return b - a === delta ? null : `${a} → ${b} min`;
  });
export const durShrinks = (kind) =>
  c(`${kname(kind)} total shorter than before`, (r) => {
    const a = sum(pick(r.prev, kind)), b = sum(pick(r.plan, kind));
    return b < a && b > 0 ? null : `${a} → ${b} min`;
  });
export const spanShrinks = (kind) =>
  c(`${kname(kind)} block finishes sooner than before`, (r) => {
    const span = (p) => {
      const f = pick(p, kind);
      return f.length ? Math.max(...f.map((i) => i.end)) - f[0].start : 0;
    };
    const a = span(r.prev), b = span(r.plan);
    return b < a && b > 0 ? null : `span ${a} → ${b} min`;
  });
export const startDelta = (kind, delta) =>
  c(`${kname(kind)} start moved ${delta} min`, (r) => {
    const a = pick(r.prev, kind)[0], b = pick(r.plan, kind)[0];
    if (!a || !b) return "missing";
    return b.start - a.start === delta ? null : `${fmt(a.start)} → ${fmt(b.start)}`;
  });
export const keepsKinds = (except = []) =>
  c("no activity dropped", (r) => {
    const now = new Set(items(r.plan).map((i) => i.kind));
    const lost = [...new Set(items(r.prev).map((i) => i.kind))].filter((k) => !now.has(k) && !except.includes(k) && !STRUCT.includes(k));
    return lost.length ? `lost ${lost.join(", ")}` : null;
  });
export const indoorHitting = () =>
  c("hitting moved indoors (cage / indoor location)", (r) => {
    const f = pick(r.plan, HIT);
    if (!f.length) return "no hitting left";
    const out = f.filter((i) => i.kind !== "cage" && !/indoor|cage|tunnel|inside/i.test(`${i.location || ""} ${i.label || ""} ${i.resource || ""}`));
    return out.length ? `still outdoors: ${list(out)}` : null;
  });

// ─────────────────────────────── categories ───────────────────────────────
export const CATEGORIES = {
  primary: "1. Primary acceptance",
  pregame: "2. Pregame, fixed first pitch",
  development: "3. Development day (no game)",
  fcl: "4a. Complex level (FCL)",
  affiliate: "4b. Full-season affiliate",
  bpGroups: "5. Multiple BP groups",
  parallel: "6. Parallel hitting / pitching",
  hardStop: "7. Hard stop",
  recovery: "8. Recovery windows",
  shorthand: "9. Abbreviations",
  messy: "10. Disorganized descriptions",
  conflict: "11. Conflicting constraints",
  refine: "12. Conversational refinements",
  impossible: "13. Impossible requests",
  time: "14. Time arithmetic",
};

// ─────────────────────────────── scenarios ───────────────────────────────
// expect: "ok" (default; runner adds ok:true, no errors, no overlaps) | "conflict" (runner adds honest() only)
// steps:  refinements, each { text, expect?, checks, undo? } — undo:true also verifies undo/redo exactness.
const PRIMARY = "10 AM stretch, 1 PM game. Team fundy, indy defense. Make a schedule with 30-minute BP rounds and 30 minutes off pregame.";
const primaryFixed = () => [fixedAt("stretch", "10:00"), gameAt("13:00"), freeWindow(30, "13:00"), endsBy("12:30")];

export const SCENARIOS = [
  // ───── 1. primary ─────
  {
    id: "PRIMARY acceptance — 10 AM stretch, 1 PM game, fundy, indy, 30-min BP rounds, 30 off",
    cat: "primary",
    prompt: PRIMARY,
    checks: [
      fixedAt("stretch", "10:00"),
      has("teamDefense"),
      has("indDefense"),
      bpRounds({ min: 2, each: 30 }),
      assumptionSays(/round|group|\bBP\b/i),
      stretchFirst(),
      order("stretch", ["teamDefense", "indDefense", "bp"]),
      order(DEF, "bp"),
      notBefore("10:00"),
      endsBy("12:30"),
      freeWindow(30, "13:00"),
      gameAt("13:00"),
      noPitcherWork(),
      only(["stretch", "teamDefense", "indDefense", "bp", "game"]),
    ],
  },

  // ───── 2. pregame ─────
  {
    id: "6:05 night game — stretch 3, throw, indy, 2×25 BP, 30 off",
    cat: "pregame",
    prompt: "6:05 first pitch tonight. Stretch at 3, then throw, indy defense, BP two groups 25 min each, 30 off before the game.",
    checks: [fixedAt("stretch", "15:00"), has("throwing"), has("indDefense"), bpRounds({ count: 2, each: 25 }), order("throwing", "indDefense"), order("indDefense", "bp"), stretchFirst(), freeWindow(30, "18:05"), gameAt("18:05"), endsBy("17:35"), lacks(PITCH), only(["stretch", "throwing", "indDefense", "bp", "game"])],
  },
  {
    id: "1:05 day game — stretch 10:15, fundy, 3 BP rounds, 30 off",
    cat: "pregame",
    prompt: "1:05 day game. Stretch 10:15, team fundy, BP 3 rounds, 30 minutes off",
    checks: [fixedAt("stretch", "10:15"), has("teamDefense"), bpRounds({ count: 3, eachIn: [20, 35] }), order("teamDefense", "bp"), freeWindow(30, "13:05"), gameAt("13:05"), noPitcherWork(), only(["stretch", "teamDefense", "bp", "game"])],
  },
  {
    id: "7:05 night game — pitchers stretch 3:30 and throw, position stretch 4, BP 4:30",
    cat: "pregame",
    prompt: "Night game 7:05. Pitchers stretch at 3:30 and throw, position players stretch at 4, BP 4:30, 30 off before first pitch.",
    checks: [fixedAt("stretch", "15:30", { who: "pitchers" }), fixedAt("stretch", "16:00"), has(["throwing", "pitcherWork"], { who: "pitchers" }), fixedAt("bp", "16:30"), freeWindow(30, "19:05"), gameAt("19:05"), endsBy("18:35"), stretchFirst()],
  },
  {
    id: "game at 6 — stretch 2:45, cuts and relays, indy, 4×20 BP, 45 off (exact fit)",
    cat: "pregame",
    prompt: "game at 6 tonight, stretch at 2:45 then cuts and relays, indy, bp 4 groups 20 min each, 45 off pregame",
    checks: [fixedAt("stretch", "14:45"), has("teamDefense"), has("indDefense"), bpRounds({ count: 4, each: 20 }), order(DEF, "bp"), freeWindow(45, "18:00"), gameAt("18:00"), endsBy("17:15"), noPitcherWork()],
  },
  {
    id: "12:05 day game — report 9, stretch 9:45, BP, pregame meal 11, 30 off",
    cat: "pregame",
    prompt: "Day game 12:05. Report at 9, stretch 9:45, BP, pregame meal at 11, 30 off before first pitch.",
    checks: [fixedAt("stretch", "9:45"), mealAt("11:00"), has("bp"), order("bp", "meal"), order("stretch", "bp"), freeWindow(30, "12:05"), gameAt("12:05"), notBefore("9:00"), noPitcherWork(), only(["stretch", "bp", "meal", "game"])],
  },
  {
    id: "first pitch 7 — BP 4:15 to 5:15, stretch 3:45, 30 off",
    cat: "pregame",
    prompt: "first pitch 7. BP 4:15 to 5:15. stretch 3:45. 30 off before game",
    checks: [fixedAt("stretch", "15:45"), spans("bp", "16:15", "17:15"), freeWindow(30, "19:00"), gameAt("19:00"), noPitcherWork(), only(["stretch", "bp", "game"])],
  },
  {
    id: "first pitch from ctx (6:05) with workspace groups Blue/Orange",
    cat: "pregame",
    prompt: "Stretch at 2:30, team defense, BP with both groups, 30 off pregame",
    ctx: { hittingGroups: ["Blue", "Orange"], game: { firstPitch: 1085, opponent: null } },
    checks: [fixedAt("stretch", "14:30"), has("teamDefense"), bpRounds({ count: 2 }), bpNamed(["Blue", "Orange"]), gameAt("18:05"), freeWindow(30, "18:05"), noPitcherWork()],
  },
  {
    id: '"game at 6" means 6 PM — stretch 3, indy, 3 BP groups, 30 off',
    cat: "pregame",
    prompt: "game at 6, stretch at 3, indy, bp 3 groups, 30 off",
    checks: [gameAt("18:00"), fixedAt("stretch", "15:00"), has("indDefense"), bpRounds({ count: 3 }), freeWindow(30, "18:00"), endsBy("17:30"), noPitcherWork()],
  },

  // ───── 3. development ─────
  {
    id: "no game — start 9, defense-heavy, two hitting groups, lunch noon, finish by 2",
    cat: "development",
    prompt: "No game tomorrow. Start at 9, defense-heavy day, two hitting groups, lunch at noon, finish by 2.",
    checks: [lacks("game"), dayStartsAt("9:00"), notBefore("9:00"), mealAt("12:00"), endsBy("14:00"), has(DEF), has(["bp", "cage"], { min: 2 }), emphasis(DEF, HIT), noPitcherWork(), only([...DEF, "bp", "cage", "meal"], { warmup: true })],
  },
  {
    id: "off-day workout 10 to 12 — stretch, throw, bunt plays, rundowns, cage",
    cat: "development",
    prompt: "Off day workout. 10 to 12. stretch, throw, bunt plays, rundowns, cage work, done",
    checks: [lacks("game"), dayStartsAt("10:00"), endsBy("12:00"), stretchFirst(), has("throwing"), has("teamDefense"), has("cage"), lacks("bp"), lacks(PITCH), only(["stretch", "throwing", "teamDefense", "cage"])],
  },
  {
    id: "workout — meeting 9:30, stretch, PFP+pens, indy, BP, conditioning last, by 1",
    cat: "development",
    prompt: "Workout day — start 9:30 with a team meeting, stretch, PFP and pens for pitchers, position guys indy then BP, conditioning at the end, finish by 1",
    checks: [lacks("game"), fixedAt("meeting", "9:30", { fixed: false }), order("meeting", "stretch"), has("pfp", { who: "pitchers" }), has("bullpen", { who: "pitchers" }), has("indDefense"), has("bp"), order("indDefense", "bp"), order(["indDefense", "bp", "pfp", "bullpen"], "conditioning"), stretchFirst(), parallel(), endsBy("13:00")],
  },
  {
    id: "hitting day — 3 cage stations, on-field BP, short defense 20, 9 to 12:30",
    cat: "development",
    prompt: "No game today. Hitting day. Cage stations 3 groups, on-field BP, short defense 20 min, start 9 done 12:30",
    checks: [lacks("game"), has("cage"), has("bp"), durTotal(DEF, 20, 20), emphasis(HIT, DEF), dayStartsAt("9:00"), endsBy("12:30"), noPitcherWork()],
  },
  {
    id: "light day — stretch 10, catch play, 20 min baserunning, done by 11",
    cat: "development",
    prompt: "Day off from games, light day: stretch at 10, catch play, 20 minutes of baserunning, done by 11",
    checks: [lacks("game"), fixedAt("stretch", "10:00"), has("throwing"), durTotal("baserunning", 20, 20), stretchFirst(), endsBy("11:00"), lacks(PITCH), only(["stretch", "throwing", "baserunning"])],
  },
  {
    id: "no game — 8:30 meeting, 9 stretch, defense, live BP, lift, by 12:30",
    cat: "development",
    prompt: "Tomorrow no game. 8:30 meeting, 9 stretch, defense, live BP, lift after, finish by 12:30",
    checks: [lacks("game"), fixedAt("meeting", "8:30"), fixedAt("stretch", "9:00"), has(DEF), has("liveBp"), has("conditioning"), order(["liveBp", ...DEF], "conditioning"), stretchFirst(), endsBy("12:30"), lacks(["bullpen", "pfp"])],
  },

  // ───── 4a. FCL ─────
  {
    id: "FCL — stretch 8:30, hitting stations, pitchers throw, defense after, done by noon",
    cat: "fcl",
    prompt: "FCL day. Stretch at 8:30, hitting stations, pitchers throw, defense after, done by noon.",
    checks: [lacks("game"), fixedAt("stretch", "8:30"), has(["cage", "bp"]), has(["pitcherWork", "throwing", "bullpen"], { who: "pitchers" }), has(DEF), order(["cage", "bp"], DEF), stretchFirst(), parallel(), endsBy("12:00")],
  },
  {
    id: "FCL — 7:45 report, 8 meeting, 8:15 stretch, pens, indy, 3 BP groups, done 11:30",
    cat: "fcl",
    prompt: "FCL. 7:45 report, 8 meeting, 8:15 stretch, pens, indy, BP 3 groups, done 11:30",
    checks: [lacks("game"), fixedAt("meeting", "8:00", { fixed: false }), fixedAt("stretch", "8:15"), has("bullpen", { who: "pitchers" }), has("indDefense"), bpRounds({ count: 3 }), parallel(), stretchFirst(), endsBy("11:30"), notBefore("7:45")],
  },
  {
    id: "complex game at noon — stretch 9, early defense, BP, 30 off",
    cat: "fcl",
    prompt: "complex day, game at 12 vs the Mets FCL. Stretch 9, early defense, BP, 30 off",
    checks: [fixedAt("stretch", "9:00"), gameAt("12:00"), freeWindow(30, "12:00"), has(["earlyWork", ...DEF]), has("bp"), endsBy("11:30"), noPitcherWork()],
  },
  {
    id: "FCL morning 8–11 — stretch, throwing program for everybody, PFP, team defense, cage",
    cat: "fcl",
    prompt: "FCL morning, start 8, done by 11. Stretch, throwing program for everybody, PFP, team defense, cage",
    checks: [lacks("game"), dayStartsAt("8:00"), firstStartAt("stretch", "8:00"), has("throwing"), has("pfp", { who: "pitchers" }), has("teamDefense"), has("cage"), order("throwing", ["teamDefense", "pfp"]), stretchFirst(), endsBy("11:00")],
  },
  {
    id: "FCL heat — done by 11, stretch 8:30, 2 groups 20-min BP rounds, defense, pitchers run and throw",
    cat: "fcl",
    prompt: "Rookie ball FCL. Heat today — done by 11. Stretch 8:30, 2 hitting groups on field BP 20 min rounds, defense, pitchers run and throw",
    checks: [lacks("game"), fixedAt("stretch", "8:30"), bpRounds({ count: 2, each: 20 }), has(DEF), has(["pitcherWork", "throwing", "conditioning"], { who: "pitchers" }), parallel(), endsBy("11:00")],
  },

  // ───── 4b. full-season affiliate ─────
  {
    id: "home game 7:05 — early work 2:30, stretch 3:45, throw, BP 4:15 3 groups, PFP during BP",
    cat: "affiliate",
    prompt: "Home game 7:05. Early work 2:30 (infield), stretch 3:45, throw, BP 4:15 3 groups, pitchers PFP during BP, 30 off before first pitch",
    checks: [fixedAt("earlyWork", "14:30"), fixedAt("stretch", "15:45"), has("throwing"), fixedAt("bp", "16:15"), bpRounds({ count: 3 }), overlapsKinds("pfp", "bp"), has("pfp", { who: "pitchers" }), freeWindow(30, "19:05"), gameAt("19:05"), stretchFirst()],
  },
  {
    id: "road game 6:35 — field at 4:10 for BP, stretch 3:40, 30 off",
    cat: "affiliate",
    prompt: "Road game 6:35. We get the field at 4:10 for BP, stretch 3:40 in the outfield, 30 min off",
    checks: [fixedAt("stretch", "15:40"), fixedAt("bp", "16:10"), freeWindow(30, "18:35"), gameAt("18:35"), noPitcherWork(), only(["stretch", "bp", "game"])],
  },
  {
    id: "game at 7 — hitters meeting 2:45, early cage 3, stretch 3:45, pens 4:15, BP 4:30 4×15, 45 off",
    cat: "affiliate",
    prompt: "Game at 7. Hitters meeting 2:45, early cage at 3, stretch 3:45, BP 4:30 4 groups 15 min each, pitchers pens at 4:15, 45 off pregame",
    checks: [fixedAt("meeting", "14:45"), fixedAt(["cage", "earlyWork"], "15:00"), fixedAt("stretch", "15:45"), fixedAt("bullpen", "16:15", { who: "pitchers" }), fixedAt("bp", "16:30"), bpRounds({ count: 4, each: 15 }), freeWindow(45, "19:00"), gameAt("19:00")],
  },
  {
    id: "getaway day 12:05 — no BP, stretch 10:30, throw, indy, 30 off",
    cat: "affiliate",
    prompt: "Getaway day, game 12:05 then bus. No BP. Stretch 10:30, throw, indy, 30 off",
    checks: [lacks("bp"), fixedAt("stretch", "10:30"), has("throwing"), has("indDefense"), freeWindow(30, "12:05"), gameAt("12:05"), lacks(PITCH), only(["stretch", "throwing", "indDefense", "game", "postgame", "custom"])],
  },
  {
    id: "Sunday 1:05 — optional early work 9:30, stretch 10:45, BP 11:15 two groups, 30 off",
    cat: "affiliate",
    prompt: "Sunday day game 1:05. Optional early work 9:30, stretch 10:45, BP 11:15 two groups, 30 off",
    checks: [fixedAt("earlyWork", "9:30"), fixedAt("stretch", "10:45"), fixedAt("bp", "11:15"), bpRounds({ count: 2 }), freeWindow(30, "13:05"), gameAt("13:05"), noPitcherWork()],
  },
  {
    id: "7:05 — stretch 4, defense 4:15–4:45, BP 4:45–5:45, meal 5:45, 30 off",
    cat: "affiliate",
    prompt: "7:05 game. Stretch 4, defense 4:15-4:45, BP 4:45-5:45, pregame meal 5:45, 30 off",
    checks: [fixedAt("stretch", "16:00"), spans(DEF, "16:15", "16:45"), spans("bp", "16:45", "17:45"), mealAt("17:45"), freeWindow(30, "19:05"), gameAt("19:05"), noPitcherWork()],
  },

  // ───── 5. BP groups ─────
  {
    id: "2 groups × 30, stretch 3, game 6:30, 30 off",
    cat: "bpGroups",
    prompt: "Stretch at 3, BP 2 groups 30 min rounds, game 6:30 with 30 off",
    checks: [fixedAt("stretch", "15:00"), bpRounds({ count: 2, each: 30 }), order("stretch", "bp"), freeWindow(30, "18:30"), gameAt("18:30"), noPitcherWork()],
  },
  {
    id: "3 groups × 25, stretch 2:30, game at 6, 45 off",
    cat: "bpGroups",
    prompt: "stretch 2:30 then BP - 3 groups, 25 minute rounds. game at 6, 45 off",
    checks: [fixedAt("stretch", "14:30"), bpRounds({ count: 3, each: 25 }), concurrentAtMost("bp", 1), freeWindow(45, "18:00"), gameAt("18:00"), noPitcherWork()],
  },
  {
    id: "4 groups × 15, stretch 3:30, 6:05 first pitch",
    cat: "bpGroups",
    prompt: "4 hitting groups for BP, 15 min each, stretch at 3:30, first pitch 6:05, 30 off",
    checks: [fixedAt("stretch", "15:30"), bpRounds({ count: 4, each: 15 }), freeWindow(30, "18:05"), gameAt("18:05"), noPitcherWork()],
  },
  {
    id: "rounds count from workspace groups (3) when not stated",
    cat: "bpGroups",
    prompt: "stretch at 3, indy, BP rounds, game at 7, 30 off",
    ctx: { hittingGroups: ["Blue", "Orange", "Gray"] },
    checks: [bpRounds({ count: 3 }), bpNamed(["Blue", "Orange", "Gray"]), order("indDefense", "bp"), freeWindow(30, "19:00"), gameAt("19:00")],
  },
  {
    id: "no counts, no groups in ctx → 2 rounds, assumption stated",
    cat: "bpGroups",
    prompt: "stretch 3 then bp then 30 off, game at 6:05",
    checks: [bpRounds({ count: 2, eachIn: [20, 45] }), assumptionSays(/round|group/i), fixedAt("stretch", "15:00"), freeWindow(30, "18:05"), gameAt("18:05"), only(["stretch", "bp", "game"])],
  },
  {
    id: "field + cage rotation, 20-min rounds, 1 field 2 cages",
    cat: "bpGroups",
    prompt: "Blue and Orange hit on the field while Gray and Red are in the cage, then swap. 20 minute rounds. Stretch at 3, game 6:30, 30 off.",
    ctx: { hittingGroups: ["Blue", "Orange", "Gray", "Red"], resources: { fields: 1, cages: 2, mounds: 1 } },
    checks: [has("bp"), has("cage"), overlapsKinds("bp", "cage"), concurrentAtMost("bp", 1), concurrentAtMost("cage", 2), bpNamed(["Blue", "Orange", "Gray", "Red"]), fixedAt("stretch", "15:00"), freeWindow(30, "18:30"), gameAt("18:30")],
  },
  {
    id: "named groups Blue/Orange × 25",
    cat: "bpGroups",
    prompt: "Stretch 3. BP Blue and Orange groups 25 min each, game at 6:35, 30 off",
    ctx: { hittingGroups: ["Blue", "Orange"] },
    checks: [bpRounds({ count: 2, each: 25 }), bpNamed(["Blue", "Orange"]), fixedAt("stretch", "15:00"), freeWindow(30, "18:35"), gameAt("18:35")],
  },

  // ───── 6. parallel ─────
  {
    id: "pitchers throwing program + PFP while position players do indy and cage",
    cat: "parallel",
    prompt: "Stretch at 9, pitchers throwing program and PFP while position guys do indy and cage, then BP, done by 12",
    checks: [fixedAt("stretch", "9:00"), has(["pitcherWork", "throwing"], { who: "pitchers" }), has("pfp", { who: "pitchers" }), has("indDefense"), has("cage"), has("bp"), parallel(), order(["indDefense", "cage"], "bp"), stretchFirst(), endsBy("12:00")],
  },
  {
    id: "pens during BP",
    cat: "parallel",
    prompt: "Stretch 3. Pens during BP. Game 7, 30 off.",
    checks: [has("bullpen", { who: "pitchers" }), overlapsKinds("bullpen", "bp"), stretchFirst(), freeWindow(30, "19:00"), gameAt("19:00"), concurrentAtMost("bullpen", 1)],
  },
  {
    id: "pitchers long toss + PFP at 3:30 while hitters cage at 3:30",
    cat: "parallel",
    prompt: "Pitchers long toss and PFP at 3:30, hitters in the cage at 3:30, stretch 3 together, BP 4:15, game 7:05 30 off",
    checks: [fixedAt("stretch", "15:00"), fixedAt(["throwing", "pitcherWork", "pfp"], "15:30", { who: "pitchers" }), fixedAt("cage", "15:30"), has("pfp", { who: "pitchers" }), fixedAt("bp", "16:15"), parallel(), freeWindow(30, "19:05"), gameAt("19:05")],
  },
  {
    id: "two tracks dictated: pitchers arm care → pens; position fundy → indy → BP; done by 1",
    cat: "parallel",
    prompt: "Stretch 10. Pitchers: arm care then bullpens. Position: team fundy then indy then BP. Done by 1.",
    checks: [lacks("game"), fixedAt("stretch", "10:00"), has("pitcherWork", { who: "pitchers" }), has("bullpen", { who: "pitchers" }), order("pitcherWork", "bullpen"), order("teamDefense", "indDefense"), order("indDefense", "bp"), parallel(), stretchFirst(), endsBy("13:00")],
  },
  {
    id: "everyone throws, then pens while catchers block and infielders do indy, BP after",
    cat: "parallel",
    prompt: "stretch at 9:30, everybody throws, then pitchers go to the pen while catchers do blocking and infielders do indy, BP after",
    checks: [lacks("game"), fixedAt("stretch", "9:30"), has("throwing"), has("bullpen", { who: "pitchers" }), has("indDefense"), has("bp"), order("throwing", ["bullpen", "indDefense"]), order("indDefense", "bp"), parallel(), stretchFirst()],
  },

  // ───── 7. hard stop ─────
  {
    id: "done by 11:30 no matter what — stretch 9, team D, indy, 2 BP groups",
    cat: "hardStop",
    prompt: "Done by 11:30 no matter what. Stretch at 9, team defense, indy, BP 2 groups",
    checks: [lacks("game"), fixedAt("stretch", "9:00"), has("teamDefense"), has("indDefense"), bpRounds({ count: 2 }), endsBy("11:30"), noPitcherWork()],
  },
  {
    id: "hard stop noon (camp) — start 9:30, stretch, throw, fundy, 3 BP groups",
    cat: "hardStop",
    prompt: "Hard stop at noon — field needed for a camp. Start 9:30, stretch, throw, team fundy, BP 3 groups",
    checks: [lacks("game"), dayStartsAt("9:30"), firstStartAt("stretch", "9:30"), has("throwing"), has("teamDefense"), bpRounds({ count: 3 }), endsBy("12:00"), noPitcherWork()],
  },
  {
    id: "off the field by 2:15 — stretch 12:30, indy, baserunning, BP (needs compression)",
    cat: "hardStop",
    prompt: "Need to be off the field by 2:15. Stretch 12:30, indy, baserunning, BP",
    checks: [fixedAt("stretch", "12:30"), has("indDefense"), has("baserunning"), has("bp"), endsBy("14:15"), stretchFirst(), lacks("game"), noPitcherWork()],
  },
  {
    id: "pitcher-only day wrapped by 10:45 — stretch 9, PFP, pens",
    cat: "hardStop",
    prompt: "Everything wrapped by 10:45. 9 o'clock stretch, PFP, pens, pitcher-only day",
    checks: [fixedAt("stretch", "9:00"), has("pfp"), has("bullpen"), endsBy("10:45"), lacks(["bp", "cage", ...DEF, "baserunning"]), lacks("game")],
  },
  {
    id: "start at 1, finish by 3 — stretch, defense, BP",
    cat: "hardStop",
    prompt: "Finish by 3, start at 1. Stretch, defense, BP",
    checks: [dayStartsAt("13:00"), notBefore("13:00"), endsBy("15:00"), has(DEF), has("bp"), stretchFirst(), lacks("game"), noPitcherWork()],
  },

  // ───── 8. recovery windows ─────
  {
    id: "§1 prompt — early work 2:30, BP 3:30, 45 off before stretch, game at 6",
    cat: "recovery",
    prompt: "Game at 6. Early work at 2:30, BP at 3:30, 45 minutes off before stretch.",
    checks: [fixedAt("earlyWork", "14:30"), fixedAt("bp", "15:30"), has("stretch"), offBefore(45, "stretch"), gameAt("18:00"), endsBy("18:00"), noPitcherWork()],
  },
  {
    id: "45 off before first pitch 7:05",
    cat: "recovery",
    prompt: "game 7:05, stretch 4:00, defense and BP, 45 off before first pitch",
    checks: [fixedAt("stretch", "16:00"), has(DEF), has("bp"), freeWindow(45, "19:05"), endsBy("18:20"), gameAt("19:05"), order(DEF, "bp")],
  },
  {
    id: "day game 12:35, 30 off, stretch 9:30, BP, indy",
    cat: "recovery",
    prompt: "Day game 12:35. 30 off. Stretch 9:30, BP, indy",
    checks: [fixedAt("stretch", "9:30"), has("bp"), has("indDefense"), freeWindow(30, "12:35"), gameAt("12:35"), endsBy("12:05")],
  },
  {
    id: "1 hr off before the 6:30 game",
    cat: "recovery",
    prompt: "stretch 3:15 bp after, 1 hr off before the game at 6:30",
    checks: [fixedAt("stretch", "15:15"), has("bp"), order("stretch", "bp"), freeWindow(60, "18:30"), gameAt("18:30"), endsBy("17:30")],
  },
  {
    id: "early work, then 30 off before stretch at 3:30, BP after",
    cat: "recovery",
    prompt: "Early work before stretch, then 30 minutes off, stretch at 3:30, BP after, game at 7",
    checks: [has("earlyWork"), fixedAt("stretch", "15:30"), offBefore(30, "stretch"), order("earlyWork", "stretch"), order("stretch", "bp"), gameAt("19:00")],
  },
  {
    id: "40 minutes off before a 1:10 first pitch",
    cat: "recovery",
    prompt: "Day game at 1:10. Stretch 10:10, indy, BP 2 groups. Give them 40 minutes off before first pitch.",
    checks: [fixedAt("stretch", "10:10"), has("indDefense"), bpRounds({ count: 2 }), freeWindow(40, "13:10"), gameAt("13:10"), endsBy("12:30")],
  },

  // ───── 9. shorthand ─────
  {
    id: "fundy, indy, PFP, pens, BP x2, done 1",
    cat: "shorthand",
    prompt: "stretch 10, fundy, indy, PFP, pens, BP x2, done 1",
    checks: [fixedAt("stretch", "10:00"), has("teamDefense"), has("indDefense"), has("pfp", { who: "pitchers" }), has("bullpen", { who: "pitchers" }), bpRounds({ count: 2 }), parallel(), stretchFirst(), endsBy("13:00"), lacks("game")],
  },
  {
    id: "LT (long toss?) 3:45 pitchers, bp 3 grps 20s",
    cat: "shorthand",
    prompt: "stretch 3:30, LT pitchers 3:45, bp 3 grps 20s, game 7, 30 off",
    checks: [
      fixedAt("stretch", "15:30"),
      either("LT read as pitchers' throwing at 3:45, or flagged as not understood", fixedAt(["throwing", "pitcherWork"], "15:45", { who: "pitchers" }), mentions(/\bLT\b/i)),
      bpRounds({ count: 3, each: 20 }),
      freeWindow(30, "19:00"),
      gameAt("19:00"),
    ],
  },
  {
    id: "CR (ambiguous) and bunt D after stretch at 3, gm 6:05",
    cat: "shorthand",
    prompt: "cr and bunt d after stretch at 3, bp, gm 6:05 30 off",
    checks: [fixedAt("stretch", "15:00"), has("teamDefense"), either("CR read as cuts & relays, or flagged as unknown", hasLabel(/cut|relay/i), mentions(/\bcr\b/i)), has("bp"), order("teamDefense", "bp"), gameAt("18:05"), freeWindow(30, "18:05")],
  },
  {
    id: "slash list — stretch 9 / indy / cage / pfp + pens / lift / done by 12",
    cat: "shorthand",
    prompt: "stretch 9 / indy / cage / pfp + pens / lift / done by 12",
    checks: [fixedAt("stretch", "9:00"), has("indDefense"), has("cage"), has("pfp"), has("bullpen"), has("conditioning"), order(["indDefense", "cage"], "conditioning"), parallel(), endsBy("12:00"), lacks("game")],
  },
  {
    id: "early hitting 1:30, stretch & throw 3, PFP, bp 4 groups, gm 6:35",
    cat: "shorthand",
    prompt: "early hitting 1:30, stretch & throw 3, PFP, bp 4 groups, gm 6:35, 30 off",
    checks: [fixedAt("earlyWork", "13:30"), fixedAt("stretch", "15:00"), has("pfp", { who: "pitchers" }), bpRounds({ count: 4 }), gameAt("18:35"), freeWindow(30, "18:35")],
  },
  {
    id: "live ABs at 10, stretch 9:30, no game",
    cat: "shorthand",
    prompt: "Live ABs at 10 for the hitters, 3 pitchers throwing 2 ups each, stretch 9:30",
    checks: [fixedAt("liveBp", "10:00"), fixedAt("stretch", "9:30"), order("stretch", "liveBp"), lacks("game"), lacks("bp")],
  },
  {
    id: "OF work + IF work, speed work, done 11:30",
    cat: "shorthand",
    prompt: "Stretch 9. Defense: outfield work + infield work. BP. Speed work. Done 11:30.",
    checks: [fixedAt("stretch", "9:00"), has("indDefense"), has("bp"), has("baserunning"), stretchFirst(), endsBy("11:30"), lacks("game"), noPitcherWork()],
  },

  // ───── 10. messy ─────
  {
    id: "run-on dictation with ums — game 7, stretch 3:30, defense before BP, 30 off",
    cat: "messy",
    prompt: "ok so tomorrow um we've got the game at 7 and I want BP but first stretch at 3:30 and before BP defense and uh give them 30 minutes off before the game",
    checks: [fixedAt("stretch", "15:30"), has(DEF), has("bp"), order(DEF, "bp"), freeWindow(30, "19:00"), gameAt("19:00"), noPitcherWork()],
  },
  {
    id: "self-correction — BP 4:15, actually stretch 3:45, indy before BP",
    cat: "messy",
    prompt: "BP 4:15. Actually stretch is at 3:45. Game 7:05. 30 off. indy before BP",
    checks: [fixedAt("stretch", "15:45"), fixedAt("bp", "16:15"), has("indDefense"), order("indDefense", "bp"), order("stretch", "indDefense"), freeWindow(30, "19:05"), gameAt("19:05")],
  },
  {
    id: "out of order slashes — pens / BP 3 groups / stretch first 2:30 / game 6 / 45 off / fundy somewhere",
    cat: "messy",
    prompt: "pitchers pens / position BP 3 groups / stretch first at 2:30 / game 6 / and we need 45 off / and team fundy somewhere",
    checks: [fixedAt("stretch", "14:30"), has("bullpen", { who: "pitchers" }), bpRounds({ count: 3 }), has("teamDefense"), stretchFirst(), freeWindow(45, "18:00"), gameAt("18:00")],
  },
  {
    id: "no punctuation — game 6:05 stretch 3 defense bp off 30",
    cat: "messy",
    prompt: "need a schedule for tmrw game 6:05 stretch 3 defense bp off 30",
    checks: [fixedAt("stretch", "15:00"), has(DEF), has("bp"), freeWindow(30, "18:05"), gameAt("18:05"), noPitcherWork()],
  },
  {
    id: "lunch mentioned first — cage after lunch, defense in the morning, wrap 2:30",
    cat: "messy",
    prompt: "Lunch at 12. We start at 9 with stretch. Cage after lunch. Defense in the morning, team then indy. Wrap by 2:30. No game.",
    checks: [lacks("game"), fixedAt("stretch", "9:00"), mealAt("12:00"), has("cage"), order("meal", "cage"), order("teamDefense", "indDefense"), order(DEF, "meal"), endsBy("14:30"), noPitcherWork()],
  },
  {
    id: "afterthoughts — game at 1, stretch 10, 30 off, oh and BP 2 groups, indy before BP",
    cat: "messy",
    prompt: "Game's at 1. Stretch at 10. 30 off before the game. Oh and BP 2 groups. And indy before BP.",
    checks: [gameAt("13:00"), fixedAt("stretch", "10:00"), freeWindow(30, "13:00"), bpRounds({ count: 2 }), order("indDefense", "bp"), endsBy("12:30"), noPitcherWork()],
  },

  // ───── 11. conflicts ─────
  {
    id: "stretch and team meeting both at 10",
    cat: "conflict",
    expect: "conflict",
    prompt: "Stretch at 10 and team meeting at 10, then BP, done by noon",
    checks: [conflict(["fixedOverlap"]), has("stretch"), has("meeting")],
  },
  {
    id: "BP at 12:30 after a noon hard stop",
    cat: "conflict",
    expect: "conflict",
    prompt: "Done by noon. Stretch at 9, BP at 12:30",
    checks: [conflict(["afterEnd"]), okIs(false)],
  },
  {
    id: "4 × 30 BP rounds don't fit before a 4:45 stop (stated lengths kept)",
    cat: "conflict",
    expect: "conflict",
    prompt: "Stretch at 3, BP 4 groups 30 min rounds, done by 4:45, game 7",
    checks: [conflict(["overfull", "afterEnd"], { numeric: "dur" }), okIs(false), either("stated 30-min rounds not silently shortened", bpRounds({ eachIn: [30, 30] }), lacks("bp"))],
  },
  {
    id: "stretch at 12:45 inside the 30-off window before a 1:00 game",
    cat: "conflict",
    expect: "conflict",
    prompt: "Game at 1, 30 off, stretch at 12:45",
    checks: [conflict(["fixedOverlap", "afterEnd", "overfull"]), gameAt("13:00")],
  },
  {
    id: "PFP at 10 and team defense at 10 (pitchers needed in both)",
    cat: "conflict",
    expect: "conflict",
    prompt: "Stretch at 9:30, pitchers PFP at 10, team defense at 10, done by 11:30",
    checks: [either("conflict raised, or team defense explicitly run as position-only beside PFP", conflict(["fixedOverlap", "resource"]), overlapsKinds("pfp", "teamDefense", { whoA: "pitchers", whoB: "position" }))],
  },
  {
    id: "3 BP groups at once with one field and one cage",
    cat: "conflict",
    expect: "conflict",
    prompt: "Stretch at 3. All 3 BP groups hit at the same time at 3:30. Game at 7, 30 off.",
    ctx: { hittingGroups: ["Blue", "Orange", "Gray"], resources: { fields: 1, cages: 1, mounds: 1 } },
    checks: [conflict(["resource", "fixedOverlap"]), concurrentAtMost("bp", 1)],
  },
  {
    id: "BP 4–5:30 runs into the 45-off window before a 6:00 game",
    cat: "conflict",
    expect: "conflict",
    prompt: "Stretch 3, BP from 4 to 5:30, game at 6 with 45 off",
    checks: [conflict(["fixedOverlap", "afterEnd", "overfull"]), gameAt("18:00")],
  },

  // ───── 13. impossible ─────
  {
    id: "start at 2, done by 1",
    cat: "impossible",
    expect: "conflict",
    prompt: "Start at 2, done by 1.",
    checks: [conflict(["impossible"]), okIs(false)],
  },
  {
    id: "~5 hours of work in 90 minutes",
    cat: "impossible",
    expect: "conflict",
    prompt: "Stretch 10, team fundy 45, indy 45, BP 4 groups 30 min, pens, PFP, conditioning 45, all done by 11:30",
    checks: [conflict(["overfull"], { numeric: "dur" }), okIs(false)],
  },
  {
    id: "stretch at 1:30 after a 1:00 first pitch",
    cat: "impossible",
    expect: "conflict",
    prompt: "Game at 1. Stretch at 1:30.",
    checks: [conflict(["afterEnd", "fixedOverlap", "impossible"]), okIs(false), gameAt("13:00")],
  },
  {
    id: "start at 9 and finish by 9",
    cat: "impossible",
    expect: "conflict",
    prompt: "finish by 9am, start at 9. stretch, defense, BP",
    checks: [conflict(["impossible", "overfull"]), okIs(false)],
  },
  {
    id: "zero window — stretch 11:15 before a noon game with 30 off, plus defense and 3 BP rounds",
    cat: "impossible",
    expect: "conflict",
    prompt: "Game at 12. 30 off. Stretch at 11:15, team defense, indy, 3 rounds of BP",
    checks: [conflict(["overfull", "impossible"], { numeric: "dur" }), okIs(false), gameAt("12:00")],
  },
  {
    id: "2 h defense + 2 h BP between 9 and 11",
    cat: "impossible",
    expect: "conflict",
    prompt: "2 hour defensive session and 2 hours of BP between 9 and 11",
    checks: [conflict(["overfull"], { numeric: "dur" }), okIs(false)],
  },

  // ───── 14. time arithmetic ─────
  {
    id: "noon is 12:00 (not midnight) — stretch 12, BP 12:30, done 1:30",
    cat: "time",
    prompt: "Stretch at 12, BP at 12:30, done by 1:30",
    checks: [fixedAt("stretch", "12:00"), fixedAt("bp", "12:30"), endsBy("13:30"), lacks("game")],
  },
  {
    id: "12 PM / 3 PM with explicit meridiem",
    cat: "time",
    prompt: "stretch 12 PM, game 3 PM, 30 off, indy, BP",
    checks: [fixedAt("stretch", "12:00"), gameAt("15:00"), freeWindow(30, "15:00"), has("indDefense"), has("bp")],
  },
  {
    id: '"330" is 3:30',
    cat: "time",
    prompt: "stretch at noon. BP. game at 330. 30 off",
    checks: [fixedAt("stretch", "12:00"), gameAt("15:30"), freeWindow(30, "15:30"), has("bp")],
  },
  {
    id: "9:05 start isn't rounded away",
    cat: "time",
    prompt: "stretch 9:05, team fundy, BP, done 11",
    checks: [fixedAt("stretch", "9:05"), has("teamDefense"), has("bp"), endsBy("11:00"), lacks("game")],
  },
  {
    id: "25 off before a 5:35 first pitch",
    cat: "time",
    prompt: "Stretch 2:50, indy, BP, game 5:35 with 25 off",
    checks: [fixedAt("stretch", "14:50"), gameAt("17:35"), freeWindow(25, "17:35"), endsBy("17:10")],
  },
  {
    id: "odd 10-minute times — game 7:10, stretch 4:10, BP 4:40",
    cat: "time",
    prompt: "game 7:10 stretch 4:10 bp 4:40 30 off",
    checks: [fixedAt("stretch", "16:10"), fixedAt("bp", "16:40"), freeWindow(30, "19:10"), gameAt("19:10")],
  },
  {
    id: "am/pm suffixes — 9:45am stretch, 12:15pm first pitch",
    cat: "time",
    prompt: "Stretch at 9:45am, first pitch 12:15pm, 30 minutes off, BP, indy",
    checks: [fixedAt("stretch", "9:45"), gameAt("12:15"), freeWindow(30, "12:15"), has("bp"), has("indDefense")],
  },
  {
    id: "bp at 1 after a 12:30 stretch is 1 PM",
    cat: "time",
    prompt: "stretch at 12:30 bp at 1 game 4:05 30 off",
    checks: [fixedAt("stretch", "12:30"), fixedAt("bp", "13:00"), gameAt("16:05"), freeWindow(30, "16:05")],
  },
  {
    id: "across noon — stretch 11:50, BP 12:10, game 2",
    cat: "time",
    prompt: "Stretch 11:50, BP 12:10, game 2",
    checks: [fixedAt("stretch", "11:50"), fixedAt("bp", "12:10"), gameAt("14:00"), order("stretch", "bp")],
  },
  {
    id: "ranges — defense 8:35-9:20, BP 9:20, done 10:20",
    cat: "time",
    prompt: "Meeting 8, stretch 8:20, defense 8:35-9:20, BP 9:20, done 10:20",
    checks: [fixedAt("meeting", "8:00"), fixedAt("stretch", "8:20"), spans(DEF, "8:35", "9:20"), fixedAt("bp", "9:20"), endsBy("10:20"), lacks("game")],
  },
  {
    id: "one-digit hours — stretch 9 bp 10 done 11",
    cat: "time",
    prompt: "stretch 9 bp 10 done 11",
    checks: [fixedAt("stretch", "9:00"), fixedAt("bp", "10:00"), endsBy("11:00"), lacks("game"), noPitcherWork()],
  },

  // ───── 12. refinements ─────
  {
    id: 'refine: "Move defense before hitting."',
    cat: "refine",
    prompt: "Stretch at 9, BP 2 groups, then indy defense, done by 11:30. No game.",
    checks: [order("bp", "indDefense")],
    steps: [{ text: "Move defense before hitting.", undo: true, checks: [order("indDefense", "bp"), unchanged("stretch"), bpRounds({ count: 2 }), endsBy("11:30"), keepsKinds()] }],
  },
  {
    id: 'refine: "Give pitchers another 15 minutes."',
    cat: "refine",
    prompt: "Stretch at 10, pitchers throwing program and PFP, position team fundy, indy, BP 2 groups, game at 1 with 30 off",
    checks: [parallel()],
    steps: [{ text: "Give pitchers another 15 minutes.", undo: true, checks: [durDelta(null, 15, { who: "pitchers" }), unchanged(null, { who: "position", allowEmpty: true }), unchanged(null, { who: "all" }), keepsKinds()] }],
  },
  {
    id: 'refine: "Shorten team fundy to 20." (primary day)',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Shorten team fundy to 20.", undo: true, checks: [durTotal("teamDefense", 20, 20), startSame("teamDefense"), ...primaryFixed(), unchanged("stretch"), unchanged("game"), keepsKinds()] }],
  },
  {
    id: 'refine: "Add a second BP group."',
    cat: "refine",
    prompt: "Stretch at 3, indy, BP one group 30 min, game at 7, 30 off",
    checks: [bpRounds({ count: 1, each: 30 })],
    steps: [{ text: "Add a second BP group.", checks: [bpRounds({ count: 2, each: 30 }), unchanged("stretch"), startSame("indDefense"), unchanged("game"), freeWindow(30, "19:00")] }],
  },
  {
    id: 'refine: "Make everything finish by 12:15."',
    cat: "refine",
    prompt: "Stretch at 9:30, team fundy, indy defense, BP 2 groups 30 min, conditioning, done by 1.",
    steps: [{ text: "Make everything finish by 12:15.", checks: [endsBy("12:15"), unchanged("stretch"), keepsKinds(), bpRounds({ count: 2, each: 30 })] }],
  },
  {
    id: 'refine: "Run the cage groups simultaneously." (3 cages)',
    cat: "refine",
    prompt: "Stretch at 9, cage work 3 groups 20 min each, indy, done by 11:30",
    ctx: { hittingGroups: ["Blue", "Orange", "Gray"], resources: { fields: 1, cages: 3, mounds: 1 } },
    checks: [has("cage")],
    steps: [{ text: "Run the cage groups simultaneously.", checks: [concurrentAtLeast("cage", 2), concurrentAtMost("cage", 3), spanShrinks("cage"), unchanged("stretch"), endsBy("11:30"), keepsKinds()] }],
  },
  {
    id: 'refine: "Keep game time fixed and reorganize the rest."',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Keep game time fixed and reorganize the rest.", checks: [unchanged("game"), freeWindow(30, "13:00"), keepsKinds(), endsBy("12:30"), stretchFirst()] }],
  },
  {
    id: '"Same as yesterday but move BP 20 minutes earlier and add baserunning."',
    cat: "refine",
    prompt: "Same as yesterday but move BP 20 minutes earlier and add baserunning.",
    ctx: (E) => ({ yesterday: E.plan("Stretch at 3, indy, BP at 4:30 2 groups, game at 7, 30 off", {}).request }),
    checks: [fixedAt("stretch", "15:00"), has("indDefense"), firstStartAt("bp", "16:10"), bpRounds({ count: 2 }), has("baserunning"), gameAt("19:00"), freeWindow(30, "19:00"), assumptionsMax(6)],
  },
  {
    id: 'refine: "Rain expected. Move hitting indoors, keep pitchers on throwing schedules, shorten defensive work."',
    cat: "refine",
    prompt: "Stretch at 3, pitchers throwing program and pens, team defense 30, indy 30, BP 3 groups, game 7, 30 off",
    checks: [parallel()],
    steps: [{ text: "Rain expected. Move hitting indoors, keep pitchers on throwing schedules, shorten defensive work.", checks: [indoorHitting(), unchanged(null, { who: "pitchers" }), durShrinks(DEF), unchanged("game"), unchanged("stretch"), freeWindow(30, "19:00")] }],
  },
  {
    id: 'refine: "Move BP 20 minutes earlier."',
    cat: "refine",
    prompt: "Stretch at 3, indy, BP at 4:30 2 groups, game at 7, 30 off",
    checks: [fixedAt("bp", "16:30")],
    steps: [{ text: "Move BP 20 minutes earlier.", undo: true, checks: [startDelta("bp", -20), bpRounds({ count: 2 }), unchanged("stretch"), unchanged("game"), freeWindow(30, "19:00")] }],
  },
  {
    id: 'refine: "Push stretch to 10:30." (primary day)',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Push stretch to 10:30.", checks: [fixedAt("stretch", "10:30"), unchanged("game"), freeWindow(30, "13:00"), endsBy("12:30"), stretchFirst(), keepsKinds()] }],
  },
  {
    id: 'refine: "Add PFP for the pitchers during indy." — position items keep their times',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Add PFP for the pitchers during indy.", checks: [has("pfp", { who: "pitchers" }), overlapsKinds("pfp", "indDefense"), unchanged(["stretch", "teamDefense", "indDefense", "bp", "game", "free"])] }],
  },
  {
    id: "refine chain: shorten fundy to 20, then 3 BP rounds; undo returns to step 1",
    cat: "refine",
    prompt: PRIMARY,
    steps: [
      { text: "Shorten team fundy to 20.", checks: [durTotal("teamDefense", 20, 20), unchanged("stretch")] },
      { text: "Make it 3 rounds of BP.", undo: true, checks: [bpRounds({ count: 3, each: 30 }), durTotal("teamDefense", 20, 20), ...primaryFixed(), unchanged("stretch")] },
    ],
  },
  {
    id: 'refine: "Game moved to 7:05 — keep everything else." (stretch stays put)',
    cat: "refine",
    prompt: "Stretch at 3, indy, BP 2 groups, game at 6:05, 30 off",
    steps: [{ text: "Game moved to 7:05, keep everything else.", checks: [gameAt("19:05"), freeWindow(30, "19:05"), unchanged("stretch"), startSame("indDefense"), bpRounds({ count: 2 }), keepsKinds()] }],
  },
  {
    id: 'refine: "Drop BP today."',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Drop BP today.", undo: true, checks: [lacks("bp"), unchanged("stretch"), unchanged("game"), startSame("teamDefense"), freeWindow(30, "13:00"), keepsKinds(["bp"])] }],
  },
  {
    id: 'refine into a conflict: "Make everything finish by 11." on the primary day',
    cat: "refine",
    prompt: PRIMARY,
    steps: [{ text: "Make everything finish by 11.", expect: "conflict", checks: [conflict(["overfull", "afterEnd"], { numeric: "dur" }), okIs(false), unchanged("stretch"), unchanged("game")] }],
  },
];
