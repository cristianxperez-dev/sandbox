/* NMSBSBL test server: a local HTTP server that runs every request through the REAL access gate
   (access-gate/app-gate.js + PROTECTED_APPS) and the REAL data functions (functions/apps/nmsbsbl/api/*), with test
   secrets — the same chain as Cloudflare Pages Functions. Static files come from _site/ (node scripts/build.mjs).
   Upstream (MLB Stats API, Baseball Savant) is real public data, cached in memory for the run.
   Open http://localhost:<port>/apps/nmsbsbl/ (localhost, so the gate's Secure cookie is accepted). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const ROOT = path.join(__dirname, "../..");
const SITE = path.join(ROOT, "_site");
const ENV = { SANDBOX_SESSION_SECRET: "test-session-secret-0123456789-abcdefghijklmnop", NMSBSBL_ACCESS_CODE: "Test-Code-Slider-42" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webp": "image/webp" };

const upstream = new Map();
function cacheUpstream() {
  if (globalThis.__nmsFetch) return;
  globalThis.__nmsFetch = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (/statsapi\.mlb\.com|baseballsavant\.mlb\.com/.test(url)) {
      if (!upstream.has(url)) upstream.set(url, realFetch(url, init).then(async (r) => ({ status: r.status, body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") })));
      const u = await upstream.get(url);
      return new Response(u.body, { status: u.status, headers: { "content-type": u.type || "" } });
    }
    return realFetch(input, init);
  };
}
async function start(opts = {}) {
  const env = Object.assign({}, ENV, opts.env || {});
  const { createGate } = await import(pathToFileURL(path.join(ROOT, "access-gate/app-gate.js")).href);
  const { PROTECTED_APPS } = await import(pathToFileURL(path.join(ROOT, "access-gate/apps.js")).href);
  const api = {};
  for (const n of ["roster", "pitcher", "pitches"]) api[n] = await import(pathToFileURL(path.join(ROOT, `functions/apps/nmsbsbl/api/${n}.js`)).href);
  cacheUpstream();
  const gate = createGate(PROTECTED_APPS, { failureDelayMs: 0 });
  const calls = { api: [] };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      headers.set("CF-Connecting-IP", "127.0.0.1");
      const request = new Request(url.href, { method: req.method, headers, body: chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined });
      const next = async () => {
        const m = /^\/apps\/nmsbsbl\/api\/(roster|pitcher|pitches)$/.exec(url.pathname);
        if (m) { calls.api.push(url.pathname + url.search); return request.method === "GET" ? api[m[1]].onRequestGet({ request, env }) : api[m[1]].onRequest({ request, env }); }
        let file = path.join(SITE, decodeURIComponent(url.pathname));
        if (!file.startsWith(SITE)) return new Response("no", { status: 400 });
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
        if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
        return new Response(fs.readFileSync(file), { headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" } });
      };
      const r = await gate({ request, env, next });
      const out = {}; r.headers.forEach((v, k) => { if (k !== "set-cookie") out[k] = v; });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")] : []);
      if (sc.length) out["set-cookie"] = sc;
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack)); }
  });
  await new Promise((ok) => server.listen(opts.port || 0, "127.0.0.1", ok));
  const port = server.address().port;
  return { env, port, base: `http://localhost:${port}/apps/nmsbsbl/`, calls, close: () => new Promise((ok) => server.close(ok)) };
}
module.exports = { start, ENV };
