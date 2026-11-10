// Manager Hub — Describe Your Day: production-readiness smoke test with REAL model calls.
//   MH_EVAL_BASE=https://cperez.app/apps/manager-hub/ node manager-hub/tests/smoke-ai.mjs
// Authenticates with the access code in X-MH-Access-Key (injected by an egress proxy, or MH_EVAL_ACCESS_KEY).
// Prints which model answered, whether the AI (not the built-in reader) was used, latency, tokens, and
// checks the resulting schedules with the same rubric as the evaluation suite.
import { createRequire } from "node:module";
import { SCENARIOS } from "./day-eval-scenarios.mjs";
import { FRESH } from "./day-fresh-scenarios.mjs";
import { contractShape, on5, sane, honest, noOverlap, okIs, noErrors } from "./day-eval-scenarios.mjs";
const require = createRequire(import.meta.url);
const E = require("../../apps/manager-hub/assistant/day-engine.js");

const BASE = process.env.MH_EVAL_BASE || "https://cperez.app/apps/manager-hub/";
const KEY = process.env.MH_EVAL_ACCESS_KEY || "proxy-injected";
const PRICES = { "gpt-6.1-sol": [2.0, 0.1, 10.0], "gpt-6-luna": [0.1, 0.01, 0.5] };   // $/1M in, cached in, out — third-party listings
const J = (x) => JSON.parse(JSON.stringify(x));
const stats = { calls: 0, ok: 0, fail: 0, kinds: {}, ms: [], cost: 0, models: {} };

async function call(body) {
  const t0 = Date.now();
  const r = await fetch(new URL("api/interpret", BASE), { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(BASE).origin, "X-MH-Access-Key": KEY }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ error: "non-json-" + r.status }));
  stats.calls++; stats.ms.push(d.ms || Date.now() - t0);
  if (d.model) stats.models[d.model] = (stats.models[d.model] || 0) + 1;
  if (d.usage && d.model) {
    const p = PRICES[Object.keys(PRICES).find((k) => d.model.startsWith(k))];
    if (p) stats.cost += ((d.usage.input_tokens - d.usage.cached_input_tokens) * p[0] + d.usage.cached_input_tokens * p[1] + d.usage.output_tokens * p[2]) / 1e6;
  }
  if (!r.ok) { stats.fail++; stats.kinds[d.error] = (stats.kinds[d.error] || 0) + 1; return { ok: false, status: r.status, d }; }
  stats.ok++; return { ok: true, d };
}
const wire = (ctx) => ({ hittingGroups: ctx.hittingGroups, pitcherGroups: ctx.pitcherGroups, resources: ctx.resources, game: ctx.game });
const planOf = (s) => ({ items: s.plan.items.map((i) => ({ start: i.start, end: i.end, track: i.track, group: i.group || null, label: i.label, actId: i.actId || null, fixed: !!i.fixed })) });
const fmt = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
const table = (p) => p.items.slice().sort((a, b) => a.start - b.start).map((i) => `    ${fmt(i.start)}–${fmt(i.end)} [${i.track}${i.group ? "/" + i.group : ""}] ${i.label}${i.fixed ? " (fixed)" : ""}`).join("\n");

function judge(sc, state, prev, step) {
  const r = { plan: J(state.plan), request: J(state.request), state, prev: prev ? J(prev.plan) : undefined, ctx: sc.ctx || {} };
  const exp = step ? step.expect : sc.expect;
  const base = [contractShape(), on5(), sane(), honest()].concat(["conflict", "conflict-ok", "any"].includes(exp) ? [] : [okIs(true), noErrors(), noOverlap()]);
  const checks = base.concat((step ? step.checks : sc.checks) || []);
  return checks.map((k) => { let w; try { w = k.fn(r); } catch (e) { w = "threw " + e.message; } return w == null ? null : `✗ ${k.name}: ${w}`; }).filter(Boolean);
}

const pick = (list, ids) => ids.map((s) => list.find((x) => x.id.startsWith(s))).filter(Boolean);
const CASES = [
  ...pick(SCENARIOS, ["PRIMARY acceptance"]),
  ...pick(FRESH, ["OWNER: §1 day", "NEW2: text message style", "NEW2: coach thinking out loud", "NEW: run-on dictation", "FCL game 10am", "home 6:35", "NEW2: impossible stack", "follow-ups: start later"]),
];

let passed = 0, failed = 0, aiUsed = 0, fallback = 0;
console.log(`Smoke test against ${BASE}\n`);
for (const sc of CASES) {
  const ctx = J(sc.ctx || {});
  const b = await call({ mode: "build", text: sc.prompt, ctx: wire(ctx) });
  let state;
  if (b.ok) { state = E.plan(sc.prompt, ctx, { request: b.d.request }); if (state.interpreter === "ai") aiUsed++; else fallback++; }
  else { state = E.plan(sc.prompt, ctx); fallback++; }
  const fails = judge(sc, state);
  console.log(`${fails.length ? "✗" : "✓"} ${sc.id}\n  “${sc.prompt}”\n  interpreter: ${state.interpreter}${b.ok ? ` (${b.d.model}, ${b.d.ms} ms, ${b.d.usage ? b.d.usage.input_tokens + " in / " + b.d.usage.output_tokens + " out" : ""})` : ` — AI failed: ${b.status} ${JSON.stringify(b.d)}`}`);
  console.log(table(state.plan));
  (state.plan.conflicts || []).forEach((c) => console.log(`    ! ${c.code}: ${c.message}`));
  fails.forEach((f) => console.log("    " + f));
  fails.length ? failed++ : passed++;
  for (const step of sc.steps || []) {
    const rr = await call({ mode: "refine", text: step.text, ctx: wire(ctx), request: state.request, plan: planOf(state) });
    const prev = state;
    state = rr.ok ? E.refine(state, step.text, ctx, { ops: rr.d.ops }) : E.refine(state, step.text, ctx);
    if (rr.ok) aiUsed++; else fallback++;
    const sf = judge(sc, state, prev, step);
    console.log(`  ${sf.length ? "✗" : "✓"} follow-up “${step.text}” — ${rr.ok ? `AI ops ${JSON.stringify(rr.d.ops).slice(0, 160)} (${rr.d.ms} ms)` : `AI failed: ${rr.status} ${JSON.stringify(rr.d)}`}`);
    console.log(table(state.plan).split("\n").map((l) => "  " + l).join("\n"));
    sf.forEach((f) => console.log("      " + f));
    sf.length ? failed++ : passed++;
  }
  console.log("");
}
const ms = stats.ms.slice().sort((a, b) => a - b), p = (q) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] || 0;
console.log(`checks: ${passed} passed, ${failed} failed · AI used ${aiUsed}, fallback ${fallback}`);
console.log(`calls ${stats.calls}: ${stats.ok} ok, ${stats.fail} failed ${JSON.stringify(stats.kinds)} · models ${JSON.stringify(stats.models)}`);
console.log(`latency p50 ${p(0.5)} ms, p90 ${p(0.9)} ms · est. cost $${stats.cost.toFixed(4)} total, $${(stats.cost / Math.max(1, stats.ok)).toFixed(4)} per successful call`);
if (failed || stats.fail) process.exitCode = 1;
