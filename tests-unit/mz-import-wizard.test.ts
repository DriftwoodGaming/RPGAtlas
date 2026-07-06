/* RPGAtlas — tests-unit/mz-import-wizard.test.ts
   Project Compass M1·D: the DOM-free import-wizard core. `runRmImport` folds the
   full intake → convert → assemble pipeline onto a fresh base and attaches the
   reopenable report; this spec proves it over both hand-authored fixtures (the
   assembled project is bootable-clean, the report leads with the right counts and
   carries the honest "coming later" / "left out" caveats), and that the zip reader
   round-trips STORE + DEFLATE archives so the wizard's ".zip" intake matches a
   picked folder. GPL-3.0-or-later (see LICENSE). */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  fsSource,
  objectSource,
  readZip,
  runRmImport,
  type FsReadFns,
  type RmImportOutcome,
} from "../src/editor/importers/mz";
import { buildZip } from "../src/editor/export-web";
import { isProjectLike, validateProject, type Project } from "../src/shared/schema";

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
  async listFiles(r) { return walk(r, r); },
  async readText(abs) { return readFileSync(abs, "utf8"); },
  async readBytes(abs) { return new Uint8Array(readFileSync(abs)); },
  join: (r, rel) => join(r, rel),
};

// The shipped sample donates a real newProject()-shaped base in Node (the
// wizard uses DataDefaults.newProject() in the browser).
const freshBase = (): Project =>
  JSON.parse(readFileSync(fileURLToPath(new URL("../Atlas_Quest.json", import.meta.url)), "utf8")) as Project;

const enc = new TextEncoder();

