/* FUEL — request handlers. The same code serves the browser demo (store = IndexedDB, user = the demo role)
   and the secure server (store = Cloudflare D1, user = the Access-verified email and its configured role).

   Authorization happens HERE, on every request, from ctx.user.role — never from anything the client sends.
   Responses are redacted to the role: contact details, hydration and protocol records, and nutrition notes
   are removed for roles that may not see them. Every write is a single atomic store.commit() that also
   writes an audit event. */

import { TABLES, can, permissions, ROLES, AFFILIATES, POSITIONS, INTERACTION_TYPES, GOAL_TYPES, GOAL_STATUS, PRIORITIES, METRICS, RANGES, inRange, toLb,
  normDefinition, ROSTER_STATUS, isPitcher } from "./model.js";
import { isISODate, addDays, daysBetween, ageOn, uid, clean, round, toCSV, parseNumber } from "./util.js";
import { planImport, commitPlan, planRollback, affiliateChange, recordFingerprint, FIELDS, detectMapping } from "./imports.js";

export class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || "error"; } }
const bad = (m) => new HttpError(400, m, "invalid");
const fail = (m) => { throw bad(m); };
const deny = (m = "Your role doesn't allow this.") => new HttpError(403, m, "forbidden");
const need = (ctx, perm) => { if (!can(ctx.user.role, perm)) throw deny(); };

const live = (r) => !r.voided && !r.deleted;
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
const name = (p) => (p ? `${p.first_name} ${p.last_name}` : "(unknown player)");

/* ------------------------------------------------------------------ redaction */
function redactPlayer(p, role) {
  if (!p) return p;
  const o = { ...p };
  if (!can(role, "read_contact")) { delete o.phone; delete o.whatsapp; }
  return o;
}

/* ------------------------------------------------------------------ entry point */
export async function handle(req, ctx) {
  const { method, path } = req;
  const q = req.params || new URLSearchParams();
  const body = req.body || {};
  if (!ctx.user || !ROLES[ctx.user.role]) throw new HttpError(401, "Not signed in.", "unauthorized");
  need(ctx, "read");
  const route = `${method} ${path}`;
  switch (route) {
    case "GET session": return { user: ctx.user, mode: ctx.mode, permissions: permissions(ctx.user.role), today: ctx.today,
      vocab: { affiliates: AFFILIATES, positions: POSITIONS, interactionTypes: INTERACTION_TYPES, goalTypes: GOAL_TYPES, goalStatus: GOAL_STATUS, priorities: PRIORITIES, metrics: METRICS, rosterStatus: ROSTER_STATUS, roles: ROLES } };
    case "GET staff": return (await ctx.store.all("staff")).map((s) => ({ id: s.id, name: s.name, initials: s.initials, role: s.role }));
    case "GET home": return home(ctx, q);
    case "GET players": return directory(ctx);
    case "GET player": return profile(ctx, q.get("id"));
    case "GET followups": need(ctx, "read_notes"); return followups(ctx);
    case "GET report": return report(ctx, q);
    case "GET imports": need(ctx, "import_performance"); return (await ctx.store.all("imports")).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((b) => ({ ...b, source_rows: undefined, created: b.created.length, updated: b.updated.length }));
    case "GET import": need(ctx, "import_performance"); { const b = await ctx.store.get("imports", q.get("id")); if (!b) throw new HttpError(404, "No such import."); return b; }
    case "GET audit": need(ctx, "audit"); return (await ctx.store.all("audit")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, +(q.get("limit") || 300));
    case "GET export": return exportTable(ctx, q.get("table"));
    case "GET import.fields": return { fields: FIELDS[q.get("kind")] || [] };
    case "POST import.preview": return importPreview(ctx, body);
    case "POST import.commit": return importCommit(ctx, body);
    case "POST import.rollback": return importRollback(ctx, body);
    case "POST player.create": return createPlayer(ctx, body);
    case "POST player.update": return updatePlayer(ctx, body);
    case "POST weight": return addWeight(ctx, body);
    case "POST weights.bulk": return bulkWeights(ctx, body);
    case "POST dexa": return addDexa(ctx, body);
    case "POST hydration": return addHydration(ctx, body);
    case "POST protocol": return addProtocol(ctx, body);
    case "POST goal": return addGoal(ctx, body);
    case "POST goal.update": return updateGoal(ctx, body);
    case "POST interaction": return addInteraction(ctx, body);
    case "POST interaction.edit": return editInteraction(ctx, body);
    case "POST followup": return addFollowup(ctx, body);
    case "POST followup.update": return updateFollowup(ctx, body);
    case "POST performance": return addPerformance(ctx, body);
    case "POST void": return voidRecord(ctx, body);
    case "POST quick": return quickEntry(ctx, body);
    default: throw new HttpError(404, "Not found.", "not_found");
  }
}

/* ------------------------------------------------------------------ common write helpers */
function stamp(ctx, extra) { return { created_at: ctx.now, updated_at: ctx.now, created_by: ctx.user.email, ...extra }; }
function audit(ctx, action, table, rec, player, summary) {
  return { put: "audit", row: { id: uid("au_"), at: ctx.now, user: ctx.user.email, user_name: ctx.user.name || ctx.user.email, role: ctx.user.role, action, table, record_id: rec && rec.id, player_id: player ? player.id : rec && rec.player_id || null, player_name: player ? name(player) : null, summary } };
}
async function player(ctx, id) {
  const p = id ? await ctx.store.get("players", id) : null;
  if (!p) throw new HttpError(404, "That player isn't in FUEL.", "not_found");
  return p;
}
const date = (v, label, { required = true, notFuture = true } = {}, ctx) => {
  if (v == null || v === "") { if (required) throw bad(`${label} is required.`); return null; }
  if (!isISODate(v)) throw bad(`${label} must be a date (YYYY-MM-DD).`);
  if (notFuture && ctx && v > addDays(ctx.today, 1)) throw bad(`${label} can't be in the future.`);
  return v;
};
const num = (v, label, range, unit) => {
  const n = typeof v === "number" ? v : parseNumber(v);
  if (n == null) throw bad(`${label} must be a number.`);
  if (range && !inRange(unit === "kg" ? toLb(n, "kg") : n, range)) throw bad(`${label} ${n}${unit ? " " + unit : ""} is outside the plausible range — check for a typo.`);
  return n;
};
const optNum = (v, label, range, unit) => (v == null || v === "" ? null : num(v, label, range, unit));
const unitOf = (u) => { if (u && !["lb", "kg"].includes(u)) throw bad("Unit must be lb or kg."); return u || "lb"; };
const staffMember = async (ctx, id) => { if (!id) return null; const s = await ctx.store.get("staff", id); if (!s) throw bad("Unknown staff member."); return s.id; };

