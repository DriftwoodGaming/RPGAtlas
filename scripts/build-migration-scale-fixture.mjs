/* RPGAtlas — scripts/build-migration-scale-fixture.mjs
   Project Compass · M6·B: a script-generated "community-scale" RPG Maker project
   — the stress fixture the MZ/MV importer is round-trip QA'd against. Where the
   two hand-authored M0·B fixtures ("Cove Test", 2 maps) prove *coverage* — one
   playthrough touches every conversion path — this generator proves *scale*: a
   project the size a real community game reaches, so the importer's perf budget,
   memory, and save/load round-trip are exercised on realistic volume.

   Targets (locked by the roadmap M6·B line): 50+ maps, 500+ events, a full
   database (actors / classes / skills / items / weapons / armors / enemies /
   troops / states / common events / animations / tilesets / 50 switches / 50
   variables). Deterministic (seeded PRNG) + idempotent — rerun ⇒ byte-identical.

   Legal (locked decision 5): every byte here is our own — no RTP, no DLC, no
   RPG-Maker-exported data. Content is procedurally synthesized from the same
   self-made building blocks the M0·B fixtures use; the events cycle through the
   real RM command shapes the M1·C translator already converts, so a big project
   exercises the whole pipeline at volume rather than adding new conversion paths.

   Usage:
     node scripts/build-migration-scale-fixture.mjs [--format mv|mz] [--maps N] [--out DIR]
   Default: writes an MZ project to tests/fixtures/scale-project/ (git-ignored —
   it is regenerable and large; the tests build it in memory via buildScaleProject).

   The builder is ALSO exported (`buildScaleProject`) so tests-unit consume it
   without touching disk — same object-map shape objectSource() wants.
   GPL-3.0-or-later (see LICENSE). */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — every run produces byte-identical output.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Readable JSON printer (pure-number arrays inline; matches the M0·B generator).
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

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);
const OGG_STUB = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60, 0)]);

const se = (name) => ({ name, volume: 90, pitch: 100, pan: 0 });
const audio = (name) => ({ name, pan: 0, pitch: 100, volume: 90 });

// A full-length RM param curve (levels 0..99, index 0 unused).
function curve(base, growth, bend = 0) {
  const a = [];
  for (let lv = 0; lv < 100; lv++) a.push(Math.round(base + growth * (lv - 1) + bend * Math.max(0, lv - 50)));
  a[0] = 0;
  return a;
}

// ---------------------------------------------------------------------------
// Database — "full", but generated: N of each record with varied traits/effects
// so the converters' aggregation (report counts) and merge paths see volume.
// ---------------------------------------------------------------------------
const ELEMENTS = ["", "Physical", "Fire", "Ice", "Thunder", "Water", "Earth", "Wind", "Light", "Dark"];
const SKILL_TYPES = ["", "Magic", "Special", "Song"];
const WEAPON_TYPES = ["", "Dagger", "Sword", "Axe", "Bow", "Staff"];
const ARMOR_TYPES = ["", "General Armor", "Magic Armor", "Light Armor", "Heavy Armor"];
const EQUIP_TYPES = ["", "Weapon", "Shield", "Head", "Body", "Accessory"];

function classParams(i) {
  const b = 300 + i * 20;
  return [curve(b, 40, i % 3), curve(60 + i * 5, 8), curve(24 + i, 5), curve(20 + i, 4),
    curve(18 + i, 3, i % 2), curve(20, 3), curve(26, 4), curve(15, 2)];
}

function Classes(n) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: i, name: "Class " + i, expParams: [30, 20, 30, 30], params: classParams(i),
      learnings: [{ level: 2, skillId: ((i * 2) % 20) + 2, note: "" }, { level: 5, skillId: ((i * 3) % 20) + 2, note: "" }],
      traits: [
        { code: 11, dataId: 2 + (i % 6), value: 0.5 },        // Element Rate
        { code: 21, dataId: 2 + (i % 6), value: 1.1 },         // Param rate
        { code: 21, dataId: 7, value: 1.2 },                   // Luck -> locked skip + report
        { code: 22, dataId: 0, value: 0.95 },                  // Ex-Param HIT
        { code: 51, dataId: 1 + (i % 5), value: 0 },           // Equip weapon type
      ],
      note: "",
    });
  }
  return out;
}

