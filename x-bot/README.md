# MonEx X Activity (POC)

Catch on **X** via `@monexmonad catch 10 monanimals` — **no replies for now**. Successful catches are logged to a real-time activity feed on the home page and a personal log in the game **Profile** tab.

Uses [twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) (Node.js), not Tweepy.

---

## Catch rules (X wild)

| Rule | Value |
|------|--------|
| Trigger | Mention bot + word **`catch`** |
| Min balance | **10** Monballs |
| Spend options | **10, 20, 30, 40, 50** only |
| Per throw | **10** Monballs = 1 catch roll |
| Catch rate | 95% (same as browser game) |
| No valid catch | Skipped (not shown in activity log) |

**Examples:**
- `@monexmonad catch` → spends **10** Monballs, 1 throw
- `@monexmonad catch 10 monanimals` → same as above
- `@monexmonad catch 20` → 2 throws

New X users get **10** Monballs (POC default — exactly 1 catch; change in `.env`).

---

## Quick test (no X API)

```bash
cd x-bot
npm install
npm run server
```

Open **http://localhost:3001/home.html** — the **X WILD LOG** sidebar polls `/api/activity`.

Simulate a mention:

```bash
curl -X POST http://localhost:3001/api/simulate-mention \
  -H "Content-Type: application/json" \
  -d '{"text":"@monexmonad catch 10 monanimals","username":"jeric"}'
```

In the game, open **Profile**, save your X handle (`jeric`), and your personal log appears.

---

## Live X ingest (optional)

1. [developer.x.com](https://developer.x.com) → Project + App with **Read** (write not required while replies are off)
2. Copy OAuth 1.0a keys into `.env`
3. Start server with polling:

```bash
ENABLE_X_POLL=1 npm run server
```

Or run the standalone poller:

```bash
npm run poll
```

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/activity?limit=30` | Global feed (successful catches only) |
| `GET /api/activity/mine?username=you` | Personal feed by X @handle |
| `GET /api/pending?username=you` | Mons waiting to claim in game |
| `POST /api/claim` | Claim body: `{ "username": "you" }` |
| `POST /api/simulate-mention` | Test body: `{ "text", "username" }` |
| `GET /api/health` | Server status |

The server also serves `home.html` and `monanimal_game.html` from the repo root.

---

## Storage

| File | Purpose |
|------|---------|
| `data/state.json` | Monball balances, pending mons, processed tweet IDs |
| `data/activity.json` | Activity log entries (global + personal feeds) |

Later: **X OAuth** on the website links accounts and claims `pendingMons`.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run server` | HTTP server + static files + optional X poll |
| `npm run poll` | Standalone X mention poller (log only) |
| `npm run test-parse` | Test message parsing |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Home feed says "server offline" | Run `npm run server` in `x-bot/` |
| Personal log empty | Save matching X @handle in game Profile tab |
| No live mentions | Set `ENABLE_X_POLL=1` and valid `.env` keys |
| 429 rate limit | Increase `POLL_MS` in `.env` |
