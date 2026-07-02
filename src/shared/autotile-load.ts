/* RPGAtlas — src/shared/autotile-load.ts
   Decode a project's autotile groups into the runtime registry (Phase 3 Stage D).

   Shared by the editor (src/editor/autotile-store.ts re-exports this) and the
   engine map load (src/engine/scenes/map-runtime.ts). Dependency-light: only the
   registry + the DOM Image/canvas, so neither the editor state seam nor the
   engine context is dragged across the boundary.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerAutotile, clearAutotiles, tileIdOf } from "./autotile-registry";

// Fallbacks if a source image reports no intrinsic size (A2 block = 2x3 tiles).
const FALLBACK_W = 96, FALLBACK_H = 144;

/**
 * (Re)populate the registry from `proj.autotiles`. Images decode off-thread, so
 * `onReady` fires once every group has registered — callers repaint then.
 * Clears the registry first, so it is safe to call on every project load.
 */
export function syncAutotileRegistry(proj: any, onReady?: () => void): void {
  clearAutotiles();
  const list: any[] = Array.isArray(proj && proj.autotiles) ? proj.autotiles : [];
  let pending = list.length;
  if (!pending) { onReady?.(); return; }
  for (const g of list) {
    const img = new Image();
    img.onload = () => {
      const block = document.createElement("canvas");
      block.width = img.naturalWidth || FALLBACK_W;
      block.height = img.naturalHeight || FALLBACK_H;
      block.getContext("2d")!.drawImage(img, 0, 0);
      registerAutotile(tileIdOf(g.id), block);
      if (--pending === 0) onReady?.();
    };
    img.onerror = () => { if (--pending === 0) onReady?.(); };
    img.src = g.sheet;
  }
}
