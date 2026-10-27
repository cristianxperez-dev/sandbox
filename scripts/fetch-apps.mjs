#!/usr/bin/env node
// Pulls every app that lives in its own repository (a "source" entry in
// apps/registry.json) into .sources/<id>/, ready for scripts/build.mjs.
//
//   "source": {
//     "repo":  "owner/repository",       required
//     "ref":   "main",                   branch, tag or full commit SHA (default "main")
//     "path":  "dist",                   folder holding the deployable site (default: repository root)
//     "build": "npm ci && npm run build" optional command run inside the checkout first
//     "exclude": ["research", "tools"]   optional top-level names never to publish
//   }
//
// Public repositories need nothing. For private ones, set APP_SOURCES_TOKEN to a
// fine-grained token with read-only "Contents" access to those repositories.
// The token is used only for the git fetch: it is never written to disk and is
// removed from the environment before any build command runs.
//
//   node scripts/fetch-apps.mjs              fetch all sourced apps
//   node scripts/fetch-apps.mjs replated-recipes   fetch just one

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = join(ROOT, ".sources");
const token = process.env.APP_SOURCES_TOKEN || "";
const only = process.argv.slice(2);

const registry = JSON.parse(readFileSync(join(ROOT, "apps", "registry.json"), "utf8"));
const sourced = registry.filter((a) => a.source && (!only.length || only.includes(a.id)));

if (!sourced.length) {
  console.log("No apps with a \"source\" repository to fetch.");
  process.exit(0);
}

// Build commands get a clean environment: no token, no Actions credentials.
const buildEnv = { ...process.env };
for (const key of ["APP_SOURCES_TOKEN", "GITHUB_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_RUNTIME_TOKEN"]) {
  delete buildEnv[key];
}

mkdirSync(SOURCES, { recursive: true });
const summary = [];

for (const app of sourced) {
  const { repo, ref = "main", path = ".", build } = app.source;
  const dir = join(SOURCES, app.id);
  console.log(`\n→ ${app.id}: ${repo}@${ref}`);

  rmSync(dir, { recursive: true, force: true });
  rmSync(join(SOURCES, `${app.id}.json`), { force: true });
  mkdirSync(dir, { recursive: true });

  const auth = token
    ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`]
    : [];
  git(dir, ["init", "-q"]);
  try {
    git(dir, [...auth, "fetch", "-q", "--depth", "1", `https://github.com/${repo}.git`, ref]);
  } catch {
    fail(
      `Could not fetch ${repo}@${ref}. Check that the repository and ref exist` +
        (token ? " and that APP_SOURCES_TOKEN can read it." : ". If the repository is private, set the APP_SOURCES_TOKEN secret.")
    );
  }
  git(dir, ["checkout", "-q", "FETCH_HEAD"]);

  const sha = git(dir, ["rev-parse", "HEAD"]);
  const date = git(dir, ["log", "-1", "--format=%cs"]);
  const subject = git(dir, ["log", "-1", "--format=%s"]);
  rmSync(join(dir, ".git"), { recursive: true, force: true });

  if (build) {
    console.log(`  build: ${build}`);
    try {
      execFileSync("bash", ["-c", build], { cwd: dir, env: buildEnv, stdio: "inherit" });
    } catch {
      fail(`Build command failed for ${app.id}.`);
    }
  }

  if (!existsSync(join(dir, path, "index.html")))
    fail(`${repo}@${ref} has no index.html in ${path === "." ? "its root" : `"${path}"`}. Check source.path.`);

  writeFileSync(join(SOURCES, `${app.id}.json`), JSON.stringify({ repo, ref, sha, date, subject }, null, 2));
  console.log(`  ✓ ${sha.slice(0, 7)} (${date}) ${subject}`);
  summary.push(`| ${app.name} | \`${repo}\` | \`${ref}\` | [\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha}) ${date} — ${subject.replace(/\|/g, "\\|")} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Apps pulled from their repositories\n\n| App | Repository | Ref | Deployed commit |\n|---|---|---|---|\n${summary.join("\n")}\n`
  );
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
