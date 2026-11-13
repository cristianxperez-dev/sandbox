/* English (CP English) — activity renderers, v2 (both language directions). Each takes (activity, ctx) and returns an element.
   ctx: { lesson, level, record(outcome), review(card), saveSpeaking(r), next(), restart(), seed }
   Content fields are normalized by the build: target-language text + `tr` (the learner's language), `X_tr` translations.
   Objective activities are graded here, deterministically (core.js). Speaking activities never invent a grade: their
   outcome is "practiced" (plus the validated feedback, when the service is available). */
(function () {
  "use strict";
  const { h, L, clipPlayer, trToggle, speakPanel, playSrc, stopAudio } = window.CPEUI;
  const C = () => window.CPE;
  const T = (ctx) => ctx.lesson.target;

  function feedbackBox(ok, explain, explain_tr) {
    return h("div.feedback", { class: ok ? "feedback--ok" : "feedback--no", role: "status" },
      h("b", ok ? "Correct. " : "Not quite. "), explain || "", " ", trToggle(explain_tr));
  }
  const cont = (ctx, label) => h("button.btn.btn--primary.continue", { type: "button", onclick: () => ctx.next() }, label || "Continue →");
  const reviewCard = (ctx, extra) => Object.assign({ lesson: ctx.lesson.id, course: ctx.lesson.courseKey }, extra);

  /* one multiple-choice question; onAnswer(correct, chosenOriginalIndex) */
  function choiceQ(q, ctx, onAnswer, opts) {
    const o = opts || {};
    const seed = C().hashStr((ctx.seed || 0) + q.id);
    const box = h("div.q");
    if (q.clip && ctx.clips && ctx.clips[q.clip]) box.append(clipPlayer(ctx.clips[q.clip], { transcript: false }));
    box.append(h("p.q__prompt", q.prompt, " ", trToggle(q.prompt_tr)));
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
        fb.replaceChildren(feedbackBox(ok, q.explain || (ok ? "" : "Answer: " + q.options[q.answer]), q.explain_tr));
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
      if (!ok) ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}`, kind: "item", act: a.id }));
      done.replaceChildren(cont(ctx));
    }), done);
  };

  R.match = (a, ctx) => {
    const seed = C().hashStr((ctx.seed || 0) + a.id);
    const right = C().shuffle(a.pairs.map((p) => p[1]), seed);
    const sels = a.pairs.map(([w]) => {
      const s = h("select.in", { "aria-label": `Meaning of ${w}` }, h("option", { value: "" }, "— choose —"), right.map((m) => h("option", { value: m }, m)));
      return [w, s];
    });
    const fb = h("div"), btn = h("button.btn", { type: "button" }, "Check");
    btn.onclick = () => {
      const chosen = Object.fromEntries(sels.map(([w, s]) => [w, s.value]));
      if (Object.values(chosen).some((v) => !v)) { fb.replaceChildren(h("p.note", L("Choose a meaning for every word.", "Elige un significado para cada palabra."))); return; }
      const wrong = C().gradeMatch(a, chosen);
      sels.forEach(([w, s]) => { s.disabled = true; s.closest(".match__row").classList.add(wrong.includes(w) ? "row--no" : "row--ok"); });
      btn.disabled = true;
      const ok = !wrong.length;
      ctx.record({ correct: ok, wrong });
      wrong.forEach((w) => ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}:${w}`, kind: "phrase", text: w, tr: a.pairs.find((p) => p[0] === w)[1], lang: T(ctx) })));
      fb.replaceChildren(h("div.feedback", { class: ok ? "feedback--ok" : "feedback--no" }, ok ? "All correct." : "Correct answers: ",
        ok ? null : h("ul", wrong.map((w) => h("li", h("b", w), " = ", a.pairs.find((p) => p[0] === w)[1]))), " ", trToggle(a.explain_tr), a.explain && T(ctx) === "es" ? h("p.small", a.explain) : null), cont(ctx));
    };
    return h("div.act", h("p.q__prompt", a.prompt, " ", trToggle(a.prompt_tr)),
      h("div.match", sels.map(([w, s]) => h("label.match__row", h("span.match__en", { lang: T(ctx) }, w), s))), btn, fb);
  };

  R.order = (a, ctx) => {
    const seed = C().hashStr((ctx.seed || 0) + a.id);
    let pool = C().shuffle(a.words.map((w, i) => ({ w, i })), seed), line = [];
    const lineEl = h("div.order__line", { "aria-live": "polite", lang: T(ctx) }), poolEl = h("div.order__pool", { lang: T(ctx) });
    const fb = h("div"), check = h("button.btn", { type: "button" }, "Check");
    const draw = () => {
      lineEl.replaceChildren(...(line.length ? line.map((x) => h("button.chip.chip--word", { type: "button", onclick: () => { line = line.filter((y) => y !== x); pool.push(x); draw(); } }, x.w)) : [h("span.muted", L("Tap the words in order.", "Toca las palabras en orden."))]));
      poolEl.replaceChildren(...pool.map((x) => h("button.chip.chip--word", { type: "button", onclick: () => { pool = pool.filter((y) => y !== x); line.push(x); draw(); } }, x.w)));
    };
    check.onclick = () => {
      if (line.length !== a.words.length) { fb.replaceChildren(h("p.note", L("Use all the words.", "Usa todas las palabras."))); return; }
      const ok = C().gradeOrder(a, line.map((x) => x.w));
      ctx.record({ correct: ok });
      if (!ok) ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}`, kind: "item", act: a.id }));
      check.disabled = true; lineEl.querySelectorAll("button").forEach((b) => (b.disabled = true)); poolEl.querySelectorAll("button").forEach((b) => (b.disabled = true));
      const ans = a.answers[0], cap = ans.charAt(0).toUpperCase() + ans.slice(1) + (/[.?!]$/.test(ans) ? "" : ".");
      fb.replaceChildren(feedbackBox(ok, ok ? cap : "Answer: " + cap, a.explain_tr), a.explain && T(ctx) === "es" ? h("p.small", a.explain) : null, cont(ctx));
    };
    draw();
    return h("div.act", h("p.q__prompt", a.prompt, " ", trToggle(a.prompt_tr)), lineEl, poolEl, check, fb);
  };

  R.listen = (a, ctx) => {
    const clip = ctx.clips[a.clip];
    const qs = h("div.qs"), done = h("div");
    let answered = 0, right = 0;
    a.questions.forEach((q) => qs.append(choiceQ(Object.assign({}, q, { id: a.id + q.id }), ctx, (ok) => {
      answered++; if (ok) right++;
      if (!ok) ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}:${q.id}`, kind: "item", act: a.id, q: q.id }));
      if (answered === a.questions.length) { ctx.record({ correct: right === a.questions.length, score: right, of: a.questions.length }); done.replaceChildren(h("p.muted", `${right} of ${a.questions.length} correct. ` + L("Open the text to check what you heard.", "Abre el texto para revisar lo que escuchaste.")), cont(ctx)); }
    })));
    return h("div.act", h("p.q__prompt", a.intro, " ", trToggle(a.intro_tr)), clipPlayer(clip, { speakers: ctx.lesson.speakers }), qs, done);
  };

  function speechCard(a, ctx, mode, extra) {
    const clip = ctx.clips[a.clip];
    const done = h("div");
    const finish = (r) => {
      ctx.record({ correct: null, practiced: true, evaluated: !!(r && (r.evaluation || r.compare)), transcript: r && r.transcript || null });
      if (r && r.evaluation && r.evaluation.better_sentence && r.evaluation.corrections && r.evaluation.corrections.length)
        ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}:better`, kind: "phrase", text: r.evaluation.better_sentence, tr: "", lang: T(ctx) }));
      if (r && (r.evaluation || r.compare)) ctx.saveSpeaking({ lesson: ctx.lesson.id, course: ctx.lesson.courseKey, lang: T(ctx), act: a.id, mode, transcript: r.transcript, evaluation: r.evaluation || null, compare: r.compare ? { ratio: r.compare.ratio, verdict: r.compare.verdict } : null });
      done.replaceChildren(cont(ctx));
    };
    const skip = h("button.linkbtn", { type: "button", onclick: () => { ctx.record({ correct: null, skipped: true }); ctx.next(); } }, "Skip for now");
    return h("div.act",
      extra,
      clip ? clipPlayer(clip, { transcript: mode !== "repeat", showTranscript: mode === "repeat", speakers: ctx.lesson.speakers }) : null,
      speakPanel(mode, Object.assign({ level: ctx.level, lang: T(ctx), onResult: (r) => { if (r && (r.transcript || r.practiced || r.unclear)) finish(r); } }, extra && extra.opts)),
      done, h("p.skip", skip));
  }

  R.repeat = (a, ctx) => {
    const clip = ctx.clips[a.clip];
    const head = h("div", h("p.q__prompt", L("Listen, then say it.", "Escucha y repítelo.")), h("p.model", h("b", { lang: T(ctx) }, a.text), " ", trToggle(a.tr)), a.tip_tr ? h("p.muted.small", a.tip_tr) : a.tip ? h("p.muted.small", a.tip) : null);
    head.opts = { reference: a.text, model: { audio: clip.audio } };
    return speechCard(a, ctx, "repeat", head);
  };
  R.answer = (a, ctx) => {
    const head = h("div", h("p.q__prompt", L("Listen to the question and answer out loud.", "Escucha la pregunta y responde en voz alta.")),
      h("p.model", h("b", { lang: T(ctx) }, a.prompt), " ", trToggle(a.prompt_tr)), h("p.muted.small", "Goal: ", a.goal_tr || a.goal),
      h("details.examples", h("summary", L("Example answers", "Ejemplos")), h("ul", { lang: T(ctx) }, a.examples.map((x) => h("li", x)))));
    head.opts = { allowTyped: true, task: { prompt: a.prompt, goal: a.goal, examples: a.examples, focus: a.focus || [] }, level: a.level || ctx.level };
    return speechCard(a, ctx, "answer", head);
  };

  /* guided conversation, branching: the partner speaks (pre-recorded); the learner answers each turn by voice (evaluated,
     with a natural follow-up when available) or by choosing a reply (graded). A clear, on-task reply plays the partner's
     acknowledgement; an unclear one plays the partner's clarifying question and the learner tries once more. */
  R.conversation = (a, ctx) => {
    const sp = ctx.lesson.speakers[a.partner] || { name: "Partner" };
    const lang = T(ctx);
    const log = h("div.convo", { "aria-live": "polite" });
    const stage = h("div.convo__stage");
    const history = [];
    let i = 0, voiced = 0, chosenOk = 0, clear = 0, retried = false;
    const lineEl = (who, text, tr, extra) => h("div.bubble", { class: who === "me" ? "bubble--me" : "" }, h("span.bubble__who", who === "me" ? "You" : sp.name + (extra || "")), h("p", { lang }, text), tr ? trToggle(tr) : null);
    const partnerSays = (line, tr, clipId) => { log.append(lineEl("them", line, tr)); if (clipId && ctx.clips[clipId]) playSrc(ctx.clips[clipId].audio); history.push({ who: "partner", text: line }); };
    function turn(again) {
      const t = a.turns[i];
      if (!again) partnerSays(t.line, t.tr, t.clip);
      const replay = h("button.btn.btn--ghost.btn--sm", { type: "button", onclick: () => playSrc(ctx.clips[again && t.clarify ? t.clarify.clip : t.clip].audio) }, "↺ Hear it again");
      const goal = h("p.muted.small", L("Your turn:", "Tu turno:"), " ", t.goal_tr || t.goal);
      const choose = h("div.opts", { lang });
      const chooseWrap = h("div", { hidden: true }, h("p.small", L("Choose the best reply:", "Elige la mejor respuesta:")), choose);
      C().orderOptions(t.fallback.options, C().hashStr(a.id + i + (again ? "r" : ""))).forEach(({ text, i: oi }) => choose.append(h("button.opt", { type: "button", onclick: (ev) => {
        const ok = oi === t.fallback.answer;
        choose.querySelectorAll("button").forEach((b) => (b.disabled = true)); ev.currentTarget.classList.add(ok ? "opt--ok" : "opt--no");
        if (ok) chosenOk++;
        respond(ok ? text : t.fallback.options[t.fallback.answer], null, ok, ok ? null : L("A better reply:", "Una mejor respuesta:") + ` "${t.fallback.options[t.fallback.answer]}"`);
      } }, text)));
      const panel = speakPanel("conversation", { level: ctx.level, lang, allowTyped: true,
        task: { prompt: again && t.clarify ? t.clarify.line : t.line, goal: t.goal, examples: t.examples, focus: t.focus || [], setting: a.setting, history: history.slice() },
        onResult: (r) => {
          if (r && r.evaluation) {
            voiced++;
            ctx.saveSpeaking({ lesson: ctx.lesson.id, course: ctx.lesson.courseKey, lang, act: a.id, turn: i, mode: "conversation", transcript: r.transcript, evaluation: r.evaluation });
            const good = r.evaluation.on_task && r.evaluation.understandable && r.evaluation.in_target_language !== false;
            respond(r.transcript, r.evaluation, good);
          } else if (r && (r.unavailable || r.micError || r.practiced) && !r.unclear) chooseWrap.hidden = false;
        } });
      const toggle = h("button.linkbtn", { type: "button", onclick: () => { chooseWrap.hidden = !chooseWrap.hidden; } }, "Choose a reply instead");
      stage.replaceChildren(h("div.convo__turn", goal, replay, panel, toggle, chooseWrap));
    }
    /** the learner's reply decides what the partner says next */
    function respond(said, ev, good, note) {
      const t = a.turns[i];
      log.append(lineEl("me", said || "…"));
      history.push({ who: "learner", text: said || "" });
      if (good) clear++;
      const branch = good ? t.ack : (!retried ? t.clarify : null);
      if (branch) partnerSays(branch.line, branch.tr, branch.clip);
      if (ev && ev.follow_up && good && !t.last && !t.ack) log.append(h("div.bubble", h("span.bubble__who", sp.name + " (improvised)"), h("p", { lang }, ev.follow_up)));
      const again = !good && t.clarify && !retried;
      stage.replaceChildren(h("div", note ? h("p.note", note) : null,
        again ? h("p.small", L(`${sp.name} didn't quite understand. Try again — the better sentence above can help.`, `${sp.name} no entendió bien. Inténtalo otra vez.`)) : null,
        h("button.btn.btn--primary", { type: "button", onclick: () => {
          if (again) { retried = true; turn(true); return; }
          retried = false; i++; if (i < a.turns.length) turn(); else finish();
        } }, again ? "Try again →" : i + 1 < a.turns.length ? "Next →" : "Finish conversation")));
    }
    function finish() {
      stopAudio();
      ctx.record({ correct: null, practiced: true, voiced, chosenOk, clear, turns: a.turns.length });
      stage.replaceChildren(h("div.feedback.feedback--ok", h("b", "Conversation complete. "),
        voiced ? L(`You answered ${voiced} turn${voiced === 1 ? "" : "s"} out loud; ${clear} of ${a.turns.length} replies came across clearly.`, `Respondiste ${voiced} turno(s) en voz alta.`) : L("Next time, try answering out loud.", "La próxima vez, intenta responder en voz alta.")), cont(ctx));
    }
    const start = h("button.btn.btn--primary", { type: "button", onclick: () => { start.remove(); turn(); } }, "Start the conversation");
    return h("div.act.act--convo", h("p.setting", a.setting), trToggle(a.setting_tr),
      a.objective ? h("p.small", h("b", L("Objective:", "Objetivo:")), " ", a.objective, " ", trToggle(a.objective_tr)) : null,
      h("p.muted.small", `${sp.name} · ${sp.role}`), log, stage, h("div", start));
  };

  R.mastery = (a, ctx) => {
    const box = h("div.act"), qs = h("div.qs"), done = h("div");
    let n = 0, right = 0;
    a.items.forEach((q) => qs.append(choiceQ(Object.assign({}, q, { id: a.id + q.id }), ctx, (ok) => {
      n++; if (ok) right++;
      if (!ok) ctx.review(reviewCard(ctx, { id: `${ctx.lesson.id}:${a.id}:${q.id}`, kind: "item", act: a.id, q: q.id }));
      if (n === a.items.length) {
        const passed = right >= a.pass;
        ctx.record({ correct: passed, score: right, of: a.items.length });
        ctx.mastery({ score: right, of: a.items.length, passed });
        done.replaceChildren(h("div.feedback", { class: passed ? "feedback--ok" : "feedback--no" }, h("b", `${right} / ${a.items.length}. `),
          passed ? L("Lesson complete.", "Lección completada.") : L(`You need ${a.pass} to complete the lesson. Review the missed items and try again.`, `Necesitas ${a.pass} para completar la lección.`)),
          passed ? cont(ctx, "See your review →") : h("button.btn", { type: "button", onclick: () => ctx.restart() }, "↺ Try the check again"));
      }
    })));
    box.append(h("p.q__prompt", L("Mastery check: answer without help.", "Prueba final: responde sin ayuda.")), qs, done);
    return box;
  };

  window.CPEAct = { render: (a, ctx) => (R[a.type] ? R[a.type](a, ctx) : h("p", "Unsupported activity.")), choiceQ, feedbackBox };
})();
