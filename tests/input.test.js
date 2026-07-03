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
assert.deepEqual(def.keyboard.attack, ["KeyF", "KeyJ"]);
assert.equal(def.stickDeadzone, 0.5);
// Every action has a keyboard + gamepad binding array. "hud" toggles the
// minimap/quest-tracker HUD (Phase 5).
const actions = clone(evaluate("RA.INPUT_ACTIONS")).map((a) => a.key);
assert.deepEqual(actions, ["up", "down", "left", "right", "ok", "cancel", "dash", "attack", "hud"]);
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
assert.deepEqual(mp.keyboard.attack, ["KeyF", "KeyJ"], "old default attack gains F");
assert.deepEqual(mp.gamepad.ok, ["face_south"], "whole gamepad block backfilled");
assert.equal(mp.stickDeadzone, 0.5, "deadzone backfilled");

const migOldAttack = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  system: { input: { keyboard: { attack: ["KeyJ"] } } }
})`);
assert.deepEqual(clone(migOldAttack.system.input.keyboard.attack), ["KeyF", "KeyJ"], "saved old default attack gains F");

const migCustomAttack = evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 },
  system: { input: { keyboard: { attack: ["KeyK"] } } }
})`);
assert.deepEqual(clone(migCustomAttack.system.input.keyboard.attack), ["KeyK"], "custom attack binding is preserved");

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
assert.deepEqual(sparse.keyboard.attack, ["KeyF", "KeyJ"], "missing project action falls back to engine default");
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

// 9. Label + glyph helpers now live in RA (the editor shares them; input.js delegates here).
// Verbose codeLabel (menus/lists):
assert.equal(evaluate('RA.codeLabel("keyboard", "KeyZ")'), "Z", "KeyZ -> Z");
assert.equal(evaluate('RA.codeLabel("keyboard", "ArrowUp")'), "Up Arrow", "ArrowUp -> verbose label");
assert.equal(evaluate('RA.codeLabel("keyboard", "Digit1")'), "1", "Digit1 -> 1");
assert.equal(evaluate('RA.codeLabel("gamepad", "face_south")'), "Face Down (A)", "face_south verbose label");
assert.equal(evaluate('RA.codeLabel("gamepad", "totally_unknown")'), "totally_unknown", "unknown code falls through");
// Compact glyphText (for drawing a key-cap / button icon):
assert.equal(evaluate('RA.glyphText("gamepad", "face_south")'), "A", "face_south glyph token");
assert.equal(evaluate('RA.glyphText("gamepad", "dpad_up")'), "↑", "dpad_up glyph arrow");
assert.equal(evaluate('RA.glyphText("gamepad", "bumper_l")'), "LB", "bumper glyph token");
assert.equal(evaluate('RA.glyphText("keyboard", "KeyZ")'), "Z", "keyboard letter glyph");
assert.equal(evaluate('RA.glyphText("keyboard", "ArrowUp")'), "↑", "arrow-key glyph");
assert.equal(evaluate('RA.glyphText("keyboard", "Space")'), "␣", "space glyph token");
// Every code used by the default bindings resolves to a non-empty glyph token (no blank chips).
const defAll = clone(evaluate("RA.defaultInput()"));
for (const k of actions) {
  for (const dev of ["keyboard", "gamepad"]) {
    for (const code of defAll[dev][k]) {
      assert.ok(String(evaluate('RA.glyphText(' + JSON.stringify(dev) + ', ' + JSON.stringify(code) + ')')).length,
        "glyph token for " + dev + "/" + code);
    }
  }
}

// 10. Drawing-shape classifier — the glyph renderer picks a SHAPE from this, not just a text token.
assert.equal(evaluate('RA.glyphShape("face_south")'), "face", "face button shape");
assert.equal(evaluate('RA.glyphShape("dpad_up")'), "dpad", "d-pad shape");
assert.equal(evaluate('RA.glyphShape("lstick_left")'), "stick", "left-stick direction shape");
assert.equal(evaluate('RA.glyphShape("stick_l")'), "stick_click", "stick-click shape");
assert.equal(evaluate('RA.glyphShape("bumper_l")'), "pill", "bumper falls back to pill");
assert.equal(evaluate('RA.glyphShape("KeyZ")'), "pill", "keyboard code is a pill");

// 11. Controller families are a DISPLAY layer — same positional code, different label/glyph.
// glyphText (compact draw token) per family:
assert.equal(evaluate('RA.glyphText("gamepad","face_south","xbox")'), "A", "xbox south = A");
assert.equal(evaluate('RA.glyphText("gamepad","face_south","ps")'), "✕", "ps south = Cross");
assert.equal(evaluate('RA.glyphText("gamepad","face_south","switch")'), "B", "switch south = B (Nintendo relabel)");
assert.equal(evaluate('RA.glyphText("gamepad","face_east","switch")'), "A", "switch east = A (swap is label-only, code unchanged)");
assert.equal(evaluate('RA.glyphText("gamepad","bumper_l","ps")'), "L1", "ps L bumper = L1");
assert.equal(evaluate('RA.glyphText("gamepad","bumper_l","switch")'), "L", "switch L bumper = L");
assert.equal(evaluate('RA.glyphText("gamepad","trigger_l","switch")'), "ZL", "switch L trigger = ZL");
assert.equal(evaluate('RA.glyphText("gamepad","start","switch")'), "+", "switch start = +");
// Directions/keys are family-agnostic:
assert.equal(evaluate('RA.glyphText("gamepad","dpad_up","ps")'), "↑", "dpad arrow ignores family");
// Default (no family arg) == xbox — back-compat for existing call sites:
assert.equal(evaluate('RA.glyphText("gamepad","face_south")'),
  evaluate('RA.glyphText("gamepad","face_south","xbox")'), "default family is xbox");
// codeLabel (verbose menu label) per family:
assert.equal(evaluate('RA.codeLabel("gamepad","face_south","ps")'), "Cross", "ps verbose label");
assert.equal(evaluate('RA.codeLabel("gamepad","face_south","switch")'), "B Button", "switch verbose label");
assert.equal(evaluate('RA.codeLabel("gamepad","start","ps")'), "Options", "ps start verbose label");
assert.equal(evaluate('RA.codeLabel("gamepad","face_south")'), "Face Down (A)", "default verbose label unchanged");

// 12. padFamilyFromId classifies the connected controller by its Gamepad.id string (pure, no navigator).
assert.equal(evaluate('RA.padFamilyFromId("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)")'), "xbox", "xbox id");
assert.equal(evaluate('RA.padFamilyFromId("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)")'), "ps", "dualsense id");
assert.equal(evaluate('RA.padFamilyFromId("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")'), "switch", "pro-controller id");
assert.equal(evaluate('RA.padFamilyFromId("")'), "xbox", "unknown/empty -> xbox default");

console.log("Input binding tests passed.");
