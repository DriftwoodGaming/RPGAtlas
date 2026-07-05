/* RPGAtlas — src/shared/schema.ts
   Typed project-document schema (Phase 1 Stage D). This file is the contract
   every later phase builds against: the full types are derived from js/data.js
   defaults + Atlas_Quest.json ground truth, with lightweight hand-rolled
   runtime guards used at project load/import boundaries only.

   Design notes:
   - The types describe the document as today's engine and editor actually read
     and write it. Where a field is optional in practice (author-set only, or
     backfilled by RA.migrateProject), it is optional here.
   - Fields the code reads with `|| default` or `== null` fallbacks are still
     typed as present-or-optional to match reality, never widened to `any`
     unless the underlying data genuinely has no fixed shape (tileProps maps,
     free-form asset blobs, plugin params).
   - The AnyCommand union enumerates every event command: the CMD_DEFS in
     src/editor/event-editor/command-defs.ts, which are exactly the types
     registered in src/engine/interpreter/commands/*.ts (43 as of Project
     Compass M2·A, which added the presentation family: pictures, tint, timer,
     scroll, balloons, scrolling text; M2·C added the actor-data family and
     M3·B the TP pair changeTp/changeEnemyTp) — plus `mzTodo`, the
     MZ/MV-importer placeholder (Project Compass M1·C): editor-rendered,
     preserved for re-import, and deliberately WITHOUT an interpreter handler
     so the engine silently skips it.
   - Guards WARN + pass through on unknown shapes; they never reject a project
     today's code accepts (behavior-frozen). See isProjectLike / assertProject.

   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================================
// Primitives / shared shapes
// ============================================================================

/** Facing direction: 0=down, 1=left, 2=right, 3=up (engine convention). */
export type Dir = 0 | 1 | 2 | 3;

/** Item bucket kind used across inventory, shop goods, change-items, etc. */
export type ItemKind = "item" | "weapon" | "armor";

/** The seven battle parameters keyed on class base/growth and equip params. */
export interface Params {
  mhp?: number;
  mmp?: number;
  atk?: number;
  def?: number;
  mat?: number;
  mdf?: number;
  agi?: number;
}

/** A class trait row (Database ▸ Classes). `key` is a string even when it
 *  logically references a numeric id (state id / equip id) — the migration
 *  stores it as `String(t.key)`. */
export interface Trait {
  type: "param" | "element" | "state" | "skill" | "equip" | "special";
  key: string;
  value: number;
}

// ============================================================================
// System / meta
// ============================================================================

export interface ProjectMeta {
  /** "rpgatlas" (current) or "driftwood" (pre-rebrand, adopted on migrate). */
  engine: "rpgatlas" | "driftwood";
  /** Legacy content version stamp (RA._migrateV0toV1 sets it to 3). */
  version?: number;
  /** True once the engine's bundled plugins have been seeded (one-time). */
  builtinsSeeded?: boolean;
  /** Integer schema version; missing == 0. Stamped to RA.FORMAT_VERSION. */
  formatVersion?: number;
}

/** Tiled-style user properties (Phase 8). Type is carried by the JS value. */
export type TypedProps = Record<string, string | number | boolean>;

/** A named type-list entry with a stable string key (elements, skillTypes). */
export interface KeyedType {
  key: string;
  name: string;
}
/** A named type-list entry with a numeric id (weapon/armor/equip types). */
export interface IdType {
  id: number;
  name: string;
}

export interface SystemTypes {
  elements: KeyedType[];
  skillTypes: KeyedType[];
  weaponTypes: IdType[];
  armorTypes: IdType[];
  equipTypes: IdType[];
}

/** Per-action binding arrays (KeyboardEvent.code / PAD_BUTTONS names). */
export interface InputBindings {
  keyboard: Record<string, string[]>;
  gamepad: Record<string, string[]>;
  stickDeadzone?: number;
}

/** Database ▸ System tab: presentation, party start, audio, input.
 *
 *  Fields below the party block are all backfilled by RA._migrateV0toV1 and
 *  set by DataDefaults.newProject, so they are present on ANY loaded project
 *  document (migration runs before the schema guard / any read). They are
 *  typed as required to match how the editor's System tab and the engine's
 *  applyScreenSettings actually consume them; a raw pre-migration blob is not
 *  a valid `SystemData` until migrateProject has run. */
export interface SystemData {
  title: string;
  startMapId: number;
  startX: number;
  startY: number;
  startDir: Dir;
  party: number[];
  startGold: number;
  currency: string;
  /** Parallel arrays: switch/variable display names (index = id - 1). */
  switches: string[];
  variables: string[];
  startTransparent: boolean;
  battleView: "side" | string;
  screenWidth: number;
  screenHeight: number;
  uiWidth: number;
  uiHeight: number;
  screenScale: number;
  fontText: string;
  fontMenu: string;
  fontSize: number;
  windowOpacity: number;
  windowColor: string;
  /** logical system-sound key -> procedural SE name. */
  sounds: Record<string, string>;
  /** logical music slot (title/battle/…) -> theme name. */
  music: Record<string, string>;
  types: SystemTypes;
  input: InputBindings;
  // ---- Phase 5 (all backfilled by the v2 migration) ----
  /** Battle scheduling mode. "turn" = the classic Phase 1 round loop. */
  battleSystem?: "turn" | "atb" | "ctb";
  /** ATB flavor (reserved; v1 always waits during command input). */
  atbWait?: boolean;
  /** Party followers trail the player on the map (Stage C). */
  followers?: boolean;
  /** Corner minimap in play (Stage D). */
  minimap?: boolean;
  /** Vehicle definitions (Stage C); an absent entry = vehicle unused. */
  vehicles?: {
    boat?: VehicleDef;
    ship?: VehicleDef;
    airship?: VehicleDef;
  };
  /** Show the TP gauge in battle (Project Compass M3·B, MZ optDisplayTp).
   *  Also one of the two switches that activate the TP mechanics — the other
   *  is any skill carrying tpCost/gainTp. Absent = classic no-TP battles. */
  displayTp?: boolean;
  /** RPG Maker battle pacing (Project Compass M3·C): preemptive/surprise
   *  rolls on random encounters and the MZ escape ratio (0.5 × party AGI /
   *  troop AGI, +0.1 per failed try). The importer always sets it; absent =
   *  the classic Atlas flow, byte-identical draws. */
  mzBattleFlow?: boolean;
}

/** One vehicle's charset + starting placement (Phase 5 Stage C). */
export interface VehicleDef {
  charset: string;
  mapId: number;
  x: number;
  y: number;
  music?: string;
}

// ============================================================================
// Database entities
// ============================================================================

export interface Actor {
  id: number;
  name: string;
  classId: number;
  level?: number;
  charset?: string;
  weaponId?: number;
  armorId?: number;
  icon?: number;
  /** Starting battle row (Phase 5). Absent = "front". */
  row?: "front" | "back";
}

export interface Learning {
  level: number;
  skillId: number;
}

export interface ClassDef {
  id: number;
  name: string;
  icon?: number;
  base: Params;
  growth: Params;
  traits: Trait[];
  learnings?: Learning[];
}

export type SkillScope = "enemy" | "enemies" | "ally" | "allies" | string;

