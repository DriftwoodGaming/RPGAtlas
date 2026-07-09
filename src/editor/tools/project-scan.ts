/* RPGAtlas — src/editor/tools/project-scan.ts
   Auto-discovery of the project's assets/ folder (Project Harbor, Phase H4·B). This is
   the headline: paste a PNG into assets/tilesets, alt-tab back to the editor, and it's
   there. Runs on project open, on window focus, and via the Asset Browser's Scan button.

   The plan (new / changed / missing) is the pure planScan (src/shared/asset-scan.ts);
   here we do the reading, hashing, and importing. New files route through the SAME import
   wizard the picker uses — so the 48px slicer default, the overslice warning, and the
   batched index write (trap 5) all still apply — and are adopted IN PLACE (the child's
   file is never moved or copied). A file that vanished from assets/ becomes a friendly
   MISSING_ASSET state (its entry survives; putting the file back heals it).
   docs/harbor-4-spec.md §3. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, editorState as S, editorHooks } from "../editor-state";
import { openFolderRoot, touch } from "../persistence";
import { activeManagerHost } from "../project-manager/manager-host";
import { isEditorBooted } from "../project-manager/project-context";
import { planScan, type ScannedFile } from "../../shared/asset-scan";
import { wizardImport } from "../importers/import-wizard";
import {
  importAssets,
  libraryImageEntries,
  libraryMetas,
  removeAssets,
  sha256Hex,
  updateAssetMeta,
} from "../../shared/asset-library";
import type { AssetMeta } from "../../shared/services";

const IMAGE_TYPES = new Set(["characters", "facesets", "enemies", "tilesets"]);

let scanning = false;
const missingKeys = new Set<string>();
const listeners = new Set<() => void>();

/** True when a folder game is open (desktop or the ?fakehost hook). */
export function projectScanAvailable(): boolean {
  return openFolderRoot() != null;
}

/** Keys whose backing file is currently gone from assets/ (the MISSING_ASSET state).
 *  Recomputed on every scan, so a file that reappears clears itself. */
export function currentMissingKeys(): Set<string> {
  return missingKeys;
}

/** Subscribe to "the project library changed by a scan" (the Asset Browser refreshes). */
export function onProjectAssetsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notifyChanged(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* a listener throwing must not break the scan */
    }
  }
}

function base64ToBlob(base64: string, mime?: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

/** Read one discovered file's bytes into a File (for the wizard), or null if it vanished. */
async function fileFromHost(root: string, s: ScannedFile): Promise<File | null> {
  const res = await activeManagerHost().assetRead(root, s.relPath, null);
  if (!res || !res.data) return null;
  const mime = res.mime || "";
  const name = s.relPath.split(/[\\/]+/).pop() || "asset";
  return new File([base64ToBlob(res.data, mime)], name, mime ? { type: mime } : {});
}

/** Re-import a changed file, keeping its name/tags/key. Returns true when the content
 *  actually differed (a bare mtime touch is a no-op). */
async function reimportChanged(root: string, s: ScannedFile, file: File, hash: string): Promise<boolean> {
  const metas = libraryMetas();
  const whole = metas.find((m) => m.relPath === s.relPath);
  if (whole) {
    if (whole.hash === hash) {
      // Touched but identical — refresh the recorded mtime so we stop re-hashing it.
      await updateAssetMeta({ ...whole, mtimeMs: s.mtimeMs });
      return false;
    }
    // Real change: drop the old entry (the in-place file is NOT deleted — contract §7),
    // then re-adopt the new bytes under the same name/key so references keep resolving.
    await removeAssets([whole.key]);
    await importAssets([
      {
        blob: file,
        name: file.name,
        exactName: whole.name,
        type: whole.type,
        kind: whole.kind,
        tags: whole.tags,
        meta: whole.meta,
        relPath: s.relPath,
        mtimeMs: s.mtimeMs,
      },
    ]);
    return true;
  }
  // A sliced sheet: its tiles carry sourceRel === relPath. If the sheet's content is
  // unchanged (hash matches), leave it (a rare touched-but-identical sheet re-hashes on
  // the next scan — cheap; there are few sheets). If it changed, re-cut it: drop the old
  // tiles (their cache blobs go with them) and re-run the slicer on the new bytes.
  const slices = metas.filter((m) => m.meta && m.meta.sourceRel === s.relPath);
  if (slices.length) {
    if (slices[0].meta!.sourceHash === hash) return false;
    await removeAssets(slices.map((m) => m.key));
    await wizardImport([file], "tilesets", { relPath: s.relPath, hash, bytes: s.size, mtimeMs: s.mtimeMs });
    return true;
  }
  return false;
}

/** Scan assets/, import anything new/changed, and recompute the missing set. Returns a
 *  summary (or null when there's no folder game / the editor isn't up / a scan is running).
 *  Re-entrancy-guarded, so a focus event mid-scan (or mid-slicer-modal) is ignored. */
export async function runProjectScan(): Promise<{ added: number; changed: number; missing: number } | null> {
  const root = openFolderRoot();
  if (!root || !isEditorBooted() || scanning) return null;
  scanning = true;
  try {
    let scanned: ScannedFile[];
    try {
      scanned = await activeManagerHost().assetsScan(root);
    } catch {
      return null; // a scan failure must never break the editor
    }
    const plan = planScan(scanned, libraryMetas() as any);

    missingKeys.clear();
    for (const k of plan.missing) missingKeys.add(k);

    let added = 0;
    let changed = 0;
    let boundImages = false;

    for (const s of plan.newFiles) {
      const file = await fileFromHost(root, s);
      if (!file) continue;
      const hash = await sha256Hex(file);
      const imageType = (IMAGE_TYPES.has(s.type) ? s.type : "audio") as AssetMeta["type"];
      const metas = await wizardImport([file], imageType, {
        relPath: s.relPath,
        hash,
        bytes: s.size,
        mtimeMs: s.mtimeMs,
      });
      if (metas.length) {
        added += metas.length;
        if (metas.some((m) => m.type !== "audio")) boundImages = true;
      }
    }

    for (const s of plan.changedFiles) {
      const file = await fileFromHost(root, s);
      if (!file) continue;
      const hash = await sha256Hex(file);
      if (await reimportChanged(root, s, file, hash)) {
        changed += 1;
        boundImages = true; // conservative — a changed image needs re-binding
      }
    }

    if (boundImages) {
      await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
      editorHooks.rebuildAll();
    }
    if (added || changed) touch();
    notifyChanged();
    return { added, changed, missing: plan.missing.length };
  } finally {
    scanning = false;
  }
}

let focusInstalled = false;
/** Install the editor-wide focus/visibility scan once (idempotent). Inert unless a folder
 *  game is open, so the browser build never trips it. Called from boot. */
export function installProjectScanFocus(): void {
  if (focusInstalled || typeof window === "undefined") return;
  focusInstalled = true;
  const onWake = () => {
    if (projectScanAvailable()) void runProjectScan();
  };
  window.addEventListener("focus", onWake);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onWake();
  });
}
