/* RPGAtlas — tests-unit/zone-geom.test.ts
   The pure zone geometry (src/shared/zone-geom.ts, Phase 8 Stage D): bbox
   precompute, point-in-shape (rect/ellipse/point/poly even-odd), tile-center
   queries, distance-to-shape (sound falloff), and zonesAtTile. Edge cases
   (degenerate poly, zero-radius ellipse, points on borders) are exercised so
   the editor and engine can trust one implementation. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  bboxOf, pointInShape, pointInPoly, pointInZoneTile,
  distanceToZoneTile, zonesAtTile,
} from "../src/shared/zone-geom";
import type { MapZone, ZoneShape } from "../src/shared/schema";

describe("bboxOf", () => {
  it("rect / ellipse / point / poly", () => {
    expect(bboxOf({ type: "rect", x: 2, y: 3, w: 4, h: 5 })).toEqual({ x1: 2, y1: 3, x2: 6, y2: 8 });
    expect(bboxOf({ type: "ellipse", cx: 5, cy: 5, rx: 3, ry: 2 })).toEqual({ x1: 2, y1: 3, x2: 8, y2: 7 });
    expect(bboxOf({ type: "point", x: 7, y: 1 })).toEqual({ x1: 7, y1: 1, x2: 8, y2: 2 });
    expect(bboxOf({ type: "poly", pts: [{ x: 1, y: 1 }, { x: 5, y: 2 }, { x: 3, y: 6 }] }))
      .toEqual({ x1: 1, y1: 1, x2: 5, y2: 6 });
  });
  it("empty poly is a degenerate box, not a crash", () => {
    expect(bboxOf({ type: "poly", pts: [] })).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});

describe("pointInShape — rect", () => {
  const r: ZoneShape = { type: "rect", x: 2, y: 2, w: 3, h: 3 };
  it("inside / on edge / outside", () => {
    expect(pointInShape(r, 3, 3)).toBe(true);
    expect(pointInShape(r, 2, 2)).toBe(true);   // corner is inclusive
    expect(pointInShape(r, 5, 5)).toBe(true);   // far corner inclusive
    expect(pointInShape(r, 1.9, 3)).toBe(false);
    expect(pointInShape(r, 5.1, 3)).toBe(false);
  });
});

describe("pointInShape — ellipse", () => {
  const e: ZoneShape = { type: "ellipse", cx: 5, cy: 5, rx: 3, ry: 2 };
  it("center in, on axis, outside", () => {
    expect(pointInShape(e, 5, 5)).toBe(true);
    expect(pointInShape(e, 8, 5)).toBe(true);   // right vertex (on curve)
    expect(pointInShape(e, 5, 7)).toBe(true);   // bottom vertex
    expect(pointInShape(e, 8, 7)).toBe(false);  // corner of bbox, outside the curve
  });
  it("zero-radius ellipse contains nothing", () => {
    expect(pointInShape({ type: "ellipse", cx: 5, cy: 5, rx: 0, ry: 2 }, 5, 5)).toBe(false);
  });
});

describe("pointInPoly — even-odd", () => {
  const tri = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 4 }];
  it("inside vs outside a triangle", () => {
    expect(pointInPoly(tri, 2, 1)).toBe(true);
    expect(pointInPoly(tri, 0, 3)).toBe(false);
    expect(pointInPoly(tri, 3.5, 3)).toBe(false);
  });
  it("even-odd handles a concave (C-shaped) polygon and its notch", () => {
    // A blocky "C": outer 6×6 with a rectangular bite taken from the right
    // middle. The bite is the concave region the even-odd rule must exclude.
    const c = [
      { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 },
      { x: 2, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 0, y: 6 },
    ];
    expect(pointInPoly(c, 1, 3)).toBe(true);   // in the left spine
    expect(pointInPoly(c, 5, 1)).toBe(true);   // in the top arm
    expect(pointInPoly(c, 5, 5)).toBe(true);   // in the bottom arm
    expect(pointInPoly(c, 4, 3)).toBe(false);  // inside the concave bite
    expect(pointInPoly(c, 7, 3)).toBe(false);  // outside entirely
  });
  it("degenerate polygons (fewer than 3 points) are empty", () => {
    expect(pointInPoly([], 0, 0)).toBe(false);
    expect(pointInPoly([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5, 0.5)).toBe(false);
  });
});

describe("pointInZoneTile — tile-center sampling", () => {
  it("a 1x1 rect owns exactly its one tile", () => {
    const r: ZoneShape = { type: "rect", x: 4, y: 4, w: 1, h: 1 };
    expect(pointInZoneTile(r, 4, 4)).toBe(true);
    expect(pointInZoneTile(r, 5, 4)).toBe(false);
    expect(pointInZoneTile(r, 3, 4)).toBe(false);
  });
  it("a point zone owns exactly its cell", () => {
    const p: ZoneShape = { type: "point", x: 7, y: 2 };
    expect(pointInZoneTile(p, 7, 2)).toBe(true);
    expect(pointInZoneTile(p, 6, 2)).toBe(false);
  });
});

describe("distanceToZoneTile", () => {
  const r: ZoneShape = { type: "rect", x: 2, y: 2, w: 2, h: 2 };
  it("is 0 inside, grows outside", () => {
    expect(distanceToZoneTile(r, 3, 3)).toBe(0);
    // tile 6,3 center is at 6.5,3.5 → the rect right edge is x=4, so dx=2.5
    expect(distanceToZoneTile(r, 6, 3)).toBeGreaterThan(0);
    expect(distanceToZoneTile(r, 6, 3)).toBeCloseTo(2.5, 5);
  });
  it("poly distance uses the nearest edge", () => {
    const poly: ZoneShape = { type: "poly", pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
    expect(distanceToZoneTile(poly, 1, 1)).toBe(0);
    expect(distanceToZoneTile(poly, 6, 1)).toBeGreaterThan(0);
  });
});

describe("zonesAtTile", () => {
  const zones: MapZone[] = [
    { id: 1, kind: "encounter", shape: { type: "rect", x: 0, y: 0, w: 4, h: 4 } },
    { id: 2, kind: "sound", shape: { type: "rect", x: 2, y: 2, w: 4, h: 4 } },
    { id: 3, kind: "custom", shape: { type: "point", x: 9, y: 9 } },
  ];
  it("returns every covering zone in author order", () => {
    expect(zonesAtTile(zones, 3, 3).map((z) => z.id)).toEqual([1, 2]);
    expect(zonesAtTile(zones, 0, 0).map((z) => z.id)).toEqual([1]);
    expect(zonesAtTile(zones, 9, 9).map((z) => z.id)).toEqual([3]);
    expect(zonesAtTile(zones, 20, 20)).toEqual([]);
  });
  it("absent / empty ⇒ []", () => {
    expect(zonesAtTile(undefined, 0, 0)).toEqual([]);
    expect(zonesAtTile(null, 0, 0)).toEqual([]);
    expect(zonesAtTile([], 0, 0)).toEqual([]);
  });
});
