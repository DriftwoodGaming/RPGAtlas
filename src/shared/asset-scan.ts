/* RPGAtlas — src/shared/asset-scan.ts
   Pure planning cores for the per-project asset library (Project Harbor, Phase H4).
   No window/DOM/audio-deck imports — vitest runs env=node (trap 3). The stateful
   filesystem work (reading bytes, importing, writing the index) lives above these in
   the editor / platform layers; here we only decide WHAT to do.

   H4·A: `planLegacyMigration` — which global-library assets to copy into a freshly
   opened project. H4·B: `planScan` — diffs an assets/ snapshot against the index into
   new / changed / missing, cheaply (size + mtime, no hashing here).
   docs/harbor-4-spec.md §2.3, §3. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal view of a library asset (only the key matters for the migration plan). */
export interface KeyedAsset {
  key: string;
}

/** Which global-library asset keys to copy into the open project (H4·A legacy bridge).
 *  A key qualifies when the project's document USES it, the project doesn't already
 *  hold it, and the global library CAN provide it. Order follows `globalMetas` (a
 *  stable, deterministic copy order). Pure — vitest-covered. */
export function planLegacyMigration(
  usedKeys: Set<string>,
  projectKeys: Set<string>,
  globalMetas: KeyedAsset[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of globalMetas) {
    if (!m || typeof m.key !== "string") continue;
    if (seen.has(m.key)) continue;
    if (usedKeys.has(m.key) && !projectKeys.has(m.key)) {
      out.push(m.key);
      seen.add(m.key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// H4·B — auto-discovery scan plan
// ---------------------------------------------------------------------------

/** One file a native/fake assets/ scan turned up (cheap: no bytes). */
export interface ScannedFile {
  type: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** A library entry as `planScan` reads it: an in-place file carries `relPath` +
 *  `bytes`/`mtimeMs`; a derived slice carries its source in `meta` (sourceRel / …). */
export interface IndexedAsset {
  key: string;
  relPath?: string;
  bytes?: number;
  mtimeMs?: number;
  meta?: Record<string, any>;
}

export interface ScanPlan {
  /** Files at a relPath the index has never seen → route through the import wizard. */
  newFiles: ScannedFile[];
  /** Known relPath whose size/mtime moved → the caller re-hashes to confirm a real change. */
  changedFiles: ScannedFile[];
  /** Asset keys whose backing source file is gone from assets/ → MISSING_ASSET state. */
  missing: string[];
}

/** Every source file the index knows about → its recorded {size, mtime, owning keys}.
 *  A whole-file entry owns its own `relPath`; a sliced tile points at `meta.sourceRel`
 *  (many tiles share one sheet). */
function indexSources(index: IndexedAsset[]): Map<string, { size?: number; mtime?: number; keys: string[] }> {
  const sources = new Map<string, { size?: number; mtime?: number; keys: string[] }>();
  const add = (rel: string, size: number | undefined, mtime: number | undefined, key: string) => {
    const cur = sources.get(rel);
    if (cur) {
      cur.keys.push(key);
      // Keep the first-seen size/mtime (all slices of one sheet record the same).
      if (cur.size == null) cur.size = size;
      if (cur.mtime == null) cur.mtime = mtime;
    } else {
      sources.set(rel, { size, mtime, keys: [key] });
    }
  };
  for (const m of index) {
    if (!m || typeof m.key !== "string") continue;
    if (m.relPath) {
      add(m.relPath, m.bytes, m.mtimeMs, m.key);
    } else if (m.meta && typeof m.meta.sourceRel === "string") {
      add(m.meta.sourceRel, m.meta.sourceBytes, m.meta.sourceMtime, m.key);
    }
  }
  return sources;
}

/** Diff an assets/ scan snapshot against the index. Pure — the caller does the reading,
 *  hashing, importing, and MISSING rendering. A known file whose size AND mtime match is
 *  skipped (no read, no hash — keeps a focus-scan cheap); anything else is a candidate.
 *  A source relPath the index knows but the scan didn't see → its keys are missing. */
export function planScan(scanned: ScannedFile[], index: IndexedAsset[]): ScanPlan {
  const sources = indexSources(index);
  const seenRels = new Set<string>();
  const newFiles: ScannedFile[] = [];
  const changedFiles: ScannedFile[] = [];
  for (const s of scanned) {
    if (!s || typeof s.relPath !== "string") continue;
    seenRels.add(s.relPath);
    const src = sources.get(s.relPath);
    if (!src) {
      newFiles.push(s);
    } else if (src.size !== s.size || src.mtime !== s.mtimeMs) {
      changedFiles.push(s);
    }
    // else: unchanged → skip.
  }
  const missing: string[] = [];
  for (const [rel, src] of sources) {
    if (!seenRels.has(rel)) missing.push(...src.keys);
  }
  return { newFiles, changedFiles, missing };
}
