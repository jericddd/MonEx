# CatchCard

**Mint NFT collectible cards on X.** Reply `@CatchCard mint` → bot rolls rarity, mints on **Monad testnet**, and replies with a PNG card.

No game website required. Primary verb is **`mint`**, not catch.

## Frozen rules

All gameplay limits and tables live in [`FROZEN_RULES.md`](./FROZEN_RULES.md) (`RULES_VERSION = 1`).

Implementation mirrors:

| Layer | Path |
|-------|------|
| Docs | `FROZEN_RULES.md` |
| Bot roll / parse | `shared/rules.js` |
| On-chain | `contracts/src/CatchCard.sol` |

## Repo layout

```
catchcard/
├── FROZEN_RULES.md      # frozen v1 spec
├── shared/rules.js      # parse, roll, limits (Node + Worker)
├── contracts/           # Foundry — CatchCard ERC-721
└── bot/                 # Cloudflare Worker — X mentions
```

## Commands (X)

| Command | Example |
|---------|---------|
| Help | `@CatchCard help` |
| Link wallet | `@CatchCard link 0x…` |
| **Mint** | `@CatchCard mint` |
| Mint + hint | `@CatchCard mint spark` |
| Feed | `@CatchCard feed 42` (on-chain) |
| Status | `@CatchCard status 42` |

## Quick start

### Tests

```bash
cd catchcard
npm run test:rules
npm run test:contracts
# or both:
npm test
```

### Contracts

```bash
cd catchcard/contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
forge test
forge script script/Deploy.s.sol --rpc-url $MONAD_RPC --broadcast
```

Set `DEPLOYER_ADDRESS` and `MINTER_ADDRESS` (bot wallet) in env.

### Bot (local)

```bash
cd catchcard/bot
npm install
npm run dev
```

Simulate a mention:

```bash
curl -X POST http://localhost:8787/simulate \
  -H 'content-type: application/json' \
  -d '{"text":"@CatchCard mint spark","authorId":"demo","username":"demo"}'
```

Wire secrets before production:

- `CATCHCARD_KV` namespace id in `wrangler.toml`
- `CATCHCARD_CONTRACT` after deploy
- X API credentials (`wrangler secret put …`)
- Bot minter private key (`MINTER_PRIVATE_KEY`)

## v1 scope

**In:** wallet link, mint (3/day, 5m cooldown), PNG reply, on-chain feed  
**Out:** battles, shop, `/play` link, MonEx IP

## License

MIT
