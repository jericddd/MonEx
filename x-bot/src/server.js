import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { listActivities } from "./activity-log.js";
import { processMentionTweet } from "./process-mention.js";
import {
  loadState,
  saveState,
  wasProcessed,
  markProcessed,
} from "./store.js";
import {
  createXClient,
  resolveBotUser,
  fetchMentions,
} from "./x-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.join(__dirname, "..", "..");
const PORT = parseInt(process.env.PORT || "3001", 10);
const STARTING_MONBALLS = parseInt(process.env.STARTING_MONBALLS || "50", 10);
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
  const limit = Math.min(100, parseInt(req.query.limit || "30", 10));
  res.json({
    ok: true,
    entries: listActivities({ limit, successOnly: true }),
  });
});

/** Personal log by X @username (until X OAuth links accounts) */
app.get("/api/activity/mine", (req, res) => {
  const username = (req.query.username || "").trim();
  if (!username) {
    return res.status(400).json({ ok: false, error: "username query required" });
  }
  const limit = Math.min(100, parseInt(req.query.limit || "30", 10));
  res.json({
    ok: true,
    username: username.replace("@", ""),
    entries: listActivities({ limit, username, successOnly: true }),
  });
});

/** Test without X API: POST { text, username, authorId? } */
app.post("/api/simulate-mention", (req, res) => {
  const text = req.body?.text || "";
  const username = (req.body?.username || "test_trainer").replace("@", "");
  const authorId = req.body?.authorId || `sim_${username.toLowerCase()}`;
  const tweetId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const state = loadState();
  const result = processMentionTweet(
    { id: tweetId, text, authorId, username },
    BOT_USERNAME,
    state,
    STARTING_MONBALLS
  );
  saveState(state);

  res.json({
    ok: true,
    parsed: result.parsed,
    activity: result.activity,
    skipReason: result.skipReason || null,
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "monex-x-activity", xPoll: ENABLE_X_POLL });
});

app.use(express.static(WORKSPACE_ROOT));

app.listen(PORT, () => {
  console.log(`MonEx server http://localhost:${PORT}`);
  console.log(`  Home:  http://localhost:${PORT}/home.html`);
  console.log(`  Game:  http://localhost:${PORT}/monanimal_game.html`);
  console.log(`  API:   GET /api/activity  GET /api/activity/mine?username=you`);
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
