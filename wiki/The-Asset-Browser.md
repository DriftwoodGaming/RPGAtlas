# The Asset Browser

**Tools ▸ Asset Browser** manages your imported art and audio. RPGAtlas is
still procedural-first — everything works with zero imports — but the Asset
Browser is where your own PNGs and sound files join the toolkit.

## Importing

Drag files onto the browser (or click **Import Files…**):

| You drop | It becomes |
|---|---|
| PNG / WebP / JPEG | An image asset of the type in the **Images as** selector — Characters (3×4 walk sheets), Facesets, Enemies (battlers), or Tiles (one 48×48 tile per image) |
| OGG / MP3 / WAV | An audio asset, with its role (BGM / BGS / ME / SE) guessed from the file name — edit it any time |

Imported images appear immediately in the same pickers as the built-in art:
character sheets in sprite pickers, tiles in the palette, battlers in the
Enemies tab. Tile names ending `.pass` are passable; `.terrain` marks
walkable terrain.

### The import wizard

Some drops open a wizard step instead of importing directly:

- **Tileset slicer** — an image bigger than one 48×48 tile dropped on the
  **Tiles** tab opens the slicer: pick the source grid (16/24/32/48 px or
  custom, with offset/gap), click cells to include or exclude them, choose
  Blocked / Passable / Terrain naming, and every included cell becomes one
  48px tile named `<base>-r<row>c<col>`.
  (RPG-Maker **A2 autotile blocks** have their own importer:
  **Tools ▸ Import Autotile Sheet…** turns one into a terrain brush.)
- **Sprite sheets** — an image on the **Characters** tab that doesn't divide
  into the 3×4 walking grid can import as a walking charset anyway, or as a
  **flipbook sheet**: set the cell size and add named frame tags
  (`walk 0–3`, `cast 4–7`, …). Sheets stay out of the walking-sprite pickers
  and appear in the Animations tab's Sheet picker instead.
- **Aseprite** — drop a `.json` + `.png` export pair together and the frame
  tags arrive as ready-made ranges (FPS derived from your frame durations).
  Trimmed/non-uniform exports are repacked onto a uniform grid at import.

In **Database ▸ Animations**, a Flipbook item's **Sheet** field lists your
imported sheets; picking a **Frame tag** fills From/To/FPS in one click.

Imports are stored in a **per-device library** — IndexedDB in the browser,
the app-data folder in the desktop app — so they don't count against the
browser's project-size limit and are shared by every project you edit on
this device.

## Where assets travel

- **Project files**: saving or exporting a `.json` embeds the imported
  assets the project actually uses. Open that file on another machine and
  they are imported into that machine's library automatically.
- **Game exports**: standalone games embed only the assets your game
  references — players never need your library.

## Managing

- **Search / tags**: filter by name or tag; click **Tags** on a card to
  edit its labels. Tags starting `pack:` mark starter-pack installs.
- **Used/unused audit**: each card shows whether the current project
  references it; **Unused only** finds dead weight, and the footer totals
  the library's size.
- **Rename** rewrites every reference in the current project so nothing
  breaks. Other projects that reference the old name will show fallbacks
  until you rename it back or re-import.
- **Delete** warns when the current project still uses the asset.
- **Export** downloads the original file back out of the library.

The **Resource Manager** remains the browser for the built-in procedural
tiles, characters, and icons.
