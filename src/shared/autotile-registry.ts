/* RPGAtlas — src/shared/autotile-registry.ts
   Decoded-autotile registry + on-demand blob assembly (Phase 3 Stage D;
   generalized to per-kind resolvers + animation + variants in Phase 8 Stage C).

   Autotile groups are project data (proj.autotiles); a group's *source* is a
   sheet arranged per its `kind` (absent = RM A2 "blob47"). Map layers store a
   single reserved tile id per group — `AUTOTILE_BASE + group.id` — so painting,
   fill, copy/paste and the save format all treat an autotile like any other tile
   id; the visual shape is resolved at draw time from the neighbourhood.

   This module is the runtime side: a process-wide registry mapping that reserved
   tile id to its decoded source block(s) + kind/anim/variant metadata, plus a
   per-(mask,frame,variant) assembled 48x48 cache. It is DOM-coupled (canvas) on
   purpose — the shape math it calls lives in the pure, unit-tested autotile.ts /
   terrain-kinds.ts. Both the editor and the engine populate the registry from
   the loaded project (see src/editor/autotile-store.ts and the engine map load)
   and read it through the shared draw helper (autotile-draw.ts).

   Phase 8 back-compat: a group registered with no metadata (the old
   registerAutotile(id, block) call) behaves EXACTLY as before — kind "blob47",
   one frame, no variants — so absent kind/anim ⇒ byte-identical output.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { cornerSources, neighborMask } from "./autotile";
import { resolveTile, pickVariant, cellHash, frameTileGrid, type TerrainKind } from "./terrain-kinds";

/** Reserved tile-id base for autotile groups. Far above any real/imported tile
 *  index, so a plain `Assets.drawTile` on an un-intercepted path is a harmless
 *  no-op (its guard rejects ids past the tiles array) rather than a mis-draw. */
export const AUTOTILE_BASE = 1_000_000;

export function isAutotileId(id: unknown): boolean {
  return typeof id === "number" && id >= AUTOTILE_BASE;
}
export function tileIdOf(groupId: number): number { return AUTOTILE_BASE + groupId; }
export function groupIdOf(tileId: number): number { return tileId - AUTOTILE_BASE; }

/** Per-kind / anim / variant metadata registered alongside a source block. All
 *  optional; the defaults reproduce the classic blob47 A2 group exactly. */
export interface AutotileMeta {
  kind?: TerrainKind;
  /** Extra source blocks (weighted visual variations). The primary block is
   *  index 0; variants[i] is index i+1. Weights parallel `variantWeights`. */
  variants?: HTMLCanvasElement[];
  variantWeights?: number[];
  anim?: { frames: number; fps: number };
}

interface Entry {
  block: HTMLCanvasElement;         // primary source (variant 0)
  blocks: HTMLCanvasElement[];      // [primary, ...variants]
  weights: number[];                // parallel to blocks; length matches
  kind: TerrainKind;
  frames: number;
  fps: number;
  cache: Map<number, HTMLCanvasElement>;
}
const registry = new Map<number, Entry>();

function normFrames(anim?: { frames: number; fps: number }): { frames: number; fps: number } {
  const f = anim ? Math.max(1, Math.floor(anim.frames) || 1) : 1;
  const fps = anim ? Math.max(1, Number(anim.fps) || 4) : 0;
  return { frames: f, fps };
}

/** Register (or replace) an autotile's decoded source block. `block` is the
 *  primary source at native resolution (blob47/a1: 4 minitiles wide by 6 tall
 *  per frame; RM A2 sheets are 96x144). `meta` carries the kind, animation and
 *  weighted variant blocks. Omitting `meta` = a classic blob47 group (unchanged
 *  from Phase 3). Replacing clears the assembled cache. */
export function registerAutotile(tileId: number, block: HTMLCanvasElement, meta?: AutotileMeta): void {
  const blocks = [block, ...(meta?.variants || [])];
  const weights = blocks.map((_b, i) =>
    i === 0 ? 1 : (meta?.variantWeights?.[i - 1] ?? 1));
  const { frames, fps } = normFrames(meta?.anim);
  registry.set(tileId, {
    block, blocks, weights,
    kind: meta?.kind || "blob47",
    frames, fps,
    cache: new Map(),
  });
}
export function hasAutotile(tileId: number): boolean { return registry.has(tileId); }
export function unregisterAutotile(tileId: number): void { registry.delete(tileId); }
export function clearAutotiles(): void { registry.clear(); }

/** Animation metadata for a group (null when not animated). The ticker uses fps
 *  to pace frame advances and frames to wrap the counter. */
export function autotileAnim(tileId: number): { frames: number; fps: number } | null {
  const e = registry.get(tileId);
  if (!e || e.frames <= 1 || e.fps <= 0) return null;
  return { frames: e.frames, fps: e.fps };
}
/** True when ANY registered group animates — a cheap gate the render surfaces
 *  check before spinning up the per-frame redraw loop. */
export function anyAutotileAnimated(): boolean {
  for (const e of registry.values()) if (e.frames > 1 && e.fps > 0) return true;
  return false;
}
/** The kind a group was registered as (defaults to blob47). */
export function autotileKind(tileId: number): TerrainKind {
  return registry.get(tileId)?.kind || "blob47";
}

