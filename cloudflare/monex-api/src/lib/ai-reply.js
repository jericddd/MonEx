import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  buildNaturalInsufficientReply,
  getReplySeed,
} from "./natural-reply.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

function extractAiText(response) {
  if (!response) return null;
  if (typeof response === "string") return response.trim();
  if (typeof response.response === "string") return response.response.trim();
  if (typeof response.result === "string") return response.result.trim();
  if (response.choices?.[0]?.message?.content) return response.choices[0].message.content.trim();
  return null;
}

function buildCatchFacts({ username, monballSpend, results, monballsLeft }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  return {
    username,
    monballSpend,
    monballsLeft,
    caughtNames: caught.map((r) => r.mon.name),
    escapedNames: escaped.map((r) => r.name),
    caughtCount: caught.length,
    escapedCount: escaped.length,
    throwCount: results.length,
  };
}

function buildAiPrompt(kind, facts) {
  const rules =
    "Write ONE X reply under 270 characters. Sound like a friendly human game bot, not a template. " +
    "Use ONLY the facts below — never invent mons or numbers. No URLs/hashtags. " +
    'End with a soft invite like "visit the site to play".';

  if (kind === "catch") {
    return `${rules}

Facts:
- Player: @${facts.username}
- Monballs spent: ${facts.monballSpend}
- Throws: ${facts.throwCount}
- Caught (${facts.caughtCount}): ${facts.caughtNames.join(", ") || "none"}
- Escaped (${facts.escapedCount}): ${facts.escapedNames.join(", ") || "none"}
- Monballs left: ${facts.monballsLeft}

Start with @${facts.username}. Mention caught AND escaped mons by name when relevant.`;
  }

  if (kind === "invalid_denom") {
    return `${rules}

Facts:
- Player: @${facts.username}
- Problem: invalid Monball amount
- Valid amounts: 10, 20, 30, 40, 50

Start with @${facts.username}.`;
  }

  return `${rules}

Facts:
- Player: @${facts.username}
- Has ${facts.have} Monballs, needs ${facts.need}
- Minimum to play: 10 Monballs

Start with @${facts.username}.`;
}

export async function tryAiMentionReply(result, tweet, env) {
  if (env.ENABLE_AI_REPLY !== "1" || !env.AI) return null;

  const model = env.AI_REPLY_MODEL || DEFAULT_MODEL;
  let kind = null;
  let facts = null;
  const seed = getReplySeed(tweet);

  if (result.activity) {
    kind = "catch";
    facts = buildCatchFacts({
      username: tweet.username || "player",
      monballSpend: result.activity.spend,
      results: result.catchResults || [],
      monballsLeft: result.activity.monballsLeft,
    });
  } else if (result.skipReason === "invalid_denom") {
    kind = "invalid_denom";
    facts = { username: tweet.username || "player" };
  } else if (result.skipReason === "insufficient") {
    kind = "insufficient";
    facts = {
      username: tweet.username || "player",
      have: result.monballs ?? 0,
      need: result.parsed?.spend ?? 10,
    };
  } else {
    return null;
  }

  try {
    const response = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content:
            "You are @monexmonad, the MonEx wild catch bot on X. Keep replies short, warm, and specific.",
        },
        { role: "user", content: buildAiPrompt(kind, facts) },
      ],
      max_tokens: 120,
      temperature: 0.9,
    });

    const text = extractAiText(response);
    if (!text) return null;
    const withMention = text.startsWith("@") ? text : `@${facts.username} ${text}`;
    return withMention.replace(/\s+/g, " ").trim().slice(0, 280);
  } catch (err) {
    console.warn("[ai-reply]", err.message || err);
    if (kind === "catch") {
      return buildNaturalCatchReply({ ...facts, results: result.catchResults || [], seed });
    }
    if (kind === "invalid_denom") {
      return buildNaturalInvalidDenomReply(facts.username, seed);
    }
    return buildNaturalInsufficientReply(facts.username, facts.have, facts.need, seed);
  }
}
