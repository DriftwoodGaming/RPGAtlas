/* RPGAtlas — tests-unit/zone-raster.test.ts
   The pure collision/nav rasterizer (src/shared/zone-raster.ts, Phase 8 Stage
   D): bakes collision (force-block) and nav (force-pass) zones into a
   passOv-compatible grid at map load so the movement hot path stays a plain
   array read. Absent-is-meaningful (no such zones ⇒ null) and force-block wins
   over force-pass are the two contracts. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { rasterizeZones, PASS_BLOCK, PASS_FORCE, PASS_AUTO } from "../src/shared/zone-raster";
import type { MapZone } from "../src/shared/schema";

const at = (g: Int8Array, w: number, x: number, y: number) => g[y * w + x];

describe("rasterizeZones", () => {
  it("returns null when there are no collision/nav zones (byte-identical path)", () => {
    expect(rasterizeZones(undefined, 8, 8)).toBeNull();
    expect(rasterizeZones([], 8, 8)).toBeNull();
    const onlyOther: MapZone[] = [{ id: 1, kind: "encounter", shape: { type: "rect", x: 0, y: 0, w: 8, h: 8 } }];
    expect(rasterizeZones(onlyOther, 8, 8)).toBeNull();
  });

  it("collision zone force-blocks its tiles, others stay auto", () => {
    const zones: MapZone[] = [{ id: 1, kind: "collision", shape: { type: "rect", x: 1, y: 1, w: 2, h: 2 } }];
    const g = rasterizeZones(zones, 6, 6)!;
    expect(g).not.toBeNull();
    expect(at(g, 6, 1, 1)).toBe(PASS_BLOCK);
    expect(at(g, 6, 2, 2)).toBe(PASS_BLOCK);
    expect(at(g, 6, 0, 0)).toBe(PASS_AUTO);
    expect(at(g, 6, 4, 4)).toBe(PASS_AUTO);
  });

  it("nav zone force-passes its tiles", () => {
    const zones: MapZone[] = [{ id: 1, kind: "nav", shape: { type: "rect", x: 0, y: 0, w: 3, h: 1 } }];
    const g = rasterizeZones(zones, 6, 6)!;
    expect(at(g, 6, 0, 0)).toBe(PASS_FORCE);
    expect(at(g, 6, 2, 0)).toBe(PASS_FORCE);
    expect(at(g, 6, 0, 1)).toBe(PASS_AUTO);
  });

  it("force-block beats force-pass where a collision zone overlaps a nav zone", () => {
    const zones: MapZone[] = [
      { id: 1, kind: "nav", shape: { type: "rect", x: 0, y: 0, w: 4, h: 4 } },
      { id: 2, kind: "collision", shape: { type: "rect", x: 1, y: 1, w: 2, h: 2 } },
    ];
    const g = rasterizeZones(zones, 6, 6)!;
    expect(at(g, 6, 0, 0)).toBe(PASS_FORCE);  // nav only
    expect(at(g, 6, 1, 1)).toBe(PASS_BLOCK);  // collision wins over nav
    expect(at(g, 6, 2, 2)).toBe(PASS_BLOCK);
  });

  it("collision-then-nav ordering still keeps the block (block is sticky)", () => {
    const zones: MapZone[] = [
      { id: 1, kind: "collision", shape: { type: "rect", x: 1, y: 1, w: 2, h: 2 } },
      { id: 2, kind: "nav", shape: { type: "rect", x: 0, y: 0, w: 4, h: 4 } },
    ];
    const g = rasterizeZones(zones, 6, 6)!;
    expect(at(g, 6, 1, 1)).toBe(PASS_BLOCK);
    expect(at(g, 6, 0, 0)).toBe(PASS_FORCE);
  });

  it("clamps to the map bounds (a zone reaching past the edge is safe)", () => {
    const zones: MapZone[] = [{ id: 1, kind: "collision", shape: { type: "rect", x: 3, y: 3, w: 10, h: 10 } }];
    const g = rasterizeZones(zones, 5, 5)!;
    expect(at(g, 5, 4, 4)).toBe(PASS_BLOCK);
    expect(g.length).toBe(25); // no overflow
  });

  it("rasterizes non-rect shapes (ellipse / poly / point) too", () => {
    const zones: MapZone[] = [
      { id: 1, kind: "collision", shape: { type: "point", x: 2, y: 2 } },
      { id: 2, kind: "nav", shape: { type: "ellipse", cx: 6, cy: 6, rx: 1, ry: 1 } },
    ];
    const g = rasterizeZones(zones, 10, 10)!;
    expect(at(g, 10, 2, 2)).toBe(PASS_BLOCK);
    expect(at(g, 10, 6, 6)).toBe(PASS_FORCE);
  });
});
