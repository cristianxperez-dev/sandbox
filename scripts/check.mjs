#!/usr/bin/env node
// Post-build sanity check: every registered app has a page, and every local
// href/src in Sandbox-owned pages resolves to a file in _site/.
// Integrated apps are checked too, so a missing asset shows up before deploy.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
const registry = JSON.parse(readFileSync(join(ROOT, "apps", "registry.json"), "utf8"));
const problems = [];

for (const app of registry) {
  if (!existsSync(join(OUT, "apps", app.id, "index.html"))) problems.push(`apps/${app.id}/index.html missing`);
}

for (const file of walk(OUT).filter((f) => f.endsWith(".html") && !f.endsWith("404.html"))) {
  const html = readFileSync(file, "utf8");
  for (const [, ref] of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
    const url = ref.split(/[?#\s]/)[0];
    if (!url || /^([a-z]+:|\/\/|#|\{\{|\$\{)/i.test(ref)) continue;
    if (/['+`]|\$\{/.test(ref)) continue; // built in JavaScript, not a static link
    if (url.startsWith("/")) {
      problems.push(`${relative(OUT, file)}: root-absolute link "${ref}" will break under a GitHub Pages project path`);
      continue;
    }
    let target = join(dirname(file), url);
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target)) problems.push(`${relative(OUT, file)}: "${ref}" not found`);
  }
}

if (problems.length) {
  console.error(`✖ ${problems.length} problem(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log("✓ All app pages present and all local links resolve.");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}
