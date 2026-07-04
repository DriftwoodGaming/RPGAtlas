/* RPGAtlas — tests-unit/layer-view.test.ts
   The pure layer-view core (src/shared/layer-view.ts, Phase 8 Stage A):
   classic default stack, repair-on-open invariants (one core per role,
   missing cores inserted in classic order, dupes/unknowns dropped, unique
   ids), group inheritance in flatten, shadow position, id allocation.
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import type { AdvLayer } from "../src/shared/schema";
import {
  CORE_ROLES, classicStack, repairLayersAdv, flattenLayers, layerView,
  shadowIndex, nextLayerId, type CoreRole,
} from "../src/shared/layer-view";

const core = (role: CoreRole, id = 0) =>
  ({ id, name: String(role), type: "core", role }) as AdvLayer;

describe("classicStack / layerView absent", () => {
  it("absent layersAdv yields the four cores in classic order", () => {
    const view = layerView({});
    expect(view.map((e) => e.role)).toEqual(CORE_ROLES);
    expect(view.map((e) => e.slot)).toEqual(["below", "below", "below", "above"]);
    expect(view.every((e) => e.visible && !e.locked && e.opacity === 1 && e.blend === "normal")).toBe(true);
  });

  it("classicStack entries have unique ids", () => {
    const ids = classicStack().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("repairLayersAdv", () => {
  it("valid stack passes through unchanged", () => {
    const stack: AdvLayer[] = [
      core("ground", 1), core("decor", 2), core("decor2", 3),
      { id: 5, name: "Mist", type: "tile", data: [0, 0], slot: "above" },
      core("over", 4),
    ];
    const { layers, changed } = repairLayersAdv(stack);
    expect(changed).toBe(false);
    expect(layers).toEqual(stack);
  });

  it("inserts missing cores in classic order", () => {
    const { layers, changed } = repairLayersAdv([
      core("decor", 1),
      { id: 9, name: "Fog", type: "tile", data: [] },
    ]);
    expect(changed).toBe(true);
    const roles = layers.flatMap((l) => (l.type === "core" ? [l.role] : []));
    expect(roles).toEqual(CORE_ROLES);
    // ground inserted before the existing decor core
    expect(layers[0].type === "core" && layers[0].role).toBe("ground");
  });

  it("drops duplicate cores (first wins) and unknown types", () => {
    const { layers, changed } = repairLayersAdv([
      core("ground", 1), core("decor", 2), core("decor2", 3), core("over", 4),
      { ...core("ground", 8), name: "impostor" },
      { id: 9, name: "???", type: "wat" } as unknown as AdvLayer,
    ]);
    expect(changed).toBe(true);
    expect(layers.filter((l) => l.type === "core")).toHaveLength(4);
    expect(layers.some((l) => l.name === "impostor" || l.name === "???")).toBe(false);
  });

  it("renumbers duplicate ids without touching the rest", () => {
    const { layers, changed } = repairLayersAdv([
      core("ground", 1), core("decor", 1), core("decor2", 3), core("over", 4),
    ]);
    expect(changed).toBe(true);
    const ids = layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(1); // first keeps its id
  });

  it("repairs inside groups and keeps a grouped core", () => {
    const { layers } = repairLayersAdv([
      core("ground", 1),
      { id: 10, name: "town", type: "group", children: [core("decor", 2)] },
      core("decor2", 3), core("over", 4),
    ]);
    const flat = flattenLayers(layers);
    expect(flat.filter((e) => e.role)).toHaveLength(4);
    expect(flat.find((e) => e.role === "decor")!.path).toEqual([10]);
  });

  it("non-array input falls back to the classic stack", () => {
    const { layers, changed } = repairLayersAdv(undefined);
    expect(changed).toBe(true);
    expect(layers.map((l) => l.type === "core" && l.role)).toEqual(CORE_ROLES);
  });
});

describe("flattenLayers", () => {
  it("resolves group inheritance: visibility ANDs, lock ORs, opacity multiplies", () => {
    const flat = flattenLayers([
      {
        id: 1, name: "g", type: "group", visible: false, locked: true, opacity: 0.5,
        children: [{ id: 2, name: "t", type: "tile", data: [], opacity: 0.5, visible: true }],
      },
    ]);
    expect(flat).toHaveLength(1);
    expect(flat[0].visible).toBe(false);
    expect(flat[0].locked).toBe(true);
    expect(flat[0].opacity).toBe(0.25);
  });

  it("defaults blend to normal and rejects unknown blends", () => {
    const flat = flattenLayers([
      { id: 1, name: "a", type: "tile", data: [], blend: "screen" },
      { id: 2, name: "b", type: "tile", data: [], blend: "overlay" as never },
    ]);
    expect(flat[0].blend).toBe("screen");
    expect(flat[1].blend).toBe("normal");
  });
});

describe("shadowIndex", () => {
  it("shadows sit immediately below the first above-slot layer (classic: over)", () => {
    const view = layerView({});
    expect(shadowIndex(view)).toBe(3); // ground, decor, decor2, [shadows], over
  });

  it("with no above layers shadows draw last", () => {
    const flat = flattenLayers([core("ground", 1)]);
    expect(shadowIndex(flat)).toBe(1);
  });
});

describe("nextLayerId", () => {
  it("scans nested groups", () => {
    expect(nextLayerId([
      core("ground", 1),
      { id: 2, name: "g", type: "group", children: [{ id: 7, name: "t", type: "tile", data: [] }] },
    ])).toBe(8);
  });
});
