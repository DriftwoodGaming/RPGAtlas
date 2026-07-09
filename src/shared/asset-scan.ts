/* RPGAtlas — src/shared/asset-scan.ts
   Pure planning cores for the per-project asset library (Project Harbor, Phase H4).
   No window/DOM/audio-deck imports — vitest runs env=node (trap 3). The stateful
   filesystem work (reading bytes, importing, writing the index) lives above these in
   the editor / platform layers; here we only decide WHAT to do.

   H4·A: `planLegacyMigration` — which global-library assets to copy into a freshly
   opened project. H4·B will add `planScan` (new / changed / missing) alongside it.
   docs/harbor-4-spec.md §2.3, §3. GPL-3.0-or-later (see LICENSE). */

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
