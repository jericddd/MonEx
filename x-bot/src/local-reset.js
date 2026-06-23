import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const EMPTY = {
  state: { processedTweetIds: [], users: {} },
  activity: { entries: [] },
  saves: {},
  sessions: {},
};

function writeJson(name, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

export function resetAllLocalData() {
  writeJson("state.json", EMPTY.state);
  writeJson("activity.json", EMPTY.activity);
  writeJson("saves.json", EMPTY.saves);
  writeJson("sessions.json", EMPTY.sessions);
  return { ok: true, message: "Local data reset" };
}
