# Deploy MonEx API to Cloudflare (free)

Host the **X Wild Log** + auto Party/Box sync on Cloudflare Workers ($0 tier).  
Your game files can stay on **GitHub Pages** (also free).

---

## What you need

- A [Cloudflare](https://dash.cloudflare.com) account (free)
- [Node.js](https://nodejs.org) installed on your computer (for one-time deploy)

---

## Step 1 — Install Wrangler (one time)

Open **PowerShell** or **Terminal**:

```bash
npm install -g wrangler
wrangler login
```

A browser opens — log in to Cloudflare.

---

## Step 2 — Create KV storage

```bash
cd cloudflare/monex-api
npm install
npx wrangler kv namespace create MONEX_KV
```

Copy the **id** from the output. Open `wrangler.toml` and replace:

```
id = "REPLACE_WITH_KV_ID"
```

with your real id.

---

## Auto-deploy from GitHub (manual only)

After KV id is in `wrangler.toml`, set **GitHub repository secrets** (see deploy guide).

Deploy when ready:

1. GitHub → **Actions** → **Deploy Cloudflare API** → **Run workflow**

Or locally: `npx wrangler deploy` in `cloudflare/monex-api/`

**Game-only changes** do not need a Cloudflare deploy. **API changes** (`cloudflare/monex-api/`) — deploy when you batch updates.

Local testing: [docs/local-test-workflow.html](../docs/local-test-workflow.html)

---

## Step 4 — Point the game at Cloudflare

Open `js/monex-config.js` and set:

```js
window.MONEX_API = "https://monex-api.YOURNAME.workers.dev";
```

(Replace with your real workers.dev URL.)

---

## Step 5 — GitHub Pages (free website)

1. GitHub repo → **Settings** → **Pages**
2. Source: **Deploy from branch** → `main` → `/ (root)`
3. Save

Your site: `https://jericddd.github.io/MonEx/home.html`

---

## Done — hosting is Cloudflare + GitHub Pages

Game: GitHub Pages. API: Cloudflare Worker (auto-deploy from GitHub Actions).
If you still have an old MonEx project on railway.app, delete it in the Railway dashboard to stop billing.

---

## Test simulate catch (PowerShell)

```powershell
Invoke-RestMethod -Uri "https://monex-api.YOURNAME.workers.dev/api/simulate-mention" -Method POST -ContentType "application/json" -Body '{"text":"@monexmonad catch 10 monanimals","username":"jeric"}'
```

Then open game → **Profile** → save `jeric` → mons auto-sync to **Party** / **Box**.

---

## Live X later (optional, costs money)

In Cloudflare dashboard → Workers → **monex-api** → **Settings** → **Variables**:

Add secrets:
- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

Set variable `ENABLE_X_POLL` = `1`

Cron runs every 2 minutes automatically.

---

## API endpoints

| URL | Purpose |
|-----|---------|
| `GET /api/health` | Status check |
| `GET /api/activity` | X Wild Log |
| `POST /api/simulate-mention` | Test catch |
| `POST /api/sync` | Auto Party/Box |

---

## Admin scripts (production KV)

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (GitHub Actions secrets for the workflows below).

| Script / Action | Purpose |
|-----------------|---------|
| **Actions → Grant Monballs** | Grant Monballs to catch state + cloud save |
| **Actions → Backfill pending catches** | Push stuck X pending catches into cloud saves |
| **Actions → Recover activity catches** | Rebuild mons from X Wild Log when pending queue is empty |
| **Actions → Backfill quest rewards** | Deliver missing quest rewards via Mailbox |
| **Actions → Send mailbox reward** | Send custom Gold / KB's Onion / Monball mail to one or all users |
| `node scripts/grant-monballs.mjs <user> [amount]` | Same as Grant Monballs workflow (local) |
| `node scripts/backfill-pending-catches.mjs [--dry-run] [user]` | Same as Backfill workflow (local) |
| `node scripts/recover-activity-catches.mjs [--dry-run] [--spend N] <user>` | Same as Recover workflow (local) |

**Backfill pending catches** (GitHub — recommended):

1. Repo → **Actions** → **Backfill pending catches** → **Run workflow**
2. Leave **Preview only** checked, set **confirm** to `PREVIEW`
3. Leave **username** empty for all users, or enter the exact handle from the X Wild Log (case-sensitive, e.g. `Lucci_Crypto`)
4. Review the JSON log in the job output (`hint.pendingUsernames` lists exact spellings if filter misses)
5. Uncheck **Preview only**, set **confirm** to `BACKFILL`, run again to apply

Local CLI (optional):

```bash
cd cloudflare/monex-api
npm run backfill-pending -- --dry-run          # preview all affected users
npm run backfill-pending -- --dry-run jericddd # preview one user
npm run backfill-pending                       # apply for all users with pending mons
npm run backfill-pending -- jericddd           # apply for one user
```

The script moves `pendingMons` from catch state into each user's cloud save Party/Box (up to 3 party / 500 box slots), aligns in-game Monballs with catch-state balances, merges duplicate `sim_*` catch rows, and clears the pending queue for backfilled users.

**Recover activity catches** (when backfill finds 0 pending but X Wild Log shows catches):

1. Repo → **Actions** → **Recover activity catches** → **Run workflow**
2. **username:** exact handle from X Wild Log (e.g. `Lucci_Crypto`)
3. **spend (optional):** e.g. `18` to recover only that Catch 18 session — leave empty to recover all sessions for the user
4. Preview with **Preview only** on, **confirm** = `PREVIEW`
5. Apply with **Preview only** off, **confirm** = `RECOVER`

Rebuilds mons from activity log entries into cloud save Party/Box and sets Monballs from the latest log entry. Skills are regenerated (species/rarity match the log; RNG skills may differ slightly).

**Backfill quest rewards** (when users claimed daily/weekly/campaign quests or milestone chests but did not receive resources):

1. Repo → **Actions** → **Backfill quest rewards** → **Run workflow**
2. Leave **username** empty to scan all cloud saves, or set one handle to target a single user
3. Preview with **Preview only** on, **confirm** = `PREVIEW`
4. Apply with **Preview only** off, **confirm** = `BACKFILL`

Delivers missing rewards as a bundled **Quest Reward Recovery** mail item (claim in-game Mailbox). Marks `questState.grantedKeys` so rewards are not duplicated. Local equivalent:

```bash
npm run backfill-quest-rewards -- --dry-run
npm run backfill-quest-rewards -- --dry-run jericddd
npm run backfill-quest-rewards -- jericddd
```

**Send mailbox reward** (custom compensation or event mail):

1. Repo → **Actions** → **Send mailbox reward** → **Run workflow**
2. **title:** mail subject shown in-game (e.g. `Sorry for the mailbox bug`)
3. **resource:** `gold`, `kbs_onion`, or `monball`
4. **quantity:** amount granted when the user claims the mail in Mailbox
5. **username:** leave empty for all users, or set one handle (without `@`)
6. Preview with **Preview only** on, **confirm** = `PREVIEW`
7. Apply with **Preview only** off, **confirm** = `SEND`

Users must open **Mailbox** in-game and tap **Claim** to receive the resources. Local equivalent:

```bash
npm run send-mailbox-reward -- --title "Compensation" --resource monball --quantity 5 --dry-run messedupmental
npm run send-mailbox-reward -- --title "Compensation" --resource monball --quantity 5 messedupmental
```
