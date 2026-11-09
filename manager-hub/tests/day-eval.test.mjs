// Manager Hub — Describe Your Day: independent evaluation suite (DAY-ENGINE.md §8).
//   node --test manager-hub/tests/day-eval.test.mjs
// Judges the engine through its documented facade only: DayEngine.plan / refine / undo / redo.
// Every scenario is its own test; a failure prints every failed rubric line plus the generated
// timetable so a person can judge the day. The last test prints a pass/fail table per category.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCENARIOS, CATEGORIES, items, fmt, contractShape, on5, sane, honest, assumptionsMax, noOverlap, okIs, noErrors } from "./day-eval-scenarios.mjs";

// ─────────────── load the facade ───────────────
// Preferred: CommonJS require of the UMD facade. The sandbox root package.json is "type": "module",
// so require() of a .js file there may be treated as ESM; in that case fall back to loading the four
// UMD files as classic scripts on `self`, the way the page (and tests/load.mjs) does.
const require = createRequire(import.meta.url);
const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../apps/manager-hub/assistant");
let E = null, loadError = null;
try {
  const m = require("../../apps/manager-hub/assistant/day-engine.js");
  if (m && typeof m.plan === "function") E = m;
  else throw new Error("require() did not return the DayEngine facade");
} catch (err1) {
  try {
    const ctx = { self: {}, console };
    vm.createContext(ctx);
    for (const f of ["day-kb.js", "day-read.js", "day-solve.js", "day-engine.js"]) vm.runInContext(readFileSync(join(DIR, f), "utf8"), ctx, { filename: f });
    if (!ctx.self.DayEngine || typeof ctx.self.DayEngine.plan !== "function") throw new Error("self.DayEngine.plan missing after loading scripts");
    E = ctx.self.DayEngine;
  } catch (err2) {
    loadError = new Error(`DayEngine facade could not be loaded.\n  require: ${err1 && err1.message}\n  script:  ${err2 && err2.message}`);
  }
}

// values built inside a VM realm have their own prototypes: compare by value
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ─────────────── reporting ───────────────
const trackOrder = { all: 0, position: 1, catchers: 2, pitchers: 3 };
function timetable(plan) {
  const it = items(plan).slice().sort((a, b) => a.start - b.start || (trackOrder[a.track] ?? 9) - (trackOrder[b.track] ?? 9) || a.end - b.end);
  if (!it.length) return "    (no items)";
  return it
    .map((i) => `    ${fmt(i.start)}–${fmt(i.end)} [${i.track}${i.group ? "/" + i.group : ""}] ${i.label || "(no label)"}${i.fixed ? " (fixed)" : ""}  ·${i.kind}${i.round ? " r" + i.round : ""}${i.location ? " @" + i.location : ""}`)
    .join("\n");
}
function describe(state, title) {
  const p = (state && state.plan) || {};
  const r = (state && state.request) || {};
  const lines = [`  ${title}${state && state.interpreter ? `  (interpreter: ${state.interpreter})` : ""}`, timetable(p)];
  if (p.window) lines.push(`    window: ${fmt(p.window.start)}–${fmt(p.window.end)}  available ${p.window.available} / required ${p.window.required}`);
  lines.push(`    ok: ${p.ok}`);
  (p.assumptions || []).forEach((a) => lines.push(`    assumed: ${(a && a.text) || a}`));
  (p.conflicts || []).forEach((c) => lines.push(`    conflict ${c.code} (${c.severity}): ${c.message}${(c.alternatives || []).length ? `  → ${(c.alternatives || []).map((x) => x.label).join(" | ")}` : ""}`));
  if (r.anchors) lines.push(`    anchors: ${JSON.stringify(r.anchors)}`);
  if ((r.unknown || []).length) lines.push(`    unknown: ${r.unknown.join(" | ")}`);
  return lines.join("\n");
}

// Checks the runner adds to every plan it judges.
function baseChecks(expect) {
  const b = [contractShape(), on5(), sane(), honest(), assumptionsMax(6)];
  if (expect !== "conflict") b.push(okIs(true), noErrors(), noOverlap());
  return b;
}
function runChecks(checks, r) {
  const fails = [];
  for (const k of checks) {
    let why;
    try {
      why = k.fn(r);
    } catch (err) {
      why = `check threw: ${err && err.message}`;
    }
    if (why != null) fails.push(`✗ ${k.name}: ${why}`);
  }
  return fails;
}

