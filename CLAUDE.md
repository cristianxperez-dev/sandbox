# Sandbox: notes for Claude Code

Static site. `apps/registry.json` drives the homepage, `apps/<id>/` holds each app, and `node scripts/build.mjs` writes `_site/`. No dependencies and no framework. Keep it that way unless the owner asks otherwise. README.md has the full reference.

## Standard pattern: the app has its own repository

Most apps live in their own GitHub repository and their own Claude Code conversation. Keep it that way. Never copy their source into Sandbox.

1. Attach the app repository read-only and inspect the deployable output exactly as in step 1 of the playbook below. If something needs changing there (root-absolute paths, a Vite `base`, generic storage keys), tell the owner. That change belongs in the app's repository, not here.
2. Add or update its registry entry with `"source": { "repo": "owner/name", "ref": "main" }`, plus `path`/`build`/`exclude` if needed (README §5). Reuse an existing id so the URL doesn't change.
3. Put only Sandbox-side extras in `apps/<id>/`, normally the card `logo.png`. If the logo only exists embedded in the app, extract it unchanged.
4. Run `node scripts/fetch-apps.mjs && node scripts/build.mjs && node scripts/check.mjs`, then do the Playwright checks in step 6 below.
5. If the repository is private, the deploy needs the `APP_SOURCES_TOKEN` secret (fine-grained, Contents: read-only). The owner creates it, never you. Never put a token in any file.
6. Commit, push to `main`. Redeploys after app updates: Actions → Deploy Sandbox → Run workflow.

## Playbook: "Add this HTML application to Sandbox" (a one-off file with no repository of its own)

1. **Inspect the app before moving it.**
   - Find every external file it loads: `<link>`, `<script src>`, `<img>`, `fetch()`, `url(...)` in CSS, fonts, JSON, service workers, manifests.
   - Root-absolute paths (`/style.css`, `/api/...`) break under the `/sandbox/` sub-path. Make them relative.
   - Look for API keys, tokens, personal data, or private endpoints. **Stop and tell the owner** before publishing anything sensitive. The site is public.
   - Check `localStorage`/`sessionStorage`/IndexedDB/cookie keys. All apps share one origin, so generic keys (`data`, `items`, `state`, `settings`) can collide with another app. If you find any, point them out and ask whether to prefix them (`<id>:data`). Don't silently rename keys in an app that already holds a user's saved data.
   - Note anything that needs a server (auth, databases, secrets). Tell the owner it needs separate infrastructure.
2. **Choose the id.** Use lowercase-hyphenated, matching the app's name (e.g. `replated-recipes`). If a registry entry or placeholder already exists for the app, reuse that id so its URL doesn't change.
3. **Place the files** in `apps/<id>/`, with the main page as `index.html`. Preserve the app's own HTML, CSS, JS and branding. Change only what step 1 requires.
4. **Add the logo** as `apps/<id>/logo.<ext>`. If it's a large raster, resize it to ≤1000px on the longest side, and use WebP where that keeps quality. Never redraw or restyle a supplied logo. With no logo, leave it out and the initials fallback is shown.
5. **Register it** in `apps/registry.json`, or update the existing entry. Pick a `discipline` from `sandbox.config.json` (and `alsoIn` only if a second one genuinely applies). Add a new discipline there only if none fits and the owner agrees. Keep `description` to one sentence of 10–20 words. Consider `logoBackground` if the logo was designed for a coloured backdrop.
6. **Verify.** Run `node scripts/build.mjs && node scripts/check.mjs` and fix anything reported. Then serve with `node scripts/serve.mjs` (`http://localhost:4173/`) and use Playwright to:
   - load the homepage and confirm the entry sits in alphabetical order and shows **Launch** and the logo,
   - click through to `/apps/<id>/`,
   - reload that URL directly and confirm no console errors and no failed requests,
   - check that the app works and the back-to-Sandbox button doesn't cover its controls. If it does, set `returnLink` to another corner or `false`.
7. **Ship.** Commit with a message like `Add <Name> to Sandbox` and push. Pushing to `main` deploys.
8. **Report** the app's live URL (`<site>/apps/<id>/`) and anything that needs the owner's attention.

## Conventions

- Every link in Sandbox-owned pages is relative. Never introduce `/`-rooted URLs, because the check script rejects them.
- `site/` is the shell and `apps/` is the content. Don't put app files in `site/` or Sandbox styles in apps.
- The Sandbox logo files in `site/assets/brand/` come from `brand/sandbox-logo-original.webp`. Don't redesign them.
- Palette: cream `#FCF9F3`, charcoal `#2A2826`, graphite `#595552`. Type: Cormorant Garamond (display) and Inter (UI). No bright accents in the shell. Apps keep their own colours.
- Keep the MVP spirit: no backend, no framework, no npm dependencies, unless the owner asks.
