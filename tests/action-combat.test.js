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

const page = evaluate("DataDefaults.newPage()");
assert.deepEqual(JSON.parse(JSON.stringify(page.combat)), {
  enabled: false,
  enemyId: 0,
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
      combat: { enabled: true, enemyId: 7, hp: "25", touchDamage: "3", knockbackTiles: "2", invulnFrames: "18", defeatSelfSwitch: "A" },
      commands: []
    }] }]
  }]
})`);
const combat = migrated.maps[0].events[0].pages[0].combat;
assert.equal(combat.enabled, true);
assert.equal(combat.enemyId, 7);
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
assert.equal(legacy.maps[0].events[0].pages[0].combat.knockbackTiles, 1);

console.log("Action combat tests passed.");
