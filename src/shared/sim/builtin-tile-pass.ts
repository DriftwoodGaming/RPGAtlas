/* RPGAtlas — src/shared/sim/builtin-tile-pass.ts
   Project Beacon MP5·A: the passability flag of every BUILT-IN tile, by tile id.

   The engine resolves a plain tile's walkability from `Assets.tiles[id].pass`
   (js/assets.js `defTile(key, name, pass, draw)`), a DOM/canvas module the
   headless Beacon server cannot load. The 58 built-in tiles have FIXED pass
   flags (ids 0–57, assigned in defTile order); this table mirrors them exactly
   so the server can bake map collision (collision.ts) with no browser.

   Faithfulness is CI-guarded: tests-unit/collision.test.ts re-parses
   js/assets.js and asserts this table still matches the source, so a future
   edit to a built-in tile's `pass` flag can't silently desync server collision
   from the engine. Project (imported/authored) tiles get ids ≥ 58 and resolve
   their pass flag from the `.pass`/`.terrain` asset-name convention instead
   (collision.ts), so they are NOT in this table.

   Pure data — no imports, no DOM. GPL-3.0-or-later (see LICENSE). */

/** Passability of built-in tile `id` (true = walkable). Index is the tile id
 *  (defTile order in js/assets.js). Ids at or beyond this length are project
 *  tiles, resolved separately. Kept as a keyed table below for readability;
 *  {@link BUILTIN_TILE_PASS} is the id-indexed boolean array the baker reads. */
const BUILTIN_TILES: ReadonlyArray<readonly [string, boolean]> = [
  ["empty", false],
  ["grass", true],
  ["flowers", true],
  ["tallgrass", true],
  ["dirt", true],
  ["sand", true],
  ["path", true],
  ["water", false],
  ["deepwater", false],
  ["stonefloor", true],
  ["woodfloor", true],
  ["carpet", true],
  ["cavefloor", true],
  ["bridge", true],
  ["stairs", true],
  ["tree", false],
  ["pine", false],
  ["bush", false],
  ["rock", false],
  ["fence", false],
  ["cliff", false],
  ["wall_brick", false],
  ["wall_wood", false],
  ["wall_stone", false],
  ["roof_red", false],
  ["roof_blue", false],
  ["door", true],
  ["window", false],
  ["table", false],
  ["chair", true],
  ["bed", false],
  ["shelf", false],
  ["counter", false],
  ["pot", false],
  ["barrel", false],
  ["cavewall", false],
  ["lava", false],
  ["mushroom", true],
  ["snow", true],
  ["ice", true],
  ["swamp", false],
  ["crystalfloor", true],
  ["checkered", true],
  ["brickfloor", true],
  ["snowtree", false],
  ["cactus", false],
  ["deadtree", false],
  ["crystals", false],
  ["pillar", false],
  ["crate", false],
  ["chest", false],
  ["statue", false],
  ["flowerpot", false],
  ["lava_rock", false],
  ["bookshelf", false],
  ["torch", false],
  ["waterlily", true],
  ["cobweb", true],
];

/** Built-in tile keys in id order (drift-guard reference — the test compares
 *  this list AND the pass flags against js/assets.js). */
export const BUILTIN_TILE_KEYS: readonly string[] = BUILTIN_TILES.map((t) => t[0]);

/** Passability by built-in tile id (true = walkable). Ids ≥ length are project
 *  tiles (see collision.ts). */
export const BUILTIN_TILE_PASS: readonly boolean[] = BUILTIN_TILES.map((t) => t[1]);
