/* RPGAtlas — src/shared/autotile-draw.ts
   The one shared "draw a map cell" primitive (Phase 3 Stage D).

   Four cell-draw loops used to call `Assets.drawTile(g, id, dx, dy)` directly:
   the 2D editor canvas (map-render.ts), the live HD-2D viewport buildBuffers
   (hd-viewport.ts), the tile-paste preview, and the engine's prerenderMap
   (map-runtime.ts). Routing them all through drawLayerCell keeps autotile
   resolution in lockstep: a plain tile id falls through to the caller's
   `drawTile`; a reserved autotile id resolves its blob from same-group
   neighbours in the SAME layer array and blits the assembled 48x48 canvas.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { neighborMask } from "./autotile";
import { isAutotileId, autotileCanvas } from "./autotile-registry";

type DrawTile = (g: CanvasRenderingContext2D, id: number, dx: number, dy: number) => void;

/**
 * "Same group?" predicate for a layer array. Out-of-bounds neighbours count as
 * connected so terrain blends cleanly to the map edge (matching RPG Maker).
 */
export function sameLayer(
  arr: number[], w: number, h: number, x: number, y: number, id: number,
): (ox: number, oy: number) => boolean {
  return (ox, oy) => {
    const nx = x + ox, ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
    return arr[ny * w + nx] === id;
  };
}

/**
 * Draw one cell of a layer at (dx, dy). `arr` is the layer's flat id array;
 * `drawTile` is the caller's normal tile blitter (Assets.drawTile) used for
 * every non-autotile id.
 */
export function drawLayerCell(
  g: CanvasRenderingContext2D,
  arr: number[], w: number, h: number, x: number, y: number,
  dx: number, dy: number, TILE: number, drawTile: DrawTile,
): void {
  const id = arr[y * w + x];
  if (!id) return;
  if (isAutotileId(id)) {
    const c = autotileCanvas(id, neighborMask(sameLayer(arr, w, h, x, y, id)), TILE);
    if (c) g.drawImage(c, dx, dy);
    // else: source not decoded yet — skip; a later render pass draws it.
  } else {
    drawTile(g, id, dx, dy);
  }
}
