/* RPGAtlas — scripts/build-migration-fixtures.mjs
   Project Compass · M0·B: emits the two hand-authored RPG Maker fixture
   projects the MZ/MV importer (phases M1+) is built and tested against —
     tests/fixtures/mv-project/   (RPG Maker MV 1.6.x format)
     tests/fixtures/mz-project/   (RPG Maker MZ 1.x format)

   "Hand-authored" per locked decision 5: every byte here is our own — no RTP,
   no DLC, no RPG Maker-exported data. The content is a deliberate ~micro-game
   ("Cove Test") designed so ONE playthrough exercises every conversion path in
   docs/mz-mv-parity-matrix.md. The generator is the readable source of truth;
   the emitted JSON is committed so tests/CI don't need to run it, and it is
   deterministic + idempotent (rerun ⇒ byte-identical output).

   Why a generator instead of 30 literal .json files: two faithful RPG Maker
   projects need 8x100 class param curves, 8192-entry tileset flag arrays, and
   w*h*6 map planes — thousands of numbers whose *intent* (which tile carries
   which flag, which curve linearizes cleanly) is the actual fixture. Encoding
   that intent as code is what makes it reviewable at the M0·C gate and
   maintainable when M1·B/M4·A read these exact bytes back. Same pattern the
   repo already uses for build-atlas-quest-*.mjs.

   The two projects hold the SAME game in the two engine formats, so M1's
   MV-vs-MZ delta handling is tested against a controlled diff (§0 of the
   matrix): MV sheet Animations vs MZ Effekseer, plugin command 356 vs 357,
   .rpgmvp/.rpgmvo vs .png_/.ogg_ encryption, MZ-only System.advanced/locale/
   autosave. See tests/fixtures/README.md for the requirement -> element map.
   GPL-3.0-or-later. */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Readable JSON: pretty-print objects/mixed arrays, keep pure-number arrays
// (map planes, flag tables, param curves) inline so files stay reviewable.
// ---------------------------------------------------------------------------
function j(v, ind = 0) {
  const p = "  ".repeat(ind), p1 = "  ".repeat(ind + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => x === null || typeof x === "number"))
      return "[" + v.map((x) => (x === null ? "null" : x)).join(",") + "]";
    return "[\n" + v.map((x) => p1 + j(x, ind + 1)).join(",\n") + "\n" + p + "]";
  }
  if (v && typeof v === "object") {
    const k = Object.keys(v);
    if (k.length === 0) return "{}";
    return "{\n" + k.map((key) => p1 + JSON.stringify(key) + ": " + j(v[key], ind + 1)).join(",\n") + "\n" + p + "}";
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Tiny deterministic placeholder binaries (self-made, not RTP).
// ---------------------------------------------------------------------------
// 1x1 PNG (transparent) — a decodable placeholder swatch reused for every image.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);
// Minimal placeholder "OGG" — an OggS-tagged byte blob (a fixture, not a real
// stream). Enough for decryption round-trip + asset-intake tests; not playback.
const OGG_STUB = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60, 0)]);

// MV/MZ asset encryption: a 16-byte fake PNG/OGG header, then the real file's
// first 16 bytes XORed with the 16-byte key (hex in System.json). Symmetric.
const ENC_HEADER = Buffer.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);
function encrypt(buf, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const out = Buffer.concat([ENC_HEADER, Buffer.from(buf)]);
  for (let i = 0; i < 16 && i < buf.length; i++) out[16 + i] = buf[i] ^ key[i % key.length];
  return out;
}

// ---------------------------------------------------------------------------
// Shared game content (identical across MV & MZ except where `mz` branches).
// dataId / index conventions follow RPG Maker (id 0 = "none"/reserved null).
// ---------------------------------------------------------------------------

// System type lists — index-keyed in RM (id 0 = blank).
const ELEMENTS = ["", "Physical", "Fire", "Ice", "Thunder", "Water", "Earth"];
const SKILL_TYPES = ["", "Magic", "Special"];
const WEAPON_TYPES = ["", "Dagger", "Sword"];
const ARMOR_TYPES = ["", "General Armor", "Magic Armor"];
const EQUIP_TYPES = ["", "Weapon", "Shield", "Head", "Body", "Accessory"];
const SWITCHES = ["", "Door Unlocked", "Boss Defeated", "Met Finn"];
const VARIABLES = ["", "Gold Found", "Steps Taken", "Puzzle State"];

const se = (name) => ({ name, volume: 90, pitch: 100, pan: 0 });
const audio = (name) => ({ name, pan: 0, pitch: 100, volume: 90 });

// A full-length RM param curve: params[level] for levels 0..99 (index 0 unused).
// Linear base+growth so M1·A's "fit base+growth, linearize, report" path has a
// clean target; `bend` adds a mild non-linear kink so the linearize CAVEAT
// (report line) is genuinely exercised on at least one param.
function curve(base, growth, bend = 0) {
  const a = [];
  for (let lv = 0; lv < 100; lv++) a.push(Math.round(base + growth * (lv - 1) + bend * Math.max(0, lv - 50)));
  a[0] = 0;
  return a;
}

