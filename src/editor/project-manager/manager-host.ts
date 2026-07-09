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
  type ProjectBundle,
} from "../../platform/tauri/project-host";
import type { Recent } from "../../shared/recents";

/** The project surface the manager depends on. `create`/`open`/`recents*`/`reveal`
 *  mirror the H1 native commands; the two pickers and the optional `exists` are
 *  manager-only concerns. Every method rejects with a `ProjectHostError` carrying a
 *  `ProjectErrorCode`, which the UI resolves to kid copy via project-errors.ts. */
export interface ManagerHost {
  create(parentDir: string, leaf: string, documentJson: string): Promise<ProjectBundle>;
  open(target: string): Promise<ProjectBundle>;
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
