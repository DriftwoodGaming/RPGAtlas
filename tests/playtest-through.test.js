"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");

function bundle(entry) {
  return buildSync({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "cjs",
    write: false,
    platform: "node",
    logLevel: "silent",
  }).outputFiles[0].text;
}

const developerEntry = `export {
  isEditorPlaytest,
  withDeveloperPlaytestBindings,
} from ${JSON.stringify(
  path.join(root, "src/engine/developer-mode.ts").replace(/\\/g, "/"),
)};`;
const developerModule = { exports: {} };
vm.runInNewContext(bundle(developerEntry), {
  module: developerModule,
  exports: developerModule.exports,
  URLSearchParams,
});
const developer = developerModule.exports;

assert.equal(
  developer.isEditorPlaytest({ location: { search: "?playtest=123" } }),
  true,
  "the editor's cache-busted playtest URL enables developer controls",
);
assert.equal(
  developer.isEditorPlaytest({ location: { search: "" } }),
  false,
  "opening the bundled player directly is not developer playtest mode",
);
assert.equal(
  developer.isEditorPlaytest({
    RPGATLAS_PROJECT: { system: { title: "Deployed Game" } },
    location: { search: "?playtest=forged" },
  }),
  false,
  "a deployed game cannot enable developer controls with a query string",
);

const baseBindings = {
  keyboard: { up: ["ArrowUp"] },
  gamepad: { up: ["dpad_up"] },
};
const playtestBindings = developer.withDeveloperPlaytestBindings(baseBindings, true);
assert.deepEqual(
  Array.from(playtestBindings.keyboard.developerThrough),
  ["ControlLeft", "ControlRight"],
  "both Ctrl keys feed the internal developer Through action",
);
assert.equal(baseBindings.keyboard.developerThrough, undefined, "project bindings are not mutated");
assert.equal(
  developer.withDeveloperPlaytestBindings(baseBindings, false),
  baseBindings,
  "deployed runtime bindings remain unchanged",
);

const runtimeEntry = `export { ctx } from ${JSON.stringify(
  path.join(root, "src/engine/state/engine-context.ts").replace(/\\/g, "/"),
)};
export { playerStepPassable, developerThroughActive } from ${JSON.stringify(
  path.join(root, "src/engine/scenes/map-runtime.ts").replace(/\\/g, "/"),
)};`;
const runtimeModule = { exports: {} };
vm.runInNewContext(bundle(runtimeEntry), {
  module: runtimeModule,
  exports: runtimeModule.exports,
  require,
  console,
  window: { RPGAtlasDeps: { Assets: { TILE: 48, tiles: {} }, RA: {} } },
  location: { search: "" },
  URLSearchParams,
});
const runtime = runtimeModule.exports;
runtime.ctx.map = {
  width: 3,
  height: 3,
  loop: false,
  zones: [],
  passOv: new Array(9).fill(2),
  layers: {
    ground: new Array(9).fill(0),
    decor: new Array(9).fill(0),
    decor2: new Array(9).fill(0),
  },
};
runtime.ctx.Input = { pressed: (action) => action === "developerThrough" };

runtime.ctx.playtestMode = true;
assert.equal(runtime.developerThroughActive(), true, "Ctrl dynamically flags the player Through");
assert.equal(runtime.playerStepPassable(1, 1), true, "Through bypasses a blocked in-bounds tile");
assert.equal(runtime.playerStepPassable(-1, 1), false, "Through does not leave bounded maps");

runtime.ctx.map.passOv.fill(1);
runtime.ctx.evRTs = [{
  x: 1,
  y: 1,
  erased: false,
  page: { priority: "same", through: false },
}];
assert.equal(runtime.playerStepPassable(1, 1), true, "Through bypasses a solid event");

runtime.ctx.playtestMode = false;
assert.equal(runtime.developerThroughActive(), false, "the same Ctrl input is inert outside playtest");
assert.equal(runtime.playerStepPassable(1, 1), false, "deployed movement still obeys event collision");

console.log("Playtest Through tests passed.");
