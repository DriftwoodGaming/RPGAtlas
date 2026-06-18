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
const clone = (value) => JSON.parse(JSON.stringify(value));

assert.equal(evaluate("DataDefaults.newProject().system.windowColor"), "#12182e",
  "new projects seed the default window color");
assert.equal(evaluate('RA.normalizeWindowColor("#AbC")'), "#aabbcc",
  "short hex colors normalize for imported projects");
assert.equal(evaluate('RA.normalizeWindowColor("not-a-color")'), "#12182e",
  "invalid colors fall back safely");
assert.deepEqual(clone(evaluate('RA.windowColorPalette("#204060")')), {
  hex: "#204060",
  top: "32, 64, 96",
  bottom: "19, 38, 58",
  nameTop: "50, 99, 149",
  nameBottom: "25, 50, 75",
});

const migrated = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  system: { windowColor: "#C84A72" }
})`);
assert.equal(migrated.system.windowColor, "#c84a72", "migration preserves a valid custom color");

const legacy = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  system: {}
})`);
assert.equal(legacy.system.windowColor, "#12182e", "migration backfills legacy projects");

const editorSource = fs.readFileSync("js/editor.js", "utf8");
const engineSource = fs.readFileSync("js/engine.js", "utf8");
const playCss = fs.readFileSync("css/play.css", "utf8");
assert.match(editorSource, /field\("Window color"/, "System tab exposes the color picker");
assert.match(engineSource, /RA\.windowColorPalette\(s\.windowColor\)/,
  "runtime derives its window palette from the project setting");
assert.match(playCss, /\.win\s*\{[\s\S]*?--win-top-rgb/,
  "shared menu and message windows use the configured color");
assert.match(playCss, /\.msg-name\s*\{[\s\S]*?--win-name-top-rgb/,
  "message speaker labels use the configured color");

console.log("System appearance tests passed.");
