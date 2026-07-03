/* RPGAtlas — src/shared/asset-library.ts
   The asset library service (Phase 6 Stage A): everything above the AssetStore
   drivers (IndexedDB / Tauri FS) and below the UI. Owns:

   - the merged catalog published to js/assets.js via
     window.RPGATLAS_LIBRARY_ASSETS (image types only; audio stays here),
   - imports (slugging, SHA-256 content dedupe, name-collision suffixes,
     dimension/duration probing),
   - the used-asset audit (usedAssetKeys — the Phase 0 collectUsedExternalKeys
     walk extended to audio keys, ambience layers, system sounds, vehicle
     charsets, and animation flipbook sheets),
   - reference rewriting for renames (rewriteAssetKey),
   - project-embedded assets: embed used library blobs on FILE save/export,
     consume-and-strip them on file load, strip them from every localStorage
     autosave (the store already holds the blobs on this device).

   The asset reference is the string key "asset:<type>/<name>" — unchanged
   from the existing js/assets.js convention, so shipped img/ assets, library
   assets, and embedded assets resolve through one namespace (later sources
   shadow earlier ones at bind time).

   Pure helpers are exported for vitest; the stateful singleton is inert until
   initAssetLibrary() runs (boots pass a store, or null to degrade to
   shipped-assets-only). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AssetMeta, AssetStore } from "./services";

export const IMAGE_ASSET_TYPES = ["characters", "facesets", "enemies", "tilesets"] as const;
export const ASSET_TYPES = [...IMAGE_ASSET_TYPES, "audio"] as const;
export type AssetType = AssetMeta["type"];

export const ASSET_PREFIX = "asset:";

/** "asset:<type>/<name>" — the stable reference. */
export function assetKeyOf(type: string, name: string): string {
  return ASSET_PREFIX + type + "/" + name;
}

export function isAssetKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ASSET_PREFIX);
}

/** Parse an asset key; null when it isn't one. */
export function parseAssetKey(key: string): { type: string; name: string } | null {
  if (!isAssetKey(key)) return null;
  const rest = key.slice(ASSET_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { type: rest.slice(0, slash), name: rest.slice(slash + 1) };
}

/** File name → library slug: extension stripped, lowercased, everything
 *  outside [a-z0-9._-] collapsed to "-". Keeps the ".pass"/".terrain" tile
 *  suffix convention intact (dots survive). */
export function slugName(raw: string): string {
  const base = String(raw).replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug || "asset";
}

/** First free name among name, name-2, name-3, … given taken names. */
export function collisionName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  // Keep a trailing ".pass"/".terrain" convention suffix at the end where the
  // tile pipeline expects it: "cliff.pass" → "cliff-2.pass".
  const m = /^(.*?)(\.(?:pass|terrain))?$/.exec(name)!;
  const stem = m[1];
  const suffix = m[2] || "";
  for (let i = 2; ; i++) {
    const candidate = stem + "-" + i + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** SHA-256 hex of a blob (crypto.subtle — browser and Node ≥ 18). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Guess an audio asset's role from its file name (editable in the browser
 *  UI): music/bgm → bgm, ambience/bgs/loop → bgs, jingle/victory/me → me,
 *  everything else → se. */
export function guessAudioKind(name: string): string {
  // Normalize -_. separators to spaces so \b matches "rain_ambience" etc.
  const n = String(name).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ");
  if (/\b(bgm|music|theme|song)\b/.test(n)) return "bgm";
  if (/\b(bgs|ambien\w*|atmo\w*)\b/.test(n)) return "bgs";
  if (/\b(me|jingle|victory|fanfare)\b/.test(n)) return "me";
  return "se";
}

// ---------------------------------------------------------------------------
// data URL <-> Blob (no FileReader dependency, so tests run under plain Node)
// ---------------------------------------------------------------------------

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return "data:" + (blob.type || "application/octet-stream") + ";base64," + btoa(bin);
}

export function dataUrlToBlob(src: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error("not a data URL");
  const mime = m[1] || "application/octet-stream";
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(m[3])], { type: mime });
}

// ---------------------------------------------------------------------------
// The used-asset audit
// ---------------------------------------------------------------------------

/** Minimal catalog entry for audit pairing (a character's same-named faceset
 *  is used with it — the rule js/assets.js has always applied on export). */
export interface CatalogEntry {
  key: string;
  type: string;
  name: string;
}