/* ------------------------------------------------------------------ players */
const PLAYER_FIELDS = ["external_id", "first_name", "last_name", "dob", "position", "bats", "throws", "height", "listed_weight", "phone", "whatsapp", "status", "dietitian"];
async function validPlayerFields(ctx, f, existingId) {
  const o = {};
  for (const k of PLAYER_FIELDS) if (k in f) o[k] = typeof f[k] === "string" ? clean(f[k], 80).trim() || null : f[k] ?? null;
  if ("first_name" in o && !o.first_name) throw bad("First name is required.");
  if ("last_name" in o && !o.last_name) throw bad("Last name is required.");
  if (o.dob) date(o.dob, "Date of birth", { notFuture: true }, ctx);
  if (o.position) { o.position = o.position.toUpperCase(); if (!POSITIONS.includes(o.position)) throw bad("Unknown position."); }
  if (o.status && !ROSTER_STATUS.includes(o.status)) throw bad("Unknown roster status.");
  if (o.listed_weight != null) o.listed_weight = num(o.listed_weight, "Listed weight", RANGES.weight_lb);
  if (o.dietitian) await staffMember(ctx, o.dietitian);
  if (o.external_id) {
    const clash = (await ctx.store.all("players")).find((p) => p.external_id === o.external_id && p.id !== existingId);
    if (clash) throw new HttpError(409, `Player ID ${o.external_id} already belongs to ${name(clash)}.`, "conflict");
  }
  return o;
}
async function createPlayer(ctx, b) {
  need(ctx, "write_players");
  const f = await validPlayerFields(ctx, { status: "active", ...b.fields }, null);
  if (!f.first_name || !f.last_name) throw bad("First and last name are required.");
  const affiliate = b.affiliate ? clean(b.affiliate, 60) : null;
  const p = { id: uid("pl_"), ...Object.fromEntries(PLAYER_FIELDS.map((k) => [k, f[k] ?? null])), affiliate, ...stamp(ctx, {}) };
  const ops = [{ put: "players", row: p }];
  if (affiliate) ops.push({ put: "assignments", row: { id: uid("as_"), player_id: p.id, affiliate, start_date: ctx.today, end_date: null, source: "manual", ...stamp(ctx, {}) } });
  ops.push(audit(ctx, "create", "players", p, p, `Added ${name(p)}${affiliate ? " · " + affiliate : ""}`));
  await ctx.store.commit(ops);
  return { player: p };
}
async function updatePlayer(ctx, b) {
  need(ctx, "write_players");
  const p0 = await player(ctx, b.id);
  const f = await validPlayerFields(ctx, b.fields || {}, p0.id);
  const p = { ...p0, ...f, updated_at: ctx.now, updated_by: ctx.user.email };
  const ops = [], changed = Object.keys(f).filter((k) => (p0[k] ?? null) !== (f[k] ?? null));
  if (b.affiliate && b.affiliate !== p0.affiliate) {
    p.affiliate = clean(b.affiliate, 60);
    affiliateChange({ assignments: await ctx.store.byPlayer("assignments", p0.id) }, ops, null, null, p0.id, p.affiliate, { today: b.effective_date && isISODate(b.effective_date) ? b.effective_date : ctx.today, now: ctx.now, user: ctx.user.email }, null, "manual");
    changed.push("affiliate");
  }
  if (!changed.length) return { player: p0, changed: [] };
  ops.unshift({ put: "players", row: p });
  ops.push(audit(ctx, "update", "players", p, p, `Updated ${name(p)}: ${changed.join(", ")}${changed.includes("affiliate") ? ` (${p0.affiliate || "—"} → ${p.affiliate})` : ""}`));
  await ctx.store.commit(ops);
  return { player: p, changed };
}

