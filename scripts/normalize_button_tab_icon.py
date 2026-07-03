#!/usr/bin/env python3
"""Normalize a button-tab PNG to match dailyquest/shop/profile visual weight."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

TAB_DIR = Path(__file__).resolve().parents[1] / "game_icons" / "button tabs"
REF_CANVAS = (500, 500)
# Content box derived from dailyquest.png artwork inset on a 500x500 canvas.
REF_CONTENT_BOX = (406, 325)


def content_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    alpha = im.split()[-1]
    return alpha.getbbox() or (0, 0, im.width, im.height)


def normalize_icon(src: Path, dst: Path | None = None) -> None:
    im = Image.open(src).convert("RGBA")
    bbox = content_bbox(im)
    cropped = im.crop(bbox)
    cw, ch = cropped.size
    max_w, max_h = REF_CONTENT_BOX
    scale = min(max_w / cw, max_h / ch)
    new_w = max(1, round(cw * scale))
    new_h = max(1, round(ch * scale))
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", REF_CANVAS, (0, 0, 0, 0))
    x = (REF_CANVAS[0] - new_w) // 2
    y = (REF_CANVAS[1] - new_h) // 2
    canvas.paste(resized, (x, y), resized)
    out = dst or src
    canvas.save(out, optimize=True)
    print(f"{src.name}: {im.size} bbox={bbox} -> {out.name} {canvas.size} art={new_w}x{new_h}")


def main() -> int:
    names = sys.argv[1:] or ["armory.png", "monball.png"]
    for name in names:
        path = TAB_DIR / name
        if not path.exists():
            print(f"skip missing {path}", file=sys.stderr)
            continue
        normalize_icon(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
