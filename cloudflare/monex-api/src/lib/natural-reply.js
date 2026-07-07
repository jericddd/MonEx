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

function formatNameList(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique.at(-1)}`;
}

function buildCatchContext({ username, monballSpend, results, monballsLeft }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  return {
    u: username,
    spend: monballSpend,
    caughtList: formatNameList(caught.map((r) => r.mon.name)),
    escapedList: formatNameList(escaped.map((r) => r.name)),
    caughtN: caught.length,
    escapedN: escaped.length,
    total: results.length,
    left: monballsLeft,
    allEscaped: caught.length === 0,
    allCaught: escaped.length === 0,
  };
}

/**
 * 12 human-style catch reply templates (no AI). One is picked per tweet via seed.
 * Placeholders: {caughtList}, {escapedList}, {caughtN}, {escapedN}, {total}, {left}, {spend}
 */
export const CATCH_REPLY_TEMPLATE_SAMPLES = [
  "@player wild session — caught {caughtList}. {escapedList} got away ({caughtN}/{total}). {left} Monballs left. Visit the site to play!",
  "@player okay {spend} Monballs in. You bagged {caughtList}. Missed: {escapedList}. {left} Monballs remaining — see you on the site!",
  "@player not bad — {caughtN}/{total} hooked ({caughtList}). Slipped away: {escapedList}. {left} Monballs in your pouch. Hop on the site!",
  "@player ha, messy run. Got {caughtList}, lost {escapedList}. Score {caughtN}-{escapedN}. {left} Monballs left — come play on the site!",
  "@player {spend} Monballs later… caught {caughtList}. {escapedList} weren't cooperating. {left} Monballs left. Site's waiting!",
  "@player yo! {caughtList} in, {escapedList} out. {caughtN}/{total} caught. {left} Monballs to spare — visit the site!",
  "@player field was spicy. Secured {caughtList}. Escaped: {escapedList}. {left} Monballs on hand. Play on the site!",
  "@player solid work — {caughtList} caught, shame about {escapedList}. {left} Monballs left. Head to the site to sync!",
  "@player ranger log: {caughtN} caught ({caughtList}), {escapedN} escaped ({escapedList}). {left} Monballs. Visit the site!",
  "@player that {spend}-ball run is done. Caught: {caughtList}. Got away: {escapedList}. {left} Monballs left — claim on the site!",
  "@player nice throws. {caughtList} stayed, {escapedList} fled. {caughtN} of {total}. {left} Monballs left — visit the site to play!",
  "@player catch report: {caughtList} ✓ · {escapedList} ✗ · {caughtN}/{total} · {left} Monballs left. See you on the site!",
];

/** Mixed results — at least one catch and at least one escape */
const MIXED_CATCH_TEMPLATES = [
  (c) =>
    `@${c.u} wild session — caught ${c.caughtList}. ${c.escapedList} got away (${c.caughtN}/${c.total}). ${c.left} Monballs left. Visit the site to play!`,
  (c) =>
    `@${c.u} okay ${c.spend} Monballs in. You bagged ${c.caughtList}. Missed: ${c.escapedList}. ${c.left} Monballs remaining — see you on the site!`,
  (c) =>
    `@${c.u} not bad — ${c.caughtN}/${c.total} hooked (${c.caughtList}). Slipped away: ${c.escapedList}. ${c.left} Monballs in your pouch. Hop on the site!`,
  (c) =>
    `@${c.u} ha, messy run. Got ${c.caughtList}, lost ${c.escapedList}. Score ${c.caughtN}-${c.escapedN}. ${c.left} Monballs left — come play on the site!`,
  (c) =>
    `@${c.u} ${c.spend} Monballs later… caught ${c.caughtList}. ${c.escapedList} weren't cooperating. ${c.left} Monballs left. Site's waiting!`,
  (c) =>
    `@${c.u} yo! ${c.caughtList} in, ${c.escapedList} out. ${c.caughtN}/${c.total} caught. ${c.left} Monballs to spare — visit the site!`,
  (c) =>
    `@${c.u} field was spicy. Secured ${c.caughtList}. Escaped: ${c.escapedList}. ${c.left} Monballs on hand. Play on the site!`,
  (c) =>
    `@${c.u} solid work — ${c.caughtList} caught, shame about ${c.escapedList}. ${c.left} Monballs left. Head to the site to sync!`,
  (c) =>
    `@${c.u} ranger log: ${c.caughtN} caught (${c.caughtList}), ${c.escapedN} escaped (${c.escapedList}). ${c.left} Monballs. Visit the site!`,
  (c) =>
    `@${c.u} that ${c.spend}-ball run is done. Caught: ${c.caughtList}. Got away: ${c.escapedList}. ${c.left} Monballs left — claim on the site!`,
  (c) =>
    `@${c.u} nice throws. ${c.caughtList} stayed, ${c.escapedList} fled. ${c.caughtN} of ${c.total}. ${c.left} Monballs left — visit the site to play!`,
  (c) =>
    `@${c.u} catch report: ${c.caughtList} ✓ · ${c.escapedList} ✗ · ${c.caughtN}/${c.total} · ${c.left} Monballs left. See you on the site!`,
];

const ALL_CAUGHT_TEMPLATES = [
  (c) =>
    `@${c.u} clean sweep with ${c.spend} Monballs — ${c.caughtList}, every single one (${c.total}/${c.total}). ${c.left} Monballs left. Visit the site to play!`,
  (c) =>
    `@${c.u} perfect run! Bagged ${c.caughtList}. Not one escape. ${c.left} Monballs remaining — hop on the site!`,
  (c) =>
    `@${c.u} flawless ${c.spend}-ball session. All ${c.caughtList} caught. ${c.left} Monballs in the bag. See you on the site!`,
];

const ALL_ESCAPED_TEMPLATES = [
  (c) =>
    `@${c.u} rough one — ${c.escapedList} all got away (0/${c.total}). ${c.left} Monballs left though. Shake it off and visit the site!`,
  (c) =>
    `@${c.u} oof, ${c.spend} Monballs and nothing stuck. ${c.escapedList} slipped every throw. ${c.left} Monballs left — try again on the site!`,
  (c) =>
    `@${c.u} the wild won this round. ${c.escapedList} escaped clean. ${c.left} Monballs still in your pouch. Visit the site when ready!`,
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

export function buildNaturalCatchReply({ username, monballSpend, results, monballsLeft, seed = 0 }) {
  const ctx = buildCatchContext({ username, monballSpend, results, monballsLeft });
  let pool = MIXED_CATCH_TEMPLATES;
  if (ctx.allEscaped) pool = ALL_ESCAPED_TEMPLATES;
  else if (ctx.allCaught) pool = ALL_CAUGHT_TEMPLATES;
  return pick(pool, seed)(ctx).replace(/\s+/g, " ").trim().slice(0, 280);
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
