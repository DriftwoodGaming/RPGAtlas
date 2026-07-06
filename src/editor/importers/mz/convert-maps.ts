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
import { assetKeyOf, slugName } from "../../../shared/asset-library";
import type { ImportReport } from "./report";
import type { RmList, RmMap, RmMapInfo } from "./raw-types";
import type { CommandTranslator } from "./convert-events";
import { convertMapEvents } from "./convert-map-events";
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
  // Always present — the editor/engine read these planes unguarded on every
  // map (the data.js newMap invariant; see convertMapData's return).
  shadows: number[];
  regions: number[];
  passOv: number[];
  heights: number[];
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
  const heights = new Array(plane).fill(0); // RM has no elevation concept — flat

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
    if (po) passOv[i] = po;

    const sh = z(i, 4) & 0x0f; // RM shadow = 4-bit quadrant mask
    if (sh) shadows[i] = sh;

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
    }
  }

  // Every Atlas map carries the full plane set even when empty (the data.js
  // newMap invariant). RA.migrateProject now backfills any missing plane at the
  // load boundary too (the importer's output runs through it), but we still emit
  // complete maps so the raw output matches newMap directly. RM has no
  // elevation, so heights is all-zero.
  return { layers: { ground, decor, decor2, over }, shadows, regions, passOv, heights };
}

/** encounterList + encounterStep → Atlas `MapEncounters` (matrix §Map###).
 *  Region-scoped entries (M4·A) build `byRegion`: MZ treats an encounter as
 *  valid where its regionSet is empty OR contains the tile's region, so each
 *  region's pool = the global troops plus its own — and `troops` keeps only
 *  the globally-valid ones. */
function convertEncounters(m: RmMap, report: ImportReport): MapEncounters | undefined {
  const list = Array.isArray(m.encounterList) ? m.encounterList : [];
  if (!list.length) return undefined;
  const troops: number[] = [];
  const regionTroops = new Map<number, number[]>();
  let weighted = false;
  for (const e of list) {
    if (!e || !e.troopId) continue;
    const regions = Array.isArray(e.regionSet) ? e.regionSet.filter((r) => r > 0) : [];
    if (regions.length) {
      for (const r of regions) {
        const rr = Math.min(Math.floor(r), MAX_REGION); // Atlas regions clamp at 63
        const pool = regionTroops.get(rr) || [];
        if (!pool.includes(e.troopId)) pool.push(e.troopId);
        regionTroops.set(rr, pool);
      }
    } else if (!troops.includes(e.troopId)) {
      troops.push(e.troopId);
    }
    if (e.weight && e.weight !== 10) weighted = true; // 10 = RM default weight
  }
  if (!troops.length && !regionTroops.size) return undefined;
  if (weighted) report.bump("enc-weight", () => ({
    area: "Maps", kind: "partial", what: "how often each battle appears",
    detail: "Atlas gives each listed battle an equal chance",
  }));
  const enc: MapEncounters = { troops, rate: m.encounterStep || 30 };
  if (regionTroops.size) {
    enc.byRegion = {};
    for (const [r, pool] of regionTroops) {
      // global troops stay valid inside the region (MZ semantics)
      enc.byRegion[r] = [...troops.filter((t) => !pool.includes(t)), ...pool];
    }
  }
  return enc;
}

/** Convert one RM map's geometry + metadata into a `GameMap`. Its `name` comes
 *  from MapInfos (RM Map### files carry no name); `events[]` run through the
 *  M1·C command translator (`translate`). */
