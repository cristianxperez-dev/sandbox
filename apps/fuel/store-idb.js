/* FUEL demo — browser store. IndexedDB database "fuel-demo-v1" (one object store per table) mirrored in memory.
   commit() writes every op in ONE IndexedDB transaction and only then updates the memory copy, so a failed save
   leaves nothing half-written. This is the sandbox demo's persistence: it survives refreshes in this browser,
   it is not shared with anyone, and it is not the store for real player data (that's D1 in secure mode). */
import { TABLES } from "./shared/model.js";
import { MemoryStore } from "./shared/memstore.js";

const DB_NAME = "fuel-demo-v1";

function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}
const all = (db, t) => new Promise((res, rej) => { const r = db.transaction(t).objectStore(t).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class BrowserStore extends MemoryStore {
  static async open() {
    let db = null, data = {};
    try { db = await openDB(); for (const t of TABLES) data[t] = await all(db, t); } catch (e) { db = null; }
    const s = new BrowserStore(data);
    s.db = db; s.persistent = !!db;
    return s;
  }
  isEmpty() { return !this.t.players.size; }
  async commit(ops) {
    for (const op of ops) { this.tbl(op.put || op.del); if (op.put && (!op.row || !op.row.id)) throw new Error("row without id"); }
    if (this.db) {
      const names = [...new Set(ops.map((o) => o.put || o.del))];
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(names, "readwrite");
        for (const op of ops) op.put ? tx.objectStore(op.put).put(op.row) : tx.objectStore(op.del).delete(op.id);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error("save failed")); tx.onabort = () => reject(tx.error || new Error("save aborted"));
      });
    }
    await super.commit(ops);
  }
  async clearAll() {
    if (this.db) await new Promise((resolve, reject) => { const tx = this.db.transaction(TABLES, "readwrite"); for (const t of TABLES) tx.objectStore(t).clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    for (const t of TABLES) this.t[t].clear();
  }
}
