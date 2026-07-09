/* RPGAtlas — tests-unit/asset-scan.test.ts
   Project Harbor H4·A: the pure legacy-migration planner (src/shared/asset-scan.ts).
   Which global-library keys to copy into a freshly opened project. Pure, env=node.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { planLegacyMigration, planScan } from "../src/shared/asset-scan";

describe("planLegacyMigration", () => {
  const global = [
    { key: "asset:characters/hero" },
    { key: "asset:tilesets/grass" },
    { key: "asset:audio/theme" },
  ];

  it("copies only assets the doc uses that aren't already in the project", () => {
    const used = new Set(["asset:characters/hero", "asset:audio/theme"]);
    const projectKeys = new Set(["asset:audio/theme"]); // theme already migrated
    expect(planLegacyMigration(used, projectKeys, global)).toEqual(["asset:characters/hero"]);
  });

  it("returns [] when everything used is already in the project (idempotent re-open)", () => {
    const used = new Set(["asset:characters/hero"]);
    const projectKeys = new Set(["asset:characters/hero"]);
    expect(planLegacyMigration(used, projectKeys, global)).toEqual([]);
  });

  it("never copies an asset the global library doesn't have", () => {
    const used = new Set(["asset:characters/villain"]); // not in global
    expect(planLegacyMigration(used, new Set(), global)).toEqual([]);
  });

  it("preserves global order and dedupes", () => {
    const used = new Set(["asset:audio/theme", "asset:characters/hero"]);
    const dupGlobal = [...global, { key: "asset:characters/hero" }];
    expect(planLegacyMigration(used, new Set(), dupGlobal)).toEqual([
      "asset:characters/hero",
      "asset:audio/theme",
    ]);
  });

  it("ignores malformed global entries", () => {
    const used = new Set(["asset:characters/hero"]);
    const messy = [null, { nope: 1 }, { key: "asset:characters/hero" }] as any;
    expect(planLegacyMigration(used, new Set(), messy)).toEqual(["asset:characters/hero"]);
  });
});

describe("planScan", () => {
  const wholeFile = {
    key: "asset:characters/hero",
    relPath: "assets/characters/hero.png",
    bytes: 100,
    mtimeMs: 1000,
  };

  it("flags a file at an unseen relPath as new", () => {
    const scanned = [{ type: "characters", relPath: "assets/characters/villain.png", size: 50, mtimeMs: 5 }];
    const plan = planScan(scanned, []);
    expect(plan.newFiles).toHaveLength(1);
    expect(plan.changedFiles).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it("skips a known file whose size and mtime both match", () => {
    const scanned = [{ type: "characters", relPath: "assets/characters/hero.png", size: 100, mtimeMs: 1000 }];
    const plan = planScan(scanned, [wholeFile]);
    expect(plan.newFiles).toEqual([]);
    expect(plan.changedFiles).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it("flags a known file whose size or mtime moved as changed", () => {
    const bySize = planScan(
      [{ type: "characters", relPath: "assets/characters/hero.png", size: 200, mtimeMs: 1000 }],
      [wholeFile],
    );
    expect(bySize.changedFiles).toHaveLength(1);
    const byMtime = planScan(
      [{ type: "characters", relPath: "assets/characters/hero.png", size: 100, mtimeMs: 2000 }],
      [wholeFile],
    );
    expect(byMtime.changedFiles).toHaveLength(1);
  });

  it("reports an index source that the scan didn't see as missing", () => {
    const plan = planScan([], [wholeFile]);
    expect(plan.missing).toEqual(["asset:characters/hero"]);
  });

  it("treats a sliced sheet's source via meta.sourceRel (all tiles missing together)", () => {
    const slices = [
      { key: "asset:tilesets/dungeon-r0c0", meta: { sourceRel: "assets/tilesets/dungeon.png", sourceBytes: 900, sourceMtime: 7 } },
      { key: "asset:tilesets/dungeon-r0c1", meta: { sourceRel: "assets/tilesets/dungeon.png", sourceBytes: 900, sourceMtime: 7 } },
    ];
    // Present + unchanged → skipped, none missing.
    const present = planScan(
      [{ type: "tilesets", relPath: "assets/tilesets/dungeon.png", size: 900, mtimeMs: 7 }],
      slices,
    );
    expect(present.newFiles).toEqual([]);
    expect(present.changedFiles).toEqual([]);
    expect(present.missing).toEqual([]);
    // Sheet gone → every tile from it is missing.
    const gone = planScan([], slices);
    expect(gone.missing).toEqual(["asset:tilesets/dungeon-r0c0", "asset:tilesets/dungeon-r0c1"]);
    // Sheet re-cut (size changed) → one changed candidate.
    const changed = planScan(
      [{ type: "tilesets", relPath: "assets/tilesets/dungeon.png", size: 1000, mtimeMs: 7 }],
      slices,
    );
    expect(changed.changedFiles).toHaveLength(1);
  });
});
