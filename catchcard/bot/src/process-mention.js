import {
  parseMention,
  rollMint,
  isValidWallet,
  formatMintReply,
  normalizeHandle,
  speciesName,
  rarityLabel,
  LIMITS,
  MINT_VERB,
} from "../../shared/rules.js";
import {
  getLinkedWallet,
  linkWallet,
  getMintCooldownRemainingMs,
  setMintCooldown,
  getMintsToday,
  incrementMintsToday,
} from "./kv-store.js";
import { helpText } from "./help-text.js";
import { cardSvg } from "./card-image.js";
import { xHandleHash } from "./handle-hash.js";

function secureRoll() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % 10_000;
}

/**
 * @param {object} tweet { id, text, authorId, username }
 * @param {object} env Worker env (kv, contract address, explorer)
 */
export async function processMentionTweet(tweet, env) {
  const botHandle = env.BOT_USERNAME || "catchcard";
  const parsed = parseMention(tweet.text, botHandle);
  if (!parsed) {
    return { action: "ignore" };
  }

  const kv = env.CATCHCARD_KV;
  const xUserId = tweet.authorId;
  const username = tweet.username || tweet.authorId;

  switch (parsed.command) {
    case "help":
      return { action: "reply", text: helpText() };

    case "link": {
      const wallet = parsed.args[0];
      if (!isValidWallet(wallet)) {
        return { action: "reply", text: "Invalid wallet. Use: @CatchCard link 0x…" };
      }
      const result = await linkWallet(kv, xUserId, wallet.toLowerCase());
      if (!result.ok && result.reason === "already_linked") {
        return { action: "reply", text: "Wallet already linked for this account." };
      }
      return { action: "reply", text: `Linked ${wallet} ✓ You can now @CatchCard ${MINT_VERB}.` };
    }

    case "mint": {
      const wallet = await getLinkedWallet(kv, xUserId);
      if (!wallet) {
        return {
          action: "reply",
          text: `Link a wallet first: @CatchCard link 0x… then @CatchCard ${MINT_VERB}`,
        };
      }

      const cooldownMs = await getMintCooldownRemainingMs(kv, xUserId);
      if (cooldownMs > 0) {
        const mins = Math.ceil(cooldownMs / 60_000);
        return { action: "reply", text: `Cooldown active. Try again in ~${mins}m.` };
      }

      const mintsToday = await getMintsToday(kv, xUserId);
      if (mintsToday >= LIMITS.MINTS_PER_WALLET_PER_DAY) {
        return {
          action: "reply",
          text: `Daily mint limit reached (${LIMITS.MINTS_PER_WALLET_PER_DAY}/day). Resets at UTC midnight.`,
        };
      }

      const rollFn = () => secureRoll();
      const { speciesId, rarity } = rollMint(rollFn, parsed.args[0] || null);
      const handleHash = xHandleHash(normalizeHandle(username));

      const mintResult = await mintOnChain(env, {
        wallet,
        speciesId,
        rarity,
        handleHash,
      });

      if (!mintResult.ok) {
        return { action: "reply", text: mintResult.error || "Mint failed. Try again later." };
      }

      await incrementMintsToday(kv, xUserId);
      await setMintCooldown(kv, xUserId);

      const happiness = LIMITS.HAPPINESS_START;
      const explorer = env.MONAD_EXPLORER || "https://testnet.monadexplorer.com/tx";
      const txUrl = mintResult.txHash ? `${explorer}/${mintResult.txHash}` : null;

      return {
        action: "reply",
        text: formatMintReply({
          speciesId,
          rarity,
          tokenId: mintResult.tokenId,
          happiness,
          txUrl,
        }),
        cardSvg: cardSvg({
          speciesId,
          rarity,
          tokenId: mintResult.tokenId,
          happiness,
        }),
        mint: { speciesId, rarity, tokenId: mintResult.tokenId, wallet, handleHash },
      };
    }

    case "feed":
      return {
        action: "reply",
        text: "Feed is on-chain in v1. Connect wallet and call feed() on your CatchCard NFT.",
      };

    case "status": {
      const tokenId = parsed.args[0];
      if (!tokenId) {
        return { action: "reply", text: "Usage: @CatchCard status <tokenId>" };
      }
      return {
        action: "reply",
        text: `CatchCard #${tokenId} — query on-chain tokenURI for live stats.`,
      };
    }

    default:
      return { action: "reply", text: helpText() };
  }
}

async function mintOnChain(env, { wallet, speciesId, rarity, handleHash }) {
  if (!env.CATCHCARD_CONTRACT) {
    const tokenId = Math.floor(Math.random() * 1_000_000);
    return {
      ok: true,
      tokenId,
      txHash: null,
      simulated: true,
    };
  }

  // TODO: viem wallet client — bot minter calls mintCard(to, speciesId, rarity, xHandleHash)
  return {
    ok: false,
    error: "On-chain mint not wired yet. Set CATCHCARD_CONTRACT after deploy.",
  };
}

export function formatStatusPreview({ speciesId, rarity, tokenId, happiness }) {
  return `${speciesName(speciesId)} · ${rarityLabel(rarity)} · #${tokenId} · Happiness ${happiness}/${LIMITS.HAPPINESS_MAX}`;
}
