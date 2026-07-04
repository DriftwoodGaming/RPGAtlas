# The Advanced Map Editor

Press **`F4`** (or open the **Advanced** menu) to dock the **Advanced Map Editor** — a power-mapping
panel that works on the *same map* as the classic Map panel. Everything here is optional: a map you
never touch with these tools is saved byte-for-byte exactly as before, and the classic editor keeps
working on any map, advanced or not. Undo (`Ctrl+Z`) spans both editors — paint in one, undo in the
other.

Want a guided tour? The sample project ships a showcase map, **Meridian Village — Advanced**, with a
full layer stack, one zone of every kind, and two ready-to-run Automap rules.

---

## Layers without limits

The classic editor gives every map four fixed layers. The Advanced panel's **Layers list** turns that
into a full stack:

- **Add tile layers** — as many as you like, above or below the four core layers (which are always
  there and always store what the classic editor paints).
- **Group layers** and fold whole groups in and out. Groups can nest.
- Per layer: **visibility**, **lock** (blocks edits, not rendering), **opacity**, a **blend mode**
  (normal / add / multiply / screen), a **tint** color, and a **slot** — *below* renders under the
  player, *above* renders overhead.
- **Drag to reorder**; double-click to rename.

Blend and opacity are baked into the map's render buffers, so the HD-2D viewport and exported games
show exactly what the editor shows. The first time you add a layer, the map quietly upgrades to the
generalized stack; until then nothing about it changes on disk.

## Painting, flipping, rotating

Painting works like the classic editor (pen / erase / fill / rectangle, same tile selection and brush
size), applied to whichever layer is active in the list. Three keys transform the brush while the
Advanced panel is focused:

| Key | Action |
|---|---|
| `X` | Flip the brush left ↔ right |
| `Y` | Flip the brush top ↕ bottom |
| `R` | Rotate the brush 90° clockwise |

A little indicator by the zoom shows the current transform. Flipped and rotated tiles render
correctly in the editor, in playtests, and in exported games — and terrain brushes keep resolving
their own shape (transforms apply to ordinary tiles).

## The searchable tile palette

The panel's right rail has its own **Tiles** tab with a search box and category chips (Terrain,
Water, Floor, Walls, Nature, Objects) so you can find a tile without scrolling a whole sheet.

## Stamps

Select an area in the Map view, then **Advanced ▸ Save Selection as Stamp…** to keep it as a
reusable **stamp**. Stamps live with the project (the sample project ships a "Rock cluster" one):

- Click **📌** on a stamp to arm it, then click the map to place it — placement is one undo step.
- Toggle **🎲 random scatter** to sprinkle the stamp across your brush area with an adjustable
  chance per spot — great for foliage, rubble, and clutter.

## Terrain & Autotile Studio

**Advanced ▸ Terrain & Autotile Studio…** turns any imported tile sheet into a *smart terrain brush*
that picks its own edges, corners, and inside pieces as you paint. Five steps — **Source, Layout,
Terrain Types, Rules, Preview** — with auto-detection of common sheet arrangements (A2 terrain,
animated A1 water, fences, walls, roofs):

- **Animate** a terrain (frames + speed) and water or lava flows in the editor, the HD-2D viewport,
  and playtests alike.
- **Weighted variations** let each cell pick randomly from alternate sheets, so big fields stop
  tiling obviously.
- **Pattern completion** fills in shapes you didn't draw by mirroring/rotating the ones you did.

The Studio needs an image sheet to work from — see [The Asset Browser](The-Asset-Browser) for
importing one. (The built-in procedural tiles don't use sheets, which is why the sample project's
showcase map points you here instead of shipping a terrain.)

## Objects & gameplay zones

Switch the panel's mode rail to **Objects** to draw *zones* — shapes with gameplay meaning — straight
onto the map. Pick a kind, then draw a **Rectangle**, **Ellipse**, **Polygon** (double-click to
finish), or **Point**; the Select tool drags corner handles to reshape. Each kind has its own little
inspector:

| Zone kind | While the player is inside… |
|---|---|
| **Encounter** | Replaces the map's random-battle pool (with a one-click **Test Encounter in This Area**) |
| **Transfer** | Warps the player somewhere else on entry |
| **Sound** | Loops an ambience layer, with optional distance falloff |
| **Weather** | Applies weather, restoring the map's own on exit |
| **Collision** | Makes the covered tiles solid |
| **Nav** | Makes the covered tiles walkable (stepping stones over water!) |
| **Spawn** | A marker for plugins that spawn things |
| **Custom** | Nothing by itself — read it from plugins or Script via `atlas.zonesAt(x, y)` |

Collision and nav are baked in when the map loads, so movement stays fast no matter how many zones
you draw. A map with no zones plays exactly as before.

## Automap rules

The **Automap drawer** (bottom of the panel, or **Advanced ▸ Automap Rules…**) writes map detail for
you from plain **IF / AND / THEN** rules — no scripting:

> **IF** this tile is grass **AND** it's near water **THEN** place reeds, 35% of the time.

- Conditions: *terrain is*, *tile is*, *near*, *not near*, *region is*, *passable* — all ANDed.
- Actions: *place a tile*, *place a stamp*, *set a region*, each with an optional probability.
- **Preview** paints the pending changes as an overlay (green tiles, magenta regions) right on the
  map; **Apply** commits them as **one undo step**. Preview and Apply always produce the identical
  result — each rule carries a random seed, and the **🎲** button re-rolls it when you want a
  different scatter.
- Rules are saved with the map but are an **editor tool only**: they never run in the finished game,
  and exports are byte-for-byte unchanged.

## For plugin authors

- `atlas.zonesAt(x, y)` (and the Script command's `game.zonesAt`) returns the zones covering a tile,
  in author draw order — custom zones make it a general-purpose "regions with data" system.
- The generalized layer stack lives on the map as `layersAdv`; zones as `zones`; rules as
  `automapRules`; stamps on the project as `stamps`. All optional — see
  [Plugin & Script API](Plugin-and-Script-API).

---

*Next: put the polish on with [HD-2D heights](Maps-and-Tiles#hd-2d-heights) or wire up
[Events](Events).*
