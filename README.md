<p align="center">
  <img src="img/system/rpgatlas-logo.svg" width="96" alt="RPGAtlas logo">
</p>

<h1 align="center">RPGAtlas</h1>

<p align="center"><i>Chart your world. Tell your story.</i></p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/License-GPLv3-blue.svg"></a>
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-none-brightgreen.svg">
  <img alt="No build step" src="https://img.shields.io/badge/build_step-none-brightgreen.svg">
</p>

**RPGAtlas** is a complete, original, **free and open source** RPG making engine in the spirit of
classic 2D RPG makers. No copyrighted assets, no build step — everything (code,
tiles, sprites, monsters, sound effects, even the music) is generated procedurally in plain JavaScript.

## Quick start

**Windows — just double-click `RPGAtlas.exe`.** It starts a tiny local server, opens the editor in your
browser, and needs no Python, Node, install, or admin rights. Keep the little black window open while you
work; close it to stop. (Windows may show an "unknown publisher" warning the first time — the launcher is
unsigned; choose *More info → Run anyway*.)

Want it on your Desktop? Double-click **`Create Desktop Shortcut.cmd`** once and an RPGAtlas icon appears
on your Desktop — launch from there any time.

Why a launcher at all? Browsers block `localStorage`/file access on `file://` pages, so the engine has to be
served over `http://`. The `.exe` does exactly that for you.

**Other platforms (or no `.exe`)** — serve the folder yourself and open it:

```
cd RPGAtlas
python -m http.server 8080
```

Then open **http://localhost:8080/** — that's the editor. Either way, hit **▶ Playtest** to play your game
(or open `play.html` directly to play the bundled sample, *Atlas Quest*).

> Building the launcher from source: run `tools/build-engine-launcher.ps1` (uses the .NET Framework C#
> compiler already present on Windows). This produces `RPGAtlas.exe` in the project root.

## The editor (`index.html`)

A classic RPG-maker layout: menu bar (File / Edit / Mode / Draw / Layer / Scale / Tools / Game / Help)
plus an icon toolbar with everything one click away.

| Area | What it does |
|---|---|
| **Map mode** | Paint tiles on 4 layers (Ground / Decor / Decor 2 / Overhead) with Pen, Eraser, Rectangle, Circle, Fill and Shadow Pen tools — or use the **Auto layer**, which sorts terrain vs. decorations for you |
| **Event mode** | Double-click a cell to create/edit an event; drag events to move them |
| **Passability mode** | See ○/✕ for every tile and click to override (auto → force block → force pass) |
| **Height mode (HD-2D)** | Paint per-tile elevation with the same Pen/Rectangle/Circle/Fill tools (keys 0–9 set the value); raised tiles extrude into 3D blocks in HD-2D rendering |
| **HD-2D rendering** | Per-map opt-in WebGL2 mode: tilted perspective camera, extruded terrain, billboard sprites, bloom, depth of field, distance fog and point lights (events named `light #rrggbb radius`); live preview panel in the editor; falls back to the classic 2D renderer automatically |
| **Cut / Copy / Paste** | Shift+drag selects a tile region (all layers + shadows + heights); events copy/paste too |
| **Undo / Redo** | Full-map history for tiles, shadows, heights, passability and events |
| **Database** | Actors, Classes, Skills, Items, Weapons, Armors, Enemies, Troops, States, Switches, Variables, System |
| **System tab** | Game screen width/height, UI area size, screen scale, message & menu fonts, font size, window opacity, remappable system sounds & music themes, side-view or front-view battles, start-transparent player |
| **States** | Poison / stun / regen-style battle effects with per-turn HP %, act restriction, duration and battle-end removal; skills can inflict or cure them |
| **Plugin Manager** | Project-embedded JavaScript with boot, map-load and per-frame hooks |
| **Audio Manager** | Preview every procedural sound effect and music theme |
| **Event Searcher** | Find message text, event names, or switch/variable usage across all maps |
| **Resource Manager** | Browse every generated tile/character/battler; export PNGs (incl. full sprite sheets) |
| **Character Generator** | Compose original walking sprites (skin/hair/outfit/style) usable everywhere |
| **Map Properties** | Rename/resize maps, set music, configure random encounters, enable HD-2D (camera tilt, bloom, depth of field, fog color, lights, ambient) |
| **Open / Export** | Back up the project as `.json` or export a self-contained Windows `.exe` / playable `.html` |

## Custom assets

Custom images live once in the engine's shared `img` folder, so multiple projects can use the same
library without duplicating it:

```text
img/characters   walking sprite sheets (3 columns x 4 directions)
img/facesets     actor portraits matched by filename
img/enemies      enemy battle images
img/tilesets     individual map tiles
img/system       shared UI graphics, including the 8x8 database icon sheet
```

Copy files into the appropriate folder and reload the editor. They automatically appear in the relevant
database picker or map palette. Custom tile filenames control passability:

- `stone.png` is blocked.
- `bridge.pass.png` is passable.
- `meadow.terrain.png` is passable and selected as terrain by Auto Layer.

See [`img/README.md`](img/README.md) for formats. The normal `python -m http.server` workflow discovers
the folders automatically. For hosts without directory listings, run `tools/update-assets.ps1`.
Projects save references rather than image copies, and standalone exports embed only referenced files.

Classes, skills, items, weapons, and armors each have a selectable icon. Replace
`img/system/icon_set.png` with another transparent 256x256, 8x8 sheet to reskin all 64 choices.

Shortcuts: `B/E/R/O/F/S` tools · `0` auto layer, `1–4` layers · `+/-` & `Ctrl`+wheel zoom, `Ctrl+0` 1:1 ·
right-click = pick tile · `Ctrl+Z/Y` undo/redo · `Ctrl+X/C/V` clipboard · `Del` delete selected event.

