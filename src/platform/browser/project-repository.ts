/* RPGAtlas — src/platform/browser/project-repository.ts
   The browser ProjectRepository (Phase 1 Stage D): the editor's project-
   document store over localStorage, WRAPPING the existing
   js/editor/project-io.js load/save logic verbatim. Behavior-frozen:

   - loadProject() -> loadStoredProject(driver, migrate): same "rpgatlas_project"
     key, same "driftwood_project" read-fallback, same one-time legacy rewrite,
     same meta.engine gate, same formatVersion migration. Returns null when no
     stored project exists — identical to today.
   - saveProject() -> saveProject(driver, project): same key, same JSON.

   The StorageDriver satisfies the {getItem,setItem,removeItem} shape that
   project-io.js already expects, so the wrapped functions run unchanged. The
   migration + validation callback is injected (the repository stays decoupled
   from js/data.js RA and the schema guard). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ProjectRepository, StorageDriver } from "../../shared/services";
import type { Project } from "../../shared/schema";
import {
  loadStoredProject,
  saveProject as saveProjectIo,
} from "../../../js/editor/project-io.js";
import { localStorageDriver } from "./local-storage-driver";

/** Called on a freshly-parsed stored project to migrate (and, at the editor's
 *  boundary, validate) it — supplied by the consumer so this module stays free
 *  of js/data.js and schema imports. */
export type ProjectMigrator = (project: any) => Project;

export class BrowserProjectRepository implements ProjectRepository {
  private readonly driver: StorageDriver;
  private readonly migrate: ProjectMigrator;

  constructor(migrate: ProjectMigrator, driver: StorageDriver = localStorageDriver) {
    this.migrate = migrate;
    this.driver = driver;
  }

  loadProject(): Project | null {
    return loadStoredProject(this.driver, this.migrate);
  }

  saveProject(project: Project): void {
    saveProjectIo(this.driver, project);
  }
}
