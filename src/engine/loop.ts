/* RPGAtlas — src/engine/loop.ts
   The fixed-timestep game loop (Phase 1 Stage D). Consolidates the loop that
   previously lived inline in boot.ts into one module that owns it.

   Architecture (unchanged from the boot.ts implementation — this is a move,
   not a rewrite; the engine was already fixed-timestep):

   - update() runs at a steady 60 ticks/sec (TICK_MS = 1000/60) via a real-time
     ACCUMULATOR, independent of display refresh rate. Each rAF callback adds
     the elapsed wall-clock time to ctx.loopAcc and drains whole ticks:
        while (loopAcc >= TICK_MS) { update(); loopAcc -= TICK_MS; }
     so a 144 Hz display still ticks game logic 60×/sec (no fast-forward) and a
     30 Hz display runs two ticks per frame (no slow-motion).
   - The accumulator is clamped to 250 ms after a stall / tab-switch, so a long
     pause can't queue a spiral-of-death catch-up burst.
   - render() runs ONCE per rAF frame (decoupled from the tick rate), at full
     refresh. It is async (the WebGL HD-2D path), so we await it to avoid
     overlapping frames.
   - INTERPOLATION HOOK (already live): the leftover sub-tick time is exposed to
     render() as `ctx.loopAcc`, which render-glue turns into
     `alpha = clamp(loopAcc / TICK_MS, 0, 1)` and uses to blend entity positions
     between the previous and current tick (p.prx→p.rx). Phase 2's renderer keeps
     consuming this same latest-state + alpha; the seam is here so the loop owns
     the timestep and the renderer owns how it interpolates.

   The loop's mutable state (loopLast, loopAcc, globalT) lives on the shared
   engine context, exactly as before. boot.ts calls startLoop() at the same
   point it used to call requestAnimationFrame(loop). GPL-3.0-or-later. */

import { ctx } from "./state/engine-context.js";
import { update } from "./scenes/map.js";
import { render } from "./render-glue.js";
import { perfActive, perfSample } from "./perf-hud.js";

/** The fixed game-logic tick length. Owned here — the loop defines the
 *  timestep; render-glue imports it for interpolation (function-scope use only,
 *  so the loop↔render-glue import cycle is eval-order safe). */
export const TICK_MS = 1000 / 60;

/** One rAF step: accumulate real time, drain whole 60 Hz ticks, render once.
 *  `now` is the high-resolution timestamp rAF passes its callback. */
export async function loop(now: number): Promise<void> {
  if (ctx.loopLast === 0) ctx.loopLast = now; // first frame: establish baseline, no delta
  ctx.loopAcc += now - ctx.loopLast;
  ctx.loopLast = now;
  if (ctx.loopAcc > 250) ctx.loopAcc = 250; // clamp after a stall / tab switch (avoid spiral)
  // Perf overlay (Phase 7): time the update+render work only while visible.
  const perfT0 = perfActive() ? performance.now() : 0;
  while (ctx.loopAcc >= TICK_MS) {
    update();
    ctx.loopAcc -= TICK_MS;
  }
  await render();
  if (perfT0 > 0) perfSample(now, performance.now() - perfT0);
  requestAnimationFrame(loop);
}

/** Kick off the loop. Uses rAF so the first loop() receives a real timestamp
 *  (a direct call would pass undefined and skew the first delta). */
export function startLoop(): void {
  requestAnimationFrame(loop);
}
