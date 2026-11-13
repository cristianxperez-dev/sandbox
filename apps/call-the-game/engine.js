/* Call the Game — engine (pure; shared by the page and the Node tests). No DOM, no animation.

   Coordinates (one system everywhere: scouting graphics, input, simulation, scoring, replay):
     catcher's view of the plate, in feet.  x = horizontal, + = catcher's right (first-base side);  z = height above the ground.
     Strike zone (incl. ball radius): |x| ≤ 0.83, 1.55 ≤ z ≤ 3.45.
     Pitcher-relative horizontal "arm-side" coordinate a = x · armSign, armSign = −1 for a RHP (his arm side is the catcher's left,
     third-base side), +1 for a LHP. Profiles describe biases, movement and corridors in arm-side units so one profile reads the
     same for either hand.

   Modules (sections below): profiles · random · execution (catcher target → actual endpoint) · hitter (swing / contact / batted
   ball) · rules (count, bases, outs, inning) · evaluation (location quality, usage compliance, feedback). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CTG = Object.assign(root.CTG || {}, api);
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  /* ======================================================================== constants */
  const ZONE = { half: 0.83, bot: 1.55, top: 3.45, mid: 2.5 };
  const PITCH_COLORS = { FF: "#D04848", FT: "#E8833A", SI: "#E8833A", FC: "#9A6A3A", SL: "#E1B93B", SW: "#C9A227", CU: "#3F7FBF", CH: "#3E9E5D", SF: "#2BA59A" };
  const PITCH_NAMES = { FF: "Four-seam", FT: "Sinker", SI: "Sinker", FC: "Cutter", SL: "Slider", SW: "Sweeper", CU: "Curveball", CH: "Changeup", SF: "Splitter" };
  const armSign = (hand) => (hand === "L" ? 1 : -1);
  const DEFAULTS = { weights: { usage: 0.5, location: 0.5 }, playbackSlow: 1.5 };

  /* ======================================================================== pitcher profiles (fictional, illustrative) */
  /* miss: biasArm / biasUp in inches (systematic offset of the endpoint from the glove), sdH / sdV inches (1σ dispersion), rho
     (correlation of the horizontal and vertical error), wild (share of pitches drawn from a 2.3× wider "yank" component),
     sideSd {arm, glove}: dispersion multiplier when the glove is set on that side (command that differs by side).
     corridor: preferred locations — gaussian bumps in (a, z) with weight w; optional per batter hand (corridorByHand).
     countMod: usage multipliers by count context (first, ahead, even, behind, two) — legitimate plan variation by count. */
  const PITCHERS = [
    {
      id: "whitaker", name: "Cole Whitaker", hand: "R", age: 26, height: "6'4\"", weight: 215, style: "Power four-seam / sweeping slider",
      body: { scale: 1.05, build: 1.0 }, jersey: { main: "#F3EEE3", trim: "#1F2A44", cap: "#1F2A44", num: "41" },
      summary: "Attacks with a riding four-seamer at the top of the zone and a sweeping slider that runs glove-side. The changeup is a real pitch to lefties and a show-me pitch to righties.",
      plan: "Establish the four-seamer at the top of the zone. Let the slider work glove-side, most of all with two strikes, and set up a touch arm-side of where you want it to finish — it sweeps past your glove. The fastball misses arm-side and up, so keep your target a little inside of the top edge. Against lefties, bring in the changeup low and away without abandoning the fastball.",
      arsenal: [
        { code: "FF", velo: 95.8, veloSd: 0.7, hbArm: 8.5, ivb: 17.5, stuff: 0.62, gb: 0.30, usage: { R: 0.55, L: 0.50 },
          miss: { biasArm: 2.2, biasUp: 1.6, sdH: 4.6, sdV: 4.8, rho: 0.15, wild: 0.04 },
          corridor: [{ a: 0.15, z: 3.35, sa: 0.5, sz: 0.25, w: 1 }, { a: 0.1, z: 3.75, sa: 0.5, sz: 0.2, w: 0.55 }],
          countMod: { first: 1.15, ahead: 0.9, even: 1.0, behind: 1.35, two: 0.85 }, note: "Best at the top third and just above it. Misses arm-side and up." },
        { code: "SL", velo: 85.4, veloSd: 0.9, hbArm: -15, ivb: 1.5, stuff: 0.78, gb: 0.42, usage: { R: 0.37, L: 0.18 },
          miss: { biasArm: -3.0, biasUp: -0.8, sdH: 5.4, sdV: 4.9, rho: 0.30, wild: 0.05 },
          corridor: [{ a: -0.72, z: 1.75, sa: 0.32, sz: 0.4, w: 1 }, { a: -1.05, z: 1.25, sa: 0.32, sz: 0.3, w: 0.8 }],
          countMod: { first: 0.85, ahead: 1.2, even: 1.0, behind: 0.65, two: 1.35 }, note: "Glove-side edge and below. Sweeps past the glove — misses glove-side." },
        { code: "CH", velo: 87.0, veloSd: 1.0, hbArm: 14, ivb: 7.5, stuff: 0.48, gb: 0.50, usage: { R: 0.08, L: 0.32 },
          miss: { biasArm: 1.0, biasUp: -1.4, sdH: 6.0, sdV: 6.0, rho: 0.0, wild: 0.07 },
          corridor: [{ a: 0.55, z: 1.4, sa: 0.38, sz: 0.32, w: 1 }],
          countMod: { first: 0.8, ahead: 1.15, even: 1.0, behind: 0.75, two: 1.2 }, note: "Down, finishing below the zone arm-side. Volatile command." },
      ],
    },
    {
      id: "fuentes", name: "Diego Fuentes", hand: "R", age: 29, height: "6'2\"", weight: 205, style: "Sinker / changeup ground-ball profile",
      body: { scale: 1.0, build: 1.08 }, jersey: { main: "#F3EEE3", trim: "#5A1B22", cap: "#5A1B22", num: "57" },
      summary: "A ground-ball pitcher. The sinker bores arm-side and down, the changeup dives under it, and the cutter gives lefties something to think about on their hands.",
      plan: "Live at the bottom of the zone with the sinker and let it run arm-side — set up a little toward the middle, because it keeps running past your glove. Against lefties the changeup is a primary pitch: ask for it at the bottom edge, not below it, because it finishes under the target. Mix the cutter in on lefties' hands and glove-side to righties.",
      arsenal: [
        { code: "FT", velo: 93.2, veloSd: 0.7, hbArm: 16, ivb: 7, stuff: 0.50, gb: 0.70, usage: { R: 0.60, L: 0.45 },
          miss: { biasArm: 3.1, biasUp: -0.5, sdH: 4.8, sdV: 4.4, rho: -0.15, wild: 0.04 },
          corridor: [{ a: 0.55, z: 1.85, sa: 0.38, sz: 0.38, w: 1 }, { a: 0.85, z: 2.3, sa: 0.25, sz: 0.4, w: 0.45 }],
          countMod: { first: 1.2, ahead: 0.95, even: 1.0, behind: 1.3, two: 0.85 }, note: "Bottom of the zone, arm-side. Runs farther arm-side than you set up." },
        { code: "CH", velo: 84.6, veloSd: 0.9, hbArm: 15, ivb: 4, stuff: 0.66, gb: 0.62, usage: { R: 0.15, L: 0.42 },
          miss: { biasArm: 0.6, biasUp: -2.6, sdH: 5.2, sdV: 5.8, rho: 0.0, wild: 0.05 },
          corridor: [{ a: 0.4, z: 1.35, sa: 0.42, sz: 0.3, w: 1 }],
          countMod: { first: 0.8, ahead: 1.2, even: 1.0, behind: 0.7, two: 1.35 }, note: "Below the zone. Finishes under the glove — set up at the bottom edge." },
        { code: "FC", velo: 89.1, veloSd: 0.8, hbArm: -3, ivb: 11, stuff: 0.52, gb: 0.45, usage: { R: 0.25, L: 0.13 },
          miss: { biasArm: -0.8, biasUp: 0.6, sdH: 4.6, sdV: 4.6, rho: 0.1, wild: 0.03 },
          corridor: [{ a: -0.65, z: 2.4, sa: 0.3, sz: 0.5, w: 1 }],
          countMod: { first: 1.0, ahead: 1.0, even: 1.0, behind: 1.0, two: 0.9 }, note: "Glove-side edge, middle height. Tight command." },
      ],
    },
    {
      id: "kessler", name: "Ryan Kessler", hand: "L", age: 24, height: "6'1\"", weight: 195, style: "Balanced four-seam / cutter / curveball",
      body: { scale: 0.98, build: 0.95 }, jersey: { main: "#F3EEE3", trim: "#24395E", cap: "#24395E", num: "33" },
      summary: "A left-hander with a balanced mix. Commands the glove side well; arm-side his command loosens. The curveball is his put-away pitch, more so against lefties.",
      plan: "Use all three pitches. Work the four-seamer up and the cutter glove-side, where his command is tightest. When you ask for something arm-side, give him a bigger target closer to the zone — that side scatters. The curveball tends to hang a little: set up below the zone to have it finish at the bottom edge, and lean on it more against lefties.",
      arsenal: [
        { code: "FF", velo: 93.4, veloSd: 0.8, hbArm: 7, ivb: 16, stuff: 0.55, gb: 0.32, usage: { R: 0.45, L: 0.52 },
          miss: { biasArm: 1.4, biasUp: 0.8, sdH: 4.8, sdV: 4.6, rho: 0.1, wild: 0.04, sideSd: { arm: 1.4, glove: 0.85 } },
          corridor: [{ a: -0.2, z: 3.3, sa: 0.5, sz: 0.28, w: 1 }],
          countMod: { first: 1.15, ahead: 0.9, even: 1.0, behind: 1.3, two: 0.9 }, note: "Up in the zone. Glove-side command tight, arm-side looser." },
        { code: "FC", velo: 88.2, veloSd: 0.8, hbArm: -4, ivb: 9, stuff: 0.58, gb: 0.42, usage: { R: 0.32, L: 0.12 },
          miss: { biasArm: -1.0, biasUp: 0.2, sdH: 4.0, sdV: 4.3, rho: 0.1, wild: 0.03, sideSd: { arm: 1.3, glove: 0.85 } },
          corridor: [{ a: -0.7, z: 2.2, sa: 0.28, sz: 0.5, w: 1 }],
          countMod: { first: 1.0, ahead: 1.05, even: 1.0, behind: 1.05, two: 1.0 }, note: "Glove-side edge — in on righties' hands. Tight." },
        { code: "CU", velo: 78.5, veloSd: 1.0, hbArm: -6, ivb: -13, stuff: 0.70, gb: 0.52, usage: { R: 0.23, L: 0.36 },
          miss: { biasArm: -0.5, biasUp: 1.8, sdH: 5.5, sdV: 6.2, rho: 0.2, wild: 0.06, sideSd: { arm: 1.2, glove: 0.95 } },
          corridor: [{ a: -0.2, z: 1.35, sa: 0.5, sz: 0.32, w: 1 }],
          countMod: { first: 0.95, ahead: 1.2, even: 1.0, behind: 0.6, two: 1.4 }, note: "Bottom edge and below. Tends to hang above the glove." },
      ],
    },
  ];
  /** validate a pitcher profile (usage sums, codes) — throws on error */
  function validatePitcher(p) {
    for (const h of ["R", "L"]) {
      const s = p.arsenal.reduce((t, a) => t + a.usage[h], 0);
      if (Math.abs(s - 1) > 1e-6) throw new Error(`${p.id}: usage vs ${h}HH sums to ${s}`);
    }
    for (const a of p.arsenal) if (!PITCH_COLORS[a.code]) throw new Error(`${p.id}: unknown pitch ${a.code}`);
    return true;
  }
  PITCHERS.forEach(validatePitcher);
  const pitcherById = (id) => PITCHERS.find((p) => p.id === id);
  const pitchDef = (p, code) => p.arsenal.find((a) => a.code === code);

  /* ======================================================================== random (seeded) */
  function hash(...parts) { let h = 2166136261 >>> 0; for (const part of parts) for (const c of String(part)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** independent stream per purpose: the same seed + key always gives the same draws, whatever was decided before */
  const stream = (seed, ...key) => rng(hash(seed, ...key));
  const normal = (r) => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sigmoid = (t) => 1 / (1 + Math.exp(-t));

  /* ======================================================================== execution: target → endpoint */
  /** the miss distribution for a pitch and a glove target: mean offset (ft, catcher x/z) and the error model in arm-side units */
  function missModel(p, def, target) {
    const s = armSign(p.hand), m = def.miss;
    const aT = target.x * s;
    let sdA = m.sdH / 12;
    if (m.sideSd) { const t = clamp(aT / 0.8, -1, 1); sdA *= t >= 0 ? 1 + (m.sideSd.arm - 1) * t : 1 + (m.sideSd.glove - 1) * -t; }
    return { s, mx: (m.biasArm / 12) * s, mz: m.biasUp / 12, sdA, sdz: m.sdV / 12, rho: m.rho || 0, wild: m.wild || 0, wildScale: 2.3 };
  }
  /** one execution error for standard normal draws (z1, z2): correlated in arm/up units, returned in catcher x/z */
  function missOffset(M, z1, z2, scale) {
    const ea = M.sdA * z1 * scale, ez = M.sdz * (M.rho * z1 + Math.sqrt(1 - M.rho * M.rho) * z2) * scale;
    return { dx: M.mx + ea * M.s, dz: M.mz + ez };
  }
  /** actual endpoint = glove target + systematic bias + correlated execution error (and an occasional yank) */
  function execute(p, code, target, r) {
    const def = pitchDef(p, code), M = missModel(p, def, target);
    const z1 = normal(r), z2 = normal(r), wild = r() < M.wild;
    const o = missOffset(M, z1, z2, wild ? M.wildScale : 1);
    const velo = def.velo + def.veloSd * normal(r);
    return { x: Math.round(clamp(target.x + o.dx, -3, 3) * 1000) / 1000, z: Math.round(clamp(target.z + o.dz, 0.2, 6) * 1000) / 1000, velo: Math.round(velo * 10) / 10, wild };
  }
  /** flight geometry for rendering: release point and movement (ft) so the animation ends exactly at the endpoint */
  function flight(p, def, end) {
    const s = armSign(p.hand), velo = end.velo || def.velo;
    const release = { x: s * 1.75, y: 54.3, z: 5.85 };
    const T = (54.3 + 1.4) / (velo * 1.4667);                       // seconds to the front of the plate
    const gravDrop = 16.1 * T * T;                                   // ft, gravity over the flight
    const breakX = s * (def.hbArm / 12), breakZ = -(gravDrop - def.ivb / 12);
    return { release, end: { x: end.x, y: 0, z: end.z }, T, breakX, breakZ };
  }
  /** position along the flight at fraction t∈[0,1]: chord + movement deviation (zero at both ends, so it lands on the endpoint) */
  function flightAt(f, t) {
    const d = t * t - t;
    return { x: f.release.x + (f.end.x - f.release.x) * t + f.breakX * d, y: f.release.y + (f.end.y - f.release.y) * t, z: f.release.z + (f.end.z - f.release.z) * t + f.breakZ * d };
  }

  /* ======================================================================== hitter model */
  const zoneInfo = (x, z) => {
    const dx = Math.abs(x) - ZONE.half, dz = Math.max(ZONE.bot - z, z - ZONE.top);
    const inZone = dx <= 0 && dz <= 0;
    const edge = inZone ? Math.max(dx, dz) : Math.hypot(Math.max(dx, 0), Math.max(dz, 0));   // ≤ 0 inside (depth), > 0 outside
    const heart = Math.exp(-(x * x) / (2 * 0.3 * 0.3) - ((z - ZONE.mid) ** 2) / (2 * 0.35 * 0.35));
    return { inZone, edge, heart };
  };
  /** probabilities for one pitch: swing, whiff (given swing), foul (given contact), called strike (given take) */
  function pitchProbs(def, loc, count, batter) {
    const zi = zoneInfo(loc.x, loc.z), b = count.balls, s = count.strikes, disc = batter.discipline || 1, con = batter.contact || 1;
    let swing;
    if (zi.inZone) swing = 0.6 + 0.22 * zi.heart;
    else swing = 0.5 * Math.exp(-zi.edge / 0.36) * (1 + (def.stuff - 0.5) * 0.9);
    if (b === 3 && s === 0) swing *= zi.inZone ? 0.25 : 0.06;
    else if (b === 0 && s === 0) swing *= 0.8;
    else if (s === 2) swing = zi.inZone ? Math.min(0.94, swing * 1.22) : swing * 1.55;
    else if (b > s) swing *= zi.inZone ? 1.05 : 0.8;
    swing = clamp(swing / (zi.inZone ? 1 : disc), 0.01, 0.95);
    let whiff = 0.05 + 0.26 * def.stuff + (zi.inZone ? 0.06 * clamp(1 + zi.edge / 0.25, 0, 1) - 0.13 * zi.heart : 0.08 + 0.2 * Math.min(1, zi.edge / 0.45));
    if (loc.z > ZONE.top && (def.code === "FF")) whiff += 0.08;            // elevated four-seamers get swung under
    whiff = clamp(whiff / con, 0.04, 0.8);
    const foul = zi.inZone ? 0.3 + 0.2 * (1 - zi.heart) : 0.55;
    const calledStrike = sigmoid(-zi.edge / 0.045);
    return { swing, whiff, foul, calledStrike, zone: zi };
  }
  /** decide what happens on one pitch. Returns { kind: ball|called|whiff|foul|foultip|inplay, bip? } */
  function resolvePitch(def, loc, count, batter, r) {
    const pr = pitchProbs(def, loc, count, batter);
    if (r() >= pr.swing) return { kind: r() < pr.calledStrike ? "called" : "ball", swing: false, probs: pr };
    if (r() < pr.whiff) return { kind: "whiff", swing: true, probs: pr };
    if (r() < pr.foul) return { kind: count.strikes === 2 && r() < 0.07 ? "foultip" : "foul", swing: true, probs: pr };
    return { kind: "inplay", swing: true, probs: pr, bip: battedBall(def, loc, batter, pr.zone, r) };
  }
  /** batted-ball type and result from contact quality */
  function battedBall(def, loc, batter, zi, r) {
    const outside = zi.inZone ? 0 : Math.min(1, zi.edge / 0.4);
    let q = 0.46 + 0.52 * zi.heart - 0.16 * def.stuff - 0.25 * outside + 0.17 * normal(r) + 0.08 * ((batter.power || 1) - 1);
    q = clamp(q, 0, 1);
    const low = clamp((2.3 - loc.z) / 0.8, 0, 1), high = clamp((loc.z - 2.9) / 0.6, 0, 1);
    const pGround = clamp(0.38 + 0.32 * (def.gb - 0.45) + 0.18 * low - 0.18 * high, 0.15, 0.75);
    const pLine = 0.2 + 0.1 * q;
    const u = r();
    let type = u < pGround ? "ground" : u < pGround + pLine ? "line" : "fly";
    if (type === "fly" && q < 0.32 && r() < 0.45) type = "popup";
    let result = "out";
    const v = r();
    if (type === "ground") result = v < 0.17 + 0.26 * Math.max(0, q - 0.55) ? (r() < 0.07 ? "double" : "single") : "out";
    else if (type === "line") result = v < 0.52 + 0.3 * q ? (r() < 0.24 + 0.2 * q ? (r() < 0.06 ? "triple" : "double") : "single") : "out";
    else if (type === "fly") result = v < clamp(0.3 * (q - 0.42) / 0.4, 0, 0.38) ? "homer" : r() < 0.06 + 0.2 * q ? (r() < 0.45 ? "double" : "single") : "out";
    // spray: pull side for the batter (RHH pulls to left field = catcher's left)
    const pull = batter.hand === "R" ? -1 : 1, spray = clamp(pull * (0.35 + 0.3 * normal(r) * 0.6) + (loc.x * (batter.hand === "R" ? 1 : -1)) * -0.25, -0.95, 0.95);
    return { type, quality: Math.round(q * 100) / 100, result, spray: Math.round(spray * 100) / 100 };
  }

  /* ======================================================================== hitters (fictional) */
  const FIRST = ["Marcus", "Tyler", "Jordan", "Luis", "Carlos", "Ethan", "Brandon", "Kevin", "Andrés", "Jalen", "Nate", "Rafael", "Owen", "Darius", "Miguel", "Cody", "Isaiah", "Pedro"];
  const LAST = ["Hollis", "Brennan", "Okafor", "Medina", "Castillo", "Pruitt", "Vance", "Sutter", "Ibarra", "Caldwell", "Rourke", "Delgado", "Whitfield", "Banks", "Serrano", "Lockhart", "Moreland", "Quintero"];
  function lineup(seed) {
    const r = stream(seed, "lineup"), used = new Set(), out = [];
    for (let i = 0; i < 9; i++) {
      let name; do { name = FIRST[Math.floor(r() * FIRST.length)] + " " + LAST[Math.floor(r() * LAST.length)]; } while (used.has(name)); used.add(name);
      out.push({ id: "h" + i, name, hand: r() < 0.58 ? "R" : "L", pos: ["CF", "SS", "1B", "RF", "3B", "LF", "C", "2B", "DH"][i],
        body: { scale: 0.94 + r() * 0.14, build: 0.88 + r() * 0.32 }, stance: { open: r() < 0.3 ? 0.3 : r() < 0.4 ? -0.15 : 0, crouch: r() * 0.35, hands: r() * 0.4 - 0.2 },
        discipline: 0.85 + r() * 0.3, contact: 0.85 + r() * 0.3, power: 0.8 + r() * 0.45, skin: ["#8D5524", "#C68642", "#E0AC69", "#F1C27D", "#5C3A21", "#A0673A"][Math.floor(r() * 6)] });
    }
    return out;
  }

  /* ======================================================================== rules: count, bases, outs */
  function newInning(opts) {
    const o = opts || {};
    return { seed: o.seed >>> 0, pitcherId: o.pitcherId, lineup: o.lineup || lineup(o.seed >>> 0), batterIdx: 0, outs: 0, balls: 0, strikes: 0,
      bases: [null, null, null], runs: 0, pitches: 0, pitchInPA: 0, pa: 0, over: false, calls: [], events: [], stats: { H: 0, BB: 0, K: 0, BF: 0 } };
  }
  const batterOf = (st) => st.lineup[st.batterIdx % st.lineup.length];
  const countCtx = (b, s) => (b === 0 && s === 0 ? "first" : s === 2 && b < 3 ? "two" : b > s || b === 3 ? "behind" : s > b ? "ahead" : "even");
  function advance(st, result, bip, r) {
    const b = st.bases.slice(), batter = batterOf(st).id; let runs = 0, outs = 0, text = "";
    const score = (n) => { runs += n; };
    if (result === "walk") {
      if (b[0]) { if (b[1]) { if (b[2]) score(1); b[2] = b[1]; } b[1] = b[0]; } b[0] = batter;
    } else if (result === "single") {
      if (b[2]) { score(1); b[2] = null; }
      if (b[1]) { if (r() < 0.62) score(1); else b[2] = b[1]; b[1] = null; }
      if (b[0]) { if (!b[2] && r() < 0.28) b[2] = b[0]; else b[1] = b[0]; }
      b[0] = batter;
    } else if (result === "double") {
      score((b[2] ? 1 : 0) + (b[1] ? 1 : 0)); const first = b[0]; b[2] = null; b[1] = batter; b[0] = null;
      if (first) { if (r() < 0.42) score(1); else b[2] = first; }
    } else if (result === "triple") { score(b.filter(Boolean).length); b[0] = b[1] = null; b[2] = batter; }
    else if (result === "homer") { score(b.filter(Boolean).length + 1); b[0] = b[1] = b[2] = null; }
    else if (result === "out") {
      outs = 1;
      if (bip && bip.type === "ground" && b[0] && st.outs < 2 && r() < 0.42) { outs = 2; text = "double play"; b[0] = null; if (b[1] && !b[2]) { b[2] = b[1]; b[1] = null; } }
      else if (bip && bip.type === "ground" && st.outs < 2) {
        if (b[2] && !b[0] && r() < 0.45) { score(1); b[2] = null; }
        if (b[1] && !b[0] && r() < 0.5) { if (!b[2]) { b[2] = b[1]; b[1] = null; } }
        if (b[0]) { // force at second, batter safe at first
          if (b[1]) { if (b[2]) { if (st.outs + 1 < 3) score(1); } b[2] = b[1]; } b[1] = null; b[0] = batter; text = "fielder's choice";
        }
      } else if (bip && bip.type === "fly" && b[2] && st.outs < 2 && r() < 0.55) { score(1); b[2] = null; text = "sacrifice fly"; }
    }
    if (st.outs + outs >= 3) runs = result === "out" ? 0 : runs;   // the third out on a batted ball ends the inning (simplified: no runs on that play)
    st.bases = b; st.runs += runs; st.outs += outs;
    return { runs, outs, text };
  }
  /** apply one pitch outcome to the game state; returns the baseball event */
  function applyPitch(st, res, r) {
    const before = { balls: st.balls, strikes: st.strikes, outs: st.outs, bases: st.bases.map((x) => !!x), runs: st.runs };
    st.pitches++; st.pitchInPA++;
    let ev = { kind: res.kind, paEnd: false, label: "" };
    const endPA = (label, extra) => { ev.paEnd = true; ev.label = label; Object.assign(ev, extra || {}); st.stats.BF++; st.balls = 0; st.strikes = 0; st.pitchInPA = 0; st.batterIdx++; st.pa++; };
    if (res.kind === "ball") { st.balls++; ev.label = "Ball"; if (st.balls === 4) { const a = advance(st, "walk", null, r); st.stats.BB++; endPA("Walk", { runs: a.runs }); } }
    else if (res.kind === "called" || res.kind === "whiff" || res.kind === "foultip") {
      ev.label = res.kind === "called" ? "Called strike" : res.kind === "whiff" ? "Swinging strike" : "Foul tip";
      if (st.strikes === 2) { st.outs++; st.stats.K++; endPA(res.kind === "called" ? "Strikeout looking" : "Strikeout swinging"); } else st.strikes++;
    } else if (res.kind === "foul") { ev.label = "Foul"; if (st.strikes < 2) st.strikes++; }
    else if (res.kind === "inplay") {
      const bip = res.bip, a = advance(st, bip.result, bip, r);
      if (bip.result !== "out") st.stats.H++;
      const names = { single: "Single", double: "Double", triple: "Triple", homer: "Home run", out: { ground: "Groundout", line: "Lineout", fly: "Flyout", popup: "Pop-up" }[bip.type] };
      endPA(a.text === "double play" ? "Double play" : a.text === "fielder's choice" ? "Fielder's choice" : a.text === "sacrifice fly" ? "Sacrifice fly" : names[bip.result], { runs: a.runs, bip });
    }
    if (st.outs >= 3) { st.outs = 3; st.over = true; }
    ev.before = before; ev.after = { balls: st.balls, strikes: st.strikes, outs: st.outs, bases: st.bases.map((x) => !!x), runs: st.runs };
    return ev;
  }
  /** one full pitch: the catcher's call → execution → hitter → rules. Draws come from per-pitch streams (Retry reproduces them). */
  function playPitch(st, call) {
    const p = pitcherById(st.pitcherId), def = pitchDef(p, call.code), batter = batterOf(st);
    const count = { balls: st.balls, strikes: st.strikes };
    const end = execute(p, call.code, call.target, stream(st.seed, "exec", st.pitches));
    const res = resolvePitch(def, end, count, batter, stream(st.seed, "hit", st.pitches));
    const evalu = evaluateCall(p, call.code, call.target, batter.hand, count);
    const record = { n: st.pitches + 1, batter: { id: batter.id, name: batter.name, hand: batter.hand }, count, outs: st.outs, bases: st.bases.map((x) => !!x),
      code: call.code, target: { x: call.target.x, z: call.target.z }, end, result: res.kind, bip: res.bip || null, swing: res.swing, eval: evalu, at: Date.now() };
    const ev = applyPitch(st, res, stream(st.seed, "run", st.pitches));
    record.event = { label: ev.label, paEnd: ev.paEnd, runs: ev.runs || 0 }; record.after = ev.after;
    st.calls.push(record);
    return record;
  }

  /* ======================================================================== evaluation: location quality */
  /** value of a pitch finishing at (x, z): preferred corridors (+), the heart of the plate (−), non-competitive misses (−); count-aware */
  function locationValue(p, def, hand, count, x, z) {
    const s = armSign(p.hand), a = x * s, zi = zoneInfo(x, z);
    const b = count ? count.balls : 0, k = count ? count.strikes : 0;
    const corr = (def.corridorByHand && def.corridorByHand[hand]) || def.corridor;
    let good = 0;
    for (const c of corr) {
      let w = c.w;
      const cOut = !zoneInfo(c.a * s, c.z).inZone;
      if (cOut && b === 3 && k < 2) w *= 0.4;          // must throw a strike: chase corridors are worth less
      else if (cOut && b === 2 && k < 2) w *= 0.75;
      if (cOut && k === 2 && b < 3) w *= 1.2;          // two strikes: chase corridors are worth more
      good += w * Math.exp(-((a - c.a) ** 2) / (2 * c.sa * c.sa) - ((z - c.z) ** 2) / (2 * c.sz * c.sz));
    }
    // a strike is worth more the more balls there are (and least with two strikes, when the chase is the goal)
    const strikeW = k === 2 && b < 3 ? 0.12 : [0.28, 0.36, 0.5, 0.75][b];
    const pStrike = sigmoid(-zi.edge / 0.07);
    const heartPen = 0.7 * Math.exp(-(x * x) / (2 * 0.26 * 0.26) - ((z - ZONE.mid) ** 2) / (2 * 0.3 * 0.3));
    const nonComp = zi.inZone ? 0 : 0.5 * clamp((zi.edge - 0.45) / 0.6, 0, 1);
    return Math.min(1, good) + strikeW * pStrike - heartPen - nonComp;
  }
  /* fixed quadrature: 9×9 Gauss–Hermite-style grid of standard normal points (deterministic) */
  const QP = (() => { const pts = [-2.6, -1.8, -1.1, -0.5, 0, 0.5, 1.1, 1.8, 2.6]; const w = pts.map((t) => Math.exp(-t * t / 2)); const sw = w.reduce((a, b) => a + b, 0); return { pts, w: w.map((v) => v / sw) }; })();
  /** expected location value of a glove target: the value field averaged over the pitcher's miss distribution (before the pitch) */
  function expectedQuality(p, code, target, hand, count) {
    const def = pitchDef(p, code), M = missModel(p, def, target);
    let core = 0, wild = 0;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      const w = QP.w[i] * QP.w[j], o = missOffset(M, QP.pts[i], QP.pts[j], 1), ow = missOffset(M, QP.pts[i], QP.pts[j], M.wildScale);
      core += w * locationValue(p, def, hand, count, target.x + o.dx, target.z + o.dz);
      wild += w * locationValue(p, def, hand, count, target.x + ow.dx, target.z + ow.dz);
    }
    return (1 - M.wild) * core + M.wild * wild;
  }
  const GRID = (() => { const g = []; for (let x = -1.7; x <= 1.701; x += 0.1) for (let z = 0.7; z <= 4.401; z += 0.1) g.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }); return g; })();
  const optCache = new Map();
  /** the model-preferred glove target for a pitch, batter hand and count (review only) */
  function optimalTarget(p, code, hand, count) {
    const key = [p.id, code, hand, countCtx(count.balls, count.strikes), count.balls === 3 ? 3 : 0].join("|");
    if (optCache.has(key)) return optCache.get(key);
    let best = null;
    for (const t of GRID) { const q = expectedQuality(p, code, t, hand, count); if (!best || q > best.q) best = { x: t.x, z: t.z, q }; }
    // refine on a finer local grid
    const b0 = best;
    for (let dx = -0.08; dx <= 0.081; dx += 0.02) for (let dz = -0.08; dz <= 0.081; dz += 0.02) {
      const t = { x: b0.x + dx, z: b0.z + dz }, q = expectedQuality(p, code, t, hand, count); if (q > best.q) best = { x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, q };
    }
    optCache.set(key, best);
    return best;
  }
  /** grade a glove target 0–100: where its expected quality sits between a middle-middle setup and the model-preferred setup */
  function evaluateCall(p, code, target, hand, count) {
    const opt = optimalTarget(p, code, hand, count);
    const q = expectedQuality(p, code, target, hand, count);
    const ref = expectedQuality(p, code, { x: 0, z: ZONE.mid }, hand, count);
    const span = Math.max(0.05, opt.q - ref);
    const g = clamp((q - ref) / span, 0, 1);
    const grade = Math.round(100 * Math.pow(g, 0.85));
    const def = pitchDef(p, code), M = missModel(p, def, target), s = armSign(p.hand);
    const expEnd = { x: Math.round((target.x + M.mx) * 100) / 100, z: Math.round((target.z + M.mz) * 100) / 100 };
    // pitch-choice context (shown, not graded per pitch): how this pitch fits the plan in this count
    const pv = planProbs(p, hand, countCtx(count.balls, count.strikes));
    const share = pv[code];
    return { grade, q: round3(q), qOpt: round3(opt.q), qRef: round3(ref), opt: { x: opt.x, z: opt.z }, expEnd,
      offset: { arm: round3((target.x - opt.x) * s), up: round3(target.z - opt.z) }, planShare: round3(share), ctx: countCtx(count.balls, count.strikes) };
  }
  const round3 = (v) => Math.round(v * 1000) / 1000;

  /* ======================================================================== evaluation: usage compliance */
  /** plan probabilities for a batter hand in a count context: target usage × count modifier, renormalised */
  function planProbs(p, hand, ctx) {
    const raw = p.arsenal.map((a) => a.usage[hand] * ((a.countMod && a.countMod[ctx]) || 1));
    const s = raw.reduce((t, v) => t + v, 0);
    return Object.fromEntries(p.arsenal.map((a, i) => [a.code, raw[i] / s]));
  }
  /** usage score for one batter hand: Monte-Carlo test of the called mix against the count-aware plan (sample-size aware) */
  function usageScore(p, calls, hand) {
    const cs = calls.filter((c) => c.batter.hand === hand);
    const codes = p.arsenal.map((a) => a.code);
    if (!cs.length) return { hand, n: 0, graded: false };
    const probs = cs.map((c) => planProbs(p, hand, countCtx(c.count.balls, c.count.strikes)));
    const E = Object.fromEntries(codes.map((k) => [k, probs.reduce((t, pv) => t + pv[k], 0)]));
    const O = Object.fromEntries(codes.map((k) => [k, cs.filter((c) => c.code === k).length]));
    const stat = (o) => codes.reduce((t, k) => t + (E[k] > 0 ? ((o[k] - E[k]) ** 2) / E[k] : 0), 0);
    const x2 = stat(O);
    const r = rng(hash("usage-mc", p.id, hand, cs.length)), N = 3000;
    let ge = 0;
    for (let i = 0; i < N; i++) {
      const o = Object.fromEntries(codes.map((k) => [k, 0]));
      for (const pv of probs) { let u = r(), k0 = codes[codes.length - 1]; for (const k of codes) { if (u < pv[k]) { k0 = k; break; } u -= pv[k]; } o[k0]++; }
      if (stat(o) >= x2 - 1e-9) ge++;
    }
    const pval = (ge + 1) / (N + 1);
    const score = Math.round(100 * clamp(1 + 0.3 * Math.log10(pval / 0.5), 0, 1));
    const target = Object.fromEntries(codes.map((k) => [k, p.arsenal.find((a) => a.code === k).usage[hand]]));
    const actual = Object.fromEntries(codes.map((k) => [k, O[k] / cs.length]));
    return { hand, n: cs.length, graded: true, score, pval: round3(pval), x2: round3(x2), expected: Object.fromEntries(codes.map((k) => [k, round3(E[k])])), observed: O, target, actual };
  }
  /** the full catcher evaluation for an inning */
  function evaluateInning(st, cfg) {
    const p = pitcherById(st.pitcherId), w = Object.assign({}, DEFAULTS.weights, cfg && cfg.weights);
    const R = usageScore(p, st.calls, "R"), L = usageScore(p, st.calls, "L");
    const graded = [R, L].filter((u) => u.graded);
    const usage = graded.length ? Math.round(graded.reduce((t, u) => t + u.score * u.n, 0) / graded.reduce((t, u) => t + u.n, 0)) : null;
    const location = st.calls.length ? Math.round(st.calls.reduce((t, c) => t + c.eval.grade, 0) / st.calls.length) : null;
    const overall = usage == null || location == null ? null : Math.round((w.usage * usage + w.location * location) / (w.usage + w.location));
    const byPitch = {};
    for (const a of p.arsenal) {
      const cs = st.calls.filter((c) => c.code === a.code);
      if (!cs.length) continue;
      byPitch[a.code] = { n: cs.length, grade: Math.round(cs.reduce((t, c) => t + c.eval.grade, 0) / cs.length),
        offArm: round3(cs.reduce((t, c) => t + c.eval.offset.arm, 0) / cs.length), offUp: round3(cs.reduce((t, c) => t + c.eval.offset.up, 0) / cs.length) };
    }
    const result = { overall, usage, location, usageBy: { R, L }, byPitch, weights: w, feedback: feedback(p, st, { R, L }, byPitch, usage, location),
      summary: { batters: st.stats.BF, pitches: st.calls.length, H: st.stats.H, BB: st.stats.BB, K: st.stats.K, R: st.runs } };
    return result;
  }

  /* ======================================================================== rule-based feedback (grounded in the numbers above) */
  function feedback(p, st, U, byPitch, usage, location) {
    const name = (k) => PITCH_NAMES[k] || k, last = p.name.split(" ").slice(-1)[0];
    const good = [], opp = [];
    // usage
    for (const u of [U.R, U.L].filter((x) => x.graded)) {
      const side = u.hand === "R" ? "right-handed" : "left-handed";
      const devs = Object.keys(u.expected).map((k) => ({ k, d: u.observed[k] - u.expected[k] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      if (u.score >= 85) good.push(`Against ${side} hitters you stayed close to ${last}'s plan (${u.n} pitch${u.n === 1 ? "" : "es"}): ${Object.keys(u.observed).filter((k) => u.observed[k]).map((k) => `${u.observed[k]} ${k}`).join(", ")}.`);
      else if (devs[0] && Math.abs(devs[0].d) >= 1.5) opp.push(`Against ${side} hitters you called the ${name(devs[0].k).toLowerCase()} ${u.observed[devs[0].k]} time${u.observed[devs[0].k] === 1 ? "" : "s"} where the plan, given the counts you were in, expected about ${u.expected[devs[0].k].toFixed(1)}.`);
    }
    // location by pitch
    const rows = Object.entries(byPitch).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.grade - a.grade);
    if (rows.length && rows[0].grade >= 75) {
      const d = pitchDef(p, rows[0].k);
      good.push(`Your ${name(rows[0].k).toLowerCase()} targets (${rows[0].grade}) gave ${last} room for his ${dirWords(d.miss.biasArm, d.miss.biasUp)} miss.`);
    }
    for (const r of rows.filter((x) => x.grade < 70).slice(0, 2)) {
      const d = pitchDef(p, r.k), parts = [];
      if (Math.abs(r.offUp) >= 0.2) parts.push(r.offUp < 0 ? "too low" : "too high");
      if (Math.abs(r.offArm) >= 0.2) parts.push(r.offArm < 0 ? "too far glove-side" : "too far arm-side");
      const why = Math.abs(d.miss.biasUp) >= 1.5 && ((r.offUp < 0 && d.miss.biasUp < 0) || (r.offUp > 0 && d.miss.biasUp > 0)) ? ` given his tendency to miss ${d.miss.biasUp < 0 ? "beneath" : "above"} the glove`
        : Math.abs(d.miss.biasArm) >= 1.5 && ((r.offArm < 0 && d.miss.biasArm < 0) || (r.offArm > 0 && d.miss.biasArm > 0)) ? ` given that it already misses ${d.miss.biasArm < 0 ? "glove-side" : "arm-side"} of the glove` : "";
      opp.push(`Your ${name(r.k).toLowerCase()} targets were ${parts.length ? "generally " + parts.join(" and ") : "often away from where it plays best"}${why} (location grade ${r.grade}).`);
    }
    const takeaway = location != null && usage != null && location < usage - 8 ? "Trust the plan you called — now aim the glove where his misses will land, not where you want the ball to finish."
      : usage != null && location != null && usage < location - 8 ? "Your targets were sound. Lean on his best pitches in the counts the plan calls for them."
      : "Trust the pitcher's best weapons. Anticipate where his misses will go.";
    return { good: good.slice(0, 2), opportunity: opp.slice(0, 2), takeaway };
  }
  function dirWords(arm, up) {
    const h = Math.abs(arm) >= 1.5 ? (arm > 0 ? "arm-side" : "glove-side") : "", v = Math.abs(up) >= 1.2 ? (up > 0 ? "up" : "down") : "";
    return [h, v].filter(Boolean).join(" and ") || "small";
  }

  return { ZONE, PITCH_COLORS, PITCH_NAMES, PITCHERS, DEFAULTS, armSign, validatePitcher, pitcherById, pitchDef, hash, rng, stream, normal, clamp,
    missModel, missOffset, execute, flight, flightAt, zoneInfo, pitchProbs, resolvePitch, battedBall, lineup, newInning, batterOf, countCtx, advance, applyPitch, playPitch,
    locationValue, expectedQuality, optimalTarget, evaluateCall, planProbs, usageScore, evaluateInning };
});