// 8 RM params: [mhp, mmp, atk, def, mat, mdf, agi, luk]. `luk` (index 7) is the
// locked skip (§5) — present here so the importer's drop+report path has input.
function classParams(kind) {
  if (kind === "wanderer")
    return [curve(400, 40, 2), curve(60, 8), curve(28, 5), curve(24, 4), curve(18, 3), curve(20, 3), curve(26, 4), curve(15, 2)];
  return [curve(320, 34), curve(90, 10), curve(20, 3), curve(20, 3), curve(30, 6, 1), curve(28, 5), curve(34, 6), curve(22, 3)];
}

function Actors() {
  return [
    null,
    {
      id: 1, name: "Mara", nickname: "the Wanderer", classId: 1, initialLevel: 3, maxLevel: 99,
      characterName: "People", characterIndex: 0, faceName: "People", faceIndex: 0, battlerName: "Mara_SV",
      // 5 equip slots (weapon + 4 armor); Atlas keeps 1 weapon + 1 armor, the
      // extra armor slots (head/body/accessory) become a per-actor report line.
      equips: [1, 1, 0, 2, 3],
      // Actor-LEVEL trait (Element Rate Fire 50%): Atlas has no actor traits —
      // exercises the M0·B merge-onto-battler decision + report.
      traits: [{ code: 11, dataId: 2, value: 0.5 }],
      profile: "A sailor a long way from home.", note: "",
    },
    {
      id: 2, name: "Finn", nickname: "", classId: 2, initialLevel: 2, maxLevel: 50,
      characterName: "People", characterIndex: 1, faceName: "People", faceIndex: 1, battlerName: "Finn_SV",
      equips: [2, 4, 0, 0, 0], traits: [], profile: "", note: "",
    },
  ];
}

function Classes() {
  const learnings = (a, b) => [{ level: 2, skillId: a, note: "" }, { level: 4, skillId: b, note: "" }];
  return [
    null,
    {
      id: 1, name: "Wanderer", expParams: [30, 20, 30, 30], params: classParams("wanderer"),
      learnings: learnings(1, 2),
      traits: [
        { code: 11, dataId: 3, value: 0.5 }, // Element Rate: Ice 50%  (= M1·A)
        { code: 21, dataId: 2, value: 1.1 }, // Param: Attack x1.1     (~= M1·A, 7/8 map)
        { code: 21, dataId: 7, value: 1.2 }, // Param: LUCK  -> locked skip + report (§5)
        { code: 43, dataId: 3, value: 0 },   // Add Skill: Guard       (~= M1·A)
        { code: 51, dataId: 2, value: 0 },   // Equip Weapon Type: Sword (~= M1·A)
        { code: 22, dataId: 0, value: 0.05 }, // Ex-Param HIT -> + M3·B
        { code: 62, dataId: 1, value: 1 },    // Special Flag (guard)  -> + M3·B
      ],
      note: "",
    },
    {
      id: 2, name: "Scout", expParams: [25, 18, 28, 32], params: classParams("scout"),
      learnings: learnings(2, 3),
      traits: [
        { code: 13, dataId: 1, value: 0.0 }, // State Rate: Poison 0% (immune-ish) (= M1·A)
        { code: 41, dataId: 2, value: 0 },   // Add Skill Type: Special -> + M3·B
      ],
      note: "",
    },
  ];
}

function Skills() {
  return [
    null,
    // 1 Attack (the reserved "normal attack" skill, id 1 in RM)
    { id: 1, name: "Attack", iconIndex: 76, stypeId: 0, mpCost: 0, tpCost: 0, scope: 1, occasion: 1,
      damage: { type: 1, elementId: -1, formula: "a.atk * 4 - b.def * 2", variance: 20, critical: true },
      effects: [], animationId: -1, repeats: 1, message1: "", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0, note: "" },
    // 2 Firebolt — the DAMAGE FORMULA fixture (§7 flagship). Reads a var (v[3]).
    { id: 2, name: "Firebolt", iconIndex: 64, stypeId: 1, mpCost: 8, tpCost: 0, scope: 1, occasion: 1,
      damage: { type: 1, elementId: 2, formula: "a.mat * 2 - b.mdf + v[3]", variance: 20, critical: true },
      effects: [{ code: 21, dataId: 1, value1: 0.5, value2: 0 }], // 50% inflict Poison
      animationId: 2, repeats: 1, message1: "casts %1!", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0,
      note: "<Cooldown: 3>" },
    // 3 Heal — recover-HP + common-event effect (§6 codes 11 & 44 = M1·A)
    { id: 3, name: "Heal", iconIndex: 72, stypeId: 1, mpCost: 5, tpCost: 0, scope: 7, occasion: 0,
      damage: { type: 3, elementId: 0, formula: "(a.mat * 2) + 50", variance: 0, critical: false },
      effects: [{ code: 11, dataId: 0, value1: 0.0, value2: 100 }, { code: 44, dataId: 1, value1: 0, value2: 0 }],
      animationId: 1, repeats: 1, message1: "", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0, note: "" },
    // 4 Guard — user-scope, tpCost (TP -> + M3·B)
    { id: 4, name: "Guard", iconIndex: 81, stypeId: 2, mpCost: 0, tpCost: 25, scope: 11, occasion: 1,
      damage: { type: 0, elementId: 0, formula: "0", variance: 0, critical: false },
      effects: [], animationId: 0, repeats: 1, message1: "", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0, note: "" },
  ];
}