function Actors(n) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: i, name: "Hero " + i, nickname: i % 2 ? "the Bold" : "", classId: ((i - 1) % 8) + 1,
      initialLevel: 1 + (i % 5), maxLevel: 99,
      characterName: "People", characterIndex: i % 8, faceName: "People", faceIndex: i % 8, battlerName: "Hero_SV",
      equips: [((i % 20) || 1), ((i % 20) || 1), 0, ((i % 20) || 2), ((i % 20) || 3)],
      traits: i % 3 === 0 ? [{ code: 11, dataId: 2, value: 0.5 }] : [],
      profile: "Adventurer number " + i + ".", note: "",
    });
  }
  return out;
}

function Skills(n) {
  const out = [null];
  // Reserve 1 = Attack, 2 = Guard (RM convention), then varied.
  out.push({ id: 1, name: "Attack", iconIndex: 76, stypeId: 0, mpCost: 0, tpCost: 0, scope: 1, occasion: 1,
    damage: { type: 1, elementId: -1, formula: "a.atk * 4 - b.def * 2", variance: 20, critical: true },
    effects: [{ code: 21, dataId: 0, value1: 1, value2: 0 }],
    animationId: -1, repeats: 1, message1: "", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0, note: "" });
  for (let i = 2; i <= n; i++) {
    const heal = i % 4 === 0;
    out.push({
      id: i, name: "Skill " + i, iconIndex: 64 + (i % 16), stypeId: 1 + (i % 3), mpCost: 4 + (i % 8), tpCost: i % 3 === 0 ? 25 : 0,
      scope: heal ? 7 : 1, occasion: 1,
      damage: heal
        ? { type: 3, elementId: 0, formula: "(a.mat * 2) + 50", variance: 0, critical: false }
        : { type: 1, elementId: 2 + (i % 6), formula: "a.mat * 2 - b.mdf + v[" + (1 + (i % 40)) + "]", variance: 20, critical: true },
      effects: heal
        ? [{ code: 11, dataId: 0, value1: 0.0, value2: 100 }]
        : [{ code: 21, dataId: 1 + (i % 2), value1: 0.5, value2: 0 }, { code: 32, dataId: 2 + (i % 4), value1: 4, value2: 0 }],
      animationId: 1 + (i % 8), repeats: 1, message1: "casts %1!", message2: "", requiredWtypeId1: 0, requiredWtypeId2: 0,
      note: i % 5 === 0 ? "<Cooldown: 3>" : "" });
  }
  return out;
}

function Items(n) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    const key = i % 7 === 0;
    out.push({
      id: i, name: (key ? "Key " : "Item ") + i, iconIndex: 176 + (i % 8), description: "A useful thing (#" + i + ").",
      itypeId: key ? 2 : 1, price: 20 + i * 5, consumable: !key, scope: key ? 0 : 7, occasion: key ? 3 : 0,
      speed: 0, successRate: 100, repeats: 1, tpGain: 0, hitType: 0, animationId: 0,
      damage: { type: key ? 0 : 3, elementId: 0, formula: "0", variance: 0, critical: false },
      effects: key ? [] : [{ code: 11, dataId: 0, value1: 0, value2: 100 + i }], note: "" });
  }
  return out;
}

function Weapons(n) {
  const out = [null];
  for (let i = 1; i <= n; i++)
    out.push({ id: i, name: "Weapon " + i, iconIndex: 96 + (i % 12), description: "", wtypeId: 1 + (i % 5), price: 100 + i * 10,
      etypeId: 1, animationId: 1, params: [0, 0, 8 + (i % 12), 0, 0, 0, 2, 3],
      traits: i % 2 ? [{ code: 31, dataId: 2 + (i % 6), value: 0 }] : [], note: "" });
  return out;
}

