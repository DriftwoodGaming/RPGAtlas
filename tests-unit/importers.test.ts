/* RPGAtlas — tests-unit/importers.test.ts
   Phase 6 Stage C: the pure importer math — tileset grid cells (offset/gap,
   partial-edge exclusion), sliced-cell naming, charset-sheet detection,
   Aseprite JSON parsing (hash + array forms, frameTags, per-tag fps, the
   uniform-grid check), and the non-uniform repack plan.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import {
  cellName,
  gridCells,
  isCharsetSheet,
  packFrames,
  parseAseprite,
} from "../src/editor/importers/sheet-math";

describe("gridCells", () => {
  it("slices an exact grid", () => {
    const g = gridCells(96, 48, { cell: 48 });
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(1);
    expect(g.cells).toEqual([
      { x: 0, y: 0, row: 0, col: 0 },
      { x: 48, y: 0, row: 0, col: 1 },
    ]);
  });
  it("drops partial edge cells instead of padding", () => {
    const g = gridCells(100, 50, { cell: 48 });
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(1);
  });
  it("honors offset and gap", () => {
    // 2px offset, cells of 16 with 2px gaps: 2+16, 2+16+2+16 = 54 fits in 56.
    const g = gridCells(56, 20, { cell: 16, offsetX: 2, offsetY: 2, gapX: 2, gapY: 2 });
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(1);
    expect(g.cells[1]).toEqual({ x: 20, y: 2, row: 0, col: 1 });
    expect(g.cells[2]).toEqual({ x: 38, y: 2, row: 0, col: 2 });
  });
  it("returns nothing when the cell exceeds the image", () => {
    expect(gridCells(30, 30, { cell: 48 }).cells).toHaveLength(0);
  });
});

describe("cell naming", () => {
  it("builds row/col names with the passability suffix", () => {
    expect(cellName("field", 0, 3)).toBe("field-r0c3");
    expect(cellName("field", 2, 0, ".pass")).toBe("field-r2c0.pass");
    expect(cellName("cliff", 1, 1, ".terrain")).toBe("cliff-r1c1.terrain");
  });
});

describe("isCharsetSheet", () => {
  it("accepts 3×4 grids of square-ish cells", () => {
    expect(isCharsetSheet(144, 192)).toBe(true); // 48×48 cells
    expect(isCharsetSheet(96, 128)).toBe(true); // 32×32 cells
  });
  it("rejects non-divisible or degenerate shapes", () => {
    expect(isCharsetSheet(100, 192)).toBe(false);
    expect(isCharsetSheet(144, 190)).toBe(false);
    expect(isCharsetSheet(6, 8)).toBe(false); // cells under 8px
    expect(isCharsetSheet(288, 64)).toBe(false); // 96×16 cells — stretched
  });
});

function hashJson() {
  return {
    frames: {
      "run 0.png": { frame: { x: 0, y: 0, w: 32, h: 32 }, duration: 100 },
      "run 1.png": { frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 100 },
      "run 2.png": { frame: { x: 0, y: 32, w: 32, h: 32 }, duration: 50 },
      "run 3.png": { frame: { x: 32, y: 32, w: 32, h: 32 }, duration: 50 },
    },
    meta: {
      image: "run.png",
      size: { w: 64, h: 64 },
      frameTags: [
        { name: "walk", from: 0, to: 1, direction: "forward" },
        { name: "sprint", from: 2, to: 3, direction: "forward" },
      ],
    },
  };
}

describe("parseAseprite", () => {
  it("parses the hash form with tags and per-tag fps", () => {
    const s = parseAseprite(hashJson());
    expect(s.frames).toHaveLength(4);
    expect(s.uniform).toBe(true);
    expect(s.cols).toBe(2);
    expect(s.rows).toBe(2);
    expect(s.image).toBe("run.png");
    expect(s.tags).toEqual([
      { name: "walk", from: 0, to: 1, fps: 10 }, // 100ms → 10fps
      { name: "sprint", from: 2, to: 3, fps: 20 }, // 50ms → 20fps
    ]);
  });
  it("parses the array form", () => {
    const j = hashJson();
    const arr = { frames: Object.values(j.frames), meta: j.meta };
    const s = parseAseprite(arr);
    expect(s.frames).toHaveLength(4);
    expect(s.uniform).toBe(true);
  });
  it("flags non-uniform frame layouts", () => {
    const j: any = hashJson();
    j.frames["run 3.png"].frame = { x: 40, y: 32, w: 24, h: 32 }; // trimmed
    const s = parseAseprite(j);
    expect(s.uniform).toBe(false);
  });
  it("clamps out-of-range tags and rejects non-Aseprite shapes", () => {
    const j: any = hashJson();
    j.meta.frameTags = [{ name: "wild", from: 2, to: 99 }];
    expect(parseAseprite(j).tags[0]).toMatchObject({ from: 2, to: 3 });
    expect(() => parseAseprite({ layers: [] })).toThrow(/frames/);
    expect(() => parseAseprite({ frames: [{ nope: 1 }] })).toThrow(/frame shape/);
  });
});

describe("packFrames", () => {
  it("plans a near-square uniform grid of max-size cells, centering frames", () => {
    const plan = packFrames([
      { x: 0, y: 0, w: 30, h: 40, dur: 100 },
      { x: 30, y: 0, w: 20, h: 20, dur: 100 },
      { x: 50, y: 0, w: 10, h: 40, dur: 100 },
    ]);
    expect(plan.cellW).toBe(30);
    expect(plan.cellH).toBe(40);
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(2);
    expect(plan.positions[0]).toEqual({ x: 0, y: 0 });
    expect(plan.positions[1]).toEqual({ x: 30 + 5, y: 10 }); // centered 20×20 in 30×40
    expect(plan.positions[2]).toEqual({ x: 10, y: 40 }); // row 1, centered x
  });
});
