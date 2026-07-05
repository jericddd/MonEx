# MonEx gear icons

House-exclusive equipment art lives here.

## Layout

```
game_icons/gear/
  _sources/          # Full sprite sheets (not used in-game)
    molandak/
      sheet-a.png
      sheet-b.png
      sheet-c.png
  molandak/
    set-a/           # 20 icons: weapon/armor/helmet/boots × common→mythic
    set-b/
    set-c/
  chog/              # (future)
  moyaki/            # (future)
```

## File naming

Each set folder contains 20 PNGs:

- `weapon-common.png` … `weapon-mythic.png`
- `armor-common.png` … `armor-mythic.png`
- `helmet-common.png` … `helmet-mythic.png`
- `boots-common.png` … `boots-mythic.png`

All icons are **128×128**, transparent background.

## Split a new sheet

```bash
# 5 columns (common → mythic), 4 gear rows
python3 scripts/split_gear_sheet.py path/to/sheet.png game_icons/gear/molandak/set-b --rows 4 --cols 5

# Or split all three Molandak sources at once
bash scripts/split_molandak_gear_sets.sh
```

**Set A** (stone/gem style): use `--rows 5` — only the first 4 rows are exported as gear slots.
