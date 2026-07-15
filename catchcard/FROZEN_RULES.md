# CatchCard — Frozen Rules (v1)

**Status:** FROZEN for hackathon v1. Do not change without bumping `RULES_VERSION`.

These rules are mirrored in `shared/rules.js` and enforced by the bot + contract.

---

## Product

- **CatchCard** is an X (Twitter) bot. Players **mint** collectible card NFTs on **Monad testnet**.
- **No game website is required to play.** Gameplay = public replies on X.
- **No battles.** Mint → flex → optional feed (Tamagotchi-lite).

---

## Commands (X)

| Command | Syntax | Purpose |
|---------|--------|---------|
| `help` | `@CatchCard help` | List commands |
| `link` | `@CatchCard link 0x…` | Bind Monad wallet to X account |
| **`mint`** | **`@CatchCard mint`** | Roll + mint NFT + reply PNG |
| `mint` + hint | `@CatchCard mint spark` | Mint with optional species hint |
| `feed` | `@CatchCard feed <tokenId>` | +happiness (owner only) |
| `status` | `@CatchCard status <tokenId>` | Show card stats |

**Primary verb is `mint`, not `catch`.**

---

## Wallet

- User must **`link`** a valid `0x` address (42 chars) before first mint.
- One wallet per X account (first link wins until admin reset).
- Bot wallet pays mint gas (relayer); user does not send tx to mint in v1.

---

## Mint limits

| Rule | Value |
|------|-------|
| Free mints per wallet per UTC day | **3** |
| Cooldown between mints (same X account) | **5 minutes** |
| Duplicate tweet processing | **Never** (idempotent by tweet id) |

---

## Roll table (off-chain roll, on-chain stored)

| Rarity | Weight | BPS |
|--------|--------|-----|
| Common | 700 | 7000 |
| Uncommon | 200 | 2000 |
| Rare | 80 | 800 |
| Legendary | 20 | 200 |

Roll: uniform 0–9999, cumulative weights above.

---

## Species (8)

| ID | Name | Hint keyword |
|----|------|--------------|
| 0 | Spark | `spark` |
| 1 | Byte | `byte` |
| 2 | Glitch | `glitch` |
| 3 | Prism | `prism` |
| 4 | Volt | `volt` |
| 5 | Moss | `moss` |
| 6 | Dusk | `dusk` |
| 7 | Flux | `flux` |

**Species hint:** If user passes a valid hint on `mint`, **30%** chance to use that species if the mint succeeds; otherwise random species.

---

## NFT card (on-chain)

Each mint creates **ERC-721 token** with:

| Field | Range / notes |
|-------|----------------|
| `speciesId` | 0–7 |
| `rarity` | 0=Common, 1=Uncommon, 2=Rare, 3=Legendary |
| `happiness` | Starts **70**, max **100** |
| `mintDay` | UTC day index (Unix days since epoch) |
| `xHandleHash` | `keccak256(lowercase handle without @)` |

---

## Feed (Tamagotchi-lite)

| Rule | Value |
|------|-------|
| Happiness per feed | **+10** |
| Max happiness | **100** |
| Feeds per token per UTC day | **1** |
| Who can feed | Token owner only (on-chain `msg.sender`) |

Feed is optional in demo; rules are frozen for v1 implementation.

---

## Bot reply (mint success)

Must include:

1. Text: `MINTED! {Species} · {Rarity} · #{tokenId}`
2. Happiness line
3. Monad testnet explorer link (when tx available)
4. PNG card image attachment

---

## Out of scope (v1 — do not add during hackathon)

- Battles, PvP, levels, XP
- Shop, paid mints, ERC-20 payments
- Full game client / `/play` link in replies
- MonEx assets, species names, or code copy
- Mainnet deploy (testnet only for v1)

---

## Version

- **RULES_VERSION:** `1`
- **Frozen date:** 2026-07-15