export interface Skill {
  id: number;
  name: string;
  icon?: number;
  type: string; // skillType key: "phys" | "magic" | "heal" | custom
  power?: number;
  mp?: number;
  scope?: SkillScope;
  color?: string;
  element?: string;
  stateId?: number;
  stateChance?: number;
  stateOp?: "add" | "remove" | string;
  /** Battle animation played on use (Phase 5). Absent = the legacy
   *  castFx/travel/burst effects, byte-identical to Phase 4. */
  animationId?: number;
  /** Number of damage applications per use (Phase 5). Absent = 1. */
  hits?: number;
  /** Common event run after the skill resolves in battle (Phase 5) — the
   *  action-sequence escape hatch, graph-authorable. Absent/0 = none. */
  commonEventId?: number;
  /** Revive: a heal-type skill that can target fallen (0 HP) allies and
   *  brings them back to life (HP restored by the usual heal formula). Absent
   *  = false — ordinary heals never touch the fallen. */
  revive?: boolean;
  /** RPG Maker MZ/MV damage formula string (Project Compass, decision D1).
   *  Stored verbatim at import since M1·A; since M3·A the sandboxed evaluator
   *  (src/shared/formula.ts) runs it in battle — a compilable formula replaces
   *  the structured `power` curve; a rejected one falls back to it. Absent on
   *  Atlas-native skills unless authored in the editor's Advanced damage box. */
  formula?: string;
  /** MZ damage variance % (0–100), applied by the M3·A formula pipeline.
   *  Absent = 0 (the formula hits for exactly its value). */
  variance?: number;
  /** MZ "can critical" flag — a formula hit may crit (×3, MZ order) against
   *  the attacker's critChance trait sum. Absent = formula hits never crit. */
  critical?: boolean;
  /** MZ damage-type variants (M3·A): "mp" damages/heals MP instead of HP,
   *  "hpDrain"/"mpDrain" give the dealt amount to the attacker. Absent = HP. */
  dmgType?: "mp" | "hpDrain" | "mpDrain";
  /** Heals also restore this % of the target's max HP (MZ Recover-HP effect
   *  value1, M3·A). Absent = 0. */
  powerPct?: number;
  // ---- Project Compass M3·B (all optional — absent = classic behavior) ----
  /** Imported MZ skill-type key, kept when `type` was rewritten to "heal" so
   *  add/seal-type traits can still gate the skill (a sealed "Magic" must
   *  silence magic heals too). Gating reads `stype || type`. */
  stype?: string;
  /** TP cost (MZ). Only enforced while the project's TP system is active
   *  (see battle-logic tpActive) — never gates Atlas-native projects. */
  tpCost?: number;
  /** TP granted to the user on use (MZ effect 13 / tpGain). */
  gainTp?: number;
  /** MZ effect 21 dataId 0 ("normal attack"): landing hits also roll the
   *  attacker's on-attack state traits (`state`/`attack:<id>`). */
  attackStates?: boolean;
  /** MZ damage elementId −1: the hit uses the attacker's attack-element
   *  traits (MZ elementsMaxRate) instead of a fixed element. */
  attackElement?: boolean;
  /** Buff/debuff effects (MZ 31–34): each stat's buff level is −2…+2, ±25%
   *  per level, ticking down at round end and cleared after battle. */
  buffs?: BuffEffect[];
  /** Permanent stat growth on the target (MZ effect 42) — rides the same
   *  per-actor `paramPlus` bonus as the Change Parameters command. */
  grow?: GrowEffect[];
  /** Skills the target permanently learns (MZ effect 43). */
  learn?: number[];
  // ---- Project Compass M3·C ----
  /** MZ effect 41 (escape): a party member's use flees the whole battle; an
   *  enemy's use makes that one enemy flee (no rewards from it). */
  escapeBattle?: boolean;
}

/** One buff/debuff effect row (MZ effect codes 31–34, M3·B). */
export interface BuffEffect {
  /** Battle param key ("atk", "def", …). */
  stat: string;
  op: "buff" | "debuff" | "removeBuff" | "removeDebuff";
  /** Duration in rounds (add ops; MZ value1). */
  turns?: number;
}

/** One permanent-growth effect row (MZ effect 42, M3·B). */
export interface GrowEffect {
  stat: string;
  amount: number;
}

export interface StateDef {
  id: number;
  name: string;
  icon?: number;
  color?: string;
  restrict?: "none" | "act" | string;
  hpTurn?: number;
  minTurns?: number;
  maxTurns?: number;
  removeAtEnd?: boolean;
  // ---- Project Compass M3·B (all optional) ----
  /** Walk-off removal (MZ stepsToRemove/removeByWalking): the state falls off
   *  after this many map steps. Absent/0 = walking never cures it. */
  stepsToRemove?: number;
  /** Chance % (0–100) the state is shed when the battler takes HP damage
   *  (MZ removeByDamage + chanceByDamage). Absent = damage never cures it. */
  removeByDamage?: number;
  /** Shed when a restricting ("can't act") state lands on the battler. */
  removeByRestriction?: boolean;
  /** Trait rows active while the state is on the battler (MZ state traits —
   *  how Silence/Blind work). Joined with the class/enemy traits. */
  traits?: Trait[];
}

export interface Item {
  id: number;
  name: string;
  icon?: number;
  price?: number;
  hp?: number;
  mp?: number;
  desc?: string;
  /** Revive: an item that can only be used on a fallen (0 HP) ally, bringing
   *  them back to life with `hp` HP restored. Absent = false — ordinary
   *  restoratives never revive. */
  revive?: boolean;
  /** RPG Maker MZ/MV damage formula string (decision D1) — see
   *  `Skill.formula`. Since M3·A a compilable heal-type formula adds to the
   *  item's recovery (evaluated with a = b = target). */
  formula?: string;
  /** MZ damage variance % applied to the item's formula part (M3·A). */
  variance?: number;
  /** Also restores this % of the target's max HP / max MP (MZ Recover effect
   *  value1, M3·A). Absent = 0. */
  hpPct?: number;
  mpPct?: number;
  // ---- Project Compass M3·B (all optional) ----
  /** State add/remove on use (MZ item effects 21/22) — cures at last. Same
   *  vocabulary as the Skill fields. */
  stateId?: number;
  stateChance?: number;
  stateOp?: "add" | "remove" | string;
  /** TP granted to the user (MZ effect 13). */
  gainTp?: number;
  /** Buff/debuff effects (MZ 31–34). */
  buffs?: BuffEffect[];
  /** Permanent stat growth (MZ effect 42). */
  grow?: GrowEffect[];
  /** Skills the target learns (MZ effect 43). */
  learn?: number[];
  /** MZ effect 41 (escape, M3·C) — using it in battle flees the fight. */
  escapeBattle?: boolean;
}

export interface Weapon {
  id: number;
  name: string;
  icon?: number;
  price?: number;
  wtypeId?: number;
  params?: Params;
  /** Battle animation played on normal attacks (Phase 5). Absent = legacy FX. */
  animationId?: number;
}

export interface Armor {
  id: number;
  name: string;
  icon?: number;
  price?: number;
  atypeId?: number;
  etypeId?: number;
  params?: Params;
}

/** Condition gating one enemy action row (Phase 5; the M3·C kinds are the MZ
 *  refinements — MP, party level, switch). Absent = always valid —
 *  pre-Phase-5 action lists pick identically. */
export interface EnemyActionCond {
  kind:
    | "always" | "turn" | "hpBelow" | "hpAbove" | "random" | "stateSelf"
    | "mpBelow" | "partyLevel" | "switch" | string;
  /** turn: fires on turn a + b·x (b=0: exactly turn a).
   *  partyLevel: valid while the highest party level ≥ a (M3·C). */
  a?: number;
  b?: number;
  /** hpBelow/hpAbove/random/mpBelow: percentage 0–100. */
  pct?: number;
  /** stateSelf: the state that must be on this enemy. */
  stateId?: number;
  /** switch: the game switch that must be ON (M3·C). */
  switchId?: number;
}

export interface EnemyAction {
  skillId: number;
  weight: number;
  cond?: EnemyActionCond;
}

/** One victory-loot row (MZ dropItems, Project Compass M3·C): a 1-in-
 *  `denominator` chance the defeated enemy leaves this item behind. */
export interface EnemyDrop {
  kind: "item" | "weapon" | "armor" | string;
  id: number;
  denominator: number;
}

