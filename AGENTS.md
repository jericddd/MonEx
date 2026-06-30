# MonEx

A browser-based monster-collecting game ("Monanimals"). It is a fully static,
client-side site — plain HTML/CSS/JS with no build step, no package manager, and
no backend server. All game state is stored in the browser via `localStorage`.

## Cursor Cloud specific instructions

### Running the app (dev)

There are no dependencies to install and nothing to build. Serve the repo root
with any static HTTP server and open it in a browser:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/` (it redirects to `home.html`).

- `index.html` → redirects to `home.html` (landing page).
- `home.html` → landing page. Click **LOGIN WITH X** (a mock login that sets a
  random `Player####` user), then **GAME START** to enter the game.
- `monanimal_game.html` → the actual game (PARTY / BOX / BATTLE / CATCH /
  INVENTORY tabs).
- `monanimal-game-phaser3/index.html` → a separate standalone Phaser 3 sprite
  test (`phaser.min.js` is vendored in that folder).

### Non-obvious gotchas

- **Must serve over HTTP, not `file://`.** Asset/font paths and navigation
  assume an HTTP origin.
- **Login is required to reach the game.** `monanimal_game.html` reads
  `localStorage["monex_current_user"]` and redirects back to `home.html` if it
  is missing. The "Login with X" flow is a mock — it just writes a random
  username to `localStorage`; there is no real OAuth/backend.
- **All progress is per-user in `localStorage`** under keys like
  `monex_<username>`, `monex_current_user`, and `monex_current_stage`. Clearing
  browser storage resets the game.
- **No lint, test, or build tooling exists** in this repo. There is no
  `package.json` (it is intentionally gitignored), no test runner, and no CI on
  this branch. Validation is done by serving the site and exercising it in a
  browser.
