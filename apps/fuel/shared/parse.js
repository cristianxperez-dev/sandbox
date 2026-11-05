/* FUEL — lightweight, rule-based extraction for Quick Entry and legacy notes.

   This is deliberately not "AI": a few explicit rules whose output is always shown to the person for review.
   - The original note text is always kept exactly as typed.
   - A weight is proposed only when the text states one (a number with a weight word or a pound unit). A
     change ("up about 2 pounds", "lost 3 lb") is never treated as a measurement.
   - Two or more candidate weights → the result is marked ambiguous and nothing is preselected.
   - Relative dates ("next Thursday", "in 2 weeks", "yesterday") resolve against the ENTRY date chosen on
     the form, not the computer's clock. */

import { addDays, weekday, WEEKDAYS, MONTHS, parseDate, isISODate } from "./util.js";

const WEIGHT_CUE_BEFORE = /\b(weigh(?:t|ed|s|ing)?|wt|scale|came in at|body ?weight|bw|weigh-?in|now(?: at)?|up to|down to|at|was|is|hit|reached|said|read|showed)\s*(?:was|is|of|at|:|=|-)?\s*(?:about|around|~)?\s*$/i;
const WEIGHT_WORD_NEAR = /\b(weigh(?:t|ed|s|ing)?|wt|scale|body ?weight|weigh-?in)\b/i;
const CHANGE = /\b(up|down|gain(?:ed|ing)?|lost|los(?:e|ing)|drop(?:ped)?|added|put on|increase(?:d)?|decrease(?:d)?|change(?:d)?|difference(?: of)?|by)\s*(?:about|around|roughly|approx(?:imately)?|~|\+|-)?\s*$/i;
const NOT_WEIGHT_AFTER = /^\s*(%|percent|mph|bpm|oz|mg|ml|g\b|grams|cal|kcal|calories|min|minutes|hrs?|hours|years?|yrs?|ft|in\b|"|days?|weeks?|reps?|sets?)/i;

/** Find weights the note states. Returns { candidates: [{value, unit, index, text, date}], ambiguous } */
export function findWeights(text, entryDate) {
  const out = [];
  const re = /(?<![\d.:/])(\d{2,3}(?:\.\d{1,2})?)(?![\d:/])\s*(lbs?\.?|pounds?|#|kgs?|kilos?)?/gi;
  let m;
  while ((m = re.exec(text))) {
    const value = Number(m[1]);
    const unitRaw = (m[2] || "").toLowerCase();
    const unit = /^k/.test(unitRaw) ? "kg" : "lb";
    if (!(unit === "kg" ? value >= 45 && value <= 180 : value >= 100 && value <= 400)) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    // a change, not a measurement: "up about 2 pounds", "gained 4 lb" (but "up to 203" IS a weight)
    if (CHANGE.test(before) && !/\b(up|down)\s+to\s*$/i.test(before)) continue;
    if (!unitRaw && NOT_WEIGHT_AFTER.test(after)) continue;
    const cued = WEIGHT_CUE_BEFORE.test(before) && (WEIGHT_WORD_NEAR.test(text.slice(Math.max(0, m.index - 60), m.index + 40)) || /\b(now|up to|down to|came in at)\s*(?:at)?\s*$/i.test(before));
    if (!unitRaw && !cued) continue;
    out.push({ value, unit, index: m.index, text: m[0].trim(), date: measurementDate(text, m.index, entryDate) });
  }
  const uniq = [];
  for (const c of out) if (!uniq.some((u) => u.value === c.value && u.unit === c.unit)) uniq.push(c);
  return { candidates: uniq, ambiguous: uniq.length > 1 };
}

function measurementDate(text, idx, entryDate) {
  const near = text.slice(Math.max(0, idx - 60), idx + 60).toLowerCase();
  if (/\byesterday\b/.test(near)) return addDays(entryDate, -1);
  const d = near.match(/\b(?:on\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/);
  if (d) { const p = parseDate(d[1], +entryDate.slice(0, 4)); if (p && p <= entryDate) return p; }
  return entryDate; // "this morning", "today", or unstated → the entry date
}

/** Resolve a follow-up phrase relative to the entry date. Returns { date, text } or null. */
export function findFollowUp(text, entryDate) {
  const t = text.toLowerCase();
  const trig = /\b(follow[- ]?up|f\/u|fu|check (?:back|in)|recheck|re-check|touch base|circle back|revisit|weigh (?:him )?(?:again|in))\b/g;
  let m, best = null;
  while ((m = trig.exec(t))) {
    const tail = t.slice(m.index, m.index + 80);
    const r = resolveRelative(tail, entryDate);
    if (r) { best = { date: r.date, text: text.slice(m.index, m.index + Math.min(80, (r.end || 40))).trim().replace(/[.,;]$/, ""), rule: r.rule }; break; }
  }
  return best;
}

/** Relative and absolute date phrases → ISO date, resolved against `base` (the entry date). */
export function resolveRelative(s, base) {
  s = s.toLowerCase();
  let m;
  if ((m = s.match(/\b(?:in|within)\s+(\d+|a|one|two|three|four|five|six)\s+(day|week|month)s?\b/))) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[m[1]] || +m[1];
    const d = m[2] === "day" ? n : m[2] === "week" ? 7 * n : 30 * n;
    return { date: addDays(base, d), rule: `${m[0]} after the entry date`, end: m.index + m[0].length };
  }
  if ((m = s.match(/\btomorrow\b/))) return { date: addDays(base, 1), rule: "tomorrow", end: m.index + m[0].length };
  if ((m = s.match(/\bnext week\b/))) return { date: addDays(base, 7), rule: "one week after the entry date", end: m.index + m[0].length };
  if ((m = s.match(/\b(next|this|on)?\s*(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/))) {
    const want = WEEKDAYS.findIndex((w) => w.startsWith(m[2].slice(0, 3)));
    const cur = weekday(base);
    let d;
    if (m[1] === "next") {
      // "next Thursday" = Thursday of the following week (weeks start Monday)
      const monday = addDays(base, -((cur + 6) % 7));
      d = addDays(monday, 7 + ((want + 6) % 7));
    } else {
      d = addDays(base, ((want - cur + 7) % 7) || 7); // the coming one, never the entry day itself
    }
    return { date: d, rule: `${m[1] === "next" ? "the following week's" : "the coming"} ${WEEKDAYS[want][0].toUpperCase() + WEEKDAYS[want].slice(1)}`, end: m.index + m[0].length };
  }
  if ((m = s.match(/\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/))) {
    let d = parseDate(m[1], +base.slice(0, 4));
    if (d && d < base && !/\/\d{2,4}$/.test(m[1])) d = parseDate(m[1], +base.slice(0, 4) + 1); // "1/5" written in December means next year
    if (d) return { date: d, rule: "date written in the note", end: m.index + m[0].length };
  }
  if ((m = s.match(new RegExp(`\\b(${MONTHS.map((x) => x.slice(0, 3)).join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    let d = parseDate(`${m[1]} ${m[2]}`, +base.slice(0, 4));
    if (d && d < base) d = parseDate(`${m[1]} ${m[2]}`, +base.slice(0, 4) + 1);
    if (d) return { date: d, rule: "date written in the note", end: m.index + m[0].length };
  }
  return null;
}

const TYPE_RULES = [
  ["whatsapp", /\bwhats ?app|\bwa msg\b/i], ["phone", /\b(called|phone(?:d)?|call with|on the phone|spoke by phone)\b/i],
  ["text", /\b(texted|text(?:ed)? him|sms|messaged)\b/i], ["email", /\b(e-?mail(?:ed)?)\b/i],
  ["consultation", /\b(consult(?:ation)?|sat down with|one[- ]on[- ]one|1:1)\b/i],
  ["check_in", /\b(check[- ]?in|checked in)\b/i],
  ["in_person", /\b(met with|in person|after (?:workouts?|bp|batting practice|lifting|practice)|in the (?:cafeteria|kitchen|weight room|clubhouse)|at the facility)\b/i],
];
export function guessType(text) {
  for (const [t, re] of TYPE_RULES) if (re.test(text)) return t;
  return "general";
}

/** Everything Quick Entry proposes for review. Nothing here is saved by itself. */
export function quickParse(text, entryDate) {
  if (!isISODate(entryDate)) throw new Error("entry date must be YYYY-MM-DD");
  const t = String(text || "");
  const w = findWeights(t, entryDate);
  const f = findFollowUp(t, entryDate);
  return {
    note: t,
    type: guessType(t),
    weights: w.candidates,
    weightAmbiguous: w.ambiguous,
    // a single clear weight is preselected; several are listed with none selected (the person picks)
    weight: w.candidates.length === 1 ? { value: w.candidates[0].value, unit: w.candidates[0].unit, date: w.candidates[0].date } : null,
    followup: f ? { date: f.date, description: followupDescription(t, f), rule: f.rule } : null,
  };
}
function followupDescription(text, f) {
  const first = text.split(/(?<=[.!?])\s+/).find((s) => /talk|discuss|plan|increase|add|reduce|shake|breakfast|meal|hydrat|protein|calor|snack|weigh/i.test(s));
  return ("Follow up" + (first ? ": " + first.replace(/\s+/g, " ").trim() : "")).slice(0, 200);
}

/* ------------------------------------------------------------------ legacy spreadsheet notes */
/** Split an accumulated "Nutrition Actions" cell into dated entries.
    "3/14 talked breakfast (CP); 4/2 - added shake -DW" → [{date:"2026-03-14", initials:"CP", text}, …]
    Dates without a year stay unknown unless the importer was given the season year. Initials are only
    taken from a recognizable tag. Text that can't be split is kept whole with date and author unknown. */
export function splitLegacyNotes(raw, { year = null } = {}) {
  const s = String(raw || "").replace(/\r/g, "").trim();
  if (!s) return [];
  const DATE = /(?:^|[\s;|\n•·])((?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)|(?:\d{4}-\d{2}-\d{2})|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?))\s*[:\-–—)]?\s+/gi;
  const marks = [];
  let m;
  while ((m = DATE.exec(s))) marks.push({ at: m.index + (m[0].length - m[0].trimStart().length), dateText: m[1], bodyAt: m.index + m[0].length });
  if (!marks.length) return [entry(s, null, null, year)];
  const out = [];
  if (marks[0].at > 0) {
    const lead = s.slice(0, marks[0].at).trim().replace(/[;|•·]+$/, "").trim();
    if (lead) out.push(entry(lead, null, null, year));
  }
  marks.forEach((mk, i) => {
    const body = s.slice(mk.bodyAt, i + 1 < marks.length ? marks[i + 1].at : s.length).trim().replace(/[;|•·]+$/, "").trim();
    out.push(entry(body, mk.dateText, s.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : s.length).trim(), year));
  });
  return out.filter((e) => e.text);
}
function entry(body, dateText, original, year) {
  let initials = null, text = body;
  const tag = text.match(/(?:\(\s*([A-Z]{2,3})\s*\)|[-–—/]\s*([A-Z]{2,3})|\b([A-Z]{2,3}):)\s*\.?$/) || text.match(/^([A-Z]{2,3})\s*[:\-–—]\s+/);
  if (tag) { initials = tag[1] || tag[2] || tag[3]; text = text.replace(tag[0], "").trim(); }
  const date = dateText ? parseDate(dateText.replace(/\.$/, "").replace(/,/g, ""), year) : null;
  return { text: text.replace(/\s+$/, ""), original: (original || body).trim(), date, dateText: dateText || null, dateUnknown: !date, initials };
}

/** Preseason bullets: "Goal: +5 lb lean; Strengths: hydration; Weakness: breakfast" → structured parts.
    "maintain" alone → a maintain goal. Unlabelled text is kept as the preseason description. */
export function parsePreseason(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (/^maintain\.?$/i.test(s)) return [{ type: "maintain", description: "Maintain" }];
  const parts = [];
  const re = /(goals?|strengths?|weakness(?:es)?|priorit(?:y|ies))\s*[:\-–]\s*([\s\S]*?)(?=(?:goals?|strengths?|weakness(?:es)?|priorit(?:y|ies))\s*[:\-–]|$)/gi;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    const type = k.startsWith("goal") ? "preseason" : k.startsWith("strength") ? "strength" : k.startsWith("weak") ? "weakness" : "priority";
    const text = m[2].trim().replace(/[;,•\s]+$/, "");
    if (text) parts.push({ type, description: text });
  }
  return parts.length ? parts : [{ type: "preseason", description: s }];
}
