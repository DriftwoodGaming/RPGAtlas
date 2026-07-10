# Adding Your Own Art and Music

RPGAtlas makes all of its tiles, sprites, monsters, and music for you — you can build a
whole game without importing anything. But when you want to add **your own** pictures and
sounds, it's as easy as copying a file.

*This page is about the **desktop app**, where each game is a folder (see
[Your Game Is a Folder](Your-Game-Is-a-Folder)). In the web version you add art and music
through the Asset Browser instead — see [the note at the bottom](#using-the-web-version-instead).*

## Just drop it in the folder

Inside your game's folder is an **`assets/`** folder with a place for each kind of file:

| Put this kind of file… | …into this folder |
|---|---|
| Walking character sprites (PNG) | `assets/characters/` |
| Message-box faces (PNG) | `assets/facesets/` |
| Battlers / enemies (PNG) | `assets/enemies/` |
| Map tiles and tile sheets (PNG) | `assets/tilesets/` |
| Music and sound effects (OGG, MP3, WAV, M4A, FLAC) | `assets/audio/` |

**Copy a file into the matching folder with your file manager, switch back to the editor,
and it's there** — no importing, no dialogs. RPGAtlas checks the `assets/` folders each time
you return to the editor window, and you can also check right away with **Scan for New
Files** in the Asset Browser (**Tools ▸ Asset Browser**).

## Big tile sheets open the slicer

If the picture you drop into `assets/tilesets/` is bigger than a single tile, RPGAtlas opens
the friendly **tileset slicer** so you can cut it into tiles: pick the grid size (48px is the
normal choice), click the cells you want, choose whether they're walkable, and each one
becomes a tile in your palette. The slicer shows a gentle "that's a lot of tiles!" warning if
a sheet would make an enormous number of tiles, so you never accidentally flood your game.

## Your files stay exactly where you put them

RPGAtlas **references** your files where they sit — it never moves, renames, or deletes them:

- **Renaming** an asset in the editor only changes its name *in the editor*. The real file on
  disk keeps its own name.
- If a file **goes missing** (you moved or deleted it outside the editor), the Asset Browser
  shows a friendly **"missing"** card instead of breaking. Put the file back and it heals
  itself on the next scan.
- Because every picture and sound lives inside the game's folder, you can **zip the folder,
  move it to another computer, and open it** — all your art and music come along.

## Managing what you've added

**Tools ▸ Asset Browser** is where your imported art and audio live alongside the built-in
art. From there you can search and tag assets, see which ones your game actually uses, find
unused ones, and **Open Project Folder** to jump straight to the files on disk. See
**[The Asset Browser](The-Asset-Browser)** for the full tour.

## Using the web version instead

In the **web version** (the one that runs in a browser tab) there are no folders, so you add
your own art and music through **Tools ▸ Asset Browser ▸ Import Files…** (or by dragging
files onto the browser). Your imports are kept in a per-device library inside your browser
and travel with your game when you Export it. Everything else — the slicer, naming, and the
pickers — works the same. See **[The Asset Browser](The-Asset-Browser)** and
**[Characters & Custom Assets](Characters-and-Custom-Assets)**.
