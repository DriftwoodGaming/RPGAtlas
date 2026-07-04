/* RPGAtlas — src/editor/advanced/adv-state.ts
   The Advanced Map Editor's own view-state and the nested-stack operations
   that back its Layers panel (Phase 8 Stage B).

   advState is the panel's private view — active tool, zoom, the id of the
   layer being edited, and the transient paint/hover cursor. It is deliberately
   NOT S's map view: the Advanced editor drives its own canvas, but every
   document mutation still funnels through the shared seams (touch(), pushUndo)
   so autosave and undo behave identically in both editors.

   The layer ops here mutate map.layersAdv (the generalized stack) in place.
   ensureLayersAdv materializes the classic four-core stack the first time a
   map gains a user layer, so a project that never touches the Advanced editor
   stays byte-identical (no layersAdv key). advHooks lets the Layers/paint
   modules refresh the panel without importing it back (cycle-safe, mirrors
   editorHooks). Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AdvLayer } from "../../shared/schema";
import { classicStack, repairLayersAdv, nextLayerId, type CoreRole } from "../../shared/layer-view";

export type AdvTool = "pen" | "erase" | "fill" | "rect";
/** Right-rail tab: paint the tile stack, or place/edit gameplay zones. */
export type AdvRail = "layers" | "objects";
/** Zone drawing tools (Objects mode, Phase 8 Stage D). "select" edits the
 *  selected zone (drag vertices / move); the shape tools draw a new zone. */
export type ZoneTool = "select" | "rect" | "ellipse" | "poly" | "point";
export type ZoneKind = import("../../shared/schema").MapZone["kind"];
import type { ZoneShape } from "../../shared/schema";

export const advState = {
  zoom: 0.5,
  tool: "pen" as AdvTool,
  activeLayerId: null as number | null,
  hoverCell: null as { x: number; y: number } | null,
  rectStart: null as { x: number; y: number } | null,
  painting: false,
  // ---- Objects mode (Phase 8 Stage D) ----
  rail: "layers" as AdvRail,
  zoneTool: "rect" as ZoneTool,
  /** the kind a freshly drawn zone gets. */
  activeKind: "encounter" as ZoneKind,
  selectedZoneId: null as number | null,
  /** in-progress shape while drawing (rect drag, poly points). */
  zoneDraft: null as ZoneShape | null,
  /** poly-in-progress vertex list (committed on double-click / Enter). */
  polyPts: null as { x: number; y: number }[] | null,
  /** vertex being dragged in select mode: index into the zone's vertices. */
  vertexDrag: null as { zoneId: number; index: number } | null,
};

/** Panel refresh callbacks, bound on mount so the Layers/paint modules can
 *  redraw without importing adv-panel back (breaks the import cycle). */
export const advHooks = {
  render: () => {},        // redraw only the canvas (live paint feedback)
  rebuildLayers: () => {}, // rebuild the Layers list
  rebuildObjects: () => {}, // rebuild the Objects palette / inspector
  rebuild: () => {},       // full panel rebuild (tree + layers + canvas)
};

/** Promote a classic map to a stored generalized stack the first time the
 *  Advanced editor adds/edits a layer. Idempotent; repairs an existing stack
 *  (one core per role). Returns the map's live layersAdv array. */
export function ensureLayersAdv(m: any): AdvLayer[] {
  if (!m.layersAdv) m.layersAdv = classicStack();
  else {
    const r = repairLayersAdv(m.layersAdv);
    if (r.changed) m.layersAdv = r.layers;
  }
  return m.layersAdv;
}

/** Locate a layer by id in the nested stack: its containing sibling list and
 *  index there. null if not found. */
export function findLayer(
  layers: AdvLayer[], id: number,
): { list: AdvLayer[]; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.id === id) return { list: layers, index: i };
    if (l.type === "group") {
      const hit = findLayer(l.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Add a new empty tile layer at the top of the stack; returns its id. */
export function addTileLayer(m: any, name: string): number {
  const layers = ensureLayersAdv(m);
  const id = nextLayerId(layers);
  const data = new Array(m.width * m.height).fill(0);
  layers.push({ id, name, type: "tile", data, slot: "below" });
  return id;
}

/** Add a new empty group at the top of the stack; returns its id. */
export function addGroup(m: any, name: string): number {
  const layers = ensureLayersAdv(m);
  const id = nextLayerId(layers);
  layers.push({ id, name, type: "group", children: [] });
  return id;
}

/** Wrap a layer in a fresh group in place (Group button). No-op on cores? No —
 *  Tiled lets any layer be grouped; cores may be grouped too. Returns the new
 *  group id, or null if the layer was not found. */
export function groupLayer(m: any, id: number, name: string): number | null {
  const layers = ensureLayersAdv(m);
  const hit = findLayer(layers, id);
  if (!hit) return null;
  const gid = nextLayerId(layers);
  const layer = hit.list[hit.index];
  hit.list[hit.index] = { id: gid, name, type: "group", children: [layer] };
  return gid;
}

/** Dissolve a group, splicing its children into its position. No-op if the id
 *  is not a group. */
export function ungroupLayer(m: any, id: number): void {
  const layers = ensureLayersAdv(m);
  const hit = findLayer(layers, id);
  if (!hit) return;
  const g = hit.list[hit.index];
  if (g.type !== "group") return;
  hit.list.splice(hit.index, 1, ...g.children);
}

/** Delete a layer. Cores are never deleted (they are the role storage; repair
 *  would just re-insert them) — returns false for a core, true otherwise. */
export function deleteLayer(m: any, id: number): boolean {
  const layers = ensureLayersAdv(m);
  const hit = findLayer(layers, id);
  if (!hit) return false;
  if (hit.list[hit.index].type === "core") return false;
  hit.list.splice(hit.index, 1);
  return true;
}

/** Move a layer one slot up (toward the top / end) or down within its sibling
 *  list. Returns true if it moved. Cross-group moves are out of scope here. */
export function moveLayer(m: any, id: number, dir: -1 | 1): boolean {
  const layers = ensureLayersAdv(m);
  const hit = findLayer(layers, id);
  if (!hit) return false;
  const j = hit.index + dir;
  if (j < 0 || j >= hit.list.length) return false;
  const [l] = hit.list.splice(hit.index, 1);
  hit.list.splice(j, 0, l);
  return true;
}

/** Patch a layer's editable props (visible/locked/opacity/blend/tint/slot/
 *  name) in place. Silently ignores an unknown id. */
export function patchLayer(m: any, id: number, patch: Partial<AdvLayer> & Record<string, any>): void {
  const layers = ensureLayersAdv(m);
  const hit = findLayer(layers, id);
  if (!hit) return;
  Object.assign(hit.list[hit.index], patch);
}

export const CORE_ROLE_SET = new Set<CoreRole>(["ground", "decor", "decor2", "over"]);
