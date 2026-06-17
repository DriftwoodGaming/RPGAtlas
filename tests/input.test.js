"use strict";

// Headless tests for the input-binding schema: defaults, parity with engine keyName(),
// project migration backfill, the pure merge (override-over-defaults) and conflict helpers.
// Mirrors tests/action-combat.test.js (loads plugins.js + data.js into a vm context).

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
const clone = (v) => JSON.parse(JSON.stringify(v));

// 1. newProject seeds system.input with the defaults.
const projInput = evaluate("DataDefaults.newProject().system.input");
assert.deepEqual(clone(projInput), clone(evaluate("RA.defaultInput()")), "newProject().system.input === defaultInput()");

// 2. Keyboard defaults match engine keyName() exactly (parity guard).
const def = clone(evaluate("RA.defaultInput()"));
assert.deepEqual(def.keyboard.ok, ["KeyZ", "Enter", "Space"]);
assert.deepEqual(def.keyboard.cancel, ["KeyX", "Escape"]);
// Gamepad cancel = face_east (B) only; it opens the menu on the map and backs out in menus.
// START is intentionally left unbound by default (it used to share cancel).
assert.deepEqual(def.gamepad.cancel, ["face_east"]);
// Directions bind both the D-Pad and the left stick (poller synthesizes lstick_* names),
// so each is a separately editable binding in the rebinder.
assert.deepEqual(def.gamepad.up, ["dpad_up", "lstick_up"]);
assert.deepEqual(def.gamepad.left, ["dpad_left", "lstick_left"]);
assert.deepEqual(def.keyboard.up, ["ArrowUp", "KeyW"]);
assert.deepEqual(def.keyboard.dash, ["ShiftLeft", "ShiftRight"]);
assert.deepEqual(def.keyboard.attack, ["KeyJ"]);
assert.equal(def.stickDeadzone, 0.5);
// Every action has a keyboard + gamepad binding array.
const actions = clone(evaluate("RA.INPUT_ACTIONS")).map((a) => a.key);
assert.deepEqual(actions, ["up", "down", "left", "right", "ok", "cancel", "dash", "attack"]);
for (const a of actions) {
  assert.ok(Array.isArray(def.keyboard[a]) && def.keyboard[a].length, "keyboard binding for " + a);
  assert.ok(Array.isArray(def.gamepad[a]) && def.gamepad[a].length, "gamepad binding for " + a);
}

// 3. PAD_BUTTONS = 16 generic names in W3C Standard Gamepad index order.
const pads = clone(evaluate("RA.PAD_BUTTONS"));
assert.equal(pads.length, 16);
assert.deepEqual(pads.slice(0, 4), ["face_south", "face_east", "face_west", "face_north"]);
assert.deepEqual(pads.slice(12, 16), ["dpad_up", "dpad_down", "dpad_left", "dpad_right"]);

// 4. Migration backfills system.input fully for a legacy project (no system.input).
const migFull = evaluate('RA.migrateProject({ meta: { engine: "rpgatlas", version: 2 }, system: {} })');
assert.deepEqual(clone(migFull.system.input), clone(evaluate("RA.defaultInput()")), "migration full backfill");

// 5. Migration preserves a partial author override and backfills the rest.
const migPart = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 2 },
  system: { input: { keyboard: { ok: ["KeyP"] } } }
})`);
const mp = clone(migPart.system.input);
assert.deepEqual(mp.keyboard.ok, ["KeyP"], "override kept");
assert.deepEqual(mp.keyboard.cancel, ["KeyX", "Escape"], "other keyboard action backfilled");
assert.deepEqual(mp.gamepad.ok, ["face_south"], "whole gamepad block backfilled");
assert.equal(mp.stickDeadzone, 0.5, "deadzone backfilled");

// 6. mergeInputBindings: null override is an identity copy; overrides replace only their actions.
const base = "RA.defaultInput()";
assert.deepEqual(
  clone(evaluate(`RA.mergeInputBindings(${base}, null)`)),
  clone(evaluate(base)),
  "merge with no override == defaults"
);
const merged = clone(evaluate(`RA.mergeInputBindings(${base}, { keyboard: { ok: ["KeyP"] }, stickDeadzone: 0.3 })`));
assert.deepEqual(merged.keyboard.ok, ["KeyP"], "override action replaced");
assert.deepEqual(merged.keyboard.cancel, ["KeyX", "Escape"], "untouched action falls back to default");
assert.deepEqual(merged.gamepad.ok, ["face_south"], "untouched device falls back to default");
assert.equal(merged.stickDeadzone, 0.3, "deadzone override applied");
// projInput missing an action still resolves via engine defaults.
const sparse = clone(evaluate(`RA.mergeInputBindings({ keyboard: { ok: ["KeyL"] } }, null)`));
assert.deepEqual(sparse.keyboard.ok, ["KeyL"], "project binding honored");
assert.deepEqual(sparse.keyboard.attack, ["KeyJ"], "missing project action falls back to engine default");
// Reset == dropping the override.
assert.deepEqual(
  clone(evaluate(`RA.mergeInputBindings(${base}, undefined)`)),
  clone(evaluate(base)),
  "reset to defaults"
);

// 7. inputConflict: finds the owning action, honors exceptAction, returns null when free.
const m = `RA.mergeInputBindings(${base}, null)`;
assert.equal(evaluate(`RA.inputConflict(${m}, "keyboard", "KeyZ", null)`), "ok", "KeyZ is bound to ok");
assert.equal(evaluate(`RA.inputConflict(${m}, "keyboard", "KeyZ", "ok")`), null, "exceptAction ignores self");
assert.equal(evaluate(`RA.inputConflict(${m}, "keyboard", "KeyQ", null)`), null, "unbound key is free");
assert.equal(evaluate(`RA.inputConflict(${m}, "gamepad", "face_east", null)`), "cancel", "face_east is bound to cancel");
assert.equal(evaluate(`RA.inputConflict(${m}, "gamepad", "start", null)`), null, "start is unbound by default (no longer shares cancel)");

// 8. Critical actions (Confirm/Cancel) — the rebinder refuses to leave either of these with no
//    binding on the device being edited (the guard itself lives in engine.js; this pins the set).
assert.deepEqual(clone(evaluate("RA.INPUT_CRITICAL")), ["ok", "cancel"], "ok + cancel are the critical actions");

console.log("Input binding tests passed.");
