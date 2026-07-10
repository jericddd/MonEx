# MonEx Production-Readiness Audit — July 2026

Full-codebase audit across frontend, API, economy/state, and infrastructure.
Findings are grouped as **Fixed this pass**, **Architectural (requires dedicated
project)**, and **Low (P2, documented only)**.

---

## Executive summary

**Overall health:** The game is functional and the recent session/save-revision
work closed the worst data-loss vectors. The dominant *remaining* risk is
**architectural**: the game economy is client-authoritative (the browser computes
and submits currency/progress; the server only clamps to ceilings), and all
X-catch state lives in a single global KV key mutated with non-atomic
read-modify-write. These are not one-line bugs; they need dedicated, carefully
migrated projects. This pass fixed every issue that could be fixed safely without
risking new data loss, and documents the rest with implementation plans.

**Key risks (in priority order):**
1. Client-authoritative economy (money/essence/monShards/trainerXp/quest rewards) — cheatable.
2. Single `monex:state` KV key + isolate-local "locks" — concurrent writes can lose data at scale.
3. Non-atomic tweet dedupe / mailbox claim — duplicate catches / double rewards under concurrency.

---

## Audit totals

| Severity | Found | Fixed this pass | Deferred (documented) |
|---|---|---|---|
| P0 Critical | 6 | 4 | 2 (architectural) |
| P1 High | ~22 | 11 | ~11 (mostly architectural/concurrency) |
| P2 Low | ~30 | fixed (code) | deferred: #4, #7, #8–10, #14, #16–17, #18, #23–24, #30–31 |

---

## Fixed this pass (see PR)

### P0

1. **Staging dev-auth exploitable in production** (`wrangler.toml`, `lib/auth.js`).
   `ENABLE_STAGING_DEV_AUTH="1"` + an Origin-only gate let anyone mint a session
   as any username (Origin is spoofable; anyone can host a `*.pages.dev` site) →
   account/catch-state takeover. **Fix:** set `"0"` on production; `devAuthAllowed`
   now default-denies when no request is present and still requires a staging Origin.

2. **Client could inject mailbox rewards / reset daily-login via save PUT**
   (`lib/save.js`, `index.js`). `mailbox` and `dailyLoginLastClaimAt` are now
   **server-authoritative**: `PUT /api/save` preserves them from the stored save
   and ignores client values. Kills "craft mailbox item → claim" and "null the
   cooldown → re-claim" exploits.

3. **Corrupt cloud save could wipe an account.** `loadCloudSave` returned
   `found:false` on `JSON.parse` failure — identical to a missing save — so a
   returning player with cleared localStorage would get new-account defaults
   written over their real (corrupt-but-recoverable) data. **Fix:** corruption is
   now flagged distinctly and `GET /api/save` returns `500 save_corrupt`; the
   client shows its retry modal instead of initializing defaults.

4. **No cache-busting on `/play` scripts.** Added `?v=` to all eight client
   scripts (matches `home.html`). Prevents recurrence of the stale-client outage
   class that previously broke saves.

### P1

- **`request.json()` unguarded** on `/api/auth/dev`, `PUT /api/save`, `/api/sync`,
  `/api/simulate-mention` → malformed JSON now returns `400 invalid_json`, not 500.
- **OAuth callback hardening:** wrapped in try/catch (generic `auth_error`, no X
  API body leak); **session token moved from query string to URL fragment**
  (`#session=`) so it is not logged or sent via Referer.
- **Generic `server_error` on 500** — internal/library error strings no longer
  reach clients; full detail logged server-side.
- **Admin endpoints hardened:** `/api/admin/grant-monballs` and `/api/admin/run-poll`
  now require `ENABLE_ADMIN_RESET=1`, are rate-limited, and accept the secret only
  via header (not JSON body).
- **CORS no longer falls back to `*`** for disallowed origins.
- **Superseded tab cannot write saves** (local or cloud) — closes a local
  `localStorage` clobber vector between tabs.
- **Unload save flush uses `fetch` `keepalive`** so last-second progress survives tab close.
- **XSS defense-in-depth:** the save sanitizer strips `<`/`>` from all strings
  (skill name/desc, xHandle, etc.); mailbox claim button uses a `data-` attribute.