/* ------------------------------------------------------------------ measurements */
async function weightRow(ctx, b, extra = {}) {
  const p = await player(ctx, b.player_id);
  const unit = unitOf(b.unit);
  const w = num(b.weight, "Weight", RANGES.weight_lb, unit);
  return { p, row: { id: uid("we_"), player_id: p.id, date: date(b.date, "Measurement date", {}, ctx), weight: w, unit, note: clean(b.note, 2000) || null, source: { kind: b.source || "manual" }, entry_date: ctx.today, ...stamp(ctx, extra) } };
}
async function addWeight(ctx, b) {
  need(ctx, "write_nutrition");
  const { p, row } = await weightRow(ctx, b);
  await ctx.store.commit([{ put: "weights", row }, audit(ctx, "create", "weights", row, p, `Weight ${row.weight} ${row.unit} on ${row.date}`)]);
  return { weight: row };
}
async function bulkWeights(ctx, b) {
  need(ctx, "write_nutrition");
  const d = date(b.date, "Measurement date", {}, ctx);
  const entries = (b.entries || []).filter((e) => e && e.weight !== "" && e.weight != null);
  if (!entries.length) throw bad("Enter at least one weight.");
  if (entries.length > 500) throw bad("At most 500 weights at once.");
  const ops = [], errors = [], saved = [];
  for (const e of entries) {
    try { const { p, row } = await weightRow(ctx, { ...e, date: d, unit: b.unit, source: "bulk" }); ops.push({ put: "weights", row }); saved.push(row); ops.push(audit(ctx, "create", "weights", row, p, `Weight ${row.weight} ${row.unit} on ${d} (bulk)`)); }
    catch (err) { errors.push({ player_id: e.player_id, error: err.message }); }
  }
  if (errors.length && !b.saveValid) return { saved: 0, errors }; // nothing is saved until every row is valid, unless asked
  if (ops.length) await ctx.store.commit(ops);
  return { saved: saved.length, errors };
}
async function addDexa(ctx, b) {
  need(ctx, "write_nutrition");
  const p = await player(ctx, b.player_id);
  const unit = unitOf(b.unit);
  const row = { id: uid("dx_"), player_id: p.id, date: date(b.date, "Assessment date", {}, ctx), body_fat_pct: optNum(b.body_fat_pct, "Body fat %", RANGES.bf_pct),
    lean_mass: optNum(b.lean_mass, "Lean mass", RANGES.mass_lb, unit), fat_mass: optNum(b.fat_mass, "Fat mass", RANGES.mass_lb, unit), alm: optNum(b.alm, "ALM", RANGES.mass_lb, unit),
    unit, note: clean(b.note, 2000) || null, source: { kind: "manual", label: clean(b.source_label, 80) || null }, entry_date: ctx.today, ...stamp(ctx, {}) };
  if ([row.body_fat_pct, row.lean_mass, row.fat_mass, row.alm].every((x) => x == null)) throw bad("Enter at least one DEXA value.");
  await ctx.store.commit([{ put: "dexa", row }, audit(ctx, "create", "dexa", row, p, `DEXA on ${row.date}${row.body_fat_pct != null ? ` · ${row.body_fat_pct}% BF` : ""}`)]);
  return { dexa: row };
}
async function addHydration(ctx, b) {
  need(ctx, "write_protocols");
  const p = await player(ctx, b.player_id);
  const row = { id: uid("hy_"), player_id: p.id, date: date(b.date, "Test date", { required: false }, ctx), hydration_card: b.hydration_card === true ? true : b.hydration_card === false ? false : null,
    fluid_loss_oz_hr: optNum(b.fluid_loss_oz_hr, "Fluid loss", RANGES.fluid_oz_hr), sodium_loss_mg_hr: optNum(b.sodium_loss_mg_hr, "Sodium loss", RANGES.sodium_mg_hr),
    note: clean(b.note, 2000) || null, source: { kind: "manual" }, entry_date: ctx.today, ...stamp(ctx, {}) };
  await ctx.store.commit([{ put: "hydration", row }, audit(ctx, "create", "hydration", row, p, `Hydration assessment${row.date ? " " + row.date : ""}`)]);
  return { hydration: row };
}
async function addProtocol(ctx, b) {
  need(ctx, "write_protocols");
  const p = await player(ctx, b.player_id);
  const type = ["vitamin_d", "other"].includes(b.type) ? b.type : fail("Protocol type must be vitamin_d or other.");
  const row = { id: uid("pr_"), player_id: p.id, type, label: clean(b.label, 80) || null, active: b.active === true ? true : b.active === false ? false : null, date: date(b.date, "Date", { required: false }, ctx),
    details: clean(b.details, 2000) || null, source: { kind: "manual" }, entry_date: ctx.today, ...stamp(ctx, {}) };
  await ctx.store.commit([{ put: "protocols", row }, audit(ctx, "create", "protocols", row, p, `Protocol record (${type === "vitamin_d" ? "vitamin D" : row.label || "other"})`)]);
  return { protocol: row };
}
async function addGoal(ctx, b) {
  need(ctx, "write_nutrition");
  const p = await player(ctx, b.player_id);
  if (!GOAL_TYPES[b.type]) throw bad("Unknown goal type.");
  const unit = b.target_unit ? unitOf(b.target_unit) : null;
  const row = { id: uid("go_"), player_id: p.id, type: b.type, description: clean(b.description, 2000) || (b.type === "maintain" ? "Maintain" : fail("Describe the goal.")),
    start_date: date(b.start_date || ctx.today, "Start date", { notFuture: false }, ctx), target_date: date(b.target_date, "Target date", { required: false, notFuture: false }, ctx),
    status: "active", target_value: b.target_value === "" || b.target_value == null ? null : num(b.target_value, "Target", b.type === "weight" ? RANGES.weight_lb : null, unit),
    target_unit: unit, progress: [], source: { kind: "manual" }, ...stamp(ctx, {}) };
  await ctx.store.commit([{ put: "goals", row }, audit(ctx, "create", "goals", row, p, `Goal: ${GOAL_TYPES[row.type]} — ${row.description.slice(0, 80)}`)]);
  return { goal: row };
}
async function updateGoal(ctx, b) {
  need(ctx, "write_nutrition");
  const g0 = await ctx.store.get("goals", b.id);
  if (!g0) throw new HttpError(404, "No such goal.");
  const g = { ...g0, progress: (g0.progress || []).slice(), updated_at: ctx.now };
  if (b.status) { if (!GOAL_STATUS.includes(b.status)) throw bad("Unknown goal status."); g.status = b.status; if (b.status !== "active") g.closed_date = ctx.today; }
  if (b.progress_note) g.progress.push({ at: ctx.now, by: ctx.user.email, date: ctx.today, text: clean(b.progress_note, 2000) });
  await ctx.store.commit([{ put: "goals", row: g }, audit(ctx, "update", "goals", g, await player(ctx, g.player_id), `Goal ${b.status ? "→ " + b.status : "progress note"}`)]);
  return { goal: g };
}

