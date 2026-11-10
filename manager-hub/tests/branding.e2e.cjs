/* Manager Hub — fixed affiliate branding: logos, exact colours, no customisation workflow,
   and old custom branding in a browser is ignored without touching anything else.
   BASE=…/apps/manager-hub/ [MH_ACCESS_CODE=…] node manager-hub/tests/branding.e2e.cjs */
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:4173/apps/manager-hub/";
const EXPECT = {
  sl:  { team: "Sugar Land Space Cowboys", level: "Triple-A", logo: "brand/sl.png",  primary: "#0E253A", secondary: "#25C9D1", accent: "#E47D3C" },
  cc:  { team: "Corpus Christi Hooks",     level: "Double-A", logo: "brand/cc.png",  primary: "#002A5B", secondary: "#4F91CD", accent: "#E01938" },
  ash: { team: "Asheville Tourists",       level: "High-A",   logo: "brand/ash.png", primary: "#002B5C", secondary: "#86CEBC", accent: "#005695" },
  fay: { team: "Fayetteville Woodpeckers", level: "Single-A", logo: "brand/fay.png", primary: "#D31245", secondary: "#000000", accent: "#5F6062" },
  fcl: { team: "Astros Complex",           level: "Complex · FCL & player development", logo: "brand/fcl.svg", primary: "#002D62", secondary: "#EB6E1F", accent: null }
};
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); c ? pass++ : fail++; if (!c) process.exitCode = 1; };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
async function signIn(ctx) {
  if (!process.env.MH_ACCESS_CODE) return;
  const u = new URL(BASE);
  const r = await ctx.request.post(u.origin + u.pathname + "access/login", { form: { code: process.env.MH_ACCESS_CODE }, headers: { Origin: u.origin }, maxRedirects: 0 });
  if (r.status() !== 303) throw new Error("sign-in failed " + r.status());
}
const RED_DOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

