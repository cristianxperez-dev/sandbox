# access-gate — per-application access codes on cperez.app

Some Sandbox apps need their own access code. Manager Hub is the first. The gate runs as a Cloudflare Pages Function
(`functions/_middleware.js`) in front of every request; `site/_routes.json` includes `/*` for that reason. Requests
outside a protected app pass straight through, so other apps are served exactly as before.

| File | What it is |
| --- | --- |
| `apps.js` | The protected apps: id, name, base path, the name of its access-code secret, public files |
| `app-gate.js` | The gate: login page, session cookie, rate limit, path normalisation |
| `../functions/_middleware.js` | Wires the gate into Cloudflare Pages |
| `../scripts/strip-protected.mjs` | Leaves protected apps out of the GitHub Pages mirror (it has no Functions) |
| `tests/gate.test.mjs` | Unit tests with placeholder secrets: `node --test access-gate/tests/gate.test.mjs` |

## Secrets (Cloudflare → the cperez.app Pages project → Settings → Variables and Secrets)

| Name | Type | Value |
| --- | --- | --- |
| `SANDBOX_SESSION_SECRET` | Secret | Random, at least 32 characters, e.g. `openssl rand -base64 48`. Shared by every protected app. |
| `MANAGER_HUB_ACCESS_CODE` | Secret | Manager Hub's code. |
| `NMSBSBL_ACCESS_CODE` | Secret | NMSBSBL's code (`nmsbsbl/README.md`). |

Set them for **Production and Preview**. Without them a protected app answers 503 (fails closed); other apps are unaffected.
Changing a code signs out that app's users; changing `SANDBOX_SESSION_SECRET` signs out everyone. Never commit either.

## Per-app options (`apps.js`)

- `accessPage(fields)` — the app's own branded access screen. It gets escaped fields only and posts the same form. NMSBSBL uses this (`nmsbsbl-page.js`).
- `signoutLink: false` — don't inject the floating Sign out link; the app has its own.
- `headerKey: true` — also accept the code in `X-MH-Access-Key` for proxied smoke tests. Only Manager Hub opts in.

## How it behaves

- `/apps/<app>/access/` login page (Sandbox colours and type, the app's own logo). `POST …/access/login` checks the
  code. `…/access/logout` signs out; a small **Sign out** link is added to the app's pages.
- Session cookie `sbx_<app>`: `v1.<expiry>.<HMAC>`, valid 15 days from sign-in. The expiry is fixed and never renewed.
  The key is derived from the session secret, the app id and its code, so a cookie opens one app only.
  `HttpOnly; Secure; SameSite=Lax; Path=/apps/<app>/`.
- The code is compared in constant time, trimmed and case-insensitive (as on cpbaseball.com).
- Each failure is delayed 0.7 s; 5 failures in 10 minutes from one IP locks that IP out for 15 minutes. The lockout is
  per Cloudflare isolate, so a WAF rate-limiting rule on `POST /apps/*/access/login` is a useful backstop.
- Signed out: pages redirect to the login page, every other file gets 401. Protected responses are
  `Cache-Control: private, no-store` and `noindex`.
- Paths are fully percent-decoded, normalised and lower-cased before matching. Any non-canonical variant of a protected
  path (`%65`, `..%2f`, `//`, backslashes, upper case) is refused with 400, never served. Public files (the homepage card
  logo) are listed per app.

## Protecting another app

1. Add an entry to `apps.js`, e.g. `{ id: "fuel", name: "FUEL", base: "/apps/fuel/", codeSecret: "FUEL_ACCESS_CODE", publicFiles: ["/apps/fuel/logo.png"] }`.
2. Add the secret `FUEL_ACCESS_CODE` in Cloudflare (Production and Preview) **before** deploying.
3. Deploy. The GitHub Pages mirror drops the app automatically.

## Limits

The gate protects the hosted app. The app's source is in this repository, which is public, and old Cloudflare
deployments made before an app was protected stay reachable at their unique `*.pages.dev` URLs until deleted.
