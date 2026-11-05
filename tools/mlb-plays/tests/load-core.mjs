// Loads apps/play-repository/core.js the way the page does (classic script on `self`).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
export const APP = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/play-repository");
export function loadCore() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(APP, "core.js"), "utf8"), ctx, { filename: "core.js" });
  return ctx.self.PR;
}
export const J = (x) => JSON.parse(JSON.stringify(x));
export const index = () => JSON.parse(readFileSync(join(APP, "data/index.json"), "utf8"));
export const detail = (id) => JSON.parse(readFileSync(join(APP, "data/plays", id + ".json"), "utf8"));