export interface Enemy {
  id: number;
  name: string;
  sprite?: string;
  color?: string;
  stats: Params;
  exp?: number;
  gold?: number;
  actions?: EnemyAction[];
  /** Trait rows (Project Compass M3·B) — enemies are their own effective
   *  battler (D6), so element/state rates and combat specials live here.
   *  Absent = the exact pre-M3·B neutral behavior. */
  traits?: Trait[];
  /** Victory loot (M3·C). Absent/empty = no drop rolls at all. */
  drops?: EnemyDrop[];
}

/** A troop battle-event page condition (Phase 5). An empty cond never fires. */
export interface TroopPageCond {
  /** Fires on turn a + b·x (b=0: exactly turn a). */
  turn?: { a: number; b: number };
  /** Troop-slot `index`'s HP fell to `pct`% or below. */
  enemyHpBelow?: { index: number; pct: number };
  /** Actor `actorId`'s HP fell to `pct`% or below. */
  actorHpBelow?: { actorId: number; pct: number };
  switchId?: number;
  /** MZ "Turn End" (M3·C): fires only on the end-of-round boundary check. */
  turnEnd?: boolean;
}

/** A troop battle-event page (Phase 5): commands run mid-battle through the
 *  ordinary interpreter while the loop pauses. span gates re-firing. */
export interface TroopPage {
  cond: TroopPageCond;
  span: "battle" | "turn" | "moment";
  commands: AnyCommand[];
}

export interface Troop {
  id: number;
  name: string;
  /** enemy ids composing the troop. */
  enemies: number[];
  /** Battle-event pages (Phase 5). Backfilled to [] by the v2 migration. */
  pages?: TroopPage[];
  /** 0-based member slots hidden at battle start (MZ `hidden`, M3·C) —
   *  revealed by the Enemy Appear command. Absent = everyone starts visible. */
  hiddenSlots?: number[];
}

// ============================================================================
// Battle animations (Phase 5 Stage A)
// ============================================================================

/** One timed effect on a battle animation's timeline. `at` is in engine ticks
 *  (1/60 s). Effect durations follow the unit conventions of what they drive:
 *  particle/flash/projectile/flipbook durations are in MILLISECONDS (the
 *  battle-fx Web-Animations convention), shake power/speed/duration match the
 *  `shake` event command (1–9 / 1–9 / frames). */
export interface AnimItem {
  /** Start tick (60/s) on the timeline. */
  at: number;
  type: "particles" | "flash" | "shake" | "sound" | "projectile" | "flipbook";
  /** particles/flash/projectile anchor override; absent = the animation's. */
  anchor?: "target" | "source" | "screen";
  // -- particles --
  /** battle-fx palette key (hit/crit/fire/ice/thunder/heal/poison/status/
   *  death/item/dust); empty + `color` = single-color burst. */
  kind?: string;
  color?: string;
  count?: number;
  radius?: number;
  size?: number;
  /** milliseconds (particles/flash/projectile/flipbook). */
  duration?: number;
  /** Emitter pattern. Default "burst" (the classic battle-fx radial). */
  shape?: "burst" | "ring" | "rain" | "spiral";
  // -- flash --
  opacity?: number; // 0..1
  // -- shake (same units as the `shake` command) --
  power?: number;
  speed?: number;
  // -- sound --
  se?: string;
  // -- projectile --
  /** Glow trail (default true). */
  trail?: boolean;
  // -- flipbook --
  /** "icons" (built-in icon strip), an "asset:characters/…" library sheet
   *  (Phase 6 importers), or an image URL/data URL sheet. */
  sheet?: string;
  cols?: number;
  rows?: number;
  from?: number;
  to?: number;
  fps?: number;
  scale?: number;
  /** Display-only record of the importer frame tag that filled from/to/fps
   *  (Phase 6); the runtime reads only the numeric range. */
  tag?: string;
}

/** A keyframed battle animation (Database ▸ Animations). Played over the
 *  battle window by skills/weapons (`animationId`) and on the map by the
 *  `playAnim` event command. */
export interface BattleAnimation {
  id: number;
  name: string;
  /** Default anchor for items without their own `anchor`. */
  target: "target" | "source" | "screen";
  items: AnimItem[];
}

// ============================================================================
// Quests (Database ▸ Quests; runtime in js/quests.js)
// ============================================================================

export type QuestStatus =
  | "inactive"
  | "active"
  | "completed"
  | "failed"
  | "abandoned";

export interface QuestObjective {
  kind: "event" | "fetch" | "kill" | string;
  label?: string;
  count?: number;
  enemyId?: number;
  itemKind?: ItemKind;
  id?: number;
  targetMapId?: number;
  targetEventId?: number;
  consumeOnComplete?: boolean;
}

export interface QuestReq {
  kind: "quest" | string;
  questId?: number;
  status?: QuestStatus;
}

export interface QuestFailCondition {
  kind: "manual" | "enemyDefeatCount" | string;
  id?: number;
  val?: boolean;
  cmp?: string;
  troopId?: number;
  enemyId?: number;
  count?: number;
}

export interface QuestReward {
  kind: "gold" | "exp" | "item" | string;
  amount?: number;
  itemKind?: ItemKind;
  id?: number;
  count?: number;
}

export interface QuestFailEffect {
  kind: "switch" | "questUnlock" | string;
  id?: number;
  val?: boolean | string;
  questId?: number;
}

export interface Quest {
  id: number;
  name: string;
  shortDesc?: string;
  desc?: string;
  category?: "side" | "main" | string;
  visible?: boolean;
  objectives: QuestObjective[];
  startReqs: QuestReq[];
  failConditions: QuestFailCondition[];
  rewards: QuestReward[];
  failEffects: QuestFailEffect[];
  failText?: string;
  nextQuestIds: number[];
  autoStartNext?: boolean;
  allowRestartOnFail?: boolean;
  canAbandon?: boolean;
}

// ============================================================================
// Event commands — the AnyCommand discriminated union (66 types + mzTodo)
// ============================================================================

/** Conditional-branch condition (the `if` command / quest requirements). */
export interface Condition {
  kind:
    | "switch"
    | "var"
    | "selfsw"
    | "quest"
    | "item"
    | "gold"
    | "actor"
    | string;
  id?: number;
  val?: boolean | number;
  cmp?: string;
  key?: string; // selfsw
  questId?: number;
  status?: QuestStatus;
  itemKind?: ItemKind;
  actorId?: number;
  check?: "inParty" | "weapon" | "armor" | string;
  itemId?: number;
  /** kind "time": clock window [from, to) in hours, wrap-around ok. */
  from?: number;
  to?: number;
}

