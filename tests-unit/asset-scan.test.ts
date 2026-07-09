/* RPGAtlas — tests-unit/asset-scan.test.ts
   Project Harbor H4·A: the pure legacy-migration planner (src/shared/asset-scan.ts).
   Which global-library keys to copy into a freshly opened project. Pure, env=node.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { planLegacyMigration } from "../src/shared/asset-scan";

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
