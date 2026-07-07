import {
  buildCatchSummaryFields,
  formatRaritySummary,
  pickHighlightMons,
} from "./catch-summary.js";

export const DEFAULT_DAILY_REPLY_LIMIT = 4;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function buildCatchContext({ username, monballSpend, results, monballsLeft, repliesLeftAfter, dailyLimit, seed }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  const summary = buildCatchSummaryFields(caught, escaped, seed);

  return {
    u: username,
    spend: monballSpend,
    caughtN: caught.length,
    escapedN: escaped.length,
    total: results.length,
    left: monballsLeft,
    allEscaped: caught.length === 0,
    allCaught: escaped.length === 0,
    repliesLeftAfter: repliesLeftAfter ?? null,
    dailyLimit: dailyLimit ?? DEFAULT_DAILY_REPLY_LIMIT,
    ...summary,
  };
}

function appendReplyQuotaFooter(message, repliesLeftAfter, dailyLimit, seed = 0) {
  if (repliesLeftAfter == null || dailyLimit == null) return message;

  if (repliesLeftAfter <= 0) {
    const closers = [
      `that's your last @ reply today (0/${dailyLimit}). catch still logged — Profile → X log in game.`,
      `no @ replies left today (0/${dailyLimit}). you're good though, catch is saved. Profile → X log.`,
      `out of @ replies for today (0/${dailyLimit}). rng still ran — check Profile → X log when you sync.`,
    ];
    return `${message} ${pick(closers, seed)}`;
  }

  const footers = [
    `${repliesLeftAfter}/${dailyLimit} @ replies left today.`,
    `@ replies today: ${repliesLeftAfter}/${dailyLimit} left.`,
    `(${repliesLeftAfter}/${dailyLimit} @ replies left today)`,
  ];
  return `${message} ${pick(footers, seed)}`;
}

export const CATCH_REPLY_TEMPLATE_SAMPLES = [
  "@player {spend} balls in → {raritySummary} ({caughtN}/{total}). {highlights} carried. {escapedNote}. {left} Monballs left.",
  "@player that {spend}-ball session cooked — {raritySummary}. eyes on {highlights}. {escapedNote}.",
  "@player rng was kind-ish: {raritySummary} off {spend}. standouts → {highlights}. {escapedNote}.",
  "@player pulled {raritySummary} ({caughtN}/{total}). fwiw {highlights} are the keepers. {escapedNote}.",
  "@player {spend} Monballs → {raritySummary}. lowkey watch {highlights}. {escapedNote}. {left} remaining.",
  "@player field report: {raritySummary}, {caughtN}/{total}. {highlights} > the rest imo. {escapedNote}.",
  "@player threw {spend}, walked away with {raritySummary}. {highlights} might be it. {escapedNote}.",
  "@player respectable haul — {raritySummary}. {highlights} are the headline. {escapedNote}. {left} in the bag.",
  "@player {caughtN}/{total} stuck: {raritySummary}. peep {highlights} when you sync. {escapedNote}.",
  "@player not bad for {spend} balls — {raritySummary}. {highlights} look proper. {escapedNote}.",
  "@player {raritySummary} from a {spend}-ball rip. {highlights} stood out. {escapedNote}. {left} Monballs on you.",
  "@player ok this one hits — {raritySummary} ({caughtN}/{total}). {highlights}. {escapedNote}. sync when you're back.",
];

const MIXED_CATCH_TEMPLATES = [
  (c) =>
    `@${c.u} ${c.spend} balls in → ${c.raritySummary} (${c.caughtN}/${c.total}). ${c.highlights} carried. ${c.escapedNote}. ${c.left} Monballs left.`,
  (c) =>
    `@${c.u} that ${c.spend}-ball session cooked — ${c.raritySummary}. eyes on ${c.highlights}. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} rng was kind-ish: ${c.raritySummary} off ${c.spend}. standouts → ${c.highlights}. ${c.escapedNote}. ${c.left} on you.`,
  (c) =>
    `@${c.u} pulled ${c.raritySummary} (${c.caughtN}/${c.total}). fwiw ${c.highlights} are the keepers. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} ${c.spend} Monballs → ${c.raritySummary}. lowkey watch ${c.highlights}. ${c.escapedNote}. ${c.left} remaining.`,
  (c) =>
    `@${c.u} field report: ${c.raritySummary}, ${c.caughtN}/${c.total}. ${c.highlights} > the rest imo. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} threw ${c.spend}, walked away with ${c.raritySummary}. ${c.highlights} might be it. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} respectable haul — ${c.raritySummary}. ${c.highlights} are the headline. ${c.escapedNote}. ${c.left} in the bag.`,
  (c) =>
    `@${c.u} ${c.caughtN}/${c.total} stuck: ${c.raritySummary}. peep ${c.highlights} when you sync. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} not bad for ${c.spend} balls — ${c.raritySummary}. ${c.highlights} look proper. ${c.escapedNote}.`,
  (c) =>
    `@${c.u} ${c.raritySummary} from a ${c.spend}-ball rip. ${c.highlights} stood out. ${c.escapedNote}. ${c.left} Monballs.`,
  (c) =>
    `@${c.u} ok this one hits — ${c.raritySummary} (${c.caughtN}/${c.total}). ${c.highlights}. ${c.escapedNote}. sync when you're back.`,
];

