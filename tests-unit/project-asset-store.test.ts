/* RPGAtlas — tests-unit/project-asset-store.test.ts
   Project Harbor H4·A: the per-project AssetStore over an in-memory host. Whole files
   land in place under assets/<type>/ with a relPath; derived slices go to .atlas/cache/;
   remove never deletes an in-place file; putMany writes the index once. env=node (Blob,
   atob/btoa are Node globals). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it, vi } from "vitest";
import { ProjectAssetStore, type ProjectAssetHost } from "../src/platform/project-asset-store";
import type { AssetMeta } from "../src/shared/services";

const ROOT = "/Games/Demo";

/** An in-memory ProjectAssetHost that records its writes for assertions. */
function makeHost() {
  const index = new Map<string, string>();
  const files = new Map<string, { data: string; mtimeMs: number }>(); // relPath → bytes
  const cache = new Map<string, string>(); // hash → bytes
  const host: ProjectAssetHost = {
    async assetIndexRead() {
      return index.get(ROOT) ?? "[]";
    },
    async assetIndexWrite(_root, json) {
      index.set(ROOT, json);
    },
    async assetRead(_root, relPath, hash) {
      if (relPath) {
        const f = files.get(relPath);
        return f ? { data: f.data } : null;
      }
      if (hash) {
        const d = cache.get(hash);
        return d != null ? { data: d } : null;
      }
      return null;
    },
    async assetWriteInPlace(_root, type, fileName, dataBase64) {
      const dot = fileName.lastIndexOf(".");
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot) : "";
      let leaf = fileName;
      for (let i = 2; files.has(`assets/${type}/${leaf}`); i++) leaf = `${stem}-${i}${ext}`;
      const rel = `assets/${type}/${leaf}`;
      files.set(rel, { data: dataBase64, mtimeMs: 1 });
      return rel;
    },
    async assetWriteCache(_root, hash, dataBase64) {
      cache.set(hash, dataBase64);
    },
    async assetDeleteCache(_root, hash) {
      cache.delete(hash);
    },
  };
  return { host, index, files, cache };
}

function blob(bytes: number[], type = "image/png"): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function meta(over: Partial<AssetMeta>): AssetMeta {
  return {
    key: over.key || "asset:characters/hero",
    type: (over.type as any) || "characters",
    name: over.name || "hero",
    tags: over.tags || [],
    bytes: over.bytes ?? 3,
    hash: over.hash || "deadbeef",
    addedAt: 0,
    mime: over.mime,
    kind: over.kind,
    meta: over.meta,
    relPath: over.relPath,
  };
}

describe("ProjectAssetStore", () => {
  it("writes a whole file in place, records relPath, and reads it back", async () => {
    const { host, files } = makeHost();
    const store = new ProjectAssetStore(ROOT, host);
    const m = meta({ mime: "image/png", name: "hero" });
    await store.put(m, blob([1, 2, 3]));

    expect(m.relPath).toBe("assets/characters/hero.png");
    expect(files.has("assets/characters/hero.png")).toBe(true);

    const got = await store.get(m.key);
    expect(got).not.toBeNull();
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("routes a derived slice (meta.cellPos) to the cache, no relPath", async () => {
    const { host, cache, files } = makeHost();
    const store = new ProjectAssetStore(ROOT, host);
    const m = meta({
      key: "asset:tilesets/grass-r0c0",
      type: "tilesets",
      name: "grass-r0c0",
      hash: "aaaa",
      meta: { source: "grass.png", cellPos: { row: 0, col: 0 } },
    });
    await store.put(m, blob([9]));
    expect(m.relPath).toBeUndefined();
    expect(cache.has("aaaa")).toBe(true);
    expect(files.size).toBe(0);
    const got = await store.get(m.key);
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(new Uint8Array([9]));
  });

  it("adopts an already-in-place file without rewriting it", async () => {
    const { host } = makeHost();
    const spy = vi.spyOn(host, "assetWriteInPlace");
    const store = new ProjectAssetStore(ROOT, host);
    const m = meta({ relPath: "assets/characters/dropped.png" });
    await store.put(m, blob([5]));
    expect(spy).not.toHaveBeenCalled(); // the child's file is untouched
    expect(m.relPath).toBe("assets/characters/dropped.png");
  });

  it("remove deletes a cache blob but NEVER an in-place file", async () => {
    const { host, files, cache } = makeHost();
    const store = new ProjectAssetStore(ROOT, host);
    const whole = meta({ key: "asset:characters/hero", mime: "image/png" });
    const tile = meta({ key: "asset:tilesets/t", type: "tilesets", name: "t", hash: "bbbb", meta: { cellPos: { row: 1, col: 1 } } });
    await store.put(whole, blob([1]));
    await store.put(tile, blob([2]));

    await store.remove(tile.key);
    expect(cache.has("bbbb")).toBe(false); // derived blob gone
    await store.remove(whole.key);
    expect(files.has("assets/characters/hero.png")).toBe(true); // file survives (contract §7)
    expect(await store.list()).toHaveLength(0); // but the index entries are gone
  });

  it("putMany writes every blob but persists the index exactly once", async () => {
    const { host, cache } = makeHost();
    const spy = vi.spyOn(host, "assetIndexWrite");
    const store = new ProjectAssetStore(ROOT, host);
    await store.list(); // load once
    spy.mockClear();
    const items = [0, 1, 2].map((i) => ({
      meta: meta({ key: "asset:tilesets/t" + i, type: "tilesets", name: "t" + i, hash: "h" + i, meta: { cellPos: { row: 0, col: i } } }),
      blob: blob([i]),
    }));
    await store.putMany(items);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(3);
    expect(await store.list()).toHaveLength(3);
  });

  it("get returns null for a missing (vanished) in-place file", async () => {
    const { host, files } = makeHost();
    const store = new ProjectAssetStore(ROOT, host);
    const m = meta({ mime: "image/png" });
    await store.put(m, blob([1]));
    files.delete(m.relPath!); // the child deleted the file
    expect(await store.get(m.key)).toBeNull();
  });
});