function Items() {
  return [
    null,
    { id: 1, name: "Potion", iconIndex: 176, description: "Restores 200 HP.", itypeId: 1, price: 50, consumable: true,
      scope: 7, occasion: 0, speed: 0, successRate: 100, repeats: 1, tpGain: 0, hitType: 0, animationId: 0,
      damage: { type: 3, elementId: 0, formula: "0", variance: 0, critical: false },
      effects: [{ code: 11, dataId: 0, value1: 0, value2: 200 }], note: "" },
    { id: 2, name: "Antidote", iconIndex: 176, description: "Cures Poison.", itypeId: 1, price: 30, consumable: true,
      scope: 7, occasion: 0, speed: 0, successRate: 100, repeats: 1, tpGain: 0, hitType: 0, animationId: 0,
      damage: { type: 0, elementId: 0, formula: "0", variance: 0, critical: false },
      effects: [{ code: 22, dataId: 1, value1: 1.0, value2: 0 }], note: "" },
    // Key item (itypeId 2) + non-consumable -> report lines (§Items)
    { id: 3, name: "Rusty Key", iconIndex: 195, description: "Opens something in the cave.", itypeId: 2, price: 0,
      consumable: false, scope: 0, occasion: 3, speed: 0, successRate: 100, repeats: 1, tpGain: 0, hitType: 0,
      animationId: 0, damage: { type: 0, elementId: 0, formula: "0", variance: 0, critical: false }, effects: [], note: "" },
  ];
}

function Weapons() {
  return [
    null,
    { id: 1, name: "Cutlass", iconIndex: 96, description: "", wtypeId: 2, price: 300, etypeId: 1, animationId: 1,
      params: [0, 0, 12, 0, 0, 0, 2, 3], // note luk (index 7) present -> dropped
      traits: [{ code: 31, dataId: 2, value: 0 }], note: "" }, // Attack Element Fire -> + M3·B
    { id: 2, name: "Sling", iconIndex: 111, description: "", wtypeId: 1, price: 120, etypeId: 1, animationId: 1,
      params: [0, 0, 7, 0, 0, 0, 4, 1], traits: [], note: "" },
  ];
}

function Armors() {
  return [
    null,
    { id: 1, name: "Leather Vest", iconIndex: 128, description: "", atypeId: 1, etypeId: 4, price: 200,
      params: [0, 0, 0, 8, 0, 2, 0, 0], traits: [{ code: 21, dataId: 3, value: 1.05 }], note: "" }, // Param Def
    { id: 2, name: "Wooden Shield", iconIndex: 129, description: "", atypeId: 1, etypeId: 2, price: 90,
      params: [0, 0, 0, 5, 0, 0, 0, 0], traits: [], note: "" },
    { id: 3, name: "Sailor's Charm", iconIndex: 162, description: "", atypeId: 2, etypeId: 5, price: 150,
      params: [30, 10, 0, 0, 2, 2, 0, 0], traits: [{ code: 22, dataId: 2, value: 0.05 }], note: "" }, // Ex-Param CRI -> M3·B
    { id: 4, name: "Cap", iconIndex: 135, description: "", atypeId: 1, etypeId: 3, price: 60,
      params: [0, 0, 0, 3, 0, 1, 0, 0], traits: [], note: "" },
  ];
}

function Enemies() {
  return [
    null,
    { id: 1, name: "Slime", battlerName: "Slime", battlerHue: 120, params: [120, 0, 14, 8, 4, 6, 10, 5],
      exp: 15, gold: 10,
      dropItems: [{ kind: 1, dataId: 1, denominator: 2 }, { kind: 0, dataId: 0, denominator: 1 }, { kind: 0, dataId: 0, denominator: 1 }],
      actions: [
        { skillId: 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 }, // always
        { skillId: 2, conditionType: 1, conditionParam1: 2, conditionParam2: 3, rating: 4 }, // turn 2..3
      ],
      traits: [{ code: 11, dataId: 3, value: 2.0 }, { code: 22, dataId: 6, value: 0.1 }], // weak Ice; Ex-Param AGI-ish
      note: "<Boss>" },
    { id: 2, name: "Crab", battlerName: "Crab", battlerHue: 0, params: [180, 0, 18, 16, 2, 4, 6, 4],
      exp: 22, gold: 18,
      dropItems: [{ kind: 0, dataId: 0, denominator: 1 }, { kind: 0, dataId: 0, denominator: 1 }, { kind: 0, dataId: 0, denominator: 1 }],
      actions: [{ skillId: 1, conditionType: 5, conditionParam1: 0.5, conditionParam2: 0, rating: 5 }], // HP <=50%
      traits: [], note: "" },
  ];
}

