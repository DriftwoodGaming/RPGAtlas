/* RPGAtlas — src/editor/advanced/adv-panel.ts
   The Advanced Map Editor dock panel (Phase 8).

   A second, Tiled-class view over the SAME map document as the classic Map
   panel: everything painted in either view is visible in the other, and every
   mutation goes through the same seams (touch(), pushUndo). Stage A shipped the
   shell (Map Tree, a read-only Layers list, a zoom-only canvas). Stage B makes
   the layer stack fully editable — add/rename/reorder/group tile layers, toggle
   visibility/lock, set opacity/blend/tint — and paints the ACTIVE layer on the
   panel's own canvas (pen / erase / fill / rect, routed to any core or tile
   layer). Stages C–F add the Studio, zones, stamps, and automapping.

   Rebuild discipline mirrors the World View: advDirty() is wired into touch(),
   debounced, and skipped while the panel is hidden; a ResizeObserver catches
   the "shown while dirty" case.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { editorState as S, curMap, t } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";
import { touch } from "../persistence";
import { renderMap, renderMapView, type MapView } from "../map-editor/map-render";
import { rebuildMapList } from "../map-editor/map-list";
import { setStatus } from "../map-editor/status";
import type { MapFolder, MapZone } from "../../shared/schema";
import { advState, advHooks, type AdvTool, type AdvRail } from "./adv-state";
import { attachAdvPainting } from "./adv-paint";
import { buildLayersToolbar, renderLayersList, renderLayerProps } from "./adv-layers";
import { attachZoneDrawing, cancelZoneDraft } from "./adv-zone-draw";
import { renderObjectsPanel } from "./adv-objects";

export const ADV_PANEL = "adv";

const ADV_ZOOMS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2];

// ---- panel DOM ----
let root: HTMLElement | null = null;
let treeEl: HTMLElement | null = null;
let layersEl: HTMLElement | null = null;
let propsEl: HTMLElement | null = null;
let objectsEl: HTMLElement | null = null;   // Objects palette body (Stage D)
let railTabsEl: HTMLElement | null = null;   // Layers / Objects tab strip
let canvas: HTMLCanvasElement | null = null;
let zoomLabel: HTMLElement | null = null;
let toolBtns: Record<string, HTMLElement> = {};
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
  rebuildObjects();
  syncRail();
  renderAdvCanvas();
}
function rebuildLayers() {
  if (layersEl) renderLayersList(layersEl);
  if (propsEl) renderLayerProps(propsEl);
}
function rebuildObjects() {
  if (objectsEl) renderObjectsPanel(objectsEl);
}
/** Show the active rail's body (Layers or Objects) and light its tab. */
function syncRail() {
  const objects = advState.rail === "objects";
  const layersWrap = layersEl ? (layersEl.closest(".adv-rail-layers") as HTMLElement | null) : null;
  if (layersWrap) layersWrap.style.display = objects ? "none" : "";
  if (objectsEl) objectsEl.style.display = objects ? "" : "none";
  if (railTabsEl) {
    for (const b of Array.from(railTabsEl.children) as HTMLElement[]) {
      b.classList.toggle("sel", b.dataset.rail === advState.rail);
    }
  }
}
function setRail(rail: AdvRail) {
  if (advState.rail === rail) return;
  advState.rail = rail;
  cancelZoneDraft();
  syncRail();
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

// ============================ canvas ============================
function advView(): MapView {
  const objects = advState.rail === "objects";
  const m = curMap();
  return {
    zoom: advState.zoom, mode: "map", layer: "auto", tool: advState.tool,
    selection: null, hoverCell: advState.hoverCell, hoverQuad: 0,
    rectStart: advState.rectStart, painting: advState.painting,
    pasteMode: null, clipTiles: null, selectedEvent: null,
    system: S.proj.system,
    // In Objects mode the active layer is not dimmed (the zones sit on top);
    // in Layers mode dim above the active layer as before.
    activeLayerId: objects ? undefined : (advState.activeLayerId ?? undefined),
    zoneOverlay: objects && m
      ? {
          zones: (m.zones as MapZone[]) || [],
          selectedId: advState.selectedZoneId,
          draft: advState.zoneDraft,
        }
      : undefined,
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
function setTool(tool: AdvTool) {
  advState.tool = tool;
  for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("sel", k === tool);
}

// ============================ mount ============================
export function mountAdvanced(): HTMLElement {
  canvas = h("canvas", { class: "adv-canvas" }) as HTMLCanvasElement;
  treeEl = h("div", { class: "adv-tree" }) as HTMLElement;
  layersEl = h("div", { class: "adv-layers" }) as HTMLElement;
  propsEl = h("div", { class: "adv-layer-props" }) as HTMLElement;
  objectsEl = h("div", { class: "adv-objects" }) as HTMLElement;
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

  const tools: [AdvTool, string, string][] = [
    ["pen", "✏", t("Pen")], ["erase", "⌫", t("Eraser")],
    ["fill", "🪣", t("Fill")], ["rect", "▭", t("Rectangle")],
  ];
  toolBtns = {};
  const toolStrip = h("div", { class: "adv-toolstrip" },
    ...tools.map(([id, icon, title]) => {
      const b = h("button", {
        class: "adv-mini-btn" + (advState.tool === id ? " sel" : ""),
        title, onclick: () => setTool(id),
      }, icon) as HTMLElement;
      toolBtns[id] = b;
      return b;
    }),
    h("span", { class: "adv-tool-sep" }),
    h("button", { class: "adv-mini-btn", title: t("Zoom Out"), onclick: () => stepZoom(-1) }, "−"),
    zoomLabel,
    h("button", { class: "adv-mini-btn", title: t("Zoom In"), onclick: () => stepZoom(1) }, "＋"),
  ) as HTMLElement;

  // Right-rail tab strip: Layers stack vs. Objects & gameplay zones (Stage D).
  const railTab = (rail: AdvRail, label: string) =>
    h("button", { class: "adv-rail-tab", "data-rail": rail, onclick: () => setRail(rail) }, label);
  railTabsEl = h("div", { class: "adv-rail-tabs" },
    railTab("layers", t("Layers")),
    railTab("objects", t("Objects")),
  ) as HTMLElement;

  root = h("div", { class: "adv-root dock-panel-content" },
    h("div", { class: "adv-rail" },
      treeHead,
      treeEl,
      railTabsEl,
      h("div", { class: "adv-rail-layers" },
        buildLayersToolbar(),
        layersEl,
        propsEl,
      ),
      objectsEl,
    ),
    h("div", { class: "adv-center" },
      toolStrip,
      h("div", { class: "adv-canvas-wrap" }, canvas),
    ),
  ) as HTMLElement;

  attachAdvPainting(canvas);
  attachZoneDrawing(canvas);
  // Esc cancels an in-progress polygon / draft while the Objects rail is active.
  root.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && advState.rail === "objects") { cancelZoneDraft(); renderAdvCanvas(); }
  });
  root.tabIndex = 0;
  // Bind the refresh hooks the Layers / paint / zone modules call (cycle-safe).
  advHooks.render = renderAdvCanvas;
  advHooks.rebuildLayers = rebuildLayers;
  advHooks.rebuildObjects = rebuildObjects;
  advHooks.rebuild = rebuild;

  // Catch "shown while dirty" (the dock displays the tab after edits landed
  // while it was hidden) — same job worldDirty's debounce does when visible.
  new ResizeObserver(() => { if (dirty && isShowing()) rebuild(); }).observe(root);
  rebuild();
  return root;
}
