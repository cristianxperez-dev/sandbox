/* CP English — shared UI pieces: element builder, clip player, Spanish reveal, speaking panel, consent. */
(function () {
  "use strict";
  const S = () => window.CPEStore;

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
  const stopAudio = () => { if (current) { current.pause(); current = null; } };

  /** a clip player: Play / Replay, Slower (0.85×), transcript (lines) and optional Spanish */
  function clipPlayer(clip, opts) {
    const o = opts || {};
    const wrap = h("div.clip");
    let a = null, slow = false;
    const btn = h("button.btn.btn--play", { type: "button", "aria-label": "Play audio" }, "▶ Listen");
    const slowBtn = h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-pressed": "false", title: "Slower playback" }, "Slower");
    const lines = (clip.lines || []).map((ln) => h("p.clip__line", ln.speaker && o.speakers && o.speakers[ln.speaker] ? h("b", o.speakers[ln.speaker].name + ": ") : null, ln.text,
      ln.es ? esSpan(ln.es) : null));
    const tr = h("div.clip__tr", { hidden: !o.showTranscript }, lines);
    const trBtn = o.transcript === false ? null : h("button.btn.btn--ghost.btn--sm", { type: "button", "aria-expanded": String(!!o.showTranscript), onclick: () => { tr.hidden = !tr.hidden; trBtn.setAttribute("aria-expanded", String(!tr.hidden)); trBtn.textContent = tr.hidden ? "Show text" : "Hide text"; } }, o.showTranscript ? "Hide text" : "Show text");
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

  /* ---------------- Spanish support ---------------- */
  const spanishOn = () => window.CPE.spanishDefault(S().get());
  /** an inline Spanish translation, hidden unless Spanish support is on; tap "ES" to reveal one */
  function esSpan(text) {
    const s = h("span.es", { lang: "es" }, " " + text);
    if (!spanishOn()) s.classList.add("es--hidden");
    return s;
  }
  function esToggle(text) {
    if (!text) return null;
    const on = spanishOn();
    const body = h("span.es-body", { lang: "es", hidden: !on }, text);
    const b = h("button.es-btn", { type: "button", "aria-expanded": String(on), title: "Mostrar en español" }, "ES");
    b.onclick = () => { body.hidden = !body.hidden; b.setAttribute("aria-expanded", String(!body.hidden)); };
    return h("span.es-wrap", b, " ", body);
  }

  /* ---------------- consent ---------------- */
  function consent() {
    const st = S().get();
    if (st.consent && st.consent.v === 1) return Promise.resolve(st.consent.ok);
    return new Promise((resolve) => {
      const d = h("dialog.dlg", { "aria-labelledby": "cTitle" },
        h("h2#cTitle", "Before you record"),
        h("p", { lang: "es" }, "Para darte retroalimentación sobre lo que dices, tu grabación se envía de forma segura a un servicio de inteligencia artificial (OpenAI) que la convierte en texto y la evalúa. CP English no guarda tu audio: se procesa y se descarta. El texto y los comentarios se guardan solo en este dispositivo, y puedes borrarlos en Privacidad."),
        h("p.muted", "To give feedback on what you say, your recording is sent securely to an AI service (OpenAI) that transcribes and evaluates it. CP English does not keep your audio. Transcripts and feedback are saved only on this device; you can delete them under Privacy."),
        h("p.muted", { lang: "es" }, "La evaluación es automática y aproximada. No juzga tu acento."),
        h("div.dlg__acts",
          h("button.btn.btn--primary", { type: "button", onclick: () => done(true) }, "I agree — Acepto"),
          h("button.btn.btn--ghost", { type: "button", onclick: () => done(false) }, "Not now — Practicar sin enviar")));
      function done(ok) { S().update((s) => { s.consent = { v: 1, ok, at: Date.now() }; }); d.close(); d.remove(); resolve(ok); }
      document.body.append(d); d.showModal();
    });
  }

  /* ---------------- speaking panel ----------------
     mode "repeat": model sentence; feedback = word comparison (not a pronunciation score)
     mode "answer" | "conversation" | "placement": open answer; feedback = validated AI evaluation
     opts: { model: {audio}|null, reference, task, level, onResult(result), allowTyped, compact } */
  function speakPanel(mode, opts) {
    const o = opts || {};
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
        recBtn.classList.add("on"); recBtn.querySelector(".rec__lbl").textContent = "Stop"; status.textContent = "Recording… tap Stop when you finish. — Grabando… toca Stop al terminar.";
        if (window.CPEUI) live("Recording");
      } catch (e) {
        rec = null; const info = (e && e.info) || {};
        status.replaceChildren(h("b", "Microphone unavailable. "), info.en || "", h("br"), h("span", { lang: "es" }, info.es || ""));
        if (typedBox) typedBox.hidden = false;
        if (o.onResult) o.onResult({ micError: info.code || "unavailable" });
      }
    };

    async function handle(r) {
      last = r; playMine.hidden = false;
      if (r.seconds < 0.6 || r.blob.size < 1000) { status.textContent = "That was very short — try again and speak a little longer. — Fue muy corto, inténtalo otra vez."; return; }
      const ok = await consent();
      const st = await window.CPESpeech.status();
      if (!ok) { status.textContent = "Saved on this device only for you to compare. — Escucha tu grabación y compárala con el modelo."; tryAgain.hidden = false; if (o.onResult) o.onResult({ practiced: true }); return; }
      if (!st.ai || !st.ai.active) { notAvailable(st.ai && st.ai.reason); return; }
      status.textContent = "Listening to your answer… — Analizando tu respuesta…";
      const res = await window.CPESpeech.speech(r, mode === "repeat" ? { mode: "repeat", reference: o.reference } : { mode, task: Object.assign({ level: o.level }, o.task) });
      showResult(res);
    }
    function notAvailable(reason) {
      status.replaceChildren(h("b", "Automatic feedback isn't available right now. "), window.CPESpeech.unavailableReason(reason), " ",
        h("span.muted", "Play your recording and compare it with the model. — Escucha tu grabación y compárala."));
      tryAgain.hidden = false;
      if (o.onResult) o.onResult({ practiced: true, unavailable: reason || "unavailable" });
    }
    function showResult(res) {
      tryAgain.hidden = false;
      if (res.error) { notAvailable(res.error); return; }
      status.textContent = "";
      const rows = [h("p.said", h("span.k", "You said · Dijiste"), " ", h("q", res.transcript || "—"))];
      if (res.recognition && !res.recognition.ok) {
        rows.push(h("p.note", h("b", "We couldn't hear that clearly. "), "This is not a language mistake — try again a little closer to the microphone, in a quieter spot.", h("br"),
          h("span", { lang: "es" }, "No pudimos escucharte con claridad. No es un error de idioma: inténtalo otra vez más cerca del micrófono, en un lugar más tranquilo.")));
        out.replaceChildren(...rows); if (o.onResult) o.onResult({ unclear: true, transcript: res.transcript }); return;
      }
      if (res.compare) {
        const c = res.compare;
        rows.push(h("p.diff", c.ref.map((x) => h("span", { class: x.ok ? "w ok" : "w miss" }, x.w + " "))));
        rows.push(h("p.fb", c.verdict === "match" ? "Every word was there. Nice." : c.verdict === "close" ? `Close — ${c.missing.length ? "missing: " + c.missing.join(", ") : "a few extra words"}.` : "Quite different from the model. Listen again and try once more.",
          " ", h("span.muted", { lang: "es" }, c.verdict === "match" ? "Dijiste todas las palabras." : c.verdict === "close" ? "Casi: revisa las palabras subrayadas." : "Escucha otra vez el modelo e inténtalo de nuevo.")));
        rows.push(h("p.note.small", "This compares the words we recognized with the model sentence. It is not a pronunciation score. — Compara palabras, no evalúa tu pronunciación."));
      }
      const ev = res.evaluation;
      if (ev) {
        const esFirst = ["A0", "A1", "A2"].includes(o.level || "A1");
        rows.push(h("div.fb-box",
          h("p.chips", h("span.chip", { class: ev.understandable ? "chip--ok" : "chip--warn" }, ev.understandable ? "Clear meaning" : "Meaning unclear"),
            h("span.chip", { class: ev.on_task ? "chip--ok" : "chip--warn" }, ev.on_task ? "Answers the question" : "Off topic")),
          esFirst ? h("p.fb", { lang: "es" }, ev.feedback_es) : h("p.fb", ev.feedback),
          esFirst ? h("p.muted", ev.feedback) : esToggle(ev.feedback_es),
          ev.corrections.length ? h("ul.fixes", ev.corrections.map((c) => h("li", h("s", c.said), " → ", h("b", c.better), h("span.muted", { lang: "es" }, " · " + c.why_es)))) : null,
          ev.better_sentence ? h("p.better", h("span.k", "A natural way to say it · Una forma natural"), h("br"), h("b", ev.better_sentence), " ", sayBtn(ev.better_sentence)) : null,
          ev.possible_recognition_issue ? h("p.note.small", "Some words may not have been recognized correctly; they were not counted as mistakes. — Algunas palabras quizá no se reconocieron bien; no se contaron como errores.") : null));
      }
      if (res.evaluationError) rows.push(h("p.note", "We got your words but couldn't produce feedback this time. — Recibimos tus palabras, pero no pudimos generar comentarios esta vez."));
      out.replaceChildren(...rows);
      if (o.onResult) o.onResult({ transcript: res.transcript, compare: res.compare || null, evaluation: ev || null });
    }
    function typedFallback() {
      const ta = h("textarea.in", { rows: 2, maxlength: 400, "aria-label": "Type your answer in English", placeholder: "Type your answer in English…" });
      const send = h("button.btn.btn--sm", { type: "button" }, "Send typed answer");
      const box = h("div.typed", { hidden: true }, h("p.muted.small", { lang: "es" }, "¿No puedes grabar? Escribe tu respuesta en inglés. (Así no se evalúa tu forma de hablar.)"), ta, send);
      send.onclick = async () => {
        const text = ta.value.trim(); if (!text) return;
        const st = await window.CPESpeech.status();
        if (!st.ai || !st.ai.active) { notAvailable(st.ai && st.ai.reason); if (o.onResult) o.onResult({ typedText: text, unavailable: true }); return; }
        status.textContent = "Checking… — Revisando…";
        const res = await window.CPESpeech.text(Object.assign({ kind: mode === "repeat" ? "answer" : mode, level: o.level }, o.task), text);
        if (res.error) { notAvailable(res.error); return; }
        status.textContent = ""; showResult({ transcript: text, recognition: { ok: true }, evaluation: res.evaluation });
        if (o.onResult) o.onResult({ typed: true, transcript: text, evaluation: res.evaluation });
      };
      return box;
    }
    const typedLink = o.allowTyped ? h("button.linkbtn", { type: "button", onclick: () => { typedBox.hidden = !typedBox.hidden; } }, "Type instead · Escribir") : null;
    root.append(h("div.speak__ctrl", recBtn, timer, playMine, playModel, tryAgain, typedLink), status, typedBox, out);
    root.cancel = () => { if (rec) rec.cancel(); };
    return root;
  }
  /** the device's own voice for a generated sentence (labelled; the course audio is pre-rendered) */
  function sayBtn(text) {
    if (!("speechSynthesis" in window)) return null;
    return h("button.btn.btn--ghost.btn--sm", { type: "button", title: "Read aloud with this device's voice", onclick: () => {
      stopAudio(); speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; u.rate = 0.9; speechSynthesis.speak(u);
    } }, "▶ Listen (device voice)");
  }

  window.CPEUI = { h, live, playSrc, stopAudio, clipPlayer, esSpan, esToggle, spanishOn, consent, speakPanel, sayBtn };
})();
