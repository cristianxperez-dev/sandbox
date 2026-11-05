/* Play Repository — pure logic: filters, natural-language search, similarity, situation helpers.
   No DOM. Loaded by the page and by the Node tests. Every filter reads fields that exist in data/index.json;
   anything MLB's data cannot establish (communication, "infield in", cutoff responsibilities …) is only
   available through the coach's own manual tags, and the search says so. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PR = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------- helpers */
  const ORD = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th");
  const halfLabel = (p) => (p.half === "top" ? "Top " : "Bot ") + ORD(p.inning);
  const batScore = (p) => p.score[p.batting === "away" ? 0 : 1];
  const fldScore = (p) => p.score[p.batting === "away" ? 1 : 0];
  const diff = (p) => batScore(p) - fldScore(p);
  const phase = (inn) => (inn >= 10 ? "extra" : inn >= 7 ? "late" : inn >= 4 ? "middle" : "early");
  const runnersN = (code) => [...code].filter((c) => c !== "_").length;
  const BASE_NAMES = { "___": "Bases empty", "1__": "Runner on 1st", "_2_": "Runner on 2nd", "__3": "Runner on 3rd", "12_": "Runners on 1st & 2nd",
    "1_3": "Runners on 1st & 3rd", "_23": "Runners on 2nd & 3rd", "123": "Bases loaded" };
  const basesLabel = (code) => BASE_NAMES[code] || code;
  const outsLabel = (n) => (n === 0 ? "No outs" : n === 1 ? "1 out" : "2 outs");
  const battingTeam = (p) => (p.batting === "away" ? p.away : p.home);
  const fieldingTeam = (p) => (p.batting === "away" ? p.home : p.away);
  const POS = { P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9 };
  const LOC_NAME = { 1: "pitcher", 2: "catcher", 3: "first base", 4: "second base", 5: "third base", 6: "shortstop", 7: "left field", 8: "center field", 9: "right field" };
  // groups whose selected flags combine with OR ("singles or doubles"); situation/context flags combine with AND
  const OR_GROUPS = new Set(["offense", "baserunning", "defense", "catcher", "pitching"]);

  /* ----------------------------------------------------------- filters */
  function emptyFilters() {
    return { bases: { mode: "any", sel: [] }, outs: [], runners: [], innMin: null, innMax: null, half: null, phases: [], batSide: null,
      scoreState: [], flags: [], events: [], seasons: [], dateFrom: "", dateTo: "", gameTypes: [], team: "", teamRole: "any",
      batter: "", pitcher: "", batHand: null, pitHand: null, positions: [], spray: [], locations: [], pitchTypes: [],
      evMin: null, evMax: null, laMin: null, laMax: null, distMin: null, veloMin: null, veloMax: null, balls: null, strikes: null,
      outsOnPlay: [], runsMin: null, liMin: null, liMax: null, dreMin: null, dreMax: null, wpaMin: null, wpaMax: null,
      ifAlign: [], ofAlign: [], categories: [], tags: [], savedOnly: false, collection: "", camera: "", hhStatus: "" };
  }
  const has = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
  const between = (x, lo, hi) => (lo == null || (x != null && x >= lo)) && (hi == null || (x != null && x <= hi));
  /** win-probability change from the batting team's point of view, in percentage points */
  const wpaBat = (p) => (p.wpHomeAdded == null ? null : p.batting === "home" ? p.wpHomeAdded : -p.wpHomeAdded);

  /**
   * user: {tags: {playId: [labels]}, saved: Set|Array, collections: {id: {plays: []}}}
   * flagDefs: {flagId: {group}}
   */
  function matches(p, f, user = {}, flagDefs = {}) {
    // base occupancy before the play
    const sel = f.bases && f.bases.sel || [];
    if (f.bases && f.bases.mode === "exact") {
      const want = (sel.includes(1) ? "1" : "_") + (sel.includes(2) ? "2" : "_") + (sel.includes(3) ? "3" : "_");
      if (p.bases !== want) return false;
    } else if (f.bases && f.bases.mode === "includes" && sel.length) {
      if (!sel.every((b) => p.bases[b - 1] !== "_")) return false;
    }
    if (has(f.outs) && !f.outs.includes(p.outs)) return false;
    if (has(f.runners) && !f.runners.includes(runnersN(p.bases))) return false;
    if (!between(p.inning, f.innMin, f.innMax)) return false;
    if (f.half && p.half !== f.half) return false;
    if (has(f.phases) && !f.phases.includes(phase(p.inning))) return false;
    if (f.batSide && p.batting !== f.batSide) return false;
    if (has(f.scoreState)) {
      const d = diff(p), st = d === 0 ? "tied" : d > 0 ? "leading" : "trailing";
      if (!f.scoreState.includes(st)) return false;
    }
    if (has(f.flags)) {
      const byGroup = {};
      f.flags.forEach((fl) => { const g = (flagDefs[fl] || {}).group || "situation"; (byGroup[g] = byGroup[g] || []).push(fl); });
      for (const [g, list] of Object.entries(byGroup)) {
        const ok = OR_GROUPS.has(g) ? list.some((x) => p.flags.includes(x)) : list.every((x) => p.flags.includes(x));
        if (!ok) return false;
      }
    }
    if (has(f.events) && !f.events.includes(p.event)) return false;
    if (has(f.seasons) && !f.seasons.includes(p.season)) return false;
    if (f.dateFrom && p.date < f.dateFrom) return false;
    if (f.dateTo && p.date > f.dateTo) return false;
    if (has(f.gameTypes)) { const post = ["F", "D", "L", "W"].includes(p.gameType); if (!f.gameTypes.includes(post ? "post" : "regular")) return false; }
    if (f.team) {
      const t = f.team, role = f.teamRole || "any";
      const ok = role === "batting" ? battingTeam(p) === t : role === "fielding" ? fieldingTeam(p) === t : p.away === t || p.home === t;
      if (!ok) return false;
    }
    if (f.batter && !nameHit(p.batter, f.batter)) return false;
    if (f.pitcher && !nameHit(p.pitcher, f.pitcher)) return false;
    if (f.batHand && p.batter.side !== f.batHand) return false;
    if (f.pitHand && p.pitcher.hand !== f.pitHand) return false;
    if (has(f.positions) && !f.positions.some((x) => p.positions.includes(x))) return false;
    const bb = p.batted || {};
    if (has(f.spray) && !f.spray.includes(bb.spray)) return false;
    if (has(f.locations) && !f.locations.includes(bb.location)) return false;
    if (!between(bb.ev, f.evMin, f.evMax)) return false;
    if (!between(bb.la, f.laMin, f.laMax)) return false;
    if (f.distMin != null && !(bb.distance >= f.distMin)) return false;
    const pi = p.pitch || {};
    if (has(f.pitchTypes) && !f.pitchTypes.includes(pi.type)) return false;
    if (!between(pi.speed, f.veloMin, f.veloMax)) return false;
    if (f.balls != null && p.count[0] !== f.balls) return false;
    if (f.strikes != null && p.count[1] !== f.strikes) return false;
    if (has(f.outsOnPlay) && !f.outsOnPlay.includes(p.outsOnPlay)) return false;
    if (f.runsMin != null && !(p.runs >= f.runsMin)) return false;
    if (!between(p.li, f.liMin, f.liMax)) return false;
    if (!between(p.dRunExp, f.dreMin, f.dreMax)) return false;
    if (!between(wpaBat(p), f.wpaMin, f.wpaMax)) return false;
    if (has(f.ifAlign) && !f.ifAlign.includes(p.ifAlign)) return false;
    if (has(f.ofAlign) && !f.ofAlign.includes(p.ofAlign)) return false;
    if (has(f.categories) && !f.categories.includes(p.category)) return false;
    if (has(f.tags)) { const mine = (user.tags || {})[p.id] || []; if (!f.tags.every((t) => mine.some((m) => m.toLowerCase() === t.toLowerCase()))) return false; }
    if (f.savedOnly && !savedHas(user.saved, p.id)) return false;
    if (f.collection) { const c = (user.collections || {})[f.collection]; if (!c || !c.plays.includes(p.id)) return false; }
    if (f.hhStatus && hhStatusOf(p) !== f.hhStatus) return false;
    if (f.camera) { const c = cameras(p); if (f.camera === "both" ? !(c.broadcast && c.highHome) : !c[f.camera]) return false; }
    return true;
  }
  /** which cameras a play has verified video for — stored per play; older imports fall back to their clip angles */
  const cameras = (p) => p.cameras || { broadcast: (p.angles || []).includes("broadcast"), highHome: (p.angles || []).includes("high-home"), other: [] };
  const hhStatusOf = (p) => (cameras(p).highHome ? "verified" : (p.cameras || {}).highHomeStatus || "not_searched");
  const HH_STATUS_LABEL = { verified: "High Home verified", inaccessible: "High Home exists, not public", not_found: "High Home not found", not_searched: "High Home not yet searched" };
  const CAMERA_LABEL = { broadcast: "Broadcast available", highHome: "High Home available", both: "Both angles available" };
  const savedHas = (s, id) => (s instanceof Set ? s.has(id) : Array.isArray(s) ? s.includes(id) : false);
  function nameHit(person, q) {
    if (!q) return true;
    if (typeof q === "number") return person.id === q;
    const n = person.name.toLowerCase(), s = String(q).toLowerCase().trim();
    return n === s || n.includes(s) || n.split(" ").pop() === s;
  }
  function filter(plays, f, user, flagDefs) { return plays.filter((p) => matches(p, f, user, flagDefs)); }

  /** facet counts: how many plays in `plays` carry each flag / value — drives which chips are enabled */
  function facets(plays) {
    const c = { flags: {}, events: {}, seasons: {}, teams: {}, pitchTypes: {}, positions: {}, ifAlign: {}, ofAlign: {}, categories: {} };
    const inc = (o, k) => { if (k != null && k !== "") o[k] = (o[k] || 0) + 1; };
    plays.forEach((p) => {
      p.flags.forEach((x) => inc(c.flags, x)); inc(c.events, p.event); inc(c.seasons, p.season); inc(c.teams, p.away); inc(c.teams, p.home);
      inc(c.pitchTypes, (p.pitch || {}).type); p.positions.forEach((x) => inc(c.positions, x)); inc(c.ifAlign, p.ifAlign); inc(c.ofAlign, p.ofAlign); inc(c.categories, p.category);
    });
    return c;
  }

  /* ------------------------------------------------- natural-language search
     Rules over the real schema. Returns the filters, what was understood (for display), and anything that
     MLB's data cannot answer — never a guess. */
  const NUM = { zero: 0, no: 0, none: 0, nobody: 0, one: 1, two: 2, three: 3 };
  const FLAG_WORDS = [
    [/\bwalk[- ]?off situations?\b/, "walkoff_situation"], [/\bwalk[- ]?offs?\b/, "walkoff"],
    [/\bwinning run (?:was |is )?(?:on|at|in)\b/, "winning_run_on"], [/\btying run (?:was |is )?(?:on|at|in)\b/, "tying_run_on"], [/\bgo[- ]ahead run (?:was |is )?(?:on|at|in)\b/, "go_ahead_on"],
    [/\bgo[- ]ahead (?:hit|swing|homer|home run|play)s?\b/, "go_ahead_play"],
    [/\bscoring position\b|\brisp\b/, "risp"], [/\bdouble[- ]play situations?\b|\bdp situations?\b|\bdouble[- ]play opportunit(?:y|ies)\b/, "dp_situation"],
    [/\bforce (?:is )?(?:on|available)\b|\bforce situations?\b/, "force_available"],
    [/\bhigh[- ]leverage\b|\bclutch\b|\bpressure\b/, "high_leverage"], [/\blow[- ]leverage\b/, "low_leverage"],
    [/\bone[- ]run games?\b/, "one_run"], [/\bclose games?\b/, "close"], [/\bblowouts?\b/, "blowout"],
    [/\bextra innings?\b|\bextras\b/, "extra_innings"], [/\bpostseason\b|\bplayoffs?\b|\bworld series\b/, "postseason"],
    [/\bsingles?\b/, "single"], [/\bdoubles\b|\ba double\b|\bdoubled\b(?! off)/, "double"], [/\btriples?\b/, "triple"], [/\bhome runs?\b|\bhomers?\b|\bhomered\b/, "home_run"],
    [/\bground ?balls?\b|\bgrounders?\b|\bgrounded\b/, "ground_ball"], [/\bline drives?\b|\bliners?\b/, "line_drive"], [/\bfly ?balls?\b|\bflies\b/, "fly_ball"],
    [/\bpop[- ]?ups?\b|\bpopped\b/, "popup"], [/\bsac(?:rifice)? flys?\b|\bsac(?:rifice)? flies\b/, "sac_fly"], [/\bsac(?:rifice)? bunts?\b|\bbunts?\b|\bbunting\b/, "bunt"],
    [/\bstolen bases?\b|\bsteals?\b|\bstealing\b(?! third)/, "stolen_base"], [/\bcaught stealing\b|\bthrown out stealing\b/, "caught_stealing"],
    [/\bpick[- ]?offs?\b|\bpicked off\b/, "pickoff"], [/\bfirst[- ]to[- ]third\b|\b1st to 3rd\b/, "first_to_third"],
    [/\bscor(?:e|es|ing) from second on (?:a )?singles?\b/, "score_from_second_single"], [/\bscor(?:e|es|ing) from first\b/, "score_from_first_xbh"],
    [/\btag(?:ging)?[- ]?ups?\b|\btagged up\b|\btags? up\b/, "tag_up"], [/\brundowns?\b|\bpickles?\b/, "rundown"],
    [/\bbaserunning (?:mistakes?|errors?|outs?)\b|\bthrown out (?:advancing|on the bases)\b|\bout on the bases\b/, "runner_out_on_bases"],
    [/\bdoubled off\b/, "doubled_off"], [/\bwild pitch(?:es)?\b/, "wild_pitch"], [/\bpassed balls?\b/, "passed_ball"], [/\bbalks?\b/, "balk"],
    [/\bdouble plays?\b|\bdps\b|\btwin killings?\b/, "double_play"], [/\bforce (?:plays?|outs?)\b/, "force_play"], [/\btag plays?\b/, "tag_play"],
    [/\boutfield assists?\b|\bthrown out by (?:the )?(?:left|center|right) fielder\b/, "outfield_assist"], [/\brelays?\b|\bcut[- ]?offs?\b/, "relay"],
    [/\bplays? at (?:the )?plate\b|\bplays? at home\b|\bthrows? (?:to )?home\b|\bthrows? to the plate\b/, "play_at_plate"], [/\bout at (?:the )?(?:plate|home)\b/, "out_at_plate"],
    [/\berrors?\b|\bmisplays?\b|\bdefensive mistakes?\b/, "error"], [/\bstrike ?outs?\b|\bstruck out\b|\bks?\b(?=\s|$)/, "strikeout"], [/\bwalks?\b(?! ?off)/, "walk"],
    [/\btwo[- ]out rbis?\b|\b2[- ]out rbis?\b/, "two_out_rbi"], [/\bproductive outs?\b|\bmoving (?:the )?runners? over\b/, "productive_out"],
    [/\bshifts?\b|\bshifted\b|\bunusual alignments?\b|\bstrategic alignments?\b/, "shift_alignment"], [/\bpitchouts?\b/, "pitchout"],
    [/\breview(?:ed|s)?\b|\bchallenge[sd]?\b|\breplay review\b/, "challenge"], [/\bcatcher (?:throw|throws|throwing|throw-?outs?|caught)\b/, "catcher_throw"],
  ];
  const MANUAL_ONLY = [
    [/\bcommunication\b|\bmiscommunication\b|\bcalling (?:for|off)\b/, "communication"], [/\binfield in\b|\binfield drawn in\b/, "infield in"],
    [/\bmissed cut[- ]?offs?\b|\bcut[- ]?off (?:responsibilit|alignment|man)\w*/, "cutoff responsibilities"], [/\bsecondary leads?\b|\bleads? off\b|\bjumps?\b/, "leads and jumps"],
    [/\bback(?:ing)? ?ups?\b/, "backing up"], [/\bpositioning\b/, "defensive positioning (beyond Statcast's alignment)"], [/\bdecision[- ]making\b|\bbad reads?\b|\breads?\b/, "decision-making"],
    [/\bblock(?:ing|ed|s)?\b(?! of)/, "catcher blocking"], [/\breceiving\b|\bframing\b/, "catcher receiving"], [/\bhustle\b|\beffort\b/, "effort"],
  ];
  const PITCHES = [["four-seam fastball", /\bfour[- ]seam(?:er)?s?\b|\bheaters?\b/], ["Sinker", /\bsinkers?\b|\btwo[- ]seam(?:er)?s?\b/], ["Cutter", /\bcutters?\b/],
    ["Slider", /\bsliders?\b/], ["Sweeper", /\bsweepers?\b/], ["Curveball", /\bcurve ?balls?\b|\bcurves?\b|\bbreaking balls?\b/], ["Changeup", /\bchange[- ]?ups?\b/],
    ["Splitter", /\bsplitters?\b|\bsplit[- ]finger\b/], ["Knuckle Curve", /\bknuckle[- ]?curves?\b/]];
  const LOC_WORDS = [[/\b(?:to|into) (?:the )?middle infield\b|\bup the middle\b|\bmiddle infield(?:er)?s?\b/, "flag", "middle_infield"],
    [/\b(?:to|into) (?:the )?outfield\b|\boutfield plays?\b/, "flag", "outfield_play"], [/\binfield ground ?balls?\b|\bground ?balls? to the infield\b/, "flag", "ground_ball_infield"],
    [/\b(?:to|in) right(?: field)?\b|\bright field(?:er)?\b/, "loc", 9], [/\b(?:to|in) center(?: field)?\b|\bcenter field(?:er)?\b/, "loc", 8], [/\b(?:to|in) left(?: field)?\b|\bleft field(?:er)?\b/, "loc", 7],
    [/\bto (?:the )?shortstop\b|\bto short\b/, "loc", 6], [/\bto (?:the )?second baseman\b|\bto second base(?:man)?\b/, "loc", 4], [/\bto (?:the )?third baseman\b/, "loc", 5]];
  const POS_WORDS = [[/\boutfielders?\b|\boutfield throws?\b/, ["LF", "CF", "RF"]], [/\bcatchers?\b/, ["C"]], [/\bshortstops?\b/, ["SS"]],
    [/\bsecond basem[ae]n\b/, ["2B"]], [/\bthird basem[ae]n\b/, ["3B"]], [/\bfirst basem[ae]n\b/, ["1B"]], [/\bpitchers? fielding\b|\bpfp\b/, ["P"]]];

  /**
   * ctx: {teams: {abbr: [names…]}, people: [{name, id}], tags: [custom tag labels], flagDefs}
   * returns {filters, understood: [string], unsupported: [string], unknown: [string]}
   */
  const PR_ORD = (n) => ORD(n);
  function parseQuery(text, ctx = {}, base) {
    const f = base ? JSON.parse(JSON.stringify(base)) : emptyFilters();
    const understood = [], unsupported = [];
    let t = " " + String(text || "").toLowerCase().replace(/[“”"]/g, " ").replace(/[,;|]/g, " | ").replace(/\s+/g, " ") + " ";
    const take = (re, fn) => { let hit = false; t = t.replace(new RegExp(re.source, "g"), (...m) => { hit = true; fn(m); return " | "; }); return hit; };
    const addFlag = (fl, label) => { if (!f.flags.includes(fl)) f.flags.push(fl); understood.push(label || ((ctx.flagDefs || {})[fl] || {}).label || fl); };
    // coach's own tags first: a phrase that is one of their labels filters by it
    (ctx.tags || []).slice().sort((a, b) => b.length - a.length).forEach((tag) => {
      const re = new RegExp("\\b" + tag.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(t)) { take(re, () => {}); f.tags.push(tag); understood.push(`Your tag “${tag}”`); }
    });
    // "the tying run was on second": the flag, plus at least a runner on that base
    const BN = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
    take(/\b(tying|go[- ]ahead|winning) run (?:was |is |on |at )?(?:on|at) (first|1st|second|2nd|third|3rd)(?: base)?\b/, (m) => {
      const fl = { tying: "tying_run_on", winning: "winning_run_on" }[m[1]] || "go_ahead_on";
      addFlag(fl); const b = BN[m[2]];
      f.bases = { mode: "includes", sel: [...new Set([...(f.bases.mode === "includes" ? f.bases.sel : []), b])] };
      understood.push("Runner on " + PR_ORD(b) + " (at least)");
    });
    // base-out state
    const B = (sel, label) => { f.bases = { mode: "exact", sel }; understood.push(label); };
    if (take(/\bbases (?:are )?(?:loaded|full|juiced)\b|\bloaded bases\b/, () => B([1, 2, 3], "Bases loaded"))) {}
    else if (take(/\b(?:runners? on |men on )?(?:first|1st) and (?:third|3rd)\b|\bthe corners\b/, () => B([1, 3], "Runners on 1st & 3rd"))) {}
    else if (take(/\b(?:runners? on |men on )?(?:first|1st) and (?:second|2nd)\b/, () => B([1, 2], "Runners on 1st & 2nd"))) {}
    else if (take(/\b(?:runners? on |men on )?(?:second|2nd) and (?:third|3rd)\b/, () => B([2, 3], "Runners on 2nd & 3rd"))) {}
    else if (take(/\b(?:a )?(?:runner|man|guy) (?:on|at) (?:first|1st)(?: base)?\b/, () => B([1], "Runner on 1st"))) {}
    else if (take(/\b(?:a )?(?:runner|man|guy) (?:on|at) (?:second|2nd)(?: base)?\b/, () => B([2], "Runner on 2nd"))) {}
    else if (take(/\b(?:a )?(?:runner|man|guy) (?:on|at) (?:third|3rd)(?: base)?\b/, () => B([3], "Runner on 3rd"))) {}
    else if (take(/\bbases empty\b|\bnobody on\b|\bno one on\b|\bempty bases\b/, () => B([], "Bases empty"))) {}
    else if (take(/\bany runners?\b|\brunners? on(?: base)?\b|\bmen on(?: base)?\b|\btraffic\b/, () => { f.runners = [1, 2, 3]; understood.push("Any runner on base"); })) {}
    take(/\b(?:less|fewer) than (?:two|2) outs?\b|\b(?:<|under) ?2 outs\b/, () => { f.outs = [0, 1]; understood.push("Fewer than two outs"); });
    take(/\b(no|zero|0|nobody|none) outs?\b|\bnobody out\b|\bnone out\b/, () => { f.outs = [0]; understood.push("No outs"); });
    take(/\b(one|1) outs?\b/, () => { f.outs = [1]; understood.push("1 out"); });
    take(/\b(two|2)[- ]outs?\b(?! rbi)/, () => { f.outs = [2]; understood.push("2 outs"); });
    // innings
    take(/\blate[- ]innings?\b|\blate in (?:the )?games?\b|\blate[- ]game\b|\blate\b(?= [a-z]+ (?:plays?|situations?))/, () => { f.phases = ["late"]; understood.push("Late innings (7–9)"); });
    take(/\bearly[- ]innings?\b|\bearly in (?:the )?games?\b/, () => { f.phases = ["early"]; understood.push("Early innings (1–3)"); });
    take(/\bmiddle innings?\b/, () => { f.phases = ["middle"]; understood.push("Middle innings (4–6)"); });
    take(/\b(top|bottom) of (?:the )?(\d{1,2})(?:st|nd|rd|th)?\b/, (m) => { f.half = m[1]; f.innMin = f.innMax = +m[2]; understood.push(`${m[1] === "top" ? "Top" : "Bottom"} ${ORD(+m[2])}`); });
    take(/\b(?:in the )?(\d{1,2})(?:st|nd|rd|th) inning\b|\bin the (\d{1,2})(?:st|nd|rd|th)\b/, (m) => { const n = +(m[1] || m[2]); f.innMin = f.innMax = n; understood.push(`${ORD(n)} inning`); });
    take(/\bninth\b/, () => { f.innMin = f.innMax = 9; understood.push("9th inning"); });
    // score state (batting team)
    take(/\btied\b|\btie games?\b/, () => { f.scoreState = ["tied"]; understood.push("Tied game"); });
    take(/\b(?:batting team )?(?:leading|ahead|winning)\b/, () => { f.scoreState = ["leading"]; understood.push("Batting team leading"); });
    take(/\b(?:batting team )?(?:trailing|behind|losing|down by)\b/, () => { f.scoreState = ["trailing"]; understood.push("Batting team trailing"); });
    // locations and positions
    LOC_WORDS.forEach(([re, kind, v]) => take(re, () => { if (kind === "flag") addFlag(v); else { f.locations.push(v); understood.push("Fielded in " + LOC_NAME[v]); } }));
    POS_WORDS.forEach(([re, list]) => take(re, () => { list.forEach((x) => { if (!f.positions.includes(x)) f.positions.push(x); }); understood.push("Involving " + list.join("/")); }));
    // manual-only concepts are reported, never guessed
    MANUAL_ONLY.forEach(([re, label]) => take(re, () => unsupported.push(label)));
    FLAG_WORDS.forEach(([re, fl]) => take(re, () => addFlag(fl)));
    PITCHES.forEach(([name, re]) => take(re, () => { f.pitchTypes.push(name === "four-seam fastball" ? "Four-Seam Fastball" : name); understood.push(name); }));
    take(/\b(\d{2,3}) ?\+ ?mph\b|\b(?:over|above) (\d{2,3}) ?mph\b/, (m) => { f.veloMin = +(m[1] || m[2]); understood.push(`Pitch ${f.veloMin}+ mph`); });
    take(/\bhard[- ]hit\b/, () => { f.evMin = 95; understood.push("Exit velocity 95+ mph"); });
    take(/\bboth (?:camera )?angles\b|\bhigh[- ]home and broadcast\b|\bbroadcast and high[- ]home\b/, () => { f.camera = "both"; understood.push(CAMERA_LABEL.both); });
    take(/\bhigh[- ]home(?: (?:angle|camera|view|video|footage))?\b/, () => { f.camera = "highHome"; understood.push(CAMERA_LABEL.highHome); });
    take(/\bfull counts?\b|\b3-2\b/, () => { f.balls = 3; f.strikes = 2; understood.push("Full count"); });
    take(/\btwo[- ]strikes?\b|\b2[- ]strikes?\b/, () => { f.strikes = 2; understood.push("Two strikes"); });
    take(/\b(20\d\d)\b/, (m) => { f.seasons.push(+m[1]); understood.push("Season " + m[1]); });
    take(/\bregular season\b/, () => { f.gameTypes = ["regular"]; understood.push("Regular season"); });
    take(/\bsituational hitting\b/, () => { ["productive_out", "runner_scored_on_out", "sac_fly", "sac_bunt", "two_out_rbi"].forEach((x) => x !== "sac_bunt" && !f.flags.includes(x) && f.flags.push(x)); understood.push("Situational hitting (productive outs, runs on outs, sac flies, two-out RBIs)"); });
    // teams and people from the data itself
    Object.entries(ctx.teams || {}).forEach(([abbr, names]) => {
      names.concat([abbr]).filter(Boolean).sort((a, b) => b.length - a.length).some((n) => {
        const re = new RegExp("\\b" + n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
        if (n.length < 3 && n !== abbr) return false;
        if (re.test(t)) { take(re, () => {}); f.team = abbr; understood.push("Team " + abbr); return true; }
        return false;
      });
    });
    (ctx.people || []).slice().sort((a, b) => b.name.length - a.name.length).forEach((pp) => {
      const full = pp.name.toLowerCase();
      if (t.includes(" " + full + " ") || t.includes(" " + full + "'s ")) {
        t = t.replace(full, " | ");
        if (pp.role === "pitcher") { f.pitcher = pp.name; understood.push("Pitcher " + pp.name); } else { f.batter = pp.name; understood.push("Batter " + pp.name); }
      }
    });
    const STOP = /^(?:show|me|find|plays?|examples?|clips?|videos?|with|where|the|a|an|and|or|of|on|in|at|to|by|was|were|is|are|that|which|who|for|it|their|his|her|making|made|make|trying|tries|try|situations?|games?|base|bases|runners?|hit|hits|hitting|inning|innings|than|less|fewer|ball|balls|out|outs|game|baseball|some|any|all|from|team|teams|got|get|gets|being|after|before|into|over|play|good|great|bad|nice|throws?|throwing|defensive|mistakes?|plays|\|)$/;
    const unknown = t.split(/\s+/).map((w) => w.replace(/[^a-z0-9'-]/g, "")).filter((w) => w && !STOP.test(w) && w.length > 2);
    return { filters: f, understood, unsupported: [...new Set(unsupported)], unknown: [...new Set(unknown)] };
  }

  /* ------------------------------------------------------- similar plays */
  const OUTCOME_GROUPS = new Set(["offense", "baserunning", "defense", "catcher", "pitching"]);
  function similarity(a, b, flagDefs = {}, tagsA = [], tagsB = []) {
    if (a.id === b.id) return -1;
    let s = 0;
    if (a.bases === b.bases) s += 3; else s += 1.5 * (1 - [...a.bases].filter((c, i) => c !== b.bases[i]).length / 3);
    if (a.outs === b.outs) s += 2;
    if (a.event === b.event) s += 3;
    const oa = a.flags.filter((x) => OUTCOME_GROUPS.has((flagDefs[x] || {}).group)), ob = b.flags.filter((x) => OUTCOME_GROUPS.has((flagDefs[x] || {}).group));
    const inter = oa.filter((x) => ob.includes(x)).length, uni = new Set([...oa, ...ob]).size;
    if (uni) s += 5 * inter / uni;
    if (phase(a.inning) === phase(b.inning)) s += 1;
    const da = Math.sign(diff(a)), db = Math.sign(diff(b));
    if (da === db) s += 0.75;
    if (a.positions.some((x) => b.positions.includes(x))) s += 1;
    if (a.category === b.category) s += 1;
    if (tagsA.length && tagsB.length) s += 2 * tagsA.filter((x) => tagsB.includes(x)).length / Math.max(tagsA.length, tagsB.length);
    return Math.round(s * 100) / 100;
  }
  function similar(play, plays, flagDefs, user = {}, n = 12) {
    const tags = (user.tags || {});
    return plays.map((p) => ({ p, s: similarity(play, p, flagDefs, tags[play.id] || [], tags[p.id] || []) }))
      .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, n);
  }
  /** a short reason line for a similar play */
  function whySimilar(a, b, flagDefs = {}) {
    const r = [];
    if (a.bases === b.bases) r.push(basesLabel(a.bases));
    if (a.outs === b.outs) r.push(outsLabel(a.outs));
    if (a.event === b.event) r.push(b.eventLabel);
    const shared = a.flags.filter((x) => b.flags.includes(x) && OUTCOME_GROUPS.has((flagDefs[x] || {}).group)).map((x) => flagDefs[x].label);
    return r.concat(shared.slice(0, 3)).join(" · ");
  }

  /* ------------------------------------------- situation conflicts
     Base-out constraints that can't all be true at once (e.g. "Runner on 3rd only" + "Double-play situation").
     Checked against all 24 base-out states; the smallest conflicting pairs are reported with their labels so
     the page can offer one-tap fixes. Nothing is changed silently. */
  const ALL_STATES = [];
  ["___", "1__", "_2_", "__3", "12_", "1_3", "_23", "123"].forEach((c) => [0, 1, 2].forEach((o) => ALL_STATES.push([c, o])));
  const SIT_FLAGS = {
    bases_empty: (c) => c === "___", risp: (c) => c[1] === "2" || c[2] === "3", force_available: (c) => c[0] === "1",
    dp_situation: (c, o) => c[0] === "1" && o < 2, two_outs: (c, o) => o === 2,
    tying_run_on: (c) => c !== "___", go_ahead_on: (c) => c !== "___", winning_run_on: (c) => c !== "___",
  };
  function situationConstraints(f, flagDefs = {}) {
    const out = [], sel = (f.bases && f.bases.sel) || [];
    if (f.bases && f.bases.mode === "exact") {
      const want = (sel.includes(1) ? "1" : "_") + (sel.includes(2) ? "2" : "_") + (sel.includes(3) ? "3" : "_");
      out.push({ id: "bases", label: want === "___" ? "Bases empty" : basesLabel(want) + " only", test: (c) => c === want });
    } else if (f.bases && f.bases.mode === "includes" && sel.length) {
      out.push({ id: "bases", label: "At least a runner on " + sel.map(ORD).join(" & "), test: (c) => sel.every((b) => c[b - 1] !== "_") });
    }
    if (f.outs && f.outs.length) out.push({ id: "outs", label: f.outs.map(outsLabel).join(" or "), test: (c, o) => f.outs.includes(o) });
    if (f.runners && f.runners.length) out.push({ id: "runners", label: f.runners.join("/") + " runner" + (f.runners.join() === "1" ? "" : "s") + " on base", test: (c) => f.runners.includes(runnersN(c)) });
    (f.flags || []).forEach((fl) => { if (SIT_FLAGS[fl]) out.push({ id: "flag:" + fl, label: (flagDefs[fl] || {}).label || fl, test: SIT_FLAGS[fl] }); });
    return out;
  }
  /** [] when the base-out filters can be satisfied; otherwise conflicting pairs [{a, b}] (constraint objects) */
  function conflicts(f, flagDefs) {
    const cs = situationConstraints(f, flagDefs);
    const sat = (list) => ALL_STATES.some(([c, o]) => list.every((x) => x.test(c, o)));
    if (sat(cs)) return [];
    const pairs = [];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (!sat([cs[i], cs[j]])) pairs.push({ a: cs[i], b: cs[j] });
    if (!pairs.length) pairs.push({ a: cs[cs.length - 2], b: cs[cs.length - 1], more: true });
    return pairs;
  }
  /** quick situations: what a shortcut sets, and whether it is currently "on" */
  const PRESETS = {
    risp: { label: "RISP", on: (f) => f.flags.includes("risp"), apply: (f, on) => toggleFlag(f, "risp", on) },
    dp: { label: "Double-play situation", on: (f) => f.flags.includes("dp_situation"), apply: (f, on) => toggleFlag(f, "dp_situation", on) },
    loaded: { label: "Bases loaded", on: (f) => f.bases.mode === "exact" && f.bases.sel.length === 3, apply: (f, on) => setBases(f, on ? [] : [1, 2, 3], on) },
    third: { label: "Runner on 3B", on: (f) => f.bases.mode === "exact" && f.bases.sel.join() === "3", apply: (f, on) => setBases(f, on ? [] : [3], on) },
    twoouts: { label: "Two outs", on: (f) => f.outs.join() === "2" || f.flags.includes("two_outs"), apply: (f, on) => { f.outs = on ? [] : [2]; toggleFlag(f, "two_outs", true); } },
    onerun: { label: "One-run game", on: (f) => f.flags.includes("one_run"), apply: (f, on) => toggleFlag(f, "one_run", on) },
    empty: { label: "Bases empty", on: (f) => f.bases.mode === "exact" && !f.bases.sel.length, apply: (f, on) => setBases(f, [], on, true) },
    anyon: { label: "Any runner on", on: (f) => f.runners.join() === "1,2,3", apply: (f, on) => { f.runners = on ? [] : [1, 2, 3]; if (!on && f.bases.mode === "exact" && !f.bases.sel.length) f.bases = { mode: "any", sel: [] }; } },
    force: { label: "Force available", on: (f) => f.flags.includes("force_available"), apply: (f, on) => toggleFlag(f, "force_available", on) },
    firstsecond: { label: "1st & 2nd", on: (f) => f.bases.mode === "exact" && f.bases.sel.join() === "1,2", apply: (f, on) => setBases(f, on ? [] : [1, 2], on) },
    corners: { label: "1st & 3rd", on: (f) => f.bases.mode === "exact" && f.bases.sel.join() === "1,3", apply: (f, on) => setBases(f, on ? [] : [1, 3], on) },
    nooutsrisp: { label: "RISP, nobody out", on: (f) => f.flags.includes("risp") && f.outs.join() === "0", apply: (f, on) => { toggleFlag(f, "risp", on); f.outs = on ? [] : [0]; } },
    tying: { label: "Tying run on base", on: (f) => f.flags.includes("tying_run_on"), apply: (f, on) => toggleFlag(f, "tying_run_on", on) },
    goahead: { label: "Go-ahead run on base", on: (f) => f.flags.includes("go_ahead_on"), apply: (f, on) => toggleFlag(f, "go_ahead_on", on) },
    walkoff: { label: "Walk-off situation", on: (f) => f.flags.includes("walkoff_situation"), apply: (f, on) => toggleFlag(f, "walkoff_situation", on) },
    highlev: { label: "High leverage", on: (f) => f.flags.includes("high_leverage"), apply: (f, on) => toggleFlag(f, "high_leverage", on) },
  };
  function toggleFlag(f, fl, on) { const i = f.flags.indexOf(fl); if (on && i >= 0) f.flags.splice(i, 1); else if (!on && i < 0) f.flags.push(fl); }
  /** a base preset defines occupancy exactly; a runner count that contradicts it is cleared (and only that) */
  function setBases(f, sel, on, emptyPreset) {
    if (on) { f.bases = { mode: "any", sel: [] }; return; }
    f.bases = { mode: "exact", sel: sel.slice() };
    if (f.runners.length && !f.runners.includes(sel.length)) f.runners = [];
    if (emptyPreset) { ["risp", "force_available", "dp_situation", "tying_run_on", "go_ahead_on", "winning_run_on"].forEach((x) => toggleFlag(f, x, true)); }
  }
  const situationSummary = (f) => {
    const sel = f.bases.sel || [];
    const r = f.bases.mode === "any" ? (f.runners.length ? f.runners.join("/") + " on base" : "Any") :
      f.bases.mode === "exact" ? (sel.length === 3 ? "Bases loaded" : sel.length ? sel.map(ORD).join(" & ") + " only" : "Bases empty") : (sel.length ? "at least " + sel.map(ORD).join(" & ") : "Any");
    const o = f.outs.length ? f.outs.slice().sort().join(" or ") : "Any";
    return { runners: r, outs: o };
  };

  /* -------------------------------------------------- URL state (filters) */
  function encodeFilters(f) {
    const d = emptyFilters(), o = {};
    Object.keys(f).forEach((k) => { if (JSON.stringify(f[k]) !== JSON.stringify(d[k])) o[k] = f[k]; });
    return Object.keys(o).length ? encodeURIComponent(JSON.stringify(o)) : "";
  }
  function decodeFilters(s) {
    const f = emptyFilters();
    if (!s) return f;
    try { const o = JSON.parse(decodeURIComponent(s)); Object.keys(o).forEach((k) => { if (k in f) f[k] = o[k]; }); } catch (e) { /* ignore bad links */ }
    return f;
  }

  return { ORD, halfLabel, batScore, fldScore, diff, phase, runnersN, basesLabel, outsLabel, battingTeam, fieldingTeam, POS, LOC_NAME, OR_GROUPS,
    emptyFilters, matches, filter, cameras, CAMERA_LABEL, hhStatusOf, HH_STATUS_LABEL, facets, parseQuery, conflicts, situationConstraints, PRESETS, situationSummary, similarity, similar, whySimilar, encodeFilters, decodeFilters, wpaBat, nameHit };
});