Passability is per-tile: the topmost decoration tile decides, otherwise the Ground tile —
and Passability mode can override any cell. Overhead tiles draw above the player (treetops, roof edges…).
The Shadow Pen paints half-tile shadow quadrants, just like the classics.

### Events

Events have **pages** with conditions (switch, variable, self-switch); the last matching page is active.
Triggers: Action button, Player touch, Autorun, Parallel. Commands include:

Show Text · Show Choices · Conditional Branch · Control Switch / Self-Switch / Variable ·
Transfer Player · Change Gold / Items / Party · Heal · Start Battle · Open Shop · Set Move Route ·
Camera Zoom · Change Transparency · Wait · Play Sound · Change Music · Erase Event · Save Screen · Game Over ·
Return to Title · Script (JS)

## The player (`play.html`)

- Grid movement with smooth scrolling camera (Arrows/WASD, **Shift** to dash)
- **Z/Enter** confirm/interact · **X/Esc** menu/cancel — mouse works everywhere too
- Message windows with typewriter text, optional speaker faces, inline `\i[n]` icons, and choices
- Full pause menu: Items, Skills, Equip, Status, Save/Load (3 slots), Return to Title
- Turn-based battles in **side view** (animated party sprites) or classic front view:
  Attack / Skills / Items / Guard / Escape, agility turn order, multi-target spells,
  **states** (poison, stun, regen…), EXP/levels/skill learning, gold drops, random encounters
- Twelve procedural enemy families with distinct silhouettes, idle motion, stats, and combat roles
- Pooled combat particles for movement, impacts, skills, magic, healing, guarding, states, and defeats
- Configurable class traits for stats, resistances, skill bonuses, equipment, and combat rules
- Shops with buy/sell, procedural chiptune music & sound effects
- Presentation is project-driven: screen size, UI area, scale, fonts, font size and window opacity
  all come from the Database System tab

## Plugins

Projects embed plain-JavaScript plugins that run at game boot. Each plugin receives the `atlas`
engine bridge (`atlas.onMapLoad`, `atlas.onRender`, `atlas.onMessageText`, `atlas.setTransition`,
`atlas.registerCommand`, `atlas.startBattle`, …) and the `game` script API. Four built-ins ship with
every new project:

- **Atlas_Core** — shared plugin registry and helpers (colors, easing, tweens, RNG)
- **Atlas_TextCodes** — inline icons with `\i[n]`, `\c[n]` color codes, and BBCode (`[b]`, `[i]`, `[color]`, `[size]`) in messages
- **Atlas_Transitions** — transfer effects: fade, iris, curtain, slide (`Atlas.transition = 'iris'`)
- **Atlas_Weather** — rain, storm, snow and fog overlays, per-map or scripted (`Atlas.weather('rain', 6)`)

## Code structure

The editor and player use native JavaScript module entry points. Cohesive systems live
under focused folders instead of accumulating in the entry files:

- `js/editor/project-io.js` - project persistence and standalone build/export
- `js/runtime/messages.js` - message conversion, rich text, typewriter behavior, faces and icons

Shared engine services such as `Assets`, `RA`, and the plugin bridge remain stable globals
for compatibility while additional systems are migrated incrementally.

## Publishing a game

Choose **File > Export Standalone Game** to build the current project as either:

- **Windows EXE** — a small launcher with the complete game appended inside it. Double-clicking the
  executable extracts the game and opens it in the player's default modern browser.
- **Standalone HTML** — one cross-platform game file that can be opened directly in a modern browser.

Players do not need RPGAtlas, the editor, a local web server, or a separate project file.
Save slots are stored by the player's browser. The Windows launcher is unsigned, so Windows may show
a security warning for downloaded builds.

## Project format

Everything lives in one JSON document (also autosaved to your browser):

```
system      – title, start position/transparency, party, gold, currency, switch/variable names,
              screen & UI size, scale, fonts, window opacity, system sounds/music, battle view
states      – battle states: per-turn HP %, act restriction, duration, colors & icons
assets      – stable references for shared custom assets
actors      – name, class, level, sprite, starting equipment
classes     – base stats, per-level growth, traits, equipment permissions + skill learnings
skills      – icon, physical / magical / heal, power, MP cost, scope
items / weapons / armors – icon, effects, prices and parameters
enemies     – stats, rewards, weighted action list, procedural sprite + tint
troops      – enemy groups for battles
maps        – 4 tile layers, shadow + passability-override grids, events
plugins     – name + JS code + enabled flag, run in order at game boot
customChars – sprites built in the Character Generator
```

Projects created with the engine's pre-rebrand release (Driftwood Engine) open and migrate
automatically — autosaves, save slots, and bundled plugins are all carried forward.

## Files

```
index.html        editor shell          js/assets.js   procedural tiles/sprites/battlers
play.html         player shell          js/sfx.js      procedural SFX + generative music
css/editor.css    editor theme          js/data.js     schema, defaults, sample game
css/play.css      game windows          js/engine.js              player module entry
                                        js/runtime/messages.js    message subsystem
                                        js/editor.js              editor module entry
                                        js/editor/project-io.js   persistence and export
```

## License

RPGAtlas is free software, licensed under the **GNU General Public License v3.0 (or later)** —
see [`LICENSE`](LICENSE). You can use, study, share, and modify it; if you distribute a modified
engine, share your changes under the same license.

**Your games are yours.** The content you create — maps, story, database entries, characters,
custom art — is not covered by the engine's license. Exported games bundle the engine runtime,
which remains GPL-licensed; since exports are plain, readable HTML/JS, the source-availability
requirement is satisfied by the export itself. Sell your games, no credit required.
