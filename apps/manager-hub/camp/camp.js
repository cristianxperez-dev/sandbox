/* Manager Hub — Camp view (placeholder; being built). */
(function () { window.CampUI = { show(host) { if (host && !host.dataset.ready) { host.dataset.ready = "1"; host.innerHTML = '<p style="padding:24px">Camp is being built.</p>'; } } }; })();
