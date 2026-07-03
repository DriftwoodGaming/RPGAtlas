# Characters & Custom Assets

Everything in RPGAtlas is generated, so you can build a whole game without drawing a single pixel.
But you can also make it unmistakably *yours* — design original sprites in the Character Generator,
or drop your own art into the engine's shared image folders.

---

## The Character Generator

Open **Tools ▸ Character Generator** to compose original walking sprites by mixing parts:

- **Skin**, **hair**, **outfit**, and **style** options combine into a unique character.
- The result is a proper walking sprite sheet (3 columns × 4 directions) usable **everywhere** a
  sprite is — actors, NPC events, anything.

Generated characters are saved with your project (as `customChars`), so they travel with your `.json`
and your exports. No external files to manage.

---

## The Resource Manager

**Tools ▸ Resource Manager** lets you browse **every** generated tile, character, and battler in the
engine, and **export them as PNGs** (including full sprite sheets). Handy for previews, promo images,
or editing a sprite in an external tool and bringing it back as a custom asset.

---

## Adding your own art

Custom images live **once** in the engine's shared `img` folder, so several projects can reuse the
same library without duplicating files. The folders:

| Folder | What goes there |
|---|---|
| `img/characters` | Walking sprite sheets (3 columns × 4 directions) |
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

Items, skills, weapons, armors, and classes each pick an icon from a shared **8×16 icon sheet** (128
icons). To reskin all 128 at once, replace `img/system/icon_set.png` with your own transparent
**256×512** sheet laid out 8×16.

---

## If custom art doesn't show up

The editor discovers your files by scanning the `img` folders. On downloaded copies this just works —
the `RPGAtlas.exe` launcher's server provides the directory listings the scan reads. On a **source
checkout** the Vite dev server doesn't, so run `tools/update-assets.ps1` to write a manifest
(`img/assets.json`) the editor can read instead. More in
[Troubleshooting & FAQ](Troubleshooting-and-FAQ).

**Next:** [Audio →](Audio)
