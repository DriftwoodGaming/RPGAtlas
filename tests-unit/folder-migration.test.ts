/* RPGAtlas — tests-unit/folder-migration.test.ts
   The pure legacy → folder migration decision core (src/shared/folder-migration.ts,
   Harbor H6·A §1). Covers the "should we offer?" signal (mirror present + no folder
   meta + parses as a project) and the prefilled-title derivation (system.title,
   trimmed, with the friendly fallback). The real isProjectLike is injected as a stub so
   this stays env=node. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  planFolderMigration,
  migrationTitle,
  DEFAULT_MIGRATION_TITLE,
} from "../src/shared/folder-migration";

// A stub of the schema predicate: an object with meta.engine === "rpgatlas" is a project.
const isProjectLike = (v: unknown): boolean => {
  const meta = v && typeof v === "object" ? (v as { meta?: { engine?: unknown } }).meta : null;
  return !!meta && typeof meta === "object" && meta.engine === "rpgatlas";
};

const doc = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ meta: { engine: "rpgatlas" }, system: { title: "Hero Quest" }, ...over });

describe("planFolderMigration", () => {
  it("offers when a project mirror exists and there is no folder bookkeeping", () => {
    const plan = planFolderMigration(doc(), false, isProjectLike);
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe("Hero Quest");
    // The document is passed through verbatim so project_create writes the exact bytes.
    expect(plan!.documentJson).toBe(doc());
  });

  it("does not offer when the mirror already belongs to a folder game (meta present)", () => {
    // A folder game always carries mirror meta; migrating it again would be wrong.
    expect(planFolderMigration(doc(), true, isProjectLike)).toBeNull();
  });

  it("does not offer when there is no mirror at all (fresh desktop install)", () => {
    expect(planFolderMigration(null, false, isProjectLike)).toBeNull();
  });

  it("does not offer for junk / non-JSON mirror contents", () => {
    expect(planFolderMigration("not json{", false, isProjectLike)).toBeNull();
  });

  it("does not offer when the mirror parses but isn't a recognizable project", () => {
    expect(planFolderMigration(JSON.stringify({ hello: "world" }), false, isProjectLike)).toBeNull();
  });

  it("falls back to a friendly name when the title is blank or missing", () => {
    const blank = planFolderMigration(doc({ system: { title: "   " } }), false, isProjectLike);
    expect(blank!.title).toBe(DEFAULT_MIGRATION_TITLE);
    const missing = planFolderMigration(doc({ system: {} }), false, isProjectLike);
    expect(missing!.title).toBe(DEFAULT_MIGRATION_TITLE);
  });

  it("trims surrounding whitespace from the prefilled title", () => {
    const plan = planFolderMigration(doc({ system: { title: "  Space Game  " } }), false, isProjectLike);
    expect(plan!.title).toBe("Space Game");
  });
});

describe("migrationTitle", () => {
  it("reads system.title", () => {
    expect(migrationTitle({ system: { title: "Dragon Isle" } })).toBe("Dragon Isle");
  });
  it("falls back for a non-object / missing system", () => {
    expect(migrationTitle(null)).toBe(DEFAULT_MIGRATION_TITLE);
    expect(migrationTitle({})).toBe(DEFAULT_MIGRATION_TITLE);
    expect(migrationTitle({ system: { title: 42 } })).toBe(DEFAULT_MIGRATION_TITLE);
  });
});