export function convertMap(
  id: number,
  name: string,
  m: RmMap,
  ts: TilesetsConversion,
  report: ImportReport,
  translate: CommandTranslator,
): GameMap {
  const md = convertMapData(m, ts, report);
  const map: GameMap = {
    id,
    name,
    width: m.width,
    height: m.height,
    tilesetId: m.tilesetId || 1,
    layers: md.layers,
    events: convertMapEvents(m.events, translate, report),
  };
  map.shadows = md.shadows;
  map.regions = md.regions;
  map.passOv = md.passOv;
  map.heights = md.heights;

  if (m.autoplayBgm && m.bgm && m.bgm.name) map.music = "asset:audio/" + m.bgm.name;
  // M4·B: the BGS autoplay layer keeps its RM volume (default 80 ⇒ 0.8) —
  // pitch/pan ride along when non-default.
  if (m.autoplayBgs && m.bgs && m.bgs.name) {
    const vol = m.bgs.volume;
    map.ambience = [{
      key: "asset:audio/" + m.bgs.name,
      ...(vol != null && Number(vol) !== 100 ? { vol: Math.round(Math.max(0, Math.min(100, Number(vol) || 0))) / 100 } : {}),
      ...(m.bgs.pitch != null && Number(m.bgs.pitch) !== 100 && Number(m.bgs.pitch) > 0 ? { pitch: Math.round(Number(m.bgs.pitch)) / 100 } : {}),
      ...(m.bgs.pan ? { pan: Math.round(Math.max(-100, Math.min(100, Number(m.bgs.pan)))) / 100 } : {}),
    }];
  }

  const enc = convertEncounters(m, report);
  if (enc) map.encounters = enc;

  if (m.note && m.note.trim()) map.notes = m.note;

  // The map-name banner stays a friendly skip (locked decision, matrix §16).
  if (m.displayName && m.displayName.trim() && m.displayName !== name) {
    report.bump("map-namebanner", () => ({
      area: "Maps", kind: "skipped", what: "the map-name popup",
      detail: "Atlas doesn't show a map-name banner; the map still works",
    }));
  }
  // M4·A: parallax, looping, and per-map battlebacks are real now. Art files
  // aren't copied by the importer (same as pictures) — one aggregated line
  // says "add the art and it appears".
  if (m.parallaxName && m.parallaxName.trim()) {
    const px: GameMap["parallax"] = {
      key: assetKeyOf("pictures", slugName(m.parallaxName)),
    };
    if (m.parallaxLoopX) px.loopX = true;
    if (m.parallaxLoopY) px.loopY = true;
    if (Number(m.parallaxSx)) px.sx = Number(m.parallaxSx);
    if (Number(m.parallaxSy)) px.sy = Number(m.parallaxSy);
    if (m.parallaxName.startsWith("!")) px.lock = true;
    map.parallax = px;
    report.bump("parallax-art", () => ({
      area: "Maps", kind: "partial", what: "background picture files",
      detail: "your scrolling backgrounds now show in Atlas — add their image files to the Assets library and they'll appear",
    }));
  }
  if (m.scrollType) {
    // RM scrollType: 1 = vertical loop, 2 = horizontal, 3 = both.
    map.loop = {
      ...(m.scrollType === 2 || m.scrollType === 3 ? { h: true } : {}),
      ...(m.scrollType === 1 || m.scrollType === 3 ? { v: true } : {}),
    };
  }
  if (m.specifyBattleback && (m.battleback1Name || m.battleback2Name)) {
    map.battleback = {
      ...(m.battleback1Name ? { back1: assetKeyOf("pictures", slugName(m.battleback1Name)) } : {}),
      ...(m.battleback2Name ? { back2: assetKeyOf("pictures", slugName(m.battleback2Name)) } : {}),
    };
    report.bump("battleback-art", () => ({
      area: "Maps", kind: "partial", what: "battle background image files",
      detail: "your battle backgrounds now show in Atlas — add their image files to the Assets library and they'll appear",
    }));
  }

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
  translate: CommandTranslator,
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
    const map = convertMap(info.id, info.name || "Map " + info.id, raw, ts, report, translate);
    const fid = folderFor(info);
    if (fid != null) map.folderId = fid;
    maps.push(map);
  }
  return { maps, folders };
}
