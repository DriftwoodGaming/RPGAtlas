/* RPGAtlas — tests-unit/do-store.test.ts
   Project Beacon MP8·B (item 3, D-8-1): the Cloudflare persistence seam. A
   world DO (server/src/cf/world-do.ts) stores its state through
   `new KvWorldStore(doStorageKv(state.storage))` — the SAME KvWorldStore the
   Node/CF share, over a DO's `state.storage`. There is no miniflare in this
   project's test rig, so this proves the seam the DO depends on the way the DO
   uses it: doStorageKv over a faithful in-memory DurableObjectStorage stand-in
   (get/put/delete/list({prefix})), then a full WorldStore round-trip — world
   snapshot, per-passport records (list-by-prefix batch load), and per-map zone
   snapshots (with zoneIds). Deterministic, no DOM, no sockets → fast pool.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { KvWorldStore, type PlayerRecord } from "../server/src/core/store";
import { doStorageKv } from "../server/src/cf/do-store";

/** A minimal, faithful stand-in for the slice of DurableObjectStorage
 *  `doStorageKv` uses: get<T>, put, delete, and list<T>({ prefix }) → Map. */
function fakeDoStorage() {
  const m = new Map<string, unknown>();
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return m.has(key) ? (m.get(key) as T) : undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      // DO storage structured-clones on write; mirror that so a caller can't
      // mutate a stored value by reference (the file/memory stores don't either).
      m.set(key, JSON.parse(JSON.stringify(value)));
    },
    async delete(key: string): Promise<boolean> {
      return m.delete(key);
    },
    async list<T = unknown>(opts?: { prefix?: string }): Promise<Map<string, T>> {
      const prefix = opts?.prefix || "";
      const out = new Map<string, T>();
      for (const [k, v] of m) if (k.startsWith(prefix)) out.set(k, v as T);
      return out;
    },
    _map: m,
  };
}

const rec = (over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  name: "P", mapId: 1, x: 3, y: 4, dir: 2, data: {}, lastSeen: 100, ...over,
});

describe("Cloudflare DO persistence seam (KvWorldStore over doStorageKv)", () => {
  it("world snapshot round-trips (shared cells + bans)", async () => {
    const storage = fakeDoStorage();
    const store = new KvWorldStore(doStorageKv(storage as any));
    expect(await store.loadWorld()).toBeNull(); // nothing saved yet
    await store.saveWorld({ shared: { "switch:5": true, "var:1": 42, timeOfDay: 9 }, bans: ["fp-griefer"] });
    const back = await store.loadWorld();
    expect(back).toEqual({ shared: { "switch:5": true, "var:1": 42, timeOfDay: 9 }, bans: ["fp-griefer"] });
  });

  it("player records batch-load by prefix (the D-8-5 load path)", async () => {
    const storage = fakeDoStorage();
    const store = new KvWorldStore(doStorageKv(storage as any));
    expect(await store.loadRecords()).toEqual([]);
    await store.saveRecords([
      ["fp-a", rec({ name: "Ada", mapId: 1, x: 5, y: 6 })],
      ["fp-b", rec({ name: "Bo", mapId: 7, x: 2, y: 2, data: { "pSwitch:9": true } })],
    ]);
    const loaded = new Map(await store.loadRecords());
    expect(loaded.size).toBe(2);
    expect(loaded.get("fp-a")!.x).toBe(5);
    expect(loaded.get("fp-b")!.mapId).toBe(7);
    expect(loaded.get("fp-b")!.data["pSwitch:9"]).toBe(true);
    // Only rec: keys are records — a world/zone key never leaks into the batch.
    await store.saveWorld({ shared: {}, bans: [] });
    await store.saveZone(1, { selfSw: {}, data: {} });
    expect((await store.loadRecords()).length).toBe(2);
  });

  it("zone snapshots round-trip and zoneIds lists occupied maps", async () => {
    const storage = fakeDoStorage();
    const store = new KvWorldStore(doStorageKv(storage as any));
    expect(await store.zoneIds()).toEqual([]);
    await store.saveZone(1, { selfSw: { "1:3:A": true }, data: { events: [{ id: 6, x: 11, y: 10, dir: 2, page: 1, erased: false }] } });
    await store.saveZone(7, { selfSw: {}, data: {} });
    expect((await store.zoneIds()).sort((a, b) => a - b)).toEqual([1, 7]);
    const z1 = await store.loadZone(1);
    expect(z1!.selfSw["1:3:A"]).toBe(true);
    expect((z1!.data.events as any[])[0].x).toBe(11);
    expect(await store.loadZone(99)).toBeNull();
  });

  it("a truncated/corrupt stored unit reads as empty, never throws", async () => {
    const storage = fakeDoStorage();
    // Simulate a partially-written record (an ungraceful eviction mid-put).
    storage._map.set("rec:fp-x", { name: 42, mapId: "nope" });
    storage._map.set("world", { shared: null, bans: "not-an-array" });
    const store = new KvWorldStore(doStorageKv(storage as any));
    const world = await store.loadWorld();
    expect(world).toEqual({ shared: {}, bans: [] });
    const recs = await store.loadRecords();
    expect(recs.length).toBe(1);
    expect(typeof recs[0][1].name).toBe("string"); // normalised, not 42
    expect(recs[0][1].data).toEqual({});
  });
});
