#!/usr/bin/env node
// Builds the publishable site into _site/.
//
//   site/            → the Sandbox shell (homepage, shared assets, 404)
//   apps/<id>/       → each application, copied as-is
//   .sources/<id>/   → apps pulled from their own repositories by
//                      scripts/fetch-apps.mjs ("source" in the registry)
//   apps/registry.json → metadata that drives the homepage and placeholders
//
// No dependencies. Everything is emitted with relative links, so the output
// works under a GitHub Pages project path (/sandbox/) and at a domain root.
//
// Environment (all optional — set automatically by the deploy workflow):
//   SITE_URL   absolute public URL, e.g. https://example.com/  (used for
//              social-share metadata and the sitemap)
//   BASE_PATH  URL path the site lives under, e.g. /sandbox/  (used only by
//              404.html, which can be served at any depth)

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
const APPS = join(ROOT, "apps");
const OUT = join(ROOT, "_site");
const SOURCES = join(ROOT, ".sources");
const IN_CI = Boolean(process.env.CI);

const LOGO_NAMES = ["logo.svg", "logo.webp", "logo.png", "logo.jpg", "logo.jpeg"];
const RETURN_POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right"];
const RETURN_MARKER = "data-sandbox-return";
// Never published from a fetched app, even if present in its deploy folder.
const SOURCE_EXCLUDES = ["node_modules", "package.json", "package-lock.json", "README.md", "LICENSE"];
const ARROW = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------- config

const config = readJson(join(ROOT, "sandbox.config.json"));
const registry = readJson(join(APPS, "registry.json"));

const siteUrl = withTrailingSlash(process.env.SITE_URL || config.siteUrl || "");
const basePath = withTrailingSlash(
  process.env.BASE_PATH ?? (siteUrl ? new URL(siteUrl).pathname : "/")
);
const year = String(new Date().getFullYear());

const apps = validate(registry).map(resolveApp);

// ---------------------------------------------------------------- build

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(SITE, OUT, {
  recursive: true,
  filter: (src) => !src.startsWith(join(SITE, "templates")) && !isHidden(src),
});
writeFileSync(join(OUT, ".nojekyll"), "");

const placeholderTpl = read(join(SITE, "templates", "placeholder.html"));

for (const app of apps) {
  const dest = join(OUT, "apps", app.id);
  if (app.sourceDir) {
    cpSync(app.sourceDir, dest, { recursive: true, filter: (src) => !isExcluded(src, app) });
  }
  if (existsSync(app.dir)) {
    // Sandbox-side extras (e.g. the card logo) sit beside a fetched app but may never replace its files.
    for (const file of app.sourceDir ? walk(app.dir) : []) {
      const rel = relative(app.dir, file);
      if (existsSync(join(dest, rel)))
        fail(`apps/${app.id}/${rel} would overwrite a file from ${app.source.repo}. Rename or remove it.`);
    }
    cpSync(app.dir, dest, { recursive: true, filter: (src) => !isHidden(src) });
  }
  mkdirSync(dest, { recursive: true });

  if (app.integrated) {
    if (app.returnLink) injectReturnLink(join(dest, "index.html"), app.returnLink);
  } else {
    writeFileSync(join(dest, "index.html"), renderPlaceholder(app));
  }
}

const listed = apps.filter((a) => !a.hidden);
render("index.html", {
  APP_COUNT: String(listed.length),
  APP_COUNT_WORD: listed.length === 1 ? "application" : "applications",
  FILTERS: renderFilters(listed),
  CARDS: listed.map(renderCard).join("\n"),
  STATUS_LEGEND: renderStatusLegend(),
});
render("404.html", { BASE: basePath });

