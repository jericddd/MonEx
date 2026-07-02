#!/usr/bin/env python3
"""Phase C: feather statue bases + grass tint. Phase D: generate training statue PNG."""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BATTLE_DIR = ROOT / "game_icons" / "battle"

STATUE_PATHS = [
    BATTLE_DIR / "adventure" / "adventure.png",
    BATTLE_DIR / "arena" / "arena.png",
    BATTLE_DIR / "house tower" / "housetower.png",
    BATTLE_DIR / "pvp wager" / "pvpwager.png",
]


def feather_and_tint(img: Image.Image, feather_px: int = 32, tint_depth: float = 0.14) -> Image.Image:
    """Soften base alpha and add subtle green bounce on the lower pedestal."""
    out = img.convert("RGBA").copy()
    w, h = out.size
    px = out.load()
    tint_rows = max(12, int(h * 0.16))

    for y in range(h):
        dist_bottom = h - 1 - y
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 0:
                continue

            if dist_bottom < feather_px:
                fade = (dist_bottom / feather_px) ** 0.82
                a = int(a * fade)

            if dist_bottom < tint_rows and a > 0:
                t = (1 - dist_bottom / tint_rows) * tint_depth
                r = int(r * (1 - t) + 36 * t)
                g = int(g * (1 - t) + 92 * t)
                b = int(b * (1 - t) + 34 * t)

            px[x, y] = (r, g, b, a)

    # Dark contact line along the lowest visible pixels.
    alpha = out.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        base_y = bbox[3] - 1
        line = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = line.load()
        for x in range(bbox[0], bbox[2]):
            if alpha.getpixel((x, base_y)) > 8:
                for dy in range(2):
                    yy = base_y + dy
                    if yy < h:
                        ld[x, yy] = (18, 32, 14, min(90, alpha.getpixel((x, base_y)) // 2))
        out = Image.alpha_composite(out, line)

    return out


def _stone_palette() -> dict[str, tuple[int, int, int]]:
    return {
        "light": (196, 178, 150),
        "mid": (158, 140, 114),
        "dark": (118, 102, 82),
        "shadow": (74, 64, 52),
        "moss": (58, 92, 48),
    }


def _draw_stone_rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], pal: dict) -> None:
    x0, y0, x1, y1 = box
    draw.rectangle(box, fill=pal["mid"] + (255,))
    draw.rectangle((x0, y0, x1, y0 + 3), fill=pal["light"] + (255,))
    draw.rectangle((x0, y1 - 3, x1, y1), fill=pal["shadow"] + (255,))
    draw.rectangle((x0, y0, x0 + 2, y1), fill=pal["dark"] + (255,))
    draw.rectangle((x1 - 2, y0, x1, y1), fill=pal["shadow"] + (255,))


def build_training_statue(pedestal_src: Path, out_path: Path) -> None:
    """Build a training statue in the same stone style using arena pedestal crop."""
    pal = _stone_palette()
    src = Image.open(pedestal_src).convert("RGBA")
    w, h = 520, 420
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # Pedestal from arena (bottom portion).
    ped_crop = src.crop((int(src.width * 0.08), int(src.height * 0.62), int(src.width * 0.92), src.height))
    ped_h = 150
    ped = ped_crop.resize((int(w * 0.92), ped_h), Image.Resampling.NEAREST)
    canvas.paste(ped, ((w - ped.width) // 2, h - ped_h), ped)

    # Central training post.
    post_w = 54
    post_x = (w - post_w) // 2
    post_top = h - ped_h - 168
    _draw_stone_rect(draw, (post_x, post_top, post_x + post_w, h - ped_h + 6), pal)

    # Cross beam.
    beam_y = post_top + 36
    _draw_stone_rect(draw, (post_x - 58, beam_y, post_x + post_w + 58, beam_y + 22), pal)

    # Hanging stone bag (rounded).
    bag_cx = w // 2
    bag_top = beam_y + 24
    draw.ellipse((bag_cx - 34, bag_top, bag_cx + 34, bag_top + 74), fill=pal["mid"] + (255,))
    draw.ellipse((bag_cx - 28, bag_top + 6, bag_cx + 28, bag_top + 66), fill=pal["light"] + (255,))
    draw.ellipse((bag_cx - 18, bag_top + 18, bag_cx + 10, bag_top + 46), fill=pal["dark"] + (255,))
    draw.line((bag_cx, beam_y + 22, bag_cx, bag_top), fill=pal["shadow"] + (255,), width=4)

    # Side weight discs.
    for ox in (-92, 92):
        cx = w // 2 + ox
        draw.ellipse((cx - 22, h - ped_h - 58, cx + 22, h - ped_h - 10), fill=pal["dark"] + (255,))
        draw.ellipse((cx - 16, h - ped_h - 52, cx + 16, h - ped_h - 16), fill=pal["mid"] + (255,))
        draw.ellipse((cx - 6, h - ped_h - 44, cx + 6, h - ped_h - 24), fill=pal["light"] + (255,))

    # Moss specks on pedestal front.
    for mx, my in ((140, h - 44), (250, h - 36), (360, h - 48), (190, h - 28), (310, h - 32)):
        draw.ellipse((mx - 5, my - 3, mx + 5, my + 3), fill=pal["moss"] + (120,))

    out = feather_and_tint(canvas, feather_px=26, tint_depth=0.16)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, "PNG")
    print(f"Wrote {out_path}")


def main() -> None:
    for path in STATUE_PATHS:
        if not path.exists():
            print(f"Skip missing {path}")
            continue
        img = Image.open(path)
        processed = feather_and_tint(img)
        processed.save(path, "PNG")
        print(f"Processed {path}")

    training_out = BATTLE_DIR / "training" / "training.png"
    build_training_statue(BATTLE_DIR / "arena" / "arena.png", training_out)


if __name__ == "__main__":
    main()
