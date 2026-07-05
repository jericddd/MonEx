# MonEx gear icons

House-exclusive equipment art. Each house has its own folder.

## Layout

```
game_icons/gear/
  chog/           # House of Chog — Croakguard Exchange
    chog.png      # full sprite sheet (source — optional, keep or remove after split)
    weapon-common.png … boots-mythic.png
  molandak/       # House of Molandak — Quillspire Exchange
    molandak.png
    weapon-common.png …
  moyaki/         # House of Moyaki — Geyserfin Exchange
    moyaki.png
    weapon-common.png …
```

Drop each house’s **full sprite sheet** into that house folder (e.g. `molandak/molandak.png`), then run:

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
