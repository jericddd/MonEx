import { parseMention } from "./parse-mention.js";

const BOT = "monexmonad";

const cases = [
  ["@monexmonad catch", "catch", 1],
  ["@monexmonad catch 2", "catch", 2],
  ["@monexmonad catch 6", "catch", 6],
  ["@monexmonad catch 10", "catch", 10],
  ["@monexmonad catch 10 please", "catch", 10],
  ["@monexmonad catch 1 monanimal", "catch", 1],
  ["@monexmonad catch 10 monanimal", "catch", 10],
  ["@monexmonad catch 11", "invalid_denom"],
  ["@monexmonad hello", "ignore"],
];

for (const [text, type, spend] of cases) {
  const r = parseMention(text, BOT);
  const ok = r.type === type && (spend == null || r.spend === spend);
  console.log(ok ? "OK" : "FAIL", text, "→", r.type, r.spend ?? "");
}
