/* FUEL demo — synthetic players and records. EVERYTHING HERE IS FICTIONAL: names, IDs, dates of birth, phone
   numbers (555-01xx), weights, scans, notes and performance values are generated from a fixed seed. No real
   Astros player or staff information is used. Dates are laid out relative to the day the demo is created. */
import { addDays, uid } from "./shared/util.js";
import { recordFingerprint } from "./shared/imports.js";

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const DEMO_STAFF = [
  { id: "st_dw", name: "Dana Whitfield", initials: "DW", role: "dietitian", email: "dana.whitfield@demo.fuel" },
  { id: "st_cp", name: "Carlos Peña", initials: "CP", role: "dietitian", email: "carlos.pena@demo.fuel" },
  { id: "st_ml", name: "Morgan Lee", initials: "ML", role: "admin", email: "morgan.lee@demo.fuel" },
  { id: "st_ps", name: "Priya Shah", initials: "PS", role: "performance", email: "priya.shah@demo.fuel" },
  { id: "st_og", name: "Owen Grant", initials: "OG", role: "readonly", email: "owen.grant@demo.fuel" },
];
export const DEMO_USERS = {
  dietitian: { email: "dana.whitfield@demo.fuel", name: "Dana Whitfield", initials: "DW", role: "dietitian", staff_id: "st_dw" },
  admin: { email: "morgan.lee@demo.fuel", name: "Morgan Lee", initials: "ML", role: "admin", staff_id: "st_ml" },
  performance: { email: "priya.shah@demo.fuel", name: "Priya Shah", initials: "PS", role: "performance", staff_id: "st_ps" },
  readonly: { email: "owen.grant@demo.fuel", name: "Owen Grant", initials: "OG", role: "readonly", staff_id: "st_og" },
};

const FIRST = ["Mateo", "Luis", "Jake", "Evan", "Tyler", "Brandon", "Diego", "Marcus", "Cole", "Andrés", "Noah", "Javier", "Ryan", "Isaiah", "Kai", "Wyatt", "Dominic", "Elijah", "Gabriel",
  "Hunter", "Jonah", "Miguel", "Nolan", "Owen", "Rafael", "Sam", "Trevor", "Victor", "Will", "Xavier", "Yordan", "Zach", "Caleb", "Bryce", "Aaron", "Felix", "Grant", "Hector", "Ian", "Jalen",
  "Kevin", "Leo", "Max", "Nico", "Oscar", "Pedro", "Quinn", "Reid"];
const LAST = ["Rodriguez", "Rodriguez", "Miller", "Cole", "Bennett", "Ortiz", "Navarro", "Hale", "Whitaker", "Castillo", "Pryor", "Delgado", "Foster", "Grayson", "Holloway", "Ibarra", "Jansen",
  "Keller", "Lozano", "Maddox", "Nieves", "Oakes", "Pacheco", "Quintero", "Ramsey", "Salinas", "Tolliver", "Ureña", "Vance", "Wexler", "Yates", "Zamora", "Abbott", "Briggs", "Corbin", "Dawes",
  "Eaton", "Fajardo", "Gentry", "Hurtado", "Iverson", "Jaramillo", "Kingsley", "Landry", "Montes", "Nash", "Orozco", "Pruitt"];
const AFF = [["Houston", 9], ["Sugar Land", 9], ["Corpus Christi", 9], ["Asheville", 8], ["Fayetteville", 7], ["FCL Astros", 3], ["Rehab / Injured List", 3]];
const HIT_POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "SS", "CF", "C", "2B"];

