# Sandbox: notes for Claude Code

Static site. `apps/registry.json` drives the homepage, `apps/<id>/` holds each app, and `node scripts/build.mjs` writes `_site/`. No dependencies and no framework. Keep it that way unless the owner asks otherwise. README.md has the full reference.

## Playbook: "Add this HTML application to Sandbox"

1. **Inspect the app before moving it.**
   - Find every external file it loads: `<link>`, `<script src>`, `<img>`, `fetch()`, `url(...)` in CSS, fonts, JSON, service workers, manifests.
   - Root-absolute paths (`/style.css`, `/api/...`) break under the `/sandbox/` sub-path. Make them relative.
   - Look for API keys, tokens, personal data, or private endpoints. **Stop and tell the owner** before publishing anything sensitive. The site is public.
   - Check `localStorage`/`sessionStorage`/IndexedDB/cookie keys. All apps share one origin, so generic keys (`data`, `items`, `state`, `settings`) can collide with another app. If you find any, point them out and ask whether to prefix them (`<id>:data`). Don't silently rename keys in an app that already holds a user's saved data.
   - Note anything that needs a server (auth, databases, secrets). Tell the owner it needs separate infrastructure.
2. **Choose the id.** Use lowercase-hyphenated, matching the app's name (e.g. `replated-recipes`). If a registry entry or placeholder already exists for the app, reuse that id so its URL doesn't change.
3. **Place the files** in `apps/<id>/`, with the main page as `index.html`. Preserve the app's own HTML, CSS, JS and branding. Change only what step 1 requires.
4. **Add the logo** as `apps/<id>/logo.<ext>`. If it's a large raster, resize it to ≤1000px on the longest side, and use WebP where that keeps quality. Never redraw or restyle a supplied logo. With no logo, leave it out and the initials fallback is shown.
5. **Register it** in `apps/registry.json`, or update the existing entry. Pick a `category` from `sandbox.config.json`. Add a new category there only if none fits and the owner agrees. Set `status` honestly and `updated` to the current month. Consider `logoBackground` if the logo was designed for a coloured backdrop.
6. **Verify.** Run `node scripts/build.mjs && node scripts/check.mjs` and fix anything reported. Then serve with `node scripts/serve.mjs` (`http://localhost:4173/sandbox/`) and use Playwright to:
   - load the homepage and confirm the card shows **Launch** and the logo,
   - click through to `/sandbox/apps/<id>/`,
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
