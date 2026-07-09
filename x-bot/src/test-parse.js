import { parseMention } from "./parse-mention.js";

const BOT = "monexmonad";

const cases = [
  ["@monexmonad catch", "catch", 1],
  ["@monexmonad catch 2", "catch", 2],
  ["@monexmonad catch 6", "catch", 6],
  ["@monexmonad catch 20", "catch", 20],
  ["@monexmonad catch 50 please", "catch", 50],
  ["@monexmonad catch 1 monanimal", "catch", 1],
  ["@monexmonad catch 20 monanimal", "catch", 20],
  ["@monexmonad catch 25", "catch", 25],
  ["@monexmonad catch 51", "invalid_denom"],
  ["@monexmonad hello", "ignore"],
  ["just @monexmonad", "ignore"],
  ["@MonEx catch 10", "ignore"],
];

for (const [text, type, spend] of cases) {
  const r = parseMention(text, BOT);
  const ok = r.type === type && (spend === undefined || r.spend === spend);
  console.log(`${ok ? "✓" : "✗"} "${text}" →`, r);
  if (!ok) process.exit(1);
}
