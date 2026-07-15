import { LIMITS, COMMANDS, MINT_VERB } from "../../shared/rules.js";

export function helpText() {
  return [
    "CatchCard — mint NFT cards on Monad testnet",
    "",
    "Commands:",
    "  @CatchCard help",
    "  @CatchCard link 0x…",
    `  @CatchCard ${MINT_VERB}`,
    `  @CatchCard ${MINT_VERB} spark   (optional species hint)`,
    "  @CatchCard feed <tokenId>",
    "  @CatchCard status <tokenId>",
    "",
    `Limits: ${LIMITS.MINTS_PER_WALLET_PER_DAY} mints/wallet/day · ${LIMITS.MINT_COOLDOWN_MS / 60_000}m cooldown`,
    `Species: ${COMMANDS.includes("mint") ? "8" : "—"} · Rarity roll on mint`,
  ].join("\n");
}
