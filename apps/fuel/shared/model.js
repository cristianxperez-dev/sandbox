/* FUEL — data model, vocabularies and permissions. Shared by the browser demo and the secure server.

   Identity: every record that belongs to a player carries `player_id`, the player's stable internal id
   ("pl_…", never reused, never derived from a name). An organizational id (`external_id`, e.g. the club's
   player id) is the primary matching key for imports when present, and must be unique. Names are never
   used as a definitive match.

   Dates: `date` is when something was measured or happened (may be null when a historical source doesn't
   say — never guessed); `entry_date` is the day staff recorded it; `created_at` / `updated_at` are
   instants. Numbers are numbers, always with an explicit unit. Nothing is overwritten: corrections void the
   old record (with a reason) and add a new one; note edits keep every earlier version. */

export const TABLES = ["players", "assignments", "weights", "dexa", "hydration", "protocols", "goals", "interactions",
  "followups", "performance", "quick_entries", "imports", "audit", "staff"];

export const ROLES = {
  admin: { label: "Administrator" },
  dietitian: { label: "Dietitian" },
  performance: { label: "Performance Staff" },
  readonly: { label: "Read-Only" },
};

/* What each role may do. Checked by the handlers on every request (server-side in secure mode). */
const P = {
  admin: ["read", "read_contact", "read_protocols", "read_notes", "write_nutrition", "write_protocols", "write_performance", "write_players",
    "import_roster", "import_legacy", "import_performance", "rollback", "export", "audit"],
  dietitian: ["read", "read_contact", "read_protocols", "read_notes", "write_nutrition", "write_protocols", "write_performance", "write_players",
    "import_roster", "import_legacy", "import_performance", "export"],
  performance: ["read", "write_performance", "import_performance"],
  readonly: ["read", "read_notes"],
};
export const can = (role, perm) => !!(P[role] && P[role].includes(perm));
export const permissions = (role) => (P[role] || []).slice();

export const AFFILIATES = ["Houston", "Sugar Land", "Corpus Christi", "Asheville", "Fayetteville", "FCL Astros", "DSL Astros", "Rehab / Injured List", "Unassigned"];
export const POSITIONS = ["RHP", "LHP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH", "UT", "TWP"];
export const PITCHER_POS = ["RHP", "LHP", "P", "TWP"];
export const isPitcher = (pos) => PITCHER_POS.includes(String(pos || "").toUpperCase());
export const isHitter = (pos) => !isPitcher(pos) || String(pos || "").toUpperCase() === "TWP";
export const ROSTER_STATUS = ["active", "injured", "inactive", "released"];

export const INTERACTION_TYPES = {
  in_person: "In person", phone: "Phone", whatsapp: "WhatsApp", text: "Text", email: "Email",
  consultation: "Consultation", check_in: "Nutrition check-in", general: "General note", history: "Historical context",
};
export const GOAL_TYPES = {
  weight: "Goal weight", body_comp: "Body composition", maintain: "Maintain", preseason: "Preseason assessment",
  strength: "Strength", weakness: "Weakness", priority: "Nutrition priority",
};
export const GOAL_STATUS = ["active", "achieved", "revised", "discontinued"];
export const FOLLOWUP_STATUS = ["open", "completed", "cancelled"];
export const PRIORITIES = ["low", "normal", "high"];

export const WEIGHT_UNITS = ["lb", "kg"];
export const MASS_UNITS = ["lb", "kg"];
export const KG_PER_LB = 0.45359237;
export const toLb = (v, unit) => (v == null ? null : unit === "kg" ? v / KG_PER_LB : v);

/* Performance — the MVP's three metrics. A definition is part of the measurement: different definitions are
   different series and are never combined. */
export const METRICS = {
  bat_speed: { label: "Bat Speed", unit: "mph", for: "hitter", definitions: { average: "Average", p90: "90th percentile", max: "Maximum" }, range: [40, 100] },
  exit_velocity: { label: "Exit Velocity", unit: "mph", for: "hitter", definitions: { average: "Average", p90: "90th percentile", max: "Maximum" }, range: [40, 125] },
  pitch_velocity: { label: "Pitch Velocity", unit: "mph", for: "pitcher", definitions: { average_fastball: "Average fastball", max_fastball: "Maximum fastball", average_four_seam: "Average four-seam", average_sinker: "Average sinker" }, range: [60, 106] },
};
export const metricLabel = (m, def) => `${(METRICS[m] || {}).label || m}${def ? " — " + (((METRICS[m] || {}).definitions || {})[def] || def) : ""}`;
const METRIC_ALIASES = {
  bat_speed: ["bat_speed", "batspeed", "bat speed", "bs"], exit_velocity: ["exit_velocity", "exit velo", "exit velocity", "ev", "exitvelo"],
  pitch_velocity: ["pitch_velocity", "pitch velo", "pitch velocity", "velo", "velocity", "fastball velocity", "fb velo", "pv"],
};
export function normMetric(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[-\s]+/g, (m) => (m.includes("-") ? "_" : " "));
  for (const [k, al] of Object.entries(METRIC_ALIASES)) if (al.includes(s) || al.includes(s.replace(/ /g, "_"))) return k;
  return null;
}
const DEF_ALIASES = { average: ["average", "avg", "mean"], p90: ["p90", "90th", "90th percentile", "90th_percentile", "90"], max: ["max", "maximum", "peak"],
  average_fastball: ["average_fastball", "avg fastball", "average fastball", "avg_fb", "fb avg", "fastball"], max_fastball: ["max_fastball", "max fastball", "peak fastball"],
  average_four_seam: ["average_four_seam", "avg four-seam", "four-seam", "4-seam", "ff"], average_sinker: ["average_sinker", "avg sinker", "sinker", "si"] };
export function normDefinition(metric, raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const allowed = Object.keys((METRICS[metric] || {}).definitions || {});
  for (const k of allowed) if ((DEF_ALIASES[k] || [k]).includes(s) || k === s) return k;
  if (metric === "pitch_velocity" && DEF_ALIASES.average.includes(s)) return "average_fastball";
  return null;
}

/* Physical series available for comparison */
export const PHYSICAL = {
  weight: { label: "Body Weight", unit: "lb", table: "weights", field: "weight" },
  lean_mass: { label: "DEXA Lean Mass", unit: "lb", table: "dexa", field: "lean_mass" },
  body_fat: { label: "DEXA Body Fat %", unit: "%", table: "dexa", field: "body_fat_pct" },
  fat_mass: { label: "DEXA Fat Mass", unit: "lb", table: "dexa", field: "fat_mass" },
  alm: { label: "DEXA Appendicular Lean Mass", unit: "lb", table: "dexa", field: "alm" },
};

/* Plausibility ranges: values outside are rejected on entry/import (they're almost always typos). */
export const RANGES = { weight_lb: [100, 400], bf_pct: [2, 50], mass_lb: [5, 350], fluid_oz_hr: [0, 200], sodium_mg_hr: [0, 10000], vitd: [0, 200] };
export const inRange = (v, [lo, hi]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
