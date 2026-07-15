# Characters & Custom Assets

Everything in RPGAtlas is generated, so you can build a whole game without drawing a single pixel.
But you can also make it unmistakably *yours* — design original sprites in the Character Generator,
or drop your own art into the engine's shared image folders.

---

## The Character Generator

Open **Tools ▸ Character Generator** to compose original walking sprites by mixing parts:

- **Skin**, **hair**, **outfit**, and **style** options combine into a unique character.
- Choose one of four separately drawn sprite builds. **Classic Pixel** keeps the balanced RPGAtlas
  proportions; **Chibi** has a large expressive head and tiny limbs; **Heroic** uses a smaller head,
  broad shoulders, and longer legs; **Storybook** uses a higher-detail 2px construction. Each style
  card shows your current character, and the animated compass preview updates immediately.
- Change the character's **body build**, **hair**, **outfit**, and **accessory**. Builds range from
  slim to broad or compact; outfits include tunics, robes, armor, and coats; accessories include
  capes, scarves, glasses, and headbands. Hair includes bobs, ponytails, mohawks, hats, and hoods.
- Set skin, hair, eye, clothing, pants, accent, and hat/hood colors independently.
- **Randomize look** keeps the selected art style and creates a coordinated character;
  **Surprise me** also chooses a new sprite build.
- Choose **4 directions** for the classic down/left/right/up format, or **8 directions** to add
  individually rendered down-left, down-right, up-left, and up-right poses. Clicking a compass
  direction focuses its full-size animated preview.
- **Export 4-dir PNG** creates a 144×192 sheet. **Export 8-dir PNG** creates a 144×384 sheet whose
  rows are D, L, R, U, DL, DR, UL, UR. You can export either format before or after saving.
- Saved eight-direction characters use their diagonal art during play. Legacy four-row sheets and
  four-direction generator characters keep the compatible left/right pose when moving diagonally.
- The result is usable **everywhere** a sprite is — actors, NPC events, anything.

Generated characters are saved with your project (as `customChars`), so they travel with your `.json`
and your exports. No external files to manage.

---

## The Resource Manager

**Tools ▸ Resource Manager** lets you browse **every** generated tile, character, and battler in the
engine, and **export them as PNGs** (including full sprite sheets). Handy for previews, promo images,
or editing a sprite in an external tool and bringing it back as a custom asset.

---

## Adding your own art

> **Making a game in the desktop app?** The easiest way to add art and music is to drop files
> straight into your game's own **`assets/`** folder — see
> **[Adding Your Own Art and Music](Adding-Your-Own-Art-and-Music)**. The shared `img/` folders
> below are the engine's built-in library (handy when you're running RPGAtlas from its source
> folder or want art shared across every project).

Custom images live **once** in the engine's shared `img` folder, so several projects can reuse the
same library without duplicating files. The folders:

| Folder | What goes there |
|---|---|
| `img/characters` | Walking sprite sheets (3 columns × 4 directions; the generator can also export 3 × 8) |
| `img/facesets` | Actor portraits, matched to actors by filename |
| `img/enemies` | Enemy battle images |
| `img/tilesets` | Individual map tiles |
| `img/system` | Shared UI graphics, including the 8×8 database icon sheet |

**To add art:** copy your files into the right folder and reload the editor. They appear
automatically in the relevant database picker or the map tile palette.

> Projects save **references** to shared art, not copies — so your `.json` stays small. When you
> **export** a standalone game, only the assets you actually used are embedded. See
> [Publishing Your Game](Publishing-Your-Game).

For exact image sizes and formats, see `img/README.md` in the project.

---

## Tile filenames control passability

Custom **tile** filenames can declare how the tile behaves on the map, so you don't have to set it by
hand every time:

| Filename pattern | Behavior |
|---|---|
| `stone.png` | **Blocked** — the player can't walk on it |
| `bridge.pass.png` | **Passable** — the player can walk on it |
| `meadow.terrain.png` | **Passable** *and* treated as **terrain** by Auto Layer |

You can always override any individual cell later in **Passability mode** — see
[Maps & Tiles](Maps-and-Tiles#passability--where-the-player-can-walk).

---

## Reskinning the database icons

Items, skills, weapons, armors, classes, enemies, and states each pick an icon from a shared set. To
add your own, open any **Choose Icon** dialog and click **Add Icons…**. You can select multiple 32×32
PNG, WebP, or JPEG images, or import a sheet whose width and height are multiples of 32; RPGAtlas
splits sheets into 32×32 cells and saves the new icons with the project.

The original 128 icons still come from the bundled **8×16 icon sheet**. To reskin those built-ins all
at once, replace `img/system/icon_set.png` with your own transparent **256×512** sheet laid out 8×16.

---

## If custom art doesn't show up

The editor discovers your files by scanning the `img` folders. On downloaded copies this just works —
the `RPGAtlas.exe` launcher's server provides the directory listings the scan reads. On a **source
checkout** the Vite dev server doesn't, so run `tools/update-assets.ps1` to write a manifest
(`img/assets.json`) the editor can read instead. More in
[Troubleshooting & FAQ](Troubleshooting-and-FAQ).

**Next:** [Audio →](Audio)
