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
  defaultStates() {
    return [
      { id: 1, name: "Poison", icon: 12, color: "#a050d8", restrict: "none", hpTurn: -12, minTurns: 3, maxTurns: 5, removeAtEnd: true },
      { id: 2, name: "Stun", icon: 10, color: "#e8d44f", restrict: "act", hpTurn: 0, minTurns: 1, maxTurns: 2, removeAtEnd: true },
      { id: 3, name: "Regen", icon: 11, color: "#70e090", restrict: "none", hpTurn: 8, minTurns: 3, maxTurns: 4, removeAtEnd: true },
    ];
  },
  // upgrade older projects in place (adds the decor2 layer, shadows,
  // passability overrides, plugins and custom characters)
  migrateProject(p) {
    if (!p || !p.meta) return p;
    p.meta.engine = "rpgatlas"; // also adopts pre-rebrand "driftwood" projects
    p.meta.version = 3;
    p.plugins = p.plugins || [];
    p.quests = p.quests || [];
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
    sys.sounds = Object.assign(RA.defaultSounds(), sys.sounds || {});
    sys.music = Object.assign(RA.defaultMusic(), sys.music || {});
    // v3 element/skill/weapon/armor/equipment type lists (Database ▸ Types)
    const defTypes = RA.defaultTypes();
    sys.types = sys.types || {};
    for (const k of Object.keys(defTypes)) {
      if (!Array.isArray(sys.types[k]) || !sys.types[k].length) sys.types[k] = defTypes[k];
    }
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
      classes: [0, 1, 2, 3],
      skills: [8, 11, 9, 18, 10, 15],
      items: [24, 27, 25, 31],
      weapons: [48, 49, 51, 52],
      armors: [56, 57, 58, 61],
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
    return p;
  },
};

const DataDefaults = (() => {
  const T = Assets.T;

  function newMap(id, name, width, height, groundTile) {
    const n = width * height;
    return {
      id, name, width, height,
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

    // HD-2D config (enable PIXI rendering path)
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
          { kind: "item", id: 1 }, { kind: "item", id: 2 }, { kind: "item", id: 3 },
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
      meta: { engine: "rpgatlas", version: 3, builtinsSeeded: true },
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
        fontSize: 15, windowOpacity: 93,
        sounds: RA.defaultSounds(),
        music: RA.defaultMusic(),
        types: RA.defaultTypes(),
      },
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
          learnings: [{ level: 1, skillId: 2 }, { level: 2, skillId: 8 }, { level: 6, skillId: 6 }] },
        { id: 4, name: "Rogue", icon: 3, base: { mhp: 40, mmp: 14, atk: 11, def: 8, mat: 8, mdf: 8, agi: 14 },
          growth: { mhp: 7.5, mmp: 2, atk: 2.2, def: 1.6, mat: 1.5, mdf: 1.5, agi: 2.8 },
          traits: [{ type: "param", key: "agi", value: 115 }, { type: "special", key: "critChance", value: 12 }],
          learnings: [{ level: 3, skillId: 4 }] },
      ],
      skills: [
        { id: 1, name: "Fireball",     icon: 8,  type: "magic", power: 26, mp: 5,  scope: "enemy",   color: "#f07030" },
        { id: 2, name: "Heal",         icon: 11, type: "heal",  power: 40, mp: 4,  scope: "ally",    color: "#70e090" },
        { id: 3, name: "Ice Shard",    icon: 9,  type: "magic", power: 38, mp: 8,  scope: "enemy",   color: "#80c8f0" },
        { id: 4, name: "Power Strike", icon: 18, type: "phys",  power: 24, mp: 3,  scope: "enemy",   color: "#f0d060" },
        { id: 5, name: "Thunder",      icon: 10, type: "magic", power: 34, mp: 12, scope: "enemies", color: "#e8e870" },
        { id: 6, name: "Group Heal",   icon: 15, type: "heal",  power: 30, mp: 10, scope: "allies",  color: "#70e090" },
        { id: 7, name: "Venom Sting",  icon: 12, type: "phys",  power: 8,  mp: 0,  scope: "enemy",   color: "#a050d8", stateId: 1, stateChance: 65 },
        { id: 8, name: "Purify",       icon: 11, type: "heal",  power: 10, mp: 3,  scope: "ally",    color: "#e8e8a0", stateId: 1, stateOp: "remove" },
        { id: 9, name: "Spore Cloud",   icon: 12, type: "magic", power: 12, mp: 0,  scope: "enemy",   color: "#b86ad8", stateId: 1, stateChance: 50 },
        { id: 10, name: "Bone Crush",   icon: 18, type: "phys", power: 18, mp: 0,  scope: "enemy",   color: "#e8ddba" },
        { id: 11, name: "Ember Hex",    icon: 8,  type: "magic", power: 22, mp: 0,  scope: "enemy",   color: "#ff7048" },
        { id: 12, name: "Static Burst", icon: 10, type: "magic", power: 20, mp: 0,  scope: "enemy",   color: "#8de8ff", stateId: 2, stateChance: 25 },
      ],
      states: RA.defaultStates(),
      items: [
        { id: 1, name: "Potion",    icon: 24, price: 50,  hp: 50,  mp: 0,  desc: "Restores 50 HP." },
        { id: 2, name: "Hi-Potion", icon: 27, price: 180, hp: 150, mp: 0,  desc: "Restores 150 HP." },
        { id: 3, name: "Ether",     icon: 25, price: 120, hp: 0,   mp: 30, desc: "Restores 30 MP." },
        { id: 4, name: "Elixir",    icon: 31, price: 600, hp: 9999, mp: 9999, desc: "Fully restores HP and MP." },
      ],
      weapons: [
        { id: 1, name: "Bronze Sword", icon: 48, price: 100, wtypeId: 2, params: { atk: 5 } },
        { id: 2, name: "Iron Sword",   icon: 49, price: 350, wtypeId: 2, params: { atk: 10 } },
        { id: 3, name: "Oak Staff",    icon: 51, price: 90,  wtypeId: 6, params: { atk: 3, mat: 4 } },
        { id: 4, name: "Crystal Rod",  icon: 52, price: 420, wtypeId: 7, params: { atk: 5, mat: 10 } },
      ],
      armors: [
        { id: 1, name: "Leather Vest", icon: 56, price: 80,  atypeId: 3, etypeId: 4, params: { def: 4 } },
        { id: 2, name: "Chainmail",    icon: 57, price: 320, atypeId: 4, etypeId: 4, params: { def: 9 } },
        { id: 3, name: "Cloth Robe",   icon: 58, price: 60,  atypeId: 2, etypeId: 4, params: { def: 2, mdf: 3 } },
        { id: 4, name: "Mage Cloak",   icon: 61, price: 280, atypeId: 2, etypeId: 4, params: { def: 4, mdf: 8 } },
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