/* ------------------------------------------------------------------ communication & follow-ups */
async function interactionRow(ctx, b, p, extra = {}) {
  const text = clean(b.text, 20000);
  if (!text.trim()) throw bad("The note is empty.");
  if (b.type && !INTERACTION_TYPES[b.type]) throw bad("Unknown interaction type.");
  if (b.time && !/^\d{2}:\d{2}$/.test(b.time)) throw bad("Time must be HH:MM.");
  return { id: uid("in_"), player_id: p.id, date: date(b.date, "Date", {}, ctx), time: b.time || null, type: b.type || "general", text, original_text: text, author: ctx.user.email,
    author_name: ctx.user.name || null, author_initials: ctx.user.initials || null, goal_id: b.goal_id || null, history: [], source: { kind: b.source || "manual" }, entry_date: ctx.today, ...stamp(ctx, extra) };
}
async function addInteraction(ctx, b) {
  need(ctx, "write_nutrition");
  const p = await player(ctx, b.player_id);
  const row = await interactionRow(ctx, b, p);
  await ctx.store.commit([{ put: "interactions", row }, audit(ctx, "create", "interactions", row, p, `${INTERACTION_TYPES[row.type]} note`)]);
  return { interaction: row };
}
async function editInteraction(ctx, b) {
  need(ctx, "write_nutrition");
  const r0 = await ctx.store.get("interactions", b.id);
  if (!r0) throw new HttpError(404, "No such note.");
  const text = clean(b.text, 20000);
  if (!text.trim()) throw bad("The note is empty.");
  if (text === r0.text && (!b.type || b.type === r0.type)) return { interaction: r0 };
  const r = { ...r0, text, type: b.type && INTERACTION_TYPES[b.type] ? b.type : r0.type, updated_at: ctx.now, updated_by: ctx.user.email,
    history: [...(r0.history || []), { at: ctx.now, by: ctx.user.email, previous_text: r0.text, previous_type: r0.type, reason: clean(b.reason, 300) || null }] };
  await ctx.store.commit([{ put: "interactions", row: r }, audit(ctx, "edit", "interactions", r, await player(ctx, r.player_id), "Edited a note (earlier version kept)")]);
  return { interaction: r };
}
async function followupRow(ctx, b, p, extra = {}) {
  const pr = b.priority || "normal";
  if (!PRIORITIES.includes(pr)) throw bad("Unknown priority.");
  return { id: uid("fu_"), player_id: p.id, description: clean(b.description, 1000).trim() || fail("Describe the follow-up."), assignee: await staffMember(ctx, b.assignee) || null,
    due_date: date(b.due_date, "Due date", { notFuture: false }, ctx), priority: pr, status: "open", completed_date: null, interaction_id: b.interaction_id || null, ...stamp(ctx, extra) };
}
async function addFollowup(ctx, b) {
  need(ctx, "write_nutrition");
  const p = await player(ctx, b.player_id);
  const row = await followupRow(ctx, b, p);
  await ctx.store.commit([{ put: "followups", row }, audit(ctx, "create", "followups", row, p, `Follow-up due ${row.due_date}`)]);
  return { followup: row };
}
async function updateFollowup(ctx, b) {
  need(ctx, "write_nutrition");
  const f0 = await ctx.store.get("followups", b.id);
  if (!f0) throw new HttpError(404, "No such follow-up.");
  const f = { ...f0, updated_at: ctx.now, updated_by: ctx.user.email };
  if (b.status) {
    if (!["open", "completed", "cancelled"].includes(b.status)) throw bad("Unknown status.");
    f.status = b.status; f.completed_date = b.status === "completed" ? (isISODate(b.completed_date) ? b.completed_date : ctx.today) : null;
  }
  if (b.due_date) f.due_date = date(b.due_date, "Due date", { notFuture: false }, ctx);
  if (b.assignee !== undefined) f.assignee = await staffMember(ctx, b.assignee);
  if (b.priority) { if (!PRIORITIES.includes(b.priority)) throw bad("Unknown priority."); f.priority = b.priority; }
  if (b.description) f.description = clean(b.description, 1000);
  await ctx.store.commit([{ put: "followups", row: f }, audit(ctx, "update", "followups", f, await player(ctx, f.player_id), `Follow-up ${b.status ? "→ " + b.status : "updated"}`)]);
  return { followup: f };
}

/* ------------------------------------------------------------------ performance */
async function addPerformance(ctx, b) {
  need(ctx, "write_performance");
  const p = await player(ctx, b.player_id);
  const m = METRICS[b.metric];
  if (!m) throw bad("Metric must be bat_speed, exit_velocity or pitch_velocity.");
  const def = normDefinition(b.metric, b.definition);
  if (!def) throw bad(`Choose a definition for ${m.label}.`);
  const value = num(b.value, m.label, null);
  if (!inRange(value, m.range)) throw bad(`${value} mph is outside the plausible range for ${m.label}.`);
  const row = { id: uid("pf_"), player_id: p.id, date: date(b.date, "Measurement date", {}, ctx), metric: b.metric, value, unit: "mph", definition: def,
    source_label: clean(b.source_label, 80) || null, notes: clean(b.notes, 1000) || null, source: { kind: "manual" }, ...stamp(ctx, {}) };
  row.fp = recordFingerprint(p.id, { table: "performance", ...row });
  await ctx.store.commit([{ put: "performance", row }, audit(ctx, "create", "performance", row, p, `${m.label} ${value} mph (${def}) on ${row.date}`)]);
  return { performance: row };
}

/* ------------------------------------------------------------------ corrections never overwrite */
const VOIDABLE = { weights: "write_nutrition", dexa: "write_nutrition", hydration: "write_protocols", protocols: "write_protocols", performance: "write_performance", interactions: "write_nutrition" };
async function voidRecord(ctx, b) {
  const perm = VOIDABLE[b.table];
  if (!perm) throw bad("That record can't be voided.");
  need(ctx, perm);
  const r0 = await ctx.store.get(b.table, b.id);
  if (!r0) throw new HttpError(404, "No such record.");
  if (r0.voided) return { record: r0 };
  const reason = clean(b.reason, 300).trim();
  if (!reason) throw bad("Give a reason — the record stays in the history, marked void.");
  const r = { ...r0, voided: true, void_reason: reason, voided_by: ctx.user.email, voided_at: ctx.now, updated_at: ctx.now };
  await ctx.store.commit([{ put: b.table, row: r }, audit(ctx, "void", b.table, r, await player(ctx, r.player_id), `Voided a ${b.table.replace(/s$/, "")} record: ${reason}`)]);
  return { record: r };
}

