import {
  buildCatchSummaryFields,
  formatRaritySummary,
  pickHighlightMons,
} from "./catch-summary.js";

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
    dailyLimit: dailyLimit ?? 5,
    ...summary,
  };
}

function appendReplyQuotaFooter(message, repliesLeftAfter, dailyLimit) {
  if (repliesLeftAfter == null || dailyLimit == null) return message;
  if (repliesLeftAfter <= 0) {
    return `${message} No @ replies left today (0/${dailyLimit}). Don't worry — catches still work! Check Profile → X log in-game.`;
  }
  return `${message} @ replies left today: ${repliesLeftAfter}/${dailyLimit}.`;
}

export const CATCH_REPLY_TEMPLATE_SAMPLES = [
  "@player {spend} Monballs — caught {raritySummary} ({caughtN}/{total}). Standouts: {highlights}. {escapedNote}. {left} Monballs left. Visit the site!",
  "@player nice haul! {raritySummary}. Promising pulls: {highlights}. {escapedNote}. {left} Monballs left — hop on the site!",
  "@player solid run — {raritySummary} ({caughtN}/{total}). Watch these: {highlights}. {escapedNote}. {left} Monballs on hand. Visit the site to play!",
  "@player wild session ({spend} Monballs): {raritySummary}. Top picks: {highlights}. {escapedNote}. {left} Monballs left. See you on the site!",
  "@player ranger report — {raritySummary}, {caughtN}/{total} hooked. Keep an eye on {highlights}. {escapedNote}. {left} Monballs left. Visit the site!",
  "@player okay {spend} Monballs in → {raritySummary}. Looking strong: {highlights}. {escapedNote}. {left} Monballs remaining. Play on the site!",
  "@player not bad! {raritySummary} ({caughtN}/{total}). Stars of the run: {highlights}. {escapedNote}. {left} Monballs in your pouch. Visit the site!",
  "@player messy but fun — {raritySummary}. Best catches: {highlights}. {escapedNote}. {left} Monballs left. Come play on the site!",
  "@player {spend}-ball results: {raritySummary}. Highlights: {highlights}. {escapedNote}. {left} Monballs left. Site's waiting!",
  "@player yo! {raritySummary} ({caughtN}/{total}). {highlights} look spicy. {escapedNote}. {left} Monballs to spare — visit the site!",
  "@player field was spicy — {raritySummary}. Worth syncing: {highlights}. {escapedNote}. {left} Monballs on hand. Play on the site!",
  "@player catch log: {raritySummary} · {caughtN}/{total} · picks: {highlights} · {escapedNote} · {left} Monballs left. Visit the site!",
];

const MIXED_CATCH_TEMPLATES = [
  (c) =>
    `@${c.u} ${c.spend} Monballs — caught ${c.raritySummary} (${c.caughtN}/${c.total}). Standouts: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left. Visit the site!`,
  (c) =>
    `@${c.u} nice haul! ${c.raritySummary}. Promising pulls: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left — hop on the site!`,
  (c) =>
    `@${c.u} solid run — ${c.raritySummary} (${c.caughtN}/${c.total}). Watch these: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs on hand. Visit the site to play!`,
  (c) =>
    `@${c.u} wild session (${c.spend} Monballs): ${c.raritySummary}. Top picks: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left. See you on the site!`,
  (c) =>
    `@${c.u} ranger report — ${c.raritySummary}, ${c.caughtN}/${c.total} hooked. Keep an eye on ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left. Visit the site!`,
  (c) =>
    `@${c.u} okay ${c.spend} Monballs in → ${c.raritySummary}. Looking strong: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs remaining. Play on the site!`,
  (c) =>
    `@${c.u} not bad! ${c.raritySummary} (${c.caughtN}/${c.total}). Stars of the run: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs in your pouch. Visit the site!`,
  (c) =>
    `@${c.u} messy but fun — ${c.raritySummary}. Best catches: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left. Come play on the site!`,
  (c) =>
    `@${c.u} ${c.spend}-ball results: ${c.raritySummary}. Highlights: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs left. Site's waiting!`,
  (c) =>
    `@${c.u} yo! ${c.raritySummary} (${c.caughtN}/${c.total}). ${c.highlights} look spicy. ${c.escapedNote}. ${c.left} Monballs to spare — visit the site!`,
  (c) =>
    `@${c.u} field was spicy — ${c.raritySummary}. Worth syncing: ${c.highlights}. ${c.escapedNote}. ${c.left} Monballs on hand. Play on the site!`,
  (c) =>
    `@${c.u} catch log: ${c.raritySummary} · ${c.caughtN}/${c.total} · picks: ${c.highlights} · ${c.escapedNote} · ${c.left} Monballs left. Visit the site!`,
];

const ALL_CAUGHT_TEMPLATES = [
  (c) =>
    `@${c.u} clean sweep (${c.spend} Monballs)! ${c.raritySummary}. All ${c.caughtN} hooked — standouts: ${c.highlights}. ${c.left} Monballs left. Visit the site!`,
  (c) =>
    `@${c.u} perfect run — ${c.raritySummary}, every throw (${c.total}/${c.total}). Best: ${c.highlights}. ${c.left} Monballs remaining. Hop on the site!`,
  (c) =>
    `@${c.u} flawless session! ${c.raritySummary}. Nothing escaped. Top picks: ${c.highlights}. ${c.left} Monballs in the bag. See you on the site!`,
];

const ALL_ESCAPED_TEMPLATES = [
  (c) =>
    `@${c.u} rough one — all ${c.escapedN} got away (0/${c.total}). ${c.left} Monballs left though. Shake it off and visit the site!`,
  (c) =>
    `@${c.u} oof, ${c.spend} Monballs and nothing stuck. ${c.escapedList} slipped every throw. ${c.left} Monballs left — try again on the site!`,
  (c) =>
    `@${c.u} the wild won this round. ${c.escapedNote}. ${c.left} Monballs still in your pouch. Visit the site when ready!`,
];

const INVALID_DENOM_LINES = [
  (u) => `@${u} hmm that amount doesn't work — try 10, 20, 30, 40, or 50 Monballs`,
  (u) => `@${u} need a valid amount: 10 / 20 / 30 / 40 / 50 Monballs only`,
  (u) => `@${u} whoops — catches are in steps of 10 up to 50 Monballs`,
];

const INSUFFICIENT_LINES = [
  (u, have, need) => `@${u} you're short on Monballs (${have}/${need}). Need at least 10 to play.`,
  (u, have, need) => `@${u} not enough Monballs right now — you have ${have}, need ${need}.`,
  (u, have, need) => `@${u} can't run that catch yet (${have} Monballs, need ${need}).`,
];

export function buildNaturalCatchReply({
  username,
  monballSpend,
  results,
  monballsLeft,
  seed = 0,
  repliesLeftAfter,
  dailyLimit = 5,
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
  return appendReplyQuotaFooter(body, repliesLeftAfter, dailyLimit).replace(/\s+/g, " ").trim().slice(0, 280);
}

export function buildDailyLimitNoticeReply(username, dailyLimit = 5, seed = 0) {
  const lines = [
    (u, limit) =>
      `@${u} you're out of @ replies for today (${limit}/${limit} used). Don't worry — your catch still worked! Check Profile → X log in-game. Visit the site to sync.`,
    (u, limit) =>
      `@${u} daily @ reply cap reached (${limit}/${limit}). Catches still count — no stress! See Profile → X log for results. Hop on the site when ready.`,
    (u, limit) =>
      `@${u} no @ replies left today (${limit}/${limit}). Your catch is saved though! Open the game → Profile → X log. Visit the site to claim mons.`,
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
