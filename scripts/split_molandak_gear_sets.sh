#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/game_icons/gear/_sources/molandak"
PY="$ROOT/scripts/split_gear_sheet.py"

process() {
  local file="$1"
  local out="$2"
  local rows="${3:-4}"
  if [[ ! -f "$file" ]]; then
    echo "Skip missing: $file"
    return 0
  fi
  python3 "$PY" "$file" "$out" --rows "$rows" --cols 5 --slot-rows 4
}

process "$SRC/sheet-a.png" "$ROOT/game_icons/gear/molandak/set-a" 5
process "$SRC/sheet-b.png" "$ROOT/game_icons/gear/molandak/set-b" 4
process "$SRC/sheet-c.png" "$ROOT/game_icons/gear/molandak/set-c" 4

echo "Done."
