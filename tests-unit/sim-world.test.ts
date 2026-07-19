/* RPGAtlas — tests-unit/sim-world.test.ts
   Project Beacon MP1·A: the instanced world core's seam. Pins (1) the fresh-
   world initial state = the solo engine's boot initializers, (2) full
   isolation between instances (state AND RNG streams — a server hosts many
   worlds per process), (3) the RNG contract: unseeded IS Math.random, seeded
   IS mulberry32 (the seeded-e2e determinism guarantee), NaN/wrap coercion
   preserved, and (4) the engine-context compat shim: the eight world-classed
   ctx fields are live accessors over the default world — same values, same
   identities, same enumeration order. GPL-3.0-or-later (see LICENSE). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld } from "../src/shared/sim/world.js";
import { mulberry32 } from "../src/shared/rng.js";
import { ctx } from "../src/engine/state/engine-context.js";
import { defaultWorld } from "../src/engine/state/default-world.js";

afterEach(() => vi.restoreAllMocks());

describe("createWorld — fresh state", () => {
  it("game state matches the engine's boot-time G exactly", () => {
    const w = createWorld();
    expect(w.g).toEqual({
      switches: {},
      vars: {},
      selfSw: {},
      quests: {},
      party: [],
      inv: { item: {}, weapon: {}, armor: {} },
      gold: 0,
      wallet: {},
      mapId: 0,
      steps: 0,
      encSteps: 0,
      timeOfDay: 12,
      player: null,
    });
  });
  it("world slice matches the engine-context initializers exactly", () => {
    const w = createWorld();
    expect(w.map).toBeNull();
    expect(w.evRTs).toEqual([]);
    expect(w.blockingRun).toBe(false);
    expect(w.parallels).toBeInstanceOf(Map);
    expect(w.parallels.size).toBe(0);
    expect(w.commonParallels).toBeInstanceOf(Map);
    expect(w.commonParallels.size).toBe(0);
    expect(w.tick).toBe(0);
    expect(w.cameraZoom).toBe(1);
    expect(w.proj).toBeNull();
    expect(w.rngSeed).toBeNull();
  });
  it("binds the given project by reference", () => {
    const proj = { maps: [] };
    expect(createWorld(proj).proj).toBe(proj);
  });
});

describe("createWorld — instance isolation", () => {
  it("two worlds share no state", () => {
    const a = createWorld();
    const b = createWorld();
    a.g.switches.opened = true;
    a.g.party.push({ name: "Mira" });
    a.tick = 500;
    a.evRTs.push({ x: 1 });
    a.parallels.set("ev", true);
    a.blockingRun = true;
    a.cameraZoom = 2;
    expect(b.g.switches.opened).toBeUndefined();
    expect(b.g.party).toEqual([]);
    expect(b.tick).toBe(0);
    expect(b.evRTs).toEqual([]);
    expect(b.parallels.size).toBe(0);
    expect(b.blockingRun).toBe(false);
    expect(b.cameraZoom).toBe(1);
  });
  it("RNG streams are independent per world", () => {
    const a = createWorld(null, { seed: 1 });
    const b = createWorld(null, { seed: 2 });
    for (let i = 0; i < 100; i++) a.rndf(); // draining a must not advance b
    const ref = mulberry32(2);
    for (let i = 0; i < 8; i++) expect(b.rndf()).toBe(ref());
  });
});

describe("createWorld — the RNG contract", () => {
  it("same seed ⇒ the identical stream, and it IS mulberry32", () => {
    const a = createWorld(null, { seed: 123 });
    const b = createWorld(null, { seed: 123 });
    const ref = mulberry32(123);
    for (let i = 0; i < 64; i++) {
      const r = ref();
      expect(a.rndf()).toBe(r);
      expect(b.rndf()).toBe(r);
    }
    expect(a.rngSeed).toBe(123);
  });
  it("rnd(n) floors the same stream", () => {
    const w = createWorld(null, { seed: 7 });
    const ref = mulberry32(7);
    for (let i = 0; i < 32; i++) expect(w.rnd(100)).toBe(Math.floor(ref() * 100));
  });
  it("unseeded draws from Math.random (the solo default)", () => {
    // The stream captures the Math.random FUNCTION at creation/seed time
    // (exactly like the old module-level `let random = Math.random` in
    // util.ts), so the spy must be installed before the capture point.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const w = createWorld();
    expect(w.rndf()).toBe(0.25);
    expect(w.rnd(8)).toBe(2);
    spy.mockReturnValue(0.999);
    expect(w.rnd(4)).toBe(3);
  });
  it("seedRnd(null) restores Math.random on a seeded world", () => {
    const w = createWorld(null, { seed: 9 });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    w.seedRnd(null); // captures the (spied) Math.random now
    expect(w.rngSeed).toBeNull();
    expect(w.rndf()).toBe(0.5);
  });
  it("seeds coerce via >>> 0 (2^32 wrap and NaN→0, the ?rngseed=garbage path)", () => {
    const wrapped = createWorld(null, { seed: 2 ** 32 + 7 });
    const ref7 = mulberry32(7);
    for (let i = 0; i < 8; i++) expect(wrapped.rndf()).toBe(ref7());
    expect(wrapped.rngSeed).toBe(7);
    const nan = createWorld(null, { seed: NaN });
    const ref0 = mulberry32(0);
    for (let i = 0; i < 8; i++) expect(nan.rndf()).toBe(ref0());
    expect(nan.rngSeed).toBe(0);
  });
});

describe("engine-context compat shim", () => {
  it("the eight world-classed ctx fields are live views of the default world", () => {
    // Identities (collections are THE world's objects, not copies)
    expect(ctx.evRTs).toBe(defaultWorld.evRTs);
    expect(ctx.parallels).toBe(defaultWorld.parallels);
    expect(ctx.commonParallels).toBe(defaultWorld.commonParallels);
    // Writes through ctx land on the world…
    ctx.globalT = 41;
    expect(defaultWorld.tick).toBe(41);
    ctx.globalT++;
    expect(defaultWorld.tick).toBe(42);
    const m = { id: 3, name: "Shore" };
    ctx.map = m;
    expect(defaultWorld.map).toBe(m);
    const p = { system: { title: "T" } };
    ctx.proj = p;
    expect(defaultWorld.proj).toBe(p);
    ctx.blockingRun = true;
    expect(defaultWorld.blockingRun).toBe(true);
    // …and writes on the world are visible through ctx.
    defaultWorld.cameraZoom = 2.5;
    expect(ctx.cameraZoom).toBe(2.5);
    defaultWorld.evRTs = [{ x: 1 }];
    expect(ctx.evRTs).toBe(defaultWorld.evRTs);
  });
  it("shim keys stay enumerable own properties in the original literal order", () => {
    const keys = Object.keys(ctx);
    expect(keys[0]).toBe("proj"); // literal order preserved (defineProperty in place)
    for (const k of [
      "proj", "cameraZoom", "map", "evRTs", "blockingRun",
      "parallels", "commonParallels", "globalT",
    ]) {
      expect(keys).toContain(k);
    }
    // globalT sits where the literal declared it: after hdActive-era map keys,
    // before loopLast/loopAcc — pin the neighbourhood so a re-shim can't
    // silently reorder what a future serializer might walk.
    expect(keys.indexOf("globalT")).toBeGreaterThan(keys.indexOf("commonParallels"));
    expect(keys.indexOf("globalT")).toBeLessThan(keys.indexOf("loopLast"));
  });
  it("util.ts seedRnd/rnd/rndf delegate to the default world (via AtlasRng contract)", () => {
    // util.ts imports deps.ts (window at eval) so it cannot load under
    // vitest's node env — the delegation is asserted end-to-end by
    // tests/world-shim.test.js in the node:test harness. Here we pin the
    // world-side half: seeding the default world drives its stream.
    defaultWorld.seedRnd(123);
    const ref = mulberry32(123);
    for (let i = 0; i < 8; i++) expect(defaultWorld.rndf()).toBe(ref());
    defaultWorld.seedRnd(null);
  });
});