const ALL_CAUGHT_TEMPLATES = [
  (c) =>
    `@${c.u} clean ${c.spend}-ball sweep — ${c.raritySummary}, ${c.caughtN}/${c.total} hooked. ${c.highlights} ate. ${c.left} Monballs left.`,
  (c) =>
    `@${c.u} perfect rip. ${c.raritySummary}, nothing escaped. ${c.highlights} are the ones. ${c.left} remaining.`,
  (c) =>
    `@${c.u} flawless session tbh — ${c.raritySummary}. all ${c.caughtN} landed. ${c.highlights} > everything else.`,
];

const ALL_ESCAPED_TEMPLATES = [
  (c) =>
    `@${c.u} brutal — ${c.escapedN}/${c.total} slipped (${c.spend} balls gone). ${c.left} Monballs left. rng hates us sometimes.`,
  (c) =>
    `@${c.u} oof, ${c.spend} Monballs and nothing stuck. ${c.escapedList} said no every time. ${c.left} left in the bag.`,
  (c) =>
    `@${c.u} wild took the W this round. ${c.escapedNote}. still got ${c.left} Monballs — run it back when ready.`,
];

const INVALID_DENOM_LINES = [
  (u) => `@${u} that amount doesn't fly — catches are 10, 20, 30, 40, or 50 Monballs`,
  (u) => `@${u} need a valid stack: 10 / 20 / 30 / 40 / 50 Monballs only`,
  (u) => `@${u} nah — we do catches in tens up to 50 Monballs`,
];

const INSUFFICIENT_LINES = [
  (u, have, need) => `@${u} you're light on Monballs (${have}/${need}). need at least 10 to run a catch.`,
  (u, have, need) => `@${u} not enough Monballs rn — ${have} on you, ${need} needed.`,
  (u, have, need) => `@${u} can't rip that yet (${have} Monballs, need ${need}).`,
];

export function buildNaturalCatchReply({
  username,
  monballSpend,
  results,
  monballsLeft,
  seed = 0,
  repliesLeftAfter,
  dailyLimit = DEFAULT_DAILY_REPLY_LIMIT,
}) {
  const ctx = buildCatchContext({
    username,
    monballSpend,
    results,
    monballsLeft,
    repliesLeftAfter,
    dailyLimit,
    seed,
  });
  let pool = MIXED_CATCH_TEMPLATES;
  if (ctx.allEscaped) pool = ALL_ESCAPED_TEMPLATES;
  else if (ctx.allCaught) pool = ALL_CAUGHT_TEMPLATES;
  const body = pick(pool, seed)(ctx);
  return appendReplyQuotaFooter(body, repliesLeftAfter, dailyLimit, seed + 1)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

export function buildDailyLimitNoticeReply(username, dailyLimit = DEFAULT_DAILY_REPLY_LIMIT, seed = 0) {
  const lines = [
    (u, limit) =>
      `@${u} you're out of @ replies for today (${limit}/${limit}). catch still went through though — Profile → X log in game.`,
    (u, limit) =>
      `@${u} daily @ reply cap hit (${limit}/${limit}). rng still ran, no stress. check Profile → X log when you sync.`,
    (u, limit) =>
      `@${u} no @ replies left today (${limit}/${limit}). your haul is saved — Profile → X log has the breakdown.`,
  ];
  return pick(lines, seed)(username, dailyLimit).slice(0, 280);
}

export function buildNaturalInvalidDenomReply(username, seed = 0) {
  return pick(INVALID_DENOM_LINES, seed)(username).slice(0, 280);
}

export function buildNaturalInsufficientReply(username, have, need, seed = 0) {
  return pick(INSUFFICIENT_LINES, seed)(username, have, need).slice(0, 280);
}

export function getReplySeed(tweet) {
  return hashSeed(`${tweet.id || ""}:${tweet.authorId || ""}:${tweet.text || ""}`);
}

export { formatRaritySummary, pickHighlightMons };