- **CI runs `npm test`** before Cloudflare API deploy and in staging validation.
- **`_headers`:** HTML `no-cache`; `/js/*` short `must-revalidate`.

---

## Architectural findings — require dedicated projects (NOT safe to hot-fix)

These are genuine P0/P1 risks, but each is a migration that, done hastily, could
itself cause the data loss we are trying to prevent. Each needs its own change,
test plan, and staged rollout.

### A1 (P0). Client-authoritative economy
**Files:** `play/index.html` (all earn/spend paths), `lib/save-validate.js`
(clamps only), `index.js` `PUT /api/save`.
**Problem:** The browser computes money/essence/monShards/trainerXp/quest rewards
and submits them; the server only clamps to max ceilings. A user editing
localStorage or the PUT body can set near-max resources and claim quest rewards
repeatedly (`questState.claimed`/`grantedKeys` are client-written).
**Why not hot-fixed:** Hard-capping currencies server-side would reject legitimate
client-computed gains (quest rewards, resource chest, adventure, level costs) and
**roll back real player progress** — a regression worse than the exploit for
honest players.
**Recommended solution:** Introduce server-side game actions with an append-only
ledger. Each spend/earn becomes an authenticated endpoint (`/api/action/*`) that
validates preconditions and applies deltas; the save becomes a server-derived
projection. Migrate one system at a time (start with quests and shop purchases),
keeping the current save as a read model until parity is proven.
**Effort:** Large (multi-subsystem). **Risk if rushed:** High (progress loss).

### A2 (P0/P1). Single `monex:state` KV key + isolate-local locks
**Files:** `kv-store.js` (`loadState`/`saveState`), `lib/grant-monballs.js`,
`lib/mailbox.js` (`withDailyLoginClaimLock`), `index.js` (`withUserSyncLock`).
**Problem:** All users, pending catches, reply counters, and `processedTweetIds`
live in one JSON blob mutated with read-modify-write. "Locks" are `globalThis`
Maps — per-isolate only, not distributed. Concurrent writes (cron poll + `/api/sync`
+ pending GET) can last-write-wins clobber unrelated users; the blob also grows
toward the 25 MB KV limit.
**Consequences:** Lost monball spends/pending mons under concurrency; mailbox and
daily-login **double-claim** across isolates; save PUTs without `baseRevision`
race (revision read-then-write is not atomic).
**Recommended solution:** Per-user Durable Object for serialization (catch state,
mailbox claim, daily login, save revision CAS), or shard catch state into
per-user KV keys with conditional writes and store `processedTweetIds` as
individual `monex:processed:{tweetId}` keys (write-if-absent) for atomic dedupe.
**Effort:** Large. **Risk if rushed:** High. **Interim mitigation already in place:**
save writes use monotonic `revision` optimistic locking (blocks the most damaging
save races); mailbox/daily-login remain best-effort until DO/CAS lands.

### A3 (P1). Atomic tweet dedupe & mailbox claim idempotency
Covered by A2. Until then: overlapping cron runs or `admin/run-poll` + cron can
double-process a mention (duplicate catch/spend), and two rapid
`/api/mailbox/claim` for the same `mailId` can double-grant (claim path uses
`skipStaleCheck`). Add a per-tweet write-if-absent claim and a per-mail
conditional `claimedAt` set.

### A4 (P1). Server-authoritative quest rewards
Part of A1. A dedicated `/api/quest/claim` that validates task progress and grants
rewards (marking `grantedKeys`) is the correct fix; today the client authors quest
state and the server accepts it.

### A5 (P1). Live GitHub Pages may serve the whole repo root
**Files:** `README.md`, `scripts/prepare-pages-site.sh` (orphaned).
Staging uses a sanitized bundle; production reportedly serves the repo root,
exposing `x-bot/`, `cloudflare/`, operator scripts, and `wrangler.toml`. Wire a
Deploy-Pages workflow through `prepare-pages-site.sh` (or configure Pages build
output) so only the sanitized bundle is public. **Operationally verify** what
`monexmonad.xyz` actually serves. **Effort:** Small–medium; **needs deploy access.**

