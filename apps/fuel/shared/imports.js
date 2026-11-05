/* FUEL — the three CSV imports: roster, legacy nutrition spreadsheet, performance.

   planImport() never writes. It returns one row per source line with its status, the player it matched (and
   how), the records it would create, and any problems. commitPlan() turns a plan plus the person's decisions
   into one atomic list of writes and an import-batch record that can be rolled back.

   Matching rules (identity is never decided by a name alone):
   - an organizational Player ID matches exactly, or not at all;
   - without an ID, a same-name player is only a SUGGESTION — the row waits for a person to confirm it
     (name + date of birth, phone or affiliate agreeing makes the suggestion "likely", still not automatic);
   - performance rows must match an existing Player ID; unknown IDs are reported, never created.
   Re-running a file is safe: each record carries a fingerprint of its source content, and rows whose
   fingerprint already exists are skipped as duplicates. Nothing existing is ever overwritten. */

import { parseCSV, parseDate, parseNumber, parseBool, fingerprint, norm, clean, isISODate, uid } from "./util.js";
import { AFFILIATES, POSITIONS, METRICS, normMetric, normDefinition, RANGES, inRange, toLb, ROSTER_STATUS } from "./model.js";
import { splitLegacyNotes, parsePreseason, guessType } from "./parse.js";

/* ------------------------------------------------------------------ field catalogs */
const F = (key, label, aliases, required = false) => ({ key, label, aliases, required });
export const FIELDS = {
  roster: [
    F("external_id", "Player ID", ["player id", "player_id", "playerid", "id", "org id", "mlbam id", "mlbam", "ebis id", "astros id"]),
    F("first_name", "First name", ["first name", "first", "firstname", "given name"], true),
    F("last_name", "Last name", ["last name", "last", "lastname", "surname", "family name"], true),
    F("dob", "Date of birth", ["dob", "date of birth", "birth date", "birthdate", "born"]),
    F("position", "Position", ["position", "pos", "primary position"]),
    F("affiliate", "Affiliate", ["affiliate", "team", "level", "club", "assignment"]),
    F("bats", "Bats", ["bats", "b"]), F("throws", "Throws", ["throws", "t"]),
    F("height", "Height", ["height", "ht"]), F("listed_weight", "Listed weight (lb)", ["weight", "wt", "listed weight"]),
    F("phone", "Mobile phone", ["phone", "mobile phone", "mobile", "cell", "cell phone"]),
    F("whatsapp", "WhatsApp #", ["whatsapp", "what's app #", "whats app #", "whatsapp #", "whatsapp number", "what's app"]),
    F("status", "Roster status", ["status", "roster status"]),
  ],
  legacy: [
    F("external_id", "Player ID (if the sheet has one)", ["player id", "player_id", "id"]),
    F("last_name", "Last Name", ["last name", "last"], true), F("first_name", "First Name", ["first name", "first"], true),
    F("dob", "DOB (optional)", ["dob", "date of birth"]),
    F("position", "Position", ["position", "pos"]), F("affiliate", "Affiliate", ["affiliate", "team", "level"]),
    F("phone", "Mobile Phone", ["mobile phone", "phone", "mobile", "cell"]), F("whatsapp", "What's App #", ["what's app #", "whatsapp #", "whatsapp", "whats app #"]),
    F("weight_date", "Date of Current Weight", ["date of current weight", "weight date", "date of weight"]),
    F("weight", "Current Weight", ["current weight", "weight"]),
    F("dexa_date", "Most Recent DEXA Date", ["most recent dexa date", "dexa date"]),
    F("bf", "Most Recent DEXA BF%", ["most recent dexa bf%", "dexa bf%", "bf%", "body fat %", "body fat"]),
    F("lm", "Most Recent DEXA LM", ["most recent dexa lm", "dexa lm", "lean mass", "lm"]),
    F("fm", "Most Recent DEXA FM", ["most recent dexa fm", "dexa fm", "fat mass", "fm"]),
    F("alm", "Most Recent ALM", ["most recent alm", "alm", "appendicular lean mass"]),
    F("hydration_card", "Hydration Card?", ["hydration card?", "hydration card"]),
    F("fluid_loss", "Fluid Loss (oz) / HR", ["fluid loss (oz) / hr", "fluid loss (oz)/hr", "fluid loss", "sweat rate"]),
    F("sodium_loss", "Na Loss / HR", ["na loss / hr", "na loss/hr", "sodium loss", "na loss"]),
    F("vitamin_d", "Vitamin D Protocol?", ["vitamin d protocol?", "vitamin d protocol", "vitamin d", "vit d"]),
    F("goal_weight", "Goal Weight", ["goal weight", "target weight"]),
    F("body_comp_goal", "Body Comp Goal", ["body comp goal", "body composition goal"]),
    F("preseason", "Pre-Season Bullets", ["pre-season bullets", "preseason bullets", "pre-season bullets (goal, strengths, weakness; if nothing, put maintain if accurate)"]),
    F("history", "History", ["history"]),
    F("actions1", "Nutrition Actions", ["nutrition actions", "nutrition actions (include date & initials)"]),
    F("actions2", "Nutrition Actions Cont...", ["nutrition actions cont...", "nutrition actions cont", "nutrition actions cont... (include date & initials)"]),
    F("actions3", "Nutrition Actions Cont...2", ["nutrition actions cont...2", "nutrition actions cont2", "nutrition actions cont... (include date & initials)2"]),
    F("week5", "Week 5 Goal Check-In's", ["week 5 goal check-in's", "week 5 goal check-ins", "week 5 check-in", "week 5"]),
  ],
  performance: [
    F("player_id", "Player ID", ["player_id", "player id", "playerid", "id"], true),
    F("date", "Date", ["date", "measurement date"], true),
    F("metric", "Metric", ["metric", "measure", "type"], true),
    F("value", "Value", ["value", "mph", "velo"], true),
    F("unit", "Unit", ["unit", "units"]),
    F("definition", "Definition", ["definition", "def", "stat", "aggregation"], true),
    F("source", "Source", ["source", "system", "device"]),
    F("notes", "Notes", ["notes", "note", "comment"]),
  ],
};

