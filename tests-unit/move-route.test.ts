/* RPGAtlas — tests-unit/move-route.test.ts
   The shared character-movement rules (src/shared/move-route.ts): the wander
   leash that keeps an event near the tile it was placed on, and the move-route
   step machine both event runtimes drive. Pure module, so this is a plain
   node-env vitest with hand-built stand-ins for an event runtime.
   GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import {
  ROUTE_BLOCKED_GIVE_UP,
  ROUTE_SPEEDS,
  advanceRoute,
  describeStep,
  eventMayStep,
  homeDistance,
  normalizeStep,
  withinLeash,
  type RouteOps,
} from "../src/shared/move-route";

describe("wander leash", () => {
  it("measures distance from home as tiles in any direction (a square)", () => {
    expect(homeDistance(5, 5, 5, 5)).toBe(0);
    expect(homeDistance(8, 5, 5, 5)).toBe(3);
    expect(homeDistance(5, 1, 5, 5)).toBe(4);
    // A diagonal is 3 away, not 6 — the leash is a box, not a walk length.
    expect(homeDistance(8, 8, 5, 5)).toBe(3);
  });

  it("lets a character move freely with no leash configured", () => {
    for (const max of [0, undefined as unknown as number, -4, NaN]) {
      expect(withinLeash(99, 99, 5, 5, 5, 5, max)).toBe(true);
    }
  });

  it("allows steps inside the box and blocks the one that leaves it", () => {
    // Leash 2 around (5,5): x may reach 7, not 8.
    expect(withinLeash(7, 5, 6, 5, 5, 5, 2)).toBe(true);
    expect(withinLeash(8, 5, 7, 5, 5, 5, 2)).toBe(false);
    expect(withinLeash(5, 3, 5, 4, 5, 5, 2)).toBe(true);
    expect(withinLeash(5, 2, 5, 3, 5, 5, 2)).toBe(false);
    // Corners count as 2 away, so the whole 5×5 box is reachable.
    expect(withinLeash(7, 7, 6, 6, 5, 5, 2)).toBe(true);
    expect(withinLeash(8, 8, 7, 7, 5, 5, 2)).toBe(false);
  });

  it("lets a character stranded outside the leash walk home, but no further", () => {
    // Dropped at (12,5) with a leash of 2 around (5,5): only the step that
    // shortens the distance is allowed, so it never freezes in place.
    expect(withinLeash(11, 5, 12, 5, 5, 5, 2)).toBe(true); // homeward
    expect(withinLeash(13, 5, 12, 5, 5, 5, 2)).toBe(false); // further away
    expect(withinLeash(12, 6, 12, 5, 5, 5, 2)).toBe(false); // sideways = same distance
  });

  it("reads an event's leash off its page and its home off the authored spawn", () => {
    const rt = { x: 10, y: 10, ev: { x: 10, y: 10 }, page: { maxDistance: 1 } };
    expect(eventMayStep(rt, 11, 10)).toBe(true);
    expect(eventMayStep(rt, 12, 10)).toBe(false);
    // The spawn is the EVENT's tile, not wherever the runtime happens to be:
    // an event walked to (11,10) may still step to (11,11) (1 from home) but
    // not to (12,10) (2 from home).
    const walked = { x: 11, y: 10, ev: { x: 10, y: 10 }, page: { maxDistance: 1 } };
    expect(eventMayStep(walked, 11, 11)).toBe(true);
    expect(eventMayStep(walked, 12, 10)).toBe(false);
  });

  it("is inert for pages without the property (every pre-2.0 event)", () => {
    const rt = { x: 3, y: 3, ev: { x: 3, y: 3 }, page: {} };
    expect(eventMayStep(rt, 99, 99)).toBe(true);
    expect(eventMayStep({ x: 3, y: 3, ev: { x: 3, y: 3 }, page: null }, 99, 99)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The move-route step machine
// ---------------------------------------------------------------------------

/** A character on an open field, plus whatever walls a test asks for.
 *  `blocked` holds "x,y" tiles nothing may stand on. */
