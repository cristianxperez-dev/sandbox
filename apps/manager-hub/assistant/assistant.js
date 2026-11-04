/* ==========================================================================
   Manager Hub — Schedule Assistant (page layer)
   Describe → Review → Publish for the Daily Schedule, and Describe → Preview
   → Apply for the Monthly Planner. Reads and writes only through the app's
   own state (S, mutate, Library, Resources, Roster, Month, Games, templates),
   so the Player sheet, Leadership view, print/PDF and JSON export see the
   same data. Nothing is saved until the coach publishes.
   ========================================================================== */
(function () {
  "use strict";
  const A = window.MHAssist;
  if (!A) return;
  const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (s) => esc(s);
  const KEY_CFG = "cs.assistant", KEY_INTRO = "cs.assistant.introSeen", KEY_BRIEFS = "cs.assistant.briefs";

  /* ------------------------------------------------------------ settings */
  const cfg = () => { try { return JSON.parse(store.get(KEY_CFG) || "{}") || {}; } catch (e) { return {}; } };
  const setCfg = (c) => store.set(KEY_CFG, JSON.stringify(c));
  /** Only a same-site or https URL the user typed in. No key ever lives in the page. */
  function endpoint() {
    const u = String(cfg().endpoint || window.MH_ASSIST_ENDPOINT || "").trim();
    if (!u) return "";
    if (/^https:\/\//i.test(u) || /^\.{0,2}\//.test(u)) return u;
    return "";
  }
  const aiStatus = { state: endpoint() ? "unknown" : "off", msg: "" };

  /* ------------------------------------------------------------- context */
  const titleCase = (t) => (typeof ScheduleAI !== "undefined" ? ScheduleAI.titleCase(t) : A.cap(t));
  function findCoachLoose(t) {
    const s = String(t || "").trim(); if (!s) return null;
    const c = Resources.findCoach(s); if (c) return c;
    const low = s.toLowerCase();
    return (Resources.allCoaches ? Resources.allCoaches() : []).find((x) => String(x.first || "").toLowerCase() === low) || null;
  }
  function engineCtx() {
    const kindOf = (l) => { try { return Resources.kindOf(l); } catch (e) { return "none"; } };
    return {
      durationOf: (a) => { const l = Library.match(String(a || "").replace(/:$/, "").trim()); return l ? +l.dur || null : null; },
      keyOf: (t) => (typeof SchedulePlanner !== "undefined" ? SchedulePlanner.keyOf(t) : null),
      isLocation: (t) => !!Resources.findLocation(String(t).replace(/^the\s+/i, "")),
      canonLocation: (t) => { const s = String(t).replace(/^the\s+/i, "").trim(); const l = Resources.findLocation(s); if (l) return l.name;
        const near = Resources.locationNames().find((n) => n.toLowerCase().replace(/s$/, "") === s.toLowerCase().replace(/s$/, ""));
        return near || titleCase(s); },
      isStaff: (t) => !!findCoachLoose(t),
      staffLabel: (t) => { const c = findCoachLoose(t); return c ? c.initials || t : t; },
      canonActivity: (t) => { const l = Library.match(t); return l ? l.label : titleCase(t); },
      kindOf,
      capacityOf: (l) => (["field", "cage", "mound"].includes(kindOf(l)) ? 1 : Infinity),
      indoorFor: (ev, all) => indoorFor(ev, kindOf, all)
    };
  }
  /** a place under a roof for a block that was outside — from the Resources list, never invented */
  function indoorFor(ev, kindOf, all) {
    const names = Resources.locationNames();
    const indoor = names.filter((n) => /indoor|inside|tunnel|cage|gym|weight|clubhouse|10-?pack/i.test(n) && !/outdoor|field|turf\b(?! *indoor)/i.test(n.replace(/indoor (field|turf)/i, "indoor")));
    const act = ev.activity.toLowerCase();
    const prefer = /bp|hit|tee|machine|flip|cage/.test(act) ? /cage|tunnel/i
      : /lift|condition|run|speed|stretch|plyo|band/.test(act) ? /indoor turf|gym|weight|indoor/i
      : /bullpen|pen|side|mound/.test(act) ? /indoor mound|10-?pack|indoor/i
      : /defen|pfp|infield|bunt|first|cut|relay|baserun/.test(act) ? /indoor turf|indoor field|indoor/i : /indoor|gym/i;
    // prefer a space that is free at that time; a shared gym or weight room can hold several groups
    const busy = (n) => (all || []).some((o) => o !== ev && o.id !== ev.id && o.start != null && A.norm(o.location) === A.norm(n) && o.start < ev.end && ev.start < o.end && A.norm(o.activity) !== A.norm(ev.activity));
    const limited = (n) => ["field", "cage", "mound"].includes(kindOf(n));
    const fits = indoor.filter((n) => prefer.test(n));
    return fits.find((n) => !limited(n) || !busy(n)) || fits[0] || null;
  }
  function validationCtx(extra = {}) {
    const c = engineCtx(), m = (S && S.meta) || {};
    const fpTxt = extra.firstPitchTxt || m.firstPitch || "";
    let fp = extra.firstPitch != null ? extra.firstPitch : (fpTxt ? A.parseClock(String(fpTxt).replace(/^(\d{1,2}:\d{2}).*$/, "$1")) : null);
    if (fp != null && /^\d{1,2}:\d{2}$/.test(String(fpTxt)) && +String(fpTxt).split(":")[0] >= 13) fp = A.parseClock(fpTxt);
    const keysOf = (a) => { const k = c.keyOf(a), l = Library.match(a); return [k, l && l.id].filter(Boolean); };
    return { keysOf, precedence: extra.precedence || [], kindOf: c.kindOf, capacityOf: c.capacityOf, firstPitch: fp, homeAway: m.homeAway || "home", gameLocation: m.gameLocation || "", deadline: extra.deadline ?? null, dayStart: extra.dayStart ?? null };
  }
  const currentEvents = () => A.fromSections((S && S.sections) || [], engineCtx());

  /* ----------------------------------------------------------- AI client */
  function contextSummary(events) {
    return {
      date: S && S.meta && S.meta.date, affiliate: store.affiliateMeta ? (store.affiliateMeta() || {}).name : "",
      groups: A.groupsOf(events).map((g) => ({ name: g.name, type: g.gtype })),
      activities: Library.activities().map((a) => ({ label: a.label, minutes: a.dur, who: a.who })),
      locations: Resources.locationNames(), staff: (Resources.allCoaches ? Resources.allCoaches() : []).map((c) => c.initials).filter(Boolean),
      draft: events.filter((e) => !e.blank && e.start != null).slice(0, 120).map((e) => ({ group: e.group, activity: e.activity, start: A.fmtAP(e.start), minutes: e.dur, location: e.location, staff: e.staff }))
    };
  }
  /** returns {ok, value} or {ok:false, reason} — the caller falls back to the built-in reader */
  async function interpret(text, mode, events) {
    const url = endpoint();
    if (!url) return { ok: false, reason: "off" };
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, text, context: contextSummary(events) }), signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) { aiStatus.state = "error"; aiStatus.msg = `AI service answered ${r.status}`; return { ok: false, reason: aiStatus.msg }; }
      const body = await r.json();
      const v = A.validateInterpretation(body && body.interpretation);
      if (!v.ok) { aiStatus.state = "error"; aiStatus.msg = "AI reply failed validation (" + v.errors.slice(0, 3).join(", ") + ")"; return { ok: false, reason: aiStatus.msg }; }
      aiStatus.state = "on"; aiStatus.msg = body.model ? `AI service · ${body.model}` : "AI service";
      return { ok: true, value: v.value };
    } catch (e) { aiStatus.state = "error"; aiStatus.msg = "AI service unreachable"; return { ok: false, reason: aiStatus.msg }; }
  }
  const statusChip = () => {
    if (aiStatus.state === "on") return `<span class="mha-chip on" title="Language is interpreted by the AI service; the schedule is still built and checked by the app">● ${h(aiStatus.msg)}</span>`;
    if (aiStatus.state === "error") return `<span class="mha-chip warn" title="${h(aiStatus.msg)}">● Built-in reader (AI service failed)</span>`;
    return `<span class="mha-chip" title="No AI service configured — the app's built-in rules read the request. Works offline.">● Built-in reader</span>`;
  };

  /* =====================================================================
     BUILD — request → draft events
     ===================================================================== */
  function paramsToBrief(p) {
    const L = [];
    if (p.dayType === "home") L.push("Home game.");
    if (p.dayType === "away") L.push("Road game.");
    if (p.dayType === "rain") L.push("Rain day — everything indoors.");
    if (p.report) L.push(`Report at ${p.report}.`);
    if (p.firstPitch) L.push(`First pitch at ${p.firstPitch}.`);
    if (p.offBy) L.push(`Off the field by ${p.offBy}.`);
    if (+p.pos) L.push(`${p.pos} position player groups.`);
    if (+p.pit) L.push(`${p.pit} pitcher groups.`);
    if (+p.fields) L.push(`${p.fields} fields.`);
    if (+p.cages) L.push(`${p.cages} cages.`);
    if (+p.mounds) L.push(`${p.mounds} mounds.`);
    (p.fixed || "").split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((s) => L.push(s));
    if (p.idle) L.push("Try to minimize idle time.");
    if (p.coachOne) L.push("No overlapping coaches.");
    if (p.pitFirst) L.push("Pitchers throw first.");
    return L.join("\n");
  }
  function planToEvents(plan) {
    const out = [];
    plan.perGroup.forEach((pg) => pg.blocks.forEach((b) => out.push(A.makeEvent({
      group: pg.group.name, sec: pg.group.id || null, gtype: pg.group.kind === "pitcher" ? "pitcher" : pg.group.kind === "position" ? "position" : "",
      activity: b.label, start: b.start, dur: b.dur, location: b.location, staff: b.staff || "", assumedDur: !!b.assumedDur,
      confidence: b.assumedDur ? 0.7 : 0.85, source: "assistant"
    }))));
    const team = (S.sections || []).find((s) => s.kind === "table" && /all players/i.test(s.name));
    plan.teamRows.forEach((t) => out.push(A.makeEvent({ group: team ? team.name : "All Players & Staff", sec: team ? team.id : null, gtype: "other",
      activity: t.label, start: t.start, dur: t.dur, location: t.location, flex: t.dur === 0 || t.fixed ? "anchor" : "flexible", confidence: 0.85 })));
    return out;
  }
  const POS_NAMES = ["Blue Position Players", "Orange Position Players", "Green Position Players", "Red Position Players", "Gray Position Players", "Navy Position Players"];
  function rotationGroups(rot, planEvents) {
    const secs = (S.sections || []).filter((s) => s.kind === "table" && !/all players|rehab|other activity/i.test(s.name));
    const kind = rot.kind || "position";
    let groups = [];
    if (rot.groupNames) groups = rot.groupNames.map((n) => { const hit = A.matchGroups(n, A.groupsOf(planEvents.concat(currentEvents())))[0]; return hit ? { name: hit.name, sec: hit.sec, gtype: hit.gtype } : { name: titleCase(n) + (kind === "pitcher" ? " Pitchers" : " Position Players"), gtype: kind }; });
    else {
      const want = rot.count || rot.stations.length;
      const fromPlan = A.uniq(planEvents.filter((e) => e.gtype === kind).map((e) => e.group));
      const have = A.uniq([...fromPlan, ...secs.filter((s) => (typeof gtypeOf === "function" ? gtypeOf(s) : s.gtype) === kind).map((s) => s.name)]);
      for (let i = 0; i < want; i++) {
        const name = have[i] || (kind === "pitcher" ? `Group ${i + 1} Pitchers` : POS_NAMES[i] || `Group ${i + 1} Position Players`);
        const sec = secs.find((s) => s.name === name);
        groups.push({ name, sec: sec ? sec.id : null, gtype: kind });
      }
    }
    return groups;
  }
  function stationsFor(rot) {
    const used = {};
    return rot.stations.map((st) => {
      const lib = Library.match(st) || Library.match(st.replace(/s$/, "")) || (typeof SchedulePlanner !== "undefined" && SchedulePlanner.keyOf(st) ? Library.match(SchedulePlanner.KB[SchedulePlanner.keyOf(st)].label) : null);
      const label = lib ? lib.label : /^cages?$/i.test(st) ? "Cage Hitting" : titleCase(st);
      const pool = lib ? lib.pool : /cage/i.test(st) ? "cage" : /pen|mound/i.test(st) ? "mound" : /lift|weight/i.test(st) ? "gym" : "field";
      const slots = Resources.slots(pool).names;
      const i = used[pool] = (used[pool] ?? -1) + 1;
      return { label, location: slots.length ? slots[i % slots.length] : "", pool };
    });
  }
  /**
   * The whole request → a draft. Returns
   * {events, base, issues, assumptions, notes, rotation, clarify, spec, keepOthers}
   */
  async function buildDraft(rawText, params, opts = {}) {
    const notes = [], assumptions = [], clarify = [];
    let text = A.normalizeSpeech(rawText || "");
    const brief = paramsToBrief(params || {});
    let ai = null;
    if (endpoint() && text.trim()) {
      const r = await interpret(text, "build", currentEvents());
      if (r.ok) { ai = r.value; if (ai.intent === "clarify" && ai.clarifications.length) return { clarifyOnly: ai.clarifications }; if (ai.brief) { notes.push("Interpreted by the AI service, then planned and checked by the app."); text = ai.brief; } assumptions.push(...ai.assumptions); clarify.push(...ai.clarifications); }
    }
    const ectx = engineCtx();
    // 1. "same as yesterday but…" / "use our normal Monday schedule but…"
    const ref = A.parseReference(text);
    if (ref) {
      const base = loadReference(ref);
      if (base && base.sections) {
        const baseEvents = A.fromSections(base.sections, ectx);
        let events = baseEvents.map((e) => Object.assign({}, e, { id: A.uid(), source: "template" }));
        // keep the structure's ids out of the way of the current day's ids
        const secMap = new Map();
        const sections = A.clone(base.sections).map((s) => { const id = A.uid("sec"); secMap.set(s.id, id); return Object.assign(s, { id, rows: [] }); });
        events.forEach((e) => { e.sec = secMap.get(e.sec) || null; });
        if (base.brief) {
          return buildDraft(base.brief + (ref.rest ? "\n" + ref.rest : ""), params, opts).then((d) => (d.notes.unshift(`Started from the “${base.label}” brief.`), d));
        }
        notes.push(`Started from ${base.label}.`);
        if (ref.rest) {
          const p = A.parseCommands(ref.rest, events, ectx);
          const r = A.applyOps(events, p.ops.filter((o) => o.op !== "undo"), ectx);
          events = r.events; notes.push(...p.notes, ...r.notes); clarify.push(...p.clarify);
          if (r.warnings.length) assumptions.push(...r.warnings);
        }
        return finish({ events, baseSections: sections, replaceAll: true, notes, assumptions, clarify });
      }
      if (ref.kind === "template" && !base) clarify.push(`I couldn't find a template called “${ref.name}”. Saved templates: ${templateList().map((t) => t.name).join(", ") || "none yet"}.`);
      else if (!base) clarify.push(ref.kind === "yesterday" ? "There's no saved schedule for the day before this date. Save yesterday's schedule first, or describe the day." : "No saved schedule matched that day.");
      if (!ref.rest) return finish({ events: [], baseSections: S.sections, notes, assumptions, clarify, empty: true });
      text = ref.rest;
    }
    // 2. rotations are built exactly; everything else goes to the existing planner
    const full = [brief, text].filter(Boolean).join("\n");
    const rot = A.parseRotation(full);
    const forPlanner = rot ? full.replace(rot.sentence, " ").replace(/\s{2,}/g, " ") : full;
    let plan = null, events = [];
    const early = [];
    let planText = spaceSentences(forPlanner);
    const rep0 = planText.match(/\b(?:report|arrive|arrival|we start|day starts?)\b[^.\n]{0,20}?\b(?:at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    const reportAt = rep0 ? A.parseClock(rep0[1]) : null;
    if (reportAt != null) planText = planText.split("\n").filter((line) => {
      const m = line.match(/^\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+(.{2,40}?)\s*[.!]?\s*$/i);
      const t = m ? A.parseClock(m[1]) : null;
      if (t != null && t < reportAt) { early.push({ start: t, activity: titleCase(m[2]) }); return false; }
      return true;
    }).join("\n");
    if (forPlanner.trim()) {
      plan = SchedulePlanner.plan(planText, { ignoreMonth: !!(params && params.ignoreMonth) });
      events = planToEvents(plan);
      // a sentence the planner read as an activity ("Blue Starts on Defense.") is dropped, and said so
      const odd = events.filter((e) => /\.$|\b(?:starts?|begins?|should|needs?|while|then)\b/i.test(e.activity) && !Library.match(e.activity));
      if (odd.length) {
        events = events.filter((e) => !odd.includes(e));
        // "Blue starts on defense" was already applied as a start preference; anything else is reported
        const said = odd.filter((e) => !/\b(?:starts?|begins?|opens?)\b/i.test(e.activity));
        if (said.length) notes.push(`Left out ${A.uniq(said.map((e) => "“" + e.activity + "”")).join(", ")} — read as an instruction, not an activity.`);
      }
      // fixed team rows before the report time stay on the team strip without pulling every group earlier
      early.forEach((f) => events.push(A.makeEvent({ group: teamName(), sec: teamSec(), gtype: "other", activity: f.activity, start: f.start, dur: ectx.durationOf(f.activity) || 20, flex: "fixed", confidence: 0.9 })));
      assumptions.push(...plan.assumptions);
      plan.conflicts.forEach((c) => notes.push(c));
      plan.warnings.forEach((w) => clarify.push(w));
    }
    if (rot) {
      const groups = rotationGroups(rot, events);
      const stations = stationsFor(rot);
      const mine = new Set(groups.map((g) => g.name));
      let start = rot.start;
      if (start == null) {
        const warm = events.filter((e) => mine.has(e.group) && /stretch|throw|warm|plyo|band/i.test(e.activity));
        start = warm.length ? Math.max(...warm.map((e) => e.end)) : plan && plan.spec.anchors.dayStart != null ? plan.spec.anchors.dayStart : 9 * 60;
        assumptions.push(`Rotation starts at ${A.fmtAP(start)}${warm.length ? ", after warm-ups" : ""} — no start time was given.`);
      }
      const dur = rot.dur || 20;
      if (!rot.dur) assumptions.push("Rotation blocks set to 20 minutes — no length was given.");
      const R = A.buildRotation({ groups, stations, start, dur, transition: rot.transition || 0 });
      // the planner may have scheduled the same stations loosely; the rotation replaces them
      const stationKeys = stations.map((s) => A.norm(s.label));
      events = events.filter((e) => !(mine.has(e.group) && (stationKeys.includes(A.norm(e.activity)) || stationKeys.some((k) => A.activityMatches(k, e, ectx)))));
      // other work for those groups that collides with the rotation moves after it
      events.filter((e) => mine.has(e.group) && e.start < R.end && e.end > start).forEach((e) => { A.setStart(e, R.end + (e.start - start > 0 ? 0 : 0)); notes.push(`${e.activity} (${e.group}) moved after the rotation.`); });
      const after = events.filter((e) => mine.has(e.group) && e.start >= R.end).sort((a, b) => a.start - b.start);
      let t = R.end; after.forEach((e) => { if (e.start < t) A.setStart(e, t); t = e.end; });
      events.push(...R.events);
      notes.push(`${groups.length} groups rotate through ${stations.length} stations, ${dur} min each${rot.transition ? ` with ${rot.transition}-min transitions` : ""} (${A.fmtAP(start)}–${A.fmtAP(R.end)}).`);
      if (R.byes) assumptions.push(`More groups than stations — each round one group has an open block.`);
    }
    return finish({ events, baseSections: S.sections, notes, assumptions, clarify, plan, rotation: rot, ai });

    function finish(d) {
      if (d.replaceAll && d.baseSections && !d.baseSections.some((s) => s.kind === "lineup")) {
        const lu = (S.sections || []).find((s) => s.kind === "lineup");
        if (lu) d.baseSections.splice(Math.min(1, d.baseSections.length), 0, A.clone(lu));   // today's lineup card stays
      }
      const touched = new Set(d.events.map((e) => e.sec || "name:" + A.norm(e.group)));
      const cur = A.fromSections(d.baseSections || [], ectx);
      // groups the request didn't mention stay as they are (shown, never silently dropped)
      const keep = d.replaceAll ? [] : cur.filter((e) => !touched.has(e.sec) && !touched.has("name:" + A.norm(e.group)));
      const spec = d.plan ? d.plan.spec : null;
      const vctx = validationCtx({ firstPitch: spec && spec.anchors.firstPitch != null ? spec.anchors.firstPitch : undefined, deadline: spec ? spec.anchors.deadline : null, dayStart: spec ? spec.anchors.dayStart : null, precedence: spec ? spec.rules.precedence : [] });
      if (params && params.splitRoster) populateRosters(d.events, params);
      return Object.assign(d, { kept: keep, vctx, base: d.baseSections, keepOthers: true });
    }
  }
  /** prose sentences on one line become separate paragraphs, so the planner never files one under the previous group's list */
  function spaceSentences(t) {
    return plannerFriendly(String(t)).split(/\n/).map((line) => (/^\s*(?:[-•*+]|\d+[.)])\s/.test(line) || /:\s*$/.test(line)) ? line : line
      // ", and bullpens should finish before BP" is its own rule
      .replace(/,?\s+(?:and|but)\s+(?=[a-z][a-z -]{1,26}?\s+(?:should|must|has to|have to|needs? to|cannot|can'?t)\b)/gi, ".\n\n")
      .replace(/([.!?])\s+(?=[A-Za-z])/g, "$1\n\n")).join("\n");
  }
  const teamSecObj = () => (S.sections || []).find((s) => s.kind === "table" && /all players/i.test(s.name));
  const teamName = () => (teamSecObj() || { name: "All Players & Staff" }).name;
  const teamSec = () => (teamSecObj() || {}).id || null;
  /** phrasings coaches use that the planner reads better in its own forms */
  function plannerFriendly(t) {
    const ANCHOR = /^(?:first pitch|game|report|arrive|arrival|bus|depart|departure|off the field|we|everyone|everybody|all|the team)\b/i;
    return t
      // "defense for 30 minutes" → "defense (30 min)"
      .replace(/\b([a-z][a-z &'-]{1,30}?)\s+for\s+(\d{1,3})\s*(?:min|mins|minutes)\b/gi, "$1 ($2 min)")
      // "two position player groups need X" → the count, then the work for all of them
      .replace(/\b(?:the\s+)?(\d|two|three|four|five|six)\s+(position player|position|hitting|hitter|pitcher|pitching)\s+groups?\s+(need|needs|get|gets|do|does|will need)\b/gi,
        (m, n, kind, v) => `${n} ${kind} groups.\n\n${/pitch/i.test(kind) ? "Pitchers" : "Position players"} need`)
      // "Team meeting at 7:45." / "Lunch at 12" → a fixed row "7:45 Team meeting"
      .split(/(?<=[.!?])\s+|\n/).map((s) => {
        const m = s.match(/^\s*([A-Za-z][A-Za-z &'\/-]{2,30}?)\s+(?:is\s+|will be\s+)?at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[.!]?\s*$/i);
        if (!m || ANCHOR.test(m[1]) || /\b(?:needs?|starts?|begins?|groups?|players|pitchers)\b/i.test(m[1])) return s;
        // the sheet's own rule (6–11 morning, 12–5 afternoon), stated so the planner can't read 7:45 as evening
        let tm = m[2].trim(); const hh = parseInt(tm, 10);
        if (!/[ap]m$/i.test(tm)) tm += hh >= 6 && hh <= 11 ? " am" : " pm";
        return `${tm} ${m[1]}`;
      }).join("\n");
  }
  function templateList() {
    const saved = (typeof ScheduleActions !== "undefined" ? ScheduleActions.list() : []).map((t) => ({ name: t.name, kind: "saved", sections: t.sections }));
    const built = Object.keys(typeof BUILTIN_TEMPLATES !== "undefined" ? BUILTIN_TEMPLATES : {}).map((n) => ({ name: n, kind: "builtin" }));
    const briefs = A.BRIEF_TEMPLATES.concat(savedBriefs()).map((b) => ({ name: b.name, kind: "brief", brief: b.text }));
    return [...saved, ...briefs, ...built];
  }
  function loadReference(ref) {
    const date = S && S.meta && S.meta.date;
    const idx = typeof index === "function" ? index() : [];
    if (ref.kind === "yesterday" && date) {
      const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() - 1);
      const iso = d.toISOString().slice(0, 10);
      const e = idx.find((x) => x.date === iso); const s = e && loadById(e.id);
      return s ? { sections: s.sections, label: `the saved schedule for ${longDate(iso)}` } : null;
    }
    if (ref.kind === "weekday" && ref.weekday) {
      const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(ref.weekday.toLowerCase());
      const e = idx.filter((x) => x.date && new Date(x.date + "T12:00:00").getDay() === dow && x.date !== date).sort((a, b) => b.date.localeCompare(a.date))[0];
      const s = e && loadById(e.id);
      return s ? { sections: s.sections, label: `the last ${ref.weekday} schedule (${longDate(e.date)})` } : null;
    }
    if (ref.kind === "last") { const e = idx.find((x) => x.id !== (S && S.id)); const s = e && loadById(e.id); return s ? { sections: s.sections, label: `the last saved schedule (${longDate(e.date)})` } : null; }
    if (ref.kind === "template") {
      const list = templateList();
      let t = A.matchTemplate(ref.name, list);
      if (!t && /(mon|tue|wed|thu|fri|sat|sun)/i.test(ref.name)) {   // "our normal Monday" with no template by that name → last saved Monday
        return loadReference({ kind: "weekday", weekday: (ref.name.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) || [])[1] });
      }
      if (!t) return null;
      if (t.kind === "brief") return { brief: t.brief, label: t.name };
      if (t.kind === "builtin") return { sections: BUILTIN_TEMPLATES[t.name](), label: `the ${t.name} template` };
      return { sections: t.sections, label: `your “${t.name}” template` };
    }
    return null;
  }
  function populateRosters(events, params) {
    if (!(Roster.loaded && Roster.loaded())) return;
    const groups = A.uniq(events.filter((e) => e.gtype === "position").map((e) => e.group));
    if (!groups.length) return;
    const players = Roster.positionPlayers().map((p) => ({ name: Roster.short(p), pos: p.position || "" }));
    const split = A.splitRoster(players, groups.length, params.splitBy || "balanced");
    draft.rosters = {}; groups.forEach((g, i) => { draft.rosters[g] = split[i].map((p) => p.name); });
  }

  /* =====================================================================
     DRAFT STATE — one per assistant session
     ===================================================================== */
  let draft = null;     // {events, kept, base, history:[events], log:[], issues, notes, assumptions, vctx, text, params, rosters}
  function newDraft(d, text, params) {
    draft = { events: d.events, kept: d.kept || [], keepOthers: true, base: d.base || S.sections, history: [], log: [], vctx: d.vctx || validationCtx(),
      notes: d.notes || [], assumptions: A.uniq(d.assumptions || []), clarify: A.uniq(d.clarify || []), text, params, rosters: draft && draft.rosters ? draft.rosters : null, replaceAll: false, sel: null };
    return draft;
  }
  const allDraftEvents = () => (draft.keepOthers ? draft.kept : []).concat(draft.events);
  /** issues that involve the draft; problems that only concern untouched groups were there before and are counted, not listed */
  function issues() {
    const mine = new Set(draft.events.map((e) => e.id));
    const all = A.validate(allDraftEvents(), draft.vctx);
    const out = all.filter((i) => !i.ids.length || i.ids.some((id) => mine.has(id)));
    draft.preexisting = all.length - out.length;
    return out.filter((i) => i.code !== "before-start" || i.ids.some((id) => mine.has(id)));
  }
  function proposedSections() {
    const keepIds = new Set((draft.keepOthers ? draft.kept : []).map((e) => e.sec));
    const touched = new Set(draft.events.map((e) => e.sec).filter(Boolean));
    let base = A.clone(draft.base || []);
    // groups that are replaced lose their old rows; groups left out of a fresh day are dropped only when asked
    if (!draft.keepOthers) base = base.filter((s) => s.kind === "lineup" || touched.has(s.id) || /all players/i.test(s.name));
    const secs = A.toSections(allDraftEvents(), base, { showEnd: !!(draft.params && draft.params.showEnd) });
    if (draft.rosters) secs.forEach((s) => { if (draft.rosters[s.name]) s.roster = draft.rosters[s.name]; });
    return secs.filter((s) => s.kind === "lineup" || (s.rows && s.rows.length) || keepIds.has(s.id) || touched.has(s.id));
  }

  /* =====================================================================
     UI — the panel
     ===================================================================== */
  let panel = null, step = "describe", busy = false;
  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "mha"; panel.className = "mha"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Schedule Assistant");
    document.body.appendChild(panel);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape" && !q(".mha-pop", panel)) close(); });
    return panel;
  }
  function open(opts = {}) {
    ensurePanel();
    if (opts.text != null) draft = null;
    step = opts.step || (draft ? "review" : "describe");
    panel.hidden = false; document.body.classList.add("mha-open");
    render(opts);
  }
  function close() { if (!panel) return; stopMic(); panel.hidden = true; document.body.classList.remove("mha-open"); }

  const EXAMPLES = [
    "Report at 8:00. Two position player groups and two pitcher groups. Pitchers throw first, then bullpens and PFP. Blue starts on defense while Orange begins in the cages, then they switch. Everyone gets on-field BP after rotations. First pitch at 12:05, and bullpens should finish before BP begins.",
    "Four groups rotate through cages, defense, baserunning and bunt defense, 20 minutes each, starting at 9:00. Everyone stretches and throws first at 8:30. Team meeting at 8:15. Lunch at 11:45.",
    "Same as yesterday but move BP to 10:30 and cancel lift.",
    "Rain day. Report at 9 to the weight room. Position players need cage work and tee work, pitchers need throwing and recovery. Off the field by 11:30."
  ];
  function head() {
    const m = (S && S.meta) || {};
    const steps = [["describe", "Describe"], ["review", "Review"], ["publish", "Publish"]];
    return `<div class="mha-head">
      <div class="mha-title"><b>Schedule Assistant</b><span>${h(m.date ? longDate(m.date) : "No date set")}${store.affiliateMeta && store.affiliateMeta() ? " · " + h(store.affiliateMeta().name) : ""}</span></div>
      <ol class="mha-steps">${steps.map(([k, l], i) => `<li class="${k === step ? "on" : ""} ${draft || k === "describe" ? "" : "off"}"><button data-mstep="${k}" ${!draft && k !== "describe" ? "disabled" : ""}><i>${i + 1}</i>${l}</button></li>`).join("")}</ol>
      <div class="mha-hr">${statusChip()}<button class="mha-x" data-mclose aria-label="Close">×</button></div>
    </div>`;
  }
  function render(opts = {}) {
    if (step === "describe") renderDescribe(opts);
    else if (step === "review") renderReview();
    else renderPublish();
  }
  function bindCommon() {
    qa("[data-mclose]", panel).forEach((b) => (b.onclick = close));
    qa("[data-mstep]", panel).forEach((b) => (b.onclick = () => { if (b.disabled) return; step = b.dataset.mstep; render(); }));
  }

  /* --------------------------------------------------------- 1. describe */
  function renderDescribe(opts) {
    const p = (draft && draft.params) || cfg().lastParams || {};
    const text = opts.text != null ? opts.text : draft ? draft.text : "";
    const tpls = templateList();
    panel.innerHTML = head() + `<div class="mha-body mha-describe">
      <div class="mha-main">
        <label class="mha-lbl" for="mhaText">Describe the day — type, paste, or dictate</label>
        <textarea id="mhaText" class="mha-ta" rows="8" spellcheck="true" placeholder="${h(EXAMPLES[0])}">${h(text)}</textarea>
        <div class="mha-bar">${micButton("mhaMic")}<span class="mha-hint" id="mhaMicHint"></span><span class="sp"></span><button class="btn sm quiet" data-mclear>Clear</button></div>
        <details class="mha-details" ${p.open ? "open" : ""}>
          <summary>Details <span>(optional — anything here overrides the text)</span></summary>
          <div class="mha-grid">
            <label>Day type<select data-p="dayType">${[["", "Practice"], ["home", "Home game"], ["away", "Away game"], ["camp", "Camp"], ["rain", "Rain-adjusted"]].map(([v, l]) => `<option value="${v}" ${p.dayType === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label>Report<input data-p="report" placeholder="8:00" value="${h(p.report || "")}"></label>
            <label>Off the field by<input data-p="offBy" placeholder="11:30" value="${h(p.offBy || "")}"></label>
            <label>First pitch<input data-p="firstPitch" placeholder="${h((S.meta && S.meta.firstPitch) || "12:05")}" value="${h(p.firstPitch || "")}"></label>
            <label>Position groups<input data-p="pos" type="number" min="0" max="6" placeholder="2" value="${h(p.pos || "")}"></label>
            <label>Pitcher groups<input data-p="pit" type="number" min="0" max="6" placeholder="2" value="${h(p.pit || "")}"></label>
            <label>Fields<input data-p="fields" type="number" min="0" max="9" placeholder="${Resources.count("field") === Infinity ? "" : Resources.count("field")}" value="${h(p.fields || "")}"></label>
            <label>Cages<input data-p="cages" type="number" min="0" max="9" placeholder="${Resources.count("cage") === Infinity ? "" : Resources.count("cage")}" value="${h(p.cages || "")}"></label>
            <label>Mounds<input data-p="mounds" type="number" min="0" max="9" placeholder="${Resources.count("mound") === Infinity ? "" : Resources.count("mound")}" value="${h(p.mounds || "")}"></label>
            <label class="wide">Fixed events — one per line<textarea data-p="fixed" rows="2" placeholder="8:15 Team Meeting&#10;11:45 Lunch">${h(p.fixed || "")}</textarea></label>
            <div class="wide mha-checks">
              <label><input type="checkbox" data-p="idle" ${p.idle ? "checked" : ""}> Minimize idle time</label>
              <label><input type="checkbox" data-p="coachOne" ${p.coachOne ? "checked" : ""}> One group per coach at a time</label>
              <label><input type="checkbox" data-p="pitFirst" ${p.pitFirst ? "checked" : ""}> Pitchers throw first</label>
              <label title="${Roster.loaded && Roster.loaded() ? "" : "Import a roster first (Roster)"}"><input type="checkbox" data-p="splitRoster" ${p.splitRoster ? "checked" : ""} ${Roster.loaded && Roster.loaded() ? "" : "disabled"}> Fill position groups from the roster</label>
              <label><input type="checkbox" data-p="ignoreMonth" ${p.ignoreMonth ? "checked" : ""}> Ignore the monthly plan</label>
              <label><input type="checkbox" data-p="showEnd" ${p.showEnd ? "checked" : ""}> Show end times on the sheet</label>
            </div>
          </div>
        </details>
        ${monthBanner()}
      </div>
      <aside class="mha-side">
        <div class="mha-card"><b>Start from</b>
          <div class="mha-chips">
            <button class="mha-pill" data-ins="Same as yesterday but ">Same as yesterday…</button>
            ${tpls.filter((t) => t.kind === "brief").map((t) => `<button class="mha-pill" data-brief="${h(t.name)}">${h(t.name)}</button>`).join("")}
            ${tpls.filter((t) => t.kind === "saved").map((t) => `<button class="mha-pill saved" data-ins="Use our ${h(t.name)} template but ">${h(t.name)}</button>`).join("")}
          </div>
          <p class="mha-note">Templates are briefs you can edit. Saved day templates and anything you publish can be reused — “use our <i>Game Day — Home</i> template but…”.</p>
        </div>
        <div class="mha-card"><b>Try</b>${EXAMPLES.map((x, i) => `<button class="mha-ex" data-ex="${i}">${h(x)}</button>`).join("")}</div>
      </aside>
    </div>
    <div class="mha-foot"><span class="mha-note">Nothing changes until you publish. ${draft ? "A draft is open — building again replaces it." : ""}</span><span class="sp"></span>
      ${draft ? `<button class="btn" data-mstep="review">Back to draft</button>` : ""}
      <button class="btn primary" id="mhaBuild">Build draft</button></div>`;
    bindCommon();
    const ta = q("#mhaText", panel);
    q("[data-mclear]", panel).onclick = () => { ta.value = ""; ta.focus(); };
    qa("[data-ex]", panel).forEach((b) => (b.onclick = () => { ta.value = EXAMPLES[+b.dataset.ex]; ta.focus(); }));
    qa("[data-ins]", panel).forEach((b) => (b.onclick = () => { ta.value = b.dataset.ins + ta.value.replace(/^(same as yesterday but|use our .+? template but)\s*/i, ""); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }));
    qa("[data-brief]", panel).forEach((b) => (b.onclick = () => { const t = templateList().find((x) => x.name === b.dataset.brief); if (t) { ta.value = t.brief; ta.focus(); } }));
    wireMic("mhaMic", (txt) => { ta.value = (ta.value ? ta.value.replace(/\s*$/, " ") : "") + txt; }, "#mhaMicHint");
    q("#mhaBuild", panel).onclick = () => doBuild();
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doBuild(); });
    setTimeout(() => ta.focus(), 30);
  }
  function readParams() {
    const p = {};
    qa("[data-p]", panel).forEach((el) => { p[el.dataset.p] = el.type === "checkbox" ? el.checked : el.value.trim(); });
    p.open = !!q(".mha-details", panel)?.open;
    return p;
  }
  function monthBanner() {
    const acts = S && S.meta && S.meta.date && typeof Month !== "undefined" ? Month.labels(S.meta.date) : [];
    if (!acts.length) return "";
    return `<div class="mha-month"><b>From the monthly plan</b> ${acts.map((a) => `<span class="mha-tag">${h(a)}</span>`).join("")}<span class="mha-note">Built in as required work unless you tick “Ignore the monthly plan”.</span></div>`;
  }
  async function doBuild() {
    if (busy) return;
    const text = q("#mhaText", panel).value;
    const params = readParams();
    if (!text.trim() && !paramsToBrief(params).trim()) { toast("Describe the day first — or pick a template"); return; }
    const c = cfg(); c.lastParams = params; setCfg(c);
    busy = true; const btn = q("#mhaBuild", panel); btn.disabled = true; btn.textContent = "Building…";
    stopMic();
    try {
      const d = await buildDraft(text, params);
      if (d.clarifyOnly) { busy = false; btn.disabled = false; btn.textContent = "Build draft"; return showClarify(d.clarifyOnly); }
      newDraft(d, text, params);
      if (!d.events.length) {
        draft.log.push({ who: "assistant", text: d.clarify.length ? d.clarify.join(" ") : "I couldn't find anything to schedule. Name the groups and what they need, or list a few times." });
      } else draft.log.push({ who: "assistant", text: summaryLine() });
      step = "review"; render();
    } catch (e) {
      console.error(e); toast("The assistant hit a problem building that — nothing was changed");
    } finally { busy = false; }
  }
  function showClarify(list) {
    const host = q(".mha-main", panel);
    const box = document.createElement("div"); box.className = "mha-clarify";
    box.innerHTML = `<b>Before I build this:</b>${list.map((x) => `<div>${h(x)}</div>`).join("")}<span class="mha-note">Add the answer to your description and build again.</span>`;
    host.prepend(box);
  }
  function summaryLine() {
    const ev = draft.events.filter((e) => e.start != null);
    if (!ev.length) return "Nothing scheduled yet.";
    const s = Math.min(...ev.map((e) => e.start)), e2 = Math.max(...ev.map((e) => e.end));
    const groups = A.uniq(ev.map((e) => e.group));
    const iss = issues(), w = iss.filter((i) => i.level !== "info").length;
    return `Drafted ${A.plural(ev.length, "block")} for ${A.plural(groups.length, "group")}, ${A.fmtAP(s)}–${A.fmtAP(e2)}. ${w ? A.plural(w, "thing") + " to check." : "No conflicts found."}`;
  }

  /* ------------------------------------------------------------ 2. review */
  function catColor(act) { const l = Library.match(String(act || "").replace(/:$/, "")); return l ? Library.color(l.id) : "#8A94A6"; }
  function renderReview() {
    const all = allDraftEvents().filter((e) => !e.blank);
    const iss = issues();
    const badIds = new Map(); iss.forEach((i) => i.ids.forEach((id) => { const cur = badIds.get(id); if (!cur || i.level === "error" || (i.level === "warning" && cur === "info")) badIds.set(id, i.level); }));
    const timed = all.filter((e) => e.start != null);
    const t0 = timed.length ? Math.floor(Math.min(...timed.map((e) => e.start)) / 60) * 60 : 8 * 60;
    const t1 = timed.length ? Math.ceil(Math.max(...timed.map((e) => e.end)) / 60) * 60 : 12 * 60;
    const PX = 1.5;
    const lanes = [];
    const seen = new Map();
    all.forEach((e) => { const k = e.sec || A.norm(e.group); if (!seen.has(k)) { seen.set(k, { key: k, name: e.group, events: [], kept: false }); lanes.push(seen.get(k)); } seen.get(k).events.push(e); });
    lanes.forEach((l) => { l.kept = l.events.every((e) => draft.kept.includes(e)); });
    lanes.sort((a, b) => (A.TEAM_RE.test(b.name) ? 1 : 0) - (A.TEAM_RE.test(a.name) ? 1 : 0) || (a.kept ? 1 : 0) - (b.kept ? 1 : 0));
    const hours = []; for (let t = t0; t <= t1; t += 30) hours.push(t);
    const d = A.diff(currentEvents(), A.fromSections(proposedSections(), engineCtx()));
    const counts = { error: iss.filter((i) => i.level === "error").length, warning: iss.filter((i) => i.level === "warning").length, info: iss.filter((i) => i.level === "info").length };
    const laneHTML = (l) => {
      // side-by-side columns inside a lane when blocks overlap (split groups, sub-groups)
      const evs = l.events.filter((e) => e.start != null).sort((a, b) => a.start - b.start);
      const cols = []; evs.forEach((e) => { let c = cols.findIndex((end) => end <= e.start); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = e.end; e._col = c; });
      const n = Math.max(1, cols.length);
      const untimed = l.events.filter((e) => e.start == null && e.activity);
      return `<div class="mha-lane ${l.kept ? "kept" : ""}" style="--n:${n}">
        <div class="mha-lh" title="${h(l.name)}">${h(l.name)}${l.kept ? `<span>unchanged</span>` : ""}</div>
        <div class="mha-lb" style="height:${(t1 - t0) * PX}px">
          ${hours.map((t) => `<i class="mha-gl${t % 60 ? " half" : ""}" style="top:${(t - t0) * PX}px"></i>`).join("")}
          ${evs.map((e) => {
            const top = (e.start - t0) * PX, ht = Math.max(18, (e.dur || 0) * PX - 2), lvl = badIds.get(e.id) || "";
            return `<button class="mha-blk ${lvl ? "is-" + lvl : ""} ${draft.sel === e.id ? "sel" : ""} ${e.dur === 0 ? "pin" : ""}" data-ev="${h(e.id)}" style="top:${top}px;height:${ht}px;left:calc(${e._col} * 100% / var(--n));width:calc(100% / var(--n) - 3px);--c:${h(catColor(e.activity))}"
              title="${h(`${A.fmtAP(e.start)}–${A.fmtAP(e.end)} ${e.activity}${e.detail ? " — " + e.detail : ""}${e.location ? " @ " + e.location : ""}${e.staff ? " · " + e.staff : ""}`)}">
              <b>${h(A.fmt(e.start))} ${h(e.activity)}</b>${ht > 30 ? `<span>${h([e.location, e.staff].filter(Boolean).join(" · "))}${e.dur ? ` · ${e.dur}m` : ""}</span>` : ""}
              ${e.confidence != null && e.confidence < 0.6 ? `<em title="The request didn't say clearly — check this">?</em>` : ""}</button>`;
          }).join("")}
        </div>
        ${untimed.length ? `<div class="mha-untimed">${untimed.map((e) => `<span>${h(e.timeText || "—")} ${h(e.activity)}</span>`).join("")}</div>` : ""}
      </div>`;
    };
    panel.innerHTML = head() + `<div class="mha-body mha-review">
      <div class="mha-tl">
        <div class="mha-tlbar"><b>${h(summaryLine())}</b><span class="sp"></span>
          <label class="mha-toggle"><input type="checkbox" id="mhaKeep" ${draft.keepOthers ? "checked" : ""}> Keep groups the request didn't mention</label></div>
        <div class="mha-lanes-wrap"><div class="mha-axis" style="height:${(t1 - t0) * PX}px">${hours.filter((t) => t % 60 === 0).map((t) => `<span style="top:${(t - t0) * PX}px">${A.fmtAP(t)}</span>`).join("")}</div>
          <div class="mha-lanes">${lanes.map(laneHTML).join("") || `<div class="mha-empty">Nothing on the draft yet. Describe the day, or tell me what to add below.</div>`}</div></div>
        <div class="mha-chat">
          <div class="mha-log" id="mhaLog">${draft.log.map((m) => `<div class="mha-msg ${m.who}">${m.who === "you" ? `<b>You</b>` : `<b>Assistant</b>`}<div>${h(m.text)}</div>${m.lines && m.lines.length ? `<ul>${m.lines.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : ""}</div>`).join("")}</div>
          <div class="mha-ask">
            <input id="mhaAsk" placeholder="Adjust it — “move hitting back 15”, “swap Blue and Orange”, “rain, move everything indoors”" autocomplete="off">
            ${micButton("mhaAskMic", true)}
            <button class="btn primary sm" id="mhaSend">Apply</button>
            <button class="btn sm" id="mhaUndo" ${draft.history.length ? "" : "disabled"} title="Undo the last change to this draft">Undo</button>
          </div>
        </div>
      </div>
      <aside class="mha-side">
        ${selectedEditor()}
        <div class="mha-card"><b>Needs a look</b> <span class="mha-counts">${counts.error ? `<i class="e">${counts.error}</i>` : ""}${counts.warning ? `<i class="w">${counts.warning}</i>` : ""}${counts.info ? `<i class="n">${counts.info}</i>` : ""}</span>
          ${iss.length ? `<ul class="mha-issues">${iss.map((i) => `<li class="${i.level}"><button data-focus="${h(i.ids[0] || "")}">${h(i.msg)}</button></li>`).join("")}</ul>` : `<p class="mha-ok">No conflicts found — groups, places and coaches all line up.</p>`}
          ${draft.preexisting ? `<p class="mha-note">${A.plural(draft.preexisting, "older note")} in groups you didn't change aren't listed.</p>` : ""}<p class="mha-note">Overlaps that are normal baseball (Live BP, a shared lift, a split group) aren't counted as conflicts.</p></div>
        ${draft.clarify.length ? `<div class="mha-card"><b>Questions</b><ul class="mha-plain">${draft.clarify.map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : ""}
        ${draft.assumptions.length || draft.notes.length ? `<div class="mha-card"><b>What I assumed</b><ul class="mha-plain">${A.uniq([...draft.notes, ...draft.assumptions]).map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : ""}
        <div class="mha-card"><b>Changes vs. today's schedule</b> <span class="mha-note">${d.count ? A.plural(d.count, "change") : "none"}</span>
          ${d.count ? `<ul class="mha-diff">${A.summarize(d, 14).map((x) => `<li class="${x[0] === "+" ? "add" : x[0] === "−" ? "rem" : "chg"}">${h(x)}</li>`).join("")}</ul>` : ""}</div>
      </aside>
    </div>
    <div class="mha-foot"><button class="btn" data-mstep="describe">← Edit the description</button>
      <button class="btn quiet" id="mhaClassic" title="The original planner and transcriber">Classic builder</button><span class="sp"></span>
      <button class="btn primary" data-mstep="publish" ${draft.events.length ? "" : "disabled"}>Review &amp; publish →</button></div>`;
    bindCommon();
    q("#mhaKeep", panel).onchange = (e) => { draft.keepOthers = e.target.checked; renderReview(); };
    qa("[data-ev]", panel).forEach((b) => (b.onclick = () => { draft.sel = b.dataset.ev; renderReview(); }));
    qa("[data-focus]", panel).forEach((b) => (b.onclick = () => { if (b.dataset.focus) { draft.sel = b.dataset.focus; renderReview(); } }));
    const ask = q("#mhaAsk", panel);
    q("#mhaSend", panel).onclick = () => doAdjust(ask.value);
    ask.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdjust(ask.value); });
    q("#mhaUndo", panel).onclick = () => undoDraft();
    q("#mhaClassic", panel).onclick = () => { close(); aiBuilderModal(draft.text || "", "plan"); };
    wireMic("mhaAskMic", (txt) => { ask.value = (ask.value ? ask.value + " " : "") + txt.trim(); });
    bindEditor();
    const log = q("#mhaLog", panel); if (log) log.scrollTop = log.scrollHeight;
    const sel = draft.sel && q(`[data-ev="${CSS.escape(draft.sel)}"]`, panel); if (sel) sel.scrollIntoView({ block: "nearest" });
  }
  function selectedEditor() {
    const e = draft.sel && allDraftEvents().find((x) => x.id === draft.sel);
    if (!e) return `<div class="mha-card mha-tipcard"><b>Edit a block</b><p class="mha-note">Click any block on the timeline to change its time, length, place or coach — or just tell the assistant.</p></div>`;
    const kept = draft.kept.includes(e);
    return `<div class="mha-card mha-edit"><b>${h(e.group)}</b>${kept ? `<p class="mha-note">This group wasn't in your request. Editing it here includes it in the draft.</p>` : ""}
      <div class="mha-grid tight">
        <label class="wide">Activity<input data-ef="activity" value="${h(e.activity)}" list="mhaActs"></label>
        <label>Start<input data-ef="start" value="${e.start != null ? h(A.fmt(e.start)) : ""}"></label>
        <label>Minutes<input data-ef="dur" type="number" min="0" max="300" value="${e.dur ?? ""}"></label>
        <label class="wide">Place<input data-ef="location" value="${h(e.location)}" list="mhaLocs"></label>
        <label>Staff<input data-ef="staff" value="${h(e.staff)}"></label>
        <label>Detail<input data-ef="detail" value="${h(e.detail)}"></label>
      </div>
      <datalist id="mhaActs">${Library.activities().map((a) => `<option value="${h(a.label)}">`).join("")}</datalist>
      <datalist id="mhaLocs">${Resources.locationNames().map((n) => `<option value="${h(n)}">`).join("")}</datalist>
      <div class="mha-row"><button class="btn sm primary" id="mhaSave">Update block</button><button class="btn sm" id="mhaDup">Duplicate</button><span class="sp"></span><button class="btn sm danger" id="mhaDel">Remove</button></div></div>`;
  }
  function bindEditor() {
    const save = q("#mhaSave", panel); if (!save) return;
    const id = draft.sel;
    save.onclick = () => {
      const f = {}; qa("[data-ef]", panel).forEach((el) => (f[el.dataset.ef] = el.value.trim()));
      const st = A.parseClock(f.start);
      if (f.start && st == null) { toast("Start time not understood — use 9:30 or 2:15 PM"); return; }
      commit((evs) => { const e = evs.find((x) => x.id === id); if (!e) return; e.activity = f.activity; e.location = f.location; e.staff = f.staff; e.detail = f.detail;
        if (st != null) A.setStart(e, st); if (f.dur !== "") A.setDur(e, +f.dur); e.confidence = 1; e.source = e.source === "manual" ? "manual" : "assistant"; }, `Edited ${f.activity || "a block"} by hand.`);
    };
    q("#mhaDel", panel).onclick = () => commit((evs) => { const i = evs.findIndex((x) => x.id === id); if (i >= 0) evs.splice(i, 1); draft.sel = null; }, "Removed a block by hand.");
    q("#mhaDup", panel).onclick = () => commit((evs) => { const e = evs.find((x) => x.id === id); if (!e) return; const c = Object.assign(A.clone(e), { id: A.uid() }); if (c.start != null) A.setStart(c, e.end); evs.push(c); draft.sel = c.id; }, "Duplicated a block.");
  }
  /** move kept rows into the draft when they are edited, then apply fn to the draft's events */
  function commit(fn, msg) {
    draft.history.push({ events: A.clone(draft.events), kept: A.clone(draft.kept) });
    const all = allDraftEvents().map((e) => e);
    const ev = A.clone(all);
    fn(ev);
    const keptIds = new Set(draft.kept.map((e) => e.id));
    // anything the coach touched becomes part of the draft
    const changed = new Set(A.diff(all, ev).changed.map((c) => c.after.id).concat(A.diff(all, ev).added.map((e) => e.id)));
    const touchedSecs = new Set(ev.filter((e) => changed.has(e.id)).map((e) => e.sec));
    draft.events = ev.filter((e) => !keptIds.has(e.id) || touchedSecs.has(e.sec));
    draft.kept = ev.filter((e) => keptIds.has(e.id) && !touchedSecs.has(e.sec));
    if (msg) draft.log.push({ who: "assistant", text: msg });
    renderReview();
  }
  function undoDraft() {
    const last = draft.history.pop(); if (!last) return;
    draft.events = last.events; draft.kept = last.kept;
    draft.log.push({ who: "assistant", text: "Undid the last change." });
    renderReview();
  }
  async function doAdjust(text) {
    text = String(text || "").trim(); if (!text || busy) return;
    stopMic();
    draft.log.push({ who: "you", text });
    const ectx = engineCtx();
    let cmdText = text;
    if (endpoint()) {
      busy = true;
      const r = await interpret(text, "edit", allDraftEvents());
      busy = false;
      if (r.ok && r.value.intent === "edit" && r.value.edits.length) cmdText = A.editsToCommands(r.value.edits);
      else if (r.ok && r.value.clarifications.length) { draft.log.push({ who: "assistant", text: r.value.clarifications.join(" ") }); return renderReview(); }
    }
    const before = allDraftEvents();
    const p = A.parseCommands(cmdText, before, ectx);
    if (p.ops.some((o) => o.op === "undo")) { undoDraft(); return; }
    if (!p.ops.length) {
      // a longer instruction with no edit verbs reads as more of the brief: rebuild with it
      if (!p.clarify.length || (text.split(/\s+/).length > 9 && /\b(needs?|groups?|first pitch|report|rotate|bullpens?|stretch)\b/i.test(text))) {
        const d = await buildDraft(`${draft.text}\n${text}`, draft.params);
        draft.history.push({ events: A.clone(draft.events), kept: A.clone(draft.kept) });
        const hist = draft.history, log = draft.log;
        newDraft(d, `${draft.text}\n${text}`, draft.params); draft.history = hist; draft.log = log;
        draft.log.push({ who: "assistant", text: "Rebuilt the draft with that added to the description. " + summaryLine() });
        return renderReview();
      }
      draft.log.push({ who: "assistant", text: p.clarify.join(" ") });
      return renderReview();
    }
    draft.history.push({ events: A.clone(draft.events), kept: A.clone(draft.kept) });
    const r = A.applyOps(before, p.ops, ectx);
    const d = A.diff(before, r.events);
    const touched = new Set([...d.changed.map((c) => c.after.sec), ...d.added.map((e) => e.sec)]);
    const keptIds = new Set(draft.kept.map((e) => e.id));
    draft.events = r.events.filter((e) => !keptIds.has(e.id) || touched.has(e.sec));
    draft.kept = r.events.filter((e) => keptIds.has(e.id) && !touched.has(e.sec));
    const lines = A.summarize(d, 10);
    draft.log.push({ who: "assistant", text: [...p.notes, ...r.notes, ...r.warnings, ...p.clarify].join(" ") || (d.count ? "Done." : "That didn't change anything."), lines });
    renderReview();
  }

  /* ----------------------------------------------------------- 3. publish */
  function renderPublish() {
    const secs = proposedSections();
    const d = A.diff(currentEvents(), A.fromSections(secs, engineCtx()));
    const iss = issues().filter((i) => i.level !== "info");
    panel.innerHTML = head() + `<div class="mha-body mha-pub">
      <div class="mha-main">
        <h3>Publish to the ${h(longDate(S.meta.date) || "current")} schedule</h3>
        <p>This writes the draft into the Daily Schedule. The Player sheet, the Leadership view, print/PDF and JSON export all read from there. You can undo it from the schedule.</p>
        <div class="mha-pubstats"><span><b>${d.added.length}</b> added</span><span><b>${d.changed.length}</b> changed</span><span><b>${d.removed.length}</b> removed</span><span><b>${secs.filter((s) => s.kind !== "lineup").length}</b> groups</span></div>
        ${d.removed.length ? `<div class="mha-warnbox"><b>${A.plural(d.removed.length, "row")} will be removed from today's schedule.</b> ${draft.keepOthers ? "" : "You turned off “Keep groups the request didn't mention”."}</div>` : ""}
        ${iss.length ? `<div class="mha-warnbox"><b>${A.plural(iss.length, "thing")} still to check:</b>${iss.slice(0, 5).map((i) => `<div>${h(i.msg)}</div>`).join("")}</div>` : `<p class="mha-ok">No conflicts found.</p>`}
        <ul class="mha-diff long">${A.summarize(d, 60).map((x) => `<li class="${x[0] === "+" ? "add" : x[0] === "−" ? "rem" : "chg"}">${h(x)}</li>`).join("")}</ul>
      </div>
      <aside class="mha-side"><div class="mha-card">
        <label class="mha-chk"><input type="checkbox" id="mhaTpl"> Also save as a day template</label>
        <input id="mhaTplName" placeholder="Template name — e.g. Normal Monday" disabled>
        <label class="mha-chk"><input type="checkbox" id="mhaTplStruct" disabled> Structure only (no times or activities)</label>
        <p class="mha-note">Reuse it later: “use our Normal Monday template but…”.</p></div>
        <div class="mha-card"><label class="mha-chk"><input type="checkbox" id="mhaThen" checked> Open the printable sheet afterwards</label></div>
      </aside>
    </div>
    <div class="mha-foot"><button class="btn" data-mstep="review">← Back to the draft</button><span class="sp"></span><button class="btn primary" id="mhaPublish">Publish schedule</button></div>`;
    bindCommon();
    const tpl = q("#mhaTpl", panel);
    tpl.onchange = () => { q("#mhaTplName", panel).disabled = !tpl.checked; q("#mhaTplStruct", panel).disabled = !tpl.checked; if (tpl.checked) q("#mhaTplName", panel).focus(); };
    q("#mhaPublish", panel).onclick = () => publish({ tpl: tpl.checked ? q("#mhaTplName", panel).value.trim() : "", structure: q("#mhaTplStruct", panel).checked, thenPrint: q("#mhaThen", panel).checked });
  }
  function publish(o) {
    const secs = proposedSections();
    if (o.tpl === "" && q("#mhaTpl", panel)?.checked) { toast("Name the template, or untick “save as a day template”"); return; }
    mutate(() => { S.sections = secs; });
    secs.forEach((s) => (s.rows || []).forEach((r) => { learn("activities", String(r.activity || "").replace(/:$/, "")); learn("locations", r.location); }));
    if (o.tpl) ScheduleActions.save(o.tpl, o.structure ? "structure" : "full");
    const n = draft.events.length;
    draft = null;
    close();
    go(o.thenPrint ? "print" : "schedule");
    toast(`Published ${A.plural(n, "block")}${o.tpl ? ` · saved “${o.tpl}”` : ""}`, { label: "Undo", fn: undo });
  }

  /* =====================================================================
     MONTHLY PLANNER — describe → preview → apply
     ===================================================================== */
  let monthDraft = null;
  function openMonth() {
    const y = typeof calY !== "undefined" && calY != null ? calY : new Date().getFullYear();
    const mo = typeof calM !== "undefined" && calM != null ? calM : new Date().getMonth();
    const label = new Date(y, mo, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    openModal(`
      <div class="mhead"><div><h2>Describe the month</h2><p>Plan intent for ${h(label)} in plain language. This edits the <b>monthly plan</b> only — finalized daily schedules aren't touched.</p></div><button class="x" data-close>×</button></div>
      <div class="mbody">
        <textarea id="mhaMonthText" class="mha-ta" rows="5" placeholder="Team defense 3 times a week. Bunt defense every Tuesday. PFP on Mondays and Thursdays. Avoid heavy defense before morning games.">${h(monthDraft ? monthDraft.text : "")}</textarea>
        <div class="mha-bar">${micButton("mhaMonthMic")}<span class="mha-hint" id="mhaMonthHint"></span><span class="sp"></span>
          ${["Team defense 3 times a week", "Bunt defense every Tuesday", "Avoid heavy defense before morning games", "Copy the first week to the rest of the month", "Rebalance"].map((x) => `<button class="mha-pill" data-mex="${h(x)}">${h(x)}</button>`).join("")}</div>
        <div id="mhaMonthOut"></div>
      </div>
      <div class="mfoot"><span class="mha-note" style="margin-right:auto">Activities come from your Activity Library; anything not in it is flagged, never invented.</span>
        <button class="btn" data-close>Cancel</button><button class="btn" id="mhaMonthPrev">Preview changes</button><button class="btn primary" id="mhaMonthApply" disabled>Apply to monthly plan</button></div>`,
    () => {
      q("#modal").classList.add("wide");
      const ta = q("#mhaMonthText");
      qa("[data-mex]").forEach((b) => (b.onclick = () => { ta.value = (ta.value.trim() ? ta.value.trim().replace(/[.]?$/, ". ") : "") + b.dataset.mex + "."; preview(); }));
      wireMic("mhaMonthMic", (txt) => { ta.value = (ta.value ? ta.value + " " : "") + txt.trim(); }, "#mhaMonthHint");
      q("#mhaMonthPrev").onclick = () => preview();
      q("#mhaMonthApply").onclick = () => applyMonth();
      async function preview() {
        let text = ta.value;
        if (endpoint()) { const r = await interpret(text, "month", currentEvents()); if (r.ok && r.value.monthRules.length) text = r.value.monthRules.join(". "); }
        const res = A.planMonth(text, monthCtx(y, mo));
        monthDraft = { text: ta.value, res, y, mo };
        const lib = (id) => Library.get(id) || { label: id };
        const fmtD = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        q("#mhaMonthOut").innerHTML =
          (res.clarify.length ? `<div class="mha-clarify">${res.clarify.map((x) => `<div>${h(x)}</div>`).join("")}</div>` : "") +
          (res.unknown.length ? `<div class="mha-warnbox"><b>Not in your Activity Library:</b> ${res.unknown.map((x) => "“" + h(x) + "”").join(", ")} — add ${res.unknown.length === 1 ? "it" : "them"} under Activity Library, or check the spelling.</div>` : "") +
          `<div class="mha-mstat"><b>${A.plural(res.changes.length, "day")}</b> would change.</div>` +
          (res.changes.length ? `<div class="mha-mlist">${res.changes.map((c) => `<div class="mha-mday"><b>${h(fmtD(c.iso))}</b>
            ${c.add.map((id) => `<span class="mha-tag add" style="--c:${h(Library.color(id))}">+ ${h(lib(id).label)}</span>`).join("")}
            ${c.remove.map((id) => `<span class="mha-tag rem">− ${h(lib(id).label)}</span>`).join("")}
            <span class="mha-note">${h(A.uniq(c.why.map((w) => w.replace(/^[+−] .+? \((.+)\)$/, "$1"))).slice(0, 3).join("; "))}</span></div>`).join("")}</div>` : "") +
          (res.flags.length ? `<div class="mha-card"><b>Volume and spacing flags</b><ul class="mha-plain">${res.flags.slice(0, 12).map((x) => `<li>${h(x)}</li>`).join("")}</ul></div>` : "") +
          (res.notes.length ? `<ul class="mha-plain">${res.notes.slice(0, 6).map((x) => `<li class="mha-note">${h(x)}</li>`).join("")}</ul>` : "");
        q("#mhaMonthApply").disabled = !res.changes.length;
      }
      if (monthDraft) preview();
      ta.focus();
    });
  }
  function monthCtx(y, mo) {
    const days = A.monthDays(y, mo);
    const plan = {}, games = {};
    days.forEach((iso) => { plan[iso] = { acts: Month.forDate(iso) }; const g = Games.forDate(iso); if (g) games[iso] = { time: g.time || "", homeAway: g.homeAway }; });
    // the day after the month ends matters for "before a morning game"
    const nx = new Date(y, mo + 1, 1), nIso = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}-01`;
    const ng = Games.forDate(nIso); if (ng) games[nIso] = { time: ng.time || "", homeAway: ng.homeAway };
    return { year: y, month: mo, plan, games, library: Library.activities(), today: S && S.meta && S.meta.date,
      findActivity: (p) => Library.match(p) || Library.match(p.replace(/s$/, "")) || Library.activities().find((a) => A.norm(a.label) === A.norm(p)) || null };
  }
  function applyMonth() {
    if (!monthDraft || !monthDraft.res.changes.length) return;
    const prev = monthDraft.res.changes.map((c) => ({ iso: c.iso, acts: Month.forDate(c.iso) }));
    monthDraft.res.changes.forEach((c) => Month.setDay(c.iso, c.acts));
    const n = monthDraft.res.changes.length;
    monthDraft = null;
    closeModal();
    if (typeof renderMonth === "function") renderMonth();
    toast(`Monthly plan updated on ${A.plural(n, "day")}`, { label: "Undo", fn: () => { prev.forEach((p) => Month.setDay(p.iso, p.acts)); if (typeof renderMonth === "function") renderMonth(); toast("Monthly plan restored"); } });
  }

  /* =====================================================================
     VOICE — Web Speech API when the browser has it, honest when it doesn't
     ===================================================================== */
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recBtn = null;
  function micButton(id, small) {
    if (!Speech) return `<button class="btn sm mha-mic" id="${id}" disabled title="Voice input isn't available in this browser. Chrome, Edge and Safari support it; you can also dictate with your keyboard's microphone and paste the transcript.">🎙${small ? "" : " Voice unavailable"}</button>`;
    return `<button class="btn sm mha-mic" id="${id}" title="Dictate — the transcript appears in the box so you can fix it before building">🎙${small ? "" : " Dictate"}</button>`;
  }
  function wireMic(id, onText, hintSel) {
    const b = document.getElementById(id); if (!b || !Speech) return;
    b.onclick = () => {
      if (rec) { stopMic(); return; }
      try {
        rec = new Speech(); rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = true;
        let finalTxt = "";
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) { onText(r[0].transcript.trim() + " "); finalTxt += r[0].transcript; } else interim += r[0].transcript; }
          const hint = hintSel && document.querySelector(hintSel); if (hint) hint.textContent = interim ? "… " + interim : "Listening — edit the text any time";
        };
        rec.onerror = (e) => { const hint = hintSel && document.querySelector(hintSel); if (hint) hint.textContent = e.error === "not-allowed" ? "Microphone permission was denied." : "Voice input stopped (" + e.error + ")."; stopMic(); };
        rec.onend = () => { rec = null; if (recBtn) { recBtn.classList.remove("rec"); recBtn.textContent = recBtn.id.includes("Ask") ? "🎙" : "🎙 Dictate"; } };
        rec.start(); recBtn = b; b.classList.add("rec"); b.textContent = "■ Stop";
        const hint = hintSel && document.querySelector(hintSel); if (hint) hint.textContent = "Listening — edit the text any time";
      } catch (e) { rec = null; toast("Voice input couldn't start in this browser"); }
    };
  }
  function stopMic() { try { rec && rec.stop(); } catch (e) {} rec = null; }

  /* =====================================================================
     HELP + FIRST USE
     ===================================================================== */
  function help() {
    const c = cfg();
    openModal(`
      <div class="mhead"><div><h2>How the Manager Hub works</h2><p>Quick reference. Everything stays in this browser, per affiliate.</p></div><button class="x" data-close>×</button></div>
      <div class="mbody mha-help">
        <section><h4>1 · Pick the affiliate and the date</h4><p>The chip in the header switches affiliate — each has its own rosters, schedules and plans. Set the date in the Daily Schedule.</p></section>
        <section><h4>2 · Describe the day</h4><p>Press <b>✦ Assistant</b> and write or dictate the day the way you'd say it: groups, what each needs, fixed times, first pitch, rotations, what has to finish before what. Review the draft on the timeline, then publish it.</p></section>
        <section><h4>3 · Adjust in plain language</h4><p>“move hitting back 15” · “swap Blue and Orange” · “make lift 30 minutes” · “move BP to the cage” · “add bunt defense at 11 for Blue” · “rain — move everything indoors” · “undo”. Every change shows what moved before you publish.</p></section>
        <section><h4>4 · Plan the month</h4><p>In <b>Monthly Planner</b>, press <b>✦ Describe the month</b>: “bunt defense every Tuesday”, “team defense 3 times a week”, “avoid heavy defense before morning games”. That's the plan; each day's schedule is still built and approved on its own.</p></section>
        <section><h4>5 · Templates</h4><p>Start from a template brief, or say “use our normal Monday template but…” / “same as yesterday but…”. Save any published day as a template.</p></section>
        <section><h4>6 · Print and share</h4><p><b>Generate schedule</b> opens the Player sheet and the Leadership view — print, PDF, PNG or WhatsApp. Both read the same schedule.</p></section>
        <section><h4>Manual tools are all still here</h4><p>Drag rows, edit cells, presets, recurring rows, duplication, home/away overrides, Lineup, Game Day Documents, Playing Matrix and the Pitching Grid work exactly as before.</p></section>
        <section><h4>Language interpreter</h4><p>${endpoint() ? `An AI service is configured (${h(endpoint())}). It only interprets wording; the app builds, checks and saves the schedule.` : "The built-in reader understands the phrasing above and works offline. An optional AI service can be connected through a server-side proxy; no API key is ever stored in this page."}</p>
          <details><summary>Advanced — AI service address</summary><div class="mha-row"><input id="mhaEndpoint" placeholder="https://… (your proxy, not an API key)" value="${h(c.endpoint || "")}"><button class="btn sm" id="mhaEndpointSave">Save</button></div><p class="mha-note">Leave empty to use the built-in reader.</p></details></section>
        <section><h4>Your data</h4><p>Saved automatically in this browser. Use <b>Open → Export</b> to keep a JSON copy or move it to another device.</p></section>
      </div>
      <div class="mfoot"><button class="btn" id="mhaHelpIntro">Show the welcome card again</button><span class="sp"></span><button class="btn primary" data-close>Got it</button></div>`,
    () => {
      q("#modal").classList.add("wide");
      q("#mhaEndpointSave").onclick = () => {
        const v = q("#mhaEndpoint").value.trim();
        if (v && !/^https:\/\//i.test(v) && !/^\.{0,2}\//.test(v)) { toast("Use an https:// address or a path on this site"); return; }
        if (/sk-ant|api[_-]?key|token=/i.test(v)) { toast("That looks like a key. Enter the proxy's address only — keys stay on the server"); return; }
        const cc = cfg(); cc.endpoint = v; setCfg(cc); aiStatus.state = v ? "unknown" : "off"; toast(v ? "AI service address saved" : "Using the built-in reader");
      };
      q("#mhaHelpIntro").onclick = () => { store.del(KEY_INTRO); closeModal(); go("hub"); };
    });
  }
  function hub() {
    const host = document.getElementById("viewHub"); if (!host) return;
    let card = document.getElementById("mhaIntro");
    if (store.get(KEY_INTRO)) { if (card) card.remove(); return; }
    if (!card) { card = document.createElement("div"); card.id = "mhaIntro"; card.className = "mha-intro"; host.querySelector(".hub-head").after(card); }
    card.innerHTML = `<div><b>Build a day by describing it</b>
        <ol><li>Open <b>✦ Assistant</b> and say what has to happen — groups, work, fixed times, first pitch.</li>
        <li>Review the timeline and conflicts; adjust in plain language (“push BP back 15”).</li>
        <li>Publish, then print the Player sheet or Leadership view.</li></ol></div>
      <div class="mha-intro-a"><button class="btn primary" id="mhaIntroGo">✦ Try the Assistant</button><button class="btn" id="mhaIntroHelp">How it works</button><button class="btn quiet" id="mhaIntroX">Got it</button></div>`;
    q("#mhaIntroGo", card).onclick = () => { store.set(KEY_INTRO, "1"); card.remove(); go("schedule"); open(); };
    q("#mhaIntroHelp", card).onclick = () => help();
    q("#mhaIntroX", card).onclick = () => { store.set(KEY_INTRO, "1"); card.remove(); };
  }
  function savedBriefs() { try { return JSON.parse(store.get(KEY_BRIEFS) || "[]") || []; } catch (e) { return []; } }

  function init() {
    const tools = document.querySelector("#paneCalendar .cal-tools");
    if (tools && !document.getElementById("calAssist")) {
      const b = document.createElement("button"); b.className = "btn sm primary"; b.id = "calAssist"; b.textContent = "✦ Describe the month";
      b.onclick = () => openMonth(); tools.prepend(b);
    }
    const lbl = document.querySelector("#btnAI .lbl"); if (lbl) lbl.textContent = " Assistant";
    const ai = document.getElementById("btnAI"); if (ai) ai.title = "Schedule Assistant — describe the day, review, publish";
    hub();
  }
  window.MHAssistUI = { open, close, openMonth, help, hub, buildDraft, engineCtx, validationCtx, currentEvents, proposedSections, publish: (o) => publish(o || {}), get draft() { return draft; }, adjust: (t) => doAdjust(t), interpret, paramsToBrief };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