// Cache key packs (mask/tileIndex, frame, variant, TILE) into one integer. Mask
// is 0..255 for blob-family; wang kinds pack their tile index (0..15) the same
// slot. Frame 0..~15, variant 0..~15, TILE up to ~255.
function cacheKey(shape: number, frame: number, variant: number, TILE: number): number {
  return ((((shape & 0x3ff) * 32 + (frame & 31)) * 32 + (variant & 31)) * 256) + (TILE & 0xff);
}

// Assemble the 48x48 output for one resolved (kind-specific) source rect against
// a chosen variant block and animation frame. Handles both the minitile-corner
// (blob47/a1/a4) and whole-tile (edge16/corner16/a3) paths.
function assemble(e: Entry, blockIdx: number, src: ReturnType<typeof resolveTile>, TILE: number): HTMLCanvasElement {
  const block = e.blocks[blockIdx] || e.block;
  const grid = frameTileGrid(e.kind);
  // A blob-family frame is `grid.cols` tiles wide; an a1 sheet lays `frames`
  // frames side by side, so the *whole* sheet is frames*grid.cols tiles wide.
  const sheetCols = e.kind === "a1" ? grid.cols * e.frames : grid.cols;
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const g = c.getContext("2d")!;
  if (src.corners) {
    // minitile path: source minitile size = block width / (sheetCols*2)
    const sw = block.width / (sheetCols * 2);
    const sh = block.height / (grid.rows * 2);
    const d = TILE / 2;
    const dest: Array<[number, number]> = [[0, 0], [d, 0], [0, d], [d, d]];
    for (let i = 0; i < 4; i++) {
      const m = src.corners[i];
      g.drawImage(block, m.cx * sw, m.cy * sh, sw, sh, dest[i][0], dest[i][1], d, d);
    }
  } else {
    // whole-tile path: one source tile blitted to the full 48x48 output
    const tw = block.width / sheetCols;
    const th = block.height / grid.rows;
    g.drawImage(block, src.tx * tw, src.ty * th, tw, th, 0, 0, TILE, TILE);
  }
  return c;
}

/**
 * Resolve + assemble (and cache) the 48x48 output for a cell of a registered
 * terrain, given its same-group predicate, animation `frame` and cell coords
 * (for stable variant selection). Returns null when the id is not (yet)
 * registered — callers skip the cell and a later render pass picks it up.
 *
 * This is the generalized draw seam: `drawLayerCell` calls it for every
 * autotile id. For a classic blob47 group with no anim/variants it produces the
 * SAME 48x48 canvas as the Phase 3 `autotileCanvas` did (proven by the goldens).
 */
export function resolveAutotileCell(
  tileId: number,
  same: (dx: number, dy: number) => boolean,
  TILE: number,
  frame: number,
  x: number,
  y: number,
): HTMLCanvasElement | null {
  const e = registry.get(tileId);
  if (!e) return null;
  const fr = e.frames > 1 ? (frame % e.frames) : 0;
  const src = resolveTile(e.kind, same, fr, frameTileGrid(e.kind).cols);
  // stable per-cell variant pick (0 when no variants)
  const variant = e.blocks.length > 1
    ? pickVariant(e.weights, cellHash(x, y, tileId))
    : 0;
  // Distinct-shape cache slot: blob-family keys on the raw 8-neighbour mask
  // (0..255, one slot per shape); wang kinds key on their whole-tile index.
  const shape = src.corners ? neighborMask(same) : (src.ty * 8 + src.tx);
  const key = cacheKey(shape, fr, variant, TILE | 0);
  const cached = e.cache.get(key);
  if (cached) return cached;
  const out = assemble(e, variant, src, TILE);
  e.cache.set(key, out);
  return out;
}

/**
 * Assemble (and cache) the 48x48 blob for one neighbour mask — the Phase 3
 * signature, kept for callers that resolve a bare mask (swatches, the palette
 * preview). Uses the primary block, frame 0, variant 0. Returns null when the id
 * is not registered. For a blob47 group this is identical to the old routine.
 */
export function autotileCanvas(tileId: number, mask: number, TILE: number): HTMLCanvasElement | null {
  const e = registry.get(tileId);
  if (!e) return null;
  // Swatch/preview path: always the blob47 corner rule on the primary block,
  // frame 0 — this is what selection swatches want regardless of kind.
  const corners = cornerSources(mask);
  const key = cacheKey(mask & 0xff, 0, 0, TILE | 0) ^ 0x40000000; // separate namespace
  const cached = e.cache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const g = c.getContext("2d")!;
  const sheetCols = e.kind === "a1" ? frameTileGrid(e.kind).cols * e.frames : frameTileGrid(e.kind).cols;
  const sw = e.block.width / (sheetCols * 2);
  const sh = e.block.height / (frameTileGrid(e.kind).rows * 2);
  const d = TILE / 2;
  const dest: Array<[number, number]> = [[0, 0], [d, 0], [0, d], [d, d]];
  for (let i = 0; i < 4; i++) {
    g.drawImage(e.block, corners[i].cx * sw, corners[i].cy * sh, sw, sh, dest[i][0], dest[i][1], d, d);
  }
  e.cache.set(key, c);
  return c;
}

// Re-export so autotile-draw can compute the classic mask for the blob path.
export { neighborMask };
