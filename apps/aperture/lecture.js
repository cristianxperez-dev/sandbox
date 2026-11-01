/* APERTURE — narrated lecture player (Watch & Learn).
   A reusable component: AP.Lecture.mount(el, { lecture, saved, onSave, onComplete, onCheckpoint }).
   One AAC narration track drives everything else: each narration cue has exact start/end times, so
   the animated scene, its reveal step, captions, the transcript highlight and the interactive
   checkpoints all follow the audio clock. Checkpoints are formative: the lecture pauses, the learner
   answers (or skips), the response is saved, and narration resumes.
   Accessibility: native buttons and range inputs, keyboard shortcuts, captions, a full synchronized
   transcript, audio-only mode, reduced motion respected. No inline styles in markup (CSP). */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const svg = (tag, attrs, ...kids) => h(tag, attrs, ...kids);

  /* ---------------- scene renderers: return { el, steps } ----------------
     A visual shows step 0 at once; elements marked data-step="n" appear when the reveal reaches n. */
  const R = {};
  const step = (n, el) => { el.dataset.step = String(n); el.classList.add('lv-step'); return el; };
  R.title = (v) => ({ el: h('div', { class: 'lv lv-title' }, h('span', { class: 'lv-kicker', text: v.kicker || '' }), h('h2', { class: 'lv-h', text: v.title }), v.sub ? h('p', { class: 'lv-sub', text: v.sub }) : null) });
  R.statement = (v) => ({ el: h('div', { class: 'lv lv-statement' }, v.lines.map((l, i) => step(i, h('p', { class: `lv-line${i ? ' lv-line--accent' : ''}`, text: l }))), v.sub ? step(Math.max(0, v.lines.length - 1), h('p', { class: 'lv-sub', text: v.sub })) : null) });
  R.numbers = (v) => ({ el: h('div', { class: 'lv lv-numbers' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-num-row' }, v.items.map((it, i) => step(i + 1, h('div', { class: 'lv-num' }, h('b', { text: it.value }), h('span', { text: it.label }))))), v.note ? h('p', { class: 'lv-note', text: v.note }) : null) });
  R.cards = (v) => ({ el: h('div', { class: 'lv lv-cards' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-card-row' }, v.cards.map((c, i) => step(i + 1, h('div', { class: 'lv-card' }, h('b', { text: c.title }), h('span', { class: 'lv-q', text: `“${c.q}”` }), h('span', { class: 'lv-fail', text: c.fail })))))) });
  R.anchor = (v) => {
    const row = (n, anchor, est) => step(n, h('div', { class: 'lv-anchor-row' }, h('span', { class: 'lv-anchor-wheel', text: String(anchor) }),
      h('div', { class: 'lv-anchor-bar' }, (() => { const f = h('i'); f.style.width = `${est}%`; return f; })()), h('span', { class: 'lv-anchor-est', text: `median estimate ${est}%` })));
    return { el: h('div', { class: 'lv lv-anchor' }, h('h3', { class: 'lv-t', text: v.title }), h('p', { class: 'lv-sub', text: `“${v.question}”` }), row(1, v.low, v.lowEstimate), row(2, v.high, v.highEstimate), h('p', { class: 'lv-note', text: 'The wheel was rigged to stop at one of two numbers. Tversky & Kahneman (1974).' })) };
  };
  R.tree = (v, params) => {
    const p = { ...v, ...(params || {}) };
    const N = p.population, ill = Math.round(N * p.prevalence), well = N - ill;
    const tp = Math.round(ill * p.sensitivity), fp = Math.round(well * p.falsePositive), pos = tp + fp;
    const ppv = pos ? tp / pos : 0;
    const n = (x) => x.toLocaleString('en-US');
    const node = (s, cls, big, small) => step(s, h('div', { class: `lv-node ${cls || ''}` }, h('b', { text: big }), h('span', { text: small })));
    return { el: h('div', { class: 'lv lv-tree' }, h('h3', { class: 'lv-t', text: v.title }),
      node(1, 'lv-node--root', n(N), 'people screened'),
      h('div', { class: 'lv-tree-row' }, node(2, '', n(ill), `have the condition (${Math.round(p.prevalence * 1000) / 10}%)`), node(2, '', n(well), 'do not')),
      h('div', { class: 'lv-tree-row lv-tree-row--4' }, node(3, 'lv-node--pos', n(tp), 'test positive'), node(3, 'lv-node--dim', n(ill - tp), 'test negative'), node(4, 'lv-node--pos lv-node--fp', n(fp), 'test positive'), node(4, 'lv-node--dim', n(well - fp), 'test negative')),
      step(5, h('div', { class: 'lv-result' }, h('span', { text: `${n(pos)} positives, ${n(tp)} actually ill` }), h('b', { text: `${Math.round(ppv * 100)}%` })))), ppv };
  };
  R.triples = (v) => ({ el: h('div', { class: 'lv lv-triples' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-triple' }, h('b', { text: v.example }), h('span', { class: 'lv-ok', text: 'fits the rule' })), step(1, h('p', { class: 'lv-sub', text: 'Propose sequences. You will be told only whether each fits the rule.' }))) });
  R.grid = (v) => {
    const cell = (s, text) => step(s, h('div', { class: 'lv-cell', text }));
    const at = (r, c) => v.order.findIndex(([cc, rr]) => cc === c && rr === r) + 2;
    return { el: h('div', { class: 'lv lv-grid' }, h('h3', { class: 'lv-t', text: v.title }),
      step(1, h('div', { class: 'lv-grid-tbl' }, h('span'), v.cols.map((c) => h('span', { class: 'lv-grid-h', text: c })),
        v.rows.map((row, r) => [h('span', { class: 'lv-grid-h lv-grid-h--row', text: row.label }), row.cells.map((t, c) => cell(at(r, c), t))])))) };
  };
  R.compare = (v) => ({ el: h('div', { class: 'lv lv-compare' }, h('h3', { class: 'lv-t', text: v.title }), h('div', { class: 'lv-cols' }, [v.left, v.right].map((side, i) => step(i + 1, h('div', { class: 'lv-col' }, h('b', { text: side.title }), h('ul', null, side.points.map((pt) => h('li', { text: pt })))))))) });
  R.replication = (v) => {
    const dots = h('div', { class: 'lv-dots', role: 'img', 'aria-label': `${v.replicated} of ${v.total} effects replicated consistently; ${v.failed} did not` });
    for (let i = 0; i < v.total; i++) dots.appendChild(h('i', { class: i < v.replicated ? 'is-rep' : i < v.replicated + v.failed ? 'is-fail' : 'is-other' }));
    return { el: h('div', { class: 'lv lv-replication', dataset: { r: '0' } }, h('h3', { class: 'lv-t', text: v.title }), step(1, h('p', { class: 'lv-sub', text: `${v.total} classic effects · ${v.samples} samples · many countries` })), step(1, dots),
      h('div', { class: 'lv-legend' }, step(2, h('span', { class: 'lg-rep', text: `${v.replicated} replicated consistently (including anchoring)` })), step(3, h('span', { class: 'lg-fail', text: `${v.failed} social-priming effects did not` })), step(3, h('span', { class: 'lg-other', text: 'the remaining effect: weaker support' }))),
      h('p', { class: 'lv-note', text: 'Many Labs replication project — Klein et al. (2014).' })) };
  };
  R.steps = (v) => ({ el: h('div', { class: 'lv lv-steps' }, h('h3', { class: 'lv-t', text: v.title }), h('ol', null, v.steps.map((s, i) => step(i + 1, h('li', { text: s }))))) });
  R.next = (v) => ({ el: h('div', { class: 'lv lv-next' }, h('h3', { class: 'lv-t', text: v.title }), step(1, h('div', { class: 'lv-next-row' }, v.items.map((it) => h('a', { class: 'lv-next-item', href: it.href || '#', dataset: { href: it.href || '' } }, h('b', { text: it.label }), h('span', { text: it.detail })))))) });

  /* ---------------- player ---------------- */
  function mount(root, { lecture: L, saved, onSave, onComplete, onCheckpoint, settings }) {
    const st = { position: 0, furthest: 0, completed: false, rate: 1, responses: {}, seconds: 0, ...(saved || {}) };
    const prefs = { captions: !(settings && settings.captions === false), audioOnly: false };
    const cues = [], scenes = [], checkpoints = [];
    L.chapters.forEach((ch, ci) => ch.scenes.forEach((sc) => {
      const s = { ...sc, chapter: ci, index: scenes.length };
      scenes.push(s);
      sc.cues.forEach((c) => cues.push({ ...c, scene: s.index, chapter: ci, index: cues.length }));
      if (sc.checkpoint) checkpoints.push({ ...sc.checkpoint, scene: s.index });
    }));
    const probe = document.createElement('audio');
    const aac = probe.canPlayType('audio/mp4; codecs="mp4a.40.2"');
    const src = !aac && L.audioAlt && probe.canPlayType('audio/webm; codecs="opus"') ? L.audioAlt : L.audio;
    // The narration is fetched whole and played from an in-memory blob: that makes seeking,
    // checkpoints and resume work on every host (some static hosts ignore HTTP Range requests,
    // which Safari needs for seeking). If the fetch fails, fall back to streaming the file.
    const audio = h('audio', { preload: 'none' });
    let blobUrl = null, ready = false;
    audio.playbackRate = st.rate;
    const handled = new Set(Object.keys(st.responses));
    let curScene = -1, curReveal = -1, curCue = -1, active = null, raf = 0, lastTick = 0, saveT = 0, destroyed = false;

    /* layout */
    const sceneHost = h('div', { class: 'lec-scene', 'aria-hidden': 'true' });
    const caption = h('div', { class: 'lec-cap', 'aria-hidden': 'true' });
    const cpHost = h('div', { class: 'lec-cp', hidden: true, role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Checkpoint' });
    const bigLabel = h('span', { text: 'Loading narration…' });
    const bigPlay = h('button', { class: 'lec-bigplay', 'aria-label': 'Play lecture', disabled: true, onclick: () => toggle() }, bigLabel);
    const readyLabel = () => (st.position > 2 ? `Resume at ${fmt(st.position)}` : 'Play lecture');
    (async () => {
      try {
        const res = await fetch(src, { credentials: 'same-origin' });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const total = Number(res.headers.get('Content-Length')) || L.audioBytes || 0;
        const reader = res.body.getReader(); const chunks = []; let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) bigLabel.textContent = `Loading narration… ${Math.min(99, Math.round((got / total) * 100))}%`; if (destroyed) return; }
        blobUrl = URL.createObjectURL(new Blob(chunks, { type: src.endsWith('.webm') ? 'audio/webm' : 'audio/mp4' }));
        audio.src = blobUrl;
      } catch { audio.src = src; }
      audio.preload = 'auto'; audio.load();
      ready = true; bigPlay.disabled = false; bigLabel.textContent = readyLabel();
    })();
    const stage = h('div', { class: 'lec-stage' }, sceneHost, caption, bigPlay, cpHost);
    const playBtn = h('button', { class: 'lec-btn lec-play', 'aria-label': 'Play', onclick: () => toggle() }, h('span', { class: 'lec-ico', text: '▶' }));
    const back = h('button', { class: 'lec-btn', 'aria-label': 'Back 10 seconds', onclick: () => seek(audio.currentTime - 10), text: '−10' });
    const fwd = h('button', { class: 'lec-btn', 'aria-label': 'Forward 10 seconds', onclick: () => seek(audio.currentTime + 10), text: '+10' });
    const time = h('span', { class: 'lec-time num', text: `0:00 / ${fmt(L.duration)}` });
    const scrub = h('input', { type: 'range', class: 'lec-scrub', min: 0, max: Math.round(L.duration * 10), step: 1, value: Math.round(st.position * 10), 'aria-label': 'Seek', 'aria-valuetext': '0:00' });
    scrub.addEventListener('input', () => seek(Number(scrub.value) / 10));
    const ticks = h('div', { class: 'lec-ticks', 'aria-hidden': 'true' }, L.chapters.map((ch) => { const t = h('i'); t.style.left = `${(ch.start / L.duration) * 100}%`; return t; }),
      checkpoints.map((cp) => { const t = h('b'); t.style.left = `${(cp.at / L.duration) * 100}%`; return t; }));
    const rate = h('select', { class: 'lec-select', 'aria-label': 'Playback speed', onchange: (e) => { st.rate = Number(e.target.value); audio.playbackRate = st.rate; persist(); } }, RATES.map((r) => h('option', { value: String(r), selected: r === st.rate, text: `${r}×` })));
    const ccBtn = h('button', { class: 'lec-btn', 'aria-pressed': String(prefs.captions), onclick: () => { prefs.captions = !prefs.captions; ccBtn.setAttribute('aria-pressed', String(prefs.captions)); caption.hidden = !prefs.captions; }, text: 'CC', title: 'Captions' });
    const aoBtn = h('button', { class: 'lec-btn', 'aria-pressed': 'false', onclick: () => setAudioOnly(!prefs.audioOnly), text: 'Audio only' });
    const trBtn = h('button', { class: 'lec-btn', 'aria-expanded': 'false', onclick: () => { const open = side.classList.toggle('is-open'); trBtn.setAttribute('aria-expanded', String(open)); if (open) scrollTranscript(true); }, text: 'Transcript' });
    const controls = h('div', { class: 'lec-controls' }, h('div', { class: 'lec-scrubwrap' }, ticks, scrub), h('div', { class: 'lec-row' }, h('div', { class: 'lec-grp' }, playBtn, back, fwd, time), h('div', { class: 'lec-grp' }, rate, ccBtn, trBtn, aoBtn)));
    const chapList = h('ol', { class: 'lec-chapters' }, L.chapters.map((ch, i) => h('li', null, h('button', { onclick: () => { seek(ch.start); play(); }, dataset: { ch: String(i) } }, h('span', { class: 'num', text: fmt(ch.start) }), h('b', { text: ch.title })))));
    const trList = h('ol', { class: 'lec-transcript' });
    L.chapters.forEach((ch, ci) => {
      trList.appendChild(h('li', { class: 'lec-tr-ch', text: ch.title }));
      cues.filter((c) => c.chapter === ci).forEach((c) => trList.appendChild(h('li', null, h('button', { dataset: { cue: String(c.index) }, onclick: () => { seek(c.start + 0.01); play(); } }, h('span', { class: 'num', text: fmt(c.start) }), h('span', { text: c.text })))));
    });
    const side = h('aside', { class: 'lec-side' }, h('div', { class: 'lec-side-h' }, h('span', { class: 'label', text: 'Transcript' }), h('a', { class: 'small', href: L.transcriptFile, download: '', text: 'Download' }), h('a', { class: 'small', href: L.captions, download: '', text: 'Captions (.vtt)' })), trList);
    const live = h('div', { class: 'sr', 'aria-live': 'polite' });
    const el = h('div', { class: 'lec', tabindex: '-1' }, h('div', { class: 'lec-main' }, stage, controls, h('div', { class: 'lec-under' }, h('div', null, h('span', { class: 'label', text: 'Chapters' }), chapList), refsPanel())), side, live, audio);
    root.appendChild(el);

    function refsPanel() {
      const refs = (L.refs || []).map((id) => AP.cache.libIndex && AP.cache.libIndex.get(id)).filter(Boolean);
      return h('div', null, h('span', { class: 'label', text: 'Sources in this lecture' }), h('ul', { class: 'lec-refs' }, refs.map((r) => h('li', null, h('a', { href: `#/library/${r.id}`, text: r.title }), h('span', { class: 'small muted', text: ` ${AP.shortRef(r.id)} · ${r.evidence}` })))),
        h('p', { class: 'small muted', text: `Narration: ${L.narration.engine}, synthesized for APERTURE. Visuals are original; numbers in examples are synthetic unless a source is cited.` }));
    }

    /* rendering */
    function renderScene(i) {
      curScene = i; curReveal = -1;
      const s = scenes[i];
      const r = (R[s.visual.type] || R.statement)(s.visual);
      AP.clear(sceneHost).appendChild(r.el);
      sceneHost.classList.remove('is-in'); void sceneHost.offsetWidth; sceneHost.classList.add('is-in');
      chapList.querySelectorAll('button').forEach((b) => b.classList.toggle('is-current', Number(b.dataset.ch) === s.chapter));
    }
    function applyReveal(n) {
      if (n === curReveal) return;
      curReveal = n;
      sceneHost.querySelectorAll('.lv-step').forEach((e) => e.classList.toggle('is-on', Number(e.dataset.step) <= n));
    }
    function sync(t) {
      // cue at t (last cue started)
      let ci = -1;
      for (let i = 0; i < cues.length; i++) { if (cues[i].start <= t + 0.02) ci = i; else break; }
      let si = 0;
      for (let i = 0; i < scenes.length; i++) if (scenes[i].start <= t + 0.02) si = i;
      if (si !== curScene) renderScene(si);
      let rv = 0;
      for (const c of cues) if (c.scene === si && c.start <= t + 0.02 && c.reveal != null) rv = Math.max(rv, c.reveal);
      applyReveal(rv);
      const showCue = ci >= 0 && cues[ci].scene === si && t <= cues[ci].end + 0.25 ? ci : -1;
      if (showCue !== curCue) {
        curCue = showCue;
        caption.textContent = showCue >= 0 ? cues[showCue].text : '';
        trList.querySelectorAll('button.is-current').forEach((b) => b.classList.remove('is-current'));
        if (showCue >= 0) { const b = trList.querySelector(`button[data-cue="${showCue}"]`); if (b) b.classList.add('is-current'); scrollTranscript(false); }
      }
      time.textContent = `${fmt(t)} / ${fmt(L.duration)}`;
      if (document.activeElement !== scrub) { scrub.value = String(Math.round(t * 10)); scrub.setAttribute('aria-valuetext', fmt(t)); }
    }
    function scrollTranscript(force) {
      if (!side.classList.contains('is-open') && !prefs.audioOnly) return;
      const b = trList.querySelector('button.is-current'); if (!b) return;
      const top = b.offsetTop - trList.offsetTop - trList.clientHeight / 3;
      if (force || Math.abs(trList.scrollTop - top) > trList.clientHeight / 3) trList.scrollTop = top;
    }

    /* clock */
    function tick() {
      const t = audio.currentTime;
      const now = performance.now();
      if (!audio.paused) st.seconds += (now - lastTick) / 1000;
      lastTick = now;
      // Checkpoint gate: pause at its time the first time it is reached.
      const cp = checkpoints.find((c) => !handled.has(c.id) && t >= c.at - 0.05 && t < c.at + 1.5);
      if (cp && !active) { audio.pause(); audio.currentTime = cp.at; openCheckpoint(cp); }
      sync(audio.currentTime);
      if (t > st.furthest) st.furthest = t;
      st.position = t;
      if (!st.completed && st.furthest >= L.duration * 0.92) { st.completed = true; persist(true); onComplete && onComplete(st); live.textContent = 'Lecture complete.'; }
      if (now - saveT > 5000) { saveT = now; persist(); }
    }
    function play() {
      if (active || !ready) return;
      bigPlay.hidden = true;
      const p = audio.play();
      if (p && p.catch) p.catch(() => { bigPlay.hidden = false; });
    }
    function pause() { audio.pause(); }
    function toggle() { if (audio.paused) play(); else pause(); }
    function seek(t) {
      t = Math.max(0, Math.min(L.duration - 0.05, t));
      if (active) closeCheckpoint();
      // Seeking past a checkpoint never forces it; it stays available from the chapter list.
      for (const c of checkpoints) if (c.at < t - 0.5) handled.add(c.id);
      for (const c of checkpoints) if (c.at >= t - 0.05 && !st.responses[c.id]) handled.delete(c.id);
      audio.currentTime = t; st.position = t; sync(t);
    }
    audio.addEventListener('play', () => { playBtn.firstChild.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); lastTick = performance.now(); clearInterval(raf); raf = setInterval(tick, 100); el.classList.add('is-playing'); });
    audio.addEventListener('timeupdate', () => { if (!audio.paused) tick(); });
    audio.addEventListener('pause', () => { playBtn.firstChild.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); clearInterval(raf); el.classList.remove('is-playing'); persist(); sync(audio.currentTime); });
    audio.addEventListener('ended', () => { st.furthest = L.duration; tick(); persist(true); });
    audio.addEventListener('loadedmetadata', () => { if (st.position > 0 && st.position < L.duration - 1) audio.currentTime = st.position; sync(st.position); });
    audio.addEventListener('error', () => { AP.clear(cpHost); cpHost.hidden = false; cpHost.appendChild(h('div', { class: 'lec-cp-box' }, h('p', { text: 'The narration could not be loaded. Check your connection, or read the written lesson.' }))); });

    /* checkpoints (formative) */
    function openCheckpoint(cp) {
      active = cp;
      cpHost.hidden = false; el.classList.add('has-cp');
      AP.clear(cpHost);
      const box = h('div', { class: 'lec-cp-box' }, h('span', { class: 'label label--accent', text: { estimate: 'Pause and predict', choice: 'Decide', explore: 'Explore', reflect: 'Reflect' }[cp.type] || 'Checkpoint' }), h('p', { class: 'lec-cp-q', text: cp.prompt }));
      const fb = h('div', { class: 'lec-cp-fb', 'aria-live': 'polite' });
      const cont = h('button', { class: 'btn btn--primary', onclick: () => { closeCheckpoint(); play(); }, text: 'Continue the lecture' });
      const skip = h('button', { class: 'btn btn--quiet', onclick: () => { handled.add(cp.id); closeCheckpoint(); play(); }, text: 'Skip' });
      const record = (value, correct) => { st.responses[cp.id] = { value, correct, at: Date.now() }; handled.add(cp.id); persist(true); onCheckpoint && onCheckpoint(cp, st.responses[cp.id]); };
      const prev = st.responses[cp.id];
      if (cp.type === 'estimate') {
        const out = h('output', { class: 'lec-est-out num', text: `${prev ? prev.value : cp.initial}${cp.unit || ''}` });
        const rng = h('input', { type: 'range', min: cp.min, max: cp.max, step: cp.step || 1, value: prev ? prev.value : cp.initial, 'aria-label': cp.prompt, oninput: (e) => { out.textContent = `${e.target.value}${cp.unit || ''}`; } });
        const lock = h('button', { class: 'btn btn--primary', text: 'Lock in my estimate', onclick: () => {
          const v = Number(rng.value); const ok = Math.abs(v - cp.answer) <= (cp.tolerance || 0);
          record(v, ok); rng.disabled = true; lock.remove();
          AP.clear(fb).append(h('p', null, h('b', { text: `You said ${v}${cp.unit || ''}. ` }), cp.feedback[ok ? 'correct' : 'incorrect'])); actions.prepend(cont); skip.remove(); cont.focus();
        } });
        box.append(h('div', { class: 'lec-est' }, rng, out), fb);
        var actions = h('div', { class: 'row' }, lock, skip);
        box.appendChild(actions);
      } else if (cp.type === 'choice' || cp.type === 'explore') {
        let tree = null, treeHost = null;
        if (cp.type === 'explore') {
          const scene = scenes[cp.scene]; let idx = cp.control.values.indexOf(scene.visual.prevalence); if (idx < 0) idx = 0;
          treeHost = h('div', { class: 'lec-explore' });
          const lab = h('span', { class: 'num' });
          const draw = () => { const r = R.tree(scene.visual, { [cp.control.param]: cp.control.values[idx] }); AP.clear(treeHost).appendChild(r.el); r.el.querySelectorAll('.lv-step').forEach((e) => e.classList.add('is-on')); lab.textContent = `${Math.round(cp.control.values[idx] * 1000) / 10}%`; };
          const rng = h('input', { type: 'range', min: 0, max: cp.control.values.length - 1, step: 1, value: idx, 'aria-label': cp.control.label, oninput: (e) => { idx = Number(e.target.value); draw(); } });
          draw();
          box.append(h('div', { class: 'lec-est' }, h('span', { class: 'label', text: cp.control.label }), rng, lab), treeHost);
        }
        const opts = h('div', { class: 'lec-opts' });
        cp.options.forEach((o) => opts.appendChild(h('button', { class: 'choice', dataset: { id: o.id }, onclick: () => {
          const ok = o.id === cp.answer; record(o.id, ok);
          opts.querySelectorAll('button').forEach((b) => { b.disabled = true; if (b.dataset.id === cp.answer) b.classList.add('is-correct'); else if (b.dataset.id === o.id) b.classList.add('is-wrong'); });
          AP.clear(fb).append(h('p', null, h('b', { text: ok ? 'Yes. ' : 'Not quite. ' }), cp.feedback[o.id])); actions.prepend(cont); skip.remove(); cont.focus();
        } }, h('span', { text: o.text }))));
        box.append(opts, fb);
        var actions = h('div', { class: 'row' }, skip);
        box.appendChild(actions);
      } else if (cp.type === 'reflect') {
        const ta = h('textarea', { 'aria-label': cp.prompt, placeholder: 'A few sentences. Private to you; saved to this lecture.', value: prev && typeof prev.value === 'string' ? prev.value : '' });
        const saveBtn = h('button', { class: 'btn btn--primary', text: 'Save and continue', onclick: () => { if (ta.value.trim()) record(ta.value.trim(), null); closeCheckpoint(); play(); } });
        box.append(ta, h('div', { class: 'row' }, saveBtn, skip), h('p', { class: 'small muted', text: 'Formative: nothing here is graded.' }));
      }
      cpHost.appendChild(box);
      live.textContent = 'Checkpoint. The lecture is paused.';
      const first = box.querySelector('input, button.choice, textarea, button'); if (first) first.focus({ preventScroll: true });
    }
    function closeCheckpoint() { if (active) handled.add(active.id); active = null; cpHost.hidden = true; AP.clear(cpHost); el.classList.remove('has-cp'); }

    function setAudioOnly(on) {
      prefs.audioOnly = on; aoBtn.setAttribute('aria-pressed', String(on)); el.classList.toggle('is-audio', on);
      if (on) { side.classList.add('is-open'); trBtn.setAttribute('aria-expanded', 'true'); scrollTranscript(true); }
    }

    function persist(now) {
      clearTimeout(persist.t);
      const write = () => onSave && onSave({ position: Math.round(st.position * 10) / 10, furthest: Math.round(st.furthest * 10) / 10, duration: L.duration, completed: st.completed, rate: st.rate, responses: st.responses, seconds: Math.round(st.seconds) });
      if (now) write(); else persist.t = setTimeout(write, 400);
    }

    /* keyboard: active only when focus is inside the player */
    function onKey(e) {
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range') return;
      if (active && e.key !== 'Escape') return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft' && e.target.type !== 'range') { seek(audio.currentTime - 5); }
      else if (e.key === 'ArrowRight' && e.target.type !== 'range') { seek(audio.currentTime + 5); }
      else if (e.key === 'j') seek(audio.currentTime - 10);
      else if (e.key === 'l') seek(audio.currentTime + 10);
      else if (e.key === 'c') ccBtn.click();
    }
    document.addEventListener('keydown', onKey);

    /* lock-screen controls for audio-only listening */
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({ title: L.title, artist: 'APERTURE', album: 'Semester I lectures' });
        navigator.mediaSession.setActionHandler('play', play); navigator.mediaSession.setActionHandler('pause', pause);
        navigator.mediaSession.setActionHandler('seekbackward', () => seek(audio.currentTime - 10)); navigator.mediaSession.setActionHandler('seekforward', () => seek(audio.currentTime + 10));
      } catch {}
    }

    sync(st.position);
    return {
      el, audio, play, pause, seek, state: () => ({ ...st }),
      destroy() { if (destroyed) return; destroyed = true; persist(true); audio.pause(); clearInterval(raf); document.removeEventListener('keydown', onKey); audio.removeAttribute('src'); audio.load(); if (blobUrl) URL.revokeObjectURL(blobUrl); },
    };
  }

  AP.Lecture = { mount, renderers: R };
})();
