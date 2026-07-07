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

const CATCH_OPENERS = [
  (u, n) => `@${u} okay ${n} Monballs down — here's how it went`,
  (u, n) => `@${u} wild run with ${n} Monballs!`,
  (u, n) => `@${u} nice, you sent ${n} — results are in`,
  (u, n) => `@${u} that was a fun one (${n} throws)`,
  (u, n) => `@${u} just finished your ${n}-ball catch session`,
];

const ALL_ESCAPED_LINES = [
  (names) => `Rough luck — everything got away (${names}).`,
  (names) => `Oof, they all slipped off: ${names}.`,
  (names) => `Not this time… ${names} all escaped.`,
];

const MIXED_CATCH_LINES = [
  (caught, escaped) => `You caught ${caught}. ${escaped} got away.`,
  (caught, escaped) => `Bagged ${caught}! Sadly ${escaped} escaped.`,
  (caught, escaped) => `Nice — ${caught} in the box. Missed on ${escaped}.`,
  (caught, escaped) => `Got ${caught}. ${escaped} weren't having it.`,
];

const CLEAN_CATCH_LINES = [
  (caught) => `Clean sweep — ${caught}!`,
  (caught) => `You caught ${caught}. Perfect run.`,
  (caught) => `All ${caught} — not a single escape.`,
];

const MONBALL_CLOSERS = [
  (left) => `${left} Monball${left === 1 ? "" : "s"} left. Visit the site to play!`,
  (left) => `You've got ${left} Monballs remaining — hop on the site when you're ready.`,
  (left) => `${left} Monballs in the bag. Come play on the site!`,
  (left) => `Monballs left: ${left}. See you in-game on the site.`,
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
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  const opener = pick(CATCH_OPENERS, seed)(username, monballSpend);

  let middle;
  if (!caught.length) {
    const names = formatNameList(escaped.map((r) => r.name));
    middle = pick(ALL_ESCAPED_LINES, seed + 1)(names);
  } else if (!escaped.length) {
    middle = pick(CLEAN_CATCH_LINES, seed + 1)(formatNameList(caught.map((r) => r.mon.name)));
  } else {
    const caughtNames = formatNameList(caught.map((r) => r.mon.name));
    const escapedNames = formatNameList(escaped.map((r) => r.name));
    middle = pick(MIXED_CATCH_LINES, seed + 1)(caughtNames, escapedNames);
  }

  const summary = `${caught.length}/${results.length} caught`;
  const closer = pick(MONBALL_CLOSERS, seed + 2)(monballsLeft);
  return `${opener} ${middle} (${summary}). ${closer}`.replace(/\s+/g, " ").trim().slice(0, 280);
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