export interface CmdText {
  t: "text";
  name?: string;
  face?: string;
  text: string;
  /** Window backdrop (Project Compass M2·B, RM 101): 0 window (default),
   *  1 dim, 2 transparent. Omitted = window. Additive/optional. */
  background?: number;
  /** Window position (RM 101): 0 top, 1 middle, 2 bottom (default). Omitted
   *  = bottom. Additive/optional. */
  position?: number;
}
export interface CmdChoices {
  t: "choices";
  options: string[];
  branches: AnyCommand[][];
}
export interface CmdIf {
  t: "if";
  cond: Condition;
  then: AnyCommand[];
  else: AnyCommand[];
}
export interface CmdQuestStart {
  t: "questStart";
  questId: number;
}
export interface CmdQuestAdvanceObj {
  t: "questAdvanceObj";
  questId: number;
  objIndex: number;
  amount?: number;
}
export interface CmdQuestSetObj {
  t: "questSetObj";
  questId: number;
  objIndex: number;
  value?: number;
}
export interface CmdQuestComplete {
  t: "questComplete";
  questId: number;
}
export interface CmdQuestFail {
  t: "questFail";
  questId: number;
}
export interface CmdCommonEvent {
  t: "commonEvent";
  commonEventId: number;
}
export interface CmdSwitch {
  t: "switch";
  id: number;
  val: boolean;
}
export interface CmdSelfSw {
  t: "selfsw";
  key: string;
  val: boolean;
}
export interface CmdVar {
  t: "var";
  id: number;
  op: "set" | "add" | "sub" | "rnd";
  val: number;
  val2?: number;
}
export interface CmdTransfer {
  t: "transfer";
  mapId: number;
  x: number;
  y: number;
  dir?: Dir;
}
export interface CmdGold {
  t: "gold";
  op: "add" | "sub";
  val: number;
}
export interface CmdItem {
  t: "item";
  kind: ItemKind;
  id: number;
  op: "add" | "sub";
  val: number;
}
export interface CmdParty {
  t: "party";
  op: "add" | "remove";
  actorId: number;
}
export interface CmdHeal {
  t: "heal";
  full?: boolean;
  hp?: number;
  mp?: number;
}
export interface CmdBattle {
  t: "battle";
  troopId: number;
  escape?: boolean;
  lose?: boolean;
  /** Battle-result branches (RM 601/602/603, Project Compass M3·C). Absent =
   *  the classic flow (win continues, loss game-overs unless `lose`).
   *  `onLose` runs only when `lose` is set, exactly like RM's Can Lose. */
  onWin?: AnyCommand[];
  onEscape?: AnyCommand[];
  onLose?: AnyCommand[];
}
export interface ShopGood {
  kind: ItemKind;
  id: number;
}
export interface CmdShop {
  t: "shop";
  goods: ShopGood[];
}
export interface CmdWait {
  t: "wait";
  frames: number;
}
export interface CmdSe {
  t: "se";
  /** Procedural SE name, or an "asset:audio/…" library key (Phase 6). */
  name: string;
  /** Positional playback origin (Phase 6): "event" pans/attenuates an
   *  imported SE by the firing event's offset from the player. Absent =
   *  centered, exactly as before. */
  at?: "event" | "player";
}
export interface CmdMusic {
  t: "music";
  /** Procedural theme, "none", or an "asset:audio/…" key (Phase 6). */
  theme: string;
  /** Streamed-BGM crossfade length, ms (Phase 6; default 800). */
  fadeMs?: number;
}
export interface CmdMove {
  t: "move";
  target: "this" | "player";
  steps: string[];
  wait?: boolean;
}
export interface CmdCameraZoom {
  t: "cameraZoom";
  zoom: number;
  frames: number;
}
export interface CmdTransparency {
  t: "transparency";
  val: boolean;
}
export interface CmdShake {
  t: "shake";
  power: number;
  speed: number;
  duration: number;
  wait?: boolean;
}
export interface CmdWeather {
  t: "weather";
  kind: "none" | "rain" | "storm" | "snow" | "fog" | string;
  power: number;
}
export interface CmdFlash {
  t: "flash";
  color: string;
  opacity: number;
  duration: number;
  wait?: boolean;
}
export interface CmdErase {
  t: "erase";
}
export interface CmdSave {
  t: "save";
}
export interface CmdGameover {
  t: "gameover";
}
export interface CmdToTitle {
  t: "totitle";
}
export interface CmdScript {
  t: "script";
  code: string;
}
/** Repeats `body` until a breakLoop command unwinds it (Phase 4). The
 *  interpreter awaits one frame every 1000 iterations so a wait-less loop
 *  can never freeze the tab. */
export interface CmdLoop {
  t: "loop";
  body: AnyCommand[];
}
/** Breaks out of the innermost enclosing loop (Phase 4). Outside a loop it
 *  ends the current command-list run (editor validation flags this). */
export interface CmdBreakLoop {
  t: "breakLoop";
}
/** Plays a battle animation on the map (Phase 5): over the player, this
 *  event, or the screen center. A no-op outside the map scene or when the
 *  animation id doesn't resolve. Target "enemy" (M3·C, RM Show Battle
 *  Animation 337) plays over troop slot `enemyIndex` (−1 = every living
 *  enemy) through the battle bridge; a no-op outside battle. */
export interface CmdPlayAnim {
  t: "playAnim";
  animationId: number;
  target: "player" | "this" | "screen" | "enemy";
  wait?: boolean;
  enemyIndex?: number;
}
/** An RPG Maker MZ/MV command the importer couldn't translate yet (Project
 *  Compass, M1·C). `code`+`params` preserve the raw MZ command verbatim so a
 *  re-import after a later phase ships upgrades it in place; `label` is the
 *  kid-friendly summary the event editor shows ("Show a picture — coming in a
 *  later update"). Additive + optional (FORMAT_VERSION stays 2). It has NO
 *  registered interpreter handler, so the engine silently skips it (the
 *  registry's unknown-type default) — it never changes play behavior. */
export interface CmdMzTodo {
  t: "mzTodo";
  code: number;
  params: unknown[];
  label: string;
}

// --- Presentation commands (Project Compass, M2·A) ---------------------------
// The on-screen presentation family: pictures, screen tint, timer, map scroll,
// balloon icons, scrolling text. All additive/optional — old projects never see
// them. A screen colour tone is [red, green, blue, gray]: r/g/b in -255..255,
// gray 0..255 (RM's Tone). Picture `name` is an "asset:*" key OR a direct image
// URL/data-URL (see presentation-runtime.resolvePictureSrc). `blend` maps to a
// canvas composite: 0 normal, 1 add, 2 multiply, 3 screen.

/** Show a picture in numbered slot `id` (1–100). `origin` 0 = upper-left,
 *  1 = centered; `x`/`y` are screen pixels; `scaleX`/`scaleY` are percent
 *  (100 = 1:1); `opacity` 0–255. */
export interface CmdShowPic {
  t: "showPic";
  id: number;
  name: string;
  origin: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blend: number;
}
/** Tween a shown picture's position/scale/opacity/blend/origin over `frames`. */
export interface CmdMovePic {
  t: "movePic";
  id: number;
  origin: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blend: number;
  frames: number;
  wait?: boolean;
}
/** Spin a shown picture at `speed` degrees per tick (RM Rotate Picture). */
export interface CmdRotatePic {
  t: "rotatePic";
  id: number;
  speed: number;
}
/** Tween a shown picture's colour tone over `frames`. */
export interface CmdTintPic {
  t: "tintPic";
  id: number;
  tone: [number, number, number, number];
  frames: number;
  wait?: boolean;
}
/** Remove picture slot `id`. */
export interface CmdErasePic {
  t: "erasePic";
  id: number;
}
/** Tween the whole-screen colour tone over `frames` (RM Tint / Fadeout /
 *  Fadein Screen). Fade-out is tone → black, fade-in is tone → normal. */
export interface CmdTint {
  t: "tint";
  tone: [number, number, number, number];
  frames: number;
  wait?: boolean;
}
/** Start or stop the count-down timer. `seconds` seeds a start; `common` is an
 *  optional common-event id fired when the timer reaches 0 (Atlas nicety; the
 *  importer never sets it). */
export interface CmdTimer {
  t: "timer";
  op: "start" | "stop";
  seconds?: number;
  common?: number;
}
/** Scroll the map camera `distance` tiles in `dir` at `speed` (1–6). Always
 *  waits for the scroll to finish (RM's scroll wait-mode). */
export interface CmdScrollMap {
  t: "scrollMap";
  dir: "up" | "down" | "left" | "right";
  distance: number;
  speed: number;
  wait?: boolean;
}
/** Pop a speech-balloon glyph (`balloonId` 1–15) over a target: "player",
 *  "this" event, or an event id. */
export interface CmdBalloon {
  t: "balloon";
  target: "player" | "this" | number;
  balloonId: number;
  wait?: boolean;
}
/** Full-screen scrolling text (credits-style). `speed` 1–8; `noFast` disables
 *  the hold-to-speed-up. */
export interface CmdScrollText {
  t: "scrollText";
  text: string;
  speed: number;
  noFast?: boolean;
}

