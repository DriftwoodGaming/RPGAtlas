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
   - The AnyCommand union enumerates every event command: the 33 CMD_DEFS in
     src/editor/event-editor/command-defs.ts, which are exactly the 33 types
     registered in src/engine/interpreter/commands/*.ts.
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
}

export interface Item {
  id: number;
  name: string;
  icon?: number;
  price?: number;
  hp?: number;
  mp?: number;
  desc?: string;
}

export interface Weapon {
  id: number;
  name: string;
  icon?: number;
  price?: number;
  wtypeId?: number;
  params?: Params;
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

export interface EnemyAction {
  skillId: number;
  weight: number;
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
}

export interface Troop {
  id: number;
  name: string;
  /** enemy ids composing the troop. */
  enemies: number[];
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
// Event commands — the AnyCommand discriminated union (33 types)
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
}

export interface CmdText {
  t: "text";
  name?: string;
  face?: string;
  text: string;
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
  name: string;
}
export interface CmdMusic {
  t: "music";
  theme: string;
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
  | CmdBreakLoop;

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

export interface MapEncounters {
  troops: number[];
  rate: number;
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
  music?: string;
  encounters?: MapEncounters;
  layers: MapLayers;
  /** 4-bit quadrant shadow mask per tile. */
  shadows?: number[];
  /** passability override per tile: 0=auto 1=force pass 2=force block. */
  passOv?: number[];
  /** HD-2D elevation in tile units per tile (visual only). */
  heights?: number[];
  events: MapEvent[];
  hd2d?: Hd2dConfig;
  lights?: MapLight[];
  /** Free-form author notes for this map (Phase 3 Stage E). Editor-only:
   *  purely additive, absent = no note; the engine never reads it. */
  notes?: string;
  /** Pinned bird's-eye position in the World View, in grid cells (Phase 3
   *  Stage E). Editor-only; absent ⇒ the view auto-lays the node out. */
  worldPos?: { x: number; y: number };
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

/** Project asset registry (proj.assets): tile overrides + external asset
 *  blobs. Free-form: owned by js/assets.js. */
export interface ProjectAssets {
  tiles: Record<string, any>;
  [k: string]: any;
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
  assets: ProjectAssets;
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
