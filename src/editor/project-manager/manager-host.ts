/* RPGAtlas — src/editor/project-manager/manager-host.ts
   The Project Manager's view of the world (Project Harbor, Phase H2·A). The
   manager UI talks to ONE interface — `ManagerHost` — so the real Tauri surface
   and the H2·D `?fakehost` test host are interchangeable. The real host delegates
   filesystem work to the H1 `projectHost` façade and pops the parent-directory /
   Browse pickers through the dialog plugin's JS API (available because
   `withGlobalTauri: true` and `dialog:default` is granted — no new command, no new
   capability). docs/harbor-2-spec.md §1.1. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { isTauri } from "../../../js/editor/host.js";
import {
  projectHost,
  ProjectHostError,
  type AssetBlobResult,
  type ProjectBundle,
  type ScannedFile,
} from "../../platform/tauri/project-host";
import type { Recent } from "../../shared/recents";
import type { AssetMeta } from "../../shared/services";

/** The project surface the manager depends on. `create`/`open`/`recents*`/`reveal`
 *  mirror the H1 native commands; the two pickers and the optional `exists` are
 *  manager-only concerns. Every method rejects with a `ProjectHostError` carrying a
 *  `ProjectErrorCode`, which the UI resolves to kid copy via project-errors.ts. */
export interface ManagerHost {
  create(parentDir: string, leaf: string, documentJson: string): Promise<ProjectBundle>;
  open(target: string): Promise<ProjectBundle>;
  /** Persist the document into <root>/game.rpgatlas (atomic + rolling backup). The
   *  editor's autosave (persistence.ts, H3·A) drives this once a folder game is open. */
  save(root: string, documentJson: string): Promise<void>;
  recentsList(): Promise<Recent[]>;
  recentsTouch(path: string, name: string): Promise<void>;
  recentsRemove(path: string): Promise<void>;
  reveal(root: string): Promise<void>;
  /** New Project parent-directory picker (native dialog). null = cancelled. */
  pickDirectory(): Promise<string | null>;
  /** Browse (Open) — pick a game folder. null = cancelled. */
  pickFolder(): Promise<string | null>;
  /** Optional existence probe. The real desktop host omits it (the webview cannot
   *  stat the FS without a command/plugin, and H2 adds neither), so a vanished
   *  recent is detected on click; the fake host implements it so the "missing row
   *  up front" behavior is e2e-covered. */
  exists?(path: string): Promise<boolean>;

  // --- Per-project asset filesystem (Project Harbor H4·A) -------------------
  // The per-project AssetStore (src/platform/project-asset-store.ts) talks to these,
  // so it works under real desktop AND the ?fakehost test host — the same real-vs-fake
  // split H3 used for `save`. See docs/harbor-4-spec.md §2.
  /** Read `.atlas/library.json` (the per-project asset index) as a JSON string. */
  assetIndexRead(root: string): Promise<string>;
  /** Atomically write `.atlas/library.json`. */
  assetIndexWrite(root: string, json: string): Promise<void>;
  /** Read one asset's bytes: `relPath` (in-place assets/ file) if set, else the cache
   *  blob `.atlas/cache/<hash>`. `null` when the file is gone (→ MISSING_ASSET state). */
  assetRead(root: string, relPath: string | null, hash: string | null): Promise<AssetBlobResult | null>;
  /** Write a whole-file asset in place under `assets/<type>/` (collision-suffixed);
   *  resolves to the actual project-relative path used. */
  assetWriteInPlace(root: string, type: string, fileName: string, dataBase64: string): Promise<string>;
  /** Write a derived/sliced blob to the content-addressed cache `.atlas/cache/<hash>`. */
  assetWriteCache(root: string, hash: string, dataBase64: string): Promise<void>;
  /** Delete a cache blob (best-effort; never touches an in-place assets/ file). */
  assetDeleteCache(root: string, hash: string): Promise<void>;
  /** Cheap snapshot of every known file under `assets/<type>/` (no bytes) — H4·B. */
  assetsScan(root: string): Promise<ScannedFile[]>;

