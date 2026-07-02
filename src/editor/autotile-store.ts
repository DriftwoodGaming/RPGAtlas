/* RPGAtlas — src/editor/autotile-store.ts
   Editor-side autotile group management (Phase 3 Stage D).

   Owns proj.autotiles (CRUD), decodes each group's A2 source block into the
   shared runtime registry (src/shared/autotile-registry.ts), imports
   RPG-Maker-format A2 sheets (sliced into 96x144 blocks), and builds palette
   swatches. The pure blob math + the registry live in src/shared; this module
   is the editor glue between them and the project document.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { Autotile, Project } from "../shared/schema";
import {
  registerAutotile, unregisterAutotile, autotileCanvas, tileIdOf,
} from "../shared/autotile-registry";
import { syncAutotileRegistry } from "../shared/autotile-load";
import { TILE } from "./editor-state";

// Re-exported so editor modules have a single autotile entry point.
export { syncAutotileRegistry };

// An A2 autotile block is 2x3 tiles = 4x6 minitiles. At TILE=48 that is 96x144.
export const BLOCK_W = TILE * 2;
export const BLOCK_H = TILE * 3;

export function ensureAutotiles(proj: Project): Autotile[] {
  if (!Array.isArray(proj.autotiles)) proj.autotiles = [];
  return proj.autotiles;
}

function nextId(list: Autotile[]): number {
  return list.reduce((m, a) => Math.max(m, a.id | 0), 0) + 1;
}

/** Slice an imported sheet image into 96x144 A2 blocks (row-major). A block that
 *  is fully transparent is skipped (blank filler in packed sheets). */
function sliceSheet(img: HTMLImageElement): HTMLCanvasElement[] {
  const cols = Math.max(1, Math.floor(img.naturalWidth / BLOCK_W));
  const rows = Math.max(1, Math.floor(img.naturalHeight / BLOCK_H));
  const out: HTMLCanvasElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cv = document.createElement("canvas");
      cv.width = BLOCK_W; cv.height = BLOCK_H;
      const g = cv.getContext("2d")!;
      g.drawImage(img, c * BLOCK_W, r * BLOCK_H, BLOCK_W, BLOCK_H, 0, 0, BLOCK_W, BLOCK_H);
      const data = g.getImageData(0, 0, BLOCK_W, BLOCK_H).data;
      let opaque = false;
      for (let i = 3; i < data.length; i += 4) { if (data[i] > 8) { opaque = true; break; } }
      if (opaque) out.push(cv);
    }
  }
  return out;
}

/**
 * Import an A2 sheet from a data URL, appending one group per non-empty 96x144
 * block. Resolves with the new groups (already registered in the runtime).
 */
export function importAutotileSheet(proj: Project, dataUrl: string, baseName: string): Promise<Autotile[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const list = ensureAutotiles(proj);
      const blocks = sliceSheet(img);
      const added: Autotile[] = [];
      blocks.forEach((block, i) => {
        const id = nextId(list);
        const g: Autotile = {
          id,
          name: blocks.length > 1 ? `${baseName} ${i + 1}` : baseName,
          sheet: block.toDataURL("image/png"),
          terrain: true,
          pass: true,
        };
        list.push(g);
        registerAutotile(tileIdOf(id), block);
        added.push(g);
      });
      resolve(added);
    };
    img.onerror = () => reject(new Error("Could not decode autotile image"));
    img.src = dataUrl;
  });
}

export function deleteAutotile(proj: Project, id: number): void {
  const list = ensureAutotiles(proj);
  const i = list.findIndex((a) => a.id === id);
  if (i >= 0) { list.splice(i, 1); unregisterAutotile(tileIdOf(id)); }
}

/** A palette swatch: the fully-connected interior (mask 255) shape, which reads
 *  as a clean terrain sample. Returns null until the source has decoded. */
export function autotileSwatch(id: number, size = TILE): HTMLCanvasElement | null {
  const c = autotileCanvas(tileIdOf(id), 255, TILE);
  if (!c) return null;
  if (size === TILE) return c;
  const out = document.createElement("canvas");
  out.width = size; out.height = size;
  const g = out.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, size, size);
  return out;
}
