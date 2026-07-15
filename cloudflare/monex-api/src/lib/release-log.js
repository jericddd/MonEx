import { sanitizeReleaseLog } from "./save-validate.js";

export function nextReleaseLogNumber(save) {
  const rows = sanitizeReleaseLog(save?.releaseLog);
  let max = Math.max(0, Math.floor(Number(save?.releaseLogSeq) || 0));
  for (const row of rows) {
    const n = Math.floor(Number(row.releaseLogNumber) || 0);
    if (n > max) max = n;
  }
  return Math.max(max, rows.length) + 1;
}

/** Release log # — oldest release is 1, newest is total (newest-first feed). */
export function attachReleaseLogNumbers(entries, { total, page = 1, limit } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const safeLimit = Math.max(1, Math.floor(Number(limit) || rows.length || 1));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (safePage - 1) * safeLimit;
  return rows.map((entry, index) => {
    const stored = Math.floor(Number(entry.releaseLogNumber) || 0);
    const computed = Math.max(1, count - offset - index);
    return {
      ...entry,
      releaseLogNumber: stored > 0 ? stored : computed,
      releaseLogNumberSource: stored > 0 ? "stored" : "computed",
    };
  });
}

export function listReleaseLog(save, { limit = 30, page = 1 } = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rows = sanitizeReleaseLog(save?.releaseLog);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const pageNum = Math.min(Math.max(1, safePage), totalPages);
  const offset = (pageNum - 1) * safeLimit;
  const entries = attachReleaseLogNumbers(rows.slice(offset, offset + safeLimit), {
    total,
    page: pageNum,
    limit: safeLimit,
  });
  return {
    entries,
    total,
    page: pageNum,
    limit: safeLimit,
    totalPages,
  };
}
