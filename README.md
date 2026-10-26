# Sandbox by Cristian Perez

An evolving collection of ideas, experiments, and applications: a static website that holds a directory of personal apps. Each app lives in its own folder and has its own address.

- **Homepage:** a searchable, filterable gallery of every app, generated from one registry file.
- **Apps:** each one is a self-contained folder (`apps/<id>/`) served at `/apps/<id>/`. Plain HTML, CSS and JavaScript work as they are, with no rewrite and no framework.
- **Hosting:** GitHub Pages, deployed by GitHub Actions on every push to `main`.
- **Dependencies:** none. Node.js 20+ runs a ~300-line build script, and nothing needs to be installed.

---

## 1. How the project is organized

```
sandbox/
├── apps/
│   ├── registry.json          ← the list of apps (the only file you edit to add/remove one)
│   └── <app-id>/              ← one folder per app, copied to the site untouched
│       ├── index.html         ← the app itself (missing → a placeholder page is generated)
│       ├── logo.png|svg|webp  ← its logo (optional, picked up automatically)
│       └── …                  ← any other files the app needs
├── site/                      ← the Sandbox shell
│   ├── index.html             ← homepage template (cards are filled in at build time)
│   ├── 404.html
│   ├── assets/brand/          ← Sandbox logo, monogram, favicons, social-share image
│   ├── assets/css/sandbox.css
│   ├── assets/js/directory.js       ← search & filters
│   ├── assets/js/sandbox-return.js  ← the small "back to Sandbox" button inside apps
│   └── templates/placeholder.html   ← page shown for apps that aren't integrated yet
├── brand/                     ← original logo file (source only, not published)
├── scripts/
│   ├── build.mjs              ← builds everything into _site/
│   ├── check.mjs              ← verifies every link and image in _site/ resolves
│   └── serve.mjs              ← local preview server that behaves like GitHub Pages
├── sandbox.config.json        ← site name, copy, categories, statuses
├── CLAUDE.md                  ← step-by-step playbook Claude Code follows when adding apps
└── .github/workflows/deploy.yml
```

**Why a tiny build step instead of a framework?** The homepage cards are rendered into plain HTML at build time, so the page loads fast, works without JavaScript, and is readable by link previews. Apps are copied byte-for-byte, so existing standalone HTML projects keep working exactly as they did. Only the `_site/` output is published. Sources, scripts, the original logo and docs never go live.

**Why every link is relative:** pages link with paths like `apps/recollect/` and `../../assets/…` and never `/apps/…`. As a result, the same build works at `cristianxperez-dev.github.io/sandbox/` today and at `yourdomain.com/` later.

## 2. How deployment works

1. You push to `main` (directly or by merging a pull request).
2. `.github/workflows/deploy.yml` runs: it asks GitHub Pages for the site's real URL, runs `scripts/build.mjs` with it, runs `scripts/check.mjs`, and uploads `_site/`.
3. GitHub Pages publishes it. The URL appears on the workflow run and under **Settings → Pages**.

**One-time setup:** in the repository on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. (GitHub Pages on a private repository requires a paid GitHub plan. On a free plan, the repository must be public.)

You can also re-deploy without a code change from **Actions → Deploy Sandbox → Run workflow**.

## 3. Running locally

```bash
npm run dev          # build, then serve at http://localhost:4173/sandbox/
npm run check        # build, then verify every page, link and image
```

The preview server mimics GitHub Pages: it uses the same `/sandbox/` sub-path, the same trailing-slash redirects, and the same 404 page. Anything that works locally will work when deployed. To preview the future custom-domain layout instead, run `BASE_PATH=/ npm run dev` and open `http://localhost:4173/`.

No `npm install` is needed. If you don't have npm, `node scripts/build.mjs && node scripts/serve.mjs` does the same thing.

## 4. Adding a new application

The easiest way is to tell Claude Code:

> Add this HTML application to Sandbox. Here's the file and its logo.

Claude follows `CLAUDE.md`. To do it by hand:

1. **Pick an id.** Use lowercase letters and hyphens, for example `trip-planner`. The app's URL becomes `/apps/trip-planner/`.
2. **Create the folder** `apps/trip-planner/` and put the app's main page in it as `index.html`, along with any CSS, JS and images it uses.
3. **Add the logo** as `apps/trip-planner/logo.png` (or `.svg`, `.webp`, `.jpg`).
4. **Register it** by adding an entry to `apps/registry.json`:

   ```json
   {
     "id": "trip-planner",
     "name": "Trip Planner",
     "description": "One or two sentences that make someone want to open it.",
     "category": "Travel",
     "status": "prototype"
   }
   ```

5. Run `npm run check`, preview with `npm run dev`, then commit and push to `main`.

