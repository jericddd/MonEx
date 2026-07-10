# Progression & Persistence Integrity Audit

Production audit of every system that modifies or tracks player progression. Last updated: 2026-07-10.

## Architecture overview

| Layer | Storage | Role |
|-------|---------|------|
| **Local** | `localStorage` key `monex_{username}` | Immediate UI state, offline buffer |
| **Cloud save** | KV `monex:save:{xUserId}` | Authoritative game progress (party, box, currencies, quests, mailbox, adventure) |
| **Catch state** | KV `monex:state` → `users[xUserId]` | X wild-catch queue, catch-side monball balance |

Progress flows: **client mutates → `saveData()` (local + debounced cloud) → `PUT /api/save`**. Critical grants also call **`persistProgress()`** (immediate cloud flush).

---

## Complete inventory: where progress is modified

### Client (`play/index.html`)

| System | Function(s) | Persistence |
|--------|-------------|-------------|
| **Currencies** | `applyQuestGrantToResources`, `spendCost`, `grantShopItem` | `saveData` / `persistProgress` |
| **Quest rewards** | `grantQuestReward`, `claimDailyQuest`, `claimWeeklyQuest`, `claimQuestChest` | `saveData` + `persistQuestClaim` (flush) |
| **Battle rewards** | `grantBattleRewards`, `endBattle`, `endPatrolBattle` | `persistBattleReward` (flush) |
| **Trainer XP / level** | `addTrainerXp`, `grantTrainerLevelReward` | `persistProgress` on level-up |
| **Resource chest** | `collectResourceChest` | `persistProgress` |
| **Shop purchases** | `executeShopPurchase` | `persistProgress` |
| **Mon level-up** | `levelUpMonManual` | `persistProgress` |
| **Ascension** | `ascendMonRarity`, hero ascension forge | `persistProgress` |
| **Armory forge** | `runArmoryForgeAction` (synth, enhance, hero ascension) | `persistProgress` |
| **Release salvage** | `releaseFromBox` | `persistProgress` |
| **Adventure progress** | `endBattle` (win), chapter advance | `persistBattleReward` |
| **Patrol scans** | `beginPatrolScan`, `ensurePatrolDailyReset` | `persistProgress` / `saveData` on load reset |
| **Party order** | `renderTeamArrangement` drag-drop | `saveData` |
| **Party/box switches** | `switchPartyMon`, `switchBoxMon`, etc. | `saveData` |
| **Mailbox claim** | `claimMailboxReward` | server write + `flushSaveToCloud` |
| **X wild sync** | `syncXWildMons` | server `/api/sync` + `persistProgress` when monballs change |
| **Daily quest reset** | `checkDailyReset`, `ensureQuestResets` | `saveData` when changed |
| **Cloud conflict** | `handleCloudSaveConflict` | `mergeSaveSnapshots` + re-save |
| **Load / login** | `loadData` | merge local+cloud, sync merged to cloud |

### Server API (`cloudflare/monex-api`)

| Endpoint / path | Modifies | Notes |
|-----------------|----------|-------|
| `PUT /api/save` | Full cloud save | Stale-save guard (`updatedAt`); aligns catch monballs |
| `POST /api/sync` | Pending mons → party/box; monballs merge | User lock; `resolveMergedMonballs` |
| `POST /api/mailbox/claim` | Mailbox + currencies | `skipStaleCheck`; credits catch monballs |
| `POST /api/daily-login/claim` | Mailbox mail | Claim in-game only |
| X webhook / simulate | Catch state, pending mons, monball spend | Catch `updatedAt` drives monball authority |
| `grantMonballs` admin | Catch + cloud save | Atomic grant both pools |
| `backfill-pending` | Party/box + monballs | Uses `resolveMergedMonballs` |
| `backfill-quest-rewards` | Mailbox recovery mail | Idempotent `grantedKeys` |
| `send-mailbox-reward` | Mailbox only | Balances unchanged until claim |

---

## Issues found & fixes (this PR)

