"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  Assets: { T: {} },
  window: {},
});
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
vm.runInContext(fs.readFileSync("js/runtime/input.js", "utf8"), context, { filename: "js/runtime/input.js" });

function evaluate(source) {
  return vm.runInContext(source, context);
}

const engineSource = fs.readFileSync("src/engine/engine.js", "utf8");
const mapRuntimeSource = fs.readFileSync("src/engine/scenes/map-runtime.ts", "utf8");
const mapSceneSource = fs.readFileSync("src/engine/scenes/map.ts", "utf8");

// Phase 1 Stage B: the combat geometry helpers moved to
// src/engine/scenes/map-runtime.ts. Bundle the real module with esbuild and
// drive its exports instead of extracting function text out of the monolith.
// The deps seam reads window.RPGAtlasDeps at module evaluation and the module
// reads the ?hd2d dev override off location.search, so both are stubbed.
const combatHelpers = (() => {
  const { buildSync } = require("esbuild");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const entry = `export {
    rectsOverlap, entityHurtbox, swordHitboxAt, swordHitsEntity,
    tileDistance, eventBlocksChaseTile,
  } from ${JSON.stringify(
    path.join(root, "src/engine/scenes/map-runtime.ts").replace(/\\/g, "/"),
  )};`;
  const out = buildSync({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true, format: "cjs", write: false, platform: "node", logLevel: "silent",
  }).outputFiles[0].text;
  const mod = { exports: {} };
  vm.runInNewContext(out, {
    module: mod, exports: mod.exports, require, console,
    window: { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: {} } },
    location: { search: "" },
    URLSearchParams,
  });
  return mod.exports;
})();

const page = evaluate("DataDefaults.newPage()");
assert.deepEqual(JSON.parse(JSON.stringify(page.combat)), {
  enabled: false,
  enemyId: 0,
  ai: "none",
  hp: 0,
  touchDamage: 0,
  knockbackTiles: 1,
  invulnFrames: 24,
  defeatSelfSwitch: "",
});

const migrated = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Field", width: 3, height: 3,
    layers: { ground: new Array(9).fill(1), decor: new Array(9).fill(0), decor2: new Array(9).fill(0), over: new Array(9).fill(0) },
    shadows: new Array(9).fill(0), passOv: new Array(9).fill(0), heights: new Array(9).fill(0),
    events: [{ id: 1, name: "Wolf", x: 1, y: 1, pages: [{
      name: "", cond: {}, charset: "wolf", dir: 0,
      moveType: "random", trigger: "action", priority: "same", through: false,
      combat: { enabled: true, enemyId: 7, ai: "chase", hp: "25", touchDamage: "3", knockbackTiles: "2", invulnFrames: "18", defeatSelfSwitch: "A" },
      commands: []
    }] }]
  }]
})`);
const combat = migrated.maps[0].events[0].pages[0].combat;
assert.equal(combat.enabled, true);
assert.equal(combat.enemyId, 7);
assert.equal(combat.ai, "chase");
assert.equal(combat.hp, 25);
assert.equal(combat.touchDamage, 3);
assert.equal(combat.knockbackTiles, 2);
assert.equal(combat.invulnFrames, 18);
assert.equal(combat.defeatSelfSwitch, "A");

const legacy = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Legacy", width: 2, height: 2,
    layers: { ground: [1,1,1,1], decor: [0,0,0,0], decor2: [0,0,0,0], over: [0,0,0,0] },
    shadows: [0,0,0,0], passOv: [0,0,0,0], heights: [0,0,0,0],
    events: [{ id: 1, name: "Old", x: 0, y: 0, pages: [{
      name: "", cond: {}, charset: "", dir: 0,
      moveType: "fixed", trigger: "action", priority: "same", through: false,
      commands: []
    }] }]
  }]
})`);
assert.equal(legacy.maps[0].events[0].pages[0].combat.enabled, false);
assert.equal(legacy.maps[0].events[0].pages[0].combat.ai, "none");
assert.equal(legacy.maps[0].events[0].pages[0].combat.knockbackTiles, 1);

