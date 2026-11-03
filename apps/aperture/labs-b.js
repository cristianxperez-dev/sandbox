/* APERTURE — Course B laboratory engines (Biomechanics & Measurement Laboratory).
   Registered into the shared lab framework (labs.js → window.ApertureLabs.engines), so saving, the rules panel,
   "Start again" and progress work exactly as in every other lab.
     frames       The Biomechanics Foundations Lab — rotation sequences, reference frames, moments, kinetic-chain timing.
     measurement  The Measurement Science Laboratory — agreement, typical error, ICC, MDC, real vs apparent change.
   Every number is computed from stated formulas. Illustrative models are labelled as such; all athlete data are
   synthetic and generated in the browser from a seeded random-number generator. */
(function (global) {
  'use strict';
  const L = global.ApertureLabs;
  if (!L) return;
  const AP = global.AP;
  const h = (tag, attrs, ...kids) => AP.h(tag, attrs, ...kids);
  const D = Math.PI / 180;
  const fmt = (x, d = 1) => (Number.isFinite(x) ? (Math.round(x * 10 ** d) / 10 ** d).toFixed(d) : '—');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ------------------------------------------------------------ rotation mathematics */
  const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
  const tr = (A) => A[0].map((_, j) => A.map((r) => r[j]));
  const apply = (R, v) => R.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  function axisRot(ax, t) { const c = Math.cos(t), s = Math.sin(t); return ax === 'X' ? [[1, 0, 0], [0, c, -s], [0, s, c]] : ax === 'Y' ? [[c, 0, s], [0, 1, 0], [-s, 0, c]] : [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  // Intrinsic (rotating-axes) sequence: R = R_a1(θ1) · R_a2(θ2) · R_a3(θ3).
  function compose(seq, deg) { return seq.split('').reduce((R, ax, i) => mul(R, axisRot(ax, deg[i] * D)), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]); }
  const IDX = { X: 0, Y: 1, Z: 2 };
  function extract(seq, R) {
    if (seq === 'YXY') { // proper Euler sequence used by the ISB for the humerus relative to the thorax
      const b = Math.acos(clamp(R[1][1], -1, 1));
      return [Math.atan2(R[0][1], R[2][1]) / D, b / D, Math.atan2(R[1][0], -R[1][2]) / D];
    }
    const p = IDX[seq[0]], q = IDX[seq[1]], r = IDX[seq[2]];
    const e = (q - p + 3) % 3 === 1 ? 1 : -1;
    const b = Math.asin(clamp(e * R[p][r], -1, 1));
    return [Math.atan2(-e * R[q][r], R[r][r]) / D, b / D, Math.atan2(-e * R[p][q], R[p][p]) / D];
  }
  const SEQS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX', 'YXY'];

  /* ------------------------------------------------------------ small SVG helpers */
  const NS = 'http://www.w3.org/2000/svg';
  function svg(w, hgt, label) { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${hgt}`); s.setAttribute('class', 'bl-svg'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); return s; }
  function el(name, attrs, text) { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; }
  // Oblique view of 3D points: azimuth/elevation of the camera.
  function projector(cx, cy, scale, az, elv) {
    const ca = Math.cos(az * D), sa = Math.sin(az * D), ce = Math.cos(elv * D), se = Math.sin(elv * D);
    return (v) => { const x = v[0] * ca - v[2] * sa; const z = v[0] * sa + v[2] * ca; const y = v[1] * ce - z * se; return [cx + x * scale, cy - y * scale, z * ce + v[1] * se]; };
  }
  function slider(label, value, min, max, step, onInput, unit = '°') {
    const out = h('output', { class: 'bl-val num', text: `${value}${unit}` });
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label, oninput: (e) => { out.textContent = `${e.target.value}${unit}`; onInput(Number(e.target.value)); } });
    return h('label', { class: 'bl-slider' }, h('span', { class: 'bl-slider__l', text: label }), input, out);
  }
  function select(label, options, value, onChange) {
    const s = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) }, options.map(([v, t]) => h('option', { value: v, text: t, selected: v === value })));
    return h('label', { class: 'bl-slider' }, h('span', { class: 'bl-slider__l', text: label }), s);
  }
  function tag(text, cls) { return h('span', { class: `bl-tag ${cls || ''}`, text }); }

  /* ------------------------------------------------------------ prediction tasks (shared) */
  // A task asks the learner to commit to a number or a choice BEFORE checking; the engine computes the truth from the
  // same mathematics it displays, so nothing is hidden and nothing is invented.
  function taskBlock(ctx, st, task, truthFn, onChange) {
    const prev = st.answers[task.id];
    const box = h('div', { class: 'bl-task' + (prev && prev.checked ? ' is-checked' : '') }, h('span', { class: 'lab-label', text: 'Predict, then check' }), h('p', { html: ctx.inline(task.prompt) }));
    let input;
    if (task.type === 'choice') {
      input = h('div', { class: 'bl-choices', role: 'radiogroup', 'aria-label': task.prompt }, task.options.map((o) => h('label', { class: 'bl-choice' }, h('input', { type: 'radio', name: `t-${task.id}`, value: o.id, checked: prev && prev.value === o.id, disabled: prev && prev.checked }), h('span', { html: ctx.inline(o.text) }))));
    } else {
      input = h('input', { type: 'number', step: 'any', inputmode: 'decimal', class: 'bl-num', value: prev ? prev.value : '', disabled: prev && prev.checked, 'aria-label': `Your prediction${task.unit ? ` (${task.unit})` : ''}` });
    }
    const fb = h('div', { class: 'bl-fb', 'aria-live': 'polite' });
    const show = () => {
      const r = st.answers[task.id]; if (!r || !r.checked) return;
      const t = truthFn();
      AP.clear(fb).append(h('p', null, h('b', { text: r.correct ? (task.type === 'choice' ? 'Correct. ' : 'Within tolerance. ') : 'Not this time. ' }),
        task.type === 'choice' ? (r.correct ? '' : `Correct answer: ${task.options.find((o) => o.id === t.answer)?.text || t.answer}. `) : `Computed value: ${fmt(t.answer, task.decimals ?? 1)}${task.unit || ''} (you said ${r.value}${task.unit || ''}; tolerance ±${task.tolerance}${task.unit || ''}). `,
        h('span', { html: ctx.inline(task.explain || '') })));
    };
    const check = h('button', { class: 'btn btn--small', type: 'button', text: 'Check', disabled: prev && prev.checked, onclick: () => {
      const t = truthFn();
      let value, correct;
      if (task.type === 'choice') { const c = input.querySelector('input:checked'); if (!c) return ctx.announce('Choose an answer first.'); value = c.value; correct = value === t.answer; }
      else { value = Number(input.value); if (input.value === '' || !Number.isFinite(value)) return ctx.announce('Enter a number first.'); correct = Math.abs(value - t.answer) <= task.tolerance; }
      st.answers[task.id] = { value, correct, checked: true, at: Date.now() };
      onChange(); show(); check.disabled = true; box.classList.add('is-checked');
      input.querySelectorAll ? input.querySelectorAll('input').forEach((i) => (i.disabled = true)) : null; if (input.tagName === 'INPUT') input.disabled = true;
    } });
    box.append(input, h('div', { class: 'lab-actions' }, check), fb);
    show();
    return box;
  }
  function tasksSummary(st, tasks) {
    const done = tasks.filter((t) => st.answers[t.id] && st.answers[t.id].checked);
    const right = done.filter((t) => st.answers[t.id].correct).length;
    return { label: done.length === tasks.length ? `Complete — ${right} of ${tasks.length} predictions within tolerance` : `In progress — ${done.length} of ${tasks.length} predictions checked`, metrics: { Checked: done.length, Correct: right, Tasks: tasks.length } };
  }
  function stationTabs(stations, active, onPick) {
    return h('div', { class: 'bl-tabs', role: 'tablist' }, stations.map(([id, label], i) => h('button', { type: 'button', role: 'tab', class: 'bl-tab', 'aria-selected': String(id === active), onclick: () => onPick(id), text: `${i + 1}. ${label}` })));
  }

  /* ===================================================================== frames */
  L.engines.frames = function (ctx) {
    const cfg = ctx.cfg;
    const tasks = Array.isArray(cfg.tasks) ? cfg.tasks : [];
    const STATIONS = [['rotation', 'Rotation sequences'], ['frames', 'Reference frames'], ['moment', 'Force & moment'], ['chain', 'Kinetic-chain timing']];
    let st = { station: 'rotation', answers: {}, rot: { seq: 'ZXY', ang: [30, 60, 20] }, view: { az: 35, el: 20 }, frame: { tilt: 30, abd: 90 }, mom: { F: 400, r: 0.3, th: 90 }, chain: { gap: 40, preset: 'a' } };
    if (ctx.saved && ctx.saved.state) st = { ...st, ...ctx.saved.state, answers: ctx.saved.state.answers || {} };
    const finished = () => tasks.length > 0 && tasks.every((t) => st.answers[t.id] && st.answers[t.id].checked);
    ctx.setPayload(() => ({ state: st, finished: finished(), summary: tasksSummary(st, tasks) }));
    let summaryEl = null;
    const changed = () => { ctx.touch(); if (summaryEl) summaryEl.textContent = tasksSummary(st, tasks).label; };

    ctx.body.appendChild(ctx.rulesPanel([
      'Orientations are rotation matrices built from intrinsic (rotating-axes) sequences: R = R₁(θ₁)·R₂(θ₂)·R₃(θ₃). Angles reported under another sequence are extracted from the same matrix exactly — the motion never changes, only its description.',
      'Axes: X points forward (anterior), Y up (superior), Z to the right (lateral), as in a right-handed laboratory frame. Positive rotations follow the right-hand rule.',
      'Tait–Bryan sequences (three different axes) become singular when the middle angle reaches ±90° (gimbal lock); the ISB Y–X–Y sequence for the humerus is singular when the middle (elevation) angle is 0° or 180°.',
      'Moment: τ = r · F · sin θ, where θ is the angle between the position vector and the force; the moment arm is d = r · sin θ.',
      'The kinetic-chain station is an ILLUSTRATIVE timing model (bell-shaped angular-velocity curves). It shows sequence and timing only; it does not compute ball or bat speed and makes no causal claim.',
    ]));
    const host = h('div', { class: 'bl-host' });
    ctx.body.appendChild(host);
    const truths = {
      reported: (t) => () => { const R = compose(t.setSeq, t.setAng); return { answer: extract(t.readSeq, R)[t.readIndex] }; },
      frameElev: (t) => () => ({ answer: elevationGlobal(t.tilt, t.abd) }),
      moment: (t) => () => ({ answer: t.r * t.F * Math.sin(t.th * D) }),
      choice: (t) => () => ({ answer: t.answer }),
      value: (t) => () => ({ answer: t.answer }),
    };
    function render() {
      AP.clear(host);
      host.appendChild(stationTabs(STATIONS, st.station, (id) => { st.station = id; changed(); render(); }));
      const view = h('div', { class: 'bl-station' });
      host.appendChild(view);
      if (st.station === 'rotation') rotationStation(view);
      if (st.station === 'frames') framesStation(view);
      if (st.station === 'moment') momentStation(view);
      if (st.station === 'chain') chainStation(view);
      const mine = tasks.filter((t) => t.station === st.station);
      if (mine.length) view.appendChild(h('div', { class: 'bl-tasks' }, mine.map((t) => taskBlock(ctx, st, t, (truths[t.check] || truths.choice)(t), changed))));
      summaryEl = h('p', { class: 'small muted', 'aria-live': 'polite', text: tasksSummary(st, tasks).label });
      host.appendChild(summaryEl);
    }

    /* --- station 1: rotation sequences --- */
    function rotationStation(view) {
      const scene = h('div', { class: 'bl-scene' });
      const table = h('div', { class: 'bl-tablewrap' });
      const draw = () => {
        const R = compose(st.rot.seq, st.rot.ang);
        AP.clear(scene).appendChild(drawFrames(R, `Segment orientation set by the ${st.rot.seq} sequence`));
        const rows = SEQS.map((s) => { const a = extract(s, R); const sing = s === 'YXY' ? (a[1] < 3 || a[1] > 177) : Math.abs(a[1]) > 87; return h('tr', { class: s === st.rot.seq ? 'is-set' : '' }, h('th', { text: s + (s === 'YXY' ? ' (ISB humerus)' : '') }), ...a.map((x) => h('td', { class: 'num', text: `${fmt(x)}°` })), h('td', null, sing ? tag('near gimbal lock', 'bl-tag--warn') : null)); });
        AP.clear(table).appendChild(h('table', { class: 'bl-table' }, h('caption', { text: 'The same orientation, reported under each sequence (1st, 2nd, 3rd rotation)' }), h('thead', null, h('tr', null, ['Sequence', '1st', '2nd', '3rd', ''].map((x) => h('th', { text: x })))), h('tbody', null, rows)));
      };
      const controls = h('div', { class: 'bl-controls' },
        select('Sequence used to set the orientation', SEQS.filter((s) => s !== 'YXY').map((s) => [s, s]), st.rot.seq, (v) => { st.rot.seq = v; changed(); draw(); }),
        ...[0, 1, 2].map((i) => slider(`Rotation ${i + 1}`, st.rot.ang[i], i === 1 ? -89 : -180, i === 1 ? 89 : 180, 1, (v) => { st.rot.ang[i] = v; changed(); draw(); })),
        slider('Camera azimuth', st.view.az, -180, 180, 1, (v) => { st.view.az = v; draw(); }),
        slider('Camera elevation', st.view.el, -60, 60, 1, (v) => { st.view.el = v; draw(); }));
      view.append(h('p', { class: 'bl-lede', text: 'Set a segment’s orientation with one rotation sequence. The table re-describes the identical orientation under every other sequence. The motion is the same; the reported angles are not.' }), h('div', { class: 'bl-split' }, scene, controls), table);
      draw();
    }
    function drawFrames(R, label) {
      const s = svg(360, 280, label);
      const P = projector(180, 150, 95, st.view.az, st.view.el);
      const line = (a, b, cls, w = 2) => { const p = P(a), q = P(b); s.appendChild(el('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: cls, 'stroke-width': w })); };
      const txt = (v, t, cls) => { const p = P(v); s.appendChild(el('text', { x: p[0] + 4, y: p[1] - 4, class: cls }, t)); };
      // laboratory (global) axes
      [[1.25, 0, 0, 'X'], [0, 1.25, 0, 'Y'], [0, 0, 1.25, 'Z']].forEach(([x, y, z, n]) => { line([0, 0, 0], [x, y, z], 'bl-gaxis', 1); txt([x, y, z], `${n} lab`, 'bl-glabel'); });
      // segment: a long box along local Y (e.g. the humerus), drawn from its rotated corners
      const corners = []; for (const x of [-0.12, 0.12]) for (const y of [-0.05, 1]) for (const z of [-0.12, 0.12]) corners.push(apply(R, [x, y - 0.05, z]));
      const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      edges.forEach(([a, b]) => line(corners[a], corners[b], 'bl-seg', 1.5));
      // local (segment-fixed) axes
      [[0.8, 0, 0, 'x', 'bl-lx'], [0, 1.15, 0, 'y', 'bl-ly'], [0, 0, 0.8, 'z', 'bl-lz']].forEach(([x, y, z, n, c]) => { const v = apply(R, [x, y, z]); line([0, 0, 0], v, c, 2.5); txt(v, n, `bl-llabel ${c}`); });
      return s;
    }

    /* --- station 2: reference frames --- */
    function elevationGlobal(tilt, abd) {
      // Trunk tilted laterally (rotation about the forward X axis) by `tilt` degrees; the arm is abducted `abd` degrees
      // from the trunk's downward long axis, in the trunk's frontal plane. Returns the arm's angle from the lab's
      // downward vertical (0° = hanging straight down in the lab).
      const T = axisRot('X', -tilt * D); // tilt toward the glove side (−Z for a right-handed thrower)
      const armTrunk = [0, -Math.cos(abd * D), Math.sin(abd * D)]; // in trunk frame: down (−Y) rotated toward +Z (lateral)
      const armLab = apply(T, armTrunk);
      return Math.acos(clamp(-armLab[1], -1, 1)) / D;
    }
    function framesStation(view) {
      const out = h('div', { class: 'bl-readout' });
      const scene = h('div', { class: 'bl-scene' });
      const draw = () => {
        const g = elevationGlobal(st.frame.tilt, st.frame.abd);
        AP.clear(out).append(h('dl', { class: 'kv' },
          h('dt', { text: 'Arm abduction relative to the trunk' }), h('dd', { class: 'num', text: `${fmt(st.frame.abd)}°` }),
          h('dt', { text: 'Arm elevation relative to the laboratory vertical' }), h('dd', { class: 'num', text: `${fmt(g)}°` }),
          h('dt', { text: 'Difference created by the reference frame alone' }), h('dd', { class: 'num', text: `${fmt(g - st.frame.abd)}°` })));
        const s = svg(360, 260, 'Front view: trunk and arm with laboratory and trunk reference axes');
        const cx = 180, cy = 150, T = (deg, len) => [cx + len * Math.sin(deg * D), cy + len * Math.cos(deg * D)];
        s.appendChild(el('line', { x1: cx, y1: 20, x2: cx, y2: 250, class: 'bl-gaxis', 'stroke-dasharray': '4 4' }));
        s.appendChild(el('text', { x: cx + 4, y: 30, class: 'bl-glabel' }, 'lab vertical'));
        const top = [cx - 110 * Math.sin(st.frame.tilt * D), cy - 110 * Math.cos(st.frame.tilt * D)];
        s.appendChild(el('line', { x1: cx, y1: cy, x2: top[0], y2: top[1], class: 'bl-seg', 'stroke-width': 10, 'stroke-linecap': 'round' }));
        s.appendChild(el('text', { x: top[0] - 30, y: top[1] - 8, class: 'bl-glabel' }, 'trunk'));
        const sh = [cx - 70 * Math.sin(st.frame.tilt * D) + 22 * Math.cos(st.frame.tilt * D), cy - 70 * Math.cos(st.frame.tilt * D) - 22 * Math.sin(st.frame.tilt * D)];
        const armDir = st.frame.abd + st.frame.tilt; // in the picture plane, from the lab's downward vertical toward the throwing side
        const hand = [sh[0] + 90 * Math.sin(armDir * D), sh[1] + 90 * Math.cos(armDir * D)];
        s.appendChild(el('line', { x1: sh[0], y1: sh[1], x2: hand[0], y2: hand[1], class: 'bl-ly', 'stroke-width': 6, 'stroke-linecap': 'round' }));
        s.appendChild(el('text', { x: hand[0] + 6, y: hand[1], class: 'bl-llabel bl-ly' }, 'arm'));
        AP.clear(scene).appendChild(s);
      };
      view.append(h('p', { class: 'bl-lede', text: 'A thrower’s trunk tilts toward the glove side. The arm’s position relative to the trunk can stay constant while its angle relative to the laboratory changes — two correct numbers describing different things.' }),
        h('div', { class: 'bl-split' }, scene, h('div', { class: 'bl-controls' },
          slider('Lateral trunk tilt (toward glove side)', st.frame.tilt, 0, 45, 1, (v) => { st.frame.tilt = v; changed(); draw(); }),
          slider('Arm abduction relative to the trunk', st.frame.abd, 0, 150, 1, (v) => { st.frame.abd = v; changed(); draw(); }), out)),
        h('p', { class: 'small muted', text: 'Simplified planar model in the frontal plane (no horizontal abduction or rotation), so the two angles differ by exactly the tilt. In three dimensions the relationship is not a simple subtraction — which is why sequences and frames must be reported.' }));
      draw();
    }

    /* --- station 3: force and moment --- */
    function momentStation(view) {
      const out = h('div', { class: 'bl-readout' });
      const scene = h('div', { class: 'bl-scene' });
      const draw = () => {
        const { F, r, th } = st.mom; const tau = r * F * Math.sin(th * D); const d = r * Math.sin(th * D);
        AP.clear(out).append(h('dl', { class: 'kv' }, h('dt', { text: 'Moment arm d = r·sin θ' }), h('dd', { class: 'num', text: `${fmt(d, 3)} m` }), h('dt', { text: 'Moment τ = r·F·sin θ' }), h('dd', { class: 'num', text: `${fmt(tau, 1)} N·m` }), h('dt', { text: 'Direction (right-hand rule)' }), h('dd', { text: tau > 0.01 ? 'counter-clockwise (out of the page)' : tau < -0.01 ? 'clockwise (into the page)' : 'none — force acts through the axis' })));
        const s = svg(360, 240, 'Force applied at a distance from an axis'); const ox = 70, oy = 170, sc = 380;
        const px = ox + r * sc, py = oy;
        s.appendChild(el('circle', { cx: ox, cy: oy, r: 6, class: 'bl-axisdot' })); s.appendChild(el('text', { x: ox - 20, y: oy + 22, class: 'bl-glabel' }, 'axis'));
        s.appendChild(el('line', { x1: ox, y1: oy, x2: px, y2: py, class: 'bl-seg', 'stroke-width': 5 }));
        s.appendChild(el('text', { x: (ox + px) / 2, y: oy + 20, class: 'bl-glabel' }, `r = ${r} m`));
        const fl = 40 + F / 10; const fx = px + fl * Math.cos(-th * D), fy = py + fl * Math.sin(-th * D);
        s.appendChild(el('line', { x1: px, y1: py, x2: fx, y2: fy, class: 'bl-lx', 'stroke-width': 3, 'marker-end': 'url(#bl-arrow)' }));
        const defs = el('defs'); const m = el('marker', { id: 'bl-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }); m.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'bl-arrowhead' })); defs.appendChild(m); s.appendChild(defs);
        s.appendChild(el('text', { x: fx + 6, y: fy, class: 'bl-llabel bl-lx' }, `F = ${F} N`));
        // perpendicular distance from the axis to the force's line of action
        const ux = Math.cos(-th * D), uy = Math.sin(-th * D); const t = (ox - px) * ux + (oy - py) * uy; const qx = px + t * ux, qy = py + t * uy;
        s.appendChild(el('line', { x1: px - 200 * ux, y1: py - 200 * uy, x2: px + 200 * ux, y2: py + 200 * uy, class: 'bl-gaxis', 'stroke-dasharray': '3 4' }));
        s.appendChild(el('line', { x1: ox, y1: oy, x2: qx, y2: qy, class: 'bl-ly', 'stroke-width': 2 }));
        AP.clear(scene).appendChild(s);
      };
      view.append(h('p', { class: 'bl-lede', text: 'A moment depends on force, distance and direction together. The same force produces no moment when it passes through the axis and the largest moment when it is perpendicular to the lever.' }),
        h('div', { class: 'bl-split' }, scene, h('div', { class: 'bl-controls' },
          slider('Force F', st.mom.F, 0, 1000, 10, (v) => { st.mom.F = v; changed(); draw(); }, ' N'),
          slider('Distance r', st.mom.r, 0.05, 0.5, 0.01, (v) => { st.mom.r = v; changed(); draw(); }, ' m'),
          slider('Angle θ between r and F', st.mom.th, 0, 180, 1, (v) => { st.mom.th = v; changed(); draw(); }), out)));
      draw();
    }

    /* --- station 4: kinetic-chain timing (illustrative) --- */
    function chainStation(view) {
      const SEG = [['Pelvis', 0.24], ['Trunk', 0.36], ['Elbow extension', 0.62], ['Shoulder internal rotation', 1]];
      const PRESETS = { a: { gap: 40, label: 'Athlete A — evenly spaced peaks' }, b: { gap: 20, label: 'Athlete B — compressed timing' } };
      const scene = h('div', { class: 'bl-scene' });
      const out = h('div', { class: 'bl-readout' });
      const draw = () => {
        const g = st.chain.gap; const peaks = SEG.map((_, i) => 60 + i * g);
        const s = svg(380, 220, 'Illustrative angular-velocity curves of four segments with adjustable timing');
        const x = (t) => 30 + t * 1.6, y = (v) => 190 - v * 160;
        s.appendChild(el('line', { x1: 30, y1: 190, x2: 370, y2: 190, class: 'bl-gaxis' }));
        s.appendChild(el('text', { x: 300, y: 210, class: 'bl-glabel' }, 'time (ms) →'));
        const cls = ['bl-c1', 'bl-c2', 'bl-c3', 'bl-c4'];
        SEG.forEach(([name, amp], i) => {
          let d = ''; for (let t = 0; t <= 210; t += 3) { const v = amp * Math.exp(-((t - peaks[i]) ** 2) / (2 * (14 + 4 * i) ** 2)); d += `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; }
          s.appendChild(el('path', { d, class: `bl-curve ${cls[i]}` }));
          s.appendChild(el('text', { x: x(peaks[i]) + 3, y: y(amp) - 4, class: `bl-llabel ${cls[i]}` }, name));
        });
        AP.clear(scene).appendChild(s);
        AP.clear(out).append(h('dl', { class: 'kv' }, ...SEG.flatMap(([n], i) => [h('dt', { text: `${n} peak` }), h('dd', { class: 'num', text: `${peaks[i]} ms` })]), h('dt', { text: 'Sequence' }), h('dd', { text: 'proximal → distal' })),
          h('p', { class: 'small muted', text: 'Illustrative curves with fixed relative heights (not data). Changing timing here does not change any modeled ball speed — the model has none. Real sequencing studies are mostly cross-sectional and between-athlete; they show association, not that changing an athlete’s timing would raise velocity.' }));
      };
      view.append(h('p', { class: 'bl-lede', text: 'Segment angular-velocity peaks are usually reported in a proximal-to-distal order. Adjust the gap between peaks and compare two athletes whose timing differs.' }),
        h('div', { class: 'bl-split' }, scene, h('div', { class: 'bl-controls' },
          select('Preset', Object.entries(PRESETS).map(([k, p]) => [k, p.label]), st.chain.preset, (v) => { st.chain.preset = v; st.chain.gap = PRESETS[v].gap; changed(); render(); }),
          slider('Gap between successive peaks', st.chain.gap, 5, 60, 1, (v) => { st.chain.gap = v; changed(); draw(); }, ' ms'), out)), tag('Illustrative model', 'bl-tag--illus'));
      draw();
    }
    render();
  };

  /* ===================================================================== measurement */
  // Seeded RNG (mulberry32) and standard-normal draws (Box–Muller).
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function normal(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  // ICC(3,1), two-way mixed, consistency, single measure (Shrout & Fleiss), from an n × k table.
  function icc31(rows) {
    const n = rows.length, k = rows[0].length, all = rows.flat(), gm = mean(all);
    const ssr = k * rows.reduce((s, r) => s + (mean(r) - gm) ** 2, 0);
    const colM = rows[0].map((_, j) => mean(rows.map((r) => r[j])));
    const ssc = n * colM.reduce((s, c) => s + (c - gm) ** 2, 0);
    const sst = all.reduce((s, x) => s + (x - gm) ** 2, 0);
    const sse = sst - ssr - ssc;
    const msr = ssr / (n - 1), mse = sse / ((n - 1) * (k - 1));
    return (msr - mse) / (msr + (k - 1) * mse);
  }
  L.engines.measurement = function (ctx) {
    const cfg = ctx.cfg;
    const tasks = Array.isArray(cfg.tasks) ? cfg.tasks : [];
    const unit = cfg.unit || '°';
    const base = { bias: 6, randA: 1.5, randB: 4, bio: 2.5, between: 8, change: 4, n: 10, seed: 11, ...(cfg.defaults || {}) };
    let st = { p: { ...base }, answers: {}, tab: 'agreement' };
    if (ctx.saved && ctx.saved.state) st = { ...st, ...ctx.saved.state, p: { ...base, ...(ctx.saved.state.p || {}) }, answers: ctx.saved.state.answers || {} };
    const finished = () => tasks.length > 0 && tasks.every((t) => st.answers[t.id] && st.answers[t.id].checked);
    ctx.setPayload(() => ({ state: st, finished: finished(), summary: tasksSummary(st, tasks) }));
    let summaryEl = null;
    const changed = () => { ctx.touch(); if (summaryEl) summaryEl.textContent = tasksSummary(st, tasks).label; };

    // Simulation for parameters p (deterministic for a given seed).
    function simulate(p) {
      const r = rng(p.seed);
      const T = cfg.trueMean ?? 175;
      // One athlete, two sessions of n trials; session 2 has a true change.
      const sessions = [0, p.change].map((delta) => Array.from({ length: p.n }, () => { const truth = T + delta + p.bio * normal(r); return { truth, A: truth + p.randA * normal(r), B: truth + p.bias + p.randB * normal(r) }; }));
      // A squad of 20 athletes, each measured twice in a stable period (no change), by each system.
      const squad = Array.from({ length: 20 }, () => { const own = T + p.between * normal(r); const t1 = own + p.bio * normal(r), t2 = own + p.bio * normal(r); return { A: [t1 + p.randA * normal(r), t2 + p.randA * normal(r)], B: [t1 + p.bias + p.randB * normal(r), t2 + p.bias + p.randB * normal(r)] }; });
      const s1 = sessions[0], s2 = sessions[1];
      const diffs = s1.map((x) => x.B - x.A); const bias = mean(diffs), sdd = sd(diffs);
      const te = (sys) => sd(squad.map((a) => a[sys][1] - a[sys][0])) / Math.SQRT2;
      const teA = te('A'), teB = te('B');
      const mdc = (t) => 1.96 * Math.SQRT2 * t;
      const obs = (sys) => mean(s2.map((x) => x[sys])) - mean(s1.map((x) => x[sys]));
      return { sessions, squad, bias, sdd, loa: [bias - 1.96 * sdd, bias + 1.96 * sdd], teA, teB, iccA: icc31(squad.map((a) => a.A)), iccB: icc31(squad.map((a) => a.B)), mdcA: mdc(teA), mdcB: mdc(teB), mdcMeanA: mdc(teA) / Math.sqrt(p.n), mdcMeanB: mdc(teB) / Math.sqrt(p.n), obsA: obs('A'), obsB: obs('B') };
    }

    ctx.body.appendChild(ctx.rulesPanel([
      `Synthetic data, generated in your browser: true value per trial = athlete mean + within-athlete biological variability (SD = “biological”). System A = truth + random error (SD A). System B = truth + systematic bias + random error (SD B). Session 2 adds the true change.`,
      'Bland–Altman agreement (session 1, the same trials measured by both systems): bias = mean(B − A); limits of agreement = bias ± 1.96 × SD(B − A).',
      'Typical error (TE), per system, from a squad of 20 synthetic athletes measured twice in a stable period: TE = SD(trial 2 − trial 1) / √2. It contains biological and technical variability together.',
      'ICC(3,1) (two-way mixed, consistency, single measure) from the same squad. ICC depends on how different the athletes are from one another (between-athlete SD), not only on measurement quality.',
      'Minimal detectable change, 95%: MDC95 = 1.96 × √2 × TE for single trials; for means of n trials, MDC95 ÷ √n (assumes independent trials).',
      'An observed change smaller than the MDC cannot be distinguished from measurement error and normal variability at that confidence level. A change larger than the MDC is likely real, but whether it matters is a separate, practical question.',
    ]));
    const host = h('div', { class: 'bl-host' });
    ctx.body.appendChild(host);
    const truthFor = (t) => () => {
      const R = simulate({ ...st.p, ...(t.setup || {}) });
      if (t.check === 'bias') return { answer: R.bias };
      if (t.check === 'teB') return { answer: R.teB };
      if (t.check === 'mdcB') return { answer: R.mdcB };
      if (t.check === 'realB') return { answer: Math.abs(R.obsB) > R.mdcMeanB ? 'yes' : 'no' };
      if (t.check === 'realA') return { answer: Math.abs(R.obsA) > R.mdcMeanA ? 'yes' : 'no' };
      if (t.check === 'obsB') return { answer: R.obsB };
      return { answer: t.answer };
    };
    function render() {
      AP.clear(host);
      const p = st.p; const R = simulate(p);
      const set = (k) => (v) => { st.p[k] = v; changed(); render(); };
      const controls = h('div', { class: 'bl-controls bl-controls--wide' },
        slider('System B bias', p.bias, -10, 10, 0.5, set('bias'), unit),
        slider('System A random error (SD)', p.randA, 0, 8, 0.5, set('randA'), unit),
        slider('System B random error (SD)', p.randB, 0, 8, 0.5, set('randB'), unit),
        slider('Within-athlete biological variability (SD)', p.bio, 0, 8, 0.5, set('bio'), unit),
        slider('Between-athlete spread (SD, squad)', p.between, 1, 15, 0.5, set('between'), unit),
        slider('True change, session 1 → 2', p.change, -10, 10, 0.5, set('change'), unit),
        slider('Trials per session (n)', p.n, 3, 30, 1, set('n'), ''),
        h('div', { class: 'lab-actions' }, h('button', { class: 'btn btn--small', type: 'button', text: 'New random sample', onclick: () => { st.p.seed = (st.p.seed * 7 + 13) % 100000; changed(); render(); } }), h('button', { class: 'btn btn--small btn--quiet', type: 'button', text: 'Reset settings', onclick: () => { st.p = { ...base }; changed(); render(); } })));
      host.append(h('p', { class: 'bl-lede', html: ctx.inline(`**${cfg.variable || 'Peak shoulder external rotation'}** for ${cfg.athlete || 'a synthetic pitcher'}, measured by a laboratory marker-based system (A) and a field markerless system (B). Change the error structure and see what each statistic can and cannot tell you.`) }), tag('Synthetic data', 'bl-tag--illus'), controls);
      const tabs = [['agreement', 'Agreement'], ['traces', 'Synchronized traces'], ['reliability', 'Reliability & MDC'], ['change', 'Is the change real?']];
      host.appendChild(stationTabs(tabs, st.tab, (id) => { st.tab = id; changed(); render(); }));
      const view = h('div', { class: 'bl-station' });
      host.appendChild(view);
      if (st.tab === 'agreement') view.append(blandAltman(R), h('dl', { class: 'kv' }, h('dt', { text: 'Bias (B − A)' }), h('dd', { class: 'num', text: `${fmt(R.bias)}${unit}` }), h('dt', { text: '95% limits of agreement' }), h('dd', { class: 'num', text: `${fmt(R.loa[0])} to ${fmt(R.loa[1])}${unit}` }), h('dt', { text: 'Correlation can still be high' }), h('dd', { text: 'A constant bias does not lower correlation at all — which is why agreement, not correlation, decides whether two systems are interchangeable.' })));
      if (st.tab === 'traces') view.append(traces(R));
      if (st.tab === 'reliability') view.append(h('table', { class: 'bl-table' }, h('thead', null, h('tr', null, ['', 'System A', 'System B'].map((x) => h('th', { text: x })))), h('tbody', null,
        h('tr', null, h('th', { text: 'Typical error (TE)' }), h('td', { class: 'num', text: `${fmt(R.teA, 2)}${unit}` }), h('td', { class: 'num', text: `${fmt(R.teB, 2)}${unit}` })),
        h('tr', null, h('th', { text: 'ICC(3,1)' }), h('td', { class: 'num', text: fmt(R.iccA, 2) }), h('td', { class: 'num', text: fmt(R.iccB, 2) })),
        h('tr', null, h('th', { text: 'MDC95, single trial' }), h('td', { class: 'num', text: `${fmt(R.mdcA)}${unit}` }), h('td', { class: 'num', text: `${fmt(R.mdcB)}${unit}` })),
        h('tr', null, h('th', { text: `MDC95, mean of ${p.n} trials` }), h('td', { class: 'num', text: `${fmt(R.mdcMeanA)}${unit}` }), h('td', { class: 'num', text: `${fmt(R.mdcMeanB)}${unit}` })))),
        h('p', { class: 'small muted', text: 'Try raising the between-athlete spread: ICC rises although neither system became more precise. TE and MDC are in the measurement’s own units and answer the athlete-level question directly.' }));
      if (st.tab === 'change') {
        const verdict = (obs, m) => (Math.abs(obs) > m ? 'exceeds the MDC — likely a real change (whether it matters is a separate question)' : 'within the MDC — not distinguishable from error and normal variability');
        view.append(h('table', { class: 'bl-table' }, h('thead', null, h('tr', null, ['', 'Observed change (means)', `MDC95 (n = ${p.n})`, 'Reading'].map((x) => h('th', { text: x })))), h('tbody', null,
          h('tr', null, h('th', { text: 'System A' }), h('td', { class: 'num', text: `${fmt(R.obsA)}${unit}` }), h('td', { class: 'num', text: `${fmt(R.mdcMeanA)}${unit}` }), h('td', { text: verdict(R.obsA, R.mdcMeanA) })),
          h('tr', null, h('th', { text: 'System B' }), h('td', { class: 'num', text: `${fmt(R.obsB)}${unit}` }), h('td', { class: 'num', text: `${fmt(R.mdcMeanB)}${unit}` }), h('td', { text: verdict(R.obsB, R.mdcMeanB) })))),
          h('p', { class: 'small muted', text: `True change in this simulation: ${fmt(p.change)}${unit}. In practice you never see this row — which is the point of the MDC. Mixing systems across sessions adds the bias (${fmt(R.bias)}${unit}) to any comparison.` }));
      }
      if (tasks.length) host.appendChild(h('div', { class: 'bl-tasks' }, tasks.map((t) => taskBlock(ctx, st, t, truthFor(t), changed))));
      summaryEl = h('p', { class: 'small muted', 'aria-live': 'polite', text: tasksSummary(st, tasks).label });
      host.appendChild(summaryEl);
    }
    function blandAltman(R) {
      const pts = R.sessions[0].map((x) => [(x.A + x.B) / 2, x.B - x.A]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]).concat(R.loa, [0]);
      const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2, y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
      const s = svg(380, 230, 'Bland–Altman plot: difference between systems against their mean');
      const X = (v) => 40 + ((v - x0) / (x1 - x0)) * 320, Y = (v) => 200 - ((v - y0) / (y1 - y0)) * 180;
      s.appendChild(el('line', { x1: 40, y1: Y(0), x2: 360, y2: Y(0), class: 'bl-gaxis', 'stroke-dasharray': '2 4' }));
      [[R.bias, 'bias', 'bl-lx'], [R.loa[0], '−1.96 SD', 'bl-ly'], [R.loa[1], '+1.96 SD', 'bl-ly']].forEach(([v, t, c]) => { s.appendChild(el('line', { x1: 40, y1: Y(v), x2: 360, y2: Y(v), class: c, 'stroke-width': 1.5 })); s.appendChild(el('text', { x: 300, y: Y(v) - 3, class: `bl-llabel ${c}` }, `${t} ${fmt(v)}`)); });
      pts.forEach(([a, b]) => s.appendChild(el('circle', { cx: X(a), cy: Y(b), r: 3.5, class: 'bl-pt' })));
      s.appendChild(el('text', { x: 40, y: 224, class: 'bl-glabel' }, `mean of A and B (${unit}) →`));
      s.appendChild(el('text', { x: 4, y: 14, class: 'bl-glabel' }, `B − A (${unit})`));
      return h('div', { class: 'bl-scene' }, s);
    }
    function traces(R) {
      // One trial's external-rotation trace over the arm-cocking phase, as seen by both systems. Shape: smooth rise to the
      // trial's peak; System B adds its bias and a slowly varying error, plus a 1-sample offset if timing is unsynchronized.
      const trial = R.sessions[0][0]; const pts = 60; const s = svg(380, 220, 'Synchronized joint-angle traces from two systems for one trial');
      const r = rng(st.p.seed + 99); const wob = Array.from({ length: pts }, () => normal(r) * st.p.randB * 0.4);
      const A = Array.from({ length: pts }, (_, i) => { const u = i / (pts - 1); return 40 + (trial.A - 40) * Math.exp(-((u - 0.7) ** 2) / 0.06); });
      const B = A.map((v, i) => v - trial.A + trial.B + (wob[i] + (wob[i - 1] || 0)) / 2);
      const all = A.concat(B); const lo = Math.min(...all) - 5, hi = Math.max(...all) + 5;
      const X = (i) => 40 + (i / (pts - 1)) * 320, Y = (v) => 200 - ((v - lo) / (hi - lo)) * 180;
      const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
      s.appendChild(el('path', { d: path(A), class: 'bl-curve bl-c4' })); s.appendChild(el('path', { d: path(B), class: 'bl-curve bl-c1', 'stroke-dasharray': '5 3' }));
      s.appendChild(el('text', { x: 44, y: 16, class: 'bl-llabel bl-c4' }, `A (marker-based) peak ${fmt(trial.A)}${unit}`));
      s.appendChild(el('text', { x: 44, y: 32, class: 'bl-llabel bl-c1' }, `B (markerless) peak ${fmt(trial.B)}${unit}`));
      s.appendChild(el('text', { x: 250, y: 214, class: 'bl-glabel' }, 'time, arm cocking →'));
      return h('div', null, h('div', { class: 'bl-scene' }, s), h('p', { class: 'small muted', text: 'Illustrative trace shape; the two peaks are this trial’s simulated values. Notice how a constant offset leaves the shape — and any correlation — intact.' }));
    }
    render();
  };
})(typeof window !== 'undefined' ? window : globalThis);
