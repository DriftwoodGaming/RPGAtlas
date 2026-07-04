/* RPGAtlas — src/shared/autotile-load.ts
   Decode a project's autotile groups into the runtime registry (Phase 3 Stage D;
   Phase 8 Stage C: carries kind / anim / weighted-variant metadata through).

   Shared by the editor (src/editor/autotile-store.ts re-exports this) and the
   engine map load (src/engine/scenes/map-runtime.ts). Dependency-light: only the
   registry + the DOM Image/canvas, so neither the editor state seam nor the
   engine context is dragged across the boundary.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerAutotile, clearAutotiles, tileIdOf, type AutotileMeta } from "./autotile-registry";

// Fallbacks if a source image reports no intrinsic size (A2 block = 2x3 tiles).
const FALLBACK_W = 96, FALLBACK_H = 144;

function decode(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || FALLBACK_W;
      c.height = img.naturalHeight || FALLBACK_H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("decode"));
    img.src = src;
  });
}

/**
 * (Re)populate the registry from `proj.autotiles`. Images decode off-thread, so
 * `onReady` fires once every group (and its variant sheets) has registered —
 * callers repaint then. Clears the registry first, so it is safe to call on
 * every project load. A group's Phase 8 fields (kind / anim / variants) flow
 * through to registerAutotile; a plain A2 group registers exactly as before.
 */
export function syncAutotileRegistry(proj: any, onReady?: () => void): void {
  clearAutotiles();
  const list: any[] = Array.isArray(proj && proj.autotiles) ? proj.autotiles : [];
  let pending = list.length;
  if (!pending) { onReady?.(); return; }
  const done = () => { if (--pending === 0) onReady?.(); };
  for (const g of list) {
    const variantSheets: string[] = Array.isArray(g.variants)
      ? g.variants.map((v: any) => v && v.sheet).filter(Boolean) : [];
    const variantWeights: number[] = Array.isArray(g.variants)
      ? g.variants.map((v: any) => Number(v && v.weight) || 1) : [];
    Promise.all([decode(g.sheet), ...variantSheets.map(decode)])
      .then(([primary, ...variants]) => {
        const meta: AutotileMeta = {
          kind: g.kind || "blob47",
          anim: g.anim && g.anim.frames ? { frames: g.anim.frames, fps: g.anim.fps } : undefined,
          variants: variants.length ? variants : undefined,
          variantWeights: variantWeights.length ? variantWeights : undefined,
        };
        registerAutotile(tileIdOf(g.id), primary, meta);
        done();
      })
      .catch(done);
  }
}
