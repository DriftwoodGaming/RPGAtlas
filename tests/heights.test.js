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

// legacy map without a heights layer gets a zero-filled one on migration
const migrated = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Legacy", width: 4, height: 3,
    layers: { ground: new Array(12).fill(1), decor: new Array(12).fill(0), decor2: new Array(12).fill(0), over: new Array(12).fill(0) },
    shadows: new Array(12).fill(0), passOv: new Array(12).fill(0),
    events: []
  }]
})`);
assert.equal(migrated.maps[0].heights.length, 12);
assert.ok(migrated.maps[0].heights.every((h) => h === 0));

// a heights layer of the wrong size (e.g. after an external resize) is reset
const resized = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Resized", width: 5, height: 5,
    layers: { ground: new Array(25).fill(1), decor: new Array(25).fill(0), decor2: new Array(25).fill(0), over: new Array(25).fill(0) },
    shadows: new Array(25).fill(0), passOv: new Array(25).fill(0),
    heights: [1, 2, 3],
    events: []
  }]
})`);
assert.equal(resized.maps[0].heights.length, 25);
assert.ok(resized.maps[0].heights.every((h) => h === 0));

// a valid heights layer survives migration untouched
const valid = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
  maps: [{
    id: 1, name: "Hills", width: 2, height: 2,
    layers: { ground: [1,1,1,1], decor: [0,0,0,0], decor2: [0,0,0,0], over: [0,0,0,0] },
    shadows: [0,0,0,0], passOv: [0,0,0,0],
    heights: [0, 1, 2, 0],
    events: []
  }]
})`);
assert.deepEqual(Array.from(valid.maps[0].heights), [0, 1, 2, 0]);

// new maps are born with a flat heights layer
const fresh = evaluate(`DataDefaults.newMap(7, "Fresh", 6, 4, 1)`);
assert.equal(fresh.heights.length, 24);
assert.ok(fresh.heights.every((h) => h === 0));

// heights round-trip through JSON serialization (save/load)
const roundTrip = JSON.parse(JSON.stringify(valid));
assert.deepEqual(roundTrip.maps[0].heights, [0, 1, 2, 0]);

console.log("Height tests passed.");
