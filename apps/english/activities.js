/* CP English — activity renderers. Each takes (activity, ctx) and returns an element.
   ctx: { lesson, level, record(outcome), review(card), next(), seed }
   Objective activities are graded here, deterministically (core.js). Speaking activities never invent a
   grade: their outcome is "practiced" (and the validated feedback, when the service is available). */
(function () {
  "use strict";
  const { h, clipPlayer, esToggle, speakPanel, playSrc } = window.CPEUI;
  const C = () => window.CPE;

  function feedbackBox(ok, explain, explain_es) {
    return h("div.feedback", { class: ok ? "feedback--ok" : "feedback--no", role: "status" },
      h("b", ok ? "Correct. " : "Not quite. "), explain || "", " ", esToggle(explain_es));
  }
  const cont = (ctx, label) => h("button.btn.btn--primary.continue", { type: "button", onclick: () => ctx.next() }, label || "Continue →");

  /* one multiple-choice question; onAnswer(correct, chosenOriginalIndex) */
  function choiceQ(q, ctx, onAnswer, opts) {
    const o = opts || {};
    const seed = C().hashStr((ctx.seed || 0) + q.id);
    const box = h("div.q");
    if (q.clip && ctx.clips && ctx.clips[q.clip]) box.append(clipPlayer(ctx.clips[q.clip], { transcript: false }));
    box.append(h("p.q__prompt", q.prompt, " ", esToggle(q.prompt_es)));
    const opts2 = C().orderOptions(q.options, seed);
    const list = h("div.opts", { role: "group", "aria-label": "Options" });
    const fb = h("div");
    opts2.forEach(({ text, i }) => {
      const b = h("button.opt", { type: "button" }, text);
      b.onclick = () => {
        const ok = C().gradeChoice(q, i);
        list.querySelectorAll("button").forEach((x) => (x.disabled = true));
        b.classList.add(ok ? "opt--ok" : "opt--no");
        if (!ok) [...list.children][opts2.findIndex((x) => x.i === q.answer)].classList.add("opt--ok");
        fb.replaceChildren(feedbackBox(ok, q.explain || (ok ? "" : "Answer: " + q.options[q.answer]), q.explain_es));
        onAnswer(ok, i);
      };
      list.append(b);
    });
    if (o.locked) list.querySelectorAll("button").forEach((x) => (x.disabled = true));
    box.append(list, fb);
    return box;
  }

  const R = {};

  R.choice = (a, ctx) => {
    const done = h("div");
    return h("div.act", choiceQ(a, ctx, (ok) => {
      ctx.record({ correct: ok });
      if (!ok) ctx.review({ id: `${ctx.lesson.id}:${a.id}`, kind: "item", lesson: ctx.lesson.id, act: a.id });
      done.replaceChildren(cont(ctx));
    }), done);
  };

  R.match = (a, ctx) => {
    const seed = C().hashStr((ctx.seed || 0) + a.id);
    const right = C().shuffle(a.pairs.map((p) => p[1]), seed);
    const sels = a.pairs.map(([en]) => {
      const s = h("select.in", { "aria-label": `Meaning of ${en}` }, h("option", { value: "" }, "— choose —"), right.map((es) => h("option", { value: es }, es)));
      return [en, s];
    });
    const fb = h("div"), btn = h("button.btn", { type: "button" }, "Check");
    btn.onclick = () => {
      const chosen = Object.fromEntries(sels.map(([en, s]) => [en, s.value]));
      if (Object.values(chosen).some((v) => !v)) { fb.replaceChildren(h("p.note", "Choose a meaning for every word. — Elige un significado para cada palabra.")); return; }
      const wrong = C().gradeMatch(a, chosen);
      sels.forEach(([en, s]) => { s.disabled = true; s.closest(".match__row").classList.add(wrong.includes(en) ? "row--no" : "row--ok"); });
      btn.disabled = true;
      const ok = !wrong.length;
      ctx.record({ correct: ok, wrong });
      wrong.forEach((en) => ctx.review({ id: `${ctx.lesson.id}:${a.id}:${en}`, kind: "phrase", lesson: ctx.lesson.id, en, es: a.pairs.find((p) => p[0] === en)[1] }));
      fb.replaceChildren(h("div.feedback", { class: ok ? "feedback--ok" : "feedback--no" }, ok ? "All correct." : "Correct answers: ",
        ok ? null : h("ul", wrong.map((en) => h("li", h("b", en), " = ", a.pairs.find((p) => p[0] === en)[1]))), " ", esToggle(a.explain_es)), cont(ctx));
    };
    return h("div.act", h("p.q__prompt", a.prompt, " ", esToggle(a.prompt_es)),
      h("div.match", sels.map(([en, s]) => h("label.match__row", h("span.match__en", en), s))), btn, fb);
  };

  R.order = (a, ctx) => {
    const seed = C().hashStr((ctx.seed || 0) + a.id);
    let pool = C().shuffle(a.words.map((w, i) => ({ w, i })), seed), line = [];
    const lineEl = h("div.order__line", { "aria-live": "polite" }), poolEl = h("div.order__pool");
    const fb = h("div"), check = h("button.btn", { type: "button" }, "Check");
    const draw = () => {
      lineEl.replaceChildren(...(line.length ? line.map((x) => h("button.chip.chip--word", { type: "button", onclick: () => { line = line.filter((y) => y !== x); pool.push(x); draw(); } }, x.w)) : [h("span.muted", "Tap the words in order. — Toca las palabras en orden.")]));
      poolEl.replaceChildren(...pool.map((x) => h("button.chip.chip--word", { type: "button", onclick: () => { pool = pool.filter((y) => y !== x); line.push(x); draw(); } }, x.w)));
    };
    check.onclick = () => {
      if (line.length !== a.words.length) { fb.replaceChildren(h("p.note", "Use all the words. — Usa todas las palabras.")); return; }
      const ok = C().gradeOrder(a, line.map((x) => x.w));
      ctx.record({ correct: ok });
      if (!ok) ctx.review({ id: `${ctx.lesson.id}:${a.id}`, kind: "item", lesson: ctx.lesson.id, act: a.id });
      check.disabled = true; lineEl.querySelectorAll("button").forEach((b) => (b.disabled = true)); poolEl.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const ans = a.answers[0];
      fb.replaceChildren(feedbackBox(ok, ok ? ans.charAt(0).toUpperCase() + ans.slice(1) + "." : "Answer: " + ans.charAt(0).toUpperCase() + ans.slice(1) + ".", a.explain_es), cont(ctx));
    };
    draw();
    return h("div.act", h("p.q__prompt", a.prompt, " ", esToggle(a.prompt_es)), lineEl, poolEl, check, fb);
  };

  R.listen = (a, ctx) => {
    const clip = ctx.clips[a.clip];
    const qs = h("div.qs"), done = h("div");
    let answered = 0, right = 0;
    a.questions.forEach((q) => qs.append(choiceQ(Object.assign({}, q, { id: a.id + q.id }), ctx, (ok) => {
      answered++; if (ok) right++;
      if (!ok) ctx.review({ id: `${ctx.lesson.id}:${a.id}:${q.id}`, kind: "item", lesson: ctx.lesson.id, act: a.id, q: q.id });
      if (answered === a.questions.length) { ctx.record({ correct: right === a.questions.length, score: right, of: a.questions.length }); done.replaceChildren(h("p.muted", `${right} of ${a.questions.length} correct. Open the text to check what you heard. — Abre el texto para revisar lo que escuchaste.`), cont(ctx)); }
    })));
    return h("div.act", h("p.q__prompt", a.intro, " ", esToggle(a.intro_es)), clipPlayer(clip, { speakers: ctx.lesson.speakers }), qs, done);
  };

  function speechCard(a, ctx, mode, extra) {
    const clip = ctx.clips[a.clip];
    const done = h("div");
    const finish = (r) => {
      ctx.record({ correct: null, practiced: true, evaluated: !!(r && (r.evaluation || r.compare)), transcript: r && r.transcript || null });
      if (r && r.evaluation && r.evaluation.better_sentence && r.evaluation.corrections && r.evaluation.corrections.length)
        ctx.review({ id: `${ctx.lesson.id}:${a.id}:better`, kind: "phrase", lesson: ctx.lesson.id, en: r.evaluation.better_sentence, es: "" });
      if (r && (r.evaluation || r.compare)) ctx.saveSpeaking({ lesson: ctx.lesson.id, act: a.id, mode, transcript: r.transcript, evaluation: r.evaluation || null, compare: r.compare ? { ratio: r.compare.ratio, verdict: r.compare.verdict } : null });
      done.replaceChildren(cont(ctx));
    };
    const skip = h("button.linkbtn", { type: "button", onclick: () => { ctx.record({ correct: null, skipped: true }); ctx.next(); } }, "Skip for now · Omitir");
    return h("div.act",
      extra,
      clip ? clipPlayer(clip, { transcript: mode !== "repeat", showTranscript: mode === "repeat", speakers: ctx.lesson.speakers }) : null,
      speakPanel(mode, Object.assign({ level: ctx.level, onResult: (r) => { if (r && (r.transcript || r.practiced || r.unclear)) finish(r); } }, extra && extra.opts)),
      done, h("p.skip", skip));
  }

  R.repeat = (a, ctx) => {
    const clip = ctx.clips[a.clip];
    const head = h("div", h("p.q__prompt", "Listen, then say it. — Escucha y repítelo."), h("p.model", h("b", a.text), " ", esToggle(a.es)), a.tip_es ? h("p.muted.small", { lang: "es" }, a.tip_es) : null);
    head.opts = { reference: a.text, model: { audio: clip.audio } };
    return speechCard(a, ctx, "repeat", head);
  };
  R.answer = (a, ctx) => {
    const head = h("div", h("p.q__prompt", "Listen to the question and answer out loud. — Escucha la pregunta y responde en voz alta."),
      h("p.model", h("b", a.prompt), " ", esToggle(a.prompt_es)), h("p.muted.small", "Goal: ", a.goal_es || a.goal),
      h("details.examples", h("summary", "Example answers · Ejemplos"), h("ul", a.examples.map((x) => h("li", x)))));
    head.opts = { allowTyped: true, task: { prompt: a.prompt, goal: a.goal, examples: a.examples }, level: ctx.level };
    return speechCard(a, ctx, "answer", head);
  };

  /* guided conversation: the partner speaks (pre-recorded), the learner answers each turn by voice
     (evaluated, with a natural follow-up when available) or by choosing a reply (graded) */
  R.conversation = (a, ctx) => {
    const sp = ctx.lesson.speakers[a.partner] || { name: "Partner" };
    const log = h("div.convo", { "aria-live": "polite" });
    const stage = h("div.convo__stage");
    const history = [];
    let i = 0, voiced = 0, chosenOk = 0;
    const lineEl = (who, text, es) => h("div.bubble", { class: who === "me" ? "bubble--me" : "" }, h("span.bubble__who", who === "me" ? "You" : sp.name), h("p", text), es ? esToggle(es) : null);
    function turn() {
      const t = a.turns[i];
      log.append(lineEl("them", t.line, t.es));
      playSrc(ctx.clips[t.clip].audio);
      history.push({ who: "partner", text: t.line });
      const replay = h("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => playSrc(ctx.clips[t.clip].audio) }, "↺ Hear it again");
      const goal = h("p.muted.small", "Your turn: ", t.goal, " ", esToggle(t.goal_es));
      const choose = h("div.opts");
      const chooseWrap = h("div", { hidden: true }, h("p.small", "Choose the best reply: — Elige la mejor respuesta:"), choose);
      C().orderOptions(t.fallback.options, C().hashStr(a.id + i)).forEach(({ text, i: oi }) => choose.append(h("button.opt", { type: "button", onclick: (ev) => {
        const ok = oi === t.fallback.answer;
        choose.querySelectorAll("button").forEach((b) => (b.disabled = true)); ev.currentTarget.classList.add(ok ? "opt--ok" : "opt--no");
        if (ok) chosenOk++;
        advance(t.fallback.options[t.fallback.answer], null, ok ? null : `A better reply: "${t.fallback.options[t.fallback.answer]}"`);
      } }, text)));
      const panel = speakPanel("conversation", { level: ctx.level, allowTyped: true,
        task: { prompt: t.line, goal: t.goal, examples: t.examples, setting: a.setting, history: history.slice() },
        onResult: (r) => {
          if (r && r.evaluation) { voiced++; ctx.saveSpeaking({ lesson: ctx.lesson.id, act: a.id, turn: i, mode: "conversation", transcript: r.transcript, evaluation: r.evaluation }); advance(r.transcript, r.evaluation); }
          else if (r && (r.unavailable || r.micError || r.practiced) && !r.unclear) chooseWrap.hidden = false;
        } });
      const toggle = h("button.linkbtn", { type: "button", onclick: () => { chooseWrap.hidden = !chooseWrap.hidden; } }, "Choose a reply instead · Elegir una respuesta");
      stage.replaceChildren(h("div.convo__turn", goal, replay, panel, toggle, chooseWrap));
    }
    function advance(said, ev, note) {
      log.append(lineEl("me", said || "…"));
      history.push({ who: "learner", text: said || "" });
      if (ev && ev.follow_up && !a.turns[i].last) log.append(h("div.bubble", h("span.bubble__who", sp.name + " (improvised)"), h("p", ev.follow_up)));
      stage.replaceChildren(h("div", note ? h("p.note", note) : null,
        h("button.btn.btn--primary", { type: "button", onclick: () => { i++; if (i < a.turns.length) turn(); else finish(); } }, i + 1 < a.turns.length ? "Next →" : "Finish conversation")));
    }
    function finish() {
      ctx.record({ correct: null, practiced: true, voiced, chosenOk, turns: a.turns.length });
      stage.replaceChildren(h("div.feedback.feedback--ok", h("b", "Conversation complete. "), voiced ? `You answered ${voiced} of ${a.turns.length} turns out loud.` : "Next time, try answering out loud.",
        " ", esToggle(voiced ? `Respondiste ${voiced} de ${a.turns.length} turnos en voz alta.` : "La próxima vez, intenta responder en voz alta.")), cont(ctx));
    }
    const start = h("button.btn.btn--primary", { type: "button", onclick: () => { start.remove(); turn(); } }, "Start the conversation");
    return h("div.act.act--convo", h("p.setting", a.setting), esToggle(a.setting_es), h("p.muted.small", `${sp.name} · ${sp.role}`), log, stage, h("div", start));
  };

  R.mastery = (a, ctx) => {
    const box = h("div.act"), qs = h("div.qs"), done = h("div");
    let n = 0, right = 0;
    a.items.forEach((q) => qs.append(choiceQ(Object.assign({}, q, { id: a.id + q.id }), ctx, (ok) => {
      n++; if (ok) right++;
      if (!ok) ctx.review({ id: `${ctx.lesson.id}:${a.id}:${q.id}`, kind: "item", lesson: ctx.lesson.id, act: a.id, q: q.id });
      if (n === a.items.length) {
        const passed = right >= a.pass;
        ctx.record({ correct: passed, score: right, of: a.items.length });
        ctx.mastery({ score: right, of: a.items.length, passed });
        done.replaceChildren(h("div.feedback", { class: passed ? "feedback--ok" : "feedback--no" }, h("b", `${right} / ${a.items.length}. `),
          passed ? "Lesson complete." : `You need ${a.pass} to complete the lesson. Review the missed items and try again.`, " ",
          esToggle(passed ? "Lección completada." : `Necesitas ${a.pass} para completar la lección. Repasa lo que fallaste e inténtalo otra vez.`)),
          passed ? cont(ctx, "See your review →") : h("button.btn", { type: "button", onclick: () => ctx.restart() }, "↺ Try the check again"));
      }
    })));
    box.append(h("p.q__prompt", "Mastery check: answer without help. — Prueba final: responde sin ayuda."), qs, done);
    return box;
  };

  window.CPEAct = { render: (a, ctx) => (R[a.type] ? R[a.type](a, ctx) : h("p", "Unsupported activity.")), choiceQ, feedbackBox };
})();
