// Loads the browser engine files the way the page does (classic scripts on `self`).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../apps/manager-hub/assistant");
export function load() {
  const ctx = { self: {}, console };
  vm.createContext(ctx);
  for (const f of ["engine.js", "commands.js"]) vm.runInContext(readFileSync(join(dir, f), "utf8"), ctx, { filename: f });
  return ctx.self.MHAssist;
}
