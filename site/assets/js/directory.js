// Homepage search + discipline filters. Entries are rendered at build time in
// A–Z order, so the page is fully usable without this script; it only hides
// what doesn't match, which keeps results in alphabetical order.
// The current query and discipline are mirrored into the URL
// (?q=…&discipline=…) so filtered views can be shared and survive refresh.

(() => {
  const list = document.getElementById("directory");
  const search = document.getElementById("search");
  const empty = document.getElementById("empty");
  const emptyText = document.getElementById("empty-text");
  const status = document.getElementById("results-status");
  const chips = [...document.querySelectorAll(".chip")];
  const entries = [...list.querySelectorAll(".entry")];

  let discipline = "all";

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      discipline = chip.dataset.filter;
      apply();
    });
  }

  search.addEventListener("input", apply);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      search.value = "";
      apply();
    }
  });

  document.getElementById("clear").addEventListener("click", () => {
    search.value = "";
    discipline = "all";
    apply();
    search.focus();
  });

  // "/" focuses search, as in most directories.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    search.focus();
  });

  // Page transitions only apply between Sandbox's own pages. Integrated apps
  // don't opt in, and Chrome logs an error in the app if one is attempted.
  const appUrls = new Set(
    [...document.querySelectorAll(".entry:not(.entry--pending) .entry__link")].map((a) => a.href)
  );
  window.addEventListener("pageswap", (e) => {
    const to = e.activation?.entry?.url?.split(/[?#]/)[0];
    if (e.viewTransition && to && appUrls.has(to)) e.viewTransition.skipTransition();
  });

  // Keep the footer year current between deploys.
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  // Restore state from the URL (?category= is the older name, still honoured).
  const params = new URLSearchParams(location.search);
  search.value = params.get("q") || "";
  const fromUrl = params.get("discipline") || params.get("category");
  if (fromUrl && chips.some((c) => c.dataset.filter === fromUrl)) discipline = fromUrl;
  if (search.value || discipline !== "all") apply();

  function apply() {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length > 0 || discipline !== "all";
    let shown = 0;

    for (const entry of entries) {
      const match =
        (discipline === "all" || entry.dataset.disciplines.split("|").includes(discipline)) &&
        terms.every((t) => entry.dataset.search.includes(t));
      entry.hidden = !match;
      if (match) shown++;
    }

    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.filter === discipline));

    empty.hidden = shown > 0;
    if (!shown) {
      const where = discipline === "all" ? "" : ` in ${discipline}`;
      emptyText.textContent = terms.length
        ? `Nothing${where} matches “${search.value.trim()}”.`
        : `Nothing${where} yet.`;
    }
    status.textContent = filtered ? `${shown} application${shown === 1 ? "" : "s"} shown` : "";

    const next = new URLSearchParams();
    if (search.value.trim()) next.set("q", search.value.trim());
    if (discipline !== "all") next.set("discipline", discipline);
    const qs = next.toString();
    history.replaceState(null, "", qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
  }
})();
