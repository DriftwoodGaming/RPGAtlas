/* RPGAtlas — src/shared/tile-behavior-core.ts
   Pure tile-behavior math (Project Compass M4·A, matrix §11 bits 5–8 /
   12–14): builds the Atlas-tile-id → behavior-flag/terrain-tag lookup from a
   Tileset's `tileProps` (the Database ▸ Tilesets schema: flag byte bit0 bush ·
   bit1 ladder · bit2 counter · bit3 damage; terrain 0–7) plus autotile group
   props, scans a map's painted layers for a presence mask, and answers
   per-tile queries (flags = union of layers, terrain = topmost non-zero —
   MZ `checkLayeredTilesFlags` / `terrainTag` order).

   Pure & unit-tested (tests-unit/tile-behavior.test.ts); the engine glue in
   src/engine/scenes/tile-behavior.ts wires it to the live ctx. Looping-map
   coordinate wrap (`wrapCoord`) lives here too so movement math is testable.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { tileId } from "./tile-flags";
import { tileIdOf } from "./autotile-registry";

/** Behavior flag bits — the Database ▸ Tilesets `tileProps.flag` convention. */
export const BEHAV = { BUSH: 1, LADDER: 2, COUNTER: 4, DAMAGE: 8 } as const;

export interface BehaviorMaps {
  /** Atlas tile id (plain or autotile reserved) → behavior flag byte. */
  flagById: Map<number, number>;
  /** Atlas tile id → terrain tag 1–7. */
  terrainById: Map<number, number>;
}

/**
 * Build the lookup from a Tileset record + the project's autotile groups.
 * `tiles` is the Assets.tiles-shaped array (index = Atlas tile id, `.key` =
 * the asset key tileProps is keyed by).
 */
export function buildBehaviorMaps(
  tileset: { tileProps?: Record<string, any> } | null | undefined,
  autotiles: any[] | null | undefined,
  tiles: ({ key?: string } | null | undefined)[],
): BehaviorMaps {
  const flagById = new Map<number, number>();
  const terrainById = new Map<number, number>();
  const tp = tileset && tileset.tileProps;
  if (tp) {
    tiles.forEach((t, i) => {
      const props = t && t.key != null && tp[t.key];
      if (!props) return;
      if (props.flag) flagById.set(i, props.flag | 0);
      if (props.terrain) terrainById.set(i, props.terrain | 0);
    });
  }
  for (const g of autotiles || []) {
    const p = g && g.props;
    if (!p) continue;
    const id = tileIdOf(g.id);
    if (p.flag) flagById.set(id, p.flag | 0);
    if (p.terrainTag) terrainById.set(id, p.terrainTag | 0);
  }
  return { flagById, terrainById };
}

export interface BehaviorPresence {
  /** Union of behavior bits painted anywhere on the map. */
  presentFlags: number;
  /** Any painted tile carries a terrain tag. */
  terrainPresent: boolean;
}

/** Scan the painted layer arrays for which behaviors this map actually uses —
 *  the per-step gate that keeps behavior-free maps at zero cost. */
export function scanBehaviorPresence(
  layerArrays: number[][],
  maps: BehaviorMaps,
): BehaviorPresence {
  let presentFlags = 0;
  let terrainPresent = false;
  if (maps.flagById.size || maps.terrainById.size) {
    for (const arr of layerArrays) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!v) continue;
        const id = tileId(v);
        const f = maps.flagById.get(id);
        if (f) presentFlags |= f;
        if (!terrainPresent && maps.terrainById.has(id)) terrainPresent = true;
      }
    }
  }
  return { presentFlags, terrainPresent };
}

/** Union of behavior flags across the layers at cell index `i` (top-down
 *  order is irrelevant for a union; MZ checks all planes). */
export function layeredFlagsAtIndex(
  layerArrays: number[][],
  i: number,
  maps: BehaviorMaps,
): number {
  let f = 0;
  for (const arr of layerArrays) {
    const v = arr[i];
    if (v) f |= maps.flagById.get(tileId(v)) || 0;
  }
  return f;
}

/** Topmost non-zero terrain tag at cell index `i`; `layerArrays` must be
 *  ordered top-first (over, decor2, decor, ground — MZ z-order). */
export function terrainTagAtIndex(
  layerArrays: number[][],
  i: number,
  maps: BehaviorMaps,
): number {
  for (const arr of layerArrays) {
    const v = arr[i];
    if (!v) continue;
    const tag = maps.terrainById.get(tileId(v));
    if (tag) return tag;
  }
  return 0;
}

/** Fold a coordinate into [0, size) — the looping-map wrap (M4·A). */
export function wrapCoord(v: number, size: number): number {
  return ((v % size) + size) % size;
}
