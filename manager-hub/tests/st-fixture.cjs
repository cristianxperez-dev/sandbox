/* Spring Training test fixtures — fictional players only (names are obviously test data), written through the
   app's own roster route, plus a Playwright route that runs the REAL ops / interpret handlers against an
   in-memory D1, so several browser contexts share one store exactly as staff would. */
const path = require("path");
const { pathToFileURL } = require("url");

/** 160 fictional players across the five workspaces: ~70 pitchers, 14 catchers, infielders, outfielders */
function seedRosters() {
  const POS = ["C", "C", "C", "1B", "2B", "SS", "3B", "SS", "2B", "LF", "CF", "RF", "OF", "UTIL"];
  const affs = ["sl", "cc", "ash", "fay", "fcl"];
  const first = ["Avery", "Blake", "Cruz", "Dane", "Eli", "Finn", "Gabe", "Hugo", "Ivan", "Jace", "Kai", "Luca", "Milo", "Nico", "Omar", "Pax", "Quin", "Rey", "Sol", "Theo", "Uriel", "Vic", "Wes", "Xan", "Yuri", "Zeke", "Ari", "Bo", "Cy", "Dax", "Ezra", "Flynn"];
  affs.forEach((aff, ai) => {
    const list = [];
    for (let i = 0; i < 32; i++) {
      const pitcher = i < 14, pos = pitcher ? (i % 3 ? "RHP" : "LHP") : POS[(i - 14) % POS.length];
      list.push({ id: `zst-${aff}-${i}`, first: first[(i + ai * 7) % first.length], last: `Testst${aff.toUpperCase()}${String(i).padStart(2, "0")}`, position: pos, pos2: "", group: pitcher ? "pitcher" : "position",
        bats: i % 3 ? "R" : "L", throws: i % 4 ? "R" : "L", number: String(10 + i), level: "", status: i === 5 && ai === 1 ? "60D" : i === 20 && ai === 3 ? "RES" : "ACT", notes: "", extra: {} });
    }
    RosterRoute.writeRoster(aff, list);
  });
}

/** a Spring Training camp built through Camp's own API: every player in, groups A–D + role groups, staff */
function seedCamp(o) {
  const A = CampUI.api, C = A.C;
  const today = C.nowIn("America/New_York").date;
  A.mutate("Create camp", () => {
    const camp = C.newCamp({ name: o.name || "2027 Minor League Spring Training", kind: "spring", start: C.addDays(today, -6), end: C.addDays(today, 30), location: "Test complex" });
    A.state().camps.push(camp); A.state().activeCampId = camp.id;
  }, { render: "none" });
  const pool = A.pool();
  A.mutate("Fill camp", (c) => {
    c.players = pool.map((p) => p.pid);
    const pos = pool.filter((p) => !p.isPitcher), pit = pool.filter((p) => p.isPitcher);
    const letters = ["A", "B", "C", "D"];
    letters.forEach((L, i) => c.groups.push({ id: "g" + L, name: "Group " + L, color: C.GROUP_COLORS[i], players: pos.filter((_, k) => k % 4 === i).map((p) => p.pid) }));
    c.groups.push({ id: "gCat", name: "Catchers", color: C.GROUP_COLORS[4], players: pool.filter((p) => p.isCatcher).map((p) => p.pid) });
    c.groups.push({ id: "gSP", name: "Starting Pitchers", color: C.GROUP_COLORS[5], players: pit.filter((_, k) => k % 3 === 0).map((p) => p.pid) });
    c.groups.push({ id: "gRP", name: "Relievers", color: C.GROUP_COLORS[6], players: pit.filter((_, k) => k % 3 !== 0).map((p) => p.pid) });
    [["Coord Testone", "Coordinator"], ["Coach Testtwo", "Manager"], ["Coach Testthree", "Manager"], ["Coach Testfour", "Hitting"], ["Coach Testfive", "Pitching"]].forEach(([n, r], i) => c.staff.push({ id: "s" + (i + 1), name: n, role: r, from: "" }));
  }, { render: "all" });
  return A.cur().id;
}

/** routes api/ops (+ interpret's camp mode answering not-configured) to the real handler and one shared fake D1 */
async function shareStore(ctx, env) {
  const ops = await import(pathToFileURL(path.join(__dirname, "../../functions/apps/manager-hub/api/ops.js")).href);
  await ctx.route("**/apps/manager-hub/api/ops**", async (route) => {
    const r = route.request(), url = r.url();
    const req = new Request(url, { method: r.method(), headers: Object.assign({}, r.headers(), { origin: new URL(url).origin }), body: r.method() === "PUT" ? r.postData() : undefined });
    const fn = r.method() === "PUT" ? ops.onRequestPut : ops.onRequestGet;
    const res = await fn({ request: req, env });
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  });
  await ctx.route("**/apps/manager-hub/api/interpret", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not-configured", reason: "test" }) }));
}

module.exports = { seedRosters, seedCamp, shareStore };
