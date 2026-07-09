/* RPGAtlas — src/platform/project-asset-store.ts
   The per-project AssetStore (Project Harbor, Phase H4·A): the desktop asset library
   now lives INSIDE the open project instead of the global <app-data>/library. It
   implements the same `AssetStore` interface src/shared/asset-library.ts already
   consumes, so nothing above it changes; only where the bytes live differs.

   Two storage locations, chosen per asset:
   - whole files (charsets, faces, enemies, un-sliced tiles, audio, flipbook sheets)
     are written IN PLACE under assets/<type>/ and referenced by `relPath` — the
     child's files, visible in their folder, never moved or deleted by the engine;
   - derived/sliced 48px tiles (meta.meta.cellPos) live content-addressed in
     .atlas/cache/<hash> — regenerable data, safe to delete.

   The index is .atlas/library.json (an AssetMeta[]). All filesystem work goes through
   a small `ProjectAssetHost` (the real Tauri host or the ?fakehost test host), so the
   whole thing is drivable in the browser build. docs/harbor-4-spec.md §2.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AssetMeta, AssetStore } from "../shared/services";

/** The filesystem surface the store needs (a structural subset of ManagerHost).
 *  boot passes `activeManagerHost()`, which satisfies it under desktop AND ?fakehost. */
export interface ProjectAssetHost {
  assetIndexRead(root: string): Promise<string>;
  assetIndexWrite(root: string, json: string): Promise<void>;
  assetRead(
    root: string,
    relPath: string | null,
    hash: string | null,
  ): Promise<{ data: string; mime?: string } | null>;
  assetWriteInPlace(root: string, type: string, fileName: string, dataBase64: string): Promise<string>;
  assetWriteCache(root: string, hash: string, dataBase64: string): Promise<void>;
  assetDeleteCache(root: string, hash: string): Promise<void>;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/flac": ".flac",
};

/** File extension for an in-place write: from the blob/meta MIME, else a sane default. */
function extFor(meta: AssetMeta, blob: Blob): string {
  const mime = blob.type || meta.mime || "";
  return EXT_BY_MIME[mime] || (meta.type === "audio" ? ".ogg" : ".png");
}

/** A derived/sliced tile (its blob belongs in .atlas/cache/, not assets/). */
function isDerived(meta: AssetMeta): boolean {
  return !!(meta.meta && meta.meta.cellPos != null);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBlob(base64: string, mime?: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

export class ProjectAssetStore implements AssetStore {
  private index: AssetMeta[] = [];
  private loaded = false;

  constructor(
    private readonly root: string,
    private readonly host: ProjectAssetHost,
  ) {}

  /** Load `.atlas/library.json` once. A corrupt/absent index degrades to `[]` (the
   *  files in assets/ are the source of truth; a re-scan re-derives the index). */
  private async ensureIndex(): Promise<void> {
    if (this.loaded) return;
    let parsed: any = [];
    try {
      parsed = JSON.parse((await this.host.assetIndexRead(this.root)) || "[]");
    } catch {
      parsed = [];
    }
    this.index = Array.isArray(parsed) ? parsed : [];
    this.loaded = true;
  }

  private async writeIndex(): Promise<void> {
    await this.host.assetIndexWrite(this.root, JSON.stringify(this.index));
  }

  /** Upsert a meta into the in-memory index by key (replace or append). */
  private upsert(meta: AssetMeta): void {
    const i = this.index.findIndex((m) => m.key === meta.key);
    if (i >= 0) this.index[i] = meta;
    else this.index.push(meta);
  }

  async list(): Promise<AssetMeta[]> {
    await this.ensureIndex();
    return this.index.slice();
  }

  async get(key: string): Promise<Blob | null> {
    await this.ensureIndex();
    const meta = this.index.find((m) => m.key === key);
    if (!meta) return null;
    const res = await this.host.assetRead(this.root, meta.relPath ?? null, meta.hash ?? null);
    if (!res || !res.data) return null; // missing file → MISSING_ASSET (caller renders it)
    return base64ToBlob(res.data, res.mime || meta.mime);
  }

  /** Write one asset's bytes to the right place (in-place file, or cache blob) and set
   *  `relPath` on the meta for whole files. An asset whose `relPath` is already set is
   *  ADOPTED (rename re-key, or an auto-discovered in-place file) — no bytes are written,
   *  so the child's file is never rewritten or moved. */
  private async writeBlob(meta: AssetMeta, blob: Blob): Promise<void> {
    if (meta.relPath) return; // already in place — adopt, never rewrite
    if (isDerived(meta)) {
      await this.host.assetWriteCache(this.root, meta.hash, await blobToBase64(blob));
      return;
    }
    const fileName = meta.name + extFor(meta, blob);
    meta.relPath = await this.host.assetWriteInPlace(this.root, meta.type, fileName, await blobToBase64(blob));
  }

  async put(meta: AssetMeta, blob: Blob): Promise<void> {
    await this.ensureIndex();
    await this.writeBlob(meta, blob);
    this.upsert(meta);
    await this.writeIndex();
  }

  /** Batch write (trap 5): a sliced tileset lands hundreds of tiles in one import; write
   *  every blob, then persist `.atlas/library.json` exactly once. */
  async putMany(items: { meta: AssetMeta; blob: Blob }[]): Promise<void> {
    await this.ensureIndex();
    for (const { meta, blob } of items) {
      await this.writeBlob(meta, blob);
      this.upsert(meta);
    }
    await this.writeIndex();
  }

  async remove(key: string): Promise<void> {
    await this.ensureIndex();
    const meta = this.index.find((m) => m.key === key);
    this.index = this.index.filter((m) => m.key !== key);
    await this.writeIndex();
    // Only cache blobs are ever deleted, and only when no other entry shares the hash.
    // An in-place assets/ file is NEVER deleted — the child owns it (contract §7).
    if (meta && !meta.relPath && meta.hash) {
      const stillUsed = this.index.some((m) => !m.relPath && m.hash === meta.hash);
      if (!stillUsed) {
        try {
          await this.host.assetDeleteCache(this.root, meta.hash);
        } catch {
          /* best-effort; a leftover cache blob is harmless */
        }
      }
    }
  }

  async setMeta(meta: AssetMeta): Promise<void> {
    await this.ensureIndex();
    this.upsert(meta); // index-only: tags/kind/name/relPath, never the file
    await this.writeIndex();
  }
}
