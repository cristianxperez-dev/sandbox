# Sandbox by Cristian Perez

An evolving collection of ideas, experiments, and applications: a static website that holds a directory of personal apps. Each app lives in its own folder and has its own address.

- **Homepage:** an A–Z directory of every app with search and discipline filters, generated from one registry file.
- **Apps:** each one is served at `/apps/<id>/`. An app either lives in its own repository and is pulled in at deploy time (the standard pattern, see §5), or sits directly in `apps/<id>/`. Plain HTML, CSS and JavaScript work as they are, with no rewrite and no framework.
- **Hosting:** production is **cperez.app** on Cloudflare Pages, which builds from `main` (configured in the Cloudflare dashboard, not in this repository). The GitHub Actions workflow below also publishes the same build to GitHub Pages.
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
├── .sources/                  ← apps fetched from their own repositories (git-ignored, rebuilt every deploy)
├── scripts/
│   ├── fetch-apps.mjs         ← pulls apps that have a "source" repository into .sources/
│   ├── build.mjs              ← builds everything into _site/
│   ├── check.mjs              ← verifies every link and image in _site/ resolves
│   └── serve.mjs              ← local preview server that behaves like GitHub Pages
├── sandbox.config.json        ← site name, intro line, disciplines, statuses, public URL
├── CLAUDE.md                  ← step-by-step playbook Claude Code follows when adding apps
└── .github/workflows/deploy.yml
```

**Why a tiny build step instead of a framework?** The homepage cards are rendered into plain HTML at build time, so the page loads fast, works without JavaScript, and is readable by link previews. Apps are copied byte-for-byte, so existing standalone HTML projects keep working exactly as they did. Only the `_site/` output is published. Sources, scripts, the original logo and docs never go live.

**Why every link is relative:** pages link with paths like `apps/recollect/` and `../../assets/…` and never `/apps/…`. As a result, the same build works at `cristianxperez-dev.github.io/sandbox/` today and at `yourdomain.com/` later.

## 2. How deployment works

1. You push to `main` (directly or by merging a pull request).
2. `.github/workflows/deploy.yml` runs: it asks GitHub Pages for the site's real URL, pulls each app that lives in its own repository (`scripts/fetch-apps.mjs`), runs `scripts/build.mjs`, runs `scripts/check.mjs`, and uploads `_site/`. The run's summary page lists the exact commit of every pulled app.
3. GitHub Pages publishes it. The URL appears on the workflow run and under **Settings → Pages**.

**One-time setup:** in the repository on GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. (GitHub Pages on a private repository requires a paid GitHub plan. On a free plan, the repository must be public.)

You can also re-deploy without a code change from **Actions → Deploy Sandbox → Run workflow**.

## 3. Running locally

```bash
npm run fetch        # pull apps that live in other repositories (needed once, and after they change)
npm run dev          # build, then serve at http://localhost:4173/
npm run check        # build, then verify every page, link and image
```

The preview server behaves like the hosts: trailing-slash redirects, `index.html` folders and the custom 404 page, served from the root as on cperez.app. To check the GitHub Pages sub-path layout instead, run `BASE_PATH=/sandbox/ npm run dev` and open `http://localhost:4173/sandbox/`.

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
     "discipline": "Travel"
   }
   ```

5. Run `npm run check`, preview with `npm run dev`, then commit and push to `main`.

### Registry fields

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Folder name and URL slug. Lowercase letters, numbers, hyphens. |
| `name` | yes | Display name. |
| `description` | yes | One sentence, ideally 10–20 words, saying what the app does. Shown in the directory and searchable. |
| `discipline` | yes | The app's subject area: one of `disciplines` in `sandbox.config.json`. (Older entries may say `category`; it means the same thing.) |
| `alsoIn` | no | Extra disciplines, e.g. `["Travel"]`. The app also appears under those filters. |
| `status` | no | `available`, `in-development`, or `prototype`. Shown only on placeholder pages; never blocks access or changes the order. |
| `logo` | no | Logo filename inside the app folder. Usually unnecessary because `logo.svg/.webp/.png/.jpg` is detected automatically. |
| `logoBackground` | no | Colour behind the logo tile, e.g. `"#1d2a38"`, so a logo can sit on its own brand colour. |
| `logoFit` | no | `"cover"` makes the image fill the whole logo tile. The default `"contain"` keeps the full logo visible. |
| `tags` | no | Extra search words, e.g. `["recipes", "dinner"]`. |
| `returnLink` | no | Where the "back to Sandbox" button sits: `"bottom-left"` (default), `"bottom-right"`, `"top-left"`, `"top-right"`, or `false` to leave it out. |
| `hidden` | no | `true` removes the app from the gallery while keeping its URL working. This is **not** privacy (see Security). |

The directory is always alphabetical by name, regardless of the order of entries in the registry, so a new app lands in the right place on its own.

Disciplines live in the `disciplines` list in `sandbox.config.json`; renaming, adding or reordering them is a config change only. A discipline gets a filter button only once at least one app uses it, in the order the list gives.

## 5. Apps from other repositories (the standard pattern)

An app with its own repository and its own Claude Code conversation stays there. Sandbox never copies its source code into this repository. Instead, the registry entry names the repository, and every deploy pulls the chosen branch, tag or commit and publishes it at `/apps/<id>/`.

```json
{
  "id": "replated-recipes",
  "name": "Replated Recipes",
  …
  "source": {
    "repo": "cristianxperez-dev/replated",
    "ref": "main"
  }
}
```

| `source` field | Required | What it does |
|---|---|---|
| `repo` | yes | `owner/repository` on GitHub. |
| `ref` | no | Branch, tag, or full commit SHA to deploy. Defaults to `main`. Use a tag or SHA to pin a version. |
| `path` | no | Folder inside the repository that holds the finished site, e.g. `dist`. Defaults to the repository root. It must contain `index.html`. |
| `build` | no | Command run inside the checkout before publishing, e.g. `npm ci && npm run build`. Leave it out for plain HTML apps. |
| `exclude` | no | Top-level names in the deploy folder never to publish, e.g. `["research", "tools"]`. Dotfiles, `node_modules`, `package*.json`, `README.md` and `LICENSE` are always skipped. |

Rules that keep apps from interfering with each other:

- A fetched app is copied only into its own `apps/<id>/` folder.
- Sandbox-side extras for that app (usually just the card `logo.png`) go in `apps/<id>/` in this repository. The build stops if one would replace a file from the app's repository, and also if an app has both a `source` and its own `apps/<id>/index.html`.
- If an app can't be fetched or built, the deploy fails and the live site stays as it was. It is never silently replaced by a placeholder.

**Requirements for the app's repository:** the deployed `index.html` must use relative paths (`style.css`, `images/a.png`, never `/style.css`) so it works both under `/sandbox/` and on a custom domain. For build tools, that means a relative base, e.g. `base: "./"` in Vite. Hash-based routes (`#/recipe/…`) or real per-page folders both survive refreshes. Storage keys should carry the app's prefix (e.g. `replated:mode`).

