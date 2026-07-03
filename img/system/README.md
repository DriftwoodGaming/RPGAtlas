# System Graphics

`icon_set.png` is the engine-wide database and menu icon sheet.

- Size: 256x512 pixels
- Grid: 8 columns x 16 rows
- Cell size: 32x32 pixels
- Format: transparent PNG

Replace the file with another sheet using the same dimensions and layout to reskin all project icons.
Database entries store icon numbers from 0 through 127, read left-to-right and top-to-bottom.

Rows 0-7 are the original hand-tuned icons. Rows 8-15 are derived from them by
`scripts/build-icon-set.mjs` (recolors, flips, and element-glyph composites) — rerun that script
after editing the top half to keep the derived half in sync.
