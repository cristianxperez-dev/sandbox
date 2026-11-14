/* NMSBSBL — branded access screen, rendered by the gate (app-gate.js) before any app file is served.
   Inputs are already HTML-escaped by the gate. No script, no external image: the mark is inline SVG.
   Form fields and messages are the gate's own (POST <base>access/login, fields "code" and "next").
   Light editorial system shared with the app (apps/nmsbsbl/app.css): bone ground, sand / taupe accents, ink text;
   Anton (condensed display) · Space Mono (labels) · Space Grotesk (UI) · Syncopate (wordmark only). */

/** The NMSBSBL mark: a sand ball with its seam pair, cut by one ink movement vector. Same drawing in apps/nmsbsbl/index.html. */
export const NMSBSBL_MARK = `<svg class="mk" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<circle cx="24" cy="24" r="19" fill="#C9B38E"/>
<path d="M13.5 10.8c4.6 3.6 7 8.1 7 13.2s-2.4 9.6-7 13.2M34.5 10.8c-4.6 3.6-7 8.1-7 13.2s2.4 9.6 7 13.2" fill="none" stroke="#F4EFE6" stroke-width="1.8" stroke-linecap="round"/>
<path d="M8 40 36.5 11.5" stroke="#141210" stroke-width="3.6" stroke-linecap="square"/><circle cx="38.5" cy="9.5" r="3.4" fill="#141210"/></svg>`;

export const NMSBSBL_FONTS = "https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Syncopate:wght@700&display=swap";

export function nmsbsblAccessPage({ action, next, message, error, configured }) {
  const css = `:root{--bone:#F4EFE6;--card:#FBF9F5;--line:#E2D9CA;--line2:#CFC3AE;--ink:#141210;--muted:#6E6559;--taupe:#9C8F81;--sand:#C9B38E;--cream:#E9DCC3;--err:#8C3B2E;
--display:Anton,"Oswald","Arial Narrow",sans-serif;--mono:"Space Mono",ui-monospace,monospace;--ui:"Space Grotesk",system-ui,sans-serif}
*{box-sizing:border-box}html,body{min-height:100%}
body{margin:0;background:var(--bone);color:var(--ink);font:15px/1.6 var(--ui);display:flex;flex-direction:column;min-height:100vh}
.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:26px clamp(20px,5vw,64px)}
.brand{display:flex;align-items:center;gap:14px}
.mk{width:38px;height:38px;flex:none}
.wm{font:700 17px/1 Syncopate,var(--ui);letter-spacing:.34em;margin-right:-.34em}
.tag{font:400 11px/1 var(--mono);letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
main{flex:1;display:flex;align-items:center;padding:24px clamp(20px,5vw,64px) 40px}
.in{width:100%;max-width:1040px}
h1{margin:0;font:400 clamp(64px,11.5vw,148px)/.9 var(--display);text-transform:uppercase;color:var(--taupe);letter-spacing:.005em}
.rule{width:min(560px,100%);height:2px;background:var(--taupe);margin:30px 0 22px;opacity:.75}
h2{margin:0;font:400 clamp(20px,2.4vw,26px)/1.1 var(--display);text-transform:uppercase;letter-spacing:.04em;color:var(--ink)}
.lede{margin:12px 0 30px;max-width:520px;font:400 13.5px/1.75 var(--mono);color:var(--muted)}
form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;max-width:560px}
label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
input{height:54px;border:1px solid var(--line2);border-radius:2px;background:var(--card);color:var(--ink);padding:0 18px;font:400 15px var(--mono);letter-spacing:.16em;transition:border-color .15s,box-shadow .15s}
input::placeholder{color:#A99E8F;letter-spacing:.2em;text-transform:uppercase;font-size:12px}
input:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 3px rgba(201,179,142,.35)}
input[aria-invalid=true]{border-color:var(--err)}
button{height:54px;border:0;border-radius:2px;background:var(--ink);color:var(--cream);padding:0 30px;font:700 12px var(--mono);letter-spacing:.24em;text-transform:uppercase;cursor:pointer;transition:background .15s}
button:hover{background:#2A2622}button:focus-visible{outline:2px solid var(--sand);outline-offset:3px}
.err{grid-column:1 / -1;margin:2px 0 0;min-height:22px;font:400 12.5px var(--mono);color:var(--err)}
.note{margin:0;max-width:520px;font:400 13.5px/1.7 var(--mono);color:var(--err)}
.foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:18px clamp(20px,5vw,64px) 26px;border-top:1px solid var(--line);font:400 10.5px/1.6 var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
@media (max-width:560px){.tag{display:none}.wm{font-size:15px}form{grid-template-columns:1fr}button{width:100%}.rule{margin:24px 0 18px}}`;
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
<title>NMSBSBL — Pitching Intelligence</title><meta name="robots" content="noindex"><meta name="theme-color" content="#F4EFE6">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${NMSBSBL_FONTS}">
<style>${css}</style></head><body>
<header class="bar"><div class="brand">${NMSBSBL_MARK}<span class="wm">NMSBSBL</span></div><span class="tag">Private access</span></header>
<main><div class="in"><h1>Pitching<br>Intelligence.</h1><div class="rule"></div><h2>Arsenals · Movement · Release</h2>
<p class="lede">Enter the access code to continue.</p>${form}</div></main>
<footer class="foot"><span>Authorized access only</span><span>NMSBSBL</span></footer></body></html>`,
  };
}
