// Homepage search + category filters. Cards are rendered at build time, so
// the page is fully usable without this script; it only narrows the list.
// The current query and category are mirrored into the URL (?q=…&category=…)
// so filtered views can be shared and survive refresh/back navigation.

(() => {
  const grid = document.getElementById("grid");
  const search = document.getElementById("search");
  const empty = document.getElementById("empty");
  const emptyText = document.getElementById("empty-text");
  const status = document.getElementById("results-status");
  const count = document.querySelector("[data-count]");
  const countWord = document.querySelector("[data-count-word]");
  const chips = [...document.querySelectorAll(".chip")];
  const cards = [...grid.querySelectorAll(".card")];

  let category = "all";

  for (const chip of chips) {
    if (chip.dataset.filter !== "all" && chip.querySelector(".chip__count").textContent === "0") {
      chip.dataset.empty = "";
    }
    chip.addEventListener("click", () => {
      category = chip.dataset.filter;
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
    category = "all";
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

  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Page transitions only apply between Sandbox's own pages. Integrated apps
  // don't opt in, and Chrome logs an error in the app if one is attempted.
  const appUrls = new Set(
    [...document.querySelectorAll(".card:not(.card--pending) .card__link")].map((a) => a.href)
  );
  window.addEventListener("pageswap", (e) => {
    const to = e.activation?.entry?.url?.split(/[?#]/)[0];
    if (e.viewTransition && to && appUrls.has(to)) e.viewTransition.skipTransition();
  });

  // Keep the footer year current between deploys.
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  // Restore state from the URL.
  const params = new URLSearchParams(location.search);
  search.value = params.get("q") || "";
  const fromUrl = params.get("category");
  if (fromUrl && chips.some((c) => c.dataset.filter === fromUrl)) category = fromUrl;
  if (search.value || category !== "all") apply({ initial: true });

  function apply({ initial = false } = {}) {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length > 0 || category !== "all";
    let shown = 0;

    for (const card of cards) {
      const match =
        (category === "all" || card.dataset.category === category) &&
        terms.every((t) => card.dataset.search.includes(t));
      const wasHidden = card.hidden;
      card.hidden = !match;
      if (match) {
        if (wasHidden && !initial) {
          card.classList.remove("is-revealing");
          card.style.setProperty("--n", shown);
          void card.offsetWidth; // restart the entrance animation
          card.classList.add("is-revealing");
        }
        shown++;
      }
    }

    grid.classList.toggle("is-filtered", filtered);
    for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.filter === category));

    empty.hidden = shown > 0;
    if (!shown) {
      const label = category === "all" ? "" : ` in ${category}`;
      emptyText.textContent = terms.length
        ? `Nothing${label} matches “${search.value.trim()}”.`
        : `Nothing${label} has moved in yet — it’s on the list.`;
    }

    count.textContent = shown;
    countWord.textContent = shown === 1 ? "application" : "applications";
    status.textContent = filtered ? `${shown} ${countWord.textContent} shown` : "";

    const next = new URLSearchParams();
    if (search.value.trim()) next.set("q", search.value.trim());
    if (category !== "all") next.set("category", category);
    const qs = next.toString();
    history.replaceState(null, "", qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
  }
})();
