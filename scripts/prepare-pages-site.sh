#!/usr/bin/env bash
# Build a static copy of the live site for GitHub Pages (includes CNAME).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/pages-dist"

rm -rf "$OUT"
mkdir -p "$OUT"

cd "$ROOT"
tar \
  --exclude='./.git' \
  --exclude='./.github' \
  --exclude='./cloudflare' \
  --exclude='./x-bot' \
  --exclude='./staging-dist' \
  --exclude='./pages-dist' \
  --exclude='./node_modules' \
  --exclude='./scripts' \
  --exclude='./monanimal-game-phaser3' \
  -cf - . | (cd "$OUT" && tar -xf -)

test -f "$OUT/CNAME"
test -f "$OUT/home.html"
test -f "$OUT/index.html"
echo "GitHub Pages bundle ready at: $OUT"