/* ------------------------------------------------------------------ Quick Entry: one note, its accepted extras, one commit */
async function quickEntry(ctx, b) {
  need(ctx, "write_nutrition");
  const p = await player(ctx, b.player_id);
  const entryDate = date(b.entry_date || ctx.today, "Entry date", {}, ctx);
  const qid = uid("qe_");
  const note = await interactionRow(ctx, { text: b.note, date: entryDate, type: b.type, source: "quick_entry" }, p, { quick_entry: qid });
  const ops = [{ put: "interactions", row: note }], made = { interaction: note };
  if (b.weight && b.weight.value !== "" && b.weight.value != null) {
    const { row } = await weightRow(ctx, { player_id: p.id, weight: b.weight.value, unit: b.weight.unit, date: b.weight.date || entryDate, note: null, source: "quick_entry" }, { quick_entry: qid, interaction_id: note.id });
    ops.push({ put: "weights", row }); made.weight = row;
  }
  if (b.followup && b.followup.date) {
    const row = await followupRow(ctx, { description: b.followup.description || "Follow up", due_date: b.followup.date, assignee: b.followup.assignee || ctx.user.staff_id || null, priority: b.followup.priority, interaction_id: note.id }, p, { quick_entry: qid });
    ops.push({ put: "followups", row }); made.followup = row;
  }
  const qe = { id: qid, player_id: p.id, entry_date: entryDate, raw_text: note.text, parsed: b.parsed || null, created: Object.fromEntries(Object.entries(made).map(([k, v]) => [k, v.id])), ...stamp(ctx, {}) };
  ops.push({ put: "quick_entries", row: qe });
  ops.push(audit(ctx, "quick_entry", "interactions", note, p, `Quick entry: note${made.weight ? ` + weight ${made.weight.weight} ${made.weight.unit}` : ""}${made.followup ? ` + follow-up ${made.followup.due_date}` : ""}`));
  await ctx.store.commit(ops);
  return { quick_entry: qe, ...made };
}

/* ------------------------------------------------------------------ read models */
async function loadAll(ctx, tables) { const o = {}; for (const t of tables) o[t] = await ctx.store.all(t); return o; }
function latest(rows) { return rows.filter((r) => live(r) && r.date).sort(byDate).pop() || null; }
function index(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.player_id)) m.set(r.player_id, []); m.get(r.player_id).push(r); } return m; }

function followupState(list, today) {
  const open = list.filter((f) => f.status === "open");
  if (open.some((f) => f.due_date < today)) return "overdue";
  if (open.some((f) => daysBetween(today, f.due_date) <= 7)) return "due soon";
  return open.length ? "open" : "none";
}

async function directory(ctx) {
  const d = await loadAll(ctx, ["players", "weights", "dexa", "goals", "interactions", "followups", "staff"]);
  const W = index(d.weights), D = index(d.dexa), G = index(d.goals), I = index(d.interactions), FU = index(d.followups);
  const notes = can(ctx.user.role, "read_notes");
  return d.players.map((p) => {
    const w = latest(W.get(p.id) || []), dx = latest(D.get(p.id) || []);
    const gw = (G.get(p.id) || []).filter((g) => g.type === "weight" && g.status === "active" && g.target_value != null).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).pop();
    const lastI = notes ? (I.get(p.id) || []).filter(live).map((i) => i.date || i.entry_date).filter(Boolean).sort().pop() || null : null;
    return { ...redactPlayer(p, ctx.user.role), age: ageOn(p.dob, ctx.today), latest_weight: w ? { value: w.weight, unit: w.unit, date: w.date } : null,
      goal_weight: gw ? { value: gw.target_value, unit: gw.target_unit || "lb" } : null, latest_bf: dx && dx.body_fat_pct != null ? { value: dx.body_fat_pct, date: dx.date } : null,
      last_interaction: lastI, followup: notes ? followupState(FU.get(p.id) || [], ctx.today) : null, days_since_weight: w ? daysBetween(w.date, ctx.today) : null,
      dietitian_name: (d.staff.find((s) => s.id === p.dietitian) || {}).name || null };
  }).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
}

async function profile(ctx, id) {
  const p = await player(ctx, id);
  const role = ctx.user.role;
  const out = { player: { ...redactPlayer(p, role), age: ageOn(p.dob, ctx.today) } };
  const tables = ["assignments", "weights", "dexa", "goals", "performance"];
  if (can(role, "read_notes")) tables.push("interactions", "followups");
  if (can(role, "read_protocols")) tables.push("hydration", "protocols");
  for (const t of tables) out[t] = (await ctx.store.byPlayer(t, p.id)).sort(byDate);
  if (out.followups) out.followups.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  out.restricted = { notes: !can(role, "read_notes"), protocols: !can(role, "read_protocols"), contact: !can(role, "read_contact") };
  return out;
}

