/* Manager Hub — "Describe the day" for a camp's master schedule (pure, no DOM, no network).

   A coordinator types or dictates the day across groups and facilities:
     "Tomorrow we have four groups. Everybody stretches at 9. Groups A and B take defense on Fields 1 and 2
      at 9:30. Pitchers start bullpens at 10. Group C hits at 10:15. All groups break for lunch at noon."
   and gets a PROPOSAL — blocks with a time, a length, who and where — to review before anything is added.

   Two interpreters produce the same structure (DescribeResult):
     read(text, ctx)                 the built-in reader: deterministic, offline, always available
     the AI interpreter              functions/apps/manager-hub/api/interpret.js mode "camp" (strict JSON schema
                                     CAMP_SCHEMA), checked here by validate() before the page uses it
   Neither writes anything. toActivities() turns a reviewed proposal into CampCore activities.

   ctx = { groups:[{id,name}], facilities:[{id,name,type}], staff:[{id,name}], roles:{pitcher:[pid],catcher:[pid],position:[pid]}, window:{start,end} }
   DescribeResult = { items:[Item], assumptions:[string], notUnderstood:[string], source:"reader"|"ai" }
   Item = { title, cat, start (min), dur (min), all (bool), groups:[name], roles:["pitcher"|"catcher"|"position"],
            facilities:[name], staff:[name], note }

   Browser: global `StDescribe`. Node: require("./st-describe.js"). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StDescribe = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const str = (v) => (v == null ? "" : String(v));
  const uniq = (a) => Array.from(new Set(a));

  /* activity words → title, category, usual minutes */
  const LEXICON = [
    [/\b(stretch(es|ing)?|warm[- ]?ups?|dynamic|activation)\b/i, "Stretch", "strength", 15],
    [/\b(lunch|meal)\b/i, "Lunch", "other", 45],
    [/\b(break)\b/i, "Break", "other", 15],
    [/\b(meeting|meet)\b/i, "Team Meeting", "meetings", 20],
    [/\bpfp\b/i, "PFP", "fundamentals", 15],
    [/\b(live bp|live batting)\b/i, "Live BP", "hitting", 20],
    [/\b(bullpens?|pens?|sides?)\b/i, "Bullpens", "pitching", 30],
    [/\b(catch play|throwing|throw|long toss)\b/i, "Throwing", "pitching", 20],
    [/\b(cage|cages|tee work|machine)\b/i, "Cage Work", "hitting", 40],
    [/\b(bp|batting practice|hit|hits|hitting|swing)\b/i, "Hitting", "hitting", 30],
    [/\b(baserunning|base running|running the bases)\b/i, "Baserunning", "fundamentals", 20],
    [/\b(bunt\w*)\b/i, "Bunt Defense", "fundamentals", 20],
    [/\b(cuts?|relays?)\b/i, "Cuts & Relays", "fundamentals", 25],
    [/\b(pickoffs?|rundowns?)\b/i, "Pickoffs & Rundowns", "fundamentals", 20],
    [/\b(infield( work)?)\b/i, "Infield Work", "fundamentals", 30],
    [/\b(outfield( work)?)\b/i, "Outfield Work", "fundamentals", 30],
    [/\b(team defense)\b/i, "Team Defense", "fundamentals", 30],
    [/\b(defen[cs]e|defensive|fundamentals?|fundy)\b/i, "Defense", "fundamentals", 30],
    [/\b(receiv(e|es|ing)|block(s|ing)?|catcher drills?|catching)\b/i, "Catcher Work", "fundamentals", 30],
    [/\b(lifts?|lifting|weights?|weight room)\b/i, "Lift", "strength", 45],
    [/\b(conditioning|sprints|runs?)\b/i, "Conditioning", "strength", 15],
    [/\b(recovery|treatment)\b/i, "Recovery", "strength", 15],
    [/\b(game prep|walk[- ]?through)\b/i, "Game Prep", "meetings", 20],
    [/\b(workouts?)\b/i, "Workout", "other", 45]
  ];
  const CAT_IDS = ["fundamentals", "hitting", "pitching", "strength", "meetings", "other"];
  const TYPE_WORDS = [[/\bfields?\b/i, "field"], [/\bcages?\b/i, "cage"], [/\b(bullpens?|mounds?|pens?)\b/i, "bullpen"], [/\b(catching area|catching)\b/i, "catching"],
    [/\b(weight room|weights)\b/i, "weight"], [/\b(indoor|turf)\b/i, "indoor"], [/\b(meeting room|classroom)\b/i, "meeting"]];
  const NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

  /* ---------- times ---------- */
  /** "9", "9:30", "930", "noon", "1:15 pm" → minutes; bare hours 1–5 read as afternoon, 6–11 morning */
  function timeOf(tok) {
    const s = str(tok).toLowerCase().trim();
    if (s === "noon") return 720;
    const m = /^(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(s);
    if (!m) return null;
    let h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 23 || mi > 59) return null;
    const ap = m[3] ? m[3][0] : null;
    if (ap === "p" && h < 12) h += 12; else if (ap === "a" && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 5) h += 12;
    return h * 60 + mi;
  }
  const TIME = "(noon|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)";
  function findTimes(s) {
    let m = new RegExp("\\bfrom\\s+" + TIME + "\\s*(?:to|until|till|-|–)\\s*" + TIME, "i").exec(s) || new RegExp("\\b" + TIME + "\\s*(?:-|–|to)\\s*" + TIME + "\\b", "i").exec(s);
    if (m) { const a = timeOf(m[1]), b = timeOf(m[2]); if (a != null && b != null && b > a) return { start: a, end: b }; }
    m = new RegExp("\\b(?:at|starting at|start at|begins? at|by)\\s+" + TIME, "i").exec(s);
    const until = new RegExp("\\b(?:until|till|to)\\s+" + TIME, "i").exec(s);
    if (m) { const a = timeOf(m[1]); const b = until ? timeOf(until[1]) : null; return { start: a, end: b != null && b > a ? b : null }; }
    m = /\bat\s+noon\b|\bnoon\b/i.exec(s); if (m) return { start: 720, end: null };
    return null;
  }
  function findDur(s) {
    let m = /\bfor\s+(?:an?\s+)?(hour|half(?:\s+an)?\s+hour)\b/i.exec(s);
    if (m) return /half/i.test(m[1]) ? 30 : 60;
    m = /\b(?:for\s+)?(\d{1,3})\s*(?:-|\s)?\s*(?:min(?:ute)?s?|mins|m)\b/i.exec(s);
    if (m) return +m[1];
    m = /\bfor\s+(\d(?:\.\d)?)\s*hours?\b/i.exec(s); if (m) return Math.round(+m[1] * 60);
    return null;
  }

  /* ---------- who ---------- */
  const ALL_RE = /\b(every(one|body)|all (of the )?(groups|players|camp)|the whole camp|whole camp|all groups|entire camp|everyone)\b/i;
  /** group tokens: "group A", "groups A and B", "groups 1, 2 and 3", "ST Group 2", and group names said in full */
  function findGroups(s, groups) {
    const out = [];
    const tok = /\bgroups?\s+((?:[a-z0-9]{1,2}\b(?:\s*(?:,|and|&|\+)\s*)?)+)/ig;
    let m;
    while ((m = tok.exec(s))) {
      m[1].split(/\s*(?:,|and|&|\+)\s*/).map((x) => x.trim()).filter(Boolean).forEach((t) => {
        const T = t.toUpperCase(), n = NUMWORD[t.toLowerCase()];
        const g = groups.find((g) => new RegExp("\\b(group\\s*)?" + T + "$", "i").test(g.name.trim())) || (n && groups.find((g) => new RegExp("\\b(group\\s*)?" + n + "$", "i").test(g.name.trim())));
        out.push(g ? g.name : "Group " + T);
      });
    }
    groups.forEach((g) => {   // a group named in full ("Catchers", "Early Work", "Starting Pitchers")
      const name = g.name.trim(); if (name.length < 4) return;
      if (new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(s) && !out.includes(name)) out.push(name);
    });
    return uniq(out);
  }
  function findRoles(s, groupsSaid) {
    const r = [];
    if (/\bpitchers?\b/i.test(s) && !groupsSaid.some((g) => /pitch/i.test(g))) r.push("pitcher");
    if (/\bcatchers?\b/i.test(s) && !groupsSaid.some((g) => /catch/i.test(g))) r.push("catcher");
    if (/\b(position players|hitters|infielders and outfielders)\b/i.test(s) && !/\bpitch/i.test(s.replace(/hitters/i, ""))) r.push("position");
    return r;
  }
  /** facilities: "Fields 1 and 2", "Field 3", "the cages", "bullpens", "Cage 2", names in full */
  function findFacilities(s, facilities) {
    const out = [];
    const re = /\b(fields?|cages?|bullpens?|mounds?)\s+((?:\d{1,2}\b(?:\s*(?:,|and|&)\s*)?)+)/ig;
    let m;
    while ((m = re.exec(s))) {
      const type = /field/i.test(m[1]) ? "field" : /cage/i.test(m[1]) ? "cage" : "bullpen";
      m[2].split(/\s*(?:,|and|&)\s*/).filter(Boolean).forEach((n) => {
        const f = facilities.find((f) => f.type === type && new RegExp("\\b" + n + "\\b").test(f.name)) || facilities.find((f) => new RegExp("\\b" + m[1].replace(/s$/i, "") + "\\s*" + n + "\\b", "i").test(f.name));
        out.push(f ? f.name : m[1].replace(/s$/i, "").replace(/^./, (c) => c.toUpperCase()) + " " + n);
      });
    }
    facilities.forEach((f) => { if (f.name.length >= 4 && new RegExp("\\b" + f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(s) && !out.includes(f.name)) out.push(f.name); });
    if (!out.length) TYPE_WORDS.forEach(([re2, type]) => {
      if (!re2.test(s)) return;
      const list = facilities.filter((f) => f.type === type);
      if (list.length === 1 || type === "bullpen" || type === "weight" || type === "meeting") { if (list[0]) out.push(list[0].name); }
      else if (list.length > 1 && /\b(the )?(cages|fields)\b/i.test(s)) out.push("__all_" + type);
    });
    return uniq(out);
  }

  /* ---------- sentences ---------- */
  function sentences(text) {
    return str(text).replace(/\s+/g, " ").split(/(?<=[.;!?])\s+|\s*\bthen\b\s*|\s*\n+\s*/i).map((x) => x.replace(/[.;!?]+$/, "").trim()).filter(Boolean);
  }
  const IGNORE = /^(tomorrow|today)?\s*(we have|we've got|there are|there's)\b.*\bgroups?\b|^(tomorrow|today)$/i;

  function read(text, ctx) {
    ctx = ctx || {};
    const groups = ctx.groups || [], facilities = ctx.facilities || [];
    const res = { items: [], assumptions: [], notUnderstood: [], source: "reader" };
    let lastEnd = null;
    sentences(text).forEach((s) => {
      if (IGNORE.test(s)) return;
      const lex = LEXICON.find(([re]) => re.test(s));
      const t = findTimes(s);
      if (!lex && !t) { res.notUnderstood.push(s); return; }
      if (!lex) { res.notUnderstood.push(s); return; }
      let start = t ? t.start : null;
      if (start == null) {
        if (lastEnd == null) { res.notUnderstood.push(s + " (no time given)"); return; }
        start = lastEnd; res.assumptions.push(lex[1] + " starts when the previous block ends (" + fmt(start) + ")");
      }
      let dur = t && t.end ? t.end - start : findDur(s);
      if (!dur) { dur = lex[3]; res.assumptions.push(lex[1] + ": " + dur + " minutes (usual length; no length given)"); }
      const gs = findGroups(s, groups), all = ALL_RE.test(s) || /^all\b/i.test(s);
      const roles = findRoles(s, gs);
      const facs = findFacilities(s, facilities);
      const base = { title: lex[1], cat: lex[2], start, dur, all: all && !gs.length, groups: [], roles, facilities: [], staff: [], note: "" };
      const allType = facs.find((f) => f.startsWith("__all_"));
      if (gs.length > 1 && facs.length === gs.length && !allType) {   // "Groups A and B … on Fields 1 and 2" pairs in order
        gs.forEach((g, i) => res.items.push(Object.assign({}, base, { groups: [g], facilities: [facs[i]] })));
        res.assumptions.push(gs.join(" and ") + " paired with " + facs.join(" and ") + " in the order said");
      } else if (allType && gs.length > 1) {
        const list = facilities.filter((f) => f.type === allType.slice(6));
        gs.forEach((g, i) => res.items.push(Object.assign({}, base, { groups: [g], facilities: list[i] ? [list[i].name] : [] })));
        res.assumptions.push(gs.join(", ") + " spread across the " + allType.slice(6) + "s");
      } else {
        res.items.push(Object.assign({}, base, { groups: gs, facilities: facs.filter((f) => !f.startsWith("__all_")) }));
      }
      if (!gs.length && !all && !roles.length) res.assumptions.push(lex[1] + " at " + fmt(start) + ": nobody named — assign a group in review");
      gs.filter((g) => !groups.some((x) => x.name === g)).forEach((g) => res.assumptions.push("“" + g + "” isn't a group in this camp yet"));
      lastEnd = start + dur;
    });
    return res;
  }
  const fmt = (m) => { const h = Math.floor(m / 60), mi = m % 60, h12 = ((h + 11) % 12) + 1; return h12 + ":" + String(mi).padStart(2, "0") + (h < 12 ? " AM" : " PM"); };

  /* ---------- the AI's structured output ---------- */
  const CAMP_SCHEMA = {
    type: "object", additionalProperties: false, required: ["items", "assumptions", "notUnderstood"],
    properties: {
      items: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["title", "cat", "start", "dur", "all", "groups", "roles", "facilities", "staff", "note"],
        properties: {
          title: { type: "string" }, cat: { type: "string", enum: CAT_IDS },
          start: { type: "string", description: "24-hour HH:MM" }, dur: { type: "integer" },
          all: { type: "boolean" }, groups: { type: "array", items: { type: "string" } },
          roles: { type: "array", items: { type: "string", enum: ["pitcher", "catcher", "position"] } },
          facilities: { type: "array", items: { type: "string" } }, staff: { type: "array", items: { type: "string" } }, note: { type: "string" } } } },
      assumptions: { type: "array", items: { type: "string" } }, notUnderstood: { type: "array", items: { type: "string" } }
    }
  };
  /** check and normalise an AI answer (start "HH:MM" → minutes). Anything malformed is refused, never repaired. */
  function validate(out) {
    const errors = [];
    if (!out || typeof out !== "object" || !Array.isArray(out.items)) return { ok: false, errors: ["items missing"] };
    if (out.items.length > 80) errors.push("too many items");
    const items = out.items.map((it, i) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(str(it && it.start));
      const start = m ? +m[1] * 60 + +m[2] : null;
      if (start == null || start >= 1440) errors.push("item " + (i + 1) + ": bad start");
      const dur = Math.round(+(it && it.dur));
      if (!(dur >= 5 && dur <= 600)) errors.push("item " + (i + 1) + ": bad length");
      if (!str(it && it.title).trim()) errors.push("item " + (i + 1) + ": no title");
      const arr = (x) => (Array.isArray(x) ? x.map(str).filter(Boolean).slice(0, 20) : []);
      return { title: str(it.title).trim().slice(0, 60), cat: CAT_IDS.includes(it.cat) ? it.cat : "other", start, dur, all: !!it.all, groups: arr(it.groups),
        roles: arr(it.roles).filter((r) => ["pitcher", "catcher", "position"].includes(r)), facilities: arr(it.facilities), staff: arr(it.staff), note: str(it.note).slice(0, 200) };
    });
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: { items, assumptions: (out.assumptions || []).map(str).slice(0, 20), notUnderstood: (out.notUnderstood || []).map(str).slice(0, 20), source: "ai" } };
  }

  /* ---------- proposal → activities ---------- */
  /** resolves names to ids (unknown names are reported, never invented as new groups or facilities) */
  function toActivities(result, ctx, date) {
    ctx = ctx || {};
    const groups = ctx.groups || [], facilities = ctx.facilities || [], staff = ctx.staff || [], roles = ctx.roles || {};
    const byName = (list, n) => list.find((x) => x.name.toLowerCase() === str(n).toLowerCase());
    const unresolved = [];
    const acts = result.items.map((it) => {
      const gids = [], fids = [], sids = [], players = [];
      if (it.all) groups.forEach((g) => gids.push(g.id));
      it.groups.forEach((n) => { const g = byName(groups, n); if (g) gids.push(g.id); else unresolved.push("group “" + n + "”"); });
      it.facilities.forEach((n) => { const f = byName(facilities, n); if (f) fids.push(f.id); else unresolved.push("facility “" + n + "”"); });
      it.staff.forEach((n) => { const s = byName(staff, n); if (s) sids.push(s.id); else unresolved.push("staff “" + n + "”"); });
      (it.roles || []).forEach((r) => (roles[r] || []).forEach((p) => players.push(p)));
      if (it.all && !groups.length && roles.all) roles.all.forEach((p) => players.push(p));
      return { date, title: it.title, cat: it.cat, start: it.start, dur: it.dur, facilityId: fids[0] || null, groups: uniq(gids), players: uniq(players), staff: uniq(sids), notes: it.note || "" };
    });
    return { activities: acts, unresolved: uniq(unresolved) };
  }

  return { read, validate, toActivities, CAMP_SCHEMA, timeOf, findTimes, findGroups, findFacilities, sentences, fmt };
});
