/* RPGAtlas — src/editor/advanced/adv-panel.ts
   The Advanced Map Editor dock panel (Phase 8 Stage A: the shell).

   A second, Tiled-class view over the SAME map document as the classic Map
   panel: everything painted in either view is visible in the other, and every
   mutation goes through the same seams (touch(), pushUndo, edit-scope). This
   stage ships the skeleton — left rail with the Map Tree (proj.mapFolders
   folders, drag a map onto a folder to file it) and the Layers list rendering
   the pure layer-view model read-only (plus the Events / Collision pseudo-
   layers, which are mode switches, not stored layers) — and a center canvas
   driven by the shared render core (renderMapView) under the panel's own
   view-state (advState: zoom only, for now). Stage B makes the layer stack
   editable; Stages C–F add the Studio, zones, stamps, and automapping.

   Rebuild discipline mirrors the World View: advDirty() is wired into
   touch(), debounced, and skipped while the panel is hidden; a ResizeObserver
   catches the "shown while dirty" case.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { editorState as S, curMap, t, LAYER_LABELS } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";
import { touch } from "../persistence";
import { renderMap, renderMapView, type MapView } from "../map-editor/map-render";
import { rebuildMapList } from "../map-editor/map-list";
import { setStatus } from "../map-editor/status";
import { layerView, type LayerViewEntry } from "../../shared/layer-view";
import type { MapFolder } from "../../shared/schema";

export const ADV_PANEL = "adv";

// ---- the panel's own view-state (NOT shared with S's map view) ----
const advState = {
  zoom: 0.5,
};
const ADV_ZOOMS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2];

// ---- panel DOM ----
let root: HTMLElement | null = null;
let treeEl: HTMLElement | null = null;
let layersEl: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let zoomLabel: HTMLElement | null = null;
const openFolders = new Set<number>();

// ============================ dirty / rebuild ============================
let dirty = true;
let kick: any = null;
export function advDirty() {
  dirty = true;
  if (!root) return;
  clearTimeout(kick);
  kick = setTimeout(() => { if (isShowing()) rebuild(); }, 350);
}
function isShowing() {
  return !!root && root.offsetParent !== null && root.clientWidth > 0;
}
function rebuild() {
  if (!root) return;
  dirty = false;
  rebuildTree();
  rebuildLayers();
  renderAdvCanvas();
}

// ============================ map tree ============================
function folders(): MapFolder[] {
  return S.proj.mapFolders || [];
}
function ensureFolders(): MapFolder[] {
  if (!S.proj.mapFolders) S.proj.mapFolders = [];
  return S.proj.mapFolders;
}
function selectMap(id: number) {
  if (S.curMapId !== id) {
    S.curMapId = id;
    S.selectedEvent = null;
    rebuildMapList();
    renderMap();
    setStatus();
  }
  rebuild();
}
function mapRow(m: any): HTMLElement {
  const row = h("div", {
    class: "adv-tree-row adv-tree-map" + (m.id === S.curMapId ? " sel" : ""),
    draggable: "true",
    onclick: () => selectMap(m.id),
  }, m.id + ": " + m.name) as HTMLElement;
  row.addEventListener("dragstart", (e: DragEvent) => {
    e.dataTransfer!.setData("text/rpgatlas-map", String(m.id));
    e.dataTransfer!.effectAllowed = "move";
  });
  return row;
}
function dropTarget(el: HTMLElement, folderId: number | undefined) {
  el.addEventListener("dragover", (e: DragEvent) => {
    if (e.dataTransfer && e.dataTransfer.types.includes("text/rpgatlas-map")) {
      e.preventDefault();
      el.classList.add("adv-drop");
    }
  });
  el.addEventListener("dragleave", () => el.classList.remove("adv-drop"));
  el.addEventListener("drop", (e: DragEvent) => {
    el.classList.remove("adv-drop");
    const id = Number(e.dataTransfer && e.dataTransfer.getData("text/rpgatlas-map"));
    if (!id) return;
    e.preventDefault();
    const m = S.proj.maps.find((mm: any) => mm.id === id);
    if (!m) return;
    if (folderId == null) delete m.folderId;
    else m.folderId = folderId;
    touch();
    rebuild();
  });
}
function folderNameDialog(title: string, initial: string, onOk: (name: string) => void) {
  const input = h("input", {
    type: "text", value: initial, placeholder: t("Folder name"),
    style: "width:100%", spellcheck: "false",
  }) as HTMLInputElement;
  const m = modal({
    title,
    content: input,
    buttons: [
      { label: "Save", primary: true, onClick(c: any) {
        const name = input.value.trim();
        if (!name) return;
        onOk(name);
        c();
      } },
      { label: "Cancel" },
    ],
    dialogKeys: true,
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
  return m;
}
function folderRow(f: MapFolder): HTMLElement {
  const open = openFolders.has(f.id);
  const row = h("div", { class: "adv-tree-row adv-tree-folder" },
    h("span", { class: "adv-caret", onclick() {
      if (open) openFolders.delete(f.id); else openFolders.add(f.id);
      rebuild();
    } }, open ? "▾" : "▸"),
    h("span", {
      class: "adv-folder-name",
      ondblclick: () => folderNameDialog(t("Rename…"), f.name, (name) => { f.name = name; touch(); rebuild(); }),
      onclick() {
        if (open) openFolders.delete(f.id); else openFolders.add(f.id);
        rebuild();
      },
    }, "🗀 " + f.name),
    h("button", { class: "adv-folder-del", title: t("Delete"), onclick() {
      // children fall back to the deleted folder's parent (maps to root)
      const list = ensureFolders();
      for (const sub of list) if (sub.parentId === f.id) sub.parentId = f.parentId ?? null;
      for (const m of S.proj.maps) {
        if (m.folderId === f.id) {
          if (f.parentId == null) delete m.folderId;
          else m.folderId = f.parentId;
        }
      }
      list.splice(list.indexOf(f), 1);
      touch();
      rebuild();
    } }, "✕"),
  ) as HTMLElement;
  dropTarget(row, f.id);
  return row;
}
function rebuildTree() {
  if (!treeEl) return;
  treeEl.innerHTML = "";
  const known = new Set(folders().map((f) => f.id));
  const branch = (parentId: number | null, depth: number): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const f of folders()) {
      if ((f.parentId ?? null) !== parentId) continue;
      const row = folderRow(f);
      row.style.paddingLeft = 6 + depth * 14 + "px";
      out.push(row);
      if (openFolders.has(f.id)) {
        out.push(...branch(f.id, depth + 1));
        for (const m of S.proj.maps) {
          if (m.folderId === f.id) {
            const mr = mapRow(m);
            mr.style.paddingLeft = 6 + (depth + 1) * 14 + "px";
            out.push(mr);
          }
        }
      }
    }
    return out;
  };
  for (const el of branch(null, 0)) treeEl.appendChild(el);
  // root maps: no folderId, or a folderId pointing at a deleted folder
  for (const m of S.proj.maps) {
    if (m.folderId == null || !known.has(m.folderId)) treeEl.appendChild(mapRow(m));
  }
}

// ============================ layers list ============================
function layerRow(e: LayerViewEntry): HTMLElement {
  const label = e.role ? t(LAYER_LABELS[e.role]) : e.name;
  const badges: HTMLElement[] = [];
  if (e.opacity < 1) badges.push(h("span", { class: "adv-layer-badge" }, Math.round(e.opacity * 100) + "%") as HTMLElement);
  if (e.blend !== "normal") badges.push(h("span", { class: "adv-layer-badge" }, e.blend) as HTMLElement);
  return h("div", {
    class: "adv-layer-row" + (e.visible ? "" : " adv-layer-hidden"),
    style: "padding-left:" + (8 + e.path.length * 14) + "px",
  },
    h("span", { class: "adv-layer-eye" }, e.visible ? "👁" : "—"),
    h("span", { class: "adv-layer-name" }, label),
    ...badges,
    e.locked ? h("span", { class: "adv-layer-badge" }, "🔒") : null,
  ) as HTMLElement;
}
function pseudoRow(label: string, icon: string): HTMLElement {
  return h("div", { class: "adv-layer-row adv-layer-pseudo" },
    h("span", { class: "adv-layer-eye" }, icon),
    h("span", { class: "adv-layer-name" }, label),
  ) as HTMLElement;
}
function rebuildLayers() {
  if (!layersEl) return;
  layersEl.innerHTML = "";
  const m = curMap();
  if (!m) return;
  // pseudo-layers on top: mode switches, not stored layers (spec, mockup 1)
  layersEl.appendChild(pseudoRow(t("Events"), "◆"));
  layersEl.appendChild(pseudoRow(t("Collision"), "⛨"));
  // stack rendered top-most first
  for (const e of [...layerView(m)].reverse()) layersEl.appendChild(layerRow(e));
}

// ============================ canvas ============================
function advView(): MapView {
  return {
    zoom: advState.zoom, mode: "map", layer: "auto", tool: "pen",
    selection: null, hoverCell: null, hoverQuad: 0, rectStart: null,
    painting: false, pasteMode: null, clipTiles: null, selectedEvent: null,
    system: S.proj.system,
  };
}
function renderAdvCanvas() {
  if (!canvas) return;
  const m = curMap();
  if (!m) return;
  renderMapView(canvas.getContext("2d"), m, advView());
  if (zoomLabel) zoomLabel.textContent = Math.round(advState.zoom * 100) + "%";
}
function stepZoom(dir: number) {
  const i = ADV_ZOOMS.indexOf(advState.zoom);
  const ni = Math.min(ADV_ZOOMS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir));
  if (ADV_ZOOMS[ni] === advState.zoom) return;
  advState.zoom = ADV_ZOOMS[ni];
  renderAdvCanvas();
}

// ============================ mount ============================
export function mountAdvanced(): HTMLElement {
  canvas = h("canvas", { class: "adv-canvas" }) as HTMLCanvasElement;
  treeEl = h("div", { class: "adv-tree" }) as HTMLElement;
  layersEl = h("div", { class: "adv-layers" }) as HTMLElement;
  zoomLabel = h("span", { class: "adv-zoom-label" }, "50%") as HTMLElement;
  const treeHead = h("div", { class: "adv-section-head" },
    h("span", null, t("Map Tree")),
    h("button", { class: "adv-mini-btn", onclick() {
      folderNameDialog(t("New Folder…"), "", (name) => {
        const list = ensureFolders();
        const id = list.reduce((mx, f) => Math.max(mx, f.id), 0) + 1;
        list.push({ id, name });
        openFolders.add(id);
        touch();
        rebuild();
      });
    } }, "＋"),
  ) as HTMLElement;
  dropTarget(treeHead, undefined); // drop on the header = move to root
  root = h("div", { class: "adv-root dock-panel-content" },
    h("div", { class: "adv-rail" },
      treeHead,
      treeEl,
      h("div", { class: "adv-section-head" }, h("span", null, t("Layers"))),
      layersEl,
    ),
    h("div", { class: "adv-center" },
      h("div", { class: "adv-toolstrip" },
        h("button", { class: "adv-mini-btn", title: t("Zoom Out"), onclick: () => stepZoom(-1) }, "−"),
        zoomLabel,
        h("button", { class: "adv-mini-btn", title: t("Zoom In"), onclick: () => stepZoom(1) }, "＋"),
      ),
      h("div", { class: "adv-canvas-wrap" }, canvas),
    ),
  ) as HTMLElement;
  // Catch "shown while dirty" (the dock displays the tab after edits landed
  // while it was hidden) — same job worldDirty's debounce does when visible.
  new ResizeObserver(() => { if (dirty && isShowing()) rebuild(); }).observe(root);
  rebuild();
  return root;
}
