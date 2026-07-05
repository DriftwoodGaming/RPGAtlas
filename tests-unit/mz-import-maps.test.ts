/* RPGAtlas — tests-unit/mz-import-maps.test.ts
   Project Compass M1·B: tileset + map conversion. Runs the full
   intake → sniff → convertProject pipeline over the hand-authored MV + MZ "Cove
   Test" fixtures and asserts the converted Atlas maps / autotile groups / tileset
   flags / folders / import-report lines against the signed parity matrix (§2, §11,
   §12b, decision D8). Adds focused synthetic-input unit tests for the conversion-
   math edge paths the fixtures don't hit (blocked-passage passOv, ★-reroute from a
   lower plane) + an assemble-onto-newProject boot-readiness check.
   GPL-3.0-or-later (see LICENSE). */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assembleProject,
  collectTilesetUsage,
  convertMap,
  convertTilesets,
  fsSource,
  importMzProject,
  type FsReadFns,
  type MzProjectResult,
} from "../src/editor/importers/mz";
import { groupIdOf, isAutotileId } from "../src/shared/autotile-registry";
import { isProjectLike, validateProject, type Project } from "../src/shared/schema";
import type { RmMap, RmTileset } from "../src/editor/importers/mz/raw-types";
import { ImportReport } from "../src/editor/importers/mz/report";

const root = (name: string): string =>
  fileURLToPath(new URL("../tests/fixtures/" + name, import.meta.url));

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push(relative(base, abs).replace(/\\/g, "/"));
  }
  return out;
}

const nodeFns: FsReadFns = {
  async listFiles(r) {
    return walk(r, r);
  },
  async readText(abs) {
    return readFileSync(abs, "utf8");
  },
  async readBytes(abs) {
    return new Uint8Array(readFileSync(abs));
  },
  join: (r, rel) => join(r, rel),
};

const load = (name: string): Promise<MzProjectResult> => importMzProject(fsSource(root(name), nodeFns));
const byId = <T extends { id: number }>(arr: T[], id: number): T => arr.find((x) => x.id === id) as T;
const has = (r: MzProjectResult, what: string): boolean => r.report.lines.some((l) => l.what === what);

let mv: MzProjectResult;
let mz: MzProjectResult;
beforeAll(async () => {
  mv = await load("mv-project");
  mz = await load("mz-project");
});

describe("intake reads maps + tilesets (M1·B)", () => {
  it("loads both Map### files and the tileset + map tree", () => {
    expect(mz.raw.maps?.map((m) => m.id)).toEqual([1, 2]);
    expect(mz.raw.tilesets?.[1]?.name).toBe("World");
    expect(mz.raw.mapInfos?.[2]?.parentId).toBe(1);
  });
});

