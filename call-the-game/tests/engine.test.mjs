/* Call the Game — engine tests: profiles, execution model, hitter model, rules, grading.  node --test call-the-game/tests/engine.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import "../../apps/call-the-game/engine.js";        // browser script: attaches globalThis.CTG
const C = globalThis.CTG;
const P = (id) => C.pitcherById(id);

test("profiles: usage sums to 100% per batter hand; colours exist; LHP mirrors arm side", () => {
  for (const p of C.PITCHERS) assert.ok(C.validatePitcher(p));
  assert.equal(C.armSign("R"), -1); assert.equal(C.armSign("L"), 1);
  assert.deepEqual(P("whitaker").arsenal.map((a) => a.code), ["FF", "SL", "CH"]);
  assert.deepEqual(P("fuentes").arsenal.map((a) => a.code), ["FT", "CH", "FC"]);
  assert.deepEqual(P("kessler").arsenal.map((a) => a.code), ["FF", "FC", "CU"]);
  const k = P("kessler"); assert.notDeepEqual(k.arsenal.map((a) => a.usage.R), k.arsenal.map((a) => a.usage.L));
});

test("RNG: seeded and stream-separated (same seed + key → same draws)", () => {
  const a = C.stream(42, "exec", 3), b = C.stream(42, "exec", 3), c = C.stream(42, "exec", 4);
  const x = [a(), a(), a()], y = [b(), b(), b()], z = [c(), c(), c()];
  assert.deepEqual(x, y); assert.notDeepEqual(x, z);
});

test("execution: mean miss = systematic bias (arm side follows hand); spread ≈ profile sd; correlation sign", () => {
  for (const id of ["whitaker", "kessler"]) {
    const p = P(id), s = C.armSign(p.hand), a = p.arsenal[0], t = { x: 0, z: 2.5 }, r = C.rng(7), n = 20000;
    let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
    const def = { ...a, miss: { ...a.miss, wild: 0, sideSd: null } }, pp = { ...p, arsenal: [def] };
    for (let i = 0; i < n; i++) { const e = C.execute(pp, a.code, t, r); const dx = (e.x - t.x) * s * 12, dz = (e.z - t.z) * 12; sx += dx; sz += dz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const mx = sx / n, mz = sz / n, vx = sxx / n - mx * mx, vz = szz / n - mz * mz, rho = (sxz / n - mx * mz) / Math.sqrt(vx * vz);
    assert.ok(Math.abs(mx - a.miss.biasArm) < 0.15, `${id} arm bias ${mx}`);
    assert.ok(Math.abs(mz - a.miss.biasUp) < 0.15, `${id} vertical bias ${mz}`);
    assert.ok(Math.abs(Math.sqrt(vx) - a.miss.sdH) < 0.15 && Math.abs(Math.sqrt(vz) - a.miss.sdV) < 0.15);
    assert.ok(Math.abs(rho - a.miss.rho) < 0.03, `${id} rho ${rho}`);
  }
  // Whitaker's four-seamer misses arm-side = catcher's left (−x) for a RHP; Kessler's (LHP) = catcher's right (+x)
  const mW = C.missModel(P("whitaker"), P("whitaker").arsenal[0], { x: 0, z: 2.5 }), mK = C.missModel(P("kessler"), P("kessler").arsenal[0], { x: 0, z: 2.5 });
  assert.ok(mW.mx < 0 && mK.mx > 0);
});

test("execution: occasional large misses; side-dependent command for Kessler", () => {
  const p = P("whitaker"), r = C.rng(3); let wild = 0; for (let i = 0; i < 20000; i++) if (C.execute(p, "CH", { x: 0, z: 2 }, r).wild) wild++;
  assert.ok(Math.abs(wild / 20000 - 0.07) < 0.01);
  const k = P("kessler"), ff = k.arsenal[0], s = C.armSign("L");
  assert.ok(C.missModel(k, ff, { x: 0.8 * s, z: 2.5 }).sdA > 1.5 * C.missModel(k, ff, { x: -0.8 * s, z: 2.5 }).sdA);
});

test("flight: the animation endpoint equals the simulated endpoint; release from the pitcher's arm side", () => {
  for (const p of C.PITCHERS) for (const a of p.arsenal) {
    const end = { x: 0.37, z: 1.9, velo: a.velo }, f = C.flight(p, a, end), e = C.flightAt(f, 1), st = C.flightAt(f, 0);
    assert.ok(Math.abs(e.x - end.x) < 1e-9 && Math.abs(e.z - end.z) < 1e-9 && Math.abs(e.y) < 1e-9);
    assert.equal(Math.sign(st.x), C.armSign(p.hand)); assert.ok(st.z > 5 && st.y > 50);
    assert.ok(f.T > 0.38 && f.T < 0.5);
  }
  // breaking ball drops more than a fastball mid-flight relative to the straight line
  const w = P("kessler"), ff = C.flight(w, w.arsenal[0], { x: 0, z: 2.5 }), cu = C.flight(w, w.arsenal[2], { x: 0, z: 2.5 });
  assert.ok(C.flightAt(cu, 0.5).z > C.flightAt(ff, 0.5).z);  // the curve starts higher (it has more drop to make)
});

test("rules: count, foul with two strikes, strikeout, walk with forced runners, three outs end the inning", () => {
  const st = C.newInning({ seed: 1, pitcherId: "whitaker" }), r = C.rng(1);
  C.applyPitch(st, { kind: "called" }, r); C.applyPitch(st, { kind: "foul" }, r);
  assert.deepEqual([st.balls, st.strikes], [0, 2]);
  C.applyPitch(st, { kind: "foul" }, r); assert.deepEqual([st.balls, st.strikes], [0, 2]);
  const k = C.applyPitch(st, { kind: "foultip" }, r); assert.equal(k.label, "Strikeout swinging"); assert.equal(st.outs, 1);
  for (let i = 0; i < 4; i++) C.applyPitch(st, { kind: "ball" }, r);
  assert.deepEqual(st.bases.map(Boolean), [true, false, false]);
  for (let i = 0; i < 4; i++) C.applyPitch(st, { kind: "ball" }, r);
  for (let i = 0; i < 4; i++) C.applyPitch(st, { kind: "ball" }, r);
  assert.deepEqual(st.bases.map(Boolean), [true, true, true]);
  const w = (() => { let e; for (let i = 0; i < 4; i++) e = C.applyPitch(st, { kind: "ball" }, r); return e; })();
  assert.equal(w.label, "Walk"); assert.equal(st.runs, 1);
  for (let o = 0; o < 2; o++) for (let i = 0; i < 3; i++) C.applyPitch(st, { kind: "whiff" }, r);
  assert.equal(st.outs, 3); assert.ok(st.over);
});

test("rules: home run clears the bases; double play only with a runner on first and < 2 outs", () => {
  const st = C.newInning({ seed: 2, pitcherId: "fuentes" });
  st.bases = ["a", "b", null];
  C.applyPitch(st, { kind: "inplay", bip: { type: "fly", result: "homer", quality: 1 } }, C.rng(1));
  assert.equal(st.runs, 3); assert.deepEqual(st.bases, [null, null, null]);
  st.bases = ["a", null, null]; let dp = 0;
  for (let i = 0; i < 400; i++) { const s2 = C.newInning({ seed: 2, pitcherId: "fuentes" }); s2.bases = ["a", null, null]; C.applyPitch(s2, { kind: "inplay", bip: { type: "ground", result: "out" } }, C.rng(i)); if (s2.outs === 2) dp++; }
  assert.ok(dp > 100 && dp < 250);
});

test("hitter model: swings more in the zone, chases with two strikes, takes 3-0; middle-middle gets hit harder", () => {
  const def = P("whitaker").arsenal[0], bat = { discipline: 1, contact: 1, power: 1, hand: "R" };
  const mid = C.pitchProbs(def, { x: 0, z: 2.5 }, { balls: 1, strikes: 1 }, bat), out = C.pitchProbs(def, { x: 1.3, z: 2.5 }, { balls: 1, strikes: 1 }, bat);
  assert.ok(mid.swing > 0.7 && out.swing < 0.2);
  assert.ok(C.pitchProbs(def, { x: 1.1, z: 1.2 }, { balls: 0, strikes: 2 }, bat).swing > C.pitchProbs(def, { x: 1.1, z: 1.2 }, { balls: 0, strikes: 0 }, bat).swing);
  assert.ok(C.pitchProbs(def, { x: 0, z: 2.5 }, { balls: 3, strikes: 0 }, bat).swing < 0.25);
  assert.ok(mid.calledStrike > 0.99 && out.calledStrike < 0.01);
  const q = (loc) => { const r = C.rng(5); let s = 0; for (let i = 0; i < 3000; i++) s += C.battedBall(def, loc, bat, C.zoneInfo(loc.x, loc.z), r).quality; return s / 3000; };
  assert.ok(q({ x: 0, z: 2.5 }) > q({ x: 0.8, z: 1.6 }) + 0.1);
});

test("simulation: plausible rates when the catcher follows the plan", () => {
  const T = { PA: 0, K: 0, BB: 0, H: 0, BIP: 0, HR: 0 };
  for (let s = 1; s <= 150; s++) {
    for (const id of ["whitaker", "fuentes", "kessler"]) {
      const p = P(id), st = C.newInning({ seed: s * 31, pitcherId: id }), r = C.rng(s);
      while (!st.over) {
        const b = C.batterOf(st), pv = C.planProbs(p, b.hand, C.countCtx(st.balls, st.strikes)); let u = r(), code = p.arsenal[0].code;
        for (const k in pv) { if (u < pv[k]) { code = k; break; } u -= pv[k]; }
        const o = C.optimalTarget(p, code, b.hand, { balls: st.balls, strikes: st.strikes });
        const rec = C.playPitch(st, { code, target: { x: o.x + 0.15 * C.normal(r), z: o.z + 0.15 * C.normal(r) } });
        if (rec.event.paEnd) { T.PA++; if (/Strikeout/.test(rec.event.label)) T.K++; if (rec.event.label === "Walk") T.BB++; if (rec.bip) { T.BIP++; if (rec.bip.result !== "out") T.H++; if (rec.bip.result === "homer") T.HR++; } }
      }
    }
  }
  const k = T.K / T.PA, bb = T.BB / T.PA, babip = (T.H - T.HR) / (T.BIP - T.HR);
  assert.ok(k > 0.15 && k < 0.33, `K% ${k}`); assert.ok(bb > 0.03 && bb < 0.12, `BB% ${bb}`); assert.ok(babip > 0.24 && babip < 0.34, `BABIP ${babip}`);
});

test("retry with the same seed and the same calls reproduces the inning exactly", () => {
  const calls = []; const a = C.newInning({ seed: 777, pitcherId: "kessler" });
  const p = P("kessler"); let i = 0;
  while (!a.over) { const c = { code: p.arsenal[i++ % 3].code, target: { x: (i % 5) * 0.2 - 0.4, z: 2 + (i % 3) * 0.4 } }; calls.push(c); C.playPitch(a, c); }
  const b = C.newInning({ seed: 777, pitcherId: "kessler" }); for (const c of calls) C.playPitch(b, c);
  assert.deepEqual(b.calls.map((x) => [x.end, x.result, x.event.label]), a.calls.map((x) => [x.end, x.result, x.event.label]));
  assert.deepEqual(a.lineup, b.lineup);
});

test("location grade: preferred setup scores 100, middle-middle 0; accounts for bias; independent of outcome", () => {
  const p = P("fuentes"), cnt = { balls: 1, strikes: 1 };
  const opt = C.optimalTarget(p, "CH", "L", cnt);
  assert.equal(C.evaluateCall(p, "CH", { x: opt.x, z: opt.z }, "L", cnt).grade, 100);
  assert.equal(C.evaluateCall(p, "CH", { x: 0, z: 2.5 }, "L", cnt).grade, 0);
  // the changeup finishes under the glove: the preferred setup sits higher than the corridor centre it aims at
  const corr = p.arsenal[1].corridor[0]; assert.ok(opt.z > corr.z, `opt ${opt.z} vs corridor ${corr.z}`);
  // the sinker runs arm-side: preferred setup is glove-side of the corridor (arm units)
  const ft = C.optimalTarget(p, "FT", "R", cnt); assert.ok(ft.x * C.armSign("R") < p.arsenal[0].corridor[0].a);
  // same call graded the same whatever happened next
  const s1 = C.newInning({ seed: 5, pitcherId: "fuentes" }), s2 = C.newInning({ seed: 6, pitcherId: "fuentes" });
  const call = { code: "FT", target: { x: -0.4, z: 2.0 } };
  const r1 = C.playPitch(s1, call), r2 = C.playPitch(s2, call);
  if (r1.batter.hand === r2.batter.hand) assert.equal(r1.eval.grade, r2.eval.grade);
});

test("location grade is count-aware: with three balls, chase targets lose value", () => {
  const p = P("whitaker"), low = { x: 1.05, z: 1.2 };
  assert.ok(C.evaluateCall(p, "SL", low, "R", { balls: 3, strikes: 1 }).grade < C.evaluateCall(p, "SL", low, "R", { balls: 0, strikes: 2 }).grade);
});

test("usage score: following the plan scores high, one-pitch mixes score low, unfaced split not graded, small samples forgiven", () => {
  const p = P("whitaker");
  const mk = (codes, hand) => codes.map((code, i) => ({ code, batter: { hand }, count: { balls: i % 3, strikes: i % 2 } }));
  const plan = []; for (let i = 0; i < 20; i++) plan.push(i % 20 < 11 ? "FF" : i % 20 < 18 ? "SL" : "CH");
  assert.ok(C.usageScore(p, mk(plan, "R"), "R").score >= 85);
  assert.ok(C.usageScore(p, mk(Array(20).fill("FF"), "R"), "R").score < 50);
  assert.equal(C.usageScore(p, mk(plan, "R"), "L").graded, false);
  assert.ok(C.usageScore(p, mk(["SL", "SL"], "R"), "R").score >= 70, "two sliders in two pitches is not proof of a bad plan");
});

test("inning evaluation: weights configurable; overall within 0–100; feedback grounded", () => {
  const st = C.newInning({ seed: 11, pitcherId: "whitaker" });
  while (!st.over) C.playPitch(st, { code: "FF", target: { x: 0, z: 2.5 } });
  const e = C.evaluateInning(st), e2 = C.evaluateInning(st, { weights: { usage: 1, location: 0 } });
  assert.ok(e.overall >= 0 && e.overall <= 100); assert.equal(e.location, 0); assert.equal(e2.overall, e.usage);
  assert.ok(e.feedback.opportunity.some((t) => /four-seam/i.test(t)));
  assert.ok(typeof e.feedback.takeaway === "string" && e.feedback.takeaway.length > 10);
});
