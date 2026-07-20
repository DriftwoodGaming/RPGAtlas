/* RPGAtlas — src/shared/sim/collision.ts
   Project Beacon MP5·A: headless map passability for the Beacon server.

   The engine's authoritative movement (scenes/map-runtime.ts `tilePassable`)
   reads the DOM-built `Assets.tiles[]` and the live `ctx.map` — a server has
   neither. This module derives the SAME static passability from the project +
   map data alone, with no browser: per-cell `passOv` overrides win, then the
   decor2 → decor → ground layer stack resolves through built-in / project /
   autotile pass flags, exactly as the engine does. It bakes a boolean grid
   ONCE per map so the per-step check in the server tick is an array read
   (bots × ticks × steps makes this hot).

   SCOPE (Driftwood 2026-07-19: "add minimal wall collision now"): STATIC tile
   walls only. Dynamic collision — events/NPCs blocking a tile, Phase-8 gameplay
   zone pass overlays, ledge jumps, vehicles — is the engine's per-frame job and
   is the MP8·A headless per-zone runtime (roadmap D-0). The server therefore
   blocks walls and water; it does not yet run event/NPC collision. This mirrors
   the engine's `tilePassable` MINUS the `mapHasZones()` overlay and the event
   check (`blockingEventAt`), which the engine applies on top separately.

   Headless by law (sim lint wall): imports only pure shared modules. No DOM,
   no Assets, no engine. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { tileId } from "../tile-flags.js";
import { isAutotileId, autotilePassable } from "../autotile-registry.js";
import { wrapCoord } from "../tile-behavior-core.js";
import { BUILTIN_TILE_PASS } from "./builtin-tile-pass.js";

/** The engine's numeric grid-direction offsets (DIRD keys): 0=down 1=left
 *  2=right 3=up, then diagonals 4=down-left 5=down-right 6=up-left 7=up-right.
 *  Kept local so this module stays off the engine graph. */
export const DIR_OFFSET: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1],
];

/** A baked static-passability grid for one map. `pass[y*width+x]` is 1 when the
 *  tile is walkable. Looping flags fold out-of-range coords back in (M4·A). */
export interface MapCollision {
  width: number;
  height: number;
  loopH: boolean;
  loopV: boolean;
  pass: Uint8Array;
}

/** Reverse of `proj.assets.tiles` (a key→id map the engine persists so project
 *  tile ids stay stable): the set of PROJECT tile ids whose asset key carries
 *  the `.pass`/`.terrain` walkability convention. Built once per project. The
 *  engine sets a project tile's pass from `/\.(pass|terrain)$/` on its asset
 *  name (js/assets.js bindExternalAssets); the persisted key retains that
 *  suffix (asset-library.ts), so the same test on the key is equivalent. */
function passableProjectTileIds(proj: any): Set<number> {
  const out = new Set<number>();
  const tiles = proj && proj.assets && proj.assets.tiles;
  if (!tiles) return out;
  for (const key of Object.keys(tiles)) {
    const id = Number(tiles[key]);
    if (Number.isInteger(id) && /\.(pass|terrain)$/i.test(key)) out.add(id);
  }
  return out;
}

/** Static passability of one already-masked tile id, mirroring the engine's
 *  `tileDefPass`: autotiles read the project group's pass flag; built-ins read
 *  the fixed table; project tiles read the `.pass`/`.terrain` key set. An id
 *  outside all three (a null/unknown tile) is blocked, exactly as
 *  `Assets.tiles[id] ? .pass : false`. */
function tileDefPass(proj: any, id: number, projPassSet: Set<number>): boolean {
  if (id === 0) return false;
  if (isAutotileId(id)) return autotilePassable(proj && proj.autotiles, id);
  if (id < BUILTIN_TILE_PASS.length) return BUILTIN_TILE_PASS[id];
  return projPassSet.has(id);
}

/** Static passability of one cell, mirroring the engine's layer stack: a
 *  `passOv` override (1=force pass, 2/3=block, 3=ledge) wins; otherwise the
 *  topmost non-empty layer (decor2 → decor → ground) decides, and a cell with
 *  no ground is blocked. */
function cellPass(proj: any, map: any, idx: number, projPassSet: Set<number>): boolean {
  const ov = map.passOv ? map.passOv[idx] | 0 : 0;
  if (ov === 1) return true;
  if (ov === 2 || ov === 3) return false; // 3 = ledge: blocked for plain walking
  const layers = map.layers || {};
  const d2 = tileId((layers.decor2 && layers.decor2[idx]) | 0);
  if (d2 !== 0) return tileDefPass(proj, d2, projPassSet);
  const d = tileId((layers.decor && layers.decor[idx]) | 0);
  if (d !== 0) return tileDefPass(proj, d, projPassSet);
  const g = tileId((layers.ground && layers.ground[idx]) | 0);
  if (g === 0) return false;
  return tileDefPass(proj, g, projPassSet);
}

/** Bake a map's static passability into a boolean grid. Pure: no map load, no
 *  Assets — just the project + the map record (`proj.maps[i]`). Call once per
 *  map when a room first needs it; the server caches the result by map id. */
export function bakeMapCollision(proj: any, map: any): MapCollision {
  const width = Math.max(0, Number(map.width) | 0);
  const height = Math.max(0, Number(map.height) | 0);
  const pass = new Uint8Array(width * height);
  const projPassSet = passableProjectTileIds(proj);
  for (let idx = 0; idx < pass.length; idx++) {
    pass[idx] = cellPass(proj, map, idx, projPassSet) ? 1 : 0;
  }
  const loop = map.loop || {};
  return { width, height, loopH: !!loop.h, loopV: !!loop.v, pass };
}

/** True when tile (x,y) is walkable. Looping maps fold out-of-range coords in;
 *  bounded maps block anything off-grid (bounds-safe). */
export function isPassable(mc: MapCollision, x: number, y: number): boolean {
  let cx = x;
  let cy = y;
  if (mc.loopH) cx = wrapCoord(cx, mc.width);
  if (mc.loopV) cy = wrapCoord(cy, mc.height);
  if (cx < 0 || cy < 0 || cx >= mc.width || cy >= mc.height) return false;
  return mc.pass[cy * mc.width + cx] === 1;
}

/** A diagonal step may not squeeze between two blocked cardinal neighbours
 *  (the engine's `diagonalStepClear`). Cardinal steps always clear this. */
export function diagStepClear(mc: MapCollision, x: number, y: number, dir: number): boolean {
  const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
  if (dx === 0 || dy === 0) return true;
  return isPassable(mc, x + dx, y) && isPassable(mc, x, y + dy);
}

/** True when a walker at (x,y) may take a step in grid direction `dir` on this
 *  map: the corner check passes AND the destination tile is walkable. The
 *  server's authoritative movement calls this before committing a step. */
export function canStep(mc: MapCollision, x: number, y: number, dir: number): boolean {
  const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
  if (dx === 0 && dy === 0) return false;
  if (!diagStepClear(mc, x, y, dir)) return false;
  return isPassable(mc, x + dx, y + dy);
}
