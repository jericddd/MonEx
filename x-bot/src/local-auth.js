import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSessions() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_PATH)) return {};
  return JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
}

function saveSessions(sessions) {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
}

function pruneSessions(sessions) {
  const now = Date.now();
  for (const [token, session] of Object.entries(sessions)) {
    if (new Date(session.expiresAt).getTime() < now) delete sessions[token];
  }
}

export function oauthConfigured() {
  return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
}

export function devAuthAllowed() {
  return process.env.ENABLE_DEV_AUTH === "1" || !oauthConfigured();
}

export function createDevSession(username) {
  const clean = (username || "").toLowerCase().replace("@", "").trim();
  if (!clean) throw new Error("username required");
  const sessions = loadSessions();
  pruneSessions(sessions);
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    xUserId: `sim_${clean}`,
    username: clean,
    name: clean,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  sessions[token] = session;
  saveSessions(sessions);
  return { token, session };
}

export function getSession(token) {
  if (!token) return null;
  const sessions = loadSessions();
  const session = sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    delete sessions[token];
    saveSessions(sessions);
    return null;
  }
  return session;
}

export function deleteSession(token) {
  if (!token) return;
  const sessions = loadSessions();
  delete sessions[token];
  saveSessions(sessions);
}

export function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export function requireSession(req) {
  const token = getBearerToken(req);
  const session = getSession(token);
  if (!session) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, token, session };
}
