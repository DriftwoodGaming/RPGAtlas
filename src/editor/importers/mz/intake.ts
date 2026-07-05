/* RPGAtlas — src/editor/importers/mz/intake.ts
   Project Compass M1·A: file intake. `MzFileSource` abstracts "give me the text
   / bytes / list of a dropped project" so the same reader serves a browser
   directory-picker / drag-drop (`fileListSource`), an in-memory map
   (`objectSource`, used by tests), and an injected filesystem (`fsSource` — the
   seam Tauri's FS dialog and node plug into). `readRawProject` parses the
   `data/*.json` the database converters need, sniffs MV/MZ, reads `js/plugins.js`,
   and discovers asset paths. The Tauri dialog + .zip inflate are wired in M1·D
   (the wizard); this is the testable core. Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ImportReport } from "./report";
import { sniffFormat } from "./sniff";
import type { MzRawData, RmList, RmMap, RmMapInfo, RmPlugin, RmSystem, RmTileset } from "./raw-types";

/** A read-only view of an intaken project tree, keyed by project-root-relative
 *  POSIX paths ("data/System.json", "img/pictures/Sign.png_"). */
export interface MzFileSource {
  /** All file paths present (project-root-relative, POSIX separators). */
  list(): Promise<string[]>;
  /** UTF-8 text of a file, or null if absent. */
  readText(path: string): Promise<string | null>;
  /** Raw bytes of a file, or null if absent. */
  readBytes(path: string): Promise<Uint8Array | null>;
}

const dec = new TextDecoder();
const enc = new TextEncoder();

function norm(path: string): string {
  return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "");
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** In-memory source over a `{ path: string | Uint8Array }` map (tests, and the
 *  target of a future zip inflate). */
export function objectSource(files: Record<string, string | Uint8Array>): MzFileSource {
  const map = new Map<string, string | Uint8Array>();
  for (const [k, v] of Object.entries(files)) map.set(norm(k), v);
  return {
    async list() {
      return [...map.keys()];
    },
    async readText(path) {
      const v = map.get(norm(path));
      if (v == null) return null;
      return typeof v === "string" ? v : dec.decode(v);
    },
    async readBytes(path) {
      const v = map.get(norm(path));
      if (v == null) return null;
      return typeof v === "string" ? enc.encode(v) : v;
    },
  };
}

/** Browser source over a directory-picker / drag-drop `File[]`. Paths come from
 *  `webkitRelativePath` (falling back to `name`); the shared leading project
 *  folder is stripped so paths are project-root-relative. */
export function fileListSource(files: File[]): MzFileSource {
  const rel = (f: File): string => norm((f as any).webkitRelativePath || f.name);
  const all = files.map(rel);
  // Strip a common top-level directory ("mv-project/…") if every file shares it.
  let prefix = "";
  const firstSeg = all[0] ? all[0].split("/")[0] + "/" : "";
  if (firstSeg && all.every((p) => p.startsWith(firstSeg))) prefix = firstSeg;
  const map = new Map<string, File>();
  files.forEach((f) => map.set(rel(f).slice(prefix.length), f));
  return {
    async list() {
      return [...map.keys()];
    },
    async readText(path) {
      const f = map.get(norm(path));
      return f ? await f.text() : null;
    },
    async readBytes(path) {
      const f = map.get(norm(path));
      return f ? new Uint8Array(await f.arrayBuffer()) : null;
    },
  };
}

/** Filesystem read functions the caller injects (Tauri `@tauri-apps/plugin-fs`
 *  or node `fs/promises`) — keeps this module free of a hard FS dependency. */
export interface FsReadFns {
  /** Recursively list files under `root`, returning root-relative POSIX paths. */
  listFiles(root: string): Promise<string[]>;
  readText(absPath: string): Promise<string>;
  readBytes(absPath: string): Promise<Uint8Array>;
  /** Join `root` + relative path into an absolute path for the read fns. */
  join(root: string, rel: string): string;
}