---

## Low (P2) — fixed in this pass

Each item below was implemented unless noted as deferred (medium/large effort).

1. **`/api/health` & `/api/poll-status` info disclosure** · `index.js` · returns
   feature flags, key presence, `resetEpoch`, `sinceId` · should expose minimal
   public status · exposes config recon · GET the endpoints · Low (recon aid) ·
   gate diagnostics behind admin secret · S · none.
2. **`/api/activity` unauthenticated global feed** · `index.js`,`kv-store.js` ·
   no auth on public catch feed · privacy/scraping · GET · Low · add auth or
   pagination limits · S · feed embedded on site, verify before locking.
3. **`/api/catch-card-preview` unauthenticated CPU render** · `index.js` · resvg
   render with no auth/limit · resource/cost abuse · repeated GET · Low–Med · add
   rate limit / static cache · S · none.
4. **Rate limiting is IP-only & non-atomic** · `lib/security.js` · `routeKey:IP`,
   read-inc-write · shared IP collateral / small overshoot · concurrent requests ·
   Low–Med · composite `userId:route` key, atomic counter/DO · M · NAT users.
5. **Game-session routes not rate-limited** · `index.js` · claim/heartbeat KV
   write amplification · Low · add limits · S.
6. **`GET /api/pending` mutates global state** · `index.js`,`kv-store.js` ·
   read endpoint calls `resolveCatchUser`+`saveState` · side-effecting read
   amplifies A2 races · Med · make read-only · S · ensure sync still merges.
7. **Multiple valid sessions; logout doesn't invalidate all** · `lib/auth.js` ·
   no `sessionVersion` · old tokens live 30 days · Low · per-user session version ·
   M.
8. **`timingSafeEqual` length short-circuit** · `lib/security.js` · not constant
   time on length mismatch · Low · hash-then-compare · S.
9. **Merge tie-breakers use `Math.max`** (client `pickNewerSaveScalar`, server
   `resolveMergedMonballs`) · equal timestamps resurrect spent currency · Low–Med
   (revision locking mitigates cloud path) · prefer revision / min-for-spendables · M.
10. **`mergeMonsterInventories` can re-add released mons** · `play/index.html` ·
    fuzzy fingerprint merge, older-with-more re-adds · duplication across devices ·
    Med · dedupe by stable instance ID · M.
11. **`reconcileUngrantedQuestRewards` only on cloud conflict, not on load** ·
    `play/index.html` · claimed-but-ungranted rewards not recovered on normal load ·
    Med · call at end of `loadData` · S.
12. **Quest claim sets `claimed` before grant persists** · `play/index.html` ·
    tab-kill mid-claim → claimed with no payout · Med · grant→grantedKeys→claimed
    →single save · S.
13. **`adventureBattleActive` never restored; abandon uses legacy key** ·
    `play/index.html` · `resolveAbandonedAdventureBattle` reads `monex_<username>`
    not `getSaveStorageKey()` · abandon detection missed for xUserId-keyed saves ·
    Med · use `getSaveStorageKey()` everywhere · S.
14. **Widespread `innerHTML` for mon/skill/gear strings** · `play/index.html` ·
    now mitigated server-side by `<>` stripping, but client should still
    `escapeHtml`/`textContent` dynamic strings · Low (post-mitigation) · escape at
    render · M · large surface.
15. **Mailbox capacity 50 silently drops rewards** · `save-validate.js`,`mailbox.js`
    · `slice(0,50)` · new daily reward can drop oldest · Low–Med · reject/expire
    when full, surface `mailbox_full` · S.
16. **Poll marks tweet processed before success** · `index.js` · skip/exception
    consumes the tweet forever · Med · mark processed only after commit · S (tied to A3).
17. **X API 429 has no backoff** · `x-oauth-fetch.js`,`index.js` · poll aborts on
    non-OK · Low · exponential backoff / respect retry-after · M.
18. **Duplicate `getUser` modules & username casing** · `store.js`,`activity-log.js`,
    `kv-store.js` · divergent normalization → duplicate pending groups · Med ·
    consolidate to one normalized module · M.
