import { buildSavePayload } from "./save.js";

const RESOURCE_ALIASES = {
  gold: "gold",
  essence: "essence",
  kbs_onion: "essence",
  kbsonion: "essence",
  onion: "essence",
  monball: "monballs",
  monballs: "monballs",
};

const RESOURCE_LABELS = {
  gold: "Gold",
  essence: "KB's Onion",
  monballs: "Monball",
};

export function normalizeMailResourceType(raw) {
  const key = String(raw || "").toLowerCase().trim().replace(/\s+/g, "_");
  return RESOURCE_ALIASES[key] || null;
}

function describeReward(resourceType, quantity) {
  const qty = Math.floor(Number(quantity));
  if (resourceType === "gold") return `${qty} Gold`;
  if (resourceType === "essence") return `${qty} KB's Onion`;
  if (resourceType === "monballs") return `${qty} Monball${qty === 1 ? "" : "s"}`;
  return `${qty}`;
}

function makeMailId(now = Date.now()) {
  return `mail_admin_${now}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildMailboxRewardItem({ title, resourceType, quantity, now = Date.now() }) {
  const normalized = normalizeMailResourceType(resourceType);
  const qty = Math.floor(Number(quantity));
  const mailTitle = String(title || "").trim();
  if (!normalized || !mailTitle || !Number.isFinite(qty) || qty <= 0) return null;

  const rewardText = describeReward(normalized, qty);
  const base = {
    id: makeMailId(now),
    title: mailTitle.slice(0, 80),
    body: `${rewardText} — open Mailbox in game to claim.`,
    createdAt: new Date(now).toISOString(),
  };

  if (normalized === "monballs") {
    return { ...base, type: "monballs", amount: qty };
  }

  return {
    ...base,
    type: "resources",
    grant: { [normalized]: qty },
  };
}

export function sendMailboxRewardToSave(save, options = {}) {
  const now = options.now ?? Date.now();
  const item = buildMailboxRewardItem({
    title: options.title,
    resourceType: options.resourceType,
    quantity: options.quantity,
    now,
  });
  if (!item) {
    return { changed: false, save, item: null, error: "invalid_mail_reward" };
  }

  const nextSave = buildSavePayload(
    {
      ...save,
      mailbox: [item, ...(save.mailbox || [])],
      updatedAt: new Date(now).toISOString(),
    },
    { username: save?.xHandle || "" },
    { now }
  );

  return { changed: true, save: nextSave, item };
}