const squash = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
/** propose source column for every target field (exact alias first, then loose) — the person can change it */
export function detectMapping(kind, headers) {
  const map = {}, used = new Set();
  for (const f of FIELDS[kind]) {
    const exact = headers.find((h) => !used.has(h) && f.aliases.some((a) => squash(a) === squash(h)));
    if (exact) { map[f.key] = exact; used.add(exact); }
  }
  for (const f of FIELDS[kind]) {
    if (map[f.key]) continue;
    const loose = headers.find((h) => !used.has(h) && f.aliases.some((a) => a.length > 3 && squash(h).startsWith(squash(a))));
    if (loose) { map[f.key] = loose; used.add(loose); }
  }
  return map;
}

/* ------------------------------------------------------------------ player matching */
const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
export function matchPlayer(row, players) {
  const ext = clean(row.external_id, 40).trim();
  if (ext) {
    const p = players.find((x) => x.external_id && x.external_id === ext);
    if (p) return { status: "matched", player: p, how: "Player ID" };
    const sameName = players.filter((x) => norm(x.first_name) === norm(row.first_name) && norm(x.last_name) === norm(row.last_name));
    const unlinked = sameName.filter((x) => !x.external_id);
    if (unlinked.length) return { status: "review", candidates: unlinked.map((p) => ({ player: p, why: "same name, no Player ID on file" + agreeWhy(row, p) })), proposal: "new", note: `No player has ID ${ext}; ${unlinked.length} same-name player(s) have no ID yet` };
    return { status: "new", note: sameName.length ? `Same name as ${sameName.length} player(s) with a different Player ID — kept separate` : "" };
  }
  const sameName = players.filter((x) => norm(x.first_name) === norm(row.first_name) && norm(x.last_name) === norm(row.last_name));
  if (!sameName.length) return { status: "new" };
  const ranked = sameName.map((p) => ({ player: p, score: agree(row, p), why: "same name" + agreeWhy(row, p) })).sort((a, b) => b.score - a.score);
  return { status: "review", candidates: ranked, proposal: ranked.length === 1 && ranked[0].score >= 1 ? ranked[0].player.id : null,
    note: ranked.length > 1 ? `${ranked.length} players share this name` : ranked[0].score >= 1 ? "Likely the same player — confirm" : "Same name only — confirm or create a new player" };
}
function agree(row, p) {
  let s = 0;
  if (row.dob && p.dob && parseDate(row.dob) === p.dob) s += 2;
  if (row.dob && p.dob && parseDate(row.dob) && parseDate(row.dob) !== p.dob) s -= 5;
  if (digits(row.phone) && digits(row.phone) === digits(p.phone)) s += 2;
  if (row.position && p.position && row.position.toUpperCase() === p.position) s += 0.5;
  if (row.affiliate && p.affiliate && norm(row.affiliate) === norm(p.affiliate)) s += 0.5;
  return s;
}
function agreeWhy(row, p) {
  const w = [];
  if (row.dob && p.dob && parseDate(row.dob) === p.dob) w.push("DOB matches");
  if (row.dob && p.dob && parseDate(row.dob) && parseDate(row.dob) !== p.dob) w.push("DOB DIFFERS");
  if (digits(row.phone) && digits(row.phone) === digits(p.phone)) w.push("phone matches");
  if (row.affiliate && p.affiliate && norm(row.affiliate) === norm(p.affiliate)) w.push("affiliate matches");
  if (row.position && p.position && row.position.toUpperCase() === p.position) w.push("position matches");
  return w.length ? " · " + w.join(", ") : "";
}

