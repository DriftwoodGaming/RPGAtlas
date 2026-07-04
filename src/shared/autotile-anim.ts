/* RPGAtlas — src/shared/autotile-anim.ts
   Animated-terrain frame clock + bounded redraw (Phase 8 Stage C).

   RM "A1" terrains (and any group registered with `anim`) cycle through N frames
   at F fps. Rather than re-prerendering the whole map every frame, each render
   surface records only the CELLS whose resolved group animates and, when the
   frame advances, redraws just those cells onto the already-built lower buffer.
   Absent any animated group ⇒ scanAnimatedCells returns [] and no surface enters
   the loop — zero new work, zero golden divergence.

   The frame index is a pure function of wall-clock ms + fps, so all three
   surfaces (editor 2D, engine, HD-2D) tick in lockstep without shared state.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { isAutotileId, autotileAnim } from "./autotile-registry";

/** The frame index for a group at time `nowMs`, given its fps and frame count.
 *  Pure: frame = floor(now/1000 * fps) mod frames. Used by the editor preview
 *  surfaces, which run off the wall clock. */
export function frameAt(nowMs: number, fps: number, frames: number): number {
  if (frames <= 1 || fps <= 0) return 0;
  return Math.floor((nowMs / 1000) * fps) % frames;
}

/** The frame index from an integer tick counter (the engine's ctx.globalT),
 *  given the tick rate. Pure and integer-only, so it is perfectly deterministic
 *  under a frozen virtual clock — the engine drives terrain anim off this, the
 *  same globalT every other renderer animation keys off. */
export function frameAtTick(tick: number, fps: number, frames: number, ticksPerSec = 60): number {
  if (frames <= 1 || fps <= 0) return 0;
  return Math.floor((tick * fps) / ticksPerSec) % frames;
}

/** One animated cell: which layer array it lives in, its grid coords, and the
 *  group's fps/frames so the redraw loop can pace it. */
export interface AnimCell {
  arr: number[];
  x: number;
  y: number;
  id: number;
  fps: number;
  frames: number;
}

/**
 * Scan the given layer arrays for cells painted with an ANIMATED terrain group.
 * Returns [] when nothing animates (the common case) — the caller then skips the
 * whole animation path. `layers` is a list of the flat id arrays to scan (the
 * engine passes ground/decor/decor2/over or the layersAdv tile arrays).
 */
export function scanAnimatedCells(
  layers: number[][], w: number, h: number,
): AnimCell[] {
  const out: AnimCell[] = [];
  for (const arr of layers) {
    if (!arr) continue;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = arr[y * w + x];
        if (!id || !isAutotileId(id)) continue;
        const a = autotileAnim(id);
        if (!a) continue;
        out.push({ arr, x, y, id, fps: a.fps, frames: a.frames });
      }
    }
  }
  return out;
}

/**
 * Advance the animation clock and re-composite the animated cells. `frameFn`
 * maps a group's (fps, frames) to its current frame index — the engine passes
 * the tick-based `frameAtTick` binding (deterministic under a frozen clock), an
 * editor preview passes a wall-clock one. Only groups whose frame CHANGED since
 * `prevFrames` (a Map keyed by group id) are touched; for each such cell the
 * caller's `recompose(x, y, frame)` redraws that ONE cell correctly — clearing
 * the cell rect and re-drawing every layer of the stack at that column so a
 * bridge/decor tile sitting over animated water is preserved. Returns true when
 * at least one cell changed (caller flags the buffer dirty / re-textures HD).
 * Bounded by the animated-cell count, capped by the caller before it reaches here.
 */
export function redrawAnimatedCells(
  cells: AnimCell[],
  frameFn: (fps: number, frames: number) => number,
  prevFrames: Map<number, number>,
  recompose: (x: number, y: number, frame: number) => void,
): boolean {
  let changed = false;
  const frameOf = new Map<number, number>();      // group id → this tick's frame
  const advanced = new Set<number>();             // groups whose frame changed
  for (const c of cells) {
    let fr = frameOf.get(c.id);
    if (fr == null) { fr = frameFn(c.fps, c.frames); frameOf.set(c.id, fr); }
    if (prevFrames.get(c.id) === fr) continue;    // this group's frame is unchanged
    advanced.add(c.id);
    recompose(c.x, c.y, fr);
    changed = true;
  }
  for (const id of advanced) prevFrames.set(id, frameOf.get(id)!);
  return changed;
}
