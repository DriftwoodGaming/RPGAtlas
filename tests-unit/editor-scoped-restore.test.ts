/* RPGAtlas — tests-unit/editor-scoped-restore.test.ts
   Pure core of the unified undo's scoped snapshots
   (src/editor/scoped-restore.ts, Phase 3 Stage F).
   GPL-3.0-or-later. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import {
  cloneScoped, restoreScoped, restoreInto, sameScoped, type ScopeSpec,
} from "../src/editor/scoped-restore";

describe("cloneScoped", () => {
  it("deep-clones the scope's container", () => {
    const live = { items: [{ id: 1, name: "Potion" }] };
    const snap = cloneScoped({ label: "t", get: () => live });
    expect(snap).toEqual(live);
    expect(snap).not.toBe(live);
    expect(snap.items[0]).not.toBe(live.items[0]);
  });

  it("excludes skipped top-level keys", () => {
    const live = { maps: [{ id: 1 }], actors: [{ id: 1 }] };
    const snap = cloneScoped({ label: "t", get: () => live, skip: ["maps"] });
    expect(snap.actors).toEqual([{ id: 1 }]);
    expect("maps" in snap).toBe(false);
  });

  it("clones array scopes directly", () => {
    const live = [{ id: 1 }, { id: 2 }];
    const snap = cloneScoped({ label: "t", get: () => live });
    expect(snap).toEqual(live);
    expect(snap).not.toBe(live);
  });
});

describe("restoreInto", () => {
  it("replaces array contents wholesale, keeping the array's identity", () => {
    const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
    restoreInto(arr, [{ id: 9 }]);
    expect(arr).toEqual([{ id: 9 }]);
  });

  it("keeps nested object identity while overwriting values", () => {
    const target = { system: { title: "Old", startX: 3 }, items: [1, 2] };
    const sys = target.system, items = target.items;
    restoreInto(target, { system: { title: "New", startX: 7 }, items: [5] });
    expect(target.system).toBe(sys);       // same object other modules hold
    expect(target.items).toBe(items);      // same array reference
    expect(target).toEqual({ system: { title: "New", startX: 7 }, items: [5] });
  });

  it("deletes keys absent from the snapshot and adds new ones", () => {
    const target: any = { keep: 1, drop: 2 };
    restoreInto(target, { keep: 1, added: 3 });
    expect(target).toEqual({ keep: 1, added: 3 });
  });

  it("never touches skipped keys (delete or assign)", () => {
    const maps = [{ id: 1 }];
    const target: any = { maps, actors: ["a"] };
    restoreInto(target, { actors: ["b"], maps: [{ id: 99 }] }, ["maps"]);
    expect(target.maps).toBe(maps);
    expect(target.maps).toEqual([{ id: 1 }]);
    expect(target.actors).toEqual(["b"]);
    // skipped key missing from the snapshot must survive too
    restoreInto(target, { actors: ["c"] }, ["maps"]);
    expect(target.maps).toBe(maps);
  });

  it("replaces when the types disagree (object vs array vs scalar)", () => {
    const target: any = { a: { x: 1 }, b: [1], c: 5 };
    restoreInto(target, { a: [2], b: { y: 3 }, c: null });
    expect(target).toEqual({ a: [2], b: { y: 3 }, c: null });
  });
});

describe("restoreScoped round-trip", () => {
  it("capture → mutate → restore returns the container to the captured state", () => {
    const proj: any = {
      maps: [{ id: 1, name: "keep me" }],
      items: [{ id: 1, name: "Potion", price: 50 }],
      system: { gold: 100 },
    };
    const scope: ScopeSpec = { label: "Database edit", get: () => proj, skip: ["maps"] };
    const before = cloneScoped(scope);

    proj.items.push({ id: 2, name: "Ether", price: 200 });
    proj.items[0].price = 999;
    proj.system.gold = 0;
    proj.maps[0].name = "edited map";           // outside the scope
    expect(sameScoped(before, cloneScoped(scope))).toBe(false);

    const itemsRef = proj.items, systemRef = proj.system;
    restoreScoped(scope, before);
    expect(proj.items).toBe(itemsRef);
    expect(proj.system).toBe(systemRef);
    expect(proj.items).toEqual([{ id: 1, name: "Potion", price: 50 }]);
    expect(proj.system.gold).toBe(100);
    expect(proj.maps[0].name).toBe("edited map"); // skipped key untouched
    expect(sameScoped(before, cloneScoped(scope))).toBe(true);
  });

  it("restore inserts clones — later mutations don't corrupt the snapshot", () => {
    const live = { list: [{ n: 1 }] };
    const scope: ScopeSpec = { label: "t", get: () => live };
    const snap = cloneScoped(scope);
    live.list[0].n = 2;
    restoreScoped(scope, snap);
    live.list[0].n = 3;                          // mutate the restored state
    expect(snap).toEqual({ list: [{ n: 1 }] });  // snapshot still pristine
  });
});

describe("sameScoped", () => {
  it("is structural, order-sensitive equality", () => {
    expect(sameScoped({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true);
    expect(sameScoped({ a: 1 }, { a: 2 })).toBe(false);
  });
});