// ─────────────── scenarios ───────────────
const results = []; // { cat, id, pass }

for (const sc of SCENARIOS) {
  test(`[${sc.cat}] ${sc.id}`, () => {
    let pass = false;
    try {
      if (loadError) throw loadError;
      const ctx = typeof sc.ctx === "function" ? J(sc.ctx(E)) : J(sc.ctx || {});
      const report = [`  prompt: "${sc.prompt}"`];
      const fails = [];

      let state = E.plan(sc.prompt, ctx);
      const r0 = { plan: J(state.plan), request: J(state.request), state, ctx };
      const f0 = runChecks([...baseChecks(sc.expect), ...(sc.checks || [])], r0);
      report.push(describe(state, "generated day:"));
      if (f0.length) fails.push("  initial plan:", ...f0.map((f) => "    " + f));

      (sc.steps || []).forEach((step, n) => {
        const before = state;
        let next;
        try {
          next = E.refine(before, step.text, ctx);
        } catch (err) {
          fails.push(`  step ${n + 1} "${step.text}": refine threw ${err && err.stack}`);
          return;
        }
        const r = { plan: J(next.plan), request: J(next.request), state: next, prev: J(before.plan), prevRequest: J(before.request), ctx };
        const fs = runChecks([...baseChecks(step.expect), ...(step.checks || [])], r);
        if (step.undo) {
          try {
            const u = E.undo(next);
            if (JSON.stringify(J(u.plan)) !== JSON.stringify(J(before.plan))) fs.push("✗ undo restores the previous plan exactly: plans differ");
            if (JSON.stringify(J(u.request)) !== JSON.stringify(J(before.request))) fs.push("✗ undo restores the previous request exactly: requests differ");
            const rd = E.redo(u);
            if (JSON.stringify(J(rd.plan)) !== JSON.stringify(J(next.plan))) fs.push("✗ redo re-applies the refinement exactly: plans differ");
          } catch (err) {
            fs.push(`✗ undo/redo threw: ${err && err.message}`);
          }
        }
        report.push(describe(next, `after refine ${n + 1}: "${step.text}"`));
        if (fs.length) fails.push(`  step ${n + 1} "${step.text}":`, ...fs.map((f) => "    " + f));
        state = next;
      });

      if (fails.length) assert.fail(`\n${fails.join("\n")}\n${report.join("\n")}\n`);
      pass = true;
    } finally {
      results.push({ cat: sc.cat, id: sc.id, pass });
    }
  });
}

// ─────────────── scoring summary ───────────────
test("scoring summary (pass/fail per category)", () => {
  const rows = Object.keys(CATEGORIES).map((cat) => {
    const r = results.filter((x) => x.cat === cat);
    return { cat: CATEGORIES[cat], n: r.length, pass: r.filter((x) => x.pass).length };
  });
  const tot = { n: results.length, pass: results.filter((x) => x.pass).length };
  const w = Math.max(...rows.map((r) => r.cat.length), 10);
  const line = (a, b, c, d) => `  ${a.padEnd(w)}  ${String(b).padStart(5)}  ${String(c).padStart(5)}  ${String(d).padStart(5)}`;
  const out = ["", "Describe Your Day — evaluation summary", line("category", "total", "pass", "fail"), "  " + "─".repeat(w + 21)];
  rows.forEach((r) => out.push(line(r.cat, r.n, r.pass, r.n - r.pass)));
  out.push("  " + "─".repeat(w + 21), line("TOTAL", tot.n, tot.pass, tot.n - tot.pass), `  pass rate ${tot.n ? Math.round((100 * tot.pass) / tot.n) : 0}%`);
  const failed = results.filter((x) => !x.pass);
  if (failed.length) {
    out.push("", "  failing scenarios:");
    failed.forEach((x) => out.push(`    ✗ [${x.cat}] ${x.id}`));
  }
  if (loadError) out.push("", `  ${loadError.message}`);
  console.log(out.join("\n"));
  // Informational only: the per-scenario tests carry the verdicts.
  assert.ok(results.length >= 60, `expected ≥ 60 scenarios, ran ${results.length}`);
});
