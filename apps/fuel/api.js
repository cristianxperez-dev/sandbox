/* FUEL — API client. Demo mode runs the shared handlers in this browser against IndexedDB; secure mode calls the
   Pages Function, which runs the same handlers on the server against D1 with the signed-in person's role. */
import { FUEL_CONFIG } from "./config.js";
import { handle, HttpError } from "./shared/handlers.js";
import { localToday } from "./shared/util.js";
import { BrowserStore } from "./store-idb.js";
import { buildDemo, DEMO_USERS } from "./demo-data.js";

const ROLE_KEY = "fuel:demo-role";
let store = null;
export const mode = FUEL_CONFIG.mode === "secure" ? "secure" : "demo";

export function demoRole() { try { return localStorage.getItem(ROLE_KEY) || "dietitian"; } catch { return "dietitian"; } }
export function setDemoRole(r) { try { localStorage.setItem(ROLE_KEY, r); } catch { /* preference only */ } }

export async function init() {
  if (mode !== "demo") return { persistent: true };
  store = await BrowserStore.open();
  if (store.isEmpty()) await seed();
  return { persistent: store.persistent };
}
async function seed() {
  const data = buildDemo(localToday());
  const ops = [];
  for (const [t, rows] of Object.entries(data)) for (const row of rows) ops.push({ put: t, row });
  await store.commit(ops);
}
export async function resetDemo() { if (mode !== "demo") return; await store.clearAll(); await seed(); }

export async function api(method, path, { body, params } = {}) {
  if (mode === "demo") {
    const user = DEMO_USERS[demoRole()] || DEMO_USERS.dietitian;
    try {
      return await handle({ method, path, body: body ? JSON.parse(JSON.stringify(body)) : null, params: new URLSearchParams(params || {}) },
        { store, user, today: localToday(), now: new Date().toISOString(), mode: "demo" });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error(e);
      throw new HttpError(500, "Something went wrong — nothing was saved. " + (e.message || ""));
    }
  }
  const qs = new URLSearchParams({ ...(params || {}), today: localToday() }).toString();
  const res = await fetch(`api/${path}?${qs}`, { method, credentials: "same-origin", headers: { "X-Fuel": "1", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new HttpError(res.status, (data && data.message) || `Request failed (${res.status}).`, data && data.error);
  return data;
}
