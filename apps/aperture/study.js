/* APERTURE — study views: lesson reader (Explore → Understand → Challenge → Apply → Retain),
   assessments with server-side grading, assignments with rubric self-assessment, cases, labs,
   spaced review, the Strategic Decision Journal, diagnostic, midterm and capstone. */
(function () {
  'use strict';
  const AP = window.AP, h = AP.h;
  const S = (AP.study = {});
  const SECTIONS = [['explore', 'Explore'], ['understand', 'Understand'], ['challenge', 'Challenge'], ['apply', 'Apply'], ['retain', 'Retain']];

  /* ======================= Lesson reader ======================= */
  AP.lecturesOn = () => !(window.APERTURE_CONFIG && window.APERTURE_CONFIG.lectures === false);
  function pathSwitch(id, lec, lessonMinutes, current) {
    const go = (view) => () => { AP.settings.lessonView = view; AP.save('settings', 'main', { ...AP.settings }); };
    return h('nav', { class: 'pathswitch', 'aria-label': 'Choose how to learn this lesson' },
      h('a', { href: `#/lesson/${id}/watch`, 'aria-current': current === 'watch' ? 'page' : null, onclick: go('watch') }, h('span', { class: 'label', text: 'Watch & Learn' }), h('b', { text: `Narrated lecture · ${lec.minutes} min` }), h('span', { text: `${lec.checkpoints} interactive checkpoints, captions, transcript` })),
      h('a', { href: `#/lesson/${id}/read`, 'aria-current': current === 'read' ? 'page' : null, onclick: go('read') }, h('span', { class: 'label', text: 'Read & Explore' }), h('b', { text: `Written lesson · ${lessonMinutes} min` }), h('span', { text: 'Full text, diagrams, examples and methodological notes' })));
  }

  S.lesson = async function (id, sectionHint) {
    const weekId = id.slice(0, 3);
    const [cat, w] = await Promise.all([AP.catalog(), AP.week(weekId)]);
    const lec = AP.lecturesOn() && cat.lectures && cat.lectures[id];
    if (lec && (sectionHint === 'watch' || (!sectionHint && AP.settings.lessonView === 'watch'))) return S.watch(id, lec, cat, w);
    if (sectionHint === 'read') sectionHint = null;
    await AP.loadState(['note', 'bookmark']);
    const idx = w.lessons.findIndex((l) => l.id === id);
    const l = w.lessons[idx];
    if (!l) return h('p', { class: 'empty', text: 'Lesson not found.' });
    let rec = { section: 'explore', scroll: 0, done: false, seconds: 0, ...(AP.getRec('progress', id) || {}) };
    const startSeconds = rec.seconds || 0;
    const t0 = Date.now();
    const forceFoundation = await diagnosticNeedsFoundation(w);

    const art = h('article', { class: 'prose' });
    if (AP.mode() === 'executive') art.appendChild(h('div', { class: 'exec' }, h('span', { class: 'label label--accent', text: 'Executive brief' }), h('p', { html: AP.inline(l.executive) })));
    const counter = { n: 0 };
    for (const [key, label] of SECTIONS) {
      const sec = h('section', { class: 'section', id: `sec-${key}`, dataset: { section: key } }, h('div', { class: 'label' }, h('span', { text: String(SECTIONS.findIndex((s) => s[0] === key) + 1).padStart(2, '0') }), h('b', { text: label })));
      AP.blocks(sec, l.sections[key], { section: key, counter, forceFoundation });
      art.appendChild(sec);
    }
    if (AP.mode() !== 'executive') art.appendChild(h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Executive brief' }), h('b', { text: 'The lesson in 100 words' })), h('div', { class: 'fold__body' }, h('p', { html: AP.inline(l.executive) }))));
    art.appendChild(h('div', { class: 'take' }, h('span', { class: 'label', text: 'Key takeaways' }), h('ol', null, l.takeaways.map((t) => h('li', { html: AP.inline(t) })))));

    // Comprehension check (server-graded)
    const checkBox = h('section', { class: 'rule' }, h('h2', { text: 'Comprehension check' }), h('p', { class: 'small muted', text: `${l.check.length} questions${AP.local() ? ', scored in your browser' : ', graded on the server'}. Results feed your concept mastery and review schedule.` }));
    const quiz = quizForm({ id: `${l.id}-check`, kind: 'check', items: l.check, set: 'main' }, { compact: true, onDone: () => markDone(true) });
    checkBox.appendChild(quiz.el);
    art.appendChild(checkBox);

    // Finish row
    const doneBtn = h('button', { class: 'btn btn--primary', onclick: () => markDone(true), text: rec.done ? 'Completed ✓' : 'Mark lesson complete' });
    const nextL = w.lessons[idx + 1];
    art.appendChild(h('div', { class: 'row rule' }, doneBtn, nextL ? h('a', { class: 'btn', href: `#/lesson/${nextL.id}`, text: `Next: ${nextL.title}` }) : h('a', { class: 'btn', href: `#/week/${w.id}`, text: 'Back to the week' })));

    // Side panel: steps, sources, cross-links, ChatGPT
    const steps = h('nav', { class: 'steps', 'aria-label': 'Lesson sections' }, SECTIONS.map(([k, label], i) => h('a', { href: `#/lesson/${id}/${k}`, dataset: { step: k }, onclick: (e) => { e.preventDefault(); goto(k); } }, h('span', { text: String(i + 1).padStart(2, '0') }), label)));
    const kinds = AP.countKinds(Object.values(l.sections).flat());
    const bmOn = !!AP.getRec('bookmark', id);
    const side = h('aside', { class: 'reader__side' }, h('div', { class: 'sticky' },
      h('div', null, h('span', { class: 'label', text: 'Progress' }), h('div', { class: 'meter' }, AP.meterFill(0)), h('p', { class: 'small muted', id: 'readpct', text: '' }),
        h('div', { class: 'row' }, h('button', { class: 'btn btn--small', 'aria-pressed': String(bmOn), onclick: async (e) => { const on = !AP.getRec('bookmark', id); if (on) await AP.save('bookmark', id, { label: l.title }, { delay: 0 }); else await AP.remove('bookmark', id); e.target.setAttribute('aria-pressed', String(on)); e.target.textContent = on ? 'Bookmarked' : 'Bookmark'; }, text: bmOn ? 'Bookmarked' : 'Bookmark' }))),
      h('div', { class: 'srcpanel' }, h('span', { class: 'label', text: 'Source panel' }),
        h('div', { class: 'kindcount' }, Object.entries(AP.KIND_LABEL).map(([k, lab]) => [h('span', { text: lab }), h('span', { class: 'num', text: String(kinds[k] || 0) })])),
        h('p', { class: 'small muted', text: 'Each passage is labelled in the margin. Unlabelled passages are original APERTURE explanation.' }),
        h('ul', null, l.sources.map((s) => { const r = AP.cache.libIndex.get(s.ref); return h('li', null, h('a', { class: 'src-t', href: `#/library/${s.ref}`, text: r ? r.title : s.ref }), h('div', { class: 'small muted', text: `${AP.shortRef(s.ref)}${r ? ` · ${r.evidence} · ${r.verified.status}` : ''}` }), h('div', { class: 'small', html: AP.inline(s.use) })); }))),
      h('div', null, h('span', { class: 'label', text: 'Connections' }), h('ul', { class: 'small' }, l.crosslinks.map((c) => { const fl = AP.findLesson(cat, c.to); return h('li', null, fl ? h('a', { href: `#/lesson/${c.to}`, text: `W${fl.w.number}: ${fl.l.title}` }) : c.to, ' — ', h('span', { html: AP.inline(c.why) })); }))),
      chatPanel({ title: `Week ${w.number}, ${w.title} — ${l.title}`, context: l.summary, objectives: l.objectives, concepts: l.concepts.map((c) => cat.concepts[c]?.name || c), sources: l.sources.map((s) => s.ref) }),
    ));

    const el = h('div', null,
      h('header', { class: 'pagehead' }, h('span', { class: 'label', text: `Week ${w.number} · Lesson ${idx + 1} of ${w.lessons.length} · ${l.minutes} min` }), h('h1', { text: l.title }), h('p', { class: 'lede', html: AP.inline(l.summary) }),
        h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Objectives' }), h('b', { text: `${l.objectives.length} learning objectives` })), h('div', { class: 'fold__body' }, h('ul', null, l.objectives.map((o) => h('li', { html: AP.inline(o) })))))),
      lec ? pathSwitch(id, lec, l.minutes, 'read') : null,
      steps, h('div', { class: 'reader' }, art, side));

    // Highlights & notes on selection
    const selbar = h('div', { class: 'selbar', hidden: true }, h('button', { text: 'Highlight', onclick: () => saveSel(false) }), h('button', { text: 'Note', onclick: () => saveSel(true) }), h('button', { text: 'Save concept', onclick: () => saveSel(true, true) }));
    document.body.appendChild(selbar);
    let sel = null;
    function onSel() {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !art.contains(s.anchorNode)) { selbar.hidden = true; return; }
      const text = s.toString().trim();
      const blk = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('[data-blk]');
      if (!text || text.length > 2000 || !blk) { selbar.hidden = true; return; }
      sel = { text, block: Number(blk.dataset.blk), section: blk.dataset.sec };
      const r = s.getRangeAt(0).getBoundingClientRect();
      selbar.hidden = false;
      selbar.style.top = `${window.scrollY + r.top - 44}px`;
      selbar.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, window.scrollX + r.left))}px`;
    }
    async function saveSel(withNote, concept) {
      if (!sel) return;
      selbar.hidden = true;
      const text = withNote ? window.prompt(concept ? 'Why does this concept matter to you? (optional)' : 'Your note') ?? null : '';
      if (text === null) return;
      const conceptId = concept ? l.concepts.find((c) => (cat.concepts[c]?.name || '').toLowerCase().split(/\W+/).some((wd) => wd.length > 4 && sel.text.toLowerCase().includes(wd))) || l.concepts[0] : null;
      await AP.save('note', AP.newId(), { target: id, section: sel.section, block: sel.block, quote: sel.text, text, highlight: !withNote, concept: conceptId, created: Date.now() }, { delay: 0 });
      paintHighlights(); AP.toast(concept ? 'Concept saved to your notebook.' : withNote ? 'Note saved.' : 'Highlighted.');
      window.getSelection().removeAllRanges();
    }
    function paintHighlights() {
      for (const [, n] of Object.entries(AP.state.note || {})) {
        if (n.data.target !== id || !n.data.quote) continue;
        const blk = art.querySelector(`[data-blk="${n.data.block}"]`);
        if (!blk || blk.dataset.painted?.includes(n.data.quote.slice(0, 20))) continue;
        markText(blk, n.data.quote, n.data.text);
        blk.dataset.painted = (blk.dataset.painted || '') + n.data.quote.slice(0, 20);
      }
    }
    // Wraps the first occurrence of quote inside one text node (safe: text nodes only).
    function markText(root, quote, note) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const probe = quote.slice(0, 120);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.nodeValue.indexOf(probe);
        if (i < 0) continue;
        const r = document.createRange(); r.setStart(node, i); r.setEnd(node, Math.min(node.nodeValue.length, i + quote.length));
        const m = h('mark', { class: 'hl', title: note || 'Highlight' }); r.surroundContents(m); return;
      }
    }
    document.addEventListener('selectionchange', onSel);

    // Section tracking, saved position, time on task
    const readbar = document.getElementById('readbar');
    readbar.hidden = false;
    let maxScroll = rec.scroll || 0;
    function onScroll() {
      const total = art.scrollHeight - window.innerHeight * 0.6;
      const y = window.scrollY - art.offsetTop + window.innerHeight * 0.4;
      const frac = Math.max(0, Math.min(1, y / Math.max(1, total)));
      readbar.style.width = `${frac * 100}%`;
      maxScroll = Math.max(maxScroll, frac);
      let cur = 'explore';
      for (const [k] of SECTIONS) { const s = document.getElementById(`sec-${k}`); if (s && s.getBoundingClientRect().top < window.innerHeight * 0.35) cur = k; }
      steps.querySelectorAll('a').forEach((a) => { a.classList.toggle('is-active', a.dataset.step === cur); if (SECTIONS.findIndex((s) => s[0] === a.dataset.step) <= SECTIONS.findIndex((s) => s[0] === cur)) a.classList.add('is-seen'); });
      const pct = document.getElementById('readpct'); if (pct) pct.textContent = `${Math.round(maxScroll * 100)}% read · ${Object.keys(AP.KIND_LABEL).length ? '' : ''}${l.minutes} min lesson`;
      side.querySelector('.meter span').style.width = `${Math.round(maxScroll * 100)}%`;
      if (cur !== rec.section || Math.abs(maxScroll - (rec.scroll || 0)) > 0.04) { rec = { ...rec, section: cur, scroll: maxScroll }; persist(); }
    }
    function persist() { rec.seconds = startSeconds + Math.round((Date.now() - t0) / 1000); AP.save('progress', id, rec, { delay: 1500 }); }
    function markDone(fromCheck) {
      if (rec.done) return;
      rec = { ...rec, done: true }; persist();
      doneBtn.textContent = 'Completed ✓';
      if (!fromCheck) AP.toast('Lesson complete. Its review cards join your schedule tomorrow.');
    }
    function goto(k) { const s = document.getElementById(`sec-${k}`); if (s) s.scrollIntoView({ behavior: AP.settings.reducedMotion ? 'auto' : 'smooth' }); }
    window.addEventListener('scroll', onScroll, { passive: true });
    const timer = setInterval(persist, 60000);
    setTimeout(() => { paintHighlights(); const target = sectionHint || (rec.scroll > 0.02 ? rec.section : null); if (target) goto(target); onScroll(); }, 30);
    return {
      el, title: l.title, keepScroll: false,
      destroy() { window.removeEventListener('scroll', onScroll); document.removeEventListener('selectionchange', onSel); clearInterval(timer); selbar.remove(); persist(); quiz.destroy && quiz.destroy(); },
    };
  };

  /* ======================= Watch & Learn (narrated lecture) ======================= */
  // Same lesson, same objectives, same comprehension check, same completion: finishing the lecture
  // (or the check) completes the lesson, exactly as reading does. Checkpoints are formative.
  S.watch = async function (id, lec, cat, w) {
    const idx = w.lessons.findIndex((x) => x.id === id);
    const l = w.lessons[idx];
    await AP.loadState(['progress', 'lecture']);
    if (!AP.cache[`lecture:${lec.id}`]) {
      const res = await fetch(`data/lectures/${lec.id}.json?v=${encodeURIComponent(String(lec.duration))}`, { credentials: 'same-origin' });
      if (!res.ok) throw new AP.ApiError(res.status, { message: 'The lecture could not be loaded.' });
      AP.cache[`lecture:${lec.id}`] = await res.json();
    }
    const L = AP.cache[`lecture:${lec.id}`];
    let rec = { section: 'explore', scroll: 0, done: false, seconds: 0, ...(AP.getRec('progress', id) || {}) };
    const doneBtn = h('button', { class: 'btn btn--primary', onclick: () => markDone(), text: rec.done ? 'Completed ✓' : 'Mark lesson complete' });
    function markDone() {
      if (rec.done) return;
      rec = { ...rec, done: true };
      AP.save('progress', id, rec, { delay: 0 });
      doneBtn.textContent = 'Completed ✓';
      AP.toast('Lesson complete. Its review cards join your schedule tomorrow.');
    }
    const host = h('div');
    const player = AP.Lecture.mount(host, {
      lecture: L, saved: AP.getRec('lecture', L.id), settings: AP.settings,
      onSave: (st) => AP.save('lecture', L.id, st, { delay: 600 }),
      onComplete: () => markDone(),
    });
    host.addEventListener('click', (e) => { const a = e.target.closest('a[data-href="#check"]'); if (a) { e.preventDefault(); player.pause(); document.getElementById('check')?.scrollIntoView({ behavior: AP.settings.reducedMotion ? 'auto' : 'smooth' }); } });
    const check = h('section', { class: 'rule', id: 'check' }, h('h2', { text: 'Comprehension check' }), h('p', { class: 'small muted', text: `The same ${l.check.length} questions as the written lesson — ${AP.local() ? 'scored in your browser' : 'graded on the server'}. Passing it also completes the lesson.` }));
    const quiz = quizForm({ id: `${l.id}-check`, kind: 'check', items: l.check, set: 'main' }, { compact: true, onDone: () => markDone() });
    check.appendChild(quiz.el);
    const nextL = w.lessons[idx + 1];
    const el = h('div', null,
      h('header', { class: 'pagehead' }, h('span', { class: 'label', text: `Week ${w.number} · Lesson ${idx + 1} of ${w.lessons.length} · Watch & Learn` }), h('h1', { text: L.title }), h('p', { class: 'lede', text: `${l.title}. ${L.summary}` }),
        h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Objectives' }), h('b', { text: `The lesson's ${l.objectives.length} learning objectives` })), h('div', { class: 'fold__body' }, h('ul', null, l.objectives.map((o) => h('li', { html: AP.inline(o) })))))),
      pathSwitch(id, lec, l.minutes, 'watch'),
      host,
      h('p', { class: 'small muted', text: 'Optional and interchangeable with the written lesson: watching to the end, passing the comprehension check, or marking the lesson complete all count the same. Checkpoint answers are saved for your own review and are never graded. Shortcuts: Space play/pause · ← → 5 s · J/L 10 s · C captions.' }),
      check,
      h('div', { class: 'row rule' }, doneBtn, h('a', { class: 'btn', href: `#/lesson/${id}/read`, text: 'Open the written lesson' }), nextL ? h('a', { class: 'btn', href: `#/lesson/${nextL.id}`, text: `Next: ${nextL.title}` }) : h('a', { class: 'btn', href: `#/week/${w.id}`, text: 'Back to the week' })));
    return { el, title: L.title, destroy() { player.destroy(); } };
  };

  async function diagnosticNeedsFoundation(w) {
    if (!AP.settings.adaptFromDiagnostic) return false;
    if (AP.cache.diagWeak === undefined) {
      try {
        const att = await AP.api('attempts', { params: { id: 'diagnostic' } });
        const last = att.attempts[att.attempts.length - 1];
        AP.cache.diagWeak = new Set();
        if (last) {
          const d = await AP.api('attempt', { params: { id: last.id } });
          const by = {};
          for (const r of d.results) { by[r.domain] = by[r.domain] || [0, 0]; by[r.domain][0] += r.score || 0; by[r.domain][1]++; }
          for (const [dom, [s, n]] of Object.entries(by)) if (n && s / n < 0.5) AP.cache.diagWeak.add(dom);
        }
      } catch { AP.cache.diagWeak = new Set(); }
    }
    if (!AP.cache.diagWeak.size) return false;
    const cat = await AP.catalog();
    return w.concepts.some((c) => AP.cache.diagWeak.has(c.domain) || AP.cache.diagWeak.has(cat.concepts[c.id]?.domain));
  }

  /* ======================= Continue in ChatGPT ======================= */
  function chatPanel(ctx) {
    const help = h('select', { 'aria-label': 'Type of help' }, AP.HELP_TYPES.map(([v, l]) => h('option', { value: v, text: l })));
    const concept = h('select', { 'aria-label': 'Concept' }, h('option', { value: '', text: 'Whole lesson' }), (ctx.concepts || []).map((c) => h('option', { value: c, text: c })));
    const q = h('textarea', { placeholder: 'Your question or the exercise you want help with (optional)' });
    const own = ctx.ownText ? h('label', { class: 'row small' }, h('input', { type: 'checkbox' }), h('span', { text: 'Include my draft (you are choosing to share it with ChatGPT)' })) : null;
    const out = h('textarea', { class: 'tall', readonly: true, 'aria-label': 'Generated prompt' });
    const link = h('a', { class: 'btn btn--small', target: '_blank', rel: 'noopener noreferrer', text: 'Open ChatGPT', hidden: !AP.settings.chatgptLink });
    function build() {
      const cites = (ctx.sources || []).map((id) => { const r = AP.cache.libIndex.get(id); return r ? `${r.authors.slice(0, 3).join(', ')}${r.authors.length > 3 ? ' et al.' : ''} (${r.year}). ${r.title}. ${r.publication}.${r.doi ? ' doi:' + r.doi : ''}` : null; }).filter(Boolean).slice(0, 6);
      const text = AP.chatPrompt({ title: ctx.title, context: AP.plain(ctx.context || ''), objectives: ctx.objectives, concept: concept.value, citations: cites, question: q.value.trim(), help: help.value, own: own && own.querySelector('input').checked ? ctx.ownText() : null });
      out.value = text;
      const url = `https://chatgpt.com/?q=${encodeURIComponent(text)}`;
      link.href = url.length < 7000 ? url : 'https://chatgpt.com/';
      link.title = url.length < 7000 ? 'Opens ChatGPT with the prompt filled in where ChatGPT supports it; otherwise paste it.' : 'The prompt is long: copy it first, then paste it into ChatGPT.';
    }
    [help, concept, q].forEach((x) => x.addEventListener('input', build));
    if (own) own.querySelector('input').addEventListener('change', build);
    build();
    return h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Continue in ChatGPT' }), h('b', { text: 'Build a study prompt' })),
      h('div', { class: 'fold__body' }, h('label', { class: 'field' }, h('span', { text: 'Help with' }), help), ctx.concepts && ctx.concepts.length ? h('label', { class: 'field' }, h('span', { text: 'Concept' }), concept) : null, h('label', { class: 'field' }, h('span', { text: 'Question' }), q), own, out,
        h('div', { class: 'row' }, h('button', { class: 'btn btn--small btn--primary', onclick: () => { build(); AP.copy(out.value); }, text: 'Copy prompt' }), link),
        h('p', { class: 'small muted', text: 'Built from public course material only. Nothing is sent by APERTURE; opening ChatGPT is your action and shares the prompt with OpenAI.' })));
  }
  AP.chatPanel = chatPanel;

  /* ======================= Assessments ======================= */
  // quizForm renders a set of questions, collects answers + optional confidence, submits for
  // server grading and renders feedback. spec: { id, kind, items, set }
  function quizForm(spec, { compact, onDone, onResult } = {}) {
    const answers = {}, conf = {};
    const started = Date.now();
    const root = h('div');
    const qEls = spec.items.map((q, i) => questionEl(q, i, answers, conf, compact));
    qEls.forEach((x) => root.appendChild(x.el));
    const submit = h('button', { class: 'btn btn--primary', text: compact ? 'Check answers' : 'Submit for grading' });
    const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
    root.append(h('div', { class: 'row rule' }, submit), status);
    submit.addEventListener('click', async () => {
      const unanswered = spec.items.filter((q) => answers[q.id] == null || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !answers[q.id].length)).length;
      if (unanswered && !window.confirm(`${unanswered} question${unanswered > 1 ? 's are' : ' is'} unanswered. Submit anyway?`)) return;
      submit.disabled = true; status.textContent = 'Grading…';
      try {
        const r = await AP.api('assessment/submit', { method: 'POST', body: { id: spec.id, set: spec.set, answers, confidence: conf, started } });
        AP.cache.diagWeak = spec.id === 'diagnostic' ? undefined : AP.cache.diagWeak;
        const byId = new Map(r.results.map((x) => [x.id, x]));
        qEls.forEach((x) => x.showFeedback(byId.get(x.q.id)));
        status.textContent = '';
        submit.remove();
        root.appendChild(resultSummary(spec, r, compact));
        AP.announce(`Scored ${AP.pct(r.ratio)} on auto-graded items.`);
        if (onDone && (r.ratio == null || r.ratio >= 0.5)) onDone(r);
        if (onResult) onResult(r);
      } catch (e) { submit.disabled = false; status.textContent = e.message; }
    });
    return { el: root };
  }
  S.quizForm = quizForm;

  function questionEl(q, i, answers, conf, compact) {
    const name = `q-${q.id}`;
    const body = h('div');
    const el = h('div', { class: 'q', id: name }, h('div', { class: 'q__head' }, h('span', { class: 'label', text: `${i + 1} · ${TYPE_LABEL[q.type] || q.type}${q.difficulty === 'stretch' ? ' · stretch' : ''}` }), h('span', { class: 'q__score' })),
      q.stimulus ? AP.blocks(h('div', { class: 'q__stim prose' }), q.stimulus) : null, h('div', { class: 'q__prompt', html: AP.inline(q.prompt) }), body);
    const choices = [];
    if (['mc', 'scenario', 'flaw', 'research', 'decision'].includes(q.type)) {
      for (const o of q.options) { const inp = h('input', { type: 'radio', name, value: o.id, onchange: () => (answers[q.id] = o.id) }); const lab = h('label', { class: 'choice' }, inp, h('span', { html: AP.inline(o.text) })); choices.push([o.id, lab]); body.appendChild(lab); }
    } else if (q.type === 'multi' || q.type === 'issue') {
      answers[q.id] = [];
      body.appendChild(h('p', { class: 'small muted', text: q.type === 'issue' ? 'Select every real issue.' : 'Select all that apply.' }));
      for (const o of q.options) { const inp = h('input', { type: 'checkbox', value: o.id, onchange: (e) => { const s = new Set(answers[q.id]); e.target.checked ? s.add(o.id) : s.delete(o.id); answers[q.id] = [...s]; } }); const lab = h('label', { class: 'choice' }, inp, h('span', { html: AP.inline(o.text) })); choices.push([o.id, lab]); body.appendChild(lab); }
    } else if (q.type === 'rank') {
      const order = q.options.map((o) => o.id);
      answers[q.id] = order.slice();
      const list = h('ol', { class: 'rank' });
      const draw = () => { AP.clear(list); answers[q.id].forEach((oid, k) => { const o = q.options.find((x) => x.id === oid); list.appendChild(h('li', null, h('span', { html: AP.inline(o.text) }), h('button', { class: 'btn btn--small btn--quiet', 'aria-label': 'Move up', disabled: k === 0, onclick: () => { const a = answers[q.id]; [a[k - 1], a[k]] = [a[k], a[k - 1]]; draw(); }, text: '↑' }), h('button', { class: 'btn btn--small btn--quiet', 'aria-label': 'Move down', disabled: k === answers[q.id].length - 1, onclick: () => { const a = answers[q.id]; [a[k + 1], a[k]] = [a[k], a[k + 1]]; draw(); }, text: '↓' }))); }); };
      draw();
      body.append(h('p', { class: 'small muted', text: 'Order from best (top) to worst.' }), list);
    } else if (q.type === 'numeric') {
      body.appendChild(h('label', { class: 'field' }, h('span', { text: `Your answer${q.unit ? ` (${q.unit})` : ''}` }), h('input', { type: 'text', inputmode: 'decimal', oninput: (e) => (answers[q.id] = e.target.value) })));
    } else if (q.type === 'short') {
      body.appendChild(h('textarea', { 'aria-label': 'Your response', oninput: (e) => (answers[q.id] = e.target.value) }));
      body.appendChild(h('p', { class: 'small muted', text: 'Short responses are not auto-graded. After submitting you will see the model answer and rubric and assess yourself.' }));
    }
    if (q.type !== 'short' && !compact) {
      const c = h('div', { class: 'conf' }, h('span', { text: 'Confidence (optional):' }));
      [50, 60, 70, 80, 90, 100].forEach((v) => c.appendChild(h('button', { 'aria-pressed': 'false', onclick: (e) => { conf[q.id] = v; c.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); }, text: `${v}%` })));
      body.appendChild(c);
    }
    function showFeedback(fb) {
      if (!fb) return;
      el.querySelectorAll('input, textarea, .rank button, .conf button').forEach((x) => (x.disabled = true));
      const score = el.querySelector('.q__score');
      if (fb.type === 'short') { score.textContent = 'Self-assessed'; }
      else { score.textContent = fb.score === 1 ? 'Correct' : fb.score > 0 ? `Partial ${AP.pct(fb.score)}` : 'Incorrect'; score.dataset.ok = fb.score === 1 ? '1' : '0'; }
      const correctSet = new Set(Array.isArray(fb.answer) ? fb.answer : fb.answer && typeof fb.answer === 'string' ? [fb.answer] : []);
      if (q.type !== 'rank') for (const [oid, lab] of choices) { if (correctSet.has(oid)) lab.classList.add('is-correct'); else if (Array.isArray(fb.response) ? fb.response.includes(oid) : fb.response === oid) lab.classList.add('is-wrong'); }
      el.appendChild(feedbackEl(q, fb));
    }
    return { el, q, showFeedback };
  }
  const TYPE_LABEL = { mc: 'Multiple choice', multi: 'Multiple select', scenario: 'Scenario analysis', flaw: 'Flawed reasoning', research: 'Research interpretation', decision: 'Decision simulation', issue: 'Issue spotting', rank: 'Ranking', numeric: 'Numerical', short: 'Short response' };
  AP.TYPE_LABEL = TYPE_LABEL;

  function feedbackEl(q, fb) {
    const box = h('div', { class: 'q__fb' });
    if (fb.type === 'short') {
      box.append(h('span', { class: 'label', text: 'Model answer' }), h('p', { html: AP.inline(fb.modelAnswer || '') }), h('span', { class: 'label', text: 'Rubric' }), h('ul', null, (fb.rubric || []).map((r) => h('li', null, h('b', { text: `${r.criterion} (${r.points} pts): ` }), r.levels.join(' · ')))));
      return box;
    }
    if (q.type === 'rank' || fb.type === 'rank') box.append(h('span', { class: 'label', text: 'Defensible order' }), h('ol', null, fb.answer.map((oid) => h('li', { html: AP.inline((q.options || []).find((o) => o.id === oid)?.text || oid) }))));
    if (fb.type === 'numeric') box.append(h('span', { class: 'label', text: 'Answer' }), h('p', { text: `${fb.answer.value}${fb.answer.unit ? ' ' + fb.answer.unit : ''} (tolerance ±${fb.answer.tolerance})` }));
    box.append(h('span', { class: 'label', text: 'Explanation' }), h('p', { html: AP.inline(fb.explanation || '') }));
    if (fb.working) box.append(h('span', { class: 'label', text: 'Working' }), h('p', { html: AP.inline(fb.working) }));
    const picked = Array.isArray(fb.response) ? fb.response : fb.response ? [fb.response] : [];
    const notes = picked.filter((p) => fb.optionFeedback && fb.optionFeedback[p]);
    for (const p of notes) box.append(h('p', { class: 'small' }, h('b', { text: `Your choice (${p}): ` }), h('span', { html: AP.inline(fb.optionFeedback[p]) })));
    if (fb.errorTags && fb.errorTags.length) box.append(h('p', { class: 'small muted', text: `Reasoning pattern: ${fb.errorTags.map((t) => t.replace(/-/g, ' ')).join(', ')}` }));
    if (fb.lesson) box.append(h('p', { class: 'small' }, h('a', { href: `#/lesson/${fb.lesson}`, text: 'Revisit the lesson' })));
    return box;
  }

  function resultSummary(spec, r, compact) {
    const box = h('div', { class: 'panel rule' }, h('span', { class: 'label', text: 'Result' }),
      h('p', null, h('span', { class: 'scorebig num', text: AP.pct(r.ratio) }), h('span', { class: 'muted', text: `  ${AP.fmtNum(r.autoScore)} of ${r.autoMax} auto-graded points` })),
      r.mastery != null ? h('p', { text: r.mastered ? `Mastery reached (threshold ${Math.round(r.mastery * 100)}%).` : `Below the ${Math.round(r.mastery * 100)}% mastery threshold.` }) : h('p', { class: 'muted', text: 'Not graded — this calibrates your experience.' }));
    if (r.focus) box.append(h('span', { class: 'label', text: 'Focused review' }), h('p', { class: 'small', text: r.focus.note }), h('ul', null, r.focus.lessons.map((l) => h('li', null, h('a', { href: `#/lesson/${l.id}`, text: l.title })))), r.focus.concepts.length ? h('p', { class: 'small muted', text: `Concepts: ${r.focus.concepts.map((c) => c.name).join(', ')}. Their review cards moved back to box 1.` }) : null,
      r.reassessAvailable ? h('p', null, h('a', { class: 'btn', href: `#/assess/${spec.id}/reassess`, text: 'Take the reassessment' })) : null);
    const shorts = r.results.filter((x) => x.type === 'short');
    if (shorts.length) box.appendChild(selfAssessForm(r.attempt, shorts));
    box.appendChild(h('p', { class: 'small muted', text: r.rules }));
    if (!compact) box.appendChild(h('p', null, h('a', { href: `#/attempt/${r.attempt}`, text: 'Permanent record of this attempt' })));
    return box;
  }
  function selfAssessForm(attemptId, shorts) {
    const scores = {};
    const f = h('div', { class: 'rule' }, h('h3', { text: 'Self-assess your short responses' }), h('p', { class: 'small muted', text: 'Compare your response with the model answer and score each rubric criterion honestly. These points are labelled self-assessed everywhere they appear.' }));
    for (const s of shorts) {
      scores[s.id] = {};
      f.appendChild(h('p', { class: 'small', html: `<b>${AP.esc(s.id)}</b>` }));
      s.rubric.forEach((c, i) => {
        const sel = h('select', { 'aria-label': c.criterion, onchange: (e) => (scores[s.id][i] = Number(e.target.value)) }, h('option', { value: '', text: '—' }), Array.from({ length: c.points + 1 }, (_, k) => h('option', { value: String(k), text: `${k} — ${c.levels[k] || ''}` })));
        f.appendChild(h('label', { class: 'field' }, h('span', { text: `${c.criterion} (max ${c.points})` }), sel));
      });
    }
    const btn = h('button', { class: 'btn', text: 'Save self-assessment', onclick: async () => { try { const r = await AP.api('assessment/self', { method: 'POST', body: { attempt: attemptId, scores } }); btn.disabled = true; btn.textContent = `Saved: ${r.selfScore} of ${r.selfMax} points (self-assessed)`; } catch (e) { AP.toast(e.message); } } });
    f.appendChild(btn);
    return f;
  }
  AP.selfAssessForm = selfAssessForm;

  S.assess = async function (id, set) {
    const cat = await AP.catalog();
    const a = await AP.api('assessment', { params: { id, set } });
    const w = cat.weeks.find((x) => x.quiz.id === id);
    const intro = [];
    if (id === 'midterm') intro.push(h('p', null, 'Read the cumulative case first: ', h('a', { href: '#/midterm', text: 'midterm overview and case' })));
    const form = quizForm({ id, kind: a.kind, items: a.items, set }, {});
    const prev = await AP.api('attempts', { params: { id } });
    return { el: h('div', null, AP.head(`${a.kind}${set === 'reassess' ? ' · reassessment' : ''}${a.minutes ? ` · about ${a.minutes} min` : ''}`, a.title, `${a.items.length} questions.${a.mastery ? ` Mastery at ${Math.round(a.mastery * 100)}%.` : ''} ${AP.local() ? 'Scored in your browser — a learning exercise, not a secure exam' : 'Graded on the server'}; explanations appear after you submit.`),
      w ? h('p', { class: 'small' }, h('a', { href: `#/week/${w.id}`, text: `Week ${w.number}: ${w.title}` })) : null, ...intro,
      prev.attempts.length ? h('p', { class: 'small muted', text: `Previous attempts: ${prev.attempts.map((x) => `${AP.date(x.submitted)} ${AP.pct(x.ratio)}`).join(' · ')}` }) : null,
      h('div', { class: 'notice notice--plain small', text: a.rules }), form.el), title: a.title };
  };

  S.attempt = async function (id) {
    const a = await AP.api('attempt', { params: { id } });
    const el = h('div', null, AP.head(`${a.kind} · ${AP.date(a.submitted)}`, a.assessment, a.ratio != null ? `${AP.pct(a.ratio)} on auto-graded items${a.selfMax ? ` · ${a.selfScore} of ${a.selfMax} self-assessed points` : ''}.` : a.selfScore != null ? `${AP.pct(a.selfScore)} — self-assessed against the rubric.` : null));
    if (a.checks) el.appendChild(h('section', null, h('h3', { text: 'Automated checks (format only)' }), h('ul', null, a.checks.map((c) => h('li', { text: `${c.pass ? '✓' : '✗'} ${c.label} — ${c.detail}` })))));
    if (a.metrics) el.appendChild(h('p', { class: 'small muted', text: `${a.metrics.words} words · ${a.metrics.sentences} sentences · ${a.metrics.meanSentence.toFixed(1)} words per sentence · ${a.metrics.longSentences} over 25 words` }));
    if (a.rubric) el.appendChild(h('section', null, h('h3', { text: 'Rubric (self-assessed)' }), h('ul', null, Object.entries(a.rubric).map(([k, v]) => h('li', { text: `${k}: ${v} of 4` })))));
    if (a.aiFeedback) el.appendChild(h('section', null, h('h3', { text: 'External AI review (pasted by you — not an APERTURE grade)' }), h('p', { class: 'prose', text: a.aiFeedback })));
    if (a.sections) el.appendChild(h('section', { class: 'rule' }, h('h3', { text: 'Submitted text' }), a.sections.map((s) => h('p', { text: s }))));
    for (const [i, r] of a.results.entries()) {
      if (r.missing) continue;
      const q = { ...r, options: r.options };
      const box = h('div', { class: 'q' }, h('div', { class: 'q__head' }, h('span', { class: 'label', text: `${i + 1} · ${TYPE_LABEL[r.type]}` }), h('span', { class: 'q__score', dataset: { ok: r.score === 1 ? '1' : '0' }, text: r.type === 'short' ? (r.self ? `Self-assessed ${AP.pct(r.self.ratio)}` : 'Awaiting self-assessment') : r.score === 1 ? 'Correct' : r.score > 0 ? `Partial ${AP.pct(r.score)}` : 'Incorrect' })),
        r.stimulus ? AP.blocks(h('div', { class: 'q__stim prose' }), r.stimulus) : null, h('div', { class: 'q__prompt', html: AP.inline(r.prompt) }),
        r.type === 'short' ? h('p', { class: 'prose', text: r.response || '(no response)' }) : h('p', { class: 'small', text: `Your answer: ${Array.isArray(r.response) ? r.response.join(', ') : r.response ?? '—'}${r.confidence ? ` · confidence ${r.confidence}%` : ''}` }), feedbackEl(q, r));
      el.appendChild(box);
    }
    if (a.pendingSelf) el.appendChild(selfAssessForm(a.id, a.results.filter((r) => r.type === 'short')));
    el.appendChild(h('p', { class: 'small muted rule', text: a.rules }));
    return { el, title: 'Attempt' };
  };

  /* ======================= Assignments ======================= */
  S.assignment = async function (id) {
    const cat = await AP.catalog();
    let asg, w = null;
    if (id.startsWith('capstone-')) { const cap = await AP.get('capstone', 'capstone'); const d = cap.deliverables.find((x) => `capstone-${x.id}` === id); if (!d) return h('p', { class: 'empty', text: 'Unknown deliverable.' }); asg = { ...d, id, capstone: true, brief: [{ type: 'p', kind: 'original', text: d.description }], deliverable: d.title, template: d.components.map((k) => { const c = cap.components.find((x) => x.id === k); return { heading: c.title, guidance: `Draws on component ${c.number}. Start from your component draft.` }; }), checks: ['sections'], minutes: null, componentDrafts: d.components }; }
    else { w = await AP.week(id.slice(0, 3)); asg = w.assignment; }
    await AP.loadState(['draft']);
    const draft = AP.getRec('draft', id) || { sections: [] };
    if (asg.componentDrafts && !draft.sections.some(Boolean)) draft.sections = asg.componentDrafts.map((k) => (AP.getRec('draft', `capstone-${k}`)?.sections || []).filter(Boolean).join('\n\n'));
    const sections = asg.template.map((_, i) => draft.sections[i] || '');
    const counter = h('span', { class: 'small muted num' });
    const recount = () => { const n = sections.reduce((a, s) => a + AP.words(s), 0); counter.textContent = `${n} words${asg.words ? ` · target ${asg.words[0]}–${asg.words[1]}` : ''}`; return n; };
    const persist = () => AP.save('draft', id, { sections, words: recount() });
    const fields = asg.template.map((t, i) => h('label', { class: 'field' }, h('span', { html: AP.inline(t.heading) }), t.guidance ? h('small', { html: AP.inline(t.guidance) }) : null, h('textarea', { class: 'tall', value: sections[i], oninput: (e) => { sections[i] = e.target.value; persist(); } })));
    recount();
    const rub = {};
    const rubric = h('table', { class: 'rubric' }, h('thead', null, h('tr', null, h('th', { text: 'Criterion' }), [4, 3, 2, 1].map((s) => h('th', { text: String(s) })))), h('tbody', null, asg.rubric.map((r) => h('tr', null, h('td', null, h('b', { text: r.criterion }), h('div', { class: 'small muted', text: `${r.weight}%` })), [4, 3, 2, 1].map((s) => { const lv = r.levels.find((x) => x.score === s); return h('td', null, h('label', null, h('input', { type: 'radio', name: `rub-${r.id}`, value: String(s), onchange: () => (rub[r.id] = s) }), h('span', { html: AP.inline(`**${lv.label}.** ${lv.descriptor}`) }))); })))));
    const ai = h('textarea', { placeholder: 'Optional: paste feedback you obtained from ChatGPT or a colleague. It is stored labelled as external review and never changes your score.' });
    const result = h('div', { 'aria-live': 'polite' });
    const submit = h('button', { class: 'btn btn--primary', text: 'Submit and record self-assessment', onclick: async () => {
      if (Object.keys(rub).length < asg.rubric.length && !window.confirm('Not every rubric criterion is rated. The submission is recorded but not scored until you rate all of them. Continue?')) return;
      submit.disabled = true;
      try {
        const r = await AP.api('assignment/submit', { method: 'POST', body: { id, sections, rubric: rub, aiFeedback: ai.value } });
        AP.clear(result).append(h('div', { class: 'panel' }, h('span', { class: 'label', text: 'Recorded' }), h('ul', null, r.checks.map((c) => h('li', { text: `${c.pass ? '✓' : '✗'} ${c.label} — ${c.detail} (automated, format only)` }))), h('p', { text: r.complete ? `Self-assessed score: ${AP.pct(r.selfScore)}.` : 'Saved without a score: rate every criterion to record one.' }), h('p', { class: 'small muted', text: `${r.metrics.meanSentence.toFixed(1)} words per sentence; ${r.metrics.longSentences} sentences over 25 words. These are readability measures, not judgments of content.` }), h('a', { href: `#/attempt/${r.attempt}`, text: 'View the record' })));
      } catch (e) { AP.toast(e.message); } finally { submit.disabled = false; }
    } });
    const studio = asg.composer ? h('p', null, h('a', { class: 'btn', href: `#/exercise/${id}-studio`, text: 'Draft in the Executive Communication Studio' })) : null;
    const el = h('div', null,
      AP.head(`${w ? `Week ${w.number} · ` : 'Capstone · '}Applied assignment${asg.minutes ? ` · about ${asg.minutes} min` : ''}`, asg.title, asg.deliverable),
      AP.blocks(h('div', { class: 'prose' }), asg.brief), studio,
      h('section', { class: 'rule' }, h('div', { class: 'row row--between' }, h('h2', { text: 'Your work' }), counter), h('p', { class: 'small muted', text: 'Saved automatically to your private notebook as you type.' }), fields),
      h('section', { class: 'rule' }, h('h2', { text: 'Rubric and self-assessment' }), h('p', { class: 'small muted', text: 'APERTURE does not grade essay content. Automated checks cover length and completeness only. Your score is your own rubric assessment and is labelled self-assessed.' }), h('div', { class: 'tablewrap' }, rubric),
        h('label', { class: 'field' }, h('span', { text: 'External review (optional)' }), ai), h('div', { class: 'row' }, submit), result),
      AP.chatPanel({ title: `${asg.title}${w ? ` (Week ${w.number}: ${w.title})` : ''}`, context: AP.plain(asg.deliverable), objectives: w ? w.objectives : [], concepts: [], sources: w ? w.readings.required.map((r) => r.ref) : [], ownText: () => asg.template.map((t, i) => `## ${AP.plain(t.heading)}\n${sections[i]}`).join('\n\n') + `\n\nRubric:\n${asg.rubric.map((r) => `- ${r.criterion} (${r.weight}%): exemplary = ${r.levels.find((l) => l.score === 4).descriptor}`).join('\n')}` }));
    return { el, title: asg.title };
  };

  /* ======================= Cases ======================= */
  S.caseView = async function (id) {
    let c, w = null;
    if (id === 'midterm-case' || id.startsWith('mt')) { const m = await AP.get('midterm', 'midterm'); c = m.case; }
    else { w = await AP.week(id.slice(0, 3)); c = w.case; }
    await AP.loadState(['case']);
    const rec = AP.getRec('case', c.id) || { analysis: '' };
    let analysis = rec.analysis;
    const persp = h('div');
    const reveal = h('button', { class: 'btn', text: `Read ${c.perspectivesCount} alternative perspectives`, onclick: async () => {
      await AP.flush();
      try { const r = await AP.api('case/reveal', { method: 'POST', body: { id: c.id } }); AP.clear(persp).append(...r.perspectives.map((p) => h('div', { class: 'panel' }, h('h3', { html: AP.inline(p.title) }), h('p', { html: AP.inline(p.text) })))); reveal.remove(); }
      catch (e) { AP.toast(e.message); }
    } });
    const el = h('div', null,
      AP.head(`${w ? `Week ${w.number} · ` : 'Midterm · '}Original case · ${c.setting} · about ${c.minutes} min`, c.title, null), h('p', { class: 'notice notice--plain small', html: AP.inline(c.fiction) }),
      h('div', { class: 'reader' }, h('article', { class: 'prose' }, AP.blocks(h('div'), c.body),
        c.exhibits && c.exhibits.length ? h('section', { class: 'rule' }, h('h2', { text: 'Exhibits' }), c.exhibits.map((x) => AP.blocks(h('div'), [{ type: 'table', caption: x.title, headers: x.headers, rows: x.rows, note: x.note }]))) : null,
        c.assumptions && c.assumptions.length ? h('section', null, h('h3', { text: 'Assumptions' }), h('ul', null, c.assumptions.map((a) => h('li', { html: AP.inline(a) })))) : null),
        h('aside', { class: 'reader__side' }, h('div', { class: 'sticky' }, h('div', null, h('span', { class: 'label', text: 'Discussion questions' }), h('ol', { class: 'small' }, c.questions.map((q) => h('li', { html: AP.inline(q) })))), h('div', null, h('span', { class: 'label', text: 'Professional application' }), h('p', { class: 'small', html: AP.inline(c.application) }))))),
      h('section', { class: 'rule' }, h('h2', { text: 'Your analysis' }), h('p', { class: 'small muted', text: 'Write your position before reading other perspectives (50+ words unlocks them). There is no single right answer; the perspectives are defensible positions, not an answer key.' }), h('textarea', { class: 'tall', value: analysis, oninput: (e) => { analysis = e.target.value; AP.save('case', c.id, { analysis }); } }), h('div', { class: 'row' }, reveal), persp));
    return { el, title: c.title };
  };

  /* ======================= Lab exercises ======================= */
  S.exercise = async function (id) {
    const [cat, x] = await Promise.all([AP.catalog(), AP.api('exercise', { params: { id } })]);
    await AP.loadState(['lab']);
    let w = null; if (/^w\d{2}-/.test(id)) w = await AP.week(id.slice(0, 3));
    const ex = w && w.exercise.id === id ? w.exercise : x;
    const saved = AP.getRec('lab', id);
    const mountEl = h('div', { class: 'lab-host' });
    const lab = cat.labs.find((l) => l.id === ex.lab);
    const el = h('div', null, AP.head(`${lab ? lab.name : 'Lab'}${w ? ` · Week ${w.number}` : ''}${ex.minutes ? ` · about ${ex.minutes} min` : ''}`, ex.title, null),
      ex.intro ? AP.blocks(h('div', { class: 'prose' }), ex.intro) : null,
      ex.assumptions && ex.assumptions.length ? h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Assumptions' }), h('b', { text: 'Rules and assumptions of this exercise' })), h('div', { class: 'fold__body' }, h('ul', null, ex.assumptions.map((a) => h('li', { html: AP.inline(a) }))))) : null,
      mountEl,
      ex.debrief ? h('details', { class: 'fold' }, h('summary', null, h('span', { class: 'label', text: 'Debrief' }), h('b', { text: 'What this exercise shows — and what it does not' })), h('div', { class: 'fold__body prose' }, AP.blocks(h('div'), ex.debrief))) : null);
    let handle = null;
    if (!window.ApertureLabs || !window.ApertureLabs.mount) mountEl.appendChild(h('p', { class: 'empty', text: 'The lab engines did not load.' }));
    else handle = window.ApertureLabs.mount(mountEl, {
      engine: ex.engine, exercise: { id, title: ex.title, minutes: ex.minutes, assumptions: ex.assumptions || [], config: ex.config }, saved: saved || null, mode: AP.mode(),
      api: {
        reveal: async () => (await AP.api('lab/reveal', { method: 'POST', body: { id } })).config,
        save: (payload) => AP.save('lab', id, payload, { delay: payload && payload.finished ? 0 : 800 }),
      },
      ui: { inline: AP.inline, blocks: (node, b) => AP.blocks(node, b) },
    });
    return { el, title: ex.title, destroy: () => handle && handle.destroy && handle.destroy() };
  };

  /* ======================= Spaced review ======================= */
  S.review = async function () {
    const r = await AP.api('review');
    const el = h('div', null, AP.head('Spaced review', r.dueCount ? `${r.dueCount} concepts due` : 'Nothing due right now', r.rules));
    const box = h('div');
    el.appendChild(box);
    let i = 0;
    const queue = r.due.slice();
    function next() {
      AP.clear(box);
      if (i >= queue.length) { box.append(h('p', { class: 'empty', text: queue.length ? 'Session complete.' : 'No cards are due. Cards join the schedule when you complete lessons.' }), upcoming(r)); return; }
      const c = queue[i];
      const back = h('div', { class: 'card__back', hidden: true }, h('p', { html: AP.inline(c.back) }), h('p', { class: 'small muted' }, h('a', { href: `#/lesson/${c.lesson}`, text: 'Lesson' }), ` · ${c.conceptName} · box ${c.box}`));
      let confidence = 0;
      const confRow = h('div', { class: 'conf' }, h('span', { text: 'How sure were you? (1–5, optional)' }), [1, 2, 3, 4, 5].map((v) => h('button', { 'aria-pressed': 'false', onclick: (e) => { confidence = v; confRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); }, text: String(v) })));
      const rate = h('div', { class: 'row', hidden: true }, [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([v, l]) => h('button', { class: `btn${v === 'good' ? ' btn--primary' : ''}`, onclick: async () => { try { await AP.api('review/grade', { method: 'POST', body: { card: c.card, rating: v, confidence } }); } catch (e) { AP.toast(e.message); } i++; next(); }, text: l })));
      const show = h('button', { class: 'btn btn--primary', text: 'Show answer', onclick: () => { back.hidden = false; rate.hidden = false; show.remove(); } });
      box.append(h('p', { class: 'small muted', text: `${i + 1} of ${queue.length}` }), h('div', { class: 'card' }, h('div', { class: 'card__front', html: AP.inline(c.front) }), back), h('p', { class: 'small muted', text: 'Answer in your head (or aloud) before revealing.' }), confRow, h('div', { class: 'row' }, show), rate);
    }
    next();
    return { el, title: 'Review' };
  };
  function upcoming(r) {
    return h('div', { class: 'rule' }, h('h3', { text: 'Coming up' }), h('p', { class: 'small muted', text: r.upcoming.map((u) => `day ${u.day}: ${u.count}`).join(' · ') }), h('p', { class: 'small muted', text: r.boxes.map((b) => `box ${b.box} (${b.days} d): ${b.count}`).join(' · ') }));
  }

  /* ======================= Strategic Decision Journal ======================= */
  S.journal = async function () {
    await AP.loadState(['journal']);
    const entries = Object.entries(AP.state.journal || {}).sort((a, b) => String(b[1].data.date).localeCompare(String(a[1].data.date)));
    const resolved = entries.flatMap(([, e]) => (e.data.forecasts || []).filter((f) => f.outcome !== null));
    const brier = resolved.length ? resolved.reduce((a, f) => a + (f.p - (f.outcome ? 1 : 0)) ** 2, 0) / resolved.length : null;
    const today = new Date().toISOString().slice(0, 10);
    return { el: h('div', null, AP.head('Labs · Strategic Decision Journal', 'Decisions, before you know how they turn out', 'Record the decision, your options and assumptions, what would change your mind, and probability forecasts with resolve-by dates. Review later to separate the quality of the decision from the luck of the outcome. Use non-confidential decisions only.'),
      h('div', { class: 'row' }, h('a', { class: 'btn btn--primary', href: '#/journal/new', text: 'New entry' }), h('span', { class: 'small muted', text: brier != null ? `Calibration: Brier ${brier.toFixed(3)} over ${resolved.length} resolved forecasts (0 = perfect, 0.25 = always saying 50%).` : 'Resolve forecasts to see your calibration.' })),
      entries.length ? h('ul', { class: 'items rule' }, entries.map(([k, e]) => h('li', null, h('a', { href: `#/journal/${k}` }, h('span', { class: 'label', text: e.data.date || '' }), h('span', null, h('span', { class: 'items__t', text: e.data.title || 'Untitled decision' }), h('span', { class: 'items__d', text: `${(e.data.forecasts || []).length} forecasts${e.data.reviewDate ? ` · review ${e.data.reviewDate}` : ''}` })), h('span', { class: `tag ${e.data.reviewed ? 'tag--done' : e.data.reviewDate && e.data.reviewDate <= today ? 'tag--accent' : ''}`, text: e.data.reviewed ? 'Reviewed' : e.data.reviewDate && e.data.reviewDate <= today ? 'Review due' : 'Open' }))))) : h('p', { class: 'empty rule', text: 'No entries yet.' })), title: 'Decision journal' };
  };
  S.journalEntry = async function (key) {
    await AP.loadState(['journal']);
    if (key === 'new') { key = AP.newId(); location.replace(`#/journal/${key}`); }
    const e = { title: '', date: new Date().toISOString().slice(0, 10), context: '', options: '', choice: '', rationale: '', assumptions: '', changeMind: '', expected: '', reviewDate: '', state: '', forecasts: [], outcome: '', quality: '', lessons: '', reviewed: false, ...(AP.getRec('journal', key) || {}) };
    const save = () => AP.save('journal', key, e);
    const f = (k, label, help, tall) => h('label', { class: 'field' }, h('span', { text: label }), help ? h('small', { text: help }) : null, h(tall ? 'textarea' : 'input', { type: k.toLowerCase().includes('date') ? 'date' : 'text', value: e[k], oninput: (ev) => { e[k] = ev.target.value; save(); } }));
    const fc = h('div');
    function drawF() {
      AP.clear(fc);
      e.forecasts.forEach((x, i) => fc.appendChild(h('div', { class: 'panel', style: null },
        h('label', { class: 'field' }, h('span', { text: 'Outcome you are forecasting' }), h('input', { type: 'text', value: x.text, oninput: (ev) => { x.text = ev.target.value; save(); } })),
        h('div', { class: 'grid grid--3' }, h('label', { class: 'field' }, h('span', { text: 'Probability (%)' }), h('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(x.p * 100), oninput: (ev) => { x.p = Math.max(0, Math.min(100, Number(ev.target.value) || 0)) / 100; save(); } })), h('label', { class: 'field' }, h('span', { text: 'Resolve by' }), h('input', { type: 'date', value: x.by, oninput: (ev) => { x.by = ev.target.value; save(); } })),
          h('label', { class: 'field' }, h('span', { text: 'Resolution' }), h('select', { onchange: (ev) => { x.outcome = ev.target.value === '' ? null : ev.target.value === 'yes'; save(); } }, h('option', { value: '', text: 'Unresolved', selected: x.outcome == null }), h('option', { value: 'yes', text: 'Happened', selected: x.outcome === true }), h('option', { value: 'no', text: 'Did not happen', selected: x.outcome === false })))),
        h('button', { class: 'btn btn--small btn--quiet', onclick: () => { e.forecasts.splice(i, 1); save(); drawF(); }, text: 'Remove forecast' }))));
      fc.appendChild(h('button', { class: 'btn btn--small', onclick: () => { e.forecasts.push({ id: AP.newId().slice(0, 8), text: '', p: 0.6, by: '', outcome: null }); save(); drawF(); }, text: 'Add a forecast' }));
    }
    drawF();
    const quality = h('div', { class: 'seg', role: 'group', 'aria-label': 'Decision quality versus outcome' }, [['good-good', 'Sound decision · good outcome'], ['good-bad', 'Sound decision · bad outcome'], ['bad-good', 'Weak decision · good outcome'], ['bad-bad', 'Weak decision · bad outcome']].map(([v, l]) => h('button', { 'aria-pressed': String(e.quality === v), onclick: (ev) => { e.quality = v; quality.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); ev.currentTarget.setAttribute('aria-pressed', 'true'); save(); }, text: l })));
    const el = h('div', null, AP.head('Strategic Decision Journal', e.title || 'New decision', 'Never record confidential employer information here.'),
      h('div', { class: 'grid grid--2' }, f('title', 'Decision'), f('date', 'Date')),
      f('context', 'Context', 'What is happening, and why does a decision have to be made now?', true), f('options', 'Options considered', 'Include doing nothing.', true), f('choice', 'What I chose', null, true), f('rationale', 'Rationale', null, true),
      f('assumptions', 'Key assumptions', 'What must be true for this to work?', true), f('changeMind', 'What would change my mind', 'Name the evidence in advance.', true), f('expected', 'Expected outcome', null, true), f('state', 'State of mind (optional)', 'Tired, rushed, under pressure? Context, not a diagnosis.'),
      h('section', { class: 'rule' }, h('h2', { text: 'Forecasts' }), h('p', { class: 'small muted', text: 'Concrete, checkable statements with a probability and a date. Resolved forecasts build your Brier score.' }), fc),
      h('section', { class: 'rule' }, h('h2', { text: 'Later: review' }), f('reviewDate', 'Review on'), f('outcome', 'What actually happened', null, true), h('div', { class: 'field' }, h('span', { text: 'Process versus outcome' }), quality), f('lessons', 'Lessons', null, true),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: e.reviewed, onchange: (ev) => { e.reviewed = ev.target.checked; save(); } }), h('span', { text: 'Reviewed' }))),
      h('div', { class: 'row rule' }, h('a', { class: 'btn', href: '#/journal', text: 'All entries' }), h('button', { class: 'btn btn--quiet', onclick: async () => { if (window.confirm('Delete this entry?')) { await AP.remove('journal', key); location.hash = '#/journal'; } }, text: 'Delete entry' })));
    return { el, title: 'Journal entry' };
  };

  /* ======================= Diagnostic, midterm, capstone ======================= */
  S.diagnostic = async function () {
    const d = await AP.get('diagnostic', 'diagnostic');
    const prev = await AP.api('attempts', { params: { id: 'diagnostic' } });
    return { el: h('div', null, AP.head(`Week 1 · not graded · about ${d.minutes} min`, d.title, null), AP.blocks(h('div', { class: 'prose' }), d.intro),
      prev.attempts.length ? h('p', { class: 'small muted' }, `Taken ${AP.date(prev.attempts[prev.attempts.length - 1].submitted)}. `, h('a', { href: `#/attempt/${prev.attempts[prev.attempts.length - 1].id}`, text: 'See results' }), '. You may retake it, but the first attempt is your baseline.') : null,
      h('p', null, h('a', { class: 'btn btn--primary', href: '#/assess/diagnostic', text: prev.attempts.length ? 'Retake the diagnostic' : 'Begin the diagnostic' }))), title: d.title };
  };
  S.midterm = async function () {
    const m = await AP.get('midterm', 'midterm');
    return { el: h('div', null, AP.head(`Midterm · Weeks 1–7 · about ${m.minutes} min · 20% of the grade`, m.title, null), AP.blocks(h('div', { class: 'prose' }), m.intro),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/case/${m.case.id || 'midterm-case'}`, text: 'Read the cumulative case' }), h('a', { class: 'btn btn--primary', href: '#/assess/midterm', text: 'Begin the midterm' }))), title: m.title };
  };
  S.capstone = async function () {
    const c = await AP.get('capstone', 'capstone');
    await AP.loadState(['draft', 'lab']);
    const comps = h('ol', { class: 'items' }, c.components.map((k) => { const d = AP.getRec('draft', `capstone-${k.id}`); return h('li', null, h('a', { href: `#/capstone/${k.id}` }, h('span', { class: 'label', text: `${String(k.number).padStart(2, '0')} · after week ${k.week}` }), h('span', null, h('span', { class: 'items__t', text: k.title }), h('span', { class: 'items__d', text: `${k.words[0]}–${k.words[1]} words${k.tool ? ` · uses the ${k.tool} tool` : ''}` })), d && d.words ? h('span', { class: 'tag tag--accent', text: `${d.words} words` }) : h('span'))); }));
    const dels = h('ul', { class: 'items' }, c.deliverables.map((d) => h('li', null, h('a', { href: `#/assignment/capstone-${d.id}` }, h('span', { class: 'label', text: 'Deliverable' }), h('span', null, h('span', { class: 'items__t', text: d.title }), h('span', { class: 'items__d', html: AP.inline(d.description || '') })), h('span')))));
    const tools = [['capstone-orgdesign', 'Organization design (Organization Builder)'], ['capstone-allocation', 'Budget model (Financial Decision Studio)'], ['capstone-presentation', 'Decision presentation (Executive Communication Studio)']];
    return { el: h('div', null, AP.head('Week 14 · Capstone · 25% of the grade', c.title, null), h('p', { class: 'notice notice--plain small', html: AP.inline(c.fiction) }),
      h('div', { class: 'reader' }, h('article', { class: 'prose' }, AP.blocks(h('div'), c.scenario), c.exhibits && c.exhibits.length ? h('section', { class: 'rule' }, h('h2', { text: 'Exhibits' }), c.exhibits.map((x) => AP.blocks(h('div'), [{ type: 'table', caption: x.title, headers: x.headers, rows: x.rows, note: x.note }]))) : null, c.assumptions ? h('section', null, h('h3', { text: 'Assumptions' }), h('ul', null, c.assumptions.map((a) => h('li', { html: AP.inline(a) })))) : null),
        h('aside', { class: 'reader__side' }, h('div', { class: 'sticky' }, h('div', null, h('span', { class: 'label', text: 'Milestones' }), h('ul', { class: 'small' }, c.milestones.map((m) => h('li', null, h('b', { text: `Week ${m.week}: ` }), h('span', { html: AP.inline(m.text) }))))), h('div', null, h('span', { class: 'label', text: 'Tools' }), h('ul', { class: 'small' }, tools.map(([id, l]) => h('li', null, h('a', { href: `#/exercise/${id}`, text: l })))))))),
      h('section', { class: 'rule' }, h('h2', { text: 'Eighteen components' }), h('p', { class: 'small muted', text: 'Draft each component when its week is complete; drafts save to your notebook and assemble into the deliverables.' }), comps),
      h('section', { class: 'rule' }, h('h2', { text: 'Seven deliverables' }), dels),
      c.defense ? h('section', { class: 'rule' }, h('h2', { text: 'Questions you must be ready to defend' }), h('ol', null, c.defense.map((q) => h('li', { html: AP.inline(q) })))) : null), title: 'Capstone' };
  };
  S.component = async function (kid) {
    const c = await AP.get('capstone', 'capstone');
    const k = c.components.find((x) => x.id === kid);
    if (!k) return h('p', { class: 'empty', text: 'Unknown component.' });
    await AP.loadState(['draft']);
    const key = `capstone-${k.id}`;
    const d = AP.getRec('draft', key) || { sections: [] };
    const sections = k.template.map((_, i) => d.sections[i] || '');
    const count = h('span', { class: 'small muted' });
    const recount = () => { const n = sections.reduce((a, s) => a + AP.words(s), 0); count.textContent = `${n} words · target ${k.words[0]}–${k.words[1]}`; return n; };
    recount();
    const toolLink = { orgdesign: 'capstone-orgdesign', allocation: 'capstone-allocation', composer: 'capstone-presentation' }[k.tool];
    const idx = c.components.indexOf(k);
    return { el: h('div', null, AP.head(`Capstone component ${k.number} of 18 · recommended after week ${k.week}`, k.title, `Draws on ${k.draws.join(', ')}.`),
      AP.blocks(h('div', { class: 'prose' }), k.guidance), h('h3', { text: 'Prompts' }), h('ul', null, k.prompts.map((p) => h('li', { html: AP.inline(p) }))),
      toolLink ? h('p', null, h('a', { class: 'btn', href: `#/exercise/${toolLink}`, text: `Open the ${k.tool === 'orgdesign' ? 'Organization Builder' : k.tool === 'allocation' ? 'budget model' : 'presentation studio'}` })) : null,
      h('section', { class: 'rule' }, h('div', { class: 'row row--between' }, h('h2', { text: 'Draft' }), count), k.template.map((t, i) => h('label', { class: 'field' }, h('span', { html: AP.inline(t.heading) }), t.guidance ? h('small', { html: AP.inline(t.guidance) }) : null, h('textarea', { class: 'tall', value: sections[i], oninput: (e) => { sections[i] = e.target.value; AP.save('draft', key, { sections, words: recount() }); } })))),
      h('div', { class: 'row rule' }, idx > 0 ? h('a', { class: 'btn', href: `#/capstone/${c.components[idx - 1].id}`, text: 'Previous component' }) : null, h('a', { class: 'btn', href: '#/capstone', text: 'All components' }), idx < c.components.length - 1 ? h('a', { class: 'btn', href: `#/capstone/${c.components[idx + 1].id}`, text: 'Next component' }) : null)), title: k.title };
  };
})();
