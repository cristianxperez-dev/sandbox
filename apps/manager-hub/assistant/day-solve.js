/* ==========================================================================
   Manager Hub — Describe Your Day: IR validation, solver, edits
   DayRequest (IR) + ctx ─► DayPlan.  Deterministic, no DOM, no dependencies
   beyond day-kb.js.  Times are minutes after midnight everywhere.
   Design: manager-hub/DAY-ENGINE.md §4–§5.

   Solver outline
     1. Normalise activities into blocks (an activity, its BP rounds, or a
        "parallel" group run side by side) and units (one per printed row).
     2. Window: start / hard stop / first pitch and its protected free window.
     3. Fixed blocks (stated times, meals, the game buffer, "off before X")
        split the main flow (team + position players) into segments.
     4. Flexible main blocks are ordered (explicit edges > mention order >
        KB phase, with stretch before work) and partitioned over the segments
        in that order (small DP that balances idle time and never reorders).
     5. Inside each segment durations are compressed toward their minimums or
        expanded toward their maximums; a game segment ends with a
        Transition / Pregame Preparation block right before the free window.
     6. Pitcher-only work runs beside position-player work (never during team
        items); if there is no room beside, it runs on its own.
     7. Conflicts (with EditOp alternatives) and short assumptions.
   ========================================================================== */
