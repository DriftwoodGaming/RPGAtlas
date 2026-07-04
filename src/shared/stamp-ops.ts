/* RPGAtlas — src/shared/stamp-ops.ts
   Pure stamp capture/place logic (Phase 8 Stage E), shared so the editor's
   stamp library and the unit tests exercise ONE implementation. A stamp is the
   same shape as the tile clipboard — per-core-role tile arrays plus shadows —
   so capture reads a rect out of the four role arrays and placement writes them
   back at an offset. No DOM, no editor state; the editor wrapper (adv-stamps.ts)
   supplies the live map arrays and handles undo/autosave.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { Stamp } from "./schema";
import { CORE_ROLES, type CoreRole } from "./layer-view";

/** A map's tile storage, the subset stamp ops read/write. */
export interface StampMapView {
  width: number;
  height: number;
  layers: Record<CoreRole, number[]>;
  shadows: number[];
}

export interface Rect { x1: number; y1: number; x2: number; y2: number; }

/** Read a rect out of the map's role arrays + shadows into a Stamp payload.
 *  Values are copied verbatim (including any Stage-E transform-flag bits), so a
 *  captured-then-placed stamp reproduces the source cells exactly. */
export function captureStampData(m: StampMapView, r: Rect, id: number, name: string): Stamp {
  const w = r.x2 - r.x1 + 1, h = r.y2 - r.y1 + 1;
  const layers: Stamp["layers"] = {};
  for (const role of CORE_ROLES) layers[role] = [];
  const shadows: number[] = [];
  for (let y = r.y1; y <= r.y2; y++) {
    for (let x = r.x1; x <= r.x2; x++) {
      const i = y * m.width + x;
      for (const role of CORE_ROLES) layers[role]!.push(m.layers[role][i]);
      shadows.push(m.shadows[i] || 0);
    }
  }
  return { id, name, w, h, layers, shadows };
}

/** Write a stamp into the map's role arrays at top-left (ox,oy), clipped to the
 *  map. Only non-empty source cells overwrite, so a stamp with holes drops onto
 *  the terrain underneath (decoration-friendly). Mutates `m` in place. */
export function writeStampData(m: StampMapView, s: Stamp, ox: number, oy: number): void {
  for (let dy = 0; dy < s.h; dy++) {
    for (let dx = 0; dx < s.w; dx++) {
      const x = ox + dx, y = oy + dy;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      const si = dy * s.w + dx, di = y * m.width + x;
      for (const role of CORE_ROLES) {
        const arr = s.layers[role];
        if (!arr) continue;
        const v = arr[si];
        if (v) m.layers[role][di] = v;
      }
      if (s.shadows && s.shadows[si]) m.shadows[di] = s.shadows[si];
    }
  }
}