/** Source over an injected filesystem rooted at `root`. */
export function fsSource(root: string, fns: FsReadFns): MzFileSource {
  return {
    async list() {
      return (await fns.listFiles(root)).map(norm);
    },
    async readText(path) {
      try {
        return await fns.readText(fns.join(root, norm(path)));
      } catch {
        return null;
      }
    },
    async readBytes(path) {
      try {
        return await fns.readBytes(fns.join(root, norm(path)));
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// readRawProject
// ---------------------------------------------------------------------------

/** The `data/*.json` files the M1·A database converters consume. Maps +
 *  tilesets + MapInfos join in M1·B. */
const DB_FILES = [
  "actors",
  "classes",
  "skills",
  "items",
  "weapons",
  "armors",
  "enemies",
  "troops",
  "states",
  "commonEvents",
] as const;

/** Case-insensitive lookup of `data/<Name>.json` within the intaken paths. */
function findData(paths: string[], name: string): string | null {
  const want = ("data/" + name + ".json").toLowerCase();
  return paths.find((p) => norm(p).toLowerCase() === want) || null;
}

async function readJson<T>(
  source: MzFileSource,
  path: string | null,
  report: ImportReport,
  label: string,
): Promise<T | null> {
  if (!path) {
    report.add({ area: "Project", kind: "skipped", what: label, detail: "file not found" });
    return null;
  }
  const text = await source.readText(path);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    report.add({
      area: "Project",
      kind: "skipped",
      what: label,
      detail: "could not be read: " + (e as Error).message,
    });
    return null;
  }
}

/** Extract the `$plugins` array from `js/plugins.js` (a JS file, not JSON — the
 *  array literal after `=` is JSON-parseable). Never executes the file. */
export function parsePluginsJs(text: string | null): RmPlugin[] {
  if (!text) return [];
  const m = text.match(/\$plugins\s*=\s*(\[[\s\S]*?\])\s*;?/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]) as RmPlugin[];
  } catch {
    return [];
  }
}

/** Read + parse an intaken project into `MzRawData` (database surface). Sniffs
 *  MV/MZ from the marker + System/Animations cues. Throws a plain-language
 *  error only when `System.json` is missing (nothing can be imported without
 *  it); every other missing/garbled file degrades to an empty list + report. */
export async function readRawProject(
  source: MzFileSource,
  report: ImportReport,
): Promise<MzRawData> {
  const paths = (await source.list()).map(norm);

  const system = await readJson<RmSystem>(source, findData(paths, "System"), report, "System.json");
  if (!system) {
    throw new Error("This doesn't look like an RPG Maker project — data/System.json is missing.");
  }
  const animations = await readJson<any[]>(source, findData(paths, "Animations"), report, "Animations.json");

  const sniff = sniffFormat({ paths, system, animations });

  const raw: MzRawData = {
    format: sniff.format,
    system,
    actors: [],
    classes: [],
    skills: [],
    items: [],
    weapons: [],
    armors: [],
    enemies: [],
    troops: [],
    states: [],
    commonEvents: [],
  };
  for (const name of DB_FILES) {
    const file = name.charAt(0).toUpperCase() + name.slice(1);
    const arr = await readJson<RmList<any>>(source, findData(paths, file), report, file + ".json");
    (raw as any)[name] = Array.isArray(arr) ? arr : [];
  }

  // M1·B: tilesets + the map tree + each Map###.json (id from the filename).
  raw.tilesets =
    (await readJson<RmList<RmTileset>>(source, findData(paths, "Tilesets"), report, "Tilesets.json")) || [];
  raw.mapInfos =
    (await readJson<RmList<RmMapInfo>>(source, findData(paths, "MapInfos"), report, "MapInfos.json")) || [];
  raw.maps = await readMapFiles(source, paths, report);

  raw.plugins = parsePluginsJs(await source.readText("js/plugins.js"));
  raw.assetPaths = paths.filter((p) => /^(img|audio)\//i.test(p));
  return raw;
}

/** Discover + parse every `data/Map###.json`, injecting the filename id. Padded
 *  and unpadded names are both accepted; ordering by numeric id keeps intake
 *  deterministic (MapInfos re-orders for the map list). */
async function readMapFiles(
  source: MzFileSource,
  paths: string[],
  report: ImportReport,
): Promise<RmMap[]> {
  const found: { id: number; path: string }[] = [];
  for (const p of paths) {
    const m = /^data\/Map0*([0-9]+)\.json$/i.exec(norm(p));
    if (m) found.push({ id: Number(m[1]), path: p });
  }
  found.sort((a, b) => a.id - b.id);
  const maps: RmMap[] = [];
  for (const { id, path } of found) {
    const body = await readJson<RmMap>(source, path, report, "Map" + String(id).padStart(3, "0") + ".json");
    if (body && typeof body === "object") maps.push({ ...body, id });
  }
  return maps;
}
