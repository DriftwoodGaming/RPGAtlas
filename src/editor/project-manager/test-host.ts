/* RPGAtlas — src/editor/project-manager/test-host.ts
   The `window.__ATLAS_TEST_HOST__` fake host (Project Harbor, Phase H2·D — landed
   early, in H2·A, so the manager surface is Playwright-verifiable as it is built).
   Installed ONLY when the URL carries `?fakehost`, it simulates the whole Tauri
   project surface against a localStorage-backed fake filesystem, so specs can drive
   the manager in the pure browser build. It is never installed otherwise, so the
   existing 70 specs (which never pass ?fakehost) mount no manager and run unchanged.
   docs/harbor-2-spec.md §4. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ProjectHostError, type ProjectBundle } from "../../platform/tauri/project-host";
import {
  parseRecents,
  removeRecent,
  touchRecent,
  type Recent,
} from "../../shared/recents";
import type { ManagerHost } from "./manager-host";

const DOCS_KEY = "atlas.fakehost.docs"; // { [root]: documentJson }
const RECENTS_KEY = "atlas.fakehost.recents"; // Recent[]
const EMPTY_KEY = "atlas.fakehost.empty"; // string[] of folders with no game (NOT_A_PROJECT)

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable; the fake host degrades to non-persistent */
  }
}

/** Last path segment (handles both separators), the fake-FS analogue of the
 *  folder leaf the real `ProjectBundle.name` carries. */
function leafOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** Normalize a target to a project root: strip a trailing `game.rpgatlas` and any
 *  trailing separators, mirroring the native `resolve_target`. */
function toRoot(target: string): string {
  let t = target.replace(/[\\/]+$/, "");
  if (/[\\/]game\.rpgatlas$/i.test(t) || /^game\.rpgatlas$/i.test(t)) {
    t = t.replace(/[\\/]?game\.rpgatlas$/i, "");
  }
  return t.replace(/[\\/]+$/, "");
}

/** The fake host object — a full `ManagerHost` plus the stable **public test API**
 *  a Playwright spec drives through `window.__ATLAS_TEST_HOST__`:
 *
 *  - `setNextDirectory(path)` / `setNextFolder(path)` — queue what the New-Project
 *    parent-dir picker / the Browse folder picker return next (null = cancelled).
 *  - `seedDoc(root, json)` — put an openable game at `root` in the fake FS.
 *  - `seedRecent(entry)` — add a `{name, path, lastOpened}` recents row.
 *  - `seedEmptyFolder(path)` — a folder with no `game.rpgatlas` (→ `NOT_A_PROJECT`).
 *  - `deletePath(root)` — make a game's folder "vanish" (→ `MISSING` / missing row).
 *  - `reset()` — clear the fake FS + queued picks.
 *
 *  Persistence lives in localStorage (`atlas.fakehost.docs` / `.recents` / `.empty`),
 *  so state survives a reload; a spec can also seed those keys directly before the
 *  `?fakehost` navigation (the pattern in tests-e2e/project-manager.spec.mjs). */
export interface FakeHost extends ManagerHost {
  setNextDirectory(path: string | null): void;
  setNextFolder(path: string | null): void;
  seedDoc(root: string, documentJson: string): void;
  seedRecent(entry: Recent): void;
  seedEmptyFolder(path: string): void;
  deletePath(root: string): void;
  reset(): void;
}

function makeFakeHost(): FakeHost {
  let nextDirectory: string | null = null;
  let nextFolder: string | null = null;

  const docs = () => readJson<Record<string, string>>(DOCS_KEY, {});
  const setDocs = (d: Record<string, string>) => writeJson(DOCS_KEY, d);
  const recents = () => parseRecents(localStorage.getItem(RECENTS_KEY) ?? "[]");
  const setRecents = (r: Recent[]) => writeJson(RECENTS_KEY, r);
  const empties = () => readJson<string[]>(EMPTY_KEY, []);

  return {
    async create(parentDir, leaf, documentJson) {
      if (!parentDir) throw new ProjectHostError("IO", "no parent dir");
      if (!leaf) throw new ProjectHostError("UNSAFE_PATH", "empty name");
      const root = `${parentDir.replace(/[\\/]+$/, "")}/${leaf}`;
      const d = docs();
      if (Object.prototype.hasOwnProperty.call(d, root)) {
        throw new ProjectHostError("FOLDER_EXISTS");
      }
      d[root] = documentJson;
      setDocs(d);
      return { root, name: leaf, document: documentJson } as ProjectBundle;
    },
    async open(target) {
      const root = toRoot(target);
      const d = docs();
      if (Object.prototype.hasOwnProperty.call(d, root)) {
        return { root, name: leafOf(root), document: d[root] } as ProjectBundle;
      }
      if (empties().includes(root)) throw new ProjectHostError("NOT_A_PROJECT");
      throw new ProjectHostError("MISSING");
    },
    async save(root, documentJson) {
      // The fake folder file: a later open(root) returns exactly these bytes, so the
      // editor's autosave (H3·A) and external-change re-read (H3·B) are e2e-drivable.
      const d = docs();
      if (!Object.prototype.hasOwnProperty.call(d, root)) {
        throw new ProjectHostError("NOT_A_PROJECT", "no game folder at " + root);
      }
      d[root] = documentJson;
      setDocs(d);
    },
    async recentsList() {
      return recents();
    },
    async recentsTouch(path, name) {
      setRecents(touchRecent(recents(), { name, path, lastOpened: Date.now() }));
    },
    async recentsRemove(path) {
      setRecents(removeRecent(recents(), path));
    },
    async reveal() {
      /* no OS file manager under test */
    },
    async pickDirectory() {
      return nextDirectory;
    },
    async pickFolder() {
      return nextFolder;
    },
    async exists(path) {
      const root = toRoot(path);
      return (
        Object.prototype.hasOwnProperty.call(docs(), root) || empties().includes(root)
      );
    },

    // --- test controls -----------------------------------------------------
    setNextDirectory(path) {
      nextDirectory = path;
    },
    setNextFolder(path) {
      nextFolder = path;
    },
    seedDoc(root, documentJson) {
      const d = docs();
      d[root] = documentJson;
      setDocs(d);
    },
    seedRecent(entry) {
      setRecents(touchRecent(recents(), entry));
    },
    seedEmptyFolder(path) {
      const e = empties();
      if (!e.includes(path)) {
        e.push(path);
        writeJson(EMPTY_KEY, e);
      }
    },
    deletePath(root) {
      const d = docs();
      delete d[root];
      setDocs(d);
    },
    reset() {
      try {
        localStorage.removeItem(DOCS_KEY);
        localStorage.removeItem(RECENTS_KEY);
        localStorage.removeItem(EMPTY_KEY);
      } catch {
        /* ignore */
      }
      nextDirectory = null;
      nextFolder = null;
    },
  };
}

/** Install the fake host on `window.__ATLAS_TEST_HOST__` (idempotent). Called from
 *  boot.ts's `start()` only when `?fakehost` is present. */
export function installFakeHost(): void {
  if ((window as any).__ATLAS_TEST_HOST__) return;
  (window as any).__ATLAS_TEST_HOST__ = makeFakeHost();
}
