/** Strip prototype-pollution keys from parsed JSON objects. */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function stripPrototypePollution(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripPrototypePollution);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = stripPrototypePollution(child);
  }
  return out;
}

export function safeJsonParse(text, fallback = null) {
  if (!text) return fallback;
  try {
    return stripPrototypePollution(JSON.parse(text));
  } catch {
    return fallback;
  }
}