export function buildDemo(today, seed = 20261105) {
  const R = rng(seed);
  const rnd = (a, b) => a + (b - a) * R();
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const gauss = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const T = (d) => `${d}T${String(13 + Math.floor(R() * 7)).padStart(2, "0")}:${String(Math.floor(R() * 60)).padStart(2, "0")}:00.000Z`;
  const out = { players: [], assignments: [], weights: [], dexa: [], hydration: [], protocols: [], goals: [], interactions: [], followups: [], performance: [], quick_entries: [], imports: [], audit: [], staff: DEMO_STAFF.map((s) => ({ ...s })) };
  const start = addDays(today, -265);            // ~mid-February: report date for spring training
  const seasonEnd = addDays(today, -40);          // ~late September
  const by = (s) => ({ created_by: s.email, author: s.email, author_name: s.name, author_initials: s.initials });
  const staffRD = [DEMO_STAFF[0], DEMO_STAFF[1]];
  let n = 0;
  for (const [aff, count] of AFF) {
    for (let k = 0; k < count; k++, n++) {
      const pitcher = n % 9 === 4 ? "TWP" : R() < 0.46 ? (R() < 0.75 ? "RHP" : "LHP") : null;
      const pos = pitcher || pick(HIT_POS);
      const age = aff === "Houston" ? Math.round(rnd(24, 33)) : aff === "Sugar Land" ? Math.round(rnd(23, 30)) : aff === "FCL Astros" ? Math.round(rnd(18, 20)) : Math.round(rnd(20, 26));
      const dob = addDays(today, -Math.round(age * 365.25 + rnd(0, 330)));
      const id = "pl_demo" + String(n).padStart(3, "0");
      const rd = staffRD[n % 2];
      const p = { id, external_id: String(70001 + n * 7), first_name: FIRST[n], last_name: LAST[n], dob, position: pos, bats: pick(["R", "R", "L", "S"]), throws: pos === "LHP" ? "L" : "R",
        height: `6'${Math.floor(rnd(0, 5))}"`, listed_weight: null, phone: `555-01${String(n).padStart(2, "0")}`, whatsapp: R() < 0.7 ? `555-01${String(n).padStart(2, "0")}` : null,
        status: aff === "Rehab / Injured List" ? "injured" : "active", dietitian: rd.id, affiliate: aff, created_at: T(start), updated_at: T(start), created_by: DEMO_STAFF[2].email };
      out.players.push(p);
      // affiliate history: some players were promoted mid-season
      const moved = n % 6 === 1 && aff !== "FCL Astros" && aff !== "Rehab / Injured List";
      const prev = { Houston: "Sugar Land", "Sugar Land": "Corpus Christi", "Corpus Christi": "Asheville", Asheville: "Fayetteville", Fayetteville: "FCL Astros" }[aff];
      if (moved && prev) {
        const moveDay = addDays(start, Math.round(rnd(90, 170)));
        out.assignments.push({ id: uid("as_"), player_id: id, affiliate: prev, start_date: start, end_date: moveDay, source: "roster", created_at: T(start), updated_at: T(moveDay), created_by: DEMO_STAFF[2].email });
        out.assignments.push({ id: uid("as_"), player_id: id, affiliate: aff, start_date: moveDay, end_date: null, source: "roster", created_at: T(moveDay), updated_at: T(moveDay), created_by: DEMO_STAFF[2].email });
      } else out.assignments.push({ id: uid("as_"), player_id: id, affiliate: aff, start_date: start, end_date: null, source: "roster", created_at: T(start), updated_at: T(start), created_by: DEMO_STAFF[2].email });

      // body: baseline and a season trend
      const base = pitcher ? rnd(190, 235) : rnd(180, 225);
      const trend = [0.035, 0.02, 0, -0.015, 0.045, 0.01][n % 6];     // lb per day
      const lmShare = rnd(0.78, 0.86);
      const weightOn = (d) => base + trend * (Math.min(d, 230)) - (d > 160 && d < 230 ? 0.012 * (d - 160) : 0);
      // weigh-ins: 2–4 a week in season, sparser off-season, real gaps, and a few players behind on check-ins
      const lastGap = n % 7 === 3 ? Math.round(rnd(11, 25)) : n % 5 === 0 ? Math.round(rnd(4, 9)) : Math.round(rnd(0, 3));
      const lastDay = 265 - lastGap;
      for (let d = 0; d <= lastDay; ) {
        const day = addDays(start, d);
        const w = Math.round((weightOn(d) + gauss() * 0.7) * 10) / 10;
        const s = staffRD[(n + d) % 2];
        out.weights.push({ id: uid("we_"), player_id: id, date: day, weight: w, unit: "lb", note: null, source: { kind: d % 23 === 0 ? "quick_entry" : "manual" }, entry_date: day, created_at: T(day), updated_at: T(day), created_by: s.email });
        const prevD = d;
        d += d > 230 ? Math.round(rnd(2, 5)) : Math.round(rnd(1, 4));
        if (R() < 0.04 && d < 220) d += Math.round(rnd(8, 16)); // travel / IL stretch with no weigh-ins
        if (d > lastDay && prevD < lastDay) d = lastDay;          // the most recent weigh-in lands on the intended day
      }
      // DEXA: spring, mid-season, end of season (+ off-season for some)
      const scans = [8, 120, 222].concat(n % 3 === 0 ? [255] : []).filter((d) => d <= 265 && !(n % 8 === 5 && d === 120));
      let fatPct = rnd(9, 17);
      for (const d of scans) {
        const day = addDays(start, d);
        const wt = weightOn(d) + gauss() * 0.5;
        const bf = Math.max(6, fatPct + (trend < 0 ? -0.004 * d : trend > 0.03 ? 0.001 * d : -0.002 * d) + gauss() * 0.4);
        const fm = wt * bf / 100, bmc = rnd(8.2, 9.4), lm = wt - fm - bmc;
        out.dexa.push({ id: uid("dx_"), player_id: id, date: day, body_fat_pct: r1(bf), lean_mass: r1(lm), fat_mass: r1(fm), alm: r1(lm * rnd(0.455, 0.49)), unit: "lb", note: null,
          source: { kind: "manual", label: "DEXA — team facility" }, entry_date: day, created_at: T(day), updated_at: T(day), created_by: rd.email });
      }
      // performance, in season only. Lean-mass gains nudge bat speed for some players (and not for others).
      const sens = n % 4 === 0 ? 0.09 : n % 4 === 1 ? 0.0 : 0.04;
      const pfStart = addDays(start, 40);
      const def90 = n % 5 === 2;
      if (pos !== "RHP" && pos !== "LHP") {
        const bs0 = rnd(68, 75), ev0 = rnd(86, 93);
        for (let d = 45; d <= 222; d += Math.round(rnd(6, 9))) {
          const day = addDays(start, d), dl = weightOn(d) - weightOn(45);
          out.performance.push(perf(id, day, "bat_speed", r1(bs0 + sens * dl + gauss() * 0.6), "average", rd));
          if (def90) out.performance.push(perf(id, day, "bat_speed", r1(bs0 + 3.4 + sens * dl + gauss() * 0.5), "p90", rd));
          out.performance.push(perf(id, day, "exit_velocity", r1(ev0 + sens * 1.3 * dl + gauss() * 1.1), "average", rd));
        }
      }
      if (pitcher) {
        const v0 = rnd(90, 96.5);
        for (let d = 46 + Math.round(rnd(0, 4)); d <= 222; d += pitcher === "TWP" ? 7 : Math.round(rnd(5, 6))) {
          const day = addDays(start, d), dl = weightOn(d) - weightOn(46);
          out.performance.push(perf(id, day, "pitch_velocity", r1(v0 + sens * 0.6 * dl - (d > 180 ? 0.006 * (d - 180) : 0) + gauss() * 0.45), "average_fastball", rd));
        }
      }
      // goals
      const gw = Math.round(base + (trend > 0.03 ? 8 : trend > 0 ? 4 : trend < 0 ? -6 : 0));
      if (trend === 0 && n % 2) out.goals.push(goal(id, "maintain", "Maintain weight through the season", start, null, null, rd));
      else out.goals.push(goal(id, "weight", `Goal weight ${gw} lb`, start, gw, "lb", rd));
      out.goals.push(goal(id, "body_comp", trend > 0.03 ? "Add lean mass; keep BF% under 14%" : trend < 0 ? "Reduce fat mass ~5 lb; hold lean mass" : "Hold lean mass through the season", start, null, null, rd));
      out.goals.push(goal(id, "strength", pick(["Consistent breakfast", "Good hydration habits", "Eats a recovery meal after games", "Likes to cook — open to meal prep"]), start, null, null, rd));
      out.goals.push(goal(id, "weakness", pick(["Skips breakfast on game days", "Low vegetable intake", "Relies on fast food on the road", "Under-eats after night games", "Late-night snacking"]), start, null, null, rd));
      if (n % 5 === 0) { const g = goal(id, "priority", "Pre-game fueling: carb-forward meal 3 h before first pitch", addDays(start, 30), null, null, rd); g.status = "achieved"; g.closed_date = addDays(start, 110); out.goals.push(g); }
      // hydration & protocols (restricted)
      if (n % 3 !== 2) out.hydration.push({ id: uid("hy_"), player_id: id, date: addDays(start, Math.round(rnd(10, 30))), hydration_card: R() < 0.8, fluid_loss_oz_hr: Math.round(rnd(24, 52)), sodium_loss_mg_hr: Math.round(rnd(650, 1600)), note: null, source: { kind: "manual" }, entry_date: addDays(start, 30), created_at: T(addDays(start, 30)), updated_at: T(addDays(start, 30)), created_by: rd.email });
      if (n % 4 === 1) out.protocols.push({ id: uid("pr_"), player_id: id, type: "vitamin_d", label: null, active: true, date: addDays(start, 12), details: "Per team physician protocol (details held by medical staff).", source: { kind: "manual" }, entry_date: addDays(start, 12), created_at: T(addDays(start, 12)), updated_at: T(addDays(start, 12)), created_by: rd.email });
      // notes
      const NOTES = [
        [10, "in_person", `Spring intake. Goals reviewed with ${p.first_name}; ${trend > 0.03 ? "wants to add size before the season" : trend < 0 ? "wants to lean out a bit" : "happy at current weight"}. Discussed breakfast routine and travel snacks.`],
        [44, "check_in", "Nutrition check-in after first homestand. Eating well at the clubhouse; skipping lunch on early-work days. Suggested a PB&J + milk before BP."],
        [77, pick(["whatsapp", "text"]), "Sent travel grocery list for the road trip. He confirmed he has shakers and protein at the hotel."],
        [118, "in_person", `Mid-season DEXA review. ${trend > 0.03 ? "Lean mass up; keep the post-training shake." : trend < 0 ? "Fat mass down, lean held — good work." : "Stable composition."} Talked about late-night meals after night games.`],
        [160, "phone", "Called — energy dipping in the heat. Increased fluids before and during games; adding electrolyte packets."],
        [205, "consultation", "Sat down to plan the off-season: three meals + two snacks, protein at each meal. Will send a grocery template."],
        [250, pick(["whatsapp", "text", "phone"]), "Off-season check-in. Training 4×/week; weighing himself Mondays and sending a photo of the scale."],
      ];
      const VARIANTS = {
        44: ["Nutrition check-in after first homestand. Eating well at the clubhouse; skipping lunch on early-work days. Suggested a PB&J + milk before BP.",
          "Check-in: appetite good, but only two meals on travel days. Planned a grab-and-go breakfast for the bus.", "Check-in after the first road trip. Hydration habits solid; wants more variety in the postgame spread."],
        77: ["Sent travel grocery list for the road trip. He confirmed he has shakers and protein at the hotel.", "Shared a fast-food ordering guide for the road. He liked the burrito-bowl option.",
          "Reminder about recovery shake within 30 min after lifting — he's been forgetting on getaway days."],
        250: ["Off-season check-in. Training 4×/week; weighing himself Mondays and sending a photo of the scale.", "Off-season: back home, cooking more. Asked for three easy high-protein dinners.",
          "Off-season check-in — eating well, sleep improved. Wants to keep weight within 2 lb of his playing weight.", "Off-season: started a hitting program; asked about pre-session snacks.", "Checked in from winter ball — food options limited; sent a shopping list for the local market."],
      };
      for (const [d0, type, text0] of NOTES) {
        const d = d0 + (d0 >= 44 ? (n % 5) - 2 : 0);
        if (d > 265 || (n % 4 === 3 && d0 === 160)) continue;
        const text = VARIANTS[d0] ? VARIANTS[d0][n % VARIANTS[d0].length] : text0;
        const day = addDays(start, d), s = staffRD[(n + d) % 2];
        out.interactions.push({ id: uid("in_"), player_id: id, date: day, time: `${String(9 + (d % 8)).padStart(2, "0")}:${d % 2 ? "30" : "00"}`, type, text, original_text: text, ...by(s), goal_id: null, history: [], source: { kind: "manual" }, entry_date: day, created_at: T(day), updated_at: T(day) });
      }
      // follow-ups: some done, some upcoming, a few overdue
      out.followups.push(fu(id, "Send off-season grocery template", addDays(start, 210), "completed", addDays(start, 208), rd));
      if (n % 3 === 0) out.followups.push(fu(id, ["Re-check weight after road trip", "Confirm he started the post-lift shake", "Review food log he promised to send", "Recheck hydration plan after the heat"][n % 4], addDays(today, -Math.round(rnd(1, 9))), "open", null, rd, n % 2 ? "high" : "normal"));
      if (n % 2 === 0) out.followups.push(fu(id, pick(["Review breakfast log", "Weigh-in and body comp check", "Follow up on electrolyte plan", "Check protein intake on travel days"]), addDays(today, Math.round(rnd(0, 12))), "open", null, rd));
    }
  }
  // the second Rodriguez shares a name with the first — same name, different person, different Player ID
  out.audit.push({ id: uid("au_"), at: new Date().toISOString(), user: "system", user_name: "FUEL demo", role: "admin", action: "seed", table: "players", record_id: null, player_id: null, player_name: null, summary: `Demo data created: ${out.players.length} synthetic players` });
  for (const r of out.performance) r.fp = recordFingerprint(r.player_id, { table: "performance", ...r });
  return out;

  function perf(pid, day, metric, value, definition, s) {
    return { id: uid("pf_"), player_id: pid, date: day, metric, value, unit: "mph", definition, source_label: metric === "pitch_velocity" ? "Game tracking (synthetic)" : "Batting cage sensor (synthetic)", notes: null, source: { kind: "manual" }, created_at: T(day), updated_at: T(day), created_by: DEMO_STAFF[3].email };
  }
  function goal(pid, type, description, startDate, target, unit, s) {
    return { id: uid("go_"), player_id: pid, type, description, start_date: startDate, target_date: null, status: "active", target_value: target, target_unit: unit, progress: [], source: { kind: "manual" }, created_at: T(startDate), updated_at: T(startDate), created_by: s.email };
  }
  function fu(pid, description, due, status, done, s, priority = "normal") {
    return { id: uid("fu_"), player_id: pid, description, assignee: s.id, due_date: due, priority, status, completed_date: done, interaction_id: null, created_at: T(addDays(due, -7)), updated_at: T(addDays(due, -7)), created_by: s.email };
  }
}
const r1 = (x) => Math.round(x * 10) / 10;
