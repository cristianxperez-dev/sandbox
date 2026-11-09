/* ==========================================================================
   Manager Hub — Describe Your Day: built-in reader
   Deterministic baseball reader (no model). Text → DayRequest (IR, §4 of
   manager-hub/DAY-ENGINE.md); follow-up text → EditOp[]. The optional model
   interpreter produces the same IR; this one is always available offline and
   is labelled "Built-in reader" in the UI.

   How it reads: the text is normalised (dictation, number words, typos), then
   durations and clock times become tokens, then baseball phrases become
   activity tokens from the lexicon, then small rules over the token string
   bind times, lengths, rounds, buffers and sequencing. Whatever is left that
   isn't filler is reported in `unknown` — never silently dropped.
   Times are minutes after midnight. Helpers are copied (not imported) from
   engine.js so the modules stay independent.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DayRead = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uniq = (a) => [...new Set(a)];
  const cap = (s) => String(s || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());

  /* ------------------------------------------------- speech (from engine.js) */
  const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, ninety: 90 };
  const NUMWORD = "(?:" + [...Object.keys(TENS), ...Object.keys(UNITS)].join("|") + ")";
  function wordNum(w) {
    const parts = String(w).toLowerCase().split(/[\s-]+/);
    let n = 0;
    for (const p of parts) { if (p in TENS) n += TENS[p]; else if (p in UNITS) n += UNITS[p]; else return null; }
    return n;
  }
  function normalizeSpeech(text) {
    let t = " " + String(text || "") + " ";
    t = t.replace(/\b([ap])\s*\.\s*m\s*\.?/gi, (m, a) => a.toLowerCase() + "m");
    t = t.replace(/\b(\d{1,2})\s*\.\s+(\d{2})\b(?!\s*(?:off|free|min|mins|minutes?|-?minute))/gi, "$1:$2");
    t = t.replace(/\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/gi, "$1:$2 $3");
    t = t.replace(/\bat\s+(\d{1,2})\s+(\d{2})\b(?!\s*min)/gi, "at $1:$2");
    t = t.replace(/\b(an?|one)\s+hour\s+and\s+a\s+half\b/gi, "90 minutes");
    t = t.replace(/\bhour and a half\b/gi, "90 minutes");
    t = t.replace(/\bhalf\s+(?:an\s+)?hour\b/gi, "30 minutes");
    t = t.replace(/\b(?:an|one)\s+hour\b/gi, "60 minutes");
    t = t.replace(/\b(\d+)\s+hours?\b/gi, (m, h) => `${h * 60} minutes`);
    t = t.replace(new RegExp("\\bquarter\\s+(?:past|after)\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => `${wordNum(h) ?? +h}:15`);
    t = t.replace(new RegExp("\\bhalf\\s+past\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => `${wordNum(h) ?? +h}:30`);
    t = t.replace(new RegExp("\\bquarter\\s+(?:to|of|till)\\s+(" + NUMWORD + "|\\d{1,2})\\b", "gi"), (m, h) => { const n = (wordNum(h) ?? +h) - 1; return `${n < 1 ? 12 : n}:45`; });
    t = t.replace(new RegExp("\\b(" + NUMWORD + "|\\d{1,2})\\s+(?:oh|o)\\s+(one|two|three|four|five|six|seven|eight|nine|\\d)\\b", "gi"),
      (m, h, mm) => { const H = wordNum(h) ?? +h, M = wordNum(mm) ?? +mm; return H >= 1 && H <= 12 && M >= 0 && M <= 9 ? `${H}:0${M}` : m; });
    t = t.replace(new RegExp("\\b(" + NUMWORD + ")\\s+(" + NUMWORD + "(?:[\\s-]" + NUMWORD + ")?|o'?clock|hundred)\\b(?!\\s*(?:min|minutes|groups?|fields?|cages?|stations?|times?|off|rounds?))", "gi"),
      (m, h, mm) => {
        const H = wordNum(h); if (H == null || H < 1 || H > 12) return m;
        if (/o'?clock|hundred/i.test(mm)) return `${H}:00`;
        const M = wordNum(mm); if (M == null || M < 10 || M > 59) return m;
        return `${H}:${String(M).padStart(2, "0")}`;
      });
    t = t.replace(new RegExp("\\b(" + NUMWORD + "(?:[\\s-]" + NUMWORD + ")?)\\s+(min(?:ute)?s?|groups?|fields?|cages?|mounds?|stations?|times|coaches|rounds?)\\b", "gi"),
      (m, n, w) => { const v = wordNum(n); return v == null ? m : `${v} ${w}`; });
    t = t.replace(new RegExp("\\b(?:at|by|around)\\s+(" + NUMWORD + ")\\b(?!\\s*(?:min|groups?))", "gi"), (m, h) => { const v = wordNum(h); return v && v <= 12 ? m.replace(h, String(v)) : m; });
    t = t.replace(/\s+([,.;!?])/g, "$1").replace(/([,.;!?]){2,}/g, "$1");
    return t.replace(/[ \t]{2,}/g, " ").trim();
  }

  /* ------------------------------------------------------------ normalise */
  const TYPOS = [
    [/\bfund(?:y|ie|ee|i)e?s?\b/g, "fundy"],
    [/\bind(?:y|ie|ee|i)e?s?\b/g, "indy"],
    [/\bp\.?f\.?p\.?s?\b/g, "pfp"],
    [/\bb\.\s?p\.(?=\s|$|,)/g, "bp"],
    [/\bb\.?\s?p\.?s?\b(?!\.\w)/g, "bp"],
    [/\b(?:strech|stetch|strtch|stretc|streach|sretch)\b/g, "stretch"],
    [/\b(?:defence|deffense|defens|defnse|defese)\b/g, "defense"],
    [/\b(?:condtioning|conditoning|conditionning)\b/g, "conditioning"],
    [/\bbase ?runn?(?:ing|in)\b/g, "baserunning"],
    [/\bpractise\b/g, "practice"],
    [/\bbull ?pens?\b/g, "bullpens"],
    [/\bpre[- ]game\b/g, "pregame"],
    [/\bpost[- ]game\b/g, "postgame"],
    [/\bwarm[- ]ups?\b/g, "warmup"],
    [/\bgame ?time\b/g, "gametime"],
    [/\bon[- ]field (?=bp|hitting|batting)/g, "onfield "],
    [/\bfirst pitches\b/g, "first pitch"],
    [/\bgms?\b/g, "game"],
    [/\bx\s?(\d)\b(?!\s*(?:groups?|rounds?))/g, " $1 groups"],
    [/\bx\s?(\d)\b/g, " $1"],
    [/\b(\d)\s?x\b(?!\s*(?:a|per)\s+week)(?!\s*(?:groups?|rounds?))/g, "$1 groups"],
    [/\bgrps?\b/g, "groups"],
    [/\brnds?\b/g, "rounds"],
    [/\b(?:tmrw|tmw|tmrrw|tomorow|tommorow)\b/g, "tomorrow"],
    [/\bgames (?=at\b|is\b)/g, "game "],
    [/\b(groups|rounds) (\d{2})s\b/g, "$1 $2 minutes"],
    [/\bbetween (\d{1,2}(?::\d{2})?) and (\d{1,2}(?::\d{2})?)\b/g, ", window from $1 to $2"]
  ];
  function numWords(t) {
    const unit1to9 = "one|two|three|four|five|six|seven|eight|nine";
    t = t.replace(new RegExp(`\\b(twenty|thirty|forty|fourty|fifty|sixty|ninety)[\\s-](${unit1to9})\\b`, "g"), (m, a, b) => String(TENS[a] + UNITS[b]));
    const words = [...Object.keys(TENS), ...Object.keys(UNITS)].filter((w) => !["one", "oh", "zero"].includes(w));
    t = t.replace(new RegExp(`\\b(${words.join("|")})\\b`, "g"), (w) => String(UNITS[w] ?? TENS[w]));
    t = t.replace(/\bone(?=\s*(?:am|pm|o'?clock|:|minutes?|mins?|more|hour|groups?|rounds?|off\b))/g, "1");
    t = t.replace(/\b(at|by|until|till|game|pitch|around|is)\s+one\b/g, "$1 1");
    return t;
  }
  /** Lower-case, dictation and typo cleanup. Times keep their colon; nothing else is interpreted. */
  function normalize(text) {
    let t = String(text || "");
    t = t.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[⟨⟩]/g, " ");
    t = t.replace(/\b(\d+\.\d+)\s*(?:hours?|hrs?)\b/gi, (m, n) => `${Math.round(+n * 60)} minutes`);
    t = t.replace(/\b(\d+)\s*hrs?\b/gi, (m, n) => `${+n * 60} minutes`);
    t = normalizeSpeech(t).toLowerCase();
    t = numWords(t);
    t = t.replace(/\bo'?clock\b/g, "").replace(/'/g, "");
    for (const [re, to] of TYPOS) t = t.replace(re, to);
    t = t.replace(/\b(\d{1,2})\.(\d{2})\b/g, "$1:$2");                // 6.05 → 6:05
    t = t.replace(/[&+]/g, " and ").replace(/([a-z])\/([a-z])/g, "$1 $2").replace(/\s+\/\s+/g, " / ");
    t = t.replace(/\s*(?:->|=>|→|>)\s*/g, " then ").replace(/\s+[-–—]+\s+/g, ", ");
    t = t.replace(/:(?!\d)/g, ",").replace(/["(){}\[\]*_#]/g, " ").replace(/\n+/g, ". ");
    return t.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
  }

  /* ----------------------------------------------------------------- time */
  // Practice rule (the sheet's): 6–11 morning, 12 noon, 1–5 afternoon.
  // Game rule: 12–10 afternoon/evening (bare 1–10 = PM), 11 = 11 AM.
  function hourFor(h, mer, role) {
    if (mer === "a") return h === 12 ? 0 : h;
    if (mer === "p") return h < 12 ? h + 12 : 12;
    if (h > 12) return h;
    if (role === "game") return h >= 1 && h <= 10 ? h + 12 : h;
    return h >= 1 && h <= 5 ? h + 12 : h;
  }
  function clockParts(str) {
    const s = String(str || "").trim().toLowerCase();
    if (/^(?:noon|midday)\b/.test(s)) return { h: 12, m: 0, mer: "p", raw: s };
    if (/^midnight\b/.test(s)) return { h: 12, m: 0, mer: "a", raw: s };
    let m = s.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm|a|p)?$/);
    if (m) { const h = +m[1], mm = +m[2]; if (h > 23 || mm > 59) return null; return { h, m: mm, mer: m[3] ? m[3][0] : null, raw: s }; }
    m = s.match(/^(\d{3,4})\s*(am|pm|a|p)?$/);
    if (m) { const d = m[1], h = +d.slice(0, -2), mm = +d.slice(-2); if (h < 1 || h > 12 || mm > 59) return null; return { h, m: mm, mer: m[2] ? m[2][0] : null, raw: s }; }
    m = s.match(/^(\d{1,2})\s*(am|pm|a|p)?$/);
    if (m) { const h = +m[1]; if (h < 1 || h > 23 || (h > 12 && m[2])) return null; return { h, m: 0, mer: m[2] ? m[2][0] : null, raw: s }; }
    return null;
  }
  const clockValue = (p, role) => (p ? hourFor(p.h, p.mer, role) * 60 + p.m : null);
  /** "10 AM", "2:30", "noon", "6:05", "330", "ten am" → minutes. role "game" reads bare 1–10 as PM. Durations → null. */
  function parseClock(str, role = "practice") {
    const t = normalize(str).replace(/^(?:at|by|@)\s*/, "");
    return clockValue(clockParts(t), role);
  }
  /** "30-minute", "45 min", "an hour", "hour and a half", "1.5 hours", "for 90", "30 off" → minutes. Clock times / bare numbers → null. */
  function parseDuration(str) {
    const t = normalize(str);
    let m = t.match(/\b(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?|min)\b/) || t.match(/\b(\d{1,3})m\b/);
    if (m) return +m[1];
    m = t.match(/^for\s+(\d{1,3})$/) || t.match(/^(\d{1,3})\s+(?:off|free)$/);
    return m ? +m[1] : null;
  }
  const fmt = (x) => { const H = Math.floor(x / 60), m = x % 60; return (H % 12 || 12) + ":" + String(m).padStart(2, "0") + (H < 12 ? " AM" : " PM"); };

  /* -------------------------------------------------------------- lexicon
     Order matters: specific phrases first. `alias` items ("defense",
     "hitting", "stations") merge into a specific item of the same family
     when one was named, and otherwise stand with a note. */
  const L = (re, kind, label, extra = {}) => Object.assign({ re, kind, label, who: null }, extra);
  const LEX = [
    L("live (?:bp|batting practice|abs?|at ?bats?)", "liveBp", "Live BP", { ex: ["live BP", "live ABs", "live at-bats"] }),
    L("early (?:defense|d)\\b", "earlyWork", "Early Defense", { ex: ["early defense"] }),
    L("early (?:work|hitting|cage|bp|swings)", "earlyWork", "Early Work", { ex: ["early work", "early hitting"] }),
    L("extra (?:work|hitting|defense|swings)", "earlyWork", "Extra Work", { ex: ["extra work"] }),
    L("pitchers? (?:fielding practice|fielding)|pfp|comebackers", "pfp", "PFP", { who: "pitchers", ex: ["PFP", "PFPs", "pitchers fielding practice", "comebackers"] }),
    L("(?:hitters|hitting|position players?) meeting", "meeting", "Hitters' Meeting", { who: "position", ex: ["hitters' meeting"] }),
    L("pitch(?:ers|ing) meeting", "meeting", "Pitchers' Meeting", { who: "pitchers", ex: ["pitchers' meeting"] }),
    L("(?:team |staff |coaches |full )?meeting", "meeting", "Team Meeting", { ex: ["meeting", "team meeting"] }),
    L("pregame meal", "meal", "Pregame Meal", { ex: ["pregame meal"] }),
    L("lunch|breakfast|spread|snacks?|dinner|meal", "meal", (m) => cap(m), { ex: ["lunch", "spread", "breakfast"] }),
    L("postgame (?:lift|meeting|work|conditioning|stretch|running)|postgame", "postgame", (m) => cap(m), { ex: ["postgame", "postgame lift"] }),
    L("stretch and throw(?:ing)?", null, null, { multi: [["stretch", "Stretch"], ["throwing", "Throwing"]], ex: ["stretch and throw"] }),
    L("(?:onfield |team )?bp|batting practice|onfield hitting|hits? on the field|hitting on the field", "bp", "BP", { ex: ["BP", "batting practice", "on-field BP"] }),
    L("(?:hitting|cage) stations|stations? hitting|indoor hitting|hitting indoors|cage (?:work|hitting|rounds|time|groups?)|cages?|tunnels?", "cage", (m) => /station/.test(m) ? "Hitting Stations" : /indoor/.test(m) ? "Indoor Hitting" : "Cage", { ex: ["cage", "cage work", "hitting stations", "indoor hitting"] }),
    L("tees? (?:and )?flips|tee work|flips|tees?|front toss|soft toss", "cage", (m) => /flip/.test(m) ? "Tee & Flips" : cap(m), { ex: ["tee/flips", "tee work", "front toss"] }),
    L("machine(?: work| hitting| rounds)?", "cage", "Machine", { ex: ["machine"] }),
    L("catch(?:ers|er) (?:work|drills|defense|d|blocking|receiving)|catching (?:work|drills)|blocking and receiving|blocking|receiving", "indDefense", "Catchers' Work", { who: "catchers", ex: ["catchers' work"] }),
    L("defen[cs]e stations|defensive stations", "indDefense", "Defensive Stations", { ex: ["defensive stations", "defense stations"] }),
    L("indy(?: (?:defense|def|d|work|stations))?|individual (?:defense|def|d|work)|defensive individuals?|positional (?:work|defense)|(?:infield|outfield) (?:work|defense|drills)", "indDefense", "Individual Defense", { ex: ["indy", "indy D", "individual defense", "defensive stations", "infield work"] }),
    L("team (?:fundy|fundamentals|defense|d)\\b|fundy|fundamentals", "teamDefense", "Team Fundamentals", { ex: ["team fundy", "fundies", "fundamentals", "team defense"] }),
    L("cuts? (?:and )?relays?|cr", "teamDefense", "Cuts & Relays", { ex: ["cuts and relays", "CR"] }),
    L("team(?=\\s*(?:then|and|,)\\s*(?:indy|⟨a\\d+⟩))", "teamDefense", "Team Defense", { ex: ["team then indy"] }),
    L("rundowns?", "teamDefense", "Rundowns", { ex: ["rundowns"] }),
    L("bunt (?:plays|defense|coverages?|d)", "teamDefense", "Bunt Plays", { ex: ["bunt plays"] }),
    L("pick ?offs?(?: plays)?", "teamDefense", "Pickoffs", { ex: ["pickoffs"] }),
    L("1st and 3rd(?: defense)?|first and third(?: defense)?", "teamDefense", "1st & 3rd", { ex: ["1st and 3rd"] }),
    L("(?:team )?situations|situational defense", "teamDefense", "Situations", { ex: ["situations"] }),
    L("bullpens?|pens?|side sessions?", "bullpen", "Bullpens", { who: "pitchers", ex: ["pens", "bullpens", "side sessions"] }),
    L("pitch(?:ers|er|ing) (?:throw(?:ing)?|program|work|catch play|play catch|long toss)(?: (?:program|programs|schedules?))?|pitchers? on (?:their )?throwing (?:schedules?|programs?)|arm care|recovery throws?", "pitcherWork", "Pitchers' Throwing", { who: "pitchers", ex: ["pitchers throw", "arm care", "pitchers' program"] }),
    L("(?:pitch(?:ers|er|ing staff)|arms|staff arms|bullpen arms)\\s+(?:will\\s+|can\\s+|should\\s+)?(?:do|on|get|handle|take care of|go through|work on|work through|stay on|follow|have)\\s+(?:all\\s+)?(?:their|his|the)\\s+(?:own\\s+)?(?:thing|things|program|programs|stuff|work|routine|routines|day|business|schedule|schedules|throwing|arm care|plan|progression)(?:\\s+in|\\s+done)?|pitchers? (?:are )?on their own|pitchers? (?:do their |get their )?work(?: in)?", "pitcherWork", "Pitchers' Program", { who: "pitchers", ex: ["pitchers do their thing", "pitchers on their program", "arms get their work in"] }),
    L("long toss|lt", "throwing", "Long Toss", { ex: ["long toss", "LT"] }),
    L("catch play|play catch", "throwing", "Catch Play", { ex: ["catch play"] }),
    L("throwing (?:progression|program)", "throwing", "Throwing Program", { ex: ["throwing progression"] }),
    L("throw(?:s|ing)?", "throwing", "Throwing", { ex: ["throw", "everybody throws"] }),
    L("baserunning|speed work|jumps|secondary leads|leads(?: and (?:jumps|secondaries))?|base ?stealing|steals", "baserunning", (m) => /speed/.test(m) ? "Speed Work" : "Baserunning", { ex: ["baserunning", "speed work", "jumps"] }),
    L("(?:team )?stretch(?:ing)?", "stretch", "Stretch", { ex: ["stretch", "team stretch"] }),
    L("activation|movement prep|dynamics?(?: warmup)?|warmup|band work|prehab", "activation", (m) => /dynamic/.test(m) ? "Dynamic Warm-up" : /warmup/.test(m) ? "Warm-up" : cap(m), { ex: ["activation", "dynamic", "movement prep"] }),
    L("pitch(?:ers|er) (?:run|running)", "conditioning", "Running", { who: "pitchers", ex: ["pitchers run"] }),
    L("conditioning|sprints|running|lift(?:ing)?|weights|weight room|strength(?: work)?|agility", "conditioning", (m) => /lift|weight|strength/.test(m) ? "Lift" : cap(m), { ex: ["conditioning", "lift", "sprints"] }),
    L("report(?:ing)?(?: time)?|arrival|arrive", "arrival", "Report", { ex: ["report at", "arrive"] }),
    L("intrasquad(?: game)?|scrimmage|sim(?:ulated)? games?|controlled scrimmage", "custom", (m) => cap(m), { ex: ["intrasquad", "scrimmage", "sim game"] }),
    L("video(?: session)?|film(?: session)?|media(?: session)?|photo day|scouting reports?|community event|bus", "custom", (m) => cap(m), { ex: ["video", "media", "bus"] }),
    L("defensive (?:work|session|block|day)|defen[cs]e|defensive|team d\\b", "teamDefense", "Defense", { alias: "defense", ex: ["defense"] }),
    L("hitting|swings|offense", "bp", "Hitting", { alias: "hitting", ex: ["hitting"] }),
    L("stations", "indDefense", "Stations", { alias: "stations", ex: ["stations"] }),
    // second pass (after "30 off" / "off pregame" are read)
    L("free time|down ?time|rest|break|time off", "free", "Free Time", { pass: 2, ex: ["free time", "down time", "30 off"] }),
    L("pregame(?: prep| routine)?|clubhouse time|dress|transition", "pregamePrep", "Pregame Prep", { pass: 2, ex: ["pregame", "clubhouse time"] })
  ];
  const DEFAULT_WHO = { arrival: "all", meeting: "all", meal: "all", earlyWork: "position", activation: "all", stretch: "all", throwing: "all",
    teamDefense: "all", indDefense: "position", pfp: "pitchers", bullpen: "pitchers", pitcherWork: "pitchers", baserunning: "position",
    bp: "position", cage: "position", liveBp: "all", conditioning: "all", free: "all", pregamePrep: "all", game: "all", postgame: "all", custom: "all" };
  const HIT = ["bp", "cage", "liveBp"], DEF = ["teamDefense", "indDefense"];
  const lexicon = LEX.map((e) => ({ kind: e.kind || e.multi.map((x) => x[0]).join("+"), who: e.who || (e.kind ? DEFAULT_WHO[e.kind] : "all"),
    label: typeof e.label === "function" ? "(as written)" : e.label || null, pattern: e.re, examples: e.ex || [], alias: e.alias || null }))
    .concat([{ kind: "game", who: "all", label: "Game", pattern: "first pitch|gametime|games?", examples: ["game at 6", "first pitch 6:05"], alias: null }]);

  /** The best lexicon match for a short phrase (edit targets, "add …"). */
  function matchActivity(phrase) {
    const p = " " + String(phrase || "").trim() + " ";
    if (/\b(?:first pitch|gametime|games?)\b/.test(p) && !/\b(?:pregame|postgame)\b/.test(p)) return { kind: "game", who: "all", label: "Game" };
    for (const e of LEX) {
      const m = p.match(new RegExp("\\b(?:" + e.re + ")\\b"));
      if (!m) continue;
      if (e.multi) return { kind: e.multi[0][0], who: "all", label: e.multi[0][1] };
      return { kind: e.kind, who: e.who || DEFAULT_WHO[e.kind], label: typeof e.label === "function" ? e.label(m[0]) : e.label, alias: e.alias || null };
    }
    return null;
  }
  const whoWord = (w) => (/^pitch/.test(w) ? "pitchers" : /^catch/.test(w) ? "catchers" : "position");

  /* ----------------------------------------------------------- the reader */
  const FILLER = new Set(("a an the and or then with make makes making build create plan put set up schedule day today tomorrow tonight please " +
    "we our us i im me you lets let want need needs should can could would will be is are was have has had do does get go going gonna its it this that " +
    "these those them there here also plus just some time times so but if for of to at by on in from around about approximately roughly before after " +
    "into than ok okay yeah all everyone everybody guys players team club squad morning afternoon evening practice workout session sessions keep " +
    "move both each while during like give us good full normal regular usual our typical standard expected forecast quick hey thanks thank " +
    "night road home matinee travel oh everything done first last somewhere anywhere together need tomorrow tonight then hit hits are field " +
    "starts begins goes runs happens kicks kick well we'll were rounds groups round group gotta gonna going should has got go").split(" "));
  const EDIT_START = /^(?:add|move|push|pull|drop|remove|delete|skip|shorten|lengthen|extend|give|start|keep|lock|run|swap|switch|bump|slide|shift|delay|finish|set|change|scratch|hold|include|squeeze|trim|reduce|increase|make everything|cut|take)\b/;

  function emptyRequest() {
    return { version: 1, source: "reader", dayType: null, level: null, weather: null,
      anchors: { start: null, end: null, firstPitch: null, offBeforeGame: null }, offBefore: [], groups: { hitting: null, pitchers: null },
      activities: [], emphasis: [], base: null, edits: [], notes: [], unknown: [] };
  }

  function read(text, ctx = {}) {
    ctx = ctx || {};
    const out = emptyRequest();
    let W = normalize(text);
    if (!W) { out.notes.push("Nothing to read."); return out; }

    /* ---- relative requests: "same as yesterday but …" */
    const base = W.match(/^(?:(?:the\s+)?same\s+(?:schedule\s+|thing\s+|plan\s+)?as|same\s+as|like|repeat|copy|run back|redo|do)\s+(yesterday(?:s)?|the day before|last time|today(?:s)?|the current(?: schedule| plan| day)?|this(?: schedule| plan)?|current(?: schedule| plan)?)(?:\s+(?:schedule|plan|day))?\s*[,.]?\s*(?:but|except|with|and|only|,)?\s*(.*)$/);
    const tmpl = W.match(/^(?:use|start from|from)\s+(?:the\s+)?(.+?)\s+template\b\s*[,.]?\s*(?:but|except|with|and)?\s*(.*)$/);
    if (base || tmpl) {
      const ref = tmpl ? "template" : /yesterday|day before|last time/.test(base[1]) ? "yesterday" : "current";
      out.base = tmpl ? { ref, name: tmpl[1].trim() } : { ref };
      const srcReq = ref === "yesterday" ? ctx.yesterday : ref === "current" ? ctx.current : null;
      const rest = (tmpl ? tmpl[2] : base[2]) || "";
      if (rest.trim()) {
        const r = readEditDetailed(rest, srcReq || null, null, ctx);
        out.edits = r.ops; out.notes.push(...r.notes); out.unknown.push(...r.unknown);
      }
      if (/\brain|storm|weather/.test(W)) out.weather = "rain";
      return out;
    }

    /* ---- rain against an existing draft: emit edits on the current request */
    const rainRe = /\b(?:rain(?:y|ing|s)?(?:\s+(?:expected|coming|in the forecast|later|this afternoon|this morning|today|tomorrow))?|storms?(?:\s+(?:expected|coming))?|thunderstorms?|lightning|bad weather|weather(?:\s+(?:expected|coming))?|wet field)\b/g;
    if (rainRe.test(W) && ctx.current && /\b(?:move|keep|shorten|cut|push|indoors?|inside)\b/.test(W)) {
      out.weather = "rain"; out.base = { ref: "current" };
      const r = readEditDetailed(W.replace(rainRe, " "), ctx.current, null, ctx);
      out.edits = r.ops; out.notes.push(...r.notes); out.unknown.push(...r.unknown);
      return out;
    }

    const st = { d: [], c: [], acts: [], g: [], notes: [], unknown: [], startClock: null, endClock: null, gameClock: null,
      offBeforeGame: null, offBefore: [], parallel: [], roundsCount: null, emphasis: [], light: false, dayType: null, gameDay: false, groupsPitchers: null, hitGroups: null };
    const tok = (type, obj) => { st[type].push(obj); return ` ⟨${type}${st[type].length - 1}⟩ `; };
    const note = (s) => { if (!st.notes.includes(s)) st.notes.push(s); };
    const rep = (re, fn) => { W = W.replace(re, fn); };

    /* ---- durations (a number before minutes/min/off is never a clock) */
    rep(/\b(\d{1,3})\s*(?:-\s*)?(minutes?|mins?|min)\b/g, (m, n, u) => tok("d", { min: +n, adj: /-/.test(m) || u === "minute", raw: m }));
    rep(/\b(\d{1,3})m\b/g, (m, n) => tok("d", { min: +n, adj: false, raw: m }));
    rep(/\b(off|free)\s+(\d{1,3})\b(?!\s*(?::|am|pm))/g, (m, w, n) => +n >= 5 ? tok("d", { min: +n, adj: false, raw: m }) + w : m);
    rep(/\b(\d{1,3})(?=\s+(?:off|free)\b)/g, (m, n) => +n >= 5 ? tok("d", { min: +n, adj: false, raw: m + " off" }) : m);
    rep(/\bfor\s+(\d{1,3})\b(?!\s*(?:am|pm|a|p|:|groups?|rounds?|guys|players|hitters|pitchers|innings?|reps|pitches|swings|throws))/g, (m, n) => +n >= 5 ? "for" + tok("d", { min: +n, adj: false, raw: m }) : m);
    rep(/\b(\d{1,3})(?=\s+(?:each|apiece|a round|per round|per group|a group|a piece)\b)/g, (m, n) => +n >= 5 ? tok("d", { min: +n, adj: false, raw: m + " each" }) : m);
    rep(/\b(groups?\s+(?:of|at)\s+)(\d{2,3})\b(?!\s*(?:hitters|guys|players|kids|:|am|pm))/g, (m, w, n) => " groups " + tok("d", { min: +n, adj: false, raw: m }) + " each ");
    rep(/\b(rounds?\s+(?:of|at)\s+)(\d{1,3})\b(?!\s*(?::|am|pm))/g, (m, w, n) => w + tok("d", { min: +n, adj: false, raw: m }));
    rep(/\b(another|extra)\s+(\d{1,3})\b(?!\s*(?::|am|pm))/g, (m, w, n) => w + tok("d", { min: +n, adj: false, raw: m }));
    rep(/\b(\d{1,3})\s+(more|earlier|later|sooner)\b/g, (m, n, w) => tok("d", { min: +n, adj: false, raw: m }) + w);

    /* ---- clock times */
    rep(/(^|[\s,.;])(?:from\s+)?(\d{1,2}(?::\d{2})?)\s*(?:to|-|until|till|through)\s*(\d{1,2}(?::\d{2})?)\b(?!\s*(?:minutes?|mins?|min|groups?|rounds?|guys|players|innings?))/g, (m, pre, a, b) => {
      const pa = clockParts(a), pb = clockParts(b);
      if (!pa || !pb || (!/:/.test(a + b) && (+a > 12 || +b > 12))) return m;
      return `${pre} from${tok("c", pa)}to${tok("c", pb)}`;
    });
    rep(/\b(\d{1,2}):(\d{2})\s*(am|pm|a|p)?\b/g, (m) => { const p = clockParts(m.replace(/\s+/g, "")); return p ? tok("c", p) : m; });
    rep(/\b(\d{1,4})\s*(am|pm)\b/g, (m) => { const p = clockParts(m.replace(/\s+/g, "")); return p ? tok("c", p) : m; });
    rep(/\b(\d{1,4})(a|p)\b/g, (m) => { const p = clockParts(m); return p ? tok("c", p) : m; });
    rep(/\b(?:noon|midday)\b/g, () => tok("c", { h: 12, m: 0, mer: "p", raw: "noon" }));
    const COUNT = "(?:(?:groups?|rounds?|guys|players|hitters|pitchers|fields?|cages?|mounds?|stations?|times|innings?|outs|pitches|throws|swings|reps|percent)\\b|%)";
    rep(new RegExp(`(\\b(?:at|by|until|till|til|around|from|starting|start|starts|begin|begins|report|reporting|finish|done|wrap|stop|pitch|game|games|gametime|before|after|is|to)\\s+|@\\s*)(\\d{1,4})\\b(?!\\s*${COUNT})(?!(?:st|nd|rd|th)\\b)(?![:\\d])`, "g"),
      (m, kw, n) => { const p = clockParts(n); return p && (n.length > 2 || +n <= 12 || (+n <= 23 && /at|by|@/.test(kw))) ? kw + tok("c", p) : m; });
    rep(new RegExp(`\\b(\\d{3,4})\\b(?!\\s*${COUNT})(?![:\\d])`, "g"), (m, n) => { const p = clockParts(n); return p && p.m % 5 === 0 ? tok("c", p) : m; });

    /* ---- day-level phrases */
    rep(/\b(?:no games?(?:\s+(?:today|tomorrow|tonight))?|off ?day|day off|workout day|practice day|no game day|optional day)\b/g, () => { st.dayType = "workout"; return " "; });
    rep(/\bgame ?day\b/g, () => { st.gameDay = true; return " "; });
    rep(/\b(?:(?:everything|all|all work|the whole (?:day|practice|workout)|whole day|it all|we|were|we are|well be|we will be|practice|the workout|workout)\s+(?:is\s+|will be\s+|goes\s+|moves\s+|stays\s+|go\s+|move\s+|be\s+)?(?:indoors?|inside|under cover|undercover)|(?:indoor|inside) (?:day|practice|workout|only))\b(?:\s+(?:today|tomorrow))?/g, () => { st.allIndoor = true; return " "; });
    rep(/\bgetaway(?: day)?\b/g, () => { st.gameDay = true; note("Getaway day."); return " "; });
    rep(/\bpitch(?:er|ers)[- ]only(?: day)?\b|\bonly (?:the )?pitchers\b/g, () => { st.pitcherOnly = true; return " "; });
    rep(/\b(?:then\s+)?swap(?:s)?(?: groups)?\b/g, () => { st.swap = true; return " "; });
    rep(/\b(?:fcl|gcl|azl|dsl|complex(?: league)?|extended(?: spring)?|backfields?)(?: day| schedule| game)?\b/g, (m) => { out.level = "fcl"; if (/game/.test(m)) st.gameDay = true; return " "; });
    rep(/\bfull[- ]season(?: day| schedule)?\b/g, () => { out.level = "full-season"; return " "; });
    rep(/\b(?:rain(?:y|ing|s)?(?:\s+(?:expected|coming|in the forecast|later|this afternoon|this morning|today|tomorrow|day))?|storms?(?:\s+(?:expected|coming))?|thunderstorms?|lightning|bad weather|weather(?:\s+(?:expected|coming))?|wet field)\b/g, () => { out.weather = "rain"; return " "; });
    const EMPH = { defense: "defen[cs]e|defensive|fundamentals|fundy", hitting: "hitting|offensive|offense|bp", pitching: "pitching|pitchers?", conditioning: "conditioning|running" };
    for (const [k, w] of Object.entries(EMPH)) {
      rep(new RegExp(`\\b(?:(?:${w})[- ]?(?:heavy|emphasis|focus(?:ed)?|day)|heavy (?:on )?(?:${w})|emphasi[sz]e (?:${w})|focus(?: on)? (?:${w})|(?:${w}) is the (?:focus|priority))\\b(?: day)?`, "g"),
        () => { if (!st.emphasis.includes(k)) st.emphasis.push(k); return " "; });
    }
    rep(/\b(?:light|easy|short|recovery|lighter) (?:day|practice|workout|one)\b/g, () => { st.light = true; return " "; });
    const names = ((ctx.hittingGroups || []).map((n) => String(n).toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()).filter(Boolean));
    if (names.length) {
      const NM = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      rep(new RegExp(`\\b(?:groups?\\s+)?(?:${NM})(?:\\s*(?:,|and|&)\\s*(?:${NM}))*(?:\\s+groups?)?\\b`, "g"), (m) => {
        const found = names.filter((n) => new RegExp(`\\b${n}\\b`).test(m));
        st.namedGroups = uniq((st.namedGroups || []).concat(found)); return " ";
      });
    }
    rep(/\b(?:with\s+)?(?:both|all(?: the)?|all \d) (?:hitting |bp )?groups\b/g, (m) => { st.allGroups = true; if (/all (\d)/.test(m)) st.hitGroups = +m.match(/all (\d)/)[1]; return /bp/.test(m) ? " bp " : " "; });
    rep(/\b(?:pitcher|pitching) groups\b|\bpitchers in groups\b/g, () => { st.groupsPitchers = true; return " "; });
    rep(/\b(\d{1,2})\s+(?:(bp|hitting|batting|hitters?|offensive|position(?: player)?)\s+)?(groups?|rounds?)\b(?:\s+of\s+(hitters|hitting|bp|batting practice|cage))?/g, (m, n, q, w, of) => {
      n = +n; if (n < 1 || n > 9) return m;
      if (/group/.test(w)) st.hitGroups = n; else st.roundsCount = n;
      if (of && /bp|batting|cage/.test(of)) return ` ${of} rounds `;
      return (q && /bp|batting/.test(q) ? " bp " : " ") + (/round/.test(w) ? " rounds " : " ");
    });

    /* ---- activities, pass 1 */
    const mkAct = (kind, label, extra = {}) => {
      st.acts.push(Object.assign({ kind, label, who: DEFAULT_WHO[kind], generic: false, alias: null, text: "", at: null, dur: null, rounds: null,
        after: [], before: [], indoor: null, location: null, emphasis: null }, extra));
      return st.acts.length - 1;
    };
    const lexPass = (pass) => {
      for (const e of LEX) {
        if ((e.pass || 1) !== pass) continue;
        rep(new RegExp("\\b(?:" + e.re + ")\\b", "g"), (m) => {
          if (e.multi) { const ids = e.multi.map(([k, l]) => mkAct(k, l, { text: m })); st.acts[ids[1]].multiPrev = ids[0]; return ids.map((i) => ` ⟨a${i}⟩ `).join(" then "); }
          const label = typeof e.label === "function" ? e.label(m) : e.label;
          const i = mkAct(e.kind, label, { text: m, alias: e.alias || null, who: e.who || DEFAULT_WHO[e.kind] });
          if (e.alias) st.acts[i].generic = true;
          return ` ⟨a${i}⟩ `;
        });
      }
    };
    lexPass(1);
    rep(/\b(?:first pitch|gametime|games?)\b/g, (m) => tok("g", { raw: m }));
    W = W.replace(/\s+/g, " ");

    const A = "⟨a(\\d+)⟩", C = "⟨c(\\d+)⟩", D = "⟨d(\\d+)⟩", G = "⟨g(\\d+)⟩";
    const act = (i) => st.acts[+i];
    const useC = (i) => { st.c[+i].used = true; return +i; };
    const useD = (i) => { st.d[+i].used = true; return st.d[+i].min; };
    const ensureHit = () => {
      let i = -1;
      for (const k of ["bp", "cage", "liveBp"]) { if (i < 0) i = st.acts.findIndex((a) => a.kind === k && !a.alias); }
      if (i < 0) i = st.acts.findIndex((a) => HIT.includes(a.kind));
      if (i < 0) { i = mkAct("bp", "BP", { text: "(rounds)" }); W += ` ⟨a${i}⟩ `; }
      return i;
    };
    const prevAct = (str, offset, self, who) => {
      const before = str.slice(0, offset);
      const all = [...before.matchAll(/⟨a(\d+)⟩/g)].map((x) => +x[1]).filter((i) => i !== self);
      for (let k = all.length - 1; k >= 0; k--) { if (who === "pitchers" || st.acts[all[k]].who !== "pitchers") return all[k]; }
      return all.length ? all[all.length - 1] : null;
    };

    /* ---- negation: "No BP." */
    rep(new RegExp(`\\b(?:no|skip(?:ping)?|without|not doing|no need for)\\s+(?:the\\s+)?${A}`, "g"), (m, i) => { act(i).negated = true; return " "; });

    /* ---- adjacent words naming one thing merge: "defense stations", "hitting cage", "defense indy" */
    const famOf = (a) => (a.alias === "stations" || a.alias === "defense" || DEF.includes(a.kind) ? "def" : a.alias === "hitting" || ["bp", "cage"].includes(a.kind) ? "hit" : null);
    for (let pass = 0; pass < 3; pass++) {
      const was = W;
      rep(new RegExp(`${A}\\s+(?:of\\s+|for\\s+)?${A}`, "g"), (m, i, j) => {
        const a = act(i), b = act(j);
        if (a.kind === b.kind && a.who === b.who && !a.alias && !b.alias && a.kind !== "custom" && (a.at == null || b.at == null)) {
          act(j).dead = true; a.text = `${a.text} ${b.text}`; a.at = a.at ?? b.at; a.dur = a.dur ?? b.dur; return ` ⟨a${i}⟩ `;
        }
        if (!(a.alias || b.alias) || !famOf(a) || famOf(a) !== famOf(b)) return m;
        let keep = a.alias && !b.alias ? +j : +i, drop = keep === +i ? +j : +i;
        if (a.alias && b.alias && (a.alias === "stations" || b.alias === "stations")) {
          keep = a.alias === "stations" ? +i : +j; drop = keep === +i ? +j : +i;
          Object.assign(act(keep), { kind: "indDefense", label: "Defensive Stations", who: "position", alias: null, generic: false });
        }
        act(drop).dead = true;
        act(keep).text = `${a.text} ${b.text}`;
        return ` ⟨a${keep}⟩ `;
      });
      if (W === was) break;
    }

    /* ---- who prefix: "pitchers stretch", "catchers' work" */
    rep(new RegExp(`\\b(pitchers?|catchers?|hitters|position players?|position guys|position|infielders|outfielders|everybody|everyone|all players|whole team)\\s+(?:will\\s+|do\\s+|have\\s+|get\\s+|are\\s+|go\\s+(?:to\\s+)?)?(?:in\\s+|on\\s+|at\\s+)?(?:the\\s+)?${A}`, "g"), (m, w, i) => {
      if (!["meeting", "meal", "game"].includes(act(i).kind)) act(i).who = /every|all|whole/.test(w) ? "all" : whoWord(w);
      return ` ⟨a${i}⟩ `;
    });
    rep(new RegExp(`${A}\\s+((?:(?:at|@)\\s*⟨c\\d+⟩\\s+)?)(?:for\\s+)?(?:the\\s+)?(pitchers|catchers|position players|hitters|starters|relievers|bullpen guys|arms)\\b`, "g"), (m, i, keep, w) => {
      if (/starters|relievers|bullpen guys|arms/.test(w)) w = "pitchers";
      if (!["meeting", "meal", "game"].includes(act(i).kind)) act(i).who = whoWord(w);
      return ` ⟨a${i}⟩ ${keep} `;
    });

    /* ---- game time */
    const setGame = (c) => { if (st.gameClock == null) st.gameClock = useC(c); else { useC(c); note("Two game times given — used the first."); } };
    rep(new RegExp(`${G}\\s*(?:is\\s+|will be\\s+|starts?\\s+|starting\\s+|begins?\\s+|time\\s+)*(?:at\\s+|@\\s*|of\\s+)?${C}`, "g"), (m, g, c) => { setGame(c); return ` ⟨g${g}⟩ `; });
    rep(new RegExp(`${C}\\s*(?:(?:day|night|home|road|afternoon|evening|matinee|doubleheader|getaway|exhibition)\\s+)?(?:start\\s+)?${G}`, "g"), (m, c, g) => { if (st.gameClock != null) return m; setGame(c); return ` ⟨g${g}⟩ `; });

    /* ---- start / end anchors */
    const START = "(?:start(?:ing|s)?(?: time)?|begin(?:ning|s)?|kick ?off|get going|on the field|everyone in|guys in|be in|in by|be here|be at the (?:park|field|complex|facility)|(?:the )?day starts)";
    rep(new RegExp(`(?<!⟩\\s{0,3}(?:[a-z]+\\s+){0,4})\\b${START}(?:\\s+(?:the day|practice|the workout|everything|things|us|work|today|tomorrow))?\\s*(?:at|by|around|@|is)?\\s*${C}(?:\\s+with\\s+(?:the\\s+|a\\s+)?${A})?`, "g"), (m, c, i) => {
      if (st.startClock == null) st.startClock = useC(c);
      if (i != null) { if (act(i).at == null) act(i).at = +c; return ` ⟨a${i}⟩ `; }
      return " ";
    });
    rep(new RegExp(`${C}\\s*(?:start|kickoff)\\b`, "g"), (m, c) => { if (st.startClock == null) st.startClock = useC(c); return " "; });
    rep(new RegExp(`(?<!\\bkick(?:s|ing)?\\s|⟩\\s)\\b(?:off|gone|leaving|leave|out of (?:there|here)|outta here|clear|cleared)\\s+(?:the field\\s+|the complex\\s+|the park\\s+)?(?:by|at|before|no later than)\\s*${C}`, "g"), (m, c) => { if (st.endClock == null) st.endClock = useC(c); return " "; });
    const END = "(?:finish(?:ed)?|finishing|done|wrap(?:ped)?(?: (?:up|it up))?|end(?: the day)?|ending|hard stop|stop|out of here|out|off the field|over|clear the field|be done|all done|cut ?off)";
    rep(new RegExp(`\\b${END}(?:\\s+(?:everything|practice|the day|the workout|it|up|things|today))?\\s*(?:by|at|around|before|no later than|@)?\\s*${C}`, "g"), (m, c) => { if (st.endClock == null) st.endClock = useC(c); return " "; });
    rep(new RegExp(`\\bhard stop\\s*${C}|${C}\\s*(?:hard stop|finish|stop)\\b`, "g"), (m, c1, c2) => { const c = c1 ?? c2; if (st.endClock == null) st.endClock = useC(c); return " "; });

    /* ---- protected free time: "30 minutes off pregame", "45 off before stretch", "30 off" */
    const OFFW = "(?:off|free(?: time)?|down ?time|break|rest|buffer|open time)";
    const BEF = "(?:before|pre|prior to|ahead of|until|till|leading (?:up to|into)|in front of)";
    const offGame = (d) => { const v = useD(d); if (st.offBeforeGame == null) st.offBeforeGame = v; st.gameDay = true; return " "; };
    rep(new RegExp(`${D}\\s+(?:of\\s+)?${OFFW}(?:\\s+time)?\\s*(?:${BEF}\\s*)?(?:the\\s+)?(?:${G}|pregame)`, "g"), (m, d) => offGame(d));
    rep(new RegExp(`${OFFW}\\s+(?:for\\s+)?${D}\\s+${BEF}\\s+(?:the\\s+)?(?:${G}|pregame)`, "g"), (m, d) => offGame(d));
    const offAct = (d, i) => { st.offBefore.push({ min: useD(d), before: +i }); return ` ⟨a${i}⟩ `; };
    rep(new RegExp(`${D}\\s+(?:of\\s+)?${OFFW}(?:\\s+time)?\\s+${BEF}\\s+(?:the\\s+)?${A}`, "g"), (m, d, i) => offAct(d, i));
    rep(new RegExp(`${OFFW}\\s+(?:for\\s+)?${D}\\s+${BEF}\\s+(?:the\\s+)?${A}`, "g"), (m, d, i) => offAct(d, i));
    rep(new RegExp(`(?:\\bthen|\\bfollowed by)\\s+${D}\\s+(?:of\\s+)?${OFFW}\\s*,?\\s*(?:then\\s+)?${A}`, "g"), (m, d, i) => offAct(d, i));
    rep(new RegExp(`${OFFW}\\s+${D}(?!\\s*(?:before|pre))`, "g"), (m, d) => ` ⟨d${d}⟩ off `);
    rep(new RegExp(`${D}\\s+(?:of\\s+)?off\\b`, "g"), (m, d) => {
      if (st.dayType !== "workout" && (st.g.length || st.gameDay)) { note(`“${st.d[+d].min} off” read as free time before the game.`); return offGame(d); }
      return ` ⟨a${mkAct("free", "Free Time", { text: m, dur: useD(d) })}⟩ `;
    });

    /* ---- activities, pass 2 (free time, pregame) */
    lexPass(2);
    W = W.replace(/\s+/g, " ");
    if (st.acts.some((a) => a.kind === "pregamePrep")) st.gameDay = true;

    /* ---- BP rounds: "30-minute BP rounds", "BP rounds of 20", "rounds of 30" */
    const setRounds = (i, each) => { const a = act(i); a.rounds = a.rounds || { each: null, count: null }; if (each != null) a.rounds.each = each; };
    rep(new RegExp(`${A}\\s*(?:in\\s+)?${D}\\s*rounds?\\b`, "g"), (m, i, d) => { if (!HIT.includes(act(i).kind)) return m; setRounds(i, useD(d)); return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${D}\\s*(?:${A}\\s*)?rounds?\\b(?:\\s+(?:of|for)\\s+${A})?`, "g"), (m, d, i, j) => {
      const k = i != null && HIT.includes(act(i).kind) ? +i : j != null && HIT.includes(act(j).kind) ? +j : ensureHit();
      const v = useD(d); setRounds(k, v);
      if (i == null && j == null) st.acts.forEach((a, x) => { if (x !== k && ["bp", "cage"].includes(a.kind) && !a.alias) setRounds(x, v); });
      return ` ⟨a${k}⟩ `;
    });
    rep(new RegExp(`${A}\\s*(?:in\\s+)?rounds?\\s*(?:of|at|for)?\\s*${D}(?:\\s*(?:each|apiece|a round|per round|per group|a group|a piece))?`, "g"), (m, i, d) => { if (!HIT.includes(act(i).kind)) return m; setRounds(i, useD(d)); return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${A}\\s*,?\\s*(?:rounds?\\s+|groups?\\s+)?(?:at|of|for)?\\s*${D}\\s*(?:each|apiece|a round|per round|per group|a group|a piece)`, "g"), (m, i, d) => { if (!HIT.includes(act(i).kind)) return m; setRounds(i, useD(d)); return ` ⟨a${i}⟩ `; });
    rep(/⟨d(\d+)⟩\s*(?:each|apiece|a round|per round|per group|a group|a piece)\b/g, (m, d) => { const k = ensureHit(); setRounds(k, useD(d)); return ` ⟨a${k}⟩ `; });
    rep(/\brounds?\s+(?:of\s+)?⟨d(\d+)⟩(?:\s*each)?/g, (m, d) => { const k = ensureHit(); setRounds(k, useD(d)); return ` ⟨a${k}⟩ `; });
    rep(new RegExp(`${A}\\s*(?:in\\s+)?rounds?\\b`, "g"), (m, i) => { if (HIT.includes(act(i).kind)) setRounds(i, null); return ` ⟨a${i}⟩ `; });

    /* ---- stated times: "10 AM stretch", "BP at 3:30", "bp 330" */
    // "BP from 3 to 3:30" (time + length), "practice from 9 to 12" (the day's window)
    rep(new RegExp(`${A}\\s+(?:(?:goes|runs|is|will be|go|run|happens|lasts)\\s+)?(?:from\\s+)?${C}\\s*(?:to|until|till|-)\\s*${C}`, "g"), (m, i, c1, c2) => {
      if (act(i).at != null) return m;
      act(i).at = useC(c1); act(i).untilClock = useC(c2); return ` ⟨a${i}⟩ `;
    });
    rep(new RegExp(`(?:^|[.,;]\\s*|\\b(?:practice|workout|we go|we are|were|day|out there|on the field|window)\\s+)from\\s+${C}\\s*(?:to|until|till|-)\\s*${C}`, "g"), (m, c1, c2) => {
      if (st.startClock == null) st.startClock = useC(c1); if (st.endClock == null) st.endClock = useC(c2); return " , ";
    });
    // "pitchers stretch at 9:30, position players at 10": the same activity for another group
    rep(new RegExp(`\\b(pitchers?|catchers?|position players?|position guys|hitters)\\s+(?:at|@)\\s*${C}`, "g"), (m, w, c, offset, str) => {
      const p = prevAct(str, offset, -1, "pitchers");
      if (p == null) return m;
      const i = mkAct(act(p).kind, act(p).label, { text: m, who: whoWord(w) });
      act(i).at = useC(c);
      return ` ⟨a${i}⟩ `;
    });
    // "stretch 15" (a length), "Stretch 9." (a time)
    rep(new RegExp(`${A}\\s+(\\d{2,3})(?=\\s*(?:[.,;!?/]|$|\\band\\b|then\\b|⟨))`, "g"), (m, i, n) => {
      if (+n <= 12 || +n > 180 || act(i).dur != null) return m;
      return ` ⟨a${i}⟩ ` + tok("d", { min: +n, adj: false, raw: n });
    });
    rep(new RegExp(`(^|[.,;/]\\s*|\\band\\s+|\\bthen\\s+|⟩\\s+)(\\d{1,2})\\s+${A}`, "g"), (m, pre, n, i) => {
      const p = clockParts(n); if (!p || +n > 12 || act(i).at != null || ["bullpen", "pfp"].includes(act(i).kind)) return m;
      return pre + tok("c", p) + ` ⟨a${i}⟩ `;
    });
    rep(new RegExp(`${A}\\s+(\\d{1,2})(?=\\s*(?:[.,;!?/]|$|\\band\\b|then\\b|⟨|done\\b|finish|wrap|together\\b|in\\b|on\\b|with\\b))`, "g"), (m, i, n) => {
      const p = clockParts(n); if (!p || +n > 12 || act(i).at != null) return m;
      return ` ⟨a${i}⟩ ` + tok("c", p);
    });
    const setAt = (i, c) => {
      const pv = act(i).multiPrev;
      if (pv != null && act(pv).at == null) i = pv;
      if (act(i).at == null) { act(i).at = useC(c); return true; } return false;
    };
    rep(new RegExp(`${A}\\s+and\\s+${A}\\s+(?:at|@)\\s*${C}`, "g"), (m, i, j, c) => {
      if (act(i).at != null || act(j).at != null) return m;
      setAt(i, c); act(j).after.push(+i); return ` ⟨a${i}⟩ and ⟨a${j}⟩ `;
    });
    rep(new RegExp(`(?:\\bat\\s+|@\\s*)${C}\\s+for\\s+(?:the\\s+)?${A}`, "g"), (m, c, i) => setAt(i, c) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`${A}\\s+(?:first|today|tonight|tomorrow|together|again)\\s+(?=at\\b|@)`, "g"), (m, i) => ` ⟨a${i}⟩ `);
    rep(new RegExp(`${A}\\s+(?:is\\s+|will be\\s+|starts?\\s+|starting\\s+|begins?\\s+|from\\s+|goes\\s+)?(?:at|@|around)\\s*${C}`, "g"), (m, i, c) => setAt(i, c) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`(?<!⟨a\\d+⟩\\s*)(?:\\bat\\s+|@\\s*)?${C}\\s*(?:-\\s*)?${A}`, "g"), (m, c, i) => setAt(i, c) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`${A}\\s*${C}`, "g"), (m, i, c) => setAt(i, c) ? ` ⟨a${i}⟩ ` : m);

    rep(new RegExp(`${A}\\s+and\\s+${A}`, "g"), (m, i, j) => {
      const w = act(i).who;
      if ((w === "pitchers" || w === "catchers") && act(j).who === DEFAULT_WHO[act(j).kind] && act(j).who === "all") act(j).who = w;
      return m;
    });
    /* ---- stated lengths: "15 minutes of PFP", "30-minute cage", "stretch for 15" */
    const setDur = (i, d) => { if (act(i).dur == null) { act(i).dur = useD(d); return true; } return false; };
    rep(new RegExp(`${D}\\s+of\\s+(?:the\\s+)?${A}`, "g"), (m, d, i) => setDur(i, d) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`${D}\\s*${A}`, "g"), (m, d, i) => st.d[+d].adj && setDur(i, d) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`${A}\\s*(?:for\\s+|is\\s+|goes\\s+)?(?:about\\s+|around\\s+|roughly\\s+)?${D}(?:\\s+long)?`, "g"), (m, i, d) => setDur(i, d) ? ` ⟨a${i}⟩ ` : m);
    rep(new RegExp(`${D}\\s*${A}`, "g"), (m, d, i) => setDur(i, d) ? ` ⟨a${i}⟩ ` : m);

    /* ---- a time left in a clause belongs to the activity it sits with: "bp starts 4:30", "scrimmage vs the cubs at 1" */
    W = W.replace(/⟨c(\d+)⟩/g, (m, c, offset, str) => {
      if (st.c[+c].used) return m;
      const left = str.slice(0, offset);
      const lb = Math.max(left.lastIndexOf("."), left.lastIndexOf(","), left.lastIndexOf(";"), left.lastIndexOf(" / "));
      const before = left.slice(lb + 1);
      const prev = [...before.matchAll(/⟨([ag])(\d+)⟩/g)].pop();
      if (prev && prev[1] === "a" && act(prev[2]).at == null && before.slice(prev.index).trim().split(/\s+/).length <= 8) { setAt(prev[2], c); return " "; }
      if (prev && prev[1] === "g") return m;
      const right = str.slice(offset + m.length);
      const rb = right.search(/[.,;]| \/ /);
      const next = (rb < 0 ? right : right.slice(0, rb)).match(/⟨([ag])(\d+)⟩/);
      if (!prev && next && next[1] === "a" && act(next[2]).at == null && next.index < 40) { setAt(next[2], c); return " "; }
      return m;
    });

    /* ---- a length left alone belongs to the activity just named: "stations defense, 40 minutes" */
    W = W.replace(/⟨d(\d+)⟩/g, (m, d, offset, str) => {
      if (st.d[+d].used) return m;
      const left = str.slice(0, offset);
      const lb = Math.max(left.lastIndexOf("."), left.lastIndexOf(","), left.lastIndexOf(";"), left.lastIndexOf(" / "));
      const own = left.slice(lb + 1);
      let prev = [...own.matchAll(/⟨a(\d+)⟩/g)].pop();
      if (!prev && lb >= 0 && /^[\s]*(?:for\s+|about\s+|around\s+)?$/.test(own) && /^\s*(?:long|total)?\s*(?:[.,;]|$)/.test(str.slice(offset + m.length))) {
        prev = left.slice(0, lb).match(/⟨a(\d+)⟩\s*$/);
      }
      if (prev && act(prev[1]).dur == null && !(act(prev[1]).rounds && act(prev[1]).rounds.each)) { act(prev[1]).dur = useD(d); return " "; }
      return m;
    });

    /* ---- sequencing */
    const edge = (x, y, rel) => {   // x rel y ; y may be "game"
      if (x === y) return;
      if (rel === "after") act(x).after.push(y); else act(x).before.push(y);
    };
    const gameOrAct = (s) => (s.startsWith("⟨g") ? "game" : +s.match(/\d+/)[0]);
    rep(new RegExp(`${A}\\s+(?:right\\s+|immediately\\s+|directly\\s+|just\\s+)?(after|following|before|ahead of|prior to)\\s+(?:the\\s+)?(⟨[ag]\\d+⟩)`, "g"), (m, i, rel, y) => {
      edge(+i, gameOrAct(y), /after|following/.test(rel) ? "after" : "before"); return ` ⟨a${i}⟩ ${y} `;
    });
    rep(new RegExp(`(^|[.,;]\\s*|\\band\\s+)(after|following|before)\\s+(?:the\\s+)?(⟨[ag]\\d+⟩)\\s*,?\\s*(?:we\\s+|do\\s+|have\\s+)?${A}`, "g"), (m, pre, rel, y, i) => {
      edge(+i, gameOrAct(y), /after|following/.test(rel) ? "after" : "before"); return `${pre} ${y} ⟨a${i}⟩ `;
    });
    for (let pass = 0; pass < 6; pass++) {
      const before = W;
      W = W.replace(new RegExp(`(?:\\bthen|\\bfollowed by|\\binto|\\bafter that|\\bafterwards?|\\bnext)\\s*,?\\s*${A}`, "g"), (m, i, offset, str) => {
        const lastTok = [...str.slice(0, offset).matchAll(/⟨([ag])(\d+)⟩/g)].pop();
        const p = lastTok && lastTok[1] === "g" ? "game" : prevAct(str, offset, +i, act(i).who);
        if (p != null) edge(+i, p, "after");
        return ` ⟨a${i}⟩ `;
      });
      if (W === before) break;
    }
    rep(new RegExp(`${A}\\s+(?:right\\s+|immediately\\s+)?(?:after|afterwards?|after that|next|last|to finish|to close|at the end)(?=\\s*(?:[.,;!?]|$|\\band\\b|⟨))`, "g"), (m, i, offset, str) => {
      const p = prevAct(str, offset, +i, act(i).who);
      if (p != null) { edge(+i, p, "after"); if (act(p).who === "pitchers" || act(i).who !== act(p).who) note(`“${act(i).label} after” read as after ${act(p).label}.`); }
      return ` ⟨a${i}⟩ `;
    });

    /* ---- indoor / location / emphasis on one activity */
    rep(new RegExp(`(?:\\b(?:move|take|put|bring|have)\\s+)?(?:the\\s+)?${A}\\s+(?:indoors?|inside|in the cage|under cover|to the cage|undercover)\\b`, "g"), (m, i) => { act(i).indoor = true; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`\\b(?:indoor|inside)\\s+${A}`, "g"), (m, i) => { act(i).indoor = true; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${A}\\s+(?:outside|outdoors|on the field)\\b`, "g"), (m, i) => { act(i).indoor = false; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${A}\\s+(?:on|in|at)\\s+(?:the\\s+)?((?:main |back |half |aux(?:iliary)? |practice )?field(?:\\s*\\d+)?|cage\\s*\\d+|mound\\s*\\d+|indoor turf|turf|weight room|stadium|clubhouse|gym|tunnel|outfield|infield)\\b`, "g"), (m, i, loc) => { act(i).location = cap(loc); return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`\\b(?:heavy|extra|long|longer|big|lots of|plenty of|more|full|a lot of|double)\\s+(?:the\\s+)?${A}`, "g"), (m, i) => { act(i).emphasis = "heavy"; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${A}\\s+(?:heavy|long|extended)\\b`, "g"), (m, i) => { act(i).emphasis = "heavy"; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`${A}\\s+(?:light|short|quick|lite)\\b`, "g"), (m, i) => { act(i).emphasis = "light"; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`\\b(?:light|lighter|short|shorter|quick|brief|abbreviated|less|shortened|mini|condensed|easy|little)\\s+(?:the\\s+)?${A}`, "g"), (m, i) => { act(i).emphasis = "light"; return ` ⟨a${i}⟩ `; });
    rep(new RegExp(`\\b(?:shorten|cut down|trim|reduce|limit|cut back)\\s+(?:the\\s+)?${A}(?:\\s+short)?`, "g"), (m, i) => { act(i).emphasis = "light"; if (!out.weather) note(`${act(i).label} shortened.`); return ` ⟨a${i}⟩ `; });

    /* ---- at the same time / while: groups or items side by side */
    rep(new RegExp(`(?:${A}\\s+)?(?:\\w+\\s+){0,2}(?:at the same time|simultaneous(?:ly)?|concurrent(?:ly)?|at once|in parallel|side by side)\\b(?:\\s+(?:at|@)\\s*${C})?`, "g"), (m, i, c, offset, str) => {
      const k = i != null ? +i : prevAct(str, offset, -1, "pitchers");
      if (k == null || !HIT.includes(act(k).kind)) return m;
      st.parallel.push([k]); if (c != null) setAt(k, c);
      return ` ⟨a${k}⟩ `;
    });
    rep(new RegExp(`${A}([^.;⟨]{0,40})\\bwhile\\b([^.;⟨]{0,40})${A}`, "g"), (m, i, a1, a2, j) => {
      if (HIT.includes(act(i).kind) && HIT.includes(act(j).kind)) st.parallel.push([+i, +j]);
      return ` ⟨a${i}⟩ ${a1} , ${a2} ⟨a${j}⟩ `;
    });
    rep(new RegExp(`${A}\\s+(?:in the |this )?(morning|afternoon)\\b`, "g"), (m, i, w) => { act(i).dayPart = w; return ` ⟨a${i}⟩ `; });
    // slash lists are an ordered sequence ("stretch 9 / indy / cage / lift")
    if (/ \/ /.test(W)) {
      const segs = W.split(" / ");
      let prevAll = null, prevPos = null, prevPit = null;
      segs.forEach((seg) => {
        const ids = [...seg.matchAll(/⟨a(\d+)⟩/g)].map((x) => +x[1]);
        const free = /\b(?:somewhere|anywhere|whenever|first|last)\b/.test(seg);
        ids.forEach((i) => {
          const a = act(i);
          if (a.at == null && !free) {
            const ps = a.who === "pitchers" ? [prevPit ?? prevAll] : a.who === "all" ? uniq([prevPos ?? prevAll, prevPit ?? prevAll]) : [prevPos ?? prevAll];
            ps.forEach((p) => { if (p != null && p !== i && !a.after.includes(p)) a.after.push(p); });
          }
        });
        ids.forEach((i) => { const w = act(i).who; if (w === "pitchers") prevPit = i; else if (w === "all") { prevAll = i; prevPos = i; prevPit = i; } else prevPos = i; });
      });
      W = W.replace(/ \/ /g, " , ");
    }

    /* ---- leftovers: unused times, then words that aren't filler */
    W = W.replace(/\bkick(?:s|ing)? off\b|\bget (?:it )?going\b/g, " ");
    st.c.forEach((c) => { if (!c.used) st.unknown.push(`at ${c.raw}`); });
    st.d.forEach((d) => { if (!d.used) st.unknown.push(d.raw.trim()); });
    W.replace(/⟨[a-z]\d+⟩/g, "|").split(/[|.,;!?/]+/).forEach((chunk) => {
      const words = chunk.trim().split(/\s+/).filter(Boolean);
      while (words.length && FILLER.has(words[0])) words.shift();
      while (words.length && FILLER.has(words[words.length - 1])) words.pop();
      if (words.length && words.some((w) => !FILLER.has(w))) st.unknown.push(words.join(" "));
    });

    return assemble(out, st, W, ctx);
  }

  /* ------------------------------------------------------------ assemble */
  function assemble(out, st, W, ctx) {
    const acts = st.acts;
    const note = (s) => { if (!st.notes.includes(s)) st.notes.push(s); };
    // order of mention = first appearance in the final token string
    const seen = [];
    W.replace(/⟨a(\d+)⟩/g, (m, i) => { if (!seen.includes(+i)) seen.push(+i); return m; });
    acts.forEach((a, i) => { if (!seen.includes(i)) seen.push(i); });
    // "No BP": drop every item of a negated kind, and say so
    const negKinds = uniq(acts.filter((a) => a.negated).map((a) => a.kind));
    acts.forEach((a) => { if (negKinds.includes(a.kind)) a.dead = true; });
    negKinds.forEach((k) => note(`No ${acts.find((a) => a.kind === k && a.negated).label} (as stated).`));
    for (let x = seen.length - 1; x >= 0; x--) if (acts[seen[x]].dead) seen.splice(x, 1);
    if (st.pitcherOnly) { acts.forEach((a) => { if (a.who === "all" && !["meeting", "meal", "free", "arrival"].includes(a.kind)) a.who = "pitchers"; }); note("Pitchers-only day."); }
    if (acts.some((a) => !a.dead && a.text === "cr")) note("“CR” read as cuts & relays.");
    if (acts.some((a) => !a.dead && a.text === "lt")) note("“LT” read as long toss.");
    acts.forEach((a) => { if (a.kind === "throwing" && a.who === "pitchers") { a.kind = "pitcherWork"; if (a.label === "Throwing") a.label = "Pitchers' Throwing"; } });

    // merge repeats ("BP … BP at 3:30") and aliases ("defense" when "team fundy" was named)
    const canon = {}, kept = [];
    const mergeInto = (k, i) => {
      const a = acts[i], b = acts[k];
      b.at = b.at ?? a.at; b.dur = b.dur ?? a.dur; b.indoor = b.indoor ?? a.indoor; b.location = b.location ?? a.location; b.emphasis = b.emphasis ?? a.emphasis;
      if (a.rounds) b.rounds = { each: (b.rounds && b.rounds.each) ?? a.rounds.each, count: (b.rounds && b.rounds.count) ?? a.rounds.count };
      b.after.push(...a.after); b.before.push(...a.before); b.dayPart = b.dayPart || a.dayPart;
      if (b.generic && !a.generic) { b.label = a.label; b.generic = false; b.alias = null; }
      if (a.text && !b.text.includes(a.text)) b.text = b.text ? b.text + "; " + a.text : a.text;
      canon[i] = k;
    };
    const sameFamily = (b, a) => a.alias === "hitting" ? HIT.includes(b.kind) : a.alias === "defense" ? DEF.includes(b.kind) : a.alias === "stations" ? b.kind === "indDefense" : false;
    for (const i of seen) {
      const a = acts[i];
      if (a.alias) continue;
      const k = kept.find((k) => { const b = acts[k];
        return b.kind === a.kind && b.who === a.who && a.kind !== "custom" && (b.label === a.label || b.generic) && !(b.at != null && a.at != null && b.at !== a.at); });
      if (k != null) mergeInto(k, i); else { kept.push(i); canon[i] = i; }
    }
    for (const i of seen) {
      const a = acts[i];
      if (!a.alias) continue;
      const pref = a.alias === "defense" ? ["teamDefense", "indDefense"] : a.alias === "hitting" ? ["bp", "cage", "liveBp"] : ["indDefense"];
      let k = null;
      for (const kd of pref) { k = kept.find((k) => acts[k].kind === kd && sameFamily(acts[k], a) && !acts[k].alias); if (k != null) break; }
      if (k == null) k = kept.find((k) => acts[k].alias === a.alias);
      if (k != null && !(acts[k].at != null && a.at != null && acts[k].at !== a.at)) mergeInto(k, i);
      else {
        kept.push(i); canon[i] = i;
        if (a.alias === "defense") note("“Defense” read as team defense.");
        if (a.alias === "hitting") note("“Hitting” read as BP.");
        if (a.alias === "stations") note("“Stations” read as defensive stations.");
      }
    }
    kept.sort((x, y) => seen.indexOf(x) - seen.indexOf(y));
    kept.forEach((k, n) => { acts[k].id = "a" + (n + 1); acts[k].order = n + 1; });
    const idOf = (x) => (x === "game" ? "game" : acts[canon[x]] ? acts[canon[x]].id : null);
    const canonIdx = (a) => acts.indexOf(a);

    /* ---- clocks */
    const P = (c) => st.c[c];
    out.anchors.firstPitch = st.gameClock != null ? clockValue(P(st.gameClock), "game") : null;
    let start = st.startClock != null ? clockValue(P(st.startClock), "practice") : null;
    let end = st.endClock != null ? clockValue(P(st.endClock), "practice") : null;
    kept.forEach((k) => { const a = acts[k]; a.atClock = a.at; a.at = a.at != null ? clockValue(P(a.at), "practice") : null;
      if (a.untilClock != null && a.at != null) { let e = clockValue(P(a.untilClock), "practice"); if (e <= a.at && e + 720 < 1440) e += 720; if (e > a.at && a.dur == null) a.dur = e - a.at; } });
    const arrival = kept.map((k) => acts[k]).find((a) => a.kind === "arrival" && a.at != null);
    if (start == null && arrival) start = arrival.at;
    if (start == null) {   // "10 AM stretch" opens the day when it is the first thing named and the earliest time
      const work = kept.map((k) => acts[k]).filter((a) => !["meal", "free", "postgame", "game"].includes(a.kind));
      const ats = work.filter((a) => a.at != null).map((a) => a.at);
      if (work.length && work[0].at != null && work[0].at === Math.min(...ats)) start = work[0].at;
    }
    // contextual consistency: an inferred morning time earlier than the start (or far before an evening game) is afternoon
    const fp = out.anchors.firstPitch;
    kept.forEach((k) => {
      const a = acts[k];
      if (a.at == null || P(a.atClock).mer || a.at >= 720 || P(a.atClock).h > 12) return;
      const pm = a.at + 720, limit = end ?? fp ?? 23 * 60;
      if ((start != null && a.at < start && pm <= limit) || (start == null && fp != null && fp >= 17 * 60 && pm < fp)) {
        a.at = pm; note(`${a.label} at ${fmt(pm)} (read as afternoon).`);
      }
    });
    if (end != null && !P(st.endClock).mer && end < 720 && P(st.endClock).h <= 12) {
      const latest = Math.max(start ?? 0, ...kept.map((k) => acts[k].at ?? 0));
      if ((end <= latest || end < 9 * 60) && end + 720 < 1440) end += 720;
    }
    out.anchors.start = start; out.anchors.end = end;
    out.anchors.offBeforeGame = st.offBeforeGame;
    out.offBefore = st.offBefore.map((o) => ({ min: o.min, before: idOf(o.before) })).filter((o) => o.before);

    /* ---- day type */
    if (st.dayType === "workout") {
      out.dayType = "workout";
      if (st.g.length || fp != null) note("Both “no game” and a game were mentioned — read as no game.");
    } else if (st.g.length || st.gameDay || fp != null || st.offBeforeGame != null) out.dayType = "game";
    if (out.dayType === "game" && fp == null) {
      if (ctx.game && ctx.game.firstPitch != null) { out.anchors.firstPitch = ctx.game.firstPitch; note(`First pitch ${fmt(ctx.game.firstPitch)} from the Games list.`); }
      else note("Game time not stated.");
    }
    if (out.dayType === "workout") { out.anchors.firstPitch = null; out.anchors.offBeforeGame = null; }

    /* ---- groups, rounds, emphasis */
    if (st.namedGroups && st.namedGroups.length) { st.hitGroups = st.hitGroups ?? st.namedGroups.length; note(`Groups named: ${st.namedGroups.map(cap).join(", ")}.`); }
    if (st.allGroups && st.hitGroups == null && ctx.hittingGroups && ctx.hittingGroups.length) st.hitGroups = ctx.hittingGroups.length;
    out.groups.hitting = st.hitGroups;
    out.groups.pitchers = st.groupsPitchers;
    const count = st.roundsCount ?? st.hitGroups;
    if (count != null) {
      let k = kept.find((k) => acts[k].kind === "bp") ?? kept.find((k) => acts[k].kind === "cage");
      if (k == null) {
        const i = acts.length; acts.push({ kind: "bp", label: "BP", who: "position", text: "(hitting groups)", at: null, dur: null, rounds: null, after: [], before: [], indoor: null, location: null, emphasis: null, id: "a" + (kept.length + 1), order: kept.length + 1 });
        kept.push(i); canon[i] = i; note(st.roundsCount != null ? `${count} rounds read as BP rounds.` : `${count} hitting groups read as ${count} BP rounds.`);
      }
      const a = acts[k ?? kept[kept.length - 1]];
      a.rounds = a.rounds || { each: null, count: null };
      if (a.rounds.count == null) a.rounds.count = count;
    }
    // "BP 4 groups 20 min" — a length stated next to a group/round count is the round length
    kept.forEach((k) => { const a = acts[k]; if (["bp", "cage"].includes(a.kind) && a.rounds && a.rounds.count && a.rounds.each == null && a.dur != null && a.dur <= 40) { a.rounds.each = a.dur; a.dur = null; } });
    // field + cage rotation ("… while … are in the cage, then swap")
    const bpK = kept.find((k) => acts[k].kind === "bp"), cgK = kept.find((k) => acts[k].kind === "cage");
    if (st.swap && bpK != null && cgK != null && !st.parallel.some((g) => g.length > 1)) st.parallel.push([bpK, cgK]);
    if (st.swap) note("Groups rotate between field and cage.");
    // "defense in the morning" → before a midday meal
    const meal = kept.map((k) => acts[k]).find((a) => a.kind === "meal" && a.at != null && a.at >= 660);
    kept.forEach((k) => { const a = acts[k]; if (a.dayPart && meal && a !== meal) { if (a.dayPart === "morning") a.before.push(canonIdx(meal)); else a.after.push(canonIdx(meal)); } });
    out.emphasis = st.emphasis.slice();
    const addFor = (area, kind, label) => {
      const fam = area === "defense" ? DEF : HIT;
      const have = kept.filter((k) => fam.includes(acts[k].kind));
      have.forEach((k) => { if (!acts[k].emphasis) acts[k].emphasis = "heavy"; });
      if (!have.length) {
        const i = acts.length; acts.push({ kind, label, who: DEFAULT_WHO[kind], text: `(${area} emphasis)`, at: null, dur: null, rounds: null, after: [], before: [], indoor: null, location: null, emphasis: "heavy", id: "a" + (kept.length + 1), order: kept.length + 1 });
        kept.push(i); canon[i] = i; note(`${cap(area)} emphasis: added ${label.toLowerCase()}.`);
      }
    };
    if (st.emphasis.includes("defense")) addFor("defense", "teamDefense", "Team Defense");
    if (st.emphasis.includes("hitting")) addFor("hitting", "bp", "BP");
    if (st.allIndoor) {
      kept.forEach((k) => { const a = acts[k]; if (!["meal", "meeting", "free", "arrival", "pregamePrep", "postgame", "game", "custom"].includes(a.kind) && a.indoor == null) a.indoor = true; });
      note("Everything indoors.");
    }
    if (st.light) { kept.forEach((k) => { if (!acts[k].emphasis) acts[k].emphasis = "light"; }); note("Light day: shorter blocks."); }
    if (out.weather === "rain") {
      const hit = kept.filter((k) => HIT.includes(acts[k].kind) && acts[k].kind !== "liveBp");
      hit.forEach((k) => { if (acts[k].indoor == null) acts[k].indoor = true; });
      const def = kept.filter((k) => DEF.includes(acts[k].kind));
      def.forEach((k) => { if (!acts[k].emphasis) acts[k].emphasis = "light"; });
      note("Rain: " + ([hit.length ? "hitting indoors" : "", def.length ? "defense shortened" : ""].filter(Boolean).join(", ") || "noted") + ".");
    }

    out.activities = kept.map((k) => {
      const a = acts[k];
      return { id: a.id, kind: a.kind, label: a.label, who: a.who, at: a.at, dur: a.dur, rounds: a.rounds ? { each: a.rounds.each, count: a.rounds.count } : null,
        order: a.order, after: uniq(a.after.map(idOf)).filter((x) => x && x !== a.id), before: uniq(a.before.map(idOf)).filter((x) => x && x !== a.id),
        indoor: a.indoor, location: a.location, emphasis: a.emphasis, text: a.text };
    });
    const par = [];
    st.parallel.forEach((g) => { const ids = uniq(g.map(idOf).filter(Boolean)); if (ids.length && !par.some((p) => JSON.stringify(p) === JSON.stringify(ids))) par.push(ids); });
    if (par.length) out.parallel = par;
    out.notes = st.notes;
    out.unknown = uniq(st.unknown);
    return out;
  }

  /* ================================================================ edits */
  const ORD = { second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };
  const TIME = "(noon|midday|\\d{1,2}:\\d{2}\\s*(?:am|pm|a|p)?|\\d{1,4}\\s*(?:am|pm|a|p)?)";
  const NUM = "(\\d{1,3})\\s*(?:-\\s*)?(?:minutes?|mins?|min)?";
  const clean = (s) => String(s || "").replace(/\b(?:please|instead|today|tomorrow|now|then|also|just|again)\b/g, " ").replace(/\s+/g, " ").trim();
  const isClockish = (s) => /noon|midday|:|am\b|pm\b|\d(?:a|p)\b/.test(s) || /^\d{3,4}$/.test(s.trim()) || (/^\d{1,2}$/.test(s.trim()) && +s <= 12);

  /** phrase → [target]. Resolved against the request's activities so "defense" / "hitting" name what is there. */
  function targetsOf(phrase, request) {
    let p = " " + clean(phrase).replace(/\b(?:the|our|my|all|of|block|blocks|session|sessions|portion|part|stuff)\b/g, " ").replace(/\s+/g, " ").trim() + " ";
    const acts = (request && request.activities) || [];
    const has = (k) => acts.some((a) => a.kind === k);
    if (!p.trim()) return [];
    if (/^\s*(?:everything|it|the day|everyone|whole day)\s*$/.test(p)) return [{ label: "all" }];
    if (/\b(?:first pitch|gametime|game(?: time)?)\b/.test(p) && !/pregame|postgame/.test(p)) return [{ kind: "game" }];
    if (/^\s*(?:pitchers?|pitching|pitcher work|the pitchers|arms)\s*$/.test(p)) return [{ who: "pitchers" }];
    if (/^\s*(?:position players?|position guys|hitters)\s*$/.test(p)) return [{ who: "position" }];
    if (/^\s*catchers?\s*$/.test(p)) return [{ who: "catchers" }];
    if (/^\s*(?:hitting|offense|swings|hitting groups?)\s*$/.test(p)) {
      const ks = HIT.filter(has); return (ks.length ? ks : ["bp"]).map((kind) => ({ kind }));
    }
    if (/^\s*(?:defense|defensive work|defensive|d|fielding)\s*$/.test(p)) {
      const ks = DEF.filter(has); return (ks.length ? ks : ["teamDefense"]).map((kind) => ({ kind }));
    }
    const m = matchActivity(p.replace(/\bgroups?\b/g, " "));
    if (!m) return [];
    if (m.alias === "hitting") { const ks = HIT.filter(has); return (ks.length ? ks : ["bp"]).map((kind) => ({ kind })); }
    if (m.alias === "defense") { const ks = DEF.filter(has); return (ks.length ? ks : ["teamDefense"]).map((kind) => ({ kind })); }
    const t = { kind: m.kind };
    if (m.who === "catchers") t.who = "catchers";
    return [t];
  }
  const idFor = (t, request) => {
    if (t.kind === "game") return "game";
    const a = ((request && request.activities) || []).find((a) => a.kind === t.kind && (!t.who || a.who === t.who));
    return a ? a.id : null;
  };
  function newId(request, ops) {
    const ids = ((request && request.activities) || []).map((a) => a.id).concat(ops.filter((o) => o.op === "add").map((o) => o.activity.id));
    let n = ids.length + 1; while (ids.includes("a" + n)) n++;
    return "a" + n;
  }
  function splitInstructions(t) {
    const V = "(?:add|move|push|pull|drop|remove|delete|skip|shorten|lengthen|extend|give|make|start|keep|lock|run|put|swap|switch|bump|slide|shift|delay|finish|set|change|scratch|hold|leave|include|squeeze|trim|reduce|increase|reorganize|reorganise|rearrange|reshuffle|rework|redo|re-solve|resolve|take|cut|lunch|first pitch|end|wrap|no|have|let|lets|do|go|then)\\b";
    return t.split(new RegExp(`[.;!?]+|\\n|,\\s*(?:and\\s+|then\\s+)?(?=${V})|\\s+(?:and then|and|then|also|plus)\\s+(?=${V})`))
      .map((s) => s && s.trim().replace(/^(?:and|then|also|plus|but|so|ok|okay)\s+/, "").replace(/^(?:can you|could you|please|lets|let us|i want to|we need to|go ahead and|i need you to)\s+/, "").trim())
      .filter(Boolean);
  }

  function readEditDetailed(text, request, plan, ctx = {}) {
    const ops = [], notes = [], unknown = [];
    const req = request || { activities: [], anchors: {} };
    const note = (s) => { if (!notes.includes(s)) notes.push(s); };
    const T = (p) => targetsOf(p, req);
    const clk = (s, role) => clockValue(clockParts(String(s).replace(/\s+/g, "")), role);
    const parts = splitInstructions(normalize(text));
    /** current round count of a kind: request, then plan, then groups, then a default of 2 (flagged) */
    const curRounds = (kind) => {
      const a = (req.activities || []).find((a) => a.kind === kind);
      if (a && a.rounds && a.rounds.count) return { count: a.rounds.count };
      const its = ((plan && plan.items) || []).filter((i) => i.kind === kind && i.round != null);
      if (its.length) return { count: Math.max(...its.map((i) => i.round)) };
      if (req.groups && req.groups.hitting) return { count: req.groups.hitting };
      if (ctx.hittingGroups && ctx.hittingGroups.length) return { count: ctx.hittingGroups.length };
      return { count: 2, assumed: true };
    };
    for (const raw of parts) {
      const s = clean(raw);
      if (!s) continue;
      let m;
      const before = ops.length;
      const each = (targets, fn) => { if (!targets.length) { unknown.push(raw); return; } targets.forEach((t) => ops.push(fn(t))); };

      // acknowledgements / re-solve requests
      if (/^(?:re-?(?:organi[sz]e|arrange|shuffle|work|do|solve|build|plan)|resolve|fit|shuffle|work|plan)\s+(?:the\s+)?(?:rest|everything else|others?|remaining|around it|the remaining.*)\b/.test(s) || /^(?:and\s+)?(?:fit|work|plan)\s+(?:the\s+)?(?:rest|everything else)\s+around/.test(s)) { note("The rest is re-planned around it."); continue; }
      if (/^(?:ok|okay|thanks?|thank you|looks good|good|great|perfect)\b/.test(s) || /^(?:rain|storms?|weather)\b/.test(s)) continue;

      // "add a second BP group", "add another hitting group", "3 BP groups"
      if ((m = s.match(/^(?:add|give (?:me|us))\s+(?:a|an|one)?\s*(second|2nd|third|3rd|fourth|4th|fifth|5th|another|extra|1 more|one more)\s+(?:bp|hitting|batting|cage)?\s*(group|round)s?\b/))) {
        const tg = /cage/.test(s) ? { kind: "cage" } : { kind: "bp" };
        const cur = ((req.activities || []).find((a) => a.kind === tg.kind) || {}).rounds;
        const base = (cur && cur.count) || (req.groups && req.groups.hitting) || (ctx.hittingGroups && ctx.hittingGroups.length) || 1;
        const n = ORD[m[1]] || base + 1;
        ops.push(m[2] === "group" ? { op: "rounds", target: tg, count: n, groups: n } : { op: "rounds", target: tg, count: n });
        continue;
      }
      if ((m = s.match(/^(?:make it|make|use|go with|do|add|we have|there are)?\s*(\d)\s+(bp|hitting|batting|cage)?\s*(groups|rounds)(?:\s+(?:of|for)\s+(bp|batting practice|hitting|cage))?$/))) {
        if (m[4]) m[2] = m[4] === "cage" ? "cage" : "bp";
        const tg = m[2] === "cage" ? { kind: "cage" } : { kind: "bp" };
        ops.push(m[3] === "groups" ? { op: "rounds", target: tg, count: +m[1], groups: +m[1] } : { op: "rounds", target: tg, count: +m[1] });
        continue;
      }
      // one more / one less round or group: "give BP another round", "cut a round of BP", "add 2 rounds"
      if (/\b(?:rounds?|groups?)\b/.test(s) && !/\d{2,3}|\d\s*(?:minutes?|mins?|min)\b/.test(s) && !/\b(?:second|2nd|third|3rd|fourth|4th|fifth|5th)\b/.test(s)) {
        const up = /\b(?:another|more|extra|add(?:itional)?|plus|give|one more|1 more)\b/.test(s);
        const down = /\b(?:cut|drop|remove|lose|less|fewer|minus|take|skip|scratch|eliminate|delete|knock)\b/.test(s);
        if (up !== down) {
          const nm = s.match(/\b(\d)\s+(?:more\s+|less\s+|fewer\s+|extra\s+)?(?:bp\s+|hitting\s+|cage\s+)?(?:rounds?|groups?)\b/);
          const n = nm && !/\b1 (?:more|less)\b/.test(s) ? +nm[1] : 1;
          const tg = /\bcage\b/.test(s) ? { kind: "cage" } : /\blive\b/.test(s) ? { kind: "liveBp" } : { kind: "bp" };
          const cur = curRounds(tg.kind);
          const count = Math.max(1, cur.count + (up ? n : -n));
          if (cur.assumed) note(`Assumed ${cur.count} ${tg.kind === "cage" ? "cage" : "BP"} rounds before the change.`);
          ops.push(/\bgroups?\b/.test(s) ? { op: "rounds", target: tg, count, groups: count } : { op: "rounds", target: tg, count });
          continue;
        }
      }
      // swap: "swap BP and defense", "switch cage with BP"
      if ((m = s.match(/^(?:swap|switch|flip|trade|reverse|flip-flop)\s+(?:the\s+)?(.+?)\s+(?:and|with|&)\s+(?:the\s+)?(.+?)(?:\s+(?:around|order|spots|places))?$/))) {
        const xs = T(m[1]), ys = T(m[2]);
        if (!xs.length || !ys.length) { unknown.push(raw); continue; }
        const x = xs[0], y = ys[0];
        const pos = (t) => {
          const its = ((plan && plan.items) || []).filter((i) => i.kind === t.kind || (t.who && i.track === t.who));
          if (its.length) return Math.min(...its.map((i) => i.start));
          const a = (req.activities || []).find((a) => a.kind === t.kind || (t.who && a.who === t.who));
          return a ? (a.at ?? 2000 + (a.order || 0)) : null;
        };
        const px = pos(x), py = pos(y);
        const xFirst = px == null || py == null ? true : px <= py;
        if (px == null || py == null) note("Couldn't see the current order — swapped as written.");
        ops.push(xFirst ? { op: "move", target: x, after: y } : { op: "move", target: x, before: y });
        ops.push(xFirst ? { op: "move", target: y, before: x } : { op: "move", target: y, after: x });
        continue;
      }
      // "make BP rounds 20 minutes", "20-minute rounds", "BP rounds of 20"
      if ((m = s.match(/^(?:make|set|change|go with|do|use)?\s*(?:the\s+)?(bp|batting practice|hitting|cage)?\s*rounds?\s+(?:to\s+|of\s+|at\s+|be\s+|are\s+)?(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?|min)?(?:\s+each)?$/)) ||
          (m = s.match(/^(?:make|set|use|go with|do)?\s*(?:the\s+)?(bp|hitting|cage)?\s*(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?|min)\s+(?:bp\s+|cage\s+)?rounds$/))) {
        ops.push({ op: "rounds", target: { kind: m[1] === "cage" ? "cage" : "bp" }, each: +m[2] });
        continue;
      }
      // "add 15 minutes to BP"
      if ((m = s.match(new RegExp(`^(?:add|give)\\s+${NUM}\\s+(?:more\\s+)?(?:to|for)\\s+(.+)$`)))) { each(T(m[2]), (t) => ({ op: "duration", target: t, delta: +m[1] })); continue; }
      // "add 15 minutes of PFPs after stretch", "add baserunning", "add a meeting at 9:30"
      if ((m = s.match(/^(?:add|include|put in|throw in|squeeze in|also do|let's add|we need|need)\s+(.+)$/))) {
        let rest = m[1], dur = null, at = null, rel = null, relT = null;
        let q;
        if ((q = rest.match(/^(?:a|an|some)?\s*(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?|min)\s+(?:of\s+)?(.+)$/))) { dur = +q[1]; rest = q[2]; }
        if ((q = rest.match(/^(.+?)\s+for\s+(\d{1,3})\s*(?:minutes?|mins?|min)?$/))) { dur = +q[2]; rest = q[1]; }
        if ((q = rest.match(new RegExp(`^(.+?)\\s+(?:at|@)\\s+${TIME}$`)))) { at = clk(q[2], "practice"); rest = q[1]; }
        if ((q = rest.match(/^(.+?)\s+(right after|after|following|right before|before|ahead of)\s+(.+)$/))) { rel = /after|following/.test(q[2]) ? "after" : "before"; relT = q[3]; rest = q[1]; }
        rest = rest.replace(/^(?:a|an|some|the|another|more)\s+/, "");
        const a = matchActivity(rest);
        if (!a || a.kind === "game") { unknown.push(raw); continue; }
        let who = a.who;
        if (/\bpitchers?\b/.test(rest) && !["meeting"].includes(a.kind)) who = "pitchers";
        let kind = a.kind;
        if (kind === "throwing" && who === "pitchers") kind = "pitcherWork";
        const activity = { id: newId(req, ops), kind, label: a.label, who, at, dur, rounds: null, order: ((req.activities || []).length + ops.filter((o) => o.op === "add").length + 1),
          after: [], before: [], indoor: null, location: null, emphasis: null, text: raw };
        if (/rounds?\b/.test(rest) && HIT.includes(kind)) activity.rounds = { each: null, count: null };
        if (rel) {
          const ids = T(relT).map((t) => idFor(t, req)).filter(Boolean);
          if (ids.length) activity[rel] = ids; else note(`Couldn't find “${relT}” in the schedule.`);
        }
        ops.push({ op: "add", activity });
        continue;
      }
      // parallel: "run the cage groups simultaneously", "BP and cage at the same time"
      if (/\b(?:simultaneous(?:ly)?|at the same time|same time|concurrent(?:ly)?|in parallel|parallel|together|at once|side by side)\b/.test(s)) {
        const body = s.replace(/\b(?:simultaneous(?:ly)?|at the same time|same time|concurrent(?:ly)?|in parallel|parallel|together|at once|side by side)\b/g, " ").replace(/^(?:run|do|have|put|go with|make)\s+/, "");
        const targets = [];
        body.split(/\s+(?:and|with|plus|alongside)\s+|,/).forEach((p) => T(p).forEach((t) => { if (!targets.some((x) => JSON.stringify(x) === JSON.stringify(t))) targets.push(t); }));
        if (!targets.length) { unknown.push(raw); continue; }
        ops.push({ op: "parallel", targets });
        continue;
      }
      // anchors: finish / start / first pitch / buffer
      if ((m = s.match(new RegExp(`^(?:make\\s+|have\\s+)?(?:everything|it|the day|we|us|all|practice|the workout|everyone)?\\s*(?:need to\\s+|has to\\s+|should\\s+)?(?:be\\s+)?(?:finish(?:ed)?|done|end|wrap(?: up)?|out|over|stop|hard stop)\\s*(?:by|at|before|around|@)?\\s*${TIME}$`)))) {
        const v = clk(m[1], "practice");
        if (v == null) { unknown.push(raw); continue; }
        ops.push({ op: "anchor", key: "end", value: v }); continue;
      }
      if ((m = s.match(/^(?:start|begin|move (?:everything|the (?:whole )?day|it all)|shift (?:everything|the day)|everything)\s+(?:everything\s+|the day\s+|practice\s+)?(?:up\s+|back\s+|by\s+)?(\d{1,3})\s*(?:minutes?|mins?|min)?\s*(earlier|later|sooner|up|back)?$/)) && (m[2] || /^start|^begin/.test(s))) {
        const dir = /later|back/.test(m[2] || "") ? 1 : -1;
        const cur = (req.anchors && req.anchors.start) ?? (plan && plan.window && plan.window.start) ?? Math.min(...((req.activities || []).filter((a) => a.at != null).map((a) => a.at)), Infinity);
        if (!isFinite(cur)) { unknown.push(raw); note("No start time to move from."); continue; }
        ops.push({ op: "anchor", key: "start", value: cur + dir * +m[1] }); continue;
      }
      if ((m = s.match(new RegExp(`^(?:start|begin|report|be in|everyone in)(?:\\s+(?:the day|everything|practice|the workout))?\\s+(?:at|by|@)\\s*${TIME}$`)))) {
        const v = clk(m[1], "practice"); if (v == null) { unknown.push(raw); continue; }
        ops.push({ op: "anchor", key: "start", value: v }); continue;
      }
      if ((m = s.match(new RegExp(`^(?:move\\s+|make\\s+|change\\s+)?(?:the\\s+)?(?:first pitch|gametime|game(?: time)?)\\s+(?:is\\s+|to\\s+|at\\s+|now\\s+|moved to\\s+|@\\s*)*${TIME}$`)))) {
        const v = clk(m[1], "game"); if (v == null) { unknown.push(raw); continue; }
        ops.push({ op: "anchor", key: "firstPitch", value: v }); continue;
      }
      if ((m = s.match(/^(?:give (?:them|us|everyone|the guys)\s+|make it\s+|make that\s+)?(\d{1,3})\s*(?:minutes?|mins?|min)?\s*(?:off|free(?: time)?|down ?time)\s*(?:before|pre)?\s*(?:the\s+)?(?:game|pregame|first pitch)?$/))) {
        ops.push({ op: "anchor", key: "offBeforeGame", value: +m[1] }); continue;
      }
      if (/^no\s+(?:time\s+)?(?:off|free time|buffer)\s+(?:before|pre)/.test(s)) { ops.push({ op: "anchor", key: "offBeforeGame", value: null }); continue; }
      // lock: "keep game time fixed", "keep pitchers on their throwing schedules", "lock BP"
      if ((m = s.match(/^(?:keep|hold|leave)\s+(.+?)\s+(?:fixed|locked|where (?:it|they) (?:is|are)|as is|in place|the same|pinned|on (?:their |its )?(?:throwing )?(?:schedules?|programs?|time))$/)) ||
          (m = s.match(/^(?:lock|pin|dont move|do not move|dont touch|do not touch)\s+(?:in\s+)?(.+)$/))) {
        each(T(m[1]), (t) => ({ op: "lock", target: t })); continue;
      }
      // indoor: "move hitting indoors"
      if ((m = s.match(/^(?:move|take|put|bring|have|do)?\s*(.+?)\s+(?:indoors?|inside|in the cage|under cover|undercover|to the cage)$/))) {
        const p = clean(m[1]).replace(/^the\s+/, "");
        if (/^(?:all\s+)?(?:the\s+)?(?:hitting|offense|bp|swings|all hitting)$/.test(p)) ops.push({ op: "indoor", target: "all-hitting" });
        else each(T(p), (t) => ({ op: "indoor", target: t }));
        continue;
      }
      // remove: "drop baserunning"
      if (!/\b(?:to|by)\s+\d|\d+\s*(?:minutes?|mins?|min)\b/.test(s) && (m = s.match(/^(?:drop|remove|delete|skip|scratch|cancel|take out|get rid of|lose|eliminate|no more|cut out|cut|no|forget)\s+(?:the\s+)?(.+?)(?:\s+(?:today|block|work|from the (?:day|schedule)))?$/))) {
        each(T(m[1]), (t) => ({ op: "remove", target: t })); continue;
      }
      // shift: "push BP back 15", "move BP 20 minutes earlier", "BP 10 later"
      if ((m = s.match(/^(push|pull|move|bump|slide|shift|delay|have|start)?\s*(?:the\s+)?(.+?)\s+(back|up|forward|ahead|earlier|later|by)?\s*(\d{1,3})\s*(?:minutes?|mins?|min)?\s*(earlier|later|sooner|back|up)?$/)) &&
          (m[3] || m[5] || /push|pull|delay|bump/.test(m[1] || "")) && !(m[3] === "by" && !m[5] && !/push|pull|delay|bump/.test(m[1] || ""))) {
        const dirWord = (m[5] || m[3] || "") + " " + (m[1] || "");
        const sign = /earlier|sooner|up|forward|ahead|pull/.test(dirWord) && !/later|back/.test(m[5] || m[3] || "") ? -1 : 1;
        each(T(m[2]), (t) => t.kind === "game" ? null : ({ op: "shift", target: t, delta: sign * +m[4] }));
        if (ops.length > before && ops.slice(before).some((o) => o === null)) { ops.splice(before); unknown.push(raw); }
        continue;
      }
      // duration: "give pitchers another 15", "shorten team fundy to 20", "cut BP by 10", "make stretch 10 minutes"
      if ((m = s.match(/^give\s+(?:the\s+)?(.+?)\s+(?:another|an extra|extra|(\d{1,3})\s*(?:more\s+)?)\s*(\d{1,3})?\s*(?:more\s+)?(?:minutes?|mins?|min)?(?:\s+more)?$/)) && (m[2] || m[3])) {
        const n = +(m[3] || m[2]); each(T(m[1]), (t) => ({ op: "duration", target: t, delta: n })); continue;
      }
      if ((m = s.match(/^(?:shorten|cut|trim|reduce|lengthen|extend|increase|make|set|change|bump)\s+(?:the\s+)?(.+?)\s+(to|by)\s+(\d{1,3})\s*(?:minutes?|mins?|min)?$/)) && !(m[2] === "to" && isClockish(m[3]) && /^(?:make|set|change)/.test(s) && false)) {
        const v = +m[3];
        if (m[2] === "to") each(T(m[1]), (t) => ({ op: "duration", target: t, set: v }));
        else { const sign = /^(?:shorten|cut|trim|reduce)/.test(s) ? -1 : 1; each(T(m[1]), (t) => ({ op: "duration", target: t, delta: sign * v })); }
        continue;
      }
      if ((m = s.match(/^(?:make|set|have)\s+(?:the\s+)?(.+?)\s+(\d{1,3})\s*(?:minutes?|mins?|min)(?:\s+long)?$/))) { const v = +m[2]; each(T(m[1]), (t) => ({ op: "duration", target: t, set: v })); continue; }
      if ((m = s.match(/^(?:the\s+)?(.+?)\s+(\d{1,3})\s*(?:minutes?|mins?|min)?\s+(longer|shorter|more|less)$/))) { const v = +m[2] * (/shorter|less/.test(m[3]) ? -1 : 1); each(T(m[1]), (t) => ({ op: "duration", target: t, delta: v })); continue; }
      if ((m = s.match(/^(?:take|knock)\s+(\d{1,3})\s*(?:minutes?|mins?|min)?\s+off(?:\s+of)?\s+(?:the\s+)?(.+)$/))) { const v = +m[1]; each(T(m[2]), (t) => ({ op: "duration", target: t, delta: -v })); continue; }
      if ((m = s.match(/^(shorten|cut down|trim|lengthen|extend)\s+(?:the\s+)?(.+)$/))) {
        const v = /shorten|cut|trim/.test(m[1]) ? -10 : 10;
        each(T(m[2]), (t) => ({ op: "duration", target: t, delta: v })); note(`${cap(m[1])}ed by 10 minutes (no amount given).`.replace("Shortened", "Shortened").replace("Cut downed", "Cut down")); continue;
      }
      // at: "lunch at 11:45 instead", "move BP to 3:30", "BP at 3"
      if ((m = s.match(new RegExp(`^(?:move|put|have|make|do|schedule|set|start|switch)?\\s*(?:the\\s+)?(.+?)\\s+(?:at|to|for|@|starts? at|starting at)\\s+${TIME}$`))) && isClockish(m[2])) {
        const targets = T(m[1]);
        if (!targets.length) { unknown.push(raw); continue; }
        targets.forEach((t) => {
          if (t.kind === "game") ops.push({ op: "anchor", key: "firstPitch", value: clk(m[2], "game") });
          else ops.push({ op: "at", target: t, at: clk(m[2], "practice") });
        });
        continue;
      }
      // move: "move defense before hitting", "do PFP after stretch"
      if ((m = s.match(/^(?:move|put|do|have|run|schedule|go with|switch|place)?\s*(?:the\s+)?(.+?)\s+(right after|right before|after|following|before|ahead of|prior to)\s+(?:the\s+)?(.+)$/))) {
        const xs = T(m[1]), ys = T(m[3]);
        if (!xs.length || !ys.length) { unknown.push(raw); continue; }
        const rel = /after|following/.test(m[2]) ? "after" : "before";
        xs.forEach((x) => ops.push(Object.assign({ op: "move", target: x }, { [rel]: ys[0] })));
        if (ys.length > 1) note(`“${m[3]}” covers ${ys.map((y) => y.kind).join(" and ")} — moved relative to the first.`);
        continue;
      }
      if ((m = s.match(/^(?:move|put|do|have)\s+(?:the\s+)?(.+?)\s+(first|last|earlier|later|to the (?:start|end))$/))) {
        const xs = T(m[1]); if (!xs.length) { unknown.push(raw); continue; }
        note(`“${raw}” needs a reference point — say before or after what.`); unknown.push(raw); continue;
      }
      unknown.push(raw);
    }
    return { ops: ops.filter(Boolean), notes, unknown };
  }

  /** follow-up text → EditOp[]; the array also carries `.notes` and `.unknown` (not serialised). */
  function readEdit(text, request, plan, ctx = {}) {
    const r = readEditDetailed(text, request, plan, ctx);
    const ops = r.ops.slice();
    Object.defineProperty(ops, "notes", { value: r.notes, enumerable: false });
    Object.defineProperty(ops, "unknown", { value: r.unknown, enumerable: false });
    return ops;
  }

  return { read, readEdit, readEditDetailed, lexicon, parseClock, parseDuration, normalize, matchActivity, LABEL: "Built-in reader" };
});
