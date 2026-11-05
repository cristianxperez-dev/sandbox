/* FUEL — Cloudflare D1 store (secure mode). Same interface as the browser and memory stores:
   all(table) · byPlayer(table, id) · get(table, id) · commit(ops)  — commit is one D1 batch (atomic).

   One table per entity. Keys and relationships are real columns with indexes and foreign keys:
     id (primary key) · player_id → players(id) · date · external_id (players, unique when present) · updated_at
   The remaining attributes of each record are stored as JSON in `data`. All SQL is parameterized; table names
   come only from the fixed list below. Tables are created on first use; deploys never touch existing data. */

import { TABLES } from "../../apps/fuel/shared/model.js";

const PLAYER_LINKED = new Set(["assignments", "weights", "dexa", "hydration", "protocols", "goals", "interactions", "followups", "performance", "quick_entries"]);
const T = (name) => { if (!TABLES.includes(name)) throw new Error("unknown table"); return "fuel_" + name; };

export function schema() {
  const s = [];
  for (const name of TABLES) {
    const fk = PLAYER_LINKED.has(name) ? ", FOREIGN KEY (player_id) REFERENCES fuel_players(id) ON DELETE RESTRICT" : "";
    const ext = name === "players" ? ", external_id TEXT" : "";
    s.push(`CREATE TABLE IF NOT EXISTS ${T(name)} (id TEXT PRIMARY KEY, player_id TEXT, date TEXT${ext}, updated_at TEXT, data TEXT NOT NULL${fk})`);
    if (PLAYER_LINKED.has(name)) s.push(`CREATE INDEX IF NOT EXISTS ${T(name)}_player ON ${T(name)} (player_id, date)`);
  }
  s.push(`CREATE UNIQUE INDEX IF NOT EXISTS fuel_players_external ON fuel_players (external_id) WHERE external_id IS NOT NULL`);
  s.push(`CREATE INDEX IF NOT EXISTS fuel_audit_at ON fuel_audit (date)`);
  s.push(`CREATE INDEX IF NOT EXISTS fuel_followups_due ON fuel_followups (date)`);
  return s;
}

const dateOf = (name, r) => (name === "audit" ? r.at : name === "followups" ? r.due_date : name === "imports" ? r.created_at : r.date || null);

export class D1Store {
  constructor(db) { this.db = db; this.ready = false; }
  async init() {
    if (this.ready) return;
    await this.db.batch(schema().map((sql) => this.db.prepare(sql)));
    this.ready = true;
  }
  rows(res) { return ((res && res.results) || []).map((r) => JSON.parse(r.data)); }
  async all(name) { await this.init(); return this.rows(await this.db.prepare(`SELECT data FROM ${T(name)}`).all()); }
  async byPlayer(name, pid) { await this.init(); return this.rows(await this.db.prepare(`SELECT data FROM ${T(name)} WHERE player_id = ?`).bind(pid).all()); }
  async get(name, id) { await this.init(); const r = await this.db.prepare(`SELECT data FROM ${T(name)} WHERE id = ?`).bind(id).first(); return r ? JSON.parse(r.data) : null; }
  async commit(ops) {
    await this.init();
    const stmts = ops.map((op) => {
      if (op.del) return this.db.prepare(`DELETE FROM ${T(op.del)} WHERE id = ?`).bind(op.id);
      const r = op.row, name = op.put;
      if (!r || !r.id) throw new Error("row without id");
      const data = JSON.stringify(r);
      if (data.length > 900000) throw new Error("record too large");
      return name === "players"
        ? this.db.prepare(`INSERT INTO ${T(name)} (id, player_id, date, external_id, updated_at, data) VALUES (?, NULL, NULL, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET external_id = excluded.external_id, updated_at = excluded.updated_at, data = excluded.data`).bind(r.id, r.external_id || null, r.updated_at || null, data)
        : this.db.prepare(`INSERT INTO ${T(name)} (id, player_id, date, updated_at, data) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET player_id = excluded.player_id, date = excluded.date, updated_at = excluded.updated_at, data = excluded.data`).bind(r.id, r.player_id || null, dateOf(name, r), r.updated_at || r.at || null, data);
    });
    if (stmts.length) await this.db.batch(stmts);
  }
  async syncStaff(users) {
    const have = new Map((await this.all("staff")).map((s) => [s.id, s]));
    const ops = [];
    for (const u of users.values()) {
      const row = { id: u.staff_id, name: u.name, initials: u.initials, role: u.role, email: u.email };
      const h = have.get(u.staff_id);
      if (!h || h.name !== row.name || h.role !== row.role || h.initials !== row.initials) ops.push({ put: "staff", row });
    }
    if (ops.length) await this.commit(ops);
  }
}
