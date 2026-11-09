// Removes access-code-protected apps (access-gate/apps.js) from a built site before it is published
// somewhere without the Cloudflare gate — the GitHub Pages copy. Each app folder keeps only its public
// files (the homepage card logo) and a short page pointing to the protected address.
// Usage: node scripts/strip-protected.mjs _site [https://cperez.app]
import { readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROTECTED_APPS } from "../access-gate/apps.js";

const out = process.argv[2] || "_site";
const home = (process.argv[3] || "https://cperez.app").replace(/\/$/, "");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

for (const app of PROTECTED_APPS) {
  const dir = join(out, app.base.replace(/^\//, ""));
  if (!existsSync(dir)) continue;
  const keep = new Set((app.publicFiles || []).map((f) => join(out, f.replace(/^\//, ""))));
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); if (!readdirSync(p).length) rmSync(p, { recursive: true }); }
      else if (!keep.has(p)) rmSync(p);
    }
  };
  walk(dir);
  writeFileSync(join(dir, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(app.name)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FCF9F3;color:#2A2826;font:15px/1.5 system-ui,sans-serif;padding:24px;text-align:center}
a{color:#2A2826}</style></head><body><main><h1 style="font-family:Georgia,serif;font-weight:600">${esc(app.name)}</h1>
<p>This application needs an access code. Open it at <a href="${esc(home + app.base)}">${esc(home.replace(/^https?:\/\//, "") + app.base)}</a>.</p>
<p><a href="../../">← Back to Sandbox</a></p></main></body></html>
`);
  console.log(`stripped ${app.base} (kept ${[...keep].filter(existsSync).length} public file(s) + a pointer page)`);
}