describe("runRmImport → a ready-to-load project + saved report", () => {
  let mv: RmImportOutcome;
  let mz: RmImportOutcome;

  beforeAll(async () => {
    mv = await runRmImport(fsSource(root("mv-project"), nodeFns), freshBase());
    mz = await runRmImport(fsSource(root("mz-project"), nodeFns), freshBase());
  });

  it("assembles a bootable-clean project from the MZ fixture", () => {
    const p = mz.project;
    expect(isProjectLike(p)).toBe(true);
    validateProject(p, "import"); // must not throw
    expect(mz.format).toBe("mz");
    expect(p.system.title).toBe("Cove Test");
    expect(p.maps.map((m) => m.name)).toEqual(["Harbor", "Cave"]);
    expect((p.meta as { formatVersion?: number }).formatVersion).toBe(2);
  });

  it("sniffs the MV fixture as MV and converts the same game", () => {
    expect(mv.format).toBe("mv");
    expect(mv.project.system.title).toBe("Cove Test");
    expect(mv.project.maps.map((m) => m.name)).toEqual(["Harbor", "Cave"]);
  });

  it("attaches a report whose summary leads with what came along", () => {
    const doc = mz.project.importReport;
    expect(doc).toBeTruthy();
    expect(doc).toBe(mz.report); // same object attached to the project
    expect(doc!.source).toBe("mz");
    expect(doc!.gameTitle).toBe("Cove Test");
    const s = doc!.summary;
    expect(s.maps).toBe(2);
    expect(s.actors).toBe(2);
    expect(s.enemies).toBe(2);
    expect(s.troops).toBe(1);
    expect(s.commonEvents).toBe(2);
    expect(s.switches).toBe(3);
    expect(s.variables).toBe(3);
    expect(s.skills).toBeGreaterThanOrEqual(4);
  });

  it("keeps every honest caveat line (nothing dropped silently)", () => {
    const kinds = new Set(mz.report.lines.map((l) => l.kind));
    // The fixture deliberately exercises the "not a clean 1:1" buckets.
    expect(kinds.has("todo")).toBe(true); // e.g. damage formulas, terrain tags
    expect(kinds.has("skipped")).toBe(true); // e.g. collapse effects / reusable items
    // Copy is kid-friendly: no stack-trace / code noise in the detail text.
    for (const l of mz.report.lines) {
      if (l.detail) expect(l.detail).not.toMatch(/undefined|NaN|\bError\b|\.ts:/);
    }
    // Post-1.1: the Luck stat converts — the old "left out" line is gone,
    // and the Rusty Key now lands as a converted key item.
    expect(mz.report.lines.some((l) => /luck/i.test(l.what))).toBe(false);
    const key = mz.report.lines.find((l) => /key items/i.test(l.what));
    expect(key).toBeTruthy();
    expect(key!.kind).toBe("converted");
  });

  it("every imported map event page carries a cond object (engine invariant)", () => {
    // map-runtime.ts pageActive() reads page.cond.* unguarded; editor-authored
    // pages always have one, so imported pages must too or map load throws.
    for (const map of mz.project.maps) {
      for (const ev of map.events || []) {
        for (const page of ev.pages) {
          expect(page.cond, `${map.name} / ${ev.name}`).toBeTruthy();
          expect(typeof page.cond).toBe("object");
        }
      }
    }
  });

  it("drives onProgress through every stage in order (M6·A)", async () => {
    const seen: { stage: string; step: number; total: number }[] = [];
    const out = await runRmImport(fsSource(root("mz-project"), nodeFns), freshBase(), (p) => {
      seen.push({ stage: p.stage, step: p.step, total: p.total });
    });
    expect(out.project.system.title).toBe("Cove Test"); // still imports fine
    expect(seen.map((s) => s.stage)).toEqual(["reading", "assembling", "report", "done"]);
    expect(seen.map((s) => s.step)).toEqual([1, 2, 3, 4]);
    expect(new Set(seen.map((s) => s.total))).toEqual(new Set([4]));
  });

  it("MV and MZ import to the same map/database shape (format delta aside)", () => {
    expect(mv.project.maps.length).toBe(mz.project.maps.length);
    expect(mv.project.actors.length).toBe(mz.project.actors.length);
    expect(mv.project.enemies.length).toBe(mz.project.enemies.length);
  });

  it("replaces the base animations (M4·B): MV for real, MZ via the D4 fallback", () => {
    // MV: sheet animations convert to flipbook timelines over asset keys.
    expect(mv.project.animations.map((a) => a.name)).toEqual(["Heal", "Fire"]);
    expect(mv.project.animations[0].items[0]).toMatchObject({
      type: "flipbook", sheet: "asset:pictures/heal", cols: 5, fps: 15,
    });
    expect(mv.report.lines.some((l) => l.what === "battle animation sheet images")).toBe(true);
    // MZ: Effekseer entries borrow the nearest base animation's visuals and
    // keep their own flash/sound timings; each substitution is reported.
    expect(mz.project.animations.map((a) => a.name)).toEqual(["Heal", "Fire"]);
    expect(mz.project.animations[1].items.some((i) => i.type === "particles")).toBe(true);
    expect(mz.project.animations[1].items).toContainEqual({ at: 8, type: "sound", se: "asset:audio/Fire" });
    expect(mz.report.lines.some((l) => l.what === 'the "Fire" animation' && /Fire Burst/.test(l.detail || ""))).toBe(true);
    // Skill/weapon animationId refs resolve against the imported ids.
    const withAnim = mz.project.skills.find((s) => (s as { animationId?: number }).animationId === 2);
    expect(withAnim).toBeTruthy();
  });
});

