#!/usr/bin/env bash
# Split house gear sprite sheets into game_icons/gear/{chog,molandak,moyaki}/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/scripts/split_gear_sheet.py"
GEAR="$ROOT/game_icons/gear"

process_house() {
  local house="$1"
  local rows="${2:-4}"
  local src_dir="$GEAR/$house"
  local out_dir="$GEAR/$house"

  # Accept common names: chog.png, sheet.png, or any single PNG in the folder
  local src=""
  for candidate in "$src_dir/$house.png" "$src_dir/Quillspire.png" "$src_dir/sheet.png" "$src_dir"/sheet*.png; do
    if [[ -f "$candidate" ]]; then
      src="$candidate"
      break
    fi
  done
  if [[ -z "$src" ]]; then
    local first
    first="$(find "$src_dir" -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' \) ! -name 'weapon-*' ! -name 'armor-*' ! -name 'helmet-*' ! -name 'boots-*' 2>/dev/null | head -1)"
    if [[ -n "$first" ]]; then
      src="$first"
    fi
  fi

  if [[ -z "$src" || ! -f "$src" ]]; then
    echo "Skip $house — no sprite sheet in $src_dir (expected $house.png)"
    return 0
  fi

  echo "Splitting $house: $src -> $out_dir"
  python3 "$PY" "$src" "$out_dir" --rows "$rows" --cols 5 --slot-rows 4
}

mkdir -p "$GEAR/chog" "$GEAR/molandak" "$GEAR/moyaki"

process_house chog 4
process_house molandak 4
process_house moyaki 4

echo "Done."
