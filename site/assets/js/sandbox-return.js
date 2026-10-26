// A small "back to Sandbox" button added to integrated apps at build time.
// It lives in a closed shadow root so it cannot pick up — or leak — any styles
// from the app it sits on. Disable it per app with "returnLink": false.

(() => {
  const script = document.currentScript;
  if (!script || window.top !== window.self) return; // skip inside iframes

  const home = new URL("../../", script.src).href;
  const mark = new URL("../brand/monogram-sm.png", script.src).href;
  const [v, h] = (script.dataset.position || "bottom-left").split("-");

  const host = document.createElement("div");
  host.setAttribute("data-sandbox-return", "");
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      a {
        position: fixed; ${v}: 16px; ${h}: 16px; z-index: 2147483000;
        display: flex; align-items: center; gap: 0;
        height: 40px; padding: 0 9px;
        border: 1px solid rgb(42 40 38 / 0.12); border-radius: 999px;
        background: rgb(252 249 243 / 0.92);
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px -6px rgb(42 40 38 / 0.25);
        color: #2a2826; text-decoration: none;
        font: 500 12px/1 "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        letter-spacing: 0.06em; text-transform: uppercase;
        opacity: 0.72;
        transition: opacity .25s, gap .35s cubic-bezier(.22,.61,.36,1), padding .35s cubic-bezier(.22,.61,.36,1);
      }
      a:hover, a:focus-visible { opacity: 1; gap: 8px; padding: 0 14px 0 9px; }
      a:focus-visible { outline: 1.5px solid #2a2826; outline-offset: 3px; }
      img { width: 22px; height: auto; display: block; }
      span {
        max-width: 0; overflow: hidden; white-space: nowrap;
        transition: max-width .35s cubic-bezier(.22,.61,.36,1);
      }
      a:hover span, a:focus-visible span { max-width: 120px; }
      @media (prefers-reduced-motion: reduce) { a, span { transition: none; } }
      @media print { a { display: none; } }
    </style>
    <a href="${home}" title="Back to Sandbox" aria-label="Back to Sandbox">
      <img src="${mark}" alt="">
      <span aria-hidden="true">Sandbox</span>
    </a>`;

  const mount = () => document.body.appendChild(host);
  document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
})();
