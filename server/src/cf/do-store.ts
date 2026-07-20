/* RPGAtlas — server/src/cf/do-store.ts
   Project Beacon MP8·B: the Cloudflare half of the WorldStore adapter. A
   Durable Object's `state.storage` is a transactional, SQLite-backed key/value
   store that survives hibernation and eviction — exactly the durability the
   §A5 persistence design wants for a world. This wraps it as the tiny `AsyncKv`
   surface `KvWorldStore` (core/store.ts) speaks, so the CF world reuses the
   SAME persistence logic the tests exercise over MemoryKv — no CF-specific
   store code, just this ~storage-shim.

   The directory DO builds `new KvWorldStore(doStorageKv(state.storage))` for
   world + records; a zone DO builds one for its own ZoneSnapshot. Wired by the
   CF world target (stage-B CF work); this file is the storage seam it plugs
   into. GPL-3.0-or-later (see LICENSE). */

import type { AsyncKv } from "../core/store.js";

/** Adapt a Durable Object storage handle to the world persistence `AsyncKv`.
 *  Only the four operations the WorldStore needs are exposed; DO storage's
 *  `list({ prefix })` returns a Map, from which we take the keys. */
export function doStorageKv(storage: DurableObjectStorage): AsyncKv {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return (await storage.get<T>(key)) ?? undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      await storage.put(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return storage.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      const map = await storage.list<unknown>({ prefix });
      return Array.from(map.keys());
    },
  };
}
