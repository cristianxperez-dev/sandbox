#!/usr/bin/env node
// Serves _site/ locally the way GitHub Pages does: trailing-slash redirects
// for folders, index.html resolution, and 404.html for anything missing.
//
//   npm run serve                     → http://localhost:4173/          (cperez.app layout)
//   BASE_PATH=/sandbox/ npm run serve → http://localhost:4173/sandbox/  (GitHub Pages project path)
//   PORT=8080 npm run serve
//
// Build with the same BASE_PATH you serve with, so 404.html links line up:
//   BASE_PATH=/sandbox/ npm run dev

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "_site");
const PORT = Number(process.env.PORT || 4173);
let BASE = process.env.BASE_PATH || "/";
if (!BASE.endsWith("/")) BASE += "/";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml", ".mp4": "video/mp4", ".pdf": "application/pdf",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);

  if (path === BASE.slice(0, -1)) return redirect(res, BASE + url.search);
  if (!path.startsWith(BASE)) return notFound(res);

  const rel = normalize(path.slice(BASE.length)).replace(/^(\.\.[/\\])+/, "");
  let file = join(OUT, rel);
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!path.endsWith("/")) return redirect(res, path + "/" + url.search);
      file = join(file, "index.html");
      info = await stat(file);
    }
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch {
    notFound(res);
  }
}).listen(PORT, () => console.log(`Sandbox → http://localhost:${PORT}${BASE}`));

function redirect(res, location) {
  res.writeHead(301, { location });
  res.end();
}

async function notFound(res) {
  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end(await readFile(join(OUT, "404.html")).catch(() => "Not found"));
}
