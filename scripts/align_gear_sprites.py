#!/usr/bin/env python3
"""Match sprite_*.png crops to gear sheet cells and write slot-tier icons."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from split_gear_sheet import SLOTS, TIERS, fit_icon, remove_dark_background, trim_transparent

SPRITE_RE = re.compile(r"^sprite_\d+\.png$", re.IGNORECASE)

# Croakguard has a 5th redundant boots row; only used to disambiguate boot tier.
CHOG_BOOTS_ALT_ROW = 4


def find_sheet(house_dir: Path) -> Path | None:
    for name in (
        "Croakguard.png",
        "Quillspire.png",
        "Geyserfin.png",
        f"{house_dir.name}.png",
        "sheet.png",
    ):
        candidate = house_dir / name
        if candidate.is_file():
            return candidate
    for candidate in sorted(house_dir.glob("*.png")):
        if SPRITE_RE.match(candidate.name):
            continue
        if candidate.name.startswith(("weapon-", "armor-", "helmet-", "boots-")):
            continue
        return candidate
    return None


def prepare_icon(src: Path | Image.Image, size: int = 128) -> Image.Image:
    img = Image.open(src).convert("RGBA") if isinstance(src, Path) else src.convert("RGBA")
    img = remove_dark_background(img)
    img = trim_transparent(img)
    return fit_icon(img, size=size)


def cell_from_sheet(sheet: Image.Image, row: int, col: int, grid_rows: int, grid_cols: int) -> Image.Image:
    cw, ch = sheet.width // grid_cols, sheet.height // grid_rows
    cell = sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch))
    cell = remove_dark_background(cell)
    cell = trim_transparent(cell)
    return fit_icon(cell)


def to_gray_vector(img: Image.Image, size: int = 64) -> np.ndarray:
    thumb = img.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    px = thumb.load()
    out: list[float] = []
    for y in range(size):
        for x in range(size):
            r, g, b, a = px[x, y]
            w = a / 255.0
            out.append((0.299 * r + 0.587 * g + 0.114 * b) * w)
    return np.array(out, dtype=np.float32)


def mse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean((a - b) ** 2))


def build_references(sheet_path: Path, house: str) -> dict[str, Image.Image | tuple[Image.Image, Image.Image]]:
    sheet = Image.open(sheet_path)
    refs: dict[str, Image.Image | tuple[Image.Image, Image.Image]] = {}

    if house == "chog":
        grid_rows = 5
        for row in range(3):
            for col, tier in enumerate(TIERS):
                refs[f"{SLOTS[row]}-{tier}"] = cell_from_sheet(sheet, row, col, grid_rows, 5)
        for col, tier in enumerate(TIERS):
            primary = cell_from_sheet(sheet, 3, col, grid_rows, 5)
            alt = cell_from_sheet(sheet, CHOG_BOOTS_ALT_ROW, col, grid_rows, 5)
            refs[f"boots-{tier}"] = (primary, alt)
    else:
        grid_rows = 4
        for row in range(4):
            for col, tier in enumerate(TIERS):
                refs[f"{SLOTS[row]}-{tier}"] = cell_from_sheet(sheet, row, col, grid_rows, 5)

    return refs


def score_sprite_against_ref(sprite_vec: np.ndarray, ref: Image.Image | tuple[Image.Image, Image.Image]) -> float:
    if isinstance(ref, tuple):
        mses = [mse(sprite_vec, to_gray_vector(r)) for r in ref]
        return -min(mses)
    return -mse(sprite_vec, to_gray_vector(ref))


def assign_sprites(
    sprite_paths: list[Path],
    refs: dict[str, Image.Image | tuple[Image.Image, Image.Image]],
) -> list[tuple[Path, str, float]]:
    labels = list(refs.keys())
    sprite_vecs = {sp: to_gray_vector(prepare_icon(sp)) for sp in sprite_paths}
    scores: list[tuple[float, Path, str]] = []

    for sp in sprite_paths:
        vec = sprite_vecs[sp]
        for label in labels:
            scores.append((score_sprite_against_ref(vec, refs[label]), sp, label))

    scores.sort(reverse=True, key=lambda item: item[0])
    used_sprites: set[Path] = set()
    used_labels: set[str] = set()
    assignments: list[tuple[Path, str, float]] = []

    for score, sp, label in scores:
        if sp in used_sprites or label in used_labels:
            continue
        used_sprites.add(sp)
        used_labels.add(label)
        assignments.append((sp, label, score))
        if len(assignments) == len(sprite_paths):
            break

    if len(assignments) != len(sprite_paths):
        missing = set(labels) - used_labels
        raise RuntimeError(
            f"Could only match {len(assignments)}/{len(sprite_paths)} sprites; unmatched: {sorted(missing)}"
        )

    return assignments


def sort_key(label: str) -> tuple[int, int]:
    slot, tier = label.split("-", 1)
    return SLOTS.index(slot), TIERS.index(tier)


def align_house(
    house_dir: Path,
    size: int = 128,
    keep_sprites: bool = False,
    dry_run: bool = False,
) -> list[tuple[str, str, float]]:
    sheet = find_sheet(house_dir)
    if not sheet:
        raise SystemExit(f"No sprite sheet in {house_dir}")

    sprite_paths = sorted(house_dir.glob("sprite_*.png"), key=lambda p: int(re.search(r"(\d+)", p.name).group(1)))
    if not sprite_paths:
        raise SystemExit(f"No sprite_*.png files in {house_dir}")

    refs = build_references(sheet, house_dir.name)
    assignments = assign_sprites(sprite_paths, refs)
    report: list[tuple[str, str, float]] = []

    for src, label, score in sorted(assignments, key=lambda item: sort_key(item[1])):
        dest = house_dir / f"{label}.png"
        report.append((src.name, dest.name, score))
        if dry_run:
            continue
        icon = prepare_icon(src, size=size)
        icon.save(dest, "PNG")

    if not dry_run and not keep_sprites:
        for sp in sprite_paths:
            sp.unlink()

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Align sprite_*.png gear crops to slot-tier filenames.")
    parser.add_argument("houses", nargs="*", help="House folders to process (default: chog molandak)")
    parser.add_argument("--gear-root", type=Path, default=Path("game_icons/gear"))
    parser.add_argument("--size", type=int, default=128)
    parser.add_argument("--keep-sprites", action="store_true", help="Keep original sprite_*.png files")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    houses = args.houses or ["chog", "molandak"]
    root = args.gear_root
    if not root.is_absolute():
        root = SCRIPT_DIR.parent / root

    for house in houses:
        house_dir = root / house
        print(f"\n=== {house} ===")
        report = align_house(
            house_dir,
            size=args.size,
            keep_sprites=args.keep_sprites,
            dry_run=args.dry_run,
        )
        for src_name, dest_name, score in report:
            print(f"  {src_name} -> {dest_name}  (score {-score:.1f})")


if __name__ == "__main__":
    main()
