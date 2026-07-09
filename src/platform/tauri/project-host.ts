/* RPGAtlas — src/platform/tauri/project-host.ts
   Typed façade over the native project-folder commands (Project Harbor, Phase H1·C)
   — the same custom-invoke pattern as fs-asset-store.ts. Translates a thrown Rust
   `{ code, detail }` into a typed `ProjectHostError` carrying a `ProjectErrorCode`
   the UI resolves to copy via project-errors.ts. Not itself unit-tested (it is the
   IPC boundary, like fs-asset-store.ts); its pure inputs — the src/shared cores —
   are. Only boot wiring (H2) constructs this, gated on window.__TAURI__, so browser
   builds never touch it. docs/harbor-1-spec.md §8. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ProjectErrorCode } from "../../shared/project-errors";
import { parseRecents, type Recent } from "../../shared/recents";

/** A created/opened project (mirrors the Rust `ProjectBundle`, §3). */
export interface ProjectBundle {
  root: string;
  name: string;
  document: string;
}

/** A typed error carrying the taxonomy code; the UI resolves `code` → copy. */
export class ProjectHostError extends Error {
  readonly code: ProjectErrorCode;
  readonly detail?: string;
  constructor(code: ProjectErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ProjectHostError";
    this.code = code;
    this.detail = detail;
  }
}

function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  return (window as any).__TAURI__.core.invoke(cmd, args);
}

/** Coerce whatever Rust rejected with into a ProjectHostError. Rust returns a
 *  tagged `{ code, detail }`; anything unshaped (or a bare string) becomes IO. */
function toHostError(e: unknown): ProjectHostError {
  const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : null;
  const code =
    obj && typeof obj.code === "string" ? (obj.code as ProjectErrorCode) : "IO";
  const detail =
    obj && typeof obj.detail === "string"
      ? (obj.detail as string)
      : typeof e === "string"
        ? e
        : undefined;
  return new ProjectHostError(code, detail);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    throw toHostError(e);
  }
}

/** The typed project surface. `documentJson` is the ready blob-free document the
 *  caller (H2) builds from a template; `create` is template-agnostic (§3.1). */
export const projectHost = {
  create(parentDir: string, name: string, documentJson: string): Promise<ProjectBundle> {
    return call<ProjectBundle>("project_create", { parentDir, name, documentJson });
  },
  open(target: string): Promise<ProjectBundle> {
    return call<ProjectBundle>("project_open", { target });
  },
  save(root: string, documentJson: string): Promise<void> {
    return call<void>("project_save", { root, documentJson });
  },
  async recentsList(): Promise<Recent[]> {
    return parseRecents(await call<string>("recents_list"));
  },
  recentsTouch(path: string, name: string): Promise<void> {
    return call<void>("recents_touch", { path, name });
  },
  recentsRemove(path: string): Promise<void> {
    return call<void>("recents_remove", { path });
  },
  reveal(root: string): Promise<void> {
    return call<void>("project_reveal", { root });
  },
};
