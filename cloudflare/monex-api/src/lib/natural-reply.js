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

const GAME_CHECK_LINES = [
  "they're in your box — open monexmonad to check them out.",
  "full haul's in game, Profile → X log.",
  "mons are synced — hop on monexmonad when you can.",
  "pull up the game to see them in your box.",
  "worth opening monexmonad for these — Profile → X log.",
  "claim them in your box on monexmonad.",
  "rest of the roster's waiting in game.",
  "box is updated — monexmonad has the full lineup.",
];

const GAME_CHECK_AFTER_MISS_LINES = [
  "catch still logs on monexmonad if you want to double-check.",
  "Profile → X log in game has the run if you sync.",
  "hop on monexmonad when ready — rng might flip next time.",
];

function appendGameCheck(message, caughtN, seed) {
  if (caughtN > 0) {
    return `${message} ${pick(GAME_CHECK_LINES, seed)}`;
  }
  return `${message} ${pick(GAME_CHECK_AFTER_MISS_LINES, seed)}`;
}

function buildCatchContext({ monballSpend, results, monballsLeft, repliesLeftAfter, dailyLimit, seed }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  const summary = buildCatchSummaryFields(caught, escaped, seed);

  return {
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

function pickDailyCapNotice(dailyLimit, seed = 0) {
  const lines = [
    (limit) =>
      `you're out of @ replies for today (${limit}/${limit}). catch commands still work though — tag @monexmonad catch 10/20/30/40/50. Profile → X log in game.`,
    (limit) =>
      `daily @ reply cap hit (${limit}/${limit}). no more @ replies, but you can still catch mons. keep using catch, check Profile → X log when you sync.`,
    (limit) =>
      `no @ replies left today (${limit}/${limit}). catches still run — tag catch anytime, your mons go to Profile → X log on monexmonad.`,
  ];
  return pick(lines, seed)(dailyLimit);
}

function appendReplyQuotaFooter(message, repliesLeftAfter, dailyLimit, seed = 0) {
  if (repliesLeftAfter == null || dailyLimit == null) return message;

  if (repliesLeftAfter <= 0) {
    return `${message} ${pickDailyCapNotice(dailyLimit, seed)}`;
  }

  const footers = [
    `${repliesLeftAfter}/${dailyLimit} @ replies left today.`,
    `@ replies today: ${repliesLeftAfter}/${dailyLimit} left.`,
    `(${repliesLeftAfter}/${dailyLimit} @ replies left today)`,
  ];
  return `${message} ${pick(footers, seed)}`;
}

// No @username in reply text — postReply() threads via in_reply_to_tweet_id (they still get notified).
export const CATCH_REPLY_TEMPLATE_SAMPLES = [
  "{spend} balls in → {raritySummary} ({caughtN}/{total}). {highlights} carried. {escapedNote}. {left} Monballs left.",
  "that {spend}-ball session cooked — {raritySummary}. eyes on {highlights}. {escapedNote}.",
  "rng was kind-ish: {raritySummary} off {spend}. standouts → {highlights}. {escapedNote}.",
  "pulled {raritySummary} ({caughtN}/{total}). fwiw {highlights} are the keepers. {escapedNote}.",
  "{spend} Monballs → {raritySummary}. lowkey watch {highlights}. {escapedNote}. {left} remaining.",
  "field report: {raritySummary}, {caughtN}/{total}. {highlights} > the rest imo. {escapedNote}.",
  "threw {spend}, walked away with {raritySummary}. {highlights} might be it. {escapedNote}.",
  "respectable haul — {raritySummary}. {highlights} are the headline. {escapedNote}. {left} in the bag.",
  "{caughtN}/{total} stuck: {raritySummary}. peep {highlights} when you sync. {escapedNote}.",
  "not bad for {spend} balls — {raritySummary}. {highlights} look proper. {escapedNote}.",
  "{raritySummary} from a {spend}-ball rip. {highlights} stood out. {escapedNote}. {left} Monballs on you.",
  "ok this one hits — {raritySummary} ({caughtN}/{total}). {highlights}. {escapedNote}. sync when you're back.",
  "(+ game check line) they're in your box — open monexmonad to check them out.",
];

const MIXED_CATCH_TEMPLATES = [
  (c) =>
    `${c.spend} balls in → ${c.raritySummary} (${c.caughtN}/${c.total}). ${c.highlights} carried. ${c.escapedNote}. ${c.left} Monballs left.`,
  (c) =>
    `that ${c.spend}-ball session cooked — ${c.raritySummary}. eyes on ${c.highlights}. ${c.escapedNote}.`,
  (c) =>
    `rng was kind-ish: ${c.raritySummary} off ${c.spend}. standouts → ${c.highlights}. ${c.escapedNote}. ${c.left} on you.`,
  (c) =>
    `pulled ${c.raritySummary} (${c.caughtN}/${c.total}). fwiw ${c.highlights} are the keepers. ${c.escapedNote}.`,
  (c) =>
    `${c.spend} Monballs → ${c.raritySummary}. lowkey watch ${c.highlights}. ${c.escapedNote}. ${c.left} remaining.`,
  (c) =>
    `field report: ${c.raritySummary}, ${c.caughtN}/${c.total}. ${c.highlights} > the rest imo. ${c.escapedNote}.`,
  (c) =>
    `threw ${c.spend}, walked away with ${c.raritySummary}. ${c.highlights} might be it. ${c.escapedNote}.`,
  (c) =>
    `respectable haul — ${c.raritySummary}. ${c.highlights} are the headline. ${c.escapedNote}. ${c.left} in the bag.`,
  (c) =>
    `${c.caughtN}/${c.total} stuck: ${c.raritySummary}. peep ${c.highlights} when you sync. ${c.escapedNote}.`,
  (c) =>
    `not bad for ${c.spend} balls — ${c.raritySummary}. ${c.highlights} look proper. ${c.escapedNote}.`,
  (c) =>
    `${c.raritySummary} from a ${c.spend}-ball rip. ${c.highlights} stood out. ${c.escapedNote}. ${c.left} Monballs.`,
  (c) =>
    `ok this one hits — ${c.raritySummary} (${c.caughtN}/${c.total}). ${c.highlights}. ${c.escapedNote}. sync when you're back.`,
];

const ALL_CAUGHT_TEMPLATES = [
  (c) =>
    `clean ${c.spend}-ball sweep — ${c.raritySummary}, ${c.caughtN}/${c.total} hooked. ${c.highlights} ate. ${c.left} Monballs left.`,
  (c) =>
    `perfect rip. ${c.raritySummary}, nothing escaped. ${c.highlights} are the ones. ${c.left} remaining.`,
  (c) =>
    `flawless session tbh — ${c.raritySummary}. all ${c.caughtN} landed. ${c.highlights} > everything else.`,
];

const ALL_ESCAPED_TEMPLATES = [
  (c) =>
    `brutal — ${c.escapedN}/${c.total} slipped (${c.spend} balls gone). ${c.left} Monballs left. rng hates us sometimes.`,
  (c) =>
    `oof, ${c.spend} Monballs and nothing stuck. ${c.escapedList} said no every time. ${c.left} left in the bag.`,
  (c) =>
    `wild took the W this round. ${c.escapedNote}. still got ${c.left} Monballs — run it back when ready.`,
];

const INVALID_DENOM_LINES = [
  () => `that amount doesn't fly — catches are 10, 20, 30, 40, or 50 Monballs`,
  () => `need a valid stack: 10 / 20 / 30 / 40 / 50 Monballs only`,
  () => `nah — we do catches in tens up to 50 Monballs`,
];

const INSUFFICIENT_LINES = [
  (_u, have, need) => `you're light on Monballs (${have}/${need}). need at least 10 to run a catch.`,
  (_u, have, need) => `not enough Monballs rn — ${have} on you, ${need} needed.`,
  (_u, have, need) => `can't rip that yet (${have} Monballs, need ${need}).`,
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
  const withGameCheck =
    repliesLeftAfter <= 0 ? body : appendGameCheck(body, ctx.caughtN, seed + 7);
  return appendReplyQuotaFooter(withGameCheck, repliesLeftAfter, dailyLimit, seed + 1)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

export function buildDailyLimitNoticeReply(_username, dailyLimit = DEFAULT_DAILY_REPLY_LIMIT, seed = 0) {
  return pickDailyCapNotice(dailyLimit, seed).slice(0, 280);
}

export function buildNaturalInvalidDenomReply(_username, seed = 0) {
  return pick(INVALID_DENOM_LINES, seed)().slice(0, 280);
}

export function buildNaturalInsufficientReply(_username, have, need, seed = 0) {
  return pick(INSUFFICIENT_LINES, seed)(_username, have, need).slice(0, 280);
}

export function getReplySeed(tweet) {
  return hashSeed(`${tweet.id || ""}:${tweet.authorId || ""}:${tweet.text || ""}`);
}

export { formatRaritySummary, pickHighlightMons };
