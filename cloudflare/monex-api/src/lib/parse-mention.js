/** Parse tweet text for catch intent (thread reply vs @mention). */

export const MIN_CATCH_SPEND = 1;
export const MAX_CATCH_SPEND = 50;
export const CATCH_DENOMINATIONS = Array.from(
  { length: MAX_CATCH_SPEND - MIN_CATCH_SPEND + 1 },
  (_, i) => i + MIN_CATCH_SPEND
);

export function normalizeTweetText(text) {
  return (text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidCatchSpend(n) {
  return Number.isInteger(n) && n >= MIN_CATCH_SPEND && n <= MAX_CATCH_SPEND;
}

/**
 * Detect catch keywords anywhere in a sentence.
 * Priority: highest explicit catch N wins; bare catch defaults to 1.
 */
export function parseCatchIntent(clean) {
  const text = (clean || "").toLowerCase();
  if (!/\bcatch\b/i.test(text)) return { type: "ignore" };

  const matches = [...text.matchAll(/\bcatch\b\s*(\d+)(?:\s+monanimals?)?\b/gi)];
  if (matches.length > 0) {
    let best = null;
    let invalidRaw = null;
    for (const match of matches) {
      const spend = Number.parseInt(match[1], 10);
      if (isValidCatchSpend(spend)) {
        best = best === null ? spend : Math.max(best, spend);
      } else if (invalidRaw === null) {
        invalidRaw = match[1];
      }
    }
    if (best !== null) return { type: "catch", spend: best };
    if (invalidRaw !== null) return { type: "invalid_denom", raw: invalidRaw };
  }

  if (/\bcatch\b(?!\s*\d)/i.test(text)) {
    return { type: "catch", spend: MIN_CATCH_SPEND };
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
 *   { type: 'catch', spend: 1..50 }
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
    `Reply on my post: catch / catch 1 / catch 1 monanimal (1 Monball default)\n` +
    `Anywhere else: @monexmonad catch … (same keywords)\n` +
    `Spend 1–50 Monballs: catch 1 / catch 10 / catch 50`
  );
}

export function invalidDenomReply(username) {
  return (
    `@${username} Invalid amount. Use 1–50 Monballs.\n` +
    `Example: catch 5 or @monexmonad catch 30`
  );
}

export function insufficientReply(username, have, need) {
  return `@${username} Not enough Monballs (have ${have}, need ${need}). Min to play: 1.`;
}
