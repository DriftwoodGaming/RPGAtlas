/* RPGAtlas — tests-unit/pathfind.test.ts
   Phase 5 Stage C: the pure A* module. GPL-3.0-or-later (see LICENSE). */

import { describe, it, expect } from "vitest";
import { findPath } from "../src/shared/pathfind";

/** Build a passable oracle from an ASCII grid ('#' = blocked). */
function grid(rows: string[]) {
  return (x: number, y: number) =>
    y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== "#";
}

/** Walk steps from a start and return the end tile. */
function walk(x: number, y: number, steps: string[]) {
  for (const s of steps) {
    if (s === "up") y--;
    else if (s === "down") y++;
    else if (s === "left") x--;
    else x++;
  }
  return { x, y };
}

describe("findPath", () => {
  it("finds a straight line", () => {
    const p = findPath(grid(["....."]), 0, 0, 4, 0)!;
    expect(p).toEqual(["right", "right", "right", "right"]);
  });

  it("routes around a wall and ends on the goal", () => {
    const g = grid([
      ".....",
      ".###.",
      ".....",
    ]);
    const p = findPath(g, 0, 1, 4, 1)!;
    expect(p).not.toBeNull();
    expect(walk(0, 1, p)).toEqual({ x: 4, y: 1 });
    // optimal: down/up detour around a 3-wide wall = 6 steps
    expect(p.length).toBe(6);
  });

  it("already at the goal returns an empty path", () => {
    expect(findPath(grid(["..."]), 1, 0, 1, 0)).toEqual([]);
  });

  it("an unreachable goal returns null", () => {
    const g = grid([
      "..#..",
      "..#..",
      "..#..",
    ]);
    expect(findPath(g, 0, 1, 4, 1)).toBeNull();
  });

  it("near mode reaches the closest reachable tile instead", () => {
    const g = grid([
      "..#..",
      "..#..",
      "..#..",
    ]);
    const p = findPath(g, 0, 1, 4, 1, { near: true })!;
    expect(p).not.toBeNull();
    const end = walk(0, 1, p);
    expect(end.x).toBe(1); // right up against the wall
  });

  it("near mode walks adjacent to a blocked goal tile", () => {
    const g = grid([
      ".....",
      "...#.",
      ".....",
    ]);
    const p = findPath(g, 0, 1, 3, 1, { near: true })!;
    const end = walk(0, 1, p);
    expect(Math.abs(end.x - 3) + Math.abs(end.y - 1)).toBe(1);
  });

  it("respects the node budget", () => {
    // a huge open field with a far goal: a tiny budget must bail (null,
    // not a hang)
    const open = () => true;
    expect(findPath(open, 0, 0, 500, 500, { maxNodes: 50 })).toBeNull();
  });

  it("is deterministic", () => {
    const g = grid([
      "......",
      ".##.#.",
      "......",
      ".#.##.",
      "......",
    ]);
    const a = findPath(g, 0, 0, 5, 4)!;
    const b = findPath(g, 0, 0, 5, 4)!;
    expect(a).toEqual(b);
    expect(walk(0, 0, a)).toEqual({ x: 5, y: 4 });
  });

  it("never steps through a blocked goal", () => {
    const g = grid(["..#"]);
    expect(findPath(g, 0, 0, 2, 0)).toBeNull();
  });
});
