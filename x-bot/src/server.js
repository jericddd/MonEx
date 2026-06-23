import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { listActivities } from "./activity-log.js";
import { processMentionTweet } from "./process-mention.js";
import { appendActivity } from "./activity-log.js";
import { parseMention } from "./parse-mention.js";
import {
  loadState,
  saveState,
  wasProcessed,
  markProcessed,
  getPendingForUsername,
  syncPendingToSlots,
  getUser,
} from "./store.js";
import {
  createXClient,
  resolveBotUser,
  fetchMentions,
} from "./x-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.join(__dirname, "..", "..");
const PORT = parseInt(process.env.PORT || "3001", 10);
console.log(`[boot] MonEx starting on 0.0.0.0:${PORT}`);
const STARTING_MONBALLS = parseInt(process.env.STARTING_MONBALLS || "10", 10);
const BOT_USERNAME = process.env.BOT_USERNAME || "monexmonad";
const POLL_MS = parseInt(process.env.POLL_MS || "45000", 10);
const ENABLE_X_POLL = process.env.ENABLE_X_POLL === "1";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** Global activity feed — successful X catch sessions only */
app.get("/api/activity", (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit || "50", 10));
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const result = listActivities({ limit, page, successOnly: true });
  res.json({ ok: true, ...result });
});

/** Personal log by X @username (until X OAuth links accounts) */
app.get("/api/activity/mine", (req, res) => {
  const username = (req.query.username || "").trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: "username query required" });
  }
  const limit = Math.min(50, parseInt(req.query.limit || "30", 10));
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const result = listActivities({ limit, page, username, successOnly: true });
  res.json({ ok: true, username: username.replace("@", ""), ...result });
});

/** Test without X API: POST { text, username, authorId? } */
app.post("/api/simulate-mention", (req, res) => {
  const text = req.body?.text || "";
  const username = (req.body?.username || "test_trainer").replace("@", "");
  const authorId = req.body?.authorId || `sim_${username.toLowerCase()}`;
  const tweetId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const state = loadState();
  const parsed = parseMention(text, BOT_USERNAME);
  if (parsed.type === "catch") {
    const user = getUser(state, authorId, username, STARTING_MONBALLS);
    if (user.monballs < parsed.spend) {
      user.monballs = STARTING_MONBALLS;
    }
  }
  const result = processMentionTweet(
    { id: tweetId, text, authorId, username },
    BOT_USERNAME,
    state,
    STARTING_MONBALLS
  );
  if (result.activity) appendActivity(result.activity);
  saveState(state);

  res.json({
    ok: true,
    parsed: result.parsed,
    activity: result.activity,
    skipReason: result.skipReason || null,
  });
});

app.get("/api/health", (req, res) => {
  const hasXKeys = !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
  res.json({
    ok: true,
    service: "monex-x-activity",
    xPoll: ENABLE_X_POLL,
    xKeys: hasXKeys,
    bot: BOT_USERNAME,
  });
});

/** Pending wild mons waiting to claim in game */
app.get("/api/pending", (req, res) => {
  const username = (req.query.username || "").trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: "username query required" });
  }
  const state = loadState();
  const result = getPendingForUsername(state, username);
  res.json({
    ok: true,
    username: username.replace("@", ""),
    found: result.found,
    monballs: result.monballs,
    pendingMons: result.pendingMons,
    count: result.pendingMons.length,
  });
});

/** Auto-sync pending mons → party/box slots (no claim button) */
app.post("/api/sync", (req, res) => {
  const username = (req.body?.username || "").trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: "username required" });
  }
  const partyCount = Math.max(0, parseInt(req.body?.partyCount ?? 0, 10));
  const boxCount = Math.max(0, parseInt(req.body?.boxCount ?? 0, 10));
  const state = loadState();
  const { party, box, remaining } = syncPendingToSlots(state, username, partyCount, boxCount);
  saveState(state);
  res.json({
    ok: true,
    username: username.replace("@", ""),
    party,
    box,
    added: party.length + box.length,
    remaining,
  });
});
});

app.use(express.static(WORKSPACE_ROOT));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MonEx server http://localhost:${PORT}`);
  console.log(`  Home:  http://localhost:${PORT}/home.html`);
  console.log(`  Game:  http://localhost:${PORT}/monanimal_game.html`);
  console.log(`  API:   GET /api/activity  POST /api/sync  GET /api/pending?username=you`);
  console.log(`  Test:  POST /api/simulate-mention { "text": "@monexmonad catch 10 monanimals", "username": "jeric" }`);
});

async function pollXMentions() {
  const client = createXClient(process.env).readWrite;
  const botUser = await resolveBotUser(client);
  let sinceId = null;

  console.log(`X ingest (no replies): @${botUser.username}`);

  const tick = async () => {
    try {
      const { tweets, meta } = await fetchMentions(client, botUser.id, sinceId);
      if (meta?.newest_id) sinceId = meta.newest_id;

      for (const tweet of tweets) {
        const state = loadState();
        if (wasProcessed(state, tweet.id)) continue;

        const result = processMentionTweet(
          tweet,
          botUser.username || BOT_USERNAME,
          state,
          STARTING_MONBALLS
        );

        markProcessed(state, tweet.id);
        saveState(state);

        if (result.activity) {
          appendActivity(result.activity);
          console.log(`[log] @${tweet.username} catch ${result.activity.spend} → ${result.activity.caughtCount} caught`);
        } else if (result.skipReason) {
          console.log(`[skip] @${tweet.username} ${result.skipReason}`);
        }
      }
    } catch (err) {
      console.error("[x-poll]", err.message);
    }
  };

  await tick();
  setInterval(tick, POLL_MS);
}

if (ENABLE_X_POLL) {
  pollXMentions().catch((err) => {
    console.error("X poll failed to start:", err.message);
  });
}
