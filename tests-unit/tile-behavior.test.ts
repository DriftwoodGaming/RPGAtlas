/* RPGAtlas — tests-unit/tile-behavior.test.ts
   Project Compass M4·A: the pure tile-behavior core — lookup building from
   Tileset tileProps + autotile group props, the painted-presence mask,
   union-of-layers flag reads, topmost-terrain reads, and the looping-map
   coordinate wrap. GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import {
  BEHAV,
  buildBehaviorMaps,
  layeredFlagsAtIndex,
  scanBehaviorPresence,
  terrainTagAtIndex,
  wrapCoord,
} from "../src/shared/tile-behavior-core";
import { tileIdOf } from "../src/shared/autotile-registry";
import { withFlags } from "../src/shared/tile-flags";

// A 3-tile Assets.tiles-shaped array + a Tileset carrying props for two keys.
const tiles = [{ key: "t0" }, { key: "asset:tilesets/w_b-t16" }, { key: "asset:tilesets/w_a5-t4" }];
const tileset = {
  tileProps: {
    "asset:tilesets/w_b-t16": { pass: 0xff, flag: BEHAV.BUSH, terrain: 0 },
    "asset:tilesets/w_a5-t4": { pass: 0xff, flag: BEHAV.DAMAGE, terrain: 2 },
  },
};
// One autotile group with a ladder flag + terrain 5 (M4·A group behaviors).
const autotiles = [{ id: 3, props: { flag: BEHAV.LADDER, terrainTag: 5 } }];
const maps = buildBehaviorMaps(tileset, autotiles, tiles);
const LADDER_ID = tileIdOf(3);

describe("buildBehaviorMaps", () => {
  it("keys plain tiles by their Assets index and groups by reserved id", () => {
    expect(maps.flagById.get(1)).toBe(BEHAV.BUSH);
    expect(maps.flagById.get(2)).toBe(BEHAV.DAMAGE);
    expect(maps.terrainById.get(2)).toBe(2);
    expect(maps.flagById.get(LADDER_ID)).toBe(BEHAV.LADDER);
    expect(maps.terrainById.get(LADDER_ID)).toBe(5);
    expect(maps.flagById.has(0)).toBe(false); // no props → no entry
  });
  it("empty inputs build empty maps (native projects)", () => {
    const empty = buildBehaviorMaps(null, [], []);
    expect(empty.flagById.size).toBe(0);
    expect(empty.terrainById.size).toBe(0);
  });
});

describe("scanBehaviorPresence (the per-step gate)", () => {
  it("unions only the bits actually painted", () => {
    const p = scanBehaviorPresence([[0, 1, 0], [0, 0, 0]], maps);
    expect(p.presentFlags).toBe(BEHAV.BUSH);
    expect(p.terrainPresent).toBe(false);
  });
  it("sees terrain and group flags, and Stage-E transform bits don't hide them", () => {
    const flagged = withFlags(2, { h: true }); // flipped damage tile
    const p = scanBehaviorPresence([[flagged], [LADDER_ID]], maps);
    expect(p.presentFlags).toBe(BEHAV.DAMAGE | BEHAV.LADDER);
    expect(p.terrainPresent).toBe(true);
  });
  it("a map painted with none is all-zero (classic maps cost nothing)", () => {
    const p = scanBehaviorPresence([[0, 0], [0, 0]], maps);
    expect(p.presentFlags).toBe(0);
    expect(p.terrainPresent).toBe(false);
  });
});

describe("per-cell reads", () => {
  // cell 0: ground damage tile under a decor bush tile; cell 1: ladder group.
  const layersTopFirst = [
    [1, 0], // decor (bush at cell 0)
    [2, LADDER_ID], // ground
  ];
  it("flags are the union of every layer (MZ checkLayeredTilesFlags)", () => {
    expect(layeredFlagsAtIndex(layersTopFirst, 0, maps)).toBe(BEHAV.BUSH | BEHAV.DAMAGE);
    expect(layeredFlagsAtIndex(layersTopFirst, 1, maps)).toBe(BEHAV.LADDER);
  });
  it("terrain is the topmost non-zero tag (MZ terrainTag z-order)", () => {
    // cell 0: decor tile (bush, tag 0) over ground tag 2 → 2 wins from below.
    expect(terrainTagAtIndex(layersTopFirst, 0, maps)).toBe(2);
    expect(terrainTagAtIndex(layersTopFirst, 1, maps)).toBe(5);
    // A tagged tile above an untagged one wins.
    expect(terrainTagAtIndex([[LADDER_ID], [2]], 0, maps)).toBe(5);
  });
});

describe("wrapCoord (looping maps)", () => {
  it("folds negatives and overflows into [0, size)", () => {
    expect(wrapCoord(-1, 10)).toBe(9);
    expect(wrapCoord(10, 10)).toBe(0);
    expect(wrapCoord(23, 10)).toBe(3);
    expect(wrapCoord(-11, 10)).toBe(9);
    expect(wrapCoord(4, 10)).toBe(4);
  });
});
