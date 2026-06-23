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