describe("autotile conversion (§12b)", () => {
  it("materializes one group per used A-kind: A1 water, A2 grass, A4 wall", () => {
    // Harbor uses A1(water)+A2(grass); Cave uses A2(grass)+A4(wall) → 3 groups.
    expect(mz.autotiles.map((a) => a.kind)).toEqual(["a1", "blob47", "a4"]);
    const water = byId(mz.autotiles, 1);
    expect(water.kind).toBe("a1");
    expect(water.anim).toEqual({ frames: 3, fps: 8 });
    expect(water.pass).toBe(false); // deep water: RM passage 0x0F → blocked
    const grass = byId(mz.autotiles, 2);
    expect(grass.kind).toBe("blob47");
    expect(grass.pass).toBe(true);
    expect(grass.props).toEqual({ terrainTag: 3 }); // A2 flag (3 << 12)
    const wall = byId(mz.autotiles, 3);
    expect(wall.kind).toBe("a4");
  });

  it("ships a decodable placeholder sheet for M1·D to replace", () => {
    for (const a of mz.autotiles) expect(a.sheet.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("plain-tile id map (assets.tiles contract with M1·D)", () => {
  it("assigns stable asset:tilesets/<slug>_<fam>-t<index> keys, ids from 100", () => {
    // Used plain ids: B 16/24/32, A5 0/4 → sorted 16,24,32,1536,1540.
    expect(mz.assetTiles).toEqual({
      "asset:tilesets/world_b-t16": 100,
      "asset:tilesets/world_b-t24": 101,
      "asset:tilesets/world_b-t32": 102,
      "asset:tilesets/world_a5-t0": 103,
      "asset:tilesets/world_a5-t4": 104,
    });
  });
});

describe("tileset flag bits → tileProps (§11 / decision D10)", () => {
  it("maps bush/counter/damage flags onto the Database tile-props schema", () => {
    const tp = byId(mz.tilesets, 1).tileProps;
    expect(tp["asset:tilesets/world_b-t16"]).toEqual({ pass: 0xff, flag: 1, terrain: 0 }); // bush bit0
    expect(tp["asset:tilesets/world_b-t32"]).toEqual({ pass: 0xff, flag: 4, terrain: 0 }); // counter bit2
    expect(tp["asset:tilesets/world_a5-t4"]).toEqual({ pass: 0xff, flag: 8, terrain: 0 }); // damage bit3
    // The ★ (above-player) tile carries no tile-prop flag — it routes to `over`.
    expect(tp["asset:tilesets/world_b-t24"]).toBeUndefined();
  });

  it("reports every behavior flag once, kid-friendly, no silent drop", () => {
    for (const w of ["ladder tiles", "bush tiles", "counter tiles", "damage floors",
      "one-way tile passage", "terrain tags"]) {
      expect(has(mz, w), w).toBe(true);
    }
  });
});

describe("map layer rebucket (§2 Map###)", () => {
  it("rebuckets the 6 RM planes into Atlas roles + shadows + regions", () => {
    const harbor = byId(mz.maps, 1);
    expect(harbor.name).toBe("Harbor");
    expect(harbor.width).toBe(12);
    expect(harbor.height).toBe(10);
    const at = (x: number, y: number): number => harbor.layers.ground[y * harbor.width + x];
    // Grass = A2 group 2 reserved id; water = A1 group 1.
    expect(isAutotileId(at(0, 0))).toBe(true);
    expect(groupIdOf(at(0, 0))).toBe(2); // grass
    expect(groupIdOf(at(7, 7))).toBe(1); // water bay
    expect(groupIdOf(at(9, 8))).toBe(2); // single-tile grass island inside the bay
    // Plain A5 stone path → pre-assigned id (103), damage tile (104).
    expect(at(1, 5)).toBe(103);
    expect(at(3, 5)).toBe(104);
  });

  it("floats ★-flagged tiles to the over layer; keeps decor/shadow/region planes", () => {
    const harbor = byId(mz.maps, 1);
    const idx = (x: number, y: number): number => y * harbor.width + x;
    expect(harbor.layers.over[idx(3, 6)]).toBe(101); // the ★ sign (B t24 → id101)
    expect(harbor.layers.decor[idx(2, 2)]).toBe(100); // bush plant (B t16)
    expect(harbor.shadows?.[idx(6, 6)]).toBe(5);
    expect(harbor.regions?.[idx(1, 1)]).toBe(1);
    expect(harbor.regions?.[idx(9, 2)]).toBe(5);
  });

  it("clamps regions above 63 to 63 with a report (region 64 fixture)", () => {
    const harbor = byId(mz.maps, 1);
    expect(harbor.regions?.[2 * 12 + 10]).toBe(63); // region 64 tile at (10,2)
    expect(has(mz, "high region numbers")).toBe(true);
  });

  it("carries encounters, autoplay BGM, and the map note", () => {
    const harbor = byId(mz.maps, 1);
    expect(harbor.encounters).toEqual({ troops: [1], rate: 30 });
    expect(harbor.music).toBe("asset:audio/Harbor");
    expect(harbor.notes).toBe("<Region1: safe zone>");
    expect(harbor.events).toEqual([]); // events are M1·C
    expect(has(mz, "encounters tied to map regions")).toBe(true); // regionSet
  });

  it("reports map features Atlas defers to later phases", () => {
    for (const w of ["the map-name popup", "scrolling background pictures",
      "looping maps", "custom battle backgrounds"]) {
      expect(has(mz, w), w).toBe(true);
    }
  });
});

describe("MapInfos → folders (decision D8)", () => {
  it("synthesizes one folder per parent-with-children; parent + children sit in it", () => {
    expect(mz.mapFolders).toEqual([{ id: 1, name: "Harbor", parentId: null }]);
    expect(byId(mz.maps, 1).folderId).toBe(1); // Harbor (the parent) at the folder top
    expect(byId(mz.maps, 2).folderId).toBe(1); // Cave (the child)
  });
});

describe("MV ≡ MZ map conversion (§0 delta is DB/animations, not maps)", () => {
  it("both formats convert to byte-identical maps + autotiles + tile ids", () => {
    expect(mv.maps).toEqual(mz.maps);
    expect(mv.autotiles).toEqual(mz.autotiles);
    expect(mv.assetTiles).toEqual(mz.assetTiles);
    expect(mv.mapFolders).toEqual(mz.mapFolders);
  });
});

describe("conversion-math edge paths (synthetic input)", () => {
  const tileset: RmTileset = {
    id: 1,
    name: "World",
    flags: (() => {
      const f = new Array(8192).fill(0);
      f[24] = 0x10; // B t24: ★ above-player
      f[40] = 0x0f; // B t40: fully blocked passage
      return f;
    })(),
  };

  it("bakes a fully-blocked plain ground tile into passOv 2", () => {
    // 2x1 map: (0,0) blocked plain tile 40, (1,0) empty. One tile plane only.
    const m: RmMap = { id: 1, width: 2, height: 1, tilesetId: 1, data: [40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const usage = collectTilesetUsage([m]);
    const ts = convertTilesets([null, tileset], usage, new ImportReport());
    const map = convertMap(1, "T", m, ts, new ImportReport());
    expect(map.passOv?.[0]).toBe(2);
    expect(map.passOv?.[1]).toBe(0); // full-length array; untouched cell = auto
  });

  it("floats a ★ tile from a LOWER plane (z1 decor) up to over", () => {
    // 1x1 map, star tile 24 painted on z1 (decor). data = 6 planes × 1 cell.
    const m: RmMap = { id: 1, width: 1, height: 1, tilesetId: 1, data: [0, 24, 0, 0, 0, 0] };
    const usage = collectTilesetUsage([m]);
    const ts = convertTilesets([null, tileset], usage, new ImportReport());
    const map = convertMap(1, "T", m, ts, new ImportReport());
    expect(map.layers.decor[0]).toBe(0); // vacated
    expect(map.layers.over[0]).toBe(100); // rerouted (first plain id)
  });
});

describe("assembleProject → a bootable Atlas project", () => {
  it("overlays the conversion onto a fresh base and validates clean", () => {
    // Use the shipped sample project as a full newProject()-shaped base donor.
    const base = JSON.parse(
      readFileSync(fileURLToPath(new URL("../Atlas_Quest.json", import.meta.url)), "utf8"),
    ) as Project;
    const proj = assembleProject(base, mz);
    expect(isProjectLike(proj)).toBe(true);
    validateProject(proj, "import"); // must not throw
    expect(proj.system.title).toBe("Cove Test");
    expect(proj.maps.map((m) => m.name)).toEqual(["Harbor", "Cave"]);
    expect(proj.autotiles?.length).toBe(3);
    expect(proj.quests).toEqual([]);
    expect((proj.meta as { formatVersion?: number }).formatVersion).toBe(2);
    // The pre-assigned tile ids ride along so M1·D's slice reuses them.
    expect((proj.assets as { tiles: Record<string, number> }).tiles["asset:tilesets/world_b-t16"]).toBe(100);
  });
});
