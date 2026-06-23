# MonEx X Bot (POC)

Test **@mentions → catch reply** on X **before** adding a database.

Uses a **JSON file** (`data/state.json`) for:
- Monball balance per X user
- Pending caught mons (for future website claim)
- Processed tweet IDs (no double replies)

**Not** Tweepy — uses [twitter-api-v2](https://github.com/PLhery/node-twitter-api-v2) (Node.js).

---

## Catch rules (X wild)

| Rule | Value |
|------|--------|
| Trigger | Mention bot + word **`catch`** |
| Min balance | **10** Monballs |
| Spend options | **10, 20, 30, 40, 50** only |
| Per throw | **10** Monballs = 1 catch roll |
| Catch rate | 95% (same as browser game) |
| No `catch` word | Bot sends **help** reply |

**Examples:**
- `@MonEx catch` → spends **10** Monballs, 1 throw
- `@MonEx catch 20` → 2 throws
- `@MonEx catch 50` → 5 throws

New X users get **50** Monballs (POC default, change in `.env`).

---

## Setup (one time)

### 1. X Developer Portal

1. Go to [developer.x.com](https://developer.x.com) → create a **Project + App**
2. App permissions: **Read and write**
3. Generate **OAuth 1.0a** keys for the **bot account**
4. Copy: API Key, API Secret, Access Token, Access Token Secret

### 2. Install & configure

```bash
cd x-bot
cp .env.example .env
# Edit .env with your keys and BOT_USERNAME
npm install
```

### 3. Dry run (no posts to X)

```bash
npm run dry-run
```

Post a test mention from another account, watch the terminal for the reply text.

### 4. Go live

```bash
npm start
```

Keep this terminal open (or deploy to Railway/Fly.io later).

---

## Test on X

From a **different** account, post:

```
@YourBotUsername catch
```

or

```
@YourBotUsername catch 20
```

Within ~45 seconds the bot should **reply** with catch results.

---

## What gets stored (JSON, not DB)

`data/state.json` example:

```json
{
  "processedTweetIds": ["123..."],
  "users": {
    "987654321": {
      "username": "player1",
      "monballs": 40,
      "pendingMons": [{ "name": "Mouch", "rarity": "Rare", "skills": [...] }]
    }
  }
}
```

Later: **X login** on the website reads `pendingMons` by X user id.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Poll mentions & reply |
| `npm run dry-run` | Log replies only |
| `npm run test-parse` | Test message parsing |

---

## Limits & next steps

- **POC only** — JSON file is not safe for thousands of users
- **Polling** every 45s (upgrade to filtered stream on paid tier)
- **No X OAuth on website yet** — pending mons sit in JSON
- **Phase 2:** Postgres + X login + claim flow

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 403 on tweet | App needs **Read+Write**; regenerate tokens after permission change |
| No mentions | Confirm you @mentioned the **bot** account, not your personal one |
| 429 rate limit | Increase `POLL_MS` or reduce test volume |
| Wrong username | Set `BOT_USERNAME` in `.env` |
