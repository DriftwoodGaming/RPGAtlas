/* RPGAtlas — tests-unit/atlas-quest-advanced.test.ts
   Anti-rot gate for the Phase 8 showcase content in the bundled sample game
   (map 5 "Meridian Village — Advanced", written by
   scripts/build-atlas-quest-advanced.mjs). Validates the shipped JSON through
   the real Phase 8 modules: the layer stack survives repair-on-open untouched,
   every zone answers zonesAtTile where the showcase says it should, and the
   automap rules evaluate deterministically to a non-trivial edit set.
   GPL-3.0-or-later. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repairLayersAdv, layerView } from "../src/shared/layer-view";
import { zonesAtTile } from "../src/shared/zone-geom";
import { evaluateAutomap } from "../src/shared/automap";

const project = JSON.parse(
  readFileSync(join(__dirname, "..", "Atlas_Quest.json"), "utf8"),
);
const map = project.maps.find((m: any) => m.id === 5);

describe("Atlas Quest showcase map (Meridian Village — Advanced)", () => {
  it("exists with the full Phase 8 feature set", () => {
    expect(map).toBeTruthy();
    expect(map.name).toBe("Meridian Village — Advanced");
    expect(map.layersAdv.length).toBeGreaterThan(4);
    expect(map.zones.length).toBeGreaterThanOrEqual(7);
    expect(map.automapRules.length).toBeGreaterThanOrEqual(2);
    expect(project.stamps.length).toBeGreaterThanOrEqual(1);
  });

  it("ships a layer stack that repair-on-open accepts verbatim", () => {
    expect(repairLayersAdv(map.layersAdv).changed).toBe(false);
    // All four core roles present exactly once after flattening.
    const roles = layerView(map)
      .filter((e) => e.role)
      .map((e) => e.role)
      .sort();
    expect(roles).toEqual(["decor", "decor2", "ground", "over"]);
    // The showcase exercises groups, blend, opacity, and tint.
    const flat = layerView(map);
    expect(map.layersAdv.some((l: any) => l.type === "group")).toBe(true);
    expect(flat.some((e) => e.blend === "add")).toBe(true);
    expect(flat.some((e) => e.opacity < 1)).toBe(true);
    expect(flat.some((e) => !!e.tint)).toBe(true);
    expect(flat.some((e) => e.slot === "above" && !!e.data)).toBe(true);
  });

  it("covers every zone kind, and each zone hits where authored", () => {
    const kinds = new Set(map.zones.map((z: any) => z.kind));
    for (const k of ["encounter", "weather", "sound", "transfer", "collision", "nav", "custom"]) {
      expect(kinds, `zone kind ${k}`).toContain(k);
    }
    const shapes = new Set(map.zones.map((z: any) => z.shape.type));
    for (const s of ["rect", "ellipse", "point", "poly"]) {
      expect(shapes, `zone shape ${s}`).toContain(s);
    }
    const hit = (x: number, y: number) => zonesAtTile(map.zones, x, y).map((z) => z.kind);
    expect(hit(15, 11)).toContain("encounter"); // wild meadow
    expect(hit(4, 12)).toContain("sound");      // pond ellipse
    expect(hit(4, 12)).toContain("weather");    // rain rect covers the pond
    expect(hit(12, 15)).toContain("transfer");  // south path point
    expect(hit(20, 8)).toContain("collision");  // flowerbed
    expect(hit(4, 13)).toContain("nav");        // stepping stones over water
    expect(hit(14, 10)).toContain("custom");    // plaza poly
    // The transfer points somewhere real.
    const transfer = map.zones.find((z: any) => z.kind === "transfer");
    expect(project.maps.some((m: any) => m.id === transfer.transfer.mapId)).toBe(true);
    // The encounter pool references real troops.
    const enc = map.zones.find((z: any) => z.kind === "encounter");
    for (const id of enc.encounter.troops) {
      expect(project.troops.some((t: any) => t.id === id), `troop ${id}`).toBe(true);
    }
  });

  it("automap rules evaluate deterministically to a non-trivial edit set", () => {
    const a = evaluateAutomap(map, map.automapRules);
    const b = evaluateAutomap(map, map.automapRules);
    expect(a.changed).toBeGreaterThan(0); // count of changed cells
    expect(a.edits.length).toBeGreaterThan(10);
    expect(b.edits).toEqual(a.edits); // seeded: Preview == Apply
    // Every edit lands inside the grid on a real layer.
    const ids = new Set(layerView(map).map((e) => e.id));
    for (const e of a.edits as any[]) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(map.width);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThan(map.height);
      // Tile writes target exactly one of role (a core layer) / layerId (a
      // generalized tile layer id present in the stack).
      if (e.type === "tile") {
        const target = e.role
          ? ["ground", "decor", "decor2", "over"].includes(e.role)
          : ids.has(e.layerId);
        expect(target, `edit target role=${e.role} layerId=${e.layerId}`).toBe(true);
      }
    }
  });

  it("keeps the frozen village and start position intact (golden guard)", () => {
    expect(project.system.startMapId).toBe(1);
    expect(project.system.startX).toBe(12);
    expect(project.system.startY).toBe(12);
    const village = project.maps.find((m: any) => m.id === 1);
    expect(village.layersAdv).toBeUndefined();
    expect(village.zones).toBeUndefined();
    expect(
      map.layers.ground,
      "map 5 is a committed copy of map 1's layout — after editing Meridian Village, rerun scripts/build-atlas-quest-advanced.mjs",
    ).toEqual(village.layers.ground);
    // Driftwood Shore (Phase 7's flagship) is still aboard too.
    expect(project.maps.some((m: any) => m.name === "Driftwood Shore")).toBe(true);
  });
});
