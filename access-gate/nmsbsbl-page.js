/* NMSBSBL — branded access screen, rendered by the gate (app-gate.js) before any app file is served.
   Inputs are already HTML-escaped by the gate. No script, no external image: the mark is inline SVG.
   Form fields and messages are the gate's own (POST <base>access/login, fields "code" and "next"). */

/** The NMSBSBL mark: a ball's seam pair, cut by one movement vector. Shared with the app (apps/nmsbsbl/brand.js). */
export const NMSBSBL_MARK = `<svg class="mk" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<circle cx="24" cy="24" r="20.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
<path d="M12.4 9.6c5.2 4.1 7.9 9 7.9 14.4s-2.7 10.3-7.9 14.4M35.6 9.6c-5.2 4.1-7.9 9-7.9 14.4s2.7 10.3 7.9 14.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
<path d="M14 33.5 33.2 14.3" stroke="#C8B48C" stroke-width="2.6" stroke-linecap="round"/><circle cx="33.6" cy="13.9" r="3.1" fill="#C8B48C"/></svg>`;

export function nmsbsblAccessPage({ action, next, message, error, configured }) {
  const css = `:root{--ink:#0E1012;--ink2:#171A1D;--line:#2A2E33;--bone:#EFEAE0;--muted:#8D9198;--sand:#C8B48C;--err:#E0A39A}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#1A1E22 0%,var(--ink) 60%) fixed;color:var(--bone);
font:15px/1.5 Inter,system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:360px;text-align:center}
.mk{width:56px;height:56px;color:var(--bone);display:block;margin:0 auto 22px}
h1{margin:0;font:800 30px/1 Archivo,Inter,sans-serif;font-stretch:118%;letter-spacing:.24em;padding-left:.24em}
.sub{margin:12px 0 34px;font:500 11px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.32em;text-transform:uppercase;color:var(--sand);padding-left:.32em}
form{display:flex;flex-direction:column;gap:12px}
label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
input{height:50px;border:1px solid var(--line);border-radius:6px;background:var(--ink2);color:var(--bone);padding:0 16px;font:500 15px Inter,sans-serif;
letter-spacing:.14em;text-align:center;transition:border-color .15s}
input::placeholder{color:#5D6268;letter-spacing:.08em}
input:focus{outline:none;border-color:var(--sand);box-shadow:0 0 0 3px rgba(200,180,140,.16)}
input[aria-invalid=true]{border-color:#7A4A44}
button{height:50px;border:0;border-radius:6px;background:var(--bone);color:var(--ink);font:700 13px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:background .15s}
button:hover{background:#FFFFFF}button:focus-visible{outline:2px solid var(--sand);outline-offset:2px}
.err{margin:2px 0 0;min-height:20px;font-size:13px;color:var(--err)}
.foot{margin-top:40px;font:500 10.5px/1.6 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#5D6268}
.note{color:var(--muted);font-size:14px;margin:0}`;
  const form = configured
    ? `<form method="post" action="${action}" autocomplete="off">
<label for="code">Access code</label>
<input id="code" type="password" name="code" placeholder="Access code" autocomplete="current-password" required autofocus${error === "wrong" ? ' aria-invalid="true" aria-describedby="err"' : ""}>
<input type="hidden" name="next" value="${next}">
<button type="submit">Continue</button>
<p class="err" id="err" role="alert">${message}</p></form>`
    : `<p class="note" role="alert">${message}</p>`;
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NMSBSBL — Pitching Intelligence</title><meta name="robots" content="noindex"><meta name="theme-color" content="#0E1012">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,700..800&family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@500&display=swap">
<style>${css}</style></head><body><main>${NMSBSBL_MARK}<h1>NMSBSBL</h1><div class="sub">Pitching Intelligence</div>${form}
<div class="foot">Authorized access only</div></main></body></html>`,
  };
}
