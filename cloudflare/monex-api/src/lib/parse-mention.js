/** Parse tweet text for catch intent (thread reply vs @mention). */

export const CATCH_DENOMINATIONS = [10, 20, 30, 40, 50];
const HIGH_PRIORITY_DENOMS = [50, 40, 30, 20];

export function normalizeTweetText(text) {
  return (text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function highPriorityCatchRegex(denom) {
  return new RegExp(`\\bcatch\\b\\s*${denom}(?:\\s+monanimals?)?\\b`, "i");
}

/**
 * Detect catch keywords anywhere in a sentence.
 * Priority: catch 50/40/30/20 > catch 10 variants > bare catch (default 10).
 */
export function parseCatchIntent(clean) {
  const text = (clean || "").toLowerCase();
  if (!/\bcatch\b/i.test(text)) return { type: "ignore" };

  for (const denom of HIGH_PRIORITY_DENOMS) {
    if (highPriorityCatchRegex(denom).test(text)) {
      return { type: "catch", spend: denom };
    }
  }

  if (/\bcatch\b\s*10(?:\s+monanimals?)?\b/i.test(text)) {
    return { type: "catch", spend: 10 };
  }

  if (/\bcatch\b(?!\s*\d)/i.test(text)) {
    return { type: "catch", spend: 10 };
  }

  const invalid = text.match(/\bcatch\b\s*(\d+)/i);
  if (invalid?.[1]) {
    return { type: "invalid_denom", raw: invalid[1] };
  }

  return { type: "ignore" };
}

export function isReplyToBotTweet(tweet, botUserId) {
  if (!tweet?.inReplyToUserId || !botUserId) return false;
  return String(tweet.inReplyToUserId) === String(botUserId);
}

/**
 * Returns:
 *   { type: 'ignore' }
 *   { type: 'catch', spend: 10|20|30|40|50 }
 *   { type: 'invalid_denom', raw: string }
 *
 * Outside @monexmonad posts: requires @bot in the tweet.
 * Direct reply to @monexmonad: catch keywords alone are enough (no @ required).
 */
export function parseMention(text, botUsername, options = {}) {
  const clean = normalizeTweetText(text).toLowerCase();
  const bot = (botUsername || "monexmonad").toLowerCase().replace("@", "");
  const replyToBot = options.replyToBot === true;
  const mentionsBot = clean.includes(`@${bot}`);

  if (!replyToBot && !mentionsBot) {
    return { type: "ignore" };
  }

  return parseCatchIntent(clean);
}

export function helpReply(username) {
  return (
    `@${username} MonEx Wild — catch commands:\n` +
    `Reply on my post: catch / catch 10 / catch 10 monanimals (10 Monballs default)\n` +
    `Anywhere else: @monexmonad catch … (same keywords)\n` +
    `Higher spend: catch 20 / 30 / 40 / 50 Monballs`
  );
}

export function invalidDenomReply(username) {
  return (
    `@${username} Invalid amount. Use 10, 20, 30, 40, or 50 Monballs.\n` +
    `Example: catch 30 or @monexmonad catch 30`
  );
}

export function insufficientReply(username, have, need) {
  return `@${username} Not enough Monballs (have ${have}, need ${need}). Min to play: 10.`;
}
