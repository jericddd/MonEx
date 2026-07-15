# CatchCard contracts

Foundry project for the CatchCard ERC-721 on Monad testnet.

## Setup

```bash
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
```

## Test & deploy

```bash
forge test
DEPLOYER_ADDRESS=0x... MINTER_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url $MONAD_RPC --broadcast
```

`MINTER_ADDRESS` is the bot wallet that calls `mintCard()`.

Rules: see [`../FROZEN_RULES.md`](../FROZEN_RULES.md) (`RULES_VERSION = 1`).