function Troops() {
  // Battle-event page conditions (§8.5): page 0 fires on turn 2 (turnValid);
  // page 1 fires when Slime HP <= 50% (enemyValid). Spans: 1=turn, 0=battle.
  const cond = (o) => Object.assign({
    turnEnding: false, turnValid: false, turnA: 0, turnB: 0, enemyValid: false, enemyIndex: 0, enemyHp: 100,
    actorValid: false, actorId: 1, actorHp: 100, switchValid: false, switchId: 1,
  }, o);
  return [
    null,
    {
      id: 1, name: "Slimes",
      members: [
        { enemyId: 1, x: 200, y: 300, hidden: false },
        { enemyId: 1, x: 400, y: 300, hidden: false },
        { enemyId: 2, x: 300, y: 240, hidden: true }, // appear-midbattle -> + M3·C
      ],
      pages: [
        { conditions: cond({ turnValid: true, turnA: 2, turnB: 0 }), span: 1,
          list: [
            { code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] },
            { code: 401, indent: 0, parameters: ["The slimes wobble menacingly!"] },
            { code: 0, indent: 0, parameters: [] },
          ] },
        { conditions: cond({ enemyValid: true, enemyIndex: 0, enemyHp: 50 }), span: 0,
          list: [
            { code: 337, indent: 0, parameters: [0, 0, 2] }, // Show Battle Animation -> ~= M3·C
            { code: 331, indent: 0, parameters: [0, 0, 0, 20] }, // Change Enemy HP -> + M3·C (mzTodo)
            { code: 0, indent: 0, parameters: [] },
          ] },
      ],
    },
  ];
}

function States() {
  return [
    null,
    { id: 1, name: "Poison", iconIndex: 4, restriction: 0, priority: 50, motion: 0, overlay: 0,
      removeAtBattleEnd: false, removeByRestriction: false, autoRemovalTiming: 1, minTurns: 3, maxTurns: 5,
      removeByDamage: true, chanceByDamage: 100, removeByWalking: true, stepsToRemove: 100,
      traits: [{ code: 22, dataId: 7, value: -0.1 }], // hrg -10% -> slip damage (~= Atlas hpTurn)
      message1: " is poisoned!", message2: "", message3: "", message4: " is no longer poisoned.", note: "" },
    { id: 2, name: "Sleep", iconIndex: 5, restriction: 4, priority: 60, motion: 3, overlay: 1,
      removeAtBattleEnd: true, removeByRestriction: false, autoRemovalTiming: 1, minTurns: 2, maxTurns: 4,
      removeByDamage: true, chanceByDamage: 100, removeByWalking: false, stepsToRemove: 0,
      traits: [], message1: " falls asleep!", message2: "", message3: "", message4: " wakes up.", note: "" },
  ];
}

function CommonEvents() {
  return [
    null,
    // 1 called by Heal skill (trigger none)
    { id: 1, name: "Heal Flash", trigger: 0, switchId: 1,
      list: [
        { code: 224, indent: 0, parameters: [[255, 255, 255, 170], 15, false] }, // Flash Screen (= M1·C)
        { code: 230, indent: 0, parameters: [15] }, // Wait (= M1·C)
        { code: 0, indent: 0, parameters: [] },
      ] },
    // 2 parallel weather + a script write (§8.13 Script -> + M5·B)
    { id: 2, name: "Rain Ambience", trigger: 2, switchId: 1,
      list: [
        { code: 236, indent: 0, parameters: ["rain", 5, 60, false] }, // Set Weather (~= M1·C)
        { code: 355, indent: 0, parameters: ["$gameVariables.setValue(3, 1);"] }, // Script (+ M5·B)
        { code: 0, indent: 0, parameters: [] },
      ] },
  ];
}

// ---------------------------------------------------------------------------
// Tileset — one "World" tileset. A1–A5 + B–E names, and a flags[] table that
// carries every §11 tile behavior on a sample tile id. NOTE: the flag BIT
// VALUES below are the REAL RPG Maker values (verified against rmmv/rmmz
// Game_Map): ladder 0x20, bush 0x40, counter 0x80, damage 0x100,
// star/above 0x10, terrain-tag (flag >> 12). The matrix §11 lists these one
// bit low (0x10/0x20/0x40/0x80/0x0F00/0x1000) — flagged for the M0·C gate.
// ---------------------------------------------------------------------------
// RM tile-id bases (verified): A5 1536, A1 2048, A2 2816, A3 4352, A4 5888, B 0, C 256...
const TID = { A1: 2048, A2: 2816, A3: 4352, A4: 5888, A5: 1536 };
function Tilesets() {
  const flags = new Array(8192).fill(0);
  flags[TID.A2] = (3 << 12);          // grass: terrain tag 3
  flags[TID.A1] |= 0x0f;              // deep water: fully impassable (all 4 dirs)
  flags[TID.A1 + 1] |= 0x02;          // water edge: partial (one-dir) -> block + report
  flags[TID.A5 + 4] |= 0x100;         // A5 lava tile: damage floor
  flags[TID.A4] |= 0x20;              // A4 wall: ladder
  flags[16] |= 0x40;                  // B plant tile: bush
  flags[24] |= 0x10;                  // B sign tile: star (above player)
  flags[32] |= 0x80;                  // B counter tile: counter
  return [
    null,
    { id: 1, name: "World", mode: 1, note: "",
      tilesetNames: ["", "World_A1", "World_A2", "World_A3", "World_A4", "World_A5", "World_B", "World_C", "World_D", "World_E"],
      flags },
  ];
}