function Armors(n) {
  const out = [null];
  for (let i = 1; i <= n; i++)
    out.push({ id: i, name: "Armor " + i, iconIndex: 128 + (i % 12), description: "", atypeId: 1 + (i % 4),
      etypeId: 2 + (i % 4), price: 60 + i * 8, params: [0, 0, 0, 4 + (i % 8), 0, 2, 0, 0],
      traits: i % 3 ? [{ code: 21, dataId: 3, value: 1.05 }] : [], note: "" });
  return out;
}

function States(n) {
  const out = [null];
  for (let i = 1; i <= n; i++)
    out.push({ id: i, name: "State " + i, iconIndex: 4 + (i % 16), restriction: i % 5 === 0 ? 4 : 0, priority: 50, motion: 0, overlay: 0,
      removeAtBattleEnd: i % 2 === 0, removeByRestriction: false, autoRemovalTiming: 1, minTurns: 2, maxTurns: 5,
      removeByDamage: true, chanceByDamage: 100, removeByWalking: i % 3 === 0, stepsToRemove: 100,
      traits: i % 4 === 0 ? [{ code: 22, dataId: 7, value: -0.1 }] : [],
      message1: " is afflicted!", message2: "", message3: "", message4: " recovered.", note: "" });
  return out;
}

function Enemies(n) {
  const out = [null];
  for (let i = 1; i <= n; i++)
    out.push({ id: i, name: "Enemy " + i, battlerName: "Monster", battlerHue: (i * 20) % 360,
      params: [100 + i * 10, 0, 12 + (i % 10), 8 + (i % 6), 4, 6, 10, 5], exp: 10 + i * 2, gold: 8 + i,
      dropItems: [{ kind: 1, dataId: 1 + (i % 20), denominator: 2 }, { kind: 0, dataId: 0, denominator: 1 }, { kind: 0, dataId: 0, denominator: 1 }],
      actions: [
        { skillId: 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 },
        { skillId: 2 + (i % 10), conditionType: 1, conditionParam1: 2, conditionParam2: 3, rating: 4 },
      ],
      traits: [{ code: 11, dataId: 3, value: 2.0 }], note: i % 10 === 0 ? "<Boss>" : "" });
  return out;
}

function Troops(n, enemyCount) {
  const out = [null];
  const cond = (o) => Object.assign({
    turnEnding: false, turnValid: false, turnA: 0, turnB: 0, enemyValid: false, enemyIndex: 0, enemyHp: 100,
    actorValid: false, actorId: 1, actorHp: 100, switchValid: false, switchId: 1,
  }, o);
  for (let i = 1; i <= n; i++) {
    const e1 = 1 + (i % enemyCount), e2 = 1 + ((i + 3) % enemyCount);
    out.push({
      id: i, name: "Troop " + i,
      members: [
        { enemyId: e1, x: 200, y: 300, hidden: false },
        { enemyId: e2, x: 400, y: 300, hidden: false },
        { enemyId: e1, x: 300, y: 240, hidden: i % 2 === 0 },
      ],
      pages: [
        { conditions: cond({ turnValid: true, turnA: 2, turnB: 0 }), span: 1,
          list: [
            { code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] },
            { code: 401, indent: 0, parameters: ["The enemies close in!"] },
            { code: 0, indent: 0, parameters: [] },
          ] },
      ],
    });
  }
  return out;
}

function CommonEvents(n) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    const trigger = i % 3; // 0 none, 1 autorun, 2 parallel
    out.push({ id: i, name: "Common " + i, trigger, switchId: 1 + (i % 40),
      list: [
        { code: 224, indent: 0, parameters: [[255, 255, 255, 170], 15, false] }, // Flash Screen
        { code: 230, indent: 0, parameters: [15] },                                // Wait
        { code: 355, indent: 0, parameters: ["$gameVariables.setValue(" + (1 + (i % 40)) + ", 1);"] }, // Script (mzTodo write path)
        { code: 0, indent: 0, parameters: [] },
      ] });
  }
  return out;
}

