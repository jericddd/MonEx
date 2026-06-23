/** Parse @mention text for catch intent */

export const CATCH_DENOMINATIONS = [10, 20, 30, 40, 50];

export function normalizeTweetText(text) {
  return (text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns:
 *   { type: 'ignore' }
 *   { type: 'help' }
 *   { type: 'catch', spend: 10|20|30|40|50 }
 *   { type: 'invalid_denom', raw: string }
 */
export function parseMention(text, botUsername) {
  const clean = normalizeTweetText(text).toLowerCase();
  const bot = (botUsername || "monex").toLowerCase().replace("@", "");

  // Must mention the bot account
  if (!clean.includes(`@${bot}`)) {
    return { type: "ignore" };
  }

  if (!/\bcatch\b/i.test(clean)) {
    return { type: "ignore" };
  }

  // catch 10 | catch 10 monanimals | catch 20 monanimal
  const denomMatch = clean.match(/\bcatch\b\s*(\d+)?(?:\s+monanimals?)?/i);
  const raw = denomMatch?.[1];

  if (!raw) {
    return { type: "catch", spend: 10 };
  }

  const spend = parseInt(raw, 10);
  if (!CATCH_DENOMINATIONS.includes(spend)) {
    return { type: "invalid_denom", raw };
  }

  return { type: "catch", spend };
}

export function helpReply(username) {
  return (
    `@${username} MonEx Wild — tag me with a catch command:\n` +
    `@MonEx catch 10  (10–50 Monballs, steps of 10)\n` +
    `Min balance: 10 Monballs. Each 10 = 1 throw.\n` +
    `Example: "@MonEx catch 20" → 2 catches`
  );
}

export function invalidDenomReply(username) {
  return (
    `@${username} Invalid amount. Use 10, 20, 30, 40, or 50 Monballs.\n` +
    `Example: @MonEx catch 30`
  );
}

export function insufficientReply(username, have, need) {
  return `@${username} Not enough Monballs (have ${have}, need ${need}). Min to play: 10.`;
}
