/* RPGAtlas — tests-unit/sim-timers.test.ts
   Project Beacon MP3·A: the tick-timer engine moved from the map scene into
   the sim (src/shared/sim/timers.ts) — same algorithm, now world-bound so a
   headless server-side interpreter waits by world ticks. Pins the contract
   the move must preserve: n-tick waits, tween step fractions, and the
   push-during-pump ("starts next tick") behavior of the old array swap.
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { createWorld } from "../src/shared/sim/world";
import { pumpTickTimers, tickTweenTicks, waitTicks } from "../src/shared/sim/timers";

describe("sim tick timers", () => {
  it("waitTicks(n) resolves on exactly the nth pump", async () => {
    const world = createWorld();
    let done = false;
    void waitTicks(world, 3).then(() => {
      done = true;
    });
    pumpTickTimers(world);
    pumpTickTimers(world);
    await Promise.resolve();
    expect(done).toBe(false);
    pumpTickTimers(world);
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("waitTicks floors at one tick (0 and negatives still wait one)", async () => {
    const world = createWorld();
    let done = 0;
    void waitTicks(world, 0).then(() => done++);
    void waitTicks(world, -5).then(() => done++);
    pumpTickTimers(world);
    await Promise.resolve();
    expect(done).toBe(2);
  });

  it("tickTweenTicks steps (0..1] once per tick, then resolves", async () => {
    const world = createWorld();
    const steps: number[] = [];
    let done = false;
    void tickTweenTicks(world, 4, (t: number) => steps.push(t)).then(() => {
      done = true;
    });
    for (let i = 0; i < 4; i++) pumpTickTimers(world);
    await Promise.resolve();
    expect(steps).toEqual([0.25, 0.5, 0.75, 1]);
    expect(done).toBe(true);
  });

  it("a timer pushed from a step callback starts counting NEXT tick (array-swap contract)", async () => {
    const world = createWorld();
    const order: string[] = [];
    void tickTweenTicks(world, 1, () => {
      void waitTicks(world, 1).then(() => order.push("nested"));
    }).then(() => order.push("outer"));
    pumpTickTimers(world); // outer fires + registers nested; nested must NOT fire this pump
    await Promise.resolve();
    expect(order).toEqual(["outer"]);
    pumpTickTimers(world);
    await Promise.resolve();
    expect(order).toEqual(["outer", "nested"]);
  });

  it("timers live on the world instance — two worlds pump independently", async () => {
    const a = createWorld();
    const b = createWorld();
    let aDone = false;
    let bDone = false;
    void waitTicks(a, 1).then(() => {
      aDone = true;
    });
    void waitTicks(b, 2).then(() => {
      bDone = true;
    });
    pumpTickTimers(a);
    await Promise.resolve();
    expect(aDone).toBe(true);
    expect(bDone).toBe(false);
    pumpTickTimers(b);
    pumpTickTimers(b);
    await Promise.resolve();
    expect(bDone).toBe(true);
  });
});
