/* RPGAtlas — server/src/core/motion.ts
   Project Beacon MP5·A: headless grid-step motion for the Beacon server,
   ported faithfully from the engine's startMove / updateEntityMotion
   (scenes/map-runtime.ts). A server player is a roster PlayerEntity moved by
   these same increments, so a client interpolates the server's authoritative
   positions exactly as it would a party follower. No DOM, no engine. GPL-3.0. */

import type { Dir, InputIntent } from "../../../src/shared/net/protocol.js";
import type { PlayerEntity } from "../../../src/shared/sim/players.js";
import { DIR_OFFSET } from "../../../src/shared/sim/collision.js";

/** Cardinal Dir string → numeric grid direction (DIRD key). */
export const NUM_OF_CARDINAL: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };

/** Engine movement speeds (tiles/tick): walk and dash. */
export const WALK_SPEED = 0.085;
export const RUN_SPEED = 0.13;

/** A buffered movement the tick will apply (only move/face are simulated on the
 *  MP5 server; attack/act/menu verbs are the MP6+ / MP8 slices — D-B3). */
export interface PendingMove {
  kind: "move" | "face";
  dir: number;
  run: boolean;
}

/** Translate one input intent into a pending move, or null when the intent is
 *  not a movement (ignored server-side in MP5). `dir8` is authoritative when
 *  present (8-direction movement); otherwise the cardinal maps to a grid dir. */
export function translateIntent(intent: InputIntent): PendingMove | null {
  if (intent.k === "move") {
    const dir = intent.dir8 != null ? intent.dir8 : NUM_OF_CARDINAL[intent.dir];
    return { kind: "move", dir, run: !!intent.run };
  }
  if (intent.k === "face") return { kind: "face", dir: NUM_OF_CARDINAL[intent.dir], run: false };
  return null;
}

/** Begin a grid step onto (x+dx, y+dy): set facing + target, mark moving. The
 *  caller has already cleared the step with collision + anti-stack. */
export function startStep(e: PlayerEntity, dir: number): void {
  e.dir = dir;
  const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
  e.tx = e.x + dx;
  e.ty = e.y + dy;
  e.moving = true;
}

/** Advance an in-progress step one tick (the engine's updateEntityMotion): move
 *  render coords toward the target, and on arrival snap the tile coords and stop.
 *  Returns true on the tick the step completes. */
export function advanceStep(e: PlayerEntity, run: boolean): boolean {
  if (!e.moving) return false;
  const speed = run ? RUN_SPEED : WALK_SPEED;
  const sx = Math.sign(e.tx - e.rx);
  const sy = Math.sign(e.ty - e.ry);
  e.rx += sx * speed;
  e.ry += sy * speed;
  if (
    (sx !== 0 && Math.sign(e.tx - e.rx) !== sx) ||
    (sy !== 0 && Math.sign(e.ty - e.ry) !== sy) ||
    (sx === 0 && sy === 0)
  ) {
    e.rx = e.tx;
    e.ry = e.ty;
    e.x = e.tx;
    e.y = e.ty;
    e.moving = false;
    return true;
  }
  e.animT++;
  return false;
}
