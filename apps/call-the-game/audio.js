/* Call the Game — synthesized sounds (Web Audio; no files, no network): mitt pop, bat crack, foul tick, ambient crowd. */
(function (root) {
  "use strict";
  let ac = null, master = null, crowd = null, muted = false;
  function ensure() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return ac; }
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    ac = new AC(); master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    return ac;
  }
  function noise(dur) { const n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; }
  function burst(dur, type, freq, q, gain, decay) {
    const t = ac.currentTime, src = ac.createBufferSource(); src.buffer = noise(dur);
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(fl).connect(g).connect(master); src.start(t); src.stop(t + dur);
  }
  function tone(freq, dur, gain, type) {
    const t = ac.currentTime, os = ac.createOscillator(), g = ac.createGain(); os.type = type || "sine"; os.frequency.setValueAtTime(freq, t); os.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); os.connect(g).connect(master); os.start(t); os.stop(t + dur);
  }
  const S = {
    mitt() { if (!ensure() || muted) return; burst(0.12, "bandpass", 1400, 1.2, 1.1, 0.09); tone(150, 0.12, 0.6); },
    crack(hard) { if (!ensure() || muted) return; burst(0.18, "highpass", 1800, 0.7, hard ? 1.2 : 0.8, 0.12); tone(880, 0.06, 0.25, "triangle"); burst(0.3, "bandpass", 600, 0.8, 0.25, 0.25); },
    foul() { if (!ensure() || muted) return; burst(0.1, "highpass", 2500, 0.8, 0.6, 0.07); },
    startCrowd() {
      if (!ensure() || crowd) return;
      const src = ac.createBufferSource(); src.buffer = noise(4); src.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 520;
      const g = ac.createGain(); g.gain.value = 0.05; src.connect(fl).connect(g).connect(master); src.start(); crowd = { src, g };
    },
    cheer() { if (!ensure() || muted || !crowd) return; const t = ac.currentTime; crowd.g.gain.cancelScheduledValues(t); crowd.g.gain.setValueAtTime(crowd.g.gain.value, t); crowd.g.gain.linearRampToValueAtTime(0.2, t + 0.3); crowd.g.gain.linearRampToValueAtTime(0.05, t + 2.4); },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.8; },
    get muted() { return muted; },
  };
  root.CTGAudio = S;
})(typeof self !== "undefined" ? self : globalThis);
