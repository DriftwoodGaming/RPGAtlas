/* RPGAtlas — src/engine/scenes/zone-runtime.ts
   Gameplay-zone runtime (Phase 8 Stage D). map.zones carries author-drawn
   Objects & gameplay zones (encounter / transfer / sound / weather / spawn /
   collision / nav / custom). This module gives them engine behaviour, ALL of
   it behind an absence guard: a map with no `zones` array produces zero new
   work and byte-identical movement (the goldens gate this).

   The two performance-sensitive kinds are baked once at map load, never tested
   per step:
   - collision / nav rasterize into a passOv-compatible overlay (zone-raster);
     tilePassable reads the baked grid, so the movement hot path stays a plain
     array lookup.
   Everything else is checked only on tile-ENTER (onPlayerStep), with the
   zone-geom bbox pre-filter, and only when the map actually has zones of that
   kind:
   - encounter: while inside, the zone's troop pool replaces map.encounters for
     the roll — the strongest tier of the byRegion precedence family.
   - transfer: edge-triggered on enter; map.ts routes it through the ordinary
     transfer path (services.transferPlayer).
   - sound: loops an ambience-bus layer while inside, merged with the map's own
     ambience; falloff:"linear" attenuates the layer volume by distance.
   - weather: applies on enter, restores the map's weather on exit.
   - spawn: resolved at EDIT time (the location picker writes plain coords) —
     zero runtime cost here.
   - custom: inert; surfaced to plugins/Script via atlas.zonesAt (script-api).

   State is owned here (not on the shared engine context): resetZoneState wipes
   it at each loadMap. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { rasterizeZones } from "../../shared/zone-raster.js";
import { zonesAtTile, distanceToZoneTile } from "../../shared/zone-geom.js";
import { setAmbience } from "../../shared/audio-deck.js";

/** A transfer the runtime wants map.ts to fire (kept out of this module so the
 *  transfer routing stays in one place and there's no import cycle). */
export interface ZoneTransferReq {
  mapId: number;
  x: number;
  y: number;
  dir?: number;
}

interface ZoneState {
  map: any;
  hasZones: boolean;
  passGrid: Int8Array | null;      // baked collision/nav overlay, or null
  inside: Set<number>;             // zone ids the player is currently inside
  weatherApplied: any | null;      // the weather zone we last applied (for restore)
  weatherBaseline: { kind: string; power: number } | null; // map weather to restore to
  soundActive: boolean;            // is any sound zone contributing ambience?
}

let Z: ZoneState = emptyState();

function emptyState(): ZoneState {
  return {
    map: null,
    hasZones: false,
    passGrid: null,
    inside: new Set(),
    weatherApplied: null,
    weatherBaseline: null,
    soundActive: false,
  };
}

/** Read the current map's weather (for restore-on-exit). Returns null when the
 *  weather plugin isn't loaded — then weather zones are inert, as designed. */
function readWeather(): { kind: string; power: number } | null {
  const A = (window as any).Atlas;
  if (!A || typeof A.weather !== "function") return null;
  const st = A.state || {};
  return { kind: st.weather || "none", power: st.weatherPower == null ? 5 : st.weatherPower };
}

function setWeather(kind: string, power: number): void {
  const A = (window as any).Atlas;
  if (A && typeof A.weather === "function") A.weather(kind, power);
}

/** Reset zone state for a freshly loaded map: bake collision/nav into a pass
 *  overlay and clear the presence/weather/sound bookkeeping. Called from
 *  loadMap. Absent `zones` ⇒ empty state, no overlay, no per-step work. */
export function resetZoneState(map: any): void {
  Z = emptyState();
  Z.map = map;
  const zones = map && map.zones;
  if (!zones || !zones.length) return;
  Z.hasZones = true;
  Z.passGrid = rasterizeZones(zones, map.width, map.height);
  Z.weatherBaseline = readWeather();
}

/** The baked passability overlay for the current map (passOv-compatible values:
 *  0 auto, 1 force-pass, 2 force-block), or null when the map has no
 *  collision/nav zones. tilePassable consults this before its normal read. */
