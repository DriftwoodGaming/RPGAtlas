/* RPGAtlas — src/editor/importers/mz/index.ts
   Project Compass M1·A: the importer-core public surface. `convertDatabase`
   turns parsed RM data into Atlas DB records + an `ImportReport`;
   `importMzDatabase` is the end-to-end intake → sniff → convert entry. Maps +
   tilesets (M1·B), the command translator (M1·C), and the wizard/report UI +
   boot (M1·D) build on this. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

import type {
  Actor,
  Armor,
  Autotile,
  ClassDef,
  CommonEvent,
  Enemy,
  GameMap,
  Item,
  MapFolder,
  Skill,
  StateDef,
  SystemData,
  Tileset,
  Troop,
  Weapon,
} from "../../../shared/schema";
import { ImportReport } from "./report";
import { readRawProject, type MzFileSource } from "./intake";
import { convertSystem } from "./convert-system";
import { convertActors, convertClasses, convertEnemies, convertStates } from "./convert-battlers";
import { convertArmors, convertItems, convertSkills, convertWeapons } from "./convert-items";
import { convertCommonEvents, convertTroops, type CommandTranslator } from "./convert-events";
import { collectTilesetUsage, convertMaps } from "./convert-maps";
import { convertTilesets } from "./convert-tilesets";
import type { MzFormat, MzRawData, RmMap } from "./raw-types";

/** The converted Atlas database (M1·A slice). `system` is a `Partial` patch to
 *  overlay on `newProject().system` (A6); the rest are complete records. Maps +
 *  tilesets are added in M1·B; command bodies in M1·C. */
export interface MzDatabase {
  system: Partial<SystemData>;
  actors: Actor[];
  classes: ClassDef[];
  skills: Skill[];
  items: Item[];
  weapons: Weapon[];
  armors: Armor[];
  enemies: Enemy[];
  states: StateDef[];
  troops: Troop[];
  commonEvents: CommonEvent[];
}

export interface DatabaseConversion {
  format: MzFormat;
  db: MzDatabase;
  report: ImportReport;
  /** Index→key maps threaded to M1·B/M1·C (tile terrain tags, command operands). */
  elementKeyByIndex: string[];
  skillTypeKeyByIndex: string[];
}

/** Convert parsed RM data into Atlas DB records. `translate` (M1·C) fills
 *  command bodies; absent = structural shells with empty command lists. */
export function convertDatabase(
  raw: MzRawData,
  report: ImportReport = new ImportReport(),
  translate?: CommandTranslator,
): DatabaseConversion {
  const sys = convertSystem(raw.system, report);
  const classes = convertClasses(raw.classes, report, sys.elementKeyByIndex);
  // Actors must convert AFTER classes — actor traits merge onto the class (D6).
  const actors = convertActors(raw.actors, classes, report, sys.elementKeyByIndex);
  const skills = convertSkills(raw.skills, report, sys.elementKeyByIndex, sys.skillTypeKeyByIndex);
  const items = convertItems(raw.items, report);
  const weapons = convertWeapons(raw.weapons, report);
  const armors = convertArmors(raw.armors, report);
  const enemies = convertEnemies(raw.enemies, report);
  const states = convertStates(raw.states, report);
  const commonEvents = convertCommonEvents(raw.commonEvents, report, translate);
  const troops = convertTroops(raw.troops, report, translate);

  return {
    format: raw.format,
    db: { system: sys.system, actors, classes, skills, items, weapons, armors, enemies, states, troops, commonEvents },
    report,
    elementKeyByIndex: sys.elementKeyByIndex,
    skillTypeKeyByIndex: sys.skillTypeKeyByIndex,
  };
}

export interface MzImportResult extends DatabaseConversion {
  /** The parsed raw data (assets/plugins/format) for M1·B+ to keep converting. */
  raw: MzRawData;
}

/** End-to-end: intake → sniff → parse → convert database. */
export async function importMzDatabase(
  source: MzFileSource,
  translate?: CommandTranslator,
): Promise<MzImportResult> {
  const report = new ImportReport();
  const raw = await readRawProject(source, report);
  const conv = convertDatabase(raw, report, translate);
  return { ...conv, raw };
}

/** The converted project (M1·B slice): the M1·A database plus maps, tilesets,
 *  autotile groups, synthesized map folders, and the `project.assets.tiles`
 *  id-map that couples this step's map layers to M1·D's real tile slicing. */
export interface MzProjectConversion extends DatabaseConversion {
  maps: GameMap[];
  autotiles: Autotile[];
  tilesets: Tileset[];
  mapFolders: MapFolder[];
  /** `project.assets.tiles` seed — stable `asset:tilesets/…` key → Atlas id. */
  assetTiles: Record<string, number>;
}

/** Convert database + tilesets + maps in one pass over the parsed raw data.
 *  `translate` (M1·C) fills event/command bodies; absent = structural shells. */
export function convertProject(
  raw: MzRawData,
  report: ImportReport = new ImportReport(),
  translate?: CommandTranslator,
): MzProjectConversion {
  const dbConv = convertDatabase(raw, report, translate);
  const rawMaps = raw.maps || [];
  const usage = collectTilesetUsage(rawMaps);
  const ts = convertTilesets(raw.tilesets || [], usage, report);
  const rawById = new Map<number, RmMap>(rawMaps.map((m) => [m.id ?? 0, m]));
  const { maps, folders } = convertMaps(raw.mapInfos || [], rawById, ts, report);
  return {
    ...dbConv,
    report,
    maps,
    autotiles: ts.autotiles,
    tilesets: ts.tilesets,
    mapFolders: folders,
    assetTiles: ts.assetTiles,
  };
}

export interface MzProjectResult extends MzProjectConversion {
  raw: MzRawData;
}

/** End-to-end: intake → sniff → parse → convert database + tilesets + maps. */
export async function importMzProject(
  source: MzFileSource,
  translate?: CommandTranslator,
): Promise<MzProjectResult> {
  const report = new ImportReport();
  const raw = await readRawProject(source, report);
  const conv = convertProject(raw, report, translate);
  return { ...conv, raw };
}

// Re-exports (the module's public API).
export { ImportReport } from "./report";
export type { ReportLine, ReportKind } from "./report";
export { sniffFormat } from "./sniff";
export type { SniffInput, SniffResult } from "./sniff";
export {
  decryptAsset,
  encryptAsset,
  parseEncryptionKey,
  isEncryptedAssetPath,
  restoredPath,
  ENC_HEADER,
} from "./decrypt";
export {
  objectSource,
  fileListSource,
  fsSource,
  readRawProject,
  parsePluginsJs,
} from "./intake";
export type { MzFileSource, FsReadFns } from "./intake";
export type { CommandTranslator } from "./convert-events";
export type { MzFormat, MzRawData } from "./raw-types";
export {
  decodeRmTileId,
  decodeFlags,
  isRmAutotile,
  autotileKind,
  familyOfKind,
  TID,
} from "./tile-ids";
export { convertTilesets, IMPORT_TILE_BASE } from "./convert-tilesets";
export type { TilesetsConversion, TilesetUsage } from "./convert-tilesets";
export { collectTilesetUsage, convertMap, convertMapData, convertMaps, MAX_REGION } from "./convert-maps";
export { assembleProject } from "./assemble";