### Redeploying after an app changes

Push to the app's own repository as usual, then in Sandbox go to **Actions → Deploy Sandbox → Run workflow**. Every run pulls the latest commit of each app's `ref`. If `ref` is a pinned tag or SHA, update it in the registry instead.

The workflow also accepts a `repository_dispatch` event of type `app-updated`. Later, an app repository can trigger the Sandbox redeploy automatically with a small workflow step that calls the GitHub API using a token allowed to dispatch to this repository.

### Private app repositories

Public repositories need nothing. For a private one:

1. On GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set **Resource owner** to `cristianxperez-dev`, then **Repository access → Only select repositories**, and pick the private app repositories.
3. Under **Repository permissions**, set **Contents: Read-only**. Metadata: Read-only is added automatically. Grant nothing else. Choose an expiry and set a reminder to renew it.
4. In the **Sandbox** repository, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `APP_SOURCES_TOKEN`, and paste the token.

The token is used only for the git fetch. It is never written to disk or published, and it is removed from the environment before any `build` command runs. One token can cover every private app; add repositories to it as needed.

To fetch private apps locally, run `APP_SOURCES_TOKEN=… npm run fetch`.

## 6. Replacing a placeholder with the real app

An app without an `index.html` (or a `source`) automatically gets an "Awaiting integration" page and an *Awaiting integration* card. If the app has its own repository, add a `source` as described in §5. To copy a one-off HTML file in directly instead:

1. Copy the app's HTML into `apps/<id>/index.html`, and its other files next to it.
2. Change any links that start with `/` (like `/style.css`) to relative ones (`style.css`). `npm run check` lists any that remain.
3. Update its `status` in the registry if it has one.
4. Check, preview and push. The card switches to **Launch** on its own.

## 7. Changing an app's logo or description

- **Logo:** replace the file in `apps/<id>/` with a new `logo.*`. If you switch formats, delete the old file, or set `"logo"` explicitly. Keep logos under ~1000px on the longest side. SVG or WebP is ideal. Transparent backgrounds and any aspect ratio work, and the image is never stretched.
- **Description, name, discipline:** edit the entry in `apps/registry.json`.
- **Intro line, disciplines, GitHub link:** edit `sandbox.config.json` (the line under "Applications" is `tagline`) or `site/index.html`.

## 8. Updating or removing an app

- **Update:** for an app from another repository, push there and re-run the deploy (§5). For an app stored here, replace files inside `apps/<id>/` and push. The URL stays the same.
- **Remove:** delete its entry from `apps/registry.json` and delete the `apps/<id>/` folder, if there is one. The old URL will then show the Sandbox 404 page.
- **Unlist but keep the link working:** set `"hidden": true`.

## 9. Connecting a custom domain later

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
