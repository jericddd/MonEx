import { parseMention } from "./parse-mention.js";

const cases = [
  ["@MonEx catch", "catch", 10],
  ["@monex catch 20", "catch", 20],
  ["@MonEx catch 50 please", "catch", 50],
  ["@MonEx catch 25", "invalid_denom"],
  ["@MonEx hello", "ignore"],
  ["just @MonEx", "ignore"],
];

let ok = true;
for (const [text, expectedType, expectedSpend] of cases) {
  const r = parseMention(text, "MonEx");
  const pass = r.type === expectedType && (expectedSpend == null || r.spend === expectedSpend);
  console.log(pass ? "✓" : "✗", JSON.stringify(text), "→", r);
  if (!pass) ok = false;
}

process.exit(ok ? 0 : 1);
