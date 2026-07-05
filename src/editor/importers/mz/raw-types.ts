/* RPGAtlas — src/editor/importers/mz/raw-types.ts
   Project Compass (MZ/MV importer) M1·A: the INPUT shapes — the subset of RPG
   Maker MV 1.6 / MZ 1.x `data/*.json` fields the importer reads. Fields are
   optional/loose on purpose: MV and MZ differ (Animations model, plugin-command
   code, System extras), real projects carry plugin-injected junk, and the
   converters read defensively. See docs/mz-mv-parity-matrix.md for the mapping.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** "mv" = RPG Maker MV 1.6.x · "mz" = RPG Maker MZ 1.x. */
export type MzFormat = "mv" | "mz";

/** An RM audio reference ({name,volume,pitch,pan}). */
export interface RmAudio {
  name: string;
  volume?: number;
  pitch?: number;
  pan?: number;
}

/** One trait row (`{code,dataId,value}`) on a class/actor/weapon/armor/enemy/state. */
export interface RmTrait {
  code: number;
  dataId: number;
  value: number;
}

/** One item/skill effect (`{code,dataId,value1,value2}`). */
export interface RmEffect {
  code: number;
  dataId: number;
  value1: number;
  value2: number;
}

/** A damage object (`data.damage`). */
export interface RmDamage {
  /** 0 none · 1 HP dmg · 2 MP dmg · 3 HP rec · 4 MP rec · 5 HP drain · 6 MP drain. */
  type: number;
  /** -1 normal-attack element · 0 none · n element index. */
  elementId: number;
  formula: string;
  variance: number;
  critical: boolean;
}

/** One event/troop-page/common-event list command (`{code,indent,parameters}`). */
export interface RmCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

export interface RmVehicle {
  characterName: string;
  characterIndex: number;
  bgm?: RmAudio;
  startMapId: number;
  startX: number;
  startY: number;
}

/** RPG Maker `data/System.json` (the fields the importer reads; MZ-only fields
 *  are optional). */
export interface RmSystem {
  gameTitle?: string;
  versionId?: number;
  currencyUnit?: string;
  /** Index-keyed name lists; index 0 is a leading placeholder ("" / null). */
  elements?: string[];
  skillTypes?: string[];
  weaponTypes?: string[];
  armorTypes?: string[];
  equipTypes?: string[];
  switches?: string[];
  variables?: string[];
  partyMembers?: number[];
  boat?: RmVehicle;
  ship?: RmVehicle;
  airship?: RmVehicle;
  titleBgm?: RmAudio;
  battleBgm?: RmAudio;
  victoryMe?: RmAudio;
  defeatMe?: RmAudio;
  gameoverMe?: RmAudio;
  sounds?: RmAudio[];
  title1Name?: string;
  title2Name?: string;
  terms?: {
    basic?: (string | null)[];
    params?: (string | null)[];
    commands?: (string | null)[];
    messages?: Record<string, string>;
  };
  startMapId?: number;
  startX?: number;
  startY?: number;
  optTransparent?: boolean;
  optFollowers?: boolean;
  optSideView?: boolean;
  optDisplayTp?: boolean;
  optDrawTitle?: boolean;
  optExtraExp?: boolean;
  optFloorDeath?: boolean;
  optSlipDeath?: boolean;
  battleback1Name?: string;
  battleback2Name?: string;
  windowTone?: number[];
  battleSystem?: number;
  hasEncryptedImages?: boolean;
  hasEncryptedAudio?: boolean;
  encryptionKey?: string;
  editMapId?: number;
  // ---- MZ-only ----
  locale?: string;
  tileSize?: number;
  optAutosave?: boolean;
  optKeyItemsNumber?: boolean;
  itemCategories?: boolean[];
  menuCommands?: boolean[];
  advanced?: {
    gameId?: number;
    screenWidth?: number;
    screenHeight?: number;
    uiAreaWidth?: number;
    uiAreaHeight?: number;
    numberFontFilename?: string;
    fallbackFonts?: string;
    fontSize?: number;
    mainFontFilename?: string;
    windowOpacity?: number;
  };
  [k: string]: unknown;
}

export interface RmActor {
  id: number;
  name: string;
  nickname?: string;
  classId: number;
  initialLevel?: number;
  maxLevel?: number;
  characterName?: string;
  characterIndex?: number;
  faceName?: string;
  faceIndex?: number;
  battlerName?: string;
  equips?: number[];
  traits?: RmTrait[];
  profile?: string;
  note?: string;
}

export interface RmClass {
  id: number;
  name: string;
  expParams?: number[];
  /** `params[paramIndex][level]` — 8 params × 100 levels (index 0 unused). */
  params?: number[][];
  learnings?: { level: number; skillId: number; note?: string }[];
  traits?: RmTrait[];
  note?: string;
}

export interface RmSkill {
  id: number;
  name: string;
  iconIndex?: number;
  stypeId?: number;
  mpCost?: number;
  tpCost?: number;
  scope?: number;
  occasion?: number;
  damage?: RmDamage;
  effects?: RmEffect[];
  animationId?: number;
  repeats?: number;
  message1?: string;
  message2?: string;
  requiredWtypeId1?: number;
  requiredWtypeId2?: number;
  note?: string;
}

export interface RmItem {
  id: number;
  name: string;
  iconIndex?: number;
  description?: string;
  itypeId?: number;
  price?: number;
  consumable?: boolean;
  scope?: number;
  occasion?: number;
  damage?: RmDamage;
  effects?: RmEffect[];
  animationId?: number;
  repeats?: number;
  note?: string;
}