function stage(opts: { blocked?: string[]; player?: { x: number; y: number } } = {}) {
  const blocked = new Set(opts.blocked || []);
  const log: string[] = [];
  const ent: Record<string, any> = { x: 5, y: 5, dir: 0, route: null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const OFF: Record<number, [number, number]> = {
    0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1],
    4: [-1, 1], 5: [1, 1], 6: [-1, -1], 7: [1, -1],
  };
  const ops: RouteOps = {
    // Mirrors both runtimes: the destination must be free, and a diagonal may
    // not squeeze between two blocked cardinal neighbours.
    canStep: (e, x, y) => {
      if (blocked.has(x + "," + y)) return false;
      const dx = x - e.x, dy = y - e.y;
      if (dx !== 0 && dy !== 0 && (blocked.has(x + "," + e.y) || blocked.has(e.x + "," + y)))
        return false;
      return true;
    },
    startMove(e, dir) {
      if (!e.dirFix) e.dir = dir;
      e.x += OFF[dir][0];
      e.y += OFF[dir][1];
      log.push("move:" + dir);
    },
    startJump(e, dx, dy) {
      e.x += dx;
      e.y += dy;
      log.push("jump:" + dx + "," + dy);
    },
    playerTile: () => opts.player || null,
    rnd: () => 0, // deterministic: "random" always picks direction 0 (down)
    playSe: (name) => log.push("se:" + name),
    setSwitch: (id, on) => log.push("switch:" + id + "=" + on),
    setGraphic: (_e, charset) => log.push("graphic:" + charset),
  };
  /** Play a whole route, bounded so a bug can't hang the suite. */
  const run = (steps: unknown[], routeOpts: Record<string, unknown> = {}, ticks = 200) => {
    ent.route = { steps, idx: 0, wait: 0, onDone: () => log.push("done"), blocked: 0, ...routeOpts };
    for (let i = 0; i < ticks && ent.route; i++) advanceRoute(ent, ops);
    return log;
  };
  return { ent, ops, log, run };
}

