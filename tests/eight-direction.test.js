"use strict";

// Focused coverage for optional eight-direction grid movement: schema/default
// persistence, simultaneous keyboard input, diagonal deltas/corner blocking,
// runtime movement, combat reach, and the editor/runtime wiring.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const context = vm.createContext({ console, Assets: { T: {} }, window: {} });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
vm.runInContext(fs.readFileSync("js/runtime/input.js", "utf8"), context, { filename: "js/runtime/input.js" });
const evaluate = (source) => vm.runInContext(source, context);

assert.equal(evaluate("DataDefaults.newProject().system.eightDirectionMovement"), false,
  "new projects keep four-direction movement by default");
assert.equal(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", formatVersion: RA.FORMAT_VERSION },
  assets: {}, system: {}, maps: []
}).system.eightDirectionMovement`), false, "current projects backfill the opt-in as off");
assert.equal(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", formatVersion: RA.FORMAT_VERSION },
  assets: {}, system: { eightDirectionMovement: true }, maps: []
}).system.eightDirectionMovement`), true, "enabled projects preserve the opt-in");

const handlers = {};
const Input = evaluate("createInputSystem")({
  defaultBindings: evaluate("RA.defaultInput()"),
  document: { addEventListener(type, fn) { handlers[type] = fn; } },
  window: { addEventListener() {} },
  navigator: { getGamepads: () => [] },
  isMenuOpen: () => false,
  onMenuNav() {},
});
Input.attachDOM();
const keyEvent = (code) => ({ code, repeat: false, preventDefault() {} });
handlers.keydown(keyEvent("ArrowUp"));
handlers.keydown(keyEvent("ArrowLeft"));
Input.poll();
assert.equal(Input.dir(), 1, "four-way mode retains the original cardinal priority");
assert.equal(Input.dir(true), 6, "up + left resolves to up-left");
handlers.keyup(keyEvent("ArrowLeft"));
handlers.keyup(keyEvent("ArrowUp"));
handlers.keydown(keyEvent("ArrowDown"));
handlers.keydown(keyEvent("ArrowRight"));
Input.poll();
assert.equal(Input.dir(true), 5, "down + right resolves to down-right");

const root = path.resolve(__dirname, "..");
const entry = `export {
  DIRD, diagonalStepClear, startMove, swordHitsEntity
} from ${JSON.stringify(path.join(root, "src/engine/scenes/map-runtime.ts").replace(/\\/g, "/"))};`;
const bundled = buildSync({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "cjs",
  write: false,
  platform: "node",
  logLevel: "silent",
}).outputFiles[0].text;
const mod = { exports: {} };
vm.runInNewContext(bundled, {
  module: mod,
  exports: mod.exports,
  require,
  console,
  window: { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: {} } },
  location: { search: "" },
  URLSearchParams,
});
const movement = mod.exports;

assert.deepEqual(Array.from(movement.DIRD[4]), [-1, 1], "down-left delta");
assert.deepEqual(Array.from(movement.DIRD[5]), [1, 1], "down-right delta");
assert.deepEqual(Array.from(movement.DIRD[6]), [-1, -1], "up-left delta");
assert.deepEqual(Array.from(movement.DIRD[7]), [1, -1], "up-right delta");
assert.equal(movement.diagonalStepClear(5, 5, 6, () => true), true,
  "a diagonal opens when both neighboring cardinal tiles are open");
assert.equal(movement.diagonalStepClear(5, 5, 6, (x, y) => !(x === 4 && y === 5)), false,
  "a blocked horizontal neighbor prevents corner cutting");
assert.equal(movement.diagonalStepClear(5, 5, 6, (x, y) => !(x === 5 && y === 4)), false,
  "a blocked vertical neighbor prevents corner cutting");

const ent = { x: 5, y: 5 };
movement.startMove(ent, 7);
assert.deepEqual({ dir: ent.dir, tx: ent.tx, ty: ent.ty, moving: ent.moving },
  { dir: 7, tx: 6, ty: 4, moving: true }, "a diagonal move targets one grid cell on both axes");
assert.equal(movement.swordHitsEntity(
  { x: 5, y: 5, rx: 5, ry: 5 },
  { x: 6, y: 4, rx: 6, ry: 4 },
  7,
), true, "diagonal facing reaches the diagonally adjacent action-combat tile");

const schema = fs.readFileSync("src/shared/schema.ts", "utf8");
const systemTab = fs.readFileSync("src/editor/database/system-tab.ts", "utf8");
const mapScene = fs.readFileSync("src/engine/scenes/map.ts", "utf8");
const assets = fs.readFileSync("js/assets.js", "utf8");
const mapRuntime = fs.readFileSync("src/engine/scenes/map-runtime.ts", "utf8");
assert.match(schema, /export type Dir = 0 \| 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7/,
  "the shared direction schema recognizes all eight facings");
assert.match(schema, /eightDirectionMovement\?: boolean/,
  "the system schema declares the optional movement setting");
assert.match(systemTab, /chk\(s, "eightDirectionMovement"\)/,
  "Database System exposes the opt-in");
assert.match(mapScene, /Input\.dir\(!!ctx\.proj\.system\.eightDirectionMovement\)/,
  "the live map input reads the project opt-in");
assert.match(mapScene, /diagonalStepClear\(p\.x, p\.y, d, playerStepPassable\)/,
  "the live map path blocks diagonal corner cutting");
assert.match(mapRuntime, /const cardinal = \["down", "left", "right", "up"\]\[ent\.dir\]/,
  "move-route Forward handles a saved diagonal facing without inserting an invalid step");
assert.match(assets, /dir === 4 \|\| dir === 6 \? 1 : dir === 5 \|\| dir === 7 \? 2/,
  "four-row character sheets map diagonal facings to side poses");

console.log("Eight-direction movement tests passed.");
