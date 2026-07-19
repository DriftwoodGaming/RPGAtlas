"use strict";

// Database ▸ Types planning lists (currency types / enemy categories / item
// rarities): defaults, the every-load-boundary backfill in migrateProject,
// and the typeList fallback. Mirrors the tests/traits.test.js vm harness.

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

// vm-realm arrays/objects carry the vm's prototypes, which deepEqual treats as
// a mismatch against host-realm literals — round-trip through JSON first.
function toHost(value) {
  return JSON.parse(JSON.stringify(value));
}

// Defaults carry the three planning lists with 1-based sequential ids.
const defaults = toHost(evaluate("RA.defaultTypes()"));
assert.deepEqual(defaults.currencyTypes.map((e) => e.name), ["Gold", "Gems", "Tokens"]);
assert.deepEqual(defaults.enemyCategories.map((e) => e.name),
  ["Beast", "Undead", "Humanoid", "Dragon", "Elemental"]);
assert.deepEqual(defaults.itemRarities.map((e) => e.name),
  ["Common", "Uncommon", "Rare", "Epic", "Legendary"]);
for (const kind of ["currencyTypes", "enemyCategories", "itemRarities"]) {
  assert.deepEqual(defaults[kind].map((e) => e.id), defaults[kind].map((_, i) => i + 1));
}

// An already-current v2 project (saved before these lists existed) gains them
// on the next load; its customized original lists are left untouched.
const v2 = toHost(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3, formatVersion: 2 },
  system: {
    types: {
      elements: [{ key: "physical", name: "Physical" }],
      skillTypes: [{ key: "phys", name: "Physical" }],
      weaponTypes: [{ id: 1, name: "Custom Blade" }],
      armorTypes: [{ id: 1, name: "Cloth" }],
      equipTypes: [{ id: 1, name: "Weapon" }]
    }
  },
  maps: []
})`));
assert.deepEqual(v2.system.types.weaponTypes, [{ id: 1, name: "Custom Blade" }]);
assert.deepEqual(v2.system.types.currencyTypes.map((e) => e.name), ["Gold", "Gems", "Tokens"]);
assert.equal(v2.system.types.enemyCategories.length, 5);
assert.equal(v2.system.types.itemRarities.length, 5);

// A project that already customized a planning list keeps it; an EMPTY list is
// treated as missing and refilled (matches the v0→v1 seeding rules).
const custom = toHost(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3, formatVersion: 2 },
  system: {
    types: {
      currencyTypes: [{ id: 1, name: "Seashells" }],
      itemRarities: []
    }
  },
  maps: []
})`));
assert.deepEqual(custom.system.types.currencyTypes, [{ id: 1, name: "Seashells" }]);
assert.equal(custom.system.types.itemRarities.length, 5);
assert.equal(custom.system.types.weaponTypes.length, 8);

// typeList falls back to the defaults for projects that lack the list.
const fallback = toHost(evaluate(`RA.typeList({ system: { types: {} } }, "currencyTypes")`));
assert.deepEqual(fallback.map((e) => e.name), ["Gold", "Gems", "Tokens"]);

console.log("types-lists tests passed");
