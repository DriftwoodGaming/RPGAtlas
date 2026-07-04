/* RPGAtlas — tests-unit/adv-zones-ops.test.ts
   The pure Objects-palette zone operations (src/editor/advanced/adv-zones.ts,
   Phase 8 Stage D): promote-on-first-edit (no `zones` key until an edit), id
   allocation, per-kind default payloads, add / find / delete / patch /
   reorder. These back the Objects palette and the zone drawing tools.
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import type { MapZone } from "../src/shared/schema";
import {
  ensureZones, nextZoneId, addZone, findZone, deleteZone, patchZone, moveZone, ZONE_KINDS,
} from "../src/editor/advanced/adv-zones";

interface TestMap { width: number; height: number; zones?: MapZone[] }
const mkMap = (): TestMap => ({ width: 8, height: 8, zones: undefined });

describe("ensureZones / promote-on-first-edit", () => {
  it("a classic map has no zones key until an edit", () => {
    const m = mkMap();
    expect(m.zones).toBeUndefined();
    const z = ensureZones(m);
    expect(Array.isArray(z)).toBe(true);
    expect(m.zones).toBe(z);
  });
});

describe("nextZoneId", () => {
  it("is max+1, min 1", () => {
    expect(nextZoneId([])).toBe(1);
    const zs = [{ id: 3 }, { id: 7 }] as MapZone[];
    expect(nextZoneId(zs)).toBe(8);
  });
});

describe("addZone", () => {
  it("appends a zone with the right kind, shape, and default payload", () => {
    const m = mkMap();
    const z = addZone(m, "encounter", { type: "rect", x: 1, y: 1, w: 2, h: 2 }, "Ambush");
    expect(z.id).toBe(1);
    expect(z.kind).toBe("encounter");
    expect(z.name).toBe("Ambush");
    expect(z.encounter).toEqual({ troops: [], rate: 30 });
    expect(m.zones).toHaveLength(1);
  });

  it("gives each kind a sensible (or empty) default payload", () => {
    const m = mkMap();
    const t = addZone(m, "transfer", { type: "point", x: 0, y: 0 });
    expect(t.transfer).toEqual({ mapId: 0, x: 0, y: 0 });
    const s = addZone(m, "sound", { type: "point", x: 0, y: 0 });
    expect(s.sound).toEqual({ key: "", vol: 1, falloff: "none" });
    const w = addZone(m, "weather", { type: "point", x: 0, y: 0 });
    expect(w.weather).toEqual({ kind: "rain", power: 5 });
    const c = addZone(m, "custom", { type: "point", x: 0, y: 0 });
    expect(c.encounter).toBeUndefined();
    expect(c.transfer).toBeUndefined();
  });

  it("allocates unique ids across many adds", () => {
    const m = mkMap();
    for (const k of ZONE_KINDS) addZone(m, k, { type: "point", x: 0, y: 0 });
    const ids = m.zones!.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("find / delete / patch / move", () => {
  it("finds and deletes by id", () => {
    const m = mkMap();
    const a = addZone(m, "encounter", { type: "point", x: 0, y: 0 });
    const b = addZone(m, "sound", { type: "point", x: 1, y: 1 });
    expect(findZone(m, a.id)).toBe(a);
    expect(deleteZone(m, a.id)).toBe(true);
    expect(findZone(m, a.id)).toBeNull();
    expect(m.zones).toEqual([b]);
    expect(deleteZone(m, 999)).toBe(false);
  });

  it("patches kind/name/shape and payloads in place", () => {
    const m = mkMap();
    const z = addZone(m, "custom", { type: "point", x: 0, y: 0 });
    patchZone(m, z.id, { kind: "weather", name: "Storm cell" });
    expect(z.kind).toBe("weather");
    expect(z.name).toBe("Storm cell");
    patchZone(m, 999, { name: "nope" }); // no throw on unknown id
  });

  it("reorders within the draw stack", () => {
    const m = mkMap();
    const a = addZone(m, "encounter", { type: "point", x: 0, y: 0 });
    const b = addZone(m, "sound", { type: "point", x: 1, y: 1 });
    expect(m.zones!.map((z) => z.id)).toEqual([a.id, b.id]);
    expect(moveZone(m, a.id, 1)).toBe(true);
    expect(m.zones!.map((z) => z.id)).toEqual([b.id, a.id]);
    expect(moveZone(m, b.id, -1)).toBe(false); // already at the bottom
  });
});