/* ------------------------------------------------------------------ helpers */
const pick = (raw, mapping) => { const o = { __line: raw.__line }; for (const [k, h] of Object.entries(mapping || {})) if (h) o[k] = raw[h] != null ? String(raw[h]).trim() : ""; return o; };
const normAffiliate = (s) => { const t = String(s || "").trim(); if (!t) return null; const hit = AFFILIATES.find((a) => norm(a) === norm(t) || norm(t).includes(norm(a))); return hit || t; };
const normPos = (s) => { const t = String(s || "").trim().toUpperCase(); if (!t) return null; return t === "P" ? "RHP" : t; };
const normStatus = (s) => { const t = String(s || "").trim().toLowerCase(); if (!t) return null; return ROSTER_STATUS.find((x) => t.startsWith(x.slice(0, 4))) || (/il|inj/.test(t) ? "injured" : null); };

/* ------------------------------------------------------------------ plan */
/** @param ctx {players, fingerprints:Set, performance:[...], today} */
export function planImport(kind, csvText, mapping, options, ctx) {
  const parsed = parseCSV(csvText);
  const out = { kind, headers: parsed.headers, errors: parsed.errors.slice(), rows: [], summary: {} };
  if (!FIELDS[kind]) { out.errors.push("Unknown import type."); return out; }
  if (!parsed.headers.length) return out;
  mapping = mapping && Object.keys(mapping).length ? mapping : detectMapping(kind, parsed.headers);
  out.mapping = mapping;
  const missing = FIELDS[kind].filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  if (missing.length) { out.errors.push(`Map these required columns first: ${missing.join(", ")}.`); return out; }
  const fps = new Set(ctx.fingerprints || []);
  const seenInFile = new Map();
  for (const raw of parsed.rows) {
    const r = pick(raw, mapping);
    const row = kind === "roster" ? planRoster(r, ctx, seenInFile, options) : kind === "legacy" ? planLegacy(r, ctx, seenInFile, options) : planPerformance(r, ctx, seenInFile, fps, options);
    if (raw.__extra) row.issues.push({ level: "warn", text: "This row has more cells than there are headings — extra cells ignored." });
    row.raw = Object.fromEntries(parsed.headers.filter(Boolean).map((h) => [h, raw[h]]));
    if (kind !== "performance") for (const rec of row.records || []) if (rec.fp && fps.has(rec.fp)) rec.duplicate = true;
    if (row.records && row.records.length && row.records.every((x) => x.duplicate) && row.status !== "error") row.status = row.status === "review" ? "review" : row.player_action === "update" && row.changes && Object.keys(row.changes).length ? row.status : "duplicate";
    out.rows.push(row);
  }
  const c = {};
  for (const r of out.rows) c[r.status] = (c[r.status] || 0) + 1;
  out.summary = { rows: out.rows.length, ...c, records: out.rows.reduce((n, r) => n + (r.records || []).filter((x) => !x.duplicate).length, 0) };
  return out;
}

