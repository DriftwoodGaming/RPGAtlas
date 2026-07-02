/* RPGAtlas — tests-unit/autotile.test.ts
   The pure 47-blob autotile core (src/shared/autotile.ts, Phase 3 Stage D).
   Autotiles only look right if every one of the 256 neighbour masks resolves to
   four in-bounds minitiles, and the canonical cases match RPG Maker MV's
   FLOOR_AUTOTILE_TABLE (which the per-corner coordinates were derived from).
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  cornerSources, neighborMask,
  N, E, S, W, NE, SE, SW, NW,
} from "../src/shared/autotile";

const flat = (mask: number) => cornerSources(mask).map((m) => [m.cx, m.cy]);

describe("cornerSources bounds", () => {
  it("every mask yields four minitiles inside the 4x6 block", () => {
    for (let mask = 0; mask < 256; mask++) {
      const cs = cornerSources(mask);
      expect(cs).toHaveLength(4);
      for (const m of cs) {
        expect(m.cx).toBeGreaterThanOrEqual(0);
        expect(m.cx).toBeLessThanOrEqual(3);
        expect(m.cy).toBeGreaterThanOrEqual(0);
        expect(m.cy).toBeLessThanOrEqual(5);
      }
    }
  });

  it("each corner only ever draws from its own corner's five minitiles", () => {
    // Membership guards against a copy-paste swap between corner tables.
    const allow = [
      [[2, 4], [2, 0], [2, 2], [0, 4], [0, 0]], // TL
      [[1, 4], [3, 0], [1, 2], [3, 4], [1, 0]], // TR
      [[2, 3], [2, 1], [2, 5], [0, 3], [0, 1]], // BL
      [[1, 3], [3, 1], [1, 5], [3, 3], [1, 1]], // BR
    ];
    for (let mask = 0; mask < 256; mask++) {
      const cs = cornerSources(mask);
      for (let c = 0; c < 4; c++) {
        const hit = allow[c].some(([x, y]) => x === cs[c].cx && y === cs[c].cy);
        expect(hit, `mask ${mask} corner ${c} -> ${cs[c].cx},${cs[c].cy}`).toBe(true);
      }
    }
  });
});

describe("canonical RPG Maker MV entries", () => {
  it("fully connected → interior fill (table entry 0)", () => {
    expect(flat(255)).toEqual([[2, 4], [1, 4], [2, 3], [1, 3]]);
  });
  it("fully isolated → four outer convex corners (table entry 47)", () => {
    expect(flat(0)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });
  it("only NW diagonal open → TL inner corner (table entry 1)", () => {
    expect(flat(255 & ~NW)).toEqual([[2, 0], [1, 4], [2, 3], [1, 3]]);
  });
  it("only NE diagonal open → TR inner corner (table entry 2)", () => {
    expect(flat(255 & ~NE)).toEqual([[2, 4], [3, 0], [2, 3], [1, 3]]);
  });
  it("only SE diagonal open → BR inner corner (table entry 4)", () => {
    expect(flat(255 & ~SE)).toEqual([[2, 4], [1, 4], [2, 3], [3, 1]]);
  });
  it("only SW diagonal open → BL inner corner (table entry 8)", () => {
    expect(flat(255 & ~SW)).toEqual([[2, 4], [1, 4], [2, 1], [1, 3]]);
  });
  it("west edge open → both left quadrants become vertical edges (table entry 16)", () => {
    // N|E|S|NE|SE connected; W and its diagonals absent.
    expect(flat(N | E | S | NE | SE)).toEqual([[0, 4], [1, 4], [0, 3], [1, 3]]);
  });
  it("north edge open → both top quadrants become horizontal edges (table entry 20)", () => {
    expect(flat(E | S | W | SE | SW)).toEqual([[2, 2], [1, 2], [2, 3], [1, 3]]);
  });
  it("east edge open → both right quadrants become vertical edges (table entry 24)", () => {
    expect(flat(N | S | W | SW | NW)).toEqual([[2, 4], [3, 4], [2, 3], [3, 3]]);
  });
  it("south edge open → both bottom quadrants become horizontal edges (table entry 32)", () => {
    expect(flat(N | E | W | NE | NW)).toEqual([[2, 4], [1, 4], [2, 5], [1, 5]]);
  });
});

describe("neighborMask", () => {
  it("all-same → 255", () => {
    expect(neighborMask(() => true)).toBe(255);
  });
  it("none-same → 0", () => {
    expect(neighborMask(() => false)).toBe(0);
  });
  it("drops a diagonal when either adjacent edge is missing", () => {
    // NE neighbour present but E edge absent → NE must not be set.
    const same = (dx: number, dy: number) =>
      (dx === 0 && dy === -1) /*N*/ || (dx === 1 && dy === -1) /*NE*/;
    const m = neighborMask(same);
    expect(m & N).toBeTruthy();
    expect(m & NE).toBeFalsy();
  });
  it("keeps a diagonal only when both adjacent edges connect", () => {
    const same = (dx: number, dy: number) =>
      (dx === 0 && dy === -1) || (dx === 1 && dy === 0) || (dx === 1 && dy === -1);
    expect(neighborMask(same)).toBe(N | E | NE);
  });
});
