/* A stand-in for a Cloudflare D1 binding backed by Node's built-in SQLite (tests only). */
import { DatabaseSync } from "node:sqlite";
export function fakeD1({ fail = false } = {}) {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { if (fail) throw new Error("D1 down"); db.prepare(sql.replace(/\?(\d+)/g, "?")).run(...order(sql, args)); return { success: true }; },
    async all() { if (fail) throw new Error("D1 down"); return { results: db.prepare(sql.replace(/\?(\d+)/g, "?")).all(...order(sql, args)).map((r) => ({ ...r })) }; },
    async first() { if (fail) throw new Error("D1 down"); const r = db.prepare(sql.replace(/\?(\d+)/g, "?")).get(...order(sql, args)); return r ? { ...r } : null; },
  });
  // D1 numbered parameters (?1, ?2 …) may repeat or appear out of order; SQLite's positional ? may not
  const order = (sql, args) => [...sql.matchAll(/\?(\d+)/g)].map((m) => args[+m[1] - 1]);
  return { prepare: (sql) => stmt(sql), _db: db };
}
