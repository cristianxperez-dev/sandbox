// Compare two Describe Your Day evaluation reports (MH_EVAL_REPORT output) — e.g. built-in reader vs AI.
//   node manager-hub/tests/eval-compare.mjs reader.json ai.json        → Markdown on stdout
import { readFileSync, existsSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const A = load(aPath), B = load(bPath);
const out = [];
const name = (r) => (r ? (r.interpreter === "ai" ? `AI interpreter (${r.model || "default model"})` : "Built-in reader") : "—");
const rate = (r, cat) => {
  if (!r) return "—";
  const xs = r.results.filter((x) => !cat || x.cat === cat);
  const p = xs.filter((x) => x.pass).length;
  return `${p}/${xs.length} (${xs.length ? Math.round((100 * p) / xs.length) : 0}%)`;
};
out.push(`## Describe Your Day — evaluation (${(B || A || {}).set || "?"} set)`, "");
if (!B) out.push("> AI report missing — the AI step failed before writing results (see ai.txt).", "");
const cats = [...new Set([...(A ? A.results : []), ...(B ? B.results : [])].map((x) => x.cat))];
out.push(`| category | ${name(A)} | ${name(B)} |`, "|---|---|---|");
cats.forEach((c) => out.push(`| ${c} | ${rate(A, c)} | ${rate(B, c)} |`));
out.push(`| **total** | **${rate(A)}** | **${rate(B)}** |`, "");
if (B && B.usage) {
  const u = B.usage;
  // list prices for the default model ($ per million tokens); cache reads at 0.05× input, writes at 1.25×
  const cost = (u.input * 4 + u.cacheRead * 0.2 + u.cacheWrite * 5 + u.output * 20) / 1e6;
  out.push(`AI calls: ${u.calls} (${u.errors} errors) · input ${u.input} tokens (+${u.cacheRead} cache read, ${u.cacheWrite} cache write) · output ${u.output} · avg latency ${u.calls ? Math.round(u.ms / u.calls) : 0} ms · est. cost $${cost.toFixed(2)} (≈ $${u.calls ? (cost / u.calls).toFixed(3) : "0"} per call, at the default model's list price)`, "");
}
if (A && B) {
  const byId = new Map(A.results.map((x) => [x.id, x]));
  const won = B.results.filter((x) => x.pass && byId.get(x.id) && !byId.get(x.id).pass);
  const lost = B.results.filter((x) => !x.pass && byId.get(x.id) && byId.get(x.id).pass);
  if (won.length) out.push(`**AI fixed (${won.length}):**`, ...won.map((x) => `- ${x.id}`), "");
  if (lost.length) out.push(`**AI regressed vs the reader (${lost.length}):**`, ...lost.map((x) => `- ${x.id}\n  - ${x.fails.slice(0, 4).join("\n  - ")}`), "");
}
const failing = (B || A) ? (B || A).results.filter((x) => !x.pass) : [];
if (failing.length) out.push(`<details><summary>${name(B || A)}: ${failing.length} failing scenario(s)</summary>\n`, ...failing.map((x) => `- **${x.id}**\n  - ${x.fails.slice(0, 6).join("\n  - ")}`), "\n</details>");
console.log(out.join("\n"));