// --- Message-system input scenes (Project Compass, M2·B) ---------------------
// The three player-input scenes RM offers alongside Show Text. All additive /
// optional (FORMAT_VERSION stays 2) — old projects never see them.

/** Ask the player to type a number into variable `varId` (RM Input Number).
 *  `digits` is the number of digit columns (1–8). */
export interface CmdInputNumber {
  t: "inputNumber";
  varId: number;
  digits: number;
}
/** Let the player pick one of the party's items; its id is stored in variable
 *  `varId` (0 when cancelled). `itemType` mirrors RM's category param (kept for
 *  round-trip fidelity; Atlas lists the party's regular items). */
export interface CmdSelectItem {
  t: "selectItem";
  varId: number;
  itemType?: number;
}
/** Open the on-screen keyboard so the player renames party actor `actorId`
 *  (RM Name Input Processing). `maxChars` caps the length (1–16). */
export interface CmdNameInput {
  t: "nameInput";
  actorId: number;
  maxChars: number;
}

// --- Actor/party data, flow labels, system toggles (Project Compass, M2·C) ---
// The "change actor data" family, jump labels, and the map-system access
// toggles RM offers. All additive / optional (FORMAT_VERSION stays 2) — old
// projects never see them. `actorId` 0 means "the whole party" (RM's "Entire
// Party" option) for the commands that support it (exp/level/param/skill/state);
// name/class/nickname/profile/image/equip always target one actor.

/** A named jump target (RM Label). A no-op on its own — `jump` seeks it. */
export interface CmdLabel { t: "label"; name: string; }
/** Jump to the matching `label` in the same command list (RM Jump to Label). */
export interface CmdJump { t: "jump"; name: string; }

/** Add/subtract experience (RM Change EXP). Levels rise as EXP crosses each
 *  curve threshold, learning class skills along the way. */
export interface CmdChangeExp { t: "changeExp"; actorId: number; op: "add" | "sub"; value: number; }
/** Add/subtract levels (RM Change Level). EXP snaps to the new level's floor. */
export interface CmdChangeLevel { t: "changeLevel"; actorId: number; op: "add" | "sub"; value: number; }
/** Add/subtract a permanent bonus to one base parameter (RM Change Parameters).
 *  `param` is an Atlas param key (mhp/mmp/atk/def/mat/mdf/agi). */
export interface CmdChangeParam { t: "changeParam"; actorId: number; param: string; op: "add" | "sub"; value: number; }
/** Teach or remove a skill (RM Change Skills). Stored as an extra learned skill
 *  (learn) or a suppression of an otherwise-known one (forget). */
export interface CmdChangeSkill { t: "changeSkill"; actorId: number; op: "learn" | "forget"; skillId: number; }
/** Force-equip a weapon or armor (RM Change Equipment). itemId 0 unequips. */
export interface CmdChangeEquip { t: "changeEquip"; actorId: number; slot: "weapon" | "armor"; itemId: number; }
/** Rename an actor (RM Change Name). */
export interface CmdChangeName { t: "changeName"; actorId: number; name: string; }
/** Change an actor's class (RM Change Class); HP/MP are re-clamped after. */
export interface CmdChangeClass { t: "changeClass"; actorId: number; classId: number; }
/** Swap an actor's map/face charset (RM Change Actor Images; Atlas faces derive
 *  from the charset). */
export interface CmdChangeActorImage { t: "changeActorImage"; actorId: number; charset: string; }
/** Set an actor's nickname (RM Change Nickname). Stored on the party member. */
export interface CmdChangeNickname { t: "changeNickname"; actorId: number; nickname: string; }
/** Set an actor's profile text (RM Change Profile). Stored on the party member. */
export interface CmdChangeProfile { t: "changeProfile"; actorId: number; profile: string; }
/** Add or remove a state outside battle (RM Change State). */
export interface CmdChangeState { t: "changeState"; actorId: number; op: "add" | "remove"; stateId: number; }
/** Add/subtract TP (RM Change TP, Project Compass M3·B). Works anywhere;
 *  only meaningful while the project's TP system is active. */
export interface CmdChangeTp { t: "changeTp"; actorId: number; op: "add" | "sub"; value: number; }
/** Add/subtract a troop member's TP mid-battle (RM Change Enemy TP, M3·B).
 *  `enemyIndex` is the 0-based troop slot; −1 = the whole troop. No-ops
 *  outside battle (reaches the live battle through the battle bridge). */
export interface CmdChangeEnemyTp { t: "changeEnemyTp"; enemyIndex: number; op: "add" | "sub"; value: number; }

// --- In-troop battle commands (RM 331–340, Project Compass M3·C) ---
// All reach the live battle through the battle bridge (like changeEnemyTp)
// and no-op outside battle. `enemyIndex` −1 = the whole troop.

/** Add/subtract a troop member's HP (RM Change Enemy HP). Without `allowKo`
 *  the value stops at 1 HP, exactly like RM's Allow Knockout box. */
export interface CmdChangeEnemyHp { t: "changeEnemyHp"; enemyIndex: number; op: "add" | "sub"; value: number; allowKo?: boolean; }
/** Add/subtract a troop member's MP (RM Change Enemy MP). */
export interface CmdChangeEnemyMp { t: "changeEnemyMp"; enemyIndex: number; op: "add" | "sub"; value: number; }
/** Add or remove a troop member's state (RM Change Enemy State). */
export interface CmdChangeEnemyState { t: "changeEnemyState"; enemyIndex: number; op: "add" | "remove"; stateId: number; }
/** Fully heal troop member(s) (RM Enemy Recover All). */
export interface CmdEnemyRecoverAll { t: "enemyRecoverAll"; enemyIndex: number; }
/** Reveal a hidden troop member (RM Enemy Appear — pairs with
 *  `Troop.hiddenSlots`). */
export interface CmdEnemyAppear { t: "enemyAppear"; enemyIndex: number; }
/** Transform a troop member into another enemy record (RM Enemy Transform).
 *  HP/MP carry over (clamped); states and buffs stay. */
export interface CmdEnemyTransform { t: "enemyTransform"; enemyIndex: number; enemyId: number; }
/** Make a battler act immediately, costs skipped (RM Force Action). `side`
 *  "enemy" indexes the troop; "actor" is an actor id. `target` is a troop/
 *  party slot for actor-side actions (−1/−2 = the engine picks, like RM's
 *  random/last target). */
export interface CmdForceAction { t: "forceAction"; side: "enemy" | "actor"; index: number; skillId: number; target: number; }
/** End the battle immediately as an escape (RM Abort Battle). */
export interface CmdAbortBattle { t: "abortBattle"; }

/** Toggle a map-system access flag (RM Change Menu/Save/Encounter/Formation
 *  Access). `enabled` false locks the menu, its save/formation entry, or the
 *  random-encounter roll respectively. Round-trips through saves. */
export interface CmdAccess { t: "access"; kind: "menu" | "save" | "encounter" | "formation"; enabled: boolean; }
/** Show or hide the follower trail (RM Change Player Followers). */
export interface CmdFollowers { t: "followers"; show: boolean; }
/** Recolour the message/menu windows live (RM Change Window Color). `tone` is
 *  an [r,g,b] 0–255 base colour; round-trips through saves. */
export interface CmdWindowTone { t: "windowTone"; tone: [number, number, number]; }
/** Read map info at a tile into a variable (RM Get Location Info). `infoType`:
 *  region / terrain tag / event id at the tile / tile id (best-effort). */
export interface CmdGetLocationInfo { t: "getLocationInfo"; varId: number; infoType: "terrain" | "eventId" | "tileId" | "region"; x: number; y: number; }

/** Every built-in event command, discriminated on `t`. Plugin commands add
 *  further `t` values at runtime via the interpreter registry; those aren't in
 *  this union, so widen with `AnyCommand | { t: string; [k: string]: any }` at
 *  a plugin-command boundary if needed. */