export interface RmWeapon {
  id: number;
  name: string;
  iconIndex?: number;
  description?: string;
  wtypeId?: number;
  price?: number;
  etypeId?: number;
  animationId?: number;
  params?: number[];
  traits?: RmTrait[];
  note?: string;
}

export interface RmArmor {
  id: number;
  name: string;
  iconIndex?: number;
  description?: string;
  atypeId?: number;
  etypeId?: number;
  price?: number;
  params?: number[];
  traits?: RmTrait[];
  note?: string;
}

export interface RmEnemyAction {
  skillId: number;
  conditionType: number;
  conditionParam1: number;
  conditionParam2: number;
  rating: number;
}

export interface RmEnemy {
  id: number;
  name: string;
  battlerName?: string;
  battlerHue?: number;
  params?: number[];
  exp?: number;
  gold?: number;
  dropItems?: { kind: number; dataId: number; denominator: number }[];
  actions?: RmEnemyAction[];
  traits?: RmTrait[];
  note?: string;
}

/** A troop page's condition block (RM's flat boolean+value shape). */
export interface RmTroopPageConditions {
  turnEnding?: boolean;
  turnValid?: boolean;
  turnA?: number;
  turnB?: number;
  enemyValid?: boolean;
  enemyIndex?: number;
  enemyHp?: number;
  actorValid?: boolean;
  actorId?: number;
  actorHp?: number;
  switchValid?: boolean;
  switchId?: number;
}

export interface RmTroopPage {
  conditions: RmTroopPageConditions;
  /** 0 battle · 1 turn · 2 moment. */
  span: number;
  list: RmCommand[];
}

export interface RmTroop {
  id: number;
  name: string;
  members?: { enemyId: number; x: number; y: number; hidden: boolean }[];
  pages?: RmTroopPage[];
}

export interface RmState {
  id: number;
  name: string;
  iconIndex?: number;
  restriction?: number;
  priority?: number;
  motion?: number;
  overlay?: number;
  removeAtBattleEnd?: boolean;
  removeByRestriction?: boolean;
  autoRemovalTiming?: number;
  minTurns?: number;
  maxTurns?: number;
  removeByDamage?: boolean;
  chanceByDamage?: number;
  removeByWalking?: boolean;
  stepsToRemove?: number;
  traits?: RmTrait[];
  note?: string;
}

export interface RmCommonEvent {
  id: number;
  name: string;
  /** 0 none · 1 autorun · 2 parallel. */
  trigger: number;
  switchId: number;
  list: RmCommand[];
}

export interface RmPlugin {
  name: string;
  status: boolean;
  description?: string;
  parameters?: Record<string, string>;
}

/** `data/Tilesets.json` entry (matrix §11). `flags[tileId]` packs per-tile
 *  passage/★/ladder/bush/counter/damage/terrain-tag; `tilesetNames` are the
 *  A1–A5 + B–E source-image names the M1·D wizard slices. */
export interface RmTileset {
  id: number;
  name: string;
  mode?: number;
  note?: string;
  tilesetNames?: string[];
  flags?: number[];
}

/** `data/MapInfos.json` entry — the map tree (matrix §MapInfos / decision D8). */
export interface RmMapInfo {
  id: number;
  name: string;
  order?: number;
  parentId?: number;
  expanded?: boolean;
  scrollX?: number;
  scrollY?: number;
}

/** One `encounterList[]` entry on a map. */
export interface RmEncounter {
  troopId: number;
  weight?: number;
  regionSet?: number[];
}

/** `data/Map###.json` (the fields the map converter reads; events are M1·C).
 *  `id` is injected from the filename (`Map001` → 1) at intake — RM's map files
 *  don't carry their own id. `data` is the flat `w·h·6` plane array. */
export interface RmMap {
  id?: number;
  width: number;
  height: number;
  tilesetId?: number;
  data?: number[];
  note?: string;
  displayName?: string;
  autoplayBgm?: boolean;
  bgm?: RmAudio;
  autoplayBgs?: boolean;
  bgs?: RmAudio;
  encounterList?: RmEncounter[];
  encounterStep?: number;
  parallaxName?: string;
  scrollType?: number;
  specifyBattleback?: boolean;
  battleback1Name?: string;
  battleback2Name?: string;
  disableDashing?: boolean;
  events?: unknown[];
  [k: string]: unknown;
}

/** RM data arrays are 1-based with a leading `null` at index 0. */
export type RmList<T> = (T | null)[];

/** The parsed `data/*.json` set the importer reads. Maps + tilesets load in
 *  M1·B; this is the M1·A (database) surface plus the marker/plugins metadata. */
export interface MzRawData {
  format: MzFormat;
  system: RmSystem;
  actors: RmList<RmActor>;
  classes: RmList<RmClass>;
  skills: RmList<RmSkill>;
  items: RmList<RmItem>;
  weapons: RmList<RmWeapon>;
  armors: RmList<RmArmor>;
  enemies: RmList<RmEnemy>;
  troops: RmList<RmTroop>;
  states: RmList<RmState>;
  commonEvents: RmList<RmCommonEvent>;
  /** Tilesets + map tree + per-id map data (M1·B). Absent when the reader ran
   *  M1·A-only; the database converters never touch these. */
  tilesets?: RmList<RmTileset>;
  mapInfos?: RmList<RmMapInfo>;
  /** Loaded `Map###.json` bodies, each with its filename-derived `id`. */
  maps?: RmMap[];
  /** Present for reporting/plugins in later steps; unused by M1·A conversion. */
  plugins?: RmPlugin[];
  /** Relative asset paths discovered under img/ + audio/ (for M1·B/M4·B). */
  assetPaths?: string[];
}
