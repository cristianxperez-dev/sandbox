// Compare two Describe Your Day evaluation reports (MH_EVAL_REPORT output) — e.g. built-in reader vs AI.
//   node manager-hub/tests/eval-compare.mjs reader.json ai.json        → Markdown on stdout
import { readFileSync, existsSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const A = load(aPath), B = load(bPath);
const out = [];
const name = (r) => (r ? (r.interpreter === "ai" ? `AI (${(r.usage && r.usage.model) || r.model || "default model"})` : "Built-in reader") : "—");
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
// $ per 1M tokens (input, cached input, output). Third-party listings, Nov 2026 — not verified against
// OpenAI's own page; override with MH_PRICE="in,cached,out". Output tokens include reasoning tokens.
const PRICES = { "gpt-6-luna": [0.10, 0.01, 0.50], "gpt-6.1-sol": [2.00, 0.10, 10.00] };
const priceFor = (m) => (process.env.MH_PRICE ? process.env.MH_PRICE.split(",").map(Number) : PRICES[Object.keys(PRICES).find((k) => String(m || "").startsWith(k))] || null);
const pct = (xs, q) => { if (!xs || !xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
for (const R of [A, B].filter((r) => r && r.interpreter === "ai" && r.usage)) {
  const u = R.usage, pr = priceFor(u.model || R.model);
  const cost = pr ? ((u.input - u.cacheRead) * pr[0] + u.cacheRead * pr[1] + u.output * pr[2]) / 1e6 : null;
  out.push(`**${name(R)}** — calls ${u.calls}, errors ${u.errors} ${JSON.stringify(u.errorKinds || {})} · latency p50 ${pct(u.lat, 0.5)} ms, p90 ${pct(u.lat, 0.9)} ms, avg ${u.calls ? Math.round(u.ms / u.calls) : 0} ms · tokens/call in ${u.calls ? Math.round(u.input / u.calls) : 0} (${u.calls ? Math.round(u.cacheRead / u.calls) : 0} cached), out ${u.calls ? Math.round(u.output / u.calls) : 0} (${u.calls ? Math.round(u.reasoning / u.calls) : 0} reasoning)` +
    (cost != null ? ` · est. $${cost.toFixed(3)} total, $${(cost / Math.max(1, u.calls)).toFixed(4)}/call` : " · price unknown"), "");
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