export type AnyCommand =
  | CmdText
  | CmdChoices
  | CmdIf
  | CmdQuestStart
  | CmdQuestAdvanceObj
  | CmdQuestSetObj
  | CmdQuestComplete
  | CmdQuestFail
  | CmdCommonEvent
  | CmdSwitch
  | CmdSelfSw
  | CmdVar
  | CmdTransfer
  | CmdGold
  | CmdItem
  | CmdParty
  | CmdHeal
  | CmdBattle
  | CmdShop
  | CmdWait
  | CmdSe
  | CmdMusic
  | CmdMove
  | CmdCameraZoom
  | CmdTransparency
  | CmdShake
  | CmdWeather
  | CmdFlash
  | CmdErase
  | CmdSave
  | CmdGameover
  | CmdToTitle
  | CmdScript
  | CmdLoop
  | CmdBreakLoop
  | CmdPlayAnim
  | CmdShowPic
  | CmdMovePic
  | CmdRotatePic
  | CmdTintPic
  | CmdErasePic
  | CmdTint
  | CmdTimer
  | CmdScrollMap
  | CmdBalloon
  | CmdScrollText
  | CmdInputNumber
  | CmdSelectItem
  | CmdNameInput
  | CmdLabel
  | CmdJump
  | CmdChangeExp
  | CmdChangeLevel
  | CmdChangeParam
  | CmdChangeSkill
  | CmdChangeEquip
  | CmdChangeName
  | CmdChangeClass
  | CmdChangeActorImage
  | CmdChangeNickname
  | CmdChangeProfile
  | CmdChangeState
  | CmdChangeTp
  | CmdChangeEnemyTp
  | CmdChangeEnemyHp
  | CmdChangeEnemyMp
  | CmdChangeEnemyState
  | CmdEnemyRecoverAll
  | CmdEnemyAppear
  | CmdEnemyTransform
  | CmdForceAction
  | CmdAbortBattle
  | CmdAccess
  | CmdFollowers
  | CmdWindowTone
  | CmdGetLocationInfo
  | CmdMzTodo;

/** The `t` discriminant of any built-in command. */
export type CommandType = AnyCommand["t"];

// ============================================================================
// Maps / events / pages
// ============================================================================

export interface EventPageCondition {
  switchId?: number;
  varId?: number;
  varVal?: number;
  selfSw?: string;
  questId?: number;
  questStatus?: QuestStatus;
  objectiveQuestId?: number;
  objectiveIndex?: number;
  objectiveStatus?: QuestStatus;
  /** In-game clock band gate (Phase 5): the page is active only during this
   *  band (morning 5–10, day 10–17, evening 17–21, night 21–5). */
  timeBand?: "morning" | "day" | "evening" | "night" | "";
}

export interface ActionCombat {
  enabled: boolean;
  enemyId: number;
  ai: "none" | "chase" | string;
  hp: number;
  touchDamage: number;
  knockbackTiles: number;
  invulnFrames: number;
  defeatSelfSwitch: "" | "A" | "B" | "C" | "D" | string;
}

// ---- Atlas Graph (Phase 4): node-based visual scripting IR ----
// A graph is an additive, editor-authored representation stored per event
// page; it compiles deterministically into `page.commands` (the only thing
// the runtime ever reads), so graphs cost nothing at play/export time.

/** One node on an event page's Atlas Graph canvas. */
export interface GraphNode {
  id: number; // unique within the graph
  /** "cmd" (default): a command node. "comment": a note/frame (never wired).
   *  "reroute": a pass-through dot for tidying edges. */
  kind?: "cmd" | "comment" | "reroute";
  x: number;
  y: number;
  /** kind "cmd": the payload command. Its own branch arrays (if.then,
   *  choices.branches, loop.body) stay EMPTY in the graph — structure lives
   *  in the `out` edges and is materialized by the compiler. */
  cmd?: AnyCommand;
  text?: string; // kind "comment"
  w?: number; // kind "comment": frame width (a sized comment is a frame)
  h?: number; // kind "comment": frame height
  /** Exec outputs → target node id (null = flow ends). Shape per node type:
   *  if = [Then, Else, After] · choices = [...options, After] ·
   *  loop = [Body, After] · other cmd/reroute = [Next] · comment = []. */
  out: (number | null)[];
}

/** The per-page graph document (EventPage.graph). */
export interface EventGraph {
  nodes: GraphNode[];
  /** The Start pill's target — the first node executed. */
  entry: number | null;
  /** Node-id allocator (next unused id). */
  nextId: number;
}

export interface EventPage {
  name?: string;
  cond?: EventPageCondition;
  charset?: string;
  dir?: Dir;
  moveType?: "fixed" | "random" | string;
  trigger?: "action" | "touch" | "auto" | "parallel" | string;
  priority?: "below" | "same" | "above" | string;
  through?: boolean;
  combat?: ActionCombat;
  commands: AnyCommand[];
  /** Atlas Graph source (Phase 4). When present, `commands` is its compiled
   *  output and the editor treats the graph as the page's source of truth.
   *  Optional and additive: pages without graphs are untouched. */
  graph?: EventGraph;
}

export interface MapEvent {
  id: number;
  name?: string;
  x: number;
  y: number;
  pages: EventPage[];
}

export interface MapLayers {
  ground: number[];
  decor: number[];
  decor2: number[];
  over: number[];
}

// ---- Advanced Map Editor (Phase 8): generalized layers ----
// When map.layersAdv is present it defines the full ordered layer stack
// (bottom → top) for both editors and the renderer composite. Core entries
// REFERENCE the four role arrays in map.layers (which remain the tile storage
// — every existing paint/clipboard/autotile path keeps writing them); "tile"
// entries carry their own data. Absent ⇒ classic stack, byte-identical
// rendering.

export interface AdvLayerBase {
  /** unique within the map. */
  id: number;
  name: string;
  /** default true. */
  visible?: boolean;
  /** editor-only: blocks edits, not rendering. */
  locked?: boolean;
  /** 0..1, default 1. */
  opacity?: number;
  /** default "normal". */
  blend?: "normal" | "add" | "multiply" | "screen";
  /** CSS color multiplied over the layer (editor+2D first). */
  tint?: string;
  props?: TypedProps;
}
export type AdvLayer =
  | (AdvLayerBase & { type: "core"; role: "ground" | "decor" | "decor2" | "over" })
  | (AdvLayerBase & {
      type: "tile";
      /** width*height tile ids. */
      data: number[];
      /** engine composite buffer; default "below". */
      slot?: "below" | "above";
    })
  | (AdvLayerBase & { type: "group"; children: AdvLayer[] });

// ---- Advanced Map Editor (Phase 8): objects & gameplay zones ----

export type ZoneShape =
  | { type: "rect"; x: number; y: number; w: number; h: number } // tile units
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "poly"; pts: { x: number; y: number }[] }
  | { type: "point"; x: number; y: number };

export interface MapZone {
  id: number;
  name?: string;
  kind:
    | "encounter"
    | "transfer"
    | "sound"
    | "weather"
    | "spawn"
    | "collision"
    | "nav"
    | "custom";
  shape: ZoneShape;
  /** free-form; the whole payload for "custom". */
  props?: TypedProps;
  // per-kind payloads (only the matching one is read):
  encounter?: { troops: number[]; rate: number; regionFilter?: number[] };
  transfer?: { mapId: number; x: number; y: number; dir?: Dir };
  sound?: { key: string; vol?: number; falloff?: "none" | "linear" };
  weather?: { kind: string; power: number };
}

// ---- Advanced Map Editor (Phase 8): visual automapping (editor-only) ----

