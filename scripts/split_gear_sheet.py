#!/usr/bin/env python3
"""Split MonEx gear sprite sheets into 128x128 PNG icons."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

TIERS = ["common", "uncommon", "rare", "legendary", "mythic"]
SLOTS = ["weapon", "armor", "helmet", "boots"]


def remove_dark_background(img: Image.Image, threshold: int = 32) -> Image.Image:
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r <= threshold and g <= threshold and b <= threshold:
                px[x, y] = (0, 0, 0, 0)
    return img


def trim_transparent(img: Image.Image, pad: int = 2) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(img.width, right + pad)
    bottom = min(img.height, bottom + pad)
    return img.crop((left, top, right, bottom))


def fit_icon(img: Image.Image, size: int = 128, margin: int = 8) -> Image.Image:
    inner = max(1, size - margin * 2)
    fitted = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    thumb = img.copy()
    thumb.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    x = (size - thumb.width) // 2
    y = (size - thumb.height) // 2
    fitted.paste(thumb, (x, y), thumb)
    return fitted


def split_sheet(
    src: Path,
    out_dir: Path,
    rows: int,
    cols: int,
    size: int = 128,
    bg_threshold: int = 32,
    slot_rows: int = 4,
) -> list[Path]:
    img = Image.open(src)
    cell_w = img.width // cols
    cell_h = img.height // rows
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    for row in range(slot_rows):
        slot = SLOTS[row]
        for col in range(cols):
            tier = TIERS[col]
            left = col * cell_w
            top = row * cell_h
            cell = img.crop((left, top, left + cell_w, top + cell_h))
            cell = remove_dark_background(cell, bg_threshold)
            cell = trim_transparent(cell)
            cell = fit_icon(cell, size=size)
            dest = out_dir / f"{slot}-{tier}.png"
            cell.save(dest, "PNG")
            written.append(dest)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Split a gear sprite sheet into slot/tier PNGs.")
    parser.add_argument("source", type=Path, help="Sprite sheet image path")
    parser.add_argument("output", type=Path, help="Output directory")
    parser.add_argument("--rows", type=int, default=4, help="Grid rows (default: 4)")
    parser.add_argument("--cols", type=int, default=5, help="Grid columns (default: 5)")
    parser.add_argument("--slot-rows", type=int, default=4, help="Rows to export as gear slots")
    parser.add_argument("--size", type=int, default=128, help="Output icon size")
    parser.add_argument("--bg-threshold", type=int, default=32, help="Black-to-alpha threshold")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source not found: {args.source}")

    files = split_sheet(
        args.source,
        args.output,
        rows=args.rows,
        cols=args.cols,
        size=args.size,
        bg_threshold=args.bg_threshold,
        slot_rows=args.slot_rows,
    )
    print(f"Wrote {len(files)} icons to {args.output}")


if __name__ == "__main__":
    main()
