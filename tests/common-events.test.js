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

assert.deepEqual(clone(evaluate("RA.defaultCommonEvent()")), {
  id: 0,
  name: "Common Event",
  trigger: "none",
  switchId: 0,
  commands: [],
});
assert.deepEqual(clone(evaluate("DataDefaults.newProject().commonEvents")), [],
  "new projects include an empty Common Events database");

const migrated = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  system: {},
  commonEvents: [
    { id: 4, name: "Clock", trigger: "parallel", switchId: "2", commands: [{ t: "wait", frames: 10 }] },
    { name: "", trigger: "invalid", switchId: -3, commands: null }
  ]
})`);
assert.deepEqual(clone(migrated.commonEvents), [
  { id: 4, name: "Clock", trigger: "parallel", switchId: 2, commands: [{ t: "wait", frames: 10 }] },
  { id: 2, name: "Common Event", trigger: "none", switchId: 0, commands: [] },
]);

assert.equal(evaluate("RA.commonEventEnabled({ switchId: 0 }, {})"), true,
  "no activation switch means always active");
assert.equal(evaluate("RA.commonEventEnabled({ switchId: 3 }, { 3: true })"), true,
  "selected switch ON enables automatic processing");
assert.equal(evaluate("RA.commonEventEnabled({ switchId: 3 }, { 3: false })"), false,
  "selected switch OFF disables automatic processing");

const editorSource = fs.readFileSync("js/editor.js", "utf8");
const engineSource = fs.readFileSync("js/engine.js", "utf8");
assert.match(editorSource, /\{ label: "Common Events"/, "Database exposes the Common Events tab");
assert.match(editorSource, /t: "commonEvent", label: "Call Common Event"/,
  "event command picker exposes Call Common Event");
assert.match(engineSource, /case "commonEvent":\s*await this\.callCommonEvent/,
  "the interpreter waits for command-based common-event calls");
assert.match(engineSource, /callCommonEvent\(id\)\s*\{\s*return new Interp\(null\)\.callCommonEvent\(id\)/,
  "the Script API exposes game.callCommonEvent(id)");
assert.match(engineSource, /commonEvent\.trigger === "auto"/,
  "runtime schedules switch-enabled Autorun common events");
assert.match(engineSource, /commonEvent\.trigger !== "parallel"/,
  "runtime schedules switch-enabled Parallel common events");
assert.match(engineSource, /this\.commonStack\.includes\(commonEvent\.id\)/,
  "recursive common-event calls are guarded");

console.log("Common event tests passed.");