function planRoster(r, ctx, seen, options) {
  const row = { line: r.__line, issues: [], records: [], label: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(no name)` " };
  row.label = `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(no name)";
  if (!r.first_name || !r.last_name) { row.status = "error"; row.issues.push({ level: "error", text: "First and last name are required." }); return row; }
  const dob = r.dob ? parseDate(r.dob) : null;
  if (r.dob && !dob) row.issues.push({ level: "error", text: `Date of birth "${r.dob}" isn't a date (use YYYY-MM-DD or M/D/YYYY).` });
  const lw = r.listed_weight ? parseNumber(r.listed_weight) : null;
  if (r.listed_weight && !inRange(lw, RANGES.weight_lb)) row.issues.push({ level: "error", text: `Listed weight "${r.listed_weight}" isn't a plausible weight in lb.` });
  const status = r.status ? normStatus(r.status) : null;
  if (r.status && !status) row.issues.push({ level: "warn", text: `Roster status "${r.status}" not recognized — left unchanged.` });
  if (r.external_id) {
    if (seen.has("id:" + r.external_id)) { row.status = "error"; row.issues.push({ level: "error", text: `Player ID ${r.external_id} appears twice in this file (line ${seen.get("id:" + r.external_id)}).` }); return row; }
    seen.set("id:" + r.external_id, r.__line);
  }
  if (row.issues.some((i) => i.level === "error")) { row.status = "error"; return row; }
  const fields = { external_id: clean(r.external_id, 40) || null, first_name: clean(r.first_name, 60), last_name: clean(r.last_name, 60), dob, position: normPos(r.position),
    bats: r.bats ? r.bats.toUpperCase().slice(0, 1) : null, throws: r.throws ? r.throws.toUpperCase().slice(0, 1) : null, height: clean(r.height, 12) || null,
    listed_weight: lw, phone: clean(r.phone, 30) || null, whatsapp: clean(r.whatsapp, 30) || null, status };
  const affiliate = normAffiliate(r.affiliate);
  if (affiliate && !AFFILIATES.includes(affiliate)) row.issues.push({ level: "warn", text: `Affiliate "${affiliate}" isn't one of FUEL's affiliates — kept as written.` });
  const m = matchPlayer(fields, ctx.players);
  row.match = m;
  row.fields = fields; row.affiliate = affiliate;
  if (m.status === "matched") {
    const p = m.player, changes = {};
    for (const [k, v] of Object.entries(fields)) if (v != null && v !== "" && k !== "external_id" && p[k] !== v) changes[k] = { from: p[k] ?? null, to: v };
    if (affiliate && affiliate !== p.affiliate) changes.affiliate = { from: p.affiliate || null, to: affiliate };
    row.player_id = p.id; row.changes = changes; row.player_action = "update";
    row.status = Object.keys(changes).length ? "update" : "duplicate";
    if (!Object.keys(changes).length) row.issues.push({ level: "info", text: "Already up to date — nothing to change." });
  } else if (m.status === "review") { row.status = "review"; row.player_action = "review"; row.changes = {}; }
  else { row.status = "new"; row.player_action = "create"; if (m.note) row.issues.push({ level: "warn", text: m.note }); }
  return row;
}

function planLegacy(r, ctx, seen, options) {
  const o = options || {};
  const unit = o.massUnit === "kg" ? "kg" : "lb";
  const year = o.year ? +o.year : null;
  const row = { line: r.__line, issues: [], records: [], label: `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(no name)" };
  if (!r.first_name || !r.last_name) { row.status = "error"; row.issues.push({ level: "error", text: "First and last name are required." }); return row; }
  const fields = { external_id: clean(r.external_id, 40) || null, first_name: clean(r.first_name, 60), last_name: clean(r.last_name, 60), dob: parseDate(r.dob) || null,
    position: normPos(r.position), phone: clean(r.phone, 30) || null, whatsapp: clean(r.whatsapp, 30) || null };
  const affiliate = normAffiliate(r.affiliate);
  const key = "nm:" + norm(fields.first_name + " " + fields.last_name) + "|" + (fields.external_id || "") + "|" + (fields.dob || "");
  if (seen.has(key)) row.issues.push({ level: "warn", text: `Same player as line ${seen.get(key)} — its records are added too; confirm both rows refer to him.` });
  seen.set(key, r.__line);
  const src = (column) => ({ kind: "legacy", column, line: r.__line });
  const date = (raw, label) => {
    if (!raw) return null;
    const d = parseDate(raw, year);
    if (!d) row.issues.push({ level: "warn", text: `${label} "${raw}" isn't a full date — kept as "date unknown".` });
    return d;
  };
  const tag = "pending"; // the player id is filled in at commit, once the match is confirmed
  // weight
  if (r.weight) {
    const v = parseNumber(r.weight);
    const lb = toLb(v, unit);
    if (!inRange(lb, RANGES.weight_lb)) row.issues.push({ level: "error", text: `Current Weight "${r.weight}" isn't a plausible weight.` });
    else row.records.push({ table: "weights", date: date(r.weight_date, "Date of Current Weight"), weight: v, unit, note: null, source: src("Current Weight"), raw: { weight: r.weight, date: r.weight_date || "" } });
  }
  // DEXA
  if (r.bf || r.lm || r.fm || r.alm) {
    const bf = r.bf ? parseNumber(r.bf) : null, lm = r.lm ? parseNumber(r.lm) : null, fm = r.fm ? parseNumber(r.fm) : null, alm = r.alm ? parseNumber(r.alm) : null;
    const bad = [];
    if (r.bf && !inRange(bf, RANGES.bf_pct)) bad.push(`BF% "${r.bf}"`);
    for (const [k, v, raw] of [["LM", lm, r.lm], ["FM", fm, r.fm], ["ALM", alm, r.alm]]) if (raw && !inRange(toLb(v, unit), RANGES.mass_lb)) bad.push(`${k} "${raw}"`);
    if (bad.length) row.issues.push({ level: "error", text: `DEXA values not plausible: ${bad.join(", ")}.` });
    else row.records.push({ table: "dexa", date: date(r.dexa_date, "Most Recent DEXA Date"), body_fat_pct: bf, lean_mass: lm, fat_mass: fm, alm, unit, source: src("Most Recent DEXA"), raw: { bf: r.bf, lm: r.lm, fm: r.fm, alm: r.alm, date: r.dexa_date || "" } });
  }
  // hydration
  if (r.hydration_card || r.fluid_loss || r.sodium_loss) {
    const card = parseBool(r.hydration_card);
    const fl = r.fluid_loss ? parseNumber(r.fluid_loss) : null, na = r.sodium_loss ? parseNumber(r.sodium_loss) : null;
    if (r.fluid_loss && !inRange(fl, RANGES.fluid_oz_hr)) row.issues.push({ level: "error", text: `Fluid loss "${r.fluid_loss}" isn't a number of oz/hr.` });
    else if (r.sodium_loss && !inRange(na, RANGES.sodium_mg_hr)) row.issues.push({ level: "error", text: `Na loss "${r.sodium_loss}" isn't a number of mg/hr.` });
    else row.records.push({ table: "hydration", date: null, hydration_card: card, hydration_card_text: card == null ? clean(r.hydration_card, 200) || null : null,
      fluid_loss_oz_hr: fl, sodium_loss_mg_hr: na, source: src("Hydration"), raw: { card: r.hydration_card, fluid: r.fluid_loss, na: r.sodium_loss } });
  }
  if (r.vitamin_d) {
    const b = parseBool(r.vitamin_d);
    row.records.push({ table: "protocols", type: "vitamin_d", active: b, details: b == null ? clean(r.vitamin_d, 1000) : null, date: null, source: src("Vitamin D Protocol?"), raw: { value: r.vitamin_d } });
  }
  // goals
  if (r.goal_weight) {
    const v = parseNumber(r.goal_weight);
    if (!inRange(toLb(v, unit), RANGES.weight_lb)) row.issues.push({ level: "warn", text: `Goal Weight "${r.goal_weight}" isn't a number — kept as a text goal.` });
    row.records.push({ table: "goals", type: "weight", description: inRange(toLb(v, unit), RANGES.weight_lb) ? `Goal weight ${v} ${unit}` : clean(r.goal_weight, 500), target_value: inRange(toLb(v, unit), RANGES.weight_lb) ? v : null, target_unit: unit, status: "active", start_date: null, source: src("Goal Weight"), raw: { value: r.goal_weight } });
  }
  if (r.body_comp_goal) row.records.push({ table: "goals", type: "body_comp", description: clean(r.body_comp_goal, 1000), status: "active", start_date: null, source: src("Body Comp Goal"), raw: { value: r.body_comp_goal } });
  for (const part of parsePreseason(r.preseason)) row.records.push({ table: "goals", type: part.type, description: part.description, status: "active", start_date: null, source: src("Pre-Season Bullets"), raw: { value: r.preseason } });
  // notes
  if (r.history) row.records.push({ table: "interactions", type: "history", date: null, text: clean(r.history), author: null, author_initials: null, source: src("History"), raw: { value: r.history } });
  for (const [col, label] of [["actions1", "Nutrition Actions"], ["actions2", "Nutrition Actions Cont..."], ["actions3", "Nutrition Actions Cont...2"]]) {
    const parts = splitLegacyNotes(r[col], { year });
    for (const p of parts) {
      row.records.push({ table: "interactions", type: guessType(p.text), date: p.date, text: p.original, summary: p.text, author: null, author_initials: p.initials, date_unknown: p.dateUnknown, date_text: p.dateText,
        source: src(label), raw: { value: r[col] } });
    }
    if (parts.some((p) => p.dateUnknown && p.dateText)) row.issues.push({ level: "warn", text: `${label}: some dates have no year${year ? "" : " — choose the season year above to date them, or keep them as date unknown"}.` });
  }
  if (r.week5) row.records.push({ table: "interactions", type: "check_in", date: null, text: clean(r.week5), title: "Week 5 goal check-in", author: null, source: src("Week 5 Goal Check-In's"), raw: { value: r.week5 } });
  // fingerprints are computed once the player is known; a provisional one uses the name so the preview can flag repeats
  const m = matchPlayer(fields, ctx.players);
  row.match = m; row.fields = fields; row.affiliate = affiliate;
  if (m.status === "matched") { row.player_id = m.player.id; row.status = "new"; row.player_action = "existing"; }
  else if (m.status === "review") { row.status = "review"; row.player_action = "review"; }
  else { row.status = "new"; row.player_action = "create"; }
  for (const rec of row.records) if (row.player_id) rec.fp = recordFingerprint(row.player_id, rec);
  if (row.issues.some((i) => i.level === "error")) row.status = row.records.length ? row.status : "error";
  if (!row.records.length && row.status !== "error") row.issues.push({ level: "info", text: "No measurements or notes in this row — only the player details." });
  return row;
}

function planPerformance(r, ctx, seen, fps, options) {
  const row = { line: r.__line, issues: [], records: [], label: r.player_id || "(no ID)" };
  const err = (t) => row.issues.push({ level: "error", text: t });
  const pid = String(r.player_id || "").trim();
  const p = pid ? ctx.players.find((x) => x.external_id === pid || x.id === pid) : null;
  if (!pid) err("Player ID is required.");
  else if (!p) err(`Unknown Player ID ${pid} — import the roster first (performance rows never create players).`);
  const date = parseDate(r.date);
  if (!date) err(`Date "${r.date}" isn't a date (use YYYY-MM-DD).`);
  else if (ctx.today && date > ctx.today) err(`Date ${date} is in the future.`);
  const metric = normMetric(r.metric);
  if (!metric) err(`Metric "${r.metric}" isn't one of: bat_speed, exit_velocity, pitch_velocity.`);
  const value = parseNumber(r.value);
  if (value == null || /[a-z]/i.test(String(r.value).replace(/mph/i, ""))) err(`Value "${r.value}" isn't a number.`);
  else if (metric && !inRange(value, METRICS[metric].range)) err(`Value ${value} mph is outside the plausible range for ${METRICS[metric].label} (${METRICS[metric].range.join("–")}).`);
  const unit = String(r.unit || "mph").trim().toLowerCase();
  if (unit !== "mph") err(`Unit "${r.unit}" — FUEL stores these metrics in mph only.`);
  const def = metric ? normDefinition(metric, r.definition) : null;
  if (metric && !def) err(`Definition "${r.definition || ""}" isn't recognized for ${METRICS[metric].label} (use: ${Object.keys(METRICS[metric].definitions).join(", ")}).`);
  if (p) row.label = `${p.first_name} ${p.last_name} (${pid})`;
  if (row.issues.length) { row.status = "error"; return row; }
  const rec = { table: "performance", player_id: p.id, date, metric, value, unit: "mph", definition: def, source_label: clean(r.source, 80) || null, notes: clean(r.notes, 1000) || null, source: { kind: "performance", line: r.__line } };
  rec.fp = recordFingerprint(p.id, rec);
  const k = [p.id, date, metric, def].join("|");
  if (seen.has(k)) { row.status = seen.get(k).value === value ? "duplicate" : "review"; row.issues.push({ level: row.status === "duplicate" ? "info" : "warn", text: `Same player, date, metric and definition as line ${seen.get(k).line}${seen.get(k).value === value ? "" : " with a different value"}.` }); }
  seen.set(k, { line: r.__line, value });
  const existing = (ctx.performance || []).filter((x) => !x.voided && x.player_id === p.id && x.date === date && x.metric === metric && x.definition === def);
  if (fps.has(rec.fp) || existing.some((x) => x.value === value)) { row.status = "duplicate"; rec.duplicate = true; row.issues.push({ level: "info", text: "Already in FUEL — skipped." }); }
  else if (existing.length && row.status !== "duplicate") { row.status = "review"; row.issues.push({ level: "warn", text: `FUEL already has ${existing.map((x) => x.value).join(", ")} mph for this date and definition. Keep both, or skip this row — the existing value is never replaced.` }); }
  row.player_id = p.id; row.records.push(rec);
  row.status = row.status || "new";
  return row;
}

export function recordFingerprint(playerId, rec) {
  switch (rec.table) {
    case "weights": return fingerprint("w", playerId, rec.date, rec.weight, rec.unit);
    case "dexa": return fingerprint("d", playerId, rec.date, rec.body_fat_pct, rec.lean_mass, rec.fat_mass, rec.alm);
    case "hydration": return fingerprint("h", playerId, rec.date, rec.hydration_card, rec.hydration_card_text, rec.fluid_loss_oz_hr, rec.sodium_loss_mg_hr);
    case "protocols": return fingerprint("p", playerId, rec.type, rec.active, rec.details);
    case "goals": return fingerprint("g", playerId, rec.type, norm(rec.description), rec.target_value);
    case "interactions": return fingerprint("i", playerId, rec.date, norm(rec.text), rec.source && rec.source.column);
    case "performance": return fingerprint("pf", playerId, rec.date, rec.metric, rec.definition, rec.value);
    default: return fingerprint(rec.table, playerId, JSON.stringify(rec));
  }
}

/* ------------------------------------------------------------------ commit */
/** decisions: { [line]: { action: "link", player_id } | { action: "new" } | { action: "skip" } | { action: "keep" } }
    Returns { ops, batch, counts } — ops are applied atomically by the store. */
export function commitPlan(plan, decisions, ctx, meta) {
  const now = meta.now, user = meta.user;
  const batchId = uid("im_");
  const ops = [], created = [], updated = [];
  const counts = { players_created: 0, players_updated: 0, records: 0, skipped: 0, errors: 0, duplicates: 0 };
  const byId = new Map(ctx.players.map((p) => [p.id, p]));
  const fps = new Set(ctx.fingerprints || []);
  const put = (table, row, before) => { ops.push({ put: table, row }); (before ? updated : created).push(before ? { table, id: row.id, before } : { table, id: row.id }); };
  const base = (extra) => ({ created_at: now, updated_at: now, created_by: user, import_batch: batchId, ...extra });
  for (const row of plan.rows) {
    const d = (decisions || {})[row.line] || {};
    if (row.status === "error" && !(row.records || []).length) { counts.errors++; continue; }
    if (d.action === "skip") { counts.skipped++; continue; }
    let pid = row.player_id || null;
    if (plan.kind !== "performance") {
      if (row.player_action === "review") {
        if (d.action === "link" && d.player_id && byId.has(d.player_id)) pid = d.player_id;
        else if (d.action === "new") pid = null;
        else { counts.skipped++; continue; } // undecided rows are never guessed
      }
      if (!pid) {
        const p = { id: uid("pl_"), ...row.fields, affiliate: row.affiliate || null, status: row.fields.status || "active", ...base({}) };
        for (const k of Object.keys(p)) if (p[k] === undefined) p[k] = null;
        put("players", p); byId.set(p.id, p); pid = p.id; counts.players_created++;
        if (p.affiliate) put("assignments", { id: uid("as_"), player_id: pid, affiliate: p.affiliate, start_date: meta.today, end_date: null, source: plan.kind, ...base({}) });
      } else if (plan.kind === "roster" && row.changes && Object.keys(row.changes).length) {
        const p0 = byId.get(pid), p = { ...p0 };
        for (const [k, c] of Object.entries(row.changes)) p[k] = c.to;
        if (!p0.external_id && row.fields.external_id) p.external_id = row.fields.external_id;
        p.updated_at = now; p.updated_by = user;
        put("players", p, p0); byId.set(pid, p); counts.players_updated++;
        if (row.changes.affiliate) affiliateChange(ctx, ops, created, updated, pid, row.changes.affiliate.to, meta, batchId, "roster");
      } else if (plan.kind === "roster" && d.action === "link" && row.fields.external_id && !byId.get(pid).external_id) {
        const p0 = byId.get(pid), p = { ...p0, external_id: row.fields.external_id, updated_at: now, updated_by: user };
        put("players", p, p0); byId.set(pid, p); counts.players_updated++;
      }
    }
    if (plan.kind === "performance" && row.status === "review" && d.action !== "keep") { counts.skipped++; continue; }
    if (plan.kind === "performance" && row.status === "duplicate") { counts.duplicates++; continue; }
    for (const rec of row.records || []) {
      const r = { ...rec };
      delete r.table; delete r.duplicate;
      r.player_id = pid;
      r.fp = recordFingerprint(pid, rec);
      if (fps.has(r.fp)) { counts.duplicates++; continue; }
      fps.add(r.fp);
      r.id = uid(rec.table.slice(0, 2) + "_");
      r.source = { ...(rec.source || {}), batch: batchId };
      if (rec.table === "interactions") { r.entry_date = meta.today; r.history = []; }
      if (rec.table === "weights" || rec.table === "dexa") r.entry_date = meta.today;
      Object.assign(r, base({}));
      put(rec.table, r); counts.records++;
    }
  }
  const batch = { id: batchId, kind: plan.kind, filename: meta.filename || null, created_at: now, created_by: user, status: "committed", counts, created, updated,
    source_rows: plan.rows.map((r) => ({ line: r.line, status: r.status, raw: r.raw })), options: meta.options || {} };
  ops.push({ put: "imports", row: batch });
  return { ops, batch, counts };
}

/** Affiliate change: close the current assignment, open a new one. History is never rewritten. */
export function affiliateChange(ctx, ops, created, updated, playerId, affiliate, meta, batchId, source) {
  const open = (ctx.assignments || []).filter((a) => a.player_id === playerId && !a.end_date);
  for (const a of open) { const b = { ...a, end_date: meta.today, updated_at: meta.now }; ops.push({ put: "assignments", row: b }); updated && updated.push({ table: "assignments", id: a.id, before: a }); }
  const n = { id: uid("as_"), player_id: playerId, affiliate, start_date: meta.today, end_date: null, source, created_at: meta.now, updated_at: meta.now, created_by: meta.user, import_batch: batchId || null };
  ops.push({ put: "assignments", row: n }); created && created.push({ table: "assignments", id: n.id });
}

/** Undo a batch: delete what it created and restore what it changed — refused if staff have since built on it. */
export function planRollback(batch, current) {
  if (batch.status !== "committed") return { ok: false, reason: "This import was already rolled back." };
  const problems = [];
  const createdPlayers = new Set(batch.created.filter((c) => c.table === "players").map((c) => c.id));
  const createdIds = new Set(batch.created.map((c) => c.id));
  for (const [table, rows] of Object.entries(current)) {
    for (const row of rows) {
      if (createdIds.has(row.id) && row.updated_at && row.updated_at !== row.created_at) problems.push(`${table} ${row.id} was edited after the import`);
      if (row.player_id && createdPlayers.has(row.player_id) && !createdIds.has(row.id)) problems.push(`staff added ${table} records to a player this import created`);
    }
  }
  if (problems.length) return { ok: false, reason: "Can't roll back safely: " + [...new Set(problems)].slice(0, 4).join("; ") + "." };
  // newest first, so records go before the players they belong to (foreign keys)
  const ops = batch.created.slice().reverse().map((c) => ({ del: c.table, id: c.id })).concat(batch.updated.slice().reverse().map((u) => ({ put: u.table, row: u.before })));
  return { ok: true, ops };
}
