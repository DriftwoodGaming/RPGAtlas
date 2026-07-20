/* RPGAtlas — server/src/node/file-store.ts
   Project Beacon MP8·B: the Node default WorldStore — a zero-dependency JSON
   snapshot directory. This is the answered branch point (Driftwood 2026-07-20,
   docs/mp-8-spec.md §A5): the self-host default persists a world to plain files
   so `node beacon.mjs --world --data ./world-data` needs nothing beyond Node —
   no native module, no separate database, human-readable snapshots a host can
   inspect or back up with `cp`.

     <data>/world.json          — WorldSnapshot (shared cells + bans)
     <data>/records.json        — every PlayerRecord (fingerprint → record)
     <data>/zone-<mapId>.json   — one ZoneSnapshot per occupied map

   Every write is atomic: serialize to a sibling temp file, fsync-free
   `rename()` over the target (libuv's rename is REPLACE_EXISTING on POSIX AND
   Windows, so a crash mid-write never leaves a half-written snapshot — the old
   one stays intact). Reads treat the JSON as possibly-corrupt (a truncated file
   from an ungraceful kill on an OLD Node/FS parses to null and the world starts
   fresh for that unit rather than crashing). GPL-3.0-or-later (see LICENSE). */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeRecord,
  normalizeWorld,
  normalizeZone,
  type PlayerRecord,
  type WorldSnapshot,
  type WorldStore,
  type ZoneSnapshot,
} from "../core/store.js";

export class NodeFileWorldStore implements WorldStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly dir: string) {}

  /** Ensure the data directory exists (once). */
  private ensureDir(): Promise<void> {
    if (!this.ready) this.ready = mkdir(this.dir, { recursive: true }).then(() => {});
    return this.ready;
  }

  private async readJson<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf8")) as T;
    } catch {
      return null; // ENOENT (fresh world) or a corrupt/partial file → start clean
    }
  }

  /** Atomic write: temp file then rename over the target. */
  private async writeJson(name: string, value: unknown): Promise<void> {
    await this.ensureDir();
    const target = join(this.dir, name);
    const tmp = target + ".tmp-" + process.pid + "-" + Date.now().toString(36);
    await writeFile(tmp, JSON.stringify(value), "utf8");
    try {
      await rename(tmp, target);
    } catch {
      // A rare Windows sharing race can reject the first rename; one retry after
      // a tick clears it. If it still fails, surface it (the flush caller logs).
      await new Promise((r) => setTimeout(r, 5));
      await rename(tmp, target);
    }
  }

  async loadWorld(): Promise<WorldSnapshot | null> {
    const v = await this.readJson<unknown>("world.json");
    return v ? normalizeWorld(v) : null;
  }
  async saveWorld(snap: WorldSnapshot): Promise<void> {
    await this.writeJson("world.json", snap);
  }

  async loadRecords(): Promise<Array<[string, PlayerRecord]>> {
    const v = await this.readJson<Record<string, unknown>>("records.json");
    if (!v || typeof v !== "object") return [];
    return Object.entries(v).map(([fp, rec]) => [fp, normalizeRecord(rec)]);
  }
  async saveRecords(batch: Array<[string, PlayerRecord]>): Promise<void> {
    // Merge the dirty batch into whatever is already on disk (the batch is the
    // changed set, not the whole world) and rewrite the one file atomically.
    const existing = await this.readJson<Record<string, unknown>>("records.json");
    const merged: Record<string, PlayerRecord> = {};
    if (existing && typeof existing === "object") {
      for (const [fp, rec] of Object.entries(existing)) merged[fp] = normalizeRecord(rec);
    }
    for (const [fp, rec] of batch) merged[fp] = rec;
    await this.writeJson("records.json", merged);
  }

  async loadZone(mapId: number): Promise<ZoneSnapshot | null> {
    const v = await this.readJson<unknown>("zone-" + mapId + ".json");
    return v ? normalizeZone(v) : null;
  }
  async saveZone(mapId: number, snap: ZoneSnapshot): Promise<void> {
    await this.writeJson("zone-" + mapId + ".json", snap);
  }

  async zoneIds(): Promise<number[]> {
    try {
      const files = await readdir(this.dir);
      const out: number[] = [];
      for (const f of files) {
        const m = /^zone-(\d+)\.json$/.exec(f);
        if (m) out.push(Number(m[1]));
      }
      return out;
    } catch {
      return [];
    }
  }
}
