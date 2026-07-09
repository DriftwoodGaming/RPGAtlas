/* RPGAtlas — src/editor/project-manager/legacy-assets.ts
   The one-time legacy bridge (Project Harbor, Phase H4·A). Before Harbor, desktop
   assets lived in the global <app-data>/library. When a project is opened whose
   document REFERENCES assets that are still only in that global library (not yet in
   the project's own .atlas/library.json), copy them into the project's assets/ so the
   folder is self-contained. Idempotent by construction: once copied, the project holds
   them, so the next open finds nothing to migrate.

   The pure "which keys to copy" decision is planLegacyMigration (src/shared/asset-scan.ts,
   vitest). Here we read the global blobs (through the ManagerHost's optional
   globalAsset* methods — the real host wraps the existing app-data library_* commands;
   the ?fakehost host serves a seeded global library) and import them into the active
   (per-project) store. docs/harbor-4-spec.md §2.3. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { h } from "../dom";
import { modal } from "../modals";
import {
  importAssets,
  libraryMetas,
  usedAssetKeys,
  type CatalogEntry,
} from "../../shared/asset-library";
import { planLegacyMigration } from "../../shared/asset-scan";
import { activeManagerHost } from "./manager-host";

/** Copy every used-but-not-yet-here global-library asset into the open project. Returns
 *  the number imported (0 when there's nothing to do, no global library, or an error —
 *  a migration hiccup must never block booting the game). */
export async function migrateGlobalLibraryAssets(project: any): Promise<number> {
  const host = activeManagerHost() as any;
  if (typeof host.globalAssetList !== "function" || typeof host.globalAssetRead !== "function") {
    return 0;
  }
  let globalMetas: any[];
  try {
    globalMetas = await host.globalAssetList();
  } catch {
    return 0; // no global library reachable (fresh install) — nothing to migrate
  }
  if (!Array.isArray(globalMetas) || !globalMetas.length) return 0;

  // Pair used characters with their global facesets via the GLOBAL catalog, so a
  // used sprite brings its message-box face along even if neither is in the project yet.
  const globalCatalog: CatalogEntry[] = globalMetas
    .filter((m) => m && typeof m.key === "string")
    .map((m) => ({ key: m.key, type: m.type, name: m.name }));
  const used = usedAssetKeys(project, globalCatalog);
  const projectKeys = new Set(libraryMetas().map((m) => m.key));
  const plan = planLegacyMigration(used, projectKeys, globalMetas);
  if (!plan.length) return 0;

  const byKey = new Map(globalMetas.map((m) => [m.key, m]));
  const items: any[] = [];
  for (const key of plan) {
    const gm = byKey.get(key);
    if (!gm) continue;
    let blob: Blob | null = null;
    try {
      blob = await host.globalAssetRead(key);
    } catch {
      blob = null;
    }
    if (!blob) continue;
    items.push({
      blob,
      name: gm.name,
      exactName: gm.name, // keep the name so the reference key still resolves
      type: gm.type,
      kind: gm.kind,
      tags: gm.tags,
      meta: gm.meta,
    });
  }
  if (!items.length) return 0;
  const imported = await importAssets(items);
  return imported.length;
}

/** A friendly, non-blocking notice that the bridge ran (shown after boot). */
export function showLegacyMigrationNotice(count: number): void {
  if (count <= 0) return;
  const noun = count === 1 ? "picture or sound" : "pictures and sounds";
  modal({
    title: "We tidied up your game",
    content: h(
      "div",
      null,
      h("p", null, `We brought ${count} ${noun} into this game's folder, so everything your game needs is now in one place.`),
      h("p", { class: "dim" }, "Now you can copy, back up, or zip your game's folder and it will work anywhere."),
    ),
    buttons: [{ label: "Great!", primary: true }],
  });
}
