/* RPGAtlas — tests-unit/autotile-anim.test.ts
   Animated-terrain frame clock + bounded redraw (src/shared/autotile-anim.ts,
   Phase 8 Stage C). The pure parts run under node (no DOM): registration stores
   the source block opaquely, so a stub canvas is enough to exercise the anim
   metadata + cell scan + frame-change gating without a real image.
   GPL-3.0-or-later. */

import { describe, expect, it, beforeEach } from "vitest";
import {
  registerAutotile, clearAutotiles, tileIdOf, autotileAnim, anyAutotileAnimated,
} from "../src/shared/autotile-registry";
import {
  frameAt, frameAtTick, scanAnimatedCells, redrawAnimatedCells,
} from "../src/shared/autotile-anim";

// A stub "canvas" — registration never touches its DOM API, only assembly does
// (which this suite never triggers). width/height keep the type shape happy.
const stubBlock = () => ({ width: 96, height: 144 } as unknown as HTMLCanvasElement);

describe("frameAt", () => {
  it("is 0 for a non-animated group (frames<=1 or fps<=0)", () => {
    expect(frameAt(9999, 4, 1)).toBe(0);
    expect(frameAt(9999, 0, 3)).toBe(0);
  });
  it("cycles at fps and wraps at frames", () => {
    // 3 fps, 3 frames → frame changes every ~333ms, wraps every second
    expect(frameAt(0, 3, 3)).toBe(0);
    expect(frameAt(334, 3, 3)).toBe(1);
    expect(frameAt(667, 3, 3)).toBe(2);
    expect(frameAt(1000, 3, 3)).toBe(0);   // wrapped
    expect(frameAt(1334, 3, 3)).toBe(1);
  });
});

describe("frameAtTick (deterministic engine clock)", () => {
  it("is 0 for a static group", () => {
    expect(frameAtTick(9999, 4, 1)).toBe(0);
    expect(frameAtTick(9999, 0, 3)).toBe(0);
  });
  it("advances every ticksPerSec/fps ticks and wraps at frames", () => {
    // 60 ticks/sec, 4 fps → new frame every 15 ticks; 3 frames wrap at 45
    expect(frameAtTick(0, 4, 3, 60)).toBe(0);
    expect(frameAtTick(14, 4, 3, 60)).toBe(0);
    expect(frameAtTick(15, 4, 3, 60)).toBe(1);
    expect(frameAtTick(30, 4, 3, 60)).toBe(2);
    expect(frameAtTick(45, 4, 3, 60)).toBe(0);   // wrapped
  });
});

describe("registry animation metadata", () => {
  beforeEach(() => clearAutotiles());

  it("a plain group is not animated (absent anim ⇒ null)", () => {
    registerAutotile(tileIdOf(1), stubBlock());
    expect(autotileAnim(tileIdOf(1))).toBeNull();
    expect(anyAutotileAnimated()).toBe(false);
  });
  it("an anim group reports frames/fps and flips the any-animated gate", () => {
    registerAutotile(tileIdOf(2), stubBlock(), { kind: "a1", anim: { frames: 4, fps: 6 } });
    expect(autotileAnim(tileIdOf(2))).toEqual({ frames: 4, fps: 6 });
    expect(anyAutotileAnimated()).toBe(true);
  });
  it("a single-frame anim is treated as static", () => {
    registerAutotile(tileIdOf(3), stubBlock(), { anim: { frames: 1, fps: 6 } });
    expect(autotileAnim(tileIdOf(3))).toBeNull();
  });
});

describe("scanAnimatedCells", () => {
  beforeEach(() => clearAutotiles());

  it("returns [] when nothing on the map animates (the common case)", () => {
    registerAutotile(tileIdOf(1), stubBlock()); // static group
    const arr = [tileIdOf(1), 0, 5, 0]; // 2x2: static autotile, empty, plain tile, empty
    expect(scanAnimatedCells([arr], 2, 2)).toEqual([]);
  });

  it("collects exactly the cells painted with an animated group", () => {
    registerAutotile(tileIdOf(7), stubBlock(), { kind: "a1", anim: { frames: 3, fps: 4 } });
    // 3x1 row: [animated, plain, animated]
    const ground = [tileIdOf(7), 42, tileIdOf(7)];
    const cells = scanAnimatedCells([ground], 3, 1);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.x)).toEqual([0, 2]);
    expect(cells.every((c) => c.fps === 4 && c.frames === 3)).toBe(true);
  });
});

describe("redrawAnimatedCells frame-change gating", () => {
  beforeEach(() => clearAutotiles());

  it("only recomposes cells whose group's frame advanced", () => {
    registerAutotile(tileIdOf(9), stubBlock(), { kind: "a1", anim: { frames: 4, fps: 4 } });
    const cells = scanAnimatedCells([[tileIdOf(9), tileIdOf(9)]], 2, 1);
    const prev = new Map<number, number>();
    const touched: number[] = [];
    const recompose = (x: number) => touched.push(x);
    // 4fps/4frames group; drive frames explicitly through the frameFn.
    const at = (f: number) => () => f;

    // frame 0; prev empty → both cells recomposed
    expect(redrawAnimatedCells(cells, at(0), prev, recompose)).toBe(true);
    expect(touched).toEqual([0, 1]);
    expect(prev.get(tileIdOf(9))).toBe(0);

    // same frame again → no work
    touched.length = 0;
    expect(redrawAnimatedCells(cells, at(0), prev, recompose)).toBe(false);
    expect(touched).toEqual([]);

    // frame 1 → both recomposed again
    touched.length = 0;
    expect(redrawAnimatedCells(cells, at(1), prev, recompose)).toBe(true);
    expect(touched).toEqual([0, 1]);
    expect(prev.get(tileIdOf(9))).toBe(1);
  });
});