// ---------------------------------------------------------------------------
// Maps. RM map.data is a flat w*h*6 array: z0..z3 tile planes, z4 shadow,
// z5 region. idx(x,y,z) = (z*h + y)*w + x. We paint faithful autotile ids so
// M1·B's A1–A5 conversion + the "ugly cases" (island, peninsula, edge) have
// real input, plus region ids incl. one > 63 (clamp/report).
// ---------------------------------------------------------------------------
function buildHarbor() {
  const w = 12, h = 10, data = new Array(w * h * 6).fill(0);
  const idx = (x, y, z) => (z * h + y) * w + x;
  // z0 ground: grass everywhere (A2 blob autotile)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[idx(x, y, 0)] = TID.A2;
  // carve a water bay (A1 animated autotile) across the bottom-right
  for (let y = 6; y < h; y++) for (let x = 6; x < w; x++) data[idx(x, y, 0)] = TID.A1;
  // single-tile island of grass inside the bay (ugly autotile case)
  data[idx(9, 8, 0)] = TID.A2;
  // peninsula of grass poking into the water (ugly case)
  data[idx(6, 8, 0)] = TID.A2; data[idx(6, 9, 0)] = TID.A2;
  // a stone path (A5 plain tiles) + one lava/damage A5 tile
  for (let x = 1; x < 6; x++) data[idx(x, 5, 0)] = TID.A5;
  data[idx(3, 5, 0)] = TID.A5 + 4; // damage floor tile
  // z1 decor: bush plants (B id 16) + a counter tile (B id 32)
  data[idx(2, 2, 1)] = 16; data[idx(4, 3, 1)] = 16; data[idx(8, 1, 1)] = 32;
  // z3 over: a sign (B id 24, star flag -> renders above player)
  data[idx(3, 6, 3)] = 24;
  // z4 shadow bits on the water edge
  data[idx(6, 6, 4)] = 5; data[idx(7, 6, 4)] = 5;
  // z5 regions: region 1 over a 2x2 patch, region 5 elsewhere, region 64 (>63)
  data[idx(1, 1, 5)] = 1; data[idx(2, 1, 5)] = 1; data[idx(1, 2, 5)] = 1; data[idx(2, 2, 5)] = 1;
  data[idx(9, 2, 5)] = 5;
  data[idx(10, 2, 5)] = 64; // exceeds Atlas's 1..63 -> clamp + report
  return { w, h, data };
}

function buildCave() {
  const w = 8, h = 8, data = new Array(w * h * 6).fill(0);
  const idx = (x, y, z) => (z * h + y) * w + x;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[idx(x, y, 0)] = TID.A2; // floor
  // wall autotile (A4) ring around the edge
  for (let x = 0; x < w; x++) { data[idx(x, 0, 0)] = TID.A4; data[idx(x, h - 1, 0)] = TID.A4; }
  for (let y = 0; y < h; y++) { data[idx(0, y, 0)] = TID.A4; data[idx(w - 1, y, 0)] = TID.A4; }
  data[idx(3, 4, 0)] = TID.A5 + 4; // a damage-floor tile in the cave
  data[idx(1, 3, 5)] = 2;          // region 2
  return { w, h, data };
}

// Event page images/conditions default helpers (RM shapes).
const img = (o = {}) => Object.assign({ tileId: 0, characterName: "", characterIndex: 0, direction: 2, pattern: 1 }, o);
const pcond = (o = {}) => Object.assign({
  actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: "A", selfSwitchValid: false,
  switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0,
}, o);
const page = (o) => Object.assign({
  conditions: pcond(), image: img(), moveType: 0, moveSpeed: 3, moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
  walkAnime: true, stepAnime: false, directionFix: false, through: false, priorityType: 1, trigger: 0, list: [{ code: 0, indent: 0, parameters: [] }],
}, o);
const ev = (id, name, x, y, pages) => ({ id, name, x, y, pages });

