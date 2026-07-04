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

import { isAutotileId, resolveAutotileCell } from "./autotile-registry";
import { tileId, hasFlags, tileFlags, flagTransform } from "./tile-flags";

type DrawTile = (g: CanvasRenderingContext2D, id: number, dx: number, dy: number) => void;

/**
 * "Same group?" predicate for a layer array. Out-of-bounds neighbours count as
 * connected so terrain blends cleanly to the map edge (matching RPG Maker).
 * Neighbours are compared by their MASKED tile id (tile-flags Stage E): a
 * flipped/rotated plain tile — or, defensively, a flag-bearing group id — still
 * matches its untransformed neighbour, so autotile shape resolution is unchanged
 * by the transform bits. (Flags are v1-scoped to plain tiles; masking here is
 * belt-and-braces so a hand-edited file can't confuse the mask.)
 */
export function sameLayer(
  arr: number[], w: number, h: number, x: number, y: number, id: number,
): (ox: number, oy: number) => boolean {
  const base = tileId(id);
  return (ox, oy) => {
    const nx = x + ox, ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
    return tileId(arr[ny * w + nx]) === base;
  };
}

/**
 * Draw one cell of a layer at (dx, dy). `arr` is the layer's flat id array;
 * `drawTile` is the caller's normal tile blitter (Assets.drawTile) used for
 * every non-autotile id. `frame` (Phase 8 Stage C) selects the animation frame
 * for animated terrains — 0 (the default all classic callers pass) is the
 * unanimated, byte-identical case. The per-kind shape/variant/frame resolve
 * lives in the registry (resolveAutotileCell); this stays the single decode seam.
 *
 * Central transform decode (Phase 8 Stage E): the stored value is split raw →
 * { id, flags } here, once, so all four draw paths (2D editor, HD-2D viewport,
 * paste preview, engine prerenderMap) get flip/rotate together. Autotile groups
 * resolve their own shape and are never transformed. Plain tiles with any flag
 * bit are drawn under a per-cell affine (rotate 90° CW / mirror about the cell
 * centre); the overwhelmingly common no-flag cell takes the identical fast path
 * as before this stage (byte-identical — goldens gate it).
 */
export function drawLayerCell(
  g: CanvasRenderingContext2D,
  arr: number[], w: number, h: number, x: number, y: number,
  dx: number, dy: number, TILE: number, drawTile: DrawTile, frame = 0,
): void {
  const raw = arr[y * w + x];
  if (!raw) return;
  const id = tileId(raw);
  if (isAutotileId(id)) {
    // Autotiles resolve shape from neighbours; flags do not apply in v1.
    const c = resolveAutotileCell(id, sameLayer(arr, w, h, x, y, id), TILE, frame, x, y);
    if (c) g.drawImage(c, dx, dy);
    // else: source not decoded yet — skip; a later render pass draws it.
  } else if (hasFlags(raw)) {
    // Plain tile with a transform: apply the affine about the cell, blit the
    // untransformed tile at the cell origin, then restore. save/restore keeps
    // this local to the one cell (callers set globalAlpha/composite around us).
    const m = flagTransform(tileFlags(raw), TILE);
    g.save();
    g.transform(m[0], m[1], m[2], m[3], dx + m[4], dy + m[5]);
    drawTile(g, id, 0, 0);
    g.restore();
  } else {
    drawTile(g, id, dx, dy);
  }
}
