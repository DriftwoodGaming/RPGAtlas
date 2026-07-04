/* RPGAtlas — src/editor/advanced/adv-zones.ts
   Pure operations over a map's gameplay zones (map.zones, Phase 8 Stage D):
   allocate ids, add a zone of a kind with a sensible default payload, delete,
   update, and reorder. These back the Objects palette and the zone drawing
   tools and, like the layer ops, promote a classic map to a stored `zones`
   array only on the first edit — so a project that never draws a zone stays
   byte-identical (no `zones` key, zero runtime change).

   No DOM here: the UI (adv-objects.ts) and the canvas tools (adv-zone-draw.ts)
   call these and then push undo / touch through the shared seams. Unit-tested
   in tests-unit/adv-zones-ops.test.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { MapZone, ZoneShape } from "../../shared/schema";

export type ZoneKind = MapZone["kind"];

export const ZONE_KINDS: ZoneKind[] = [
  "encounter", "transfer", "sound", "weather", "spawn", "collision", "nav", "custom",
];

/** Ensure the map has a live `zones` array (promotes a classic map on first
 *  edit). Returns it. */
export function ensureZones(m: any): MapZone[] {
  if (!Array.isArray(m.zones)) m.zones = [];
  return m.zones;
}

/** Next free zone id (max + 1, min 1). */
export function nextZoneId(zones: MapZone[]): number {
  let mx = 0;
  for (const z of zones) if (z && typeof z.id === "number" && z.id > mx) mx = z.id;
  return mx + 1;
}

/** A sensible default payload for a new zone of `kind`. Only the matching
 *  per-kind field is populated; everything else stays absent. */
function defaultPayload(kind: ZoneKind): Partial<MapZone> {
  switch (kind) {
    case "encounter": return { encounter: { troops: [], rate: 30 } };
    case "transfer": return { transfer: { mapId: 0, x: 0, y: 0 } };
    case "sound": return { sound: { key: "", vol: 1, falloff: "none" } };
    case "weather": return { weather: { kind: "rain", power: 5 } };
    default: return {};
  }
}

/** Add a zone of `kind` with `shape` at the end of the stack (top-most in the
 *  overlay). Returns the new zone. Mutates m.zones (promoting on first edit). */
export function addZone(m: any, kind: ZoneKind, shape: ZoneShape, name?: string): MapZone {
  const zones = ensureZones(m);
  const z: MapZone = {
    id: nextZoneId(zones),
    kind,
    shape,
    ...(name ? { name } : {}),
    ...defaultPayload(kind),
  };
  zones.push(z);
  return z;
}

/** Find a zone by id (or null). */
export function findZone(m: any, id: number): MapZone | null {
  const zones = m.zones as MapZone[] | undefined;
  if (!zones) return null;
  return zones.find((z) => z.id === id) || null;
}

/** Delete a zone by id. Returns true if it existed. */
export function deleteZone(m: any, id: number): boolean {
  const zones = m.zones as MapZone[] | undefined;
  if (!zones) return false;
  const i = zones.findIndex((z) => z.id === id);
  if (i < 0) return false;
  zones.splice(i, 1);
  return true;
}

/** Shallow-merge a patch into a zone (kind, name, shape, or a per-kind
 *  payload). Silently ignores an unknown id. */
export function patchZone(m: any, id: number, patch: Partial<MapZone> & Record<string, any>): void {
  const z = findZone(m, id);
  if (!z) return;
  Object.assign(z, patch);
}

/** Move a zone one slot toward the top (dir 1) or bottom (dir -1) of the draw
 *  order. Returns true if it moved. */
export function moveZone(m: any, id: number, dir: -1 | 1): boolean {
  const zones = m.zones as MapZone[] | undefined;
  if (!zones) return false;
  const i = zones.findIndex((z) => z.id === id);
  if (i < 0) return false;
  const j = i + dir;
  if (j < 0 || j >= zones.length) return false;
  const [z] = zones.splice(i, 1);
  zones.splice(j, 0, z);
  return true;
}