if (siteUrl) {
  const urls = ["", ...listed.map((a) => `apps/${a.id}/`)];
  writeFileSync(
    join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${esc(siteUrl + u)}</loc></url>`).join("\n") +
      `\n</urlset>\n`
  );
}

const integrated = apps.filter((a) => a.integrated).length;
console.log(
  `Built _site/ — ${apps.length} apps (${integrated} integrated, ${apps.length - integrated} placeholder)` +
    (siteUrl ? ` for ${siteUrl}` : " (no SITE_URL; share metadata uses relative URLs)")
);

// ---------------------------------------------------------------- registry

function validate(list) {
  if (!Array.isArray(list)) fail("apps/registry.json must be an array of apps.");
  const seen = new Set();
  for (const [i, app] of list.entries()) {
    const where = `apps/registry.json entry ${i + 1}${app?.id ? ` ("${app.id}")` : ""}`;
    for (const key of ["id", "name", "description", "category", "status"]) {
      if (!app[key] || typeof app[key] !== "string") fail(`${where}: "${key}" is required.`);
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(app.id))
      fail(`${where}: "id" must be lowercase letters, numbers and hyphens (it becomes the URL).`);
    if (seen.has(app.id)) fail(`${where}: duplicate id.`);
    seen.add(app.id);
    if (!config.categories.includes(app.category))
      fail(`${where}: unknown category "${app.category}". Add it to sandbox.config.json first.`);
    if (!config.statuses[app.status])
      fail(`${where}: status must be one of ${Object.keys(config.statuses).join(", ")}.`);
    if (app.returnLink !== undefined && app.returnLink !== false && !RETURN_POSITIONS.includes(app.returnLink))
      fail(`${where}: "returnLink" must be false or one of ${RETURN_POSITIONS.join(", ")}.`);
    if (app.updated && !/^\d{4}-\d{2}(-\d{2})?$/.test(app.updated))
      fail(`${where}: "updated" must look like 2026-10 or 2026-10-26.`);
    if (app.source !== undefined) validateSource(app.source, where);
    if (app.source && existsSync(join(APPS, app.id, "index.html")))
      fail(`${where}: has a "source" repository and also apps/${app.id}/index.html. Use one or the other.`);
  }
  return list;
}

function validateSource(source, where) {
  if (!source || typeof source !== "object") fail(`${where}: "source" must be an object.`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.repo || ""))
    fail(`${where}: source.repo must look like "owner/repository".`);
  for (const key of ["ref", "path", "build"]) {
    if (source[key] !== undefined && typeof source[key] !== "string") fail(`${where}: source.${key} must be a string.`);
  }
  if (source.path && (source.path.startsWith("/") || source.path.split(/[\\/]/).includes("..")))
    fail(`${where}: source.path must be a folder inside the repository.`);
  if (source.exclude !== undefined && !Array.isArray(source.exclude))
    fail(`${where}: source.exclude must be a list of names.`);
}

function resolveApp(app) {
  const dir = join(APPS, app.id);
  const fetched = app.source ? readSourceManifest(app) : null;
  const sourceDir = fetched ? join(SOURCES, app.id, app.source.path || ".") : null;
  const logo =
    app.logo || LOGO_NAMES.find((n) => existsSync(join(dir, n)) || (sourceDir && existsSync(join(sourceDir, n)))) || null;
  if (app.logo && !existsSync(join(dir, app.logo)) && !(sourceDir && existsSync(join(sourceDir, app.logo))))
    fail(`apps/registry.json ("${app.id}"): logo "${app.logo}" was not found in apps/${app.id}/ or the fetched source.`);
  return {
    ...app,
    dir,
    sourceDir,
    logo,
    updated: app.updated || fetched?.date?.slice(0, 7),
    integrated: Boolean(sourceDir) || existsSync(join(dir, "index.html")),
    featured: Boolean(app.featured),
    hidden: Boolean(app.hidden),
    tags: Array.isArray(app.tags) ? app.tags : [],
    returnLink: app.returnLink === false ? null : app.returnLink || "bottom-left",
  };
}

// Reads what scripts/fetch-apps.mjs left in .sources/. Missing in CI is fatal so a
// deploy can never silently swap a live app for its placeholder.
function readSourceManifest(app) {
  const manifest = join(SOURCES, `${app.id}.json`);
  const deployDir = join(SOURCES, app.id, app.source.path || ".");
  if (!existsSync(manifest) || !existsSync(join(deployDir, "index.html"))) {
    const msg = `"${app.id}" comes from ${app.source.repo} but hasn't been fetched` +
      (existsSync(manifest) ? ` (no index.html in ${app.source.path || "the repository root"})` : "") +
      ". Run: node scripts/fetch-apps.mjs";
    if (IN_CI) fail(msg);
    console.warn(`⚠ ${msg} — showing its placeholder for now.`);
    return null;
  }
  const info = readJson(manifest);
  if (info.repo !== app.source.repo || info.ref !== (app.source.ref || "main")) {
    const msg = `"${app.id}": .sources/ holds ${info.repo}@${info.ref}, but the registry asks for ${app.source.repo}@${app.source.ref || "main"}. Run: node scripts/fetch-apps.mjs`;
    if (IN_CI) fail(msg);
    console.warn(`⚠ ${msg}`);
  }
  return info;
}