(function (root, factory) {
  const KB = typeof module === "object" && module.exports ? require("./day-kb.js") : root.DayKB;
  const api = factory(KB);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DaySolve = api;
})(typeof self !== "undefined" ? self : this, function (KB) {
  "use strict";

  /* ================================================================ utils */
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const uniq = (a) => [...new Set(a)];
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const isInt = (x) => Number.isInteger(x);
  const r5 = (x) => Math.round(x / 5) * 5;
  const f5 = (x) => Math.floor(x / 5) * 5;
  const c5 = (x) => Math.ceil(x / 5) * 5;
  const wrap = (x) => ((Math.round(x) % 1440) + 1440) % 1440;
  /** 600 → "10:00", 780 → "1:00" (12-hour, no suffix — the sheet's convention) */
  const fmt = (m) => { if (m == null || !Number.isFinite(m)) return ""; const x = wrap(m), H = Math.floor(x / 60); return `${H % 12 || 12}:${String(x % 60).padStart(2, "0")}`; };
  /** 780 → "1:00 PM" */
  const fmtAP = (m) => (m == null || !Number.isFinite(m) ? "" : `${fmt(m)} ${wrap(m) >= 720 ? "PM" : "AM"}`);
  /** 195 → "3 h 15 min", 120 → "2 h", 45 → "45 min" */
  const mins = (n) => { n = Math.round(n); return n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? " " + (n % 60) + " min" : ""}` : `${n} min`; };
  const lc = (s) => String(s || "").toLowerCase();


  /* Ordering of flexible work: KB phase first, mention order as the tie-break. A sequence the
     user stated ("BP, then defense", "defense after") reaches the solver as after/before edges,
     which outrank both. Mention order alone is not treated as a sequence: in messy prompts
     ("Cage after lunch. Defense in the morning.") it is not one. Flip to prefer mention order. */
  const MENTION_FIRST = false;
  const WHO = ["all", "position", "pitchers", "catchers"];
  const AREA_WORDS = Object.keys(KB.AREAS);
  const trackOf = (who) => (who === "pitchers" ? "pitchers" : who === "position" || who === "catchers" ? "position" : "all");
  /** tracks share time when either is "all" or they are the same track */
  const clash = (a, b) => a === "all" || b === "all" || a === b;

  /* =============================================================== schema
     Plain JSON Schema usable as an Anthropic structured-output schema:
     type / properties / required (every property) / enum / const / items /
     anyOf / $defs + $ref, additionalProperties:false on every object.
     Numeric bounds live in validate().                                     */
  const N = (t) => ({ type: [t, "null"] });
  const NE = (vals) => ({ type: ["string", "null"], enum: vals.concat([null]) });
  const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const ref = (n) => ({ $ref: `#/$defs/${n}` });
  const strArr = { type: "array", items: { type: "string" } };

  const DEFS = {
    target: obj({
      kind: NE(KB.IDS.concat(AREA_WORDS)),
      who: NE(WHO),
      label: N("string"),
      id: N("string")
    }),
    // atOnce: how many groups hit at the same time (null = one at a time, or all when the activity is in a parallel group)
    rounds: obj({ each: N("integer"), count: N("integer"), atOnce: N("integer") }),
    activity: obj({
      id: { type: "string" },
      kind: { type: "string", enum: KB.IDS.slice() },
      label: N("string"),
      who: NE(WHO),
      at: N("integer"),
      dur: N("integer"),
      rounds: { anyOf: [ref("rounds"), { type: "null" }] },
      order: N("integer"),
      after: strArr,
      before: strArr,
      indoor: N("boolean"),
      location: N("string"),
      emphasis: NE(["heavy", "light"]),
      text: N("string")
    })
  };
  const nTarget = { anyOf: [ref("target"), { type: "null" }] };
  const opShape = (op, props) => obj(Object.assign({ op: { type: "string", enum: [op] } }, props));
  DEFS.editOp = { anyOf: [
    opShape("move", { target: ref("target"), before: nTarget, after: nTarget }),
    opShape("duration", { target: ref("target"), set: N("integer"), delta: N("integer") }),
    opShape("shift", { target: ref("target"), delta: { type: "integer" } }),
    opShape("at", { target: ref("target"), at: { type: "integer" } }),
    opShape("add", { activity: ref("activity") }),
    opShape("remove", { target: ref("target") }),
    opShape("anchor", { key: { type: "string", enum: ["start", "end", "firstPitch", "offBeforeGame"] }, value: N("integer") }),
    opShape("rounds", { target: nTarget, count: N("integer"), each: N("integer"), groups: N("integer"), atOnce: N("integer") }),
    opShape("parallel", { targets: { type: "array", items: ref("target") } }),
    opShape("lock", { target: ref("target") }),
    opShape("indoor", { target: { anyOf: [ref("target"), { type: "string", enum: ["all-hitting"] }] } })
  ] };
  const OPS = DEFS.editOp.anyOf.map((b) => b.properties.op.enum[0]);

  const IR_BODY = obj({
    version: { type: "integer", enum: [1] },
    source: NE(["reader", "ai"]),
    dayType: NE(["game", "workout"]),
    level: NE(["fcl", "full-season"]),
    weather: NE(["rain"]),
    anchors: obj({ start: N("integer"), end: N("integer"), firstPitch: N("integer"), offBeforeGame: N("integer") }),
    offBefore: { type: "array", items: obj({ min: { type: "integer" }, before: { type: "string" } }) },
    groups: obj({ hitting: N("integer"), pitchers: N("boolean") }),
    activities: { type: "array", items: ref("activity") },
    emphasis: { type: "array", items: { type: "string", enum: AREA_WORDS.slice() } },
    // Extension (not in §4): activity ids that run at the same time ("run the cage groups simultaneously").
    parallel: { type: "array", items: strArr },
    base: { anyOf: [obj({ ref: { type: "string", enum: ["yesterday", "current", "template"] }, name: N("string") }), { type: "null" }] },
    edits: { type: "array", items: ref("editOp") },
    notes: strArr,
    unknown: strArr
  });
  const SCHEMA = Object.assign({ $defs: DEFS }, IR_BODY);
  const EDIT_SCHEMA = { $defs: DEFS, type: "array", items: ref("editOp") };
  const BUILD_RESPONSE_SCHEMA = { $defs: DEFS, type: "object", additionalProperties: false, required: ["request"], properties: { request: IR_BODY } };
  const REFINE_RESPONSE_SCHEMA = { $defs: DEFS, type: "object", additionalProperties: false, required: ["ops", "notes"], properties: { ops: { type: "array", items: ref("editOp") }, notes: strArr } };

  /* In lenient mode (the default, for the built-in reader and hand-built IR)
     only these properties are required; strict mode requires every listed one,
     as the structured-output schema does. */
  const CORE = new WeakMap();
  CORE.set(IR_BODY, ["activities"]);
  CORE.set(SCHEMA, ["activities"]);
  CORE.set(DEFS.activity, ["id", "kind"]);
  CORE.set(DEFS.target, []);
  CORE.set(DEFS.rounds, []);
  CORE.set(IR_BODY.properties.anchors, []);
  CORE.set(IR_BODY.properties.groups, []);
  CORE.set(IR_BODY.properties.offBefore.items, ["min", "before"]);
  DEFS.editOp.anyOf.forEach((b) => CORE.set(b, ["op"].concat({ move: ["target"], duration: ["target"], shift: ["target", "delta"], at: ["target", "at"], add: ["activity"], remove: ["target"], anchor: ["key", "value"], rounds: [], parallel: ["targets"], lock: ["target"], indoor: ["target"] }[b.properties.op.enum[0]])));

  /* ============================================================ validator */
  const typeOk = (v, t) => t === "null" ? v === null : t === "integer" ? isInt(v) : t === "number" ? typeof v === "number" && Number.isFinite(v)
    : t === "array" ? Array.isArray(v) : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : typeof v === t;
  function deref(s, rootS) {
    let guard = 0;
    while (s && s.$ref && guard++ < 10) s = rootS.$defs[s.$ref.replace("#/$defs/", "")];
    return s;
  }
  function check(v, s, rootS, path, errs, strict) {
    s = deref(s, rootS);
    if (!s) return;
    if (s.anyOf) {
      // edit ops: pick the branch named by `op` so the error is useful
      if (v && typeof v === "object" && typeof v.op === "string" && s.anyOf.some((b) => deref(b, rootS).properties && deref(b, rootS).properties.op)) {
        const br = s.anyOf.map((b) => deref(b, rootS)).find((b) => b.properties && b.properties.op && b.properties.op.enum.includes(v.op));
        if (!br) { errs.push(`${path}.op: unknown op "${v.op}" (expected one of ${OPS.join(", ")})`); return; }
        return check(v, br, rootS, path, errs, strict);
      }
      let best = null;
      for (const b of s.anyOf) {
        const e = [];
        check(v, b, rootS, path, e, strict);
        if (!e.length) return;
        if (!best || e.length < best.length) best = e;
      }
      errs.push(...best);
      return;
    }
    if (s.type) {
      const ts = [].concat(s.type);
      if (!ts.some((t) => typeOk(v, t))) { errs.push(`${path}: expected ${ts.join(" or ")}, got ${v === null ? "null" : Array.isArray(v) ? "array" : typeof v}`); return; }
    }
    if (s.enum && !s.enum.includes(v)) { errs.push(`${path}: "${v}" is not one of ${s.enum.filter((x) => x !== null).join(", ")}`); return; }
    if ("const" in s && v !== s.const) { errs.push(`${path}: must be ${JSON.stringify(s.const)}`); return; }
    if (Array.isArray(v) && s.items) v.forEach((x, i) => check(x, s.items, rootS, `${path}[${i}]`, errs, strict));
    if (typeOk(v, "object") && s.properties) {
      const req = strict ? s.required || [] : CORE.get(s) || s.required || [];
      req.forEach((k) => { if (!(k in v)) errs.push(`${path}.${k}: required`); });
      if (s.additionalProperties === false) Object.keys(v).forEach((k) => { if (!(k in s.properties)) errs.push(`${path}.${k}: unknown property`); });
      Object.keys(v).forEach((k) => { if (k in s.properties && v[k] !== undefined) check(v[k], s.properties[k], rootS, `${path}.${k}`, errs, strict); });
    }
  }
  const inDay = (x) => x == null || (isInt(x) && x >= 0 && x < 1440);
  /** IR → {ok, errors[]}.  opts.strict requires every property (the model schema). */
  function validate(ir, opts = {}) {
    const errors = [];
    if (!typeOk(ir, "object")) return { ok: false, errors: ["request: expected an object"] };
    check(ir, SCHEMA, SCHEMA, "request", errors, !!opts.strict);
    if (errors.length) return { ok: false, errors };
    // semantics the schema can't express
    const acts = ir.activities || [];
    const ids = new Set();
    acts.forEach((a, i) => {
      const p = `request.activities[${i}]`;
      if (ids.has(a.id)) errors.push(`${p}.id: duplicate id "${a.id}"`);
      ids.add(a.id);
      if (!inDay(a.at)) errors.push(`${p}.at: must be minutes after midnight (0–1439)`);
      if (a.dur != null && (a.dur < 0 || a.dur > 720)) errors.push(`${p}.dur: must be 0–720 minutes`);
      if (a.rounds) {
        if (a.rounds.count != null && (a.rounds.count < 1 || a.rounds.count > 12)) errors.push(`${p}.rounds.count: must be 1–12`);
        if (a.rounds.each != null && (a.rounds.each < 5 || a.rounds.each > 120)) errors.push(`${p}.rounds.each: must be 5–120 minutes`);
        if (a.rounds.atOnce != null && (a.rounds.atOnce < 1 || a.rounds.atOnce > 12)) errors.push(`${p}.rounds.atOnce: must be 1–12`);
      }
    });
    acts.forEach((a, i) => ["after", "before"].forEach((k) => (a[k] || []).forEach((r) => { if (!ids.has(r)) errors.push(`request.activities[${i}].${k}: unknown activity "${r}"`); })));
    const an = ir.anchors || {};
    ["start", "end", "firstPitch"].forEach((k) => { if (!inDay(an[k])) errors.push(`request.anchors.${k}: must be minutes after midnight (0–1439)`); });
    if (an.offBeforeGame != null && (an.offBeforeGame < 0 || an.offBeforeGame > 240)) errors.push("request.anchors.offBeforeGame: must be 0–240 minutes");
    (ir.offBefore || []).forEach((o, i) => {
      if (o.min < 0 || o.min > 240) errors.push(`request.offBefore[${i}].min: must be 0–240 minutes`);
      if (o.before !== "game" && !ids.has(o.before)) errors.push(`request.offBefore[${i}].before: unknown activity "${o.before}"`);
    });
    (ir.parallel || []).forEach((g, i) => g.forEach((r) => { if (!ids.has(r)) errors.push(`request.parallel[${i}]: unknown activity "${r}"`); }));
    if (ir.groups && ir.groups.hitting != null && (ir.groups.hitting < 1 || ir.groups.hitting > 12)) errors.push("request.groups.hitting: must be 1–12");
    return { ok: !errors.length, errors };
  }
  /** EditOp[] → {ok, errors[]} */
  function validateEdits(ops, opts = {}) {
    const errors = [];
    if (!Array.isArray(ops)) return { ok: false, errors: ["ops: expected an array"] };
    check(ops, EDIT_SCHEMA, EDIT_SCHEMA, "ops", errors, !!opts.strict);
    return { ok: !errors.length, errors };
  }

  /* ======================================================= target lookup */
  const WORD_STOP = new Set(["the", "a", "an", "and", "of", "to", "for", "with", "s", "practice"]);
  const words = (s) => lc(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !WORD_STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, ""));
  /**
   * target {kind?, who?, label?, id?} (or "all-hitting") → activity ids.
   * id first; then kind (or an area word: defense / hitting / pitching / conditioning),
   * narrowed by label words; then who ("pitchers" → every pitcher item).
   * A game target resolves to the pseudo-id "game" when the game is an anchor only.
   */
  function resolveTarget(ir, target) {
    const acts = (ir && ir.activities) || [];
    if (target === "all-hitting") return acts.filter((a) => KB.isHitting(a.kind)).map((a) => a.id);
    if (!target || typeof target !== "object") return [];
    if (target.id) return acts.some((a) => a.id === target.id) ? [target.id] : target.id === "game" ? ["game"] : [];
    let c = acts;
    if (target.kind) {
      const kinds = KB.AREAS[target.kind] ? KB.AREAS[target.kind].concat(target.kind === "hitting" ? [] : []) : [target.kind];
      c = acts.filter((a) => kinds.includes(a.kind));
      if (!c.length && target.kind === "game") return ir.anchors && ir.anchors.firstPitch != null ? ["game"] : [];
    }
    if (target.label) {
      const tw = words(target.label);
      const score = (a) => { const aw = words([a.label, a.text, KB.label(a.kind), a.kind].join(" ")); return tw.filter((w) => aw.includes(w)).length; };
      const pool = c.length ? c : acts;
      const best = Math.max(0, ...pool.map(score));
      if (best > 0) c = pool.filter((a) => score(a) === best);
      else if (!target.kind) c = [];
    }
    if (target.who) {
      const w = target.who === "catchers" ? ["catchers"] : [target.who];
      const fw = (a) => w.includes(a.who || (KB.kind(a.kind) || {}).who);
      if (target.kind || target.label) { const n = c.filter(fw); if (n.length) c = n; }
      else c = acts.filter(fw);
    }
    if (!target.kind && !target.label && !target.who) return [];
    return c.map((a) => a.id);
  }

  /* ================================================================ solve */
  /**
   * DayRequest + ctx → DayPlan
   *   { items:[{id, actId, kind, label, track, group?, start, end, fixed, flexible, source, round?, resource?, location?}],
   *     window:{start, end, available, required}, assumptions:[{key,text}], conflicts:[{code,severity,message,alternatives}], ok }
   * Never mutates its input.
   */
  function solve(irIn, ctxIn) {
    const ir = clone(irIn || {}) || {};
    const ctx = ctxIn || {};
    const res = ctx.resources || {};
    const asm = new Map();
    const say = (key, text) => { if (!asm.has(key)) asm.set(key, text); };
    const conflicts = [];
    const conflict = (code, severity, message, alternatives = []) => {
      if (conflicts.some((c) => c.code === code && c.message === message)) return;
      conflicts.push({ code, severity, message, alternatives: alternatives.filter(Boolean).slice(0, 4) });
    };
    const anchors = Object.assign({ start: null, end: null, firstPitch: null, offBeforeGame: null }, ir.anchors || {});
    const emphasis = (ir.emphasis || []).filter((e) => KB.AREAS[e]);
    const rain = ir.weather === "rain";
    const hitGroups = (ctx.hittingGroups || []).filter(Boolean);

    // ---- activities (unknown kinds become custom, never dropped)
    const acts = (ir.activities || []).filter(Boolean).map((a, i) => {
      const kind = KB.kind(a.kind) ? a.kind : "custom";
      const kb = KB.kind(kind);
      return Object.assign({}, a, {
        id: a.id || `a${i + 1}`, kind, who: WHO.includes(a.who) ? a.who : kb.who,
        order: isInt(a.order) ? a.order : 1000 + i, after: a.after || [], before: a.before || [],
        indoor: rain && KB.isHitting(kind) ? true : a.indoor
      });
    });
    const actById = new Map(acts.map((a) => [a.id, a]));

    // ---- game and the protected window before it
    const gameAct = acts.find((a) => a.kind === "game");
    let fp = anchors.firstPitch;
    if (fp == null && gameAct && gameAct.at != null) fp = gameAct.at;
    if (fp == null && (ir.dayType === "game" || gameAct) && ctx.game && ctx.game.firstPitch != null) {
      fp = ctx.game.firstPitch;
      say("firstPitch", `First pitch ${fmtAP(fp)} from the Games list.`);
    }
    if (fp == null && (ir.dayType === "game" || gameAct)) say("firstPitch", "No first-pitch time given — say when the game starts to build back from it.");
    let offGame = fp != null ? anchors.offBeforeGame || 0 : 0;
    const leadFree = new Map(); // actId → minutes off right before it ("45 minutes off before stretch")
    (ir.offBefore || []).forEach((o) => {
      if (!o || !(o.min > 0)) return;
      if (o.before === "game") { if (fp != null) offGame = Math.max(offGame, o.min); return; }
      if (actById.has(o.before)) leadFree.set(o.before, Math.max(leadFree.get(o.before) || 0, o.min));
    });
    if (fp == null && anchors.offBeforeGame) say("offBeforeGame", `${anchors.offBeforeGame} min off before the game noted, but there's no game time to anchor it.`);
    const bufStart = fp != null ? fp - offGame : null;
    if (rain) say("rain", "Rain: hitting moved indoors; outdoor defense kept short.");

    // ---- emphasis tiers: 2 protected (emphasised), 1 normal, 0 trimmed first
    const tierOf = (a) => {
      if (a.emphasis === "heavy") return 2;
      if (a.emphasis === "light") return 0;
      const areas = KB.areaOf(a.kind);
      if (rain && areas.includes("defense") && !emphasis.includes("defense")) return 0;
      if (!emphasis.length || !areas.length) return 1;
      return areas.some((x) => emphasis.includes(x)) ? 2 : 0;
    };
    const WEIGHT = { 0: 0.5, 1: 1, 2: 2 };

    // ---- units: one per printed row
    const roundsCount = (a) => {
      if (a.rounds && a.rounds.count) return { n: a.rounds.count, why: "stated" };
      if (ir.groups && ir.groups.hitting) return { n: ir.groups.hitting, why: "groups" };
      if (hitGroups.length >= 1) return { n: hitGroups.length, why: "ctx" };
      return { n: 2, why: "default" };
    };
    const hasRounds = (a) => !!(a.rounds && (a.rounds.count || a.rounds.each)) || a.kind === "bp";
    function unitsOf(a) {
      const kb = KB.kind(a.kind), d = KB.durOf(a.kind, ctx), track = trackOf(a.who), tier = tierOf(a);
      // an emphasised day ("defense-heavy") lets those kinds run longer than usual; the others stay at default
      if (tier === 2 && (emphasis.length || a.emphasis === "heavy")) d.max = Math.max(d.max, r5(d.max * 1.5));
      if (tier === 0 && emphasis.length) d.max = d.def;
      const baseLabel = a.kind === "custom" ? a.label || a.text || "Activity" : a.label || kb.label;
      const indoor = a.indoor === true && KB.isHitting(a.kind);
      const resource = indoor ? "cage" : kb.resource;
      const location = a.location || (indoor ? "Cage" : null);
      const src = a.at != null || a.dur != null || (a.rounds && a.rounds.each != null) ? "stated" : "default";
      const base = { actId: a.id, kind: a.kind, track, tier, weight: WEIGHT[tier], resource, location, source: src,
        exclusive: kb.exclusive && resource === "field", group: a.who === "catchers" ? "Catchers" : null };
      if (hasRounds(a)) {
        const rc = roundsCount(a), n = rc.n;
        let each, rigid;
        if (a.rounds && a.rounds.each) { each = a.rounds.each; rigid = true; }
        // a stated length on a rounds activity is per round ("BP 2 groups, 30 min", "25 each"),
        // unless it is long enough to be the whole hitting block ("an hour of BP, 2 groups" → 30 each)
        else if (a.dur) { each = a.dur >= 45 && a.dur / n >= 15 ? Math.max(5, r5(a.dur / n)) : a.dur; rigid = true; }
        else { each = d.def; rigid = false; }
        if (a.kind === "bp" || a.kind === "cage") {
          const what = a.kind === "bp" ? "BP rounds" : "cage rounds";
          if (rc.why === "default") say(`rounds:${a.id}`, `${n} ${what} (one per hitting group) — say how many groups if different.`);
          else if (rc.why === "ctx") say(`rounds:${a.id}`, `${n} ${what}, one per hitting group (${hitGroups.join(", ")}).`);
        }
        const roundLabel = a.kind === "custom" ? baseLabel : kb.label;
        return Array.from({ length: n }, (_, i) => Object.assign({}, base, {
          label: n > 1 ? `${roundLabel} — Round ${i + 1}` : baseLabel, round: n > 1 ? i + 1 : null,
          group: n > 1 ? hitGroups[i] || `Group ${i + 1}` : base.group,
          def: each, min: rigid ? each : d.min, max: rigid ? each : d.max, rigid
        }));
      }
      if (a.dur != null) return [Object.assign({}, base, { label: baseLabel, round: null, def: a.dur, min: a.dur, max: a.dur, rigid: true })];
      return [Object.assign({}, base, { label: baseLabel, round: null, def: d.def, min: d.min, max: d.max, rigid: !kb.flex || kb.point })];
    }

    // ---- blocks: an activity, or a parallel group
    const parGroups = [];
    (ir.parallel || []).forEach((g) => {
      const ids = uniq((g || []).filter((x) => actById.has(x)));
      if (!ids.length) return;
      const hit = parGroups.find((p) => p.some((x) => ids.includes(x)));
      if (hit) ids.forEach((x) => { if (!hit.includes(x)) hit.push(x); });
      else parGroups.push(ids);
    });
    // rounds.atOnce > 1 runs that activity's rounds side by side; atOnce 1 takes a lone
    // activity back out of its parallel group ("one group at a time")
    acts.forEach((a) => {
      const k = a.rounds && a.rounds.atOnce;
      if (k > 1 && !parGroups.some((g) => g.includes(a.id))) parGroups.push([a.id]);
      if (k === 1) { const gi = parGroups.findIndex((g) => g.length === 1 && g[0] === a.id); if (gi >= 0) parGroups.splice(gi, 1); }
    });
    const parOf = new Map();
    parGroups.forEach((g, i) => g.forEach((x) => parOf.set(x, i)));
    const parIssues = []; // capacity problems found while building parallel blocks, raised once times are known

    const fields = res.fields != null ? res.fields : 1, cagesKnown = res.cages != null, cages = cagesKnown ? res.cages : 1;
    /** a parallel group → rigid template of items relative to the block start */
    function parTemplate(members) {
      const all = members.map((a) => ({ a, units: unitsOf(a) }));
      const bp = all.find((m) => (m.a.kind === "bp" || m.a.kind === "cage") && m.units.length > 1);
      const out = [];
      const plural2 = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      if (all.length === 1 && bp) {
        // rounds side by side, never more at once than the field(s) + cage(s) hold:
        // on-field lanes first (kind bp), the rest hit in a cage (kind cage)
        const units = bp.units, n = units.length, each = units[0].def;
        const F = bp.a.kind === "bp" && !bp.a.indoor ? fields : 0;
        const cap = Math.max(1, F + cages);
        const want = Math.min(n, bp.a.rounds && bp.a.rounds.atOnce ? bp.a.rounds.atOnce : n);
        const lanes = Math.max(1, Math.min(want, cap));
        if (!cagesKnown && want > F) say("cage", "Assumed one cage for the group hitting off the field.");
        units.forEach((u, i) => {
          const lane = i % lanes, slot = Math.floor(i / lanes), onField = lane < F;
          out.push(Object.assign({}, u, { off: slot * each, dur: each, kind: onField ? u.kind : "cage", resource: onField ? "field" : "cage",
            location: onField ? u.location || "Field" : "Cage", exclusive: onField && u.exclusive, label: onField ? u.label : `${u.label} (Cage)` }));
        });
        if (want > cap) {
          const waves = [];
          for (let i = 0; i < n; i += lanes) waves.push(units.slice(i, i + lanes).map((u) => u.group).join(" + "));
          parIssues.push({ actId: bp.a.id, known: cagesKnown && res.fields != null, each, n, want, cap,
            text: (at) => `${want} BP groups are set to hit at once at ${fmtAP(at)}, but ${plural2(F, "field")} + ${plural2(cages, "cage")} fit only ${cap} at a time — shown as ${waves.join(", then ")} (${mins(Math.ceil(n / lanes) * each)}).`,
            alts: [
              { label: `Hit ${cap} at a time (${waves.join(", then ")})`, ops: [{ op: "rounds", target: { kind: null, who: null, label: null, id: bp.a.id }, count: null, each: null, groups: null, atOnce: cap }] },
              { label: `One group at a time (${mins(n * each)})`, ops: [{ op: "rounds", target: { kind: null, who: null, label: null, id: bp.a.id }, count: null, each: null, groups: null, atOnce: 1 }] }
            ] });
        }
        return { items: out, len: Math.ceil(n / lanes) * each };
      }
      const bpM = all.find((m) => m.a.kind === "bp"), cageM = all.find((m) => m.a.kind === "cage");
      if (bpM && cageM && all.length === 2) {
        // Rotation: every group takes one on-field BP slot and one cage slot, never more groups
        // per slot than fields / cages. Field slots go in group order; each group's cage slot is
        // the least-loaded other slot, nearest after its field slot (Latin-square-like).
        const units = bpM.units, G = units.length;
        const slotLen = units[0].def; // the BP round sets the pace; cage time is matched to it
        const F = Math.max(1, fields), C = cages;
        if (!cagesKnown) say("cage", "Assumed one cage for the rotation.");
        const Cc = Math.max(1, C);
        const S = Math.max(Math.ceil(G / F), Math.ceil(G / Cc), 2);
        const fieldSlot = (g) => Math.floor(g / F);
        const load = new Array(S).fill(0), cageSlot = [];
        units.forEach((u, g) => {
          const fs = fieldSlot(g);
          const c = [...Array(S).keys()].filter((k) => k !== fs && load[k] < Cc).sort((x, y) => load[x] - load[y] || ((x - fs + S) % S) - ((y - fs + S) % S))[0];
          cageSlot[g] = c == null ? -1 : c;
          if (c != null) load[c]++;
        });
        const cageLabel = cageM.units[0].label.replace(/ — Round \d+$/, "");
        units.forEach((u, g) => {
          out.push(Object.assign({}, u, { off: fieldSlot(g) * slotLen, dur: slotLen, location: u.location || "Field", resource: "field" }));
          const cs = cageSlot[g] >= 0 ? cageSlot[g] : S; // no room: after the rotation (flagged below)
          out.push(Object.assign({}, cageM.units[0], { off: cs * slotLen, dur: slotLen, group: u.group, round: g + 1, label: `${cageLabel} — ${u.group}`,
            location: cageM.units[0].location || "Cage", resource: "cage", exclusive: false }));
        });
        const len = (cageSlot.some((c) => c < 0) ? S + 1 : S) * slotLen;
        say(`rot:${bpM.a.id}`, `Rotation: ${F === 1 ? "one group" : `${F} groups`} on the field per ${slotLen}-min slot, ${Cc === 1 ? "one" : `up to ${Cc}`} in the cage${Cc === 1 ? "" : "s"}; each group gets both.`);
        if ([cageM.a.dur, cageM.a.rounds && cageM.a.rounds.each].some((x) => x && x !== slotLen)) say(`par:${cageM.a.id}`, `Cage time matched to the ${slotLen}-min rotation slots.`);
        if (C === 0 && cagesKnown) parIssues.push({ actId: bpM.a.id, known: true, text: (at) => `The BP / cage rotation at ${fmtAP(at)} needs a cage, but none is available.`,
          alts: [{ label: "Hit on the field one group at a time", ops: [{ op: "remove", target: { kind: null, who: null, label: null, id: cageM.a.id } }] }] });
        return { items: out, len };
      }
      // generic: members start together; same-track members become separate groups
      const seen = {};
      let len = 0;
      all.forEach((m, mi) => {
        let off = 0;
        const t = m.units[0].track;
        seen[t] = (seen[t] || 0) + 1;
        const needGroup = all.filter((x) => x.units[0].track === t).length > 1;
        m.units.forEach((u) => {
          out.push(Object.assign({}, u, { off, dur: u.def, group: u.group || (needGroup ? hitGroups[seen[t] - 1] || `Group ${seen[t]}` : null) }));
          off += u.def;
        });
        len = Math.max(len, off);
        if (needGroup && mi === all.length - 1) say(`par:${m.a.id}`, `Split ${t === "position" ? "position players" : t} into groups to run ${all.map((x) => x.units[0].label.replace(/ — Round \d+$/, "")).join(" and ")} together.`);
      });
      return { items: out, len };
    }

    const blocks = [];
    const blockOf = new Map();
    acts.forEach((a) => {
      if (a.kind === "game") return;
      if (parOf.has(a.id)) {
        const gi = parOf.get(a.id);
        if (blocks.some((b) => b.par === gi)) { blockOf.set(a.id, blocks.find((b) => b.par === gi)); return; }
        const members = parGroups[gi].map((x) => actById.get(x)).filter((x) => x.kind !== "game");
        const t = parTemplate(members);
        const b = { key: `p${gi}`, par: gi, acts: members, tpl: t, units: null, len: t.len,
          track: members.some((m) => trackOf(m.who) !== "pitchers") ? "main" : "pitchers",
          at: Math.min(...members.map((m) => (m.at != null ? m.at : Infinity))),
          lead: Math.max(0, ...members.map((m) => leadFree.get(m.id) || 0)) };
        if (b.at === Infinity) b.at = null;
        members.forEach((m) => blockOf.set(m.id, b));
        blocks.push(b);
        return;
      }
      const units = unitsOf(a);
      const b = { key: a.id, acts: [a], units, track: trackOf(a.who) === "pitchers" ? "pitchers" : "main", at: a.at, lead: leadFree.get(a.id) || 0 };
      blockOf.set(a.id, b);
      blocks.push(b);
    });
    const firstAct = (b) => b.acts.slice().sort((x, y) => x.order - y.order)[0];
    const kindsOf = (b) => (b.units || b.tpl.items).map((u) => u.kind);
    const isWarm = (b) => kindsOf(b).every((k) => KB.WARMUP.includes(k));
    const bandOfB = (b) => Math.min(...kindsOf(b).map((k) => (k === "meal" ? KB.BAND.work : KB.bandOf(k))));
    const defLen = (b) => (b.units ? sum(b.units.map((u) => u.def)) : b.len);
    const minLen = (b) => (b.units ? sum(b.units.map((u) => u.min)) : b.len);
    const maxLen = (b) => (b.units ? sum(b.units.map((u) => u.max)) : b.len);

    const special = (b) => b.acts.length === 1 && ["arrival", "postgame"].includes(b.acts[0].kind);
    const fixedBlocks = blocks.filter((b) => b.at != null && !special(b));
    const flexMain = blocks.filter((b) => b.at == null && b.track === "main" && !special(b));
    const flexPitch = blocks.filter((b) => b.at == null && b.track === "pitchers" && !special(b));
    flexMain.filter((b) => b.acts.some((a) => a.kind === "meal")).forEach((b) => say(`meal:${b.key}`, `${b.units[0].label} placed by order — give it a time to pin it.`));

    // ---- window
    const hardEnd = anchors.end;
    let flexEnd = null, endKind = "open";
    if (bufStart != null) { flexEnd = hardEnd != null ? Math.min(hardEnd, bufStart) : bufStart; endKind = hardEnd != null && hardEnd < bufStart ? "end" : "game"; }
    else if (hardEnd != null) { flexEnd = hardEnd; endKind = "end"; }
    const PREP_DEF = KB.kind("pregamePrep").dur.def;
    const statedPrep = acts.some((a) => a.kind === "pregamePrep");
    const fixedMainStarts = fixedBlocks.filter((b) => b.track === "main").map((b) => b.at - b.lead);
    const reqDef = sum(flexMain.map((b) => defLen(b) + b.lead));
    let start = anchors.start;
    const startStated = start != null;
    if (start == null && fixedMainStarts.length) {
      // no stated start: the first stated time opens the day, unless flexible work belongs before it
      // ("early work, then stretch at 3:30", a meeting before a fixed stretch)
      const f0 = fixedBlocks.filter((b) => b.track === "main").sort((x, y) => x.at - x.lead - (y.at - y.lead))[0];
      const ph0 = Math.min(...kindsOf(f0).map((k) => KB.phaseOf(k)));
      const pre = flexMain.filter((b) => {
        const toF0 = b.acts.some((a) => a.before.some((o) => blockOf.get(o) === f0));
        const afterF0 = b.acts.some((a) => a.after.some((o) => blockOf.get(o) === f0));
        return toF0 || (!afterF0 && bandOfB(b) === KB.BAND.warmup && Math.min(...kindsOf(b).map((k) => KB.phaseOf(k))) < ph0);
      });
      start = Math.min(...fixedMainStarts);
      if (pre.length) {
        start = f5(start - sum(pre.map((b) => defLen(b) + b.lead)));
        say("start", `Starts ${fmtAP(start)} so ${pre.map((b) => (b.units || b.tpl.items)[0].label.replace(/ — Round \d+$/, "")).join(", ")} fits before ${(f0.units || f0.tpl.items)[0].label}.`);
      }
    }
    if (start == null && fixedBlocks.length) start = Math.min(...fixedBlocks.map((b) => b.at));
    if (start == null) {
      if (endKind === "game") {
        // work back from first pitch: the requested work, a transition, then the free window
        start = Math.max(fp - 360, Math.floor((flexEnd - reqDef - (statedPrep ? 0 : PREP_DEF)) / 15) * 15);
        say("start", `Starts ${fmtAP(start)} so the work ends right before pregame — say a start time if different.`);
      } else {
        start = ir.level === "fcl" ? 510 : 540;
        if (endKind === "end" && start >= flexEnd) start = Math.max(0, Math.floor((flexEnd - reqDef) / 15) * 15);
        say("start", `Starts ${fmtAP(start)} (default) — say a start time if different.`);
      }
    }
    // impossible windows: "start at 2, finish by 1"
    if (flexEnd != null && flexEnd - start <= 0) {
      const why = endKind === "game"
        ? `The day starts at ${fmtAP(start)}, but ${offGame ? `the ${offGame}-min free window before ` : ""}first pitch at ${fmtAP(fp)} leaves no time to schedule anything.`
        : `The day starts at ${fmtAP(start)} but must finish by ${fmtAP(flexEnd)} — there is no time to schedule anything.`;
      const need = c5(Math.max(reqDef, 30));
      const alts = endKind === "game"
        ? [{ label: `Start at ${fmtAP(bufStart - need)}`, ops: [{ op: "anchor", key: "start", value: bufStart - need }] }]
        : [{ label: `Finish at ${fmtAP(start + need)}`, ops: [{ op: "anchor", key: "end", value: start + need }] },
           { label: `Start at ${fmtAP(flexEnd - need)}`, ops: [{ op: "anchor", key: "start", value: flexEnd - need }] }];
      conflict("impossible", "error", why, alts);
      flexEnd = null; endKind = "open"; // best effort: lay the work out from the start
    }

    // ---- fixed items
    const items = [];
    const emit = (u, s, e, extra = {}) => {
      const it = { id: "", actId: u.actId || null, kind: u.kind, label: u.label, track: u.track || "all", group: u.group || null,
        start: s, end: e, fixed: false, flexible: true, source: u.source || "default", round: u.round || null,
        resource: u.resource || null, location: u.location || null };
      Object.assign(it, extra);
      if (it.group == null) delete it.group;
      if (it.round == null) delete it.round;
      if (it.resource == null) delete it.resource;
      if (it.location == null) delete it.location;
      it.exclusive = !!u.exclusive;
      items.push(it);
      return it;
    };
    const freeUnit = (forB) => ({ actId: null, kind: "free", label: "Free Time", track: "all", source: "stated", leadOf: forB.key });
    function placeBlock(b, s, durs, extra) {
      // lead free time, then units back to back (or the parallel template)
      let t = s;
      if (b.lead) { emit(freeUnit(b), t, t + b.lead, Object.assign({ flexible: false }, extra, { fixed: extra.fixed })); t += b.lead; }
      if (b.tpl) {
        b.tpl.items.forEach((u) => emit(u, t + u.off, t + u.off + u.dur, Object.assign({ flexible: !extra.fixed }, extra)));
        return t + b.len;
      }
      b.units.forEach((u, i) => { const d = durs ? durs[i] : u.def; emit(u, t, t + d, Object.assign({ flexible: !extra.fixed && !u.rigid }, extra)); t += d; });
      return t;
    }
    const fixedSpans = []; // main-flow spans that split segments
    fixedBlocks.forEach((b) => {
      const s0 = b.at - b.lead;
      const e = placeBlock(b, s0, null, { fixed: true, flexible: false, source: "stated" });
      b.span = [s0, e];
      if (b.track === "main") fixedSpans.push({ s: s0, e, label: (b.units || b.tpl.items)[0].label, b });
    });
    if (bufStart != null && offGame > 0) {
      emit({ actId: null, kind: "free", label: KB.PREGAME_FREE_LABEL, track: "all", source: "stated" }, bufStart, fp, { fixed: true, flexible: false, id: "free-game" });
      fixedSpans.push({ s: bufStart, e: fp, label: KB.PREGAME_FREE_LABEL, buffer: true });
    }
    if (fp != null) {
      const opp = ctx.game && ctx.game.opponent;
      emit({ actId: gameAct ? gameAct.id : null, kind: "game", label: opp ? `Game vs ${opp}` : (gameAct && gameAct.label) || KB.label("game"), track: "all", source: "stated" }, fp, fp, { fixed: true, flexible: false, id: "game" });
    }
    fixedSpans.sort((x, y) => x.s - y.s);

    // ---- conflicts among fixed things
    const fixedItems = items.filter((i) => i.fixed);
    for (let i = 0; i < fixedItems.length; i++) for (let j = i + 1; j < fixedItems.length; j++) {
      let A = fixedItems[i], B = fixedItems[j];
      if (!clash(A.track, B.track)) continue;
      if (A.actId && A.actId === B.actId) continue;
      if (A.start > B.start || (A.start === B.start && A.end > B.end)) [A, B] = [B, A];
      const overlap = B.kind === "game" ? B.start > A.start && B.start < A.end : B.start < A.end && A.start < B.end && B.end > B.start && A.end > A.start;
      if (!overlap) continue;
      const opsMove = B.actId ? [{ op: "at", target: { kind: null, who: null, label: null, id: B.actId }, at: A.end }] : null;
      const opsShort = A.actId && B.start - A.start >= 5 ? [{ op: "duration", target: { kind: null, who: null, label: null, id: A.actId }, set: B.start - A.start, delta: null }] : null;
      const opsMoveA = A.actId && B.kind !== "game" ? null : A.actId ? [{ op: "at", target: { kind: null, who: null, label: null, id: A.actId }, at: B.start - (A.end - A.start) }] : null;
      conflict("fixedOverlap", "error", `${A.label} (${fmt(A.start)}–${fmt(A.end)}) overlaps ${B.label} (${B.kind === "game" ? fmt(B.start) : `${fmt(B.start)}–${fmt(B.end)}`}).`, [
        opsMove && { label: `Start ${B.label} at ${fmtAP(A.end)}`, ops: opsMove },
        opsShort && { label: `Shorten ${A.label} to ${B.start - A.start} min`, ops: opsShort },
        opsMoveA && { label: `Move ${A.label} to ${fmtAP(B.start - (A.end - A.start))}`, ops: opsMoveA },
        A.id === "free-game" || B.id === "free-game" ? { label: "Drop the pregame free window", ops: [{ op: "anchor", key: "offBeforeGame", value: 0 }] } : null
      ]);
    }
    fixedItems.forEach((it) => {
      if (!it.actId || it.kind === "game" || it.kind === "postgame") return;
      if (hardEnd != null && it.end > hardEnd) {
        const tgt = { kind: null, who: null, label: null, id: it.actId };
        conflict("afterEnd", "error", `${it.label} at ${fmtAP(it.start)} runs past the ${fmtAP(hardEnd)} finish.`, [
          it.end - it.start <= hardEnd - start ? { label: `Move ${it.label} to ${fmtAP(hardEnd - (it.end - it.start))}`, ops: [{ op: "at", target: tgt, at: hardEnd - (it.end - it.start) }] } : null,
          { label: `Finish at ${fmtAP(it.end)}`, ops: [{ op: "anchor", key: "end", value: it.end }] }
        ]);
      } else if (fp != null && it.start >= fp) {
        conflict("afterEnd", "error", `${it.label} at ${fmtAP(it.start)} is after first pitch (${fmtAP(fp)}).`, [
          { label: `Move ${it.label} to ${fmtAP(Math.max(start, (bufStart || fp) - (it.end - it.start)))}`, ops: [{ op: "at", target: { kind: null, who: null, label: null, id: it.actId }, at: Math.max(start, (bufStart || fp) - (it.end - it.start)) }] }
        ]);
      }
      if (startStated && it.start < start) {
        conflict("beforeStart", "warn", `${it.label} at ${fmtAP(it.start)} is before the ${fmtAP(start)} start.`, [
          { label: `Start the day at ${fmtAP(it.start)}`, ops: [{ op: "anchor", key: "start", value: it.start }] },
          { label: `Move ${it.label} to ${fmtAP(start)}`, ops: [{ op: "at", target: { kind: null, who: null, label: null, id: it.actId }, at: start }] }
        ]);
      }
    });

    // ---- segments of the main flow between fixed spans
    function segments() {
      const out = [];
      let cur = start;
      const limit = flexEnd == null ? Infinity : flexEnd;
      fixedSpans.forEach((f) => {
        if (f.e <= cur) return;
        if (f.s >= limit) return;
        if (f.s > cur) out.push({ s: cur, e: f.s, endKind: f.buffer ? "game" : "fixed", endLabel: f.label, endSpan: f });
        cur = Math.max(cur, f.e);
      });
      if (cur < limit) out.push({ s: cur, e: limit, endKind, endLabel: endKind === "game" ? "pregame" : null });
      else if (!out.length) out.push({ s: cur, e: cur, endKind: endKind === "open" ? "open" : endKind, endLabel: null });
      // the segment that reaches the game buffer is the one that gets the transition block
      if (bufStart != null && endKind === "game") out.forEach((sg) => { if (sg.e === bufStart) sg.endKind = "game"; });
      return out;
    }
    const segs = segments();
    if (fp != null && offGame === 0 && endKind === "game") segs.forEach((sg) => { if (sg.e === fp) sg.endKind = "game"; });

    // ---- ordering: explicit edges > mention order (work band) > KB phase; stretch first
    function order(list) {
      const set = new Set(list);
      const edges = new Map(list.map((b) => [b, new Set()]));
      const explicit = new Set();
      const add = (x, y, exp) => {
        if (!x || !y || x === y || !set.has(x) || !set.has(y)) return;
        if (!exp && (explicit.has(`${y.key}>${x.key}`) || edges.get(y).has(x))) return;
        edges.get(x).add(y);
        if (exp) explicit.add(`${x.key}>${y.key}`);
      };
      list.forEach((b) => b.acts.forEach((a) => {
        a.after.forEach((o) => add(blockOf.get(o), b, true));
        a.before.forEach((o) => add(b, blockOf.get(o), true));
      }));
      // explicit edges are recorded first so implicit ones never contradict them
      list.forEach((w) => {
        if (!isWarm(w)) return;
        list.forEach((x) => { if (x !== w && kindsOf(x).some((k) => KB.NEEDS_WARMUP.includes(k))) add(w, x, false); });
      });
      list.forEach((t) => {
        if (!kindsOf(t).every((k) => k === "throwing")) return;
        list.forEach((x) => { if (x !== t && kindsOf(x).some((k) => KB.NEEDS_THROWING.includes(k))) add(t, x, false); });
      });
      const key = (b) => { const a = firstAct(b), band = bandOfB(b), ph = KB.phaseOf(a.kind); return MENTION_FIRST && band === KB.BAND.work ? [band, a.order, ph] : [band, ph, a.order]; };
      const cmp = (x, y) => { const kx = key(x), ky = key(y); for (let i = 0; i < 3; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i]; return list.indexOf(x) - list.indexOf(y); };
      const indeg = new Map(list.map((b) => [b, 0]));
      edges.forEach((ys) => ys.forEach((y) => indeg.set(y, indeg.get(y) + 1)));
      const out = [], left = new Set(list);
      while (left.size) {
        let ready = [...left].filter((b) => indeg.get(b) === 0);
        if (!ready.length) ready = [...left]; // cycle: fall back to the ordering key
        ready.sort(cmp);
        const b = ready[0];
        left.delete(b); out.push(b);
        edges.get(b).forEach((y) => indeg.set(y, indeg.get(y) - 1));
      }
      return out;
    }

    /* fit: durations inside `cap` minutes.  fu: [{def,min,max,rigid,tier,weight,prep}] */
    function fit(fu, cap, expand) {
      const d = fu.map((u) => u.def);
      const flex = (i) => !fu[i].rigid;
      const st = (i) => fu[i].step || 5; // rounds of one activity move together (5 min × rounds)
      if (sum(d) > cap) {
        let need = sum(d) - cap;
        for (const tier of [-1, 0, 1, 2]) {
          if (need <= 0) break;
          const idx = d.map((_, i) => i).filter((i) => flex(i) && fu[i].tier === tier && d[i] > fu[i].min);
          const slack = sum(idx.map((i) => d[i] - fu[i].min));
          if (!slack) continue;
          const take = Math.min(need, slack);
          idx.forEach((i) => (d[i] -= ((d[i] - fu[i].min) * take) / slack));
          need -= take;
        }
        d.forEach((x, i) => { if (flex(i)) d[i] = Math.min(fu[i].def, Math.max(fu[i].min, fu[i].prep ? f5(x) : Math.round(x / st(i)) * st(i))); });
        let guard = 0;
        while (sum(d) > cap && guard++ < 500) {
          const c = d.map((_, i) => i).filter((k) => flex(k) && d[k] - st(k) >= fu[k].min).sort((a, b) => fu[a].tier - fu[b].tier || d[b] / st(b) - d[a] / st(a));
          if (!c.length) break;
          d[c[0]] -= st(c[0]);
        }
        guard = 0;
        while (guard++ < 500) {
          const c = d.map((_, i) => i).filter((k) => flex(k) && !fu[k].prep && d[k] + st(k) <= fu[k].def && sum(d) + st(k) <= cap).sort((a, b) => fu[b].tier - fu[a].tier);
          if (!c.length) break;
          d[c[0]] += st(c[0]);
        }
      } else if (expand && sum(d) < cap) {
        // a little slack goes to the transition first (up to 30 min) so a small edit doesn't
        // re-stretch every other item; then water-fill toward max, weighted by emphasis;
        // the transition absorbs what is left (up to its 45-min cap — beyond that it's open time)
        const pi = fu.findIndex((u) => u.prep);
        if (pi >= 0) d[pi] = Math.max(d[pi], Math.min(30, d[pi] + (cap - sum(d))));
        let extra = cap - sum(d), guard = 0;
        while (extra > 0.5 && guard++ < 50) {
          const act = d.map((_, i) => i).filter((i) => flex(i) && !fu[i].prep && d[i] < fu[i].max - 1e-9);
          if (!act.length) break;
          const W = sum(act.map((i) => fu[i].weight));
          let used = 0;
          act.forEach((i) => { const inc = Math.min((fu[i].weight * extra) / W, fu[i].max - d[i]); d[i] += inc; used += inc; });
          extra -= used;
          if (used < 1e-9) break;
        }
        d.forEach((x, i) => { if (flex(i) && !fu[i].prep) d[i] = Math.max(fu[i].def, Math.floor(x / st(i)) * st(i)); });
        const p = fu.findIndex((u) => u.prep);
        if (p >= 0) d[p] = Math.min(fu[p].max, d[p] + Math.max(0, cap - sum(d)));
      }
      const tot = sum(d);
      return { d, over: Math.max(0, tot - cap), open: Math.max(0, cap - tot) };
    }

    // ---- assign ordered blocks to segments (DP: keeps order, balances idle time)
    function assign(list, sgs) {
      const n = list.length, m = sgs.length;
      if (!m) return [];
      const lo = list.map(() => 0), hi = list.map(() => m - 1);
      const segAfter = (t) => sgs.findIndex((sg) => sg.s >= t);
      const segBefore = (t) => { let k = -1; sgs.forEach((sg, i) => { if (sg.e <= t) k = i; }); return k; };
      const fixedWarm = fixedBlocks.filter((b) => b.track === "main" && isWarm(b));
      list.forEach((b, i) => {
        b.acts.forEach((a) => {
          a.after.forEach((o) => { const f = blockOf.get(o); if (f && f.span) { const k = segAfter(f.span[1]); if (k >= 0) lo[i] = Math.max(lo[i], k); } });
          a.before.forEach((o) => { const f = blockOf.get(o); if (f && f.span) { const k = segBefore(f.span[0]); if (k >= 0) hi[i] = Math.min(hi[i], k); } });
        });
        // work never goes before a fixed team stretch (unless asked)
        if (kindsOf(b).some((k) => KB.NEEDS_WARMUP.includes(k)) && fixedWarm.length) {
          const w = fixedWarm.slice().sort((x, y) => x.span[0] - y.span[0])[0];
          const explicitBefore = b.acts.some((a) => a.before.some((o) => blockOf.get(o) === w));
          const k = segAfter(w.span[1]);
          if (!explicitBefore && k >= 0) lo[i] = Math.max(lo[i], k);
        }
        if (lo[i] > hi[i]) { lo[i] = 0; hi[i] = m - 1; }
      });
      // soft: keep the KB order relative to stated times — a block placed after a fixed item that
      // normally comes later (throwing after a 4:30 BP), or before one that normally comes earlier,
      // costs 40 per inversion
      const fixedMain = fixedBlocks.filter((b) => b.track === "main");
      const phaseB = (b) => Math.min(...kindsOf(b).map((k) => KB.phaseOf(k)));
      const pen = (b, j) => {
        const ph = phaseB(b), sg = sgs[j];
        let c = 0;
        fixedMain.forEach((f) => {
          const fp2 = phaseB(f);
          if (f.span[1] <= sg.s && fp2 > ph && KB.bandOf(kindsOf(f)[0]) !== KB.BAND.wind) c += 40;
          if (f.span[0] >= sg.e && fp2 < ph && KB.bandOf(kindsOf(b)[0]) !== KB.BAND.wind && kindsOf(f)[0] !== "meal") c += 40;
        });
        return c;
      };
      const cost = (j, p, q) => {
        const sg = sgs[j];
        let c = 0;
        for (let i = p; i < q; i++) { if (j < lo[i] || j > hi[i]) return Infinity; c += pen(list[i], j); }
        if (sg.e === Infinity) return c;
        // a game segment's transition absorbs up to 45 min of slack, so idle there costs less
        const cap = sg.e - sg.s, reserve = sg.endKind === "game" && !statedPrep ? PREP_DEF : 0, capW = Math.max(0, cap - reserve);
        const absorb = reserve ? 45 - PREP_DEF : 0;
        let uMin = 0, uDef = 0, uMax = 0;
        for (let i = p; i < q; i++) { const b = list[i]; uMin += minLen(b) + b.lead; uDef += defLen(b) + b.lead; uMax += maxLen(b) + b.lead; }
        if (uMin > cap) return c + 1e4 + 100 * (uMin - cap);
        if (uDef > capW) c += 2 * (uDef - capW);
        const idle = Math.max(0, capW - uMax - absorb);
        return c + (capW ? (idle * idle) / capW : 0);
      };
      const f = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
      const arg = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(-1));
      f[0][0] = 0;
      for (let j = 1; j <= m; j++) for (let q = 0; q <= n; q++) for (let p = 0; p <= q; p++) {
        if (f[j - 1][p] === Infinity) continue;
        const c = f[j - 1][p] + cost(j - 1, p, q);
        if (c < f[j][q]) { f[j][q] = c; arg[j][q] = p; }
      }
      const seg = new Array(n).fill(m - 1);
      if (f[m][n] === Infinity) {
        // nothing satisfies the ranges: keep order, put everything in its lowest allowed segment
        let k = 0; list.forEach((b, i) => { k = Math.max(k, lo[i]); seg[i] = k; });
        return seg;
      }
      let q = n;
      for (let j = m; j >= 1; j--) { const p = arg[j][q]; for (let i = p; i < q; i++) seg[i] = j - 1; q = p; }
      return seg;
    }

    /* where a game segment's transition goes: at the end, before any stated trailing free
       time. ("…BP, 45 off, stretch" → stretch, then the transition, then first pitch.) */
    function tailAt(fu) {
      let k = fu.length;
      while (k > 0 && fu[k - 1].u && fu[k - 1].u.kind === "free") k--;
      return k;
    }
    // ---- lay out the main flow
    // Flexible work never overlaps a fixed item, even when the day is overfull: a block that
    // can't fit a segment at its minimum length moves on to the next segment (it flows around
    // lunch), and whatever still doesn't fit before the window ends is left out of the plan and
    // named in the overfull conflict. Stated lengths (dur, rounds.each) are never changed.
    const notes = { compressed: [], expanded: [], open: [], dropped: [] };
    const minFoot = (bl) => sum(bl.map((b) => b.lead + (b.tpl ? b.len : minLen(b))));
    function layoutMain(list) {
      const ord = order(list);
      const segOf = assign(ord, segs);
      let carry = [];
      segs.forEach((sg, j) => {
        const bl = carry.concat(ord.filter((_, i) => segOf[i] === j));
        carry = [];
        const open = sg.e === Infinity;
        const cap = open ? Infinity : sg.e - sg.s;
        if (!open) {
          const last = j === segs.length - 1;
          while (bl.length && minFoot(bl) > cap) {
            if (!last) {
              // move work on, a round at a time, so what fits stays (BP Round 1 before lunch, Round 2 after)
              const b = bl[bl.length - 1];
              if (b.units && b.units.length > 1) {
                carry.unshift(Object.assign({}, b, { key: `${b.key}#${b.units.length}`, lead: 0, units: b.units.slice(-1) }));
                bl[bl.length - 1] = Object.assign({}, b, { units: b.units.slice(0, -1) });
              } else carry.unshift(bl.pop());
              continue;
            }
            const b = bl[bl.length - 1];
            if (b.units && b.units.length > 1) { notes.dropped.push(b.units[b.units.length - 1]); bl[bl.length - 1] = Object.assign({}, b, { units: b.units.slice(0, -1) }); }
            else { bl.pop(); notes.dropped.push((b.units || b.tpl.items)[0]); }
          }
        }
        // fit units: [lead free] + units (or a rigid parallel block)
        const fu = [];
        bl.forEach((b) => {
          if (b.lead) fu.push({ b, lead: true, def: b.lead, min: b.lead, max: b.lead, rigid: true, tier: 9, weight: 0 });
          if (b.tpl) fu.push({ b, par: true, def: b.len, min: b.len, max: b.len, rigid: true, tier: 9, weight: 0 });
          else if (b.units.length > 1 && !b.units[0].rigid && b.units.every((u) => u.actId === b.units[0].actId)) {
            // flexible rounds stay equal: one fit entry stepping 5 min per round
            const n = b.units.length, u0 = b.units[0];
            fu.push({ b, rounds: b.units, def: n * u0.def, min: n * u0.min, max: n * u0.max, rigid: false, tier: u0.tier, weight: u0.weight * n, step: 5 * n });
          }
          else b.units.forEach((u, ui) => fu.push({ b, u, ui, def: u.def, min: u.min, max: u.max, rigid: u.rigid, tier: u.tier, weight: u.weight }));
        });
        const withPrep = sg.endKind === "game" && !statedPrep && !open;
        // the transition goes at the end, before any stated trailing free time
        if (withPrep) {
          const pk = KB.kind("pregamePrep").dur;
          fu.splice(tailAt(fu), 0, { prep: true, def: pk.def, min: 0, max: Math.max(pk.max, 45), rigid: false, tier: -1, weight: 1 });
        }
        let r = open ? { d: fu.map((x) => x.def), over: 0, open: 0 } : fit(fu, cap, sg.endKind !== "open");
        if (withPrep) {
          const p = fu.findIndex((x) => x.prep);
          if (r.d[p] < KB.kind("pregamePrep").dur.min) { fu.splice(p, 1); r = fit(fu, cap, true); }
        }
        // where the unrequested open time sits: before the transition / trailing free, else at the end
        let gapAt = fu.length;
        const pIdx = fu.findIndex((x) => x.prep);
        if (pIdx >= 0) gapAt = pIdx;
        else if (sg.endKind === "game") gapAt = tailAt(fu);
        let t = sg.s;
        fu.forEach((x, i) => {
          if (i === gapAt && r.open >= 5) { notes.open.push([t, t + r.open]); t += r.open; }
          const dd = r.d[i];
          if (x.prep) { if (dd > 0) emit({ actId: null, kind: "pregamePrep", label: KB.label("pregamePrep"), track: "all", source: "inferred", resource: "clubhouse" }, t, t + dd, { id: "prep" }); }
          else if (x.lead) emit(freeUnit(x.b), t, t + dd, { flexible: false, source: "stated" });
          else if (x.par) x.b.tpl.items.forEach((u) => emit(u, t + u.off, t + u.off + u.dur, { flexible: false }));
          else if (x.rounds) {
            const each = dd / x.rounds.length;
            x.rounds.forEach((u, k) => emit(u, t + k * each, t + (k + 1) * each, { flexible: true }));
            if (each < x.rounds[0].def) notes.compressed.push(x.rounds[0].label.replace(/ — Round \d+$/, ""));
            if (each > x.rounds[0].def) notes.expanded.push(x.rounds[0].label.replace(/ — Round \d+$/, ""));
          }
          else {
            emit(x.u, t, t + dd, { flexible: !x.u.rigid });
            if (dd < x.u.def) notes.compressed.push(x.u.label.replace(/ — Round \d+$/, ""));
            if (dd > x.u.def) notes.expanded.push(x.u.label.replace(/ — Round \d+$/, ""));
          }
          t += dd;
        });
        if (gapAt >= fu.length && r.open >= 5) notes.open.push([t, t + r.open]);
      });
      if (notes.dropped.length) overfull(ord);
      return ord;
    }

    /** one conflict for the whole window: what was requested, what fits, what was left out */
    function overfull(ord) {
      const capSegs = segs.filter((sg) => sg.e !== Infinity);
      const avail = sum(capSegs.map((sg) => sg.e - sg.s));
      const reqAll = sum(ord.map((b) => b.lead + defLen(b)));
      const over = Math.max(5, c5(minFoot(ord) - avail));
      const lastSeg = segs[segs.length - 1];
      const where = lastSeg.endKind === "game" ? "before pregame" : lastSeg.endKind === "end" ? `before the ${fmtAP(lastSeg.e)} finish` : `between ${fmtAP(start)} and ${fmtAP(lastSeg.e)}`;
      const dropped = uniq(notes.dropped.map((u) => u.label));
      const shortened = uniq(notes.compressed);
      // Each alternative is checked by solving the edited request: an amount that only covers the
      // total overage can still leave work out when lunch splits the day, so it grows in 15-min
      // steps until nothing is left out (alternatives that never get there are not offered).
      const alts = [];
      const T = (id) => ({ kind: null, who: null, label: null, id });
      const fits = (ops) => { try { const q = solve(applyEdits(irIn, ops, ctx), Object.assign({}, ctx, { _noAlts: true })); return !q.conflicts.some((c) => c.code === "overfull" || c.code === "impossible"); } catch (e) { return false; } };
      const offer = (make) => { for (let k = 0; k <= 24; k++) { const alt = make(over + 15 * k); if (!alt) return; if (fits(alt.ops)) { alts.push(alt); return; } } };
      if (!ctx._noAlts) {
        // 1. shorten the largest activity (or each of its rounds), from its minimum length
        const byAct = new Map();
        ord.forEach((b) => { if (b.units) b.units.forEach((u) => byAct.set(u.actId, (byAct.get(u.actId) || 0) + u.min)); });
        const sorted = [...byAct.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length) {
          const [aid, tot] = sorted[0], a = actById.get(aid);
          const n = sum(ord.filter((b) => b.units && b.units[0].actId === aid).map((b) => b.units.length));
          const label0 = (ord.find((b) => b.units && b.units[0].actId === aid).units[0].label || "").replace(/ — Round \d+$/, "");
          if (n > 1) {
            const each = tot / n;
            offer((cut) => { const e = each - c5(cut / n); return e >= 10 ? { label: `Shorten each ${label0} round to ${e} min`, ops: [{ op: "rounds", target: T(aid), count: null, each: e, groups: null, atOnce: null }] } : null; });
          } else offer((cut) => (tot - cut >= 10 ? { label: `Shorten ${label0} to ${tot - cut} min`, ops: [{ op: "duration", target: T(aid), set: tot - cut, delta: null }] } : null));
          if (!alts.length && sorted.length > 1) {
            const [bid, btot] = sorted[1];
            offer((cut) => { const h = c5(cut / 2); return tot - h >= 10 && btot - h >= 10 ? { label: `Shorten ${KB.label(a.kind)} and ${KB.label(actById.get(bid).kind)} by ${h} min each`, ops: [
              { op: "duration", target: T(aid), set: tot - h, delta: null }, { op: "duration", target: T(bid), set: btot - h, delta: null }] } : null; });
          }
        }
        // 2. run BP rounds side by side (field + cage), or BP and cage groups as a rotation
        const bpB = ord.find((b) => b.units && b.units.length >= 2 && b.acts[0].kind === "bp");
        if (bpB && (res.cages == null || res.cages >= 1)) {
          const cageB = ord.find((b) => b.units && b.acts[0].kind === "cage");
          const lanes = Math.min(bpB.units.length, Math.max(1, fields + cages));
          const save = defLen(bpB) - Math.ceil(bpB.units.length / lanes) * bpB.units[0].def;
          const ops = [{ op: "parallel", targets: [T(bpB.key)].concat(cageB ? [T(cageB.key)] : []) }];
          if ((cageB || save > 0) && fits(ops)) alts.push({ label: cageB ? "Run BP and cage groups as a rotation (field + cage), then swap" : `Run BP rounds at the same time (field + cage) — saves ${mins(save)}`, ops });
        }
        // 3. start earlier / finish later / a shorter free window
        // a stated stretch that opens the day moves with the start (work can't go before it)
        const opener = fixedBlocks.find((fb) => fb.track === "main" && fb.span && fb.span[0] === start && isWarm(fb));
        if (segs[0].s === start || opener) offer((m) => ({ label: opener ? `Start ${mins(m)} earlier, with ${(opener.units || opener.tpl.items)[0].label} at ${fmtAP(start - m)}` : `Start ${mins(m)} earlier (${fmtAP(start - m)})`,
          ops: [{ op: "anchor", key: "start", value: start - m }].concat(opener ? [{ op: "at", target: T(opener.key), at: opener.at - m }] : []) }));
        if (lastSeg.endKind === "end") offer((m) => ({ label: `Finish ${mins(m)} later (${fmtAP(lastSeg.e + m)})`, ops: [{ op: "anchor", key: "end", value: lastSeg.e + m }] }));
        if (lastSeg.endKind === "game") offer((m) => (offGame > m ? { label: `Cut the pregame free time to ${offGame - m} min`, ops: [{ op: "anchor", key: "offBeforeGame", value: offGame - m }] } : null));
        // 4. accept the cut: take the left-out activities off the request
        const goneIds = uniq(notes.dropped.map((u) => u.actId)).filter((id) => id && !items.some((i) => i.actId === id));
        if (goneIds.length && goneIds.length <= 3) {
          const ops = goneIds.map((id) => ({ op: "remove", target: T(id) }));
          if (fits(ops)) alts.push({ label: `Leave out ${goneIds.map((id) => (actById.get(id).label || KB.label(actById.get(id).kind))).join(", ")}`, ops });
        }
      }
      const msg = `Your requested activities need about ${mins(reqAll)}, but only ${mins(avail)} ${avail === 1 ? "is" : "are"} available ${where}.`
        + ` Left out: ${dropped.join(", ")}.` + (shortened.length ? ` Shortened: ${shortened.join(", ")}.` : "");
      conflict("overfull", "error", msg, alts);
    }

    let mainList = flexMain.slice();
    let snapshot = items.length;
    layoutMain(mainList);

    // ---- pitcher work beside position-player work
    function placePitchers() {
      const ord = order(flexPitch);
      const lim = flexEnd != null ? flexEnd : Math.max(start, ...items.map((i) => i.end));
      const busy = () => items.filter((i) => i.track === "all" || i.track === "pitchers").map((i) => [i.start, i.end]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
      // default: after the opening team block (meeting / stretch / throwing) — i.e. during defense
      const sorted = items.filter((i) => i.track !== "pitchers" && i.end > i.start).sort((a, b) => a.start - b.start);
      let earliest = start;
      const w0 = sorted.findIndex((i) => i.track === "all" && ["activation", "stretch"].includes(i.kind));
      if (w0 >= 0) {
        earliest = sorted[w0].end;
        for (let k = w0 + 1; k < sorted.length && sorted[k].track === "all" && ["activation", "stretch", "throwing"].includes(sorted[k].kind); k++) earliest = sorted[k].end;
      } else for (const it of sorted) { if (it.track === "all" && ["meeting", "arrival", "throwing"].includes(it.kind)) earliest = it.end; else break; }
      const misfit = [];
      let cursor = earliest;
      ord.forEach((b) => {
        let est = cursor;
        b.acts.forEach((a) => a.after.forEach((o) => { const its = items.filter((i) => i.actId === o); if (its.length) est = Math.max(est, ...its.map((i) => i.end)); }));
        const need = b.tpl ? b.len : defLen(b), needMin = b.tpl ? b.len : minLen(b);
        const gaps = [];
        let t = est;
        busy().forEach(([s, e]) => { if (e <= t) return; if (s > t) gaps.push([t, Math.min(s, lim)]); t = Math.max(t, e); });
        if (t < lim) gaps.push([t, lim]);
        const g = gaps.find(([s, e]) => e - s >= need) || gaps.find(([s, e]) => e - s >= needMin + b.lead);
        if (!g) { misfit.push(b); return; }
        const room = g[1] - g[0] - b.lead;
        const durs = b.units ? (room >= need ? b.units.map((u) => u.def) : fit(b.units.map((u) => ({ def: u.def, min: u.min, max: u.max, rigid: u.rigid, tier: u.tier, weight: u.weight })), room, false).d) : null;
        cursor = placeBlock(b, g[0], durs, { fixed: false });
      });
      return misfit;
    }
    let misfit = placePitchers();
    if (misfit.length) {
      // no room beside position work: run it on its own in the main sequence
      items.splice(snapshot);
      notes.compressed.length = 0; notes.expanded.length = 0; notes.open.length = 0; notes.dropped.length = 0;
      conflicts.splice(0, conflicts.length, ...conflicts.filter((c) => c.code !== "overfull"));
      mainList = flexMain.concat(misfit);
      misfit.forEach((b) => say(`alone:${b.key}`, `${(b.units || b.tpl.items)[0].label.replace(/ — Round \d+$/, "")} has no position-player work to run beside, so it gets its own time.`));
      const keep = new Set(misfit);
      flexPitch.splice(0, flexPitch.length, ...flexPitch.filter((b) => !keep.has(b)));
      layoutMain(mainList);
      placePitchers();
    }

    // ---- arrival and postgame
    blocks.filter(special).forEach((b) => {
      const a = b.acts[0];
      if (a.kind === "arrival") placeBlock(b, a.at != null ? a.at : start, null, { fixed: a.at != null, flexible: false, source: a.at != null ? "stated" : "inferred" });
      else {
        let s = a.at;
        if (s == null && fp != null) { s = fp + 180; say("postgame", "Postgame placed after a typical 3-hour game."); }
        if (s == null) s = Math.max(start, ...items.filter((i) => i.track !== "pitchers").map((i) => i.end));
        placeBlock(b, s, null, { fixed: a.at != null, flexible: a.at == null, source: a.at != null ? "stated" : "default" });
      }
    });

    parIssues.forEach((pi) => {
      const its = items.filter((i) => i.actId === pi.actId);
      const at = its.length ? Math.min(...its.map((i) => i.start)) : start;
      conflict("resource", pi.known ? "error" : "warn", pi.text(at), pi.alts);
    });
    // ---- resources: cages and the field
    const sweep = (list) => { const ev = []; list.forEach((i) => { ev.push([i.start, 1]); ev.push([i.end, -1]); }); ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, mx = 0, at = null; ev.forEach(([t, d]) => { c += d; if (c > mx) { mx = c; at = t; } }); return { mx, at }; };
    const cageU = sweep(items.filter((i) => i.resource === "cage" && i.end > i.start));
    if (cageU.mx > cages) conflict("resource", cagesKnown ? "error" : "warn", `${cageU.mx} groups need a cage at ${fmtAP(cageU.at)}, but ${cagesKnown ? `only ${cages} ${cages === 1 ? "cage is" : "cages are"} available` : "one cage was assumed"}.`, []);
    const fieldU = sweep(items.filter((i) => i.exclusive && i.end > i.start));
    if (fieldU.mx > fields) conflict("resource", res.fields != null ? "error" : "warn", `${fieldU.mx} groups need the whole field at ${fmtAP(fieldU.at)}, but ${res.fields != null ? `only ${fields} ${fields === 1 ? "field is" : "fields are"} available` : "one field was assumed"}.`, []);

    // ---- assumptions
    if (notes.compressed.length) say("compressed", `Shortened ${uniq(notes.compressed).join(", ")} to fit.`);
    if (notes.expanded.length) say("expanded", `Lengthened ${uniq(notes.expanded).join(", ")} to use the available time.`);
    if (notes.open.length) say("open", `Open: ${notes.open.map(([s, e]) => `${fmt(s)}–${fmt(e)}`).join(", ")} (nothing requested).`);
    const hasPitch = acts.some((a) => trackOf(a.who) === "pitchers");
    if (!hasPitch && acts.some((a) => trackOf(a.who) === "position")) say("pitchers", "No pitcher work mentioned — add a pitchers' throwing program?");
    (ir.notes || []).forEach((t, i) => t && say(`note:${i}`, String(t)));
    if ((ir.unknown || []).length) say("unknown", `Not understood: ${ir.unknown.map((u) => `“${u}”`).join(", ")}.`);

    // ---- finish
    items.sort((a, b) => a.start - b.start || (a.kind === "game") - (b.kind === "game") || ["all", "position", "pitchers"].indexOf(a.track) - ["all", "position", "pitchers"].indexOf(b.track) || (a.round || 0) - (b.round || 0));
    const used = new Set();
    items.forEach((it) => {
      if (!it.id) it.id = it.actId ? `${it.actId}${it.round ? ".r" + it.round : ""}${it.kind !== (actById.get(it.actId) || {}).kind ? "." + it.kind : ""}` : `${it.kind}-${it.start}`;
      let id = it.id, k = 2;
      while (used.has(id)) id = `${it.id}.${k++}`;
      it.id = id; used.add(id);
      delete it.exclusive;
    });
    const avail = sum(segs.map((sg) => (sg.e === Infinity ? 0 : sg.e - sg.s)));
    const workEnd = flexEnd != null ? flexEnd : Math.max(start, ...items.filter((i) => i.kind !== "postgame").map((i) => i.end));
    return {
      items,
      window: { start, end: workEnd, available: segs.some((sg) => sg.e === Infinity) ? null : avail, required: reqDef, firstPitch: fp, hardEnd: hardEnd != null ? hardEnd : null },
      assumptions: [...asm.entries()].map(([key, text]) => ({ key, text })),
      conflicts,
      ok: !conflicts.some((c) => c.severity === "error")
    };
  }

  /* ================================================================ edits */
  const blankAct = (a, ir) => {
    const kind = KB.kind(a && a.kind) ? a.kind : "custom";
    const ids = new Set((ir.activities || []).map((x) => x.id));
    let id = a && a.id && !ids.has(a.id) ? a.id : null;
    for (let n = (ir.activities || []).length + 1; !id; n++) if (!ids.has(`a${n}`)) id = `a${n}`;
    const order = Math.max(0, ...(ir.activities || []).map((x) => (isInt(x.order) ? x.order : 0))) + 1;
    return Object.assign({ label: KB.label(kind), who: KB.kind(kind).who, at: null, dur: null, rounds: null, after: [], before: [], indoor: null, location: null, emphasis: null, text: null }, a || {}, { id, kind, order: a && isInt(a.order) ? a.order : order });
  };
  /**
   * Apply EditOps to a request → a new request (the input is never mutated).
   * ctx is optional; it is used to read current planned times/lengths for
   * relative ops (shift, delta, lock) on items without a stated time/length.
   */
  function applyEdits(irIn, ops, ctx) {
    const ir = clone(irIn || {}) || {};
    ir.activities = (ir.activities || []).map((a) => Object.assign({ after: [], before: [] }, a));
    ir.anchors = Object.assign({ start: null, end: null, firstPitch: null, offBeforeGame: null }, ir.anchors || {});
    ir.notes = (ir.notes || []).filter((n) => !/^Edit: /.test(n));
    let planCache = null;
    const plan = () => planCache || (planCache = solve(ir, ctx || {}));
    const dirty = () => { planCache = null; };
    const byId = (id) => ir.activities.find((a) => a.id === id);
    const note = (t) => { const s = `Edit: ${t}`; if (!ir.notes.includes(s)) ir.notes.push(s); };
    const tdesc = (t) => (t === "all-hitting" ? "hitting" : t ? t.label || (t.kind && KB.label(t.kind)) || t.who || t.id || "that" : "that");
    const resolve = (t) => { const ids = resolveTarget(ir, t); if (!ids.length) note(`couldn't find ${tdesc(t)} in the day.`); return ids; };
    const planned = (id) => plan().items.filter((i) => i.actId === id && i.kind !== "free");
    const curDur = (a) => {
      const its = planned(a.id);
      if (a.dur != null) return a.dur;
      if (its.length) return Math.max(...its.map((i) => i.end)) - Math.min(...its.map((i) => i.start));
      return KB.durOf(a.kind, ctx).def;
    };
    const roundsN = (a) => (a.rounds && a.rounds.count) || planned(a.id).filter((i) => i.round).length || 1;
    const scrub = (id) => {
      ir.activities.forEach((a) => { a.after = a.after.filter((x) => x !== id); a.before = a.before.filter((x) => x !== id); });
      ir.offBefore = (ir.offBefore || []).filter((o) => o.before !== id);
      ir.parallel = (ir.parallel || []).map((g) => g.filter((x) => x !== id)).filter((g) => g.length);
    };
    (ops || []).forEach((op) => {
      if (!op || typeof op !== "object") return;
      switch (op.op) {
        case "move": {
          const T = resolve(op.target).filter((x) => x !== "game");
          const B = op.before ? resolve(op.before).filter((x) => !T.includes(x)) : [];
          const A = op.after ? resolve(op.after).filter((x) => !T.includes(x)) : [];
          T.forEach((id) => {
            const a = byId(id);
            if (a.at != null) { a.at = null; }
            // the new relation replaces any that contradicts it, on both sides
            a.after = a.after.filter((x) => !B.includes(x));
            a.before = a.before.filter((x) => !A.includes(x));
            B.forEach((b) => { const o = byId(b); if (o) o.before = o.before.filter((x) => x !== id); });
            A.forEach((b) => { const o = byId(b); if (o) o.after = o.after.filter((x) => x !== id); });
            // edges from other items that would form a cycle via this move
            a.before = uniq(a.before.concat(B.filter((b) => b !== "game")));
            a.after = uniq(a.after.concat(A.filter((b) => b !== "game")));
          });
          if (B.includes("game")) note("everything already ends before the game.");
          break;
        }
        case "duration": {
          let T = resolve(op.target).filter((x) => x !== "game");
          if (op.delta != null && op.set == null && T.length > 1) T = [T.slice().sort((x, y) => curDur(byId(y)) - curDur(byId(x)))[0]]; // "give pitchers another 15" → their main block
          T.forEach((id) => {
            const a = byId(id);
            const hasR = a.rounds || a.kind === "bp";
            const total = op.set != null ? op.set : curDur(a) + (op.delta || 0);
            if (hasR && roundsN(a) > 1) {
              const n = roundsN(a);
              a.rounds = Object.assign({ each: null, count: null }, a.rounds || {}, { each: Math.max(5, r5(total / n)), count: (a.rounds && a.rounds.count) || n });
              a.dur = null;
            } else a.dur = Math.max(5, total);
          });
          dirty();
          break;
        }
        case "shift": {
          resolve(op.target).forEach((id) => {
            if (id === "game") { if (ir.anchors.firstPitch != null) ir.anchors.firstPitch += op.delta || 0; return; }
            const a = byId(id);
            const s = a.at != null ? a.at : (planned(id)[0] || {}).start;
            if (s != null) a.at = s + (op.delta || 0);
          });
          dirty();
          break;
        }
        case "at": {
          const T = resolve(op.target);
          if (T[0] === "game") ir.anchors.firstPitch = op.at;
          else if (T.length) byId(T[0]).at = op.at;
          dirty();
          break;
        }
        case "add": {
          ir.activities.push(blankAct(op.activity, ir));
          dirty();
          break;
        }
        case "remove": {
          resolve(op.target).forEach((id) => {
            if (id === "game") { ir.anchors.firstPitch = null; ir.anchors.offBeforeGame = null; if (ir.dayType === "game") ir.dayType = "workout"; return; }
            ir.activities = ir.activities.filter((a) => a.id !== id);
            scrub(id);
          });
          dirty();
          break;
        }
        case "anchor": {
          if (["start", "end", "firstPitch", "offBeforeGame"].includes(op.key)) ir.anchors[op.key] = op.value == null ? null : op.value;
          if (op.key === "firstPitch" && op.value != null && !ir.dayType) ir.dayType = "game";
          dirty();
          break;
        }
        case "rounds": {
          const t = op.target || { kind: "bp" };
          let T = resolveTarget(ir, t);
          if (!T.length && (!t.kind || t.kind === "bp") && (op.count || op.groups) && !op.target) {
            const a = blankAct({ kind: "bp" }, ir); ir.activities.push(a); T = [a.id];
          }
          if (!T.length) note(`couldn't find ${tdesc(t)} in the day.`);
          if (op.groups != null) ir.groups = Object.assign({ hitting: null, pitchers: null }, ir.groups || {}, { hitting: op.groups });
          T.filter((x) => x !== "game").forEach((id) => {
            const a = byId(id), cur = a.rounds || { each: null, count: null, atOnce: null };
            a.rounds = { each: op.each != null ? op.each : cur.each, count: op.count != null ? op.count : op.groups != null ? op.groups : cur.count,
              atOnce: op.atOnce != null ? op.atOnce : cur.atOnce != null ? cur.atOnce : null };
            if (op.each != null) a.dur = null;
          });
          dirty();
          break;
        }
        case "parallel": {
          const ids = uniq((op.targets || []).flatMap((t) => resolve(t))).filter((x) => x !== "game");
          if (!ids.length) break;
          const groups = (ir.parallel || []).map((g) => g.slice());
          const hit = groups.find((g) => g.some((x) => ids.includes(x)));
          if (hit) ids.forEach((x) => { if (!hit.includes(x)) hit.push(x); });
          else groups.push(ids);
          ir.parallel = groups;
          dirty();
          break;
        }
        case "lock": {
          resolve(op.target).forEach((id) => {
            if (id === "game") return; // first pitch is always a fixed anchor
            const a = byId(id);
            if (a.kind === "game" || a.at != null) return;
            const its = planned(id);
            if (its.length) a.at = Math.min(...its.map((i) => i.start));
          });
          dirty();
          break;
        }
        case "indoor": {
          const ids = op.target === "all-hitting" ? resolveTarget(ir, "all-hitting") : resolve(op.target);
          ids.filter((x) => x !== "game").forEach((id) => { const a = byId(id); a.indoor = true; a.location = null; });
          dirty();
          break;
        }
        default:
          note(`unknown change "${op.op}".`);
      }
    });
    return ir;
  }

  return { SCHEMA, EDIT_SCHEMA, BUILD_RESPONSE_SCHEMA, REFINE_RESPONSE_SCHEMA, DEFS, OPS,
    validate, validateEdits, solve, applyEdits, resolveTarget, fmt, fmtAP, mins, KB };
});
