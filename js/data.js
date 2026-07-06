/* RPGAtlas — data.js
   Project schema, defaults, and the bundled sample game.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

const RA = {
  MAX_SWITCHES: 1000,
  MAX_VARIABLES: 1000,
  TRAIT_TYPES: [
    { v: "param", l: "Parameter modifier" },
    { v: "element", l: "Element resistance" },
    { v: "state", l: "State resistance" },
    { v: "skill", l: "Skill-type bonus" },
    { v: "equip", l: "Equipment permission" },
    { v: "special", l: "Special combat effect" },
  ],
  TRAIT_ELEMENTS: [
    { v: "physical", l: "Physical" },
    { v: "fire", l: "Fire" },
    { v: "ice", l: "Ice" },
    { v: "thunder", l: "Thunder" },
    { v: "poison", l: "Poison" },
    { v: "magic", l: "Other magic" },
  ],
  TRAIT_SPECIALS: [
    { v: "critChance", l: "Critical chance %" },
    { v: "mpCost", l: "MP cost %" },
    { v: "guardDamage", l: "Damage while guarding %" },
    { v: "damageTaken", l: "All damage taken %" },
    // Project Compass M3·A/B — MZ ex-params, sp-params, and battler flags.
    { v: "hitChance", l: "Hit chance %" },
    { v: "evadeChance", l: "Evade chance %" },
    { v: "critEvade", l: "Critical dodge %" },
    { v: "magicEvade", l: "Magic evade %" },
    { v: "magicReflect", l: "Magic bounce-back %" },
    { v: "counterAttack", l: "Counterattack %" },
    { v: "hpRegen", l: "HP regen per turn %" },
    { v: "mpRegen", l: "MP regen per turn %" },
    { v: "tpRegen", l: "TP gained per turn" },
    { v: "targetRate", l: "How often enemies aim here %" },
    { v: "guardEffect", l: "Guard strength %" },
    { v: "recovery", l: "Healing received %" },
    { v: "itemEffect", l: "Item healing received %" },
    { v: "tpCharge", l: "TP charged from damage %" },
    { v: "physDamage", l: "Physical damage taken %" },
    { v: "magicDamage", l: "Magic damage taken %" },
    { v: "floorDamage", l: "Floor damage taken %" },
    { v: "expRate", l: "EXP earned %" },
    { v: "attackSpeed", l: "Attack speed bonus" },
    { v: "attackTimes", l: "Extra attack hits % (100 = +1)" },
    { v: "attackSkill", l: "Attack uses a skill" },
    { v: "actionTimes", l: "Extra action chance %" },
    { v: "autoBattle", l: "Fights automatically" },
    { v: "guardFlag", l: "Always guarding" },
    { v: "substitute", l: "Covers weak allies" },
    { v: "preserveTp", l: "Keeps TP between battles" },
    // Project Compass M3·C — party abilities (any party member carrying one
    // grants it to the whole party, like RPG Maker's trait 64).
    { v: "encounterHalf", l: "Party: half as many random battles" },
    { v: "encounterNone", l: "Party: no random battles" },
    { v: "cancelSurprise", l: "Party: never surprised" },
    { v: "raisePreemptive", l: "Party: more first strikes" },
    { v: "goldDouble", l: "Party: double gold from battles" },
    { v: "dropDouble", l: "Party: double item drops" },
    // Post-1.1 — two-weapon fighting opens the hero's second weapon slot.
    { v: "dualWield", l: "Two-weapon fighting (second weapon slot)" },
  ],
  // Default category names seeded into proj.system.types (the Database ▸ Types tab).
  WEAPON_TYPE_NAMES: ["Dagger", "Sword", "Axe", "Spear", "Bow", "Staff", "Wand", "Claw"],
  ARMOR_TYPE_NAMES: ["General Armor", "Magic Armor", "Light Armor", "Heavy Armor", "Shield"],
  EQUIP_TYPE_NAMES: ["Weapon", "Shield", "Head", "Body", "Accessory"],
  // Elements and skill types keep a stable string key (referenced by skills,
  // class traits and the combat engine) plus an editable display name. Weapon,
  // armor and equipment types are referenced by numeric id like the other lists.
  defaultTypes() {
    return {
      elements: this.TRAIT_ELEMENTS.map((e) => ({ key: e.v, name: e.l })),
      skillTypes: [
        { key: "phys", name: "Physical" },
        { key: "magic", name: "Magical" },
        { key: "heal", name: "Heal" },
      ],
      weaponTypes: this.WEAPON_TYPE_NAMES.map((n, i) => ({ id: i + 1, name: n })),
      armorTypes: this.ARMOR_TYPE_NAMES.map((n, i) => ({ id: i + 1, name: n })),
      equipTypes: this.EQUIP_TYPE_NAMES.map((n, i) => ({ id: i + 1, name: n })),
    };
  },
  // Read one type list from a project, falling back to the defaults so older
  // saves (and the combat engine) keep working before a migration runs.
  typeList(p, kind) {
    const types = p && p.system && p.system.types;
    if (types && Array.isArray(types[kind]) && types[kind].length) return types[kind];
    return this.defaultTypes()[kind];
  },
  byId(arr, id) { return arr ? arr.find((e) => e && e.id === id) || null : null; },
  nextId(arr) { return arr.reduce((m, e) => Math.max(m, e.id), 0) + 1; },
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  traitsOf(cls, type, key) {
    return ((cls && cls.traits) || []).filter((t) =>
      t && t.type === type && (key == null || String(t.key) === String(key)));
  },
  traitRate(cls, type, key, fallback) {
    const list = this.traitsOf(cls, type, key);
    if (!list.length) return fallback == null ? 1 : fallback;
    return list.reduce((rate, t) => rate * Math.max(0, Number(t.value) || 0) / 100, 1);
  },
  traitSum(cls, type, key, fallback) {
    const list = this.traitsOf(cls, type, key);
    if (!list.length) return fallback == null ? 0 : fallback;
    return list.reduce((sum, t) => sum + (Number(t.value) || 0), 0);
  },
  canEquip(cls, kind, itemId) {
    if (!itemId) return true;
    const rules = this.traitsOf(cls, "equip", kind);
    return !rules.length || rules.some((t) => Number(t.value) === Number(itemId));
  },
  elementOfSkill(skill) {
    if (!skill || skill.type === "phys") return "physical";
    if (skill.element) return skill.element;
    const name = String(skill.name || "").toLowerCase();
    if (name.includes("fire") || name.includes("ember")) return "fire";
    if (name.includes("ice")) return "ice";
    if (name.includes("thunder") || name.includes("static")) return "thunder";
    if (name.includes("venom") || name.includes("spore") || skill.stateId === 1) return "poison";
    return "magic";
  },
  // copyright-safe font stacks offered by the System tab (generic CSS families only)
  FONTS: [
    { v: '"Segoe UI", system-ui, sans-serif', l: "Default (system sans)" },
    { v: 'Georgia, "Times New Roman", serif', l: "Serif (Georgia)" },
    { v: '"Palatino Linotype", Palatino, "Book Antiqua", serif', l: "Book serif (Palatino)" },
    { v: '"Trebuchet MS", Verdana, sans-serif', l: "Rounded sans (Trebuchet)" },
    { v: 'Consolas, "Courier New", monospace', l: "Monospace (Consolas)" },
    { v: '"Comic Sans MS", "Segoe Print", cursive', l: "Casual (Comic Sans)" },
    { v: '"Arial Black", Impact, sans-serif', l: "Display (Arial Black)" },
    { v: 'fantasy', l: "Fantasy (browser pick)" },
  ],
  DEFAULT_WINDOW_COLOR: "#12182e",
  normalizeWindowColor(value) {
    const raw = String(value == null ? "" : value).trim();
    const short = /^#([0-9a-f]{3})$/i.exec(raw);
    if (short) {
      return ("#" + short[1].split("").map((c) => c + c).join("")).toLowerCase();
    }
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : this.DEFAULT_WINDOW_COLOR;
  },
  windowColorPalette(value) {
    const hex = this.normalizeWindowColor(value);
    const rgb = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const scaled = (factor) => rgb
      .map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))))
      .join(", ");
    return {
      hex,
      top: scaled(1),
      bottom: scaled(0.6),
      nameTop: scaled(1.55),
      nameBottom: scaled(0.78),
    };
  },
  // logical UI sounds the engine plays; each maps to any procedural SE name
  SYSTEM_SOUNDS: [
    { key: "cursor", label: "Cursor move", def: "cursor" },
    { key: "ok", label: "Confirm / OK", def: "ok" },
    { key: "cancel", label: "Cancel", def: "cancel" },
    { key: "buzzer", label: "Buzzer (invalid)", def: "buzzer" },
    { key: "equip", label: "Equip / buy item", def: "item" },
    { key: "heal", label: "Use recovery item", def: "heal" },
    { key: "save", label: "Save / load game", def: "save" },
    { key: "encounter", label: "Battle start", def: "encounter" },
    { key: "escape", label: "Escape battle", def: "escape" },
    { key: "levelup", label: "Level up / victory", def: "levelup" },
    { key: "gameover", label: "Game over", def: "gameover" },
  ],
  defaultSounds() {
    const o = {};
    for (const s of this.SYSTEM_SOUNDS) o[s.key] = s.def;
    return o;
  },
  defaultMusic() { return { title: "title", battle: "battle" }; },
  defaultActionCombat() {
    return {
      enabled: false,
      enemyId: 0,
      ai: "none",
      hp: 0,
      touchDamage: 0,
      knockbackTiles: 1,
      invulnFrames: 24,
      defeatSelfSwitch: "",
    };
  },
  ACTION_COMBAT_AI: [
    { v: "none", l: "None" },
    { v: "chase", l: "Chase player" },
  ],
  defaultCommonEvent() {
    return {
      id: 0,
      name: "Common Event",
      trigger: "none",
      switchId: 0,
      commands: [],
    };
  },
  commonEventEnabled(commonEvent, switches) {
    if (!commonEvent) return false;
    return !commonEvent.switchId || !!(switches && switches[commonEvent.switchId]);
  },
  // --- Input system (keyboard + gamepad bindings, remappable) ---
  // Generic positional gamepad button names, in W3C "Standard Gamepad" index order (0..15).
  PAD_BUTTONS: [
    "face_south", "face_east", "face_west", "face_north",
    "bumper_l", "bumper_r", "trigger_l", "trigger_r",
    "select", "start", "stick_l", "stick_r",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
  ],
  // Logical input actions the engine + menus consume.
  INPUT_ACTIONS: [
    { key: "up", label: "Up" },
    { key: "down", label: "Down" },
    { key: "left", label: "Left" },
    { key: "right", label: "Right" },
    { key: "ok", label: "Confirm" },
    { key: "cancel", label: "Cancel" },
    { key: "dash", label: "Dash" },
    { key: "attack", label: "Attack" },
    { key: "hud", label: "Minimap / HUD" },
  ],
  // Default bindings. keyboard = arrays of KeyboardEvent.code; gamepad = arrays of PAD_BUTTONS
  // names. Attack keeps F for older players and J for the previous remappable-action default.
  defaultInput() {
    return {
      keyboard: {
        up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
        left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"],
        ok: ["KeyZ", "Enter", "Space"], cancel: ["KeyX", "Escape"],
        dash: ["ShiftLeft", "ShiftRight"], attack: ["KeyF", "KeyJ"],
        hud: ["KeyM"],
      },
      gamepad: {
        // Directions bind both the D-Pad and the left stick (the poller synthesizes
        // lstick_* names from the stick axes) so each is a visible, editable binding.
        up: ["dpad_up", "lstick_up"], down: ["dpad_down", "lstick_down"],
        left: ["dpad_left", "lstick_left"], right: ["dpad_right", "lstick_right"],
        ok: ["face_south"], cancel: ["face_east"], dash: ["face_west"], attack: ["face_north"],
        hud: ["select"],
      },
      stickDeadzone: 0.5,
    };
  },
  // Merge a player's override bindings over project (author) defaults, falling back to engine
  // defaults for any missing action. Pure (returns a fresh deep copy); used by the runtime at
  // boot and by the headless test.
  mergeInputBindings(projInput, override) {
    const di = this.defaultInput();
    const pick = (dev, key) =>
      projInput && projInput[dev] && Array.isArray(projInput[dev][key])
        ? projInput[dev][key]
        : di[dev][key];
    const out = { keyboard: {}, gamepad: {}, stickDeadzone: di.stickDeadzone };
    if (projInput && projInput.stickDeadzone != null) out.stickDeadzone = projInput.stickDeadzone;
    for (const a of this.INPUT_ACTIONS) {
      out.keyboard[a.key] = pick("keyboard", a.key).slice();
      out.gamepad[a.key] = pick("gamepad", a.key).slice();
    }
    if (override) {
      for (const dev of ["keyboard", "gamepad"]) {
        if (!override[dev]) continue;
        for (const a of this.INPUT_ACTIONS) {
          if (Array.isArray(override[dev][a.key])) out[dev][a.key] = override[dev][a.key].slice();
        }
      }
      if (override.stickDeadzone != null) out.stickDeadzone = override.stickDeadzone;
    }
    return out;
  },
  // Returns the action a key/button is already bound to on a device, or null. Ignores
  // `exceptAction` so re-binding an action onto a code it already owns isn't a conflict.
  inputConflict(bindings, device, code, exceptAction) {
    const dev = bindings && bindings[device];
    if (!dev) return null;
    for (const a of this.INPUT_ACTIONS) {
      if (a.key === exceptAction) continue;
      if (Array.isArray(dev[a.key]) && dev[a.key].indexOf(code) !== -1) return a.key;
    }
    return null;
  },
  // Actions that must never be left with no binding on a device, or the player could lock
  // themselves out of the menus these drive (Confirm/Cancel). The rebinder enforces it per device.
  INPUT_CRITICAL: ["ok", "cancel"],
  // Human-readable labels for raw key/button codes. Verbose form for menus/lists
  // ("Up Arrow", "Face Down (A)", KeyZ -> "Z"). These live in RA (not input.js) so the editor
  // -- which never loads runtime/input.js -- and the runtime share one source. input.js
  // delegates label formatting here lazily (RA exists by the time any input function runs).
  KB_LABELS: {
    ArrowUp: "Up Arrow", ArrowDown: "Down Arrow", ArrowLeft: "Left Arrow", ArrowRight: "Right Arrow",
    Enter: "Enter", Space: "Space", Escape: "Esc", Tab: "Tab", Backspace: "Backspace",
    ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
    AltLeft: "L-Alt", AltRight: "R-Alt",
  },
  PAD_LABELS: {
    face_south: "Face Down (A)", face_east: "Face Right (B)", face_west: "Face Left (X)", face_north: "Face Up (Y)",
    bumper_l: "L Bumper", bumper_r: "R Bumper", trigger_l: "L Trigger", trigger_r: "R Trigger",
    select: "Select", start: "Start", stick_l: "L Stick (click)", stick_r: "R Stick (click)",
    dpad_up: "D-Pad Up", dpad_down: "D-Pad Down", dpad_left: "D-Pad Left", dpad_right: "D-Pad Right",
    lstick_up: "L-Stick Up", lstick_down: "L-Stick Down", lstick_left: "L-Stick Left", lstick_right: "L-Stick Right",
  },
  // Controller "families". Bindings are stored by POSITION (face_south = W3C Standard Gamepad
  // index 0) on every controller; family only changes how a code is DRAWN/LABELLED. PAD_LABELS /
  // GLYPH_TEXT above are the Xbox (default) set; the tables below hold only the codes that differ.
  PAD_FAMILIES: [
    { key: "xbox", label: "Xbox" },
    { key: "ps", label: "PlayStation" },
    { key: "switch", label: "Nintendo Switch" },
  ],
  // Verbose label overrides per family (menus/lists). Xbox omitted -> falls back to PAD_LABELS.
  FAMILY_PAD_LABELS: {
    ps: {
      face_south: "Cross", face_east: "Circle", face_west: "Square", face_north: "Triangle",
      bumper_l: "L1", bumper_r: "R1", trigger_l: "L2", trigger_r: "R2",
      select: "Share", start: "Options", stick_l: "L3 (click)", stick_r: "R3 (click)",
    },
    switch: {
      face_south: "B Button", face_east: "A Button", face_west: "Y Button", face_north: "X Button",
      bumper_l: "L", bumper_r: "R", trigger_l: "ZL", trigger_r: "ZR",
      select: "Minus (−)", start: "Plus (+)",
    },
  },
  // Compact glyph-token overrides per family (drawn inside a chip). Xbox omitted -> GLYPH_TEXT.
  FAMILY_GLYPH_TEXT: {
    ps: {
      face_south: "✕", face_east: "○", face_west: "▢", face_north: "△",
      bumper_l: "L1", bumper_r: "R1", trigger_l: "L2", trigger_r: "R2",
    },
    switch: {
      face_south: "B", face_east: "A", face_west: "Y", face_north: "X",
      bumper_l: "L", bumper_r: "R", trigger_l: "ZL", trigger_r: "ZR",
      select: "−", start: "+",
    },
  },
  codeLabel(device, code, family) {
    if (device === "gamepad") {
      const fam = family && family !== "xbox" ? this.FAMILY_PAD_LABELS[family] : null;
      if (fam && fam[code]) return fam[code];
      return this.PAD_LABELS[code] || code;
    }
    if (this.KB_LABELS[code]) return this.KB_LABELS[code];
    if (/^Key.$/.test(code)) return code.slice(3); // KeyZ -> Z
    if (/^Digit.$/.test(code)) return code.slice(5); // Digit1 -> 1
    if (/^Numpad/.test(code)) return "Num " + code.slice(6);
    return code;
  },
  // Compact token for DRAWING a glyph chip (button icon / keycap), distinct from the verbose
  // codeLabel above. Keyboard/gamepad code namespaces don't collide, so one flat map keys both.
  GLYPH_TEXT: {
    face_south: "A", face_east: "B", face_west: "X", face_north: "Y",
    bumper_l: "LB", bumper_r: "RB", trigger_l: "LT", trigger_r: "RT",
    select: "⧉", start: "≡", stick_l: "L3", stick_r: "R3",
    dpad_up: "↑", dpad_down: "↓", dpad_left: "←", dpad_right: "→",
    lstick_up: "↑", lstick_down: "↓", lstick_left: "←", lstick_right: "→",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Space: "␣", Enter: "↵", Escape: "Esc", Backspace: "⌫", Tab: "⇥",
    ShiftLeft: "⇧", ShiftRight: "⇧", ControlLeft: "Ctrl", ControlRight: "Ctrl",
    AltLeft: "Alt", AltRight: "Alt",
  },
  glyphText(device, code, family) {
    if (device === "gamepad" && family && family !== "xbox") {
      const fov = this.FAMILY_GLYPH_TEXT[family];
      if (fov && fov[code]) return fov[code];
    }
    if (this.GLYPH_TEXT[code]) return this.GLYPH_TEXT[code];
    if (device === "keyboard") {
      if (/^Key.$/.test(code)) return code.slice(3);
      if (/^Digit.$/.test(code)) return code.slice(5);
      if (/^Numpad(.+)$/.test(code)) return code.slice(6);
    }
    return this.codeLabel(device, code, family);
  },
  // Drawing category for a button/key code, so the glyph renderer can pick a SHAPE (d-pad cross,
  // analog-stick ring, key-cap pill...) instead of just a text token. Direction (up/down/left/
  // right) is parsed from the code suffix by the renderer.
  glyphShape(code) {
    if (/^face_/.test(code)) return "face";
    if (/^dpad_/.test(code)) return "dpad";
    if (/^[lr]stick_(up|down|left|right)$/.test(code)) return "stick";
    if (code === "stick_l" || code === "stick_r") return "stick_click";
    return "pill"; // bumpers, triggers, start/select, all keyboard codes
  },
  // Classify a connected gamepad by its Gamepad.id string -> controller family. Pure (no
  // navigator access) so it's unit-testable; runtime/input.js feeds it the live pad id.
  padFamilyFromId(id) {
    const s = String(id || "").toLowerCase();
    if (/(054c|dualsense|dualshock|playstation)/.test(s)) return "ps";
    if (/(057e|pro controller|joy-?con|nintendo|switch)/.test(s)) return "switch";
    return "xbox"; // Xbox / XInput / unknown all use the Xbox positional set
  },
  defaultStates() {
    return [
      { id: 1, name: "Poison", icon: 12, color: "#a050d8", restrict: "none", hpTurn: -12, minTurns: 3, maxTurns: 5, removeAtEnd: true },
      { id: 2, name: "Stun", icon: 10, color: "#e8d44f", restrict: "act", hpTurn: 0, minTurns: 1, maxTurns: 2, removeAtEnd: true },
      { id: 3, name: "Regen", icon: 11, color: "#70e090", restrict: "none", hpTurn: 8, minTurns: 3, maxTurns: 4, removeAtEnd: true },
      { id: 4, name: "Burn", icon: 8, color: "#ff7a30", restrict: "none", hpTurn: -10, minTurns: 2, maxTurns: 4, removeAtEnd: true },
      { id: 5, name: "Bleed", icon: 18, color: "#d0384a", restrict: "none", hpTurn: -14, minTurns: 2, maxTurns: 3, removeAtEnd: true },
      { id: 6, name: "Sleep", icon: 14, color: "#7a8ad8", restrict: "act", hpTurn: 0, minTurns: 2, maxTurns: 3, removeAtEnd: true },
      { id: 7, name: "Blessing", icon: 15, color: "#f4e28a", restrict: "none", hpTurn: 12, minTurns: 3, maxTurns: 5, removeAtEnd: true },
    ];
  },
  // --- Explicit schema versioning -------------------------------------
  // project.meta.formatVersion is an integer schema version. Projects saved
  // before this field existed are treated as version 0. RA.FORMAT_VERSION is
  // the current (latest) schema version; RA.migrations is an ordered registry
  // of { version, migrate(project) } steps, each upgrading from (version - 1)
  // to `version`. migrateProject() below runs every step whose version is
  // greater than the project's current formatVersion, in ascending order,
  // then stamps meta.formatVersion to RA.FORMAT_VERSION.
  //
  // Forward-compat guard: if a project's formatVersion is ALREADY GREATER than
  // RA.FORMAT_VERSION (e.g. the file was saved by a newer build and opened in
  // an older one), migrateProject() runs NO steps and does NOT touch the
  // stamped formatVersion (never downgrade it) — the project is returned as-is
  // so an older build doesn't silently mangle a newer save format.
  FORMAT_VERSION: 2,
  migrations: [
    {
      // v0 -> v1: the pre-existing ad-hoc migration (decor2 layer, shadows,
      // passability overrides, heights, plugins, quests, custom characters,
      // input bindings, type lists, etc). Also adopts pre-rebrand "driftwood"
      // engine projects. Behavior preserved exactly from the legacy
      // (unversioned) migrateProject().
      version: 1,
      migrate(p) { RA._migrateV0toV1(p); },
    },
    {
      // v1 -> v2 (Phase 5, Gameplay Systems): purely additive backfills —
      // the animations collection, battle-mode system fields, follower/
      // minimap/vehicle settings, the per-map region layer, and per-troop
      // battle-event pages. A v1 project gains only empty/default fields;
      // behavior is unchanged until an author uses them.
      version: 2,
      migrate(p) { RA._migrateV1toV2(p); },
    },
  ],
  // upgrade older projects in place (adds the decor2 layer, shadows,
  // passability overrides, plugins and custom characters)
  _migrateV0toV1(p) {
    p.meta.engine = "rpgatlas"; // also adopts pre-rebrand "driftwood" projects
    p.meta.version = 3;
    p.plugins = p.plugins || [];
    p.quests = p.quests || [];
    p.commonEvents = Array.isArray(p.commonEvents) ? p.commonEvents : [];
    p.commonEvents = p.commonEvents
      .filter((commonEvent) => commonEvent && typeof commonEvent === "object")
      .map((commonEvent, index) => {
        const next = Object.assign(RA.defaultCommonEvent(), commonEvent);
        next.id = Number(next.id) || index + 1;
        next.name = String(next.name || "Common Event");
        next.trigger = ["none", "auto", "parallel"].includes(next.trigger)
          ? next.trigger
          : "none";
        next.switchId = Math.max(0, Number(next.switchId) || 0);
        next.commands = Array.isArray(next.commands) ? next.commands : [];
        return next;
      });
    p.customChars = p.customChars || [];
    p.commandPresets = Array.isArray(p.commandPresets) ? p.commandPresets : [];
    p.assets = p.assets || {};
    p.assets.tiles = p.assets.tiles || {};
    p.system = p.system || {};
    if (!Array.isArray(p.system.switches)) p.system.switches = [];
    if (!Array.isArray(p.system.variables)) p.system.variables = [];
    // v3 system options (screen, UI, fonts, sounds, transparency, battle view)
    const sys = p.system;
    if (sys.startTransparent == null) sys.startTransparent = false;
    if (!sys.battleView) sys.battleView = "side";
    if (!sys.screenWidth) sys.screenWidth = 816;
    if (!sys.screenHeight) sys.screenHeight = 624;
    if (sys.uiWidth == null) sys.uiWidth = 0;
    if (sys.uiHeight == null) sys.uiHeight = 0;
    if (!sys.screenScale) sys.screenScale = 1.6;
    if (!sys.fontText) sys.fontText = RA.FONTS[0].v;
    if (!sys.fontMenu) sys.fontMenu = RA.FONTS[0].v;
    if (!sys.fontSize) sys.fontSize = 15;
    if (sys.windowOpacity == null) sys.windowOpacity = 93;
    sys.windowColor = RA.normalizeWindowColor(sys.windowColor);
    sys.sounds = Object.assign(RA.defaultSounds(), sys.sounds || {});
    sys.music = Object.assign(RA.defaultMusic(), sys.music || {});
    // v3 input bindings (keyboard + gamepad, remappable). Backfill per action so a partial
    // author override survives while new/missing actions gain defaults.
    const defInput = RA.defaultInput();
    sys.input = sys.input || {};
    sys.input.keyboard = Object.assign({}, defInput.keyboard, sys.input.keyboard || {});
    sys.input.gamepad = Object.assign({}, defInput.gamepad, sys.input.gamepad || {});
    if (Array.isArray(sys.input.keyboard.attack) && sys.input.keyboard.attack.length === 1 && sys.input.keyboard.attack[0] === "KeyJ") {
      sys.input.keyboard.attack = defInput.keyboard.attack.slice();
    }
    if (sys.input.stickDeadzone == null) sys.input.stickDeadzone = defInput.stickDeadzone;
    // v3 element/skill/weapon/armor/equipment type lists (Database ▸ Types)
    const defTypes = RA.defaultTypes();
    sys.types = sys.types || {};
    for (const k of Object.keys(defTypes)) {
      if (!Array.isArray(sys.types[k]) || !sys.types[k].length) sys.types[k] = defTypes[k];
    }
    if (!Array.isArray(p.tilesets) || !p.tilesets.length) {
      p.tilesets = [{ id: 1, name: "Default", tileProps: {} }];
    }
    for (const ts of p.tilesets) ts.tileProps = ts.tileProps || {};
    for (const m of p.maps || []) if (m.tilesetId == null) m.tilesetId = 1;
    if (!Array.isArray(p.states)) p.states = RA.defaultStates();
    p.quests = (p.quests || []).filter((q) => q && typeof q === "object").map((q) => {
      const next = Object.assign({
        name: "Quest",
        shortDesc: "",
        desc: "",
        category: "side",
        visible: true,
        objectives: [],
        startReqs: [],
        failConditions: [],
        rewards: [],
        failEffects: [],
        failText: "",
        nextQuestIds: [],
        autoStartNext: false,
        allowRestartOnFail: false,
        canAbandon: false,
      }, q);
      next.objectives = (next.objectives || []).filter((obj) => obj && typeof obj === "object").map((obj) => Object.assign({
        kind: "event",
        label: "",
        count: 1,
        enemyId: 0,
        itemKind: "item",
        id: 0,
        targetMapId: 0,
        targetEventId: 0,
        consumeOnComplete: false,
      }, obj));
      next.failConditions = (next.failConditions || []).filter((fc) => fc && typeof fc === "object").map((fc) => Object.assign({
        kind: "manual",
        id: 0,
        val: true,
        cmp: ">=",
        troopId: 0,
        enemyId: 0,
        count: 1,
      }, fc));
      if (!Array.isArray(next.startReqs)) next.startReqs = [];
      if (!Array.isArray(next.failConditions)) next.failConditions = [];
      if (!Array.isArray(next.rewards)) next.rewards = [];
      if (!Array.isArray(next.failEffects)) next.failEffects = [];
      if (!Array.isArray(next.nextQuestIds)) next.nextQuestIds = [];
      return next;
    });
    for (const c of p.classes || []) {
      if (!Array.isArray(c.traits)) c.traits = [];
      c.traits = c.traits.filter((t) => t && typeof t === "object").map((t) => ({
        type: String(t.type || "param"),
        key: String(t.key || "atk"),
        value: Number(t.value == null ? 100 : t.value),
      }));
    }
    for (const skill of p.skills || []) {
      if (!skill.element) skill.element = RA.elementOfSkill(skill);
    }
    const iconDefaults = {
      classes: [0, 1, 2, 3, 64, 65, 66, 67],
      skills: [8, 11, 9, 18, 10, 15, 96, 97, 98, 99, 117, 119],
      items: [24, 27, 25, 31, 110, 104, 109, 111],
      weapons: [48, 49, 51, 52, 53, 83, 72, 79],
      armors: [56, 57, 58, 61, 55, 59, 88, 95],
    };
    for (const [key, defaults] of Object.entries(iconDefaults)) {
      for (let i = 0; i < (p[key] || []).length; i++) {
        if (p[key][i].icon == null) p[key][i].icon = defaults[i % defaults.length];
      }
    }
    for (const m of p.maps || []) {
      const n = m.width * m.height;
      if (!m.layers.decor2 || m.layers.decor2.length !== n) m.layers.decor2 = new Array(n).fill(0);
      if (!m.shadows || m.shadows.length !== n) m.shadows = new Array(n).fill(0);
      if (!m.passOv || m.passOv.length !== n) m.passOv = new Array(n).fill(0);
      if (!m.heights || m.heights.length !== n) m.heights = new Array(n).fill(0);
      for (const ev of m.events || []) {
        for (const page of ev.pages || []) {
          const hadCombatAi = page.combat && Object.prototype.hasOwnProperty.call(page.combat, "ai");
          page.combat = Object.assign(RA.defaultActionCombat(), page.combat || {});
          page.combat.enabled = !!page.combat.enabled;
          page.combat.enemyId = Number(page.combat.enemyId) || 0;
          if (!hadCombatAi && page.combat.enabled && page.moveType === "random" && Number(page.combat.touchDamage) > 0) {
            page.combat.ai = "chase";
          } else if (!RA.ACTION_COMBAT_AI.some((ai) => ai.v === page.combat.ai)) {
            page.combat.ai = RA.defaultActionCombat().ai;
          }
          page.combat.hp = Math.max(0, Number(page.combat.hp) || 0);
          page.combat.touchDamage = Math.max(0, Number(page.combat.touchDamage) || 0);
          page.combat.knockbackTiles = Math.max(0, Number(page.combat.knockbackTiles) || 0);
          page.combat.invulnFrames = Math.max(0, Number(page.combat.invulnFrames) || 0);
          if (!["", "A", "B", "C", "D"].includes(page.combat.defeatSelfSwitch)) {
            page.combat.defeatSelfSwitch = "";
          }
        }
      }
    }
    // Pre-rebrand projects carry Drift_* built-ins: rename them to Atlas_* and
    // refresh their engine-maintained code (Atlas_Core keeps a window.Drift
    // alias so old Script commands keep working).
    if (typeof AtlasBuiltins !== "undefined") {
      for (const pl of p.plugins) {
        if (!pl || typeof pl.key !== "string" || pl.key.indexOf("Drift_") !== 0) continue;
        const spec = AtlasBuiltins.specByKey(pl.key.replace("Drift_", "Atlas_"));
        if (!spec) continue;
        if (pl.name === pl.key) pl.name = spec.key;
        pl.key = spec.key;
        if (pl.builtin) pl.code = AtlasBuiltins.bodyOf(spec.fn);
      }
    }
    for (const pl of p.plugins) {
      if (!pl || typeof pl !== "object") continue;
      const spec = typeof AtlasBuiltins !== "undefined" && pl.key ? AtlasBuiltins.specByKey(pl.key) : null;
      if (spec) {
        pl.pluginId = spec.pluginId;
        pl.version = spec.version;
        pl.author = spec.author;
        pl.description = spec.desc || "";
        pl.dependencies = (spec.dependencies || []).slice();
        if (pl.builtin) pl.code = AtlasBuiltins.bodyOf(spec.fn);
      } else {
        pl.pluginId = String(pl.pluginId || pl.key || ("plugin." + (pl.id || "legacy"))).trim();
        pl.version = String(pl.version || "1.0.0").trim();
        pl.author = String(pl.author || "").trim();
        pl.description = String(pl.description || "").trim();
        pl.dependencies = Array.isArray(pl.dependencies) ? pl.dependencies.map((dep) => String(dep).trim()).filter(Boolean) : [];
      }
    }
    // Install the engine's bundled plugins once, so existing projects gain them
    // too. We only seed missing ones, and only the first time — a deliberately
    // removed built-in stays removed.
    if (!p.meta.builtinsSeeded && typeof AtlasBuiltins !== "undefined") {
      let nextId = (p.plugins.reduce((mx, pl) => Math.max(mx, pl.id || 0), 0) || 0) + 1;
      for (const spec of AtlasBuiltins.missingFor(p.plugins)) {
        p.plugins.push(AtlasBuiltins.make(spec.key, nextId++));
      }
      p.meta.builtinsSeeded = true;
    }
  },
  // v1 -> v2 (Phase 5): gameplay-systems backfills. Idempotent; every field
  // is additive and inert at its default, so a migrated project plays
  // identically until an author opts in.
  _migrateV1toV2(p) {
    if (!Array.isArray(p.animations)) p.animations = [];
    const sys = p.system || (p.system = {});
    if (sys.battleSystem !== "atb" && sys.battleSystem !== "ctb") sys.battleSystem = "turn";
    if (sys.atbWait == null) sys.atbWait = true;
    if (sys.followers == null) sys.followers = false;
    if (sys.minimap == null) sys.minimap = false;
    if (!sys.vehicles || typeof sys.vehicles !== "object") sys.vehicles = {};
    for (const m of p.maps || []) {
      const n = m.width * m.height;
      if (!Array.isArray(m.regions) || m.regions.length !== n) m.regions = new Array(n).fill(0);
    }
    for (const tr of p.troops || []) {
      if (!Array.isArray(tr.pages)) tr.pages = [];
    }
  },
  // Run every registered migration step whose version is greater than the
  // project's current meta.formatVersion (missing == 0), in ascending order,
  // then stamp meta.formatVersion to RA.FORMAT_VERSION. See the comment above
  // RA.FORMAT_VERSION for the forward-compat guard's exact behavior.
  migrateProject(p) {
    if (!p || !p.meta) return p;
    const current = Number(p.meta.formatVersion) || 0;
    if (current > RA.FORMAT_VERSION) return p; // forward-compat: don't touch it
    for (const step of RA.migrations) {
      if (step.version > current) step.migrate(p);
    }
    p.meta.formatVersion = RA.FORMAT_VERSION;
    return p;
  },
};

const DataDefaults = (() => {
  const T = Assets.T;

  function newMap(id, name, width, height, groundTile) {
    const n = width * height;
    return {
      id, name, width, height,
      tilesetId: 1,
      music: "field",
      encounters: { troops: [], rate: 0 },
      layers: {
        ground: new Array(n).fill(groundTile == null ? T.grass : groundTile),
        decor: new Array(n).fill(0),
        decor2: new Array(n).fill(0),
        over: new Array(n).fill(0),
      },
      shadows: new Array(n).fill(0),   // 4-bit quadrant mask per tile: 1=TL 2=TR 4=BL 8=BR
      passOv: new Array(n).fill(0),    // passability override: 0=auto 1=force pass 2=force block
      heights: new Array(n).fill(0),   // HD-2D elevation in tile units (visual only; 0 = flat)
      regions: new Array(n).fill(0),   // region tag per tile: 0 = none, 1-63 (Phase 5)
      events: [],
    };
  }

  function newPage() {
    return {
      name: "",
      cond: {
        switchId: 0, varId: 0, varVal: 0, selfSw: "",
        questId: 0, questStatus: "active",
        objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed",
      },
      charset: "", dir: 0,
      moveType: "fixed", trigger: "action", priority: "same", through: false,
      combat: RA.defaultActionCombat(),
      commands: [],
    };
  }

  function newEvent(id, x, y, name) {
    return { id, name: name || ("EV" + String(id).padStart(3, "0")), x, y, pages: [newPage()] };
  }

  // ---- map building helpers (sample game) ----
  function L(map, layer) { return map.layers[layer]; }
  function set(map, layer, x, y, t) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    L(map, layer)[y * map.width + x] = t;
  }
  function fillRect(map, layer, x1, y1, x2, y2, t) {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(map, layer, x, y, t);
  }
  function shadowCol(map, x, y1, y2, mask) {
    for (let y = y1; y <= y2; y++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      map.shadows[y * map.width + x] |= mask;
    }
  }
  function ev(map, x, y, name, pageSetup) {
    const e = newEvent(RA.nextId(map.events), x, y, name);
    pageSetup(e);
    map.events.push(e);
    return e;
  }
  function page(opts, commands) {
    const p = newPage();
    Object.assign(p, opts);
    if (opts.cond) p.cond = Object.assign(newPage().cond, opts.cond);
    p.commands = commands || [];
    return p;
  }

  // ---------- sample maps ----------
  function buildVillage() {
    const m = newMap(1, "Meridian Village", 24, 17, T.grass);
    m.music = "town";
    // scattered flora
    const r = (() => { let s = 99; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    for (let y = 0; y < 17; y++) for (let x = 0; x < 24; x++) {
      const v = r();
      if (v < 0.06) set(m, "ground", x, y, T.flowers);
      else if (v < 0.12) set(m, "ground", x, y, T.tallgrass);
    }
    // tree border
    for (let x = 0; x < 24; x++) { set(m, "decor", x, 0, T.tree); set(m, "decor", x, 16, T.tree); }
    for (let y = 0; y < 17; y++) { set(m, "decor", 0, y, T.tree); set(m, "decor", 23, y, T.tree); }
    set(m, "decor", 12, 0, 0); // north gap → cave
    // pond
    fillRect(m, "ground", 3, 11, 7, 14, T.water);
    fillRect(m, "ground", 4, 12, 6, 13, T.deepwater);
    fillRect(m, "ground", 3, 10, 7, 10, T.sand);
    // paths
    fillRect(m, "ground", 12, 0, 12, 16, T.path);
    fillRect(m, "ground", 1, 9, 22, 9, T.path);
    // house A (red roof, enterable)
    fillRect(m, "ground", 15, 3, 20, 6, T.dirt);
    fillRect(m, "decor", 15, 3, 20, 4, T.roof_red);
    fillRect(m, "decor", 15, 5, 20, 6, T.wall_wood);
    set(m, "decor", 17, 6, T.door);
    set(m, "decor", 19, 6, T.window);
    // house B (blue roof, locked)
    fillRect(m, "ground", 4, 2, 8, 4, T.dirt);
    fillRect(m, "decor", 4, 2, 8, 2, T.roof_blue);
    fillRect(m, "decor", 4, 3, 8, 4, T.wall_brick);
    set(m, "decor", 6, 4, T.door);
    set(m, "decor", 7, 4, T.window);
    // soft shadows along the east walls of the houses (left half of the next tile)
    shadowCol(m, 21, 4, 6, 1 | 4);
    shadowCol(m, 9, 3, 4, 1 | 4);
    // dressing
    set(m, "decor", 14, 7, T.fence); set(m, "decor", 15, 7, T.fence); set(m, "decor", 16, 7, T.fence);
    set(m, "decor", 21, 6, T.barrel);
    set(m, "decor", 2, 6, T.bush); set(m, "decor", 10, 3, T.rock);
    set(m, "decor", 18, 12, T.tree); set(m, "decor", 19, 13, T.tree); set(m, "decor", 17, 14, T.pine);
    set(m, "decor", 9, 12, T.pine);

    // HD-2D config (enable the WebGL 3D rendering path)
    m.hd2d = { enabled: true, tilt: 50, bloom: false, dof: false, fog: false, lights: true, ambient: 0.45 };
    // Light test
    m.lights = [{ rx: 12, ry: 8, color: "#FFFF00", radius: 64 }];

    // ---- events ----
    ev(m, 13, 8, "Elder", (e) => {
      e.pages[0] = page({ charset: "elder", moveType: "fixed", trigger: "action" }, [
        { t: "text", name: "Elder Rowan", text: "Welcome to \\c[2]Meridian Village\\c[0], traveler.\nBefore you head north, would you greet our merchant\nand make sure his supply crates arrived?" },
        { t: "questStart", questId: 1 },
        { t: "text", name: "", text: "Started quest: Market Introduction" },
        { t: "text", name: "Elder Rowan", text: "Press [b]Z[/b] or [b]Enter[/b] to talk and confirm.\nPress [b]X[/b] or [b]Esc[/b] to open the menu." },
      ]);
      e.pages.push(page({ cond: { questId: 1, questStatus: "active" }, charset: "elder", moveType: "fixed", trigger: "action" }, [
        { t: "text", name: "Elder Rowan", text: "Please check in with our merchant by the crossroads.\nHe has supplies waiting for the village." },
      ]));
      e.pages.push(page({ cond: { questId: 1, questStatus: "completed" }, charset: "elder", moveType: "fixed", trigger: "action" }, [
        { t: "text", name: "Elder Rowan", text: "You've already helped the village settle in.\nTilda has been asking after you as well." },
      ]));
      e.pages.push(page({ cond: { questId: 4, questStatus: "active" }, charset: "elder", moveType: "fixed", trigger: "action" }, [
        { t: "text", name: "Elder Rowan", text: "So Vale sent you with the news? I appreciate the honesty." },
        { t: "questAdvanceObj", questId: 4, objIndex: 0, amount: 1 },
        { t: "questComplete", questId: 4 },
      ]));
    });
    ev(m, 10, 11, "Villager", (e) => {
      e.pages[0] = page({ charset: "villager_m", moveType: "random", trigger: "action" }, [
        { t: "text", name: "Villager", face: "villager_m", text: "The pond is lovely this time of year.\nJust don't fall in \\i[15]!" },
      ]);
      e.pages.push(page({ cond: { questId: 3, questStatus: "active" }, charset: "villager_m", moveType: "random", trigger: "action" }, [
        { t: "text", name: "Hunter Vale", text: "Have you dealt with two dusk wolves in the cave yet?" },
      ]));
      e.pages.push(page({ cond: { questId: 3, questStatus: "active", objectiveQuestId: 3, objectiveIndex: 0, objectiveStatus: "completed" }, charset: "villager_m", moveType: "random", trigger: "action" }, [
        { t: "text", name: "Hunter Vale", text: "You really did it? Excellent work.\nI'll pay you right away." },
        { t: "questComplete", questId: 3 },
      ]));
      e.pages.push(page({ cond: { questId: 3, questStatus: "completed" }, charset: "villager_m", moveType: "random", trigger: "action" }, [
        { t: "text", name: "Hunter Vale", text: "Those dusk wolves won't trouble the road for a while.\nYou have my thanks." },
      ]));
      e.pages.push(page({ cond: { questId: 3, questStatus: "failed" }, charset: "villager_m", moveType: "random", trigger: "action" }, [
        { t: "if", cond: { kind: "quest", questId: 4, status: "completed" }, then: [
          { t: "text", name: "Hunter Vale", text: "Elder Rowan took the news better than I expected.\nThank you for smoothing things over." },
        ], else: [
          { t: "if", cond: { kind: "quest", questId: 4, status: "active" }, then: [
            { t: "text", name: "Hunter Vale", text: "Please tell Elder Rowan I had to hire another sword.\nI hate leaving him in the dark." },
          ], else: [
            { t: "text", name: "Hunter Vale", text: "I had to hire another hunter after those defeats.\nWould you at least carry the news back to Elder Rowan?" },
            { t: "questStart", questId: 4 },
          ] },
        ] },
      ]));
    });
    ev(m, 11, 8, "Sign", (e) => {
      e.pages[0] = page({ charset: "sign", trigger: "action", priority: "same" }, [
        { t: "text", name: "", text: "— Meridian Village —\nNorth: Whispering Cave" },
      ]);
    });
    ev(m, 21, 4, "Chest", (e) => {
      e.pages[0] = page({ charset: "chest", trigger: "action" }, [
        { t: "se", name: "chest" },
        { t: "item", kind: "item", id: 1, op: "add", val: 2 },
        { t: "text", name: "", text: "Found 2 Potions!" },
        { t: "selfsw", key: "A", val: true },
      ]);
      e.pages.push(page({ cond: { selfSw: "A" }, charset: "chest_open", trigger: "action" }, [
        { t: "text", name: "", text: "The chest is empty." },
      ]));
    });
    ev(m, 16, 8, "Merchant", (e) => {
      e.pages[0] = page({ charset: "merchant", trigger: "action" }, [
        { t: "if", cond: { kind: "quest", questId: 1, status: "active" }, then: [
          { t: "text", name: "Merchant", text: "Ah, Elder Rowan sent you? Good timing.\nThe supply crates made it in before sundown." },
          { t: "questAdvanceObj", questId: 1, objIndex: 0, amount: 1 },
          { t: "questComplete", questId: 1 },
          { t: "text", name: "Merchant", text: "If you see Tilda in the cottage, tell her I'm still selling Potions.\nShe looked worried earlier." },
        ], else: [] },
        { t: "text", name: "Merchant", text: "Welcome! Take a look at my wares." },
        { t: "shop", goods: [
          { kind: "item", id: 1 }, { kind: "item", id: 2 }, { kind: "item", id: 3 }, { kind: "item", id: 9 },
          { kind: "weapon", id: 1 }, { kind: "weapon", id: 2 }, { kind: "weapon", id: 3 },
          { kind: "armor", id: 1 }, { kind: "armor", id: 2 }, { kind: "armor", id: 3 },
        ] },
      ]);
    });
    ev(m, 6, 6, "Bren", (e) => {
      e.pages[0] = page({ charset: "cleric", trigger: "action" }, [
        { t: "text", name: "Bren", text: "I'm Bren, a wandering cleric.\nYou look like you could use a healer." },
        { t: "choices", options: ["Join us!", "Not now"], branches: [
          [
            { t: "party", op: "add", actorId: 3 },
            { t: "se", name: "levelup" },
            { t: "text", name: "", text: "Bren joined the party!" },
            { t: "selfsw", key: "A", val: true },
          ],
          [ { t: "text", name: "Bren", text: "I'll be here if you change your mind." } ],
        ] },
      ]);
      e.pages.push(page({ cond: { selfSw: "A" }, charset: "", trigger: "action" }, []));
    });
    ev(m, 14, 10, "Save Crystal", (e) => {
      e.pages[0] = page({ charset: "savepoint", trigger: "action", priority: "below" }, [
        { t: "se", name: "heal" },
        { t: "heal", full: true },
        { t: "text", name: "", text: "The party rests. HP and MP restored!" },
        { t: "save" },
      ]);
    });
    ev(m, 17, 6, "Door A", (e) => {
      e.pages[0] = page({ charset: "", trigger: "touch", priority: "below", through: true }, [
        { t: "se", name: "door" },
        { t: "transfer", mapId: 3, x: 4, y: 6, dir: 3 },
      ]);
    });
    ev(m, 6, 4, "Door B", (e) => {
      e.pages[0] = page({ charset: "", trigger: "touch", priority: "below", through: true }, [
        { t: "text", name: "", text: "The door is locked." },
      ]);
    });
    ev(m, 12, 0, "To Cave", (e) => {
      e.pages[0] = page({ charset: "", trigger: "touch", priority: "below", through: true }, [
        // Atlas_Transitions: an iris wipe into the cave; Atlas_Weather adds fog there.
        { t: "script", code: "if (window.Atlas) Atlas.transition = 'iris';" },
        { t: "transfer", mapId: 2, x: 8, y: 10, dir: 3 },
      ]);
    });
    return m;
  }

  function buildCave() {
    const m = newMap(2, "Whispering Cave", 16, 12, T.cavefloor);
    m.music = "cave";
    m.encounters = { troops: [1, 2, 5, 6, 7, 8, 9, 10, 11], rate: 14 };
    // walls
    fillRect(m, "decor", 0, 0, 15, 0, T.cavewall);
    fillRect(m, "decor", 0, 11, 15, 11, T.cavewall);
    fillRect(m, "decor", 0, 0, 0, 11, T.cavewall);
    fillRect(m, "decor", 15, 0, 15, 11, T.cavewall);
    set(m, "decor", 8, 11, 0); // south exit
    // formations
    fillRect(m, "decor", 3, 3, 4, 4, T.cavewall);
    fillRect(m, "decor", 11, 6, 13, 7, T.cavewall);
    set(m, "decor", 5, 8, T.rock); set(m, "decor", 12, 2, T.rock);
    fillRect(m, "ground", 1, 9, 3, 10, T.lava);
    set(m, "ground", 6, 2, T.mushroom); set(m, "ground", 10, 9, T.mushroom);

    // HD-2D showcase (Phase 2): the cave demos the new renderer features —
    // point-light shadows off the rock formations, auto materials (the lava
    // pool and crystal glow in the dark), dust motes, vignette + night grade.
    m.hd2d = {
      enabled: true, tilt: 55, lights: true, ambient: 0.3,
      pointShadows: true, materials: true, dropShadows: true,
      weather: "motes", vignette: true, lut: "night", fxaa: true,
      fog: { color: "#0a0a14" },
    };
    m.lights = [
      { rx: 8, ry: 1, color: "#88eeff", radius: 220 }, // the crystal
      { rx: 2, ry: 9.5, color: "#ff8844", radius: 260 }, // lava glow
    ];

    ev(m, 8, 2, "Guardian", (e) => {
      e.pages[0] = page({ charset: "flame", trigger: "action" }, [
        { t: "text", name: "???", text: "A hulking orc blocks the way\nto the glowing crystal!" },
        { t: "se", name: "encounter" },
        { t: "battle", troopId: 3, escape: false, lose: false },
        { t: "selfsw", key: "A", val: true },
        { t: "text", name: "", text: "The guardian has been defeated!" },
      ]);
      e.pages.push(page({ cond: { selfSw: "A" }, charset: "", trigger: "action" }, []));
    });
    ev(m, 8, 1, "Crystal", (e) => {
      e.pages[0] = page({ charset: "crystal", trigger: "action" }, [
        { t: "if", cond: { kind: "selfsw", key: "A" }, then: [
          { t: "text", name: "", text: "The crystal hums softly." },
        ], else: [
          { t: "se", name: "magic" },
          { t: "text", name: "", text: "You touch the Whispering Crystal...\nA warm light fills the party!" },
          { t: "heal", full: true },
          { t: "gold", op: "add", val: 200 },
          { t: "text", name: "", text: "Received 200 G!" },
          { t: "selfsw", key: "A", val: true },
          { t: "switch", id: 1, val: true },
        ] },
      ]);
    });
    ev(m, 8, 11, "To Village", (e) => {
      e.pages[0] = page({ charset: "", trigger: "touch", priority: "below", through: true }, [
        // back to a plain fade for the village (its perMap entry clears the fog)
        { t: "script", code: "if (window.Atlas) Atlas.transition = 'fade';" },
        { t: "transfer", mapId: 1, x: 12, y: 1, dir: 0 },
      ]);
    });
    return m;
  }

  function buildInterior() {
    const m = newMap(3, "Cottage", 10, 8, T.woodfloor);
    m.music = "town";
    fillRect(m, "decor", 0, 0, 9, 1, T.wall_wood);
    fillRect(m, "decor", 0, 2, 0, 7, T.wall_wood);
    fillRect(m, "decor", 9, 2, 9, 7, T.wall_wood);
    fillRect(m, "decor", 1, 7, 8, 7, T.wall_wood);
    set(m, "decor", 4, 7, 0); // doorway
    set(m, "decor", 3, 1, T.window); set(m, "decor", 6, 1, T.window);
    set(m, "decor", 2, 3, T.table); set(m, "decor", 1, 3, T.chair); set(m, "decor", 3, 3, T.chair);
    set(m, "decor", 7, 2, T.bed);
    set(m, "decor", 1, 2, T.shelf);
    set(m, "decor", 8, 5, T.pot);
    fillRect(m, "ground", 4, 3, 5, 5, T.carpet);

    ev(m, 5, 4, "Resident", (e) => {
      e.pages[0] = page({ charset: "villager_f", moveType: "random", trigger: "action" }, [
        { t: "if", cond: { kind: "quest", questId: 2, status: "completed" }, then: [
          { t: "text", name: "Tilda", text: "That Potion did the trick.\nThank you again for hurrying it over." },
        ], else: [
          { t: "if", cond: { kind: "quest", questId: 2, status: "active" }, then: [
            { t: "if", cond: { kind: "item", itemKind: "item", id: 1 }, then: [
              { t: "text", name: "Tilda", text: "You found a Potion? Oh, wonderful!" },
              { t: "questComplete", questId: 2 },
            ], else: [
              { t: "text", name: "Tilda", text: "If you're heading through the village, could you bring me just one Potion?\nThe merchant should have plenty." },
            ] },
          ], else: [
            { t: "if", cond: { kind: "quest", questId: 1, status: "completed" }, then: [
              { t: "text", name: "Tilda", text: "Since you're helping everyone... could you fetch me a Potion?\nI'd pay you back, of course." },
              { t: "questStart", questId: 2 },
              { t: "text", name: "", text: "Started quest: Tilda's Tonic" },
            ], else: [
              { t: "text", name: "Tilda", text: "Make yourself at home!\nThe bed is free if you need a rest." },
            ] },
          ] },
        ] },
      ]);
    });
    ev(m, 7, 2, "Bed", (e) => {
      e.pages[0] = page({ charset: "", trigger: "action", priority: "below", through: true }, [
        { t: "choices", options: ["Rest", "Leave it"], branches: [
          [
            { t: "se", name: "heal" },
            { t: "heal", full: true },
            { t: "text", name: "", text: "You take a short nap.\nHP and MP fully restored!" },
          ],
          [],
        ] },
      ]);
    });
    ev(m, 4, 7, "Exit", (e) => {
      e.pages[0] = page({ charset: "", trigger: "touch", priority: "below", through: true }, [
        { t: "se", name: "door" },
        { t: "transfer", mapId: 1, x: 17, y: 7, dir: 0 },
      ]);
    });
    return m;
  }

  // ---------- default database ----------
  function newProject() {
    const proj = {
      meta: { engine: "rpgatlas", version: 3, builtinsSeeded: true, formatVersion: RA.FORMAT_VERSION },
      plugins: typeof AtlasBuiltins !== "undefined" ? AtlasBuiltins.seed(1) : [],
      quests: [
        {
          id: 1,
          name: "Market Introduction",
          shortDesc: "Speak with the merchant for Elder Rowan.",
          desc: "Elder Rowan asked you to stop by the crossroads merchant and confirm that the village supply crates arrived safely.",
          category: "side",
          visible: true,
          objectives: [{ kind: "event", label: "Report to the merchant", count: 1 }],
          startReqs: [],
          failConditions: [],
          rewards: [{ kind: "gold", amount: 40 }],
          failEffects: [],
          failText: "",
          nextQuestIds: [2],
          autoStartNext: false,
          allowRestartOnFail: false,
          canAbandon: false,
        },
        {
          id: 2,
          name: "Tilda's Tonic",
          shortDesc: "Bring Tilda a Potion from the village shop.",
          desc: "Tilda in the cottage is feeling faint and asked for a single Potion. Buy one from the merchant and bring it to her.",
          category: "side",
          visible: true,
          objectives: [{ kind: "fetch", label: "Bring Tilda a Potion", itemKind: "item", id: 1, count: 1, targetMapId: 3, targetEventId: 1, consumeOnComplete: true }],
          startReqs: [{ kind: "quest", questId: 1, status: "completed" }],
          failConditions: [],
          rewards: [{ kind: "exp", amount: 30 }, { kind: "gold", amount: 25 }, { kind: "item", itemKind: "item", id: 3, count: 1 }],
          failEffects: [],
          failText: "",
          nextQuestIds: [],
          autoStartNext: false,
          allowRestartOnFail: false,
          canAbandon: false,
        },
        {
          id: 3,
          name: "Wolf Hunt",
          shortDesc: "Defeat two dusk wolves in Whispering Cave.",
          desc: "Hunter Vale wants the road north made safer. Defeat two dusk wolves in Whispering Cave, then return to him for your reward.",
          category: "side",
          visible: true,
          objectives: [{ kind: "kill", label: "Defeat dusk wolves", enemyId: 7, count: 2 }],
          startReqs: [],
          failConditions: [{ kind: "enemyDefeatCount", enemyId: 7, count: 2 }],
          rewards: [{ kind: "exp", amount: 45 }, { kind: "gold", amount: 35 }],
          failEffects: [{ kind: "switch", id: 2, val: "true" }, { kind: "questUnlock", questId: 4 }],
          failText: "Hunter Vale hired another hunter after too many losses, so the original reward is gone.",
          nextQuestIds: [],
          autoStartNext: false,
          allowRestartOnFail: false,
          canAbandon: true,
        },
        {
          id: 4,
          name: "Bad News Travels",
          shortDesc: "Bring Elder Rowan news of Vale's replacement hunter.",
          desc: "After failing the wolf hunt, Hunter Vale asks you to let Elder Rowan know that someone else took the contract.",
          category: "side",
          visible: true,
          objectives: [{ kind: "event", label: "Tell Elder Rowan what happened", count: 1 }],
          startReqs: [{ kind: "quest", questId: 3, status: "failed" }],
          failConditions: [],
          rewards: [{ kind: "gold", amount: 12 }],
          failEffects: [],
          failText: "",
          nextQuestIds: [],
          autoStartNext: false,
          allowRestartOnFail: false,
          canAbandon: false,
        },
      ],
      customChars: [],
      commandPresets: [],
      commonEvents: [],
      tilesets: [{ id: 1, name: "Default", tileProps: {} }],
      assets: { tiles: {} },
      system: {
        title: "Atlas Quest",
        startMapId: 1, startX: 12, startY: 12, startDir: 3,
        party: [1, 2],
        startGold: 150,
        currency: "G",
        switches: [], variables: [],
        startTransparent: false,
        battleView: "side",
        screenWidth: 816, screenHeight: 624,
        uiWidth: 0, uiHeight: 0,
        screenScale: 1.6,
        fontText: RA.FONTS[0].v, fontMenu: RA.FONTS[0].v,
        fontSize: 15, windowOpacity: 93, windowColor: RA.DEFAULT_WINDOW_COLOR,
        sounds: RA.defaultSounds(),
        music: RA.defaultMusic(),
        types: RA.defaultTypes(),
        input: RA.defaultInput(),
        battleSystem: "turn", atbWait: true,       // Phase 5 battle mode
        followers: false, minimap: false,          // Phase 5 map systems
        vehicles: {},                              // Phase 5 vehicles (boat/ship/airship)
      },
      // Battle animations (Phase 5): keyframed timelines over the battle-fx
      // primitives. `at` is in ticks (60/s); effect durations in ms.
      animations: [
        { id: 1, name: "Slash", target: "target", items: [
          { at: 0, type: "sound", se: "hit" },
          { at: 0, type: "particles", kind: "hit", shape: "burst", count: 12, radius: 44, size: 7, duration: 420 },
          { at: 4, type: "flash", anchor: "target", color: "#ffffff", opacity: 0.85, duration: 200 },
        ] },
        { id: 2, name: "Fire Burst", target: "target", items: [
          { at: 0, type: "sound", se: "magic" },
          { at: 0, type: "projectile", color: "#ff9d36", size: 10, duration: 330 },
          { at: 20, type: "particles", kind: "fire", shape: "burst", count: 18, radius: 54, size: 8, duration: 520 },
          { at: 22, type: "flash", anchor: "screen", color: "#ff8830", opacity: 0.25, duration: 260 },
          { at: 22, type: "shake", power: 4, speed: 6, duration: 18 },
        ] },
        { id: 3, name: "Healing Light", target: "target", items: [
          { at: 0, type: "sound", se: "heal" },
          { at: 0, type: "particles", kind: "heal", shape: "spiral", count: 16, radius: 42, size: 7, duration: 720 },
          { at: 30, type: "particles", kind: "heal", shape: "ring", count: 14, radius: 48, size: 6, duration: 480 },
        ] },
      ],
      actors: [
        { id: 1, name: "Ardan", classId: 1, level: 1, charset: "hero",    weaponId: 1, armorId: 1 },
        { id: 2, name: "Mira",  classId: 2, level: 1, charset: "heroine", weaponId: 3, armorId: 3 },
        { id: 3, name: "Bren",  classId: 3, level: 1, charset: "cleric",  weaponId: 3, armorId: 1 },
        { id: 4, name: "Slip",  classId: 4, level: 1, charset: "kid",     weaponId: 1, armorId: 1 },
      ],
      classes: [
        { id: 1, name: "Warrior", icon: 0, base: { mhp: 48, mmp: 10, atk: 13, def: 11, mat: 6,  mdf: 7,  agi: 8 },
          growth: { mhp: 9, mmp: 1.5, atk: 2.6, def: 2.2, mat: 1.1, mdf: 1.4, agi: 1.6 },
          traits: [{ type: "param", key: "atk", value: 110 }, { type: "special", key: "critChance", value: 8 }],
          learnings: [{ level: 3, skillId: 4 }] },
        { id: 2, name: "Mage", icon: 1, base: { mhp: 32, mmp: 24, atk: 7, def: 7, mat: 14, mdf: 11, agi: 9 },
          growth: { mhp: 5.5, mmp: 4, atk: 1.2, def: 1.3, mat: 2.8, mdf: 2.2, agi: 1.7 },
          traits: [{ type: "skill", key: "magic", value: 115 }, { type: "element", key: "fire", value: 80 }],
          learnings: [{ level: 1, skillId: 1 }, { level: 4, skillId: 3 }, { level: 7, skillId: 5 }] },
        { id: 3, name: "Cleric", icon: 2, base: { mhp: 38, mmp: 20, atk: 9, def: 9, mat: 12, mdf: 13, agi: 7 },
          growth: { mhp: 7, mmp: 3.5, atk: 1.6, def: 1.8, mat: 2.4, mdf: 2.6, agi: 1.3 },
          traits: [{ type: "skill", key: "heal", value: 120 }, { type: "state", key: "1", value: 50 }],
          learnings: [{ level: 1, skillId: 2 }, { level: 2, skillId: 8 }, { level: 5, skillId: 25 }, { level: 6, skillId: 6 }] },
        { id: 4, name: "Rogue", icon: 3, base: { mhp: 40, mmp: 14, atk: 11, def: 8, mat: 8, mdf: 8, agi: 14 },
          growth: { mhp: 7.5, mmp: 2, atk: 2.2, def: 1.6, mat: 1.5, mdf: 1.5, agi: 2.8 },
          traits: [{ type: "param", key: "agi", value: 115 }, { type: "special", key: "critChance", value: 12 }],
          learnings: [{ level: 3, skillId: 4 }] },
        { id: 5, name: "Paladin", icon: 64, base: { mhp: 50, mmp: 12, atk: 11, def: 14, mat: 7, mdf: 12, agi: 6 },
          growth: { mhp: 9.5, mmp: 1.8, atk: 2.2, def: 2.8, mat: 1.2, mdf: 2.3, agi: 1.1 },
          traits: [{ type: "param", key: "def", value: 110 }, { type: "special", key: "guardDamage", value: 70 }],
          learnings: [{ level: 2, skillId: 16 }, { level: 5, skillId: 21 }] },
        { id: 6, name: "Ranger", icon: 65, base: { mhp: 40, mmp: 12, atk: 12, def: 8, mat: 7, mdf: 8, agi: 13 },
          growth: { mhp: 7.5, mmp: 1.8, atk: 2.4, def: 1.6, mat: 1.3, mdf: 1.5, agi: 2.6 },
          traits: [{ type: "param", key: "agi", value: 110 }, { type: "special", key: "critChance", value: 10 }],
          learnings: [{ level: 1, skillId: 14 }, { level: 4, skillId: 22 }] },
        { id: 7, name: "Dark Knight", icon: 66, base: { mhp: 46, mmp: 14, atk: 14, def: 10, mat: 9, mdf: 7, agi: 8 },
          growth: { mhp: 8.5, mmp: 2, atk: 2.8, def: 1.9, mat: 1.7, mdf: 1.2, agi: 1.6 },
          traits: [{ type: "param", key: "atk", value: 115 }, { type: "special", key: "damageTaken", value: 110 }],
          learnings: [{ level: 3, skillId: 15 }, { level: 6, skillId: 18 }] },
        { id: 8, name: "Sage", icon: 67, base: { mhp: 34, mmp: 26, atk: 7, def: 8, mat: 13, mdf: 12, agi: 8 },
          growth: { mhp: 6, mmp: 4.2, atk: 1.2, def: 1.5, mat: 2.6, mdf: 2.4, agi: 1.5 },
          traits: [{ type: "skill", key: "magic", value: 110 }, { type: "skill", key: "heal", value: 110 }],
          learnings: [{ level: 1, skillId: 2 }, { level: 3, skillId: 17 }, { level: 5, skillId: 23 }, { level: 6, skillId: 25 }, { level: 8, skillId: 24 }] },
      ],
      skills: [
        { id: 1, name: "Fireball",     icon: 8,  type: "magic", power: 26, mp: 5,  scope: "enemy",   color: "#f07030", animationId: 2 },
        { id: 2, name: "Heal",         icon: 11, type: "heal",  power: 40, mp: 4,  scope: "ally",    color: "#70e090", animationId: 3 },
        { id: 3, name: "Ice Shard",    icon: 9,  type: "magic", power: 38, mp: 8,  scope: "enemy",   color: "#80c8f0" },
        { id: 4, name: "Power Strike", icon: 18, type: "phys",  power: 24, mp: 3,  scope: "enemy",   color: "#f0d060", animationId: 1 },
        { id: 5, name: "Thunder",      icon: 10, type: "magic", power: 34, mp: 12, scope: "enemies", color: "#e8e870" },
        { id: 6, name: "Group Heal",   icon: 15, type: "heal",  power: 30, mp: 10, scope: "allies",  color: "#70e090" },
        { id: 7, name: "Venom Sting",  icon: 12, type: "phys",  power: 8,  mp: 0,  scope: "enemy",   color: "#a050d8", stateId: 1, stateChance: 65 },
        { id: 8, name: "Purify",       icon: 11, type: "heal",  power: 10, mp: 3,  scope: "ally",    color: "#e8e8a0", stateId: 1, stateOp: "remove" },
        { id: 9, name: "Spore Cloud",   icon: 12, type: "magic", power: 12, mp: 0,  scope: "enemy",   color: "#b86ad8", stateId: 1, stateChance: 50 },
        { id: 10, name: "Bone Crush",   icon: 18, type: "phys", power: 18, mp: 0,  scope: "enemy",   color: "#e8ddba", stateId: 5, stateChance: 45 },
        { id: 11, name: "Ember Hex",    icon: 8,  type: "magic", power: 22, mp: 0,  scope: "enemy",   color: "#ff7048" },
        { id: 12, name: "Static Burst", icon: 10, type: "magic", power: 20, mp: 0,  scope: "enemy",   color: "#8de8ff", stateId: 2, stateChance: 25 },
        { id: 13, name: "Flame Slash",  icon: 72,  type: "phys",  power: 30, mp: 6,  scope: "enemy",   color: "#ff8040", element: "fire", animationId: 1, stateId: 4, stateChance: 40 },
        { id: 14, name: "Aimed Shot",   icon: 79,  type: "phys",  power: 26, mp: 4,  scope: "enemy",   color: "#c8e858", animationId: 1 },
        { id: 15, name: "Shadow Edge",  icon: 81,  type: "phys",  power: 34, mp: 8,  scope: "enemy",   color: "#9060c8", animationId: 1 },
        { id: 16, name: "Holy Smite",   icon: 99,  type: "magic", power: 32, mp: 8,  scope: "enemy",   color: "#f8e8a0" },
        { id: 17, name: "Blizzard",     icon: 97,  type: "magic", power: 30, mp: 13, scope: "enemies", color: "#a0d8f8", element: "ice" },
        { id: 18, name: "Inferno",      icon: 96,  type: "magic", power: 33, mp: 15, scope: "enemies", color: "#ff7030", element: "fire", animationId: 2, stateId: 4, stateChance: 35 },
        { id: 19, name: "Chain Lightning", icon: 98, type: "magic", power: 28, mp: 12, scope: "enemies", color: "#f8f080", element: "thunder" },
        { id: 20, name: "Regrowth",     icon: 117, type: "heal",  power: 26, mp: 5,  scope: "ally",    color: "#80e8a0", stateId: 3, stateChance: 100, animationId: 3 },
        { id: 21, name: "Sanctuary",    icon: 115, type: "heal",  power: 24, mp: 12, scope: "allies",  color: "#f8e8b0", animationId: 3, stateId: 7, stateChance: 100 },
        { id: 22, name: "Venom Volley", icon: 106, type: "phys",  power: 14, mp: 6,  scope: "enemies", color: "#b070d8", stateId: 1, stateChance: 45 },
        { id: 23, name: "Moonbeam",     icon: 68,  type: "magic", power: 38, mp: 11, scope: "enemy",   color: "#b0c0f8", stateId: 6, stateChance: 35 },
        { id: 24, name: "Meteor",       icon: 119, type: "magic", power: 44, mp: 20, scope: "enemies", color: "#ff9048", element: "fire", animationId: 2 },
        { id: 25, name: "Revive",       icon: 99,  type: "heal",  power: 60, mp: 16, scope: "ally",    color: "#f8e8b0", revive: true, animationId: 3 },
      ],
      states: RA.defaultStates(),
      items: [
        { id: 1, name: "Potion",    icon: 24, price: 50,  hp: 50,  mp: 0,  desc: "Restores 50 HP." },
        { id: 2, name: "Hi-Potion", icon: 27, price: 180, hp: 150, mp: 0,  desc: "Restores 150 HP." },
        { id: 3, name: "Ether",     icon: 25, price: 120, hp: 0,   mp: 30, desc: "Restores 30 MP." },
        { id: 4, name: "Elixir",    icon: 31, price: 600, hp: 9999, mp: 9999, desc: "Fully restores HP and MP." },
        { id: 5, name: "Herbal Tonic", icon: 110, price: 25,  hp: 25,  mp: 0,   desc: "A bitter field remedy. Restores 25 HP." },
        { id: 6, name: "Golden Apple", icon: 104, price: 250, hp: 120, mp: 20,  desc: "Restores 120 HP and 20 MP." },
        { id: 7, name: "Mega Ether",   icon: 109, price: 400, hp: 0,   mp: 100, desc: "Restores 100 MP." },
        { id: 8, name: "Life Elixir",  icon: 111, price: 900, hp: 500, mp: 100, desc: "Restores 500 HP and 100 MP." },
        { id: 9, name: "Phoenix Feather", icon: 112, price: 300, hp: 80, mp: 0, desc: "Revives a fallen ally, restoring 80 HP. Has no effect on the living.", revive: true },
      ],
      weapons: [
        { id: 1, name: "Bronze Sword", icon: 48, price: 100, wtypeId: 2, params: { atk: 5 } },
        { id: 2, name: "Iron Sword",   icon: 49, price: 350, wtypeId: 2, params: { atk: 10 } },
        { id: 3, name: "Oak Staff",    icon: 51, price: 90,  wtypeId: 6, params: { atk: 3, mat: 4 } },
        { id: 4, name: "Crystal Rod",  icon: 52, price: 420, wtypeId: 7, params: { atk: 5, mat: 10 } },
        { id: 5, name: "Hunting Bow",  icon: 53, price: 130, wtypeId: 5, params: { atk: 6, agi: 2 } },
        { id: 6, name: "Battle Axe",   icon: 83, price: 380, wtypeId: 3, params: { atk: 12 } },
        { id: 7, name: "Flame Sword",  icon: 72, price: 800, wtypeId: 2, params: { atk: 14, mat: 4 } },
        { id: 8, name: "Gale Bow",     icon: 79, price: 860, wtypeId: 5, params: { atk: 13, agi: 4 } },
      ],
      armors: [
        { id: 1, name: "Leather Vest", icon: 56, price: 80,  atypeId: 3, etypeId: 4, params: { def: 4 } },
        { id: 2, name: "Chainmail",    icon: 57, price: 320, atypeId: 4, etypeId: 4, params: { def: 9 } },
        { id: 3, name: "Cloth Robe",   icon: 58, price: 60,  atypeId: 2, etypeId: 4, params: { def: 2, mdf: 3 } },
        { id: 4, name: "Mage Cloak",   icon: 61, price: 280, atypeId: 2, etypeId: 4, params: { def: 4, mdf: 8 } },
        { id: 5, name: "Iron Shield",  icon: 55, price: 150, atypeId: 5, etypeId: 2, params: { def: 5 } },
        { id: 6, name: "Steel Helm",   icon: 59, price: 140, atypeId: 4, etypeId: 3, params: { def: 4 } },
        { id: 7, name: "Golden Mail",  icon: 88, price: 900, atypeId: 4, etypeId: 4, params: { def: 14, mdf: 6 } },
        { id: 8, name: "Swift Boots",  icon: 95, price: 420, atypeId: 3, etypeId: 5, params: { def: 2, agi: 6 } },
      ],
      enemies: [
        { id: 1, name: "Slime", sprite: "slime", color: "#5aa84f",
          stats: { mhp: 34, atk: 10, def: 6, mat: 4, mdf: 4, agi: 6 }, exp: 8, gold: 12,
          actions: [{ skillId: 0, weight: 5 }] },
        { id: 2, name: "Cave Bat", sprite: "bat", color: "#7a5a9a",
          stats: { mhp: 26, atk: 12, def: 4, mat: 6, mdf: 6, agi: 14 }, exp: 10, gold: 14,
          actions: [{ skillId: 0, weight: 5 }] },
        { id: 3, name: "Orc Brute", sprite: "orc", color: "#6a9a4a",
          stats: { mhp: 110, atk: 18, def: 11, mat: 6, mdf: 8, agi: 7 }, exp: 40, gold: 80,
          actions: [{ skillId: 0, weight: 5 }, { skillId: 4, weight: 2 }] },
        { id: 4, name: "Ghost", sprite: "ghost", color: "#9ab8d8",
          stats: { mhp: 44, atk: 8, def: 6, mat: 16, mdf: 14, agi: 10 }, exp: 22, gold: 30,
          actions: [{ skillId: 0, weight: 3 }, { skillId: 3, weight: 3 }] },
        { id: 5, name: "Golem", sprite: "golem", color: "#8a8a96",
          stats: { mhp: 150, atk: 22, def: 18, mat: 4, mdf: 10, agi: 4 }, exp: 60, gold: 120,
          actions: [{ skillId: 0, weight: 5 }] },
        { id: 6, name: "Wasp", sprite: "wasp", color: "#d8b04f",
          stats: { mhp: 22, atk: 14, def: 4, mat: 4, mdf: 4, agi: 18 }, exp: 9, gold: 10,
          actions: [{ skillId: 0, weight: 5 }, { skillId: 7, weight: 3 }] },
        { id: 7, name: "Dusk Wolf", sprite: "wolf", color: "#50668a",
          stats: { mhp: 52, atk: 17, def: 8, mat: 4, mdf: 7, agi: 16 }, exp: 20, gold: 24,
          actions: [{ skillId: 0, weight: 6 }, { skillId: 4, weight: 2 }] },
        { id: 8, name: "Gloomcap", sprite: "shroom", color: "#a94f91",
          stats: { mhp: 58, atk: 8, def: 9, mat: 15, mdf: 14, agi: 5 }, exp: 24, gold: 28,
          actions: [{ skillId: 0, weight: 3 }, { skillId: 9, weight: 5 }] },
        { id: 9, name: "Boneguard", sprite: "skeleton", color: "#b8ad91",
          stats: { mhp: 68, atk: 18, def: 12, mat: 5, mdf: 8, agi: 10 }, exp: 28, gold: 34,
          actions: [{ skillId: 0, weight: 5 }, { skillId: 10, weight: 3 }] },
        { id: 10, name: "Cinder Imp", sprite: "imp", color: "#b7464f",
          stats: { mhp: 46, atk: 10, def: 7, mat: 19, mdf: 12, agi: 15 }, exp: 30, gold: 38,
          actions: [{ skillId: 0, weight: 2 }, { skillId: 11, weight: 5 }] },
        { id: 11, name: "Shardling", sprite: "crystal", color: "#50b9d0",
          stats: { mhp: 82, atk: 12, def: 17, mat: 18, mdf: 18, agi: 6 }, exp: 36, gold: 48,
          actions: [{ skillId: 0, weight: 3 }, { skillId: 12, weight: 4 }] },
        { id: 12, name: "Mire Serpent", sprite: "serpent", color: "#4f9a72",
          stats: { mhp: 74, atk: 20, def: 10, mat: 10, mdf: 11, agi: 13 }, exp: 34, gold: 42,
          actions: [{ skillId: 0, weight: 5 }, { skillId: 7, weight: 3 }] },
      ],
      troops: [
        { id: 1, name: "Slime x2", enemies: [1, 1] },
        { id: 2, name: "Bat Flock", enemies: [2, 2, 2] },
        { id: 3, name: "Orc Patrol", enemies: [3, 1] },
        { id: 4, name: "Ghosts", enemies: [4, 4] },
        { id: 5, name: "Wasp Swarm", enemies: [6, 6] },
        { id: 6, name: "Dusk Pack", enemies: [7, 7] },
        { id: 7, name: "Fungal Circle", enemies: [8, 1, 8] },
        { id: 8, name: "Bone Patrol", enemies: [9, 9] },
        { id: 9, name: "Cinder Mischief", enemies: [10, 10, 2] },
        { id: 10, name: "Crystal Ward", enemies: [11, 4] },
        { id: 11, name: "Mire Hunters", enemies: [12, 6] },
      ],
      maps: [],
    };
    for (let i = 1; i <= 50; i++) proj.system.switches.push("");
    for (let i = 1; i <= 50; i++) proj.system.variables.push("");
    proj.system.switches[0] = "Crystal Found";
    proj.system.switches[1] = "Wolf Hunt Lost";
    proj.maps = [buildVillage(), buildCave(), buildInterior()];
    return proj;
  }

  return { newProject, newMap, newEvent, newPage };
})();
if (typeof window !== "undefined") {
  window.RA = RA;
  window.DataDefaults = DataDefaults;
}
