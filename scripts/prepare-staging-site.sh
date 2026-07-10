#!/usr/bin/env bash
# Build a static copy of the game for Cloudflare Pages (staging only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/staging-dist"

rm -rf "$OUT"
mkdir -p "$OUT"

cd "$ROOT"
tar \
  --exclude='./.git' \
  --exclude='./.github' \
  --exclude='./cloudflare' \
  --exclude='./x-bot' \
  --exclude='./staging-dist' \
  --exclude='./node_modules' \
  --exclude='./scripts' \
  --exclude='./monanimal-game-phaser3' \
  --exclude='./CNAME' \
  -cf - . | (cd "$OUT" && tar -xf -)

echo "Staging site ready at: $OUT"
