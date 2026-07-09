/* RPGAtlas — src/editor/tools/asset-browser.ts
   The Asset Browser modal (Phase 6 Stage B): the management surface for the
   device asset library (src/shared/asset-library.ts over IndexedDB / Tauri
   FS). Type rail + search + tag filters + used/unused audit over a thumbnail
   grid; drag-drop / file-picker imports; per-asset preview, rename (with
   project-wide reference rewriting), tag editing, file export, and delete
   (with in-use warnings). Imported images bind live through
   Assets.registerExternalAssets, so pickers/palette see them immediately —
   the Resource Manager stays the browser for the procedural sets.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, editorState as S, editorHooks } from "../editor-state";
import { h } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { wizardImport } from "../importers/import-wizard";
import { dropFolderAvailable, importFolderPath, revealImportFolder, scanImportFolder } from "./asset-dropbox";
// Project Harbor H4·B: when a folder game is open, the Scan button and the missing-asset
// state are driven by the per-project assets/ auto-discovery, not the app-data inbox.
import {
  projectScanAvailable,
  runProjectScan,
  currentMissingKeys,
  onProjectAssetsChanged,
} from "./project-scan";
import {
  ASSET_TYPES,
  importAssets,
  libraryAvailable,
  libraryCatalog,
  libraryImageEntries,
  libraryMetas,
  removeAsset,
  removeAssets,
  renameAsset,
  updateAssetMeta,
  usedAssetKeys,
  assetUrl,
} from "../../shared/asset-library";
import type { AssetMeta } from "../../shared/services";
import { MISSING_ASSET_COPY } from "../../shared/project-errors";

const TYPE_LABELS: Record<string, string> = {
  all: "All",
  characters: "Characters",
  facesets: "Facesets",
  enemies: "Enemies",
  tilesets: "Tiles",
  audio: "Audio",
  packs: "Packs",
};

/** Extra pack-registry URLs (device setting, not project data). */
const REGISTRY_LS_KEY = "rpgatlas_pack_registries";
function extraRegistries(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(REGISTRY_LS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

interface PackFile {
  type: AssetMeta["type"];
  name: string;
  url: string;
  kind?: string;
  tags?: string[];
}
interface PackDef {
  id: string;
  name: string;
  desc?: string;
  license?: string;
  version?: number;
  files: PackFile[];
  /** Which registry it came from (resolves relative file URLs). */
  base: string;
}

async function fetchRegistry(url: string): Promise<PackDef[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " → " + res.status);
  const parsed = await res.json();
  const packs = Array.isArray(parsed && parsed.packs) ? parsed.packs : [];
  return packs
    .filter((p: any) => p && p.id && Array.isArray(p.files))
    .map((p: any) => ({ ...p, base: url }));
}
const IMAGE_TYPE_OPTIONS = ["characters", "facesets", "enemies", "tilesets"];

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}
function fmtDur(sec?: number): string {
  if (!sec || !isFinite(sec)) return "";
  const s = Math.round(sec);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/** One-field prompt dialog (rename / tags) — Enter commits, Esc cancels. */
function promptBox(title: string, initial: string, hint: string, onOk: (value: string) => void) {
  const input = h("input", { type: "text", value: initial, style: "width:100%" });
  modal({
    title,
    content: h("div", null, input, h("div", { class: "dim", style: "margin-top:6px" }, hint)),
    buttons: [
      { label: "OK", primary: true, onClick(close: any) { close(); onOk(input.value); } },
      { label: "Cancel" },
    ],
    dialogKeys: true,
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

export function openAssetBrowser() {
  let curType = "all";
  let search = "";
  let unusedOnly = false;
  const activeTags = new Set<string>();
  let preview: HTMLAudioElement | null = null;
  let previewKey: string | null = null;

  const rail = h("div", { class: "ab-rail" });
  const bar = h("div", { class: "ab-bar" });
  const grid = h("div", { class: "ab-grid" });
  const tagRow = h("div", { class: "ab-tags" });
  const foot = h("div", { class: "ab-foot dim" });

  // ---- import plumbing -----------------------------------------------------
  const typeSelect = h("select", { title: "Type images import as" });
  for (const ty of IMAGE_TYPE_OPTIONS) typeSelect.appendChild(h("option", { value: ty }, TYPE_LABELS[ty]));
  const fileInput = h("input", {
    id: "assetbrowser-file",
    type: "file",
    multiple: true,
    accept: "image/png,image/webp,image/jpeg,audio/*,.ogg,.mp3,.wav",
    hidden: true,
  });

  async function doImport(files: File[]) {
    if (!files.length) return;
    try {
      // The wizard routes tile sheets through the slicer, odd-shaped charsets
      // through the flipbook-sheet flow, and Aseprite JSON+PNG pairs through
      // the tagged-sheet importer; simple files import directly.
      const metas = await wizardImport(files, typeSelect.value as AssetMeta["type"]);
      // Bind new images live so pickers/palette pick them up, and persist the
      // tile-id registry writes bindExternalAssets makes.
      if (metas.some((m) => m.type !== "audio")) {
        await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
        editorHooks.rebuildAll();
        touch();
      }
      refresh();
    } catch (e: any) {
      alert("Import failed: " + ((e && e.message) || e));
    }
  }
  fileInput.addEventListener("change", () => {
    doImport(Array.from((fileInput as any).files || []));
    (fileInput as any).value = "";
  });

  // ---- desktop drop-folders -------------------------------------------------
  // On the desktop build, users can copy files straight into per-type folders
  // with Explorer/Finder; we scan those folders (on open, on window focus, and
  // on demand) and route whatever turned up through the same wizard as the
  // file picker. Each scanned original is archived by the backend, so repeat
  // scans are idempotent.
  const dropBanner = h("div", { class: "ab-dropbanner" });
  let dropStatusEl: HTMLElement | null = null;
  let scanning = false;
  function dropStatus(msg: string) { if (dropStatusEl) dropStatusEl.textContent = msg; }

  async function importGrouped(byType: Map<AssetMeta["type"], File[]>): Promise<{ files: number; added: number }> {
    const before = libraryMetas().length;
    let files = 0;
    let boundImages = false;
    for (const [type, group] of byType) {
      files += group.length;
      const metas = await wizardImport(group, type);
      if (metas.some((m) => m.type !== "audio")) boundImages = true;
    }
    if (boundImages) {
      await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
      editorHooks.rebuildAll();
    }
    if (files) touch();
    return { files, added: libraryMetas().length - before };
  }

  async function scanFolder(announce = false) {
    // Project Harbor H4·B: a folder game scans its own assets/ (in place) — the app-data
    // inbox path below is the legacy fallback (no project open on desktop).
    if (projectScanAvailable()) {
      if (scanning) return;
      scanning = true;
      try {
        const res = await runProjectScan();
        refresh();
        if (!res) return;
        const total = res.added + res.changed;
        dropStatus(total
          ? "Found " + total + " new or updated file" + (total === 1 ? "" : "s") +
            (res.missing ? " · " + res.missing + " missing" : "") + "."
          : (announce
              ? "No new files found — copy pictures or sounds into your assets folder first."
              : (res.missing ? res.missing + " file" + (res.missing === 1 ? " is" : "s are") + " missing." : "")));
      } catch (e: any) {
        dropStatus("Couldn't read your assets folder: " + ((e && e.message) || e));
      } finally {
        scanning = false;
      }
      return;
    }
    if (!dropFolderAvailable() || scanning) return;
    scanning = true;
    try {
      const byType = await scanImportFolder();
      if (byType.size) {
        const { files, added } = await importGrouped(byType);
        refresh();
        const dupes = files - added;
        dropStatus(added
          ? "Added " + added + " new file" + (added === 1 ? "" : "s") +
            (dupes ? " (" + dupes + " already in your library)" : "") + "."
          : "Those files were already in your library.");
      } else if (announce) {
        dropStatus("No new files found — copy pictures or sounds into the folder first.");
      }
    } catch (e: any) {
      dropStatus("Couldn't read the import folder: " + ((e && e.message) || e));
    } finally {
      scanning = false;
    }
  }

  // Project Harbor H4·B: a folder game's banner scans its own assets/ folder. The richer
  // "Open Project Folder" + per-type hints land in H4·C; this is the working Scan button.
  function buildProjectBanner() {
    dropStatusEl = h("span", { class: "ab-dropstatus dim" });
    dropBanner.appendChild(h("div", { class: "ab-dropwrap" },
      h("div", { class: "ab-droptext" },
        h("strong", null, "📁 Add your own pictures & sounds"),
        h("div", { class: "dim" },
          "Copy files into your game's assets folder (characters, facesets, enemies, tilesets, audio) with your file manager — they show up here on their own when you come back, or click Scan.")),
      h("div", { class: "ab-dropbtns" },
        h("button", { class: "mini", onclick() { scanFolder(true); } }, "Scan for New Files"),
        dropStatusEl)));
  }

  function buildDropBanner() {
    if (projectScanAvailable()) { buildProjectBanner(); return; }
    if (!dropFolderAvailable()) return;
    dropStatusEl = h("span", { class: "ab-dropstatus dim" });
    const pathLine = h("code", { class: "ab-droppath", title: "Copy files into the matching sub-folder here" }, "locating folder…");
    importFolderPath().then((p) => { pathLine.textContent = p; }).catch(() => { pathLine.textContent = ""; });
    dropBanner.appendChild(h("div", { class: "ab-dropwrap" },
      h("div", { class: "ab-droptext" },
        h("strong", null, "📁 Add your own pictures & sounds"),
        h("div", { class: "dim" },
          "Copy files into the matching folder (characters, facesets, enemies, tilesets, audio) with your file manager — they appear here automatically, no picker needed."),
        pathLine),
      h("div", { class: "ab-dropbtns" },
        h("button", { class: "primary", async onclick() {
          try { await revealImportFolder(); } catch (e: any) { dropStatus("Couldn't open the folder: " + ((e && e.message) || e)); }
        } }, "Open Folder"),
        h("button", { class: "mini", onclick() { scanFolder(true); } }, "Scan for New Files"),
        dropStatusEl)));
  }

  // ---- toolbar --------------------------------------------------------------
  const searchBox = h("input", { type: "search", placeholder: "Search…", class: "ab-search" });
  searchBox.addEventListener("input", () => { search = searchBox.value.trim().toLowerCase(); refresh(); });
  const unusedBtn = h("button", { class: "mini", onclick() { unusedOnly = !unusedOnly; refresh(); } }, "Unused only");
  bar.appendChild(searchBox);
  bar.appendChild(unusedBtn);
  bar.appendChild(h("span", { class: "spacer" }));
  bar.appendChild(h("label", { class: "dim" }, "Images as "));
  bar.appendChild(typeSelect);
  bar.appendChild(h("button", { class: "primary", onclick() { fileInput.click(); } }, "Import Files…"));
  bar.appendChild(fileInput);

  function stopPreview() {
    if (preview) { preview.pause(); preview = null; previewKey = null; }
  }

  // ---- rendering ------------------------------------------------------------
  function visibleMetas(): { list: AssetMeta[]; used: Set<string> } {
    const used = usedAssetKeys(S.proj, libraryCatalog());
    let list = libraryMetas();
    if (curType !== "all") list = list.filter((m) => m.type === curType);
    if (search) list = list.filter((m) => (m.name + " " + (m.tags || []).join(" ")).toLowerCase().includes(search));
    if (activeTags.size) list = list.filter((m) => (m.tags || []).some((tg) => activeTags.has(tg)));
    if (unusedOnly) list = list.filter((m) => !used.has(m.key));
    list.sort((a, b) => (a.type + "/" + a.name).localeCompare(b.type + "/" + b.name));
    return { list, used };
  }

  function renderRail() {
    rail.innerHTML = "";
    const counts: Record<string, number> = {};
    for (const m of libraryMetas()) counts[m.type] = (counts[m.type] || 0) + 1;
    for (const ty of ["all", ...ASSET_TYPES, "packs"]) {
      const n = ty === "all" ? libraryMetas().length : counts[ty] || 0;
      rail.appendChild(h("button", {
        class: "ab-railbtn" + (curType === ty ? " sel" : ""),
        onclick() { curType = ty; refresh(); },
      }, TYPE_LABELS[ty] + (n && ty !== "packs" ? " (" + n + ")" : "")));
    }
  }

  // ---- starter packs (Stage E) ----------------------------------------------
  let packsCache: PackDef[] | null = null;
  let packsErrors: string[] = [];
  async function loadPacks(force = false): Promise<PackDef[]> {
    if (packsCache && !force) return packsCache;
    const out: PackDef[] = [];
    packsErrors = [];
    for (const url of ["img/packs/index.json", ...extraRegistries()]) {
      try {
        out.push(...await fetchRegistry(url));
      } catch (e: any) {
        if (url !== "img/packs/index.json") packsErrors.push(String((e && e.message) || e));
      }
    }
    packsCache = out;
    return out;
  }

  async function installPack(pack: PackDef, status: (msg: string) => void) {
    const items: any[] = [];
    let done = 0;
    for (const file of pack.files) {
      status("Downloading " + (++done) + "/" + pack.files.length + "…");
      const url = new URL(file.url, new URL(pack.base, location.href)).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(file.url + " → " + res.status);
      items.push({
        blob: await res.blob(),
        name: file.url.replace(/^.*\//, ""),
        exactName: file.name,
        type: file.type,
        kind: file.kind,
        tags: ["pack:" + pack.id, ...(file.tags || [])],
      });
    }
    status("Importing…");
    const metas = await importAssets(items);
    if (metas.some((m) => m.type !== "audio")) {
      await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
      editorHooks.rebuildAll();
      touch();
    }
  }

  function packCard(pack: PackDef): any {
    const installed = libraryMetas().filter((m) => (m.tags || []).includes("pack:" + pack.id));
    const status = h("span", { class: "dim" });
    const bytes = installed.reduce((sum, m) => sum + (m.bytes || 0), 0);
    const actions = h("div", { class: "ab-actions" });
    actions.appendChild(h("button", { class: "primary", async onclick(ev: any) {
      ev.target.disabled = true;
      try {
        await installPack(pack, (msg) => { status.textContent = msg; });
        refresh();
      } catch (e: any) {
        status.textContent = "Install failed: " + ((e && e.message) || e) + " — retry resumes (already-fetched files are deduped).";
        ev.target.disabled = false;
      }
    } }, installed.length ? "Reinstall" : "Install"));
    if (installed.length) {
      actions.appendChild(h("button", { class: "mini danger", onclick() {
        const used = usedAssetKeys(S.proj, libraryCatalog());
        const usedCount = installed.filter((m) => used.has(m.key)).length;
        confirmBox(
          "Remove all " + installed.length + " \"" + pack.name + "\" assets from the library?" +
          (usedCount ? " " + usedCount + " are USED by the current project and will show fallbacks." : ""),
          async () => {
            for (const m of installed) await removeAsset(m.key);
            refresh();
          });
      } }, "Uninstall"));
    }
    return h("div", { class: "ab-card ab-pack" },
      h("div", { class: "ab-name" }, pack.name),
      h("div", { class: "ab-meta dim" },
        (pack.license || "?") + " · " + pack.files.length + " files · installed " + installed.length + "/" + pack.files.length +
        (bytes ? " · " + fmtBytes(bytes) : "")),
      pack.desc ? h("div", { class: "ab-packdesc dim" }, pack.desc) : null,
      status,
      actions);
  }

  function renderPacks() {
    grid.innerHTML = "";
    grid.appendChild(h("div", { class: "dim", style: "padding:8px" }, "Loading pack registries…"));
    loadPacks().then((packs) => {
      if (curType !== "packs") return;
      grid.innerHTML = "";
      for (const pack of packs) grid.appendChild(packCard(pack));
      if (!packs.length) grid.appendChild(h("div", { class: "dim", style: "padding:20px" }, "No packs found."));
      for (const err of packsErrors) grid.appendChild(h("div", { class: "dim", style: "padding:4px 8px" }, "Registry failed: " + err));
      grid.appendChild(h("div", { style: "padding:8px" }, h("button", { class: "mini", onclick() {
        promptBox("Add Pack Registry", "", "URL of a packs index.json (see img/packs/index.json for the format). Stored on this device.",
          (value) => {
            const url = value.trim();
            if (!url) return;
            localStorage.setItem(REGISTRY_LS_KEY, JSON.stringify([...extraRegistries(), url]));
            packsCache = null;
            refresh();
          });
      } }, "+ Add registry URL…")));
    });
  }

  function renderTags() {
    tagRow.innerHTML = "";
    const all = new Set<string>();
    for (const m of libraryMetas()) for (const tg of m.tags || []) all.add(tg);
    if (!all.size) return;
    for (const tg of Array.from(all).sort()) {
      tagRow.appendChild(h("button", {
        class: "ab-tag" + (activeTags.has(tg) ? " sel" : ""),
        onclick() { if (activeTags.has(tg)) activeTags.delete(tg); else activeTags.add(tg); refresh(); },
      }, tg));
    }
  }

  function thumbFor(meta: AssetMeta, srcByKey: Map<string, string>, missing: boolean): any {
    if (missing) {
      return h("div", { class: "ab-thumb ab-missing", title: MISSING_ASSET_COPY.body },
        h("span", { class: "ab-missing-icon" }, "⚠"));
    }
    if (meta.type === "audio") {
      return h("div", { class: "ab-thumb ab-audio" },
        h("span", { class: "ab-note" }, "♪"),
        h("span", { class: "ab-kind" }, (meta.kind || "se").toUpperCase()),
        fmtDur(meta.dur) ? h("span", { class: "dim" }, fmtDur(meta.dur)) : null);
    }
    const src = srcByKey.get(meta.key);
    const box = h("div", { class: "ab-thumb" });
    if (src) box.appendChild(h("img", { src, alt: meta.name }));
    return box;
  }

  function card(meta: AssetMeta, used: Set<string>, srcByKey: Map<string, string>, missing = false): any {
    const inUse = used.has(meta.key);
    const actions = h("div", { class: "ab-actions" });
    if (meta.type === "audio" && !missing) {
      actions.appendChild(h("button", { class: "mini", async onclick() {
        if (previewKey === meta.key) { stopPreview(); return; }
        stopPreview();
        const url = await assetUrl(meta.key);
        if (!url) return;
        preview = new Audio(url);
        previewKey = meta.key;
        preview.onended = () => { preview = null; previewKey = null; };
        preview.play().catch(() => {});
      } }, "▶"));
    }
    actions.appendChild(h("button", { class: "mini", onclick() {
      promptBox("Rename Asset", meta.name,
        "References in this project are rewritten. Other projects using \"" + meta.key + "\" will lose it.",
        async (value) => {
          if (!value.trim()) return;
          await renameAsset(meta.key, value, S.proj);
          await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
          editorHooks.rebuildAll();
          touch();
          refresh();
        });
    } }, "Rename"));
    actions.appendChild(h("button", { class: "mini", onclick() {
      promptBox("Edit Tags", (meta.tags || []).join(", "), "Comma-separated. \"pack:<id>\" tags mark pack installs.",
        async (value) => {
          const tags = value.split(",").map((s) => s.trim()).filter(Boolean);
          await updateAssetMeta({ ...meta, tags });
          refresh();
        });
    } }, "Tags"));
    actions.appendChild(h("button", { class: "mini", async onclick() {
      const url = await assetUrl(meta.key);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.name + (EXT_BY_MIME[meta.mime || ""] || "");
      a.click();
    } }, "Export"));
    actions.appendChild(h("button", { class: "mini danger", onclick() {
      const warning = inUse
        ? "This asset is USED by the current project — deleting it leaves those references empty after the next reload. Delete anyway?"
        : "Delete \"" + meta.name + "\" from the library?";
      confirmBox(warning, async () => {
        stopPreview();
        await removeAsset(meta.key);
        refresh();
      });
    } }, "Delete"));

    return h("div", { class: "ab-card" + (missing ? " ab-card-missing" : ""), title: meta.key },
      thumbFor(meta, srcByKey, missing),
      h("div", { class: "ab-name" }, meta.name),
      missing
        ? h("div", { class: "ab-meta ab-missing-note" }, MISSING_ASSET_COPY.title + " — " + MISSING_ASSET_COPY.body)
        : h("div", { class: "ab-meta dim" },
            (meta.meta && meta.meta.charset === false ? "Sheet" : TYPE_LABELS[meta.type]) + " · " + fmtBytes(meta.bytes) +
            (meta.w ? " · " + meta.w + "×" + meta.h : "")),
      (meta.tags || []).length ? h("div", { class: "ab-cardtags dim" }, (meta.tags || []).join(", ")) : null,
      h("div", { class: "ab-badges" },
        missing ? h("span", { class: "ab-badge missing" }, "missing")
          : inUse ? h("span", { class: "ab-badge used" }, "in project")
            : h("span", { class: "ab-badge" }, "unused")),
      actions);
  }

  function refresh() {
    renderRail();
    if (curType === "packs") {
      tagRow.innerHTML = "";
      foot.textContent = "Packs install into this device's library, tagged pack:<id>; installs are content-deduped, so reinstalling is safe.";
      renderPacks();
      return;
    }
    renderTags();
    const { list, used } = visibleMetas();
    unusedBtn.classList.toggle("sel", unusedOnly);
    grid.innerHTML = "";
    if (!libraryAvailable()) {
      grid.appendChild(h("div", { class: "dim", style: "padding:20px" },
        "The asset library is unavailable in this session (no IndexedDB/desktop storage). Imports are disabled."));
    } else if (!list.length) {
      grid.appendChild(h("div", { class: "dim", style: "padding:20px" },
        libraryMetas().length
          ? "No assets match the current filters."
          : (dropFolderAvailable()
              ? "No imported assets yet — copy PNG/OGG files into the import folder above (Open Folder), drop them here, or use Import Files…. Imported art appears in the same pickers as the built-in sets."
              : "No imported assets yet — drop PNG/OGG files here or use Import Files…. Imported art appears in the same pickers as the built-in sets.")));
    } else {
      // One key → object-URL map per refresh; a per-card catalog scan was
      // quadratic once a sliced-sheet import put thousands of tiles in here.
      const srcByKey = new Map<string, string>(
        libraryImageEntries().map((e: any) => [e.key, e.src]));
      const missing = projectScanAvailable() ? currentMissingKeys() : null;
      for (const meta of list) grid.appendChild(card(meta, used, srcByKey, !!missing && missing.has(meta.key)));
      // Recovering from an oversliced import means deleting thousands of
      // tiles — give the Unused-only view a one-click cleanup.
      if (unusedOnly && list.length > 1) {
        grid.appendChild(h("div", { style: "padding:8px" }, h("button", { class: "mini danger", onclick() {
          confirmBox(
            "Delete all " + list.length + " unused assets shown here? Your current project doesn't use any of them. This can't be undone.",
            async () => {
              stopPreview();
              await removeAssets(list.map((m) => m.key));
              refresh();
            });
        } }, "Delete All " + list.length + " Unused…")));
      }
    }
    const metasAll = libraryMetas();
    const usedAll = metasAll.filter((m) => used.has(m.key)).length;
    const bytes = metasAll.reduce((sum, m) => sum + (m.bytes || 0), 0);
    foot.textContent = metasAll.length + " assets · " + usedAll + " used by this project · "
      + (metasAll.length - usedAll) + " unused · " + fmtBytes(bytes)
      + " — shipped img/ and generated assets are managed by the Resource Manager.";
  }

  // ---- drag & drop ----------------------------------------------------------
  buildDropBanner();
  const body = h("div", { class: "ab-body" },
    rail,
    h("div", { class: "ab-main" }, dropBanner, bar, tagRow, grid, foot));
  body.addEventListener("dragover", (e: any) => { e.preventDefault(); body.classList.add("ab-drop"); });
  body.addEventListener("dragleave", () => body.classList.remove("ab-drop"));
  body.addEventListener("drop", (e: any) => {
    e.preventDefault();
    body.classList.remove("ab-drop");
    doImport(Array.from(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : []));
  });

  // Re-scan the drop-folders whenever the window regains focus (e.g. after the
  // user alt-tabs to Explorer, pastes files, and comes back), so new files show
  // up on their own. Scoped to while the browser is open, then torn down. For a
  // folder game (H4·B) the editor-wide focus scan already runs; the browser only
  // needs to REFRESH when that background scan changes the library.
  const onFocus = () => { scanFolder(); };
  let unsubProject: (() => void) | null = null;
  if (projectScanAvailable()) {
    unsubProject = onProjectAssetsChanged(() => refresh());
  } else if (dropFolderAvailable()) {
    window.addEventListener("focus", onFocus);
  }

  modal({
    title: "Asset Browser",
    wide: true,
    class: "assetbrowser",
    content: body,
    onClose() {
      stopPreview();
      window.removeEventListener("focus", onFocus);
      if (unsubProject) unsubProject();
    },
  });
  refresh();
  // Pick up anything already sitting in the assets/ folder (or the app-data inbox)
  // when the browser opens.
  scanFolder();
}
