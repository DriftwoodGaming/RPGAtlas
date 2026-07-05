/* RPGAtlas — src/editor/tools/asset-dropbox.ts
   The "copy files straight from your file manager" bridge for the desktop
   build. Beginners kept asking where to put their PNGs and sound files; this
   pairs a set of plain, per-type drop-folders on disk (created by the Tauri
   library_* commands in src-tauri/src/lib.rs) with a scan that hands whatever
   turned up back to the Asset Browser's normal import path. Purely a thin,
   Tauri-only wrapper: browser builds keep the drag-drop / file-picker flow and
   these helpers report themselves unavailable. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AssetMeta } from "../../shared/services";

type ImportType = AssetMeta["type"];

function tauri(): any {
  return typeof window !== "undefined" ? (window as any).__TAURI__ : null;
}

/** True on the desktop build, where the on-disk drop-folders exist. */
export function dropFolderAvailable(): boolean {
  return !!tauri();
}

function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  return tauri().core.invoke(cmd, args);
}

/** One file the scan turned up, ferried over IPC as base64. */
interface ScannedFile {
  type: ImportType;
  name: string;
  mime: string;
  data: string;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Absolute path of the import folder (creating the tree on first call), so
 *  the UI can show users exactly where to paste their files. */
export function importFolderPath(): Promise<string> {
  return invoke("library_import_dir");
}

/** Open the import folder in the OS file manager. */
export function revealImportFolder(): Promise<void> {
  return invoke("library_reveal_import");
}

/** Scan the per-type drop-folders and return the files found, grouped by the
 *  asset type their subfolder implies — ready to feed the import wizard. Each
 *  returned file has been moved into the folder's Imported/ archive by the
 *  backend, so scanning again is idempotent. */
export async function scanImportFolder(): Promise<Map<ImportType, File[]>> {
  const json: string = await invoke("library_scan_import");
  const list: ScannedFile[] = JSON.parse(json || "[]");
  const byType = new Map<ImportType, File[]>();
  for (const f of list) {
    const file = new File([base64ToBlob(f.data, f.mime)], f.name, { type: f.mime });
    const arr = byType.get(f.type);
    if (arr) arr.push(file);
    else byType.set(f.type, [file]);
  }
  return byType;
}
