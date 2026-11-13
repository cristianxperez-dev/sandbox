/* Reused unchanged from AGORA (cpbaseball-site, public/ephyra/apps/agora/pitch-types.js @ f058159) — NMSBSBL keeps its own copy so it never depends on AGORA's deployment. */
/* AGORA — pitch types: names and the standard pitch-type palette.
 *
 * The single definition of pitch colors for every AGORA chart and table
 * (pitch arsenal today; pitcher comparisons and other charts later). Codes are
 * Statcast pitch_type values, kept distinct — SI and FT share the blue family
 * but are separate pitch types; SF (an older splitter label) is a splitter.
 * Types without an assigned color (KC, SV, CS, KN, …) are named correctly
 * and shown in neutral gray until a color is assigned here.
 *
 * Codes: data keeps Statcast's own identifiers (a sweeper is `ST` in every source record and
 * generated file); AGORA shows its display code (Sweeper = `SW`). `SW` is also accepted as
 * input — it maps back to `ST`, never to a new category, and never to SL (slider).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AGORA_PITCHES = factory();
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const NEUTRAL = '#9a948c';
  /** code → { name, color } — color null means "not assigned yet" (neutral gray). */
  const TYPES = {
    FF: { name: 'Four-Seam', color: '#171717' },
    FT: { name: 'Two-Seam', color: '#3478C0' },
    SI: { name: 'Sinker', color: '#1F4F82' }, // blue family, darker than FT so the two stay distinguishable
    SL: { name: 'Slider', color: '#D44B48' },
    CU: { name: 'Curveball', color: '#72283E' },
    FC: { name: 'Cutter', color: '#8FC9A3' },
    CH: { name: 'Changeup', color: '#8554B0' },
    FS: { name: 'Splitter', color: '#246A43' },
    SF: { name: 'Splitter', color: '#246A43' }, // Statcast's usual code is FS; SF is the same pitch under an older label
    ST: { name: 'Sweeper', color: '#C4932F', display: 'SW' }, // muted gold: distinct from SL (red) and every other type
    SV: { name: 'Slurve', color: null },
    KC: { name: 'Knuckle Curve', color: null },
    CS: { name: 'Slow Curve', color: null },
    FO: { name: 'Forkball', color: null },
    SC: { name: 'Screwball', color: null },
    KN: { name: 'Knuckleball', color: null },
    EP: { name: 'Eephus', color: null },
    FA: { name: 'Fastball (unclassified)', color: null },
    PO: { name: 'Pitchout', color: null },
    IN: { name: 'Intentional ball', color: null },
    UN: { name: 'Unknown', color: null },
  };
  /** AGORA display code → Statcast source code (aliases accepted on input). */
  const ALIASES = { SW: 'ST' };
  const source = (code) => { const c = String(code == null ? '' : code).trim().toUpperCase(); return ALIASES[c] || c; };
  /** Statcast source code (or an alias) → the code AGORA shows. */
  const display = (code) => { const s = source(code); return (TYPES[s] && TYPES[s].display) || s; };
  /** code: the display code; source: Statcast's code. */
  const info = (code) => {
    const s = source(code);
    const t = TYPES[s];
    return { code: display(s), source: s, name: t ? t.name : s, color: (t && t.color) || NEUTRAL, assigned: !!(t && t.color) };
  };
  /** A dark point needs a light outline to stay visible on charcoal and dark fills. */
  const needsOutline = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return l < 60;
  };
  return { TYPES, NEUTRAL, ALIASES, info, source, display, needsOutline };
});
