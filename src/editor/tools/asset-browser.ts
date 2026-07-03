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
import {
  ASSET_TYPES,
  libraryAvailable,
  libraryCatalog,
  libraryImageEntries,
  libraryMetas,
  removeAsset,
  renameAsset,
  updateAssetMeta,
  usedAssetKeys,
  assetUrl,
} from "../../shared/asset-library";
import type { AssetMeta } from "../../shared/services";

const TYPE_LABELS: Record<string, string> = {
  all: "All",
  characters: "Characters",
  facesets: "Facesets",
  enemies: "Enemies",
  tilesets: "Tiles",
  audio: "Audio",
};
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
    for (const ty of ["all", ...ASSET_TYPES]) {
      const n = ty === "all" ? libraryMetas().length : counts[ty] || 0;
      rail.appendChild(h("button", {
        class: "ab-railbtn" + (curType === ty ? " sel" : ""),
        onclick() { curType = ty; refresh(); },
      }, TYPE_LABELS[ty] + (n ? " (" + n + ")" : "")));
    }
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

  function thumbFor(meta: AssetMeta): any {
    if (meta.type === "audio") {
      return h("div", { class: "ab-thumb ab-audio" },
        h("span", { class: "ab-note" }, "♪"),
        h("span", { class: "ab-kind" }, (meta.kind || "se").toUpperCase()),
        fmtDur(meta.dur) ? h("span", { class: "dim" }, fmtDur(meta.dur)) : null);
    }
    const src = libraryImageEntries().find((e: any) => e.key === meta.key)?.src;
    const box = h("div", { class: "ab-thumb" });
    if (src) box.appendChild(h("img", { src, alt: meta.name }));
    return box;
  }

  function card(meta: AssetMeta, used: Set<string>): any {
    const inUse = used.has(meta.key);
    const actions = h("div", { class: "ab-actions" });
    if (meta.type === "audio") {
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

    return h("div", { class: "ab-card", title: meta.key },
      thumbFor(meta),
      h("div", { class: "ab-name" }, meta.name),
      h("div", { class: "ab-meta dim" },
        (meta.meta && meta.meta.charset === false ? "Sheet" : TYPE_LABELS[meta.type]) + " · " + fmtBytes(meta.bytes) +
        (meta.w ? " · " + meta.w + "×" + meta.h : "")),
      (meta.tags || []).length ? h("div", { class: "ab-cardtags dim" }, (meta.tags || []).join(", ")) : null,
      h("div", { class: "ab-badges" },
        inUse ? h("span", { class: "ab-badge used" }, "in project") : h("span", { class: "ab-badge" }, "unused")),
      actions);
  }

  function refresh() {
    renderRail();
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
          : "No imported assets yet — drop PNG/OGG files here or use Import Files…. Imported art appears in the same pickers as the built-in sets."));
    } else {
      for (const meta of list) grid.appendChild(card(meta, used));
    }
    const metasAll = libraryMetas();
    const usedAll = metasAll.filter((m) => used.has(m.key)).length;
    const bytes = metasAll.reduce((sum, m) => sum + (m.bytes || 0), 0);
    foot.textContent = metasAll.length + " assets · " + usedAll + " used by this project · "
      + (metasAll.length - usedAll) + " unused · " + fmtBytes(bytes)
      + " — shipped img/ and generated assets are managed by the Resource Manager.";
  }

  // ---- drag & drop ----------------------------------------------------------
  const body = h("div", { class: "ab-body" },
    rail,
    h("div", { class: "ab-main" }, bar, tagRow, grid, foot));
  body.addEventListener("dragover", (e: any) => { e.preventDefault(); body.classList.add("ab-drop"); });
  body.addEventListener("dragleave", () => body.classList.remove("ab-drop"));
  body.addEventListener("drop", (e: any) => {
    e.preventDefault();
    body.classList.remove("ab-drop");
    doImport(Array.from(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : []));
  });

  modal({
    title: "Asset Browser",
    wide: true,
    class: "assetbrowser",
    content: body,
    onClose() { stopPreview(); },
  });
  refresh();
}
