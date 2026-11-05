/* FUEL — an in-memory store with the same interface as the browser (IndexedDB) and server (D1) stores.
   Used by the browser store as its read cache and by the tests. commit() applies a list of writes all or nothing. */
import { TABLES } from "./model.js";

export class MemoryStore {
  constructor(data = {}) {
    this.t = {};
    for (const name of TABLES) this.t[name] = new Map((data[name] || []).map((r) => [r.id, r]));
  }
  tbl(name) { if (!this.t[name]) throw new Error("unknown table " + name); return this.t[name]; }
  async all(name) { return [...this.tbl(name).values()].map(clone); }
  async byPlayer(name, playerId) { return [...this.tbl(name).values()].filter((r) => r.player_id === playerId).map(clone); }
  async get(name, id) { const r = this.tbl(name).get(id); return r ? clone(r) : null; }
  async commit(ops) {
    for (const op of ops) { const name = op.put || op.del; this.tbl(name); if (op.put && (!op.row || !op.row.id)) throw new Error("row without id"); }
    for (const op of ops) op.put ? this.tbl(op.put).set(op.row.id, clone(op.row)) : this.tbl(op.del).delete(op.id);
  }
  dump() { return Object.fromEntries(Object.entries(this.t).map(([k, m]) => [k, [...m.values()]])); }
}
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