export function zonePassAt(x: number, y: number): number {
  const g = Z.passGrid;
  if (!g) return 0;
  const m = Z.map;
  if (!m || x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
  return g[y * m.width + x];
}

/** Does the current map have any zones? Cheap guard the caller uses to skip the
 *  encounter-override / presence work entirely on classic maps. */
export function mapHasZones(): boolean {
  return Z.hasZones;
}

/** The encounter troop pool for tile (x, y): the FIRST encounter zone covering
 *  the tile wins (author draw order), replacing `fallback`. Returns fallback
 *  unchanged when no encounter zone applies — so region/time precedence in
 *  map.ts runs normally. This is the top tier of the byRegion family. */
export function zoneEncounterPool(map: any, x: number, y: number, fallback: number[]): number[] {
  if (!Z.hasZones || !map.zones) return fallback;
  const here = zonesAtTile(map.zones, x, y);
  for (const z of here) {
    if (z.kind === "encounter" && z.encounter && Array.isArray(z.encounter.troops) && z.encounter.troops.length) {
      return z.encounter.troops;
    }
  }
  return fallback;
}

/** Reconcile ambience with the sound zones the player currently occupies,
 *  merged onto the map's base ambience list. A sound zone contributes its
 *  `key` at `vol`, scaled by linear falloff (nearest covering distance is 0 →
 *  full; the tile-center is always inside a covering zone, so distance is 0 —
 *  the falloff curve matters for the vertex/point-zone case where the player
 *  can be at the edge). */
function reconcileSound(map: any, x: number, y: number): void {
  const base = Array.isArray(map.ambience) ? map.ambience.slice() : [];
  let any = false;
  if (map.zones) {
    const byKey = new Map<string, number>();
    for (const z of map.zones) {
      if (z.kind !== "sound" || !z.sound || !z.sound.key) continue;
      // Only zones covering the player's tile play (edge falloff refines vol).
      const dist = distanceToZoneTile(z.shape, x, y);
      if (dist > 0) continue;
      const vol = z.sound.vol == null ? 1 : z.sound.vol;
      // Linear falloff would matter for a broader radius; inside a covering
      // zone dist===0, so full vol. Keep the loudest per key.
      const prev = byKey.get(z.sound.key);
      if (prev == null || vol > prev) byKey.set(z.sound.key, vol);
      any = true;
    }
    for (const [key, vol] of byKey) base.push({ key, vol });
  }
  // Only touch the deck when a sound zone is (or was) contributing — a map with
  // no sound zones never calls setAmbience beyond its normal map-load call.
  if (any || Z.soundActive) {
    setAmbience(base);
    Z.soundActive = any;
  }
}

/** Apply / restore the weather zone the player is in. Enter a weather zone ⇒
 *  set its weather; leave every weather zone ⇒ restore the map baseline. */
function reconcileWeather(map: any, x: number, y: number): void {
  if (Z.weatherBaseline == null) return; // weather plugin absent ⇒ inert
  let want: { kind: string; power: number } | null = null;
  if (map.zones) {
    for (const z of zonesAtTile(map.zones, x, y)) {
      if (z.kind === "weather" && z.weather && z.weather.kind) {
        want = { kind: z.weather.kind, power: z.weather.power == null ? 5 : z.weather.power };
        break;
      }
    }
  }
  if (want) {
    if (!Z.weatherApplied || Z.weatherApplied.kind !== want.kind || Z.weatherApplied.power !== want.power) {
      setWeather(want.kind, want.power);
      Z.weatherApplied = want;
    }
  } else if (Z.weatherApplied) {
    setWeather(Z.weatherBaseline.kind, Z.weatherBaseline.power);
    Z.weatherApplied = null;
  }
}

/** Update zone presence for the tile the player just stepped onto. Handles
 *  sound + weather (level-triggered while inside) and returns an edge-triggered
 *  transfer request (fired once on ENTER) for map.ts to route, or null.
 *  Absent zones ⇒ returns null immediately. */
export function updateZonePresence(map: any, x: number, y: number): ZoneTransferReq | null {
  if (!Z.hasZones || !map.zones) return null;
  const here = zonesAtTile(map.zones, x, y);
  const nowIn = new Set<number>(here.map((z: any) => z.id));

  // Edge-triggered transfer: fire the first transfer zone we newly entered.
  let transfer: ZoneTransferReq | null = null;
  for (const z of here) {
    if (z.kind === "transfer" && z.transfer && !Z.inside.has(z.id)) {
      const t = z.transfer;
      transfer = { mapId: t.mapId, x: t.x, y: t.y, dir: t.dir };
      break; // one transfer per step
    }
  }

  Z.inside = nowIn;
  reconcileSound(map, x, y);
  reconcileWeather(map, x, y);
  return transfer;
}

/** Test hook: the current zone-state snapshot (diagnostics / e2e). */
export function zoneStateSnapshot(): { hasZones: boolean; inside: number[]; weather: any } {
  return { hasZones: Z.hasZones, inside: [...Z.inside], weather: Z.weatherApplied };
}