describe("readZip → the wizard's .zip intake", () => {
  it("round-trips a STORE-method archive (the export-web writer's output)", async () => {
    const files = {
      "MyGame/data/System.json": '{"gameTitle":"Zip Test"}',
      "MyGame/data/Actors.json": "[null,{}]",
      "MyGame/img/pic.bin": new Uint8Array([1, 2, 3, 250, 0, 99]),
    };
    const zip = buildZip(Object.entries(files).map(([name, data]) => ({
      name,
      data: typeof data === "string" ? enc.encode(data) : data,
    })));
    const out = await readZip(zip);
    expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort());
    expect(new TextDecoder().decode(out["MyGame/data/System.json"])).toContain("Zip Test");
    expect(Array.from(out["MyGame/img/pic.bin"])).toEqual([1, 2, 3, 250, 0, 99]);
  });

  it("inflates a DEFLATE-method entry (ordinary zip tools)", async () => {
    // Hand-roll a minimal single-entry zip with method 8 (deflate-raw).
    const name = "data/System.json";
    const body = enc.encode('{"gameTitle":"Deflate Test","note":"'.padEnd(400, "x") + '"}');
    const comp = new Uint8Array(
      await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer(),
    );
    const nameBytes = enc.encode(name);
    // Local header (30) + name + data; central dir (46) + name; EOCD (22).
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true); // method: DEFLATE
    local.setUint32(18, comp.length, true); // compressed size
    local.setUint32(22, body.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    const localOff = 0;
    const dataOff = 30 + nameBytes.length;
    const cenOff = dataOff + comp.length;
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(10, 8, true); // method
    cen.setUint32(20, comp.length, true);
    cen.setUint32(24, body.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, localOff, true);
    const eocdOff = cenOff + 46 + nameBytes.length;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, 1, true); // entries on this disk
    eocd.setUint16(10, 1, true); // total entries
    eocd.setUint32(12, 46 + nameBytes.length, true); // central dir size
    eocd.setUint32(16, cenOff, true); // central dir offset

    const zip = new Uint8Array(eocdOff + 22);
    zip.set(new Uint8Array(local.buffer), localOff);
    zip.set(nameBytes, 30);
    zip.set(comp, dataOff);
    zip.set(new Uint8Array(cen.buffer), cenOff);
    zip.set(nameBytes, cenOff + 46);
    zip.set(new Uint8Array(eocd.buffer), eocdOff);

    const out = await readZip(zip);
    expect(new TextDecoder().decode(out[name])).toContain("Deflate Test");
  });

  it("every imported map carries shadows/regions/passOv/heights planes (engine+editor invariant)", async () => {
    // data.js newMap() always creates these; migrateProject.normalizeMapPlanes
    // now backfills any missing plane at the load boundary too, but the importer
    // still emits them directly so its raw output matches newMap even for a map
    // with nothing painted (a blank map used to crash map-render drawShadows
    // right after import committed; heights had been the one plane still omitted).
    const map: Record<string, string> = {};
    for (const rel of walk(root("mz-project"), root("mz-project"))) {
      if (/\.(json|js)$/i.test(rel) || /^Game\./i.test(rel)) map[rel] = readFileSync(join(root("mz-project"), rel), "utf8");
    }
    const m1 = JSON.parse(map["data/Map001.json"]);
    m1.data = new Array(m1.width * m1.height * 6).fill(0); // nothing painted at all
    map["data/Map001.json"] = JSON.stringify(m1);
    const outcome = await runRmImport(objectSource(map), freshBase());
    for (const gm of outcome.project.maps) {
      const n = gm.width * gm.height;
      for (const plane of ["shadows", "regions", "passOv", "heights"] as const) {
        const arr = (gm as Record<string, unknown>)[plane];
        expect(Array.isArray(arr), `${gm.name}.${plane}`).toBe(true);
        expect((arr as number[]).length, `${gm.name}.${plane} length`).toBe(n);
      }
    }
  });

  it("keeps the base starter map when the source has no readable Map files", async () => {
    // A data-only zip (System/MapInfos but no Map###.json) must not produce an
    // empty maps[] — the wizard commits maps[0] and the engine boots maps[0].
    const map: Record<string, string> = {};
    for (const rel of walk(root("mz-project"), root("mz-project"))) {
      if (/\.(json|js)$/i.test(rel) || /^Game\./i.test(rel)) map[rel] = readFileSync(join(root("mz-project"), rel), "utf8");
    }
    for (const key of Object.keys(map)) {
      if (/^data\/Map0*\d+\.json$/i.test(key)) delete map[key];
    }
    const outcome = await runRmImport(objectSource(map), freshBase());
    expect(outcome.project.maps.length).toBeGreaterThan(0);
    expect(outcome.project.maps[0].id).toBeTruthy();
    validateProject(outcome.project, "import"); // must not throw
    const line = outcome.report.lines.find((l) => l.what === "your game's maps");
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("partial");
  });

  it("feeds objectSource so a zip source imports like a folder", async () => {
    // A real zip of the MZ fixture would strip its top folder; prove the
    // objectSource path (no top folder) converts too.
    const map: Record<string, string> = {};
    for (const rel of walk(root("mz-project"), root("mz-project"))) {
      if (/\.(json|js)$/i.test(rel) || /^Game\./i.test(rel)) map[rel] = readFileSync(join(root("mz-project"), rel), "utf8");
    }
    const outcome = await runRmImport(objectSource(map), freshBase());
    expect(outcome.project.system.title).toBe("Cove Test");
    expect(outcome.format).toBe("mz");
  });
});