19. **Legacy user merge drops monballs** · `kv-store.js` · merges pending only,
    discards legacy `monballs` · Low (rare) · `mergeMonballBalances` on merge · S.
20. **`selfBuff`/`enemyDebuff` pass through unsanitized** · `save-validate.js` ·
    arbitrary nested objects stored · Low · strip/whitelist · S.
21. **Prototype-pollution guards absent on `JSON.parse`** · multiple · low
    practical risk (objects reconstructed) · strip `__proto__` on parse · S.
22. **`parseInt` NaN on query params** · `index.js` activity limit/page ·
    `limit=foo`→NaN→empty results · Low · `Number.isFinite` guard · S.
23. **`x-bot/` legacy code present** · `x-bot/*` · dev-auth auto-on, CORS `*`,
    static-serves workspace, non-timing-safe admin compare · risk only if run/served
    · Med · archive/remove or gate behind `LEGACY=1`; exclude from prod bundle · S.
24. **Destructive Actions lack environment protection** · `.github/workflows/*` ·
    `workflow_dispatch` + typed confirm but no required reviewers · Med · route KV
    mutations through a `production` GitHub Environment with approvals · S.
25. **Mass-mutation workflows allow empty username = all users** · send-mailbox /
    backfill scripts · typo can mass-grant · Med · require explicit `--all-users`
    flag + second confirm · S.
26. **`reset-production-kv.mjs` no local safety prompt** · script · runs immediately
    with env vars · Med · require `CONFIRM=RESET` / refuse outside CI · S.
27. **Docs inconsistencies** (API URL, deploy model, cron interval, local-test path,
    `x-bot` error string in `play/index.html:~14717`) · operator-error risk · Low ·
    reconcile to single source · S.
28. **`monanimal-game-phaser3/` dead prototype** · included in staging bundle,
    ~1 MB Phaser · Low · delete/move to `experiments/`, exclude from staging · S.
29. **`.gitignore` gaps** (nested `node_modules/`, `x-bot/data/`, `*.log`) · Low · expand · S.
30. **Blocking `alert()` throughout gameplay** · `play/index.html` (40+ sites) ·
    blocks main thread / pauses battle · Low · in-game toast/modal · M.
31. **CSP allows `unsafe-inline` scripts** · `_headers` · required by inline JS ·
    Low · long-term: extract inline JS, use nonces · L.
32. **`REPLY_LIMIT_OVERRIDES=jericddd:100` hardcoded** · `wrangler.toml` · prod
    privilege in config · Low · move to secret/admin tooling · S.
33. **`getUtcWeekKey` ISO-week edge cases** · `play/index.html` · weekly quest reset
    off-by-one at year boundary · Low · standard ISO week / server-computed · S.
34. **`attemptCatch()` dead but console-exploitable** · `play/index.html` · grants
    mons / spends monballs client-side · Low · remove/guard · S.

---

## Final recommendations

- **Reliability / regressions:** Keep the shared-scope play-scripts test and the
  two-tab e2e as required CI gates (now run before deploy). Add a nightly
  `npm audit` in both packages.
- **Testing coverage:** Add integration tests around `PUT /api/save` field
  preservation and the corrupt-save path (added this pass); extend to concurrency
  once A2 lands.
- **Observability:** The new structured `save_put_ok/_conflict`, `gameplay_rejected`,
  `save_load_corrupt`, and `[oauth]`/`[handler]` logs are visible via
  `wrangler tail`. Add alerting on `save_load_corrupt` and cron failures.
- **Database integrity:** Prioritize A2 (per-user keys / Durable Objects) — it is
  the root of the concurrency and size risks.
- **Resource consistency:** Prioritize A1 (server-authoritative economy) — it is
  the root of the cheating and reconciliation-complexity risks.
- **Security hardening:** Confirm production Pages serves only the sanitized bundle
  (A5); add GitHub Environment approvals for KV-mutating workflows.
- **Long-term maintainability:** Consolidate the triplicate state modules; extract
  inline JS to enable a strict CSP.