  // --- Legacy global-library bridge (Project Harbor H4·A) -------------------
  // Optional read-only access to the old `<app-data>/library` so opening a project
  // that references global-library assets can copy them into the project's assets/
  // (one-time). The real host wraps the existing app-data `library_*` commands; the
  // pure browser build omits them. See docs/harbor-4-spec.md §2.3.
  globalAssetList?(): Promise<AssetMeta[]>;
  globalAssetRead?(key: string): Promise<Blob | null>;
}

/** base64 → Blob for the legacy global-library reads (mirrors fs-asset-store.ts). */
function base64ToBlob(base64: string, mime?: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

/** Raw invoke for the app-data `library_*` commands (the legacy bridge only). */
function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  return (window as any).__TAURI__.core.invoke(cmd, args);
}

/** The dialog plugin's JS API (withGlobalTauri). Missing → a friendly IO error
 *  rather than a raw `undefined is not a function`. */
function tauriDialog(): any {
  const d = (window as any).__TAURI__ && (window as any).__TAURI__.dialog;
  if (!d || typeof d.open !== "function") {
    throw new ProjectHostError("IO", "The folder picker isn't available.");
  }
  return d;
}

/** The dialog `open` result is a string, a string[] (multiple), or null. */
function firstPath(res: unknown): string | null {
  if (typeof res === "string") return res;
  if (Array.isArray(res) && typeof res[0] === "string") return res[0];
  return null;
}

/** The desktop host: H1 native commands + dialog-plugin pickers. */
const realManagerHost: ManagerHost = {
  create: (parentDir, leaf, documentJson) => projectHost.create(parentDir, leaf, documentJson),
  open: (target) => projectHost.open(target),
  save: (root, documentJson) => projectHost.save(root, documentJson),
  recentsList: () => projectHost.recentsList(),
  recentsTouch: (path, name) => projectHost.recentsTouch(path, name),
  recentsRemove: (path) => projectHost.recentsRemove(path),
  reveal: (root) => projectHost.reveal(root),
  async pickDirectory() {
    const res = await tauriDialog().open({
      directory: true,
      multiple: false,
      title: "Choose where to make your game",
    });
    return firstPath(res);
  },
  async pickFolder() {
    const res = await tauriDialog().open({
      directory: true,
      multiple: false,
      title: "Open your game's folder",
    });
    return firstPath(res);
  },

  // Per-project asset filesystem → the H4 project_assets.rs commands via the façade.
  assetIndexRead: (root) => projectHost.assetIndexRead(root),
  assetIndexWrite: (root, json) => projectHost.assetIndexWrite(root, json),
  assetRead: (root, relPath, hash) => projectHost.assetRead(root, relPath, hash),
  assetWriteInPlace: (root, type, fileName, dataBase64) =>
    projectHost.assetWriteInPlace(root, type, fileName, dataBase64),
  assetWriteCache: (root, hash, dataBase64) => projectHost.assetWriteCache(root, hash, dataBase64),
  assetDeleteCache: (root, hash) => projectHost.assetDeleteCache(root, hash),
  assetsScan: (root) => projectHost.assetsScan(root),

  // Legacy bridge → the existing app-data library_* commands (no new Rust needed).
  async globalAssetList() {
    const json: string = await invokeTauri("library_list");
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? (parsed as AssetMeta[]) : [];
  },
  async globalAssetRead(key: string) {
    const res: { data: string; mime?: string } | null = await invokeTauri("library_read", { key });
    if (!res || !res.data) return null;
    return base64ToBlob(res.data, res.mime || undefined);
  },
};

/** True when the URL carries `?fakehost` (the H2·D browser test hook). */
export function hasFakeHostParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("fakehost");
  } catch {
    return false;
  }
}

/** Whether the Project Manager should mount at all: desktop, or the test hook. */
export function managerActive(): boolean {
  return isTauri || hasFakeHostParam();
}

/** The host the manager should use right now: the installed fake host if present
 *  (only under ?fakehost), otherwise the real Tauri host. */
export function activeManagerHost(): ManagerHost {
  const fake = (window as any).__ATLAS_TEST_HOST__;
  if (fake) return fake as ManagerHost;
  return realManagerHost;
}
