/* RPGAtlas — src/editor/importers/mz/convert-maps.ts
   Project Compass M1·B: RPG Maker `Map###.json` + `MapInfos.json` → Atlas
   `GameMap[]` + `MapFolder[]` (matrix §2 Map### / MapInfos rows, decision D8).

   RM stores each map as a flat `w·h·6` array — four tile planes (z0–z3), a
   shadow plane (z4), and a region plane (z5). This module rebuckets those into
   Atlas's four role layers (ground/decor/decor2/over) plus `shadows`, `regions`,
   and `passOv`, remapping every cell through the tileset converter's resolver
   (autotile kinds → reserved ids, plain tiles → pre-assigned ids). ★-priority
   tiles float up to the `over` layer; regions clamp to Atlas's 1–63; per-tile
   RM passage bakes into `passOv`. Map metadata converts too: encounters (troop
   list + step→rate), autoplay BGM/BGS → music/ambience keys, and the map note
   preserved verbatim. Event lists are M1·C (events land empty here, exactly as
   M1·A left CommonEvent/Troop command bodies empty behind the translator seam).
   Pure — no DOM. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */

import type { GameMap, MapEncounters, MapFolder, MapLayers } from "../../../shared/schema";
import type { ImportReport } from "./report";
import type { RmList, RmMap, RmMapInfo } from "./raw-types";
import { decodeRmTileId } from "./tile-ids";
import type { TilesetUsage, TilesetsConversion } from "./convert-tilesets";

/** Atlas region ids run 1–63 (Phase 5); RM regions run 1–255. */
export const MAX_REGION = 63;

const notNull = <T>(x: T | null): x is T => x != null;

/**
 * Scan every map's tile planes for the autotile kinds + plain tile ids actually
 * painted, grouped by the map's `tilesetId`. The tileset converter materializes
 * only what a map uses, so the imported palette stays tight.
 */
export function collectTilesetUsage(rawMaps: Iterable<RmMap>): Map<number, TilesetUsage> {
  const usage = new Map<number, TilesetUsage>();
  for (const m of rawMaps) {
    const tsId = m.tilesetId || 1;
    let use = usage.get(tsId);
    if (!use) usage.set(tsId, (use = { autotileKinds: new Set(), plainIds: new Set() }));
    const data = Array.isArray(m.data) ? m.data : [];
    const plane = m.width * m.height;
    // Only the four tile planes (z0–z3) carry tile ids; z4/z5 are shadow/region.
    for (let i = 0; i < plane * 4; i++) {
      const d = decodeRmTileId(data[i]);
      if (d.kind >= 0) use.autotileKinds.add(d.kind);
      else if (d.family !== "empty") use.plainIds.add(Math.floor(data[i]));
    }
  }
  return usage;
}

interface MapData {
  layers: MapLayers;
  shadows?: number[];
  regions?: number[];
  passOv?: number[];
}

/** Rebucket one RM `data[]` (w·h·6) into Atlas role layers + shadow/region/passOv. */
export function convertMapData(m: RmMap, ts: TilesetsConversion, report: ImportReport): MapData {
  const w = m.width, h = m.height, plane = w * h;
  const tsId = m.tilesetId || 1;
  const data = Array.isArray(m.data) ? m.data : [];
  const z = (i: number, p: number): number => data[p * plane + i] || 0;

  const ground = new Array(plane).fill(0);
  const decor = new Array(plane).fill(0);
  const decor2 = new Array(plane).fill(0);
  const over = new Array(plane).fill(0);
  const shadows = new Array(plane).fill(0);
  const regions = new Array(plane).fill(0);
  const passOv = new Array(plane).fill(0);
  let hasShadow = false, hasRegion = false, hasPassOv = false;

  for (let i = 0; i < plane; i++) {
    const rawG = z(i, 0), rawD = z(i, 1), rawD2 = z(i, 2), rawO = z(i, 3);
    ground[i] = ts.resolve(tsId, rawG);
    decor[i] = ts.resolve(tsId, rawD);
    decor2[i] = ts.resolve(tsId, rawD2);
    over[i] = ts.resolve(tsId, rawO);

    // ★ tiles from a lower plane float to `over` (render above the player), if
    // that cell's over slot is free (else they stay put — see report).
    for (const [raw, arr] of [[rawG, ground], [rawD, decor], [rawD2, decor2]] as const) {
      if (raw && ts.isStar(tsId, raw) && over[i] === 0) {
        over[i] = ts.resolve(tsId, raw);
        arr[i] = 0;
      }
    }

    // Ground-tile passage → passOv block (whole-tile; matrix §11).
    const po = ts.passOvOf(tsId, rawG);
    if (po) { passOv[i] = po; hasPassOv = true; }

    const sh = z(i, 4) & 0x0f; // RM shadow = 4-bit quadrant mask
    if (sh) { shadows[i] = sh; hasShadow = true; }

    const rg = Math.floor(z(i, 5));
    if (rg > 0) {
      if (rg > MAX_REGION) {
        report.bump("region-clamp", () => ({
          area: "Maps", kind: "partial", what: "high region numbers", count: 0,
          detail: `Atlas regions go up to ${MAX_REGION}; higher ones were lowered to ${MAX_REGION}`,
        }));
        regions[i] = MAX_REGION;
      } else {
        regions[i] = rg;
      }
      hasRegion = true;
    }
  }

  const out: MapData = { layers: { ground, decor, decor2, over } };
  if (hasShadow) out.shadows = shadows;
  if (hasRegion) out.regions = regions;
  if (hasPassOv) out.passOv = passOv;
  return out;
}

