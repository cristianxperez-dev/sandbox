# NMSBSBL — Pitching Intelligence (V1)

A pitcher-focused app in CP Sandbox: directory → pitcher profile (Overview · Arsenal) → interactive break chart.

- **URL:** `https://cperez.app/apps/nmsbsbl/`
- **Access:** behind one shared access code.

```
apps/nmsbsbl/                 the app (static; no framework, no build step)
  index.html  app.js          shell, routing (#/ · #/p/<MLBAM id>[/arsenal][?s=<season>]), directory, profile
  chart.js                    the break chart (SVG)
  core.js                     Statcast CSV → pitches → arsenal (pure; unit-tested)
  app.css  favicon.svg  logo.png
  lib/                        reused unchanged from AGORA: headshots.js/.css, pitch-types.js, age-core.js
functions/apps/nmsbsbl/api/   data endpoints (behind the gate)
  _shared.js                  the covered pitchers (MLBAM ids only), edge-cache helper
  roster.js                   GET api/roster?season=       directory (MLB Stats API, one batched call)
  pitcher.js                  GET api/pitcher?id=          profile + year-by-year MLB pitching
  pitches.js                  GET api/pitches?id=&season=  the pitcher's Statcast season (Baseball Savant CSV, passed through)
access-gate/nmsbsbl-page.js   the branded access screen
nmsbsbl/tests/                core.test.mjs (unit), app.e2e.cjs (end to end), harness.cjs (local server: real gate + real functions)
```

## Design system

A light, editorial performance-brand look:
- **Ground:** bone `#F4EFE6`.
- **Accents:** cream, sand and taupe (`#E9DCC3`, `#C9B38E`, `#9C8F81`).
- **Text:** ink `#141210`.
- **Colour:** no bright colours in the interface. Colour is reserved for pitch types (AGORA's palette).

**Type:**
- Anton: condensed uppercase display.
- Space Mono: labels, numbers and notes.
- Space Grotesk: UI text.
- Syncopate: the wide-tracked wordmark only.

**Mark:** a sand ball with its seams, cut by one ink movement vector.

Tokens live at the top of `apps/nmsbsbl/app.css`. The access screen (`access-gate/nmsbsbl-page.js`) uses the same values.

## Access code

The app uses the Sandbox's existing per-app gate (`access-gate/`). Its entry in `access-gate/apps.js` has:

- id `nmsbsbl`
- secret name `NMSBSBL_ACCESS_CODE`
- a branded page
- no Manager Hub test header

### Where the code lives

Cloudflare → Workers & Pages → the cperez.app Pages project (`sandbox`) → Settings → Variables and Secrets.

- Add **`NMSBSBL_ACCESS_CODE`** as type **Secret**, for **Production and Preview**, then redeploy.
- `SANDBOX_SESSION_SECRET` is already set and shared by every protected app.

### Behaviour

- **Checked on the server:**
  - Compared in constant time, trimmed, not case-sensitive.
  - The code is never in the page, the repository, or any log.
- **Session:** cookie `sbx_nmsbsbl`.
  - HttpOnly, Secure, SameSite=Lax, `Path=/apps/nmsbsbl/`.
  - Lasts 15 days from sign-in and survives reloads.
  - Opens NMSBSBL only.
- **Sign out:** the header's **Sign out** goes to `/apps/nmsbsbl/access/logout`.
- **Rate limit:** each wrong code is delayed 0.7 s. Five failures from one IP in 10 minutes lock that IP out for 15 minutes.
- **Everything is protected:** pages, scripts and `api/*` all require the session.
  - Direct profile links (`#/p/…`) load the app page, which the gate protects, so they cannot bypass sign-in.
  - Without a session, pages redirect to the access screen and other files answer 401.
- **Fails closed:** without the secret the app answers 503 ("Access isn't configured yet"). It is never open.
- **Changing the code:** edit the secret and redeploy. This signs everyone out.
- **Retrieving the code:** Cloudflare doesn't show a secret again after it is saved, so keep it in your password manager. If it's lost, set a new one.

## Data

| What | Source | How |
|---|---|---|
| Player identity: name, team, throwing hand, birth date (decimal age), number, height and weight | MLB Stats API (`statsapi.mlb.com`) | By MLBAM id at request time; edge-cached 6 h |
| Season lines (G, GS, IP, ERA, WHIP, K%, BB%, K/9, SV) | MLB Stats API | Regular season, MLB only. K% and BB% are computed from strikeouts or walks ÷ batters faced |
| Pitch-level data: type, velocity, movement, spin, axis, release, extension, arm angle, result | Baseball Savant Statcast search CSV | One pitcher-season per request, on demand. Edge-cached 30 days for a past season, 12 h for the current one. The last good copy is served, marked stale, if Savant is down |
| Photos | MLB's official headshots (`img.mlbstatic.com`) | Requested by MLBAM id through AGORA's headshot module: transparent cut-out first, then the standard portrait, then initials |

**Conventions** (AGORA's, unchanged):
- **Induced vertical break** = 12 × pfx_z.
- **Horizontal break** = −12 × pfx_x, **from the pitcher's view**: + is toward third base, never mirrored. For a right-hander + is arm side; for a left-hander + is glove side, and the chart labels the sides for each pitcher.
- **Release side** = −release_pos_x.
- Pitch codes are Statcast's; names and colours come from AGORA's palette, which displays the sweeper (ST) as SW.
- Pitchouts and intentional balls are excluded. A value Statcast didn't record stays missing; nothing is estimated.

**Verified:** for Paul Skenes' 2026 season, pitch counts, usage and whiff % per pitch type match Baseball Savant's own pitch-arsenal leaderboard exactly.

**Terms:** public MLB data, © MLB Advanced Media. MLBAM's notice allows individual, non-commercial, non-bulk use; NMSBSBL fetches one pitcher-season at a time, behind an access code. No data is committed to this repository.

## Covered pitchers (V1)

20 MLB pitchers, 11 right-handed and 9 left-handed, listed by id in `functions/apps/nmsbsbl/api/_shared.js`. The endpoints answer only for these ids, so the app can't be used as an open proxy. To add a pitcher, add his MLBAM id there and deploy.

## Tests

```bash
node --test nmsbsbl/tests/core.test.mjs                                    # parsing, conventions, arsenal, gate rules, endpoint limits
node scripts/build.mjs && NODE_USE_ENV_PROXY=1 node nmsbsbl/tests/app.e2e.cjs   # 53 checks through the real gate + functions (SHOTS=dir for screenshots)
```

## Not in V1

TrackMan, CSV uploads, bullpens, biomechanics, video, notes, portals, plans, advance reports, AI and models.