function Animations(n, mz) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    if (mz)
      out.push({ id: i, name: "Anim " + i, displayType: 0, effectName: i % 2 ? "Fire" : "Heal",
        flashTimings: [{ frame: 0, duration: 5, color: [255, 255, 255, 170] }],
        soundTimings: [{ frame: 0, se: se("Hit") }], offsetX: 0, offsetY: 0,
        rotation: { x: 0, y: 0, z: 0 }, scale: 100, speed: 100, alignBottom: false, quakePower: 0 });
    else {
      const cell = (p) => [p, 0, 0, 100, 0, 0, 255, 0];
      out.push({ id: i, name: "Anim " + i, animation1Name: i % 2 ? "Fire" : "Heal", animation1Hue: 0,
        animation2Name: "", animation2Hue: 0, position: 1,
        frames: [[cell(0)], [cell(1)], [cell(2)]],
        timings: [{ frame: 0, se: se("Hit"), flashScope: 1, flashColor: [255, 255, 255, 170], flashDuration: 5 }] });
    }
  }
  return out;
}

const TID = { A1: 2048, A2: 2816, A3: 4352, A4: 5888, A5: 1536 };
function Tilesets(n) {
  const out = [null];
  for (let i = 1; i <= n; i++) {
    const flags = new Array(8192).fill(0);
    flags[TID.A2] = (3 << 12);       // grass terrain tag 3
    flags[TID.A1] |= 0x0f;           // deep water impassable
    flags[TID.A5 + 4] |= 0x100;      // lava damage floor
    flags[TID.A4] |= 0x20;           // wall ladder
    flags[16] |= 0x40;               // bush
    flags[24] |= 0x10;               // star (above)
    out.push({ id: i, name: "Tileset " + i, mode: 1, note: "",
      tilesetNames: ["", "World_A1", "World_A2", "World_A3", "World_A4", "World_A5", "World_B", "World_C", "World_D", "World_E"],
      flags });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Map + event generation. Each map paints a faithful little scene and carries a
// procedurally chosen bundle of events; templates are the exact RM command
// shapes the M1·C translator converts, so 500+ events = the whole command set
// under load rather than one novel path.
// ---------------------------------------------------------------------------
function buildMapGeo(rng, w, h) {
  const data = new Array(w * h * 6).fill(0);
  const idx = (x, y, z) => (z * h + y) * w + x;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[idx(x, y, 0)] = TID.A2; // grass
  // a water bay
  const bx = 3 + Math.floor(rng() * 3), by = 3 + Math.floor(rng() * 3);
  for (let y = by; y < h; y++) for (let x = bx; x < w; x++) if (rng() > 0.2) data[idx(x, y, 0)] = TID.A1;
  data[idx(w - 2, h - 2, 0)] = TID.A2; // single-tile island (ugly autotile case)
  // a wall ring segment (A4) + a damage tile
  for (let x = 0; x < w; x++) data[idx(x, 0, 0)] = TID.A4;
  data[idx(1 + Math.floor(rng() * (w - 2)), 1 + Math.floor(rng() * (h - 2)), 0)] = TID.A5 + 4;
  // decor + a region patch (incl. one >63 to exercise clamp+report on ~1/8 maps)
  data[idx(2, 2, 1)] = 16;
  data[idx(1, 1, 5)] = 1 + Math.floor(rng() * 5);
  if (rng() > 0.85) data[idx(2, 1, 5)] = 64;
  return { w, h, data };
}

const img = (o = {}) => Object.assign({ tileId: 0, characterName: "", characterIndex: 0, direction: 2, pattern: 1 }, o);
const pcond = (o = {}) => Object.assign({
  actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: "A", selfSwitchValid: false,
  switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0,
}, o);
const page = (o) => Object.assign({
  conditions: pcond(), image: img(), moveType: 0, moveSpeed: 3, moveFrequency: 3,
  moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
  walkAnime: true, stepAnime: false, directionFix: false, through: false, priorityType: 1, trigger: 0,
  list: [{ code: 0, indent: 0, parameters: [] }],
}, o);

// One event, chosen from a template family by `kind`. `ctx` carries per-project
// counts so refs (maps/troops/items/switches/vars) stay in range.
function makeEvent(kind, id, x, y, ctx, mz) {
  switch (kind) {
    case 0: // NPC: show text (escape codes) + choices + call common event
      return { id, name: "NPC" + id, x, y, pages: [page({
        image: img({ characterName: "People", characterIndex: id % 8 }), moveType: 1, trigger: 0, priorityType: 1,
        list: [
          { code: 101, indent: 0, parameters: mz ? ["People", id % 8, 0, 2, "NPC"] : ["People", id % 8, 0, 2] },
          { code: 401, indent: 0, parameters: ["Hello, \\N[1]! The \\C[2]gem\\C[0] \\I[64] is worth \\V[1] \\G."] },
          { code: 102, indent: 0, parameters: [["Yes", "No"], 1] },
          { code: 402, indent: 0, parameters: [0, "Yes"] },
          { code: 121, indent: 1, parameters: [1 + (id % ctx.switches), 1 + (id % ctx.switches), 0] },
          { code: 0, indent: 1, parameters: [] },
          { code: 402, indent: 0, parameters: [1, "No"] },
          { code: 0, indent: 1, parameters: [] },
          { code: 404, indent: 0, parameters: [] },
          { code: 117, indent: 0, parameters: [1 + (id % ctx.commonEvents)] },
          { code: 0, indent: 0, parameters: [] },
        ],
      })] };
    case 1: // Chest: self-switch two-page (gold + SE + self switch)
      return { id, name: "Chest" + id, x, y, pages: [
        page({ image: img({ characterName: "!Chest", characterIndex: 0 }), trigger: 0, priorityType: 0,
          list: [
            { code: 125, indent: 0, parameters: [0, 0, 50 + id] },
            { code: 250, indent: 0, parameters: [se("Chest")] },
            { code: 126, indent: 0, parameters: [1 + (id % ctx.items), 0, 0, 1] }, // Change Items
            { code: 123, indent: 0, parameters: ["A", 0] },
            { code: 0, indent: 0, parameters: [] },
          ] }),
        page({ conditions: pcond({ selfSwitchValid: true, selfSwitchCh: "A" }),
          image: img({ characterName: "!Chest", characterIndex: 0, pattern: 0 }), trigger: 0, priorityType: 0,
          list: [
            { code: 101, indent: 0, parameters: mz ? ["", 0, 0, 2, ""] : ["", 0, 0, 2] },
            { code: 401, indent: 0, parameters: ["It's empty now."] },
            { code: 0, indent: 0, parameters: [] },
          ] }),
      ] };
    case 2: // Door: player-touch transfer to another map
      return { id, name: "Door" + id, x, y, pages: [page({
        image: img({ tileId: 0 }), trigger: 1, priorityType: 1,
        list: [
          { code: 201, indent: 0, parameters: [0, 1 + (id % ctx.maps), 3, 3, 2, 0] },
          { code: 0, indent: 0, parameters: [] },
        ],
      })] };
    case 3: // Mover: parallel move route with ugly steps + inline SE + script
      return { id, name: "Mover" + id, x, y, pages: [page({
        image: img({ characterName: "People", characterIndex: 2 }), moveType: 3, priorityType: 1, trigger: 4,
        moveRoute: { repeat: true, skippable: true, wait: false, list: [
          { code: 1, parameters: [] }, { code: 14, parameters: [] }, { code: 5, parameters: [] },
          { code: 29, parameters: [3] }, { code: 44, parameters: [se("Step")] },
          { code: 45, parameters: ["this.setThrough(true);"] }, { code: 0, parameters: [] },
        ] },
        list: [{ code: 0, indent: 0, parameters: [] }],
      })] };
    case 4: // Battle event: battle processing with win/escape/lose + script branch
      return { id, name: "Fight" + id, x, y, pages: [page({
        image: img({ characterName: "!Flame", characterIndex: 0 }), trigger: 0, priorityType: 1,
        list: [
          { code: 301, indent: 0, parameters: [0, 1 + (id % ctx.troops), true, true] },
          { code: 601, indent: 0, parameters: [] },
          { code: 101, indent: 1, parameters: mz ? ["", 0, 0, 2, ""] : ["", 0, 0, 2] },
          { code: 401, indent: 1, parameters: ["Victory!"] },
          { code: 0, indent: 1, parameters: [] },
          { code: 602, indent: 0, parameters: [] },
          { code: 0, indent: 1, parameters: [] },
          { code: 603, indent: 0, parameters: [] },
          { code: 353, indent: 1, parameters: [] },
          { code: 0, indent: 1, parameters: [] },
          { code: 604, indent: 0, parameters: [] },
          { code: 355, indent: 0, parameters: ["if ($gameSwitches.value(2)) {"] },
          { code: 655, indent: 0, parameters: ["  $gameVariables.setValue(1, 999);"] },
          { code: 655, indent: 0, parameters: ["}"] },
          { code: 0, indent: 0, parameters: [] },
        ],
      })] };
    case 5: // Audio busker: the M4·B audio bill (BGM/BGS/ME/SE + fades)
    default:
      return { id, name: "Audio" + id, x, y, pages: [page({
        image: img({ characterName: "People", characterIndex: 3 }), trigger: 0, priorityType: 1,
        list: [
          { code: 241, indent: 0, parameters: [{ name: "Harbor", volume: 80, pitch: 120, pan: -20 }] },
          { code: 245, indent: 0, parameters: [{ name: "Waves", volume: 60, pitch: 100, pan: 0 }] },
          { code: 250, indent: 0, parameters: [{ name: "Cursor", volume: 90, pitch: 150, pan: 40 }] },
          { code: 242, indent: 0, parameters: [3] },
          { code: 0, indent: 0, parameters: [] },
        ],
      })] };
  }
}

function pluginsJs() {
  const list = [
    { name: "CoveText", status: true, description: "Demo: banner text codes.", parameters: { BannerColor: "3" } },
    { name: "YEP_QuestJournal", status: true, description: "Quest journal.", parameters: {} },
    { name: "VisuMZ_1_BattleCore", status: true, description: "Battle core.", parameters: {} },
    { name: "CommunityBasic", status: true, description: "Core screen resolution.", parameters: { screenWidth: "816" } },
    { name: "OrangeMovementEx", status: false, description: "Pixel movement.", parameters: {} },
  ];
  return "//=============================================================================\n// Scale Test — plugin list (self-made fixture, no third-party code)\n//=============================================================================\n\nvar $plugins =\n" + JSON.stringify(list, null, 0) + ";\n";
}

// ---------------------------------------------------------------------------
// The exported builder — returns { files, stats } for objectSource() / disk.
// ---------------------------------------------------------------------------
export function buildScaleProject(opts = {}) {
  const mz = (opts.format || "mz") === "mz";
  const mapCount = opts.maps ?? 60;
  const rng = mulberry32(opts.seed ?? 0x5ca1e);
  const keyHex = mz ? "a1b2c3d4e5f6a7b8c9d0e1f203142536" : "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

  // Full DB sizing.
  const DB = { actors: 12, classes: 8, skills: 40, items: 30, weapons: 24, armors: 24,
    enemies: 30, troops: 20, states: 20, commonEvents: 24, animations: 12, tilesets: 6 };
  const SW = 50, VAR = 50;

  const files = {};
  const put = (rel, obj) => { files[rel] = j(obj) + "\n"; };

  // System.
  const switches = ["", ...Array.from({ length: SW }, (_, i) => "Switch " + (i + 1))];
  const variables = ["", ...Array.from({ length: VAR }, (_, i) => "Var " + (i + 1))];
  const sys = {
    gameTitle: "Compass Scale Test", versionId: 20260705,
    currencyUnit: "G", elements: ELEMENTS, skillTypes: SKILL_TYPES, weaponTypes: WEAPON_TYPES,
    armorTypes: ARMOR_TYPES, equipTypes: EQUIP_TYPES, switches, variables, partyMembers: [1, 2, 3],
    boat: { characterName: "Vehicle", characterIndex: 0, bgm: audio("Ship"), startMapId: 1, startX: 4, startY: 8 },
    ship: { characterName: "Vehicle", characterIndex: 0, bgm: audio("Ship"), startMapId: 1, startX: 5, startY: 8 },
    airship: { characterName: "Vehicle", characterIndex: 0, bgm: audio("Airship"), startMapId: 1, startX: 6, startY: 8 },
    titleBgm: audio("Theme"), battleBgm: audio("Battle"), victoryMe: audio("Victory"), defeatMe: audio("Defeat"), gameoverMe: audio("Gameover"),
    sounds: Array.from({ length: 24 }, (_, i) => se(["Cursor", "Decision", "Cancel", "Buzzer"][i] || "Sound")),
    title1Name: "Sea", title2Name: "",
    terms: {
      basic: ["Level", "Lv", "HP", "HP", "MP", "MP", "TP", "TP"],
      params: ["Max HP", "Max MP", "Attack", "Defense", "M.Attack", "M.Defense", "Agility", "Luck"],
      commands: ["Fight", "Escape", "Attack", "Guard", "Item", "Skill", "Equip", "Status", "Formation", "Save", "Game End", "Options", "Weapon", "Armor", "Key Item", "Equip", "Optimize", "Clear", "New Game", "Continue", null, "To Title", "Cancel", null, "Buy", "Sell"],
      messages: { possession: "Possession", levelUp: "%1 is now %2 %3!", obtainSkill: "%1 learned!", actorDamage: "%1 took %2 damage!" },
    },
    startMapId: 1, startX: 5, startY: 1, optTransparent: false, optFollowers: true, optSideView: true,
    optDisplayTp: mz, optDrawTitle: true, optExtraExp: false, optFloorDeath: false, optSlipDeath: false,
    battleback1Name: "", battleback2Name: "", windowTone: [16, -16, 48, 0], battleSystem: 0,
    hasEncryptedImages: false, hasEncryptedAudio: false, encryptionKey: keyHex,
    testBattlers: [{ actorId: 1, level: 3, equips: [1, 1, 0, 2, 3] }], testTroopId: 1, editMapId: 1,
  };
  if (mz) {
    sys.locale = "en_US"; sys.tileSize = 48; sys.optAutosave = false; sys.optKeyItemsNumber = true;
    sys.itemCategories = [true, true, true, true]; sys.menuCommands = [true, true, true, true, true, true];
    sys.advanced = { gameId: 424242, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624,
      numberFontFilename: "", fallbackFonts: "", fontSize: 26, mainFontFilename: "mplus-1m-regular.woff", windowOpacity: 192 };
  }
  put("data/System.json", sys);
  put("data/Actors.json", Actors(DB.actors));
  put("data/Classes.json", Classes(DB.classes));
  put("data/Skills.json", Skills(DB.skills));
  put("data/Items.json", Items(DB.items));
  put("data/Weapons.json", Weapons(DB.weapons));
  put("data/Armors.json", Armors(DB.armors));
  put("data/Enemies.json", Enemies(DB.enemies));
  put("data/Troops.json", Troops(DB.troops, DB.enemies));
  put("data/States.json", States(DB.states));
  put("data/Animations.json", Animations(DB.animations, mz));
  put("data/Tilesets.json", Tilesets(DB.tilesets));
  put("data/CommonEvents.json", CommonEvents(DB.commonEvents));

  // MapInfos: a tree — every 6th map nests under the previous top-level one.
  const mapInfos = [null];
  let lastTop = 0;
  const ctx = { maps: mapCount, troops: DB.troops, items: DB.items, switches: SW, commonEvents: DB.commonEvents };
  let totalEvents = 0;
  for (let m = 1; m <= mapCount; m++) {
    const parentId = m % 6 === 0 && lastTop ? lastTop : 0;
    if (parentId === 0) lastTop = m;
    mapInfos.push({ id: m, name: "Map " + m, order: m, parentId, expanded: false, scrollX: 0, scrollY: 0 });

    const w = 10 + Math.floor(rng() * 6), h = 8 + Math.floor(rng() * 6);
    const geo = buildMapGeo(rng, w, h);
    // ~9-11 events per map -> comfortably over 500 total.
    const evCount = 9 + Math.floor(rng() * 3);
    const events = [null];
    for (let e = 1; e <= evCount; e++) {
      const ex = 1 + Math.floor(rng() * (w - 2)), ey = 1 + Math.floor(rng() * (h - 2));
      events.push(makeEvent(e % 6, e, ex, ey, ctx, mz));
      totalEvents++;
    }
    const map = {
      autoplayBgm: true, autoplayBgs: m % 4 === 0, battleback1Name: "", battleback2Name: "",
      bgm: audio("Field"), bgs: m % 4 === 0 ? { name: "Wind", volume: 80, pitch: 100, pan: 0 } : audio(""),
      disableDashing: false, displayName: "Region " + m, encounterList: [{ troopId: 1 + (m % DB.troops), weight: 10, regionSet: [] }],
      encounterStep: 30, height: geo.h, note: "", parallaxLoopX: false, parallaxLoopY: false,
      parallaxName: m % 3 === 0 ? "Sea" : "", parallaxShow: true, parallaxSx: 0, parallaxSy: 0,
      scrollType: 0, specifyBattleback: false, tilesetId: 1 + (m % DB.tilesets), width: geo.w,
      data: geo.data, events,
    };
    put("data/Map" + String(m).padStart(3, "0") + ".json", map);
  }
  put("data/MapInfos.json", mapInfos);

  files["js/plugins.js"] = pluginsJs();
  files[mz ? "Game.rmmzproject" : "Game.rpgproject"] = mz ? "RPGMZ 1.8.0\n" : "RPGMV 1.6.2\n";
  // A handful of placeholder assets (self-made) so intake discovers real paths.
  for (const p of ["img/characters/People.png", "img/faces/People.png", "img/tilesets/World_A1.png",
    "img/tilesets/World_A2.png", "img/tilesets/World_A4.png", "img/enemies/Monster.png", "img/system/IconSet.png",
    "img/parallaxes/Sea.png"])
    files[p] = PNG_1x1;
  files["audio/bgm/Field.ogg"] = OGG_STUB;

  const stats = { format: mz ? "mz" : "mv", maps: mapCount, events: totalEvents, switches: SW, variables: VAR, ...DB };
  return { files, stats };
}

// ---------------------------------------------------------------------------
// CLI: write a project tree to disk (default MZ, tests/fixtures/scale-project/).
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const format = opt("format", "mz");
  const maps = Number(opt("maps", "60"));
  const out = opt("out", join(root, "tests", "fixtures", "scale-project"));

  const { files, stats } = buildScaleProject({ format, maps });
  rmSync(out, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(files)) {
    const full = join(out, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof data === "string" ? data : data);
  }
  console.log("Wrote scale fixture:\n  " + out);
  console.log("  stats:", JSON.stringify(stats));
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