async function followups(ctx) {
  const d = await loadAll(ctx, ["followups", "players", "staff"]);
  const P = new Map(d.players.map((p) => [p.id, p])), S = new Map(d.staff.map((s) => [s.id, s]));
  return d.followups.map((f) => ({ ...f, player_name: name(P.get(f.player_id)), affiliate: (P.get(f.player_id) || {}).affiliate || null, assignee_name: (S.get(f.assignee) || {}).name || null,
    overdue: f.status === "open" && f.due_date < ctx.today })).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

async function home(ctx, q) {
  const days = Math.max(1, Math.min(60, +(q.get("checkin_days") || 7)));
  const notes = can(ctx.user.role, "read_notes");
  const d = await loadAll(ctx, ["players", "weights", "dexa", "interactions", "followups", "audit", "staff"]);
  const P = new Map(d.players.map((p) => [p.id, p]));
  const active = d.players.filter((p) => (p.status || "active") === "active" || p.status === "injured");
  const byAff = {};
  for (const p of active) byAff[p.affiliate || "Unassigned"] = (byAff[p.affiliate || "Unassigned"] || 0) + 1;
  const W = index(d.weights.filter(live));
  const needs = active.map((p) => { const w = latest(W.get(p.id) || []); return { id: p.id, name: name(p), affiliate: p.affiliate, last: w ? w.date : null, days: w ? daysBetween(w.date, ctx.today) : null }; })
    .filter((x) => x.days == null || x.days > days).sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));
  const fu = notes ? d.followups.filter((f) => f.status === "open").map((f) => ({ ...f, player_name: name(P.get(f.player_id)), assignee_name: (d.staff.find((s) => s.id === f.assignee) || {}).name || null })) : [];
  const recentW = d.weights.filter(live).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map((w) => ({ ...w, player_name: name(P.get(w.player_id)) }));
  const recentI = notes ? d.interactions.filter((i) => live(i) && i.type !== "history").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.created_at.localeCompare(a.created_at)).slice(0, 6)
    .map((i) => ({ id: i.id, player_id: i.player_id, player_name: name(P.get(i.player_id)), date: i.date, type: i.type, author_name: i.author_name, author_initials: i.author_initials, text: i.text.slice(0, 220) })) : [];
  const recentD = d.dexa.filter((x) => live(x) && x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((x) => ({ ...x, player_name: name(P.get(x.player_id)) }));
  const feed = d.audit.sort((a, b) => b.at.localeCompare(a.at)).filter((a) => a.action !== "export").slice(0, 14).map((a) => ({ at: a.at, user_name: a.user_name, action: a.action, table: a.table, player_id: a.player_id, player_name: a.player_name, summary: notes ? a.summary : a.summary.replace(/:.*$/, "") }));
  return { today: ctx.today, checkin_days: days, active: active.length, total: d.players.length, by_affiliate: byAff, needs_checkin: needs, overdue: fu.filter((f) => f.due_date < ctx.today),
    upcoming: fu.filter((f) => f.due_date >= ctx.today && daysBetween(ctx.today, f.due_date) <= 7), recent_weights: recentW, recent_interactions: recentI, recent_dexa: recentD, feed, notes };
}