export type RulePredicate =
  | { kind: "terrainIs"; terrain: number } // autotile group / tile id, ground
  | {
      kind: "tileIs";
      layerId: number | "core:ground" | "core:decor" | "core:decor2" | "core:over";
      tile: number;
    }
  | { kind: "near"; terrain: number; radius: number }
  | { kind: "notNear"; terrain: number; radius: number }
  | { kind: "regionIs"; region: number }
  | { kind: "passable"; value: boolean };
export type RuleAction =
  | { kind: "placeTile"; layerId: number | string; tile: number; probability?: number }
  | { kind: "placeStamp"; stampId: number; probability?: number }
  | { kind: "setRegion"; region: number };

export interface AutomapRule {
  id: number;
  name?: string;
  /** default true. */
  enabled?: boolean;
  /** ANDed. */
  if: RulePredicate[];
  then: RuleAction[];
  /** deterministic preview/apply. */
  seed?: number;
}

export interface MapEncounters {
  troops: number[];
  rate: number;
  /** Region-specific troop pools (Phase 5): when the player's tile carries
   *  region r and byRegion[r] is non-empty, it replaces `troops` for the
   *  roll (the rate is unchanged). Absent/empty = the default list. */
  byRegion?: Record<number, number[]>;
  /** Clock-driven pools (Phase 5): at night (21:00–5:00) a non-empty list
   *  replaces `troops` (a region pool still wins over it). */
  byTime?: { night?: number[] };
}

/** A map light source (HD-2D). rx/ry in tile units. */
export interface MapLight {
  rx: number;
  ry: number;
  color: string;
  radius: number;
}

export interface Hd2dConfig {
  enabled?: boolean;
  tilt?: number;
  /** true = default strength, or an explicit 0..1 strength. */
  bloom?: boolean | number;
  dof?: boolean | number;
  fog?: boolean | { color?: string; near?: number; far?: number };
  lights?: boolean;
  ambient?: number;
  /** Sun shadow maps (three.js renderer, Phase 2 Stage B):
   *  true = default strength, or an explicit 0..1 shadow darkness. */
  shadows?: boolean | number;
  /** Sun position for the shadow pass; Stage D's day/night cycle animates it.
   *  azimuth: compass degrees clockwise from north (default 35);
   *  elevation: degrees above the horizon (default 55, clamped 15–85). */
  sun?: { azimuth?: number; elevation?: number };
  /** Point-light shadows (Stage B.2): the 4 lights nearest the camera cast.
   *  true = full occlusion, or an explicit 0..1 strength. */
  pointShadows?: boolean | number;
  /** Animated water surface over water/deepwater/swamp ground tiles
   *  (Stage C): true = on, or an explicit 0..1 intensity. */
  water?: boolean | number;
  /** Auto-generated normal/specular/emissive maps for terrain (Stage C). */
  materials?: boolean;
  /** Post stack v2 (Stage D). */
  aces?: boolean;
  fxaa?: boolean;
  ssao?: boolean | number;
  vignette?: boolean | number;
  /** Color-grade preset: "warm" | "cool" | "night" | "sepia" | "noir". */
  lut?: string;
  /** Day/night cycle (Stage D): lighting follows the in-game clock. */
  dayNight?: boolean;
  /** Pin the clock (hours 0–24) when entering this map; null/absent = keep. */
  timeOfDay?: number | null;
  /** Weather particles (Stage E): "rain" | "snow" | "motes". */
  weather?: string;
  /** Soft blob shadows under characters (Stage E). */
  dropShadows?: boolean;
}

export interface GameMap {
  id: number;
  name: string;
  width: number;
  height: number;
  tilesetId?: number;
  /** Procedural theme, "none", or an "asset:audio/…" key (Phase 6). */
  music?: string;
  /** Looping ambience layers (Phase 6): imported BGS assets mixed on the bgs
   *  bus, diffed across transfers. Optional; absent = none. */
  ambience?: { key: string; vol?: number }[];
  encounters?: MapEncounters;
  layers: MapLayers;
  /** 4-bit quadrant shadow mask per tile. */
  shadows?: number[];
  /** passability override per tile: 0=auto 1=force pass 2=force block. */
  passOv?: number[];
  /** HD-2D elevation in tile units per tile (visual only). */
  heights?: number[];
  /** Region tag per tile: 0 = none, 1–63 (Phase 5). Backfilled by v2. */
  regions?: number[];
  events: MapEvent[];
  hd2d?: Hd2dConfig;
  lights?: MapLight[];
  /** Hide the corner minimap on this map (Phase 5): false = hidden;
   *  absent/true = shown when system.minimap is on. */
  minimap?: boolean;
  /** Free-form author notes for this map (Phase 3 Stage E). Editor-only:
   *  purely additive, absent = no note; the engine never reads it. */
  notes?: string;
  /** Pinned bird's-eye position in the World View, in grid cells (Phase 3
   *  Stage E). Editor-only; absent ⇒ the view auto-lays the node out. */
  worldPos?: { x: number; y: number };
  /** Generalized layer stack (Phase 8). Absent ⇒ the classic four-array
   *  stack, byte-identical rendering. See AdvLayer. */
  layersAdv?: AdvLayer[];
  /** Objects & gameplay zones (Phase 8). Absent ⇒ zero runtime change. */
  zones?: MapZone[];
  /** Visual automap rules (Phase 8). Editor-only: evaluated on Preview/Apply
   *  in the Advanced editor; the engine never reads them. */
  automapRules?: AutomapRule[];
  /** Map-tree folder this map sits in (Phase 8). Editor-only; absent = root. */
  folderId?: number;
}

/** A map-tree folder (Phase 8, proj.mapFolders). Purely organizational —
 *  the flat `maps` array and every byId lookup are untouched. */
export interface MapFolder {
  id: number;
  name: string;
  parentId?: number | null;
}

/** A persisted clipboard entry (Phase 8, proj.stamps): captured from a
 *  selection, placed through the existing paste path. */
export interface Stamp {
  id: number;
  name: string;
  w: number;
  h: number;
  /** same shape as the tile clipboard: per-core-role tile arrays (+ shadows). */
  layers: Partial<Record<"ground" | "decor" | "decor2" | "over", number[]>>;
  shadows?: number[];
  tags?: string[];
}

// ============================================================================
// Common events, tilesets, plugins, custom chars, presets
// ============================================================================

export interface CommonEvent {
  id: number;
  name: string;
  trigger: "none" | "auto" | "parallel";
  switchId: number;
  commands: AnyCommand[];
}

export interface Tileset {
  id: number;
  name: string;
  /** free-form per-tile property map (tile key -> props). */
  tileProps: Record<string, any>;
}

/** A 47-blob autotile group (Phase 3 Stage D). The map stores a single reserved
 *  tile id per group (AUTOTILE_BASE + id); the visual shape is resolved from
 *  8-neighbour connectivity at draw time. `sheet` is the RPG-Maker A2 source
 *  block (2x3 tiles) as a data URL. */
export interface Autotile {
  id: number;
  name: string;
  /** data URL of the A2 source block (4 minitiles wide x 6 tall). */
  sheet: string;
  /** whole-cell terrain (paints to the ground layer under Auto). Default true. */
  terrain?: boolean;
  /** passable by default. Default true (terrain floors are walkable). */
  pass?: boolean;
  // ---- Phase 8 (Terrain & Autotile Studio) — all absent = today's A2 47-blob ----
  /** Sheet arrangement / resolver kind. Absent = "blob47" (A2). */
  kind?: "blob47" | "edge16" | "corner16" | "a1" | "a3" | "a4";
  /** Weighted visual variations (alternate sheets). */
  variants?: { sheet: string; weight: number }[];
  /** Pattern completion: derive missing shapes by transforming authored ones. */
  allowFlipH?: boolean;
  allowFlipV?: boolean;
  allowRot?: boolean;
  /** Prefer authored tiles over derived transforms. */
  preferOriginal?: boolean;
  /** A1-style animation frame strips. */
  anim?: { frames: number; fps: number };
  props?: TypedProps;
}

