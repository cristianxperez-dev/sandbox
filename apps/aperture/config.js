/* APERTURE deployment mode.
   "local"  — public beta: no sign-in; content from data/content.json; scoring and progress run in
              this browser (local.js). This is the current mode.
   "server" — secure accounts: Cloudflare Access sign-in, D1 storage, server-side grading via
              api/ (functions/apps/aperture/api). Requires the owner setup in aperture/README.md. */
window.APERTURE_CONFIG = { mode: 'local' };
(function () {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  window.__apertureLocal = { promise, resolve, reject };
  if (window.APERTURE_CONFIG.mode === 'local') {
    const s = document.createElement('script');
    s.type = 'module'; s.src = 'local.js';
    document.head.appendChild(s);
  }
})();