function harborEvents(mz) {
  // Plugin command differs MV(356 string) vs MZ(357 structured) — the §0 quirk.
  const pluginCmd = mz
    ? { code: 357, indent: 0, parameters: ["CoveText", "showBanner", "showBanner", { text: "Hello from MZ" }] }
    : { code: 356, indent: 0, parameters: ["CoveText showBanner Hello from MV"] };
  return [
    // 1 Finn NPC: Show Text (escape codes) + Show Choices + Common Event call
    ev(1, "Finn", 5, 4, [page({
      image: img({ characterName: "People", characterIndex: 1, direction: 2, pattern: 1 }),
      moveType: 1, trigger: 0, priorityType: 1,
      list: [
        { code: 101, indent: 0, parameters: mz ? ["People", 1, 0, 2, "Finn"] : ["People", 1, 0, 2] }, // MZ has 5th speaker-name param
        { code: 401, indent: 0, parameters: ["\\N[1]: Ahoy, \\N[2]! The \\C[2]fire\\C[0] gem \\I[64]"] },
        { code: 401, indent: 0, parameters: ["is worth \\V[1] \\G."] },
        { code: 102, indent: 0, parameters: [["Help out", "Not now"], 1] }, // Show Choices
        { code: 402, indent: 0, parameters: [0, "Help out"] },
        { code: 121, indent: 1, parameters: [3, 3, 0] }, // Control Switch 3 ON (Met Finn)
        { code: 0, indent: 1, parameters: [] },
        { code: 402, indent: 0, parameters: [1, "Not now"] },
        { code: 0, indent: 1, parameters: [] },
        { code: 404, indent: 0, parameters: [] },
        { code: 117, indent: 0, parameters: [1] }, // Call Common Event 1
        { code: 0, indent: 0, parameters: [] },
      ],
    })]),
    // 2 Chest: self-switch two-page pattern (Change Gold + Self Switch + SE)
    ev(2, "Chest", 8, 2, [
      page({
        image: img({ characterName: "!Chest", characterIndex: 0, direction: 2, pattern: 1 }), trigger: 0, priorityType: 0,
        list: [
          { code: 125, indent: 0, parameters: [0, 0, 0, 100] }, // Change Gold +100
          { code: 250, indent: 0, parameters: [se("Chest")] }, // Play SE
          { code: 123, indent: 0, parameters: ["A", 0] }, // Self Switch A ON
          { code: 0, indent: 0, parameters: [] },
        ],
      }),
      page({
        conditions: pcond({ selfSwitchValid: true, selfSwitchCh: "A" }),
        image: img({ characterName: "!Chest", characterIndex: 0, direction: 2, pattern: 0 }), trigger: 0, priorityType: 0,
        list: [
          { code: 101, indent: 0, parameters: mz ? ["", 0, 0, 2, ""] : ["", 0, 0, 2] },
          { code: 401, indent: 0, parameters: ["It's empty now."] },
          { code: 0, indent: 0, parameters: [] },
        ],
      }),
    ]),
    // 3 Sign: SHOW PICTURE (encrypted "Sign" asset) + Wait + Erase Picture
    ev(3, "Sign", 3, 6, [page({
      trigger: 0, priorityType: 1,
      list: [
        // 231 params: [picId, name, origin, appointType, x, y, sx, sy, opacity, blend]
        { code: 231, indent: 0, parameters: [1, "Sign", 0, 0, 240, 180, 100, 100, 255, 0] },
        { code: 230, indent: 0, parameters: [60] },
        { code: 235, indent: 0, parameters: [1] }, // Erase Picture 1
        { code: 0, indent: 0, parameters: [] },
      ],
    })]),
    // 4 Door to Cave: player-touch Transfer to Map 2
    ev(4, "ToCave", 6, 0, [page({
      image: img({ tileId: 0 }), trigger: 1, priorityType: 1,
      list: [
        { code: 201, indent: 0, parameters: [0, 2, 4, 4, 2, 0] }, // Transfer -> map 2, (4,4), dir down
        { code: 0, indent: 0, parameters: [] },
      ],
    })]),
    // 5 Mover: parallel event with a custom Move Route (ugly §9 steps)
    ev(5, "Mover", 10, 8, [page({
      image: img({ characterName: "People", characterIndex: 2 }), moveType: 3, priorityType: 1, trigger: 4,
      moveRoute: { repeat: true, skippable: true, wait: false, list: [
        { code: 1, parameters: [] },  // Move Down (= down)
        { code: 14, parameters: [] }, // Jump (~=, no dx/dy)
        { code: 5, parameters: [] },  // Move Lower-Left (diagonal -> decompose + report)
        { code: 29, parameters: [3] }, // Change Speed (- skip + report)
        { code: 44, parameters: [se("Step")] }, // Play SE (~= inline CmdSe)
        { code: 45, parameters: ["this.setThrough(true);"] }, // Script (+ M5·B / mzTodo)
        { code: 0, parameters: [] },
      ] },
      list: [{ code: 0, indent: 0, parameters: [] }],
    })]),
    // 6 auxiliary parallel event running the plugin command (356/357 quirk)
    ev(6, "Banner", 0, 9, [page({
      trigger: 4, priorityType: 0,
      list: [pluginCmd, { code: 0, indent: 0, parameters: [] }],
    })]),
  ];
}

function caveEvents(mz) {
  return [
    ev(1, "Return", 4, 4, [page({
      image: img({ tileId: 0 }), trigger: 1, priorityType: 1,
      list: [
        { code: 201, indent: 0, parameters: [0, 1, 6, 1, 2, 0] }, // Transfer -> map 1
        { code: 0, indent: 0, parameters: [] },
      ],
    })]),
    // Battle Processing with win/escape/lose branches + Script + branch depth
    ev(2, "Ambush", 2, 2, [page({
      image: img({ characterName: "!Flame", characterIndex: 0 }), trigger: 0, priorityType: 1,
      list: [
        { code: 301, indent: 0, parameters: [0, 1, true, true] }, // Battle Processing troop 1, canEscape/canLose
        { code: 601, indent: 0, parameters: [] }, // If Win
        { code: 101, indent: 1, parameters: mz ? ["", 0, 0, 2, ""] : ["", 0, 0, 2] },
        { code: 401, indent: 1, parameters: ["Victory! You found the Rusty Key."] },
        { code: 126, indent: 1, parameters: [3, 0, 0, 1] }, // Change Items: Rusty Key +1
        { code: 0, indent: 1, parameters: [] },
        { code: 602, indent: 0, parameters: [] }, // If Escape
        { code: 0, indent: 1, parameters: [] },
        { code: 603, indent: 0, parameters: [] }, // If Lose
        { code: 353, indent: 1, parameters: [] }, // Game Over
        { code: 0, indent: 1, parameters: [] },
        { code: 604, indent: 0, parameters: [] }, // End battle branches
        { code: 355, indent: 0, parameters: ["if ($gameSwitches.value(2)) {"] }, // Script (+ M5·B)
        { code: 655, indent: 0, parameters: ["  $gameVariables.setValue(1, 999);"] },
        { code: 655, indent: 0, parameters: ["}"] },
        { code: 0, indent: 0, parameters: [] },
      ],
    })]),
  ];
}

