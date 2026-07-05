# MonEx gear icons

House-exclusive equipment art. Each house has its own folder.

## Layout

```
game_icons/gear/
  chog/           # House of Chog — Croakguard Exchange
    Croakguard.png  # source sprite sheet
    weapon-common.png … boots-mythic.png
  molandak/       # House of Molandak — Quillspire Exchange
    Quillspire.png
    weapon-common.png …
  moyaki/         # House of Moyaki — Geyserfin Exchange
    Geyserfin.png
    weapon-common.png …
```

Drop each house’s **full sprite sheet** into that house folder, then run:

```bash
bash scripts/split_house_gear.sh
```

## Sprite sheet format

- **5 columns** (left → right): Common, Uncommon, Rare, Legendary, Mythic
- **4 rows** (top → bottom): Weapon, Armor, Helmet, Boots
- Black background is removed automatically; output icons are **128×128** PNG

## Single house

```bash
python3 scripts/split_gear_sheet.py game_icons/gear/molandak/molandak.png game_icons/gear/molandak --rows 4 --cols 5
```

## Align manual crops (`sprite_*.png`)

If you cropped icons externally (any `sprite_0000.png` style names), drop them in the house folder and run:

```bash
python3 scripts/align_gear_sprites.py chog molandak
```

This cross-compares each crop to the house sprite sheet and writes `weapon-common.png` … `boots-mythic.png`. **Croakguard** uses a 4×5 play grid; row 5 on the sheet is a redundant boots row used only to pick the closest boot tier. **Moyaki** is skipped until its sheet is ready.