const implicitChase = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Implicit", width: 2, height: 2,
    layers: { ground: [1,1,1,1], decor: [0,0,0,0], decor2: [0,0,0,0], over: [0,0,0,0] },
    shadows: [0,0,0,0], passOv: [0,0,0,0], heights: [0,0,0,0],
    events: [{ id: 1, name: "Wolf", x: 0, y: 0, pages: [{
      name: "", cond: {}, charset: "", dir: 0,
      moveType: "random", trigger: "action", priority: "same", through: false,
      combat: { enabled: true, enemyId: 7, touchDamage: 3 },
      commands: []
    }] }]
  }]
})`);
assert.equal(implicitChase.maps[0].events[0].pages[0].combat.ai, "chase", "old implicit chase enemies migrate to explicit AI");

const attacker = { x: 5, y: 5, rx: 5, ry: 5 };
const adjacentTargets = [
  { dir: 0, target: { x: 5, y: 6, rx: 5, ry: 6 }, label: "south" },
  { dir: 1, target: { x: 4, y: 5, rx: 4, ry: 5 }, label: "west" },
  { dir: 2, target: { x: 6, y: 5, rx: 6, ry: 5 }, label: "east" },
  { dir: 3, target: { x: 5, y: 4, rx: 5, ry: 4 }, label: "north" },
];
for (const { dir, target, label } of adjacentTargets) {
  assert.equal(combatHelpers.swordHitsEntity(attacker, target, dir), true, "slash hits adjacent " + label + " tile");
}
assert.equal(
  combatHelpers.swordHitsEntity(attacker, { x: 6, y: 5, rx: 6.75, ry: 5.75 }, 2),
  true,
  "slash still hits the intended adjacent tile when render hurtboxes drift mid-step",
);
assert.equal(
  combatHelpers.swordHitsEntity(attacker, { x: 7, y: 5, rx: 7, ry: 5 }, 2),
  false,
  "slash does not reach two tiles away",
);
assert.equal(combatHelpers.tileDistance(attacker, { x: 5, y: 6 }), 1);
const solidChaser = { page: { through: false } };
const throughChaser = { page: { through: true } };
const destinationHolder = {
  x: 4,
  y: 5,
  tx: 5,
  ty: 5,
  moving: true,
  erased: false,
  page: { priority: "same", through: false },
};
assert.equal(
  combatHelpers.eventBlocksChaseTile(solidChaser, destinationHolder, 5, 5),
  true,
  "non-through chasers reserve another event's moving destination",
);
assert.equal(
  combatHelpers.eventBlocksChaseTile(throughChaser, destinationHolder, 5, 5),
  false,
  "through chasers can still overlap another event's destination",
);
assert.equal(
  combatHelpers.eventBlocksChaseTile(solidChaser, { ...destinationHolder, page: { priority: "same", through: true } }, 5, 5),
  false,
  "through events do not block chasers",
);

// Map action combat must consume the named Attack action, not inspect a physical key.
// Pin both sides of the integration: the map update loop (scenes/map.ts since Phase 1
// Stage B) asks Input for "attack", and the input layer resolves a project-defined
// replacement binding. The combat/chase internals live in scenes/map-runtime.ts.
assert.match(mapSceneSource, /Input\.consume\(["']attack["']\)/, "map update consumes the Attack action");
assert.doesNotMatch(engineSource, /case\s+["']KeyJ["']/, "engine has no hardcoded J attack branch");
assert.doesNotMatch(mapSceneSource, /case\s+["']KeyJ["']/, "map update has no hardcoded J attack branch");
assert.doesNotMatch(mapRuntimeSource, /case\s+["']KeyJ["']/, "map runtime has no hardcoded J attack branch");
assert.match(mapRuntimeSource, /tileDistance\(p, rt\) > 1/, "touch damage can strike from an adjacent tile");
assert.match(mapRuntimeSource, /function combatChaseDir\(rt/, "action-combat enemies have chase AI");
assert.match(mapRuntimeSource, /combatAi\(cfg\) !== ["']chase["']/, "chase AI is gated by the page combat AI setting");
assert.match(mapRuntimeSource, /canCombatChasePass\(rt, rt\.x \+ mx, rt\.y \+ my\)/, "chase AI checks event destination reservations");
assert.match(mapSceneSource, /const chaseDir = combatChaseDir\(rt\)/, "event movement uses chase AI before random wandering");

const handlers = {};
const bindings = evaluate("RA.defaultInput()");
bindings.keyboard.attack = ["KeyK"];
const Input = evaluate("createInputSystem")({
  defaultBindings: bindings,
  document: { addEventListener(type, fn) { handlers[type] = fn; } },
  window: { addEventListener() {} },
  navigator: { getGamepads: () => [] },
  isMenuOpen: () => false,
  onMenuNav() {},
});
Input.attachDOM();
const keyEvent = (code) => ({ code, repeat: false, preventDefault() {} });

handlers.keydown(keyEvent("KeyF"));
Input.poll();
assert.equal(Input.consume("attack"), false, "the old default key does not attack after rebinding");
handlers.keyup(keyEvent("KeyF"));

handlers.keydown(keyEvent("KeyK"));
Input.poll();
assert.equal(Input.consume("attack"), true, "the remapped key triggers the Attack action");

console.log("Action combat tests passed.");
