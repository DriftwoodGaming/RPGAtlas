/* RPGAtlas — src/shared/services.ts
   Phase 1 Stage D service contracts (Fable-authored, per docs/phase-1-spec.md).

   These interfaces name the seams the Phase 1 split produced, so later phases
   (Tauri FS + IndexedDB storage in Phase 6, the three.js renderer in Phase 2)
   can swap implementations at the edges without touching engine/editor logic.

   Phase 1 rule: adapters must reproduce today's behavior EXACTLY — same
   localStorage keys (including the pre-rebrand "driftwood_*" fallbacks), same
   migration hooks, same failure modes. The interfaces are the deliverable;
   browser adapters live in src/platform/browser/.

   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Project } from "./schema";

/** Minimal synchronous key-value driver — the shape both repositories consume.
 *  Today: window.localStorage. Phase 6 adds IndexedDB- and Tauri-FS-backed
 *  drivers (async variants will extend this; keep consumers behind the
 *  repositories, never on the driver directly). */
export interface StorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One library asset's metadata (Phase 6). The `key` is THE stable reference
 *  stored in project documents: "asset:<type>/<name>" — the same convention
 *  js/assets.js has used for img/-folder externals since Phase 0, so shipped,
 *  library, and project-embedded sources resolve through one namespace. */
export interface AssetMeta {
  /** "asset:<type>/<name>" — stable id, unique across the library. */
  key: string;
  type: "characters" | "facesets" | "enemies" | "tilesets" | "audio";
  /** Slug ([a-z0-9._-]), unique within `type`; suffix conventions
   *  (".pass"/".terrain" tiles) keep working. */
  name: string;
  /** Free-form labels + the reserved "pack:<id>" install tag. */
  tags: string[];
  bytes: number;
  /** SHA-256 hex of the blob — import dedupe + pack idempotency. */
  hash: string;
  /** Epoch ms at import. */
  addedAt: number;
  /** Blob MIME type (survives stores that strip it, e.g. base64 IPC). */
  mime?: string;
  /** Audio role: "bgm" | "bgs" | "me" | "se". */
  kind?: string;
  /** Image dimensions. */
  w?: number;
  h?: number;
  /** Audio duration, seconds. */
  dur?: number;
  /** Importer payloads (frame tags, source grid, …). */
  meta?: Record<string, any>;
}

/** The per-device binary asset library (Phase 6): IndexedDB in the browser
 *  (src/platform/browser/idb-asset-store.ts), app-data files under the Tauri
 *  desktop wrapper (src/platform/tauri/fs-asset-store.ts). Async by nature —
 *  consumers go through src/shared/asset-library.ts, never the store
 *  directly (mirroring the StorageDriver/repository split above). */
export interface AssetStore {
  list(): Promise<AssetMeta[]>;
  get(key: string): Promise<Blob | null>;
  put(meta: AssetMeta, blob: Blob): Promise<void>;
  remove(key: string): Promise<void>;
  /** Update metadata (tags/kind/meta) without touching the blob. */
  setMeta(meta: AssetMeta): Promise<void>;
}

/** The editor's project-document store (today js/editor/project-io.js over
 *  localStorage key "rpgatlas_project" with the legacy "driftwood_project"
 *  read-fallback and formatVersion migration on load). */
export interface ProjectRepository {
  /** Load + migrate the stored project, or null if none exists. */
  loadProject(): Project | null;
  saveProject(project: Project): void;
}

/** Per-game save slots + player options (today src/engine/state/save.ts and
 *  state/player-options.ts over localStorage, namespaced
 *  "rpgatlas_<gameId>_save_<slot>" / "rpgatlas_<gameId>_options" with
 *  pre-rebrand "driftwood_*" read-fallbacks). */
export interface SaveRepository {
  readSlot(slot: number): any | null;
  /** Returns false on quota/storage failure — the caller shows the
   *  storage-full message (behavior fixed in Phase 0). MUST NOT throw:
   *  src/engine/state/save.ts handles only the boolean, with no try/catch. */
  writeSlot(slot: number, payload: any): boolean;
  readOptions(): any | null;
  writeOptions(options: any): void;
}

/** The engine↔renderer boundary (src/engine/render-glue.ts over the seam
 *  src/renderer/index.ts — the three.js renderer, sole renderer since the
 *  classic raw-WebGL2 script retired at Phase 2 exit). */
export interface RendererAdapter {
  /** Draw one frame from the current game state on the shared engine context
   *  (called once per rAF from the loop's render phase; reads ctx, must not
   *  mutate game state). Today: render-glue.ts render(). */
  render(): Promise<void>;
  /** HD-2D availability — mirrors today's lost-context fallback gate
   *  (render-glue's `hdActive && !Renderer.isLost()`). */
  isAvailable(): boolean;
}

/** Plugin host surface (today the Plugins object in
 *  src/engine/plugin-runtime.ts; method names match the implementation).
 *  atlas.registerCommand routes onto the interpreter registry
 *  (src/engine/interpreter/registry.ts). This surface is FROZEN for plugin
 *  compatibility — extend, never break. */
export interface PluginRuntime {
  /** (Re)load every enabled project plugin; reads ctx.proj.plugins and
   *  publishes load results to window.AtlasPluginStatus. */
  runAll(): void;
  /** Fire a lifecycle hook (onMapLoad/onUpdate/onMessageText/…) on every loaded
   *  plugin; a throwing plugin is disabled, never the caller. */
  fire(name: string, arg?: any): void;
}

/** Message/UI-stack presentation surface (today src/engine/message.ts +
 *  ui-stack.ts): what the interpreter's presentation commands and scenes call. */
export interface MessageService {
  /** `opts` (M2·B): `{ background?: 0|1|2, position?: 0|1|2 }` — RM window
   *  backdrop (window/dim/transparent) + position (top/middle/bottom). */
  showMessage(name: string, text: string, face?: any, opts?: any): Promise<void>;
  showList(items: any[], opts?: any): Promise<number>;
  fadeTo(opacity: number, ms: number): Promise<void>;
  richText(text: string): string;
}