/* ------------------------------------------------------------------ reports */
export const REPORTS = {
  weight_change: { label: "Weight change over a period", params: ["from", "to", "affiliate"] },
  weight_history: { label: "Weight history — one player", params: ["player_id"] },
  missing_weighins: { label: "Missing recent weigh-ins", params: ["days", "affiliate"] },
  dexa_change: { label: "Body composition change between DEXA scans", params: ["affiliate"] },
  followup_status: { label: "Follow-up status", params: ["status"], perm: "read_notes" },
  nutrition_history: { label: "Nutrition history — one player", params: ["player_id"], perm: "read_notes" },
  performance_trends: { label: "Performance alongside body composition", params: ["from", "to", "affiliate"] },
};
async function report(ctx, q) {
  const name_ = q.get("name");
  const def = REPORTS[name_];
  if (!def) throw new HttpError(404, "Unknown report.");
  if (def.perm) need(ctx, def.perm);
  const exportCsv = q.get("format") === "csv";
  if (exportCsv) need(ctx, "export");
  const r = await buildReport(ctx, name_, q);
  if (!exportCsv) return { name: name_, label: def.label, ...r };
  await ctx.store.commit([audit(ctx, "export", "report", { id: name_ }, null, `Exported report "${def.label}" (${r.rows.length} rows)`)]);
  return { csv: toCSV(r.columns, r.rows), filename: `fuel-${name_}-${ctx.today}.csv` };
}
async function buildReport(ctx, name_, q) {
  const today = ctx.today, aff = q.get("affiliate") || "";
  const d = await loadAll(ctx, ["players", "weights", "dexa", "performance", "interactions", "goals", "followups", "staff"]);
  const P = new Map(d.players.map((p) => [p.id, p]));
  const inAff = (p) => p && (!aff || p.affiliate === aff);
  const from = isISODate(q.get("from")) ? q.get("from") : addDays(today, name_ === "performance_trends" ? -365 : -30), to = isISODate(q.get("to")) ? q.get("to") : today;
  const W = index(d.weights.filter((w) => live(w) && w.date)), D = index(d.dexa.filter((x) => live(x) && x.date)), PF = index(d.performance.filter(live));
  const lbOf = (w) => toLb(w.weight, w.unit);
  const C = (key, label, get) => ({ key, label, get });
  switch (name_) {
    case "weight_change": {
      const rows = d.players.filter(inAff).map((p) => {
        const s = (W.get(p.id) || []).filter((w) => w.date >= from && w.date <= to).sort(byDate);
        if (!s.length) return { player: name(p), external_id: p.external_id, affiliate: p.affiliate, n: 0 };
        const a = s[0], b = s[s.length - 1];
        return { player: name(p), external_id: p.external_id, affiliate: p.affiliate, n: s.length, first_date: a.date, first: round(lbOf(a)), last_date: b.date, last: round(lbOf(b)), change: s.length > 1 ? round(lbOf(b) - lbOf(a)) : null };
      }).sort((x, y) => (y.change ?? -1e9) - (x.change ?? -1e9));
      return { params: { from, to, affiliate: aff }, note: "First and last real weigh-in inside the period (lb). Players with one weigh-in show no change.",
        columns: [C("player", "Player"), C("external_id", "Player ID"), C("affiliate", "Affiliate"), C("n", "Weigh-ins"), C("first_date", "First date"), C("first", "First (lb)"), C("last_date", "Last date"), C("last", "Last (lb)"), C("change", "Change (lb)")], rows };
    }
    case "weight_history": {
      const p = await player(ctx, q.get("player_id"));
      const rows = (await ctx.store.byPlayer("weights", p.id)).sort(byDate).map((w) => ({ date: w.date || "unknown", weight: w.weight, unit: w.unit, note: w.note || "", source: (w.source || {}).kind, status: w.voided ? "void: " + w.void_reason : "", entered: w.created_at.slice(0, 10), by: w.created_by }));
      return { params: { player: name(p) }, columns: [C("date", "Measured"), C("weight", "Weight"), C("unit", "Unit"), C("note", "Note"), C("source", "Source"), C("status", "Status"), C("entered", "Entered"), C("by", "By")], rows };
    }
    case "missing_weighins": {
      const days = Math.max(1, +(q.get("days") || 7));
      const rows = d.players.filter((p) => inAff(p) && ["active", "injured", null, undefined].includes(p.status)).map((p) => { const w = latest(W.get(p.id) || []); return { player: name(p), external_id: p.external_id, affiliate: p.affiliate, position: p.position, last: w ? w.date : "never", days: w ? daysBetween(w.date, today) : null }; })
        .filter((r) => r.days == null || r.days > days).sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));
      return { params: { days, affiliate: aff }, columns: [C("player", "Player"), C("external_id", "Player ID"), C("affiliate", "Affiliate"), C("position", "Pos"), C("last", "Last weigh-in"), C("days", "Days since")], rows };
    }
    case "dexa_change": {
      const rows = [];
      for (const p of d.players.filter(inAff)) {
        const s = (D.get(p.id) || []).sort(byDate);
        if (s.length < 2) continue;
        const a = s[s.length - 2], b = s[s.length - 1], dl = (k) => (a[k] != null && b[k] != null ? round(toLb(b[k], b.unit) - toLb(a[k], a.unit), 1) : null);
        rows.push({ player: name(p), external_id: p.external_id, affiliate: p.affiliate, from: a.date, to: b.date, days: daysBetween(a.date, b.date), bf_from: a.body_fat_pct, bf_to: b.body_fat_pct,
          bf_change: a.body_fat_pct != null && b.body_fat_pct != null ? round(b.body_fat_pct - a.body_fat_pct) : null, lm_change: dl("lean_mass"), fm_change: dl("fat_mass"), alm_change: dl("alm") });
      }
      return { params: { affiliate: aff }, note: "The two most recent scans per player; masses in lb. Players with fewer than two scans are not listed.",
        columns: [C("player", "Player"), C("external_id", "Player ID"), C("affiliate", "Affiliate"), C("from", "Scan 1"), C("to", "Scan 2"), C("days", "Days"), C("bf_from", "BF% 1"), C("bf_to", "BF% 2"), C("bf_change", "Δ BF%"), C("lm_change", "Δ Lean (lb)"), C("fm_change", "Δ Fat (lb)"), C("alm_change", "Δ ALM (lb)")], rows };
    }
    case "followup_status": {
      const st = q.get("status") || "";
      const rows = d.followups.filter((f) => (!st || (st === "overdue" ? f.status === "open" && f.due_date < today : f.status === st)) && inAff(P.get(f.player_id)))
        .map((f) => ({ player: name(P.get(f.player_id)), affiliate: (P.get(f.player_id) || {}).affiliate, description: f.description, due: f.due_date, priority: f.priority, status: f.status === "open" && f.due_date < today ? "overdue" : f.status, completed: f.completed_date || "", assignee: (d.staff.find((s) => s.id === f.assignee) || {}).name || "" }))
        .sort((a, b) => a.due.localeCompare(b.due));
      return { params: { status: st }, columns: [C("player", "Player"), C("affiliate", "Affiliate"), C("description", "Follow-up"), C("due", "Due"), C("priority", "Priority"), C("status", "Status"), C("completed", "Completed"), C("assignee", "Assigned to")], rows };
    }
    case "nutrition_history": {
      const p = await player(ctx, q.get("player_id"));
      const ev = [];
      for (const w of W.get(p.id) || []) ev.push({ date: w.date, kind: "Weight", detail: `${w.weight} ${w.unit}${w.note ? " — " + w.note : ""}` });
      for (const x of D.get(p.id) || []) ev.push({ date: x.date, kind: "DEXA", detail: [x.body_fat_pct != null && `BF ${x.body_fat_pct}%`, x.lean_mass != null && `LM ${x.lean_mass} ${x.unit}`, x.fat_mass != null && `FM ${x.fat_mass} ${x.unit}`, x.alm != null && `ALM ${x.alm} ${x.unit}`].filter(Boolean).join(" · ") });
      for (const i of d.interactions.filter((i) => i.player_id === p.id && live(i))) ev.push({ date: i.date || "", kind: (INTERACTION_TYPES[i.type] || i.type) + (i.date ? "" : " (date unknown)"), detail: i.text, by: i.author_name || i.author_initials || "" });
      for (const g of d.goals.filter((g) => g.player_id === p.id)) ev.push({ date: g.start_date || "", kind: "Goal (" + g.status + ")", detail: `${GOAL_TYPES[g.type]}: ${g.description}` });
      ev.sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
      return { params: { player: name(p) }, columns: [C("date", "Date"), C("kind", "Type"), C("detail", "Detail"), C("by", "By")], rows: ev.map((e) => ({ ...e, date: e.date || "unknown" })) };
    }
    case "performance_trends": {
      const rows = [];
      for (const p of d.players.filter(inAff)) {
        const series = {};
        for (const x of (PF.get(p.id) || []).filter((x) => x.date >= from && x.date <= to)) (series[x.metric + "|" + x.definition] = series[x.metric + "|" + x.definition] || []).push(x);
        const ws = (W.get(p.id) || []).filter((w) => w.date >= from && w.date <= to).sort(byDate);
        const ds = (D.get(p.id) || []).filter((x) => x.date >= from && x.date <= to).sort(byDate);
        for (const [k, s] of Object.entries(series)) {
          s.sort(byDate);
          const [metric, defn] = k.split("|");
          rows.push({ player: name(p), external_id: p.external_id, affiliate: p.affiliate, metric: METRICS[metric].label, definition: METRICS[metric].definitions[defn] || defn, n: s.length,
            first: s[0].value, last: s[s.length - 1].value, perf_change: s.length > 1 ? round(s[s.length - 1].value - s[0].value) : null,
            weight_change: ws.length > 1 ? round(lbOf(ws[ws.length - 1]) - lbOf(ws[0])) : null, lm_change: ds.length > 1 && ds[0].lean_mass != null && ds[ds.length - 1].lean_mass != null ? round(toLb(ds[ds.length - 1].lean_mass, ds[ds.length - 1].unit) - toLb(ds[0].lean_mass, ds[0].unit)) : null });
        }
      }
      return { params: { from, to, affiliate: aff }, note: "First and last real measurement of each series inside the period. Different definitions are separate rows. Changes side by side are context, not cause and effect.",
        columns: [C("player", "Player"), C("external_id", "Player ID"), C("affiliate", "Affiliate"), C("metric", "Metric"), C("definition", "Definition"), C("n", "Measurements"), C("first", "First (mph)"), C("last", "Last (mph)"), C("perf_change", "Δ mph"), C("weight_change", "Δ weight (lb)"), C("lm_change", "Δ lean mass (lb)")], rows };
    }
  }
}

