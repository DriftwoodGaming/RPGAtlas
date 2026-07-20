/* RPGAtlas — tests-unit/dead-reckon.test.ts
   Project Beacon MP8·B (item 4, D-8-4): client-side dead reckoning for remote
   players. A world broadcasts DECIMATED (12 Hz + AOI, §A4), so a moving remote's
   authoritative position lands only every ~5 ticks; between deltas the client
   extrapolates it toward its next tile at walk speed so it glides. Pure + headless
   (sim/players.ts) → fast pool. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { createWorld } from "../src/shared/sim/world";
import { addPlayer, deadReckonRemotes } from "../src/shared/sim/players";

function movingRemote(world: any, id: number, x: number, y: number, dir: number): any {
  const e = addPlayer(world, id, "P", { mapId: 1, x, y, dir });
  e.moving = true;
  e.dir = dir;
  return e;
}

describe("deadReckonRemotes (D-8-4)", () => {
  it("advances a moving remote toward its next tile at walk speed, capped at the tile", () => {
    const world = createWorld(null);
    const e = movingRemote(world, 2, 5, 3, 2); // facing right (dir 2)
    deadReckonRemotes(world, 1);
    expect(e.rx).toBeCloseTo(5.085, 5); // one walk step east
    expect(e.ry).toBe(3);
    // Keep stepping — it approaches the next tile (6) but never overshoots it.
    for (let i = 0; i < 40; i++) deadReckonRemotes(world, 1);
    expect(e.rx).toBe(6); // clamped at the target tile (the delta owns arrival)
  });

  it("moves in each cardinal direction", () => {
    const world = createWorld(null);
    const up = movingRemote(world, 3, 5, 5, 3); // dir 3 = up (−y)
    const down = movingRemote(world, 4, 8, 5, 0); // dir 0 = down (+y)
    deadReckonRemotes(world, 1);
    expect(up.ry).toBeCloseTo(4.915, 5);
    expect(down.ry).toBeCloseTo(5.085, 5);
  });

  it("leaves a still remote and off-map remotes untouched (and is a no-op in solo)", () => {
    const world = createWorld(null);
    const still = addPlayer(world, 5, "S", { mapId: 1, x: 2, y: 2, dir: 2 }); // moving:false
    const elsewhere = movingRemote(world, 6, 9, 9, 2);
    elsewhere.mapId = 7; // on another map
    deadReckonRemotes(world, 1);
    expect(still.rx).toBe(2); // not moving → untouched
    expect(elsewhere.rx).toBe(9); // different map → untouched
    // Empty roster (solo) → early return, nothing thrown.
    expect(() => deadReckonRemotes(createWorld(null), 1)).not.toThrow();
  });
});
