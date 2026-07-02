# Maps & Tiles

Maps are the stage your whole game plays out on. This page covers building them well: layers,
passability, shadows, map properties, encounters, and the optional HD-2D height system.

---

## Creating and managing maps

- **Add a map** from the map list. A project can have as many maps as you like, connected by
  [Transfer Player](Events#movement--the-world) events.
- **Map Properties** (the **Map** menu, or right-click a map in the list) lets you:
  - Rename and **resize** the map.
  - Set the map's **music**.
  - Configure **random encounters** (troops + rate).
  - Enable **HD-2D** rendering and its options (camera tilt, bloom, depth of field, fog, lights).

> Resizing keeps the tiles you've already painted where possible. It's safe to grow a map as your
> ideas grow.

---

## The four layers

Every map has four tile layers, painted bottom to top:

1. **Ground** — the base terrain (grass, floors, water).
2. **Decor** — objects sitting on the ground (rocks, bushes, furniture).
3. **Decor 2** — a second decoration layer for stacking detail.
4. **Overhead** — drawn *above* the player, so they pass *behind* it (treetops, roofs, arches).

### Auto layer (the easy mode)

With **Auto layer** selected (press `0`), RPGAtlas decides the right layer for each tile you paint —
terrain goes to Ground, decorations go above. For most maps you never need to leave Auto layer.
Switch to an explicit layer (`1`–`4`) only when you want precise control, especially for the
**Overhead** layer.

---

## Passability — where the player can walk

Passability decides which tiles block movement.

- **It's automatic by default.** The engine reads it from the tiles: the **topmost decoration tile**
  decides, and if there's none, the **Ground** tile does.
- **Tile filenames can declare passability** for custom art (see
  [Characters & Custom Assets](Characters-and-Custom-Assets#tile-filenames-control-passability)).
- **Override any cell** in **Passability mode**: click a tile to cycle **auto → force block →
  force pass**. Tiles show **○** (walkable) or **✕** (blocked).

Use overrides for the little exceptions: a walkable bridge over water, a decorative fence the player
shouldn't cross, the impassable edge of the world.

---

## Shadows

The **Shadow Pen** (`S`, in Map mode) paints **half-tile shadow quadrants**, exactly like the
classic makers. Drop shadows along the west and south sides of walls, cliffs, and buildings to give
your maps depth and a hand-crafted look.

---

## Random encounters

Instead of (or alongside) fixed [Start Battle](Battles-and-States) events, a map can throw random
battles as the player walks:

1. Open **Map Properties** for the map.
2. Turn on encounters and add one or more **troops**.
3. Set an **encounter rate** (lower = more frequent).

Pair this with safe maps (towns) that have *no* encounters so players get a breather.

---

## HD-2D heights

RPGAtlas has an optional **HD-2D** rendering mode: a tilted perspective camera with extruded terrain,
billboard sprites, bloom, depth of field, distance fog, and point lights — reminiscent of modern
"2D-HD" remakes. It's **per-map and opt-in**, and falls back to the classic flat 2D renderer
automatically if a device can't run it.

### Painting heights

1. Switch to **Height mode** (the **Mode** menu).
2. Press a number key `0`–`9` to choose an elevation value.
3. Paint with the same **Pen / Rectangle / Circle / Fill** tools.

Raised tiles **extrude into 3D blocks** when the map is rendered in HD-2D — instant cliffs, plateaus,
and raised walkways.

### Turning on HD-2D for a map

Enable HD-2D in **Map Properties**, where you'll also find its look-and-feel controls: camera tilt,
bloom, depth of field, fog color, ambient light, and lights.

Press **`F2`** (or **View ▸ HD-2D Viewport**) to open the live **HD-2D Viewport** — a dockable panel that
renders the map with the same elevation and lighting renderer as the game runtime and follows tile,
height, event, ambient-light, and point-light edits as you make them. Its camera is independent of the
game: drag to pan, wheel to zoom, Shift-drag (or right-drag) to tilt. You can also **double-click** the
viewport to drop a point light and drag its gizmo to position it. See [The Editor Interface](The-Editor-Interface).

### Lights

Place a light by creating an event named like:

```
light #ffaa55 4
```

That's an event whose **name** is `light`, followed by a hex color and a radius. Lanterns,
campfires, and glowing crystals come to life in HD-2D maps.

> HD-2D is a presentation choice, not a different kind of game. You build the map exactly the same
> way; heights and the HD-2D toggle just change how it's drawn.

**Next:** [Events →](Events)