function Animations(mz) {
  if (mz) {
    // MZ: Effekseer-based (effectName -> effects/*.efkefc; NOT convertible).
    return [
      null,
      { id: 1, name: "Heal", displayType: 0, effectName: "Heal", flashTimings: [{ frame: 0, duration: 5, color: [255, 255, 255, 170] }],
        soundTimings: [{ frame: 0, se: se("Heal") }], offsetX: 0, offsetY: 0, rotation: { x: 0, y: 0, z: 0 }, scale: 100, speed: 100, alignBottom: false, quakePower: 0 },
      { id: 2, name: "Fire", displayType: 0, effectName: "Fire", flashTimings: [], soundTimings: [{ frame: 2, se: se("Fire") }],
        offsetX: 0, offsetY: 0, rotation: { x: 0, y: 0, z: 0 }, scale: 100, speed: 100, alignBottom: false, quakePower: 3 },
    ];
  }
  // MV: sheet-based (animation1Name image + frames[][] cells + timings).
  const cell = (pattern) => [pattern, 0, 0, 100, 0, 0, 255, 0]; // [pattern,x,y,scale,rot,mirror,opacity,blend]
  return [
    null,
    { id: 1, name: "Heal", animation1Name: "Heal", animation1Hue: 0, animation2Name: "", animation2Hue: 0, position: 1,
      frames: [[cell(0)], [cell(1)], [cell(2)]],
      timings: [{ frame: 0, se: se("Heal"), flashScope: 1, flashColor: [255, 255, 255, 170], flashDuration: 5 }] },
    { id: 2, name: "Fire", animation1Name: "Fire", animation1Hue: 0, animation2Name: "", animation2Hue: 0, position: 1,
      frames: [[cell(0)], [cell(1)]],
      timings: [{ frame: 1, se: se("Fire"), flashScope: 0, flashColor: [0, 0, 0, 0], flashDuration: 0 }] },
  ];
}

function MapInfos() {
  // Map 2 nests under Map 1 (parentId) -> Atlas folder synthesis (§MapInfos).
  return [
    null,
    { id: 1, name: "Harbor", order: 1, parentId: 0, expanded: true, scrollX: 0, scrollY: 0 },
    { id: 2, name: "Cave", order: 2, parentId: 1, expanded: true, scrollX: 0, scrollY: 0 },
  ];
}

function mapFile(kind, events, mz) {
  const geo = kind === "harbor" ? buildHarbor() : buildCave();
  const base = {
    autoplayBgm: true, autoplayBgs: false, battleback1Name: kind === "cave" ? "Cave" : "", battleback2Name: "",
    bgm: audio(kind === "harbor" ? "Harbor" : "Cave"), bgs: audio(""), disableDashing: false,
    displayName: kind === "harbor" ? "Harbor Town" : "Sea Cave", encounterList: [], encounterStep: 30,
    height: geo.h, note: kind === "harbor" ? "<Region1: safe zone>" : "", parallaxLoopX: false, parallaxLoopY: false,
    parallaxName: kind === "harbor" ? "Sea" : "", parallaxShow: true, parallaxSx: 0, parallaxSy: 0,
    scrollType: kind === "harbor" ? 0 : 2, specifyBattleback: kind === "cave", tilesetId: 1, width: geo.w,
    data: geo.data, events: [null, ...events],
  };
  // Region-scoped random encounters (troop 1) with a regionSet -> byRegion (+ M4·A).
  base.encounterList = [{ troopId: 1, weight: 10, regionSet: kind === "harbor" ? [1, 5] : [] }];
  return base;
}

function pluginsJs() {
  // js/plugins.js — 4 entries: two Atlas has built-in (report "you already have
  // this"), one unsupported, one demo. The plugin command (356/357) targets
  // CoveText. Parsed by M5·A, never executed.
  const list = [
    { name: "CoveText", status: true, description: "Demo: banner text codes.", parameters: { BannerColor: "3", Speed: "4" } },
    { name: "YEP_QuestJournal", status: true, description: "Quest journal.", parameters: { "Show Tracker": "true" } },
    { name: "CommunityBasic", status: true, description: "Core screen resolution.", parameters: { screenWidth: "816", screenHeight: "624" } },
    { name: "OrangeMovementEx", status: false, description: "Pixel movement.", parameters: {} },
  ];
  return "//=============================================================================\n// Cove Test — plugin list (self-made fixture, no third-party code)\n//=============================================================================\n\nvar $plugins =\n" + JSON.stringify(list, null, 0) + ";\n";
}