/* ------------------------------------------------------------------ exports */
const EXPORTABLE = { players: "read", weights: "read", dexa: "read", performance: "read", goals: "read", interactions: "read_notes", followups: "read_notes", hydration: "read_protocols", protocols: "read_protocols", assignments: "read" };
async function exportTable(ctx, table) {
  need(ctx, "export");
  if (!EXPORTABLE[table]) throw bad("Unknown table.");
  need(ctx, EXPORTABLE[table]);
  const players = new Map((await ctx.store.all("players")).map((p) => [p.id, p]));
  let rows = await ctx.store.all(table);
  if (table === "players") rows = rows.map((p) => redactPlayer(p, ctx.user.role));
  const flat = rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[k] = v && typeof v === "object" ? JSON.stringify(v) : v;
    if (r.player_id) { const p = players.get(r.player_id); o.player_name = name(p); o.external_id = p ? p.external_id : null; }
    return o;
  });
  const keys = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  await ctx.store.commit([audit(ctx, "export", table, { id: table }, null, `Exported ${table} (${rows.length} rows)`)]);
  return { csv: toCSV(keys.map((k) => ({ key: k })), flat), filename: `fuel-${table}-${ctx.today}.csv` };
}

/* ------------------------------------------------------------------ imports */
const IMPORT_PERM = { roster: "import_roster", legacy: "import_legacy", performance: "import_performance" };
async function importContext(ctx, kind) {
  const players = await ctx.store.all("players");
  const fingerprints = new Set();
  const tables = kind === "performance" ? ["performance"] : kind === "legacy" ? ["weights", "dexa", "hydration", "protocols", "goals", "interactions"] : [];
  const data = {};
  for (const t of tables) { data[t] = await ctx.store.all(t); for (const r of data[t]) if (r.fp) fingerprints.add(r.fp); else if (r.player_id) fingerprints.add(recordFingerprint(r.player_id, { table: t, ...r })); }
  return { players, fingerprints, performance: data.performance || [], assignments: await ctx.store.all("assignments"), today: ctx.today };
}
function checkImportBody(ctx, b) {
  if (!IMPORT_PERM[b.kind]) throw bad("Unknown import type.");
  need(ctx, IMPORT_PERM[b.kind]);
  if (typeof b.csv !== "string" || !b.csv.trim()) throw bad("Choose a CSV file first.");
  if (b.csv.length > 5 * 1024 * 1024) throw bad("The file is larger than 5 MB — split it into smaller files.");
  if (b.options && b.options.year != null && b.options.year !== "" && !(+b.options.year >= 2000 && +b.options.year <= 2100)) throw bad("Season year must be a year like 2026.");
}
async function importPreview(ctx, b) {
  checkImportBody(ctx, b);
  const plan = planImport(b.kind, b.csv, b.mapping, b.options || {}, await importContext(ctx, b.kind));
  const lean = { ...plan, rows: plan.rows.map((r) => ({ ...r, raw: undefined, match: r.match ? { ...r.match, player: r.match.player ? slim(r.match.player) : undefined, candidates: (r.match.candidates || []).map((c) => ({ ...c, player: slim(c.player) })) } : undefined })) };
  lean.fields = FIELDS[b.kind];
  return lean;
}
const slim = (p) => p && { id: p.id, first_name: p.first_name, last_name: p.last_name, external_id: p.external_id, dob: p.dob, position: p.position, affiliate: p.affiliate };
async function importCommit(ctx, b) {
  checkImportBody(ctx, b);
  const ictx = await importContext(ctx, b.kind);
  const plan = planImport(b.kind, b.csv, b.mapping, b.options || {}, ictx); // recomputed here: the client's preview is never trusted
  if (plan.errors.length) throw bad(plan.errors.join(" "));
  const { ops, batch, counts } = commitPlan(plan, b.decisions || {}, ictx, { now: ctx.now, today: ctx.today, user: ctx.user.email, filename: clean(b.filename, 200) || null, options: b.options || {} });
  ops.push(audit(ctx, "import", "imports", batch, null, `Imported ${b.kind} CSV${batch.filename ? " " + batch.filename : ""}: ${counts.players_created} new players, ${counts.players_updated} updated, ${counts.records} records, ${counts.duplicates} duplicates skipped`));
  await ctx.store.commit(ops);
  return { batch: { ...batch, source_rows: undefined }, counts };
}
async function importRollback(ctx, b) {
  need(ctx, "rollback");
  const batch = await ctx.store.get("imports", b.id);
  if (!batch) throw new HttpError(404, "No such import.");
  const current = {};
  for (const t of new Set(batch.created.map((c) => c.table).concat(["weights", "dexa", "hydration", "protocols", "goals", "interactions", "followups", "performance"]))) current[t] = await ctx.store.all(t);
  const plan = planRollback(batch, current);
  if (!plan.ok) throw new HttpError(409, plan.reason, "conflict");
  await ctx.store.commit([...plan.ops, { put: "imports", row: { ...batch, status: "rolled_back", rolled_back_at: ctx.now, rolled_back_by: ctx.user.email } },
    audit(ctx, "rollback", "imports", batch, null, `Rolled back ${batch.kind} import from ${batch.created_at.slice(0, 10)} (${batch.created.length} records removed, ${batch.updated.length} restored)`)]);
  return { ok: true };
}
