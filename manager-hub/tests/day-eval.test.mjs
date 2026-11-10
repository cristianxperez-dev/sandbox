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
import { SCENARIOS as CORE, CATEGORIES as CORE_CATS, items, fmt, contractShape, on5, sane, honest, assumptionsMax, noOverlap, okIs, noErrors } from "./day-eval-scenarios.mjs";

import { FRESH, FRESH_CATEGORIES } from "./day-fresh-scenarios.mjs";
// MH_EVAL_SET: core (default, 103 scenarios) | fresh (unfamiliar conversational prompts) | all
const SET = process.env.MH_EVAL_SET || "core";
const SCENARIOS = SET === "fresh" ? FRESH : SET === "all" ? CORE.concat(FRESH) : CORE;
const CATEGORIES = SET === "fresh" ? FRESH_CATEGORIES : SET === "all" ? Object.assign({}, CORE_CATS, FRESH_CATEGORIES) : CORE_CATS;
// MH_EVAL_REPORT=file.json writes per-scenario results (pass, failures, interpreter, usage) for comparison runs
const REPORT = process.env.MH_EVAL_REPORT || "";

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

// MH_EVAL_INTERPRETER=ai (with OPENAI_API_KEY, MH_AI_MODEL) sends every prompt through the real AI interpreter
// endpoint instead of the built-in reader; the solver and every check are identical.
const AI = process.env.MH_EVAL_INTERPRETER === "ai";
let endpoint = null;
// MH_EVAL_BASE=https://<preview>/apps/manager-hub/ calls the DEPLOYED endpoint over HTTPS instead
// (the preview access code reaches the gate as the X-MH-Access-Key header, injected by the egress proxy
// or given in MH_EVAL_ACCESS_KEY). MH_AI_MODEL / MH_AI_EFFORT pick the model per request (preview allowlist).
const BASE_URL = process.env.MH_EVAL_BASE || "";
async function viaHttp(body) {
  const headers = { "Content-Type": "application/json", Origin: new URL(BASE_URL).origin, "X-MH-Access-Key": process.env.MH_EVAL_ACCESS_KEY || "proxy-injected" };
  const payload = Object.assign({}, body, process.env.MH_AI_MODEL ? { model: process.env.MH_AI_MODEL } : {}, process.env.MH_AI_EFFORT ? { effort: process.env.MH_AI_EFFORT } : {});
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let res;
    try { res = await fetch(new URL("api/interpret", BASE_URL), { method: "POST", headers, body: JSON.stringify(payload) }); }
    catch (e) { if (attempt < 1) continue; return { res: { ok: false, status: 0 }, d: { error: "network" } }; }
    const d = await res.json().catch(() => ({ error: "non-json-" + res.status }));
    if (d && d.ms == null) d.ms = Date.now() - t0;
    d.wall = Date.now() - t0;
    // Production's per-client limit (20 per 10 min): wait it out instead of failing the scenario
    if (res.status === 429 && d.error === "rate-limited" && attempt < 30) { await new Promise((r) => setTimeout(r, ((d.retryAfter || 60) + 2) * 1000)); continue; }
    if ((res.status === 429 && d.error !== "rate-limited" || res.status >= 500 && d.error === "model-service-503") && attempt < 2) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    return { res, d };
  }
}
async function viaEndpoint(body) {
  if (BASE_URL) {
    const { res, d } = await viaHttp(body);
    USAGE.calls++;
    if (d.usage) { USAGE.input += d.usage.input_tokens || 0; USAGE.output += d.usage.output_tokens || 0; USAGE.cacheRead += d.usage.cached_input_tokens || 0; USAGE.reasoning += d.usage.reasoning_tokens || 0; }
    if (d.ms) { USAGE.ms += d.ms; USAGE.lat.push(d.ms); }
    if (d.wall) USAGE.wall.push(d.wall);
    if (d.model) USAGE.model = d.model;
    if (!res.ok) { USAGE.errors++; USAGE.errorKinds[d.error] = (USAGE.errorKinds[d.error] || 0) + 1; throw new Error(`AI interpreter ${res.status}: ${JSON.stringify(d)}`); }
    return d;
  }
  if (!endpoint) endpoint = await import("../../functions/apps/manager-hub/api/interpret.js");
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, MH_AI_ENABLED: "1", MH_AI_MODEL: process.env.MH_AI_MODEL, MH_AI_EFFORT: process.env.MH_AI_EFFORT, MH_AI_RATE: "1000000", MH_AI_DAILY: "1000000", MH_AI_LOG: "0" };
  const origin = "https://eval.sandbox-34x.pages.dev";   // evaluated as a preview host — production stays locked
  const res = await endpoint.onRequestPost({ env, request: new Request(origin + "/apps/manager-hub/api/interpret", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }) });
  const d = await res.json();
  USAGE.calls++;
  if (d.usage) { USAGE.input += d.usage.input_tokens || 0; USAGE.output += d.usage.output_tokens || 0; USAGE.cacheRead += d.usage.cached_input_tokens || 0; USAGE.reasoning += d.usage.reasoning_tokens || 0; }
  if (d.ms) { USAGE.ms += d.ms; USAGE.lat.push(d.ms); }
  if (d.model) USAGE.model = d.model;
  if (!res.ok) { USAGE.errors++; USAGE.errorKinds[d.error] = (USAGE.errorKinds[d.error] || 0) + 1; throw new Error(`AI interpreter ${res.status}: ${JSON.stringify(d)}`); }
  return d;
}
const wire = (ctx) => ({ date: ctx.date, affiliate: ctx.affiliate, hittingGroups: ctx.hittingGroups, pitcherGroups: ctx.pitcherGroups, resources: ctx.resources, game: ctx.game });
async function PLAN(text, ctx) {
  if (!AI) return E.plan(text, ctx);
  const d = await viaEndpoint({ mode: "build", text, ctx: wire(ctx) });
  return E.plan(text, ctx, { request: d.request });
}
async function REFINE(state, text, ctx) {
  if (!AI) return E.refine(state, text, ctx);
  const d = await viaEndpoint({ mode: "refine", text, ctx: wire(ctx), request: state.request, plan: { items: state.plan.items.map((i) => ({ start: i.start, end: i.end, track: i.track, group: i.group || null, label: i.label, actId: i.actId || null, fixed: !!i.fixed })) } });
  return E.refine(state, text, ctx, { ops: d.ops });
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
  if (!["conflict", "conflict-ok", "any"].includes(expect)) b.push(okIs(true), noErrors(), noOverlap());
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
const results = []; // { cat, id, pass, fails }
let lastFails = [];
const USAGE = { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, ms: 0, lat: [], wall: [], errors: 0, errorKinds: {}, model: null };

for (const sc of SCENARIOS) {
  test(`[${sc.cat}] ${sc.id}`, async () => {
    let pass = false;
    try {
      if (loadError) throw loadError;
      const ctx = typeof sc.ctx === "function" ? J(sc.ctx(E)) : J(sc.ctx || {});
      const report = [`  prompt: "${sc.prompt}"`];
      const fails = [];

      let state = await PLAN(sc.prompt, ctx);
      if (AI && state.interpreter !== "ai") throw new Error("the AI interpreter's request was rejected by validation");
      const r0 = { plan: J(state.plan), request: J(state.request), state, ctx };
      const f0 = runChecks([...baseChecks(sc.expect), ...(sc.checks || [])], r0);
      report.push(describe(state, "generated day:"));
      if (f0.length) fails.push("  initial plan:", ...f0.map((f) => "    " + f));

      for (const [n, step] of (sc.steps || []).entries()) {
        const before = state;
        let next;
        try {
          next = await REFINE(before, step.text, ctx);
        } catch (err) {
          fails.push(`  step ${n + 1} "${step.text}": refine threw ${err && err.stack}`);
          continue;
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
      }

      lastFails = fails;
      if (fails.length) assert.fail(`\n${fails.join("\n")}\n${report.join("\n")}\n`);
      pass = true;
    } catch (err) {
      if (!lastFails.length) lastFails = [String(err && err.message).split("\n")[0]];
      throw err;
    } finally {
      results.push({ cat: sc.cat, id: sc.id, pass, fails: pass ? [] : lastFails.slice(0, 12) });
      lastFails = [];
    }
  });
}

// ─────────────── scoring summary ───────────────
test("scoring summary (pass/fail per category)", async () => {
  const rows = Object.keys(CATEGORIES).map((cat) => {
    const r = results.filter((x) => x.cat === cat);
    return { cat: CATEGORIES[cat], n: r.length, pass: r.filter((x) => x.pass).length };
  });
  const tot = { n: results.length, pass: results.filter((x) => x.pass).length };
  const w = Math.max(...rows.map((r) => r.cat.length), 10);
  const line = (a, b, c, d) => `  ${a.padEnd(w)}  ${String(b).padStart(5)}  ${String(c).padStart(5)}  ${String(d).padStart(5)}`;
  const out = ["", `Describe Your Day — evaluation summary (${AI ? "AI interpreter: " + (process.env.MH_AI_MODEL || "default model") : "built-in reader"})`, line("category", "total", "pass", "fail"), "  " + "─".repeat(w + 21)];
  rows.forEach((r) => out.push(line(r.cat, r.n, r.pass, r.n - r.pass)));
  out.push("  " + "─".repeat(w + 21), line("TOTAL", tot.n, tot.pass, tot.n - tot.pass), `  pass rate ${tot.n ? Math.round((100 * tot.pass) / tot.n) : 0}%`);
  if (AI) out.push(`  model ${USAGE.model || process.env.MH_AI_MODEL} · calls ${USAGE.calls} (${USAGE.errors} errors ${JSON.stringify(USAGE.errorKinds)}) · tokens in ${USAGE.input} (${USAGE.cacheRead} cached) · out ${USAGE.output} (${USAGE.reasoning} reasoning) · avg ${USAGE.calls ? Math.round(USAGE.ms / USAGE.calls) : 0} ms`);
  const failed = results.filter((x) => !x.pass);
  if (failed.length) {
    out.push("", "  failing scenarios:");
    failed.forEach((x) => out.push(`    ✗ [${x.cat}] ${x.id}`));
  }
  if (loadError) out.push("", `  ${loadError.message}`);
  console.log(out.join("\n"));
  // Informational only: the per-scenario tests carry the verdicts.
  if (REPORT) { const { writeFileSync } = await import("node:fs"); writeFileSync(REPORT, JSON.stringify({ set: SET, interpreter: AI ? "ai" : "reader", model: process.env.MH_AI_MODEL || null, usage: USAGE, results }, null, 2)); }
  assert.ok(results.length >= (SET === "fresh" ? 20 : 60), `expected more scenarios, ran ${results.length}`);
});
