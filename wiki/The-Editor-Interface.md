# The Editor Interface

The editor (`index.html`) uses a classic RPG-maker layout: a **menu bar** along the top, an **icon
toolbar** with one-click actions, and a **dockable workspace** of panels (Maps, Tiles, Map) below.
This page is your map of the map-maker.

---

## The dockable workspace

The Maps, Tiles, and Map views are **panels** you can rearrange freely:

- **Drag a panel by its tab** to move it. Drop it on the **center** of another region to add it there
  as a tab; drop it near a region's **edge** to split that region; drag it **out** (e.g. onto the
  menu bar) to pop it into a **floating window** you can move and resize.
- **Drag the dividers** between panels to resize them.
- Your arrangement is **saved automatically** and restored next time you open the editor.
- The **View** menu shows/hides the Maps and Tiles panels, focuses the Map, cycles focus with `F6`,
  **Resets** the layout to default, and **saves/loads named layouts**. Every one of these is also in
  the Command Palette (`Ctrl+P`).

---

## The live HD-2D Viewport

Press **`F2`** (or **View ▸ HD-2D Viewport**) to dock a panel that renders the current map through the
game's real HD-2D (three.js) engine, using that map's own HD-2D settings. It's a full workspace panel —
split it beside the map, tab it, or float it — and it updates **live** as you paint tiles, edit heights,
place events, or change **Map Properties**.

- **Fly the camera** — it's independent of the in-game camera. **Drag** to pan across the map, **scroll**
  the wheel to zoom toward the cursor, and **Shift-drag** (or **right-drag**) to change the camera tilt.
  **Reset view** re-centers it. None of this changes the map's saved HD-2D tilt.
- **Place point lights with drag gizmos** — **double-click** empty space to drop a light where you click,
  **drag** its handle to move it in the scene, and use the inspector at the bottom to set its **colour**
  and **radius** or **Delete** it. (Lights only glow when **Point lights** is enabled in Map Properties;
  you can also still create lights as events named `light #rrggbb radius`.)

The viewport needs WebGL2; on a browser without it the panel shows a short notice instead.

---

## The menu bar

| Menu | What lives there |
|---|---|
| **File** | New Project, Open/Save Project (`.json`), Export Standalone Game (`.exe`/`.html`) |
| **Edit** | Undo, Redo, Cut, Copy, Paste |
| **Mode** | Switch between **Map**, **Event**, **Passability**, and **Height** modes |
| **Draw** | Choose a drawing tool (Pen, Eraser, Rectangle, Circle, Fill, Shadow Pen) |
| **Layer** | Choose which layer you're painting (Auto, Ground, Decor, Decor 2, Overhead) |
| **Scale** | Zoom level for the canvas |
| **Tools** | The big managers: Database, Plugin Manager, Audio Manager, Event Searcher, Resource Manager, Character Generator — plus the **Command Palette** |
| **Game** | Set Start Position, Playtest, and game-wide settings |
| **Help** | Newest-first Patch Notes, Quick Help, and About RPGAtlas |

The **icon toolbar** duplicates the most common actions so they're always one click away, including
the **▶ Playtest** button.

---

## The four modes

You're always in exactly one mode. Modes decide what clicking the map *does*.

| Mode | What you do | Key idea |
|---|---|---|
| **Map** | Paint tiles to build the world | Most of your time is spent here |
| **Event** | Double-click a cell to create/edit an event; drag events to move them | Where *things happen* — see [Events](Events) |
| **Passability** | See ○/✕ per tile; click to override (auto → block → pass) | Controls where the player can walk |
| **Height (HD-2D)** | Paint per-tile elevation; raised tiles extrude into 3D in HD-2D maps | Optional; see [Maps & Tiles](Maps-and-Tiles#hd-2d-heights) |

---

## Drawing tools (Map & Height modes)

| Tool | Shortcut | What it does |
|---|---|---|
| **Pen** | `Q` | Paint one tile at a time (click and drag) |
| **Eraser** | `W` | Clear tiles |
| **Rectangle** | `E` | Drag a filled rectangle |
| **Circle** | `R` | Drag an ellipse |
| **Fill** | `T` | Flood-fill a connected area |
| **Shadow Pen** | `Y` | Paint half-tile shadow quadrants (Map mode) |

In **Height mode**, keys `0`–`9` set the elevation value the tools paint.

---

## Layers

Maps are built from **four tile layers**, drawn bottom to top:

| Layer | Shortcut | Typical use |
|---|---|---|
| **Auto layer** | `` ` `` | The smart default — sorts terrain vs. decoration automatically |
| **Layer 1 — Ground** | `1` | Grass, dirt, water, floors |
| **Layer 2 — Decor** | `2` | Bushes, rocks, furniture |
| **Layer 3 — Decor 2** | `3` | A second decoration layer for stacking |
| **Layer 4 — Overhead** | `4` | Draws *above* the player — treetops, roof edges, archways |

Beginners can stay on **Auto layer** almost always. Reach for explicit layers when you want fine
control over what stacks on what, or to use the Overhead layer for things the player walks behind.

---

## Keyboard shortcuts at a glance

| Keys | Action |
|---|---|
| `Q` `W` `E` `R` `T` `Y` | Pen · Eraser · Rectangle · Circle · Fill · Shadow Pen |
| `` ` `` | Auto layer · `1`–`4` choose layer |
| `0`–`9` | Set the painted elevation (Height mode only) |
| `Tab` / `Shift+Tab` | Cycle to the next / previous mode |
| `+` / `-` | Zoom in/out · `Ctrl`+wheel zoom · `0` reset to 1:1 |
| **Right-click** | Pick the tile under the cursor |
| `F1` | Open the **Database** |
| `F2` | Show the live **HD-2D Viewport** panel |
| `F5` | **Playtest** (save and run the game) |
| `F6` | Focus the next workspace panel |
| `Ctrl+P` | **Command Palette** — type a few letters of any editor command and press Enter to run it |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo (full-map history) |
| `Ctrl+X` / `Ctrl+C` / `Ctrl+V` | Cut / Copy / Paste |
| **Shift+drag** | Select a tile region (all layers + shadows + heights) |
| `Del` | Delete the selected event |

---

## The big managers (Tools menu)

| Manager | What it's for |
|---|---|
| **Database** | The data behind your game — actors, classes, skills, items, enemies, system settings. See [The Database](The-Database) |
| **Plugin Manager** | Add or edit JavaScript plugins. See [Plugins](Plugins) |
| **Audio Manager** | Preview every procedural sound effect and music theme. See [Audio](Audio) |
| **Event Searcher** | Find message text, event names, or switch/variable usage across *all* maps |
| **Resource Manager** | Browse every generated tile/sprite/battler and export them as PNGs |
| **Character Generator** | Compose original walking sprites (skin/hair/outfit/style). See [Characters & Custom Assets](Characters-and-Custom-Assets) |

---

## Selecting, copying, and pasting regions

Hold **Shift** and drag in Map mode to select a rectangular region. The selection grabs **all four
tile layers plus shadows and heights**. Copy it (`Ctrl+C`) and paste (`Ctrl+V`) elsewhere — perfect
for repeating a building, a forest patch, or a room. Events can be copied and pasted too.

**Next:** [Maps & Tiles →](Maps-and-Tiles)