### Registry fields

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Folder name and URL slug. Lowercase letters, numbers, hyphens. |
| `name` | yes | Display name. |
| `description` | yes | Short line shown on the card and placeholder page. Also searchable. |
| `category` | yes | One of the categories in `sandbox.config.json`. |
| `status` | yes | `available`, `in-development`, or `prototype`. This is informational only and never blocks access. |
| `featured` | no | `true` shows the app as a wide card at the top of the unfiltered gallery. |
| `logo` | no | Logo filename inside the app folder. Usually unnecessary because `logo.svg/.webp/.png/.jpg` is detected automatically. |
| `logoBackground` | no | Colour behind the logo on the card, e.g. `"#1d2a38"`, so a logo can sit on its own brand colour. |
| `logoFit` | no | `"cover"` makes the image fill the whole card panel (for artwork or screenshots). The default `"contain"` keeps the full logo visible. |
| `updated` | no | `"2026-10"` or `"2026-10-26"`, shown as "Updated Oct 2026". |
| `tags` | no | Extra search words, e.g. `["recipes", "dinner"]`. |
| `returnLink` | no | Where the "back to Sandbox" button sits: `"bottom-left"` (default), `"bottom-right"`, `"top-left"`, `"top-right"`, or `false` to leave it out. |
| `hidden` | no | `true` removes the app from the gallery while keeping its URL working. This is **not** privacy (see Security). |

The order of entries in the registry is the order of the gallery, with featured apps placed first.

New categories go in the `categories` list in `sandbox.config.json`.

## 5. Replacing a placeholder with the real app

An app without an `index.html` in its folder automatically gets an "Awaiting integration" page and an *Awaiting integration* card. To bring it in:

1. Copy the app's HTML into `apps/<id>/index.html`, and its other files next to it.
2. Change any links that start with `/` (like `/style.css`) to relative ones (`style.css`). `npm run check` lists any that remain.
3. Set its `status` in the registry if it changed.
4. Check, preview and push. The card switches to **Launch** on its own.

## 6. Changing an app's logo or description

- **Logo:** replace the file in `apps/<id>/` with a new `logo.*`. If you switch formats, delete the old file, or set `"logo"` explicitly. Keep logos under ~1000px on the longest side. SVG or WebP is ideal. Transparent backgrounds and any aspect ratio work, and the image is never stretched.
- **Description, name, category, status:** edit the entry in `apps/registry.json`.
- **Homepage copy, categories, status labels, GitHub link:** edit `sandbox.config.json` (the hero sentence comes from `tagline`) or `site/index.html`.

## 7. Updating or removing an app

- **Update:** replace files inside `apps/<id>/` and push. The URL stays the same.
- **Remove:** delete its entry from `apps/registry.json` and delete the `apps/<id>/` folder. The old URL will then show the Sandbox 404 page.
- **Unlist but keep the link working:** set `"hidden": true`.

## 8. Connecting a custom domain later

Nothing in the code needs to change, because all links are relative and the deploy workflow reads the real URL from GitHub.

1. Buy the domain.
2. On GitHub: **Settings → Pages → Custom domain**. Enter it (e.g. `sandboxdomain.com`) and save. GitHub shows the DNS records to create. For a root domain, these are four `A` records to GitHub's IPs and optionally `AAAA` records. For `www`, it's a `CNAME` to `cristianxperez-dev.github.io`.
3. Add those records at your registrar and wait for the DNS check to pass.
4. Tick **Enforce HTTPS** once it's available.
5. Re-run the deploy (**Actions → Deploy Sandbox → Run workflow**) so share previews and the sitemap use the new address.

With GitHub Actions deployments, you don't need a `CNAME` file in the repository. The setting in **Settings → Pages** is what counts. Optionally, set `"siteUrl"` in `sandbox.config.json` to the new address so local builds also use it.

Old `github.io/sandbox/…` links are redirected to the custom domain by GitHub automatically.

## Security & privacy

GitHub Pages sites are **public**. Every file in `apps/` is downloadable by anyone, whether listed, hidden, or labelled prototype. So:

- Never commit API keys, passwords, tokens, personal data, or anything confidential, including inside an app's JavaScript.
- `hidden` and statuses are for presentation only. They are not access control.
- An app that needs logins, a database, or private server-side processing needs separate infrastructure (for example a hosted backend). Sandbox can link to it, but it can't host the private parts.

## Things apps should know

- **Shared storage:** all apps share one web origin, so `localStorage`, `sessionStorage`, IndexedDB and cookies are shared between them. Use app-specific key names (e.g. `recollect:people`, not `data`). Claude checks for this when integrating an app.
- **Styles and scripts are isolated:** each app is its own page, so its CSS and JS never touch the homepage or other apps. The injected "back to Sandbox" button lives in a shadow DOM, so it can't affect an app's styles either.
