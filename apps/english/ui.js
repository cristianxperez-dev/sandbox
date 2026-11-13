/* English (CP English) — shared UI pieces: element builder, bilingual text helpers, clip player, translation reveal,
   speaking panel, consent. v2: every piece follows the learner's context (target language = what they practise,
   native language = what explanations and feedback use), from window.CPEContext(). */
(function () {
  "use strict";
  const S = () => window.CPEStore;
  const ctxNow = () => (window.CPEContext ? window.CPEContext() : { target: "en", native: "es", specialty: null, level: "A1" });

  /** h("div.cls#id", {attrs}, ...children) — strings become text nodes (never HTML) */
  function h(sel, attrs, ...kids) {
    const m = String(sel).match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
    const el = document.createElement(m[1] || "div");
    (m[2] || "").replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === ".") el.classList.add(v); else el.id = v; });
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className += " " + v;
      else if (k === "width") el.style.width = v;             // CSSOM, not a style attribute (the CSP allows no inline styles)
      else el.setAttribute(k, v === true ? "" : v);
    }
    const add = (k) => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
    kids.forEach(add);
    return el;
  }
  const live = (msg) => { const l = document.getElementById("live"); if (l) { l.textContent = ""; setTimeout(() => (l.textContent = msg), 30); } };

  /** explanatory text in the learner's language: English speakers read English; Spanish speakers get English then Spanish */
  function L(en, es) {
    const n = ctxNow().native;
    if (n === "en" || !es) return en;
    return `${en} — ${es}`;
  }
  /** the same, as two nodes (Spanish muted) for longer text */
  function LL(en, es, cls) {
    const n = ctxNow().native;
    if (n === "en" || !es) return h("p" + (cls || ""), en);
    return [h("p" + (cls || ""), en), h("p.muted" + (cls || ""), { lang: "es" }, es)];
  }
  const nativeText = (en, es) => (ctxNow().native === "es" && es ? es : en);

  /* ---------------- audio ---------------- */
  let current = null;                         // one sound at a time
  function playSrc(src, opts) {
    const o = opts || {};
    if (current) { current.pause(); current = null; }
    const a = new Audio(src);
    a.preservesPitch = true; a.playbackRate = o.rate || 1;
    if (o.from != null) a.currentTime = o.from;
    if (o.to != null) a.addEventListener("timeupdate", () => { if (a.currentTime >= o.to) { a.pause(); if (o.onend) o.onend(); } });
    a.addEventListener("ended", () => { if (o.onend) o.onend(); });
    a.play().catch(() => { if (o.onend) o.onend(); });
    current = a; return a;
  }
  const stopAudio = () => { if (current) { current.pause(); current = null; } if ("speechSynthesis" in window) try { speechSynthesis.cancel(); } catch (e) {} };

  /* ---------------- translation support ---------------- */
  const supportOn = () => window.CPE.supportDefault(S().get());
  const trCode = () => (ctxNow().native === "en" ? "EN" : "ES");
  const trTitle = () => (ctxNow().native === "en" ? "Show the English" : "Mostrar en español");
  /** an inline translation, hidden unless translation support is on */
  function trSpan(text) {
    if (!text) return null;
    const s = h("span.es", { lang: ctxNow().native }, " " + text);
    if (!supportOn()) s.classList.add("es--hidden");
    return s;
  }
  /** a translation behind a small EN/ES button (open by default when support is on) */
  function trToggle(text) {
    if (!text) return null;
    const on = supportOn();
    const body = h("span.es-body", { lang: ctxNow().native, hidden: !on }, text);
    const b = h("button.es-btn", { type: "button", "aria-expanded": String(on), title: trTitle() }, trCode());
    b.onclick = () => { body.hidden = !body.hidden; b.setAttribute("aria-expanded", String(!body.hidden)); };
    return h("span.es-wrap", b, " ", body);
  }

  /** a clip player: Play / Replay, Slower (0.85×), transcript (lines) and optional translation */
  function clipPlayer(clip, opts) {
    const o = opts || {};
    const wrap = h("div.clip");
    let a = null, slow = false;
    const btn = h("button.btn.btn--play", { type: "button", "aria-label": "Play audio" }, "▶ Listen");
    const slowBtn = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-pressed": "false", title: "Slower playback" }, "Slower");
    const lang = o.lang || ctxNow().target;
    const lines = (clip.lines || []).map((ln) => h("p.clip__line", { lang }, ln.speaker && o.speakers && o.speakers[ln.speaker] ? h("b", o.speakers[ln.speaker].name + ": ") : null, ln.text, trSpan(ln.tr)));
    const tr = h("div.clip__tr", { hidden: !o.showTranscript }, lines);
    const trBtn = o.transcript === false || !lines.length ? null : h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-expanded": String(!!o.showTranscript), onclick: () => { tr.hidden = !tr.hidden; trBtn.setAttribute("aria-expanded", String(!tr.hidden)); trBtn.textContent = tr.hidden ? "Show text" : "Hide text"; } }, o.showTranscript ? "Hide text" : "Show text");
    const set = (playing) => { btn.textContent = playing ? "❚❚ Pause" : wrap.dataset.played ? "↺ Replay" : "▶ Listen"; };
    btn.onclick = () => {
      if (a && !a.paused) { a.pause(); set(false); return; }
      wrap.dataset.played = "1";
      a = playSrc(clip.audio, { rate: slow ? 0.85 : 1, onend: () => { set(false); lines.forEach((l) => l.classList.remove("on")); } });
      a.addEventListener("timeupdate", () => (clip.lines || []).forEach((ln, i) => lines[i] && lines[i].classList.toggle("on", ln.start != null && a.currentTime >= ln.start && a.currentTime < ln.end + 0.2)));
      set(true); if (o.onplay) o.onplay();
    };
    slowBtn.onclick = () => { slow = !slow; slowBtn.setAttribute("aria-pressed", String(slow)); slowBtn.classList.toggle("on", slow); if (a) a.playbackRate = slow ? 0.85 : 1; };
    wrap.append(h("div.clip__bar", btn, slowBtn, trBtn), tr);
    return wrap;
  }

  /* ---------------- consent ---------------- */
  function consent() {
    const st = S().get();
    if (st.consent && st.consent.v === 1) return Promise.resolve(st.consent.ok);
    return new Promise((resolve) => {
      const es = h("p", { lang: "es" }, "Para darte retroalimentación sobre lo que dices, tu grabación se envía de forma segura a un servicio de inteligencia artificial (OpenAI) que la convierte en texto y la evalúa. La aplicación no guarda tu audio: se procesa y se descarta. El texto y los comentarios se guardan solo en este dispositivo, y puedes borrarlos en Ajustes. La evaluación es automática y aproximada, y no juzga tu acento.");
      const en = h("p", "To give feedback on what you say, your recording is sent securely to an AI service (OpenAI) that transcribes and evaluates it. The app does not keep your audio: it is processed and discarded. Transcripts and feedback are saved only on this device, and you can delete them under Settings. The evaluation is automatic and approximate, and it never judges your accent.");
      const first = ctxNow().native === "es" ? [es, h("p.muted", en.textContent)] : [en, h("p.muted", { lang: "es" }, es.textContent)];
      const d = h("dialog.dlg", { "aria-labelledby": "cTitle" }, h("h2#cTitle", "Before you record"), first,
        h("div.dlg__acts",
          h("button.btn.btn--primary", { type: "button", onclick: () => done(true) }, ctxNow().native === "es" ? "I agree — Acepto" : "I agree"),
          h("button.btn.btn--ghost", { type: "button", onclick: () => done(false) }, ctxNow().native === "es" ? "Not now — Practicar sin enviar" : "Not now — practise without sending")));
      function done(ok) { S().update((s) => { s.consent = { v: 1, ok, at: Date.now() }; }); d.close(); d.remove(); resolve(ok); }
      document.body.append(d); d.showModal();
    });
  }

  /* ---------------- speaking panel ----------------
     mode "repeat": model sentence; feedback = word comparison (not a pronunciation score)
     mode "answer" | "conversation" | "placement": open answer; feedback = validated AI evaluation
     opts: { model: {audio, from, to}, reference, task, level, lang, onResult(result), allowTyped } */
  const DIM = { clarity: ["Clear meaning", "Se entiende"], grammar: ["Grammar", "Gramática"], vocabulary: ["Baseball vocabulary", "Vocabulario de béisbol"], naturalness: ["Natural", "Natural"], task: ["Got the instruction across", "Comunicó la instrucción"] };
  function speakPanel(mode, opts) {
    const o = opts || {};
    const c = ctxNow(), lang = o.lang || c.target, langName = lang === "es" ? "Spanish" : "English";
    const root = h("div.speak");
    const status = h("p.speak__status", { role: "status" });
    const out = h("div.speak__out");
    const recBtn = h("button.rec", { type: "button", "aria-label": "Record" }, h("span.rec__dot"), h("span.rec__lbl", "Record"));
    const timer = h("span.rec__time", "");
    let rec = null, last = null, busy = false;
    const playMine = h("button.btn.btn--ghost.btn--sm", { type: "button", hidden: true, onclick: () => last && playSrc(last.url) }, "▶ My recording");
    const playModel = o.model ? h("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => playSrc(o.model.audio, { from: o.model.from, to: o.model.to }) }, "▶ Model") : null;
    const tryAgain = h("button.btn.btn--ghost.btn--sm", { type: "button", hidden: true, onclick: () => { out.replaceChildren(); status.textContent = ""; tryAgain.hidden = true; recBtn.focus(); } }, "↺ Try again");
    const typedBox = o.allowTyped ? typedFallback() : null;

    recBtn.onclick = async () => {
      if (busy) return;
      if (rec) { busy = true; const r = await rec.stop(); rec = null; recBtn.classList.remove("on"); recBtn.querySelector(".rec__lbl").textContent = "Record"; timer.textContent = ""; busy = false; if (r) handle(r); return; }
      try {
        rec = window.CPESpeech.recorder((s) => (timer.textContent = `${Math.floor(s)}s / ${window.CPESpeech.MAX_SECONDS}s`));
        await rec.start();
        recBtn.classList.add("on"); recBtn.querySelector(".rec__lbl").textContent = "Stop"; status.textContent = L(`Recording… speak in ${langName}, then tap Stop.`, "Grabando… toca Stop al terminar.");
        live("Recording");
      } catch (e) {
        rec = null; const info = (e && e.info) || {};
        status.replaceChildren(h("b", "Microphone unavailable. "), c.native === "es" ? [info.en || "", h("br"), h("span", { lang: "es" }, info.es || "")] : info.en || "");
        if (typedBox) typedBox.hidden = false;
        if (o.onResult) o.onResult({ micError: info.code || "unavailable" });
      }
    };

    async function handle(r) {
      last = r; playMine.hidden = false;
      if (r.seconds < 0.6 || r.blob.size < 1000) { status.textContent = L("That was very short — try again and speak a little longer.", "Fue muy corto, inténtalo otra vez."); return; }
      const ok = await consent();
      const st = await window.CPESpeech.status();
      if (!ok) { status.textContent = L("Kept on this device only: play it back and compare it with the model.", "Escucha tu grabación y compárala con el modelo."); tryAgain.hidden = false; if (o.onResult) o.onResult({ practiced: true }); return; }
      if (!st.ai || !st.ai.active) { notAvailable(st.ai && st.ai.reason); return; }
      status.textContent = L("Listening to your answer…", "Analizando tu respuesta…");
      const base = { lang, native: c.native, specialty: c.specialty };
      const res = await window.CPESpeech.speech(r, mode === "repeat" ? Object.assign({ mode: "repeat", reference: o.reference }, base) : { mode, lang, task: Object.assign({ level: o.level || c.level }, base, o.task) });
      showResult(res);
    }
    function notAvailable(reason) {
      status.replaceChildren(h("b", "Automatic feedback isn't available right now. "), window.CPESpeech.unavailableReason(reason, c.native), " ",
        h("span.muted", L("Play your recording and compare it with the model.", "Escucha tu grabación y compárala.")));
      tryAgain.hidden = false;
      if (o.onResult) o.onResult({ practiced: true, unavailable: reason || "unavailable" });
    }
    function showResult(res) {
      tryAgain.hidden = false;
      if (res.error) { notAvailable(res.error); return; }
      status.textContent = "";
      const rows = [h("p.said", h("span.k", L("You said", "Dijiste")), " ", h("q", { lang }, res.transcript || "—"))];
      if (res.recognition && !res.recognition.ok) {
        rows.push(h("p.note", h("b", "We couldn't hear that clearly. "), "This is not a language mistake — try again a little closer to the microphone, in a quieter spot.",
          c.native === "es" ? [h("br"), h("span", { lang: "es" }, "No pudimos escucharte con claridad. No es un error de idioma: inténtalo otra vez más cerca del micrófono, en un lugar más tranquilo.")] : null));
        out.replaceChildren(...rows); if (o.onResult) o.onResult({ unclear: true, transcript: res.transcript }); return;
      }
      if (res.compare) {
        const cp = res.compare;
        rows.push(h("p.diff", { lang }, cp.ref.map((x) => h("span", { class: x.ok ? "w ok" : "w miss" }, x.w + " "))));
        rows.push(h("p.fb", cp.verdict === "match" ? L("Every word was there.", "Dijiste todas las palabras.") : cp.verdict === "close" ? `${L("Close", "Casi")} — ${cp.missing.length ? L("missing: ", "faltó: ") + cp.missing.join(", ") : L("a few extra words", "algunas palabras de más")}.` : L("Quite different from the model. Listen again and try once more.", "Escucha otra vez el modelo e inténtalo de nuevo.")));
        rows.push(h("p.note.small", L("This compares the words we recognized with the model sentence. It is not a pronunciation score.", "Compara palabras, no evalúa tu pronunciación.")));
      }
      const ev = res.evaluation;
      if (ev) {
        const dims = ev.scores ? Object.entries(DIM).filter(([k]) => ev.scores[k] != null) : [];
        rows.push(h("div.fb-box",
          h("p.chips",
            h("span.chip", { class: ev.understandable ? "chip--ok" : "chip--warn" }, ev.understandable ? L("Clear meaning", "Se entiende") : L("Meaning unclear", "No se entiende bien")),
            h("span.chip", { class: ev.on_task ? "chip--ok" : "chip--warn" }, ev.on_task ? L("On task", "Responde la tarea") : L("Off task", "No responde la tarea")),
            ev.in_target_language === false ? h("span.chip.chip--warn", L(`Not in ${langName}`, lang === "en" ? "No fue en inglés" : "No fue en español")) : null),
          h("p.fb", { lang: c.native }, ev.feedback || ev.feedback_es),
          ev.feedback_target ? h("p.muted", { lang }, ev.feedback_target) : null,
          (ev.corrections || []).length ? h("ul.fixes", ev.corrections.map((x) => h("li", h("s", { lang }, x.said), " → ", h("b", { lang }, x.better), h("span.muted", { lang: c.native }, " · " + (x.why || x.why_es || ""))))) : null,
          ev.better_sentence ? h("p.better", h("span.k", L("A natural way to say it", "Una forma natural de decirlo")), h("br"), h("b", { lang }, ev.better_sentence), " ", sayBtn(ev.better_sentence, lang)) : null,
          dims.length ? h("details.dims", h("summary", L("Details (automatic estimate)", "Detalles (estimación automática)")),
            h("ul.dims__list", dims.map(([k, [en, es]]) => h("li", h("span", L(en, es)), h("span.dots", { "aria-label": `${ev.scores[k]} of 4` }, "●".repeat(ev.scores[k]) + "○".repeat(4 - ev.scores[k])))))) : null,
          ev.possible_recognition_issue ? h("p.note.small", L("Some words may not have been recognized correctly; they were not counted as mistakes.", "Algunas palabras quizá no se reconocieron bien; no se contaron como errores.")) : null));
      }
      if (res.evaluationError) rows.push(h("p.note", L("We got your words but couldn't produce feedback this time.", "Recibimos tus palabras, pero no pudimos generar comentarios esta vez.")));
      out.replaceChildren(...rows);
      if (o.onResult) o.onResult({ transcript: res.transcript, compare: res.compare || null, evaluation: ev || null });
    }
    function typedFallback() {
      const ta = h("textarea.in", { rows: 2, maxlength: 400, lang, "aria-label": `Type your answer in ${langName}`, placeholder: `Type your answer in ${langName}…` });
      const send = h("button.btn.btn--sm", { type: "button" }, "Send typed answer");
      const box = h("div.typed", { hidden: true }, h("p.muted.small", L(`Can't record? Type your answer in ${langName}. (Your speaking isn't evaluated this way.)`, `¿No puedes grabar? Escribe tu respuesta en ${lang === "en" ? "inglés" : "español"}. (Así no se evalúa tu forma de hablar.)`)), ta, send);
      send.onclick = async () => {
        const text = ta.value.trim(); if (!text) return;
        const st = await window.CPESpeech.status();
        if (!st.ai || !st.ai.active) { notAvailable(st.ai && st.ai.reason); if (o.onResult) o.onResult({ typedText: text, unavailable: true }); return; }
        status.textContent = L("Checking…", "Revisando…");
        const res = await window.CPESpeech.text(Object.assign({ kind: mode === "repeat" ? "answer" : mode, level: o.level || c.level, lang, native: c.native, specialty: c.specialty }, o.task), text);
        if (res.error) { notAvailable(res.error); return; }
        status.textContent = ""; showResult({ transcript: text, recognition: { ok: true }, evaluation: res.evaluation });
        if (o.onResult) o.onResult({ typed: true, transcript: text, evaluation: res.evaluation });
      };
      return box;
    }
    const typedLink = o.allowTyped ? h("button.linkbtn", { type: "button", onclick: () => { typedBox.hidden = !typedBox.hidden; } }, "Type instead") : null;
    root.append(h("div.speak__ctrl", recBtn, timer, playMine, playModel, tryAgain, typedLink), status, typedBox, out);
    root.cancel = () => { if (rec) rec.cancel(); };
    return root;
  }
  /** the device's own voice for a generated sentence (labelled; the course audio is pre-rendered) */
  function sayBtn(text, lang) {
    if (!("speechSynthesis" in window)) return null;
    return h("button.btn.btn--ghost.btn--sm", { type: "button", title: "Read aloud with this device's voice", onclick: () => {
      stopAudio(); const u = new SpeechSynthesisUtterance(text); u.lang = (lang || ctxNow().target) === "es" ? "es-US" : "en-US"; u.rate = 0.9; speechSynthesis.speak(u);
    } }, "▶ Listen (device voice)");
  }

  window.CPEUI = { h, L, LL, nativeText, live, playSrc, stopAudio, clipPlayer, trSpan, trToggle, esSpan: trSpan, esToggle: trToggle, supportOn, spanishOn: supportOn, consent, speakPanel, sayBtn };
})();