function scanCommands(commands: any[] | undefined, hit: (key: any) => void): void {
  for (const c of commands || []) {
    if (!c) continue;
    if (c.t === "text" && c.face) hit(c.face);
    if (c.t === "playSE" && c.name) hit(c.name);
    if (c.t === "playMusic" && c.theme) hit(c.theme);
    if (c.t === "choices") for (const b of c.branches || []) scanCommands(b, hit);
    else if (c.t === "if") {
      scanCommands(c.then, hit);
      scanCommands(c.else, hit);
    } else if (c.t === "loop") scanCommands(c.body, hit);
  }
}

/** Every `asset:` key the project references, across all Phase ≤ 6 surfaces:
 *  actor/event/vehicle charsets (with same-named faceset pairing via
 *  `catalog`), text faces, enemy sprites, painted tiles (via the
 *  proj.assets.tiles key→id registry), map music + ambience layers, system
 *  sounds, playSE/playMusic command args, and animation flipbook sheets.
 *  Pure — feeds export embedding, the browser's used/unused badges, rename
 *  rewrites, and delete warnings. */
export function usedAssetKeys(project: any, catalog: CatalogEntry[] = []): Set<string> {
  const used = new Set<string>();
  const facesByName = new Map<string, CatalogEntry>();
  const byKey = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    byKey.set(entry.key, entry);
    if (entry.type === "facesets") facesByName.set(entry.name, entry);
  }
  const hit = (key: any) => {
    if (!isAssetKey(key)) return;
    used.add(key);
    // A used character brings its same-named faceset along (message faces).
    const entry = byKey.get(key);
    if (entry && entry.type === "characters") {
      const face = facesByName.get(entry.name);
      if (face) used.add(face.key);
    }
  };

  for (const actor of project.actors || []) hit(actor.charset);
  for (const enemy of project.enemies || []) hit(enemy.sprite);
  for (const anim of project.animations || []) {
    for (const item of anim.items || []) hit(item.sheet);
  }
  const vehicles = (project.system && project.system.vehicles) || {};
  for (const t of Object.keys(vehicles)) {
    if (vehicles[t] && vehicles[t].charset) hit(vehicles[t].charset);
  }
  const sounds = (project.system && project.system.sounds) || {};
  for (const k of Object.keys(sounds)) hit(sounds[k]);
  for (const ce of project.commonEvents || []) scanCommands(ce.commands, hit);
  for (const troop of project.troops || []) {
    for (const page of troop.pages || []) scanCommands(page.commands, hit);
  }

  // Painted tiles reference by numeric id; proj.assets.tiles is the
  // key → id registry bindExternalAssets maintains. Invert it once.
  const tileKeyById = new Map<number, string>();
  const tileIds = (project.assets && project.assets.tiles) || {};
  for (const key of Object.keys(tileIds)) tileKeyById.set(Number(tileIds[key]), key);

  for (const map of project.maps || []) {
    if (map.music) hit(map.music);
    for (const layer of (map.ambience as any[]) || []) if (layer) hit(layer.key);
    for (const layerCells of Object.values(map.layers || {})) {
      for (const id of (layerCells as any[]) || []) {
        const key = tileKeyById.get(Number(id));
        if (key) used.add(key);
      }
    }
    for (const event of map.events || []) {
      for (const page of event.pages || []) {
        hit(page.charset);
        scanCommands(page.commands, hit);
      }
    }
  }
  return used;
}

/** Rewrite every reference to `oldKey` in the project to `newKey` (rename
 *  support). Walks the same surfaces as usedAssetKeys; also re-keys the
 *  proj.assets.tiles registry entry, preserving the painted tile id. Mutates
 *  the project; returns the number of replaced references. */
