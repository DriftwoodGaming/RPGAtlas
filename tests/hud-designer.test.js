"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({ console, Assets: { T: {} } });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
const evaluate = (source) => vm.runInContext(source, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const fresh = plain(evaluate("DataDefaults.newProject().system.hudDesign"));
assert.equal(fresh.enabled, true, "new projects enable the authored HUD layer");
assert.deepEqual(fresh.widgets.map((widget) => widget.type), ["minimap", "quests"],
  "the default layout preserves the classic minimap and quest tracker");
assert.equal(fresh.messageWindow.enabled, false, "classic message positioning remains the default");

const normalized = plain(evaluate(`RA.normalizeHudDesign({
  enabled: true,
  widgets: [
    { id: "bad id", type: "gauge", x: -40, y: 120, w: 0, h: 400,
      binding: "variable", bindingId: 3.8, max: 0, color: "BAD" },
    { type: "unknown", x: 1, y: 1, w: 10, h: 10 }
  ],
  messageWindow: { enabled: true, x: 3, y: 66, w: 92, h: 28, padding: 999, textAlign: "middle" },
  theme: { preset: "neon" }
})`));
assert.equal(normalized.widgets.length, 1, "unknown widget types are rejected at the schema boundary");
assert.equal(normalized.widgets[0].id, "bad-id");
assert.equal(normalized.widgets[0].x, 0);
assert.equal(normalized.widgets[0].y, 98);
assert.equal(normalized.widgets[0].w, 4);
assert.equal(normalized.widgets[0].h, 100);
assert.equal(normalized.widgets[0].bindingId, 3);
assert.equal(normalized.widgets[0].max, 100);
assert.equal(normalized.widgets[0].color, "#6aa6ff");
assert.equal(normalized.messageWindow.padding, 48);
assert.equal(normalized.messageWindow.textAlign, "left");
assert.equal(normalized.theme.accent, "#ff4fd8", "named presets backfill all theme tokens");

const migrated = plain(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3 }, system: {}, plugins: [], assets: {},
  states: [], skills: [], classes: [], maps: []
}).system.hudDesign`));
assert.ok(Array.isArray(migrated.widgets) && migrated.widgets.length === 2,
  "legacy projects receive the classic visual HUD layout during migration");

const designer = fs.readFileSync("src/editor/database/hud-designer.ts", "utf8");
const systemTab = fs.readFileSync("src/editor/database/system-tab.ts", "utf8");
const hudRuntime = fs.readFileSync("src/engine/hud.ts", "utf8");
const messages = fs.readFileSync("js/runtime/messages.js", "utf8");
const mapRuntime = fs.readFileSync("src/engine/scenes/map.ts", "utf8");
assert.match(systemTab, /Open Visual UI \/ HUD Designer/, "System exposes the designer entry point");
assert.match(designer, /pointerdown/, "designer widgets support direct dragging and resizing");
assert.match(designer, /Value binding/, "designer exposes variable and party-state bindings");
assert.match(designer, /Run common event/, "designer authors custom menu commands");
assert.match(hudRuntime, /boundValue\(widget/, "runtime resolves live widget bindings");
assert.match(hudRuntime, /hud-menu-command/, "runtime creates interactive authored menu commands");
assert.match(mapRuntime, /runHudCommonEvent/, "custom menu common events use the map blocking seam");
assert.match(messages, /msg-custom-layout/, "message windows consume the authored rectangle");

console.log("Visual UI/HUD Designer tests passed.");