(async () => {
  const b = await chromium.launch();
  for (const [w, h, tag] of [[1366, 900, "desktop"], [390, 844, "phone"]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await signIn(ctx);
    await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("requestfailed", (r) => errs.push("failed " + r.url()));
    p.on("response", (r) => { if (r.status() >= 400 && !/\/api\/(settings|usage)$/.test(r.url())) errs.push(r.status() + " " + r.url()); });   // server functions: 404 on the static test server
    await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);

    // the selector: five clubs, each with its own logo, full name and level
    const gate = await p.$$eval("#affGateList .affgate-opt", (os) => os.map((o) => ({ id: o.dataset.aff, name: o.querySelector("b").textContent, lvl: o.querySelector(".affgate-txt span").textContent, img: o.querySelector("img").getAttribute("src"), loaded: o.querySelector("img").complete && o.querySelector("img").naturalWidth > 0 })));
    ok(gate.length === 5 && gate.every((g) => EXPECT[g.id] && g.name === EXPECT[g.id].level.split(" · ")[0] && g.lvl.startsWith(EXPECT[g.id].team) && g.img === EXPECT[g.id].logo && g.loaded), `${tag}: selector shows all five clubs with their logos`);
    const sw = await p.$$eval(".affgate-opt", (os) => os.map((o) => o.scrollWidth <= o.clientWidth + 1));
    ok(sw.every(Boolean), `${tag}: selector rows fit without overflow`);

    for (const id of Object.keys(EXPECT)) {
      const E = EXPECT[id];
      await p.evaluate((id) => localStorage.setItem("cs.affiliate", id), id); await p.reload(); await p.waitForTimeout(900);
      const s = await p.evaluate(() => {
        const cs = getComputedStyle(document.documentElement), q = (sel) => document.querySelector(sel);
        const img = (sel) => { const i = q(sel); return i ? { src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height } : null; };
        return {
          primary: cs.getPropertyValue("--aff-primary").trim(), secondary: cs.getPropertyValue("--aff-secondary").trim(), accent: cs.getPropertyValue("--aff-accent").trim(),
          stripe: getComputedStyle(q(".appbar")).borderBottomColor, masthead: cs.getPropertyValue("--aff-masthead").trim(),
          chip: img("#affChipMark img"), hub: img("#hubId img"), hubName: (q("#hubId b") || {}).textContent, hubColor: getComputedStyle(q("#hubId b")).color,
          tiles: [...document.querySelectorAll(".hub-tile")].map((t) => t.textContent), docOverflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      });
      ok(s.primary === E.primary && s.secondary === E.secondary && s.accent === (E.accent || E.secondary), `${tag} ${id}: exact colours applied (${s.primary} / ${s.secondary} / ${s.accent})`);
      ok(s.chip && s.chip.src === E.logo && s.chip.ok && s.hub && s.hub.src === E.logo && s.hub.ok, `${tag} ${id}: logo in the header switcher and the hub`);
      ok(s.hubName === E.team, `${tag} ${id}: hub names the club (${s.hubName})`);
      ok(contrast(E.primary, "#FFFFFF") >= 4.5, `${tag} ${id}: primary text colour reads on white (${contrast(E.primary, "#FFFFFF").toFixed(1)}:1)`);
      ok(!s.tiles.some((t) => /Affiliate Branding/.test(t)), `${tag} ${id}: no branding tile on the hub`);
      ok(!s.docOverflow, `${tag} ${id}: no horizontal overflow`);
      // printed sheet: the club's logo on the header, the Astros (MiLB for the FCL Astros) beside it
      await p.evaluate(() => go("print")); await p.waitForTimeout(500);
      const sheet = await p.$$eval(".s-head .logo img", (is) => is.map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })));
      ok(sheet.length === 2 && sheet[0].src === E.logo && sheet.every((x) => x.ok) && /^data:image\/png/.test(sheet[1].src), `${tag} ${id}: printed schedule carries the club logo`);
      ok(!(await p.$("#btnLogoL")) && !(await p.$("#btnLogoR")), `${tag} ${id}: no logo upload buttons on the sheet`);
      await p.evaluate(() => go("hub"));
    }

    // the switcher menu: logos, no branding entry
    await p.click("#affChip"); await p.waitForTimeout(200);
    const menu = await p.$$eval("#menu button, #menu [role=menuitem], #menu .mi", (xs) => xs.map((x) => x.textContent));
    const mlogos = await p.$$eval("#menu .mn-logo img", (is) => is.length);
    ok(mlogos === 5 && !menu.some((t) => /branding/i.test(t)), `${tag}: switcher lists five clubs with logos and no branding option (${mlogos} logos; ${menu.join(" / ")})`);
    await p.keyboard.press("Escape");
    ok(await p.evaluate(() => typeof brandingModal === "undefined" && !Brand.set && !Brand.readLogo), `${tag}: branding editor removed from the code`);
    ok(errs.length === 0, `${tag}: no page errors or failed requests ${errs.join(" | ")}`);
    await ctx.close();
  }

  // a browser that used the old branding editor and uploaded a schedule logo
  {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    await signIn(ctx);
    await ctx.route("**/rosters/org-roster.csv", (r) => r.fulfill({ status: 200, contentType: "text/csv", body: "" }));
    const p = await ctx.newPage();
    await p.goto(BASE); await p.evaluate(() => localStorage.clear());
    await p.evaluate(() => localStorage.setItem("cs.affiliate", "sl")); await p.reload(); await p.waitForTimeout(800);
    const legacy = JSON.stringify({ sl: { name: "My Custom Name", level: "Custom Level", primary: "#123456", secondary: "#ABCDEF", logo: RED_DOT } });
    const before = await p.evaluate(([legacy, dot]) => {
      localStorage.setItem("cs.brand", legacy);
      saveDraft();                                   // the workspace as a coach would have it saved
      const d = JSON.parse(localStorage.getItem("cs.sl.draft")); d.meta.logoL = dot; d.meta.logoR = dot; localStorage.setItem("cs.sl.draft", JSON.stringify(d));
      const snap = {}; for (const k of Object.keys(localStorage)) snap[k] = localStorage.getItem(k); return snap;
    }, [legacy, RED_DOT]);
    await p.reload(); await p.waitForTimeout(900);
    const s = await p.evaluate(() => ({ name: document.querySelector("#hubId b").textContent, primary: getComputedStyle(document.documentElement).getPropertyValue("--aff-primary").trim(), chip: document.querySelector("#affChipMark img").getAttribute("src") }));
    ok(s.name === "Sugar Land Space Cowboys" && s.primary === "#0E253A" && s.chip === "brand/sl.png", "old custom branding is ignored: the fixed identity takes precedence");
    await p.evaluate(() => go("print")); await p.waitForTimeout(400);
    const srcs = await p.$$eval(".s-head .logo img", (is) => is.map((i) => i.getAttribute("src")));
    ok(srcs[0] === "brand/sl.png" && srcs[1] !== srcs[0] && !srcs.includes(RED_DOT), "a logo once uploaded into a schedule no longer prints");
    const after = await p.evaluate(() => { const snap = {}; for (const k of Object.keys(localStorage)) snap[k] = localStorage.getItem(k); return snap; });
    const lost = Object.keys(before).filter((k) => !(k in after));
    ok(lost.length === 0 && after["cs.brand"] === before["cs.brand"], `no stored data deleted (old branding left in place)${lost.length ? ": lost " + lost.join(",") : ""}`);
    const d = JSON.parse(after["cs.sl.draft"]);
    ok(d.meta.logoL === RED_DOT && Array.isArray(d.sections) && JSON.stringify(d.sections) === JSON.stringify(JSON.parse(before["cs.sl.draft"]).sections), "the schedule itself is untouched");
    // PNG export inlines the logos so they appear in the image
    const png = await p.evaluate(async () => { const bl = await sheetPNGBlob(1); const t = document.createElement("div"); t.innerHTML = '<img src="brand/sl.png"><i style="background-image:url(\'brand/fcl.svg\')"></i>'; await inlineImages(t); return { size: bl ? bl.size : 0, img: t.querySelector("img").getAttribute("src").slice(0, 22), bg: t.querySelector("i").getAttribute("style").slice(0, 40) }; });
    ok(png.size > 20000 && png.img === "data:image/png;base64," && /url\('data:image\/svg\+xml/.test(png.bg), `PNG export works and embeds the logos (${png.size} bytes)`);
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
})();