function isExcluded(path, app) {
  if (isHidden(path)) return true;
  const rel = relative(app.sourceDir, path);
  if (!rel) return false;
  const top = rel.split(/[\\/]/)[0];
  return SOURCE_EXCLUDES.includes(top) || (app.source.exclude || []).includes(top);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    isHidden(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}

// ---------------------------------------------------------------- markup

function renderCard(app, i) {
  const href = `apps/${app.id}/`;
  const search = [app.name, app.description, app.category, ...app.tags].join(" ").toLowerCase();
  const updated = app.updated ? formatMonth(app.updated) : "";
  const cta = app.integrated
    ? `<span class="card__cta">Launch<span class="card__arrow" aria-hidden="true">${ARROW}</span></span>`
    : `<span class="card__cta card__cta--pending">Awaiting integration</span>`;

  return `<li class="card${app.featured ? " card--featured" : ""}${app.integrated ? "" : " card--pending"}" data-category="${esc(app.category)}" data-search="${esc(search)}" style="--i:${i}">
  <a class="card__link" href="${href}">
    <div class="card__art"${artStyle(app)}>
      ${logoMarkup(app, `apps/${app.id}/`)}
      <span class="card__index" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
    </div>
    <div class="card__body">
      <div class="card__meta">
        <span class="card__category">${esc(app.category)}</span>
        ${statusBadge(app.status)}
      </div>
      <h3 class="card__title">${esc(app.name)}</h3>
      <p class="card__desc">${esc(app.description)}</p>
      <div class="card__foot">
        ${cta}
        ${updated ? `<span class="card__updated">Updated ${updated}</span>` : ""}
      </div>
    </div>
  </a>
</li>`;
}

function renderFilters(list) {
  const counts = Object.fromEntries(config.categories.map((c) => [c, 0]));
  for (const a of list) counts[a.category]++;
  const chip = (value, label, count) =>
    `<button type="button" class="chip" data-filter="${esc(value)}" aria-pressed="${value === "all"}">${esc(label)}<span class="chip__count">${count}</span></button>`;
  return [chip("all", "All", list.length), ...config.categories.map((c) => chip(c, c, counts[c]))].join("\n");
}

function renderStatusLegend() {
  const notes = {
    available: "Complete enough to use every day.",
    "in-development": "Working, and still actively changing.",
    prototype: "An early idea, rough around the edges.",
  };
  return Object.entries(config.statuses)
    .map(([key, label]) => `<div><dt>${statusBadge(key)}</dt><dd>${esc(notes[key] || label)}</dd></div>`)
    .join("\n");
}

function renderPlaceholder(app) {
  return fill(placeholderTpl, {
    ...shared("../../"),
    TITLE: `${esc(app.name)} · Sandbox`,
    APP_NAME: esc(app.name),
    APP_DESCRIPTION: esc(app.description),
    APP_CATEGORY: esc(app.category),
    APP_STATUS: statusBadge(app.status),
    APP_ART: `<div class="placeholder__art"${artStyle(app)}>${logoMarkup(app, "")}</div>`,
    PAGE_URL: siteUrl ? esc(`${siteUrl}apps/${app.id}/`) : "",
  });
}

function logoMarkup(app, prefix) {
  if (app.logo) {
    return `<img class="art__logo${app.logoFit === "cover" ? " art__logo--cover" : ""}" src="${prefix}${esc(app.logo)}" alt="${esc(app.name)} logo" loading="lazy" decoding="async">`;
  }
  return `<span class="art__monogram" aria-hidden="true">${esc(initials(app.name))}</span>`;
}

function artStyle(app) {
  return app.logoBackground ? ` style="--art-bg:${esc(app.logoBackground)}"` : "";
}

function statusBadge(status) {
  return `<span class="status status--${status}">${esc(config.statuses[status])}</span>`;
}

// Tokens available to every Sandbox-owned page.
function shared(root) {
  return {
    ROOT: root,
    YEAR: year,
    SITE_NAME: esc(config.name),
    AUTHOR: esc(config.author),
    TAGLINE: esc(config.tagline),
    DESCRIPTION: esc(config.description),
    GITHUB_URL: esc(config.githubUrl || ""),
    OG_IMAGE: esc(`${siteUrl || root}assets/brand/og-image.png`),
    SITE_URL: esc(siteUrl),
  };
}

function render(file, tokens) {
  const path = join(OUT, file);
  writeFileSync(path, fill(read(path), { ...shared(""), PAGE_URL: esc(siteUrl), ...tokens }));
}

function injectReturnLink(file, position) {
  let html = read(file);
  if (html.includes(RETURN_MARKER)) return;
  const tag = `<script src="../../assets/js/sandbox-return.js" ${RETURN_MARKER} data-position="${position}" defer></script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tag}\n</body>`) : `${html}\n${tag}\n`;
  writeFileSync(file, html);
}

// ---------------------------------------------------------------- helpers

function fill(tpl, tokens) {
  return tpl
    // Drop meta tags whose value would be empty (e.g. og:url without SITE_URL).
    .replace(/^.*\{\{(\w+)\}\}.*$/gm, (line, key) =>
      /<(meta|link) /.test(line) && tokens[key] === "" ? "" : line
    )
    .replace(/\{\{(\w+)\}\}/g, (m, key) => (key in tokens ? tokens[key] : m));
}

function initials(name) {
  const words = name.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() : name.slice(0, 1).toUpperCase();
}

function formatMonth(value) {
  const [y, m] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function withTrailingSlash(s) {
  return s && !s.endsWith("/") ? `${s}/` : s;
}

function isHidden(path) {
  const name = path.split(/[\\/]/).pop();
  return name.startsWith(".") && name !== ".well-known";
}

function read(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(read(path));
  } catch (err) {
    fail(`Could not read ${path.replace(ROOT + "/", "")}: ${err.message}`);
  }
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
