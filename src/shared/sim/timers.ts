/* RPGAtlas — src/shared/sim/timers.ts
   Project Beacon MP3·A: the tick-accurate wait/tween timer engine, moved
   verbatim from src/engine/scenes/map.ts onto the world instance it already
   operated on (the timer LIST moved at MP1·B; this moves the functions so a
   headless server-side interpreter can wait without touching the engine).
   `waitTicks(world, n)` = n world ticks — the interpreter's Wait command and
   every timed command tween resolve on the world clock, never wall clock
   (MP0·C §C4: everything is ticks). The pump runs once per world tick, from
   the tick body. The engine's map scene re-exports these bound to the default
   world, so every existing caller is byte-identical. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { World } from "./world.js";

/** Resolve after `n` world ticks (min 1) — the world-tick wait behind the
 *  interpreter's Wait command and the engine's `waitFrames`. */
export function waitTicks(world: World, n: any): Promise<void> {
  return new Promise((resolve) => world.tickTimers.push({ left: Math.max(1, n | 0), resolve }));
}

/** Tick-driven tween: calls `step(t)` with t in (0..1] once per tick for `n`
 *  ticks, then resolves — the engine's `tickTween` (camera zoom, tint,
 *  scroll, picture moves). */
export function tickTweenTicks(world: World, n: any, step: any): Promise<void> {
  const total = Math.max(1, n | 0);
  return new Promise((resolve) => world.tickTimers.push({ left: total, total, step, resolve }));
}

/** Advance every timer one tick and resolve the finished ones. Called once
 *  per world tick by the tick body. A timer pushed from a step callback lands
 *  in the fresh list and starts counting NEXT tick — exactly the old map.ts
 *  pump's behavior (it swapped the array before iterating). */
export function pumpTickTimers(world: World): void {
  if (!world.tickTimers.length) return;
  const timers = world.tickTimers;
  world.tickTimers = [];
  const done = [];
  for (const tm of timers) {
    tm.left--;
    if (tm.step) tm.step((tm.total - tm.left) / tm.total);
    if (tm.left <= 0) done.push(tm);
    else world.tickTimers.push(tm);
  }
  done.forEach((tm) => tm.resolve());
}
