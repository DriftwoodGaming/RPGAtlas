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

Where your imports are kept depends on which RPGAtlas you're using:

- **Desktop app:** imports go straight into your game's own **`assets/`** folder
  (`assets/characters`, `assets/tilesets`, `assets/audio`, …), so everything a game
  needs lives in one folder you can see and copy. Even easier: just **drop a picture or
  sound into the matching `assets/` folder** with your file manager and it appears in the
  editor — see **[Adding Your Own Art and Music](Adding-Your-Own-Art-and-Music)**.
- **Web version:** imports are kept in a **per-device library** inside your browser
  (IndexedDB), so they don't count against the project-size limit and are shared by every
  project you edit in that browser.

Either way your files are content-deduped, so importing the same file twice is a no-op.

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

## Starter packs

The **Packs** tab installs curated asset bundles into your library with one
click. Every pack asset is tagged `pack:<id>` so it can be filtered, audited,
and uninstalled as a set; installs are content-deduped, so Reinstall (or
retrying a failed download) is always safe.

- **Driftwood Starter** ships with RPGAtlas (CC0 — generated from the
  engine's own procedural art): terrain recolors, four villagers, three
  battlers, two chiptune loops, rain ambience, a victory fanfare, and a
  chime.
- **Add registry URL…** points the tab at any hosted `index.json` (same
  format as `img/packs/index.json`) to install third-party packs. Mind the
  license shown on each pack — exports embed the assets your game uses.

The **Resource Manager** remains the browser for the built-in procedural
tiles, characters, and icons.
