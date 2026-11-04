/* ==========================================================================
   Manager Hub — Schedule Assistant: conversational edits, monthly rules,
   templates and the interpretation contract shared with the optional AI proxy.
   Extends MHAssist (engine.js). Pure functions, no DOM.
   ========================================================================== */
(function (root, factory) {
  const base = typeof module === "object" && module.exports ? require("./engine.js") : root.MHAssist;
  const ext = factory(base);
  Object.assign(base, ext);
  if (typeof module === "object" && module.exports) module.exports = base;
})(typeof self !== "undefined" ? self : this, function (M) {
  "use strict";
  const { norm, stem, uniq, clone, fmtAP, parseClock, normalizeSpeech, makeEvent, setStart, setDur, TEAM_RE, plural, escRe } = M;

  /* ======================================================================
     TARGETS — which blocks a phrase means
     ====================================================================== */
  const ALL_RE = /^(?:everything|everybody|everyone|all|it all|the whole day|whole day|the day|the schedule|the whole schedule|all of it|the entire day)$/i;
  const GROUP_ALIAS = [
    [/^(?:the\s+)?pitchers?$|^(?:the\s+)?arms$|^pitching(?: groups?)?$/i, (g) => g.gtype === "pitcher" || /pitch/i.test(g.name)],
    [/^(?:the\s+)?(?:position players?|hitters?|position groups?|hitting groups?)$/i, (g) => g.gtype === "position" || /position/i.test(g.name)],
    [/^(?:the\s+)?(?:rehab|rehab group|rehab guys)$/i, (g) => /rehab/i.test(g.name)],
    [/^(?:the\s+)?(?:team|whole team|all players)$/i, (g) => TEAM_RE.test(g.name)]
  ];
  function groupsOf(events) {
    const m = new Map();
    events.forEach((e) => { const k = e.sec || norm(e.group); if (!m.has(k)) m.set(k, { key: k, sec: e.sec, name: e.group, gtype: e.gtype }); });
    return [...m.values()];
  }
  function matchGroups(phrase, groups) {
    const p = norm(phrase).replace(/\b(?:group|groups|guys|players|crew|squad)\b$/, "").trim();
    if (!p) return [];
    for (const [re, fn] of GROUP_ALIAS) if (re.test(phrase.trim())) { const hit = groups.filter(fn); if (hit.length) return hit; }
    const exact = groups.filter((g) => norm(g.name) === norm(phrase));
    if (exact.length) return exact;
    const words = p.split(" ").filter((w) => w.length > 1 && !/^(the|and|of|position|pitchers?|players?|group)$/.test(w));
    if (!words.length) return [];
    const hit = groups.filter((g) => { const n = norm(g.name); return words.every((w) => new RegExp("\\b" + escRe(w) + "\\b").test(n)); });
    if (hit.length) return hit;
    const numbered = p.match(/^g(?:roup)?\s*(\d)$/);
    if (numbered) return groups.filter((g) => new RegExp("group\\s*" + numbered[1] + "\\b", "i").test(g.name));
    return [];
  }
  function activityMatches(phrase, ev, ctx) {
    const a = stem(ev.activity.replace(/:$/, "")), p = stem(phrase);
    if (!a || !p) return false;
    if (a === p) return true;
    if (new RegExp("\\b" + escRe(p) + "\\b").test(a)) return true;
    if (p.length > 4 && new RegExp("\\b" + escRe(a) + "\\b").test(p)) return true;
    if (ctx && ctx.keyOf) { const k1 = ctx.keyOf(phrase), k2 = ctx.keyOf(ev.activity.replace(/:$/, "")); if (k1 && k1 === k2) return true; }
    return false;
  }
  /**
   * "Blue's hitting", "hitting for Orange", "the 10:00 block", "everything after lunch",
   * "infield defense", "all pitchers' bullpens" -> {ids, desc, ambiguous?}
   */
  function resolveTarget(phrase, events, ctx = {}) {
    let p = String(phrase || "").trim().replace(/^(?:the|a|an)\s+/i, "").replace(/[.,;!?]+$/, "").trim();
    const groups = groupsOf(events);
    const live = events.filter((e) => !e.blank);
    let pool = live, groupDesc = "", after = null, before = null;

    let m = p.match(/^(.*?)\s+(?:for|from|of)\s+(?:the\s+)?(.+)$/i);
    if (m && matchGroups(m[2], groups).length) { const gs = matchGroups(m[2], groups); pool = pool.filter((e) => gs.some((g) => g.key === (e.sec || norm(e.group)))); groupDesc = gs.map((g) => g.name).join(", "); p = m[1]; }
    else {
      // leading group: "Blue's hitting", "Orange defense", "pitchers' bullpens"
      for (let n = Math.min(4, p.split(/\s+/).length - 1); n >= 1; n--) {
        const head = p.split(/\s+/).slice(0, n).join(" ").replace(/'s$|s'$|'$/i, "");
        const gs = matchGroups(head, groups);
        if (gs.length) { pool = pool.filter((e) => gs.some((g) => g.key === (e.sec || norm(e.group)))); groupDesc = gs.map((g) => g.name).join(", "); p = p.split(/\s+/).slice(n).join(" "); break; }
      }
    }
    if ((m = p.match(/^(.*?)\s*\b(after|following|before|until)\s+(.+)$/i))) {
      const ref = m[3].trim(), clock = parseClock(ref);
      let at = clock;
      if (at == null) { const hit = live.filter((e) => e.start != null && activityMatches(ref, e, ctx)); if (hit.length) at = /after|following/i.test(m[2]) ? Math.min(...hit.map((e) => e.end)) : Math.min(...hit.map((e) => e.start)); }
      if (at != null) { if (/after|following/i.test(m[2])) after = at; else before = at; p = m[1].trim() || "everything"; }
    }
    if (!p || ALL_RE.test(p) || /^(?:everything|all)\s+(?:else|of it)$/i.test(p) || (groupDesc && /^(?:day|schedule|work|everything|all)?$/i.test(p))) {
      let ids = pool.filter((e) => e.start != null && (after == null || e.start >= after) && (before == null || e.start < before)).filter((e) => groupDesc || !(e.flex === "anchor" && /first pitch|game|bus/i.test(e.activity)));
      return { ids: ids.map((e) => e.id), desc: (groupDesc ? `everything for ${groupDesc}` : "the whole day") + (after != null ? ` after ${fmtAP(after)}` : "") + (before != null ? ` before ${fmtAP(before)}` : "") };
    }
    const clock = (m = p.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:block|slot|session|one|activity|rows?)?$/i)) ? parseClock(m[1]) : null;
    if (clock != null) { const ids = pool.filter((e) => e.start === clock).map((e) => e.id); return { ids, desc: `the ${fmtAP(clock)} block${groupDesc ? " for " + groupDesc : ""}` }; }
    let hits = pool.filter((e) => activityMatches(p, e, ctx) && (after == null || e.start >= after) && (before == null || e.start < before));
    // "infield defense": a role word inside the detail narrows the match
    if (!hits.length) {
      const words = p.split(/\s+/);
      if (words.length > 1) {
        const role = words[0], rest = words.slice(1).join(" ");
        const cand = pool.filter((e) => activityMatches(rest, e, ctx));
        hits = cand.filter((e) => new RegExp(escRe(role.replace(/s$/, "")), "i").test(e.detail + " " + e.group));
      }
    }
    return { ids: hits.map((e) => e.id), desc: `${p}${groupDesc ? " for " + groupDesc : ""}`, phrase: p };
  }

  /* ======================================================================
     PARSE — a sentence of edits into operations
     ====================================================================== */
  const VERB = "(?:move|push|bump|slide|shift|start|delay|put|make|extend|lengthen|shorten|cut|trim|add|insert|remove|cancel|drop|delete|scrap|skip|swap|switch|flip|change|rename|have|let|assign|give|send|take|change|use)";
  function clauses(text) {
    return normalizeSpeech(text)
      .split(new RegExp("\\n+|;|(?<=[.!?])\\s+|\\s+(?:and then|then|also|plus)\\s+|,\\s*(?=(?:and\\s+|then\\s+|also\\s+)?(?:please\\s+)?" + VERB + "\\b)", "i"))
      .flatMap((c) => c.split(new RegExp("\\s+and\\s+(?=" + VERB + "\\b)", "i")))
      .map((c) => c.replace(/^\s*(?:and|then|ok(?:ay)?|so|also|please|actually|now|can you|could you|let'?s|i want to|i'd like to|we need to|we should)\b[\s,]*/gi, "").replace(/\b(?:please|for me|instead)\b/gi, "").replace(/[.!?]+$/, "").trim())
      .filter((c) => c.length > 1);
  }
  const DUR = "(\\d{1,3})\\s*(?:min(?:ute)?s?|m)\\b";
  const DURO = "(\\d{1,3})(?:\\s*(?:min(?:ute)?s?|m)\\b)?";
  const CLOCK = "(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|noon)";
  const LATER = /^(?:back|later|down|behind)$/i, EARLIER = /^(?:up|earlier|sooner|ahead)$/i;

  function looksLikeLocation(t, ctx) {
    if (!t) return false;
    if (ctx.isLocation && ctx.isLocation(t)) return true;
    return /\b(field|cage|cages|mound|bullpen|pen|turf|gym|weight ?room|training ?room|clubhouse|indoors?|inside|tunnel|p-?wall|complex|stadium|conference|cafeteria|room|10-?pack)\b/i.test(t) && t.split(/\s+/).length <= 4;
  }
  function looksLikeStaff(t, ctx) { return !!(ctx.isStaff && ctx.isStaff(t)); }

  /**
   * returns {ops:[], clarify:[], notes:[], unparsed:[]}
   * ops: {op, ids, ...}. Targets are resolved here against the current events
   * so the AI path and the built-in path produce the same structures.
   */
  function parseCommands(text, events, ctx = {}) {
    const out = { ops: [], clarify: [], notes: [], unparsed: [] };
    const target = (ph) => resolveTarget(ph, events, ctx);
    const need = (t, ph) => { if (!t.ids.length) { out.clarify.push(`I couldn't find “${ph}” on this draft.${suggest(ph, events)}`); return false; } return true; };
    clauses(text).forEach((c) => {
      let m;
      if (/^(?:undo|undo that|go back|revert(?: that)?|take that back)$/i.test(c)) { out.ops.push({ op: "undo" }); return; }
      if (/\b(?:rain|raining|rained|weather|storm|storms|lightning|wet field|wet grounds)\b/i.test(c) || /\b(?:move|take|bring|go)\s+(?:everything|it all|all|us|the day|practice)\s+(?:indoors|inside)\b/i.test(c) || /^indoors?$/i.test(c)) {
        let scope = null;
        const t2 = c.match(/\bmove\s+(.+?)\s+(?:indoors|inside)\b/i);
        if (t2 && !/^(?:everything|it all|all|us|the day|practice)$/i.test(t2[1])) scope = target(t2[1]).ids;
        if (!out.ops.some((o) => o.op === "indoor")) out.ops.push({ op: "indoor", ids: scope }); return;
      }
      // swaps
      if ((m = c.match(/^(?:swap|switch|flip|trade)\s+(?:the\s+)?(.+?)\s+(?:and|with|for|&)\s+(?:the\s+)?(.+?)(?:\s+(?:for|in)\s+(.+))?$/i))) {
        const gs = groupsOf(events);
        const ga = matchGroups(m[1], gs), gb = matchGroups(m[2], gs);
        if (!m[3] && ga.length === 1 && gb.length === 1 && ga[0].key !== gb[0].key) { out.ops.push({ op: "swapGroups", a: ga[0].key, b: gb[0].key, desc: `${ga[0].name} ⇄ ${gb[0].name}` }); return; }
        const scope = m[3] ? ` for ${m[3]}` : "";
        const ta = target(m[1] + scope), tb = target(m[2] + scope);
        if (ta.ids.length && tb.ids.length) { out.ops.push({ op: "swapTimes", a: ta.ids, b: tb.ids, desc: `${ta.desc} ⇄ ${tb.desc}` }); return; }
        out.clarify.push(`Swap what, exactly? I read “${m[1]}” and “${m[2]}” but couldn't match ${!ta.ids.length ? "the first" : "the second"} to a group or an activity.`); return;
      }
      if ((m = c.match(/^(?:swap|switch|flip|trade)\s+(?:the\s+)?(.+?)\s+groups?$/i))) {
        const gs = groupsOf(events);
        const cand = gs.filter((g) => new RegExp("\\b" + escRe(stem(m[1]).split(" ")[0]), "i").test(norm(g.name)));
        const evCand = uniq(events.filter((e) => new RegExp(escRe(m[1].replace(/s$/, "")), "i").test(e.detail)).map((e) => e.id));
        if (cand.length === 2) { out.ops.push({ op: "swapGroups", a: cand[0].key, b: cand[1].key, desc: `${cand[0].name} ⇄ ${cand[1].name}` }); return; }
        // "swap the infield groups": two sub-groups named in the details of split rows
        const role = m[1].replace(/s$/, "");
        const rows = events.filter((e) => new RegExp("\\b" + escRe(role), "i").test(e.detail) && e.start != null);
        const pairs = rows.length >= 2 ? rows.slice(0, 2) : null;
        if (cand.length > 2) { out.clarify.push(`Which two? ${cand.map((g) => g.name).join(", ")} all match “${m[1]}”.`); return; }
        if (pairs && evCand.length >= 2) { out.ops.push({ op: "swapTimes", a: [pairs[0].id], b: [pairs[1].id], desc: `${m[1]} groups` }); return; }
        out.clarify.push(`I see ${cand.length || "no"} group${cand.length === 1 ? "" : "s"} matching “${m[1]}”. Name the two groups to swap — e.g. “swap Blue and Orange”.`); return;
      }
      // relative shifts: "move hitting back 15", "push BP 10 minutes later", "delay lift by 20", "start everything 30 minutes later"
      if ((m = c.match(new RegExp("^(?:move|push|bump|slide|shift|start|run|delay|have)\\s+(.+?)\\s+(back|later|up|earlier|sooner|forward|ahead|down)\\s+(?:by\\s+)?(\\d{1,3})(?:\\s*(?:min(?:ute)?s?|m))?$", "i"))) ||
          (m = c.match(new RegExp("^(?:move|push|bump|slide|shift|start|run|delay)\\s+(.+?)\\s+(?:by\\s+)?(\\d{1,3})\\s*(?:min(?:ute)?s?|m)?\\s+(back|later|up|earlier|sooner|forward|ahead)$", "i"))) ||
          (m = c.match(new RegExp("^(?!(?:move|push|bump|slide|shift|start|run|delay|make|add|remove|swap)\\b)(.+?)\\s+(\\d{1,3})\\s*(?:min(?:ute)?s?|m)\\s+(later|earlier|sooner)$", "i"))) ||
          (m = c.match(new RegExp("^(?!(?:move|push|bump|slide|shift|start|run|delay|make|add|remove|swap)\\b)(.+?)\\s+(back|later|up|earlier)\\s+(?:by\\s+)?(\\d{1,3})(?:\\s*(?:min(?:ute)?s?|m))?$", "i")))) {
        let what = m[1], dir = m[2], n = +m[3];
        if (/^\d+$/.test(dir)) { n = +m[2]; dir = m[3]; }
        if (/^(?:forward|ahead)$/i.test(dir)) { out.clarify.push(`“${dir}” can mean earlier or later. Say “${n} minutes earlier” or “${n} minutes later”.`); return; }
        const t = target(what); if (!need(t, what)) return;
        const delta = LATER.test(dir) ? n : -n;
        if (/^back$/i.test(dir)) out.notes.push(`Read “back ${n}” as ${n} minutes later.`);
        out.ops.push({ op: "shift", ids: t.ids, delta, ripple: delta > 0, desc: `${t.desc} ${delta > 0 ? "+" : "−"}${Math.abs(delta)} min` }); return;
      }
      if ((m = c.match(/^(?:delay|push(?:\s+back)?)\s+(.+?)\s+(?:by\s+)?(\d{1,3})\s*(?:min(?:ute)?s?|m)?$/i))) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        out.ops.push({ op: "shift", ids: t.ids, delta: +m[2], ripple: true, desc: `${t.desc} +${m[2]} min` }); return;
      }
      // durations
      if ((m = c.match(new RegExp("^(?:make|set|keep)\\s+(.+?)\\s+(?:to\\s+|only\\s+|just\\s+)?" + DUR + "(?:\\s+long)?$", "i")))) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        out.ops.push({ op: "setDur", ids: t.ids, dur: +m[2], desc: `${t.desc} → ${m[2]} min` }); return;
      }
      if ((m = c.match(new RegExp("^(?:extend|lengthen|add)\\s+(?:" + DUR + "\\s+(?:to|onto)\\s+)?(.+?)(?:\\s+by\\s+" + DURO + ")?$", "i"))) && (m[1] || m[3])) {
        const t = target(m[2]); if (!need(t, m[2])) return;
        const n = +(m[1] || m[3]);
        out.ops.push({ op: "extend", ids: t.ids, delta: n, ripple: true, desc: `${t.desc} +${n} min longer` }); return;
      }
      if ((m = c.match(new RegExp("^(?:shorten|cut|trim)\\s+(.+?)\\s+(by|to|down to)\\s+" + DURO + "$", "i")))) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        if (/by/i.test(m[2])) out.ops.push({ op: "extend", ids: t.ids, delta: -m[3], desc: `${t.desc} ${m[3]} min shorter` });
        else out.ops.push({ op: "setDur", ids: t.ids, dur: +m[3], desc: `${t.desc} → ${m[3]} min` });
        return;
      }
      // absolute times: "move BP to 10:30", "start lift at 9", "BP at 10:30"
      if ((m = c.match(new RegExp("^(?:move|put|start|have|schedule|make|run|bump|push|slide|shift)\\s+(.+?)\\s+(?:to|at|for|start at|begin at|starting at)\\s+" + CLOCK + "$", "i"))) ||
          (m = c.match(new RegExp("^(.+?)\\s+(?:at|starts? at|to)\\s+" + CLOCK + "(?:\\s+instead)?$", "i")))) {
        const at = parseClock(m[2]);
        if (at != null) {
          const t = target(m[1]); if (!need(t, m[1])) return;
          out.ops.push({ op: "setStart", ids: t.ids, start: at, ripple: true, desc: `${t.desc} → ${fmtAP(at)}` }); return;
        }
      }
      // staff: "have Casey run bullpens", "assign DK to lift", "give conditioning to MT"
      if ((m = c.match(/^(?:have|let)\s+(.+?)\s+(?:run|take|cover|handle|coach|lead|throw)\s+(.+)$/i)) && looksLikeStaff(m[1], ctx)) {
        const t = target(m[2]); if (!need(t, m[2])) return;
        out.ops.push({ op: "setStaff", ids: t.ids, staff: ctx.staffLabel ? ctx.staffLabel(m[1]) : m[1], desc: `${t.desc} → ${m[1]}` }); return;
      }
      if ((m = c.match(/^(?:assign|put|give)\s+(.+?)\s+(?:to|on)\s+(.+)$/i)) && (looksLikeStaff(m[1], ctx) || looksLikeStaff(m[2], ctx)) && !looksLikeLocation(m[2], ctx)) {
        const [who, what] = looksLikeStaff(m[1], ctx) ? [m[1], m[2]] : [m[2], m[1]];
        const t = target(what); if (!need(t, what)) return;
        out.ops.push({ op: "setStaff", ids: t.ids, staff: ctx.staffLabel ? ctx.staffLabel(who) : who, desc: `${t.desc} → ${who}` }); return;
      }
      // locations: "move BP to the cage", "put defense on Field 3", "send Orange to Field 2"
      if ((m = c.match(/^(?:move|put|send|take|switch|change)\s+(.+?)\s+(?:to|in|on|into|onto|over to)\s+(?:the\s+)?(.+)$/i)) && looksLikeLocation(m[2], ctx)) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        const loc = ctx.canonLocation ? ctx.canonLocation(m[2]) : M.cap(m[2]);
        out.ops.push({ op: "setLoc", ids: t.ids, location: loc, desc: `${t.desc} → ${loc}` }); return;
      }
      // removals
      if ((m = c.match(/^(?:remove|cancel|drop|delete|scrap|skip|cut|lose|get rid of|no)\s+(?:the\s+)?(.+?)(?:\s+(?:today|for today))?$/i))) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        out.ops.push({ op: "remove", ids: t.ids, desc: t.desc }); return;
      }
      // renames: "change BP to Live BP", "make defense bunt defense"
      if ((m = c.match(/^(?:change|rename|switch|turn|make)\s+(.+?)\s+(?:to|into)\s+(.+)$/i)) && parseClock(m[2]) == null && !looksLikeLocation(m[2], ctx)) {
        const t = target(m[1]); if (!need(t, m[1])) return;
        const label = ctx.canonActivity ? ctx.canonActivity(m[2]) : M.cap(m[2]);
        out.ops.push({ op: "rename", ids: t.ids, activity: label, desc: `${t.desc} → ${label}` }); return;
      }
      // additions: "add bunt defense at 10:30 for Blue on Field 1 (20 min)"
      if ((m = c.match(/^(?:add|insert|schedule|put in|throw in|include|fit in)\s+(?:an?\s+|some\s+)?(.+)$/i))) {
        const a = parseAddition(m[1], events, ctx);
        if (a.clarify) { out.clarify.push(a.clarify); return; }
        out.ops.push(Object.assign({ op: "add" }, a)); return;
      }
      out.unparsed.push(c);
    });
    if (out.unparsed.length && !out.ops.length && !out.clarify.length)
      out.clarify.push(`I didn't understand “${out.unparsed[0]}”. Try “move BP to 10:30”, “push hitting back 15”, “swap Blue and Orange”, “make lift 30 minutes”, “move everything indoors”, or “add bunt defense at 11 for Blue”.`);
    return out;
  }
  function suggest(ph, events) {
    const acts = uniq(events.filter((e) => e.activity && !e.blank).map((e) => e.activity.replace(/:$/, "")));
    const w = stem(ph).split(" ")[0] || "";
    const near = acts.filter((a) => w && stem(a).includes(w.slice(0, 3))).slice(0, 3);
    return near.length ? ` Did you mean ${near.map((x) => "“" + x + "”").join(" or ")}?` : acts.length ? ` On the draft: ${acts.slice(0, 6).join(", ")}.` : "";
  }
  function parseAddition(rest, events, ctx) {
    let s = " " + rest + " ", m;
    const out = { start: null, dur: null, group: null, sec: null, location: "", staff: "" };
    if ((m = s.match(new RegExp("\\(?\\b(?:for\\s+)?" + DUR + "\\)?", "i")))) { out.dur = +m[1]; s = s.replace(m[0], " "); }
    if ((m = s.match(new RegExp("\\b(?:at|from|starting at)\\s+" + CLOCK, "i")))) { out.start = parseClock(m[1]); s = s.replace(m[0], " "); }
    else if ((m = s.match(/\b(after|before)\s+([a-z][a-z ]{2,24}?)(?=\s+(?:for|on|in|with)\b|\s*$)/i))) {
      const ref = events.filter((e) => e.start != null && activityMatches(m[2], e, ctx));
      if (ref.length) out.start = /after/i.test(m[1]) ? Math.max(...ref.map((e) => e.end)) : Math.min(...ref.map((e) => e.start)) - (out.dur || 20);
      out.anchorWord = m[0].trim(); s = s.replace(m[0], " ");
    }
    if ((m = s.match(/\b(?:for|with)\s+(?:the\s+)?([a-z0-9 ]+?)(?=\s+(?:on|in|at|with)\b|\s*$)/i))) {
      const gs = matchGroups(m[1], groupsOf(events));
      if (gs.length) { out.group = gs[0].name; out.sec = gs[0].sec; out.gtype = gs[0].gtype; out.allGroups = gs; s = s.replace(m[0], " "); }
      else if (looksLikeStaff(m[1], ctx)) { out.staff = m[1].trim(); s = s.replace(m[0], " "); }
    }
    if ((m = s.match(/\b(?:on|in|at)\s+(?:the\s+)?([a-z0-9 &\/-]+?)\s*$/i)) && looksLikeLocation(m[1], ctx)) { out.location = ctx.canonLocation ? ctx.canonLocation(m[1]) : M.cap(m[1].trim()); s = s.replace(m[0], " "); }
    const act = s.replace(/\s+/g, " ").trim().replace(/^(?:a|an|some)\s+/i, "");
    if (!act) return { clarify: "Add what? Name the activity — e.g. “add bunt defense at 11 for Blue”." };
    out.activity = ctx.canonActivity ? ctx.canonActivity(act) : M.cap(act);
    if (out.dur == null) { const d = ctx.durationOf && ctx.durationOf(out.activity); out.dur = d || 20; out.assumedDur = !d; }
    if (out.start == null) return { clarify: `When should ${out.activity} happen? Add a time — e.g. “add ${act} at 10:30”.` };
    if (!out.group) { const gs = groupsOf(events); out.group = (gs.find((g) => TEAM_RE.test(g.name)) || { name: "All Players & Staff" }).name; out.sec = (gs.find((g) => g.name === out.group) || {}).sec || null; out.assumedGroup = true; }
    return out;
  }

  /* ======================================================================
     APPLY — deterministic, every change reported
     ====================================================================== */
  const INDOOR_ACT = [[/^(?:on[- ]field\s+)?bp$|^on[- ]field bp$|^batting practice$/i, "Cage BP"], [/^live bp$/i, "Live BP (Cage)"]];
  /**
   * ctx: indoorFor(event) -> location|null, kindOf(location)
   * returns {events, notes, warnings}
   */
  function applyOps(events, ops, ctx = {}) {
    let evs = clone(events);
    const notes = [], warnings = [];
    const byId = () => new Map(evs.map((e) => [e.id, e]));
    const ripple = (moved) => {
      // later blocks of the same group that now collide slide back, never past an anchor
      const groups = uniq(moved.map((e) => e.sec || e.group));
      groups.forEach((g) => {
        const list = evs.filter((e) => (e.sec || e.group) === g && e.start != null).sort((a, b) => a.start - b.start || (moved.includes(a) ? -1 : 1));
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1], cur = list[i];
          if (moved.includes(cur) || cur.start >= prev.end) continue;
          if (cur.flex === "fixed" || cur.flex === "anchor") { warnings.push(`${cur.activity} (${cur.group}) is fixed at ${fmtAP(cur.start)} and now overlaps ${prev.activity}.`); continue; }
          const d = prev.end - cur.start; setStart(cur, cur.start + d);
          notes.push(`${cur.activity} (${cur.group}) slid to ${fmtAP(cur.start)} to make room.`);
        }
      });
    };
    ops.forEach((op) => {
      const map = byId();
      const pick = (ids) => (ids || []).map((id) => map.get(id)).filter(Boolean);
      switch (op.op) {
        case "shift": {
          const list = pick(op.ids).filter((e) => e.start != null);
          list.forEach((e) => setStart(e, e.start + op.delta));
          notes.push(`Moved ${plural(list.length, "block")} ${op.delta > 0 ? "later" : "earlier"} by ${Math.abs(op.delta)} min.`);
          if (op.ripple !== false) ripple(list);
          break;
        }
        case "setStart": {
          const list = pick(op.ids).filter((e) => e.start != null || e.activity);
          if (list.length > 1) {
            const first = Math.min(...list.filter((e) => e.start != null).map((e) => e.start));
            const sameStart = list.every((e) => e.start === first);
            list.forEach((e) => setStart(e, sameStart || e.start == null ? op.start : op.start + (e.start - first)));
          } else list.forEach((e) => setStart(e, op.start));
          notes.push(`${plural(list.length, "block")} now start${list.length === 1 ? "s" : ""} at ${fmtAP(op.start)}.`);
          if (op.ripple !== false) ripple(list);
          break;
        }
        case "setDur": { const list = pick(op.ids); list.forEach((e) => setDur(e, op.dur)); notes.push(`${plural(list.length, "block")} set to ${op.dur} min.`); ripple(list); break; }
        case "extend": { const list = pick(op.ids); list.forEach((e) => setDur(e, (e.dur || 0) + op.delta)); notes.push(`${plural(list.length, "block")} ${op.delta > 0 ? "lengthened" : "shortened"} by ${Math.abs(op.delta)} min.`); if (op.delta > 0) ripple(list); break; }
        case "setLoc": { pick(op.ids).forEach((e) => { e.location = op.location; }); notes.push(`Moved to ${op.location}.`); break; }
        case "setStaff": { pick(op.ids).forEach((e) => { e.staff = op.staff; }); notes.push(`${op.staff} assigned.`); break; }
        case "rename": { pick(op.ids).forEach((e) => { e.activity = op.activity + (/:$/.test(e.activity) ? ":" : ""); }); notes.push(`Renamed to ${op.activity}.`); break; }
        case "remove": { const ids = new Set(op.ids || []); const n = evs.filter((e) => ids.has(e.id)).length; evs = evs.filter((e) => !ids.has(e.id)); notes.push(`Removed ${plural(n, "block")}.`); break; }
        case "add": {
          const targets = op.allGroups && op.allGroups.length > 1 ? op.allGroups : [{ name: op.group, sec: op.sec, gtype: op.gtype }];
          targets.forEach((g) => evs.push(makeEvent({ group: g.name, sec: g.sec, gtype: g.gtype, activity: op.activity, start: op.start, dur: op.dur, location: op.location, staff: op.staff, assumedDur: op.assumedDur, confidence: op.assumedGroup ? 0.55 : 0.85 })));
          notes.push(`Added ${op.activity} at ${fmtAP(op.start)} for ${targets.map((g) => g.name).join(", ")}${op.assumedGroup ? " (no group named — put on the team strip)" : ""}.`);
          break;
        }
        case "swapGroups": {
          const A = evs.filter((e) => (e.sec || norm(e.group)) === op.a), B = evs.filter((e) => (e.sec || norm(e.group)) === op.b);
          if (!A.length || !B.length) { warnings.push("One of those groups has nothing scheduled to swap."); break; }
          const ga = { sec: A[0].sec, group: A[0].group, gtype: A[0].gtype }, gb = { sec: B[0].sec, group: B[0].group, gtype: B[0].gtype };
          A.forEach((e) => Object.assign(e, gb)); B.forEach((e) => Object.assign(e, ga));
          notes.push(`${ga.group} and ${gb.group} traded schedules — same times and places, swapped groups.`);
          break;
        }
        case "swapTimes": {
          const A = pick(op.a).filter((e) => e.start != null), B = pick(op.b).filter((e) => e.start != null);
          if (!A.length || !B.length) { warnings.push("Nothing to swap."); break; }
          const sa = Math.min(...A.map((e) => e.start)), sb = Math.min(...B.map((e) => e.start));
          A.forEach((e) => setStart(e, sb + (e.start - sa))); B.forEach((e) => setStart(e, sa + (e.start - sb)));
          if (A.length === 1 && B.length === 1 && A[0].location && B[0].location && A[0].sec !== B[0].sec) { /* split-group swap keeps places with the activity */ }
          notes.push(`Swapped times: ${op.desc}.`);
          ripple([...A, ...B]);
          break;
        }
        case "indoor": {
          const scope = op.ids ? new Set(op.ids) : null;
          let moved = 0; const unresolved = [];
          evs.forEach((e) => {
            if (scope && !scope.has(e.id)) return;
            if (!e.location || e.start == null) return;
            const k = ctx.kindOf ? ctx.kindOf(e.location) : "";
            if (!["field", "mound", "turf"].includes(k) && !/field|turf|outfield|infield/i.test(e.location)) return;
            const to = ctx.indoorFor ? ctx.indoorFor(e, evs) : null;
            for (const [re, lbl] of INDOOR_ACT) if (re.test(e.activity.trim())) { e.activity = lbl; break; }
            if (to) { e.location = to; moved++; } else { unresolved.push(e); e.flags = uniq([...(e.flags || []), "needs-indoor-space"]); e.confidence = 0.4; }
          });
          notes.push(`Rain plan: ${plural(moved, "block")} moved indoors.`);
          if (unresolved.length) warnings.push(`No indoor space found for ${uniq(unresolved.map((e) => e.activity)).join(", ")} — pick a place or cut it.`);
          break;
        }
        default: break;
      }
    });
    return { events: evs, notes: uniq(notes), warnings: uniq(warnings) };
  }

  /* ======================================================================
     REFERENCES — "same as yesterday but…", "use our normal Monday schedule but…"
     ====================================================================== */
  function parseReference(text) {
    const t = normalizeSpeech(text);
    let m = t.match(/^\s*(?:let'?s\s+)?(?:do\s+|use\s+|run\s+|repeat\s+)?(?:the\s+)?same\s+(?:thing\s+|schedule\s+|day\s+)?as\s+(yesterday|last time|the last (?:day|schedule)|(?:last\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b[,.]?\s*(?:but|except|only|and|with)?\s*(.*)$/is);
    if (m) return { kind: /yesterday/i.test(m[1]) ? "yesterday" : /last/i.test(m[1]) && !/day$|schedule$/i.test(m[1]) && /(mon|tue|wed|thu|fri|sat|sun)/i.test(m[1]) ? "weekday" : /(mon|tue|wed|thu|fri|sat|sun)/i.test(m[1]) ? "weekday" : "last", weekday: (m[1].match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i) || [])[1] || null, rest: m[2].trim() };
    m = t.match(/^\s*(?:let'?s\s+)?(?:use|start (?:with|from)|run|go with|do|build (?:from|on)|based on)\s+(?:our|the|my)?\s*(?:normal|usual|standard|regular|typical)?\s*(.+?)\s+(?:schedule|template|day|plan|practice)\b[,.]?\s*(?:but|except|and|with|only)?\s*(.*)$/is);
    if (m) return { kind: "template", name: m[1].trim(), rest: m[2].trim() };
    return null;
  }
  function matchTemplate(name, list) {
    const n = norm(name); if (!n) return null;
    const scored = list.map((t) => {
      const tn = norm(t.name); let s = 0;
      if (tn === n) s = 100; else if (tn.includes(n)) s = 80; else if (n.includes(tn)) s = 70;
      else { const w = n.split(" ").filter((x) => x.length > 2); s = w.filter((x) => tn.includes(x)).length * 20; }
      return { t, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.length ? scored[0].t : null;
  }

  /* ======================================================================
     BRIEF TEMPLATES — editable starting points written as briefs, so they go
     through the same reader as anything typed. No people, no club data.
     ====================================================================== */
  const BRIEF_TEMPLATES = [
    { id: "std", name: "Standard practice", text: "Report at 8:00. Two position player groups and two pitcher groups. Everyone stretches first, then throwing. Position players need defense (30 min), cage hitting (20 min) and on-field BP (30 min). Pitchers need throwing, bullpens and PFP. Off the field by 11:30." },
    { id: "home", name: "Home game", text: "Home game, first pitch at 12:05. Two position player groups and two pitcher groups. Position players need stretch, throwing, defense and cage work. Pitchers need throwing and bullpens. Bullpens should finish before BP begins." },
    { id: "away", name: "Away game", text: "Road game. Bus leaves at 3:30. Report at 1:00. Two position player groups need cage work and defense. Pitchers need throwing and conditioning. Everyone needs a team meeting before departure." },
    { id: "camp", name: "Camp day", text: "Camp day. Report at 8:00. Everyone stretches and throws first. Four groups rotate through cages, defense, baserunning and bunt defense, 25 minutes each, starting at 8:45. Lunch at 12:00." },
    { id: "pheavy", name: "Pitcher-heavy day", text: "Report at 8:30. Three pitcher groups and one position player group. Two mounds. Pitchers need throwing, bullpens, PFP and conditioning. Position players need cage work and defense. Bullpens should finish before PFP begins." },
    { id: "rain", name: "Rain-adjusted day", text: "Rain day — everything indoors. Report at 9:00. Two position player groups need cage work and tee work. Pitchers need throwing and recovery. Everyone needs lift. No field work." }
  ];

  /* ======================================================================
     MONTHLY PLANNER — intent for many days at once
     ====================================================================== */
  const DOWS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const SPREAD = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dayOf = (iso) => new Date(iso + "T12:00:00");
  function monthDays(y, m) { const out = [], last = new Date(y, m + 1, 0).getDate(); for (let d = 1; d <= last; d++) out.push(isoOf(new Date(y, m, d))); return out; }
  function weeksOf(days) {
    const w = new Map();
    days.forEach((iso) => { const d = dayOf(iso); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = isoOf(mon); if (!w.has(k)) w.set(k, []); w.get(k).push(iso); });
    return [...w.values()];
  }
  function dowList(txt) {
    const t = txt.toLowerCase(); const out = [];
    if (/\bweekdays?\b/.test(t)) out.push(1, 2, 3, 4, 5);
    if (/\bweekends?\b/.test(t)) out.push(0, 6);
    DOWS.forEach((d, i) => { if (new RegExp("\\b" + d.slice(0, 3) + "(?:" + d.slice(3) + ")?s?\\b").test(t)) out.push(i); });
    return uniq(out);
  }
  /**
   * ctx: {year, month, plan:{iso:{acts:[ids]}}, games:{iso:{time:"h:mm", homeAway}}, library:[{id,label,cat,dur,pool,who}],
   *       findActivity(phrase) -> lib|null, isHeavy(lib) -> bool}
   * returns {changes:[{iso, add:[ids], remove:[ids], why:[]}], flags:[], clarify:[], unknown:[], notes:[]}
   */
  function planMonth(text, ctx) {
    const days = monthDays(ctx.year, ctx.month);
    const plan = {}; days.forEach((iso) => { plan[iso] = ((ctx.plan[iso] || {}).acts || []).slice(); });
    const before = clone(plan);
    const why = {}; const note = (iso, w) => { (why[iso] = why[iso] || []).push(w); };
    const out = { changes: [], flags: [], clarify: [], unknown: [], notes: [] };
    const gameOn = (iso) => (ctx.games || {})[iso] || null;
    const gameMin = (g) => (g && g.time ? parseClock(g.time) : null);
    const isMorningGame = (iso) => { const g = gameOn(iso); const t = gameMin(g); return !!g && t != null && t < 13 * 60; };
    const nextIso = (iso, n = 1) => { const d = dayOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
    const avoid = [];   // {test(iso, lib) -> reason|null}
    // heavy = long field work (team defense, rotations, stations); short fundamentals like bunt defense are not
    const heavy = ctx.isHeavy || ((l) => l && l.pool === "field" && (l.dur >= 25 || /rotation|stations/i.test(l.label)));
    const findAll = (phrase) => {
      const p = phrase.replace(/^(?:the|some|a|an)\s+/i, "").trim();
      if (/^heavy (?:defen[sc]e|work|field work|days?)$|^heavy$/i.test(p)) return { heavy: true, list: ctx.library.filter(heavy) };
      const lib = ctx.findActivity(p);
      return lib ? { list: [lib] } : { list: [] };
    };
    const S = normalizeSpeech(text).split(/\n+|;|(?<=[.!?])\s+|,\s+(?=[a-z]+\s+(?:every|on|\d+ times|daily))/i).map((s) => s.trim().replace(/[.!?]+$/, "")).filter(Boolean);
    const rules = [];
    S.forEach((s) => {
      let m;
      if ((m = s.match(/^(?:avoid|no|don'?t (?:do|schedule|have)|never)\s+(.+?)\s+(?:the day\s+)?before\s+(morning|day|early|noon|afternoon)\s+games?$/i))) {
        const f = findAll(m[1]); if (!f.list.length) { out.unknown.push(m[1]); return; }
        avoid.push({ ids: new Set(f.list.map((l) => l.id)), why: `no ${f.heavy ? "heavy field work" : f.list[0].label} the day before a morning game`, test: (iso) => isMorningGame(nextIso(iso)) });
        return;
      }
      if ((m = s.match(/^(?:avoid|no|don'?t (?:do|schedule|have)|never)\s+(.+?)\s+on\s+(game days?|off days?|non-?game days?|(?:[a-z]+days?(?:\s*(?:,|and|&)\s*)?)+)$/i))) {
        const f = findAll(m[1]); if (!f.list.length) { out.unknown.push(m[1]); return; }
        const gameDays = /game/i.test(m[2]) && !/non/i.test(m[2]), offDays = /off|non/i.test(m[2]);
        const dl = dowList(m[2]);
        avoid.push({ ids: new Set(f.list.map((l) => l.id)), why: `no ${f.list.length > 1 ? "heavy field work" : f.list[0].label} on ${m[2]}`, test: (iso) => gameDays ? !!gameOn(iso) : offDays ? !gameOn(iso) : dl.includes(dayOf(iso).getDay()) });
        return;
      }
      if ((m = s.match(/^(?:clear|nothing on|no activities on|off on|keep)\s+((?:[a-z]+days?(?:\s*(?:,|and|&)\s*)?)+)(?:\s+(?:clear|free|off|open))?$/i)) && dowList(m[1]).length) {
        const dl = dowList(m[1]); rules.push({ kind: "clear", dl, why: `${m[1]} cleared` }); return;
      }
      if ((m = s.match(/^(?:copy|repeat|duplicate)\s+(?:the\s+)?(first|second|third|fourth|this|1st|2nd|3rd|4th|week \d|week one|week two)\s*(?:week)?\s+(?:to|into|across|for|onto)\s+(?:the\s+)?(rest of the month|remaining weeks|every week|all weeks|next week|the rest)$/i))) {
        rules.push({ kind: "copyWeek", from: m[1], to: m[2] }); return;
      }
      if ((m = s.match(/^(?:rebalance|spread out|even out|balance)(?:\s+(.+?))?(?:\s+(?:evenly|across the month|across weeks))?$/i))) { rules.push({ kind: "rebalance", what: m[1] || "" }); return; }
      // "X 3 times a week", "X twice a week", "X daily", "X every other day"
      if ((m = s.match(/^(.+?)\s+(\d)\s*times?\s*(?:a|per|each)\s*week(?:\s+on\s+(.+))?$/i)) || (m = s.match(/^(\d)\s*times?\s*(?:a|per|each)\s*week[:,]?\s+(.+)$/i))) {
        let [what, n, on] = /^\d$/.test(m[1]) ? [m[2], +m[1], null] : [m[1], +m[2], m[3]];
        const f = findAll(what); if (!f.list.length) { out.unknown.push(what); return; }
        rules.push({ kind: "perWeek", libs: f.list, n: Math.min(7, n), on: on ? dowList(on) : null, why: `${f.list[0].label} ${n}×/week` }); return;
      }
      if ((m = s.match(/^(.+?)\s+(?:every day|daily|each day)$/i))) { const f = findAll(m[1]); if (!f.list.length) { out.unknown.push(m[1]); return; } rules.push({ kind: "perWeek", libs: f.list, n: 7, why: `${f.list[0].label} daily` }); return; }
      if ((m = s.match(/^(.+?)\s+every other day$/i))) { const f = findAll(m[1]); if (!f.list.length) { out.unknown.push(m[1]); return; } rules.push({ kind: "alternate", libs: f.list, why: `${f.list[0].label} every other day` }); return; }
      // "bunt defense every Tuesday", "PFP on Mondays and Thursdays", "Tuesdays: bunt defense"
      if ((m = s.match(/^(.+?)\s+(?:every|on|each)\s+((?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*s?|weekdays?|weekends?)(?:\s*(?:,|and|&|\/)\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*s?|weekdays?|weekends?))*)$/i)) ||
          (m = s.match(/^((?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*s?)(?:\s*(?:,|and|&)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*s?)*)\s*[:—-]\s*(.+)$/i))) {
        const [what, when] = dowList(m[1]).length && !dowList(m[2]).length ? [m[2], m[1]] : [m[1], m[2]];
        const items = what.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean);
        items.forEach((it) => { const f = findAll(it); if (!f.list.length) { out.unknown.push(it); return; } rules.push({ kind: "weekday", libs: f.list, dl: dowList(when), why: `${f.list[0].label} every ${when}` }); });
        return;
      }
      if ((m = s.match(/^(.+?)\s+on\s+(game days?|non-?game days?|off days?)$/i))) {
        const f = findAll(m[1]); if (!f.list.length) { out.unknown.push(m[1]); return; }
        rules.push({ kind: "gameDays", libs: f.list, game: !/non|off/i.test(m[2]), why: `${f.list[0].label} on ${m[2]}` }); return;
      }
      out.clarify.push(`I didn't catch “${s}”. Try “bunt defense every Tuesday”, “team defense 3 times a week”, “avoid heavy defense before morning games”, or “copy the first week to the rest of the month”.`);
    });

    const blocked = (iso, id) => avoid.find((a) => a.ids.has(id) && a.test(iso));
    const put = (iso, lib, w) => {
      const b = blocked(iso, lib.id);
      if (b) return false;
      if (!plan[iso].includes(lib.id)) { plan[iso].push(lib.id); note(iso, `+ ${lib.label} (${w})`); }
      return true;
    };
    rules.forEach((r) => {
      if (r.kind === "clear") days.forEach((iso) => { if (r.dl.includes(dayOf(iso).getDay()) && plan[iso].length) { note(iso, `cleared (${r.why})`); plan[iso] = []; } });
      if (r.kind === "weekday") r.libs.forEach((lib) => days.forEach((iso) => { if (r.dl.includes(dayOf(iso).getDay())) { if (!put(iso, lib, r.why)) out.flags.push(`${iso}: skipped ${lib.label} — ${blocked(iso, lib.id).why}.`); } }));
      if (r.kind === "gameDays") r.libs.forEach((lib) => days.forEach((iso) => { if (!!gameOn(iso) === r.game) put(iso, lib, r.why); }));
      if (r.kind === "alternate") r.libs.forEach((lib) => days.forEach((iso, i) => { if (i % 2 === 0) put(iso, lib, r.why); }));
      if (r.kind === "perWeek") r.libs.forEach((lib) => weeksOf(days).forEach((wk) => {
        const want = r.on && r.on.length ? r.on : SPREAD[r.n];
        const target = Math.max(0, Math.round(r.n * wk.length / 7) || (wk.length >= 3 ? 1 : 0));
        let have = wk.filter((iso) => plan[iso].includes(lib.id)).length;
        if (wk.length < 7 && target < r.n) out.notes.push(`Week of ${wk[0]} is partial (${wk.length} days): ${lib.label} planned ${target}× instead of ${r.n}×.`);
        const order = wk.slice().sort((a, b) => {
          const da = dayOf(a).getDay(), db = dayOf(b).getDay();
          const pa = want.includes(da) ? 0 : 1, pb = want.includes(db) ? 0 : 1;
          return pa - pb || plan[a].length - plan[b].length || ((da + 6) % 7) - ((db + 6) % 7);   // Monday first, Sunday last
        });
        // don't stack the same work on back-to-back days when there is room to spread it
        const chosen = wk.filter((iso) => plan[iso].includes(lib.id));
        for (const iso of order) {
          if (have >= target) break;
          if (plan[iso].includes(lib.id)) continue;
          const adj = chosen.some((c) => Math.abs(dayOf(c) - dayOf(iso)) <= 86400000);
          if (adj && order.filter((x) => !plan[x].includes(lib.id) && !chosen.some((c) => Math.abs(dayOf(c) - dayOf(x)) <= 86400000) && !blocked(x, lib.id)).length) continue;
          if (put(iso, lib, r.why)) { have++; chosen.push(iso); }
        }
        if (have < target) out.flags.push(`Week of ${wk[0]}: only ${have} of ${target} ${lib.label} days fit your other rules.`);
      }));
      if (r.kind === "copyWeek") {
        const weeks = weeksOf(days);
        const idx = { first: 0, "1st": 0, "week 1": 0, "week one": 0, second: 1, "2nd": 1, "week 2": 1, "week two": 1, third: 2, "3rd": 2, "week 3": 2, fourth: 3, "4th": 3, "week 4": 3 };
        let fi = r.from.toLowerCase() === "this" ? weeks.findIndex((w) => w.includes(ctx.today || "")) : idx[r.from.toLowerCase()];
        if (fi == null || fi < 0) fi = 0;
        const src = weeks[fi]; if (!src) return;
        const targets = /next/i.test(r.to) ? [weeks[fi + 1]].filter(Boolean) : weeks.slice(fi + 1);
        targets.forEach((wk) => wk.forEach((iso) => {
          const dw = dayOf(iso).getDay();
          const s = src.find((x) => dayOf(x).getDay() === dw); if (!s) return;
          const acts = plan[s].filter((id) => !blocked(iso, id));
          if (JSON.stringify(acts) !== JSON.stringify(plan[iso])) { plan[iso] = acts.slice(); note(iso, `copied from ${s}`); }
        }));
      }
      if (r.kind === "rebalance") {
        const libs = r.what ? findAll(r.what).list : ctx.library;
        libs.forEach((lib) => weeksOf(days).forEach((wk) => {
          const on = wk.filter((iso) => plan[iso].includes(lib.id));
          if (on.length < 2) return;
          // move back-to-back repeats to the emptiest non-adjacent day of the week
          for (let i = 1; i < on.length; i++) {
            if (dayOf(on[i]) - dayOf(on[i - 1]) > 86400000) continue;
            const alt = wk.filter((iso) => !plan[iso].includes(lib.id) && !blocked(iso, lib.id) && on.every((o) => Math.abs(dayOf(o) - dayOf(iso)) > 86400000)).sort((a, b) => plan[a].length - plan[b].length)[0];
            if (!alt) continue;
            plan[on[i]] = plan[on[i]].filter((x) => x !== lib.id); note(on[i], `− ${lib.label} (rebalanced to ${alt})`);
            plan[alt].push(lib.id); note(alt, `+ ${lib.label} (rebalanced from ${on[i]})`); on[i] = alt;
          }
        }));
      }
    });
    // avoidance rules also clean what's already planned
    days.forEach((iso) => plan[iso].slice().forEach((id) => { const b = blocked(iso, id); if (b) { plan[iso] = plan[iso].filter((x) => x !== id); note(iso, `− ${(ctx.library.find((l) => l.id === id) || { label: id }).label} (${b.why})`); } }));

    days.forEach((iso) => {
      const add = plan[iso].filter((id) => !before[iso].includes(id)), remove = before[iso].filter((id) => !plan[iso].includes(id));
      if (add.length || remove.length) out.changes.push({ iso, add, remove, acts: plan[iso].slice(), why: why[iso] || [] });
    });
    out.flags.push(...volumeFlags(plan, days, ctx, heavy));
    out.flags = uniq(out.flags);
    out.notes = uniq(out.notes);
    return out;
  }
  function volumeFlags(plan, days, ctx, heavy) {
    const flags = [];
    const lib = (id) => ctx.library.find((l) => l.id === id);
    let run = [];
    days.forEach((iso) => {
      const acts = plan[iso].map(lib).filter(Boolean);
      const mins = acts.reduce((n, a) => n + (+a.dur || 0), 0);
      if (mins > 150 || acts.length > 5) flags.push(`${iso}: high volume — ${acts.length} planned activities, about ${mins} minutes.`);
      const g = (ctx.games || {})[iso], nx = (() => { const d = dayOf(iso); d.setDate(d.getDate() + 1); return (ctx.games || {})[isoOf(d)]; })();
      if (nx && nx.time && parseClock(nx.time) < 13 * 60 && acts.some(heavy)) flags.push(`${iso}: heavy field work the day before a ${nx.time} game.`);
      if (acts.some(heavy)) run.push(iso); else run = [];
      if (run.length === 3) flags.push(`${run[0]} to ${run[2]}: three heavy field days in a row.`);
      void g;
    });
    return flags;
  }

  /* ======================================================================
     INTERPRETATION CONTRACT — what an AI interpreter may return. The engine
     validates it field by field and runs it through the same deterministic
     code as the built-in reader. Nothing it says is saved without review.
     ====================================================================== */
  const OP_NAMES = ["shift", "setStart", "setDur", "extend", "setLoc", "setStaff", "remove", "add", "swapGroups", "swapTimes", "indoor", "rename"];
  const INTERPRETATION_SCHEMA = {
    type: "object", additionalProperties: false,
    required: ["intent", "brief", "edits", "monthRules", "clarifications", "assumptions"],
    properties: {
      intent: { type: "string", enum: ["build", "edit", "month", "clarify"] },
      brief: { type: "string", description: "For intent=build: the day restated as plain sentences the deterministic planner reads (groups, what each needs with minutes, fixed times, first pitch, deadlines, rotations, ordering). Empty otherwise." },
      edits: {
        type: "array", description: "For intent=edit: one entry per change, in order.",
        items: {
          type: "object", additionalProperties: false,
          required: ["op", "target", "value", "group"],
          properties: {
            op: { type: "string", enum: OP_NAMES },
            target: { type: "string", description: "The block(s) affected, in the coach's words, e.g. \"Blue's hitting\", \"everything after lunch\", \"the 10:00 block\". For swapGroups/swapTimes: \"A | B\"." },
            value: { type: "string", description: "shift/extend: signed minutes (\"15\", \"-10\"). setStart: clock time \"10:30\". setDur: minutes. setLoc: place. setStaff: coach. rename: new activity. add: \"activity @ time (minutes) on place\". Empty for remove/indoor/swaps." },
            group: { type: "string", description: "For add: the group; otherwise empty." }
          }
        }
      },
      monthRules: { type: "array", items: { type: "string" }, description: "For intent=month: each rule as a short sentence, e.g. \"bunt defense every Tuesday\", \"team defense 3 times a week\", \"avoid heavy defense before morning games\"." },
      clarifications: { type: "array", items: { type: "string" }, description: "Targeted questions when something essential is missing or ambiguous." },
      assumptions: { type: "array", items: { type: "string" } }
    }
  };
  /** returns {ok, value?, errors[]} — strict, so a malformed reply never reaches the schedule */
  function validateInterpretation(x) {
    const errors = [];
    const isStr = (v) => typeof v === "string";
    if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, errors: ["not an object"] };
    if (!["build", "edit", "month", "clarify"].includes(x.intent)) errors.push("intent");
    if (!isStr(x.brief)) errors.push("brief");
    ["edits", "monthRules", "clarifications", "assumptions"].forEach((k) => { if (!Array.isArray(x[k])) errors.push(k); });
    const arr = (v) => (Array.isArray(v) ? v : []);
    arr(x.edits).forEach((e, i) => {
      if (!e || !OP_NAMES.includes(e.op)) errors.push(`edits[${i}].op`);
      ["target", "value", "group"].forEach((k) => { if (!isStr(e && e[k])) errors.push(`edits[${i}].${k}`); });
    });
    ["monthRules", "clarifications", "assumptions"].forEach((k) => arr(x[k]).forEach((v, i) => { if (!isStr(v)) errors.push(`${k}[${i}]`); }));
    if (String(x.brief || "").length > 6000) errors.push("brief too long");
    if (arr(x.edits).length > 40) errors.push("too many edits");
    return errors.length ? { ok: false, errors } : { ok: true, value: x, errors: [] };
  }
  /** an AI interpretation's edits, turned into the same command sentences the built-in reader parses */
  function editsToCommands(edits) {
    return (edits || []).map((e) => {
      const [a, b] = String(e.target).split("|").map((s) => s.trim());
      switch (e.op) {
        case "shift": { const n = parseInt(e.value, 10) || 0; return `move ${a} ${n >= 0 ? "later" : "earlier"} ${Math.abs(n)} minutes`; }
        case "setStart": return `move ${a} to ${e.value}`;
        case "setDur": return `make ${a} ${parseInt(e.value, 10) || 0} minutes`;
        case "extend": { const n = parseInt(e.value, 10) || 0; return n >= 0 ? `extend ${a} by ${n} minutes` : `shorten ${a} by ${-n} minutes`; }
        case "setLoc": return `move ${a} to ${e.value}`;
        case "setStaff": return `assign ${e.value} to ${a}`;
        case "remove": return `remove ${a}`;
        case "rename": return `change ${a} to ${e.value}`;
        case "add": { const m = String(e.value).match(/^(.+?)\s*@\s*([^()]+?)(?:\s*\((\d+)\))?(?:\s+on\s+(.+))?$/); return m ? `add ${m[1]} at ${m[2].trim()}${m[3] ? " for " + m[3] + " minutes" : ""}${e.group ? " for " + e.group : ""}${m[4] ? " on " + m[4] : ""}` : `add ${e.value}${e.group ? " for " + e.group : ""}`; }
        case "swapGroups": case "swapTimes": return `swap ${a} and ${b || ""}`;
        case "indoor": return "move everything indoors";
        default: return "";
      }
    }).filter(Boolean).join("\n");
  }

  return { groupsOf, matchGroups, resolveTarget, activityMatches, clauses, parseCommands, applyOps, parseReference, matchTemplate,
    BRIEF_TEMPLATES, planMonth, monthDays, weeksOf, dowList, INTERPRETATION_SCHEMA, validateInterpretation, editsToCommands, OP_NAMES };
});