export function rewriteAssetKey(project: any, oldKey: string, newKey: string): number {
  let count = 0;
  const swap = (obj: any, field: string) => {
    if (obj && obj[field] === oldKey) {
      obj[field] = newKey;
      count++;
    }
  };
  const swapCommands = (commands: any[] | undefined) => {
    for (const c of commands || []) {
      if (!c) continue;
      if (c.t === "text") swap(c, "face");
      if (c.t === "playSE") swap(c, "name");
      if (c.t === "playMusic") swap(c, "theme");
      if (c.t === "choices") for (const b of c.branches || []) swapCommands(b);
      else if (c.t === "if") {
        swapCommands(c.then);
        swapCommands(c.else);
      } else if (c.t === "loop") swapCommands(c.body);
    }
  };

  for (const actor of project.actors || []) swap(actor, "charset");
  for (const enemy of project.enemies || []) swap(enemy, "sprite");
  for (const anim of project.animations || []) for (const item of anim.items || []) swap(item, "sheet");
  const vehicles = (project.system && project.system.vehicles) || {};
  for (const t of Object.keys(vehicles)) swap(vehicles[t], "charset");
  const sounds = (project.system && project.system.sounds) || {};
  for (const k of Object.keys(sounds)) {
    if (sounds[k] === oldKey) {
      sounds[k] = newKey;
      count++;
    }
  }
  for (const ce of project.commonEvents || []) swapCommands(ce.commands);
  for (const troop of project.troops || []) for (const page of troop.pages || []) swapCommands(page.commands);
  for (const map of project.maps || []) {
    swap(map, "music");
    for (const layer of (map.ambience as any[]) || []) swap(layer, "key");
    for (const event of map.events || []) {
      for (const page of event.pages || []) {
        swap(page, "charset");
        swapCommands(page.commands);
      }
    }
  }
  const tileIds = project.assets && project.assets.tiles;
  if (tileIds && Object.prototype.hasOwnProperty.call(tileIds, oldKey)) {
    tileIds[newKey] = tileIds[oldKey];
    delete tileIds[oldKey];
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// The library singleton
// ---------------------------------------------------------------------------

let store: AssetStore | null = null;
let metas: AssetMeta[] = [];
const urls = new Map<string, string>(); // key → object URL (images eager, audio lazy)

function makeUrl(key: string, blob: Blob): string {
  const prev = urls.get(key);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}

/** The image-type entries js/assets.js consumes ({type,name,src} + extras),
 *  i.e. window.RPGATLAS_LIBRARY_ASSETS. Only entries whose blob resolved to
 *  an object URL are listed. */
export function libraryImageEntries(): any[] {
  const out: any[] = [];
  for (const meta of metas) {
    if (meta.type === "audio") continue;
    const src = urls.get(meta.key);
    if (!src) continue;
    out.push({ type: meta.type, name: meta.name, src, key: meta.key, meta: meta.meta });
  }
  return out;
}

function publish(): void {
  if (typeof window !== "undefined") {
    (window as any).RPGATLAS_LIBRARY_ASSETS = libraryImageEntries();
  }
}

/** All library metadata (browser UI, audit callers). Snapshot copy. */
export function libraryMetas(): AssetMeta[] {
  return metas.slice();
}

/** Audit catalog view of the library (usedAssetKeys pairing). */
export function libraryCatalog(): CatalogEntry[] {
  return metas.map((m) => ({ key: m.key, type: m.type, name: m.name }));
}

/** Synchronous URL for an already-materialized library asset (images are
 *  eager at init/import). In standalone game exports the library is absent
 *  and used assets ride in window.RPGATLAS_ASSETS — fall through to their
 *  embedded data URLs so the same reference resolves in both worlds. */
export function assetUrlSync(key: string): string | null {
  const hit = urls.get(key);
  if (hit) return hit;
  if (typeof window !== "undefined") {
    const embedded = (window as any).RPGATLAS_ASSETS;
    if (Array.isArray(embedded)) {
      const entry = embedded.find((e: any) => e && assetKeyOf(e.type, e.name) === key);
      if (entry && entry.src) return entry.src;
    }
  }
  return null;
}

/** Flipbook-sheet resolver for the anim player (PlayEnv.resolveSheet):
 *  asset keys resolve through the library/embedded assets, everything else
 *  (URLs, "icons") passes through. */
export function resolvePlaybackSheet(sheet: string): string | null {
  return isAssetKey(sheet) ? assetUrlSync(sheet) : sheet;
}

/** Object URL for a library asset's blob (lazy for audio). Null when absent. */
export async function assetUrl(key: string): Promise<string | null> {
  const hit = urls.get(key);
  if (hit) return hit;
  if (!store) return null;
  const blob = await store.get(key);
  return blob ? makeUrl(key, blob) : null;
}

/** Initialize the library over a store (null = degrade to shipped-only).
 *  Loads metadata, eagerly materializes image object URLs (js/assets.js binds
 *  them at boot), publishes window.RPGATLAS_LIBRARY_ASSETS. Failures degrade
 *  to an empty library with a console warning — a broken IndexedDB must never
 *  block the editor. */
export async function initAssetLibrary(assetStore: AssetStore | null): Promise<void> {
  store = assetStore;
  metas = [];
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  if (store) {
    try {
      metas = await store.list();
      await Promise.all(
        metas
          .filter((m) => m.type !== "audio")
          .map(async (m) => {
            try {
              const blob = await store!.get(m.key);
              if (blob) makeUrl(m.key, blob);
            } catch (e) {
              console.warn("[library] blob unavailable for " + m.key, e);
            }
          }),
      );
    } catch (e) {
      console.warn("[library] unavailable — shipped assets only", e);
      store = null;
      metas = [];
    }
  }
  publish();
}

export function libraryAvailable(): boolean {
  return !!store;
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export interface ImportItem {
  blob: Blob;
  /** Original file name (slug + extension/mime hints). */
  name: string;
  /** Explicit type; images REQUIRE one (the UI passes its active tab). */
  type?: AssetType;
  kind?: string;
  tags?: string[];
  meta?: Record<string, any>;
  /** Pre-slugged name to keep verbatim (embedded-asset intake); still gets a
   *  collision suffix when a different-content asset owns it. */
  exactName?: string;
}

export interface ImportOptions {
  /** Fill w/h (images) or dur (audio) on the meta. The default probe uses
   *  Image/Audio elements and silently skips outside a DOM. Injectable for
   *  tests. */
  probe?: (blob: Blob, meta: AssetMeta) => Promise<void>;
}

function detectType(item: ImportItem): AssetType {
  if (item.type) return item.type;
  const mime = item.blob.type || "";
  if (mime.startsWith("audio/")) return "audio";
  if (/\.(ogg|mp3|wav|m4a|flac)$/i.test(item.name)) return "audio";
  throw new Error("Image imports need a target type (characters/facesets/enemies/tilesets): " + item.name);
}

async function domProbe(blob: Blob, meta: AssetMeta): Promise<void> {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  try {
    if (meta.type === "audio") {
      meta.dur = await new Promise<number>((resolve, reject) => {
        const el = document.createElement("audio");
        el.preload = "metadata";
        el.onloadedmetadata = () => resolve(el.duration);
        el.onerror = () => reject(new Error("audio metadata failed"));
        el.src = url;
      });
    } else {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image decode failed"));
        img.src = url;
      });
      meta.w = img.naturalWidth;
      meta.h = img.naturalHeight;
    }
  } catch (e) {
    console.warn("[library] probe failed for " + meta.key, e);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Import blobs into the library: content-hash dedupe (same type + hash →
 *  existing asset, tags merged), name-collision suffixes, kind guessing for
 *  audio, probing, store put, catalog publish. Returns the resulting metas
 *  (existing ones for dedupe hits) in input order. */
export async function importAssets(items: ImportItem[], opts: ImportOptions = {}): Promise<AssetMeta[]> {
  if (!store) throw new Error("Asset library is unavailable in this session.");
  const probe = opts.probe || domProbe;
  const results: AssetMeta[] = [];
  for (const item of items) {
    const type = detectType(item);
    const hash = await sha256Hex(item.blob);

    const existing = metas.find((m) => m.type === type && m.hash === hash);
    if (existing) {
      const mergedTags = Array.from(new Set([...(existing.tags || []), ...(item.tags || [])]));
      if (mergedTags.length !== (existing.tags || []).length) {
        existing.tags = mergedTags;
        await store.setMeta(existing);
      }
      results.push(existing);
      continue;
    }

    const taken = new Set(metas.filter((m) => m.type === type).map((m) => m.name));
    const name = collisionName(item.exactName || slugName(item.name), taken);
    const meta: AssetMeta = {
      key: assetKeyOf(type, name),
      type,
      name,
      tags: item.tags ? item.tags.slice() : [],
      bytes: item.blob.size,
      hash,
      addedAt: Date.now(),
      mime: item.blob.type || undefined,
      kind: type === "audio" ? item.kind || guessAudioKind(item.name) : undefined,
      meta: item.meta,
    };
    await probe(item.blob, meta);
    await store.put(meta, item.blob);
    metas.push(meta);
    if (type !== "audio") makeUrl(meta.key, item.blob);
    results.push(meta);
  }
  publish();
  return results;
}

/** Delete an asset (store + catalog + published entries). */
export async function removeAsset(key: string): Promise<void> {
  if (!store) return;
  await store.remove(key);
  metas = metas.filter((m) => m.key !== key);
  const url = urls.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    urls.delete(key);
  }
  publish();
}

/** Update an asset's tags/kind/meta. */
export async function updateAssetMeta(meta: AssetMeta): Promise<void> {
  if (!store) return;
  await store.setMeta(meta);
  const i = metas.findIndex((m) => m.key === meta.key);
  if (i >= 0) metas[i] = meta;
  publish();
}

/** Rename an asset: re-key in the store (put under the new key, remove the
 *  old) and rewrite every reference in the open project. Returns the new
 *  meta, or null when the asset/blob is missing. */
export async function renameAsset(key: string, newName: string, project: any): Promise<AssetMeta | null> {
  if (!store) return null;
  const meta = metas.find((m) => m.key === key);
  if (!meta) return null;
  const taken = new Set(metas.filter((m) => m.type === meta.type && m.key !== key).map((m) => m.name));
  const name = collisionName(slugName(newName), taken);
  if (name === meta.name) return meta;
  const blob = await store.get(key);
  if (!blob) return null;
  const next: AssetMeta = { ...meta, name, key: assetKeyOf(meta.type, name) };
  await store.put(next, blob);
  await store.remove(key);
  metas = metas.map((m) => (m.key === key ? next : m));
  const url = urls.get(key);
  if (url) {
    urls.delete(key);
    urls.set(next.key, url);
  }
  rewriteAssetKey(project, key, next.key);
  publish();
  return next;
}

// ---------------------------------------------------------------------------
// Project-embedded assets (file save/load round-trip across devices)
// ---------------------------------------------------------------------------

/** Autosave hygiene: a copy of the project without embedded asset blobs (the
 *  localStorage document must stay blob-free; this device's library already
 *  has them). Returns the SAME object when there is nothing to strip. */
export function stripEmbeddedAssets<T extends { assets?: any }>(project: T): T {
  if (!project || !project.assets || !project.assets.external) return project;
  const assets = { ...project.assets };
  delete assets.external;
  return { ...project, assets };
}

/** File-save embedding: a copy of the project whose assets.external carries
 *  data URLs for every USED library asset (shipped img/ assets are on every
 *  install and are embedded by the standalone-game export path, not here).
 *  The copy is what gets written to disk; the live project is untouched. */
export async function embedUsedAssets<T extends { assets?: any }>(project: T): Promise<T> {
  const base = stripEmbeddedAssets(project);
  if (!store || metas.length === 0) return base;
  const used = usedAssetKeys(project, libraryCatalog());
  const entries: any[] = [];
  for (const meta of metas) {
    if (!used.has(meta.key)) continue;
    const blob = await store.get(meta.key);
    if (!blob) continue;
    entries.push({
      type: meta.type,
      name: meta.name,
      src: await blobToDataUrl(blob),
      kind: meta.kind,
      meta: meta.meta,
      tags: meta.tags && meta.tags.length ? meta.tags : undefined,
    });
  }
  if (!entries.length) return base;
  return { ...base, assets: { ...(base.assets || { tiles: {} }), external: entries } };
}

/** File-load intake: import any embedded assets into this device's library
 *  (hash-deduped, so repeated opens are free), then strip them from the
 *  in-memory project — the document stays references-only. When an embedded
 *  asset lands under a different key (name collision with different content,
 *  or hash-dedupe onto an existing asset with another name), the project's
 *  references are rewritten to the landing key so nothing dangles. Mutates
 *  the project. Returns the imported/matched metas ([] when none/no store). */
export async function consumeEmbeddedAssets(project: any): Promise<AssetMeta[]> {
  const entries = project && project.assets && project.assets.external;
  if (!entries || !Array.isArray(entries) || !entries.length) {
    if (entries) delete project.assets.external;
    return [];
  }
  delete project.assets.external;
  if (!store) return [];
  const items: ImportItem[] = [];
  const intendedKeys: string[] = [];
  for (const entry of entries) {
    try {
      const item: ImportItem = {
        blob: dataUrlToBlob(entry.src),
        name: entry.name || "asset",
        type: entry.type,
        kind: entry.kind,
        tags: entry.tags,
        meta: entry.meta,
        exactName: entry.name,
      };
      items.push(item);
      intendedKeys.push(assetKeyOf(entry.type, entry.name));
    } catch (e) {
      console.warn("[library] skipping malformed embedded asset", e);
    }
  }
  const results = await importAssets(items);
  results.forEach((meta, i) => {
    if (meta.key !== intendedKeys[i]) rewriteAssetKey(project, intendedKeys[i], meta.key);
  });
  return results;
}
