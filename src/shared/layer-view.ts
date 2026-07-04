/* RPGAtlas — src/shared/layer-view.ts
   The one pure accessor over a map's layer stack (Phase 8 Stage A).

   A map has two possible layer descriptions: the classic four role arrays
   (map.layers — always present, always the tile storage for role layers) and
   the optional generalized stack map.layersAdv (Phase 8). This module owns the
   merged view both editors and the renderer composite read, so the two
   sources can never drift:

     layerView(map)  →  ordered, flattened, render-ready entries

   layersAdv absent ⇒ the classic stack (ground, decor, decor2, over), which
   renders byte-identically to the pre-Phase-8 loop. When present, the stack
   is repaired on open (repairLayersAdv) with the same posture as the dock's
   validateLayout: exactly one core entry per role — missing cores inserted in
   classic order, duplicate cores and unknown types dropped — and unique ids.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { AdvLayer, AdvLayerBase, GameMap } from "./schema";

export type CoreRole = "ground" | "decor" | "decor2" | "over";
export type BlendMode = NonNullable<AdvLayerBase["blend"]>;

/** Classic draw order, bottom → top (mirrors editor-state LAYER_ORDER). */
export const CORE_ROLES: CoreRole[] = ["ground", "decor", "decor2", "over"];

/** One flattened, render-ready entry of the layer stack (bottom → top).
 *  Groups are dissolved into their children; their visibility/lock/opacity
 *  multiply down onto every descendant. */
export interface LayerViewEntry {
  id: number;
  name: string;
  /** Set for core entries: which map.layers role array holds the tiles. */
  role?: CoreRole;
  /** Set for "tile" entries: the layer's own width*height id array. */
  data?: number[];
  /** Engine composite buffer. Cores: ground/decor/decor2 → "below",
   *  over → "above". Tile layers: their slot field (default "below"). */
  slot: "below" | "above";
  /** Own flag ANDed with every ancestor group's. */
  visible: boolean;
  /** Own flag ORed with every ancestor group's (editor-only). */
  locked: boolean;
  /** Own opacity multiplied by every ancestor group's, clamped 0..1. */
  opacity: number;
  blend: BlendMode;
  tint?: string;
  /** Enclosing group ids, outermost first (Layers-list indentation). */
  path: number[];
  /** The source stack entry (never a group). */
  layer: AdvLayer;
}

/** The stack an absent map.layersAdv means: the four cores in classic order.
 *  Ids are the role indices (stable, tiny, never collide with user layers —
 *  repair renumbers user entries above them). */
export function classicStack(): AdvLayer[] {
  return CORE_ROLES.map((role, i) => ({ id: i + 1, name: role, type: "core", role }));
}

function isCoreRole(v: unknown): v is CoreRole {
  return v === "ground" || v === "decor" || v === "decor2" || v === "over";
}

/** Repair a loaded layersAdv in place-order (returns a NEW array; input is
 *  not mutated): drop unknown-shaped entries and duplicate cores, insert
 *  missing cores in classic order, renumber duplicate/invalid ids.
 *  `changed` reports whether anything was fixed (callers may touch()). */