/** encounterList + encounterStep → Atlas `MapEncounters` (matrix §Map###). */
function convertEncounters(m: RmMap, report: ImportReport): MapEncounters | undefined {
  const list = Array.isArray(m.encounterList) ? m.encounterList : [];
  if (!list.length) return undefined;
  const troops: number[] = [];
  let regionScoped = false, weighted = false;
  for (const e of list) {
    if (!e || !e.troopId) continue;
    if (!troops.includes(e.troopId)) troops.push(e.troopId);
    if (Array.isArray(e.regionSet) && e.regionSet.length) regionScoped = true;
    if (e.weight && e.weight !== 10) weighted = true; // 10 = RM default weight
  }
  if (!troops.length) return undefined;
  if (regionScoped) report.bump("enc-region", () => ({
    area: "Maps", kind: "todo", what: "encounters tied to map regions",
    detail: "region-only encounters arrive in a later update; for now they can happen anywhere on the map",
  }));
  if (weighted) report.bump("enc-weight", () => ({
    area: "Maps", kind: "partial", what: "how often each battle appears",
    detail: "Atlas gives each listed battle an equal chance",
  }));
  return { troops, rate: m.encounterStep || 30 };
}

/** Convert one RM map's geometry + metadata into a `GameMap`. Its `name` comes
 *  from MapInfos (RM Map### files carry no name); events are M1·C (left empty). */
export function convertMap(
  id: number,
  name: string,
  m: RmMap,
  ts: TilesetsConversion,
  report: ImportReport,
): GameMap {
  const md = convertMapData(m, ts, report);
  const map: GameMap = {
    id,
    name,
    width: m.width,
    height: m.height,
    tilesetId: m.tilesetId || 1,
    layers: md.layers,
    events: [],
  };
  if (md.shadows) map.shadows = md.shadows;
  if (md.regions) map.regions = md.regions;
  if (md.passOv) map.passOv = md.passOv;

  if (m.autoplayBgm && m.bgm && m.bgm.name) map.music = "asset:audio/" + m.bgm.name;
  if (m.autoplayBgs && m.bgs && m.bgs.name) map.ambience = [{ key: "asset:audio/" + m.bgs.name }];

  const enc = convertEncounters(m, report);
  if (enc) map.encounters = enc;

  if (m.note && m.note.trim()) map.notes = m.note;

  // Metadata Atlas can't honor yet → one friendly line each (M4·A / report).
  if (m.displayName && m.displayName.trim() && m.displayName !== name) {
    report.bump("map-namebanner", () => ({
      area: "Maps", kind: "skipped", what: "the map-name popup",
      detail: "Atlas doesn't show a map-name banner; the map still works",
    }));
  }
  if (m.parallaxName && m.parallaxName.trim()) report.bump("map-parallax", () => ({
    area: "Maps", kind: "todo", what: "scrolling background pictures",
    detail: "parallax backgrounds arrive in a later update",
  }));
  if (m.scrollType) report.bump("map-loop", () => ({
    area: "Maps", kind: "todo", what: "looping maps",
    detail: "maps that wrap around at the edges arrive in a later update",
  }));
  if (m.specifyBattleback && (m.battleback1Name || m.battleback2Name)) report.bump("map-battleback", () => ({
    area: "Maps", kind: "todo", what: "custom battle backgrounds",
    detail: "per-map battle backgrounds arrive in a later update",
  }));

  return map;
}

/**
 * Convert the MapInfos tree + the loaded per-id map data into ordered Atlas maps
 * and synthesized folders (decision D8): one `MapFolder` per parent map that has
 * children, named after the parent; the parent and its children all sit in that
 * folder. Root maps (parentId 0) stay at the tree root.
 */
export function convertMaps(
  mapInfos: RmList<RmMapInfo>,
  rawMaps: Map<number, RmMap>,
  ts: TilesetsConversion,
  report: ImportReport,
): { maps: GameMap[]; folders: MapFolder[] } {
  const infos = (mapInfos || []).filter(notNull);
  const byId = new Map<number, RmMapInfo>();
  for (const info of infos) byId.set(info.id, info);

  // Which parent maps have at least one child → get a folder.
  const parentsWithChildren = new Set<number>();
  for (const info of infos) {
    if (info.parentId && byId.has(info.parentId)) parentsWithChildren.add(info.parentId);
  }
  const folders: MapFolder[] = [];
  const folderIdByParent = new Map<number, number>();
  let nextFolderId = 1;
  for (const info of [...infos].sort((a, b) => (a.order || 0) - (b.order || 0))) {
    if (!parentsWithChildren.has(info.id)) continue;
    const fid = nextFolderId++;
    folderIdByParent.set(info.id, fid);
    folders.push({ id: fid, name: info.name || "Folder " + fid, parentId: null });
  }
  const folderFor = (info: RmMapInfo): number | undefined =>
    folderIdByParent.get(info.parentId || 0) ?? folderIdByParent.get(info.id);

  const maps: GameMap[] = [];
  for (const info of [...infos].sort((a, b) => (a.order || 0) - (b.order || 0))) {
    const raw = rawMaps.get(info.id);
    if (!raw) continue; // MapInfos entry with no Map### file → nothing to convert
    const map = convertMap(info.id, info.name || "Map " + info.id, raw, ts, report);
    const fid = folderFor(info);
    if (fid != null) map.folderId = fid;
    maps.push(map);
  }
  return { maps, folders };
}
