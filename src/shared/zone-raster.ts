/* RPGAtlas — src/shared/zone-raster.ts
   Pure rasterization of collision / nav zones into a passability overlay
   (Phase 8 Stage D). Zones that shape movement (kind "collision" force-block,
   kind "nav" force-pass) are baked ONCE at map load into a per-tile grid whose
   values match map.passOv (0 = auto, 1 = force pass, 2 = force block), so the
   movement hot path (tilePassable) never has to test a single polygon per step.

   The engine reads the baked grid as a passOv overlay: a non-zero cell wins
   over the tile's own passOv exactly the way passOv wins over tile
   passability. When a map has no collision/nav zones the grid is empty and the
   engine keeps its verbatim passOv read — absent ⇒ byte-identical movement.

   Precedence: force-block beats force-pass (a "collision" zone drawn over a
   "nav" zone still blocks), matching the intuition that collision is the
   stronger constraint. Fully unit-tested (tests-unit/zone-raster.test.ts).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { MapZone } from "./schema";
import { bboxOf, pointInZoneTile } from "./zone-geom";

/** passOv-compatible overlay values. */
export const PASS_AUTO = 0;
export const PASS_FORCE = 1; // force-pass (nav)
export const PASS_BLOCK = 2; // force-block (collision)

/** Rasterize a map's collision/nav zones into a width*height Int8Array of
 *  passOv-compatible values (0 = no override, 1 = force pass, 2 = force block).
 *  Returns null when the map has no collision/nav zones — the caller then keeps
 *  its verbatim passOv path (absent ⇒ byte-identical). Only cells covered by a
 *  collision/nav zone are set; every other cell stays 0. */
export function rasterizeZones(
  zones: MapZone[] | undefined | null,
  width: number,
  height: number,
): Int8Array | null {
  if (!zones || !zones.length) return null;
  const movement = zones.filter((z) => z && (z.kind === "collision" || z.kind === "nav") && z.shape);
  if (!movement.length) return null;
  const grid = new Int8Array(width * height); // zero-filled = PASS_AUTO
  for (const z of movement) {
    const want = z.kind === "collision" ? PASS_BLOCK : PASS_FORCE;
    // Iterate only the shape's bounding box (clamped to the map), not the whole
    // grid — a small zone on a big map touches only its own footprint.
    const b = bboxOf(z.shape);
    const x0 = Math.max(0, Math.floor(b.x1));
    const y0 = Math.max(0, Math.floor(b.y1));
    const x1 = Math.min(width - 1, Math.ceil(b.x2));
    const y1 = Math.min(height - 1, Math.ceil(b.y2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!pointInZoneTile(z.shape, x, y)) continue;
        const i = y * width + x;
        // force-block wins over force-pass (collision is the stronger rule).
        if (want === PASS_BLOCK) grid[i] = PASS_BLOCK;
        else if (grid[i] !== PASS_BLOCK) grid[i] = PASS_FORCE;
      }
    }
  }
  return grid;
}
