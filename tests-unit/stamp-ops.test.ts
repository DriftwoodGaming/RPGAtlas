/* RPGAtlas — tests-unit/stamp-ops.test.ts
   Phase 8 Stage E: the pure stamp capture/place logic. Proves a captured stamp
   round-trips its cells exactly (including Stage-E transform-flag bits), holes
   fall through to the terrain below, placement clips at the map edge, and a
   captured stamp survives JSON serialization (the save format). GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { captureStampData, writeStampData, type StampMapView } from "../src/shared/stamp-ops";
import { withFlags, tileId, tileFlags } from "../src/shared/tile-flags";
import type { Stamp } from "../src/shared/schema";

function blankMap(w: number, h: number): StampMapView {
  const zeros = () => new Array(w * h).fill(0);
  return {
    width: w, height: h,
    layers: { ground: zeros(), decor: zeros(), decor2: zeros(), over: zeros() },
    shadows: zeros(),
  };
}

describe("stamp-ops: capture", () => {
  it("copies a rect out of every role array + shadows", () => {
    const m = blankMap(4, 4);
    // ground: 2x2 block of tile 5 at (1,1); decor: a 7 at (2,2); shadow bit at (1,1)
    m.layers.ground[1 * 4 + 1] = 5; m.layers.ground[1 * 4 + 2] = 5;
    m.layers.ground[2 * 4 + 1] = 5; m.layers.ground[2 * 4 + 2] = 5;
    m.layers.decor[2 * 4 + 2] = 7;
    m.shadows[1 * 4 + 1] = 3;
    const s = captureStampData(m, { x1: 1, y1: 1, x2: 2, y2: 2 }, 1, "block");
    expect(s.w).toBe(2); expect(s.h).toBe(2);
    expect(s.layers.ground).toEqual([5, 5, 5, 5]);
    expect(s.layers.decor).toEqual([0, 0, 0, 7]);
    expect(s.shadows).toEqual([3, 0, 0, 0]);
  });

  it("preserves transform-flag bits verbatim", () => {
    const m = blankMap(3, 3);
    const flagged = withFlags(9, { h: true, r: true });
    m.layers.ground[0] = flagged;
    const s = captureStampData(m, { x1: 0, y1: 0, x2: 0, y2: 0 }, 1, "f");
    expect(s.layers.ground![0]).toBe(flagged);
    expect(tileId(s.layers.ground![0])).toBe(9);
    expect(tileFlags(s.layers.ground![0])).toEqual({ h: true, v: false, r: true });
  });
});

describe("stamp-ops: place (round-trip)", () => {
  it("capture then place at the same spot reproduces the source exactly", () => {
    const src = blankMap(5, 5);
    src.layers.ground[1 * 5 + 1] = withFlags(4, { v: true });
    src.layers.ground[1 * 5 + 2] = 4;
    src.layers.decor[2 * 5 + 1] = 8;
    src.shadows[1 * 5 + 1] = 5;
    const s = captureStampData(src, { x1: 1, y1: 1, x2: 2, y2: 2 }, 1, "s");

    const dst = blankMap(5, 5);
    writeStampData(dst, s, 1, 1);
    // The stamped region matches the source region cell-for-cell.
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 2; x++) {
        const i = y * 5 + x;
        expect(dst.layers.ground[i]).toBe(src.layers.ground[i]);
        expect(dst.layers.decor[i]).toBe(src.layers.decor[i]);
        expect(dst.shadows[i]).toBe(src.shadows[i]);
      }
    }
  });

  it("empty source cells fall through (holes keep the terrain below)", () => {
    const m = blankMap(3, 3);
    m.layers.ground.fill(99); // existing terrain everywhere
    const stamp: Stamp = {
      id: 1, name: "sparse", w: 2, h: 1,
      layers: { decor: [0, 42] },
    };
    writeStampData(m, stamp, 0, 0);
    // decor[0] stays empty (source was 0), decor[1] gets 42; ground untouched.
    expect(m.layers.decor[0]).toBe(0);
    expect(m.layers.decor[1]).toBe(42);
    expect(m.layers.ground[0]).toBe(99);
  });

  it("clips at the map edge without throwing or wrapping", () => {
    const m = blankMap(3, 3);
    const stamp: Stamp = { id: 1, name: "big", w: 2, h: 2, layers: { ground: [1, 2, 3, 4] } };
    writeStampData(m, stamp, 2, 2); // only its top-left cell is in bounds
    expect(m.layers.ground[2 * 3 + 2]).toBe(1);
    // the out-of-bounds cells were skipped; nothing wrote past the array
    expect(m.layers.ground.length).toBe(9);
  });
});

describe("stamp-ops: survives the save format (JSON)", () => {
  it("a captured stamp round-trips through JSON.stringify/parse", () => {
    const m = blankMap(2, 2);
    m.layers.ground[0] = withFlags(3, { r: true });
    m.layers.decor[3] = 6;
    const s = captureStampData(m, { x1: 0, y1: 0, x2: 1, y2: 1 }, 7, "j");
    const round = JSON.parse(JSON.stringify(s));
    expect(round).toEqual(s);
    // and placing the deserialized stamp still reproduces the flags
    const dst = blankMap(2, 2);
    writeStampData(dst, round, 0, 0);
    expect(tileFlags(dst.layers.ground[0])).toEqual({ h: false, v: false, r: true });
  });
});
