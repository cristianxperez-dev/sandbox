/* FUEL — small shared utilities: ISO dates, CSV, ids, numbers. No dependencies; runs in the browser and in the
   Cloudflare Pages Function. All dates are ISO calendar dates ("YYYY-MM-DD") with no time zone; timestamps are ISO
   instants ("…Z"). */

export const DAY = 86400000;

export function isISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export const toDays = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY);
export const fromDays = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromDays(toDays(iso) + n);
export const daysBetween = (a, b) => toDays(b) - toDays(a);
export const weekday = (iso) => new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = Sunday
export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** today's calendar date where the user is (the browser passes it; the server uses UTC unless told) */
export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function ageOn(dob, onIso) {
  if (!isISODate(dob) || !isISODate(onIso)) return null;
  const [y1, m1, d1] = dob.split("-").map(Number), [y2, m2, d2] = onIso.split("-").map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

/** Parse a date written by a person: ISO, m/d/yyyy, m/d/yy, m-d-yyyy, "Mar 4 2026". Returns ISO or null.
    A date without a year returns null unless `year` is supplied — a missing year is never guessed. */
export function parseDate(raw, year = null) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (isISODate(s)) return s;
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) {
    let y = m[3] ? +m[3] : year;
    if (y == null) return null;
    if (y < 100) y += 2000;
    return mk(y, +m[1], +m[2]);
  }
  m = s.toLowerCase().match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3)));
    const y = m[3] ? +m[3] : year;
    if (mi < 0 || y == null) return null;
    return mk(y, mi + 1, +m[2]);
  }
  // spreadsheet serial date (Excel 1900 system), only within a plausible range
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(+s);
    if (n > 30000 && n < 60000) return fromDays(n - 25569);
  }
  return null;
}
function mk(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

/** Numbers as people write them in spreadsheets: "197.4", "197.4 lb", "12.5%", " 1,200 ". Null if not a number. */
export function parseNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(/,/g, "");
  const m = s.match(/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!m || !/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?\s*(?:%|[a-z#/ .]*)?$/i.test(s)) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parseBool(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|x|✓|done|on)$/.test(s)) return true;
  if (/^(n|no|false|0|none|off)$/.test(s)) return false;
  return null; // anything else is kept as text by the caller, never forced into yes/no
}

/* ------------------------------------------------------------------ CSV */
/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF/LF, BOM). Returns { headers, rows, errors }. */
export function parseCSV(text, { maxRows = 20000 } = {}) {
  const errors = [];
  if (typeof text !== "string") return { headers: [], rows: [], errors: ["The file isn't text."] };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (/\u0000/.test(text)) return { headers: [], rows: [], errors: ["The file looks binary — save the spreadsheet as CSV (UTF-8) and try again."] };
  const out = [];
  let row = [], field = "", q = false, i = 0, line = 1;
  const delim = guessDelimiter(text);
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      if (c === "\n") line++;
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { q = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); out.push(row); row = []; field = ""; i++; line++; if (out.length > maxRows + 1) break; continue; }
    field += c; i++;
  }
  if (q) errors.push(`An opening quote on or before line ${line} is never closed — the rest of the file was read as one field.`);
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  const nonEmpty = out.filter((r) => r.some((x) => String(x).trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [], errors: errors.concat(["The file is empty."]) };
  const headers = nonEmpty[0].map((h) => String(h).trim());
  if (new Set(headers.filter(Boolean).map((h) => h.toLowerCase())).size !== headers.filter(Boolean).length) errors.push("Two columns have the same heading — rename one so they can be told apart.");
  const rows = nonEmpty.slice(1).map((r, k) => {
    const o = { __line: k + 2 };
    headers.forEach((h, j) => { if (h) o[h] = r[j] != null ? String(r[j]).trim() : ""; });
    if (r.length > headers.length && r.slice(headers.length).some((x) => String(x).trim())) o.__extra = true;
    return o;
  });
  if (rows.length > maxRows) errors.push(`Only the first ${maxRows} rows can be imported at once.`);
  return { headers, rows: rows.slice(0, maxRows), errors };
}
function guessDelimiter(text) {
  const first = text.slice(0, text.indexOf("\n") > 0 ? text.indexOf("\n") : 2000);
  const c = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : ",";
}

export function toCSV(columns, rows) {
  const cell = (v) => {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => cell(c.label || c.key)).join(","), ...rows.map((r) => columns.map((c) => cell(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))].join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ ids and hashing */
export function uid(prefix = "") {
  const b = new Uint8Array(10);
  (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
  return prefix + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
/** a short deterministic fingerprint (FNV-1a, 2×32 bit) — used to recognize a row already imported */
export function fingerprint(...parts) {
  const s = parts.map((p) => (p == null ? "∅" : String(p))).join("␟");
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
export const clean = (s, max = 20000) => (s == null ? "" : String(s).replace(/\u0000/g, "").slice(0, max));