export function repairLayersAdv(layers: AdvLayer[] | undefined | null): {
  layers: AdvLayer[];
  changed: boolean;
} {
  if (!Array.isArray(layers)) return { layers: classicStack(), changed: true };
  let changed = false;
  const seenRoles = new Set<CoreRole>();
  const seenIds = new Set<number>();
  let nextId = 1;
  for (const l of layers as unknown as Array<{ id?: unknown }>) {
    if (l && typeof l.id === "number" && Number.isFinite(l.id)) {
      nextId = Math.max(nextId, Math.floor(l.id) + 1);
    }
  }
  const fixId = (l: AdvLayer): AdvLayer => {
    let out = l;
    if (typeof out.id !== "number" || !Number.isFinite(out.id) || seenIds.has(out.id)) {
      out = { ...out, id: nextId++ };
      changed = true;
    }
    seenIds.add(out.id);
    if (typeof out.name !== "string") {
      out = { ...out, name: "" };
      changed = true;
    }
    return out;
  };

  const repairList = (list: AdvLayer[]): AdvLayer[] => {
    const out: AdvLayer[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") {
        changed = true;
        continue;
      }
      if (raw.type === "core") {
        if (!isCoreRole(raw.role) || seenRoles.has(raw.role)) {
          changed = true; // unknown role or duplicate core — drop
          continue;
        }
        seenRoles.add(raw.role);
        out.push(fixId(raw));
      } else if (raw.type === "tile") {
        out.push(fixId(Array.isArray(raw.data) ? raw : { ...raw, data: [] }));
        if (!Array.isArray(raw.data)) changed = true;
      } else if (raw.type === "group") {
        const fixed = fixId(raw) as AdvLayer & { type: "group" };
        out.push({ ...fixed, children: repairList(Array.isArray(raw.children) ? raw.children : []) });
        if (!Array.isArray(raw.children)) changed = true;
      } else {
        changed = true; // unknown type — drop
      }
    }
    return out;
  };

  const repaired = repairList(layers);

  // Insert any missing core at its classic position relative to the cores
  // already present (top level; cores inside groups keep their spot).
  for (let ri = 0; ri < CORE_ROLES.length; ri++) {
    const role = CORE_ROLES[ri];
    if (seenRoles.has(role)) continue;
    changed = true;
    const entry: AdvLayer = { id: nextId++, name: role, type: "core", role };
    // after the last present core with a lower classic index, else at start
    let at = 0;
    for (let i = 0; i < repaired.length; i++) {
      const e = repaired[i];
      if (e.type === "core" && CORE_ROLES.indexOf(e.role) < ri) at = i + 1;
    }
    repaired.splice(at, 0, entry);
    seenRoles.add(role);
  }

  return { layers: repaired, changed };
}

const BLENDS: BlendMode[] = ["normal", "add", "multiply", "screen"];

/** Flatten a (repaired) stack into render-ready entries, resolving group
 *  inheritance. Pure; does not read tile data. */
export function flattenLayers(layers: AdvLayer[]): LayerViewEntry[] {
  const out: LayerViewEntry[] = [];
  const walk = (
    list: AdvLayer[],
    path: number[],
    visible: boolean,
    locked: boolean,
    opacity: number,
  ) => {
    for (const l of list) {
      const vis = visible && l.visible !== false;
      const lock = locked || l.locked === true;
      const op = Math.min(1, Math.max(0, opacity * (l.opacity == null ? 1 : l.opacity)));
      if (l.type === "group") {
        walk(l.children, [...path, l.id], vis, lock, op);
        continue;
      }
      out.push({
        id: l.id,
        name: l.name,
        role: l.type === "core" ? l.role : undefined,
        data: l.type === "tile" ? l.data : undefined,
        slot:
          l.type === "core"
            ? l.role === "over"
              ? "above"
              : "below"
            : l.slot === "above"
              ? "above"
              : "below",
        visible: vis,
        locked: lock,
        opacity: op,
        blend: l.blend && BLENDS.includes(l.blend) ? l.blend : "normal",
        tint: l.tint,
        path,
        layer: l,
      });
    }
  };
  walk(layers, [], true, false, 1);
  return out;
}

/** The merged view of a map's layer stack: repaired layersAdv when present,
 *  the classic stack otherwise. Never mutates the map. */
export function layerView(map: Pick<GameMap, "layersAdv">): LayerViewEntry[] {
  if (!map.layersAdv) return flattenLayers(classicStack());
  return flattenLayers(repairLayersAdv(map.layersAdv).layers);
}

/** Where shadows draw in a flattened stack: immediately below the first
 *  "above" entry (the classic position under the overhead layer), or at the
 *  end when nothing renders above. Returns an index into `entries`. */
export function shadowIndex(entries: LayerViewEntry[]): number {
  const i = entries.findIndex((e) => e.slot === "above");
  return i < 0 ? entries.length : i;
}

/** Allocate the next unused layer id across the whole (nested) stack. */
export function nextLayerId(layers: AdvLayer[]): number {
  let max = 0;
  const walk = (list: AdvLayer[]) => {
    for (const l of list) {
      if (typeof l.id === "number" && Number.isFinite(l.id)) max = Math.max(max, l.id);
      if (l.type === "group") walk(l.children);
    }
  };
  walk(layers);
  return max + 1;
}
