# MonEx

Monad-themed Monanimal battler. Live site: **https://monexmonad.xyz/**

## If the live site shows 404

This usually happens after the GitHub repo was private and made public again — **GitHub Pages gets turned off**.

1. Open **Settings → Pages** on this repo
2. **Source:** GitHub Actions *or* branch `main` / folder `/ (root)`
3. **Custom domain:** `monexmonad.xyz` (already in `CNAME`)
4. Save and wait ~1–2 minutes

Pushes to `main` run the **Deploy GitHub Pages** workflow when Actions is the Pages source.

## Branches

- `main` — live game (GitHub Pages)
- `staging` — preview at **https://monex.pages.dev/** (Cloudflare Pages project `monex`)
