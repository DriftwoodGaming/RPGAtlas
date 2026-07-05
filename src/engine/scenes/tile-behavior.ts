/* RPGAtlas — src/engine/scenes/tile-behavior.ts
   Per-tile behavior flags + terrain tags (Project Compass M4·A): the engine
   glue over the pure core (src/shared/tile-behavior-core.ts). A lookup cache
   is rebuilt on every map load; a presence mask scanned from the painted
   layers lets every query short-circuit on maps without a behavior — classic
   maps stay byte-identical (movement, rendering, RNG draws; draw-conservation
   is THE contract).

   Looping maps (M4·A, MZ `scrollType`) wrap here too: `wrapX`/`wrapY` fold a
   coordinate back into the grid when `map.loop` asks for it, and are identity
   (one property read) otherwise — map-runtime routes every tile read through
   them. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA } from "../../shared/deps.js";
import { ctx } from "../state/engine-context.js";
import {
  BEHAV,
  buildBehaviorMaps,
  layeredFlagsAtIndex,
  scanBehaviorPresence,
  terrainTagAtIndex,
  wrapCoord,
  type BehaviorMaps,
} from "../../shared/tile-behavior-core.js";

export { BEHAV };

let maps: BehaviorMaps = { flagById: new Map(), terrainById: new Map() };
let presentFlags = 0;
let terrainPresent = false;

/** Wrap an x coordinate into the grid on horizontally-looping maps (identity
 *  otherwise — non-loop maps keep exact pre-M4 bounds behavior). */
export function wrapX(x: number): number {
  const m = ctx.map;
  return m && m.loop && m.loop.h ? wrapCoord(x, m.width) : x;
}
/** Wrap a y coordinate on vertically-looping maps (see wrapX). */
export function wrapY(y: number): number {
  const m = ctx.map;
  return m && m.loop && m.loop.v ? wrapCoord(y, m.height) : y;
}

/** Rebuild the tile-id → behavior/terrain cache for the current map. Called
 *  from loadMap. Sources: the map's Tileset record (tileProps keyed by the
 *  same `asset:` keys Assets.tiles carries) + autotile group props. */
export function rebuildTileBehaviors(): void {
  maps = { flagById: new Map(), terrainById: new Map() };
  presentFlags = 0;
  terrainPresent = false;
  const proj = ctx.proj, m = ctx.map;
  if (!proj || !m) return;
  const ts = RA.byId(proj.tilesets || [], m.tilesetId || 0);
  maps = buildBehaviorMaps(ts, proj.autotiles, Assets.tiles);
  // Presence scan reads the classic four role arrays — the same planes
  // tilePassable consults.
  const L = m.layers;
  const scan = scanBehaviorPresence([L.ground, L.decor, L.decor2, L.over], maps);
  presentFlags = scan.presentFlags;
  terrainPresent = scan.terrainPresent;
}

/** True when any painted tile on the current map carries `bit`. */
export function mapHasBehavior(bit: number): boolean {
  return (presentFlags & bit) !== 0;
}

// Top-first layer order (over, decor2, decor, ground — MZ z-order).
function topFirstLayers(): number[][] {
  const L = ctx.map.layers;
  return [L.over, L.decor2, L.decor, L.ground];
}
function flagsAt(x: number, y: number): number {
  const m = ctx.map;
  x = wrapX(x); y = wrapY(y);
  if (!m || x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
  return layeredFlagsAtIndex(topFirstLayers(), y * m.width + x, maps);
}

/** Union-of-layers behavior checks (MZ `checkLayeredTilesFlags`). Each gates
 *  on the presence mask first so behavior-free maps exit in one bitwise test. */
export function bushAt(x: number, y: number): boolean {
  return (presentFlags & BEHAV.BUSH) !== 0 && (flagsAt(x, y) & BEHAV.BUSH) !== 0;
}
export function ladderAt(x: number, y: number): boolean {
  return (presentFlags & BEHAV.LADDER) !== 0 && (flagsAt(x, y) & BEHAV.LADDER) !== 0;
}
export function counterAt(x: number, y: number): boolean {
  return (presentFlags & BEHAV.COUNTER) !== 0 && (flagsAt(x, y) & BEHAV.COUNTER) !== 0;
}
export function damageFloorAt(x: number, y: number): boolean {
  return (presentFlags & BEHAV.DAMAGE) !== 0 && (flagsAt(x, y) & BEHAV.DAMAGE) !== 0;
}

/** The terrain tag under a tile: topmost non-zero tag wins (MZ z-order), 0 =
 *  none. */
export function terrainTagAt(x: number, y: number): number {
  if (!terrainPresent) return 0;
  const m = ctx.map;
  x = wrapX(x); y = wrapY(y);
  if (!m || x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
  return terrainTagAtIndex(topFirstLayers(), y * m.width + x, maps);
}