function System(mz, keyHex) {
  const veh = (name, x, y) => ({ characterName: "Vehicle", characterIndex: 0, bgm: audio(name), startMapId: 1, startX: x, startY: y });
  const sys = {
    gameTitle: "Cove Test", versionId: 20260704,
    currencyUnit: "G", elements: ELEMENTS, skillTypes: SKILL_TYPES, weaponTypes: WEAPON_TYPES, armorTypes: ARMOR_TYPES, equipTypes: EQUIP_TYPES,
    switches: SWITCHES, variables: VARIABLES, partyMembers: [1, 2],
    boat: veh("Ship", 4, 9), ship: veh("Ship", 5, 9), airship: veh("Airship", 6, 9),
    titleBgm: audio("Theme"), battleBgm: audio("Battle"), victoryMe: audio("Victory"), defeatMe: audio("Defeat"), gameoverMe: audio("Gameover"),
    sounds: Array.from({ length: 24 }, (_, i) => se(["Cursor", "Decision", "Cancel", "Buzzer"][i] || "")),
    title1Name: "Sea", title2Name: "",
    terms: {
      basic: ["Level", "Lv", "HP", "HP", "MP", "MP", "TP", "TP"],
      params: ["Max HP", "Max MP", "Attack", "Defense", "M.Attack", "M.Defense", "Agility", "Luck"],
      commands: ["Fight", "Escape", "Attack", "Guard", "Item", "Skill", "Equip", "Status", "Formation", "Save", "Game End", "Options", "Weapon", "Armor", "Key Item", "Equip", "Optimize", "Clear", "New Game", "Continue", null, "To Title", "Cancel", null, "Buy", "Sell"],
      messages: { possession: "Possession", levelUp: "%1 is now %2 %3!", obtainSkill: "%1 learned!", actorDamage: "%1 took %2 damage!" },
    },
    startMapId: 1, startX: 6, startY: 1, optTransparent: false, optFollowers: true, optSideView: true,
    optDisplayTp: false, optDrawTitle: true, optExtraExp: false, optFloorDeath: false, optSlipDeath: false,
    battleback1Name: "", battleback2Name: "", windowTone: [16, -16, 48, 0], battleSystem: 0,
    hasEncryptedImages: true, hasEncryptedAudio: false, encryptionKey: keyHex,
    testBattlers: [{ actorId: 1, level: 3, equips: [1, 1, 0, 2, 3] }], testTroopId: 1, editMapId: 1,
  };
  if (mz) {
    sys.locale = "en_US";
    sys.tileSize = 48;
    sys.optAutosave = false;
    sys.optKeyItemsNumber = true;
    sys.itemCategories = [true, true, true, true];
    sys.menuCommands = [true, true, true, true, true, true];
    sys.advanced = {
      gameId: 424242, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624,
      numberFontFilename: "", fallbackFonts: "", fontSize: 26, mainFontFilename: "mplus-1m-regular.woff",
      windowOpacity: 192,
    };
  }
  return sys;
}

// ---------------------------------------------------------------------------
// Emit a project tree.
// ---------------------------------------------------------------------------
function build(target) {
  const mz = target === "mz";
  const keyHex = mz ? "a1b2c3d4e5f6a7b8c9d0e1f203142536" : "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const encExt = mz ? "png_" : "rpgmvp";
  const projDir = join(root, "tests", "fixtures", `${target}-project`);
  rmSync(projDir, { recursive: true, force: true });

  const writeJson = (rel, obj) => {
    const full = join(projDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, j(obj) + "\n");
  };
  const writeBin = (rel, buf) => {
    const full = join(projDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, buf);
  };
  const writeText = (rel, txt) => {
    const full = join(projDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, txt);
  };

  // Project marker file (the format sniffer keys off this).
  writeText(mz ? "Game.rmmzproject" : "Game.rpgproject", mz ? "RPGMZ 1.8.0\n" : "RPGMV 1.6.2\n");

  // data/*.json
  writeJson("data/System.json", System(mz, keyHex));
  writeJson("data/Actors.json", Actors());
  writeJson("data/Classes.json", Classes());
  writeJson("data/Skills.json", Skills());
  writeJson("data/Items.json", Items());
  writeJson("data/Weapons.json", Weapons());
  writeJson("data/Armors.json", Armors());
  writeJson("data/Enemies.json", Enemies());
  writeJson("data/Troops.json", Troops());
  writeJson("data/States.json", States());
  writeJson("data/Animations.json", Animations(mz));
  writeJson("data/Tilesets.json", Tilesets());
  writeJson("data/CommonEvents.json", CommonEvents());
  writeJson("data/MapInfos.json", MapInfos());
  writeJson("data/Map001.json", mapFile("harbor", harborEvents(mz), mz));
  writeJson("data/Map002.json", mapFile("cave", caveEvents(mz), mz));

  // Plain placeholder assets (self-made swatches / stubs).
  for (const p of ["img/characters/People.png", "img/faces/People.png", "img/tilesets/World_A1.png",
    "img/tilesets/World_A2.png", "img/tilesets/World_A4.png", "img/tilesets/World_B.png", "img/enemies/Slime.png",
    "img/system/IconSet.png", "img/parallaxes/Sea.png"])
    writeBin(p, PNG_1x1);
  writeBin("audio/bgm/Harbor.ogg", OGG_STUB);
  writeBin("audio/se/Cursor.ogg", OGG_STUB);

  // The ONE encrypted sample per project: the "Sign" picture referenced by the
  // Show Picture command (231). Decryptable with System.encryptionKey.
  writeBin(`img/pictures/Sign.${encExt}`, encrypt(PNG_1x1, keyHex));

  // js/plugins.js
  writeText("js/plugins.js", pluginsJs());

  return projDir;
}

const mvDir = build("mv");
const mzDir = build("mz");
console.log("Wrote fixtures:\n  " + mvDir + "\n  " + mzDir);