### Critical — fixed

1. **`mergeSaveSnapshots` used `Math.max` on currencies**  
   *Risk:* Cross-device spend reverted (e.g. shop purchase undone when older tab had higher gold).  
   *Fix:* `pickNewerSaveScalar` — newer `updatedAt` wins; max only when timestamps tie.

2. **`resolveMergedMonballs` used max when save was newer**  
   *Risk:* In-game monball spends reverted on `/api/sync`.  
   *Fix:* Timestamp-based authority; catch wins when catch newer, save wins when save newer.

3. **`alignCatchMonballsToMerged` only increased catch balance**  
   *Risk:* Catch pool stayed high after in-game spend, re-inflating on sync.  
   *Fix:* Always align catch pool to merged value.

4. **`syncXWildMons` used `Math.max` for monballs**  
   *Risk:* Client ignored server reconciliation (mailbox bug class).  
   *Fix:* Trust server `data.monballs`; flush when changed.

5. **`loadData` picked newer snapshot only**  
   *Risk:* Lost progress from the other source on login.  
   *Fix:* Always `mergeSaveSnapshots` when both local and cloud exist.

6. **`backfill-pending` overwrote save monballs with catch**  
   *Risk:* Mailbox grants lost during backfill.  
   *Fix:* `resolveMergedMonballs`.

7. **Debounced-only saves on high-value actions**  
   *Risk:* Refresh/logout before 800ms debounce → lost shop spend, chest collect, level-up.  
   *Fix:* `persistProgress()` + flush on shop, chest, trainer level, patrol, armory, release, battles, quests.

8. **Patrol daily reset not persisted**  
   *Fix:* `ensurePatrolDailyReset` returns changed flag; save on load and before scans.

9. **Team arrange drag didn't save party order**  
   *Fix:* `saveData()` after reorder.

### Remaining known limitations

| Issue | Risk | Mitigation |
|-------|------|------------|
| **No per-mon instance IDs** | Cross-device box merge uses fingerprint heuristic; duplicate species may not fully union | Prefer single active session; monitor support tickets |
| **Mid-battle HP** | Only persisted at battle end | Documented; forfeit restores full HP |
| **Admin scripts use `skipStaleCheck`** | Can overwrite concurrent player saves | Admin-only; run during maintenance |
| **Quest progress `Math.max` on merge** | Theoretically could mask regressed progress | Quest tasks are monotonic; `claimed` is OR'd |
| **Gear inventory union by id** | Safe — gear has unique ids | — |
| **Dual monball pools** | Requires timestamp discipline | `alignCatchMonballsToSave` on every `PUT /api/save` |

---

## Safeguards added

- **`persistProgress()`** — single helper: local save + optional immediate cloud flush.
- **`save-reconcile.js`** — tested monball reconciliation (`resolveMergedMonballs`, `alignCatchMonballsToSave`).
- **`pickNewerSaveScalar` / `mergeMonsterInventories`** — safer client-side conflict merge.
- **Tests** — `save-reconcile.test.js` in `npm test`; backfill-pending test validates catch-priority.
- **409 conflict handler** — merges instead of blind overwrite; re-schedules cloud push.

---

## Verification checklist

- [x] Resource gains persist after refresh (flush on critical paths)
- [x] Spends cannot be reverted by stale merge (newer timestamp wins)
- [x] Monball mailbox grants survive sync (server + client fixes)
- [x] X catch spend respected when catch state newer
- [x] In-game monball spend respected when save newer
- [x] Quest `grantedKeys` union prevents duplicate claims
- [x] `PUT /api/save` rejects stale `updatedAt` (409 → client merge)
- [ ] Manual QA: two-browser conflict test (recommended before deploy)

---

## Deploy

1. **Pages** — auto-deploy on merge to `main`.
2. **Worker API** — run **Deploy Cloudflare API** workflow after merge (server changes in `save-reconcile.js`, `grant-monballs.js`, `backfill-pending.js`, `index.js`).
