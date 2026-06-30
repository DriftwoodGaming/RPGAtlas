"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  Assets: { T: {} },
});
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });

function evaluate(source) {
  return vm.runInContext(source, context);
}

const migrated = evaluate(`RA.migrateProject({
  meta: { engine: "driftwood", version: 2 },
  plugins: [],
  assets: {},
  system: {},
  states: [],
  skills: [{ id: 1, name: "Fireball", type: "magic" }],
  classes: [{ id: 1, name: "Legacy", base: {}, growth: {}, learnings: [] }],
  maps: []
})`);
assert.equal(migrated.meta.version, 3);
assert.equal(migrated.meta.engine, "rpgatlas");
assert.deepEqual(Array.from(migrated.classes[0].traits), []);
assert.equal(migrated.skills[0].element, "fire");

// pre-rebrand projects: Drift_* built-ins are renamed and their code refreshed
const legacyPlugins = evaluate(`RA.migrateProject({
  meta: { engine: "driftwood", version: 2, builtinsSeeded: true },
  plugins: [
    { id: 1, key: "Drift_Core", name: "Drift_Core", builtin: true, on: true, code: "/*old*/" },
    { id: 2, key: "Drift_Weather", name: "My Weather", builtin: true, on: false, code: "/*old*/" },
    { id: 3, name: "User Plugin", on: true, code: "/*user code*/" }
  ],
  assets: {}, system: {}, states: [], skills: [], classes: [], maps: []
})`);
assert.equal(legacyPlugins.plugins[0].key, "Atlas_Core");
assert.equal(legacyPlugins.plugins[0].name, "Atlas_Core");
assert.equal(legacyPlugins.plugins[0].pluginId, "atlas.core");
assert.equal(legacyPlugins.plugins[0].version, "1.0.0");
assert.ok(legacyPlugins.plugins[0].code.includes("window.Atlas"));
assert.equal(legacyPlugins.plugins[1].key, "Atlas_Weather");
assert.equal(legacyPlugins.plugins[1].name, "My Weather"); // custom names survive
assert.equal(legacyPlugins.plugins[1].pluginId, "atlas.weather");
assert.deepEqual(Array.from(legacyPlugins.plugins[1].dependencies), ["atlas.core"]);
assert.equal(legacyPlugins.plugins[1].on, false);          // disabled stays disabled
assert.equal(legacyPlugins.plugins[2].code, "/*user code*/");
assert.equal(legacyPlugins.plugins[2].pluginId, "plugin.3");
assert.equal(legacyPlugins.plugins[2].version, "1.0.0");
assert.deepEqual(Array.from(legacyPlugins.plugins[2].dependencies), []);
assert.equal(legacyPlugins.plugins.length, 3);             // seeded once already — no dupes

evaluate(`globalThis.testClass = {
  traits: [
    { type: "param", key: "atk", value: 120 },
    { type: "param", key: "atk", value: 50 },
    { type: "special", key: "critChance", value: 5 },
    { type: "special", key: "critChance", value: 10 },
    { type: "equip", key: "weapon", value: 2 },
    { type: "equip", key: "weapon", value: 4 }
  ]
}`);
assert.equal(evaluate(`RA.traitRate(testClass, "param", "atk", 1)`), 0.6);
assert.equal(evaluate(`RA.traitSum(testClass, "special", "critChance", 0)`), 15);
assert.equal(evaluate(`RA.canEquip(testClass, "weapon", 2)`), true);
assert.equal(evaluate(`RA.canEquip(testClass, "weapon", 3)`), false);
assert.equal(evaluate(`RA.canEquip(testClass, "armor", 3)`), true);
assert.equal(evaluate(`RA.elementOfSkill({ name: "Ice Shard", type: "magic" })`), "ice");
assert.equal(evaluate(`RA.elementOfSkill({ name: "Custom", type: "magic", element: "thunder" })`), "thunder");

const persisted = JSON.parse(JSON.stringify(migrated));
persisted.classes[0].traits.push({ type: "element", key: "fire", value: 75 });
const roundTrip = JSON.parse(JSON.stringify(persisted));
assert.deepEqual(roundTrip.classes[0].traits, [{ type: "element", key: "fire", value: 75 }]);

console.log("Trait tests passed.");
