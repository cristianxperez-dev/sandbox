/* APERTURE — spaced repetition (a transparent Leitner schedule).
   Boxes 1–6. Interval after landing in a box: 1, 3, 7, 16, 35, 90 days.
   Ratings:  Again → box 1, due in 10 minutes (same session)
             Hard  → same box, due in half that box's interval (at least 1 day)
             Good  → up one box
             Easy  → up two boxes
   Confidence: a "Good" given with low confidence (≤ 2 of 5) is treated as "Hard".
   A concept missed on a quiz sends its cards back to box 1, due now.
   A card in box 4+ counts as retained; a concept is "mastered" when its quiz/check accuracy is
   ≥ 80% over at least 3 items AND all of its activated cards are in box 4 or higher. */

export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35, 90];
export const RULES_TEXT = 'Leitner boxes 1–6 with intervals of 1, 3, 7, 16, 35 and 90 days. Again: back to box 1 (due in 10 minutes). Hard: stay, due in half the interval. Good: up one box. Easy: up two. Low confidence turns Good into Hard. A concept missed on a quiz sends its cards to box 1.';
const DAY = 86400000;

export function schedule(card, rating, confidence, now = Date.now()) {
  let r = rating;
  if (r === 'good' && Number(confidence) > 0 && Number(confidence) <= 2) r = 'hard';
  const c = { ...card, history: [...(card.history || [])] };
  if (r === 'again') { c.box = 1; c.due = now + 10 * 60 * 1000; c.lapses = (c.lapses || 0) + 1; }
  else if (r === 'hard') { c.due = now + Math.max(1, Math.round(INTERVAL_DAYS[c.box] / 2)) * DAY; }
  else if (r === 'good') { c.box = Math.min(6, c.box + 1); c.due = now + INTERVAL_DAYS[c.box] * DAY; }
  else if (r === 'easy') { c.box = Math.min(6, c.box + 2); c.due = now + INTERVAL_DAYS[c.box] * DAY; }
  else throw new Error('bad rating');
  c.reps = (c.reps || 0) + 1;
  c.last = now;
  c.history.push({ at: now, rating, applied: r, box: c.box, confidence: Number(confidence) || null });
  return c;
}
export function relapse(card, now = Date.now()) {
  return { ...card, box: 1, due: now, history: [...(card.history || []), { at: now, rating: 'quiz-miss', applied: 'again', box: 1 }] };
}
export const RATINGS = ['again', 'hard', 'good', 'easy'];