describe("move-route step machine", () => {
  it("still runs every step token routes were saved with before", () => {
    const s = stage();
    s.run(["right", "right", "down", "turn_up", "wait15", "left"]);
    expect(s.ent.x).toBe(6); // 5 +1 +1 -1
    expect(s.ent.y).toBe(6);
    expect(s.ent.dir).toBe(1); // the final "left" step turned it
    expect(s.log).toContain("done");
  });

  it("walks the eight directions, diagonals included", () => {
    const s = stage();
    s.run(["upright", "upright", "downleft"]);
    expect([s.ent.x, s.ent.y]).toEqual([6, 4]);
  });

  it("refuses a diagonal that would squeeze between two blocked neighbours", () => {
    // The corner rule lives in each runtime's canStep (the harness mirrors it):
    // the destination (6,4) is free, but both cardinals around it are walls.
    const s = stage({ blocked: ["6,5", "5,4"] });
    s.run(["upright"]);
    expect([s.ent.x, s.ent.y]).toEqual([5, 5]);
  });

  it("steps forward and backward relative to the current facing", () => {
    const s = stage();
    s.ent.dir = 2; // facing right
    s.run(["forward", "back"]);
    expect([s.ent.x, s.ent.y]).toEqual([5, 5]); // out and back
    expect(s.ent.dir).toBe(2); // backward never turns the character round
  });

  it("moves and turns toward and away from the player", () => {
    const s = stage({ player: { x: 9, y: 5 } });
    s.run(["toward", "toward"]);
    expect(s.ent.x).toBe(7);
    expect(s.ent.dir).toBe(2);
    const t = stage({ player: { x: 9, y: 5 } });
    t.run(["away", "turn_toward"]);
    expect(t.ent.x).toBe(4);
    expect(t.ent.dir).toBe(2);
    const u = stage({ player: { x: 9, y: 5 } });
    u.run(["turn_away"]);
    expect(u.ent.dir).toBe(1);
  });

  it("turns relatively: 90 degrees each way, around, and at random", () => {
    const s = stage();
    s.ent.dir = 0; // down
    s.run(["turn_r90"]);
    expect(s.ent.dir).toBe(1); // down to left is the clockwise quarter turn
    s.run(["turn_r90", "turn_r90"]);
    expect(s.ent.dir).toBe(2); // left, up, right
    s.run(["turn_180"]);
    expect(s.ent.dir).toBe(1);
    s.run(["turn_l90"]);
    expect(s.ent.dir).toBe(0);
    s.run(["turn_random"]); // rnd() is 0 in this harness
    expect(s.ent.dir).toBe(0);
  });

  it("jumps: the classic hop forward, and a parameterized jump", () => {
    const s = stage();
    s.ent.dir = 2;
    s.run(["jump"]);
    expect(s.log).toContain("jump:2,0"); // two tiles ahead when clear
    const near = stage({ blocked: ["7,5"] });
    near.ent.dir = 2;
    near.run(["jump"]);
    expect(near.log).toContain("jump:1,0"); // falls back to one tile
    const boxed = stage({ blocked: ["6,5", "7,5"] });
    boxed.ent.dir = 2;
    boxed.run(["jump"]);
    expect(boxed.log).toContain("jump:0,0"); // hops in place
    const aimed = stage();
    aimed.run([{ k: "jump", dx: -2, dy: 3 }]);
    expect(aimed.log).toContain("jump:-2,3");
  });

  it("waits for an exact number of frames", () => {
    const s = stage();
    s.ent.route = { steps: [{ k: "wait", frames: 4 }, "right"], idx: 0, wait: 0, blocked: 0 };
    advanceRoute(s.ent, s.ops); // consumes the wait step, arms 4 frames
    for (let i = 0; i < 4; i++) {
      advanceRoute(s.ent, s.ops);
      expect(s.ent.x).toBe(5); // still counting down
    }
    advanceRoute(s.ent, s.ops);
    expect(s.ent.x).toBe(6);
  });

  it("changes speed, opacity, graphic, switches and flags", () => {
    const s = stage();
    s.run([
      { k: "speed", value: 5 },
      { k: "opacity", value: 128 },
      { k: "graphic", charset: "hero" },
      { k: "se", name: "door" },
      { k: "switch", id: 7, on: true },
      "dirfix_on", "through_on", "transparent_on", "walk_off", "step_on",
    ]);
    expect(s.ent.speed).toBe(ROUTE_SPEEDS[4]);
    expect(s.ent.opacity).toBe(128);
    expect(s.log).toContain("graphic:hero");
    expect(s.log).toContain("se:door");
    expect(s.log).toContain("switch:7=true");
    expect(s.ent.dirFix).toBe(true);
    expect(s.ent.routeThrough).toBe(true);
    expect(s.ent.transparent).toBe(true);
    expect(s.ent.walkAnim).toBe(false);
    expect(s.ent.stepAnim).toBe(true);
  });

  it("clamps a hostile opacity or speed instead of trusting the payload", () => {
    const s = stage();
    s.run([{ k: "opacity", value: 9999 }, { k: "speed", value: 99 }]);
    expect(s.ent.opacity).toBe(255);
    expect(s.ent.speed).toBe(ROUTE_SPEEDS[5]);
    s.run([{ k: "opacity", value: -40 }, { k: "speed", value: -3 }]);
    expect(s.ent.opacity).toBe(0);
    expect(s.ent.speed).toBe(ROUTE_SPEEDS[0]);
  });

  it("drops a blocked step by default (how routes have always behaved)", () => {
    const s = stage({ blocked: ["6,5"] });
    s.run(["right", "down"]);
    expect([s.ent.x, s.ent.y]).toEqual([5, 6]); // the blocked step is skipped
    expect(s.ent.dir).toBe(0); // it faced the wall, then faced down to move
  });

  it("waits at a blocked step when the route is not skippable, then gives up", () => {
    const s = stage({ blocked: ["6,5"] });
    s.ent.route = { steps: ["right", "down"], idx: 0, wait: 0, skippable: false, blocked: 0 };
    for (let i = 0; i < 10; i++) advanceRoute(s.ent, s.ops);
    expect([s.ent.x, s.ent.y]).toEqual([5, 5]); // waiting for the way to clear
    // …but never forever: a cutscene must not hard-lock a young player's game.
    for (let i = 0; i < ROUTE_BLOCKED_GIVE_UP + 5; i++) advanceRoute(s.ent, s.ops);
    expect([s.ent.x, s.ent.y]).toEqual([5, 6]); // gave up, moved on to "down"
  });

  it("cancels a click-to-move route the moment something gets in the way", () => {
    const s = stage({ blocked: ["7,5"] });
    s.ent.route = { steps: ["right", "right", "right"], idx: 0, wait: 0, touch: true, blocked: 0 };
    for (let i = 0; i < 10; i++) advanceRoute(s.ent, s.ops);
    expect(s.ent.x).toBe(6);
    expect(s.ent.route).toBeNull();
  });

  it("repeats a looping route forever and never resolves its waiter", () => {
    const s = stage();
    s.ent.route = {
      steps: ["right", "left"], idx: 0, wait: 0, repeat: true, blocked: 0,
      onDone: () => s.log.push("done"),
    };
    for (let i = 0; i < 40; i++) advanceRoute(s.ent, s.ops);
    expect(s.ent.route).not.toBeNull();
    expect(s.log).not.toContain("done");
    expect(s.ent.x).toBe(5); // right/left cancel out — it paces in place
  });

  it("inserts the frequency gap between steps", () => {
    const s = stage();
    s.ent.route = { steps: ["right", "right"], idx: 0, wait: 0, gap: 5, blocked: 0 };
    advanceRoute(s.ent, s.ops);
    expect(s.ent.x).toBe(6);
    for (let i = 0; i < 5; i++) advanceRoute(s.ent, s.ops);
    expect(s.ent.x).toBe(6); // the gap is still running down
    advanceRoute(s.ent, s.ops);
    expect(s.ent.x).toBe(7);
  });

  it("ignores an unknown token instead of stalling (forward compatibility)", () => {
    const s = stage();
    s.run(["right", "somersault", { k: "not_a_step" }, "right"]);
    expect(s.ent.x).toBe(7);
    expect(s.log).toContain("done");
  });

  it("normalizes both authored step shapes and describes them in plain words", () => {
    expect(normalizeStep("right")).toEqual({ k: "right" });
    expect(normalizeStep({ k: "wait", frames: 30 })).toEqual({ k: "wait", frames: 30 });
    expect(describeStep("turn_180")).toBe("turn around");
    expect(describeStep({ k: "wait", frames: 30 })).toBe("wait 30 frames");
    expect(describeStep({ k: "opacity", value: 128 })).toBe("opacity 128");
    expect(describeStep("right")).toBe("step right");
    expect(describeStep("turn_left")).toBe("face left");
  });
});