/** A project plugin entry (Database ▸ Plugins). Built-ins carry engine
 *  metadata refreshed by the migration; user plugins keep author fields. */
export interface PluginEntry {
  id: number;
  key?: string;
  name?: string;
  builtin?: boolean;
  enabled?: boolean;
  code?: string;
  pluginId?: string;
  version?: string;
  author?: string;
  description?: string;
  dependencies?: string[];
  /** free-form author-declared parameter block. */
  params?: Record<string, any>;
}

/** A saved Script-command button (proj.commandPresets). */
export interface CommandPreset {
  id: number;
  name: string;
  code: string;
}

/** A custom character sprite/face definition (proj.customChars). Free-form:
 *  the shape is owned by js/assets.js registerCustomChars. */
export type CustomChar = Record<string, any>;

/** One embedded asset inside a saved project FILE (Phase 6): a library asset
 *  carried as a data URL so the file opens complete on another device. Never
 *  present in localStorage autosaves (stripped on save) or in the in-memory
 *  project (consumed into the device library on load). */
export interface EmbeddedAsset {
  type: string; // "characters" | "facesets" | "enemies" | "tilesets" | "audio"
  name: string;
  src: string; // data URL
  kind?: string; // audio role
  tags?: string[];
  meta?: Record<string, any>;
}

/** Project asset registry (proj.assets): tile overrides + external asset
 *  blobs. Free-form: owned by js/assets.js (tiles) and
 *  src/shared/asset-library.ts (external). */
export interface ProjectAssets {
  tiles: Record<string, any>;
  /** File-save embedding only — see EmbeddedAsset. */
  external?: EmbeddedAsset[];
  [k: string]: any;
}

// ============================================================================
// RPG Maker import report (Project Compass, M1·D)
// ============================================================================

/** One line of the import report — a structured note the converters emit so
 *  nothing an MZ/MV project needed is ever dropped silently (locked decision
 *  6). `kind` says how it fared; `what`/`detail` are already written in the
 *  kid-friendly "what it was → what happened" voice the wizard renders. */
export interface ImportReportLine {
  area: string;
  kind: "converted" | "partial" | "skipped" | "todo";
  what: string;
  detail?: string;
  /** For aggregated lines ("the Luck stat — seen N times"). */
  count?: number;
  /** Raw MZ command/trait/effect code, when relevant. */
  code?: number;
}

/** Headline "what came along" counts, computed from the assembled project so
 *  the report can lead with good news before the caveats. */
export interface ImportReportSummary {
  maps: number;
  actors: number;
  skills: number;
  items: number;
  weapons: number;
  armors: number;
  enemies: number;
  troops: number;
  commonEvents: number;
  switches: number;
  variables: number;
}

/** The saved import report (Project Compass, M1·D). Stored on the project so
 *  it can be reopened any time from File ▸ Import Report. Additive + optional
 *  (FORMAT_VERSION stays 2); old projects simply have no `importReport`. */
export interface ImportReportDoc {
  /** Which RPG Maker format the project came from. */
  source: "mv" | "mz";
  /** When the import ran (Date.now()). */
  when: number;
  /** The imported game's title, for the report header. */
  gameTitle?: string;
  summary: ImportReportSummary;
  lines: ImportReportLine[];
}

// ============================================================================
// The whole project document
// ============================================================================

/** The whole project document (localStorage "rpgatlas_project" / .json file). */
export interface Project {
  meta: ProjectMeta;
  system: SystemData;
  plugins: PluginEntry[];
  quests: Quest[];
  customChars: CustomChar[];
  commandPresets: CommandPreset[];
  commonEvents: CommonEvent[];
  /** Always present after migration (RA._migrateV0toV1 seeds a Default). */
  tilesets: Tileset[];
  /** 47-blob autotile groups (Phase 3 Stage D). Optional; absent = none. */
  autotiles?: Autotile[];
  /** Persisted tile stamps (Phase 8). Optional; absent = none. */
  stamps?: Stamp[];
  /** Map-tree folders (Phase 8). Editor-only; absent = flat tree. */
  mapFolders?: MapFolder[];
  assets: ProjectAssets;
  /** Battle animations (Phase 5). Always present after the v2 migration. */
  animations: BattleAnimation[];
  actors: Actor[];
  classes: ClassDef[];
  skills: Skill[];
  states: StateDef[];
  items: Item[];
  weapons: Weapon[];
  armors: Armor[];
  enemies: Enemy[];
  troops: Troop[];
  maps: GameMap[];
  /** Saved RPG Maker import report (Project Compass, M1·D). Present only on
   *  projects created by the MZ/MV importer; reopenable from File ▸ Import
   *  Report. Additive + optional (FORMAT_VERSION stays 2). */
  importReport?: ImportReportDoc;
}

// ============================================================================
// Runtime guards (load / import boundaries only)
// ============================================================================
//
// These are lightweight, hand-rolled (no dependency), and BEHAVIOR-FROZEN:
// they WARN on a shape today's code would still accept, and always pass the
// value through. They never throw and never reject — the engine/editor's own
// migration + `|| default` fallbacks remain the real tolerance. Their job is
// to surface a diagnostic when a loaded/imported document diverges from the
// schema, not to gate loading.

function warn(msg: string): void {
  // Match the codebase's console.warn diagnostics used elsewhere on load.
  try {
    console.warn("[schema] " + msg);
  } catch {
    /* console unavailable — ignore */
  }
}

/** Cheap structural check: is this plausibly an RPGAtlas project document?
 *  Mirrors the engine/editor gate (meta.engine is "rpgatlas" or "driftwood").
 *  Pure predicate — does not warn, does not mutate. */
export function isProjectLike(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const meta = (value as any).meta;
  return (
    !!meta &&
    typeof meta === "object" &&
    (meta.engine === "rpgatlas" || meta.engine === "driftwood")
  );
}

/** Validate a just-loaded/imported project at the boundary. Returns the SAME
 *  object (pass-through) after emitting console warnings for any missing or
 *  malformed top-level collections. Never throws, never rejects — a project
 *  today's code accepts stays accepted. Call AFTER RA.migrateProject so
 *  backfilled fields are present.
 *
 *  `where` labels the boundary in warnings ("load", "import"). */
export function validateProject(value: unknown, where = "load"): Project {
  const tag = "(" + where + ") ";
  if (!isProjectLike(value)) {
    warn(tag + "value is not a recognizable project document");
    return value as Project;
  }
  const p = value as any;

  // Top-level arrays the engine iterates without existence checks in hot paths.
  const arrays = [
    "plugins",
    "quests",
    "customChars",
    "commandPresets",
    "commonEvents",
    "animations",
    "actors",
    "classes",
    "skills",
    "states",
    "items",
    "weapons",
    "armors",
    "enemies",
    "troops",
    "maps",
  ];
  for (const key of arrays) {
    if (p[key] != null && !Array.isArray(p[key])) {
      warn(tag + "expected `" + key + "` to be an array, got " + typeof p[key]);
    }
  }

  if (!p.system || typeof p.system !== "object") {
    warn(tag + "missing or malformed `system`");
  } else if (typeof p.system.title !== "string") {
    warn(tag + "expected `system.title` to be a string");
  }

  if (Array.isArray(p.maps)) {
    if (!p.maps.length) {
      warn(tag + "project has no maps");
    }
    for (const m of p.maps) {
      if (!m || typeof m !== "object") {
        warn(tag + "map entry is not an object");
        continue;
      }
      if (!m.layers || typeof m.layers !== "object") {
        warn(tag + "map " + m.id + " (" + m.name + ") has no layers");
      }
      if (!Array.isArray(m.events)) {
        warn(tag + "map " + m.id + " (" + m.name + ") events is not an array");
      }
    }
  }

  return p as Project;
}
