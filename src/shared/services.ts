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

/** The editor's project-document store (today js/editor/project-io.js over
 *  localStorage key "rpgatlas_project" with the legacy "driftwood_project"
 *  read-fallback and formatVersion migration on load). */
export interface ProjectRepository {
  /** Load + migrate the stored project, or null if none exists. */
  loadProject(): Project | null;
  saveProject(project: Project): void;
  /** True when a stored project exists (drives the editor's first-run flow). */
  hasProject(): boolean;
}

/** Per-game save slots + player options (today src/engine/state/save.ts and
 *  state/player-options.ts over localStorage, namespaced
 *  "rpgatlas_<gameId>_save_<slot>" / "rpgatlas_<gameId>_options" with
 *  pre-rebrand "driftwood_*" read-fallbacks). */
export interface SaveRepository {
  /** Summary for the save/load menu (null = empty slot). */
  slotInfo(slot: number): any | null;
  readSlot(slot: number): any | null;
  /** Throws/returns false on quota failure — caller shows the storage-full
   *  message (behavior fixed in Phase 0). */
  writeSlot(slot: number, payload: any): boolean;
  readOptions(): any | null;
  writeOptions(options: any): void;
}

/** The engine↔renderer boundary (today src/engine/render-glue.ts calling the
 *  classic js/renderer.js GLRender global for HD-2D and the 2D canvas path
 *  directly). Phase 2's three.js renderer implements this and the glue stops
 *  reaching into globals; until then the interface documents the surface the
 *  glue actually uses. */
export interface RendererAdapter {
  /** (Re)build renderer resources for the current map. */
  prepareMap(map: any, proj: Project): void;
  /** Draw one frame from the current game state (called from the loop's render
   *  phase; must not mutate game state). */
  renderFrame(state: any): void;
  /** HD-2D availability/teardown — mirrors today's lost-context fallback. */
  isAvailable(): boolean;
  dispose(): void;
}

/** Plugin host surface (today src/engine/plugin-runtime.ts + script-api.ts).
 *  The registerCommand bridge routes onto the interpreter registry
 *  (src/engine/interpreter/registry.ts). This surface is FROZEN for plugin
 *  compatibility — extend, never break. */
export interface PluginRuntime {
  loadAll(proj: Project): void;
  runHook(name: string, ...args: any[]): void;
  registerCommand(type: string, handler: (cmd: any, interp: any) => any): void;
}

/** Message/UI-stack presentation surface (today src/engine/message.ts +
 *  ui-stack.ts): what the interpreter's presentation commands and scenes call. */
export interface MessageService {
  showMessage(name: string, text: string, face?: any): Promise<void>;
  showList(items: any[], opts?: any): Promise<number>;
  fadeTo(opacity: number, ms: number): Promise<void>;
  richText(text: string): string;
}
