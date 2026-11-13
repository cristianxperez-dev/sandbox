/* English (CP English) — narrated lecture player (after APERTURE's Watch & Learn player: one narration track is the clock;
   scene visuals and the highlighted sentence follow it). v2: both language directions — the transcript shows each
   sentence in its own language with a translation into the learner's language behind EN/ES; Spanish sentences are
   spoken by Spanish voices, the English narration by Voice C. Tap any sentence to hear just that sentence; on
   sentences marked for practice, record yourself and compare with the model. */
(function () {
  "use strict";
  const { h, L, trToggle, speakPanel, supportOn } = window.CPEUI;

  function visual(v, shown, speakers, cuesSoFar, lesson) {
    const t = v.type, target = lesson.target, native = lesson.native;
    const head = (title, tr) => h("div.vis__head", v.kicker ? h("p.kicker", v.kicker) : null, h("h3", title), tr ? h("p.vis__es", { lang: native }, tr) : null);
    const vis = (i) => (shown >= i ? "" : "vis--later");
    const note = v.note_tr || v.note ? h("p.vis__note", { lang: v.note_tr ? native : "en" }, v.note_tr || v.note) : null;
    if (t === "title") return h("div.vis.vis--title", h("p.kicker", v.kicker), h("h2", v.title), h("p.sub", v.sub));
    if (t === "dialogue") return h("div.vis", head(v.title, v.title_tr), h("div.vis__dialogue", { lang: target }, cuesSoFar.filter((c) => c.speaker).map((c) => h("p", h("b", speakers[c.speaker].name + ": "), c.text))));
    if (t === "phrases" || t === "summary") return h("div.vis", head(v.title, v.title_tr), h("ul.vis__list", v.items.map((it, i) => h("li", { class: t === "summary" ? "" : vis(i + 1) }, h("b", { lang: target }, it.text), it.answer ? h("span.vis__ans", " → " + it.answer) : null, h("span.vis__it-es", { lang: native }, it.tr)))), note);
    if (t === "pattern") return h("div.vis", head(v.title, v.title_tr), h("table.vis__tbl", h("tbody", v.rows.map((r, i) => h("tr", { class: vis(i + 1) }, h("th", { lang: target }, r.text), h("td", { lang: target }, r.example), h("td.vis__it-es", { lang: native }, r.tr))))), note);
    if (t === "steps") return h("div.vis", head(v.title, v.title_tr), h("ol.vis__steps", v.steps.map((s, i) => h("li", { class: vis(i + 1) }, h("b", { lang: target }, s.text), h("span.vis__it-es", { lang: native }, s.tr)))), note);
    if (t === "figure") return h("div.vis.vis--fig", head(v.title, v.title_tr), window.CPEFig ? window.CPEFig.draw(v.figure) : null,
      v.caption ? h("p.vis__note", v.caption, v.caption_tr ? [" ", h("span.muted", { lang: native }, v.caption_tr)] : null) : null);
    return h("div.vis", head(v.title || ""));
  }

  /** mount(host, lesson, opts) → { destroy() }; opts.onProgress(ratio), opts.level */
  function mount(host, lesson, opts) {
    const o = opts || {};
    const Lc = lesson.lecture, sp = lesson.speakers || {};
    const cues = []; Lc.scenes.forEach((sc, si) => sc.cues.forEach((c, ci) => cues.push(Object.assign({ si, ci }, c))));
    const audio = new Audio(Lc.audio); audio.preload = "metadata"; audio.preservesPitch = true;
    let rate = 1, stopAt = null, maxT = 0, cur = -1;
    const visEl = h("div.lec__vis", { "aria-live": "polite" });
    const playBtn = h("button.btn.btn--primary.lec__play", { type: "button" }, "▶ Play lecture");
    const prev = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-label": "Previous sentence" }, "‹ Back");
    const next = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-label": "Next sentence" }, "Next ›");
    const speed = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-pressed": "false" }, "Slower");
    const trLabel = lesson.native === "en" ? "English" : "Español";
    const trAll = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-pressed": String(supportOn()), title: lesson.native === "en" ? "Show every English translation" : "Mostrar todas las traducciones" }, trLabel);
    const bar = h("div.lec__bar", h("div.lec__fill"));
    const time = h("span.lec__time", "");
    const list = h("ol.lec__cues");
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

    const items = cues.map((c, i) => {
      const who = c.speaker ? h("span.cue__who", (sp[c.speaker] && sp[c.speaker].name) + ": ") : null;
      const txt = h("button.cue__txt", { type: "button", title: "Play this sentence", lang: c.lang || "en" }, who, c.text);
      txt.onclick = () => playCue(i);
      const practice = c.repeat ? h("button.cue__mic", { type: "button", "aria-label": "Practice this sentence", title: "Practice saying it" }, "🎙 Say it") : null;
      const pane = h("div.cue__practice", { hidden: true });
      if (practice) practice.onclick = () => {
        if (!pane.hidden) { pane.hidden = true; pane.replaceChildren(); return; }
        audio.pause(); pane.hidden = false;
        pane.replaceChildren(speakPanel("repeat", { reference: c.text.replace(/^.*?:\s/, ""), lang: c.lang || lesson.target, model: { audio: Lc.audio, from: c.start, to: c.end }, level: o.level }));
      };
      const tr = c.tr ? h("span.cue__es", { lang: lesson.native, hidden: !supportOn() }, c.tr) : null;
      const trBtn = c.tr ? h("button.es-btn", { type: "button", title: trLabel }, lesson.native.toUpperCase()) : null;
      if (trBtn) trBtn.onclick = () => { tr.hidden = !tr.hidden; };
      return h("li.cue", { "data-i": i, class: c.speaker ? "cue--model" : "" }, h("div.cue__row", txt, trBtn, practice), tr, pane);
    });
    list.append(...items);

    function cueAt(t) { let k = -1; cues.forEach((c, i) => { if (c.start != null && t >= c.start - 0.05) k = i; }); return k; }
    function draw(t) {
      const k = cueAt(t);
      if (k !== cur) {
        cur = k;
        items.forEach((el, i) => el.classList.toggle("on", i === k));
        if (k >= 0 && o.follow !== false) { const el = items[k]; const r = el.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
        const si = k < 0 ? 0 : cues[k].si, sc = Lc.scenes[si];
        const shown = cues.filter((c, i) => c.si === si && i <= k).reduce((m, c) => Math.max(m, c.reveal || 0), 0);
        visEl.replaceChildren(visual(sc.visual, shown, sp, cues.filter((c, i) => c.si === si && i <= k), lesson));
      }
      bar.firstChild.style.width = (Lc.duration ? Math.min(100, (t / Lc.duration) * 100) : 0) + "%";
      time.textContent = `${fmt(t)} / ${fmt(Lc.duration || 0)}`;
    }
    /** play one sentence: seek once the audio's metadata is loaded (a seek before that is ignored by browsers) */
    function playCue(i) {
      const c = cues[i];
      const go = () => { audio.currentTime = c.start; stopAt = c.end + 0.05; audio.playbackRate = rate; audio.play().catch(() => {}); draw(c.start); };
      if (audio.readyState >= 1) go(); else { audio.addEventListener("loadedmetadata", go, { once: true }); audio.load(); }
    }
    audio.addEventListener("timeupdate", () => {
      const t = audio.currentTime;
      if (stopAt != null && t >= stopAt) { audio.pause(); stopAt = null; }
      if (t > maxT) { maxT = t; if (o.onProgress) o.onProgress(Math.min(1, maxT / (Lc.duration || 1))); }
      draw(t);
    });
    audio.addEventListener("play", () => (playBtn.textContent = "❚❚ Pause"));
    audio.addEventListener("pause", () => (playBtn.textContent = audio.currentTime > 0.5 ? "▶ Resume" : "▶ Play lecture"));
    audio.addEventListener("ended", () => { playBtn.textContent = "↺ Play again"; if (o.onProgress) o.onProgress(1); });
    audio.addEventListener("error", () => visEl.replaceChildren(h("p.note", L("The narration could not be loaded. Check your connection and reload.", "No se pudo cargar la narración."))));
    playBtn.onclick = () => { stopAt = null; if (audio.paused) { if (audio.ended) audio.currentTime = 0; audio.playbackRate = rate; audio.play().catch(() => {}); } else audio.pause(); };
    prev.onclick = () => playCue(Math.max(0, cur - 1));
    next.onclick = () => playCue(Math.min(cues.length - 1, cur + 1));
    speed.onclick = () => { rate = rate === 1 ? 0.85 : 1; audio.playbackRate = rate; speed.setAttribute("aria-pressed", String(rate !== 1)); speed.classList.toggle("on", rate !== 1); };
    trAll.onclick = () => { const on = trAll.getAttribute("aria-pressed") !== "true"; trAll.setAttribute("aria-pressed", String(on)); list.querySelectorAll(".cue__es").forEach((e) => (e.hidden = !on)); };
    bar.onclick = (ev) => { const r = bar.getBoundingClientRect(); stopAt = null; audio.currentTime = ((ev.clientX - r.left) / r.width) * (Lc.duration || 0); draw(audio.currentTime); };

    host.append(h("div.lec", visEl, h("div.lec__ctrl", playBtn, prev, next, speed, trAll), h("div.lec__timeline", bar, time),
      h("p.muted.small", L("Tap a sentence to hear it again · 🎙 to practice it.", "Toca una oración para escucharla otra vez · 🎙 para practicarla.")), list));
    draw(0);
    return { destroy: () => { audio.pause(); audio.src = ""; }, audio };
  }
  window.CPELecture = { mount };
})();
