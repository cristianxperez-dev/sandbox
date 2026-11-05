/* FUEL deployment mode.
   "demo"   — the sandbox: synthetic players only, generated in this browser and stored in its IndexedDB. The role
              switcher simulates staff roles; it is NOT sign-in. Never enter real player information here.
   "secure" — real use: Cloudflare Access sign-in, roles from the server's FUEL_USERS list, Cloudflare D1 storage,
              audit log — via api/ (functions/apps/fuel/api). Requires the setup in fuel/README.md and the
              organization's approval for handling player data. */
export const FUEL_CONFIG = { mode: "demo" };
