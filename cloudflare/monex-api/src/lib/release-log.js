import { sanitizeReleaseLog } from "./save-validate.js";

export function listReleaseLog(save, { limit = 30, page = 1 } = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 30;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rows = sanitizeReleaseLog(save?.releaseLog);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const pageNum = Math.min(Math.max(1, safePage), totalPages);
  const offset = (pageNum - 1) * safeLimit;
  return {
    entries: rows.slice(offset, offset + safeLimit),
    total,
    page: pageNum,
    limit: safeLimit,
    totalPages,
  };
}
