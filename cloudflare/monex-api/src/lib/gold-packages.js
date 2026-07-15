/**
 * Configurable Gold purchase packages ($MONEX-priced).
 * Catalog is server-authoritative — frontend loads via API.
 *
 * Optional env override:
 *   GOLD_PACKAGES_JSON='[{"id":"gp_4k","gold":4000,"monexPrice":10000,"active":true,"displayOrder":1},...]'
 *
 * Optional purchase grant (staging / until on-chain MONEX settle is live):
 *   ENABLE_GOLD_PACKAGE_PURCHASE=1
 */

import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";

const MAX_CLAIM_RETRIES = 3;

/** Default packages — prices editable here or via GOLD_PACKAGES_JSON. */
export const DEFAULT_GOLD_PACKAGES = Object.freeze([
  Object.freeze({
    id: "gp_4k",
    gold: 4000,
    monexPrice: 10_000,
    active: true,
    displayOrder: 1,
    featured: false,
  }),
  Object.freeze({
    id: "gp_8k",
    gold: 8000,
    monexPrice: 20_000,
    active: true,
    displayOrder: 2,
    featured: false,
  }),
  Object.freeze({
    id: "gp_40k",
    gold: 40_000,
    monexPrice: 100_000,
    active: true,
    displayOrder: 3,
    featured: true,
  }),
]);

const SHOP_BUY_TASKS = Object.freeze([
  { tab: "dailies", id: "d3" },
  { tab: "dailies", id: "d10" },
  { tab: "weeklies", id: "w9" },
]);

function bumpShopBuyQuestProgress(questState, qty) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(qty) || 1));
  for (const { tab, id } of SHOP_BUY_TASKS) {
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const list = tasks[tab];
    const idx = list.findIndex((t) => t?.id === id);
    if (idx >= 0) {
      const task = list[idx];
      list[idx] = {
        ...task,
        progress: Math.min(goal, (task.progress || 0) + add),
      };
    } else {
      list.push({ id, progress: Math.min(goal, add), claimed: false });
    }
  }
  return { ...qs, tasks };
}

function normalizePackage(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const gold = Math.floor(Number(raw.gold));
  const monexPrice = Number(raw.monexPrice);
  if (!id || !Number.isFinite(gold) || gold <= 0) return null;
  if (!Number.isFinite(monexPrice) || monexPrice < 0) return null;
  const displayOrder = Number.isFinite(Number(raw.displayOrder))
    ? Math.floor(Number(raw.displayOrder))
    : index + 1;
  return {
    id,
    gold,
    monexPrice,
    active: raw.active !== false,
    displayOrder,
    featured: raw.featured === true,
  };
}

function parsePackagesFromEnv(env) {
  const raw = env?.GOLD_PACKAGES_JSON;
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const packages = parsed
      .map((p, i) => normalizePackage(p, i))
      .filter(Boolean);
    return packages.length ? packages : null;
  } catch {
    return null;
  }
}

/**
 * Resolve active package catalog (sorted by displayOrder).
 * @param {object} [env]
 */
export function listGoldPackages(env = {}) {
  const fromEnv = parsePackagesFromEnv(env);
  const all = fromEnv || DEFAULT_GOLD_PACKAGES.map((p) => ({ ...p }));
  return all
    .filter((p) => p.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.gold - b.gold);
}

/**
 * Find a package by id (active only unless includeInactive).
 */
export function findGoldPackage(env, packageId, { includeInactive = false } = {}) {
  const id = String(packageId || "").trim();
  if (!id) return null;
  const fromEnv = parsePackagesFromEnv(env);
  const all = fromEnv || DEFAULT_GOLD_PACKAGES.map((p) => ({ ...p }));
  const found = all.find((p) => p.id === id) || null;
  if (!found) return null;
  if (!includeInactive && !found.active) return null;
  return found;
}

export function publicGoldPackageView(pkg) {
  if (!pkg) return null;
  return {
    id: pkg.id,
    gold: pkg.gold,
    monexPrice: pkg.monexPrice,
    displayOrder: pkg.displayOrder,
    featured: pkg.featured === true,
  };
}

function goldPackagePurchaseEnabled(env) {
  return String(env?.ENABLE_GOLD_PACKAGE_PURCHASE || "") === "1";
}

async function persistPackageSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      return persistPackageSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "purchase_conflict", save: err.existingSave };
    }
    throw err;
  }
}

/**
 * Purchase a Gold package by id.
 * Until on-chain $MONEX settlement is wired, returns monex_payment_required
 * unless ENABLE_GOLD_PACKAGE_PURCHASE=1 (staging/dev grant path).
 */
export async function purchaseGoldPackage(
  kv,
  session,
  { packageId, expectedRevision, paymentProof } = {},
  startingMonballs = 10,
  env = {}
) {
  const pkg = findGoldPackage(env, packageId);
  if (!pkg) return { ok: false, error: "invalid_package" };

  const view = publicGoldPackageView(pkg);

  const hasPaymentProof = !!(paymentProof && typeof paymentProof === "object" && paymentProof.txHash);

  if (!goldPackagePurchaseEnabled(env) && !hasPaymentProof) {
    return {
      ok: false,
      error: "monex_payment_required",
      package: view,
      currency: "MONEX",
      message: "$MONEX payment integration coming soon.",
    };
  }

  if (hasPaymentProof && !goldPackagePurchaseEnabled(env)) {
    return {
      ok: false,
      error: "monex_payment_unverified",
      package: view,
      currency: "MONEX",
      message: "$MONEX payment verification is not available yet.",
    };
  }

  const { save } = await loadCloudSave(kv, session.xUserId);

  let nextSave = {
    ...save,
    money: (save.money || 0) + pkg.gold,
  };
  nextSave.questState = bumpShopBuyQuestProgress(nextSave.questState, 1);

  const result = await persistPackageSave(kv, session, nextSave, expectedRevision, startingMonballs);
  if (!result.ok) return result;

  return {
    ok: true,
    package: view,
    currency: "MONEX",
    monexPrice: pkg.monexPrice,
    grantedGold: pkg.gold,
    save: result.save,
  };
}
