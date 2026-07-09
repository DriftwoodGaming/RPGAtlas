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
// Project Harbor H4·A: the fake per-project asset filesystem.
const FILES_KEY = "atlas.fakehost.assetfiles"; // { [root]: { [relPath]: { data, mtimeMs } } }
const CACHE_KEY = "atlas.fakehost.assetcache"; // { [root]: { [hash]: data(base64) } }
const INDEX_KEY = "atlas.fakehost.assetindex"; // { [root]: libraryJson }
const GLOBAL_KEY = "atlas.fakehost.global"; // { metas: AssetMeta[], blobs: { [key]: base64 } } — legacy bridge

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};
function mimeForRel(rel: string): string | undefined {
  return MIME_BY_EXT[(rel.split(".").pop() || "").toLowerCase()];
}
function typeOfRel(rel: string): string {
  const parts = rel.split(/[\\/]+/);
  return parts.length >= 2 ? parts[1] : "characters"; // assets/<type>/<file>
}
function b64Len(data: string): number {
  try {
    return atob(data).length;
  } catch {
    return 0;
  }
}

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
  // --- H4 per-project asset controls -------------------------------------
  /** Drop a file into the fake project at `relPath` (base64), as if the child had
   *  pasted it into assets/<type>/ — the raw material an assets/ scan discovers. */
  seedAssetFile(root: string, relPath: string, dataBase64: string, mtimeMs?: number): void;
  /** Remove a fake in-place file (→ the scan reports it missing → MISSING_ASSET). */
  deleteAssetFile(root: string, relPath: string): void;
  /** The project's `.atlas/library.json` as parsed JSON (spec assertions). */
  readAssetIndex(root: string): any;
  /** Seed the legacy global <app-data>/library the H4·A bridge migrates from. */
  seedGlobalLibrary(metas: any[], blobs: Record<string, string>): void;
}

function makeFakeHost(): FakeHost {
  let nextDirectory: string | null = null;
  let nextFolder: string | null = null;

  const docs = () => readJson<Record<string, string>>(DOCS_KEY, {});
  const setDocs = (d: Record<string, string>) => writeJson(DOCS_KEY, d);
  const recents = () => parseRecents(localStorage.getItem(RECENTS_KEY) ?? "[]");
  const setRecents = (r: Recent[]) => writeJson(RECENTS_KEY, r);
  const empties = () => readJson<string[]>(EMPTY_KEY, []);

  // The fake per-project asset filesystem (H4·A).
  type FileRec = { data: string; mtimeMs: number };
  const files = () => readJson<Record<string, Record<string, FileRec>>>(FILES_KEY, {});
  const setFiles = (v: Record<string, Record<string, FileRec>>) => writeJson(FILES_KEY, v);
  const cache = () => readJson<Record<string, Record<string, string>>>(CACHE_KEY, {});
  const setCache = (v: Record<string, Record<string, string>>) => writeJson(CACHE_KEY, v);
  const indexes = () => readJson<Record<string, string>>(INDEX_KEY, {});
  const setIndexes = (v: Record<string, string>) => writeJson(INDEX_KEY, v);
  const globalLib = () =>
    readJson<{ metas: any[]; blobs: Record<string, string> }>(GLOBAL_KEY, { metas: [], blobs: {} });

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

    // --- H4·A per-project asset filesystem ---------------------------------
    async assetIndexRead(root) {
      return indexes()[root] ?? "[]";
    },
    async assetIndexWrite(root, json) {
      const all = indexes();
      all[root] = json;
      setIndexes(all);
    },
    async assetRead(root, relPath, hash) {
      if (relPath) {
        const rec = files()[root]?.[relPath];
        return rec ? { data: rec.data, mime: mimeForRel(relPath) } : null;
      }
      if (hash) {
        const data = cache()[root]?.[hash];
        return data != null ? { data } : null;
      }
      return null;
    },
    async assetWriteInPlace(root, type, fileName, dataBase64) {
      const all = files();
      const rootFiles = all[root] || (all[root] = {});
      // Collision-suffix -2, -3, … (mirrors the native free_path), never clobbering.
      const dot = fileName.lastIndexOf(".");
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
      const ext = dot > 0 ? fileName.slice(dot) : "";
      let leaf = fileName;
      for (let i = 2; Object.prototype.hasOwnProperty.call(rootFiles, `assets/${type}/${leaf}`); i++) {
        leaf = `${stem}-${i}${ext}`;
      }
      const relPath = `assets/${type}/${leaf}`;
      rootFiles[relPath] = { data: dataBase64, mtimeMs: Date.now() };
      setFiles(all);
      return relPath;
    },
    async assetWriteCache(root, hash, dataBase64) {
      const all = cache();
      const rootCache = all[root] || (all[root] = {});
      rootCache[hash] = dataBase64;
      setCache(all);
    },
    async assetDeleteCache(root, hash) {
      const all = cache();
      if (all[root]) {
        delete all[root][hash];
        setCache(all);
      }
    },
    async assetsScan(root) {
      const rootFiles = files()[root] || {};
      return Object.keys(rootFiles).map((relPath) => ({
        type: typeOfRel(relPath),
        relPath,
        size: b64Len(rootFiles[relPath].data),
        mtimeMs: rootFiles[relPath].mtimeMs,
      }));
    },

    // --- H4·A legacy global-library bridge ---------------------------------
    async globalAssetList() {
      return globalLib().metas;
    },
    async globalAssetRead(key: string) {
      const data = globalLib().blobs[key];
      if (data == null) return null;
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const mime = (globalLib().metas.find((m) => m && m.key === key) || {}).mime;
      return new Blob([bytes], mime ? { type: mime } : undefined);
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
    seedAssetFile(root, relPath, dataBase64, mtimeMs) {
      const all = files();
      const rootFiles = all[root] || (all[root] = {});
      rootFiles[relPath] = { data: dataBase64, mtimeMs: mtimeMs ?? Date.now() };
      setFiles(all);
    },
    deleteAssetFile(root, relPath) {
      const all = files();
      if (all[root]) {
        delete all[root][relPath];
        setFiles(all);
      }
    },
    readAssetIndex(root) {
      try {
        return JSON.parse(indexes()[root] ?? "[]");
      } catch {
        return [];
      }
    },
    seedGlobalLibrary(metas, blobs) {
      writeJson(GLOBAL_KEY, { metas: metas || [], blobs: blobs || {} });
    },
    reset() {
      try {
        for (const k of [DOCS_KEY, RECENTS_KEY, EMPTY_KEY, FILES_KEY, CACHE_KEY, INDEX_KEY, GLOBAL_KEY]) {
          localStorage.removeItem(k);
        }
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
