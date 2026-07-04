/* RPGAtlas — tests-unit/tile-categories.test.ts
   Phase 8 Stage E: the pure palette-categorization derivation shared by the
   Advanced and (where it fits) Standard tile palettes. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  categoryOf, matchesSearch, filterTileIds, CATEGORY_ORDER, CATEGORY_LABEL_KEY,
} from "../src/shared/tile-categories";

describe("tile-categories: categoryOf", () => {
  it("classifies water keys", () => {
    expect(categoryOf({ key: "water", terrain: true })).toBe("water");
    expect(categoryOf({ key: "deepwater", terrain: false })).toBe("water");
    expect(categoryOf({ key: "swamp", terrain: true })).toBe("water");
  });
  it("classifies floors and paths", () => {
    expect(categoryOf({ key: "stonefloor" })).toBe("floor");
    expect(categoryOf({ key: "path", terrain: true })).toBe("floor");
    expect(categoryOf({ key: "brickfloor" })).toBe("floor");
  });
  it("classifies nature", () => {
    expect(categoryOf({ key: "grass", terrain: true })).toBe("nature");
    expect(categoryOf({ key: "flowers", terrain: true })).toBe("nature");
    expect(categoryOf({ key: "tallgrass", terrain: true })).toBe("nature");
  });
  it("classifies walls / structure", () => {
    expect(categoryOf({ key: "wall" })).toBe("wall");
    expect(categoryOf({ key: "fence" })).toBe("wall");
    expect(categoryOf({ key: "stairs" })).toBe("wall");
  });
  it("falls back to terrain for plain ground, object otherwise", () => {
    expect(categoryOf({ key: "dirt", terrain: true })).toBe("terrain");
    expect(categoryOf({ key: "sand", terrain: true })).toBe("terrain");
    expect(categoryOf({ key: "widget", terrain: false })).toBe("object");
  });
  it("returns other for missing metadata", () => {
    expect(categoryOf(null)).toBe("other");
    expect(categoryOf(undefined)).toBe("other");
    expect(categoryOf({})).toBe("object"); // empty def, not terrain → object
  });
});

describe("tile-categories: search", () => {
  it("matches on name or key, case-insensitively; empty matches all", () => {
    const grass = { key: "grass", name: "Grass" };
    expect(matchesSearch(grass, "")).toBe(true);
    expect(matchesSearch(grass, "GRA")).toBe(true);
    expect(matchesSearch(grass, "gras")).toBe(true);
    expect(matchesSearch(grass, "water")).toBe(false);
    expect(matchesSearch(null, "x")).toBe(false);
  });
});

describe("tile-categories: filterTileIds", () => {
  const defs: Record<number, { key: string; name: string; terrain?: boolean }> = {
    1: { key: "grass", name: "Grass", terrain: true },
    2: { key: "water", name: "Water" },
    3: { key: "stonefloor", name: "Stone Floor" },
    4: { key: "wall", name: "Wall" },
  };
  const getMeta = (id: number) => defs[id];

  it("category 'all' + empty search returns everything", () => {
    expect(filterTileIds([1, 2, 3, 4], getMeta, "all", "")).toEqual([1, 2, 3, 4]);
  });
  it("filters by category", () => {
    expect(filterTileIds([1, 2, 3, 4], getMeta, "water", "")).toEqual([2]);
    expect(filterTileIds([1, 2, 3, 4], getMeta, "nature", "")).toEqual([1]);
  });
  it("filters by search across categories", () => {
    expect(filterTileIds([1, 2, 3, 4], getMeta, "all", "stone")).toEqual([3]);
  });
  it("combines category and search", () => {
    expect(filterTileIds([1, 2, 3, 4], getMeta, "floor", "stone")).toEqual([3]);
    expect(filterTileIds([1, 2, 3, 4], getMeta, "water", "stone")).toEqual([]);
  });
  it("drops ids with no metadata", () => {
    expect(filterTileIds([1, 99], getMeta, "all", "")).toEqual([1]);
  });
});

describe("tile-categories: label table completeness", () => {
  it("every ordered category (plus all) has a label key", () => {
    for (const c of CATEGORY_ORDER) expect(CATEGORY_LABEL_KEY[c]).toBeTruthy();
    expect(CATEGORY_LABEL_KEY.all).toBeTruthy();
  });
});
