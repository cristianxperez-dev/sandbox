/* English (CP English) — microphone recording and the speech API client.
   Recording stays in the browser (a Blob in memory) until the learner sends it for feedback; the server
   transcribes and evaluates it and keeps nothing. Without a microphone, consent or the AI service, every
   speaking task still works as practice (listen, record, play back and compare) and says plainly that
   automatic feedback is unavailable — no score is ever invented. */
(function () {
  "use strict";
  const MAX_SECONDS = 45;
  const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const mimeType = () => TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || "";

  /** explains a microphone failure in Spanish + English */
  function micError(e) {
    const n = e && e.name;
    if (!window.isSecureContext) return { code: "insecure", es: "El micrófono necesita una conexión segura (https).", en: "The microphone needs a secure (https) connection." };
    if (n === "NotAllowedError" || n === "SecurityError") return { code: "denied", es: "No hay permiso para usar el micrófono. Actívalo en la configuración del navegador (el candado junto a la dirección) y vuelve a intentarlo.", en: "Microphone permission was denied. Allow it in the browser settings (the lock next to the address) and try again." };
    if (n === "NotFoundError" || n === "OverconstrainedError") return { code: "none", es: "No se encontró un micrófono en este dispositivo.", en: "No microphone was found on this device." };
    if (n === "NotReadableError") return { code: "busy", es: "Otra aplicación está usando el micrófono. Ciérrala y vuelve a intentarlo.", en: "Another app is using the microphone. Close it and try again." };
    return { code: "unavailable", es: "No se pudo usar el micrófono.", en: "The microphone could not be used." };
  }

  /** one recording. start() → Promise; stop() → Promise<{blob, mime, seconds, url}> */
  function recorder(onTick) {
    let rec = null, stream = null, chunks = [], t0 = 0, timer = null, resolveStop = null;
    async function start() {
      if (!supported()) throw Object.assign(new Error("unsupported"), { info: { code: "unsupported", es: "Este navegador no permite grabar audio. Prueba con Chrome, Safari o Edge actualizados.", en: "This browser can't record audio. Try an up-to-date Chrome, Safari or Edge." } });
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
      catch (e) { throw Object.assign(new Error("mic"), { info: micError(e) }); }
      const mt = mimeType();
      rec = new MediaRecorder(stream, mt ? { mimeType: mt, audioBitsPerSecond: 32000 } : undefined);
      chunks = []; t0 = performance.now();
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = (rec.mimeType || mt || "audio/webm").split(";")[0];
        const blob = new Blob(chunks, { type: mime }), seconds = Math.min(MAX_SECONDS, (performance.now() - t0) / 1000);
        if (resolveStop) resolveStop({ blob, mime, seconds: Math.round(seconds * 10) / 10, url: URL.createObjectURL(blob) });
      };
      rec.start(250);
      timer = setInterval(() => { const s = (performance.now() - t0) / 1000; if (onTick) onTick(s); if (s >= MAX_SECONDS) stop(); }, 200);
    }
    function stop() {
      clearInterval(timer);
      return new Promise((res) => { resolveStop = res; if (rec && rec.state !== "inactive") rec.stop(); else res(null); });
    }
    function cancel() { clearInterval(timer); resolveStop = null; try { if (rec && rec.state !== "inactive") rec.stop(); } catch (e) {} if (stream) stream.getTracks().forEach((t) => t.stop()); }
    return { start, stop, cancel };
  }

  /* ---------------- API ---------------- */
  let statusCache = null;
  const deviceId = () => (window.CPEStore && window.CPEStore.get().device) || "anon";
  async function status(force) {
    if (statusCache && !force) return statusCache;
    try {
      const r = await fetch("api/status", { headers: { Accept: "application/json" }, cache: "no-store" });
      statusCache = r.ok ? await r.json() : { ai: { active: false, reason: r.status === 404 ? "no-server" : "error" } };
    } catch (e) { statusCache = { ai: { active: false, reason: "offline" } }; }
    return statusCache;
  }
  /** human explanation of why feedback isn't available, in the learner's language */
  const REASONS = {
    "no-key": ["Automatic feedback isn't set up on the server yet.", "La retroalimentación automática todavía no está configurada en el servidor."],
    disabled: ["Automatic feedback is switched off by the administrator.", "La retroalimentación automática está desactivada por el administrador."],
    "production-not-approved": ["Automatic feedback isn't approved for this site yet.", "La retroalimentación automática todavía no está aprobada para este sitio."],
    "no-budget-store": ["Automatic feedback isn't set up yet (spending limits).", "La retroalimentación automática todavía no está configurada (límites de gasto)."],
    "no-server": ["Automatic feedback isn't available in this version.", "La retroalimentación automática no está disponible en esta versión."],
    offline: ["You're offline: feedback can't be requested now.", "Sin conexión: no se puede pedir retroalimentación ahora."],
    "rate-limited": ["Many recordings in a row. Wait a few minutes and try again.", "Muchas grabaciones seguidas. Espera unos minutos y vuelve a intentarlo."],
    "daily-limit-reached": ["Today's limit for automatic feedback has been reached. Try again tomorrow.", "Se alcanzó el límite diario de retroalimentación automática. Vuelve mañana."],
    "monthly-limit-reached": ["This month's limit for automatic feedback has been reached.", "Se alcanzó el límite mensual de retroalimentación automática."],
    "too-long": ["The recording is too long (45 seconds at most).", "La grabación es demasiado larga (máximo 45 segundos)."],
    "too-large": ["The recording is too large.", "La grabación es demasiado grande."],
    "unsupported-audio": ["This audio format isn't supported.", "Este formato de audio no es compatible."],
  };
  function unavailableReason(reason, native) {
    const r = REASONS[reason] || ["Automatic feedback isn't available at the moment.", "La retroalimentación automática no está disponible en este momento."];
    return native === "es" ? r[1] : r[0];
  }
  async function post(path, init) {
    try {
      const r = await fetch(path, Object.assign({ cache: "no-store" }, init, { headers: Object.assign({ "X-EN-Device": deviceId() }, init.headers || {}) }));
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) return { error: (data && (data.reason || data.error)) || "error", status: r.status };
      return data;
    } catch (e) { return { error: "offline" }; }
  }
  /** send a recording: mode repeat (with reference) or answer/conversation/placement (with task) */
  function speech(rec, meta) {
    const fd = new FormData();
    fd.append("audio", rec.blob, "speech");
    fd.append("meta", JSON.stringify(Object.assign({ seconds: rec.seconds }, meta)));
    return post("api/speech", { method: "POST", body: fd });
  }
  const text = (task, typed) => post("api/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, text: typed }) });

  window.CPESpeech = { MAX_SECONDS, supported, recorder, status, speech, text, unavailableReason, micError };
})();
